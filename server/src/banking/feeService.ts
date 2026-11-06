import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { postSystemJournalWithinTransaction } from '../ledger/ledgerService.ts';
import {
  assertLineEditable,
  calculateFeePoisha,
  loadBankAccount,
  loadBankStatementLine,
  type BankingAuditContext,
  type Queryable,
} from './common.ts';

export interface BankFeeRuleDto {
  id: string;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  provider: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  rateBps: number;
  fixedPoisha: string;
  fixedBdt: string;
  feeAccountId: string;
  feeAccountCode: string;
  feeAccountName: string;
  policyReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

interface BankFeeRuleRow {
  id: string;
  company_id: string;
  bank_account_id: string;
  bank_account_name: string;
  provider: string | null;
  status: string;
  rate_bps: number;
  fixed_poisha: string;
  fee_account_id: string;
  fee_account_code: string;
  fee_account_name: string;
  policy_reference: string;
  effective_from: Date;
  effective_to: Date | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
}

const FEE_RULE_SELECT = `
  SELECT r.id, r.company_id, r.bank_account_id, ba.name AS bank_account_name, ba.provider,
         r.status, r.rate_bps, r.fixed_poisha::text AS fixed_poisha, r.fee_account_id,
         a.code AS fee_account_code, a.name_en AS fee_account_name, r.policy_reference,
         r.effective_from, r.effective_to, r.created_by, u.name AS created_by_name,
         r.created_at, r.updated_at
    FROM bank_fee_rules r
    JOIN bank_accounts ba ON ba.company_id = r.company_id AND ba.id = r.bank_account_id
    JOIN accounts a ON a.company_id = r.company_id AND a.id = r.fee_account_id
    JOIN users u ON u.id = r.created_by
`;

function mapFeeRule(row: BankFeeRuleRow): BankFeeRuleDto {
  return {
    id: row.id,
    companyId: row.company_id,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    provider: row.provider,
    status: row.status as 'ACTIVE' | 'INACTIVE',
    rateBps: row.rate_bps,
    fixedPoisha: row.fixed_poisha,
    fixedBdt: formatPoishaAsBdt(row.fixed_poisha),
    feeAccountId: row.fee_account_id,
    feeAccountCode: row.fee_account_code,
    feeAccountName: row.fee_account_name,
    policyReference: row.policy_reference,
    effectiveFrom: formatDatabaseDate(row.effective_from),
    effectiveTo: row.effective_to ? formatDatabaseDate(row.effective_to) : null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBankFeeRules(
  database: Queryable,
  companyId: string,
  options: { bankAccountId?: string; includeInactive?: boolean } = {},
): Promise<BankFeeRuleDto[]> {
  const values: unknown[] = [companyId];
  const where = ['r.company_id = $1'];
  if (options.bankAccountId) {
    values.push(options.bankAccountId);
    where.push(`r.bank_account_id = $${values.length}`);
  }
  if (!options.includeInactive) {
    where.push(`r.status = 'ACTIVE'`);
  }
  const result = await database.query<BankFeeRuleRow>(
    `${FEE_RULE_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY r.bank_account_id, r.effective_from DESC, r.created_at DESC`,
    values,
  );
  return result.rows.map(mapFeeRule);
}

export async function createBankFeeRule(
  pool: Pool,
  input: BankingAuditContext & {
    bankAccountId: string;
    rateBps: number;
    fixedPoisha: string;
    feeAccountId: string;
    policyReference: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  },
): Promise<BankFeeRuleDto> {
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000) {
    throw new AppError(400, 'BANK_FEE_RATE_INVALID', 'The fee rate must be between 0 and 100.00%.');
  }
  const fixedPoisha = parseBdtToPoisha(input.fixedPoisha);
  if (fixedPoisha === null || fixedPoisha < 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'The fixed fee must be a non-negative BDT amount with up to 2 decimals.');
  }
  if (input.rateBps === 0 && fixedPoisha === 0n) {
    throw new AppError(400, 'BANK_FEE_RULE_ZERO', 'A fee rule must have a percentage rate, a fixed fee, or both.');
  }
  if (!isValidIsoDate(input.effectiveFrom)) {
    throw new AppError(400, 'INVALID_DATE', 'The effective-from date must be a real YYYY-MM-DD date.');
  }
  if (input.effectiveTo && !isValidIsoDate(input.effectiveTo)) {
    throw new AppError(400, 'INVALID_DATE', 'The effective-to date must be a real YYYY-MM-DD date.');
  }
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw new AppError(
      400,
      'BANK_FEE_RULE_DATE_RANGE',
      'The effective-to date must not precede the effective-from date.',
    );
  }
  const policyReference = input.policyReference.trim();
  if (policyReference.length < 3 || policyReference.length > 500) {
    throw new AppError(
      400,
      'BANK_FEE_POLICY_REFERENCE_REQUIRED',
      'Record the provider contract, tariff or approval reference for this fee rule (3–500 characters).',
    );
  }

