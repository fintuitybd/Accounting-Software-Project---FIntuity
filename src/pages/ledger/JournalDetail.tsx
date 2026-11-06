import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Pencil, RotateCcw, Send, UploadCloud } from 'lucide-react';
import { localized, type Locale } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { FiscalPeriod } from '../../setup/api';
import { ledgerApi, type JournalDetail as JournalDetailType } from '../../ledger/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import {
  dateToday,
  formatDate,
  formatDateTime,
  newIdempotencyKey,
  poishaToBdtString,
  StatusChip,
} from './ledgerUi';

const SOURCE_LABELS: Record<string, { en: string; bn: string }> = {
  MANUAL_JOURNAL: { en: 'Manual journal', bn: 'ম্যানুয়াল জার্নাল' },
  OPENING_BALANCE: { en: 'Opening balances', bn: 'উদ্বোধনী ব্যালেন্স' },
  REVERSAL: { en: 'Reversal', bn: 'রিভার্সাল' },
  SALES: { en: 'Sales', bn: 'বিক্রয়' },
  PURCHASES: { en: 'Purchases', bn: 'ক্রয়' },
  BANK_MFS: { en: 'Bank / MFS', bn: 'ব্যাংক / এমএফএস' },
  PAYROLL_LITE: { en: 'Payroll', bn: 'পে-রোল' },
  IFRS_ADJUSTMENT: { en: 'IFRS adjustment', bn: 'আইএফআরএস সমন্বয়' },
  MASS_IMPORT: { en: 'Mass import', bn: 'বাল্ক ইমপোর্ট' },
};

function sourceLabel(source: string, locale: Locale): string {
  const meta = SOURCE_LABELS[source] ?? { en: source, bn: source };
  return localized(locale, meta.en, meta.bn);
}

