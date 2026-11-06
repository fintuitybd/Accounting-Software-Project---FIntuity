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
};
