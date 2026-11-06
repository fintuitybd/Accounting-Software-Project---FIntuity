import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { isValidIsoDate, formatDatabaseDate } from './dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha, parseQuantity } from './money.ts';
import { findPeriodForDate } from './periodService.ts';
import { postJournalWithinTransaction, loadJournal } from '../ledger/ledgerService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const SCHEDULE_TYPES = ['ACCOUNT', 'PARTY', 'ITEM', 'FIXED_ASSET'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export interface OpeningBalanceSchedule {
  name?: string;
  reference?: string;
  dueDate?: string;
  quantity?: string;
  unitCost?: string;
  assetClass?: string;
  usefulLifeMonths?: number;
  accumulatedDepreciation?: string;
}

export interface OpeningBalanceLineInput {
  accountId: string;
  scheduleType?: ScheduleType;
  schedule?: OpeningBalanceSchedule;
  debit: string;
  credit: string;
  memo?: string | null;
}

export interface OpeningBalanceLineDto {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  scheduleType: string;
  schedule: OpeningBalanceSchedule;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  memo: string | null;
}

export interface OpeningBalanceBatchDto {
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
  lines: OpeningBalanceLineDto[];
}

interface BatchRow {
  id: string;
  company_id: string;
  period_id: string;
  period_code: string;
  batch_date: Date;
  status: string;
  currency: string;
  total_debit_poisha: string;
  total_credit_poisha: string;
  balanced: boolean;
  evidence_reference: string | null;
  evidence_note: string | null;
  evidence_checksum: string | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  posted_at: Date | null;
  posted_by: string | null;
  journal_id: string | null;
  journal_number: string | null;
  posting_idempotency_key: string | null;
  reversal_journal_id: string | null;
  reversal_journal_number: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface LineRow {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  schedule_type: string;
  schedule_json: OpeningBalanceSchedule | null;
  debit_poisha: string;
  credit_poisha: string;
  memo: string | null;
}

const BATCH_SELECT = `
  SELECT b.id, b.company_id, b.period_id, p.code AS period_code, b.batch_date, b.status, b.currency,
         b.total_debit_poisha::text AS total_debit_poisha,
         b.total_credit_poisha::text AS total_credit_poisha,
         b.balanced, b.evidence_reference, b.evidence_note, b.evidence_checksum,
         b.submitted_at, b.submitted_by, b.approved_at, b.approved_by, b.posted_at, b.posted_by,
         b.journal_id, j.journal_number, b.posting_idempotency_key,
         b.reversal_journal_id, rj.journal_number AS reversal_journal_number,
         b.created_by, b.created_at, b.updated_at
    FROM opening_balance_batches b
    JOIN periods p ON p.company_id = b.company_id AND p.id = b.period_id
    LEFT JOIN journals j ON j.company_id = b.company_id AND j.id = b.journal_id
    LEFT JOIN journals rj ON rj.company_id = b.company_id AND rj.id = b.reversal_journal_id
`;

function isoDate(value: Date): string {
  return formatDatabaseDate(value);
}

function mapLine(row: LineRow): OpeningBalanceLineDto {
  return {
    id: row.id,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    scheduleType: row.schedule_type,
    schedule: row.schedule_json ?? {},
    debitPoisha: row.debit_poisha,
    creditPoisha: row.credit_poisha,
    debitBdt: formatPoishaAsBdt(row.debit_poisha),
    creditBdt: formatPoishaAsBdt(row.credit_poisha),
    memo: row.memo,
  };
}

function mapBatch(row: BatchRow, lines: OpeningBalanceLineDto[]): OpeningBalanceBatchDto {
  const debit = BigInt(row.total_debit_poisha);
  const credit = BigInt(row.total_credit_poisha);
  const difference = debit - credit;
  return {
    id: row.id,
    companyId: row.company_id,
    periodId: row.period_id,
    periodCode: row.period_code,
    batchDate: isoDate(row.batch_date),
    status: row.status as OpeningBalanceBatchDto['status'],
    currency: row.currency,
    totalDebitPoisha: debit.toString(),
    totalCreditPoisha: credit.toString(),
    totalDebitBdt: formatPoishaAsBdt(debit),
    totalCreditBdt: formatPoishaAsBdt(credit),
    balanced: row.balanced,
    differencePoisha: difference.toString(),
    differenceBdt: formatPoishaAsBdt(difference),
    evidenceReference: row.evidence_reference,
    evidenceNote: row.evidence_note,
    evidenceChecksum: row.evidence_checksum,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    postedAt: row.posted_at?.toISOString() ?? null,
    postedBy: row.posted_by,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalJournalId: row.reversal_journal_id,
    reversalJournalNumber: row.reversal_journal_number,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lines,
  };
}

async function loadLines(database: Queryable, companyId: string, batchId: string): Promise<OpeningBalanceLineDto[]> {
  const result = await database.query<LineRow>(
    `SELECT l.id, l.account_id, a.code AS account_code, a.name_en AS account_name,
            l.schedule_type, l.schedule_json, l.debit_poisha::text AS debit_poisha,
            l.credit_poisha::text AS credit_poisha, l.memo
       FROM opening_balance_lines l
       JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
      WHERE l.company_id = $1 AND l.batch_id = $2
      ORDER BY l.line_no ASC`,
    [companyId, batchId],
  );
  return result.rows.map(mapLine);
}

async function loadBatch(database: Queryable, companyId: string, batchId: string): Promise<OpeningBalanceBatchDto> {
  const result = await database.query<BatchRow>(`${BATCH_SELECT} WHERE b.company_id = $1 AND b.id = $2`, [
    companyId,
    batchId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'OPENING_BATCH_NOT_FOUND', 'Opening-balance batch not found.');
  return mapBatch(row, await loadLines(database, companyId, batchId));
}

export async function listOpeningBalanceBatches(
  database: Queryable,
  companyId: string,
): Promise<OpeningBalanceBatchDto[]> {
  const result = await database.query<BatchRow>(`${BATCH_SELECT} WHERE b.company_id = $1 ORDER BY b.created_at DESC`, [
    companyId,
  ]);
  return Promise.all(result.rows.map(async (row) => mapBatch(row, await loadLines(database, companyId, row.id))));
}

export async function getOpeningBalanceBatch(
  database: Queryable,
  companyId: string,
  batchId: string,
): Promise<OpeningBalanceBatchDto> {
  return loadBatch(database, companyId, batchId);
}

function validateEvidence(input: { reference?: string | null; note?: string | null; checksum?: string | null }): {
  reference: string | null;
  note: string | null;
  checksum: string | null;
} {
  const reference = input.reference?.trim() || null;
  const note = input.note?.trim() || null;
  const checksum = input.checksum?.trim().toLowerCase() || null;
  if ((reference?.length ?? 0) > 200) {
    throw new AppError(400, 'OPENING_EVIDENCE_INVALID', 'The evidence reference must be at most 200 characters.');
  }
  if ((note?.length ?? 0) > 1000) {
    throw new AppError(400, 'OPENING_EVIDENCE_INVALID', 'The evidence note must be at most 1,000 characters.');
  }
  if (checksum && !/^[0-9a-f]{64}$/.test(checksum)) {
    throw new AppError(
      400,
      'OPENING_EVIDENCE_INVALID',
      'The evidence checksum must be a lowercase SHA-256 hex digest or omitted.',
    );
  }
  return { reference, note, checksum };
}

function validateSchedule(type: ScheduleType, schedule: OpeningBalanceSchedule | undefined): OpeningBalanceSchedule {
  const value = schedule ?? {};
  const name = value.name?.trim() || undefined;
  const reference = value.reference?.trim() || undefined;
  if ((name?.length ?? 0) > 200 || (reference?.length ?? 0) > 200) {
    throw new AppError(
      400,
      'OPENING_SCHEDULE_INVALID',
      'Schedule names and references must be at most 200 characters.',
    );
  }
  if (value.dueDate && !isValidIsoDate(value.dueDate)) {
    throw new AppError(400, 'OPENING_SCHEDULE_INVALID', 'Schedule due dates must be real YYYY-MM-DD dates.');
  }
  if (type === 'PARTY' && !name) {
    throw new AppError(400, 'OPENING_SCHEDULE_INVALID', 'A party schedule requires the party name.');
  }
  if (type === 'ITEM') {
    if (!name) throw new AppError(400, 'OPENING_SCHEDULE_INVALID', 'An item schedule requires the item name.');
    if (value.quantity !== undefined && parseQuantity(value.quantity) === null) {
      throw new AppError(
        400,
        'OPENING_SCHEDULE_INVALID',
        'Item quantities must be non-negative with up to four decimals.',
      );
    }
    if (value.unitCost !== undefined && parseBdtToPoisha(value.unitCost) === null) {
      throw new AppError(400, 'OPENING_SCHEDULE_INVALID', 'Item unit cost must be a non-negative BDT amount.');
    }
  }
  if (type === 'FIXED_ASSET') {
    if (!name) throw new AppError(400, 'OPENING_SCHEDULE_INVALID', 'A fixed-asset schedule requires an asset class.');
    if (
      value.usefulLifeMonths !== undefined &&
      (!Number.isInteger(value.usefulLifeMonths) || value.usefulLifeMonths < 1 || value.usefulLifeMonths > 1200)
    ) {
      throw new AppError(
        400,
        'OPENING_SCHEDULE_INVALID',
        'Useful life must be a whole number of months between 1 and 1,200.',
      );
    }
    if (value.accumulatedDepreciation !== undefined && parseBdtToPoisha(value.accumulatedDepreciation) === null) {
      throw new AppError(
        400,
        'OPENING_SCHEDULE_INVALID',
        'Accumulated depreciation must be a non-negative BDT amount.',
      );
    }
  }
  return {
    ...(name ? { name } : {}),
    ...(reference ? { reference } : {}),
    ...(value.dueDate ? { dueDate: value.dueDate } : {}),
    ...(value.quantity ? { quantity: value.quantity } : {}),
    ...(value.unitCost ? { unitCost: value.unitCost } : {}),
    ...(value.assetClass?.trim() ? { assetClass: value.assetClass.trim() } : {}),
    ...(value.usefulLifeMonths !== undefined ? { usefulLifeMonths: value.usefulLifeMonths } : {}),
    ...(value.accumulatedDepreciation ? { accumulatedDepreciation: value.accumulatedDepreciation } : {}),
  };
}

interface ValidatedLine {
  accountId: string;
  scheduleType: ScheduleType;
  schedule: OpeningBalanceSchedule;
  debit: bigint;
  credit: bigint;
  memo: string | null;
}

function validateLines(lines: OpeningBalanceLineInput[]): ValidatedLine[] {
  if (lines.length > 2000) {
    throw new AppError(400, 'OPENING_BATCH_TOO_LARGE', 'An opening-balance batch may contain at most 2,000 lines.');
  }
  return lines.map((line, index) => {
    const debit = parseBdtToPoisha(line.debit);
    const credit = parseBdtToPoisha(line.credit);
    if (debit === null || credit === null) {
      throw new AppError(
        400,
        'INVALID_AMOUNT',
        `Line ${index + 1}: debit and credit must be non-negative BDT amounts with up to 2 decimals.`,
      );
    }
    if (debit > 0n === credit > 0n) {
      throw new AppError(
        400,
        'OPENING_LINE_SIDE_INVALID',
        `Line ${index + 1}: enter exactly one positive debit or credit amount.`,
      );
    }
    if ((line.memo?.trim().length ?? 0) > 500) {
      throw new AppError(
        400,
        'OPENING_LINE_MEMO_INVALID',
        `Line ${index + 1}: the memo must be at most 500 characters.`,
      );
    }
    const scheduleType = (line.scheduleType ?? 'ACCOUNT') as ScheduleType;
    if (!(SCHEDULE_TYPES as readonly string[]).includes(scheduleType)) {
      throw new AppError(400, 'OPENING_SCHEDULE_INVALID', `Line ${index + 1}: choose a valid schedule type.`);
    }
    return {
      accountId: line.accountId,
      scheduleType,
      schedule: validateSchedule(scheduleType, line.schedule),
      debit,
      credit,
      memo: line.memo?.trim() || null,
    };
  });
}

async function assertAccountsBelong(
  database: Queryable,
  companyId: string,
  lines: ValidatedLine[],
  activeOnly: boolean,
): Promise<void> {
  if (lines.length === 0) return;
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const result = await database.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const found = new Map(result.rows.map((row) => [row.id, row.is_active]));
  for (const id of ids) {
    if (!found.has(id)) {
      throw new AppError(
        400,
        'OPENING_ACCOUNT_INVALID',
        'Every opening-balance line must use an account from this company.',
      );
    }
    if (activeOnly && found.get(id) === false) {
      throw new AppError(
        400,
        'OPENING_ACCOUNT_INACTIVE',
        'An opening-balance line uses an inactive account. Reactivate it or choose another account.',
      );
    }
  }
}

function totalsOf(lines: ValidatedLine[]): { debit: bigint; credit: bigint; balanced: boolean } {
  const debit = lines.reduce((sum, line) => sum + line.debit, 0n);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0n);
  return { debit, credit, balanced: debit === credit && debit > 0n };
}

async function replaceLines(
  client: PoolClient,
  companyId: string,
  batchId: string,
  lines: ValidatedLine[],
): Promise<void> {
  await client.query(`DELETE FROM opening_balance_lines WHERE company_id = $1 AND batch_id = $2`, [companyId, batchId]);
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO opening_balance_lines (
         company_id, batch_id, line_no, account_id, schedule_type, schedule_json,
         debit_poisha, credit_poisha, memo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        companyId,
        batchId,
        index + 1,
        line.accountId,
        line.scheduleType,
        JSON.stringify(line.schedule),
        line.debit.toString(),
        line.credit.toString(),
        line.memo,
      ],
    );
  }
}

