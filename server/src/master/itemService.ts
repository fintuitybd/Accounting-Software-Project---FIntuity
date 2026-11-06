import type { Pool, PoolClient, QueryResult } from 'pg';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import { ACCOUNT_TYPES, TAX_CATEGORIES } from '../company/constants.ts';
import { normaliseMasterCode } from './constants.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface ItemAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export type ItemStatus = 'ACTIVE' | 'INACTIVE';

export interface ItemDto {
  id: string;
  companyId: string;
  sku: string;
  hsCode: string | null;
  nameEn: string;
  nameBn: string | null;
  unit: string;
  unitBn: string | null;
  isStockItem: boolean;
  defaultTaxCategory: string;
  inventoryAccountId: string | null;
  inventoryAccountCode: string | null;
  inventoryAccountName: string | null;
  expenseAccountId: string | null;
  expenseAccountCode: string | null;
  expenseAccountName: string | null;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ItemWriteInput {
  sku: string;
  hsCode?: string | null;
  nameEn: string;
  nameBn?: string | null;
  unit: string;
  unitBn?: string | null;
  isStockItem: boolean;
  defaultTaxCategory: string;
  inventoryAccountId?: string | null;
  expenseAccountId?: string | null;
}

interface ItemRow {
  id: string;
  company_id: string;
  sku: string;
  hs_code: string | null;
  name_en: string;
  name_bn: string | null;
  unit: string;
  unit_bn: string | null;
  is_stock_item: boolean;
  default_tax_category: string;
  inventory_account_id: string | null;
  inventory_account_code: string | null;
  inventory_account_name: string | null;
  expense_account_id: string | null;
  expense_account_code: string | null;
  expense_account_name: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const ITEM_SELECT = `
  SELECT i.id, i.company_id, i.sku, i.hs_code, i.name_en, i.name_bn, i.unit, i.unit_bn,
         i.is_stock_item, i.default_tax_category, i.inventory_account_id,
         ia.code AS inventory_account_code, ia.name_en AS inventory_account_name,
         i.expense_account_id, ea.code AS expense_account_code, ea.name_en AS expense_account_name,
         i.status, i.created_at, i.updated_at
    FROM items i
    LEFT JOIN accounts ia ON ia.company_id = i.company_id AND ia.id = i.inventory_account_id
    LEFT JOIN accounts ea ON ea.company_id = i.company_id AND ea.id = i.expense_account_id
`;

function mapItem(row: ItemRow): ItemDto {
  return {
    id: row.id,
    companyId: row.company_id,
    sku: row.sku,
    hsCode: row.hs_code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    unit: row.unit,
    unitBn: row.unit_bn,
    isStockItem: row.is_stock_item,
    defaultTaxCategory: row.default_tax_category,
    inventoryAccountId: row.inventory_account_id,
    inventoryAccountCode: row.inventory_account_code,
    inventoryAccountName: row.inventory_account_name,
    expenseAccountId: row.expense_account_id,
    expenseAccountCode: row.expense_account_code,
    expenseAccountName: row.expense_account_name,
    status: row.status as ItemStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ItemListFilters {
  search?: string;
  includeInactive?: boolean;
  stockOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listItems(
  database: Queryable,
  companyId: string,
  filters: ItemListFilters = {},
): Promise<{ entries: ItemDto[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 25, 100);
  const conditions = ['i.company_id = $1'];
  const values: unknown[] = [companyId];
  if (!filters.includeInactive) conditions.push(`i.status = 'ACTIVE'`);
  if (filters.stockOnly) conditions.push('i.is_stock_item = true');
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    const index = values.length;
    conditions.push(
      `(i.sku ILIKE $${index} OR i.name_en ILIKE $${index} OR coalesce(i.name_bn, '') ILIKE $${index} OR coalesce(i.hs_code, '') ILIKE $${index})`,
    );
  }
  const where = conditions.join(' AND ');
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM items i WHERE ${where}`,
    values,
  );
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const rows = await database.query<ItemRow>(
    `${ITEM_SELECT} WHERE ${where} ORDER BY i.sku ASC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    entries: rows.rows.map(mapItem),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export async function getItem(database: Queryable, companyId: string, itemId: string): Promise<ItemDto> {
  const result = await database.query<ItemRow>(`${ITEM_SELECT} WHERE i.company_id = $1 AND i.id = $2`, [
    companyId,
    itemId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
  return mapItem(row);
}

interface AccountRow {
  id: string;
  code: string;
  name_en: string;
  account_type: string;
  is_active: boolean;
}

async function loadAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
  label: string,
): Promise<AccountRow> {
  const result = await database.query<AccountRow>(
    `SELECT id, code, name_en, account_type, is_active
       FROM accounts WHERE company_id = $1 AND id = $2`,
    [companyId, accountId],
  );
  const account = result.rows[0];
  if (!account) {
    throw new AppError(400, 'ITEM_ACCOUNT_INVALID', `The ${label} must be an account from this company.`);
  }
  if (!account.is_active) {
    throw new AppError(400, 'ITEM_ACCOUNT_INACTIVE', `The ${label} is inactive. Choose an active account.`);
  }
  return account;
}

interface NormalisedItem {
  sku: string;
  hsCode: string | null;
  nameEn: string;
  nameBn: string | null;
  unit: string;
  unitBn: string | null;
  isStockItem: boolean;
  defaultTaxCategory: string;
  inventoryAccountId: string | null;
  expenseAccountId: string | null;
}

async function normaliseItemInput(
  database: Queryable,
  companyId: string,
  input: ItemWriteInput,
): Promise<NormalisedItem> {
  if (!(TAX_CATEGORIES as readonly string[]).includes(input.defaultTaxCategory)) {
    throw new AppError(400, 'ITEM_TAX_CATEGORY_INVALID', 'Choose a supported default tax category.');
  }
  const hsCode = input.hsCode?.trim() || null;
  if (hsCode && !/^[0-9A-Za-z.-]{2,20}$/.test(hsCode)) {
    throw new AppError(400, 'ITEM_HS_CODE_INVALID', 'HS code must be 2–20 letters, digits, dots or hyphens.');
  }
  const inventoryAccountId = input.inventoryAccountId?.trim() || null;
  const expenseAccountId = input.expenseAccountId?.trim() || null;
  if (input.isStockItem) {
    if (!inventoryAccountId || !expenseAccountId) {
      throw new AppError(
        400,
        'ITEM_STOCK_ACCOUNTS_REQUIRED',
        'A stock item needs both an inventory asset account and an expense/COGS account.',
      );
    }
    const inventory = await loadAccount(database, companyId, inventoryAccountId, 'inventory account');
    if (!(ACCOUNT_TYPES as readonly string[]).includes(inventory.account_type) || inventory.account_type !== 'ASSET') {
      throw new AppError(400, 'ITEM_INVENTORY_ACCOUNT_TYPE', 'The inventory account must be an asset account.');
    }
    const expense = await loadAccount(database, companyId, expenseAccountId, 'expense/COGS account');
    if (expense.account_type !== 'EXPENSE') {
      throw new AppError(400, 'ITEM_EXPENSE_ACCOUNT_TYPE', 'The expense/COGS account must be an expense account.');
    }
  } else {
    if (inventoryAccountId) {
      throw new AppError(
        400,
        'ITEM_INVENTORY_ACCOUNT_NOT_ALLOWED',
        'A non-stock item cannot carry an inventory account.',
      );
    }
    if (expenseAccountId) {
      const expense = await loadAccount(database, companyId, expenseAccountId, 'expense account');
      if (expense.account_type !== 'EXPENSE') {
        throw new AppError(400, 'ITEM_EXPENSE_ACCOUNT_TYPE', 'The expense account must be an expense account.');
      }
    }
  }
  return {
    sku: normaliseMasterCode(input.sku),
    hsCode,
    nameEn: input.nameEn.trim(),
    nameBn: input.nameBn?.trim() || null,
    unit: input.unit.trim(),
    unitBn: input.unitBn?.trim() || null,
    isStockItem: input.isStockItem,
    defaultTaxCategory: input.defaultTaxCategory,
    inventoryAccountId,
    expenseAccountId,
  };
}

function itemFields(item: NormalisedItem): Record<string, unknown> {
  return {
    sku: item.sku,
    hsCode: item.hsCode,
    nameEn: item.nameEn,
    nameBn: item.nameBn,
    unit: item.unit,
    unitBn: item.unitBn,
    isStockItem: item.isStockItem,
    defaultTaxCategory: item.defaultTaxCategory,
    inventoryAccountId: item.inventoryAccountId,
    expenseAccountId: item.expenseAccountId,
  };
}

function itemAuditBase(
  input: ItemAuditContext,
  companyId: string,
): {
  organisationId: string;
  companyId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
} {
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

function itemUniqueError(error: unknown): never {
  if ((error as { code?: string }).code === '23505') {
    throw new AppError(409, 'ITEM_SKU_DUPLICATE', 'That SKU already exists in this company.');
  }
  throw error;
}

export async function createItem(
  pool: Pool,
  input: ItemAuditContext & { companyId: string; item: ItemWriteInput },
): Promise<ItemDto> {
  return withTransaction(pool, async (client) => {
    const item = await normaliseItemInput(client, input.companyId, input.item);
    let inserted: QueryResult<{ id: string }>;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO items (
           company_id, sku, hs_code, name_en, name_bn, unit, unit_bn, is_stock_item,
           default_tax_category, inventory_account_id, expense_account_id, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
         RETURNING id`,
        [
          input.companyId,
          item.sku,
          item.hsCode,
          item.nameEn,
          item.nameBn,
          item.unit,
          item.unitBn,
          item.isStockItem,
          item.defaultTaxCategory,
          item.inventoryAccountId,
          item.expenseAccountId,
          input.actorUserId,
        ],
      );
    } catch (error) {
      itemUniqueError(error);
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'ITEM_CREATE_FAILED', 'The item could not be created.');
    await writeAuditEvent(client, {
      ...itemAuditBase(input, input.companyId),
      action: 'item.created',
      entityType: 'item',
      entityId: id,
      after: { ...itemFields(item), status: 'ACTIVE' },
      reason: 'Item master created.',
    });
    return getItem(client, input.companyId, id);
  });
}

export async function updateItem(
  pool: Pool,
  input: ItemAuditContext & { companyId: string; itemId: string; item: ItemWriteInput },
): Promise<ItemDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.company_id = $1 AND i.id = $2 FOR UPDATE OF i`,
      [input.companyId, input.itemId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
    const item = await normaliseItemInput(client, input.companyId, input.item);
    const movements = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_movements WHERE company_id = $1 AND item_id = $2`,
      [input.companyId, input.itemId],
    );
    if (Number(movements.rows[0]?.count ?? 0) > 0) {
      if (before.unit !== item.unit) {
        throw new AppError(
          409,
          'ITEM_UNIT_LOCKED',
          'This item already has stock movements. Its unit cannot change because historical quantities would be reinterpreted; create a new item instead.',
        );
      }
      if (
        before.is_stock_item !== item.isStockItem ||
        before.inventory_account_id !== item.inventoryAccountId ||
        before.expense_account_id !== item.expenseAccountId
      ) {
        throw new AppError(
          409,
          'ITEM_ACCOUNT_LOCKED',
          'This item already has stock movements. Its stock/expense accounts and stock-item flag cannot be changed; create a new item or post an adjustment instead.',
        );
      }
    }
    let updated: QueryResult<{ id: string }>;
    try {
      updated = await client.query<{ id: string }>(
        `UPDATE items
            SET sku = $3, hs_code = $4, name_en = $5, name_bn = $6, unit = $7, unit_bn = $8,
                is_stock_item = $9, default_tax_category = $10, inventory_account_id = $11,
                expense_account_id = $12, updated_by = $13, updated_at = now()
          WHERE company_id = $1 AND id = $2
          RETURNING id`,
        [
          input.companyId,
          input.itemId,
          item.sku,
          item.hsCode,
          item.nameEn,
          item.nameBn,
          item.unit,
          item.unitBn,
          item.isStockItem,
          item.defaultTaxCategory,
          item.inventoryAccountId,
          item.expenseAccountId,
          input.actorUserId,
        ],
      );
    } catch (error) {
      itemUniqueError(error);
    }
    if (updated.rowCount !== 1) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
    await writeAuditEvent(client, {
      ...itemAuditBase(input, input.companyId),
      action: 'item.updated',
      entityType: 'item',
      entityId: input.itemId,
      before: {
        sku: before.sku,
        nameEn: before.name_en,
        unit: before.unit,
        isStockItem: before.is_stock_item,
        defaultTaxCategory: before.default_tax_category,
        inventoryAccountId: before.inventory_account_id,
        expenseAccountId: before.expense_account_id,
      },
      after: itemFields(item),
      reason: 'Item master updated.',
    });
    return getItem(client, input.companyId, input.itemId);
  });
}

export async function deactivateItem(
  pool: Pool,
  input: ItemAuditContext & { companyId: string; itemId: string; reason: string },
): Promise<ItemDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'ITEM_DEACTIVATION_REASON_REQUIRED',
      'Give a reason of 3–500 characters to deactivate an item.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.company_id = $1 AND i.id = $2 FOR UPDATE OF i`,
      [input.companyId, input.itemId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
    if (before.status === 'INACTIVE') return mapItem(before);
    const balances = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_balances
        WHERE company_id = $1 AND item_id = $2 AND quantity <> 0`,
      [input.companyId, input.itemId],
    );
    if (Number(balances.rows[0]?.count ?? 0) > 0) {
      throw new AppError(
        409,
        'ITEM_HAS_STOCK',
        'This item still has stock on hand. Issue or adjust the stock before deactivation.',
      );
    }
    await client.query(
      `UPDATE items SET status = 'INACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.itemId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...itemAuditBase(input, input.companyId),
      action: 'item.deactivated',
      entityType: 'item',
      entityId: input.itemId,
      before: { status: before.status },
      after: { status: 'INACTIVE' },
      reason,
    });
    return getItem(client, input.companyId, input.itemId);
  });
}

export async function reactivateItem(
  pool: Pool,
  input: ItemAuditContext & { companyId: string; itemId: string; reason: string },
): Promise<ItemDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'ITEM_REACTIVATION_REASON_REQUIRED',
      'Give a reason of 3–500 characters to reactivate an item.',
    );
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.company_id = $1 AND i.id = $2 FOR UPDATE OF i`,
      [input.companyId, input.itemId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
    if (before.status === 'ACTIVE') return mapItem(before);
    if (before.is_stock_item && before.inventory_account_id && before.expense_account_id) {
      await loadAccount(client, input.companyId, before.inventory_account_id, 'inventory account');
      await loadAccount(client, input.companyId, before.expense_account_id, 'expense/COGS account');
    }
    await client.query(
      `UPDATE items SET status = 'ACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.itemId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...itemAuditBase(input, input.companyId),
      action: 'item.reactivated',
      entityType: 'item',
      entityId: input.itemId,
      before: { status: before.status },
      after: { status: 'ACTIVE' },
      reason,
    });
    return getItem(client, input.companyId, input.itemId);
  });
}
