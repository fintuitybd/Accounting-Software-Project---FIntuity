import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import {
  createSystemJournalDraftWithinTransaction,
  loadJournal,
  postJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import {
  assertLineEditable,
  dateDifferenceInDays,
  loadBankAccount,
  loadBankStatementLine,
  mapBankStatementLine,
  normaliseReference,
  normaliseText,
  type BankGlRequestStatus,
  type BankMatchType,
  type BankStatementLineDto,
  type BankStatementLineRow,
  type BankingAuditContext,
  type Queryable,
} from './common.ts';

export interface MatchCandidateDto {
  journalId: string;
  journalLineId: string;
  journalNumber: string | null;
  postingDate: string;
  sourceModule: string;
  sourceDocRef: string | null;
  narration: string;
  partyName: string | null;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  availablePoisha: string;
  availableBdt: string;
  dateDifferenceDays: number;
  score: number;
  reason: string;
  suggestedType: BankMatchType;
  usesOtherStatementLines: boolean;
}

export interface BankStatementMatchDto {
  id: string;
  statementLineId: string;
  journalId: string;
  journalLineId: string;
  journalNumber: string | null;
  journalSourceModule: string;
  journalSourceDocRef: string | null;
  amountPoisha: string;
  amountBdt: string;
  matchType: BankMatchType;
  matchScore: number;
  reason: string;
  status: 'ACTIVE' | 'REVERSED';
  matchedBy: string;
  matchedByName: string;
  matchedAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

interface PatternRow {
  journal_line_id: string;
  journal_id: string;
  journal_number: string | null;
  posting_date: Date;
  source_module: string;
  source_doc_ref: string | null;
  narration_en: string;
  party_name: string | null;
  debit_poisha: string;
  credit_poisha: string;
  allocated_poisha: string;
  other_statement_lines: string;
}

interface MatchRow {
  id: string;
  statement_line_id: string;
  journal_id: string;
  journal_line_id: string;
  journal_number: string | null;
  journal_source_module: string;
  journal_source_doc_ref: string | null;
  amount_poisha: string;
  match_type: string;
  match_score: number;
  reason: string;
  status: string;
  matched_by: string;
  matched_by_name: string;
  matched_at: Date;
  reversed_at: Date | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
}

const MATCH_SELECT = `
  SELECT m.id, m.statement_line_id, m.journal_id, m.journal_line_id, j.journal_number,
         j.source_module AS journal_source_module, j.source_doc_ref AS journal_source_doc_ref,
         m.amount_poisha::text AS amount_poisha, m.match_type, m.match_score, m.reason, m.status,
         m.matched_by, mu.name AS matched_by_name, m.matched_at, m.reversed_at,
         ru.name AS reversed_by_name, m.reversal_reason
    FROM bank_statement_line_matches m
    JOIN journals j ON j.company_id = m.company_id AND j.id = m.journal_id
    JOIN users mu ON mu.id = m.matched_by
    LEFT JOIN users ru ON ru.id = m.reversed_by
`;

function mapMatch(row: MatchRow): BankStatementMatchDto {
  return {
    id: row.id,
    statementLineId: row.statement_line_id,
    journalId: row.journal_id,
    journalLineId: row.journal_line_id,
    journalNumber: row.journal_number,
    journalSourceModule: row.journal_source_module,
    journalSourceDocRef: row.journal_source_doc_ref,
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    matchType: row.match_type as BankMatchType,
    matchScore: row.match_score,
    reason: row.reason,
    status: row.status as 'ACTIVE' | 'REVERSED',
    matchedBy: row.matched_by,
    matchedByName: row.matched_by_name,
    matchedAt: row.matched_at.toISOString(),
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    reversalReason: row.reversal_reason,
  };
}

export async function listLineMatches(
  database: Queryable,
  companyId: string,
  lineId: string,
): Promise<BankStatementMatchDto[]> {
  const result = await database.query<MatchRow>(
    `${MATCH_SELECT} WHERE m.company_id = $1 AND m.statement_line_id = $2
      ORDER BY m.matched_at ASC, m.id ASC`,
    [companyId, lineId],
  );
  return result.rows.map(mapMatch);
}

async function activeAllocatedOnLine(database: Queryable, companyId: string, lineId: string): Promise<bigint> {
  const result = await database.query<{ allocated: string }>(
    `SELECT COALESCE(sum(amount_poisha), 0)::text AS allocated
       FROM bank_statement_line_matches
      WHERE company_id = $1 AND statement_line_id = $2 AND status = 'ACTIVE'`,
    [companyId, lineId],
  );
  return BigInt(result.rows[0]?.allocated ?? '0');
}

function lineRemaining(line: BankStatementLineRow): bigint {
  return BigInt(line.debit_poisha) + BigInt(line.credit_poisha);
}

function candidateScore(
  line: BankStatementLineRow,
  row: PatternRow,
  remaining: bigint,
  available: bigint,
): { score: number; reason: string; suggestedType: BankMatchType; dateDifferenceDays: number } {
  const postingDate = formatDatabaseDate(row.posting_date);
  const dateDifference = dateDifferenceInDays(formatDatabaseDate(line.value_date), postingDate);
  const exactAmount = available === remaining;
  const amountScore = exactAmount ? 50 : available >= remaining || remaining >= available ? 35 : 10;
  const dateScore = Math.max(0, 30 - dateDifference * 4);
  const lineReference = normaliseReference(line.reference);
  const haystack = normaliseReference(
    `${row.source_doc_ref ?? ''} ${row.narration_en} ${row.journal_number ?? ''} ${row.party_name ?? ''}`,
  );
  const referenceScore = lineReference && haystack.includes(lineReference) ? 15 : 0;
  const partyScore = row.party_name && normaliseText(line.description).includes(normaliseText(row.party_name)) ? 5 : 0;
  const score = Math.min(100, amountScore + dateScore + referenceScore + partyScore);
  const usesOtherStatementLines = BigInt(row.other_statement_lines) > 0n;
  const suggestedType: BankMatchType = usesOtherStatementLines
    ? 'SPLIT'
    : exactAmount && dateDifference === 0
      ? 'EXACT'
      : 'PARTIAL';
  const reasons = [
    exactAmount
      ? `Exact available amount ${formatPoishaAsBdt(available)} BDT`
      : `Candidate has ${formatPoishaAsBdt(available)} BDT available against ${formatPoishaAsBdt(remaining)} BDT remaining`,
    dateDifference === 0 ? 'same posting date' : `${dateDifference} day(s) from the statement date`,
    referenceScore > 0 ? 'reference matched' : 'reference not matched',
    usesOtherStatementLines ? 'journal line already allocated to another statement line, explicit split required' : '',
  ].filter(Boolean);
  return {
    score,
    reason: `${reasons.join('; ')}.`,
    suggestedType,
    dateDifferenceDays: dateDifference,
  };
}

export async function listMatchCandidates(
  database: Queryable,
  companyId: string,
  lineId: string,
  options: { windowDays?: number; limit?: number } = {},
): Promise<{ line: BankStatementLineDto; remainingPoisha: string; candidates: MatchCandidateDto[] }> {
  const line = await loadBankStatementLine(database, companyId, lineId);
  const bank = await loadBankAccount(database, companyId, line.bank_account_id);
  const windowDays = Math.min(Math.max(options.windowDays ?? 7, 0), 31);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const allocated = await activeAllocatedOnLine(database, companyId, lineId);
  const total = lineRemaining(line);
  const remaining = total - allocated;
  if (remaining <= 0n) {
    return { line: mapBankStatementLine(line), remainingPoisha: '0', candidates: [] };
  }
  const direction = BigInt(line.debit_poisha) > 0n ? 'DEBIT' : 'CREDIT';
  const result = await database.query<PatternRow>(
    `SELECT jl.id AS journal_line_id, jl.journal_id, j.journal_number, j.posting_date,
            j.source_module, j.source_doc_ref, j.narration_en, jl.party_name,
            jl.debit_poisha::text AS debit_poisha, jl.credit_poisha::text AS credit_poisha,
            COALESCE(a.allocated, 0)::text AS allocated_poisha,
            COALESCE(a.other_statement_lines, 0)::text AS other_statement_lines
       FROM journal_lines jl
       JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
       LEFT JOIN LATERAL (
         SELECT sum(m.amount_poisha) AS allocated,
                count(DISTINCT m.statement_line_id) FILTER (WHERE m.statement_line_id <> $4) AS other_statement_lines
           FROM bank_statement_line_matches m
          WHERE m.company_id = jl.company_id AND m.journal_line_id = jl.id AND m.status = 'ACTIVE'
       ) a ON true
      WHERE jl.company_id = $1
        AND jl.account_id = $2
        AND j.status = 'POSTED'
        AND j.source_module <> 'OPENING_BALANCE'
        AND j.posting_date BETWEEN $3::date - $5::int AND $3::date + $5::int
        AND (($6 = 'DEBIT' AND jl.debit_poisha > 0) OR ($6 = 'CREDIT' AND jl.credit_poisha > 0))
        AND (jl.debit_poisha + jl.credit_poisha) > COALESCE(a.allocated, 0)
      ORDER BY abs(j.posting_date - $3::date), j.posting_date, j.journal_number, jl.line_no
      LIMIT $7`,
    [companyId, bank.gl_account_id, formatDatabaseDate(line.value_date), lineId, windowDays, direction, limit],
  );
  const candidates = result.rows
    .map((row): MatchCandidateDto => {
      const available = BigInt(row.debit_poisha) + BigInt(row.credit_poisha) - BigInt(row.allocated_poisha);
      const scored = candidateScore(line, row, remaining, available);
      return {
        journalId: row.journal_id,
        journalLineId: row.journal_line_id,
        journalNumber: row.journal_number,
        postingDate: formatDatabaseDate(row.posting_date),
        sourceModule: row.source_module,
        sourceDocRef: row.source_doc_ref,
        narration: row.narration_en,
        partyName: row.party_name,
        amountPoisha: (BigInt(row.debit_poisha) + BigInt(row.credit_poisha)).toString(),
        amountBdt: formatPoishaAsBdt(BigInt(row.debit_poisha) + BigInt(row.credit_poisha)),
        allocatedPoisha: row.allocated_poisha,
        availablePoisha: available.toString(),
        availableBdt: formatPoishaAsBdt(available),
        dateDifferenceDays: scored.dateDifferenceDays,
        score: scored.score,
        reason: scored.reason,
        suggestedType: scored.suggestedType,
        usesOtherStatementLines: BigInt(row.other_statement_lines) > 0n,
      };
    })
    .sort((left, right) =>
      right.score === left.score
        ? left.dateDifferenceDays === right.dateDifferenceDays
          ? (left.journalNumber ?? '').localeCompare(right.journalNumber ?? '')
          : left.dateDifferenceDays - right.dateDifferenceDays
        : right.score - left.score,
    );
  return { line: mapBankStatementLine(line), remainingPoisha: remaining.toString(), candidates };
}

export interface MatchAllocationInput {
  journalId: string;
  journalLineId: string;
  amount: string;
}

export async function matchStatementLine(
  pool: Pool,
  input: BankingAuditContext & {
    lineId: string;
    allocations: MatchAllocationInput[];
    matchType?: BankMatchType;
    reason: string;
  },
): Promise<{ line: BankStatementLineDto; matches: BankStatementMatchDto[] }> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_MATCH_REASON_REQUIRED',
      'A matching reason between 3 and 500 characters is required.',
    );
  }
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new AppError(400, 'BANK_MATCH_ALLOCATIONS_REQUIRED', 'Select at least one journal line to match.');
  }
  const seen = new Set<string>();
  for (const allocation of input.allocations) {
    if (seen.has(allocation.journalLineId)) {
      throw new AppError(400, 'BANK_MATCH_DUPLICATE_ALLOCATION', 'The same journal line appears twice in one match.');
    }
    seen.add(allocation.journalLineId);
  }
  return withTransaction(pool, async (client) => {
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    if (line.status === 'MATCHED') {
      throw new AppError(409, 'BANK_LINE_ALREADY_MATCHED', 'This statement line is already fully matched.');
    }
    if (line.status === 'EXCLUDED') {
      throw new AppError(409, 'BANK_LINE_EXCLUDED', 'An excluded statement line cannot be matched.');
    }
    const openGlRequest = await client.query(
      `SELECT 1 FROM bank_gl_requests
        WHERE company_id = $1 AND statement_line_id = $2
          AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
        LIMIT 1`,
      [input.companyId, line.id],
    );
    if (openGlRequest.rowCount && openGlRequest.rowCount > 0) {
      throw new AppError(
        409,
        'BANK_LINE_HAS_OPEN_GL_REQUEST',
        'An open create-GL request controls this line. Approve it or cancel it before matching manually.',
      );
    }
    const bank = await loadBankAccount(client, input.companyId, line.bank_account_id, { requireActive: true });
    const alreadyAllocated = await activeAllocatedOnLine(client, input.companyId, line.id);
    const total = lineRemaining(line);
    const remaining = total - alreadyAllocated;
    if (remaining <= 0n) {
      throw new AppError(409, 'BANK_LINE_ALREADY_MATCHED', 'This statement line has no unmatched amount left.');
    }

    const parsedAllocations: Array<{
      journalId: string;
      journalLineId: string;
      amount: bigint;
      amountPoisha: bigint;
      available: bigint;
      reuseJournalLine: boolean;
      score: number;
      candidateReason: string;
      dateDifferenceDays: number;
      amountOnJournalLine: bigint;
    }> = [];
    let requestedTotal = 0n;
    for (const allocation of input.allocations) {
      const amount = parseBdtToPoisha(allocation.amount);
      if (amount === null || amount <= 0n) {
        throw new AppError(
          400,
          'INVALID_AMOUNT',
          'Each match amount must be a positive BDT amount with up to 2 decimals.',
        );
      }
      requestedTotal += amount;
      parsedAllocations.push({
        journalId: allocation.journalId,
        journalLineId: allocation.journalLineId,
        amount,
        amountPoisha: amount,
        available: 0n,
        reuseJournalLine: false,
        score: 0,
        candidateReason: '',
        dateDifferenceDays: 0,
        amountOnJournalLine: 0n,
      });
    }
    if (requestedTotal > remaining) {
      throw new AppError(
        409,
        'BANK_MATCH_LINE_EXHAUSTED',
        `The requested match ${formatPoishaAsBdt(requestedTotal)} BDT exceeds the ${formatPoishaAsBdt(remaining)} BDT remaining on the statement line.`,
        { remainingBdt: formatPoishaAsBdt(remaining) },
      );
    }

    // Lock journal lines in a stable order so two accountants matching the same entries cannot
    // over-allocate them in opposite orders.
    const sorted = [...parsedAllocations].sort((left, right) => left.journalLineId.localeCompare(right.journalLineId));
    let reuseJournalLine = false;
    for (const allocation of sorted) {
      const result = await client.query<{
        journal_id: string;
        journal_line_id: string;
        account_id: string;
        debit_poisha: string;
        credit_poisha: string;
        journal_status: string;
        journal_number: string | null;
        posting_date: Date;
        source_module: string;
        source_doc_ref: string | null;
        narration_en: string;
        party_name: string | null;
        allocated_poisha: string;
        other_statement_lines: string;
      }>(
        `SELECT jl.journal_id, jl.id AS journal_line_id, jl.account_id,
                jl.debit_poisha::text AS debit_poisha, jl.credit_poisha::text AS credit_poisha,
                j.status AS journal_status, j.journal_number, j.posting_date, j.source_module,
                j.source_doc_ref, j.narration_en, jl.party_name,
                COALESCE(a.allocated, 0)::text AS allocated_poisha,
                COALESCE(a.other_statement_lines, 0)::text AS other_statement_lines
           FROM journal_lines jl
           JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
           LEFT JOIN LATERAL (
             SELECT sum(m.amount_poisha) AS allocated,
                    count(DISTINCT m.statement_line_id) FILTER (WHERE m.statement_line_id <> $3) AS other_statement_lines
               FROM bank_statement_line_matches m
              WHERE m.company_id = jl.company_id AND m.journal_line_id = jl.id AND m.status = 'ACTIVE'
           ) a ON true
          WHERE jl.company_id = $1 AND jl.id = $2
          FOR UPDATE OF jl, j`,
        [input.companyId, allocation.journalLineId, line.id],
      );
      const row = result.rows[0];
      if (!row) {
        throw new AppError(404, 'BANK_MATCH_JOURNAL_LINE_NOT_FOUND', 'The selected journal line was not found.');
      }
      if (row.journal_id !== allocation.journalId) {
        throw new AppError(
          409,
          'BANK_MATCH_JOURNAL_MISMATCH',
          'The selected journal line does not belong to the selected journal.',
        );
      }
      if (row.journal_status !== 'POSTED') {
        throw new AppError(409, 'BANK_MATCH_JOURNAL_NOT_POSTED', 'Only a posted journal can be matched.');
      }
      if (row.account_id !== bank.gl_account_id) {
        throw new AppError(
          409,
          'BANK_MATCH_ACCOUNT_MISMATCH',
          'The journal line is not on this bank account GL account.',
        );
      }
      const statementDebit = BigInt(line.debit_poisha) > 0n;
      if (statementDebit && BigInt(row.debit_poisha) === 0n) {
        throw new AppError(
          409,
          'BANK_MATCH_DIRECTION_MISMATCH',
          'A money-in statement line must match a debit to the bank account.',
        );
      }
      if (!statementDebit && BigInt(row.credit_poisha) === 0n) {
        throw new AppError(
          409,
          'BANK_MATCH_DIRECTION_MISMATCH',
          'A money-out statement line must match a credit to the bank account.',
        );
      }
      const journalLineAmount = BigInt(row.debit_poisha) + BigInt(row.credit_poisha);
      const available = journalLineAmount - BigInt(row.allocated_poisha);
      if (available <= 0n) {
        throw new AppError(
          409,
          'BANK_MATCH_JOURNAL_EXHAUSTED',
          `Journal ${row.journal_number ?? allocation.journalId} has no unallocated amount on that line.`,
        );
      }
      if (allocation.amount > available) {
        throw new AppError(
          409,
          'BANK_MATCH_JOURNAL_EXHAUSTED',
          `The requested amount exceeds the ${formatPoishaAsBdt(available)} BDT still available on journal ${row.journal_number ?? allocation.journalId}.`,
          { availableBdt: formatPoishaAsBdt(available) },
        );
      }
      const usesOtherStatementLines = BigInt(row.other_statement_lines) > 0n;
      if (usesOtherStatementLines) reuseJournalLine = true;
      const scored = candidateScore(
        line,
        {
          journal_line_id: row.journal_line_id,
          journal_id: row.journal_id,
          journal_number: row.journal_number,
          posting_date: row.posting_date,
          source_module: row.source_module,
          source_doc_ref: row.source_doc_ref,
          narration_en: row.narration_en,
          party_name: row.party_name,
          debit_poisha: row.debit_poisha,
          credit_poisha: row.credit_poisha,
          allocated_poisha: row.allocated_poisha,
          other_statement_lines: row.other_statement_lines,
        },
        remaining,
        available,
      );
      allocation.available = available;
      allocation.reuseJournalLine = usesOtherStatementLines;
      allocation.score = scored.score;
      allocation.candidateReason = scored.reason;
      allocation.dateDifferenceDays = scored.dateDifferenceDays;
      allocation.amountOnJournalLine = journalLineAmount;
    }

    const effectiveType: BankMatchType =
      input.matchType ??
      (reuseJournalLine ? 'SPLIT' : alreadyAllocated > 0n || requestedTotal < remaining ? 'PARTIAL' : 'EXACT');
    if (reuseJournalLine && effectiveType !== 'SPLIT') {
      throw new AppError(
        409,
        'BANK_MATCH_SPLIT_REQUIRED',
        'This journal line is already allocated to another statement line. Use an explicit SPLIT match.',
      );
    }
    if (alreadyAllocated > 0n && effectiveType === 'EXACT') {
      throw new AppError(
        409,
        'BANK_MATCH_PARTIAL_REQUIRED',
        'This statement line already has a partial match. Use PARTIAL or SPLIT for the remaining amount.',
      );
    }
    if (requestedTotal < remaining && effectiveType === 'EXACT') {
      throw new AppError(
        409,
        'BANK_MATCH_PARTIAL_REQUIRED',
        'The selected amount is less than the statement line remaining. Use PARTIAL or SPLIT.',
      );
    }

    const insertedIds: string[] = [];
    for (const allocation of sorted) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bank_statement_line_matches (
           company_id, bank_account_id, statement_line_id, journal_id, journal_line_id,
           amount_poisha, match_type, match_score, reason, status, matched_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10)
         RETURNING id`,
        [
          input.companyId,
          line.bank_account_id,
          line.id,
          allocation.journalId,
          allocation.journalLineId,
          allocation.amount.toString(),
          effectiveType,
          allocation.score,
          reason,
          input.actorUserId,
        ],
      );
      insertedIds.push(inserted.rows[0]!.id);
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_statement_line.matched',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status, matchedAmountPoisha: alreadyAllocated.toString() },
      after: {
        status: requestedTotal === remaining ? 'MATCHED' : 'PARTIALLY_MATCHED',
        matchedAmountPoisha: (alreadyAllocated + requestedTotal).toString(),
        matchType: effectiveType,
        matchIds: insertedIds,
        allocations: sorted.map((allocation) => ({
          journalId: allocation.journalId,
          journalLineId: allocation.journalLineId,
          amountPoisha: allocation.amount.toString(),
        })),
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const updated = await loadBankStatementLine(client, input.companyId, line.id);
    return {
      line: mapBankStatementLine(updated),
      matches: await listLineMatches(client, input.companyId, line.id),
    };
  });
}

export async function unmatchStatementLine(
  pool: Pool,
  input: BankingAuditContext & { lineId: string; reason: string },
): Promise<{ line: BankStatementLineDto; matches: BankStatementMatchDto[] }> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_UNMATCH_REASON_REQUIRED',
      'An unmatch reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    const active = await client.query<{ id: string }>(
      `SELECT id FROM bank_statement_line_matches
        WHERE company_id = $1 AND statement_line_id = $2 AND status = 'ACTIVE'
        FOR UPDATE`,
      [input.companyId, line.id],
    );
    if (active.rows.length === 0) {
      throw new AppError(409, 'BANK_LINE_NOT_MATCHED', 'This statement line has no active matches to remove.');
    }
    await client.query(
      `UPDATE bank_statement_line_matches
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3, reversal_reason = $4
        WHERE company_id = $1 AND statement_line_id = $2 AND status = 'ACTIVE'`,
      [input.companyId, line.id, input.actorUserId, reason],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_statement_line.unmatched',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status, matchIds: active.rows.map((row) => row.id) },
      after: { status: 'UNMATCHED' },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const updated = await loadBankStatementLine(client, input.companyId, line.id);
    return {
      line: mapBankStatementLine(updated),
      matches: await listLineMatches(client, input.companyId, line.id),
    };
  });
}

export async function assignBankLineException(
  pool: Pool,
  input: BankingAuditContext & {
    lineId: string;
    ownerUserId: string;
    note: string;
  },
): Promise<BankStatementLineDto> {
  const note = input.note.trim();
  if (note.length < 3 || note.length > 500) {
    throw new AppError(
      400,
      'BANK_EXCEPTION_NOTE_REQUIRED',
      'An exception note between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    const owner = await client.query<{ id: string }>(
      `SELECT u.id
         FROM users u
         JOIN memberships m ON m.user_id = u.id AND m.status = 'ACTIVE'
         JOIN company_memberships cm ON cm.membership_id = m.id AND cm.status = 'ACTIVE'
        WHERE cm.company_id = $1 AND u.id = $2 AND u.status = 'ACTIVE'
          AND COALESCE(cm.role_override, m.role) IN ('OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT')`,
      [input.companyId, input.ownerUserId],
    );
    if (!owner.rows[0]) {
      throw new AppError(
        400,
        'BANK_EXCEPTION_OWNER_INVALID',
        'The exception owner must be an active member of this company.',
      );
    }
    await client.query(
      `UPDATE bank_statement_lines
          SET exception_owner_id = $3, exception_note = $4, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, line.id, input.ownerUserId, note],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_statement_line.exception_assigned',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { ownerUserId: line.exception_owner_id, note: line.exception_note },
      after: { ownerUserId: input.ownerUserId, note },
      reason: note,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return mapBankStatementLine(await loadBankStatementLine(client, input.companyId, line.id));
  });
}

