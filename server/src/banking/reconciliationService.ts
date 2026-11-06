import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { escapeCsvCell } from '../company/csv.ts';
import {
  loadBankAccount,
  loadPeriodById,
  type BankAccountRow,
  type BankingAuditContext,
  type PeriodRow,
  type Queryable,
} from './common.ts';

export interface BankReconciliationBlocker {
  code: string;
  message: string;
}

export interface BankReconciliationProof {
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  glAccountCode: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStatus: string;
  periodStart: string;
  periodEnd: string;
  statement: {
    statementCount: number;
    lineCount: number;
    matchedCount: number;
    partialCount: number;
    unmatchedCount: number;
    categorizedCount: number;
    excludedCount: number;
    debitPoisha: string;
    creditPoisha: string;
    movementPoisha: string;
    movementBdt: string;
    closingBalancePoisha: string | null;
    closingBalanceBdt: string | null;
    firstDate: string | null;
    lastDate: string | null;
  };
  gl: {
    debitPoisha: string;
    creditPoisha: string;
    movementPoisha: string;
    movementBdt: string;
    closingBalancePoisha: string;
    closingBalanceBdt: string;
  };
  differenceBasis: 'STATEMENT_CLOSING_BALANCE' | 'PERIOD_MOVEMENT';
  differencePoisha: string;
  differenceBdt: string;
  blockers: BankReconciliationBlocker[];
  warnings: string[];
}

export interface BankReconciliationDto {
  id: string | null;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  glAccountCode: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStatus: string;
  status: 'DRAFT' | 'PREPARED' | 'REVIEWED' | 'LOCKED';
  differencePoisha: string;
  differenceBdt: string;
  preparedBy: string | null;
  preparedByName: string | null;
  preparedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  evidenceReference: string | null;
  lockedAt: string | null;
  proof: BankReconciliationProof;
  canReview: boolean;
}

interface ReconciliationRow {
  id: string;
  company_id: string;
  bank_account_id: string;
  period_id: string;
  status: string;
  snapshot_json: Record<string, unknown>;
  difference_poisha: string;
  prepared_by: string | null;
  prepared_by_name: string | null;
  prepared_at: Date | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  evidence_reference: string | null;
  locked_at: Date | null;
  created_at: Date;
}

const RECONCILIATION_SELECT = `
  SELECT r.id, r.company_id, r.bank_account_id, r.period_id, r.status, r.snapshot_json,
         r.difference_poisha::text AS difference_poisha,
         r.prepared_by, pu.name AS prepared_by_name, r.prepared_at,
         r.reviewed_by, ru.name AS reviewed_by_name, r.reviewed_at,
         r.review_note, r.evidence_reference, r.locked_at, r.created_at
    FROM bank_reconciliations r
    LEFT JOIN users pu ON pu.id = r.prepared_by
    LEFT JOIN users ru ON ru.id = r.reviewed_by
`;

function sumBigInt(value: string | null | undefined): bigint {
  return BigInt(value ?? '0');
}

