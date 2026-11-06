import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authHeaders,
  authed,
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

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'TRADING_DISTRIBUTION',
  tin: '123456789',
  bin: '123456789-0101',
  rjscNo: 'C-12345/2026',
  address: 'House 12, Road 5, Banani, Dhaka 1213',
  phone: '+8801700000000',
  email: 'finance@example.test',
  reportingFramework: 'IFRS_FOR_SMES_BFRS',
};

const ACCOUNTS = [
  {
    key: 'bank',
    code: '1010',
    nameEn: 'Bank current account',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'ar',
    code: '1100',
    nameEn: 'Trade receivables',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'AR',
  },
  {
    key: 'ap',
    code: '2000',
    nameEn: 'Trade payables',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'AP',
  },
  {
    key: 'suspense',
    code: '1190',
    nameEn: 'Suspense clearing',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'SUSPENSE',
  },
  {
    key: 'capital',
    code: '3000',
    nameEn: 'Share capital',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_CAPITAL',
    controlSubledger: 'NONE',
  },
  {
    key: 'retained',
    code: '3200',
    nameEn: 'Retained earnings',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_RESERVES',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenue',
    code: '4000',
    nameEn: 'Service revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
    controlSubledger: 'NONE',
  },
  {
    key: 'expense',
    code: '5000',
    nameEn: 'Office expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    controlSubledger: 'NONE',
  },
] as const;

interface Fixture {
  organisationId: string;
  companyId: string;
  ownerId: string;
  ownerCookies: AuthCookies;
  controllerId: string;
  controllerCookies: AuthCookies;
  accountantId: string;
  accountantCookies: AuthCookies;
  auditorCookies: AuthCookies;
  accounts: Record<string, { id: string; code: string }>;
  periods: Array<{ id: string; code: string; status: string }>;
}

