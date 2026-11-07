import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { withTransaction } from '../db/transaction.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { QUANTITY_SCALE } from '../master/constants.ts';
import { postSystemJournalWithinTransaction } from '../ledger/ledgerService.ts';
import {
  divideRoundHalfUp,
  formatQuantity,
  parsePositiveQuantity,
  parseStoredQuantity,
} from './quantity.ts';

export type Queryable = {
  query: Pool['query'];
};

async function getCompanyOrgId(client: Queryable, companyId: string): Promise<string> {
  const res = await client.query<{ organisation_id: string }>(
    `SELECT organisation_id FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!res.rows[0]) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return res.rows[0].organisation_id;
}

// -----------------------------------------------------------------------------
// Pure Statutory & Mathematical Formulas (Rule 21 & Section 46(3))
// -----------------------------------------------------------------------------

export const STANDARD_VAT_RATE_BPS = 1500; // 15.00%
export const ABNORMAL_WASTAGE_THRESHOLD_BPS = 1000; // 10.00%
export const MUSHAK_9_1_NOTE_27_CITATION =
  'Mushak 9.1 Part 5 Note 27: Input VAT rebate clawback on abnormal wastage (>10%)';

/**
 * Gross quantity scaled by 10,000n:
 * grossQuantityScaled = netQuantityScaled + floor((netQuantityScaled * BigInt(wastageBps)) / 10000n)
 */
export function calculateGrossQuantityScaled(netQuantityScaled: bigint, wastageBps: number): bigint {
  if (netQuantityScaled <= 0n) return 0n;
  if (wastageBps < 0) {
    throw new AppError(400, 'WASTAGE_BPS_INVALID', 'Wastage percentage basis points cannot be negative.');
  }
  const wastageScaled = (netQuantityScaled * BigInt(wastageBps)) / 10000n;
  return netQuantityScaled + wastageScaled;
}

/**
 * Raw material ingredient cost in minor units (poisha):
 * ingredientCostPoisha = floor((grossQuantityScaled * ratePerUnitPoisha) / 10000n)
 */
export function calculateIngredientCostPoisha(grossQuantityScaled: bigint, ratePerUnitPoisha: bigint): bigint {
  if (grossQuantityScaled <= 0n || ratePerUnitPoisha < 0n) return 0n;
  return (grossQuantityScaled * ratePerUnitPoisha) / 10000n;
}

/**
 * Normal wastage is allowable up to 10.00% (1,000 bps).
 * Any wastage exceeding 10.00% is statutory abnormal wastage under Rule 21 and Section 46(3).
 */
export function isAbnormalWastage(wastageBps: number): boolean {
  return wastageBps > ABNORMAL_WASTAGE_THRESHOLD_BPS;
}

/**
 * Input VAT rebate clawback on abnormal wastage (> 10.00%):
 * Any abnormal wastage during batch execution triggers an Input VAT rebate clawback in Mushak 9.1 Part 5 Note 27.
 */
export function calculateAbnormalWastageClawback(
  netQuantityScaled: bigint,
  wastageBps: number,
  ratePerUnitPoisha: bigint,
  rebatableInputVat: boolean = true,
): {
  isAbnormal: boolean;
  abnormalBps: number;
  abnormalQuantityScaled: bigint;
  abnormalCostPoisha: bigint;
  vatClawbackPoisha: bigint;
} {
  if (!isAbnormalWastage(wastageBps) || netQuantityScaled <= 0n || ratePerUnitPoisha <= 0n) {
    return {
      isAbnormal: false,
      abnormalBps: 0,
      abnormalQuantityScaled: 0n,
      abnormalCostPoisha: 0n,
      vatClawbackPoisha: 0n,
    };
  }

  const abnormalBps = wastageBps - ABNORMAL_WASTAGE_THRESHOLD_BPS;
  const abnormalQuantityScaled = (netQuantityScaled * BigInt(abnormalBps)) / 10000n;
  const abnormalCostPoisha = (abnormalQuantityScaled * ratePerUnitPoisha) / 10000n;
  const vatClawbackPoisha = rebatableInputVat
    ? (abnormalCostPoisha * BigInt(STANDARD_VAT_RATE_BPS)) / 10000n
    : 0n;

  return {
    isAbnormal: true,
    abnormalBps,
    abnormalQuantityScaled,
    abnormalCostPoisha,
    vatClawbackPoisha,
  };
}

// -----------------------------------------------------------------------------
// Types & DTOs
// -----------------------------------------------------------------------------

export interface Mushak43IngredientInput {
  rawItemId: string;
  netQuantity: string | number; // e.g. "1.2000"
  wastageBps: number; // e.g. 500 = 5.00%, 1200 = 12.00%
  unit: string;
  ratePerUnitPoisha: string | bigint | number;
  rebatableInputVat?: boolean;
}

export interface CreateMushak43Input {
  companyId: string;
  declarationNumber?: string | null;
  finishedItemId: string;
  outputQuantity: string | number; // e.g. "1.0000"
  outputUnit: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null;
  nbrDivisionOffice?: string | null;
  directLaborCostPoisha?: string | bigint | number;
  manufacturingOverheadPoisha?: string | bigint | number;
  packagingCostPoisha?: string | bigint | number;
  targetProfitMarginBps?: number; // e.g. 1500 = 15.00%
  declaredRetailPricePoisha?: string | bigint | number | null;
  ingredients: Mushak43IngredientInput[];
  userId: string;
}

export interface Mushak43IngredientDto {
  id: string;
  declarationId: string;
  rawItemId: string;
  rawItemSku: string;
  rawItemName: string;
  rawItemHsCode: string | null;
  netQuantity: string;
  wastageBps: number;
  grossQuantity: string;
  unit: string;
  ratePerUnitPoisha: string;
  ratePerUnitBdt: string;
  totalCostPoisha: string;
  totalCostBdt: string;
  rebatableInputVat: boolean;
  isAbnormalWastage: boolean;
}

export interface Mushak43DeclarationDto {
  id: string;
  companyId: string;
  declarationNumber: string;
  finishedItemId: string;
  finishedItemSku: string;
  finishedItemName: string;
  finishedItemHsCode: string | null;
  outputQuantity: string;
  outputUnit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'DRAFT' | 'SUBMITTED_TO_NBR' | 'APPROVED' | 'SUPERSEDED';
  nbrSubmissionDate: string | null;
  nbrDivisionOffice: string | null;
  totalRawMaterialCostPoisha: string;
  totalRawMaterialCostBdt: string;
  directLaborCostPoisha: string;
  directLaborCostBdt: string;
  manufacturingOverheadPoisha: string;
  manufacturingOverheadBdt: string;
  packagingCostPoisha: string;
  packagingCostBdt: string;
  totalCostOfProductionPoisha: string;
  totalCostOfProductionBdt: string;
  targetProfitMarginBps: number;
  declaredRetailPricePoisha: string;
  declaredRetailPriceBdt: string;
  hasAbnormalWastage: boolean;
  createdAt: string;
  updatedAt: string;
  ingredients: Mushak43IngredientDto[];
}

export interface ProductionBatchDto {
  id: string;
  companyId: string;
  batchNumber: string;
  declarationId: string;
  declarationNumber: string;
  finishedItemId: string;
  finishedItemSku: string;
  finishedItemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  batchDate: string;
  batchQuantity: string;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  totalRawMaterialCostPoisha: string;
  totalRawMaterialCostBdt: string;
  directLaborCostPoisha: string;
  directLaborCostBdt: string;
  manufacturingOverheadPoisha: string;
  manufacturingOverheadBdt: string;
  packagingCostPoisha: string;
  packagingCostBdt: string;
  totalCostPoisha: string;
  totalCostBdt: string;
  unitCostPoisha: string;
  unitCostBdt: string;
  hasAbnormalWastage: boolean;
  abnormalWastageCostPoisha: string;
  abnormalWastageCostBdt: string;
  vatRebateClawbackPoisha: string;
  vatRebateClawbackBdt: string;
  clawbackNote: string | null;
  journalId: string | null;
  journalNumber?: string | null;
  executedBy: string | null;
  executedByName?: string | null;
  executedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecuteProductionBatchInput {
  companyId: string;
  declarationId: string;
  warehouseId: string;
  batchQuantity: string | number; // Quantity of finished goods to produce
  batchDate: string; // YYYY-MM-DD
  batchNumber?: string | null;
  notes?: string | null;
  allowNegativeStock?: boolean;
  overrideReason?: string | null;
  idempotencyKey: string;
  userId: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ProductionBatchExecutionResult {
  batch: ProductionBatchDto;
  journalId: string;
  journalNumber: string;
  replayed: boolean;
}

// -----------------------------------------------------------------------------
// Database Balance Locking & Stock Helpers
// -----------------------------------------------------------------------------

interface BalanceState {
  quantity: bigint;
  valuePoisha: bigint;
}

function poishaToBdtString(poisha: bigint): string {
  const negative = poisha < 0n;
  const abs = negative ? -poisha : poisha;
  const taka = abs / 100n;
  const rem = abs % 100n;
  return `${negative ? '-' : ''}${taka.toString()}.${rem.toString().padStart(2, '0')}`;
}

async function lockBalance(
  client: PoolClient,
  companyId: string,
  itemId: string,
  warehouseId: string,
): Promise<BalanceState> {
  await client.query(
    `INSERT INTO stock_balances (company_id, item_id, warehouse_id, quantity, value_poisha)
     VALUES ($1,$2,$3,0,0) ON CONFLICT DO NOTHING`,
    [companyId, itemId, warehouseId],
  );
  const result = await client.query<{ quantity: string; value_poisha: string }>(
    `SELECT quantity::text AS quantity, value_poisha::text AS value_poisha
       FROM stock_balances
      WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3
      FOR UPDATE`,
    [companyId, itemId, warehouseId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(500, 'STOCK_BALANCE_MISSING', 'The stock balance could not be locked.');
  return { quantity: parseStoredQuantity(row.quantity), valuePoisha: BigInt(row.value_poisha) };
}

async function updateBalance(
  client: PoolClient,
  companyId: string,
  itemId: string,
  warehouseId: string,
  state: BalanceState,
): Promise<void> {
  const result = await client.query(
    `UPDATE stock_balances
        SET quantity = $4::numeric,
            value_poisha = $5,
            updated_at = now()
      WHERE company_id = $1 AND item_id = $2 AND warehouse_id = $3`,
    [companyId, itemId, warehouseId, formatQuantity(state.quantity), state.valuePoisha.toString()],
  );
  if (result.rowCount !== 1) {
    throw new AppError(500, 'STOCK_BALANCE_UPDATE_FAILED', 'The stock balance could not be updated.');
  }
}

/**
 * Ensures accounts 1310 (Raw Materials), 1320 (Finished Goods), and 5210 (Direct Labor & Overhead Absorbed)
 * exist for the company.
 */
export async function ensureManufacturingAccounts(
  client: PoolClient,
  companyId: string,
): Promise<{ rawMaterialsAccount: string; finishedGoodsAccount: string; absorbedOverheadAccount: string }> {
  const accountDefs = [
    {
      code: '1310',
      nameEn: 'Raw Materials Inventory',
      nameBn: 'কাঁচামাল ইনভেন্টরি',
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
      ifrsCategory: 'NA_BALANCE_SHEET',
      controlSubledger: 'INVENTORY',
    },
    {
      code: '1320',
      nameEn: 'Finished Goods Inventory',
      nameBn: 'তৈরি পণ্য ইনভেন্টরি',
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
      ifrsCategory: 'NA_BALANCE_SHEET',
      controlSubledger: 'INVENTORY',
    },
    {
      code: '5210',
      nameEn: 'Direct Labor & Overhead Absorbed',
      nameBn: 'প্রত্যক্ষ শ্রম ও কারখানার উপরি ব্যয় শোষিত',
      accountType: 'EXPENSE',
      subCategory: 'COST_OF_SALES',
      ifrsCategory: 'OPERATING',
      controlSubledger: 'NONE',
    },
  ];

  const existing = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM accounts WHERE company_id = $1 AND code = ANY($2)`,
    [companyId, accountDefs.map((a) => a.code)],
  );

  const accountMap: Record<string, string> = {};
  for (const row of existing.rows) {
    accountMap[row.code] = row.id;
  }

  for (const def of accountDefs) {
    if (!accountMap[def.code]) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO accounts (
           company_id, code, name_en, name_bn, account_type, sub_category,
           ifrs_category, control_subledger, currency, tax_mapping_json, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BDT', '{}', true)
         ON CONFLICT (company_id, code) DO UPDATE SET is_active = true
         RETURNING id`,
        [
          companyId,
          def.code,
          def.nameEn,
          def.nameBn,
          def.accountType,
          def.subCategory,
          def.ifrsCategory,
          def.controlSubledger,
        ],
      );
      accountMap[def.code] = ins.rows[0]!.id;
    }
  }

  return {
    rawMaterialsAccount: accountMap['1310']!,
    finishedGoodsAccount: accountMap['1320']!,
    absorbedOverheadAccount: accountMap['5210']!,
  };
}

// -----------------------------------------------------------------------------
// Mushak 4.3 Declaration Service
// -----------------------------------------------------------------------------

export async function createMushak43Declaration(
  pool: Pool,
  input: CreateMushak43Input,
): Promise<Mushak43DeclarationDto> {
  const outputQtyScaled = parsePositiveQuantity(input.outputQuantity, 'Output quantity');
  if (input.ingredients.length === 0) {
    throw new AppError(400, 'BOM_INGREDIENTS_REQUIRED', 'A Mushak 4.3 declaration requires at least one raw material ingredient.');
  }

  return withTransaction(pool, async (client) => {
    // 1. Verify finished item exists and is active
    const itemRes = await client.query<{ id: string; is_stock_item: boolean; status: string; sku: string }>(
      `SELECT id, is_stock_item, status, sku FROM items WHERE company_id = $1 AND id = $2 FOR SHARE`,
      [input.companyId, input.finishedItemId],
    );
    if (!itemRes.rows[0]) throw new AppError(404, 'FINISHED_ITEM_NOT_FOUND', 'Finished goods item not found.');
    if (itemRes.rows[0].status !== 'ACTIVE') throw new AppError(409, 'ITEM_INACTIVE', 'Finished goods item is inactive.');

    // 2. Generate or validate declaration number
    let declarationNumber = input.declarationNumber?.trim();
    if (!declarationNumber) {
      const year = new Date().getFullYear();
      const countRes = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM mushak_43_declarations WHERE company_id = $1`,
        [input.companyId],
      );
      const nextSeq = Number(countRes.rows[0]?.count ?? '0') + 1;
      declarationNumber = `M43-${year}-${nextSeq.toString().padStart(4, '0')}`;
    }

    const dupCheck = await client.query(
      `SELECT id FROM mushak_43_declarations WHERE company_id = $1 AND declaration_number = $2`,
      [input.companyId, declarationNumber],
    );
    if (dupCheck.rows[0]) {
      throw new AppError(409, 'DECLARATION_NUMBER_EXISTS', `Declaration number ${declarationNumber} already exists.`);
    }

    // 3. Compute costs and Section 46(3) wastage guardrails for each ingredient
    const laborPoisha = BigInt(input.directLaborCostPoisha ?? 0);
    const overheadPoisha = BigInt(input.manufacturingOverheadPoisha ?? 0);
    const packagingPoisha = BigInt(input.packagingCostPoisha ?? 0);
    const profitMarginBps = input.targetProfitMarginBps ?? 1500;

    let totalRmCostPoisha = 0n;
    const computedIngredients: Array<{
      rawItemId: string;
      netQuantity: bigint;
      wastageBps: number;
      grossQuantity: bigint;
      unit: string;
      ratePerUnitPoisha: bigint;
      totalCostPoisha: bigint;
      rebatableInputVat: boolean;
      isAbnormalWastage: boolean;
    }> = [];

    for (const ing of input.ingredients) {
      const rawRes = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM items WHERE company_id = $1 AND id = $2 FOR SHARE`,
        [input.companyId, ing.rawItemId],
      );
      if (!rawRes.rows[0]) {
        throw new AppError(404, 'RAW_ITEM_NOT_FOUND', `Raw material item ${ing.rawItemId} not found.`);
      }

      const netScaled = parsePositiveQuantity(ing.netQuantity, 'Ingredient net quantity');
      const wastageBps = Math.max(0, Math.floor(ing.wastageBps ?? 0));
      const grossScaled = calculateGrossQuantityScaled(netScaled, wastageBps);
      const ratePoisha = BigInt(ing.ratePerUnitPoisha ?? 0);
      const ingCostPoisha = calculateIngredientCostPoisha(grossScaled, ratePoisha);
      const abnormal = isAbnormalWastage(wastageBps);

      totalRmCostPoisha += ingCostPoisha;
      computedIngredients.push({
        rawItemId: ing.rawItemId,
        netQuantity: netScaled,
        wastageBps,
        grossQuantity: grossScaled,
        unit: ing.unit.trim(),
        ratePerUnitPoisha: ratePoisha,
        totalCostPoisha: ingCostPoisha,
        rebatableInputVat: ing.rebatableInputVat ?? true,
        isAbnormalWastage: abnormal,
      });
    }

    const totalCostOfProduction = totalRmCostPoisha + laborPoisha + overheadPoisha + packagingPoisha;
    let declaredPrice = BigInt(input.declaredRetailPricePoisha ?? 0);
    if (declaredPrice <= 0n) {
      const profitPoisha = (totalCostOfProduction * BigInt(profitMarginBps)) / 10000n;
      declaredPrice = totalCostOfProduction + profitPoisha;
    }

    const declarationId = randomUUID();
    await client.query(
      `INSERT INTO mushak_43_declarations (
         id, company_id, declaration_number, finished_item_id, output_quantity, output_unit,
         effective_from, effective_to, status, nbr_division_office, total_rm_cost_poisha,
         direct_labor_cost_poisha, overhead_cost_poisha, packaging_cost_poisha,
         target_profit_margin_bps, declared_price_poisha
       ) VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,'DRAFT',$9,$10,$11,$12,$13,$14,$15)`,
      [
        declarationId,
        input.companyId,
        declarationNumber,
        input.finishedItemId,
        formatQuantity(outputQtyScaled),
        input.outputUnit.trim(),
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.nbrDivisionOffice ?? null,
        totalRmCostPoisha.toString(),
        laborPoisha.toString(),
        overheadPoisha.toString(),
        packagingPoisha.toString(),
        profitMarginBps,
        declaredPrice.toString(),
      ],
    );

    for (const ing of computedIngredients) {
      await client.query(
        `INSERT INTO mushak_43_ingredients (
           id, company_id, declaration_id, raw_item_id, net_quantity, wastage_bps,
           gross_quantity, unit, rate_per_unit_poisha, total_cost_poisha,
           rebatable_input_vat, is_abnormal_wastage
         ) VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::numeric,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          input.companyId,
          declarationId,
          ing.rawItemId,
          formatQuantity(ing.netQuantity),
          ing.wastageBps,
          formatQuantity(ing.grossQuantity),
          ing.unit,
          ing.ratePerUnitPoisha.toString(),
          ing.totalCostPoisha.toString(),
          ing.rebatableInputVat,
          ing.isAbnormalWastage,
        ],
      );
    }

    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'inventory.mushak43_created',
      entityType: 'mushak_43_declarations',
      entityId: declarationId,
      after: {
        declarationNumber,
        totalRmCostPoisha: totalRmCostPoisha.toString(),
        declaredPricePoisha: declaredPrice.toString(),
      },
    });

    const full = await getMushak43Declaration(client, input.companyId, declarationId);
    return full!;
  });
}

