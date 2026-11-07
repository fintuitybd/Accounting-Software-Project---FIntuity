// Fintuity Accounting Suite — master data workbench.
//
// One focused modal, three masters: the chart of accounts, customers & suppliers, and inventory
// items with live stock valuation. This file only renders the forms — every mutation is permission
// checked again inside VaultContext (`MANAGE_MASTERS_AND_COA`) before it touches the vault.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Boxes,
  CircleAlert,
  Database,
  Landmark,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';

import { localized } from '../../core/i18n';
import { isValidBin, isValidTin } from '../../core/tax-engine/engine';
import type {
  Account,
  AccountSubCategory,
  AccountType,
  InventoryItem,
  Party,
  PartyType,
  TaxCategory,
} from '../../core/types';
import { useVault, type AccountDraft, type ItemDraft, type PartyDraft } from '../../context/VaultContext';

export type MasterDataTab = 'accounts' | 'parties' | 'items';

export interface MasterDataModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: MasterDataTab;
}

const ACCOUNT_TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const ACCOUNT_TYPE_LABELS: Record<AccountType, [string, string]> = {
  ASSET: ['Asset', 'সম্পদ'],
  LIABILITY: ['Liability', 'দায়'],
  EQUITY: ['Equity', 'ইকুইটি'],
  REVENUE: ['Revenue', 'আয়'],
  EXPENSE: ['Expense', 'ব্যয়'],
};

const SUB_CATEGORY_LABELS: Record<AccountSubCategory, [string, string]> = {
  CURRENT_ASSET: ['Current asset', 'চলতি সম্পদ'],
  NON_CURRENT_ASSET: ['Non-current asset', 'অচলতি সম্পদ'],
  CURRENT_LIABILITY: ['Current liability', 'চলতি দায়'],
  NON_CURRENT_LIABILITY: ['Non-current liability', 'অচলতি দায়'],
  EQUITY_CAPITAL: ['Equity capital', 'ইকুইটি মূলধন'],
  EQUITY_RESERVES: ['Equity reserves', 'ইকুইটি রিজার্ভ'],
  OPERATING_REVENUE: ['Operating revenue', 'পরিচালন আয়'],
  COST_OF_SALES: ['Cost of sales', 'বিক্রয় ব্যয়'],
  OPERATING_EXPENSE: ['Operating expense', 'পরিচালন ব্যয়'],
  FINANCE_COST: ['Finance cost', 'অর্থায়ন ব্যয়'],
  INVESTING_INCOME: ['Investing income', 'বিনিয়োগ আয়'],
  TAX_EXPENSE: ['Tax expense', 'কর ব্যয়'],
};

const SUB_CATEGORIES: Record<AccountType, AccountSubCategory[]> = {
  ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'],
  LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'],
  EQUITY: ['EQUITY_CAPITAL', 'EQUITY_RESERVES'],
  REVENUE: ['OPERATING_REVENUE', 'INVESTING_INCOME'],
  EXPENSE: ['COST_OF_SALES', 'OPERATING_EXPENSE', 'FINANCE_COST', 'TAX_EXPENSE'],
};

const PARTY_TYPE_LABELS: Record<PartyType, [string, string]> = {
  CUSTOMER: ['Customer', 'গ্রাহক'],
  SUPPLIER: ['Supplier', 'সরবরাহকারী'],
  BOTH: ['Customer & supplier', 'গ্রাহক ও সরবরাহকারী'],
};

const TAX_CATEGORY_LABELS: Record<TaxCategory, [string, string]> = {
  STANDARD_15: ['Standard 15%', 'আদর্শ ১৫%'],
  TRADING_5: ['Trading 5%', 'বাণিজ্যিক ৫%'],
  PROCUREMENT_7_5: ['Procurement 7.5%', 'ক্রয় ৭.৫%'],
  EXPORT_ZERO: ['Export zero-rated', 'রপ্তানি শূন্য-হার'],
  EXEMPT: ['Exempt', 'মুক্ত'],
  REVERSE_CHARGE: ['Reverse charge', 'রিভার্স চার্জ'],
  OUT_OF_SCOPE: ['Out of scope', 'পরিধির বাইরে'],
};

const TAX_CATEGORY_ORDER: TaxCategory[] = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
];

interface AccountForm {
  code: string;
  name_en: string;
  name_bn: string;
  account_type: AccountType;
  sub_category: AccountSubCategory;
  opening_debit_text: string;
  opening_credit_text: string;
  is_active: boolean;
}

interface PartyForm {
  id?: string;
  code: string;
  name_en: string;
  name_bn: string;
  type: PartyType;
  bin: string;
  tin: string;
  mobile: string;
  email: string;
  address_en: string;
  address_bn: string;
  credit_days_text: string;
  is_withholding_buyer: boolean;
  is_government: boolean;
  is_active: boolean;
}

interface ItemForm {
  id?: string;
  sku: string;
  hs_code: string;
  name_en: string;
  name_bn: string;
  unit_en: string;
  unit_bn: string;
  unit_price_text: string;
  unit_cost_text: string;
  qty_on_hand_text: string;
  tax_category: TaxCategory;
  inventory_account: string;
  is_stock_item: boolean;
}

function emptyAccountForm(): AccountForm {
  return {
    code: '',
    name_en: '',
    name_bn: '',
    account_type: 'ASSET',
    sub_category: 'CURRENT_ASSET',
    opening_debit_text: '',
    opening_credit_text: '',
    is_active: true,
  };
}

function emptyPartyForm(): PartyForm {
  return {
    code: '',
    name_en: '',
    name_bn: '',
    type: 'CUSTOMER',
    bin: '',
    tin: '',
    mobile: '',
    email: '',
    address_en: '',
    address_bn: '',
    credit_days_text: '15',
    is_withholding_buyer: false,
    is_government: false,
    is_active: true,
  };
}

function emptyItemForm(): ItemForm {
  return {
    sku: '',
    hs_code: '',
    name_en: '',
    name_bn: '',
    unit_en: 'pcs',
    unit_bn: 'পিস',
    unit_price_text: '',
    unit_cost_text: '',
    qty_on_hand_text: '100',
    tax_category: 'STANDARD_15',
    inventory_account: '1310',
    is_stock_item: true,
  };
}

function accountToForm(account: Account): AccountForm {
  return {
    code: account.code,
    name_en: account.name_en,
    name_bn: account.name_bn,
    account_type: account.account_type,
    sub_category: account.sub_category,
    opening_debit_text: account.opening_debit_poisha > 0n ? poishaToText(account.opening_debit_poisha) : '',
    opening_credit_text: account.opening_credit_poisha > 0n ? poishaToText(account.opening_credit_poisha) : '',
    is_active: account.is_active,
  };
}

