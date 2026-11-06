import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { parseCsv } from '../company/csv.ts';
import {
  assertStatementImportAllowed,
  loadBankAccount,
  loadPeriodForDate,
  mapBankStatementLine,
  parseSignedBdtToPoisha,
  statementFingerprint,
  type BankStatementLineDto,
  type BankStatementLineRow,
  type BankingAuditContext,
  type Queryable,
} from './common.ts';

export type BankStatementMapping = {
  date: string;
  description: string;
  reference?: string | null;
  debit: string;
  credit: string;
  balance?: string | null;
};

export interface BankStatementImportRowError {
  rowNumber: number;
  code: string;
  field: string;
  message: string;
}

export interface BankStatementPreviewRow {
  rowNumber: number;
  values: Record<string, string>;
  date: string | null;
  description: string | null;
  reference: string | null;
  debitPoisha: string | null;
  creditPoisha: string | null;
  balancePoisha: string | null;
  errors: BankStatementImportRowError[];
}

export interface BankStatementPreview {
  headers: string[];
  detectedMapping: Partial<BankStatementMapping>;
  mapping: BankStatementMapping;
  rows: BankStatementPreviewRow[];
  truncated: boolean;
  limits: { maxRows: number; maxBytes: number; previewRows: number };
  summary: {
    rowCount: number;
    validCount: number;
    errorCount: number;
    duplicateCount: number;
  };
}

export interface BankStatementDto {
  id: string;
  companyId: string;
  bankAccountId: string;
  status: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceFileHash: string;
  mapping: Record<string, string>;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  errorRows: BankStatementImportRowError[];
  idempotencyKeyUsed: boolean;
  importedBy: string;
  importedByName: string;
  importedAt: string;
}

interface BankStatementRow {
  id: string;
  company_id: string;
  bank_account_id: string;
  status: string;
  source_file_name: string;
  source_mime_type: string;
  source_file_hash: string;
  mapping_json: Record<string, string>;
  row_count: number;
  valid_count: number;
  error_count: number;
  duplicate_count: number;
  error_rows_json: BankStatementImportRowError[];
  idempotency_key: string;
  imported_by: string;
  imported_by_name: string;
  imported_at: Date;
}

export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMPORT_ROWS = 5_000;
const PREVIEW_ROW_LIMIT = 500;
const MAX_ERROR_ROWS_STORED = 2_000;

const HEADER_ALIASES: Record<keyof BankStatementMapping, readonly string[]> = {
  date: ['date', 'valuedate', 'transactiondate', 'postingdate', 'trandate', 'valuedt'],
  description: ['description', 'narration', 'details', 'particulars', 'transactiondetails', 'remarks'],
  reference: ['reference', 'ref', 'referenceno', 'chequeno', 'instrumentno', 'transactionid', 'trxid'],
  debit: ['debit', 'deposit', 'amountin', 'creditamount', 'inflow', 'receipt'],
  credit: ['credit', 'withdrawal', 'amountout', 'debitamount', 'outflow', 'payment'],
  balance: ['balance', 'runningbalance', 'closingbalance', 'availablebalance'],
};

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findHeader(headers: readonly string[], aliases: readonly string[]): string | null {
  const byNormalised = new Map(headers.map((header) => [normaliseHeader(header), header]));
  for (const alias of aliases) {
    const found = byNormalised.get(alias);
    if (found) return found;
  }
  return null;
}

export function detectStatementMapping(headers: readonly string[]): Partial<BankStatementMapping> {
  const detected: Partial<BankStatementMapping> = {};
  for (const key of Object.keys(HEADER_ALIASES) as Array<keyof BankStatementMapping>) {
    const header = findHeader(headers, HEADER_ALIASES[key]);
    if (header) detected[key] = header;
  }
  return detected;
}

