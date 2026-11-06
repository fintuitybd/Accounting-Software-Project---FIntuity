import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Search } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { dateToday, newIdempotencyKey, PoishaText } from '../ledger/ledgerUi';
import { inventoryApi, type StockMovement } from '../../inventory/api';
import { MOVEMENT_TYPE_LABELS, movementTone, movementTypeLabel, type InventoryRefs } from './inventoryUi';

export function StockLedgerPanel({
  companyId,
  refs,
  canDispatch,
  canOverride,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  refs: InventoryRefs;
  canDispatch: boolean;
  canOverride: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await inventoryApi.movements(companyId, {
        ...(itemId ? { itemId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
        ...(movementType ? { movementType } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        page,
        pageSize,
      });
      setEntries(result.movements);
      setTotal(result.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, itemId, warehouseId, movementType, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const reverse = async (movement: StockMovement) => {
    if (
      !window.confirm(
        L(
          `Reverse the stock command for ${movement.itemSku} at ${movement.warehouseCode}? A new reversing movement and, where present, a linked reversal journal will be posted. The original remains in history.`,
          `${movement.itemSku} — ${movement.warehouseCode}-এর স্টক কমান্ড রিভার্স করবেন? একটি নতুন রিভার্সিং মুভমেন্ট এবং প্রয়োজনে লিংকড রিভার্সাল জার্নাল পোস্ট হবে। মূলটি ইতিহাসে থাকবে।`,
        ),
      )
    ) {
      return;
    }
    const reason = window.prompt(L('Reversal reason (3–500 characters)', 'রিভার্সালের কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    const date = window.prompt(L('Reversal date (YYYY-MM-DD)', 'রিভার্সালের তারিখ (YYYY-MM-DD)'), dateToday());
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setError(null);
    try {
      const result = await inventoryApi.reverseCommand(
        companyId,
        movement.commandId,
        { date, reason: reason.trim() },
        newIdempotencyKey(),
      );
      setNotice(L(`Reversal recorded: ${result.movements.length} movement(s).`, `রিভার্সাল রেকর্ড হয়েছে: ${result.movements.length} মুভমেন্ট।`));
      onChanged();
      await load();
    } catch (caught) {
      const message = apiErrorMessage(caught);
      const code = (caught as { code?: string }).code;
      if (code === 'STOCK_INSUFFICIENT' && canOverride) {
        const overrideReason = window.prompt(
          L(
            'Reversing this receipt would create negative stock. Enter an override reason to continue as controller, or cancel.',
            'এই গ্রহণ রিভার্স করলে নেতিবাচক স্টক হবে। নিয়ন্ত্রক হিসেবে চালিয়ে যেতে ওভাররাইডের কারণ লিখুন, অথবা বাতিল করুন।',
          ),
        );
        if (!overrideReason || overrideReason.trim().length < 3) {
          setError(message);
          return;
        }
        try {
          const result = await inventoryApi.reverseCommand(
            companyId,
            movement.commandId,
            { date, reason: reason.trim(), overrideReason: overrideReason.trim() },
            newIdempotencyKey(),
          );
          setNotice(L(`Reversal recorded with a negative-stock override: ${result.movements.length} movement(s).`, `নেতিবাচক স্টক ওভাররাইডসহ রিভার্সাল রেকর্ড হয়েছে: ${result.movements.length} মুভমেন্ট।`));
          onChanged();
          await load();
          return;
        } catch (retryError) {
          setError(apiErrorMessage(retryError));
          return;
        }
      }
      setError(message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold text-ink-900">{L('Stock ledger', 'স্টক লেজার')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L('Immutable movements with source, actor, value and the resulting balance. Reverse a command to correct it; never edit history.', 'উৎস, কর্তা, মূল্য ও ফলাফল ব্যালেন্সসহ অপরিবর্তনীয় মুভমেন্ট। সংশোধনে কমান্ড রিভার্স করুন; ইতিহাস সম্পাদনা করবেন না।')}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <select className={`${INPUT_CLASS} w-auto`} value={itemId} onChange={(event) => { setItemId(event.target.value); setPage(1); }}>
            <option value="">{L('All items', 'সব আইটেম')}</option>
            {refs.items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.nameEn}</option>)}
          </select>
          <select className={`${INPUT_CLASS} w-auto`} value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
            <option value="">{L('All warehouses', 'সব গুদাম')}</option>
            {refs.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.nameEn}</option>)}
          </select>
          <select className={`${INPUT_CLASS} w-auto`} value={movementType} onChange={(event) => { setMovementType(event.target.value); setPage(1); }}>
            <option value="">{L('All movement types', 'সব মুভমেন্ট ধরন')}</option>
            {Object.entries(MOVEMENT_TYPE_LABELS).map(([key, labels]) => <option key={key} value={key}>{L(...labels)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
            {L('From', 'হতে')} <input className={`${INPUT_CLASS} w-auto`} type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
            {L('To', 'পর্যন্ত')} <input className={`${INPUT_CLASS} w-auto`} type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </label>
          <span className="inline-flex items-center gap-1 text-[12px] text-ink-400"><Search size={13} />{L('Filters apply server-side', 'ফিল্টার সার্ভারে প্রয়োগ হয়')}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr>
                <th className="px-3 py-2">{L('Date', 'তারিখ')}</th>
                <th className="px-3 py-2">{L('Item / warehouse', 'আইটেম / গুদাম')}</th>
                <th className="px-3 py-2">{L('Type', 'ধরন')}</th>
                <th className="px-3 py-2 text-right">{L('Quantity', 'পরিমাণ')}</th>
                <th className="px-3 py-2 text-right">{L('Unit cost', 'একক ব্যয়')}</th>
                <th className="px-3 py-2 text-right">{L('Value', 'মূল্য')}</th>
                <th className="px-3 py-2 text-right">{L('Balance after', 'পরবর্তী ব্যালেন্স')}</th>
                <th className="px-3 py-2">{L('Journal', 'জার্নাল')}</th>
                <th className="px-3 py-2">{L('Source / actor', 'উৎস / কর্তা')}</th>
                <th className="px-3 py-2 text-right">{L('Action', 'কার্যক্রম')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {entries.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No stock movements match the filters.', 'ফিল্টারে কোনো স্টক মুভমেন্ট নেই।')}</td></tr>
              ) : entries.map((movement) => (
                <tr key={movement.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-[12px]">{movement.movementDate}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{movement.itemSku}</p>
                    <p className="text-[12px] text-ink-500">{movement.warehouseCode} · {movement.warehouseName}</p>
                  </td>
                  <td className={`px-3 py-2 font-semibold ${movementTone(movement.movementType)}`}>
                    {movementTypeLabel(movement.movementType, L)}
                    {movement.negativeStockOverride ? <p className="mt-1 text-[12px] font-normal text-amber-700 dark:text-amber-300">{L('Negative override', 'নেতিবাচক ওভাররাইড')}</p> : null}
                    {movement.reversalOfMovementId ? <p className="mt-1 text-[12px] font-normal text-ink-500">{L('Linked reversal', 'লিংকড রিভার্সাল')}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">{movement.quantity} {movement.unit}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">{movement.unitCostBdt}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]"><PoishaText value={movement.valuePoisha} /></td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">{movement.balanceAfterQuantity}<br /><span className="text-ink-500">{movement.balanceAfterValueBdt}</span></td>
                  <td className="px-3 py-2 font-mono text-[12px]">{movement.journalNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-[12px] text-ink-600">{movement.sourceRef ?? movement.sourceType}<br />{movement.createdByName} · {new Date(movement.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    {canDispatch && movement.movementNo === 1 && !movement.reversalOfMovementId && !movement.isReversed ? (
                      <button type="button" onClick={() => void reverse(movement)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">
                        <RotateCcw size={12} /> {L('Reverse', 'রিভার্স')}
                      </button>
                    ) : movement.isReversed ? (
                      <span className="text-[12px] text-ink-400">{L('Reversed', 'রিভার্সড')}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-ink-500">
          <span>{L(`${total} movements`, `${total} মুভমেন্ট`)}</span>
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
