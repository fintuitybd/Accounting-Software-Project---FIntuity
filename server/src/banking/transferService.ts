import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { formatJournalNumber } from '../ledger/journalNumber.ts';
import { postSystemJournalWithinTransaction, reverseJournalWithinTransaction } from '../ledger/ledgerService.ts';
import { loadBankAccount, loadPeriodForDate, type BankingAuditContext, type Queryable } from './common.ts';

export interface BankTransferDto {
  id: string;
  companyId: string;
  transferNumber: string;
  fromBankAccountId: string;
  fromBankAccountName: string;
  fromGlAccountCode: string;
  toBankAccountId: string;
  toBankAccountName: string;
  toGlAccountCode: string;
  transferDate: string;
  amountPoisha: string;
  amountBdt: string;
  reference: string;
  narration: string | null;
  status: 'POSTED' | 'REVERSED';
  journalId: string;
  journalNumber: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
}

interface BankTransferRow {
  id: string;
  company_id: string;
  transfer_number: string;
  from_bank_account_id: string;
  from_bank_account_name: string;
  from_gl_account_code: string;
  to_bank_account_id: string;
  to_bank_account_name: string;
  to_gl_account_code: string;
  transfer_date: Date;
  amount_poisha: string;
  reference: string;
  narration: string | null;
  status: string;
  journal_id: string;
  journal_number: string | null;
  reversal_journal_id: string | null;
  reversal_journal_number: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  reversed_at: Date | null;
  reversed_by_name: string | null;
}

const TRANSFER_SELECT = `
  SELECT t.id, t.company_id, t.transfer_number, t.from_bank_account_id,
         fb.name AS from_bank_account_name, fa.code AS from_gl_account_code,
         t.to_bank_account_id, tb.name AS to_bank_account_name, ta.code AS to_gl_account_code,
         t.transfer_date, t.amount_poisha::text AS amount_poisha, t.reference, t.narration,
         t.status, t.journal_id, j.journal_number, t.reversal_journal_id,
         rj.journal_number AS reversal_journal_number, t.created_by, cu.name AS created_by_name,
         t.created_at, t.reversed_at, ru.name AS reversed_by_name
    FROM bank_transfers t
    JOIN bank_accounts fb ON fb.company_id = t.company_id AND fb.id = t.from_bank_account_id
    JOIN accounts fa ON fa.company_id = t.company_id AND fa.id = fb.gl_account_id
    JOIN bank_accounts tb ON tb.company_id = t.company_id AND tb.id = t.to_bank_account_id
    JOIN accounts ta ON ta.company_id = t.company_id AND ta.id = tb.gl_account_id
    JOIN journals j ON j.company_id = t.company_id AND j.id = t.journal_id
    LEFT JOIN journals rj ON rj.company_id = t.company_id AND rj.id = t.reversal_journal_id
    JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users ru ON ru.id = t.reversed_by
`;

function mapTransfer(row: BankTransferRow): BankTransferDto {
  return {
    id: row.id,
    companyId: row.company_id,
    transferNumber: row.transfer_number,
    fromBankAccountId: row.from_bank_account_id,
    fromBankAccountName: row.from_bank_account_name,
    fromGlAccountCode: row.from_gl_account_code,
    toBankAccountId: row.to_bank_account_id,
    toBankAccountName: row.to_bank_account_name,
    toGlAccountCode: row.to_gl_account_code,
    transferDate: formatDatabaseDate(row.transfer_date),
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    reference: row.reference,
    narration: row.narration,
    status: row.status as 'POSTED' | 'REVERSED',
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalJournalId: row.reversal_journal_id,
    reversalJournalNumber: row.reversal_journal_number,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
  };
}

