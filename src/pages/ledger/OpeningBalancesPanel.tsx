import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Link2, RefreshCw, Send, UploadCloud } from 'lucide-react';
import { Link } from 'react-router-dom';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type OpeningBatch } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { formatDate, formatDateTime, newIdempotencyKey, poishaToBdtString } from './ledgerUi';

const OPENING_STATUS_TONE: Record<string, string> = {
  DRAFT: 'ql-badge-neutral',
  SUBMITTED: 'ql-badge-warn',
  APPROVED: 'ql-badge-warn',
  POSTED: 'ql-badge-success',
  REVERSED: 'ql-badge-danger',
};

export function OpeningBalancesPanel({
  companyId,
  canSubmit,
  canApprove,
  canPost,
  refreshToken,
  onChanged,
  onOpenJournal,
}: {
  companyId: string;
  canSubmit: boolean;
  canApprove: boolean;
  canPost: boolean;
  refreshToken: number;
  onChanged: (message: string) => Promise<void> | void;
  onOpenJournal: (journalId: string) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const [batches, setBatches] = useState<OpeningBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postKeys, setPostKeys] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await setupApi.openingBatches(companyId);
      setBatches(response.batches);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const keyFor = (batchId: string): string => {
    const existing = postKeys[batchId];
    if (existing) return existing;
    const key = newIdempotencyKey();
    setPostKeys((current) => ({ ...current, [batchId]: key }));
    return key;
  };

  const run = async (batch: OpeningBatch, action: 'submit' | 'approve' | 'post'): Promise<void> => {
    const confirmation =
      action === 'submit'
        ? L('Submit this opening-balance batch? It will be locked for approval.', 'এই উদ্বোধনী ব্যালেন্স ব্যাচ জমা দেবেন? এটি অনুমোদনের জন্য লক হবে।')
        : action === 'approve'
          ? L('Approve this opening-balance batch for posting? You must be a different user from the preparer.', 'পোস্টিংয়ের জন্য এই উদ্বোধনী ব্যালেন্স ব্যাচ অনুমোদন করবেন? আপনাকে প্রস্তুতকারকের থেকে ভিন্ন ব্যবহারকারী হতে হবে।')
          : L('Post these opening balances to the ledger? This is a one-time posting and cannot be repeated.', 'এই উদ্বোধনী ব্যালেন্স লেজারে পোস্ট করবেন? এটি একবারই পোস্ট করা যাবে এবং পুনরাবৃত্তি করা যাবে না।');
    if (!window.confirm(confirmation)) return;
    setBusy(`${action}:${batch.id}`);
    setError(null);
    try {
      if (action === 'submit') {
        await setupApi.submitOpeningBatch(companyId, batch.id);
      } else if (action === 'approve') {
        await setupApi.approveOpeningBatch(companyId, batch.id);
      } else {
        await setupApi.postOpeningBatch(companyId, batch.id, keyFor(batch.id));
      }
      await load();
      await onChanged(
        action === 'submit'
          ? L('Opening-balance batch submitted.', 'উদ্বোধনী ব্যালেন্স ব্যাচ জমা হয়েছে।')
          : action === 'approve'
            ? L('Opening-balance batch approved.', 'উদ্বোধনী ব্যালেন্স ব্যাচ অনুমোদিত হয়েছে।')
            : L('Opening balances posted to the ledger.', 'উদ্বোধনী ব্যালেন্স লেজারে পোস্ট হয়েছে।'),
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ql-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{L('Opening balances', 'উদ্বোধনী ব্যালেন্স')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {L('Review, approve and post once', 'পর্যালোচনা, অনুমোদন এবং একবার পোস্ট')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Opening balances use the same period, account, balance, numbering and audit invariants as every other journal. A permanent link connects the batch to its single posted journal.',
              'উদ্বোধনী ব্যালেন্স অন্য সব জার্নালের মতো একই মেয়াদ, হিসাব, ভারসাম্য, নম্বর ও অডিট নিয়ম ব্যবহার করে। একটি স্থায়ী লিংক ব্যাচটিকে তার একক পোস্টেড জার্নালের সাথে যুক্ত করে।',
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/setup" className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
            <ArrowUpRight size={14} /> {L('Open setup & draft editor', 'সেটআপ ও খসড়া সম্পাদক')}
          </Link>
          <button type="button" onClick={() => void load()} disabled={loading} className="ql-btn ql-btn-ghost min-h-11 text-[13px]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {!loading && batches.length === 0 ? (
        <div className="mt-4">
          <Notice
            message={L(
              'No opening-balance batch exists yet. Prepare one in the company setup wizard; it will remain DRAFT until reviewed.',
              'এখনও কোনো উদ্বোধনী ব্যালেন্স ব্যাচ নেই। কোম্পানি সেটআপ উইজার্ডে একটি প্রস্তুত করুন; পর্যালোচনার আগে এটি DRAFT থাকবে।',
            )}
          />
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {batches.map((batch) => (
          <article key={batch.id} className="rounded-xl border border-line bg-surface-2/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`ql-badge ${OPENING_STATUS_TONE[batch.status] ?? 'ql-badge-neutral'}`}>
                    {batch.status}
                  </span>
                  <span className="font-mono text-[12px] text-ink-500">{batch.periodCode}</span>
                  <span className="text-[13px] text-ink-700">{formatDate(batch.batchDate, locale)}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-500">
                  {L('Debit', 'ডেবিট')}: <strong className="font-mono text-ink-900">{batch.totalDebitBdt}</strong> ·{' '}
                  {L('Credit', 'ক্রেডিট')}: <strong className="font-mono text-ink-900">{batch.totalCreditBdt}</strong> ·{' '}
                  {L('Difference', 'পার্থক্য')}: <strong className="font-mono text-ink-900">{batch.differenceBdt}</strong>
                </p>
                <p className="mt-1 text-[12px] text-ink-500">
                  {L('Evidence', 'প্রমাণ')}: {batch.evidenceReference ?? '—'}
                  {batch.approvedAt ? ` · ${L('Approved', 'অনুমোদিত')} ${formatDateTime(batch.approvedAt, locale)}` : ''}
                  {batch.postedAt ? ` · ${L('Posted', 'পোস্টেড')} ${formatDateTime(batch.postedAt, locale)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {batch.status === 'DRAFT' && canSubmit ? (
                  <button type="button" onClick={() => void run(batch, 'submit')} disabled={busy !== null} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
                    <Send size={14} /> {L('Submit', 'জমা দিন')}
                  </button>
                ) : null}
                {batch.status === 'SUBMITTED' && canApprove ? (
                  <button type="button" onClick={() => void run(batch, 'approve')} disabled={busy !== null} className="ql-btn ql-btn-accent min-h-11 text-[13px]">
                    <CheckCircle2 size={14} /> {L('Approve', 'অনুমোদন')}
                  </button>
                ) : null}
                {batch.status === 'SUBMITTED' && !canApprove ? (
                  <span className="self-center text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                    {L('Awaiting a different approver', 'ভিন্ন অনুমোদনকারীর অপেক্ষায়')}
                  </span>
                ) : null}
                {batch.status === 'APPROVED' && canPost ? (
                  <button type="button" onClick={() => void run(batch, 'post')} disabled={busy !== null} className="ql-btn ql-btn-primary min-h-11 text-[13px]">
                    <UploadCloud size={14} /> {L('Post to ledger', 'লেজারে পোস্ট')}
                  </button>
                ) : null}
                {batch.journalId ? (
                  <button type="button" onClick={() => onOpenJournal(batch.journalId!)} className="ql-btn ql-btn-ghost min-h-11 text-[13px]">
                    <Link2 size={14} /> {batch.journalNumber ?? L('Posted journal', 'পোস্টেড জার্নাল')}
                  </button>
                ) : null}
                {batch.reversalJournalId ? (
                  <button type="button" onClick={() => onOpenJournal(batch.reversalJournalId!)} className="ql-btn ql-btn-ghost min-h-11 text-[13px]">
                    {L('Reversal', 'রিভার্সাল')} {batch.reversalJournalNumber ?? ''}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="ql-table w-full min-w-[560px] text-[13px]">
                <caption className="sr-only">{L('Opening-balance lines', 'উদ্বোধনী ব্যালেন্স লাইন')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{L('Account', 'হিসাব')}</th>
                    <th scope="col" className="text-left">{L('Schedule', 'সিডিউল')}</th>
                    <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
                    <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.lines.map((line) => (
                    <tr key={line.id}>
                      <td><span className="font-mono text-ink-500">{line.accountCode}</span> {line.accountName}</td>
                      <td className="text-ink-500">{line.scheduleType}{line.schedule.name ? ` · ${line.schedule.name}` : ''}</td>
                      <td className="text-right font-mono tabular-nums">{BigInt(line.debitPoisha) === 0n ? '—' : line.debitBdt}</td>
                      <td className="text-right font-mono tabular-nums">{BigInt(line.creditPoisha) === 0n ? '—' : line.creditBdt}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2} className="text-right text-[12px] uppercase tracking-[0.05em] text-ink-400">{L('Totals', 'মোট')}</th>
                    <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(batch.totalDebitPoisha))}</td>
                    <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(BigInt(batch.totalCreditPoisha))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default OpeningBalancesPanel;
