/**
 * Phase 11 report DTOs. Amounts are always integer poisha serialised as decimal strings; the server
 * never returns an authoritative total as a JavaScript number. Every response carries the exact
 * scope, period semantics, template review status and export gate so a caller cannot infer a wider
 * scope or a filed/audited status than the data proves.
 */

export type ReportReviewStatus = 'PENDING_ACCOUNTANT_REVIEW' | 'PENDING_TAX_COUNSEL' | 'APPROVED';

export interface ReportTemplateDto {
  key: string;
  version: string;
  reviewStatus: ReportReviewStatus;
  source: string;
  labelEn: string;
  labelBn: string;
  filingClaim: false;
}

export interface ReportScopeDto {
  companyId: string;
  companyName: string;
  companyBin: string | null;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  branchScope: 'ALL' | 'UNASSIGNED' | 'BRANCH';
  periodId: string | null;
  periodCode: string | null;
  from: string | null;
  to: string | null;
  asOf: string | null;
  comparativeFrom: string | null;
  comparativeTo: string | null;
  comparativeAsOf: string | null;
  labelEn: string;
  labelBn: string;
  comparativeLabelEn: string | null;
  comparativeLabelBn: string | null;
}

export interface ReportCheckDto {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  blocksExport: boolean;
  differencePoisha: string | null;
  detailEn: string;
  detailBn: string;
}

export interface ReportLineDto {
  accountId: string | null;
  accountCode: string | null;
  accountNameEn: string;
  accountNameBn: string | null;
  amountPoisha: string;
  comparativePoisha: string;
  kind: 'ACCOUNT' | 'DERIVED';
  note: string | null;
  noteRef?: string | null;
}

export interface ReportSectionDto {
  key: string;
  titleEn: string;
  titleBn: string;
  lines: ReportLineDto[];
  totalPoisha: string;
  comparativeTotalPoisha: string;
}

export interface ReportEnvelope {
  reportKey: string;
  titleEn: string;
  titleBn: string;
  scope: ReportScopeDto;
  basis: 'POSTED_JOURNALS' | 'POSTED_DOCUMENTS_AND_JOURNALS' | 'STOCK_MOVEMENTS';
  reviewStatus: ReportReviewStatus;
  template: ReportTemplateDto;
  checks: ReportCheckDto[];
  canExport: boolean;
  generatedAt: string;
}

export interface ProfitAndLossDto extends ReportEnvelope {
  sections: ReportSectionDto[];
  totals: {
    revenuePoisha: string;
    costOfSalesPoisha: string;
    grossProfitPoisha: string;
    operatingExpensesPoisha: string;
    operatingProfitPoisha: string;
    investingIncomePoisha: string;
    financeCostsPoisha: string;
    profitBeforeTaxPoisha: string;
    taxExpensePoisha: string;
    profitForPeriodPoisha: string;
    revenueComparativePoisha: string;
    costOfSalesComparativePoisha: string;
    grossProfitComparativePoisha: string;
    operatingExpensesComparativePoisha: string;
    operatingProfitComparativePoisha: string;
    investingIncomeComparativePoisha: string;
    financeCostsComparativePoisha: string;
    profitBeforeTaxComparativePoisha: string;
    taxExpenseComparativePoisha: string;
    profitForPeriodComparativePoisha: string;
    netOperatingRevenuePoisha?: string;
    cogsPoisha?: string;
    investingNetPoisha?: string;
    profitBeforeFinancingAndTaxPoisha?: string;
    financingCostPoisha?: string;
    currentTaxPoisha?: string;
    deferredTaxPoisha?: string;
    netProfitPoisha?: string;
  };
}

export interface BalanceSheetDto extends ReportEnvelope {
  sections: ReportSectionDto[];
  totals: {
    assetsNonCurrentPoisha: string;
    assetsCurrentPoisha: string;
    totalAssetsPoisha: string;
    equityPoisha: string;
    liabilitiesNonCurrentPoisha: string;
    liabilitiesCurrentPoisha: string;
    totalEquityAndLiabilitiesPoisha: string;
    assetsNonCurrentComparativePoisha: string;
    assetsCurrentComparativePoisha: string;
    totalAssetsComparativePoisha: string;
    equityComparativePoisha: string;
    liabilitiesNonCurrentComparativePoisha: string;
    liabilitiesCurrentComparativePoisha: string;
    totalEquityAndLiabilitiesComparativePoisha: string;
    unclosedProfitPoisha: string;
    imbalancePoisha: string;
    accountingEquationDeltaPoisha?: string;
  };
}