export async function listMushak43Declarations(
  database: Queryable,
  companyId: string,
  options: { finishedItemId?: string; status?: string; page?: number; pageSize?: number } = {},
): Promise<{ declarations: Mushak43DeclarationDto[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const conditions = ['d.company_id = $1'];
  const values: any[] = [companyId];

  if (options.finishedItemId) {
    values.push(options.finishedItemId);
    conditions.push(`d.finished_item_id = $${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    conditions.push(`d.status = $${values.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM mushak_43_declarations d WHERE ${whereClause}`,
    values,
  );
  const total = Number(countRes.rows[0]?.total ?? '0');

  const rows = await database.query(
    `SELECT d.*, i.sku AS finished_item_sku, i.name_en AS finished_item_name, i.hs_code AS finished_item_hs_code
       FROM mushak_43_declarations d
       JOIN items i ON i.company_id = d.company_id AND i.id = d.finished_item_id
      WHERE ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  const declarationIds = rows.rows.map((r: any) => r.id);
  const ingredientMap: Record<string, Mushak43IngredientDto[]> = {};

  if (declarationIds.length > 0) {
    const ingRows = await database.query(
      `SELECT ing.*, raw.sku AS raw_item_sku, raw.name_en AS raw_item_name, raw.hs_code AS raw_item_hs_code
         FROM mushak_43_ingredients ing
         JOIN items raw ON raw.company_id = ing.company_id AND raw.id = ing.raw_item_id
        WHERE ing.company_id = $1 AND ing.declaration_id = ANY($2::uuid[])
        ORDER BY ing.created_at ASC`,
      [companyId, declarationIds],
    );

    for (const ing of ingRows.rows as any[]) {
      let list = ingredientMap[ing.declaration_id];
      if (!list) {
        list = [];
        ingredientMap[ing.declaration_id] = list;
      }
      const rate = BigInt(ing.rate_per_unit_poisha);
      const cost = BigInt(ing.total_cost_poisha);
      list.push({
        id: ing.id,
        declarationId: ing.declaration_id,
        rawItemId: ing.raw_item_id,
        rawItemSku: ing.raw_item_sku,
        rawItemName: ing.raw_item_name,
        rawItemHsCode: ing.raw_item_hs_code,
        netQuantity: ing.net_quantity,
        wastageBps: ing.wastage_bps,
        grossQuantity: ing.gross_quantity,
        unit: ing.unit,
        ratePerUnitPoisha: ing.rate_per_unit_poisha,
        ratePerUnitBdt: poishaToBdtString(rate),
        totalCostPoisha: ing.total_cost_poisha,
        totalCostBdt: poishaToBdtString(cost),
        rebatableInputVat: ing.rebatable_input_vat,
        isAbnormalWastage: ing.is_abnormal_wastage,
      });
    }
  }

  const declarations: Mushak43DeclarationDto[] = rows.rows.map((r: any) => {
    const rm = BigInt(r.total_rm_cost_poisha);
    const labor = BigInt(r.direct_labor_cost_poisha);
    const overhead = BigInt(r.overhead_cost_poisha);
    const pack = BigInt(r.packaging_cost_poisha);
    const totalCost = rm + labor + overhead + pack;
    const declared = BigInt(r.declared_price_poisha);
    const ings = ingredientMap[r.id] ?? [];
    const hasAbnormal = ings.some((i) => i.isAbnormalWastage);

    return {
      id: r.id,
      companyId: r.company_id,
      declarationNumber: r.declaration_number,
      finishedItemId: r.finished_item_id,
      finishedItemSku: r.finished_item_sku,
      finishedItemName: r.finished_item_name,
      finishedItemHsCode: r.finished_item_hs_code,
      outputQuantity: r.output_quantity,
      outputUnit: r.output_unit,
      effectiveFrom: formatDatabaseDate(r.effective_from),
      effectiveTo: r.effective_to ? formatDatabaseDate(r.effective_to) : null,
      status: r.status,
      nbrSubmissionDate: r.nbr_submission_date ? formatDatabaseDate(r.nbr_submission_date) : null,
      nbrDivisionOffice: r.nbr_division_office,
      totalRawMaterialCostPoisha: r.total_rm_cost_poisha,
      totalRawMaterialCostBdt: poishaToBdtString(rm),
      directLaborCostPoisha: r.direct_labor_cost_poisha,
      directLaborCostBdt: poishaToBdtString(labor),
      manufacturingOverheadPoisha: r.overhead_cost_poisha,
      manufacturingOverheadBdt: poishaToBdtString(overhead),
      packagingCostPoisha: r.packaging_cost_poisha,
      packagingCostBdt: poishaToBdtString(pack),
      totalCostOfProductionPoisha: totalCost.toString(),
      totalCostOfProductionBdt: poishaToBdtString(totalCost),
      targetProfitMarginBps: r.target_profit_margin_bps,
      declaredRetailPricePoisha: r.declared_price_poisha,
      declaredRetailPriceBdt: poishaToBdtString(declared),
      hasAbnormalWastage: hasAbnormal,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      ingredients: ings,
    };
  });

  return { declarations, total, page, pageSize };
}

export async function getMushak43Declaration(
  database: Queryable,
  companyId: string,
  declarationId: string,
): Promise<Mushak43DeclarationDto | null> {
  const rowRes = await database.query(
    `SELECT d.*, i.sku AS finished_item_sku, i.name_en AS finished_item_name, i.hs_code AS finished_item_hs_code
       FROM mushak_43_declarations d
       JOIN items i ON i.company_id = d.company_id AND i.id = d.finished_item_id
      WHERE d.company_id = $1 AND d.id = $2`,
    [companyId, declarationId],
  );
  const r = rowRes.rows[0];
  if (!r) return null;

  const ingRows = await database.query(
    `SELECT ing.*, raw.sku AS raw_item_sku, raw.name_en AS raw_item_name, raw.hs_code AS raw_item_hs_code
       FROM mushak_43_ingredients ing
       JOIN items raw ON raw.company_id = ing.company_id AND raw.id = ing.raw_item_id
      WHERE ing.company_id = $1 AND ing.declaration_id = $2
      ORDER BY ing.created_at ASC`,
    [companyId, declarationId],
  );

  const ings: Mushak43IngredientDto[] = ingRows.rows.map((ing: any) => ({
    id: ing.id,
    declarationId: ing.declaration_id,
    rawItemId: ing.raw_item_id,
    rawItemSku: ing.raw_item_sku,
    rawItemName: ing.raw_item_name,
    rawItemHsCode: ing.raw_item_hs_code,
    netQuantity: ing.net_quantity,
    wastageBps: ing.wastage_bps,
    grossQuantity: ing.gross_quantity,
    unit: ing.unit,
    ratePerUnitPoisha: ing.rate_per_unit_poisha,
    ratePerUnitBdt: poishaToBdtString(BigInt(ing.rate_per_unit_poisha)),
    totalCostPoisha: ing.total_cost_poisha,
    totalCostBdt: poishaToBdtString(BigInt(ing.total_cost_poisha)),
    rebatableInputVat: ing.rebatable_input_vat,
    isAbnormalWastage: ing.is_abnormal_wastage,
  }));

  const rm = BigInt(r.total_rm_cost_poisha);
  const labor = BigInt(r.direct_labor_cost_poisha);
  const overhead = BigInt(r.overhead_cost_poisha);
  const pack = BigInt(r.packaging_cost_poisha);
  const totalCost = rm + labor + overhead + pack;
  const declared = BigInt(r.declared_price_poisha);
  const hasAbnormal = ings.some((i) => i.isAbnormalWastage);

  return {
    id: r.id,
    companyId: r.company_id,
    declarationNumber: r.declaration_number,
    finishedItemId: r.finished_item_id,
    finishedItemSku: r.finished_item_sku,
    finishedItemName: r.finished_item_name,
    finishedItemHsCode: r.finished_item_hs_code,
    outputQuantity: r.output_quantity,
    outputUnit: r.output_unit,
    effectiveFrom: formatDatabaseDate(r.effective_from),
    effectiveTo: r.effective_to ? formatDatabaseDate(r.effective_to) : null,
    status: r.status,
    nbrSubmissionDate: r.nbr_submission_date ? formatDatabaseDate(r.nbr_submission_date) : null,
    nbrDivisionOffice: r.nbr_division_office,
    totalRawMaterialCostPoisha: r.total_rm_cost_poisha,
    totalRawMaterialCostBdt: poishaToBdtString(rm),
    directLaborCostPoisha: r.direct_labor_cost_poisha,
    directLaborCostBdt: poishaToBdtString(labor),
    manufacturingOverheadPoisha: r.overhead_cost_poisha,
    manufacturingOverheadBdt: poishaToBdtString(overhead),
    packagingCostPoisha: r.packaging_cost_poisha,
    packagingCostBdt: poishaToBdtString(pack),
    totalCostOfProductionPoisha: totalCost.toString(),
    totalCostOfProductionBdt: poishaToBdtString(totalCost),
    targetProfitMarginBps: r.target_profit_margin_bps,
    declaredRetailPricePoisha: r.declared_price_poisha,
    declaredRetailPriceBdt: poishaToBdtString(declared),
    hasAbnormalWastage: hasAbnormal,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    ingredients: ings,
  };
}

export async function submitMushak43ToNbr(
  pool: Pool,
  input: {
    companyId: string;
    declarationId: string;
    nbrSubmissionDate?: string;
    nbrDivisionOffice?: string;
    approveImmediately?: boolean;
    userId: string;
  },
): Promise<Mushak43DeclarationDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM mushak_43_declarations WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.declarationId],
    );
    if (!existing.rows[0]) throw new AppError(404, 'DECLARATION_NOT_FOUND', 'Mushak 4.3 declaration not found.');

    const newStatus = input.approveImmediately ? 'APPROVED' : 'SUBMITTED_TO_NBR';
    const subDate = input.nbrSubmissionDate ?? new Date().toISOString().slice(0, 10);

    await client.query(
      `UPDATE mushak_43_declarations
          SET status = $3,
              nbr_submission_date = $4::date,
              nbr_division_office = COALESCE($5, nbr_division_office),
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.declarationId, newStatus, subDate, input.nbrDivisionOffice ?? null],
    );

    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'inventory.mushak43_status_updated',
      entityType: 'mushak_43_declarations',
      entityId: input.declarationId,
      after: { status: newStatus, nbrSubmissionDate: subDate },
    });

    const updated = await getMushak43Declaration(client, input.companyId, input.declarationId);
    return updated!;
  });
}

// -----------------------------------------------------------------------------
// Production Batch & IAS 2 WIP / Finished Goods Costing Engine
// -----------------------------------------------------------------------------

/**
 * Executing a production batch (executeProductionBatch):
 * 1. Atomically deducts raw material stock (Account 1310) from the specified warehouse.
 * 2. Increments finished goods stock (Account 1320) in the warehouse.
 * 3. Checks Section 46(3) wastage: any abnormal wastage (> 10.00%) is flagged for Mushak 9.1 Part 5 Note 27.
 * 4. Posts a balanced GL journal:
 *    DR 1320 Finished Goods
 *    CR 1310 Raw Materials
 *    CR 5210 Direct Labor & Overhead Absorbed
 */
export async function executeProductionBatch(
  pool: Pool,
  input: ExecuteProductionBatchInput,
): Promise<ProductionBatchExecutionResult> {
  const batchQtyScaled = parsePositiveQuantity(input.batchQuantity, 'Production batch quantity');

  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'A valid Idempotency-Key header is required for production.');
  }

  return withTransaction(pool, async (client) => {
    // 0. Idempotency Check & Advisory Lock
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `mfg:${input.companyId}:${input.idempotencyKey}`,
    ]);

    const replayCheck = await client.query<{ source_doc_id: string }>(
      `SELECT source_doc_id
         FROM stock_movements
        WHERE company_id = $1 AND idempotency_key = $2 AND source_type = 'MANUFACTURING'
        LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (replayCheck.rows[0]) {
      const existingBatch = await getProductionBatch(client, input.companyId, replayCheck.rows[0].source_doc_id);
      if (existingBatch) {
        return {
          batch: existingBatch,
          journalId: existingBatch.journalId ?? '',
          journalNumber: existingBatch.journalNumber ?? '',
          replayed: true,
        };
      }
    }

    // 1. Lock and load Mushak 4.3 Declaration
    const declRes = await client.query(
      `SELECT d.*, i.sku AS finished_item_sku, i.name_en AS finished_item_name
         FROM mushak_43_declarations d
         JOIN items i ON i.company_id = d.company_id AND i.id = d.finished_item_id
        WHERE d.company_id = $1 AND d.id = $2 FOR SHARE`,
      [input.companyId, input.declarationId],
    );
    const decl = declRes.rows[0];
    if (!decl) throw new AppError(404, 'DECLARATION_NOT_FOUND', 'Mushak 4.3 declaration not found.');
    if (decl.status === 'SUPERSEDED') {
      throw new AppError(409, 'DECLARATION_SUPERSEDED', 'Cannot execute production against a superseded declaration.');
    }

    const declOutputScaled = parseStoredQuantity(decl.output_quantity);
    if (declOutputScaled <= 0n) {
      throw new AppError(500, 'DECLARATION_OUTPUT_INVALID', 'Declaration output quantity must be greater than zero.');
    }

    // 2. Lock and load Warehouse
    const whRes = await client.query<{ id: string; code: string; name_en: string; status: string }>(
      `SELECT id, code, name_en, status FROM warehouses WHERE company_id = $1 AND id = $2 FOR SHARE`,
      [input.companyId, input.warehouseId],
    );
    const warehouse = whRes.rows[0];
    if (!warehouse) throw new AppError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    if (warehouse.status !== 'ACTIVE') throw new AppError(409, 'WAREHOUSE_INACTIVE', 'Warehouse is inactive.');

    // 3. Load declaration ingredients
    const ingRows = await client.query(
      `SELECT ing.*, raw.sku AS raw_item_sku, raw.name_en AS raw_item_name, raw.status AS raw_item_status
         FROM mushak_43_ingredients ing
         JOIN items raw ON raw.company_id = ing.company_id AND raw.id = ing.raw_item_id
        WHERE ing.company_id = $1 AND ing.declaration_id = $2
        ORDER BY ing.created_at ASC`,
      [input.companyId, input.declarationId],
    );
    if (ingRows.rows.length === 0) {
      throw new AppError(400, 'DECLARATION_EMPTY', 'Declaration has no raw material ingredients.');
    }

    // 4. Compute batch numbers and IDs
    const batchId = randomUUID();
    let batchNumber = input.batchNumber?.trim();
    if (!batchNumber) {
      const year = new Date().getFullYear();
      const countRes = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM production_batches WHERE company_id = $1`,
        [input.companyId],
      );
      const nextSeq = Number(countRes.rows[0]?.count ?? '0') + 1;
      batchNumber = `PB-${year}-${nextSeq.toString().padStart(4, '0')}`;
    }

    // 5. Calculate raw material requirements, validate stock availability, and plan consumption
    let totalBatchRmCostPoisha = 0n;
    let hasAbnormalWastage = false;
    let totalAbnormalCostPoisha = 0n;
    let totalVatClawbackPoisha = 0n;

    interface RmPlan {
      ing: any;
      requiredGrossScaled: bigint;
      ratePoisha: bigint;
      ingCostPoisha: bigint;
      balanceAfterQuantity: bigint;
      balanceAfterValuePoisha: bigint;
    }
    const rmPlans: RmPlan[] = [];

    for (const ing of ingRows.rows) {
      const ingNetScaled = parseStoredQuantity(ing.net_quantity);
      const wastageBps = ing.wastage_bps;
      const ratePoisha = BigInt(ing.rate_per_unit_poisha);

      // Scale net quantity proportionally for this batch:
      // batchRatio = batchQtyScaled / declOutputScaled
      const requiredNetScaled = divideRoundHalfUp(ingNetScaled * batchQtyScaled, declOutputScaled);
      const requiredGrossScaled = calculateGrossQuantityScaled(requiredNetScaled, wastageBps);
      const ingCostPoisha = calculateIngredientCostPoisha(requiredGrossScaled, ratePoisha);

      totalBatchRmCostPoisha += ingCostPoisha;

      // Section 46(3) abnormal wastage guardrail
      const clawback = calculateAbnormalWastageClawback(
        requiredNetScaled,
        wastageBps,
        ratePoisha,
        ing.rebatable_input_vat,
      );
      if (clawback.isAbnormal) {
        hasAbnormalWastage = true;
        totalAbnormalCostPoisha += clawback.abnormalCostPoisha;
        totalVatClawbackPoisha += clawback.vatClawbackPoisha;
      }

      // Lock raw item stock balance
      const balance = await lockBalance(client, input.companyId, ing.raw_item_id, warehouse.id);
      if (balance.quantity < requiredGrossScaled && !input.allowNegativeStock) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `Insufficient stock for raw material ${ing.raw_item_sku} at ${warehouse.code}. Required: ${formatQuantity(requiredGrossScaled)}, Available: ${formatQuantity(balance.quantity)}.`,
        );
      }

      const balanceAfterQuantity = balance.quantity - requiredGrossScaled;
      const balanceAfterValuePoisha =
        balance.valuePoisha > ingCostPoisha ? balance.valuePoisha - ingCostPoisha : 0n;

      rmPlans.push({
        ing,
        requiredGrossScaled,
        ratePoisha,
        ingCostPoisha,
        balanceAfterQuantity,
        balanceAfterValuePoisha,
      });
    }

    // 6. Direct Labor & Overhead absorption (IAS 2 standard allocation)
    const declLabor = BigInt(decl.direct_labor_cost_poisha);
    const declOverhead = BigInt(decl.overhead_cost_poisha);
    const declPackaging = BigInt(decl.packaging_cost_poisha);

    const batchLaborPoisha = divideRoundHalfUp(declLabor * batchQtyScaled, declOutputScaled);
    const batchOverheadPoisha = divideRoundHalfUp(declOverhead * batchQtyScaled, declOutputScaled);
    const batchPackagingPoisha = divideRoundHalfUp(declPackaging * batchQtyScaled, declOutputScaled);
    const absorbedOverheadPoisha = batchLaborPoisha + batchOverheadPoisha + batchPackagingPoisha;

    const totalBatchCostPoisha = totalBatchRmCostPoisha + absorbedOverheadPoisha;
    const unitCostPoisha = divideRoundHalfUp(totalBatchCostPoisha * QUANTITY_SCALE, batchQtyScaled);

    // 7. Lock finished goods stock in warehouse
    const fgBalance = await lockBalance(client, input.companyId, decl.finished_item_id, warehouse.id);
    const fgBalanceAfterQty = fgBalance.quantity + batchQtyScaled;
    const fgBalanceAfterValue = fgBalance.valuePoisha + totalBatchCostPoisha;

    // 8. Ensure manufacturing accounts exist
    const { rawMaterialsAccount, finishedGoodsAccount, absorbedOverheadAccount } =
      await ensureManufacturingAccounts(client, input.companyId);

    // 9. Post balanced General Ledger Journal
    // Invariant: DR 1320 Finished Goods == CR 1310 Raw Materials + CR 5210 Direct Labor & Overhead Absorbed
    const journalLines: Array<{ accountId: string; debit: string; credit: string; memo?: string }> = [
      {
        accountId: finishedGoodsAccount,
        debit: formatPoishaAsBdt(totalBatchCostPoisha),
        credit: '0.00',
        memo: `DR 1320 Finished Goods Inventory — ${decl.finished_item_sku} (${formatQuantity(batchQtyScaled)} ${decl.output_unit})`,
      },
      {
        accountId: rawMaterialsAccount,
        debit: '0.00',
        credit: formatPoishaAsBdt(totalBatchRmCostPoisha),
        memo: `CR 1310 Raw Materials Inventory consumed in batch ${batchNumber}`,
      },
    ];

    if (absorbedOverheadPoisha > 0n) {
      journalLines.push({
        accountId: absorbedOverheadAccount,
        debit: '0.00',
        credit: formatPoishaAsBdt(absorbedOverheadPoisha),
        memo: `CR 5210 Direct Labor & Overhead Absorbed (IAS 2 standard costing)`,
      });
    }

    const orgId = await getCompanyOrgId(client, input.companyId);

    let resolvedSessionId = input.sessionId ?? null;
    if (!resolvedSessionId) {
      const sessRes = await client.query<{ id: string }>(
        `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [input.userId],
      );
      if (sessRes.rows[0]) resolvedSessionId = sessRes.rows[0].id;
    }

    const journal = await postSystemJournalWithinTransaction(client, {
      organisationId: orgId,
      actorUserId: input.userId,
      sessionId: (resolvedSessionId ?? null) as unknown as string,
      ip: input.ip ?? '127.0.0.1',
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? `req-prod-${randomUUID()}`,
      companyId: input.companyId,
      date: input.batchDate,
      narration: `Production Batch ${batchNumber} — Finished Item ${decl.finished_item_sku} (BOM ${decl.declaration_number})`,
      sourceModule: 'MANUFACTURING',
      sourceDocId: batchId,
      sourceDocRef: batchNumber,
      lines: journalLines,
    });

    // 10. Update stock balances and insert stock movements linking journal.id directly
    let movementNo = 1;
    for (const plan of rmPlans) {
      await updateBalance(client, input.companyId, plan.ing.raw_item_id, warehouse.id, {
        quantity: plan.balanceAfterQuantity,
        valuePoisha: plan.balanceAfterValuePoisha,
      });

      await client.query(
        `INSERT INTO stock_movements (
           id, company_id, command_id, movement_no, idempotency_key, movement_type, movement_date,
           item_id, warehouse_id, quantity, unit_cost_poisha, value_poisha, balance_after_quantity,
           balance_after_value_poisha, source_type, source_ref, source_doc_id, journal_id,
           negative_stock_override, override_reason, created_by
         ) VALUES (
           $1,$2,$3,$4,$5,'ISSUE',$6,$7,$8,$9::numeric,$10,$11,$12::numeric,$13,'MANUFACTURING',$14,$15,$16,$17,$18,$19
         )`,
        [
          randomUUID(),
          input.companyId,
          batchId,
          movementNo++,
          input.idempotencyKey,
          input.batchDate,
          plan.ing.raw_item_id,
          warehouse.id,
          formatQuantity(plan.requiredGrossScaled),
          plan.ratePoisha.toString(),
          plan.ingCostPoisha.toString(),
          formatQuantity(plan.balanceAfterQuantity),
          plan.balanceAfterValuePoisha.toString(),
          batchNumber,
          batchId,
          journal.id,
          Boolean(input.allowNegativeStock),
          input.overrideReason ?? null,
          input.userId,
        ],
      );
    }

    // Finished Goods stock balance & movement
    await updateBalance(client, input.companyId, decl.finished_item_id, warehouse.id, {
      quantity: fgBalanceAfterQty,
      valuePoisha: fgBalanceAfterValue,
    });

    await client.query(
      `INSERT INTO stock_movements (
         id, company_id, command_id, movement_no, idempotency_key, movement_type, movement_date,
         item_id, warehouse_id, quantity, unit_cost_poisha, value_poisha, balance_after_quantity,
         balance_after_value_poisha, source_type, source_ref, source_doc_id, journal_id,
         negative_stock_override, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,'GRN_RECEIPT',$6,$7,$8,$9::numeric,$10,$11,$12::numeric,$13,'MANUFACTURING',$14,$15,$16,false,$17
       )`,
      [
        randomUUID(),
        input.companyId,
        batchId,
        movementNo++,
        input.idempotencyKey,
        input.batchDate,
        decl.finished_item_id,
        warehouse.id,
        formatQuantity(batchQtyScaled),
        unitCostPoisha.toString(),
        totalBatchCostPoisha.toString(),
        formatQuantity(fgBalanceAfterQty),
        fgBalanceAfterValue.toString(),
        batchNumber,
        batchId,
        journal.id,
        input.userId,
      ],
    );

    // 10. Persist production batch record
    const clawbackNote = hasAbnormalWastage ? MUSHAK_9_1_NOTE_27_CITATION : null;

    await client.query(
      `INSERT INTO production_batches (
         id, company_id, batch_number, declaration_id, finished_item_id, warehouse_id,
         batch_date, batch_quantity, status, total_rm_cost_poisha, direct_labor_cost_poisha,
         overhead_cost_poisha, packaging_cost_poisha, total_cost_poisha, unit_cost_poisha,
         has_abnormal_wastage, abnormal_wastage_cost_poisha, vat_rebate_clawback_poisha,
         clawback_note, journal_id, executed_by, executed_at, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::date,$8::numeric,'COMPLETED',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),$21
       )`,
      [
        batchId,
        input.companyId,
        batchNumber,
        input.declarationId,
        decl.finished_item_id,
        warehouse.id,
        input.batchDate,
        formatQuantity(batchQtyScaled),
        totalBatchRmCostPoisha.toString(),
        batchLaborPoisha.toString(),
        batchOverheadPoisha.toString(),
        batchPackagingPoisha.toString(),
        totalBatchCostPoisha.toString(),
        unitCostPoisha.toString(),
        hasAbnormalWastage,
        totalAbnormalCostPoisha.toString(),
        totalVatClawbackPoisha.toString(),
        clawbackNote,
        journal.id,
        input.userId,
        input.notes ?? null,
      ],
    );

    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'manufacturing.batch_executed',
      entityType: 'production_batches',
      entityId: batchId,
      after: {
        batchNumber,
        finishedItemSku: decl.finished_item_sku,
        batchQuantity: formatQuantity(batchQtyScaled),
        totalCostPoisha: totalBatchCostPoisha.toString(),
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        hasAbnormalWastage,
        vatRebateClawbackPoisha: totalVatClawbackPoisha.toString(),
      },
    });

    const fullBatch = await getProductionBatch(client, input.companyId, batchId);
    return {
      batch: fullBatch!,
      journalId: journal.id,
      journalNumber: journal.journalNumber ?? '',
      replayed: false,
    };
  });
}

