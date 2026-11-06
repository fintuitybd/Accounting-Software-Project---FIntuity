import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { QUANTITY_SCALE } from '../master/constants.ts';
import { divideRoundHalfUp } from '../inventory/quantity.ts';
import { SALES_TAX_PACK, type SalesTaxCategory } from './taxPack.generated.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const BPS_DENOMINATOR = 10_000n;
const POLICY_KEY = 'sales_tax_policy';

export type SalesDecisionState =
  'SUPPORTED' | 'SUPPORTED_WITH_CONDITIONS' | 'MANUAL_REVIEW' | 'NOT_SUPPORTED' | 'SOURCE_DISPUTED_OR_EXPIRED';

export interface SalesTaxLineInput {
  lineId: string;
  quantity: bigint;
  unitPricePoisha: bigint;
  discountPoisha: bigint;
  taxCategory: string;
  /** Credit notes use the original line's exact remaining net value rather than re-pricing. */
  netOverridePoisha?: bigint;
  /** Credit notes cap cumulative VAT to the original line's remaining VAT. */
  vatOverridePoisha?: bigint;
}

export interface SalesTaxLineDecision {
  lineId: string;
  taxCategory: string;
  rateBps: number;
  ruleId: string | null;
  citation: string | null;
  netPoisha: bigint;
  vatPoisha: bigint;
  grossPoisha: bigint;
  decisionState: SalesDecisionState;
  warnings: string[];
}

export interface SalesTaxDecision {
  packVersion: string;
  packStatus: string;
  effectiveFrom: string;
  decisionState: SalesDecisionState;
  traceId: string;
  lines: SalesTaxLineDecision[];
  subtotalPoisha: bigint;
  discountPoisha: bigint;
  vatPoisha: bigint;
  grossPoisha: bigint;
  warnings: string[];
}

export interface SalesTaxPolicyApproval {
  status: 'APPROVED';
  packVersion: string;
  reviewerName: string;
  reviewerQualification: string;
  sourceReference: string;
  reviewedAt: string;
  outputVatAccountId: string;
  approvedBy: string;
  approvedAt: string;
}

export interface SalesTaxPolicyDto {
  pack: {
    version: string;
    titleEn: string;
    publishedAt: string;
    effectiveFrom: string;
    reviewer: string;
    reviewerStatus: string;
    categories: typeof SALES_TAX_PACK.categories;
  };
  approval:
    | (SalesTaxPolicyApproval & {
        outputVatAccountCode: string;
        outputVatAccountName: string;
      })
    | null;
  canPost: boolean;
  blockingReason: string | null;
  requiresProfessionalReview: true;
}

function categoryConfig(category: string) {
  if (!(category in SALES_TAX_PACK.categories)) {
    throw new AppError(
      400,
      'SALES_TAX_CATEGORY_INVALID',
      `Tax category ${category} is not part of the configured sales rule pack.`,
    );
  }
  return SALES_TAX_PACK.categories[category as SalesTaxCategory];
}

function worstState(states: readonly SalesDecisionState[]): SalesDecisionState {
  const rank: Record<SalesDecisionState, number> = {
    SUPPORTED: 0,
    SUPPORTED_WITH_CONDITIONS: 1,
    MANUAL_REVIEW: 2,
    SOURCE_DISPUTED_OR_EXPIRED: 3,
    NOT_SUPPORTED: 4,
  };
  return states.reduce<SalesDecisionState>((worst, state) => (rank[state] > rank[worst] ? state : worst), 'SUPPORTED');
}

export function isPostableSalesTaxState(state: SalesDecisionState): boolean {
  return state === 'SUPPORTED' || state === 'SUPPORTED_WITH_CONDITIONS';
}

/**
 * Calculates sales VAT line by line from the generated rule-pack snapshot. The line net base is
 * quantity x unit price less the line discount; VAT is rounded half-up per line. All arithmetic is
 * integer poisha. The client may preview with the same rates, but only this result is persisted.
 */
