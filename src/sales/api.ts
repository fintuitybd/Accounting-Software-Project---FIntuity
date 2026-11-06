import { apiRequest } from '../auth/api';

export type SalesDocumentType = 'SALES_INVOICE' | 'CREDIT_NOTE';
export type SalesDocumentStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'REVERSED';

export interface SalesDocumentLine {
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

export interface SalesDocumentEvent {
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

export interface SalesDocument {
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
  lines: SalesDocumentLine[];
  events: SalesDocumentEvent[];
  arOutstandingPoisha: string | null;
  arOutstandingBdt: string | null;
  approvalRequired: boolean;
  approvalThresholdPoisha: string;
  taxPreview: Record<string, unknown>;
}

export interface SalesDocumentSummary {
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

export interface SalesReceiptAllocation {
  id: string;
  documentId: string;
  documentNo: string;
  documentDate: string;
  dueDate: string;
  amountPoisha: string;
  amountBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
}

export interface SalesReceipt {
  id: string;
  companyId: string;
  branchId: string | null;
  status: 'POSTED' | 'REVERSED';
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountId: string;
  bankAccountName: string;
  bankKind: string;
  glAccountCode: string;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
  unappliedPoisha: string;
  unappliedBdt: string;
  reference: string | null;
  attachmentReference: string | null;
  narrationEn: string | null;
  narrationBn: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  allocations: SalesReceiptAllocation[];
}

export interface SalesReceiptSummary {
  id: string;
  status: 'POSTED' | 'REVERSED';
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountName: string;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
  unappliedPoisha: string;
  unappliedBdt: string;
  reference: string | null;
  createdAt: string;
}

export type ArBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_180' | 'OVER_180';

export interface ArAgeingRow {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  allocatedPoisha: string;
  writeOffPoisha: string;
  creditedPoisha: string;
  outstandingPoisha: string;
  outstandingBdt: string;
  daysOverdue: number;
  bucket: ArBucket | 'CREDIT';
}

export interface ArCreditRow {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  unappliedPoisha: string;
  unappliedBdt: string;
}

export interface ArAgeing {
  asOf: string;
  currency: 'BDT';
  rows: ArAgeingRow[];
  credits: ArCreditRow[];
  totals: Record<ArBucket | 'CREDITS' | 'NET', string>;
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

export interface CustomerStatementLine {
  id: string;
  date: string;
  kind: 'SALES_INVOICE' | 'CREDIT_NOTE' | 'RECEIPT' | 'WRITE_OFF';
  reference: string;
  memo: string;
  debitPoisha: string;
  debitBdt: string;
  creditPoisha: string;
  creditBdt: string;
  balancePoisha: string;
  balanceBdt: string;
}

export interface CustomerStatement {
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  from: string;
  to: string;
  openingPoisha: string;
  openingBdt: string;
  debitsPoisha: string;
  creditsPoisha: string;
  closingPoisha: string;
  closingBdt: string;
  lines: CustomerStatementLine[];
}

export interface VatRegisterRow {
  documentId: string;
  docType: SalesDocumentType;
  documentNo: string;
  statutorySerial: string | null;
  docDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyBin: string | null;
  lineNo: number;
  description: string;
  taxCategory: string;
  rateBps: number;
  basePoisha: string;
  baseBdt: string;
  vatPoisha: string;
  vatBdt: string;
}

export interface VatRegister {
  from: string;
  to: string;
  label: string;
  rows: VatRegisterRow[];
  totals: { basePoisha: string; baseBdt: string; vatPoisha: string; vatBdt: string };
}

export interface OpenInvoice {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  outstandingPoisha: string;
  outstandingBdt: string;
}

export interface SalesTaxCategoryConfig {
  category: string;
  rateBps: number;
  ruleId: string | null;
  citation: string | null;
  status: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verifyFlag: boolean | null;
}

export interface SalesTaxPolicy {
  pack: {
    version: string;
    titleEn: string;
    publishedAt: string;
    effectiveFrom: string;
    reviewer: string;
    reviewerStatus: string;
    categories: Record<string, SalesTaxCategoryConfig>;
  };
  approval: {
    status: 'APPROVED';
    packVersion: string;
    reviewerName: string;
    reviewerQualification: string;
    sourceReference: string;
    reviewedAt: string;
    outputVatAccountId: string;
    outputVatAccountCode: string;
    outputVatAccountName: string;
    approvedBy: string;
    approvedAt: string;
  } | null;
  canPost: boolean;
  blockingReason: string | null;
  requiresProfessionalReview: boolean;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const salesApi = {
  documents: (
    companyId: string,
    options: {
      type?: SalesDocumentType;
      status?: SalesDocumentStatus;
      partyId?: string;
      search?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: SalesDocumentSummary[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/sales/documents${queryString(options)}`,
    ),
  document: (companyId: string, documentId: string) =>
    apiRequest<{ document: SalesDocument }>(`/companies/${companyId}/sales/documents/${documentId}`),
  createDraft: (companyId: string, input: SalesDraftInput, idempotencyKey: string) =>
    apiRequest<{ document: SalesDocument; replayed: boolean }>(`/companies/${companyId}/sales/documents`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  updateDraft: (companyId: string, documentId: string, input: SalesDraftInput) =>
    apiRequest<{ document: SalesDocument }>(`/companies/${companyId}/sales/documents/${documentId}`, {
      method: 'PATCH',
      body: input,
    }),
  approve: (companyId: string, documentId: string, reason: string) =>
    apiRequest<{ document: SalesDocument }>(`/companies/${companyId}/sales/documents/${documentId}/approve`, {
      method: 'POST',
      body: { reason },
    }),
  post: (companyId: string, documentId: string, idempotencyKey: string) =>
    apiRequest<{ document: SalesDocument; replayed: boolean }>(
      `/companies/${companyId}/sales/documents/${documentId}/post`,
      { method: 'POST', headers: { 'idempotency-key': idempotencyKey } },
    ),
  reverse: (companyId: string, documentId: string, date: string, reason: string) =>
    apiRequest<{ document: SalesDocument }>(`/companies/${companyId}/sales/documents/${documentId}/reverse`, {
      method: 'POST',
      body: { date, reason },
    }),
  taxPolicy: (companyId: string) =>
    apiRequest<{ policy: SalesTaxPolicy }>(`/companies/${companyId}/sales/tax-policy`),
  approveTaxPolicy: (
    companyId: string,
    input: {
      reviewerName: string;
      reviewerQualification: string;
      sourceReference: string;
      reviewedAt: string;
      outputVatAccountId: string;
      rulePackVersion: string;
    },
  ) =>
    apiRequest<{ policy: SalesTaxPolicy }>(`/companies/${companyId}/sales/tax-policy/approval`, {
      method: 'POST',
      body: input,
    }),
  openInvoices: (companyId: string, options: { partyId?: string; asOf?: string } = {}) =>
    apiRequest<{ invoices: OpenInvoice[] }>(
      `/companies/${companyId}/sales/open-invoices${queryString(options)}`,
    ),
  receipts: (
    companyId: string,
    options: { partyId?: string; from?: string; to?: string; status?: 'POSTED' | 'REVERSED'; limit?: number; offset?: number } = {},
  ) =>
    apiRequest<{ entries: SalesReceiptSummary[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/sales/receipts${queryString(options)}`,
    ),
  receipt: (companyId: string, receiptId: string) =>
    apiRequest<{ receipt: SalesReceipt }>(`/companies/${companyId}/sales/receipts/${receiptId}`),
  postReceipt: (
    companyId: string,
    input: {
      receiptDate: string;
      partyId: string;
      branchId?: string | null;
      bankAccountId: string;
      amount: string;
      writeOffAccountId?: string | null;
      reference?: string | null;
      attachmentReference?: string | null;
      narrationEn?: string | null;
      narrationBn?: string | null;
      allocations: Array<{ documentId: string; amount: string; writeOff?: string | null }>;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ receipt: SalesReceipt; replayed: boolean }>(`/companies/${companyId}/sales/receipts`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  allocateReceipt: (
    companyId: string,
    receiptId: string,
    allocations: Array<{ documentId: string; amount: string }>,
  ) =>
    apiRequest<{ receipt: SalesReceipt }>(`/companies/${companyId}/sales/receipts/${receiptId}/allocations`, {
      method: 'POST',
      body: { allocations },
    }),
  reverseReceipt: (companyId: string, receiptId: string, date: string, reason: string) =>
    apiRequest<{ receipt: SalesReceipt }>(`/companies/${companyId}/sales/receipts/${receiptId}/reverse`, {
      method: 'POST',
      body: { date, reason },
    }),
  ageing: (companyId: string, asOf?: string, partyId?: string) =>
    apiRequest<{ ageing: ArAgeing }>(
      `/companies/${companyId}/sales/ar-ageing${queryString({ asOf, partyId })}`,
    ),
  statement: (companyId: string, partyId: string, from: string, to: string) =>
    apiRequest<{ statement: CustomerStatement }>(
      `/companies/${companyId}/sales/customer-statement${queryString({ partyId, from, to })}`,
    ),
  vatRegister: (companyId: string, from: string, to: string) =>
    apiRequest<{ register: VatRegister }>(
      `/companies/${companyId}/sales/vat-register${queryString({ from, to })}`,
    ),
};