function partyToForm(party: Party): PartyForm {
  return {
    id: party.id,
    code: party.code,
    name_en: party.name_en,
    name_bn: party.name_bn,
    type: party.type,
    bin: party.bin ?? '',
    tin: party.tin ?? '',
    mobile: party.mobile,
    email: party.email,
    address_en: party.address_en,
    address_bn: party.address_bn,
    credit_days_text: String(party.credit_days),
    is_withholding_buyer: party.is_withholding_buyer,
    is_government: party.is_government,
    is_active: party.is_active,
  };
}

function itemToForm(item: InventoryItem): ItemForm {
  return {
    id: item.id,
    sku: item.sku,
    hs_code: item.hs_code ?? '',
    name_en: item.name_en,
    name_bn: item.name_bn,
    unit_en: item.unit_en,
    unit_bn: item.unit_bn,
    unit_price_text: poishaToText(item.unit_price_poisha),
    unit_cost_text: item.unit_cost_poisha !== undefined ? poishaToText(item.unit_cost_poisha) : '',
    qty_on_hand_text: item.qty_on_hand !== undefined ? formatQty(item.qty_on_hand) : '100',
    tax_category: item.tax_category,
    inventory_account: item.inventory_account,
    is_stock_item: item.is_stock_item !== false,
  };
}

function parsePoisha(text: string): bigint | null {
  const cleaned = text
    .replace(/[৳,\s]/g, '')
    .replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  if (!cleaned) return 0n;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.') return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
}

function poishaToText(value: bigint | undefined): string {
  if (value === undefined) return '';
  const whole = value / 100n;
  const fraction = value % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function stockValuePoisha(qty: number, unitCost: bigint | undefined): bigint {
  if (!unitCost || qty <= 0) return 0n;
  return (BigInt(Math.round(qty * 100)) * unitCost) / 100n;
}

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="ql-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[9px] leading-snug text-ink-400">{hint}</span> : null}
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
      <CircleAlert size={13} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  note: string;
  tone: 'emerald' | 'gold' | 'ink';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'gold'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'bg-ink-100 text-ink-600 dark:bg-white/[0.06] dark:text-ink-300';
  return (
    <div className="ql-card flex items-center gap-3 px-3.5 py-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${toneClass}`}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</p>
        <p className="mt-0.5 truncate text-[16px] font-semibold leading-none text-ink-900">{value}</p>
        <p className="mt-1 truncate text-[9.5px] text-ink-400">{note}</p>
      </div>
    </div>
  );
}

