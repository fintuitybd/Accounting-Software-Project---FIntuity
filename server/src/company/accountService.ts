import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import {
  ACCOUNT_SUB_CATEGORIES,
  ACCOUNT_TYPES,
  CONTROL_SUBLEDGERS,
  IFRS_CATEGORIES,
  SUB_CATEGORIES_BY_TYPE,
} from './constants.ts';
import { parseCsv } from './csv.ts';
import { formatDatabaseDate } from './dates.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface AccountDto {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountType: string;
  subCategory: string;
  ifrsCategory: string;
  parentId: string | null;
  parentCode: string | null;
  controlSubledger: string;
  currency: string;
  taxMapping: Record<string, string>;
  isActive: boolean;
  isControl: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AccountDbRow {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  account_type: string;
  sub_category: string;
  ifrs_category: string;
  parent_id: string | null;
  parent_code: string | null;
  control_subledger: string;
  currency: string;
  tax_mapping_json: Record<string, string> | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AccountWriteInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  accountType: string;
  subCategory: string;
  ifrsCategory: string;
  parentId?: string | null;
  controlSubledger: string;
  taxMapping: Record<string, string>;
  isActive: boolean;
}

const ACCOUNT_SELECT = `
  SELECT a.id, a.company_id, a.code, a.name_en, a.name_bn, a.account_type, a.sub_category,
         a.ifrs_category, a.parent_id, p.code AS parent_code, a.control_subledger, a.currency,
         a.tax_mapping_json, a.is_active, a.created_at, a.updated_at
    FROM accounts a
    LEFT JOIN accounts p ON p.company_id = a.company_id AND p.id = a.parent_id
`;

function mapAccount(row: AccountDbRow): AccountDto {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    accountType: row.account_type,
    subCategory: row.sub_category,
    ifrsCategory: row.ifrs_category,
    parentId: row.parent_id,
    parentCode: row.parent_code,
    controlSubledger: row.control_subledger,
    currency: row.currency,
    taxMapping: row.tax_mapping_json ?? {},
    isActive: row.is_active,
    isControl: row.control_subledger !== 'NONE',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normaliseCode(value: string): string {
  return value.trim().toUpperCase();
}

function normaliseToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function validateTaxMapping(value: Record<string, string>): Record<string, string> {
  const entries = Object.entries(value);
  if (entries.length > 20) {
    throw new AppError(400, 'ACCOUNT_TAX_MAPPING_INVALID', 'A tax mapping may contain at most 20 entries.');
  }
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || typeof item !== 'string' || item.length > 80) {
      throw new AppError(
        400,
        'ACCOUNT_TAX_MAPPING_INVALID',
        'Tax mapping keys and values must be short, plain text identifiers. This is configuration, not a statutory tax validation.',
      );
    }
  }
  return Object.fromEntries(entries);
}

function validateControlForType(controlSubledger: string, accountType: string): void {
  if (controlSubledger === 'AR' && accountType !== 'ASSET') {
    throw new AppError(400, 'ACCOUNT_CONTROL_TYPE_INVALID', 'The AR control account must be an asset account.');
  }
  if (controlSubledger === 'AP' && accountType !== 'LIABILITY') {
    throw new AppError(400, 'ACCOUNT_CONTROL_TYPE_INVALID', 'The AP control account must be a liability account.');
  }
  if (['BANK_MFS', 'INVENTORY', 'FIXED_ASSETS'].includes(controlSubledger) && accountType !== 'ASSET') {
    throw new AppError(
      400,
      'ACCOUNT_CONTROL_TYPE_INVALID',
      `${controlSubledger} control accounts must be asset accounts.`,
    );
  }
  if (
    ['VAT_CURRENT_ACCOUNT', 'VDS_PAYABLE', 'TDS_PAYABLE'].includes(controlSubledger) &&
    !['ASSET', 'LIABILITY'].includes(accountType)
  ) {
    throw new AppError(
      400,
      'ACCOUNT_CONTROL_TYPE_INVALID',
      `${controlSubledger} control accounts must be asset or liability accounts.`,
    );
  }
}

