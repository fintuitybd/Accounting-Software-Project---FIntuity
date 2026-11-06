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
  seedCompany,
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
    key: 'bankMain',
    code: '1010',
    nameEn: 'Main bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'bankSplit',
    code: '1020',
    nameEn: 'Split bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'bankGl',
    code: '1030',
    nameEn: 'GL creation bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'bankMfs',
    code: '1040',
    nameEn: 'MFS wallet',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'bankRecon',
    code: '1050',
    nameEn: 'Reconciliation bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'bankTransferTarget',
    code: '1060',
    nameEn: 'Transfer target bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'expense',
    code: '5200',
    nameEn: 'Operating expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    controlSubledger: 'NONE',
  },
  {
    key: 'fee',
    code: '5820',
    nameEn: 'Bank and MFS charges',
    accountType: 'EXPENSE',
    subCategory: 'FINANCE_COST',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenue',
    code: '4100',
    nameEn: 'Service revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
    controlSubledger: 'NONE',
  },
  {
    key: 'equity',
    code: '3100',
    nameEn: 'Share capital',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_CAPITAL',
    controlSubledger: 'NONE',
  },
  {
    key: 'suspense',
    code: '2190',
    nameEn: 'Suspense clearing',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
] as const;

interface Fixture {
  organisationId: string;
  companyId: string;
  secondCompanyId: string;
  outsiderCookies: AuthCookies;
  ownerCookies: AuthCookies;
  controllerCookies: AuthCookies;
  accountantCookies: AuthCookies;
  operatorCookies: AuthCookies;
  auditorCookies: AuthCookies;
  ownerId: string;
  accountantId: string;
  accounts: Record<string, { id: string; code: string }>;
  bankAccounts: Record<string, { id: string; name: string }>;
  periods: Record<string, string>;
}