export interface CashFlowDto extends ReportEnvelope {
  method: 'DIRECT' | 'INDIRECT';
  sections: ReportSectionDto[];
  cashAccountIds: string[];
  cashAccountCodes: string[];
  openingCashPoisha: string;
  closingCashPoisha: string;
  netChangePoisha: string;
  openingCashComparativePoisha: string;
  closingCashComparativePoisha: string;
  netChangeComparativePoisha: string;
  cashPaidForVdsAndVatPoisha?: string;
  cashPaidForTdsAndAitPoisha?: string;
  indirectMethod?: {
    profitBeforeTaxPoisha: string;
    adjustments: ReportLineDto[];
    workingCapitalChanges: ReportLineDto[];
    cashGeneratedFromOperationsPoisha: string;
    cashPaidForVdsAndVatPoisha: string;
    cashPaidForTdsAndAitPoisha: string;
    netCashFromOperatingActivitiesPoisha: string;
  };
}

export interface ChangesInEquityRowDto {
  key: string;
  labelEn: string;
  labelBn: string;
  shareCapitalPoisha: string;
  retainedEarningsPoisha: string;
  reservesPoisha: string;
  totalPoisha: string;
  comparativeTotalPoisha: string;
  kind: 'OPENING' | 'PROFIT' | 'OWNER' | 'CLOSING' | 'EQUITY_ACCOUNT';
  accountId: string | null;
}

export interface ChangesInEquityDto extends ReportEnvelope {
  rows: ChangesInEquityRowDto[];
  openingEquityPoisha: string;
  profitForPeriodPoisha: string;
  ownerMovementsPoisha: string;
  closingEquityPoisha: string;
  comparativeClosingEquityPoisha: string;
}

export interface TrialBalanceReportDto extends ReportEnvelope {
  trialBalance: {
    companyId: string;
    periodId: string | null;
    periodCode: string | null;
    from: string;
    to: string;
    currency: string;
    rows: Array<{
      accountId: string;
      accountCode: string;
      accountNameEn: string;
      accountNameBn: string | null;
      accountType: string;
      subCategory: string;
      openingDebitPoisha: string;
      openingCreditPoisha: string;
      periodDebitPoisha: string;
      periodCreditPoisha: string;
      closingDebitPoisha: string;
      closingCreditPoisha: string;
    }>;
    totals: {
      openingDebitPoisha: string;
      openingCreditPoisha: string;
      periodDebitPoisha: string;
      periodCreditPoisha: string;
      closingDebitPoisha: string;
      closingCreditPoisha: string;
      differencePoisha: string;
    };
    balanced: boolean;
  };
  lineCount: number;
}

export interface GeneralLedgerReportDto extends ReportEnvelope {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  openingNetPoisha: string;
  closingNetPoisha: string;
  lines: Array<{
    journalId: string;
    journalNumber: string | null;
    postingDate: string;
    status: string;
    sourceModule: string;
    narration: string;
    lineNo: number;
    debitPoisha: string;
    creditPoisha: string;
    runningNetPoisha: string;
    memo: string | null;
    reversalJournalNumber: string | null;
  }>;
  lineCount: number;
}

export interface VatRegisterLineDto {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  documentType: 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_BILL' | 'EXPENSE_VOUCHER';
  documentStatus: 'POSTED';
  documentDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyBin: string | null;
  description: string;
  lineNo: number;
  taxCategory: string;
  rateBps: number;
  basePoisha: string;
  vatPoisha: string;
  claimablePoisha: string;
  disallowedPoisha: string;
}

export interface VatCategorySummaryDto {
  taxCategory: string;
  rateBps: number;
  lineCount: number;
  basePoisha: string;
  vatPoisha: string;
  claimablePoisha: string;
  disallowedPoisha: string;
}

export interface VatRegisterReportDto extends ReportEnvelope {
  direction: 'SALES' | 'PURCHASES';
  rows: VatRegisterLineDto[];
  lineCount: number;
  totals: {
    basePoisha: string;
    vatPoisha: string;
    claimablePoisha: string;
    disallowedPoisha: string;
    creditNoteBasePoisha: string;
    creditNoteVatPoisha: string;
    reversedDocumentCount: number;
  };
  summaryByCategory: VatCategorySummaryDto[];
  page: number;
  pageSize: number;
}

export interface VatReturnPartRowDto {
  labelEn: string;
  labelBn: string;
  amountPoisha: string;
  note: string | null;
}

export interface VatReturnPartDto {
  part: number;
  titleEn: string;
  titleBn: string;
  rows: VatReturnPartRowDto[];
  totalPoisha: string;
}

