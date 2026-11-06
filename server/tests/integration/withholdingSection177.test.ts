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
  TEST_PASSWORD,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';
import { evaluateSection46Rebate, SECTION_TDS_SPECS } from '../../src/purchases/tax.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'TRADING_DISTRIBUTION',
  tin: '123456789',
  bin: '123456789-0101',
  rjscNo: 'C-12345/2024',
  address: 'House 12, Road 5, Banani, Dhaka 1213',
  phone: '+8801700000000',
  email: 'tax@example.test',
  reportingFramework: 'IFRS_FOR_SMES_BFRS',
};

const ACCOUNTS = [
  { key: 'ap', code: '2110', nameEn: 'Trade accounts payable', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', controlSubledger: 'AP' },
  { key: 'inputVat', code: '1140', nameEn: 'VAT current account', accountType: 'ASSET', subCategory: 'CURRENT_ASSET', controlSubledger: 'VAT_CURRENT_ACCOUNT' },
  { key: 'vdsPayable', code: '2130', nameEn: 'VDS withheld payable', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', controlSubledger: 'VDS_PAYABLE' },
  { key: 'tdsPayable', code: '2140', nameEn: 'TDS withheld payable', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', controlSubledger: 'TDS_PAYABLE' },
  { key: 'reverseChargePayable', code: '2150', nameEn: 'Reverse-charge VAT payable', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', controlSubledger: 'NONE' },
  { key: 'bank', code: '1010', nameEn: 'Bank current account', accountType: 'ASSET', subCategory: 'CURRENT_ASSET', controlSubledger: 'BANK_MFS' },
  { key: 'expense', code: '5200', nameEn: 'Freight and delivery expense', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', controlSubledger: 'NONE' },
  { key: 'rentExpense', code: '5300', nameEn: 'Office rent expense', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', controlSubledger: 'NONE' },
  { key: 'serviceExpense', code: '5400', nameEn: 'Professional services expense', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', controlSubledger: 'NONE' },
] as const;

interface Fixture {
  organisationId: string;
  companyId: string;
  ownerCookies: AuthCookies;
  controllerCookies: AuthCookies;
  accountantCookies: AuthCookies;
  accounts: Record<string, { id: string; code: string }>;
  supplierWithTinId: string;
  supplierNoTinId: string;
  customerPartyId: string;
  bankAccountId: string;
}

describe.skipIf(!databaseAvailable)('Phase 18 Section 177 Withholding Tax, Mushak 6.6 & Statement Drill-Down', () => {
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
    if (app) await app.close();
    if (database) await database.cleanup();
  });

  function unique(label: string): string {
    return `${label}-${randomUUID().slice(0, 8)}`;
  }

  async function createFixture(): Promise<Fixture> {
    const suffix = unique('Withholding');
    const organisationId = await seedOrganisation(database.pool, `Organisation ${suffix}`);
    const emails = {
      owner: `owner-${suffix}@example.test`,
      controller: `controller-${suffix}@example.test`,
      accountant: `accountant-${suffix}@example.test`,
    };
    const ownerId = await seedUser(database.pool, { email: emails.owner, name: `Owner ${suffix}`, password: TEST_PASSWORD });
    const controllerId = await seedUser(database.pool, { email: emails.controller, name: `Controller ${suffix}`, password: TEST_PASSWORD });
    const accountantId = await seedUser(database.pool, { email: emails.accountant, name: `Accountant ${suffix}`, password: TEST_PASSWORD });

    await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
    const controllerMembership = await seedMembership(database.pool, organisationId, controllerId, 'CONTROLLER');
    const accountantMembership = await seedMembership(database.pool, organisationId, accountantId, 'ACCOUNTANT');

    const ownerCookies = (await login(app, emails.owner)).cookies;
    const controllerCookies = (await login(app, emails.controller)).cookies;
    const accountantCookies = (await login(app, emails.accountant)).cookies;

    const companyResponse = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/organisations/${organisationId}/companies`,
      {
        legalName: `${suffix} Ltd`,
        ...COMPANY_PROFILE,
      },
    );
    expect(companyResponse.statusCode, companyResponse.body).toBe(201);
    const companyId = companyResponse.json().company.id as string;

    for (const membershipId of [controllerMembership, accountantMembership]) {
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

    const settingsResponse = await authed(app, ownerCookies, 'PATCH', `/api/v1/companies/${companyId}/settings`, {
      tax: { withholdingEntity: true, vatStatus: 'VAT_REGISTERED_15', filingFrequency: 'MONTHLY' },
    });
    expect(settingsResponse.statusCode, settingsResponse.body).toBe(200);

    const bankResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/bank-accounts`, {
      name: 'Main bank',
      kind: 'BANK',
      provider: 'Test Bank',
      maskedNumber: '****1234',
      branch: 'Dhaka',
      glAccountId: accounts.bank!.id,
      openingBalance: '0.00',
      isPrincipal: true,
    });
    expect(bankResponse.statusCode, bankResponse.body).toBe(201);
    const bankAccountId = bankResponse.json().bankAccount.id as string;

    // Supplier with valid 12-digit e-TIN and 13-digit BIN
    const supWithTin = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'SUP-TIN',
      nameEn: 'Compliant Supplier Ltd',
      type: 'SUPPLIER',
      bin: '1234567890123',
      tin: '123456789012',
      creditDays: 30,
      creditLimit: '1000000.00',
      isWithholdingBuyer: false,
      isGovernment: false,
    });
    expect(supWithTin.statusCode, supWithTin.body).toBe(201);
    const supplierWithTinId = supWithTin.json().party.id as string;

    // Supplier WITHOUT e-TIN (triggers Sec 134 +50% penalty)
    const supNoTin = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'SUP-NO-TIN',
      nameEn: 'Unregistered Vendor',
      type: 'SUPPLIER',
      bin: '9876543210123',
      tin: null,
      creditDays: 30,
      creditLimit: '500000.00',
      isWithholdingBuyer: false,
      isGovernment: false,
    });
    expect(supNoTin.statusCode, supNoTin.body).toBe(201);
    const supplierNoTinId = supNoTin.json().party.id as string;

    // Customer for Note 29 Mushak 6.6
    const customer = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'CUST-001',
      nameEn: 'Apex Retail Client PLC',
      type: 'CUSTOMER',
      bin: '5556667778889',
      tin: '999888777666',
      creditDays: 30,
      creditLimit: '2000000.00',
      isWithholdingBuyer: true,
      isGovernment: false,
    });
    expect(customer.statusCode, customer.body).toBe(201);
    const customerPartyId = customer.json().party.id as string;

    const policyResponse = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/companies/${companyId}/purchases/tax-policy/approval`,
      {
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA, Bangladesh tax practice',
        sourceReference: 'Engagement letter TAX-2026-09 and reviewed pack bd-2026-v1',
        reviewedAt: '2026-11-02',
        inputVatAccountId: accounts.inputVat!.id,
        vdsPayableAccountId: accounts.vdsPayable!.id,
        tdsPayableAccountId: accounts.tdsPayable!.id,
        reverseChargePayableAccountId: accounts.reverseChargePayable!.id,
        rulePackVersion: 'bd-2026-v1',
      },
    );
    expect(policyResponse.statusCode, policyResponse.body).toBe(200);

    return {
      organisationId,
      companyId,
      ownerCookies,
      controllerCookies,
      accountantCookies,
      accounts,
      supplierWithTinId,
      supplierNoTinId,
      customerPartyId,
      bankAccountId,
    };
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

  it('proves Section 46 Input Tax Rebate guardrail and Section 134 +50% TDS penalty rules', () => {
    // 1. Sec 46 evaluation
    const valid = evaluateSection46Rebate({
      vatRateBps: 1500,
      hasValid13DigitBin: true,
      hasMushak63: true,
      basePoisha: 5000000n, // 50,000 BDT <= 100,000 BDT
      isPaidViaBank: false,
    });
    expect(valid).toBe(true);

    const cashExceedsLimit = evaluateSection46Rebate({
      vatRateBps: 1500,
      hasValid13DigitBin: true,
      hasMushak63: true,
      basePoisha: 12000000n, // 120,000 BDT > 100,000 BDT limit for cash
      isPaidViaBank: false,
    });
    expect(cashExceedsLimit).toBe(false);

    const bankExceedsLimit = evaluateSection46Rebate({
      vatRateBps: 1500,
      hasValid13DigitBin: true,
      hasMushak63: true,
      basePoisha: 12000000n,
      isPaidViaBank: true,
    });
    expect(bankExceedsLimit).toBe(true);

    // 2. Sec 134 TDS Rate Penalty
    expect(SECTION_TDS_SPECS.SEC_89_GOODS.baseBps).toBe(300);
    expect(SECTION_TDS_SPECS.SEC_89_GOODS.penaltyBps).toBe(450); // +50%

    expect(SECTION_TDS_SPECS.SEC_90_SERVICE.baseBps).toBe(1000);
    expect(SECTION_TDS_SPECS.SEC_90_SERVICE.penaltyBps).toBe(1500); // +50%

    expect(SECTION_TDS_SPECS.SEC_109_RENT.baseBps).toBe(500);
    expect(SECTION_TDS_SPECS.SEC_109_RENT.penaltyBps).toBe(750); // +50%
  });

  it('posts bills with Section 134 penalty, settles partially with pro-rata VDS/TDS, and issues gapless Mushak 6.6', async () => {
    // Create Bill 1: Vendor WITHOUT e-TIN (Goods: 3% -> 4.5% TDS, Standard 15% VAT)
    const billDraft = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents`,
      {
        docType: 'PURCHASE_BILL',
        partyId: fixture.supplierNoTinId,
        docDate: '2026-11-10',
        dueDate: '2026-12-10',
        paymentTermsDays: 30,
        supplierInvoiceNo: `INV-NOTIN-${randomUUID().slice(0, 6)}`,
        supplierInvoiceDate: '2026-11-10',
        supplierMushak63Serial: `M63-${randomUUID().slice(0, 6)}`,
        supplierMushak63Date: '2026-11-10',
        narrationEn: 'Purchase of goods with missing e-TIN',
        paymentMethod: 'BANK',
        supplierTinMissing: true,
        vdsApplicable: true,
        tdsNature: 'SUPPLY_OF_GOODS',
        lines: [
          {
            descriptionEn: 'Inventory items',
            quantity: '1.0000',
            unit: 'lot',
            unitPrice: '1000.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            accountId: fixture.accounts.expense!.id,
          },
        ],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(billDraft.statusCode, billDraft.body).toBe(201);
    const billId = billDraft.json().document.id as string;

    const postedBill = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${billId}/post`,
      undefined,
      { 'idempotency-key': randomUUID() },
    );
    expect(postedBill.statusCode, postedBill.body).toBe(200);

    // Bill: Base = 1000.00 (100000 poisha), VAT 15% = 150.00 (15000 poisha), Gross = 1150.00 (115000 poisha)
    // TDS with +50% Sec 134 penalty = 4.5% = 45.00 (4500 poisha)
    // VDS = 150.00 (15000 poisha)
    // Net cash payable = 1150 - 150 - 45 = 955.00 (95500 poisha)

    // Partial Payment: Allocate 575.00 (57500 poisha = 50% of gross)
    const preview = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payments/preview`,
      {
        paymentDate: '2026-11-15',
        partyId: fixture.supplierNoTinId,
        allocations: [{ documentId: billId, amount: '575.00' }],
      },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const previewData = preview.json().preview;
    // Exactly 50% pro-rata matured:
    expect(previewData.totalVdsPoisha).toBe('7500'); // 75.00
    expect(previewData.totalTdsPoisha).toBe('2250'); // 22.50
    expect(previewData.totalCashPoisha).toBe('47750'); // 477.50

    // Post Partial Payment
    const payment = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payments`,
      {
        paymentDate: '2026-11-15',
        partyId: fixture.supplierNoTinId,
        bankAccountId: fixture.bankAccountId,
        amount: '477.50',
        reference: `REF-${randomUUID().slice(0, 8)}`,
        narrationEn: 'Partial payment on bill',
        allocations: [{ documentId: billId, amount: '575.00' }],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(payment.statusCode, payment.body).toBe(201);
    const paymentId = payment.json().payment.id as string;

    // Check pending liabilities generated from partial payment
    const liabilitiesRes = await authedWithHeaders(
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/liabilities?status=PENDING&limit=100`,
    );
    expect(liabilitiesRes.statusCode).toBe(200);
    const pending = (liabilitiesRes.json().entries as Array<Record<string, unknown>>).filter(
      (entry) => entry.paymentId === paymentId,
    );
    expect(pending).toHaveLength(2);
    const vdsLiability = pending.find((l) => l.taxType === 'VDS')!;
    const tdsLiability = pending.find((l) => l.taxType === 'TDS')!;
    expect(vdsLiability.amountPoisha).toBe('7500');
    expect(tdsLiability.amountPoisha).toBe('2250');

    // Deposit VDS liability under Economic Code '1/1141/0010/0311' (Automated Mushak 6.6 sequence issuance)
    const deposit = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/challans`,
      {
        depositDate: '2026-11-20',
        bankAccountId: fixture.bankAccountId,
        bankBranch: 'Dhaka Main Branch',
        depositReference: `CHALLAN-VDS-${randomUUID().slice(0, 8)}`,
        evidenceReference: 'evidence/vds-challan.pdf',
        items: [
          {
            liabilityId: vdsLiability.id,
            economicCode: '1/1141/0010/0311',
          },
        ],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(deposit.statusCode, deposit.body).toBe(201);

    // Verify Gapless Mushak 6.6 Certificate was issued with sequence format 6.6/2026-27/00001
    const certRes = await authedWithHeaders(
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates?type=VDS&limit=10`,
    );
    expect(certRes.statusCode).toBe(200);
    const vdsCert = (certRes.json().entries as Array<{ certificateNumber: string; liabilityId: string }>).find(
      (c) => c.liabilityId === vdsLiability.id,
    );
    expect(vdsCert).toBeDefined();
    expect(vdsCert!.certificateNumber).toMatch(/^6\.6\/2026-27\/\d{5}$/);
  });

  it('records customer Mushak 6.6 certificate linked to Note 29 decreasing adjustment', async () => {
    const response = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates/customer`,
      {
        partyId: fixture.customerPartyId,
        certificateNumber: '6.6/2026-27/00888',
        certificateDate: '2026-11-18',
        basePoisha: '2000000', // 20,000 BDT
        taxPoisha: '300000',   // 3,000 BDT
        evidenceReference: 'evidence/customer-mushak66-apex.pdf',
      },
    );
    expect(response.statusCode, response.body).toBe(201);
    const cert = response.json().certificate;
    expect(cert.direction).toBe('RECEIVED');
    expect(cert.certificateNumber).toBe('6.6/2026-27/00888');
    expect(cert.taxPoisha).toBe('300000');
  });

  it('generates Section 177 return with Schedules A-D, detects missing e-TIN anomalies, and exports Excel', async () => {
    // Generate Section 177 Return for period 2026-11
    const genRes = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/reports/withholding/section177/generate`,
      {
        taxYear: '2026-2027',
        taxPeriod: '2026-11',
      },
    );
    expect(genRes.statusCode, genRes.body).toBe(201);
    const returnData = genRes.json().return;
    expect(returnData.taxPeriod).toBe('2026-11');
    expect(returnData.status).toBe('DRAFT');
    expect(returnData.lines.length).toBeGreaterThan(0);

    // Verify anomaly detection: Missing e-TIN flagged on the line from supplierNoTinId
    const missingTinLine = returnData.lines.find(
      (l: { partyId: string }) => l.partyId === fixture.supplierNoTinId,
    );
    expect(missingTinLine).toBeDefined();
    expect(missingTinLine.penaltyApplied).toBe(true);
    expect(missingTinLine.anomalies).toContain('MISSING_ETIN');

    // Verification Lifecycle
    const verifyRes = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/reports/withholding/section177/${returnData.id}/verify`,
    );
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().return.status).toBe('VERIFIED');

    // Submission Lifecycle
    const submitRes = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/reports/withholding/section177/${returnData.id}/submit`,
    );
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().return.status).toBe('SUBMITTED');

    // Excel Export endpoint
    const exportRes = await authedWithHeaders(
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/reports/withholding/section177/${returnData.id}/export`,
    );
    expect(exportRes.statusCode).toBe(200);
    expect((exportRes.headers['content-type'] as string)).toContain('spreadsheetml.sheet');
    expect((exportRes.rawPayload as Buffer).length).toBeGreaterThan(1000);
  });

  it('provides 3-level IAS/IFRS statement drill-down with cryptographic SHA-256 chain verification', async () => {
    // Drill down on Note 8 / VAT or trade payable account
    const drillRes = await authedWithHeaders(
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/reports/statements/drill-down?accountCode=2110&from=2026-07-01&to=2026-12-31`,
    );
    expect(drillRes.statusCode, drillRes.body).toBe(200);
    const drill = drillRes.json().drillDown;

    // Level 1: Accounts & Movements
    expect(drill.level1.accounts.length).toBeGreaterThan(0);
    expect(drill.level1.accounts[0].accountCode).toBe('2110');

    // Level 2: Posted Journals & Chain verification
    expect(drill.level2.journals.length).toBeGreaterThan(0);
    expect(drill.level2.tamperEvidentChainVerified).toBe(true);
    for (const j of drill.level2.journals) {
      expect(j.chainHash).toMatch(/^[0-9a-f]{64}$/);
      expect(j.verifiedChain).toBe(true);
    }

    // Level 3: Source Documents
    expect(drill.level3.sourceDocuments.length).toBeGreaterThan(0);
    const sourceDoc = drill.level3.sourceDocuments[0];
    expect(sourceDoc.documentType).toBe('PURCHASE_BILL');
    expect(sourceDoc.mushak63Serial).toBeTruthy();
  });
});
