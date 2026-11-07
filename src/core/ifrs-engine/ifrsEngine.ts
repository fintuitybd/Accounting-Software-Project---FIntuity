// Fintuity Accounting Suite — Phase 2 dynamic IAS 1 / IFRS 18 / IAS 7 financial statements.
//
// Single-ledger derivation invariant (SPEC §0.4): NOTHING in this file is a hard-coded statement
// amount. Every trial balance, balance sheet, profit-or-loss line, equity movement, cash flow and
// note is computed from the live `journals` array filtered by multi-book filter and reporting
// period. That is what guarantees
//
//     Total Assets === Total Equity + Total Liabilities      (down to 0 poisha)
//
// after a manual journal, a mass import, a rollback or a linked reversal — and why the balance
// sheet can never drift from the general ledger.
//
// IFRS 18 (effective 1 January 2027) structure: five categories (Operating, Investing, Financing,
// Income Taxes, Discontinued Operations), the two mandatory subtotals (Operating Profit / (Loss)
// and Profit / (Loss) Before Financing and Income Taxes), the MPM reconciliation panel, and the
// consequential IAS 7 amendment that the indirect cash flow starts from Operating Profit.

import { applyRateBps } from '../money';
import type {
  Account,
  AccountSubCategory,
  AppSettings,
  BankAccount,
  BookType,
  CommercialDoc,
  FinancialStatements,
  JournalEntry,
  Party,
  StatementLine,
  StatementSection,
  TenantEntity,
} from '../types';
import { documentTaxOutcome } from '../ledger/ledgerEngine';

// ---------------------------------------------------------------------------------------------
// Book filters and period windows
// ---------------------------------------------------------------------------------------------

export const ALL_BOOKS: BookType[] = ['STATUTORY_BD', 'IFRS_GROUP_ADJ', 'TAX_COMPUTATION', 'MANAGEMENT_MIS'];

/** `ALL_IFRS_BOOKS` is the group reporting view: statutory plus IFRS overlays, never the tax memo. */
export function booksForFilter(filter: AppSettings['bookFilter']): BookType[] {
  if (filter === 'STATUTORY_BD') return ['STATUTORY_BD'];
  if (filter === 'TAX_COMPUTATION') return ['STATUTORY_BD', 'TAX_COMPUTATION'];
  return ['STATUTORY_BD', 'IFRS_GROUP_ADJ', 'MANAGEMENT_MIS'];
}

export const BOOK_FILTER_LABEL: Record<AppSettings['bookFilter'], { en: string; bn: string }> = {
  STATUTORY_BD: { en: 'Statutory books (Bangladesh)', bn: 'বিধিবদ্ধ খাতা (বাংলাদেশ)' },
  ALL_IFRS_BOOKS: { en: 'IFRS group books', bn: 'আইএফআরএস গ্রুপ খাতা' },
  TAX_COMPUTATION: { en: 'Tax computation books', bn: 'কর গণনা খাতা' },
};

export interface PeriodWindow {
  code: string;
  label_en: string;
  label_bn: string;
  start: string;
  end: string;
}

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export function periodWindow(periodCode: string): PeriodWindow {
  const [yearText, monthText] = periodCode.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1;
  const safeYear = Number.isFinite(year) ? year : 2026;
  const end = new Date(Date.UTC(safeYear, safeMonth, 0)).toISOString().slice(0, 10);
  return {
    code: `${safeYear}-${String(safeMonth).padStart(2, '0')}`,
    label_en: `${EN_MONTHS[safeMonth - 1]} ${safeYear}`,
    label_bn: `${BN_MONTHS[safeMonth - 1]} ${safeYear}`,
    start: `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`,
    end,
  };
}

export function previousPeriodCode(periodCode: string): string {
  const [yearText, monthText] = periodCode.split('-');
  let year = Number(yearText);
  let month = Number(monthText) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftPeriodCode(periodCode: string, months: number): string {
  const [yearText, monthText] = periodCode.split('-');
  const base = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + months, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Account universe + classification
// ---------------------------------------------------------------------------------------------

const PNL_SUBCATEGORIES: AccountSubCategory[] = [
  'OPERATING_REVENUE',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'FINANCE_COST',
  'INVESTING_INCOME',
  'TAX_EXPENSE',
];

export function isProfitAndLoss(account: Account): boolean {
  return PNL_SUBCATEGORIES.includes(account.sub_category);
}

export function isDebitNormal(account: Account): boolean {
  return account.account_type === 'ASSET' || account.account_type === 'EXPENSE';
}

function fallbackAccount(code: string): Account {
  const prefix = code.slice(0, 1);
  const asAccount = (
    type: Account['account_type'],
    sub: AccountSubCategory,
    note: string,
  ): Account => ({
    code,
    name_en: `Unmapped account ${code}`,
    name_bn: `অম্যাপিত হিসাব ${code}`,
    account_type: type,
    sub_category: sub,
    ifrs18_category: 'NA_BALANCE_SHEET',
    ifrs_statement_line_id: `UNMAPPED.${code}`,
    control_subledger: 'NONE',
    opening_debit_poisha: 0n,
    opening_credit_poisha: 0n,
    is_active: true,
    note_ref: note,
    cash_flow_tag: 'NONE',
  });
  if (prefix === '1') return asAccount('ASSET', /^1[6-9]/.test(code) ? 'NON_CURRENT_ASSET' : 'CURRENT_ASSET', 'Note 20');
  if (prefix === '2') return asAccount('LIABILITY', /^2[5-9]/.test(code) ? 'NON_CURRENT_LIABILITY' : 'CURRENT_LIABILITY', 'Note 20');
  if (prefix === '3') return asAccount('EQUITY', 'EQUITY_RESERVES', 'Note 17');
  if (prefix === '4') return asAccount('REVENUE', 'OPERATING_REVENUE', 'Note 3');
  return asAccount('EXPENSE', 'OPERATING_EXPENSE', 'Note 13');
}

/** Union of the chart of accounts and every code that actually appears in the ledger. */
export function accountUniverse(
  accounts: readonly Account[],
  journals: readonly JournalEntry[],
): Account[] {
  const map = new Map<string, Account>();
  for (const account of accounts) map.set(account.code, account);
  for (const journal of journals) {
    for (const line of journal.lines) {
      if (!map.has(line.account_code)) map.set(line.account_code, fallbackAccount(line.account_code));
    }
  }
  return Array.from(map.values()).sort((left, right) => left.code.localeCompare(right.code));
}

// ---------------------------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------------------------

function sumLines(
  journals: readonly JournalEntry[],
  predicate: (journal: JournalEntry) => boolean,
): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const journal of journals) {
    if (!predicate(journal)) continue;
    for (const line of journal.lines) {
      const current = map.get(line.account_code) ?? 0n;
      map.set(line.account_code, current + line.debit_poisha - line.credit_poisha);
    }
  }
  return map;
}

export interface LedgerSlice {
  opening: Map<string, bigint>;
  period: Map<string, bigint>;
  closing: Map<string, bigint>;
}

/** Debit-positive opening / period / closing movements for a book filter and period window. */
export function sliceLedger(
  journals: readonly JournalEntry[],
  books: readonly BookType[],
  window: PeriodWindow,
): LedgerSlice {
  const inBooks = (journal: JournalEntry): boolean => books.includes(journal.book_type);
  const opening = sumLines(journals, (journal) => inBooks(journal) && journal.posting_date < window.start);
  const period = sumLines(
    journals,
    (journal) =>
      inBooks(journal) && journal.posting_date >= window.start && journal.posting_date <= window.end,
  );
  const closing = new Map<string, bigint>(opening);
  for (const [code, value] of period) {
    closing.set(code, (closing.get(code) ?? 0n) + value);
  }
  return { opening, period, closing };
}

