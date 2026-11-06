import type { Pool, PoolClient } from 'pg';
import {
  getTrialBalance,
  getTrialBalanceAccount,
  listJournals,
  type JournalListFilters,
} from '../ledger/ledgerService.ts';
import {
  checkDto,
  closingAmount,
  formatReportDateEn,
  loadAccountBalances,
  normalAmount,
  openingAmount,
  periodAmount,
  reportGeneratedAt,
  resolveAsOfScope,
  resolveRangeScope,
  type AccountBalanceRow,
  type ReportScopeInput,
} from './common.ts';
import { REPORT_TEMPLATES } from './templates.ts';
import type {
  BalanceSheetDto,
  CashFlowDto,
  ChangesInEquityDto,
  ChangesInEquityRowDto,
  GeneralLedgerReportDto,
  JournalListingDto,
  ProfitAndLossDto,
  ReportCheckDto,
  ReportLineDto,
  ReportSectionDto,
  TrialBalanceReportDto,
} from './types.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const PNL_SUBCATEGORIES = new Set([
  'OPERATING_REVENUE',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'FINANCE_COST',
  'INVESTING_INCOME',
  'TAX_EXPENSE',
]);

const SECTION_TITLES = {
  revenue: { en: 'Revenue', bn: 'রাজস্ব' },
  costOfSales: { en: 'Cost of sales', bn: 'বিক্রীত পণ্যের ব্যয়' },
  operatingExpenses: { en: 'Operating expenses', bn: 'পরিচালন ব্যয়' },
  investingIncome: { en: 'Investing income', bn: 'বিনিয়োগ আয়' },
  financeCosts: { en: 'Finance costs', bn: 'অর্থায়ন ব্যয়' },
  incomeTax: { en: 'Income tax expense', bn: 'আয়কর ব্যয়' },
  assetsNonCurrent: { en: 'Non-current assets', bn: 'অচলতি সম্পদ' },
  assetsCurrent: { en: 'Current assets', bn: 'চলতি সম্পদ' },
  equity: { en: 'Equity', bn: 'ইকুইটি' },
  liabilitiesNonCurrent: { en: 'Non-current liabilities', bn: 'অচলতি দায়' },
  liabilitiesCurrent: { en: 'Current liabilities', bn: 'চলতি দায়' },
  operating: { en: 'Operating activities', bn: 'পরিচালন কার্যক্রম' },
  investing: { en: 'Investing activities', bn: 'বিনিয়োগ কার্যক্রম' },
  financing: { en: 'Financing activities', bn: 'অর্থায়ন কার্যক্রম' },
} as const;

export function resolveNoteRef(accountCode?: string | null, accountType?: string, subCategory?: string): string {
  if (!accountCode) return '';
  const code = accountCode.trim();
  if (code.startsWith('153')) return 'Note 5';
  if (code === '1540') return 'Note 27';
  if (code.startsWith('15')) return 'Note 4';
  if (code.startsWith('13')) return 'Note 6';
  if (code.startsWith('121')) return 'Note 7';
  if (code === '1140') return 'Note 8';
  if (code === '1145') return 'Note 9';
  if (code === '1150') return 'Note 10';
  if (code.startsWith('111') || code.startsWith('112') || code.startsWith('113') || code.startsWith('101') || code.startsWith('102')) return 'Note 11';
  if (code.startsWith('311') || code.startsWith('310')) return 'Note 12';
  if (code.startsWith('321') || code.startsWith('320')) return 'Note 13';
  if (code.startsWith('331') || code.startsWith('330')) return 'Note 14';
  if (code === '2530') return 'Note 27';
  if (code.startsWith('25') || code.startsWith('22')) return 'Note 15';
  if (code === '2120') return 'Note 28';
  if (code.startsWith('211')) return 'Note 16';
  if (code === '2130') return 'Note 17';
  if (code === '2140') return 'Note 18';
  if (code === '2141') return 'Note 19';
  if (code.startsWith('215')) return 'Note 29';
  if (code.startsWith('216')) return 'Note 30';
  if (code === '2170') return 'Note 20';
  if (code.startsWith('41')) return 'Note 21';
  if (code.startsWith('52')) return 'Note 22';
  if (code === '5190' || code.startsWith('519')) return 'Note 31';
  if (code.startsWith('51') || code.startsWith('53')) return 'Note 23';
  if (code.startsWith('42')) return 'Note 24';
  if (code.startsWith('54')) return 'Note 25';
  if (code.startsWith('55')) return 'Note 26';
  return 'Note 32';
}

function lineFromBalance(row: AccountBalanceRow, amount: bigint, comparative: bigint): ReportLineDto {
  return {
    accountId: row.id,
    accountCode: row.code,
    accountNameEn: row.nameEn,
    accountNameBn: row.nameBn,
    amountPoisha: amount.toString(),
    comparativePoisha: comparative.toString(),
    kind: 'ACCOUNT',
    note: null,
    noteRef: resolveNoteRef(row.code, row.accountType, row.subCategory),
  };
}

function buildSection(key: string, title: { en: string; bn: string }, lines: ReportLineDto[]): ReportSectionDto {
  let total = 0n;
  let comparative = 0n;
  for (const line of lines) {
    total += BigInt(line.amountPoisha);
    comparative += BigInt(line.comparativePoisha);
  }
  return {
    key,
    titleEn: title.en,
    titleBn: title.bn,
    lines,
    totalPoisha: total.toString(),
    comparativeTotalPoisha: comparative.toString(),
  };
}

function byId(rows: AccountBalanceRow[]): Map<string, AccountBalanceRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function sumSection(sections: ReportSectionDto[], key: string): bigint {
  return BigInt(sections.find((section) => section.key === key)?.totalPoisha ?? '0');
}

function sumSectionComparative(sections: ReportSectionDto[], key: string): bigint {
  return BigInt(sections.find((section) => section.key === key)?.comparativeTotalPoisha ?? '0');
}

function canExportFrom(checks: ReportCheckDto[]): boolean {
  return checks.every((check) => !check.blocksExport || check.passed);
}

function classForPnl(row: AccountBalanceRow): keyof typeof SECTION_TITLES | null {
  switch (row.subCategory) {
    case 'OPERATING_REVENUE':
      return 'revenue';
    case 'COST_OF_SALES':
      return 'costOfSales';
    case 'OPERATING_EXPENSE':
      return 'operatingExpenses';
    case 'INVESTING_INCOME':
      return 'investingIncome';
    case 'FINANCE_COST':
      return 'financeCosts';
    case 'TAX_EXPENSE':
      return 'incomeTax';
    default:
      return null;
  }
}

function pnlSection(
  key: keyof typeof SECTION_TITLES,
  current: AccountBalanceRow[],
  comparative: Map<string, AccountBalanceRow>,
): ReportSectionDto {
  const lines: ReportLineDto[] = [];
  const currentMap = byId(current);
  const ids = new Set([...currentMap.keys(), ...comparative.keys()]);
  for (const id of ids) {
    const row = currentMap.get(id) ?? comparative.get(id)!;
    if (classForPnl(row) !== key) continue;
    const currentRow = currentMap.get(id);
    const compRow = comparative.get(id);
    const amount = currentRow ? normalAmount(currentRow.accountType, periodAmount(currentRow)) : 0n;
    const comp = compRow ? normalAmount(compRow.accountType, periodAmount(compRow)) : 0n;
    if (amount === 0n && comp === 0n) continue;
    lines.push(lineFromBalance(row, amount, comp));
  }
  lines.sort((left, right) => (left.accountCode ?? '').localeCompare(right.accountCode ?? ''));
  return buildSection(key, SECTION_TITLES[key], lines);
}