export async function excludeBankLine(
  pool: Pool,
  input: BankingAuditContext & { lineId: string; reason: string },
): Promise<BankStatementLineDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_EXCLUDE_REASON_REQUIRED',
      'An exclusion reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    if (line.status === 'MATCHED') {
      throw new AppError(409, 'BANK_LINE_ALREADY_MATCHED', 'Unmatch the line before excluding it.');
    }
    if (line.status === 'EXCLUDED') {
      throw new AppError(409, 'BANK_LINE_ALREADY_EXCLUDED', 'This line is already excluded.');
    }
    const activeMatches = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bank_statement_line_matches
        WHERE company_id = $1 AND statement_line_id = $2 AND status = 'ACTIVE'`,
      [input.companyId, line.id],
    );
    if (Number(activeMatches.rows[0]?.count ?? '0') > 0) {
      throw new AppError(
        409,
        'BANK_LINE_HAS_ACTIVE_MATCH',
        'Unmatch the active allocations before excluding the line.',
      );
    }
    const openRequest = await client.query(
      `SELECT 1 FROM bank_gl_requests
        WHERE company_id = $1 AND statement_line_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
        LIMIT 1`,
      [input.companyId, line.id],
    );
    if (openRequest.rowCount && openRequest.rowCount > 0) {
      throw new AppError(
        409,
        'BANK_LINE_HAS_OPEN_GL_REQUEST',
        'Cancel the open create-GL request before excluding the line.',
      );
    }
    await client.query(
      `UPDATE bank_statement_lines
          SET status = 'EXCLUDED', excluded_reason = $3, exception_note = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, line.id, reason],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_statement_line.excluded',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status },
      after: { status: 'EXCLUDED', reason },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return mapBankStatementLine(await loadBankStatementLine(client, input.companyId, line.id));
  });
}

