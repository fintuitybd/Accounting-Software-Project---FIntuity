import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { divideRoundHalfUp } from '../inventory/quantity.ts';
import {
  postSystemJournalWithinTransaction,
  reverseJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import { getPurchaseTaxPolicy, requireApprovedPurchaseTaxPolicy } from './tax.ts';
import type { PurchaseAuditContext } from './purchaseService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type ApBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_180' | 'OVER_180';

export interface PurchasePaymentAllocationInput {
  documentId: string;
  /** Gross amount of the bill to settle, including any supplier VAT. */
  amount: string;
}

export interface PurchasePaymentInput {
  paymentDate: string;
  partyId: string;
  branchId?: string | null;
  bankAccountId: string;
  /** Cash paid from the bank/cash account. Withholding is added by the server. */
  amount: string;
  reference?: string | null;
  attachmentReference?: string | null;
  narrationEn?: string | null;
  narrationBn?: string | null;
  allocations: PurchasePaymentAllocationInput[];
}

export interface PurchasePaymentAllocationDto {
  id: string;
  documentId: string;
  documentNo: string | null;
  supplierInvoiceNo: string;
  documentDate: string;
  dueDate: string;
  amountPoisha: string;
  amountBdt: string;
  basePoisha: string;
  baseBdt: string;
  vdsPoisha: string;
  vdsBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
}

export interface PurchasePaymentDto {
  id: string;
  companyId: string;
  branchId: string | null;
  status: 'POSTED' | 'REVERSED';
  paymentNumber: string;
  paymentDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountId: string;
  bankAccountName: string;
  bankKind: string;
  glAccountCode: string;
  amountPoisha: string;
  amountBdt: string;
  vdsPoisha: string;
  vdsBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  reference: string | null;
  attachmentReference: string | null;
  narrationEn: string | null;
  narrationBn: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  allocations: PurchasePaymentAllocationDto[];
}

export interface PurchasePaymentSummaryDto {
  id: string;
  status: 'POSTED' | 'REVERSED';
  paymentNumber: string;
  paymentDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankName: string;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  reference: string | null;
  createdAt: string;
}

export interface ApAgeingRowDto {
  documentId: string;
  documentNo: string | null;
  supplierInvoiceNo: string;
  docType: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  outstandingPoisha: string;
  outstandingBdt: string;
  expectedWithholdingPoisha: string;
  expectedWithholdingBdt: string;
  supplierTinMissing: boolean;
  daysOverdue: number;
  bucket: ApBucket;
}

export interface ApAgeingDto {
  asOf: string;
  currency: 'BDT';
  rows: ApAgeingRowDto[];
  totals: Record<ApBucket | 'NET', string>;
  proof: {
    controlAccountId: string;
    controlAccountCode: string;
    controlAccountName: string;
    glBalancePoisha: string;
    glBalanceBdt: string;
    subledgerPoisha: string;
    subledgerBdt: string;
    differencePoisha: string;
    differenceBdt: string;
    agrees: boolean;
  };
}

export interface SupplierStatementLineDto {
  id: string;
  entryDate: string;
  kind: 'PURCHASE_BILL' | 'EXPENSE_VOUCHER' | 'PAYMENT';
  reference: string;
  memo: string;
  debitPoisha: string;
  debitBdt: string;
  creditPoisha: string;
  creditBdt: string;
  runningBalancePoisha: string;
  runningBalanceBdt: string;
}

export interface SupplierStatementDto {
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  from: string;
  to: string;
  openingPoisha: string;
  openingBdt: string;
  closingPoisha: string;
  closingBdt: string;
  lines: SupplierStatementLineDto[];
}

export interface OpenBillDto {
  documentId: string;
  docType: string;
  documentNo: string | null;
  supplierInvoiceNo: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  outstandingPoisha: string;
  outstandingBdt: string;
  expectedWithholdingPoisha: string;
  expectedWithholdingBdt: string;
  supplierTinMissing: boolean;
}

export interface WithholdingLiabilityDto {
  id: string;
  taxType: 'VDS' | 'TDS' | 'REVERSE_CHARGE';
  sourceType: 'BILL' | 'PAYMENT';
  taxPeriod: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  billId: string | null;
  billNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  basePoisha: string;
  baseBdt: string;
  rateBps: number;
  amountPoisha: string;
  amountBdt: string;
  status: 'PENDING' | 'DEPOSITED' | 'REVERSED';
  createdAt: string;
}

export interface WithholdingProofDto {
  asOf: string;
  vds: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
  tds: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
  reverseCharge: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
}

export interface PaymentWithholdingPreviewLine {
  documentId: string;
  documentNo: string | null;
  allocationPoisha: string;
  allocationBdt: string;
  basePoisha: string;
  baseBdt: string;
  vdsPoisha: string;
  vdsBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
  cashPoisha: string;
  cashBdt: string;
  tdsRateBps: number;
  tdsNature: string;
  vdsLines: Array<{ taxCategory: string; rateBps: number; basePoisha: string; amountPoisha: string }>;
}

export interface PaymentWithholdingPreviewDto {
  allocations: PaymentWithholdingPreviewLine[];
  totalAllocationPoisha: string;
  totalAllocationBdt: string;
  totalVdsPoisha: string;
  totalVdsBdt: string;
  totalTdsPoisha: string;
  totalTdsBdt: string;
  totalCashPoisha: string;
  totalCashBdt: string;
}

export interface PurchasePaymentApprovalDto {
  id: string;
  companyId: string;
  status: 'PENDING' | 'REJECTED' | 'POSTED';
  paymentDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountId: string;
  bankAccountName: string;
  amountPoisha: string;
  amountBdt: string;
  vdsPoisha: string;
  vdsBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  reference: string | null;
}

export interface PreparedPurchasePayment {
  party: { id: string; code: string; name_en: string };
  bank: { id: string; name: string; kind: string; gl_account_id: string; gl_code: string };
  apAccount: { id: string; code: string; name_en: string };
  policy: Awaited<ReturnType<typeof requireApprovedPurchaseTaxPolicy>>;
  paymentDate: string;
  paymentReference: string | null;
  attachmentReference: string | null;
  narrationEn: string | null;
  narrationBn: string | null;
  cashAmount: bigint;
  totalAllocation: bigint;
  totalVds: bigint;
  totalTds: bigint;
  totalCash: bigint;
  period: { fiscal_year_id: string; fiscal_start: Date; status: string; code: string };
  branchId: string | null;
  computations: Array<{
    bill: BillRow;
    allocation: bigint;
    withholding: WithholdingComputation;
  }>;
}

interface BillRow {
  id: string;
  document_no: string | null;
  supplier_invoice_no: string;
  doc_type: string;
  status: string;
  party_id: string;
  party_code: string;
  party_name_en: string;
  doc_date: Date;
  due_date: Date;
  gross_poisha: string;
  subtotal_poisha: string;
  vds_poisha: string;
  tds_poisha: string;
  net_payable_poisha: string;
  withholding_entity: boolean;
  tds_nature: string;
  supplier_tin_missing: boolean;
  allocated_poisha: string;
  prior_vds_poisha: string;
  prior_tds_poisha: string;
}

interface WithholdingComputation {
  basePoisha: bigint;
  vdsPoisha: bigint;
  tdsPoisha: bigint;
  cashPoisha: bigint;
  tdsRateBps: number;
  tdsNature: string;
  vdsLines: Array<{ taxCategory: string; rateBps: number; basePoisha: bigint; amountPoisha: bigint }>;
}

function optionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'PURCHASE_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function parsePositiveMoney(value: string, field: string): bigint {
  const poisha = parseBdtToPoisha(value);
  if (poisha === null || poisha <= 0n) {
    throw new AppError(400, 'PURCHASE_AMOUNT_INVALID', `${field} must be a positive BDT amount with up to 2 decimals.`);
  }
  return poisha;
}

function bucketFor(daysOverdue: number): ApBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  if (daysOverdue <= 90) return '61_90';
  if (daysOverdue <= 180) return '91_180';
  return 'OVER_180';
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function auditBase(input: PurchaseAuditContext, companyId: string) {
  return {
    organisationId: input.organisationId,
    companyId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  };
}

async function loadApControlAccount(
  database: Queryable,
  companyId: string,
): Promise<{ id: string; code: string; name_en: string }> {
  const result = await database.query<{ id: string; code: string; name_en: string }>(
    `SELECT id, code, name_en FROM accounts
      WHERE company_id = $1 AND control_subledger = 'AP' AND is_active = true
      ORDER BY code ASC`,
    [companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(
      409,
      'AP_CONTROL_ACCOUNT_NOT_CONFIGURED',
      'Configure exactly one active accounts-payable control account before posting supplier payments.',
    );
  }
  if (result.rows.length > 1) {
    throw new AppError(
      409,
      'AP_CONTROL_ACCOUNT_AMBIGUOUS',
      'More than one active AP control account exists. Keep one active AP control account so the subledger has a single control account.',
    );
  }
  return result.rows[0]!;
}

async function loadSupplier(
  database: Queryable,
  companyId: string,
  partyId: string,
): Promise<{ id: string; code: string; name_en: string; name_bn: string | null; status: string; type: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    status: string;
    type: string;
  }>(`SELECT id, code, name_en, name_bn, status, type FROM parties WHERE company_id = $1 AND id = $2`, [
    companyId,
    partyId,
  ]);
  const party = result.rows[0];
  if (!party) throw new AppError(404, 'PURCHASE_PARTY_NOT_FOUND', 'Supplier not found.');
  if (party.type !== 'SUPPLIER' && party.type !== 'BOTH') {
    throw new AppError(400, 'PURCHASE_PARTY_INVALID', 'The selected party is not a supplier.');
  }
  return party;
}

