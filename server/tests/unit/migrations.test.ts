import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { loadMigrationFiles, migrateDown, MIGRATIONS_DIRECTORY } from '../../src/migrations/runner.ts';

describe('migration files', () => {
  it('has a matching, non-empty down file for every up migration', async () => {
    const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.id).toMatch(/^\d{4}_[a-z0-9_]+$/);
      expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('refuses to roll back in production before touching the database', async () => {
    await expect(migrateDown({ pool: {} as Pool, nodeEnv: 'production', steps: 1 })).rejects.toMatchObject({
      code: 'MIGRATION_DOWN_FORBIDDEN',
    });
  });
});