export type BankGlRequestDto = {
  id: string;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  statementLineId: string;
  status: BankGlRequestStatus;
  amountPoisha: string;
  amountBdt: string;
  taxPoisha: string;
  taxBdt: string;
  primaryAccountId: string;
  primaryAccountCode: string;
  primaryAccountName: string;
  taxAccountId: string | null;
  taxAccountCode: string | null;
  taxAccountName: string | null;
  partyId: string | null;
  partyName: string | null;
  reason: string;
  evidenceReference: string | null;
  journalId: string | null;
  journalNumber: string | null;
  journalStatus: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  createdAt: string;
};

interface BankGlRequestRow {
  id: string;
  company_id: string;
  bank_account_id: string;
  bank_account_name: string;
  statement_line_id: string;
  status: string;
  amount_poisha: string;
  tax_poisha: string;
  primary_account_id: string;
  primary_account_code: string;
  primary_account_name: string;
  tax_account_id: string | null;
  tax_account_code: string | null;
  tax_account_name: string | null;
  party_id: string | null;
  party_name: string | null;
  reason: string;
  evidence_reference: string | null;
  journal_id: string | null;
  journal_number: string | null;
  journal_status: string | null;
  created_by: string;
  created_by_name: string;
  submitted_at: Date | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  posted_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  reversal_journal_id: string | null;
  reversal_journal_number: string | null;
  reversed_at: Date | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
  created_at: Date;
}