  return withTransaction(pool, async (client) => {
    const bank = await loadBankAccount(client, input.companyId, input.bankAccountId);
    const feeAccount = await client.query<{
      id: string;
      code: string;
      name_en: string;
      account_type: string;
      is_active: boolean;
    }>(
      `SELECT id, code, name_en, account_type, is_active
         FROM accounts WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.feeAccountId],
    );
    const account = feeAccount.rows[0];
    if (!account) {
      throw new AppError(400, 'BANK_FEE_ACCOUNT_INVALID', 'The fee expense account does not exist in this company.');
    }
    if (!account.is_active) {
      throw new AppError(400, 'BANK_FEE_ACCOUNT_INACTIVE', 'The fee expense account is inactive.');
    }
    if (account.account_type !== 'EXPENSE') {
      throw new AppError(400, 'BANK_FEE_ACCOUNT_INVALID', 'The fee account must be an EXPENSE account.');
    }
    if (account.id === bank.gl_account_id) {
      throw new AppError(400, 'BANK_FEE_ACCOUNT_INVALID', 'The fee account cannot be the bank account itself.');
    }
    const overlap = await client.query(
      `SELECT 1 FROM bank_fee_rules
        WHERE company_id = $1 AND bank_account_id = $2 AND status = 'ACTIVE'
          AND effective_from <= COALESCE($4::date, 'infinity'::date)
          AND COALESCE(effective_to, 'infinity'::date) >= $3::date
        LIMIT 1`,
      [input.companyId, input.bankAccountId, input.effectiveFrom, input.effectiveTo ?? null],
    );
    if (overlap.rowCount && overlap.rowCount > 0) {
      throw new AppError(
        409,
        'BANK_FEE_RULE_OVERLAP',
        'An active fee rule already covers part of this date range. Deactivate it or choose a non-overlapping period.',
      );
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bank_fee_rules (
         company_id, bank_account_id, status, rate_bps, fixed_poisha, fee_account_id,
         policy_reference, effective_from, effective_to, created_by, updated_by
       ) VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING id`,
      [
        input.companyId,
        input.bankAccountId,
        input.rateBps,
        fixedPoisha.toString(),
        input.feeAccountId,
        policyReference,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.actorUserId,
      ],
    );
    const ruleId = inserted.rows[0]!.id;
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_fee_rule.created',
      entityType: 'bank_fee_rule',
      entityId: ruleId,
      after: {
        bankAccountId: input.bankAccountId,
        rateBps: input.rateBps,
        fixedPoisha: fixedPoisha.toString(),
        feeAccountId: input.feeAccountId,
        policyReference,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        status: 'ACTIVE',
      },
      reason: policyReference,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const result = await client.query<BankFeeRuleRow>(`${FEE_RULE_SELECT} WHERE r.company_id = $1 AND r.id = $2`, [
      input.companyId,
      ruleId,
    ]);
    return mapFeeRule(result.rows[0]!);
  });
}

