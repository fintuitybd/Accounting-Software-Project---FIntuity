import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';
import type { NodeEnvironment } from '../config.ts';

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));

const MIGRATION_FILE_PATTERN = /^(\d{4}_[a-z0-9_]+)\.up\.sql$/;
const MIGRATION_TABLE = 'schema_migrations';
const MIGRATION_LOCK_KEY = 7_281_940_021;

export type MigrationErrorCode =
  | 'MIGRATION_DIRECTORY_INVALID'
  | 'MIGRATION_FILE_INVALID'
  | 'MIGRATION_DOWN_MISSING'
  | 'MIGRATION_FILE_MISSING'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_DOWN_FORBIDDEN'
  | 'MIGRATION_STEPS_INVALID'
  | 'RESET_FORBIDDEN';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

export interface MigrationFile {
  id: string;
  upPath: string;
  downPath: string;
  checksum: string;
}

export interface MigrationContext {
  pool: Pool;
  directory?: string;
  logger?: Logger;
  nodeEnv: NodeEnvironment;
}

export interface MigrationUpOptions extends MigrationContext {
  /** Apply migrations up to and including this id. */
  to?: string;
}

export interface MigrationDownOptions extends MigrationContext {
  steps?: number;
}

export interface MigrationStatusRow {
  id: string;
  applied: boolean;
  appliedAt?: Date;
  checksumMatches: boolean;
}

function normaliseSql(sql: string): string {
  return sql.replace(/\r\n/g, '\n');
}

function checksumSql(sql: string): string {
  return createHash('sha256').update(normaliseSql(sql)).digest('hex');
}

export async function loadMigrationFiles(directory = MIGRATIONS_DIRECTORY): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    throw new MigrationError('MIGRATION_DIRECTORY_INVALID', `Migration directory is not readable: ${directory}`);
  }

  const upFiles = entries.filter((entry) => MIGRATION_FILE_PATTERN.test(entry)).sort();
  const files: MigrationFile[] = [];

  for (const entry of upFiles) {
    const match = MIGRATION_FILE_PATTERN.exec(entry);
    if (!match) continue;
    const id = match[1];
    if (!id) continue;
    const downFile = `${id}.down.sql`;
    if (!entries.includes(downFile)) {
      throw new MigrationError('MIGRATION_DOWN_MISSING', `Migration ${id} has no matching down migration.`);
    }

    const upPath = path.join(directory, entry);
    const downPath = path.join(directory, downFile);
    const upSql = await readFile(upPath, 'utf8');
    const downSql = await readFile(downPath, 'utf8');
    if (upSql.trim().length === 0 || downSql.trim().length === 0) {
      throw new MigrationError('MIGRATION_FILE_INVALID', `Migration ${id} has an empty up or down file.`);
    }

    files.push({
      id,
      upPath,
      downPath,
      checksum: checksumSql(upSql),
    });
  }

  return files;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    )
  `);
}

async function withMigrationLock<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    locked = true;
    return await operation(client);
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
    client.release();
  }
}

interface AppliedMigrationRow {
  id: string;
  checksum: string;
  applied_at: Date;
}

async function readApplied(client: PoolClient): Promise<AppliedMigrationRow[]> {
  const result = await client.query<AppliedMigrationRow>(
    `SELECT id, checksum, applied_at FROM ${MIGRATION_TABLE} ORDER BY id ASC`,
  );
  return result.rows;
}

function verifyAppliedSet(files: MigrationFile[], applied: AppliedMigrationRow[]): void {
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const row of applied) {
    const file = byId.get(row.id);
    if (!file) {
      throw new MigrationError(
        'MIGRATION_FILE_MISSING',
        `Applied migration ${row.id} is missing from the migrations directory.`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        'MIGRATION_CHECKSUM_MISMATCH',
        `Applied migration ${row.id} has changed. Add a new migration instead of editing history.`,
      );
    }
  }
}

export async function migrateUp(options: MigrationUpOptions): Promise<{ applied: string[]; alreadyApplied: number }> {
  const fileDirectory = options.directory ?? MIGRATIONS_DIRECTORY;
  const files = await loadMigrationFiles(fileDirectory);
  if (files.length === 0) {
    return { applied: [], alreadyApplied: 0 };
  }

  if (options.to && !files.some((file) => file.id === options.to)) {
    throw new MigrationError('MIGRATION_FILE_INVALID', `Unknown target migration: ${options.to}`);
  }

  return withMigrationLock(options.pool, async (client) => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyAppliedSet(files, applied);

    const appliedIds = new Set(applied.map((row) => row.id));
    const pending = files.filter((file) => !appliedIds.has(file.id));
    const selected = options.to ? pending.filter((file) => file.id <= options.to!) : pending;
    const appliedNow: string[] = [];

    for (const migration of selected) {
      const sql = await readFile(migration.upPath, 'utf8');
      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        const executionMs = Date.now() - startedAt;
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (id, checksum, execution_ms) VALUES ($1, $2, $3)`, [
          migration.id,
          migration.checksum,
          executionMs,
        ]);
        await client.query('COMMIT');
        appliedNow.push(migration.id);
        options.logger?.info({ migration: migration.id, executionMs }, 'migration applied');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = error instanceof Error ? error.message : 'unknown database error';
        throw new MigrationError('MIGRATION_FAILED', `Migration ${migration.id} failed: ${detail}`);
      }
    }

    return { applied: appliedNow, alreadyApplied: applied.length };
  });
}