describe.skipIf(!databaseAvailable)('Phase 12 close, approvals, controls and audit log', () => {
  let database: TestDatabase;
  let app: AppInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  function unique(label: string): string {
    return `${label}-${randomUUID().slice(0, 8)}`;
  }

  async function createFixture(label: string): Promise<Fixture> {
    const suffix = unique(label);
    const organisationId = await seedOrganisation(database.pool, `Organisation ${suffix}`);
    const ownerEmail = `owner-${suffix}@example.test`;
    const controllerEmail = `controller-${suffix}@example.test`;
    const accountantEmail = `accountant-${suffix}@example.test`;
    const auditorEmail = `auditor-${suffix}@example.test`;

    const ownerId = await seedUser(database.pool, { email: ownerEmail, name: `Owner ${suffix}` });
    const controllerId = await seedUser(database.pool, { email: controllerEmail, name: `Controller ${suffix}` });
    const accountantId = await seedUser(database.pool, { email: accountantEmail, name: `Accountant ${suffix}` });
    const auditorId = await seedUser(database.pool, { email: auditorEmail, name: `Auditor ${suffix}` });

    await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
    const controllerMembershipId = await seedMembership(database.pool, organisationId, controllerId, 'CONTROLLER');
    const accountantMembershipId = await seedMembership(database.pool, organisationId, accountantId, 'ACCOUNTANT');
    const auditorMembershipId = await seedMembership(database.pool, organisationId, auditorId, 'AUDITOR');

    const ownerCookies = (await login(app, ownerEmail)).cookies;
    const controllerCookies = (await login(app, controllerEmail)).cookies;
    const accountantCookies = (await login(app, accountantEmail)).cookies;
    const auditorCookies = (await login(app, auditorEmail)).cookies;

    const companyResponse = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/organisations/${organisationId}/companies`,
      { legalName: `${label} Ltd`, tradeName: `${label} Trade`, ...COMPANY_PROFILE },
    );
    expect(companyResponse.statusCode, companyResponse.body).toBe(201);
    const companyId = companyResponse.json().company.id as string;

    await seedCompanyMembership(database.pool, organisationId, companyId, controllerMembershipId);
    await seedCompanyMembership(database.pool, organisationId, companyId, accountantMembershipId);
    await seedCompanyMembership(database.pool, organisationId, companyId, auditorMembershipId);

    const fiscalResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(fiscalResponse.statusCode, fiscalResponse.body).toBe(201);
    const fiscalYear = fiscalResponse.json().fiscalYear;

    const accounts: Record<string, { id: string; code: string }> = {};
    for (const account of ACCOUNTS) {
      const response = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/accounts`, {
        code: account.code,
        nameEn: account.nameEn,
        accountType: account.accountType,
        subCategory: account.subCategory,
        ifrsCategory: 'NA_BALANCE_SHEET',
        controlSubledger: account.controlSubledger,
        taxMapping: {},
        isActive: true,
      });
      expect(response.statusCode, response.body).toBe(201);
      accounts[account.key] = { id: response.json().account.id, code: response.json().account.code };
    }

    return {
      organisationId,
      companyId,
      ownerId,
      ownerCookies,
      controllerId,
      controllerCookies,
      accountantId,
      accountantCookies,
      auditorCookies,
      accounts,
      periods: fiscalYear.periods.map((period: any) => ({
        id: period.id,
        code: period.code,
        status: period.status,
      })),
    };
  }

  async function postManualJournal(
    fixture: Fixture,
    input: { date: string; debitAccountId: string; creditAccountId: string; amount: string; narration: string },
    cookies = fixture.accountantCookies,
  ) {
    const draft = await authed(app, cookies, 'POST', `/api/v1/companies/${fixture.companyId}/journals`, {
      date: input.date,
      narration: input.narration,
      attachmentReference: 'TEST-EVIDENCE-PHASE-12',
      lines: [
        { accountId: input.debitAccountId, debit: input.amount, credit: '0', memo: input.narration },
        { accountId: input.creditAccountId, debit: '0', credit: input.amount, memo: input.narration },
      ],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const journalId = draft.json().journal.id as string;
    const submitted = await authed(
      app,
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/submit`,
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/journals/${journalId}/post`,
      headers: {
        ...authHeaders(cookies),
        'idempotency-key': `close-test-${randomUUID()}`,
      },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    return posted.json().journal;
  }

  async function createCloseRun(fixture: Fixture, periodId: string, cookies = fixture.ownerCookies) {
    return authed(app, cookies, 'POST', `/api/v1/companies/${fixture.companyId}/close-runs`, { periodId });
  }

  async function submitCloseRun(
    fixture: Fixture,
    runId: string,
    cookies = fixture.ownerCookies,
    evidence = 'CLOSE-EVIDENCE-001',
  ) {
    return authed(app, cookies, 'POST', `/api/v1/companies/${fixture.companyId}/close-runs/${runId}/submit`, {
      evidenceReference: evidence,
      evidenceNote: 'Signed close file attached.',
    });
  }

  async function decideCloseRun(
    fixture: Fixture,
    runId: string,
    decision: 'APPROVE' | 'REJECT',
    cookies = fixture.controllerCookies,
    reason = 'Controls reviewed by the checker.',
  ) {
    return authed(app, cookies, 'POST', `/api/v1/companies/${fixture.companyId}/close-runs/${runId}/decide`, {
      decision,
      reason,
    });
  }

  it('persists a close run, enforces maker-checker and locks the period against posting', async () => {
    const fixture = await createFixture('CloseHappy');
    const period = fixture.periods[0]!;

    const created = await createCloseRun(fixture, period.id);
    expect(created.statusCode, created.body).toBe(201);
    const run = created.json().closeRun;
    expect(run.status).toBe('DRAFT');
    expect(run.preparedBy).toBe(fixture.ownerId);
    expect(run.checks.find((check: any) => check.key === 'TRIAL_BALANCE').passed).toBe(true);

    const submitted = await submitCloseRun(fixture, run.id);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().closeRun.status).toBe('SUBMITTED');
    expect(submitted.json().closeRun.evidenceReference).toBe('CLOSE-EVIDENCE-001');

    const selfApproval = await decideCloseRun(fixture, run.id, 'APPROVE', fixture.ownerCookies);
    expect(selfApproval.statusCode).toBe(403);
    expect(selfApproval.json().code).toBe('CLOSE_SELF_APPROVAL');

    const approved = await decideCloseRun(fixture, run.id, 'APPROVE');
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().closeRun.status).toBe('APPROVED');
    expect(approved.json().closeRun.periodStatus).toBe('LOCKED');
    expect(approved.json().closeRun.decidedBy).toBe(fixture.controllerId);

    const periodRow = await database.pool.query<{ status: string }>(
      `SELECT status FROM periods WHERE company_id = $1 AND id = $2`,
      [fixture.companyId, period.id],
    );
    expect(periodRow.rows[0]?.status).toBe('LOCKED');

    const draft = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      {
        date: '2026-01-20',
        narration: 'Must be rejected after lock',
        lines: [
          { accountId: fixture.accounts.bank!.id, debit: '10.00', credit: '0' },
          { accountId: fixture.accounts.revenue!.id, debit: '0', credit: '10.00' },
        ],
      },
    );
    expect(draft.statusCode, draft.body).toBe(201);
    const lockedSubmit = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${draft.json().journal.id}/submit`,
    );
    expect(lockedSubmit.statusCode).toBe(409);
    expect(lockedSubmit.json().code).toBe('PERIOD_NOT_OPEN');

    const audit = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE company_id = $1 AND entity_type IN ('close_run', 'period') ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['close.run_created', 'close.run_submitted', 'close.run_approved', 'period.locked']),
    );
    const events = await database.pool.query<{ action: string }>(
      `SELECT action FROM close_run_events WHERE company_id = $1 AND run_id = $2 ORDER BY created_at ASC`,
      [fixture.companyId, run.id],
    );
    expect(events.rows.map((row) => row.action)).toEqual(['close.created', 'close.submitted', 'close.approved']);

    await expect(
      database.pool.query(
        `UPDATE close_runs SET decision_reason = 'silently altered' WHERE company_id = $1 AND id = $2`,
        [fixture.companyId, run.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.pool.query(`DELETE FROM close_run_events WHERE company_id = $1 AND run_id = $2`, [
        fixture.companyId,
        run.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('blocks a close when a control fails and records the exception', async () => {
    const fixture = await createFixture('CloseFail');
    const period = fixture.periods[2]!;
    await postManualJournal(fixture, {
      date: '2026-03-15',
      debitAccountId: fixture.accounts.ar!.id,
      creditAccountId: fixture.accounts.revenue!.id,
      amount: '1250.00',
      narration: 'AR posting without an invoice for control failure',
    });

    const created = await createCloseRun(fixture, period.id);
    expect(created.statusCode, created.body).toBe(201);
    const run = created.json().closeRun;
    const arCheck = run.checks.find((check: any) => check.key === 'AR_CONTROL');
    expect(arCheck.passed).toBe(false);
    expect(run.exceptions.some((exception: any) => exception.code === 'CLOSE_AR_CONTROL')).toBe(true);

    const submitted = await submitCloseRun(fixture, run.id);
    expect(submitted.statusCode).toBe(409);
    expect(submitted.json().code).toBe('CLOSE_CHECKS_FAILED');
    expect(submitted.json().details.failedChecks.map((check: any) => check.key)).toContain('AR_CONTROL');

    const periodRow = await database.pool.query<{ status: string }>(
      `SELECT status FROM periods WHERE company_id = $1 AND id = $2`,
      [fixture.companyId, period.id],
    );
    expect(periodRow.rows[0]?.status).toBe('OPEN');
  });

  it('clears suspense only through a named target, evidence and a different checker', async () => {
    const fixture = await createFixture('Suspense');
    const period = fixture.periods[3]!;
    const suspenseJournal = await postManualJournal(fixture, {
      date: '2026-04-12',
      debitAccountId: fixture.accounts.suspense!.id,
      creditAccountId: fixture.accounts.revenue!.id,
      amount: '750.00',
      narration: 'Unidentified bank credit held in suspense',
    });

    const overview = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/suspense`,
    );
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json().suspense.items).toHaveLength(1);
    const item = overview.json().suspense.items[0];

    const request = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/suspense/resolutions`,
      {
        sourceLineId: item.lineId,
        targetAccountId: fixture.accounts.expense!.id,
        reason: 'Bank advice identified the item as a bank charge',
        attachmentReference: 'BANK-ADVICE-2026-04-12',
      },
    );
    expect(request.statusCode, request.body).toBe(201);
    const resolutionId = request.json().resolution.id as string;

    const selfApproval = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/suspense/resolutions/${resolutionId}/decide`,
      { decision: 'APPROVE', reason: 'Self approval attempt' },
    );
    expect(selfApproval.statusCode).toBe(403);
    expect(selfApproval.json().code).toBe('SUSPENSE_SELF_APPROVAL');

    const approved = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/suspense/resolutions/${resolutionId}/decide`,
      { decision: 'APPROVE', reason: 'Bank advice reviewed; approved for clearance' },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().resolution.status).toBe('POSTED');

    const after = await authed(app, fixture.auditorCookies, 'GET', `/api/v1/companies/${fixture.companyId}/suspense`);
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().suspense.items).toHaveLength(0);
    expect(after.json().suspense.items.find((entry: any) => entry.lineId === item.lineId)).toBeUndefined();

    const journal = await database.pool.query<{ id: string; source_module: string; status: string }>(
      `SELECT id, source_module, status FROM journals
        WHERE company_id = $1 AND source_module = 'SUSPENSE' AND source_doc_ref = $2`,
      [fixture.companyId, resolutionId],
    );
    expect(journal.rows[0]?.status).toBe('POSTED');
    expect(journal.rows[0]?.source_module).toBe('SUSPENSE');
    expect(journal.rows[0]?.id).toBe(approved.json().resolution.journalId);

    const closeRun = await createCloseRun(fixture, period.id);
    expect(closeRun.statusCode, closeRun.body).toBe(201);
    expect(closeRun.json().closeRun.checks.find((check: any) => check.key === 'SUSPENSE').passed).toBe(true);

    const audit = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE company_id = $1 AND entity_type = 'suspense_resolution' ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['suspense.resolution_requested', 'suspense.resolution_posted']),
    );
    expect(suspenseJournal.status).toBe('POSTED');
  });

  it('reopens a locked period with a reason, permission and audit, then allows a new close run', async () => {
    const fixture = await createFixture('Reopen');
    const period = fixture.periods[4]!;
    const created = await createCloseRun(fixture, period.id);
    const runId = created.json().closeRun.id as string;
    await submitCloseRun(fixture, runId);
    const approved = await decideCloseRun(fixture, runId, 'APPROVE');
    expect(approved.statusCode, approved.body).toBe(200);

    const auditorReopen = await authed(
      app,
      fixture.auditorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/periods/${period.id}/reopen`,
      { reason: 'Auditor must not reopen' },
    );
    expect(auditorReopen.statusCode).toBe(403);

    const missingReason = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/periods/${period.id}/reopen`,
      { reason: 'x' },
    );
    expect(missingReason.statusCode).toBe(400);

    const reopened = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/periods/${period.id}/reopen`,
      { reason: 'Late supplier invoice received before the filing deadline' },
    );
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().status).toBe('OPEN');

    const run = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/close-runs/${runId}`,
    );
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().closeRun.status).toBe('REOPENED');
    expect(run.json().closeRun.reopenReason).toBe('Late supplier invoice received before the filing deadline');

    const newRun = await createCloseRun(fixture, period.id);
    expect(newRun.statusCode, newRun.body).toBe(201);
    expect(newRun.json().closeRun.status).toBe('DRAFT');

    const audit = await database.pool.query<{ reason: string | null; actor_user_id: string }>(
      `SELECT reason, actor_user_id FROM audit_events
        WHERE company_id = $1 AND action = 'period.reopened'`,
      [fixture.companyId],
    );
    expect(audit.rows[0]?.reason).toBe('Late supplier invoice received before the filing deadline');
    expect(audit.rows[0]?.actor_user_id).toBe(fixture.ownerId);
  });

  it('exposes an append-only audit log, exports it and isolates companies', async () => {
    const fixture = await createFixture('Audit');
    const other = await createFixture('AuditOther');
    const period = fixture.periods[5]!;
    const created = await createCloseRun(fixture, period.id);
    const runId = created.json().closeRun.id as string;
    await submitCloseRun(fixture, runId, fixture.ownerCookies, 'AUDIT-CLOSE-EVIDENCE');
    await decideCloseRun(fixture, runId, 'APPROVE');

    const list = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/audit-events?limit=200`,
    );
    expect(list.statusCode, list.body).toBe(200);
    const actions = list.json().entries.map((entry: any) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['close.run_created', 'close.run_submitted', 'close.run_approved', 'period.locked']),
    );
    expect(list.json().entries.every((entry: any) => entry.actorUserId)).toBe(true);

    const exported = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/audit-events/export.csv`,
    );
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('close.run_approved');
    expect(exported.body).toContain('period.locked');
    const exportAudit = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events
        WHERE company_id = $1 AND action = 'audit.exported'`,
      [fixture.companyId],
    );
    expect(exportAudit.rows[0]?.count).toBe('1');

    const crossCompany = await authed(
      app,
      other.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/close-runs/${runId}`,
    );
    expect(crossCompany.statusCode).toBe(404);

    const auditorWrite = await authed(
      app,
      fixture.auditorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/close-runs/${runId}/decide`,
      { decision: 'REJECT', reason: 'Auditor must remain read-only' },
    );
    expect(auditorWrite.statusCode).toBe(403);
  });
});
