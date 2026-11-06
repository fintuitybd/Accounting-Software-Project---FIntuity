import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';

export interface TestDatabase {
  pool: Pool;
  url: string;
  name: string;
  cleanup: () => Promise<void>;
}

export function testDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL?.trim();
  return value ? value : undefined;
}

function databaseName(): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return `ledgervault_test_${Date.now().toString(36)}_${suffix}`;
}

function urlForDatabase(maintenanceUrl: string, name: string): string {
  const url = new URL(maintenanceUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * Create a disposable database per test file. The maintenance account must have CREATEDB; the
 * Docker Compose and CI PostgreSQL users do. No test data survives the run.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const maintenanceUrl = testDatabaseUrl();
  if (!maintenanceUrl) {
    throw new Error('TEST_DATABASE_URL is not configured.');
  }

  const name = databaseName();
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.end().catch(() => undefined);
    throw error;
  }

  const url = urlForDatabase(maintenanceUrl, name);
  const pool = new Pool({ connectionString: url, max: 3 });

  return {
    pool,
    url,
    name,
    cleanup: async () => {
      await pool.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