const GL_REQUEST_SELECT = `
  SELECT r.id, r.company_id, r.bank_account_id, ba.name AS bank_account_name,
         r.statement_line_id, r.status, r.amount_poisha::text AS amount_poisha,
         r.tax_poisha::text AS tax_poisha, r.primary_account_id,
         pa.code AS primary_account_code, pa.name_en AS primary_account_name,
         r.tax_account_id, ta.code AS tax_account_code, ta.name_en AS tax_account_name,
         r.party_id, p.name_en AS party_name, r.reason, r.evidence_reference,
         r.journal_id, j.journal_number, j.status AS journal_status,
         r.created_by, cu.name AS created_by_name, r.submitted_at,
         r.approved_by, au.name AS approved_by_name, r.approved_at, r.posted_at,
         r.cancelled_at, r.cancellation_reason,
         r.reversal_journal_id, rj.journal_number AS reversal_journal_number,
         r.reversed_at, ru.name AS reversed_by_name, r.reversal_reason, r.created_at
    FROM bank_gl_requests r
    JOIN bank_accounts ba ON ba.company_id = r.company_id AND ba.id = r.bank_account_id
    JOIN accounts pa ON pa.company_id = r.company_id AND pa.id = r.primary_account_id
    LEFT JOIN accounts ta ON ta.company_id = r.company_id AND ta.id = r.tax_account_id
    LEFT JOIN parties p ON p.company_id = r.company_id AND p.id = r.party_id
    LEFT JOIN journals j ON j.company_id = r.company_id AND j.id = r.journal_id
    LEFT JOIN journals rj ON rj.company_id = r.company_id AND rj.id = r.reversal_journal_id
    JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users au ON au.id = r.approved_by
    LEFT JOIN users ru ON ru.id = r.reversed_by
`;

