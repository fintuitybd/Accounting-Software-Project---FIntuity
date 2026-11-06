import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { isValidIsoDate } from '../company/dates.ts';
import { digitsOnly, isValidBinDigits, isValidTinDigits, QUANTITY_SCALE } from '../master/constants.ts';
import { divideRoundHalfUp } from '../inventory/quantity.ts';
import { PURCHASE_TAX_PACK, type PurchaseTdsNature } from './taxPack.generated.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const BPS_DENOMINATOR = 10_000n;
const POLICY_KEY = 'purchase_tax_policy';

export type PurchaseDecisionState =
  'SUPPORTED' | 'SUPPORTED_WITH_CONDITIONS' | 'MANUAL_REVIEW' | 'NOT_SUPPORTED' | 'SOURCE_DISPUTED_OR_EXPIRED';

export interface PurchaseTaxLineInput {
  lineId: string;
  quantity: bigint;
  unitPricePoisha: bigint;
  discountPoisha: bigint;
  taxCategory: string;
}

export interface PurchaseTaxFacts {
  docDate: string;
  supplierBin: string | null;
  supplierTin: string | null;
  supplierTinMissing: boolean;
  hasMushak63: boolean;
  paymentMethod: string;
  isWithholdingEntity: boolean;
  vdsApplicable: boolean;
  tdsNature: string;
  reverseChargeChallanHeld: boolean;
}

export interface PurchaseTaxLineDecision {
  lineId: string;
  taxCategory: string;
  rateBps: number;
  vdsRateBps: number;
  ruleId: string | null;
  citation: string | null;
  netPoisha: bigint;
  vatPoisha: bigint;
  vatClaimablePoisha: bigint;
  vatDisallowedPoisha: bigint;
  costPoisha: bigint;
  supplierPayablePoisha: bigint;
  vdsPoisha: bigint;
  isReverseCharge: boolean;
  decisionState: PurchaseDecisionState;
  warnings: string[];
}

export interface PurchaseTaxDecision {
  packVersion: string;
  packStatus: string;
  effectiveFrom: string;
  decisionState: PurchaseDecisionState;
  traceId: string;
  lines: PurchaseTaxLineDecision[];
  subtotalPoisha: bigint;
  discountPoisha: bigint;
  vatPoisha: bigint;
  supplierVatPoisha: bigint;
  reverseChargeVatPoisha: bigint;
  vatClaimablePoisha: bigint;
  vatDisallowedPoisha: bigint;
  costPoisha: bigint;
  grossPoisha: bigint;
  vdsPoisha: bigint;
  tdsPoisha: bigint;
  tdsNature: string;
  tdsRateBps: number;
  netPayablePoisha: bigint;
  warnings: string[];
}

export interface PurchaseTaxPolicyApproval {
  status: 'APPROVED';
  packVersion: string;
  reviewerName: string;
  reviewerQualification: string;
  sourceReference: string;
  reviewedAt: string;
  inputVatAccountId: string;
  vdsPayableAccountId: string;
  tdsPayableAccountId: string;
  reverseChargePayableAccountId: string;
  approvedBy: string;
  approvedAt: string;
}

export interface PurchaseTaxPolicyDto {
  pack: {
    version: string;
    titleEn: string;
    publishedAt: string;
    effectiveFrom: string;
    reviewer: string;
    reviewerStatus: string;
    vatCategories: typeof PURCHASE_TAX_PACK.vatCategories;
    vdsRates: typeof PURCHASE_TAX_PACK.vdsRates;
    tdsRates: typeof PURCHASE_TAX_PACK.tdsRates;
  };
  approval:
    | (PurchaseTaxPolicyApproval & {
        inputVatAccountCode: string;
        inputVatAccountName: string;
        vdsPayableAccountCode: string;
        vdsPayableAccountName: string;
        tdsPayableAccountCode: string;
        tdsPayableAccountName: string;
        reverseChargePayableAccountCode: string;
        reverseChargePayableAccountName: string;
      })
    | null;
  canPost: boolean;
  blockingReason: string | null;
  requiresProfessionalReview: true;
}