export async function computeReconciliationProof(
  database: Queryable,
  bank: BankAccountRow,
  period: PeriodRow,
): Promise<BankReconciliationProof> {
  const start = formatDatabaseDate(period.start_date);
  const end = formatDatabaseDate(period.end_date);
  const statement = await database.query<{
    statement_count: string;
    line_count: string;
    matched_count: string;
    partial_count: string;
    unmatched_count: string;
    categorized_count: string;
    excluded_count: string;
    debit_poisha: string;
    credit_poisha: string;
    first_date: Date | null;
    last_date: Date | null;
  }>(
    `SELECT count(DISTINCT statement_id)::text AS statement_count,
            count(*)::text AS line_count,
            count(*) FILTER (WHERE status = 'MATCHED')::text AS matched_count,
            count(*) FILTER (WHERE status = 'PARTIALLY_MATCHED')::text AS partial_count,
            count(*) FILTER (WHERE status = 'UNMATCHED')::text AS unmatched_count,
            count(*) FILTER (WHERE status = 'CATEGORIZED')::text AS categorized_count,
            count(*) FILTER (WHERE status = 'EXCLUDED')::text AS excluded_count,
            COALESCE(sum(debit_poisha), 0)::text AS debit_poisha,
            COALESCE(sum(credit_poisha), 0)::text AS credit_poisha,
            min(value_date) AS first_date,
            max(value_date) AS last_date
       FROM bank_statement_lines
      WHERE company_id = $1 AND bank_account_id = $2
        AND value_date BETWEEN $3::date AND $4::date`,
    [bank.company_id, bank.id, start, end],
  );
  const statementRows = statement.rows[0]!;
  const statementDebit = sumBigInt(statementRows.debit_poisha);
  const statementCredit = sumBigInt(statementRows.credit_poisha);
  const statementMovement = statementDebit - statementCredit;
  const closing = await database.query<{ balance_poisha: string }>(
    `SELECT balance_poisha::text AS balance_poisha
       FROM bank_statement_lines
      WHERE company_id = $1 AND bank_account_id = $2
        AND value_date BETWEEN $3::date AND $4::date
        AND balance_poisha IS NOT NULL
      ORDER BY value_date DESC, created_at DESC, line_no DESC
      LIMIT 1`,
    [bank.company_id, bank.id, start, end],
  );
  const statementClosing = closing.rows[0] ? BigInt(closing.rows[0].balance_poisha) : null;

  const gl = await database.query<{
    period_debit: string;
    period_credit: string;
    closing_debit: string;
    closing_credit: string;
  }>(
    `SELECT COALESCE(sum(CASE WHEN j.posting_date BETWEEN $3::date AND $4::date THEN jl.debit_poisha ELSE 0 END), 0)::text AS period_debit,
            COALESCE(sum(CASE WHEN j.posting_date BETWEEN $3::date AND $4::date THEN jl.credit_poisha ELSE 0 END), 0)::text AS period_credit,
            COALESCE(sum(CASE WHEN j.posting_date <= $4::date THEN jl.debit_poisha ELSE 0 END), 0)::text AS closing_debit,
            COALESCE(sum(CASE WHEN j.posting_date <= $4::date THEN jl.credit_poisha ELSE 0 END), 0)::text AS closing_credit
       FROM journal_lines jl
       JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
      WHERE jl.company_id = $1 AND jl.account_id = $2 AND j.status = 'POSTED'`,
    [bank.company_id, bank.gl_account_id, start, end],
  );
  const glRows = gl.rows[0]!;
  const glDebit = sumBigInt(glRows.period_debit);
  const glCredit = sumBigInt(glRows.period_credit);
  const glMovement = glDebit - glCredit;
  const glClosing = sumBigInt(glRows.closing_debit) - sumBigInt(glRows.closing_credit);

  const differenceBasis = statementClosing !== null ? 'STATEMENT_CLOSING_BALANCE' : 'PERIOD_MOVEMENT';
  const difference = statementClosing !== null ? glClosing - statementClosing : glMovement - statementMovement;
  const blockers: BankReconciliationBlocker[] = [];
  const warnings: string[] = [];
  if (Number(statementRows.line_count) === 0) {
    blockers.push({
      code: 'BANK_RECONCILIATION_NO_STATEMENT',
      message: 'No imported statement line exists for this account and period.',
    });
  }
  const openLines =
    Number(statementRows.partial_count) +
    Number(statementRows.unmatched_count) +
    Number(statementRows.categorized_count);
  if (openLines > 0) {
    blockers.push({
      code: 'BANK_RECONCILIATION_OPEN_LINES',
      message: `${openLines} statement line(s) are unmatched, partially matched or categorised but not matched.`,
    });
  }
  if (difference !== 0n) {
    blockers.push({
      code: 'BANK_RECONCILIATION_DIFFERENCE',
      message:
        differenceBasis === 'STATEMENT_CLOSING_BALANCE'
          ? `GL closing balance and statement closing balance differ by ${formatPoishaAsBdt(difference)} BDT.`
          : `GL period movement and statement period movement differ by ${formatPoishaAsBdt(difference)} BDT.`,
    });
  }
  if (statementClosing === null) {
    warnings.push(
      'No statement closing balance was supplied, so the proof compares period movement rather than closing balances.',
    );
  }
  if (Number(statementRows.excluded_count) > 0) {
    warnings.push(
      `${statementRows.excluded_count} line(s) are excluded with a reason. Review the exclusions before sign-off.`,
    );
  }

  return {
    companyId: bank.company_id,
    bankAccountId: bank.id,
    bankAccountName: bank.name,
    glAccountCode: bank.gl_account_code,
    periodId: period.id,
    periodCode: period.code,
    periodLabel: period.label,
    periodStatus: period.status,
    periodStart: start,
    periodEnd: end,
    statement: {
      statementCount: Number(statementRows.statement_count),
      lineCount: Number(statementRows.line_count),
      matchedCount: Number(statementRows.matched_count),
      partialCount: Number(statementRows.partial_count),
      unmatchedCount: Number(statementRows.unmatched_count),
      categorizedCount: Number(statementRows.categorized_count),
      excludedCount: Number(statementRows.excluded_count),
      debitPoisha: statementDebit.toString(),
      creditPoisha: statementCredit.toString(),
      movementPoisha: statementMovement.toString(),
      movementBdt: formatPoishaAsBdt(statementMovement),
      closingBalancePoisha: statementClosing?.toString() ?? null,
      closingBalanceBdt: statementClosing === null ? null : formatPoishaAsBdt(statementClosing),
      firstDate: statementRows.first_date ? formatDatabaseDate(statementRows.first_date) : null,
      lastDate: statementRows.last_date ? formatDatabaseDate(statementRows.last_date) : null,
    },
    gl: {
      debitPoisha: glDebit.toString(),
      creditPoisha: glCredit.toString(),
      movementPoisha: glMovement.toString(),
      movementBdt: formatPoishaAsBdt(glMovement),
      closingBalancePoisha: glClosing.toString(),
      closingBalanceBdt: formatPoishaAsBdt(glClosing),
    },
    differenceBasis,
    differencePoisha: difference.toString(),
    differenceBdt: formatPoishaAsBdt(difference),
    blockers,
    warnings,
  };
}

