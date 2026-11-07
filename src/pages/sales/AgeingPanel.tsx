import { useCallback, useEffect, useState } from 'react';
import { Download, FileSearch } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { salesApi, type ArAgeing, type CustomerStatement } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import type { SalesRefs } from './salesRefs';
import { EmptyState, SALES_INPUT, SALES_SELECT, formatDate, todayIso } from './salesUi';

const BUCKET_LABELS: Array<{ key: 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_180' | 'OVER_180'; en: string; bn: string }> = [
  { key: 'CURRENT', en: 'Current', bn: 'চলতি' },
  { key: '1_30', en: '1–30 days', bn: '১–৩০ দিন' },
  { key: '31_60', en: '31–60 days', bn: '৩১–৬০ দিন' },
  { key: '61_90', en: '61–90 days', bn: '৬১–৯০ দিন' },
  { key: '91_180', en: '91–180 days', bn: '৯১–১৮০ দিন' },
  { key: 'OVER_180', en: 'Over 180 days', bn: '১৮০+ দিন' },
];

function bdt(value: string): string {
  try {
    const poisha = BigInt(value);
    const negative = poisha < 0n;
    const absolute = negative ? -poisha : poisha;
    return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

export function AgeingPanel({ companyId, refs }: { companyId: string; refs: SalesRefs }) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [asOf, setAsOf] = useState(todayIso());
  const [partyId, setPartyId] = useState('');
  const [ageing, setAgeing] = useState<ArAgeing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statementPartyId, setStatementPartyId] = useState('');
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState(todayIso());
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);
  const customers = refs.parties.filter((party) => party.type === 'CUSTOMER' || party.type === 'BOTH');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await salesApi.ageing(companyId, asOf, partyId || undefined);
      setAgeing(response.ageing);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [asOf, companyId, partyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadStatement = async () => {
    if (!statementPartyId || !statementFrom || !statementTo) {
      setStatementError(L('Choose a customer and a complete date range.', 'গ্রাহক ও সম্পূর্ণ তারিখ পরিসর নির্বাচন করুন।'));
      return;
    }
    setStatementLoading(true);
    setStatementError(null);
    try {
      const response = await salesApi.statement(companyId, statementPartyId, statementFrom, statementTo);
      setStatement(response.statement);
    } catch (caught) {
      setStatementError(apiErrorMessage(caught));
    } finally {
      setStatementLoading(false);
    }
  };

  const exportAgeing = () => {
    if (!ageing) return;
    const header = ['Customer', 'Document', 'Serial', 'Doc date', 'Due date', 'Gross', 'Allocated', 'Credited', 'Outstanding', 'Bucket'];
    const rows = ageing.rows.map((row) => [
      row.partyNameEn,
      row.documentNo ?? '',
      row.statutorySerial ?? '',
      row.docDate,
      row.dueDate,
      row.grossBdt,
      bdt(row.allocatedPoisha),
      bdt(row.creditedPoisha),
      row.outstandingBdt,
      row.bucket,
    ]);
    const credits = ageing.credits.map((credit) => [
      credit.partyNameEn,
      credit.receiptNumber,
      'Unapplied receipt',
      credit.receiptDate,
      '',
      '',
      '',
      '',
      `-${credit.unappliedBdt}`,
      'CREDIT',
    ]);
    const csv = [header, ...rows, ...credits]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ar-ageing-${asOf}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <section className="ql-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ql-kicker">{L('Receivables control', 'প্রাপ্য নিয়ন্ত্রণ')}</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('AR ageing and control proof', 'এআর এজিং ও নিয়ন্ত্রণ প্রমাণ')}</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              {L(
                'Outstanding is derived from posted invoices less posted receipt allocations and posted credit notes. It is never a mutable settled flag. The control proof compares the derived subledger to the AR control account.',
                'বাকি পরিমাণ পোস্টকৃত চালান থেকে পোস্টকৃত রিসিট বরাদ্দ ও পোস্টকৃত ক্রেডিট নোট বাদ দিয়ে নির্ধারিত হয়। এটি কখনও পরিবর্তনযোগ্য সেটেলড ফ্ল্যাগ নয়। নিয়ন্ত্রণ প্রমাণ এআর নিয়ন্ত্রণ হিসাবের সাথে তুলনা করে।',
              )}
            </p>
          </div>
          <button type="button" onClick={exportAgeing} disabled={!ageing} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
            <Download size={15} /> {L('Export CSV', 'সিএসভি রপ্তানি')}
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('As of date', 'তারিখ অনুযায়ী')}
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className={`${SALES_INPUT} mt-1`} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600 sm:col-span-2">
            {L('Customer filter', 'গ্রাহক ফিল্টার')}
            <select value={partyId} onChange={(event) => setPartyId(event.target.value)} className={`${SALES_SELECT} mt-1`}>
              <option value="">{L('All customers', 'সব গ্রাহক')}</option>
              {customers.map((party) => <option key={party.id} value={party.id}>{party.code} · {party.nameEn}</option>)}
            </select>
          </label>
        </div>
        {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
        {loading ? <div className="mt-3"><Notice message={L('Loading ageing…', 'এজিং লোড হচ্ছে…')} tone="info" /></div> : null}
        {ageing ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
              {BUCKET_LABELS.map((bucket) => (
                <div key={bucket.key} className="rounded-xl border border-line bg-surface-2/40 p-3">
                  <p className="text-[12px] text-ink-400">{L(bucket.en, bucket.bn)}</p>
                  <p className="mt-1 font-money text-[14px] font-semibold text-ink-900">{bdt(ageing.totals[bucket.key])}</p>
                </div>
              ))}
              <div className="rounded-xl border border-line bg-amber-500/10 p-3">
                <p className="text-[12px] text-amber-800 dark:text-amber-200">{L('Credits', 'ক্রেডিট')}</p>
                <p className="mt-1 font-money text-[14px] font-semibold text-ink-900">{bdt(ageing.totals.CREDITS)}</p>
              </div>
            </div>
            <div className={`mt-3 rounded-xl border p-3 ${ageing.proof.agrees ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
              <p className="text-[13px] font-semibold text-ink-900">
                {ageing.proof.agrees
                  ? L('Company-wide AR control proof agrees', 'কোম্পানি-ব্যাপী এআর নিয়ন্ত্রণ প্রমাণ মিলেছে')
                  : L('Company-wide AR control proof does not agree', 'কোম্পানি-ব্যাপী এআর নিয়ন্ত্রণ প্রমাণ মেলেনি')}
              </p>
              <p className="mt-1 text-[12px] text-ink-600">
                {L('Control account', 'নিয়ন্ত্রণ হিসাব')} {ageing.proof.controlAccountCode} · {L('GL', 'জিএল')} {ageing.proof.glBalanceBdt} · {L('Subledger', 'সাবলেজার')} {ageing.proof.subledgerBdt} · {L('Difference', 'পার্থক্য')} {ageing.proof.differenceBdt}
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="ql-table w-full min-w-[980px] text-[13px]">
                <caption className="sr-only">{L('AR ageing by invoice', 'চালান অনুযায়ী এআর এজিং')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{L('Customer', 'গ্রাহক')}</th>
                    <th scope="col" className="text-left">{L('Invoice', 'চালান')}</th>
                    <th scope="col" className="text-left">{L('Due', 'পরিশোধ')}</th>
                    <th scope="col" className="text-right">{L('Gross', 'মোট')}</th>
                    <th scope="col" className="text-right">{L('Allocated', 'বরাদ্দ')}</th>
                    <th scope="col" className="text-right">{L('Credited', 'ক্রেডিট')}</th>
                    <th scope="col" className="text-right">{L('Outstanding', 'বাকি')}</th>
                    <th scope="col" className="text-left">{L('Bucket', 'বাকেট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ageing.rows.map((row) => (
                    <tr key={row.documentId}>
                      <td>{row.partyNameEn}<p className="mt-0.5 font-mono text-[12px] text-ink-400">{row.partyCode}</p></td>
                      <td><p className="font-semibold text-ink-800">{row.documentNo ?? '—'}</p><p className="mt-0.5 font-mono text-[12px] text-ink-400">{row.statutorySerial ?? '—'}</p></td>
                      <td>{formatDate(row.dueDate)}<p className="mt-0.5 text-[12px] text-ink-400">{row.daysOverdue > 0 ? `${row.daysOverdue} ${L('days overdue', 'দিন মেয়াদোত্তীর্ণ')}` : L('Not due', 'মেয়াদ হয়নি')}</p></td>
                      <td className="text-right font-money tabular-nums">{row.grossBdt}</td>
                      <td className="text-right font-money tabular-nums">{bdt(row.allocatedPoisha)}</td>
                      <td className="text-right font-money tabular-nums">{bdt(row.creditedPoisha)}</td>
                      <td className="text-right font-money tabular-nums font-semibold">{row.outstandingBdt}</td>
                      <td><span className="ql-badge ql-badge-neutral">{row.bucket.replaceAll('_', ' ')}</span></td>
                    </tr>
                  ))}
                  {ageing.credits.map((credit) => (
                    <tr key={credit.receiptId}>
                      <td>{credit.partyNameEn}<p className="mt-0.5 font-mono text-[12px] text-ink-400">{credit.partyCode}</p></td>
                      <td><p className="font-semibold text-ink-800">{credit.receiptNumber}</p><p className="mt-0.5 text-[12px] text-ink-400">{L('Unapplied receipt', 'অব্যবহৃত রিসিট')}</p></td>
                      <td>{formatDate(credit.receiptDate)}</td>
                      <td className="text-right">—</td>
                      <td className="text-right">—</td>
                      <td className="text-right">—</td>
                      <td className="text-right font-money tabular-nums text-rose-700 dark:text-rose-300">-{credit.unappliedBdt}</td>
                      <td><span className="ql-badge ql-badge-warn">{L('Credit', 'ক্রেডিট')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ageing.rows.length === 0 && ageing.credits.length === 0 ? (
              <div className="mt-3"><EmptyState title={L('No open receivables', 'কোনো খোলা প্রাপ্য নেই')} hint={L('Posted invoices with an outstanding balance will appear here.', 'বাকি ব্যালেন্সসহ পোস্টকৃত চালান এখানে দেখা যাবে।')} /></div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="ql-card p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <FileSearch size={18} className="text-brand-bright" />
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink-900">{L('Customer statement', 'গ্রাহক বিবরণী')}</h2>
        </div>
        <p className="mt-1 text-[13px] text-ink-500">{L('Opening balance, invoices, credit notes, receipts and write-offs with a running balance.', 'প্রারম্ভিক ব্যালেন্স, চালান, ক্রেডিট নোট, রিসিট ও রাইট-অফসহ চলমান ব্যালেন্স।')}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <label className="block text-[12px] font-semibold text-ink-600 sm:col-span-2">
            {L('Customer', 'গ্রাহক')}
            <select value={statementPartyId} onChange={(event) => setStatementPartyId(event.target.value)} className={`${SALES_SELECT} mt-1`}>
              <option value="">{L('Choose a customer', 'গ্রাহক নির্বাচন করুন')}</option>
              {customers.map((party) => <option key={party.id} value={party.id}>{party.code} · {party.nameEn}</option>)}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('From', 'থেকে')}
            <input type="date" value={statementFrom} onChange={(event) => setStatementFrom(event.target.value)} className={`${SALES_INPUT} mt-1`} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('To', 'পর্যন্ত')}
            <input type="date" value={statementTo} onChange={(event) => setStatementTo(event.target.value)} className={`${SALES_INPUT} mt-1`} />
          </label>
        </div>
        <button type="button" onClick={() => void loadStatement()} disabled={statementLoading} className="ql-btn ql-btn-secondary mt-3 min-h-11 text-[13px]">
          {statementLoading ? L('Loading…', 'লোড হচ্ছে…') : L('Load statement', 'বিবরণী লোড')}
        </button>
        {statementError ? <div className="mt-3"><ErrorBanner message={statementError} /></div> : null}
        {statement ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-ink-900">{statement.partyNameEn}</h3>
              <p className="text-[12px] text-ink-500">{statement.from} → {statement.to}</p>
            </div>
            <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5"><p className="text-[12px] text-ink-400">{L('Opening', 'প্রারম্ভিক')}</p><p className="mt-0.5 font-money font-semibold">{statement.openingBdt}</p></div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5"><p className="text-[12px] text-ink-400">{L('Closing', 'সমাপনী')}</p><p className="mt-0.5 font-money font-semibold">{statement.closingBdt}</p></div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5"><p className="text-[12px] text-ink-400">{L('Debits / credits', 'ডেবিট / ক্রেডিট')}</p><p className="mt-0.5 font-money font-semibold">{bdt(statement.debitsPoisha)} / {bdt(statement.creditsPoisha)}</p></div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="ql-table w-full min-w-[760px] text-[13px]">
                <caption className="sr-only">{L('Customer statement lines', 'গ্রাহক বিবরণীর লাইন')}</caption>
                <thead><tr><th scope="col" className="text-left">{L('Date', 'তারিখ')}</th><th scope="col" className="text-left">{L('Reference', 'রেফারেন্স')}</th><th scope="col" className="text-left">{L('Detail', 'বিবরণ')}</th><th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th><th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th><th scope="col" className="text-right">{L('Balance', 'ব্যালেন্স')}</th></tr></thead>
                <tbody>
                  {statement.lines.map((line) => (
                    <tr key={`${line.kind}-${line.id}`}>
                      <td>{formatDate(line.date)}</td>
                      <td className="font-mono text-[12px]">{line.reference}</td>
                      <td>{line.memo}</td>
                      <td className="text-right font-money tabular-nums">{line.debitBdt === '0.00' ? '—' : line.debitBdt}</td>
                      <td className="text-right font-money tabular-nums">{line.creditBdt === '0.00' ? '—' : line.creditBdt}</td>
                      <td className="text-right font-money tabular-nums font-semibold">{line.balanceBdt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
