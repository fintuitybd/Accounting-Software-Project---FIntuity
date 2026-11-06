import type { ReportReviewStatus, ReportTemplateDto } from './types.ts';

/**
 * Versioned report templates. The repository has not been given a signed accountant/tax-counsel
 * approval for statutory line labels or filing deadlines, so these templates deliberately say so.
 * Changing a label or a review status must create a new version; historical exports retain the
 * version string they were generated with.
 */

const MANAGEMENT: ReportTemplateDto = {
  key: 'MANAGEMENT_ACCOUNTS',
  version: 'bd-management-accounts-v1',
  reviewStatus: 'PENDING_ACCOUNTANT_REVIEW',
  source: 'Internal management-accounts mapping derived from the company chart of accounts and posted journals.',
  labelEn: 'Management accounts — unaudited',
  labelBn: 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়',
  filingClaim: false,
};

const VAT_REGISTERS: ReportTemplateDto = {
  key: 'VAT_REGISTERS',
  version: 'bd-vat-registers-internal-v1',
  reviewStatus: 'PENDING_TAX_COUNSEL',
  source:
    'Internal Mushak 6.1/6.2-style register mapping. Statutory line labels and formats await professional review.',
  labelEn: 'Internal VAT registers — draft',
  labelBn: 'অভ্যন্তরীণ ভ্যাট রেজিস্টার — খসড়া',
  filingClaim: false,
};

const VAT_RETURN: ReportTemplateDto = {
  key: 'VAT_9_1_DRAFT',
  version: 'bd-vat-91-internal-draft-v1',
  reviewStatus: 'PENDING_TAX_COUNSEL',
  source:
    'Internal draft return mapping. Not a filed return, not a government receipt and not a filing acknowledgement.',
  labelEn: 'Mushak 9.1 — internal draft, not filed',
  labelBn: 'মূসক ৯.১ — অভ্যন্তরীণ খসড়া, দাখিলকৃত নয়',
  filingClaim: false,
};

const WITHHOLDING: ReportTemplateDto = {
  key: 'VDS_TDS_REGISTER',
  version: 'bd-vds-tds-register-internal-v1',
  reviewStatus: 'PENDING_TAX_COUNSEL',
  source: 'Internal withholding and treasury challan register. Rates and statutory headings await professional review.',
  labelEn: 'VDS/TDS and challan register — internal',
  labelBn: 'ভিডিএস/টিডিএস ও চালান রেজিস্টার — অভ্যন্তরীণ',
  filingClaim: false,
};

const STOCK: ReportTemplateDto = {
  key: 'STOCK_VALUATION',
  version: 'bd-stock-valuation-v1',
  reviewStatus: 'PENDING_ACCOUNTANT_REVIEW',
  source: 'Stock movement valuation at weighted-average cost, proved to the inventory control accounts.',
  labelEn: 'Stock valuation — management basis',
  labelBn: 'স্টক মূল্যায়ন — ব্যবস্থাপনা ভিত্তি',
  filingClaim: false,
};

const JOURNAL_LISTING: ReportTemplateDto = {
  key: 'JOURNAL_LISTING',
  version: 'bd-journal-listing-v1',
  reviewStatus: 'PENDING_ACCOUNTANT_REVIEW',
  source: 'Immutable posted-journal listing with source, status and reversal links.',
  labelEn: 'Journal listing — internal',
  labelBn: 'জার্নাল তালিকা — অভ্যন্তরীণ',
  filingClaim: false,
};

const TRIAL_BALANCE: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'TRIAL_BALANCE',
  labelEn: 'Trial balance — management basis',
  labelBn: 'রেওয়ামিল — ব্যবস্থাপনা ভিত্তি',
};

const P_AND_L: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'PROFIT_AND_LOSS',
  labelEn: 'Statement of profit or loss — management accounts, unaudited',
  labelBn: 'মুনাফা বা ক্ষতির বিবরণী — ব্যবস্থাপনা হিসাব, নিরীক্ষিত নয়',
};

const BALANCE_SHEET: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'BALANCE_SHEET',
  labelEn: 'Statement of financial position — management accounts, unaudited',
  labelBn: 'আর্থিক অবস্থানের বিবরণী — ব্যবস্থাপনা হিসাব, নিরীক্ষিত নয়',
};

const CASH_FLOW: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'CASH_FLOW',
  labelEn: 'Statement of cash flows — management accounts, unaudited',
  labelBn: 'নগদ প্রবাহের বিবরণী — ব্যবস্থাপনা হিসাব, নিরীক্ষিত নয়',
};

const EQUITY: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'CHANGES_IN_EQUITY',
  labelEn: 'Statement of changes in equity — management accounts, unaudited',
  labelBn: 'ইকুইটির পরিবর্তনের বিবরণী — ব্যবস্থাপনা হিসাব, নিরীক্ষিত নয়',
};

const AR_AGEING: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'AR_AGEING',
  labelEn: 'Receivables ageing — management basis',
  labelBn: 'প্রাপ্য এজিং — ব্যবস্থাপনা ভিত্তি',
};

const AP_AGEING: ReportTemplateDto = {
  ...MANAGEMENT,
  key: 'AP_AGEING',
  labelEn: 'Payables ageing — management basis',
  labelBn: 'প্রদেয় এজিং — ব্যবস্থাপনা ভিত্তি',
};

export const REPORT_TEMPLATES = {
  management: MANAGEMENT,
  trialBalance: TRIAL_BALANCE,
  profitAndLoss: P_AND_L,
  balanceSheet: BALANCE_SHEET,
  cashFlow: CASH_FLOW,
  equity: EQUITY,
  arAgeing: AR_AGEING,
  apAgeing: AP_AGEING,
  stock: STOCK,
  vatRegisters: VAT_REGISTERS,
  vatReturn: VAT_RETURN,
  withholding: WITHHOLDING,
  journalListing: JOURNAL_LISTING,
} as const;

export const ALL_TEMPLATES: ReportTemplateDto[] = Object.values(REPORT_TEMPLATES);

export const REPORT_REVIEW_STATUS: ReportReviewStatus = 'PENDING_ACCOUNTANT_REVIEW';