function snapshotIsStale(stored: Record<string, unknown>, current: BankReconciliationProof): boolean {
  const snapshot = stored as Partial<BankReconciliationProof>;
  return (
    snapshot.differencePoisha !== current.differencePoisha ||
    snapshot.statement?.lineCount !== current.statement.lineCount ||
    snapshot.statement?.matchedCount !== current.statement.matchedCount ||
    snapshot.statement?.partialCount !== current.statement.partialCount ||
    snapshot.statement?.unmatchedCount !== current.statement.unmatchedCount ||
    snapshot.statement?.categorizedCount !== current.statement.categorizedCount ||
    snapshot.statement?.excludedCount !== current.statement.excludedCount ||
    snapshot.statement?.debitPoisha !== current.statement.debitPoisha ||
    snapshot.statement?.creditPoisha !== current.statement.creditPoisha ||
    snapshot.statement?.closingBalancePoisha !== current.statement.closingBalancePoisha ||
    snapshot.gl?.closingBalancePoisha !== current.gl.closingBalancePoisha ||
    snapshot.gl?.movementPoisha !== current.gl.movementPoisha
  );
}

function mapReconciliation(row: ReconciliationRow | undefined, proof: BankReconciliationProof): BankReconciliationDto {
  return {
    id: row?.id ?? null,
    companyId: row?.company_id ?? proof.companyId,
    bankAccountId: proof.bankAccountId,
    bankAccountName: proof.bankAccountName,
    glAccountCode: proof.glAccountCode,
    periodId: proof.periodId,
    periodCode: proof.periodCode,
    periodLabel: proof.periodLabel,
    periodStatus: proof.periodStatus,
    status: (row?.status as BankReconciliationDto['status']) ?? 'DRAFT',
    differencePoisha: proof.differencePoisha,
    differenceBdt: proof.differenceBdt,
    preparedBy: row?.prepared_by ?? null,
    preparedByName: row?.prepared_by_name ?? null,
    preparedAt: row?.prepared_at?.toISOString() ?? null,
    reviewedBy: row?.reviewed_by ?? null,
    reviewedByName: row?.reviewed_by_name ?? null,
    reviewedAt: row?.reviewed_at?.toISOString() ?? null,
    reviewNote: row?.review_note ?? null,
    evidenceReference: row?.evidence_reference ?? null,
    lockedAt: row?.locked_at?.toISOString() ?? null,
    proof,
    canReview: row?.status === 'PREPARED' && proof.blockers.length === 0 && proof.periodStatus !== 'LOCKED',
  };
}

