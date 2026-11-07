import { apiRequest } from '../auth/api';

export type StockCommandType =
  | 'OPENING'
  | 'GRN'
  | 'ISSUE'
  | 'RETURN'
  | 'TRANSFER'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

export interface StockMovement {
  id: string;
  companyId: string;
  commandId: string;
  movementNo: number;
  movementType: string;
  movementDate: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  unitCostPoisha: string;
  unitCostBdt: string;
  valuePoisha: string;
  valueBdt: string;
  balanceAfterQuantity: string;
  balanceAfterValuePoisha: string;
  balanceAfterValueBdt: string;
  sourceType: string;
  sourceRef: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalOfMovementId: string | null;
  reversalReason: string | null;
  isReversed: boolean;
  negativeStockOverride: boolean;
  overrideReason: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface StockCommandResult {
  commandId: string;
  replayed: boolean;
  movements: StockMovement[];
}

export interface StockBalance {
  companyId: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  unit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: string;
  valuePoisha: string;
  valueBdt: string;
  weightedUnitCostBdt: string;
  updatedAt: string;
}

export interface InventoryControlAccount {
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  stockValuePoisha: string;
  stockValueBdt: string;
  glBalancePoisha: string;
  glBalanceBdt: string;
  differencePoisha: string;
  differenceBdt: string;
  itemCount: number;
}

export interface InventoryControlItem {
  itemId: string;
  sku: string;
  nameEn: string;
  unit: string;
  inventoryAccountId: string;
  inventoryAccountCode: string;
  quantity: string;
  valuePoisha: string;
  valueBdt: string;
  warehouses: Array<{ warehouseId: string; warehouseCode: string; quantity: string; valuePoisha: string }>;
}

export interface InventoryControlProof {
  asOfDate: string;
  accounts: InventoryControlAccount[];
  items: InventoryControlItem[];
  differences: InventoryControlAccount[];
}

export interface StockCommandInput {
  type: StockCommandType;
  itemId: string;
  date: string;
  quantity: string;
  sourceRef?: string | null;
  warehouseId?: string | null;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  unitCost?: string | null;
  offsetAccountId?: string | null;
  allowNegativeStock?: boolean;
  overrideReason?: string | null;
  reason?: string | null;
}

export interface Mushak43Ingredient {
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

export interface Mushak43Declaration {
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
  ingredients: Mushak43Ingredient[];
}

export interface ProductionBatch {
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

export interface CreateMushak43Input {
  declarationNumber?: string | null;
  finishedItemId: string;
  outputQuantity: string;
  outputUnit: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  nbrDivisionOffice?: string | null;
  directLaborCostPoisha?: string | number;
  manufacturingOverheadPoisha?: string | number;
  packagingCostPoisha?: string | number;
  targetProfitMarginBps?: number;
  declaredRetailPricePoisha?: string | number | null;
  ingredients: Array<{
    rawItemId: string;
    netQuantity: string;
    wastageBps: number;
    unit: string;
    ratePerUnitPoisha: string | number;
    rebatableInputVat?: boolean;
  }>;
}

export interface ExecuteBatchInput {
  declarationId: string;
  warehouseId: string;
  batchQuantity: string;
  batchDate: string;
  batchNumber?: string | null;
  notes?: string | null;
  allowNegativeStock?: boolean;
  overrideReason?: string | null;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const inventoryApi = {
  balances: (
    companyId: string,
    options: {
      search?: string;
      warehouseId?: string;
      includeZero?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiRequest<{ balances: StockBalance[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/inventory/balances${queryString({
        search: options.search,
        warehouseId: options.warehouseId,
        includeZero: options.includeZero ? 'true' : undefined,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),
  movements: (
    companyId: string,
    options: {
      itemId?: string;
      warehouseId?: string;
      movementType?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiRequest<{ movements: StockMovement[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/inventory/movements${queryString({
        itemId: options.itemId,
        warehouseId: options.warehouseId,
        movementType: options.movementType,
        from: options.from,
        to: options.to,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),
  controlProof: (companyId: string, asOf?: string) =>
    apiRequest<{ proof: InventoryControlProof }>(
      `/companies/${companyId}/inventory/control-proof${queryString({ asOf })}`,
    ),
  postCommand: (companyId: string, input: StockCommandInput, idempotencyKey: string) =>
    apiRequest<StockCommandResult>(`/companies/${companyId}/inventory/movements`, {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  reverseCommand: (
    companyId: string,
    commandId: string,
    input: { date: string; reason: string; overrideReason?: string | null },
    idempotencyKey: string,
  ) =>
    apiRequest<StockCommandResult>(`/companies/${companyId}/inventory/commands/${commandId}/reverse`, {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  // Mushak 4.3 Declarations
  mushak43List: (
    companyId: string,
    options: { finishedItemId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) =>
    apiRequest<{ declarations: Mushak43Declaration[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/inventory/mushak-43${queryString({
        finishedItemId: options.finishedItemId,
        status: options.status,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),

  mushak43Get: (companyId: string, declarationId: string) =>
    apiRequest<{ declaration: Mushak43Declaration }>(
      `/companies/${companyId}/inventory/mushak-43/${declarationId}`,
    ),

  mushak43Create: (companyId: string, input: CreateMushak43Input) =>
    apiRequest<{ declaration: Mushak43Declaration }>(`/companies/${companyId}/inventory/mushak-43`, {
      method: 'POST',
      body: input,
    }),

  mushak43SubmitNbr: (
    companyId: string,
    declarationId: string,
    input: { nbrSubmissionDate?: string; nbrDivisionOffice?: string | null; approveImmediately?: boolean } = {},
  ) =>
    apiRequest<{ declaration: Mushak43Declaration }>(
      `/companies/${companyId}/inventory/mushak-43/${declarationId}/submit-nbr`,
      {
        method: 'POST',
        body: input,
      },
    ),

  // Production Batches
  productionBatches: (
    companyId: string,
    options: { finishedItemId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) =>
    apiRequest<{ batches: ProductionBatch[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/inventory/production-batches${queryString({
        finishedItemId: options.finishedItemId,
        status: options.status,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),

  productionBatchGet: (companyId: string, batchId: string) =>
    apiRequest<{ batch: ProductionBatch }>(
      `/companies/${companyId}/inventory/production-batches/${batchId}`,
    ),

  executeBatch: (companyId: string, input: ExecuteBatchInput, idempotencyKey: string) =>
    apiRequest<{ batch: ProductionBatch; journalId: string; journalNumber: string; replayed: boolean }>(
      `/companies/${companyId}/inventory/production-batches`,
      {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    ),
};