function sumPnlProfit(rows: AccountBalanceRow[]): bigint {
  let total = 0n;
  for (const row of rows) {
    if (!PNL_SUBCATEGORIES.has(row.subCategory)) continue;
    // Debit-positive balance; profit contribution is always the credit side.
    total -= periodAmount(row);
  }
  return total;
}

export async function getProfitAndLossReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<ProfitAndLossDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const current = await loadAccountBalances(
    database,
    companyId,
    from,
    to,
    resolved.scope.branchId,
    resolved.scope.branchScope,
  );
  const comparative =
    resolved.comparativeFrom && resolved.comparativeTo
      ? await loadAccountBalances(
          database,
          companyId,
          resolved.comparativeFrom,
          resolved.comparativeTo,
          resolved.scope.branchId,
          resolved.scope.branchScope,
        )
      : [];
  const comparativeMap = byId(comparative);

  const sections = [
    pnlSection('revenue', current, comparativeMap),
    pnlSection('costOfSales', current, comparativeMap),
    pnlSection('operatingExpenses', current, comparativeMap),
    pnlSection('investingIncome', current, comparativeMap),
    pnlSection('financeCosts', current, comparativeMap),
    pnlSection('incomeTax', current, comparativeMap),
  ];

  const revenue = sumSection(sections, 'revenue');
  const costOfSales = sumSection(sections, 'costOfSales');
  const operatingExpenses = sumSection(sections, 'operatingExpenses');
  const investingIncome = sumSection(sections, 'investingIncome');
  const financeCosts = sumSection(sections, 'financeCosts');
  const taxExpense = sumSection(sections, 'incomeTax');

  // IFRS 18 Mandatory Subtotals:
  const netOperatingRevenuePoisha = revenue;
  const cogsPoisha = costOfSales;
  const grossProfit = netOperatingRevenuePoisha - cogsPoisha;
  const operatingProfit = grossProfit - operatingExpenses;
  const profitBeforeFinancingAndTax = operatingProfit + investingIncome;
  const profitBeforeTax = profitBeforeFinancingAndTax - financeCosts;

  const taxSection = sections.find((s) => s.key === 'incomeTax');
  let currentTax = 0n;
  let deferredTax = 0n;
  if (taxSection) {
    for (const line of taxSection.lines) {
      const amt = BigInt(line.amountPoisha);
      if (line.accountCode === '5520' || line.accountNameEn.toLowerCase().includes('deferred')) {
        deferredTax += amt;
      } else {
        currentTax += amt;
      }
    }
  } else {
    currentTax = taxExpense;
  }
  const profitForPeriod = profitBeforeTax - currentTax - deferredTax;

  const revenueCmp = sumSectionComparative(sections, 'revenue');
  const costOfSalesCmp = sumSectionComparative(sections, 'costOfSales');
  const operatingExpensesCmp = sumSectionComparative(sections, 'operatingExpenses');
  const investingIncomeCmp = sumSectionComparative(sections, 'investingIncome');
  const financeCostsCmp = sumSectionComparative(sections, 'financeCosts');
  const taxExpenseCmp = sumSectionComparative(sections, 'incomeTax');
  const grossProfitCmp = revenueCmp - costOfSalesCmp;
  const operatingProfitCmp = grossProfitCmp - operatingExpensesCmp;
  const profitBeforeFinancingAndTaxCmp = operatingProfitCmp + investingIncomeCmp;
  const profitBeforeTaxCmp = profitBeforeFinancingAndTaxCmp - financeCostsCmp;

  let currentTaxCmp = 0n;
  let deferredTaxCmp = 0n;
  if (taxSection) {
    for (const line of taxSection.lines) {
      const amt = BigInt(line.comparativePoisha);
      if (line.accountCode === '5520' || line.accountNameEn.toLowerCase().includes('deferred')) {
        deferredTaxCmp += amt;
      } else {
        currentTaxCmp += amt;
      }
    }
  } else {
    currentTaxCmp = taxExpenseCmp;
  }
  const profitForPeriodCmp = profitBeforeTaxCmp - currentTaxCmp - deferredTaxCmp;

  const profitFromLedger = sumPnlProfit(current);
  const profitFromLedgerCmp = sumPnlProfit(comparative);
  const allDebit = current.reduce((sum, row) => sum + row.periodDebit, 0n);
  const allCredit = current.reduce((sum, row) => sum + row.periodCredit, 0n);

  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'PROFIT_TIES_TO_LEDGER',
      labelEn: 'Profit agrees to the profit-and-loss ledger accounts',
      labelBn: 'মুনাফা লাভ-ক্ষতি খাতার হিসাবের সাথে মেলে',
      passed: profitForPeriod === profitFromLedger,
      differencePoisha: profitForPeriod - profitFromLedger,
      detailEn: 'The presentation total is compared with the sum of every posted revenue and expense account.',
      detailBn: 'উপস্থাপিত মোট প্রতিটি পোস্টকৃত রাজস্ব ও ব্যয় হিসাবের যোগফলের সাথে তুলনা করা হয়েছে।',
    }),
    checkDto({
      key: 'PERIOD_TRIAL_BALANCE',
      labelEn: 'Posted debits equal credits in the report range',
      labelBn: 'রিপোর্ট পরিসরে পোস্টকৃত ডেবিট ও ক্রেডিট সমান',
      passed: allDebit === allCredit,
      differencePoisha: allDebit - allCredit,
      detailEn: 'A report may not be exported if the underlying posted journal range is not balanced.',
      detailBn: 'অন্তর্নিহিত পোস্টকৃত জার্নাল পরিসর অসামঞ্জস্য হলে রিপোর্ট রপ্তানি করা যাবে না।',
    }),
    checkDto({
      key: 'COMPARATIVE_PROFIT_TIES_TO_LEDGER',
      labelEn: 'Comparative profit agrees to the comparative ledger accounts',
      labelBn: 'তুলনামূলক মুনাফা তুলনামূলক খাতার হিসাবের সাথে মেলে',
      passed: comparative.length === 0 || profitForPeriodCmp === profitFromLedgerCmp,
      differencePoisha: profitForPeriodCmp - profitFromLedgerCmp,
      detailEn: 'The comparative column is proved against the same posted-account calculation as the current column.',
      detailBn: 'তুলনামূলক কলাম বর্তমান কলামের মতো একই পোস্টকৃত-হিসাব গণনার বিপরীতে প্রমাণিত।',
    }),
    checkDto({
      key: 'COMPARATIVE_AVAILABLE',
      labelEn: 'Comparative period available',
      labelBn: 'তুলনামূলক সময়কাল উপলব্ধ',
      passed: Boolean(resolved.comparativeFrom && resolved.comparativeTo),
      detailEn: resolved.scope.comparativeLabelEn
        ? `Comparative: ${resolved.scope.comparativeLabelEn}.`
        : 'No comparative period is configured; current-period figures are still valid.',
      detailBn: resolved.scope.comparativeLabelBn
        ? `তুলনামূলক: ${resolved.scope.comparativeLabelBn}।`
        : 'কোনো তুলনামূলক সময়কাল কনফিগার করা নেই; চলতি সময়কালের সংখ্যা তবুও বৈধ।',
      blocksExport: false,
    }),
  ];

  return {
    reportKey: 'PROFIT_AND_LOSS',
    titleEn: `Statement of profit or loss ${resolved.scope.labelEn}`,
    titleBn: `মুনাফা বা ক্ষতির বিবরণী ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.profitAndLoss.reviewStatus,
    template: REPORT_TEMPLATES.profitAndLoss,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    sections,
    totals: {
      revenuePoisha: revenue.toString(),
      costOfSalesPoisha: costOfSales.toString(),
      grossProfitPoisha: grossProfit.toString(),
      operatingExpensesPoisha: operatingExpenses.toString(),
      operatingProfitPoisha: operatingProfit.toString(),
      investingIncomePoisha: investingIncome.toString(),
      financeCostsPoisha: financeCosts.toString(),
      profitBeforeTaxPoisha: profitBeforeTax.toString(),
      taxExpensePoisha: taxExpense.toString(),
      profitForPeriodPoisha: profitForPeriod.toString(),
      revenueComparativePoisha: revenueCmp.toString(),
      costOfSalesComparativePoisha: costOfSalesCmp.toString(),
      grossProfitComparativePoisha: grossProfitCmp.toString(),
      operatingExpensesComparativePoisha: operatingExpensesCmp.toString(),
      operatingProfitComparativePoisha: operatingProfitCmp.toString(),
      investingIncomeComparativePoisha: investingIncomeCmp.toString(),
      financeCostsComparativePoisha: financeCostsCmp.toString(),
      profitBeforeTaxComparativePoisha: profitBeforeTaxCmp.toString(),
      taxExpenseComparativePoisha: (currentTaxCmp + deferredTaxCmp).toString(),
      profitForPeriodComparativePoisha: profitForPeriodCmp.toString(),
      // Mandatory IFRS 18 Subtotals:
      netOperatingRevenuePoisha: revenue.toString(),
      cogsPoisha: costOfSales.toString(),
      investingNetPoisha: investingIncome.toString(),
      profitBeforeFinancingAndTaxPoisha: profitBeforeFinancingAndTax.toString(),
      financingCostPoisha: financeCosts.toString(),
      currentTaxPoisha: currentTax.toString(),
      deferredTaxPoisha: deferredTax.toString(),
      netProfitPoisha: profitForPeriod.toString(),
    },
  };
}

function balanceSheetSection(
  key: keyof typeof SECTION_TITLES,
  current: AccountBalanceRow[],
  comparative: Map<string, AccountBalanceRow>,
  match: (row: AccountBalanceRow) => boolean,
): ReportSectionDto {
  const lines: ReportLineDto[] = [];
  const currentMap = byId(current);
  const ids = new Set([...currentMap.keys(), ...comparative.keys()]);
  for (const id of ids) {
    const row = currentMap.get(id) ?? comparative.get(id)!;
    if (!match(row)) continue;
    const currentRow = currentMap.get(id);
    const compRow = comparative.get(id);
    const amount = currentRow ? normalAmount(currentRow.accountType, closingAmount(currentRow)) : 0n;
    const comp = compRow ? normalAmount(compRow.accountType, closingAmount(compRow)) : 0n;
    if (amount === 0n && comp === 0n) continue;
    lines.push(lineFromBalance(row, amount, comp));
  }
  lines.sort((left, right) => (left.accountCode ?? '').localeCompare(right.accountCode ?? ''));
  return buildSection(key, SECTION_TITLES[key], lines);
}

function unclosedProfit(rows: AccountBalanceRow[]): bigint {
  let total = 0n;
  for (const row of rows) {
    if (!PNL_SUBCATEGORIES.has(row.subCategory)) continue;
    total -= closingAmount(row);
  }
  return total;
}

export async function getBalanceSheetReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<BalanceSheetDto> {
  const resolved = await resolveAsOfScope(database, companyId, input);
  const asOf = resolved.asOf!;
  const current = await loadAccountBalances(
    database,
    companyId,
    asOf,
    asOf,
    resolved.scope.branchId,
    resolved.scope.branchScope,
  );
  const comparativeAsOf = resolved.comparativeAsOf;
  const comparative = comparativeAsOf
    ? await loadAccountBalances(
        database,
        companyId,
        comparativeAsOf,
        comparativeAsOf,
        resolved.scope.branchId,
        resolved.scope.branchScope,
      )
    : [];
  const comparativeMap = byId(comparative);
  const currentProfit = unclosedProfit(current);
  const comparativeProfit = unclosedProfit(comparative);

  const sections = [
    balanceSheetSection(
      'assetsNonCurrent',
      current,
      comparativeMap,
      (row) => row.accountType === 'ASSET' && row.subCategory === 'NON_CURRENT_ASSET',
    ),
    balanceSheetSection(
      'assetsCurrent',
      current,
      comparativeMap,
      (row) =>
        (row.accountType === 'ASSET' && row.subCategory === 'CURRENT_ASSET') ||
        ['1140', '1145', '1150'].includes(row.code),
    ),
    balanceSheetSection('equity', current, comparativeMap, (row) => row.accountType === 'EQUITY'),
    balanceSheetSection(
      'liabilitiesNonCurrent',
      current,
      comparativeMap,
      (row) => row.accountType === 'LIABILITY' && row.subCategory === 'NON_CURRENT_LIABILITY',
    ),
    balanceSheetSection(
      'liabilitiesCurrent',
      current,
      comparativeMap,
      (row) =>
        (row.accountType === 'LIABILITY' && row.subCategory === 'CURRENT_LIABILITY') ||
        ['2120', '2130', '2140', '2141', '2170'].includes(row.code),
    ),
  ];
  const equitySection = sections.find((section) => section.key === 'equity')!;
  if (currentProfit !== 0n || comparativeProfit !== 0n) {
    equitySection.lines.push({
      accountId: null,
      accountCode: null,
      accountNameEn: 'Result for the period to date (unclosed)',
      accountNameBn: 'আজ পর্যন্ত সময়ের ফলাফল (বন্ধ হয়নি)',
      amountPoisha: currentProfit.toString(),
      comparativePoisha: comparativeProfit.toString(),
      kind: 'DERIVED',
      note: 'Profit and loss accounts have not been closed to equity; the balance is included so the statement can balance.',
    });
    equitySection.totalPoisha = (BigInt(equitySection.totalPoisha) + currentProfit).toString();
    equitySection.comparativeTotalPoisha = (
      BigInt(equitySection.comparativeTotalPoisha) + comparativeProfit
    ).toString();
  }

  const assetsNonCurrent = sumSection(sections, 'assetsNonCurrent');
  const assetsCurrent = sumSection(sections, 'assetsCurrent');
  const totalAssets = assetsNonCurrent + assetsCurrent;
  const equity = sumSection(sections, 'equity');
  const liabilitiesNonCurrent = sumSection(sections, 'liabilitiesNonCurrent');
  const liabilitiesCurrent = sumSection(sections, 'liabilitiesCurrent');
  const totalEquityAndLiabilities = equity + liabilitiesNonCurrent + liabilitiesCurrent;
  const imbalance = totalAssets - totalEquityAndLiabilities;

  const assetsNonCurrentCmp = sumSectionComparative(sections, 'assetsNonCurrent');
  const assetsCurrentCmp = sumSectionComparative(sections, 'assetsCurrent');
  const totalAssetsCmp = assetsNonCurrentCmp + assetsCurrentCmp;
  const equityCmp = sumSectionComparative(sections, 'equity');
  const liabilitiesNonCurrentCmp = sumSectionComparative(sections, 'liabilitiesNonCurrent');
  const liabilitiesCurrentCmp = sumSectionComparative(sections, 'liabilitiesCurrent');
  const totalEquityAndLiabilitiesCmp = equityCmp + liabilitiesNonCurrentCmp + liabilitiesCurrentCmp;

  const ledgerDifference = current.reduce((sum, row) => sum + closingAmount(row), 0n);
  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'BALANCE_SHEET_BALANCES',
      labelEn: 'Total assets equal total equity and liabilities',
      labelBn: 'মোট সম্পদ মোট ইকুইটি ও দায়ের সমান',
      passed: imbalance === 0n,
      differencePoisha: imbalance,
      detailEn: 'The statement is not plugged. A non-zero difference is shown and blocks export.',
      detailBn: 'বিবরণীতে কোনো প্লাগ নেই। অশূন্য পার্থক্য দেখানো হয় এবং রপ্তানি বন্ধ করে।',
    }),
    checkDto({
      key: 'LEDGER_BALANCES',
      labelEn: 'Posted ledger balances sum to zero',
      labelBn: 'পোস্টকৃত খাতার ব্যালেন্সের যোগফল শূন্য',
      passed: ledgerDifference === 0n,
      differencePoisha: ledgerDifference,
      detailEn:
        'Every account balance as of the report date is summed; a non-zero total means the ledger itself is broken.',
      detailBn: 'রিপোর্ট তারিখে প্রতিটি হিসাবের ব্যালেন্স যোগ করা হয়; অশূন্য মোট মানে খাতা নিজেই অসামঞ্জস্যপূর্ণ।',
    }),
    checkDto({
      key: 'COMPARATIVE_AVAILABLE',
      labelEn: 'Comparative date available',
      labelBn: 'তুলনামূলক তারিখ উপলব্ধ',
      passed: Boolean(comparativeAsOf),
      detailEn: comparativeAsOf
        ? `Comparative: as at ${formatReportDateEn(comparativeAsOf)}.`
        : 'No comparative date is configured.',
      detailBn: comparativeAsOf
        ? `তুলনামূলক: ${formatReportDateEn(comparativeAsOf)} তারিখে।`
        : 'কোনো তুলনামূলক তারিখ কনফিগার করা নেই।',
      blocksExport: false,
    }),
  ];

  return {
    reportKey: 'BALANCE_SHEET',
    titleEn: `Statement of financial position ${resolved.scope.labelEn}`,
    titleBn: `আর্থিক অবস্থানের বিবরণী ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.balanceSheet.reviewStatus,
    template: REPORT_TEMPLATES.balanceSheet,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    sections,
    totals: {
      assetsNonCurrentPoisha: assetsNonCurrent.toString(),
      assetsCurrentPoisha: assetsCurrent.toString(),
      totalAssetsPoisha: totalAssets.toString(),
      equityPoisha: equity.toString(),
      liabilitiesNonCurrentPoisha: liabilitiesNonCurrent.toString(),
      liabilitiesCurrentPoisha: liabilitiesCurrent.toString(),
      totalEquityAndLiabilitiesPoisha: totalEquityAndLiabilities.toString(),
      assetsNonCurrentComparativePoisha: assetsNonCurrentCmp.toString(),
      assetsCurrentComparativePoisha: assetsCurrentCmp.toString(),
      totalAssetsComparativePoisha: totalAssetsCmp.toString(),
      equityComparativePoisha: equityCmp.toString(),
      liabilitiesNonCurrentComparativePoisha: liabilitiesNonCurrentCmp.toString(),
      liabilitiesCurrentComparativePoisha: liabilitiesCurrentCmp.toString(),
      totalEquityAndLiabilitiesComparativePoisha: totalEquityAndLiabilitiesCmp.toString(),
      unclosedProfitPoisha: currentProfit.toString(),
      imbalancePoisha: imbalance.toString(),
      accountingEquationDeltaPoisha: imbalance.toString(),
    },
  };
}

