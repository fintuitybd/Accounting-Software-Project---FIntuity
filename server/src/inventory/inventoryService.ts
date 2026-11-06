import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { postSystemJournalWithinTransaction, reverseJournalWithinTransaction } from '../ledger/ledgerService.ts';
import {
  divideRoundHalfUp,
  impliedUnitCostPoisha,
  outboundValuePoisha,
  parsePositiveQuantity,
  parseStoredQuantity,
  formatQuantity,
  receiptValuePoisha,
} from './quantity.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface InventoryAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export type StockCommandType = 'OPENING' | 'GRN' | 'ISSUE' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

export interface StockCommandInput {
  type: StockCommandType;
  itemId: string;
  date: string;
  quantity: string;
  sourceRef?: string | null;
  warehouseId?: string | null;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  unitCost?: string | null;
  offsetAccountId?: string | null;
  allowNegativeStock?: boolean;
  overrideReason?: string | null;
  reason?: string | null;
}

export interface StockMovementDto {
  id: string;
  companyId: string;
  commandId: string;
  movementNo: number;
  movementType: string;
  movementDate: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  unitCostPoisha: string;
  unitCostBdt: string;
  valuePoisha: string;
  valueBdt: string;
  balanceAfterQuantity: string;
  balanceAfterValuePoisha: string;
  balanceAfterValueBdt: string;
  sourceType: string;
  sourceRef: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalOfMovementId: string | null;
  reversalReason: string | null;
  isReversed: boolean;
  negativeStockOverride: boolean;
  overrideReason: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface StockCommandResult {
  commandId: string;
  replayed: boolean;
  movements: StockMovementDto[];
}

export interface StockBalanceDto {
  companyId: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  valuePoisha: string;
  valueBdt: string;
  weightedUnitCostBdt: string;
  updatedAt: string;
}

export interface InventoryControlAccountDto {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  stockValuePoisha: string;
  stockValueBdt: string;
  glBalancePoisha: string;
  glBalanceBdt: string;
  differencePoisha: string;
  differenceBdt: string;
  itemCount: number;
}

export interface InventoryControlItemDto {
  itemId: string;
  sku: string;
  nameEn: string;
  unit: string;
  inventoryAccountId: string;
  inventoryAccountCode: string;
  quantity: string;
  valuePoisha: string;
  valueBdt: string;
  warehouses: Array<{ warehouseId: string; warehouseCode: string; quantity: string; valuePoisha: string }>;
}

export interface InventoryControlProofDto {
  asOfDate: string;
  accounts: InventoryControlAccountDto[];
  items: InventoryControlItemDto[];
  differences: InventoryControlAccountDto[];
}

interface StockMovementRow {
  id: string;
  company_id: string;
  command_id: string;
  movement_no: number;
  movement_type: string;
  movement_date: Date;
  item_id: string;
  item_sku: string;
  item_name: string;
  unit: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  quantity: string;
  unit_cost_poisha: string;
  value_poisha: string;
  balance_after_quantity: string;
  balance_after_value_poisha: string;
  source_type: string;
  source_ref: string | null;
  journal_id: string | null;
  journal_number: string | null;
  reversal_of_movement_id: string | null;
  reversal_reason: string | null;
  is_reversed: boolean;
  negative_stock_override: boolean;
  override_reason: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
}

const MOVEMENT_SELECT = `
  SELECT sm.id, sm.company_id, sm.command_id, sm.movement_no, sm.movement_type, sm.movement_date,
         sm.item_id, i.sku AS item_sku, i.name_en AS item_name, i.unit,
         sm.warehouse_id, w.code AS warehouse_code, w.name_en AS warehouse_name,
         sm.quantity::text AS quantity, sm.unit_cost_poisha::text AS unit_cost_poisha,
         sm.value_poisha::text AS value_poisha,
         sm.balance_after_quantity::text AS balance_after_quantity,
         sm.balance_after_value_poisha::text AS balance_after_value_poisha,
         sm.source_type, sm.source_ref, sm.journal_id, j.journal_number,
         sm.reversal_of_movement_id, sm.reversal_reason,
         EXISTS (
           SELECT 1 FROM stock_movements r
            WHERE r.company_id = sm.company_id AND r.reversal_of_movement_id = sm.id
         ) AS is_reversed,
         sm.negative_stock_override,
         sm.override_reason, sm.created_by, u.name AS created_by_name, sm.created_at
    FROM stock_movements sm
    JOIN items i ON i.company_id = sm.company_id AND i.id = sm.item_id
    JOIN warehouses w ON w.company_id = sm.company_id AND w.id = sm.warehouse_id
    JOIN users u ON u.id = sm.created_by
    LEFT JOIN journals j ON j.company_id = sm.company_id AND j.id = sm.journal_id
`;

function mapMovement(row: StockMovementRow): StockMovementDto {
  return {
    id: row.id,
    companyId: row.company_id,
    commandId: row.command_id,
    movementNo: row.movement_no,
    movementType: row.movement_type,
    movementDate: formatDatabaseDate(row.movement_date),
    itemId: row.item_id,
    itemSku: row.item_sku,
    itemName: row.item_name,
    unit: row.unit,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    quantity: row.quantity,
    unitCostPoisha: row.unit_cost_poisha,
    unitCostBdt: formatPoishaAsBdt(row.unit_cost_poisha),
    valuePoisha: row.value_poisha,
    valueBdt: formatPoishaAsBdt(row.value_poisha),
    balanceAfterQuantity: row.balance_after_quantity,
    balanceAfterValuePoisha: row.balance_after_value_poisha,
    balanceAfterValueBdt: formatPoishaAsBdt(row.balance_after_value_poisha),
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalOfMovementId: row.reversal_of_movement_id,
    reversalReason: row.reversal_reason,
    isReversed: row.is_reversed,
    negativeStockOverride: row.negative_stock_override,
    overrideReason: row.override_reason,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

export interface MovementListFilters {
  itemId?: string;
  warehouseId?: string;
  movementType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listStockMovements(
  database: Queryable,
  companyId: string,
  filters: MovementListFilters = {},
): Promise<{ entries: StockMovementDto[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 200);
  const conditions = ['sm.company_id = $1'];
  const values: unknown[] = [companyId];
  if (filters.itemId) {
    values.push(filters.itemId);
    conditions.push(`sm.item_id = $${values.length}`);
  }
  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`sm.warehouse_id = $${values.length}`);
  }
  if (filters.movementType) {
    values.push(filters.movementType);
    conditions.push(`sm.movement_type = $${values.length}`);
  }
  if (filters.from) {
    if (!isValidIsoDate(filters.from)) throw new AppError(400, 'INVALID_DATE', 'Use a real from date.');
    values.push(filters.from);
    conditions.push(`sm.movement_date >= $${values.length}::date`);
  }
  if (filters.to) {
    if (!isValidIsoDate(filters.to)) throw new AppError(400, 'INVALID_DATE', 'Use a real to date.');
    values.push(filters.to);
    conditions.push(`sm.movement_date <= $${values.length}::date`);
  }
  const where = conditions.join(' AND ');
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM stock_movements sm WHERE ${where}`,
    values,
  );
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const rows = await database.query<StockMovementRow>(
    `${MOVEMENT_SELECT} WHERE ${where}
      ORDER BY sm.movement_date DESC, sm.created_at DESC, sm.movement_no ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    entries: rows.rows.map(mapMovement),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

async function loadCommandResult(
  database: Queryable,
  companyId: string,
  commandId: string,
  replayed: boolean,
): Promise<StockCommandResult> {
  const rows = await database.query<StockMovementRow>(
    `${MOVEMENT_SELECT} WHERE sm.company_id = $1 AND sm.command_id = $2 ORDER BY sm.movement_no ASC`,
    [companyId, commandId],
  );
  return { commandId, replayed, movements: rows.rows.map(mapMovement) };
}

export interface BalanceListFilters {
  search?: string;
  warehouseId?: string;
  includeZero?: boolean;
  page?: number;
  pageSize?: number;
}

interface BalanceRow {
  company_id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  unit: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  quantity: string;
  value_poisha: string;
  updated_at: Date;
}

export async function listStockBalances(
  database: Queryable,
  companyId: string,
  filters: BalanceListFilters = {},
): Promise<{ entries: StockBalanceDto[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 200);
  const conditions = ['sb.company_id = $1'];
  const values: unknown[] = [companyId];
  if (!filters.includeZero) conditions.push('(sb.quantity <> 0 OR sb.value_poisha <> 0)');
  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`sb.warehouse_id = $${values.length}`);
  }
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    const index = values.length;
    conditions.push(
      `(i.sku ILIKE $${index} OR i.name_en ILIKE $${index} OR coalesce(i.name_bn, '') ILIKE $${index} OR w.code ILIKE $${index} OR w.name_en ILIKE $${index})`,
    );
  }
  const where = conditions.join(' AND ');
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM stock_balances sb
       JOIN items i ON i.company_id = sb.company_id AND i.id = sb.item_id
       JOIN warehouses w ON w.company_id = sb.company_id AND w.id = sb.warehouse_id
      WHERE ${where}`,
    values,
  );
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const rows = await database.query<BalanceRow>(
    `SELECT sb.company_id, sb.item_id, i.sku AS item_sku, i.name_en AS item_name, i.unit,
            sb.warehouse_id, w.code AS warehouse_code, w.name_en AS warehouse_name,
            sb.quantity::text AS quantity, sb.value_poisha::text AS value_poisha, sb.updated_at
       FROM stock_balances sb
       JOIN items i ON i.company_id = sb.company_id AND i.id = sb.item_id
       JOIN warehouses w ON w.company_id = sb.company_id AND w.id = sb.warehouse_id
      WHERE ${where}
      ORDER BY i.sku ASC, w.code ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
    entries: rows.rows.map((row) => {
      const quantity = parseStoredQuantity(row.quantity);
      const value = BigInt(row.value_poisha);
      return {
        companyId: row.company_id,
        itemId: row.item_id,
        itemSku: row.item_sku,
        itemName: row.item_name,
        unit: row.unit,
        warehouseId: row.warehouse_id,
        warehouseCode: row.warehouse_code,
        warehouseName: row.warehouse_name,
        quantity: formatQuantity(quantity),
        valuePoisha: value.toString(),
        valueBdt: formatPoishaAsBdt(value),
        weightedUnitCostBdt: formatPoishaAsBdt(impliedUnitCostPoisha(quantity, value)),
        updatedAt: row.updated_at.toISOString(),
      };
    }),
  };
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function getInventoryControlProof(
  database: Queryable,
  companyId: string,
  asOfDateInput?: string,
): Promise<InventoryControlProofDto> {
  const asOfDate = asOfDateInput?.trim() || todayIso();
  if (!isValidIsoDate(asOfDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real as-of date in YYYY-MM-DD format.');
  }

  const accounts = await database.query<{
    id: string;
    code: string;
    name_en: string;
  }>(
    `SELECT DISTINCT a.id, a.code, a.name_en
       FROM accounts a
      WHERE a.company_id = $1
        AND (
          a.control_subledger = 'INVENTORY'
          OR EXISTS (
            SELECT 1 FROM items i WHERE i.company_id = a.company_id AND i.inventory_account_id = a.id
          )
        )
      ORDER BY a.code ASC`,
    [companyId],
  );

  const stock = await database.query<{
    item_id: string;
    sku: string;
    name_en: string;
    unit: string;
    inventory_account_id: string;
    inventory_account_code: string;
    warehouse_id: string;
    warehouse_code: string;
    quantity: string;
    value_poisha: string;
  }>(
    `SELECT i.id AS item_id, i.sku, i.name_en, i.unit, i.inventory_account_id,
            a.code AS inventory_account_code, sm.warehouse_id, w.code AS warehouse_code,
            sum(CASE WHEN sm.movement_type IN (
                  'OPENING_RECEIPT', 'GRN_RECEIPT', 'RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'REVERSAL_IN'
                ) THEN sm.quantity ELSE -sm.quantity END)::text AS quantity,
            sum(CASE WHEN sm.movement_type IN (
                  'OPENING_RECEIPT', 'GRN_RECEIPT', 'RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'REVERSAL_IN'
                ) THEN sm.value_poisha ELSE -sm.value_poisha END)::text AS value_poisha
       FROM stock_movements sm
       JOIN items i ON i.company_id = sm.company_id AND i.id = sm.item_id
       JOIN accounts a ON a.company_id = i.company_id AND a.id = i.inventory_account_id
       JOIN warehouses w ON w.company_id = sm.company_id AND w.id = sm.warehouse_id
      WHERE sm.company_id = $1 AND sm.movement_date <= $2::date
      GROUP BY i.id, i.sku, i.name_en, i.unit, i.inventory_account_id, a.code, sm.warehouse_id, w.code
      ORDER BY i.sku ASC, w.code ASC`,
    [companyId, asOfDate],
  );

  const gl = await database.query<{ account_id: string; balance: string }>(
    `SELECT a.id AS account_id,
            coalesce(sum(CASE WHEN j.id IS NOT NULL THEN jl.debit_poisha - jl.credit_poisha ELSE 0 END), 0)::text AS balance
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.company_id = a.company_id AND jl.account_id = a.id
       LEFT JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
            AND j.status IN ('POSTED', 'REVERSED') AND j.posting_date <= $2::date
      WHERE a.company_id = $1
        AND (
          a.control_subledger = 'INVENTORY'
          OR EXISTS (
            SELECT 1 FROM items i WHERE i.company_id = a.company_id AND i.inventory_account_id = a.id
          )
        )
      GROUP BY a.id`,
    [companyId, asOfDate],
  );
  const glByAccount = new Map(gl.rows.map((row) => [row.account_id, BigInt(row.balance)]));

  const stockByAccount = new Map<string, { value: bigint; itemIds: Set<string> }>();
  const itemsById = new Map<
    string,
    {
      itemId: string;
      sku: string;
      nameEn: string;
      unit: string;
      inventoryAccountId: string;
      inventoryAccountCode: string;
      quantity: bigint;
      valuePoisha: bigint;
      warehouses: Array<{ warehouseId: string; warehouseCode: string; quantity: string; valuePoisha: string }>;
    }
  >();
  for (const row of stock.rows) {
    const quantity = parseStoredQuantity(row.quantity);
    const value = BigInt(row.value_poisha);
    const account = stockByAccount.get(row.inventory_account_id) ?? { value: 0n, itemIds: new Set<string>() };
    account.value += value;
    account.itemIds.add(row.item_id);
    stockByAccount.set(row.inventory_account_id, account);
    const item = itemsById.get(row.item_id) ?? {
      itemId: row.item_id,
      sku: row.sku,
      nameEn: row.name_en,
      unit: row.unit,
      inventoryAccountId: row.inventory_account_id,
      inventoryAccountCode: row.inventory_account_code,
      quantity: 0n,
      valuePoisha: 0n,
      warehouses: [],
    };
    item.quantity += quantity;
    item.valuePoisha += value;
    item.warehouses.push({
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      quantity: formatQuantity(quantity),
      valuePoisha: value.toString(),
    });
    itemsById.set(row.item_id, item);
  }

  const accountProof: InventoryControlAccountDto[] = accounts.rows.map((account) => {
    const stockValue = stockByAccount.get(account.id)?.value ?? 0n;
    const glBalance = glByAccount.get(account.id) ?? 0n;
    const difference = stockValue - glBalance;
    return {
      accountId: account.id,
      accountCode: account.code,
      accountNameEn: account.name_en,
      stockValuePoisha: stockValue.toString(),
      stockValueBdt: formatPoishaAsBdt(stockValue),
      glBalancePoisha: glBalance.toString(),
      glBalanceBdt: formatPoishaAsBdt(glBalance),
      differencePoisha: difference.toString(),
      differenceBdt: formatPoishaAsBdt(difference),
      itemCount: stockByAccount.get(account.id)?.itemIds.size ?? 0,
    };
  });

  const itemProof: InventoryControlItemDto[] = Array.from(itemsById.values())
    .filter((item) => item.quantity !== 0n || item.valuePoisha !== 0n)
    .map((item) => ({
      itemId: item.itemId,
      sku: item.sku,
      nameEn: item.nameEn,
      unit: item.unit,
      inventoryAccountId: item.inventoryAccountId,
      inventoryAccountCode: item.inventoryAccountCode,
      quantity: formatQuantity(item.quantity),
      valuePoisha: item.valuePoisha.toString(),
      valueBdt: formatPoishaAsBdt(item.valuePoisha),
      warehouses: item.warehouses,
    }));

  return {
    asOfDate,
    accounts: accountProof,
    items: itemProof,
    differences: accountProof.filter((account) => BigInt(account.differencePoisha) !== 0n),
  };
}

interface ItemRow {
  id: string;
  sku: string;
  name_en: string;
  unit: string;
  is_stock_item: boolean;
  status: string;
  inventory_account_id: string | null;
  expense_account_id: string | null;
}

interface WarehouseRow {
  id: string;
  code: string;
  name_en: string;
  status: string;
}

interface BalanceState {
  quantity: bigint;
  valuePoisha: bigint;
}

async function lockBalance(
  client: PoolClient,
  companyId: string,
  itemId: string,
  warehouseId: string,
): Promise<BalanceState> {
  await client.query(
    `INSERT INTO stock_balances (company_id, item_id, warehouse_id, quantity, value_poisha)
     VALUES ($1,$2,$3,0,0) ON CONFLICT DO NOTHING`,
    [companyId, itemId, warehouseId],
  );
  const result = await client.query<{ quantity: string; value_poisha: string }>(
    `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
       FROM stock_balances
      WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3
      FOR UPDATE`,
    [companyId, itemId, warehouseId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(500, 'STOCK_BALANCE_MISSING', 'The stock balance could not be locked.');
  return { quantity: parseStoredQuantity(row.quantity), valuePoisha: BigInt(row.value_poisha) };
}

async function updateBalance(
  client: PoolClient,
  companyId: string,
  itemId: string,
  warehouseId: string,
  state: BalanceState,
): Promise<void> {
  const result = await client.query(
    `UPDATE stock_balances SET quantity = $4::numeric, value_poisha = $5, updated_at = now()
      WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
    [companyId, itemId, warehouseId, formatQuantity(state.quantity), state.valuePoisha.toString()],
  );
  if (result.rowCount !== 1) {
    throw new AppError(500, 'STOCK_BALANCE_UPDATE_FAILED', 'The stock balance could not be updated.');
  }
}

async function loadItem(client: Queryable, companyId: string, itemId: string, requireActive = true): Promise<ItemRow> {
  const result = await client.query<ItemRow>(
    `SELECT id, sku, name_en, unit, is_stock_item, status, inventory_account_id, expense_account_id
       FROM items WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, itemId],
  );
  const item = result.rows[0];
  if (!item) throw new AppError(404, 'ITEM_NOT_FOUND', 'Item not found.');
  if (requireActive && item.status !== 'ACTIVE') {
    throw new AppError(409, 'ITEM_INACTIVE', 'Inactive items cannot receive stock movements.');
  }
  if (!item.is_stock_item) throw new AppError(400, 'ITEM_NOT_STOCK', 'Only stock items can receive stock movements.');
  if (!item.inventory_account_id || !item.expense_account_id) {
    throw new AppError(409, 'ITEM_STOCK_ACCOUNTS_MISSING', 'The stock item is missing its inventory/expense accounts.');
  }
  return item;
}

async function loadWarehouse(
  client: Queryable,
  companyId: string,
  warehouseId: string,
  requireActive = true,
): Promise<WarehouseRow> {
  const result = await client.query<WarehouseRow>(
    `SELECT id, code, name_en, status FROM warehouses
      WHERE company_id = $1 AND id = $2 FOR SHARE`,
    [companyId, warehouseId],
  );
  const warehouse = result.rows[0];
  if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
  if (requireActive && warehouse.status !== 'ACTIVE') {
    throw new AppError(409, 'WAREHOUSE_INACTIVE', 'Inactive warehouses cannot receive stock movements.');
  }
  return warehouse;
}

async function assertActiveAccount(
  client: Queryable,
  companyId: string,
  accountId: string,
  label: string,
): Promise<{ id: string; code: string; name_en: string }> {
  const result = await client.query<{ id: string; code: string; name_en: string; is_active: boolean }>(
    `SELECT id, code, name_en, is_active FROM accounts WHERE company_id = $1 AND id = $2`,
    [companyId, accountId],
  );
  const account = result.rows[0];
  if (!account) throw new AppError(400, 'STOCK_ACCOUNT_INVALID', `The ${label} must be an account from this company.`);
  if (!account.is_active) throw new AppError(400, 'STOCK_ACCOUNT_INACTIVE', `The ${label} is inactive.`);
  return { id: account.id, code: account.code, name_en: account.name_en };
}

async function loadStockAccounts(
  client: Queryable,
  companyId: string,
  item: ItemRow,
): Promise<{
  inventory: { id: string; code: string; name_en: string };
  expense: { id: string; code: string; name_en: string };
}> {
  const inventory = await assertActiveAccount(client, companyId, item.inventory_account_id!, 'inventory account');
  const expense = await assertActiveAccount(client, companyId, item.expense_account_id!, 'expense/COGS account');
  return { inventory, expense };
}

function parseOptionalCost(value: string | null | undefined): bigint | null {
  if (value === undefined || value === null || !value.trim()) return null;
  const poisha = parseBdtToPoisha(value);
  if (poisha === null || poisha < 0n) {
    throw new AppError(
      400,
      'STOCK_UNIT_COST_INVALID',
      'Unit cost must be a non-negative BDT amount with up to 2 decimals.',
    );
  }
  return poisha;
}

function movementTypeForReceipt(type: StockCommandType): string {
  if (type === 'OPENING') return 'OPENING_RECEIPT';
  if (type === 'GRN') return 'GRN_RECEIPT';
  if (type === 'ADJUSTMENT_IN') return 'ADJUSTMENT_IN';
  return 'RETURN_IN';
}

function sourceTypeFor(type: StockCommandType): string {
  switch (type) {
    case 'OPENING':
      return 'OPENING';
    case 'GRN':
      return 'GRN';
    case 'ISSUE':
      return 'SALES';
    case 'RETURN':
      return 'RETURN';
    case 'TRANSFER':
      return 'TRANSFER';
    case 'ADJUSTMENT_IN':
    case 'ADJUSTMENT_OUT':
      return 'ADJUSTMENT';
  }
}

function narrate(type: StockCommandType, sku: string, warehouseCode: string, reason?: string | null): string {
  const suffix = reason?.trim() ? ` — ${reason.trim()}` : '';
  switch (type) {
    case 'OPENING':
      return `Opening stock — ${sku} at ${warehouseCode}${suffix}`;
    case 'GRN':
      return `Goods received — ${sku} at ${warehouseCode}${suffix}`;
    case 'ISSUE':
      return `Stock issue / COGS — ${sku} at ${warehouseCode}${suffix}`;
    case 'RETURN':
      return `Stock return — ${sku} at ${warehouseCode}${suffix}`;
    case 'TRANSFER':
      return `Stock transfer — ${sku}${suffix}`;
    case 'ADJUSTMENT_IN':
      return `Stock adjustment increase — ${sku} at ${warehouseCode}${suffix}`;
    case 'ADJUSTMENT_OUT':
      return `Stock adjustment decrease — ${sku} at ${warehouseCode}${suffix}`;
  }
}

interface InsertMovementInput {
  id: string;
  companyId: string;
  commandId: string;
  movementNo: number;
  idempotencyKey: string;
  movementType: string;
  movementDate: string;
  itemId: string;
  warehouseId: string;
  quantity: bigint;
  unitCostPoisha: bigint;
  valuePoisha: bigint;
  balanceAfterQuantity: bigint;
  balanceAfterValuePoisha: bigint;
  sourceType: string;
  sourceRef: string | null;
  sourceDocId: string | null;
  journalId: string | null;
  reversalOfMovementId?: string | null;
  reversalReason?: string | null;
  negativeStockOverride: boolean;
  overrideReason: string | null;
  createdBy: string;
}

async function insertMovement(client: PoolClient, input: InsertMovementInput): Promise<void> {
  await client.query(
    `INSERT INTO stock_movements (
       id, company_id, command_id, movement_no, idempotency_key, movement_type, movement_date,
       item_id, warehouse_id, quantity, unit_cost_poisha, value_poisha, balance_after_quantity,
       balance_after_value_poisha, source_type, source_ref, source_doc_id, journal_id,
       reversal_of_movement_id, reversal_reason, negative_stock_override, override_reason, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,$12,$13::numeric,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
     )`,
    [
      input.id,
      input.companyId,
      input.commandId,
      input.movementNo,
      input.idempotencyKey,
      input.movementType,
      input.movementDate,
      input.itemId,
      input.warehouseId,
      formatQuantity(input.quantity),
      input.unitCostPoisha.toString(),
      input.valuePoisha.toString(),
      formatQuantity(input.balanceAfterQuantity),
      input.balanceAfterValuePoisha.toString(),
      input.sourceType,
      input.sourceRef,
      input.sourceDocId,
      input.journalId,
      input.reversalOfMovementId ?? null,
      input.reversalReason ?? null,
      input.negativeStockOverride,
      input.overrideReason,
      input.createdBy,
    ],
  );
}

async function findReplay(client: Queryable, companyId: string, idempotencyKey: string): Promise<string | null> {
  const result = await client.query<{ command_id: string }>(
    `SELECT command_id FROM stock_movements
      WHERE company_id = $1 AND idempotency_key = $2
      LIMIT 1`,
    [companyId, idempotencyKey],
  );
  return result.rows[0]?.command_id ?? null;
}

/**
 * Serialise retries with the same company/idempotency key. The second transaction waits, then sees
 * the first command's committed movement and replays it instead of raising a unique violation.
 */
async function lockIdempotencyKey(client: PoolClient, companyId: string, idempotencyKey: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`stock:${companyId}:${idempotencyKey}`]);
}