function validateAccountShape(input: AccountWriteInput): AccountWriteInput {
  const code = normaliseCode(input.code);
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code)) {
    throw new AppError(
      400,
      'ACCOUNT_CODE_INVALID',
      'Account codes must start with a letter or digit and contain only letters, digits, dot, underscore or hyphen (maximum 32 characters).',
    );
  }
  const accountType = normaliseToken(input.accountType);
  const subCategory = normaliseToken(input.subCategory);
  const ifrsCategory = normaliseToken(input.ifrsCategory);
  const controlSubledger = normaliseToken(input.controlSubledger);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
    throw new AppError(400, 'ACCOUNT_TYPE_INVALID', 'Choose a valid account type.');
  }
  if (!(ACCOUNT_SUB_CATEGORIES as readonly string[]).includes(subCategory)) {
    throw new AppError(400, 'ACCOUNT_SUB_CATEGORY_INVALID', 'Choose a valid account subcategory.');
  }
  if (!(SUB_CATEGORIES_BY_TYPE[accountType as (typeof ACCOUNT_TYPES)[number]] ?? []).includes(subCategory)) {
    throw new AppError(
      400,
      'ACCOUNT_SUB_CATEGORY_INVALID',
      `Subcategory ${subCategory} is not valid for an ${accountType} account.`,
    );
  }
  if (!(IFRS_CATEGORIES as readonly string[]).includes(ifrsCategory)) {
    throw new AppError(400, 'ACCOUNT_IFRS_CATEGORY_INVALID', 'Choose a valid IFRS category.');
  }
  if (!(CONTROL_SUBLEDGERS as readonly string[]).includes(controlSubledger)) {
    throw new AppError(400, 'ACCOUNT_CONTROL_INVALID', 'Choose a valid control subledger.');
  }
  validateControlForType(controlSubledger, accountType);
  const nameEn = input.nameEn.trim();
  const nameBn = input.nameBn?.trim() || null;
  if (nameEn.length < 1 || nameEn.length > 200) {
    throw new AppError(400, 'ACCOUNT_NAME_INVALID', 'The English account name must be 1–200 characters.');
  }
  if (nameBn && nameBn.length > 200) {
    throw new AppError(400, 'ACCOUNT_NAME_INVALID', 'The Bangla account name must be at most 200 characters.');
  }
  return {
    ...input,
    code,
    nameEn,
    nameBn,
    accountType,
    subCategory,
    ifrsCategory,
    controlSubledger,
    taxMapping: validateTaxMapping(input.taxMapping),
  };
}

async function assertParent(database: Queryable, companyId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const parent = await database.query(`SELECT id FROM accounts WHERE company_id = $1 AND id = $2`, [
    companyId,
    parentId,
  ]);
  if (parent.rowCount === 0) {
    throw new AppError(400, 'ACCOUNT_PARENT_INVALID', 'The parent account does not exist in this company.');
  }
}

async function assertNoCycle(
  database: Queryable,
  companyId: string,
  accountId: string,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  if (parentId === accountId) {
    throw new AppError(400, 'ACCOUNT_PARENT_CYCLE', 'An account cannot be its own parent.');
  }
  const result = await database.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM accounts WHERE company_id = $1 AND id = $2
       UNION ALL
       SELECT a.id, a.parent_id
         FROM accounts a
         JOIN ancestors ancestor ON a.id = ancestor.parent_id
        WHERE a.company_id = $1
     )
     SELECT 1 FROM ancestors WHERE id = $3 LIMIT 1`,
    [companyId, parentId, accountId],
  );
  if (result.rowCount && result.rowCount > 0) {
    throw new AppError(400, 'ACCOUNT_PARENT_CYCLE', 'That parent would create a hierarchy cycle.');
  }
}

export async function listAccounts(
  database: Queryable,
  companyId: string,
  options: { includeInactive?: boolean; search?: string; type?: string } = {},
): Promise<AccountDto[]> {
  const conditions = ['a.company_id = $1'];
  const values: unknown[] = [companyId];
  if (!options.includeInactive) conditions.push('a.is_active = true');
  if (options.type) {
    values.push(normaliseToken(options.type));
    conditions.push(`a.account_type = $${values.length}`);
  }
  if (options.search?.trim()) {
    values.push(`%${options.search.trim()}%`);
    conditions.push(
      `(a.code ILIKE $${values.length} OR a.name_en ILIKE $${values.length} OR coalesce(a.name_bn, '') ILIKE $${values.length})`,
    );
  }
  const result = await database.query<AccountDbRow>(
    `${ACCOUNT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY a.code ASC LIMIT 2000`,
    values,
  );
  return result.rows.map(mapAccount);
}

export async function getAccount(database: Queryable, companyId: string, accountId: string): Promise<AccountDto> {
  const result = await database.query<AccountDbRow>(`${ACCOUNT_SELECT} WHERE a.company_id = $1 AND a.id = $2`, [
    companyId,
    accountId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  return mapAccount(row);
}

export async function createAccount(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    account: AccountWriteInput;
  },
): Promise<AccountDto> {
  const account = validateAccountShape(input.account);
  return withTransaction(pool, async (client) => {
    await assertParent(client, input.companyId, account.parentId ?? null);
    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO accounts (
           company_id, code, name_en, name_bn, account_type, sub_category, ifrs_category, parent_id,
           control_subledger, currency, tax_mapping_json, is_active, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BDT',$10,$11,$12,$12)
         RETURNING id`,
        [
          input.companyId,
          account.code,
          account.nameEn,
          account.nameBn,
          account.accountType,
          account.subCategory,
          account.ifrsCategory,
          account.parentId ?? null,
          account.controlSubledger,
          JSON.stringify(account.taxMapping),
          account.isActive,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'ACCOUNT_CODE_DUPLICATE',
          `Account code ${account.code} already exists in this company.`,
        );
      }
      throw error;
    }
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError(500, 'ACCOUNT_CREATE_FAILED', 'The account could not be created.');
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'account.created',
      entityType: 'account',
      entityId: id,
      after: {
        code: account.code,
        nameEn: account.nameEn,
        accountType: account.accountType,
        subCategory: account.subCategory,
        controlSubledger: account.controlSubledger,
        isActive: account.isActive,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getAccount(client, input.companyId, id);
  });
}

