import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Search } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import type { TaxCategory } from '../../core/types';
import { setupApi, type SetupAccount } from '../../setup/api';
import { masterApi, type Item, type ItemWriteInput } from '../../masters/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';

const TAX_LABELS: Record<TaxCategory, [string, string]> = {
  STANDARD_15: ['Standard 15%', 'আদর্শ ১৫%'],
  TRADING_5: ['Trading 5%', 'বাণিজ্যিক ৫%'],
  PROCUREMENT_7_5: ['Procurement 7.5%', 'ক্রয় ৭.৫%'],
  EXPORT_ZERO: ['Export zero-rated', 'রপ্তানি শূন্য-হার'],
  EXEMPT: ['Exempt', 'মুক্ত'],
  REVERSE_CHARGE: ['Reverse charge', 'রিভার্স চার্জ'],
  OUT_OF_SCOPE: ['Out of scope', 'পরিধির বাইরে'],
};
const TAX_ORDER = Object.keys(TAX_LABELS) as TaxCategory[];

interface ItemFormState {
  sku: string;
  hsCode: string;
  nameEn: string;
  nameBn: string;
  unit: string;
  unitBn: string;
  isStockItem: boolean;
  defaultTaxCategory: TaxCategory;
  inventoryAccountId: string;
  expenseAccountId: string;
}

function emptyItemForm(): ItemFormState {
  return {
    sku: '',
    hsCode: '',
    nameEn: '',
    nameBn: '',
    unit: 'pcs',
    unitBn: '',
    isStockItem: true,
    defaultTaxCategory: 'STANDARD_15',
    inventoryAccountId: '',
    expenseAccountId: '',
  };
}