function auditBase(input: InventoryAuditContext, companyId: string) {
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

function validateCommandShape(command: StockCommandInput): {
  quantity: bigint;
  sourceRef: string | null;
  overrideReason: string | null;
  reason: string | null;
} {
  if (!isValidIsoDate(command.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real movement date in YYYY-MM-DD format.');
  }
  const quantity = parsePositiveQuantity(command.quantity);
  const sourceRef = command.sourceRef?.trim() || null;
  if (sourceRef && sourceRef.length > 200) {
    throw new AppError(400, 'STOCK_SOURCE_REF_TOO_LONG', 'Source reference must be at most 200 characters.');
  }
  const overrideReason = command.overrideReason?.trim() || null;
  const reason = command.reason?.trim() || null;
  if (reason && (reason.length < 3 || reason.length > 500)) {
    throw new AppError(400, 'STOCK_REASON_INVALID', 'Reason must be between 3 and 500 characters.');
  }
  return { quantity, sourceRef, overrideReason, reason };
}

function requireWarehouse(value: string | null | undefined): string {
  if (!value) throw new AppError(400, 'STOCK_WAREHOUSE_REQUIRED', 'Choose a warehouse.');
  return value;
}

export async function executeStockCommand(
  pool: Pool,
  input: InventoryAuditContext & {
    companyId: string;
    idempotencyKey: string;
    canOverrideNegativeStock: boolean;
    command: StockCommandInput;
  },
): Promise<StockCommandResult> {
  const { command } = input;
  const { quantity, sourceRef, overrideReason, reason } = validateCommandShape(command);
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required for stock commands.',
    );
  }
  const isTransfer = command.type === 'TRANSFER';
  const isReceipt =
    command.type === 'OPENING' ||
    command.type === 'GRN' ||
    command.type === 'RETURN' ||
    command.type === 'ADJUSTMENT_IN';
  const isAdjustment = command.type === 'ADJUSTMENT_IN' || command.type === 'ADJUSTMENT_OUT';
  if (isAdjustment && !reason) {
    throw new AppError(
      400,
      'STOCK_ADJUSTMENT_REASON_REQUIRED',
      'Stock adjustments require a reason of 3–500 characters.',
    );
  }
  if (command.allowNegativeStock && !input.canOverrideNegativeStock) {
    throw new AppError(
      403,
      'NEGATIVE_STOCK_OVERRIDE_FORBIDDEN',
      'Negative stock is disabled by default. A controller with OVERRIDE_NEGATIVE_STOCK must authorise the exception.',
    );
  }
  if (command.allowNegativeStock && (!overrideReason || overrideReason.length < 3 || overrideReason.length > 500)) {
    throw new AppError(
      400,
      'NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED',
      'Negative-stock override requires a reason of 3–500 characters.',
    );
  }

  return withTransaction(pool, async (client) => {
    await lockIdempotencyKey(client, input.companyId, input.idempotencyKey);
    const replay = await findReplay(client, input.companyId, input.idempotencyKey);
    if (replay) return loadCommandResult(client, input.companyId, replay, true);

    const item = await loadItem(client, input.companyId, command.itemId);
    const accounts = await loadStockAccounts(client, input.companyId, item);
    const commandId = randomUUID();
    const journalKey = `STOCK:${commandId}`;

    if (isTransfer) {
      const fromWarehouseId = requireWarehouse(command.fromWarehouseId);
      const toWarehouseId = requireWarehouse(command.toWarehouseId);
      if (fromWarehouseId === toWarehouseId) {
        throw new AppError(400, 'STOCK_TRANSFER_SAME_WAREHOUSE', 'Choose two different warehouses for a transfer.');
      }
      const from = await loadWarehouse(client, input.companyId, fromWarehouseId);
      const to = await loadWarehouse(client, input.companyId, toWarehouseId);
      // Lock both balances in a stable warehouse-id order so opposite transfers cannot deadlock.
      const lockedBalances = new Map<string, BalanceState>();
      for (const warehouseId of [from.id, to.id].sort()) {
        lockedBalances.set(warehouseId, await lockBalance(client, input.companyId, item.id, warehouseId));
      }
      const fromBalance = lockedBalances.get(from.id)!;
      const toBalance = lockedBalances.get(to.id)!;
      const willGoNegative = quantity > fromBalance.quantity;
      if (willGoNegative && !command.allowNegativeStock) {
        throw insufficientStockError(item, from, fromBalance, quantity);
      }
      let value: bigint;
      let unitCost: bigint;
      if (quantity === fromBalance.quantity && fromBalance.quantity > 0n) {
        value = fromBalance.valuePoisha;
        unitCost = impliedUnitCostPoisha(quantity, value);
      } else if (fromBalance.quantity > 0n) {
        value = outboundValuePoisha(quantity, fromBalance.quantity, fromBalance.valuePoisha);
        unitCost = impliedUnitCostPoisha(quantity, value);
      } else {
        unitCost = impliedUnitCostPoisha(fromBalance.quantity, fromBalance.valuePoisha);
        if (unitCost === 0n && fromBalance.valuePoisha === 0n) {
          throw new AppError(
            409,
            'STOCK_COST_REQUIRED',
            'The source warehouse has no stock value. Post a valuation adjustment before transferring this item.',
          );
        }
        value = receiptValuePoisha(quantity, unitCost);
      }
      const negativeOverride = willGoNegative;
      const sourceAfter: BalanceState = {
        quantity: fromBalance.quantity - quantity,
        valuePoisha: fromBalance.valuePoisha - value,
      };
      const destinationAfter: BalanceState = {
        quantity: toBalance.quantity + quantity,
        valuePoisha: toBalance.valuePoisha + value,
      };
      const outId = randomUUID();
      const inId = randomUUID();
      await insertMovement(client, {
        id: outId,
        companyId: input.companyId,
        commandId,
        movementNo: 1,
        idempotencyKey: input.idempotencyKey,
        movementType: 'TRANSFER_OUT',
        movementDate: command.date,
        itemId: item.id,
        warehouseId: from.id,
        quantity,
        unitCostPoisha: unitCost,
        valuePoisha: value,
        balanceAfterQuantity: sourceAfter.quantity,
        balanceAfterValuePoisha: sourceAfter.valuePoisha,
        sourceType: 'TRANSFER',
        sourceRef,
        sourceDocId: outId,
        journalId: null,
        negativeStockOverride: negativeOverride,
        overrideReason: negativeOverride ? overrideReason : null,
        createdBy: input.actorUserId,
      });
      await insertMovement(client, {
        id: inId,
        companyId: input.companyId,
        commandId,
        movementNo: 2,
        idempotencyKey: input.idempotencyKey,
        movementType: 'TRANSFER_IN',
        movementDate: command.date,
        itemId: item.id,
        warehouseId: to.id,
        quantity,
        unitCostPoisha: impliedUnitCostPoisha(quantity, value),
        valuePoisha: value,
        balanceAfterQuantity: destinationAfter.quantity,
        balanceAfterValuePoisha: destinationAfter.valuePoisha,
        sourceType: 'TRANSFER',
        sourceRef,
        sourceDocId: inId,
        journalId: null,
        negativeStockOverride: false,
        overrideReason: null,
        createdBy: input.actorUserId,
      });
      await updateBalance(client, input.companyId, item.id, from.id, sourceAfter);
      await updateBalance(client, input.companyId, item.id, to.id, destinationAfter);
      await writeAuditEvent(client, {
        ...auditBase(input, input.companyId),
        action: 'stock.transferred',
        entityType: 'stock_command',
        entityId: commandId,
        after: {
          itemId: item.id,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          quantity: formatQuantity(quantity),
          valuePoisha: value.toString(),
          negativeStockOverride: negativeOverride,
          overrideReason: negativeOverride ? overrideReason : null,
        },
        reason: reason ?? 'Stock transferred between warehouses.',
      });
      return loadCommandResult(client, input.companyId, commandId, false);
    }

    const warehouseId = requireWarehouse(command.warehouseId);
    const warehouse = await loadWarehouse(client, input.companyId, warehouseId);
    const balance = await lockBalance(client, input.companyId, item.id, warehouse.id);
    const providedCost = parseOptionalCost(command.unitCost);
    let value: bigint;
    let unitCost: bigint;
    let negativeOverride = false;
    let newQuantity: bigint;
    let newValue: bigint;

    if (isReceipt) {
      if (command.type === 'OPENING' || command.type === 'GRN') {
        if (providedCost === null) {
          throw new AppError(
            400,
            'STOCK_UNIT_COST_REQUIRED',
            'Opening stock and GRN receipts require a unit cost so the inventory value is known.',
          );
        }
        unitCost = providedCost;
      } else if (providedCost !== null) {
        unitCost = providedCost;
      } else if (balance.quantity !== 0n) {
        unitCost = impliedUnitCostPoisha(balance.quantity, balance.valuePoisha);
      } else {
        throw new AppError(
          409,
          'STOCK_COST_REQUIRED',
          'This warehouse has no stock value. Provide a unit cost for the return or adjustment.',
        );
      }
      value = receiptValuePoisha(quantity, unitCost);
      newQuantity = balance.quantity + quantity;
      newValue = balance.valuePoisha + value;
    } else {
      const willGoNegative = quantity > balance.quantity;
      if (willGoNegative && !command.allowNegativeStock) {
        throw insufficientStockError(item, warehouse, balance, quantity);
      }
      negativeOverride = willGoNegative;
      if (quantity === balance.quantity && balance.quantity > 0n) {
        value = balance.valuePoisha;
        unitCost = impliedUnitCostPoisha(quantity, value);
      } else if (balance.quantity > 0n) {
        value = outboundValuePoisha(quantity, balance.quantity, balance.valuePoisha);
        unitCost = impliedUnitCostPoisha(quantity, value);
      } else {
        if (providedCost !== null) {
          unitCost = providedCost;
        } else {
          unitCost = impliedUnitCostPoisha(balance.quantity, balance.valuePoisha);
          if (unitCost === 0n && balance.valuePoisha === 0n) {
            throw new AppError(
              409,
              'STOCK_COST_REQUIRED',
              'The warehouse has no stock value. Provide a unit cost with the negative-stock override.',
            );
          }
        }
        value = receiptValuePoisha(quantity, unitCost);
      }
      newQuantity = balance.quantity - quantity;
      newValue = balance.valuePoisha - value;
    }

    const movementId = randomUUID();
    let journalId: string | null = null;
    if (value > 0n) {
      const lines = isReceipt
        ? [
            {
              accountId: accounts.inventory.id,
              debit: formatPoishaAsBdt(value),
              credit: '0',
              memo: `${item.sku} ${formatQuantity(quantity)} ${item.unit}`,
            },
            {
              accountId:
                command.type === 'RETURN'
                  ? accounts.expense.id
                  : await resolveOffsetAccount(client, input.companyId, command.offsetAccountId, accounts.inventory.id),
              debit: '0',
              credit: formatPoishaAsBdt(value),
              memo: `${item.sku} ${formatQuantity(quantity)} ${item.unit}`,
            },
          ]
        : [
            {
              accountId:
                command.type === 'ADJUSTMENT_OUT'
                  ? await resolveOffsetAccount(client, input.companyId, command.offsetAccountId, accounts.inventory.id)
                  : accounts.expense.id,
              debit: formatPoishaAsBdt(value),
              credit: '0',
              memo: `${item.sku} ${formatQuantity(quantity)} ${item.unit}`,
            },
            {
              accountId: accounts.inventory.id,
              debit: '0',
              credit: formatPoishaAsBdt(value),
              memo: `${item.sku} ${formatQuantity(quantity)} ${item.unit}`,
            },
          ];
      const journal = await postSystemJournalWithinTransaction(client, {
        ...input,
        companyId: input.companyId,
        date: command.date,
        narration: narrate(command.type, item.sku, warehouse.code, reason),
        sourceModule: 'INVENTORY',
        sourceDocId: movementId,
        sourceDocRef: sourceRef,
        idempotencyKey: journalKey,
        lines,
      });
      journalId = journal.id;
    }

    await insertMovement(client, {
      id: movementId,
      companyId: input.companyId,
      commandId,
      movementNo: 1,
      idempotencyKey: input.idempotencyKey,
      movementType: isReceipt
        ? movementTypeForReceipt(command.type)
        : command.type === 'ADJUSTMENT_OUT'
          ? 'ADJUSTMENT_OUT'
          : 'ISSUE',
      movementDate: command.date,
      itemId: item.id,
      warehouseId: warehouse.id,
      quantity,
      unitCostPoisha: unitCost,
      valuePoisha: value,
      balanceAfterQuantity: newQuantity,
      balanceAfterValuePoisha: newValue,
      sourceType: sourceTypeFor(command.type),
      sourceRef,
      sourceDocId: movementId,
      journalId,
      negativeStockOverride: negativeOverride,
      overrideReason: negativeOverride ? overrideReason : null,
      createdBy: input.actorUserId,
    });
    await updateBalance(client, input.companyId, item.id, warehouse.id, {
      quantity: newQuantity,
      valuePoisha: newValue,
    });
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action:
        command.type === 'ISSUE'
          ? 'stock.issued'
          : command.type === 'RETURN'
            ? 'stock.returned'
            : command.type === 'ADJUSTMENT_IN' || command.type === 'ADJUSTMENT_OUT'
              ? 'stock.adjusted'
              : command.type === 'OPENING'
                ? 'stock.opening_recorded'
                : 'stock.received',
      entityType: 'stock_command',
      entityId: commandId,
      after: {
        itemId: item.id,
        warehouseId: warehouse.id,
        movementType: isReceipt ? movementTypeForReceipt(command.type) : command.type,
        quantity: formatQuantity(quantity),
        valuePoisha: value.toString(),
        journalId,
        negativeStockOverride: negativeOverride,
        overrideReason: negativeOverride ? overrideReason : null,
      },
      reason: reason ?? overrideReason ?? 'Stock movement recorded through the inventory service.',
    });
    return loadCommandResult(client, input.companyId, commandId, false);
  });
}

