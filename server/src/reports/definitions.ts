/** Stable report keys used by the API, export gate and audit log. */
export const REPORT_DEFINITIONS = [
  'TRIAL_BALANCE',
  'GENERAL_LEDGER',
  'PROFIT_AND_LOSS',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'CHANGES_IN_EQUITY',
  'AR_AGEING',
  'AP_AGEING',
  'STOCK_VALUATION',
  'VAT_SALES_REGISTER',
  'VAT_PURCHASE_REGISTER',
  'VAT_RETURN_DRAFT',
  'WITHHOLDING_REGISTER',
  'JOURNAL_LISTING',
] as const;

export type ReportKey = (typeof REPORT_DEFINITIONS)[number];