function vatCategory(category: string) {
  if (!(category in PURCHASE_TAX_PACK.vatCategories)) {
    throw new AppError(
      400,
      'PURCHASE_TAX_CATEGORY_INVALID',
      `Tax category ${category} is not part of the configured purchase rule pack.`,
    );
  }
  return PURCHASE_TAX_PACK.vatCategories[category as keyof typeof PURCHASE_TAX_PACK.vatCategories];
}

function vdsCategory(category: string) {
  if (!(category in PURCHASE_TAX_PACK.vdsRates)) return null;
  return PURCHASE_TAX_PACK.vdsRates[category as keyof typeof PURCHASE_TAX_PACK.vdsRates];
}

function tdsNature(value: string) {
  if (!(value in PURCHASE_TAX_PACK.tdsRates)) {
    throw new AppError(400, 'PURCHASE_TDS_NATURE_INVALID', `TDS nature ${value} is not configured.`);
  }
  return PURCHASE_TAX_PACK.tdsRates[value as PurchaseTdsNature];
}

function worstState(states: readonly PurchaseDecisionState[]): PurchaseDecisionState {
  const rank: Record<PurchaseDecisionState, number> = {
    SUPPORTED: 0,
    SUPPORTED_WITH_CONDITIONS: 1,
    MANUAL_REVIEW: 2,
    SOURCE_DISPUTED_OR_EXPIRED: 3,
    NOT_SUPPORTED: 4,
  };
  return states.reduce<PurchaseDecisionState>(
    (worst, state) => (rank[state] > rank[worst] ? state : worst),
    'SUPPORTED',
  );
}

export function isPostablePurchaseTaxState(state: PurchaseDecisionState): boolean {
  return state === 'SUPPORTED' || state === 'SUPPORTED_WITH_CONDITIONS';
}

function applyRateBps(base: bigint, rateBps: number): bigint {
  if (base <= 0n || rateBps <= 0) return 0n;
  return divideRoundHalfUp(base * BigInt(rateBps), BPS_DENOMINATOR);
}

/**
 * Calculates purchase VAT, input-credit eligibility and expected withholding line by line from the
 * generated rule-pack snapshot. The supplier Mushak 6.3 serial is an input fact; this function never
 * invents evidence. Missing evidence or BIN does not block the bill, but it disallows the input VAT
 * and capitalises it into the inventory/expense cost. Missing/invalid supplier e-TIN upscales TDS by
 * the configured 50%. All amounts are integer poisha.
 */
