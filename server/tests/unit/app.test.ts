import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadConfig, type NodeEnvironment } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';

type AppInstance = Awaited<ReturnType<typeof buildApp>>;

const apps: AppInstance[] = [];

function configFor(nodeEnv: NodeEnvironment = 'test') {
  return loadConfig({
    NODE_ENV: nodeEnv,
    DATABASE_URL: 'postgresql://user:not-a-real-secret@127.0.0.1:5432/ledgervault_test',
    LOG_LEVEL: 'silent',
    APP_ORIGIN: nodeEnv === 'production' ? 'https://app.example.test' : 'http://localhost:5173',
  });
}

function fakePool(query: () => Promise<unknown>): Pool {
  return { query } as unknown as Pool;
}

async function appWith(pool: Pool, nodeEnv: NodeEnvironment = 'test'): Promise<AppInstance> {
  const config = configFor(nodeEnv);
  const app = await buildApp({ config, pool, logger: createLogger(config) });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('HTTP foundation', () => {
  it('serves a basic typed route and echoes a valid request id', async () => {
    const app = await appWith(fakePool(async () => ({ rows: [] })));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-request-id': 'req-12345678' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-12345678');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.json()).toMatchObject({ pong: true, requestId: 'req-12345678' });
  });

  it('replaces an unsafe request id with a generated one', async () => {
    const app = await appWith(fakePool(async () => ({ rows: [] })));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: { 'x-request-id': 'bad' },
    });

    expect(response.statusCode).toBe(200);
    const returned = response.headers['x-request-id'];
    expect(typeof returned).toBe('string');
    expect(returned).not.toBe('bad');
    expect(returned).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets restrictive browser security headers and production HSTS', async () => {
    const app = await appWith(
      fakePool(async () => ({ rows: [] })),
      'production',
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/ping' });

    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports database readiness and latency', async () => {
    const app = await appWith(fakePool(async () => ({ rows: [{ '?column?': 1 }] })));
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' } },
    });
    expect(typeof response.json().checks.database.latency_ms).toBe('number');
  });

  it('reports 503 without leaking the database error when readiness fails', async () => {
    const app = await appWith(
      fakePool(async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.checks.database.status).toBe('down');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('returns the consistent envelope for malformed JSON', async () => {
    const app = await appWith(fakePool(async () => ({ rows: [] })));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ping',
      payload: '{"broken":',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_JSON' });
  });

  it('returns the consistent envelope for unknown routes', async () => {
    const app = await appWith(fakePool(async () => ({ rows: [] })));
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found.' });
    expect(body.traceId).toBe(response.headers['x-request-id']);
  });

  it('returns a generic internal error in production and never the stack', async () => {
    const app = await appWith(
      fakePool(async () => ({ rows: [] })),
      'production',
    );
    app.get('/__test/boom', { config: { auth: { mode: 'public' } } }, async () => {
      throw new Error('sensitive internal detail');
    });

    const response = await app.inject({ method: 'GET', url: '/__test/boom' });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('sensitive internal detail');
    expect(JSON.stringify(body)).not.toContain('at ');
  });
});
