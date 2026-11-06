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
    key: 'ap',
    code: '2110',
    nameEn: 'Trade accounts payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'AP',
  },
  {
    key: 'inputVat',
    code: '1140',
    nameEn: 'VAT current account',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'VAT_CURRENT_ACCOUNT',
  },
  {
    key: 'vdsPayable',
    code: '2130',
    nameEn: 'VDS withheld payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'VDS_PAYABLE',
  },
  {
    key: 'tdsPayable',
    code: '2140',
    nameEn: 'TDS withheld payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'TDS_PAYABLE',
  },
  {
    key: 'reverseChargePayable',
    code: '2150',
    nameEn: 'Reverse-charge VAT payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
  {
    key: 'bank',
    code: '1010',
    nameEn: 'Bank current account',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'expense',
    code: '5200',
    nameEn: 'Freight and delivery expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    controlSubledger: 'NONE',
  },
] as const;

interface Fixture {
  organisationId: string;
  companyId: string;
  secondCompanyId: string;
  ownerCookies: AuthCookies;
  controllerCookies: AuthCookies;
  accountantCookies: AuthCookies;
  operatorCookies: AuthCookies;
  auditorCookies: AuthCookies;
  accounts: Record<string, { id: string; code: string }>;
  supplierId: string;
  bankAccountId: string;
}

