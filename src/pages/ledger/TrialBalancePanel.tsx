import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Scale } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { FiscalPeriod } from '../../setup/api';
import { ledgerApi, type TrialBalance, type TrialBalanceDrill } from '../../ledger/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { formatDate, poishaToBdtString } from './ledgerUi';

function Amount({ value }: { value: string }) {
  const poisha = BigInt(value);
  if (poisha === 0n) return <span className="text-ink-300">—</span>;
  return <span className="font-mono tabular-nums">{poishaToBdtString(poisha)}</span>;
}

export function TrialBalancePanel({
  companyId,
  periods,
  refreshToken,
  onOpenJournal,
}: {
  companyId: string;
  periods: FiscalPeriod[];
  refreshToken: number;
  onOpenJournal: (journalId: string) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const defaultPeriod = periods.find((period) => period.status === 'OPEN') ?? periods[0];
  const [periodId, setPeriodId] = useState(defaultPeriod?.id ?? '');
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [drill, setDrill] = useState<TrialBalanceDrill | null>(null);
  const [drillAccountId, setDrillAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!periodId && defaultPeriod?.id) setPeriodId(defaultPeriod.id);
  }, [defaultPeriod?.id, periodId]);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await ledgerApi.trialBalance(companyId, { periodId });
      setTrialBalance(response.trialBalance);
      if (drillAccountId) {
        const selectedDrill = await ledgerApi.trialBalanceAccount(companyId, drillAccountId, { periodId });
        setDrill(selectedDrill);
      }
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, drillAccountId, periodId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const totals = trialBalance?.totals;
  const selectedPeriod = useMemo(() => periods.find((period) => period.id === periodId), [periodId, periods]);

  const openDrill = async (accountId: string): Promise<void> => {
    setDrillAccountId(accountId);
    setError(null);
    try {
      setDrill(await ledgerApi.trialBalanceAccount(companyId, accountId, { periodId }));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  return (
    <section className="lv-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="lv-kicker">{L('Trial balance', 'রেওয়ামিল')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {L('Account-level proof', 'হিসাব-স্তরের প্রমাণ')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Opening, period movement and closing balances are derived only from posted journals, including linked reversals. Debits must equal credits.',
              'উদ্বোধনী, মেয়াদের চলাচল এবং সমাপনী ব্যালেন্স শুধুমাত্র পোস্ট করা জার্নাল থেকে তৈরি হয়, লিংকড রিভার্সালসহ। ডেবিট ও ক্রেডিট সমান হতে হবে।',
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-ink-600">
            <span className="sr-only">{L('Accounting period', 'হিসাবকাল')}</span>
            <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="lv-select min-h-11 text-[13px]">
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.code} — {period.status}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void load()} disabled={loading} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {!trialBalance && !error ? (
        <div className="mt-4"><Notice message={L('Choose a period to load the trial balance.', 'রেওয়ামিল দেখতে একটি হিসাবকাল নির্বাচন করুন।')} /></div>
      ) : null}

      {trialBalance && totals ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`lv-chip ${trialBalance.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              <Scale size={12} />
              {trialBalance.balanced
                ? L('Debits equal credits', 'ডেবিট ও ক্রেডিট সমান')
                : L('Out of balance', 'অসামঞ্জস্য')}
            </span>
            <span className="lv-chip lv-chip-neutral">
              {selectedPeriod ? selectedPeriod.label : `${formatDate(trialBalance.from, locale)} – ${formatDate(trialBalance.to, locale)}`}
            </span>
            {!trialBalance.balanced ? (
              <span className="text-[12px] font-semibold text-rose-600">
                {L('Difference', 'পার্থক্য')}: {poishaToBdtString(BigInt(totals.differencePoisha))}
              </span>
            ) : null}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="lv-table w-full min-w-[900px] text-[13px]">
              <caption className="sr-only">{L('Trial balance by account', 'হিসাব অনুযায়ী রেওয়ামিল')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">{L('Code', 'কোড')}</th>
                  <th scope="col" className="text-left">{L('Account', 'হিসাব')}</th>
                  <th scope="col" className="text-right">{L('Opening Dr', 'উদ্বোধনী ডেবিট')}</th>
                  <th scope="col" className="text-right">{L('Opening Cr', 'উদ্বোধনী ক্রেডিট')}</th>
                  <th scope="col" className="text-right">{L('Period Dr', 'মেয়াদ ডেবিট')}</th>
                  <th scope="col" className="text-right">{L('Period Cr', 'মেয়াদ ক্রেডিট')}</th>
                  <th scope="col" className="text-right">{L('Closing Dr', 'সমাপনী ডেবিট')}</th>
                  <th scope="col" className="text-right">{L('Closing Cr', 'সমাপনী ক্রেডিট')}</th>
                  <th scope="col" className="text-right">{L('Drill', 'ড্রিল')}</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-ink-500">{L('No posted movements in this period.', 'এই মেয়াদে কোনো পোস্টেড লেনদেন নেই।')}</td>
                  </tr>
                ) : (
                  trialBalance.rows.map((row) => (
                    <tr key={row.accountId}>
                      <td className="font-mono text-ink-500">{row.accountCode}</td>
                      <td>
                        <button type="button" onClick={() => void openDrill(row.accountId)} className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline">
                          {row.accountNameEn}
                        </button>
                        <span className="ml-2 text-[12px] uppercase tracking-[0.04em] text-ink-400">{row.accountType}</span>
                      </td>
                      <td className="text-right"><Amount value={row.openingDebitPoisha} /></td>
                      <td className="text-right"><Amount value={row.openingCreditPoisha} /></td>
                      <td className="text-right"><Amount value={row.periodDebitPoisha} /></td>
                      <td className="text-right"><Amount value={row.periodCreditPoisha} /></td>
                      <td className="text-right"><Amount value={row.closingDebitPoisha} /></td>
                      <td className="text-right"><Amount value={row.closingCreditPoisha} /></td>
                      <td className="text-right">
                        <button type="button" onClick={() => void openDrill(row.accountId)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-bright hover:underline">
                          {L('Lines', 'লাইন')} <ArrowUpRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="text-right text-[12px] uppercase tracking-[0.05em] text-ink-400">{L('Totals', 'মোট')}</th>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.openingDebitPoisha))}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.openingCreditPoisha))}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.periodDebitPoisha))}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.periodCreditPoisha))}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.closingDebitPoisha))}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(totals.closingCreditPoisha))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {drill ? (
            <div className="mt-6 rounded-xl border border-line bg-surface-2/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold text-ink-900">
                    {drill.account.accountCode} — {drill.account.accountNameEn}
                  </h3>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {L('Opening net', 'উদ্বোধনী নিট')}: {poishaToBdtString(BigInt(drill.account.openingNetPoisha))} ·{' '}
                    {L('Closing net', 'সমাপনী নিট')}: {poishaToBdtString(BigInt(drill.account.closingNetPoisha))}
                  </p>
                </div>
                <button type="button" onClick={() => { setDrill(null); setDrillAccountId(null); }} className="lv-btn lv-btn-ghost min-h-11 text-[13px]">
                  {L('Close drill-down', 'ড্রিল-ডাউন বন্ধ')}
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="lv-table w-full min-w-[720px] text-[13px]">
                  <caption className="sr-only">{L('Journal lines for the selected account', 'নির্বাচিত হিসাবের জার্নাল লাইন')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                      <th scope="col" className="text-left">{L('Journal', 'জার্নাল')}</th>
                      <th scope="col" className="text-left">{L('Narration', 'বিবরণ')}</th>
                      <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
                      <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
                      <th scope="col" className="text-right">{L('Running', 'চলমান')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.lines.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-ink-500">{L('No posted lines for this account in the period.', 'এই মেয়াদে এই হিসাবে কোনো পোস্টেড লাইন নেই।')}</td></tr>
                    ) : (
                      drill.lines.map((line, index) => (
                        <tr key={`${line.journalId}-${line.lineNo}-${index}`}>
                          <td>{formatDate(line.postingDate, locale)}</td>
                          <td>
                            <button type="button" onClick={() => onOpenJournal(line.journalId)} className="font-mono text-brand-bright hover:underline">
                              {line.journalNumber ?? line.journalId.slice(0, 8)}
                            </button>
                            {line.reversalJournalNumber ? (
                              <span className="ml-1 text-[12px] text-rose-600">→ {line.reversalJournalNumber}</span>
                            ) : null}
                          </td>
                          <td className="text-ink-600">{line.narration}</td>
                          <td className="text-right"><Amount value={line.debitPoisha} /></td>
                          <td className="text-right"><Amount value={line.creditPoisha} /></td>
                          <td className="text-right font-mono tabular-nums">{poishaToBdtString(BigInt(line.runningNetPoisha))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default TrialBalancePanel;
