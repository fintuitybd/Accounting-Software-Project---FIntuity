import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, formatIsoDate, isValidIsoDate, parseIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha, parseQuantity } from '../company/money.ts';
import { divideRoundHalfUp, formatQuantity, parseStoredQuantity } from '../inventory/quantity.ts';
import {
  applySalesStockIssue,
  applySalesStockReturn,
  planSalesStockIssue,
  planSalesStockReturn,
  planSalesStockReversal,
  applySalesStockReversal,
  type SalesStockIssueLineInput,
  type SalesStockReturnLineInput,
} from '../inventory/inventoryService.ts';
import {
  postSystemJournalWithinTransaction,
  reverseJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import {
  assertPostableSalesTax,
  calculateSalesTax,
  getSalesTaxPolicy,
  requireApprovedSalesTaxPolicy,
  taxDecisionJson,
  type SalesDecisionState,
  type SalesTaxDecision,
} from './tax.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const SALES_DOCUMENT_TYPES = ['SALES_INVOICE', 'CREDIT_NOTE'] as const;
export type SalesDocumentType = (typeof SALES_DOCUMENT_TYPES)[number];
export const SALES_DOCUMENT_STATUSES = ['DRAFT', 'APPROVED', 'POSTED', 'REVERSED'] as const;
export type SalesDocumentStatus = (typeof SALES_DOCUMENT_STATUSES)[number];

export interface SalesDraftLineInput {
  originalLineId?: string | null;
  itemId?: string | null;
  descriptionEn?: string | null;
  descriptionBn?: string | null;
  quantity: string;
  unit?: string | null;
  unitPrice?: string | null;
  discount?: string | null;
  taxCategory?: string | null;
  revenueAccountId?: string | null;
  warehouseId?: string | null;
}

export interface SalesDraftInput {
  docType: SalesDocumentType;
  partyId: string;
  branchId?: string | null;
  docDate: string;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
  narrationEn: string;
  narrationBn?: string | null;
  attachmentReference?: string | null;
  creditReason?: string | null;
  originalDocumentId?: string | null;
  lines: SalesDraftLineInput[];
}

export interface SalesAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface SalesDocumentLineDto {
  id: string;
  lineNo: number;
  itemId: string | null;
  itemSku: string | null;
  itemName: string | null;
  descriptionEn: string;
  descriptionBn: string | null;
  quantity: string;
  unit: string;
  unitPricePoisha: string;
  unitPriceBdt: string;
  discountPoisha: string;
  discountBdt: string;
  taxCategory: string;
  revenueAccountId: string;
  revenueAccountCode: string;
  revenueAccountName: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  originalLineId: string | null;
  stockMovementId: string | null;
  lineBasePoisha: string;
  lineBaseBdt: string;
  vatPoisha: string;
  vatBdt: string;
  grossPoisha: string;
  grossBdt: string;
  taxRateBps: number;
  taxRuleId: string | null;
  taxDecisionState: string;
}

export interface SalesDocumentEventDto {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SalesDocumentDto {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  docType: SalesDocumentType;
  status: SalesDocumentStatus;
  documentNo: string | null;
  statutorySerial: string | null;
  statutorySeries: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  partyBin: string | null;
  partyTin: string | null;
  originalDocumentId: string | null;
  originalDocumentNo: string | null;
  docDate: string;
  dueDate: string;
  paymentTermsDays: number;
  currency: string;
  narrationEn: string;
  narrationBn: string | null;
  creditReason: string | null;
  attachmentReference: string | null;
  subtotalPoisha: string;
  subtotalBdt: string;
  discountPoisha: string;
  discountBdt: string;
  vatPoisha: string;
  vatBdt: string;
  grossPoisha: string;
  grossBdt: string;
  taxPackVersion: string | null;
  taxDecisionState: string | null;
  taxSnapshot: Record<string, unknown>;
  journalId: string | null;
  journalNumber: string | null;
  journalStatus: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  postedAt: string | null;
  postedBy: string | null;
  postedByName: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  createdAt: string;
  updatedAt: string;
  lines: SalesDocumentLineDto[];
  events: SalesDocumentEventDto[];
  arOutstandingPoisha: string | null;
  arOutstandingBdt: string | null;
  approvalRequired: boolean;
  approvalThresholdPoisha: string;
  taxPreview: Record<string, unknown>;
}

export interface SalesDocumentSummaryDto {
  id: string;
  docType: SalesDocumentType;
  status: SalesDocumentStatus;
  documentNo: string | null;
  statutorySerial: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  docDate: string;
  dueDate: string;
  currency: string;
  subtotalPoisha: string;
  subtotalBdt: string;
  vatPoisha: string;
  vatBdt: string;
  grossPoisha: string;
  grossBdt: string;
  outstandingPoisha: string | null;
  outstandingBdt: string | null;
  originalDocumentNo: string | null;
  creditReason: string | null;
  createdAt: string;
}

interface DocumentRow {
  id: string;
  company_id: string;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  doc_type: string;
  status: string;
  document_no: string | null;
  statutory_serial: string | null;
  statutory_series: string | null;
  party_id: string;
  party_code: string;
  party_name_en: string;
  party_name_bn: string | null;
  party_bin: string | null;
  party_tin: string | null;
  original_document_id: string | null;
  original_document_no: string | null;
  doc_date: Date;
  due_date: Date;
  payment_terms_days: number;
  currency: string;
  narration_en: string;
  narration_bn: string | null;
  credit_reason: string | null;
  attachment_reference: string | null;
  subtotal_poisha: string;
  discount_poisha: string;
  vat_poisha: string;
  gross_poisha: string;
  tax_pack_version: string | null;
  tax_decision_state: string | null;
  tax_snapshot_json: Record<string, unknown>;
  journal_id: string | null;
  journal_number: string | null;
  journal_status: string | null;
  reversal_journal_id: string | null;
  created_by: string;
  created_by_name: string;
  approved_at: Date | null;
  approved_by: string | null;
  approved_by_name: string | null;
  posted_at: Date | null;
  posted_by: string | null;
  posted_by_name: string | null;
  reversed_at: Date | null;
  reversed_by: string | null;
  reversed_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DocumentLineRow {
  id: string;
  document_id: string;
  line_no: number;
  item_id: string | null;
  item_sku: string | null;
  item_name: string | null;
  description_en: string;
  description_bn: string | null;
  quantity: string;
  unit: string;
  unit_price_poisha: string;
  discount_poisha: string;
  tax_category: string;
  revenue_account_id: string;
  revenue_account_code: string;
  revenue_account_name: string;
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  original_line_id: string | null;
  stock_movement_id: string | null;
  line_base_poisha: string;
  vat_poisha: string;
  gross_poisha: string;
  tax_rate_bps: number;
  tax_rule_id: string | null;
  tax_decision_state: string;
}

interface PreparedLine {
  id: string;
  itemId: string | null;
  itemSku: string | null;
  itemName: string | null;
  isStockItem: boolean;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
  descriptionEn: string;
  descriptionBn: string | null;
  quantity: bigint;
  unit: string;
  unitPricePoisha: bigint;
  discountPoisha: bigint;
  taxCategory: string;
  revenueAccountId: string;
  warehouseId: string | null;
  originalLineId: string | null;
  originalQuantity: bigint | null;
  originalValuePoisha: bigint | null;
  originalMovementId: string | null;
  netOverridePoisha?: bigint;
  vatOverridePoisha?: bigint;
  lineBasePoisha: bigint;
  vatPoisha: bigint;
  grossPoisha: bigint;
  taxRateBps: number;
  taxRuleId: string | null;
  taxDecisionState: SalesDecisionState;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.company_id, d.branch_id, b.code AS branch_code, b.name_en AS branch_name,
         d.doc_type, d.status, d.document_no, d.statutory_serial, d.statutory_series,
         d.party_id, p.code AS party_code, p.name_en AS party_name_en, p.name_bn AS party_name_bn,
         p.bin AS party_bin, p.tin AS party_tin,
         d.original_document_id, od.document_no AS original_document_no,
         d.doc_date, d.due_date, d.payment_terms_days, d.currency,
         d.narration_en, d.narration_bn, d.credit_reason, d.attachment_reference,
         d.subtotal_poisha::text AS subtotal_poisha, d.discount_poisha::text AS discount_poisha,
         d.vat_poisha::text AS vat_poisha, d.gross_poisha::text AS gross_poisha,
         d.tax_pack_version, d.tax_decision_state, d.tax_snapshot_json,
         j.id AS journal_id, j.journal_number, j.status AS journal_status,
         d.reversal_journal_id,
         d.created_by, cu.name AS created_by_name,
         d.approved_at, d.approved_by, au.name AS approved_by_name,
         d.posted_at, d.posted_by, pu.name AS posted_by_name,
         d.reversed_at, d.reversed_by, ru.name AS reversed_by_name,
         d.created_at, d.updated_at
    FROM sales_documents d
    JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
    LEFT JOIN branches b ON b.company_id = d.company_id AND b.id = d.branch_id
    LEFT JOIN sales_documents od ON od.company_id = d.company_id AND od.id = d.original_document_id
    JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users au ON au.id = d.approved_by
    LEFT JOIN users pu ON pu.id = d.posted_by
    LEFT JOIN users ru ON ru.id = d.reversed_by
    LEFT JOIN LATERAL (
      SELECT jj.id, jj.journal_number, jj.status
        FROM journals jj
       WHERE jj.company_id = d.company_id
         AND jj.source_module = 'SALES'
         AND jj.source_doc_id = d.id
         AND jj.reversal_of_journal_id IS NULL
       ORDER BY jj.created_at ASC
       LIMIT 1
    ) j ON true
`;

const LINE_SELECT = `
  SELECT l.id, l.document_id, l.line_no, l.item_id, i.sku AS item_sku, i.name_en AS item_name,
         l.description_en, l.description_bn, l.quantity::text AS quantity, l.unit,
         l.unit_price_poisha::text AS unit_price_poisha, l.discount_poisha::text AS discount_poisha,
         l.tax_category, l.revenue_account_id, a.code AS revenue_account_code,
         a.name_en AS revenue_account_name, l.warehouse_id, w.code AS warehouse_code,
         w.name_en AS warehouse_name, l.original_line_id, l.stock_movement_id,
         l.line_base_poisha::text AS line_base_poisha, l.vat_poisha::text AS vat_poisha,
         l.gross_poisha::text AS gross_poisha, l.tax_rate_bps, l.tax_rule_id, l.tax_decision_state
    FROM sales_document_lines l
    LEFT JOIN items i ON i.company_id = l.company_id AND i.id = l.item_id
    JOIN accounts a ON a.company_id = l.company_id AND a.id = l.revenue_account_id
    LEFT JOIN warehouses w ON w.company_id = l.company_id AND w.id = l.warehouse_id
   WHERE l.company_id = $1 AND l.document_id = $2
   ORDER BY l.line_no ASC
`;

function optionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'SALES_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function requiredText(value: string | null | undefined, max: number, field: string): string {
  const text = value?.trim() ?? '';
  if (!text || text.length > max) {
    throw new AppError(400, 'SALES_FIELD_REQUIRED', `${field} must be between 1 and ${max} characters.`);
  }
  return text;
}

function parseMoney(value: string | null | undefined, field: string): bigint {
  const poisha = parseBdtToPoisha(value ?? '');
  if (poisha === null || poisha < 0n) {
    throw new AppError(
      400,
      'SALES_AMOUNT_INVALID',
      `${field} must be a non-negative BDT amount with up to 2 decimals.`,
    );
  }
  return poisha;
}

function parseLineQuantity(value: string, field = 'Quantity'): bigint {
  const quantity = parseQuantity(value);
  if (quantity === null || quantity <= 0n) {
    throw new AppError(400, 'SALES_QUANTITY_INVALID', `${field} must be a positive number with at most four decimals.`);
  }
  return quantity;
}

function dayDifference(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = parseIsoDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatIsoDate(value);
}

export async function loadArControlAccount(
  database: Queryable,
  companyId: string,
): Promise<{ id: string; code: string; nameEn: string }> {
  const result = await database.query<{ id: string; code: string; name_en: string }>(
    `SELECT id, code, name_en FROM accounts
      WHERE company_id = $1 AND control_subledger = 'AR' AND is_active = true
      ORDER BY code ASC`,
    [companyId],
  );
  if (result.rows.length === 0) {
    throw new AppError(
      409,
      'AR_CONTROL_ACCOUNT_NOT_CONFIGURED',
      'Configure exactly one active accounts-receivable control account before posting sales documents.',
    );
  }
  if (result.rows.length > 1) {
    throw new AppError(
      409,
      'AR_CONTROL_ACCOUNT_AMBIGUOUS',
      'More than one active AR control account exists. Keep one active AR control account so the subledger has a single control account.',
      { accounts: result.rows.map((row) => row.code) },
    );
  }
  const row = result.rows[0]!;
  return { id: row.id, code: row.code, nameEn: row.name_en };
}

export async function getApprovalThreshold(database: Queryable, companyId: string): Promise<bigint> {
  const result = await database.query<{ value_json: Record<string, unknown> | null }>(
    `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = 'approval_thresholds'`,
    [companyId],
  );
  const raw = result.rows[0]?.value_json?.highValuePoisha;
  return typeof raw === 'string' && /^[0-9]+$/.test(raw) ? BigInt(raw) : 0n;
}

async function loadParty(
  database: Queryable,
  companyId: string,
  partyId: string,
  requireActive = true,
): Promise<{
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  bin: string | null;
  tin: string | null;
  type: string;
  credit_days: number;
  status: string;
}> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    bin: string | null;
    tin: string | null;
    type: string;
    credit_days: number;
    status: string;
  }>(
    `SELECT id, code, name_en, name_bn, bin, tin, type, credit_days, status
       FROM parties WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, partyId],
  );
  const party = result.rows[0];
  if (!party) throw new AppError(404, 'SALES_PARTY_NOT_FOUND', 'Customer not found.');
  if (requireActive && party.status !== 'ACTIVE') {
    throw new AppError(409, 'SALES_PARTY_INACTIVE', 'Inactive customers cannot receive a new sales document.');
  }
  if (party.type !== 'CUSTOMER' && party.type !== 'BOTH') {
    throw new AppError(400, 'SALES_PARTY_INVALID', 'The selected party is not a customer.');
  }
  return party;
}

async function loadBranch(
  database: Queryable,
  companyId: string,
  branchId: string | null,
): Promise<{ id: string; code: string; name_en: string } | null> {
  if (!branchId) return null;
  const result = await database.query<{ id: string; code: string; name_en: string; status: string }>(
    `SELECT id, code, name_en, status FROM branches WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new AppError(404, 'SALES_BRANCH_NOT_FOUND', 'Branch not found.');
  if (branch.status !== 'ACTIVE') throw new AppError(409, 'SALES_BRANCH_INACTIVE', 'The branch is inactive.');
  return { id: branch.id, code: branch.code, name_en: branch.name_en };
}

interface ItemForSales {
  id: string;
  sku: string;
  name_en: string;
  name_bn: string | null;
  unit: string;
  is_stock_item: boolean;
  inventory_account_id: string | null;
  expense_account_id: string | null;
  status: string;
}

async function loadItemForSales(
  database: Queryable,
  companyId: string,
  itemId: string,
  requireActive = true,
): Promise<ItemForSales> {
  const result = await database.query<ItemForSales>(
    `SELECT id, sku, name_en, name_bn, unit, is_stock_item, inventory_account_id,
            expense_account_id, status
       FROM items WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, itemId],
  );
  const item = result.rows[0];
  if (!item) throw new AppError(404, 'SALES_ITEM_NOT_FOUND', 'Item not found.');
  if (requireActive && item.status !== 'ACTIVE') {
    throw new AppError(409, 'SALES_ITEM_INACTIVE', 'Inactive items cannot be sold.');
  }
  if (item.is_stock_item && (!item.inventory_account_id || !item.expense_account_id)) {
    throw new AppError(409, 'SALES_ITEM_ACCOUNTS_MISSING', 'The stock item is missing its inventory/COGS accounts.');
  }
  return item;
}