export function MasterDataModal({ open, onClose, initialTab = 'accounts' }: MasterDataModalProps) {
  const vault = useVault();
  const { locale, accounts, parties, items, hasPermission, upsertAccount, upsertParty, upsertItem, money } = vault;
  const canManage = hasPermission('MANAGE_MASTERS_AND_COA');
  const isBn = locale === 'bn-BD';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);

  const [tab, setTab] = useState<MasterDataTab>(initialTab);
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [partyForm, setPartyForm] = useState<PartyForm>(emptyPartyForm);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const resetAccount = useCallback(() => {
    setEditingAccount(null);
    setAccountForm(emptyAccountForm());
    setFormError(null);
  }, []);

  const resetParty = useCallback(() => {
    setEditingParty(null);
    setPartyForm(emptyPartyForm());
    setFormError(null);
  }, []);

  const resetItem = useCallback(() => {
    setEditingItem(null);
    setItemForm(emptyItemForm());
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setQuery('');
    setFormError(null);
    resetAccount();
    resetParty();
    resetItem();
  }, [open, initialTab, resetAccount, resetParty, resetItem]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredAccounts = useMemo(
    () =>
      accounts.filter((account) =>
        `${account.code} ${account.name_en} ${account.name_bn} ${account.account_type} ${account.sub_category}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [accounts, normalizedQuery],
  );

  const filteredParties = useMemo(
    () =>
      parties.filter((party) =>
        `${party.code} ${party.name_en} ${party.name_bn} ${party.type} ${party.bin ?? ''} ${party.tin ?? ''}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [parties, normalizedQuery],
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        `${item.sku} ${item.hs_code ?? ''} ${item.name_en} ${item.name_bn} ${item.tax_category}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [items, normalizedQuery],
  );

  const stockItems = useMemo(() => items.filter((item) => item.is_stock_item !== false), [items]);
  const totalStockQty = stockItems.reduce((total, item) => total + (item.qty_on_hand ?? 0), 0);
  const totalStockValue = stockItems.reduce(
    (total, item) => total + stockValuePoisha(item.qty_on_hand ?? 0, item.unit_cost_poisha),
    0n,
  );
  const lowStockCount = stockItems.filter((item) => (item.qty_on_hand ?? 0) <= 10).length;

  const selectTab = (next: MasterDataTab): void => {
    setTab(next);
    setQuery('');
    setFormError(null);
  };

  const editAccount = (account: Account): void => {
    setEditingAccount(account.code);
    setAccountForm(accountToForm(account));
    setFormError(null);
  };

  const editParty = (party: Party): void => {
    setEditingParty(party.id);
    setPartyForm(partyToForm(party));
    setFormError(null);
  };

  const editItem = (item: InventoryItem): void => {
    setEditingItem(item.id);
    setItemForm(itemToForm(item));
    setFormError(null);
  };

  const submitAccount = (): void => {
    setFormError(null);
    if (!canManage) {
      setFormError(L('Read-only: MANAGE_MASTERS_AND_COA is required.', 'শুধুমাত্র পাঠযোগ্য: MANAGE_MASTERS_AND_COA প্রয়োজন।'));
      return;
    }
    const code = accountForm.code.trim();
    const nameEn = accountForm.name_en.trim();
    if (!/^\d{4}$/.test(code)) {
      setFormError(L('Enter a four-digit GL account code (e.g. 1310).', 'চার-সংখ্যার জিএল হিসাব কোড লিখুন (যেমন ১৩১০)।'));
      return;
    }
    if (!nameEn) {
      setFormError(L('An account name is required.', 'হিসাবের নাম আবশ্যক।'));
      return;
    }
    const openingDebit = parsePoisha(accountForm.opening_debit_text);
    const openingCredit = parsePoisha(accountForm.opening_credit_text);
    if (openingDebit === null || openingCredit === null) {
      setFormError(L('Opening balances must be valid BDT amounts.', 'প্রারম্ভিক স্থিতি বৈধ টাকার অঙ্ক হতে হবে।'));
      return;
    }
    if (openingDebit > 0n && openingCredit > 0n) {
      setFormError(L('Use either an opening debit or an opening credit, not both.', 'প্রারম্ভিক ডেবিট বা ক্রেডিট যেকোনো একটি দিন, দুটো নয়।'));
      return;
    }
    const draft: AccountDraft = {
      code,
      name_en: nameEn,
      name_bn: accountForm.name_bn.trim() || nameEn,
      account_type: accountForm.account_type,
      sub_category: accountForm.sub_category,
      opening_debit_poisha: openingDebit,
      opening_credit_poisha: openingCredit,
      is_active: accountForm.is_active,
    };
    const result = upsertAccount(draft);
    if (!result.ok) {
      setFormError(result.error ?? L('The account could not be saved.', 'হিসাব সংরক্ষণ করা যায়নি।'));
      return;
    }
    resetAccount();
  };

  const submitParty = (): void => {
    setFormError(null);
    if (!canManage) {
      setFormError(L('Read-only: MANAGE_MASTERS_AND_COA is required.', 'শুধুমাত্র পাঠযোগ্য: MANAGE_MASTERS_AND_COA প্রয়োজন।'));
      return;
    }
    const nameEn = partyForm.name_en.trim();
    if (!nameEn) {
      setFormError(L('A party name is required.', 'পক্ষের নাম আবশ্যক।'));
      return;
    }
    const bin = partyForm.bin.trim();
    const tin = partyForm.tin.trim();
    if (bin && !isValidBin(bin)) {
      setFormError(L('BIN must be a valid 13-digit Bangladesh BIN.', 'বিআইএন অবশ্যই বৈধ ১৩-সংখ্যার বাংলাদেশ বিআইএন হতে হবে।'));
      return;
    }
    if (tin && !isValidTin(tin)) {
      setFormError(L('e-TIN must be a valid 12-digit NBR e-TIN.', 'ই-টিআইএন অবশ্যই বৈধ ১২-সংখ্যার এনবিআর ই-টিআইএন হতে হবে।'));
      return;
    }
    const creditDays = Number(partyForm.credit_days_text);
    if (!Number.isFinite(creditDays) || creditDays < 0 || creditDays > 365) {
      setFormError(L('Credit days must be between 0 and 365.', 'ক্রেডিট দিন ০ থেকে ৩৬৫-এর মধ্যে হতে হবে।'));
      return;
    }
    const draft: PartyDraft = {
      id: partyForm.id,
      code: partyForm.code.trim() || undefined,
      name_en: nameEn,
      name_bn: partyForm.name_bn.trim() || nameEn,
      type: partyForm.type,
      bin,
      tin,
      address_en: partyForm.address_en.trim(),
      address_bn: partyForm.address_bn.trim() || partyForm.address_en.trim(),
      mobile: partyForm.mobile.trim(),
      email: partyForm.email.trim(),
      is_withholding_buyer: partyForm.is_withholding_buyer,
      is_government: partyForm.is_government,
      credit_days: Math.round(creditDays),
      is_active: partyForm.is_active,
    };
    const result = upsertParty(draft);
    if (!result.ok) {
      setFormError(result.error ?? L('The party could not be saved.', 'পক্ষ সংরক্ষণ করা যায়নি।'));
      return;
    }
    resetParty();
  };

  const submitItem = (): void => {
    setFormError(null);
    if (!canManage) {
      setFormError(L('Read-only: MANAGE_MASTERS_AND_COA is required.', 'শুধুমাত্র পাঠযোগ্য: MANAGE_MASTERS_AND_COA প্রয়োজন।'));
      return;
    }
    const nameEn = itemForm.name_en.trim();
    const sku = itemForm.sku.trim();
    if (!nameEn) {
      setFormError(L('An item name is required.', 'আইটেমের নাম আবশ্যক।'));
      return;
    }
    if (!sku) {
      setFormError(L('A SKU / HS code link is required.', 'এসকেইউ / এইচএস কোড আবশ্যক।'));
      return;
    }
    if (
      items.some(
        (entry) => entry.sku.trim().toLowerCase() === sku.toLowerCase() && entry.id !== itemForm.id,
      )
    ) {
      setFormError(L('That SKU already belongs to another item.', 'এই এসকেইউ ইতিমধ্যে অন্য আইটেমের।'));
      return;
    }
    const unitPrice = parsePoisha(itemForm.unit_price_text);
    if (unitPrice === null || unitPrice <= 0n) {
      setFormError(L('Enter a selling price greater than zero.', 'শূন্যের বেশি বিক্রয়মূল্য লিখুন।'));
      return;
    }
    const unitCost = itemForm.unit_cost_text.trim()
      ? parsePoisha(itemForm.unit_cost_text)
      : (unitPrice * 7000n) / 10000n;
    if (unitCost === null || unitCost < 0n) {
      setFormError(L('Unit cost must be a valid BDT amount.', 'একক ব্যয় বৈধ টাকার অঙ্ক হতে হবে।'));
      return;
    }
    const qtyOnHand = Number(itemForm.qty_on_hand_text || '0');
    if (!Number.isFinite(qtyOnHand) || qtyOnHand < 0) {
      setFormError(L('Quantity on hand must be zero or greater.', 'হাতে থাকা পরিমাণ শূন্য বা তার বেশি হতে হবে।'));
      return;
    }
    const isStockItem = itemForm.is_stock_item;
    const draft: ItemDraft = {
      id: itemForm.id,
      sku,
      hs_code: itemForm.hs_code.trim(),
      name_en: nameEn,
      name_bn: itemForm.name_bn.trim() || nameEn,
      unit_en: itemForm.unit_en.trim() || 'pcs',
      unit_bn: itemForm.unit_bn.trim() || 'পিস',
      unit_price_poisha: unitPrice,
      unit_cost_poisha: isStockItem ? unitCost : undefined,
      qty_on_hand: isStockItem ? qtyOnHand : undefined,
      tax_category: itemForm.tax_category,
      inventory_account: itemForm.inventory_account.trim() || (isStockItem ? '1310' : '5310'),
      is_stock_item: isStockItem,
    };
    const result = upsertItem(draft);
    if (!result.ok) {
      setFormError(result.error ?? L('The item could not be saved.', 'আইটেম সংরক্ষণ করা যায়নি।'));
      return;
    }
    resetItem();
  };

  if (typeof document === 'undefined') return null;

  const tabs: Array<{ id: MasterDataTab; label_en: string; label_bn: string; icon: typeof Landmark; count: number }> = [
    { id: 'accounts', label_en: 'Chart of Accounts', label_bn: 'হিসাবের চার্ট', icon: Landmark, count: accounts.length },
    { id: 'parties', label_en: 'Customers & Suppliers', label_bn: 'গ্রাহক ও সরবরাহকারী', icon: Users, count: parties.length },
    { id: 'items', label_en: 'Inventory Items & Stock Valuation', label_bn: 'মজুদ আইটেম ও স্টক মূল্যায়ন', icon: Package, count: items.length },
  ];

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="master-data-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-ink-950/60 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={L('Master data', 'মাস্টার ডেটা')}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-line bg-canvas shadow-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="relative shrink-0 overflow-hidden bg-gradient-to-r from-vault-950 via-vault-900 to-vault-800 px-5 py-4 text-white sm:px-6">
              <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-gold-400/10 blur-3xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
                    <Database size={20} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-vault-200">
                      {L('Master data · COA · parties · inventory', 'মাস্টার ডেটা · সিওএ · পক্ষ · মজুদ')}
                    </p>
                    <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">
                      {L('Master Data Workbench', 'মাস্টার ডেটা ওয়ার্কবেঞ্চ')}
                    </h2>
                    <p className="mt-0.5 truncate text-[11px] text-vault-200/90">
                      {L(
                        `${accounts.length} GL accounts · ${parties.length} parties · ${items.length} items`,
                        `${accounts.length} জিএল হিসাব · ${parties.length} পক্ষ · ${items.length} আইটেম`,
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`hidden items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ring-1 ring-inset sm:inline-flex ${
                      canManage
                        ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/40'
                        : 'bg-rose-500/20 text-rose-100 ring-rose-300/40'
                    }`}
                  >
                    <ShieldCheck size={9} />
                    {canManage ? L('Manage access', 'ব্যবস্থাপনা অনুমতি') : L('Read-only', 'শুধুমাত্র পাঠযোগ্য')}
                  </span>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shrink-0 rounded-xl bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
                    aria-label={L('Close master data', 'মাস্টার ডেটা বন্ধ করুন')}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </header>

            <div className="shrink-0 border-b border-line bg-surface px-4 py-2 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="ql-seg flex-wrap" role="tablist" aria-label={L('Master data sections', 'মাস্টার ডেটা বিভাগ')}>
                  {tabs.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === entry.id}
                        data-active={tab === entry.id}
                        onClick={() => selectTab(entry.id)}
                        className="ql-seg-item inline-flex items-center gap-1.5 !text-[10.5px]"
                      >
                        <Icon size={11} />
                        <span className="hidden sm:inline">{L(entry.label_en, entry.label_bn)}</span>
                        <span className="sm:hidden">{L(entry.label_en.split(' ')[0], entry.label_bn.split(' ')[0])}</span>
                        <span className="rounded-full bg-ink-900/5 px-1.5 py-px font-mono text-[8.5px] tabular-nums dark:bg-white/10">
                          {entry.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="hidden text-[9.5px] text-ink-400 lg:inline">
                  {L('Requires MANAGE_MASTERS_AND_COA permission', 'MANAGE_MASTERS_AND_COA অনুমতি প্রয়োজন')}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {!canManage ? (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {L(
                      'Read-only master data. An ADMIN, CONTROLLER or ACCOUNTANT can create and edit these records.',
                      'শুধুমাত্র পাঠযোগ্য মাস্টার ডেটা। একজন ADMIN, CONTROLLER বা ACCOUNTANT এই রেকর্ড তৈরি ও সম্পাদনা করতে পারেন।',
                    )}
                  </span>
                </div>
              ) : null}

              {tab === 'accounts' ? (
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <section className="ql-card overflow-hidden">
                    <div className="border-b border-line/80 bg-surface-2 px-4 py-2.5">
                      <p className="ql-kicker">{L('Chart of accounts', 'হিসাবের চার্ট')}</p>
                      <p className="mt-1 text-[10px] text-ink-500">
                        {L(
                          `${filteredAccounts.length} of ${accounts.length} accounts`,
                          `${accounts.length}-এর মধ্যে ${filteredAccounts.length}টি হিসাব`,
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
                      <div className="relative min-w-0 flex-1">
                        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder={L('Search code or name…', 'কোড বা নাম খুঁজুন…')}
                          className="ql-input !py-1.5 !pl-8 !text-[11px]"
                          aria-label={L('Search accounts', 'হিসাব খুঁজুন')}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={resetAccount}
                        disabled={!canManage}
                        className="ql-btn ql-btn-secondary shrink-0 !px-2.5 !py-1.5 !text-[10.5px]"
                      >
                        <Plus size={12} /> {L('New', 'নতুন')}
                      </button>
                    </div>
                    <div className="max-h-[430px] overflow-y-auto">
                      <table className="ql-table">
                        <thead>
                          <tr>
                            <th>{L('Code', 'কোড')}</th>
                            <th>{L('Account', 'হিসাব')}</th>
                            <th>{L('Type', 'ধরন')}</th>
                            <th className="text-right">{L('Opening', 'প্রারম্ভিক')}</th>
                            <th aria-label={L('Edit', 'সম্পাদনা')} />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAccounts.map((account) => (
                            <tr key={account.code} className={editingAccount === account.code ? 'bg-emerald-500/[0.06]' : ''}>
                              <td className="font-mono text-[11px] font-semibold text-ink-800">{account.code}</td>
                              <td>
                                <span className="block text-[11.5px] font-semibold text-ink-800">
                                  {isBn ? account.name_bn : account.name_en}
                                </span>
                                <span className="block text-[9px] text-ink-400">
                                  {SUB_CATEGORY_LABELS[account.sub_category][0]} · {account.is_active ? L('active', 'সক্রিয়') : L('inactive', 'নিষ্ক্রিয়')}
                                </span>
                              </td>
                              <td>
                                <span className="ql-badge ql-badge-neutral !px-2 !py-0.5 !text-[9px]">
                                  {L(...ACCOUNT_TYPE_LABELS[account.account_type])}
                                </span>
                              </td>
                              <td className="text-right font-mono text-[10px] tabular-nums text-ink-600">
                                {account.opening_debit_poisha > 0n
                                  ? `Dr ${money(account.opening_debit_poisha)}`
                                  : account.opening_credit_poisha > 0n
                                    ? `Cr ${money(account.opening_credit_poisha)}`
                                    : '—'}
                              </td>
                              <td className="text-right">
                                <button
                                  type="button"
                                  onClick={() => editAccount(account)}
                                  disabled={!canManage}
                                  className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40 dark:hover:bg-white/[0.06]"
                                  aria-label={L(`Edit account ${account.code}`, `হিসাব ${account.code} সম্পাদনা`)}
                                >
                                  <Pencil size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filteredAccounts.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-[11px] text-ink-400">
                                {L('No account matches that search.', 'সেই খোঁজে কোনো হিসাব নেই।')}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="ql-card overflow-hidden">
                    <div className="flex items-start justify-between gap-2 border-b border-line/80 bg-surface-2 px-4 py-2.5">
                      <div>
                        <p className="ql-kicker">
                          {editingAccount ? L('Edit GL account', 'জিএল হিসাব সম্পাদনা') : L('New GL account', 'নতুন জিএল হিসাব')}
                        </p>
                        <p className="mt-1 text-[10px] text-ink-500">
                          {editingAccount
                            ? L(`Updating ${editingAccount}`, `${editingAccount} হালনাগাদ`)
                            : L('Add a code to the statutory chart', 'সংবিধিবদ্ধ চার্টে কোড যোগ করুন')}
                        </p>
                      </div>
                      {editingAccount ? (
                        <button
                          type="button"
                          onClick={resetAccount}
                          className="rounded-lg px-2 py-1 text-[10px] font-semibold text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-white/[0.06]"
                        >
                          {L('Cancel', 'বাতিল')}
                        </button>
                      ) : null}
                    </div>
                    <fieldset disabled={!canManage} className="space-y-3 p-4">
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('GL code (4 digits)', 'জিএল কোড (৪ সংখ্যা)')}>
                          <input
                            value={accountForm.code}
                            onChange={(event) =>
                              setAccountForm((form) => ({ ...form, code: event.target.value.replace(/\D/g, '').slice(0, 4) }))
                            }
                            disabled={Boolean(editingAccount)}
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="1310"
                            className="ql-input font-mono !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <Field label={L('Account type', 'হিসাবের ধরন')}>
                          <select
                            value={accountForm.account_type}
                            onChange={(event) => {
                              const accountType = event.target.value as AccountType;
                              setAccountForm((form) => ({
                                ...form,
                                account_type: accountType,
                                sub_category: SUB_CATEGORIES[accountType][0],
                              }));
                            }}
                            className="ql-select !py-1.5 !text-[12px]"
                          >
                            {ACCOUNT_TYPE_ORDER.map((type) => (
                              <option key={type} value={type}>
                                {L(...ACCOUNT_TYPE_LABELS[type])}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Name (English)', 'নাম (ইংরেজি)')}>
                          <input
                            value={accountForm.name_en}
                            onChange={(event) => setAccountForm((form) => ({ ...form, name_en: event.target.value }))}
                            placeholder={L('Merchandise Inventory', 'পণ্যসামগ্রী মজুদ')}
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <Field label={L('Name (Bangla)', 'নাম (বাংলা)')}>
                          <input
                            value={accountForm.name_bn}
                            onChange={(event) => setAccountForm((form) => ({ ...form, name_bn: event.target.value }))}
                            placeholder="পণ্যসামগ্রী মজুদ"
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                      </div>
                      <Field label={L('Sub-category', 'উপ-শ্রেণি')}>
                        <select
                          value={accountForm.sub_category}
                          onChange={(event) =>
                            setAccountForm((form) => ({
                              ...form,
                              sub_category: event.target.value as AccountSubCategory,
                            }))
                          }
                          className="ql-select !py-1.5 !text-[12px]"
                        >
                          {SUB_CATEGORIES[accountForm.account_type].map((subCategory) => (
                            <option key={subCategory} value={subCategory}>
                              {L(...SUB_CATEGORY_LABELS[subCategory])}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Opening debit (BDT)', 'প্রারম্ভিক ডেবিট (টাকা)')}>
                          <input
                            value={accountForm.opening_debit_text}
                            onChange={(event) => setAccountForm((form) => ({ ...form, opening_debit_text: event.target.value }))}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="ql-input font-money !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <Field label={L('Opening credit (BDT)', 'প্রারম্ভিক ক্রেডিট (টাকা)')}>
                          <input
                            value={accountForm.opening_credit_text}
                            onChange={(event) => setAccountForm((form) => ({ ...form, opening_credit_text: event.target.value }))}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="ql-input font-money !py-1.5 !text-[12px]"
                          />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface-2/50 px-2.5 py-2 text-[11px] text-ink-600">
                        <input
                          type="checkbox"
                          checked={accountForm.is_active}
                          onChange={(event) => setAccountForm((form) => ({ ...form, is_active: event.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-line accent-emerald-600"
                        />
                        {L('Active — available for posting', 'সক্রিয় — পোস্টিংয়ের জন্য উপলব্ধ')}
                      </label>
                      {formError ? <ErrorBanner message={formError} /> : null}
                      <button type="button" onClick={submitAccount} disabled={!canManage} className="ql-btn ql-btn-primary w-full !py-2 !text-[12px]">
                        <Save size={13} />
                        {editingAccount ? L('Update account', 'হিসাব হালনাগাদ') : L('Create account', 'হিসাব তৈরি')}
                      </button>
                      <p className="text-center text-[9px] leading-relaxed text-ink-400">
                        {L(
                          'New accounts become immediately available to the posting engine.',
                          'নতুন হিসাব সঙ্গে সঙ্গে পোস্টিং ইঞ্জিনে উপলব্ধ হয়।',
                        )}
                      </p>
                    </fieldset>
                  </section>
                </div>
              ) : null}

              {tab === 'parties' ? (
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <section className="ql-card overflow-hidden">
                    <div className="border-b border-line/80 bg-surface-2 px-4 py-2.5">
                      <p className="ql-kicker">{L('Customers & suppliers', 'গ্রাহক ও সরবরাহকারী')}</p>
                      <p className="mt-1 text-[10px] text-ink-500">
                        {L(
                          `${filteredParties.length} of ${parties.length} parties · BIN 13 digits · e-TIN 12 digits`,
                          `${parties.length}-এর মধ্যে ${filteredParties.length}টি পক্ষ · বিআইএন ১৩ সংখ্যা · ই-টিআইএন ১২ সংখ্যা`,
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
                      <div className="relative min-w-0 flex-1">
                        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder={L('Search name, code, BIN or e-TIN…', 'নাম, কোড, বিআইএন বা ই-টিআইএন খুঁজুন…')}
                          className="ql-input !py-1.5 !pl-8 !text-[11px]"
                          aria-label={L('Search parties', 'পক্ষ খুঁজুন')}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={resetParty}
                        disabled={!canManage}
                        className="ql-btn ql-btn-secondary shrink-0 !px-2.5 !py-1.5 !text-[10.5px]"
                      >
                        <Plus size={12} /> {L('New', 'নতুন')}
                      </button>
                    </div>
                    <div className="max-h-[430px] overflow-y-auto">
                      <table className="ql-table">
                        <thead>
                          <tr>
                            <th>{L('Party', 'পক্ষ')}</th>
                            <th>{L('Type', 'ধরন')}</th>
                            <th>{L('BIN / e-TIN', 'বিআইএন / ই-টিআইএন')}</th>
                            <th aria-label={L('Edit', 'সম্পাদনা')} />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredParties.map((party) => (
                            <tr key={party.id} className={editingParty === party.id ? 'bg-emerald-500/[0.06]' : ''}>
                              <td>
                                <span className="block text-[11.5px] font-semibold text-ink-800">
                                  {isBn ? party.name_bn : party.name_en}
                                </span>
                                <span className="block font-mono text-[9px] text-ink-400">
                                  {party.code} · {party.mobile || L('no mobile', 'মোবাইল নেই')}
                                </span>
                              </td>
                              <td>
                                <span className="ql-badge ql-badge-neutral !px-2 !py-0.5 !text-[9px]">
                                  {L(...PARTY_TYPE_LABELS[party.type])}
                                </span>
                              </td>
                              <td>
                                <span className="block font-mono text-[9.5px] text-ink-600">{party.bin || 'BIN —'}</span>
                                <span className="block font-mono text-[9.5px] text-ink-400">{party.tin || 'TIN —'}</span>
                              </td>
                              <td className="text-right">
                                <button
                                  type="button"
                                  onClick={() => editParty(party)}
                                  disabled={!canManage}
                                  className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40 dark:hover:bg-white/[0.06]"
                                  aria-label={L(`Edit ${party.name_en}`, `${party.name_en} সম্পাদনা`)}
                                >
                                  <Pencil size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {filteredParties.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-[11px] text-ink-400">
                                {L('No party matches that search.', 'সেই খোঁজে কোনো পক্ষ নেই।')}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="ql-card overflow-hidden">
                    <div className="flex items-start justify-between gap-2 border-b border-line/80 bg-surface-2 px-4 py-2.5">
                      <div>
                        <p className="ql-kicker">
                          {editingParty ? L('Edit party', 'পক্ষ সম্পাদনা') : L('New customer or supplier', 'নতুন গ্রাহক বা সরবরাহকারী')}
                        </p>
                        <p className="mt-1 text-[10px] text-ink-500">
                          {editingParty
                            ? L('Keep BIN and e-TIN aligned with NBR records', 'এনবিআর রেকর্ডের সঙ্গে বিআইএন ও ই-টিআইএন মিলিয়ে রাখুন')
                            : L('Capture statutory identity once', 'সংবিধিবদ্ধ পরিচয় একবারই লিপিবদ্ধ করুন')}
                        </p>
                      </div>
                      {editingParty ? (
                        <button
                          type="button"
                          onClick={resetParty}
                          className="rounded-lg px-2 py-1 text-[10px] font-semibold text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-white/[0.06]"
                        >
                          {L('Cancel', 'বাতিল')}
                        </button>
                      ) : null}
                    </div>
                    <fieldset disabled={!canManage} className="space-y-3 p-4">
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Party type', 'পক্ষের ধরন')}>
                          <select
                            value={partyForm.type}
                            onChange={(event) => setPartyForm((form) => ({ ...form, type: event.target.value as PartyType }))}
                            className="ql-select !py-1.5 !text-[12px]"
                          >
                            {(Object.keys(PARTY_TYPE_LABELS) as PartyType[]).map((type) => (
                              <option key={type} value={type}>
                                {L(...PARTY_TYPE_LABELS[type])}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={L('Party code', 'পক্ষের কোড')} hint={L('Blank = auto-generated', 'খালি = স্বয়ংক্রিয়')}>
                          <input
                            value={partyForm.code}
                            onChange={(event) => setPartyForm((form) => ({ ...form, code: event.target.value.toUpperCase() }))}
                            placeholder="P-0011"
                            className="ql-input font-mono !py-1.5 !text-[12px]"
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Name (English)', 'নাম (ইংরেজি)')}>
                          <input
                            value={partyForm.name_en}
                            onChange={(event) => setPartyForm((form) => ({ ...form, name_en: event.target.value }))}
                            placeholder="Meghna Traders"
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <Field label={L('Name (Bangla)', 'নাম (বাংলা)')}>
                          <input
                            value={partyForm.name_bn}
                            onChange={(event) => setPartyForm((form) => ({ ...form, name_bn: event.target.value }))}
                            placeholder="মেঘনা ট্রেডার্স"
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field
                          label={L('BIN (13 digits)', 'বিআইএন (১৩ সংখ্যা)')}
                          hint={`${partyForm.bin.replace(/\D/g, '').length}/13 ${L('digits', 'সংখ্যা')}`}
                        >
                          <input
                            value={partyForm.bin}
                            onChange={(event) => setPartyForm((form) => ({ ...form, bin: event.target.value }))}
                            inputMode="numeric"
                            placeholder="0014829100101"
                            className={`ql-input font-mono !py-1.5 !text-[12px] ${
                              partyForm.bin && !isValidBin(partyForm.bin) ? '!border-rose-400/70' : ''
                            }`}
                          />
                        </Field>
                        <Field
                          label={L('e-TIN (12 digits)', 'ই-টিআইএন (১২ সংখ্যা)')}
                          hint={`${partyForm.tin.replace(/\D/g, '').length}/12 ${L('digits', 'সংখ্যা')}`}
                        >
                          <input
                            value={partyForm.tin}
                            onChange={(event) => setPartyForm((form) => ({ ...form, tin: event.target.value }))}
                            inputMode="numeric"
                            placeholder="123456789012"
                            className={`ql-input font-mono !py-1.5 !text-[12px] ${
                              partyForm.tin && !isValidTin(partyForm.tin) ? '!border-rose-400/70' : ''
                            }`}
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Mobile', 'মোবাইল')}>
                          <input
                            value={partyForm.mobile}
                            onChange={(event) => setPartyForm((form) => ({ ...form, mobile: event.target.value }))}
                            placeholder="+880 17XX XXXXXX"
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <Field label={L('Email', 'ইমেইল')}>
                          <input
                            value={partyForm.email}
                            onChange={(event) => setPartyForm((form) => ({ ...form, email: event.target.value }))}
                            type="email"
                            placeholder="ap@example.com"
                            className="ql-input !py-1.5 !text-[12px]"
                          />
                        </Field>
                      </div>
                      <Field label={L('Address (English)', 'ঠিকানা (ইংরেজি)')}>
                        <input
                          value={partyForm.address_en}
                          onChange={(event) => setPartyForm((form) => ({ ...form, address_en: event.target.value }))}
                          placeholder="Gulshan-1, Dhaka 1212"
                          className="ql-input !py-1.5 !text-[12px]"
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Field label={L('Credit days', 'ক্রেডিট দিন')}>
                          <input
                            value={partyForm.credit_days_text}
                            onChange={(event) =>
                              setPartyForm((form) => ({ ...form, credit_days_text: event.target.value.replace(/\D/g, '').slice(0, 3) }))
                            }
                            inputMode="numeric"
                            className="ql-input font-mono !py-1.5 !text-[12px]"
                          />
                        </Field>
                        <div className="flex flex-col justify-end gap-1.5 pb-1">
                          <label className="flex items-center gap-2 text-[10.5px] text-ink-600">
                            <input
                              type="checkbox"
                              checked={partyForm.is_withholding_buyer}
                              onChange={(event) =>
                                setPartyForm((form) => ({ ...form, is_withholding_buyer: event.target.checked }))
                              }
                              className="h-3.5 w-3.5 rounded border-line accent-emerald-600"
                            />
                            {L('Withholding buyer (VDS)', 'কর্তনকারী ক্রেতা (ভিডিএস)')}
                          </label>
                          <label className="flex items-center gap-2 text-[10.5px] text-ink-600">
                            <input
                              type="checkbox"
                              checked={partyForm.is_government}
                              onChange={(event) => setPartyForm((form) => ({ ...form, is_government: event.target.checked }))}
                              className="h-3.5 w-3.5 rounded border-line accent-emerald-600"
                            />
                            {L('Government / bank entity', 'সরকারি / ব্যাংক প্রতিষ্ঠান')}
                          </label>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface-2/50 px-2.5 py-2 text-[11px] text-ink-600">
                        <input
                          type="checkbox"
                          checked={partyForm.is_active}
                          onChange={(event) => setPartyForm((form) => ({ ...form, is_active: event.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-line accent-emerald-600"
                        />
                        {L('Active counterparty', 'সক্রিয় পক্ষ')}
                      </label>
                      {formError ? <ErrorBanner message={formError} /> : null}
                      <button type="button" onClick={submitParty} disabled={!canManage} className="ql-btn ql-btn-primary w-full !py-2 !text-[12px]">
                        <Save size={13} />
                        {editingParty ? L('Update party', 'পক্ষ হালনাগাদ') : L('Create party', 'পক্ষ তৈরি')}
                      </button>
                      <p className="text-center text-[9px] leading-relaxed text-ink-400">
                        {L(
                          'A valid 13-digit BIN protects input-credit eligibility under s.46.',
                          'বৈধ ১৩-সংখ্যার বিআইএন ধারা ৪৬-এর ইনপুট ক্রেডিট যোগ্যতা রক্ষা করে।',
                        )}
                      </p>
                    </fieldset>
                  </section>
                </div>
              ) : null}

              {tab === 'items' ? (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <SummaryCard
                      icon={Package}
                      label={L('Stock items', 'মজুদ আইটেম')}
                      value={String(stockItems.length)}
                      note={L(`${items.length - stockItems.length} service item(s)`, `${items.length - stockItems.length}টি সেবা আইটেম`)}
                      tone="emerald"
                    />
                    <SummaryCard
                      icon={Warehouse}
                      label={L('Units on hand', 'হাতে থাকা একক')}
                      value={formatQty(totalStockQty)}
                      note={L(`${lowStockCount} at or below 10 units`, `${lowStockCount}টি ১০ একক বা কম`)}
                      tone="gold"
                    />
                    <SummaryCard
                      icon={Boxes}
                      label={L('Stock valuation', 'স্টক মূল্যায়ন')}
                      value={money(totalStockValue)}
                      note={L('Weighted-average carrying value', 'ভারিত-গড় বহন মূল্য')}
                      tone="ink"
                    />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <section className="ql-card overflow-hidden">
                      <div className="border-b border-line/80 bg-surface-2 px-4 py-2.5">
                        <p className="ql-kicker">{L('Inventory items', 'মজুদ আইটেম')}</p>
                        <p className="mt-1 text-[10px] text-ink-500">
                          {L(
                            `${filteredItems.length} of ${items.length} items · live qty_on_hand and unit_cost_poisha`,
                            `${items.length}-এর মধ্যে ${filteredItems.length}টি আইটেম · লাইভ qty_on_hand ও unit_cost_poisha`,
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
                        <div className="relative min-w-0 flex-1">
                          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                          <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={L('Search SKU, HS code or item…', 'এসকেইউ, এইচএস কোড বা আইটেম খুঁজুন…')}
                            className="ql-input !py-1.5 !pl-8 !text-[11px]"
                            aria-label={L('Search items', 'আইটেম খুঁজুন')}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={resetItem}
                          disabled={!canManage}
                          className="ql-btn ql-btn-secondary shrink-0 !px-2.5 !py-1.5 !text-[10.5px]"
                        >
                          <Plus size={12} /> {L('New', 'নতুন')}
                        </button>
                      </div>
                      <div className="max-h-[430px] overflow-y-auto">
                        <table className="ql-table">
                          <thead>
                            <tr>
                              <th>{L('Item', 'আইটেম')}</th>
                              <th>{L('Stock', 'স্টক')}</th>
                              <th className="text-right">{L('On hand', 'হাতে')}</th>
                              <th className="text-right">{L('Unit cost', 'একক ব্যয়')}</th>
                              <th className="text-right">{L('Valuation', 'মূল্যায়ন')}</th>
                              <th aria-label={L('Edit', 'সম্পাদনা')} />
                            </tr>
                          </thead>
                          <tbody>
                            {filteredItems.map((item) => {
                              const stock = item.is_stock_item !== false;
                              const qty = item.qty_on_hand ?? 0;
                              const low = stock && qty <= 10;
                              return (
                                <tr key={item.id} className={editingItem === item.id ? 'bg-emerald-500/[0.06]' : ''}>
                                  <td>
                                    <span className="block text-[11.5px] font-semibold text-ink-800">
                                      {isBn ? item.name_bn : item.name_en}
                                    </span>
                                    <span className="block font-mono text-[9px] text-ink-400">
                                      {item.sku} · {item.hs_code || L('no HS code', 'এইচএস কোড নেই')}
                                    </span>
                                  </td>
                                  <td>
                                    {stock ? (
                                      <span className={`ql-badge !px-2 !py-0.5 !text-[9px] ${low ? 'ql-badge-danger' : 'ql-badge-success'}`}>
                                        {low ? L('Low', 'কম') : L('Stock', 'স্টক')}
                                      </span>
                                    ) : (
                                      <span className="ql-badge ql-badge-neutral !px-2 !py-0.5 !text-[9px]">{L('Service', 'সেবা')}</span>
                                    )}
                                  </td>
                                  <td className="text-right font-mono text-[10px] tabular-nums text-ink-700">
                                    {stock ? formatQty(qty) : '—'}
                                  </td>
                                  <td className="text-right font-mono text-[10px] tabular-nums text-ink-600">
                                    {stock && item.unit_cost_poisha !== undefined ? money(item.unit_cost_poisha) : '—'}
                                  </td>
                                  <td className="text-right font-mono text-[10px] tabular-nums text-ink-800">
                                    {stock ? money(stockValuePoisha(qty, item.unit_cost_poisha)) : '—'}
                                  </td>
                                  <td className="text-right">
                                    <button
                                      type="button"
                                      onClick={() => editItem(item)}
                                      disabled={!canManage}
                                      className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40 dark:hover:bg-white/[0.06]"
                                      aria-label={L(`Edit ${item.name_en}`, `${item.name_en} সম্পাদনা`)}
                                    >
                                      <Pencil size={11} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredItems.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-[11px] text-ink-400">
                                  {L('No item matches that search.', 'সেই খোঁজে কোনো আইটেম নেই।')}
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="ql-card overflow-hidden">
                      <div className="flex items-start justify-between gap-2 border-b border-line/80 bg-surface-2 px-4 py-2.5">
                        <div>
                          <p className="ql-kicker">
                            {editingItem ? L('Edit inventory item', 'মজুদ আইটেম সম্পাদনা') : L('New inventory item', 'নতুন মজুদ আইটেম')}
                          </p>
                          <p className="mt-1 text-[10px] text-ink-500">
                            {editingItem
                              ? L('Quantities and costs feed COGS immediately', 'পরিমাণ ও ব্যয় সঙ্গে সঙ্গে সিওজিএস-এ যায়')
                              : L('Stock items carry qty_on_hand and weighted-average cost', 'স্টক আইটেমে qty_on_hand ও ভারিত-গড় ব্যয় থাকে')}
                          </p>
                        </div>
                        {editingItem ? (
                          <button
                            type="button"
                            onClick={resetItem}
                            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-white/[0.06]"
                          >
                            {L('Cancel', 'বাতিল')}
                          </button>
                        ) : null}
                      </div>
                      <fieldset disabled={!canManage} className="space-y-3 p-4">
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={L('SKU', 'এসকেইউ')}>
                            <input
                              value={itemForm.sku}
                              onChange={(event) => setItemForm((form) => ({ ...form, sku: event.target.value.toUpperCase() }))}
                              placeholder="HS-8471.30"
                              className="ql-input font-mono !py-1.5 !text-[12px]"
                            />
                          </Field>
                          <Field label={L('HS code', 'এইচএস কোড')}>
                            <input
                              value={itemForm.hs_code}
                              onChange={(event) => setItemForm((form) => ({ ...form, hs_code: event.target.value }))}
                              placeholder="8471.30.00"
                              className="ql-input font-mono !py-1.5 !text-[12px]"
                            />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={L('Name (English)', 'নাম (ইংরেজি)')}>
                            <input
                              value={itemForm.name_en}
                              onChange={(event) => setItemForm((form) => ({ ...form, name_en: event.target.value }))}
                              placeholder="Portable laptop computers"
                              className="ql-input !py-1.5 !text-[12px]"
                            />
                          </Field>
                          <Field label={L('Name (Bangla)', 'নাম (বাংলা)')}>
                            <input
                              value={itemForm.name_bn}
                              onChange={(event) => setItemForm((form) => ({ ...form, name_bn: event.target.value }))}
                              placeholder="বহনযোগ্য ল্যাপটপ কম্পিউটার"
                              className="ql-input !py-1.5 !text-[12px]"
                            />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={L('Unit (English)', 'একক (ইংরেজি)')}>
                            <input
                              value={itemForm.unit_en}
                              onChange={(event) => setItemForm((form) => ({ ...form, unit_en: event.target.value }))}
                              className="ql-input !py-1.5 !text-[12px]"
                            />
                          </Field>
                          <Field label={L('Unit (Bangla)', 'একক (বাংলা)')}>
                            <input
                              value={itemForm.unit_bn}
                              onChange={(event) => setItemForm((form) => ({ ...form, unit_bn: event.target.value }))}
                              className="ql-input !py-1.5 !text-[12px]"
                            />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={L('Selling price (BDT)', 'বিক্রয়মূল্য (টাকা)')}>
                            <input
                              value={itemForm.unit_price_text}
                              onChange={(event) => setItemForm((form) => ({ ...form, unit_price_text: event.target.value }))}
                              inputMode="decimal"
                              placeholder="98500.00"
                              className="ql-input font-money !py-1.5 !text-[12px]"
                            />
                          </Field>
                          <Field
                            label={L('Unit cost (BDT)', 'একক ব্যয় (টাকা)')}
                            hint={L('Blank = 70% of selling price', 'খালি = বিক্রয়মূল্যের ৭০%')}
                          >
                            <input
                              value={itemForm.unit_cost_text}
                              onChange={(event) => setItemForm((form) => ({ ...form, unit_cost_text: event.target.value }))}
                              onBlur={() => {
                                if (!itemForm.unit_cost_text.trim() && itemForm.is_stock_item) {
                                  const price = parsePoisha(itemForm.unit_price_text);
                                  if (price !== null && price > 0n) {
                                    setItemForm((form) => ({
                                      ...form,
                                      unit_cost_text: poishaToText((price * 7000n) / 10000n),
                                    }));
                                  }
                                }
                              }}
                              inputMode="decimal"
                              placeholder="68950.00"
                              disabled={!itemForm.is_stock_item}
                              className="ql-input font-money !py-1.5 !text-[12px]"
                            />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={L('Qty on hand', 'হাতে থাকা পরিমাণ')}>
                            <input
                              value={itemForm.qty_on_hand_text}
                              onChange={(event) => setItemForm((form) => ({ ...form, qty_on_hand_text: event.target.value }))}
                              inputMode="decimal"
                              disabled={!itemForm.is_stock_item}
                              className="ql-input font-mono !py-1.5 !text-[12px]"
                            />
                          </Field>
                          <Field label={L('Inventory account', 'মজুদ হিসাব')}>
                            <input
                              value={itemForm.inventory_account}
                              onChange={(event) => setItemForm((form) => ({ ...form, inventory_account: event.target.value }))}
                              placeholder="1310"
                              className="ql-input font-mono !py-1.5 !text-[12px]"
                            />
                          </Field>
                        </div>
                        <Field label={L('VAT category', 'ভ্যাট শ্রেণি')}>
                          <select
                            value={itemForm.tax_category}
                            onChange={(event) =>
                              setItemForm((form) => ({ ...form, tax_category: event.target.value as TaxCategory }))
                            }
                            className="ql-select !py-1.5 !text-[12px]"
                          >
                            {TAX_CATEGORY_ORDER.map((category) => (
                              <option key={category} value={category}>
                                {L(...TAX_CATEGORY_LABELS[category])}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <label className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface-2/50 px-2.5 py-2 text-[11px] text-ink-600">
                          <input
                            type="checkbox"
                            checked={itemForm.is_stock_item}
                            onChange={(event) =>
                              setItemForm((form) => ({
                                ...form,
                                is_stock_item: event.target.checked,
                                inventory_account: event.target.checked
                                  ? form.inventory_account === '5310'
                                    ? '1310'
                                    : form.inventory_account
                                  : form.inventory_account === '1310'
                                    ? '5310'
                                    : form.inventory_account,
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-line accent-emerald-600"
                          />
                          {L('Stock item — perpetual inventory & COGS', 'স্টক আইটেম — চিরস্থায়ী মজুদ ও সিওজিএস')}
                        </label>
                        {formError ? <ErrorBanner message={formError} /> : null}
                        <button type="button" onClick={submitItem} disabled={!canManage} className="ql-btn ql-btn-primary w-full !py-2 !text-[12px]">
                          <Save size={13} />
                          {editingItem ? L('Update item', 'আইটেম হালনাগাদ') : L('Create item', 'আইটেম তৈরি')}
                        </button>
                        <p className="flex items-center justify-center gap-1 text-center text-[9px] leading-relaxed text-ink-400">
                          <BadgeCheck size={10} className="shrink-0 text-emerald-500" />
                          {L(
                            'Saving a stock item recalculates valuation without touching posted journals.',
                            'স্টক আইটেম সংরক্ষণ করলে পোস্টেড জার্নাল স্পর্শ না করেই মূল্যায়ন পুনঃগণনা হয়।',
                          )}
                        </p>
                      </fieldset>
                    </section>
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2/60 px-4 py-2.5 sm:px-5">
              <p className="flex items-center gap-1.5 text-[9.5px] text-ink-400">
                <ShieldCheck size={10} className={canManage ? 'text-emerald-500' : 'text-amber-500'} />
                {L(
                  'Every change is permission-checked and persisted with the vault snapshot.',
                  'প্রতিটি পরিবর্তন অনুমতি-যাচাইকৃত এবং ভল্ট স্ন্যাপশটে সংরক্ষিত।',
                )}
              </p>
              <button type="button" onClick={onClose} className="ql-btn ql-btn-secondary !px-3 !py-1.5 !text-[11px]">
                {L('Close', 'বন্ধ করুন')}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default MasterDataModal;