function resolveMapping(
  headers: readonly string[],
  requested: Partial<BankStatementMapping> | undefined,
): BankStatementMapping {
  const detected = detectStatementMapping(headers);
  const source = { ...detected, ...(requested ?? {}) };
  const headerSet = new Set(headers.map(normaliseHeader));
  const resolve = (value: string | null | undefined, field: string, required: boolean): string => {
    const text = value?.trim();
    if (!text) {
      if (required) {
        throw new AppError(400, 'BANK_STATEMENT_MAPPING_INCOMPLETE', `Map the ${field} column before importing.`, {
          field,
        });
      }
      return '';
    }
    if (!headerSet.has(normaliseHeader(text))) {
      throw new AppError(
        400,
        'BANK_STATEMENT_MAPPING_INVALID',
        `The mapped ${field} column "${text}" does not exist in the file header.`,
        { field, column: text },
      );
    }
    return text;
  };
  return {
    date: resolve(source.date, 'date', true),
    description: resolve(source.description, 'description', true),
    reference: resolve(source.reference, 'reference', false),
    debit: resolve(source.debit, 'debit/deposit', true),
    credit: resolve(source.credit, 'credit/withdrawal', true),
    balance: resolve(source.balance, 'balance', false),
  };
}

function normaliseContent(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function cleanAmount(value: string): string {
  return value
    .trim()
    .replace(/^(?:bdt|tk\.?|৳)\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '');
}

function parseStatementDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (isValidIsoDate(text)) return text;
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const ymdSlash = /^(\d{4})[/](\d{2})[/](\d{2})$/.exec(text);
  if (ymdSlash) {
    const iso = `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

interface ParsedRow {
  rowNumber: number;
  values: Record<string, string>;
  date: string | null;
  description: string | null;
  reference: string | null;
  debitPoisha: string | null;
  creditPoisha: string | null;
  balancePoisha: string | null;
  fingerprint: string | null;
  errors: BankStatementImportRowError[];
}

function error(rowNumber: number, field: string, code: string, message: string): BankStatementImportRowError {
  return { rowNumber, field, code, message };
}

function parseRows(content: string, mapping: BankStatementMapping): { headers: string[]; rows: ParsedRow[] } {
  const parsed = parseCsv(content);
  if (parsed.errors.length > 0) {
    throw new AppError(400, 'BANK_STATEMENT_CSV_INVALID', parsed.errors[0]!, { errors: parsed.errors });
  }
  if (parsed.rows.length === 0) {
    throw new AppError(400, 'BANK_STATEMENT_EMPTY', 'The statement file is empty.');
  }
  const headerRow = parsed.rows[0]!;
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    throw new AppError(400, 'BANK_STATEMENT_HEADER_INVALID', 'Every column in the header row must be named.');
  }
  const normalisedHeaders = headers.map(normaliseHeader);
  if (new Set(normalisedHeaders).size !== normalisedHeaders.length) {
    throw new AppError(
      400,
      'BANK_STATEMENT_HEADER_DUPLICATE',
      'The file has two columns with the same name after normalisation. Rename one column.',
    );
  }
  const headerIndex = new Map(normalisedHeaders.map((header, index) => [header, index]));
  const indexFor = (header: string): number => {
    const index = headerIndex.get(normaliseHeader(header));
    if (index === undefined) {
      throw new AppError(400, 'BANK_STATEMENT_MAPPING_INVALID', `Column ${header} was not found.`);
    }
    return index;
  };
  const indexes = {
    date: indexFor(mapping.date),
    description: indexFor(mapping.description),
    reference: mapping.reference ? indexFor(mapping.reference) : null,
    debit: indexFor(mapping.debit),
    credit: indexFor(mapping.credit),
    balance: mapping.balance ? indexFor(mapping.balance) : null,
  };

  const dataRows = parsed.rows.slice(1);
  if (dataRows.length === 0) {
    throw new AppError(400, 'BANK_STATEMENT_EMPTY', 'The statement file has a header but no data rows.');
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      400,
      'BANK_STATEMENT_TOO_MANY_ROWS',
      `A statement import may contain at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Split the file.`,
    );
  }

  const fingerprints = new Map<string, number>();
  const rows = dataRows.map((cells, index): ParsedRow => {
    const rowNumber = index + 2;
    const values: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      values[header] = cells[columnIndex]?.trim() ?? '';
    });
    const errors: BankStatementImportRowError[] = [];
    const rawDate = cells[indexes.date]?.trim() ?? '';
    const date = parseStatementDate(rawDate);
    if (!rawDate) {
      errors.push(error(rowNumber, 'date', 'BANK_STATEMENT_DATE_REQUIRED', 'Date is required.'));
    } else if (!date) {
      errors.push(
        error(
          rowNumber,
          'date',
          'BANK_STATEMENT_DATE_INVALID',
          'Use YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY. Dates must be real calendar dates.',
        ),
      );
    }
    const description = cells[indexes.description]?.trim() ?? '';
    if (!description) {
      errors.push(error(rowNumber, 'description', 'BANK_STATEMENT_DESCRIPTION_REQUIRED', 'Description is required.'));
    } else if (description.length > 500) {
      errors.push(
        error(
          rowNumber,
          'description',
          'BANK_STATEMENT_DESCRIPTION_TOO_LONG',
          'Description must be at most 500 characters.',
        ),
      );
    }
    const reference = indexes.reference === null ? null : cells[indexes.reference]?.trim() || null;
    if (reference && reference.length > 200) {
      errors.push(
        error(rowNumber, 'reference', 'BANK_STATEMENT_REFERENCE_TOO_LONG', 'Reference must be at most 200 characters.'),
      );
    }

    const rawDebit = indexes.debit === null ? '' : (cells[indexes.debit]?.trim() ?? '');
    const rawCredit = indexes.credit === null ? '' : (cells[indexes.credit]?.trim() ?? '');
    const debit = rawDebit ? parseSignedBdtToPoisha(cleanAmount(rawDebit)) : 0n;
    const credit = rawCredit ? parseSignedBdtToPoisha(cleanAmount(rawCredit)) : 0n;
    if (debit === null) {
      errors.push(
        error(
          rowNumber,
          'debit',
          'BANK_STATEMENT_AMOUNT_INVALID',
          'Debit/deposit must be a BDT amount with up to 2 decimals.',
        ),
      );
    } else if (debit < 0n) {
      errors.push(
        error(
          rowNumber,
          'debit',
          'BANK_STATEMENT_AMOUNT_INVALID',
          'Debit/deposit cannot be negative. Put outflows in the credit column.',
        ),
      );
    }
    if (credit === null) {
      errors.push(
        error(
          rowNumber,
          'credit',
          'BANK_STATEMENT_AMOUNT_INVALID',
          'Credit/withdrawal must be a BDT amount with up to 2 decimals.',
        ),
      );
    } else if (credit < 0n) {
      errors.push(
        error(
          rowNumber,
          'credit',
          'BANK_STATEMENT_AMOUNT_INVALID',
          'Credit/withdrawal cannot be negative. Put inflows in the debit column.',
        ),
      );
    }
    const debitValue = debit ?? 0n;
    const creditValue = credit ?? 0n;
    if (debit !== null && credit !== null && debitValue > 0n === creditValue > 0n) {
      errors.push(
        error(
          rowNumber,
          'amount',
          'BANK_STATEMENT_AMOUNT_SIDE_INVALID',
          'Enter exactly one positive amount: debit/deposit for money in, credit/withdrawal for money out.',
        ),
      );
    }

    const rawBalance = indexes.balance === null ? '' : (cells[indexes.balance]?.trim() ?? '');
    const balance = rawBalance ? parseSignedBdtToPoisha(cleanAmount(rawBalance)) : null;
    if (rawBalance && balance === null) {
      errors.push(
        error(
          rowNumber,
          'balance',
          'BANK_STATEMENT_BALANCE_INVALID',
          'Balance must be a BDT amount with up to 2 decimals.',
        ),
      );
    }

    const fingerprint =
      date && debit !== null && credit !== null && errors.length === 0
        ? statementFingerprint({
            date,
            description,
            reference,
            debitPoisha: debit,
            creditPoisha: credit,
            balancePoisha: balance,
          })
        : null;

    if (fingerprint) {
      const firstRow = fingerprints.get(fingerprint);
      if (firstRow !== undefined) {
        errors.push(
          error(
            rowNumber,
            'row',
            'BANK_STATEMENT_DUPLICATE_IN_FILE',
            `This row duplicates row ${firstRow} in the same file.`,
          ),
        );
      } else {
        fingerprints.set(fingerprint, rowNumber);
      }
    }

    return {
      rowNumber,
      values,
      date,
      description,
      reference,
      debitPoisha: debit === null ? null : debitValue.toString(),
      creditPoisha: credit === null ? null : creditValue.toString(),
      balancePoisha: balance === null ? null : balance.toString(),
      fingerprint,
      errors,
    };
  });

  return { headers, rows };
}

async function markDatabaseDuplicates(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  rows: ParsedRow[],
): Promise<void> {
  const fingerprints = rows.filter((row) => row.errors.length === 0 && row.fingerprint).map((row) => row.fingerprint!);
  if (fingerprints.length === 0) return;
  const existing = await database.query<{ fingerprint: string; line_no: number; statement_id: string }>(
    `SELECT fingerprint, line_no, statement_id
       FROM bank_statement_lines
      WHERE company_id = $1 AND bank_account_id = $2 AND fingerprint = ANY($3::text[])`,
    [companyId, bankAccountId, fingerprints],
  );
  const byFingerprint = new Map(existing.rows.map((row) => [row.fingerprint, row]));
  for (const row of rows) {
    if (row.errors.length > 0 || !row.fingerprint) continue;
    const duplicate = byFingerprint.get(row.fingerprint);
    if (duplicate) {
      row.errors.push(
        error(
          row.rowNumber,
          'row',
          'BANK_STATEMENT_DUPLICATE_EXISTING',
          `This row already exists in an imported statement (line ${duplicate.line_no}). Duplicate rows are not imported.`,
        ),
      );
    }
  }
}

async function markPeriodErrors(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  rows: ParsedRow[],
): Promise<void> {
  const dates = [...new Set(rows.filter((row) => row.date).map((row) => row.date!))];
  if (dates.length === 0) return;
  const periods = await database.query<{
    id: string;
    code: string;
    start_date: Date;
    end_date: Date;
    status: string;
  }>(
    `SELECT id, code, start_date, end_date, status
       FROM periods
      WHERE company_id = $1 AND start_date <= $3::date AND end_date >= $2::date
      ORDER BY start_date`,
    [
      companyId,
      dates.reduce((min, value) => (value < min ? value : min)),
      dates.reduce((max, value) => (value > max ? value : max)),
    ],
  );
  const reconciliations = await database.query<{ period_id: string; status: string }>(
    `SELECT period_id, status FROM bank_reconciliations
      WHERE company_id = $1 AND bank_account_id = $2`,
    [companyId, bankAccountId],
  );
  const reconciliationByPeriod = new Map(reconciliations.rows.map((row) => [row.period_id, row.status]));
  for (const row of rows) {
    if (row.errors.length > 0 || !row.date) continue;
    const period = periods.rows.find(
      (candidate) =>
        formatDatabaseDate(candidate.start_date) <= row.date! && formatDatabaseDate(candidate.end_date) >= row.date!,
    );
    if (!period) {
      row.errors.push(
        error(
          row.rowNumber,
          'date',
          'BANK_STATEMENT_PERIOD_NOT_FOUND',
          `No accounting period is configured for ${row.date}.`,
        ),
      );
      continue;
    }
    if (period.status !== 'OPEN') {
      row.errors.push(
        error(
          row.rowNumber,
          'date',
          'BANK_STATEMENT_PERIOD_LOCKED',
          `The date falls in ${period.code}, which is ${period.status}. Import is allowed only into an OPEN period.`,
        ),
      );
      continue;
    }
    const reconciliationStatus = reconciliationByPeriod.get(period.id);
    if (reconciliationStatus === 'REVIEWED' || reconciliationStatus === 'LOCKED') {
      row.errors.push(
        error(
          row.rowNumber,
          'date',
          'BANK_STATEMENT_RECONCILIATION_SIGNED_OFF',
          `The ${period.code} reconciliation is ${reconciliationStatus}. New statement lines cannot be imported after sign-off.`,
        ),
      );
    }
  }
}

async function validateStatementRows(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  rows: ParsedRow[],
): Promise<void> {
  await markDatabaseDuplicates(database, companyId, bankAccountId, rows);
  await markPeriodErrors(database, companyId, bankAccountId, rows);
}

function summariseRows(rows: readonly ParsedRow[]) {
  const errorCount = rows.filter((row) => row.errors.length > 0).length;
  const duplicateCount = rows.filter((row) => row.errors.some((entry) => entry.code.includes('DUPLICATE'))).length;
  return {
    rowCount: rows.length,
    validCount: rows.length - errorCount,
    errorCount,
    duplicateCount,
  };
}

function validateImportBody(content: string): void {
  if (!content.trim()) {
    throw new AppError(400, 'BANK_STATEMENT_EMPTY', 'Upload a CSV statement file.');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
    throw new AppError(
      400,
      'BANK_STATEMENT_TOO_LARGE',
      `A statement import may be at most ${(MAX_IMPORT_BYTES / 1_000_000).toFixed(0)} MB.`,
    );
  }
}

export async function previewBankStatement(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  input: {
    content: string;
    mapping?: Partial<BankStatementMapping>;
  },
): Promise<BankStatementPreview> {
  await loadBankAccount(database, companyId, bankAccountId);
  const content = normaliseContent(input.content);
  validateImportBody(content);
  const parsed = parseCsv(content);
  if (parsed.rows.length === 0) {
    throw new AppError(400, 'BANK_STATEMENT_EMPTY', 'The statement file is empty.');
  }
  const headers = parsed.rows[0]!.map((header) => header.trim());
  const mapping = resolveMapping(headers, input.mapping);
  const result = parseRows(content, mapping);
  await validateStatementRows(database, companyId, bankAccountId, result.rows);
  const summary = summariseRows(result.rows);
  return {
    headers: result.headers,
    detectedMapping: detectStatementMapping(result.headers),
    mapping,
    rows: result.rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
      rowNumber: row.rowNumber,
      values: row.values,
      date: row.date,
      description: row.description,
      reference: row.reference,
      debitPoisha: row.debitPoisha,
      creditPoisha: row.creditPoisha,
      balancePoisha: row.balancePoisha,
      errors: row.errors,
    })),
    truncated: result.rows.length > PREVIEW_ROW_LIMIT,
    limits: { maxRows: MAX_IMPORT_ROWS, maxBytes: MAX_IMPORT_BYTES, previewRows: PREVIEW_ROW_LIMIT },
    summary,
  };
}

function mapStatement(row: BankStatementRow): BankStatementDto {
  return {
    id: row.id,
    companyId: row.company_id,
    bankAccountId: row.bank_account_id,
    status: row.status,
    sourceFileName: row.source_file_name,
    sourceMimeType: row.source_mime_type,
    sourceFileHash: row.source_file_hash,
    mapping: row.mapping_json,
    rowCount: row.row_count,
    validCount: row.valid_count,
    errorCount: row.error_count,
    duplicateCount: row.duplicate_count,
    errorRows: Array.isArray(row.error_rows_json) ? row.error_rows_json : [],
    idempotencyKeyUsed: Boolean(row.idempotency_key),
    importedBy: row.imported_by,
    importedByName: row.imported_by_name,
    importedAt: row.imported_at.toISOString(),
  };
}

const STATEMENT_SELECT = `
  SELECT s.id, s.company_id, s.bank_account_id, s.status, s.source_file_name, s.source_mime_type,
         s.source_file_hash, s.mapping_json, s.row_count, s.valid_count, s.error_count,
         s.duplicate_count, s.error_rows_json, s.idempotency_key, s.imported_by,
         u.name AS imported_by_name, s.imported_at
    FROM bank_statements s
    JOIN users u ON u.id = s.imported_by
`;

export async function getBankStatement(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  statementId: string,
): Promise<BankStatementDto> {
  const result = await database.query<BankStatementRow>(
    `${STATEMENT_SELECT}
      WHERE s.company_id = $1 AND s.bank_account_id = $2 AND s.id = $3`,
    [companyId, bankAccountId, statementId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_STATEMENT_NOT_FOUND', 'Statement import not found.');
  return mapStatement(row);
}

export async function listBankStatements(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ entries: BankStatementDto[]; total: number; limit: number; offset: number }> {
  await loadBankAccount(database, companyId, bankAccountId);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const result = await database.query<BankStatementRow & { total_count: string }>(
    `SELECT s.id, s.company_id, s.bank_account_id, s.status, s.source_file_name, s.source_mime_type,
            s.source_file_hash, s.mapping_json, s.row_count, s.valid_count, s.error_count,
            s.duplicate_count, s.error_rows_json, s.idempotency_key, s.imported_by,
            u.name AS imported_by_name, s.imported_at,
            COUNT(*) OVER() AS total_count
       FROM bank_statements s
       JOIN users u ON u.id = s.imported_by
      WHERE s.company_id = $1 AND s.bank_account_id = $2
      ORDER BY s.imported_at DESC, s.id DESC
      LIMIT $3 OFFSET $4`,
    [companyId, bankAccountId, limit, offset],
  );
  return {
    entries: result.rows.map(mapStatement),
    total: Number(result.rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function listBankStatementLines(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  options: {
    status?: string;
    from?: string;
    to?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: BankStatementLineDto[]; total: number; limit: number; offset: number }> {
  await loadBankAccount(database, companyId, bankAccountId);
  if (options.from && !isValidIsoDate(options.from)) {
    throw new AppError(400, 'INVALID_DATE', 'The from date must be a real YYYY-MM-DD date.');
  }
  if (options.to && !isValidIsoDate(options.to)) {
    throw new AppError(400, 'INVALID_DATE', 'The to date must be a real YYYY-MM-DD date.');
  }
  if (options.from && options.to && options.from > options.to) {
    throw new AppError(400, 'BANK_DATE_RANGE_INVALID', 'The from date must not be after the to date.');
  }
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const values: unknown[] = [companyId, bankAccountId];
  const where = ['l.company_id = $1', 'l.bank_account_id = $2'];
  if (options.status) {
    values.push(options.status);
    where.push(`l.status = $${values.length}`);
  }
  if (options.from) {
    values.push(options.from);
    where.push(`l.value_date >= $${values.length}::date`);
  }
  if (options.to) {
    values.push(options.to);
    where.push(`l.value_date <= $${values.length}::date`);
  }
  if (options.q) {
    values.push(`%${options.q}%`);
    where.push(`(l.description ILIKE $${values.length} OR COALESCE(l.reference, '') ILIKE $${values.length})`);
  }
  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;
  const result = await database.query<BankStatementLineRow & { total_count: string }>(
    `SELECT l.id, l.company_id, l.statement_id, l.bank_account_id, l.line_no, l.value_date,
            l.description, l.reference, l.debit_poisha::text AS debit_poisha,
            l.credit_poisha::text AS credit_poisha, l.balance_poisha::text AS balance_poisha,
            l.status, l.fingerprint, l.match_score, l.match_reason, l.matched_journal_id,
            l.exception_owner_id, u.name AS exception_owner_name, l.exception_note,
            l.excluded_reason, l.created_at, l.updated_at,
            COUNT(*) OVER() AS total_count
       FROM bank_statement_lines l
       LEFT JOIN users u ON u.id = l.exception_owner_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.value_date DESC, l.line_no DESC, l.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  return {
    entries: result.rows.map(mapBankStatementLine),
    total: Number(result.rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function importBankStatement(
  pool: Pool,
  input: BankingAuditContext & {
    bankAccountId: string;
    sourceFileName: string;
    sourceMimeType: string;
    content: string;
    mapping?: Partial<BankStatementMapping>;
    idempotencyKey: string;
  },
): Promise<{ statement: BankStatementDto; replayed: boolean }> {
  const content = normaliseContent(input.content);
  validateImportBody(content);
  const sourceFileName = input.sourceFileName.trim();
  if (!sourceFileName || sourceFileName.length > 255) {
    throw new AppError(400, 'BANK_STATEMENT_FILE_NAME_INVALID', 'The source file name must be 1–255 characters.');
  }
  const sourceMimeType = input.sourceMimeType.trim();
  if (
    !['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(
      sourceMimeType,
    )
  ) {
    throw new AppError(400, 'BANK_STATEMENT_MIME_INVALID', 'The source file must be CSV, text or XLSX.');
  }
  const hash = createHash('sha256').update(content).digest('hex');

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `bank-statement-import:${input.companyId}:${input.bankAccountId}`,
    ]);
    const existingKey = await client.query<BankStatementRow>(
      `${STATEMENT_SELECT} WHERE s.company_id = $1 AND s.idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      return { statement: mapStatement(existingKey.rows[0]), replayed: true };
    }
    await loadBankAccount(client, input.companyId, input.bankAccountId, { requireActive: true });

    const duplicateFile = await client.query<{ id: string }>(
      `SELECT id FROM bank_statements
        WHERE company_id = $1 AND bank_account_id = $2 AND source_file_hash = $3`,
      [input.companyId, input.bankAccountId, hash],
    );
    if (duplicateFile.rows[0]) {
      throw new AppError(
        409,
        'BANK_STATEMENT_DUPLICATE_FILE',
        'This exact statement file has already been imported for the account. Use the existing import instead of creating a duplicate.',
        { statementId: duplicateFile.rows[0].id },
      );
    }

    const parsed = parseCsv(content);
    if (parsed.rows.length === 0) {
      throw new AppError(400, 'BANK_STATEMENT_EMPTY', 'The statement file is empty.');
    }
    const headers = parsed.rows[0]!.map((header) => header.trim());
    const mapping = resolveMapping(headers, input.mapping);
    const result = parseRows(content, mapping);
    await validateStatementRows(client, input.companyId, input.bankAccountId, result.rows);
    // Row-level period checks above are authoritative; this call proves the account still exists and
    // the route is not importing into a period that has since been closed between preview and import.
    const firstValidDate = result.rows.find((row) => row.errors.length === 0 && row.date)?.date;
    if (firstValidDate) {
      await assertStatementImportAllowed(client, input.companyId, input.bankAccountId, firstValidDate);
    }
    const summary = summariseRows(result.rows);
    const status = summary.validCount === 0 ? 'REJECTED' : summary.errorCount > 0 ? 'PARTIAL' : 'IMPORTED';
    const errorRows = result.rows
      .filter((row) => row.errors.length > 0)
      .flatMap((row) => row.errors)
      .slice(0, MAX_ERROR_ROWS_STORED);
    const statementId = (await client.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bank_statements (
         id, company_id, bank_account_id, status, source_file_name, source_mime_type,
         source_file_hash, source_content, mapping_json, row_count, valid_count, error_count,
         duplicate_count, error_rows_json, idempotency_key, imported_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16)
       RETURNING id`,
      [
        statementId,
        input.companyId,
        input.bankAccountId,
        status,
        sourceFileName,
        sourceMimeType,
        hash,
        content,
        JSON.stringify(mapping),
        summary.rowCount,
        summary.validCount,
        summary.errorCount,
        summary.duplicateCount,
        JSON.stringify(errorRows),
        input.idempotencyKey,
        input.actorUserId,
      ],
    );

    let lineNo = 0;
    const importedDates = new Set<string>();
    for (const row of result.rows) {
      if (row.errors.length > 0 || !row.date || !row.fingerprint) continue;
      lineNo += 1;
      importedDates.add(row.date);
      await client.query(
        `INSERT INTO bank_statement_lines (
           company_id, statement_id, bank_account_id, line_no, value_date, description, reference,
           debit_poisha, credit_poisha, balance_poisha, status, fingerprint, exception_owner_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UNMATCHED',$11,$12)`,
        [
          input.companyId,
          inserted.rows[0]!.id,
          input.bankAccountId,
          lineNo,
          row.date,
          row.description,
          row.reference,
          row.debitPoisha ?? '0',
          row.creditPoisha ?? '0',
          row.balancePoisha,
          row.fingerprint,
          input.actorUserId,
        ],
      );
    }

    // A prepared reconciliation is only an assertion about the lines that existed when it was
    // prepared. New imported evidence invalidates that assertion until the preparer re-runs it.
    const invalidatedPeriodIds = new Set<string>();
    for (const date of importedDates) {
      const period = await loadPeriodForDate(client, input.companyId, date);
      if (invalidatedPeriodIds.has(period.id)) continue;
      invalidatedPeriodIds.add(period.id);
      const invalidated = await client.query<{ id: string }>(
        `UPDATE bank_reconciliations
            SET status = 'DRAFT', prepared_by = NULL, prepared_at = NULL,
                snapshot_json = '{}'::jsonb, difference_poisha = 0
          WHERE company_id = $1 AND bank_account_id = $2 AND period_id = $3
            AND status = 'PREPARED'
          RETURNING id`,
        [input.companyId, input.bankAccountId, period.id],
      );
      for (const reconciliation of invalidated.rows) {
        await writeAuditEvent(client, {
          organisationId: input.organisationId,
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          action: 'bank_reconciliation.invalidated',
          entityType: 'bank_reconciliation',
          entityId: reconciliation.id,
          before: { status: 'PREPARED' },
          after: { status: 'DRAFT', reason: 'New statement lines imported' },
          reason: 'New imported statement evidence invalidated the prepared reconciliation.',
          ip: input.ip,
          userAgent: input.userAgent,
          requestId: input.requestId,
        });
      }
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_statement.imported',
      entityType: 'bank_statement',
      entityId: inserted.rows[0]!.id,
      after: {
        bankAccountId: input.bankAccountId,
        sourceFileName,
        sourceFileHash: hash,
        status,
        rowCount: summary.rowCount,
        validCount: summary.validCount,
        errorCount: summary.errorCount,
        duplicateCount: summary.duplicateCount,
        journalPostings: 0,
      },
      reason: 'Bank/MFS statement imported for reconciliation. No journal was posted by the import.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return {
      statement: await getBankStatement(client, input.companyId, input.bankAccountId, inserted.rows[0]!.id),
      replayed: false,
    };
  });
}

