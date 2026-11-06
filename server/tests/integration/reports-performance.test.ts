import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authHeaders,
  login,
  seedCompanyMembership,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

describe.skipIf(!databaseAvailable)('Phase 11 report performance boundary', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let companyId = '';
  let periodId = '';
  let ownerCookies: AuthCookies;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });

    const suffix = randomUUID().slice(0, 8);
    const organisationId = await seedOrganisation(database.pool, `Performance Org ${suffix}`);
    const ownerId = await seedUser(database.pool, {
      email: `performance-${suffix}@example.test`,
      name: `Performance Owner ${suffix}`,
    });
    const membershipId = await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
    const company = await database.pool.query<{ id: string }>(
      `INSERT INTO companies (organisation_id, legal_name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [organisationId, `Performance Company ${suffix}`],
    );
    companyId = company.rows[0]!.id;
    await seedCompanyMembership(database.pool, organisationId, companyId, membershipId);

    const fiscalYear = await database.pool.query<{ id: string }>(
      `INSERT INTO fiscal_years (company_id, label, start_date, end_date, status)
       VALUES ($1, 'FY 2026-27', '2026-07-01', '2027-06-30', 'OPEN') RETURNING id`,
      [companyId],
    );
    const period = await database.pool.query<{ id: string }>(
      `INSERT INTO periods (company_id, fiscal_year_id, code, label, start_date, end_date, status)
       VALUES ($1,$2,'2026-11','November 2026','2026-11-01','2026-11-30','OPEN') RETURNING id`,
      [companyId, fiscalYear.rows[0]!.id],
    );
    periodId = period.rows[0]!.id;
    const branch = await database.pool.query<{ id: string }>(
      `INSERT INTO branches (company_id, code, name_en, is_principal, status)
       VALUES ($1, 'HQ', 'Head office', true, 'ACTIVE') RETURNING id`,
      [companyId],
    );
    const cash = await database.pool.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, account_type, sub_category, control_subledger)
       VALUES ($1, '1010', 'Cash', 'ASSET', 'CURRENT_ASSET', 'BANK_MFS') RETURNING id`,
      [companyId],
    );
    const revenue = await database.pool.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, account_type, sub_category, control_subledger)
       VALUES ($1, '4100', 'Revenue', 'REVENUE', 'OPERATING_REVENUE', 'NONE') RETURNING id`,
      [companyId],
    );

    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO journals (
           company_id, branch_id, book_type, period_id, document_date, posting_date,
           source_module, narration_en, currency, status, created_by
         )
         SELECT $1, $2, 'STATUTORY_BD', $3, '2026-11-15', '2026-11-15',
                'MANUAL_JOURNAL', 'Performance journal ' || n, 'BDT', 'DRAFT', $4
           FROM generate_series(1, 500) AS n`,
        [companyId, branch.rows[0]!.id, periodId, ownerId],
      );
      await client.query(
        `INSERT INTO journal_lines (company_id, journal_id, line_no, account_id, debit_poisha, credit_poisha)
         SELECT $1::uuid, j.id, 1, $2::uuid, 100000, 0
           FROM journals j
          WHERE j.company_id = $1 AND j.status = 'DRAFT' AND j.narration_en LIKE 'Performance journal %'
         UNION ALL
         SELECT $1::uuid, j.id, 2, $3::uuid, 0, 100000
           FROM journals j
          WHERE j.company_id = $1 AND j.status = 'DRAFT' AND j.narration_en LIKE 'Performance journal %'`,
        [companyId, cash.rows[0]!.id, revenue.rows[0]!.id],
      );
      await client.query(
        `WITH numbered AS (
           SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
             FROM journals
            WHERE company_id = $1 AND status = 'DRAFT' AND narration_en LIKE 'Performance journal %'
         )
         UPDATE journals j
            SET status = 'POSTED',
                journal_number = 'JE-PERF-' || lpad(n.rn::text, 5, '0'),
                posted_at = now(),
                posted_by = $2
           FROM numbered n
          WHERE j.company_id = $1 AND j.id = n.id`,
        [companyId, ownerId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    ownerCookies = (await login(app, `performance-${suffix}@example.test`)).cookies;
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  it('returns a bounded, exact P&L over 500 journals without a full-table slowdown', async () => {
    const started = performance.now();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyId}/reports/profit-and-loss?periodId=${periodId}`,
      headers: authHeaders(ownerCookies),
    });
    const elapsed = performance.now() - started;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().report.totals.revenuePoisha).toBe('50000000');
    expect(response.json().report.totals.profitForPeriodPoisha).toBe('50000000');
    expect(elapsed).toBeLessThan(10_000);
  });
});