async function assertActiveBranch(
  database: Queryable,
  companyId: string,
  branchId: string | null | undefined,
): Promise<void> {
  if (!branchId) return;
  const result = await database.query<{ status: string }>(
    `SELECT status FROM branches WHERE company_id = $1 AND id = $2`,
    [companyId, branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new AppError(404, 'PURCHASE_BRANCH_NOT_FOUND', 'Branch not found.');
  if (branch.status !== 'ACTIVE') throw new AppError(409, 'PURCHASE_BRANCH_INACTIVE', 'The branch is inactive.');
}

async function loadBankAccount(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<{ id: string; name: string; kind: string; gl_account_id: string; gl_code: string }> {
  const result = await database.query<{
    id: string;
    name: string;
    kind: string;
    gl_account_id: string;
    gl_code: string;
    gl_active: boolean;
    gl_type: string;
  }>(
    `SELECT ba.id, ba.name, ba.kind, ba.gl_account_id, a.code AS gl_code,
            a.is_active AS gl_active, a.account_type AS gl_type
       FROM bank_accounts ba
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
      WHERE ba.company_id = $1 AND ba.id = $2 AND ba.status = 'ACTIVE'`,
    [companyId, bankAccountId],
  );
  const bank = result.rows[0];
  if (!bank) throw new AppError(404, 'PURCHASE_BANK_ACCOUNT_NOT_FOUND', 'Active bank/cash account not found.');
  if (!bank.gl_active || bank.gl_type !== 'ASSET') {
    throw new AppError(
      409,
      'PURCHASE_BANK_ACCOUNT_INVALID',
      'The bank/cash GL account must be an active asset account.',
    );
  }
  return bank;
}

async function lockBills(
  client: PoolClient,
  companyId: string,
  partyId: string,
  documentIds: readonly string[],
): Promise<Map<string, BillRow>> {
  if (documentIds.length === 0) return new Map();
  const result = await client.query<BillRow>(
    `SELECT d.id, d.document_no, d.supplier_invoice_no, d.doc_type, d.status, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, d.doc_date, d.due_date,
            d.gross_poisha::text AS gross_poisha, d.subtotal_poisha::text AS subtotal_poisha,
            d.vds_poisha::text AS vds_poisha, d.tds_poisha::text AS tds_poisha,
            d.net_payable_poisha::text AS net_payable_poisha,
            d.withholding_entity, d.tds_nature, d.supplier_tin_missing,
            COALESCE((
              SELECT sum(al.amount_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS allocated_poisha,
            COALESCE((
              SELECT sum(al.vds_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS prior_vds_poisha,
            COALESCE((
              SELECT sum(al.tds_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS prior_tds_poisha
       FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
      WHERE d.company_id = $1 AND d.id = ANY($2::uuid[])
      ORDER BY d.id ASC
      FOR UPDATE OF d`,
    [companyId, [...documentIds].sort()],
  );
  const found = new Map(result.rows.map((row) => [row.id, row]));
  for (const id of documentIds) {
    const row = found.get(id);
    if (!row) throw new AppError(404, 'PURCHASE_DOCUMENT_NOT_FOUND', 'Supplier bill not found.');
    if (row.status !== 'POSTED') {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_BILL_INVALID',
        'Payments can only be allocated to a posted supplier bill.',
      );
    }
    if (row.party_id !== partyId) {
      throw new AppError(
        400,
        'PURCHASE_PAYMENT_PARTY_MISMATCH',
        'Every allocated bill must belong to the selected supplier.',
      );
    }
  }
  return found;
}

async function loadBillsForPreview(
  database: Queryable,
  companyId: string,
  partyId: string,
  documentIds: readonly string[],
): Promise<Map<string, BillRow>> {
  if (documentIds.length === 0) return new Map();
  const result = await database.query<BillRow>(
    `SELECT d.id, d.document_no, d.supplier_invoice_no, d.doc_type, d.status, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, d.doc_date, d.due_date,
            d.gross_poisha::text AS gross_poisha, d.subtotal_poisha::text AS subtotal_poisha,
            d.vds_poisha::text AS vds_poisha, d.tds_poisha::text AS tds_poisha,
            d.net_payable_poisha::text AS net_payable_poisha,
            d.withholding_entity, d.tds_nature, d.supplier_tin_missing,
            COALESCE((
              SELECT sum(al.amount_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS allocated_poisha,
            COALESCE((
              SELECT sum(al.vds_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS prior_vds_poisha,
            COALESCE((
              SELECT sum(al.tds_poisha)
                FROM purchase_payment_allocations al
                JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
               WHERE al.company_id = d.company_id AND al.document_id = d.id AND pay.status = 'POSTED'
            ), 0)::bigint::text AS prior_tds_poisha
       FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
      WHERE d.company_id = $1 AND d.id = ANY($2::uuid[])`,
    [companyId, [...documentIds]],
  );
  const found = new Map(result.rows.map((row) => [row.id, row]));
  for (const id of documentIds) {
    const row = found.get(id);
    if (!row) throw new AppError(404, 'PURCHASE_DOCUMENT_NOT_FOUND', 'Supplier bill not found.');
    if (row.status !== 'POSTED') {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_BILL_INVALID',
        'Payments can only be allocated to a posted supplier bill.',
      );
    }
    if (row.party_id !== partyId) {
      throw new AppError(
        400,
        'PURCHASE_PAYMENT_PARTY_MISMATCH',
        'Every allocated bill must belong to the selected supplier.',
      );
    }
  }
  return found;
}

async function computeAllocationWithholding(
  database: Queryable,
  companyId: string,
  bill: BillRow,
  allocationPoisha: bigint,
): Promise<WithholdingComputation> {
  const totalGross = BigInt(bill.gross_poisha);
  const totalSubtotal = BigInt(bill.subtotal_poisha);
  const totalVds = bill.withholding_entity ? BigInt(bill.vds_poisha ?? 0) : 0n;
  const totalTds = bill.withholding_entity ? BigInt(bill.tds_poisha ?? 0) : 0n;
  const totalNetPayable = BigInt(bill.net_payable_poisha ?? (totalGross - totalVds - totalTds));

  const priorGross = BigInt(bill.allocated_poisha ?? 0);
  const priorVds = BigInt(bill.prior_vds_poisha ?? 0);
  const priorTds = BigInt(bill.prior_tds_poisha ?? 0);
  const priorCash = priorGross - priorVds - priorTds;

  const remainingGross = totalGross - priorGross;
  const remainingNetPayable = totalNetPayable - priorCash;

  if (totalGross <= 0n) {
    throw new AppError(409, 'PURCHASE_PAYMENT_BILL_INVALID', 'The supplier bill has no payable value.');
  }
  if (allocationPoisha <= 0n) {
    throw new AppError(400, 'PURCHASE_PAYMENT_ALLOCATION_INVALID', 'Every allocation must clear a positive amount.');
  }

  const isFinal = allocationPoisha >= remainingGross;
  let vdsThis: bigint;
  let tdsThis: bigint;
  let cashThis: bigint;

  if (isFinal) {
    vdsThis = totalVds - priorVds;
    tdsThis = totalTds - priorTds;
    cashThis = remainingNetPayable;
  } else {
    if (totalVds === 0n && totalTds === 0n) {
      vdsThis = 0n;
      tdsThis = 0n;
      cashThis = allocationPoisha;
    } else {
      const c = totalGross > 0n ? divideRoundHalfUp(allocationPoisha * totalNetPayable, totalGross) : 0n;
      if (c >= remainingNetPayable) {
        vdsThis = totalVds - priorVds;
        tdsThis = totalTds - priorTds;
        cashThis = remainingNetPayable;
      } else {
        vdsThis = totalNetPayable > 0n ? divideRoundHalfUp(totalVds * c, totalNetPayable) : 0n;
        tdsThis = totalNetPayable > 0n ? divideRoundHalfUp(totalTds * c, totalNetPayable) : 0n;
        cashThis = allocationPoisha - vdsThis - tdsThis;
      }
    }
  }

  const baseShare = isFinal
    ? (totalSubtotal - (priorGross > 0n && totalGross > 0n ? (totalSubtotal * priorGross) / totalGross : 0n))
    : divideRoundHalfUp(totalSubtotal * allocationPoisha, totalGross);

  const lineResult = await database.query<{
    line_no: number;
    line_base_poisha: string;
    vds_rate_bps: number;
    tax_category: string;
  }>(
    `SELECT line_no, line_base_poisha::text AS line_base_poisha, vds_rate_bps, tax_category
       FROM purchase_document_lines
      WHERE company_id = $1 AND document_id = $2
      ORDER BY line_no ASC`,
    [companyId, bill.id],
  );
  const tdsResult = await database.query<{ rate_bps: number }>(
    `SELECT rate_bps FROM purchase_document_taxes
      WHERE company_id = $1 AND document_id = $2 AND tax_type = 'TDS'
      ORDER BY rate_bps DESC LIMIT 1`,
    [companyId, bill.id],
  );
  const tdsRateBps = bill.withholding_entity ? (tdsResult.rows[0]?.rate_bps ?? 0) : 0;
  const lineShares = lineResult.rows.map((line) => {
    const lineBase = BigInt(line.line_base_poisha);
    return {
      lineBase,
      share: isFinal
        ? lineBase - (totalGross > 0n && priorGross > 0n ? divideRoundHalfUp(lineBase * priorGross, totalGross) : 0n)
        : divideRoundHalfUp(lineBase * allocationPoisha, totalGross),
      vdsRateBps: bill.withholding_entity ? line.vds_rate_bps : 0,
      taxCategory: line.tax_category,
    };
  });
  if (lineShares.length > 0) {
    const sumShares = lineShares.reduce((sum, line) => sum + line.share, 0n);
    const delta = baseShare - sumShares;
    if (delta !== 0n) {
      // Absorb the rounding difference in the largest line so full payment reproduces the bill's
      // snapshotted base exactly and partial payment still totals the proportional base.
      let largest = 0;
      for (let index = 1; index < lineShares.length; index += 1) {
        if (lineShares[index]!.share > lineShares[largest]!.share) largest = index;
      }
      lineShares[largest]!.share += delta;
      if (lineShares[largest]!.share < 0n) {
        throw new AppError(
          409,
          'PURCHASE_PAYMENT_ALLOCATION_ROUNDING',
          'The allocation is too small to reproduce the bill base without a negative line share. Increase the payment amount.',
        );
      }
    }
  }
  const vdsLines: WithholdingComputation['vdsLines'] = [];
  let calculatedVdsTotal = 0n;
  for (const line of lineShares) {
    if (line.vdsRateBps <= 0 || line.share <= 0n) continue;
    const amount = divideRoundHalfUp(line.share * BigInt(line.vdsRateBps), 10_000n);
    if (amount <= 0n) continue;
    const existing = vdsLines.find(
      (entry) => entry.taxCategory === line.taxCategory && entry.rateBps === line.vdsRateBps,
    );
    if (existing) {
      existing.basePoisha += line.share;
      existing.amountPoisha += amount;
    } else {
      vdsLines.push({
        taxCategory: line.taxCategory,
        rateBps: line.vdsRateBps,
        basePoisha: line.share,
        amountPoisha: amount,
      });
    }
    calculatedVdsTotal += amount;
  }

  if (vdsLines.length > 0 && vdsThis > 0n && calculatedVdsTotal !== vdsThis) {
    const vdsDelta = vdsThis - calculatedVdsTotal;
    let largestVdsIdx = 0;
    for (let i = 1; i < vdsLines.length; i += 1) {
      if (vdsLines[i]!.amountPoisha > vdsLines[largestVdsIdx]!.amountPoisha) {
        largestVdsIdx = i;
      }
    }
    vdsLines[largestVdsIdx]!.amountPoisha += vdsDelta;
  }

  if (vdsThis + tdsThis > allocationPoisha) {
    throw new AppError(
      409,
      'PURCHASE_PAYMENT_WITHHOLDING_EXCEEDS_ALLOCATION',
      'The calculated VDS/TDS exceeds the amount allocated to the bill. Increase the payment allocation.',
    );
  }
  return {
    basePoisha: baseShare,
    vdsPoisha: vdsThis,
    tdsPoisha: tdsThis,
    cashPoisha: allocationPoisha - vdsThis - tdsThis,
    tdsRateBps,
    tdsNature: bill.tds_nature,
    vdsLines,
  };
}

export async function previewPurchasePayment(
  database: Queryable,
  companyId: string,
  input: {
    paymentDate: string;
    partyId: string;
    allocations: readonly PurchasePaymentAllocationInput[];
  },
): Promise<PaymentWithholdingPreviewDto> {
  if (!isValidIsoDate(input.paymentDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real payment date in YYYY-MM-DD format.');
  }
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new AppError(
      400,
      'PURCHASE_PAYMENT_ALLOCATIONS_REQUIRED',
      'Allocate the payment to at least one supplier bill.',
    );
  }
  if (input.allocations.length > 500) {
    throw new AppError(400, 'PURCHASE_PAYMENT_ALLOCATIONS_INVALID', 'A payment may allocate to at most 500 bills.');
  }
  const parsed = input.allocations.map((allocation) => ({
    documentId: allocation.documentId,
    amount: parsePositiveMoney(allocation.amount, 'Allocation amount'),
  }));
  const documentIds = [...new Set(parsed.map((entry) => entry.documentId))];
  if (documentIds.length !== parsed.length) {
    throw new AppError(400, 'PURCHASE_PAYMENT_DUPLICATE_BILL', 'Each supplier bill may appear only once in a payment.');
  }
  await loadSupplier(database, companyId, input.partyId);
  const bills = await loadBillsForPreview(database, companyId, input.partyId, documentIds);
  let totalAllocation = 0n;
  let totalVds = 0n;
  let totalTds = 0n;
  let totalCash = 0n;
  const lines: PaymentWithholdingPreviewLine[] = [];
  for (const allocation of parsed) {
    const bill = bills.get(allocation.documentId)!;
    const open = BigInt(bill.gross_poisha) - BigInt(bill.allocated_poisha);
    if (allocation.amount > open) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_OPEN',
        `Allocation to ${bill.document_no ?? bill.supplier_invoice_no} exceeds its open amount.`,
        { documentId: bill.id, openPoisha: open.toString(), requestedPoisha: allocation.amount.toString() },
      );
    }
    const withholding = await computeAllocationWithholding(database, companyId, bill, allocation.amount);
    totalAllocation += allocation.amount;
    totalVds += withholding.vdsPoisha;
    totalTds += withholding.tdsPoisha;
    totalCash += withholding.cashPoisha;
    lines.push({
      documentId: bill.id,
      documentNo: bill.document_no,
      allocationPoisha: allocation.amount.toString(),
      allocationBdt: formatPoishaAsBdt(allocation.amount),
      basePoisha: withholding.basePoisha.toString(),
      baseBdt: formatPoishaAsBdt(withholding.basePoisha),
      vdsPoisha: withholding.vdsPoisha.toString(),
      vdsBdt: formatPoishaAsBdt(withholding.vdsPoisha),
      tdsPoisha: withholding.tdsPoisha.toString(),
      tdsBdt: formatPoishaAsBdt(withholding.tdsPoisha),
      cashPoisha: withholding.cashPoisha.toString(),
      cashBdt: formatPoishaAsBdt(withholding.cashPoisha),
      tdsRateBps: withholding.tdsRateBps,
      tdsNature: withholding.tdsNature,
      vdsLines: withholding.vdsLines.map((entry) => ({
        taxCategory: entry.taxCategory,
        rateBps: entry.rateBps,
        basePoisha: entry.basePoisha.toString(),
        amountPoisha: entry.amountPoisha.toString(),
      })),
    });
  }
  return {
    allocations: lines,
    totalAllocationPoisha: totalAllocation.toString(),
    totalAllocationBdt: formatPoishaAsBdt(totalAllocation),
    totalVdsPoisha: totalVds.toString(),
    totalVdsBdt: formatPoishaAsBdt(totalVds),
    totalTdsPoisha: totalTds.toString(),
    totalTdsBdt: formatPoishaAsBdt(totalTds),
    totalCashPoisha: totalCash.toString(),
    totalCashBdt: formatPoishaAsBdt(totalCash),
  };
}

