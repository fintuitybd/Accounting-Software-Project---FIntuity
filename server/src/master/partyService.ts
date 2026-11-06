import type { Pool, PoolClient, QueryResult } from 'pg';
import type { AuditEventInput } from '../auth/audit.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { PARTY_TYPES, digitsOnly, isValidBinDigits, isValidTinDigits, normaliseMasterCode } from './constants.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface PartyAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export type PartyType = (typeof PARTY_TYPES)[number];
export type MasterStatus = 'ACTIVE' | 'INACTIVE';

export interface PartyDto {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  type: PartyType;
  bin: string | null;
  tin: string | null;
  addressEn: string | null;
  addressBn: string | null;
  phone: string | null;
  email: string | null;
  creditDays: number;
  creditLimitPoisha: string;
  creditLimitBdt: string;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PartyWriteInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  type: PartyType;
  bin?: string | null;
  tin?: string | null;
  addressEn?: string | null;
  addressBn?: string | null;
  phone?: string | null;
  email?: string | null;
  creditDays: number;
  creditLimit: string;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
}

export interface PartyOpeningItemDto {
  id: string;
  companyId: string;
  partyId: string;
  documentType: string;
  documentNo: string;
  dueDate: string;
  amountPoisha: string;
  amountBdt: string;
  basePoisha: string | null;
  baseBdt: string | null;
  memo: string | null;
  status: 'OPEN' | 'CANCELLED';
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PartyRow {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  type: string;
  bin: string | null;
  tin: string | null;
  address_en: string | null;
  address_bn: string | null;
  phone: string | null;
  email: string | null;
  credit_days: number;
  credit_limit_poisha: string;
  is_withholding_buyer: boolean;
  is_government: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function mapParty(row: PartyRow): PartyDto {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    type: row.type as PartyType,
    bin: row.bin,
    tin: row.tin,
    addressEn: row.address_en,
    addressBn: row.address_bn,
    phone: row.phone,
    email: row.email,
    creditDays: row.credit_days,
    creditLimitPoisha: row.credit_limit_poisha,
    creditLimitBdt: formatPoishaAsBdt(row.credit_limit_poisha),
    isWithholdingBuyer: row.is_withholding_buyer,
    isGovernment: row.is_government,
    status: row.status as MasterStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const PARTY_SELECT = `
  SELECT id, company_id, code, name_en, name_bn, type, bin, tin, address_en, address_bn, phone,
         email, credit_days, credit_limit_poisha::text AS credit_limit_poisha,
         is_withholding_buyer, is_government, status, created_at, updated_at
    FROM parties
`;

export interface PartyListFilters {
  search?: string;
  type?: PartyType;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listParties(
  database: Queryable,
  companyId: string,
  filters: PartyListFilters = {},
): Promise<{ entries: PartyDto[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const conditions = ['company_id = $1'];
  const values: unknown[] = [companyId];
  if (!filters.includeInactive) conditions.push(`status = 'ACTIVE'`);
  if (filters.type) {
    values.push(filters.type);
    conditions.push(`type = $${values.length}`);
  }
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    const index = values.length;
    conditions.push(
      `(code ILIKE $${index} OR name_en ILIKE $${index} OR coalesce(name_bn, '') ILIKE $${index} OR coalesce(bin, '') ILIKE $${index} OR coalesce(tin, '') ILIKE $${index})`,
    );
  }
  const where = conditions.join(' AND ');
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM parties WHERE ${where}`,
    values,
  );
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const rows = await database.query<PartyRow>(
    `${PARTY_SELECT} WHERE ${where} ORDER BY code ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    entries: rows.rows.map(mapParty),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export async function getParty(database: Queryable, companyId: string, partyId: string): Promise<PartyDto> {
  const result = await database.query<PartyRow>(`${PARTY_SELECT} WHERE company_id = $1 AND id = $2`, [
    companyId,
    partyId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PARTY_NOT_FOUND', 'Party not found.');
  return mapParty(row);
}

function normalisePartyInput(input: PartyWriteInput): {
  code: string;
  nameEn: string;
  nameBn: string | null;
  type: PartyType;
  bin: string | null;
  tin: string | null;
  addressEn: string | null;
  addressBn: string | null;
  phone: string | null;
  email: string | null;
  creditDays: number;
  creditLimitPoisha: bigint;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
} {
  const bin = digitsOnly(input.bin);
  if (bin && !isValidBinDigits(bin)) {
    throw new AppError(400, 'PARTY_BIN_INVALID', 'BIN must be a 13-digit number after removing formatting.');
  }
  const tin = digitsOnly(input.tin);
  if (tin && !isValidTinDigits(tin)) {
    throw new AppError(400, 'PARTY_TIN_INVALID', 'TIN must be a 12-digit number after removing formatting.');
  }
  const creditLimitPoisha = parseBdtToPoisha(input.creditLimit);
  if (creditLimitPoisha === null || creditLimitPoisha < 0n) {
    throw new AppError(400, 'PARTY_CREDIT_LIMIT_INVALID', 'Credit limit must be a non-negative BDT amount.');
  }
  if (!Number.isInteger(input.creditDays) || input.creditDays < 0 || input.creditDays > 3650) {
    throw new AppError(400, 'PARTY_CREDIT_DAYS_INVALID', 'Credit days must be a whole number between 0 and 3650.');
  }
  return {
    code: normaliseMasterCode(input.code),
    nameEn: input.nameEn.trim(),
    nameBn: input.nameBn?.trim() || null,
    type: input.type,
    bin,
    tin,
    addressEn: input.addressEn?.trim() || null,
    addressBn: input.addressBn?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    creditDays: input.creditDays,
    creditLimitPoisha,
    isWithholdingBuyer: input.isWithholdingBuyer,
    isGovernment: input.isGovernment,
  };
}

function auditFields(party: ReturnType<typeof normalisePartyInput>): Record<string, unknown> {
  return {
    code: party.code,
    nameEn: party.nameEn,
    nameBn: party.nameBn,
    type: party.type,
    bin: party.bin,
    tin: party.tin,
    addressEn: party.addressEn,
    addressBn: party.addressBn,
    phone: party.phone,
    email: party.email,
    creditDays: party.creditDays,
    creditLimitPoisha: party.creditLimitPoisha.toString(),
    isWithholdingBuyer: party.isWithholdingBuyer,
    isGovernment: party.isGovernment,
  };
}

function partyError(error: unknown, code: string): never {
  if ((error as { code?: string }).code === '23505') {
    throw new AppError(409, code, 'That party code already exists in this company.');
  }
  throw error;
}

export async function createParty(
  pool: Pool,
  input: PartyAuditContext & { companyId: string; party: PartyWriteInput },
): Promise<PartyDto> {
  const party = normalisePartyInput(input.party);
  return withTransaction(pool, async (client) => {
    let inserted: QueryResult<{ id: string }>;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO parties (
           company_id, code, name_en, name_bn, type, bin, tin, address_en, address_bn, phone, email,
           credit_days, credit_limit_poisha, is_withholding_buyer, is_government, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         RETURNING id`,
        [
          input.companyId,
          party.code,
          party.nameEn,
          party.nameBn,
          party.type,
          party.bin,
          party.tin,
          party.addressEn,
          party.addressBn,
          party.phone,
          party.email,
          party.creditDays,
          party.creditLimitPoisha.toString(),
          party.isWithholdingBuyer,
          party.isGovernment,
          input.actorUserId,
        ],
      );
    } catch (error) {
      partyError(error, 'PARTY_CODE_DUPLICATE');
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'PARTY_CREATE_FAILED', 'The party could not be created.');
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party.created',
      entityType: 'party',
      entityId: id,
      after: { ...auditFields(party), status: 'ACTIVE' },
      reason: 'Party master created.',
    });
    return getParty(client, input.companyId, id);
  });
}

export async function updateParty(
  pool: Pool,
  input: PartyAuditContext & { companyId: string; partyId: string; party: PartyWriteInput },
): Promise<PartyDto> {
  const party = normalisePartyInput(input.party);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<PartyRow>(`${PARTY_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.partyId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'PARTY_NOT_FOUND', 'Party not found.');
    try {
      await client.query(
        `UPDATE parties
            SET code = $3, name_en = $4, name_bn = $5, type = $6, bin = $7, tin = $8,
                address_en = $9, address_bn = $10, phone = $11, email = $12, credit_days = $13,
                credit_limit_poisha = $14, is_withholding_buyer = $15, is_government = $16,
                updated_by = $17, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.partyId,
          party.code,
          party.nameEn,
          party.nameBn,
          party.type,
          party.bin,
          party.tin,
          party.addressEn,
          party.addressBn,
          party.phone,
          party.email,
          party.creditDays,
          party.creditLimitPoisha.toString(),
          party.isWithholdingBuyer,
          party.isGovernment,
          input.actorUserId,
        ],
      );
    } catch (error) {
      partyError(error, 'PARTY_CODE_DUPLICATE');
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party.updated',
      entityType: 'party',
      entityId: input.partyId,
      before: {
        code: before.code,
        nameEn: before.name_en,
        type: before.type,
        bin: before.bin,
        tin: before.tin,
        creditDays: before.credit_days,
        creditLimitPoisha: before.credit_limit_poisha,
        isWithholdingBuyer: before.is_withholding_buyer,
        isGovernment: before.is_government,
      },
      after: auditFields(party),
      reason: 'Party master updated.',
    });
    return getParty(client, input.companyId, input.partyId);
  });
}

export async function deactivateParty(
  pool: Pool,
  input: PartyAuditContext & { companyId: string; partyId: string; reason: string },
): Promise<PartyDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PARTY_DEACTIVATION_REASON_REQUIRED',
      'Give a reason of 3–500 characters to deactivate a party.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<PartyRow>(`${PARTY_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.partyId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'PARTY_NOT_FOUND', 'Party not found.');
    if (before.status === 'INACTIVE') return mapParty(before);
    const openItems = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM party_opening_items
        WHERE company_id = $1 AND party_id = $2 AND status = 'OPEN'`,
      [input.companyId, input.partyId],
    );
    if (Number(openItems.rows[0]?.count ?? 0) > 0) {
      throw new AppError(
        409,
        'PARTY_HAS_OPEN_ITEMS',
        'This party has open opening items. Settle or cancel them before deactivation.',
      );
    }
    await client.query(
      `UPDATE parties SET status = 'INACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.partyId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party.deactivated',
      entityType: 'party',
      entityId: input.partyId,
      before: { status: before.status },
      after: { status: 'INACTIVE' },
      reason,
    });
    return getParty(client, input.companyId, input.partyId);
  });
}

export async function reactivateParty(
  pool: Pool,
  input: PartyAuditContext & { companyId: string; partyId: string; reason: string },
): Promise<PartyDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PARTY_REACTIVATION_REASON_REQUIRED',
      'Give a reason of 3–500 characters to reactivate a party.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<PartyRow>(`${PARTY_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.partyId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'PARTY_NOT_FOUND', 'Party not found.');
    if (before.status === 'ACTIVE') return mapParty(before);
    await client.query(
      `UPDATE parties SET status = 'ACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.partyId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party.reactivated',
      entityType: 'party',
      entityId: input.partyId,
      before: { status: before.status },
      after: { status: 'ACTIVE' },
      reason,
    });
    return getParty(client, input.companyId, input.partyId);
  });
}

function auditBase(
  input: PartyAuditContext,
  companyId: string,
): Omit<AuditEventInput, 'action' | 'entityType' | 'entityId'> {
  return {
    organisationId: input.organisationId,
    companyId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  };
}

interface OpeningItemRow {
  id: string;
  company_id: string;
  party_id: string;
  document_type: string;
  document_no: string;
  due_date: Date;
  amount_poisha: string;
  base_poisha: string | null;
  memo: string | null;
  status: string;
  cancel_reason: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const OPENING_SELECT = `
  SELECT id, company_id, party_id, document_type, document_no, due_date,
         amount_poisha::text AS amount_poisha, base_poisha::text AS base_poisha, memo, status,
         cancel_reason, cancelled_at, created_at, updated_at
    FROM party_opening_items
`;

function mapOpeningItem(row: OpeningItemRow): PartyOpeningItemDto {
  return {
    id: row.id,
    companyId: row.company_id,
    partyId: row.party_id,
    documentType: row.document_type,
    documentNo: row.document_no,
    dueDate: formatDatabaseDate(row.due_date),
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    basePoisha: row.base_poisha,
    baseBdt: row.base_poisha === null ? null : formatPoishaAsBdt(row.base_poisha),
    memo: row.memo,
    status: row.status as 'OPEN' | 'CANCELLED',
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listPartyOpeningItems(
  database: Queryable,
  companyId: string,
  partyId: string,
  options: { includeCancelled?: boolean } = {},
): Promise<PartyOpeningItemDto[]> {
  const conditions = ['company_id = $1', 'party_id = $2'];
  if (!options.includeCancelled) conditions.push(`status = 'OPEN'`);
  const result = await database.query<OpeningItemRow>(
    `${OPENING_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY due_date ASC, document_no ASC LIMIT 500`,
    [companyId, partyId],
  );
  return result.rows.map(mapOpeningItem);
}

export async function createPartyOpeningItem(
  pool: Pool,
  input: PartyAuditContext & {
    companyId: string;
    partyId: string;
    documentType: string;
    documentNo: string;
    dueDate: string;
    amount: string;
    base?: string | null;
    memo?: string | null;
  },
): Promise<PartyOpeningItemDto> {
  if (!isValidIsoDate(input.dueDate)) {
    throw new AppError(400, 'PARTY_OPENING_DUE_DATE_INVALID', 'Use a real due date in YYYY-MM-DD format.');
  }
  const amountPoisha = parseBdtToPoisha(input.amount);
  if (amountPoisha === null || amountPoisha <= 0n) {
    throw new AppError(400, 'PARTY_OPENING_AMOUNT_INVALID', 'Opening item amount must be a positive BDT amount.');
  }
  const basePoisha =
    input.base === undefined || input.base === null || input.base === '' ? null : parseBdtToPoisha(input.base);
  if (basePoisha !== null && (basePoisha < 0n || basePoisha > amountPoisha)) {
    throw new AppError(400, 'PARTY_OPENING_BASE_INVALID', 'Opening base must be between zero and the gross amount.');
  }
  const documentNo = input.documentNo.trim();
  return withTransaction(pool, async (client) => {
    const party = await client.query<{ id: string; type: string; status: string }>(
      `SELECT id, type, status FROM parties WHERE company_id = $1 AND id = $2 FOR SHARE`,
      [input.companyId, input.partyId],
    );
    const row = party.rows[0];
    if (!row) throw new AppError(404, 'PARTY_NOT_FOUND', 'Party not found.');
    if (row.status !== 'ACTIVE') {
      throw new AppError(409, 'PARTY_INACTIVE', 'An inactive party cannot receive a new opening item.');
    }
    const receivable = input.documentType === 'SALES_INVOICE' || input.documentType === 'CREDIT_NOTE';
    if (receivable && row.type === 'SUPPLIER') {
      throw new AppError(
        400,
        'PARTY_OPENING_TYPE_MISMATCH',
        'A supplier party cannot carry a customer opening document.',
      );
    }
    if (!receivable && row.type === 'CUSTOMER') {
      throw new AppError(
        400,
        'PARTY_OPENING_TYPE_MISMATCH',
        'A customer party cannot carry a supplier opening document.',
      );
    }
    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO party_opening_items (
           company_id, party_id, document_type, document_no, due_date, amount_poisha, base_poisha,
           memo, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         RETURNING id`,
        [
          input.companyId,
          input.partyId,
          input.documentType,
          documentNo,
          input.dueDate,
          amountPoisha.toString(),
          basePoisha?.toString() ?? null,
          input.memo?.trim() || null,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'PARTY_OPENING_DOCUMENT_DUPLICATE',
          'That document number already exists for this opening document type.',
        );
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'PARTY_OPENING_CREATE_FAILED', 'The opening item could not be created.');
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party_opening_item.created',
      entityType: 'party_opening_item',
      entityId: id,
      after: {
        partyId: input.partyId,
        documentType: input.documentType,
        documentNo,
        dueDate: input.dueDate,
        amountPoisha: amountPoisha.toString(),
        basePoisha: basePoisha?.toString() ?? null,
        status: 'OPEN',
      },
      reason: 'Party opening item created as an AR/AP schedule; it is not posted to the GL by this command.',
    });
    return getPartyOpeningItem(client, input.companyId, id);
  });
}

async function getPartyOpeningItem(
  database: Queryable,
  companyId: string,
  itemId: string,
): Promise<PartyOpeningItemDto> {
  const result = await database.query<OpeningItemRow>(`${OPENING_SELECT} WHERE company_id = $1 AND id = $2`, [
    companyId,
    itemId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'PARTY_OPENING_ITEM_NOT_FOUND', 'Party opening item not found.');
  return mapOpeningItem(row);
}

export async function cancelPartyOpeningItem(
  pool: Pool,
  input: PartyAuditContext & { companyId: string; partyId: string; itemId: string; reason: string },
): Promise<PartyOpeningItemDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'PARTY_OPENING_CANCEL_REASON_REQUIRED', 'Give a reason of 3–500 characters to cancel.');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<OpeningItemRow>(
      `${OPENING_SELECT} WHERE company_id = $1 AND party_id = $2 AND id = $3 FOR UPDATE`,
      [input.companyId, input.partyId, input.itemId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'PARTY_OPENING_ITEM_NOT_FOUND', 'Party opening item not found.');
    if (before.status === 'CANCELLED') return mapOpeningItem(before);
    await client.query(
      `UPDATE party_opening_items
          SET status = 'CANCELLED', cancel_reason = $4, cancelled_at = now(), cancelled_by = $5,
              updated_by = $5, updated_at = now()
        WHERE company_id = $1 AND party_id = $2 AND id = $3`,
      [input.companyId, input.partyId, input.itemId, reason, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'party_opening_item.cancelled',
      entityType: 'party_opening_item',
      entityId: input.itemId,
      before: { status: before.status },
      after: { status: 'CANCELLED' },
      reason,
    });
    return getPartyOpeningItem(client, input.companyId, input.itemId);
  });
}
