import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, RefreshCw, Scale } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { dateToday, PoishaText } from '../ledger/ledgerUi';
import { inventoryApi, type InventoryControlProof } from '../../inventory/api';
import { isNegativeQuantity } from './inventoryUi';

export function ControlProofPanel({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [asOf, setAsOf] = useState(dateToday());
  const [proof, setProof] = useState<InventoryControlProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await inventoryApi.controlProof(companyId, asOf);
      setProof(result.proof);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, asOf]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold text-ink-900">{L('Inventory control proof', 'ইনভেন্টরি নিয়ন্ত্রণ প্রমাণ')}</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Server-derived stock value compared with the inventory GL by account. A difference is shown as an exception; it is never plugged or hidden.',
              'সার্ভার-প্রাপ্ত স্টক মূল্য হিসাবভিত্তিক ইনভেন্টরি জিএলের সঙ্গে তুলনা করা হয়। পার্থক্য ব্যতিক্রম হিসেবে দেখানো হয়; কখনও সমন্বয় বা লুকানো হয় না।',
            )}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[12px] font-semibold text-ink-600">
            {L('As of', 'তারিখ অনুযায়ী')}
            <input className={`${INPUT_CLASS} mt-1 w-auto`} type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {proof ? (
        <>
          {proof.differences.length === 0 ? (
            <Notice message={L('Stock valuation reconciles to the inventory GL for every account in scope.', 'সব হিসাবে স্টক মূল্যায়ন ইনভেন্টরি জিএলের সঙ্গে মিলেছে।')} tone="success" />
          ) : (
            <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-900 dark:text-amber-200">
              <p className="inline-flex items-start gap-2 font-semibold"><CircleAlert size={16} className="mt-0.5 shrink-0" />{L(`${proof.differences.length} inventory account(s) do not reconcile. Investigate the source journals; do not post a plug.`, `${proof.differences.length} ইনভেন্টরি হিসাব মেলেনি। উৎস জার্নাল তদন্ত করুন; সমন্বয় এন্ট্রি দিয়ে ঢেকে দেবেন না।`)}</p>
            </div>
          )}

          <section className="rounded-2xl border border-line bg-surface shadow-sm">
            <div className="flex items-center gap-2 border-b border-line p-3">
              <Scale size={16} className="text-ink-500" />
              <h3 className="text-[15px] font-semibold text-ink-900">{L('Account-level proof', 'হিসাবভিত্তিক প্রমাণ')}</h3>
              <span className="ml-auto text-[12px] text-ink-500">{L('As of', 'তারিখ')} {proof.asOfDate}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2">{L('Inventory account', 'ইনভেন্টরি হিসাব')}</th>
                    <th className="px-3 py-2 text-right">{L('Stock value', 'স্টক মূল্য')}</th>
                    <th className="px-3 py-2 text-right">{L('GL balance', 'জিএল ব্যালেন্স')}</th>
                    <th className="px-3 py-2 text-right">{L('Difference', 'পার্থক্য')}</th>
                    <th className="px-3 py-2 text-right">{L('Items', 'আইটেম')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
                  {proof.accounts.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[13px] text-ink-400">{L('No inventory accounts are configured.', 'কোনো ইনভেন্টরি হিসাব কনফিগার করা নেই।')}</td></tr>
                  ) : proof.accounts.map((account) => {
                    const difference = BigInt(account.differencePoisha);
                    return (
                      <tr key={account.accountId} className={difference !== 0n ? 'bg-amber-500/5' : ''}>
                        <td className="px-3 py-2"><p className="font-mono text-[12px]">{account.accountCode}</p><p className="font-semibold">{account.accountNameEn}</p></td>
                        <td className="px-3 py-2 text-right font-mono text-[12px]"><PoishaText value={account.stockValuePoisha} /></td>
                        <td className="px-3 py-2 text-right font-mono text-[12px]"><PoishaText value={account.glBalancePoisha} /></td>
                        <td className={`px-3 py-2 text-right font-mono text-[12px] font-semibold ${difference !== 0n ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-300'}`}><PoishaText value={account.differencePoisha} /></td>
                        <td className="px-3 py-2 text-right font-mono text-[12px]">{account.itemCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface shadow-sm">
            <div className="border-b border-line p-3">
              <h3 className="text-[15px] font-semibold text-ink-900">{L('Valuation by item and warehouse', 'আইটেম ও গুদামভিত্তিক মূল্যায়ন')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2">{L('Item', 'আইটেম')}</th>
                    <th className="px-3 py-2">{L('Account', 'হিসাব')}</th>
                    <th className="px-3 py-2 text-right">{L('Quantity', 'পরিমাণ')}</th>
                    <th className="px-3 py-2 text-right">{L('Value', 'মূল্য')}</th>
                    <th className="px-3 py-2">{L('Warehouses', 'গুদাম')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
                  {proof.items.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[13px] text-ink-400">{L('No stock valuation in scope for this date.', 'এই তারিখে কোনো স্টক মূল্যায়ন নেই।')}</td></tr>
                  ) : proof.items.map((item) => (
                    <tr key={item.itemId} className="align-top">
                      <td className="px-3 py-2"><p className="font-semibold">{item.sku}</p><p className="text-[12px] text-ink-500">{item.nameEn}</p></td>
                      <td className="px-3 py-2 font-mono text-[12px]">{item.inventoryAccountCode}</td>
                      <td className={`px-3 py-2 text-right font-mono text-[12px] ${isNegativeQuantity(item.quantity) ? 'text-rose-700 dark:text-rose-300' : ''}`}>{item.quantity} {item.unit}</td>
                      <td className="px-3 py-2 text-right font-mono text-[12px]"><PoishaText value={item.valuePoisha} /></td>
                      <td className="px-3 py-2 text-[12px] text-ink-600">{item.warehouses.map((warehouse) => `${warehouse.warehouseCode}: ${warehouse.quantity} / ${warehouse.valuePoisha}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