async function paymentById(database: Queryable, companyId: string, paymentId: string): Promise<PurchasePaymentDto> {
  const result = await database.query<{
    id: string;
    company_id: string;
    branch_id: string | null;
    status: string;
    payment_number: string;
    payment_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bank_account_id: string;
    bank_name: string;
    bank_kind: string;
    gl_code: string;
    amount_poisha: string;
    vds_poisha: string;
    tds_poisha: string;
    allocated_poisha: string;
    reference: string | null;
    attachment_reference: string | null;
    narration_en: string | null;
    narration_bn: string | null;
    journal_id: string | null;
    journal_number: string | null;
    reversal_journal_id: string | null;
    created_by: string;
    created_by_name: string;
    approved_by: string | null;
    approved_by_name: string | null;
    approved_at: Date | null;
    created_at: Date;
    reversed_at: Date | null;
    reversed_by_name: string | null;
  }>(
    `SELECT pay.id, pay.company_id, pay.branch_id, pay.status, pay.payment_number, pay.payment_date,
            pay.party_id, p.code AS party_code, p.name_en AS party_name_en,
            pay.bank_account_id, ba.name AS bank_name, ba.kind AS bank_kind, a.code AS gl_code,
            pay.amount_poisha::text AS amount_poisha, pay.vds_poisha::text AS vds_poisha,
            pay.tds_poisha::text AS tds_poisha, pay.allocated_poisha::text AS allocated_poisha,
            pay.reference, pay.attachment_reference, pay.narration_en, pay.narration_bn,
            pay.journal_id, j.journal_number, pay.reversal_journal_id, pay.created_by,
            cu.name AS created_by_name, pay.approved_by, au.name AS approved_by_name,
            pay.approved_at, pay.created_at, pay.reversed_at, ru.name AS reversed_by_name
       FROM purchase_payments pay
       JOIN parties p ON p.company_id = pay.company_id AND p.id = pay.party_id
       JOIN bank_accounts ba ON ba.company_id = pay.company_id AND ba.id = pay.bank_account_id
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
       JOIN users cu ON cu.id = pay.created_by
       LEFT JOIN users au ON au.id = pay.approved_by
       LEFT JOIN users ru ON ru.id = pay.reversed_by
       LEFT JOIN journals j ON j.company_id = pay.company_id AND j.id = pay.journal_id
      WHERE pay.company_id = $1 AND pay.id = $2`,
    [companyId, paymentId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found.');
  const allocations = await database.query<{
    id: string;
    document_id: string;
    document_no: string | null;
    supplier_invoice_no: string;
    doc_date: Date;
    due_date: Date;
    amount_poisha: string;
    base_poisha: string;
    vds_poisha: string;
    tds_poisha: string;
  }>(
    `SELECT al.id, al.document_id, d.document_no, d.supplier_invoice_no, d.doc_date, d.due_date,
            al.amount_poisha::text AS amount_poisha, al.base_poisha::text AS base_poisha,
            al.vds_poisha::text AS vds_poisha, al.tds_poisha::text AS tds_poisha
       FROM purchase_payment_allocations al
       JOIN purchase_documents d ON d.company_id = al.company_id AND d.id = al.document_id
      WHERE al.company_id = $1 AND al.payment_id = $2
      ORDER BY al.created_at ASC, al.id ASC`,
    [companyId, paymentId],
  );
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    status: row.status as 'POSTED' | 'REVERSED',
    paymentNumber: row.payment_number,
    paymentDate: formatDatabaseDate(row.payment_date),
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_name,
    bankKind: row.bank_kind,
    glAccountCode: row.gl_code,
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    vdsPoisha: row.vds_poisha,
    vdsBdt: formatPoishaAsBdt(row.vds_poisha),
    tdsPoisha: row.tds_poisha,
    tdsBdt: formatPoishaAsBdt(row.tds_poisha),
    allocatedPoisha: row.allocated_poisha,
    allocatedBdt: formatPoishaAsBdt(row.allocated_poisha),
    reference: row.reference,
    attachmentReference: row.attachment_reference,
    narrationEn: row.narration_en,
    narrationBn: row.narration_bn,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalJournalId: row.reversal_journal_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    allocations: allocations.rows.map((entry) => ({
      id: entry.id,
      documentId: entry.document_id,
      documentNo: entry.document_no,
      supplierInvoiceNo: entry.supplier_invoice_no,
      documentDate: formatDatabaseDate(entry.doc_date),
      dueDate: formatDatabaseDate(entry.due_date),
      amountPoisha: entry.amount_poisha,
      amountBdt: formatPoishaAsBdt(entry.amount_poisha),
      basePoisha: entry.base_poisha,
      baseBdt: formatPoishaAsBdt(entry.base_poisha),
      vdsPoisha: entry.vds_poisha,
      vdsBdt: formatPoishaAsBdt(entry.vds_poisha),
      tdsPoisha: entry.tds_poisha,
      tdsBdt: formatPoishaAsBdt(entry.tds_poisha),
    })),
  };
}

async function getPaymentApprovalThreshold(database: Queryable, companyId: string): Promise<bigint> {
  const result = await database.query<{ value_json: Record<string, unknown> | null }>(
    `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = 'approval_thresholds'`,
    [companyId],
  );
  const raw = result.rows[0]?.value_json?.paymentPoisha;
  return typeof raw === 'string' && /^[0-9]+$/.test(raw) ? BigInt(raw) : 0n;
}

interface PaymentApprovalSnapshot {
  payment: PurchasePaymentInput;
  snapshot: {
    totalAllocationPoisha: string;
    totalVdsPoisha: string;
    totalTdsPoisha: string;
    totalCashPoisha: string;
  };
}

function readApprovalSnapshot(value: unknown): PaymentApprovalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(500, 'PURCHASE_PAYMENT_APPROVAL_SNAPSHOT_INVALID', 'The payment approval snapshot is invalid.');
  }
  const record = value as Record<string, unknown>;
  const payment = record.payment;
  const snapshot = record.snapshot;
  if (!payment || typeof payment !== 'object' || Array.isArray(payment) || !snapshot) {
    throw new AppError(500, 'PURCHASE_PAYMENT_APPROVAL_SNAPSHOT_INVALID', 'The payment approval snapshot is invalid.');
  }
  return value as PaymentApprovalSnapshot;
}

