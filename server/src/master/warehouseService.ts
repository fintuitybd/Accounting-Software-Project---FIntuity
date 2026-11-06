import type { Pool, PoolClient, QueryResult } from 'pg';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import { digitsOnly, isValidBinDigits, normaliseMasterCode } from './constants.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface WarehouseAuditContext {
  organisationId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
}

export interface BranchDto {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
  bin: string | null;
  isPrincipal: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseDto {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface BranchWriteInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  address?: string | null;
  bin?: string | null;
  isPrincipal: boolean;
}

export interface WarehouseWriteInput {
  branchId?: string | null;
  code: string;
  nameEn: string;
  nameBn?: string | null;
  address?: string | null;
}

interface BranchRow {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  address: string | null;
  bin: string | null;
  is_principal: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface WarehouseRow {
  id: string;
  company_id: string;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  code: string;
  name_en: string;
  name_bn: string | null;
  address: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const BRANCH_SELECT = `
  SELECT id, company_id, code, name_en, name_bn, address, bin, is_principal, status,
         created_at, updated_at
    FROM branches
`;

const WAREHOUSE_SELECT = `
  SELECT w.id, w.company_id, w.branch_id, b.code AS branch_code, b.name_en AS branch_name,
         w.code, w.name_en, w.name_bn, w.address, w.status, w.created_at, w.updated_at
    FROM warehouses w
    LEFT JOIN branches b ON b.company_id = w.company_id AND b.id = w.branch_id
`;

function mapBranch(row: BranchRow): BranchDto {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    address: row.address,
    bin: row.bin,
    isPrincipal: row.is_principal,
    status: row.status as 'ACTIVE' | 'INACTIVE',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapWarehouse(row: WarehouseRow): WarehouseDto {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    code: row.code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    address: row.address,
    status: row.status as 'ACTIVE' | 'INACTIVE',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function auditBase(input: WarehouseAuditContext, companyId: string) {
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

export async function listBranches(
  database: Queryable,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<BranchDto[]> {
  const result = await database.query<BranchRow>(
    `${BRANCH_SELECT} WHERE company_id = $1 ${options.includeInactive ? '' : `AND status = 'ACTIVE'`}
      ORDER BY is_principal DESC, code ASC LIMIT 500`,
    [companyId],
  );
  return result.rows.map(mapBranch);
}

export async function getBranch(database: Queryable, companyId: string, branchId: string): Promise<BranchDto> {
  const result = await database.query<BranchRow>(`${BRANCH_SELECT} WHERE company_id = $1 AND id = $2`, [
    companyId,
    branchId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
  return mapBranch(row);
}

function normaliseBranch(input: BranchWriteInput): {
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
  bin: string | null;
  isPrincipal: boolean;
} {
  const bin = digitsOnly(input.bin);
  if (bin && !isValidBinDigits(bin)) {
    throw new AppError(400, 'BRANCH_BIN_INVALID', 'Branch BIN must be a 13-digit number after removing formatting.');
  }
  return {
    code: normaliseMasterCode(input.code),
    nameEn: input.nameEn.trim(),
    nameBn: input.nameBn?.trim() || null,
    address: input.address?.trim() || null,
    bin,
    isPrincipal: input.isPrincipal,
  };
}

function branchFields(branch: ReturnType<typeof normaliseBranch>): Record<string, unknown> {
  return {
    code: branch.code,
    nameEn: branch.nameEn,
    nameBn: branch.nameBn,
    address: branch.address,
    bin: branch.bin,
    isPrincipal: branch.isPrincipal,
  };
}

export async function createBranch(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; branch: BranchWriteInput },
): Promise<BranchDto> {
  const branch = normaliseBranch(input.branch);
  return withTransaction(pool, async (client) => {
    let inserted: QueryResult<{ id: string }>;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO branches (company_id, code, name_en, name_bn, address, bin, is_principal, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [
          input.companyId,
          branch.code,
          branch.nameEn,
          branch.nameBn,
          branch.address,
          branch.bin,
          branch.isPrincipal,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'BRANCH_CODE_DUPLICATE', 'That branch code or principal-branch flag already exists.');
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'BRANCH_CREATE_FAILED', 'The branch could not be created.');
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'branch.created',
      entityType: 'branch',
      entityId: id,
      after: { ...branchFields(branch), status: 'ACTIVE' },
      reason: 'Branch created.',
    });
    return getBranch(client, input.companyId, id);
  });
}

export async function updateBranch(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; branchId: string; branch: BranchWriteInput },
): Promise<BranchDto> {
  const branch = normaliseBranch(input.branch);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BranchRow>(`${BRANCH_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.branchId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    try {
      await client.query(
        `UPDATE branches
            SET code = $3, name_en = $4, name_bn = $5, address = $6, bin = $7, is_principal = $8,
                updated_by = $9, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.branchId,
          branch.code,
          branch.nameEn,
          branch.nameBn,
          branch.address,
          branch.bin,
          branch.isPrincipal,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'BRANCH_CODE_DUPLICATE', 'That branch code or principal-branch flag already exists.');
      }
      throw error;
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'branch.updated',
      entityType: 'branch',
      entityId: input.branchId,
      before: {
        code: before.code,
        nameEn: before.name_en,
        nameBn: before.name_bn,
        address: before.address,
        bin: before.bin,
        isPrincipal: before.is_principal,
      },
      after: branchFields(branch),
      reason: 'Branch updated.',
    });
    return getBranch(client, input.companyId, input.branchId);
  });
}