export interface ReportExceptionDto {
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  messageEn: string;
  messageBn: string;
  amountPoisha: string | null;
  documentCount: number | null;
}

export interface VatReturnDraftDto extends ReportEnvelope {
  filing: {
    status: 'DRAFT';
    canFile: false;
    watermark: 'DRAFT — NOT FILED';
    filingClaim: 'NONE';
  };
  parts: VatReturnPartDto[];
  totals: {
    outputVatPoisha: string;
    inputVatClaimablePoisha: string;
    inputVatDisallowedPoisha: string;
    creditNoteVatPoisha: string;
    vdsWithheldPoisha: string;
    tdsWithheldPoisha: string;
    netPayablePoisha: string;
    excessInputCarriedForwardPoisha: string;
  };
  glProof: {
    outputVatAccountId: string | null;
    outputVatAccountCode: string | null;
    outputVatGlPoisha: string;
    outputVatRegisterPoisha: string;
    outputVatDifferencePoisha: string;
    inputVatAccountId: string | null;
    inputVatAccountCode: string | null;
    inputVatGlPoisha: string;
    inputVatRegisterPoisha: string;
    inputVatDifferencePoisha: string;
    mappingSource: 'TAX_POLICY_APPROVAL' | 'CONTROL_ACCOUNT' | 'UNMAPPED';
  };
  zeroVariance: boolean;
  exceptions: ReportExceptionDto[];
}

export interface WithholdingRegisterRowDto {
  liabilityId: string;
  taxType: 'VDS' | 'TDS' | 'REVERSE_CHARGE';
  sourceType: string;
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
  rateBps: number;
  amountPoisha: string;
  status: string;
  challanId: string | null;
  challanNumber: string | null;
  depositDate: string | null;
  reversedAt: string | null;
}

export interface WithholdingRegisterDto extends ReportEnvelope {
  rows: WithholdingRegisterRowDto[];
  lineCount: number;
  totals: Array<{ taxType: string; status: string; amountPoisha: string; count: number }>;
  deposits: Array<{
    challanId: string;
    challanNumber: string;
    depositDate: string;
    status: string;
    totalPoisha: string;
  }>;
}

export interface StockValuationRowDto {
  itemId: string;
  sku: string;
  itemNameEn: string;
  itemNameBn: string | null;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseNameEn: string;
  quantity: string;
  valuePoisha: string;
  weightedUnitCostPoisha: string;
}

export interface StockValuationDto extends ReportEnvelope {
  rows: StockValuationRowDto[];
  lineCount: number;
  totals: Array<{ warehouseId: string; warehouseCode: string; valuePoisha: string; itemCount: number }>;
  totalValuePoisha: string;
  glProof: {
    inventoryAccountIds: string[];
    inventoryAccountCodes: string[];
    inventoryGlPoisha: string;
    stockValuePoisha: string;
    differencePoisha: string;
  };
}

export interface JournalListingDto extends ReportEnvelope {
  entries: Array<{
    id: string;
    journalNumber: string | null;
    postingDate: string;
    documentDate: string;
    periodCode: string;
    branchId: string | null;
    branchCode: string | null;
    branchName: string | null;
    sourceModule: string;
    sourceDocId: string | null;
    sourceDocRef: string | null;
    narrationEn: string;
    status: string;
    reversalOfJournalId: string | null;
    reversedByJournalId: string | null;
    reversalJournalNumber: string | null;
    originalJournalNumber: string | null;
    totalDebitPoisha: string;
    totalCreditPoisha: string;
    createdByName: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export interface AgeingReportDto extends ReportEnvelope {
  ageing: unknown;
}

export interface ReportCatalogDto {
  company: { id: string; legalName: string; bin: string | null };
  periods: Array<{
    id: string;
    code: string;
    label: string;
    startDate: string;
    endDate: string;
    status: string;
    fiscalYearId: string;
  }>;
  fiscalYears: Array<{ id: string; label: string; startDate: string; endDate: string; status: string }>;
  branches: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameBn: string | null;
    isPrincipal: boolean;
    status: string;
  }>;
  templates: ReportTemplateDto[];
  definitions: Array<{
    key: string;
    titleEn: string;
    titleBn: string;
    periodSemantics: 'RANGE' | 'AS_OF' | 'BOTH';
    comparativeDefault: 'PRIOR_PERIOD' | 'PRIOR_YEAR' | 'NONE';
    reviewStatus: ReportReviewStatus;
  }>;
}
