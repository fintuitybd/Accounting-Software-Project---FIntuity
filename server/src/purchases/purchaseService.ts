import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, formatIsoDate, isValidIsoDate, parseIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha, parseQuantity } from '../company/money.ts';
import { getCompanySettings } from '../company/settingsService.ts';
import { formatQuantity, parseStoredQuantity } from '../inventory/quantity.ts';
import {
  applyDocumentStockReversal,
  applyPurchaseStockReceipt,
  planDocumentStockReversal,
  planPurchaseStockReceipt,
  type PurchaseStockReceiptLineInput,
} from '../inventory/inventoryService.ts';
import {
  postSystemJournalWithinTransaction,
  reverseJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import {
  assertPostablePurchaseTax,
  calculatePurchaseTax,
  purchaseTaxDecisionJson,
  requireApprovedPurchaseTaxPolicy,
  type PurchaseDecisionState,
  type PurchaseTaxDecision,
  type PurchaseTaxFacts,
} from './tax.ts';
import { PURCHASE_TAX_PACK, type PurchaseTdsNature } from './taxPack.generated.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const PURCHASE_DOCUMENT_TYPES = ['PURCHASE_BILL', 'EXPENSE_VOUCHER'] as const;
export type PurchaseDocumentType = (typeof PURCHASE_DOCUMENT_TYPES)[number];
export const PURCHASE_DOCUMENT_STATUSES = ['DRAFT', 'POSTED', 'REVERSED'] as const;
export type PurchaseDocumentStatus = (typeof PURCHASE_DOCUMENT_STATUSES)[number];

export const PURCHASE_TDS_NATURES = [
  'NONE',
  'SUPPLY_OF_GOODS',
  'PROFESSIONAL_OR_TECHNICAL_SERVICES',
  'COMMERCIAL_RENT',
  'ADVERTISING_OR_MEDIA',
  'TRANSPORT_OR_LOGISTICS',
  'CONTRACTOR_OR_SUBCONTRACTOR',
] as const;
export const PURCHASE_PAYMENT_METHODS = ['BANK', 'MFS', 'CASH', 'CHEQUE', 'CREDIT_CARD'] as const;

export interface PurchaseDraftLineInput {
  itemId?: string | null;
  descriptionEn?: string | null;
  descriptionBn?: string | null;
  quantity: string;
  unit?: string | null;
  unitPrice?: string | null;
  discount?: string | null;
  taxCategory?: string | null;
  accountId?: string | null;
  warehouseId?: string | null;
}

export interface PurchaseDraftInput {
  docType: PurchaseDocumentType;
  partyId: string;
  branchId?: string | null;
  docDate: string;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  supplierMushak63Serial?: string | null;
  supplierMushak63Date?: string | null;
  reverseChargeChallanReference?: string | null;
  attachmentReference?: string | null;
  narrationEn: string;
  narrationBn?: string | null;
  paymentMethod: string;
  supplierTinMissing?: boolean | null;
  vdsApplicable?: boolean | null;
  tdsNature?: string | null;
  lines: PurchaseDraftLineInput[];
}

export interface PurchaseAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface PurchaseDocumentLineDto {
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
  accountId: string;
  accountCode: string;
  accountName: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  stockMovementId: string | null;
  lineBasePoisha: string;
  lineBaseBdt: string;
  vatPoisha: string;
  vatBdt: string;
  vatClaimablePoisha: string;
  vatClaimableBdt: string;
  vatDisallowedPoisha: string;
  vatDisallowedBdt: string;
  costPoisha: string;
  costBdt: string;
  supplierPayablePoisha: string;
  supplierPayableBdt: string;
  taxRateBps: number;
  vdsRateBps: number;
  taxRuleId: string | null;
  taxDecisionState: string;
}

export interface PurchaseDocumentEventDto {
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

export interface PurchaseDocumentDto {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  docType: PurchaseDocumentType;
  status: PurchaseDocumentStatus;
  documentNo: string | null;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  supplierMushak63Serial: string | null;
  supplierMushak63Date: string | null;
  reverseChargeChallanReference: string | null;
  attachmentReference: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  supplierBin: string | null;
  supplierTin: string | null;
  supplierTinMissing: boolean;
  docDate: string;
  dueDate: string;
  paymentTermsDays: number;
  currency: string;
  narrationEn: string;
  narrationBn: string | null;
  paymentMethod: string;
  vdsApplicable: boolean;
  tdsNature: string;
  withholdingEntity: boolean;
  subtotalPoisha: string;
  subtotalBdt: string;
  discountPoisha: string;
  discountBdt: string;
  vatPoisha: string;
  vatBdt: string;
  supplierVatPoisha: string;
  supplierVatBdt: string;
  reverseChargeVatPoisha: string;
  reverseChargeVatBdt: string;
  vatClaimablePoisha: string;
  vatClaimableBdt: string;
  vatDisallowedPoisha: string;
  vatDisallowedBdt: string;
  costPoisha: string;
  costBdt: string;
  grossPoisha: string;
  grossBdt: string;
  vdsPoisha: string;
  vdsBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
  netPayablePoisha: string;
  netPayableBdt: string;
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
  approvalRequired: boolean;
  postedAt: string | null;
  postedBy: string | null;
  postedByName: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  createdAt: string;
  updatedAt: string;
  apOutstandingPoisha: string | null;
  apOutstandingBdt: string | null;
  hasMushak63: boolean;
  lines: PurchaseDocumentLineDto[];
  events: PurchaseDocumentEventDto[];
}

export interface PurchaseDocumentSummaryDto {
  id: string;
  docType: PurchaseDocumentType;
  status: PurchaseDocumentStatus;
  documentNo: string | null;
  supplierInvoiceNo: string;
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
  supplierTinMissing: boolean;
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
  supplier_invoice_no: string;
  supplier_invoice_date: Date;
  supplier_mushak63_serial: string | null;
  supplier_mushak63_date: Date | null;
  reverse_charge_challan_reference: string | null;
  attachment_reference: string | null;
  party_id: string;
  party_code: string;
  party_name_en: string;
  party_name_bn: string | null;
  supplier_bin: string | null;
  supplier_tin: string | null;
  supplier_tin_missing: boolean;
  doc_date: Date;
  due_date: Date;
  payment_terms_days: number;
  currency: string;
  narration_en: string;
  narration_bn: string | null;
  payment_method: string;
  vds_applicable: boolean;
  tds_nature: string;
  withholding_entity: boolean;
  subtotal_poisha: string;
  discount_poisha: string;
  vat_poisha: string;
  supplier_vat_poisha: string;
  reverse_charge_vat_poisha: string;
  vat_claimable_poisha: string;
  vat_disallowed_poisha: string;
  cost_poisha: string;
  gross_poisha: string;
  vds_poisha: string;
  tds_poisha: string;
  net_payable_poisha: string;
  tax_pack_version: string | null;
  tax_decision_state: string | null;
  tax_snapshot_json: Record<string, unknown> | null;
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
  journal_id: string | null;
  journal_number: string | null;
  journal_status: string | null;
  reversal_journal_id: string | null;
  ap_outstanding_poisha: string | null;
}

interface DocumentLineRow {
  id: string;
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
  account_id: string;
  account_code: string;
  account_name: string;
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  stock_movement_id: string | null;
  line_base_poisha: string;
  vat_poisha: string;
  vat_claimable_poisha: string;
  vat_disallowed_poisha: string;
  cost_poisha: string;
  supplier_payable_poisha: string;
  tax_rate_bps: number;
  vds_rate_bps: number;
  tax_rule_id: string | null;
  tax_decision_state: string;
}

interface PreparedLine {
  id: string;
  itemId: string | null;
  itemSku: string | null;
  itemName: string | null;
  itemNameBn: string | null;
  isStockItem: boolean;
  descriptionEn: string;
  descriptionBn: string | null;
  quantity: bigint;
  unit: string;
  unitPricePoisha: bigint;
  discountPoisha: bigint;
  taxCategory: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  warehouseId: string | null;
  lineBasePoisha: bigint;
  vatPoisha: bigint;
  vatClaimablePoisha: bigint;
  vatDisallowedPoisha: bigint;
  costPoisha: bigint;
  supplierPayablePoisha: bigint;
  taxRateBps: number;
  vdsRateBps: number;
  vdsPoisha: bigint;
  taxRuleId: string | null;
  taxDecisionState: PurchaseDecisionState;
}

interface PreparedDocument {
  party: {
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    bin: string | null;
    tin: string | null;
    credit_days: number;
    status: string;
    type: string;
  };
  branch: { id: string; code: string; name_en: string } | null;
  lines: PreparedLine[];
  decision: PurchaseTaxDecision;
  dueDate: string;
  paymentTermsDays: number;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  supplierMushak63Serial: string | null;
  supplierMushak63Date: string | null;
  reverseChargeChallanReference: string | null;
  supplierBin: string | null;
  supplierTin: string | null;
  supplierTinMissing: boolean;
  withholdingEntity: boolean;
  vdsApplicable: boolean;
  tdsNature: string;
  paymentMethod: string;
  hasMushak63: boolean;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.company_id, d.branch_id, b.code AS branch_code, b.name_en AS branch_name,
         d.doc_type, d.status, d.document_no, d.supplier_invoice_no, d.supplier_invoice_date,
         d.supplier_mushak63_serial, d.supplier_mushak63_date, d.reverse_charge_challan_reference,
         d.attachment_reference, d.party_id, p.code AS party_code, p.name_en AS party_name_en,
         p.name_bn AS party_name_bn, d.supplier_bin, d.supplier_tin, d.supplier_tin_missing,
         d.doc_date, d.due_date, d.payment_terms_days, d.currency, d.narration_en, d.narration_bn,
         d.payment_method, d.vds_applicable, d.tds_nature, d.withholding_entity,
         d.subtotal_poisha::text AS subtotal_poisha, d.discount_poisha::text AS discount_poisha,
         d.vat_poisha::text AS vat_poisha, d.supplier_vat_poisha::text AS supplier_vat_poisha,
         d.reverse_charge_vat_poisha::text AS reverse_charge_vat_poisha,
         d.vat_claimable_poisha::text AS vat_claimable_poisha,
         d.vat_disallowed_poisha::text AS vat_disallowed_poisha, d.cost_poisha::text AS cost_poisha,
         d.gross_poisha::text AS gross_poisha, d.vds_poisha::text AS vds_poisha,
         d.tds_poisha::text AS tds_poisha, d.net_payable_poisha::text AS net_payable_poisha,
         d.tax_pack_version, d.tax_decision_state, d.tax_snapshot_json,
         d.created_by, cu.name AS created_by_name, d.approved_at, d.approved_by, au.name AS approved_by_name,
         d.posted_at, d.posted_by, pu.name AS posted_by_name,
         d.reversed_at, d.reversed_by, ru.name AS reversed_by_name, d.created_at, d.updated_at,
         j.id AS journal_id, j.journal_number, j.status AS journal_status,
         d.reversal_journal_id, oi.outstanding_poisha::text AS ap_outstanding_poisha
    FROM purchase_documents d
    JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
    LEFT JOIN branches b ON b.company_id = d.company_id AND b.id = d.branch_id
    JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users au ON au.id = d.approved_by
    LEFT JOIN users pu ON pu.id = d.posted_by
    LEFT JOIN users ru ON ru.id = d.reversed_by
    LEFT JOIN LATERAL (
      SELECT j.id, j.journal_number, j.status
        FROM journals j
       WHERE j.company_id = d.company_id AND j.source_module = 'PURCHASES'
         AND j.source_doc_id = d.id AND j.reversal_of_journal_id IS NULL
       ORDER BY j.created_at ASC
       LIMIT 1
    ) j ON true
    LEFT JOIN purchase_ap_open_items oi ON oi.company_id = d.company_id AND oi.document_id = d.id
   WHERE d.company_id = $1 AND d.id = $2
`;

const LINE_SELECT = `
  SELECT l.id, l.line_no, l.item_id, i.sku AS item_sku, i.name_en AS item_name,
         l.description_en, l.description_bn, l.quantity::text AS quantity, l.unit,
         l.unit_price_poisha::text AS unit_price_poisha, l.discount_poisha::text AS discount_poisha,
         l.tax_category, l.account_id, a.code AS account_code, a.name_en AS account_name,
         l.warehouse_id, w.code AS warehouse_code, w.name_en AS warehouse_name,
         l.stock_movement_id, l.line_base_poisha::text AS line_base_poisha,
         l.vat_poisha::text AS vat_poisha, l.vat_claimable_poisha::text AS vat_claimable_poisha,
         l.vat_disallowed_poisha::text AS vat_disallowed_poisha, l.cost_poisha::text AS cost_poisha,
         l.supplier_payable_poisha::text AS supplier_payable_poisha,
         l.tax_rate_bps, l.vds_rate_bps, l.tax_rule_id, l.tax_decision_state
    FROM purchase_document_lines l
    LEFT JOIN items i ON i.company_id = l.company_id AND i.id = l.item_id
    JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
    LEFT JOIN warehouses w ON w.company_id = l.company_id AND w.id = l.warehouse_id
   WHERE l.company_id = $1 AND l.document_id = $2
   ORDER BY l.line_no ASC
`;

function optionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'PURCHASE_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function requiredText(value: string | null | undefined, max: number, field: string): string {
  const text = value?.trim() ?? '';
  if (!text || text.length > max) {
    throw new AppError(400, 'PURCHASE_FIELD_REQUIRED', `${field} must be between 1 and ${max} characters.`);
  }
  return text;
}

function parseMoney(value: string | null | undefined, field: string): bigint {
  const poisha = parseBdtToPoisha(value ?? '');
  if (poisha === null || poisha < 0n) {
    throw new AppError(
      400,
      'PURCHASE_AMOUNT_INVALID',
      `${field} must be a non-negative BDT amount with up to 2 decimals.`,
    );
  }
  return poisha;
}

function parseLineQuantity(value: string, field: string): bigint {
  const quantity = parseQuantity(value);
  if (quantity === null || quantity <= 0n) {
    throw new AppError(
      400,
      'PURCHASE_QUANTITY_INVALID',
      `${field} must be a positive number with at most four decimals.`,
    );
  }
  return quantity;
}

function addDays(date: string, days: number): string {
  const value = parseIsoDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatIsoDate(value);
}

function dayDifference(from: string, to: string): number {
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

function mapPurchaseConstraintError(error: unknown): never {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505') {
    if (pgError.constraint?.includes('idempotency')) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for this company.');
    }
    if (pgError.constraint?.includes('document_no')) {
      throw new AppError(
        409,
        'PURCHASE_DOCUMENT_NUMBER_CONFLICT',
        'The document-number sequence points at an existing number. Repair the sequence; numbers are never reused.',
      );
    }
  }
  throw error;
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
  if (!party) throw new AppError(404, 'PURCHASE_PARTY_NOT_FOUND', 'Supplier not found.');
  if (requireActive && party.status !== 'ACTIVE') {
    throw new AppError(409, 'PURCHASE_PARTY_INACTIVE', 'Inactive suppliers cannot receive a new purchase document.');
  }
  if (party.type !== 'SUPPLIER' && party.type !== 'BOTH') {
    throw new AppError(400, 'PURCHASE_PARTY_INVALID', 'The selected party is not a supplier.');
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
  if (!branch) throw new AppError(404, 'PURCHASE_BRANCH_NOT_FOUND', 'Branch not found.');
  if (branch.status !== 'ACTIVE') throw new AppError(409, 'PURCHASE_BRANCH_INACTIVE', 'The branch is inactive.');
  return { id: branch.id, code: branch.code, name_en: branch.name_en };
}

interface ItemForPurchase {
  id: string;
  sku: string;
  name_en: string;
  name_bn: string | null;
  unit: string;
  is_stock_item: boolean;
  default_tax_category: string;
  inventory_account_id: string | null;
  expense_account_id: string | null;
  status: string;
}

async function loadItemForPurchase(
  database: Queryable,
  companyId: string,
  itemId: string,
  requireActive = true,
): Promise<ItemForPurchase> {
  const result = await database.query<ItemForPurchase>(
    `SELECT id, sku, name_en, name_bn, unit, is_stock_item, default_tax_category,
            inventory_account_id, expense_account_id, status
       FROM items WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, itemId],
  );
  const item = result.rows[0];
  if (!item) throw new AppError(404, 'PURCHASE_ITEM_NOT_FOUND', 'Item not found.');
  if (requireActive && item.status !== 'ACTIVE') {
    throw new AppError(409, 'PURCHASE_ITEM_INACTIVE', 'Inactive items cannot be purchased.');
  }
  if (item.is_stock_item && !item.inventory_account_id) {
    throw new AppError(409, 'PURCHASE_ITEM_ACCOUNTS_MISSING', 'The stock item is missing its inventory account.');
  }
  return item;
}

