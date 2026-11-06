import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { JOURNAL_BOOK_TYPES, JOURNAL_SOURCE_MODULES, JOURNAL_STATUSES, SUPPORTED_BOOK_TYPES } from './constants.ts';
import { formatJournalNumber } from './journalNumber.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const MAX_JOURNAL_LINES = 2_000;
const MAX_POSTING_POISHA = 9_000_000_000_000_000_000n;

export interface LedgerAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface JournalLineInput {
  accountId: string;
  debit: string;
  credit: string;
  partyReference?: string | null;
  partyName?: string | null;
  costCenter?: string | null;
  projectCode?: string | null;
  memo?: string | null;
}

export interface JournalInput {
  date: string;
  narration: string;
  narrationBn?: string | null;
  bookType?: string;
  branchId?: string | null;
  attachmentReference?: string | null;
  lines: JournalLineInput[];
}

interface ValidatedJournalLine {
  accountId: string;
  debit: bigint;
  credit: bigint;
  partyReference: string | null;
  partyName: string | null;
  costCenter: string | null;
  projectCode: string | null;
  memo: string | null;
}

export interface JournalLineDto {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  partyReference: string | null;
  partyName: string | null;
  costCenter: string | null;
  projectCode: string | null;
  memo: string | null;
}

export interface JournalAuditDto {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface JournalSummaryDto {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  journalNumber: string | null;
  bookType: string;
  periodId: string;
  periodCode: string;
  documentDate: string;
  postingDate: string;
  sourceModule: string;
  sourceDocId: string | null;
  sourceDocRef: string | null;
  narrationEn: string;
  narrationBn: string | null;
  currency: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  idempotencyKeyUsed: boolean;
  attachmentReference: string | null;
  reversalOfJournalId: string | null;
  reversedByJournalId: string | null;
  reversalReason: string | null;
  reversalJournalNumber: string | null;
  originalJournalNumber: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  postedAt: string | null;
  postedBy: string | null;
  postedByName: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversedByName: string | null;
  totalDebitPoisha: string;
  totalCreditPoisha: string;
  totalDebitBdt: string;
  totalCreditBdt: string;
  lineCount: number;
  balanced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalSourceEvidenceDto {
  kind: 'SALES_DOCUMENT' | 'PURCHASE_DOCUMENT' | 'OPENING_BALANCE' | 'REVERSAL' | 'MANUAL' | 'OTHER';
  id: string | null;
  reference: string | null;
  status: string | null;
  documentDate: string | null;
  partyName: string | null;
  taxDecisionState: string | null;
  rulePackVersion: string | null;
  taxTraceId: string | null;
  events: Array<{
    action: string;
    actorName: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  note: string | null;
}

export interface JournalDetailDto extends JournalSummaryDto {
  lines: JournalLineDto[];
  auditTrail: JournalAuditDto[];
  sourceEvidence: JournalSourceEvidenceDto;
}

interface JournalRow {
  id: string;
  company_id: string;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  journal_number: string | null;
  book_type: string;
  period_id: string;
  period_code: string;
  document_date: Date;
  posting_date: Date;
  source_module: string;
  source_doc_id: string | null;
  source_doc_ref: string | null;
  narration_en: string;
  narration_bn: string | null;
  currency: string;
  status: string;
  idempotency_key: string | null;
  attachment_reference: string | null;
  reversal_of_journal_id: string | null;
  reversed_by_journal_id: string | null;
  reversal_reason: string | null;
  created_by: string;
  created_by_name: string;
  submitted_at: Date | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  approved_by_name: string | null;
  posted_at: Date | null;
  posted_by: string | null;
  posted_by_name: string | null;
  reversed_at: Date | null;
  reversed_by: string | null;
  reversed_by_name: string | null;
  total_debit_poisha: string;
  total_credit_poisha: string;
  line_count: number;
  reversal_journal_number: string | null;
  original_journal_number: string | null;
  created_at: Date;
  updated_at: Date;
  total_count?: string;
}

interface JournalLineRow {
  id: string;
  line_no: number;
  account_id: string;
  account_code: string;
  account_name_en: string;
  account_name_bn: string | null;
  debit_poisha: string;
  credit_poisha: string;
  party_reference: string | null;
  party_name: string | null;
  cost_center: string | null;
  project_code: string | null;
  memo: string | null;
}

const JOURNAL_SELECT = `
  SELECT j.id, j.company_id, j.branch_id, b.code AS branch_code, b.name_en AS branch_name,
         j.journal_number, j.book_type, j.period_id, p.code AS period_code,
         j.document_date, j.posting_date, j.source_module, j.source_doc_id, j.source_doc_ref,
         j.narration_en, j.narration_bn, j.currency, j.status, j.idempotency_key,
         j.attachment_reference, j.reversal_of_journal_id, j.reversed_by_journal_id,
         j.reversal_reason, j.created_by, cu.name AS created_by_name,
         j.submitted_at, j.submitted_by, su.name AS submitted_by_name,
         j.approved_at, j.approved_by, au.name AS approved_by_name,
         j.posted_at, j.posted_by, pu.name AS posted_by_name,
         j.reversed_at, j.reversed_by, ru.name AS reversed_by_name,
         j.created_at, j.updated_at,
         COALESCE(t.line_count, 0)::int AS line_count,
         COALESCE(t.total_debit_poisha, 0)::text AS total_debit_poisha,
         COALESCE(t.total_credit_poisha, 0)::text AS total_credit_poisha,
         rj.journal_number AS reversal_journal_number,
         oj.journal_number AS original_journal_number,
         COUNT(*) OVER() AS total_count
    FROM journals j
    JOIN periods p ON p.company_id = j.company_id AND p.id = j.period_id
    LEFT JOIN branches b ON b.company_id = j.company_id AND b.id = j.branch_id
    JOIN users cu ON cu.id = j.created_by
    LEFT JOIN users su ON su.id = j.submitted_by
    LEFT JOIN users au ON au.id = j.approved_by
    LEFT JOIN users pu ON pu.id = j.posted_by
    LEFT JOIN users ru ON ru.id = j.reversed_by
    LEFT JOIN journals rj ON rj.company_id = j.company_id AND rj.id = j.reversed_by_journal_id
    LEFT JOIN journals oj ON oj.company_id = j.company_id AND oj.id = j.reversal_of_journal_id
    LEFT JOIN (
      SELECT journal_id, count(*) AS line_count,
             sum(debit_poisha) AS total_debit_poisha,
             sum(credit_poisha) AS total_credit_poisha
        FROM journal_lines
       WHERE company_id = $1
       GROUP BY journal_id
    ) t ON t.journal_id = j.id
`;

function mapJournal(row: JournalRow): JournalSummaryDto {
  const debit = BigInt(row.total_debit_poisha);
  const credit = BigInt(row.total_credit_poisha);
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    journalNumber: row.journal_number,
    bookType: row.book_type,
    periodId: row.period_id,
    periodCode: row.period_code,
    documentDate: formatDatabaseDate(row.document_date),
    postingDate: formatDatabaseDate(row.posting_date),
    sourceModule: row.source_module,
    sourceDocId: row.source_doc_id,
    sourceDocRef: row.source_doc_ref,
    narrationEn: row.narration_en,
    narrationBn: row.narration_bn,
    currency: row.currency,
    status: row.status as JournalSummaryDto['status'],
    idempotencyKeyUsed: Boolean(row.idempotency_key),
    attachmentReference: row.attachment_reference,
    reversalOfJournalId: row.reversal_of_journal_id,
    reversedByJournalId: row.reversed_by_journal_id,
    reversalReason: row.reversal_reason,
    reversalJournalNumber: row.reversal_journal_number,
    originalJournalNumber: row.original_journal_number,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    postedAt: row.posted_at?.toISOString() ?? null,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name,
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedBy: row.reversed_by,
    reversedByName: row.reversed_by_name,
    totalDebitPoisha: debit.toString(),
    totalCreditPoisha: credit.toString(),
    totalDebitBdt: formatPoishaAsBdt(debit),
    totalCreditBdt: formatPoishaAsBdt(credit),
    lineCount: row.line_count,
    balanced: debit === credit && debit > 0n,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapLine(row: JournalLineRow): JournalLineDto {
  return {
    id: row.id,
    lineNo: row.line_no,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountNameEn: row.account_name_en,
    accountNameBn: row.account_name_bn,
    debitPoisha: row.debit_poisha,
    creditPoisha: row.credit_poisha,
    debitBdt: formatPoishaAsBdt(row.debit_poisha),
    creditBdt: formatPoishaAsBdt(row.credit_poisha),
    partyReference: row.party_reference,
    partyName: row.party_name,
    costCenter: row.cost_center,
    projectCode: row.project_code,
    memo: row.memo,
  };
}

async function loadJournalLines(database: Queryable, companyId: string, journalId: string): Promise<JournalLineDto[]> {
  const result = await database.query<JournalLineRow>(
    `SELECT l.id, l.line_no, l.account_id, a.code AS account_code, a.name_en AS account_name_en,
            a.name_bn AS account_name_bn, l.debit_poisha::text AS debit_poisha,
            l.credit_poisha::text AS credit_poisha, l.party_reference, l.party_name,
            l.cost_center, l.project_code, l.memo
       FROM journal_lines l
       JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
      WHERE l.company_id = $1 AND l.journal_id = $2
      ORDER BY l.line_no ASC`,
    [companyId, journalId],
  );
  return result.rows.map(mapLine);
}

async function loadJournalAudit(database: Queryable, companyId: string, journalId: string): Promise<JournalAuditDto[]> {
  const result = await database.query<{
    id: string;
    action: string;
    actor_user_id: string | null;
    actor_name: string | null;
    reason: string | null;
    before_json: unknown;
    after_json: unknown;
    created_at: Date;
  }>(
    `SELECT ae.id, ae.action, ae.actor_user_id, u.name AS actor_name, ae.reason,
            ae.before_json, ae.after_json, ae.created_at
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_user_id
      WHERE ae.company_id = $1 AND ae.entity_type = 'journal' AND ae.entity_id = $2
      ORDER BY ae.created_at ASC, ae.id ASC`,
    [companyId, journalId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    reason: row.reason,
    before: row.before_json,
    after: row.after_json,
    createdAt: row.created_at.toISOString(),
  }));
}

async function loadSourceEvidence(
  database: Queryable,
  companyId: string,
  journal: JournalRow,
): Promise<JournalSourceEvidenceDto> {
  if (journal.source_module === 'MANUAL_JOURNAL' || journal.source_module === 'MASS_IMPORT') {
    return {
      kind: 'MANUAL',
      id: journal.source_doc_id,
      reference: journal.source_doc_ref,
      status: journal.status,
      documentDate: formatDatabaseDate(journal.document_date),
      partyName: null,
      taxDecisionState: null,
      rulePackVersion: null,
      taxTraceId: null,
      events: [],
      note: null,
    };
  }
  if (journal.source_module === 'REVERSAL') {
    return {
      kind: 'REVERSAL',
      id: journal.source_doc_id,
      reference: journal.source_doc_ref,
      status: journal.status,
      documentDate: formatDatabaseDate(journal.document_date),
      partyName: null,
      taxDecisionState: null,
      rulePackVersion: null,
      taxTraceId: null,
      events: [],
      note: journal.reversal_reason
        ? `Reversal of ${journal.original_journal_number ?? journal.reversal_of_journal_id ?? 'a journal'}: ${journal.reversal_reason}`
        : null,
    };
  }
  if (journal.source_module === 'OPENING_BALANCE' && journal.source_doc_id) {
    const batch = await database.query<{
      status: string;
      evidence_reference: string | null;
      evidence_note: string | null;
      total_debit_poisha: string;
      total_credit_poisha: string;
    }>(
      `SELECT status, evidence_reference, evidence_note, total_debit_poisha::text AS total_debit_poisha,
              total_credit_poisha::text AS total_credit_poisha
         FROM opening_balance_batches WHERE company_id = $1 AND id = $2`,
      [companyId, journal.source_doc_id],
    );
    const row = batch.rows[0];
    return {
      kind: 'OPENING_BALANCE',
      id: journal.source_doc_id,
      reference: journal.source_doc_ref,
      status: row?.status ?? null,
      documentDate: formatDatabaseDate(journal.document_date),
      partyName: null,
      taxDecisionState: null,
      rulePackVersion: null,
      taxTraceId: null,
      events: [],
      note: row
        ? `Opening balance batch evidence: ${row.evidence_reference ?? 'not recorded'}. ${row.evidence_note ?? ''}`.trim()
        : null,
    };
  }
  if (journal.source_module === 'SALES' && journal.source_doc_id) {
    const document = await database.query<{
      id: string;
      document_no: string | null;
      status: string;
      doc_date: Date;
      party_name: string;
      tax_decision_state: string | null;
      tax_pack_version: string | null;
      trace_id: string | null;
    }>(
      `SELECT d.id, d.document_no, d.status, d.doc_date, p.name_en AS party_name,
              d.tax_decision_state, d.tax_pack_version, td.trace_id
         FROM sales_documents d
         JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
         LEFT JOIN sales_tax_decisions td ON td.company_id = d.company_id AND td.document_id = d.id
        WHERE d.company_id = $1 AND d.id = $2`,
      [companyId, journal.source_doc_id],
    );
    const row = document.rows[0];
    const events = await database.query<{
      action: string;
      actor_name: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT e.action, u.name AS actor_name, e.reason, e.created_at
         FROM sales_document_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.company_id = $1 AND e.document_id = $2
        ORDER BY e.created_at ASC, e.id ASC`,
      [companyId, journal.source_doc_id],
    );
    return {
      kind: 'SALES_DOCUMENT',
      id: row?.id ?? journal.source_doc_id,
      reference: row?.document_no ?? journal.source_doc_ref,
      status: row?.status ?? null,
      documentDate: row ? formatDatabaseDate(row.doc_date) : null,
      partyName: row?.party_name ?? null,
      taxDecisionState: row?.tax_decision_state ?? null,
      rulePackVersion: row?.tax_pack_version ?? null,
      taxTraceId: row?.trace_id ?? null,
      events: events.rows.map((event) => ({
        action: event.action,
        actorName: event.actor_name,
        reason: event.reason,
        createdAt: event.created_at.toISOString(),
      })),
      note: null,
    };
  }
  if (journal.source_module === 'PURCHASES' && journal.source_doc_id) {
    const document = await database.query<{
      id: string;
      document_no: string | null;
      status: string;
      doc_date: Date;
      party_name: string;
      tax_decision_state: string | null;
      tax_pack_version: string | null;
      trace_id: string | null;
    }>(
      `SELECT d.id, d.document_no, d.status, d.doc_date, p.name_en AS party_name,
              d.tax_decision_state, d.tax_pack_version, td.trace_id
         FROM purchase_documents d
         JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
         LEFT JOIN purchase_tax_decisions td ON td.company_id = d.company_id AND td.document_id = d.id
        WHERE d.company_id = $1 AND d.id = $2`,
      [companyId, journal.source_doc_id],
    );
    const row = document.rows[0];
    const events = await database.query<{
      action: string;
      actor_name: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT e.action, u.name AS actor_name, e.reason, e.created_at
         FROM purchase_document_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.company_id = $1 AND e.document_id = $2
        ORDER BY e.created_at ASC, e.id ASC`,
      [companyId, journal.source_doc_id],
    );
    return {
      kind: 'PURCHASE_DOCUMENT',
      id: row?.id ?? journal.source_doc_id,
      reference: row?.document_no ?? journal.source_doc_ref,
      status: row?.status ?? null,
      documentDate: row ? formatDatabaseDate(row.doc_date) : null,
      partyName: row?.party_name ?? null,
      taxDecisionState: row?.tax_decision_state ?? null,
      rulePackVersion: row?.tax_pack_version ?? null,
      taxTraceId: row?.trace_id ?? null,
      events: events.rows.map((event) => ({
        action: event.action,
        actorName: event.actor_name,
        reason: event.reason,
        createdAt: event.created_at.toISOString(),
      })),
      note: null,
    };
  }
  return {
    kind: 'OTHER',
    id: journal.source_doc_id,
    reference: journal.source_doc_ref,
    status: journal.status,
    documentDate: formatDatabaseDate(journal.document_date),
    partyName: null,
    taxDecisionState: null,
    rulePackVersion: null,
    taxTraceId: null,
    events: [],
    note: `Source module ${journal.source_module}.`,
  };
}

export async function loadJournal(
  database: Queryable,
  companyId: string,
  journalId: string,
): Promise<JournalDetailDto> {
  const result = await database.query<JournalRow>(`${JOURNAL_SELECT} WHERE j.company_id = $1 AND j.id = $2`, [
    companyId,
    journalId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');
  return {
    ...mapJournal(row),
    lines: await loadJournalLines(database, companyId, journalId),
    auditTrail: await loadJournalAudit(database, companyId, journalId),
    sourceEvidence: await loadSourceEvidence(database, companyId, row),
  };
}

function cleanOptionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'JOURNAL_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function validateJournalInput(input: JournalInput): {
  date: string;
  narration: string;
  narrationBn: string | null;
  bookType: (typeof JOURNAL_BOOK_TYPES)[number];
  branchId: string | null;
  attachmentReference: string | null;
  lines: ValidatedJournalLine[];
  totalDebit: bigint;
  totalCredit: bigint;
} {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real journal date in YYYY-MM-DD format.');
  }
  const narration = input.narration.trim();
  if (!narration || narration.length > 500) {
    throw new AppError(400, 'JOURNAL_NARRATION_INVALID', 'Narration must be between 1 and 500 characters.');
  }
  const narrationBn = cleanOptionalText(input.narrationBn, 500, 'Bangla narration');
  const bookType = (input.bookType ?? 'STATUTORY_BD') as (typeof JOURNAL_BOOK_TYPES)[number];
  if (!(JOURNAL_BOOK_TYPES as readonly string[]).includes(bookType)) {
    throw new AppError(400, 'BOOK_TYPE_INVALID', 'Choose a valid book type.');
  }
  if (!(SUPPORTED_BOOK_TYPES as readonly string[]).includes(bookType)) {
    throw new AppError(
      400,
      'BOOK_TYPE_NOT_SUPPORTED',
      'This release posts the statutory BDT book only. Multiple books need a defined accounting policy and reconciliation design.',
    );
  }
  const branchId = input.branchId ?? null;
  if (
    branchId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)
  ) {
    throw new AppError(400, 'JOURNAL_BRANCH_INVALID', 'Choose a valid branch for the journal.');
  }
  const attachmentReference = cleanOptionalText(input.attachmentReference, 500, 'Attachment reference');
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    throw new AppError(400, 'JOURNAL_TOO_FEW_LINES', 'A journal needs at least two lines.');
  }
  if (input.lines.length > MAX_JOURNAL_LINES) {
    throw new AppError(
      400,
      'JOURNAL_TOO_MANY_LINES',
      `A journal may contain at most ${MAX_JOURNAL_LINES.toLocaleString('en-US')} lines.`,
    );
  }

