import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

describe.skipIf(!databaseAvailable)('public demo-request API', () => {
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

  const payload = {
    name: 'Ayesha Rahman',
    email: 'AYESHA@Example.TEST',
    company: 'Meghna Traders',
    message: 'We need sales, purchases and VAT preparation.',
    source: 'landing',
  };

  it('records a validated request without exposing contact details in the response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/public/demo-requests',
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      reference: expect.stringMatching(/^DR-[0-9A-F]{8}$/),
      message: 'Request received.',
    });
    expect(JSON.stringify(body)).not.toContain(payload.email);
    expect(JSON.stringify(body)).not.toContain(payload.name);

    const stored = await database.pool.query(
      `SELECT name, email, company, message, source, status FROM demo_requests WHERE id = $1`,
      [body.id],
    );
    expect(stored.rows[0]).toMatchObject({
      name: payload.name,
      email: 'ayesha@example.test',
      company: payload.company,
      message: payload.message,
      source: 'landing',
      status: 'NEW',
    });
  });

  it('enforces the configured browser origin on the public mutation', async () => {
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/public/demo-requests',
      payload,
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.statusCode).toBe(201);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/public/demo-requests',
      payload,
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('rejects invalid, oversized and unknown fields with the stable envelope', async () => {
    for (const invalid of [
      { ...payload, email: 'not-an-email' },
      { ...payload, name: '   ' },
      { ...payload, message: 'x'.repeat(2001) },
      { ...payload, admin: true },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/public/demo-requests',
        payload: invalid,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('rate-limits repeated requests from one connection', async () => {
    const remoteAddress = '203.0.113.77';
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/public/demo-requests',
        payload,
        remoteAddress,
      });
      expect(response.statusCode).toBe(201);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/public/demo-requests',
      payload,
      remoteAddress,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not expose a public read endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/demo-requests',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
