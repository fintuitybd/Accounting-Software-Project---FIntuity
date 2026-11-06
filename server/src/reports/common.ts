import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import type { ReportCheckDto, ReportScopeDto } from './types.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface ReportScopeInput {
  branchId?: string | null;
  periodId?: string | null;
  from?: string | null;
  to?: string | null;
  asOf?: string | null;
  comparativePeriodId?: string | null;
  comparativeFrom?: string | null;
  comparativeTo?: string | null;
  comparativeAsOf?: string | null;
}

interface CompanyRow {
  id: string;
  legal_name: string;
  bin: string | null;
}

interface PeriodRow {
  id: string;
  code: string;
  label: string;
  start_date: Date;
  end_date: Date;
  status: string;
  fiscal_year_id: string;
}

interface FiscalYearRow {
  id: string;
  label: string;
  start_date: Date;
  end_date: Date;
  status: string;
}

interface BranchRow {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_principal: boolean;
  status: string;
}

const EN_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const BN_DATE = new Intl.DateTimeFormat('bn-BD', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatReportDateEn(value: string): string {
  return EN_DATE.format(new Date(`${value}T00:00:00.000Z`));
}

export function formatReportDateBn(value: string): string {
  return BN_DATE.format(new Date(`${value}T00:00:00.000Z`));
}

function iso(value: string | Date): string {
  return typeof value === 'string' ? value : formatDatabaseDate(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isFirstOfMonth(value: string): boolean {
  return isValidIsoDate(value) && value.endsWith('-01');
}

export function isLastOfMonth(value: string): boolean {
  if (!isValidIsoDate(value)) return false;
  const [year, month] = value.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(year, month, 0));
  return end.getUTCDate() === Number(value.slice(8, 10));
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number): string {
  const date = dateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from: string, to: string): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000) + 1;
}

export function rangeLabel(
  from: string,
  to: string,
  fiscalYear?: { startDate: string; endDate: string } | null,
): {
  en: string;
  bn: string;
} {
  if (isFirstOfMonth(from) && isLastOfMonth(to) && from.slice(0, 7) === to.slice(0, 7)) {
    return {
      en: `for the month ended ${formatReportDateEn(to)}`,
      bn: `মাস শেষে ${formatReportDateBn(to)}`,
    };
  }
  if (fiscalYear && fiscalYear.startDate === from && fiscalYear.endDate === to) {
    return {
      en: `for the year ended ${formatReportDateEn(to)}`,
      bn: `বছর শেষে ${formatReportDateBn(to)}`,
    };
  }
  return {
    en: `for the period ${formatReportDateEn(from)} to ${formatReportDateEn(to)}`,
    bn: `${formatReportDateBn(from)} থেকে ${formatReportDateBn(to)} পর্যন্ত সময়ের জন্য`,
  };
}

export function asOfLabel(asOf: string): { en: string; bn: string } {
  return {
    en: `as at ${formatReportDateEn(asOf)}`,
    bn: `${formatReportDateBn(asOf)} তারিখে`,
  };
}

export async function loadCompany(database: Queryable, companyId: string): Promise<CompanyRow> {
  const result = await database.query<CompanyRow>(`SELECT id, legal_name, bin FROM companies WHERE id = $1`, [
    companyId,
  ]);
  const company = result.rows[0];
  if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return company;
}

