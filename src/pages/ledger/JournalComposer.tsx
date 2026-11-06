import { useMemo, useState } from 'react';
import { Plus, Save, Send, Trash2, UploadCloud } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { FiscalPeriod, SetupAccount } from '../../setup/api';
import { ledgerApi, type JournalDetail, type JournalInput } from '../../ledger/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { dateToday, dateWithin, newIdempotencyKey, parseBdt, poishaToBdtString } from './ledgerUi';

interface EditorLine {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  partyReference: string;
  partyName: string;
  costCenter: string;
  projectCode: string;
  memo: string;
}

function lineKey(): string {
  return `jl-${Math.random().toString(36).slice(2, 10)}`;
}

function blankLine(): EditorLine {
  return {
    key: lineKey(),
    accountId: '',
    debit: '',
    credit: '',
    partyReference: '',
    partyName: '',
    costCenter: '',
    projectCode: '',
    memo: '',
  };
}

function fromJournal(journal: JournalDetail): EditorLine[] {
  return journal.lines.map((line) => ({
    key: line.id,
    accountId: line.accountId,
    debit: line.debitBdt === '0.00' ? '' : line.debitBdt,
    credit: line.creditBdt === '0.00' ? '' : line.creditBdt,
    partyReference: line.partyReference ?? '',
    partyName: line.partyName ?? '',
    costCenter: line.costCenter ?? '',
    projectCode: line.projectCode ?? '',
    memo: line.memo ?? '',
  }));
}

function defaultDate(periods: FiscalPeriod[]): string {
  const today = dateToday();
  const current = periods.find((period) => dateWithin(period, today));
  if (current) return today;
  return periods.find((period) => period.status === 'OPEN')?.startDate ?? periods[0]?.startDate ?? today;
}

function asOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function JournalComposer({
  companyId,
  accounts,
  periods,
  branches,
  initial,
  canPost,
  onSaved,
  onCancel,
}: {
  companyId: string;
  accounts: SetupAccount[];
  periods: FiscalPeriod[];
  branches: Array<{ id: string; code: string; nameEn: string }>;
  initial: JournalDetail | null;
  canPost: boolean;
  onSaved: (journal: JournalDetail, message: string) => void;
  onCancel: () => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const activeAccounts = accounts.filter((account) => account.isActive);
  const [date, setDate] = useState(initial?.documentDate ?? defaultDate(periods));
  const [branchId, setBranchId] = useState(initial?.branchId ?? '');
  const [narration, setNarration] = useState(initial?.narrationEn ?? '');
  const [attachmentReference, setAttachmentReference] = useState(initial?.attachmentReference ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() =>
    initial ? fromJournal(initial) : [blankLine(), blankLine()],
  );
  const [busy, setBusy] = useState<'SAVE' | 'SUBMIT' | 'POST' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [postKey] = useState(() => newIdempotencyKey());

  const totals = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    let invalid = false;
    for (const line of lines) {
      const parsedDebit = parseBdt(line.debit);
      const parsedCredit = parseBdt(line.credit);
      if (parsedDebit === null || parsedCredit === null) {
        invalid = true;
        continue;
      }
      if (parsedDebit > 0n && parsedCredit > 0n) invalid = true;
      debit += parsedDebit;
      credit += parsedCredit;
    }
    return {
      debit,
      credit,
      difference: debit - credit,
      balanced: debit === credit && debit > 0n && !invalid,
      invalid,
    };
  }, [lines]);

  const setLine = <K extends keyof EditorLine>(key: string, field: K, value: EditorLine[K]): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  };

  const addLine = (): void => setLines((current) => [...current, blankLine()]);
  const removeLine = (key: string): void => {
    setLines((current) => (current.length <= 2 ? current : current.filter((line) => line.key !== key)));
  };

  const payload = (): JournalInput => ({
    date,
    branchId: branchId || null,
    narration: narration.trim(),
    attachmentReference: asOptional(attachmentReference),
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit.trim() || '0',
      credit: line.credit.trim() || '0',
      partyReference: asOptional(line.partyReference),
      partyName: asOptional(line.partyName),
      costCenter: asOptional(line.costCenter),
      projectCode: asOptional(line.projectCode),
      memo: asOptional(line.memo),
    })),
  });

  const validateBeforeSend = (requireBalance: boolean): boolean => {
    setError(null);
    setDetails(undefined);
    setNotice(null);
    if (!narration.trim()) {
      setError(L('Enter a narration for the journal.', 'জার্নালের জন্য বিবরণ লিখুন।'));
      return false;
    }
    if (!date) {
      setError(L('Choose a journal date.', 'জার্নালের তারিখ নির্বাচন করুন।'));
      return false;
    }
    if (lines.length < 2) {
      setError(L('A journal needs at least two lines.', 'জার্নালে অন্তত দুইটি লাইন প্রয়োজন।'));
      return false;
    }
    if (
      lines.some(
        (line) =>
          !line.accountId ||
          (!line.debit.trim() && !line.credit.trim()) ||
          (line.debit.trim() && line.credit.trim()),
      )
    ) {
      setError(
        L(
          'Every line needs one account and exactly one positive debit or credit.',
          'প্রতিটি লাইনে একটি হিসাব এবং শুধুমাত্র একটি ডেবিট বা ক্রেডিট থাকতে হবে।',
        ),
      );
      return false;
    }
    if (totals.invalid) {
      setError(
        L(
          'Amounts must be non-negative BDT with up to two decimals.',
          'অঙ্কগুলি অ-ঋণাত্মক টাকা হতে হবে এবং সর্বোচ্চ দুই দশমিক স্থান থাকতে পারে।',
        ),
      );
      return false;
    }
    if (requireBalance && !totals.balanced) {
      setError(
        L(
          'Debit and credit totals must match before submitting or posting.',
          'জমা বা পোস্ট করার আগে ডেবিট ও ক্রেডিট মোট সমান হতে হবে।',
        ),
      );
      return false;
    }
    return true;
  };

  const save = async (): Promise<JournalDetail> => {
    const input = payload();
    return initial
      ? (await ledgerApi.updateJournal(companyId, initial.id, input)).journal
      : (await ledgerApi.createJournal(companyId, input)).journal;
  };

  const run = async (action: 'SAVE' | 'SUBMIT' | 'POST'): Promise<void> => {
    if (!canPost) return;
    if (!validateBeforeSend(action !== 'SAVE')) return;
    if (action === 'SUBMIT' && !window.confirm(
      L(
        'Submit this journal for approval? Its content will be locked and cannot be edited.',
        'এই জার্নালটি অনুমোদনের জন্য জমা দেবেন? এর বিষয়বস্তু লক হয়ে যাবে এবং সম্পাদনা করা যাবে না।',
      ),
    )) {
      return;
    }
    if (action === 'POST' && !window.confirm(
      L(
        'Post this journal to the ledger? Posted journals cannot be edited or deleted; corrections require a linked reversal.',
        'এই জার্নালটি লেজারে পোস্ট করবেন? পোস্ট করা জার্নাল সম্পাদনা বা মুছে ফেলা যাবে না; সংশোধনের জন্য লিংকড রিভার্সাল প্রয়োজন।',
      ),
    )) {
      return;
    }
    setBusy(action);
    try {
      const saved = await save();
      if (action === 'SAVE') {
        onSaved(
          saved,
          L(
            'Journal draft saved. The server recomputed all totals.',
            'জার্নাল খসড়া সংরক্ষিত হয়েছে। সার্ভার সব মোট পুনরায় গণনা করেছে।',
          ),
        );
        return;
      }
      if (action === 'SUBMIT') {
        const submitted = await ledgerApi.submitJournal(companyId, saved.id);
        onSaved(
          submitted.journal,
          L(
            'Journal submitted. A different controller can approve it if approval is required.',
            'জার্নাল জমা হয়েছে। অনুমোদন প্রয়োজন হলে একজন ভিন্ন কন্ট্রোলার এটি অনুমোদন করতে পারেন।',
          ),
        );
        return;
      }
      const posted = await ledgerApi.postJournal(companyId, saved.id, postKey);
      onSaved(
        posted.journal,
        posted.replayed
          ? L('This journal was already posted; the original result was returned.', 'এই জার্নাল ইতিমধ্যে পোস্ট হয়েছে; মূল ফলাফল ফেরত দেওয়া হয়েছে।')
          : L(`Journal ${posted.journal.journalNumber ?? ''} posted.`, `জার্নাল ${posted.journal.journalNumber ?? ''} পোস্ট হয়েছে।`),
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="lv-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="lv-kicker">{L('General journal', 'সাধারণ জার্নাল')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {initial
              ? L('Edit journal draft', 'জার্নাল খসড়া সম্পাদনা')
              : L('New manual journal', 'নতুন ম্যানুয়াল জার্নাল')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'The server validates the period, accounts and exact debit/credit balance. Drafts may be unbalanced; submission and posting are rejected until they balance.',
              'সার্ভার মেয়াদ, হিসাব এবং সঠিক ডেবিট/ক্রেডিট ভারসাম্য যাচাই করে। খসড়া অসুষম থাকতে পারে; সুষম না হলে জমা ও পোস্টিং প্রত্যাখ্যাত হবে।',
            )}
          </p>
        </div>
        <span className={`lv-chip ${totals.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`} role="status">
          {totals.balanced
            ? L('Balanced', 'সুষম')
            : L('Unbalanced', 'অসুষম')}
        </span>
      </div>

      {!canPost ? (
        <div className="mt-4">
          <Notice
            message={L(
              'Your role can read the ledger but cannot create or post journals.',
              'আপনার ভূমিকা লেজার পড়তে পারে কিন্তু জার্নাল তৈরি বা পোস্ট করতে পারে না।',
            )}
            tone="warning"
          />
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorBanner message={error} details={details} />
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4">
          <Notice message={notice} tone="success" />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <Field label={L('Journal date', 'জার্নাল তারিখ')} required hint={L('The date must fall inside an OPEN accounting period to post.', 'পোস্ট করার জন্য তারিখটি একটি OPEN হিসাবকালের মধ্যে থাকতে হবে।')}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={INPUT_CLASS}
            disabled={busy !== null}
            required
          />
        </Field>
        <Field
          label={L('Branch (optional)', 'শাখা (ঐচ্ছিক)')}
          hint={L(
            'Branch attribution is used by branch-scoped reports. Leave blank for a company-wide or legacy journal.',
            'শাখা-ভিত্তিক রিপোর্টে শাখার অন্তর্ভুক্তি ব্যবহৃত হয়। কোম্পানি-ব্যাপী বা পুরোনো জার্নালের জন্য খালি রাখুন।',
          )}
        >
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className={INPUT_CLASS}
            disabled={busy !== null}
          >
            <option value="">{L('Unassigned / company-wide', 'অনির্ধারিত / কোম্পানি-ব্যাপী')}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>
            ))}
          </select>
        </Field>
        <Field
          label={L('Attachment / evidence reference', 'সংযুক্তি / প্রমাণের রেফারেন্স')}
          hint={L(
            'This release stores a reference only, not file content. Keep the source document in your controlled evidence store.',
            'এই সংস্করণে শুধুমাত্র রেফারেন্স সংরক্ষিত হয়, ফাইল নয়। মূল প্রমাণ নিয়ন্ত্রিত সংরক্ষণাগারে রাখুন।',
          )}
        >
          <input
            value={attachmentReference}
            onChange={(event) => setAttachmentReference(event.target.value)}
            className={INPUT_CLASS}
            maxLength={500}
            disabled={busy !== null}
            placeholder={L('e.g. voucher, board minute or file reference', 'যেমন ভাউচার, বোর্ড সিদ্ধান্ত বা ফাইল রেফারেন্স')}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label={L('Narration', 'বিবরণ')} required>
          <input
            value={narration}
            onChange={(event) => setNarration(event.target.value)}
            className={INPUT_CLASS}
            maxLength={500}
            disabled={busy !== null}
            placeholder={L('What is this journal for?', 'এই জার্নালটি কীসের জন্য?')}
          />
        </Field>
      </div>

      <div className="mt-5 space-y-2">
        <div className="hidden gap-2 px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-400 md:grid md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem]">
          <span>{L('Account', 'হিসাব')}</span>
          <span>{L('Debit (BDT)', 'ডেবিট (টাকা)')}</span>
          <span>{L('Credit (BDT)', 'ক্রেডিট (টাকা)')}</span>
          <span className="sr-only">{L('Remove', 'সরান')}</span>
        </div>
        {lines.map((line, index) => (
          <div key={line.key} className="rounded-xl border border-line/80 bg-surface-2/30 p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] md:items-start">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-600 md:sr-only">
                  {L('Account', 'হিসাব')} {index + 1}
                </span>
                <select
                  value={line.accountId}
                  onChange={(event) => setLine(line.key, 'accountId', event.target.value)}
                  className="lv-select min-h-11 w-full text-[14px]"
                  disabled={busy !== null}
                  required
                >
                  <option value="">{L('Choose account', 'হিসাব নির্বাচন করুন')}</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-600 md:sr-only">
                  {L('Debit', 'ডেবিট')} {index + 1}
                </span>
                <input
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(event) => setLine(line.key, 'debit', event.target.value)}
                  className={INPUT_CLASS}
                  placeholder="0.00"
                  disabled={busy !== null}
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-600 md:sr-only">
                  {L('Credit', 'ক্রেডিট')} {index + 1}
                </span>
                <input
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(event) => setLine(line.key, 'credit', event.target.value)}
                  className={INPUT_CLASS}
                  placeholder="0.00"
                  disabled={busy !== null}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length <= 2 || busy !== null}
                className="mt-5 grid h-11 w-11 place-items-center rounded-lg border border-line text-ink-400 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 md:mt-0"
                aria-label={`${L('Remove line', 'লাইন সরান')} ${index + 1}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-brand-bright">
                {L('Analysis: party, cost centre, project, memo', 'বিশ্লেষণ: পক্ষ, খরচ কেন্দ্র, প্রকল্প, মেমো')}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-[12px] font-medium text-ink-600">
                  {L('Party reference', 'পক্ষের রেফারেন্স')}
                  <input
                    value={line.partyReference}
                    onChange={(event) => setLine(line.key, 'partyReference', event.target.value)}
                    className={`${INPUT_CLASS} mt-1`}
                    maxLength={200}
                    disabled={busy !== null}
                  />
                </label>
                <label className="block text-[12px] font-medium text-ink-600">
                  {L('Party name', 'পক্ষের নাম')}
                  <input
                    value={line.partyName}
                    onChange={(event) => setLine(line.key, 'partyName', event.target.value)}
                    className={`${INPUT_CLASS} mt-1`}
                    maxLength={200}
                    disabled={busy !== null}
                  />
                </label>
                <label className="block text-[12px] font-medium text-ink-600">
                  {L('Cost centre', 'খরচ কেন্দ্র')}
                  <input
                    value={line.costCenter}
                    onChange={(event) => setLine(line.key, 'costCenter', event.target.value)}
                    className={`${INPUT_CLASS} mt-1`}
                    maxLength={120}
                    disabled={busy !== null}
                  />
                </label>
                <label className="block text-[12px] font-medium text-ink-600">
                  {L('Project', 'প্রকল্প')}
                  <input
                    value={line.projectCode}
                    onChange={(event) => setLine(line.key, 'projectCode', event.target.value)}
                    className={`${INPUT_CLASS} mt-1`}
                    maxLength={120}
                    disabled={busy !== null}
                  />
                </label>
              </div>
              <label className="mt-2 block text-[12px] font-medium text-ink-600">
                {L('Line memo', 'লাইনের মেমো')}
                <input
                  value={line.memo}
                  onChange={(event) => setLine(line.key, 'memo', event.target.value)}
                  className={`${INPUT_CLASS} mt-1`}
                  maxLength={500}
                  disabled={busy !== null}
                />
              </label>
            </details>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={addLine}
          disabled={busy !== null || lines.length >= 2000}
          className="lv-btn lv-btn-secondary min-h-11 text-[13px]"
        >
          <Plus size={14} /> {L('Add line', 'লাইন যোগ করুন')}
        </button>
      </div>

      <dl className="mt-5 grid gap-3 rounded-xl border border-line bg-surface-2/40 p-4 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Debit total', 'ডেবিট মোট')}</dt>
          <dd className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-ink-900">{poishaToBdtString(totals.debit)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Credit total', 'ক্রেডিট মোট')}</dt>
          <dd className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-ink-900">{poishaToBdtString(totals.credit)}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-400">{L('Difference', 'পার্থক্য')}</dt>
          <dd className={`mt-1 font-mono text-[16px] font-semibold tabular-nums ${totals.difference === 0n ? 'text-emerald-600' : 'text-rose-600'}`}>
            {poishaToBdtString(totals.difference)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run('SAVE')} disabled={!canPost || busy !== null} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
          <Save size={15} /> {busy === 'SAVE' ? L('Saving…', 'সংরক্ষণ হচ্ছে…') : L('Save draft', 'খসড়া সংরক্ষণ')}
        </button>
        <button type="button" onClick={() => void run('SUBMIT')} disabled={!canPost || busy !== null} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
          <Send size={15} /> {busy === 'SUBMIT' ? L('Submitting…', 'জমা হচ্ছে…') : L('Submit', 'জমা দিন')}
        </button>
        <button type="button" onClick={() => void run('POST')} disabled={!canPost || busy !== null} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
          <UploadCloud size={15} /> {busy === 'POST' ? L('Posting…', 'পোস্ট হচ্ছে…') : L('Post to ledger', 'লেজারে পোস্ট')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy !== null} className="lv-btn lv-btn-ghost min-h-11 text-[13px]">
          {L('Cancel', 'বাতিল')}
        </button>
      </div>
    </section>
  );
}

export default JournalComposer;