export function calculateSalesTax(input: {
  docDate: string;
  partyBin: string | null;
  lines: readonly SalesTaxLineInput[];
}): SalesTaxDecision {
  if (!isValidIsoDate(input.docDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real document date in YYYY-MM-DD format.');
  }
  if (input.lines.length === 0) {
    throw new AppError(400, 'SALES_LINES_REQUIRED', 'A sales document needs at least one line.');
  }

  const warnings: string[] = [];
  const packExpired = input.docDate < SALES_TAX_PACK.effectiveFrom;
  if (packExpired) {
    warnings.push(
      `The configured tax pack ${SALES_TAX_PACK.version} is effective from ${SALES_TAX_PACK.effectiveFrom}; the document date is outside its effective period.`,
    );
  }
  const binPresent = Boolean(input.partyBin);
  if (!binPresent) {
    warnings.push('The customer BIN is not recorded. The tax decision does not claim input-credit evidence.');
  }

  let subtotalPoisha = 0n;
  let discountPoisha = 0n;
  let vatPoisha = 0n;
  const lines: SalesTaxLineDecision[] = [];

  for (const line of input.lines) {
    const config = categoryConfig(line.taxCategory);
    if (line.taxCategory === 'REVERSE_CHARGE') {
      throw new AppError(
        400,
        'SALES_TAX_CATEGORY_UNSUPPORTED',
        'Reverse-charge VAT is a purchase-side self-assessment in this release and cannot be used on a sales invoice.',
      );
    }
    if (line.quantity <= 0n) {
      throw new AppError(400, 'SALES_QUANTITY_INVALID', 'Every sales line needs a positive quantity.');
    }
    if (line.unitPricePoisha < 0n || line.discountPoisha < 0n) {
      throw new AppError(400, 'SALES_AMOUNT_INVALID', 'Unit price and discount must be non-negative BDT amounts.');
    }
    const lineGross = divideRoundHalfUp(line.quantity * line.unitPricePoisha, QUANTITY_SCALE);
    if (line.discountPoisha > lineGross) {
      throw new AppError(400, 'SALES_DISCOUNT_EXCEEDS_LINE', 'A line discount cannot exceed the line value.');
    }
    if (line.netOverridePoisha !== undefined && line.netOverridePoisha < 0n) {
      throw new AppError(400, 'SALES_AMOUNT_INVALID', 'A credit-note net value cannot be negative.');
    }
    if (line.vatOverridePoisha !== undefined && line.vatOverridePoisha < 0n) {
      throw new AppError(400, 'SALES_AMOUNT_INVALID', 'A credit-note VAT value cannot be negative.');
    }
    const net = line.netOverridePoisha ?? lineGross - line.discountPoisha;
    const rateBps = config.rateBps;
    const vat =
      line.vatOverridePoisha ?? (rateBps > 0 ? divideRoundHalfUp(net * BigInt(rateBps), BPS_DENOMINATOR) : 0n);
    const lineWarnings: string[] = [];
    let decisionState: SalesDecisionState = 'SUPPORTED';
    if (packExpired) {
      decisionState = 'SOURCE_DISPUTED_OR_EXPIRED';
    } else if (config.status !== 'ACTIVE') {
      decisionState = 'NOT_SUPPORTED';
      lineWarnings.push(`Rule ${config.ruleId ?? config.category} is not active in the configured pack.`);
    } else if (rateBps > 0 && !binPresent) {
      decisionState = 'SUPPORTED_WITH_CONDITIONS';
      lineWarnings.push('Customer BIN missing; the invoice does not evidence input-credit eligibility for the buyer.');
    }
    subtotalPoisha += net;
    discountPoisha += line.discountPoisha;
    vatPoisha += vat;
    lines.push({
      lineId: line.lineId,
      taxCategory: line.taxCategory,
      rateBps,
      ruleId: config.ruleId,
      citation: config.citation,
      netPoisha: net,
      vatPoisha: vat,
      grossPoisha: net + vat,
      decisionState,
      warnings: lineWarnings,
    });
  }

  const decisionState = worstState(lines.map((line) => line.decisionState));
  const traceSource = JSON.stringify({
    pack: SALES_TAX_PACK.version,
    docDate: input.docDate,
    partyBin: input.partyBin,
    lines: input.lines.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity.toString(),
      unitPricePoisha: line.unitPricePoisha.toString(),
      discountPoisha: line.discountPoisha.toString(),
      taxCategory: line.taxCategory,
    })),
  });
  const traceId = createHash('sha256').update(traceSource).digest('hex').slice(0, 32);

  return {
    packVersion: SALES_TAX_PACK.version,
    packStatus: SALES_TAX_PACK.reviewerStatus,
    effectiveFrom: SALES_TAX_PACK.effectiveFrom,
    decisionState,
    traceId,
    lines,
    subtotalPoisha,
    discountPoisha,
    vatPoisha,
    grossPoisha: subtotalPoisha + vatPoisha,
    warnings: [...new Set(warnings)],
  };
}

export function assertPostableSalesTax(decision: SalesTaxDecision): void {
  if (!isPostableSalesTaxState(decision.decisionState)) {
    throw new AppError(
      409,
      'SALES_TAX_DECISION_BLOCKED',
      `The sales tax decision is ${decision.decisionState}. Correct the document or obtain a reviewed rule pack before posting.`,
      { decisionState: decision.decisionState, traceId: decision.traceId },
    );
  }
}