export function calculatePurchaseTax(input: {
  facts: PurchaseTaxFacts;
  lines: readonly PurchaseTaxLineInput[];
}): PurchaseTaxDecision {
  const { facts } = input;
  if (!isValidIsoDate(facts.docDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real document date in YYYY-MM-DD format.');
  }
  if (input.lines.length === 0) {
    throw new AppError(400, 'PURCHASE_LINES_REQUIRED', 'A purchase document needs at least one line.');
  }
  const packExpired = facts.docDate < PURCHASE_TAX_PACK.effectiveFrom;
  const warnings: string[] = [];
  if (packExpired) {
    warnings.push(
      `The configured purchase tax pack ${PURCHASE_TAX_PACK.version} is effective from ${PURCHASE_TAX_PACK.effectiveFrom}; the document date is outside its effective period.`,
    );
  }
  const supplierBin = digitsOnly(facts.supplierBin);
  const supplierTin = digitsOnly(facts.supplierTin);
  const binValid = isValidBinDigits(supplierBin);
  const tinValid = !facts.supplierTinMissing && isValidTinDigits(supplierTin);
  if (!binValid) {
    warnings.push('The supplier BIN is missing or not a valid 13-digit registration. Input VAT cannot be claimed.');
  }
  if (!facts.hasMushak63) {
    warnings.push(
      'No supplier Mushak 6.3 serial/date is recorded. Input VAT cannot be claimed; the VAT is capitalised into cost.',
    );
  }
  if (!tinValid) {
    warnings.push('The supplier e-TIN is missing or invalid. The statutory TDS rate is upscaled by 50%.');
  }

  const tdsConfig = tdsNature(facts.tdsNature);
  let tdsRateBps = 0;
  if (facts.tdsNature !== 'NONE') {
    if (!facts.isWithholdingEntity) {
      warnings.push('The company is not configured as a withholding entity, so no TDS is deducted.');
    } else {
      tdsRateBps = tinValid
        ? tdsConfig.rateBps
        : Math.round((tdsConfig.rateBps * (10_000 + PURCHASE_TAX_PACK.tdsNoTinUpscaleBps)) / 10_000);
    }
  }

  let subtotalPoisha = 0n;
  let discountPoisha = 0n;
  let vatPoisha = 0n;
  let supplierVatPoisha = 0n;
  let reverseChargeVatPoisha = 0n;
  let vatClaimablePoisha = 0n;
  let vatDisallowedPoisha = 0n;
  let costPoisha = 0n;
  let vdsPoisha = 0n;
  const lines: PurchaseTaxLineDecision[] = [];

  const preliminary = input.lines.map((line, index) => {
    const config = vatCategory(line.taxCategory);
    if (line.quantity <= 0n) {
      throw new AppError(400, 'PURCHASE_QUANTITY_INVALID', `Line ${index + 1} needs a positive quantity.`);
    }
    if (line.unitPricePoisha < 0n || line.discountPoisha < 0n) {
      throw new AppError(400, 'PURCHASE_AMOUNT_INVALID', `Line ${index + 1} price and discount must be non-negative.`);
    }
    const gross = divideRoundHalfUp(line.quantity * line.unitPricePoisha, QUANTITY_SCALE);
    if (line.discountPoisha > gross) {
      throw new AppError(
        400,
        'PURCHASE_DISCOUNT_EXCEEDS_LINE',
        `Line ${index + 1} discount cannot exceed the line value.`,
      );
    }
    const net = gross - line.discountPoisha;
    const isReverseCharge = line.taxCategory === 'REVERSE_CHARGE';
    const vat = applyRateBps(net, config.rateBps);
    return { line, index, config, net, vat, isReverseCharge };
  });

  // The cash limit is a document-level fact: a cash settlement above BDT 1,00,000 blocks input VAT.
  const supplierPayableBeforeCredit = preliminary.reduce(
    (sum, entry) => sum + entry.net + (entry.isReverseCharge ? 0n : entry.vat),
    0n,
  );
  const cashBreach =
    facts.paymentMethod === 'CASH' &&
    supplierPayableBeforeCredit > BigInt(PURCHASE_TAX_PACK.cashDisallowanceLimitPoisha);
  if (cashBreach) {
    warnings.push(
      `A cash settlement of ${supplierPayableBeforeCredit.toString()} poisha exceeds the configured cash limit; input VAT is disallowed under the s.46 guard.`,
    );
  }

  for (const entry of preliminary) {
    const { line, config, net, vat, isReverseCharge } = entry;
    const lineWarnings: string[] = [];
    let decisionState: PurchaseDecisionState = 'SUPPORTED';
    if (packExpired) {
      decisionState = 'SOURCE_DISPUTED_OR_EXPIRED';
    } else if (config.status !== 'ACTIVE') {
      decisionState = 'NOT_SUPPORTED';
      lineWarnings.push(`Rule ${config.ruleId ?? config.category} is not active in the configured pack.`);
    } else if (line.taxCategory === 'OUT_OF_SCOPE') {
      decisionState = 'NOT_SUPPORTED';
      lineWarnings.push(
        'Out-of-scope purchases cannot be posted to the statutory book. Use a manual journal after review.',
      );
    }

    let claimable = 0n;
    let disallowed = 0n;
    if (isReverseCharge) {
      if (facts.reverseChargeChallanHeld) {
        claimable = vat;
      } else {
        disallowed = vat;
        lineWarnings.push(
          'Reverse-charge VAT is self-assessed and payable, but no Treasury challan reference is held, so the input credit is not claimable yet.',
        );
        if (decisionState === 'SUPPORTED') decisionState = 'SUPPORTED_WITH_CONDITIONS';
      }
    } else if (line.taxCategory === 'TRADING_5' || line.taxCategory === 'PROCUREMENT_7_5') {
      disallowed = vat;
      lineWarnings.push(
        `The line is taxed at ${config.rateBps / 100}% (below the 15% standard rate), so input VAT is disallowed and capitalised into cost.`,
      );
      if (decisionState === 'SUPPORTED') decisionState = 'SUPPORTED_WITH_CONDITIONS';
    } else if (line.taxCategory === 'STANDARD_15' && vat > 0n) {
      const blockedReasons: string[] = [];
      if (!binValid) blockedReasons.push('supplier BIN missing/invalid');
      if (!facts.hasMushak63) blockedReasons.push('supplier Mushak 6.3 evidence missing');
      if (cashBreach) blockedReasons.push('cash payment above the limit');
      if (blockedReasons.length > 0) {
        disallowed = vat;
        lineWarnings.push(`Input VAT is disallowed: ${blockedReasons.join('; ')}.`);
        if (decisionState === 'SUPPORTED') decisionState = 'SUPPORTED_WITH_CONDITIONS';
      } else {
        claimable = vat;
      }
    } else {
      // Exempt, zero-rated and out-of-scope lines carry no claimable input VAT.
      if (vat > 0n) {
        disallowed = vat;
        lineWarnings.push('VAT on this category is not claimable and is capitalised into cost.');
        if (decisionState === 'SUPPORTED') decisionState = 'SUPPORTED_WITH_CONDITIONS';
      }
    }

    const vds = vdsCategory(line.taxCategory);
    const vdsRateBps = facts.vdsApplicable && facts.isWithholdingEntity && vds && vds.rateBps > 0 ? vds.rateBps : 0;
    const lineVds = applyRateBps(net, vdsRateBps);
    if (facts.vdsApplicable && facts.isWithholdingEntity && vdsRateBps === 0) {
      lineWarnings.push('VDS does not apply to this tax category.');
    }

    const lineCost = net + disallowed;
    const supplierPayable = net + (isReverseCharge ? 0n : vat);
    subtotalPoisha += net;
    discountPoisha += line.discountPoisha;
    vatPoisha += vat;
    if (isReverseCharge) reverseChargeVatPoisha += vat;
    else supplierVatPoisha += vat;
    vatClaimablePoisha += claimable;
    vatDisallowedPoisha += disallowed;
    costPoisha += lineCost;
    vdsPoisha += lineVds;
    lines.push({
      lineId: line.lineId,
      taxCategory: line.taxCategory,
      rateBps: config.rateBps,
      vdsRateBps,
      ruleId: config.ruleId,
      citation: config.citation,
      netPoisha: net,
      vatPoisha: vat,
      vatClaimablePoisha: claimable,
      vatDisallowedPoisha: disallowed,
      costPoisha: lineCost,
      supplierPayablePoisha: supplierPayable,
      vdsPoisha: lineVds,
      isReverseCharge,
      decisionState,
      warnings: lineWarnings,
    });
  }

  const grossPoisha = subtotalPoisha + supplierVatPoisha;
  const tdsPoisha = applyRateBps(subtotalPoisha, tdsRateBps);
  if (facts.vdsApplicable && !facts.isWithholdingEntity) {
    warnings.push(
      'VDS was requested but the company is not configured as a withholding entity, so nothing is withheld.',
    );
  }
  if (vdsPoisha > grossPoisha) {
    throw new AppError(409, 'PURCHASE_VDS_EXCEEDS_GROSS', 'The calculated VDS exceeds the supplier payable.');
  }
  const netPayablePoisha = grossPoisha - vdsPoisha - tdsPoisha;
  if (netPayablePoisha < 0n) {
    throw new AppError(
      409,
      'PURCHASE_WITHHOLDING_EXCEEDS_GROSS',
      'The calculated withholding exceeds the supplier payable.',
    );
  }

  const traceSource = JSON.stringify({
    pack: PURCHASE_TAX_PACK.version,
    docDate: facts.docDate,
    supplierBin,
    supplierTin,
    supplierTinMissing: facts.supplierTinMissing,
    hasMushak63: facts.hasMushak63,
    paymentMethod: facts.paymentMethod,
    withholdingEntity: facts.isWithholdingEntity,
    vdsApplicable: facts.vdsApplicable,
    tdsNature: facts.tdsNature,
    reverseChargeChallanHeld: facts.reverseChargeChallanHeld,
    lines: input.lines.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity.toString(),
      unitPricePoisha: line.unitPricePoisha.toString(),
      discountPoisha: line.discountPoisha.toString(),
      taxCategory: line.taxCategory,
    })),
  });
  const traceId = createHash('sha256').update(traceSource).digest('hex').slice(0, 32);

  const lineStates = lines.map((line) => line.decisionState);
  return {
    packVersion: PURCHASE_TAX_PACK.version,
    packStatus: PURCHASE_TAX_PACK.reviewerStatus,
    effectiveFrom: PURCHASE_TAX_PACK.effectiveFrom,
    decisionState: worstState([...lineStates, warnings.length > 0 ? 'SUPPORTED_WITH_CONDITIONS' : 'SUPPORTED']),
    traceId,
    lines,
    subtotalPoisha,
    discountPoisha,
    vatPoisha,
    supplierVatPoisha,
    reverseChargeVatPoisha,
    vatClaimablePoisha,
    vatDisallowedPoisha,
    costPoisha,
    grossPoisha,
    vdsPoisha,
    tdsPoisha,
    tdsNature: facts.tdsNature,
    tdsRateBps,
    netPayablePoisha,
    warnings: [...new Set(warnings)],
  };
}