async function preparePurchasePayment(
  client: PoolClient,
  companyId: string,
  payment: PurchasePaymentInput,
): Promise<PreparedPurchasePayment> {
  const paymentDate = payment.paymentDate;
  if (!isValidIsoDate(paymentDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real payment date in YYYY-MM-DD format.');
  }
  const cashAmount = parsePositiveMoney(payment.amount, 'Payment amount');
  if (!Array.isArray(payment.allocations) || payment.allocations.length === 0) {
    throw new AppError(
      400,
      'PURCHASE_PAYMENT_ALLOCATIONS_REQUIRED',
      'Allocate the payment to at least one supplier bill.',
    );
  }
  if (payment.allocations.length > 500) {
    throw new AppError(400, 'PURCHASE_PAYMENT_ALLOCATIONS_INVALID', 'A payment may allocate to at most 500 bills.');
  }
  const parsedAllocations = payment.allocations.map((allocation) => ({
    documentId: allocation.documentId,
    amount: parsePositiveMoney(allocation.amount, 'Allocation amount'),
  }));
  const documentIds = [...new Set(parsedAllocations.map((entry) => entry.documentId))];
  if (documentIds.length !== parsedAllocations.length) {
    throw new AppError(400, 'PURCHASE_PAYMENT_DUPLICATE_BILL', 'Each supplier bill may appear only once in a payment.');
  }

  const party = await loadSupplier(client, companyId, payment.partyId);
  await assertActiveBranch(client, companyId, payment.branchId);
  const bank = await loadBankAccount(client, companyId, payment.bankAccountId);
  const paymentReference = optionalText(payment.reference, 200, 'Payment reference');
  if (['BANK', 'MFS', 'CHEQUE'].includes(bank.kind) && !paymentReference) {
    throw new AppError(
      400,
      'PURCHASE_PAYMENT_REFERENCE_REQUIRED',
      'A bank/MFS/cheque payment needs a unique reference so duplicate postings can be detected.',
    );
  }
  const attachmentReference = optionalText(payment.attachmentReference, 500, 'Payment attachment reference');
  const narrationEn = optionalText(payment.narrationEn, 500, 'Payment narration');
  const narrationBn = optionalText(payment.narrationBn, 500, 'Bangla payment narration');
  const apAccount = await loadApControlAccount(client, companyId);
  const policy = await requireApprovedPurchaseTaxPolicy(client, companyId, paymentDate);
  const bills = await lockBills(client, companyId, party.id, documentIds);

  let totalAllocation = 0n;
  let totalVds = 0n;
  let totalTds = 0n;
  let totalCash = 0n;
  const computations: PreparedPurchasePayment['computations'] = [];
  for (const allocation of parsedAllocations) {
    const bill = bills.get(allocation.documentId)!;
    const open = BigInt(bill.gross_poisha) - BigInt(bill.allocated_poisha);
    if (allocation.amount > open) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_OPEN',
        `Allocation to ${bill.document_no ?? bill.supplier_invoice_no} exceeds its open amount.`,
        { documentId: bill.id, openPoisha: open.toString(), requestedPoisha: allocation.amount.toString() },
      );
    }
    const withholding = await computeAllocationWithholding(client, companyId, bill, allocation.amount);
    totalAllocation += allocation.amount;
    totalVds += withholding.vdsPoisha;
    totalTds += withholding.tdsPoisha;
    totalCash += withholding.cashPoisha;
    computations.push({ bill, allocation: allocation.amount, withholding });
  }
  if (totalCash !== cashAmount) {
    throw new AppError(
      409,
      'PURCHASE_PAYMENT_AMOUNT_MISMATCH',
      'The cash amount does not equal the gross allocation less the server-calculated VDS/TDS. Use the preview to refresh the amount.',
      {
        submittedCashPoisha: cashAmount.toString(),
        calculatedCashPoisha: totalCash.toString(),
        allocatedPoisha: totalAllocation.toString(),
        vdsPoisha: totalVds.toString(),
        tdsPoisha: totalTds.toString(),
      },
    );
  }

  const periodResult = await client.query<{
    fiscal_year_id: string;
    fiscal_start: Date;
    status: string;
    code: string;
  }>(
    `SELECT p.fiscal_year_id, fy.start_date AS fiscal_start, p.status, p.code
       FROM periods p
       JOIN fiscal_years fy ON fy.company_id = p.company_id AND fy.id = p.fiscal_year_id
      WHERE p.company_id = $1 AND p.start_date <= $2::date AND p.end_date >= $2::date
      LIMIT 1`,
    [companyId, paymentDate],
  );
  const period = periodResult.rows[0];
  if (!period) {
    throw new AppError(400, 'PERIOD_NOT_FOUND', `No accounting period is configured for ${paymentDate}.`);
  }
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'PERIOD_NOT_OPEN',
      `The period ${period.code} is ${period.status}; postings are accepted only in an OPEN period.`,
    );
  }
  return {
    party: { id: party.id, code: party.code, name_en: party.name_en },
    bank: { id: bank.id, name: bank.name, kind: bank.kind, gl_account_id: bank.gl_account_id, gl_code: bank.gl_code },
    apAccount,
    policy,
    paymentDate,
    paymentReference,
    attachmentReference,
    narrationEn,
    narrationBn,
    cashAmount,
    totalAllocation,
    totalVds,
    totalTds,
    totalCash,
    period,
    branchId: payment.branchId ?? null,
    computations,
  };
}