export async function deactivateBranch(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; branchId: string; reason: string },
): Promise<BranchDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'BRANCH_DEACTIVATION_REASON_REQUIRED', 'Give a reason of 3–500 characters.');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BranchRow>(`${BRANCH_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.branchId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    if (before.status === 'INACTIVE') return mapBranch(before);
    const warehouses = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM warehouses
        WHERE company_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`,
      [input.companyId, input.branchId],
    );
    if (Number(warehouses.rows[0]?.count ?? 0) > 0) {
      throw new AppError(409, 'BRANCH_HAS_WAREHOUSES', 'Reassign or deactivate the branch’s warehouses first.');
    }
    await client.query(
      `UPDATE branches SET status = 'INACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.branchId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'branch.deactivated',
      entityType: 'branch',
      entityId: input.branchId,
      before: { status: before.status },
      after: { status: 'INACTIVE' },
      reason,
    });
    return getBranch(client, input.companyId, input.branchId);
  });
}

export async function reactivateBranch(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; branchId: string; reason: string },
): Promise<BranchDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'BRANCH_REACTIVATION_REASON_REQUIRED', 'Give a reason of 3–500 characters.');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<BranchRow>(`${BRANCH_SELECT} WHERE company_id = $1 AND id = $2 FOR UPDATE`, [
      input.companyId,
      input.branchId,
    ]);
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    if (before.status === 'ACTIVE') return mapBranch(before);
    try {
      await client.query(
        `UPDATE branches SET status = 'ACTIVE', updated_by = $3, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [input.companyId, input.branchId, input.actorUserId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'BRANCH_PRINCIPAL_EXISTS', 'Another active principal branch already exists.');
      }
      throw error;
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'branch.reactivated',
      entityType: 'branch',
      entityId: input.branchId,
      before: { status: before.status },
      after: { status: 'ACTIVE' },
      reason,
    });
    return getBranch(client, input.companyId, input.branchId);
  });
}

export async function listWarehouses(
  database: Queryable,
  companyId: string,
  options: { includeInactive?: boolean; branchId?: string } = {},
): Promise<WarehouseDto[]> {
  const conditions = ['w.company_id = $1'];
  const values: unknown[] = [companyId];
  if (!options.includeInactive) conditions.push(`w.status = 'ACTIVE'`);
  if (options.branchId) {
    values.push(options.branchId);
    conditions.push(`w.branch_id = $${values.length}`);
  }
  const result = await database.query<WarehouseRow>(
    `${WAREHOUSE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY w.code ASC LIMIT 500`,
    values,
  );
  return result.rows.map(mapWarehouse);
}