async function loadRevenueAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
): Promise<{ id: string; code: string; name_en: string; is_active: boolean; account_type: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    is_active: boolean;
    account_type: string;
  }>(`SELECT id, code, name_en, is_active, account_type FROM accounts WHERE company_id = $1 AND id = $2`, [
    companyId,
    accountId,
  ]);
  const account = result.rows[0];
  if (!account) throw new AppError(400, 'SALES_REVENUE_ACCOUNT_INVALID', 'Choose a revenue account from this company.');
  if (!account.is_active) throw new AppError(400, 'SALES_REVENUE_ACCOUNT_INACTIVE', 'The revenue account is inactive.');
  if (account.account_type !== 'REVENUE') {
    throw new AppError(400, 'SALES_REVENUE_ACCOUNT_TYPE', 'The line account must be a REVENUE account.');
  }
  return account;
}

async function loadWarehouseForSales(
  database: Queryable,
  companyId: string,
  warehouseId: string,
): Promise<{ id: string; code: string; name_en: string; status: string }> {
  const result = await database.query<{ id: string; code: string; name_en: string; status: string }>(
    `SELECT id, code, name_en, status FROM warehouses WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, warehouseId],
  );
  const warehouse = result.rows[0];
  if (!warehouse) throw new AppError(404, 'SALES_WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
  if (warehouse.status !== 'ACTIVE') throw new AppError(409, 'SALES_WAREHOUSE_INACTIVE', 'The warehouse is inactive.');
  return warehouse;
}

async function prepareInvoiceLines(
  database: Queryable,
  companyId: string,
  inputs: readonly SalesDraftLineInput[],
  existingIds?: readonly string[],
): Promise<PreparedLine[]> {
  if (inputs.length === 0) throw new AppError(400, 'SALES_LINES_REQUIRED', 'Add at least one invoice line.');
  if (inputs.length > 200)
    throw new AppError(400, 'SALES_TOO_MANY_LINES', 'A sales document may have at most 200 lines.');
  const lines: PreparedLine[] = [];
  for (const [index, input] of inputs.entries()) {
    const lineId = existingIds?.[index] ?? randomUUID();
    const quantity = parseLineQuantity(input.quantity, `Line ${index + 1} quantity`);
    let item: ItemForSales | null = null;
    if (input.itemId) {
      item = await loadItemForSales(database, companyId, input.itemId);
    }
    const descriptionEn = requiredText(
      input.descriptionEn?.trim() || item?.name_en,
      500,
      `Line ${index + 1} description`,
    );
    const descriptionBn = optionalText(
      input.descriptionBn ?? item?.name_bn,
      500,
      `Line ${index + 1} Bangla description`,
    );
    const unit = requiredText(input.unit?.trim() || item?.unit, 20, `Line ${index + 1} unit`);
    const unitPricePoisha = parseMoney(input.unitPrice, `Line ${index + 1} unit price`);
    const discountPoisha = parseMoney(input.discount ?? '0', `Line ${index + 1} discount`);
    const taxCategory = requiredText(input.taxCategory, 32, `Line ${index + 1} tax category`);
    const revenueAccountId = requiredText(input.revenueAccountId, 64, `Line ${index + 1} revenue account`);
    await loadRevenueAccount(database, companyId, revenueAccountId);
    const warehouseId: string | null = input.warehouseId ?? null;
    if (item?.is_stock_item) {
      if (!warehouseId) {
        throw new AppError(400, 'SALES_WAREHOUSE_REQUIRED', `Line ${index + 1}: choose a warehouse for a stock item.`);
      }
      await loadWarehouseForSales(database, companyId, warehouseId);
    } else if (warehouseId) {
      throw new AppError(
        400,
        'SALES_WAREHOUSE_NOT_APPLICABLE',
        `Line ${index + 1}: a non-stock line cannot move stock.`,
      );
    }
    lines.push({
      id: lineId,
      itemId: item?.id ?? null,
      itemSku: item?.sku ?? null,
      itemName: item?.name_en ?? null,
      isStockItem: Boolean(item?.is_stock_item),
      inventoryAccountId: item?.inventory_account_id ?? null,
      cogsAccountId: item?.expense_account_id ?? null,
      descriptionEn,
      descriptionBn,
      quantity,
      unit,
      unitPricePoisha,
      discountPoisha,
      taxCategory,
      revenueAccountId,
      warehouseId,
      originalLineId: null,
      originalQuantity: null,
      originalValuePoisha: null,
      originalMovementId: null,
      lineBasePoisha: 0n,
      vatPoisha: 0n,
      grossPoisha: 0n,
      taxRateBps: 0,
      taxRuleId: null,
      taxDecisionState: 'SUPPORTED',
    });
  }
  return lines;
}

interface OriginalLineRow {
  id: string;
  line_no: number;
  item_id: string | null;
  description_en: string;
  description_bn: string | null;
  quantity: string;
  unit: string;
  unit_price_poisha: string;
  discount_poisha: string;
  tax_category: string;
  revenue_account_id: string;
  warehouse_id: string | null;
  stock_movement_id: string | null;
  line_base_poisha: string;
  vat_poisha: string;
  tax_rate_bps: number;
  tax_rule_id: string | null;
}

async function loadOriginalLines(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<OriginalLineRow[]> {
  const result = await database.query<OriginalLineRow>(
    `SELECT id, line_no, item_id, description_en, description_bn, quantity::text AS quantity, unit,
            unit_price_poisha::text AS unit_price_poisha, discount_poisha::text AS discount_poisha,
            tax_category, revenue_account_id, warehouse_id, stock_movement_id,
            line_base_poisha::text AS line_base_poisha, vat_poisha::text AS vat_poisha,
            tax_rate_bps, tax_rule_id
       FROM sales_document_lines
      WHERE company_id = $1 AND document_id = $2
      ORDER BY line_no ASC`,
    [companyId, documentId],
  );
  return result.rows;
}

interface CreditedLineRow {
  original_line_id: string;
  quantity: string;
  base_poisha: string;
  vat_poisha: string;
}

async function loadCreditedLineTotals(
  database: Queryable,
  companyId: string,
  originalDocumentId: string,
): Promise<Map<string, { quantity: bigint; base: bigint; vat: bigint }>> {
  const result = await database.query<CreditedLineRow>(
    `SELECT l.original_line_id,
            sum(l.quantity)::text AS quantity,
            sum(l.line_base_poisha)::text AS base_poisha,
            sum(l.vat_poisha)::text AS vat_poisha
       FROM sales_document_lines l
       JOIN sales_documents d ON d.company_id = l.company_id AND d.id = l.document_id
      WHERE l.company_id = $1
        AND d.original_document_id = $2
        AND d.doc_type = 'CREDIT_NOTE'
        AND d.status = 'POSTED'
        AND l.original_line_id IS NOT NULL
      GROUP BY l.original_line_id`,
    [companyId, originalDocumentId],
  );
  return new Map(
    result.rows.map((row) => [
      row.original_line_id,
      { quantity: parseStoredQuantity(row.quantity), base: BigInt(row.base_poisha), vat: BigInt(row.vat_poisha) },
    ]),
  );
}

async function prepareCreditLines(
  database: Queryable,
  companyId: string,
  originalDocumentId: string,
  originalLines: readonly OriginalLineRow[],
  inputs: readonly SalesDraftLineInput[],
  existingIds?: readonly string[],
): Promise<PreparedLine[]> {
  if (inputs.length === 0) throw new AppError(400, 'SALES_LINES_REQUIRED', 'Add at least one credit-note line.');
  if (inputs.length > 200) throw new AppError(400, 'SALES_TOO_MANY_LINES', 'A credit note may have at most 200 lines.');
  const originals = new Map(originalLines.map((line) => [line.id, line]));
  const credited = await loadCreditedLineTotals(database, companyId, originalDocumentId);
  const lines: PreparedLine[] = [];
  const seen = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    const originalLineId = requiredText(input.originalLineId, 64, `Line ${index + 1} original line`);
    if (seen.has(originalLineId)) {
      throw new AppError(
        400,
        'SALES_CREDIT_LINE_DUPLICATE',
        `Line ${index + 1}: the original line appears more than once.`,
      );
    }
    seen.add(originalLineId);
    const original = originals.get(originalLineId);
    if (!original) {
      throw new AppError(
        400,
        'SALES_CREDIT_LINE_INVALID',
        `Line ${index + 1}: choose a line from the original invoice.`,
      );
    }
    const quantity = parseLineQuantity(input.quantity, `Line ${index + 1} credit quantity`);
    const already = credited.get(originalLineId) ?? { quantity: 0n, base: 0n, vat: 0n };
    const originalQuantity = parseStoredQuantity(original.quantity);
    const available = originalQuantity - already.quantity;
    if (available <= 0n) {
      throw new AppError(
        409,
        'SALES_CREDIT_QUANTITY_EXCEEDED',
        `Line ${index + 1}: the original invoice line has already been fully credited.`,
      );
    }
    if (quantity > available) {
      throw new AppError(
        409,
        'SALES_CREDIT_QUANTITY_EXCEEDED',
        `Line ${index + 1}: credit quantity ${formatQuantity(quantity)} exceeds the remaining ${formatQuantity(available)}.`,
        { originalLineId, availableQuantity: formatQuantity(available) },
      );
    }
    const originalBase = BigInt(original.line_base_poisha);
    const originalVat = BigInt(original.vat_poisha);
    const remainingBase = originalBase - already.base;
    const remainingVat = originalVat - already.vat;
    if (remainingBase < 0n) {
      throw new AppError(
        409,
        'SALES_CREDIT_VALUE_EXCEEDED',
        `Line ${index + 1}: the original invoice line is over-credited.`,
      );
    }
    const isFullRemainder = quantity === available;
    let net = isFullRemainder ? remainingBase : divideRoundHalfUp(originalBase * quantity, originalQuantity);
    if (net > remainingBase) net = remainingBase;
    const rateBps = original.tax_rate_bps;
    let vat = isFullRemainder ? remainingVat : rateBps > 0 ? divideRoundHalfUp(net * BigInt(rateBps), 10_000n) : 0n;
    if (vat > remainingVat) vat = remainingVat;
    if (vat < 0n) vat = 0n;
    let movementValue = 0n;
    let movementQuantity = originalQuantity;
    if (original.stock_movement_id) {
      const movement = await database.query<{ quantity: string; value_poisha: string }>(
        `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
           FROM stock_movements WHERE company_id = $1 AND id = $2`,
        [companyId, original.stock_movement_id],
      );
      const row = movement.rows[0];
      if (!row)
        throw new AppError(409, 'SALES_ORIGINAL_STOCK_MISSING', 'The original stock movement could not be found.');
      movementQuantity = parseStoredQuantity(row.quantity);
      movementValue = BigInt(row.value_poisha);
    }
    const item = original.item_id ? await loadItemForSales(database, companyId, original.item_id, false) : null;
    if (item?.is_stock_item && !original.warehouse_id) {
      throw new AppError(409, 'SALES_ORIGINAL_WAREHOUSE_MISSING', 'The original stock line has no warehouse.');
    }
    lines.push({
      id: existingIds?.[index] ?? randomUUID(),
      itemId: original.item_id,
      itemSku: item?.sku ?? null,
      itemName: item?.name_en ?? null,
      isStockItem: Boolean(item?.is_stock_item),
      inventoryAccountId: item?.inventory_account_id ?? null,
      cogsAccountId: item?.expense_account_id ?? null,
      descriptionEn: original.description_en,
      descriptionBn: original.description_bn,
      quantity,
      unit: original.unit,
      unitPricePoisha: BigInt(original.unit_price_poisha),
      discountPoisha: divideRoundHalfUp(BigInt(original.discount_poisha) * quantity, originalQuantity),
      taxCategory: original.tax_category,
      revenueAccountId: original.revenue_account_id,
      warehouseId: original.warehouse_id,
      originalLineId: original.id,
      originalQuantity: original.stock_movement_id ? movementQuantity : null,
      originalValuePoisha: original.stock_movement_id ? movementValue : null,
      originalMovementId: original.stock_movement_id,
      netOverridePoisha: net,
      vatOverridePoisha: vat,
      lineBasePoisha: net,
      vatPoisha: vat,
      grossPoisha: net + vat,
      taxRateBps: rateBps,
      taxRuleId: original.tax_rule_id,
      taxDecisionState: 'SUPPORTED',
    });
  }
  return lines;
}

function applyTax(lines: PreparedLine[], docDate: string, partyBin: string | null): SalesTaxDecision {
  const decision = calculateSalesTax({
    docDate,
    partyBin,
    lines: lines.map((line) => ({
      lineId: line.id,
      quantity: line.quantity,
      unitPricePoisha: line.unitPricePoisha,
      discountPoisha: line.discountPoisha,
      taxCategory: line.taxCategory,
      ...(line.netOverridePoisha !== undefined ? { netOverridePoisha: line.netOverridePoisha } : {}),
      ...(line.vatOverridePoisha !== undefined ? { vatOverridePoisha: line.vatOverridePoisha } : {}),
    })),
  });
  const byId = new Map(decision.lines.map((line) => [line.lineId, line]));
  for (const line of lines) {
    const taxLine = byId.get(line.id);
    if (!taxLine) throw new AppError(500, 'SALES_TAX_LINE_MISSING', 'The tax decision did not return every line.');
    line.lineBasePoisha = taxLine.netPoisha;
    line.vatPoisha = taxLine.vatPoisha;
    line.grossPoisha = taxLine.grossPoisha;
    line.taxRateBps = taxLine.rateBps;
    line.taxRuleId = taxLine.ruleId;
    line.taxDecisionState = taxLine.decisionState;
  }
  return decision;
}

async function insertDocumentLines(
  client: PoolClient,
  companyId: string,
  documentId: string,
  lines: readonly PreparedLine[],
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO sales_document_lines (
         id, company_id, document_id, line_no, item_id, description_en, description_bn,
         quantity, unit, unit_price_poisha, discount_poisha, tax_category, revenue_account_id,
         warehouse_id, original_line_id, line_base_poisha, vat_poisha, gross_poisha,
         tax_rate_bps, tax_rule_id, tax_decision_state
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
       )`,
      [
        line.id,
        companyId,
        documentId,
        index + 1,
        line.itemId,
        line.descriptionEn,
        line.descriptionBn,
        formatQuantity(line.quantity),
        line.unit,
        line.unitPricePoisha.toString(),
        line.discountPoisha.toString(),
        line.taxCategory,
        line.revenueAccountId,
        line.warehouseId,
        line.originalLineId,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.grossPoisha.toString(),
        line.taxRateBps,
        line.taxRuleId,
        line.taxDecisionState,
      ],
    );
  }
}