  let totalDebit = 0n;
  let totalCredit = 0n;
  const lines = input.lines.map((line, index) => {
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
        'JOURNAL_LINE_SIDE_INVALID',
        `Line ${index + 1}: enter exactly one positive debit or credit amount.`,
      );
    }
    totalDebit += debit;
    totalCredit += credit;
    return {
      accountId: line.accountId,
      debit,
      credit,
      partyReference: cleanOptionalText(line.partyReference, 200, `Line ${index + 1} party reference`),
      partyName: cleanOptionalText(line.partyName, 200, `Line ${index + 1} party name`),
      costCenter: cleanOptionalText(line.costCenter, 120, `Line ${index + 1} cost centre`),
      projectCode: cleanOptionalText(line.projectCode, 120, `Line ${index + 1} project code`),
      memo: cleanOptionalText(line.memo, 500, `Line ${index + 1} memo`),
    };
  });
  if (totalDebit > MAX_POSTING_POISHA || totalCredit > MAX_POSTING_POISHA) {
    throw new AppError(400, 'JOURNAL_AMOUNT_TOO_LARGE', 'The journal total exceeds the supported posting range.');
  }
  return {
    date: input.date,
    narration,
    narrationBn,
    bookType,
    branchId,
    attachmentReference,
    lines,
    totalDebit,
    totalCredit,
  };
}