describe.skipIf(!databaseAvailable)('Phase 9 receipts, treasury challans and certificates', () => {
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
    const suffix = unique('Treasury');
    const organisationId = await seedOrganisation(database.pool, `Organisation ${suffix}`);
    const emails = {
      owner: `owner-${suffix}@example.test`,
      controller: `controller-${suffix}@example.test`,
      accountant: `accountant-${suffix}@example.test`,
      operator: `operator-${suffix}@example.test`,
      auditor: `auditor-${suffix}@example.test`,
    };
    const ownerId = await seedUser(database.pool, { email: emails.owner, name: `Owner ${suffix}` });
    const controllerId = await seedUser(database.pool, { email: emails.controller, name: `Controller ${suffix}` });
    const accountantId = await seedUser(database.pool, { email: emails.accountant, name: `Accountant ${suffix}` });
    const operatorId = await seedUser(database.pool, { email: emails.operator, name: `Operator ${suffix}` });
    const auditorId = await seedUser(database.pool, { email: emails.auditor, name: `Auditor ${suffix}` });
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

    const settingsResponse = await authed(app, ownerCookies, 'PATCH', `/api/v1/companies/${companyId}/settings`, {
      tax: { withholdingEntity: true, vatStatus: 'VAT_REGISTERED_15', filingFrequency: 'MONTHLY' },
    });
    expect(settingsResponse.statusCode, settingsResponse.body).toBe(200);

    const supplierResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'SUP-001',
      nameEn: 'Supplier One',
      type: 'SUPPLIER',
      bin: '1234567890123',
      tin: '123456789012',
      creditDays: 30,
      creditLimit: '500000.00',
      isWithholdingBuyer: false,
      isGovernment: false,
    });
    expect(supplierResponse.statusCode, supplierResponse.body).toBe(201);
    const supplierId = supplierResponse.json().party.id as string;

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
      secondCompanyId,
      ownerCookies,
      controllerCookies,
      accountantCookies,
      operatorCookies,
      auditorCookies,
      accounts,
      supplierId,
      bankAccountId,
    };
  }

  function billBody(overrides: Record<string, unknown> = {}) {
    return {
      docType: 'PURCHASE_BILL',
      partyId: fixture.supplierId,
      docDate: '2026-11-15',
      dueDate: '2026-12-15',
      paymentTermsDays: 30,
      supplierInvoiceNo: unique('SUP-INV'),
      supplierInvoiceDate: '2026-11-14',
      supplierMushak63Serial: unique('M63-SUP'),
      supplierMushak63Date: '2026-11-14',
      attachmentReference: 'evidence/mushak63.pdf',
      narrationEn: 'Freight service purchase bill',
      paymentMethod: 'BANK',
      supplierTinMissing: false,
      vdsApplicable: true,
      tdsNature: 'SUPPLY_OF_GOODS',
      lines: [
        {
          descriptionEn: 'Freight service',
          quantity: '1.0000',
          unit: 'job',
          unitPrice: '1000.00',
          discount: '0.00',
          taxCategory: 'STANDARD_15',
          accountId: fixture.accounts.expense!.id,
        },
      ],
      ...overrides,
    };
  }

  async function createAndPostBill(cookies: AuthCookies = fixture.accountantCookies) {
    const draft = await authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents`,
      billBody(),
      { 'idempotency-key': randomUUID() },
    );
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    const posted = await authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/post`,
      undefined,
      { 'idempotency-key': randomUUID() },
    );
    expect(posted.statusCode, posted.body).toBe(200);
    return documentId;
  }

  async function previewPayment(
    allocations: Array<{ documentId: string; amount: string }>,
    partyId = fixture.supplierId,
  ) {
    return authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payments/preview`,
      { paymentDate: '2026-11-20', partyId, allocations },
    );
  }

  function paymentBody(billId: string, allocation: string, cash: string, overrides: Record<string, unknown> = {}) {
    return {
      paymentDate: '2026-11-20',
      partyId: fixture.supplierId,
      bankAccountId: fixture.bankAccountId,
      amount: cash,
      reference: unique('BANK-REF'),
      attachmentReference: 'evidence/bank-slip.pdf',
      narrationEn: 'Supplier payment',
      allocations: [{ documentId: billId, amount: allocation }],
      ...overrides,
    };
  }

  async function postPayment(
    body: Record<string, unknown>,
    cookies: AuthCookies = fixture.accountantCookies,
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(cookies, 'POST', `/api/v1/companies/${fixture.companyId}/purchases/payments`, body, {
      'idempotency-key': key,
    });
  }

  async function fullPayment(billId: string, cookies: AuthCookies = fixture.accountantCookies) {
    const preview = await previewPayment([{ documentId: billId, amount: '1150.00' }]);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview.totalCashPoisha).toBe('97000');
    const payment = await postPayment(paymentBody(billId, '1150.00', '970.00'), cookies);
    expect(payment.statusCode, payment.body).toBe(201);
    return payment.json().payment as {
      id: string;
      paymentNumber: string;
      vdsPoisha: string;
      tdsPoisha: string;
    };
  }

  async function liabilitiesForPayment(paymentId: string) {
    const response = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/liabilities?status=PENDING&limit=500`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().entries as Array<Record<string, unknown>>).filter((entry) => entry.paymentId === paymentId);
  }

  function depositBody(liabilities: Array<{ id: string; taxType: string }>, overrides: Record<string, unknown> = {}) {
    return {
      depositDate: '2026-11-25',
      bankAccountId: fixture.bankAccountId,
      bankBranch: 'Dhaka Main Branch',
      depositReference: unique('TREASURY-DEP'),
      evidenceReference: 'evidence/treasury-challan.pdf',
      items: liabilities.map((liability) => ({
        liabilityId: liability.id,
        economicCode: liability.taxType === 'VDS' ? 'VDS-EC-01' : 'TDS-EC-01',
      })),
      ...overrides,
    };
  }

  async function postDeposit(
    liabilities: Array<{ id: string; taxType: string }>,
    overrides: Record<string, unknown> = {},
    cookies: AuthCookies = fixture.accountantCookies,
  ) {
    return authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/challans`,
      depositBody(liabilities, overrides),
      { 'idempotency-key': randomUUID() },
    );
  }

  it('settles multiple bills partially, blocks a duplicate bank reference, and derives liabilities from the actual allocation', async () => {
    const firstBill = await createAndPostBill();
    const secondBill = await createAndPostBill();
    const allocations = [
      { documentId: firstBill, amount: '500.00' },
      { documentId: secondBill, amount: '500.00' },
    ];
    const preview = await previewPayment(allocations);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview.totalAllocationPoisha).toBe('100000');
    expect(preview.json().preview.totalVdsPoisha).toBe('13044');
    expect(preview.json().preview.totalTdsPoisha).toBe('2608');
    expect(preview.json().preview.totalCashPoisha).toBe('84348');

    const reference = unique('BANK-REF');
    const payment = await postPayment({
      paymentDate: '2026-11-20',
      partyId: fixture.supplierId,
      bankAccountId: fixture.bankAccountId,
      amount: '843.48',
      reference,
      attachmentReference: 'evidence/bank-slip.pdf',
      allocations,
    });
    expect(payment.statusCode, payment.body).toBe(201);
    expect(payment.json().payment.attachmentReference).toBe('evidence/bank-slip.pdf');

    const duplicate = await postPayment({
      paymentDate: '2026-11-21',
      partyId: fixture.supplierId,
      bankAccountId: fixture.bankAccountId,
      amount: '421.74',
      reference,
      allocations: [{ documentId: firstBill, amount: '500.00' }],
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().code).toBe('PURCHASE_PAYMENT_REFERENCE_DUPLICATE');

    const open = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/purchases/ap-ageing?asOf=2026-11-30`,
    );
    expect(open.statusCode, open.body).toBe(200);
    expect(open.json().ageing.proof.agrees).toBe(true);
    const amounts = new Map(
      (open.json().ageing.rows as Array<Record<string, unknown>>).map((row) => [row.documentId, row.outstandingPoisha]),
    );
    expect(amounts.get(firstBill)).toBe('65000');
    expect(amounts.get(secondBill)).toBe('65000');

    const liabilities = await liabilitiesForPayment(payment.json().payment.id);
    expect(liabilities).toHaveLength(4);
    expect(liabilities.filter((entry) => entry.taxType === 'VDS')).toHaveLength(2);
    expect(liabilities.filter((entry) => entry.taxType === 'TDS')).toHaveLength(2);
    const vdsTotal = liabilities
      .filter((entry) => entry.taxType === 'VDS')
      .reduce((sum, entry) => sum + BigInt(entry.amountPoisha as string), 0n);
    const tdsTotal = liabilities
      .filter((entry) => entry.taxType === 'TDS')
      .reduce((sum, entry) => sum + BigInt(entry.amountPoisha as string), 0n);
    expect(vdsTotal).toBe(13044n);
    expect(tdsTotal).toBe(2608n);
  });

  it('deposits selected liabilities once, persists a real challan and draft certificates, and proves control accounts', async () => {
    const billId = await createAndPostBill();
    const payment = await fullPayment(billId);
    const liabilities = await liabilitiesForPayment(payment.id);
    expect(liabilities).toHaveLength(2);
    const vds = liabilities.find((entry) => entry.taxType === 'VDS')!;
    const tds = liabilities.find((entry) => entry.taxType === 'TDS')!;
    expect(vds.amountPoisha).toBe('15000');
    expect(tds.amountPoisha).toBe('3000');

    const deposit = await postDeposit(liabilities as Array<{ id: string; taxType: string }>);
    expect(deposit.statusCode, deposit.body).toBe(201);
    const challan = deposit.json().challan;
    expect(challan.status).toBe('POSTED');
    expect(challan.challanNumber).toMatch(/^CH-2026-/);
    expect(challan.totalPoisha).toBe('18000');
    expect(challan.items).toHaveLength(2);

    const depositLines = await database.pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit_poisha::text AS debit, l.credit_poisha::text AS credit
         FROM journal_lines l
         JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
         JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE l.company_id = $1 AND j.id = $2
        ORDER BY a.code`,
      [fixture.companyId, challan.journalId],
    );
    const byCode = new Map(depositLines.rows.map((row) => [row.code, row]));
    expect(byCode.get('2130')).toMatchObject({ debit: '15000', credit: '0' });
    expect(byCode.get('2140')).toMatchObject({ debit: '3000', credit: '0' });
    expect(byCode.get('1010')).toMatchObject({ debit: '0', credit: '18000' });

    const certificateResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates?status=DRAFT&limit=200`,
    );
    expect(certificateResponse.statusCode, certificateResponse.body).toBe(200);
    const certificates = (certificateResponse.json().entries as Array<Record<string, unknown>>).filter(
      (entry) => entry.challanId === challan.id,
    );
    expect(certificates).toHaveLength(2);
    for (const certificate of certificates) {
      const source = liabilities.find((entry) => entry.id === certificate.liabilityId)!;
      expect(certificate.basePoisha).toBe(source.basePoisha);
      expect(certificate.taxPoisha).toBe(source.amountPoisha);
      expect(certificate.status).toBe('DRAFT');
      expect(certificate.reviewStatus).toBe('DRAFT_STATUTORY_FORMAT_UNVERIFIED');
      expect(certificate.certificateNumber).toMatch(/^CERT-2026-/);
    }

    const proof = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/proof?asOf=2026-11-30`,
    );
    expect(proof.statusCode, proof.body).toBe(200);
    expect(proof.json().proof.taxes.VDS.agrees).toBe(true);
    expect(proof.json().proof.taxes.TDS.agrees).toBe(true);
    expect(proof.json().proof.challans.agrees).toBe(true);
    expect(proof.json().proof.certificates.draftCount).toBe(2);

    const duplicate = await postDeposit(liabilities as Array<{ id: string; taxType: string }>);
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().code).toBe('TREASURY_LIABILITY_NOT_PENDING');

    const secondBill = await createAndPostBill();
    const secondPayment = await fullPayment(secondBill);
    const secondLiabilities = await liabilitiesForPayment(secondPayment.id);
    const duplicateReference = await postDeposit(secondLiabilities as Array<{ id: string; taxType: string }>, {
      depositReference: challan.depositReference,
      evidenceReference: 'evidence/duplicate-slip.pdf',
    });
    expect(duplicateReference.statusCode, duplicateReference.body).toBe(409);
    expect(duplicateReference.json().code).toBe('TREASURY_DEPOSIT_REFERENCE_DUPLICATE');
  });

  it('reverses a deposit, restores pending liabilities and cancels its certificates without deleting history', async () => {
    const billId = await createAndPostBill();
    const payment = await fullPayment(billId);
    const liabilities = await liabilitiesForPayment(payment.id);
    const deposit = await postDeposit(liabilities as Array<{ id: string; taxType: string }>);
    expect(deposit.statusCode, deposit.body).toBe(201);
    const challan = deposit.json().challan;

    const reversed = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/challans/${challan.id}/reverse`,
      { date: '2026-11-27', reason: 'Bank returned the treasury deposit slip; re-deposit required.' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().challan.status).toBe('REVERSED');
    expect(reversed.json().challan.reversalJournalId).toBeTruthy();

    const restored = await liabilitiesForPayment(payment.id);
    expect(restored).toHaveLength(2);
    expect(restored.every((entry) => entry.status === 'PENDING')).toBe(true);
    expect(restored.every((entry) => entry.challanId === null)).toBe(true);

    const certificateResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates?limit=200`,
    );
    const certificates = (certificateResponse.json().entries as Array<Record<string, unknown>>).filter(
      (entry) => entry.challanId === challan.id,
    );
    expect(certificates.every((entry) => entry.status === 'CANCELLED')).toBe(true);

    const secondReverse = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/challans/${challan.id}/reverse`,
      { date: '2026-11-28', reason: 'A second reversal must be rejected.' },
    );
    expect(secondReverse.statusCode, secondReverse.body).toBe(409);
    expect(secondReverse.json().code).toBe('TREASURY_CHALLAN_ALREADY_REVERSED');

    const redeposit = await postDeposit(restored as Array<{ id: string; taxType: string }>);
    expect(redeposit.statusCode, redeposit.body).toBe(201);
    expect(redeposit.json().challan.id).not.toBe(challan.id);

    const proof = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/proof?asOf=2026-11-30`,
    );
    expect(proof.json().proof.taxes.VDS.agrees).toBe(true);
    expect(proof.json().proof.taxes.TDS.agrees).toBe(true);
    expect(proof.json().proof.challans.agrees).toBe(true);
  });

  it('keeps certificate amounts derived from the liability and uses cancellation plus reissue', async () => {
    const billId = await createAndPostBill();
    const payment = await fullPayment(billId);
    const liabilities = await liabilitiesForPayment(payment.id);
    const deposit = await postDeposit(liabilities as Array<{ id: string; taxType: string }>);
    expect(deposit.statusCode, deposit.body).toBe(201);

    const certificateResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates?limit=200`,
    );
    const certificate = (certificateResponse.json().entries as Array<Record<string, unknown>>).find(
      (entry) => entry.challanId === deposit.json().challan.id,
    )!;
    const source = liabilities.find((entry) => entry.id === certificate.liabilityId)!;

    const cancelled = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates/${certificate.id}/cancel`,
      { reason: 'Bank branch was printed incorrectly on the draft certificate.' },
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().certificate.status).toBe('CANCELLED');

    const reissued = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates/${certificate.id}/reissue`,
      {
        reason: 'Reissue the draft with the corrected evidence reference.',
        evidenceReference: 'evidence/corrected-challan.pdf',
      },
    );
    expect(reissued.statusCode, reissued.body).toBe(200);
    const replacement = reissued.json().certificate;
    expect(replacement.status).toBe('DRAFT');
    expect(replacement.certificateNumber).not.toBe(certificate.certificateNumber);
    expect(replacement.basePoisha).toBe(source.basePoisha);
    expect(replacement.taxPoisha).toBe(source.amountPoisha);
    expect(replacement.reissuedFromId).toBe(certificate.id);

    const secondCancel = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/treasury/certificates/${certificate.id}/cancel`,
      { reason: 'Cancelling the same certificate twice must fail.' },
    );
    expect(secondCancel.statusCode, secondCancel.body).toBe(409);
    expect(secondCancel.json().code).toBe('TREASURY_CERTIFICATE_ALREADY_CANCELLED');
  });

  it('enforces payment approval thresholds and maker-checker for a high-value payment', async () => {
    const threshold = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      { approvalThresholds: { payment: '500.00' } },
    );
    expect(threshold.statusCode, threshold.body).toBe(200);

    const billId = await createAndPostBill();
    const preview = await previewPayment([{ documentId: billId, amount: '1150.00' }]);
    expect(preview.statusCode, preview.body).toBe(200);
    const request = await postPayment(paymentBody(billId, '1150.00', '970.00'), fixture.controllerCookies);
    expect(request.statusCode, request.body).toBe(202);
    const approval = request.json().approvalRequest;
    expect(approval.status).toBe('PENDING');
    expect(approval.amountPoisha).toBe('97000');

    const selfApproval = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payment-approvals/${approval.id}/approve`,
      { reason: 'Attempting to approve my own payment.' },
    );
    expect(selfApproval.statusCode, selfApproval.body).toBe(403);
    expect(selfApproval.json().code).toBe('PURCHASE_PAYMENT_SELF_APPROVAL');

    const approved = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payment-approvals/${approval.id}/approve`,
      { reason: 'Reviewed the bill, allocation and withholding preview.' },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const payment = approved.json().payment;
    expect(payment.status).toBe('POSTED');
    expect(payment.approvedBy).toBeTruthy();
    expect(payment.approvedAt).toBeTruthy();
    expect(payment.vdsPoisha).toBe('15000');
    expect(payment.tdsPoisha).toBe('3000');

    const open = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM purchase_ap_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, billId],
    );
    expect(open.rows[0]?.outstanding_poisha).toBe('0');

    const reset = await authed(app, fixture.ownerCookies, 'PATCH', `/api/v1/companies/${fixture.companyId}/settings`, {
      approvalThresholds: { payment: '0.00' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
  });

  it('enforces treasury permissions and cross-company isolation', async () => {
    const reset = await authed(app, fixture.ownerCookies, 'PATCH', `/api/v1/companies/${fixture.companyId}/settings`, {
      approvalThresholds: { payment: '0.00' },
    });
    expect(reset.statusCode, reset.body).toBe(200);

    const billId = await createAndPostBill();
    const payment = await fullPayment(billId);
    const liabilities = await liabilitiesForPayment(payment.id);
    const deposit = await postDeposit(liabilities as Array<{ id: string; taxType: string }>);
    expect(deposit.statusCode, deposit.body).toBe(201);
    const challan = deposit.json().challan;
    const certificate = challan.items[0].certificateId as string;

    const operatorDeposit = await postDeposit([{ id: randomUUID(), taxType: 'VDS' }], {}, fixture.operatorCookies);
    expect(operatorDeposit.statusCode, operatorDeposit.body).toBe(403);

    const auditorDeposit = await postDeposit([{ id: randomUUID(), taxType: 'VDS' }], {}, fixture.auditorCookies);
    expect(auditorDeposit.statusCode, auditorDeposit.body).toBe(403);

    const crossCompanyChallan = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/treasury/challans/${challan.id}`,
    );
    expect(crossCompanyChallan.statusCode, crossCompanyChallan.body).toBe(404);

    const crossCompanyCertificate = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/treasury/certificates/${certificate}`,
    );
    expect(crossCompanyCertificate.statusCode, crossCompanyCertificate.body).toBe(404);

    const crossCompanyBank = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/treasury/challans`,
      depositBody(liabilities as Array<{ id: string; taxType: string }>),
      { 'idempotency-key': randomUUID() },
    );
    expect(crossCompanyBank.statusCode, crossCompanyBank.body).toBe(404);
  });
});