async function updateDocumentLineTax(
  client: PoolClient,
  companyId: string,
  lines: readonly PreparedLine[],
): Promise<void> {
  for (const line of lines) {
    await client.query(
      `UPDATE sales_document_lines
          SET line_base_poisha = $3, vat_poisha = $4, gross_poisha = $5,
              tax_rate_bps = $6, tax_rule_id = $7, tax_decision_state = $8
        WHERE company_id = $1 AND id = $2`,
      [
        companyId,
        line.id,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.grossPoisha.toString(),
        line.taxRateBps,
        line.taxRuleId,
        line.taxDecisionState,
      ],
    );
  }
}

async function insertEvent(
  client: PoolClient,
  companyId: string,
  documentId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  actorUserId: string,
  reason: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO sales_document_events (
       company_id, document_id, action, from_status, to_status, actor_user_id, reason, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [companyId, documentId, action, fromStatus, toStatus, actorUserId, reason, JSON.stringify(metadata)],
  );
}

function auditBase(input: SalesAuditContext, companyId: string) {
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

export async function resolvePeriodForNumbering(
  database: Queryable,
  companyId: string,
  date: string,
): Promise<{ period_id: string; fiscal_year_id: string; fiscal_start: Date; status: string; code: string }> {
  const result = await database.query<{
    period_id: string;
    fiscal_year_id: string;
    fiscal_start: Date;
    status: string;
    code: string;
  }>(
    `SELECT p.id AS period_id, p.fiscal_year_id, fy.start_date AS fiscal_start, p.status, p.code
       FROM periods p
       JOIN fiscal_years fy ON fy.company_id = p.company_id AND fy.id = p.fiscal_year_id
      WHERE p.company_id = $1 AND p.start_date <= $2::date AND p.end_date >= $2::date
      LIMIT 1`,
    [companyId, date],
  );
  const period = result.rows[0];
  if (!period) {
    throw new AppError(
      400,
      'PERIOD_NOT_FOUND',
      `No accounting period is configured for ${date}. Generate the fiscal year before posting.`,
    );
  }
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'PERIOD_NOT_OPEN',
      `The period ${period.code} is ${period.status}; postings are accepted only in an OPEN period.`,
    );
  }
  return period;
}

