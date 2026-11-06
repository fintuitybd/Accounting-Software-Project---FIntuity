import { apiRequest } from '../auth/api';

export type OnboardingStepKey =
  | 'COMPANY'
  | 'FISCAL_YEAR'
  | 'CHART_OF_ACCOUNTS'
  | 'OPENING_BALANCES'
  | 'BANK_ACCOUNTS'
  | 'SETTINGS';

export interface OnboardingStatus {
  companyId: string;
  currentStep: OnboardingStepKey;
  completedAt: string | null;
  percent: number;
  canComplete: boolean;
  steps: Array<{ key: OnboardingStepKey; title: string; complete: boolean; detail: string }>;
}

export interface CompanyProfile {
  id: string;
  organisationId: string;
  legalName: string;
  tradeName: string | null;
  entityType: string | null;
  industry: string | null;
  tin: string | null;
  bin: string | null;
  rjscNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  reportingFramework: string | null;
  baseCurrency: string;
  timezone: string;
  status: string;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalPeriod {
  id: string;
  companyId: string;
  fiscalYearId: string;
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
  lockedAt: string | null;
  reopenedReason: string | null;
}

export interface FiscalYear {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
  periods: FiscalPeriod[];
}

export interface SetupAccount {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountType: string;
  subCategory: string;
  ifrsCategory: string;
  parentId: string | null;
  parentCode: string | null;
  controlSubledger: string;
  currency: string;
  taxMapping: Record<string, string>;
  isActive: boolean;
  isControl: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningSchedule {
  name?: string;
  reference?: string;
  dueDate?: string;
  quantity?: string;
  unitCost?: string;
  assetClass?: string;
  usefulLifeMonths?: number;
  accumulatedDepreciation?: string;
}

export interface OpeningLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  scheduleType: string;
  schedule: OpeningSchedule;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  memo: string | null;
}

export interface OpeningBatch {
  id: string;
  companyId: string;
  periodId: string;
  periodCode: string;
  batchDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  currency: string;
  totalDebitPoisha: string;
  totalCreditPoisha: string;
  totalDebitBdt: string;
  totalCreditBdt: string;
  balanced: boolean;
  differencePoisha: string;
  differenceBdt: string;
  evidenceReference: string | null;
  evidenceNote: string | null;
  evidenceChecksum: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  createdAt: string;
  updatedAt: string;
  lines: OpeningLine[];
}

export interface BankAccount {
  id: string;
  companyId: string;
  name: string;
  kind: 'BANK' | 'MFS' | 'CASH';
  provider: string | null;
  maskedNumber: string | null;
  branch: string | null;
  currency: string;
  glAccountId: string;
  glAccountCode: string;
  glAccountName: string;
  openingPoisha: string;
  openingBdt: string;
  status: 'ACTIVE' | 'INACTIVE';
  isPrincipal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NumberSequence {
  id: string;
  companyId: string;
  fiscalYearId: string;
  docType: string;
  prefix: string;
  nextValue: string;
  pad: number;
  version: number;
  updatedAt: string;
}

export interface CompanySettings {
  companyId: string;
  reportingFramework: string | null;
  timezone: string;
  baseCurrency: string;
  language: string;
  approvalThresholds: { highValuePoisha: string; paymentPoisha: string };
  tax: {
    vatStatus: string | null;
    filingFrequency: string;
    withholdingEntity: boolean;
    notes: string;
  };
  numberSequences: NumberSequence[];
}

export interface CompanyProfileInput {
  legalName: string;
  tradeName?: string | null;
  entityType: string;
  industry: string;
  tin?: string | null;
  bin?: string | null;
  rjscNo?: string | null;
  address: string;
  phone?: string | null;
  email?: string | null;
  reportingFramework: string;
}

export interface SetupAccountInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  accountType: string;
  subCategory: string;
  ifrsCategory: string;
  parentId?: string | null;
  controlSubledger: string;
  taxMapping: Record<string, string>;
  isActive: boolean;
}

export interface OpeningLineInput {
  accountId: string;
  scheduleType: string;
  schedule: OpeningSchedule;
  debit: string;
  credit: string;
  memo?: string | null;
}

export interface OpeningBatchInput {
  batchDate: string;
  evidenceReference?: string | null;
  evidenceNote?: string | null;
  evidenceChecksum?: string | null;
  lines: OpeningLineInput[];
}

export interface BankAccountInput {
  name: string;
  kind: 'BANK' | 'MFS' | 'CASH';
  provider?: string | null;
  maskedNumber?: string | null;
  branch?: string | null;
  glAccountId: string;
  openingBalance: string;
  isPrincipal?: boolean;
}

export interface SettingsPatch {
  language?: 'en-BD' | 'bn-BD';
  reportingFramework?: string;
  approvalThresholds?: { highValue?: string; payment?: string };
  tax?: {
    vatStatus?: string | null;
    filingFrequency?: string;
    withholdingEntity?: boolean;
    notes?: string;
  };
  fiscalYearId?: string;
  numberSequences?: Array<{ docType: string; prefix: string; nextValue: string; pad: number }>;
}

type Json = Record<string, unknown>;

export const setupApi = {
  createCompany: (organisationId: string, profile: CompanyProfileInput) =>
    apiRequest<{ company: CompanyProfile; onboarding: OnboardingStatus }>(
      `/organisations/${organisationId}/companies`,
      { method: 'POST', body: profile },
    ),
  profile: (companyId: string) =>
    apiRequest<{ company: CompanyProfile }>(`/companies/${companyId}/profile`),
  updateProfile: (companyId: string, patch: Partial<CompanyProfileInput>) =>
    apiRequest<{ company: CompanyProfile; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/profile`,
      { method: 'PATCH', body: patch },
    ),
  onboarding: (companyId: string) =>
    apiRequest<{ onboarding: OnboardingStatus }>(`/companies/${companyId}/onboarding`),
  setOnboardingStep: (companyId: string, currentStep: OnboardingStepKey) =>
    apiRequest<{ onboarding: OnboardingStatus }>(`/companies/${companyId}/onboarding`, {
      method: 'PATCH',
      body: { currentStep },
    }),
  completeOnboarding: (companyId: string) =>
    apiRequest<{ onboarding: OnboardingStatus }>(`/companies/${companyId}/onboarding/complete`, {
      method: 'POST',
    }),
  fiscalYears: (companyId: string) =>
    apiRequest<{ fiscalYears: FiscalYear[] }>(`/companies/${companyId}/fiscal-years`),
  createFiscalYear: (companyId: string, input: { startDate: string; endDate: string; label?: string }) =>
    apiRequest<{ fiscalYear: FiscalYear; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/fiscal-years`,
      { method: 'POST', body: input },
    ),
  periods: (companyId: string) =>
    apiRequest<{ periods: FiscalPeriod[] }>(`/companies/${companyId}/periods`),
  resolvePeriod: (companyId: string, date: string) =>
    apiRequest<{ date: string; period: FiscalPeriod }>(
      `/companies/${companyId}/periods/resolve?date=${encodeURIComponent(date)}`,
    ),
  accounts: (companyId: string, options: { includeInactive?: boolean; search?: string } = {}) => {
    const search = new URLSearchParams();
    if (options.includeInactive) search.set('includeInactive', 'true');
    if (options.search) search.set('search', options.search);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return apiRequest<{ accounts: SetupAccount[] }>(`/companies/${companyId}/accounts${suffix}`);
  },
  createAccount: (companyId: string, input: SetupAccountInput) =>
    apiRequest<{ account: SetupAccount; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/accounts`,
      { method: 'POST', body: input },
    ),
  updateAccount: (companyId: string, accountId: string, input: SetupAccountInput) =>
    apiRequest<{ account: SetupAccount; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/accounts/${accountId}`,
      { method: 'PATCH', body: input },
    ),
  importAccounts: (
    companyId: string,
    input: { format: 'CSV' | 'XLSX'; content?: string; rows?: Json[] },
  ) =>
    apiRequest<{ imported: number; accounts: SetupAccount[]; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/accounts/import`,
      { method: 'POST', body: input },
    ),
  importTemplate: (companyId: string) =>
    apiRequest<{ filename: string; content: string; columns: string[] }>(
      `/companies/${companyId}/accounts/import-template`,
    ),
  openingBatches: (companyId: string) =>
    apiRequest<{ batches: OpeningBatch[] }>(`/companies/${companyId}/opening-balances`),
  openingBatch: (companyId: string, batchId: string) =>
    apiRequest<{ batch: OpeningBatch }>(`/companies/${companyId}/opening-balances/${batchId}`),
  createOpeningBatch: (companyId: string, input: OpeningBatchInput) =>
    apiRequest<{ batch: OpeningBatch; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/opening-balances`,
      { method: 'POST', body: input },
    ),
  updateOpeningBatch: (companyId: string, batchId: string, input: OpeningBatchInput) =>
    apiRequest<{ batch: OpeningBatch; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/opening-balances/${batchId}`,
      { method: 'PATCH', body: input },
    ),
  submitOpeningBatch: (companyId: string, batchId: string) =>
    apiRequest<{ batch: OpeningBatch; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/opening-balances/${batchId}/submit`,
      { method: 'POST' },
    ),
  approveOpeningBatch: (companyId: string, batchId: string) =>
    apiRequest<{ batch: OpeningBatch; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/opening-balances/${batchId}/approve`,
      { method: 'POST' },
    ),
  postOpeningBatch: (companyId: string, batchId: string, idempotencyKey: string) =>
    apiRequest<{
      batch: OpeningBatch;
      journal: { id: string; journalNumber: string | null } | null;
      replayed: boolean;
      onboarding: OnboardingStatus;
    }>(`/companies/${companyId}/opening-balances/${batchId}/post`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),
  bankAccounts: (companyId: string) =>
    apiRequest<{ bankAccounts: BankAccount[] }>(`/companies/${companyId}/bank-accounts`),
  createBankAccount: (companyId: string, input: BankAccountInput) =>
    apiRequest<{ bankAccount: BankAccount; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/bank-accounts`,
      { method: 'POST', body: input },
    ),
  updateBankAccount: (
    companyId: string,
    bankAccountId: string,
    patch: Partial<BankAccountInput> & { status?: 'ACTIVE' | 'INACTIVE' },
  ) =>
    apiRequest<{ bankAccount: BankAccount; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}`,
      { method: 'PATCH', body: patch },
    ),
  settings: (companyId: string) =>
    apiRequest<{ settings: CompanySettings }>(`/companies/${companyId}/settings`),
  updateSettings: (companyId: string, patch: SettingsPatch) =>
    apiRequest<{ settings: CompanySettings; onboarding: OnboardingStatus }>(
      `/companies/${companyId}/settings`,
      { method: 'PATCH', body: patch },
    ),
};

export const ENTITY_TYPE_OPTIONS = [
  { value: 'PRIVATE_LIMITED', label: 'Private limited company' },
  { value: 'PUBLIC_LISTED', label: 'Public listed company' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'STARTUP_REGISTERED', label: 'Registered startup' },
  { value: 'BRANCH_FOREIGN', label: 'Foreign branch' },
  { value: 'EPZ_EZ_UNIT', label: 'EPZ / EZ unit' },
  { value: 'NGO_NPO', label: 'NGO / non-profit' },
];

export const INDUSTRY_OPTIONS = [
  { value: 'TRADING_DISTRIBUTION', label: 'Trading and distribution' },
  { value: 'SERVICES_IT', label: 'Services and IT' },
  { value: 'MANUFACTURING_RMG', label: 'Manufacturing / RMG' },
  { value: 'ECOMMERCE_FCOMMERCE', label: 'E-commerce / f-commerce' },
  { value: 'PRACTICE_FIRM', label: 'Accounting / practice firm' },
];

export const REPORTING_FRAMEWORK_OPTIONS = [
  { value: 'IFRS_FRC_ADOPTED', label: 'IFRS as adopted by FRC' },
  { value: 'IFRS_FOR_SMES_BFRS', label: 'IFRS for SMEs / BFRS' },
  { value: 'SIMPLIFIED_MANAGEMENT', label: 'Simplified management accounts' },
];

export const ACCOUNT_TYPE_OPTIONS = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export const SUB_CATEGORY_BY_TYPE: Record<string, string[]> = {
  ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'],
  LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'],
  EQUITY: ['EQUITY_CAPITAL', 'EQUITY_RESERVES'],
  REVENUE: ['OPERATING_REVENUE', 'INVESTING_INCOME'],
  EXPENSE: ['COST_OF_SALES', 'OPERATING_EXPENSE', 'FINANCE_COST', 'TAX_EXPENSE'],
};

export const CONTROL_SUBLEDGER_OPTIONS = [
  'NONE',
  'AR',
  'AP',
  'BANK_MFS',
  'VAT_CURRENT_ACCOUNT',
  'VDS_PAYABLE',
  'TDS_PAYABLE',
  'INVENTORY',
  'FIXED_ASSETS',
  'SUSPENSE',
];

export const IFRS_CATEGORY_OPTIONS = [
  'OPERATING',
  'INVESTING',
  'FINANCING',
  'INCOME_TAX',
  'DISCONTINUED',
  'NA_BALANCE_SHEET',
];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  SALES_INVOICE: 'Sales invoice',
  CREDIT_NOTE: 'Credit note',
  PURCHASE_BILL: 'Purchase bill',
  EXPENSE_VOUCHER: 'Expense voucher',
  RECEIPT: 'Customer receipt',
  PAYMENT: 'Supplier payment',
  JOURNAL: 'Journal',
  DELIVERY_CHALLAN: 'Delivery challan',
  GRN: 'Goods received note',
  TREASURY_CHALLAN: 'Treasury challan',
  TREASURY_CERTIFICATE: 'Withholding certificate (draft)',
  BANK_TRANSFER: 'Bank transfer',
  MUSHAK_63: 'Mushak 6.3 serial (internal)',
  MUSHAK_67: 'Mushak 6.7 serial (internal)',
};