async function loadAccountForPurchase(
  database: Queryable,
  companyId: string,
  accountId: string,
): Promise<{ id: string; code: string; name_en: string; account_type: string; control_subledger: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    is_active: boolean;
    account_type: string;
    control_subledger: string;
  }>(
    `SELECT id, code, name_en, is_active, account_type, control_subledger FROM accounts
       WHERE company_id = $1 AND id = $2`,
    [companyId, accountId],
  );
  const account = result.rows[0];
  if (!account) throw new AppError(400, 'PURCHASE_ACCOUNT_INVALID', 'Choose an account from this company.');
  if (!account.is_active) throw new AppError(400, 'PURCHASE_ACCOUNT_INACTIVE', 'The selected account is inactive.');
  if (account.account_type !== 'EXPENSE' && account.account_type !== 'ASSET') {
    throw new AppError(400, 'PURCHASE_ACCOUNT_TYPE', 'A purchase line account must be an EXPENSE or ASSET account.');
  }
  if (account.control_subledger !== 'NONE') {
    throw new AppError(
      400,
      'PURCHASE_ACCOUNT_PROTECTED',
      'A control account cannot be selected directly on a purchase line. Use the item inventory account or an expense account.',
    );
  }
  return {
    id: account.id,
    code: account.code,
    name_en: account.name_en,
    account_type: account.account_type,
    control_subledger: account.control_subledger,
  };
}

async function loadInventoryAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
): Promise<{ id: string; code: string; name_en: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    is_active: boolean;
    account_type: string;
    control_subledger: string;
  }>(
    `SELECT id, code, name_en, is_active, account_type, control_subledger FROM accounts
       WHERE company_id = $1 AND id = $2`,
    [companyId, accountId],
  );
  const account = result.rows[0];
  if (!account) throw new AppError(400, 'PURCHASE_INVENTORY_ACCOUNT_INVALID', 'The item inventory account is missing.');
  if (!account.is_active || account.account_type !== 'ASSET' || account.control_subledger !== 'INVENTORY') {
    throw new AppError(
      400,
      'PURCHASE_INVENTORY_ACCOUNT_INVALID',
      'The item inventory account must be an active INVENTORY control ASSET account.',
    );
  }
  return { id: account.id, code: account.code, name_en: account.name_en };
}