export async function allocateSalesNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  fiscalStart: Date,
  docType: string,
): Promise<string> {
  const result = await client.query<{ id: string; prefix: string; pad: number; next_value: string }>(
    `SELECT id, prefix, pad, next_value::text AS next_value
       FROM number_sequences
      WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = $3
      FOR UPDATE`,
    [companyId, fiscalYearId, docType],
  );
  const sequence = result.rows[0];
  if (!sequence) {
    throw new AppError(
      409,
      'SALES_SEQUENCE_MISSING',
      `The ${docType} number sequence is not configured for this fiscal year. Repair the fiscal-year numbering setup.`,
    );
  }
  const value = BigInt(sequence.next_value);
  if (value < 1n) throw new AppError(409, 'SALES_SEQUENCE_INVALID', 'The number sequence value must be at least 1.');
  const year = formatDatabaseDate(fiscalStart).slice(0, 4);
  const number = `${sequence.prefix}${year}-${value.toString().padStart(sequence.pad, '0')}`;
  await client.query(
    `UPDATE number_sequences SET next_value = $3, version = version + 1 WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

async function loadDocumentRow(
  database: Queryable,
  companyId: string,
  documentId: string,
  forUpdate = false,
): Promise<DocumentRow> {
  const result = await database.query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE d.company_id = $1 AND d.id = $2${forUpdate ? ' FOR UPDATE OF d' : ''}`,
    [companyId, documentId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'SALES_DOCUMENT_NOT_FOUND', 'Sales document not found.');
  return row;
}

function mapLine(row: DocumentLineRow): SalesDocumentLineDto {
  return {
    id: row.id,
    lineNo: row.line_no,
    itemId: row.item_id,
    itemSku: row.item_sku,
    itemName: row.item_name,
    descriptionEn: row.description_en,
    descriptionBn: row.description_bn,
    quantity: formatQuantity(parseStoredQuantity(row.quantity)),
    unit: row.unit,
    unitPricePoisha: row.unit_price_poisha,
    unitPriceBdt: formatPoishaAsBdt(row.unit_price_poisha),
    discountPoisha: row.discount_poisha,
    discountBdt: formatPoishaAsBdt(row.discount_poisha),
    taxCategory: row.tax_category,
    revenueAccountId: row.revenue_account_id,
    revenueAccountCode: row.revenue_account_code,
    revenueAccountName: row.revenue_account_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    originalLineId: row.original_line_id,
    stockMovementId: row.stock_movement_id,
    lineBasePoisha: row.line_base_poisha,
    lineBaseBdt: formatPoishaAsBdt(row.line_base_poisha),
    vatPoisha: row.vat_poisha,
    vatBdt: formatPoishaAsBdt(row.vat_poisha),
    grossPoisha: row.gross_poisha,
    grossBdt: formatPoishaAsBdt(row.gross_poisha),
    taxRateBps: row.tax_rate_bps,
    taxRuleId: row.tax_rule_id,
    taxDecisionState: row.tax_decision_state,
  };
}

async function loadEvents(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<SalesDocumentEventDto[]> {
  const result = await database.query<{
    id: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    actor_user_id: string | null;
    actor_name: string | null;
    reason: string | null;
    metadata_json: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.from_status, e.to_status, e.actor_user_id, u.name AS actor_name,
            e.reason, e.metadata_json, e.created_at
       FROM sales_document_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.company_id = $1 AND e.document_id = $2
      ORDER BY e.created_at ASC, e.id ASC`,
    [companyId, documentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    reason: row.reason,
    metadata: row.metadata_json,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getSalesDocument(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<SalesDocumentDto> {
  const row = await loadDocumentRow(database, companyId, documentId);
  const linesResult = await database.query<DocumentLineRow>(LINE_SELECT, [companyId, documentId]);
  const lines = linesResult.rows.map(mapLine);
  const events = await loadEvents(database, companyId, documentId);
  const threshold = await getApprovalThreshold(database, companyId);
  const gross = BigInt(row.gross_poisha);
  const approvalRequired = threshold > 0n && gross >= threshold;
  let arOutstanding: string | null = null;
  if (row.doc_type === 'SALES_INVOICE' && row.status === 'POSTED') {
    const ar = await database.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM sales_ar_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [companyId, documentId],
    );
    arOutstanding = ar.rows[0]?.outstanding_poisha ?? null;
  }
  let taxPreview = row.tax_snapshot_json ?? {};
  if (row.status === 'DRAFT' && row.doc_type === 'SALES_INVOICE') {
    try {
      const prepared = linesResult.rows.map((line) => ({
        lineId: line.id,
        quantity: parseStoredQuantity(line.quantity),
        unitPricePoisha: BigInt(line.unit_price_poisha),
        discountPoisha: BigInt(line.discount_poisha),
        taxCategory: line.tax_category,
      }));
      taxPreview = taxDecisionJson(
        calculateSalesTax({
          docDate: formatDatabaseDate(row.doc_date),
          partyBin: row.party_bin,
          lines: prepared,
        }),
      );
    } catch {
      // Keep the stored draft snapshot so the document remains viewable when the pack has changed.
      // Posting recalculates and will block on a stale/unsupported decision.
      taxPreview = row.tax_snapshot_json ?? {};
    }
  }
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    docType: row.doc_type as SalesDocumentType,
    status: row.status as SalesDocumentStatus,
    documentNo: row.document_no,
    statutorySerial: row.statutory_serial,
    statutorySeries: row.statutory_series,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    partyNameBn: row.party_name_bn,
    partyBin: row.party_bin,
    partyTin: row.party_tin,
    originalDocumentId: row.original_document_id,
    originalDocumentNo: row.original_document_no,
    docDate: formatDatabaseDate(row.doc_date),
    dueDate: formatDatabaseDate(row.due_date),
    paymentTermsDays: row.payment_terms_days,
    currency: row.currency,
    narrationEn: row.narration_en,
    narrationBn: row.narration_bn,
    creditReason: row.credit_reason,
    attachmentReference: row.attachment_reference,
    subtotalPoisha: row.subtotal_poisha,
    subtotalBdt: formatPoishaAsBdt(row.subtotal_poisha),
    discountPoisha: row.discount_poisha,
    discountBdt: formatPoishaAsBdt(row.discount_poisha),
    vatPoisha: row.vat_poisha,
    vatBdt: formatPoishaAsBdt(row.vat_poisha),
    grossPoisha: row.gross_poisha,
    grossBdt: formatPoishaAsBdt(row.gross_poisha),
    taxPackVersion: row.tax_pack_version,
    taxDecisionState: row.tax_decision_state,
    taxSnapshot: taxPreview,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    journalStatus: row.journal_status,
    reversalJournalId: row.reversal_journal_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    postedAt: row.posted_at?.toISOString() ?? null,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name,
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedBy: row.reversed_by,
    reversedByName: row.reversed_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lines,
    events,
    arOutstandingPoisha: arOutstanding,
    arOutstandingBdt: arOutstanding === null ? null : formatPoishaAsBdt(arOutstanding),
    approvalRequired,
    approvalThresholdPoisha: threshold.toString(),
    taxPreview,
  };
}

export async function listSalesDocuments(
  database: Queryable,
  companyId: string,
  filters: {
    docType?: SalesDocumentType;
    status?: SalesDocumentStatus;
    partyId?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ entries: SalesDocumentSummaryDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['d.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.docType) add('d.doc_type = ?', filters.docType);
  if (filters.status) add('d.status = ?', filters.status);
  if (filters.partyId) add('d.party_id = ?', filters.partyId);
  if (filters.from) add('d.doc_date >= ?::date', filters.from);
  if (filters.to) add('d.doc_date <= ?::date', filters.to);
  if (filters.search) {
    params.push(`%${filters.search.trim()}%`);
    where.push(
      `(d.document_no ILIKE $${params.length} OR d.statutory_serial ILIKE $${params.length}
        OR p.name_en ILIKE $${params.length} OR p.code ILIKE $${params.length})`,
    );
  }
  const countResult = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM sales_documents d JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
      WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, offset);
  const result = await database.query<{
    id: string;
    doc_type: string;
    status: string;
    document_no: string | null;
    statutory_serial: string | null;
    party_id: string;
    party_code: string;
    party_name_en: string;
    party_name_bn: string | null;
    doc_date: Date;
    due_date: Date;
    currency: string;
    subtotal_poisha: string;
    vat_poisha: string;
    gross_poisha: string;
    outstanding_poisha: string | null;
    original_document_no: string | null;
    credit_reason: string | null;
    created_at: Date;
  }>(
    `SELECT d.id, d.doc_type, d.status, d.document_no, d.statutory_serial, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, p.name_bn AS party_name_bn,
            d.doc_date, d.due_date, d.currency,
            d.subtotal_poisha::text AS subtotal_poisha, d.vat_poisha::text AS vat_poisha,
            d.gross_poisha::text AS gross_poisha,
            o.outstanding_poisha::text AS outstanding_poisha,
            od.document_no AS original_document_no, d.credit_reason, d.created_at
       FROM sales_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       LEFT JOIN sales_ar_open_items o ON o.company_id = d.company_id AND o.document_id = d.id
       LEFT JOIN sales_documents od ON od.company_id = d.company_id AND od.id = d.original_document_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.doc_date DESC, d.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      docType: row.doc_type as SalesDocumentType,
      status: row.status as SalesDocumentStatus,
      documentNo: row.document_no,
      statutorySerial: row.statutory_serial,
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      partyNameBn: row.party_name_bn,
      docDate: formatDatabaseDate(row.doc_date),
      dueDate: formatDatabaseDate(row.due_date),
      currency: row.currency,
      subtotalPoisha: row.subtotal_poisha,
      subtotalBdt: formatPoishaAsBdt(row.subtotal_poisha),
      vatPoisha: row.vat_poisha,
      vatBdt: formatPoishaAsBdt(row.vat_poisha),
      grossPoisha: row.gross_poisha,
      grossBdt: formatPoishaAsBdt(row.gross_poisha),
      outstandingPoisha: row.outstanding_poisha,
      outstandingBdt: row.outstanding_poisha === null ? null : formatPoishaAsBdt(row.outstanding_poisha),
      originalDocumentNo: row.original_document_no,
      creditReason: row.credit_reason,
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(countResult.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

async function loadOriginalDocument(
  database: Queryable,
  companyId: string,
  originalDocumentId: string,
  forUpdate = false,
): Promise<DocumentRow> {
  const row = await loadDocumentRow(database, companyId, originalDocumentId, forUpdate);
  if (row.doc_type !== 'SALES_INVOICE' || row.status !== 'POSTED') {
    throw new AppError(409, 'SALES_CREDIT_ORIGINAL_INVALID', 'A credit note must reference a posted sales invoice.');
  }
  return row;
}

interface PreparedDocument {
  party: Awaited<ReturnType<typeof loadParty>>;
  branch: Awaited<ReturnType<typeof loadBranch>>;
  original: DocumentRow | null;
  lines: PreparedLine[];
  decision: SalesTaxDecision;
  dueDate: string;
  paymentTermsDays: number;
}

async function prepareDocument(
  database: Queryable,
  companyId: string,
  input: SalesDraftInput,
): Promise<PreparedDocument> {
  if (!isValidIsoDate(input.docDate))
    throw new AppError(400, 'INVALID_DATE', 'Use a real document date in YYYY-MM-DD format.');
  const party = await loadParty(database, companyId, input.partyId, input.docType === 'SALES_INVOICE');
  const branch = await loadBranch(database, companyId, input.branchId ?? null);
  let original: DocumentRow | null = null;
  let lines: PreparedLine[];
  let dueDate: string;
  let paymentTermsDays: number;
  if (input.docType === 'SALES_INVOICE') {
    if (input.originalDocumentId)
      throw new AppError(400, 'SALES_ORIGINAL_NOT_ALLOWED', 'A sales invoice cannot reference an original invoice.');
    lines = await prepareInvoiceLines(database, companyId, input.lines);
    paymentTermsDays = input.paymentTermsDays ?? party.credit_days;
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
      throw new AppError(
        400,
        'SALES_PAYMENT_TERMS_INVALID',
        'Payment terms must be a whole number of days between 0 and 3650.',
      );
    }
    dueDate = input.dueDate ?? addDays(input.docDate, paymentTermsDays);
    if (!isValidIsoDate(dueDate) || dueDate < input.docDate) {
      throw new AppError(400, 'SALES_DUE_DATE_INVALID', 'Due date must be a real date on or after the document date.');
    }
    if (!input.dueDate) paymentTermsDays = dayDifference(input.docDate, dueDate);
  } else {
    const originalId = input.originalDocumentId;
    if (!originalId) throw new AppError(400, 'SALES_CREDIT_ORIGINAL_REQUIRED', 'Choose the original posted invoice.');
    if (!input.creditReason || input.creditReason.trim().length < 3) {
      throw new AppError(
        400,
        'SALES_CREDIT_REASON_REQUIRED',
        'A credit-note reason of at least 3 characters is required.',
      );
    }
    original = await loadOriginalDocument(database, companyId, originalId);
    if (original.party_id !== input.partyId) {
      throw new AppError(400, 'SALES_CREDIT_PARTY_MISMATCH', 'The credit note must use the original invoice customer.');
    }
    const originalLines = await loadOriginalLines(database, companyId, originalId);
    lines = await prepareCreditLines(database, companyId, originalId, originalLines, input.lines);
    paymentTermsDays = 0;
    dueDate = input.docDate;
  }
  const decision = applyTax(lines, input.docDate, party.bin);
  if (decision.grossPoisha <= 0n) {
    throw new AppError(400, 'SALES_ZERO_VALUE', 'A sales document must have a positive value.');
  }
  return { party, branch, original, lines, decision, dueDate, paymentTermsDays };
}

async function insertDocument(
  client: PoolClient,
  input: SalesAuditContext & {
    companyId: string;
    documentId: string;
    document: PreparedDocument;
    draft: SalesDraftInput;
    createIdempotencyKey: string | null;
  },
): Promise<void> {
  const { document, draft } = input;
  const narrationEn = requiredText(draft.narrationEn, 500, 'Narration');
  const narrationBn = optionalText(draft.narrationBn, 500, 'Bangla narration');
  const attachment = optionalText(draft.attachmentReference, 500, 'Attachment reference');
  const creditReason = document.original ? requiredText(draft.creditReason, 500, 'Credit-note reason') : null;
  await client.query(
    `INSERT INTO sales_documents (
       id, company_id, branch_id, doc_type, status, party_id, original_document_id,
       original_document_no, doc_date, due_date, payment_terms_days, currency,
       narration_en, narration_bn, credit_reason, attachment_reference,
       subtotal_poisha, discount_poisha, vat_poisha, gross_poisha,
       tax_pack_version, tax_decision_state, tax_snapshot_json,
       created_by, updated_by, create_idempotency_key
     ) VALUES (
       $1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,'BDT',$11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21::jsonb,$22,$22,$23
     )`,
    [
      input.documentId,
      input.companyId,
      document.branch?.id ?? null,
      draft.docType,
      document.party.id,
      document.original?.id ?? null,
      document.original?.document_no ?? null,
      draft.docDate,
      document.dueDate,
      document.paymentTermsDays,
      narrationEn,
      narrationBn,
      creditReason,
      attachment,
      document.decision.subtotalPoisha.toString(),
      document.decision.discountPoisha.toString(),
      document.decision.vatPoisha.toString(),
      document.decision.grossPoisha.toString(),
      document.decision.packVersion,
      document.decision.decisionState,
      JSON.stringify({
        ...taxDecisionJson(document.decision),
        draft: true,
      }),
      input.actorUserId,
      input.createIdempotencyKey,
    ],
  );
  await insertDocumentLines(client, input.companyId, input.documentId, document.lines);
  await insertEvent(client, input.companyId, input.documentId, 'drafted', null, 'DRAFT', input.actorUserId, null, {
    docType: draft.docType,
    grossPoisha: document.decision.grossPoisha.toString(),
  });
}

export async function createSalesDraft(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    draft: SalesDraftInput;
    idempotencyKey?: string | null;
  },
): Promise<{ document: SalesDocumentDto; replayed: boolean }> {
  return withTransaction(pool, async (client) => {
    if (input.idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `sales-draft:${input.companyId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM sales_documents WHERE company_id = $1 AND create_idempotency_key = $2 LIMIT 1`,
        [input.companyId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { document: await getSalesDocument(client, input.companyId, existing.rows[0].id), replayed: true };
      }
    }
    const document = await prepareDocument(client, input.companyId, input.draft);
    const documentId = randomUUID();
    try {
      await insertDocument(client, {
        ...input,
        documentId,
        document,
        createIdempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      mapSalesConstraintError(error);
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'sales.document_drafted',
      entityType: 'sales_document',
      entityId: documentId,
      after: {
        docType: input.draft.docType,
        partyId: input.draft.partyId,
        grossPoisha: document.decision.grossPoisha.toString(),
        vatPoisha: document.decision.vatPoisha.toString(),
        taxPackVersion: document.decision.packVersion,
      },
      reason: 'Sales draft created through the server document service.',
    });
    return { document: await getSalesDocument(client, input.companyId, documentId), replayed: false };
  });
}

export async function updateSalesDraft(
  pool: Pool,
  input: SalesAuditContext & { companyId: string; documentId: string; draft: SalesDraftInput },
): Promise<SalesDocumentDto> {
  return withTransaction(pool, async (client) => {
    const current = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (current.doc_type !== input.draft.docType) {
      throw new AppError(
        400,
        'SALES_DOCUMENT_TYPE_IMMUTABLE',
        'A draft cannot change between invoice and credit note.',
      );
    }
    if (current.status === 'POSTED' || current.status === 'REVERSED') {
      throw new AppError(409, 'SALES_DOCUMENT_NOT_DRAFT', 'Posted or reversed sales documents cannot be edited.');
    }
    await client.query(
      `UPDATE sales_documents SET status = 'DRAFT', approved_at = NULL, approved_by = NULL, updated_by = $3
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.documentId, input.actorUserId],
    );
    await client.query(`DELETE FROM sales_document_lines WHERE company_id = $1 AND document_id = $2`, [
      input.companyId,
      input.documentId,
    ]);
    const document = await prepareDocument(client, input.companyId, input.draft);
    const narrationEn = requiredText(input.draft.narrationEn, 500, 'Narration');
    const narrationBn = optionalText(input.draft.narrationBn, 500, 'Bangla narration');
    const attachment = optionalText(input.draft.attachmentReference, 500, 'Attachment reference');
    const creditReason = document.original ? requiredText(input.draft.creditReason, 500, 'Credit-note reason') : null;
    await client.query(
      `UPDATE sales_documents
          SET branch_id = $3, party_id = $4, original_document_id = $5, original_document_no = $6,
              doc_date = $7, due_date = $8, payment_terms_days = $9, narration_en = $10,
              narration_bn = $11, credit_reason = $12, attachment_reference = $13,
              subtotal_poisha = $14, discount_poisha = $15, vat_poisha = $16, gross_poisha = $17,
              tax_pack_version = $18, tax_decision_state = $19, tax_snapshot_json = $20::jsonb,
              updated_by = $21, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.documentId,
        document.branch?.id ?? null,
        document.party.id,
        document.original?.id ?? null,
        document.original?.document_no ?? null,
        input.draft.docDate,
        document.dueDate,
        document.paymentTermsDays,
        narrationEn,
        narrationBn,
        creditReason,
        attachment,
        document.decision.subtotalPoisha.toString(),
        document.decision.discountPoisha.toString(),
        document.decision.vatPoisha.toString(),
        document.decision.grossPoisha.toString(),
        document.decision.packVersion,
        document.decision.decisionState,
        JSON.stringify({ ...taxDecisionJson(document.decision), draft: true }),
        input.actorUserId,
      ],
    );
    await insertDocumentLines(client, input.companyId, input.documentId, document.lines);
    await insertEvent(
      client,
      input.companyId,
      input.documentId,
      'updated',
      current.status,
      'DRAFT',
      input.actorUserId,
      null,
      {
        grossPoisha: document.decision.grossPoisha.toString(),
      },
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'sales.document_updated',
      entityType: 'sales_document',
      entityId: input.documentId,
      before: { status: current.status, grossPoisha: current.gross_poisha, vatPoisha: current.vat_poisha },
      after: {
        status: 'DRAFT',
        grossPoisha: document.decision.grossPoisha.toString(),
        vatPoisha: document.decision.vatPoisha.toString(),
        taxPackVersion: document.decision.packVersion,
      },
      reason: 'Sales draft updated before posting.',
    });
    return getSalesDocument(client, input.companyId, input.documentId);
  });
}

export async function approveSalesDocument(
  pool: Pool,
  input: SalesAuditContext & { companyId: string; documentId: string; reason?: string | null },
): Promise<SalesDocumentDto> {
  return withTransaction(pool, async (client) => {
    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status === 'APPROVED') return getSalesDocument(client, input.companyId, input.documentId);
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'SALES_DOCUMENT_NOT_DRAFT', 'Only a draft document can be approved.');
    }
    const threshold = await getApprovalThreshold(client, input.companyId);
    const gross = BigInt(row.gross_poisha);
    if (threshold <= 0n || gross < threshold) {
      throw new AppError(
        409,
        'SALES_APPROVAL_NOT_REQUIRED',
        'This document is below the configured approval threshold and does not need a separate approval.',
      );
    }
    if (row.created_by === input.actorUserId) {
      throw new AppError(403, 'SALES_MAKER_CHECKER', 'The document creator cannot approve their own document.');
    }
    const reason =
      optionalText(input.reason, 500, 'Approval reason') ?? 'Document approved above the configured threshold.';
    await client.query(
      `UPDATE sales_documents
          SET status = 'APPROVED', approved_at = now(), approved_by = $3, updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'DRAFT'`,
      [input.companyId, input.documentId, input.actorUserId],
    );
    await insertEvent(
      client,
      input.companyId,
      input.documentId,
      'approved',
      'DRAFT',
      'APPROVED',
      input.actorUserId,
      reason,
      {
        thresholdPoisha: threshold.toString(),
        grossPoisha: gross.toString(),
      },
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'sales.document_approved',
      entityType: 'sales_document',
      entityId: input.documentId,
      before: { status: 'DRAFT', docType: row.doc_type },
      after: {
        status: 'APPROVED',
        docType: row.doc_type,
        approvedBy: input.actorUserId,
        thresholdPoisha: threshold.toString(),
      },
      reason,
    });
    return getSalesDocument(client, input.companyId, input.documentId);
  });
}