async function resolveOffsetAccount(
  client: Queryable,
  companyId: string,
  accountId: string | null | undefined,
  inventoryAccountId: string,
): Promise<string> {
  if (!accountId) {
    throw new AppError(400, 'STOCK_OFFSET_ACCOUNT_REQUIRED', 'Choose the other side of the inventory journal.');
  }
  if (accountId === inventoryAccountId) {
    throw new AppError(400, 'STOCK_OFFSET_ACCOUNT_INVALID', 'The offset account cannot be the item inventory account.');
  }
  const account = await assertActiveAccount(client, companyId, accountId, 'offset account');
  return account.id;
}

function insufficientStockError(
  item: ItemRow,
  warehouse: WarehouseRow,
  balance: BalanceState,
  requested: bigint,
): AppError {
  return new AppError(
    409,
    'STOCK_INSUFFICIENT',
    `Insufficient stock for ${item.sku} at ${warehouse.code}: requested ${formatQuantity(requested)} ${item.unit}, available ${formatQuantity(balance.quantity)} ${item.unit}. Negative stock is blocked unless a controller explicitly overrides it with a reason.`,
    {
      itemId: item.id,
      sku: item.sku,
      warehouseId: warehouse.id,
      warehouseCode: warehouse.code,
      requestedQuantity: formatQuantity(requested),
      availableQuantity: formatQuantity(balance.quantity),
      unit: item.unit,
    },
  );
}

