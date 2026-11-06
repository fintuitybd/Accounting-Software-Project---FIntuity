import { API_BASE, ApiError, apiRequest } from '../auth/api';

export type ReportReviewStatus = 'PENDING_ACCOUNTANT_REVIEW' | 'PENDING_TAX_COUNSEL' | 'APPROVED';

export interface ReportTemplate {
  key: string;
  version: string;
  reviewStatus: ReportReviewStatus;
  source: string;
  labelEn: string;
  labelBn: string;
  filingClaim: false;
}

export interface ReportScope {
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

export interface ReportCheck {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  blocksExport: boolean;
  differencePoisha: string | null;
  detailEn: string;
  detailBn: string;
}

export interface ReportLine {
  accountId: string | null;
  accountCode: string | null;
  accountNameEn: string;
  accountNameBn: string | null;
  amountPoisha: string;
  comparativePoisha: string;
  kind: 'ACCOUNT' | 'DERIVED';
  note: string | null;
}

export interface ReportSection {
  key: string;
  titleEn: string;
  titleBn: string;
  lines: ReportLine[];
  totalPoisha: string;
  comparativeTotalPoisha: string;
}

export interface ReportEnvelope {
  reportKey: string;
  titleEn: string;
  titleBn: string;
  scope: ReportScope;
  basis: string;
  reviewStatus: ReportReviewStatus;
  template: ReportTemplate;
  checks: ReportCheck[];
  canExport: boolean;
  generatedAt: string;
}

export interface ProfitAndLossReport extends ReportEnvelope {
  sections: ReportSection[];
  totals: Record<string, string>;
}

export interface BalanceSheetReport extends ReportEnvelope {
  sections: ReportSection[];
  totals: Record<string, string>;
}

export interface CashFlowReport extends ReportEnvelope {
  method: 'DIRECT';
  sections: ReportSection[];
  cashAccountIds: string[];
  cashAccountCodes: string[];
  openingCashPoisha: string;
  closingCashPoisha: string;
  netChangePoisha: string;
  openingCashComparativePoisha: string;
  closingCashComparativePoisha: string;
  netChangeComparativePoisha: string;
}

export interface ChangesInEquityRow {
  key: string;
  labelEn: string;
  labelBn: string;
  shareCapitalPoisha: string;
  retainedEarningsPoisha: string;
  reservesPoisha: string;
  totalPoisha: string;
  comparativeTotalPoisha: string;
  kind: string;
  accountId: string | null;
}

export interface ChangesInEquityReport extends ReportEnvelope {
  rows: ChangesInEquityRow[];
  openingEquityPoisha: string;
  profitForPeriodPoisha: string;
  ownerMovementsPoisha: string;
  closingEquityPoisha: string;
  comparativeClosingEquityPoisha: string;
}

export interface TrialBalanceReport extends ReportEnvelope {
  trialBalance: {
    from: string;
    to: string;
    balanced: boolean;
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
    totals: Record<string, string>;
  };
}

export interface GeneralLedgerReport extends ReportEnvelope {
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
}

export interface VatRegisterLine {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  documentType: string;
  documentDate: string;
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

export interface VatRegisterReport extends ReportEnvelope {
  direction: 'SALES' | 'PURCHASES';
  rows: VatRegisterLine[];
  lineCount: number;
  totals: Record<string, string>;
  summaryByCategory: Array<Record<string, string | number>>;
  page: number;
  pageSize: number;
}

export interface VatReturnPartRow {
  labelEn: string;
  labelBn: string;
  amountPoisha: string;
  note: string | null;
}

export interface VatReturnPart {
  part: number;
  titleEn: string;
  titleBn: string;
  rows: VatReturnPartRow[];
  totalPoisha: string;
}

export interface ReportException {
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  messageEn: string;
  messageBn: string;
  amountPoisha: string | null;
  documentCount: number | null;
}

export interface VatReturnDraft extends ReportEnvelope {
  filing: {
    status: 'DRAFT';
    canFile: false;
    watermark: 'DRAFT — NOT FILED';
    filingClaim: 'NONE';
  };
  parts: VatReturnPart[];
  totals: Record<string, string>;
  glProof: Record<string, string | null>;
  zeroVariance: boolean;
  exceptions: ReportException[];
}

export interface WithholdingRegister extends ReportEnvelope {
  rows: Array<Record<string, string | number | null>>;
  lineCount: number;
  totals: Array<{ taxType: string; status: string; amountPoisha: string; count: number }>;
  deposits: Array<{ challanId: string; challanNumber: string; depositDate: string; status: string; totalPoisha: string }>;
}

export interface StockValuation extends ReportEnvelope {
  rows: Array<Record<string, string>>;
  lineCount: number;
  totals: Array<{ warehouseId: string; warehouseCode: string; valuePoisha: string; itemCount: number }>;
  totalValuePoisha: string;
  glProof: Record<string, string | string[]>;
}

export interface AgeingReport extends ReportEnvelope {
  ageing: {
    asOf: string;
    rows: Array<Record<string, unknown>>;
    credits: Array<Record<string, unknown>>;
    totals: Record<string, string>;
    proof: {
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
  };
}

export interface JournalListingReport extends ReportEnvelope {
  entries: Array<{
    id: string;
    journalNumber: string | null;
    postingDate: string;
    documentDate: string;
    periodCode: string;
    branchCode: string | null;
    branchName: string | null;
    sourceModule: string;
    sourceDocId: string | null;
    sourceDocRef: string | null;
    narrationEn: string;
    status: string;
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

export interface ReportCatalog {
  company: { id: string; legalName: string; bin: string | null };
  periods: Array<{ id: string; code: string; label: string; startDate: string; endDate: string; status: string; fiscalYearId: string }>;
  fiscalYears: Array<{ id: string; label: string; startDate: string; endDate: string; status: string }>;
  branches: Array<{ id: string; code: string; nameEn: string; nameBn: string | null; isPrincipal: boolean; status: string }>;
  templates: ReportTemplate[];
  definitions: Array<{
    key: string;
    titleEn: string;
    titleBn: string;
    periodSemantics: 'RANGE' | 'AS_OF' | 'BOTH';
    comparativeDefault: string;
    reviewStatus: ReportReviewStatus;
  }>;
}

export type ReportKey =
  | 'TRIAL_BALANCE'
  | 'GENERAL_LEDGER'
  | 'PROFIT_AND_LOSS'
  | 'BALANCE_SHEET'
  | 'CASH_FLOW'
  | 'CHANGES_IN_EQUITY'
  | 'AR_AGEING'
  | 'AP_AGEING'
  | 'STOCK_VALUATION'
  | 'VAT_SALES_REGISTER'
  | 'VAT_PURCHASE_REGISTER'
  | 'VAT_RETURN_DRAFT'
  | 'WITHHOLDING_REGISTER'
  | 'JOURNAL_LISTING';

export interface ReportQuery {
  periodId?: string;
  from?: string;
  to?: string;
  asOf?: string;
  comparativePeriodId?: string;
  comparativeFrom?: string;
  comparativeTo?: string;
  comparativeAsOf?: string;
  branchId?: string;
  partyId?: string;
  accountId?: string;
  page?: number;
  pageSize?: number;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function queryString(query: ReportQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const PATHS: Record<ReportKey, string> = {
  TRIAL_BALANCE: 'trial-balance',
  GENERAL_LEDGER: 'general-ledger',
  PROFIT_AND_LOSS: 'profit-and-loss',
  BALANCE_SHEET: 'balance-sheet',
  CASH_FLOW: 'cash-flow',
  CHANGES_IN_EQUITY: 'changes-in-equity',
  AR_AGEING: 'ar-ageing',
  AP_AGEING: 'ap-ageing',
  STOCK_VALUATION: 'stock-valuation',
  VAT_SALES_REGISTER: 'vat-sales-register',
  VAT_PURCHASE_REGISTER: 'vat-purchase-register',
  VAT_RETURN_DRAFT: 'vat-return',
  WITHHOLDING_REGISTER: 'withholding-register',
  JOURNAL_LISTING: 'journal-listing',
};

export const reportsApi = {
  catalog: (companyId: string) =>
    apiRequest<{ catalog: ReportCatalog }>(`/companies/${companyId}/reports/catalog`),

  run: <T extends ReportEnvelope>(companyId: string, key: ReportKey, query: ReportQuery, accountId?: string) => {
    const path = key === 'GENERAL_LEDGER' && accountId
      ? `/companies/${companyId}/reports/general-ledger/${accountId}${queryString(query)}`
      : `/companies/${companyId}/reports/${PATHS[key]}${queryString(query)}`;
    return apiRequest<{ report: T }>(path);
  },

  exportCsv: async (companyId: string, key: ReportKey, query: ReportQuery): Promise<{ text: string; filename: string | null }> => {
    const response = await fetch(`${API_BASE}/companies/${companyId}/reports/export/${key}${queryString(query)}`, {
      credentials: 'include',
      headers: { accept: 'text/csv' },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        typeof payload?.code === 'string' ? payload.code : 'REPORT_EXPORT_FAILED',
        typeof payload?.message === 'string' ? payload.message : 'The report export could not be generated.',
        { details: payload?.details },
      );
    }
    return {
      text: await response.text(),
      filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? null,
    };
  },

  auditExport: (companyId: string, input: {
    reportKey: ReportKey;
    format: 'XLSX' | 'PDF' | 'PRINT';
    periodId?: string;
    from?: string;
    to?: string;
    asOf?: string;
    comparativePeriodId?: string;
    comparativeFrom?: string;
    comparativeTo?: string;
    comparativeAsOf?: string;
    branchId?: string;
    accountId?: string;
    rowCount?: number;
  }) =>
    apiRequest<{ audited: boolean }>(`/companies/${companyId}/reports/export-audit`, {
      method: 'POST',
      body: input,
    }),
};