async function assertAccountsBelong(
  database: Queryable,
  companyId: string,
  lines: ReadonlyArray<{ accountId: string }>,
): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  if (ids.length === 0) return;
  const result = await database.query<{ id: string; code: string; is_active: boolean }>(
    `SELECT id, code, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const found = new Map(result.rows.map((row) => [row.id, row]));
  const inactive: string[] = [];
  for (const id of ids) {
    const account = found.get(id);
    if (!account) {
      throw new AppError(
        400,
        'JOURNAL_ACCOUNT_INVALID',
        'Every journal line must use an active account from this company.',
      );
    }
    if (!account.is_active) inactive.push(account.code);
  }
  if (inactive.length > 0) {
    throw new AppError(
      400,
      'JOURNAL_ACCOUNT_INACTIVE',
      `Inactive accounts cannot receive journal lines: ${inactive.join(', ')}.`,
    );
  }
}

async function assertBranchBelongs(database: Queryable, companyId: string, branchId: string | null): Promise<void> {
  if (!branchId) return;
  const result = await database.query<{ id: string; status: string }>(
    `SELECT id, status FROM branches WHERE company_id = $1 AND id = $2`,
    [companyId, branchId],
  );
  const branch = result.rows[0];
  if (!branch) {
    throw new AppError(400, 'JOURNAL_BRANCH_INVALID', 'The selected branch does not belong to this company.');
  }
  if (branch.status !== 'ACTIVE') {
    throw new AppError(400, 'JOURNAL_BRANCH_INACTIVE', 'An inactive branch cannot receive a new journal.');
  }
}

interface PostingPeriodRow {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  code: string;
  start_date: Date;
  end_date: Date;
  status: string;
}

async function resolveConfiguredPeriod(
  database: Queryable,
  companyId: string,
  date: string,
): Promise<PostingPeriodRow> {
  const result = await database.query<PostingPeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, start_date, end_date, status
       FROM periods
      WHERE company_id = $1 AND start_date <= $2::date AND end_date >= $2::date
      LIMIT 1`,
    [companyId, date],
  );
  const period = result.rows[0];
  if (!period) {
    throw new AppError(
      400,
      'PERIOD_NOT_FOUND',
      `No accounting period is configured for ${date}. Generate the fiscal year before posting.`,
    );
  }
  return period;
}

