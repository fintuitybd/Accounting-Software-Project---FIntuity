import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

describe.skipIf(!databaseAvailable)('foundation migrations against PostgreSQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  it('applies every migration to a clean database and is idempotent', async () => {
    const first = await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    expect(first.applied).toEqual([
      '0001_foundation',
      '0002_identity_sessions_invitations',
      '0003_company_setup',
      '0004_ledger',
      '0005_master_data_inventory',
      '0006_sales_receivables',
      '0007_purchases_payables',
      '0008_treasury_certificates',
      '0009_banking_reconciliation',
      '0010_reporting_branch_scope',
      '0011_close_approvals_audit',
      '0012_public_demo_requests',
      '0013_compliance_calendar',
      '0014_withholding_returns_and_sequences',
      '0015_payroll_labour_act',
      '0016_manufacturing_mushak43',
      '0017_mfs_webhooks_settlements',
    ]);
    expect(first.alreadyApplied).toBe(0);

    const tables = await database.pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    const tableNames = tables.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'audit_events',
        'accounts',
        'bank_accounts',
        'branches',
        'companies',
        'company_memberships',
        'company_onboarding',
        'company_settings',
        'email_verification_tokens',
        'fiscal_years',
        'invitation_companies',
        'invitations',
        'items',
        'journal_lines',
        'journals',
        'memberships',
        'number_sequences',
        'opening_balance_batches',
        'opening_balance_lines',
        'organisations',
        'parties',
        'party_opening_items',
        'password_reset_tokens',
        'periods',
        'rate_limit_counters',
        'schema_migrations',
        'sessions',
        'stock_balances',
        'stock_movements',
        'users',
        'warehouses',
        'sales_documents',
        'sales_document_lines',
        'sales_document_taxes',
        'sales_tax_decisions',
        'sales_document_events',
        'sales_receipts',
        'sales_receipt_allocations',
        'purchase_documents',
        'purchase_document_lines',
        'purchase_document_taxes',
        'purchase_tax_decisions',
        'purchase_document_events',
        'purchase_payments',
        'purchase_payment_allocations',
        'purchase_withholding_liabilities',
        'purchase_payment_approval_requests',
        'treasury_challans',
        'treasury_challan_items',
        'treasury_certificates',
        'bank_statements',
        'bank_statement_lines',
        'bank_statement_line_matches',
        'bank_gl_requests',
        'bank_fee_rules',
        'bank_fee_postings',
        'bank_transfers',
        'bank_reconciliations',
        'close_runs',
        'close_run_events',
        'suspense_resolutions',
        'demo_requests',
        'bd_gazetted_holidays',
        'compliance_calendar_events',
        'mfs_webhook_events',
      ]),
    );

    const indexes = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'journals'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'journals_company_date_idx',
        'journals_company_status_idx',
        'journals_company_branch_date_idx',
      ]),
    );

    const second = await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(17);
  });

  it('enforces status checks, foreign keys and append-only audit events', async () => {
    await expect(
      database.pool.query(`INSERT INTO organisations (name, status) VALUES ('Invalid status organisation', 'BOGUS')`),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      database.pool.query(
        `INSERT INTO companies (organisation_id, legal_name)
         VALUES ('00000000-0000-4000-8000-000000000000', 'Orphan company')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const org = await database.pool.query<{ id: string }>(
      `INSERT INTO organisations (name) VALUES ('Test Organisation') RETURNING id`,
    );
    const organisationId = org.rows[0]!.id;

    const user = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, name, status) VALUES ('test.user@example.test', 'Test User', 'ACTIVE') RETURNING id`,
    );
    const userId = user.rows[0]!.id;

    const company = await database.pool.query<{ id: string }>(
      `INSERT INTO companies (organisation_id, legal_name) VALUES ($1, 'Test Company') RETURNING id`,
      [organisationId],
    );
    const companyId = company.rows[0]!.id;

    const event = await database.pool.query<{ id: string }>(
      `INSERT INTO audit_events (organisation_id, company_id, actor_user_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, 'test.created', 'company', $4)
       RETURNING id`,
      [organisationId, companyId, userId, companyId],
    );
    const eventId = event.rows[0]!.id;

    await expect(
      database.pool.query(`UPDATE audit_events SET action = 'test.tampered' WHERE id = $1`, [eventId]),
    ).rejects.toMatchObject({ code: '55000' });

    await expect(database.pool.query(`DELETE FROM audit_events WHERE id = $1`, [eventId])).rejects.toMatchObject({
      code: '55000',
    });

    await expect(
      database.pool.query(
        `INSERT INTO audit_events (company_id, action, entity_type)
         VALUES ($1, 'test.created', 'company')`,
        [companyId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rolls back on a development database and can reapply cleanly', async () => {
    const down = await migrateDown({ pool: database.pool, nodeEnv: 'test', steps: 17 });
    expect(down.rolledBack).toEqual([
      '0017_mfs_webhooks_settlements',
      '0016_manufacturing_mushak43',
      '0015_payroll_labour_act',
      '0014_withholding_returns_and_sequences',
      '0013_compliance_calendar',
      '0012_public_demo_requests',
      '0011_close_approvals_audit',
      '0010_reporting_branch_scope',
      '0009_banking_reconciliation',
      '0008_treasury_certificates',
      '0007_purchases_payables',
      '0006_sales_receivables',
      '0005_master_data_inventory',
      '0004_ledger',
      '0003_company_setup',
      '0002_identity_sessions_invitations',
      '0001_foundation',
    ]);

    const remaining = await database.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('organisations', 'users', 'memberships', 'companies', 'audit_events', 'accounts', 'periods', 'journals', 'journal_lines', 'items', 'stock_movements', 'stock_balances', 'sales_documents', 'sales_document_lines', 'sales_document_taxes', 'sales_tax_decisions', 'sales_document_events', 'sales_receipts', 'sales_receipt_allocations', 'purchase_documents', 'purchase_document_lines', 'purchase_document_taxes', 'purchase_tax_decisions', 'purchase_document_events', 'purchase_payments', 'purchase_payment_allocations', 'purchase_withholding_liabilities', 'purchase_payment_approval_requests', 'treasury_challans', 'treasury_challan_items', 'treasury_certificates', 'bank_statements', 'bank_statement_lines', 'bank_statement_line_matches', 'bank_gl_requests', 'bank_fee_rules', 'bank_fee_postings', 'bank_transfers', 'bank_reconciliations', 'close_runs', 'close_run_events', 'suspense_resolutions', 'demo_requests', 'bd_gazetted_holidays', 'compliance_calendar_events', 'document_sequences', 'withholding_tax_returns', 'withholding_return_lines', 'payroll_employees', 'payroll_runs', 'payroll_run_lines', 'mushak_43_declarations', 'mushak_43_ingredients', 'production_batches', 'mfs_webhook_events')`,
    );
    expect(remaining.rows).toEqual([]);

    const reapplied = await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    expect(reapplied.applied).toEqual([
      '0001_foundation',
      '0002_identity_sessions_invitations',
      '0003_company_setup',
      '0004_ledger',
      '0005_master_data_inventory',
      '0006_sales_receivables',
      '0007_purchases_payables',
      '0008_treasury_certificates',
      '0009_banking_reconciliation',
      '0010_reporting_branch_scope',
      '0011_close_approvals_audit',
      '0012_public_demo_requests',
      '0013_compliance_calendar',
      '0014_withholding_returns_and_sequences',
      '0015_payroll_labour_act',
      '0016_manufacturing_mushak43',
      '0017_mfs_webhooks_settlements',
    ]);
  });
});
