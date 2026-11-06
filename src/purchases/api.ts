import { apiRequest } from '../auth/api';

export type PurchaseDocumentType = 'PURCHASE_BILL' | 'EXPENSE_VOUCHER';
export type PurchaseDocumentStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type PurchaseTdsNature =
  | 'NONE'
  | 'SUPPLY_OF_GOODS'
  | 'PROFESSIONAL_OR_TECHNICAL_SERVICES'
  | 'COMMERCIAL_RENT'
  | 'ADVERTISING_OR_MEDIA'
  | 'TRANSPORT_OR_LOGISTICS'
  | 'CONTRACTOR_OR_SUBCONTRACTOR';
export type PurchasePaymentMethod = 'BANK' | 'MFS' | 'CASH' | 'CHEQUE' | 'CREDIT_CARD';

export interface PurchaseDocumentLine {
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

export interface PurchaseDocumentEvent {
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

export interface PurchaseDocument {
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
  lines: PurchaseDocumentLine[];
  events: PurchaseDocumentEvent[];
}

export interface PurchaseDocumentSummary {
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
  paymentMethod: PurchasePaymentMethod;
  supplierTinMissing?: boolean | null;
  vdsApplicable?: boolean | null;
  tdsNature?: PurchaseTdsNature | null;
  lines: PurchaseDraftLineInput[];
}

export interface PurchasePaymentAllocation {
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

export interface PurchasePayment {
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
  allocations: PurchasePaymentAllocation[];
}

export interface PurchasePaymentSummary {
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

export interface PaymentPreviewLine {
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

export interface PaymentPreview {
  allocations: PaymentPreviewLine[];
  totalAllocationPoisha: string;
  totalAllocationBdt: string;
  totalVdsPoisha: string;
  totalVdsBdt: string;
  totalTdsPoisha: string;
  totalTdsBdt: string;
  totalCashPoisha: string;
  totalCashBdt: string;
}

export interface PurchasePaymentApproval {
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

export type ApBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_180' | 'OVER_180';

export interface ApAgeingRow {
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

export interface ApAgeing {
  asOf: string;
  currency: 'BDT';
  rows: ApAgeingRow[];
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

export interface SupplierStatementLine {
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

export interface SupplierStatement {
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
  lines: SupplierStatementLine[];
}

export interface OpenBill {
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

export interface WithholdingLiability {
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

export interface WithholdingProof {
  asOf: string;
  vds: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
  tds: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
  reverseCharge: { glPoisha: string; liabilityPoisha: string; differencePoisha: string; agrees: boolean };
}

export interface PurchaseTaxPolicy {
  pack: {
    version: string;
    titleEn: string;
    publishedAt: string;
    effectiveFrom: string;
    reviewer: string;
    reviewerStatus: string;
    vatCategories: Record<string, { rateBps: number; status: string | null; citation: string | null }>;
    vdsRates: Record<string, { rateBps: number; ruleId: string | null }>;
    tdsRates: Record<string, { rateBps: number; ruleId: string | null }>;
  };
  approval:
    | {
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
        inputVatAccountCode: string;
        inputVatAccountName: string;
        vdsPayableAccountCode: string;
        vdsPayableAccountName: string;
        tdsPayableAccountCode: string;
        tdsPayableAccountName: string;
        reverseChargePayableAccountCode: string;
        reverseChargePayableAccountName: string;
      }
    | null;
  canPost: boolean;
  blockingReason: string | null;
  requiresProfessionalReview: true;
}

export const purchaseApi = {
  documents: (
    companyId: string,
    query: {
      type?: PurchaseDocumentType;
      status?: PurchaseDocumentStatus;
      partyId?: string;
      search?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return apiRequest<{ entries: PurchaseDocumentSummary[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/purchases/documents${suffix ? `?${suffix}` : ''}`,
    );
  },
  document: (companyId: string, documentId: string) =>
    apiRequest<{ document: PurchaseDocument }>(`/companies/${companyId}/purchases/documents/${documentId}`),
  createDocument: (companyId: string, input: PurchaseDraftInput, idempotencyKey: string) =>
    apiRequest<{ document: PurchaseDocument; replayed: boolean }>(`/companies/${companyId}/purchases/documents`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  updateDocument: (companyId: string, documentId: string, input: PurchaseDraftInput) =>
    apiRequest<{ document: PurchaseDocument }>(`/companies/${companyId}/purchases/documents/${documentId}`, {
      method: 'PATCH',
      body: input,
    }),
  approveDocument: (companyId: string, documentId: string, reason: string) =>
    apiRequest<{ document: PurchaseDocument }>(
      `/companies/${companyId}/purchases/documents/${documentId}/approve`,
      { method: 'POST', body: { reason } },
    ),
  postDocument: (companyId: string, documentId: string, idempotencyKey: string) =>
    apiRequest<{ document: PurchaseDocument; replayed: boolean }>(
      `/companies/${companyId}/purchases/documents/${documentId}/post`,
      { method: 'POST', headers: { 'idempotency-key': idempotencyKey } },
    ),
  reverseDocument: (companyId: string, documentId: string, date: string, reason: string) =>
    apiRequest<{ document: PurchaseDocument; originalJournalId: string; reversalJournalId: string }>(
      `/companies/${companyId}/purchases/documents/${documentId}/reverse`,
      { method: 'POST', body: { date, reason } },
    ),
  apAgeing: (companyId: string, asOf: string, partyId?: string) => {
    const params = new URLSearchParams({ asOf });
    if (partyId) params.set('partyId', partyId);
    return apiRequest<{ ageing: ApAgeing }>(`/companies/${companyId}/purchases/ap-ageing?${params.toString()}`);
  },
  supplierStatement: (companyId: string, partyId: string, from: string, to: string) =>
    apiRequest<{ statement: SupplierStatement }>(
      `/companies/${companyId}/purchases/supplier-statement?partyId=${partyId}&from=${from}&to=${to}`,
    ),
  openBills: (companyId: string, partyId?: string, asOf?: string) => {
    const params = new URLSearchParams();
    if (partyId) params.set('partyId', partyId);
    if (asOf) params.set('asOf', asOf);
    const suffix = params.toString();
    return apiRequest<{ bills: OpenBill[] }>(`/companies/${companyId}/purchases/open-bills${suffix ? `?${suffix}` : ''}`);
  },
  payments: (
    companyId: string,
    query: { partyId?: string; from?: string; to?: string; status?: 'POSTED' | 'REVERSED'; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return apiRequest<{ entries: PurchasePaymentSummary[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/purchases/payments${suffix ? `?${suffix}` : ''}`,
    );
  },
  payment: (companyId: string, paymentId: string) =>
    apiRequest<{ payment: PurchasePayment }>(`/companies/${companyId}/purchases/payments/${paymentId}`),
  previewPayment: (
    companyId: string,
    input: { paymentDate: string; partyId: string; allocations: Array<{ documentId: string; amount: string }> },
  ) =>
    apiRequest<{ preview: PaymentPreview }>(`/companies/${companyId}/purchases/payments/preview`, {
      method: 'POST',
      body: input,
    }),
  postPayment: (
    companyId: string,
    input: {
      paymentDate: string;
      partyId: string;
      branchId?: string | null;
      bankAccountId: string;
      amount: string;
      reference?: string | null;
      attachmentReference?: string | null;
      narrationEn?: string | null;
      narrationBn?: string | null;
      allocations: Array<{ documentId: string; amount: string }>;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{
      payment?: PurchasePayment;
      approvalRequest?: PurchasePaymentApproval;
      replayed: boolean;
    }>(`/companies/${companyId}/purchases/payments`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  reversePayment: (companyId: string, paymentId: string, date: string, reason: string) =>
    apiRequest<{ payment: PurchasePayment }>(`/companies/${companyId}/purchases/payments/${paymentId}/reverse`, {
      method: 'POST',
      body: { date, reason },
    }),
  paymentApprovals: (
    companyId: string,
    query: { status?: 'PENDING' | 'REJECTED' | 'POSTED'; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return apiRequest<{ entries: PurchasePaymentApproval[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/purchases/payment-approvals${suffix ? `?${suffix}` : ''}`,
    );
  },
  approvePayment: (companyId: string, requestId: string, reason: string) =>
    apiRequest<{ payment: PurchasePayment }>(
      `/companies/${companyId}/purchases/payment-approvals/${requestId}/approve`,
      { method: 'POST', body: { reason } },
    ),
  rejectPayment: (companyId: string, requestId: string, reason: string) =>
    apiRequest<{ approvalRequest: PurchasePaymentApproval }>(
      `/companies/${companyId}/purchases/payment-approvals/${requestId}/reject`,
      { method: 'POST', body: { reason } },
    ),
  withholdingLiabilities: (
    companyId: string,
    query: {
      status?: 'PENDING' | 'DEPOSITED' | 'REVERSED';
      taxType?: 'VDS' | 'TDS' | 'REVERSE_CHARGE';
      from?: string;
      to?: string;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString();
    return apiRequest<{ entries: WithholdingLiability[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/purchases/withholding-liabilities${suffix ? `?${suffix}` : ''}`,
    );
  },
  withholdingProof: (companyId: string, asOf: string) =>
    apiRequest<{ proof: WithholdingProof }>(
      `/companies/${companyId}/purchases/withholding-proof?asOf=${asOf}`,
    ),
  taxPolicy: (companyId: string) =>
    apiRequest<{ policy: PurchaseTaxPolicy }>(`/companies/${companyId}/purchases/tax-policy`),
  approveTaxPolicy: (
    companyId: string,
    input: {
      reviewerName: string;
      reviewerQualification: string;
      sourceReference: string;
      reviewedAt: string;
      inputVatAccountId: string;
      vdsPayableAccountId: string;
      tdsPayableAccountId: string;
      reverseChargePayableAccountId: string;
      rulePackVersion: string;
    },
  ) =>
    apiRequest<{ policy: PurchaseTaxPolicy }>(`/companies/${companyId}/purchases/tax-policy/approval`, {
      method: 'POST',
      body: input,
    }),
};