export async function listProductionBatches(
  database: Queryable,
  companyId: string,
  options: { finishedItemId?: string; status?: string; page?: number; pageSize?: number } = {},
): Promise<{ batches: ProductionBatchDto[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const conditions = ['b.company_id = $1'];
  const values: any[] = [companyId];

  if (options.finishedItemId) {
    values.push(options.finishedItemId);
    conditions.push(`b.finished_item_id = $${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    conditions.push(`b.status = $${values.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM production_batches b WHERE ${whereClause}`,
    values,
  );
  const total = Number(countRes.rows[0]?.total ?? '0');

  const rows = await database.query(
    `SELECT b.*,
            d.declaration_number,
            i.sku AS finished_item_sku,
            i.name_en AS finished_item_name,
            w.code AS warehouse_code,
            w.name_en AS warehouse_name,
            j.journal_number,
            u.name AS executed_by_name
       FROM production_batches b
       JOIN mushak_43_declarations d ON d.company_id = b.company_id AND d.id = b.declaration_id
       JOIN items i ON i.company_id = b.company_id AND i.id = b.finished_item_id
       JOIN warehouses w ON w.company_id = b.company_id AND w.id = b.warehouse_id
       LEFT JOIN journals j ON j.company_id = b.company_id AND j.id = b.journal_id
       LEFT JOIN users u ON u.id = b.executed_by
      WHERE ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  const batches: ProductionBatchDto[] = rows.rows.map((r: any) => {
    const rm = BigInt(r.total_rm_cost_poisha);
    const labor = BigInt(r.direct_labor_cost_poisha);
    const overhead = BigInt(r.overhead_cost_poisha);
    const pack = BigInt(r.packaging_cost_poisha);
    const totalCost = BigInt(r.total_cost_poisha);
    const unitCost = BigInt(r.unit_cost_poisha);
    const abnormalCost = BigInt(r.abnormal_wastage_cost_poisha);
    const clawback = BigInt(r.vat_rebate_clawback_poisha);

    return {
      id: r.id,
      companyId: r.company_id,
      batchNumber: r.batch_number,
      declarationId: r.declaration_id,
      declarationNumber: r.declaration_number,
      finishedItemId: r.finished_item_id,
      finishedItemSku: r.finished_item_sku,
      finishedItemName: r.finished_item_name,
      warehouseId: r.warehouse_id,
      warehouseCode: r.warehouse_code,
      warehouseName: r.warehouse_name,
      batchDate: formatDatabaseDate(r.batch_date),
      batchQuantity: r.batch_quantity,
      status: r.status,
      totalRawMaterialCostPoisha: r.total_rm_cost_poisha,
      totalRawMaterialCostBdt: poishaToBdtString(rm),
      directLaborCostPoisha: r.direct_labor_cost_poisha,
      directLaborCostBdt: poishaToBdtString(labor),
      manufacturingOverheadPoisha: r.overhead_cost_poisha,
      manufacturingOverheadBdt: poishaToBdtString(overhead),
      packagingCostPoisha: r.packaging_cost_poisha,
      packagingCostBdt: poishaToBdtString(pack),
      totalCostPoisha: r.total_cost_poisha,
      totalCostBdt: poishaToBdtString(totalCost),
      unitCostPoisha: r.unit_cost_poisha,
      unitCostBdt: poishaToBdtString(unitCost),
      hasAbnormalWastage: r.has_abnormal_wastage,
      abnormalWastageCostPoisha: r.abnormal_wastage_cost_poisha,
      abnormalWastageCostBdt: poishaToBdtString(abnormalCost),
      vatRebateClawbackPoisha: r.vat_rebate_clawback_poisha,
      vatRebateClawbackBdt: poishaToBdtString(clawback),
      clawbackNote: r.clawback_note,
      journalId: r.journal_id,
      journalNumber: r.journal_number,
      executedBy: r.executed_by,
      executedByName: r.executed_by_name,
      executedAt: r.executed_at ? r.executed_at.toISOString() : null,
      notes: r.notes,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  });

  return { batches, total, page, pageSize };
}

export async function getProductionBatch(
  database: Queryable,
  companyId: string,
  batchId: string,
): Promise<ProductionBatchDto | null> {
  const rowRes = await database.query(
    `SELECT b.*,
            d.declaration_number,
            i.sku AS finished_item_sku,
            i.name_en AS finished_item_name,
            w.code AS warehouse_code,
            w.name_en AS warehouse_name,
            j.journal_number,
            u.name AS executed_by_name
       FROM production_batches b
       JOIN mushak_43_declarations d ON d.company_id = b.company_id AND d.id = b.declaration_id
       JOIN items i ON i.company_id = b.company_id AND i.id = b.finished_item_id
       JOIN warehouses w ON w.company_id = b.company_id AND w.id = b.warehouse_id
       LEFT JOIN journals j ON j.company_id = b.company_id AND j.id = b.journal_id
       LEFT JOIN users u ON u.id = b.executed_by
      WHERE b.company_id = $1 AND b.id = $2`,
    [companyId, batchId],
  );
  const r = rowRes.rows[0];
  if (!r) return null;

  const rm = BigInt(r.total_rm_cost_poisha);
  const labor = BigInt(r.direct_labor_cost_poisha);
  const overhead = BigInt(r.overhead_cost_poisha);
  const pack = BigInt(r.packaging_cost_poisha);
  const totalCost = BigInt(r.total_cost_poisha);
  const unitCost = BigInt(r.unit_cost_poisha);
  const abnormalCost = BigInt(r.abnormal_wastage_cost_poisha);
  const clawback = BigInt(r.vat_rebate_clawback_poisha);

  return {
    id: r.id,
    companyId: r.company_id,
    batchNumber: r.batch_number,
    declarationId: r.declaration_id,
    declarationNumber: r.declaration_number,
    finishedItemId: r.finished_item_id,
    finishedItemSku: r.finished_item_sku,
    finishedItemName: r.finished_item_name,
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    warehouseName: r.warehouse_name,
    batchDate: formatDatabaseDate(r.batch_date),
    batchQuantity: r.batch_quantity,
    status: r.status,
    totalRawMaterialCostPoisha: r.total_rm_cost_poisha,
    totalRawMaterialCostBdt: poishaToBdtString(rm),
    directLaborCostPoisha: r.direct_labor_cost_poisha,
    directLaborCostBdt: poishaToBdtString(labor),
    manufacturingOverheadPoisha: r.overhead_cost_poisha,
    manufacturingOverheadBdt: poishaToBdtString(overhead),
    packagingCostPoisha: r.packaging_cost_poisha,
    packagingCostBdt: poishaToBdtString(pack),
    totalCostPoisha: r.total_cost_poisha,
    totalCostBdt: poishaToBdtString(totalCost),
    unitCostPoisha: r.unit_cost_poisha,
    unitCostBdt: poishaToBdtString(unitCost),
    hasAbnormalWastage: r.has_abnormal_wastage,
    abnormalWastageCostPoisha: r.abnormal_wastage_cost_poisha,
    abnormalWastageCostBdt: poishaToBdtString(abnormalCost),
    vatRebateClawbackPoisha: r.vat_rebate_clawback_poisha,
    vatRebateClawbackBdt: poishaToBdtString(clawback),
    clawbackNote: r.clawback_note,
    journalId: r.journal_id,
    journalNumber: r.journal_number,
    executedBy: r.executed_by,
    executedByName: r.executed_by_name,
    executedAt: r.executed_at ? r.executed_at.toISOString() : null,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