export function assertPostablePurchaseTax(decision: PurchaseTaxDecision): void {
  if (!isPostablePurchaseTaxState(decision.decisionState)) {
    throw new AppError(
      409,
      'PURCHASE_TAX_DECISION_BLOCKED',
      `The purchase tax decision is ${decision.decisionState}. Correct the document or obtain a reviewed rule pack before posting.`,
      { decisionState: decision.decisionState, traceId: decision.traceId },
    );
  }
}

export function purchaseTaxDecisionJson(decision: PurchaseTaxDecision): Record<string, unknown> {
  return {
    packVersion: decision.packVersion,
    packStatus: decision.packStatus,
    effectiveFrom: decision.effectiveFrom,
    decisionState: decision.decisionState,
    traceId: decision.traceId,
    subtotalPoisha: decision.subtotalPoisha.toString(),
    discountPoisha: decision.discountPoisha.toString(),
    vatPoisha: decision.vatPoisha.toString(),
    supplierVatPoisha: decision.supplierVatPoisha.toString(),
    reverseChargeVatPoisha: decision.reverseChargeVatPoisha.toString(),
    vatClaimablePoisha: decision.vatClaimablePoisha.toString(),
    vatDisallowedPoisha: decision.vatDisallowedPoisha.toString(),
    costPoisha: decision.costPoisha.toString(),
    grossPoisha: decision.grossPoisha.toString(),
    vdsPoisha: decision.vdsPoisha.toString(),
    tdsPoisha: decision.tdsPoisha.toString(),
    tdsNature: decision.tdsNature,
    tdsRateBps: decision.tdsRateBps,
    netPayablePoisha: decision.netPayablePoisha.toString(),
    warnings: decision.warnings,
    lines: decision.lines.map((line) => ({
      lineId: line.lineId,
      taxCategory: line.taxCategory,
      rateBps: line.rateBps,
      vdsRateBps: line.vdsRateBps,
      ruleId: line.ruleId,
      citation: line.citation,
      netPoisha: line.netPoisha.toString(),
      vatPoisha: line.vatPoisha.toString(),
      vatClaimablePoisha: line.vatClaimablePoisha.toString(),
      vatDisallowedPoisha: line.vatDisallowedPoisha.toString(),
      costPoisha: line.costPoisha.toString(),
      supplierPayablePoisha: line.supplierPayablePoisha.toString(),
      vdsPoisha: line.vdsPoisha.toString(),
      isReverseCharge: line.isReverseCharge,
      decisionState: line.decisionState,
      warnings: line.warnings,
    })),
  };
}

