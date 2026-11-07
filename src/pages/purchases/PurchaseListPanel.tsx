import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, Search } from 'lucide-react';
import type { PurchaseDocumentStatus, PurchaseDocumentSummary, PurchaseDocumentType } from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS } from '../setup/setupUi';
import { ColumnPicker, SavedViews, loadVisibleColumns, saveVisibleColumns } from '../tables/TableControls';
import { EmptyState, SectionCard, docTypeLabel, formatDate, statusChip } from './purchasesUi';

const ALL_COLUMNS = ['document', 'supplier', 'supplierInvoice', 'date', 'due', 'gross', 'outstanding', 'status'] as const;
type ColumnKey = (typeof ALL_COLUMNS)[number];

export function PurchaseListPanel({
  companyId,
  refreshKey,
  onSelect,
  onCreate,
}: {
  companyId: string;
  refreshKey: number;
  onSelect: (documentId: string) => void;
  onCreate: (type: PurchaseDocumentType) => void;
}) {
  const [entries, setEntries] = useState<PurchaseDocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<'' | PurchaseDocumentType>('');
  const [status, setStatus] = useState<'' | PurchaseDocumentStatus>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() =>
    loadVisibleColumns('purchase-documents', ALL_COLUMNS),
  );
  const limit = 25;
  const { locale } = usePreferences();
  const columnLabels = useMemo<Record<ColumnKey, string>>(() => {
    const bn = locale === 'bn-BD';
    return {
      document: bn ? 'ডকুমেন্ট' : 'Document',
      supplier: bn ? 'সরবরাহকারী' : 'Supplier',
      supplierInvoice: bn ? 'সরবরাহকারীর চালান' : 'Supplier invoice',
      date: bn ? 'তারিখ' : 'Date',
      due: bn ? 'পরিশোধ' : 'Due',
      gross: bn ? 'মোট বিডিটি' : 'Gross BDT',
      outstanding: bn ? 'বাকি' : 'Outstanding',
      status: bn ? 'স্ট্যাটাস' : 'Status',
    };
  }, [locale]);
  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const currentViewState = useMemo(() => ({ type, status, search }), [search, status, type]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await purchaseApi.documents(companyId, {
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
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
  }, [companyId, type, status, search, offset]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <SectionCard
      title="Bills & payables"
      kicker="Posted documents drive the AP subledger"
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => onCreate('EXPENSE_VOUCHER')}>
            <FileText size={15} /> Expense voucher
          </button>
          <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" onClick={() => onCreate('PURCHASE_BILL')}>
            <FileText size={15} /> New supplier bill
          </button>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-ink-400" />
          <input
            className={`${INPUT_CLASS} pl-9`}
            placeholder="Document, supplier invoice or supplier"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setOffset(0); }}
          />
        </label>
        <select className={INPUT_CLASS} value={type} onChange={(event) => { setType(event.target.value as '' | PurchaseDocumentType); setOffset(0); }}>
          <option value="">All document types</option>
          <option value="PURCHASE_BILL">Supplier bills</option>
          <option value="EXPENSE_VOUCHER">Expense vouchers</option>
        </select>
        <select className={INPUT_CLASS} value={status} onChange={(event) => { setStatus(event.target.value as '' | PurchaseDocumentStatus); setOffset(0); }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="POSTED">Posted</option>
          <option value="REVERSED">Reversed</option>
        </select>
        <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <SavedViews
          storageKey="purchase-documents"
          currentState={currentViewState}
          onApply={(state) => {
            setType((state.type ?? '') as '' | PurchaseDocumentType);
            setStatus((state.status ?? '') as '' | PurchaseDocumentStatus);
            setSearch(state.search ?? '');
            setOffset(0);
          }}
        />
        <ColumnPicker
          columns={ALL_COLUMNS.map((key) => ({ key, label: columnLabels[key] }))}
          visible={visibleColumns}
          onChange={(next) => {
            setVisibleColumns(next);
            saveVisibleColumns('purchase-documents', next);
          }}
        />
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <p className="py-8 text-center text-[13px] text-ink-500">Loading purchase documents…</p>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No purchase documents match"
            hint="Create a supplier bill or expense voucher. Drafts persist on the server and can be reviewed before posting."
          />
        ) : (
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
              <tr>
                {visibleSet.has('document') ? <th className="px-2 py-2">{columnLabels.document}</th> : null}
                {visibleSet.has('supplier') ? <th className="px-2 py-2">{columnLabels.supplier}</th> : null}
                {visibleSet.has('supplierInvoice') ? <th className="px-2 py-2">{columnLabels.supplierInvoice}</th> : null}
                {visibleSet.has('date') ? <th className="px-2 py-2">{columnLabels.date}</th> : null}
                {visibleSet.has('due') ? <th className="px-2 py-2">{columnLabels.due}</th> : null}
                {visibleSet.has('gross') ? <th className="px-2 py-2 text-right">{columnLabels.gross}</th> : null}
                {visibleSet.has('outstanding') ? <th className="px-2 py-2 text-right">{columnLabels.outstanding}</th> : null}
                {visibleSet.has('status') ? <th className="px-2 py-2">{columnLabels.status}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer border-t border-line/70 hover:bg-surface-2/50"
                  onClick={() => onSelect(entry.id)}
                >
                  {visibleSet.has('document') ? (
                    <td className="px-2 py-3">
                      <p className="font-semibold text-ink-900">{entry.documentNo ?? 'Draft'}</p>
                      <p className="text-[12px] text-ink-400">{docTypeLabel(entry.docType)}</p>
                    </td>
                  ) : null}
                  {visibleSet.has('supplier') ? (
                    <td className="px-2 py-3">
                      <p className="font-medium text-ink-800">{entry.partyNameEn}</p>
                      <p className="text-[12px] text-ink-400">{entry.partyCode}</p>
                      {entry.supplierTinMissing ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle size={12} /> e-TIN missing
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                  {visibleSet.has('supplierInvoice') ? <td className="px-2 py-3 text-ink-600">{entry.supplierInvoiceNo}</td> : null}
                  {visibleSet.has('date') ? <td className="px-2 py-3 text-ink-600">{formatDate(entry.docDate)}</td> : null}
                  {visibleSet.has('due') ? <td className="px-2 py-3 text-ink-600">{formatDate(entry.dueDate)}</td> : null}
                  {visibleSet.has('gross') ? <td className="px-2 py-3 text-right font-mono text-ink-800">{entry.grossBdt}</td> : null}
                  {visibleSet.has('outstanding') ? <td className="px-2 py-3 text-right font-mono text-ink-800">{entry.outstandingBdt ?? '—'}</td> : null}
                  {visibleSet.has('status') ? <td className="px-2 py-3">{statusChip(entry.status)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-500">
          {total} document(s) · page {Math.floor(offset / limit) + 1}/{Math.max(1, Math.ceil(total / limit))}
        </p>
        {total > limit ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ql-btn ql-btn-secondary min-h-10 text-[12px]"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <button
              type="button"
              className="ql-btn ql-btn-secondary min-h-10 text-[12px]"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