export async function migrateDown(options: MigrationDownOptions): Promise<{ rolledBack: string[] }> {
  if (options.nodeEnv === 'production') {
    throw new MigrationError(
      'MIGRATION_DOWN_FORBIDDEN',
      'Migrations are forward-only in production. Restore from backup or add a compensating migration.',
    );
  }

  const steps = options.steps ?? 1;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new MigrationError('MIGRATION_STEPS_INVALID', 'Rollback steps must be a positive integer.');
  }

  const fileDirectory = options.directory ?? MIGRATIONS_DIRECTORY;
  const files = await loadMigrationFiles(fileDirectory);

  return withMigrationLock(options.pool, async (client) => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyAppliedSet(files, applied);

    const byId = new Map(files.map((file) => [file.id, file]));
    const selected = applied.slice(-steps).reverse();
    const rolledBack: string[] = [];

    for (const row of selected) {
      const migration = byId.get(row.id);
      if (!migration) {
        throw new MigrationError('MIGRATION_FILE_MISSING', `Applied migration ${row.id} has no down file.`);
      }
      const sql = await readFile(migration.downPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`DELETE FROM ${MIGRATION_TABLE} WHERE id = $1`, [migration.id]);
        await client.query('COMMIT');
        rolledBack.push(migration.id);
        options.logger?.info({ migration: migration.id }, 'migration rolled back');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = error instanceof Error ? error.message : 'unknown database error';
        throw new MigrationError('MIGRATION_FAILED', `Rollback of ${migration.id} failed: ${detail}`);
      }
    }

    return { rolledBack };
  });
}

export async function migrationStatus(options: MigrationContext): Promise<MigrationStatusRow[]> {
  const fileDirectory = options.directory ?? MIGRATIONS_DIRECTORY;
  const files = await loadMigrationFiles(fileDirectory);
  return withMigrationLock(options.pool, async (client) => {
    await ensureMigrationTable(client);
    const applied = await readApplied(client);
    verifyAppliedSet(files, applied);
    const appliedById = new Map(applied.map((row) => [row.id, row]));

    return files.map((file) => {
      const row = appliedById.get(file.id);
      return {
        id: file.id,
        applied: Boolean(row),
        ...(row ? { appliedAt: row.applied_at } : {}),
        checksumMatches: row ? row.checksum === file.checksum : true,
      };
    });
  });
}

/**
 * Destructive development-only reset. The database name must end in _dev or _test and the caller
 * must pass an explicit confirmation flag through the CLI.
 */
export async function resetDevelopmentDatabase(options: MigrationContext): Promise<{ applied: string[] }> {
  if (options.nodeEnv === 'production') {
    throw new MigrationError('RESET_FORBIDDEN', 'Development reset is forbidden in production.');
  }

  const nameResult = await options.pool.query<{ name: string }>('SELECT current_database() AS name');
  const databaseName = nameResult.rows[0]?.name ?? '';
  if (!/(_dev|_test)$/.test(databaseName)) {
    throw new MigrationError('RESET_FORBIDDEN', 'Development reset requires a database name ending in _dev or _test.');
  }

  const client = await options.pool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    client.release();
  }

  const result = await migrateUp(options);
  return { applied: result.applied };
}