async function loadWarehouseForPurchase(
  database: Queryable,
  companyId: string,
  warehouseId: string,
  requireActive = true,
): Promise<{ id: string; code: string; name_en: string; status: string }> {
  const result = await database.query<{ id: string; code: string; name_en: string; status: string }>(
    `SELECT id, code, name_en, status FROM warehouses WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, warehouseId],
  );
  const warehouse = result.rows[0];
  if (!warehouse) throw new AppError(404, 'PURCHASE_WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
  if (requireActive && warehouse.status !== 'ACTIVE') {
    throw new AppError(409, 'PURCHASE_WAREHOUSE_INACTIVE', 'The warehouse is inactive.');
  }
  return warehouse;
}

async function prepareLines(
  database: Queryable,
  companyId: string,
  docType: PurchaseDocumentType,
  inputs: readonly PurchaseDraftLineInput[],
  options: { allowInactiveMasters?: boolean; existingIds?: readonly string[] } = {},
): Promise<PreparedLine[]> {
  if (inputs.length === 0) throw new AppError(400, 'PURCHASE_LINES_REQUIRED', 'Add at least one purchase line.');
  if (inputs.length > 200)
    throw new AppError(400, 'PURCHASE_TOO_MANY_LINES', 'A purchase document may have at most 200 lines.');
  const allowInactive = options.allowInactiveMasters === true;
  const lines: PreparedLine[] = [];
  for (const [index, input] of inputs.entries()) {
    const lineId = options.existingIds?.[index] ?? randomUUID();
    const quantity = parseLineQuantity(input.quantity, `Line ${index + 1} quantity`);
    let item: ItemForPurchase | null = null;
    if (input.itemId) {
      item = await loadItemForPurchase(database, companyId, input.itemId, !allowInactive);
    }
    if (docType === 'EXPENSE_VOUCHER' && item?.is_stock_item) {
      throw new AppError(
        400,
        'PURCHASE_STOCK_ITEM_NOT_ALLOWED_ON_EXPENSE',
        `Line ${index + 1}: an expense voucher cannot receive stock. Use a purchase bill for stock items.`,
      );
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
    const taxCategory = requiredText(
      input.taxCategory?.trim() || item?.default_tax_category,
      32,
      `Line ${index + 1} tax category`,
    );
    let account: { id: string; code: string; name_en: string };
    const warehouseId: string | null = input.warehouseId ?? null;
    if (item?.is_stock_item) {
      if (!warehouseId) {
        throw new AppError(
          400,
          'PURCHASE_WAREHOUSE_REQUIRED',
          `Line ${index + 1}: choose a warehouse for a stock item.`,
        );
      }
      await loadWarehouseForPurchase(database, companyId, warehouseId, !allowInactive);
      account = await loadInventoryAccount(database, companyId, item.inventory_account_id!);
      if (input.accountId && input.accountId !== account.id) {
        throw new AppError(
          400,
          'PURCHASE_STOCK_ACCOUNT_FIXED',
          `Line ${index + 1}: a stock line must use the item's inventory account.`,
        );
      }
    } else if (warehouseId) {
      throw new AppError(
        400,
        'PURCHASE_WAREHOUSE_NOT_APPLICABLE',
        `Line ${index + 1}: a non-stock line cannot move stock.`,
      );
    } else {
      const accountId = input.accountId?.trim() || item?.expense_account_id;
      if (!accountId) {
        throw new AppError(
          400,
          'PURCHASE_ACCOUNT_REQUIRED',
          `Line ${index + 1}: choose the expense or asset account for this line.`,
        );
      }
      account = await loadAccountForPurchase(database, companyId, accountId);
    }
    lines.push({
      id: lineId,
      itemId: item?.id ?? null,
      itemSku: item?.sku ?? null,
      itemName: item?.name_en ?? null,
      itemNameBn: item?.name_bn ?? null,
      isStockItem: Boolean(item?.is_stock_item),
      descriptionEn,
      descriptionBn,
      quantity,
      unit,
      unitPricePoisha,
      discountPoisha,
      taxCategory,
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name_en,
      warehouseId,
      lineBasePoisha: 0n,
      vatPoisha: 0n,
      vatClaimablePoisha: 0n,
      vatDisallowedPoisha: 0n,
      costPoisha: 0n,
      supplierPayablePoisha: 0n,
      taxRateBps: 0,
      vdsRateBps: 0,
      vdsPoisha: 0n,
      taxRuleId: null,
      taxDecisionState: 'SUPPORTED',
    });
  }
  return lines;
}

function applyTax(lines: PreparedLine[], facts: PurchaseTaxFacts): PurchaseTaxDecision {
  const decision = calculatePurchaseTax({
    facts,
    lines: lines.map((line) => ({
      lineId: line.id,
      quantity: line.quantity,
      unitPricePoisha: line.unitPricePoisha,
      discountPoisha: line.discountPoisha,
      taxCategory: line.taxCategory,
    })),
  });
  const byId = new Map(decision.lines.map((line) => [line.lineId, line]));
  for (const line of lines) {
    const taxLine = byId.get(line.id);
    if (!taxLine) throw new AppError(500, 'PURCHASE_TAX_LINE_MISSING', 'The tax decision did not return every line.');
    line.lineBasePoisha = taxLine.netPoisha;
    line.vatPoisha = taxLine.vatPoisha;
    line.vatClaimablePoisha = taxLine.vatClaimablePoisha;
    line.vatDisallowedPoisha = taxLine.vatDisallowedPoisha;
    line.costPoisha = taxLine.costPoisha;
    line.supplierPayablePoisha = taxLine.supplierPayablePoisha;
    line.taxRateBps = taxLine.rateBps;
    line.vdsRateBps = taxLine.vdsRateBps;
    line.vdsPoisha = taxLine.vdsPoisha;
    line.taxRuleId = taxLine.ruleId;
    line.taxDecisionState = taxLine.decisionState;
  }
  return decision;
}

