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
    key: 'ap',
    code: '2000',
    nameEn: 'Trade payables',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'AP',
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
    key: 'cogs',
    code: '5100',
    nameEn: 'Cost of goods sold',
    accountType: 'EXPENSE',
    subCategory: 'COST_OF_SALES',
    controlSubledger: 'NONE',
  },
  {
    key: 'adjustment',
    code: '5200',
    nameEn: 'Stock adjustment expense',
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
  branchId: string;
  warehouseAId: string;
  warehouseBId: string;
  partyId: string;
  supplierId: string;
  itemId: string;
  itemSku: string;
  serviceItemId: string;
}

describe.skipIf(!databaseAvailable)('Phase 6 master data and inventory', () => {
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
        legalName: `${label} Ltd`,
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
      { legalName: `${label} Second Ltd`, ...COMPANY_PROFILE },
    );
    expect(secondCompanyResponse.statusCode, secondCompanyResponse.body).toBe(201);
    const secondCompanyId = secondCompanyResponse.json().company.id as string;

    for (const membershipId of [controllerMembership, accountantMembership, operatorMembership, auditorMembership]) {
      await seedCompanyMembership(database.pool, organisationId, companyId, membershipId);
    }

    const fiscalResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
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

    const warehouseAResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/warehouses`, {
      branchId,
      code: 'MAIN',
      nameEn: 'Main warehouse',
    });
    expect(warehouseAResponse.statusCode, warehouseAResponse.body).toBe(201);
    const warehouseAId = warehouseAResponse.json().warehouse.id as string;

    const warehouseBResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/warehouses`, {
      branchId,
      code: 'SECONDARY',
      nameEn: 'Secondary warehouse',
    });
    expect(warehouseBResponse.statusCode, warehouseBResponse.body).toBe(201);
    const warehouseBId = warehouseBResponse.json().warehouse.id as string;

    const partyResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'CUST-001',
      nameEn: 'Customer One',
      type: 'CUSTOMER',
      bin: '123456789-0101',
      tin: '123456789012',
      creditDays: 30,
      creditLimit: '50000.00',
      isWithholdingBuyer: true,
      isGovernment: false,
    });
    expect(partyResponse.statusCode, partyResponse.body).toBe(201);
    const partyId = partyResponse.json().party.id as string;

    const supplierResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: 'SUP-001',
      nameEn: 'Supplier One',
      type: 'SUPPLIER',
    });
    expect(supplierResponse.statusCode, supplierResponse.body).toBe(201);
    const supplierId = supplierResponse.json().party.id as string;

    const itemResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
      sku: 'RICE-5KG',
      hsCode: '1006.30',
      nameEn: 'Rice 5kg',
      unit: 'kg',
      unitBn: 'কেজি',
      isStockItem: true,
      defaultTaxCategory: 'STANDARD_15',
      inventoryAccountId: accounts.inventory!.id,
      expenseAccountId: accounts.cogs!.id,
    });
    expect(itemResponse.statusCode, itemResponse.body).toBe(201);
    const itemId = itemResponse.json().item.id as string;

    const serviceItemResponse = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
      sku: 'SVC-001',
      nameEn: 'Delivery service',
      unit: 'job',
      isStockItem: false,
      defaultTaxCategory: 'STANDARD_15',
    });
    expect(serviceItemResponse.statusCode, serviceItemResponse.body).toBe(201);

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
      warehouseAId,
      warehouseBId,
      partyId,
      supplierId,
      itemId,
      itemSku: 'RICE-5KG',
      serviceItemId: serviceItemResponse.json().item.id as string,
    };
  }

  async function stockCommand(
    fixture: Fixture,
    body: Record<string, unknown>,
    cookies: AuthCookies,
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/inventory/movements`,
      { date: '2025-01-15', ...body },
      { 'idempotency-key': key },
    );
  }

  async function reverseCommand(
    fixture: Fixture,
    commandId: string,
    cookies: AuthCookies,
    body: Record<string, unknown> = {},
    key: string = randomUUID(),
  ) {
    return authedWithHeaders(
      cookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/inventory/commands/${commandId}/reverse`,
      { date: '2025-01-20', reason: 'Correcting a data-entry error', ...body },
      { 'idempotency-key': key },
    );
  }

  async function balances(fixture: Fixture, cookies: AuthCookies) {
    const response = await authed(
      app,
      cookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/balances?pageSize=100`,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json().balances as any[];
  }

  it('creates, validates, audits and deactivates parties, items and warehouses without deleting them', async () => {
    const fixture = await createFixture('Masters');
    expect(fixture.itemSku).toBe('RICE-5KG');

    const parties = await authed(app, fixture.operatorCookies, 'GET', `/api/v1/companies/${fixture.companyId}/parties`);
    expect(parties.statusCode, parties.body).toBe(200);
    expect(parties.json().total).toBe(2);
    expect(parties.json().parties[0].bin).toBe('1234567890101');
    expect(parties.json().parties[0].tin).toBe('123456789012');

    const duplicateParty = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties`,
      { code: 'cust-001', nameEn: 'Duplicate', type: 'CUSTOMER' },
    );
    expect(duplicateParty.statusCode).toBe(409);
    expect(duplicateParty.json().code).toBe('PARTY_CODE_DUPLICATE');

    const invalidBin = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties`,
      { code: 'CUST-002', nameEn: 'Bad BIN', type: 'CUSTOMER', bin: '1234' },
    );
    expect(invalidBin.statusCode).toBe(400);
    expect(invalidBin.json().code).toBe('PARTY_BIN_INVALID');

    const duplicateSku = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/items`,
      {
        sku: 'rice-5kg',
        nameEn: 'Duplicate rice',
        unit: 'kg',
        isStockItem: true,
        inventoryAccountId: fixture.accounts.inventory!.id,
        expenseAccountId: fixture.accounts.cogs!.id,
      },
    );
    expect(duplicateSku.statusCode).toBe(409);
    expect(duplicateSku.json().code).toBe('ITEM_SKU_DUPLICATE');

    const wrongInventoryAccount = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/items`,
      {
        sku: 'WRONG-ACCOUNT',
        nameEn: 'Wrong account item',
        unit: 'pcs',
        isStockItem: true,
        inventoryAccountId: fixture.accounts.cogs!.id,
        expenseAccountId: fixture.accounts.cogs!.id,
      },
    );
    expect(wrongInventoryAccount.statusCode).toBe(400);
    expect(wrongInventoryAccount.json().code).toBe('ITEM_INVENTORY_ACCOUNT_TYPE');

    const operatorCreate = await authed(
      app,
      fixture.operatorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties`,
      { code: 'NOPE', nameEn: 'Not allowed', type: 'CUSTOMER' },
    );
    expect(operatorCreate.statusCode).toBe(403);
    expect(operatorCreate.json().code).toBe('FORBIDDEN');

    const auditorCreate = await authed(
      app,
      fixture.auditorCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/items`,
      { sku: 'NOPE', nameEn: 'Not allowed', unit: 'pcs', isStockItem: false },
    );
    expect(auditorCreate.statusCode).toBe(403);

    const openingItem = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties/${fixture.partyId}/opening-items`,
      {
        documentType: 'SALES_INVOICE',
        documentNo: 'OPEN-INV-001',
        dueDate: '2025-02-01',
        amount: '1000.00',
        base: '1000.00',
      },
    );
    expect(openingItem.statusCode, openingItem.body).toBe(201);
    const openingItemId = openingItem.json().item.id as string;
    expect(openingItem.json().item.amountPoisha).toBe('100000');

    const partyWithOpenItem = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties/${fixture.partyId}/deactivate`,
      { reason: 'No longer trading' },
    );
    expect(partyWithOpenItem.statusCode).toBe(409);
    expect(partyWithOpenItem.json().code).toBe('PARTY_HAS_OPEN_ITEMS');

    const cancelOpening = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties/${fixture.partyId}/opening-items/${openingItemId}/cancel`,
      { reason: 'Duplicate schedule' },
    );
    expect(cancelOpening.statusCode, cancelOpening.body).toBe(200);
    expect(cancelOpening.json().item.status).toBe('CANCELLED');

    const deactivateParty = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties/${fixture.partyId}/deactivate`,
      { reason: 'Customer account closed' },
    );
    expect(deactivateParty.statusCode, deactivateParty.body).toBe(200);
    expect(deactivateParty.json().party.status).toBe('INACTIVE');

    const reactivateParty = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/parties/${fixture.partyId}/reactivate`,
      { reason: 'Customer reinstated' },
    );
    expect(reactivateParty.statusCode, reactivateParty.body).toBe(200);
    expect(reactivateParty.json().party.status).toBe('ACTIVE');

    const deactivateItem = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/items/${fixture.serviceItemId}/deactivate`,
      { reason: 'Service retired' },
    );
    expect(deactivateItem.statusCode, deactivateItem.body).toBe(200);
    expect(deactivateItem.json().item.status).toBe('INACTIVE');

    const auditorList = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/warehouses`,
    );
    expect(auditorList.statusCode, auditorList.body).toBe(200);
    expect(auditorList.json().warehouses).toHaveLength(2);

    const audit = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE company_id = $1 ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'branch.created',
        'warehouse.created',
        'party.created',
        'party_opening_item.created',
        'party_opening_item.cancelled',
        'party.deactivated',
        'party.reactivated',
        'item.deactivated',
      ]),
    );
  });

  it('values opening stock, weighted-average receipts, issues, returns and transfers exactly', async () => {
    const fixture = await createFixture('Valuation');

    const opening = await stockCommand(
      fixture,
      {
        type: 'OPENING',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '10',
        unitCost: '100.00',
        offsetAccountId: fixture.accounts.capital!.id,
      },
      fixture.accountantCookies,
      'opening-1',
    );
    expect(opening.statusCode, opening.body).toBe(201);
    expect(opening.json().movements[0].valuePoisha).toBe('100000');

    const grn = await stockCommand(
      fixture,
      {
        type: 'GRN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '10',
        unitCost: '120.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      fixture.accountantCookies,
      'grn-1',
    );
    expect(grn.statusCode, grn.body).toBe(201);

    let rows = await balances(fixture, fixture.auditorCookies);
    let main = rows.find((row) => row.warehouseId === fixture.warehouseAId);
    expect(main.quantity).toBe('20.0000');
    expect(main.valuePoisha).toBe('220000');
    expect(main.weightedUnitCostBdt).toBe('110.00');

    const issue = await stockCommand(
      fixture,
      { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '5' },
      fixture.accountantCookies,
      'issue-1',
    );
    expect(issue.statusCode, issue.body).toBe(201);
    const issueCommandId = issue.json().commandId as string;
    expect(issue.json().movements[0].valuePoisha).toBe('55000');
    expect(issue.json().movements[0].journalNumber).toMatch(/^JE-/);

    const replay = await stockCommand(
      fixture,
      { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '5' },
      fixture.accountantCookies,
      'issue-1',
    );
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().commandId).toBe(issueCommandId);

    const returned = await stockCommand(
      fixture,
      { type: 'RETURN', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '2' },
      fixture.accountantCookies,
      'return-1',
    );
    expect(returned.statusCode, returned.body).toBe(201);
    expect(returned.json().movements[0].valuePoisha).toBe('22000');

    const transfer = await stockCommand(
      fixture,
      {
        type: 'TRANSFER',
        itemId: fixture.itemId,
        fromWarehouseId: fixture.warehouseAId,
        toWarehouseId: fixture.warehouseBId,
        quantity: '3',
      },
      fixture.accountantCookies,
      'transfer-1',
    );
    expect(transfer.statusCode, transfer.body).toBe(201);
    expect(transfer.json().movements).toHaveLength(2);
    expect(transfer.json().movements[0].valuePoisha).toBe('33000');
    expect(transfer.json().movements[1].valuePoisha).toBe('33000');

    rows = await balances(fixture, fixture.auditorCookies);
    main = rows.find((row) => row.warehouseId === fixture.warehouseAId);
    const secondary = rows.find((row) => row.warehouseId === fixture.warehouseBId);
    expect(main.quantity).toBe('14.0000');
    expect(main.valuePoisha).toBe('154000');
    expect(secondary.quantity).toBe('3.0000');
    expect(secondary.valuePoisha).toBe('33000');

    const decimalReceipt = await stockCommand(
      fixture,
      {
        type: 'ADJUSTMENT_IN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '1.2345',
        unitCost: '10.00',
        offsetAccountId: fixture.accounts.adjustment!.id,
        reason: 'Counted fractional stock',
      },
      fixture.accountantCookies,
      'decimal-1',
    );
    expect(decimalReceipt.statusCode, decimalReceipt.body).toBe(201);
    expect(decimalReceipt.json().movements[0].quantity).toBe('1.2345');
    expect(decimalReceipt.json().movements[0].valuePoisha).toBe('1235');

    const insufficient = await stockCommand(
      fixture,
      { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '1000' },
      fixture.accountantCookies,
      'insufficient-1',
    );
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json().code).toBe('STOCK_INSUFFICIENT');
    expect(insufficient.json().details.availableQuantity).toBe('15.2345');

    const movements = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/movements?pageSize=100`,
    );
    expect(movements.statusCode, movements.body).toBe(200);
    const issueMovements = movements.json().movements.filter((m: any) => m.commandId === issueCommandId);
    expect(issueMovements).toHaveLength(1);

    const itemWithStock = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/items/${fixture.itemId}/deactivate`,
      { reason: 'Trying to retire an item that still has stock' },
    );
    expect(itemWithStock.statusCode).toBe(409);
    expect(itemWithStock.json().code).toBe('ITEM_HAS_STOCK');

    const unitChange = await authed(
      app,
      fixture.accountantCookies,
      'PATCH',
      `/api/v1/companies/${fixture.companyId}/items/${fixture.itemId}`,
      {
        sku: fixture.itemSku,
        nameEn: 'Rice 5kg',
        unit: 'pcs',
        isStockItem: true,
        defaultTaxCategory: 'STANDARD_15',
        inventoryAccountId: fixture.accounts.inventory!.id,
        expenseAccountId: fixture.accounts.cogs!.id,
      },
    );
    expect(unitChange.statusCode).toBe(409);
    expect(unitChange.json().code).toBe('ITEM_UNIT_LOCKED');

    const warehouseWithStock = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/warehouses/${fixture.warehouseAId}/deactivate`,
      { reason: 'Trying to retire a warehouse that still has stock' },
    );
    expect(warehouseWithStock.statusCode).toBe(409);
    expect(warehouseWithStock.json().code).toBe('WAREHOUSE_HAS_STOCK');

    const concurrentKey = 'concurrent-issue-1';
    const [firstConcurrent, secondConcurrent] = await Promise.all([
      stockCommand(
        fixture,
        { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '0.5' },
        fixture.accountantCookies,
        concurrentKey,
      ),
      stockCommand(
        fixture,
        { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '0.5' },
        fixture.accountantCookies,
        concurrentKey,
      ),
    ]);
    expect([firstConcurrent.statusCode, secondConcurrent.statusCode].sort()).toEqual([200, 201]);
    expect(firstConcurrent.json().commandId).toBe(secondConcurrent.json().commandId);
    expect([firstConcurrent.json().replayed, secondConcurrent.json().replayed].sort()).toEqual([false, true]);
  });

  it('blocks negative stock by default and permits only a controller override with a reason', async () => {
    const fixture = await createFixture('Override');
    const receipt = await stockCommand(
      fixture,
      {
        type: 'GRN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '5',
        unitCost: '100.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      fixture.accountantCookies,
      'override-grn',
    );
    expect(receipt.statusCode, receipt.body).toBe(201);

    const blocked = await stockCommand(
      fixture,
      { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '6' },
      fixture.accountantCookies,
      'override-blocked',
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('STOCK_INSUFFICIENT');

    const noPermission = await stockCommand(
      fixture,
      {
        type: 'ISSUE',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '6',
        allowNegativeStock: true,
        overrideReason: 'Customer already dispatched',
      },
      fixture.accountantCookies,
      'override-no-permission',
    );
    expect(noPermission.statusCode).toBe(403);
    expect(noPermission.json().code).toBe('NEGATIVE_STOCK_OVERRIDE_FORBIDDEN');

    const noReason = await stockCommand(
      fixture,
      {
        type: 'ISSUE',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '6',
        allowNegativeStock: true,
      },
      fixture.controllerCookies,
      'override-no-reason',
    );
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe('NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED');

    const override = await stockCommand(
      fixture,
      {
        type: 'ISSUE',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '6',
        allowNegativeStock: true,
        overrideReason: 'Customer already dispatched; GRN will be matched tomorrow',
      },
      fixture.controllerCookies,
      'override-ok',
    );
    expect(override.statusCode, override.body).toBe(201);
    expect(override.json().movements[0].negativeStockOverride).toBe(true);
    expect(override.json().movements[0].balanceAfterQuantity).toBe('-1.0000');
    expect(override.json().movements[0].overrideReason).toBeTruthy();

    const rows = await balances(fixture, fixture.auditorCookies);
    const main = rows.find((row) => row.warehouseId === fixture.warehouseAId);
    expect(main.quantity).toBe('-1.0000');
    expect(main.valuePoisha).toBe('-10000');

    const proofResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/control-proof?asOf=2025-12-31`,
    );
    expect(proofResponse.statusCode, proofResponse.body).toBe(200);
    const proof = proofResponse.json().proof;
    const inventoryAccount = proof.accounts.find(
      (account: any) => account.accountId === fixture.accounts.inventory!.id,
    );
    expect(inventoryAccount.stockValuePoisha).toBe('-10000');
    expect(inventoryAccount.glBalancePoisha).toBe('-10000');
    expect(inventoryAccount.differencePoisha).toBe('0');
  });

  it('proves inventory valuation to the GL, shows differences, and reverses stock and journal once', async () => {
    const fixture = await createFixture('Proof');

    const receipt = await stockCommand(
      fixture,
      {
        type: 'OPENING',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '10',
        unitCost: '50.00',
        offsetAccountId: fixture.accounts.capital!.id,
      },
      fixture.accountantCookies,
      'proof-opening',
    );
    expect(receipt.statusCode, receipt.body).toBe(201);

    const issue = await stockCommand(
      fixture,
      { type: 'ISSUE', itemId: fixture.itemId, warehouseId: fixture.warehouseAId, quantity: '4' },
      fixture.accountantCookies,
      'proof-issue',
    );
    expect(issue.statusCode, issue.body).toBe(201);
    const issueCommandId = issue.json().commandId as string;

    let proofResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/control-proof?asOf=2025-12-31`,
    );
    expect(proofResponse.statusCode, proofResponse.body).toBe(200);
    let proof = proofResponse.json().proof;
    const inventoryAccount = proof.accounts.find(
      (account: any) => account.accountId === fixture.accounts.inventory!.id,
    );
    expect(inventoryAccount.stockValuePoisha).toBe('30000');
    expect(inventoryAccount.glBalancePoisha).toBe('30000');
    expect(inventoryAccount.differencePoisha).toBe('0');
    expect(proof.differences).toEqual([]);

    const draftResponse = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals`,
      {
        date: '2025-01-16',
        narration: 'Manual inventory adjustment outside the stock service',
        lines: [
          { accountId: fixture.accounts.inventory!.id, debit: '500.00', credit: '0' },
          { accountId: fixture.accounts.capital!.id, debit: '0', credit: '500.00' },
        ],
      },
    );
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const journalId = draftResponse.json().journal.id as string;
    const submit = await authed(
      app,
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/submit`,
    );
    expect(submit.statusCode, submit.body).toBe(200);
    const post = await authedWithHeaders(
      fixture.accountantCookies,
      'POST',
      `/api/v1/companies/${fixture.companyId}/journals/${journalId}/post`,
      undefined,
      { 'idempotency-key': 'manual-inventory-proof' },
    );
    expect(post.statusCode, post.body).toBe(200);

    proofResponse = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/control-proof?asOf=2025-12-31`,
    );
    proof = proofResponse.json().proof;
    const differed = proof.accounts.find((account: any) => account.accountId === fixture.accounts.inventory!.id);
    expect(differed.stockValuePoisha).toBe('30000');
    expect(differed.glBalancePoisha).toBe('80000');
    expect(differed.differencePoisha).toBe('-50000');
    expect(proof.differences).toHaveLength(1);
    expect(proof.differences[0].accountId).toBe(fixture.accounts.inventory!.id);

    const reverse = await reverseCommand(fixture, issueCommandId, fixture.accountantCookies, {}, 'reverse-issue-1');
    expect(reverse.statusCode, reverse.body).toBe(201);
    expect(reverse.json().movements).toHaveLength(1);
    expect(reverse.json().movements[0].movementType).toBe('REVERSAL_IN');
    expect(reverse.json().movements[0].reversalOfMovementId).toBe(issue.json().movements[0].id);
    expect(reverse.json().movements[0].journalId).toBeTruthy();

    const secondReverse = await reverseCommand(
      fixture,
      issueCommandId,
      fixture.accountantCookies,
      {},
      'reverse-issue-2',
    );
    expect(secondReverse.statusCode).toBe(409);
    expect(secondReverse.json().code).toBe('STOCK_ALREADY_REVERSED');

    const reversalCommandId = reverse.json().commandId as string;
    const reverseOfReversal = await reverseCommand(
      fixture,
      reversalCommandId,
      fixture.accountantCookies,
      {},
      'reverse-issue-3',
    );
    expect(reverseOfReversal.statusCode).toBe(409);
    expect(reverseOfReversal.json().code).toBe('REVERSAL_OF_REVERSAL');

    const journal = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/journals/${issue.json().movements[0].journalId}`,
    );
    expect(journal.statusCode, journal.body).toBe(200);
    expect(journal.json().journal.status).toBe('REVERSED');
    expect(journal.json().journal.reversedByJournalId).toBe(reverse.json().movements[0].journalId);

    const rows = await balances(fixture, fixture.auditorCookies);
    const main = rows.find((row) => row.warehouseId === fixture.warehouseAId);
    expect(main.quantity).toBe('10.0000');
    expect(main.valuePoisha).toBe('50000');

    const ledger = await authed(
      app,
      fixture.auditorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/movements?pageSize=100`,
    );
    expect(ledger.statusCode, ledger.body).toBe(200);
    const originalIssue = (ledger.json().movements as any[]).find(
      (movement) => movement.id === issue.json().movements[0].id,
    );
    expect(originalIssue.isReversed).toBe(true);
  });

  it('prevents cross-company master and stock access and blocks stock by read-only roles', async () => {
    const fixture = await createFixture('Isolation');

    const crossCompanyParty = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/parties/${fixture.partyId}`,
    );
    expect(crossCompanyParty.statusCode).toBe(404);
    expect(crossCompanyParty.json().code).toBe('PARTY_NOT_FOUND');

    const crossCompanyItem = await authed(
      app,
      fixture.ownerCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/items/${fixture.itemId}`,
    );
    expect(crossCompanyItem.statusCode).toBe(404);
    expect(crossCompanyItem.json().code).toBe('ITEM_NOT_FOUND');

    const scopedAccountant = await authed(
      app,
      fixture.accountantCookies,
      'GET',
      `/api/v1/companies/${fixture.secondCompanyId}/parties`,
    );
    expect(scopedAccountant.statusCode).toBe(404);
    expect(scopedAccountant.json().code).toBe('COMPANY_NOT_FOUND');

    const crossCompanyStock = await stockCommand(
      fixture,
      {
        type: 'GRN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '1',
        unitCost: '10.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      fixture.ownerCookies,
      'cross-company-stock',
    );
    // The request targets the second company, so the item from the first company is invisible.
    const crossResponse = await authedWithHeaders(
      fixture.ownerCookies,
      'POST',
      `/api/v1/companies/${fixture.secondCompanyId}/inventory/movements`,
      {
        type: 'GRN',
        date: '2025-01-15',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '1',
        unitCost: '10.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      { 'idempotency-key': 'cross-company-stock-2' },
    );
    expect(crossResponse.statusCode).toBe(404);
    expect(crossResponse.json().code).toBe('ITEM_NOT_FOUND');
    expect(crossCompanyStock.statusCode).toBe(201);

    const auditorStock = await stockCommand(
      fixture,
      {
        type: 'GRN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '1',
        unitCost: '10.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      fixture.auditorCookies,
      'auditor-stock',
    );
    expect(auditorStock.statusCode).toBe(403);
    expect(auditorStock.json().code).toBe('FORBIDDEN');

    const operatorStock = await stockCommand(
      fixture,
      {
        type: 'GRN',
        itemId: fixture.itemId,
        warehouseId: fixture.warehouseAId,
        quantity: '1',
        unitCost: '10.00',
        offsetAccountId: fixture.accounts.ap!.id,
      },
      fixture.operatorCookies,
      'operator-stock',
    );
    expect(operatorStock.statusCode).toBe(201);

    const operatorViewProof = await authed(
      app,
      fixture.operatorCookies,
      'GET',
      `/api/v1/companies/${fixture.companyId}/inventory/control-proof`,
    );
    expect(operatorViewProof.statusCode).toBe(403);
  });
});