async function lockPostingPeriod(
  database: Queryable,
  companyId: string,
  periodId: string,
  postingDate: string,
): Promise<PostingPeriodRow> {
  const result = await database.query<PostingPeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, start_date, end_date, status
       FROM periods
      WHERE company_id = $1 AND id = $2
      FOR SHARE`,
    [companyId, periodId],
  );
  const period = result.rows[0];
  if (!period) {
    throw new AppError(404, 'PERIOD_NOT_FOUND', 'The journal period no longer exists.');
  }
  if (postingDate < formatDatabaseDate(period.start_date) || postingDate > formatDatabaseDate(period.end_date)) {
    throw new AppError(409, 'JOURNAL_PERIOD_MISMATCH', 'The posting date is outside the journal period.');
  }
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'PERIOD_NOT_OPEN',
      `The period ${period.code} is ${period.status}; postings are accepted only in an OPEN period.`,
      { periodCode: period.code, status: period.status },
    );
  }
  return period;
}

function assertLinesPostable(lines: ReadonlyArray<{ debit: bigint; credit: bigint }>): {
  totalDebit: bigint;
  totalCredit: bigint;
} {
  if (lines.length < 2) {
    throw new AppError(409, 'JOURNAL_TOO_FEW_LINES', 'A journal needs at least two lines before it can be posted.');
  }
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n || line.debit > 0n === line.credit > 0n) {
      throw new AppError(409, 'JOURNAL_LINE_SIDE_INVALID', 'Every journal line needs exactly one positive amount.');
    }
    totalDebit += line.debit;
    totalCredit += line.credit;
  }
  if (totalDebit <= 0n) {
    throw new AppError(409, 'JOURNAL_EMPTY', 'A journal must carry a positive debit total.');
  }
  if (totalDebit !== totalCredit) {
    throw new AppError(
      409,
      'JOURNAL_UNBALANCED',
      `Journal is unbalanced: debit ${formatPoishaAsBdt(totalDebit)} BDT vs credit ${formatPoishaAsBdt(totalCredit)} BDT.`,
      { differenceBdt: formatPoishaAsBdt(totalDebit - totalCredit) },
    );
  }
  return { totalDebit, totalCredit };
}

async function loadValidatedLines(
  database: Queryable,
  companyId: string,
  journalId: string,
): Promise<{ lines: Array<{ debit: bigint; credit: bigint }>; totalDebit: bigint; totalCredit: bigint }> {
  const result = await database.query<{ account_id: string; debit_poisha: string; credit_poisha: string }>(
    `SELECT account_id, debit_poisha::text AS debit_poisha, credit_poisha::text AS credit_poisha
       FROM journal_lines
      WHERE company_id = $1 AND journal_id = $2
      ORDER BY line_no ASC`,
    [companyId, journalId],
  );
  const lines = result.rows.map((row) => ({ debit: BigInt(row.debit_poisha), credit: BigInt(row.credit_poisha) }));
  await assertAccountsBelong(
    database,
    companyId,
    result.rows.map((row) => ({ accountId: row.account_id })),
  );
  return { lines, ...assertLinesPostable(lines) };
}

async function insertJournalLines(
  client: PoolClient,
  companyId: string,
  journalId: string,
  lines: ReadonlyArray<{
    accountId: string;
    debit: bigint;
    credit: bigint;
    partyReference?: string | null;
    partyName?: string | null;
    costCenter?: string | null;
    projectCode?: string | null;
    memo?: string | null;
  }>,
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO journal_lines (
         company_id, journal_id, line_no, account_id, party_reference, party_name,
         cost_center, project_code, debit_poisha, credit_poisha, memo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        companyId,
        journalId,
        index + 1,
        line.accountId,
        line.partyReference ?? null,
        line.partyName ?? null,
        line.costCenter ?? null,
        line.projectCode ?? null,
        line.debit.toString(),
        line.credit.toString(),
        line.memo ?? null,
      ],
    );
  }
}

async function getApprovalThreshold(database: Queryable, companyId: string): Promise<bigint> {
  const result = await database.query<{ value_json: Record<string, unknown> | null }>(
    `SELECT value_json FROM company_settings WHERE company_id = $1 AND key = 'approval_thresholds'`,
    [companyId],
  );
  const raw = result.rows[0]?.value_json?.highValuePoisha;
  return typeof raw === 'string' && /^[0-9]+$/.test(raw) ? BigInt(raw) : 0n;
}

async function allocateJournalNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  periodCode: string,
): Promise<string> {
  const result = await client.query<{
    id: string;
    prefix: string;
    pad: number;
    next_value: string;
  }>(
    `SELECT id, prefix, pad, next_value::text AS next_value
       FROM number_sequences
      WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = 'JOURNAL'
      FOR UPDATE`,
    [companyId, fiscalYearId],
  );
  const sequence = result.rows[0];
  if (!sequence) {
    throw new AppError(
      409,
      'JOURNAL_SEQUENCE_MISSING',
      'The JOURNAL number sequence is not configured for this fiscal year. Recreate or repair the fiscal-year numbering setup.',
    );
  }
  const value = BigInt(sequence.next_value);
  if (value < 1n) {
    throw new AppError(409, 'JOURNAL_SEQUENCE_INVALID', 'The JOURNAL sequence value must be at least 1.');
  }
  const number = formatJournalNumber(sequence.prefix, periodCode, value, sequence.pad);
  await client.query(
    `UPDATE number_sequences SET next_value = $3, version = version + 1 WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

export interface SystemJournalInput extends LedgerAuditContext {
  companyId: string;
  date: string;
  narration: string;
  narrationBn?: string | null;
  branchId?: string | null;
  sourceModule: string;
  sourceDocId?: string | null;
  sourceDocRef?: string | null;
  idempotencyKey?: string | null;
  lines: JournalLineInput[];
}

/**
 * Create and post a system-generated journal inside an existing transaction. Inventory uses this
 * helper so every stock movement goes through the same account, period, balance, numbering,
 * idempotency and audit rules as a manual journal.
 */
export async function postSystemJournalWithinTransaction(
  client: PoolClient,
  input: SystemJournalInput,
): Promise<JournalDetailDto> {
  if (!(JOURNAL_SOURCE_MODULES as readonly string[]).includes(input.sourceModule)) {
    throw new AppError(500, 'JOURNAL_SOURCE_MODULE_INVALID', 'The system journal source module is not supported.');
  }
  if (input.sourceDocRef && input.sourceDocRef.length > 200) {
    throw new AppError(400, 'JOURNAL_SOURCE_REF_TOO_LONG', 'The source reference must be at most 200 characters.');
  }
  const validated = validateJournalInput({
    date: input.date,
    narration: input.narration,
    narrationBn: input.narrationBn ?? null,
    branchId: input.branchId ?? null,
    lines: input.lines,
  });
  const period = await resolveConfiguredPeriod(client, input.companyId, validated.date);
  await assertAccountsBelong(client, input.companyId, validated.lines);
  await assertBranchBelongs(client, input.companyId, validated.branchId);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO journals (
       company_id, branch_id, book_type, period_id, document_date, posting_date, source_module,
       source_doc_id, source_doc_ref, narration_en, narration_bn, currency, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,'BDT','DRAFT',$11)
     RETURNING id`,
    [
      input.companyId,
      validated.branchId,
      validated.bookType,
      period.id,
      validated.date,
      input.sourceModule,
      input.sourceDocId ?? null,
      input.sourceDocRef ?? null,
      validated.narration,
      validated.narrationBn,
      input.actorUserId,
    ],
  );
  const journalId = inserted.rows[0]?.id;
  if (!journalId) throw new AppError(500, 'JOURNAL_CREATE_FAILED', 'The system journal could not be created.');
  await insertJournalLines(client, input.companyId, journalId, validated.lines);
  const posted = await postJournalWithinTransaction(client, {
    ...input,
    journalId,
    idempotencyKey: input.idempotencyKey ?? null,
    enforceApproval: false,
  });
  return posted.journal;
}

export interface SystemJournalDraftInput extends LedgerAuditContext {
  companyId: string;
  date: string;
  narration: string;
  narrationBn?: string | null;
  branchId?: string | null;
  sourceModule: string;
  sourceDocId?: string | null;
  sourceDocRef?: string | null;
  attachmentReference?: string | null;
  lines: JournalLineInput[];
}

/**
 * Create an unposted system journal inside an existing transaction. Banking reconciliation uses this
 * to create the draft that must later pass its own maker-checker approval; the generic manual-journal
 * routes deliberately cannot submit or post it.
 */
export async function createSystemJournalDraftWithinTransaction(
  client: PoolClient,
  input: SystemJournalDraftInput,
): Promise<string> {
  if (!(JOURNAL_SOURCE_MODULES as readonly string[]).includes(input.sourceModule)) {
    throw new AppError(500, 'JOURNAL_SOURCE_MODULE_INVALID', 'The system journal source module is not supported.');
  }
  if (input.sourceDocRef && input.sourceDocRef.length > 200) {
    throw new AppError(400, 'JOURNAL_SOURCE_REF_TOO_LONG', 'The source reference must be at most 200 characters.');
  }
  const validated = validateJournalInput({
    date: input.date,
    narration: input.narration,
    narrationBn: input.narrationBn ?? null,
    branchId: input.branchId ?? null,
    attachmentReference: input.attachmentReference ?? null,
    lines: input.lines,
  });
  const period = await resolveConfiguredPeriod(client, input.companyId, validated.date);
  await assertAccountsBelong(client, input.companyId, validated.lines);
  await assertBranchBelongs(client, input.companyId, validated.branchId);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO journals (
       company_id, branch_id, book_type, period_id, document_date, posting_date, source_module,
       source_doc_id, source_doc_ref, narration_en, narration_bn, currency, status,
       attachment_reference, created_by
     ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,'BDT','DRAFT',$11,$12)
     RETURNING id`,
    [
      input.companyId,
      validated.branchId,
      validated.bookType,
      period.id,
      validated.date,
      input.sourceModule,
      input.sourceDocId ?? null,
      input.sourceDocRef ?? null,
      validated.narration,
      validated.narrationBn,
      validated.attachmentReference,
      input.actorUserId,
    ],
  );
  const journalId = inserted.rows[0]?.id;
  if (!journalId) throw new AppError(500, 'JOURNAL_CREATE_FAILED', 'The system journal draft could not be created.');
  await insertJournalLines(client, input.companyId, journalId, validated.lines);
  return journalId;
}