interface CashAccountRow {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
}

async function loadCashAccounts(database: Queryable, companyId: string): Promise<CashAccountRow[]> {
  const result = await database.query<CashAccountRow>(
    `SELECT DISTINCT a.id, a.code, a.name_en, a.name_bn
       FROM accounts a
       LEFT JOIN bank_accounts b ON b.company_id = a.company_id AND b.gl_account_id = a.id
      WHERE a.company_id = $1
        AND (a.control_subledger = 'BANK_MFS' OR b.id IS NOT NULL)
      ORDER BY a.code ASC`,
    [companyId],
  );
  return result.rows;
}

interface CashMovementRow {
  journal_id: string;
  posting_date: Date;
  source_module: string;
  source_doc_ref: string | null;
  account_id: string;
  account_code: string;
  account_name_en: string;
  account_name_bn: string | null;
  account_type: string;
  sub_category: string;
  debit_poisha: string;
  credit_poisha: string;
  is_cash: boolean;
}

export interface CashFlowClassificationInput {
  journalId: string;
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountNameEn: string;
    accountNameBn: string | null;
    accountType: string;
    subCategory: string;
    debitPoisha: bigint;
    creditPoisha: bigint;
    isCash: boolean;
  }>;
}

export interface CashFlowClassificationLine {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  section: 'operating' | 'investing' | 'financing';
  amountPoisha: bigint;
}

