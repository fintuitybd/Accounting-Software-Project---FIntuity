import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { escapeCsvCell } from '../company/csv.ts';
import { listBankAccounts } from '../company/bankAccountService.ts';
import { getArAgeing } from '../sales/receivablesService.ts';
import { getApAgeing } from '../purchases/payablesService.ts';
import { getCurrentReconciliation } from '../banking/reconciliationService.ts';
import { getBalanceSheetReport, getTrialBalanceReport } from '../reports/statements.ts';
import { getVatReturnDraft } from '../reports/registers.ts';
import { listOpenSuspenseItems, type SuspenseItemDto } from '../suspense/suspenseService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type CloseRunStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED';

export interface CloseCheckDto {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  applicable: boolean;
  blocking: boolean;
  differencePoisha: string | null;
  detailEn: string;
  detailBn: string;
  evidence: Record<string, unknown>;
}

export interface CloseExceptionDto {
  code: string;
  severity: 'WARNING' | 'BLOCKER';
  messageEn: string;
  messageBn: string;
  amountPoisha: string | null;
  documentCount: number | null;
}

export interface CloseRunDto {
  id: string;
  companyId: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  periodStatus: 'OPEN' | 'CLOSED' | 'LOCKED';
  status: CloseRunStatus;
  preparedBy: string;
  preparedByName: string;
  preparedAt: string;
  submittedBy: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  evidenceReference: string;
  evidenceNote: string | null;
  snapshotHash: string | null;
  reopenedBy: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  checks: CloseCheckDto[];
  exceptions: CloseExceptionDto[];
  createdAt: string;
  updatedAt: string;
  events: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorUserId: string | null;
    actorName: string | null;
    reason: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface CloseAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

interface CloseRunRow {
  id: string;
  company_id: string;
  period_id: string;
  status: string;
  prepared_by: string;
  prepared_by_name: string;
  prepared_at: Date;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  evidence_reference: string;
  evidence_note: string | null;
  checklist_json: CloseCheckDto[];
  exceptions_json: CloseExceptionDto[];
  snapshot_hash: string | null;
  reopened_by: string | null;
  reopened_by_name: string | null;
  reopened_at: Date | null;
  reopen_reason: string | null;
  created_at: Date;
  updated_at: Date;
  period_code: string;
  period_label: string;
  period_start: Date;
  period_end: Date;
  period_status: string;
}

const CLOSE_RUN_SELECT = `
  SELECT cr.id, cr.company_id, cr.period_id, cr.status, cr.prepared_by, pu.name AS prepared_by_name,
         cr.prepared_at, cr.submitted_by, su.name AS submitted_by_name, cr.submitted_at,
         cr.decided_by, du.name AS decided_by_name, cr.decided_at, cr.decision_reason,
         cr.evidence_reference, cr.evidence_note, cr.checklist_json, cr.exceptions_json,
         cr.snapshot_hash, cr.reopened_by, ru.name AS reopened_by_name, cr.reopened_at,
         cr.reopen_reason, cr.created_at, cr.updated_at,
         p.code AS period_code, p.label AS period_label, p.start_date AS period_start,
         p.end_date AS period_end, p.status AS period_status
    FROM close_runs cr
    JOIN periods p ON p.company_id = cr.company_id AND p.id = cr.period_id
    JOIN users pu ON pu.id = cr.prepared_by
    LEFT JOIN users su ON su.id = cr.submitted_by
    LEFT JOIN users du ON du.id = cr.decided_by
    LEFT JOIN users ru ON ru.id = cr.reopened_by
`;

function mapCheck(input: {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  applicable?: boolean;
  blocking?: boolean;
  difference?: bigint | null;
  detailEn: string;
  detailBn: string;
  evidence?: Record<string, unknown>;
}): CloseCheckDto {
  return {
    key: input.key,
    labelEn: input.labelEn,
    labelBn: input.labelBn,
    passed: input.passed,
    applicable: input.applicable ?? true,
    blocking: input.blocking ?? true,
    differencePoisha: input.difference === undefined || input.difference === null ? null : input.difference.toString(),
    detailEn: input.detailEn,
    detailBn: input.detailBn,
    evidence: input.evidence ?? {},
  };
}

function notApplicable(
  key: string,
  labelEn: string,
  labelBn: string,
  detailEn: string,
  detailBn: string,
  evidence: Record<string, unknown> = {},
): CloseCheckDto {
  return mapCheck({
    key,
    labelEn,
    labelBn,
    passed: true,
    applicable: false,
    blocking: true,
    difference: null,
    detailEn,
    detailBn,
    evidence,
  });
}

async function hasControlAccount(database: Queryable, companyId: string, control: string): Promise<boolean> {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM accounts
      WHERE company_id = $1 AND control_subledger = $2 AND is_active = true`,
    [companyId, control],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

function sumDifference(values: string[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

export async function buildCloseChecks(
  database: Queryable,
  companyId: string,
  period: { id: string; code: string; start_date: Date; end_date: Date },
): Promise<{ checks: CloseCheckDto[]; exceptions: CloseExceptionDto[] }> {
  const end = formatDatabaseDate(period.end_date);
  const checks: CloseCheckDto[] = [];
  const exceptions: CloseExceptionDto[] = [];

  const trialBalance = await getTrialBalanceReport(database, companyId, { periodId: period.id });
  const tbCheck = trialBalance.checks.find((check) => check.key === 'TRIAL_BALANCE_BALANCES');
  checks.push(
    mapCheck({
      key: 'TRIAL_BALANCE',
      labelEn: 'Trial balance debits equal credits',
      labelBn: 'রেওয়ামিলের ডেবিট ও ক্রেডিট সমান',
      passed: Boolean(tbCheck?.passed),
      difference: tbCheck?.differencePoisha ? BigInt(tbCheck.differencePoisha) : null,
      detailEn: tbCheck?.detailEn ?? 'The trial balance check did not return a result.',
      detailBn: tbCheck?.detailBn ?? 'রেওয়ামিল পরীক্ষা কোনো ফলাফল দেয়নি।',
      evidence: { lineCount: trialBalance.lineCount, balanced: trialBalance.trialBalance.balanced },
    }),
  );

  const balanceSheet = await getBalanceSheetReport(database, companyId, { periodId: period.id });
  const blockingBalanceChecks = balanceSheet.checks.filter(
    (check) => check.blocksExport && ['BALANCE_SHEET_BALANCES', 'LEDGER_BALANCES'].includes(check.key),
  );
  const balanceDifference = blockingBalanceChecks.reduce((total, check) => {
    return (
      total +
      (check.differencePoisha
        ? BigInt(check.differencePoisha) < 0n
          ? -BigInt(check.differencePoisha)
          : BigInt(check.differencePoisha)
        : 0n)
    );
  }, 0n);
  checks.push(
    mapCheck({
      key: 'BALANCE_SHEET',
      labelEn: 'Balance sheet balances and the ledger sums to zero',
      labelBn: 'ব্যালান্স শিট সুষম এবং খতিয়ানের যোগফল শূন্য',
      passed: blockingBalanceChecks.every((check) => check.passed),
      difference: balanceDifference,
      detailEn: blockingBalanceChecks.length
        ? blockingBalanceChecks.map((check) => check.detailEn).join(' ')
        : 'The balance-sheet checks did not return a result.',
      detailBn: blockingBalanceChecks.length
        ? blockingBalanceChecks.map((check) => check.detailBn).join(' ')
        : 'ব্যালান্স শিট পরীক্ষা কোনো ফলাফল দেয়নি।',
      evidence: {
        totalAssetsPoisha: balanceSheet.totals.totalAssetsPoisha,
        totalEquityAndLiabilitiesPoisha: balanceSheet.totals.totalEquityAndLiabilitiesPoisha,
      },
    }),
  );

  if (await hasControlAccount(database, companyId, 'AR')) {
    const ageing = await getArAgeing(database, companyId, end);
    checks.push(
      mapCheck({
        key: 'AR_CONTROL',
        labelEn: 'Receivables control agrees to the open-item subledger',
        labelBn: 'প্রাপ্য নিয়ন্ত্রণ খোলা আইটেম সাবলেজারের সাথে মেলে',
        passed: ageing.proof.agrees,
        difference: BigInt(ageing.proof.differencePoisha),
        detailEn: `GL ${formatPoishaAsBdt(ageing.proof.glBalancePoisha)} BDT; open items ${formatPoishaAsBdt(ageing.proof.subledgerPoisha)} BDT.`,
        detailBn: `জিএল ${formatPoishaAsBdt(ageing.proof.glBalancePoisha)} টাকা; খোলা আইটেম ${formatPoishaAsBdt(ageing.proof.subledgerPoisha)} টাকা।`,
        evidence: {
          controlAccount: ageing.proof.controlAccountCode,
          openItemCount: ageing.rows.length,
        },
      }),
    );
  } else {
    checks.push(
      notApplicable(
        'AR_CONTROL',
        'Receivables control agrees to the open-item subledger',
        'প্রাপ্য নিয়ন্ত্রণ খোলা আইটেম সাবলেজারের সাথে মেলে',
        'No active receivables control account is configured; the control is not applicable for this company.',
        'কোনো সক্রিয় প্রাপ্য নিয়ন্ত্রণ হিসাব কনফিগার করা নেই; এই কোম্পানির জন্য নিয়ন্ত্রণটি প্রযোজ্য নয়।',
      ),
    );
  }

  if (await hasControlAccount(database, companyId, 'AP')) {
    const ageing = await getApAgeing(database, companyId, end);
    checks.push(
      mapCheck({
        key: 'AP_CONTROL',
        labelEn: 'Payables control agrees to the open-item subledger',
        labelBn: 'প্রদেয় নিয়ন্ত্রণ খোলা আইটেম সাবলেজারের সাথে মেলে',
        passed: ageing.proof.agrees,
        difference: BigInt(ageing.proof.differencePoisha),
        detailEn: `GL ${formatPoishaAsBdt(ageing.proof.glBalancePoisha)} BDT; open items ${formatPoishaAsBdt(ageing.proof.subledgerPoisha)} BDT.`,
        detailBn: `জিএল ${formatPoishaAsBdt(ageing.proof.glBalancePoisha)} টাকা; খোলা আইটেম ${formatPoishaAsBdt(ageing.proof.subledgerPoisha)} টাকা।`,
        evidence: {
          controlAccount: ageing.proof.controlAccountCode,
          openItemCount: ageing.rows.length,
        },
      }),
    );
  } else {
    checks.push(
      notApplicable(
        'AP_CONTROL',
        'Payables control agrees to the open-item subledger',
        'প্রদেয় নিয়ন্ত্রণ খোলা আইটেম সাবলেজারের সাথে মেলে',
        'No active payables control account is configured; the control is not applicable for this company.',
        'কোনো সক্রিয় প্রদেয় নিয়ন্ত্রণ হিসাব কনফিগার করা নেই; এই কোম্পানির জন্য নিয়ন্ত্রণটি প্রযোজ্য নয়।',
      ),
    );
  }

  const bankAccounts = (await listBankAccounts(database, companyId)).filter((account) => account.status === 'ACTIVE');
  if (bankAccounts.length === 0) {
    checks.push(
      notApplicable(
        'BANK_RECONCILIATION',
        'Bank and MFS reconciliations are reviewed',
        'ব্যাংক ও এমএফএস মিলকরণ পর্যালোচিত',
        'No active bank, MFS or cash account is configured; bank reconciliation is not applicable.',
        'কোনো সক্রিয় ব্যাংক, এমএফএস বা নগদ হিসাব কনফিগার করা নেই; ব্যাংক মিলকরণ প্রযোজ্য নয়।',
      ),
    );
  } else {
    const evidence: Array<Record<string, unknown>> = [];
    const differences: string[] = [];
    let applicable = false;
    let passed = true;
    const detailsEn: string[] = [];
    const detailsBn: string[] = [];
    for (const account of bankAccounts) {
      const reconciliation = await getCurrentReconciliation(database, companyId, account.id, period.id);
      if (reconciliation.proof.statement.lineCount === 0) {
        evidence.push({ bankAccount: account.name, status: 'NOT_APPLICABLE', reason: 'No imported statement lines' });
        continue;
      }
      applicable = true;
      const reviewed = reconciliation.status === 'REVIEWED' || reconciliation.status === 'LOCKED';
      const clean = reconciliation.proof.blockers.length === 0 && BigInt(reconciliation.differencePoisha) === 0n;
      if (!reviewed || !clean) passed = false;
      differences.push(reconciliation.differencePoisha);
      evidence.push({
        bankAccount: account.name,
        reconciliationId: reconciliation.id,
        status: reconciliation.status,
        differencePoisha: reconciliation.differencePoisha,
        blockers: reconciliation.proof.blockers.map((blocker) => blocker.code),
      });
      detailsEn.push(
        `${account.name}: ${reconciliation.status}, difference ${reconciliation.differencePoisha} poisha, ${reconciliation.proof.statement.lineCount} statement line(s).`,
      );
      detailsBn.push(
        `${account.name}: ${reconciliation.status}, পার্থক্য ${reconciliation.differencePoisha} পয়সা, ${reconciliation.proof.statement.lineCount}টি বিবরণী লাইন।`,
      );
    }
    if (!applicable) {
      checks.push(
        notApplicable(
          'BANK_RECONCILIATION',
          'Bank and MFS reconciliations are reviewed',
          'ব্যাংক ও এমএফএস মিলকরণ পর্যালোচিত',
          'No imported bank or MFS statement line exists for this period; reconciliation evidence is not available and the control is not applicable.',
          'এই সময়কালে কোনো আমদানি করা ব্যাংক বা এমএফএস বিবরণী লাইন নেই; মিলকরণ প্রমাণ নেই এবং নিয়ন্ত্রণটি প্রযোজ্য নয়।',
          { accounts: evidence },
        ),
      );
    } else {
      checks.push(
        mapCheck({
          key: 'BANK_RECONCILIATION',
          labelEn: 'Bank and MFS reconciliations are reviewed',
          labelBn: 'ব্যাংক ও এমএফএস মিলকরণ পর্যালোচিত',
          passed,
          difference: sumDifference(differences),
          detailEn: detailsEn.join(' '),
          detailBn: detailsBn.join(' '),
          evidence: { accounts: evidence },
        }),
      );
    }
  }

  const vat = await getVatReturnDraft(database, companyId, { periodId: period.id });
  const outputActivity = BigInt(vat.totals.outputVatPoisha) !== 0n;
  const inputActivity =
    BigInt(vat.totals.inputVatClaimablePoisha) !== 0n || BigInt(vat.totals.inputVatDisallowedPoisha) !== 0n;
  const vatActivity = outputActivity || inputActivity || BigInt(vat.totals.creditNoteVatPoisha) !== 0n;
  if (!vatActivity) {
    checks.push(
      notApplicable(
        'VAT_GL_PROOF',
        'VAT registers agree to the control accounts',
        'ভ্যাট রেজিস্টার নিয়ন্ত্রণ হিসাবের সাথে মেলে',
        'No VAT-bearing sales or purchase activity exists in this period; the VAT control is not applicable.',
        'এই সময়কালে ভ্যাটযুক্ত বিক্রয় বা ক্রয় কার্যক্রম নেই; ভ্যাট নিয়ন্ত্রণ প্রযোজ্য নয়।',
        { mappingSource: vat.glProof.mappingSource },
      ),
    );
  } else {
    const relevantChecks = vat.checks.filter((check) =>
      outputActivity ? check.key === 'VAT_OUTPUT_GL_PROOF' : check.key === 'VAT_INPUT_GL_PROOF',
    );
    const checked = relevantChecks.length
      ? relevantChecks
      : vat.checks.filter((check) => check.key === 'VAT_OUTPUT_GL_PROOF' || check.key === 'VAT_INPUT_GL_PROOF');
    const difference = checked.reduce((total, check) => {
      return total + (check.differencePoisha ? BigInt(check.differencePoisha) : 0n);
    }, 0n);
    checks.push(
      mapCheck({
        key: 'VAT_GL_PROOF',
        labelEn: 'VAT registers agree to the control accounts',
        labelBn: 'ভ্যাট রেজিস্টার নিয়ন্ত্রণ হিসাবের সাথে মেলে',
        passed: checked.every((check) => check.passed),
        difference,
        detailEn: checked.map((check) => check.detailEn).join(' '),
        detailBn: checked.map((check) => check.detailBn).join(' '),
        evidence: {
          mappingSource: vat.glProof.mappingSource,
          outputActivity,
          inputActivity,
          zeroVariance: vat.zeroVariance,
        },
      }),
    );
    for (const exception of vat.exceptions) {
      exceptions.push({
        code: exception.code,
        severity: exception.severity === 'BLOCKER' ? 'BLOCKER' : 'WARNING',
        messageEn: exception.messageEn,
        messageBn: exception.messageBn,
        amountPoisha: exception.amountPoisha,
        documentCount: exception.documentCount,
      });
    }
  }

  const suspenseAccounts = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM accounts
      WHERE company_id = $1 AND control_subledger = 'SUSPENSE' AND is_active = true`,
    [companyId],
  );
  if (Number(suspenseAccounts.rows[0]?.count ?? 0) === 0) {
    checks.push(
      notApplicable(
        'SUSPENSE',
        'Suspense account has no unresolved items',
        'সাসপেন্স হিসাবে অমীমাংসিত আইটেম নেই',
        'No active suspense control account is configured; the suspense control is not applicable.',
        'কোনো সক্রিয় সাসপেন্স নিয়ন্ত্রণ হিসাব কনফিগার করা নেই; সাসপেন্স নিয়ন্ত্রণ প্রযোজ্য নয়।',
      ),
    );
  } else {
    const items: SuspenseItemDto[] = await listOpenSuspenseItems(database, companyId);
    const amount = items.reduce((total, item) => total + BigInt(item.amountPoisha), 0n);
    checks.push(
      mapCheck({
        key: 'SUSPENSE',
        labelEn: 'Suspense account has no unresolved items',
        labelBn: 'সাসপেন্স হিসাবে অমীমাংসিত আইটেম নেই',
        passed: items.length === 0,
        difference: amount,
        detailEn:
          items.length === 0
            ? 'No open suspense item remains.'
            : `${items.length} suspense item(s) remain open; oldest age ${Math.max(...items.map((item) => item.ageDays))} day(s).`,
        detailBn:
          items.length === 0
            ? 'কোনো খোলা সাসপেন্স আইটেম নেই।'
            : `${items.length}টি সাসপেন্স আইটেম খোলা আছে; সর্বোচ্চ বয়স ${Math.max(...items.map((item) => item.ageDays))} দিন।`,
        evidence: {
          itemCount: items.length,
          items: items.slice(0, 50).map((item) => ({
            lineId: item.lineId,
            journalNumber: item.journalNumber,
            amountPoisha: item.amountPoisha,
            ageDays: item.ageDays,
          })),
        },
      }),
    );
  }

