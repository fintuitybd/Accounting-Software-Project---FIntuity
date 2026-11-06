import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { postSystemJournalWithinTransaction, type JournalLineInput } from '../ledger/ledgerService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface SuspenseAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface SuspenseAccountDto {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountType: string;
}

export interface SuspenseItemDto {
  lineId: string;
  journalId: string;
  journalNumber: string | null;
  postingDate: string;
  ageDays: number;
  narration: string;
  suspenseAccountId: string;
  suspenseAccountCode: string;
  suspenseAccountName: string;
  direction: 'DEBIT' | 'CREDIT';
  amountPoisha: string;
  amountBdt: string;
  createdBy: string | null;
  createdByName: string | null;
}

export interface SuspenseResolutionDto {
  id: string;
  companyId: string;
  periodId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'POSTED';
  sourceJournalId: string;
  sourceJournalNumber: string | null;
  sourceLineId: string;
  suspenseAccountId: string;
  suspenseAccountCode: string;
  amountPoisha: string;
  amountBdt: string;
  targetAccountId: string;
  targetAccountCode: string;
  targetAccountName: string;
  reason: string;
  attachmentReference: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  journalId: string | null;
  journalNumber: string | null;
}

export interface SuspenseOverviewDto {
  accounts: SuspenseAccountDto[];
  items: SuspenseItemDto[];
  requests: SuspenseResolutionDto[];
}

interface ItemRow {
  line_id: string;
  journal_id: string;
  journal_number: string | null;
  posting_date: Date;
  age_days: number;
  narration_en: string;
  suspense_account_id: string;
  suspense_account_code: string;
  suspense_account_name: string;
  debit_poisha: string;
  credit_poisha: string;
  created_by: string | null;
  created_by_name: string | null;
}

interface ResolutionRow {
  id: string;
  company_id: string;
  period_id: string;
  status: string;
  source_journal_id: string;
  source_journal_number: string | null;
  source_line_id: string;
  suspense_account_id: string;
  suspense_account_code: string;
  amount_poisha: string;
  target_account_id: string;
  target_account_code: string;
  target_account_name: string;
  reason: string;
  attachment_reference: string;
  requested_by: string;
  requested_by_name: string;
  requested_at: Date;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  journal_id: string | null;
  journal_number: string | null;
}

const ITEM_SELECT = `
  SELECT jl.id AS line_id, jl.journal_id, j.journal_number, j.posting_date,
         (CURRENT_DATE - j.posting_date)::int AS age_days, j.narration_en,
         jl.account_id AS suspense_account_id, a.code AS suspense_account_code,
         a.name_en AS suspense_account_name, jl.debit_poisha::text AS debit_poisha,
         jl.credit_poisha::text AS credit_poisha, j.created_by,
         u.name AS created_by_name
    FROM journal_lines jl
    JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
    JOIN accounts a ON a.company_id = jl.company_id AND a.id = jl.account_id
    LEFT JOIN users u ON u.id = j.created_by
   WHERE jl.company_id = $1
     AND a.control_subledger = 'SUSPENSE'
     AND a.is_active = true
     AND j.status = 'POSTED'
     AND j.reversal_of_journal_id IS NULL
     AND j.source_module <> 'SUSPENSE'
     AND NOT EXISTS (
       SELECT 1 FROM suspense_resolutions sr
        WHERE sr.company_id = jl.company_id
          AND sr.source_line_id = jl.id
          AND sr.status IN ('PENDING', 'APPROVED', 'POSTED')
     )
`;

const RESOLUTION_SELECT = `
  SELECT sr.id, sr.company_id, sr.period_id, sr.status, sr.source_journal_id,
         j.journal_number AS source_journal_number, sr.source_line_id,
         sr.suspense_account_id, sa.code AS suspense_account_code,
         sr.amount_poisha::text AS amount_poisha, sr.target_account_id,
         ta.code AS target_account_code, ta.name_en AS target_account_name,
         sr.reason, sr.attachment_reference, sr.requested_by, ru.name AS requested_by_name,
         sr.requested_at, sr.decided_by, du.name AS decided_by_name, sr.decided_at,
         sr.decision_reason, sr.journal_id, pj.journal_number
    FROM suspense_resolutions sr
    JOIN journals j ON j.company_id = sr.company_id AND j.id = sr.source_journal_id
    JOIN accounts sa ON sa.company_id = sr.company_id AND sa.id = sr.suspense_account_id
    JOIN accounts ta ON ta.company_id = sr.company_id AND ta.id = sr.target_account_id
    JOIN users ru ON ru.id = sr.requested_by
    LEFT JOIN users du ON du.id = sr.decided_by
    LEFT JOIN journals pj ON pj.company_id = sr.company_id AND pj.id = sr.journal_id
`;