export async function setBankFeeRuleStatus(
  pool: Pool,
  input: BankingAuditContext & { ruleId: string; status: 'ACTIVE' | 'INACTIVE' },
): Promise<BankFeeRuleDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BankFeeRuleRow>(
      `${FEE_RULE_SELECT} WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE OF r`,
      [input.companyId, input.ruleId],
    );
    const row = existing.rows[0];
    if (!row) throw new AppError(404, 'BANK_FEE_RULE_NOT_FOUND', 'Fee rule not found.');
    if (row.status === input.status) return mapFeeRule(row);
    if (input.status === 'ACTIVE') {
      const overlap = await client.query(
        `SELECT 1 FROM bank_fee_rules
          WHERE company_id = $1 AND bank_account_id = $2 AND status = 'ACTIVE' AND id <> $3
            AND effective_from <= COALESCE($5::date, 'infinity'::date)
            AND COALESCE(effective_to, 'infinity'::date) >= $4::date
          LIMIT 1`,
        [
          input.companyId,
          row.bank_account_id,
          row.id,
          formatDatabaseDate(row.effective_from),
          row.effective_to ? formatDatabaseDate(row.effective_to) : null,
        ],
      );
      if (overlap.rowCount && overlap.rowCount > 0) {
        throw new AppError(
          409,
          'BANK_FEE_RULE_OVERLAP',
          'Another active fee rule already covers this period. Deactivate it first.',
        );
      }
    }
    await client.query(
      `UPDATE bank_fee_rules SET status = $3, updated_by = $4
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, row.id, input.status, input.actorUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_fee_rule.status_changed',
      entityType: 'bank_fee_rule',
      entityId: row.id,
      before: { status: row.status },
      after: { status: input.status },
      reason: input.status === 'INACTIVE' ? 'Fee rule deactivated.' : 'Fee rule reactivated after overlap check.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const result = await client.query<BankFeeRuleRow>(`${FEE_RULE_SELECT} WHERE r.company_id = $1 AND r.id = $2`, [
      input.companyId,
      row.id,
    ]);
    return mapFeeRule(result.rows[0]!);
  });
}

export interface BankFeePostingDto {
  id: string;
  companyId: string;
  bankAccountId: string;
  statementLineId: string;
  feeRuleId: string | null;
  feeAccountId: string;
  feeAccountCode: string;
  feeAccountName: string;
  computedPoisha: string | null;
  computedBdt: string | null;
  amountPoisha: string;
  amountBdt: string;
  overrideReason: string | null;
  evidenceReference: string | null;
  journalId: string;
  journalNumber: string | null;
  status: 'POSTED' | 'REVERSED';
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  postedBy: string;
  postedByName: string;
  postedAt: string;
}

interface BankFeePostingRow {
  id: string;
  company_id: string;
  bank_account_id: string;
  statement_line_id: string;
  fee_rule_id: string | null;
  fee_account_id: string;
  fee_account_code: string;
  fee_account_name: string;
  computed_poisha: string | null;
  amount_poisha: string;
  override_reason: string | null;
  evidence_reference: string | null;
  journal_id: string;
  journal_number: string | null;
  status: string;
  reversal_journal_id: string | null;
  reversal_journal_number: string | null;
  reversed_at: Date | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
  posted_by: string;
  posted_by_name: string;
  posted_at: Date;
}

const FEE_POSTING_SELECT = `
  SELECT p.id, p.company_id, p.bank_account_id, p.statement_line_id, p.fee_rule_id,
         p.fee_account_id, a.code AS fee_account_code, a.name_en AS fee_account_name,
         p.computed_poisha::text AS computed_poisha, p.amount_poisha::text AS amount_poisha,
         p.override_reason, p.evidence_reference, p.journal_id, j.journal_number,
         p.status, p.reversal_journal_id, rj.journal_number AS reversal_journal_number,
         p.reversed_at, ru.name AS reversed_by_name, p.reversal_reason,
         p.posted_by, u.name AS posted_by_name, p.posted_at
    FROM bank_fee_postings p
    JOIN accounts a ON a.company_id = p.company_id AND a.id = p.fee_account_id
    JOIN journals j ON j.company_id = p.company_id AND j.id = p.journal_id
    LEFT JOIN journals rj ON rj.company_id = p.company_id AND rj.id = p.reversal_journal_id
    JOIN users u ON u.id = p.posted_by
    LEFT JOIN users ru ON ru.id = p.reversed_by
`;

function mapFeePosting(row: BankFeePostingRow): BankFeePostingDto {
  return {
    id: row.id,
    companyId: row.company_id,
    bankAccountId: row.bank_account_id,
    statementLineId: row.statement_line_id,
    feeRuleId: row.fee_rule_id,
    feeAccountId: row.fee_account_id,
    feeAccountCode: row.fee_account_code,
    feeAccountName: row.fee_account_name,
    computedPoisha: row.computed_poisha,
    computedBdt: row.computed_poisha === null ? null : formatPoishaAsBdt(row.computed_poisha),
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    overrideReason: row.override_reason,
    evidenceReference: row.evidence_reference,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    status: row.status as 'POSTED' | 'REVERSED',
    reversalJournalId: row.reversal_journal_id,
    reversalJournalNumber: row.reversal_journal_number,
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    reversalReason: row.reversal_reason,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name,
    postedAt: row.posted_at.toISOString(),
  };
}

export async function getBankFeePosting(
  database: Queryable,
  companyId: string,
  statementLineId: string,
): Promise<BankFeePostingDto | null> {
  const result = await database.query<BankFeePostingRow>(
    `${FEE_POSTING_SELECT} WHERE p.company_id = $1 AND p.statement_line_id = $2
      ORDER BY p.posted_at DESC, p.id DESC
      LIMIT 1`,
    [companyId, statementLineId],
  );
  const row = result.rows[0];
  return row ? mapFeePosting(row) : null;
}

export async function listBankFeePostings(
  database: Queryable,
  companyId: string,
  options: { bankAccountId?: string; limit?: number } = {},
): Promise<BankFeePostingDto[]> {
  const values: unknown[] = [companyId];
  const where = ['p.company_id = $1'];
  if (options.bankAccountId) {
    values.push(options.bankAccountId);
    where.push(`p.bank_account_id = $${values.length}`);
  }
  values.push(Math.min(Math.max(options.limit ?? 100, 1), 500));
  const result = await database.query<BankFeePostingRow>(
    `${FEE_POSTING_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY p.posted_at DESC, p.id DESC
      LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(mapFeePosting);
}

interface FeeRuleResolutionRow {
  id: string;
  rate_bps: number;
  fixed_poisha: string;
  fee_account_id: string;
  fee_account_code: string;
  fee_account_name: string;
  policy_reference: string;
  effective_from: Date;
  effective_to: Date | null;
}

async function resolveFeeRule(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
  date: string,
): Promise<FeeRuleResolutionRow | null> {
  const result = await database.query<FeeRuleResolutionRow>(
    `SELECT r.id, r.rate_bps, r.fixed_poisha::text AS fixed_poisha, r.fee_account_id,
            a.code AS fee_account_code, a.name_en AS fee_account_name, r.policy_reference,
            r.effective_from, r.effective_to
       FROM bank_fee_rules r
       JOIN accounts a ON a.company_id = r.company_id AND a.id = r.fee_account_id
      WHERE r.company_id = $1 AND r.bank_account_id = $2 AND r.status = 'ACTIVE'
        AND r.effective_from <= $3::date
        AND (r.effective_to IS NULL OR r.effective_to >= $3::date)
      ORDER BY r.effective_from DESC, r.created_at DESC
      LIMIT 1`,
    [companyId, bankAccountId, date],
  );
  return result.rows[0] ?? null;
}

export async function postBankFee(
  pool: Pool,
  input: BankingAuditContext & {
    lineId: string;
    idempotencyKey: string;
    overrideAmount?: string;
    overrideReason?: string | null;
    evidenceReference?: string | null;
    feeAccountId?: string | null;
  },
): Promise<{ posting: BankFeePostingDto; replayed: boolean }> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bank-fee:${input.companyId}:${input.lineId}`]);
    const existingKey = await client.query<BankFeePostingRow>(
      `${FEE_POSTING_SELECT} WHERE p.company_id = $1 AND p.idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if (existingKey.rows[0]) {
      if (existingKey.rows[0].statement_line_id !== input.lineId) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'That Idempotency-Key was already used for another fee posting.',
        );
      }
      return { posting: mapFeePosting(existingKey.rows[0]), replayed: true };
    }
    const line = await loadBankStatementLine(client, input.companyId, input.lineId, { forUpdate: true });
    await assertLineEditable(client, line);
    if (line.status === 'EXCLUDED') {
      throw new AppError(409, 'BANK_LINE_EXCLUDED', 'An excluded statement line cannot receive a fee posting.');
    }
    if (line.status === 'MATCHED') {
      throw new AppError(409, 'BANK_LINE_ALREADY_MATCHED', 'Resolve the fee before the line is fully matched.');
    }
    const existingLinePosting = await client.query<{ id: string }>(
      `SELECT id FROM bank_fee_postings
        WHERE company_id = $1 AND statement_line_id = $2 AND status = 'POSTED'`,
      [input.companyId, line.id],
    );
    if (existingLinePosting.rows[0]) {
      throw new AppError(
        409,
        'BANK_FEE_ALREADY_POSTED',
        'A fee has already been posted for this statement line. A second fee posting is not allowed.',
        { postingId: existingLinePosting.rows[0].id },
      );
    }
    const bank = await loadBankAccount(client, input.companyId, line.bank_account_id);
    if (bank.status !== 'ACTIVE') {
      throw new AppError(409, 'BANK_ACCOUNT_INACTIVE', 'The bank/cash account is inactive.');
    }
    const rule = await resolveFeeRule(
      client,
      input.companyId,
      line.bank_account_id,
      formatDatabaseDate(line.value_date),
    );
    const statementAmount = BigInt(line.debit_poisha) + BigInt(line.credit_poisha);
    const computed = rule ? calculateFeePoisha(statementAmount, rule.rate_bps, BigInt(rule.fixed_poisha)) : null;
    const override = input.overrideAmount ? parseBdtToPoisha(input.overrideAmount) : null;
    if (input.overrideAmount && (override === null || override <= 0n)) {
      throw new AppError(
        400,
        'INVALID_AMOUNT',
        'The fee override must be a positive BDT amount with up to 2 decimals.',
      );
    }
    const amount = override ?? computed;
    if (amount === null || amount <= 0n) {
      throw new AppError(
        409,
        'BANK_FEE_RULE_MISSING',
        'No active fee rule produces a positive fee for this account and date. Configure a provider/account rule or enter an evidence-backed override.',
      );
    }
    const overrideReason = input.overrideReason?.trim() || null;
    const evidenceReference = input.evidenceReference?.trim() || null;
    const differsFromComputed = computed === null || amount !== computed;
    if (differsFromComputed) {
      if (!overrideReason || overrideReason.length < 3 || overrideReason.length > 500) {
        throw new AppError(
          400,
          'BANK_FEE_OVERRIDE_REASON_REQUIRED',
          'A manual fee override needs a reason between 3 and 500 characters.',
        );
      }
      if (!evidenceReference || evidenceReference.length > 500) {
        throw new AppError(
          400,
          'BANK_FEE_OVERRIDE_EVIDENCE_REQUIRED',
          'A manual fee override needs an evidence reference of at most 500 characters.',
        );
      }
    }
    const feeAccountId = rule?.fee_account_id ?? input.feeAccountId ?? null;
    if (!feeAccountId) {
      throw new AppError(
        400,
        'BANK_FEE_ACCOUNT_REQUIRED',
        'Choose the fee expense account when no active fee rule applies. The account is never guessed.',
      );
    }
    const feeAccount = await client.query<{ code: string; name_en: string; account_type: string; is_active: boolean }>(
      `SELECT code, name_en, account_type, is_active FROM accounts WHERE company_id = $1 AND id = $2`,
      [input.companyId, feeAccountId],
    );
    const account = feeAccount.rows[0];
    if (!account || !account.is_active || account.account_type !== 'EXPENSE') {
      throw new AppError(
        400,
        'BANK_FEE_ACCOUNT_INVALID',
        'The fee rule must point to an active EXPENSE account before a fee can be posted.',
      );
    }
    const postingId = randomUUID();
    const narration = `Bank/MFS fee — ${line.description}`.slice(0, 500);
    const journal = await postSystemJournalWithinTransaction(client, {
      ...input,
      companyId: input.companyId,
      date: formatDatabaseDate(line.value_date),
      narration,
      sourceModule: 'BANK_MFS',
      sourceDocId: postingId,
      sourceDocRef: line.reference ?? `STL-${line.line_no}`,
      lines: [
        {
          accountId: feeAccountId,
          debit: amount.toString(),
          credit: '0',
          memo: overrideReason ?? rule?.policy_reference ?? 'Bank/MFS fee',
        },
        {
          accountId: bank.gl_account_id,
          debit: '0',
          credit: amount.toString(),
          memo: `Fee deducted from ${bank.name}`,
        },
      ],
    });
    await client.query(
      `INSERT INTO bank_fee_postings (
         id, company_id, bank_account_id, statement_line_id, fee_rule_id, fee_account_id,
         computed_poisha, amount_poisha, override_reason, evidence_reference, basis_json,
         journal_id, idempotency_key, posted_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [
        postingId,
        input.companyId,
        line.bank_account_id,
        line.id,
        rule?.id ?? null,
        feeAccountId,
        computed?.toString() ?? null,
        amount.toString(),
        overrideReason,
        evidenceReference,
        JSON.stringify({
          statementAmountPoisha: statementAmount.toString(),
          rateBps: rule?.rate_bps ?? null,
          fixedPoisha: rule?.fixed_poisha ?? null,
          policyReference: rule?.policy_reference ?? null,
          effectiveFrom: rule ? formatDatabaseDate(rule.effective_from) : null,
          effectiveTo: rule?.effective_to ? formatDatabaseDate(rule.effective_to) : null,
          override: differsFromComputed,
        }),
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
      action: 'bank_fee.posted',
      entityType: 'bank_fee_posting',
      entityId: postingId,
      after: {
        statementLineId: line.id,
        bankAccountId: line.bank_account_id,
        feeRuleId: rule?.id ?? null,
        computedPoisha: computed?.toString() ?? null,
        amountPoisha: amount.toString(),
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        override: differsFromComputed,
      },
      reason: overrideReason ?? rule?.policy_reference ?? 'Configured bank/MFS fee.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    const result = await client.query<BankFeePostingRow>(
      `${FEE_POSTING_SELECT} WHERE p.company_id = $1 AND p.id = $2`,
      [input.companyId, postingId],
    );
    return { posting: mapFeePosting(result.rows[0]!), replayed: false };
  });
}