export interface CashFlowClassification {
  lines: CashFlowClassificationLine[];
  cashEffectPoisha: bigint;
  classifiedPoisha: bigint;
  unclassifiedPoisha: bigint;
}

function cashFlowSection(accountType: string, subCategory: string): 'operating' | 'investing' | 'financing' {
  if (accountType === 'ASSET' && subCategory === 'NON_CURRENT_ASSET') return 'investing';
  if (accountType === 'LIABILITY' && subCategory === 'NON_CURRENT_LIABILITY') return 'financing';
  if (accountType === 'EQUITY') return 'financing';
  if (subCategory === 'FINANCE_COST') return 'financing';
  if (subCategory === 'INVESTING_INCOME') return 'investing';
  return 'operating';
}

/**
 * Pure classification helper. It is exported so a unit test can prove that a deliberately broken
 * movement set is detected rather than plugged. Each journal's cash effect is allocated to its
 * non-cash counterpart accounts; the classification total must equal the cash movement exactly.
 */
export function classifyCashFlowJournals(journals: readonly CashFlowClassificationInput[]): CashFlowClassification {
  const lines: CashFlowClassificationLine[] = [];
  let cashEffect = 0n;
  let classified = 0n;
  for (const journal of journals) {
    let journalCash = 0n;
    let journalClassified = 0n;
    for (const line of journal.lines) {
      if (line.isCash) {
        journalCash += line.debitPoisha - line.creditPoisha;
        continue;
      }
      const amount = -(line.debitPoisha - line.creditPoisha);
      journalClassified += amount;
      lines.push({
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountNameEn: line.accountNameEn,
        accountNameBn: line.accountNameBn,
        section: cashFlowSection(line.accountType, line.subCategory),
        amountPoisha: amount,
      });
    }
    cashEffect += journalCash;
    classified += journalClassified;
  }
  return {
    lines,
    cashEffectPoisha: cashEffect,
    classifiedPoisha: classified,
    unclassifiedPoisha: classified - cashEffect,
  };
}

