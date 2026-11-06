import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { parseStoredQuantity } from '../../src/inventory/quantity.ts';
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
    key: 'inventory',
    code: '1310',
    nameEn: 'Merchandise inventory',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'INVENTORY',
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
  {
    key: 'cogs',
    code: '5100',
    nameEn: 'Cost of goods sold',
    accountType: 'EXPENSE',
    subCategory: 'COST_OF_SALES',
    controlSubledger: 'NONE',
  },
  {
    key: 'capital',
    code: '3000',
    nameEn: 'Share capital',
    accountType: 'EQUITY',
    subCategory: 'EQUITY_CAPITAL',
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
  branchId: string;
  warehouseId: string;
  supplierId: string;
  supplierNoTinId: string;
  stockItemId: string;
  serviceItemId: string;
  bankAccountId: string;
  taxApproved: boolean;
}

describe.skipIf(!databaseAvailable)('Phase 8 purchases, bills and payables', () => {
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
    const suffix = unique('Purchases');
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
      {
        legalName: `${suffix} Ltd`,
        ...COMPANY_PROFILE,
      },
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

    const branchResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/branches`, {
      code: 'HQ',
      nameEn: 'Head office',
      isPrincipal: true,
    });
    expect(branchResponse.statusCode, branchResponse.body).toBe(201);
    const branchId = branchResponse.json().branch.id as string;

    const warehouseResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/warehouses`, {
      branchId,
      code: 'MAIN',
      nameEn: 'Main warehouse',
    });
    expect(warehouseResponse.statusCode, warehouseResponse.body).toBe(201);
    const warehouseId = warehouseResponse.json().warehouse.id as string;

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

    const supplierNoTinResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'SUP-NOTIN',
      nameEn: 'Supplier Without TIN',
      type: 'SUPPLIER',
      bin: '9876543210123',
      tin: null,
      creditDays: 30,
      creditLimit: '500000.00',
      isWithholdingBuyer: false,
      isGovernment: false,
    });
    expect(supplierNoTinResponse.statusCode, supplierNoTinResponse.body).toBe(201);
    const supplierNoTinId = supplierNoTinResponse.json().party.id as string;

    const itemResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
      sku: 'RICE-5KG',
      hsCode: '1006.30',
      nameEn: 'Rice 5kg',
      unit: 'kg',
      isStockItem: true,
      defaultTaxCategory: 'STANDARD_15',
      inventoryAccountId: accounts.inventory!.id,
      expenseAccountId: accounts.cogs!.id,
    });
    expect(itemResponse.statusCode, itemResponse.body).toBe(201);
    const stockItemId = itemResponse.json().item.id as string;

    const serviceItemResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
      sku: 'SVC-FREIGHT',
      nameEn: 'Freight service',
      unit: 'job',
      isStockItem: false,
      defaultTaxCategory: 'STANDARD_15',
    });
    expect(serviceItemResponse.statusCode, serviceItemResponse.body).toBe(201);
    const serviceItemId = serviceItemResponse.json().item.id as string;

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

    const opening = await authedWithHeaders(
      ownerCookies,
      'POST',
      `/api/v1/companies/${companyId}/inventory/movements`,
      {
        type: 'OPENING',
        itemId: stockItemId,
        date: '2026-11-01',
        quantity: '100.0000',
        warehouseId,
        unitCost: '100.00',
        offsetAccountId: accounts.capital!.id,
        reason: 'Phase 8 fixture opening stock',
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(opening.statusCode, opening.body).toBe(201);

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
      branchId,
      warehouseId,
      supplierId,
      supplierNoTinId,
      stockItemId,
      serviceItemId,
      bankAccountId,
      taxApproved: false,
    };
  }

  async function approveTaxPolicy() {
    const response = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/tax-policy/approval`,
      {
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA, Bangladesh tax practice',
        sourceReference: 'Engagement letter TAX-2026-08 and reviewed pack bd-2026-v1',
        reviewedAt: '2026-11-02',
        inputVatAccountId: fixture.accounts.inputVat!.id,
        vdsPayableAccountId: fixture.accounts.vdsPayable!.id,
        tdsPayableAccountId: fixture.accounts.tdsPayable!.id,
        reverseChargePayableAccountId: fixture.accounts.reverseChargePayable!.id,
        rulePackVersion: 'bd-2026-v1',
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    fixture.taxApproved = true;
    return response;
  }

  function billBody(overrides: Record<string, unknown> = {}) {
    return {
      docType: 'PURCHASE_BILL',
      partyId: fixture.supplierId,
      branchId: fixture.branchId,
      docDate: '2026-11-15',
      dueDate: '2026-12-15',
      paymentTermsDays: 30,
      supplierInvoiceNo: unique('SUP-INV'),
      supplierInvoiceDate: '2026-11-14',
      supplierMushak63Serial: unique('M63-SUP'),
      supplierMushak63Date: '2026-11-14',
      attachmentReference: 'evidence/mushak63.pdf',
      narrationEn: 'Purchase bill for resale stock and freight',
      paymentMethod: 'BANK',
      supplierTinMissing: false,
      vdsApplicable: true,
      tdsNature: 'SUPPLY_OF_GOODS',
      lines: [
        {
          itemId: fixture.stockItemId,
          descriptionEn: 'Rice 5kg',
          quantity: '5.0000',
          unit: 'kg',
          unitPrice: '200.00',
          discount: '0.00',
          taxCategory: 'STANDARD_15',
          accountId: fixture.accounts.inventory!.id,
          warehouseId: fixture.warehouseId,
        },
        {
          itemId: fixture.serviceItemId,
          descriptionEn: 'Freight service',
          quantity: '1.0000',
          unit: 'job',
          unitPrice: '1000.00',
          discount: '0.00',
          taxCategory: 'STANDARD_15',
          accountId: fixture.accounts.expense!.id,
          warehouseId: null,
        },
      ],
      ...overrides,
    };
  }

  function expenseBody(overrides: Record<string, unknown> = {}) {
    return {
      docType: 'EXPENSE_VOUCHER',
      partyId: fixture.supplierId,
      branchId: fixture.branchId,
      docDate: '2026-11-16',
      dueDate: '2026-11-16',
      paymentTermsDays: 0,
      supplierInvoiceNo: unique('EXP-INV'),
      supplierInvoiceDate: '2026-11-16',
      supplierMushak63Serial: unique('M63-EXP'),
      supplierMushak63Date: '2026-11-16',
      narrationEn: 'Freight expense voucher',
      paymentMethod: 'BANK',
      supplierTinMissing: false,
      vdsApplicable: true,
      tdsNature: 'SUPPLY_OF_GOODS',
      lines: [
        {
          itemId: fixture.serviceItemId,
          descriptionEn: 'Freight service',
          quantity: '1.0000',
          unit: 'job',
          unitPrice: '500.00',
          discount: '0.00',
          taxCategory: 'STANDARD_15',
          accountId: fixture.accounts.expense!.id,
          warehouseId: null,
        },
      ],
      ...overrides,
    };
  }

  async function createDraft(
    body: Record<string, unknown>,
    cookies: AuthCookies = fixture.accountantCookies,
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(cookies, 'POST', `/api/v1/companies/${fixture.companyId}/purchases/documents`, body, {
      'idempotency-key': key,
    });
  }

  async function postDocument(
    documentId: string,
    cookies: AuthCookies = fixture.accountantCookies,
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/post`,
      undefined,
      { 'idempotency-key': key },
    );
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

  async function postPayment(
    body: Record<string, unknown>,
    cookies: AuthCookies = fixture.accountantCookies,
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(cookies, 'POST', `/api/v1/companies/${fixture.companyId}/purchases/payments`, body, {
      'idempotency-key': key,
    });
  }

  function paymentBody(billId: string, allocation: string, cash: string, overrides: Record<string, unknown> = {}) {
    return {
      paymentDate: '2026-11-20',
      partyId: fixture.supplierId,
      branchId: fixture.branchId,
      bankAccountId: fixture.bankAccountId,
      amount: cash,
      reference: unique('BANK-REF'),
      narrationEn: 'Supplier payment',
      allocations: [{ documentId: billId, amount: allocation }],
      ...overrides,
    };
  }

  it('requires a recorded tax-policy approval before posting and then posts a stock and expense bill once', async () => {
    const draft = await createDraft(billBody());
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    expect(draft.json().document.status).toBe('DRAFT');
    expect(draft.json().document.grossPoisha).toBe('230000');
    expect(draft.json().document.vatClaimablePoisha).toBe('30000');
    expect(draft.json().document.vdsPoisha).toBe('30000');
    expect(draft.json().document.tdsPoisha).toBe('6000');
    expect(draft.json().document.netPayablePoisha).toBe('194000');

    const blocked = await postDocument(documentId);
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().code).toBe('PURCHASE_TAX_POLICY_NOT_APPROVED');

    await approveTaxPolicy();
    const postKey = randomUUID();
    const posted = await postDocument(documentId, fixture.accountantCookies, postKey);
    expect(posted.statusCode, posted.body).toBe(200);
    const document = posted.json().document;
    expect(document.status).toBe('POSTED');
    expect(document.documentNo).toMatch(/^PB-2026-/);
    expect(document.journalId).toBeTruthy();

    const replay = await postDocument(documentId, fixture.accountantCookies, postKey);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    const secondKey = await postDocument(documentId);
    expect(secondKey.statusCode, secondKey.body).toBe(409);
    expect(secondKey.json().code).toBe('PURCHASE_DOCUMENT_ALREADY_POSTED');

    const journal = await database.pool.query<{ id: string }>(
      `SELECT id FROM journals
        WHERE company_id = $1 AND source_module = 'PURCHASES' AND source_doc_id = $2
          AND reversal_of_journal_id IS NULL`,
      [fixture.companyId, documentId],
    );
    expect(journal.rows).toHaveLength(1);
    const lines = await database.pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit_poisha::text AS debit, l.credit_poisha::text AS credit
         FROM journal_lines l JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE l.company_id = $1 AND l.journal_id = $2
        ORDER BY a.code`,
      [fixture.companyId, journal.rows[0]!.id],
    );
    const byCode = new Map(lines.rows.map((row) => [row.code, row]));
    expect(byCode.get('1310')).toMatchObject({ debit: '100000', credit: '0' });
    expect(byCode.get('5200')).toMatchObject({ debit: '100000', credit: '0' });
    expect(byCode.get('1140')).toMatchObject({ debit: '30000', credit: '0' });
    expect(byCode.get('2110')).toMatchObject({ debit: '0', credit: '230000' });
    const totals = await database.pool.query<{ debit: string; credit: string }>(
      `SELECT sum(debit_poisha)::text AS debit, sum(credit_poisha)::text AS credit
         FROM journal_lines WHERE company_id = $1 AND journal_id = $2`,
      [fixture.companyId, journal.rows[0]!.id],
    );
    expect(totals.rows[0]!.debit).toBe(totals.rows[0]!.credit);

    const stock = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.stockItemId, fixture.warehouseId],
    );
    expect(stock.rows[0]?.quantity).toBe('105.0000');
    expect(stock.rows[0]?.value_poisha).toBe('1100000');

    const open = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha
         FROM purchase_ap_open_items WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(open.rows[0]?.outstanding_poisha).toBe('230000');
    const payments = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM purchase_payments WHERE company_id = $1`,
      [fixture.companyId],
    );
    expect(payments.rows[0]?.count).toBe('0');

    const taxes = await database.pool.query<{ tax_type: string; amount_poisha: string; rate_bps: number }>(
      `SELECT tax_type, amount_poisha::text AS amount_poisha, rate_bps
         FROM purchase_document_taxes WHERE company_id = $1 AND document_id = $2 ORDER BY tax_type`,
      [fixture.companyId, documentId],
    );
    expect(taxes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tax_type: 'VDS', amount_poisha: '30000', rate_bps: 1500 }),
        expect.objectContaining({ tax_type: 'TDS', amount_poisha: '6000', rate_bps: 300 }),
      ]),
    );
  });

  it('requires a different controller to approve a high-value purchase bill', async () => {
    const threshold = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      { approvalThresholds: { highValue: '1000.00' } },
    );
    expect(threshold.statusCode, threshold.body).toBe(200);

    const draft = await createDraft(billBody({ supplierInvoiceNo: unique('SUP-HIGH') }));
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    expect(draft.json().document.approvalRequired).toBe(true);

    const blocked = await postDocument(documentId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('PURCHASE_APPROVAL_REQUIRED');

    const selfApproval = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/approve`,
      { reason: 'Self approval attempt' },
    );
    expect(selfApproval.statusCode).toBe(403);

    const approved = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/approve`,
      { reason: 'High-value purchase bill reviewed against the supplier invoice' },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().document.approvedBy).toBeTruthy();

    const editAttempt = await authed(
      app,
      fixture.accountantCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}`,
      billBody({ supplierInvoiceNo: unique('SUP-HIGH-EDIT') }),
    );
    expect(editAttempt.statusCode).toBe(409);
    expect(editAttempt.json().code).toBe('PURCHASE_DOCUMENT_APPROVED_IMMUTABLE');

    const posted = await postDocument(documentId);
    expect(posted.statusCode, posted.body).toBe(200);

    const reset = await authed(app, fixture.ownerCookies, 'PATCH', `/api/v1/companies/${fixture.companyId}/settings`, {
      approvalThresholds: { highValue: '0.00' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
  });

  it('posts an expense voucher without moving stock', async () => {
    const stockBefore = await database.pool.query<{ quantity: string }>(
      `SELECT quantity::text AS quantity FROM stock_balances
        WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.stockItemId, fixture.warehouseId],
    );
    const draft = await createDraft(expenseBody());
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    const posted = await postDocument(documentId);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().document.documentNo).toMatch(/^PV-2026-/);
    expect(posted.json().document.grossPoisha).toBe('57500');
    expect(posted.json().document.vdsPoisha).toBe('7500');
    expect(posted.json().document.tdsPoisha).toBe('1500');

    const stockAfter = await database.pool.query<{ quantity: string }>(
      `SELECT quantity::text AS quantity FROM stock_balances
        WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.stockItemId, fixture.warehouseId],
    );
    expect(stockAfter.rows[0]?.quantity).toBe(stockBefore.rows[0]?.quantity);
    const movements = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_movements
        WHERE company_id = $1 AND source_doc_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(movements.rows[0]?.count).toBe('0');

    const lines = await database.pool.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit_poisha::text AS debit, l.credit_poisha::text AS credit
         FROM journal_lines l
         JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
         JOIN accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE l.company_id = $1 AND j.source_doc_id = $2
        ORDER BY a.code`,
      [fixture.companyId, documentId],
    );
    const byCode = new Map(lines.rows.map((row) => [row.code, row]));
    expect(byCode.get('5200')).toMatchObject({ debit: '50000' });
    expect(byCode.get('1140')).toMatchObject({ debit: '7500' });
    expect(byCode.get('2110')).toMatchObject({ credit: '57500' });
  });

  it('applies a missing e-TIN to the posted TDS and the actual payment', async () => {
    const body = billBody({
      partyId: fixture.supplierNoTinId,
      lines: [
        {
          itemId: fixture.serviceItemId,
          descriptionEn: 'Freight service',
          quantity: '1.0000',
          unit: 'job',
          unitPrice: '1000.00',
          discount: '0.00',
          taxCategory: 'STANDARD_15',
          accountId: fixture.accounts.expense!.id,
          warehouseId: null,
        },
      ],
    });
    const draft = await createDraft(body);
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    expect(draft.json().document.supplierTinMissing).toBe(false);
    expect(draft.json().document.tdsPoisha).toBe('4500');
    expect(draft.json().document.netPayablePoisha).toBe('95500');

    const posted = await postDocument(documentId);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().document.tdsPoisha).toBe('4500');
    expect(posted.json().document.netPayablePoisha).toBe('95500');

    const preview = await previewPayment([{ documentId, amount: '1150.00' }], fixture.supplierNoTinId);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview.totalVdsPoisha).toBe('15000');
    expect(preview.json().preview.totalTdsPoisha).toBe('4500');
    expect(preview.json().preview.totalCashPoisha).toBe('95500');

    const payment = await postPayment(
      paymentBody(documentId, '1150.00', '955.00', {
        partyId: fixture.supplierNoTinId,
      }),
    );
    expect(payment.statusCode, payment.body).toBe(201);
    expect(payment.json().payment.tdsPoisha).toBe('4500');
    expect(payment.json().payment.vdsPoisha).toBe('15000');
    expect(payment.json().payment.amountPoisha).toBe('95500');

    const liability = await database.pool.query<{ tax_type: string; amount_poisha: string; rate_bps: number }>(
      `SELECT tax_type, amount_poisha::text AS amount_poisha, rate_bps
         FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND payment_id = $2 ORDER BY tax_type`,
      [fixture.companyId, payment.json().payment.id],
    );
    expect(liability.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tax_type: 'VDS', amount_poisha: '15000', rate_bps: 1500 }),
        expect.objectContaining({ tax_type: 'TDS', amount_poisha: '4500', rate_bps: 450 }),
      ]),
    );

    const open = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM purchase_ap_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(open.rows[0]?.outstanding_poisha).toBe('0');
  });

  it('allocates a partial payment, reverses it and reopens AP exactly once', async () => {
    const draft = await createDraft(billBody());
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    const posted = await postDocument(documentId);
    expect(posted.statusCode, posted.body).toBe(200);

    const preview = await previewPayment([{ documentId, amount: '1150.00' }]);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview.allocations[0]).toMatchObject({
      basePoisha: '100000',
      vdsPoisha: '15000',
      tdsPoisha: '3000',
      cashPoisha: '97000',
    });

    const payment = await postPayment(paymentBody(documentId, '1150.00', '970.00'));
    expect(payment.statusCode, payment.body).toBe(201);
    expect(payment.json().payment.allocatedPoisha).toBe('115000');
    expect(payment.json().payment.amountPoisha).toBe('97000');

    const openAfterPayment = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM purchase_ap_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(openAfterPayment.rows[0]?.outstanding_poisha).toBe('115000');

    const reversed = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payments/${payment.json().payment.id}/reverse`,
      { date: '2026-11-21', reason: 'Incorrect bank reference entered by the operator' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().payment.status).toBe('REVERSED');

    const openAfterReversal = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM purchase_ap_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(openAfterReversal.rows[0]?.outstanding_poisha).toBe('230000');

    const liabilities = await database.pool.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND payment_id = $2 GROUP BY status`,
      [fixture.companyId, payment.json().payment.id],
    );
    expect(liabilities.rows).toEqual([{ status: 'REVERSED', count: '2' }]);

    const again = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/payments/${payment.json().payment.id}/reverse`,
      { date: '2026-11-21', reason: 'Attempt duplicate reversal' },
    );
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().code).toBe('PURCHASE_PAYMENT_ALREADY_REVERSED');
  });

  it('blocks duplicate bank references, over-allocation and replayed payments', async () => {
    const first = await createDraft(billBody());
    expect(first.statusCode, first.body).toBe(201);
    const firstId = first.json().document.id as string;
    expect((await postDocument(firstId)).statusCode).toBe(200);

    const second = await createDraft(billBody());
    expect(second.statusCode, second.body).toBe(201);
    const secondId = second.json().document.id as string;
    expect((await postDocument(secondId)).statusCode).toBe(200);

    const reference = unique('DUP-REF');
    const paymentKey = randomUUID();
    const firstPayment = await postPayment(
      paymentBody(firstId, '2300.00', '1940.00', { reference }),
      fixture.accountantCookies,
      paymentKey,
    );
    expect(firstPayment.statusCode, firstPayment.body).toBe(201);

    const replay = await postPayment(
      paymentBody(firstId, '2300.00', '1940.00', { reference }),
      fixture.accountantCookies,
      paymentKey,
    );
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().payment.id).toBe(firstPayment.json().payment.id);

    const duplicateReference = await postPayment(paymentBody(secondId, '2300.00', '1940.00', { reference }));
    expect(duplicateReference.statusCode, duplicateReference.body).toBe(409);
    expect(duplicateReference.json().code).toBe('PURCHASE_PAYMENT_REFERENCE_DUPLICATE');

    const overAllocation = await postPayment(paymentBody(secondId, '9999.00', '9999.00'));
    expect(overAllocation.statusCode, overAllocation.body).toBe(409);
    expect(['PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_OPEN', 'PURCHASE_PAYMENT_AMOUNT_MISMATCH']).toContain(
      overAllocation.json().code,
    );
  });

  it('reverses a posted bill with stock restoration and refuses a second reversal or a paid bill', async () => {
    const draft = await createDraft(billBody());
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    expect((await postDocument(documentId)).statusCode).toBe(200);

    const stockBefore = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha FROM stock_balances
        WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.stockItemId, fixture.warehouseId],
    );

    const reversed = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/reverse`,
      { date: '2026-11-22', reason: 'Supplier cancelled the goods and the bill was posted in error' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().document.status).toBe('REVERSED');

    const stockAfter = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha FROM stock_balances
        WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.stockItemId, fixture.warehouseId],
    );
    expect(parseStoredQuantity(stockAfter.rows[0]!.quantity) - parseStoredQuantity(stockBefore.rows[0]!.quantity)).toBe(
      -50_000n,
    );
    expect(BigInt(stockAfter.rows[0]!.value_poisha) - BigInt(stockBefore.rows[0]!.value_poisha)).toBe(-100000n);

    const open = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM purchase_ap_open_items WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentId],
    );
    expect(open.rows[0]?.count).toBe('0');

    const again = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${documentId}/reverse`,
      { date: '2026-11-22', reason: 'Attempt duplicate reversal' },
    );
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().code).toBe('PURCHASE_DOCUMENT_ALREADY_REVERSED');

    const paidDraft = await createDraft(billBody());
    expect(paidDraft.statusCode, paidDraft.body).toBe(201);
    const paidId = paidDraft.json().document.id as string;
    expect((await postDocument(paidId)).statusCode).toBe(200);
    const payment = await postPayment(paymentBody(paidId, '1150.00', '970.00'));
    expect(payment.statusCode, payment.body).toBe(201);
    const blocked = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/purchases/documents/${paidId}/reverse`,
      { date: '2026-11-22', reason: 'Try reversing a paid bill without reversing the payment' },
    );
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().code).toBe('PURCHASE_DOCUMENT_HAS_PAYMENTS');
  });

  it('proves AP ageing and the supplier statement against the control account', async () => {
    const ageing = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/purchases/ap-ageing?asOf=2026-11-30`,
    );
    expect(ageing.statusCode, ageing.body).toBe(200);
    const body = ageing.json().ageing;
    expect(body.proof.agrees).toBe(true);
    expect(body.proof.differencePoisha).toBe('0');
    const bucketTotal = ['CURRENT', '1_30', '31_60', '61_90', '91_180', 'OVER_180'].reduce(
      (sum, bucket) => sum + BigInt(body.totals[bucket]),
      0n,
    );
    expect(bucketTotal).toBe(BigInt(body.totals.NET));

    const statement = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/purchases/supplier-statement?partyId=${fixture.supplierId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(statement.statusCode, statement.body).toBe(200);
    const statementBody = statement.json().statement;
    const statementNet =
      BigInt(statementBody.openingPoisha) +
      statementBody.lines.reduce(
        (sum: bigint, line: any) => sum + BigInt(line.debitPoisha) - BigInt(line.creditPoisha),
        0n,
      );
    expect(statementBody.closingPoisha).toBe(statementNet.toString());
    expect(statementBody.lines.some((line: any) => line.kind === 'PURCHASE_BILL')).toBe(true);
    expect(statementBody.lines.some((line: any) => line.kind === 'PAYMENT')).toBe(true);

    const proof = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/purchases/withholding-proof?asOf=2026-11-30`,
    );
    expect(proof.statusCode, proof.body).toBe(200);
    expect(proof.json().proof.vds.agrees).toBe(true);
    expect(proof.json().proof.tds.agrees).toBe(true);
    expect(proof.json().proof.reverseCharge.agrees).toBe(true);
  });

  it('capitalises disallowed VAT when no supplier Mushak 6.3 evidence is recorded', async () => {
    const draft = await createDraft(
      billBody({
        supplierMushak63Serial: null,
        supplierMushak63Date: null,
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Freight without tax invoice evidence',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '1000.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            accountId: fixture.accounts.expense!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    expect(draft.statusCode, draft.body).toBe(201);
    const documentId = draft.json().document.id as string;
    expect(draft.json().document.vatClaimablePoisha).toBe('0');
    expect(draft.json().document.vatDisallowedPoisha).toBe('15000');
    expect(draft.json().document.supplierMushak63Serial).toBeNull();

    const posted = await postDocument(documentId);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().document.vatClaimablePoisha).toBe('0');
    expect(posted.json().document.vatDisallowedPoisha).toBe('15000');

    const evidence = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM purchase_document_taxes
        WHERE company_id = $1 AND document_id = $2 AND tax_type IN ('VAT','REVERSE_CHARGE') AND claimable_poisha > 0`,
      [fixture.companyId, documentId],
    );
    expect(evidence.rows[0]?.count).toBe('0');
    const expenseLine = await database.pool.query<{ debit: string }>(
      `SELECT l.debit_poisha::text AS debit
         FROM journal_lines l
         JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
        WHERE l.company_id = $1 AND j.source_doc_id = $2 AND l.account_id = $3`,
      [fixture.companyId, documentId, fixture.accounts.expense!.id],
    );
    expect(expenseLine.rows[0]?.debit).toBe('115000');
  });

  it('posts reverse-charge VAT as a liability and only claims it with a challan reference', async () => {
    const noChallan = await createDraft(
      expenseBody({
        partyId: fixture.supplierNoTinId,
        vdsApplicable: false,
        tdsNature: 'NONE',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Imported digital service',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '1000.00',
            discount: '0.00',
            taxCategory: 'REVERSE_CHARGE',
            accountId: fixture.accounts.expense!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    expect(noChallan.statusCode, noChallan.body).toBe(201);
    const noChallanId = noChallan.json().document.id as string;
    expect(noChallan.json().document.reverseChargeVatPoisha).toBe('15000');
    expect(noChallan.json().document.grossPoisha).toBe('100000');
    expect(noChallan.json().document.vatClaimablePoisha).toBe('0');
    const postedNoChallan = await postDocument(noChallanId);
    expect(postedNoChallan.statusCode, postedNoChallan.body).toBe(200);

    const rcLiability = await database.pool.query<{ tax_type: string; amount_poisha: string; status: string }>(
      `SELECT tax_type, amount_poisha::text AS amount_poisha, status
         FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND bill_id = $2 AND source_type = 'BILL'`,
      [fixture.companyId, noChallanId],
    );
    expect(rcLiability.rows[0]).toMatchObject({
      tax_type: 'REVERSE_CHARGE',
      amount_poisha: '15000',
      status: 'PENDING',
    });

    const withChallan = await createDraft(
      expenseBody({
        partyId: fixture.supplierNoTinId,
        vdsApplicable: false,
        tdsNature: 'NONE',
        reverseChargeChallanReference: 'TREASURY-RC-2026-0001',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Imported digital service with challan',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '1000.00',
            discount: '0.00',
            taxCategory: 'REVERSE_CHARGE',
            accountId: fixture.accounts.expense!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    expect(withChallan.statusCode, withChallan.body).toBe(201);
    expect(withChallan.json().document.vatClaimablePoisha).toBe('15000');
    const postedWithChallan = await postDocument(withChallan.json().document.id);
    expect(postedWithChallan.statusCode, postedWithChallan.body).toBe(200);
  });

  it('enforces permissions, tenant isolation and closed periods', async () => {
    const auditorDraft = await createDraft(billBody(), fixture.auditorCookies);
    expect(auditorDraft.statusCode, auditorDraft.body).toBe(403);

    const operatorDraft = await createDraft(billBody(), fixture.operatorCookies);
    expect(operatorDraft.statusCode, operatorDraft.body).toBe(201);
    const operatorPost = await postDocument(operatorDraft.json().document.id, fixture.operatorCookies);
    expect(operatorPost.statusCode, operatorPost.body).toBe(403);

    const crossCompanyGet = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/purchases/documents/${operatorDraft.json().document.id}`,
    );
    expect(crossCompanyGet.statusCode, crossCompanyGet.body).toBe(404);

    const crossCompanyPost = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/purchases/documents/${operatorDraft.json().document.id}/post`,
      undefined,
      { 'idempotency-key': randomUUID() },
    );
    expect(crossCompanyPost.statusCode, crossCompanyPost.body).toBe(404);

    const secondSupplierResponse = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/parties`,
      {
        code: 'SUP-OTHER',
        nameEn: 'Other Company Supplier',
        type: 'SUPPLIER',
        bin: '1234567890124',
        tin: '123456789013',
        creditDays: 30,
        creditLimit: '0.00',
        isWithholdingBuyer: false,
        isGovernment: false,
      },
    );
    expect(secondSupplierResponse.statusCode, secondSupplierResponse.body).toBe(201);
    const crossCompanySupplier = await createDraft(
      billBody({ partyId: secondSupplierResponse.json().party.id }),
      fixture.accountantCookies,
    );
    expect(crossCompanySupplier.statusCode, crossCompanySupplier.body).toBe(404);

    const periodsResponse = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/periods`,
    );
    expect(periodsResponse.statusCode, periodsResponse.body).toBe(200);
    const december = periodsResponse.json().periods.find((period: { code: string }) => period.code === '2026-12');
    expect(december).toBeTruthy();
    await database.pool.query(`UPDATE periods SET status = 'CLOSED' WHERE company_id = $1 AND id = $2`, [
      fixture.companyId,
      december.id,
    ]);
    const closedDraft = await createDraft(
      billBody({ docDate: '2026-12-10', supplierInvoiceDate: '2026-12-09' }),
      fixture.accountantCookies,
    );
    expect(closedDraft.statusCode, closedDraft.body).toBe(201);
    const closedPost = await postDocument(closedDraft.json().document.id);
    expect(closedPost.statusCode, closedPost.body).toBe(409);
    expect(closedPost.json().code).toBe('PERIOD_NOT_OPEN');
    await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/periods/${december.id}/reopen`,
      {
        reason: 'Reopen after Phase 8 period enforcement test',
      },
    );
  });
});