export function taxDecisionJson(decision: SalesTaxDecision): Record<string, unknown> {
  return {
    packVersion: decision.packVersion,
    packStatus: decision.packStatus,
    effectiveFrom: decision.effectiveFrom,
    decisionState: decision.decisionState,
    traceId: decision.traceId,
    subtotalPoisha: decision.subtotalPoisha.toString(),
    discountPoisha: decision.discountPoisha.toString(),
    vatPoisha: decision.vatPoisha.toString(),
    grossPoisha: decision.grossPoisha.toString(),
    warnings: decision.warnings,
    lines: decision.lines.map((line) => ({
      lineId: line.lineId,
      taxCategory: line.taxCategory,
      rateBps: line.rateBps,
      ruleId: line.ruleId,
      citation: line.citation,
      netPoisha: line.netPoisha.toString(),
      vatPoisha: line.vatPoisha.toString(),
      grossPoisha: line.grossPoisha.toString(),
      decisionState: line.decisionState,
      warnings: line.warnings,
    })),
  };
}

function readApproval(value: unknown): SalesTaxPolicyApproval | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.status !== 'APPROVED' || typeof record.packVersion !== 'string') return null;
  if (typeof record.reviewerName !== 'string' || typeof record.outputVatAccountId !== 'string') return null;
  return {
    status: 'APPROVED',
    packVersion: record.packVersion,
    reviewerName: record.reviewerName,
    reviewerQualification: typeof record.reviewerQualification === 'string' ? record.reviewerQualification : '',
    sourceReference: typeof record.sourceReference === 'string' ? record.sourceReference : '',
    reviewedAt: typeof record.reviewedAt === 'string' ? record.reviewedAt : '',
    outputVatAccountId: record.outputVatAccountId,
    approvedBy: typeof record.approvedBy === 'string' ? record.approvedBy : '',
    approvedAt: typeof record.approvedAt === 'string' ? record.approvedAt : '',
  };
}

export async function getSalesTaxPolicy(database: Queryable, companyId: string): Promise<SalesTaxPolicyDto> {
  const result = await database.query<{ value_json: Record<string, unknown> | null }>(
    `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = $2`,
    [companyId, POLICY_KEY],
  );
  const approval = readApproval(result.rows[0]?.value_json);
  let account: { code: string; name_en: string } | null = null;
  if (approval) {
    const accountResult = await database.query<{ code: string; name_en: string; is_active: boolean }>(
      `SELECT code, name_en, is_active FROM accounts WHERE company_id = $1 AND id = $2`,
      [companyId, approval.outputVatAccountId],
    );
    const row = accountResult.rows[0];
    if (row && row.is_active) account = { code: row.code, name_en: row.name_en };
  }
  let blockingReason: string | null = null;
  if (!approval) {
    blockingReason = `No reviewer approval is recorded for tax pack ${SALES_TAX_PACK.version}. Posting is blocked until a named reviewer approves the pack for this company.`;
  } else if (approval.packVersion !== SALES_TAX_PACK.version) {
    blockingReason = `The recorded approval is for pack ${approval.packVersion}, but the server uses ${SALES_TAX_PACK.version}. Record a new approval.`;
  } else if (!account) {
    blockingReason = 'The approved output VAT account is missing or inactive. Update the tax policy approval.';
  }
  return {
    pack: {
      version: SALES_TAX_PACK.version,
      titleEn: SALES_TAX_PACK.titleEn,
      publishedAt: SALES_TAX_PACK.publishedAt,
      effectiveFrom: SALES_TAX_PACK.effectiveFrom,
      reviewer: SALES_TAX_PACK.reviewer,
      reviewerStatus: SALES_TAX_PACK.reviewerStatus,
      categories: SALES_TAX_PACK.categories,
    },
    approval: approval
      ? {
          ...approval,
          outputVatAccountCode: account?.code ?? '',
          outputVatAccountName: account?.name_en ?? '',
        }
      : null,
    canPost: blockingReason === null,
    blockingReason,
    requiresProfessionalReview: true,
  };
}