export async function updateAccount(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    accountId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    account: AccountWriteInput;
  },
): Promise<AccountDto> {
  const account = validateAccountShape(input.account);
  return withTransaction(pool, async (client) => {
    const existing = await client.query<AccountDbRow>(
      `SELECT id, code, name_en, name_bn, account_type, sub_category, ifrs_category, parent_id,
              NULL::text AS parent_code, control_subledger, currency, tax_mapping_json, is_active,
              created_at, updated_at
         FROM accounts WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.accountId],
    );
    const before = existing.rows[0];
    if (!before) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');

    const wasControl = before.control_subledger !== 'NONE';
    if (
      wasControl &&
      (before.code !== account.code ||
        before.account_type !== account.accountType ||
        before.control_subledger !== account.controlSubledger ||
        account.isActive === false)
    ) {
      throw new AppError(
        409,
        'ACCOUNT_CONTROL_PROTECTED',
        'Control accounts cannot be recoded, repurposed or deactivated because reports and subledgers depend on them.',
      );
    }

    await assertParent(client, input.companyId, account.parentId ?? null);
    await assertNoCycle(client, input.companyId, input.accountId, account.parentId ?? null);

    if (!account.isActive) {
      const children = await client.query(
        `SELECT 1 FROM accounts
          WHERE company_id = $1 AND parent_id = $2 AND is_active = true LIMIT 1`,
        [input.companyId, input.accountId],
      );
      if (children.rowCount && children.rowCount > 0) {
        throw new AppError(
          409,
          'ACCOUNT_HAS_ACTIVE_CHILDREN',
          'Deactivate or reparent the active child accounts before deactivating this account.',
        );
      }
    }

    try {
      await client.query(
        `UPDATE accounts
            SET code = $3, name_en = $4, name_bn = $5, account_type = $6, sub_category = $7,
                ifrs_category = $8, parent_id = $9, control_subledger = $10,
                tax_mapping_json = $11, is_active = $12, updated_by = $13
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.accountId,
          account.code,
          account.nameEn,
          account.nameBn,
          account.accountType,
          account.subCategory,
          account.ifrsCategory,
          account.parentId ?? null,
          account.controlSubledger,
          JSON.stringify(account.taxMapping),
          account.isActive,
          input.actorUserId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'ACCOUNT_CODE_DUPLICATE',
          `Account code ${account.code} already exists in this company.`,
        );
      }
      throw error;
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: account.isActive ? 'account.updated' : 'account.deactivated',
      entityType: 'account',
      entityId: input.accountId,
      before: {
        code: before.code,
        nameEn: before.name_en,
        nameBn: before.name_bn,
        accountType: before.account_type,
        subCategory: before.sub_category,
        ifrsCategory: before.ifrs_category,
        parentId: before.parent_id,
        controlSubledger: before.control_subledger,
        taxMapping: before.tax_mapping_json ?? {},
        isActive: before.is_active,
      },
      after: {
        code: account.code,
        nameEn: account.nameEn,
        nameBn: account.nameBn,
        accountType: account.accountType,
        subCategory: account.subCategory,
        ifrsCategory: account.ifrsCategory,
        parentId: account.parentId ?? null,
        controlSubledger: account.controlSubledger,
        taxMapping: account.taxMapping,
        isActive: account.isActive,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getAccount(client, input.companyId, input.accountId);
  });
}