function addAggregate(target: Map<string, bigint>, accountId: string, amount: bigint): void {
  target.set(accountId, (target.get(accountId) ?? 0n) + amount);
}

function buildJournalLines(input: {
  docType: SalesDocumentType;
  partyCode: string;
  partyName: string;
  arAccountId: string;
  outputVatAccountId: string;
  taxDecision: SalesTaxDecision;
  lines: readonly PreparedLine[];
  stockPlanLines: ReadonlyArray<{ inventoryAccountId: string; cogsAccountId: string; valuePoisha: bigint }>;
}): JournalLineInput[] {
  const revenue = new Map<string, bigint>();
  const inventory = new Map<string, bigint>();
  const cogs = new Map<string, bigint>();
  for (const line of input.lines) addAggregate(revenue, line.revenueAccountId, line.lineBasePoisha);
  for (const line of input.stockPlanLines) {
    addAggregate(inventory, line.inventoryAccountId, line.valuePoisha);
    addAggregate(cogs, line.cogsAccountId, line.valuePoisha);
  }
  const partyReference = input.partyCode;
  const partyName = input.partyName;
  const journalLines: JournalLineInput[] = [];
  const debit = (accountId: string, amount: bigint, memo: string) => {
    if (amount > 0n) {
      journalLines.push({ accountId, debit: formatPoishaAsBdt(amount), credit: '0', partyReference, partyName, memo });
    }
  };
  const credit = (accountId: string, amount: bigint, memo: string) => {
    if (amount > 0n) {
      journalLines.push({ accountId, debit: '0', credit: formatPoishaAsBdt(amount), partyReference, partyName, memo });
    }
  };
  if (input.docType === 'SALES_INVOICE') {
    debit(input.arAccountId, input.taxDecision.grossPoisha, 'Trade receivable');
    for (const [accountId, amount] of revenue) credit(accountId, amount, 'Sales revenue');
    credit(input.outputVatAccountId, input.taxDecision.vatPoisha, 'Output VAT');
    for (const [accountId, amount] of cogs) debit(accountId, amount, 'Cost of goods sold');
    for (const [accountId, amount] of inventory) credit(accountId, amount, 'Inventory issued');
  } else {
    for (const [accountId, amount] of revenue) debit(accountId, amount, 'Sales return — revenue reversal');
    debit(input.outputVatAccountId, input.taxDecision.vatPoisha, 'Output VAT reversal');
    credit(input.arAccountId, input.taxDecision.grossPoisha, 'Trade receivable credited');
    for (const [accountId, amount] of inventory) debit(accountId, amount, 'Inventory returned');
    for (const [accountId, amount] of cogs) credit(accountId, amount, 'Cost of goods sold reversal');
  }
  return journalLines;
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
      'SALES_JOURNAL_UNBALANCED',
      'The calculated sales journal did not balance; posting was rolled back.',
    );
  }
}