async function cashBalance(
  database: Queryable,
  companyId: string,
  asOf: string,
  cashAccountIds: string[],
  branchId: string | null,
  branchScope: 'ALL' | 'UNASSIGNED' | 'BRANCH',
): Promise<bigint> {
  if (cashAccountIds.length === 0) return 0n;
  const values: unknown[] = [companyId, asOf, cashAccountIds];
  let branchFilter = '';
  if (branchScope === 'UNASSIGNED') {
    branchFilter = 'AND j.branch_id IS NULL';
  } else if (branchId) {
    values.push(branchId);
    branchFilter = `AND j.branch_id = $${values.length}`;
  }
  const result = await database.query<{ balance: string }>(
    `SELECT COALESCE(SUM(l.debit_poisha - l.credit_poisha), 0)::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND j.posting_date <= $2::date
        AND l.account_id = ANY($3::uuid[])
        AND j.status IN ('POSTED', 'REVERSED') ${branchFilter}`,
    values,
  );
  return BigInt(result.rows[0]?.balance ?? '0');
}

interface CashFlowSlice {
  sections: Record<
    'operating' | 'investing' | 'financing',
    Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>
  >;
  cashEffect: bigint;
  classified: bigint;
  unclassified: bigint;
  lineCount: number;
}

async function computeCashFlowSlice(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
  cashAccountIds: string[],
  branchId: string | null,
  branchScope: 'ALL' | 'UNASSIGNED' | 'BRANCH',
): Promise<CashFlowSlice> {
  const sections = {
    operating: new Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>(),
    investing: new Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>(),
    financing: new Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>(),
  };
  if (cashAccountIds.length === 0) {
    return { sections, cashEffect: 0n, classified: 0n, unclassified: 0n, lineCount: 0 };
  }
  const values: unknown[] = [companyId, from, to, cashAccountIds];
  let branchFilter = '';
  if (branchScope === 'UNASSIGNED') {
    branchFilter = 'AND j.branch_id IS NULL';
  } else if (branchId) {
    values.push(branchId);
    branchFilter = `AND j.branch_id = $${values.length}`;
  }
  const result = await database.query<CashMovementRow>(
    `WITH cash_journals AS (
       SELECT DISTINCT j.id
         FROM journals j
         JOIN journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        WHERE j.company_id = $1
          AND j.posting_date BETWEEN $2::date AND $3::date
          AND j.status IN ('POSTED', 'REVERSED')
          AND l.account_id = ANY($4::uuid[])
          ${branchFilter}
     )
     SELECT j.id AS journal_id, j.posting_date, j.source_module, j.source_doc_ref,
            l.account_id, a.code AS account_code, a.name_en AS account_name_en,
            a.name_bn AS account_name_bn, a.account_type, a.sub_category,
            l.debit_poisha::text AS debit_poisha, l.credit_poisha::text AS credit_poisha,
            (l.account_id = ANY($4::uuid[])) AS is_cash
       FROM cash_journals cj
       JOIN journals j ON j.company_id = $1 AND j.id = cj.id
       JOIN journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
       JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
      ORDER BY j.posting_date ASC, j.id ASC, l.line_no ASC`,
    values,
  );

  const grouped = new Map<string, CashFlowClassificationInput>();
  for (const row of result.rows) {
    const journal = grouped.get(row.journal_id) ?? { journalId: row.journal_id, lines: [] };
    journal.lines.push({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountNameEn: row.account_name_en,
      accountNameBn: row.account_name_bn,
      accountType: row.account_type,
      subCategory: row.sub_category,
      debitPoisha: BigInt(row.debit_poisha),
      creditPoisha: BigInt(row.credit_poisha),
      isCash: row.is_cash,
    });
    grouped.set(row.journal_id, journal);
  }

  const classification = classifyCashFlowJournals([...grouped.values()]);
  for (const line of classification.lines) {
    const bucket = sections[line.section];
    const existing = bucket.get(line.accountId) ?? {
      amount: 0n,
      nameEn: line.accountNameEn,
      nameBn: line.accountNameBn,
      code: line.accountCode,
    };
    existing.amount += line.amountPoisha;
    bucket.set(line.accountId, existing);
  }
  return {
    sections,
    cashEffect: classification.cashEffectPoisha,
    classified: classification.classifiedPoisha,
    unclassified: classification.unclassifiedPoisha,
    lineCount: classification.lines.length,
  };
}

function cashFlowSectionDto(
  key: 'operating' | 'investing' | 'financing',
  current: Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>,
  comparative: Map<string, { amount: bigint; nameEn: string; nameBn: string | null; code: string }>,
): ReportSectionDto {
  const ids = new Set([...current.keys(), ...comparative.keys()]);
  const lines: ReportLineDto[] = [];
  for (const id of ids) {
    const row = current.get(id) ?? comparative.get(id)!;
    const amount = current.get(id)?.amount ?? 0n;
    const comp = comparative.get(id)?.amount ?? 0n;
    if (amount === 0n && comp === 0n) continue;
    lines.push({
      accountId: id,
      accountCode: row.code,
      accountNameEn: row.nameEn,
      accountNameBn: row.nameBn,
      amountPoisha: amount.toString(),
      comparativePoisha: comp.toString(),
      kind: 'ACCOUNT',
      note: null,
      noteRef: resolveNoteRef(row.code),
    });
  }
  lines.sort((left, right) => (left.accountCode ?? '').localeCompare(right.accountCode ?? ''));
  return buildSection(key, SECTION_TITLES[key], lines);
}