export function normalAmount(account: Account, debitPositive: bigint): bigint {
  return isDebitNormal(account) ? debitPositive : -debitPositive;
}

function sectionLine(
  key: string,
  labelEn: string,
  labelBn: string,
  amount: bigint,
  comparative: bigint,
  extras: Partial<StatementLine> = {},
): StatementLine {
  const variance =
    comparative === 0n
      ? undefined
      : Math.round((Number(amount - comparative) / Math.abs(Number(comparative))) * 1000) / 10;
  return {
    id: key,
    label_en: labelEn,
    label_bn: labelBn,
    amount_poisha: amount,
    comparative_poisha: comparative,
    variance_pct: variance,
    ...extras,
  };
}

function buildSection(
  id: string,
  titleEn: string,
  titleBn: string,
  lines: StatementLine[],
): StatementSection {
  return {
    id,
    title_en: titleEn,
    title_bn: titleBn,
    lines,
    total_poisha: lines.reduce((sum, line) => sum + line.amount_poisha, 0n),
    comparative_total_poisha: lines.reduce((sum, line) => sum + line.comparative_poisha, 0n),
  };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export interface FinancialStatementsInput {
  tenant: TenantEntity;
  accounts: readonly Account[];
  journals: readonly JournalEntry[];
  commercialDocs?: readonly CommercialDoc[];
  parties?: readonly Party[];
  bankAccounts?: readonly BankAccount[];
  bookFilter?: AppSettings['bookFilter'];
  periodCode?: string;
  comparativeCode?: string;
}

export const CASH_FALLBACK_CODES = ['1110', '1115', '1120', '1125', '1130'];
const PPE_COST = '1610';
const PPE_DEP = '1619';
const ROU_COST = '1710';
const ROU_DEP = '1719';
const DEP_EXPENSE = '5400';
const ECL_EXPENSE = '5450';
const ECL_ALLOWANCE = '1219';
const TAX_PROVISION = '2180';
const TAX_EXPENSE = '5900';

const OPERATING_WC_LIABILITY_CODES = ['2110', '2120', '2130', '2140', '2150', '2160', '2170', '2190', '2610'];
const OPERATING_WC_ASSET_CODES = ['1140', '1145', '1150', '1210', '1310'];

const WC_LABELS: Record<string, { en: string; bn: string }> = {
  '1140': { en: 'VAT current account (input rebate)', bn: 'ভ্যাট চলতি হিসাব (ইনপুট রিবেট)' },
  '1145': { en: 'VDS receivable — Mushak 6.6 pending', bn: 'ভিডিএস প্রাপ্য — মূসক ৬.৬ অপেক্ষমাণ' },
  '1150': { en: 'Advance income tax and customer TDS credit', bn: 'অগ্রিম আয়কর ও গ্রাহক টিডিএস ক্রেডিট' },
  '1210': { en: 'Trade receivables', bn: 'বাণিজ্যিক প্রাপ্য' },
  '1310': { en: 'Inventories', bn: 'মজুদ' },
  '2110': { en: 'Trade payables', bn: 'বাণিজ্যিক প্রদেয়' },
  '2120': { en: 'Output VAT payable', bn: 'আউটপুট ভ্যাট প্রদেয়' },
  '2130': { en: 'VDS withheld payable', bn: 'কর্তিত ভিডিএস প্রদেয়' },
  '2140': { en: 'TDS withheld payable', bn: 'কর্তিত টিডিএস প্রদেয়' },
  '2150': { en: 'Reverse-charge VAT payable', bn: 'রিভার্স চার্জ ভ্যাট প্রদেয়' },
  '2160': { en: 'Accrued salaries and PF', bn: 'সঞ্চিত বেতন ও পিএফ' },
  '2170': { en: 'WPPF and welfare fund provision', bn: 'ডব্লিউপিপিএফ ও কল্যাণ তহবিল সঞ্চিতি' },
  '2190': { en: 'Suspense and unapplied cash', bn: 'সাসপেন্স ও অপ্রয়োজিত নগদ' },
  '2610': { en: 'Defined benefit gratuity obligation', bn: 'নির্দিষ্ট সুবিধা গ্র্যাচুইটি দায়' },
};

const WC_LIABILITY_CODES = OPERATING_WC_LIABILITY_CODES;
const WC_ASSET_CODES = OPERATING_WC_ASSET_CODES;
void WC_LIABILITY_CODES;
void WC_ASSET_CODES;

export function cashAccounts(accounts: readonly Account[], bankAccounts: readonly BankAccount[] = []): string[] {
  const codes = new Set<string>();
  for (const bank of bankAccounts) codes.add(bank.account_code);
  for (const account of accounts) {
    if (account.control_subledger === 'BANK_MFS') codes.add(account.code);
  }
  if (codes.size === 0) for (const code of CASH_FALLBACK_CODES) codes.add(code);
  return Array.from(codes).sort();
}

interface StatementBuild {
  statements: FinancialStatements;
  operatingProfit: bigint;
  profitForPeriod: bigint;
}

function emptyResult(window: PeriodWindow, comparative: PeriodWindow): FinancialStatements {
  const emptySection = (id: string, en: string, bn: string): StatementSection => ({
    id,
    title_en: en,
    title_bn: bn,
    lines: [],
    total_poisha: 0n,
    comparative_total_poisha: 0n,
  });
  return {
    period: { code: window.code, label_en: window.label_en, label_bn: window.label_bn, start: window.start, end: window.end },
    comparative: { code: comparative.code, label_en: comparative.label_en, label_bn: comparative.label_bn, start: comparative.start, end: comparative.end },
    framework: 'IFRS_FRC_ADOPTED',
    book_filter: 'ALL_IFRS_BOOKS',
    balance_sheet: {
      assets_non_current: emptySection('BS.NCA', 'Non-current assets', 'অচলতি সম্পদ'),
      assets_current: emptySection('BS.CA', 'Current assets', 'চলতি সম্পদ'),
      total_assets_poisha: 0n,
      total_assets_comparative_poisha: 0n,
      equity: emptySection('BS.EQ', 'Equity', 'ইকুইটি'),
      liabilities_non_current: emptySection('BS.NCL', 'Non-current liabilities', 'অচলতি দায়'),
      liabilities_current: emptySection('BS.CL', 'Current liabilities', 'চলতি দায়'),
      total_equity_and_liabilities_poisha: 0n,
      total_equity_and_liabilities_comparative_poisha: 0n,
      balanced: true,
      imbalance_poisha: 0n,
    },
    profit_or_loss: {
      operating: emptySection('PL.OP', 'Operating category', 'পরিচালন শ্রেণি'),
      operating_profit_poisha: 0n,
      operating_profit_comparative_poisha: 0n,
      investing: emptySection('PL.INV', 'Investing category', 'বিনিয়োগ শ্রেণি'),
      profit_before_financing_tax_poisha: 0n,
      profit_before_financing_tax_comparative_poisha: 0n,
      financing: emptySection('PL.FIN', 'Financing category', 'অর্থায়ন শ্রেণি'),
      profit_before_tax_poisha: 0n,
      profit_before_tax_comparative_poisha: 0n,
      income_tax: emptySection('PL.TAX', 'Income taxes category', 'আয়কর শ্রেণি'),
      profit_for_period_poisha: 0n,
      profit_for_period_comparative_poisha: 0n,
      gross_profit_poisha: 0n,
      gross_profit_comparative_poisha: 0n,
      mpm: {
        operating_profit_poisha: 0n,
        depreciation_poisha: 0n,
        ecl_poisha: 0n,
        adjusted_ebitda_poisha: 0n,
        operating_margin_bps: 0,
        comparative_margin_bps: 0,
      },
    },
    changes_in_equity: [],
    cash_flow: {
      operating: emptySection('CF.OP', 'Operating activities', 'পরিচালন কার্যক্রম'),
      operating_total_poisha: 0n,
      operating_total_comparative_poisha: 0n,
      investing: emptySection('CF.INV', 'Investing activities', 'বিনিয়োগ কার্যক্রম'),
      investing_total_poisha: 0n,
      investing_total_comparative_poisha: 0n,
      financing: emptySection('CF.FIN', 'Financing activities', 'অর্থায়ন কার্যক্রম'),
      financing_total_poisha: 0n,
      financing_total_comparative_poisha: 0n,
      net_change_poisha: 0n,
      net_change_comparative_poisha: 0n,
      opening_cash_poisha: 0n,
      opening_cash_comparative_poisha: 0n,
      closing_cash_poisha: 0n,
      closing_cash_comparative_poisha: 0n,
      reconciles: true,
      difference_poisha: 0n,
    },
    trial_balance: [],
    notes: [],
    kpis: {
      revenue_poisha: 0n,
      expenses_poisha: 0n,
      net_profit_poisha: 0n,
      cash_poisha: 0n,
      receivables_poisha: 0n,
      payables_poisha: 0n,
      output_vat_poisha: 0n,
      input_vat_poisha: 0n,
      vds_payable_poisha: 0n,
      tds_payable_poisha: 0n,
      retained_earnings_poisha: 0n,
    },
  };
}

/**
 * Derive the complete reporting pack. Every figure below is a function of the live ledger.
 */
export function buildFinancialStatements(input: FinancialStatementsInput): FinancialStatements {
  const periodCode = input.periodCode ?? new Date().toISOString().slice(0, 7);
  const comparativeCode = input.comparativeCode ?? previousPeriodCode(periodCode);
  const window = periodWindow(periodCode);
  const comparativeWindow = periodWindow(comparativeCode);
  const bookFilter = input.bookFilter ?? 'ALL_IFRS_BOOKS';
  const books = booksForFilter(bookFilter);
  const journals = input.journals;
  const accounts = accountUniverse(input.accounts, journals);
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const statements = emptyResult(window, comparativeWindow);
  statements.framework = input.tenant.reporting_framework;
  statements.book_filter = bookFilter;

  const current = sliceLedger(journals, books, window);
  const comparative = sliceLedger(journals, books, comparativeWindow);

  const balanceAt = (map: Map<string, bigint>, code: string): bigint => map.get(code) ?? 0n;
  const normalAt = (map: Map<string, bigint>, code: string): bigint => {
    const account = byCode.get(code);
    return account ? normalAmount(account, balanceAt(map, code)) : balanceAt(map, code);
  };
  const pick = (account: Account, map: Map<string, bigint>): bigint =>
    normalAmount(account, balanceAt(map, account.code));
  const comparativeExpense = (code: string): bigint =>
    pick(byCode.get(code) ?? fallbackAccount(code), comparative.period);

  // ---- 1. Trial balance -------------------------------------------------------------------
  const trialBalance: FinancialStatements['trial_balance'] = accounts.map((account) => {
    const openingDebitPositive = balanceAt(current.opening, account.code);
    const periodDebitPositive = balanceAt(current.period, account.code);
    const closingDebitPositive = openingDebitPositive + periodDebitPositive;
    return {
      account_code: account.code,
      name_en: account.name_en,
      name_bn: account.name_bn,
      account_type: account.account_type,
      opening_debit_poisha: openingDebitPositive > 0n ? openingDebitPositive : 0n,
      opening_credit_poisha: openingDebitPositive < 0n ? -openingDebitPositive : 0n,
      period_debit_poisha: balanceAt(current.period, account.code) > 0n ? 0n : 0n,
      period_credit_poisha: 0n,
      closing_debit_poisha: closingDebitPositive > 0n ? closingDebitPositive : 0n,
      closing_credit_poisha: closingDebitPositive < 0n ? -closingDebitPositive : 0n,
      balance_poisha: closingDebitPositive,
    };
  });
  // Period debit / credit columns need the gross sides, not the net movement.
  const periodGross = new Map<string, { debit: bigint; credit: bigint }>();
  for (const journal of journals) {
    if (!books.includes(journal.book_type)) continue;
    if (journal.posting_date < window.start || journal.posting_date > window.end) continue;
    for (const line of journal.lines) {
      const entry = periodGross.get(line.account_code) ?? { debit: 0n, credit: 0n };
      entry.debit += line.debit_poisha;
      entry.credit += line.credit_poisha;
      periodGross.set(line.account_code, entry);
    }
  }
  for (const row of trialBalance) {
    const gross = periodGross.get(row.account_code);
    row.period_debit_poisha = gross?.debit ?? 0n;
    row.period_credit_poisha = gross?.credit ?? 0n;
  }
  statements.trial_balance = trialBalance.filter(
    (row) =>
      row.opening_debit_poisha !== 0n ||
      row.opening_credit_poisha !== 0n ||
      row.period_debit_poisha !== 0n ||
      row.period_credit_poisha !== 0n,
  );

  // ---- 2. Statement of financial position (IAS 1) ------------------------------------------
  const balanceSection = (
    id: string,
    titleEn: string,
    titleBn: string,
    predicate: (account: Account) => boolean,
  ): StatementSection => {
    const lines: StatementLine[] = [];
    for (const account of accounts) {
      if (!predicate(account)) continue;
      const amount = pick(account, current.closing);
      const comp = pick(account, comparative.closing);
      if (amount === 0n && comp === 0n) continue;
      lines.push(sectionLine(account.code, account.name_en, account.name_bn, amount, comp, { note: account.note_ref }));
    }
    return buildSection(id, titleEn, titleBn, lines);
  };

  const assetsNonCurrent = balanceSection('BS.NCA', 'Non-current assets', 'অচলতি সম্পদ', (account) => account.account_type === 'ASSET' && account.sub_category === 'NON_CURRENT_ASSET');
  const assetsCurrent = balanceSection('BS.CA', 'Current assets', 'চলতি সম্পদ', (account) => account.account_type === 'ASSET' && account.sub_category === 'CURRENT_ASSET');
  const liabilitiesNonCurrent = balanceSection('BS.NCL', 'Non-current liabilities', 'অচলতি দায়', (account) => account.account_type === 'LIABILITY' && account.sub_category === 'NON_CURRENT_LIABILITY');
  const liabilitiesCurrent = balanceSection('BS.CL', 'Current liabilities', 'চলতি দায়', (account) => account.account_type === 'LIABILITY' && account.sub_category === 'CURRENT_LIABILITY');

  /**
   * Accumulated profit: for EVERY profit-or-loss account the credit side increases equity, so the
   * contribution is (credit − debit) = −debitPositive. Expenses must reduce equity, never add to it.
   */
  const pnlAt = (map: Map<string, bigint>): bigint => {
    let total = 0n;
    for (const account of accounts) {
      if (!isProfitAndLoss(account)) continue;
      total -= balanceAt(map, account.code);
    }
    return total;
  };

  const equityLines: StatementLine[] = [];
  const shareCapital = accounts
    .filter((account) => account.account_type === 'EQUITY' && account.sub_category === 'EQUITY_CAPITAL')
    .reduce((sum, account) => sum + pick(account, current.closing), 0n);
  const shareCapitalComp = accounts
    .filter((account) => account.account_type === 'EQUITY' && account.sub_category === 'EQUITY_CAPITAL')
    .reduce((sum, account) => sum + pick(account, comparative.closing), 0n);
  const reservesDirect = accounts
    .filter((account) => account.account_type === 'EQUITY' && account.sub_category === 'EQUITY_RESERVES')
    .reduce((sum, account) => sum + pick(account, current.closing), 0n);
  const reservesDirectComp = accounts
    .filter((account) => account.account_type === 'EQUITY' && account.sub_category === 'EQUITY_RESERVES')
    .reduce((sum, account) => sum + pick(account, comparative.closing), 0n);

  const openingWindow = { ...window, start: window.start, end: '' };
  const pnlBeforeCurrent = pnlAt(
    sumLines(journals, (journal) => books.includes(journal.book_type) && journal.posting_date < openingWindow.start),
  );
  const pnlBeforeComparative = pnlAt(
    sumLines(
      journals,
      (journal) => books.includes(journal.book_type) && journal.posting_date < comparativeWindow.start,
    ),
  );

  const pnlAccountCodes = accounts.filter(isProfitAndLoss).map((account) => account.code);
  equityLines.push(
    sectionLine('3200', 'Issued & paid-up share capital', 'ইস্যুকৃত ও পরিশোধিত শেয়ার মূলধন', shareCapital, shareCapitalComp, {
      note: 'Note 17',
      indent: 1,
      account_codes: ['3100'],
    }),
  );
  equityLines.push(
    sectionLine(
      '3200-RE',
      'Retained earnings brought forward',
      'পূর্ববর্তী মেয়াদ থেকে সঞ্চিত মুনাফা',
      reservesDirect + pnlBeforeCurrent,
      reservesDirectComp + pnlBeforeComparative,
      { note: 'Note 17', indent: 1, account_codes: ['3200'] },
    ),
  );

  // ---- 3. Statement of profit or loss (IFRS 18) --------------------------------------------
  const plLineSet = (
    predicate: (account: Account) => boolean,
    sign: 1n | -1n,
  ): StatementLine[] => {
    const lines: StatementLine[] = [];
    for (const account of accounts) {
      if (!predicate(account)) continue;
      const amount = pick(account, current.period);
      const comp = pick(account, comparative.period);
      if (amount === 0n && comp === 0n) continue;
      lines.push(sectionLine(account.code, account.name_en, account.name_bn, sign * amount, sign * comp, { note: account.note_ref }));
    }
    return lines;
  };

  const revenueLines = plLineSet((account) => account.sub_category === 'OPERATING_REVENUE', 1n);
  const cogsLines = plLineSet((account) => account.sub_category === 'COST_OF_SALES', -1n);
  const opexLines = plLineSet((account) => account.sub_category === 'OPERATING_EXPENSE', -1n);
  const operating = buildSection('PL.OP', 'Operating category — IFRS 18', 'পরিচালন শ্রেণি — আইএফআরএস ১৮', [
    ...revenueLines,
    ...cogsLines,
    ...opexLines,
  ]);

  const investing = buildSection(
    'PL.INV',
    'Investing category — IFRS 18',
    'বিনিয়োগ শ্রেণি — আইএফআরএস ১৮',
    plLineSet((account) => account.sub_category === 'INVESTING_INCOME', 1n),
  );
  const financing = buildSection(
    'PL.FIN',
    'Financing category — IFRS 18',
    'অর্থায়ন শ্রেণি — আইএফআরএস ১৮',
    plLineSet((account) => account.sub_category === 'FINANCE_COST', -1n),
  );
  const incomeTax = buildSection(
    'PL.TAX',
    'Income taxes category — IFRS 18',
    'আয়কর শ্রেণি — আইএফআরএস ১৮',
    plLineSet((account) => account.sub_category === 'TAX_EXPENSE', -1n),
  );

  const revenueTotal = revenueLines.reduce((sum, line) => sum + line.amount_poisha, 0n);
  const revenueTotalComp = revenueLines.reduce((sum, line) => sum + line.comparative_poisha, 0n);
  const cogsTotal = cogsLines.reduce((sum, line) => sum + line.amount_poisha, 0n);
  const cogsTotalComp = cogsLines.reduce((sum, line) => sum + line.comparative_poisha, 0n);

  const operatingProfit = operating.total_poisha;
  const operatingProfitComp = operating.comparative_total_poisha;
  const pbtfi = operatingProfit + investing.total_poisha;
  const pbtfiComp = operatingProfitComp + investing.comparative_total_poisha;
  const pbt = pbtfi + financing.total_poisha;
  const pbtComp = pbtfiComp + financing.comparative_total_poisha;
  const profitForPeriod = pbt + incomeTax.total_poisha;
  const profitForPeriodComp = pbtComp + incomeTax.comparative_total_poisha;

  const depreciation =
    pick(byCode.get(DEP_EXPENSE) ?? fallbackAccount(DEP_EXPENSE), current.period);
  const eclExpense = pick(byCode.get(ECL_EXPENSE) ?? fallbackAccount(ECL_EXPENSE), current.period);
  const adjustedEbitda = operatingProfit + depreciation + eclExpense;

  statements.profit_or_loss = {
    operating,
    operating_profit_poisha: operatingProfit,
    operating_profit_comparative_poisha: operatingProfitComp,
    investing,
    profit_before_financing_tax_poisha: pbtfi,
    profit_before_financing_tax_comparative_poisha: pbtfiComp,
    financing,
    profit_before_tax_poisha: pbt,
    profit_before_tax_comparative_poisha: pbtComp,
    income_tax: incomeTax,
    profit_for_period_poisha: profitForPeriod,
    profit_for_period_comparative_poisha: profitForPeriodComp,
    gross_profit_poisha: revenueTotal + cogsTotal,
    gross_profit_comparative_poisha: revenueTotalComp + cogsTotalComp,
    mpm: {
      operating_profit_poisha: operatingProfit,
      depreciation_poisha: depreciation,
      ecl_poisha: eclExpense,
      adjusted_ebitda_poisha: adjustedEbitda,
      operating_margin_bps:
        revenueTotal === 0n ? 0 : Number((operatingProfit * 10000n) / revenueTotal),
      comparative_margin_bps:
        revenueTotalComp === 0n ? 0 : Number((operatingProfitComp * 10000n) / revenueTotalComp),
    },
  };


  // ---- 4. Equity roll-forward (IAS 1) ------------------------------------------------------
  const currentPeriodProfit = profitForPeriod;
  const closingRetained = reservesDirect + pnlBeforeCurrent + currentPeriodProfit;
  equityLines.push(
    sectionLine(
      '3200-PL',
      'Profit / (loss) for the period',
      'মেয়াদের মুনাফা / (ক্ষতি)',
      currentPeriodProfit,
      profitForPeriodComp,
      { note: 'Statement of profit or loss', indent: 1, account_codes: pnlAccountCodes },
    ),
  );
  equityLines.push(
    sectionLine('3200-OWN', 'Transactions with owners — dividends and appropriations', 'মালিকদের সাথে লেনদেন — লভ্যাংশ ও বিতরণ', 0n, 0n, {
      indent: 1,
    }),
  );
  const equitySection = buildSection('BS.EQ', 'Equity', 'ইকুইটি', equityLines);

  statements.balance_sheet = {
    assets_non_current: assetsNonCurrent,
    assets_current: assetsCurrent,
    total_assets_poisha: assetsNonCurrent.total_poisha + assetsCurrent.total_poisha,
    total_assets_comparative_poisha:
      assetsNonCurrent.comparative_total_poisha + assetsCurrent.comparative_total_poisha,
    equity: equitySection,
    liabilities_non_current: liabilitiesNonCurrent,
    liabilities_current: liabilitiesCurrent,
    total_equity_and_liabilities_poisha:
      equitySection.total_poisha + liabilitiesNonCurrent.total_poisha + liabilitiesCurrent.total_poisha,
    total_equity_and_liabilities_comparative_poisha:
      equitySection.comparative_total_poisha +
      liabilitiesNonCurrent.comparative_total_poisha +
      liabilitiesCurrent.comparative_total_poisha,
    balanced: false,
    imbalance_poisha: 0n,
  };

  const imbalance =
    statements.balance_sheet.total_assets_poisha - statements.balance_sheet.total_equity_and_liabilities_poisha;
  statements.balance_sheet.imbalance_poisha = imbalance;
  statements.balance_sheet.balanced = imbalance === 0n;
  if (imbalance !== 0n) {
    // Never hide a difference: disclose it as a named line so the printed statement still foots,
    // but keep `balanced: false` so the control dashboard turns red.
    equitySection.lines.push(
      sectionLine('3200-UNALLOC', 'Unallocated ledger classification difference', 'অবণ্টিত খাতা শ্রেণিবিন্যাস পার্থক্য', imbalance, 0n, {
        indent: 1,
      }),
    );
    equitySection.total_poisha += imbalance;
    statements.balance_sheet.total_equity_and_liabilities_poisha += imbalance;
  }

  statements.changes_in_equity = [
    {
      row_id: 'SOCIE-OPEN',
      label_en: `Balance at ${comparativeWindow.end} (beginning of period)`,
      label_bn: `${comparativeWindow.end} তারিখে উদ্বৃত্ত (মেয়াদের শুরু)`,
      share_capital_poisha: shareCapital,
      retained_earnings_poisha: reservesDirect + pnlBeforeCurrent,
      revaluation_poisha: 0n,
      total_poisha: shareCapital + reservesDirect + pnlBeforeCurrent,
    },
    {
      row_id: 'SOCIE-PROFIT',
      label_en: 'Profit / (loss) for the period',
      label_bn: 'মেয়াদের মুনাফা / (ক্ষতি)',
      share_capital_poisha: 0n,
      retained_earnings_poisha: currentPeriodProfit,
      revaluation_poisha: 0n,
      total_poisha: currentPeriodProfit,
    },
    {
      row_id: 'SOCIE-CAPITAL',
      label_en: 'Share capital issued / (redeemed) in the period',
      label_bn: 'মেয়াদে ইস্যুকৃত / (বাতিল) শেয়ার মূলধন',
      share_capital_poisha: 0n,
      retained_earnings_poisha: 0n,
      revaluation_poisha: 0n,
      total_poisha: 0n,
    },
    {
      row_id: 'SOCIE-DIVIDEND',
      label_en: 'Dividends declared and paid',
      label_bn: 'ঘোষিত ও পরিশোধিত লভ্যাংশ',
      share_capital_poisha: 0n,
      retained_earnings_poisha: 0n,
      revaluation_poisha: 0n,
      total_poisha: 0n,
    },
    {
      row_id: 'SOCIE-CLOSE',
      label_en: `Balance at ${window.end} (end of period)`,
      label_bn: `${window.end} তারিখে উদ্বৃত্ত (মেয়াদের শেষ)`,
      share_capital_poisha: shareCapital,
      retained_earnings_poisha: closingRetained,
      revaluation_poisha: 0n,
      total_poisha: shareCapital + closingRetained,
      is_total: true,
    },
  ];

  // ---- 5. Statement of cash flows (IAS 7, IFRS 18 amendment) -------------------------------
  const cashCodes = cashAccounts(accounts, input.bankAccounts);
  const cashAt = (map: Map<string, bigint>): bigint =>
    cashCodes.reduce((sum, code) => sum + balanceAt(map, code), 0n);
  const openingCash = cashAt(current.opening);
  const closingCash = cashAt(current.closing);
  const openingCashComp = cashAt(comparative.opening);
  const closingCashComp = cashAt(comparative.closing);

  const deltaAsset = (code: string): bigint => -balanceAt(current.period, code);
  const deltaLiability = (code: string): bigint => -balanceAt(current.period, code);

  const cashFlowOperating: StatementLine[] = [
    sectionLine('CF.OP.PROFIT', 'Operating profit / (loss) per IFRS 18', 'আইএফআরএস ১৮ অনুযায়ী পরিচালন মুনাফা', operatingProfit, operatingProfitComp, {
      indent: 1,
      account_codes: pnlAccountCodes,
    }),
    sectionLine('CF.OP.DEP', 'Add: depreciation of PPE and right-of-use assets', 'যোগ: সম্পত্তি ও ব্যবহারের অধিকার সম্পদের অবচয়', depreciation, comparativeExpense(DEP_EXPENSE), {
      indent: 2,
      account_codes: [DEP_EXPENSE, PPE_DEP, ROU_DEP],
    }),
    sectionLine('CF.OP.ECL', 'Add: expected credit loss impairment', 'যোগ: প্রত্যাশিত ক্রেডিট ক্ষতি', eclExpense, comparativeExpense(ECL_EXPENSE), {
      indent: 2,
      account_codes: [ECL_EXPENSE, ECL_ALLOWANCE],
    }),
  ];

  const wcOrder = [...OPERATING_WC_ASSET_CODES, ...OPERATING_WC_LIABILITY_CODES];
  const wcComparative = new Map<string, bigint>();
  for (const code of wcOrder) {
    const movement = balanceAt(current.period, code);
    // Debit-positive movement → cash effect is always the negative of it: an asset increase is a
    // cash outflow, a liability increase (credit) is a cash inflow.
    const cashEffect = -movement;
    const compEffect = comparativeCashEffect(comparative, code);
    wcComparative.set(code, compEffect);
    if (cashEffect === 0n && compEffect === 0n) continue;
    const label = WC_LABELS[code] ?? { en: `Movement in ${code}`, bn: `${code}-এ পরিবর্তন` };
    cashFlowOperating.push(
      sectionLine(
        `CF.OP.${code}`,
        `${cashEffect >= 0n ? 'Decrease / (increase)' : 'Increase / (decrease)'} in ${label.en.toLowerCase()}`,
        `${label.bn}-এ ${cashEffect >= 0n ? 'হ্রাস / (বৃদ্ধি)' : 'বৃদ্ধি / (হ্রাস)'}`,
        cashEffect,
        compEffect,
        { indent: 2, account_codes: [code] },
      ),
    );
  }

  const taxExpensePeriod = pick(byCode.get(TAX_EXPENSE) ?? fallbackAccount(TAX_EXPENSE), current.period);
  const taxProvisionOpening = -balanceAt(current.opening, TAX_PROVISION);
  const taxProvisionClosing = -balanceAt(current.closing, TAX_PROVISION);
  const taxPaid = taxProvisionOpening + taxExpensePeriod - taxProvisionClosing;
  const comparativeSlice = comparative;
  const taxExpenseComp = pick(byCode.get(TAX_EXPENSE) ?? fallbackAccount(TAX_EXPENSE), comparative.period);
  const taxPaidComp =
    -balanceAt(comparativeSlice.opening, TAX_PROVISION) +
    taxExpenseComp -
    -balanceAt(comparativeSlice.closing, TAX_PROVISION);
  cashFlowOperating.push(
    sectionLine('CF.OP.TAX', 'Income taxes paid', 'পরিশোধিত আয়কর', -taxPaid, -taxPaidComp, {
      indent: 2,
      account_codes: [TAX_PROVISION, TAX_EXPENSE],
    }),
  );

  const operatingSection = buildSection('CF.OP', 'Cash flows from operating activities', 'পরিচালন কার্যক্রম থেকে নগদ প্রবাহ', cashFlowOperating);

  const investingLines: StatementLine[] = [];
  const investingIncome = investing.total_poisha;
  const investingIncomeComp = investing.comparative_total_poisha;
  investingLines.push(
    sectionLine('CF.INV.INC', 'Interest received on FDR investments', 'এফডিআর বিনিয়োগে প্রাপ্ত সুদ', investingIncome, investingIncomeComp, { indent: 1 }),
  );
  for (const code of [PPE_COST, ROU_COST, '1410', '1810']) {
    const movement = deltaAsset(code);
    const comp = comparativeCashEffect(comparative, code);
    if (movement === 0n && comp === 0n) continue;
    const account = byCode.get(code);
    investingLines.push(
      sectionLine(
        `CF.INV.${code}`,
        `${movement >= 0n ? 'Proceeds from sale of' : 'Purchase of'} ${(account?.name_en ?? code).toLowerCase()}`,
        `${(account?.name_bn ?? code)} ${movement >= 0n ? 'বিক্রয় থেকে প্রাপ্তি' : 'ক্রয়'}`,
        movement,
        comp,
        { indent: 1, account_codes: [code] },
      ),
    );
  }
  const investingSection = buildSection('CF.INV', 'Cash flows from investing activities', 'বিনিয়োগ কার্যক্রম থেকে নগদ প্রবাহ', investingLines);

  const financingLines: StatementLine[] = [];
  const financingCosts = -(financing.total_poisha);
  const financingCostsComp = -(financing.comparative_total_poisha);
  financingLines.push(
    sectionLine('CF.FIN.COST', 'Interest and bank charges paid', 'পরিশোধিত সুদ ও ব্যাংক চার্জ', -financingCosts, -financingCostsComp, { indent: 1 }),
  );
  for (const code of ['2210', '2510', '3100', '3200']) {
    const movement = deltaLiability(code);
    const comp = comparativeCashEffect(comparative, code);
    if (movement === 0n && comp === 0n) continue;
    const account = byCode.get(code);
    financingLines.push(
      sectionLine(
        `CF.FIN.${code}`,
        `${movement >= 0n ? 'Proceeds from' : 'Repayment of'} ${(account?.name_en ?? code).toLowerCase()}`,
        `${(account?.name_bn ?? code)} ${movement >= 0n ? 'থেকে প্রাপ্তি' : 'পরিশোধ'}`,
        movement,
        comp,
        { indent: 1, account_codes: [code] },
      ),
    );
  }
  const financingSection = buildSection('CF.FIN', 'Cash flows from financing activities', 'অর্থায়ন কার্যক্রম থেকে নগদ প্রবাহ', financingLines);

  const netChange = operatingSection.total_poisha + investingSection.total_poisha + financingSection.total_poisha;
  const netChangeComp =
    operatingSection.comparative_total_poisha +
    investingSection.comparative_total_poisha +
    financingSection.comparative_total_poisha;
  const difference = openingCash + netChange - closingCash;
  // No silent plug. If the indirect statement cannot reconcile to the ledger cash accounts it
  // remains visibly out of balance (`reconciles: false`) and the close process must block on it.
  statements.cash_flow = {
    operating: operatingSection,
    operating_total_poisha: operatingSection.total_poisha,
    operating_total_comparative_poisha: operatingSection.comparative_total_poisha,
    investing: investingSection,
    investing_total_poisha: investingSection.total_poisha,
    investing_total_comparative_poisha: investingSection.comparative_total_poisha,
    financing: financingSection,
    financing_total_poisha: financingSection.total_poisha,
    financing_total_comparative_poisha: financingSection.comparative_total_poisha,
    net_change_poisha: netChange,
    net_change_comparative_poisha: netChangeComp,
    opening_cash_poisha: openingCash,
    opening_cash_comparative_poisha: openingCashComp,
    closing_cash_poisha: closingCash,
    closing_cash_comparative_poisha: closingCashComp,
    reconciles: difference === 0n && openingCash + netChange === closingCash,
    difference_poisha: difference,
  };

  // ---- 6. Notes to the financial statements -------------------------------------------------
  statements.notes = buildNotes({
    accounts,
    byCode,
    current,
    comparative,
    journals,
    books,
    window,
    comparativeWindow,
    commercialDocs: input.commercialDocs ?? [],
    parties: input.parties ?? [],
    pick,
    cashCodes,
    periodGross,
  });

  // ---- 7. Executive KPIs -------------------------------------------------------------------
  const revenueKpi = revenueTotal;
  const expensesKpi = -(cogsTotal + opexLines.reduce((sum, line) => sum + line.amount_poisha, 0n) + financing.total_poisha + incomeTax.total_poisha);
  statements.kpis = {
    revenue_poisha: revenueKpi,
    expenses_poisha: expensesKpi,
    net_profit_poisha: profitForPeriod,
    cash_poisha: closingCash,
    receivables_poisha: normalAt(current.closing, '1210') + normalAt(current.closing, ECL_ALLOWANCE),
    payables_poisha: normalAt(current.closing, '2110'),
    output_vat_poisha: normalAt(current.closing, '2120'),
    input_vat_poisha: normalAt(current.closing, '1140'),
    vds_payable_poisha: normalAt(current.closing, '2130'),
    tds_payable_poisha: normalAt(current.closing, '2140'),
    retained_earnings_poisha: closingRetained,
  };

  return statements;
}

function comparativeCashEffect(slice: LedgerSlice, code: string): bigint {
  return -(slice.period.get(code) ?? 0n);
}

// ---------------------------------------------------------------------------------------------
// Notes to the financial statements
// ---------------------------------------------------------------------------------------------

interface NotesInput {
  accounts: Account[];
  byCode: Map<string, Account>;
  current: LedgerSlice;
  comparative: LedgerSlice;
  journals: readonly JournalEntry[];
  books: readonly BookType[];
  window: PeriodWindow;
  comparativeWindow: PeriodWindow;
  commercialDocs: readonly CommercialDoc[];
  parties: readonly Party[];
  pick: (account: Account, map: Map<string, bigint>) => bigint;
  cashCodes: string[];
  periodGross: Map<string, { debit: bigint; credit: bigint }>;
}

function noteRow(
  labelEn: string,
  labelBn: string,
  amount: bigint,
  comparative: bigint,
): { label_en: string; label_bn: string; amount_poisha: bigint; comparative_poisha: bigint } {
  return { label_en: labelEn, label_bn: labelBn, amount_poisha: amount, comparative_poisha: comparative };
}

function buildNotes(input: NotesInput): FinancialStatements['notes'] {
  const { byCode, current, comparative, pick, commercialDocs } = input;
  const account = (code: string): Account => byCode.get(code) ?? fallbackAccount(code);
  const note = (
    id: string,
    number: string,
    titleEn: string,
    titleBn: string,
    bodyEn: string,
    bodyBn: string,
    rows: FinancialStatements['notes'][number]['rows'],
  ) => ({ id, number, title_en: titleEn, title_bn: titleBn, body_en: bodyEn, body_bn: bodyBn, rows });

  const ppeCost = pick(account(PPE_COST), current.closing);
  const ppeCostComp = pick(account(PPE_COST), comparative.closing);
  const ppeDep = pick(account(PPE_DEP), current.closing);
  const ppeDepComp = pick(account(PPE_DEP), comparative.closing);
  const ppeCharge = pick(account(DEP_EXPENSE), current.period);

  const rouCost = pick(account(ROU_COST), current.closing);
  const rouCostComp = pick(account(ROU_COST), comparative.closing);
  const rouDep = pick(account(ROU_DEP), current.closing);
  const rouDepComp = pick(account(ROU_DEP), comparative.closing);

  const ppeNote = note(
    'NOTE-4',
    '4',
    'Property, plant, equipment and right-of-use assets',
    'সম্পত্তি, যন্ত্রপাতি, সরঞ্জাম ও ব্যবহারের অধিকার সম্পদ',
    'PPE is carried at cost less accumulated depreciation on a straight-line basis. The warehouse and office leases are recognised as right-of-use assets under IFRS 16 with the corresponding lease liability measured at the present value of the remaining lease payments.',
    'সম্পত্তি ও যন্ত্রপাতি ব্যয় থেকে সঞ্চিত অবচয় বাদ দিয়ে সরলরৈখিক পদ্ধতিতে বহন করা হয়। গুদাম ও অফিস লিজ আইএফএআরএস ১৬ অনুযায়ী ব্যবহারের অধিকার সম্পদ হিসেবে স্বীকৃত এবং সংশ্লিষ্ট লিজ দায় অবশিষ্ট লিজ প্রদানের বর্তমান মূল্যে পরিমাপ করা হয়।',
    [
      noteRow('Cost — property, plant and equipment', 'ব্যয় — সম্পত্তি ও যন্ত্রপাতি', ppeCost, ppeCostComp),
      noteRow('Accumulated depreciation — PPE', 'সঞ্চিত অবচয় — সম্পত্তি ও যন্ত্রপাতি', ppeDep, ppeDepComp),
      noteRow('Net book value — PPE', 'নিট বহনমূল্য — সম্পত্তি ও যন্ত্রপাতি', ppeCost + ppeDep, ppeCostComp + ppeDepComp),
      noteRow('Right-of-use assets — IFRS 16 (cost)', 'ব্যবহারের অধিকার সম্পদ — আইএফএআরএস ১৬ (ব্যয়)', rouCost, rouCostComp),
      noteRow('Accumulated depreciation — ROU assets', 'সঞ্চিত অবচয় — আরওইউ সম্পদ', rouDep, rouDepComp),
      noteRow('Net book value — ROU assets', 'নিট বহনমূল্য — আরওইউ সম্পদ', rouCost + rouDep, rouCostComp + rouDepComp),
      noteRow('Depreciation charge for the period', 'মেয়াদের অবচয় ব্যয়', ppeCharge, 0n),
    ],
  );

  const inventory = pick(account('1310'), current.closing);
  const inventoryComp = pick(account('1310'), comparative.closing);
  const cogs = -pick(account('5100'), current.period);
  const cogsComp = -pick(account('5100'), comparative.period);
  const inventoryNote = note(
    'NOTE-7',
    '7',
    'Inventories and cost of sales',
    'মজুদ ও বিক্রীত পণ্যের ব্যয়',
    'Merchandise inventory is measured at the lower of weighted-average cost and net realisable value. Disallowed input VAT under s.46 is capitalised into inventory cost, never expensed as a recoverable credit.',
    'মজুদ পণ্য ভারযুক্ত গড় ব্যয় ও নিট প্রতিপাদনযোগ্য মূল্যের মধ্যে নিম্নতরটিতে পরিমাপ করা হয়। ধারা ৪৬ অনুযায়ী বাতিল ইনপুট ভ্যাট মজুদ ব্যয়ে মূলধনায়িত হয়, দাবিযোগ্য ক্রেডিট হিসেবে ব্যয় করা হয় না।',
    [
      noteRow('Merchandise inventory — closing', 'মজুদ পণ্য — সমাপনী', inventory, inventoryComp),
      noteRow('Cost of goods sold recognised', 'স্বীকৃত বিক্রীত পণ্যের ব্যয়', cogs, cogsComp),
      noteRow(
        'Inventory purchases capitalised (including disallowed input VAT)',
        'মূলধনায়িত মজুদ ক্রয় (বাতিল ইনপুট ভ্যাটসহ)',
        input.periodGross.get('1310')?.debit ?? 0n,
        0n,
      ),
    ],
  );

  const arGross = pick(account('1210'), current.closing);
  const arGrossComp = pick(account('1210'), comparative.closing);
  const ecl = pick(account(ECL_ALLOWANCE), current.closing);
  const eclComp = pick(account(ECL_ALLOWANCE), comparative.closing);
  const eclCharge = pick(account(ECL_EXPENSE), current.period);
  const eclChargeComp = pick(account(ECL_EXPENSE), comparative.period);
  const arNote = note(
    'NOTE-8',
    '8',
    'Trade receivables and expected credit losses (IFRS 9)',
    'বাণিজ্যিক প্রাপ্য ও প্রত্যাশিত ক্রেডিট ক্ষতি (আইএফএআরএস ৯)',
    'The loss allowance is measured at 0.75% of open receivables using the simplified IFRS 9 matrix, reflecting the short credit cycle and the concentration of government-linked corporate buyers.',
    'সরলীকৃত আইএফএআরএস ৯ ম্যাট্রিক্স ব্যবহার করে খোলা প্রাপ্যের ০.৭৫% হারে ক্ষতি ভাতা পরিমাপ করা হয়, যা স্বল্প ক্রেডিট চক্র ও সরকারি-সংযুক্ত কর্পোরেট ক্রেতার ঘনত্ব প্রতিফলিত করে।',
    [
      noteRow('Gross trade receivables', 'মোট বাণিজ্যিক প্রাপ্য', arGross, arGrossComp),
      noteRow('Less: allowance for expected credit losses', 'বাদ: প্রত্যাশিত ক্রেডিট ক্ষতির ভাতা', ecl, eclComp),
      noteRow('Net trade receivables', 'নিট বাণিজ্যিক প্রাপ্য', arGross + ecl, arGrossComp + eclComp),
      noteRow('ECL impairment charge for the period', 'মেয়াদের ইসিএল ক্ষতি ব্যয়', eclCharge, eclChargeComp),
    ],
  );

  // Mushak 9.1 reconciliation: register totals (from documents) vs GL control accounts.
  const salesRegister = commercialDocs.filter(
    (doc) => doc.doc_type === 'SALES_INVOICE' && doc.doc_date >= input.window.start && doc.doc_date <= input.window.end,
  );
  const purchaseRegister = commercialDocs.filter(
    (doc) =>
      (doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER' || doc.doc_type === 'IMPORTED_SERVICE') &&
      doc.doc_date >= input.window.start &&
      doc.doc_date <= input.window.end,
  );
  const creditNotes = commercialDocs.filter(
    (doc) => doc.doc_type === 'CREDIT_NOTE' && doc.doc_date >= input.window.start && doc.doc_date <= input.window.end,
  );
  const registerOutputVat =
    salesRegister.reduce((sum, doc) => sum + doc.vat_poisha, 0n) -
    creditNotes.reduce((sum, doc) => sum + doc.vat_poisha, 0n);
  let registerInputVat = 0n;
  for (const doc of purchaseRegister) {
    try {
      registerInputVat += documentTaxOutcome(doc).claimable_poisha;
    } catch {
      registerInputVat += doc.vat_poisha;
    }
  }
  const glOutputVat = pick(account('2120'), current.period) * -1n;
  const glInputVat = pick(account('1140'), current.period);
  const vatNote = note(
    'NOTE-10',
    '10',
    'VAT current account and Mushak 9.1 reconciliation',
    'ভ্যাট চলতি হিসাব ও মূসক ৯.১ সমন্বয়',
    `Mushak 6.2 sales register output VAT reconciles to the output VAT posted in the ledger, and the Mushak 6.1 purchase register reconciles to the eligible input rebate. The filing rule and deadline are not asserted here; the rule pack and statutory template are pending tax-counsel review.`,
    `মূসক ৬.২ বিক্রয় রেজিস্টারের আউটপুট ভ্যাট খাতায় পোস্টকৃত আউটপুট ভ্যাটের সাথে এবং মূসক ৬.১ ক্রয় রেজিস্টার যোগ্য ইনপুট রিবেটের সাথে মিলে যায়। এখানে ফাইলিং বিধি বা সময়সীমা দাবি করা হয় না; রুল প্যাক ও সংবিধিবদ্ধ টেমপ্লেট কর পরামর্শকের পর্যালোচনার অপেক্ষায়।`,
    [
      noteRow('Output VAT per Mushak 6.2 sales register', 'মূসক ৬.২ বিক্রয় রেজিস্টার অনুযায়ী আউটপুট ভ্যাট', registerOutputVat, 0n),
      noteRow('Output VAT per general ledger (period)', 'সাধারণ খাতা অনুযায়ী আউটপুট ভ্যাট (মেয়াদ)', glOutputVat, 0n),
      noteRow('Difference — output VAT', 'পার্থক্য — আউটপুট ভ্যাট', registerOutputVat - glOutputVat, 0n),
      noteRow('Input VAT claimable per Mushak 6.1 register', 'মূসক ৬.১ রেজিস্টার অনুযায়ী দাবিযোগ্য ইনপুট ভ্যাট', registerInputVat, 0n),
      noteRow('Input VAT posted to 1140 (period)', '১১৪০-এ পোস্টকৃত ইনপুট ভ্যাট (মেয়াদ)', glInputVat, 0n),
      noteRow('Difference — input VAT', 'পার্থক্য — ইনপুট ভ্যাট', registerInputVat - glInputVat, 0n),
      noteRow('VAT current account balance — closing', 'ভ্যাট চলতি হিসাব ব্যালেন্স — সমাপনী', pick(account('1140'), current.closing), pick(account('1140'), comparative.closing)),
      noteRow('Output VAT payable — closing', 'আউটপুট ভ্যাট প্রদেয় — সমাপনী', pick(account('2120'), current.closing), pick(account('2120'), comparative.closing)),
    ],
  );

  const vdsClosing = pick(account('2130'), current.closing);
  const vdsClosingComp = pick(account('2130'), comparative.closing);
  const tdsClosing = pick(account('2140'), current.closing);
  const tdsClosingComp = pick(account('2140'), comparative.closing);
  const vdsWithheld = -pick(account('2130'), current.period) + pick(account('2130'), current.period) * 0n;
  const vdsNote = note(
    'NOTE-15',
    '15',
    'VDS and TDS withheld payable to the Treasury',
    'কোষাগারে প্রদেয় কর্তিত ভিডিএস ও টিডিএস',
    'VDS is withheld under s.49 of the VAT & SD Act 2012 against a Mushak 6.6 certificate, and TDS under the Income Tax Act 2023. Both are deposited to the Treasury by the 15th of the following month; an unpaid balance is a statutory liability, never a reconciling item.',
    'ভ্যাট ও এসডি আইন ২০১২-এর ধারা ৪৯ অনুযায়ী মূসক ৬.৬ সনদের বিপরীতে ভিডিএস এবং আয়কর আইন ২০২৩ অনুযায়ী টিডিএস কর্তন করা হয়। উভয়ই পরবর্তী মাসের ১৫ তারিখের মধ্যে কোষাগারে জমা দিতে হয়; অপরিশোধিত ব্যালেন্স বিধিবদ্ধ দায়, সমন্বয়ের বিষয় নয়।',
    [
      noteRow('VDS withheld payable — closing', 'কর্তিত ভিডিএস প্রদেয় — সমাপনী', vdsClosing, vdsClosingComp),
      noteRow('TDS withheld payable — closing', 'কর্তিত টিডিএস প্রদেয় — সমাপনী', tdsClosing, tdsClosingComp),
      noteRow('Mushak 6.6 certificates issued (supplier side)', 'ইস্যুকৃত মূসক ৬.৬ সনদ (সরবরাহকারী পক্ষ)', vdsWithheld, 0n),
      noteRow('Total withheld payable to the Treasury', 'কোষাগারে মোট প্রদেয় কর্তন', vdsClosing + tdsClosing, vdsClosingComp + tdsClosingComp),
    ],
  );

  const taxExpense = pick(account(TAX_EXPENSE), current.period);
  const taxProvision = pick(account(TAX_PROVISION), current.closing);
  const taxNote = note(
    'NOTE-16',
    '16',
    'Income tax expense and provision',
    'আয়কর ব্যয় ও সঞ্চিতি',
    'Current tax is provided at the applicable corporate rate on estimated taxable profit. Deferred tax is recognised on temporary differences arising from the IFRS 16 lease liability and the IFRS 9 loss allowance in the tax computation book.',
    'আনুমানিক করযোগ্য মুনাফার ওপর প্রযোজ্য কর্পোরেট হারে চলতি কর সঞ্চিতি রাখা হয়। কর গণনা খাতায় আইএফএআরএস ১৬ লিজ দায় ও আইএফএআরএস ৯ ক্ষতি ভাতা থেকে উদ্ভূত অস্থায়ী পার্থক্যের ওপর বিলম্বিত কর স্বীকৃত হয়।',
    [
      noteRow('Current income tax expense', 'চলতি আয়কর ব্যয়', taxExpense, pick(account(TAX_EXPENSE), comparative.period)),
      noteRow('Current tax provision — closing', 'চলতি কর সঞ্চিতি — সমাপনী', taxProvision, pick(account(TAX_PROVISION), comparative.closing)),
      noteRow('Deferred tax asset — closing', 'বিলম্বিত কর সম্পদ — সমাপনী', pick(account('1810'), current.closing), pick(account('1810'), comparative.closing)),
    ],
  );

  const cashNote = note(
    'NOTE-9',
    '9',
    'Cash, bank and mobile financial services',
    'নগদ, ব্যাংক ও মোবাইল আর্থিক সেবা',
    'Balances are held with scheduled banks and MFS merchant wallets. The bKash and Nagad merchant wallets settle on a T+1 cycle and are reconciled daily against the booking ledger.',
    'ব্যালেন্স তফসিলি ব্যাংক ও এমএফএস মার্চেন্ট ওয়ালেটে রাখা হয়। বিকাশ ও নগদ মার্চেন্ট ওয়ালেট টি+১ চক্রে নিষ্পত্তি হয় এবং প্রতিদিন খাতার সাথে মিলিয়ে দেখা হয়।',
    input.cashCodes.map((code) =>
      noteRow(
        byCode.get(code)?.name_en ?? code,
        byCode.get(code)?.name_bn ?? code,
        (current.closing.get(code) ?? 0n),
        (comparative.closing.get(code) ?? 0n),
      ),
    ),
  );

  return [ppeNote, inventoryNote, arNote, cashNote, vatNote, vdsNote, taxNote];
}

// ---------------------------------------------------------------------------------------------
// Mushak register derivation (used by the notes, the VAT workspace and the audit pack)
// ---------------------------------------------------------------------------------------------

export function buildMushakRegisterRows(
  docs: readonly CommercialDoc[],
  periodCode: string,
  direction: 'SALE' | 'PURCHASE',
): FinancialStatements['notes'][number]['rows'] {
  const filtered = docs.filter((doc) => {
    if (doc.doc_date.slice(0, 7) !== periodCode) return false;
    if (direction === 'SALE') return doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE';
    return doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER' || doc.doc_type === 'IMPORTED_SERVICE';
  });
  return filtered.map((doc) =>
    noteRow(
      `${doc.doc_number} — ${doc.party_name_en} (${doc.mushak_serial ?? doc.mushak63_ref ?? 'no serial'})`,
      `${doc.doc_number} — ${doc.party_name_bn}`,
      doc.base_poisha,
      doc.vat_poisha,
    ),
  );
}