function readApproval(value: unknown): PurchaseTaxPolicyApproval | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.status !== 'APPROVED' || typeof record.packVersion !== 'string') return null;
  if (typeof record.reviewerName !== 'string' || typeof record.inputVatAccountId !== 'string') return null;
  if (
    typeof record.vdsPayableAccountId !== 'string' ||
    typeof record.tdsPayableAccountId !== 'string' ||
    typeof record.reverseChargePayableAccountId !== 'string'
  ) {
    return null;
  }
  return {
    status: 'APPROVED',
    packVersion: record.packVersion,
    reviewerName: record.reviewerName,
    reviewerQualification: typeof record.reviewerQualification === 'string' ? record.reviewerQualification : '',
    sourceReference: typeof record.sourceReference === 'string' ? record.sourceReference : '',
    reviewedAt: typeof record.reviewedAt === 'string' ? record.reviewedAt : '',
    inputVatAccountId: record.inputVatAccountId,
    vdsPayableAccountId: record.vdsPayableAccountId,
    tdsPayableAccountId: record.tdsPayableAccountId,
    reverseChargePayableAccountId: record.reverseChargePayableAccountId,
    approvedBy: typeof record.approvedBy === 'string' ? record.approvedBy : '',
    approvedAt: typeof record.approvedAt === 'string' ? record.approvedAt : '',
  };
}