  for (const check of checks) {
    if (!check.applicable || check.passed) continue;
    exceptions.push({
      code: `CLOSE_${check.key}`,
      severity: 'BLOCKER',
      messageEn: check.detailEn,
      messageBn: check.detailBn,
      amountPoisha: check.differencePoisha,
      documentCount: null,
    });
  }

  return { checks, exceptions };
}

function snapshotHash(checks: CloseCheckDto[], exceptionList: CloseExceptionDto[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ checks, exceptions: exceptionList }))
    .digest('hex');
}

async function loadCloseRun(database: Queryable, companyId: string, runId: string): Promise<CloseRunDto> {
  const result = await database.query<CloseRunRow>(`${CLOSE_RUN_SELECT} WHERE cr.company_id = $1 AND cr.id = $2`, [
    companyId,
    runId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'CLOSE_RUN_NOT_FOUND', 'Close run not found.');
  const events = await database.query<{
    id: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    actor_user_id: string | null;
    actor_name: string | null;
    reason: string | null;
    metadata_json: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.from_status, e.to_status, e.actor_user_id, u.name AS actor_name,
            e.reason, e.metadata_json, e.created_at
       FROM close_run_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.company_id = $1 AND e.run_id = $2
      ORDER BY e.created_at ASC`,
    [companyId, runId],
  );
  return {
    id: row.id,
    companyId: row.company_id,
    periodId: row.period_id,
    periodCode: row.period_code,
    periodLabel: row.period_label,
    periodStart: formatDatabaseDate(row.period_start),
    periodEnd: formatDatabaseDate(row.period_end),
    periodStatus: row.period_status as CloseRunDto['periodStatus'],
    status: row.status as CloseRunStatus,
    preparedBy: row.prepared_by,
    preparedByName: row.prepared_by_name,
    preparedAt: row.prepared_at.toISOString(),
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionReason: row.decision_reason,
    evidenceReference: row.evidence_reference,
    evidenceNote: row.evidence_note,
    snapshotHash: row.snapshot_hash,
    reopenedBy: row.reopened_by,
    reopenedByName: row.reopened_by_name,
    reopenedAt: row.reopened_at?.toISOString() ?? null,
    reopenReason: row.reopen_reason,
    checks: row.checklist_json ?? [],
    exceptions: row.exceptions_json ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    events: events.rows.map((event) => ({
      id: event.id,
      action: event.action,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      actorUserId: event.actor_user_id,
      actorName: event.actor_name,
      reason: event.reason,
      metadata: event.metadata_json ?? {},
      createdAt: event.created_at.toISOString(),
    })),
  };
}

async function writeCloseRunEvent(
  client: PoolClient,
  input: {
    companyId: string;
    runId: string;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string;
    reason: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO close_run_events (company_id, run_id, action, from_status, to_status, actor_user_id, reason, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      input.companyId,
      input.runId,
      input.action,
      input.fromStatus,
      input.toStatus,
      input.actorUserId,
      input.reason,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function loadPeriodForUpdate(
  client: PoolClient,
  companyId: string,
  periodId: string,
): Promise<{ id: string; code: string; label: string; start_date: Date; end_date: Date; status: string }> {
  const result = await client.query<{
    id: string;
    code: string;
    label: string;
    start_date: Date;
    end_date: Date;
    status: string;
  }>(
    `SELECT id, code, label, start_date, end_date, status
       FROM periods WHERE company_id = $1 AND id = $2 FOR UPDATE`,
    [companyId, periodId],
  );
  const period = result.rows[0];
  if (!period) throw new AppError(404, 'PERIOD_NOT_FOUND', 'Accounting period not found.');
  return period;
}

export async function listCloseRuns(
  database: Queryable,
  companyId: string,
  periodId?: string | null,
): Promise<CloseRunDto[]> {
  const values: unknown[] = [companyId];
  const filter = periodId ? 'AND cr.period_id = $2' : '';
  if (periodId) values.push(periodId);
  const rows = await database.query<{ id: string }>(
    `SELECT cr.id FROM close_runs cr WHERE cr.company_id = $1 ${filter} ORDER BY cr.created_at DESC LIMIT 100`,
    values,
  );
  const result: CloseRunDto[] = [];
  for (const row of rows.rows) result.push(await loadCloseRun(database, companyId, row.id));
  return result;
}

export async function getCloseRun(database: Queryable, companyId: string, runId: string): Promise<CloseRunDto> {
  return loadCloseRun(database, companyId, runId);
}

export async function createCloseRun(
  pool: Pool,
  input: CloseAuditContext & { companyId: string; periodId: string },
): Promise<CloseRunDto> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `close-run:${input.companyId}:${input.periodId}`,
    ]);
    const period = await loadPeriodForUpdate(client, input.companyId, input.periodId);
    if (period.status === 'LOCKED') {
      throw new AppError(
        409,
        'PERIOD_ALREADY_LOCKED',
        'This period is locked. Reopen it before preparing a new close.',
      );
    }
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM close_runs
        WHERE company_id = $1 AND period_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
        LIMIT 1`,
      [input.companyId, input.periodId],
    );
    if (existing.rows[0]) {
      throw new AppError(
        409,
        'CLOSE_RUN_EXISTS',
        `A ${existing.rows[0].status} close run already exists for this period.`,
        { closeRunId: existing.rows[0].id, status: existing.rows[0].status },
      );
    }
    const { checks, exceptions } = await buildCloseChecks(client, input.companyId, period);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO close_runs (
         company_id, period_id, status, prepared_by, checklist_json, exceptions_json, snapshot_hash
       ) VALUES ($1,$2,'DRAFT',$3,$4::jsonb,$5::jsonb,$6)
       RETURNING id`,
      [
        input.companyId,
        input.periodId,
        input.actorUserId,
        JSON.stringify(checks),
        JSON.stringify(exceptions),
        snapshotHash(checks, exceptions),
      ],
    );
    const runId = inserted.rows[0]?.id;
    if (!runId) throw new AppError(500, 'CLOSE_RUN_CREATE_FAILED', 'The close run could not be created.');
    await writeCloseRunEvent(client, {
      companyId: input.companyId,
      runId,
      action: 'close.created',
      fromStatus: null,
      toStatus: 'DRAFT',
      actorUserId: input.actorUserId,
      reason: 'Close run prepared from the current control checks.',
      metadata: {
        failedChecks: checks.filter((check) => check.applicable && !check.passed).map((check) => check.key),
      },
    });
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'close.run_created',
      entityType: 'close_run',
      entityId: runId,
      after: {
        periodId: period.id,
        periodCode: period.code,
        checks: checks.map((check) => ({
          key: check.key,
          passed: check.passed,
          applicable: check.applicable,
        })),
      },
      reason: 'Close run prepared.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadCloseRun(client, input.companyId, runId);
  });
}

export async function refreshCloseRun(
  pool: Pool,
  input: CloseAuditContext & { companyId: string; runId: string },
): Promise<CloseRunDto> {
  return withTransaction(pool, async (client) => {
    const run = await client.query<{ status: string; period_id: string; prepared_by: string }>(
      `SELECT status, period_id, prepared_by FROM close_runs
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    const row = run.rows[0];
    if (!row) throw new AppError(404, 'CLOSE_RUN_NOT_FOUND', 'Close run not found.');
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'CLOSE_RUN_NOT_DRAFT', 'Only a draft close run can be refreshed.');
    }
    const period = await loadPeriodForUpdate(client, input.companyId, row.period_id);
    if (period.status === 'LOCKED') {
      throw new AppError(409, 'PERIOD_ALREADY_LOCKED', 'This period is locked and cannot be refreshed.');
    }
    const { checks, exceptions } = await buildCloseChecks(client, input.companyId, period);
    await client.query(
      `UPDATE close_runs
          SET checklist_json = $3::jsonb, exceptions_json = $4::jsonb, snapshot_hash = $5, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.runId,
        JSON.stringify(checks),
        JSON.stringify(exceptions),
        snapshotHash(checks, exceptions),
      ],
    );
    await writeCloseRunEvent(client, {
      companyId: input.companyId,
      runId: input.runId,
      action: 'close.refreshed',
      fromStatus: 'DRAFT',
      toStatus: 'DRAFT',
      actorUserId: input.actorUserId,
      reason: 'Control checks recalculated.',
      metadata: {
        failedChecks: checks.filter((check) => check.applicable && !check.passed).map((check) => check.key),
      },
    });
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'close.run_refreshed',
      entityType: 'close_run',
      entityId: input.runId,
      after: {
        checks: checks.map((check) => ({
          key: check.key,
          passed: check.passed,
          applicable: check.applicable,
        })),
      },
      reason: 'Close control checks recalculated.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadCloseRun(client, input.companyId, input.runId);
  });
}

export async function submitCloseRun(
  pool: Pool,
  input: CloseAuditContext & {
    companyId: string;
    runId: string;
    evidenceReference: string;
    evidenceNote?: string | null;
  },
): Promise<CloseRunDto> {
  const evidence = input.evidenceReference.trim();
  if (evidence.length < 3 || evidence.length > 500) {
    throw new AppError(
      400,
      'CLOSE_EVIDENCE_REQUIRED',
      'An evidence reference between 3 and 500 characters is required.',
    );
  }
  const evidenceNote = input.evidenceNote?.trim() || null;
  if (evidenceNote && evidenceNote.length > 2000) {
    throw new AppError(400, 'CLOSE_NOTE_TOO_LONG', 'The close note must be at most 2,000 characters.');
  }
  return withTransaction(pool, async (client) => {
    const run = await client.query<{ status: string; period_id: string; prepared_by: string }>(
      `SELECT status, period_id, prepared_by FROM close_runs
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    const row = run.rows[0];
    if (!row) throw new AppError(404, 'CLOSE_RUN_NOT_FOUND', 'Close run not found.');
    if (row.status !== 'DRAFT') {
      throw new AppError(409, 'CLOSE_RUN_NOT_DRAFT', 'Only a draft close run can be submitted.');
    }
    const period = await loadPeriodForUpdate(client, input.companyId, row.period_id);
    if (period.status === 'LOCKED') {
      throw new AppError(409, 'PERIOD_ALREADY_LOCKED', 'This period is already locked.');
    }
    const { checks, exceptions } = await buildCloseChecks(client, input.companyId, period);
    const failed = checks.filter((check) => check.blocking && check.applicable && !check.passed);
    if (failed.length > 0) {
      throw new AppError(409, 'CLOSE_CHECKS_FAILED', 'The close cannot be submitted while a blocking control fails.', {
        failedChecks: failed.map((check) => ({
          key: check.key,
          detailEn: check.detailEn,
          differencePoisha: check.differencePoisha,
        })),
      });
    }
    await client.query(
      `UPDATE close_runs
          SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now(),
              evidence_reference = $4, evidence_note = $5,
              checklist_json = $6::jsonb, exceptions_json = $7::jsonb, snapshot_hash = $8, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.runId,
        input.actorUserId,
        evidence,
        evidenceNote,
        JSON.stringify(checks),
        JSON.stringify(exceptions),
        snapshotHash(checks, exceptions),
      ],
    );
    await writeCloseRunEvent(client, {
      companyId: input.companyId,
      runId: input.runId,
      action: 'close.submitted',
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
      actorUserId: input.actorUserId,
      reason: 'Close submitted for checker approval.',
      metadata: { evidenceReference: evidence },
    });
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'close.run_submitted',
      entityType: 'close_run',
      entityId: input.runId,
      before: { status: 'DRAFT' },
      after: { status: 'SUBMITTED', evidenceReference: evidence },
      reason: 'Close submitted for checker approval.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadCloseRun(client, input.companyId, input.runId);
  });
}

export async function decideCloseRun(
  pool: Pool,
  input: CloseAuditContext & {
    companyId: string;
    runId: string;
    decision: 'APPROVE' | 'REJECT';
    reason: string;
  },
): Promise<CloseRunDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'CLOSE_DECISION_REASON_REQUIRED',
      'A decision reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const run = await client.query<{
      status: string;
      period_id: string;
      prepared_by: string;
      submitted_by: string | null;
    }>(
      `SELECT status, period_id, prepared_by, submitted_by FROM close_runs
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    const row = run.rows[0];
    if (!row) throw new AppError(404, 'CLOSE_RUN_NOT_FOUND', 'Close run not found.');
    if (row.status !== 'SUBMITTED') {
      throw new AppError(409, 'CLOSE_RUN_NOT_SUBMITTED', 'Only a submitted close run can be decided.');
    }
    if (input.actorUserId === row.prepared_by || input.actorUserId === row.submitted_by) {
      throw new AppError(
        403,
        'CLOSE_SELF_APPROVAL',
        'The close maker cannot approve the same close run. A different authorised checker is required.',
      );
    }
    const period = await loadPeriodForUpdate(client, input.companyId, row.period_id);
    if (input.decision === 'REJECT') {
      await client.query(
        `UPDATE close_runs
            SET status = 'REJECTED', decided_by = $3, decided_at = now(), decision_reason = $4, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.runId, input.actorUserId, reason],
      );
      await writeCloseRunEvent(client, {
        companyId: input.companyId,
        runId: input.runId,
        action: 'close.rejected',
        fromStatus: 'SUBMITTED',
        toStatus: 'REJECTED',
        actorUserId: input.actorUserId,
        reason,
      });
      await writeAuditEvent(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: 'close.run_rejected',
        entityType: 'close_run',
        entityId: input.runId,
        before: { status: 'SUBMITTED' },
        after: { status: 'REJECTED', periodStatus: period.status },
        reason,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });
      return loadCloseRun(client, input.companyId, input.runId);
    }

    if (period.status === 'LOCKED') {
      throw new AppError(409, 'PERIOD_ALREADY_LOCKED', 'This period is already locked.');
    }
    const { checks, exceptions } = await buildCloseChecks(client, input.companyId, period);
    const failed = checks.filter((check) => check.blocking && check.applicable && !check.passed);
    if (failed.length > 0) {
      throw new AppError(409, 'CLOSE_CHECKS_FAILED', 'The close cannot be approved while a blocking control fails.', {
        failedChecks: failed.map((check) => ({
          key: check.key,
          detailEn: check.detailEn,
          differencePoisha: check.differencePoisha,
        })),
      });
    }
    await client.query(
      `UPDATE close_runs
          SET status = 'APPROVED', decided_by = $3, decided_at = now(), decision_reason = $4,
              checklist_json = $5::jsonb, exceptions_json = $6::jsonb, snapshot_hash = $7, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        input.companyId,
        input.runId,
        input.actorUserId,
        reason,
        JSON.stringify(checks),
        JSON.stringify(exceptions),
        snapshotHash(checks, exceptions),
      ],
    );
    await client.query(
      `UPDATE periods
          SET status = 'LOCKED', closed_at = COALESCE(closed_at, now()),
              closed_by = COALESCE(closed_by, $3), locked_at = now(), locked_by = $3,
              reopened_reason = NULL, reopened_by = NULL, reopened_at = NULL, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.period_id, input.actorUserId],
    );
    await writeCloseRunEvent(client, {
      companyId: input.companyId,
      runId: input.runId,
      action: 'close.approved',
      fromStatus: 'SUBMITTED',
      toStatus: 'APPROVED',
      actorUserId: input.actorUserId,
      reason,
      metadata: { periodStatusAfter: 'LOCKED' },
    });
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'close.run_approved',
      entityType: 'close_run',
      entityId: input.runId,
      before: { status: 'SUBMITTED', periodStatus: period.status },
      after: { status: 'APPROVED', periodStatus: 'LOCKED', periodId: period.id, periodCode: period.code },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'period.locked',
      entityType: 'period',
      entityId: period.id,
      before: { status: period.status },
      after: { status: 'LOCKED', closeRunId: input.runId },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return loadCloseRun(client, input.companyId, input.runId);
  });
}

export async function reopenPeriod(
  pool: Pool,
  input: CloseAuditContext & { companyId: string; periodId: string; reason: string },
): Promise<{ periodId: string; status: 'OPEN' }> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PERIOD_REOPEN_REASON_REQUIRED',
      'A reopen reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const period = await loadPeriodForUpdate(client, input.companyId, input.periodId);
    if (period.status !== 'CLOSED' && period.status !== 'LOCKED') {
      throw new AppError(409, 'PERIOD_NOT_CLOSED', 'Only a CLOSED or LOCKED period can be reopened.');
    }
    const run = await client.query<{ id: string }>(
      `SELECT id FROM close_runs
        WHERE company_id = $1 AND period_id = $2 AND status = 'APPROVED'
        ORDER BY decided_at DESC NULLS LAST, created_at DESC LIMIT 1
        FOR UPDATE`,
      [input.companyId, input.periodId],
    );
    if (run.rows[0]) {
      await client.query(
        `UPDATE close_runs
            SET status = 'REOPENED', reopened_by = $3, reopened_at = now(), reopen_reason = $4, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, run.rows[0].id, input.actorUserId, reason],
      );
      await writeCloseRunEvent(client, {
        companyId: input.companyId,
        runId: run.rows[0].id,
        action: 'close.reopened',
        fromStatus: 'APPROVED',
        toStatus: 'REOPENED',
        actorUserId: input.actorUserId,
        reason,
      });
    }
    await client.query(
      `UPDATE periods
          SET status = 'OPEN', closed_at = NULL, closed_by = NULL, locked_at = NULL, locked_by = NULL,
              reopened_reason = $3, reopened_by = $4, reopened_at = now(), updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.periodId, reason, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'period.reopened',
      entityType: 'period',
      entityId: input.periodId,
      before: { status: period.status, closeRunId: run.rows[0]?.id ?? null },
      after: { status: 'OPEN' },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return { periodId: input.periodId, status: 'OPEN' };
  });
}

export async function exportClosePackCsv(
  database: Queryable,
  companyId: string,
  runId: string,
  audit: CloseAuditContext,
): Promise<{ csv: string; filename: string }> {
  const run = await loadCloseRun(database, companyId, runId);
  const lines: string[] = [];
  const row = (...cells: Array<string | null | undefined>) => cells.map((cell) => escapeCsvCell(cell ?? '')).join(',');
  lines.push(row('Close pack', ''));
  lines.push(row('Company ID', companyId));
  lines.push(row('Period', run.periodCode, run.periodLabel, run.periodStart, run.periodEnd));
  lines.push(row('Period status', run.periodStatus));
  lines.push(row('Close status', run.status));
  lines.push(row('Prepared by', run.preparedByName, run.preparedAt));
  lines.push(row('Submitted by', run.submittedByName, run.submittedAt));
  lines.push(row('Decided by', run.decidedByName, run.decidedAt));
  lines.push(row('Decision reason', run.decisionReason));
  lines.push(row('Evidence reference', run.evidenceReference));
  lines.push(row('Evidence note', run.evidenceNote));
  lines.push(row('Snapshot hash', run.snapshotHash));
  lines.push('');
  lines.push(row('Checklist', 'Result', 'Applicable', 'Difference poisha', 'Detail'));
  for (const check of run.checks) {
    lines.push(
      row(
        check.labelEn,
        check.passed ? 'PASS' : 'FAIL',
        check.applicable ? 'YES' : 'NO',
        check.differencePoisha,
        check.detailEn,
      ),
    );
  }
  lines.push('');
  lines.push(row('Exceptions', 'Severity', 'Amount poisha', 'Detail'));
  for (const exception of run.exceptions) {
    lines.push(row(exception.code, exception.severity, exception.amountPoisha, exception.messageEn));
  }
  lines.push('');
  lines.push(row('Run history', 'From', 'To', 'Actor', 'At', 'Reason'));
  for (const event of run.events) {
    lines.push(row(event.action, event.fromStatus, event.toStatus, event.actorName, event.createdAt, event.reason));
  }
  await writeAuditEvent(database, {
    organisationId: audit.organisationId,
    companyId,
    actorUserId: audit.actorUserId,
    sessionId: audit.sessionId,
    action: 'close.pack_exported',
    entityType: 'close_run',
    entityId: runId,
    after: { periodCode: run.periodCode, status: run.status, snapshotHash: run.snapshotHash },
    reason: 'Close pack exported as audit evidence.',
    ip: audit.ip,
    userAgent: audit.userAgent,
    requestId: audit.requestId,
  });
  return {
    csv: `\uFEFF${lines.join('\r\n')}\r\n`,
    filename: `close-pack-${run.periodCode}-${run.id.slice(0, 8)}.csv`,
  };
}