export async function createJournalDraft(
  pool: Pool,
  input: JournalInput & LedgerAuditContext & { companyId: string },
): Promise<JournalDetailDto> {
  const validated = validateJournalInput(input);
  return withTransaction(pool, async (client) => {
    const period = await resolveConfiguredPeriod(client, input.companyId, validated.date);
    await assertAccountsBelong(client, input.companyId, validated.lines);
    await assertBranchBelongs(client, input.companyId, validated.branchId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO journals (
         company_id, branch_id, book_type, period_id, document_date, posting_date, source_module,
         narration_en, narration_bn, currency, status, attachment_reference, created_by
       ) VALUES ($1,$2,$3,$4,$5,$5,'MANUAL_JOURNAL',$6,$7,'BDT','DRAFT',$8,$9)
       RETURNING id`,
      [
        input.companyId,
        validated.branchId,
        validated.bookType,
        period.id,
        validated.date,
        validated.narration,
        validated.narrationBn,
        validated.attachmentReference,
        input.actorUserId,
      ],
    );
    const journalId = inserted.rows[0]?.id;
    if (!journalId) throw new AppError(500, 'JOURNAL_CREATE_FAILED', 'The journal draft could not be created.');
    await insertJournalLines(client, input.companyId, journalId, validated.lines);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'journal.created',
      entityType: 'journal',
      entityId: journalId,
      after: {
        date: validated.date,
        bookType: validated.bookType,
        periodId: period.id,
        lineCount: validated.lines.length,
        totalDebitPoisha: validated.totalDebit.toString(),
        totalCreditPoisha: validated.totalCredit.toString(),
        balanced: validated.totalDebit === validated.totalCredit && validated.totalDebit > 0n,
        sourceModule: 'MANUAL_JOURNAL',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadJournal(client, input.companyId, journalId);
  });
}

export async function updateJournalDraft(
  pool: Pool,
  input: JournalInput & LedgerAuditContext & { companyId: string; journalId: string },
): Promise<JournalDetailDto> {
  const validated = validateJournalInput(input);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      status: string;
      source_module: string;
      period_id: string;
      branch_id: string | null;
      document_date: Date;
      narration_en: string;
      line_count: number;
    }>(
      `SELECT j.status, j.source_module, j.period_id, j.branch_id, j.document_date, j.narration_en,
              (SELECT count(*)::int FROM journal_lines l WHERE l.company_id = j.company_id AND l.journal_id = j.id) AS line_count
         FROM journals j
        WHERE j.company_id = $1 AND j.id = $2
        FOR UPDATE OF j`,
      [input.companyId, input.journalId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');
    if (before.source_module !== 'MANUAL_JOURNAL') {
      throw new AppError(409, 'JOURNAL_NOT_EDITABLE', 'Only manual journal drafts can be edited through this route.');
    }
    if (before.status !== 'DRAFT') {
      throw new AppError(
        409,
        'JOURNAL_NOT_DRAFT',
        'Only a draft journal can be edited. Posted journals are immutable; use a linked reversal.',
      );
    }
    const period = await resolveConfiguredPeriod(client, input.companyId, validated.date);
    await assertAccountsBelong(client, input.companyId, validated.lines);
    await assertBranchBelongs(client, input.companyId, validated.branchId);
    await client.query(
      `UPDATE journals
          SET period_id = $3, branch_id = $4, document_date = $5, posting_date = $5, narration_en = $6,
              narration_bn = $7, attachment_reference = $8, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.journalId,
        period.id,
        validated.branchId,
        validated.date,
        validated.narration,
        validated.narrationBn,
        validated.attachmentReference,
      ],
    );
    await client.query(`DELETE FROM journal_lines WHERE company_id = $1 AND journal_id = $2`, [
      input.companyId,
      input.journalId,
    ]);
    await insertJournalLines(client, input.companyId, input.journalId, validated.lines);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'journal.updated',
      entityType: 'journal',
      entityId: input.journalId,
      before: {
        date: formatDatabaseDate(before.document_date),
        branchId: before.branch_id,
        narration: before.narration_en,
        lineCount: before.line_count,
      },
      after: {
        date: validated.date,
        branchId: validated.branchId,
        narration: validated.narration,
        lineCount: validated.lines.length,
        totalDebitPoisha: validated.totalDebit.toString(),
        totalCreditPoisha: validated.totalCredit.toString(),
        balanced: validated.totalDebit === validated.totalCredit && validated.totalDebit > 0n,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadJournal(client, input.companyId, input.journalId);
  });
}

export async function submitJournal(
  pool: Pool,
  input: LedgerAuditContext & { companyId: string; journalId: string },
): Promise<JournalDetailDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      status: string;
      source_module: string;
      period_id: string;
      posting_date: Date;
    }>(
      `SELECT status, source_module, period_id, posting_date
         FROM journals
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.journalId],
    );
    const journal = existing.rows[0];
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');
    if (journal.source_module !== 'MANUAL_JOURNAL') {
      throw new AppError(409, 'JOURNAL_NOT_SUBMITTABLE', 'Only manual journals use the manual submit workflow.');
    }
    if (journal.status !== 'DRAFT') {
      throw new AppError(409, 'JOURNAL_NOT_DRAFT', 'Only a draft journal can be submitted.');
    }
    const postingDate = formatDatabaseDate(journal.posting_date);
    await lockPostingPeriod(client, input.companyId, journal.period_id, postingDate);
    const validated = await loadValidatedLines(client, input.companyId, input.journalId);
    await client.query(
      `UPDATE journals
          SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.journalId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'journal.submitted',
      entityType: 'journal',
      entityId: input.journalId,
      before: { status: 'DRAFT' },
      after: {
        status: 'SUBMITTED',
        totalDebitPoisha: validated.totalDebit.toString(),
        totalCreditPoisha: validated.totalCredit.toString(),
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadJournal(client, input.companyId, input.journalId);
  });
}

export async function approveJournal(
  pool: Pool,
  input: LedgerAuditContext & { companyId: string; journalId: string },
): Promise<JournalDetailDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      status: string;
      source_module: string;
      period_id: string;
      posting_date: Date;
      created_by: string;
      submitted_by: string | null;
    }>(
      `SELECT status, source_module, period_id, posting_date, created_by, submitted_by
         FROM journals
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.journalId],
    );
    const journal = existing.rows[0];
    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');
    if (journal.source_module !== 'MANUAL_JOURNAL') {
      throw new AppError(409, 'JOURNAL_NOT_APPROVABLE', 'Only manual journals use the manual approval workflow.');
    }
    if (journal.status !== 'SUBMITTED') {
      throw new AppError(409, 'JOURNAL_NOT_SUBMITTED', 'Only a submitted journal can be approved.');
    }
    if (input.actorUserId === journal.created_by || input.actorUserId === journal.submitted_by) {
      throw new AppError(
        409,
        'JOURNAL_SELF_APPROVAL',
        'The maker cannot approve the same journal. Ask a different controller or administrator to approve it.',
      );
    }
    await lockPostingPeriod(client, input.companyId, journal.period_id, formatDatabaseDate(journal.posting_date));
    await client.query(
      `UPDATE journals
          SET status = 'APPROVED', approved_at = now(), approved_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.journalId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'journal.approved',
      entityType: 'journal',
      entityId: input.journalId,
      before: { status: 'SUBMITTED' },
      after: { status: 'APPROVED' },
      reason: 'Approved for posting to the ledger.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadJournal(client, input.companyId, input.journalId);
  });
}

/**
 * Shared posting transaction body. Opening balances and reversals call this inside their own
 * transaction so every posting path uses the same period, account, balance, numbering, idempotency
 * and audit rules.
 */