export async function getCashFlowReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<CashFlowDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const cashAccounts = await loadCashAccounts(database, companyId);
  const cashIds = cashAccounts.map((account) => account.id);
  const current = await computeCashFlowSlice(
    database,
    companyId,
    from,
    to,
    cashIds,
    resolved.scope.branchId,
    resolved.scope.branchScope,
  );
  const comparative =
    resolved.comparativeFrom && resolved.comparativeTo
      ? await computeCashFlowSlice(
          database,
          companyId,
          resolved.comparativeFrom,
          resolved.comparativeTo,
          cashIds,
          resolved.scope.branchId,
          resolved.scope.branchScope,
        )
      : {
          sections: { operating: new Map(), investing: new Map(), financing: new Map() },
          cashEffect: 0n,
          classified: 0n,
          unclassified: 0n,
          lineCount: 0,
        };

  const sections = [
    cashFlowSectionDto('operating', current.sections.operating, comparative.sections.operating),
    cashFlowSectionDto('investing', current.sections.investing, comparative.sections.investing),
    cashFlowSectionDto('financing', current.sections.financing, comparative.sections.financing),
  ];
  const netChange = sections.reduce((sum, section) => sum + BigInt(section.totalPoisha), 0n);
  const netChangeCmp = sections.reduce((sum, section) => sum + BigInt(section.comparativeTotalPoisha), 0n);
  const openingCash = cashIds.length
    ? await cashBalance(
        database,
        companyId,
        addDaysForReport(from, -1),
        cashIds,
        resolved.scope.branchId,
        resolved.scope.branchScope,
      )
    : 0n;
  const closingCash = cashIds.length
    ? await cashBalance(database, companyId, to, cashIds, resolved.scope.branchId, resolved.scope.branchScope)
    : 0n;
  const comparativeOpening =
    cashIds.length && resolved.comparativeFrom
      ? await cashBalance(
          database,
          companyId,
          addDaysForReport(resolved.comparativeFrom, -1),
          cashIds,
          resolved.scope.branchId,
          resolved.scope.branchScope,
        )
      : 0n;
  const comparativeClosing =
    cashIds.length && resolved.comparativeTo
      ? await cashBalance(
          database,
          companyId,
          resolved.comparativeTo,
          cashIds,
          resolved.scope.branchId,
          resolved.scope.branchScope,
        )
      : 0n;

  const unclassified = current.unclassified;
  const cashDifference = openingCash + netChange - closingCash;

  let cashPaidForVdsAndVat = 0n;
  let cashPaidForTdsAndAit = 0n;
  for (const entry of current.sections.operating.values()) {
    if (['1140', '1145', '2120', '2130'].includes(entry.code)) {
      cashPaidForVdsAndVat += entry.amount;
    }
    if (['1150', '2140', '2141', '2170'].includes(entry.code)) {
      cashPaidForTdsAndAit += entry.amount;
    }
  }

  let pnlProfitBeforeTax = 0n;
  try {
    const pnl = await getProfitAndLossReport(database, companyId, input);
    pnlProfitBeforeTax = BigInt(pnl.totals.profitBeforeTaxPoisha);
  } catch {
    pnlProfitBeforeTax = 0n;
  }

  const operatingTotal = BigInt(sections[0]?.totalPoisha ?? '0');
  const cashGeneratedFromOps = operatingTotal - cashPaidForVdsAndVat - cashPaidForTdsAndAit;
  const workingCapitalDelta = cashGeneratedFromOps - pnlProfitBeforeTax;

  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'CASH_ACCOUNTS_CONFIGURED',
      labelEn: 'Cash and bank accounts are configured',
      labelBn: 'নগদ ও ব্যাংক হিসাব কনফিগার করা আছে',
      passed: cashIds.length > 0,
      detailEn: cashIds.length
        ? `${cashIds.length} cash/bank/MFS control account${cashIds.length === 1 ? '' : 's'} identified from the bank-account register and BANK_MFS control accounts.`
        : 'No bank account or BANK_MFS control account is configured. The cash-flow statement cannot be produced or exported.',
      detailBn: cashIds.length
        ? `ব্যাংক হিসাব রেজিস্টার ও BANK_MFS নিয়ন্ত্রণ হিসাব থেকে ${cashIds.length}টি নগদ/ব্যাংক/এমএফএস নিয়ন্ত্রণ হিসাব চিহ্নিত হয়েছে।`
        : 'কোনো ব্যাংক হিসাব বা BANK_MFS নিয়ন্ত্রণ হিসাব কনফিগার করা নেই। নগদ প্রবাহ বিবরণী তৈরি বা রপ্তানি করা যাবে না।',
    }),
    checkDto({
      key: 'CASH_FLOW_RECONCILES',
      labelEn: 'Opening cash plus net movement equals closing cash',
      labelBn: 'প্রারম্ভিক নগদ যোগ নিট পরিবর্তন সমান সমাপনী নগদ',
      passed: cashDifference === 0n,
      differencePoisha: cashDifference,
      detailEn: 'The statement is derived from posted cash journals and is never closed with a plug.',
      detailBn: 'বিবরণীটি পোস্টকৃত নগদ জার্নাল থেকে তৈরি এবং কখনো প্লাগ দিয়ে বন্ধ করা হয় না।',
    }),
    checkDto({
      key: 'CASH_FLOW_CLASSIFICATION',
      labelEn: 'Every cash movement is classified',
      labelBn: 'প্রতিটি নগদ চলাচল শ্রেণিবদ্ধ',
      passed: unclassified === 0n,
      differencePoisha: unclassified,
      detailEn:
        'Cash movements are allocated to operating, investing or financing counterpart accounts with no unexplained residual.',
      detailBn:
        'নগদ চলাচল পরিচালন, বিনিয়োগ বা অর্থায়ন প্রতিপক্ষ হিসাবে বরাদ্দ করা হয়; কোনো ব্যাখ্যাহীন অবশিষ্ট থাকে না।',
    }),
    checkDto({
      key: 'COMPARATIVE_AVAILABLE',
      labelEn: 'Comparative period available',
      labelBn: 'তুলনামূলক সময়কাল উপলব্ধ',
      passed: Boolean(resolved.comparativeFrom && resolved.comparativeTo),
      detailEn: resolved.scope.comparativeLabelEn
        ? `Comparative: ${resolved.scope.comparativeLabelEn}.`
        : 'No comparative period is configured.',
      detailBn: resolved.scope.comparativeLabelBn
        ? `তুলনামূলক: ${resolved.scope.comparativeLabelBn}।`
        : 'কোনো তুলনামূলক সময়কাল কনফিগার করা নেই।',
      blocksExport: false,
    }),
  ];

  return {
    reportKey: 'CASH_FLOW',
    titleEn: `Statement of cash flows (direct method) ${resolved.scope.labelEn}`,
    titleBn: `নগদ প্রবাহের বিবরণী (প্রত্যক্ষ পদ্ধতি) ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.cashFlow.reviewStatus,
    template: REPORT_TEMPLATES.cashFlow,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    method: 'DIRECT',
    sections,
    cashAccountIds: cashIds,
    cashAccountCodes: cashAccounts.map((account) => account.code),
    openingCashPoisha: openingCash.toString(),
    closingCashPoisha: closingCash.toString(),
    netChangePoisha: netChange.toString(),
    openingCashComparativePoisha: comparativeOpening.toString(),
    closingCashComparativePoisha: comparativeClosing.toString(),
    netChangeComparativePoisha: netChangeCmp.toString(),
    cashPaidForVdsAndVatPoisha: cashPaidForVdsAndVat.toString(),
    cashPaidForTdsAndAitPoisha: cashPaidForTdsAndAit.toString(),
    indirectMethod: {
      profitBeforeTaxPoisha: pnlProfitBeforeTax.toString(),
      adjustments: [],
      workingCapitalChanges: [
        {
          accountId: null,
          accountCode: 'WC_ADJ',
          accountNameEn: 'Working capital adjustments (trade receivables, payables, inventories)',
          accountNameBn: 'কার্যকরী মূলধনের সমন্বয়',
          amountPoisha: workingCapitalDelta.toString(),
          comparativePoisha: '0',
          kind: 'DERIVED',
          note: 'Reconciles PBT to operating cash flows',
          noteRef: null,
        },
      ],
      cashGeneratedFromOperationsPoisha: cashGeneratedFromOps.toString(),
      cashPaidForVdsAndVatPoisha: cashPaidForVdsAndVat.toString(),
      cashPaidForTdsAndAitPoisha: cashPaidForTdsAndAit.toString(),
      netCashFromOperatingActivitiesPoisha: operatingTotal.toString(),
    },
  };
}

function addDaysForReport(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface EquitySliceTotals {
  capitalOpening: bigint;
  capitalClosing: bigint;
  capitalMovement: bigint;
  reservesOpening: bigint;
  reservesClosing: bigint;
  reservesMovement: bigint;
  pnlOpening: bigint;
  pnlPeriod: bigint;
  pnlClosing: bigint;
  closingEntries: bigint;
  opening: bigint;
  owner: bigint;
  closing: bigint;
}

function equitySlice(rows: AccountBalanceRow[]): EquitySliceTotals {
  const equity = rows.filter((row) => row.accountType === 'EQUITY');
  const capital = equity.filter((row) => row.subCategory === 'EQUITY_CAPITAL');
  const reserves = equity.filter((row) => row.subCategory === 'EQUITY_RESERVES');
  const pnlOpening = rows.reduce(
    (sum, row) => sum + (PNL_SUBCATEGORIES.has(row.subCategory) ? -openingAmount(row) : 0n),
    0n,
  );
  const pnlPeriod = rows.reduce(
    (sum, row) => sum + (PNL_SUBCATEGORIES.has(row.subCategory) ? -periodAmount(row) : 0n),
    0n,
  );
  const pnlClosing = rows.reduce(
    (sum, row) => sum + (PNL_SUBCATEGORIES.has(row.subCategory) ? -closingAmount(row) : 0n),
    0n,
  );
  const capitalOpening = capital.reduce((sum, row) => sum + normalAmount(row.accountType, openingAmount(row)), 0n);
  const capitalMovement = capital.reduce((sum, row) => sum + normalAmount(row.accountType, periodAmount(row)), 0n);
  const capitalClosing = capital.reduce((sum, row) => sum + normalAmount(row.accountType, closingAmount(row)), 0n);
  const reservesOpening = reserves.reduce((sum, row) => sum + normalAmount(row.accountType, openingAmount(row)), 0n);
  const reservesMovement = reserves.reduce((sum, row) => sum + normalAmount(row.accountType, periodAmount(row)), 0n);
  const reservesClosing = reserves.reduce((sum, row) => sum + normalAmount(row.accountType, closingAmount(row)), 0n);
  const closingEntries = pnlClosing - pnlOpening - pnlPeriod;
  const opening = capitalOpening + reservesOpening + pnlOpening;
  // Closing entries move the unclosed P&L balance into equity. Adding the movement and the transfer
  // leaves the statement equation intact without double counting.
  const owner = capitalMovement + reservesMovement + closingEntries;
  const closing = opening + pnlPeriod + owner;
  return {
    capitalOpening,
    capitalClosing,
    capitalMovement,
    reservesOpening,
    reservesClosing,
    reservesMovement,
    pnlOpening,
    pnlPeriod,
    pnlClosing,
    closingEntries,
    opening,
    owner,
    closing,
  };
}

function equityRows(
  current: AccountBalanceRow[],
  comparative: AccountBalanceRow[],
): {
  rows: ChangesInEquityRowDto[];
  opening: bigint;
  profit: bigint;
  owner: bigint;
  closing: bigint;
  closingCmp: bigint;
} {
  const currentEquityMap = byId(current.filter((row) => row.accountType === 'EQUITY'));
  const comparativeEquity = byId(comparative.filter((row) => row.accountType === 'EQUITY'));
  const equityIds = new Set([...currentEquityMap.keys(), ...comparativeEquity.keys()]);
  const currentTotals = equitySlice(current);
  const comparativeTotals = equitySlice(comparative);

  const rows: ChangesInEquityRowDto[] = [
    {
      key: 'OPENING',
      labelEn: 'Balance at the beginning of the period',
      labelBn: 'সময়কালের শুরুতে ব্যালেন্স',
      shareCapitalPoisha: currentTotals.capitalOpening.toString(),
      retainedEarningsPoisha: currentTotals.pnlOpening.toString(),
      reservesPoisha: currentTotals.reservesOpening.toString(),
      totalPoisha: currentTotals.opening.toString(),
      comparativeTotalPoisha: comparativeTotals.opening.toString(),
      kind: 'OPENING',
      accountId: null,
    },
    {
      key: 'PROFIT',
      labelEn: 'Profit / (loss) for the period',
      labelBn: 'সময়কালের মুনাফা / (ক্ষতি)',
      shareCapitalPoisha: '0',
      retainedEarningsPoisha: currentTotals.pnlPeriod.toString(),
      reservesPoisha: '0',
      totalPoisha: currentTotals.pnlPeriod.toString(),
      comparativeTotalPoisha: comparativeTotals.pnlPeriod.toString(),
      kind: 'PROFIT',
      accountId: null,
    },
    {
      key: 'OWNER',
      labelEn: 'Owner transactions and other direct equity movements',
      labelBn: 'মালিকের লেনদেন ও অন্যান্য সরাসরি ইকুইটি চলাচল',
      shareCapitalPoisha: currentTotals.capitalMovement.toString(),
      retainedEarningsPoisha: '0',
      reservesPoisha: (currentTotals.reservesMovement + currentTotals.closingEntries).toString(),
      totalPoisha: currentTotals.owner.toString(),
      comparativeTotalPoisha: comparativeTotals.owner.toString(),
      kind: 'OWNER',
      accountId: null,
    },
    {
      key: 'CLOSING',
      labelEn: 'Balance at the end of the period',
      labelBn: 'সময়কালের শেষে ব্যালেন্স',
      shareCapitalPoisha: currentTotals.capitalClosing.toString(),
      retainedEarningsPoisha: currentTotals.pnlClosing.toString(),
      reservesPoisha: currentTotals.reservesClosing.toString(),
      totalPoisha: currentTotals.closing.toString(),
      comparativeTotalPoisha: comparativeTotals.closing.toString(),
      kind: 'CLOSING',
      accountId: null,
    },
  ];

  for (const id of equityIds) {
    const row = currentEquityMap.get(id) ?? comparativeEquity.get(id)!;
    const currentRow = currentEquityMap.get(id);
    const comp = comparativeEquity.get(id);
    rows.push({
      key: `EQUITY:${row.id}`,
      labelEn: `${row.code} — ${row.nameEn}`,
      labelBn: `${row.code} — ${row.nameBn ?? row.nameEn}`,
      shareCapitalPoisha: '0',
      retainedEarningsPoisha: '0',
      reservesPoisha: currentRow ? normalAmount(currentRow.accountType, periodAmount(currentRow)).toString() : '0',
      totalPoisha: currentRow ? normalAmount(currentRow.accountType, closingAmount(currentRow)).toString() : '0',
      comparativeTotalPoisha: comp ? normalAmount(comp.accountType, closingAmount(comp)).toString() : '0',
      kind: 'EQUITY_ACCOUNT',
      accountId: row.id,
    });
  }

  return {
    rows,
    opening: currentTotals.opening,
    profit: currentTotals.pnlPeriod,
    owner: currentTotals.owner,
    closing: currentTotals.closing,
    closingCmp: comparativeTotals.closing,
  };
}

export async function getChangesInEquityReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<ChangesInEquityDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const current = await loadAccountBalances(
    database,
    companyId,
    from,
    to,
    resolved.scope.branchId,
    resolved.scope.branchScope,
  );
  const comparative =
    resolved.comparativeFrom && resolved.comparativeTo
      ? await loadAccountBalances(
          database,
          companyId,
          resolved.comparativeFrom,
          resolved.comparativeTo,
          resolved.scope.branchId,
          resolved.scope.branchScope,
        )
      : [];
  const result = equityRows(current, comparative);

  const balanceSheet = await getBalanceSheetReport(database, companyId, {
    ...input,
    asOf: to,
    comparativeAsOf: resolved.comparativeTo,
  });
  const balanceSheetEquity = BigInt(balanceSheet.totals.equityPoisha);
  const check = checkDto({
    key: 'EQUITY_TIES_TO_BALANCE_SHEET',
    labelEn: 'Closing equity agrees to the balance sheet',
    labelBn: 'সমাপনী ইকুইটি ব্যালেন্স শিটের সাথে মেলে',
    passed: result.closing === balanceSheetEquity,
    differencePoisha: result.closing - balanceSheetEquity,
    detailEn: 'The roll-forward and the statement of financial position are derived from the same posted journals.',
    detailBn: 'রোল-ফরোয়ার্ড এবং আর্থিক অবস্থানের বিবরণী একই পোস্টকৃত জার্নাল থেকে তৈরি।',
  });
  const checks = [
    check,
    ...balanceSheet.checks.filter((entry) => entry.key === 'BALANCE_SHEET_BALANCES' || entry.key === 'LEDGER_BALANCES'),
  ];

  return {
    reportKey: 'CHANGES_IN_EQUITY',
    titleEn: `Statement of changes in equity ${resolved.scope.labelEn}`,
    titleBn: `ইকুইটির পরিবর্তনের বিবরণী ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.equity.reviewStatus,
    template: REPORT_TEMPLATES.equity,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    rows: result.rows,
    openingEquityPoisha: result.opening.toString(),
    profitForPeriodPoisha: result.profit.toString(),
    ownerMovementsPoisha: result.owner.toString(),
    closingEquityPoisha: result.closing.toString(),
    comparativeClosingEquityPoisha: result.closingCmp.toString(),
  };
}

