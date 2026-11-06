import { apiRequest } from '../auth/api';

export type MasterStatus = 'ACTIVE' | 'INACTIVE';
export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
export type PartyOpeningDocumentType = 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_BILL' | 'EXPENSE_VOUCHER';

export interface Party {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  type: PartyType;
  bin: string | null;
  tin: string | null;
  addressEn: string | null;
  addressBn: string | null;
  phone: string | null;
  email: string | null;
  creditDays: number;
  creditLimitPoisha: string;
  creditLimitBdt: string;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PartyWriteInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  type: PartyType;
  bin?: string | null;
  tin?: string | null;
  addressEn?: string | null;
  addressBn?: string | null;
  phone?: string | null;
  email?: string | null;
  creditDays: number;
  creditLimit: string;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
}

export interface PartyOpeningItem {
  id: string;
  companyId: string;
  partyId: string;
  documentType: PartyOpeningDocumentType;
  documentNo: string;
  dueDate: string;
  amountPoisha: string;
  amountBdt: string;
  basePoisha: string | null;
  baseBdt: string | null;
  memo: string | null;
  status: 'OPEN' | 'CANCELLED';
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  companyId: string;
  sku: string;
  hsCode: string | null;
  nameEn: string;
  nameBn: string | null;
  unit: string;
  unitBn: string | null;
  isStockItem: boolean;
  defaultTaxCategory: string;
  inventoryAccountId: string | null;
  inventoryAccountCode: string | null;
  inventoryAccountName: string | null;
  expenseAccountId: string | null;
  expenseAccountCode: string | null;
  expenseAccountName: string | null;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ItemWriteInput {
  sku: string;
  hsCode?: string | null;
  nameEn: string;
  nameBn?: string | null;
  unit: string;
  unitBn?: string | null;
  isStockItem: boolean;
  defaultTaxCategory: string;
  inventoryAccountId?: string | null;
  expenseAccountId?: string | null;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
  bin: string | null;
  isPrincipal: boolean;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BranchWriteInput {
  code: string;
  nameEn: string;
  nameBn?: string | null;
  address?: string | null;
  bin?: string | null;
  isPrincipal: boolean;
}

export interface Warehouse {
  id: string;
  companyId: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  code: string;
  nameEn: string;
  nameBn: string | null;
  address: string | null;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseWriteInput {
  branchId?: string | null;
  code: string;
  nameEn: string;
  nameBn?: string | null;
  address?: string | null;
}

export interface PageResult<T> {
  total: number;
  page: number;
  pageSize: number;
  entries: T[];
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

export const masterApi = {
  parties: (
    companyId: string,
    options: { search?: string; type?: PartyType; includeInactive?: boolean; page?: number; pageSize?: number } = {},
  ) =>
    apiRequest<{ parties: Party[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/parties${queryString({
        search: options.search,
        type: options.type,
        includeInactive: options.includeInactive ? 'true' : undefined,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),
  createParty: (companyId: string, input: PartyWriteInput) =>
    apiRequest<{ party: Party }>(`/companies/${companyId}/parties`, { method: 'POST', body: input }),
  updateParty: (companyId: string, partyId: string, input: PartyWriteInput) =>
    apiRequest<{ party: Party }>(`/companies/${companyId}/parties/${partyId}`, { method: 'PATCH', body: input }),
  deactivateParty: (companyId: string, partyId: string, reason: string) =>
    apiRequest<{ party: Party }>(`/companies/${companyId}/parties/${partyId}/deactivate`, {
      method: 'POST',
      body: { reason },
    }),
  reactivateParty: (companyId: string, partyId: string, reason: string) =>
    apiRequest<{ party: Party }>(`/companies/${companyId}/parties/${partyId}/reactivate`, {
      method: 'POST',
      body: { reason },
    }),
  openingItems: (companyId: string, partyId: string, includeCancelled = false) =>
    apiRequest<{ items: PartyOpeningItem[] }>(
      `/companies/${companyId}/parties/${partyId}/opening-items${queryString({
        includeCancelled: includeCancelled ? 'true' : undefined,
      })}`,
    ),
  createOpeningItem: (
    companyId: string,
    partyId: string,
    input: {
      documentType: PartyOpeningDocumentType;
      documentNo: string;
      dueDate: string;
      amount: string;
      base?: string | null;
      memo?: string | null;
    },
  ) =>
    apiRequest<{ item: PartyOpeningItem }>(`/companies/${companyId}/parties/${partyId}/opening-items`, {
      method: 'POST',
      body: input,
    }),
  cancelOpeningItem: (companyId: string, partyId: string, itemId: string, reason: string) =>
    apiRequest<{ item: PartyOpeningItem }>(
      `/companies/${companyId}/parties/${partyId}/opening-items/${itemId}/cancel`,
      { method: 'POST', body: { reason } },
    ),
  items: (
    companyId: string,
    options: { search?: string; includeInactive?: boolean; stockOnly?: boolean; page?: number; pageSize?: number } = {},
  ) =>
    apiRequest<{ items: Item[]; total: number; page: number; pageSize: number }>(
      `/companies/${companyId}/items${queryString({
        search: options.search,
        includeInactive: options.includeInactive ? 'true' : undefined,
        stockOnly: options.stockOnly ? 'true' : undefined,
        page: options.page,
        pageSize: options.pageSize,
      })}`,
    ),
  createItem: (companyId: string, input: ItemWriteInput) =>
    apiRequest<{ item: Item }>(`/companies/${companyId}/items`, { method: 'POST', body: input }),
  updateItem: (companyId: string, itemId: string, input: ItemWriteInput) =>
    apiRequest<{ item: Item }>(`/companies/${companyId}/items/${itemId}`, { method: 'PATCH', body: input }),
  deactivateItem: (companyId: string, itemId: string, reason: string) =>
    apiRequest<{ item: Item }>(`/companies/${companyId}/items/${itemId}/deactivate`, {
      method: 'POST',
      body: { reason },
    }),
  reactivateItem: (companyId: string, itemId: string, reason: string) =>
    apiRequest<{ item: Item }>(`/companies/${companyId}/items/${itemId}/reactivate`, {
      method: 'POST',
      body: { reason },
    }),
  branches: (companyId: string, includeInactive = false) =>
    apiRequest<{ branches: Branch[] }>(
      `/companies/${companyId}/branches${queryString({ includeInactive: includeInactive ? 'true' : undefined })}`,
    ),
  createBranch: (companyId: string, input: BranchWriteInput) =>
    apiRequest<{ branch: Branch }>(`/companies/${companyId}/branches`, { method: 'POST', body: input }),
  updateBranch: (companyId: string, branchId: string, input: BranchWriteInput) =>
    apiRequest<{ branch: Branch }>(`/companies/${companyId}/branches/${branchId}`, {
      method: 'PATCH',
      body: input,
    }),
  deactivateBranch: (companyId: string, branchId: string, reason: string) =>
    apiRequest<{ branch: Branch }>(`/companies/${companyId}/branches/${branchId}/deactivate`, {
      method: 'POST',
      body: { reason },
    }),
  reactivateBranch: (companyId: string, branchId: string, reason: string) =>
    apiRequest<{ branch: Branch }>(`/companies/${companyId}/branches/${branchId}/reactivate`, {
      method: 'POST',
      body: { reason },
    }),
  warehouses: (companyId: string, options: { includeInactive?: boolean; branchId?: string } = {}) =>
    apiRequest<{ warehouses: Warehouse[] }>(
      `/companies/${companyId}/warehouses${queryString({
        includeInactive: options.includeInactive ? 'true' : undefined,
        branchId: options.branchId,
      })}`,
    ),
  createWarehouse: (companyId: string, input: WarehouseWriteInput) =>
    apiRequest<{ warehouse: Warehouse }>(`/companies/${companyId}/warehouses`, { method: 'POST', body: input }),
  updateWarehouse: (companyId: string, warehouseId: string, input: WarehouseWriteInput) =>
    apiRequest<{ warehouse: Warehouse }>(`/companies/${companyId}/warehouses/${warehouseId}`, {
      method: 'PATCH',
      body: input,
    }),
  deactivateWarehouse: (companyId: string, warehouseId: string, reason: string) =>
    apiRequest<{ warehouse: Warehouse }>(`/companies/${companyId}/warehouses/${warehouseId}/deactivate`, {
      method: 'POST',
      body: { reason },
    }),
  reactivateWarehouse: (companyId: string, warehouseId: string, reason: string) =>
    apiRequest<{ warehouse: Warehouse }>(`/companies/${companyId}/warehouses/${warehouseId}/reactivate`, {
      method: 'POST',
      body: { reason },
    }),
};