async function getTransfer(database: Queryable, companyId: string, transferId: string): Promise<BankTransferDto> {
  const result = await database.query<BankTransferRow>(`${TRANSFER_SELECT} WHERE t.company_id = $1 AND t.id = $2`, [
    companyId,
    transferId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_TRANSFER_NOT_FOUND', 'Bank transfer not found.');
  return mapTransfer(row);
}

export async function listBankTransfers(
  database: Queryable,
  companyId: string,
  options: {
    bankAccountId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: BankTransferDto[]; total: number; limit: number; offset: number }> {
  if (options.from && !isValidIsoDate(options.from)) {
    throw new AppError(400, 'INVALID_DATE', 'The from date must be a real YYYY-MM-DD date.');
  }
  if (options.to && !isValidIsoDate(options.to)) {
    throw new AppError(400, 'INVALID_DATE', 'The to date must be a real YYYY-MM-DD date.');
  }
  if (options.from && options.to && options.from > options.to) {
    throw new AppError(400, 'BANK_DATE_RANGE_INVALID', 'The from date must not be after the to date.');
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const values: unknown[] = [companyId];
  const where = ['t.company_id = $1'];
  if (options.bankAccountId) {
    values.push(options.bankAccountId);
    where.push(`(t.from_bank_account_id = $${values.length} OR t.to_bank_account_id = $${values.length})`);
  }
  if (options.from) {
    values.push(options.from);
    where.push(`t.transfer_date >= $${values.length}::date`);
  }
  if (options.to) {
    values.push(options.to);
    where.push(`t.transfer_date <= $${values.length}::date`);
  }
  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;
  const result = await database.query<BankTransferRow & { total_count: string }>(
    `SELECT t.id, t.company_id, t.transfer_number, t.from_bank_account_id,
            fb.name AS from_bank_account_name, fa.code AS from_gl_account_code,
            t.to_bank_account_id, tb.name AS to_bank_account_name, ta.code AS to_gl_account_code,
            t.transfer_date, t.amount_poisha::text AS amount_poisha, t.reference, t.narration,
            t.status, t.journal_id, j.journal_number, t.reversal_journal_id,
            rj.journal_number AS reversal_journal_number, t.created_by, cu.name AS created_by_name,
            t.created_at, t.reversed_at, ru.name AS reversed_by_name,
            COUNT(*) OVER() AS total_count
       FROM bank_transfers t
       JOIN bank_accounts fb ON fb.company_id = t.company_id AND fb.id = t.from_bank_account_id
       JOIN accounts fa ON fa.company_id = t.company_id AND fa.id = fb.gl_account_id
       JOIN bank_accounts tb ON tb.company_id = t.company_id AND tb.id = t.to_bank_account_id
       JOIN accounts ta ON ta.company_id = t.company_id AND ta.id = tb.gl_account_id
       JOIN journals j ON j.company_id = t.company_id AND j.id = t.journal_id
       LEFT JOIN journals rj ON rj.company_id = t.company_id AND rj.id = t.reversal_journal_id
       JOIN users cu ON cu.id = t.created_by
       LEFT JOIN users ru ON ru.id = t.reversed_by
      WHERE ${where.join(' AND ')}
      ORDER BY t.transfer_date DESC, t.created_at DESC, t.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  return {
    entries: result.rows.map(mapTransfer),
    total: Number(result.rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

export async function createBankTransfer(
  pool: Pool,
  input: BankingAuditContext & {
    fromBankAccountId: string;
    toBankAccountId: string;
    transferDate: string;
    amount: string;
    reference: string;
    narration?: string | null;
    idempotencyKey: string;
  },
): Promise<{ transfer: BankTransferDto; replayed: boolean }> {
  if (!isValidIsoDate(input.transferDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real transfer date in YYYY-MM-DD format.');
  }
  const amount = parseBdtToPoisha(input.amount);
  if (amount === null || amount <= 0n) {
    throw new AppError(
      400,
      'INVALID_AMOUNT',
      'The transfer amount must be a positive BDT amount with up to 2 decimals.',
    );
  }
  const reference = input.reference.trim();
  if (reference.length < 1 || reference.length > 200) {
    throw new AppError(
      400,
      'BANK_TRANSFER_REFERENCE_REQUIRED',
      'A transfer reference between 1 and 200 characters is required.',
    );
  }
  const narration = input.narration?.trim() || null;
  if (narration && narration.length > 500) {
    throw new AppError(400, 'BANK_TRANSFER_NARRATION_TOO_LONG', 'Narration must be at most 500 characters.');
  }
  if (input.fromBankAccountId === input.toBankAccountId) {
    throw new AppError(400, 'BANK_TRANSFER_SAME_ACCOUNT', 'Choose two different bank, MFS or cash accounts.');
  }

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bank-transfer:${input.companyId}`]);
    const existingKey = await client.query<{ id: string }>(
      `SELECT id FROM bank_transfers WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      return { transfer: await getTransfer(client, input.companyId, existingKey.rows[0].id), replayed: true };
    }
    const from = await loadBankAccount(client, input.companyId, input.fromBankAccountId, { requireActive: true });
    const to = await loadBankAccount(client, input.companyId, input.toBankAccountId, { requireActive: true });
    if (from.gl_account_id === to.gl_account_id) {
      throw new AppError(400, 'BANK_TRANSFER_SAME_GL', 'The two accounts map to the same GL account.');
    }
    const period = await loadPeriodForDate(client, input.companyId, input.transferDate);
    if (period.status !== 'OPEN') {
      throw new AppError(
        409,
        'PERIOD_NOT_OPEN',
        `The period ${period.code} is ${period.status}; transfers are accepted only in an OPEN period.`,
      );
    }
    const sequence = await client.query<{ id: string; prefix: string; pad: number; next_value: string }>(
      `SELECT id, prefix, pad, next_value::text AS next_value
         FROM number_sequences
        WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = 'BANK_TRANSFER'
        FOR UPDATE`,
      [input.companyId, period.fiscal_year_id],
    );
    const counter = sequence.rows[0];
    if (!counter) {
      throw new AppError(
        409,
        'BANK_TRANSFER_SEQUENCE_MISSING',
        'The BANK_TRANSFER number sequence is not configured for this fiscal year. Recreate or repair the fiscal-year numbering setup.',
      );
    }
    const sequenceValue = BigInt(counter.next_value);
    if (sequenceValue < 1n) {
      throw new AppError(409, 'BANK_TRANSFER_SEQUENCE_INVALID', 'The BANK_TRANSFER sequence value must be at least 1.');
    }
    const transferNumber = formatJournalNumber(counter.prefix, period.code, sequenceValue, counter.pad);
    await client.query(
      `UPDATE number_sequences SET next_value = $3, version = version + 1
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, counter.id, (sequenceValue + 1n).toString()],
    );

    const transferId = randomUUID();
    const journal = await postSystemJournalWithinTransaction(client, {
      ...input,
      companyId: input.companyId,
      date: input.transferDate,
      narration: `Bank transfer ${transferNumber} — ${from.name} to ${to.name}`,
      sourceModule: 'BANK_MFS',
      sourceDocId: transferId,
      sourceDocRef: transferNumber,
      lines: [
        {
          accountId: to.gl_account_id,
          debit: amount.toString(),
          credit: '0',
          memo: `Transfer from ${from.name}`,
        },
        {
          accountId: from.gl_account_id,
          debit: '0',
          credit: amount.toString(),
          memo: `Transfer to ${to.name}`,
        },
      ],
    });
    await client.query(
      `INSERT INTO bank_transfers (
         id, company_id, transfer_number, from_bank_account_id, to_bank_account_id,
         transfer_date, amount_poisha, reference, narration, status, journal_id,
         idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'POSTED',$10,$11,$12)`,
      [
        transferId,
        input.companyId,
        transferNumber,
        from.id,
        to.id,
        input.transferDate,
        amount.toString(),
        reference,
        narration,
        journal.id,
        input.idempotencyKey,
        input.actorUserId,
      ],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_transfer.posted',
      entityType: 'bank_transfer',
      entityId: transferId,
      after: {
        transferNumber,
        fromBankAccountId: from.id,
        toBankAccountId: to.id,
        amountPoisha: amount.toString(),
        transferDate: input.transferDate,
        reference,
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        status: 'POSTED',
      },
      reason: reference,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return { transfer: await getTransfer(client, input.companyId, transferId), replayed: false };
  });
}

export async function reverseBankTransfer(
  pool: Pool,
  input: BankingAuditContext & { transferId: string; date: string; reason: string },
): Promise<BankTransferDto> {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_TRANSFER_REVERSAL_REASON_REQUIRED',
      'A reversal reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      id: string;
      status: string;
      journal_id: string;
      transfer_number: string;
    }>(
      `SELECT id, status, journal_id, transfer_number FROM bank_transfers
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.transferId],
    );
    const row = existing.rows[0];
    if (!row) throw new AppError(404, 'BANK_TRANSFER_NOT_FOUND', 'Bank transfer not found.');
    if (row.status === 'REVERSED') {
      throw new AppError(409, 'BANK_TRANSFER_ALREADY_REVERSED', 'This bank transfer has already been reversed.');
    }
    const reversed = await reverseJournalWithinTransaction(client, {
      ...input,
      companyId: input.companyId,
      journalId: row.journal_id,
      date: input.date,
      reason: `Bank transfer ${row.transfer_number}: ${reason}`.slice(0, 500),
    });
    // The journal-reversal trigger may already have marked the transfer REVERSED in the same
    // transaction. Update it only while it is still POSTED so the transfer protection trigger is
    // not asked to mutate an already-reversed row.
    await client.query(
      `UPDATE bank_transfers
          SET status = 'REVERSED', reversal_journal_id = $3, reversed_at = now(), reversed_by = $4
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, row.id, reversed.reversal.id, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_transfer.reversed',
      entityType: 'bank_transfer',
      entityId: row.id,
      before: { status: 'POSTED', journalId: row.journal_id },
      after: {
        status: 'REVERSED',
        reversalJournalId: reversed.reversal.id,
        reversalJournalNumber: reversed.reversal.journalNumber,
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getTransfer(client, input.companyId, row.id);
  });
}

export async function getBankTransfer(
  database: Queryable,
  companyId: string,
  transferId: string,
): Promise<BankTransferDto> {
  return getTransfer(database, companyId, transferId);
}