function mapItem(row: ItemRow): SuspenseItemDto {
  const debit = BigInt(row.debit_poisha);
  const direction: 'DEBIT' | 'CREDIT' = debit > 0n ? 'DEBIT' : 'CREDIT';
  const amount = debit > 0n ? debit : BigInt(row.credit_poisha);
  return {
    lineId: row.line_id,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    postingDate: formatDatabaseDate(row.posting_date),
    ageDays: row.age_days,
    narration: row.narration_en,
    suspenseAccountId: row.suspense_account_id,
    suspenseAccountCode: row.suspense_account_code,
    suspenseAccountName: row.suspense_account_name,
    direction,
    amountPoisha: amount.toString(),
    amountBdt: formatPoishaAsBdt(amount),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
  };
}

function mapResolution(row: ResolutionRow): SuspenseResolutionDto {
  return {
    id: row.id,
    companyId: row.company_id,
    periodId: row.period_id,
    status: row.status as SuspenseResolutionDto['status'],
    sourceJournalId: row.source_journal_id,
    sourceJournalNumber: row.source_journal_number,
    sourceLineId: row.source_line_id,
    suspenseAccountId: row.suspense_account_id,
    suspenseAccountCode: row.suspense_account_code,
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    targetAccountId: row.target_account_id,
    targetAccountCode: row.target_account_code,
    targetAccountName: row.target_account_name,
    reason: row.reason,
    attachmentReference: row.attachment_reference,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionReason: row.decision_reason,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
  };
}

export async function listOpenSuspenseItems(database: Queryable, companyId: string): Promise<SuspenseItemDto[]> {
  const result = await database.query<ItemRow>(`${ITEM_SELECT} ORDER BY j.posting_date ASC, jl.line_no ASC`, [
    companyId,
  ]);
  return result.rows.map(mapItem);
}

export async function getSuspenseOverview(database: Queryable, companyId: string): Promise<SuspenseOverviewDto> {
  const accounts = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    account_type: string;
  }>(
    `SELECT id, code, name_en, name_bn, account_type
       FROM accounts
      WHERE company_id = $1 AND control_subledger = 'SUSPENSE' AND is_active = true
      ORDER BY code ASC`,
    [companyId],
  );
  const items = await listOpenSuspenseItems(database, companyId);
  const requests = await database.query<ResolutionRow>(
    `${RESOLUTION_SELECT}
      WHERE sr.company_id = $1
      ORDER BY sr.requested_at DESC
      LIMIT 100`,
    [companyId],
  );
  return {
    accounts: accounts.rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameEn: row.name_en,
      nameBn: row.name_bn,
      accountType: row.account_type,
    })),
    items,
    requests: requests.rows.map(mapResolution),
  };
}