export interface RawImportRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface AccountImportInput {
  organisationId: string;
  companyId: string;
  actorUserId: string;
  sessionId: string;
  ip: string;
  userAgent: string | null;
  requestId: string;
  format: 'CSV' | 'XLSX';
  content?: string;
  rows?: Array<Record<string, unknown>>;
}

interface ImportErrorDetail {
  row: number;
  field: string;
  message: string;
}

const IMPORT_COLUMNS = new Set([
  'code',
  'name_en',
  'name_bn',
  'account_type',
  'sub_category',
  'ifrs_category',
  'control_subledger',
  'parent_code',
  'tax_mapping',
  'is_active',
]);

const REQUIRED_IMPORT_COLUMNS = ['code', 'name_en', 'account_type', 'sub_category'];

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return formatDatabaseDate(value);
  return String(value);
}

function toRawRows(input: AccountImportInput): RawImportRow[] {
  if (input.format === 'CSV') {
    const parsed = parseCsv(input.content ?? '');
    if (parsed.errors.length > 0) {
      throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'The CSV could not be parsed.', {
        errors: parsed.errors.map((message) => ({ row: 0, field: 'file', message })),
      });
    }
    if (parsed.rows.length === 0) {
      throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'The CSV file is empty.');
    }
    const header = parsed.rows[0]!.map(normaliseHeader);
    return parsed.rows.slice(1).map((cells, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] ?? ''])),
    }));
  }

  const rows = input.rows ?? [];
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(Object.entries(row).map(([key, value]) => [normaliseHeader(key), stringifyCell(value)])),
  }));
}

function parseTaxMapping(raw: string): Record<string, string> {
  const text = raw.trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      );
    } catch {
      throw new Error('tax_mapping JSON must be an object of text values.');
    }
  }
  const mapping: Record<string, string> = {};
  for (const part of text.split('|')) {
    if (!part.trim()) continue;
    const separator = part.indexOf('=');
    if (separator <= 0) throw new Error('tax_mapping must use key=value pairs separated by |.');
    mapping[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return mapping;
}

function parseBoolean(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text || ['true', '1', 'yes', 'y', 'active'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(text)) return false;
  throw new Error('is_active must be true/false, yes/no or 1/0.');
}

function validateImportRows(rawRows: RawImportRow[]): {
  errors: ImportErrorDetail[];
  rows: Array<AccountWriteInput & { rowNumber: number; parentCode: string | null }>;
} {
  const errors: ImportErrorDetail[] = [];
  const rows: Array<AccountWriteInput & { rowNumber: number; parentCode: string | null }> = [];
  const seenCodes = new Map<string, number>();

  if (rawRows.length === 0) {
    throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'The import file contains no account rows.');
  }
  if (rawRows.length > 2000) {
    throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'A chart-of-accounts import may contain at most 2,000 rows.');
  }

  const headerKeys = new Set(Object.keys(rawRows[0]?.values ?? {}));
  for (const required of REQUIRED_IMPORT_COLUMNS) {
    if (!headerKeys.has(required)) {
      errors.push({ row: 1, field: required, message: `The header row is missing ${required}.` });
    }
  }
  for (const key of headerKeys) {
    if (!IMPORT_COLUMNS.has(key)) {
      errors.push({
        row: 1,
        field: key,
        message: `Unknown column ${key}. Download the template for the expected columns.`,
      });
    }
  }
  if (errors.length > 0) return { errors, rows: [] };

  for (const raw of rawRows) {
    const get = (key: string): string => raw.values[key] ?? '';
    const code = normaliseCode(get('code'));
    if (!code && !get('name_en').trim()) continue; // Ignore fully blank rows inside a spreadsheet.
    if (seenCodes.has(code)) {
      errors.push({
        row: raw.rowNumber,
        field: 'code',
        message: `Code ${code} is duplicated in this file (first seen on row ${seenCodes.get(code)}).`,
      });
      continue;
    }
    seenCodes.set(code, raw.rowNumber);
    try {
      const account = validateAccountShape({
        code,
        nameEn: get('name_en'),
        nameBn: get('name_bn'),
        accountType: get('account_type'),
        subCategory: get('sub_category'),
        ifrsCategory: get('ifrs_category') || 'NA_BALANCE_SHEET',
        controlSubledger: get('control_subledger') || 'NONE',
        taxMapping: parseTaxMapping(get('tax_mapping')),
        isActive: parseBoolean(get('is_active')),
      });
      const parentCode = get('parent_code').trim() ? normaliseCode(get('parent_code')) : null;
      rows.push({ ...account, rowNumber: raw.rowNumber, parentCode });
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : error instanceof Error ? error.message : 'Invalid row.';
      errors.push({ row: raw.rowNumber, field: 'row', message });
    }
  }

  return { errors, rows };
}