export async function postJournalWithinTransaction(
  client: PoolClient,
  input: LedgerAuditContext & {
    companyId: string;
    journalId: string;
    idempotencyKey?: string | null;
    enforceApproval?: boolean;
  },
): Promise<{ journal: JournalDetailDto; replayed: boolean }> {
  const existing = await client.query<{
    id: string;
    status: string;
    source_module: string;
    reversal_of_journal_id: string | null;
    period_id: string;
    posting_date: Date;
    created_by: string;
    journal_number: string | null;
    idempotency_key: string | null;
  }>(
    `SELECT id, status, source_module, reversal_of_journal_id, period_id, posting_date,
            created_by, journal_number, idempotency_key
       FROM journals
      WHERE company_id = $1 AND id = $2
      FOR UPDATE`,
    [input.companyId, input.journalId],
  );
  const journal = existing.rows[0];
  if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');

  if (journal.status === 'POSTED' || journal.status === 'REVERSED') {
    if (journal.status === 'POSTED' && input.idempotencyKey && journal.idempotency_key === input.idempotencyKey) {
      return {
        journal: await loadJournal(client, input.companyId, input.journalId),
        replayed: true,
      };
    }
    throw new AppError(
      409,
      journal.status === 'REVERSED' ? 'JOURNAL_ALREADY_REVERSED' : 'JOURNAL_ALREADY_POSTED',
      `Journal ${journal.journal_number ?? input.journalId} is already ${journal.status}. It cannot be posted twice.`,
      { journalNumber: journal.journal_number, status: journal.status },
    );
  }
  if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(journal.status)) {
    throw new AppError(409, 'JOURNAL_NOT_POSTABLE', `A ${journal.status} journal cannot be posted.`);
  }

  const postingDate = formatDatabaseDate(journal.posting_date);
  const period = await lockPostingPeriod(client, input.companyId, journal.period_id, postingDate);
  const validated = await loadValidatedLines(client, input.companyId, input.journalId);

  if (input.enforceApproval !== false && journal.source_module === 'MANUAL_JOURNAL') {
    const threshold = await getApprovalThreshold(client, input.companyId);
    if (threshold > 0n && validated.totalDebit >= threshold && journal.status !== 'APPROVED') {
      throw new AppError(
        409,
        'JOURNAL_APPROVAL_REQUIRED',
        `This journal is at or above the configured approval threshold of ${formatPoishaAsBdt(threshold)} BDT. Submit and obtain approval from a different controller before posting.`,
        { thresholdBdt: formatPoishaAsBdt(threshold) },
      );
    }
  }

  if (input.idempotencyKey) {
    const conflict = await client.query<{ id: string; journal_number: string | null }>(
      `SELECT id, journal_number FROM journals
        WHERE company_id = $1 AND idempotency_key = $2 AND id <> $3
        LIMIT 1`,
      [input.companyId, input.idempotencyKey, input.journalId],
    );
    if (conflict.rows[0]) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another journal.', {
        journalId: conflict.rows[0].id,
        journalNumber: conflict.rows[0].journal_number,
      });
    }
  }

  const journalNumber = await allocateJournalNumber(client, input.companyId, period.fiscal_year_id, period.code);

  try {
    await client.query(
      `UPDATE journals
          SET status = 'POSTED', journal_number = $3, posted_at = now(), posted_by = $4,
              idempotency_key = COALESCE($5, idempotency_key), updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.journalId, journalNumber, input.actorUserId, input.idempotencyKey ?? null],
    );
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint?.includes('journals_company_book_number_unique')) {
      throw new AppError(
        409,
        'JOURNAL_NUMBER_CONFLICT',
        'The JOURNAL sequence points at an existing number. Repair the sequence; numbers are never silently skipped or reused.',
      );
    }
    if (pgError.code === '23505' && pgError.constraint?.includes('journals_company_idempotency_unique')) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another journal.');
    }
    throw error;
  }

  await writeAuditEvent(client, {
    organisationId: input.organisationId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    action: 'journal.posted',
    entityType: 'journal',
    entityId: input.journalId,
    before: { status: journal.status },
    after: {
      status: 'POSTED',
      journalNumber,
      sourceModule: journal.source_module,
      totalDebitPoisha: validated.totalDebit.toString(),
      totalCreditPoisha: validated.totalCredit.toString(),
      lineCount: validated.lines.length,
      idempotencyKeyUsed: Boolean(input.idempotencyKey),
    },
    reason:
      journal.source_module === 'OPENING_BALANCE'
        ? 'Opening balances posted through the server ledger.'
        : 'Posted through the server-authoritative ledger.',
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });

  return {
    journal: await loadJournal(client, input.companyId, input.journalId),
    replayed: false,
  };
}

export async function postJournal(
  pool: Pool,
  input: LedgerAuditContext & {
    companyId: string;
    journalId: string;
    idempotencyKey?: string | null;
  },
): Promise<{ journal: JournalDetailDto; replayed: boolean }> {
  return withTransaction(pool, (client) => postJournalWithinTransaction(client, { ...input, enforceApproval: true }));
}

export interface ReverseJournalInput extends LedgerAuditContext {
  companyId: string;
  journalId: string;
  date: string;
  reason: string;
}

export async function reverseJournalWithinTransaction(
  client: PoolClient,
  input: ReverseJournalInput,
): Promise<{ original: JournalDetailDto; reversal: JournalDetailDto }> {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'REVERSAL_REASON_REQUIRED', 'A reversal reason between 3 and 500 characters is required.');
  }

  {
    const existing = await client.query<{
      id: string;
      status: string;
      journal_number: string | null;
      book_type: string;
      period_id: string;
      branch_id: string | null;
      posting_date: Date;
      source_module: string;
      source_doc_id: string | null;
      source_doc_ref: string | null;
      reversal_of_journal_id: string | null;
      reversed_by_journal_id: string | null;
      created_by: string;
      posted_by: string | null;
    }>(
      `SELECT id, status, journal_number, book_type, period_id, branch_id, posting_date, source_module,
              source_doc_id, source_doc_ref, reversal_of_journal_id, reversed_by_journal_id,
              created_by, posted_by
         FROM journals
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.journalId],
    );
    const original = existing.rows[0];
    if (!original) throw new AppError(404, 'JOURNAL_NOT_FOUND', 'Journal not found.');
    if (original.reversal_of_journal_id) {
      throw new AppError(
        409,
        'REVERSAL_OF_REVERSAL',
        'A reversal journal cannot itself be reversed. Post a new correcting journal instead.',
      );
    }
    if (original.status === 'REVERSED' || original.reversed_by_journal_id) {
      throw new AppError(
        409,
        'REVERSAL_ALREADY_EXISTS',
        `Journal ${original.journal_number ?? input.journalId} has already been reversed.`,
        { reversalJournalId: original.reversed_by_journal_id },
      );
    }
    if (original.status !== 'POSTED') {
      throw new AppError(409, 'JOURNAL_NOT_POSTED', 'Only a posted journal can be reversed.');
    }

    const reversalPeriodLookup = await resolveConfiguredPeriod(client, input.companyId, input.date);
    const reversalPeriod = await lockPostingPeriod(client, input.companyId, reversalPeriodLookup.id, input.date);

    const originalLines = await client.query<{
      account_id: string;
      party_reference: string | null;
      party_name: string | null;
      cost_center: string | null;
      project_code: string | null;
      debit_poisha: string;
      credit_poisha: string;
      memo: string | null;
    }>(
      `SELECT account_id, party_reference, party_name, cost_center, project_code,
              debit_poisha::text AS debit_poisha, credit_poisha::text AS credit_poisha, memo
         FROM journal_lines
        WHERE company_id = $1 AND journal_id = $2
        ORDER BY line_no ASC`,
      [input.companyId, input.journalId],
    );
    if (originalLines.rows.length < 2) {
      throw new AppError(409, 'JOURNAL_TOO_FEW_LINES', 'The original journal has too few lines to reverse.');
    }
    const originalTotalDebit = originalLines.rows.reduce((total, line) => total + BigInt(line.debit_poisha), 0n);
    const reversalThreshold = await getApprovalThreshold(client, input.companyId);
    if (
      reversalThreshold > 0n &&
      originalTotalDebit >= reversalThreshold &&
      (original.created_by === input.actorUserId || original.posted_by === input.actorUserId)
    ) {
      throw new AppError(
        403,
        'REVERSAL_SELF_APPROVAL',
        'The user who created or posted this high-value journal cannot reverse it. A different controller must post the reversal.',
        { thresholdPoisha: reversalThreshold.toString() },
      );
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO journals (
         company_id, branch_id, book_type, period_id, document_date, posting_date, source_module,
         source_doc_id, source_doc_ref, narration_en, narration_bn, currency, status,
         reversal_of_journal_id, reversal_reason, created_by
       ) VALUES ($1,$2,$3,$4,$5,$5,'REVERSAL',$6,$7,$8,NULL,'BDT','DRAFT',$9,$10,$11)
       RETURNING id`,
      [
        input.companyId,
        original.branch_id,
        original.book_type,
        reversalPeriod.id,
        input.date,
        original.source_doc_id,
        original.source_doc_ref,
        `Reversal of ${original.journal_number ?? input.journalId} — ${reason}`,
        input.journalId,
        reason,
        input.actorUserId,
      ],
    );
    const reversalId = inserted.rows[0]?.id;
    if (!reversalId) throw new AppError(500, 'REVERSAL_CREATE_FAILED', 'The reversal journal could not be created.');

    await insertJournalLines(
      client,
      input.companyId,
      reversalId,
      originalLines.rows.map((line) => ({
        accountId: line.account_id,
        debit: BigInt(line.credit_poisha),
        credit: BigInt(line.debit_poisha),
        partyReference: line.party_reference,
        partyName: line.party_name,
        costCenter: line.cost_center,
        projectCode: line.project_code,
        memo: `Reversal of ${original.journal_number ?? input.journalId}`,
      })),
    );

    const posted = await postJournalWithinTransaction(client, {
      ...input,
      journalId: reversalId,
      idempotencyKey: `REVERSAL|${original.id}`,
      enforceApproval: false,
    });

    const updated = await client.query(
      `UPDATE journals
          SET status = 'REVERSED', reversed_by_journal_id = $3, reversal_reason = $4,
              reversed_at = now(), reversed_by = $5, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, input.journalId, reversalId, reason, input.actorUserId],
    );
    if (updated.rowCount !== 1) {
      throw new AppError(409, 'REVERSAL_CONFLICT', 'The original journal changed while the reversal was being posted.');
    }

    if (original.source_module === 'OPENING_BALANCE' && original.source_doc_id) {
      const batch = await client.query(
        `UPDATE opening_balance_batches
            SET status = 'REVERSED', reversal_journal_id = $3, reversed_at = now(), reversed_by = $4,
                updated_at = now()
          WHERE company_id = $1 AND id = $2 AND journal_id = $5 AND status = 'POSTED'`,
        [input.companyId, original.source_doc_id, reversalId, input.actorUserId, input.journalId],
      );
      if (batch.rowCount !== 1) {
        throw new AppError(
          409,
          'OPENING_BATCH_LINK_MISSING',
          'The opening-balance batch link is inconsistent; the reversal was rolled back.',
        );
      }
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'journal.reversed',
      entityType: 'journal',
      entityId: input.journalId,
      before: { status: 'POSTED' },
      after: {
        status: 'REVERSED',
        reversalJournalId: reversalId,
        reversalJournalNumber: posted.journal.journalNumber,
        reason,
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return {
      original: await loadJournal(client, input.companyId, input.journalId),
      reversal: await loadJournal(client, input.companyId, reversalId),
    };
  }
}