export async function requestSuspenseResolution(
  pool: Pool,
  input: SuspenseAuditContext & {
    companyId: string;
    sourceLineId: string;
    targetAccountId: string;
    reason: string;
    attachmentReference: string;
  },
): Promise<SuspenseResolutionDto> {
  const reason = input.reason.trim();
  const attachment = input.attachmentReference.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'SUSPENSE_REASON_REQUIRED', 'A suspense reason between 3 and 500 characters is required.');
  }
  if (attachment.length < 3 || attachment.length > 500) {
    throw new AppError(
      400,
      'SUSPENSE_ATTACHMENT_REQUIRED',
      'An attachment or evidence reference between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const source = await client.query<{
      id: string;
      journal_id: string;
      account_id: string;
      debit_poisha: string;
      credit_poisha: string;
      posting_date: Date;
      period_id: string;
      journal_status: string;
      journal_number: string | null;
      source_module: string;
      reversal_of_journal_id: string | null;
    }>(
      `SELECT jl.id, jl.journal_id, jl.account_id, jl.debit_poisha::text AS debit_poisha,
              jl.credit_poisha::text AS credit_poisha, j.posting_date, j.period_id,
              j.status AS journal_status, j.journal_number, j.source_module, j.reversal_of_journal_id
         FROM journal_lines jl
         JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
         JOIN accounts a ON a.company_id = jl.company_id AND a.id = jl.account_id
        WHERE jl.company_id = $1 AND jl.id = $2
          AND a.control_subledger = 'SUSPENSE' AND a.is_active = true
        FOR UPDATE OF jl, j`,
      [input.companyId, input.sourceLineId],
    );
    const line = source.rows[0];
    if (!line || line.journal_status !== 'POSTED' || line.source_module === 'SUSPENSE' || line.reversal_of_journal_id) {
      throw new AppError(
        404,
        'SUSPENSE_ITEM_NOT_FOUND',
        'The suspense line is not an open posted suspense item in this company.',
      );
    }
    const debit = BigInt(line.debit_poisha);
    const credit = BigInt(line.credit_poisha);
    const amount = debit > 0n ? debit : credit;
    if (amount <= 0n) throw new AppError(409, 'SUSPENSE_ITEM_EMPTY', 'The suspense line has no amount to resolve.');
    const target = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true`,
      [input.companyId, input.targetAccountId],
    );
    if (!target.rows[0]) {
      throw new AppError(400, 'SUSPENSE_TARGET_INVALID', 'Choose an active target account in this company.');
    }
    if (target.rows[0].id === line.account_id) {
      throw new AppError(409, 'SUSPENSE_TARGET_SAME', 'The target account must differ from the suspense account.');
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO suspense_resolutions (
         company_id, period_id, source_journal_id, source_line_id, suspense_account_id,
         amount_poisha, target_account_id, reason, attachment_reference, requested_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.companyId,
        line.period_id,
        line.journal_id,
        line.id,
        line.account_id,
        amount.toString(),
        input.targetAccountId,
        reason,
        attachment,
        input.actorUserId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id)
      throw new AppError(500, 'SUSPENSE_REQUEST_FAILED', 'The suspense resolution request could not be created.');
    const saved = await client.query<ResolutionRow>(`${RESOLUTION_SELECT} WHERE sr.company_id = $1 AND sr.id = $2`, [
      input.companyId,
      id,
    ]);
    if (!saved.rows[0]) {
      throw new AppError(500, 'SUSPENSE_REQUEST_FAILED', 'The suspense resolution request could not be loaded.');
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'suspense.resolution_requested',
      entityType: 'suspense_resolution',
      entityId: id,
      after: {
        sourceJournalId: line.journal_id,
        sourceJournalNumber: line.journal_number,
        sourceLineId: line.id,
        amountPoisha: amount.toString(),
        targetAccountId: input.targetAccountId,
        targetAccountCode: target.rows[0].code,
        attachmentReference: attachment,
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return mapResolution(saved.rows[0]);
  });
}

export async function decideSuspenseResolution(
  pool: Pool,
  input: SuspenseAuditContext & {
    companyId: string;
    resolutionId: string;
    decision: 'APPROVE' | 'REJECT';
    reason: string;
  },
): Promise<SuspenseResolutionDto> {
  const decisionReason = input.reason.trim();
  if (decisionReason.length < 3 || decisionReason.length > 500) {
    throw new AppError(
      400,
      'SUSPENSE_DECISION_REASON_REQUIRED',
      'A decision reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const request = await client.query<{
      id: string;
      status: string;
      requested_by: string;
      source_journal_id: string;
      source_line_id: string;
      suspense_account_id: string;
      period_id: string;
      amount_poisha: string;
      target_account_id: string;
      reason: string;
    }>(
      `SELECT id, status, requested_by, source_journal_id, source_line_id, suspense_account_id,
              period_id, amount_poisha::text AS amount_poisha, target_account_id, reason
         FROM suspense_resolutions
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.resolutionId],
    );
    const row = request.rows[0];
    if (!row) throw new AppError(404, 'SUSPENSE_RESOLUTION_NOT_FOUND', 'Suspense resolution request not found.');
    if (row.status !== 'PENDING') {
      throw new AppError(409, 'SUSPENSE_RESOLUTION_DECIDED', `This suspense request is ${row.status}.`);
    }
    if (row.requested_by === input.actorUserId) {
      throw new AppError(403, 'SUSPENSE_SELF_APPROVAL', 'The requester cannot approve their own suspense resolution.');
    }
    if (input.decision === 'REJECT') {
      await client.query(
        `UPDATE suspense_resolutions
            SET status = 'REJECTED', decided_by = $3, decided_at = now(), decision_reason = $4
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.resolutionId, input.actorUserId, decisionReason],
      );
      await writeAuditEvent(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: 'suspense.resolution_rejected',
        entityType: 'suspense_resolution',
        entityId: input.resolutionId,
        before: { status: 'PENDING' },
        after: { status: 'REJECTED' },
        reason: decisionReason,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });
    } else {
      const source = await client.query<{
        id: string;
        journal_id: string;
        journal_number: string | null;
        posting_date: Date;
        period_id: string;
        debit_poisha: string;
        credit_poisha: string;
        journal_status: string;
      }>(
        `SELECT jl.id, jl.journal_id, j.journal_number, j.posting_date, j.period_id,
                jl.debit_poisha::text AS debit_poisha, jl.credit_poisha::text AS credit_poisha,
                j.status AS journal_status
           FROM journal_lines jl
           JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
          WHERE jl.company_id = $1 AND jl.id = $2
          FOR UPDATE OF jl, j`,
        [input.companyId, row.source_line_id],
      );
      const line = source.rows[0];
      if (!line || line.journal_status !== 'POSTED' || line.journal_id !== row.source_journal_id) {
        throw new AppError(409, 'SUSPENSE_SOURCE_CHANGED', 'The source suspense journal is no longer open.');
      }
      const debit = BigInt(line.debit_poisha);
      const credit = BigInt(line.credit_poisha);
      const amount = debit > 0n ? debit : credit;
      if (amount !== BigInt(row.amount_poisha)) {
        throw new AppError(409, 'SUSPENSE_SOURCE_CHANGED', 'The source suspense amount changed; create a new request.');
      }
      const journalLines: JournalLineInput[] =
        debit > 0n
          ? [
              {
                accountId: row.suspense_account_id,
                debit: '0',
                credit: formatPoishaAsBdt(amount),
                memo: `Suspense cleared — ${line.journal_number ?? line.journal_id}`,
              },
              {
                accountId: row.target_account_id,
                debit: formatPoishaAsBdt(amount),
                credit: '0',
                memo: `Suspense allocation — ${row.reason}`,
              },
            ]
          : [
              {
                accountId: row.suspense_account_id,
                debit: formatPoishaAsBdt(amount),
                credit: '0',
                memo: `Suspense cleared — ${line.journal_number ?? line.journal_id}`,
              },
              {
                accountId: row.target_account_id,
                debit: '0',
                credit: formatPoishaAsBdt(amount),
                memo: `Suspense allocation — ${row.reason}`,
              },
            ];
      const journal = await postSystemJournalWithinTransaction(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        date: formatDatabaseDate(line.posting_date),
        narration: `Suspense resolution — ${line.journal_number ?? line.journal_id} — ${row.reason}`,
        sourceModule: 'SUSPENSE',
        sourceDocId: line.journal_id,
        sourceDocRef: input.resolutionId,
        idempotencyKey: `SUSPENSE-RESOLUTION:${input.resolutionId}`,
        lines: journalLines,
      });
      await client.query(
        `UPDATE suspense_resolutions
            SET status = 'POSTED', decided_by = $3, decided_at = now(), decision_reason = $4, journal_id = $5
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.resolutionId, input.actorUserId, decisionReason, journal.id],
      );
      await writeAuditEvent(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: 'suspense.resolution_posted',
        entityType: 'suspense_resolution',
        entityId: input.resolutionId,
        before: { status: 'PENDING' },
        after: {
          status: 'POSTED',
          journalId: journal.id,
          journalNumber: journal.journalNumber,
          amountPoisha: amount.toString(),
        },
        reason: decisionReason,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });
    }
    const saved = await client.query<ResolutionRow>(`${RESOLUTION_SELECT} WHERE sr.company_id = $1 AND sr.id = $2`, [
      input.companyId,
      input.resolutionId,
    ]);
    if (!saved.rows[0])
      throw new AppError(500, 'SUSPENSE_RESOLUTION_NOT_FOUND', 'The suspense request could not be loaded.');
    return mapResolution(saved.rows[0]);
  });
}