export async function getTrialBalanceReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<TrialBalanceReportDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const trialBalance = await getTrialBalance(database, companyId, {
    periodId: input.periodId ?? null,
    from: resolved.from,
    to: resolved.to,
    branchId: resolved.scope.branchId,
    branchScope: resolved.scope.branchScope === 'BRANCH' ? 'ALL' : resolved.scope.branchScope,
  });
  const check = checkDto({
    key: 'TRIAL_BALANCE_BALANCES',
    labelEn: 'Total debits equal total credits',
    labelBn: 'মোট ডেবিট মোট ক্রেডিটের সমান',
    passed: trialBalance.balanced,
    differencePoisha: BigInt(trialBalance.totals.differencePoisha),
    detailEn: 'Opening, movement and closing columns are derived from posted journals, including linked reversals.',
    detailBn: 'প্রারম্ভিক, চলাচল ও সমাপনী কলাম পোস্টকৃত জার্নাল থেকে তৈরি, লিংকড রিভার্সালসহ।',
  });
  return {
    reportKey: 'TRIAL_BALANCE',
    titleEn: `Trial balance ${resolved.scope.labelEn}`,
    titleBn: `রেওয়ামিল ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.trialBalance.reviewStatus,
    template: REPORT_TEMPLATES.trialBalance,
    checks: [check],
    canExport: check.passed,
    generatedAt: reportGeneratedAt(),
    trialBalance,
    lineCount: trialBalance.rows.length,
  };
}

export async function getGeneralLedgerReport(
  database: Queryable,
  companyId: string,
  accountId: string,
  input: ReportScopeInput,
): Promise<GeneralLedgerReportDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const result = await getTrialBalanceAccount(database, companyId, accountId, {
    periodId: input.periodId ?? null,
    from: resolved.from,
    to: resolved.to,
    branchId: resolved.scope.branchId,
    branchScope: resolved.scope.branchScope === 'BRANCH' ? 'ALL' : resolved.scope.branchScope,
  });
  const check = checkDto({
    key: 'GL_DETAIL_PRESENT',
    labelEn: 'Ledger detail can be produced for the selected account',
    labelBn: 'নির্বাচিত হিসাবের খাতা বিবরণ তৈরি করা যায়',
    passed: true,
    detailEn: `${result.lines.length} journal line${result.lines.length === 1 ? '' : 's'} returned.`,
    detailBn: `${result.lines.length}টি জার্নাল লাইন ফেরত দেওয়া হয়েছে।`,
  });
  return {
    reportKey: 'GENERAL_LEDGER',
    titleEn: `General ledger detail ${resolved.scope.labelEn}`,
    titleBn: `সাধারণ খাতা বিবরণ ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.trialBalance.reviewStatus,
    template: REPORT_TEMPLATES.trialBalance,
    checks: [check],
    canExport: true,
    generatedAt: reportGeneratedAt(),
    accountId,
    accountCode: result.account.accountCode,
    accountNameEn: result.account.accountNameEn,
    accountNameBn: result.account.accountNameBn,
    openingNetPoisha: result.account.openingNetPoisha,
    closingNetPoisha: result.account.closingNetPoisha,
    lines: result.lines,
    lineCount: result.lines.length,
  };
}