export function ItemPanel({ initialSearch = '' }: { initialSearch?: string }) {
  const { locale } = usePreferences();
  const auth = useAuth();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canManage = auth.hasCompanyPermission('MANAGE_MASTERS_AND_COA');

  const [search, setSearch] = useState(initialSearch);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [stockOnly, setStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyItemForm);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

  useEffect(() => {
    setSearch(initialSearch);
    setPage(1);
  }, [initialSearch]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await masterApi.items(companyId, {
        ...(search.trim() ? { search: search.trim() } : {}),
        includeInactive,
        stockOnly,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, search, includeInactive, stockOnly, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    void setupApi
      .accounts(companyId)
      .then((result) => setAccounts(result.accounts))
      .catch((caught) => setError(apiErrorMessage(caught)));
  }, [companyId]);

  const assetAccounts = accounts.filter((account) => account.isActive && account.accountType === 'ASSET');
  const expenseAccounts = accounts.filter((account) => account.isActive && account.accountType === 'EXPENSE');

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input: ItemWriteInput = {
        sku: form.sku,
        hsCode: form.hsCode || null,
        nameEn: form.nameEn,
        nameBn: form.nameBn || null,
        unit: form.unit,
        unitBn: form.unitBn || null,
        isStockItem: form.isStockItem,
        defaultTaxCategory: form.defaultTaxCategory,
        inventoryAccountId: form.isStockItem ? form.inventoryAccountId || null : null,
        expenseAccountId: form.expenseAccountId || null,
      };
      if (editingId) {
        await masterApi.updateItem(companyId, editingId, input);
        setNotice(L('Item updated.', 'আইটেম হালনাগাদ হয়েছে।'));
      } else {
        await masterApi.createItem(companyId, input);
        setNotice(L('Item created.', 'আইটেম তৈরি হয়েছে।'));
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyItemForm());
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item: Item) => {
    const deactivating = item.status === 'ACTIVE';
    const consequence = deactivating
      ? L(
          `Deactivate ${item.sku} — ${item.nameEn}? It stays in stock history but cannot be used for new movements. Items with stock on hand cannot be deactivated.`,
          `${item.sku} — ${item.nameEn} নিষ্ক্রিয় করবেন? এটি স্টক ইতিহাসে থাকবে কিন্তু নতুন মুভমেন্টে ব্যবহার করা যাবে না। স্টক থাকা আইটেম নিষ্ক্রিয় করা যাবে না।`,
        )
      : L(`Reactivate ${item.sku}?`, `${item.sku} পুনরায় সক্রিয় করবেন?`);
    if (!window.confirm(consequence)) return;
    const reason = window.prompt(L('Reason (3–500 characters)', 'কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    try {
      if (deactivating) await masterApi.deactivateItem(companyId, item.id, reason.trim());
      else await masterApi.reactivateItem(companyId, item.id, reason.trim());
      setNotice(deactivating ? L('Item deactivated.', 'আইটেম নিষ্ক্রিয় হয়েছে।') : L('Item reactivated.', 'আইটেম পুনরায় সক্রিয় হয়েছে।'));
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold text-ink-900">{L('Items', 'আইটেম')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Quantities carry four decimal places (kg, metres, litres). A stock item must point at an inventory asset account and an expense/COGS account from this company.',
              'পরিমাণে চার দশমিক স্থান (কেজি, মিটার, লিটার)। স্টক আইটেমকে এই কোম্পানির ইনভেন্টরি অ্যাসেট ও ব্যয়/সিওজিএস হিসাবে সংযুক্ত করতে হবে।',
            )}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyItemForm());
              setFormOpen((open) => !open);
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white"
          >
            <Plus size={15} />
            {L('New item', 'নতুন আইটেম')}
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {formOpen ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h3 className="text-[15px] font-semibold text-ink-900">{editingId ? L('Edit item', 'আইটেম সম্পাদনা') : L('New item', 'নতুন আইটেম')}</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="SKU" required>
              <input className={INPUT_CLASS} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} maxLength={64} />
            </Field>
            <Field label={L('HS code', 'এইচএস কোড')} hint={L('Format only; not a classification claim.', 'শুধু ফরম্যাট; শ্রেণিবিন্যাসের দাবি নয়।')}>
              <input className={INPUT_CLASS} value={form.hsCode} onChange={(event) => setForm({ ...form, hsCode: event.target.value })} maxLength={20} />
            </Field>
            <Field label={L('English name', 'ইংরেজি নাম')} required>
              <input className={INPUT_CLASS} value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} maxLength={200} />
            </Field>
            <Field label={L('Bangla name', 'বাংলা নাম')}>
              <input className={INPUT_CLASS} value={form.nameBn} onChange={(event) => setForm({ ...form, nameBn: event.target.value })} maxLength={200} />
            </Field>
            <Field label={L('Unit', 'একক')} required hint={L('Example: kg, metre, pcs.', 'উদাহরণ: কেজি, মিটার, পিস।')}>
              <input className={INPUT_CLASS} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} maxLength={20} />
            </Field>
            <Field label={L('Bangla unit', 'বাংলা একক')}>
              <input className={INPUT_CLASS} value={form.unitBn} onChange={(event) => setForm({ ...form, unitBn: event.target.value })} maxLength={40} />
            </Field>
            <Field label={L('Default tax category', 'ডিফল্ট কর শ্রেণি')}>
              <select className={INPUT_CLASS} value={form.defaultTaxCategory} onChange={(event) => setForm({ ...form, defaultTaxCategory: event.target.value as TaxCategory })}>
                {TAX_ORDER.map((key) => <option key={key} value={key}>{L(...TAX_LABELS[key])}</option>)}
              </select>
            </Field>
            <Field label={L('Inventory account', 'ইনভেন্টরি হিসাব')} required={form.isStockItem}>
              <select className={INPUT_CLASS} value={form.inventoryAccountId} onChange={(event) => setForm({ ...form, inventoryAccountId: event.target.value })}>
                <option value="">{L('Choose an asset account', 'অ্যাসেট হিসাব বেছে নিন')}</option>
                {assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.nameEn}</option>)}
              </select>
            </Field>
            <Field label={L('Expense / COGS account', 'ব্যয় / সিওজিএস হিসাব')} required={form.isStockItem}>
              <select className={INPUT_CLASS} value={form.expenseAccountId} onChange={(event) => setForm({ ...form, expenseAccountId: event.target.value })}>
                <option value="">{L('Choose an expense account', 'ব্যয় হিসাব বেছে নিন')}</option>
                {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.nameEn}</option>)}
              </select>
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={form.isStockItem} onChange={(event) => setForm({ ...form, isStockItem: event.target.checked })} />
            {L('Stock item (moves through the inventory subledger)', 'স্টক আইটেম (ইনভেন্টরি সাবলেজারে চলে)')}
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="min-h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? L('Saving…', 'সংরক্ষণ হচ্ছে…') : L('Save item', 'আইটেম সংরক্ষণ')}</button>
            <button type="button" onClick={() => setFormOpen(false)} className="min-h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink-700">{L('Cancel', 'বাতিল')}</button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className={`${INPUT_CLASS} pl-9`}
              placeholder={L('Search SKU, name or HS code', 'এসকেইউ, নাম বা এইচএস কোড খুঁজুন')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={stockOnly} onChange={(event) => { setStockOnly(event.target.checked); setPage(1); }} />
            {L('Stock only', 'শুধু স্টক')}
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} />
            {L('Include inactive', 'নিষ্ক্রিয় সহ')}
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">{L('Name', 'নাম')}</th>
                <th className="px-3 py-2">{L('Unit', 'একক')}</th>
                <th className="px-3 py-2">{L('Stock', 'স্টক')}</th>
                <th className="px-3 py-2">{L('Tax', 'কর')}</th>
                <th className="px-3 py-2">{L('Accounts', 'হিসাব')}</th>
                <th className="px-3 py-2">{L('Status', 'অবস্থা')}</th>
                <th className="px-3 py-2 text-right">{L('Actions', 'কার্যক্রম')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {items.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No items found.', 'কোনো আইটেম পাওয়া যায়নি।')}</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-[12px]">{item.sku}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{item.nameEn}</p>
                    {item.nameBn ? <p className="text-[12px] text-ink-500">{item.nameBn}</p> : null}
                  </td>
                  <td className="px-3 py-2">{item.unit}</td>
                  <td className="px-3 py-2">{item.isStockItem ? L('Stock', 'স্টক') : L('Non-stock', 'স্টক নয়')}</td>
                  <td className="px-3 py-2">{L(...TAX_LABELS[item.defaultTaxCategory as TaxCategory])}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">
                    {item.inventoryAccountCode || '—'}<br />{item.expenseAccountCode || '—'}
                  </td>
                  <td className="px-3 py-2"><span className={item.status === 'ACTIVE' ? 'lv-chip lv-chip-emerald' : 'lv-chip lv-chip-neutral'}>{item.status}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(item.id);
                            setForm({
                              sku: item.sku,
                              hsCode: item.hsCode ?? '',
                              nameEn: item.nameEn,
                              nameBn: item.nameBn ?? '',
                              unit: item.unit,
                              unitBn: item.unitBn ?? '',
                              isStockItem: item.isStockItem,
                              defaultTaxCategory: item.defaultTaxCategory as TaxCategory,
                              inventoryAccountId: item.inventoryAccountId ?? '',
                              expenseAccountId: item.expenseAccountId ?? '',
                            });
                            setFormOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700"
                        >
                          <Pencil size={12} /> {L('Edit', 'সম্পাদনা')}
                        </button>
                      ) : null}
                      {canManage ? (
                        <button type="button" onClick={() => void changeStatus(item)} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">
                          {item.status === 'ACTIVE' ? L('Deactivate', 'নিষ্ক্রিয়') : L('Reactivate', 'সক্রিয়')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-ink-500">
          <span>{L(`${total} items`, `${total} আইটেম`)}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-line px-2 py-1 font-semibold disabled:opacity-40">{L('Previous', 'পূর্ববর্তী')}</button>
            <span>{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-line px-2 py-1 font-semibold disabled:opacity-40">{L('Next', 'পরবর্তী')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