async function prepareDocument(
  database: Queryable,
  companyId: string,
  input: PurchaseDraftInput,
  options: { allowInactiveMasters?: boolean } = {},
): Promise<PreparedDocument> {
  if (!(PURCHASE_DOCUMENT_TYPES as readonly string[]).includes(input.docType)) {
    throw new AppError(400, 'PURCHASE_DOCUMENT_TYPE_INVALID', 'Choose a supplier bill or an expense voucher.');
  }
  if (!isValidIsoDate(input.docDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real document date in YYYY-MM-DD format.');
  }
  if (!isValidIsoDate(input.supplierInvoiceDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real supplier invoice date in YYYY-MM-DD format.');
  }
  if (input.supplierInvoiceDate > input.docDate) {
    throw new AppError(
      400,
      'PURCHASE_SUPPLIER_INVOICE_DATE_INVALID',
      'The supplier invoice date cannot be after the accounting document date.',
    );
  }
  const party = await loadParty(database, companyId, input.partyId, options.allowInactiveMasters !== true);
  const branch = await loadBranch(database, companyId, input.branchId ?? null);
  const settings = await getCompanySettings(database, companyId);
  let paymentTermsDays = input.paymentTermsDays ?? party.credit_days;
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
    throw new AppError(
      400,
      'PURCHASE_PAYMENT_TERMS_INVALID',
      'Payment terms must be a whole number of days between 0 and 3650.',
    );
  }
  const dueDate = input.dueDate ?? addDays(input.docDate, paymentTermsDays);
  if (!isValidIsoDate(dueDate) || dueDate < input.docDate) {
    throw new AppError(400, 'PURCHASE_DUE_DATE_INVALID', 'Due date must be a real date on or after the document date.');
  }
  if (input.dueDate) paymentTermsDays = dayDifference(input.docDate, dueDate);

  const supplierMushak63Serial = optionalText(input.supplierMushak63Serial, 64, 'Supplier Mushak 6.3 serial');
  const supplierMushak63Date = optionalText(input.supplierMushak63Date, 10, 'Supplier Mushak 6.3 date');
  if ((supplierMushak63Serial && !supplierMushak63Date) || (!supplierMushak63Serial && supplierMushak63Date)) {
    throw new AppError(
      400,
      'PURCHASE_MUSHAK_EVIDENCE_INCOMPLETE',
      'Enter both the supplier Mushak 6.3 serial and its issue date, or leave both blank. The system never invents this evidence.',
    );
  }
  if (supplierMushak63Date && !isValidIsoDate(supplierMushak63Date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real supplier Mushak 6.3 issue date.');
  }
  if (supplierMushak63Date && supplierMushak63Date > input.docDate) {
    throw new AppError(
      400,
      'PURCHASE_MUSHAK_DATE_INVALID',
      'The supplier Mushak 6.3 issue date cannot be after the accounting document date.',
    );
  }
  const reverseChargeChallanReference = optionalText(
    input.reverseChargeChallanReference,
    200,
    'Reverse-charge challan reference',
  );
  const supplierInvoiceNo = requiredText(input.supplierInvoiceNo, 64, 'Supplier invoice number');
  const paymentMethod = requiredText(input.paymentMethod, 20, 'Payment method');
  if (!(PURCHASE_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw new AppError(400, 'PURCHASE_PAYMENT_METHOD_INVALID', 'Choose a supported payment method.');
  }
  const tdsNature = requiredText(input.tdsNature ?? 'NONE', 64, 'TDS nature');
  if (!(PURCHASE_TDS_NATURES as readonly string[]).includes(tdsNature)) {
    throw new AppError(400, 'PURCHASE_TDS_NATURE_INVALID', 'Choose a supported TDS nature.');
  }
  const supplierTinMissing = input.supplierTinMissing === true;
  const withholdingEntity = settings.tax.withholdingEntity;
  const vdsApplicable = input.vdsApplicable ?? withholdingEntity;
  const lines = await prepareLines(database, companyId, input.docType, input.lines, {
    allowInactiveMasters: options.allowInactiveMasters === true,
  });
  const facts: PurchaseTaxFacts = {
    docDate: input.docDate,
    supplierBin: party.bin,
    supplierTin: party.tin,
    supplierTinMissing,
    hasMushak63: Boolean(supplierMushak63Serial && supplierMushak63Date),
    paymentMethod,
    isWithholdingEntity: withholdingEntity,
    vdsApplicable,
    tdsNature,
    reverseChargeChallanHeld: Boolean(reverseChargeChallanReference),
  };
  const decision = applyTax(lines, facts);
  if (decision.grossPoisha <= 0n) {
    throw new AppError(400, 'PURCHASE_ZERO_VALUE', 'A purchase document must have a positive supplier payable.');
  }
  return {
    party,
    branch,
    lines,
    decision,
    dueDate,
    paymentTermsDays,
    supplierInvoiceNo,
    supplierInvoiceDate: input.supplierInvoiceDate,
    supplierMushak63Serial,
    supplierMushak63Date,
    reverseChargeChallanReference,
    supplierBin: party.bin,
    supplierTin: party.tin,
    supplierTinMissing,
    withholdingEntity,
    vdsApplicable,
    tdsNature,
    paymentMethod,
    hasMushak63: Boolean(supplierMushak63Serial && supplierMushak63Date),
  };
}

async function insertDocumentLines(
  client: PoolClient,
  companyId: string,
  documentId: string,
  lines: readonly PreparedLine[],
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO purchase_document_lines (
         id, company_id, document_id, line_no, item_id, description_en, description_bn,
         quantity, unit, unit_price_poisha, discount_poisha, tax_category, account_id,
         warehouse_id, line_base_poisha, vat_poisha, vat_claimable_poisha,
         vat_disallowed_poisha, cost_poisha, supplier_payable_poisha, tax_rate_bps,
         vds_rate_bps, tax_rule_id, tax_decision_state
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
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
        line.accountId,
        line.warehouseId,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.vatClaimablePoisha.toString(),
        line.vatDisallowedPoisha.toString(),
        line.costPoisha.toString(),
        line.supplierPayablePoisha.toString(),
        line.taxRateBps,
        line.vdsRateBps,
        line.taxRuleId,
        line.taxDecisionState,
      ],
    );
  }
}

async function updateDocumentLineTax(
  client: PoolClient,
  companyId: string,
  documentId: string,
  lines: readonly PreparedLine[],
): Promise<void> {
  for (const line of lines) {
    await client.query(
      `UPDATE purchase_document_lines
          SET line_base_poisha = $4, vat_poisha = $5, vat_claimable_poisha = $6,
              vat_disallowed_poisha = $7, cost_poisha = $8, supplier_payable_poisha = $9,
              tax_rate_bps = $10, vds_rate_bps = $11, tax_rule_id = $12, tax_decision_state = $13
        WHERE company_id = $1 AND document_id = $2 AND id = $3`,
      [
        companyId,
        documentId,
        line.id,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.vatClaimablePoisha.toString(),
        line.vatDisallowedPoisha.toString(),
        line.costPoisha.toString(),
        line.supplierPayablePoisha.toString(),
        line.taxRateBps,
        line.vdsRateBps,
        line.taxRuleId,
        line.taxDecisionState,
      ],
    );
  }
}

async function updateLineStockMovement(
  client: PoolClient,
  companyId: string,
  documentId: string,
  movementIds: Map<string, string>,
): Promise<void> {
  for (const [lineId, movementId] of movementIds) {
    await client.query(
      `UPDATE purchase_document_lines SET stock_movement_id = $4
        WHERE company_id = $1 AND document_id = $2 AND id = $3`,
      [companyId, documentId, lineId, movementId],
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
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO purchase_document_events (
       company_id, document_id, action, from_status, to_status, actor_user_id, reason, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [companyId, documentId, action, fromStatus, toStatus, actorUserId, reason, JSON.stringify(metadata)],
  );
}

async function insertDocument(
  client: PoolClient,
  input: PurchaseAuditContext & {
    companyId: string;
    documentId: string;
    document: PreparedDocument;
    draft: PurchaseDraftInput;
    createIdempotencyKey: string | null;
  },
): Promise<void> {
  const { document, draft } = input;
  await client.query(
    `INSERT INTO purchase_documents (
       id, company_id, branch_id, doc_type, status, supplier_invoice_no, supplier_invoice_date,
       supplier_mushak63_serial, supplier_mushak63_date, reverse_charge_challan_reference,
       attachment_reference, party_id, doc_date, due_date, payment_terms_days, currency,
       narration_en, narration_bn, payment_method, supplier_bin, supplier_tin, supplier_tin_missing,
       vds_applicable, tds_nature, withholding_entity, subtotal_poisha, discount_poisha,
       vat_poisha, supplier_vat_poisha, reverse_charge_vat_poisha, vat_claimable_poisha,
       vat_disallowed_poisha, cost_poisha, gross_poisha, vds_poisha, tds_poisha,
       net_payable_poisha, tax_pack_version, tax_decision_state, tax_snapshot_json,
       created_by, updated_by, create_idempotency_key
     ) VALUES (
       $1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'BDT',$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38::jsonb,$39,$39,$40
     )`,
    [
      input.documentId,
      input.companyId,
      document.branch?.id ?? null,
      draft.docType,
      document.supplierInvoiceNo,
      document.supplierInvoiceDate,
      document.supplierMushak63Serial,
      document.supplierMushak63Date,
      document.reverseChargeChallanReference,
      optionalText(draft.attachmentReference, 500, 'Attachment reference'),
      document.party.id,
      draft.docDate,
      document.dueDate,
      document.paymentTermsDays,
      requiredText(draft.narrationEn, 500, 'Narration'),
      optionalText(draft.narrationBn, 500, 'Bangla narration'),
      document.paymentMethod,
      document.supplierBin,
      document.supplierTin,
      document.supplierTinMissing,
      document.vdsApplicable,
      document.tdsNature,
      document.withholdingEntity,
      document.decision.subtotalPoisha.toString(),
      document.decision.discountPoisha.toString(),
      document.decision.vatPoisha.toString(),
      document.decision.supplierVatPoisha.toString(),
      document.decision.reverseChargeVatPoisha.toString(),
      document.decision.vatClaimablePoisha.toString(),
      document.decision.vatDisallowedPoisha.toString(),
      document.decision.costPoisha.toString(),
      document.decision.grossPoisha.toString(),
      document.decision.vdsPoisha.toString(),
      document.decision.tdsPoisha.toString(),
      document.decision.netPayablePoisha.toString(),
      document.decision.packVersion,
      document.decision.decisionState,
      JSON.stringify({ ...purchaseTaxDecisionJson(document.decision), draft: true }),
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

export async function createPurchaseDraft(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    draft: PurchaseDraftInput;
    idempotencyKey?: string | null;
  },
): Promise<{ document: PurchaseDocumentDto; replayed: boolean }> {
  return withTransaction(pool, async (client) => {
    if (input.idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `purchase-draft:${input.companyId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM purchase_documents WHERE company_id = $1 AND create_idempotency_key = $2 LIMIT 1`,
        [input.companyId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { document: await getPurchaseDocument(client, input.companyId, existing.rows[0].id), replayed: true };
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
      mapPurchaseConstraintError(error);
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.document_drafted',
      entityType: 'purchase_document',
      entityId: documentId,
      after: {
        docType: input.draft.docType,
        partyId: input.draft.partyId,
        supplierInvoiceNo: document.supplierInvoiceNo,
        grossPoisha: document.decision.grossPoisha.toString(),
        vatPoisha: document.decision.vatPoisha.toString(),
        vatClaimablePoisha: document.decision.vatClaimablePoisha.toString(),
        vatDisallowedPoisha: document.decision.vatDisallowedPoisha.toString(),
        taxPackVersion: document.decision.packVersion,
      },
      reason: 'Purchase draft created through the server document service.',
    });
    return { document: await getPurchaseDocument(client, input.companyId, documentId), replayed: false };
  });
}

export async function updatePurchaseDraft(
  pool: Pool,
  input: PurchaseAuditContext & { companyId: string; documentId: string; draft: PurchaseDraftInput },
): Promise<PurchaseDocumentDto> {
  return withTransaction(pool, async (client) => {
    const current = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (current.doc_type !== input.draft.docType) {
      throw new AppError(
        400,
        'PURCHASE_DOCUMENT_TYPE_IMMUTABLE',
        'A draft cannot change between a purchase bill and an expense voucher.',
      );
    }
    if (current.status !== 'DRAFT') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_NOT_DRAFT', 'Posted or reversed purchase documents cannot be edited.');
    }
    if (current.approved_by) {
      throw new AppError(
        409,
        'PURCHASE_DOCUMENT_APPROVED_IMMUTABLE',
        'An approved purchase document cannot be edited. Reverse it or create a new draft so the checker sees the final amounts.',
      );
    }
    await client.query(`DELETE FROM purchase_document_lines WHERE company_id = $1 AND document_id = $2`, [
      input.companyId,
      input.documentId,
    ]);
    const document = await prepareDocument(client, input.companyId, input.draft);
    await client.query(
      `UPDATE purchase_documents
          SET branch_id = $3, supplier_invoice_no = $4, supplier_invoice_date = $5,
              supplier_mushak63_serial = $6, supplier_mushak63_date = $7,
              reverse_charge_challan_reference = $8, attachment_reference = $9,
              party_id = $10, doc_date = $11, due_date = $12, payment_terms_days = $13,
              narration_en = $14, narration_bn = $15, payment_method = $16, supplier_bin = $17,
              supplier_tin = $18, supplier_tin_missing = $19, vds_applicable = $20,
              tds_nature = $21, withholding_entity = $22, subtotal_poisha = $23,
              discount_poisha = $24, vat_poisha = $25, supplier_vat_poisha = $26,
              reverse_charge_vat_poisha = $27, vat_claimable_poisha = $28,
              vat_disallowed_poisha = $29, cost_poisha = $30, gross_poisha = $31,
              vds_poisha = $32, tds_poisha = $33, net_payable_poisha = $34,
              tax_pack_version = $35, tax_decision_state = $36, tax_snapshot_json = $37::jsonb,
              updated_by = $38, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.documentId,
        document.branch?.id ?? null,
        document.supplierInvoiceNo,
        document.supplierInvoiceDate,
        document.supplierMushak63Serial,
        document.supplierMushak63Date,
        document.reverseChargeChallanReference,
        optionalText(input.draft.attachmentReference, 500, 'Attachment reference'),
        document.party.id,
        input.draft.docDate,
        document.dueDate,
        document.paymentTermsDays,
        requiredText(input.draft.narrationEn, 500, 'Narration'),
        optionalText(input.draft.narrationBn, 500, 'Bangla narration'),
        document.paymentMethod,
        document.supplierBin,
        document.supplierTin,
        document.supplierTinMissing,
        document.vdsApplicable,
        document.tdsNature,
        document.withholdingEntity,
        document.decision.subtotalPoisha.toString(),
        document.decision.discountPoisha.toString(),
        document.decision.vatPoisha.toString(),
        document.decision.supplierVatPoisha.toString(),
        document.decision.reverseChargeVatPoisha.toString(),
        document.decision.vatClaimablePoisha.toString(),
        document.decision.vatDisallowedPoisha.toString(),
        document.decision.costPoisha.toString(),
        document.decision.grossPoisha.toString(),
        document.decision.vdsPoisha.toString(),
        document.decision.tdsPoisha.toString(),
        document.decision.netPayablePoisha.toString(),
        document.decision.packVersion,
        document.decision.decisionState,
        JSON.stringify({ ...purchaseTaxDecisionJson(document.decision), draft: true }),
        input.actorUserId,
      ],
    );
    await insertDocumentLines(client, input.companyId, input.documentId, document.lines);
    await insertEvent(client, input.companyId, input.documentId, 'updated', 'DRAFT', 'DRAFT', input.actorUserId, null, {
      grossPoisha: document.decision.grossPoisha.toString(),
    });
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.document_updated',
      entityType: 'purchase_document',
      entityId: input.documentId,
      before: { status: current.status, grossPoisha: current.gross_poisha, vatPoisha: current.vat_poisha },
      after: {
        status: 'DRAFT',
        grossPoisha: document.decision.grossPoisha.toString(),
        vatPoisha: document.decision.vatPoisha.toString(),
        vatClaimablePoisha: document.decision.vatClaimablePoisha.toString(),
        vatDisallowedPoisha: document.decision.vatDisallowedPoisha.toString(),
        taxPackVersion: document.decision.packVersion,
      },
      reason: 'Purchase draft updated before posting.',
    });
    return getPurchaseDocument(client, input.companyId, input.documentId);
  });
}

async function loadDocumentRow(
  database: Queryable,
  companyId: string,
  documentId: string,
  forUpdate = false,
): Promise<DocumentRow> {
  const result = await database.query<DocumentRow>(`${DOCUMENT_SELECT}${forUpdate ? ' FOR UPDATE OF d' : ''}`, [
    companyId,
    documentId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found.');
  return row;
}

function mapLine(row: DocumentLineRow): PurchaseDocumentLineDto {
  return {
    id: row.id,
    lineNo: row.line_no,
    itemId: row.item_id,
    itemSku: row.item_sku,
    itemName: row.item_name,
    descriptionEn: row.description_en,
    descriptionBn: row.description_bn,
    quantity: row.quantity,
    unit: row.unit,
    unitPricePoisha: row.unit_price_poisha,
    unitPriceBdt: formatPoishaAsBdt(row.unit_price_poisha),
    discountPoisha: row.discount_poisha,
    discountBdt: formatPoishaAsBdt(row.discount_poisha),
    taxCategory: row.tax_category,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    stockMovementId: row.stock_movement_id,
    lineBasePoisha: row.line_base_poisha,
    lineBaseBdt: formatPoishaAsBdt(row.line_base_poisha),
    vatPoisha: row.vat_poisha,
    vatBdt: formatPoishaAsBdt(row.vat_poisha),
    vatClaimablePoisha: row.vat_claimable_poisha,
    vatClaimableBdt: formatPoishaAsBdt(row.vat_claimable_poisha),
    vatDisallowedPoisha: row.vat_disallowed_poisha,
    vatDisallowedBdt: formatPoishaAsBdt(row.vat_disallowed_poisha),
    costPoisha: row.cost_poisha,
    costBdt: formatPoishaAsBdt(row.cost_poisha),
    supplierPayablePoisha: row.supplier_payable_poisha,
    supplierPayableBdt: formatPoishaAsBdt(row.supplier_payable_poisha),
    taxRateBps: row.tax_rate_bps,
    vdsRateBps: row.vds_rate_bps,
    taxRuleId: row.tax_rule_id,
    taxDecisionState: row.tax_decision_state,
  };
}

async function loadEvents(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<PurchaseDocumentEventDto[]> {
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
       FROM purchase_document_events e
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

export async function getPurchaseDocument(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<PurchaseDocumentDto> {
  const row = await loadDocumentRow(database, companyId, documentId);
  const lineResult = await database.query<DocumentLineRow>(LINE_SELECT, [companyId, documentId]);
  const lines = lineResult.rows.map(mapLine);
  const events = await loadEvents(database, companyId, documentId);
  const settings = await getCompanySettings(database, companyId);
  const threshold = BigInt(settings.approvalThresholds.highValuePoisha);
  const approvalRequired = threshold > 0n && BigInt(row.gross_poisha) >= threshold;
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    docType: row.doc_type as PurchaseDocumentType,
    status: row.status as PurchaseDocumentStatus,
    documentNo: row.document_no,
    supplierInvoiceNo: row.supplier_invoice_no,
    supplierInvoiceDate: formatDatabaseDate(row.supplier_invoice_date),
    supplierMushak63Serial: row.supplier_mushak63_serial,
    supplierMushak63Date: row.supplier_mushak63_date ? formatDatabaseDate(row.supplier_mushak63_date) : null,
    reverseChargeChallanReference: row.reverse_charge_challan_reference,
    attachmentReference: row.attachment_reference,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    partyNameBn: row.party_name_bn,
    supplierBin: row.supplier_bin,
    supplierTin: row.supplier_tin,
    supplierTinMissing: row.supplier_tin_missing,
    docDate: formatDatabaseDate(row.doc_date),
    dueDate: formatDatabaseDate(row.due_date),
    paymentTermsDays: row.payment_terms_days,
    currency: row.currency,
    narrationEn: row.narration_en,
    narrationBn: row.narration_bn,
    paymentMethod: row.payment_method,
    vdsApplicable: row.vds_applicable,
    tdsNature: row.tds_nature,
    withholdingEntity: row.withholding_entity,
    subtotalPoisha: row.subtotal_poisha,
    subtotalBdt: formatPoishaAsBdt(row.subtotal_poisha),
    discountPoisha: row.discount_poisha,
    discountBdt: formatPoishaAsBdt(row.discount_poisha),
    vatPoisha: row.vat_poisha,
    vatBdt: formatPoishaAsBdt(row.vat_poisha),
    supplierVatPoisha: row.supplier_vat_poisha,
    supplierVatBdt: formatPoishaAsBdt(row.supplier_vat_poisha),
    reverseChargeVatPoisha: row.reverse_charge_vat_poisha,
    reverseChargeVatBdt: formatPoishaAsBdt(row.reverse_charge_vat_poisha),
    vatClaimablePoisha: row.vat_claimable_poisha,
    vatClaimableBdt: formatPoishaAsBdt(row.vat_claimable_poisha),
    vatDisallowedPoisha: row.vat_disallowed_poisha,
    vatDisallowedBdt: formatPoishaAsBdt(row.vat_disallowed_poisha),
    costPoisha: row.cost_poisha,
    costBdt: formatPoishaAsBdt(row.cost_poisha),
    grossPoisha: row.gross_poisha,
    grossBdt: formatPoishaAsBdt(row.gross_poisha),
    vdsPoisha: row.vds_poisha,
    vdsBdt: formatPoishaAsBdt(row.vds_poisha),
    tdsPoisha: row.tds_poisha,
    tdsBdt: formatPoishaAsBdt(row.tds_poisha),
    netPayablePoisha: row.net_payable_poisha,
    netPayableBdt: formatPoishaAsBdt(row.net_payable_poisha),
    taxPackVersion: row.tax_pack_version,
    taxDecisionState: row.tax_decision_state,
    taxSnapshot: row.tax_snapshot_json ?? {},
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    journalStatus: row.journal_status,
    reversalJournalId: row.reversal_journal_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvalRequired,
    postedAt: row.posted_at?.toISOString() ?? null,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name,
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedBy: row.reversed_by,
    reversedByName: row.reversed_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    apOutstandingPoisha: row.ap_outstanding_poisha,
    apOutstandingBdt: row.ap_outstanding_poisha === null ? null : formatPoishaAsBdt(row.ap_outstanding_poisha),
    hasMushak63: Boolean(row.supplier_mushak63_serial && row.supplier_mushak63_date),
    lines,
    events,
  };
}

export async function approvePurchaseDocument(
  pool: Pool,
  input: PurchaseAuditContext & { companyId: string; documentId: string; reason?: string | null },
): Promise<PurchaseDocumentDto> {
  return withTransaction(pool, async (client) => {
    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_NOT_DRAFT', 'Only a draft purchase document can be approved.');
    }
    if (row.approved_by) {
      return getPurchaseDocument(client, input.companyId, input.documentId);
    }
    const settings = await getCompanySettings(client, input.companyId);
    const threshold = BigInt(settings.approvalThresholds.highValuePoisha);
    const gross = BigInt(row.gross_poisha);
    if (threshold <= 0n || gross < threshold) {
      throw new AppError(
        409,
        'PURCHASE_APPROVAL_NOT_REQUIRED',
        'This purchase document is below the configured approval threshold and does not need a separate approval.',
      );
    }
    if (row.created_by === input.actorUserId) {
      throw new AppError(403, 'PURCHASE_MAKER_CHECKER', 'The document creator cannot approve their own purchase bill.');
    }
    const reason = input.reason?.trim().slice(0, 500) || 'Purchase document approved above the configured threshold.';
    if (reason.length < 3) {
      throw new AppError(
        400,
        'PURCHASE_APPROVAL_REASON_REQUIRED',
        'An approval reason of at least 3 characters is required.',
      );
    }
    await client.query(
      `UPDATE purchase_documents
          SET approved_at = now(), approved_by = $3, updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'DRAFT' AND approved_by IS NULL`,
      [input.companyId, input.documentId, input.actorUserId],
    );
    await insertEvent(
      client,
      input.companyId,
      input.documentId,
      'approved',
      'DRAFT',
      'DRAFT',
      input.actorUserId,
      reason,
      { thresholdPoisha: threshold.toString(), grossPoisha: gross.toString() },
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.document_approved',
      entityType: 'purchase_document',
      entityId: input.documentId,
      before: { status: 'DRAFT', approvedBy: null },
      after: { status: 'DRAFT', approvedBy: input.actorUserId, thresholdPoisha: threshold.toString() },
      reason,
    });
    return getPurchaseDocument(client, input.companyId, input.documentId);
  });
}

export async function listPurchaseDocuments(
  database: Queryable,
  companyId: string,
  filters: {
    docType?: PurchaseDocumentType;
    status?: PurchaseDocumentStatus;
    partyId?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ entries: PurchaseDocumentSummaryDto[]; total: number; limit: number; offset: number }> {
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
      `(d.document_no ILIKE $${params.length} OR d.supplier_invoice_no ILIKE $${params.length} OR p.name_en ILIKE $${params.length})`,
    );
  }
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
      WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, offset);
  const result = await database.query<{
    id: string;
    doc_type: string;
    status: string;
    document_no: string | null;
    supplier_invoice_no: string;
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
    supplier_tin_missing: boolean;
    created_at: Date;
  }>(
    `SELECT d.id, d.doc_type, d.status, d.document_no, d.supplier_invoice_no, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, p.name_bn AS party_name_bn,
            d.doc_date, d.due_date, d.currency, d.subtotal_poisha::text AS subtotal_poisha,
            d.vat_poisha::text AS vat_poisha, d.gross_poisha::text AS gross_poisha,
            oi.outstanding_poisha::text AS outstanding_poisha, d.supplier_tin_missing, d.created_at
       FROM purchase_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       LEFT JOIN purchase_ap_open_items oi ON oi.company_id = d.company_id AND oi.document_id = d.id
      WHERE ${where.join(' AND ')}
      ORDER BY d.doc_date DESC, d.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      docType: row.doc_type as PurchaseDocumentType,
      status: row.status as PurchaseDocumentStatus,
      documentNo: row.document_no,
      supplierInvoiceNo: row.supplier_invoice_no,
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
      supplierTinMissing: row.supplier_tin_missing,
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(count.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

async function resolvePurchasePeriod(
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

async function allocatePurchaseNumber(
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
      'PURCHASE_SEQUENCE_MISSING',
      `The ${docType} number sequence is not configured for this fiscal year. Repair the fiscal-year numbering setup.`,
    );
  }
  const value = BigInt(sequence.next_value);
  if (value < 1n) throw new AppError(409, 'PURCHASE_SEQUENCE_INVALID', 'The number sequence value must be at least 1.');
  const year = formatDatabaseDate(fiscalStart).slice(0, 4);
  const number = `${sequence.prefix}${year}-${value.toString().padStart(sequence.pad, '0')}`;
  await client.query(
    `UPDATE number_sequences SET next_value = $3, version = version + 1 WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

function addAggregate(target: Map<string, bigint>, accountId: string, amount: bigint): void {
  target.set(accountId, (target.get(accountId) ?? 0n) + amount);
}

function buildJournalLines(input: {
  partyCode: string;
  partyName: string;
  apAccountId: string;
  inputVatAccountId: string;
  reverseChargePayableAccountId: string;
  lines: readonly PreparedLine[];
  decision: PurchaseTaxDecision;
}): JournalLineInput[] {
  const cost = new Map<string, bigint>();
  for (const line of input.lines) addAggregate(cost, line.accountId, line.costPoisha);
  const journalLines: JournalLineInput[] = [];
  const debit = (accountId: string, amount: bigint, memo: string) => {
    if (amount > 0n) {
      journalLines.push({
        accountId,
        debit: formatPoishaAsBdt(amount),
        credit: '0',
        partyReference: input.partyCode,
        partyName: input.partyName,
        memo,
      });
    }
  };
  const credit = (accountId: string, amount: bigint, memo: string) => {
    if (amount > 0n) {
      journalLines.push({
        accountId,
        debit: '0',
        credit: formatPoishaAsBdt(amount),
        partyReference: input.partyCode,
        partyName: input.partyName,
        memo,
      });
    }
  };
  for (const [accountId, amount] of cost) debit(accountId, amount, 'Inventory or expense received');
  debit(input.inputVatAccountId, input.decision.vatClaimablePoisha, 'Input VAT claimable');
  credit(input.apAccountId, input.decision.grossPoisha, 'Trade payable');
  credit(input.reverseChargePayableAccountId, input.decision.reverseChargeVatPoisha, 'Reverse-charge VAT payable');
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
      'PURCHASE_JOURNAL_UNBALANCED',
      'The calculated purchase journal did not balance; posting was rolled back.',
    );
  }
}

async function insertTaxEvidence(
  client: PoolClient,
  input: PurchaseAuditContext & {
    companyId: string;
    documentId: string;
    decision: PurchaseTaxDecision;
    lines: readonly PreparedLine[];
    bill: PreparedDocument;
    docDate: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO purchase_tax_decisions (
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
        partyId: input.bill.party.id,
        supplierBin: input.bill.supplierBin,
        supplierTin: input.bill.supplierTin,
        supplierTinMissing: input.bill.supplierTinMissing,
        hasMushak63: input.bill.hasMushak63,
        supplierMushak63Serial: input.bill.supplierMushak63Serial,
        supplierMushak63Date: input.bill.supplierMushak63Date,
        reverseChargeChallanReference: input.bill.reverseChargeChallanReference,
        paymentMethod: input.bill.paymentMethod,
        withholdingEntity: input.bill.withholdingEntity,
        vdsApplicable: input.bill.vdsApplicable,
        tdsNature: input.bill.tdsNature,
        lines: input.lines.map((line) => ({
          lineId: line.id,
          quantity: line.quantity.toString(),
          unitPricePoisha: line.unitPricePoisha.toString(),
          discountPoisha: line.discountPoisha.toString(),
          taxCategory: line.taxCategory,
          accountId: line.accountId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
        })),
      }),
      JSON.stringify(purchaseTaxDecisionJson(input.decision)),
      input.actorUserId,
    ],
  );
  for (const line of input.lines) {
    await client.query(
      `INSERT INTO purchase_document_taxes (
         company_id, document_id, line_id, tax_type, tax_category, rate_bps, base_poisha,
         amount_poisha, claimable_poisha, disallowed_poisha, rule_id, rule_pack_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.companyId,
        input.documentId,
        line.id,
        line.taxCategory === 'REVERSE_CHARGE' ? 'REVERSE_CHARGE' : 'VAT',
        line.taxCategory,
        line.taxRateBps,
        line.lineBasePoisha.toString(),
        line.vatPoisha.toString(),
        line.vatClaimablePoisha.toString(),
        line.vatDisallowedPoisha.toString(),
        line.taxRuleId,
        input.decision.packVersion,
      ],
    );
  }
  const vdsByRate = new Map<string, { category: string; rate: number; base: bigint; amount: bigint }>();
  for (const line of input.lines) {
    if (line.vdsRateBps <= 0 || line.vdsPoisha <= 0n) continue;
    const key = `${line.taxCategory}|${line.vdsRateBps}`;
    const current = vdsByRate.get(key) ?? {
      category: line.taxCategory,
      rate: line.vdsRateBps,
      base: 0n,
      amount: 0n,
    };
    current.base += line.lineBasePoisha;
    current.amount += line.vdsPoisha;
    vdsByRate.set(key, current);
  }
  for (const vds of vdsByRate.values()) {
    await client.query(
      `INSERT INTO purchase_document_taxes (
         company_id, document_id, line_id, tax_type, tax_category, rate_bps, base_poisha,
         amount_poisha, claimable_poisha, disallowed_poisha, rule_id, rule_pack_version
       ) VALUES ($1,$2,NULL,'VDS',$3,$4,$5,$6,0,0,$7,$8)`,
      [
        input.companyId,
        input.documentId,
        vds.category,
        vds.rate,
        vds.base.toString(),
        vds.amount.toString(),
        PURCHASE_TAX_PACK.vdsRates[vds.category as keyof typeof PURCHASE_TAX_PACK.vdsRates]?.ruleId ?? null,
        input.decision.packVersion,
      ],
    );
  }
  if (input.decision.tdsPoisha > 0n) {
    await client.query(
      `INSERT INTO purchase_document_taxes (
         company_id, document_id, line_id, tax_type, tax_category, rate_bps, base_poisha,
         amount_poisha, claimable_poisha, disallowed_poisha, rule_id, rule_pack_version
       ) VALUES ($1,$2,NULL,'TDS',$3,$4,$5,$6,0,0,$7,$8)`,
      [
        input.companyId,
        input.documentId,
        input.decision.tdsNature,
        input.decision.tdsRateBps,
        input.decision.subtotalPoisha.toString(),
        input.decision.tdsPoisha.toString(),
        PURCHASE_TAX_PACK.tdsRates[input.decision.tdsNature as PurchaseTdsNature]?.ruleId ?? null,
        input.decision.packVersion,
      ],
    );
  }
}

async function rereadStoredLines(
  database: Queryable,
  companyId: string,
  documentId: string,
): Promise<PurchaseDraftLineInput[]> {
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
    accountId: row.account_id,
    warehouseId: row.warehouse_id,
  }));
}

export async function postPurchaseDocument(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    documentId: string;
    idempotencyKey: string;
  },
): Promise<{ document: PurchaseDocumentDto; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required to post a purchase document.',
    );
  }
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `purchase-post:${input.companyId}:${input.idempotencyKey}`,
    ]);
    const existingKey = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM purchase_documents WHERE company_id = $1 AND posting_idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      if (existingKey.rows[0].id !== input.documentId) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'That Idempotency-Key was already used for another purchase document.',
        );
      }
      if (existingKey.rows[0].status === 'REVERSED') {
        throw new AppError(409, 'PURCHASE_DOCUMENT_ALREADY_REVERSED', 'A reversed document cannot be posted again.');
      }
      return { document: await getPurchaseDocument(client, input.companyId, input.documentId), replayed: true };
    }

    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status === 'POSTED') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_ALREADY_POSTED', 'This purchase document is already posted.');
    }
    if (row.status === 'REVERSED') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_ALREADY_REVERSED', 'A reversed document cannot be posted again.');
    }
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_NOT_POSTABLE', `A ${row.status} document cannot be posted.`);
    }
    const docDate = formatDatabaseDate(row.doc_date);
    const policy = await requireApprovedPurchaseTaxPolicy(client, input.companyId, docDate);
    const apAccount = await loadApControlAccount(client, input.companyId);
    const party = await loadParty(client, input.companyId, row.party_id, false);
    const settings = await getCompanySettings(client, input.companyId);
    const approvalThreshold = BigInt(settings.approvalThresholds.highValuePoisha);
    if (
      approvalThreshold > 0n &&
      BigInt(row.gross_poisha) >= approvalThreshold &&
      (!row.approved_by || row.approved_by === row.created_by)
    ) {
      throw new AppError(
        409,
        'PURCHASE_APPROVAL_REQUIRED',
        'This purchase document is at or above the configured approval threshold. A different controller must approve it before posting.',
        { thresholdPoisha: approvalThreshold.toString() },
      );
    }
    const bill: PreparedDocument = {
      party,
      branch: row.branch_id ? { id: row.branch_id, code: row.branch_code ?? '', name_en: row.branch_name ?? '' } : null,
      lines: [],
      decision: null as unknown as PurchaseTaxDecision,
      dueDate: formatDatabaseDate(row.due_date),
      paymentTermsDays: row.payment_terms_days,
      supplierInvoiceNo: row.supplier_invoice_no,
      supplierInvoiceDate: formatDatabaseDate(row.supplier_invoice_date),
      supplierMushak63Serial: row.supplier_mushak63_serial,
      supplierMushak63Date: row.supplier_mushak63_date ? formatDatabaseDate(row.supplier_mushak63_date) : null,
      reverseChargeChallanReference: row.reverse_charge_challan_reference,
      supplierBin: row.supplier_bin,
      supplierTin: row.supplier_tin,
      supplierTinMissing: row.supplier_tin_missing,
      withholdingEntity: settings.tax.withholdingEntity,
      vdsApplicable: row.vds_applicable,
      tdsNature: row.tds_nature,
      paymentMethod: row.payment_method,
      hasMushak63: Boolean(row.supplier_mushak63_serial && row.supplier_mushak63_date),
    };
    const inputs = await rereadStoredLines(client, input.companyId, input.documentId);
    const storedLineIds = (
      await client.query<{ id: string }>(
        `SELECT id FROM purchase_document_lines
          WHERE company_id = $1 AND document_id = $2 ORDER BY line_no ASC`,
        [input.companyId, input.documentId],
      )
    ).rows.map((entry) => entry.id);
    const lines = await prepareLines(client, input.companyId, row.doc_type as PurchaseDocumentType, inputs, {
      allowInactiveMasters: true,
      existingIds: storedLineIds,
    });
    const facts: PurchaseTaxFacts = {
      docDate,
      supplierBin: bill.supplierBin,
      supplierTin: bill.supplierTin,
      supplierTinMissing: bill.supplierTinMissing,
      hasMushak63: bill.hasMushak63,
      paymentMethod: bill.paymentMethod,
      isWithholdingEntity: bill.withholdingEntity,
      vdsApplicable: bill.vdsApplicable,
      tdsNature: bill.tdsNature,
      reverseChargeChallanHeld: Boolean(bill.reverseChargeChallanReference),
    };
    const decision = applyTax(lines, facts);
    bill.lines = lines;
    bill.decision = decision;
    assertPostablePurchaseTax(decision);
    if (decision.grossPoisha <= 0n) {
      throw new AppError(409, 'PURCHASE_ZERO_VALUE', 'The posted document must have a positive supplier payable.');
    }
    if (
      decision.grossPoisha !== BigInt(row.gross_poisha) ||
      decision.vatPoisha !== BigInt(row.vat_poisha) ||
      decision.vatClaimablePoisha !== BigInt(row.vat_claimable_poisha) ||
      decision.vdsPoisha !== BigInt(row.vds_poisha) ||
      decision.tdsPoisha !== BigInt(row.tds_poisha) ||
      decision.subtotalPoisha !== BigInt(row.subtotal_poisha)
    ) {
      throw new AppError(
        409,
        'PURCHASE_REVIEW_REQUIRED',
        'The server-calculated totals changed since the draft was reviewed. Re-open and save the draft before posting.',
        {
          reviewedGrossPoisha: row.gross_poisha,
          calculatedGrossPoisha: decision.grossPoisha.toString(),
          reviewedVatPoisha: row.vat_poisha,
          calculatedVatPoisha: decision.vatPoisha.toString(),
          reviewedVatClaimablePoisha: row.vat_claimable_poisha,
          calculatedVatClaimablePoisha: decision.vatClaimablePoisha.toString(),
          reviewedVdsPoisha: row.vds_poisha,
          calculatedVdsPoisha: decision.vdsPoisha.toString(),
          reviewedTdsPoisha: row.tds_poisha,
          calculatedTdsPoisha: decision.tdsPoisha.toString(),
          traceId: decision.traceId,
        },
      );
    }

    const period = await resolvePurchasePeriod(client, input.companyId, docDate);
    const documentNo = await allocatePurchaseNumber(
      client,
      input.companyId,
      period.fiscal_year_id,
      period.fiscal_start,
      row.doc_type,
    );

    let stockPlan: Awaited<ReturnType<typeof planPurchaseStockReceipt>> | null = null;
    if (lines.some((line) => line.isStockItem)) {
      const stockLines: PurchaseStockReceiptLineInput[] = [];
      for (const line of lines) {
        if (!line.isStockItem || !line.itemId || !line.warehouseId) continue;
        stockLines.push({
          lineId: line.id,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          quantity: line.quantity,
          valuePoisha: line.costPoisha,
        });
      }
      stockPlan = await planPurchaseStockReceipt(client, input.companyId, stockLines);
    }

    const journalLines = buildJournalLines({
      partyCode: party.code,
      partyName: party.name_en,
      apAccountId: apAccount.id,
      inputVatAccountId: policy.inputVatAccountId,
      reverseChargePayableAccountId: policy.reverseChargePayableAccountId,
      lines,
      decision,
    });
    assertBalancedJournal(journalLines);

    const journal = await postSystemJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      branchId: row.branch_id,
      date: docDate,
      narration: `${row.doc_type === 'PURCHASE_BILL' ? 'Purchase bill' : 'Expense voucher'} ${documentNo} — ${party.name_en}`,
      sourceModule: 'PURCHASES',
      sourceDocId: input.documentId,
      sourceDocRef: documentNo,
      idempotencyKey: `PURCHASE-DOC:${input.documentId}`,
      lines: journalLines,
    });

    if (stockPlan) {
      const movementIds = await applyPurchaseStockReceipt(client, {
        companyId: input.companyId,
        documentId: input.documentId,
        documentNo,
        date: docDate,
        journalId: journal.id,
        actorUserId: input.actorUserId,
        plan: stockPlan,
      });
      await updateLineStockMovement(client, input.companyId, input.documentId, movementIds);
    }

    await updateDocumentLineTax(client, input.companyId, input.documentId, lines);
    await insertTaxEvidence(client, {
      ...input,
      companyId: input.companyId,
      documentId: input.documentId,
      decision,
      lines,
      bill,
      docDate,
    });
    await insertBillWithholdingLiabilities(client, {
      ...input,
      companyId: input.companyId,
      documentId: input.documentId,
      lines,
      decision,
      journalId: journal.id,
      partyId: party.id,
      docDate,
    });

    try {
      await client.query(
        `UPDATE purchase_documents
            SET status = 'POSTED', document_no = $3,
                subtotal_poisha = $4, discount_poisha = $5, vat_poisha = $6,
                supplier_vat_poisha = $7, reverse_charge_vat_poisha = $8,
                vat_claimable_poisha = $9, vat_disallowed_poisha = $10, cost_poisha = $11,
                gross_poisha = $12, vds_poisha = $13, tds_poisha = $14, net_payable_poisha = $15,
                tax_pack_version = $16, tax_decision_state = $17, tax_snapshot_json = $18::jsonb,
                posted_at = now(), posted_by = $19, posting_idempotency_key = $20,
                updated_by = $19, updated_at = now()
          WHERE company_id = $1 AND id = $2 AND status = 'DRAFT'`,
        [
          input.companyId,
          input.documentId,
          documentNo,
          decision.subtotalPoisha.toString(),
          decision.discountPoisha.toString(),
          decision.vatPoisha.toString(),
          decision.supplierVatPoisha.toString(),
          decision.reverseChargeVatPoisha.toString(),
          decision.vatClaimablePoisha.toString(),
          decision.vatDisallowedPoisha.toString(),
          decision.costPoisha.toString(),
          decision.grossPoisha.toString(),
          decision.vdsPoisha.toString(),
          decision.tdsPoisha.toString(),
          decision.netPayablePoisha.toString(),
          decision.packVersion,
          decision.decisionState,
          JSON.stringify(purchaseTaxDecisionJson(decision)),
          input.actorUserId,
          input.idempotencyKey,
        ],
      );
    } catch (error) {
      mapPurchaseConstraintError(error);
    }
    await insertEvent(client, input.companyId, input.documentId, 'posted', 'DRAFT', 'POSTED', input.actorUserId, null, {
      documentNo,
      journalId: journal.id,
      journalNumber: journal.journalNumber,
      grossPoisha: decision.grossPoisha.toString(),
      vatClaimablePoisha: decision.vatClaimablePoisha.toString(),
      vdsPoisha: decision.vdsPoisha.toString(),
      tdsPoisha: decision.tdsPoisha.toString(),
      taxPackVersion: decision.packVersion,
      taxTraceId: decision.traceId,
    });
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'purchases.document_posted',
      entityType: 'purchase_document',
      entityId: input.documentId,
      before: { status: 'DRAFT' },
      after: {
        status: 'POSTED',
        documentNo,
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        grossPoisha: decision.grossPoisha.toString(),
        vatPoisha: decision.vatPoisha.toString(),
        vatClaimablePoisha: decision.vatClaimablePoisha.toString(),
        vatDisallowedPoisha: decision.vatDisallowedPoisha.toString(),
        vdsPoisha: decision.vdsPoisha.toString(),
        tdsPoisha: decision.tdsPoisha.toString(),
        taxPackVersion: decision.packVersion,
        taxTraceId: decision.traceId,
      },
      reason: 'Purchase document posted with an atomic journal, tax snapshot, stock receipt and withholding evidence.',
    });
    return { document: await getPurchaseDocument(client, input.companyId, input.documentId), replayed: false };
  });
}