export async function reverseJournal(
  pool: Pool,
  input: ReverseJournalInput,
): Promise<{ original: JournalDetailDto; reversal: JournalDetailDto }> {
  return withTransaction(pool, (client) => reverseJournalWithinTransaction(client, input));
}

export interface JournalListFilters {
  from?: string;
  to?: string;
  status?: (typeof JOURNAL_STATUSES)[number];
  sourceModule?: string;
  branchId?: string | null;
  branchScope?: 'ALL' | 'UNASSIGNED';
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listJournals(
  database: Queryable,
  companyId: string,
  filters: JournalListFilters = {},
): Promise<{ entries: JournalSummaryDto[]; total: number; limit: number; offset: number }> {
  if (filters.from && !isValidIsoDate(filters.from)) {
    throw new AppError(400, 'INVALID_DATE', 'The from date must be a real YYYY-MM-DD date.');
  }
  if (filters.to && !isValidIsoDate(filters.to)) {
    throw new AppError(400, 'INVALID_DATE', 'The to date must be a real YYYY-MM-DD date.');
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new AppError(400, 'JOURNAL_DATE_RANGE_INVALID', 'The from date must not be after the to date.');
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const values: unknown[] = [companyId];
  const where = ['j.company_id = $1'];
  if (filters.from) {
    values.push(filters.from);
    where.push(`j.posting_date >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    where.push(`j.posting_date <= $${values.length}::date`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`j.status = $${values.length}`);
  }
  if (filters.sourceModule) {
    values.push(filters.sourceModule);
    where.push(`j.source_module = $${values.length}`);
  }
  if (filters.branchScope === 'UNASSIGNED') {
    where.push('j.branch_id IS NULL');
  } else if (filters.branchId) {
    values.push(filters.branchId);
    where.push(`j.branch_id = $${values.length}`);
  }
  if (filters.q) {
    values.push(`%${filters.q}%`);
    where.push(
      `(j.journal_number ILIKE $${values.length} OR j.narration_en ILIKE $${values.length} OR COALESCE(j.source_doc_ref, '') ILIKE $${values.length})`,
    );
  }
  values.push(limit);
  const limitIndex = values.length;
  values.push(offset);
  const offsetIndex = values.length;

  const result = await database.query<JournalRow>(
    `${JOURNAL_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY j.posting_date DESC, j.created_at DESC, j.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  return {
    entries: result.rows.map(mapJournal),
    total: Number(result.rows[0]?.total_count ?? 0),
    limit,
    offset,
  };
}

interface TrialBalanceQueryRow {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  account_type: string;
  sub_category: string;
  opening_debit: string;
  opening_credit: string;
  period_debit: string;
  period_credit: string;
}

export interface TrialBalanceRowDto {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  accountNameBn: string | null;
  accountType: string;
  subCategory: string;
  openingDebitPoisha: string;
  openingCreditPoisha: string;
  openingNetPoisha: string;
  periodDebitPoisha: string;
  periodCreditPoisha: string;
  periodNetPoisha: string;
  closingDebitPoisha: string;
  closingCreditPoisha: string;
  closingNetPoisha: string;
}

export interface TrialBalanceDto {
  companyId: string;
  periodId: string | null;
  periodCode: string | null;
  from: string;
  to: string;
  currency: string;
  rows: TrialBalanceRowDto[];
  totals: {
    openingDebitPoisha: string;
    openingCreditPoisha: string;
    periodDebitPoisha: string;
    periodCreditPoisha: string;
    closingDebitPoisha: string;
    closingCreditPoisha: string;
    differencePoisha: string;
  };
  balanced: boolean;
  generatedAt: string;
}

export interface TrialBalanceRangeInput {
  periodId?: string | null;
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
  branchScope?: 'ALL' | 'UNASSIGNED';
}

async function resolveTrialBalanceRange(
  database: Queryable,
  companyId: string,
  input: TrialBalanceRangeInput,
): Promise<{ periodId: string | null; periodCode: string | null; from: string; to: string }> {
  if (input.periodId) {
    const result = await database.query<{ id: string; code: string; start_date: Date; end_date: Date }>(
      `SELECT id, code, start_date, end_date FROM periods WHERE company_id = $1 AND id = $2`,
      [companyId, input.periodId],
    );
    const period = result.rows[0];
    if (!period) throw new AppError(404, 'PERIOD_NOT_FOUND', 'Accounting period not found.');
    return {
      periodId: period.id,
      periodCode: period.code,
      from: formatDatabaseDate(period.start_date),
      to: formatDatabaseDate(period.end_date),
    };
  }
  if (!input.from || !input.to || !isValidIsoDate(input.from) || !isValidIsoDate(input.to)) {
    throw new AppError(
      400,
      'TRIAL_BALANCE_RANGE_REQUIRED',
      'Choose an accounting period or a valid from/to date range.',
    );
  }
  if (input.from > input.to) {
    throw new AppError(400, 'TRIAL_BALANCE_RANGE_INVALID', 'The from date must not be after the to date.');
  }
  return { periodId: null, periodCode: null, from: input.from, to: input.to };
}

async function queryTrialBalanceRows(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
  accountId?: string,
  branchId?: string | null,
  branchScope: 'ALL' | 'UNASSIGNED' = 'ALL',
): Promise<TrialBalanceQueryRow[]> {
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
  const result = await database.query<TrialBalanceQueryRow>(
    `SELECT a.id, a.code, a.name_en, a.name_bn, a.account_type, a.sub_category,
            COALESCE(SUM(CASE WHEN m.posting_date < $2::date THEN m.debit_poisha ELSE 0 END), 0)::text AS opening_debit,
            COALESCE(SUM(CASE WHEN m.posting_date < $2::date THEN m.credit_poisha ELSE 0 END), 0)::text AS opening_credit,
            COALESCE(SUM(CASE WHEN m.posting_date >= $2::date AND m.posting_date <= $3::date THEN m.debit_poisha ELSE 0 END), 0)::text AS period_debit,
            COALESCE(SUM(CASE WHEN m.posting_date >= $2::date AND m.posting_date <= $3::date THEN m.credit_poisha ELSE 0 END), 0)::text AS period_credit
       FROM accounts a
       LEFT JOIN (
         SELECT l.company_id, l.account_id, l.debit_poisha, l.credit_poisha, j.posting_date
           FROM journal_lines l
           JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
          WHERE l.company_id = $1 AND j.status IN ('POSTED', 'REVERSED') ${branchFilter}
       ) m ON m.company_id = a.company_id AND m.account_id = a.id
      WHERE a.company_id = $1 ${accountFilter}
      GROUP BY a.id, a.code, a.name_en, a.name_bn, a.account_type, a.sub_category
      ORDER BY a.code ASC`,
    values,
  );
  return result.rows;
}

function mapTrialBalanceRow(row: TrialBalanceQueryRow): TrialBalanceRowDto | null {
  const openingDebit = BigInt(row.opening_debit);
  const openingCredit = BigInt(row.opening_credit);
  const periodDebit = BigInt(row.period_debit);
  const periodCredit = BigInt(row.period_credit);
  if (openingDebit === 0n && openingCredit === 0n && periodDebit === 0n && periodCredit === 0n) return null;
  const openingNet = openingDebit - openingCredit;
  const periodNet = periodDebit - periodCredit;
  const closingNet = openingNet + periodNet;
  return {
    accountId: row.id,
    accountCode: row.code,
    accountNameEn: row.name_en,
    accountNameBn: row.name_bn,
    accountType: row.account_type,
    subCategory: row.sub_category,
    openingDebitPoisha: openingDebit.toString(),
    openingCreditPoisha: openingCredit.toString(),
    openingNetPoisha: openingNet.toString(),
    periodDebitPoisha: periodDebit.toString(),
    periodCreditPoisha: periodCredit.toString(),
    periodNetPoisha: periodNet.toString(),
    closingDebitPoisha: (closingNet > 0n ? closingNet : 0n).toString(),
    closingCreditPoisha: (closingNet < 0n ? -closingNet : 0n).toString(),
    closingNetPoisha: closingNet.toString(),
  };
}

export async function getTrialBalance(
  database: Queryable,
  companyId: string,
  input: TrialBalanceRangeInput,
): Promise<TrialBalanceDto> {
  const range = await resolveTrialBalanceRange(database, companyId, input);
  const rows = (
    await queryTrialBalanceRows(
      database,
      companyId,
      range.from,
      range.to,
      undefined,
      input.branchId ?? null,
      input.branchScope ?? 'ALL',
    )
  )
    .map(mapTrialBalanceRow)
    .filter((row): row is TrialBalanceRowDto => row !== null);
  let openingDebit = 0n;
  let openingCredit = 0n;
  let periodDebit = 0n;
  let periodCredit = 0n;
  let closingDebit = 0n;
  let closingCredit = 0n;
  for (const row of rows) {
    openingDebit += BigInt(row.openingDebitPoisha);
    openingCredit += BigInt(row.openingCreditPoisha);
    periodDebit += BigInt(row.periodDebitPoisha);
    periodCredit += BigInt(row.periodCreditPoisha);
    closingDebit += BigInt(row.closingDebitPoisha);
    closingCredit += BigInt(row.closingCreditPoisha);
  }
  return {
    companyId,
    periodId: range.periodId,
    periodCode: range.periodCode,
    from: range.from,
    to: range.to,
    currency: 'BDT',
    rows,
    totals: {
      openingDebitPoisha: openingDebit.toString(),
      openingCreditPoisha: openingCredit.toString(),
      periodDebitPoisha: periodDebit.toString(),
      periodCreditPoisha: periodCredit.toString(),
      closingDebitPoisha: closingDebit.toString(),
      closingCreditPoisha: closingCredit.toString(),
      differencePoisha: (closingDebit - closingCredit).toString(),
    },
    balanced: closingDebit === closingCredit,
    generatedAt: new Date().toISOString(),
  };
}

export interface TrialBalanceLineDto {
  journalId: string;
  journalNumber: string | null;
  postingDate: string;
  status: string;
  sourceModule: string;
  narration: string;
  lineNo: number;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  runningNetPoisha: string;
  memo: string | null;
  reversalJournalNumber: string | null;
}

export async function getTrialBalanceAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
  input: TrialBalanceRangeInput,
): Promise<{
  range: { periodId: string | null; periodCode: string | null; from: string; to: string };
  account: TrialBalanceRowDto;
  lines: TrialBalanceLineDto[];
}> {
  const range = await resolveTrialBalanceRange(database, companyId, input);
  const account = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    account_type: string;
    sub_category: string;
  }>(`SELECT id, code, name_en, name_bn, account_type, sub_category FROM accounts WHERE company_id = $1 AND id = $2`, [
    companyId,
    accountId,
  ]);
  const accountRow = account.rows[0];
  if (!accountRow) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');

  const balanceRows = await queryTrialBalanceRows(
    database,
    companyId,
    range.from,
    range.to,
    accountId,
    input.branchId ?? null,
    input.branchScope ?? 'ALL',
  );
  const mapped = balanceRows[0] ? mapTrialBalanceRow(balanceRows[0]) : null;
  const balance: TrialBalanceRowDto = mapped ?? {
    accountId: accountRow.id,
    accountCode: accountRow.code,
    accountNameEn: accountRow.name_en,
    accountNameBn: accountRow.name_bn,
    accountType: accountRow.account_type,
    subCategory: accountRow.sub_category,
    openingDebitPoisha: '0',
    openingCreditPoisha: '0',
    openingNetPoisha: '0',
    periodDebitPoisha: '0',
    periodCreditPoisha: '0',
    periodNetPoisha: '0',
    closingDebitPoisha: '0',
    closingCreditPoisha: '0',
    closingNetPoisha: '0',
  };

  const lineValues: unknown[] = [companyId, accountId, range.from, range.to];
  let lineBranchFilter = '';
  if ((input.branchScope ?? 'ALL') === 'UNASSIGNED') {
    lineBranchFilter = 'AND j.branch_id IS NULL';
  } else if (input.branchId) {
    lineValues.push(input.branchId);
    lineBranchFilter = `AND j.branch_id = $${lineValues.length}`;
  }
  const lines = await database.query<{
    journal_id: string;
    journal_number: string | null;
    posting_date: Date;
    status: string;
    source_module: string;
    narration_en: string;
    line_no: number;
    debit_poisha: string;
    credit_poisha: string;
    memo: string | null;
    reversal_journal_number: string | null;
  }>(
    `SELECT j.id AS journal_id, j.journal_number, j.posting_date, j.status, j.source_module,
            j.narration_en, l.line_no, l.debit_poisha::text AS debit_poisha,
            l.credit_poisha::text AS credit_poisha, l.memo,
            rj.journal_number AS reversal_journal_number
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
       LEFT JOIN journals rj ON rj.company_id = j.company_id AND rj.id = j.reversed_by_journal_id
      WHERE l.company_id = $1 AND l.account_id = $2
        AND j.status IN ('POSTED', 'REVERSED')
        AND j.posting_date >= $3::date AND j.posting_date <= $4::date
        ${lineBranchFilter}
      ORDER BY j.posting_date ASC, j.journal_number ASC, l.line_no ASC`,
    lineValues,
  );

  let running = BigInt(balance.openingNetPoisha);
  const lineDtos = lines.rows.map((line) => {
    const debit = BigInt(line.debit_poisha);
    const credit = BigInt(line.credit_poisha);
    running += debit - credit;
    return {
      journalId: line.journal_id,
      journalNumber: line.journal_number,
      postingDate: formatDatabaseDate(line.posting_date),
      status: line.status,
      sourceModule: line.source_module,
      narration: line.narration_en,
      lineNo: line.line_no,
      debitPoisha: debit.toString(),
      creditPoisha: credit.toString(),
      debitBdt: formatPoishaAsBdt(debit),
      creditBdt: formatPoishaAsBdt(credit),
      runningNetPoisha: running.toString(),
      memo: line.memo,
      reversalJournalNumber: line.reversal_journal_number,
    };
  });

  return { range, account: balance, lines: lineDtos };
}
