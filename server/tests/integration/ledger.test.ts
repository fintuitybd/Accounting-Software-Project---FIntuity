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
  rjscNo: 'C-12345/2024',
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
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'ar',
    code: '1100',
    nameEn: 'Trade receivables',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'AR',
  },
  {
    key: 'ap',
    code: '2000',
    nameEn: 'Trade payables',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'AP',
  },
  {
    key: 'capital',
    code: '3000',
    nameEn: 'Share capital',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_CAPITAL',
    ifrsCategory: 'FINANCING',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenue',
    code: '4000',
    nameEn: 'Service revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
    ifrsCategory: 'OPERATING',
    controlSubledger: 'NONE',
  },
  {
    key: 'expense',
    code: '5000',
    nameEn: 'Office expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    ifrsCategory: 'OPERATING',
    controlSubledger: 'NONE',
  },
] as const;

interface Fixture {
  label: string;
  organisationId: string;
  companyId: string;
  ownerId: string;
  ownerCookies: AuthCookies;
  controllerId: string;
  controllerCookies: AuthCookies;
  accountantId: string;
  accountantCookies: AuthCookies;
  auditorId: string;
  auditorCookies: AuthCookies;
  accounts: Record<string, { id: string; code: string }>;
  periods: Array<{ id: string; code: string; status: string }>;
}