async function loadApControlAccount(
  database: Queryable,
  companyId: string,
): Promise<{ id: string; code: string; nameEn: string }> {
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
      'Configure exactly one active accounts-payable control account before posting purchase documents.',
    );
  }
  if (result.rows.length > 1) {
    throw new AppError(
      409,
      'AP_CONTROL_ACCOUNT_AMBIGUOUS',
      'More than one active AP control account exists. Keep one active AP control account so the subledger has a single control account.',
      { accounts: result.rows.map((row) => row.code) },
    );
  }
  const row = result.rows[0]!;
  return { id: row.id, code: row.code, nameEn: row.name_en };
}

async function insertBillWithholdingLiabilities(
  client: PoolClient,
  input: PurchaseAuditContext & {
    companyId: string;
    documentId: string;
    lines: readonly PreparedLine[];
    decision: PurchaseTaxDecision;
    journalId: string;
    partyId: string;
    docDate: string;
  },
): Promise<void> {
  const periodCode = input.docDate.slice(0, 7);
  for (const line of input.lines) {
    if (line.taxCategory !== 'REVERSE_CHARGE' || line.vatPoisha <= 0n) continue;
    await client.query(
      `INSERT INTO purchase_withholding_liabilities (
         company_id, source_type, bill_id, party_id, tax_type, tax_period, base_poisha,
         rate_bps, amount_poisha, status, journal_id, created_by
       ) VALUES ($1,'BILL',$2,$3,'REVERSE_CHARGE',$4,$5,$6,$7,'PENDING',$8,$9)`,
      [
        input.companyId,
        input.documentId,
        input.partyId,
        periodCode,
        line.lineBasePoisha.toString(),
        line.taxRateBps,
        line.vatPoisha.toString(),
        input.journalId,
        input.actorUserId,
      ],
    );
  }
}