function mapSalesConstraintError(error: unknown): never {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505') {
    if (pgError.constraint?.includes('idempotency')) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for this company.');
    }
    if (pgError.constraint?.includes('serial')) {
      throw new AppError(
        409,
        'SALES_SERIAL_CONFLICT',
        'The statutory serial sequence points at an existing serial. Repair the sequence; serials are never reused.',
      );
    }
    if (pgError.constraint?.includes('document_no')) {
      throw new AppError(
        409,
        'SALES_DOCUMENT_NUMBER_CONFLICT',
        'The document-number sequence points at an existing number. Repair the sequence; numbers are never reused.',
      );
    }
  }
  throw error;
}

async function updateLineStockMovement(
  client: PoolClient,
  companyId: string,
  documentId: string,
  movementIds: Map<string, string>,
): Promise<void> {
  for (const [lineId, movementId] of movementIds) {
    await client.query(
      `UPDATE sales_document_lines SET stock_movement_id = $4
        WHERE company_id = $1 AND document_id = $2 AND id = $3`,
      [companyId, documentId, lineId, movementId],
    );
  }
}

async function insertTaxEvidence(
  client: PoolClient,
  input: SalesAuditContext & {
    companyId: string;
    documentId: string;
    decision: SalesTaxDecision;
    lines: readonly PreparedLine[];
    party: { id: string; bin: string | null };
    docDate: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sales_tax_decisions (
       company_id, document_id, rule_pack_version, rule_pack_status, decision_state, trace_id,
       input_json, decision_json, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [
      input.companyId,
      input.documentId,
      input.decision.packVersion,
      input.decision.packStatus,
      input.decision.decisionState,
      input.decision.traceId,
      JSON.stringify({
        docDate: input.docDate,
        partyId: input.party.id,
        partyBin: input.party.bin,
        lines: input.lines.map((line) => ({
          lineId: line.id,
          quantity: line.quantity.toString(),
          unitPricePoisha: line.unitPricePoisha.toString(),
          discountPoisha: line.discountPoisha.toString(),
          taxCategory: line.taxCategory,
          netOverridePoisha: line.netOverridePoisha?.toString() ?? null,
          vatOverridePoisha: line.vatOverridePoisha?.toString() ?? null,
        })),
      }),
      JSON.stringify(taxDecisionJson(input.decision)),
      input.actorUserId,
    ],
  );
  for (const line of input.lines) {
    await client.query(
      `INSERT INTO sales_document_taxes (
         company_id, document_id, line_id, tax_type, tax_category, rate_bps,
         base_poisha, amount_poisha, rule_id, rule_pack_version
       ) VALUES ($1,$2,$3,'VAT',$4,$5,$6,$7,$8,$9)`,
      [
        input.companyId,
        input.documentId,
        line.id,
        line.taxCategory,
        line.taxRateBps,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.taxRuleId,
        input.decision.packVersion,
      ],
    );
  }
}

async function rereadStoredInvoiceLines(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<SalesDraftLineInput[]> {
  const result = await database.query<DocumentLineRow>(LINE_SELECT, [companyId, documentId]);
  return result.rows.map((row) => ({
    itemId: row.item_id,
    descriptionEn: row.description_en,
    descriptionBn: row.description_bn,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: formatPoishaAsBdt(row.unit_price_poisha),
    discount: formatPoishaAsBdt(row.discount_poisha),
    taxCategory: row.tax_category,
    revenueAccountId: row.revenue_account_id,
    warehouseId: row.warehouse_id,
  }));
}

async function rereadStoredCreditLines(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<{ ids: string[]; inputs: SalesDraftLineInput[] }> {
  const result = await database.query<DocumentLineRow>(LINE_SELECT, [companyId, documentId]);
  return {
    ids: result.rows.map((row) => row.id),
    inputs: result.rows.map((row) => ({
      originalLineId: row.original_line_id,
      quantity: row.quantity,
    })),
  };
}

export async function postSalesDocument(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    documentId: string;
    idempotencyKey: string;
  },
): Promise<{ document: SalesDocumentDto; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required to post a sales document.',
    );
  }
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `sales-post:${input.companyId}:${input.idempotencyKey}`,
    ]);
    const existingKey = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM sales_documents WHERE company_id = $1 AND posting_idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      if (existingKey.rows[0].id !== input.documentId) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'That Idempotency-Key was already used for another sales document.',
        );
      }
      if (existingKey.rows[0].status === 'REVERSED') {
        throw new AppError(409, 'SALES_DOCUMENT_ALREADY_REVERSED', 'A reversed document cannot be posted again.');
      }
      return { document: await getSalesDocument(client, input.companyId, input.documentId), replayed: true };
    }

    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status === 'POSTED') {
      throw new AppError(409, 'SALES_DOCUMENT_ALREADY_POSTED', 'This document is already posted.');
    }
    if (row.status === 'REVERSED') {
      throw new AppError(409, 'SALES_DOCUMENT_ALREADY_REVERSED', 'A reversed document cannot be posted again.');
    }
    if (row.status !== 'DRAFT' && row.status !== 'APPROVED') {
      throw new AppError(409, 'SALES_DOCUMENT_NOT_POSTABLE', `A ${row.status} document cannot be posted.`);
    }
    const docDate = formatDatabaseDate(row.doc_date);
    const policy = await requireApprovedSalesTaxPolicy(client, input.companyId, docDate);
    const arAccount = await loadArControlAccount(client, input.companyId);
    const party = await loadParty(client, input.companyId, row.party_id, row.doc_type === 'SALES_INVOICE');
    const threshold = await getApprovalThreshold(client, input.companyId);
    const storedGross = BigInt(row.gross_poisha);
    if (threshold > 0n && storedGross >= threshold) {
      if (row.status !== 'APPROVED' || !row.approved_by || row.approved_by === row.created_by) {
        throw new AppError(
          409,
          row.doc_type === 'CREDIT_NOTE' ? 'SALES_CREDIT_NOTE_APPROVAL_REQUIRED' : 'SALES_DOCUMENT_APPROVAL_REQUIRED',
          'This document is at or above the configured approval threshold. A different controller must approve it before posting.',
          { thresholdPoisha: threshold.toString(), docType: row.doc_type },
        );
      }
    }

    let lines: PreparedLine[];
    if (row.doc_type === 'SALES_INVOICE') {
      const inputs = await rereadStoredInvoiceLines(client, input.companyId, input.documentId);
      const ids = (
        await client.query<{ id: string }>(
          `SELECT id FROM sales_document_lines WHERE company_id = $1 AND document_id = $2 ORDER BY line_no`,
          [input.companyId, input.documentId],
        )
      ).rows.map((entry) => entry.id);
      lines = await prepareInvoiceLines(client, input.companyId, inputs, ids);
    } else {
      if (!row.original_document_id) {
        throw new AppError(409, 'SALES_CREDIT_ORIGINAL_REQUIRED', 'The credit note has no original invoice.');
      }
      const original = await loadOriginalDocument(client, input.companyId, row.original_document_id, true);
      if (original.party_id !== row.party_id) {
        throw new AppError(
          409,
          'SALES_CREDIT_PARTY_MISMATCH',
          'The credit note customer differs from the original invoice.',
        );
      }
      const originalLines = await loadOriginalLines(client, input.companyId, original.id);
      const stored = await rereadStoredCreditLines(client, input.companyId, input.documentId);
      lines = await prepareCreditLines(client, input.companyId, original.id, originalLines, stored.inputs, stored.ids);
    }
    const decision = applyTax(lines, docDate, party.bin);
    assertPostableSalesTax(decision);
    if (decision.grossPoisha <= 0n) {
      throw new AppError(409, 'SALES_ZERO_VALUE', 'The posted document must have a positive value.');
    }
    if (
      decision.grossPoisha !== storedGross ||
      decision.vatPoisha !== BigInt(row.vat_poisha) ||
      decision.subtotalPoisha !== BigInt(row.subtotal_poisha)
    ) {
      throw new AppError(
        409,
        'SALES_REVIEW_REQUIRED',
        'The server-calculated totals changed since the draft was reviewed. Re-open and save the draft before posting.',
        {
          reviewedGrossPoisha: storedGross.toString(),
          calculatedGrossPoisha: decision.grossPoisha.toString(),
          reviewedVatPoisha: row.vat_poisha,
          calculatedVatPoisha: decision.vatPoisha.toString(),
          traceId: decision.traceId,
        },
      );
    }

    const period = await resolvePeriodForNumbering(client, input.companyId, docDate);
    const documentNo = await allocateSalesNumber(
      client,
      input.companyId,
      period.fiscal_year_id,
      period.fiscal_start,
      row.doc_type,
    );
    const serialType = row.doc_type === 'SALES_INVOICE' ? 'MUSHAK_63' : 'MUSHAK_67';
    const statutorySerial = await allocateSalesNumber(
      client,
      input.companyId,
      period.fiscal_year_id,
      period.fiscal_start,
      serialType,
    );

    let stockIssuePlan: Awaited<ReturnType<typeof planSalesStockIssue>> | null = null;
    let stockReturnPlan: Awaited<ReturnType<typeof planSalesStockReturn>> | null = null;
    if (row.doc_type === 'SALES_INVOICE') {
      const stockLines: SalesStockIssueLineInput[] = [];
      for (const line of lines) {
        if (line.isStockItem && line.itemId && line.warehouseId) {
          stockLines.push({
            lineId: line.id,
            itemId: line.itemId,
            warehouseId: line.warehouseId,
            quantity: line.quantity,
          });
        }
      }
      stockIssuePlan = await planSalesStockIssue(client, input.companyId, stockLines);
    } else {
      const returnLines: SalesStockReturnLineInput[] = [];
      for (const line of lines) {
        if (!line.originalMovementId || !line.itemId || !line.warehouseId) continue;
        returnLines.push({
          lineId: line.id,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          quantity: line.quantity,
          originalQuantity: line.originalQuantity ?? line.quantity,
          originalValuePoisha: line.originalValuePoisha ?? 0n,
          originalMovementId: line.originalMovementId,
        });
      }
      stockReturnPlan = await planSalesStockReturn(client, input.companyId, returnLines);
    }

    const journalLines = buildJournalLines({
      docType: row.doc_type as SalesDocumentType,
      partyCode: party.code,
      partyName: party.name_en,
      arAccountId: arAccount.id,
      outputVatAccountId: policy.outputVatAccountId,
      taxDecision: decision,
      lines,
      stockPlanLines: [
        ...(stockIssuePlan?.lines ?? []).map((line) => ({
          inventoryAccountId: line.inventoryAccountId,
          cogsAccountId: line.cogsAccountId,
          valuePoisha: line.valuePoisha,
        })),
        ...(stockReturnPlan?.lines ?? []).map((line) => ({
          inventoryAccountId: line.inventoryAccountId,
          cogsAccountId: line.cogsAccountId,
          valuePoisha: line.valuePoisha,
        })),
      ],
    });
    assertBalancedJournal(journalLines);

    const journal = await postSystemJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      branchId: row.branch_id,
      date: docDate,
      narration: `${row.doc_type === 'SALES_INVOICE' ? 'Sales invoice' : 'Credit note'} ${documentNo} — ${party.name_en}`,
      sourceModule: 'SALES',
      sourceDocId: input.documentId,
      sourceDocRef: documentNo,
      idempotencyKey: `SALES-DOC:${input.documentId}`,
      lines: journalLines,
    });

    if (stockIssuePlan) {
      const movementIds = await applySalesStockIssue(client, {
        companyId: input.companyId,
        documentId: input.documentId,
        documentNo,
        date: docDate,
        journalId: journal.id,
        actorUserId: input.actorUserId,
        plan: stockIssuePlan,
      });
      await updateLineStockMovement(client, input.companyId, input.documentId, movementIds);
    }
    if (stockReturnPlan) {
      const movementIds = await applySalesStockReturn(client, {
        companyId: input.companyId,
        documentId: input.documentId,
        documentNo,
        date: docDate,
        journalId: journal.id,
        actorUserId: input.actorUserId,
        plan: stockReturnPlan,
      });
      await updateLineStockMovement(client, input.companyId, input.documentId, movementIds);
    }

    await updateDocumentLineTax(client, input.companyId, lines);
    await insertTaxEvidence(client, {
      ...input,
      companyId: input.companyId,
      documentId: input.documentId,
      decision,
      lines,
      party,
      docDate,
    });

    try {
      await client.query(
        `UPDATE sales_documents
            SET status = 'POSTED', document_no = $3, statutory_serial = $4, statutory_series = $5,
                subtotal_poisha = $6, discount_poisha = $7, vat_poisha = $8, gross_poisha = $9,
                tax_pack_version = $10, tax_decision_state = $11, tax_snapshot_json = $12::jsonb,
                posted_at = now(), posted_by = $13, posting_idempotency_key = $14,
                updated_by = $13, updated_at = now()
          WHERE company_id = $1 AND id = $2 AND status IN ('DRAFT','APPROVED')`,
        [
          input.companyId,
          input.documentId,
          documentNo,
          statutorySerial,
          row.doc_type === 'SALES_INVOICE' ? 'M63' : 'M67',
          decision.subtotalPoisha.toString(),
          decision.discountPoisha.toString(),
          decision.vatPoisha.toString(),
          decision.grossPoisha.toString(),
          decision.packVersion,
          decision.decisionState,
          JSON.stringify(taxDecisionJson(decision)),
          input.actorUserId,
          input.idempotencyKey,
        ],
      );
    } catch (error) {
      mapSalesConstraintError(error);
    }
    await insertEvent(
      client,
      input.companyId,
      input.documentId,
      'posted',
      row.status,
      'POSTED',
      input.actorUserId,
      null,
      {
        documentNo,
        statutorySerial,
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        grossPoisha: decision.grossPoisha.toString(),
        taxPackVersion: decision.packVersion,
        taxTraceId: decision.traceId,
      },
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'sales.document_posted',
      entityType: 'sales_document',
      entityId: input.documentId,
      before: { status: row.status },
      after: {
        status: 'POSTED',
        documentNo,
        statutorySerial,
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        grossPoisha: decision.grossPoisha.toString(),
        vatPoisha: decision.vatPoisha.toString(),
        taxPackVersion: decision.packVersion,
        taxTraceId: decision.traceId,
      },
      reason: 'Sales document posted with an atomic journal, tax snapshot and stock movement.',
    });
    return { document: await getSalesDocument(client, input.companyId, input.documentId), replayed: false };
  });
}

