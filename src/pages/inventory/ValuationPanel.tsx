import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS } from '../setup/setupUi';
import { PoishaText } from '../ledger/ledgerUi';
import { inventoryApi, type StockBalance } from '../../inventory/api';
import { isNegativeQuantity, type InventoryRefs } from './inventoryUi';

export function ValuationPanel({ companyId, refs, refreshKey }: { companyId: string; refs: InventoryRefs; refreshKey: number }) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StockBalance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await inventoryApi.balances(companyId, {
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(warehouseId ? { warehouseId } : {}),
        includeZero,
        page,
        pageSize,
      });
      setRows(result.balances);
      setTotal(result.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, search, warehouseId, includeZero, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const totalValue = useMemo(() => rows.reduce((sum, row) => sum + BigInt(row.valuePoisha), 0n), [rows]);
  const negative = rows.filter((row) => isNegativeQuantity(row.quantity));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold text-ink-900">{L('Stock valuation', 'স্টক মূল্যায়ন')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L('Weighted-average value by item and warehouse, derived from immutable movements. A negative quantity is an approved exception, never a hidden default.', 'অপরিবর্তনীয় মুভমেন্ট থেকে আইটেম ও গুদামভিত্তিক ভারিত গড় মূল্য। নেতিবাচক পরিমাণ অনুমোদিত ব্যতিক্রম, গোপন ডিফল্ট নয়।')}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">{L('Rows on page', 'পৃষ্ঠার সারি')}</p>
          <p className="mt-1 font-mono text-[22px] font-semibold text-ink-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">{L('Value on page', 'পৃষ্ঠার মূল্য')}</p>
          <p className="mt-1 font-mono text-[22px] font-semibold text-ink-900"><PoishaText value={totalValue.toString()} /></p>
        </div>
        <div className={`rounded-2xl border p-3 shadow-sm ${negative.length > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-line bg-surface'}`}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">{L('Negative balances', 'নেতিবাচক ব্যালেন্স')}</p>
          <p className="mt-1 font-mono text-[22px] font-semibold text-ink-900">{negative.length}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className={`${INPUT_CLASS} pl-9`} placeholder={L('Search item or warehouse', 'আইটেম বা গুদাম খুঁজুন')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <select className={`${INPUT_CLASS} w-auto`} value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
            <option value="">{L('All warehouses', 'সব গুদাম')}</option>
            {refs.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.nameEn}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={includeZero} onChange={(event) => { setIncludeZero(event.target.checked); setPage(1); }} />
            {L('Include zero balances', 'শূন্য ব্যালেন্স সহ')}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr>
                <th className="px-3 py-2">{L('Item', 'আইটেম')}</th>
                <th className="px-3 py-2">{L('Warehouse', 'গুদাম')}</th>
                <th className="px-3 py-2 text-right">{L('Quantity', 'পরিমাণ')}</th>
                <th className="px-3 py-2 text-right">{L('Weighted unit cost', 'ভারিত একক ব্যয়')}</th>
                <th className="px-3 py-2 text-right">{L('Value', 'মূল্য')}</th>
                <th className="px-3 py-2">{L('Updated', 'হালনাগাদ')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No stock balances.', 'কোনো স্টক ব্যালেন্স নেই।')}</td></tr>
              ) : rows.map((row) => (
                <tr key={`${row.itemId}-${row.warehouseId}`}>
                  <td className="px-3 py-2"><p className="font-semibold">{row.itemSku}</p><p className="text-[12px] text-ink-500">{row.itemName}</p></td>
                  <td className="px-3 py-2">{row.warehouseCode} · {row.warehouseName}</td>
                  <td className={`px-3 py-2 text-right font-mono text-[12px] ${isNegativeQuantity(row.quantity) ? 'text-rose-700 dark:text-rose-300' : ''}`}>{row.quantity} {row.unit}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">{row.weightedUnitCostBdt}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]"><PoishaText value={row.valuePoisha} /></td>
                  <td className="px-3 py-2 text-[12px] text-ink-500">{new Date(row.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-ink-500">
          <span>{L(`${total} balances`, `${total} ব্যালেন্স`)}</span>
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
