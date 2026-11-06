import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, CheckCircle2, CreditCard, FilePenLine, RotateCcw, ShieldCheck } from 'lucide-react';
import type { PurchaseDocument } from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import {
  EmptyState,
  SectionCard,
  docTypeLabel,
  formatDate,
  newKey,
  statusChip,
  taxStateChip,
} from './purchasesUi';

function taxWarnings(document: PurchaseDocument): string[] {
  const warnings = document.taxSnapshot?.warnings;
  return Array.isArray(warnings) ? warnings.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function PurchaseDetailPanel({
  companyId,
  documentId,
  canPost,
  canReverse,
  canApprove,
  canEdit,
  onEdit,
  onChanged,
  onPay,
  onBack,
}: {
  companyId: string;
  documentId: string;
  canPost: boolean;
  canReverse: boolean;
  canApprove: boolean;
  canEdit: boolean;
  onEdit: (document: PurchaseDocument) => void;
  onChanged: (document: PurchaseDocument) => void;
  onPay: (document: PurchaseDocument) => void;
  onBack: () => void;
}) {
  const [document, setDocument] = useState<PurchaseDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalReason, setApprovalReason] = useState('');
  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reversalReason, setReversalReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await purchaseApi.document(companyId, documentId);
      setDocument(response.document);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    if (!document) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await purchaseApi.postDocument(companyId, document.id, newKey('purchase-post'));
      setDocument(result.document);
      setConfirmPost(false);
      onChanged(result.document);
      setNotice('Document posted. The journal, stock receipt, tax evidence and AP item are committed together.');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!document) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await purchaseApi.approveDocument(companyId, document.id, approvalReason.trim());
      setDocument(result.document);
      setApprovalOpen(false);
      setApprovalReason('');
      onChanged(result.document);
      setNotice('Purchase document approved by a different controller. Posting is now permitted.');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const reverse = async () => {
    if (!document) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await purchaseApi.reverseDocument(companyId, document.id, reversalDate, reversalReason);
      setDocument(result.document);
      setReversalOpen(false);
      setReversalReason('');
      onChanged(result.document);
      setNotice('Document reversed with a linked journal and stock restoration. The original remains immutable.');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <SectionCard title="Purchase document"><p className="py-8 text-center text-[13px] text-ink-500">Loading document…</p></SectionCard>;
  }
  if (!document) {
    return (
      <SectionCard title="Purchase document">
        <EmptyState title="Document not available" hint={error ?? 'The document could not be loaded.'} />
        <button type="button" className="lv-btn lv-btn-secondary mt-4 min-h-11 text-[13px]" onClick={onBack}>
          <ArrowLeft size={15} /> Back to bills
        </button>
      </SectionCard>
    );
  }

  const warnings = taxWarnings(document);
  const isDraft = document.status === 'DRAFT';
  const isPosted = document.status === 'POSTED';

  return (
    <div className="space-y-4">
      <section className="lv-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" className="mb-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand" onClick={onBack}>
              <ArrowLeft size={14} /> Bills & payables
            </button>
            <p className="lv-kicker">{docTypeLabel(document.docType)}</p>
            <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-ink-900">
              {document.documentNo ?? 'Draft document'}
            </h2>
            <p className="mt-1 text-[14px] text-ink-500">
              {document.partyNameEn} · supplier invoice {document.supplierInvoiceNo} · {formatDate(document.docDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {statusChip(document.status)}
            {taxStateChip(document.taxDecisionState)}
            {canEdit && isDraft ? (
              <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => onEdit(document)}>
                <FilePenLine size={15} /> Edit draft
              </button>
            ) : null}
            {canApprove && isDraft && document.approvalRequired && !document.approvedAt ? (
              <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => setApprovalOpen(true)}>
                <ShieldCheck size={15} /> Approve high-value bill
              </button>
            ) : null}
            {canPost && isDraft ? (
              <button type="button" className="lv-btn lv-btn-primary min-h-11 text-[13px]" onClick={() => setConfirmPost(true)}>
                <CheckCircle2 size={15} /> Post document
              </button>
            ) : null}
            {isPosted ? (
              <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => onPay(document)}>
                <CreditCard size={15} /> Record payment
              </button>
            ) : null}
            {canReverse && isPosted ? (
              <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px] text-rose-700 dark:text-rose-300" onClick={() => setReversalOpen(true)}>
                <RotateCcw size={15} /> Reverse
              </button>
            ) : null}
          </div>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}
        {warnings.length > 0 ? (
          <div className="mt-4 space-y-2">
            {warnings.map((warning) => (
              <Notice key={warning} message={warning} tone="warning" />
            ))}
          </div>
        ) : null}

        {approvalOpen ? (
          <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-4">
            <p className="text-[14px] font-semibold text-ink-900">Approve this high-value purchase document</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
              The approver must be different from the creator. The approval is recorded in the document history and audit log.
            </p>
            <label className="mt-3 block text-[12px] font-semibold text-ink-600">
              Approval reason
              <textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} className={`${INPUT_CLASS} mt-1 min-h-20`} />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void approve()} disabled={busy || approvalReason.trim().length < 3} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
                <ShieldCheck size={15} /> {busy ? 'Approving…' : 'Confirm approval'}
              </button>
              <button type="button" onClick={() => setApprovalOpen(false)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">Cancel</button>
            </div>
          </div>
        ) : null}

        {confirmPost ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-amber-900 dark:text-amber-100">
            <p className="font-semibold">Post this purchase document?</p>
            <p className="mt-1 leading-relaxed">
              Posting creates the journal, AP open item, tax evidence and any stock receipt in one transaction.
              It cannot be edited afterwards; a correction requires a linked reversal.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="lv-btn lv-btn-primary min-h-11 text-[13px]" disabled={busy} onClick={() => void post()}>
                {busy ? 'Posting…' : 'Yes, post document'}
              </button>
              <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px]" onClick={() => setConfirmPost(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {reversalOpen ? (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[13px] text-rose-800 dark:text-rose-200">
            <p className="font-semibold">Reverse this posted document?</p>
            <p className="mt-1 leading-relaxed">
              A linked reversal journal and stock reversal will be posted. Reverse any supplier payments first.
              The original document remains immutable and a second reversal is rejected.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold">Reversal date</span>
                <input type="date" className={INPUT_CLASS} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold">Reason (required)</span>
                <input
                  className={INPUT_CLASS}
                  value={reversalReason}
                  onChange={(event) => setReversalReason(event.target.value)}
                  placeholder="Why is this document being reversed?"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="lv-btn lv-btn-danger min-h-11 text-[13px]"
                disabled={busy || reversalReason.trim().length < 3}
                onClick={() => void reverse()}
              >
                <Ban size={15} /> {busy ? 'Reversing…' : 'Post linked reversal'}
              </button>
              <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px]" onClick={() => setReversalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <SectionCard title="Document totals" kicker="Server-calculated and stored">
          <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
            <div><dt className="text-ink-400">Taxable base</dt><dd className="mt-1 font-mono text-ink-900">{document.subtotalBdt}</dd></div>
            <div><dt className="text-ink-400">VAT</dt><dd className="mt-1 font-mono text-ink-900">{document.vatBdt}</dd></div>
            <div><dt className="text-ink-400">Input VAT claimable</dt><dd className="mt-1 font-mono text-emerald-700 dark:text-emerald-300">{document.vatClaimableBdt}</dd></div>
            <div><dt className="text-ink-400">VAT disallowed / capitalised</dt><dd className="mt-1 font-mono text-amber-700 dark:text-amber-300">{document.vatDisallowedBdt}</dd></div>
            <div><dt className="text-ink-400">Supplier payable</dt><dd className="mt-1 font-mono text-ink-900">{document.grossBdt}</dd></div>
            <div><dt className="text-ink-400">Expected VDS</dt><dd className="mt-1 font-mono text-ink-900">{document.vdsBdt}</dd></div>
            <div><dt className="text-ink-400">Expected TDS</dt><dd className="mt-1 font-mono text-ink-900">{document.tdsBdt}</dd></div>
            <div><dt className="text-ink-400">Net payable if paid in full</dt><dd className="mt-1 font-mono font-semibold text-ink-900">{document.netPayableBdt}</dd></div>
            <div><dt className="text-ink-400">AP outstanding</dt><dd className="mt-1 font-mono font-semibold text-ink-900">{document.apOutstandingBdt ?? '—'}</dd></div>
            <div><dt className="text-ink-400">Journal</dt><dd className="mt-1 text-ink-900">{document.journalNumber ?? 'Not posted'}</dd></div>
          </dl>
        </SectionCard>

        <SectionCard title="Tax evidence & facts" kicker="Never auto-generated">
          <dl className="space-y-2 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Supplier BIN</dt><dd className="text-right text-ink-800">{document.supplierBin ?? 'Missing'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Supplier e-TIN</dt><dd className="text-right text-ink-800">{document.supplierTin ?? 'Missing'}{document.supplierTinMissing ? ' (treated missing)' : ''}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Mushak 6.3 serial</dt><dd className="text-right text-ink-800">{document.supplierMushak63Serial ?? 'Not recorded'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Mushak 6.3 date</dt><dd className="text-right text-ink-800">{document.supplierMushak63Date ? formatDate(document.supplierMushak63Date) : '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Reverse-charge challan</dt><dd className="text-right text-ink-800">{document.reverseChargeChallanReference ?? 'Not held'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Attachment reference</dt><dd className="text-right text-ink-800">{document.attachmentReference ?? '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">Payment method</dt><dd className="text-right text-ink-800">{document.paymentMethod}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-400">TDS nature</dt><dd className="text-right text-ink-800">{document.tdsNature.replaceAll('_', ' ')}</dd></div>
          </dl>
        </SectionCard>
      </div>

      <SectionCard title="Lines" kicker="Inventory or expense classification is line-level">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-[13px]">
            <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">Account</th>
                <th className="px-2 py-2">Warehouse</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Base</th>
                <th className="px-2 py-2 text-right">VAT</th>
                <th className="px-2 py-2 text-right">Claimable</th>
                <th className="px-2 py-2 text-right">Disallowed</th>
                <th className="px-2 py-2 text-right">Cost</th>
                <th className="px-2 py-2">Tax state</th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line) => (
                <tr key={line.id} className="border-t border-line/70">
                  <td className="px-2 py-2 text-ink-400">{line.lineNo}</td>
                  <td className="px-2 py-2">
                    <p className="font-medium text-ink-900">{line.descriptionEn}</p>
                    <p className="text-[12px] text-ink-400">{line.taxCategory.replaceAll('_', ' ')}</p>
                  </td>
                  <td className="px-2 py-2 text-ink-700">{line.accountCode} — {line.accountName}</td>
                  <td className="px-2 py-2 text-ink-600">{line.warehouseCode ?? '—'}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.quantity} {line.unit}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.lineBaseBdt}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.vatBdt}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.vatClaimableBdt}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.vatDisallowedBdt}</td>
                  <td className="px-2 py-2 text-right font-mono">{line.costBdt}</td>
                  <td className="px-2 py-2">{taxStateChip(line.taxDecisionState)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Timeline" kicker="Audited document events">
        {document.events.length === 0 ? (
          <EmptyState title="No events yet" hint="Draft creation and posting events appear here." />
        ) : (
          <ol className="space-y-2 text-[13px]">
            {document.events.map((event) => (
              <li key={event.id} className="rounded-lg border border-line bg-surface-2/30 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink-800">{event.action.replaceAll('_', ' ')}</span>
                  <span className="text-[12px] text-ink-400">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-ink-500">
                  {event.fromStatus ?? '—'} → {event.toStatus ?? '—'} · {event.actorName ?? 'System'}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