export async function reverseSalesDocument(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    documentId: string;
    date: string;
    reason: string;
  },
): Promise<{ document: SalesDocumentDto; originalJournalId: string; reversalJournalId: string }> {
  if (!isValidIsoDate(input.date))
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'SALES_REVERSAL_REASON_REQUIRED',
      'A reversal reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status === 'REVERSED') {
      throw new AppError(409, 'SALES_DOCUMENT_ALREADY_REVERSED', 'This sales document has already been reversed.');
    }
    if (row.status !== 'POSTED') {
      throw new AppError(409, 'SALES_DOCUMENT_NOT_POSTED', 'Only a posted sales document can be reversed.');
    }
    const reversalThreshold = await getApprovalThreshold(client, input.companyId);
    if (
      reversalThreshold > 0n &&
      BigInt(row.gross_poisha) >= reversalThreshold &&
      row.created_by === input.actorUserId
    ) {
      throw new AppError(
        403,
        'SALES_REVERSAL_SELF_APPROVAL',
        'The creator of this high-value document cannot reverse it. A different controller must post the reversal.',
        { thresholdPoisha: reversalThreshold.toString() },
      );
    }
    if (row.doc_type === 'SALES_INVOICE') {
      const allocations = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM sales_receipt_allocations al
           JOIN sales_receipts r ON r.company_id = al.company_id AND r.id = al.receipt_id
          WHERE al.company_id = $1 AND al.document_id = $2 AND r.status = 'POSTED'`,
        [input.companyId, input.documentId],
      );
      if (Number(allocations.rows[0]?.count ?? 0) > 0) {
        throw new AppError(
          409,
          'SALES_DOCUMENT_HAS_RECEIPTS',
          'This invoice has posted receipt allocations. Reverse the customer receipt first, then reverse the invoice.',
        );
      }
      const credits = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sales_documents
          WHERE company_id = $1 AND original_document_id = $2
            AND doc_type = 'CREDIT_NOTE' AND status = 'POSTED'`,
        [input.companyId, input.documentId],
      );
      if (Number(credits.rows[0]?.count ?? 0) > 0) {
        throw new AppError(
          409,
          'SALES_DOCUMENT_HAS_CREDIT_NOTES',
          'This invoice has posted credit notes. Reverse the credit notes first, then reverse the invoice.',
        );
      }
    }

    const journalResult = await client.query<{ id: string }>(
      `SELECT id FROM journals
        WHERE company_id = $1 AND source_module = 'SALES' AND source_doc_id = $2
          AND reversal_of_journal_id IS NULL AND status = 'POSTED'
        ORDER BY created_at ASC LIMIT 1`,
      [input.companyId, input.documentId],
    );
    const originalJournalId = journalResult.rows[0]?.id;
    if (!originalJournalId) {
      throw new AppError(
        409,
        'SALES_JOURNAL_MISSING',
        'The posted sales journal could not be found; reversal was rolled back.',
      );
    }
    const reversed = await reverseJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      journalId: originalJournalId,
      date: input.date,
      reason,
    });

    const movements = await client.query<{
      id: string;
      item_id: string;
      warehouse_id: string;
      quantity: string;
      unit_cost_poisha: string;
      value_poisha: string;
      movement_type: string;
    }>(
      `SELECT id, item_id, warehouse_id, quantity::text AS quantity,
              unit_cost_poisha::text AS unit_cost_poisha, value_poisha::text AS value_poisha, movement_type
         FROM stock_movements
        WHERE company_id = $1 AND source_doc_id = $2
          AND movement_type IN ('ISSUE', 'RETURN_IN')
          AND reversal_of_movement_id IS NULL`,
      [input.companyId, input.documentId],
    );
    if (movements.rows.length > 0) {
      const ids = movements.rows.map((movement) => movement.id);
      const already = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM stock_movements
          WHERE company_id = $1 AND reversal_of_movement_id = ANY($2::uuid[])`,
        [input.companyId, ids],
      );
      if (Number(already.rows[0]?.count ?? 0) > 0) {
        throw new AppError(409, 'SALES_STOCK_ALREADY_REVERSED', 'A linked stock movement has already been reversed.');
      }
      const plan = await planSalesStockReversal(
        client,
        input.companyId,
        movements.rows.map((movement) => ({
          movementId: movement.id,
          itemId: movement.item_id,
          warehouseId: movement.warehouse_id,
          quantity: parseStoredQuantity(movement.quantity),
          unitCostPoisha: BigInt(movement.unit_cost_poisha),
          valuePoisha: BigInt(movement.value_poisha),
          movementType: movement.movement_type,
        })),
      );
      await applySalesStockReversal(client, {
        companyId: input.companyId,
        documentId: input.documentId,
        documentNo: row.document_no ?? input.documentId,
        date: input.date,
        journalId: reversed.reversal.id,
        reason,
        actorUserId: input.actorUserId,
        plan,
      });
    }

    await client.query(
      `UPDATE sales_documents
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3,
              reversal_journal_id = $4, updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, input.documentId, input.actorUserId, reversed.reversal.id],
    );
    await insertEvent(
      client,
      input.companyId,
      input.documentId,
      'reversed',
      'POSTED',
      'REVERSED',
      input.actorUserId,
      reason,
      {
        reversalJournalId: reversed.reversal.id,
        reversalJournalNumber: reversed.reversal.journalNumber,
      },
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'sales.document_reversed',
      entityType: 'sales_document',
      entityId: input.documentId,
      before: { status: 'POSTED', journalId: originalJournalId },
      after: { status: 'REVERSED', reversalJournalId: reversed.reversal.id, reason },
      reason,
    });
    return {
      document: await getSalesDocument(client, input.companyId, input.documentId),
      originalJournalId,
      reversalJournalId: reversed.reversal.id,
    };
  });
}

export async function getSalesTaxPolicyForCompany(database: Queryable, companyId: string) {
  return getSalesTaxPolicy(database, companyId);
}