async function insertAndPostPurchasePayment(
  client: PoolClient,
  input: PurchaseAuditContext & { companyId: string },
  prepared: PreparedPurchasePayment,
  options: {
    paymentIdempotencyKey: string;
    approvalRequestId?: string;
    approvedBy?: string | null;
    createdBy?: string;
  },
): Promise<PurchasePaymentDto> {
  const paymentId = randomUUID();
  const paymentNumber = await allocatePaymentNumber(
    client,
    input.companyId,
    prepared.period.fiscal_year_id,
    prepared.period.fiscal_start,
  );
  const journalLines: JournalLineInput[] = [
    {
      accountId: prepared.apAccount.id,
      debit: formatPoishaAsBdt(prepared.totalAllocation),
      credit: '0',
      partyReference: prepared.party.code,
      partyName: prepared.party.name_en,
      memo: 'Trade payable cleared',
    },
  ];
  if (prepared.totalCash > 0n) {
    journalLines.push({
      accountId: prepared.bank.gl_account_id,
      debit: '0',
      credit: formatPoishaAsBdt(prepared.totalCash),
      partyReference: prepared.party.code,
      partyName: prepared.party.name_en,
      memo: 'Supplier payment from bank/cash',
    });
  }
  if (prepared.totalVds > 0n) {
    journalLines.push({
      accountId: prepared.policy.vdsPayableAccountId,
      debit: '0',
      credit: formatPoishaAsBdt(prepared.totalVds),
      partyReference: prepared.party.code,
      partyName: prepared.party.name_en,
      memo: 'VDS withheld payable',
    });
  }
  if (prepared.totalTds > 0n) {
    journalLines.push({
      accountId: prepared.policy.tdsPayableAccountId,
      debit: '0',
      credit: formatPoishaAsBdt(prepared.totalTds),
      partyReference: prepared.party.code,
      partyName: prepared.party.name_en,
      memo: 'TDS withheld payable',
    });
  }
  assertBalancedJournal(journalLines);

  const journal = await postSystemJournalWithinTransaction(client, {
    ...auditBase(input, input.companyId),
    companyId: input.companyId,
    branchId: prepared.branchId,
    date: prepared.paymentDate,
    narration: `Supplier payment ${paymentNumber} — ${prepared.party.name_en}`,
    sourceModule: 'PURCHASES',
    sourceDocId: paymentId,
    sourceDocRef: paymentNumber,
    idempotencyKey: options.paymentIdempotencyKey,
    lines: journalLines,
  });

  try {
    await client.query(
      `INSERT INTO purchase_payments (
         id, company_id, branch_id, status, payment_number, payment_date, party_id,
         bank_account_id, amount_poisha, vds_poisha, tds_poisha, allocated_poisha,
         reference, attachment_reference, narration_en, narration_bn, journal_id,
         idempotency_key, created_by, approved_by, approved_at
       ) VALUES ($1,$2,$3,'POSTED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        paymentId,
        input.companyId,
        prepared.branchId,
        paymentNumber,
        prepared.paymentDate,
        prepared.party.id,
        prepared.bank.id,
        prepared.totalCash.toString(),
        prepared.totalVds.toString(),
        prepared.totalTds.toString(),
        prepared.totalAllocation.toString(),
        prepared.paymentReference,
        prepared.attachmentReference,
        prepared.narrationEn,
        prepared.narrationBn,
        journal.id,
        options.paymentIdempotencyKey,
        options.createdBy ?? input.actorUserId,
        options.approvedBy ?? null,
        options.approvedBy ? new Date() : null,
      ],
    );
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint?.includes('purchase_payments_bank_reference_unique')) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_REFERENCE_DUPLICATE',
        'A posted payment with this bank/cash reference already exists. Check the bank statement before retrying.',
      );
    }
    if (pgError.code === '23505' && pgError.constraint?.includes('idempotency')) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another payment.');
    }
    if (pgError.code === '23505' && pgError.constraint?.includes('number')) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_NUMBER_CONFLICT',
        'The payment-number sequence points at an existing number. Repair the sequence; numbers are never reused.',
      );
    }
    throw error;
  }

  for (const entry of prepared.computations) {
    const allocationId = randomUUID();
    await client.query(
      `INSERT INTO purchase_payment_allocations (
         id, company_id, payment_id, document_id, amount_poisha, base_poisha,
         vds_poisha, tds_poisha, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        allocationId,
        input.companyId,
        paymentId,
        entry.bill.id,
        entry.allocation.toString(),
        entry.withholding.basePoisha.toString(),
        entry.withholding.vdsPoisha.toString(),
        entry.withholding.tdsPoisha.toString(),
        options.createdBy ?? input.actorUserId,
      ],
    );
    const periodCode = prepared.paymentDate.slice(0, 7);
    for (const vds of entry.withholding.vdsLines) {
      await client.query(
        `INSERT INTO purchase_withholding_liabilities (
           company_id, source_type, bill_id, payment_id, allocation_id, party_id, tax_type,
           tax_period, base_poisha, rate_bps, amount_poisha, status, journal_id, created_by
         ) VALUES ($1,'PAYMENT',$2,$3,$4,$5,'VDS',$6,$7,$8,$9,'PENDING',$10,$11)`,
        [
          input.companyId,
          entry.bill.id,
          paymentId,
          allocationId,
          prepared.party.id,
          periodCode,
          vds.basePoisha.toString(),
          vds.rateBps,
          vds.amountPoisha.toString(),
          journal.id,
          options.createdBy ?? input.actorUserId,
        ],
      );
    }
    if (entry.withholding.tdsPoisha > 0n) {
      await client.query(
        `INSERT INTO purchase_withholding_liabilities (
           company_id, source_type, bill_id, payment_id, allocation_id, party_id, tax_type,
           tax_period, base_poisha, rate_bps, amount_poisha, status, journal_id, created_by
         ) VALUES ($1,'PAYMENT',$2,$3,$4,$5,'TDS',$6,$7,$8,$9,'PENDING',$10,$11)`,
        [
          input.companyId,
          entry.bill.id,
          paymentId,
          allocationId,
          prepared.party.id,
          periodCode,
          entry.withholding.basePoisha.toString(),
          entry.withholding.tdsRateBps,
          entry.withholding.tdsPoisha.toString(),
          journal.id,
          options.createdBy ?? input.actorUserId,
        ],
      );
    }
  }

  await writeAuditEvent(client, {
    ...auditBase(input, input.companyId),
    action: 'purchases.payment_posted',
    entityType: 'purchase_payment',
    entityId: paymentId,
    after: {
      paymentNumber,
      partyId: prepared.party.id,
      cashPoisha: prepared.totalCash.toString(),
      allocatedPoisha: prepared.totalAllocation.toString(),
      vdsPoisha: prepared.totalVds.toString(),
      tdsPoisha: prepared.totalTds.toString(),
      journalId: journal.id,
      journalNumber: journal.journalNumber,
      approvalRequestId: options.approvalRequestId ?? null,
      approvedBy: options.approvedBy ?? null,
      allocations: prepared.computations.map((entry) => ({
        documentId: entry.bill.id,
        amountPoisha: entry.allocation.toString(),
        basePoisha: entry.withholding.basePoisha.toString(),
        vdsPoisha: entry.withholding.vdsPoisha.toString(),
        tdsPoisha: entry.withholding.tdsPoisha.toString(),
      })),
    },
    reason: options.approvalRequestId
      ? 'Supplier payment approved by a different controller and posted with AP allocations and withholding liabilities.'
      : 'Supplier payment posted with AP allocations and withholding liabilities in one transaction.',
  });
  return paymentById(client, input.companyId, paymentId);
}

export type PostPurchasePaymentResult =
  | { payment: PurchasePaymentDto; replayed: boolean; approvalRequest?: undefined }
  | { approvalRequest: PurchasePaymentApprovalDto; replayed: boolean; payment?: undefined };

export async function postPurchasePayment(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    idempotencyKey: string;
    payment: PurchasePaymentInput;
  },
): Promise<PostPurchasePaymentResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required for a supplier payment.',
    );
  }
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `purchase-payment:${input.companyId}:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM purchase_payments WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { payment: await paymentById(client, input.companyId, existing.rows[0].id), replayed: true };
    }
    const existingApproval = await client.query<{ id: string; status: string; payment_id: string | null }>(
      `SELECT id, status, payment_id FROM purchase_payment_approval_requests
        WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    const approval = existingApproval.rows[0];
    if (approval) {
      if (approval.status === 'PENDING') {
        return {
          approvalRequest: await paymentApprovalById(client, input.companyId, approval.id),
          replayed: true,
        };
      }
      if (approval.status === 'POSTED' && approval.payment_id) {
        return { payment: await paymentById(client, input.companyId, approval.payment_id), replayed: true };
      }
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_APPROVAL_REJECTED',
        'The payment approval request with this Idempotency-Key was rejected. Start a new request with a new key after correcting it.',
      );
    }

    const prepared = await preparePurchasePayment(client, input.companyId, input.payment);
    const threshold = await getPaymentApprovalThreshold(client, input.companyId);
    if (threshold > 0n && prepared.totalCash >= threshold) {
      const requestId = randomUUID();
      const snapshot: PaymentApprovalSnapshot = {
        payment: {
          paymentDate: prepared.paymentDate,
          partyId: prepared.party.id,
          branchId: prepared.branchId,
          bankAccountId: prepared.bank.id,
          amount: formatPoishaAsBdt(prepared.cashAmount),
          reference: prepared.paymentReference,
          attachmentReference: prepared.attachmentReference,
          narrationEn: prepared.narrationEn,
          narrationBn: prepared.narrationBn,
          allocations: prepared.computations.map((entry) => ({
            documentId: entry.bill.id,
            amount: formatPoishaAsBdt(entry.allocation),
          })),
        },
        snapshot: {
          totalAllocationPoisha: prepared.totalAllocation.toString(),
          totalVdsPoisha: prepared.totalVds.toString(),
          totalTdsPoisha: prepared.totalTds.toString(),
          totalCashPoisha: prepared.totalCash.toString(),
        },
      };
      await client.query(
        `INSERT INTO purchase_payment_approval_requests (
           id, company_id, status, request_json, cash_poisha, vds_poisha, tds_poisha,
           allocated_poisha, requested_by, idempotency_key
         ) VALUES ($1,$2,'PENDING',$3::jsonb,$4,$5,$6,$7,$8,$9)`,
        [
          requestId,
          input.companyId,
          JSON.stringify(snapshot),
          prepared.totalCash.toString(),
          prepared.totalVds.toString(),
          prepared.totalTds.toString(),
          prepared.totalAllocation.toString(),
          input.actorUserId,
          input.idempotencyKey,
        ],
      );
      await writeAuditEvent(client, {
        ...auditBase(input, input.companyId),
        action: 'purchases.payment_approval_requested',
        entityType: 'purchase_payment_approval',
        entityId: requestId,
        after: {
          cashPoisha: prepared.totalCash.toString(),
          vdsPoisha: prepared.totalVds.toString(),
          tdsPoisha: prepared.totalTds.toString(),
          allocatedPoisha: prepared.totalAllocation.toString(),
          thresholdPoisha: threshold.toString(),
          allocations: snapshot.payment.allocations,
        },
        reason:
          'Supplier payment reached the configured payment approval threshold; a different controller must approve it.',
      });
      return {
        approvalRequest: await paymentApprovalById(client, input.companyId, requestId),
        replayed: false,
      };
    }

    const payment = await insertAndPostPurchasePayment(client, input, prepared, {
      paymentIdempotencyKey: input.idempotencyKey,
    });
    return { payment, replayed: false };
  });
}

