// LedgerVault — Phase 2 self-balancing Bangladeshi seed dataset for Apex Delta Trading Ltd.
//
// Every journal in this file is produced by `buildBalancedJournal()`, which asserts
// SUM(debit_poisha) === SUM(credit_poisha) and re-validates the two-line / positive-debit rules
// before the journal is sealed into the SHA-256 chain. No amount is hand-balanced: the opening
// journal derives retained earnings as its plug, month-end provisions read live ledger balances,
// and every commercial document routes through the deterministic tax engine.
//
// Statutory citations are decision support only and remain marked [VERIFY] in Rule Pack bd-2026-v1.

import { addDays, applyRateBps, bdtToPoisha, isoNow, periodCodeOf } from '../money';
import type {
  Account,
  AccountingPeriod,
  AccountSubCategory,
  AccountType,
  BankAccount,
  BankStatementLine,
  BookType,
  Challan,
  ControlSubledger,
  DocLine,
  Employee,
  Ifrs18Category,
  JournalEntry,
  LicenceRecord,
  Notice,
  Party,
  PayrollLine,
  SourceModule,
  TaxCategory,
  TdsNature,
  TenantEntity,
  VdsCertificate,
  CommercialDocType,
  PaymentMethod,
  DocumentLifecycleStatus,
  InventoryItem,
} from '../types';
import {
  buildCommercialDoc,
  journalTotals,
  postJournal,
  type CommercialDocSpec,
  type JournalLineDraft,
  type JournalPostContext,
  type TaxAnnotatedDoc,
} from './ledgerEngine';

export const DEMO_TODAY = '2026-11-01';
export const CURRENT_PERIOD = '2026-10';
export const COMPARATIVE_PERIOD = '2026-09';
export const OPENING_PERIOD = '2026-07';
export const OPENING_JOURNAL_NUMBER = 'JE-2026-07-0001';
export const FY_LABEL = 'FY 2026-27';
/** Weighted-average cost ratio applied when inventory is issued to cost of sales. */
const COGS_RATIO_BPS = 5200;

// ---------------------------------------------------------------------------------------------
// Tenants (three switchable personas)
// ---------------------------------------------------------------------------------------------

const APEX_UNITS = [
  {
    id: 'BU-DHK',
    bin_number: '001482910-0101',
    unit_name_en: 'Dhaka Principal Unit',
    unit_name_bn: 'ঢাকা প্রধান ইউনিট',
    address: 'House 42, Road 11, Banani, Dhaka 1213',
    is_principal: true,
  },
  {
    id: 'BU-CTG',
    bin_number: '001482910-0102',
    unit_name_en: 'Chattogram Branch Unit',
    unit_name_bn: 'চট্টগ্রাম শাখা ইউনিট',
    address: 'Agrabad C/A, Chattogram 4100',
    is_principal: false,
  },
];

export const TENANT_APEX: TenantEntity = {
  id: 'TEN-APEX',
  persona_key: 'APEX',
  name_en: 'Apex Delta Trading Ltd.',
  name_bn: 'অ্যাপেক্স ডেল্টা ট্রেডিং লিমিটেড',
  trade_name: 'Apex Delta',
  entity_type: 'PRIVATE_LIMITED',
  industry_pack: 'TRADING_DISTRIBUTION',
  tin_number: '549821003412',
  rjsc_reg_no: 'C-148239/2019',
  vat_status: 'VAT_REGISTERED_15',
  is_withholding_entity: true,
  reporting_framework: 'IFRS_FRC_ADOPTED',
  fiscal_year_label: FY_LABEL,
  functional_currency: 'BDT',
  address_en: 'House 42, Road 11, Banani, Dhaka 1213',
  address_bn: 'বাড়ি ৪২, রোড ১১, বনানী, ঢাকা ১২১৩',
  telephone: '+880 2 9876543',
  email: 'finance@apexdelta.com.bd',
  bin_units: APEX_UNITS,
  accounting_policies: {
    inventory_formula: 'WEIGHTED_AVERAGE',
    depreciation_method: 'STRAIGHT_LINE',
    ifrs18_early_adoption: true,
    ecl_provision_matrix_enabled: true,
    cash_disallowance_limit_poisha: 10_000_000n,
  },
};

export const TENANT_CLOUDNINE: TenantEntity = {
  ...TENANT_APEX,
  id: 'TEN-CLOUDNINE',
  persona_key: 'CLOUDNINE',
  name_en: 'CloudNine Digital Ltd.',
  name_bn: 'ক্লাউডনাইন ডিজিটাল লিমিটেড',
  trade_name: 'CloudNine',
  entity_type: 'STARTUP_REGISTERED',
  industry_pack: 'ECOMMERCE_FCOMMERCE',
  tin_number: '618273094517',
  rjsc_reg_no: 'C-208471/2023',
  vat_status: 'STARTUP_RELIEF',
  address_en: 'Level 6, Gulshan Avenue, Dhaka 1212',
  address_bn: 'লেভেল ৬, গুলশান এভিনিউ, ঢাকা ১২১২',
  email: 'accounts@cloudnine.com.bd',
  bin_units: [
    {
      id: 'BU-C9',
      bin_number: '003917265-0101',
      unit_name_en: 'CloudNine HQ Unit',
      unit_name_bn: 'ক্লাউডনাইন প্রধান ইউনিট',
      address: 'Level 6, Gulshan Avenue, Dhaka 1212',
      is_principal: true,
    },
  ],
};

export const TENANT_RAFIQ: TenantEntity = {
  ...TENANT_APEX,
  id: 'TEN-RAFIQ',
  persona_key: 'RAFIQ',
  name_en: 'Rafiq & Associates — Chartered Accountants',
  name_bn: 'রফিক অ্যান্ড অ্যাসোসিয়েটস — চার্টার্ড অ্যাকাউন্ট্যান্টস',
  trade_name: 'Rafiq & Associates',
  entity_type: 'PARTNERSHIP',
  industry_pack: 'PRACTICE_FIRM',
  tin_number: '472819305612',
  rjsc_reg_no: 'F-3812/2011',
  vat_status: 'VAT_REGISTERED_15',
  address_en: 'Chamber 902, Motijheel C/A, Dhaka 1000',
  address_bn: 'চেম্বার ৯০২, মতিঝিল বা/এ, ঢাকা ১০০০',
  email: 'office@rafiqassociates.com.bd',
  bin_units: [
    {
      id: 'BU-PRACTICE',
      bin_number: '002561903-0101',
      unit_name_en: 'Practice Firm HQ Unit',
      unit_name_bn: 'প্র্যাকটিস ফার্ম প্রধান ইউনিট',
      address: 'Chamber 902, Motijheel C/A, Dhaka 1000',
      is_principal: true,
    },
  ],
};

export const TENANTS: TenantEntity[] = [TENANT_APEX, TENANT_CLOUDNINE, TENANT_RAFIQ];

export function tenantByKey(key: TenantEntity['persona_key']): TenantEntity {
  return TENANTS.find((tenant) => tenant.persona_key === key) ?? TENANT_APEX;
}

// ---------------------------------------------------------------------------------------------
// Chart of accounts (SPEC §4.1) — 1110 … 5900
// ---------------------------------------------------------------------------------------------

type AccountRow = [
  code: string,
  nameEn: string,
  nameBn: string,
  type: AccountType,
  sub: AccountSubCategory,
  ifrs: Ifrs18Category,
  control: ControlSubledger,
  note: string,
  statement: string,
  cashFlow: Account['cash_flow_tag'],
];