export async function getCurrentReconciliation(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  periodId: string,
): Promise<BankReconciliationDto> {
  const bank = await loadBankAccount(database, companyId, bankAccountId);
  const period = await loadPeriodById(database, companyId, periodId);
  const proof = await computeReconciliationProof(database, bank, period);
  const existing = await database.query<ReconciliationRow>(
    `${RECONCILIATION_SELECT}
      WHERE r.company_id = $1 AND r.bank_account_id = $2 AND r.period_id = $3`,
    [companyId, bankAccountId, periodId],
  );
  return mapReconciliation(existing.rows[0], proof);
}

export async function prepareReconciliation(
  pool: Pool,
  input: BankingAuditContext & { bankAccountId: string; periodId: string },
): Promise<BankReconciliationDto> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `bank-reconciliation:${input.companyId}:${input.bankAccountId}:${input.periodId}`,
    ]);
    const bank = await loadBankAccount(client, input.companyId, input.bankAccountId);
    const period = await loadPeriodById(client, input.companyId, input.periodId);
    if (period.status === 'LOCKED') {
      throw new AppError(
        409,
        'BANK_PERIOD_LOCKED',
        `Period ${period.code} is LOCKED. Reopen it through the controlled period workflow before preparing a reconciliation.`,
      );
    }
    const existing = await client.query<ReconciliationRow>(
      `${RECONCILIATION_SELECT}
        WHERE r.company_id = $1 AND r.bank_account_id = $2 AND r.period_id = $3
        FOR UPDATE OF r`,
      [input.companyId, input.bankAccountId, input.periodId],
    );
    const row = existing.rows[0];
    if (row?.status === 'LOCKED') {
      throw new AppError(409, 'BANK_RECONCILIATION_LOCKED', 'This reconciliation is locked and cannot be re-prepared.');
    }
    if (row?.status === 'REVIEWED') {
      throw new AppError(
        409,
        'BANK_RECONCILIATION_REVIEWED',
        'This reconciliation is already reviewed and cannot be re-prepared.',
      );
    }
    const proof = await computeReconciliationProof(client, bank, period);
    const ready = proof.blockers.length === 0;
    const snapshot = JSON.stringify(proof);
    const status = ready ? 'PREPARED' : 'DRAFT';
    let reconciliationId = row?.id;
    if (row) {
      await client.query(
        `UPDATE bank_reconciliations
            SET status = $3, snapshot_json = $4::jsonb, difference_poisha = $5,
                prepared_by = CASE WHEN $6 THEN $7 ELSE NULL END,
                prepared_at = CASE WHEN $6 THEN now() ELSE NULL END
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, row.id, status, snapshot, proof.differencePoisha, ready, input.actorUserId],
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bank_reconciliations (
           company_id, bank_account_id, period_id, status, snapshot_json, difference_poisha,
           prepared_by, prepared_at, created_by
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         RETURNING id`,
        [
          input.companyId,
          input.bankAccountId,
          input.periodId,
          status,
          snapshot,
          proof.differencePoisha,
          ready ? input.actorUserId : null,
          ready ? new Date() : null,
          input.actorUserId,
        ],
      );
      reconciliationId = inserted.rows[0]!.id;
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: ready ? 'bank_reconciliation.prepared' : 'bank_reconciliation.draft_updated',
      entityType: 'bank_reconciliation',
      entityId: reconciliationId,
      before: row ? { status: row.status } : null,
      after: {
        status,
        bankAccountId: input.bankAccountId,
        periodId: input.periodId,
        differencePoisha: proof.differencePoisha,
        blockers: proof.blockers.map((blocker) => blocker.code),
        matchedCount: proof.statement.matchedCount,
        unmatchedCount: proof.statement.unmatchedCount,
        partialCount: proof.statement.partialCount,
      },
      reason: ready
        ? 'Prepared from imported statement lines and posted GL movement with no blockers.'
        : 'Draft reconciliation snapshot saved; blockers remain.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const saved = await client.query<ReconciliationRow>(
      `${RECONCILIATION_SELECT} WHERE r.company_id = $1 AND r.id = $2`,
      [input.companyId, reconciliationId],
    );
    return mapReconciliation(saved.rows[0], proof);
  });
}

