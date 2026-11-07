import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, RefreshCw, Search } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { salesApi, type SalesDocumentStatus, type SalesDocumentSummary, type SalesDocumentType } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import {
  ColumnPicker,
  SavedViews,
  loadVisibleColumns,
  saveVisibleColumns,
} from '../tables/TableControls';
import { EmptyState, SALES_INPUT, SALES_SELECT, StatusChip, formatDate } from './salesUi';

const ALL_COLUMNS = ['document', 'customer', 'date', 'due', 'gross', 'outstanding', 'status'] as const;
type ColumnKey = (typeof ALL_COLUMNS)[number];

export function DocumentListPanel({
  companyId,
  docType,
  canCreate,
  onOpen,
  onNew,
  refreshKey,
}: {
  companyId: string;
  docType: SalesDocumentType;
  canCreate: boolean;
  onOpen: (documentId: string) => void;
  onNew: () => void;
  refreshKey: number;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [status, setStatus] = useState<SalesDocumentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [entries, setEntries] = useState<SalesDocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() =>
    loadVisibleColumns('sales-documents', ALL_COLUMNS),
  );
  const columnLabels = useMemo<Record<ColumnKey, string>>(
    () => ({
      document: L('Document', 'ডকুমেন্ট'),
      customer: L('Customer', 'গ্রাহক'),
      date: L('Date', 'তারিখ'),
      due: L('Due', 'পরিশোধ'),
      gross: L('Gross', 'মোট'),
      outstanding: L('Outstanding', 'বাকি'),
      status: L('Status', 'স্ট্যাটাস'),
    }),
    [L],
  );
  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const currentViewState = useMemo(
    () => ({ status, from, to, search }),
    [from, search, status, to],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await salesApi.documents(companyId, {
        type: docType,
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit,
        offset,
      });
      setEntries(response.entries);
      setTotal(response.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, docType, from, offset, search, status, to]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="ql-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{docType === 'SALES_INVOICE' ? L('Receivables', 'প্রাপ্য') : L('Mushak 6.7 concept', 'মূসক ৬.৭ ধারণা')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {docType === 'SALES_INVOICE' ? L('Sales invoices', 'বিক্রয় চালান') : L('Credit notes', 'ক্রেডিট নোট')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {docType === 'SALES_INVOICE'
              ? L('Drafts persist on the server. Posted invoices create AR open items, VAT evidence and stock/COGS in one transaction.', 'খসড়া সার্ভারে সংরক্ষিত থাকে। পোস্টকৃত চালান এক লেনদেনে এআর ওপেন আইটেম, ভ্যাট প্রমাণ এবং স্টক/সিওজিএস তৈরি করে।')
              : L('Credit notes have their own number and 6.7-style serial series. They never consume a 6.3 invoice serial.', 'ক্রেডিট নোটের নিজস্ব নম্বর ও ৬.৭-ধাঁচের সিরিজ আছে। তারা কখনও ৬.৩ চালান সিরিয়াল ব্যবহার করে না।')}
          </p>
        </div>
        {canCreate ? (
          <button type="button" onClick={onNew} className="ql-btn ql-btn-primary min-h-11 text-[13px]">
            <FilePlus2 size={15} /> {docType === 'SALES_INVOICE' ? L('New invoice', 'নতুন চালান') : L('New credit note', 'নতুন ক্রেডিট নোট')}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('Status', 'স্ট্যাটাস')}
          <select value={status} onChange={(event) => { setStatus(event.target.value as SalesDocumentStatus | ''); setOffset(0); }} className={`${SALES_SELECT} mt-1`}>
            <option value="">{L('All statuses', 'সব স্ট্যাটাস')}</option>
            <option value="DRAFT">{L('Draft', 'খসড়া')}</option>
            <option value="APPROVED">{L('Approved', 'অনুমোদিত')}</option>
            <option value="POSTED">{L('Posted', 'পোস্টেড')}</option>
            <option value="REVERSED">{L('Reversed', 'বাতিল')}</option>
          </select>
        </label>
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('From', 'থেকে')}
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} className={`${SALES_INPUT} mt-1`} />
        </label>
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('To', 'পর্যন্ত')}
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setOffset(0); }} className={`${SALES_INPUT} mt-1`} />
        </label>
        <label className="block text-[12px] font-semibold text-ink-600 sm:col-span-2">
          {L('Search document, serial or customer', 'ডকুমেন্ট, সিরিয়াল বা গ্রাহক খুঁজুন')}
          <span className="relative mt-1 block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} className={`${SALES_INPUT} pl-9`} placeholder={L('Invoice number, M63 serial or customer', 'চালান নম্বর, M63 সিরিয়াল বা গ্রাহক')} />
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <SavedViews
          storageKey={`sales-${docType}`}
          currentState={currentViewState}
          onApply={(state) => {
            setStatus((state.status ?? '') as SalesDocumentStatus | '');
            setFrom(state.from ?? '');
            setTo(state.to ?? '');
            setSearch(state.search ?? '');
            setOffset(0);
          }}
        />
        <ColumnPicker
          columns={ALL_COLUMNS.map((key) => ({ key, label: columnLabels[key] }))}
          visible={visibleColumns}
          onChange={(next) => {
            setVisibleColumns(next);
            saveVisibleColumns('sales-documents', next);
          }}
        />
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-500">
          {total} {L('document(s)', 'ডকুমেন্ট')} · {L('page', 'পৃষ্ঠা')} {page}/{pages}
        </p>
        <button type="button" onClick={() => void load()} disabled={loading} className="ql-btn ql-btn-secondary min-h-10 text-[12px]">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
        </button>
      </div>

      {entries.length === 0 && !loading ? (
        <div className="mt-4">
          <EmptyState
            title={docType === 'SALES_INVOICE' ? L('No sales invoices yet', 'এখনও কোনো বিক্রয় চালান নেই') : L('No credit notes yet', 'এখনও কোনো ক্রেডিট নোট নেই')}
            hint={L('Create a draft, review the server-calculated tax and post it when the customer evidence is ready.', 'খসড়া তৈরি করুন, সার্ভার-গণিত কর পর্যালোচনা করুন এবং গ্রাহকের প্রমাণ প্রস্তুত হলে পোস্ট করুন।')}
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="ql-table w-full min-w-[980px] text-[13px]">
            <caption className="sr-only">{L('Sales documents', 'বিক্রয় ডকুমেন্ট')}</caption>
            <thead>
              <tr>
                {visibleSet.has('document') ? <th scope="col" className="text-left">{columnLabels.document}</th> : null}
                {visibleSet.has('customer') ? <th scope="col" className="text-left">{columnLabels.customer}</th> : null}
                {visibleSet.has('date') ? <th scope="col" className="text-left">{columnLabels.date}</th> : null}
                {visibleSet.has('due') ? <th scope="col" className="text-left">{columnLabels.due}</th> : null}
                {visibleSet.has('gross') ? <th scope="col" className="text-right">{columnLabels.gross}</th> : null}
                {visibleSet.has('outstanding') ? <th scope="col" className="text-right">{columnLabels.outstanding}</th> : null}
                {visibleSet.has('status') ? <th scope="col" className="text-left">{columnLabels.status}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => onOpen(entry.id)}>
                  {visibleSet.has('document') ? (
                    <td>
                      <button type="button" onClick={() => onOpen(entry.id)} className="text-left font-semibold text-brand-bright underline-offset-2 hover:underline">
                        {entry.documentNo ?? L('Draft', 'খসড়া')}
                      </button>
                      <p className="mt-0.5 font-mono text-[12px] text-ink-400">{entry.statutorySerial ?? (docType === 'CREDIT_NOTE' ? 'M67 pending' : 'M63 pending')}</p>
                      {entry.originalDocumentNo ? <p className="mt-0.5 text-[12px] text-ink-500">{L('Against', 'বিরুদ্ধে')} {entry.originalDocumentNo}</p> : null}
                    </td>
                  ) : null}
                  {visibleSet.has('customer') ? (
                    <td>
                      <p className="font-medium text-ink-800">{entry.partyNameEn}</p>
                      <p className="mt-0.5 font-mono text-[12px] text-ink-400">{entry.partyCode}</p>
                    </td>
                  ) : null}
                  {visibleSet.has('date') ? <td className="whitespace-nowrap">{formatDate(entry.docDate)}</td> : null}
                  {visibleSet.has('due') ? <td className="whitespace-nowrap">{formatDate(entry.dueDate)}</td> : null}
                  {visibleSet.has('gross') ? <td className="text-right font-money tabular-nums">{entry.grossBdt}</td> : null}
                  {visibleSet.has('outstanding') ? <td className="text-right font-money tabular-nums">{entry.outstandingBdt ?? '—'}</td> : null}
                  {visibleSet.has('status') ? <td><StatusChip status={entry.status} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > limit ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="ql-btn ql-btn-secondary min-h-10 text-[12px]">
            {L('Previous', 'পূর্ববর্তী')}
          </button>
          <button type="button" onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} className="ql-btn ql-btn-secondary min-h-10 text-[12px]">
            {L('Next', 'পরবর্তী')}
          </button>
        </div>
      ) : null}
      {loading ? <div className="mt-3"><Notice message={L('Loading sales documents…', 'বিক্রয় ডকুমেন্ট লোড হচ্ছে…')} tone="info" /></div> : null}
    </section>
  );
}