const ACCOUNT_ROWS: AccountRow[] = [
  ['1110', 'City Bank Corporate Current A/C', 'সিটি ব্যাংক কর্পোরেট চলতি হিসাব', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'BANK_MFS', 'Note 9', 'BS.CA.CASH', 'CASH'],
  ['1115', 'BRAC Bank Foreign Currency & Trade A/C', 'ব্র্যাক ব্যাংক বৈদেশিক মুদ্রা ও বাণিজ্য হিসাব', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'BANK_MFS', 'Note 9', 'BS.CA.CASH', 'CASH'],
  ['1120', 'bKash Merchant Settlement Wallet', 'বিকাশ মার্চেন্ট সেটেলমেন্ট ওয়ালেট', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'BANK_MFS', 'Note 9', 'BS.CA.CASH', 'CASH'],
  ['1125', 'Nagad Corporate Merchant Wallet', 'নগদ কর্পোরেট মার্চেন্ট ওয়ালেট', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'BANK_MFS', 'Note 9', 'BS.CA.CASH', 'CASH'],
  ['1130', 'Petty Cash Imprest — Dhaka HQ', 'ক্ষুদ্র নগদ ইমপ্রেস — ঢাকা প্রধান কার্যালয়', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'BANK_MFS', 'Note 9', 'BS.CA.CASH', 'CASH'],
  ['1140', 'VAT Current Account — Mushak 9.1 Note 18', 'ভ্যাট চলতি হিসাব — মূসক ৯.১ নোট ১৮', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'VAT_CURRENT_ACCOUNT', 'Note 10', 'BS.CA.VAT', 'OPERATING'],
  ['1145', 'VDS Receivable — Customer Mushak 6.6 Pending', 'ভিডিএস প্রাপ্য — গ্রাহক মূসক ৬.৬ অপেক্ষমাণ', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 10', 'BS.CA.VDS_RECV', 'OPERATING'],
  ['1150', 'Advance Income Tax (AIT / Customer TDS Credit)', 'অগ্রিম আয়কর (এআইটি / গ্রাহক টিডিএস ক্রেডিট)', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 15', 'BS.CA.AIT', 'OPERATING'],
  ['1210', 'Trade Accounts Receivable — Control', 'বাণিজ্যিক প্রাপ্য হিসাব — নিয়ন্ত্রণ', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'AR', 'Note 8', 'BS.CA.AR', 'OPERATING'],
  ['1219', 'Allowance for Expected Credit Losses — IFRS 9 ECL', 'প্রত্যাশিত ক্রেডিট ক্ষতি ভাতা — আইএফআরএস ৯', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 8', 'BS.CA.ECL', 'OPERATING'],
  ['1310', 'Merchandise Inventory — Weighted Average', 'মজুদ পণ্য — ভারযুক্ত গড়', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'INVENTORY', 'Note 7', 'BS.CA.INV', 'OPERATING'],
  ['1410', 'Short-Term Fixed Deposit Receipt (FDR Investment)', 'স্বল্পমেয়াদি স্থায়ী আমানত রসিদ (এফডিআর বিনিয়োগ)', 'ASSET', 'CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 6', 'BS.CA.FDR', 'INVESTING'],
  ['1610', 'Property, Plant & Equipment (Cost)', 'সম্পত্তি, যন্ত্রপাতি ও সরঞ্জাম (ব্যয়)', 'ASSET', 'NON_CURRENT_ASSET', 'NA_BALANCE_SHEET', 'FIXED_ASSETS', 'Note 4', 'BS.NCA.PPE', 'INVESTING'],
  ['1619', 'Accumulated Depreciation — PPE', 'সঞ্চিত অবচয় — সম্পত্তি ও যন্ত্রপাতি', 'ASSET', 'NON_CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 4', 'BS.NCA.PPE_DEP', 'INVESTING'],
  ['1710', 'Right-of-Use Assets — Warehouse & Office Leases (IFRS 16)', 'ব্যবহারের অধিকার সম্পদ — গুদাম ও অফিস লিজ (আইএফআরএস ১৬)', 'ASSET', 'NON_CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 5', 'BS.NCA.ROU', 'INVESTING'],
  ['1719', 'Accumulated Depreciation — ROU Assets (IFRS 16)', 'সঞ্চিত অবচয় — ব্যবহারের অধিকার সম্পদ', 'ASSET', 'NON_CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 5', 'BS.NCA.ROU_DEP', 'INVESTING'],
  ['1810', 'Deferred Tax Asset (IAS 12)', 'বিলম্বিত কর সম্পদ (আইএএস ১২)', 'ASSET', 'NON_CURRENT_ASSET', 'NA_BALANCE_SHEET', 'NONE', 'Note 16', 'BS.NCA.DTA', 'OPERATING'],
  ['2110', 'Trade Accounts Payable — Control', 'বাণিজ্যিক প্রদেয় হিসাব — নিয়ন্ত্রণ', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'AP', 'Note 11', 'BS.CL.AP', 'OPERATING'],
  ['2120', 'Output VAT Payable', 'আউটপুট ভ্যাট প্রদেয়', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 10', 'BS.CL.VAT', 'OPERATING'],
  ['2130', 'VDS Withheld Payable to Treasury (Mushak 6.6)', 'কোষাগারে প্রদেয় কর্তিত ভিডিএস (মূসক ৬.৬)', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'VDS_PAYABLE', 'Note 15', 'BS.CL.VDS', 'OPERATING'],
  ['2140', 'TDS Withheld Payable to Treasury', 'কোষাগারে প্রদেয় কর্তিত টিডিএস', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'TDS_PAYABLE', 'Note 15', 'BS.CL.TDS', 'OPERATING'],
  ['2150', 'Reverse Charge VAT Payable (Imported Services)', 'রিভার্স চার্জ ভ্যাট প্রদেয় (আমদানি সেবা)', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 10', 'BS.CL.RCVAT', 'OPERATING'],
  ['2160', 'Accrued Salaries, Festival Bonus & PF Payable', 'সঞ্চিত বেতন, উৎসব ভাতা ও প্রভিডেন্ট ফান্ড প্রদেয়', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 13', 'BS.CL.PAYROLL', 'OPERATING'],
  ['2170', 'WPPF & Welfare Fund Provision (Labour Act)', 'ডব্লিউপিপিএফ ও কল্যাণ তহবিল সঞ্চিতি (শ্রম আইন)', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 13', 'BS.CL.WPPF', 'OPERATING'],
  ['2180', 'Current Income Tax Provision', 'চলতি আয়কর সঞ্চিতি', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 16', 'BS.CL.TAX', 'OPERATING'],
  ['2190', 'Suspense & Unapplied Cash Clearing Account', 'সাসপেন্স ও অপ্রয়োজিত নগদ নিষ্পত্তি হিসাব', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 14', 'BS.CL.SUSPENSE', 'OPERATING'],
  ['2210', 'Short-Term Working Capital Loan (LTR / CC)', 'স্বল্পমেয়াদি বৈদেশিক লেনদেন ঋণ (এলটিআর / সিসি)', 'LIABILITY', 'CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 12', 'BS.CL.LOAN', 'FINANCING'],
  ['2510', 'Lease Liabilities — Non-Current & Current (IFRS 16)', 'লিজ দায় — চলতি ও অচলতি (আইএফআরএস ১৬)', 'LIABILITY', 'NON_CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 5', 'BS.NCL.LEASE', 'FINANCING'],
  ['2610', 'Defined Benefit Gratuity Obligation (IAS 19)', 'নির্ধারিত সুবিধা গ্র্যাচুইটি দায় (আইএএস ১৯)', 'LIABILITY', 'NON_CURRENT_LIABILITY', 'NA_BALANCE_SHEET', 'NONE', 'Note 13', 'BS.NCL.GRATUITY', 'OPERATING'],
  ['3100', 'Issued & Paid-Up Share Capital', 'ইস্যুকৃত ও পরিশোধিত শেয়ার মূলধন', 'EQUITY', 'EQUITY_CAPITAL', 'NA_BALANCE_SHEET', 'NONE', 'Note 17', 'BS.EQ.CAPITAL', 'FINANCING'],
  ['3200', 'Retained Earnings / Accumulated Surplus', 'সঞ্চিত মুনাফা / ক্রমপুঞ্জিত উদ্বৃত্ত', 'EQUITY', 'EQUITY_RESERVES', 'NA_BALANCE_SHEET', 'NONE', 'Note 17', 'BS.EQ.RE', 'FINANCING'],
  ['4100', 'Revenue from Sale of Goods — Local Standard 15%', 'পণ্য বিক্রয় আয় — স্থানীয় আদর্শ ১৫%', 'REVENUE', 'OPERATING_REVENUE', 'OPERATING', 'NONE', 'Note 3', 'PL.REV.GOODS', 'OPERATING'],
  ['4110', 'Revenue from Corporate Contracts (VDS Applicable)', 'কর্পোরেট চুক্তি আয় (ভিডিএস প্রযোজ্য)', 'REVENUE', 'OPERATING_REVENUE', 'OPERATING', 'NONE', 'Note 3', 'PL.REV.CONTRACT', 'OPERATING'],
  ['4120', 'Export & Zero-Rated Service Revenue', 'রপ্তানি ও শূন্য-হার সেবা আয়', 'REVENUE', 'OPERATING_REVENUE', 'OPERATING', 'NONE', 'Note 3', 'PL.REV.EXPORT', 'OPERATING'],
  ['4200', 'Sales Returns & Credit Note Adjustments (Mushak 6.7)', 'বিক্রয় ফেরত ও ক্রেডিট নোট সমন্বয় (মূসক ৬.৭)', 'REVENUE', 'OPERATING_REVENUE', 'OPERATING', 'NONE', 'Note 3', 'PL.REV.RETURNS', 'OPERATING'],
  ['4500', 'Interest Income on Independent FDR Investments', 'স্বাধীন এফডিআর বিনিয়োগে সুদ আয়', 'REVENUE', 'INVESTING_INCOME', 'INVESTING', 'NONE', 'Note 6', 'PL.INV.INTEREST', 'INVESTING'],
  ['5100', 'Cost of Goods Sold (COGS) & Disallowed Input VAT', 'বিক্রীত পণ্যের ব্যয় (সিওজিএস) ও বাতিল ইনপুট ভ্যাট', 'EXPENSE', 'COST_OF_SALES', 'OPERATING', 'NONE', 'Note 7', 'PL.OP.COGS', 'OPERATING'],
  ['5200', 'Salaries, Wages, Overtime & Festival Bonuses', 'বেতন, মজুরি, ওভারটাইম ও উৎসব ভাতা', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 13', 'PL.OP.PAYROLL', 'OPERATING'],
  ['5210', 'Employer PF Contribution & IAS 19 Gratuity Service Cost', 'নিয়োগকর্তার পিএফ ও গ্র্যাচুইটি সেবা ব্যয়', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 13', 'PL.OP.PF', 'OPERATING'],
  ['5300', 'Commercial Office & Warehouse Rent', 'বাণিজ্যিক অফিস ও গুদাম ভাড়া', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 5', 'PL.OP.RENT', 'OPERATING'],
  ['5310', 'Professional, Audit, Tax & Legal Consultancy Fees', 'পেশাদার, নিরীক্ষা, কর ও আইনি পরামর্শ ফি', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 13', 'PL.OP.PROF', 'OPERATING'],
  ['5320', 'Digital Marketing, Cloud & Imported SaaS (Meta/Google/AWS)', 'ডিজিটাল মার্কেটিং, ক্লাউড ও আমদানি স্যাস', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 19', 'PL.OP.DIGITAL', 'OPERATING'],
  ['5330', 'Freight, Transport & Courier Delivery Charges', 'মালবাহী, পরিবহন ও কুরিয়ার ডেলিভারি চার্জ', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 13', 'PL.OP.FREIGHT', 'OPERATING'],
  ['5400', 'Depreciation Expense — PPE & IFRS 16 ROU Assets', 'অবচয় ব্যয় — সম্পত্তি ও আইএফআরএস ১৬ আরওইউ', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 4', 'PL.OP.DEP', 'OPERATING'],
  ['5450', 'Expected Credit Loss (ECL) Impairment Expense (IFRS 9)', 'প্রত্যাশিত ক্রেডিট ক্ষতি (আইএফআরএস ৯)', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'Note 8', 'PL.OP.ECL', 'OPERATING'],
  ['5800', 'Interest Expense on Bank LTR/CC Borrowings', 'ব্যাংক ঋণে সুদ ব্যয়', 'EXPENSE', 'FINANCE_COST', 'FINANCING', 'NONE', 'Note 12', 'PL.FIN.INTEREST', 'FINANCING'],
  ['5810', 'Interest Unwinding on IFRS 16 Lease & IAS 19 Liabilities', 'আইএফআরএস ১৬ ও আইএএস ১৯ দায়ে সুদ ব্যয়', 'EXPENSE', 'FINANCE_COST', 'FINANCING', 'NONE', 'Note 5', 'PL.FIN.UNWIND', 'FINANCING'],
  ['5820', 'Bank Charges, Excise Duty & bKash/Nagad Settlement Fees', 'ব্যাংক চার্জ, আবগারি শুল্ক ও বিকাশ/নগদ সেটেলমেন্ট ফি', 'EXPENSE', 'FINANCE_COST', 'FINANCING', 'NONE', 'Note 12', 'PL.FIN.BANK', 'FINANCING'],
  ['5900', 'Corporate Income Tax Expense', 'কর্পোরেট আয়কর ব্যয়', 'EXPENSE', 'TAX_EXPENSE', 'INCOME_TAX', 'NONE', 'Note 16', 'PL.TAX', 'OPERATING'],
];

export const ACCOUNTS: Account[] = ACCOUNT_ROWS.map(
  ([code, nameEn, nameBn, accountType, sub, ifrs, control, note, statement, cashFlow]) => ({
    code,
    name_en: nameEn,
    name_bn: nameBn,
    account_type: accountType,
    sub_category: sub,
    ifrs18_category: ifrs,
    ifrs_statement_line_id: statement,
    control_subledger: control,
    opening_debit_poisha: 0n,
    opening_credit_poisha: 0n,
    is_active: true,
    note_ref: note,
    cash_flow_tag: cashFlow,
  }),
);

export const ACCOUNT_BY_CODE = new Map<string, Account>(ACCOUNTS.map((account) => [account.code, account]));

export function accountName(code: string): { name_en: string; name_bn: string } {
  const account = ACCOUNT_BY_CODE.get(code);
  return {
    name_en: account?.name_en ?? `Account ${code}`,
    name_bn: account?.name_bn ?? `হিসাব ${code}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Master data — parties, items, banks, periods
// ---------------------------------------------------------------------------------------------

export const PARTIES: Party[] = [
  {
    id: 'PTY-MEGHNA',
    code: 'CUS-001',
    name_en: 'Meghna Distribution Ltd.',
    name_bn: 'মেঘনা ডিস্ট্রিবিউশন লিমিটেড',
    type: 'CUSTOMER',
    bin: '004271836-0203',
    tin: '138547291063',
    address_en: 'Plot 12, Tejgaon I/A, Dhaka 1208',
    address_bn: 'প্লট ১২, তেজগাঁও শিল্প এলাকা, ঢাকা ১২০৮',
    mobile: '+8801711223344',
    email: 'accounts@meghnadistribution.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 30,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-BEXIMCO',
    code: 'CUS-002',
    name_en: 'Beximco Trading Corporation',
    name_bn: 'বেক্সিমকো ট্রেডিং কর্পোরেশন',
    type: 'CUSTOMER',
    bin: '002734198-0301',
    tin: '217394856021',
    address_en: 'Beximco Industrial Park, Sarabo, Kashimpur, Gazipur',
    address_bn: 'বেক্সিমকো ইন্ডাস্ট্রিয়াল পার্ক, সরাবো, কাশিমপুর, গাজীপুর',
    mobile: '+8801811998877',
    email: 'ap@beximcotrading.com',
    is_withholding_buyer: true,
    is_government: false,
    credit_days: 45,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-DHAKAFASHION',
    code: 'CUS-003',
    name_en: 'Dhaka Fashion Retail',
    name_bn: 'ঢাকা ফ্যাশন রিটেইল',
    type: 'CUSTOMER',
    bin: '007412365-0101',
    tin: '189273645012',
    address_en: 'Shop 214, Bashundhara City, Panthapath, Dhaka 1215',
    address_bn: 'দোকান ২১৪, বসুন্ধরা সিটি, পান্থপথ, ঢাকা ১২১৫',
    mobile: '+8801913445566',
    email: 'buyer@dhakafashion.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 15,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-PADMA',
    code: 'SUP-001',
    name_en: 'Padma Industrial Supplies',
    name_bn: 'পদ্মা ইন্ডাস্ট্রিয়াল সাপ্লাইজ',
    type: 'SUPPLIER',
    bin: '005618243-0101',
    tin: '149035728164',
    address_en: '89 Nawabpur Road, Dhaka 1100',
    address_bn: '৮৯ নবাবপুর রোড, ঢাকা ১১০০',
    mobile: '+8801722334455',
    email: 'sales@padmaindustrial.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 21,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-RAHMANCA',
    code: 'SUP-002',
    name_en: 'Rahman & Chowdhury Chartered Accountants',
    name_bn: 'রহমান অ্যান্ড চৌধুরী চার্টার্ড অ্যাকাউন্ট্যান্টস',
    type: 'SUPPLIER',
    bin: '003912476-0202',
    tin: '120938475610',
    address_en: 'Chamber 705, Motijheel C/A, Dhaka 1000',
    address_bn: 'চেম্বার ৭০৫, মতিঝিল বা/এ, ঢাকা ১০০০',
    mobile: '+8801733445566',
    email: 'billing@rahmanchowdhury.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 15,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-KARNAPHULI',
    code: 'SUP-003',
    name_en: 'Karnaphuli Traders',
    name_bn: 'কর্ণফুলী ট্রেডার্স',
    type: 'SUPPLIER',
    bin: '006341289-0102',
    tin: undefined,
    address_en: 'Khatunganj, Chattogram 4000',
    address_bn: 'খাতুনগঞ্জ, চট্টগ্রাম ৪০০০',
    mobile: '+8801744556677',
    email: 'karnaphulitraders@gmail.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 10,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-SYLHETAGRO',
    code: 'SUP-004',
    name_en: 'Sylhet Agro Traders',
    name_bn: 'সিলেট এগ্রো ট্রেডার্স',
    type: 'SUPPLIER',
    bin: undefined,
    tin: '178392045612',
    address_en: 'Zindabazar, Sylhet 3100',
    address_bn: 'জিন্দাবাজার, সিলেট ৩১০০',
    mobile: '+8801755667788',
    email: 'sylhetagro@yahoo.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 7,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-MOTIJHEEL',
    code: 'SUP-005',
    name_en: 'Motijheel Properties Ltd.',
    name_bn: 'মতিঝিল প্রপার্টিজ লিমিটেড',
    type: 'SUPPLIER',
    bin: '002248173-0101',
    tin: '130958472638',
    address_en: 'BSEC Bhaban, 102 Kazi Nazrul Islam Avenue, Dhaka 1000',
    address_bn: 'বিএসইসি ভবন, ১০২ কাজী নজরুল ইসলাম এভিনিউ, ঢাকা ১০০০',
    mobile: '+8801766778899',
    email: 'leasing@motijheelproperties.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 5,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-META',
    code: 'SUP-006',
    name_en: 'Meta Platforms Ireland Ltd.',
    name_bn: 'মেটা প্ল্যাটফর্মস আয়ারল্যান্ড লিমিটেড',
    type: 'SUPPLIER',
    bin: undefined,
    tin: undefined,
    address_en: '4 Grand Canal Square, Dublin 2, Ireland',
    address_bn: '৪ গ্র্যান্ড ক্যানাল স্কয়ার, ডাবলিন ২, আয়ারল্যান্ড',
    mobile: '+353 1 443 4000',
    email: 'billing@meta.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 0,
    opening_balance_poisha: 0n,
    is_active: true,
  },
  {
    id: 'PTY-RUPSHA',
    code: 'SUP-007',
    name_en: 'Rupsha Logistics & Courier',
    name_bn: 'রূপসা লজিস্টিকস ও কুরিয়ার',
    type: 'SUPPLIER',
    bin: '004782316-0103',
    tin: '165039284716',
    address_en: 'Keraniganj Truck Terminal, Dhaka 1310',
    address_bn: 'কেরানীগঞ্জ ট্রাক টার্মিনাল, ঢাকা ১৩১০',
    mobile: '+8801777889900',
    email: 'ops@rupshalogistics.com',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 10,
    opening_balance_poisha: 0n,
    is_active: true,
  },
];

export const PARTY_BY_CODE = new Map<string, Party>(PARTIES.map((party) => [party.code, party]));

export function partyById(id: string): Party {
  const party = PARTIES.find((entry) => entry.id === id);
  if (!party) throw new Error(`Unknown party ${id}`);
  return party;
}

export interface SeedItem extends InventoryItem {
  hs_code: string;
  is_stock_item: boolean;
}

const RAW_ITEMS: SeedItem[] = [
  { id: 'ITM-001', sku: 'HS-8471.30', hs_code: '8471.30.00', name_en: 'Portable laptop computers', name_bn: 'বহনযোগ্য ল্যাপটপ কম্পিউটার', unit_en: 'pcs', unit_bn: 'পিস', unit_price_poisha: bdtToPoisha('98500.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-002', sku: 'HS-8517.62', hs_code: '8517.62.00', name_en: 'Network routers & switches', name_bn: 'নেটওয়ার্ক রাউটার ও সুইচ', unit_en: 'pcs', unit_bn: 'পিস', unit_price_poisha: bdtToPoisha('42500.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-003', sku: 'HS-9403.60', hs_code: '9403.60.00', name_en: 'Wooden office furniture', name_bn: 'কাঠের অফিস আসবাব', unit_en: 'set', unit_bn: 'সেট', unit_price_poisha: bdtToPoisha('36400.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-004', sku: 'HS-4820.10', hs_code: '4820.10.00', name_en: 'Register & account books', name_bn: 'রেজিস্টার ও হিসাব বই', unit_en: 'ream', unit_bn: 'রিম', unit_price_poisha: bdtToPoisha('1850.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-005', sku: 'HS-6302.60', hs_code: '6302.60.00', name_en: 'Cotton household linen', name_bn: 'তুলা গৃহস্থালি লিনেন', unit_en: 'bale', unit_bn: 'বেল', unit_price_poisha: bdtToPoisha('21800.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-006', sku: 'HS-8544.42', hs_code: '8544.42.00', name_en: 'Cables & connectors', name_bn: 'কেবল ও কানেক্টর', unit_en: 'box', unit_bn: 'বক্স', unit_price_poisha: bdtToPoisha('7250.00'), tax_category: 'STANDARD_15', inventory_account: '1310', is_stock_item: true },
  { id: 'ITM-007', sku: 'SVC-9983.11', hs_code: '9983.11.00', name_en: 'IT consultancy & systems integration', name_bn: 'আইটি পরামর্শ ও সিস্টেম ইন্টিগ্রেশন', unit_en: 'job', unit_bn: 'কাজ', unit_price_poisha: bdtToPoisha('400000.00'), tax_category: 'STANDARD_15', inventory_account: '5310', is_stock_item: false },
  { id: 'ITM-008', sku: 'SVC-6810.10', hs_code: '6810.10.00', name_en: 'Commercial office rent', name_bn: 'বাণিজ্যিক অফিস ভাড়া', unit_en: 'month', unit_bn: 'মাস', unit_price_poisha: bdtToPoisha('500000.00'), tax_category: 'STANDARD_15', inventory_account: '5300', is_stock_item: false },
  { id: 'ITM-009', sku: 'SVC-7310.10', hs_code: '7310.10.00', name_en: 'Digital advertising services', name_bn: 'ডিজিটাল বিজ্ঞাপন সেবা', unit_en: 'campaign', unit_bn: 'ক্যাম্পেইন', unit_price_poisha: bdtToPoisha('350000.00'), tax_category: 'STANDARD_15', inventory_account: '5320', is_stock_item: false },
  { id: 'ITM-010', sku: 'SVC-4923.00', hs_code: '4923.00.00', name_en: 'Freight & transport services', name_bn: 'মালবাহী ও পরিবহন সেবা', unit_en: 'trip', unit_bn: 'ট্রিপ', unit_price_poisha: bdtToPoisha('88000.00'), tax_category: 'STANDARD_15', inventory_account: '5330', is_stock_item: false },
];

/**
 * Perpetual inventory opening facts (blueprint §4.1–4.2): every seeded stock good starts with 100
 * units on hand, carried at a 70% weighted-average cost of its selling price.
 */
export const ITEMS: SeedItem[] = RAW_ITEMS.map((item) =>
  item.is_stock_item
    ? {
        ...item,
        qty_on_hand: item.qty_on_hand ?? 100,
        unit_cost_poisha: item.unit_cost_poisha ?? (item.unit_price_poisha * 70n) / 100n,
      }
    : item,
);

export const BANK_ACCOUNTS: BankAccount[] = [
  { id: 'BNK-1110', name_en: 'City Bank Corporate A/C', name_bn: 'সিটি ব্যাংক কর্পোরেট হিসাব', account_code: '1110', kind: 'BANK', provider: 'The City Bank Ltd.', masked_number: '•••• 4471', branch: 'Banani Branch', opening_poisha: bdtToPoisha('12500000.00'), accent: 'vault' },
  { id: 'BNK-1115', name_en: 'BRAC Bank Trade A/C', name_bn: 'ব্র্যাক ব্যাংক বাণিজ্য হিসাব', account_code: '1115', kind: 'BANK', provider: 'BRAC Bank Ltd.', masked_number: '•••• 8820', branch: 'Gulshan Branch', opening_poisha: bdtToPoisha('6800000.00'), accent: 'vault' },
  { id: 'BNK-1120', name_en: 'bKash Merchant Wallet', name_bn: 'বিকাশ মার্চেন্ট ওয়ালেট', account_code: '1120', kind: 'MFS', provider: 'bKash Ltd.', masked_number: '•••• 0171', branch: 'Merchant Settlement', opening_poisha: bdtToPoisha('745000.00'), accent: 'gold' },
  { id: 'BNK-1125', name_en: 'Nagad Merchant Wallet', name_bn: 'নগদ মার্চেন্ট ওয়ালেট', account_code: '1125', kind: 'MFS', provider: 'Nagad Ltd.', masked_number: '•••• 0196', branch: 'Merchant Settlement', opening_poisha: bdtToPoisha('320000.00'), accent: 'gold' },
  { id: 'BNK-1130', name_en: 'Dhaka HQ Petty Cash', name_bn: 'ঢাকা প্রধান কার্যালয় ক্ষুদ্র নগদ', account_code: '1130', kind: 'CASH', provider: 'Internal imprest', masked_number: 'IMPREST-DHK', branch: 'Head Office', opening_poisha: bdtToPoisha('1250000.00'), accent: 'ink' },
];

export const ACCOUNTING_PERIODS: AccountingPeriod[] = [
  { code: '2026-06', label: 'June 2026', start_date: '2026-06-01', end_date: '2026-06-30', status: 'LOCKED', locked_at: '2026-07-05T10:00:00.000+06:00', notes: 'FY 2025-26 closed and locked by the external auditor.' },
  { code: '2026-07', label: 'July 2026', start_date: '2026-07-01', end_date: '2026-07-31', status: 'CLOSED', closed_at: '2026-08-08T18:00:00.000+06:00', notes: 'Opening balances posted and signed off.' },
  { code: '2026-08', label: 'August 2026', start_date: '2026-08-01', end_date: '2026-08-31', status: 'CLOSED', closed_at: '2026-09-09T18:00:00.000+06:00' },
  { code: '2026-09', label: 'September 2026', start_date: '2026-09-01', end_date: '2026-09-30', status: 'CLOSED', closed_at: '2026-10-12T19:30:00.000+06:00', notes: 'September Mushak 9.1 filed on 14 October 2026.' },
  { code: '2026-10', label: 'October 2026', start_date: '2026-10-01', end_date: '2026-10-31', status: 'OPEN', notes: 'Current working period — Mushak 9.1 due 15 November 2026.' },
  { code: '2026-11', label: 'November 2026', start_date: '2026-11-01', end_date: '2026-11-30', status: 'OPEN' },
];

export const PERIOD_LABEL_EN: Record<string, string> = {
  '2026-06': 'June 2026',
  '2026-07': 'July 2026',
  '2026-08': 'August 2026',
  '2026-09': 'September 2026',
  '2026-10': 'October 2026',
  '2026-11': 'November 2026',
};

// ---------------------------------------------------------------------------------------------
// Payroll rows (Labour Act 2026 classes)
// ---------------------------------------------------------------------------------------------

export interface PayrollEmployeeRow extends PayrollLine {
  employee_code: string;
  name_en: string;
  name_bn: string;
  designation: string;
  worker_class: Employee['worker_class'];
  department: string;
  period_code: string;
}

interface EmployeeSeed {
  code: string;
  name_en: string;
  name_bn: string;
  designation: string;
  worker_class: Employee['worker_class'];
  department: string;
  basic: string;
  overtime: string;
  tin?: string;
}

const EMPLOYEE_SEEDS: EmployeeSeed[] = [
  { code: 'EMP-0001', name_en: 'Md. Rakibul Hasan', name_bn: 'মো. রাকিবুল হাসান', designation: 'Head of Finance', worker_class: 'PERMANENT', department: 'Finance', basic: '130000.00', overtime: '0.00', tin: '291837465012' },
  { code: 'EMP-0002', name_en: 'Nasrin Sultana', name_bn: 'নাসরিন সুলতানা', designation: 'Financial Controller', worker_class: 'PERMANENT', department: 'Finance', basic: '105000.00', overtime: '0.00', tin: '310928475613' },
  { code: 'EMP-0003', name_en: 'Farzana Akter', name_bn: 'ফারজানা আকতার', designation: 'Accounts Executive', worker_class: 'PERMANENT', department: 'Finance', basic: '47500.00', overtime: '0.00', tin: '429183746501' },
  { code: 'EMP-0004', name_en: 'Imran Hossain', name_bn: 'ইমরান হোসেন', designation: 'HR & Admin Manager', worker_class: 'PERMANENT', department: 'People', basic: '60000.00', overtime: '0.00', tin: '538291746502' },
  { code: 'EMP-0005', name_en: 'Shafiqul Islam', name_bn: 'শফিকুল ইসলাম', designation: 'Warehouse Supervisor', worker_class: 'PERMANENT', department: 'Operations', basic: '36000.00', overtime: '8000.00', tin: '647382915603' },
  { code: 'EMP-0006', name_en: 'Tanjina Rahman', name_bn: 'তানজিনা রহমান', designation: 'Sales Executive', worker_class: 'PROBATIONARY', department: 'Sales', basic: '40000.00', overtime: '0.00', tin: '756473829104' },
  { code: 'EMP-0007', name_en: 'Kamal Uddin', name_bn: 'কামাল উদ্দিন', designation: 'Delivery Driver', worker_class: 'CONTRACTUAL', department: 'Operations', basic: '22500.00', overtime: '5000.00' },
  { code: 'EMP-0008', name_en: 'Rina Begum', name_bn: 'রিনা বেগম', designation: 'Accounts Assistant', worker_class: 'PERMANENT', department: 'Finance', basic: '27500.00', overtime: '0.00', tin: '865564738205' },
];

export const EMPLOYEES: Employee[] = EMPLOYEE_SEEDS.map((seed, index) => {
  const basic = bdtToPoisha(seed.basic);
  return {
    id: `EMP-${String(index + 1).padStart(4, '0')}`,
    employee_code: seed.code,
    name_en: seed.name_en,
    name_bn: seed.name_bn,
    designation: seed.designation,
    worker_class: seed.worker_class,
    department: seed.department,
    basic_poisha: basic,
    house_rent_poisha: applyRateBps(basic, 5000),
    medical_poisha: applyRateBps(basic, 1000),
    transport_poisha: applyRateBps(basic, 1000),
    pf_employee_poisha: applyRateBps(basic, 500),
    pf_employer_poisha: applyRateBps(basic, 500),
    tin: seed.tin,
  };
});

export function buildPayrollRows(periodCode: string, includeFestivalBonus: boolean): PayrollEmployeeRow[] {
  return EMPLOYEES.map((employee, index) => {
    const seed = EMPLOYEE_SEEDS[index];
    const overtime = bdtToPoisha(seed.overtime);
    const festivalBonus = includeFestivalBonus ? applyRateBps(employee.basic_poisha, 1000) : 0n;
    const gross =
      employee.basic_poisha +
      employee.house_rent_poisha +
      employee.medical_poisha +
      employee.transport_poisha +
      overtime +
      festivalBonus;
    const pfEmployee = employee.pf_employee_poisha;
    const pfEmployer = employee.pf_employer_poisha;
    const gratuity = applyRateBps(employee.basic_poisha, 833);
    const net = gross - pfEmployee;
    return {
      employee_id: employee.id,
      employee_code: employee.employee_code,
      name_en: employee.name_en,
      name_bn: employee.name_bn,
      designation: employee.designation,
      worker_class: employee.worker_class,
      department: employee.department,
      period_code: periodCode,
      employee_name: employee.name_en,
      basic_poisha: employee.basic_poisha,
      house_rent_poisha: employee.house_rent_poisha,
      medical_poisha: employee.medical_poisha,
      transport_poisha: employee.transport_poisha,
      overtime_poisha: overtime,
      festival_bonus_poisha: festivalBonus,
      gross_poisha: gross,
      pf_employee_poisha: pfEmployee,
      pf_employer_poisha: pfEmployer,
      gratuity_poisha: gratuity,
      tds_poisha: 0n,
      net_poisha: net,
    };
  });
}

export function payrollTotals(rows: PayrollEmployeeRow[]): {
  gross: bigint;
  pfEmployee: bigint;
  pfEmployer: bigint;
  gratuity: bigint;
  net: bigint;
} {
  return rows.reduce(
    (totals, row) => ({
      gross: totals.gross + row.gross_poisha,
      pfEmployee: totals.pfEmployee + row.pf_employee_poisha,
      pfEmployer: totals.pfEmployer + row.pf_employer_poisha,
      gratuity: totals.gratuity + row.gratuity_poisha,
      net: totals.net + row.net_poisha,
    }),
    { gross: 0n, pfEmployee: 0n, pfEmployer: 0n, gratuity: 0n, net: 0n },
  );
}

// ---------------------------------------------------------------------------------------------
// Statutory notices & licences
// ---------------------------------------------------------------------------------------------

export interface StatutoryNoticeAndLicence {
  id: string;
  kind: 'NOTICE' | 'LICENCE';
  reference: string;
  title_en: string;
  title_bn: string;
  authority: string;
  issued_date: string;
  due_or_expiry: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'RESPONDED' | 'CLOSED' | 'VALID' | 'EXPIRING' | 'EXPIRED';
  amount_poisha: bigint;
  notes_en: string;
  notes_bn: string;
}

export const STATUTORY_NOTICES_AND_LICENCES: StatutoryNoticeAndLicence[] = [
  {
    id: 'STN-001',
    kind: 'NOTICE',
    reference: 'NBR/VAT/CTG/2026/1187',
    title_en: 'Mushak 6.3 serial sequence query — Chattogram unit',
    title_bn: 'মূসক ৬.৩ সিরিয়াল ক্রম জিজ্ঞাসা — চট্টগ্রাম ইউনিট',
    authority: 'NBR VAT Commissionerate, Chattogram',
    issued_date: '2026-10-08',
    due_or_expiry: '2026-11-06',
    risk: 'HIGH',
    status: 'OPEN',
    amount_poisha: 0n,
    notes_en: 'Respond with the gap-free Mushak 6.3 register export and Treasury challan proofs for July–September 2026.',
    notes_bn: 'জুলাই–সেপ্টেম্বর ২০২৬-এর ফাঁকহীন মূসক ৬.৩ রেজিস্টার ও ট্রেজারি চালান প্রমাণসহ জবাব দিন।',
  },
  {
    id: 'STN-002',
    kind: 'NOTICE',
    reference: 'NBR/IT/AIT/2026/0452',
    title_en: 'Advance income tax reconciliation for FY 2025-26',
    title_bn: 'অর্থবছর ২০২৫-২৬-এর অগ্রিম আয়কর সমন্বয়',
    authority: 'Deputy Commissioner of Taxes, Taxes Circle 128',
    issued_date: '2026-09-22',
    due_or_expiry: '2026-10-22',
    risk: 'MEDIUM',
    status: 'RESPONDED',
    amount_poisha: bdtToPoisha('176000.00'),
    notes_en: 'Reconciliation filed on 18 October 2026 with the customer AIT certificates.',
    notes_bn: '১৮ অক্টোবর ২০২৬ তারিখে গ্রাহক এআইটি সনদসহ সমন্বয় দাখিল করা হয়েছে।',
  },
  {
    id: 'STN-003',
    kind: 'LICENCE',
    reference: 'RJSC-C-148239/2019',
    title_en: 'Certificate of Incorporation — RJSC',
    title_bn: 'নিবন্ধন সনদ — আরজেএসসি',
    authority: 'Registrar of Joint Stock Companies and Firms',
    issued_date: '2019-04-18',
    due_or_expiry: '2027-04-17',
    risk: 'LOW',
    status: 'VALID',
    amount_poisha: 0n,
    notes_en: 'Annual return (Schedule X) due within 21 days of the AGM.',
    notes_bn: 'বার্ষিক রিটার্ন (তফসিল ১০) এজিএমের ২১ দিনের মধ্যে দাখিল করতে হবে।',
  },
  {
    id: 'STN-004',
    kind: 'LICENCE',
    reference: 'DIFE/HR/2026/2214',
    title_en: 'Factory & establishment labour licence — DIFE',
    title_bn: 'কারখানা ও প্রতিষ্ঠান শ্রম লাইসেন্স — ডিআইএফই',
    authority: 'Department of Inspection for Factories and Establishments',
    issued_date: '2026-01-15',
    due_or_expiry: '2026-12-31',
    risk: 'MEDIUM',
    status: 'EXPIRING',
    amount_poisha: bdtToPoisha('12500.00'),
    notes_en: 'Renewal window opens 1 November 2026; WPPF board approval attached.',
    notes_bn: 'নবায়ন সময় ১ নভেম্বর ২০২৬ থেকে; ডব্লিউপিপিএফ বোর্ড অনুমোদন সংযুক্ত।',
  },
  {
    id: 'STN-005',
    kind: 'LICENCE',
    reference: 'FSCD/FS/2026/0093',
    title_en: 'Fire safety clearance certificate',
    title_bn: 'অগ্নি নিরাপত্তা ছাড়পত্র',
    authority: 'Fire Service and Civil Defence',
    issued_date: '2025-11-20',
    due_or_expiry: '2026-11-19',
    risk: 'HIGH',
    status: 'EXPIRING',
    amount_poisha: bdtToPoisha('8000.00'),
    notes_en: 'Inspection scheduled for 12 November 2026 at the Banani head office.',
    notes_bn: '১২ নভেম্বর ২০২৬ তারিখে বনানী প্রধান কার্যালয়ে পরিদর্শন নির্ধারিত।',
  },
];

export const NOTICES: Notice[] = STATUTORY_NOTICES_AND_LICENCES.filter((row) => row.kind === 'NOTICE').map((row) => ({
  id: row.id,
  reference: row.reference,
  authority: row.authority,
  subject_en: row.title_en,
  subject_bn: row.title_bn,
  received_date: row.issued_date,
  response_due: row.due_or_expiry,
  status: row.status === 'OPEN' ? 'OPEN' : row.status === 'RESPONDED' ? 'RESPONDED' : 'CLOSED',
  risk: row.risk,
  notes: row.notes_en,
}));

export const LICENCES: LicenceRecord[] = STATUTORY_NOTICES_AND_LICENCES.filter((row) => row.kind === 'LICENCE').map((row) => ({
  id: row.id,
  name_en: row.title_en,
  name_bn: row.title_bn,
  authority: row.authority,
  number: row.reference,
  expiry_date: row.due_or_expiry,
  status: row.status === 'VALID' ? 'VALID' : row.status === 'EXPIRING' ? 'EXPIRING' : 'EXPIRED',
  fee_poisha: row.amount_poisha,
}));

// ---------------------------------------------------------------------------------------------
// Balanced-journal builder
// ---------------------------------------------------------------------------------------------

export type SeedLineInput = [
  code: string,
  debit: bigint | string | number,
  credit: bigint | string | number,
  partyName?: string,
  memoEn?: string,
  memoBn?: string,
];

export interface SeedJournalSpec {
  number?: string;
  date: string;
  book?: BookType;
  source: SourceModule;
  docRef?: string;
  docId?: string;
  narration_en: string;
  narration_bn: string;
  lines: Array<SeedLineInput | JournalLineDraft>;
  status?: DocumentLifecycleStatus;
  binUnit?: string;
  taxTraceId?: string;
  rulePack?: string;
  batchId?: string;
  actor?: string;
}

function toPoisha(value: bigint | string | number): bigint {
  return typeof value === 'bigint' ? value : bdtToPoisha(value);
}

function toLineDraft(input: SeedLineInput | JournalLineDraft): JournalLineDraft {
  if (Array.isArray(input)) {
    const [code, debit, credit, partyName, memoEn, memoBn] = input;
    const names = accountName(code);
    return {
      account_code: code,
      account_name_en: names.name_en,
      account_name_bn: names.name_bn,
      debit_poisha: toPoisha(debit),
      credit_poisha: toPoisha(credit),
      party_name: partyName,
      memo: memoEn ?? memoBn ?? undefined,
    };
  }
  return input;
}

/**
 * Build and seal one seeded journal. Throws (rather than silently posting) if the caller produced
 * an unbalanced, single-line or zero-value journal — so a seed bug can never reach the ledger.
 */
export function buildBalancedJournal(spec: SeedJournalSpec, context: JournalPostContext): JournalEntry {
  const lines = spec.lines.map(toLineDraft);
  const totals = journalTotals(lines);
  if (lines.length < 2) {
    throw new Error(`Seeded journal ${spec.number ?? spec.narration_en} needs at least two lines.`);
  }
  if (totals.debit_poisha <= 0n) {
    throw new Error(`Seeded journal ${spec.number ?? spec.narration_en} has no debit total.`);
  }
  if (totals.debit_poisha !== totals.credit_poisha) {
    throw new Error(
      `Seeded journal ${spec.number ?? spec.narration_en} is unbalanced: debit ${totals.debit_poisha.toString()} vs credit ${totals.credit_poisha.toString()} poisha.`,
    );
  }
  return postJournal(
    {
      journal_number: spec.number,
      book_type: spec.book ?? 'STATUTORY_BD',
      bin_unit_id: spec.binUnit ?? 'BU-DHK',
      document_date: spec.date,
      posting_date: spec.date,
      tax_point_date: spec.date,
      source_module: spec.source,
      source_doc_ref: spec.docRef,
      source_doc_id: spec.docId,
      import_batch_id: spec.batchId,
      narration_en: spec.narration_en,
      narration_bn: spec.narration_bn,
      status: spec.status ?? 'POSTED',
      rule_pack_version: spec.rulePack ?? 'bd-2026-v1',
      tax_decision_trace_id: spec.taxTraceId,
      created_by: spec.actor ?? 'farzana',
      approved_by: spec.actor ?? 'nasrin',
      posted_at: `${spec.date}T10:00:00.000+06:00`,
      lines,
    },
    context,
  );
}

function docSourceModule(docType: CommercialDocType): SourceModule {
  if (docType === 'SALES_INVOICE' || docType === 'CREDIT_NOTE') return 'SALES';
  return 'PURCHASES';
}

export interface SeedSettlement {
  date: string;
  bankUnit?: string;
}

// ---------------------------------------------------------------------------------------------
// Ledger builder
// ---------------------------------------------------------------------------------------------

class SeedLedger {
  readonly journals: JournalEntry[] = [];
  readonly documents: TaxAnnotatedDoc[] = [];
  readonly challans: Challan[] = [];
  private challanSequence = 0;
  private readonly context: JournalPostContext;

  constructor(
    readonly periods: AccountingPeriod[],
    readonly accounts: Account[],
  ) {
    this.context = {
      journals: this.journals,
      periods: this.periods,
      accounts: this.accounts,
      actor: 'farzana',
    };
  }

  post(spec: SeedJournalSpec): JournalEntry {
    const journal = buildBalancedJournal(spec, this.context);
    this.journals.push(journal);
    return journal;
  }

  /** Debit-positive live balance of an account at the current point in the seed. */
  balance(code: string): bigint {
    let total = 0n;
    for (const journal of this.journals) {
      for (const line of journal.lines) {
        if (line.account_code !== code) continue;
        total += line.debit_poisha - line.credit_poisha;
      }
    }
    return total;
  }

  /** Credit-positive live balance (normal side for liabilities and equity). */
  creditBalance(code: string): bigint {
    return -this.balance(code);
  }

  /** Debit-positive balance restricted to journals posted on or before a statutory cutoff. */
  balanceAsOf(code: string, cutoff: string): bigint {
    let total = 0n;
    for (const journal of this.journals) {
      if (journal.posting_date > cutoff) continue;
      for (const line of journal.lines) {
        if (line.account_code !== code) continue;
        total += line.debit_poisha - line.credit_poisha;
      }
    }
    return total;
  }

  creditBalanceAsOf(code: string, cutoff: string): bigint {
    return -this.balanceAsOf(code, cutoff);
  }

  postDoc(
    spec: CommercialDocSpec,
    settlement: SeedSettlement | null,
  ): { doc: TaxAnnotatedDoc; documentJournal: JournalEntry; settlementJournal?: JournalEntry } {
    const built = buildCommercialDoc(spec);
    const documentJournal = this.post({
      date: spec.doc_date,
      book: spec.book_type ?? 'STATUTORY_BD',
      source: docSourceModule(spec.doc_type),
      docRef: spec.doc_number,
      docId: built.doc.id,
      narration_en: spec.narration_en,
      narration_bn: spec.narration_bn,
      taxTraceId: built.doc.tax_trace_id,
      lines: built.document_lines,
    });
    built.doc.document_journal_id = documentJournal.id;

    let settlementJournal: JournalEntry | undefined;
    if (settlement) {
      settlementJournal = this.post({
        date: settlement.date,
        book: spec.book_type ?? 'STATUTORY_BD',
        source: 'BANK_MFS',
        docRef: spec.doc_number,
        docId: built.doc.id,
        narration_en: `Settlement of ${spec.doc_number} — ${spec.party.name_en}`,
        narration_bn: `${spec.doc_number} নিষ্পত্তি — ${spec.party.name_bn}`,
        taxTraceId: built.doc.tax_trace_id,
        lines: built.settlement_lines,
      });
      built.doc.settlement_journal_id = settlementJournal.id;
      built.doc.settled_poisha = built.doc.gross_poisha;
      built.doc.status = 'SETTLED';
    }

    this.documents.push(built.doc);
    return { doc: built.doc, documentJournal, settlementJournal };
  }

  addChallan(challan: Omit<Challan, 'id' | 'challan_number'> & { challan_number?: string }): Challan {
    this.challanSequence += 1;
    const record: Challan = {
      ...challan,
      id: `CHL-${String(this.challanSequence).padStart(3, '0')}`,
      challan_number:
        challan.challan_number ?? `CH-${challan.type}-${challan.period_code}-${String(this.challanSequence).padStart(3, '0')}`,
    };
    this.challans.push(record);
    return record;
  }

  /** Clear a withholding liability to the Treasury and record the deposited challan. */
  depositWithholding(
    type: 'VDS' | 'TDS',
    date: string,
    economicCode: string,
    periodCode: string,
    cutoff: string,
  ): Challan | null {
    const code = type === 'VDS' ? '2130' : '2140';
    const amount = this.creditBalanceAsOf(code, cutoff);
    if (amount <= 0n) return null;
    const journal = this.post({
      date,
      source: 'BANK_MFS',
      docRef: `CH-${type}-${periodCode}`,
      narration_en: `${type} withheld for ${PERIOD_LABEL_EN[periodCode] ?? periodCode} deposited to the Government Treasury (economic code ${economicCode}).`,
      narration_bn: `${PERIOD_LABEL_EN[periodCode] ?? periodCode}-এর কর্তিত ${type} সরকারি কোষাগারে জমা (অর্থনৈতিক কোড ${economicCode})।`,
      lines: [
        [code, amount, 0n, undefined, `${type} liability cleared`, `${type} দায় নিষ্পত্তি`],
        ['1110', 0n, amount, 'Government Treasury', 'Treasury deposit', 'কোষাগার জমা'],
      ],
    });
    return this.addChallan({
      type,
      period_code: periodCode,
      amount_poisha: amount,
      economic_code: economicCode,
      deposit_date: date,
      status: 'DEPOSITED',
      journal_id: journal.id,
      certificate_numbers: [`6.6/${periodCode}/${String(this.challanSequence).padStart(4, '0')}`],
      narration: `${type} challan for ${PERIOD_LABEL_EN[periodCode] ?? periodCode}`,
    });
  }

  /** Mushak 9.1 filing: settle output VAT against eligible input credit and pay the net. */
  fileVatReturn(date: string, periodCode: string, cutoff: string): Challan | null {
    const output = this.creditBalanceAsOf('2120', cutoff);
    if (output <= 0n) return null;
    const inputAvailable = this.balanceAsOf('1140', cutoff);
    const utilised = inputAvailable > 0n ? (inputAvailable > output ? output : inputAvailable) : 0n;
    const net = output - utilised;
    const lines: Array<SeedLineInput | JournalLineDraft> = [
      ['2120', output, 0n, undefined, 'Output VAT settled through Mushak 9.1', 'মূসক ৯.১-এর মাধ্যমে আউটপুট ভ্যাট নিষ্পত্তি'],
    ];
    if (utilised > 0n) {
      lines.push(['1140', 0n, utilised, undefined, 'Input VAT rebate utilised', 'ইনপুট ভ্যাট রিবেট ব্যবহার']);
    }
    if (net > 0n) {
      lines.push(['1110', 0n, net, 'Government Treasury', 'Net VAT payable deposited', 'নিট ভ্যাট প্রদেয় জমা']);
    } else if (net < 0n) {
      lines.push(['1140', -net, 0n, undefined, 'Excess input credit carried forward', 'অতিরিক্ত ইনপুট ক্রেডিট পরবর্তী মেয়াদে']);
    }
    const journal = this.post({
      date,
      source: 'MANUAL_JOURNAL',
      docRef: `MUSHAK-9.1-${periodCode}`,
      narration_en: `Mushak 9.1 VAT return for ${PERIOD_LABEL_EN[periodCode] ?? periodCode} — output VAT ${output.toString()} poisha less eligible input rebate.`,
      narration_bn: `${PERIOD_LABEL_EN[periodCode] ?? periodCode}-এর মূসক ৯.১ ভ্যাট রিটার্ন — আউটপুট ভ্যাট ${output.toString()} পয়সা থেকে যোগ্য ইনপুট রিবেট বাদ।`,
      lines,
    });
    return this.addChallan({
      type: 'VAT',
      period_code: periodCode,
      amount_poisha: net > 0n ? net : 0n,
      economic_code: '1.1.04.01.02',
      deposit_date: net > 0n ? date : undefined,
      status: 'DEPOSITED',
      journal_id: journal.id,
      certificate_numbers: [],
      narration: `Mushak 9.1 net VAT for ${PERIOD_LABEL_EN[periodCode] ?? periodCode}`,
    });
  }

  /** IFRS 9 ECL: top the allowance up (or release it) to the target matrix rate on open AR. */
  postExpectedCreditLoss(date: string, targetRateBps: number): JournalEntry | null {
    const arBalance = this.balance('1210');
    if (arBalance <= 0n) return null;
    const target = applyRateBps(arBalance, targetRateBps);
    const currentAllowance = this.creditBalance('1219');
    const delta = target - currentAllowance;
    if (delta === 0n) return null;
    const isCharge = delta > 0n;
    return this.post({
      date,
      source: 'IFRS_ADJUSTMENT',
      narration_en: isCharge
        ? `IFRS 9 expected credit loss provision — ${targetRateBps / 100}% of open receivables.`
        : `IFRS 9 expected credit loss release — receivables matrix improved.`,
      narration_bn: isCharge
        ? `আইএফএআরএস ৯ প্রত্যাশিত ক্রেডিট ক্ষতি সঞ্চিতি — প্রাপ্যের ${targetRateBps / 100}%।`
        : `আইএফএআরএস ৯ প্রত্যাশিত ক্রেডিট ক্ষতি হ্রাস — প্রাপ্য ম্যাট্রিক্স উন্নত।`,
      lines: [
        ['5450', isCharge ? delta : 0n, isCharge ? 0n : -delta, undefined, 'ECL impairment charge', 'ইসিএল ক্ষতি ব্যয়'],
        ['1219', isCharge ? 0n : -delta, isCharge ? delta : 0n, undefined, 'ECL allowance', 'ইসিএল ভাতা'],
      ],
    });
  }

  postPayroll(date: string, periodCode: string, includeFestivalBonus: boolean): {
    rows: PayrollEmployeeRow[];
    journal: JournalEntry;
    paymentJournal: JournalEntry;
  } {
    const rows = buildPayrollRows(periodCode, includeFestivalBonus);
    const totals = payrollTotals(rows);
    const wppfProvision = 6_000_000n; // BDT 60,000.00 monthly WPPF accrual
    const journal = this.post({
      date,
      source: 'PAYROLL_LITE',
      narration_en: `Payroll accrual for ${PERIOD_LABEL_EN[periodCode] ?? periodCode} — ${rows.length} employees${includeFestivalBonus ? ' including festival bonus' : ''}, employer PF and IAS 19 gratuity service cost.`,
      narration_bn: `${PERIOD_LABEL_EN[periodCode] ?? periodCode}-এর বেতন সঞ্চিতি — ${rows.length} কর্মী${includeFestivalBonus ? ' উৎসব ভাতাসহ' : ''}, নিয়োগকর্তার পিএফ ও আইএএস ১৯ গ্র্যাচুইটি সেবা ব্যয়।`,
      lines: [
        ['5200', totals.gross, 0n, undefined, 'Gross salaries, overtime and festival bonus', 'মোট বেতন, ওভারটাইম ও উৎসব ভাতা'],
        ['5200', wppfProvision, 0n, undefined, 'WPPF provision at 5% of profit before WPPF', 'ডব্লিউপিপিএফ সঞ্চিতি'],
        ['5210', totals.pfEmployer + totals.gratuity, 0n, undefined, 'Employer PF and gratuity service cost', 'নিয়োগকর্তার পিএফ ও গ্র্যাচুইটি সেবা ব্যয়'],
        ['2160', 0n, totals.net + totals.pfEmployee + totals.pfEmployer, undefined, 'Net pay and PF payable', 'নিট বেতন ও পিএফ প্রদেয়'],
        ['2610', 0n, totals.gratuity, undefined, 'Gratuity obligation', 'গ্র্যাচুইটি দায়'],
        ['2170', 0n, wppfProvision, undefined, 'WPPF welfare fund provision', 'ডব্লিউপিপিএফ কল্যাণ তহবিল সঞ্চিতি'],
      ],
    });
    const paymentJournal = this.post({
      date: addDays(date, 3),
      source: 'BANK_MFS',
      docRef: `PAYROLL-${periodCode}`,
      narration_en: `Net salaries and PF settled through BEFTN for ${PERIOD_LABEL_EN[periodCode] ?? periodCode}.`,
      narration_bn: `${PERIOD_LABEL_EN[periodCode] ?? periodCode}-এর নিট বেতন ও পিএফ বিইএফটিএন-এ নিষ্পত্তি।`,
      lines: [
        ['2160', totals.net + totals.pfEmployee + totals.pfEmployer, 0n, undefined, 'Accrued payroll settled', 'সঞ্চিত বেতন নিষ্পত্তি'],
        ['1110', 0n, totals.net + totals.pfEmployee + totals.pfEmployer, undefined, 'BEFTN disbursement', 'বিইএফটিএন বিতরণ'],
      ],
    });
    return { rows, journal, paymentJournal };
  }
}

// ---------------------------------------------------------------------------------------------
// The dataset
// ---------------------------------------------------------------------------------------------

export interface SeedDataset {
  tenant: TenantEntity;
  accounts: Account[];
  parties: Party[];
  items: SeedItem[];
  bankAccounts: BankAccount[];
  periods: AccountingPeriod[];
  journals: JournalEntry[];
  commercialDocs: TaxAnnotatedDoc[];
  challans: Challan[];
  statementLines: BankStatementLine[];
  vdsCertificates: VdsCertificate[];
  payrollRows: PayrollEmployeeRow[];
  statutoryRecords: StatutoryNoticeAndLicence[];
  notices: Notice[];
  licences: LicenceRecord[];
  employees: Employee[];
  meta: {
    generated_at: string;
    journal_count: number;
    document_count: number;
    current_period: string;
    comparative_period: string;
    opening_journal: string;
    seed_version: string;
  };
}

function docLine(itemCode: string, sku: string, quantity: number, unitPrice: bigint): DocLine {
  const item = ITEMS.find((entry) => entry.id === itemCode);
  return {
    id: `${sku}-L1-${quantity}`,
    sku,
    description_en: item?.name_en ?? sku,
    description_bn: item?.name_bn ?? sku,
    quantity,
    unit_price_poisha: unitPrice,
    tax_category: item?.tax_category ?? 'STANDARD_15',
  };
}

/**
 * Build the complete Apex Delta Trading Ltd. dataset: 3-book chart of accounts, 30+ balanced
 * journals across September and October 2026, matching commercial documents, challans, VDS
 * certificates, bank statements and payroll rows.
 */
export function createSeedDataset(personaKey: TenantEntity['persona_key'] = 'APEX'): SeedDataset {
  const tenant = tenantByKey(personaKey);
  // The seed reconstructs historical journals that a live system would have posted while those
  // periods were still open. Construct against an OPEN view, then expose the real CLOSED/LOCKED
  // statuses in the dataset. This never bypasses the runtime posting rule.
  const seedPostingPeriods = ACCOUNTING_PERIODS.map((period) => ({ ...period, status: 'OPEN' as const }));
  const ledger = new SeedLedger(seedPostingPeriods, ACCOUNTS);
  const binUnit = tenant.bin_units[0]?.id ?? 'BU-DHK';
  const costOf = (percentBps: number, base: bigint): bigint => applyRateBps(base, percentBps);

  // ---- 1. Opening balances (JE-2026-07-0001) ------------------------------------------------
  const openingDebits: SeedLineInput[] = [
    ['1110', '12500000.00', 0n, undefined, 'City Bank current account', 'সিটি ব্যাংক চলতি হিসাব'],
    ['1115', '6800000.00', 0n, undefined, 'BRAC Bank trade account', 'ব্র্যাক ব্যাংক বাণিজ্য হিসাব'],
    ['1120', '745000.00', 0n, undefined, 'bKash merchant wallet', 'বিকাশ মার্চেন্ট ওয়ালেট'],
    ['1125', '320000.00', 0n, undefined, 'Nagad merchant wallet', 'নগদ মার্চেন্ট ওয়ালেট'],
    ['1130', '1250000.00', 0n, undefined, 'Petty cash imprest', 'ক্ষুদ্র নগদ ইমপ্রেস'],
    ['1210', '8420000.00', 0n, undefined, 'Trade receivables control', 'বাণিজ্যিক প্রাপ্য নিয়ন্ত্রণ'],
    ['1310', '15300000.00', 0n, undefined, 'Merchandise inventory', 'মজুদ পণ্য'],
    ['1610', '22600000.00', 0n, undefined, 'PPE at cost', 'সম্পত্তি ও যন্ত্রপাতি ব্যয়ে'],
    ['1710', '9840000.00', 0n, undefined, 'IFRS 16 right-of-use assets', 'আইএফএআরএস ১৬ ব্যবহারের অধিকার সম্পদ'],
  ];
  const openingCredits: SeedLineInput[] = [
    ['1619', 0n, '6900000.00', undefined, 'Accumulated depreciation on PPE', 'সম্পত্তিতে সঞ্চিত অবচয়'],
    ['1719', 0n, '1968000.00', undefined, 'Accumulated depreciation on ROU assets', 'ব্যবহারের অধিকার সম্পদে সঞ্চিত অবচয়'],
    ['2110', 0n, '7240000.00', undefined, 'Trade payables control', 'বাণিজ্যিক প্রদেয় নিয়ন্ত্রণ'],
    ['2120', 0n, '640000.00', undefined, 'Output VAT payable carried from August', 'আগস্ট থেকে আউটপুট ভ্যাট প্রদেয়'],
    ['2130', 0n, '285000.00', undefined, 'VDS withheld payable', 'কর্তিত ভিডিএস প্রদেয়'],
    ['2140', 0n, '176000.00', undefined, 'TDS withheld payable', 'কর্তিত টিডিএস প্রদেয়'],
    ['2160', 0n, '520000.00', undefined, 'Accrued salaries', 'সঞ্চিত বেতন'],
    ['2170', 0n, '310000.00', undefined, 'WPPF provision', 'ডব্লিউপিপিএফ সঞ্চিতি'],
    ['2180', 0n, '1150000.00', undefined, 'Current income tax provision', 'চলতি আয়কর সঞ্চিতি'],
    ['2210', 0n, '9500000.00', undefined, 'Short-term working capital loan', 'স্বল্পমেয়াদি কার্যকরী মূলধন ঋণ'],
    ['2510', 0n, '8600000.00', undefined, 'Lease liability', 'লিজ দায়'],
    ['2610', 0n, '3240000.00', undefined, 'Gratuity obligation', 'গ্র্যাচুইটি দায়'],
    ['3100', 0n, '20000000.00', undefined, 'Issued and paid-up share capital', 'ইস্যুকৃত ও পরিশোধিত শেয়ার মূলধন'],
  ];
  const openingDebitTotal = openingDebits.reduce(
    (sum, line) => sum + toPoisha(line[1]) - toPoisha(line[2]),
    0n,
  );
  const openingCreditTotal = openingCredits.reduce(
    (sum, line) => sum + toPoisha(line[2]) - toPoisha(line[1]),
    0n,
  );
  const retainedEarnings = openingDebitTotal - openingCreditTotal;

  ledger.post({
    number: OPENING_JOURNAL_NUMBER,
    date: '2026-07-01',
    source: 'OPENING_BALANCE',
    narration_en:
      'Opening balances brought forward for FY 2026-27 — cash, bank and MFS, inventory, PPE and ROU assets against payables, provisions, lease, loan, share capital and retained earnings.',
    narration_bn:
      '২০২৬-২৭ অর্থবছরের উদ্বোধনী ব্যালেন্স — নগদ, ব্যাংক ও এমএফএস, মজুদ, সম্পত্তি ও আরওইউ সম্পদ, প্রদেয়, সঞ্চিতি, লিজ, ঋণ, শেয়ার মূলধন ও সঞ্চিত মুনাফার বিপরীতে।',
    lines: [
      ...openingDebits,
      ...openingCredits,
      ['3200', 0n, retainedEarnings, undefined, 'Retained earnings balancing figure', 'সঞ্চিত মুনাফা সমন্বয়'],
    ],
  });

  // ---- 2. September 2026 — revenue, purchases, withholding --------------------------------

  ledger.post({
    date: '2026-09-02',
    source: 'BANK_MFS',
    docRef: 'FDR-2026-09-0001',
    narration_en: 'Short-term fixed deposit receipt placed with City Bank at 7.50% for 90 days.',
    narration_bn: 'সিটি ব্যাংকে ৭.৫০% হারে ৯০ দিনের স্বল্পমেয়াদি স্থায়ী আমানত স্থাপন।',
    lines: [
      ['1410', '3000000.00', 0n, undefined, 'FDR placement', 'এফডিআর স্থাপন'],
      ['1110', 0n, '3000000.00', undefined, 'Funds transferred to FDR', 'এফডিআরে অর্থ স্থানান্তর'],
    ],
  });

  // Sale 1 — standard 15% with Mushak 6.3
  ledger.postDoc(
    {
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-09-0001',
      doc_date: '2026-09-03',
      due_date: '2026-10-03',
      party: partyById('PTY-MEGHNA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-001', 'HS-8471.30', 30, bdtToPoisha('98500.00'))],
      base_poisha: bdtToPoisha('2955000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Local standard-rate sale to Meghna Distribution Ltd. — Mushak 6.3 issued, input rebate available to the buyer.',
      narration_bn: 'মেঘনা ডিস্ট্রিবিউশন লিমিটেডের কাছে স্থানীয় আদর্শ হার বিক্রয় — মূসক ৬.৩ ইস্যু, ক্রেতার ইনপুট রিবেট প্রযোজ্য।',
      mushak_serial: 'M63-2026-00001',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-29' },
  );

  // Sale 2 — corporate buyer withholding VDS (Mushak 6.6 pending)
  ledger.postDoc(
    {
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-09-0002',
      doc_date: '2026-09-05',
      due_date: '2026-10-20',
      party: partyById('PTY-BEXIMCO'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-005', 'HS-6302.60', 100, bdtToPoisha('21800.00')), docLine('ITM-003', 'HS-9403.60', 12, bdtToPoisha('36400.00'))],
      base_poisha: bdtToPoisha('2616800.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Corporate contract sale to Beximco Trading Corporation — buyer withholds 15% VDS and a Mushak 6.6 certificate is pending.',
      narration_bn: 'বেক্সিমকো ট্রেডিং কর্পোরেশনের কাছে কর্পোরেট বিক্রয় — ক্রেতা ১৫% ভিডিএস কর্তন করেছে, মূসক ৬.৬ সনদ অপেক্ষমাণ।',
      mushak_serial: 'M63-2026-00002',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-30' },
  );

  // Sale 3 — bKash merchant collection
  ledger.postDoc(
    {
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-09-0003',
      doc_date: '2026-09-09',
      due_date: '2026-09-30',
      party: partyById('PTY-DHAKAFASHION'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-004', 'HS-4820.10', 100, bdtToPoisha('1850.00')), docLine('ITM-006', 'HS-8544.42', 50, bdtToPoisha('7250.00'))],
      base_poisha: bdtToPoisha('547500.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'MFS',
      narration_en: 'Retail sale collected through the bKash merchant wallet — Mushak 6.3 issued and settled same day.',
      narration_bn: 'বিকাশ মার্চেন্ট ওয়ালেটে সংগৃহীত খুচরা বিক্রয় — মূসক ৬.৩ ইস্যু ও একই দিনে নিষ্পত্তি।',
      mushak_serial: 'M63-2026-00003',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-09' },
  );

  // Purchase 1 — registered 13-digit BIN + 12-digit e-TIN, rebate eligible
  const padmaPurchase = ledger.postDoc(
    {
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-09-0111',
      doc_date: '2026-09-08',
      due_date: '2026-09-29',
      party: partyById('PTY-PADMA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-001', 'HS-8471.30', 12, bdtToPoisha('98500.00')), docLine('ITM-006', 'HS-8544.42', 33, bdtToPoisha('7250.00'))],
      base_poisha: bdtToPoisha('1421250.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
      narration_en: 'Inventory purchase from Padma Industrial Supplies — valid BIN and e-TIN, 3% TDS withheld on the base.',
      narration_bn: 'পদ্মা ইন্ডাস্ট্রিয়াল সাপ্লাইজ থেকে মজুদ ক্রয় — বৈধ বিআইএন ও ই-টিআইএন, ভিত্তির ওপর ৩% টিডিএস কর্তন।',
      mushak_serial: 'M63-SUP-2026-0411',
      cost_account_code: '1310',
      cost_account_name_en: 'Merchandise Inventory — Weighted Average',
      cost_account_name_bn: 'মজুদ পণ্য — ভারযুক্ত গড়',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-11' },
  );

  // Purchase 2 — cash above BDT 1,00,000 → s.46 input VAT disallowed and capitalised
  ledger.postDoc(
    {
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-09-0118',
      doc_date: '2026-09-10',
      due_date: '2026-09-10',
      party: partyById('PTY-SYLHETAGRO'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-003', 'HS-9403.60', 10, bdtToPoisha('18000.00'))],
      base_poisha: bdtToPoisha('180000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'CASH',
      narration_en: 'Cash purchase above BDT 1,00,000 — s.46 disallows the input VAT rebate and the VAT is capitalised into inventory cost.',
      narration_bn: '১,০০,০০০ টাকার ঊর্ধ্বে নগদ ক্রয় — ধারা ৪৬ ইনপুট ভ্যাট রিবেট বাতিল করে, ভ্যাট মজুদ ব্যয়ে মূলধনায়িত।',
      mushak_serial: 'M63-SUP-2026-0418',
      cost_account_code: '1310',
      cost_account_name_en: 'Merchandise Inventory — Weighted Average',
      cost_account_name_bn: 'মজুদ পণ্য — ভারযুক্ত গড়',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-10' },
  );

  // Professional consultancy — stacked 15% VDS + 10% TDS
  ledger.postDoc(
    {
      doc_type: 'EXPENSE_VOUCHER',
      doc_number: 'PV-2026-09-0204',
      doc_date: '2026-09-12',
      due_date: '2026-09-27',
      party: partyById('PTY-RAHMANCA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-007', 'SVC-9983.11', 1, bdtToPoisha('280000.00'))],
      base_poisha: bdtToPoisha('280000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'PROFESSIONAL_OR_TECHNICAL_SERVICES',
      payment_method: 'BANK',
      vds_applicable: true,
      narration_en: 'Statutory audit and tax advisory fee — 15% VDS plus 10% TDS stacked on the base value, never on VAT.',
      narration_bn: 'বিধিবদ্ধ নিরীক্ষা ও কর পরামর্শ ফি — ভিত্তি মূল্যের ওপর ১৫% ভিডিএস ও ১০% টিডিএস, ভ্যাটের ওপর নয়।',
      mushak_serial: 'M63-SUP-2026-0424',
      cost_account_code: '5310',
      cost_account_name_en: 'Professional, Audit, Tax & Legal Consultancy Fees',
      cost_account_name_bn: 'পেশাদার, নিরীক্ষা, কর ও আইনি পরামর্শ ফি',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-20' },
  );

  // Missing e-TIN supplier — TDS upscaled by 50%
  ledger.postDoc(
    {
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-09-0126',
      doc_date: '2026-09-14',
      due_date: '2026-09-24',
      party: partyById('PTY-KARNAPHULI'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-005', 'HS-6302.60', 28, bdtToPoisha('21800.00')), docLine('ITM-004', 'HS-4820.10', 4, bdtToPoisha('4500.00'))],
      base_poisha: bdtToPoisha('628400.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
      narration_en: 'Supplier bill with no 12-digit e-TIN on file — the 3% TDS rate is upscaled by 50% to 4.5% under the Income Tax Act 2023.',
      narration_bn: 'সরবরাহকারীর ১২ অঙ্কের ই-টিআইএন নেই — আয়কর আইন ২০২৩ অনুযায়ী ৩% টিডিএস ৫০% বাড়িয়ে ৪.৫%।',
      mushak_serial: 'M63-SUP-2026-0431',
      cost_account_code: '1310',
      cost_account_name_en: 'Merchandise Inventory — Weighted Average',
      cost_account_name_bn: 'মজুদ পণ্য — ভারযুক্ত গড়',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-22' },
  );

  // Commercial office rent — 15% VDS + 5% TDS
  ledger.postDoc(
    {
      doc_type: 'EXPENSE_VOUCHER',
      doc_number: 'PV-2026-09-0210',
      doc_date: '2026-09-18',
      due_date: '2026-09-18',
      party: partyById('PTY-MOTIJHEEL'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-008', 'SVC-6810.10', 1, bdtToPoisha('320000.00'))],
      base_poisha: bdtToPoisha('320000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'COMMERCIAL_RENT',
      payment_method: 'BANK',
      vds_applicable: true,
      narration_en: 'Commercial office rent for September — 15% VDS withheld and 5% TDS deducted on the base rent.',
      narration_bn: 'সেপ্টেম্বরের বাণিজ্যিক অফিস ভাড়া — ভিত্তি ভাড়ার ওপর ১৫% ভিডিএস ও ৫% টিডিএস কর্তন।',
      mushak_serial: 'M63-SUP-2026-0436',
      cost_account_code: '5300',
      cost_account_name_en: 'Commercial Office & Warehouse Rent',
      cost_account_name_bn: 'বাণিজ্যিক অফিস ও গুদাম ভাড়া',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-09-18' },
  );

  // Imported digital services — 15% reverse-charge VAT with challan held
  ledger.postDoc(
    {
      doc_type: 'IMPORTED_SERVICE',
      doc_number: 'IMP-2026-09-0031',
      doc_date: '2026-09-20',
      due_date: '2026-09-21',
      party: partyById('PTY-META'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-009', 'SVC-7310.10', 1, bdtToPoisha('350000.00'))],
      base_poisha: bdtToPoisha('350000.00'),
      tax_category: 'REVERSE_CHARGE',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      reverse_charge: true,
      reverse_charge_challan_held: true,
      narration_en: 'Meta advertising services imported from Ireland — 15% reverse-charge VAT self-assessed under s.20 and creditable against the Treasury challan.',
      narration_bn: 'আয়ারল্যান্ড থেকে আমদানি করা মেটা বিজ্ঞাপন সেবা — ধারা ২০ অনুযায়ী ১৫% রিভার্স-চার্জ ভ্যাট স্ব-নির্ধারিত ও কোষাগার চালানে সমন্বয়যোগ্য।',
      cost_account_code: '5320',
      cost_account_name_en: 'Digital Marketing, Cloud & Imported SaaS (Meta/Google/AWS)',
      cost_account_name_bn: 'ডিজিটাল মার্কেটিং, ক্লাউড ও আমদানি স্যাস',
    },
    { date: '2026-09-21' },
  );

  // Reverse-charge VAT deposited by Treasury challan
  ledger.post({
    date: '2026-09-24',
    source: 'BANK_MFS',
    docRef: 'CH-RCVAT-2026-09',
    narration_en: 'Reverse-charge VAT on imported digital services deposited to the Treasury (economic code 1.1.04.01.02).',
    narration_bn: 'আমদানি ডিজিটাল সেবার রিভার্স-চার্জ ভ্যাট কোষাগারে জমা (অর্থনৈতিক কোড ১.১.০৪.০১.০২)।',
    lines: [
      ['2150', ledger.creditBalance('2150'), 0n, undefined, 'Reverse charge VAT settled', 'রিভার্স চার্জ ভ্যাট নিষ্পত্তি'],
      ['1110', 0n, ledger.creditBalance('2150'), undefined, 'Treasury challan', 'ট্রেজারি চালান'],
    ],
  });
  ledger.addChallan({
    type: 'VAT',
    period_code: '2026-09',
    amount_poisha: bdtToPoisha('52500.00'),
    economic_code: '1.1.04.01.02',
    deposit_date: '2026-09-24',
    status: 'CERTIFIED',
    journal_id: ledger.journals[ledger.journals.length - 1].id,
    certificate_numbers: [],
    narration: 'Reverse-charge VAT on imported digital services (s.20).',
  });

  // Cost of goods sold for the three September sales (72% weighted-average cost ratio)
  const cogsLines: SeedLineInput[] = [
    ['5100', costOf(COGS_RATIO_BPS, bdtToPoisha('2955000.00')), 0n, undefined, 'Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়'],
    ['5100', costOf(COGS_RATIO_BPS, bdtToPoisha('2616800.00')), 0n, undefined, 'Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়'],
    ['5100', costOf(COGS_RATIO_BPS, bdtToPoisha('547500.00')), 0n, undefined, 'Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়'],
    ['1310', 0n, costOf(COGS_RATIO_BPS, bdtToPoisha('2955000.00')) + costOf(COGS_RATIO_BPS, bdtToPoisha('2616800.00')) + costOf(COGS_RATIO_BPS, bdtToPoisha('547500.00')), undefined, 'Inventory issued to cost of sales', 'মজুদ বিক্রীত ব্যয়ে স্থানান্তর'],
  ];
  ledger.post({
    date: '2026-09-30',
    source: 'SALES',
    docRef: 'COGS-2026-09',
    narration_en: 'Weighted-average inventory issued to cost of sales for the three September invoices (72% cost ratio).',
    narration_bn: 'সেপ্টেম্বরের তিনটি চালানের জন্য ভারযুক্ত গড় মজুদ বিক্রীত ব্যয়ে স্থানান্তর (৭২% ব্যয় অনুপাত)।',
    lines: cogsLines,
  });

  // Payroll accrual + BEFTN settlement
  const septemberPayroll = ledger.postPayroll('2026-09-25', '2026-09', false);

  // PPE depreciation (straight line, monthly)
  ledger.post({
    date: '2026-09-30',
    source: 'IFRS_ADJUSTMENT',
    narration_en: 'Monthly straight-line depreciation on property, plant and equipment (BDT 1,88,000.00 per month).',
    narration_bn: 'সম্পত্তি ও যন্ত্রপাতির মাসিক সরলরৈখিক অবচয় (মাসে ১,৮৮,০০০.০০ টাকা)।',
    lines: [
      ['5400', '188000.00', 0n, undefined, 'Depreciation charge', 'অবচয় ব্যয়'],
      ['1619', 0n, '188000.00', undefined, 'Accumulated depreciation', 'সঞ্চিত অবচয়'],
    ],
  });

  // IFRS 16 — ROU depreciation + lease interest unwinding in the group adjustment book
  ledger.post({
    date: '2026-09-30',
    book: 'IFRS_GROUP_ADJ',
    source: 'IFRS_ADJUSTMENT',
    narration_en: 'IFRS 16 right-of-use depreciation and 105 bps monthly interest unwinding on the warehouse lease liability.',
    narration_bn: 'আইএফএআরএস ১৬ ব্যবহারের অধিকার অবচয় এবং গুদাম লিজ দায়ে মাসিক ১০৫ বেসিস পয়েন্ট সুদ।',
    lines: [
      ['5400', '164000.00', 0n, undefined, 'ROU depreciation (9,840,000 / 60 months)', 'আরওইউ অবচয়'],
      ['5810', applyRateBps(bdtToPoisha('8600000.00'), 105), 0n, undefined, 'Lease interest unwinding', 'লিজ সুদ ব্যয়'],
      ['1719', 0n, '164000.00', undefined, 'Accumulated ROU depreciation', 'সঞ্চিত আরওইউ অবচয়'],
      ['2510', 0n, applyRateBps(bdtToPoisha('8600000.00'), 105), undefined, 'Lease liability accretion', 'লিজ দায় বৃদ্ধি'],
    ],
  });

  // IFRS 9 ECL top-up
  ledger.postExpectedCreditLoss('2026-09-30', 75);

  // FDR interest income
  ledger.post({
    date: '2026-09-30',
    source: 'BANK_MFS',
    docRef: 'FDR-2026-09-0001',
    narration_en: 'Interest accrued on the short-term FDR at 7.50% for one month.',
    narration_bn: 'স্বল্পমেয়াদি এফডিআরে এক মাসের ৭.৫০% হারে অর্জিত সুদ।',
    lines: [
      ['1410', '41250.00', 0n, undefined, 'Interest accrued to the FDR', 'এফডিআরে অর্জিত সুদ'],
      ['4500', 0n, '41250.00', undefined, 'Investing income', 'বিনিয়োগ আয়'],
    ],
  });

  // Bank, MFS and settlement fees
  ledger.post({
    date: '2026-09-30',
    source: 'BANK_MFS',
    narration_en: 'Bank charges, excise duty and bKash/Nagad merchant settlement fees for September.',
    narration_bn: 'সেপ্টেম্বরের ব্যাংক চার্জ, আবগারি শুল্ক ও বিকাশ/নগদ মার্চেন্ট সেটেলমেন্ট ফি।',
    lines: [
      ['5820', '18650.00', 0n, undefined, 'Finance cost — bank and MFS fees', 'অর্থ ব্যয় — ব্যাংক ও এমএফএস ফি'],
      ['1110', 0n, '8650.00', undefined, 'City Bank charges', 'সিটি ব্যাংক চার্জ'],
      ['1120', 0n, '10000.00', undefined, 'bKash settlement fees', 'বিকাশ সেটেলমেন্ট ফি'],
    ],
  });

  // Current income tax provision
  ledger.post({
    date: '2026-09-30',
    source: 'MANUAL_JOURNAL',
    narration_en: 'Current income tax provision for September 2026 at the corporate rate on estimated taxable profit.',
    narration_bn: 'সেপ্টেম্বর ২০২৬-এর আনুমানিক করযোগ্য মুনাফার ওপর কর্পোরেট হারে চলতি আয়কর সঞ্চিতি।',
    lines: [
      ['5900', '120000.00', 0n, undefined, 'Tax expense', 'কর ব্যয়'],
      ['2180', 0n, '120000.00', undefined, 'Tax provision', 'কর সঞ্চিতি'],
    ],
  });

  // ---- 3. October 2026 — filings, trading and month end ------------------------------------

  // Sale 4 — standard 15%, settled in October
  ledger.postDoc(
    {
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-10-0001',
      doc_date: '2026-10-02',
      due_date: '2026-11-01',
      party: partyById('PTY-MEGHNA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-001', 'HS-8471.30', 40, bdtToPoisha('98500.00'))],
      base_poisha: bdtToPoisha('3940000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Local standard-rate sale to Meghna Distribution Ltd. — Mushak 6.3 issued and settled within the period.',
      narration_bn: 'মেঘনা ডিস্ট্রিবিউশন লিমিটেডের কাছে স্থানীয় আদর্শ হার বিক্রয় — মূসক ৬.৩ ইস্যু ও মেয়াদের মধ্যে নিষ্পত্তি।',
      mushak_serial: 'M63-2026-00004',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-20' },
  );

  // Sale 5 — corporate VDS buyer
  ledger.postDoc(
    {
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-10-0002',
      doc_date: '2026-10-05',
      due_date: '2026-11-19',
      party: partyById('PTY-BEXIMCO'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-005', 'HS-6302.60', 140, bdtToPoisha('21800.00'))],
      base_poisha: bdtToPoisha('3052000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Corporate contract sale to Beximco Trading Corporation — 15% VDS withheld by the buyer, Mushak 6.6 pending.',
      narration_bn: 'বেক্সিমকো ট্রেডিং কর্পোরেশনের কাছে কর্পোরেট বিক্রয় — ক্রেতা ১৫% ভিডিএস কর্তন, মূসক ৬.৬ অপেক্ষমাণ।',
      mushak_serial: 'M63-2026-00005',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-28' },
  );

  // Lease payment
  ledger.post({
    date: '2026-10-05',
    source: 'BANK_MFS',
    docRef: 'LEASE-2026-Q2-02',
    narration_en: 'Quarterly warehouse lease instalment paid to Motijheel Properties Ltd., reducing the IFRS 16 lease liability.',
    narration_bn: 'মতিঝিল প্রপার্টিজ লিমিটেডকে ত্রৈমাসিক গুদাম লিজ কিস্তি পরিশোধ, আইএফএআরএস ১৬ লিজ দায় হ্রাস।',
    lines: [
      ['2510', '271000.00', 0n, undefined, 'Lease liability reduced', 'লিজ দায় হ্রাস'],
      ['1110', 0n, '271000.00', undefined, 'Lease instalment paid', 'লিজ কিস্তি পরিশোধ'],
    ],
  });

  // Purchase — registered vendor
  ledger.postDoc(
    {
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-10-0142',
      doc_date: '2026-10-07',
      due_date: '2026-10-28',
      party: partyById('PTY-PADMA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-002', 'HS-8517.62', 30, bdtToPoisha('42500.00')), docLine('ITM-006', 'HS-8544.42', 70, bdtToPoisha('7250.00'))],
      base_poisha: bdtToPoisha('1782500.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
      narration_en: 'Inventory purchase from Padma Industrial Supplies — rebate-eligible input VAT and 3% TDS.',
      narration_bn: 'পদ্মা ইন্ডাস্ট্রিয়াল সাপ্লাইজ থেকে মজুদ ক্রয় — রিবেটযোগ্য ইনপুট ভ্যাট ও ৩% টিডিএস।',
      mushak_serial: 'M63-SUP-2026-0542',
      cost_account_code: '1310',
      cost_account_name_en: 'Merchandise Inventory — Weighted Average',
      cost_account_name_bn: 'মজুদ পণ্য — ভারযুক্ত গড়',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-10' },
  );

  // Purchase — supplier missing BIN → input VAT blocked
  ledger.postDoc(
    {
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-10-0148',
      doc_date: '2026-10-09',
      due_date: '2026-10-16',
      party: partyById('PTY-SYLHETAGRO'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-005', 'HS-6302.60', 22, bdtToPoisha('21800.00'))],
      base_poisha: bdtToPoisha('479600.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
      narration_en: 'Supplier bill with no 13-digit BIN — s.46 blocks the input VAT rebate and the VAT is capitalised into inventory.',
      narration_bn: 'সরবরাহকারীর ১৩ অঙ্কের বিআইএন নেই — ধারা ৪৬ ইনপুট ভ্যাট রিবেট বন্ধ করে, ভ্যাট মজুদে মূলধনায়িত।',
      mushak_serial: 'M63-SUP-2026-0548',
      cost_account_code: '1310',
      cost_account_name_en: 'Merchandise Inventory — Weighted Average',
      cost_account_name_bn: 'মজুদ পণ্য — ভারযুক্ত গড়',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-12' },
  );

  // Mushak 9.1 for September filed on 14 October 2026, plus the September VDS/TDS challans.
  // Amounts are cut off at the September period end so October activity is never swept in.
  ledger.fileVatReturn('2026-10-14', '2026-09', '2026-09-30');
  ledger.depositWithholding('VDS', '2026-10-14', '1.1.04.01.02', '2026-09', '2026-09-30');
  ledger.depositWithholding('TDS', '2026-10-14', '1.1.04.01.02', '2026-09', '2026-09-30');

  // Professional consultancy — October
  ledger.postDoc(
    {
      doc_type: 'EXPENSE_VOUCHER',
      doc_number: 'PV-2026-10-0231',
      doc_date: '2026-10-12',
      due_date: '2026-10-26',
      party: partyById('PTY-RAHMANCA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-007', 'SVC-9983.11', 1, bdtToPoisha('250000.00'))],
      base_poisha: bdtToPoisha('250000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'PROFESSIONAL_OR_TECHNICAL_SERVICES',
      payment_method: 'BANK',
      vds_applicable: true,
      narration_en: 'Quarterly tax advisory fee — 15% VDS and 10% TDS withheld on the base value.',
      narration_bn: 'ত্রৈমাসিক কর পরামর্শ ফি — ভিত্তি মূল্যের ওপর ১৫% ভিডিএস ও ১০% টিডিএস কর্তন।',
      mushak_serial: 'M63-SUP-2026-0561',
      cost_account_code: '5310',
      cost_account_name_en: 'Professional, Audit, Tax & Legal Consultancy Fees',
      cost_account_name_bn: 'পেশাদার, নিরীক্ষা, কর ও আইনি পরামর্শ ফি',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-26' },
  );

  // Rent — October
  ledger.postDoc(
    {
      doc_type: 'EXPENSE_VOUCHER',
      doc_number: 'PV-2026-10-0234',
      doc_date: '2026-10-15',
      due_date: '2026-10-15',
      party: partyById('PTY-MOTIJHEEL'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-008', 'SVC-6810.10', 1, bdtToPoisha('320000.00'))],
      base_poisha: bdtToPoisha('320000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'COMMERCIAL_RENT',
      payment_method: 'BANK',
      vds_applicable: true,
      narration_en: 'Commercial office rent for October — 15% VDS and 5% TDS withheld from the landlord payment.',
      narration_bn: 'অক্টোবরের বাণিজ্যিক অফিস ভাড়া — বাড়িওয়ালার পরিশোধ থেকে ১৫% ভিডিএস ও ৫% টিডিএস কর্তন।',
      mushak_serial: 'M63-SUP-2026-0564',
      cost_account_code: '5300',
      cost_account_name_en: 'Commercial Office & Warehouse Rent',
      cost_account_name_bn: 'বাণিজ্যিক অফিস ও গুদাম ভাড়া',
      tenant_is_withholding_entity: true,
    },
    { date: '2026-10-15' },
  );

  // Imported services — challan NOT held yet → conditional, VAT disallowed into cost
  ledger.postDoc(
    {
      doc_type: 'IMPORTED_SERVICE',
      doc_number: 'IMP-2026-10-0044',
      doc_date: '2026-10-18',
      due_date: '2026-10-19',
      party: partyById('PTY-META'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-009', 'SVC-7310.10', 1, bdtToPoisha('275000.00'))],
      base_poisha: bdtToPoisha('275000.00'),
      tax_category: 'REVERSE_CHARGE',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      reverse_charge: true,
      reverse_charge_challan_held: false,
      narration_en: 'Meta advertising services for October — 15% reverse-charge VAT self-assessed; the Treasury challan is not yet held so the credit stays conditional.',
      narration_bn: 'অক্টোবরের মেটা বিজ্ঞাপন সেবা — ১৫% রিভার্স-চার্জ ভ্যাট স্ব-নির্ধারিত; কোষাগার চালান এখনো নেই, তাই ক্রেডিট শর্তসাপেক্ষ।',
      cost_account_code: '5320',
      cost_account_name_en: 'Digital Marketing, Cloud & Imported SaaS (Meta/Google/AWS)',
      cost_account_name_bn: 'ডিজিটাল মার্কেটিং, ক্লাউড ও আমদানি স্যাস',
    },
    { date: '2026-10-19' },
  );

  ledger.post({
    date: '2026-10-26',
    source: 'BANK_MFS',
    docRef: 'CH-RCVAT-2026-10',
    narration_en: 'Reverse-charge VAT on October imported digital services deposited to the Treasury.',
    narration_bn: 'অক্টোবরের আমদানি ডিজিটাল সেবার রিভার্স-চার্জ ভ্যাট কোষাগারে জমা।',
    lines: [
      ['2150', ledger.creditBalance('2150'), 0n, undefined, 'Reverse charge VAT settled', 'রিভার্স চার্জ ভ্যাট নিষ্পত্তি'],
      ['1110', 0n, ledger.creditBalance('2150'), undefined, 'Treasury challan', 'ট্রেজারি চালান'],
    ],
  });

  // Cost of sales for October
  const octoberCogs =
    costOf(COGS_RATIO_BPS, bdtToPoisha('3940000.00')) + costOf(COGS_RATIO_BPS, bdtToPoisha('3052000.00'));
  ledger.post({
    date: '2026-10-28',
    source: 'SALES',
    docRef: 'COGS-2026-10',
    narration_en: 'Weighted-average inventory issued to cost of sales for the October invoices.',
    narration_bn: 'অক্টোবরের চালানগুলোর জন্য ভারযুক্ত গড় মজুদ বিক্রীত ব্যয়ে স্থানান্তর।',
    lines: [
      ['5100', octoberCogs, 0n, undefined, 'Cost of goods sold', 'বিক্রীত পণ্যের ব্যয়'],
      ['1310', 0n, octoberCogs, undefined, 'Inventory issued', 'মজুদ স্থানান্তর'],
    ],
  });

  // Mushak 6.7 credit note (sales return) — routed through the tax engine so every amount,
  // including the reversed output VAT, is engine-derived.
  ledger.postDoc(
    {
      doc_type: 'CREDIT_NOTE',
      doc_number: 'CN-2026-10-0001',
      doc_date: '2026-10-28',
      due_date: '2026-10-28',
      party: partyById('PTY-MEGHNA'),
      bin_unit_id: 'BU-DHK',
      lines: [docLine('ITM-002', 'HS-8517.62', 4, bdtToPoisha('42500.00'))],
      base_poisha: bdtToPoisha('170000.00'),
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Mushak 6.7 credit note for damaged goods returned by Meghna Distribution Ltd. — output VAT reversed at 15% and the receivable reduced.',
      narration_bn: 'মেঘনা ডিস্ট্রিবিউশন লিমিটেডের ক্ষতিগ্রস্ত পণ্য ফেরতের মূসক ৬.৭ ক্রেডিট নোট — ১৫% হারে আউটপুট ভ্যাট বাতিল ও প্রাপ্য হ্রাস।',
      original_doc_id: 'DOC-INV-2026-10-0001',
      original_doc_number: 'INV-2026-10-0001',
      revenue_account_code: '4200',
      revenue_account_name_en: 'Sales Returns & Credit Note Adjustments (Mushak 6.7)',
      revenue_account_name_bn: 'বিক্রয় ফেরত ও ক্রেডিট নোট সমন্বয় (মূসক ৬.৭)',
      tenant_is_withholding_entity: true,
    },
    null,
  );
  ledger.post({
    date: '2026-10-28',
    source: 'SALES',
    docRef: 'CN-2026-10-0001',
    narration_en: 'Inventory restored for the Mushak 6.7 sales return at the weighted-average cost ratio.',
    narration_bn: 'মূসক ৬.৭ বিক্রয় ফেরতের জন্য ভারযুক্ত গড় ব্যয় অনুপাতে মজুদ পুনঃস্থাপন।',
    lines: [
      ['1310', costOf(COGS_RATIO_BPS, bdtToPoisha('170000.00')), 0n, undefined, 'Inventory restored', 'মজুদ পুনঃস্থাপন'],
      ['5100', 0n, costOf(COGS_RATIO_BPS, bdtToPoisha('170000.00')), undefined, 'Cost of sales reversed', 'বিক্রীত ব্যয় বাতিল'],
    ],
  });

  // October payroll with festival bonus (accrued, paid in November)
  const octoberPayroll = ledger.postPayroll('2026-10-29', '2026-10', true);

  // Unidentified bank credit → suspense queue
  ledger.post({
    date: '2026-10-30',
    source: 'BANK_MFS',
    docRef: 'BNK-UNIDENT-2026-10-31',
    narration_en: 'Unidentified credit in the City Bank current account pending counterparty confirmation — parked in 2190 Suspense.',
    narration_bn: 'সিটি ব্যাংক চলতি হিসাবে অজ্ঞাত জমা, প্রতিপক্ষের নিশ্চিতকরণ অপেক্ষমাণ — ২১৯০ সাসপেন্সে রাখা হয়েছে।',
    lines: [
      ['1110', '285000.00', 0n, undefined, 'Unidentified bank credit', 'অজ্ঞাত ব্যাংক জমা'],
      ['2190', 0n, '285000.00', undefined, 'Suspense clearing', 'সাসপেন্স নিষ্পত্তি'],
    ],
  });

  // October month-end: depreciation, IFRS 16, ECL, FDR interest, fees, tax
  ledger.post({
    date: '2026-10-31',
    source: 'IFRS_ADJUSTMENT',
    narration_en: 'Monthly straight-line depreciation on property, plant and equipment.',
    narration_bn: 'সম্পত্তি ও যন্ত্রপাতির মাসিক সরলরৈখিক অবচয়।',
    lines: [
      ['5400', '188000.00', 0n, undefined, 'Depreciation charge', 'অবচয় ব্যয়'],
      ['1619', 0n, '188000.00', undefined, 'Accumulated depreciation', 'সঞ্চিত অবচয়'],
    ],
  });

  ledger.post({
    date: '2026-10-31',
    book: 'IFRS_GROUP_ADJ',
    source: 'IFRS_ADJUSTMENT',
    narration_en: 'IFRS 16 right-of-use depreciation and lease interest unwinding for October.',
    narration_bn: 'অক্টোবরের আইএফএআরএস ১৬ ব্যবহারের অধিকার অবচয় ও লিজ সুদ ব্যয়।',
    lines: [
      ['5400', '164000.00', 0n, undefined, 'ROU depreciation', 'আরওইউ অবচয়'],
      ['5810', '90300.00', 0n, undefined, 'Lease interest unwinding', 'লিজ সুদ ব্যয়'],
      ['1719', 0n, '164000.00', undefined, 'Accumulated ROU depreciation', 'সঞ্চিত আরওইউ অবচয়'],
      ['2510', 0n, '90300.00', undefined, 'Lease liability accretion', 'লিজ দায় বৃদ্ধি'],
    ],
  });

  ledger.postExpectedCreditLoss('2026-10-31', 75);

  ledger.post({
    date: '2026-10-31',
    source: 'BANK_MFS',
    docRef: 'FDR-2026-09-0001',
    narration_en: 'Interest accrued on the short-term FDR for October.',
    narration_bn: 'অক্টোবরের জন্য স্বল্পমেয়াদি এফডিআরে অর্জিত সুদ।',
    lines: [
      ['1410', '41250.00', 0n, undefined, 'Interest accrued to the FDR', 'এফডিআরে অর্জিত সুদ'],
      ['4500', 0n, '41250.00', undefined, 'Investing income', 'বিনিয়োগ আয়'],
    ],
  });

  ledger.post({
    date: '2026-10-31',
    source: 'BANK_MFS',
    narration_en: 'Bank charges, excise duty and MFS settlement fees for October.',
    narration_bn: 'অক্টোবরের ব্যাংক চার্জ, আবগারি শুল্ক ও এমএফএস সেটেলমেন্ট ফি।',
    lines: [
      ['5820', '16850.00', 0n, undefined, 'Finance cost — bank and MFS fees', 'অর্থ ব্যয় — ব্যাংক ও এমএফএস ফি'],
      ['1110', 0n, '9850.00', undefined, 'City Bank charges', 'সিটি ব্যাংক চার্জ'],
      ['1120', 0n, '7000.00', undefined, 'bKash settlement fees', 'বিকাশ সেটেলমেন্ট ফি'],
    ],
  });

  ledger.post({
    date: '2026-10-31',
    source: 'MANUAL_JOURNAL',
    narration_en: 'Current income tax provision for October 2026.',
    narration_bn: 'অক্টোবর ২০২৬-এর চলতি আয়কর সঞ্চিতি।',
    lines: [
      ['5900', '260000.00', 0n, undefined, 'Tax expense', 'কর ব্যয়'],
      ['2180', 0n, '260000.00', undefined, 'Tax provision', 'কর সঞ্চিতি'],
    ],
  });

  // Deferred tax overlay in the tax computation book
  ledger.post({
    date: '2026-10-31',
    book: 'TAX_COMPUTATION',
    source: 'IFRS_ADJUSTMENT',
    narration_en: 'Deferred tax asset recognised on the IFRS 16 lease liability and the ECL allowance (IAS 12 tax computation overlay).',
    narration_bn: 'আইএফএআরএস ১৬ লিজ দায় ও ইসিএল ভাতার ওপর বিলম্বিত কর সম্পদ স্বীকৃতি (আইএএস ১২ কর গণনা স্তর)।',
    lines: [
      ['1810', '110000.00', 0n, undefined, 'Deferred tax asset', 'বিলম্বিত কর সম্পদ'],
      ['5900', 0n, '110000.00', undefined, 'Deferred tax credit', 'বিলম্বিত কর ক্রেডিট'],
    ],
  });

  // Pending November challans for the October withholding
  const octoberVds = ledger.creditBalance('2130');
  const octoberTds = ledger.creditBalance('2140');
  if (octoberVds > 0n) {
    ledger.addChallan({
      type: 'VDS',
      period_code: '2026-10',
      amount_poisha: octoberVds,
      economic_code: '1.1.04.01.02',
      status: 'PENDING',
      certificate_numbers: [],
      narration: 'October VDS withheld — deposit due by 15 November 2026.',
    });
  }
  if (octoberTds > 0n) {
    ledger.addChallan({
      type: 'TDS',
      period_code: '2026-11',
      amount_poisha: octoberTds,
      economic_code: '1.1.04.01.02',
      status: 'PENDING',
      certificate_numbers: [],
      narration: 'October TDS withheld — deposit due by 15 November 2026.',
    });
  }

  // ---- 4. VDS certificates (Mushak 6.6) ----------------------------------------------------
  const vdsCertificates: VdsCertificate[] = [];
  let certificateSequence = 0;
  for (const doc of ledger.documents) {
    if (doc.vds_poisha === 0n) continue;
    certificateSequence += 1;
    const isSale = doc.doc_type === 'SALES_INVOICE';
    vdsCertificates.push({
      id: `VDS-${String(certificateSequence).padStart(3, '0')}`,
      certificate_number: `6.6/2026/${String(certificateSequence).padStart(4, '0')}`,
      direction: isSale ? 'RECEIVED' : 'ISSUED',
      party_id: doc.party_id,
      party_name_en: doc.party_name_en,
      party_name_bn: doc.party_name_bn,
      party_bin: doc.party_bin,
      amount_poisha: doc.base_poisha,
      vds_poisha: doc.vds_poisha,
      certificate_date: doc.doc_date,
      status: isSale ? 'PENDING' : 'VERIFIED',
      related_doc_ref: doc.doc_number,
      challan_id: isSale ? undefined : ledger.challans.find((challan) => challan.type === 'VDS')?.id,
    });
  }

  // ---- 5. Bank statement lines derived from the immutable ledger ---------------------------
  const statementLines: BankStatementLine[] = [];
  let statementSequence = 0;
  for (const journal of ledger.journals) {
    if (journal.reversal_of_journal_id) continue;
    for (const line of journal.lines) {
      const bank = BANK_ACCOUNTS.find((entry) => entry.account_code === line.account_code);
      if (!bank) continue;
      statementSequence += 1;
      statementLines.push({
        id: `STL-${String(statementSequence).padStart(4, '0')}`,
        account_code: line.account_code,
        date: journal.posting_date,
        description: journal.narration_en,
        reference: journal.journal_number,
        debit_poisha: line.debit_poisha,
        credit_poisha: line.credit_poisha,
        // The demo statement is synthetic evidence, not a reconciliation result. Even though these
        // rows were derived from the seed ledger, the demo must still match them explicitly.
        status: 'UNMATCHED',
        matched_doc_ref: undefined,
        fee_poisha: 0n,
        journal_id: undefined,
      });
    }
  }
  // Two genuinely unmatched statement items so the banking workspace has real work to do
  statementLines.push(
    {
      id: `STL-${String(statementSequence + 1).padStart(4, '0')}`,
      account_code: '1110',
      date: '2026-10-30',
      description: 'City Bank SMS alert charge not yet booked',
      reference: 'CBL-SMS-OCT',
      debit_poisha: 0n,
      credit_poisha: bdtToPoisha('1250.00'),
      status: 'UNMATCHED',
      fee_poisha: bdtToPoisha('1250.00'),
    },
    {
      id: `STL-${String(statementSequence + 2).padStart(4, '0')}`,
      account_code: '1120',
      date: '2026-10-31',
      description: 'bKash settlement batch in transit',
      reference: 'BKASH-BATCH-3110',
      debit_poisha: bdtToPoisha('38500.00'),
      credit_poisha: 0n,
      status: 'UNMATCHED',
      fee_poisha: 0n,
    },
  );

  const payrollRows = [...septemberPayroll.rows, ...octoberPayroll.rows];

  return {
    tenant,
    accounts: ACCOUNTS,
    parties: PARTIES,
    items: ITEMS,
    bankAccounts: BANK_ACCOUNTS,
    periods: ACCOUNTING_PERIODS,
    journals: ledger.journals,
    commercialDocs: ledger.documents,
    challans: ledger.challans,
    statementLines,
    vdsCertificates,
    payrollRows,
    statutoryRecords: STATUTORY_NOTICES_AND_LICENCES,
    notices: NOTICES,
    licences: LICENCES,
    employees: EMPLOYEES,
    meta: {
      generated_at: isoNow(),
      journal_count: ledger.journals.length,
      document_count: ledger.documents.length,
      current_period: CURRENT_PERIOD,
      comparative_period: COMPARATIVE_PERIOD,
      opening_journal: OPENING_JOURNAL_NUMBER,
      seed_version: 'lv-2026.2',
    },
  };
}

let cachedDataset: SeedDataset | null = null;

/** Memoised seed dataset — rebuilt only when the persona changes. */
export function getSeedDataset(personaKey: TenantEntity['persona_key'] = 'APEX'): SeedDataset {
  if (!cachedDataset || cachedDataset.tenant.persona_key !== personaKey) {
    cachedDataset = createSeedDataset(personaKey);
  }
  return cachedDataset;
}
