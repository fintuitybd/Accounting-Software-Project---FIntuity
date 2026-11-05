// LedgerVault — Signature component #3: the Ledger Lens.
//
// A high-contrast slide-over microscope over one posted journal. It flips in 3D between a classic
// T-account and the underlying journal voucher, proves the SHA-256 hash chain, and is the only place
// in the product that can reverse an entry — always with a mandatory audit reason.
//
// Nothing is deleted from a ledger. A reversal is a new, linked journal with the opposite Dr/Cr; the
// original stays in the chain marked REVERSED and both entries point at each other.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  ArrowRight,
  Ban,
  BookMarked,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  Copy,
  FileText,
  Fingerprint,
  GitBranch,
  Hash,
  Layers,
  Link2,
  Lock,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sigma,
  TriangleAlert,
  X,
} from 'lucide-react';

import { LINKED_REVERSAL_NOTE, useVault } from '../../context/VaultContext';
import { computeAuditHash, shortHash } from '../../core/ledger/ledgerEngine';
import type { BookType, DocumentLifecycleStatus, JournalEntry, JournalLine } from '../../core/types';

type LensTab = 'ENTRY' | 'INTEGRITY' | 'REVERSAL';
type LensView = 'T_ACCOUNT' | 'VOUCHER';

const BOOK_LABEL: Record<BookType, { en: string; bn: string; className: string }> = {
  STATUTORY_BD: { en: 'STATUTORY_BD', bn: 'সংবিধিবদ্ধ বিডি', className: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30' },
  IFRS_GROUP_ADJ: { en: 'IFRS_GROUP_ADJ', bn: 'আইএফআরএস গ্রুপ', className: 'bg-indigo-400/15 text-indigo-100 ring-indigo-300/30' },
  TAX_COMPUTATION: { en: 'TAX_COMPUTATION', bn: 'কর হিসাব', className: 'bg-amber-400/15 text-amber-100 ring-amber-300/30' },
  MANAGEMENT_MIS: { en: 'MANAGEMENT_MIS', bn: 'ব্যবস্থাপনা', className: 'bg-sky-400/15 text-sky-100 ring-sky-300/30' },
};

const STATUS_TONE: Record<DocumentLifecycleStatus, string> = {
  DRAFT: 'bg-ink-100 text-ink-600 ring-ink-200',
  SUBMITTED: 'bg-amber-50 text-amber-700 ring-amber-200',
  APPROVED: 'bg-gold-100 text-gold-700 ring-gold-200',
  POSTED: 'bg-vault-100 text-vault-800 ring-vault-200',
  SETTLED: 'bg-sky-50 text-sky-700 ring-sky-200',
  RECONCILED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  REVERSED: 'bg-rose-50 text-rose-700 ring-rose-200',
  PERIOD_CLOSED: 'bg-ink-800 text-ink-50 ring-ink-700',
};

const REASON_PRESETS: Array<{ en: string; bn: string }> = [
  { en: 'Wrong counterparty posted', bn: 'ভুল প্রতিপক্ষ পোস্ট হয়েছে' },
  { en: 'Duplicate posting of the same bill', bn: 'একই বিল দুইবার পোস্ট হয়েছে' },
  { en: 'Incorrect VAT / TDS category', bn: 'ভুল ভ্যাট / টিডিএস শ্রেণি' },
  { en: 'Wrong period — cut-off correction', bn: 'ভুল সময়কাল — কাট-অফ সংশোধন' },
  { en: 'Amount or quantity typo', bn: 'অঙ্ক বা পরিমাণে ভুল' },
];

export interface LedgerLensModalProps {
  journal: JournalEntry | null;
  onClose: () => void;
  open?: boolean;
  initialTab?: LensTab;
  onReversed?: (reversal: JournalEntry) => void;
  className?: string;
  /** e.g. "Invoice INV-2026-10-0014 · Mushak 6.3" so the lens shows where it was opened from. */
  contextLabel?: string;
}

export function LedgerLensModal({
  journal,
  onClose,
  open,
  initialTab = 'ENTRY',
  onReversed,
  className = '',
  contextLabel,
}: LedgerLensModalProps) {
  const vault = useVault();
  const { money, locale, journals, auditChain } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const isOpen = open ?? Boolean(journal);
  const [tab, setTab] = useState<LensTab>(initialTab);
  const [view, setView] = useState<LensView>('T_ACCOUNT');
  const [flipped, setFlipped] = useState(false);
  const [viewing, setViewing] = useState<JournalEntry | null>(journal);
  const [reason, setReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const journalId = journal?.id ?? '';

  useEffect(() => {
    setViewing(journal);
    setTab(initialTab);
    setView('T_ACCOUNT');
    setFlipped(false);
    setReason('');
    setFeedback(null);
    setReversing(false);
  }, [journalId, initialTab]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const current = viewing ?? journal;

  const totals = useMemo(() => {
    if (!current) return { debit: 0n, credit: 0n, balanced: true, debitLines: [] as JournalLine[], creditLines: [] as JournalLine[] };
    const debit = current.lines.reduce((sum, line) => sum + line.debit_poisha, 0n);
    const credit = current.lines.reduce((sum, line) => sum + line.credit_poisha, 0n);
    return {
      debit,
      credit,
      balanced: debit === credit,
      debitLines: current.lines.filter((line) => line.debit_poisha > 0n),
      creditLines: current.lines.filter((line) => line.credit_poisha > 0n),
    };
  }, [current]);

  const chainIndex = useMemo(() => {
    if (!current) return -1;
    return journals.findIndex((entry) => entry.id === current.id);
  }, [journals, current]);

  const predecessor = chainIndex > 0 ? journals[chainIndex - 1] : null;
  const successor = chainIndex >= 0 && chainIndex < journals.length - 1 ? journals[chainIndex + 1] : null;

  const reversalEntry = useMemo(() => {
    if (!current?.reversed_by_journal_id) return null;
    return journals.find((entry) => entry.id === current.reversed_by_journal_id) ?? null;
  }, [journals, current]);

  const selfHashValid = useMemo(() => {
    if (!current) return false;
    return computeAuditHash(current.prev_audit_hash, current) === current.audit_hash;
  }, [current]);
  const linkValid = Boolean(
    current &&
      (!successor || successor.prev_audit_hash === current.audit_hash) &&
      (!predecessor || predecessor.audit_hash === current.prev_audit_hash),
  );
  const chainValid = selfHashValid && linkValid && auditChain.valid;

  if (!isOpen) return null;

  const canReverse =
    current !== null &&
    !current.reversed_by_journal_id &&
    !current.reversal_of_journal_id &&
    current.status !== 'REVERSED' &&
    reason.trim().length >= 8 &&
    !reversing;

  const handleReverse = (): void => {
    if (!current || !canReverse) return;
    setReversing(true);
    const outcome = vault.reverseJournal(current.id, reason.trim());
    setReversing(false);
    if (!outcome.ok) {
      setFeedback({ ok: false, message: outcome.error ?? L('The ledger rejected the reversal.', 'লেজার রিভার্সাল প্রত্যাখ্যান করেছে।') });
      return;
    }
    const reversal = outcome.data;
    if (reversal) {
      setViewing(reversal);
      setTab('ENTRY');
      setView('T_ACCOUNT');
      setFlipped(false);
      setFeedback({
        ok: true,
        message: L(
          `Reversal ${reversal.journal_number} posted and linked back to ${current.journal_number}.`,
          `রিভার্সাল ${reversal.journal_number} পোস্ট হয়েছে এবং ${current.journal_number}-এর সঙ্গে লিংকড।`,
        ),
      });
      if (onReversed) onReversed(reversal);
    } else {
      setFeedback({ ok: true, message: L('Reversal posted.', 'রিভার্সাল পোস্ট হয়েছে।') });
    }
    setReason('');
  };

  const flip = (next?: LensView): void => {
    const target = next ?? (view === 'T_ACCOUNT' ? 'VOUCHER' : 'T_ACCOUNT');
    setView(target);
    setFlipped(target === 'VOUCHER');
  };

  const content = (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={L('Ledger lens', 'লেজার লেন্স')}>
      <motion.div
        initial={{ x: '100%', opacity: 0.4 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.8 }}
        className={`relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-canvas shadow-pop ${className}`}
      >
        {/* -------------------------------------------------------------------------------- */}
        {/* Header                                                                            */}
        {/* -------------------------------------------------------------------------------- */}
        <header className="relative overflow-hidden bg-gradient-to-r from-vault-950 via-vault-900 to-vault-800 px-5 py-4 text-white">
          <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-gold-400/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
                <Fingerprint size={20} strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-vault-200">
                  {L('Ledger lens · immutable journal', 'লেজার লেন্স · অপরিবর্তনীয় জার্নাল')}
                </p>
                <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight">
                  <span className="font-mono">{current?.journal_number ?? '—'}</span>
                  {current ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${STATUS_TONE[current.status]}`}>
                      {current.status.replaceAll('_', ' ')}
                    </span>
                  ) : null}
                  {current ? (
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.08em] ring-1 ring-inset ${BOOK_LABEL[current.book_type].className}`}>
                      {isBn ? BOOK_LABEL[current.book_type].bn : BOOK_LABEL[current.book_type].en}
                    </span>
                  ) : null}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-vault-200/90">
                  {contextLabel ?? (current ? (isBn ? current.narration_bn : current.narration_en) : '')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('REVERSAL')}
                disabled={!current || Boolean(current.reversed_by_journal_id) || current.status === 'REVERSED'}
                className="hidden items-center gap-1.5 rounded-lg bg-rose-500/20 px-2.5 py-1.5 text-[10px] font-semibold text-rose-100 ring-1 ring-rose-300/30 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
              >
                <RotateCcw size={12} /> {L('Reverse', 'রিভার্স')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-xl bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
                aria-label={L('Close', 'বন্ধ করুন')}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
            <ChainBadge valid={chainValid} checked={auditChain.checkedCount} isBn={isBn} />
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-vault-100 ring-1 ring-white/15">
              <Lock size={9} /> {current?.rule_pack_version ?? 'bd-2026-v1'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-vault-100 ring-1 ring-white/15">
              <BookMarked size={9} /> {current?.period_code ?? '—'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-vault-100 ring-1 ring-white/15">
              <Clock size={9} /> {current?.posting_date ?? '—'}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${totals.balanced ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/40' : 'bg-rose-500/20 text-rose-100 ring-rose-300/40'}`}>
              <Scale size={9} /> {totals.balanced ? L('debits = credits', 'ডেবিট = ক্রেডিট') : L('out of balance', 'অসমতাবদ্ধ')}
            </span>
            <span className="ml-auto hidden font-mono text-[9px] text-vault-300/80 sm:inline">
              {shortHash(current?.audit_hash ?? '', 20)}
            </span>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
          <div className="lv-seg">
            <TabButton active={tab === 'ENTRY'} onClick={() => setTab('ENTRY')} icon={<FileText size={12} />}>
              {L('Entry', 'এন্ট্রি')}
            </TabButton>
            <TabButton active={tab === 'INTEGRITY'} onClick={() => setTab('INTEGRITY')} icon={<ShieldCheck size={12} />}>
              {L('Integrity', 'অখণ্ডতা')}
            </TabButton>
            <TabButton active={tab === 'REVERSAL'} onClick={() => setTab('REVERSAL')} icon={<RotateCcw size={12} />}>
              {L('Reverse entry', 'রিভার্স এন্ট্রি')}
            </TabButton>
          </div>
          {tab === 'ENTRY' ? (
            <div className="flex items-center gap-1.5">
              <ViewButton active={view === 'T_ACCOUNT'} onClick={() => flip('T_ACCOUNT')}>
                <Layers size={11} /> T-account
              </ViewButton>
              <ViewButton active={view === 'VOUCHER'} onClick={() => flip('VOUCHER')}>
                <FileText size={11} /> Voucher
              </ViewButton>
              <button
                type="button"
                onClick={() => flip()}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[10px] font-semibold text-ink-600 transition hover:border-vault-300 hover:text-vault-800"
              >
                <ArrowLeftRight size={11} /> {L('Flip', 'ফ্লিপ')}
              </button>
            </div>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
              {current?.lines.length ?? 0} {L('lines', 'লাইন')}
            </span>
          )}
        </div>

        {/* Meta strip */}
        {current ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-line bg-surface-2 px-4 py-2 text-[10px] sm:grid-cols-3 lg:grid-cols-6">
            <Meta label={L('Document date', 'ডকুমেন্ট তারিখ')} value={current.document_date} />
            <Meta label={L('Posting date', 'পোস্টিং তারিখ')} value={current.posting_date} />
            <Meta label={L('Tax point', 'কর পয়েন্ট')} value={current.tax_point_date} />
            <Meta label={L('Source', 'উৎস')} value={current.source_module.replaceAll('_', ' ')} />
            <Meta label={L('BIN unit', 'বিআইএন ইউনিট')} value={current.bin_unit_id} />
            <Meta label={L('Created by', 'তৈরি করেছেন')} value={current.created_by} />
          </div>
        ) : null}

        {/* -------------------------------------------------------------------------------- */}
        {/* Body                                                                              */}
        {/* -------------------------------------------------------------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {!current ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Layers size={28} className="text-ink-300" />
              <p className="text-sm font-semibold text-ink-700">{L('No journal selected', 'কোনো জার্নাল নির্বাচিত হয়নি')}</p>
              <p className="lv-hint max-w-sm">
                {L('Open the Ledger Lens from any invoice, bill, challan, bank line or journal row.', 'যেকোনো চালান, বিল, চালান, ব্যাংক লাইন বা জার্নাল সারি থেকে লেজার লেন্স খুলুন।')}
              </p>
            </div>
          ) : tab === 'ENTRY' ? (
            <div className="space-y-3">
              <div className="relative h-[430px]" style={{ perspective: '1800px' }}>
                <motion.div
                  className="absolute inset-0"
                  style={{ transformStyle: 'preserve-3d' }}
                  animate={{ rotateY: flipped ? 180 : 0 }}
                  transition={{ type: 'spring', stiffness: 170, damping: 22, mass: 0.9 }}
                >
                  {/* Front — T account */}
                  <div
                    className="absolute inset-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
                    style={{ backfaceVisibility: 'hidden' }}
                  >
                    <TAccountCard
                      journal={current}
                      totals={totals}
                      money={money}
                      isBn={isBn}
                      onFlip={() => flip('VOUCHER')}
                    />
                  </div>
                  {/* Back — voucher */}
                  <div
                    className="absolute inset-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
                    style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                  >
                    <VoucherCard
                      journal={current}
                      totals={totals}
                      money={money}
                      isBn={isBn}
                      onFlip={() => flip('T_ACCOUNT')}
                    />
                  </div>
                </motion.div>
              </div>

              {!totals.balanced ? (
                <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  {L('Debit and credit totals differ — the ledger engine refuses to post this state. Investigate before reversing.', 'ডেবিট ও ক্রেডিট মোট সমান নয় — লেজার ইঞ্জিন এই অবস্থায় পোস্ট করে না। রিভার্স করার আগে তদন্ত করুন।')}
                </p>
              ) : null}

              <div className="rounded-xl border border-line bg-surface p-3">
                <p className="lv-kicker mb-1">{L('Narration', 'বিবরণ')}</p>
                <p className="text-[11.5px] leading-relaxed text-ink-700">{current.narration_en}</p>
                <p className="mt-1 font-bangla text-[11.5px] leading-relaxed text-ink-600">{current.narration_bn}</p>
              </div>
            </div>
          ) : tab === 'INTEGRITY' ? (
            <div className="space-y-3">
              <div className={`flex items-start gap-3 rounded-xl border p-3 ${chainValid ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                {chainValid ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" /> : <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose-700" />}
                <div className="min-w-0">
                  <p className={`text-[12px] font-semibold ${chainValid ? 'text-emerald-900' : 'text-rose-900'}`}>
                    {chainValid ? L('SHA-256 hash chain verified', 'SHA-256 হ্যাশ চেইন যাচাইকৃত') : L('Hash chain break detected', 'হ্যাশ চেইনে ব্যাঘাত পাওয়া গেছে')}
                  </p>
                  <p className={`text-[10.5px] leading-relaxed ${chainValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {L(
                      `Each journal seals its own content plus the previous hash. ${auditChain.checkedCount} journals checked; editing any booked amount or account would break this link.`,
                      `প্রতিটি জার্নাল নিজের বিষয়বস্তু ও পূর্ববর্তী হ্যাশ সিল করে। ${auditChain.checkedCount}টি জার্নাল যাচাই হয়েছে; কোনো বুকড অঙ্ক বা হিসাব সম্পাদনা করলে এই লিংক ভেঙে যাবে।`,
                    )}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <HashBlock label={L('audit_hash', 'অডিট হ্যাশ')} value={current.audit_hash} accent copyLabel={L('Copy', 'কপি')} />
                <HashBlock label={L('prev_audit_hash', 'পূর্ববর্তী হ্যাশ')} value={current.prev_audit_hash} copyLabel={L('Copy', 'কপি')} />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ChainLink label={L('Chained from', 'চেইন উৎস')} value={predecessor ? `${predecessor.journal_number} · ${predecessor.posting_date}` : L('Genesis entry', 'জেনেসিস এন্ট্রি')} icon={<GitBranch size={13} />} />
                <ChainLink label={L('Chained into', 'চেইন গন্তব্য')} value={successor ? `${successor.journal_number} · ${successor.posting_date}` : L('Chain tip', 'চেইনের শেষ')} icon={<Link2 size={13} />} />
                <ChainLink label={L('Idempotency key', 'আইডেম্পোটেন্সি কী')} value={current.idempotency_key} icon={<Hash size={13} />} mono />
                <ChainLink label={L('Rule pack', 'রুল প্যাক')} value={current.rule_pack_version ?? 'bd-2026-v1'} icon={<BookMarked size={13} />} mono />
              </div>

              {current.reversal_of_journal_id || current.reversed_by_journal_id ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
                    <ArrowLeftRight size={13} /> {L('Linked reversal', 'লিংকড রিভার্সাল')}
                  </p>
                  {current.reversal_of_journal_id ? (
                    <p className="mt-1 text-[10.5px] text-amber-700">
                      {L('This entry reverses', 'এই এন্ট্রি রিভার্স করে')}: <span className="font-mono">{current.reversal_of_journal_id}</span>
                    </p>
                  ) : null}
                  {current.reversed_by_journal_id ? (
                    <p className="mt-1 text-[10.5px] text-amber-700">
                      {L('Reversed by', 'রিভার্স করেছে')}: <span className="font-mono">{current.reversed_by_journal_id}</span>
                      {reversalEntry ? ` · ${reversalEntry.journal_number}` : ''}
                    </p>
                  ) : null}
                  {current.reversal_reason ? <p className="mt-1 text-[10.5px] italic text-amber-700">“{current.reversal_reason}”</p> : null}
                </div>
              ) : null}

              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-400">
                <CircleAlert size={11} className="mt-0.5 shrink-0" />
                {L(
                  'The hash is computed over the ordered journal lines, dates, book type and the previous hash. Re-running verification over the whole array must return the same head.',
                  'হ্যাশটি নির্ধারিত ক্রমে জার্নাল লাইন, তারিখ, বুক টাইপ ও পূর্ববর্তী হ্যাশের উপর গণনা করা হয়। সম্পূর্ণ অ্যারের উপর পুনঃযাচাই একই হেড দিতে হবে।',
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-900">
                  <Ban size={13} /> {L('Reversal, not deletion', 'রিভার্সাল, ডিলিট নয়')}
                </p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-rose-700">{LINKED_REVERSAL_NOTE}</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-rose-700">
                  {L(
                    'The reversal gets its own journal number, its own hash and the opposite Dr/Cr, and the period lock still applies.',
                    'রিভার্সালের নিজস্ব জার্নাল নম্বর, নিজস্ব হ্যাশ এবং বিপরীত ডেবিট/ক্রেডিট থাকে; পিরিয়ড লকও প্রযোজ্য থাকে।',
                  )}
                </p>
              </div>

              {current.reversed_by_journal_id || current.status === 'REVERSED' ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {L(
                      'This journal is already reversed. A reversal of a reversal is not allowed — post a fresh correcting entry instead.',
                      'এই জার্নাল ইতিমধ্যে রিভার্স হয়েছে। রিভার্সালের রিভার্সাল অনুমোদিত নয় — বরং নতুন সংশোধনী এন্ট্রি পোস্ট করুন।',
                    )}
                  </span>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="lv-label">{L('Mandatory audit reason', 'বাধ্যতামূলক অডিট কারণ')}</span>
                      <span className={`font-mono text-[9px] ${reason.trim().length >= 8 ? 'text-emerald-600' : 'text-ink-400'}`}>
                        {reason.trim().length}/8 {L('chars', 'অক্ষর')}
                      </span>
                    </div>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      placeholder={L('e.g. Vendor TIN was wrong; the bill was re-entered against the correct supplier.', 'যেমন: ভেন্ডরের টিআইএন ভুল ছিল; বিলটি সঠিক সরবরাহকারীর বিরুদ্ধে পুনঃএন্ট্রি করা হয়েছে।')}
                      className="lv-input mt-1.5 min-h-[84px] resize-y text-[12px] leading-relaxed"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {REASON_PRESETS.map((preset) => (
                        <button
                          key={preset.en}
                          type="button"
                          onClick={() => setReason(isBn ? preset.bn : preset.en)}
                          className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[9.5px] font-semibold text-ink-600 transition hover:border-vault-300 hover:text-vault-800"
                        >
                          {isBn ? preset.bn : preset.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{L('Original entry', 'মূল এন্ট্রি')}</p>
                      <p className="mt-1 font-mono text-[11px] font-semibold text-ink-900">{current.journal_number}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{L('Debit total', 'ডেবিট মোট')}</p>
                      <p className="font-money mt-1 text-[11px] font-semibold text-ink-900">{money(totals.debit)}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{L('Reversal date', 'রিভার্সাল তারিখ')}</p>
                      <p className="mt-1 font-mono text-[11px] font-semibold text-ink-900">{new Date().toISOString().slice(0, 10)}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleReverse}
                    disabled={!canReverse}
                    className="lv-btn w-full bg-rose-600 text-white hover:bg-rose-700 disabled:hover:bg-rose-600"
                  >
                    <RotateCcw size={14} />
                    {reversing ? L('Reversing…', 'রিভার্স হচ্ছে…') : L('Reverse entry with mandatory audit reason', 'বাধ্যতামূলক অডিট কারণসহ এন্ট্রি রিভার্স করুন')}
                  </button>
                  <p className="text-center text-[9.5px] text-ink-400">
                    {L('This action is audited against your user id and cannot be undone.', 'এই কাজটি আপনার ইউজার আইডির বিরুদ্ধে অডিট হয় এবং ফিরিয়ে নেওয়া যায় না।')}
                  </p>
                </>
              )}

              {feedback ? (
                <div className={`flex items-start gap-2 rounded-xl border p-3 text-[10.5px] ${feedback.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                  {feedback.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />}
                  <span>{feedback.message}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2 text-[9.5px] text-ink-400">
            <Sigma size={12} />
            <span className="font-money truncate">
              {money(totals.debit)} {L('debit', 'ডেবিট')} · {money(totals.credit)} {L('credit', 'ক্রেডিট')}
            </span>
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${totals.balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {totals.balanced ? L('balanced', 'সমতাবদ্ধ') : L('break', 'ব্যবধান')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="lv-btn lv-btn-ghost !py-1.5">
              {L('Close lens', 'লেন্স বন্ধ')} <ArrowRight size={13} />
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );

  return createPortal(content, document.body);
}

// ---------------------------------------------------------------------------------------------
// Flip-card faces
// ---------------------------------------------------------------------------------------------

function TAccountCard({
  journal,
  totals,
  money,
  isBn,
  onFlip,
}: {
  journal: JournalEntry;
  totals: { debit: bigint; credit: bigint; balanced: boolean; debitLines: JournalLine[]; creditLines: JournalLine[] };
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  isBn: boolean;
  onFlip: () => void;
}) {
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-ink-900 to-vault-900 px-4 py-2.5 text-white">
        <div>
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-vault-200">T-account</p>
          <p className="font-mono text-[12px] font-semibold">{journal.journal_number}</p>
        </div>
        <button type="button" onClick={onFlip} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[9.5px] font-semibold text-vault-100 ring-1 ring-white/15 hover:bg-white/20">
          <ArrowLeftRight size={11} /> {L('See voucher', 'ভাউচার দেখুন')}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line">
        <TAccountSide
          title={L('Debit', 'ডেবিট')}
          subtitle="Dr"
          lines={totals.debitLines}
          total={totals.debit}
          money={money}
          isBn={isBn}
          tone="debit"
        />
        <TAccountSide
          title={L('Credit', 'ক্রেডিট')}
          subtitle="Cr"
          lines={totals.creditLines}
          total={totals.credit}
          money={money}
          isBn={isBn}
          tone="credit"
        />
      </div>
      <div className={`flex items-center justify-between gap-2 border-t px-4 py-2 text-[10px] font-semibold ${totals.balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
        <span>{totals.balanced ? L('Balanced double entry', 'সমতাবদ্ধ দ্বৈত এন্ট্রি') : L('Out of balance', 'অসমতাবদ্ধ')}</span>
        <span className="font-money">{money(totals.debit)} = {money(totals.credit)}</span>
      </div>
    </div>
  );
}

function TAccountSide({
  title,
  subtitle,
  lines,
  total,
  money,
  isBn,
  tone,
}: {
  title: string;
  subtitle: string;
  lines: JournalLine[];
  total: bigint;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  isBn: boolean;
  tone: 'debit' | 'credit';
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className={`flex items-center justify-between px-3 py-1.5 ${tone === 'debit' ? 'bg-vault-50 text-vault-800' : 'bg-ink-50 text-ink-700'}`}>
        <span className="text-[9px] font-bold uppercase tracking-[0.16em]">{title}</span>
        <span className="font-mono text-[9px] opacity-60">{subtitle}</span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="px-3 py-6 text-center text-[10px] text-ink-300">—</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5">
                    <span className="rounded bg-ink-900 px-1 py-0.5 font-mono text-[8px] text-vault-200">{line.account_code}</span>
                    <span className="truncate text-[10.5px] font-semibold text-ink-800">
                      {isBn ? line.account_name_bn : line.account_name_en}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[8.5px] text-ink-400">
                    {isBn ? line.account_name_en : line.account_name_bn}
                  </p>
                  {line.memo ? <p className="mt-0.5 line-clamp-2 text-[8.5px] italic text-ink-400">{line.memo}</p> : null}
                  {line.party_name ? <p className="mt-0.5 text-[8.5px] text-vault-600">👤 {line.party_name}</p> : null}
                </div>
                <span className="font-money shrink-0 text-[10px] font-semibold text-ink-900">
                  {money(tone === 'debit' ? line.debit_poisha : line.credit_poisha, { symbol: false })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-1.5 text-[9.5px] font-semibold text-ink-700">
        <span>{isBn ? 'মোট' : 'Total'}</span>
        <span className="font-money">{money(total, { symbol: false })}</span>
      </div>
    </div>
  );
}

function VoucherCard({
  journal,
  totals,
  money,
  isBn,
  onFlip,
}: {
  journal: JournalEntry;
  totals: { debit: bigint; credit: bigint; balanced: boolean };
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  isBn: boolean;
  onFlip: () => void;
}) {
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-4 py-2.5">
        <div>
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-ink-400">Journal voucher</p>
          <p className="font-mono text-[12px] font-semibold text-ink-900">{journal.journal_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-ink-400">{journal.document_date}</span>
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${journal.book_type === 'STATUTORY_BD' ? 'bg-vault-100 text-vault-800' : 'bg-indigo-100 text-indigo-700'}`}>
            {journal.book_type}
          </span>
          <button type="button" onClick={onFlip} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[9.5px] font-semibold text-ink-600 hover:border-vault-300">
            <ArrowLeftRight size={11} /> {L('See T-account', 'টি-হিসাব দেখুন')}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="lv-table">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-20">{L('Code', 'কোড')}</th>
              <th>{L('Account', 'হিসাব')}</th>
              <th className="w-28 text-right">{L('Debit', 'ডেবিট')}</th>
              <th className="w-28 text-right">{L('Credit', 'ক্রেডিট')}</th>
            </tr>
          </thead>
          <tbody>
            {journal.lines.map((line) => (
              <tr key={line.id}>
                <td className="font-mono text-[9px] text-ink-400">{line.line_no}</td>
                <td className="font-mono text-[9.5px] text-ink-600">{line.account_code}</td>
                <td>
                  <p className="text-[10.5px] font-semibold text-ink-800">{isBn ? line.account_name_bn : line.account_name_en}</p>
                  <p className="text-[8.5px] text-ink-400">{isBn ? line.account_name_en : line.account_name_bn}</p>
                  {line.memo ? <p className="mt-0.5 text-[8.5px] italic text-ink-400">{line.memo}</p> : null}
                </td>
                <td className="font-money text-right text-[10px] text-ink-900">{line.debit_poisha > 0n ? money(line.debit_poisha, { symbol: false }) : '—'}</td>
                <td className="font-money text-right text-[10px] text-ink-900">{line.credit_poisha > 0n ? money(line.credit_poisha, { symbol: false }) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-vault-50">
              <td colSpan={3} className="px-3 py-2 text-right text-[9px] font-bold uppercase tracking-[0.12em] text-vault-800">{L('Totals', 'মোট')}</td>
              <td className="font-money px-3 py-2 text-right text-[10px] font-semibold text-vault-900">{money(totals.debit, { symbol: false })}</td>
              <td className="font-money px-3 py-2 text-right text-[10px] font-semibold text-vault-900">{money(totals.credit, { symbol: false })}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t border-line bg-surface-2 px-4 py-2 text-[9.5px] text-ink-500">
        {isBn ? journal.narration_bn : journal.narration_en}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------------------------

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-active={active ? 'true' : 'false'} className="lv-seg-item">
      {icon} {children}
    </button>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
        active ? 'border-vault-700 bg-vault-700 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-vault-300'
      }`}
    >
      {children}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className="truncate text-[10px] text-ink-800" title={value}>{value || '—'}</p>
    </div>
  );
}

function ChainBadge({ valid, checked, isBn }: { valid: boolean; checked: number; isBn: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${valid ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/40' : 'bg-rose-500/20 text-rose-100 ring-rose-300/40'}`}>
      {valid ? <ShieldCheck size={9} /> : <TriangleAlert size={9} />}
      {valid ? (isBn ? `হ্যাশ যাচাই · ${checked}` : `Hash verified · ${checked}`) : isBn ? 'হ্যাশ ব্যাঘাত' : 'Hash break'}
    </span>
  );
}

function ChainLink({ label, value, icon, mono = false }: { label: string; value: string; icon: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line bg-surface p-2.5">
      <span className="mt-0.5 shrink-0 text-ink-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
        <p className={`truncate text-[10.5px] text-ink-800 ${mono ? 'font-mono' : ''}`} title={value}>{value || '—'}</p>
      </div>
    </div>
  );
}

function HashBlock({ label, value, accent = false, copyLabel }: { label: string; value: string; accent?: boolean; copyLabel: string }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-vault-900 bg-vault-950' : 'border-line bg-surface'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[8.5px] font-semibold uppercase tracking-[0.16em] ${accent ? 'text-vault-300' : 'text-ink-400'}`}>{label}</p>
        <CopyButton value={value} label={copyLabel} dark={accent} />
      </div>
      <p className={`mt-1 break-all font-mono text-[9px] leading-relaxed ${accent ? 'text-vault-200' : 'text-ink-600'}`}>{value || '—'}</p>
    </div>
  );
}

function CopyButton({ value, label, dark = false }: { value: string; label: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[8.5px] font-semibold transition ${dark ? 'bg-white/10 text-vault-200 hover:bg-white/20' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
      title={label}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? '✓' : label}
    </button>
  );
}

export default LedgerLensModal;