export async function createOpeningBalanceBatch(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    batchDate: string;
    evidenceReference?: string | null;
    evidenceNote?: string | null;
    evidenceChecksum?: string | null;
    lines: OpeningBalanceLineInput[];
  },
): Promise<OpeningBalanceBatchDto> {
  if (!isValidIsoDate(input.batchDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real opening-balance date in YYYY-MM-DD format.');
  }
  const lines = validateLines(input.lines);
  const evidence = validateEvidence({
    reference: input.evidenceReference,
    note: input.evidenceNote,
    checksum: input.evidenceChecksum,
  });
  const totals = totalsOf(lines);

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`opening-balances:${input.companyId}`]);
    const period = await findPeriodForDate(client, input.companyId, input.batchDate);
    if (!period) {
      throw new AppError(
        400,
        'PERIOD_NOT_FOUND',
        `No accounting period is configured for ${input.batchDate}. Generate the fiscal year first.`,
      );
    }
    await assertAccountsBelong(client, input.companyId, lines, false);
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM opening_balance_batches
        WHERE company_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.companyId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const batch = existing.rows[0]!;
      if (batch.status === 'POSTED' || batch.status === 'REVERSED') {
        throw new AppError(
          409,
          'OPENING_BATCH_ALREADY_POSTED',
          'An opening-balance batch has already been posted for this company. Opening balances are a one-time posting.',
          { batchId: batch.id },
        );
      }
      throw new AppError(
        409,
        'OPENING_BATCH_EXISTS',
        'An opening-balance batch already exists for this company. Open it and edit the draft or review the submitted batch.',
        { batchId: batch.id },
      );
    }

    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO opening_balance_batches (
           company_id, period_id, batch_date, status, currency, total_debit_poisha, total_credit_poisha,
           balanced, evidence_reference, evidence_note, evidence_checksum, created_by, updated_by
         ) VALUES ($1,$2,$3,'DRAFT','BDT',$4,$5,$6,$7,$8,$9,$10,$10)
         RETURNING id`,
        [
          input.companyId,
          period.id,
          input.batchDate,
          totals.debit.toString(),
          totals.credit.toString(),
          totals.balanced,
          evidence.reference,
          evidence.note,
          evidence.checksum,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'OPENING_BATCH_EXISTS', 'An opening-balance batch already exists for this company.');
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'OPENING_BATCH_CREATE_FAILED', 'The opening-balance batch could not be created.');
    await replaceLines(client, input.companyId, id, lines);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'opening_balance.created',
      entityType: 'opening_balance_batch',
      entityId: id,
      after: {
        batchDate: input.batchDate,
        status: 'DRAFT',
        lineCount: lines.length,
        totalDebitPoisha: totals.debit.toString(),
        totalCreditPoisha: totals.credit.toString(),
        balanced: totals.balanced,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadBatch(client, input.companyId, id);
  });
}

export async function updateOpeningBalanceBatch(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    batchId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    batchDate: string;
    evidenceReference?: string | null;
    evidenceNote?: string | null;
    evidenceChecksum?: string | null;
    lines: OpeningBalanceLineInput[];
  },
): Promise<OpeningBalanceBatchDto> {
  if (!isValidIsoDate(input.batchDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real opening-balance date in YYYY-MM-DD format.');
  }
  const lines = validateLines(input.lines);
  const evidence = validateEvidence({
    reference: input.evidenceReference,
    note: input.evidenceNote,
    checksum: input.evidenceChecksum,
  });
  const totals = totalsOf(lines);

  return withTransaction(pool, async (client) => {
    const existing = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE b.company_id = $1 AND b.id = $2 FOR UPDATE OF b`,
      [input.companyId, input.batchId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'OPENING_BATCH_NOT_FOUND', 'Opening-balance batch not found.');
    if (before.status !== 'DRAFT') {
      throw new AppError(
        409,
        'OPENING_BATCH_NOT_DRAFT',
        'Only a draft opening-balance batch can be edited. The submitted batch is locked pending ledger posting.',
      );
    }
    const period = await findPeriodForDate(client, input.companyId, input.batchDate);
    if (!period) {
      throw new AppError(400, 'PERIOD_NOT_FOUND', `No accounting period is configured for ${input.batchDate}.`);
    }
    await assertAccountsBelong(client, input.companyId, lines, false);
    await client.query(
      `UPDATE opening_balance_batches
          SET period_id = $3, batch_date = $4, total_debit_poisha = $5, total_credit_poisha = $6,
              balanced = $7, evidence_reference = $8, evidence_note = $9, evidence_checksum = $10,
              updated_by = $11
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.batchId,
        period.id,
        input.batchDate,
        totals.debit.toString(),
        totals.credit.toString(),
        totals.balanced,
        evidence.reference,
        evidence.note,
        evidence.checksum,
        input.actorUserId,
      ],
    );
    const beforeLines = await loadLines(client, input.companyId, input.batchId);
    await replaceLines(client, input.companyId, input.batchId, lines);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'opening_balance.updated',
      entityType: 'opening_balance_batch',
      entityId: input.batchId,
      before: {
        batchDate: isoDate(before.batch_date),
        lineCount: beforeLines.length,
        totalDebitPoisha: before.total_debit_poisha,
        totalCreditPoisha: before.total_credit_poisha,
        balanced: before.balanced,
      },
      after: {
        batchDate: input.batchDate,
        lineCount: lines.length,
        totalDebitPoisha: totals.debit.toString(),
        totalCreditPoisha: totals.credit.toString(),
        balanced: totals.balanced,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadBatch(client, input.companyId, input.batchId);
  });
}

export async function submitOpeningBalanceBatch(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    batchId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
  },
): Promise<OpeningBalanceBatchDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE b.company_id = $1 AND b.id = $2 FOR UPDATE OF b`,
      [input.companyId, input.batchId],
    );
    const batch = existing.rows[0];
    if (!batch) throw new AppError(404, 'OPENING_BATCH_NOT_FOUND', 'Opening-balance batch not found.');
    if (batch.status !== 'DRAFT') {
      throw new AppError(
        409,
        batch.status === 'SUBMITTED' ? 'OPENING_BATCH_ALREADY_SUBMITTED' : 'OPENING_BATCH_NOT_DRAFT',
        batch.status === 'SUBMITTED'
          ? 'This opening-balance batch is already submitted.'
          : 'Only a draft opening-balance batch can be submitted.',
      );
    }
    const lines = await loadLines(client, input.companyId, input.batchId);
    if (lines.length < 2) {
      throw new AppError(409, 'OPENING_BATCH_TOO_FEW_LINES', 'An opening-balance batch needs at least two lines.');
    }
    const validated = lines.map((line) => ({
      accountId: line.accountId,
      scheduleType: line.scheduleType as ScheduleType,
      schedule: line.schedule,
      debit: BigInt(line.debitPoisha),
      credit: BigInt(line.creditPoisha),
      memo: line.memo,
    }));
    await assertAccountsBelong(client, input.companyId, validated, true);
    const totals = totalsOf(validated);
    if (totals.debit <= 0n) {
      throw new AppError(409, 'OPENING_BATCH_EMPTY', 'The opening-balance batch has no positive amounts.');
    }
    if (!totals.balanced) {
      throw new AppError(
        409,
        'OPENING_BATCH_UNBALANCED',
        `Opening balances do not balance: debit ${formatPoishaAsBdt(totals.debit)} BDT vs credit ${formatPoishaAsBdt(totals.credit)} BDT.`,
        { differenceBdt: formatPoishaAsBdt(totals.debit - totals.credit) },
      );
    }
    const evidence = validateEvidence({
      reference: batch.evidence_reference,
      note: batch.evidence_note,
      checksum: batch.evidence_checksum,
    });
    if (!evidence.reference) {
      throw new AppError(
        409,
        'OPENING_BATCH_EVIDENCE_REQUIRED',
        'Record the evidence reference for the opening balances before submitting the batch for posting.',
      );
    }
    const period = await findPeriodForDate(client, input.companyId, isoDate(batch.batch_date));
    if (!period) {
      throw new AppError(400, 'PERIOD_NOT_FOUND', 'No accounting period covers the opening-balance date.');
    }
    if (period.status !== 'OPEN') {
      throw new AppError(
        409,
        'PERIOD_NOT_OPEN',
        `The period ${period.code} is ${period.status}; opening balances can only be submitted into an OPEN period.`,
      );
    }
    await client.query(
      `UPDATE opening_balance_batches
          SET status = 'SUBMITTED', total_debit_poisha = $3, total_credit_poisha = $4, balanced = true,
              submitted_at = now(), submitted_by = $5, updated_by = $5
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.batchId, totals.debit.toString(), totals.credit.toString(), input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'opening_balance.submitted',
      entityType: 'opening_balance_batch',
      entityId: input.batchId,
      before: { status: 'DRAFT' },
      after: {
        status: 'SUBMITTED',
        lineCount: lines.length,
        totalDebitPoisha: totals.debit.toString(),
        totalCreditPoisha: totals.credit.toString(),
        evidenceReference: evidence.reference,
        ledgerPosting: 'PENDING_APPROVAL_AND_POSTING',
      },
      reason: 'Prepared for approval and ledger posting; no journal has been posted yet.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadBatch(client, input.companyId, input.batchId);
  });
}

async function validateBatchForPosting(
  client: PoolClient,
  companyId: string,
  batch: BatchRow,
): Promise<{
  lines: OpeningBalanceLineDto[];
  validated: ValidatedLine[];
  totals: { debit: bigint; credit: bigint; balanced: boolean };
  evidence: { reference: string | null; note: string | null; checksum: string | null };
  period: Awaited<ReturnType<typeof findPeriodForDate>>;
}> {
  const lines = await loadLines(client, companyId, batch.id);
  if (lines.length < 2) {
    throw new AppError(409, 'OPENING_BATCH_TOO_FEW_LINES', 'An opening-balance batch needs at least two lines.');
  }
  const validated: ValidatedLine[] = lines.map((line) => ({
    accountId: line.accountId,
    scheduleType: line.scheduleType as ScheduleType,
    schedule: line.schedule,
    debit: BigInt(line.debitPoisha),
    credit: BigInt(line.creditPoisha),
    memo: line.memo,
  }));
  await assertAccountsBelong(client, companyId, validated, true);
  const totals = totalsOf(validated);
  if (totals.debit <= 0n) {
    throw new AppError(409, 'OPENING_BATCH_EMPTY', 'The opening-balance batch has no positive amounts.');
  }
  if (!totals.balanced) {
    throw new AppError(
      409,
      'OPENING_BATCH_UNBALANCED',
      `Opening balances do not balance: debit ${formatPoishaAsBdt(totals.debit)} BDT vs credit ${formatPoishaAsBdt(totals.credit)} BDT.`,
      { differenceBdt: formatPoishaAsBdt(totals.debit - totals.credit) },
    );
  }
  const evidence = validateEvidence({
    reference: batch.evidence_reference,
    note: batch.evidence_note,
    checksum: batch.evidence_checksum,
  });
  if (!evidence.reference) {
    throw new AppError(
      409,
      'OPENING_BATCH_EVIDENCE_REQUIRED',
      'Record the evidence reference for the opening balances before approving or posting the batch.',
    );
  }
  const period = await findPeriodForDate(client, companyId, isoDate(batch.batch_date));
  if (!period) {
    throw new AppError(400, 'PERIOD_NOT_FOUND', 'No accounting period covers the opening-balance date.');
  }
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'PERIOD_NOT_OPEN',
      `The period ${period.code} is ${period.status}; opening balances can only be approved and posted into an OPEN period.`,
      { periodCode: period.code, status: period.status },
    );
  }
  return { lines, validated, totals, evidence, period };
}

/**
 * Approve a submitted opening-balance batch. Approval is mandatory and must come from a different
 * user than the preparer/submitter (maker-checker). The batch is still not in the ledger.
 */
export async function approveOpeningBalanceBatch(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    batchId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
  },
): Promise<OpeningBalanceBatchDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE b.company_id = $1 AND b.id = $2 FOR UPDATE OF b`,
      [input.companyId, input.batchId],
    );
    const batch = existing.rows[0];
    if (!batch) throw new AppError(404, 'OPENING_BATCH_NOT_FOUND', 'Opening-balance batch not found.');
    if (batch.status === 'APPROVED') {
      throw new AppError(409, 'OPENING_BATCH_ALREADY_APPROVED', 'This opening-balance batch is already approved.');
    }
    if (batch.status === 'POSTED' || batch.status === 'REVERSED') {
      throw new AppError(
        409,
        'OPENING_BATCH_ALREADY_POSTED',
        'This opening-balance batch has already been posted through the ledger.',
      );
    }
    if (batch.status !== 'SUBMITTED') {
      throw new AppError(
        409,
        'OPENING_BATCH_NOT_SUBMITTED',
        'Submit the opening-balance batch before it can be approved.',
      );
    }
    if (input.actorUserId === batch.created_by || input.actorUserId === batch.submitted_by) {
      throw new AppError(
        409,
        'OPENING_BATCH_SELF_APPROVAL',
        'The preparer or submitter cannot approve the same opening-balance batch. Ask a different controller or administrator to approve it.',
      );
    }
    const validated = await validateBatchForPosting(client, input.companyId, batch);
    await client.query(
      `UPDATE opening_balance_batches
          SET status = 'APPROVED', approved_at = now(), approved_by = $3, updated_by = $3
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.batchId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'opening_balance.approved',
      entityType: 'opening_balance_batch',
      entityId: input.batchId,
      before: { status: 'SUBMITTED' },
      after: {
        status: 'APPROVED',
        totalDebitPoisha: validated.totals.debit.toString(),
        totalCreditPoisha: validated.totals.credit.toString(),
        evidenceReference: validated.evidence.reference,
      },
      reason: 'Approved for one-time ledger posting.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadBatch(client, input.companyId, input.batchId);
  });
}

/**
 * Post the approved opening-balance batch through the same posting invariants as a manual journal.
 * A permanent batch <-> journal link is written in the same transaction, and a second posting is
 * rejected (or replayed only when the same Idempotency-Key is supplied).
 */
export async function postOpeningBalanceBatch(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    batchId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    idempotencyKey?: string | null;
  },
): Promise<{
  batch: OpeningBalanceBatchDto;
  journal: Awaited<ReturnType<typeof loadJournal>> | null;
  replayed: boolean;
}> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`opening-post:${input.companyId}`]);
    const existing = await client.query<BatchRow>(
      `${BATCH_SELECT} WHERE b.company_id = $1 AND b.id = $2 FOR UPDATE OF b`,
      [input.companyId, input.batchId],
    );
    const batch = existing.rows[0];
    if (!batch) throw new AppError(404, 'OPENING_BATCH_NOT_FOUND', 'Opening-balance batch not found.');

    if (batch.status === 'POSTED') {
      if (input.idempotencyKey && batch.posting_idempotency_key === input.idempotencyKey && batch.journal_id) {
        return {
          batch: await loadBatch(client, input.companyId, input.batchId),
          journal: await loadJournal(client, input.companyId, batch.journal_id),
          replayed: true,
        };
      }
      throw new AppError(
        409,
        'OPENING_BATCH_ALREADY_POSTED',
        'This opening-balance batch is already posted. Opening balances can be posted only once.',
        { batchId: batch.id, journalId: batch.journal_id, journalNumber: batch.journal_number },
      );
    }
    if (batch.status === 'REVERSED') {
      throw new AppError(
        409,
        'OPENING_BATCH_ALREADY_REVERSED',
        'This opening-balance batch has been posted and reversed; it cannot be posted again.',
      );
    }
    if (batch.status !== 'APPROVED') {
      throw new AppError(
        409,
        'OPENING_BATCH_NOT_APPROVED',
        'Approve the opening-balance batch before posting it to the ledger.',
      );
    }
    if (batch.journal_id) {
      throw new AppError(
        409,
        'OPENING_BATCH_LINK_CONFLICT',
        'The opening-balance batch already has a journal link but is not marked POSTED. Investigate before retrying.',
      );
    }

    const validated = await validateBatchForPosting(client, input.companyId, batch);
    if (!validated.period) {
      throw new AppError(400, 'PERIOD_NOT_FOUND', 'No accounting period covers the opening-balance date.');
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO journals (
         company_id, book_type, period_id, document_date, posting_date, source_module,
         source_doc_id, source_doc_ref, narration_en, narration_bn, currency, status, created_by
       ) VALUES ($1,'STATUTORY_BD',$2,$3,$3,'OPENING_BALANCE',$4,$5,$6,NULL,'BDT','DRAFT',$7)
       RETURNING id`,
      [
        input.companyId,
        validated.period.id,
        isoDate(batch.batch_date),
        batch.id,
        validated.evidence.reference,
        `Opening balances as at ${isoDate(batch.batch_date)}`,
        input.actorUserId,
      ],
    );
    const journalId = inserted.rows[0]?.id;
    if (!journalId) {
      throw new AppError(500, 'OPENING_JOURNAL_CREATE_FAILED', 'The opening-balance journal could not be created.');
    }

    for (const [index, line] of validated.lines.entries()) {
      const schedule = line.schedule ?? {};
      await client.query(
        `INSERT INTO journal_lines (
           company_id, journal_id, line_no, account_id, party_reference, party_name,
           debit_poisha, credit_poisha, memo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.companyId,
          journalId,
          index + 1,
          line.accountId,
          line.scheduleType === 'PARTY' ? (schedule.reference ?? null) : null,
          line.scheduleType === 'PARTY' ? (schedule.name ?? null) : null,
          line.debitPoisha,
          line.creditPoisha,
          line.memo,
        ],
      );
    }

    const posted = await postJournalWithinTransaction(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      journalId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey ?? null,
      enforceApproval: false,
    });

    try {
      await client.query(
        `UPDATE opening_balance_batches
            SET status = 'POSTED', posted_at = now(), posted_by = $3, journal_id = $4,
                posting_idempotency_key = $5, updated_by = $3
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.batchId, input.actorUserId, journalId, input.idempotencyKey ?? null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another posting.');
      }
      throw error;
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'opening_balance.posted',
      entityType: 'opening_balance_batch',
      entityId: input.batchId,
      before: { status: 'APPROVED' },
      after: {
        status: 'POSTED',
        journalId,
        journalNumber: posted.journal.journalNumber,
        totalDebitPoisha: validated.totals.debit.toString(),
        totalCreditPoisha: validated.totals.credit.toString(),
        idempotencyKeyUsed: Boolean(input.idempotencyKey),
      },
      reason: 'Opening balances posted through the server ledger.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return {
      batch: await loadBatch(client, input.companyId, input.batchId),
      journal: posted.journal,
      replayed: false,
    };
  });
}
