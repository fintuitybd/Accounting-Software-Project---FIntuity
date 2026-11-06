import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authed,
  login,
  seedAccount,
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

const BASE_ACCOUNTS = [
  {
    code: '1010',
    nameEn: 'Bank current account',
    nameBn: 'ব্যাংক চলতি হিসাব',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'BANK_MFS',
  },
  {
    code: '3000',
    nameEn: 'Share capital',
    nameBn: 'শেয়ার মূলধন',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_CAPITAL',
    ifrsCategory: 'FINANCING',
    controlSubledger: 'NONE',
  },
  {
    code: '2000',
    nameEn: 'Trade payables',
    nameBn: 'বাণিজ্যিক প্রদেয়',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'AP',
  },
];

describe.skipIf(!databaseAvailable)('Phase 4 company onboarding, COA and periods', () => {
  let database: TestDatabase;
  let app: AppInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url);
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  function unique(label: string): string {
    return `${label}-${randomUUID().slice(0, 8)}`;
  }

  async function ownerOrganisation(label: string): Promise<{
    organisationId: string;
    userId: string;
    membershipId: string;
    cookies: AuthCookies;
  }> {
    const suffix = unique(label);
    const organisationId = await seedOrganisation(database.pool, `Organisation ${suffix}`);
    const email = `${suffix}@example.test`;
    const userId = await seedUser(database.pool, { email, name: `Owner ${suffix}` });
    const membershipId = await seedMembership(database.pool, organisationId, userId, 'OWNER');
    const session = await login(app, email);
    return { organisationId, userId, membershipId, cookies: session.cookies };
  }

  async function createCompany(
    cookies: AuthCookies,
    organisationId: string,
    label: string,
    overrides: Record<string, unknown> = {},
  ): Promise<any> {
    const response = await authed(app, cookies, 'POST', `/api/v1/organisations/${organisationId}/companies`, {
      legalName: `${label} Ltd`,
      tradeName: `${label} Trade`,
      ...COMPANY_PROFILE,
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().company;
  }

  async function createFiscalYear(
    cookies: AuthCookies,
    companyId: string,
    startDate = '2025-01-01',
    endDate = '2025-12-31',
  ): Promise<any> {
    const response = await authed(app, cookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate,
      endDate,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().fiscalYear;
  }

  async function createAccount(
    cookies: AuthCookies,
    companyId: string,
    account: Record<string, unknown>,
  ): Promise<any> {
    const response = await authed(app, cookies, 'POST', `/api/v1/companies/${companyId}/accounts`, account);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().account;
  }

  async function createBaseAccounts(cookies: AuthCookies, companyId: string): Promise<any[]> {
    const accounts = [];
    for (const account of BASE_ACCOUNTS) {
      accounts.push(await createAccount(cookies, companyId, account));
    }
    return accounts;
  }

  it('completes a full onboarding flow with a balanced opening batch, bank mapping, settings and audit', async () => {
    const owner = await ownerOrganisation('e2e');
    const company = await createCompany(owner.cookies, owner.organisationId, 'E2E Trading');
    expect(company.baseCurrency).toBe('BDT');
    expect(company.timezone).toBe('Asia/Dhaka');

    const stepResponse = await authed(app, owner.cookies, 'PATCH', `/api/v1/companies/${company.id}/onboarding`, {
      currentStep: 'CHART_OF_ACCOUNTS',
    });
    expect(stepResponse.statusCode, stepResponse.body).toBe(200);
    expect(stepResponse.json().onboarding.currentStep).toBe('CHART_OF_ACCOUNTS');

    const fiscal = await createFiscalYear(owner.cookies, company.id);
    expect(fiscal.periods).toHaveLength(12);
    expect(fiscal.periods[0].code).toBe('2025-01');
    expect(fiscal.periods[11].code).toBe('2025-12');
    expect(fiscal.periods.every((period: any) => period.status === 'OPEN')).toBe(true);

    const accounts = await createBaseAccounts(owner.cookies, company.id);
    const bankGl = accounts.find((account) => account.code === '1010');
    const equity = accounts.find((account) => account.code === '3000');

    const draftResponse = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/opening-balances`, {
      batchDate: '2025-01-01',
      evidenceReference: 'Board resolution 2025-01 and bank certificate',
      evidenceNote: 'Opening position agreed by the directors.',
      lines: [
        {
          accountId: bankGl.id,
          debit: '1000.00',
          credit: '0',
          scheduleType: 'PARTY',
          schedule: { name: 'Opening bank confirmation', reference: 'BANK-OPEN-2025' },
        },
        { accountId: equity.id, debit: '0', credit: '1000.00', scheduleType: 'ACCOUNT', schedule: {} },
      ],
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const draft = draftResponse.json().batch;
    expect(draft.status).toBe('DRAFT');
    expect(draft.balanced).toBe(true);
    expect(draft.totalDebitPoisha).toBe('100000');
    expect(draft.totalCreditPoisha).toBe('100000');

    const submitResponse = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances/${draft.id}/submit`,
    );
    expect(submitResponse.statusCode, submitResponse.body).toBe(200);
    expect(submitResponse.json().batch.status).toBe('SUBMITTED');
    expect(submitResponse.json().batch.status).not.toBe('POSTED');

    const bankResponse = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/bank-accounts`, {
      name: 'City Bank corporate account',
      kind: 'BANK',
      provider: 'The City Bank Ltd.',
      maskedNumber: '•••• 4471',
      branch: 'Banani',
      glAccountId: bankGl.id,
      openingBalance: '1000.00',
      isPrincipal: true,
    });
    expect(bankResponse.statusCode, bankResponse.body).toBe(201);
    expect(bankResponse.json().bankAccount.isPrincipal).toBe(true);

    const settingsResponse = await authed(app, owner.cookies, 'PATCH', `/api/v1/companies/${company.id}/settings`, {
      language: 'bn-BD',
      approvalThresholds: { highValue: '5000.00', payment: '2500.00' },
      tax: { vatStatus: 'NOT_REGISTERED', filingFrequency: 'NOT_APPLICABLE', withholdingEntity: false },
      numberSequences: [{ docType: 'SALES_INVOICE', prefix: 'E2E-', nextValue: '1', pad: 5 }],
    });
    expect(settingsResponse.statusCode, settingsResponse.body).toBe(200);
    expect(settingsResponse.json().settings.language).toBe('bn-BD');
    expect(settingsResponse.json().settings.tax.vatStatus).toBe('NOT_REGISTERED');

    const onboardingResponse = await authed(app, owner.cookies, 'GET', `/api/v1/companies/${company.id}/onboarding`);
    expect(onboardingResponse.statusCode, onboardingResponse.body).toBe(200);
    const onboarding = onboardingResponse.json().onboarding;
    expect(onboarding.canComplete).toBe(true);
    expect(onboarding.percent).toBe(100);

    const completeResponse = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/companies/${company.id}/onboarding/complete`,
    );
    expect(completeResponse.statusCode, completeResponse.body).toBe(200);
    expect(completeResponse.json().onboarding.completedAt).toBeTruthy();

    const audit = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE company_id = $1 ORDER BY created_at ASC`,
      [company.id],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'company.created',
        'company.onboarding_step_saved',
        'fiscal_year.created',
        'account.created',
        'opening_balance.created',
        'opening_balance.submitted',
        'bank_account.created',
        'company.settings_updated',
        'company.onboarding_completed',
      ]),
    );
  });

  it('creates a second company without removing the first and rejects overlapping periods and unknown dates', async () => {
    const owner = await ownerOrganisation('multi');
    const first = await createCompany(owner.cookies, owner.organisationId, 'First Company');
    const firstFiscal = await createFiscalYear(owner.cookies, first.id);

    const second = await createCompany(owner.cookies, owner.organisationId, 'Second Company');
    const secondFiscal = await createFiscalYear(owner.cookies, second.id);
    const list = await authed(app, owner.cookies, 'GET', '/api/v1/companies');
    expect(list.statusCode).toBe(200);
    const ids = list.json().companies.map((company: any) => company.id);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));

    const stillThere = await authed(app, owner.cookies, 'GET', `/api/v1/companies/${first.id}/periods`);
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().periods).toHaveLength(firstFiscal.periods.length);

    const overlapping = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${second.id}/fiscal-years`, {
      startDate: '2025-06-01',
      endDate: '2026-05-31',
    });
    expect(overlapping.statusCode).toBe(409);
    expect(overlapping.json().code).toBe('FISCAL_YEAR_OVERLAP');
    expect(secondFiscal.periods).toHaveLength(12);

    const unknown = await authed(
      app,
      owner.cookies,
      'GET',
      `/api/v1/companies/${second.id}/periods/resolve?date=1999-01-15`,
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('PERIOD_NOT_FOUND');

    const unknownOpening = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${second.id}/opening-balances`, {
      batchDate: '1999-01-15',
      lines: [],
      evidenceReference: 'Unknown-date test',
    });
    expect(unknownOpening.statusCode).toBe(400);
    expect(unknownOpening.json().code).toBe('PERIOD_NOT_FOUND');
  });

  it('enforces duplicate account codes, control-account protection and atomic COA import validation', async () => {
    const owner = await ownerOrganisation('coa');
    const company = await createCompany(owner.cookies, owner.organisationId, 'COA Company');
    const control = await createAccount(owner.cookies, company.id, {
      code: '2100',
      nameEn: 'Trade payables control',
      accountType: 'LIABILITY',
      subCategory: 'CURRENT_LIABILITY',
      ifrsCategory: 'NA_BALANCE_SHEET',
      controlSubledger: 'AP',
    });

    const duplicate = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/accounts`, {
      code: '2100',
      nameEn: 'Duplicate payables',
      accountType: 'LIABILITY',
      subCategory: 'CURRENT_LIABILITY',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('ACCOUNT_CODE_DUPLICATE');

    const repurpose = await authed(
      app,
      owner.cookies,
      'PATCH',
      `/api/v1/companies/${company.id}/accounts/${control.id}`,
      {
        code: '9999',
        nameEn: control.nameEn,
        accountType: control.accountType,
        subCategory: control.subCategory,
        ifrsCategory: control.ifrsCategory,
        controlSubledger: control.controlSubledger,
        taxMapping: {},
        isActive: true,
      },
    );
    expect(repurpose.statusCode).toBe(409);
    expect(repurpose.json().code).toBe('ACCOUNT_CONTROL_PROTECTED');

    const validCsv = [
      'code,name_en,name_bn,account_type,sub_category,ifrs_category,control_subledger,parent_code,tax_mapping,is_active',
      '1000,Current assets,,ASSET,CURRENT_ASSET,NA_BALANCE_SHEET,NONE,,,true',
      '1100,Cash at bank,,ASSET,CURRENT_ASSET,NA_BALANCE_SHEET,NONE,1000,,true',
      '4000,Sales revenue,,REVENUE,OPERATING_REVENUE,OPERATING,NONE,,,true',
    ].join('\n');
    const imported = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/accounts/import`, {
      format: 'CSV',
      content: validCsv,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().imported).toBe(3);

    const xlsxImported = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/accounts/import`, {
      format: 'XLSX',
      rows: [
        {
          code: '5000',
          name_en: 'Operating expenses',
          account_type: 'EXPENSE',
          sub_category: 'OPERATING_EXPENSE',
          ifrs_category: 'OPERATING',
          control_subledger: 'NONE',
          is_active: 'true',
        },
      ],
    });
    expect(xlsxImported.statusCode, xlsxImported.body).toBe(200);
    expect(xlsxImported.json().imported).toBe(1);

    const beforeInvalid = await authed(app, owner.cookies, 'GET', `/api/v1/companies/${company.id}/accounts`);
    const beforeCount = beforeInvalid.json().accounts.length;

    const invalidCsv = [
      'code,name_en,name_bn,account_type,sub_category,ifrs_category,control_subledger,parent_code,tax_mapping,is_active',
      '1200,Bad type,,BOGUS,CURRENT_ASSET,NA_BALANCE_SHEET,NONE,,,true',
      '1300,Missing parent,,ASSET,CURRENT_ASSET,NA_BALANCE_SHEET,NONE,9999,,true',
    ].join('\n');
    const invalid = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/accounts/import`, {
      format: 'CSV',
      content: invalidCsv,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('ACCOUNT_IMPORT_INVALID');
    expect(invalid.json().details.errors.length).toBeGreaterThanOrEqual(1);

    const afterInvalid = await authed(app, owner.cookies, 'GET', `/api/v1/companies/${company.id}/accounts`);
    expect(afterInvalid.json().accounts.length).toBe(beforeCount);

    const template = await authed(
      app,
      owner.cookies,
      'GET',
      `/api/v1/companies/${company.id}/accounts/import-template`,
    );
    expect(template.statusCode).toBe(200);
    expect(template.json().content).toContain('parent_code');
  });

  it('saves an unbalanced draft but refuses to submit it, and rejects a direct POSTED update without a linked journal', async () => {
    const owner = await ownerOrganisation('opening');
    const company = await createCompany(owner.cookies, owner.organisationId, 'Opening Company');
    await createFiscalYear(owner.cookies, company.id);
    const accounts = await createBaseAccounts(owner.cookies, company.id);
    const bankGl = accounts.find((account) => account.code === '1010');

    const created = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/opening-balances`, {
      batchDate: '2025-01-31',
      evidenceReference: 'Trial balance export',
      lines: [
        { accountId: bankGl.id, debit: '100.00', credit: '0' },
        { accountId: accounts[1].id, debit: '0', credit: '50.00' },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const batch = created.json().batch;
    expect(batch.status).toBe('DRAFT');
    expect(batch.balanced).toBe(false);
    expect(batch.differencePoisha).toBe('5000');

    const submit = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances/${batch.id}/submit`,
    );
    expect(submit.statusCode).toBe(409);
    expect(submit.json().code).toBe('OPENING_BATCH_UNBALANCED');

    const stored = await database.pool.query<{ status: string }>(
      `SELECT status FROM opening_balance_batches WHERE id = $1`,
      [batch.id],
    );
    expect(stored.rows[0]?.status).toBe('DRAFT');

    await expect(
      database.pool.query(`UPDATE opening_balance_batches SET status = 'POSTED' WHERE id = $1`, [batch.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires evidence before submitting a balanced opening batch', async () => {
    const owner = await ownerOrganisation('evidence');
    const company = await createCompany(owner.cookies, owner.organisationId, 'Evidence Company');
    await createFiscalYear(owner.cookies, company.id);
    const accounts = await createBaseAccounts(owner.cookies, company.id);
    const [bankGl, equity] = accounts;
    const created = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/opening-balances`, {
      batchDate: '2025-01-01',
      lines: [
        { accountId: bankGl.id, debit: '250.00', credit: '0' },
        { accountId: equity.id, debit: '0', credit: '250.00' },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const batch = created.json().batch;
    const submit = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances/${batch.id}/submit`,
    );
    expect(submit.statusCode).toBe(409);
    expect(submit.json().code).toBe('OPENING_BATCH_EVIDENCE_REQUIRED');

    const patched = await authed(
      app,
      owner.cookies,
      'PATCH',
      `/api/v1/companies/${company.id}/opening-balances/${batch.id}`,
      {
        batchDate: '2025-01-01',
        evidenceReference: 'Signed schedule',
        lines: [
          { accountId: bankGl.id, debit: '250.00', credit: '0' },
          { accountId: equity.id, debit: '0', credit: '250.00' },
        ],
      },
    );
    expect(patched.statusCode, patched.body).toBe(200);
    const submitted = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances/${batch.id}/submit`,
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().batch.status).toBe('SUBMITTED');
  });

  it('isolates companies across organisations and returns 404 rather than leaking another tenant', async () => {
    const ownerA = await ownerOrganisation('tenant-a');
    const companyA = await createCompany(ownerA.cookies, ownerA.organisationId, 'Tenant A Company');
    await createFiscalYear(ownerA.cookies, companyA.id);
    await createBaseAccounts(ownerA.cookies, companyA.id);

    const seededB = await seedAccount(database.pool, {
      organisationName: `Tenant B ${unique('org')}`,
      companyNames: [`Tenant B Company ${unique('company')}`],
      email: `${unique('tenant-b')}@example.test`,
      name: 'Tenant B Owner',
      role: 'OWNER',
      scope: 'all',
    });

    const emailB = await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      seededB.userId,
    ]);
    const sessionB = await login(app, emailB.rows[0]!.email);

    const crossRead = await authed(app, sessionB.cookies, 'GET', `/api/v1/companies/${companyA.id}/accounts`);
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.json().code).toBe('COMPANY_NOT_FOUND');

    const crossWrite = await authed(app, sessionB.cookies, 'POST', `/api/v1/companies/${companyA.id}/accounts`, {
      code: '9999',
      nameEn: 'Intrusion',
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
    });
    expect(crossWrite.statusCode).toBe(404);

    const otherCompanyId = seededB.companyIds[0]!;
    const reverseRead = await authed(app, ownerA.cookies, 'GET', `/api/v1/companies/${otherCompanyId}/accounts`);
    expect(reverseRead.statusCode).toBe(404);
  });

  it('enforces role permissions and auditor read-only access', async () => {
    const owner = await ownerOrganisation('roles');
    const company = await createCompany(owner.cookies, owner.organisationId, 'Role Company');
    await createFiscalYear(owner.cookies, company.id);
    await createBaseAccounts(owner.cookies, company.id);

    const accountantEmail = `${unique('accountant')}@example.test`;
    const accountantUser = await seedUser(database.pool, { email: accountantEmail, name: 'Accountant' });
    const accountantMembership = await seedMembership(
      database.pool,
      owner.organisationId,
      accountantUser,
      'ACCOUNTANT',
    );
    await seedCompanyMembership(database.pool, owner.organisationId, company.id, accountantMembership);
    const accountant = await login(app, accountantEmail);

    const canCreateAccount = await authed(app, accountant.cookies, 'POST', `/api/v1/companies/${company.id}/accounts`, {
      code: '1500',
      nameEn: 'Prepaid expenses',
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
    });
    expect(canCreateAccount.statusCode, canCreateAccount.body).toBe(201);

    const cannotProfile = await authed(app, accountant.cookies, 'PATCH', `/api/v1/companies/${company.id}/profile`, {
      legalName: 'Accountant Renamed Ltd',
    });
    expect(cannotProfile.statusCode).toBe(403);

    const cannotFiscal = await authed(app, accountant.cookies, 'POST', `/api/v1/companies/${company.id}/fiscal-years`, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(cannotFiscal.statusCode).toBe(403);

    const cannotSettings = await authed(app, accountant.cookies, 'PATCH', `/api/v1/companies/${company.id}/settings`, {
      language: 'en-BD',
    });
    expect(cannotSettings.statusCode).toBe(403);

    const cannotCreateCompany = await authed(
      app,
      accountant.cookies,
      'POST',
      `/api/v1/organisations/${owner.organisationId}/companies`,
      { legalName: 'Not allowed Ltd', ...COMPANY_PROFILE },
    );
    expect(cannotCreateCompany.statusCode).toBe(403);

    const auditorEmail = `${unique('auditor')}@example.test`;
    const auditorUser = await seedUser(database.pool, { email: auditorEmail, name: 'Auditor' });
    const auditorMembership = await seedMembership(database.pool, owner.organisationId, auditorUser, 'AUDITOR');
    await seedCompanyMembership(database.pool, owner.organisationId, company.id, auditorMembership);
    const auditor = await login(app, auditorEmail);

    const auditorRead = await authed(app, auditor.cookies, 'GET', `/api/v1/companies/${company.id}/accounts`);
    expect(auditorRead.statusCode).toBe(200);

    const auditorWrite = await authed(app, auditor.cookies, 'POST', `/api/v1/companies/${company.id}/accounts`, {
      code: '1501',
      nameEn: 'Forbidden account',
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
    });
    expect(auditorWrite.statusCode).toBe(403);

    const auditorOpening = await authed(
      app,
      auditor.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances`,
      { batchDate: '2025-01-31', lines: [], evidenceReference: 'Should not exist' },
    );
    expect(auditorOpening.statusCode).toBe(403);

    const operatorEmail = `${unique('operator')}@example.test`;
    const operatorUser = await seedUser(database.pool, { email: operatorEmail, name: 'Operator' });
    const operatorMembership = await seedMembership(database.pool, owner.organisationId, operatorUser, 'OPERATOR');
    await seedCompanyMembership(database.pool, owner.organisationId, company.id, operatorMembership);
    const operator = await login(app, operatorEmail);
    const operatorOpening = await authed(
      app,
      operator.cookies,
      'POST',
      `/api/v1/companies/${company.id}/opening-balances`,
      { batchDate: '2025-01-31', lines: [], evidenceReference: 'Operator attempt' },
    );
    expect(operatorOpening.statusCode).toBe(403);
  });

  it('enforces one principal bank account and unique GL mapping', async () => {
    const owner = await ownerOrganisation('banks');
    const company = await createCompany(owner.cookies, owner.organisationId, 'Bank Company');
    const accounts = await createBaseAccounts(owner.cookies, company.id);
    const bankGl = accounts.find((account) => account.code === '1010');

    const first = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/bank-accounts`, {
      name: 'Principal bank',
      kind: 'BANK',
      provider: 'BRAC Bank',
      maskedNumber: '**** 8820',
      glAccountId: bankGl.id,
      openingBalance: '0.00',
      isPrincipal: true,
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/bank-accounts`, {
      name: 'Second bank',
      kind: 'BANK',
      provider: 'City Bank',
      maskedNumber: '**** 4471',
      glAccountId: bankGl.id,
      openingBalance: '0.00',
      isPrincipal: true,
    });
    expect(second.statusCode).toBe(409);
    expect(['BANK_PRINCIPAL_EXISTS', 'BANK_GL_IN_USE']).toContain(second.json().code);

    const fullNumber = await authed(app, owner.cookies, 'POST', `/api/v1/companies/${company.id}/bank-accounts`, {
      name: 'Unsafe bank',
      kind: 'BANK',
      provider: 'Unsafe Bank',
      maskedNumber: '1234567890123',
      glAccountId: bankGl.id,
      openingBalance: '0.00',
    });
    expect(fullNumber.statusCode).toBe(400);
    expect(fullNumber.json().code).toBe('BANK_MASKED_NUMBER_INVALID');
  });

  it('validates TIN/BIN as format checks only and allows not-registered companies', async () => {
    const owner = await ownerOrganisation('identity');
    const allowed = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/organisations/${owner.organisationId}/companies`,
      {
        legalName: 'Not Registered Yet Ltd',
        ...COMPANY_PROFILE,
        tin: null,
        bin: null,
        rjscNo: null,
      },
    );
    expect(allowed.statusCode, allowed.body).toBe(201);

    const invalidTin = await authed(
      app,
      owner.cookies,
      'POST',
      `/api/v1/organisations/${owner.organisationId}/companies`,
      {
        legalName: 'Bad TIN Ltd',
        ...COMPANY_PROFILE,
        tin: 'ABC',
      },
    );
    expect(invalidTin.statusCode).toBe(400);
    expect(invalidTin.json().code).toBe('COMPANY_TIN_FORMAT');
    expect(invalidTin.json().message).toContain('format check only');
  });
});
