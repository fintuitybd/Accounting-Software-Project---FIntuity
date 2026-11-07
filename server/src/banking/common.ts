import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';

export type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface BankingAuditContext {
  organisationId: string;
  companyId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export type BankLineStatus = 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CATEGORIZED' | 'EXCLUDED';
export type BankMatchType = 'EXACT' | 'PARTIAL' | 'MANUAL' | 'SPLIT';
export type BankStatementStatus = 'IMPORTED' | 'PARTIAL' | 'REJECTED';
export type BankGlRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REJECTED' | 'CANCELLED' | 'REVERSED';
export type BankFeeRuleStatus = 'ACTIVE' | 'INACTIVE';
export type BankTransferStatus = 'POSTED' | 'REVERSED';
export type BankReconciliationStatus = 'DRAFT' | 'PREPARED' | 'REVIEWED' | 'LOCKED';

export interface BankAccountRow {
  id: string;
  company_id: string;
  name: string;
  kind: 'BANK' | 'MFS' | 'CASH';
  provider: string | null;
  masked_number: string | null;
  branch: string | null;
  gl_account_id: string;
  gl_account_code: string;
  gl_account_name: string;
  status: string;
  is_principal: boolean;
}

export interface BankStatementLineRow {
  id: string;
  company_id: string;
  statement_id: string | null;
  bank_account_id: string;
  line_no: number;
  value_date: Date;
  description: string;
  reference: string | null;
  debit_poisha: string;
  credit_poisha: string;
  balance_poisha: string | null;
  status: string;
  fingerprint: string;
  match_score: number | null;
  match_reason: string | null;
  matched_journal_id: string | null;
  exception_owner_id: string | null;
  exception_owner_name: string | null;
  exception_note: string | null;
  excluded_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BankStatementLineDto {
  id: string;
  companyId: string;
  statementId: string | null;
  bankAccountId: string;
  lineNo: number;
  valueDate: string;
  description: string;
  reference: string | null;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  balancePoisha: string | null;
  balanceBdt: string | null;
  status: BankLineStatus;
  fingerprint: string;
  matchScore: number | null;
  matchReason: string | null;
  matchedJournalId: string | null;
  exceptionOwnerId: string | null;
  exceptionOwnerName: string | null;
  exceptionNote: string | null;
  excludedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const LINE_SELECT = `
  SELECT l.id, l.company_id, l.statement_id, l.bank_account_id, l.line_no, l.value_date,
         l.description, l.reference, l.debit_poisha::text AS debit_poisha,
         l.credit_poisha::text AS credit_poisha, l.balance_poisha::text AS balance_poisha,
         l.status, l.fingerprint, l.match_score, l.match_reason, l.matched_journal_id,
         l.exception_owner_id, u.name AS exception_owner_name, l.exception_note,
         l.excluded_reason, l.created_at, l.updated_at
    FROM bank_statement_lines l
    LEFT JOIN users u ON u.id = l.exception_owner_id
`;

export function mapBankStatementLine(row: BankStatementLineRow): BankStatementLineDto {
  return {
    id: row.id,
    companyId: row.company_id,
    statementId: row.statement_id,
    bankAccountId: row.bank_account_id,
    lineNo: row.line_no,
    valueDate: formatDatabaseDate(row.value_date),
    description: row.description,
    reference: row.reference,
    debitPoisha: row.debit_poisha,
    creditPoisha: row.credit_poisha,
    debitBdt: formatPoishaAsBdt(row.debit_poisha),
    creditBdt: formatPoishaAsBdt(row.credit_poisha),
    balancePoisha: row.balance_poisha,
    balanceBdt: row.balance_poisha === null ? null : formatPoishaAsBdt(row.balance_poisha),
    status: row.status as BankLineStatus,
    fingerprint: row.fingerprint,
    matchScore: row.match_score,
    matchReason: row.match_reason,
    matchedJournalId: row.matched_journal_id,
    exceptionOwnerId: row.exception_owner_id,
    exceptionOwnerName: row.exception_owner_name,
    exceptionNote: row.exception_note,
    excludedReason: row.excluded_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function loadBankAccount(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  options: { forUpdate?: boolean; requireActive?: boolean } = {},
): Promise<BankAccountRow> {
  const result = await database.query<BankAccountRow>(
    `SELECT b.id, b.company_id, b.name, b.kind, b.provider, b.masked_number, b.branch,
            b.gl_account_id, a.code AS gl_account_code, a.name_en AS gl_account_name,
            b.status, b.is_principal
       FROM bank_accounts b
       JOIN accounts a ON a.company_id = b.company_id AND a.id = b.gl_account_id
      WHERE b.company_id = $1 AND b.id = $2
      ${options.forUpdate ? 'FOR UPDATE OF b' : ''}`,
    [companyId, bankAccountId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank/cash account not found.');
  if (options.requireActive && row.status !== 'ACTIVE') {
    throw new AppError(409, 'BANK_ACCOUNT_INACTIVE', 'The bank/cash account is inactive.');
  }
  return row;
}

export async function loadBankStatementLine(
  database: Queryable,
  companyId: string,
  lineId: string,
  options: { forUpdate?: boolean } = {},
): Promise<BankStatementLineRow> {
  const result = await database.query<BankStatementLineRow>(
    `${LINE_SELECT}
      WHERE l.company_id = $1 AND l.id = $2
      ${options.forUpdate ? 'FOR UPDATE OF l' : ''}`,
    [companyId, lineId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_STATEMENT_LINE_NOT_FOUND', 'Statement line not found.');
  return row;
}

export interface PeriodRow {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  code: string;
  label: string;
  start_date: Date;
  end_date: Date;
  status: string;
}

export async function loadPeriodForDate(
  database: Queryable,
  companyId: string,
  date: string,
  options: { forUpdate?: boolean } = {},
): Promise<PeriodRow> {
  const result = await database.query<PeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status
       FROM periods
      WHERE company_id = $1 AND start_date <= $2::date AND end_date >= $2::date
      LIMIT 1
      ${options.forUpdate ? 'FOR UPDATE' : ''}`,
    [companyId, date],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(
      400,
      'PERIOD_NOT_FOUND',
      `No accounting period is configured for ${date}. Generate the fiscal year before importing or matching bank activity.`,
    );
  }
  return row;
}

export async function loadPeriodById(database: Queryable, companyId: string, periodId: string): Promise<PeriodRow> {
  const result = await database.query<PeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status
       FROM periods
      WHERE company_id = $1 AND id = $2`,
    [companyId, periodId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PERIOD_NOT_FOUND', 'Accounting period not found.');
  return row;
}

/**
 * A statement can only be imported into an OPEN period with no reviewed reconciliation. Importing
 * into a closed period would silently change a locked control total.
 */
export async function assertStatementImportAllowed(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  date: string,
): Promise<PeriodRow> {
  if (!isValidIsoDate(date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real statement date in YYYY-MM-DD format.');
  }
  const period = await loadPeriodForDate(database, companyId, date);
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'BANK_PERIOD_LOCKED',
      `Statement date ${date} falls in ${period.code}, which is ${period.status}. Reopen the period through the controlled period workflow before importing.`,
      { periodCode: period.code, periodStatus: period.status },
    );
  }
  const reconciliation = await database.query<{ status: string }>(
    `SELECT status FROM bank_reconciliations
      WHERE company_id = $1 AND bank_account_id = $2 AND period_id = $3`,
    [companyId, bankAccountId, period.id],
  );
  const status = reconciliation.rows[0]?.status;
  if (status === 'REVIEWED' || status === 'LOCKED') {
    throw new AppError(
      409,
      'BANK_RECONCILIATION_SIGNED_OFF',
      `The ${period.code} reconciliation is ${status}. New statement lines cannot be imported after sign-off.`,
      { periodCode: period.code, reconciliationStatus: status },
    );
  }
  return period;
}

export async function assertLineEditable(database: Queryable, line: BankStatementLineRow): Promise<PeriodRow> {
  const period = await loadPeriodForDate(database, line.company_id, formatDatabaseDate(line.value_date));
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'BANK_PERIOD_LOCKED',
      `Statement line ${line.id} belongs to ${period.code}, which is ${period.status}. The reconciliation can no longer be changed.`,
      { periodCode: period.code, periodStatus: period.status },
    );
  }
  const reconciliation = await database.query<{ status: string }>(
    `SELECT status FROM bank_reconciliations
      WHERE company_id = $1 AND bank_account_id = $2 AND period_id = $3`,
    [line.company_id, line.bank_account_id, period.id],
  );
  const status = reconciliation.rows[0]?.status;
  if (status === 'REVIEWED' || status === 'LOCKED') {
    throw new AppError(
      409,
      'BANK_RECONCILIATION_SIGNED_OFF',
      `The ${period.code} reconciliation is ${status}; matching and categorisation are frozen.`,
      { periodCode: period.code, reconciliationStatus: status },
    );
  }
  return period;
}

export function parseSignedBdtToPoisha(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const parsed = parseBdtToPoisha(unsigned);
  if (parsed === null) return null;
  return negative ? -parsed : parsed;
}

export function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normaliseReference(value: string | null | undefined): string {
  return normaliseText(value ?? '').replace(/[^a-z0-9]/g, '');
}

export function statementFingerprint(input: {
  date: string;
  description: string;
  reference: string | null;
  debitPoisha: bigint;
  creditPoisha: bigint;
  balancePoisha: bigint | null;
}): string {
  return [
    input.date,
    input.debitPoisha > 0n ? 'D' : 'C',
    input.debitPoisha > 0n ? input.debitPoisha.toString() : input.creditPoisha.toString(),
    normaliseReference(input.reference),
    normaliseText(input.description).slice(0, 160),
    input.balancePoisha === null ? '' : input.balancePoisha.toString(),
  ].join('|');
}

/** Integer half-up fee calculation: amount * rate_bps / 10,000 plus the fixed component. */
export function calculateFeePoisha(amountPoisha: bigint, rateBps: number, fixedPoisha: bigint): bigint {
  if (amountPoisha <= 0n) throw new AppError(400, 'BANK_FEE_AMOUNT_INVALID', 'The fee base must be positive.');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new AppError(400, 'BANK_FEE_RATE_INVALID', 'The fee rate must be between 0 and 100.00%.');
  }
  const variable = (amountPoisha * BigInt(rateBps) + 5_000n) / 10_000n;
  return variable + fixedPoisha;
}

export function dateDifferenceInDays(left: string, right: string): number {
  const first = Date.parse(`${left}T00:00:00Z`);
  const second = Date.parse(`${right}T00:00:00Z`);
  return Math.round(Math.abs(first - second) / 86_400_000);
}

export function isoDateFromDatabase(value: Date): string {
  return formatDatabaseDate(value);
}
