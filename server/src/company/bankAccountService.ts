import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { BANK_ACCOUNT_KINDS } from './constants.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from './money.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface BankAccountDto {
  id: string;
  companyId: string;
  name: string;
  kind: 'BANK' | 'MFS' | 'CASH';
  provider: string | null;
  maskedNumber: string | null;
  branch: string | null;
  currency: string;
  glAccountId: string;
  glAccountCode: string;
  glAccountName: string;
  openingPoisha: string;
  openingBdt: string;
  status: 'ACTIVE' | 'INACTIVE';
  isPrincipal: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BankAccountRow {
  id: string;
  company_id: string;
  name: string;
  kind: string;
  provider: string | null;
  masked_number: string | null;
  branch: string | null;
  currency: string;
  gl_account_id: string;
  gl_account_code: string;
  gl_account_name: string;
  opening_poisha: string;
  status: string;
  is_principal: boolean;
  created_at: Date;
  updated_at: Date;
}

const BANK_SELECT = `
  SELECT b.id, b.company_id, b.name, b.kind, b.provider, b.masked_number, b.branch, b.currency,
         b.gl_account_id, a.code AS gl_account_code, a.name_en AS gl_account_name,
         b.opening_poisha::text AS opening_poisha, b.status, b.is_principal, b.created_at, b.updated_at
    FROM bank_accounts b
    JOIN accounts a ON a.company_id = b.company_id AND a.id = b.gl_account_id
`;

function mapBankAccount(row: BankAccountRow): BankAccountDto {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    kind: row.kind as BankAccountDto['kind'],
    provider: row.provider,
    maskedNumber: row.masked_number,
    branch: row.branch,
    currency: row.currency,
    glAccountId: row.gl_account_id,
    glAccountCode: row.gl_account_code,
    glAccountName: row.gl_account_name,
    openingPoisha: row.opening_poisha,
    openingBdt: formatPoishaAsBdt(row.opening_poisha),
    status: row.status as BankAccountDto['status'],
    isPrincipal: row.is_principal,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isMaskedNumber(value: string): boolean {
  if (value.length > 40) return false;
  if (!/^[0-9A-Za-z*•xX .-]+$/.test(value)) return false;
  // A full account number must never be stored. Four trailing digits are normal for a mask.
  return !/[0-9]{5,}/.test(value);
}

function validateMaskedNumber(kind: string, value: string | null): string | null {
  const trimmed = value?.trim() || null;
  if (kind === 'CASH') {
    if (!trimmed) return null;
    if (trimmed.length > 40 || /\d{9,}/.test(trimmed)) {
      throw new AppError(
        400,
        'BANK_MASKED_NUMBER_INVALID',
        'Use a short cash identifier, never a full account number.',
      );
    }
    return trimmed;
  }
  if (!trimmed) {
    throw new AppError(
      400,
      'BANK_MASKED_NUMBER_REQUIRED',
      'A masked account number is required for bank and MFS accounts.',
    );
  }
  if (!isMaskedNumber(trimmed)) {
    throw new AppError(
      400,
      'BANK_MASKED_NUMBER_INVALID',
      'Store only a masked account number (for example •••• 4471). Never enter a complete account number.',
    );
  }
  return trimmed;
}

async function assertBankGlAccount(
  database: Queryable,
  companyId: string,
  glAccountId: string,
  active: boolean,
): Promise<void> {
  const result = await database.query<{
    account_type: string;
    control_subledger: string;
    is_active: boolean;
  }>(`SELECT account_type, control_subledger, is_active FROM accounts WHERE company_id = $1 AND id = $2`, [
    companyId,
    glAccountId,
  ]);
  const account = result.rows[0];
  if (!account) {
    throw new AppError(400, 'BANK_GL_INVALID', 'The GL account does not exist in this company.');
  }
  if (account.account_type !== 'ASSET' || account.control_subledger !== 'BANK_MFS') {
    throw new AppError(
      400,
      'BANK_GL_INVALID',
      'Choose an ASSET account with the BANK_MFS control subledger for the bank/cash/MFS mapping.',
    );
  }
  if (active && !account.is_active) {
    throw new AppError(400, 'BANK_GL_INVALID', 'The mapped GL account is inactive.');
  }
}

async function lockCompany(database: Queryable, companyId: string): Promise<void> {
  await database.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`bank-accounts:${companyId}`]);
}