function mapGlRequest(row: BankGlRequestRow): BankGlRequestDto {
  return {
    id: row.id,
    companyId: row.company_id,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    statementLineId: row.statement_line_id,
    status: row.status as BankGlRequestStatus,
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    taxPoisha: row.tax_poisha,
    taxBdt: formatPoishaAsBdt(row.tax_poisha),
    primaryAccountId: row.primary_account_id,
    primaryAccountCode: row.primary_account_code,
    primaryAccountName: row.primary_account_name,
    taxAccountId: row.tax_account_id,
    taxAccountCode: row.tax_account_code,
    taxAccountName: row.tax_account_name,
    partyId: row.party_id,
    partyName: row.party_name,
    reason: row.reason,
    evidenceReference: row.evidence_reference,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    journalStatus: row.journal_status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    postedAt: row.posted_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancellationReason: row.cancellation_reason,
    reversalJournalId: row.reversal_journal_id,
    reversalJournalNumber: row.reversal_journal_number,
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    reversalReason: row.reversal_reason,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getBankGlRequest(
  database: Queryable,
  companyId: string,
  requestId: string,
): Promise<BankGlRequestDto> {
  const result = await database.query<BankGlRequestRow>(`${GL_REQUEST_SELECT} WHERE r.company_id = $1 AND r.id = $2`, [
    companyId,
    requestId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_GL_REQUEST_NOT_FOUND', 'Create-GL request not found.');
  return mapGlRequest(row);
}

export async function listBankGlRequests(
  database: Queryable,
  companyId: string,
  options: { status?: string; bankAccountId?: string; statementLineId?: string; limit?: number; offset?: number } = {},
): Promise<{ entries: BankGlRequestDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const values: unknown[] = [companyId];
  const where = ['r.company_id = $1'];
  if (options.status) {
    values.push(options.status);
    where.push(`r.status = $${values.length}`);
  }
  if (options.bankAccountId) {
    values.push(options.bankAccountId);
    where.push(`r.bank_account_id = $${values.length}`);
  }
  if (options.statementLineId) {
    values.push(options.statementLineId);
    where.push(`r.statement_line_id = $${values.length}`);
  }
  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;
  const result = await database.query<BankGlRequestRow & { total_count: string }>(
    `SELECT r.id, r.company_id, r.bank_account_id, ba.name AS bank_account_name,
            r.statement_line_id, r.status, r.amount_poisha::text AS amount_poisha,
            r.tax_poisha::text AS tax_poisha, r.primary_account_id,
            pa.code AS primary_account_code, pa.name_en AS primary_account_name,
            r.tax_account_id, ta.code AS tax_account_code, ta.name_en AS tax_account_name,
            r.party_id, p.name_en AS party_name, r.reason, r.evidence_reference,
            r.journal_id, j.journal_number, j.status AS journal_status,
            r.created_by, cu.name AS created_by_name, r.submitted_at,
            r.approved_by, au.name AS approved_by_name, r.approved_at, r.posted_at,
            r.cancelled_at, r.cancellation_reason,
            r.reversal_journal_id, rj.journal_number AS reversal_journal_number,
            r.reversed_at, ru.name AS reversed_by_name, r.reversal_reason, r.created_at,
            COUNT(*) OVER() AS total_count
       FROM bank_gl_requests r
       JOIN bank_accounts ba ON ba.company_id = r.company_id AND ba.id = r.bank_account_id
       JOIN accounts pa ON pa.company_id = r.company_id AND pa.id = r.primary_account_id
       LEFT JOIN accounts ta ON ta.company_id = r.company_id AND ta.id = r.tax_account_id
       LEFT JOIN parties p ON p.company_id = r.company_id AND p.id = r.party_id
       LEFT JOIN journals j ON j.company_id = r.company_id AND j.id = r.journal_id
       LEFT JOIN journals rj ON rj.company_id = r.company_id AND rj.id = r.reversal_journal_id
       JOIN users cu ON cu.id = r.created_by
       LEFT JOIN users au ON au.id = r.approved_by
       LEFT JOIN users ru ON ru.id = r.reversed_by
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  return {
    entries: result.rows.map(mapGlRequest),
    total: Number(result.rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

interface AccountValidationRow {
  id: string;
  code: string;
  name_en: string;
  account_type: string;
  is_active: boolean;
}

async function validateGlAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
  bankGlAccountId: string,
  field: string,
): Promise<AccountValidationRow> {
  const result = await database.query<AccountValidationRow>(
    `SELECT id, code, name_en, account_type, is_active
       FROM accounts WHERE company_id = $1 AND id = $2`,
    [companyId, accountId],
  );
  const account = result.rows[0];
  if (!account) {
    throw new AppError(400, 'BANK_GL_ACCOUNT_INVALID', `The ${field} account does not exist in this company.`);
  }
  if (!account.is_active) {
    throw new AppError(400, 'BANK_GL_ACCOUNT_INACTIVE', `The ${field} account is inactive.`);
  }
  if (account.id === bankGlAccountId) {
    throw new AppError(400, 'BANK_GL_ACCOUNT_INVALID', `The ${field} account cannot be the bank account itself.`);
  }
  if (account.account_type === 'EQUITY') {
    throw new AppError(
      400,
      'BANK_GL_ACCOUNT_INVALID',
      `Unexplained bank activity cannot be posted directly to an equity account (${field}). Choose an asset, liability, revenue or expense account and document the reason.`,
    );
  }
  return account;
}

export async function createBankGlRequest(
  pool: Pool,
  input: BankingAuditContext & {
    lineId: string;
    amount: string;
    primaryAccountId: string;
    taxPoisha?: string;
    taxAccountId?: string | null;
    partyId?: string | null;
    reason: string;
    evidenceReference?: string | null;
    idempotencyKey: string;
  },
): Promise<{ request: BankGlRequestDto; replayed: boolean }> {
  const amount = parseBdtToPoisha(input.amount);
  if (amount === null || amount <= 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'The GL amount must be a positive BDT amount with up to 2 decimals.');
  }
  const tax = input.taxPoisha ? parseBdtToPoisha(input.taxPoisha) : 0n;
  if (tax === null || tax < 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Tax must be a non-negative BDT amount with up to 2 decimals.');
  }
  if (tax > amount) {
    throw new AppError(400, 'BANK_GL_TAX_EXCEEDS_AMOUNT', 'Tax cannot exceed the statement amount being categorised.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'BANK_GL_REASON_REQUIRED', 'A reason between 3 and 500 characters is required.');
  }
  const evidenceReference = input.evidenceReference?.trim() || null;
  if (evidenceReference && evidenceReference.length > 500) {
    throw new AppError(400, 'BANK_GL_EVIDENCE_TOO_LONG', 'Evidence reference must be at most 500 characters.');
  }

  return withTransaction(pool, async (client) => {
    const existingKey = await client.query<{ id: string; statement_line_id: string }>(
      `SELECT id, statement_line_id FROM bank_gl_requests
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      if (existingKey.rows[0].statement_line_id !== input.lineId) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'That Idempotency-Key was already used for another statement line.',
        );
      }
      return {
        request: await getBankGlRequest(client, input.companyId, existingKey.rows[0].id),
        replayed: true,
      };
    }
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    if (line.status === 'MATCHED') {
      throw new AppError(409, 'BANK_LINE_ALREADY_MATCHED', 'This statement line is already fully matched.');
    }
    if (line.status === 'EXCLUDED') {
      throw new AppError(409, 'BANK_LINE_EXCLUDED', 'An excluded statement line cannot be categorised.');
    }
    const bank = await loadBankAccount(client, input.companyId, line.bank_account_id, { requireActive: true });
    const allocated = await activeAllocatedOnLine(client, input.companyId, line.id);
    const remaining = lineRemaining(line) - allocated;
    if (amount > remaining) {
      throw new AppError(
        409,
        'BANK_GL_EXCEEDS_REMAINING',
        `The GL amount exceeds the ${formatPoishaAsBdt(remaining)} BDT remaining on the statement line.`,
        { remainingBdt: formatPoishaAsBdt(remaining) },
      );
    }
    const primary = await validateGlAccount(
      client,
      input.companyId,
      input.primaryAccountId,
      bank.gl_account_id,
      'primary',
    );
    let taxAccount: AccountValidationRow | null = null;
    if (tax > 0n) {
      if (!input.taxAccountId) {
        throw new AppError(
          400,
          'BANK_GL_TAX_ACCOUNT_REQUIRED',
          'Choose the tax account when the categorised amount includes tax.',
        );
      }
      taxAccount = await validateGlAccount(client, input.companyId, input.taxAccountId, bank.gl_account_id, 'tax');
    }
    let partyName: string | null = null;
    if (input.partyId) {
      const party = await client.query<{ name_en: string; status: string }>(
        `SELECT name_en, status FROM parties WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.partyId],
      );
      if (!party.rows[0]) {
        throw new AppError(400, 'BANK_PARTY_INVALID', 'The party does not exist in this company.');
      }
      if (party.rows[0].status !== 'ACTIVE') {
        throw new AppError(400, 'BANK_PARTY_INACTIVE', 'The party is inactive.');
      }
      partyName = party.rows[0].name_en;
    }
    const openRequest = await client.query(
      `SELECT 1 FROM bank_gl_requests
        WHERE company_id = $1 AND statement_line_id = $2
          AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED') LIMIT 1`,
      [input.companyId, line.id],
    );
    if (openRequest.rowCount && openRequest.rowCount > 0) {
      throw new AppError(
        409,
        'BANK_GL_REQUEST_EXISTS',
        'An open create-GL request already exists for this statement line. Complete or cancel it first.',
      );
    }

    const requestId = randomUUID();
    const narration = `Bank reconciliation — ${line.description}`.slice(0, 500);
    const bankLineAmount = amount.toString();
    const netToPrimary = (amount - tax).toString();
    const journalLines: JournalLineInput[] = [];
    if (BigInt(line.debit_poisha) > 0n) {
      journalLines.push({
        accountId: bank.gl_account_id,
        debit: bankLineAmount,
        credit: '0',
        memo: line.reference ?? `Statement line ${line.line_no}`,
      });
      journalLines.push({
        accountId: primary.id,
        debit: '0',
        credit: netToPrimary,
        partyName,
        partyReference: input.partyId ?? null,
        memo: reason,
      });
      if (taxAccount) {
        journalLines.push({
          accountId: taxAccount.id,
          debit: '0',
          credit: tax.toString(),
          memo: `Tax included in bank reconciliation — ${reason}`.slice(0, 500),
        });
      }
    } else {
      journalLines.push({
        accountId: primary.id,
        debit: netToPrimary,
        credit: '0',
        partyName,
        partyReference: input.partyId ?? null,
        memo: reason,
      });
      if (taxAccount) {
        journalLines.push({
          accountId: taxAccount.id,
          debit: tax.toString(),
          credit: '0',
          memo: `Tax included in bank reconciliation — ${reason}`.slice(0, 500),
        });
      }
      journalLines.push({
        accountId: bank.gl_account_id,
        debit: '0',
        credit: bankLineAmount,
        memo: line.reference ?? `Statement line ${line.line_no}`,
      });
    }
    const journalId = await createSystemJournalDraftWithinTransaction(client, {
      ...input,
      companyId: input.companyId,
      date: formatDatabaseDate(line.value_date),
      narration,
      sourceModule: 'BANK_RECONCILIATION',
      sourceDocId: requestId,
      sourceDocRef: line.reference ?? `STL-${line.line_no}`,
      attachmentReference: evidenceReference,
      lines: journalLines,
    });
    await client.query(
      `INSERT INTO bank_gl_requests (
         id, company_id, bank_account_id, statement_line_id, status, amount_poisha, tax_poisha,
         primary_account_id, tax_account_id, party_id, reason, evidence_reference, journal_id,
         idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        requestId,
        input.companyId,
        line.bank_account_id,
        line.id,
        amount.toString(),
        tax.toString(),
        primary.id,
        taxAccount?.id ?? null,
        input.partyId ?? null,
        reason,
        evidenceReference,
        journalId,
        input.idempotencyKey,
        input.actorUserId,
      ],
    );
    if (line.status === 'UNMATCHED') {
      await client.query(
        `UPDATE bank_statement_lines SET status = 'CATEGORIZED'
          WHERE company_id = $1 AND id = $2 AND status = 'UNMATCHED'`,
        [input.companyId, line.id],
      );
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_gl_request.created',
      entityType: 'bank_gl_request',
      entityId: requestId,
      after: {
        bankAccountId: line.bank_account_id,
        statementLineId: line.id,
        amountPoisha: amount.toString(),
        taxPoisha: tax.toString(),
        primaryAccountId: primary.id,
        taxAccountId: taxAccount?.id ?? null,
        partyId: input.partyId ?? null,
        journalId,
        status: 'DRAFT',
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return { request: await getBankGlRequest(client, input.companyId, requestId), replayed: false };
  });
}

export async function submitBankGlRequest(
  pool: Pool,
  input: BankingAuditContext & { requestId: string },
): Promise<BankGlRequestDto> {
  return withTransaction(pool, async (client) => {
    const request = await client.query<{ id: string; status: string; journal_id: string }>(
      `SELECT id, status, journal_id FROM bank_gl_requests
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new AppError(404, 'BANK_GL_REQUEST_NOT_FOUND', 'Create-GL request not found.');
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'BANK_GL_REQUEST_NOT_DRAFT', 'Only a draft create-GL request can be submitted.');
    }
    const journal = await client.query<{ status: string }>(
      `SELECT status FROM journals WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, row.journal_id],
    );
    if (journal.rows[0]?.status !== 'DRAFT') {
      throw new AppError(409, 'BANK_GL_JOURNAL_NOT_DRAFT', 'The linked journal is not a draft.');
    }
    await client.query(
      `UPDATE bank_gl_requests
          SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.id, input.actorUserId],
    );
    await client.query(
      `UPDATE journals SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.journal_id, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_gl_request.submitted',
      entityType: 'bank_gl_request',
      entityId: row.id,
      before: { status: 'DRAFT' },
      after: { status: 'SUBMITTED', journalId: row.journal_id },
      reason: 'Submitted for controller approval before posting.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getBankGlRequest(client, input.companyId, row.id);
  });
}

export async function approveBankGlRequest(
  pool: Pool,
  input: BankingAuditContext & { requestId: string },
): Promise<{ request: BankGlRequestDto; journalId: string }> {
  return withTransaction(pool, async (client) => {
    const request = await client.query<{
      id: string;
      status: string;
      journal_id: string;
      statement_line_id: string;
      bank_account_id: string;
      amount_poisha: string;
      created_by: string;
      approved_by: string | null;
    }>(
      `SELECT id, status, journal_id, statement_line_id, bank_account_id,
              amount_poisha::text AS amount_poisha, created_by, approved_by
         FROM bank_gl_requests
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new AppError(404, 'BANK_GL_REQUEST_NOT_FOUND', 'Create-GL request not found.');
    if (row.status === 'POSTED') {
      if (row.approved_by === input.actorUserId) {
        return {
          request: await getBankGlRequest(client, input.companyId, row.id),
          journalId: row.journal_id,
        };
      }
      throw new AppError(409, 'BANK_GL_REQUEST_ALREADY_POSTED', 'This create-GL request is already posted.');
    }
    if (row.status === 'REVERSED') {
      throw new AppError(409, 'BANK_GL_REQUEST_REVERSED', 'This create-GL request has been reversed.');
    }
    if (row.status !== 'SUBMITTED') {
      throw new AppError(409, 'BANK_GL_REQUEST_NOT_SUBMITTED', 'Only a submitted create-GL request can be approved.');
    }
    if (row.created_by === input.actorUserId) {
      throw new AppError(
        409,
        'BANK_GL_SELF_APPROVAL',
        'The maker cannot approve the same bank GL request. Ask a different controller or administrator.',
      );
    }
    const line = await loadBankStatementLine(client, input.companyId, row.statement_line_id, { forUpdate: true });
    await assertLineEditable(client, line);
    if (line.status === 'MATCHED' || line.status === 'EXCLUDED') {
      throw new AppError(409, 'BANK_LINE_NOT_OPEN', 'The statement line is no longer open for this GL request.');
    }
    const allocated = await activeAllocatedOnLine(client, input.companyId, line.id);
    const remaining = lineRemaining(line) - allocated;
    const amount = BigInt(row.amount_poisha);
    if (amount > remaining) {
      throw new AppError(
        409,
        'BANK_GL_EXCEEDS_REMAINING',
        `The request amount exceeds the ${formatPoishaAsBdt(remaining)} BDT remaining on the statement line.`,
      );
    }
    const bank = await loadBankAccount(client, input.companyId, row.bank_account_id, { requireActive: true });
    const posted = await postJournalWithinTransaction(client, {
      ...input,
      companyId: input.companyId,
      journalId: row.journal_id,
      idempotencyKey: `BANK_GL|${row.id}`,
      enforceApproval: false,
    });
    const bankLine = await client.query<{ id: string }>(
      `SELECT jl.id
         FROM journal_lines jl
        WHERE jl.company_id = $1 AND jl.journal_id = $2 AND jl.account_id = $3
          AND (($4 = 'DEBIT' AND jl.debit_poisha > 0) OR ($4 = 'CREDIT' AND jl.credit_poisha > 0))
        ORDER BY jl.line_no
        LIMIT 1`,
      [input.companyId, row.journal_id, bank.gl_account_id, BigInt(line.debit_poisha) > 0n ? 'DEBIT' : 'CREDIT'],
    );
    const journalLineId = bankLine.rows[0]?.id;
    if (!journalLineId) {
      throw new AppError(409, 'BANK_GL_BANK_LINE_MISSING', 'The approved journal has no bank line to match.');
    }
    const matchType: BankMatchType = amount === remaining ? 'EXACT' : 'PARTIAL';
    await client.query(
      `INSERT INTO bank_statement_line_matches (
         company_id, bank_account_id, statement_line_id, journal_id, journal_line_id,
         amount_poisha, match_type, match_score, reason, status, matched_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,100,$8,'ACTIVE',$9)`,
      [
        input.companyId,
        row.bank_account_id,
        row.statement_line_id,
        row.journal_id,
        journalLineId,
        amount.toString(),
        matchType,
        'Create-GL journal approved by a second user.',
        input.actorUserId,
      ],
    );
    await client.query(
      `UPDATE bank_gl_requests
          SET status = 'POSTED', approved_by = $3, approved_at = now(), posted_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.id, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_gl_request.approved',
      entityType: 'bank_gl_request',
      entityId: row.id,
      before: { status: 'SUBMITTED' },
      after: {
        status: 'POSTED',
        journalId: row.journal_id,
        journalNumber: posted.journal.journalNumber,
        statementLineId: row.statement_line_id,
        amountPoisha: amount.toString(),
      },
      reason: 'Approved and posted the reconciliation journal, then matched it to the statement line.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return { request: await getBankGlRequest(client, input.companyId, row.id), journalId: row.journal_id };
  });
}

export async function cancelBankGlRequest(
  pool: Pool,
  input: BankingAuditContext & { requestId: string; reason: string },
): Promise<BankGlRequestDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_GL_CANCEL_REASON_REQUIRED',
      'A cancellation reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const request = await client.query<{
      id: string;
      status: string;
      journal_id: string | null;
      created_by: string;
    }>(
      `SELECT id, status, journal_id, created_by FROM bank_gl_requests
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new AppError(404, 'BANK_GL_REQUEST_NOT_FOUND', 'Create-GL request not found.');
    if (row.status !== 'DRAFT') {
      throw new AppError(
        409,
        'BANK_GL_REQUEST_NOT_CANCELLABLE',
        'Only a draft create-GL request can be cancelled. A submitted request must be approved or rejected by a controller.',
      );
    }
    if (row.created_by !== input.actorUserId) {
      throw new AppError(409, 'BANK_GL_CANCEL_NOT_MAKER', 'Only the maker can cancel this create-GL request.');
    }
    if (row.journal_id) {
      const journal = await client.query<{ status: string }>(
        `SELECT status FROM journals WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [input.companyId, row.journal_id],
      );
      if (journal.rows[0]?.status !== 'DRAFT') {
        throw new AppError(409, 'BANK_GL_JOURNAL_NOT_CANCELLABLE', 'The linked journal is no longer a draft.');
      }
      await client.query(
        `UPDATE bank_gl_requests
            SET status = 'CANCELLED', journal_id = NULL, cancelled_at = now(), cancelled_by = $3,
                cancellation_reason = $4
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, row.id, input.actorUserId, reason],
      );
      await client.query(`DELETE FROM journals WHERE company_id = $1 AND id = $2 AND status = 'DRAFT'`, [
        input.companyId,
        row.journal_id,
      ]);
      await client.query(
        `UPDATE bank_statement_lines SET status = 'UNMATCHED'
          WHERE company_id = $1 AND id = (SELECT statement_line_id FROM bank_gl_requests WHERE company_id = $1 AND id = $2)
            AND status = 'CATEGORIZED'
            AND NOT EXISTS (
              SELECT 1 FROM bank_statement_line_matches m
               WHERE m.company_id = bank_statement_lines.company_id
                 AND m.statement_line_id = bank_statement_lines.id
                 AND m.status = 'ACTIVE'
            )`,
        [input.companyId, row.id],
      );
    } else {
      await client.query(
        `UPDATE bank_gl_requests
            SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, row.id, input.actorUserId, reason],
      );
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_gl_request.cancelled',
      entityType: 'bank_gl_request',
      entityId: row.id,
      before: { status: row.status, journalId: row.journal_id },
      after: { status: 'CANCELLED', journalId: null },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getBankGlRequest(client, input.companyId, row.id);
  });
}

export async function rejectBankGlRequest(
  pool: Pool,
  input: BankingAuditContext & { requestId: string; reason: string },
): Promise<BankGlRequestDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'BANK_GL_REJECT_REASON_REQUIRED',
      'A rejection reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const request = await client.query<{
      id: string;
      status: string;
      journal_id: string | null;
      statement_line_id: string;
      created_by: string;
    }>(
      `SELECT id, status, journal_id, statement_line_id, created_by
         FROM bank_gl_requests
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new AppError(404, 'BANK_GL_REQUEST_NOT_FOUND', 'Create-GL request not found.');
    if (row.status !== 'SUBMITTED') {
      throw new AppError(409, 'BANK_GL_REQUEST_NOT_SUBMITTED', 'Only a submitted create-GL request can be rejected.');
    }
    if (row.created_by === input.actorUserId) {
      throw new AppError(409, 'BANK_GL_SELF_REVIEW', 'The maker cannot reject their own create-GL request.');
    }
    await client.query(
      `UPDATE bank_gl_requests
          SET status = 'REJECTED', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.id, input.actorUserId, reason],
    );
    await client.query(
      `UPDATE bank_statement_lines SET status = 'UNMATCHED'
        WHERE company_id = $1 AND id = $2 AND status = 'CATEGORIZED'
          AND NOT EXISTS (
            SELECT 1 FROM bank_statement_line_matches m
             WHERE m.company_id = bank_statement_lines.company_id
               AND m.statement_line_id = bank_statement_lines.id
               AND m.status = 'ACTIVE'
          )`,
      [input.companyId, row.statement_line_id],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_gl_request.rejected',
      entityType: 'bank_gl_request',
      entityId: row.id,
      before: { status: 'SUBMITTED', journalId: row.journal_id },
      after: {
        status: 'REJECTED',
        journalRemainsUnposted: true,
        statementLineId: row.statement_line_id,
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getBankGlRequest(client, input.companyId, row.id);
  });
}

export async function getBankLineDetail(
  database: Queryable,
  companyId: string,
  lineId: string,
): Promise<{
  line: BankStatementLineDto;
  matches: BankStatementMatchDto[];
  glRequests: BankGlRequestDto[];
}> {
  const line = await loadBankStatementLine(database, companyId, lineId);
  return {
    line: mapBankStatementLine(line),
    matches: await listLineMatches(database, companyId, lineId),
    glRequests: (await listBankGlRequests(database, companyId, { statementLineId: lineId, limit: 50 })).entries,
  };
}

export { loadJournal };
