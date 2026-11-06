import type { Branch, Item, Party, Warehouse } from '../../masters/api';
import type { BankAccount, SetupAccount } from '../../setup/api';

export interface PurchaseRefs {
  suppliers: Party[];
  items: Item[];
  branches: Branch[];
  warehouses: Warehouse[];
  accounts: SetupAccount[];
  bankAccounts: BankAccount[];
}