export async function getWarehouse(database: Queryable, companyId: string, warehouseId: string): Promise<WarehouseDto> {
  const result = await database.query<WarehouseRow>(`${WAREHOUSE_SELECT} WHERE w.company_id = $1 AND w.id = $2`, [
    companyId,
    warehouseId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
  return mapWarehouse(row);
}

async function assertBranch(database: Queryable, companyId: string, branchId: string): Promise<void> {
  const result = await database.query<{ status: string }>(
    `SELECT status FROM branches WHERE company_id = $1 AND id = $2`,
    [companyId, branchId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(400, 'WAREHOUSE_BRANCH_INVALID', 'The branch must belong to this company.');
  if (row.status !== 'ACTIVE') throw new AppError(400, 'WAREHOUSE_BRANCH_INACTIVE', 'Choose an active branch.');
}

function normaliseWarehouse(input: WarehouseWriteInput): {
  branchId: string | null;
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
} {
  return {
    branchId: input.branchId?.trim() || null,
    code: normaliseMasterCode(input.code),
    nameEn: input.nameEn.trim(),
    nameBn: input.nameBn?.trim() || null,
    address: input.address?.trim() || null,
  };
}

function warehouseFields(warehouse: ReturnType<typeof normaliseWarehouse>): Record<string, unknown> {
  return {
    branchId: warehouse.branchId,
    code: warehouse.code,
    nameEn: warehouse.nameEn,
    nameBn: warehouse.nameBn,
    address: warehouse.address,
  };
}

export async function createWarehouse(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; warehouse: WarehouseWriteInput },
): Promise<WarehouseDto> {
  const warehouse = normaliseWarehouse(input.warehouse);
  return withTransaction(pool, async (client) => {
    if (warehouse.branchId) await assertBranch(client, input.companyId, warehouse.branchId);
    let inserted: QueryResult<{ id: string }>;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO warehouses (company_id, branch_id, code, name_en, name_bn, address, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [
          input.companyId,
          warehouse.branchId,
          warehouse.code,
          warehouse.nameEn,
          warehouse.nameBn,
          warehouse.address,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'WAREHOUSE_CODE_DUPLICATE', 'That warehouse code already exists in this company.');
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'WAREHOUSE_CREATE_FAILED', 'The warehouse could not be created.');
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'warehouse.created',
      entityType: 'warehouse',
      entityId: id,
      after: { ...warehouseFields(warehouse), status: 'ACTIVE' },
      reason: 'Warehouse created.',
    });
    return getWarehouse(client, input.companyId, id);
  });
}

export async function updateWarehouse(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; warehouseId: string; warehouse: WarehouseWriteInput },
): Promise<WarehouseDto> {
  const warehouse = normaliseWarehouse(input.warehouse);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<WarehouseRow>(
      `${WAREHOUSE_SELECT} WHERE w.company_id = $1 AND w.id = $2 FOR UPDATE OF w`,
      [input.companyId, input.warehouseId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    if (warehouse.branchId) await assertBranch(client, input.companyId, warehouse.branchId);
    try {
      await client.query(
        `UPDATE warehouses
            SET branch_id = $3, code = $4, name_en = $5, name_bn = $6, address = $7,
                updated_by = $8, updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.warehouseId,
          warehouse.branchId,
          warehouse.code,
          warehouse.nameEn,
          warehouse.nameBn,
          warehouse.address,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'WAREHOUSE_CODE_DUPLICATE', 'That warehouse code already exists in this company.');
      }
      throw error;
    }
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'warehouse.updated',
      entityType: 'warehouse',
      entityId: input.warehouseId,
      before: {
        branchId: before.branch_id,
        code: before.code,
        nameEn: before.name_en,
        nameBn: before.name_bn,
        address: before.address,
      },
      after: warehouseFields(warehouse),
      reason: 'Warehouse updated.',
    });
    return getWarehouse(client, input.companyId, input.warehouseId);
  });
}

export async function deactivateWarehouse(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; warehouseId: string; reason: string },
): Promise<WarehouseDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'WAREHOUSE_DEACTIVATION_REASON_REQUIRED', 'Give a reason of 3–500 characters.');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<WarehouseRow>(
      `${WAREHOUSE_SELECT} WHERE w.company_id = $1 AND w.id = $2 FOR UPDATE OF w`,
      [input.companyId, input.warehouseId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    if (before.status === 'INACTIVE') return mapWarehouse(before);
    const balances = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_balances
        WHERE company_id = $1 AND warehouse_id = $2 AND quantity <> 0`,
      [input.companyId, input.warehouseId],
    );
    if (Number(balances.rows[0]?.count ?? 0) > 0) {
      throw new AppError(409, 'WAREHOUSE_HAS_STOCK', 'This warehouse still holds stock. Transfer or adjust it first.');
    }
    await client.query(
      `UPDATE warehouses SET status = 'INACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.warehouseId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'warehouse.deactivated',
      entityType: 'warehouse',
      entityId: input.warehouseId,
      before: { status: before.status },
      after: { status: 'INACTIVE' },
      reason,
    });
    return getWarehouse(client, input.companyId, input.warehouseId);
  });
}

export async function reactivateWarehouse(
  pool: Pool,
  input: WarehouseAuditContext & { companyId: string; warehouseId: string; reason: string },
): Promise<WarehouseDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(400, 'WAREHOUSE_REACTIVATION_REASON_REQUIRED', 'Give a reason of 3–500 characters.');
  }
  return withTransaction(pool, async (client) => {
    const existing = await client.query<WarehouseRow>(
      `${WAREHOUSE_SELECT} WHERE w.company_id = $1 AND w.id = $2 FOR UPDATE OF w`,
      [input.companyId, input.warehouseId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    if (before.status === 'ACTIVE') return mapWarehouse(before);
    if (before.branch_id) await assertBranch(client, input.companyId, before.branch_id);
    await client.query(
      `UPDATE warehouses SET status = 'ACTIVE', updated_by = $3, updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.warehouseId, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'warehouse.reactivated',
      entityType: 'warehouse',
      entityId: input.warehouseId,
      before: { status: before.status },
      after: { status: 'ACTIVE' },
      reason,
    });
    return getWarehouse(client, input.companyId, input.warehouseId);
  });
}