export interface ReverseStockCommandInput extends InventoryAuditContext {
  companyId: string;
  commandId: string;
  date: string;
  reason: string;
  idempotencyKey: string;
  canOverrideNegativeStock: boolean;
  overrideReason?: string | null;
}

interface OriginalMovementRow {
  id: string;
  movement_type: string;
  item_id: string;
  warehouse_id: string;
  quantity: string;
  unit_cost_poisha: string;
  value_poisha: string;
  source_type: string;
  source_ref: string | null;
  journal_id: string | null;
  reversal_of_movement_id: string | null;
  created_by: string;
}

export async function reverseStockCommand(pool: Pool, input: ReverseStockCommandInput): Promise<StockCommandResult> {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'STOCK_REVERSAL_REASON_REQUIRED', 'A reversal reason of 3–500 characters is required.');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'A valid Idempotency-Key header is required.');
  }
  const overrideReason = input.overrideReason?.trim() || null;
  if (overrideReason && (overrideReason.length < 3 || overrideReason.length > 500)) {
    throw new AppError(400, 'NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED', 'Override reason must be 3–500 characters.');
  }

  return withTransaction(pool, async (client) => {
    await lockIdempotencyKey(client, input.companyId, input.idempotencyKey);
    const replay = await findReplay(client, input.companyId, input.idempotencyKey);
    if (replay) return loadCommandResult(client, input.companyId, replay, true);

    const original = await client.query<OriginalMovementRow>(
      `SELECT id, movement_type, item_id, warehouse_id, quantity::text AS quantity,
              unit_cost_poisha::text AS unit_cost_poisha, value_poisha::text AS value_poisha,
              source_type, source_ref, journal_id, reversal_of_movement_id, created_by
         FROM stock_movements
        WHERE company_id = $1 AND command_id = $2
        ORDER BY movement_no ASC`,
      [input.companyId, input.commandId],
    );
    if (original.rows.length === 0) {
      throw new AppError(404, 'STOCK_COMMAND_NOT_FOUND', 'Stock command not found.');
    }
    if (original.rows.some((row) => row.reversal_of_movement_id)) {
      throw new AppError(
        409,
        'REVERSAL_OF_REVERSAL',
        'A stock reversal cannot itself be reversed. Post a new correcting movement instead.',
      );
    }
    const alreadyReversed = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_movements
        WHERE company_id = $1 AND reversal_of_movement_id = ANY($2::uuid[])`,
      [input.companyId, original.rows.map((row) => row.id)],
    );
    if (Number(alreadyReversed.rows[0]?.count ?? 0) > 0) {
      throw new AppError(409, 'STOCK_ALREADY_REVERSED', 'That stock command has already been reversed.');
    }

    const item = await loadItem(client, input.companyId, original.rows[0]!.item_id, false);
    const journalIds = new Set(original.rows.map((row) => row.journal_id).filter((id): id is string => Boolean(id)));
    if (journalIds.size > 1) {
      throw new AppError(
        409,
        'STOCK_REVERSAL_JOURNAL_AMBIGUOUS',
        'This stock command touches more than one inventory journal and cannot be reversed as a single command.',
      );
    }

    const reversalCommandId = randomUUID();
    const originalJournalId = Array.from(journalIds)[0] ?? null;

    const balances = new Map<string, BalanceState>();
    for (const warehouseId of [...new Set(original.rows.map((row) => row.warehouse_id))].sort()) {
      balances.set(warehouseId, await lockBalance(client, input.companyId, item.id, warehouseId));
    }

    // Validate and value the whole reversal before touching the original journal. Lock order is
    // balance rows first, matching the forward stock command, to avoid reversal/posting deadlocks.
    const plans: Array<{
      row: OriginalMovementRow;
      reversalType: string;
      quantity: bigint;
      value: bigint;
      newQuantity: bigint;
      newValue: bigint;
      negativeOverride: boolean;
    }> = [];
    for (const row of original.rows) {
      const warehouse = await loadWarehouse(client, input.companyId, row.warehouse_id, false);
      const balance = balances.get(row.warehouse_id)!;
      const quantity = parseStoredQuantity(row.quantity);
      const value = BigInt(row.value_poisha);
      const originalWasReceipt = isReceiptMovement(row.movement_type);
      const reversalType = originalWasReceipt ? 'REVERSAL_OUT' : 'REVERSAL_IN';
      const reversalIsReceipt = !originalWasReceipt;
      let negativeOverride = false;
      if (!reversalIsReceipt && quantity > balance.quantity) {
        if (!input.canOverrideNegativeStock) {
          throw insufficientStockError(item, warehouse, balance, quantity);
        }
        if (!overrideReason) {
          throw new AppError(
            400,
            'NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED',
            'Reversing this receipt would create negative stock. Provide an override reason.',
          );
        }
        negativeOverride = true;
      }
      const newQuantity = reversalIsReceipt ? balance.quantity + quantity : balance.quantity - quantity;
      const newValue = reversalIsReceipt ? balance.valuePoisha + value : balance.valuePoisha - value;
      balances.set(row.warehouse_id, { quantity: newQuantity, valuePoisha: newValue });
      plans.push({ row, reversalType, quantity, value, newQuantity, newValue, negativeOverride });
    }

    let reversalJournalId: string | null = null;
    if (originalJournalId) {
      const reversed = await reverseJournalWithinTransaction(client, {
        ...input,
        companyId: input.companyId,
        journalId: originalJournalId,
        date: input.date,
        reason,
      });
      reversalJournalId = reversed.reversal.id;
    }

    for (const [index, plan] of plans.entries()) {
      const movementId = randomUUID();
      await insertMovement(client, {
        id: movementId,
        companyId: input.companyId,
        commandId: reversalCommandId,
        movementNo: index + 1,
        idempotencyKey: input.idempotencyKey,
        movementType: plan.reversalType,
        movementDate: input.date,
        itemId: item.id,
        warehouseId: plan.row.warehouse_id,
        quantity: plan.quantity,
        unitCostPoisha: BigInt(plan.row.unit_cost_poisha),
        valuePoisha: plan.value,
        balanceAfterQuantity: plan.newQuantity,
        balanceAfterValuePoisha: plan.newValue,
        sourceType: 'REVERSAL',
        sourceRef: plan.row.source_ref,
        sourceDocId: plan.row.id,
        journalId: reversalJournalId,
        reversalOfMovementId: plan.row.id,
        reversalReason: reason,
        negativeStockOverride: plan.negativeOverride,
        overrideReason: plan.negativeOverride ? overrideReason : null,
        createdBy: input.actorUserId,
      });
    }

    for (const [warehouseId, state] of balances.entries()) {
      await updateBalance(client, input.companyId, item.id, warehouseId, state);
    }

    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'stock.command.reversed',
      entityType: 'stock_command',
      entityId: input.commandId,
      before: { commandId: input.commandId },
      after: {
        reversalCommandId,
        reversalJournalId,
        movementIds: original.rows.map((row) => row.id),
        reason,
      },
      reason,
    });
    return loadCommandResult(client, input.companyId, reversalCommandId, false);
  });
}

function isReceiptMovement(type: string): boolean {
  return (
    type === 'OPENING_RECEIPT' ||
    type === 'GRN_RECEIPT' ||
    type === 'RETURN_IN' ||
    type === 'TRANSFER_IN' ||
    type === 'ADJUSTMENT_IN' ||
    type === 'REVERSAL_IN'
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sales-document stock integration.
 *
 * A sales invoice posts one combined journal (AR / revenue / VAT / COGS / inventory), so the stock
 * movement and that journal must share the same transaction without creating a second inventory
 * journal. These helpers plan valuation under row locks, then apply movements only after the sales
 * journal has been posted. They deliberately do not expose a public HTTP command.
 * ---------------------------------------------------------------------------------------------- */

export interface SalesStockIssueLineInput {
  lineId: string;
  itemId: string;
  warehouseId: string;
  /** Quantity in ten-thousandths. */
  quantity: bigint;
}

export interface SalesStockIssuePlanLine {
  lineId: string;
  itemId: string;
  warehouseId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  inventoryAccountId: string;
  cogsAccountId: string;
  quantity: bigint;
  unitCostPoisha: bigint;
  valuePoisha: bigint;
  balanceAfterQuantity: bigint;
  balanceAfterValuePoisha: bigint;
}

export interface SalesStockIssuePlan {
  lines: SalesStockIssuePlanLine[];
  totalValuePoisha: bigint;
}

export async function planSalesStockIssue(
  client: PoolClient,
  companyId: string,
  lines: readonly SalesStockIssueLineInput[],
): Promise<SalesStockIssuePlan> {
  if (lines.length === 0) return { lines: [], totalValuePoisha: 0n };
  const itemCache = new Map<string, ItemRow>();
  const warehouseCache = new Map<string, WarehouseRow>();
  const accountCache = new Map<string, { inventory: string; cogs: string }>();
  const balanceKeys = [...new Set(lines.map((line) => `${line.itemId}|${line.warehouseId}`))].sort();
  const balances = new Map<string, BalanceState>();
  for (const key of balanceKeys) {
    const [itemId, warehouseId] = key.split('|');
    balances.set(key, await lockBalance(client, companyId, itemId!, warehouseId!));
  }

  const planLines: SalesStockIssuePlanLine[] = [];
  let totalValuePoisha = 0n;
  for (const line of lines) {
    let item = itemCache.get(line.itemId);
    if (!item) {
      item = await loadItem(client, companyId, line.itemId);
      itemCache.set(item.id, item);
    }
    let warehouse = warehouseCache.get(line.warehouseId);
    if (!warehouse) {
      warehouse = await loadWarehouse(client, companyId, line.warehouseId);
      warehouseCache.set(warehouse.id, warehouse);
    }
    let accounts = accountCache.get(item.id);
    if (!accounts) {
      const stockAccounts = await loadStockAccounts(client, companyId, item);
      accounts = { inventory: stockAccounts.inventory.id, cogs: stockAccounts.expense.id };
      accountCache.set(item.id, accounts);
    }
    const key = `${item.id}|${warehouse.id}`;
    const balance = balances.get(key)!;
    if (line.quantity > balance.quantity) {
      throw insufficientStockError(item, warehouse, balance, line.quantity);
    }
    const valuePoisha =
      line.quantity === balance.quantity && balance.quantity > 0n
        ? balance.valuePoisha
        : outboundValuePoisha(line.quantity, balance.quantity, balance.valuePoisha);
    const after: BalanceState = {
      quantity: balance.quantity - line.quantity,
      valuePoisha: balance.valuePoisha - valuePoisha,
    };
    balances.set(key, after);
    totalValuePoisha += valuePoisha;
    planLines.push({
      lineId: line.lineId,
      itemId: item.id,
      warehouseId: warehouse.id,
      itemSku: item.sku,
      itemName: item.name_en,
      unit: item.unit,
      inventoryAccountId: accounts.inventory,
      cogsAccountId: accounts.cogs,
      quantity: line.quantity,
      unitCostPoisha: impliedUnitCostPoisha(line.quantity, valuePoisha),
      valuePoisha,
      balanceAfterQuantity: after.quantity,
      balanceAfterValuePoisha: after.valuePoisha,
    });
  }
  return { lines: planLines, totalValuePoisha };
}

export async function applySalesStockIssue(
  client: PoolClient,
  input: {
    companyId: string;
    documentId: string;
    documentNo: string;
    date: string;
    journalId: string;
    actorUserId: string;
    plan: SalesStockIssuePlan;
  },
): Promise<Map<string, string>> {
  const movementIds = new Map<string, string>();
  for (const [index, line] of input.plan.lines.entries()) {
    const movementId = randomUUID();
    await insertMovement(client, {
      id: movementId,
      companyId: input.companyId,
      commandId: input.documentId,
      movementNo: index + 1,
      idempotencyKey: `SALES:${input.documentId}`,
      movementType: 'ISSUE',
      movementDate: input.date,
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitCostPoisha: line.unitCostPoisha,
      valuePoisha: line.valuePoisha,
      balanceAfterQuantity: line.balanceAfterQuantity,
      balanceAfterValuePoisha: line.balanceAfterValuePoisha,
      sourceType: 'SALES',
      sourceRef: input.documentNo,
      sourceDocId: input.documentId,
      journalId: input.journalId,
      negativeStockOverride: false,
      overrideReason: null,
      createdBy: input.actorUserId,
    });
    await updateBalance(client, input.companyId, line.itemId, line.warehouseId, {
      quantity: line.balanceAfterQuantity,
      valuePoisha: line.balanceAfterValuePoisha,
    });
    movementIds.set(line.lineId, movementId);
  }
  return movementIds;
}

export interface SalesStockReturnLineInput {
  lineId: string;
  itemId: string;
  warehouseId: string;
  quantity: bigint;
  originalQuantity: bigint;
  originalValuePoisha: bigint;
  originalMovementId: string;
}

export interface SalesStockReturnPlanLine {
  lineId: string;
  itemId: string;
  warehouseId: string;
  itemSku: string;
  unit: string;
  inventoryAccountId: string;
  cogsAccountId: string;
  quantity: bigint;
  unitCostPoisha: bigint;
  valuePoisha: bigint;
  balanceAfterQuantity: bigint;
  balanceAfterValuePoisha: bigint;
  originalMovementId: string;
}

export interface SalesStockReturnPlan {
  lines: SalesStockReturnPlanLine[];
  totalValuePoisha: bigint;
}

/**
 * Credit notes restore the original issue cost, not the current weighted average. A partial return
 * takes a deterministic proportion of the original movement value so a full return restores it
 * exactly.
 */
export async function planSalesStockReturn(
  client: PoolClient,
  companyId: string,
  lines: readonly SalesStockReturnLineInput[],
): Promise<SalesStockReturnPlan> {
  if (lines.length === 0) return { lines: [], totalValuePoisha: 0n };
  const itemCache = new Map<string, ItemRow>();
  const warehouseCache = new Map<string, WarehouseRow>();
  const accountCache = new Map<string, { inventory: string; cogs: string }>();
  const balanceKeys = [...new Set(lines.map((line) => `${line.itemId}|${line.warehouseId}`))].sort();
  const balances = new Map<string, BalanceState>();
  for (const key of balanceKeys) {
    const [itemId, warehouseId] = key.split('|');
    balances.set(key, await lockBalance(client, companyId, itemId!, warehouseId!));
  }

  const planLines: SalesStockReturnPlanLine[] = [];
  let totalValuePoisha = 0n;
  for (const line of lines) {
    if (line.originalQuantity <= 0n) {
      throw new AppError(409, 'SALES_ORIGINAL_LINE_INVALID', 'The original sale line has no returnable quantity.');
    }
    let item = itemCache.get(line.itemId);
    if (!item) {
      // A return may target an item that has since been deactivated; the original sale history is
      // still valid and the stock must be restored to the original warehouse.
      item = await loadItem(client, companyId, line.itemId, false);
      itemCache.set(item.id, item);
    }
    let warehouse = warehouseCache.get(line.warehouseId);
    if (!warehouse) {
      warehouse = await loadWarehouse(client, companyId, line.warehouseId, false);
      warehouseCache.set(warehouse.id, warehouse);
    }
    let accounts = accountCache.get(item.id);
    if (!accounts) {
      const stockAccounts = await loadStockAccounts(client, companyId, item);
      accounts = { inventory: stockAccounts.inventory.id, cogs: stockAccounts.expense.id };
      accountCache.set(item.id, accounts);
    }
    const valuePoisha =
      line.quantity === line.originalQuantity
        ? line.originalValuePoisha
        : divideRoundHalfUp(line.originalValuePoisha * line.quantity, line.originalQuantity);
    const key = `${item.id}|${warehouse.id}`;
    const balance = balances.get(key)!;
    const after: BalanceState = {
      quantity: balance.quantity + line.quantity,
      valuePoisha: balance.valuePoisha + valuePoisha,
    };
    balances.set(key, after);
    totalValuePoisha += valuePoisha;
    planLines.push({
      lineId: line.lineId,
      itemId: item.id,
      warehouseId: warehouse.id,
      itemSku: item.sku,
      unit: item.unit,
      inventoryAccountId: accounts.inventory,
      cogsAccountId: accounts.cogs,
      quantity: line.quantity,
      unitCostPoisha: impliedUnitCostPoisha(line.quantity, valuePoisha),
      valuePoisha,
      balanceAfterQuantity: after.quantity,
      balanceAfterValuePoisha: after.valuePoisha,
      originalMovementId: line.originalMovementId,
    });
  }
  return { lines: planLines, totalValuePoisha };
}

export async function applySalesStockReturn(
  client: PoolClient,
  input: {
    companyId: string;
    documentId: string;
    documentNo: string;
    date: string;
    journalId: string;
    actorUserId: string;
    plan: SalesStockReturnPlan;
  },
): Promise<Map<string, string>> {
  const movementIds = new Map<string, string>();
  for (const [index, line] of input.plan.lines.entries()) {
    const movementId = randomUUID();
    await insertMovement(client, {
      id: movementId,
      companyId: input.companyId,
      commandId: input.documentId,
      movementNo: index + 1,
      idempotencyKey: `CREDIT:${input.documentId}`,
      movementType: 'RETURN_IN',
      movementDate: input.date,
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitCostPoisha: line.unitCostPoisha,
      valuePoisha: line.valuePoisha,
      balanceAfterQuantity: line.balanceAfterQuantity,
      balanceAfterValuePoisha: line.balanceAfterValuePoisha,
      sourceType: 'RETURN',
      sourceRef: input.documentNo,
      sourceDocId: input.documentId,
      journalId: input.journalId,
      negativeStockOverride: false,
      overrideReason: null,
      createdBy: input.actorUserId,
    });
    await updateBalance(client, input.companyId, line.itemId, line.warehouseId, {
      quantity: line.balanceAfterQuantity,
      valuePoisha: line.balanceAfterValuePoisha,
    });
    movementIds.set(line.lineId, movementId);
  }
  return movementIds;
}

export interface PurchaseStockReceiptLineInput {
  lineId: string;
  itemId: string;
  warehouseId: string;
  /** Quantity in ten-thousandths. */
  quantity: bigint;
  /**
   * Inventory value to capitalise, including any disallowed input VAT. The purchase service
   * calculates this from the line cost so the stock ledger and inventory GL agree.
   */
  valuePoisha: bigint;
}

export interface PurchaseStockReceiptPlanLine {
  lineId: string;
  itemId: string;
  warehouseId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  inventoryAccountId: string;
  quantity: bigint;
  unitCostPoisha: bigint;
  valuePoisha: bigint;
  balanceAfterQuantity: bigint;
  balanceAfterValuePoisha: bigint;
}

export interface PurchaseStockReceiptPlan {
  lines: PurchaseStockReceiptPlanLine[];
  totalValuePoisha: bigint;
}

/**
 * Plans a goods receipt for a posted purchase bill. A stock line on the bill is the receipt event
 * because this release does not model a separate GRN document. The weighted-average balance is
 * locked before the journal is posted so concurrent receipts cannot overwrite each other.
 */
export async function planPurchaseStockReceipt(
  client: PoolClient,
  companyId: string,
  lines: readonly PurchaseStockReceiptLineInput[],
): Promise<PurchaseStockReceiptPlan> {
  if (lines.length === 0) return { lines: [], totalValuePoisha: 0n };
  const itemCache = new Map<string, ItemRow>();
  const warehouseCache = new Map<string, WarehouseRow>();
  const accountCache = new Map<string, string>();
  const balanceKeys = [...new Set(lines.map((line) => `${line.itemId}|${line.warehouseId}`))].sort();
  const balances = new Map<string, BalanceState>();
  for (const key of balanceKeys) {
    const [itemId, warehouseId] = key.split('|');
    balances.set(key, await lockBalance(client, companyId, itemId!, warehouseId!));
  }

  const planLines: PurchaseStockReceiptPlanLine[] = [];
  let totalValuePoisha = 0n;
  for (const line of lines) {
    if (line.quantity <= 0n || line.valuePoisha < 0n) {
      throw new AppError(
        400,
        'PURCHASE_STOCK_VALUE_INVALID',
        'A purchase stock line needs a positive quantity and non-negative value.',
      );
    }
    let item = itemCache.get(line.itemId);
    if (!item) {
      item = await loadItem(client, companyId, line.itemId);
      itemCache.set(item.id, item);
    }
    let warehouse = warehouseCache.get(line.warehouseId);
    if (!warehouse) {
      warehouse = await loadWarehouse(client, companyId, line.warehouseId);
      warehouseCache.set(warehouse.id, warehouse);
    }
    let inventoryAccountId = accountCache.get(item.id);
    if (!inventoryAccountId) {
      const stockAccounts = await loadStockAccounts(client, companyId, item);
      inventoryAccountId = stockAccounts.inventory.id;
      accountCache.set(item.id, inventoryAccountId);
    }
    const key = `${item.id}|${warehouse.id}`;
    const balance = balances.get(key)!;
    const after: BalanceState = {
      quantity: balance.quantity + line.quantity,
      valuePoisha: balance.valuePoisha + line.valuePoisha,
    };
    balances.set(key, after);
    totalValuePoisha += line.valuePoisha;
    planLines.push({
      lineId: line.lineId,
      itemId: item.id,
      warehouseId: warehouse.id,
      itemSku: item.sku,
      itemName: item.name_en,
      unit: item.unit,
      inventoryAccountId,
      quantity: line.quantity,
      unitCostPoisha: impliedUnitCostPoisha(line.quantity, line.valuePoisha),
      valuePoisha: line.valuePoisha,
      balanceAfterQuantity: after.quantity,
      balanceAfterValuePoisha: after.valuePoisha,
    });
  }
  return { lines: planLines, totalValuePoisha };
}

export async function applyPurchaseStockReceipt(
  client: PoolClient,
  input: {
    companyId: string;
    documentId: string;
    documentNo: string;
    date: string;
    journalId: string;
    actorUserId: string;
    plan: PurchaseStockReceiptPlan;
  },
): Promise<Map<string, string>> {
  const movementIds = new Map<string, string>();
  for (const [index, line] of input.plan.lines.entries()) {
    const movementId = randomUUID();
    await insertMovement(client, {
      id: movementId,
      companyId: input.companyId,
      commandId: input.documentId,
      movementNo: index + 1,
      idempotencyKey: `PURCHASE:${input.documentId}`,
      movementType: 'GRN_RECEIPT',
      movementDate: input.date,
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitCostPoisha: line.unitCostPoisha,
      valuePoisha: line.valuePoisha,
      balanceAfterQuantity: line.balanceAfterQuantity,
      balanceAfterValuePoisha: line.balanceAfterValuePoisha,
      sourceType: 'GRN',
      sourceRef: input.documentNo,
      sourceDocId: input.documentId,
      journalId: input.journalId,
      negativeStockOverride: false,
      overrideReason: null,
      createdBy: input.actorUserId,
    });
    await updateBalance(client, input.companyId, line.itemId, line.warehouseId, {
      quantity: line.balanceAfterQuantity,
      valuePoisha: line.balanceAfterValuePoisha,
    });
    movementIds.set(line.lineId, movementId);
  }
  return movementIds;
}

export interface SalesStockReversalMovementInput {
  movementId: string;
  itemId: string;
  warehouseId: string;
  quantity: bigint;
  unitCostPoisha: bigint;
  valuePoisha: bigint;
  movementType: string;
}

export interface SalesStockReversalPlanLine extends SalesStockReversalMovementInput {
  reversalType: 'REVERSAL_IN' | 'REVERSAL_OUT';
  balanceAfterQuantity: bigint;
  balanceAfterValuePoisha: bigint;
}

export interface SalesStockReversalPlan {
  lines: SalesStockReversalPlanLine[];
}

export async function planSalesStockReversal(
  client: PoolClient,
  companyId: string,
  movements: readonly SalesStockReversalMovementInput[],
): Promise<SalesStockReversalPlan> {
  if (movements.length === 0) return { lines: [] };
  const itemCache = new Map<string, ItemRow>();
  const warehouseCache = new Map<string, WarehouseRow>();
  const balanceKeys = [...new Set(movements.map((line) => `${line.itemId}|${line.warehouseId}`))].sort();
  const balances = new Map<string, BalanceState>();
  for (const key of balanceKeys) {
    const [itemId, warehouseId] = key.split('|');
    balances.set(key, await lockBalance(client, companyId, itemId!, warehouseId!));
  }

  const lines: SalesStockReversalPlanLine[] = [];
  for (const movement of movements) {
    let item = itemCache.get(movement.itemId);
    if (!item) {
      item = await loadItem(client, companyId, movement.itemId, false);
      itemCache.set(item.id, item);
    }
    let warehouse = warehouseCache.get(movement.warehouseId);
    if (!warehouse) {
      warehouse = await loadWarehouse(client, companyId, movement.warehouseId, false);
      warehouseCache.set(warehouse.id, warehouse);
    }
    const key = `${item.id}|${warehouse.id}`;
    const balance = balances.get(key)!;
    const reversalIsReceipt = !isReceiptMovement(movement.movementType);
    let after: BalanceState;
    if (reversalIsReceipt) {
      after = {
        quantity: balance.quantity + movement.quantity,
        valuePoisha: balance.valuePoisha + movement.valuePoisha,
      };
    } else {
      if (movement.quantity > balance.quantity) {
        throw insufficientStockError(item, warehouse, balance, movement.quantity);
      }
      if (movement.valuePoisha > balance.valuePoisha) {
        throw new AppError(
          409,
          'STOCK_REVERSAL_VALUE_INSUFFICIENT',
          `Cannot reverse the stock return for ${item.sku} at ${warehouse.code}: the current stock value is lower than the original returned value. Record a stock valuation adjustment first.`,
          {
            itemId: item.id,
            sku: item.sku,
            warehouseId: warehouse.id,
            originalValuePoisha: movement.valuePoisha.toString(),
            availableValuePoisha: balance.valuePoisha.toString(),
          },
        );
      }
      after = {
        quantity: balance.quantity - movement.quantity,
        valuePoisha: balance.valuePoisha - movement.valuePoisha,
      };
    }
    balances.set(key, after);
    lines.push({
      ...movement,
      reversalType: reversalIsReceipt ? 'REVERSAL_IN' : 'REVERSAL_OUT',
      balanceAfterQuantity: after.quantity,
      balanceAfterValuePoisha: after.valuePoisha,
    });
  }
  return { lines };
}

export async function applySalesStockReversal(
  client: PoolClient,
  input: {
    companyId: string;
    documentId: string;
    documentNo: string;
    date: string;
    journalId: string;
    reason: string;
    actorUserId: string;
    plan: SalesStockReversalPlan;
  },
): Promise<Map<string, string>> {
  const commandId = randomUUID();
  const movementIds = new Map<string, string>();
  for (const [index, line] of input.plan.lines.entries()) {
    const movementId = randomUUID();
    await insertMovement(client, {
      id: movementId,
      companyId: input.companyId,
      commandId,
      movementNo: index + 1,
      idempotencyKey: `REVERSAL:${input.journalId}`,
      movementType: line.reversalType,
      movementDate: input.date,
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      unitCostPoisha: line.unitCostPoisha,
      valuePoisha: line.valuePoisha,
      balanceAfterQuantity: line.balanceAfterQuantity,
      balanceAfterValuePoisha: line.balanceAfterValuePoisha,
      sourceType: 'REVERSAL',
      sourceRef: input.documentNo,
      sourceDocId: input.documentId,
      journalId: input.journalId,
      reversalOfMovementId: line.movementId,
      reversalReason: input.reason,
      negativeStockOverride: false,
      overrideReason: null,
      createdBy: input.actorUserId,
    });
    await updateBalance(client, input.companyId, line.itemId, line.warehouseId, {
      quantity: line.balanceAfterQuantity,
      valuePoisha: line.balanceAfterValuePoisha,
    });
    movementIds.set(line.movementId, movementId);
  }
  return movementIds;
}

/**
 * Document-level reversal of stock movements is shared by sales invoices/credit notes and purchase
 * bills. The original movement type determines whether the reversal adds or removes stock.
 */
export const planDocumentStockReversal = planSalesStockReversal;
export const applyDocumentStockReversal = applySalesStockReversal;