export function JournalDetail({
  companyId,
  journal,
  periods,
  canPost,
  canApprove,
  canReverse,
  onUpdated,
  onEdit,
  onBack,
  onOpenJournal,
}: {
  companyId: string;
  journal: JournalDetailType;
  periods: FiscalPeriod[];
  canPost: boolean;
  canApprove: boolean;
  canReverse: boolean;
  onUpdated: (message: string) => Promise<void> | void;
  onEdit: () => void;
  onBack: () => void;
  onOpenJournal: (journalId: string) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalDate, setReversalDate] = useState(() => {
    const today = dateToday();
    const open = periods.find((period) => period.status === 'OPEN' && today >= period.startDate && today <= period.endDate);
    return open ? today : (periods.find((period) => period.status === 'OPEN')?.startDate ?? today);
  });

  const totalDebit = useMemo(() => BigInt(journal.totalDebitPoisha), [journal.totalDebitPoisha]);
  const totalCredit = useMemo(() => BigInt(journal.totalCreditPoisha), [journal.totalCreditPoisha]);

  const act = async (label: string, operation: () => Promise<string>): Promise<void> => {
    setBusy(label);
    setError(null);
    setDetails(undefined);
    try {
      const message = await operation();
      await onUpdated(message);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setBusy(null);
    }
  };

  const submit = (): void => {
    if (!window.confirm(L('Submit this journal for approval? Its content will be locked.', 'এই জার্নালটি অনুমোদনের জন্য জমা দেবেন? এর বিষয়বস্তু লক হবে।'))) return;
    void act('submit', async () => {
      await ledgerApi.submitJournal(companyId, journal.id);
      return L('Journal submitted.', 'জার্নাল জমা হয়েছে।');
    });
  };

  const approve = (): void => {
    if (!window.confirm(L('Approve this journal? You must be a different user from the maker.', 'এই জার্নালটি অনুমোদন করবেন? আপনাকে প্রস্তুতকারকের থেকে ভিন্ন ব্যবহারকারী হতে হবে।'))) return;
    void act('approve', async () => {
      await ledgerApi.approveJournal(companyId, journal.id);
      return L('Journal approved.', 'জার্নাল অনুমোদিত হয়েছে।');
    });
  };

  const post = (): void => {
    if (!window.confirm(
      L(
        'Post this journal to the ledger? Posted journals cannot be edited or deleted; corrections require a linked reversal.',
        'এই জার্নালটি লেজারে পোস্ট করবেন? পোস্ট করা জার্নাল সম্পাদনা বা মুছে ফেলা যাবে না; সংশোধনের জন্য লিংকড রিভার্সাল প্রয়োজন।',
      ),
    )) return;
    void act('post', async () => {
      const result = await ledgerApi.postJournal(companyId, journal.id, newIdempotencyKey());
      return result.replayed
        ? L('This journal was already posted; the original result was returned.', 'এই জার্নাল ইতিমধ্যে পোস্ট হয়েছে; মূল ফলাফল ফেরত দেওয়া হয়েছে।')
        : L(`Journal ${result.journal.journalNumber ?? ''} posted.`, `জার্নাল ${result.journal.journalNumber ?? ''} পোস্ট হয়েছে।`);
    });
  };

  const reverse = (): void => {
    const reason = reversalReason.trim();
    if (reason.length < 3) {
      setError(L('Enter a reversal reason of at least three characters.', 'অন্তত তিন অক্ষরের রিভার্সাল কারণ লিখুন।'));
      return;
    }
    if (!window.confirm(
      L(
        'Create a linked reversal? The original journal stays in the ledger and both entries will appear in reports. A reversal cannot be reversed.',
        'একটি লিংকড রিভার্সাল তৈরি করবেন? মূল জার্নাল লেজারে থাকবে এবং উভয় এন্ট্রি রিপোর্টে দেখা যাবে। রিভার্সালকে আবার রিভার্স করা যাবে না।',
      ),
    )) return;
    void act('reverse', async () => {
      const result = await ledgerApi.reverseJournal(companyId, journal.id, { date: reversalDate, reason });
      setReversalOpen(false);
      setReversalReason('');
      return L(`Reversal ${result.reversal.journalNumber ?? ''} posted.`, `রিভার্সাল ${result.reversal.journalNumber ?? ''} পোস্ট হয়েছে।`);
    });
  };

  const canEditDraft = journal.status === 'DRAFT' && canPost;
  const canSubmitJournal = journal.status === 'DRAFT' && canPost;
  const canApproveJournal = journal.status === 'SUBMITTED' && canApprove;
  const canPostJournal = (journal.status === 'DRAFT' || journal.status === 'SUBMITTED' || journal.status === 'APPROVED') && canPost;
  const canReverseJournal = journal.status === 'POSTED' && canReverse && !journal.reversalOfJournalId;

  return (
    <section className="lv-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-bright hover:underline">
            <ArrowLeft size={13} /> {L('Back to journal list', 'জার্নাল তালিকায় ফিরুন')}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[22px] font-semibold tracking-[-0.02em] text-ink-900">
              {journal.journalNumber ?? L('Unnumbered draft', 'সংখ্যাহীন খসড়া')}
            </h2>
            <StatusChip status={journal.status} />
            {journal.reversalOfJournalId ? (
              <span className="lv-chip lv-chip-rose">{L('Reversal journal', 'রিভার্সাল জার্নাল')}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-700">{journal.narrationEn}</p>
          {journal.narrationBn ? <p className="mt-0.5 text-[13px] text-ink-500">{journal.narrationBn}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDraft ? (
            <button type="button" onClick={onEdit} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
              <Pencil size={14} /> {L('Edit draft', 'খসড়া সম্পাদনা')}
            </button>
          ) : null}
          {canSubmitJournal ? (
            <button type="button" onClick={submit} disabled={busy !== null} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
              <Send size={14} /> {busy === 'submit' ? L('Submitting…', 'জমা হচ্ছে…') : L('Submit', 'জমা দিন')}
            </button>
          ) : null}
          {canApproveJournal ? (
            <button type="button" onClick={approve} disabled={busy !== null} className="lv-btn lv-btn-saffron min-h-11 text-[13px]">
              <CheckCircle2 size={14} /> {busy === 'approve' ? L('Approving…', 'অনুমোদন হচ্ছে…') : L('Approve', 'অনুমোদন')}
            </button>
          ) : null}
          {canPostJournal ? (
            <button type="button" onClick={post} disabled={busy !== null} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
              <UploadCloud size={14} /> {busy === 'post' ? L('Posting…', 'পোস্ট হচ্ছে…') : L('Post to ledger', 'লেজারে পোস্ট')}
            </button>
          ) : null}
          {canReverseJournal ? (
            <button type="button" onClick={() => setReversalOpen((open) => !open)} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
              <RotateCcw size={14} /> {L('Reverse', 'রিভার্স')}
            </button>
          ) : null}
        </div>
      </div>

      {journal.status === 'SUBMITTED' && !canApprove ? (
        <div className="mt-4">
          <Notice message={L('This journal is awaiting a different controller or administrator to approve it.', 'এই জার্নালটি একজন ভিন্ন কন্ট্রোলার বা প্রশাসকের অনুমোদনের অপেক্ষায় আছে।')} tone="warning" />
        </div>
      ) : null}
      {journal.status === 'POSTED' && !journal.reversalOfJournalId ? (
        <div className="mt-4">
          <Notice message={L('Posted. This journal is immutable; use a linked reversal for a correction.', 'পোস্টেড। এই জার্নাল অপরিবর্তনীয়; সংশোধনের জন্য লিংকড রিভার্সাল ব্যবহার করুন।')} tone="success" />
        </div>
      ) : null}
      {error ? <div className="mt-4"><ErrorBanner message={error} details={details} /></div> : null}

      <dl className="mt-5 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Posting date', 'পোস্টিং তারিখ')}</dt>
          <dd className="mt-1 text-ink-900">{formatDate(journal.postingDate, locale)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Period', 'হিসাবকাল')}</dt>
          <dd className="mt-1 font-mono text-ink-900">{journal.periodCode}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Source', 'উৎস')}</dt>
          <dd className="mt-1 text-ink-900">{sourceLabel(journal.sourceModule, locale)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Evidence reference', 'প্রমাণের রেফারেন্স')}</dt>
          <dd className="mt-1 break-words text-ink-900">{journal.attachmentReference ?? journal.sourceDocRef ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Created by', 'তৈরি করেছেন')}</dt>
          <dd className="mt-1 text-ink-900">{journal.createdByName} · {formatDateTime(journal.createdAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Submitted by', 'জমা দিয়েছেন')}</dt>
          <dd className="mt-1 text-ink-900">{journal.submittedByName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Approved by', 'অনুমোদন করেছেন')}</dt>
          <dd className="mt-1 text-ink-900">{journal.approvedByName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Posted by', 'পোস্ট করেছেন')}</dt>
          <dd className="mt-1 text-ink-900">{journal.postedByName ?? '—'}</dd>
        </div>
      </dl>

      {journal.reversedByJournalId ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-700 dark:text-rose-300">
          {L('Reversed', 'বাতিল')} {journal.reversalJournalNumber ?? ''} · {journal.reversalReason ?? ''}{' '}
          <button type="button" onClick={() => onOpenJournal(journal.reversedByJournalId!)} className="font-semibold underline">
            {L('Open reversal', 'রিভার্সাল খুলুন')}
          </button>
        </div>
      ) : null}
      {journal.reversalOfJournalId ? (
        <div className="mt-4 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-[13px] text-ink-600">
          {L('Reversal of', 'রিভার্সাল')}{' '}
          <button type="button" onClick={() => onOpenJournal(journal.reversalOfJournalId!)} className="font-semibold text-brand-bright underline">
            {journal.originalJournalNumber ?? journal.reversalOfJournalId}
          </button>
          {journal.reversalReason ? ` · ${journal.reversalReason}` : ''}
        </div>
      ) : null}

      {reversalOpen ? (
        <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <h3 className="text-[15px] font-semibold text-ink-900">{L('Linked reversal', 'লিংকড রিভার্সাল')}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            {L(
              'The reversal mirrors every line on a new posting date. The original remains in history and a second reversal is blocked.',
              'রিভার্সাল নতুন পোস্টিং তারিখে প্রতিটি লাইনের বিপরীত এন্ট্রি তৈরি করে। মূল জার্নাল ইতিহাসে থাকবে এবং দ্বিতীয় রিভার্সাল বন্ধ থাকবে।',
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,2fr)]">
            <Field label={L('Reversal date', 'রিভার্সাল তারিখ')} required>
              <input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label={L('Reason', 'কারণ')} required hint={L('Stored permanently on both journals and in the audit log.', 'উভয় জার্নাল এবং অডিট লগে স্থায়ীভাবে সংরক্ষিত হবে।')}>
              <input value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} className={INPUT_CLASS} maxLength={500} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={reverse} disabled={busy !== null} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
              <RotateCcw size={14} /> {busy === 'reverse' ? L('Reversing…', 'রিভার্স হচ্ছে…') : L('Post reversal', 'রিভার্সাল পোস্ট')}
            </button>
            <button type="button" onClick={() => setReversalOpen(false)} disabled={busy !== null} className="lv-btn lv-btn-ghost min-h-11 text-[13px]">
              {L('Cancel', 'বাতিল')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="lv-table w-full min-w-[720px] text-[13px]">
          <caption className="sr-only">{L('Journal lines', 'জার্নাল লাইন')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{L('Line', 'লাইন')}</th>
              <th scope="col" className="text-left">{L('Account', 'হিসাব')}</th>
              <th scope="col" className="text-left">{L('Analysis / memo', 'বিশ্লেষণ / মেমো')}</th>
              <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
              <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
            </tr>
          </thead>
          <tbody>
            {journal.lines.map((line) => (
              <tr key={line.id}>
                <td className="align-top font-mono text-ink-500">{line.lineNo}</td>
                <td className="align-top">
                  <span className="font-mono text-ink-500">{line.accountCode}</span>
                  <span className="ml-2 text-ink-900">{line.accountNameEn}</span>
                </td>
                <td className="align-top text-ink-500">
                  {[line.partyName, line.partyReference, line.costCenter, line.projectCode, line.memo].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="align-top text-right font-mono tabular-nums">{line.debitBdt === '0.00' ? '—' : line.debitBdt}</td>
                <td className="align-top text-right font-mono tabular-nums">{line.creditBdt === '0.00' ? '—' : line.creditBdt}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="text-right text-[12px] uppercase tracking-[0.05em] text-ink-400">{L('Totals', 'মোট')}</th>
              <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(totalDebit)}</td>
              <td className="text-right font-mono font-semibold tabular-nums">{poishaToBdtString(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6">
        <h3 className="text-[15px] font-semibold text-ink-900">{L('Audit trail', 'অডিট ট্রেইল')}</h3>
        {journal.auditTrail.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-500">{L('No audit events recorded.', 'কোনো অডিট ইভেন্ট নেই।')}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {journal.auditTrail.map((event) => (
              <li key={event.id} className="rounded-lg border border-line/70 bg-surface-2/30 px-3 py-2 text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-ink-700">{event.action}</span>
                  <span className="text-ink-400">{formatDateTime(event.createdAt, locale)}</span>
                </div>
                <div className="mt-0.5 text-ink-500">
                  {event.actorName ?? L('System', 'সিস্টেম')}
                  {event.reason ? ` · ${event.reason}` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export default JournalDetail;
