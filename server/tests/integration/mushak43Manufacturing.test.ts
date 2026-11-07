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
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';
import {
  calculateAbnormalWastageClawback,
  calculateGrossQuantityScaled,
  calculateIngredientCostPoisha,
  isAbnormalWastage,
  ABNORMAL_WASTAGE_THRESHOLD_BPS,
  MUSHAK_9_1_NOTE_27_CITATION,
} from '../../src/inventory/mushak43Service.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'MANUFACTURING_RMG',
  tin: '123456789012',
  bin: '123456789-0101',
  rjscNo: 'C-88776/2026',
  address: 'Plot 12, Sector 3, Uttara, Dhaka 1230',
  phone: '+8801700000000',
  email: 'factory@example.test',
  reportingFramework: 'IFRS_FRC_ADOPTED',
};

describe('Phase 20: Manufacturing BOM, Mushak 4.3 Engine & IAS 2 WIP/FG Costing', () => {
  describe('Rule 21 & Section 46(3) Pure Integer Arithmetic Specifications', () => {
    it('calculates gross quantity scaled with wastage percentage basis points (10000n scale)', () => {
      // 1.2000 net quantity (12000n scaled) with 5.00% normal wastage (500 bps)
      // wastage = floor((12000 * 500) / 10000) = 600n (0.0600)
      // gross = 12000n + 600n = 12600n (1.2600)
      const netScaled = 12_000n;
      const wastageBps = 500;
      const grossScaled = calculateGrossQuantityScaled(netScaled, wastageBps);
      expect(grossScaled).toBe(12_600n);
    });

    it('calculates ingredient cost in integer poisha without floating point math', () => {
      // gross quantity: 1.2600 (12600n scaled)
      // rate per unit: 500.00 BDT = 50,000 poisha
      // cost = floor((12600 * 50000) / 10000) = 63,000 poisha (630.00 BDT)
      const grossScaled = 12_600n;
      const ratePoisha = 50_000n;
      const costPoisha = calculateIngredientCostPoisha(grossScaled, ratePoisha);
      expect(costPoisha).toBe(63_000n);
    });

    it('enforces Section 46(3) abnormal wastage threshold (10.00% / 1000 bps)', () => {
      // <= 10.00% is normal
      expect(isAbnormalWastage(0)).toBe(false);
      expect(isAbnormalWastage(500)).toBe(false); // 5.00%
      expect(isAbnormalWastage(1000)).toBe(false); // 10.00%

      // > 10.00% is abnormal
      expect(isAbnormalWastage(1001)).toBe(true); // 10.01%
      expect(isAbnormalWastage(1250)).toBe(true); // 12.50%
      expect(isAbnormalWastage(1500)).toBe(true); // 15.00%
    });

    it('calculates statutory Input VAT rebate clawback under Section 46(3) for Mushak 9.1 Part 5 Note 27', () => {
      // Net quantity: 8.0000 units (80000n scaled)
      // Wastage: 12.50% (1250 bps) -> 2.50% abnormal (250 bps)
      // Rate: 100.00 BDT (10,000 poisha)
      // Abnormal quantity = floor((80000 * 250) / 10000) = 2000n (0.2000 units)
      // Abnormal cost = floor((2000 * 10000) / 10000) = 2,000 poisha (20.00 BDT)
      // Input VAT clawback @ 15% = floor((2000 * 1500) / 10000) = 300 poisha (3.00 BDT)
      const clawback = calculateAbnormalWastageClawback(80_000n, 1250, 10_000n, true);
      expect(clawback.isAbnormal).toBe(true);
      expect(clawback.abnormalBps).toBe(250);
      expect(clawback.abnormalQuantityScaled).toBe(2_000n);
      expect(clawback.abnormalCostPoisha).toBe(2_000n);
      expect(clawback.vatClawbackPoisha).toBe(300n);

      // When wastage is within normal 10% limit (e.g. 8.00% = 800 bps)
      const normal = calculateAbnormalWastageClawback(80_000n, 800, 10_000n, true);
      expect(normal.isAbnormal).toBe(false);
      expect(normal.vatClawbackPoisha).toBe(0n);
    });
  });

  describe.skipIf(!databaseAvailable)('PostgreSQL Integration: Mushak 4.3 & Production Batch GL Engine', () => {
    let database: TestDatabase;
    let app: AppInstance;
    let organisationId: string;
    let companyId: string;
    let ownerCookies: AuthCookies;
    let warehouseId: string;
    let rawItem1Id: string; // Fabric (normal wastage)
    let rawItem2Id: string; // Buttons (abnormal wastage)
    let finishedItemId: string; // Cotton Shirt
    let declarationId: string;

    beforeAll(async () => {
      database = await createTestDatabase();
      await migrateUp({ pool: database.pool, nodeEnv: 'test' });
      const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
      app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });

      // 1. Seed tenant identity
      const suffix = randomUUID().slice(0, 8);
      organisationId = await seedOrganisation(database.pool, `Mfg Org ${suffix}`);
      const ownerEmail = `mfg-owner-${suffix}@example.test`;
      const ownerId = await seedUser(database.pool, { email: ownerEmail, name: `Mfg Admin ${suffix}` });
      await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
      ownerCookies = (await login(app, ownerEmail)).cookies;

      // 2. Create manufacturing company
      const companyRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/organisations/${organisationId}/companies`,
        { legalName: `Bengal Garments Ltd ${suffix}`, tradeName: `Bengal Garments ${suffix}`, ...COMPANY_PROFILE },
      );
      expect(companyRes.statusCode).toBe(201);
      companyId = companyRes.json().company.id as string;

      // 3. Create fiscal year (2026-07-01 to 2027-06-30)
      const fyRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
        startDate: '2026-07-01',
        endDate: '2027-06-30',
      });
      expect(fyRes.statusCode).toBe(201);

      // 4. Create standard accounts
      const accountsToSeed = [
        { code: '1010', nameEn: 'Bank Current Account', accountType: 'ASSET', subCategory: 'CURRENT_ASSET', controlSubledger: 'BANK_MFS' },
        { code: '1310', nameEn: 'Raw Materials Inventory', accountType: 'ASSET', subCategory: 'CURRENT_ASSET', controlSubledger: 'INVENTORY' },
        { code: '1320', nameEn: 'Finished Goods Inventory', accountType: 'ASSET', subCategory: 'CURRENT_ASSET', controlSubledger: 'INVENTORY' },
        { code: '5100', nameEn: 'Cost of Goods Sold', accountType: 'EXPENSE', subCategory: 'COST_OF_SALES', controlSubledger: 'NONE' },
        { code: '5210', nameEn: 'Direct Labor & Overhead Absorbed', accountType: 'EXPENSE', subCategory: 'COST_OF_SALES', controlSubledger: 'NONE' },
      ];
      for (const acc of accountsToSeed) {
        await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/accounts`, acc);
      }

      // 5. Create warehouse
      const whRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/warehouses`, {
        code: 'WH-MAIN',
        nameEn: 'Main Factory Warehouse',
      });
      expect(whRes.statusCode).toBe(201);
      warehouseId = whRes.json().warehouse.id as string;

      // Fetch created accounts for item linkage
      const accsPreRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/accounts`);
      const rmAccount = accsPreRes.json().accounts.find((a: any) => a.code === '1310');
      const fgAccount = accsPreRes.json().accounts.find((a: any) => a.code === '1320');
      const cogsAccount = accsPreRes.json().accounts.find((a: any) => a.code === '5100');

      // 6. Create master items
      const raw1Res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
        sku: 'RM-FABRIC-01',
        nameEn: 'Cotton Yarn Fabric',
        unit: 'Mtr',
        unitBn: 'মিটার',
        isStockItem: true,
        defaultTaxCategory: 'STANDARD_15',
        inventoryAccountId: rmAccount.id,
        expenseAccountId: cogsAccount.id,
      });
      expect(raw1Res.statusCode).toBe(201);
      rawItem1Id = raw1Res.json().item.id as string;

      const raw2Res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
        sku: 'RM-BUTTON-01',
        nameEn: 'Plastic Buttons',
        unit: 'Pcs',
        unitBn: 'পিস',
        isStockItem: true,
        defaultTaxCategory: 'STANDARD_15',
        inventoryAccountId: rmAccount.id,
        expenseAccountId: cogsAccount.id,
      });
      expect(raw2Res.statusCode).toBe(201);
      rawItem2Id = raw2Res.json().item.id as string;

      const fgRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/items`, {
        sku: 'FG-SHIRT-01',
        nameEn: 'Men Cotton Shirt Full Sleeve',
        unit: 'Pcs',
        unitBn: 'পিস',
        isStockItem: true,
        defaultTaxCategory: 'STANDARD_15',
        inventoryAccountId: fgAccount.id,
        expenseAccountId: cogsAccount.id,
      });
      expect(fgRes.statusCode).toBe(201);
      finishedItemId = fgRes.json().item.id as string;

      // 7. Seed Opening Stock for Raw Materials via stock commands
      // Load 1010 Bank Account as offset
      const accsRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/accounts`);
      const bankAcc = accsRes.json().accounts.find((a: any) => a.code === '1010');

      // Seed 1,000 Mtr Fabric @ 500.00 BDT
      const open1Res = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/movements`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': `open-fab-${suffix}` },
        payload: {
          type: 'OPENING',
          itemId: rawItem1Id,
          warehouseId,
          date: '2026-07-01',
          quantity: '1000.0000',
          unitCost: '500.00',
          offsetAccountId: bankAcc.id,
        },
      });
      expect(open1Res.statusCode).toBe(201);

      // Seed 5,000 Pcs Buttons @ 5.00 BDT
      const open2Res = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/movements`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': `open-btn-${suffix}` },
        payload: {
          type: 'OPENING',
          itemId: rawItem2Id,
          warehouseId,
          date: '2026-07-01',
          quantity: '5000.0000',
          unitCost: '5.00',
          offsetAccountId: bankAcc.id,
        },
      });
      expect(open2Res.statusCode).toBe(201);
    });

    afterAll(async () => {
      if (app) await app.close();
      if (database) await database.cleanup();
    });

    it('creates a Mushak 4.3 declaration and calculates BOM coefficients with abnormal wastage flag', async () => {
      // Declaration: 1 Cotton Shirt (FG-SHIRT-01)
      // Ingredients:
      // Fabric: Net 1.2000 Mtr, Wastage 5.00% (500 bps, normal), Rate 500.00 BDT (50000 poisha)
      // Gross = 1.2600 Mtr, Cost = 630.00 BDT (63000 poisha)
      // Buttons: Net 8.0000 Pcs, Wastage 12.50% (1250 bps, abnormal > 10%), Rate 5.00 BDT (500 poisha)
      // Gross = 9.0000 Pcs, Cost = 45.00 BDT (4500 poisha)
      // Total RM Cost = 675.00 BDT (67500 poisha)
      // Direct Labor = 150.00 BDT (15000 poisha)
      // Overhead = 100.00 BDT (10000 poisha)
      // Packaging = 25.00 BDT (2500 poisha)
      // Total Cost of Production = 675 + 150 + 100 + 25 = 950.00 BDT (95000 poisha)
      // Target Profit = 20.00% (2000 bps) -> Profit = 190.00 BDT
      // Declared Price = 950 + 190 = 1,140.00 BDT (114000 poisha)
      const res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/inventory/mushak-43`, {
        finishedItemId,
        outputQuantity: '1.0000',
        outputUnit: 'Pcs',
        effectiveFrom: '2026-07-01',
        nbrDivisionOffice: 'Customs, Excise & VAT Commissionerate, Dhaka North',
        directLaborCostPoisha: '15000',
        manufacturingOverheadPoisha: '10000',
        packagingCostPoisha: '2500',
        targetProfitMarginBps: 2000,
        ingredients: [
          {
            rawItemId: rawItem1Id,
            netQuantity: '1.2000',
            wastageBps: 500,
            unit: 'Mtr',
            ratePerUnitPoisha: '50000',
            rebatableInputVat: true,
          },
          {
            rawItemId: rawItem2Id,
            netQuantity: '8.0000',
            wastageBps: 1250, // 12.50% -> abnormal
            unit: 'Pcs',
            ratePerUnitPoisha: '500',
            rebatableInputVat: true,
          },
        ],
      });

      expect(res.statusCode, res.body).toBe(201);
      const decl = res.json().declaration;
      declarationId = decl.id;

      expect(decl.finishedItemId).toBe(finishedItemId);
      expect(decl.totalRawMaterialCostPoisha).toBe('67500');
      expect(decl.totalCostOfProductionPoisha).toBe('95000');
      expect(decl.declaredRetailPricePoisha).toBe('114000');
      expect(decl.hasAbnormalWastage).toBe(true);

      const fabricIng = decl.ingredients.find((i: any) => i.rawItemId === rawItem1Id);
      expect(fabricIng.grossQuantity).toBe('1.2600');
      expect(fabricIng.totalCostPoisha).toBe('63000');
      expect(fabricIng.isAbnormalWastage).toBe(false);

      const buttonIng = decl.ingredients.find((i: any) => i.rawItemId === rawItem2Id);
      expect(buttonIng.grossQuantity).toBe('9.0000');
      expect(buttonIng.totalCostPoisha).toBe('4500');
      expect(buttonIng.isAbnormalWastage).toBe(true);
    });

    it('submits and approves the Mushak 4.3 declaration for NBR compliance', async () => {
      const res = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/inventory/mushak-43/${declarationId}/submit-nbr`,
        {
          approveImmediately: true,
          nbrSubmissionDate: '2026-07-01',
        },
      );

      expect(res.statusCode).toBe(200);
      const decl = res.json().declaration;
      expect(decl.status).toBe('APPROVED');
      expect(decl.nbrSubmissionDate).toBe('2026-07-01');
    });

    it('executes a production batch: atomically deducts RM stock, increments FG stock, and posts balanced GL journal', async () => {
      // Execute batch for 50 Pcs Shirts
      // Expected consumptions:
      // Fabric: 50 * 1.26 = 63.0000 Mtr consumed (Cost: 50 * 630 = 31,500.00 BDT = 3,150,000 poisha)
      // Buttons: 50 * 9.00 = 450.0000 Pcs consumed (Cost: 50 * 45 = 2,250.00 BDT = 225,000 poisha)
      // Total RM Cost = 3,375,000 poisha (33,750.00 BDT)
      // Direct Labor = 50 * 150 = 7,500.00 BDT (750,000 poisha)
      // Mfg Overhead = 50 * 100 = 5,000.00 BDT (500,000 poisha)
      // Packaging = 50 * 25 = 1,250.00 BDT (125,000 poisha)
      // Total Direct Labor & Overhead Absorbed = 750,000 + 500,000 + 125,000 = 1,375,000 poisha (13,750.00 BDT)
      // Total Batch Cost (IAS 2) = 3,375,000 + 1,375,000 = 4,750,000 poisha (47,500.00 BDT)
      // Unit Cost = 4,750,000 / 50 = 95,000 poisha (950.00 BDT)
      //
      // Abnormal Wastage on Buttons:
      // Net buttons required = 50 * 8 = 400 pcs (4000000 scaled)
      // Abnormal portion (2.50%) = (4000000 * 250) / 10000 = 100000 scaled (10 pcs)
      // Abnormal cost = (100000 * 500) / 10000 = 5,000 poisha (50.00 BDT)
      // Section 46(3) VAT Rebate Clawback (15%) = (5000 * 1500) / 10000 = 750 poisha (7.50 BDT)

      const idempotencyKey = `batch-exec-1-${randomUUID().slice(0, 8)}`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/production-batches`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': idempotencyKey },
        payload: {
          declarationId,
          warehouseId,
          batchQuantity: '50.0000',
          batchDate: '2026-11-07',
          notes: 'Test RMG Shirt Run Batch #1',
        },
      });

      expect(res.statusCode, res.body).toBe(201);
      const data = res.json();
      const batch = data.batch;

      expect(batch.declarationId).toBe(declarationId);
      expect(batch.batchQuantity).toBe('50.0000');
      expect(batch.status).toBe('COMPLETED');
      expect(batch.totalRawMaterialCostPoisha).toBe('3375000');
      expect(batch.totalCostPoisha).toBe('4750000');
      expect(batch.unitCostPoisha).toBe('95000');
      expect(batch.hasAbnormalWastage).toBe(true);
      expect(batch.vatRebateClawbackPoisha).toBe('750');
      expect(batch.clawbackNote).toBe(MUSHAK_9_1_NOTE_27_CITATION);

      // Verify stock balances after batch execution
      // Fabric: started with 1000.0000, deducted 63.0000 -> 937.0000 remaining
      const balFabricRes = await database.pool.query<{ quantity: string; value_poisha: string }>(
        `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
           FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
        [companyId, rawItem1Id, warehouseId],
      );
      expect(balFabricRes.rows[0]?.quantity).toBe('937.0000');

      // Buttons: started with 5000.0000, deducted 450.0000 -> 4550.0000 remaining
      const balBtnRes = await database.pool.query<{ quantity: string; value_poisha: string }>(
        `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
           FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
        [companyId, rawItem2Id, warehouseId],
      );
      expect(balBtnRes.rows[0]?.quantity).toBe('4550.0000');

      // Finished Good Shirts: started with 0, incremented by 50.0000 -> 50.0000
      const balFgRes = await database.pool.query<{ quantity: string; value_poisha: string }>(
        `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
           FROM stock_balances WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
        [companyId, finishedItemId, warehouseId],
      );
      expect(balFgRes.rows[0]?.quantity).toBe('50.0000');
      expect(balFgRes.rows[0]?.value_poisha).toBe('4750000');

      // Verify Balanced General Ledger Journal Posting:
      // DR 1320 Finished Goods = 4,750,000 poisha
      // CR 1310 Raw Materials = 3,375,000 poisha
      // CR 5210 Direct Labor & Overhead Absorbed = 1,375,000 poisha
      expect(data.journalId).toBeDefined();
      const journalLinesRes = await database.pool.query<{
        account_code: string;
        debit_amount_poisha: string;
        credit_amount_poisha: string;
      }>(
        `SELECT a.code AS account_code, jl.debit_poisha::text AS debit_amount_poisha, jl.credit_poisha::text AS credit_amount_poisha
           FROM journal_lines jl
           JOIN accounts a ON a.company_id = jl.company_id AND a.id = jl.account_id
          WHERE jl.company_id = $1 AND jl.journal_id = $2
          ORDER BY jl.line_no ASC`,
        [companyId, data.journalId],
      );

      const lines = journalLinesRes.rows;
      expect(lines.length).toBe(3);

      const line1320 = lines.find((l) => l.account_code === '1320');
      expect(line1320).toBeDefined();
      expect(line1320?.debit_amount_poisha).toBe('4750000');
      expect(line1320?.credit_amount_poisha).toBe('0');

      const line1310 = lines.find((l) => l.account_code === '1310');
      expect(line1310).toBeDefined();
      expect(line1310?.debit_amount_poisha).toBe('0');
      expect(line1310?.credit_amount_poisha).toBe('3375000');

      const line5210 = lines.find((l) => l.account_code === '5210');
      expect(line5210).toBeDefined();
      expect(line5210?.debit_amount_poisha).toBe('0');
      expect(line5210?.credit_amount_poisha).toBe('1375000');

      // Verify Mathematical Balance Invariant: Total Debits === Total Credits
      const totalDebits = lines.reduce((acc, l) => acc + BigInt(l.debit_amount_poisha), 0n);
      const totalCredits = lines.reduce((acc, l) => acc + BigInt(l.credit_amount_poisha), 0n);
      expect(totalDebits).toBe(totalCredits);
      expect(totalDebits).toBe(4_750_000n);
    });

    it('enforces idempotency on production batch execution', async () => {
      const idempotencyKey = `batch-idemp-${randomUUID().slice(0, 8)}`;

      // 1. First execution
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/production-batches`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': idempotencyKey },
        payload: {
          declarationId,
          warehouseId,
          batchQuantity: '10.0000',
          batchDate: '2026-11-07',
        },
      });
      expect(res1.statusCode, res1.body).toBe(201);
      const batch1 = res1.json().batch;
      expect(res1.json().replayed).toBe(false);

      // 2. Replay with identical idempotency key
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/production-batches`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': idempotencyKey },
        payload: {
          declarationId,
          warehouseId,
          batchQuantity: '10.0000',
          batchDate: '2026-11-07',
        },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().replayed).toBe(true);
      expect(res2.json().batch.id).toBe(batch1.id);
    });

    it('blocks execution when raw materials are insufficient unless negative stock override is authorised', async () => {
      // Attempt to produce 1,000,000 shirts (which requires 1.26M metres of fabric; only ~900 metres available)
      const resWithoutOverride = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${companyId}/inventory/production-batches`,
        headers: { ...authHeaders(ownerCookies), 'Idempotency-Key': `batch-excess-${randomUUID().slice(0, 8)}` },
        payload: {
          declarationId,
          warehouseId,
          batchQuantity: '1000000.0000',
          batchDate: '2026-11-07',
          allowNegativeStock: false,
        },
      });
      expect(resWithoutOverride.statusCode).toBe(409);
      expect(resWithoutOverride.json().code).toBe('INSUFFICIENT_STOCK');
    });
  });
});