export async function importAccounts(
  pool: Pool,
  input: AccountImportInput,
): Promise<{ imported: number; accounts: AccountDto[] }> {
  const rawRows = toRawRows(input);
  const validation = validateImportRows(rawRows);
  if (validation.errors.length > 0) {
    throw new AppError(
      400,
      'ACCOUNT_IMPORT_INVALID',
      `The import contains ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'}. No accounts were created.`,
      { errors: validation.errors, totalRows: rawRows.length, validRows: validation.rows.length },
    );
  }

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ code: string; id: string }>(
      `SELECT code, id FROM accounts WHERE company_id = $1`,
      [input.companyId],
    );
    const codeToId = new Map(existing.rows.map((row) => [row.code, row.id]));
    const errors: ImportErrorDetail[] = [];
    for (const row of validation.rows) {
      if (codeToId.has(row.code)) {
        errors.push({
          row: row.rowNumber,
          field: 'code',
          message: `Account code ${row.code} already exists in this company.`,
        });
      }
    }
    if (errors.length > 0) {
      throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'The import conflicts with existing accounts.', {
        errors,
        totalRows: rawRows.length,
        validRows: 0,
      });
    }

    const insertedIds: string[] = [];
    const remaining = [...validation.rows];
    while (remaining.length > 0) {
      let progressed = false;
      for (let index = 0; index < remaining.length; index += 1) {
        const row = remaining[index]!;
        if (row.parentCode && !codeToId.has(row.parentCode)) continue;
        try {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO accounts (
               company_id, code, name_en, name_bn, account_type, sub_category, ifrs_category, parent_id,
               control_subledger, currency, tax_mapping_json, is_active, created_by, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BDT',$10,$11,$12,$12)
             RETURNING id`,
            [
              input.companyId,
              row.code,
              row.nameEn,
              row.nameBn,
              row.accountType,
              row.subCategory,
              row.ifrsCategory,
              row.parentCode ? codeToId.get(row.parentCode)! : null,
              row.controlSubledger,
              JSON.stringify(row.taxMapping),
              row.isActive,
              input.actorUserId,
            ],
          );
          const id = inserted.rows[0]?.id;
          if (!id) throw new Error('The imported account could not be created.');
          codeToId.set(row.code, id);
          insertedIds.push(id);
          remaining.splice(index, 1);
          index -= 1;
          progressed = true;
        } catch (error) {
          if ((error as { code?: string }).code === '23505') {
            throw new AppError(
              409,
              'ACCOUNT_CODE_DUPLICATE',
              `Account code ${row.code} already exists in this company.`,
            );
          }
          throw error;
        }
      }
      if (!progressed) {
        const unresolved = remaining.map((row) => ({
          row: row.rowNumber,
          field: 'parent_code',
          message: `Parent code ${row.parentCode ?? '(blank)'} was not found in this company or earlier in the file.`,
        }));
        throw new AppError(400, 'ACCOUNT_IMPORT_INVALID', 'Some parent accounts could not be resolved.', {
          errors: unresolved,
          totalRows: rawRows.length,
          validRows: 0,
        });
      }
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'accounts.imported',
      entityType: 'chart_of_accounts',
      entityId: input.companyId,
      after: {
        imported: insertedIds.length,
        format: input.format,
        codes: validation.rows.map((row) => row.code),
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    const all = await client.query<AccountDbRow>(
      `${ACCOUNT_SELECT} WHERE a.company_id = $1 AND a.id = ANY($2::uuid[]) ORDER BY a.code ASC`,
      [input.companyId, insertedIds],
    );
    return { imported: insertedIds.length, accounts: all.rows.map(mapAccount) };
  });
}

export function csvTemplate(): string {
  return [
    'code,name_en,name_bn,account_type,sub_category,ifrs_category,control_subledger,parent_code,tax_mapping,is_active',
  ].join('\n');
}