export async function getStatementLineWithContext(
  database: Queryable,
  companyId: string,
  lineId: string,
  options: { forUpdate?: boolean } = {},
): Promise<BankStatementLineDto> {
  const row = await database.query<BankStatementLineRow>(
    `SELECT l.id, l.company_id, l.statement_id, l.bank_account_id, l.line_no, l.value_date,
            l.description, l.reference, l.debit_poisha::text AS debit_poisha,
            l.credit_poisha::text AS credit_poisha, l.balance_poisha::text AS balance_poisha,
            l.status, l.fingerprint, l.match_score, l.match_reason, l.matched_journal_id,
            l.exception_owner_id, u.name AS exception_owner_name, l.exception_note,
            l.excluded_reason, l.created_at, l.updated_at
       FROM bank_statement_lines l
       LEFT JOIN users u ON u.id = l.exception_owner_id
      WHERE l.company_id = $1 AND l.id = $2
      ${options.forUpdate ? 'FOR UPDATE OF l' : ''}`,
    [companyId, lineId],
  );
  const line = row.rows[0];
  if (!line) throw new AppError(404, 'BANK_STATEMENT_LINE_NOT_FOUND', 'Statement line not found.');
  return mapBankStatementLine(line);
}

export function formatStatementAmount(value: string | null): string {
  return value === null ? '' : formatPoishaAsBdt(value);
}
