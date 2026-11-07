import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { salesApi, type VatRegister } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { EmptyState, SALES_INPUT, formatDate } from './salesUi';

export function VatRegisterPanel({ companyId }: { companyId: string }) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEndDate = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
  monthEndDate.setUTCDate(0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [register, setRegister] = useState<VatRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const response = await salesApi.vatRegister(companyId, from, to);
      setRegister(response.register);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    if (!register) return;
    const header = ['Date', 'Type', 'Document', 'Mushak serial', 'Customer', 'BIN', 'Description', 'Category', 'Rate %', 'Base', 'VAT'];
    const rows = register.rows.map((row) => [
      row.docDate,
      row.docType === 'SALES_INVOICE' ? 'Invoice' : 'Credit note',
      row.documentNo,
      row.statutorySerial ?? '',
      row.partyNameEn,
      row.partyBin ?? '',
      row.description,
      row.taxCategory,
      (row.rateBps / 100).toFixed(2),
      row.baseBdt,
      row.vatBdt,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sales-vat-register-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="ql-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{L('Internal VAT evidence', 'অভ্যন্তরীণ ভ্যাট প্রমাণ')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Sales VAT register', 'বিক্রয় ভ্যাট রেজিস্টার')}</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'This is an internal register built from posted line-level tax evidence. Credit notes reduce the period as negative rows and reversed documents are excluded. It is not a filed return.',
              'এটি পোস্টকৃত লাইন-স্তরের কর প্রমাণ থেকে তৈরি অভ্যন্তরীণ রেজিস্টার। ক্রেডিট নোট ঋণাত্মক সারি হিসেবে সময়কাল কমায় এবং বাতিল ডকুমেন্ট বাদ যায়। এটি দাখিলকৃত রিটার্ন নয়।',
            )}
          </p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!register} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
          <FileText size={15} /> {L('Export CSV', 'সিএসভি রপ্তানি')}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('From', 'থেকে')}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`${SALES_INPUT} mt-1`} />
        </label>
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('To', 'পর্যন্ত')}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`${SALES_INPUT} mt-1`} />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => void load()} disabled={loading} className="ql-btn ql-btn-secondary min-h-11 w-full text-[13px]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Apply range', 'পরিসর প্রয়োগ')}
          </button>
        </div>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {register ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="ql-badge ql-badge-warn">{register.label}</span>
            <span className="text-[12px] text-ink-500">{register.from} → {register.to}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2/40 p-3">
              <p className="text-[12px] text-ink-400">{L('Taxable value', 'করযোগ্য মূল্য')}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{register.totals.baseBdt}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface-2/40 p-3">
              <p className="text-[12px] text-ink-400">{L('Output VAT', 'আউটপুট ভ্যাট')}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{register.totals.vatBdt}</p>
            </div>
          </div>
          {register.rows.length === 0 ? (
            <div className="mt-4"><EmptyState title={L('No posted sales tax evidence in this range', 'এই পরিসরে পোস্টকৃত বিক্রয় কর প্রমাণ নেই')} hint={L('Post a sales invoice or credit note to populate the internal register.', 'অভ্যন্তরীণ রেজিস্টার পূরণ করতে বিক্রয় চালান বা ক্রেডিট নোট পোস্ট করুন।')} /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="ql-table w-full min-w-[1050px] text-[13px]">
                <caption className="sr-only">{L('Sales VAT register lines', 'বিক্রয় ভ্যাট রেজিস্টার লাইন')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                    <th scope="col" className="text-left">{L('Document', 'ডকুমেন্ট')}</th>
                    <th scope="col" className="text-left">{L('Mushak serial', 'মূসক সিরিয়াল')}</th>
                    <th scope="col" className="text-left">{L('Customer', 'গ্রাহক')}</th>
                    <th scope="col" className="text-left">{L('Description', 'বিবরণ')}</th>
                    <th scope="col" className="text-left">{L('Category', 'শ্রেণি')}</th>
                    <th scope="col" className="text-right">{L('Rate', 'হার')}</th>
                    <th scope="col" className="text-right">{L('Base', 'বেস')}</th>
                    <th scope="col" className="text-right">{L('VAT', 'ভ্যাট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {register.rows.map((row) => (
                    <tr key={`${row.documentId}-${row.lineNo}`}>
                      <td>{formatDate(row.docDate)}</td>
                      <td><p className="font-semibold text-ink-800">{row.documentNo}</p><p className="mt-0.5 text-[12px] text-ink-400">{row.docType === 'SALES_INVOICE' ? L('Invoice', 'চালান') : L('Credit note', 'ক্রেডিট নোট')}</p></td>
                      <td className="font-mono text-[12px]">{row.statutorySerial ?? '—'}</td>
                      <td>{row.partyNameEn}<p className="mt-0.5 font-mono text-[12px] text-ink-400">{row.partyBin ?? L('No BIN', 'বিআইএন নেই')}</p></td>
                      <td>{row.description}</td>
                      <td>{row.taxCategory.replaceAll('_', ' ')}</td>
                      <td className="text-right font-money tabular-nums">{(row.rateBps / 100).toFixed(2)}%</td>
                      <td className="text-right font-money tabular-nums">{row.baseBdt}</td>
                      <td className="text-right font-money tabular-nums">{row.vatBdt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : loading ? <div className="mt-3"><Notice message={L('Loading VAT register…', 'ভ্যাট রেজিস্টার লোড হচ্ছে…')} tone="info" /></div> : null}
    </section>
  );
}