describe.skipIf(!databaseAvailable)('Phase 5 server-authoritative ledger', () => {
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

  async function authedWithHeaders(
    cookies: AuthCookies,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: string | Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: { ...authHeaders(cookies), ...headers },
      ...(payload === undefined ? {} : { payload }),
    });
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
      {
        legalName: `${label} Ltd`,
        tradeName: `${label} Trade`,
        ...COMPANY_PROFILE,
      },
    );
    expect(companyResponse.statusCode, companyResponse.body).toBe(201);
    const companyId = companyResponse.json().company.id as string;

    await seedCompanyMembership(database.pool, organisationId, companyId, controllerMembershipId);
    await seedCompanyMembership(database.pool, organisationId, companyId, accountantMembershipId);
    await seedCompanyMembership(database.pool, organisationId, companyId, auditorMembershipId);

    const fiscalResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
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
        ifrsCategory: account.ifrsCategory,
        controlSubledger: account.controlSubledger,
        taxMapping: {},
        isActive: true,
      });
      expect(response.statusCode, response.body).toBe(201);
      accounts[account.key] = { id: response.json().account.id, code: response.json().account.code };
    }

    return {
      label,
      organisationId,
      companyId,
      ownerId,
      ownerCookies,
      controllerId,
      controllerCookies,
      accountantId,
      accountantCookies,
      auditorId,
      auditorCookies,
      accounts,
      periods: fiscalYear.periods.map((period: any) => ({
        id: period.id,
        code: period.code,
        status: period.status,
      })),
    };
  }

  function journalBody(
    fixture: Fixture,
    overrides: Partial<{
      date: string;
      narration: string;
      debitAccount: string;
      creditAccount: string;
      amount: string;
      lineOverrides: Array<Record<string, unknown>>;
    }> = {},
  ): Record<string, unknown> {
    const debitAccount = overrides.debitAccount ?? fixture.accounts.bank!.id;
    const creditAccount = overrides.creditAccount ?? fixture.accounts.revenue!.id;
    const amount = overrides.amount ?? '1000.00';
    return {
      date: overrides.date ?? '2025-01-15',
      narration: overrides.narration ?? 'Manual test journal',
      attachmentReference: 'TEST-EVIDENCE-001',
      lines: overrides.lineOverrides ?? [
        { accountId: debitAccount, debit: amount, credit: '0', memo: 'Debit line' },
        { accountId: creditAccount, debit: '0', credit: amount, memo: 'Credit line' },
      ],
    };
  }

  async function createDraft(fixture: Fixture, body: Record<string, unknown>, cookies = fixture.accountantCookies) {
    const response = await authed(app, cookies, 'POST', `/api/v1/companies/${fixture.companyId}/journals`, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().journal;
  }

  async function submitJournal(fixture: Fixture, journalId: string, cookies = fixture.accountantCookies) {
    const response = await authed(
      app,
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/submit`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().journal;
  }

  async function postJournalRequest(
    fixture: Fixture,
    journalId: string,
    key?: string,
    cookies = fixture.accountantCookies,
  ) {
    return authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/post`,
      undefined,
      key ? { 'idempotency-key': key } : {},
    );
  }

  async function createSubmitAndPost(fixture: Fixture, body: Record<string, unknown>, key?: string) {
    const draft = await createDraft(fixture, body);
    await submitJournal(fixture, draft.id);
    const response = await postJournalRequest(fixture, draft.id, key);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().journal;
  }

  async function postOpeningBatch(fixture: Fixture, batchId: string, key?: string) {
    return authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances/${batchId}/post`,
      undefined,
      key ? { 'idempotency-key': key } : {},
    );
  }

  it('posts a balanced manual journal exactly once and returns it to another user', async () => {
    const fixture = await createFixture('Posting');
    const draft = await createDraft(fixture, journalBody(fixture));
    expect(draft.status).toBe('DRAFT');
    expect(draft.balanced).toBe(true);
    expect(draft.totalDebitPoisha).toBe('100000');
    expect(draft.totalCreditPoisha).toBe('100000');

    const submitted: any = await submitJournal(fixture, draft.id);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.submittedByName).toContain('Accountant');

    const first = await postJournalRequest(fixture, draft.id, 'journal-post-1');
    expect(first.statusCode, first.body).toBe(200);
    const posted = first.json().journal;
    expect(posted.status).toBe('POSTED');
    expect(posted.journalNumber).toBe('JE-2025-01-0001');
    expect(posted.postedAt).toBeTruthy();
    expect(posted.idempotencyKeyUsed).toBe(true);
    expect(first.json().replayed).toBe(false);

    const replay = await postJournalRequest(fixture, draft.id, 'journal-post-1');
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().journal.id).toBe(posted.id);
    expect(replay.json().journal.journalNumber).toBe(posted.journalNumber);

    const differentKey = await postJournalRequest(fixture, draft.id, 'journal-post-2');
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().code).toBe('JOURNAL_ALREADY_POSTED');

    const detail = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/journals/${draft.id}`,
    );
    expect(detail.statusCode, detail.body).toBe(200);
    const journal = detail.json().journal;
    expect(journal.lines).toHaveLength(2);
    expect(journal.lines.map((line: any) => line.accountCode)).toEqual(['1010', '4000']);
    expect(journal.auditTrail.map((event: any) => event.action)).toEqual(
      expect.arrayContaining(['journal.created', 'journal.submitted', 'journal.posted']),
    );

    const list = await authed(app, fixture.auditorCookies, 'GET', `/api/v1/companies/${fixture.companyId}/journals`);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().entries[0].journalNumber).toBe(posted.journalNumber);

    const trialBalance = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/trial-balance?periodId=${fixture.periods[0]!.id}`,
    );
    expect(trialBalance.statusCode, trialBalance.body).toBe(200);
    const tb = trialBalance.json().trialBalance;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closingDebitPoisha).toBe('100000');
    expect(tb.totals.closingCreditPoisha).toBe('100000');
    expect(tb.totals.differencePoisha).toBe('0');
    const bankRow = tb.rows.find((row: any) => row.accountCode === '1010');
    expect(bankRow.closingDebitPoisha).toBe('100000');
    const revenueRow = tb.rows.find((row: any) => row.accountCode === '4000');
    expect(revenueRow.closingCreditPoisha).toBe('100000');

    const drill = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/trial-balance/${fixture.accounts.bank!.id}?periodId=${fixture.periods[0]!.id}`,
    );
    expect(drill.statusCode, drill.body).toBe(200);
    expect(drill.json().lines).toHaveLength(1);
    expect(drill.json().lines[0].journalNumber).toBe(posted.journalNumber);
    expect(drill.json().lines[0].runningNetPoisha).toBe('100000');

    const stored = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals WHERE company_id = $1`,
      [fixture.companyId],
    );
    expect(stored.rows[0]!.count).toBe('1');
  });

  it('rejects unbalanced, zero-line, unknown-account and inactive-account journals, and the database rejects unbalanced posted rows', async () => {
    const fixture = await createFixture('Validation');

    const zeroLines = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      { date: '2025-01-15', narration: 'Zero lines', lines: [] },
    );
    expect(zeroLines.statusCode).toBe(400);
    expect(zeroLines.json().code).toBe('VALIDATION_FAILED');

    const unbalanced = await createDraft(
      fixture,
      journalBody(fixture, {
        lineOverrides: [
          { accountId: fixture.accounts.bank!.id, debit: '100.00', credit: '0' },
          { accountId: fixture.accounts.revenue!.id, debit: '0', credit: '50.00' },
        ],
      }),
    );
    expect(unbalanced.totalDebitPoisha).toBe('10000');
    expect(unbalanced.totalCreditPoisha).toBe('5000');
    expect(unbalanced.balanced).toBe(false);
    const unbalancedSubmit = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${unbalanced.id}/submit`,
    );
    expect(unbalancedSubmit.statusCode).toBe(409);
    expect(unbalancedSubmit.json().code).toBe('JOURNAL_UNBALANCED');

    const unknown = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      journalBody(fixture, { creditAccount: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('JOURNAL_ACCOUNT_INVALID');

    await database.pool.query(`UPDATE accounts SET is_active = false WHERE company_id = $1 AND id = $2`, [
      fixture.companyId,
      fixture.accounts.expense!.id,
    ]);
    const inactive = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      journalBody(fixture, {
        debitAccount: fixture.accounts.bank!.id,
        creditAccount: fixture.accounts.expense!.id,
      }),
    );
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().code).toBe('JOURNAL_ACCOUNT_INACTIVE');

    // Database backstop: a DRAFT may be unbalanced, but promoting it to POSTED at the SQL layer
    // must fail at COMMIT because the deferred integrity trigger recomputes the lines.
    const periodId = fixture.periods[0]!.id;
    const inserted = await database.pool.query<{ id: string }>(
      `INSERT INTO journals (
         company_id, book_type, period_id, document_date, posting_date, source_module,
         narration_en, currency, status, created_by
       ) VALUES ($1,'STATUTORY_BD',$2,'2025-01-20','2025-01-20','MANUAL_JOURNAL',
                 'Database trigger check','BDT','DRAFT',$3)
       RETURNING id`,
      [fixture.companyId, periodId, fixture.ownerId],
    );
    const journalId = inserted.rows[0]!.id;
    await database.pool.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_no, account_id, debit_poisha, credit_poisha)
       VALUES ($1,$2,1,$3,5000,0), ($1,$2,2,$4,0,1000)`,
      [fixture.companyId, journalId, fixture.accounts.bank!.id, fixture.accounts.revenue!.id],
    );
    await expect(
      database.pool.query(
        `UPDATE journals
            SET status = 'POSTED', journal_number = 'DB-BAD-1', posted_at = now(), posted_by = $3
          WHERE company_id = $1 AND id = $2`,
        [fixture.companyId, journalId, fixture.ownerId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces OPEN/CLOSED/LOCKED/UNKNOWN periods server-side and audits controlled close and reopen', async () => {
    const fixture = await createFixture('Periods');
    const january = fixture.periods[0]!;
    const february = fixture.periods[1]!;

    // A legacy/manual CLOSED state must still reject normal posting. New closes use the controlled
    // close workflow below; this fixture simulates a period already closed by an earlier process.
    await database.pool.query(`UPDATE periods SET status = 'CLOSED' WHERE company_id = $1 AND id = $2`, [
      fixture.companyId,
      january.id,
    ]);

    const januaryDraft = await createDraft(fixture, journalBody(fixture, { date: '2025-01-15' }));
    const submitClosed = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${januaryDraft.id}/submit`,
    );
    expect(submitClosed.statusCode).toBe(409);
    expect(submitClosed.json().code).toBe('PERIOD_NOT_OPEN');

    const directPostClosed = await postJournalRequest(fixture, januaryDraft.id, 'closed-period-post');
    expect(directPostClosed.statusCode).toBe(409);
    expect(directPostClosed.json().code).toBe('PERIOD_NOT_OPEN');

    const unknownDate = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      journalBody(fixture, { date: '2026-02-15' }),
    );
    expect(unknownDate.statusCode).toBe(400);
    expect(unknownDate.json().code).toBe('PERIOD_NOT_FOUND');

    const reopen = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/periods/${january.id}/reopen`,
      { reason: 'Late adjusting journal approved by the controller' },
    );
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(reopen.json().status).toBe('OPEN');
    await submitJournal(fixture, januaryDraft.id);
    const posted = await postJournalRequest(fixture, januaryDraft.id, 'reopened-period-post');
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().journal.status).toBe('POSTED');

    const closeRun = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/close-runs`,
      { periodId: february.id },
    );
    expect(closeRun.statusCode, closeRun.body).toBe(201);
    const runId = closeRun.json().closeRun.id as string;
    const submittedRun = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/close-runs/${runId}/submit`,
      { evidenceReference: 'CLOSE-EVIDENCE-2025-02' },
    );
    expect(submittedRun.statusCode, submittedRun.body).toBe(200);
    const approvedRun = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/close-runs/${runId}/decide`,
      { decision: 'APPROVE', reason: 'February controls reviewed and approved' },
    );
    expect(approvedRun.statusCode, approvedRun.body).toBe(200);
    expect(approvedRun.json().closeRun.periodStatus).toBe('LOCKED');
    expect(approvedRun.json().closeRun.preparedBy).not.toBe(approvedRun.json().closeRun.decidedBy);

    const februaryDraft = await createDraft(fixture, journalBody(fixture, { date: '2025-02-10' }));
    const submitLocked = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${februaryDraft.id}/submit`,
    );
    expect(submitLocked.statusCode).toBe(409);
    expect(submitLocked.json().code).toBe('PERIOD_NOT_OPEN');
    expect(submitLocked.json().details.status).toBe('LOCKED');

    const audit = await database.pool.query<{ action: string; reason: string; actor_user_id: string }>(
      `SELECT action, reason, actor_user_id FROM audit_events
        WHERE company_id = $1 AND entity_type IN ('period', 'close_run')
          AND action IN ('period.reopened', 'close.run_created', 'close.run_submitted', 'close.run_approved', 'period.locked')
        ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'period.reopened',
        'close.run_created',
        'close.run_submitted',
        'close.run_approved',
        'period.locked',
      ]),
    );
    expect(audit.rows.find((row) => row.action === 'period.reopened')?.reason).toBe(
      'Late adjusting journal approved by the controller',
    );
    expect(audit.rows.find((row) => row.action === 'close.run_approved')?.actor_user_id).toBe(fixture.controllerId);
  });

  it('allocates unique sequential numbers under concurrency and fails loudly when the sequence is forced backwards', async () => {
    const fixture = await createFixture('Concurrency');
    const firstDraft = await createDraft(fixture, journalBody(fixture, { narration: 'Concurrent A' }));
    const secondDraft = await createDraft(fixture, journalBody(fixture, { narration: 'Concurrent B' }));
    await submitJournal(fixture, firstDraft.id);
    await submitJournal(fixture, secondDraft.id);

    const [firstResponse, secondResponse] = await Promise.all([
      postJournalRequest(fixture, firstDraft.id, 'concurrent-a'),
      postJournalRequest(fixture, secondDraft.id, 'concurrent-b'),
    ]);
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    expect(secondResponse.statusCode, secondResponse.body).toBe(200);
    const numbers = [firstResponse.json().journal.journalNumber, secondResponse.json().journal.journalNumber].sort();
    expect(numbers).toEqual(['JE-2025-01-0001', 'JE-2025-01-0002']);

    await database.pool.query(
      `UPDATE number_sequences SET next_value = 1 WHERE company_id = $1 AND doc_type = 'JOURNAL'`,
      [fixture.companyId],
    );
    const conflictDraft = await createDraft(fixture, journalBody(fixture, { narration: 'Sequence conflict' }));
    await submitJournal(fixture, conflictDraft.id);
    const conflict = await postJournalRequest(fixture, conflictDraft.id, 'sequence-conflict');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('JOURNAL_NUMBER_CONFLICT');

    const postedCount = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals WHERE company_id = $1 AND status = 'POSTED'`,
      [fixture.companyId],
    );
    expect(postedCount.rows[0]!.count).toBe('2');

    const sameDraft = await createDraft(fixture, journalBody(fixture, { narration: 'Same journal race' }));
    await submitJournal(fixture, sameDraft.id);
    await database.pool.query(
      `UPDATE number_sequences SET next_value = 3 WHERE company_id = $1 AND doc_type = 'JOURNAL'`,
      [fixture.companyId],
    );
    const same = await Promise.all([
      postJournalRequest(fixture, sameDraft.id, 'same-key'),
      postJournalRequest(fixture, sameDraft.id, 'same-key'),
    ]);
    expect(same.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(same.map((response) => response.json().replayed).sort()).toEqual([false, true]);
    expect(same[0]!.json().journal.id).toBe(same[1]!.json().journal.id);
  });

  it('reverses a posted journal with a linked, reason-bearing reversal and blocks a second reversal', async () => {
    const fixture = await createFixture('Reversal');
    const posted = await createSubmitAndPost(fixture, journalBody(fixture), 'reversal-original');

    const reversal = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${posted.id}/reverse`,
      { date: '2025-02-01', reason: 'Correction of revenue classification' },
    );
    expect(reversal.statusCode, reversal.body).toBe(200);
    const original = reversal.json().original;
    const reversalJournal = reversal.json().reversal;
    expect(original.status).toBe('REVERSED');
    expect(original.reversedByJournalId).toBe(reversalJournal.id);
    expect(original.reversalReason).toBe('Correction of revenue classification');
    expect(original.reversalJournalNumber).toBe('JE-2025-02-0002');
    expect(reversalJournal.status).toBe('POSTED');
    expect(reversalJournal.reversalOfJournalId).toBe(posted.id);
    expect(reversalJournal.sourceModule).toBe('REVERSAL');
    expect(reversalJournal.totalDebitPoisha).toBe('100000');
    expect(reversalJournal.totalCreditPoisha).toBe('100000');

    const trialBalance = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/trial-balance?from=2025-01-01&to=2025-02-28`,
    );
    expect(trialBalance.statusCode, trialBalance.body).toBe(200);
    const tb = trialBalance.json().trialBalance;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closingDebitPoisha).toBe('0');
    expect(tb.totals.closingCreditPoisha).toBe('0');
    const bankRow = tb.rows.find((row: any) => row.accountCode === '1010');
    expect(bankRow.closingNetPoisha).toBe('0');

    const second = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${posted.id}/reverse`,
      { date: '2025-02-02', reason: 'Second attempt' },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('REVERSAL_ALREADY_EXISTS');

    const reverseReversal = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${reversalJournal.id}/reverse`,
      { date: '2025-02-03', reason: 'Reverse the reversal' },
    );
    expect(reverseReversal.statusCode).toBe(409);
    expect(reverseReversal.json().code).toBe('REVERSAL_OF_REVERSAL');

    const audit = await database.pool.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_events
        WHERE company_id = $1 AND entity_type = 'journal' AND action = 'journal.reversed'`,
      [fixture.companyId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.reason).toBe('Correction of revenue classification');
  });

  it('posts an approved opening-balance batch once, links it permanently and agrees to the trial balance', async () => {
    const fixture = await createFixture('Opening');
    const draftResponse = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances`,
      {
        batchDate: '2025-01-01',
        evidenceReference: 'Board resolution 2025-01 and bank certificate',
        evidenceNote: 'Opening position agreed by the directors.',
        lines: [
          {
            accountId: fixture.accounts.bank!.id,
            debit: '5000.00',
            credit: '0',
            scheduleType: 'ACCOUNT',
            schedule: {},
          },
          {
            accountId: fixture.accounts.capital!.id,
            debit: '0',
            credit: '5000.00',
            scheduleType: 'ACCOUNT',
            schedule: {},
          },
        ],
      },
    );
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const batch = draftResponse.json().batch;
    expect(batch.status).toBe('DRAFT');

    const submit = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances/${batch.id}/submit`,
    );
    expect(submit.statusCode, submit.body).toBe(200);
    expect(submit.json().batch.status).toBe('SUBMITTED');

    const beforeApproval = await postOpeningBatch(fixture, batch.id, 'opening-post-1');
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.json().code).toBe('OPENING_BATCH_NOT_APPROVED');

    const selfApproval = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances/${batch.id}/approve`,
    );
    expect(selfApproval.statusCode).toBe(409);
    expect(selfApproval.json().code).toBe('OPENING_BATCH_SELF_APPROVAL');

    const approval = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances/${batch.id}/approve`,
    );
    expect(approval.statusCode, approval.body).toBe(200);
    expect(approval.json().batch.status).toBe('APPROVED');

    const posted = await postOpeningBatch(fixture, batch.id, 'opening-post-1');
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().batch.status).toBe('POSTED');
    expect(posted.json().journal.status).toBe('POSTED');
    expect(posted.json().journal.sourceModule).toBe('OPENING_BALANCE');
    expect(posted.json().journal.sourceDocId).toBe(batch.id);
    expect(posted.json().batch.journalId).toBe(posted.json().journal.id);
    expect(posted.json().batch.journalNumber).toBe('JE-2025-01-0001');

    const replay = await postOpeningBatch(fixture, batch.id, 'opening-post-1');
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().batch.journalId).toBe(posted.json().journal.id);

    const duplicate = await postOpeningBatch(fixture, batch.id, 'opening-post-2');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('OPENING_BATCH_ALREADY_POSTED');

    const secondBatch = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/opening-balances`,
      {
        batchDate: '2025-01-02',
        evidenceReference: 'Second opening attempt',
        lines: [
          { accountId: fixture.accounts.bank!.id, debit: '1.00', credit: '0', scheduleType: 'ACCOUNT', schedule: {} },
          {
            accountId: fixture.accounts.capital!.id,
            debit: '0',
            credit: '1.00',
            scheduleType: 'ACCOUNT',
            schedule: {},
          },
        ],
      },
    );
    expect(secondBatch.statusCode).toBe(409);
    expect(secondBatch.json().code).toBe('OPENING_BATCH_ALREADY_POSTED');

    const trialBalance = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/trial-balance?periodId=${fixture.periods[0]!.id}`,
    );
    expect(trialBalance.statusCode, trialBalance.body).toBe(200);
    const tb = trialBalance.json().trialBalance;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closingDebitPoisha).toBe('500000');
    expect(tb.totals.closingCreditPoisha).toBe('500000');
    expect(tb.rows.find((row: any) => row.accountCode === '1010').closingDebitPoisha).toBe('500000');
    expect(tb.rows.find((row: any) => row.accountCode === '3000').closingCreditPoisha).toBe('500000');

    const openingAudit = await database.pool.query<{ action: string; actor_user_id: string }>(
      `SELECT action, actor_user_id FROM audit_events
        WHERE company_id = $1 AND entity_type = 'opening_balance_batch'
          AND action IN ('opening_balance.approved', 'opening_balance.posted')
        ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    expect(openingAudit.rows).toEqual([
      { action: 'opening_balance.approved', actor_user_id: fixture.controllerId },
      { action: 'opening_balance.posted', actor_user_id: fixture.accountantId },
    ]);

    const reverseOpening = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${posted.json().journal.id}/reverse`,
      { date: '2025-02-01', reason: 'Opening balances superseded by audited schedule' },
    );
    expect(reverseOpening.statusCode, reverseOpening.body).toBe(200);
    const reversedBatch = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/opening-balances/${batch.id}`,
    );
    expect(reversedBatch.json().batch.status).toBe('REVERSED');
    expect(reversedBatch.json().batch.reversalJournalId).toBe(reverseOpening.json().reversal.id);
  });

  it('requires high-value approval when configured and prevents self-approval', async () => {
    const fixture = await createFixture('Approval');
    const settings = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      { approvalThresholds: { highValue: '100.00', payment: '0.00' } },
    );
    expect(settings.statusCode, settings.body).toBe(200);

    const journal = await createDraft(fixture, journalBody(fixture, { amount: '100.00' }));
    await submitJournal(fixture, journal.id);
    const blocked = await postJournalRequest(fixture, journal.id, 'approval-needed');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('JOURNAL_APPROVAL_REQUIRED');
    expect(blocked.json().details.thresholdBdt).toBe('100.00');

    const accountantApproval = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journal.id}/approve`,
    );
    expect(accountantApproval.statusCode).toBe(403);

    const approval = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journal.id}/approve`,
    );
    expect(approval.statusCode, approval.body).toBe(200);
    expect(approval.json().journal.status).toBe('APPROVED');

    const posted = await postJournalRequest(fixture, journal.id, 'approval-needed');
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().journal.status).toBe('POSTED');

    // A controller can create and submit, but cannot approve their own journal.
    const selfDraft = await createDraft(
      fixture,
      journalBody(fixture, { amount: '150.00', narration: 'Self approval' }),
      fixture.controllerCookies,
    );
    await submitJournal(fixture, selfDraft.id, fixture.controllerCookies);
    const selfApproval = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${selfDraft.id}/approve`,
    );
    expect(selfApproval.statusCode).toBe(409);
    expect(selfApproval.json().code).toBe('JOURNAL_SELF_APPROVAL');
  });

  it('requires a different controller to reverse a high-value journal', async () => {
    const fixture = await createFixture('ReversalApproval');
    const settings = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      { approvalThresholds: { highValue: '100.00', payment: '0.00' } },
    );
    expect(settings.statusCode, settings.body).toBe(200);

    const draft = await createDraft(
      fixture,
      journalBody(fixture, { amount: '125.00', narration: 'High-value reversal approval' }),
      fixture.ownerCookies,
    );
    const submitted = await submitJournal(fixture, draft.id, fixture.ownerCookies);
    expect(submitted.status).toBe('SUBMITTED');
    const approved = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${draft.id}/approve`,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const posted = await postJournalRequest(fixture, draft.id, 'high-value-reversal', fixture.ownerCookies);
    expect(posted.statusCode, posted.body).toBe(200);

    const selfReversal = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${draft.id}/reverse`,
      { date: '2025-02-01', reason: 'Owner attempts to reverse own high-value journal' },
    );
    expect(selfReversal.statusCode).toBe(403);
    expect(selfReversal.json().code).toBe('REVERSAL_SELF_APPROVAL');

    const reversal = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${draft.id}/reverse`,
      { date: '2025-02-01', reason: 'Different controller reverses the high-value journal' },
    );
    expect(reversal.statusCode, reversal.body).toBe(200);
    expect(reversal.json().original.status).toBe('REVERSED');
    expect(reversal.json().reversal.status).toBe('POSTED');
  });

  it('isolates tenants and makes the auditor read-only at the API', async () => {
    const fixtureA = await createFixture('TenantA');
    const fixtureB = await createFixture('TenantB');
    const posted = await createSubmitAndPost(fixtureA, journalBody(fixtureA), 'tenant-a-post');

    const crossRead = await authed(
      app,
      fixtureB.ownerCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/journals/${posted.id}`,
    );
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.json().code).toBe('COMPANY_NOT_FOUND');

    const crossPost = await authed(
      app,
      fixtureB.ownerCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/journals/${posted.id}/post`,
    );
    expect(crossPost.statusCode).toBe(404);
    expect(crossPost.json().code).toBe('COMPANY_NOT_FOUND');

    const crossTrialBalance = await authed(
      app,
      fixtureB.ownerCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/trial-balance?from=2025-01-01&to=2025-01-31`,
    );
    expect(crossTrialBalance.statusCode).toBe(404);

    const crossOpening = await authed(
      app,
      fixtureB.ownerCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/opening-balances`,
    );
    expect(crossOpening.statusCode).toBe(404);
    expect(crossOpening.json().code).toBe('COMPANY_NOT_FOUND');

    const crossAccount = await authed(
      app,
      fixtureB.accountantCookies,
      'POST',
      `/api/v1/companies/${fixtureB.companyId}/journals`,
      journalBody(fixtureB, { creditAccount: fixtureA.accounts.revenue!.id }),
    );
    expect(crossAccount.statusCode).toBe(400);
    expect(crossAccount.json().code).toBe('JOURNAL_ACCOUNT_INVALID');

    const auditorList = await authed(
      app,
      fixtureA.auditorCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/journals`,
    );
    expect(auditorList.statusCode).toBe(200);
    const auditorDetail = await authed(
      app,
      fixtureA.auditorCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/journals/${posted.id}`,
    );
    expect(auditorDetail.statusCode).toBe(200);
    const auditorTrialBalance = await authed(
      app,
      fixtureA.auditorCookies,
      'GET',
      `/api/v1/companies/${fixtureA.companyId}/trial-balance?from=2025-01-01&to=2025-01-31`,
    );
    expect(auditorTrialBalance.statusCode).toBe(200);

    const auditorDraft = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/journals`,
      journalBody(fixtureA, { narration: 'Auditor must not write' }),
    );
    expect(auditorDraft.statusCode).toBe(403);
    expect(auditorDraft.json().code).toBe('FORBIDDEN');

    const draftForPatch = await createDraft(fixtureA, journalBody(fixtureA, { narration: 'Patch target' }));
    const auditorPatch = await authed(
      app,
      fixtureA.auditorCookies,
      'PATCH',
      `/api/v1/companies/${fixtureA.companyId}/journals/${draftForPatch.id}`,
      journalBody(fixtureA, { narration: 'Auditor patch' }),
    );
    expect(auditorPatch.statusCode).toBe(403);

    const auditorSubmit = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/journals/${draftForPatch.id}/submit`,
    );
    expect(auditorSubmit.statusCode).toBe(403);

    const auditorApprove = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/journals/${posted.id}/approve`,
    );
    expect(auditorApprove.statusCode).toBe(403);

    const auditorReverse = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/journals/${posted.id}/reverse`,
      { date: '2025-02-01', reason: 'Auditor must not reverse' },
    );
    expect(auditorReverse.statusCode).toBe(403);

    const auditorPeriod = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/close-runs`,
      { periodId: fixtureA.periods[0]!.id },
    );
    expect(auditorPeriod.statusCode).toBe(403);

    const auditorOpening = await authed(
      app,
      fixtureA.auditorCookies,
      'POST',
      `/api/v1/companies/${fixtureA.companyId}/opening-balances`,
      {
        batchDate: '2025-01-02',
        evidenceReference: 'Auditor must not prepare',
        lines: [
          { accountId: fixtureA.accounts.bank!.id, debit: '1.00', credit: '0' },
          { accountId: fixtureA.accounts.capital!.id, debit: '0', credit: '1.00' },
        ],
      },
    );
    expect(auditorOpening.statusCode).toBe(403);
  });
});