async function paymentApprovalById(
  database: Queryable,
  companyId: string,
  requestId: string,
): Promise<PurchasePaymentApprovalDto> {
  const result = await database.query<{
    id: string;
    company_id: string;
    status: 'PENDING' | 'REJECTED' | 'POSTED';
    cash_poisha: string;
    vds_poisha: string;
    tds_poisha: string;
    allocated_poisha: string;
    requested_by: string;
    requested_by_name: string;
    requested_at: Date;
    decided_by: string | null;
    decided_by_name: string | null;
    decided_at: Date | null;
    decision_reason: string | null;
    payment_id: string | null;
    payment_number: string | null;
    payment_date: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bank_account_id: string;
    bank_name: string;
    reference: string | null;
  }>(
    `SELECT r.id, r.company_id, r.status, r.cash_poisha::text AS cash_poisha,
            r.vds_poisha::text AS vds_poisha, r.tds_poisha::text AS tds_poisha,
            r.allocated_poisha::text AS allocated_poisha, r.requested_by,
            requester.name AS requested_by_name, r.requested_at, r.decided_by,
            decider.name AS decided_by_name, r.decided_at, r.decision_reason,
            r.payment_id, pay.payment_number, r.request_json->'payment'->>'paymentDate' AS payment_date,
            p.id AS party_id, p.code AS party_code, p.name_en AS party_name_en,
            ba.id AS bank_account_id, ba.name AS bank_name,
            r.request_json->'payment'->>'reference' AS reference
       FROM purchase_payment_approval_requests r
       JOIN users requester ON requester.id = r.requested_by
       JOIN parties p ON p.company_id = r.company_id
        AND p.id = (r.request_json->'payment'->>'partyId')::uuid
       JOIN bank_accounts ba ON ba.company_id = r.company_id
        AND ba.id = (r.request_json->'payment'->>'bankAccountId')::uuid
       LEFT JOIN users decider ON decider.id = r.decided_by
       LEFT JOIN purchase_payments pay ON pay.company_id = r.company_id AND pay.id = r.payment_id
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, requestId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PURCHASE_PAYMENT_APPROVAL_NOT_FOUND', 'Payment approval request not found.');
  return {
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    paymentDate: row.payment_date,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_name,
    amountPoisha: row.cash_poisha,
    amountBdt: formatPoishaAsBdt(row.cash_poisha),
    vdsPoisha: row.vds_poisha,
    vdsBdt: formatPoishaAsBdt(row.vds_poisha),
    tdsPoisha: row.tds_poisha,
    tdsBdt: formatPoishaAsBdt(row.tds_poisha),
    allocatedPoisha: row.allocated_poisha,
    allocatedBdt: formatPoishaAsBdt(row.allocated_poisha),
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionReason: row.decision_reason,
    paymentId: row.payment_id,
    paymentNumber: row.payment_number,
    reference: row.reference,
  };
}

export async function listPurchasePaymentApprovals(
  database: Queryable,
  companyId: string,
  filters: { status?: 'PENDING' | 'REJECTED' | 'POSTED'; limit?: number; offset?: number } = {},
): Promise<{ entries: PurchasePaymentApprovalDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['r.company_id = $1'];
  if (filters.status) {
    params.push(filters.status);
    where.push(`r.status = $${params.length}`);
  }
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM purchase_payment_approval_requests r WHERE ${where.join(' AND ')}`,
    params,
  );
  const ids = await database.query<{ id: string }>(
    `SELECT r.id FROM purchase_payment_approval_requests r
      WHERE ${where.join(' AND ')}
      ORDER BY r.requested_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const entries: PurchasePaymentApprovalDto[] = [];
  for (const row of ids.rows) entries.push(await paymentApprovalById(database, companyId, row.id));
  return { entries, total: Number(count.rows[0]?.total ?? 0), limit, offset };
}

export async function getPurchasePaymentApproval(
  database: Queryable,
  companyId: string,
  requestId: string,
): Promise<PurchasePaymentApprovalDto> {
  return paymentApprovalById(database, companyId, requestId);
}

export async function approvePurchasePayment(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    approvalRequestId: string;
    reason?: string | null;
  },
): Promise<PurchasePaymentDto> {
  const reason = optionalText(input.reason, 500, 'Approval reason') ?? 'Approved after maker-checker review.';
  if (reason.length < 3) {
    throw new AppError(
      400,
      'PURCHASE_APPROVAL_REASON_REQUIRED',
      'An approval reason of at least 3 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query<{
      id: string;
      status: 'PENDING' | 'REJECTED' | 'POSTED';
      request_json: unknown;
      cash_poisha: string;
      vds_poisha: string;
      tds_poisha: string;
      allocated_poisha: string;
      requested_by: string;
      payment_id: string | null;
    }>(
      `SELECT id, status, request_json, cash_poisha::text AS cash_poisha,
              vds_poisha::text AS vds_poisha, tds_poisha::text AS tds_poisha,
              allocated_poisha::text AS allocated_poisha, requested_by, payment_id
         FROM purchase_payment_approval_requests
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.approvalRequestId],
    );
    const request = result.rows[0];
    if (!request) throw new AppError(404, 'PURCHASE_PAYMENT_APPROVAL_NOT_FOUND', 'Payment approval request not found.');
    if (request.status === 'POSTED' && request.payment_id) {
      return paymentById(client, input.companyId, request.payment_id);
    }
    if (request.status !== 'PENDING') {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_APPROVAL_NOT_PENDING',
        `This payment approval request is ${request.status} and cannot be approved.`,
      );
    }
    if (request.requested_by === input.actorUserId) {
      throw new AppError(
        403,
        'PURCHASE_PAYMENT_SELF_APPROVAL',
        'The maker cannot approve their own payment. Ask a different controller or administrator.',
      );
    }
    const snapshot = readApprovalSnapshot(request.request_json);
    const prepared = await preparePurchasePayment(client, input.companyId, snapshot.payment);
    if (
      prepared.totalCash !== BigInt(request.cash_poisha) ||
      prepared.totalVds !== BigInt(request.vds_poisha) ||
      prepared.totalTds !== BigInt(request.tds_poisha) ||
      prepared.totalAllocation !== BigInt(request.allocated_poisha)
    ) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_APPROVAL_SNAPSHOT_STALE',
        'The bill, withholding or payment amount changed after this request was made. Reject it and create a fresh payment request.',
      );
    }
    const payment = await insertAndPostPurchasePayment(client, input, prepared, {
      paymentIdempotencyKey: `PAYMENT-APPROVAL:${request.id}`,
      approvalRequestId: request.id,
      approvedBy: input.actorUserId,
      createdBy: request.requested_by,
    });
    const updated = await client.query(
      `UPDATE purchase_payment_approval_requests
          SET status = 'POSTED', decided_by = $3, decided_at = now(), decision_reason = $4, payment_id = $5
        WHERE company_id = $1 AND id = $2 AND status = 'PENDING'`,
      [input.companyId, request.id, input.actorUserId, reason, payment.id],
    );
    if (updated.rowCount !== 1) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_APPROVAL_CONFLICT',
        'The approval request changed while it was being approved.',
      );
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.payment_approval_approved',
      entityType: 'purchase_payment_approval',
      entityId: request.id,
      before: { status: 'PENDING' },
      after: { status: 'POSTED', paymentId: payment.id, paymentNumber: payment.paymentNumber, reason },
      reason,
    });
    return payment;
  });
}

export async function rejectPurchasePayment(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    approvalRequestId: string;
    reason: string;
  },
): Promise<PurchasePaymentApprovalDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PURCHASE_APPROVAL_REASON_REQUIRED',
      'A rejection reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; status: string; requested_by: string }>(
      `SELECT id, status, requested_by FROM purchase_payment_approval_requests
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.approvalRequestId],
    );
    const request = result.rows[0];
    if (!request) throw new AppError(404, 'PURCHASE_PAYMENT_APPROVAL_NOT_FOUND', 'Payment approval request not found.');
    if (request.status !== 'PENDING') {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_APPROVAL_NOT_PENDING',
        `This payment approval request is ${request.status} and cannot be rejected.`,
      );
    }
    if (request.requested_by === input.actorUserId) {
      throw new AppError(
        403,
        'PURCHASE_PAYMENT_SELF_APPROVAL',
        'The maker cannot decide their own payment. Ask a different controller or administrator.',
      );
    }
    await client.query(
      `UPDATE purchase_payment_approval_requests
          SET status = 'REJECTED', decided_by = $3, decided_at = now(), decision_reason = $4
        WHERE company_id = $1 AND id = $2 AND status = 'PENDING'`,
      [input.companyId, request.id, input.actorUserId, reason],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.payment_approval_rejected',
      entityType: 'purchase_payment_approval',
      entityId: request.id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', reason },
      reason,
    });
    return paymentApprovalById(client, input.companyId, request.id);
  });
}

async function allocatePaymentNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  fiscalStart: Date,
): Promise<string> {
  const result = await client.query<{ id: string; prefix: string; pad: number; next_value: string }>(
    `SELECT id, prefix, pad, next_value::text AS next_value
       FROM number_sequences
      WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = 'PAYMENT'
      FOR UPDATE`,
    [companyId, fiscalYearId],
  );
  const sequence = result.rows[0];
  if (!sequence) {
    throw new AppError(
      409,
      'PURCHASE_SEQUENCE_MISSING',
      'The PAYMENT number sequence is not configured for this fiscal year. Repair the fiscal-year numbering setup.',
    );
  }
  const value = BigInt(sequence.next_value);
  const year = formatDatabaseDate(fiscalStart).slice(0, 4);
  const number = `${sequence.prefix}${year}-${value.toString().padStart(sequence.pad, '0')}`;
  await client.query(
    `UPDATE number_sequences SET next_value = $3, version = version + 1 WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

function assertBalancedJournal(lines: readonly JournalLineInput[]): void {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    debit += parseBdtToPoisha(line.debit) ?? 0n;
    credit += parseBdtToPoisha(line.credit) ?? 0n;
  }
  if (debit !== credit || debit <= 0n) {
    throw new AppError(
      500,
      'PURCHASE_PAYMENT_JOURNAL_UNBALANCED',
      'The calculated supplier-payment journal did not balance; posting was rolled back.',
    );
  }
}

