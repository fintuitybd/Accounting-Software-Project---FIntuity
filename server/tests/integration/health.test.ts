import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

describe.skipIf(!databaseAvailable)('API against PostgreSQL', () => {
  let database: TestDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: database.url,
      LOG_LEVEL: 'silent',
    });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  it('starts against migrated PostgreSQL and reports database health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'ledgervault-api',
      version: '0.1.0',
      checks: { database: { status: 'up' } },
    });
  });

  it('keeps liveness independent of the database and serves the basic route', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'ok', uptime_seconds: expect.any(Number) });

    const ping = await app.inject({ method: 'GET', url: '/api/v1/ping' });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toMatchObject({ pong: true });
  });

  it('does not expose a financial feature or a fake data endpoint', async () => {
    for (const url of ['/api/v1/journals', '/api/v1/reports/trial-balance', '/api/v1/documents']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }

    // The identity phase adds a real company-context route. It must refuse an unauthenticated
    // caller rather than returning any company data.
    const companies = await app.inject({ method: 'GET', url: '/api/v1/companies' });
    expect(companies.statusCode).toBe(401);
    expect(companies.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