export async function reversePurchaseDocument(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    documentId: string;
    date: string;
    reason: string;
  },
): Promise<{ document: PurchaseDocumentDto; originalJournalId: string; reversalJournalId: string }> {
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
    const row = await loadDocumentRow(client, input.companyId, input.documentId, true);
    if (row.status === 'REVERSED') {
      throw new AppError(
        409,
        'PURCHASE_DOCUMENT_ALREADY_REVERSED',
        'This purchase document has already been reversed.',
      );
    }
    if (row.status !== 'POSTED') {
      throw new AppError(409, 'PURCHASE_DOCUMENT_NOT_POSTED', 'Only a posted purchase document can be reversed.');
    }
    const settings = await getCompanySettings(client, input.companyId);
    const reversalThreshold = BigInt(settings.approvalThresholds.highValuePoisha);
    if (
      reversalThreshold > 0n &&
      BigInt(row.gross_poisha) >= reversalThreshold &&
      row.created_by === input.actorUserId
    ) {
      throw new AppError(
        403,
        'PURCHASE_REVERSAL_SELF_APPROVAL',
        'The creator of this high-value purchase document cannot reverse it. A different controller must post the reversal.',
        { thresholdPoisha: reversalThreshold.toString() },
      );
    }
    const allocations = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM purchase_payment_allocations al
         JOIN purchase_payments p ON p.company_id = al.company_id AND p.id = al.payment_id
        WHERE al.company_id = $1 AND al.document_id = $2 AND p.status = 'POSTED'`,
      [input.companyId, input.documentId],
    );
    if (Number(allocations.rows[0]?.count ?? 0) > 0) {
      throw new AppError(
        409,
        'PURCHASE_DOCUMENT_HAS_PAYMENTS',
        'This document has posted supplier payment allocations. Reverse the payment first, then reverse the document.',
      );
    }
    const deposited = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND bill_id = $2 AND tax_type = 'REVERSE_CHARGE' AND status = 'DEPOSITED'`,
      [input.companyId, input.documentId],
    );
    if (Number(deposited.rows[0]?.count ?? 0) > 0) {
      throw new AppError(
        409,
        'PURCHASE_REVERSE_CHARGE_ALREADY_DEPOSITED',
        'The reverse-charge VAT for this bill has already been deposited. Correct it through the Treasury process instead of reversing the bill.',
      );
    }

    const journalResult = await client.query<{ id: string }>(
      `SELECT id FROM journals
        WHERE company_id = $1 AND source_module = 'PURCHASES' AND source_doc_id = $2
          AND reversal_of_journal_id IS NULL AND status = 'POSTED'
        ORDER BY created_at ASC LIMIT 1`,
      [input.companyId, input.documentId],
    );
    const originalJournalId = journalResult.rows[0]?.id;
    if (!originalJournalId) {
      throw new AppError(
        409,
        'PURCHASE_JOURNAL_MISSING',
        'The posted purchase journal could not be found; reversal was rolled back.',
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
          AND movement_type = 'GRN_RECEIPT' AND reversal_of_movement_id IS NULL`,
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
        throw new AppError(
          409,
          'PURCHASE_STOCK_ALREADY_REVERSED',
          'A linked stock movement has already been reversed.',
        );
      }
      const plan = await planDocumentStockReversal(
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
      await applyDocumentStockReversal(client, {
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
      `UPDATE purchase_withholding_liabilities
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3
        WHERE company_id = $1 AND bill_id = $2 AND tax_type = 'REVERSE_CHARGE' AND status = 'PENDING'`,
      [input.companyId, input.documentId, input.actorUserId],
    );
    await client.query(
      `UPDATE purchase_documents
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
      action: 'purchases.document_reversed',
      entityType: 'purchase_document',
      entityId: input.documentId,
      before: { status: 'POSTED', journalId: originalJournalId },
      after: { status: 'REVERSED', reversalJournalId: reversed.reversal.id, reason },
      reason,
    });
    return {
      document: await getPurchaseDocument(client, input.companyId, input.documentId),
      originalJournalId,
      reversalJournalId: reversed.reversal.id,
    };
  });
}
