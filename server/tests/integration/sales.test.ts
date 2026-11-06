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
    key: 'ar',
    code: '1210',
    nameEn: 'Trade accounts receivable',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'AR',
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
    key: 'bank',
    code: '1010',
    nameEn: 'Bank current account',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'vat',
    code: '2120',
    nameEn: 'Output VAT payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenue',
    code: '4100',
    nameEn: 'Sales revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenueTrading',
    code: '4110',
    nameEn: 'Trading revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
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
    key: 'writeOff',
    code: '5290',
    nameEn: 'Receivable write-off expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
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
  partyId: string;
  itemId: string;
  serviceItemId: string;
  bankAccountId: string;
  taxApproved: boolean;
}

describe.skipIf(!databaseAvailable)('Phase 7 sales, credit notes and receivables', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let fixture: Fixture;
  const documentIds: Record<string, string> = {};
  let invoiceOneSerial = '';
  let creditNoteSerial = '';

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
    const suffix = unique('Sales');
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

    const partyResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'CUST-001',
      nameEn: 'Customer One',
      type: 'CUSTOMER',
      bin: '1234567890123',
      tin: '123456789012',
      creditDays: 30,
      creditLimit: '500000.00',
      isWithholdingBuyer: false,
      isGovernment: false,
    });
    expect(partyResponse.statusCode, partyResponse.body).toBe(201);
    const partyId = partyResponse.json().party.id as string;

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
    const itemId = itemResponse.json().item.id as string;

    const serviceItemResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
      sku: 'SVC-DELIVERY',
      nameEn: 'Delivery service',
      unit: 'job',
      isStockItem: false,
      defaultTaxCategory: 'TRADING_5',
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
        itemId,
        date: '2026-11-01',
        quantity: '100.0000',
        warehouseId,
        unitCost: '100.00',
        offsetAccountId: accounts.capital!.id,
        reason: 'Phase 7 fixture opening stock',
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
      partyId,
      itemId,
      serviceItemId,
      bankAccountId,
      taxApproved: false,
    };
  }

  function invoiceBody(overrides: Record<string, unknown> = {}) {
    return {
      docType: 'SALES_INVOICE',
      partyId: fixture.partyId,
      branchId: fixture.branchId,
      docDate: '2026-11-15',
      dueDate: '2026-12-15',
      paymentTermsDays: 30,
      narrationEn: 'Sales invoice for Customer One',
      attachmentReference: 'PO-2026-001',
      lines: [
        {
          itemId: fixture.itemId,
          descriptionEn: 'Rice 5kg',
          quantity: '2.0000',
          unit: 'kg',
          unitPrice: '100.00',
          discount: '10.00',
          taxCategory: 'STANDARD_15',
          revenueAccountId: fixture.accounts.revenue!.id,
          warehouseId: fixture.warehouseId,
        },
        {
          itemId: fixture.serviceItemId,
          descriptionEn: 'Delivery service',
          quantity: '1.2345',
          unit: 'job',
          unitPrice: '50.00',
          discount: '0.00',
          taxCategory: 'TRADING_5',
          revenueAccountId: fixture.accounts.revenueTrading!.id,
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
    return authedWithHeaders(cookies, 'POST', `/api/v1/companies/${fixture.companyId}/sales/documents`, body, {
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
      `/api/v1/companies/${fixture.companyId}/sales/documents/${documentId}/post`,
      undefined,
      { 'idempotency-key': key },
    );
  }

  async function approveTaxPolicy() {
    const response = await authed(
      app,
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/tax-policy/approval`,
      {
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA, Bangladesh tax practice',
        sourceReference: 'Engagement letter TAX-2026-07 and reviewed pack bd-2026-v1',
        reviewedAt: '2026-11-02',
        outputVatAccountId: fixture.accounts.vat!.id,
        rulePackVersion: 'bd-2026-v1',
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    fixture.taxApproved = true;
  }

  async function createInvoiceAndPost(body: Record<string, unknown>, key = randomUUID()) {
    const draft = await createDraft(body);
    expect(draft.statusCode, draft.body).toBe(201);
    const id = draft.json().document.id as string;
    let posted = await postDocument(id, fixture.accountantCookies, key);
    if (posted.statusCode === 409 && posted.json().code === 'SALES_DOCUMENT_APPROVAL_REQUIRED') {
      const approved = await authed(
        app,
        fixture.controllerCookies,
        'POST',
        `/api/v1/companies/${fixture.companyId}/sales/documents/${id}/approve`,
        { reason: 'Fixture invoice approved for a high-value credit-note test' },
      );
      expect(approved.statusCode, approved.body).toBe(200);
      posted = await postDocument(id, fixture.controllerCookies, key);
    }
    expect(posted.statusCode, posted.body).toBe(200);
    return posted.json().document;
  }

  it('persists a mixed-rate draft and blocks posting until the rule pack is approved', async () => {
    const draft = await createDraft(invoiceBody());
    expect(draft.statusCode, draft.body).toBe(201);
    const document = draft.json().document;
    documentIds.invoiceOne = document.id;
    expect(document.status).toBe('DRAFT');
    expect(document.grossPoisha).toBe('28332');
    expect(document.vatPoisha).toBe('3159');
    expect(document.statutorySerial).toBeNull();
    expect(document.lines[0].taxCategory).toBe('STANDARD_15');
    expect(document.lines[0].vatPoisha).toBe('2850');
    expect(document.lines[1].taxCategory).toBe('TRADING_5');
    expect(document.lines[1].vatPoisha).toBe('309');

    const reloaded = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${document.id}`,
    );
    expect(reloaded.statusCode, reloaded.body).toBe(200);
    expect(reloaded.json().document.grossPoisha).toBe('28332');
    expect(reloaded.json().document.taxPreview.packVersion).toBe('bd-2026-v1');

    const blocked = await postDocument(document.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SALES_TAX_POLICY_NOT_APPROVED');

    const policyBefore = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/tax-policy`,
    );
    expect(policyBefore.json().policy.canPost).toBe(false);
    await approveTaxPolicy();
    const policyAfter = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/tax-policy`,
    );
    expect(policyAfter.json().policy.canPost).toBe(true);
  });

  it('posts the invoice atomically with AR, VAT, COGS, stock and an explainable tax snapshot', async () => {
    const response = await postDocument(documentIds.invoiceOne!, fixture.accountantCookies, 'invoice-one-post-key');
    expect(response.statusCode, response.body).toBe(200);
    const document = response.json().document;
    expect(document.status).toBe('POSTED');
    expect(document.documentNo).toMatch(/^INV-2026-\d{4}$/);
    expect(document.statutorySerial).toMatch(/^M63-2026-\d{4}$/);
    expect(document.statutorySeries).toBe('M63');
    expect(document.journalNumber).toMatch(/^JE-/);
    invoiceOneSerial = document.statutorySerial;

    const journal = await database.pool.query<{
      account_id: string;
      debit_poisha: string;
      credit_poisha: string;
    }>(
      `SELECT l.account_id, l.debit_poisha::text AS debit_poisha, l.credit_poisha::text AS credit_poisha
         FROM journal_lines l
         JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
        WHERE j.company_id = $1 AND j.source_doc_id = $2 AND j.source_module = 'SALES'
        ORDER BY l.line_no`,
      [fixture.companyId, document.id],
    );
    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const row of journal.rows) {
      const entry = totals.get(row.account_id) ?? { debit: 0n, credit: 0n };
      entry.debit += BigInt(row.debit_poisha);
      entry.credit += BigInt(row.credit_poisha);
      totals.set(row.account_id, entry);
    }
    expect(totals.get(fixture.accounts.ar!.id)?.debit).toBe(28_332n);
    expect(totals.get(fixture.accounts.vat!.id)?.credit).toBe(3_159n);
    expect(totals.get(fixture.accounts.cogs!.id)?.debit).toBe(20_000n);
    expect(totals.get(fixture.accounts.inventory!.id)?.credit).toBe(20_000n);

    const stock = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(stock.rows[0]?.quantity).toBe('98.0000');
    expect(stock.rows[0]?.value_poisha).toBe('980000');

    const decision = await database.pool.query<{ decision_state: string; trace_id: string }>(
      `SELECT decision_state, trace_id FROM sales_tax_decisions WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, document.id],
    );
    expect(decision.rows[0]?.decision_state).toBe('SUPPORTED');
    expect(decision.rows[0]?.trace_id).toHaveLength(32);

    await expect(
      database.pool.query(`UPDATE sales_documents SET narration_en = 'tampered' WHERE company_id = $1 AND id = $2`, [
        fixture.companyId,
        document.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.pool.query(
        `UPDATE sales_document_lines SET quantity = 99 WHERE company_id = $1 AND document_id = $2 AND line_no = 1`,
        [fixture.companyId, document.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.pool.query(`DELETE FROM sales_tax_decisions WHERE company_id = $1 AND document_id = $2`, [
        fixture.companyId,
        document.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      database.pool.query(`DELETE FROM sales_documents WHERE company_id = $1 AND id = $2`, [
        fixture.companyId,
        document.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });

    const replaySameKey = await postDocument(
      documentIds.invoiceOne!,
      fixture.accountantCookies,
      'invoice-one-post-key',
    );
    expect(replaySameKey.statusCode, replaySameKey.body).toBe(200);
    expect(replaySameKey.json().replayed).toBe(true);
    const differentKey = await postDocument(documentIds.invoiceOne!, fixture.accountantCookies, 'another-post-key');
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().code).toBe('SALES_DOCUMENT_ALREADY_POSTED');
  });

  it('creates a linked credit note with its own M67 series, restores stock at original cost and rejects over-credit', async () => {
    const invoice = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${documentIds.invoiceOne}`,
    );
    const originalLine = invoice.json().document.lines[0];
    const over = await createDraft({
      docType: 'CREDIT_NOTE',
      partyId: fixture.partyId,
      branchId: fixture.branchId,
      docDate: '2026-11-18',
      creditReason: 'Damaged goods returned',
      originalDocumentId: documentIds.invoiceOne,
      narrationEn: 'Credit note for damaged rice',
      lines: [{ originalLineId: originalLine.id, quantity: '3.0000' }],
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('SALES_CREDIT_QUANTITY_EXCEEDED');

    const credit = await createDraft({
      docType: 'CREDIT_NOTE',
      partyId: fixture.partyId,
      branchId: fixture.branchId,
      docDate: '2026-11-18',
      creditReason: 'Damaged goods returned',
      originalDocumentId: documentIds.invoiceOne,
      narrationEn: 'Credit note for damaged rice',
      lines: [{ originalLineId: originalLine.id, quantity: '1.0000' }],
    });
    expect(credit.statusCode, credit.body).toBe(201);
    const creditDocument = credit.json().document;
    documentIds.creditOne = creditDocument.id;
    expect(creditDocument.grossPoisha).toBe('10925');
    expect(creditDocument.vatPoisha).toBe('1425');
    expect(creditDocument.statutorySerial).toBeNull();

    const posted = await postDocument(creditDocument.id);
    expect(posted.statusCode, posted.body).toBe(200);
    const postedCredit = posted.json().document;
    expect(postedCredit.statutorySeries).toBe('M67');
    expect(postedCredit.statutorySerial).toMatch(/^M67-2026-\d{4}$/);
    expect(postedCredit.documentNo).toMatch(/^CN-2026-\d{4}$/);
    creditNoteSerial = postedCredit.statutorySerial;
    expect(creditNoteSerial).not.toBe(invoiceOneSerial);

    const sequence = await database.pool.query<{ next_value: string }>(
      `SELECT next_value::text AS next_value FROM number_sequences
        WHERE company_id = $1 AND doc_type = 'MUSHAK_63' LIMIT 1`,
      [fixture.companyId],
    );
    expect(sequence.rows[0]?.next_value).toBe('2');

    const stock = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(stock.rows[0]?.quantity).toBe('99.0000');
    expect(stock.rows[0]?.value_poisha).toBe('990000');

    const movements = await database.pool.query<{ movement_type: string; value_poisha: string }>(
      `SELECT movement_type, value_poisha::text AS value_poisha FROM stock_movements
        WHERE company_id = $1 AND source_doc_id = $2 ORDER BY created_at`,
      [fixture.companyId, creditDocument.id],
    );
    expect(movements.rows[0]?.movement_type).toBe('RETURN_IN');
    expect(movements.rows[0]?.value_poisha).toBe('10000');
  });

  it('records partial and multiple receipts, rejects over-allocation and proves AR ageing to the control account', async () => {
    const invoiceTwo = await createInvoiceAndPost(
      invoiceBody({
        narrationEn: 'Service invoice',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Delivery service',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '1000.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    documentIds.invoiceTwo = invoiceTwo.id;
    expect(invoiceTwo.grossPoisha).toBe('115000');

    const overReceipt = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts`,
      {
        receiptDate: '2026-11-20',
        partyId: fixture.partyId,
        bankAccountId: fixture.bankAccountId,
        amount: '100.00',
        allocations: [{ documentId: documentIds.invoiceTwo, amount: '1000.00' }],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(overReceipt.statusCode).toBe(409);
    expect(overReceipt.json().code).toBe('SALES_RECEIPT_OVER_ALLOCATED');

    const firstReceipt = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts`,
      {
        receiptDate: '2026-11-20',
        partyId: fixture.partyId,
        bankAccountId: fixture.bankAccountId,
        amount: '200.00',
        reference: 'DEP-001',
        allocations: [
          { documentId: documentIds.invoiceOne, amount: '100.00' },
          { documentId: documentIds.invoiceTwo, amount: '50.00' },
        ],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(firstReceipt.statusCode, firstReceipt.body).toBe(201);
    expect(firstReceipt.json().receipt.unappliedPoisha).toBe('5000');

    const secondReceipt = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts`,
      {
        receiptDate: '2026-11-21',
        partyId: fixture.partyId,
        bankAccountId: fixture.bankAccountId,
        amount: '100.00',
        allocations: [{ documentId: documentIds.invoiceTwo, amount: '100.00' }],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(secondReceipt.statusCode, secondReceipt.body).toBe(201);
    documentIds.receiptOne = firstReceipt.json().receipt.id;
    documentIds.receiptTwo = secondReceipt.json().receipt.id;

    const allocateUnapplied = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts/${documentIds.receiptOne}/allocations`,
      { allocations: [{ documentId: documentIds.invoiceOne, amount: '20.00' }] },
    );
    expect(allocateUnapplied.statusCode, allocateUnapplied.body).toBe(200);
    expect(allocateUnapplied.json().receipt.unappliedPoisha).toBe('3000');

    const overUnapplied = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts/${documentIds.receiptOne}/allocations`,
      { allocations: [{ documentId: documentIds.invoiceOne, amount: '30.01' }] },
    );
    expect(overUnapplied.statusCode).toBe(409);
    expect(overUnapplied.json().code).toBe('SALES_RECEIPT_UNAPPLIED_EXCEEDED');

    const ageingResponse = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/ar-ageing?asOf=2026-12-31`,
    );
    expect(ageingResponse.statusCode, ageingResponse.body).toBe(200);
    const ageing = ageingResponse.json().ageing;
    expect(ageing.proof.agrees).toBe(true);
    expect(ageing.proof.differencePoisha).toBe('0');
    expect(ageing.proof.subledgerPoisha).toBe(ageing.totals.NET);
    expect(ageing.credits[0].unappliedPoisha).toBe('3000');
    expect(
      ageing.rows.find((row: { documentId: string }) => row.documentId === documentIds.invoiceOne).outstandingPoisha,
    ).toBe('5407');
    expect(
      ageing.rows.find((row: { documentId: string }) => row.documentId === documentIds.invoiceTwo).outstandingPoisha,
    ).toBe('100000');
    expect(ageing.totals.NET).toBe('102407');

    const partyAgeing = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/ar-ageing?asOf=2026-12-31&partyId=${fixture.partyId}`,
    );
    expect(partyAgeing.statusCode, partyAgeing.body).toBe(200);
    expect(partyAgeing.json().ageing.proof.agrees).toBe(true);

    const statement = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/customer-statement?partyId=${fixture.partyId}&from=2026-11-01&to=2026-11-30`,
    );
    expect(statement.statusCode, statement.body).toBe(200);
    const statementBody = statement.json().statement;
    expect(statementBody.openingPoisha).toBe('0');
    expect(statementBody.closingPoisha).toBe('102407');
    expect(statementBody.closingPoisha).toBe(ageing.totals.NET);
    expect(statementBody.lines.some((line: { kind: string }) => line.kind === 'CREDIT_NOTE')).toBe(true);
    expect(statementBody.lines.some((line: { kind: string }) => line.kind === 'RECEIPT')).toBe(true);

    const thirdReceipt = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts`,
      {
        receiptDate: '2026-11-22',
        partyId: fixture.partyId,
        bankAccountId: fixture.bankAccountId,
        amount: '10.00',
        allocations: [{ documentId: documentIds.invoiceTwo, amount: '10.00' }],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(thirdReceipt.statusCode, thirdReceipt.body).toBe(201);
    const thirdReceiptId = thirdReceipt.json().receipt.id as string;
    const openBeforeReversal = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM sales_ar_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentIds.invoiceTwo],
    );
    expect(openBeforeReversal.rows[0]?.outstanding_poisha).toBe('99000');
    const reversedReceipt = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/receipts/${thirdReceiptId}/reverse`,
      { date: '2026-11-23', reason: 'Cash deposit returned by bank' },
    );
    expect(reversedReceipt.statusCode, reversedReceipt.body).toBe(200);
    expect(reversedReceipt.json().receipt.status).toBe('REVERSED');
    const openAfterReversal = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM sales_ar_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, documentIds.invoiceTwo],
    );
    expect(openAfterReversal.rows[0]?.outstanding_poisha).toBe('100000');
    const proofAfterReceiptReversal = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/ar-ageing?asOf=2026-12-31`,
    );
    expect(proofAfterReceiptReversal.json().ageing.proof.agrees).toBe(true);
  });

  it('reverses a posted invoice, restores AR and stock, and refuses a second reversal', async () => {
    const invoiceFour = await createInvoiceAndPost(
      invoiceBody({
        docDate: '2026-11-22',
        dueDate: '2026-12-22',
        narrationEn: 'Invoice to reverse',
        lines: [
          {
            itemId: fixture.itemId,
            descriptionEn: 'Rice 5kg',
            quantity: '3.0000',
            unit: 'kg',
            unitPrice: '100.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: fixture.warehouseId,
          },
        ],
      }),
    );
    documentIds.invoiceFour = invoiceFour.id;
    const before = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(before.rows[0]?.quantity).toBe('96.0000');
    expect(before.rows[0]?.value_poisha).toBe('960000');

    const reversed = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceFour.id}/reverse`,
      { date: '2026-11-23', reason: 'Customer cancelled before delivery' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().document.status).toBe('REVERSED');

    const after = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(after.rows[0]?.quantity).toBe('99.0000');
    expect(after.rows[0]?.value_poisha).toBe('990000');

    const open = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sales_ar_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, invoiceFour.id],
    );
    expect(open.rows[0]?.count).toBe('0');

    const second = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceFour.id}/reverse`,
      { date: '2026-11-24', reason: 'Second attempt' },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SALES_DOCUMENT_ALREADY_REVERSED');

    const blockedInvoice = await authedWithHeaders(
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${documentIds.invoiceOne}/reverse`,
      { date: '2026-11-24', reason: 'Attempt with linked settlement' },
    );
    expect(blockedInvoice.statusCode).toBe(409);
    expect(['SALES_DOCUMENT_HAS_RECEIPTS', 'SALES_DOCUMENT_HAS_CREDIT_NOTES']).toContain(blockedInvoice.json().code);
  });

  it('reverses a posted credit note, restores stock at original cost and reopens AR', async () => {
    const invoice = await createInvoiceAndPost(
      invoiceBody({
        docDate: '2026-11-25',
        dueDate: '2026-12-25',
        narrationEn: 'Stock invoice for credit-note reversal',
        lines: [
          {
            itemId: fixture.itemId,
            descriptionEn: 'Rice 5kg',
            quantity: '1.0000',
            unit: 'kg',
            unitPrice: '100.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: fixture.warehouseId,
          },
        ],
      }),
    );
    documentIds.invoiceSix = invoice.id;
    const detail = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoice.id}`,
    );
    const originalLineId = detail.json().document.lines[0].id as string;
    const credit = await createDraft({
      docType: 'CREDIT_NOTE',
      partyId: fixture.partyId,
      branchId: fixture.branchId,
      docDate: '2026-11-25',
      creditReason: 'Full return for credit-note reversal test',
      originalDocumentId: invoice.id,
      narrationEn: 'Credit note to reverse',
      lines: [{ originalLineId, quantity: '1.0000' }],
    });
    expect(credit.statusCode, credit.body).toBe(201);
    const creditId = credit.json().document.id as string;
    const postedCredit = await postDocument(creditId);
    expect(postedCredit.statusCode, postedCredit.body).toBe(200);
    const afterCredit = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(afterCredit.rows[0]?.quantity).toBe('99.0000');
    expect(afterCredit.rows[0]?.value_poisha).toBe('990000');

    const reversed = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${creditId}/reverse`,
      { date: '2026-11-26', reason: 'Return cancelled before dispatch' },
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(reversed.json().document.status).toBe('REVERSED');
    const afterReversal = await database.pool.query<{ quantity: string; value_poisha: string }>(
      `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
         FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [fixture.companyId, fixture.itemId, fixture.warehouseId],
    );
    expect(afterReversal.rows[0]?.quantity).toBe('98.0000');
    expect(afterReversal.rows[0]?.value_poisha).toBe('980000');
    const open = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text AS outstanding_poisha FROM sales_ar_open_items
        WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, invoice.id],
    );
    expect(open.rows[0]?.outstanding_poisha).toBe('11500');
  });

  it('requires a different controller to approve a high-value credit note', async () => {
    const threshold = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      {
        approvalThresholds: { highValue: '1000.00' },
      },
    );
    expect(threshold.statusCode, threshold.body).toBe(200);

    const invoiceFive = await createInvoiceAndPost(
      invoiceBody({
        docDate: '2026-11-24',
        dueDate: '2026-12-24',
        narrationEn: 'High-value service invoice',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Delivery service',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '2000.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    documentIds.invoiceFive = invoiceFive.id;
    const original = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceFive.id}`,
    );
    const originalLineId = original.json().document.lines[0].id;
    const credit = await createDraft({
      docType: 'CREDIT_NOTE',
      partyId: fixture.partyId,
      branchId: fixture.branchId,
      docDate: '2026-11-25',
      creditReason: 'Service not delivered',
      originalDocumentId: invoiceFive.id,
      narrationEn: 'Full credit for cancelled service',
      lines: [{ originalLineId, quantity: '1.0000' }],
    });
    expect(credit.statusCode, credit.body).toBe(201);
    const creditId = credit.json().document.id;
    documentIds.creditApproval = creditId;

    const blocked = await postDocument(creditId, fixture.accountantCookies);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SALES_CREDIT_NOTE_APPROVAL_REQUIRED');

    const selfApprove = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${creditId}/approve`,
      { reason: 'Self approval attempt' },
    );
    expect(selfApprove.statusCode).toBe(403);

    const approved = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${creditId}/approve`,
      { reason: 'Service not delivered; approved for credit' },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().document.status).toBe('APPROVED');

    const posted = await postDocument(creditId, fixture.controllerCookies);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().document.status).toBe('POSTED');

    const reset = await authed(app, fixture.ownerCookies, 'PATCH', `/api/v1/companies/${fixture.companyId}/settings`, {
      approvalThresholds: { highValue: '0.00' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
  });

  it('requires a different controller to approve a high-value sales invoice', async () => {
    const threshold = await authed(
      app,
      fixture.ownerCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/settings`,
      { approvalThresholds: { highValue: '1000.00' } },
    );
    expect(threshold.statusCode, threshold.body).toBe(200);

    const draft = await createDraft(
      invoiceBody({
        docDate: '2026-11-26',
        dueDate: '2026-12-26',
        narrationEn: 'High-value invoice approval test',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Delivery service',
            quantity: '1.0000',
            unit: 'job',
            unitPrice: '2000.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    expect(draft.statusCode, draft.body).toBe(201);
    const invoiceId = draft.json().document.id as string;
    expect(draft.json().document.approvalRequired).toBe(true);

    const blocked = await postDocument(invoiceId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SALES_DOCUMENT_APPROVAL_REQUIRED');

    const selfApproval = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceId}/approve`,
      { reason: 'Self approval attempt' },
    );
    expect(selfApproval.statusCode).toBe(403);

    const approved = await authed(
      app,
      fixture.controllerCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceId}/approve`,
      { reason: 'High-value invoice reviewed against the customer order' },
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().document.status).toBe('APPROVED');

    const posted = await postDocument(invoiceId);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json().document.status).toBe('POSTED');

    const reset = await authed(app, fixture.ownerCookies, 'PATCH', `/api/v1/companies/${fixture.companyId}/settings`, {
      approvalThresholds: { highValue: '0.00' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
  });

  it('shows live VAT register relevance and excludes reversed documents', async () => {
    const register = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/vat-register?from=2026-11-01&to=2026-11-30`,
    );
    expect(register.statusCode, register.body).toBe(200);
    const body = register.json().register;
    expect(body.label).toContain('not filed');
    const serials = body.rows.map((row: { statutorySerial: string | null }) => row.statutorySerial);
    expect(serials).toContain(invoiceOneSerial);
    expect(serials).toContain(creditNoteSerial);
    expect(body.rows.some((row: { documentId: string }) => row.documentId === documentIds.invoiceFour)).toBe(false);
    const creditRow = body.rows.find((row: { statutorySerial: string }) => row.statutorySerial === creditNoteSerial);
    expect(creditRow.vatPoisha).toBe('-1425');
    expect(body.totals.vatPoisha).toBe(
      body.rows.reduce((sum: bigint, row: { vatPoisha: string }) => sum + BigInt(row.vatPoisha), 0n).toString(),
    );
  });

  it('posts concurrently with one idempotency key without duplicating journals or stock', async () => {
    const draft = await createDraft(
      invoiceBody({
        docDate: '2026-11-26',
        dueDate: '2026-12-26',
        narrationEn: 'Concurrent posting test',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Delivery service',
            quantity: '0.5000',
            unit: 'job',
            unitPrice: '300.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: null,
          },
        ],
      }),
    );
    expect(draft.statusCode, draft.body).toBe(201);
    const id = draft.json().document.id as string;
    const key = `concurrent-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postDocument(id, fixture.accountantCookies, key),
      postDocument(id, fixture.accountantCookies, key),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 200]);
    const replayed = [first.json().replayed, second.json().replayed].filter(Boolean);
    expect(replayed).toHaveLength(1);

    const journals = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journals
        WHERE company_id = $1 AND source_module = 'SALES' AND source_doc_id = $2
          AND reversal_of_journal_id IS NULL`,
      [fixture.companyId, id],
    );
    expect(journals.rows[0]?.count).toBe('1');
  });

  it('enforces permissions, maker-checker, and cross-company isolation', async () => {
    const operatorDraft = await createDraft(
      invoiceBody({
        docDate: '2026-11-27',
        dueDate: '2026-12-27',
        narrationEn: 'Operator draft',
        lines: [
          {
            itemId: fixture.serviceItemId,
            descriptionEn: 'Delivery service',
            quantity: '0.1000',
            unit: 'job',
            unitPrice: '100.00',
            discount: '0.00',
            taxCategory: 'STANDARD_15',
            revenueAccountId: fixture.accounts.revenue!.id,
            warehouseId: null,
          },
        ],
      }),
      fixture.operatorCookies,
    );
    expect(operatorDraft.statusCode, operatorDraft.body).toBe(201);
    const operatorDocumentId = operatorDraft.json().document.id as string;
    const operatorPost = await postDocument(operatorDocumentId, fixture.operatorCookies);
    expect(operatorPost.statusCode).toBe(403);

    const auditorRead = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/sales/documents`,
    );
    expect(auditorRead.statusCode).toBe(200);
    const auditorWrite = await createDraft(invoiceBody(), fixture.auditorCookies);
    expect(auditorWrite.statusCode).toBe(403);
    const auditorReverse = await authedWithHeaders(
      fixture.auditorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/sales/documents/${operatorDocumentId}/reverse`,
      { date: '2026-11-28', reason: 'Not allowed' },
    );
    expect(auditorReverse.statusCode).toBe(403);

    const crossCompany = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/sales/documents`,
    );
    expect(crossCompany.statusCode).toBe(404);

    const crossCompanyCreate = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/sales/documents`,
      invoiceBody(),
      { 'idempotency-key': randomUUID() },
    );
    expect(crossCompanyCreate.statusCode).toBe(404);
    expect(crossCompanyCreate.json().code).toBe('SALES_PARTY_NOT_FOUND');

    const crossCompanyReceipt = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/sales/receipts`,
      {
        receiptDate: '2026-11-28',
        partyId: fixture.partyId,
        bankAccountId: fixture.bankAccountId,
        amount: '10.00',
        allocations: [{ documentId: documentIds.invoiceOne, amount: '10.00' }],
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(crossCompanyReceipt.statusCode).toBe(404);
  });
});