export async function requireApprovedSalesTaxPolicy(
  client: Queryable,
  companyId: string,
  docDate: string,
): Promise<{ approval: SalesTaxPolicyApproval; outputVatAccountId: string }> {
  const policy = await getSalesTaxPolicy(client, companyId);
  if (docDate < SALES_TAX_PACK.effectiveFrom) {
    throw new AppError(
      409,
      'SALES_TAX_PACK_NOT_EFFECTIVE',
      `The configured tax pack ${SALES_TAX_PACK.version} is effective from ${SALES_TAX_PACK.effectiveFrom}; ${docDate} is outside it.`,
    );
  }
  if (!policy.canPost || !policy.approval) {
    throw new AppError(
      409,
      'SALES_TAX_POLICY_NOT_APPROVED',
      policy.blockingReason ?? 'Sales tax policy approval is required before posting.',
      { packVersion: SALES_TAX_PACK.version },
    );
  }
  const account = await client.query<{ is_active: boolean; account_type: string }>(
    `SELECT is_active, account_type FROM accounts WHERE company_id = $1 AND id = $2`,
    [companyId, policy.approval.outputVatAccountId],
  );
  const row = account.rows[0];
  if (!row || !row.is_active || row.account_type !== 'LIABILITY') {
    throw new AppError(
      409,
      'SALES_TAX_ACCOUNT_INVALID',
      'The approved output VAT account must be an active LIABILITY account from this company.',
    );
  }
  return {
    approval: policy.approval,
    outputVatAccountId: policy.approval.outputVatAccountId,
  };
}

export interface ApproveSalesTaxPolicyInput {
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
  outputVatAccountId: string;
  rulePackVersion: string;
}

/**
 * Records an external reviewer's approval of a specific rule-pack version. The application does not
 * claim to perform tax counsel review; it only stores who approved which version, when and on what
 * source. A changed pack version invalidates this record until a new approval is entered.
 */
export async function approveSalesTaxPolicy(pool: Pool, input: ApproveSalesTaxPolicyInput): Promise<SalesTaxPolicyDto> {
  if (input.rulePackVersion !== SALES_TAX_PACK.version) {
    throw new AppError(
      409,
      'SALES_TAX_PACK_VERSION_MISMATCH',
      `This server uses tax pack ${SALES_TAX_PACK.version}; approval for ${input.rulePackVersion} cannot be recorded here.`,
    );
  }
  if (!isValidIsoDate(input.reviewedAt)) {
    throw new AppError(400, 'INVALID_DATE', 'The review date must be a real YYYY-MM-DD date.');
  }
  const reviewerName = input.reviewerName.trim();
  const qualification = input.reviewerQualification.trim();
  const sourceReference = input.sourceReference.trim();
  if (reviewerName.length < 3 || reviewerName.length > 200) {
    throw new AppError(400, 'SALES_TAX_REVIEWER_INVALID', 'Reviewer name must be between 3 and 200 characters.');
  }
  if (qualification.length < 3 || qualification.length > 200) {
    throw new AppError(
      400,
      'SALES_TAX_REVIEWER_INVALID',
      'Reviewer qualification must be between 3 and 200 characters.',
    );
  }
  if (sourceReference.length < 3 || sourceReference.length > 500) {
    throw new AppError(400, 'SALES_TAX_SOURCE_INVALID', 'Source reference must be between 3 and 500 characters.');
  }
  const todayDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  if (input.reviewedAt > todayDhaka) {
    throw new AppError(400, 'INVALID_DATE', 'The review date cannot be in the future.');
  }

  return withTransaction(pool, async (client) => {
    const account = await client.query<{ code: string; name_en: string; is_active: boolean; account_type: string }>(
      `SELECT code, name_en, is_active, account_type FROM accounts WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.outputVatAccountId],
    );
    const row = account.rows[0];
    if (!row) {
      throw new AppError(400, 'SALES_TAX_ACCOUNT_INVALID', 'Choose an output VAT account from this company.');
    }
    if (!row.is_active || row.account_type !== 'LIABILITY') {
      throw new AppError(
        400,
        'SALES_TAX_ACCOUNT_INVALID',
        'The output VAT account must be an active LIABILITY account.',
      );
    }
    const before = await client.query<{ value_json: Record<string, unknown> | null }>(
      `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = $2`,
      [input.companyId, POLICY_KEY],
    );
    const approval: SalesTaxPolicyApproval & Record<string, unknown> = {
      status: 'APPROVED',
      packVersion: SALES_TAX_PACK.version,
      reviewerName,
      reviewerQualification: qualification,
      sourceReference,
      reviewedAt: input.reviewedAt,
      outputVatAccountId: input.outputVatAccountId,
      approvedBy: input.actorUserId,
      approvedAt: new Date().toISOString(),
      packTitle: SALES_TAX_PACK.titleEn,
      packReviewerStatus: SALES_TAX_PACK.reviewerStatus,
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
      action: 'sales.tax_policy_approved',
      entityType: 'company_settings',
      entityId: `${input.companyId}:${POLICY_KEY}`,
      before: before.rows[0]?.value_json ?? null,
      after: approval,
      reason: `Recorded external reviewer approval for tax pack ${SALES_TAX_PACK.version}.`,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getSalesTaxPolicy(client, input.companyId);
  });
}

export function formatSalesTaxAmount(poisha: bigint): string {
  return formatPoishaAsBdt(poisha);
}
