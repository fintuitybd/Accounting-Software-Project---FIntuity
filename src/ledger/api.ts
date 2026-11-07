import { apiRequest } from '../auth/api';

export type JournalStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REVERSED';
export type JournalSourceModule =
  | 'SALES'
  | 'PURCHASES'
  | 'BANK_MFS'
  | 'PAYROLL_LITE'
  | 'PAYROLL'
  | 'MANUAL_JOURNAL'
  | 'IFRS_ADJUSTMENT'
  | 'MASS_IMPORT'
  | 'REVERSAL'
  | 'OPENING_BALANCE'
  | 'INVENTORY'
  | 'MANUFACTURING'
  | 'TREASURY'
  | 'BANK_RECONCILIATION'
  | 'SUSPENSE'
  | 'FIXED_ASSETS';

export interface JournalLine {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  partyReference: string | null;
  partyName: string | null;
  costCenter: string | null;
  projectCode: string | null;
  memo: string | null;
}

export interface JournalAuditEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface JournalSummary {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  journalNumber: string | null;
  bookType: string;
  periodId: string;
  periodCode: string;
  documentDate: string;
  postingDate: string;
  sourceModule: JournalSourceModule;
  sourceDocId: string | null;
  sourceDocRef: string | null;
  narrationEn: string;
  narrationBn: string | null;
  currency: string;
  status: JournalStatus;
  idempotencyKeyUsed: boolean;
  attachmentReference: string | null;
  reversalOfJournalId: string | null;
  reversedByJournalId: string | null;
  reversalReason: string | null;
  reversalJournalNumber: string | null;
  originalJournalNumber: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  postedAt: string | null;
  postedBy: string | null;
  postedByName: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  totalDebitPoisha: string;
  totalCreditPoisha: string;
  totalDebitBdt: string;
  totalCreditBdt: string;
  lineCount: number;
  balanced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalSourceEvidence {
  kind: 'SALES_DOCUMENT' | 'PURCHASE_DOCUMENT' | 'OPENING_BALANCE' | 'REVERSAL' | 'MANUAL' | 'OTHER';
  id: string | null;
  reference: string | null;
  status: string | null;
  documentDate: string | null;
  partyName: string | null;
  taxDecisionState: string | null;
  rulePackVersion: string | null;
  taxTraceId: string | null;
  events: Array<{ action: string; actorName: string | null; reason: string | null; createdAt: string }>;
  note: string | null;
}

export interface JournalDetail extends JournalSummary {
  lines: JournalLine[];
  auditTrail: JournalAuditEvent[];
  sourceEvidence: JournalSourceEvidence;
}

export interface JournalLineInput {
  accountId: string;
  debit: string;
  credit: string;
  partyReference?: string | null;
  partyName?: string | null;
  costCenter?: string | null;
  projectCode?: string | null;
  memo?: string | null;
}

export interface JournalInput {
  date: string;
  narration: string;
  narrationBn?: string | null;
  bookType?: 'STATUTORY_BD';
  branchId?: string | null;
  attachmentReference?: string | null;
  lines: JournalLineInput[];
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  accountType: string;
  subCategory: string;
  openingDebitPoisha: string;
  openingCreditPoisha: string;
  openingNetPoisha: string;
  periodDebitPoisha: string;
  periodCreditPoisha: string;
  periodNetPoisha: string;
  closingDebitPoisha: string;
  closingCreditPoisha: string;
  closingNetPoisha: string;
}

export interface TrialBalance {
  companyId: string;
  periodId: string | null;
  periodCode: string | null;
  from: string;
  to: string;
  currency: string;
  rows: TrialBalanceRow[];
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
  generatedAt: string;
}

export interface TrialBalanceLine {
  journalId: string;
  journalNumber: string | null;
  postingDate: string;
  status: string;
  sourceModule: string;
  narration: string;
  lineNo: number;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  runningNetPoisha: string;
  memo: string | null;
  reversalJournalNumber: string | null;
}

export interface TrialBalanceDrill {
  range: { periodId: string | null; periodCode: string | null; from: string; to: string };
  account: TrialBalanceRow;
  lines: TrialBalanceLine[];
}

export interface PeriodStatusChange {
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  reason: string;
}

export interface JournalListFilters {
  from?: string;
  to?: string;
  status?: JournalStatus;
  sourceModule?: JournalSourceModule;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TrialBalanceRange {
  periodId?: string;
  from?: string;
  to?: string;
}

export type FixedAssetCategory =
  | 'BUILDING'
  | 'PLANT_MACHINERY'
  | 'OFFICE_EQUIPMENT'
  | 'FURNITURE'
  | 'VEHICLES'
  | 'COMPUTERS';

export type DepreciationMethod = 'STRAIGHT_LINE' | 'REDUCING_BALANCE';
export type FixedAssetStatus = 'ACTIVE' | 'DISPOSED' | 'WRITTEN_OFF';

export interface FixedAsset {
  id: string;
  companyId: string;
  branchId: string | null;
  assetCode: string;
  nameEn: string;
  nameBn: string | null;
  assetCategory: FixedAssetCategory;
  acquisitionDate: string;
  originalCostPoisha: string;
  originalCostBdt: string;
  salvageValuePoisha: string;
  salvageValueBdt: string;
  usefulLifeMonths: number;
  monthsDepreciated: number;
  depreciationMethod: DepreciationMethod;
  depreciationRateBps: number;
  taxWdvRateBps: number;
  taxWdvPoisha: string;
  taxWdvBdt: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
  status: FixedAssetStatus;
  accumulatedDepreciationPoisha: string;
  accumulatedDepreciationBdt: string;
  carryingAmountPoisha: string;
  carryingAmountBdt: string;
  disposedAt: string | null;
  disposalProceedsPoisha: string | null;
  disposalProceedsBdt: string | null;
  disposalJournalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FixedAssetSummary {
  grossCostPoisha: string;
  grossCostBdt: string;
  accumulatedDepreciationPoisha: string;
  accumulatedDepreciationBdt: string;
  carryingAmountPoisha: string;
  carryingAmountBdt: string;
  taxWdvPoisha: string;
  taxWdvBdt: string;
  temporaryDifferencePoisha: string;
  temporaryDifferenceBdt: string;
  activeAssetCount: number;
  disposedAssetCount: number;
}

export interface CreateFixedAssetInput {
  assetCode: string;
  nameEn: string;
  nameBn?: string | null;
  assetCategory: FixedAssetCategory;
  acquisitionDate: string;
  originalCostBdt: string;
  salvageValueBdt?: string;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  depreciationRateBps: number;
  taxWdvRateBps?: number;
  branchId?: string | null;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
}

export interface DepreciationRunInput {
  periodId: string;
  runDate?: string;
}

export interface DepreciationRunResult {
  run: {
    id: string;
    companyId: string;
    periodId: string;
    runDate: string;
    totalDepreciationPoisha: string;
    totalDepreciationBdt: string;
    journalId: string | null;
    status: 'POSTED' | 'REVERSED';
  };
  journalId?: string | null;
  journalNumber?: string | null;
  totalDepreciationPoisha: string;
  totalDepreciationBdt: string;
  assetsProcessed: number;
}

export interface DisposeFixedAssetInput {
  disposalDate: string;
  proceedsBdt: string;
  bankAccountId: string;
  gainAccountId?: string;
  lossAccountId?: string;
  notes?: string;
}

export interface AssetDisposalResult {
  asset: FixedAsset;
  journalId: string;
  journalNumber?: string | null;
  netDifferencePoisha: string;
  netDifferenceBdt: string;
  isGain: boolean;
  balancingChargePoisha: string;
  balancingChargeBdt: string;
  capitalGainPoisha: string;
  capitalGainBdt: string;
}

function queryString(values: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

export const ledgerApi = {
  journals: (companyId: string, filters: JournalListFilters = {}) =>
    apiRequest<{
      entries: JournalSummary[];
      total: number;
      limit: number;
      offset: number;
    }>(`/companies/${companyId}/journals${queryString(filters)}`),
  journal: (companyId: string, journalId: string) =>
    apiRequest<{ journal: JournalDetail }>(`/companies/${companyId}/journals/${journalId}`),
  createJournal: (companyId: string, input: JournalInput) =>
    apiRequest<{ journal: JournalDetail }>(`/companies/${companyId}/journals`, {
      method: 'POST',
      body: input,
    }),
  updateJournal: (companyId: string, journalId: string, input: JournalInput) =>
    apiRequest<{ journal: JournalDetail }>(`/companies/${companyId}/journals/${journalId}`, {
      method: 'PATCH',
      body: input,
    }),
  submitJournal: (companyId: string, journalId: string) =>
    apiRequest<{ journal: JournalDetail }>(`/companies/${companyId}/journals/${journalId}/submit`, {
      method: 'POST',
    }),
  approveJournal: (companyId: string, journalId: string) =>
    apiRequest<{ journal: JournalDetail }>(`/companies/${companyId}/journals/${journalId}/approve`, {
      method: 'POST',
    }),
  postJournal: (companyId: string, journalId: string, idempotencyKey: string) =>
    apiRequest<{ journal: JournalDetail; replayed: boolean }>(
      `/companies/${companyId}/journals/${journalId}/post`,
      { method: 'POST', headers: { 'idempotency-key': idempotencyKey } },
    ),
  reverseJournal: (companyId: string, journalId: string, input: { date: string; reason: string }) =>
    apiRequest<{ original: JournalDetail; reversal: JournalDetail }>(
      `/companies/${companyId}/journals/${journalId}/reverse`,
      { method: 'POST', body: input },
    ),
  trialBalance: (companyId: string, range: TrialBalanceRange) =>
    apiRequest<{ trialBalance: TrialBalance }>(
      `/companies/${companyId}/trial-balance${queryString(range)}`,
    ),
  trialBalanceAccount: (companyId: string, accountId: string, range: TrialBalanceRange) =>
    apiRequest<TrialBalanceDrill>(
      `/companies/${companyId}/trial-balance/${accountId}${queryString(range)}`,
    ),
  updatePeriod: (companyId: string, periodId: string, input: PeriodStatusChange) =>
    apiRequest<{ period: { id: string; code: string; status: string; reopenedReason: string | null } }>(
      `/companies/${companyId}/periods/${periodId}`,
      { method: 'PATCH', body: input },
    ),
  fixedAssets: (companyId: string) =>
    apiRequest<{ assets: FixedAsset[]; summary: FixedAssetSummary }>(
      `/companies/${companyId}/fixed-assets`,
    ),
  createFixedAsset: (companyId: string, input: CreateFixedAssetInput) =>
    apiRequest<{ asset: FixedAsset }>(`/companies/${companyId}/fixed-assets`, {
      method: 'POST',
      body: input,
    }),
  runDepreciation: (companyId: string, input: DepreciationRunInput) =>
    apiRequest<DepreciationRunResult>(`/companies/${companyId}/fixed-assets/depreciation-run`, {
      method: 'POST',
      body: input,
    }),
  disposeFixedAsset: (companyId: string, assetId: string, input: DisposeFixedAssetInput) =>
    apiRequest<AssetDisposalResult>(`/companies/${companyId}/fixed-assets/${assetId}/dispose`, {
      method: 'POST',
      body: input,
    }),
};