export async function loadBranch(database: Queryable, companyId: string, branchId: string): Promise<BranchRow> {
  const result = await database.query<BranchRow>(
    `SELECT id, code, name_en, name_bn, is_principal, status
       FROM branches WHERE company_id = $1 AND id = $2`,
    [companyId, branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new AppError(404, 'REPORT_BRANCH_NOT_FOUND', 'Reporting branch not found.');
  return branch;
}

export async function loadPeriod(database: Queryable, companyId: string, periodId: string): Promise<PeriodRow> {
  const result = await database.query<PeriodRow>(
    `SELECT id, code, label, start_date, end_date, status, fiscal_year_id
       FROM periods WHERE company_id = $1 AND id = $2`,
    [companyId, periodId],
  );
  const period = result.rows[0];
  if (!period) throw new AppError(404, 'REPORT_PERIOD_NOT_FOUND', 'Accounting period not found.');
  return period;
}

export async function loadFiscalYear(
  database: Queryable,
  companyId: string,
  fiscalYearId: string,
): Promise<FiscalYearRow | null> {
  const result = await database.query<FiscalYearRow>(
    `SELECT id, label, start_date, end_date, status
       FROM fiscal_years WHERE company_id = $1 AND id = $2`,
    [companyId, fiscalYearId],
  );
  return result.rows[0] ?? null;
}

async function loadFiscalYearContaining(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
): Promise<{ startDate: string; endDate: string } | null> {
  const result = await database.query<{ start_date: Date; end_date: Date }>(
    `SELECT start_date, end_date FROM fiscal_years
      WHERE company_id = $1 AND start_date <= $2::date AND end_date >= $3::date
      ORDER BY start_date DESC LIMIT 1`,
    [companyId, from, to],
  );
  const row = result.rows[0];
  return row ? { startDate: iso(row.start_date), endDate: iso(row.end_date) } : null;
}

async function previousPeriod(database: Queryable, companyId: string, currentStart: string): Promise<PeriodRow | null> {
  const result = await database.query<PeriodRow>(
    `SELECT id, code, label, start_date, end_date, status, fiscal_year_id
       FROM periods
      WHERE company_id = $1 AND start_date < $2::date
      ORDER BY start_date DESC LIMIT 1`,
    [companyId, currentStart],
  );
  return result.rows[0] ?? null;
}

export interface ResolvedReportScope {
  scope: ReportScopeDto;
  company: CompanyRow;
  branch: BranchRow | null;
  period: PeriodRow | null;
  from: string | null;
  to: string | null;
  asOf: string | null;
  comparativeFrom: string | null;
  comparativeTo: string | null;
  comparativeAsOf: string | null;
}

function assertRange(from: string, to: string): void {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new AppError(400, 'REPORT_DATE_INVALID', 'Choose a real report date in YYYY-MM-DD format.');
  }
  if (from > to) {
    throw new AppError(400, 'REPORT_DATE_RANGE_INVALID', 'The report start date must not be after the end date.');
  }
}

async function resolveBranchScope(
  database: Queryable,
  companyId: string,
  branchId: string | null | undefined,
): Promise<{ branch: BranchRow | null; branchScope: 'ALL' | 'UNASSIGNED' | 'BRANCH' }> {
  if (!branchId) return { branch: null, branchScope: 'ALL' };
  if (branchId === 'UNASSIGNED') return { branch: null, branchScope: 'UNASSIGNED' };
  const branch = await loadBranch(database, companyId, branchId);
  return { branch, branchScope: 'BRANCH' };
}

export async function resolveRangeScope(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<ResolvedReportScope> {
  const company = await loadCompany(database, companyId);
  const { branch, branchScope } = await resolveBranchScope(database, companyId, input.branchId);
  const period = input.periodId ? await loadPeriod(database, companyId, input.periodId) : null;
  const from = period ? iso(period.start_date) : (input.from ?? null);
  const to = period ? iso(period.end_date) : (input.to ?? null);
  if (!from || !to) {
    throw new AppError(400, 'REPORT_RANGE_REQUIRED', 'Choose an accounting period or a from/to date range.');
  }
  assertRange(from, to);

  const fiscalYear = period ? await loadFiscalYear(database, companyId, period.fiscal_year_id) : null;
  const fiscalRange = fiscalYear
    ? { startDate: iso(fiscalYear.start_date), endDate: iso(fiscalYear.end_date) }
    : await loadFiscalYearContaining(database, companyId, from, to);

  let comparativeFrom: string | null = null;
  let comparativeTo: string | null = null;
  let comparativePeriod: PeriodRow | null = null;
  if (input.comparativePeriodId) {
    comparativePeriod = await loadPeriod(database, companyId, input.comparativePeriodId);
    comparativeFrom = iso(comparativePeriod.start_date);
    comparativeTo = iso(comparativePeriod.end_date);
  } else if (input.comparativeFrom || input.comparativeTo) {
    if (!input.comparativeFrom || !input.comparativeTo) {
      throw new AppError(
        400,
        'REPORT_COMPARATIVE_INVALID',
        'Provide both comparativeFrom and comparativeTo, or neither.',
      );
    }
    comparativeFrom = input.comparativeFrom;
    comparativeTo = input.comparativeTo;
    assertRange(comparativeFrom, comparativeTo);
  } else if (period) {
    comparativePeriod = await previousPeriod(database, companyId, from);
    if (comparativePeriod) {
      comparativeFrom = iso(comparativePeriod.start_date);
      comparativeTo = iso(comparativePeriod.end_date);
    }
  } else {
    // A custom range has no natural prior period. Use the immediately preceding range of the same
    // length and make it explicit in the label; the caller can always override it.
    const length = daysInclusive(from, to);
    comparativeTo = addDays(from, -1);
    comparativeFrom = addDays(comparativeTo, -(length - 1));
  }

  const label = rangeLabel(from, to, fiscalRange);
  const comparativeLabel =
    comparativeFrom && comparativeTo
      ? rangeLabel(
          comparativeFrom,
          comparativeTo,
          comparativePeriod
            ? await loadFiscalYear(database, companyId, comparativePeriod.fiscal_year_id).then((row) =>
                row ? { startDate: iso(row.start_date), endDate: iso(row.end_date) } : null,
              )
            : await loadFiscalYearContaining(database, companyId, comparativeFrom, comparativeTo),
        )
      : null;

  return {
    scope: {
      companyId: company.id,
      companyName: company.legal_name,
      companyBin: company.bin,
      branchId: branch?.id ?? null,
      branchCode: branch?.code ?? null,
      branchName: branch?.name_en ?? null,
      branchScope,
      periodId: period?.id ?? null,
      periodCode: period?.code ?? null,
      from,
      to,
      asOf: to,
      comparativeFrom,
      comparativeTo,
      comparativeAsOf: comparativeTo,
      labelEn: label.en,
      labelBn: label.bn,
      comparativeLabelEn: comparativeLabel?.en ?? null,
      comparativeLabelBn: comparativeLabel?.bn ?? null,
    },
    company,
    branch,
    period,
    from,
    to,
    asOf: to,
    comparativeFrom,
    comparativeTo,
    comparativeAsOf: comparativeTo,
  };
}

export async function resolveAsOfScope(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<ResolvedReportScope> {
  const company = await loadCompany(database, companyId);
  const { branch, branchScope } = await resolveBranchScope(database, companyId, input.branchId);
  const period = input.periodId ? await loadPeriod(database, companyId, input.periodId) : null;
  const asOf = input.asOf ?? (period ? iso(period.end_date) : null);
  if (!asOf || !isValidIsoDate(asOf)) {
    throw new AppError(400, 'REPORT_AS_OF_REQUIRED', 'Choose a real as-of date or an accounting period.');
  }

  let comparativeAsOf: string | null = null;
  if (input.comparativeAsOf) {
    if (!isValidIsoDate(input.comparativeAsOf)) {
      throw new AppError(400, 'REPORT_COMPARATIVE_INVALID', 'Choose a real comparative as-of date.');
    }
    comparativeAsOf = input.comparativeAsOf;
  } else if (input.comparativePeriodId) {
    const comparativePeriod = await loadPeriod(database, companyId, input.comparativePeriodId);
    comparativeAsOf = iso(comparativePeriod.end_date);
  } else if (period) {
    const comparativePeriod = await previousPeriod(database, companyId, iso(period.start_date));
    if (comparativePeriod) comparativeAsOf = iso(comparativePeriod.end_date);
  } else {
    comparativeAsOf = addDays(asOf, -1);
  }

  const label = asOfLabel(asOf);
  const comparativeLabel = comparativeAsOf ? asOfLabel(comparativeAsOf) : null;
  return {
    scope: {
      companyId: company.id,
      companyName: company.legal_name,
      companyBin: company.bin,
      branchId: branch?.id ?? null,
      branchCode: branch?.code ?? null,
      branchName: branch?.name_en ?? null,
      branchScope,
      periodId: period?.id ?? null,
      periodCode: period?.code ?? null,
      from: null,
      to: null,
      asOf,
      comparativeFrom: null,
      comparativeTo: null,
      comparativeAsOf,
      labelEn: label.en,
      labelBn: label.bn,
      comparativeLabelEn: comparativeLabel?.en ?? null,
      comparativeLabelBn: comparativeLabel?.bn ?? null,
    },
    company,
    branch,
    period,
    from: null,
    to: null,
    asOf,
    comparativeFrom: null,
    comparativeTo: null,
    comparativeAsOf,
  };
}

export interface AccountBalanceRow {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountType: string;
  subCategory: string;
  controlSubledger: string;
  openingDebit: bigint;
  openingCredit: bigint;
  periodDebit: bigint;
  periodCredit: bigint;
  closingDebit: bigint;
  closingCredit: bigint;
}

interface AccountBalanceQueryRow {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  account_type: string;
  sub_category: string;
  control_subledger: string;
  opening_debit: string;
  opening_credit: string;
  period_debit: string;
  period_credit: string;
  closing_debit: string;
  closing_credit: string;
}

/**
 * Opening / movement / closing balances from posted journals only. Reversed originals remain in
 * the ledger (status REVERSED) and their linked reversal is POSTED, so the pair nets to zero without
 * deleting audit history.
 */
export async function loadAccountBalances(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
  branchId: string | null,
  branchScope: 'ALL' | 'UNASSIGNED' | 'BRANCH',
  accountId?: string,
): Promise<AccountBalanceRow[]> {
  assertRange(from, to);
  const values: unknown[] = [companyId, from, to];
  let accountFilter = '';
  if (accountId) {
    values.push(accountId);
    accountFilter = `AND a.id = $${values.length}`;
  }
  let branchFilter = '';
  if (branchScope === 'UNASSIGNED') {
    branchFilter = 'AND j.branch_id IS NULL';
  } else if (branchId) {
    values.push(branchId);
    branchFilter = `AND j.branch_id = $${values.length}`;
  }
  const result = await database.query<AccountBalanceQueryRow>(
    `SELECT a.id, a.code, a.name_en, a.name_bn, a.account_type, a.sub_category, a.control_subledger,
            COALESCE(SUM(CASE WHEN m.posting_date < $2::date THEN m.debit_poisha ELSE 0 END), 0)::text AS opening_debit,
            COALESCE(SUM(CASE WHEN m.posting_date < $2::date THEN m.credit_poisha ELSE 0 END), 0)::text AS opening_credit,
            COALESCE(SUM(CASE WHEN m.posting_date >= $2::date AND m.posting_date <= $3::date THEN m.debit_poisha ELSE 0 END), 0)::text AS period_debit,
            COALESCE(SUM(CASE WHEN m.posting_date >= $2::date AND m.posting_date <= $3::date THEN m.credit_poisha ELSE 0 END), 0)::text AS period_credit,
            COALESCE(SUM(CASE WHEN m.posting_date <= $3::date THEN m.debit_poisha ELSE 0 END), 0)::text AS closing_debit,
            COALESCE(SUM(CASE WHEN m.posting_date <= $3::date THEN m.credit_poisha ELSE 0 END), 0)::text AS closing_credit
       FROM accounts a
       LEFT JOIN (
         SELECT l.company_id, l.account_id, l.debit_poisha, l.credit_poisha, j.posting_date
           FROM journal_lines l
           JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
          WHERE l.company_id = $1 AND j.status IN ('POSTED', 'REVERSED') ${branchFilter}
       ) m ON m.company_id = a.company_id AND m.account_id = a.id
      WHERE a.company_id = $1 ${accountFilter}
      GROUP BY a.id, a.code, a.name_en, a.name_bn, a.account_type, a.sub_category, a.control_subledger
      ORDER BY a.code ASC`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    accountType: row.account_type,
    subCategory: row.sub_category,
    controlSubledger: row.control_subledger,
    openingDebit: BigInt(row.opening_debit),
    openingCredit: BigInt(row.opening_credit),
    periodDebit: BigInt(row.period_debit),
    periodCredit: BigInt(row.period_credit),
    closingDebit: BigInt(row.closing_debit),
    closingCredit: BigInt(row.closing_credit),
  }));
}

export function normalAmount(accountType: string, debitPositive: bigint): bigint {
  return accountType === 'ASSET' || accountType === 'EXPENSE' ? debitPositive : -debitPositive;
}

export function periodAmount(row: AccountBalanceRow): bigint {
  return row.periodDebit - row.periodCredit;
}

export function closingAmount(row: AccountBalanceRow): bigint {
  return row.closingDebit - row.closingCredit;
}

export function openingAmount(row: AccountBalanceRow): bigint {
  return row.openingDebit - row.openingCredit;
}

export function checkDto(input: {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  differencePoisha?: bigint | null;
  detailEn: string;
  detailBn: string;
  blocksExport?: boolean;
}): ReportCheckDto {
  return {
    key: input.key,
    labelEn: input.labelEn,
    labelBn: input.labelBn,
    passed: input.passed,
    blocksExport: input.blocksExport ?? true,
    differencePoisha:
      input.differencePoisha === undefined || input.differencePoisha === null
        ? null
        : input.differencePoisha.toString(),
    detailEn: input.detailEn,
    detailBn: input.detailBn,
  };
}

export function describeDifference(difference: bigint): string {
  return difference === 0n ? '0.00' : formatPoishaAsBdt(difference);
}

export function ensurePeriodInsideFiscalYear(
  from: string,
  to: string,
  fiscalYear: { startDate: string; endDate: string } | null,
): boolean {
  if (!fiscalYear) return true;
  return from >= fiscalYear.startDate && to <= fiscalYear.endDate;
}

export function reportGeneratedAt(): string {
  return new Date().toISOString();
}

export function today(): string {
  return todayIso();
}
