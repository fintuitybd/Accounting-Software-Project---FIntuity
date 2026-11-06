/** Phase 4 company-configuration vocabularies. Values mirror the existing domain types. */

export const ENTITY_TYPES = [
  'PRIVATE_LIMITED',
  'PUBLIC_LISTED',
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'STARTUP_REGISTERED',
  'BRANCH_FOREIGN',
  'EPZ_EZ_UNIT',
  'NGO_NPO',
] as const;

export const INDUSTRY_PACKS = [
  'TRADING_DISTRIBUTION',
  'SERVICES_IT',
  'MANUFACTURING_RMG',
  'ECOMMERCE_FCOMMERCE',
  'PRACTICE_FIRM',
] as const;

export const REPORTING_FRAMEWORKS = ['IFRS_FRC_ADOPTED', 'IFRS_FOR_SMES_BFRS', 'SIMPLIFIED_MANAGEMENT'] as const;

export const VAT_STATUSES = ['VAT_REGISTERED_15', 'TURNOVER_TAX_ENLISTED', 'EXEMPT', 'STARTUP_RELIEF'] as const;

/** Company tax configuration may explicitly record that registration has not happened yet. */
export const VAT_REGISTRATION_STATUSES = [...VAT_STATUSES, 'NOT_REGISTERED'] as const;

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;

export const ACCOUNT_SUB_CATEGORIES = [
  'CURRENT_ASSET',
  'NON_CURRENT_ASSET',
  'CURRENT_LIABILITY',
  'NON_CURRENT_LIABILITY',
  'EQUITY_CAPITAL',
  'EQUITY_RESERVES',
  'OPERATING_REVENUE',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'FINANCE_COST',
  'INVESTING_INCOME',
  'TAX_EXPENSE',
] as const;

export const IFRS_CATEGORIES = [
  'OPERATING',
  'INVESTING',
  'FINANCING',
  'INCOME_TAX',
  'DISCONTINUED',
  'NA_BALANCE_SHEET',
] as const;

export const CONTROL_SUBLEDGERS = [
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
] as const;

export const SUB_CATEGORIES_BY_TYPE: Record<(typeof ACCOUNT_TYPES)[number], readonly string[]> = {
  ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'],
  LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'],
  EQUITY: ['EQUITY_CAPITAL', 'EQUITY_RESERVES'],
  REVENUE: ['OPERATING_REVENUE', 'INVESTING_INCOME'],
  EXPENSE: ['COST_OF_SALES', 'OPERATING_EXPENSE', 'FINANCE_COST', 'TAX_EXPENSE'],
};

export const DOCUMENT_TYPES = [
  'SALES_INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_BILL',
  'EXPENSE_VOUCHER',
  'RECEIPT',
  'PAYMENT',
  'JOURNAL',
  'DELIVERY_CHALLAN',
  'GRN',
  'TREASURY_CHALLAN',
  'TREASURY_CERTIFICATE',
  'BANK_TRANSFER',
  // Internal statutory serial series. The legal format of Mushak 6.3/6.7 remains subject to
  // professional verification; these sequences exist so a reversal can never reuse a serial.
  'MUSHAK_63',
  'MUSHAK_67',
] as const;

export const DEFAULT_NUMBER_PREFIXES: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  SALES_INVOICE: 'INV-',
  CREDIT_NOTE: 'CN-',
  PURCHASE_BILL: 'PB-',
  EXPENSE_VOUCHER: 'PV-',
  RECEIPT: 'RCT-',
  PAYMENT: 'PAY-',
  JOURNAL: 'JE-',
  DELIVERY_CHALLAN: 'DC-',
  GRN: 'GRN-',
  TREASURY_CHALLAN: 'CH-',
  TREASURY_CERTIFICATE: 'CERT-',
  BANK_TRANSFER: 'TRF-',
  MUSHAK_63: 'M63-',
  MUSHAK_67: 'M67-',
};

export const ONBOARDING_STEPS = [
  'COMPANY',
  'FISCAL_YEAR',
  'CHART_OF_ACCOUNTS',
  'OPENING_BALANCES',
  'BANK_ACCOUNTS',
  'SETTINGS',
] as const;

export const BANK_ACCOUNT_KINDS = ['BANK', 'MFS', 'CASH'] as const;

export const FILING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'NOT_APPLICABLE'] as const;

export const TAX_CATEGORIES = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
] as const;

/** Fields that make a control account identity-sensitive. */
export function isProtectedControlAccount(input: {
  controlSubledger: string;
  code?: string;
  accountType?: string;
}): boolean {
  return input.controlSubledger !== 'NONE';
}