async function findBankAccountReference(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<string | null> {
  const references = await database.query<{ source: string }>(
    `SELECT 'receipt' AS source FROM sales_receipts
      WHERE company_id = $1 AND bank_account_id = $2
     UNION ALL
     SELECT 'payment' AS source FROM purchase_payments
      WHERE company_id = $1 AND bank_account_id = $2
     UNION ALL
     SELECT 'treasury challan' AS source FROM treasury_challans
      WHERE company_id = $1 AND bank_account_id = $2
     UNION ALL
     SELECT 'imported statement' AS source FROM bank_statements
      WHERE company_id = $1 AND bank_account_id = $2
     UNION ALL
     SELECT 'bank transfer' AS source FROM bank_transfers
      WHERE company_id = $1 AND (from_bank_account_id = $2 OR to_bank_account_id = $2)
     UNION ALL
     SELECT 'reconciliation' AS source FROM bank_reconciliations
      WHERE company_id = $1 AND bank_account_id = $2
     LIMIT 1`,
    [companyId, bankAccountId],
  );
  return references.rows[0]?.source ?? null;
}

export async function listBankAccounts(database: Queryable, companyId: string): Promise<BankAccountDto[]> {
  const result = await database.query<BankAccountRow>(
    `${BANK_SELECT} WHERE b.company_id = $1 ORDER BY b.is_principal DESC, b.name ASC`,
    [companyId],
  );
  return result.rows.map(mapBankAccount);
}

export async function getBankAccount(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<BankAccountDto> {
  const result = await database.query<BankAccountRow>(`${BANK_SELECT} WHERE b.company_id = $1 AND b.id = $2`, [
    companyId,
    bankAccountId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank/cash account not found.');
  return mapBankAccount(row);
}

export interface BankAccountWriteInput {
  name: string;
  kind: string;
  provider?: string | null;
  maskedNumber?: string | null;
  branch?: string | null;
  glAccountId: string;
  openingBalance: string;
  isPrincipal?: boolean;
}

function validateBankInput(input: BankAccountWriteInput): BankAccountWriteInput {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw new AppError(400, 'BANK_NAME_INVALID', 'The account name must be 1–120 characters.');
  }
  const kind = input.kind.trim().toUpperCase();
  if (!(BANK_ACCOUNT_KINDS as readonly string[]).includes(kind)) {
    throw new AppError(400, 'BANK_KIND_INVALID', 'Choose bank, MFS or cash.');
  }
  const provider = input.provider?.trim() || null;
  if (kind !== 'CASH' && !provider) {
    throw new AppError(400, 'BANK_PROVIDER_REQUIRED', 'A provider is required for bank and MFS accounts.');
  }
  if ((provider?.length ?? 0) > 120 || (input.branch?.trim().length ?? 0) > 120) {
    throw new AppError(400, 'BANK_TEXT_TOO_LONG', 'Provider and branch must be at most 120 characters.');
  }
  const opening = parseBdtToPoisha(input.openingBalance);
  if (opening === null || opening < 0n) {
    throw new AppError(
      400,
      'INVALID_AMOUNT',
      'The opening balance must be a non-negative BDT amount with up to 2 decimals.',
    );
  }
  return {
    ...input,
    name,
    kind,
    provider,
    maskedNumber: validateMaskedNumber(kind, input.maskedNumber ?? null),
    branch: input.branch?.trim() || null,
  };
}

export async function createBankAccount(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    account: BankAccountWriteInput;
  },
): Promise<BankAccountDto> {
  const account = validateBankInput(input.account);
  const openingPoisha = parseBdtToPoisha(account.openingBalance) ?? 0n;
  return withTransaction(pool, async (client) => {
    await lockCompany(client, input.companyId);
    await assertBankGlAccount(client, input.companyId, account.glAccountId, true);
    const active = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bank_accounts WHERE company_id = $1 AND status = 'ACTIVE'`,
      [input.companyId],
    );
    const activeCount = Number(active.rows[0]?.count ?? '0');
    if (account.isPrincipal) {
      const existingPrincipal = await client.query(
        `SELECT 1 FROM bank_accounts WHERE company_id = $1 AND is_principal AND status = 'ACTIVE' LIMIT 1`,
        [input.companyId],
      );
      if (existingPrincipal.rowCount && existingPrincipal.rowCount > 0) {
        throw new AppError(
          409,
          'BANK_PRINCIPAL_EXISTS',
          'Another active account is already the principal. Change that account first.',
        );
      }
    }
    const isPrincipal = Boolean(account.isPrincipal) || activeCount === 0;
    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO bank_accounts (
           company_id, name, kind, provider, masked_number, branch, currency, gl_account_id,
           opening_poisha, status, is_principal, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,'BDT',$7,$8,'ACTIVE',$9,$10,$10)
         RETURNING id`,
        [
          input.companyId,
          account.name,
          account.kind,
          account.provider,
          account.maskedNumber,
          account.branch,
          account.glAccountId,
          openingPoisha.toString(),
          isPrincipal,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'BANK_GL_IN_USE',
          'That GL account is already mapped to another bank/cash/MFS account in this company.',
        );
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'BANK_CREATE_FAILED', 'The bank/cash account could not be created.');
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'bank_account.created',
      entityType: 'bank_account',
      entityId: id,
      after: {
        name: account.name,
        kind: account.kind,
        provider: account.provider,
        maskedNumber: account.maskedNumber,
        branch: account.branch,
        glAccountId: account.glAccountId,
        openingPoisha: openingPoisha.toString(),
        isPrincipal,
        status: 'ACTIVE',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getBankAccount(client, input.companyId, id);
  });
}

export interface BankAccountUpdateInput {
  name?: string;
  kind?: string;
  provider?: string | null;
  maskedNumber?: string | null;
  branch?: string | null;
  glAccountId?: string;
  openingBalance?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  isPrincipal?: boolean;
}

export async function updateBankAccount(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    bankAccountId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    patch: BankAccountUpdateInput;
  },
): Promise<BankAccountDto> {
  return withTransaction(pool, async (client) => {
    await lockCompany(client, input.companyId);
    const existingResult = await client.query<BankAccountRow>(
      `${BANK_SELECT} WHERE b.company_id = $1 AND b.id = $2 FOR UPDATE OF b`,
      [input.companyId, input.bankAccountId],
    );
    const existing = existingResult.rows[0];
    if (!existing) throw new AppError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank/cash account not found.');

    const merged: BankAccountWriteInput = {
      name: input.patch.name ?? existing.name,
      kind: input.patch.kind ?? existing.kind,
      provider: input.patch.provider === undefined ? existing.provider : input.patch.provider,
      maskedNumber: input.patch.maskedNumber === undefined ? existing.masked_number : input.patch.maskedNumber,
      branch: input.patch.branch === undefined ? existing.branch : input.patch.branch,
      glAccountId: input.patch.glAccountId ?? existing.gl_account_id,
      openingBalance:
        input.patch.openingBalance === undefined
          ? formatPoishaAsBdt(existing.opening_poisha)
          : input.patch.openingBalance,
      isPrincipal: input.patch.isPrincipal,
    };
    const account = validateBankInput(merged);
    const openingPoisha = parseBdtToPoisha(account.openingBalance) ?? 0n;
    const nextStatus = input.patch.status ?? existing.status;
    if (nextStatus !== 'ACTIVE' && nextStatus !== 'INACTIVE') {
      throw new AppError(400, 'BANK_STATUS_INVALID', 'Choose active or inactive.');
    }
    if (openingPoisha !== BigInt(existing.opening_poisha)) {
      const submitted = await client.query(
        `SELECT 1 FROM opening_balance_batches WHERE company_id = $1 AND status = 'SUBMITTED' LIMIT 1`,
        [input.companyId],
      );
      if (submitted.rowCount && submitted.rowCount > 0) {
        throw new AppError(
          409,
          'OPENING_BALANCE_LOCKED',
          'A submitted opening-balance batch already exists. The batch is the authoritative opening position; the bank metadata can no longer diverge from it.',
        );
      }
    }

    const wantsPrincipal = input.patch.isPrincipal === undefined ? existing.is_principal : input.patch.isPrincipal;
    if (nextStatus === 'INACTIVE' && existing.is_principal) {
      throw new AppError(
        409,
        'BANK_PRINCIPAL_REQUIRED',
        'Assign another principal account before deactivating the current principal account.',
      );
    }
    if (nextStatus === 'INACTIVE') {
      const otherActive = await client.query(
        `SELECT 1 FROM bank_accounts
          WHERE company_id = $1 AND id <> $2 AND status = 'ACTIVE' LIMIT 1`,
        [input.companyId, input.bankAccountId],
      );
      if (!otherActive.rowCount || otherActive.rowCount === 0) {
        throw new AppError(
          409,
          'BANK_ACCOUNT_REQUIRED',
          'Keep at least one active bank, MFS or cash account for the company.',
        );
      }
      const reference = await findBankAccountReference(client, input.companyId, input.bankAccountId);
      if (reference) {
        throw new AppError(
          409,
          'BANK_ACCOUNT_IN_USE',
          `This account is referenced by an existing ${reference}. Keep the account active so its history remains traceable.`,
          { referenceType: reference },
        );
      }
    }
    if (account.glAccountId !== existing.gl_account_id) {
      const reference = await findBankAccountReference(client, input.companyId, input.bankAccountId);
      if (reference) {
        throw new AppError(
          409,
          'BANK_GL_CHANGE_RESTRICTED',
          `The GL mapping cannot change after the account is referenced by a ${reference}. Keep the original GL mapping so posted history and statement matching remain traceable.`,
          { referenceType: reference },
        );
      }
    }
    if (wantsPrincipal && nextStatus !== 'ACTIVE') {
      throw new AppError(400, 'BANK_PRINCIPAL_INVALID', 'An inactive account cannot be the principal account.');
    }
    let previousPrincipal: { id: string; name: string } | null = null;
    if (wantsPrincipal && !existing.is_principal) {
      const previous = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM bank_accounts
          WHERE company_id = $1 AND is_principal = true AND status = 'ACTIVE'
          LIMIT 1`,
        [input.companyId],
      );
      previousPrincipal = previous.rows[0] ?? null;
      await client.query(
        `UPDATE bank_accounts SET is_principal = false, updated_by = $2
          WHERE company_id = $1 AND is_principal = true AND status = 'ACTIVE'`,
        [input.companyId, input.actorUserId],
      );
    }

    await assertBankGlAccount(client, input.companyId, account.glAccountId, nextStatus === 'ACTIVE');
    try {
      await client.query(
        `UPDATE bank_accounts
            SET name = $3, kind = $4, provider = $5, masked_number = $6, branch = $7,
                gl_account_id = $8, opening_poisha = $9, status = $10, is_principal = $11,
                updated_by = $12
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.bankAccountId,
          account.name,
          account.kind,
          account.provider,
          account.maskedNumber,
          account.branch,
          account.glAccountId,
          openingPoisha.toString(),
          nextStatus,
          wantsPrincipal,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'BANK_GL_IN_USE',
          'That GL account is already mapped to another bank/cash/MFS account in this company.',
        );
      }
      throw error;
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: nextStatus === 'ACTIVE' ? 'bank_account.updated' : 'bank_account.deactivated',
      entityType: 'bank_account',
      entityId: input.bankAccountId,
      before: {
        name: existing.name,
        kind: existing.kind,
        provider: existing.provider,
        maskedNumber: existing.masked_number,
        branch: existing.branch,
        glAccountId: existing.gl_account_id,
        openingPoisha: existing.opening_poisha,
        status: existing.status,
        isPrincipal: existing.is_principal,
      },
      after: {
        name: account.name,
        kind: account.kind,
        provider: account.provider,
        maskedNumber: account.maskedNumber,
        branch: account.branch,
        glAccountId: account.glAccountId,
        openingPoisha: openingPoisha.toString(),
        status: nextStatus,
        isPrincipal: wantsPrincipal,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    if (previousPrincipal) {
      await writeAuditEvent(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: 'bank_account.principal_reassigned',
        entityType: 'bank_account',
        entityId: previousPrincipal.id,
        before: { name: previousPrincipal.name, isPrincipal: true },
        after: { isPrincipal: false, replacedBy: input.bankAccountId },
        reason: 'Principal bank/cash account changed.',
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });
    }
    return getBankAccount(client, input.companyId, input.bankAccountId);
  });
}