export async function reversePurchasePayment(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    paymentId: string;
    date: string;
    reason: string;
  },
): Promise<PurchasePaymentDto> {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PURCHASE_REVERSAL_REASON_REQUIRED',
      'A reversal reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; status: string; journal_id: string | null }>(
      `SELECT id, status, journal_id FROM purchase_payments WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.paymentId],
    );
    const payment = result.rows[0];
    if (!payment) throw new AppError(404, 'PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found.');
    if (payment.status === 'REVERSED') {
      throw new AppError(409, 'PURCHASE_PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.');
    }
    if (!payment.journal_id) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_JOURNAL_MISSING',
        'The payment journal could not be found; reversal was rolled back.',
      );
    }
    const deposited = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND payment_id = $2 AND status = 'DEPOSITED'`,
      [input.companyId, input.paymentId],
    );
    if (Number(deposited.rows[0]?.count ?? 0) > 0) {
      throw new AppError(
        409,
        'PURCHASE_PAYMENT_WITHHOLDING_DEPOSITED',
        'The withholding from this payment has already been deposited. Correct it through the Treasury process instead of reversing the payment.',
      );
    }
    const reversed = await reverseJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      journalId: payment.journal_id,
      date: input.date,
      reason,
    });
    await client.query(
      `UPDATE purchase_withholding_liabilities
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3
        WHERE company_id = $1 AND payment_id = $2 AND status = 'PENDING'`,
      [input.companyId, input.paymentId, input.actorUserId],
    );
    await client.query(
      `UPDATE purchase_payments
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3,
              reversal_journal_id = $4, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, input.paymentId, input.actorUserId, reversed.reversal.id],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.payment_reversed',
      entityType: 'purchase_payment',
      entityId: input.paymentId,
      before: { status: 'POSTED', journalId: payment.journal_id },
      after: { status: 'REVERSED', reversalJournalId: reversed.reversal.id, reason },
      reason,
    });
    return paymentById(client, input.companyId, input.paymentId);
  });
}

export async function listPurchasePayments(
  database: Queryable,
  companyId: string,
  filters: {
    partyId?: string;
    from?: string;
    to?: string;
    status?: 'POSTED' | 'REVERSED';
    limit?: number;
    offset?: number;
  },
): Promise<{ entries: PurchasePaymentSummaryDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['pay.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.partyId) add('pay.party_id = ?', filters.partyId);
  if (filters.from) add('pay.payment_date >= ?::date', filters.from);
  if (filters.to) add('pay.payment_date <= ?::date', filters.to);
  if (filters.status) add('pay.status = ?', filters.status);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM purchase_payments pay WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, offset);
  const result = await database.query<{
    id: string;
    status: string;
    payment_number: string;
    payment_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bank_name: string;
    amount_poisha: string;
    allocated_poisha: string;
    reference: string | null;
    created_at: Date;
  }>(
    `SELECT pay.id, pay.status, pay.payment_number, pay.payment_date, pay.party_id,
            p.code AS party_code, p.name_en AS party_name_en, ba.name AS bank_name,
            pay.amount_poisha::text AS amount_poisha, pay.allocated_poisha::text AS allocated_poisha,
            pay.reference, pay.created_at
       FROM purchase_payments pay
       JOIN parties p ON p.company_id = pay.company_id AND p.id = pay.party_id
       JOIN bank_accounts ba ON ba.company_id = pay.company_id AND ba.id = pay.bank_account_id
      WHERE ${where.join(' AND ')}
      ORDER BY pay.payment_date DESC, pay.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      status: row.status as 'POSTED' | 'REVERSED',
      paymentNumber: row.payment_number,
      paymentDate: formatDatabaseDate(row.payment_date),
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      bankName: row.bank_name,
      amountPoisha: row.amount_poisha,
      amountBdt: formatPoishaAsBdt(row.amount_poisha),
      allocatedPoisha: row.allocated_poisha,
      allocatedBdt: formatPoishaAsBdt(row.allocated_poisha),
      reference: row.reference,
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(count.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getPurchasePayment(
  database: Queryable,
  companyId: string,
  paymentId: string,
): Promise<PurchasePaymentDto> {
  return paymentById(database, companyId, paymentId);
}

export async function listOpenBills(
  database: Queryable,
  companyId: string,
  filters: { partyId?: string; asOf?: string } = {},
): Promise<OpenBillDto[]> {
  const asOf = filters.asOf ?? new Date().toISOString().slice(0, 10);
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real as-of date in YYYY-MM-DD format.');
  const params: unknown[] = [companyId, asOf];
  let partyFilter = '';
  if (filters.partyId) {
    params.push(filters.partyId);
    partyFilter = ` AND d.party_id = $${params.length}`;
  }
  const result = await database.query<{
    document_id: string;
    doc_type: string;
    document_no: string | null;
    supplier_invoice_no: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    doc_date: Date;
    due_date: Date;
    gross_poisha: string;
    allocated_poisha: string;
    outstanding_poisha: string;
    expected_withholding_poisha: string;
    supplier_tin_missing: boolean;
  }>(
    `SELECT d.id AS document_id, d.doc_type, d.document_no, d.supplier_invoice_no, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, d.doc_date, d.due_date,
            d.gross_poisha::text AS gross_poisha,
            COALESCE(a.allocated_poisha, 0)::bigint::text AS allocated_poisha,
            (d.gross_poisha - COALESCE(a.allocated_poisha, 0))::bigint::text AS outstanding_poisha,
            (CASE WHEN d.gross_poisha > 0
                 THEN ROUND(((d.vds_poisha + d.tds_poisha)::numeric
                   * (d.gross_poisha - COALESCE(a.allocated_poisha, 0))::numeric) / d.gross_poisha::numeric)
                 ELSE 0 END)::bigint::text AS expected_withholding_poisha,
            d.supplier_tin_missing
       FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       LEFT JOIN (
         SELECT al.company_id, al.document_id, sum(al.amount_poisha) AS allocated_poisha
           FROM purchase_payment_allocations al
           JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
          WHERE pay.status = 'POSTED' AND pay.payment_date <= $2::date
          GROUP BY al.company_id, al.document_id
       ) a ON a.company_id = d.company_id AND a.document_id = d.id
      WHERE d.company_id = $1 AND d.status = 'POSTED' AND d.doc_date <= $2::date
        AND (d.gross_poisha - COALESCE(a.allocated_poisha, 0)) > 0${partyFilter}
      ORDER BY d.due_date ASC, d.document_no ASC`,
    params,
  );
  return result.rows.map((row) => ({
    documentId: row.document_id,
    docType: row.doc_type,
    documentNo: row.document_no,
    supplierInvoiceNo: row.supplier_invoice_no,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    docDate: formatDatabaseDate(row.doc_date),
    dueDate: formatDatabaseDate(row.due_date),
    grossPoisha: row.gross_poisha,
    grossBdt: formatPoishaAsBdt(row.gross_poisha),
    allocatedPoisha: row.allocated_poisha,
    allocatedBdt: formatPoishaAsBdt(row.allocated_poisha),
    outstandingPoisha: row.outstanding_poisha,
    outstandingBdt: formatPoishaAsBdt(row.outstanding_poisha),
    expectedWithholdingPoisha: row.expected_withholding_poisha,
    expectedWithholdingBdt: formatPoishaAsBdt(row.expected_withholding_poisha),
    supplierTinMissing: row.supplier_tin_missing,
  }));
}

export async function getApAgeing(
  database: Queryable,
  companyId: string,
  asOf: string,
  partyId?: string,
  branchId?: string | null,
): Promise<ApAgeingDto> {
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real ageing date in YYYY-MM-DD format.');
  const params: unknown[] = [companyId, asOf];
  let partyFilter = '';
  if (partyId) {
    params.push(partyId);
    partyFilter = ` AND d.party_id = $${params.length}`;
  }
  let branchFilter = '';
  if (branchId === 'UNASSIGNED') {
    branchFilter = ' AND d.branch_id IS NULL';
  } else if (branchId) {
    params.push(branchId);
    branchFilter = ` AND d.branch_id = $${params.length}`;
  }
  const open = await database.query<{
    document_id: string;
    doc_type: string;
    document_no: string | null;
    supplier_invoice_no: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    doc_date: Date;
    due_date: Date;
    gross_poisha: string;
    allocated_poisha: string;
    outstanding_poisha: string;
    expected_withholding_poisha: string;
    supplier_tin_missing: boolean;
  }>(
    `SELECT d.id AS document_id, d.doc_type, d.document_no, d.supplier_invoice_no, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, d.doc_date, d.due_date,
            d.gross_poisha::text AS gross_poisha,
            COALESCE(a.allocated_poisha, 0)::bigint::text AS allocated_poisha,
            (d.gross_poisha - COALESCE(a.allocated_poisha, 0))::bigint::text AS outstanding_poisha,
            (CASE WHEN d.gross_poisha > 0
                 THEN ROUND(((d.vds_poisha + d.tds_poisha)::numeric
                   * (d.gross_poisha - COALESCE(a.allocated_poisha, 0))::numeric) / d.gross_poisha::numeric)
                 ELSE 0 END)::bigint::text AS expected_withholding_poisha,
            d.supplier_tin_missing
       FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       LEFT JOIN (
         SELECT al.company_id, al.document_id, sum(al.amount_poisha) AS allocated_poisha
           FROM purchase_payment_allocations al
           JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
          WHERE pay.status = 'POSTED' AND pay.payment_date <= $2::date
          GROUP BY al.company_id, al.document_id
       ) a ON a.company_id = d.company_id AND a.document_id = d.id
      WHERE d.company_id = $1 AND d.status = 'POSTED' AND d.doc_date <= $2::date
        AND (d.gross_poisha - COALESCE(a.allocated_poisha, 0)) <> 0${partyFilter}${branchFilter}
      ORDER BY p.name_en ASC, d.due_date ASC, d.document_no ASC`,
    params,
  );
  const rows: ApAgeingRowDto[] = open.rows.map((row) => {
    const daysOverdue = daysBetween(formatDatabaseDate(row.due_date), asOf);
    return {
      documentId: row.document_id,
      documentNo: row.document_no,
      supplierInvoiceNo: row.supplier_invoice_no,
      docType: row.doc_type,
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      docDate: formatDatabaseDate(row.doc_date),
      dueDate: formatDatabaseDate(row.due_date),
      grossPoisha: row.gross_poisha,
      grossBdt: formatPoishaAsBdt(row.gross_poisha),
      allocatedPoisha: row.allocated_poisha,
      allocatedBdt: formatPoishaAsBdt(row.allocated_poisha),
      outstandingPoisha: row.outstanding_poisha,
      outstandingBdt: formatPoishaAsBdt(row.outstanding_poisha),
      expectedWithholdingPoisha: row.expected_withholding_poisha,
      expectedWithholdingBdt: formatPoishaAsBdt(row.expected_withholding_poisha),
      supplierTinMissing: row.supplier_tin_missing,
      daysOverdue,
      bucket: bucketFor(daysOverdue),
    };
  });
  const totals: Record<ApBucket | 'NET', string> = {
    CURRENT: '0',
    '1_30': '0',
    '31_60': '0',
    '61_90': '0',
    '91_180': '0',
    OVER_180: '0',
    NET: '0',
  };
  let net = 0n;
  for (const row of rows) {
    const amount = BigInt(row.outstandingPoisha);
    net += amount;
    totals[row.bucket] = (BigInt(totals[row.bucket]) + amount).toString();
  }
  totals.NET = net.toString();
  if (partyId) {
    const global = await getApAgeing(database, companyId, asOf, undefined, branchId);
    return { asOf, currency: 'BDT', rows, totals, proof: global.proof };
  }
  const apAccount = await loadApControlAccount(database, companyId);
  const glValues: unknown[] = [companyId, apAccount.id, asOf];
  let glBranchFilter = '';
  if (branchId === 'UNASSIGNED') {
    glBranchFilter = 'AND j.branch_id IS NULL';
  } else if (branchId) {
    glValues.push(branchId);
    glBranchFilter = `AND j.branch_id = $${glValues.length}`;
  }
  const gl = await database.query<{ balance: string }>(
    `SELECT COALESCE(sum(l.credit_poisha - l.debit_poisha), 0)::bigint::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND j.posting_date <= $3::date
        AND j.status IN ('POSTED', 'REVERSED') ${glBranchFilter}`,
    glValues,
  );
  const glBalance = BigInt(gl.rows[0]?.balance ?? '0');
  const difference = net - glBalance;
  return {
    asOf,
    currency: 'BDT',
    rows,
    totals,
    proof: {
      controlAccountId: apAccount.id,
      controlAccountCode: apAccount.code,
      controlAccountName: apAccount.name_en,
      glBalancePoisha: glBalance.toString(),
      glBalanceBdt: formatPoishaAsBdt(glBalance),
      subledgerPoisha: net.toString(),
      subledgerBdt: formatPoishaAsBdt(net),
      differencePoisha: difference.toString(),
      differenceBdt: formatPoishaAsBdt(difference),
      agrees: difference === 0n,
    },
  };
}

export async function getSupplierStatement(
  database: Queryable,
  companyId: string,
  partyId: string,
  from: string,
  to: string,
): Promise<SupplierStatementDto> {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    throw new AppError(400, 'INVALID_DATE', 'Choose a valid statement date range.');
  }
  const party = await database.query<{ id: string; code: string; name_en: string; name_bn: string | null }>(
    `SELECT id, code, name_en, name_bn FROM parties WHERE company_id = $1 AND id = $2`,
    [companyId, partyId],
  );
  const row = party.rows[0];
  if (!row) throw new AppError(404, 'PURCHASE_PARTY_NOT_FOUND', 'Supplier not found.');
  const before = await database.query<{ bills: string; payments: string }>(
    `SELECT
       COALESCE((SELECT sum(gross_poisha) FROM purchase_documents
                  WHERE company_id = $1 AND party_id = $2 AND status = 'POSTED'
                    AND doc_date < $3::date), 0)::bigint::text AS bills,
       COALESCE((SELECT sum(al.amount_poisha) FROM purchase_payment_allocations al
                  JOIN purchase_payments pay ON pay.company_id = al.company_id AND pay.id = al.payment_id
                  JOIN purchase_documents d ON d.company_id = al.company_id AND d.id = al.document_id
                 WHERE al.company_id = $1 AND d.party_id = $2 AND pay.status = 'POSTED'
                   AND pay.payment_date < $3::date), 0)::bigint::text AS payments`,
    [companyId, partyId, from],
  );
  const opening = BigInt(before.rows[0]?.bills ?? '0') - BigInt(before.rows[0]?.payments ?? '0');
  const entries = await database.query<{
    id: string;
    entry_date: Date;
    kind: 'PURCHASE_BILL' | 'EXPENSE_VOUCHER' | 'PAYMENT';
    reference: string;
    memo: string;
    debit_poisha: string;
    credit_poisha: string;
    sort_order: number;
  }>(
    `SELECT d.id, d.doc_date AS entry_date, d.doc_type AS kind,
            COALESCE(d.document_no, 'Draft') AS reference,
            CONCAT('Supplier invoice ', d.supplier_invoice_no) AS memo,
            d.gross_poisha::text AS debit_poisha, '0' AS credit_poisha, 1 AS sort_order
       FROM purchase_documents d
      WHERE d.company_id = $1 AND d.party_id = $2 AND d.status = 'POSTED'
        AND d.doc_date BETWEEN $3::date AND $4::date
     UNION ALL
     SELECT pay.id, pay.payment_date, 'PAYMENT', pay.payment_number,
            CONCAT('Payment — cash ', pay.amount_poisha::text, ', VDS ', pay.vds_poisha::text,
                   ', TDS ', pay.tds_poisha::text),
            '0', pay.allocated_poisha::text, 2
       FROM purchase_payments pay
      WHERE pay.company_id = $1 AND pay.party_id = $2 AND pay.status = 'POSTED'
        AND pay.payment_date BETWEEN $3::date AND $4::date
      ORDER BY entry_date ASC, sort_order ASC`,
    [companyId, partyId, from, to],
  );
  let running = opening;
  const lines: SupplierStatementLineDto[] = entries.rows.map((entry) => {
    const debit = BigInt(entry.debit_poisha);
    const credit = BigInt(entry.credit_poisha);
    running += debit - credit;
    return {
      id: entry.id,
      entryDate: formatDatabaseDate(entry.entry_date),
      kind: entry.kind,
      reference: entry.reference,
      memo: entry.memo,
      debitPoisha: debit.toString(),
      debitBdt: formatPoishaAsBdt(debit),
      creditPoisha: credit.toString(),
      creditBdt: formatPoishaAsBdt(credit),
      runningBalancePoisha: running.toString(),
      runningBalanceBdt: formatPoishaAsBdt(running),
    };
  });
  return {
    partyId: row.id,
    partyCode: row.code,
    partyNameEn: row.name_en,
    partyNameBn: row.name_bn,
    from,
    to,
    openingPoisha: opening.toString(),
    openingBdt: formatPoishaAsBdt(opening),
    closingPoisha: running.toString(),
    closingBdt: formatPoishaAsBdt(running),
    lines,
  };
}

export async function listWithholdingLiabilities(
  database: Queryable,
  companyId: string,
  filters: {
    status?: 'PENDING' | 'DEPOSITED' | 'REVERSED';
    taxType?: 'VDS' | 'TDS' | 'REVERSE_CHARGE';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: WithholdingLiabilityDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['l.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.status) add('l.status = ?', filters.status);
  if (filters.taxType) add('l.tax_type = ?', filters.taxType);
  if (filters.from) add('l.tax_period >= ?', filters.from);
  if (filters.to) add('l.tax_period <= ?', filters.to);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM purchase_withholding_liabilities l WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, offset);
  const result = await database.query<{
    id: string;
    tax_type: string;
    source_type: string;
    tax_period: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bill_id: string | null;
    bill_no: string | null;
    supplier_invoice_no: string | null;
    payment_id: string | null;
    payment_number: string | null;
    base_poisha: string;
    rate_bps: number;
    amount_poisha: string;
    status: string;
    created_at: Date;
  }>(
    `SELECT l.id, l.tax_type, l.source_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.status, l.created_at
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.tax_period ASC, l.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      taxType: row.tax_type as WithholdingLiabilityDto['taxType'],
      sourceType: row.source_type as WithholdingLiabilityDto['sourceType'],
      taxPeriod: row.tax_period,
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      billId: row.bill_id,
      billNo: row.bill_no,
      supplierInvoiceNo: row.supplier_invoice_no,
      paymentId: row.payment_id,
      paymentNumber: row.payment_number,
      basePoisha: row.base_poisha,
      baseBdt: formatPoishaAsBdt(row.base_poisha),
      rateBps: row.rate_bps,
      amountPoisha: row.amount_poisha,
      amountBdt: formatPoishaAsBdt(row.amount_poisha),
      status: row.status as WithholdingLiabilityDto['status'],
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(count.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getWithholdingProof(
  database: Queryable,
  companyId: string,
  asOf: string,
): Promise<WithholdingProofDto> {
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real proof date in YYYY-MM-DD format.');
  const policy = await getPurchaseTaxPolicy(database, companyId);
  if (!policy.approval) {
    throw new AppError(
      409,
      'PURCHASE_TAX_POLICY_NOT_APPROVED',
      'Record the purchase tax policy approval before proving withholding control accounts.',
    );
  }
  const liability = await database.query<{ tax_type: string; amount: string }>(
    `SELECT l.tax_type, COALESCE(sum(l.amount_poisha), 0)::bigint::text AS amount
       FROM purchase_withholding_liabilities l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.status = 'PENDING'
        AND j.posting_date <= $2::date AND j.status IN ('POSTED', 'REVERSED')
      GROUP BY l.tax_type`,
    [companyId, asOf],
  );
  const liabilityByType = new Map(liability.rows.map((row) => [row.tax_type, BigInt(row.amount)]));
  const gl = await database.query<{ account_id: string; balance: string }>(
    `SELECT l.account_id, COALESCE(sum(l.credit_poisha - l.debit_poisha), 0)::bigint::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.account_id = ANY($2::uuid[])
        AND j.posting_date <= $3::date AND j.status IN ('POSTED', 'REVERSED')
      GROUP BY l.account_id`,
    [
      companyId,
      [
        policy.approval.vdsPayableAccountId,
        policy.approval.tdsPayableAccountId,
        policy.approval.reverseChargePayableAccountId,
      ],
      asOf,
    ],
  );
  const glByAccount = new Map(gl.rows.map((row) => [row.account_id, BigInt(row.balance)]));
  const proof = (taxType: 'VDS' | 'TDS' | 'REVERSE_CHARGE', accountId: string) => {
    const glPoisha = glByAccount.get(accountId) ?? 0n;
    const liabilityPoisha = liabilityByType.get(taxType) ?? 0n;
    return {
      glPoisha: glPoisha.toString(),
      liabilityPoisha: liabilityPoisha.toString(),
      differencePoisha: (liabilityPoisha - glPoisha).toString(),
      agrees: liabilityPoisha === glPoisha,
    };
  };
  return {
    asOf,
    vds: proof('VDS', policy.approval.vdsPayableAccountId),
    tds: proof('TDS', policy.approval.tdsPayableAccountId),
    reverseCharge: proof('REVERSE_CHARGE', policy.approval.reverseChargePayableAccountId),
  };
}