export async function getJournalListingReport(
  database: Queryable,
  companyId: string,
  filters: JournalListFilters,
  input: ReportScopeInput,
): Promise<JournalListingDto> {
  const resolved = await resolveRangeScope(database, companyId, {
    ...input,
    from: filters.from ?? input.from,
    to: filters.to ?? input.to,
  });
  const listing = await listJournals(database, companyId, {
    ...filters,
    from: resolved.from ?? undefined,
    to: resolved.to ?? undefined,
    branchId: resolved.scope.branchId,
    branchScope: resolved.scope.branchScope === 'BRANCH' ? 'ALL' : resolved.scope.branchScope,
  });
  const check = checkDto({
    key: 'JOURNAL_LISTING_PRESENT',
    labelEn: 'Journal listing uses posted and reversed journals with their links',
    labelBn: 'জার্নাল তালিকা পোস্ট ও রিভার্সড জার্নাল তাদের লিংকসহ ব্যবহার করে',
    passed: true,
    detailEn: `${listing.total} journal${listing.total === 1 ? '' : 's'} matched the selected filters.`,
    detailBn: `${listing.total}টি জার্নাল নির্বাচিত ফিল্টারের সাথে মিলেছে।`,
  });
  return {
    reportKey: 'JOURNAL_LISTING',
    titleEn: `Journal listing ${resolved.scope.labelEn}`,
    titleBn: `জার্নাল তালিকা ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.journalListing.reviewStatus,
    template: REPORT_TEMPLATES.journalListing,
    checks: [check],
    canExport: true,
    generatedAt: reportGeneratedAt(),
    entries: listing.entries.map((entry) => ({
      id: entry.id,
      journalNumber: entry.journalNumber,
      postingDate: entry.postingDate,
      documentDate: entry.documentDate,
      periodCode: entry.periodCode,
      branchId: entry.branchId,
      branchCode: entry.branchCode,
      branchName: entry.branchName,
      sourceModule: entry.sourceModule,
      sourceDocId: entry.sourceDocId,
      sourceDocRef: entry.sourceDocRef,
      narrationEn: entry.narrationEn,
      status: entry.status,
      reversalOfJournalId: entry.reversalOfJournalId,
      reversedByJournalId: entry.reversedByJournalId,
      reversalJournalNumber: entry.reversalJournalNumber,
      originalJournalNumber: entry.originalJournalNumber,
      totalDebitPoisha: entry.totalDebitPoisha,
      totalCreditPoisha: entry.totalCreditPoisha,
      createdByName: entry.createdByName,
    })),
    total: listing.total,
    limit: listing.limit,
    offset: listing.offset,
  };
}
