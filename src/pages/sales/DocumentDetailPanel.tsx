import { useCallback, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Receipt, RotateCcw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { salesApi, type SalesDocument } from '../../sales/api';
import { apiErrorDetails, apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { SALES_INPUT, StatusChip, TaxStateChip, formatDate, newIdempotencyKey, todayIso } from './salesUi';

interface SnapshotLine {
  lineId?: string;
  taxCategory?: string;
  rateBps?: number;
  ruleId?: string | null;
  citation?: string | null;
  netPoisha?: string;
  vatPoisha?: string;
  grossPoisha?: string;
  decisionState?: string;
  warnings?: string[];
}

interface Snapshot {
  packVersion?: string;
  packStatus?: string;
  decisionState?: string;
  traceId?: string;
  warnings?: string[];
  lines?: SnapshotLine[];
}

function snapshotOf(document: SalesDocument): Snapshot {
  return (document.taxSnapshot ?? document.taxPreview ?? {}) as Snapshot;
}

function bdt(value: string | undefined): string {
  if (!value) return '0.00';
  try {
    const poisha = BigInt(value);
    const negative = poisha < 0n;
    const absolute = negative ? -poisha : poisha;
    return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

export function DocumentDetailPanel({
  companyId,
  document,
  canCreateDraft,
  canPost,
  canApprove,
  canReverse,
  onBack,
  onEdit,
  onChanged,
  onNewReceipt,
}: {
  companyId: string;
  document: SalesDocument;
  canCreateDraft: boolean;
  canPost: boolean;
  canApprove: boolean;
  canReverse: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChanged: (document: SalesDocument) => void;
  onNewReceipt: (document: SalesDocument) => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const snapshot = snapshotOf(document);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [confirm, setConfirm] = useState<'POST' | 'REVERSE' | 'APPROVE' | null>(null);
  const [reason, setReason] = useState('');
  const [reversalDate, setReversalDate] = useState(todayIso());
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<{ document: SalesDocument }>, success: string) => {
    setBusy(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      const response = await action();
      onChanged(response.document);
      setConfirm(null);
      setReason('');
      setNotice(success);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails(apiErrorDetails(caught));
    } finally {
      setBusy(false);
    }
  };

  const post = () =>
    run(
      () => salesApi.post(companyId, document.id, newIdempotencyKey('sales-post')),
      L('Document posted. AR, VAT, stock and the journal were committed together.', 'ডকুমেন্ট পোস্ট হয়েছে। এআর, ভ্যাট, স্টক ও জার্নাল একসঙ্গে কমিট হয়েছে।'),
    );

  const reverse = () =>
    run(
      () => salesApi.reverse(companyId, document.id, reversalDate, reason.trim()),
      L('Document reversed. The original remains immutable and the reversal is linked.', 'ডকুমেন্ট বাতিল হয়েছে। মূল ডকুমেন্ট অপরিবর্তনীয় এবং রিভার্সাল লিংকড।'),
    );

  const approve = () =>
    run(
      () => salesApi.approve(companyId, document.id, reason.trim()),
      L('Document approved by a different controller.', 'অন্য নিয়ন্ত্রক ডকুমেন্ট অনুমোদন করেছেন।'),
    );

  const isDraft = document.status === 'DRAFT';
  const isApproved = document.status === 'APPROVED';
  const isPosted = document.status === 'POSTED';
  const isCredit = document.docType === 'CREDIT_NOTE';

  return (
    <div className="space-y-4">
      <section className="lv-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button type="button" onClick={onBack} className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-500 hover:bg-surface-2" aria-label={L('Back to list', 'তালিকায় ফিরুন')}>
              <ArrowLeft size={16} />
            </button>
            <div>
              <p className="lv-kicker">{isCredit ? L('Mushak 6.7 concept', 'মূসক ৬.৭ ধারণা') : L('Mushak 6.3 concept', 'মূসক ৬.৩ ধারণা')}</p>
              <h2 className="mt-1 flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
                {document.documentNo ?? L('Draft', 'খসড়া')}
                <StatusChip status={document.status} />
              </h2>
              <p className="mt-1 text-[13px] text-ink-500">
                {document.partyNameEn} · {formatDate(document.docDate)} · {document.currency}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft && canCreateDraft ? (
              <button type="button" onClick={onEdit} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                <FileText size={15} /> {L('Edit draft', 'খসড়া সম্পাদনা')}
              </button>
            ) : null}
            {isDraft && document.approvalRequired && canApprove ? (
              <button type="button" onClick={() => setConfirm('APPROVE')} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                <ShieldCheck size={15} /> {L('Approve high-value document', 'উচ্চ-মূল্যের ডকুমেন্ট অনুমোদন')}
              </button>
            ) : null}
            {(isDraft || isApproved) && canPost ? (
              <button type="button" onClick={() => setConfirm('POST')} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
                <Send size={15} /> {L('Review & post', 'পর্যালোচনা ও পোস্ট')}
              </button>
            ) : null}
            {isPosted && !isCredit && canPost ? (
              <button type="button" onClick={() => onNewReceipt(document)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                <Receipt size={15} /> {L('Record receipt', 'রিসিট রেকর্ড')}
              </button>
            ) : null}
            {isPosted && canReverse ? (
              <button type="button" onClick={() => setConfirm('REVERSE')} className="lv-btn lv-btn-secondary min-h-11 border-rose-500/30 text-[13px] text-rose-700 dark:text-rose-300">
                <RotateCcw size={15} /> {L('Reverse', 'বাতিল')}
              </button>
            ) : null}
          </div>
        </div>

        {document.status === 'REVERSED' ? (
          <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-700 dark:text-rose-300">
            {L('This document is reversed. Its number and statutory serial are retained and never reused.', 'এই ডকুমেন্ট বাতিল হয়েছে। এর নম্বর ও স্ট্যাটিউটরি সিরিয়াল সংরক্ষিত থাকে এবং পুনরায় ব্যবহৃত হয় না।')}
          </div>
        ) : null}
        {error ? <div className="mt-4"><ErrorBanner message={error} details={details} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

        {confirm ? (
          <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-4">
            {confirm === 'POST' ? (
              <div>
                <p className="text-[14px] font-semibold text-ink-900">{L('Confirm posting', 'পোস্টিং নিশ্চিত করুন')}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                  {L(
                    'Posting creates the AR open item, VAT evidence, inventory/COGS movement and journal atomically. It does not record a customer receipt.',
                    'পোস্টিং একই লেনদেনে এআর ওপেন আইটেম, ভ্যাট প্রমাণ, ইনভেন্টরি/সিওজিএস মুভমেন্ট ও জার্নাল তৈরি করে। এটি গ্রাহকের রিসিট রেকর্ড করে না।',
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void post()} disabled={busy} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
                    <CheckCircle2 size={15} /> {busy ? L('Posting…', 'পোস্ট হচ্ছে…') : L('Confirm post', 'পোস্ট নিশ্চিত')}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                    <XCircle size={15} /> {L('Cancel', 'বাতিল')}
                  </button>
                </div>
              </div>
            ) : confirm === 'APPROVE' ? (
              <div>
                <p className="text-[14px] font-semibold text-ink-900">{L('Approve this high-value document', 'এই উচ্চ-মূল্যের ডকুমেন্ট অনুমোদন করুন')}</p>
                <p className="mt-1 text-[13px] text-ink-600">
                  {L('The approver must be different from the creator. Record the reason for the approval.', 'অনুমোদনকারীকে স্রষ্টার থেকে আলাদা হতে হবে। অনুমোদনের কারণ লিখুন।')}
                </p>
                <label className="mt-3 block text-[12px] font-semibold text-ink-600">
                  {L('Approval reason', 'অনুমোদনের কারণ')}
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className={`${SALES_INPUT} mt-1 min-h-20`} />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void approve()} disabled={busy || reason.trim().length < 3} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
                    <ShieldCheck size={15} /> {busy ? L('Approving…', 'অনুমোদন হচ্ছে…') : L('Confirm approval', 'অনুমোদন নিশ্চিত')}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">{L('Cancel', 'বাতিল')}</button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[14px] font-semibold text-ink-900">{L('Reverse this document', 'এই ডকুমেন্ট বাতিল করুন')}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                  {L(
                    'Reversal creates a linked mirrored journal and reverses the stock/cost effect. The original stays in history. A second reversal is rejected.',
                    'রিভার্সাল একটি লিংকড মিরর জার্নাল তৈরি করে এবং স্টক/খরচের প্রভাব ফিরিয়ে দেয়। মূল ডকুমেন্ট ইতিহাসে থাকে। দ্বিতীয় রিভার্সাল প্রত্যাখ্যাত হয়।',
                  )}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block text-[12px] font-semibold text-ink-600">
                    {L('Reversal date', 'রিভার্সাল তারিখ')}
                    <input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} className={`${SALES_INPUT} mt-1`} />
                  </label>
                  <label className="block text-[12px] font-semibold text-ink-600">
                    {L('Reason', 'কারণ')}
                    <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className={`${SALES_INPUT} mt-1`} />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void reverse()} disabled={busy || reason.trim().length < 3} className="lv-btn lv-btn-secondary min-h-11 border-rose-500/30 text-[13px] text-rose-700 dark:text-rose-300">
                    <RotateCcw size={15} /> {busy ? L('Reversing…', 'বাতিল হচ্ছে…') : L('Confirm reversal', 'রিভার্সাল নিশ্চিত')}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">{L('Cancel', 'বাতিল')}</button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <dl className="mt-5 grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-ink-400">{L('Document number', 'ডকুমেন্ট নম্বর')}</dt>
            <dd className="mt-1 font-mono font-semibold text-ink-900">{document.documentNo ?? L('Assigned at posting', 'পোস্টে নির্ধারিত')}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Statutory serial', 'স্ট্যাটিউটরি সিরিয়াল')}</dt>
            <dd className="mt-1 font-mono font-semibold text-ink-900">{document.statutorySerial ?? L('Assigned at posting', 'পোস্টে নির্ধারিত')}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Journal', 'জার্নাল')}</dt>
            <dd className="mt-1 font-mono font-semibold text-ink-900">{document.journalNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('AR outstanding', 'এআর বাকি')}</dt>
            <dd className="mt-1 font-money font-semibold text-ink-900">{document.arOutstandingBdt ?? '—'} BDT</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Due date', 'পরিশোধের তারিখ')}</dt>
            <dd className="mt-1 font-semibold text-ink-900">{formatDate(document.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Customer BIN', 'গ্রাহক বিআইএন')}</dt>
            <dd className="mt-1 font-mono font-semibold text-ink-900">{document.partyBin ?? L('Not recorded', 'সংরক্ষিত নয়')}</dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Tax decision', 'কর সিদ্ধান্ত')}</dt>
            <dd className="mt-1"><TaxStateChip state={document.taxDecisionState ?? snapshot.decisionState ?? null} /></dd>
          </div>
          <div>
            <dt className="text-ink-400">{L('Rule pack', 'রুল প্যাক')}</dt>
            <dd className="mt-1 font-mono font-semibold text-ink-900">{document.taxPackVersion ?? snapshot.packVersion ?? '—'}</dd>
          </div>
        </dl>
        {document.originalDocumentNo ? (
          <p className="mt-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[12px] text-ink-600">
            {L('Linked original invoice', 'লিংকড মূল চালান')}: <span className="font-mono font-semibold text-ink-900">{document.originalDocumentNo}</span>
            {document.creditReason ? ` · ${document.creditReason}` : ''}
          </p>
        ) : null}
        {document.attachmentReference ? (
          <p className="mt-2 text-[12px] text-ink-500">{L('Attachment reference', 'সংযুক্তির রেফারেন্স')}: {document.attachmentReference}</p>
        ) : null}
      </section>

      <section className="lv-card p-4 sm:p-5">
        <h3 className="text-[18px] font-semibold text-ink-900">{L('Lines and tax', 'লাইন ও কর')}</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="lv-table w-full min-w-[1000px] text-[13px]">
            <caption className="sr-only">{L('Document lines', 'ডকুমেন্ট লাইন')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">#</th>
                <th scope="col" className="text-left">{L('Description', 'বিবরণ')}</th>
                <th scope="col" className="text-right">{L('Quantity', 'পরিমাণ')}</th>
                <th scope="col" className="text-right">{L('Unit price', 'একক মূল্য')}</th>
                <th scope="col" className="text-right">{L('Discount', 'ছাড়')}</th>
                <th scope="col" className="text-left">{L('Tax', 'কর')}</th>
                <th scope="col" className="text-right">{L('Net', 'নেট')}</th>
                <th scope="col" className="text-right">{L('VAT', 'ভ্যাট')}</th>
                <th scope="col" className="text-right">{L('Gross', 'মোট')}</th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.lineNo}</td>
                  <td>
                    <p className="font-medium text-ink-800">{line.descriptionEn}</p>
                    <p className="mt-0.5 text-[12px] text-ink-400">{line.itemSku ?? L('Service / manual line', 'সার্ভিস / ম্যানুয়াল লাইন')} · {line.revenueAccountCode}</p>
                    {line.warehouseCode ? <p className="mt-0.5 text-[12px] text-ink-400">{L('Warehouse', 'গুদাম')} {line.warehouseCode}</p> : null}
                  </td>
                  <td className="text-right font-money tabular-nums">{line.quantity} {line.unit}</td>
                  <td className="text-right font-money tabular-nums">{line.unitPriceBdt}</td>
                  <td className="text-right font-money tabular-nums">{line.discountBdt}</td>
                  <td>{line.taxCategory.replaceAll('_', ' ')} · {(line.taxRateBps / 100).toFixed(2)}%</td>
                  <td className="text-right font-money tabular-nums">{line.lineBaseBdt}</td>
                  <td className="text-right font-money tabular-nums">{line.vatBdt}</td>
                  <td className="text-right font-money tabular-nums">{line.grossBdt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="text-[12px] text-ink-400">{L('Taxable value', 'করযোগ্য মূল্য')}</p>
            <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{document.subtotalBdt}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="text-[12px] text-ink-400">{L('Line discounts', 'লাইন ছাড়')}</p>
            <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{document.discountBdt}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="text-[12px] text-ink-400">{L('VAT', 'ভ্যাট')}</p>
            <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{document.vatBdt}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="text-[12px] text-ink-400">{L('Gross receivable', 'মোট প্রাপ্য')}</p>
            <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{document.grossBdt}</p>
          </div>
        </div>
        {snapshot.lines && snapshot.lines.length > 0 ? (
          <details className="mt-4 rounded-xl border border-line bg-surface-2/30 p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-800">
              {L('Tax decision evidence', 'কর সিদ্ধান্তের প্রমাণ')} · {snapshot.packVersion ?? '—'} · {snapshot.traceId ?? '—'}
            </summary>
            <div className="mt-3 space-y-2">
              {snapshot.lines.map((line, index) => (
                <div key={line.lineId ?? index} className="rounded-lg border border-line/70 bg-surface p-2.5 text-[12px]">
                  <p className="font-semibold text-ink-800">{line.taxCategory} · {(line.rateBps ?? 0) / 100}% · {line.ruleId ?? 'no rule'}</p>
                  <p className="mt-0.5 text-ink-500">{line.citation ?? 'No citation recorded.'}</p>
                  <p className="mt-1 font-money text-ink-700">{L('Net', 'নেট')} {bdt(line.netPoisha)} · {L('VAT', 'ভ্যাট')} {bdt(line.vatPoisha)} · {line.decisionState}</p>
                  {line.warnings?.length ? <p className="mt-1 text-amber-700 dark:text-amber-300">{line.warnings.join(' ')}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {snapshot.warnings?.length ? (
          <div className="mt-3">
            <Notice message={snapshot.warnings.join(' ')} tone="warning" />
          </div>
        ) : null}
        {document.taxDecisionState && document.taxDecisionState !== 'SUPPORTED' && document.status === 'DRAFT' ? (
          <div className="mt-3">
            <Notice
              message={L(
                'This draft has a tax decision that needs attention. Posting will be blocked until it is supported or a reviewed rule pack is configured.',
                'এই খসড়ার কর সিদ্ধান্তে মনোযোগ প্রয়োজন। সমর্থিত না হওয়া পর্যন্ত বা পর্যালোচিত রুল প্যাক কনফিগার না হওয়া পর্যন্ত পোস্টিং বন্ধ থাকবে।',
              )}
              tone="warning"
            />
          </div>
        ) : null}
      </section>

      <section className="lv-card p-4 sm:p-5">
        <h3 className="text-[18px] font-semibold text-ink-900">{L('Status timeline', 'স্ট্যাটাস টাইমলাইন')}</h3>
        {document.events.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-500">{L('No timeline events recorded.', 'কোনো টাইমলাইন ইভেন্ট নেই।')}</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {document.events.map((event) => (
              <li key={event.id} className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                <div>
                  <p className="text-[13px] font-semibold text-ink-800">
                    {event.action} {event.fromStatus ? `· ${event.fromStatus} → ${event.toStatus}` : ''}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-500">
                    {new Date(event.createdAt).toLocaleString()} · {event.actorName ?? L('System', 'সিস্টেম')}
                    {event.reason ? ` · ${event.reason}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