interface AccountCheckRow {
  id: string;
  code: string;
  name_en: string;
  is_active: boolean;
  account_type: string;
  control_subledger: string;
}

async function loadAccounts(
  database: Queryable,
  companyId: string,
  ids: readonly string[],
): Promise<Map<string, AccountCheckRow>> {
  const result = await database.query<AccountCheckRow>(
    `SELECT id, code, name_en, is_active, account_type, control_subledger
       FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, [...ids]],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

export async function getPurchaseTaxPolicy(database: Queryable, companyId: string): Promise<PurchaseTaxPolicyDto> {
  const result = await database.query<{ value_json: Record<string, unknown> | null }>(
    `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = $2`,
    [companyId, POLICY_KEY],
  );
  const approval = readApproval(result.rows[0]?.value_json);
  let accounts = new Map<string, AccountCheckRow>();
  if (approval) {
    accounts = await loadAccounts(database, companyId, [
      approval.inputVatAccountId,
      approval.vdsPayableAccountId,
      approval.tdsPayableAccountId,
      approval.reverseChargePayableAccountId,
    ]);
  }
  let blockingReason: string | null = null;
  if (!approval) {
    blockingReason = `No reviewer approval is recorded for purchase tax pack ${PURCHASE_TAX_PACK.version}. Posting is blocked until a named reviewer approves the pack and the withholding accounts for this company.`;
  } else if (approval.packVersion !== PURCHASE_TAX_PACK.version) {
    blockingReason = `The recorded purchase approval is for pack ${approval.packVersion}, but the server uses ${PURCHASE_TAX_PACK.version}. Record a new approval.`;
  } else {
    const input = accounts.get(approval.inputVatAccountId);
    const vds = accounts.get(approval.vdsPayableAccountId);
    const tds = accounts.get(approval.tdsPayableAccountId);
    const rc = accounts.get(approval.reverseChargePayableAccountId);
    if (!input || !vds || !tds || !rc) {
      blockingReason = 'One or more approved purchase tax accounts no longer exist. Update the approval.';
    } else if (
      !input.is_active ||
      input.account_type !== 'ASSET' ||
      input.control_subledger !== 'VAT_CURRENT_ACCOUNT'
    ) {
      blockingReason = 'The approved input VAT account must be an active VAT current-account ASSET account.';
    } else if (!vds.is_active || vds.account_type !== 'LIABILITY' || vds.control_subledger !== 'VDS_PAYABLE') {
      blockingReason = 'The approved VDS payable account must be an active VDS_PAYABLE LIABILITY account.';
    } else if (!tds.is_active || tds.account_type !== 'LIABILITY' || tds.control_subledger !== 'TDS_PAYABLE') {
      blockingReason = 'The approved TDS payable account must be an active TDS_PAYABLE LIABILITY account.';
    } else if (!rc.is_active || rc.account_type !== 'LIABILITY' || rc.control_subledger !== 'NONE') {
      blockingReason =
        'The approved reverse-charge payable account must be an active LIABILITY account that is not a protected control account.';
    }
  }
  const accountDto = (id: string) => {
    const account = accounts.get(id);
    return { code: account?.code ?? '', name: account?.name_en ?? '' };
  };
  return {
    pack: {
      version: PURCHASE_TAX_PACK.version,
      titleEn: PURCHASE_TAX_PACK.titleEn,
      publishedAt: PURCHASE_TAX_PACK.publishedAt,
      effectiveFrom: PURCHASE_TAX_PACK.effectiveFrom,
      reviewer: PURCHASE_TAX_PACK.reviewer,
      reviewerStatus: PURCHASE_TAX_PACK.reviewerStatus,
      vatCategories: PURCHASE_TAX_PACK.vatCategories,
      vdsRates: PURCHASE_TAX_PACK.vdsRates,
      tdsRates: PURCHASE_TAX_PACK.tdsRates,
    },
    approval: approval
      ? {
          ...approval,
          inputVatAccountCode: accountDto(approval.inputVatAccountId).code,
          inputVatAccountName: accountDto(approval.inputVatAccountId).name,
          vdsPayableAccountCode: accountDto(approval.vdsPayableAccountId).code,
          vdsPayableAccountName: accountDto(approval.vdsPayableAccountId).name,
          tdsPayableAccountCode: accountDto(approval.tdsPayableAccountId).code,
          tdsPayableAccountName: accountDto(approval.tdsPayableAccountId).name,
          reverseChargePayableAccountCode: accountDto(approval.reverseChargePayableAccountId).code,
          reverseChargePayableAccountName: accountDto(approval.reverseChargePayableAccountId).name,
        }
      : null,
    canPost: blockingReason === null,
    blockingReason,
    requiresProfessionalReview: true,
  };
}

export async function requireApprovedPurchaseTaxPolicy(
  client: Queryable,
  companyId: string,
  docDate: string,
): Promise<{
  approval: PurchaseTaxPolicyApproval;
  inputVatAccountId: string;
  vdsPayableAccountId: string;
  tdsPayableAccountId: string;
  reverseChargePayableAccountId: string;
}> {
  const policy = await getPurchaseTaxPolicy(client, companyId);
  if (docDate < PURCHASE_TAX_PACK.effectiveFrom) {
    throw new AppError(
      409,
      'PURCHASE_TAX_PACK_NOT_EFFECTIVE',
      `The configured purchase tax pack ${PURCHASE_TAX_PACK.version} is effective from ${PURCHASE_TAX_PACK.effectiveFrom}; ${docDate} is outside it.`,
    );
  }
  if (!policy.canPost || !policy.approval) {
    throw new AppError(
      409,
      'PURCHASE_TAX_POLICY_NOT_APPROVED',
      policy.blockingReason ?? 'Purchase tax policy approval is required before posting.',
      { packVersion: PURCHASE_TAX_PACK.version },
    );
  }
  return {
    approval: policy.approval,
    inputVatAccountId: policy.approval.inputVatAccountId,
    vdsPayableAccountId: policy.approval.vdsPayableAccountId,
    tdsPayableAccountId: policy.approval.tdsPayableAccountId,
    reverseChargePayableAccountId: policy.approval.reverseChargePayableAccountId,
  };
}

export interface ApprovePurchaseTaxPolicyInput {
  companyId: string;
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
  reviewerName: string;
  reviewerQualification: string;
  sourceReference: string;
  reviewedAt: string;
  inputVatAccountId: string;
  vdsPayableAccountId: string;
  tdsPayableAccountId: string;
  reverseChargePayableAccountId: string;
  rulePackVersion: string;
}

export async function approvePurchaseTaxPolicy(
  pool: Pool,
  input: ApprovePurchaseTaxPolicyInput,
): Promise<PurchaseTaxPolicyDto> {
  if (input.rulePackVersion !== PURCHASE_TAX_PACK.version) {
    throw new AppError(
      409,
      'PURCHASE_TAX_PACK_VERSION_MISMATCH',
      `This server uses purchase tax pack ${PURCHASE_TAX_PACK.version}; approval for ${input.rulePackVersion} cannot be recorded here.`,
    );
  }
  if (!isValidIsoDate(input.reviewedAt)) {
    throw new AppError(400, 'INVALID_DATE', 'The review date must be a real YYYY-MM-DD date.');
  }
  const reviewerName = input.reviewerName.trim();
  const qualification = input.reviewerQualification.trim();
  const sourceReference = input.sourceReference.trim();
  if (reviewerName.length < 3 || reviewerName.length > 200) {
    throw new AppError(400, 'PURCHASE_TAX_REVIEWER_INVALID', 'Reviewer name must be between 3 and 200 characters.');
  }
  if (qualification.length < 3 || qualification.length > 200) {
    throw new AppError(
      400,
      'PURCHASE_TAX_REVIEWER_INVALID',
      'Reviewer qualification must be between 3 and 200 characters.',
    );
  }
  if (sourceReference.length < 3 || sourceReference.length > 500) {
    throw new AppError(400, 'PURCHASE_TAX_SOURCE_INVALID', 'Source reference must be between 3 and 500 characters.');
  }
  const todayDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  if (input.reviewedAt > todayDhaka) {
    throw new AppError(400, 'INVALID_DATE', 'The review date cannot be in the future.');
  }

  return withTransaction(pool, async (client) => {
    const accounts = await loadAccounts(client, input.companyId, [
      input.inputVatAccountId,
      input.vdsPayableAccountId,
      input.tdsPayableAccountId,
      input.reverseChargePayableAccountId,
    ]);
    const inputVat = accounts.get(input.inputVatAccountId);
    const vds = accounts.get(input.vdsPayableAccountId);
    const tds = accounts.get(input.tdsPayableAccountId);
    const rc = accounts.get(input.reverseChargePayableAccountId);
    if (!inputVat || !vds || !tds || !rc) {
      throw new AppError(
        400,
        'PURCHASE_TAX_ACCOUNT_INVALID',
        'Choose input VAT, VDS payable, TDS payable and reverse-charge payable accounts from this company.',
      );
    }
    if (
      !inputVat.is_active ||
      inputVat.account_type !== 'ASSET' ||
      inputVat.control_subledger !== 'VAT_CURRENT_ACCOUNT'
    ) {
      throw new AppError(
        400,
        'PURCHASE_TAX_ACCOUNT_INVALID',
        'The input VAT account must be an active ASSET account with the VAT_CURRENT_ACCOUNT control subledger.',
      );
    }
    if (!vds.is_active || vds.account_type !== 'LIABILITY' || vds.control_subledger !== 'VDS_PAYABLE') {
      throw new AppError(
        400,
        'PURCHASE_TAX_ACCOUNT_INVALID',
        'The VDS payable account must be an active LIABILITY account with the VDS_PAYABLE control subledger.',
      );
    }
    if (!tds.is_active || tds.account_type !== 'LIABILITY' || tds.control_subledger !== 'TDS_PAYABLE') {
      throw new AppError(
        400,
        'PURCHASE_TAX_ACCOUNT_INVALID',
        'The TDS payable account must be an active LIABILITY account with the TDS_PAYABLE control subledger.',
      );
    }
    if (!rc.is_active || rc.account_type !== 'LIABILITY' || rc.control_subledger !== 'NONE') {
      throw new AppError(
        400,
        'PURCHASE_TAX_ACCOUNT_INVALID',
        'The reverse-charge payable account must be an active LIABILITY account that is not a protected control account.',
      );
    }

    const before = await client.query<{ value_json: Record<string, unknown> | null }>(
      `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = $2`,
      [input.companyId, POLICY_KEY],
    );
    const approval: PurchaseTaxPolicyApproval & Record<string, unknown> = {
      status: 'APPROVED',
      packVersion: PURCHASE_TAX_PACK.version,
      reviewerName,
      reviewerQualification: qualification,
      sourceReference,
      reviewedAt: input.reviewedAt,
      inputVatAccountId: input.inputVatAccountId,
      vdsPayableAccountId: input.vdsPayableAccountId,
      tdsPayableAccountId: input.tdsPayableAccountId,
      reverseChargePayableAccountId: input.reverseChargePayableAccountId,
      approvedBy: input.actorUserId,
      approvedAt: new Date().toISOString(),
      packTitle: PURCHASE_TAX_PACK.titleEn,
      packReviewerStatus: PURCHASE_TAX_PACK.reviewerStatus,
    };
    await client.query(
      `INSERT INTO company_settings (company_id, key, value_json, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (company_id, key)
       DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.companyId, POLICY_KEY, JSON.stringify(approval), input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'purchases.tax_policy_approved',
      entityType: 'company_settings',
      entityId: `${input.companyId}:${POLICY_KEY}`,
      before: before.rows[0]?.value_json ?? null,
      after: approval,
      reason: `Recorded external reviewer approval for purchase tax pack ${PURCHASE_TAX_PACK.version}.`,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getPurchaseTaxPolicy(client, input.companyId);
  });
}