describe.skipIf(!databaseAvailable)('Phase 10 banking, MFS and reconciliation', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let fixture: Fixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
    fixture = await createFixture();
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

  async function createFixture(): Promise<Fixture> {
    const suffix = unique('Banking');
    const organisationId = await seedOrganisation(database.pool, `Organisation ${suffix}`);
    const emails = {
      owner: `owner-${suffix}@example.test`,
      controller: `controller-${suffix}@example.test`,
      accountant: `accountant-${suffix}@example.test`,
      operator: `operator-${suffix}@example.test`,
      auditor: `auditor-${suffix}@example.test`,
      outsider: `outsider-${suffix}@example.test`,
    };
    const ownerId = await seedUser(database.pool, { email: emails.owner, name: `Owner ${suffix}` });
    const controllerId = await seedUser(database.pool, { email: emails.controller, name: `Controller ${suffix}` });
    const accountantId = await seedUser(database.pool, { email: emails.accountant, name: `Accountant ${suffix}` });
    const operatorId = await seedUser(database.pool, { email: emails.operator, name: `Operator ${suffix}` });
    const auditorId = await seedUser(database.pool, { email: emails.auditor, name: `Auditor ${suffix}` });
    const outsiderId = await seedUser(database.pool, { email: emails.outsider, name: `Outsider ${suffix}` });
    await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
    const controllerMembership = await seedMembership(database.pool, organisationId, controllerId, 'CONTROLLER');
    const accountantMembership = await seedMembership(database.pool, organisationId, accountantId, 'ACCOUNTANT');
    const operatorMembership = await seedMembership(database.pool, organisationId, operatorId, 'OPERATOR');
    const auditorMembership = await seedMembership(database.pool, organisationId, auditorId, 'AUDITOR');

    const ownerCookies = (await login(app, emails.owner)).cookies;
    const controllerCookies = (await login(app, emails.controller)).cookies;
    const accountantCookies = (await login(app, emails.accountant)).cookies;
    const operatorCookies = (await login(app, emails.operator)).cookies;
    const auditorCookies = (await login(app, emails.auditor)).cookies;

    const outsiderOrgId = await seedOrganisation(database.pool, `Outsider Org ${suffix}`);
    const outsiderCompanyId = await seedCompany(database.pool, outsiderOrgId, `Outsider Co ${suffix}`);
    const outsiderMembership = await seedMembership(database.pool, outsiderOrgId, outsiderId, 'OWNER');
    await seedCompanyMembership(database.pool, outsiderOrgId, outsiderCompanyId, outsiderMembership);
    const outsiderCookies = (await login(app, emails.outsider)).cookies;

    const companyResponse = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/organisations/${organisationId}/companies`,
      { legalName: `${suffix} Ltd`, ...COMPANY_PROFILE },
    );
    expect(companyResponse.statusCode, companyResponse.body).toBe(201);
    const companyId = companyResponse.json().company.id as string;
    const secondCompanyResponse = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/organisations/${organisationId}/companies`,
      { legalName: `${suffix} Second Ltd`, ...COMPANY_PROFILE },
    );
    expect(secondCompanyResponse.statusCode, secondCompanyResponse.body).toBe(201);
    const secondCompanyId = secondCompanyResponse.json().company.id as string;
    for (const membershipId of [controllerMembership, accountantMembership, operatorMembership, auditorMembership]) {
      await seedCompanyMembership(database.pool, organisationId, companyId, membershipId);
    }

    const fiscalResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(fiscalResponse.statusCode, fiscalResponse.body).toBe(201);

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

    const bankAccounts: Record<string, { id: string; name: string }> = {};
    const bankInputs = [
      { key: 'main', name: 'Main bank', gl: 'bankMain', kind: 'BANK', provider: 'Test Bank', masked: '****1001' },
      { key: 'split', name: 'Split bank', gl: 'bankSplit', kind: 'BANK', provider: 'Test Bank', masked: '****1002' },
      { key: 'gl', name: 'GL creation bank', gl: 'bankGl', kind: 'BANK', provider: 'Test Bank', masked: '****1003' },
      { key: 'mfs', name: 'MFS wallet', gl: 'bankMfs', kind: 'MFS', provider: 'bKash', masked: '****1004' },
      {
        key: 'recon',
        name: 'Reconciliation bank',
        gl: 'bankRecon',
        kind: 'BANK',
        provider: 'Test Bank',
        masked: '****1005',
      },
      {
        key: 'target',
        name: 'Transfer target',
        gl: 'bankTransferTarget',
        kind: 'BANK',
        provider: 'Test Bank',
        masked: '****1006',
      },
    ] as const;
    for (const [index, input] of bankInputs.entries()) {
      const response = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/bank-accounts`, {
        name: input.name,
        kind: input.kind,
        provider: input.provider,
        maskedNumber: input.masked,
        branch: 'Dhaka',
        glAccountId: accounts[input.gl]!.id,
        openingBalance: '0.00',
        isPrincipal: index === 0,
      });
      expect(response.statusCode, response.body).toBe(201);
      bankAccounts[input.key] = { id: response.json().bankAccount.id, name: input.name };
    }

    const periodsResult = await database.pool.query<{ id: string; code: string }>(
      `SELECT id, code FROM periods WHERE company_id = $1 AND code IN ('2026-01', '2026-03') ORDER BY code`,
      [companyId],
    );
    const periods = Object.fromEntries(periodsResult.rows.map((row) => [row.code, row.id]));

    const feeRuleResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/bank-fee-rules`, {
      bankAccountId: bankAccounts.mfs!.id,
      rateBps: 150,
      fixedPoisha: '0.00',
      feeAccountId: accounts.fee!.id,
      policyReference: 'bKash merchant tariff schedule TEST-2026-01, reviewed by finance',
      effectiveFrom: '2026-01-01',
    });
    expect(feeRuleResponse.statusCode, feeRuleResponse.body).toBe(201);

    return {
      organisationId,
      companyId,
      secondCompanyId,
      outsiderCookies,
      ownerCookies,
      controllerCookies,
      accountantCookies,
      operatorCookies,
      auditorCookies,
      ownerId,
      accountantId,
      accounts,
      bankAccounts,
      periods,
    };
  }

  async function postManualJournal(
    cookies: AuthCookies,
    input: {
      date: string;
      narration: string;
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    },
  ) {
    const draft = await authedWithHeaders(cookies, 'POST', `/api/v1/companies/${fixture.companyId}/journals`, input);
    expect(draft.statusCode, draft.body).toBe(201);
    const journalId = draft.json().journal.id as string;
    const posted = await authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/post`,
      undefined,
      { 'idempotency-key': `test-journal-${journalId}` },
    );
    expect(posted.statusCode, posted.body).toBe(200);
    return posted.json().journal as {
      id: string;
      journalNumber: string;
      lines: Array<{ id: string; accountCode: string; debitPoisha: string; creditPoisha: string }>;
    };
  }

  async function previewAndImport(cookies: AuthCookies, bankAccountId: string, csv: string, fileName: string) {
    const preview = await authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/statements/preview`,
      { content: csv },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const imported = await authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/statements/import`,
      { content: csv, sourceFileName: fileName, sourceMimeType: 'text/csv' },
      { 'idempotency-key': `test-import-${randomUUID()}` },
    );
    expect(imported.statusCode, imported.body).toBe(201);
    return { preview: preview.json().preview, imported: imported.json() };
  }

  async function linesFor(bankAccountId: string, cookies = fixture.ownerCookies) {
    const response = await authedWithHeaders(
      cookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/bank-lines?limit=500`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().entries as Array<{
      id: string;
      status: string;
      debitPoisha: string;
      creditPoisha: string;
      valueDate: string;
      reference: string | null;
    }>;
  }

  it('previews and imports a CSV with invalid and duplicate rows without posting', async () => {
    const csv = [
      'date,description,reference,debit,credit,balance',
      '2026-01-15,Office rent paid,RENT-001,,125.00,875.00',
      '2026-01-15,Office rent paid,RENT-001,,125.00,875.00',
      '2026-13-40,Bad date row,BAD-1,,5.00,870.00',
      '2026-01-17,,MISSING-DESC,,5.00,865.00',
      '2026-01-18,Zero amount,ZERO,,,865.00',
    ].join('\n');
    const beforeJournals = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals WHERE company_id = $1`,
      [fixture.companyId],
    );
    const preview = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.main!.id}/statements/preview`,
      { content: csv },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json().preview;
    expect(body.summary.rowCount).toBe(5);
    expect(body.summary.validCount).toBe(1);
    expect(body.summary.errorCount).toBe(4);
    expect(body.summary.duplicateCount).toBe(1);
    expect(
      body.rows.some((row: { errors: Array<{ code: string }> }) =>
        row.errors.some((error) => error.code === 'BANK_STATEMENT_DUPLICATE_IN_FILE'),
      ),
    ).toBe(true);
    expect(
      body.rows.some((row: { errors: Array<{ code: string }> }) =>
        row.errors.some((error) => error.code === 'BANK_STATEMENT_AMOUNT_SIDE_INVALID'),
      ),
    ).toBe(true);

    const imported = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.main!.id}/statements/import`,
      { content: csv, sourceFileName: 'january.csv', sourceMimeType: 'text/csv' },
      { 'idempotency-key': `test-import-${randomUUID()}` },
    );
    expect(imported.statusCode, imported.body).toBe(201);
    const statement = imported.json().statement;
    expect(statement.status).toBe('PARTIAL');
    expect(statement.validCount).toBe(1);
    expect(statement.errorCount).toBe(4);
    expect(statement.duplicateCount).toBe(1);
    const lines = await linesFor(fixture.bankAccounts.main!.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe('UNMATCHED');
    const assignment = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${lines[0]!.id}/assign-exception`,
      {
        ownerUserId: fixture.accountantId,
        note: 'Assigned to the accountant to obtain the bank advice.',
      },
    );
    expect(assignment.statusCode, assignment.body).toBe(200);
    expect(assignment.json().line.exceptionOwnerId).toBe(fixture.accountantId);
    expect(assignment.json().line.exceptionOwnerName).toContain('Accountant');
    const afterJournals = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals WHERE company_id = $1`,
      [fixture.companyId],
    );
    expect(afterJournals.rows[0]!.count).toBe(beforeJournals.rows[0]!.count);

    const duplicateFile = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.main!.id}/statements/import`,
      { content: csv, sourceFileName: 'january-again.csv', sourceMimeType: 'text/csv' },
      { 'idempotency-key': `test-import-${randomUUID()}` },
    );
    expect(duplicateFile.statusCode).toBe(409);
    expect(duplicateFile.json().code).toBe('BANK_STATEMENT_DUPLICATE_FILE');
  });

  it('matches exactly, explains the score, prevents double matching and supports an explicit split', async () => {
    const journal = await postManualJournal(fixture.ownerCookies, {
      date: '2026-01-20',
      narration: 'Office rent paid RENT-002',
      lines: [
        { accountId: fixture.accounts.expense!.id, debit: '125.00', credit: '0' },
        { accountId: fixture.accounts.bankMain!.id, debit: '0', credit: '125.00' },
      ],
    });
    const bankLine = journal.lines.find((line) => line.accountCode === '1010')!;
    const { imported } = await previewAndImport(
      fixture.ownerCookies,
      fixture.bankAccounts.main!.id,
      ['date,description,reference,debit,credit,balance', '2026-01-20,Office rent paid,RENT-002,,125.00,750.00'].join(
        '\n',
      ),
      'rent-002.csv',
    );
    expect(imported.statement.validCount).toBe(1);
    const lines = await linesFor(fixture.bankAccounts.main!.id);
    const rentLine = lines.find((line) => line.reference === 'RENT-002')!;
    const candidatesResponse = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${rentLine.id}/candidates?windowDays=7`,
    );
    expect(candidatesResponse.statusCode, candidatesResponse.body).toBe(200);
    const candidates = candidatesResponse.json().candidates;
    const candidate = candidates.find((entry: { journalLineId: string }) => entry.journalLineId === bankLine.id);
    expect(candidate).toBeTruthy();
    expect(candidate.score).toBeGreaterThanOrEqual(80);
    expect(candidate.reason).toContain('Exact available amount');
    expect(candidate.reason).toContain('reference matched');

    const matched = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${rentLine.id}/match`,
      {
        allocations: [{ journalId: journal.id, journalLineId: bankLine.id, amount: '125.00' }],
        matchType: 'EXACT',
        reason: 'Exact amount, same date and matching rent reference.',
      },
    );
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matched.json().line.status).toBe('MATCHED');
    const secondMatch = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${rentLine.id}/match`,
      {
        allocations: [{ journalId: journal.id, journalLineId: bankLine.id, amount: '125.00' }],
        reason: 'duplicate attempt',
      },
    );
    expect(secondMatch.statusCode).toBe(409);
    expect(secondMatch.json().code).toBe('BANK_LINE_ALREADY_MATCHED');

    const reversedJournal = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journal.id}/reverse`,
      {
        date: '2026-01-22',
        reason: 'The rent journal was posted against the wrong bank account.',
      },
    );
    expect(reversedJournal.statusCode, reversedJournal.body).toBe(200);
    const afterReversal = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${rentLine.id}`,
    );
    expect(afterReversal.statusCode, afterReversal.body).toBe(200);
    expect(afterReversal.json().line.status).toBe('UNMATCHED');
    expect(afterReversal.json().matches[0].status).toBe('REVERSED');

    const splitJournal = await postManualJournal(fixture.ownerCookies, {
      date: '2026-01-21',
      narration: 'Split settlement SPLIT-001',
      lines: [
        { accountId: fixture.accounts.expense!.id, debit: '300.00', credit: '0' },
        { accountId: fixture.accounts.bankSplit!.id, debit: '0', credit: '300.00' },
      ],
    });
    const splitBankLine = splitJournal.lines.find((line) => line.accountCode === '1020')!;
    await previewAndImport(
      fixture.ownerCookies,
      fixture.bankAccounts.split!.id,
      [
        'date,description,reference,debit,credit,balance',
        '2026-01-21,Split settlement part 1,SPLIT-001,,100.00,900.00',
        '2026-01-21,Split settlement part 2,SPLIT-001,,200.00,700.00',
      ].join('\n'),
      'split-001.csv',
    );
    const splitLines = (await linesFor(fixture.bankAccounts.split!.id)).sort((left, right) =>
      left.creditPoisha.localeCompare(right.creditPoisha),
    );
    expect(splitLines).toHaveLength(2);
    const first = splitLines.find((line) => line.creditPoisha === '10000')!;
    const second = splitLines.find((line) => line.creditPoisha === '20000')!;
    const firstMatch = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${first.id}/match`,
      {
        allocations: [{ journalId: splitJournal.id, journalLineId: splitBankLine.id, amount: '100.00' }],
        matchType: 'PARTIAL',
        reason: 'First explicitly allocated part of the split settlement.',
      },
    );
    expect(firstMatch.statusCode, firstMatch.body).toBe(200);
    expect(firstMatch.json().line.status).toBe('MATCHED');
    const exactReuse = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${second.id}/match`,
      {
        allocations: [{ journalId: splitJournal.id, journalLineId: splitBankLine.id, amount: '200.00' }],
        matchType: 'EXACT',
        reason: 'Reusing the same journal line without an explicit split.',
      },
    );
    expect(exactReuse.statusCode).toBe(409);
    expect(exactReuse.json().code).toBe('BANK_MATCH_SPLIT_REQUIRED');
    const splitMatch = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${second.id}/match`,
      {
        allocations: [{ journalId: splitJournal.id, journalLineId: splitBankLine.id, amount: '200.00' }],
        matchType: 'SPLIT',
        reason: 'Second explicitly allocated part of the same split settlement.',
      },
    );
    expect(splitMatch.statusCode, splitMatch.body).toBe(200);
    expect(splitMatch.json().line.status).toBe('MATCHED');
  });

  it('requires maker-checker approval before a created GL journal posts and matches', async () => {
    await previewAndImport(
      fixture.ownerCookies,
      fixture.bankAccounts.gl!.id,
      [
        'date,description,reference,debit,credit,balance',
        '2026-01-22,Unexplained bank charge,CHG-001,,50.00,950.00',
      ].join('\n'),
      'charge-001.csv',
    );
    const line = (await linesFor(fixture.bankAccounts.gl!.id))[0]!;
    const equityAttempt = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/create-gl`,
      {
        amount: '50.00',
        primaryAccountId: fixture.accounts.equity!.id,
        reason: 'Attempt to post unexplained activity to equity.',
      },
      { 'idempotency-key': `test-gl-equity-${randomUUID()}` },
    );
    expect(equityAttempt.statusCode).toBe(400);
    expect(equityAttempt.json().code).toBe('BANK_GL_ACCOUNT_INVALID');

    const created = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/create-gl`,
      {
        amount: '50.00',
        primaryAccountId: fixture.accounts.fee!.id,
        reason: 'Bank charge verified against the bank tariff and the statement reference.',
        evidenceReference: 'bank-tariff-2026-01',
      },
      { 'idempotency-key': `test-gl-${randomUUID()}` },
    );
    expect(created.statusCode, created.body).toBe(201);
    const request = created.json().request;
    expect(request.status).toBe('DRAFT');
    expect(request.journalStatus).toBe('DRAFT');
    const submitted = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}/submit`,
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().request.status).toBe('SUBMITTED');

    const selfApprove = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}/approve`,
    );
    expect(selfApprove.statusCode).toBe(403);

    const approved = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}/approve`,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().request.status).toBe('POSTED');
    const detail = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}`,
    );
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().line.status).toBe('MATCHED');
    expect(detail.json().matches).toHaveLength(1);
    const journal = await database.pool.query<{ status: string; source_module: string }>(
      `SELECT status, source_module FROM journals WHERE company_id = $1 AND id = $2`,
      [fixture.companyId, approved.json().journalId],
    );
    expect(journal.rows[0]).toMatchObject({ status: 'POSTED', source_module: 'BANK_RECONCILIATION' });
    const replayApprove = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}/approve`,
    );
    expect(replayApprove.statusCode, replayApprove.body).toBe(200);
    expect(replayApprove.json().request.status).toBe('POSTED');
    expect(replayApprove.json().journalId).toBe(approved.json().journalId);
    const differentUserApprove = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}/approve`,
    );
    expect(differentUserApprove.statusCode).toBe(409);
    expect(differentUserApprove.json().code).toBe('BANK_GL_REQUEST_ALREADY_POSTED');

    const journalReversal = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${approved.json().journalId}/reverse`,
      {
        date: '2026-01-25',
        reason: 'The bank charge was posted to the wrong expense account.',
      },
    );
    expect(journalReversal.statusCode, journalReversal.body).toBe(200);
    const afterReversal = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}`,
    );
    expect(afterReversal.statusCode, afterReversal.body).toBe(200);
    expect(afterReversal.json().line.status).toBe('UNMATCHED');
    const reversedRequest = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-gl-requests/${request.id}`,
    );
    expect(reversedRequest.statusCode, reversedRequest.body).toBe(200);
    expect(reversedRequest.json().request.status).toBe('REVERSED');
    expect(reversedRequest.json().request.reversalJournalId).toBeTruthy();
  });

  it('posts a configured MFS fee once and rejects a second fee or a missing rule', async () => {
    await previewAndImport(
      fixture.accountantCookies,
      fixture.bankAccounts.mfs!.id,
      ['date,description,reference,debit,credit,balance', '2026-01-23,Bkash settlement, MFS-001,,1000.00,5000.00'].join(
        '\n',
      ),
      'mfs-001.csv',
    );
    const line = (await linesFor(fixture.bankAccounts.mfs!.id))[0]!;
    const idempotencyKey = `test-fee-${randomUUID()}`;
    const first = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/fee`,
      { evidenceReference: 'bKash statement MFS-001' },
      { 'idempotency-key': idempotencyKey },
    );
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().posting.amountBdt).toBe('15.00');
    const replay = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/fee`,
      { evidenceReference: 'bKash statement MFS-001' },
      { 'idempotency-key': idempotencyKey },
    );
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().posting.id).toBe(first.json().posting.id);
    const second = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/fee`,
      {},
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('BANK_FEE_ALREADY_POSTED');

    const feeReversal = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${first.json().posting.journalId}/reverse`,
      {
        date: '2026-01-24',
        reason: 'The fee was duplicated by the provider and the journal was reversed.',
      },
    );
    expect(feeReversal.statusCode, feeReversal.body).toBe(200);
    const reversedFee = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/fee`,
    );
    expect(reversedFee.statusCode, reversedFee.body).toBe(200);
    expect(reversedFee.json().posting.status).toBe('REVERSED');
    expect(reversedFee.json().posting.reversalJournalId).toBeTruthy();
    const reposted = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/fee`,
      { evidenceReference: 'Corrected bKash statement MFS-001' },
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(reposted.statusCode, reposted.body).toBe(201);
    expect(reposted.json().posting.status).toBe('POSTED');
    expect(reposted.json().posting.id).not.toBe(first.json().posting.id);
    const feeJournals = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals
        WHERE company_id = $1 AND source_module = 'BANK_MFS' AND narration_en LIKE 'Bank/MFS fee%'`,
      [fixture.companyId],
    );
    expect(feeJournals.rows[0]!.count).toBe('2');

    await previewAndImport(
      fixture.ownerCookies,
      fixture.bankAccounts.main!.id,
      [
        'date,description,reference,debit,credit,balance',
        '2026-01-24,Unconfigured MFS fee,MFS-NO-RULE,,10.00,740.00',
      ].join('\n'),
      'mfs-no-rule.csv',
    );
    const noRuleLine = (await linesFor(fixture.bankAccounts.main!.id)).find(
      (entry) => entry.reference === 'MFS-NO-RULE',
    )!;
    const noRule = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${noRuleLine.id}/fee`,
      {},
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(noRule.statusCode).toBe(409);
    expect(noRule.json().code).toBe('BANK_FEE_RULE_MISSING');

    const overrideMissingEvidence = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${noRuleLine.id}/fee`,
      { overrideAmount: '9.00', overrideReason: 'Contract dispute settlement', feeAccountId: fixture.accounts.fee!.id },
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(overrideMissingEvidence.statusCode).toBe(400);
    expect(overrideMissingEvidence.json().code).toBe('BANK_FEE_OVERRIDE_EVIDENCE_REQUIRED');

    const override = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${noRuleLine.id}/fee`,
      {
        overrideAmount: '9.00',
        overrideReason: 'Provider contract dispute settled at a reduced fee.',
        evidenceReference: 'provider-email-2026-01-24',
        feeAccountId: fixture.accounts.fee!.id,
      },
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(override.statusCode, override.body).toBe(201);
    expect(override.json().posting.amountBdt).toBe('9.00');
    expect(override.json().posting.evidenceReference).toBe('provider-email-2026-01-24');
    const overrideAgain = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${noRuleLine.id}/fee`,
      {
        overrideAmount: '9.00',
        overrideReason: 'Provider contract dispute settled at a reduced fee.',
        evidenceReference: 'provider-email-2026-01-24',
        feeAccountId: fixture.accounts.fee!.id,
      },
      { 'idempotency-key': `test-fee-${randomUUID()}` },
    );
    expect(overrideAgain.statusCode).toBe(409);
    expect(overrideAgain.json().code).toBe('BANK_FEE_ALREADY_POSTED');
  });

  it('persists prepared and reviewed sign-off, locks it when the period closes, and exports the report', async () => {
    const journal = await postManualJournal(fixture.ownerCookies, {
      date: '2026-03-10',
      narration: 'Reconciliation test inflow REC-001',
      lines: [
        { accountId: fixture.accounts.bankRecon!.id, debit: '1000.00', credit: '0' },
        { accountId: fixture.accounts.revenue!.id, debit: '0', credit: '1000.00' },
      ],
    });
    const bankLine = journal.lines.find((line) => line.accountCode === '1050')!;
    await previewAndImport(
      fixture.ownerCookies,
      fixture.bankAccounts.recon!.id,
      [
        'date,description,reference,debit,credit,balance',
        '2026-03-10,Reconciliation test inflow,REC-001,1000.00,,1000.00',
      ].join('\n'),
      'recon-001.csv',
    );
    const line = (await linesFor(fixture.bankAccounts.recon!.id))[0]!;
    const matched = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-lines/${line.id}/match`,
      {
        allocations: [{ journalId: journal.id, journalLineId: bankLine.id, amount: '1000.00' }],
        reason: 'Exact inflow and reference matching the posted receipt.',
      },
    );
    expect(matched.statusCode, matched.body).toBe(200);

    const periodId = fixture.periods['2026-03']!;
    const prepared = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-reconciliations/prepare`,
      { bankAccountId: fixture.bankAccounts.recon!.id, periodId },
    );
    expect(prepared.statusCode, prepared.body).toBe(200);
    expect(prepared.json().reconciliation.status).toBe('PREPARED');
    expect(prepared.json().reconciliation.proof.differencePoisha).toBe('0');
    const reconciliationId = prepared.json().reconciliation.id as string;

    const selfReview = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-reconciliations/${reconciliationId}/review`,
      { note: 'The preparer must not be able to review their own reconciliation.' },
    );
    expect(selfReview.statusCode).toBe(409);
    expect(selfReview.json().code).toBe('BANK_RECONCILIATION_SELF_REVIEW');

    const reviewed = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-reconciliations/${reconciliationId}/review`,
      { note: 'Controller reviewed the statement, GL and exception queue.' },
    );
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().reconciliation.status).toBe('REVIEWED');

    const duplicateReview = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-reconciliations/${reconciliationId}/review`,
      { note: 'Second review must be rejected.' },
    );
    expect(duplicateReview.statusCode).toBe(409);

    const report = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-reconciliations/${reconciliationId}/report`,
    );
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().content).toContain('Bank reconciliation report');
    expect(report.json().content).toContain('REC-001');

    await database.pool.query(`UPDATE periods SET status = 'CLOSED' WHERE company_id = $1 AND id = $2`, [
      fixture.companyId,
      periodId,
    ]);
    const locked = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.recon!.id}/reconciliations`,
    );
    expect(locked.statusCode, locked.body).toBe(200);
    expect(locked.json().reconciliations[0].status).toBe('LOCKED');
    const audit = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events
        WHERE company_id = $1 AND action = 'bank_reconciliation.locked' AND entity_id = $2`,
      [fixture.companyId, reconciliationId],
    );
    expect(audit.rows[0]!.count).toBe('1');

    const closedImport = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.recon!.id}/statements/import`,
      {
        content:
          'date,description,reference,debit,credit,balance\n2026-03-11,Closed period import,CLOSED-1,1.00,,1001.00',
        sourceFileName: 'closed.csv',
        sourceMimeType: 'text/csv',
      },
      { 'idempotency-key': `test-import-${randomUUID()}` },
    );
    expect(closedImport.statusCode).toBe(201);
    expect(closedImport.json().statement.status).toBe('REJECTED');
    expect(closedImport.json().statement.errorRows[0].code).toBe('BANK_STATEMENT_PERIOD_LOCKED');
  });

  it('posts an auditable bank transfer between two accounts and reverses it by a linked journal', async () => {
    const idempotencyKey = `test-transfer-${randomUUID()}`;
    const created = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-transfers`,
      {
        fromBankAccountId: fixture.bankAccounts.main!.id,
        toBankAccountId: fixture.bankAccounts.target!.id,
        transferDate: '2026-01-25',
        amount: '250.00',
        reference: 'TRF-INT-001',
        narration: 'Internal bank transfer',
      },
      { 'idempotency-key': idempotencyKey },
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().transfer.status).toBe('POSTED');
    expect(created.json().transfer.journalNumber).toMatch(/^JE-\d{4}-\d{2}-\d+$/);
    const replay = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-transfers`,
      {
        fromBankAccountId: fixture.bankAccounts.main!.id,
        toBankAccountId: fixture.bankAccounts.target!.id,
        transferDate: '2026-01-25',
        amount: '250.00',
        reference: 'TRF-INT-001',
        narration: 'Internal bank transfer',
      },
      { 'idempotency-key': idempotencyKey },
    );
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().transfer.id).toBe(created.json().transfer.id);

    const transferId = created.json().transfer.id as string;
    const reversed = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-transfers/${transferId}/reverse`,
      { date: '2026-01-26', reason: 'Wrong destination account selected.' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().transfer.status).toBe('REVERSED');
    expect(reversed.json().transfer.reversalJournalId).toBeTruthy();
    const secondReverse = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-transfers/${transferId}/reverse`,
      { date: '2026-01-27', reason: 'Duplicate reversal attempt.' },
    );
    expect(secondReverse.statusCode).toBe(409);
  });

  it('enforces permissions, tenant isolation and reference-safe bank account deactivation', async () => {
    const bankAccountId = fixture.bankAccounts.main!.id;
    const deactivationTarget = fixture.bankAccounts.target!.id;
    const operatorRead = await authedWithHeaders(
      fixture.operatorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/bank-lines`,
    );
    expect(operatorRead.statusCode).toBe(403);
    const auditorRead = await authedWithHeaders(
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/bank-lines`,
    );
    expect(auditorRead.statusCode, auditorRead.body).toBe(200);
    const auditorWrite = await authedWithHeaders(
      fixture.auditorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/statements/preview`,
      { content: 'date,description,reference,debit,credit,balance\n2026-01-01,X,X,1.00,,1.00' },
    );
    expect(auditorWrite.statusCode).toBe(403);

    const crossCompanyRead = await authedWithHeaders(
      fixture.outsiderCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${bankAccountId}/bank-lines`,
    );
    expect(crossCompanyRead.statusCode).toBe(404);
    const crossCompanyPath = await authedWithHeaders(
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/bank-accounts/${bankAccountId}/bank-lines`,
    );
    expect(crossCompanyPath.statusCode).toBe(404);

    const glChange = await authedWithHeaders(
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${fixture.bankAccounts.split!.id}`,
      { glAccountId: fixture.accounts.bankRecon!.id },
    );
    expect(glChange.statusCode).toBe(409);
    expect(glChange.json().code).toBe('BANK_GL_CHANGE_RESTRICTED');

    const deactivate = await authedWithHeaders(
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/bank-accounts/${deactivationTarget}`,
      { status: 'INACTIVE' },
    );
    expect(deactivate.statusCode).toBe(409);
    expect(deactivate.json().code).toBe('BANK_ACCOUNT_IN_USE');
  });
});