export async function reviewReconciliation(
  pool: Pool,
  input: BankingAuditContext & {
    reconciliationId: string;
    note?: string | null;
    evidenceReference?: string | null;
  },
): Promise<BankReconciliationDto> {
  const note = input.note?.trim() || null;
  if (note && note.length > 500) {
    throw new AppError(400, 'BANK_RECONCILIATION_NOTE_TOO_LONG', 'Review note must be at most 500 characters.');
  }
  const evidenceReference = input.evidenceReference?.trim() || null;
  if (evidenceReference && evidenceReference.length > 500) {
    throw new AppError(
      400,
      'BANK_RECONCILIATION_EVIDENCE_TOO_LONG',
      'Evidence reference must be at most 500 characters.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<ReconciliationRow>(
      `${RECONCILIATION_SELECT} WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE OF r`,
      [input.companyId, input.reconciliationId],
    );
    const row = existing.rows[0];
    if (!row) throw new AppError(404, 'BANK_RECONCILIATION_NOT_FOUND', 'Reconciliation not found.');
    if (row.status === 'REVIEWED' || row.status === 'LOCKED') {
      throw new AppError(409, 'BANK_RECONCILIATION_ALREADY_SIGNED_OFF', 'This reconciliation is already signed off.');
    }
    if (row.status !== 'PREPARED') {
      throw new AppError(409, 'BANK_RECONCILIATION_NOT_PREPARED', 'Prepare the reconciliation before review.');
    }
    if (row.prepared_by === input.actorUserId) {
      throw new AppError(
        409,
        'BANK_RECONCILIATION_SELF_REVIEW',
        'The preparer cannot review the same reconciliation. A different controller or administrator must sign off.',
      );
    }
    const bank = await loadBankAccount(client, input.companyId, row.bank_account_id);
    const period = await loadPeriodById(client, input.companyId, row.period_id);
    const proof = await computeReconciliationProof(client, bank, period);
    if (snapshotIsStale(row.snapshot_json, proof)) {
      throw new AppError(
        409,
        'BANK_RECONCILIATION_STALE',
        'The statement, matches or GL changed after this reconciliation was prepared. Re-prepare it before review.',
      );
    }
    if (proof.blockers.length > 0) {
      throw new AppError(
        409,
        'BANK_RECONCILIATION_NOT_READY',
        'The reconciliation has blocking differences or open statement lines at review time. Re-prepare after resolving them.',
        { blockers: proof.blockers },
      );
    }
    const finalStatus = period.status === 'CLOSED' || period.status === 'LOCKED' ? 'LOCKED' : 'REVIEWED';
    await client.query(
      `UPDATE bank_reconciliations
          SET status = $3, reviewed_by = $4, reviewed_at = now(), review_note = $5,
              evidence_reference = $6, snapshot_json = $7::jsonb, difference_poisha = $8,
              locked_at = CASE WHEN $3 = 'LOCKED' THEN now() ELSE locked_at END
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        row.id,
        finalStatus,
        input.actorUserId,
        note,
        evidenceReference,
        JSON.stringify(proof),
        proof.differencePoisha,
      ],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_reconciliation.reviewed',
      entityType: 'bank_reconciliation',
      entityId: row.id,
      before: { status: row.status, preparedBy: row.prepared_by },
      after: {
        status: finalStatus,
        reviewedBy: input.actorUserId,
        differencePoisha: proof.differencePoisha,
        periodStatus: period.status,
        note,
        evidenceReference,
      },
      reason: note ?? 'Reviewed against imported statement and posted GL movement.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const saved = await client.query<ReconciliationRow>(
      `${RECONCILIATION_SELECT} WHERE r.company_id = $1 AND r.id = $2`,
      [input.companyId, row.id],
    );
    return mapReconciliation(saved.rows[0], proof);
  });
}

export async function listReconciliations(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<BankReconciliationDto[]> {
  await loadBankAccount(database, companyId, bankAccountId);
  const rows = await database.query<ReconciliationRow>(
    `${RECONCILIATION_SELECT}
      WHERE r.company_id = $1 AND r.bank_account_id = $2
      ORDER BY r.created_at DESC`,
    [companyId, bankAccountId],
  );
  const result: BankReconciliationDto[] = [];
  for (const row of rows.rows) {
    const bank = await loadBankAccount(database, companyId, row.bank_account_id);
    const period = await loadPeriodById(database, companyId, row.period_id);
    const proof = await computeReconciliationProof(database, bank, period);
    result.push(mapReconciliation(row, proof));
  }
  return result;
}

interface ReconciliationReportRow {
  value_date: Date;
  reference: string | null;
  description: string;
  debit_poisha: string;
  credit_poisha: string;
  balance_poisha: string | null;
  status: string;
  journal_numbers: string | null;
  match_reason: string | null;
}

export async function exportReconciliationReport(
  database: Queryable,
  input: BankingAuditContext & { reconciliationId: string },
): Promise<{ filename: string; content: string }> {
  const existing = await database.query<ReconciliationRow>(
    `${RECONCILIATION_SELECT} WHERE r.company_id = $1 AND r.id = $2`,
    [input.companyId, input.reconciliationId],
  );
  const row = existing.rows[0];
  if (!row) throw new AppError(404, 'BANK_RECONCILIATION_NOT_FOUND', 'Reconciliation not found.');
  const bank = await loadBankAccount(database, input.companyId, row.bank_account_id);
  const period = await loadPeriodById(database, input.companyId, row.period_id);
  const proof = await computeReconciliationProof(database, bank, period);
  const lines = await database.query<ReconciliationReportRow>(
    `SELECT l.value_date, l.reference, l.description,
            l.debit_poisha::text AS debit_poisha, l.credit_poisha::text AS credit_poisha,
            l.balance_poisha::text AS balance_poisha, l.status,
            string_agg(j.journal_number, ' | ' ORDER BY m.matched_at) AS journal_numbers,
            max(m.reason) AS match_reason
       FROM bank_statement_lines l
       LEFT JOIN bank_statement_line_matches m
         ON m.company_id = l.company_id AND m.statement_line_id = l.id AND m.status = 'ACTIVE'
       LEFT JOIN journals j ON j.company_id = m.company_id AND j.id = m.journal_id
      WHERE l.company_id = $1 AND l.bank_account_id = $2
        AND l.value_date BETWEEN $3::date AND $4::date
      GROUP BY l.id, l.value_date, l.reference, l.description, l.debit_poisha, l.credit_poisha,
               l.balance_poisha, l.status
      ORDER BY l.value_date, l.line_no`,
    [input.companyId, row.bank_account_id, proof.periodStart, proof.periodEnd],
  );
  const linesCsv = [
    'date,reference,description,debit_bdt,credit_bdt,balance_bdt,status,matched_journals,match_reason',
    ...lines.rows.map((line) =>
      [
        formatDatabaseDate(line.value_date),
        line.reference ?? '',
        line.description,
        formatPoishaAsBdt(line.debit_poisha),
        formatPoishaAsBdt(line.credit_poisha),
        line.balance_poisha === null ? '' : formatPoishaAsBdt(line.balance_poisha),
        line.status,
        line.journal_numbers ?? '',
        line.match_reason ?? '',
      ]
        .map((value) => escapeCsvCell(value))
        .join(','),
    ),
  ].join('\n');
  const header = [
    'Bank reconciliation report',
    `Company account,${escapeCsvCell(bank.name)}`,
    `GL account,${escapeCsvCell(bank.gl_account_code)}`,
    `Period,${escapeCsvCell(period.code)} (${proof.periodStart} to ${proof.periodEnd})`,
    `Period status,${period.status}`,
    `Reconciliation status,${row.status}`,
    `Prepared by,${escapeCsvCell(row.prepared_by_name ?? '')}`,
    `Prepared at,${row.prepared_at?.toISOString() ?? ''}`,
    `Reviewed by,${escapeCsvCell(row.reviewed_by_name ?? '')}`,
    `Reviewed at,${row.reviewed_at?.toISOString() ?? ''}`,
    `Review note,${escapeCsvCell(row.review_note ?? '')}`,
    `Statement closing balance,${proof.statement.closingBalanceBdt ?? 'not supplied'}`,
    `GL closing balance,${proof.gl.closingBalanceBdt}`,
    `Difference,${proof.differenceBdt}`,
    `Difference basis,${proof.differenceBasis}`,
    `Blockers,${escapeCsvCell(proof.blockers.map((blocker) => blocker.code).join(' | '))}`,
    '',
  ].join('\n');
  const content = `${header}${linesCsv}\n`;
  await writeAuditEvent(database, {
    organisationId: input.organisationId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    action: 'bank_reconciliation.exported',
    entityType: 'bank_reconciliation',
    entityId: row.id,
    after: {
      bankAccountId: row.bank_account_id,
      periodId: row.period_id,
      status: row.status,
      differencePoisha: proof.differencePoisha,
      lineCount: lines.rows.length,
    },
    reason: 'Reconciliation report exported as CSV.',
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });
  return {
    filename: `bank-reconciliation-${bank.gl_account_code}-${period.code}.csv`,
    content,
  };
}
