// LedgerVault — W08 Big-4 publication-grade IAS 1 / IFRS 18 / IAS 7 statements studio.
//
// One workbench, three control axes: the FRC reporting framework, the multi-book consolidation
// scope and the P&L presentation basis. Every statement is generated live from the immutable
// ledger, every line carries its note reference, current/comparative columns and a variance badge,
// every total is double-underlined, and ANY line opens the General Ledger Account Drill-Down
// drawer with the exact journal lines behind the balance — one click from Ledger Lens.

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  BookOpen,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Download,
  FileChartColumn,
  FileSpreadsheet,
  Landmark,
  Layers,
  Printer,
  Scale,
  ScrollText,
  ShieldCheck,
  Table2,
  TrendingUp,
  X,
} from 'lucide-react';

import { CryptographicSealSvg } from '../components/svg/VaultVisuals';
import { LedgerLensModal } from '../components/signature/LedgerLensModal';
import { StatutoryPrintModal } from '../components/signature/StatutoryPrintModal';
import { formatDate } from '../core/money';
import { booksForFilter } from '../core/ifrs-engine/ifrsEngine';
import { exportFullAuditPackXlsx } from '../core/import-export/xlsxEngine';
import { useVault } from '../context/VaultContext';
import type {
  AppSettings,
  JournalEntry,
  JournalLine,
  ReportingFramework,
  StatementLine,
  StatementSection,
} from '../core/types';

type StatementTab = 'SOFP' | 'PL' | 'SOCIE' | 'CASH' | 'TB' | 'NOTES';
type PlBasis = 'IFRS18' | 'IAS1';
type CashBasis = 'INDIRECT' | 'DIRECT';

interface DrillTarget {
  codes: string[];
  label_en: string;
  label_bn: string;
  note_en: string;
  note_bn: string;
}

const TABS: Array<{ key: StatementTab; en: string; bn: string; icon: typeof Landmark }> = [
  { key: 'SOFP', en: 'Financial position', bn: 'আর্থিক অবস্থান', icon: Landmark },
  { key: 'PL', en: 'Profit or loss', bn: 'মুনাফা বা ক্ষতি', icon: TrendingUp },
  { key: 'SOCIE', en: 'Changes in equity', bn: 'ইকুইটি পরিবর্তন', icon: Scale },
  { key: 'CASH', en: 'Cash flows', bn: 'নগদ প্রবাহ', icon: Banknote },
  { key: 'TB', en: 'Trial balance', bn: 'রেওয়ামিল', icon: Table2 },
  { key: 'NOTES', en: 'Notes', bn: 'নোট', icon: ScrollText },
];

const FRAMEWORKS: Array<{
  key: ReportingFramework;
  short_en: string;
  short_bn: string;
  legal_en: string;
  legal_bn: string;
  basis_en: string;
  basis_bn: string;
}> = [
  {
    key: 'IFRS_FRC_ADOPTED',
    short_en: 'Full IFRS as adopted by FRC Bangladesh',
    short_bn: 'এফআরসি বাংলাদেশ গৃহীত পূর্ণ আইএফআরএস',
    legal_en:
      'Prepared in accordance with International Financial Reporting Standards (IFRS) as adopted by the Financial Reporting Council (FRC) of Bangladesh, the Companies Act 1994 and applicable BSEC notifications.',
    legal_bn:
      'বাংলাদেশ ফাইন্যান্সিয়াল রিপোর্টিং কাউন্সিল (এফআরসি) গৃহীত ইন্টারন্যাশনাল ফাইন্যান্সিয়াল রিপোর্টিং স্ট্যান্ডার্ড (আইএফআরএস), কোম্পানি আইন ১৯৯৪ এবং প্রযোজ্য বিএসইসি বিজ্ঞপ্তি অনুযায়ী প্রস্তুত।',
    basis_en:
      'Historical cost convention except for right-of-use assets and defined-benefit obligations measured under IFRS 16 and IAS 19. IFRS 18 categories and management performance measures are early-adopted.',
    basis_bn:
      'ঐতিহাসিক ব্যয় ভিত্তি, তবে আইএফআরএস ১৬ ও আইএএস ১৯ অনুযায়ী ব্যবহারের অধিকার সম্পদ ও নির্ধারিত সুবিধা দায় পরিমাপিত। আইএফআরএস ১৮ শ্রেণি ও ব্যবস্থাপনা পারফরম্যান্স পরিমাপ আগাম গ্রহণ করা হয়েছে।',
  },
  {
    key: 'IFRS_FOR_SMES_BFRS',
    short_en: 'IFRS for SMEs (BFRS)',
    short_bn: 'ক্ষুদ্র প্রতিষ্ঠানের জন্য আইএফআরএস (বিএফআরএস)',
    legal_en:
      'Prepared in accordance with the IFRS for SMEs Accounting Standard as adopted in Bangladesh (BFRS), the Companies Act 1994 and the income-tax provisions applicable to a private limited company.',
    legal_bn:
      'বাংলাদেশে গৃহীত ক্ষুদ্র ও মাঝারি প্রতিষ্ঠানের জন্য আইএফআরএস (বিএফআরএস), কোম্পানি আইন ১৯৯৪ এবং প্রাইভেট লিমিটেড কোম্পানির প্রযোজ্য আয়কর বিধান অনুযায়ী প্রস্তুত।',
    basis_en:
      'Simplified measurement: leases and financial instruments follow BFRS Section 20 and Section 11; no IFRS 18 category split and no management performance measure is presented.',
    basis_bn:
      'সরলীকৃত পরিমাপ: লিজ ও আর্থিক উপকরণ বিএফআরএস ধারা ২০ ও ১১ অনুসরণ করে; আইএফআরএস ১৮ শ্রেণি বিভাজন এবং ব্যবস্থাপনা পারফরম্যান্স পরিমাপ উপস্থাপন করা হয় না।',
  },
  {
    key: 'SIMPLIFIED_MANAGEMENT',
    short_en: 'Simplified Management Basis',
    short_bn: 'সরলীকৃত ব্যবস্থাপনা ভিত্তি',
    legal_en:
      'Management accounts prepared on a simplified basis for internal decision support. This is not a general-purpose financial reporting framework and must not be filed with RJSC, NBR or BSEC.',
    legal_bn:
      'অভ্যন্তরীণ সিদ্ধান্ত সহায়তার জন্য সরলীকৃত ভিত্তিতে প্রস্তুত ব্যবস্থাপনা হিসাব। এটি সাধারণ উদ্দেশ্যে আর্থিক প্রতিবেদনের কাঠামো নয় এবং আরজেএসসি, এনবিআর বা বিএসইসিতে দাখিলযোগ্য নয়।',
    basis_en:
      'Cash-adjusted management view: statutory accruals, deferred tax and IFRS 16 lease remeasurement are suppressed; figures reconcile to the statutory books only at the profit-for-period line.',
    basis_bn:
      'নগদ-সমন্বিত ব্যবস্থাপনা দৃষ্টিভঙ্গি: বিধিবদ্ধ সঞ্চিতি, বিলম্বিত কর ও আইএফআরএস ১৬ লিজ পুনঃপরিমাপ বাদ; সংখ্যাগুলো কেবল মেয়াদের মুনাফা পর্যন্ত বিধিবদ্ধ খতিয়ানের সাথে মেলে।',
  },
];

const BOOK_OPTIONS: Array<{ key: AppSettings['bookFilter']; en: string; bn: string; detail_en: string; detail_bn: string }> = [
  {
    key: 'STATUTORY_BD',
    en: 'Statutory BD Book Only',
    bn: 'শুধু বিধিবদ্ধ বাংলাদেশ বই',
    detail_en: 'Companies Act 1994 ledger only — no IFRS 16, IFRS 9 or IAS 19 group adjustments.',
    detail_bn: 'শুধু কোম্পানি আইন ১৯৯৪ খতিয়ান — আইএফআরএস ১৬, ৯ বা আইএএস ১৯ সমন্বয় ছাড়া।',
  },
  {
    key: 'ALL_IFRS_BOOKS',
    en: 'Consolidated IFRS Books (Statutory + IFRS 16 Leases + IFRS 9 ECL + IAS 19 Gratuity)',
    bn: 'সমন্বিত আইএফআরএস বই (বিধিবদ্ধ + আইএফআরএস ১৬ লিজ + আইএফআরএস ৯ ইসিএল + আইএএস ১৯ গ্র্যাচুইটি)',
    detail_en: 'Statutory + IFRS 16 leases + IFRS 9 ECL + IAS 19 gratuity adjustments.',
    detail_bn: 'বিধিবদ্ধ + আইএফআরএস ১৬ লিজ + আইএফআরএস ৯ ইসিএল + আইএএস ১৯ গ্র্যাচুইটি সমন্বয়।',
  },
  {
    key: 'TAX_COMPUTATION',
    en: 'Income Tax Computation Basis',
    bn: 'আয়কর গণনা ভিত্তি',
    detail_en: 'Income Tax Act 2023 computation books, including disallowed expenses and tax depreciation.',
    detail_bn: 'আয়কর আইন ২০২৩ গণনা বই, বাতিল ব্যয় ও কর অবচয়সহ।',
  },
];

function variancePct(current: bigint, comparative: bigint): number | null {
  if (comparative === 0n) return null;
  return Number(((current - comparative) * 10000n) / comparative) / 100;
}

function varianceTone(variance: number | null): string {
  if (variance === null) return 'text-ink-300';
  if (variance < 0) return 'text-rose-600';
  if (variance > 0) return 'text-vault-700';
  return 'text-ink-500';
}

function shortPeriodLabel(startIso: string, isBn: boolean): string {
  const date = new Date(`${startIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return startIso;
  return date.toLocaleDateString(isBn ? 'bn-BD' : 'en-GB', { month: 'short', year: 'numeric' });
}

function codesForLine(line: StatementLine): string[] {
  if (line.account_codes && line.account_codes.length > 0) return line.account_codes;
  if (/^\d{4}$/.test(line.id)) return [line.id];
  // Synthetic equity roll-forward lines inherit the retained-earnings account unless the engine
  // already gave them an explicit mapping.
  if (line.id.startsWith('3200')) return ['3200'];
  return [];
}

const NOTE_PILL = 'shrink-0 rounded-full border border-vault-100 bg-vault-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-vault-700';
const DOUBLE_TOTAL = 'border-b-4 border-double border-ink-900';

interface LineRowProps {
  line: StatementLine;
  isBn: boolean;
  books: string;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  onDrill: (target: DrillTarget) => void;
  tone?: 'normal' | 'subtotal' | 'total';
  showVariance?: boolean;
  /** Overrides the auto-derived drill codes (e.g. a synthetic equity or cash-flow aggregate). */
  codes?: string[];
}

function LineRow({ line, isBn, books, money, onDrill, tone = 'normal', showVariance = true, codes }: LineRowProps) {
  const variance = variancePct(line.amount_poisha, line.comparative_poisha);
  const drillCodes = codes ?? codesForLine(line);
  const clickable = drillCodes.length > 0;
  const label = isBn ? line.label_bn : line.label_en;
  const indent = line.indent ?? 0;
  const rowClass =
    tone === 'total'
      ? 'bg-ink-900 text-white'
      : tone === 'subtotal'
        ? 'bg-vault-50/70 font-semibold'
        : 'hover:bg-vault-50/40';
  const amountClass = tone === 'total' ? 'text-gold-200' : 'text-ink-900';
  const comparativeClass = tone === 'total' ? 'text-vault-200' : 'text-ink-500';

  return (
    <tr
      className={`${rowClass} ${clickable ? 'cursor-pointer' : ''} transition-colors`}
      onClick={() => {
        if (!clickable) return;
        onDrill({
          codes: drillCodes,
          label_en: line.label_en,
          label_bn: line.label_bn,
          note_en: line.note ? `Note ${line.note.replace(/^Note\s*/i, '')}` : 'Working',
          note_bn: line.note ? `নোট ${line.note.replace(/^Note\s*/i, '')}` : 'কার্যপত্র',
        });
      }}
      title={clickable ? (isBn ? 'খতিয়ান পর্যন্ত ড্রিল করুন' : 'Drill through to the general ledger') : undefined}
    >
      <td className="align-top">
        <div className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 13}px` }}>
          <span className={`text-[12px] ${tone === 'total' ? 'font-semibold text-white' : tone === 'subtotal' ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>
            {label}
          </span>
          {line.note && (
            <span className={tone === 'total' ? 'shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-gold-200' : NOTE_PILL}>
              {line.note}
            </span>
          )}
          {clickable && (
            <ArrowUpRight size={11} className={`mt-0.5 shrink-0 ${tone === 'total' ? 'text-gold-300' : 'text-vault-500'}`} />
          )}
        </div>
      </td>
      <td className={`font-money whitespace-nowrap text-right text-[12px] font-medium ${amountClass}`}>{money(line.amount_poisha)}</td>
      <td className={`font-money whitespace-nowrap text-right text-[12px] ${comparativeClass}`}>{money(line.comparative_poisha)}</td>
      {showVariance && (
        <td className={`font-money whitespace-nowrap text-right text-[10px] ${tone === 'total' ? 'text-gold-200' : varianceTone(variance)}`}>
          {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`}
        </td>
      )}
    </tr>
  );
}

interface SectionBlockProps {
  section: StatementSection;
  isBn: boolean;
  currentLabel: string;
  comparativeLabel: string;
  books: string;
  money: LineRowProps['money'];
  onDrill: LineRowProps['onDrill'];
  accent?: 'vault' | 'gold' | 'ink';
  totalLabel_en?: string;
  totalLabel_bn?: string;
}

function SectionBlock({
  section,
  isBn,
  currentLabel,
  comparativeLabel,
  books,
  money,
  onDrill,
  accent = 'vault',
  totalLabel_en = 'Total',
  totalLabel_bn = 'মোট',
}: SectionBlockProps) {
  const accentClass =
    accent === 'gold' ? 'text-gold-700' : accent === 'ink' ? 'text-ink-700' : 'text-vault-800';
  const variance = variancePct(section.total_poisha, section.comparative_total_poisha);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${accentClass}`}>
          {isBn ? section.title_bn : section.title_en}
        </p>
        <span className="font-money text-[11px] font-semibold text-ink-500">{money(section.total_poisha)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="lv-table w-full min-w-[520px]">
          <thead>
            <tr>
              <th>{isBn ? 'বিবরণ' : 'Description'}</th>
              <th className="w-32 text-right">{currentLabel}</th>
              <th className="w-32 text-right">{comparativeLabel}</th>
              <th className="w-16 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {section.lines.map((line) => (
              <LineRow key={line.id} line={line} isBn={isBn} books={books} money={money} onDrill={onDrill} />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50/60">
              <td className="text-[11px] font-semibold text-ink-900">{isBn ? totalLabel_bn : totalLabel_en}</td>
              <td className={`font-money border-b-4 border-double border-ink-900 text-right text-[12px] font-semibold text-ink-900`}>
                {money(section.total_poisha)}
              </td>
              <td className={`font-money border-b-4 border-double border-ink-300 text-right text-[11px] text-ink-500`}>
                {money(section.comparative_total_poisha)}
              </td>
              <td className={`font-money border-b-4 border-double border-ink-200 text-right text-[10px] ${varianceTone(variance)}`}>
                {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

interface TotalCardProps {
  label_en: string;
  label_bn: string;
  amount: bigint;
  comparative: bigint;
  currentLabel: string;
  comparativeLabel: string;
  isBn: boolean;
  money: LineRowProps['money'];
  tone?: 'vault' | 'ink' | 'gold';
  note?: string;
  onDrill?: () => void;
}

function TotalCard({
  label_en,
  label_bn,
  amount,
  comparative,
  currentLabel,
  comparativeLabel,
  isBn,
  money,
  tone = 'vault',
  note,
  onDrill,
}: TotalCardProps) {
  const variance = variancePct(amount, comparative);
  const palette =
    tone === 'ink'
      ? 'border-ink-900 bg-ink-900 text-white'
      : tone === 'gold'
        ? 'border-gold-300 bg-gold-50 text-ink-900'
        : 'border-vault-300 bg-vault-50 text-vault-950';
  const labelTone = tone === 'ink' ? 'text-gold-300' : tone === 'gold' ? 'text-gold-800' : 'text-vault-800';
  const valueTone = tone === 'ink' ? 'text-gold-200' : 'text-ink-900';
  return (
    <div
      className={`rounded-xl border ${palette} px-4 py-3 ${onDrill ? 'cursor-pointer transition hover:brightness-[0.98]' : ''}`}
      onClick={onDrill}
      role={onDrill ? 'button' : undefined}
      title={onDrill ? (isBn ? 'খতিয়ান পর্যন্ত ড্রিল করুন' : 'Drill through to the general ledger') : undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelTone}`}>
          {isBn ? label_bn : label_en}
          {note && <span className="ml-1.5 font-mono text-[9px] opacity-70">{note}</span>}
        </p>
        {onDrill && <ArrowUpRight size={12} className={tone === 'ink' ? 'text-gold-300' : 'text-vault-600'} />}
      </div>
      <p className={`font-money mt-1 border-b-4 border-double pb-0.5 text-lg font-semibold ${valueTone} ${tone === 'ink' ? 'border-gold-400' : 'border-ink-900'}`}>
        {money(amount)}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`font-money text-[10px] ${tone === 'ink' ? 'text-vault-200' : 'text-ink-500'}`}>
          {comparativeLabel} {money(comparative)}
        </p>
        <span className={`font-money text-[10px] ${tone === 'ink' ? 'text-gold-200' : varianceTone(variance)}`}>
          {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
}

interface DrillDrawerProps {
  target: DrillTarget | null;
  entries: Array<{ journal: JournalEntry; line: JournalLine }>;
  isBn: boolean;
  locale: 'en-BD' | 'bn-BD';
  money: LineRowProps['money'];
  onClose: () => void;
  onOpenLens: (journal: JournalEntry) => void;
}

function DrillDrawer({ target, entries, isBn, locale, money, onClose, onOpenLens }: DrillDrawerProps) {
  const debit = entries.reduce((sum, entry) => sum + entry.line.debit_poisha, 0n);
  const credit = entries.reduce((sum, entry) => sum + entry.line.credit_poisha, 0n);
  const net = debit - credit;
  const journals = useMemo(() => {
    const map = new Map<string, { journal: JournalEntry; lines: JournalLine[] }>();
    for (const entry of entries) {
      const existing = map.get(entry.journal.id);
      if (existing) existing.lines.push(entry.line);
      else map.set(entry.journal.id, { journal: entry.journal, lines: [entry.line] });
    }
    return Array.from(map.values());
  }, [entries]);

  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div
            key="drill-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-ink-950/40 backdrop-blur-[1px]"
            onClick={onClose}
          />
          <motion.aside
            key="drill-drawer"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[38rem] flex-col border-l border-ink-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={isBn ? 'খতিয়ান ড্রিল-ডাউন' : 'General ledger account drill-down'}
          >
            <header className="flex items-start justify-between gap-3 border-b border-ink-100 bg-gradient-to-br from-vault-950 to-vault-800 px-5 py-4 text-white">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-300">
                  <Table2 size={11} /> {isBn ? 'খতিয়ান ড্রিল-ডাউন' : 'General ledger drill-down'}
                </p>
                <h3 className="mt-1 text-sm font-semibold">{isBn ? target.label_bn : target.label_en}</h3>
                <p className="mt-1 font-mono text-[10px] text-vault-200">
                  {isBn ? target.note_bn : target.note_en} · A/C {target.codes.join(' · ')}
                </p>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg p-1 text-vault-200 transition hover:bg-white/10 hover:text-white" aria-label={isBn ? 'বন্ধ' : 'Close'}>
                <X size={16} />
              </button>
            </header>

            <div className="grid grid-cols-3 gap-2 border-b border-ink-100 bg-ink-50/60 px-5 py-3">
              <div>
                <p className="lv-kicker">{isBn ? 'ডেবিট' : 'Debits'}</p>
                <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{money(debit)}</p>
              </div>
              <div>
                <p className="lv-kicker">{isBn ? 'ক্রেডিট' : 'Credits'}</p>
                <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{money(credit)}</p>
              </div>
              <div>
                <p className="lv-kicker">{isBn ? 'নিট' : 'Net'}</p>
                <p className={`font-money mt-0.5 border-b-2 border-double border-ink-400 pb-0.5 text-[12px] font-semibold ${net < 0n ? 'text-rose-600' : 'text-vault-800'}`}>
                  {money(net, { sign: true })}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-2">
              <p className="text-[10px] text-ink-500">
                {journals.length} {isBn ? 'জার্নাল' : 'journals'} · {entries.length} {isBn ? 'লাইন' : 'lines'}
              </p>
              <p className="text-[10px] text-ink-400">{isBn ? 'প্রতিটি লাইনে লেজার লেন্স' : 'Ledger Lens on every journal'}</p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {journals.length === 0 ? (
                <p className="py-10 text-center text-sm text-ink-500">
                  {isBn ? 'এই ব্যালেন্সের পেছনে কোনো পোস্টেড জার্নাল নেই।' : 'No posted journal sits behind this balance yet.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {journals.map(({ journal, lines }) => (
                    <li key={journal.id} className="rounded-xl border border-ink-100 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] font-semibold text-ink-900">{journal.journal_number}</p>
                          <p className="mt-0.5 text-[10px] text-ink-500">
                            {formatDate(journal.posting_date, locale)} · {journal.book_type.replace(/_/g, ' ')} · {journal.status}
                          </p>
                        </div>
                        <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onOpenLens(journal)}>
                          <ShieldCheck size={11} /> Ledger Lens
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-700">{isBn ? journal.narration_bn : journal.narration_en}</p>
                      <table className="mt-2 w-full">
                        <tbody>
                          {lines.map((line) => (
                            <tr key={line.id} className="border-t border-ink-50">
                              <td className="py-1 pr-2 font-mono text-[10px] text-vault-700">{line.account_code}</td>
                              <td className="py-1 pr-2 text-[10px] text-ink-600">{isBn ? line.account_name_bn : line.account_name_en}</td>
                              <td className="font-money whitespace-nowrap py-1 text-right text-[10px] text-ink-800">
                                {line.debit_poisha > 0n ? money(line.debit_poisha) : '—'}
                              </td>
                              <td className="font-money whitespace-nowrap py-1 text-right text-[10px] text-ink-500">
                                {line.credit_poisha > 0n ? money(line.credit_poisha) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="border-t border-ink-100 bg-ink-50/70 px-5 py-2.5 text-[10px] leading-relaxed text-ink-500">
              {isBn
                ? 'প্রতিটি লাইন অপরিবর্তনীয় খতিয়ান থেকে সরাসরি — কোনো সমন্বয় বা প্লাগ নেই।'
                : 'Every line is read straight from the immutable ledger — no adjustments, no plugs.'}
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function W08_IfrsStatementsStudio() {
  const vault = useVault();
  const { statements, locale, money, publishToast, accounts, journals } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bnText: string): string => (isBn ? bnText : en);

  const [tab, setTab] = useState<StatementTab>('SOFP');
  const [plBasis, setPlBasis] = useState<PlBasis>('IFRS18');
  const [cashBasis, setCashBasis] = useState<CashBasis>('INDIRECT');
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [lensJournalId, setLensJournalId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const framework = FRAMEWORKS.find((entry) => entry.key === statements.framework) ?? FRAMEWORKS[0];
  const bookOption = BOOK_OPTIONS.find((entry) => entry.key === vault.bookFilter) ?? BOOK_OPTIONS[1];
  const currentLabel = shortPeriodLabel(statements.period.start, isBn);
  const comparativeLabel = shortPeriodLabel(statements.comparative.start, isBn);
  const books = useMemo(() => booksForFilter(vault.bookFilter), [vault.bookFilter]);
  const bookScope = books.map((book) => book.replace(/_/g, ' ')).join(' + ');
  const accountMap = useMemo(() => new Map(accounts.map((account) => [account.code, account])), [accounts]);
  const equityReserveCodes = useMemo(
    () => accounts.filter((account) => account.account_type === 'EQUITY').map((account) => account.code),
    [accounts],
  );

  const bs = statements.balance_sheet;
  const pl = statements.profit_or_loss;
  const cf = statements.cash_flow;
  const kpis = statements.kpis;
  const balanced = bs.balanced && bs.imbalance_poisha === 0n;

  const drillEntries = useMemo(() => {
    if (!drill) return [];
    const codes = new Set(drill.codes);
    const rows: Array<{ journal: JournalEntry; line: JournalLine }> = [];
    for (const journal of journals) {
      if (!books.includes(journal.book_type)) continue;
      if (journal.posting_date > statements.period.end) continue;
      for (const line of journal.lines) {
        if (!codes.has(line.account_code)) continue;
        rows.push({ journal, line });
      }
    }
    return rows.sort(
      (left, right) =>
        right.journal.posting_date.localeCompare(left.journal.posting_date) ||
        left.journal.journal_number.localeCompare(right.journal.journal_number) ||
        left.line.line_no - right.line.line_no,
    );
  }, [drill, journals, books, statements.period.end]);

  const lensJournal = useMemo(
    () => (lensJournalId ? journals.find((journal) => journal.id === lensJournalId) ?? null : null),
    [lensJournalId, journals],
  );

  // ---- Classic IAS 1 profit or loss, derived from the same section lines -----------------------
  const classicPl = useMemo(() => {
    const subCategoryOf = (line: StatementLine): string | undefined =>
      accountMap.get(line.account_codes?.[0] ?? line.id)?.sub_category;
    const revenue = pl.operating.lines.filter((line) => subCategoryOf(line) === 'OPERATING_REVENUE');
    const cogs = pl.operating.lines.filter((line) => subCategoryOf(line) === 'COST_OF_SALES');
    const opex = pl.operating.lines.filter((line) => subCategoryOf(line) === 'OPERATING_EXPENSE');
    const sum = (lines: StatementLine[], pick: (line: StatementLine) => bigint): bigint =>
      lines.reduce((total, line) => total + pick(line), 0n);
    const revenueTotal = sum(revenue, (line) => line.amount_poisha);
    const revenueComp = sum(revenue, (line) => line.comparative_poisha);
    const cogsTotal = -sum(cogs, (line) => line.amount_poisha);
    const cogsComp = -sum(cogs, (line) => line.comparative_poisha);
    const opexTotal = -sum(opex, (line) => line.amount_poisha);
    const opexComp = -sum(opex, (line) => line.comparative_poisha);
    const financeIncome = pl.investing.total_poisha;
    const financeIncomeComp = pl.investing.comparative_total_poisha;
    const financeCost = -pl.financing.total_poisha;
    const financeCostComp = -pl.financing.comparative_total_poisha;
    const tax = -pl.income_tax.total_poisha;
    const taxComp = -pl.income_tax.comparative_total_poisha;
    const codesOf = (lines: StatementLine[]): string[] =>
      Array.from(new Set(lines.flatMap((line) => (line.account_codes ?? [line.id]).filter((code) => /^\d{4}$/.test(code)))));
    return {
      revenue: { amount: revenueTotal, comparative: revenueComp, gross: pl.gross_profit_poisha, grossComparative: pl.gross_profit_comparative_poisha, codes: codesOf(revenue) },
      cogs: { amount: cogsTotal, comparative: cogsComp, codes: codesOf(cogs) },
      opex: { amount: opexTotal, comparative: opexComp, codes: codesOf(opex) },
      financeIncome: { amount: financeIncome, comparative: financeIncomeComp, codes: codesOf(pl.investing.lines) },
      financeCost: { amount: financeCost, comparative: financeCostComp, codes: codesOf(pl.financing.lines) },
      tax: { amount: tax, comparative: taxComp, codes: codesOf(pl.income_tax.lines) },
      operatingProfit: { amount: pl.operating_profit_poisha, comparative: pl.operating_profit_comparative_poisha, codes: codesOf(pl.operating.lines) },
      pbt: { amount: pl.profit_before_tax_poisha, comparative: pl.profit_before_tax_comparative_poisha, codes: codesOf([...pl.operating.lines, ...pl.investing.lines, ...pl.financing.lines]) },
      profit: { amount: pl.profit_for_period_poisha, comparative: pl.profit_for_period_comparative_poisha, codes: codesOf([...pl.operating.lines, ...pl.investing.lines, ...pl.financing.lines, ...pl.income_tax.lines]) },
    };
  }, [pl, accountMap]);

  // ---- IAS 7 direct-method presentation derived from cash-side journal legs --------------------
  const directCash = useMemo(() => {
    const cashCodes = new Set(
      accounts
        .filter((account) => account.cash_flow_tag === 'CASH' || account.control_subledger === 'BANK_MFS')
        .map((account) => account.code),
    );
    type Bucket = { key: string; label_en: string; label_bn: string; section: 'OPERATING' | 'INVESTING' | 'FINANCING'; amount: bigint; codes: string[] };
    const buckets = new Map<string, Bucket>();
    const add = (key: string, labelEn: string, labelBn: string, section: Bucket['section'], amount: bigint, code: string): void => {
      if (amount === 0n) return;
      const existing = buckets.get(key);
      if (existing) {
        existing.amount += amount;
        if (!existing.codes.includes(code)) existing.codes.push(code);
      } else {
        buckets.set(key, { key, label_en: labelEn, label_bn: labelBn, section, amount, codes: [code] });
      }
    };

    for (const journal of journals) {
      if (!books.includes(journal.book_type)) continue;
      if (journal.posting_date < statements.period.start || journal.posting_date > statements.period.end) continue;
      const cashLegs = journal.lines.filter((line) => cashCodes.has(line.account_code));
      if (cashLegs.length === 0) continue;
      const cashFlow = cashLegs.reduce((sum, line) => sum + line.debit_poisha - line.credit_poisha, 0n);
      if (cashFlow === 0n) continue;
      const contra = journal.lines.filter((line) => !cashCodes.has(line.account_code));
      const primary = contra.reduce<JournalLine | null>(
        (largest, line) => (!largest || line.debit_poisha + line.credit_poisha > largest.debit_poisha + largest.credit_poisha ? line : largest),
        null,
      );
      const code = primary?.account_code ?? '4100';
      const account = accountMap.get(code);
      const inflow = cashFlow > 0n;
      let section: Bucket['section'] = 'OPERATING';
      if (account?.sub_category === 'FINANCE_COST' || ['2210', '2510', '3100', '3200', '5800', '5810', '5820'].includes(code)) section = 'FINANCING';
      else if (account?.sub_category === 'INVESTING_INCOME' || ['1410', '1610', '1619', '1710', '1719', '1810', '4500'].includes(code)) section = 'INVESTING';
      const nameEn = account?.name_en ?? code;
      const nameBn = account?.name_bn ?? code;
      const key = `${section}:${code}:${inflow ? 'IN' : 'OUT'}`;
      const labelEn = `${inflow ? 'Receipts from' : 'Payments for'} ${nameEn.toLowerCase()}`;
      const labelBn = `${nameBn} ${inflow ? 'থেকে প্রাপ্তি' : 'জন্য পরিশোধ'}`;
      add(key, labelEn, labelBn, section, cashFlow, code);
    }

    const rows = Array.from(buckets.values());
    const sectionTotal = (section: Bucket['section']): bigint =>
      rows.filter((row) => row.section === section).reduce((sum, row) => sum + row.amount, 0n);
    const operating = sectionTotal('OPERATING');
    const investing = sectionTotal('INVESTING');
    const financing = sectionTotal('FINANCING');
    const net = operating + investing + financing;
    const ledgerNet = cf.closing_cash_poisha - cf.opening_cash_poisha;
    return {
      rows,
      operating,
      investing,
      financing,
      net,
      ledgerNet,
      difference: net - ledgerNet,
    };
  }, [journals, books, accounts, accountMap, statements.period.start, statements.period.end, cf.closing_cash_poisha, cf.opening_cash_poisha]);

  // ---- Comparative trial-balance closing balances (proves the comparative column) --------------
  const comparativeClosing = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const journal of journals) {
      if (!books.includes(journal.book_type)) continue;
      if (journal.posting_date > statements.comparative.end) continue;
      for (const line of journal.lines) {
        map.set(line.account_code, (map.get(line.account_code) ?? 0n) + line.debit_poisha - line.credit_poisha);
      }
    }
    return map;
  }, [journals, books, statements.comparative.end]);

  const tbDebit = statements.trial_balance.reduce((total, row) => total + row.closing_debit_poisha, 0n);
  const tbCredit = statements.trial_balance.reduce((total, row) => total + row.closing_credit_poisha, 0n);

  const exportWorkbook = (): void => {
    exportFullAuditPackXlsx({
      tenant: vault.tenant,
      statements,
      journals,
      commercialDocs: vault.commercialDocs,
      challans: vault.challans,
      accounts,
      subledger: vault.reconciliation,
      auditChain: vault.auditChain,
    });
    publishToast({
      tone: 'success',
      title: L('9-tab Excel audit workbook exported', '৯-ট্যাব এক্সেল অডিট ওয়ার্কবুক রপ্তানি'),
      message: L(
        'Summary · Trial balance · IAS 1 balance sheet · IFRS 18 P&L · IAS 7 cash flows · Mushak 6.1 · Mushak 6.2 · VDS/TDS schedule · Immutable GL',
        'সারসংক্ষেপ · রেওয়ামিল · আইএএস ১ ব্যালেন্স শিট · আইএফআরএস ১৮ পিএল · আইএএস ৭ নগদ প্রবাহ · মূসক ৬.১ · মূসক ৬.২ · ভিডিএস/টিডিএস সূচি · অপরিবর্তনীয় খতিয়ান',
      ),
    });
  };

  const headline = [
    { label: L('Revenue', 'আয়'), value: kpis.revenue_poisha, icon: TrendingUp },
    { label: L('Gross profit', 'মোট মুনাফা'), value: pl.gross_profit_poisha, icon: Scale },
    { label: L('Operating profit', 'পরিচালন মুনাফা'), value: pl.operating_profit_poisha, icon: Calculator },
    { label: L('Profit for the period', 'মেয়াদের মুনাফা'), value: pl.profit_for_period_poisha, icon: FileChartColumn },
    { label: L('Adjusted EBITDA (MPM)', 'সমন্বিত ইবিআইটিডিএ'), value: pl.mpm.adjusted_ebitda_poisha, icon: TrendingUp },
    { label: L('Total assets', 'মোট সম্পদ'), value: bs.total_assets_poisha, icon: Landmark },
  ];

  const noteBody = (en: string, bnText: string): string => (isBn ? bnText : en);
  const policyNotes =
    statements.framework === 'IFRS_FRC_ADOPTED'
      ? [
          { en: 'IFRS 16 leases: right-of-use assets and lease liabilities recognised; the short-term lease exemption is not applied.', bn: 'আইএফআরএস ১৬ লিজ: ব্যবহারের অধিকার সম্পদ ও লিজ দায় স্বীকৃত; স্বল্পমেয়াদি লিজ ছাড় প্রয়োগ করা হয়নি।' },
          { en: 'IFRS 9 ECL: loss allowance measured through a simplified matrix over open receivables.', bn: 'আইএফআরএস ৯ ইসিএল: খোলা প্রাপ্যের ওপর সরলীকৃত ম্যাট্রিক্সে ক্ষতি ভাতা পরিমাপ।' },
          { en: 'IAS 19: gratuity obligation measured by projected unit credit with a 9.5% discount rate.', bn: 'আইএএস ১৯: ৯.৫% ছাড় হারসহ প্রজেক্টেড ইউনিট ক্রেডিট পদ্ধতিতে গ্র্যাচুইটি দায়।' },
          { en: 'IFRS 18: operating / investing / financing categories and adjusted EBITDA presented as a management performance measure.', bn: 'আইএফআরএস ১৮: পরিচালন / বিনিয়োগ / অর্থায়ন শ্রেণি এবং সমন্বিত ইবিআইটিডিএ ব্যবস্থাপনা পারফরম্যান্স পরিমাপ হিসেবে উপস্থাপিত।' },
        ]
      : statements.framework === 'IFRS_FOR_SMES_BFRS'
        ? [
            { en: 'BFRS Section 20: operating leases are expensed on a straight-line basis; no right-of-use asset is recognised.', bn: 'বিএফআরএস ধারা ২০: পরিচালন লিজ সরলরৈখিক ভিত্তিতে ব্যয়; ব্যবহারের অধিকার সম্পদ স্বীকৃত নয়।' },
            { en: 'BFRS Section 11: receivables are measured at transaction price less a specific, not matrix, impairment allowance.', bn: 'বিএফআরএস ধারা ১১: প্রাপ্য লেনদেন মূল্যে, নির্দিষ্ট (ম্যাট্রিক্স নয়) ক্ষতি ভাতা বাদ দিয়ে পরিমাপ।' },
            { en: 'Gratuity is disclosed as a defined contribution arrangement; no projected unit credit remeasurement is performed.', bn: 'গ্র্যাচুইটি নির্ধারিত চাঁদা ব্যবস্থা হিসেবে প্রকাশিত; প্রজেক্টেড ইউনিট ক্রেডিট পুনঃপরিমাপ করা হয় না।' },
            { en: 'No IFRS 18 category split or management performance measure is presented.', bn: 'আইএফআরএস ১৮ শ্রেণি বিভাজন বা ব্যবস্থাপনা পারফরম্যান্স পরিমাপ উপস্থাপন করা হয় না।' },
          ]
        : [
            { en: 'Management view: statutory accruals and deferred tax are suppressed; cash taxes are used in place of the tax expense.', bn: 'ব্যবস্থাপনা দৃষ্টিভঙ্গি: বিধিবদ্ধ সঞ্চিতি ও বিলম্বিত কর বাদ; কর ব্যয়ের বদলে নগদ কর ব্যবহৃত।' },
            { en: 'Leases are expensed as rent; no IFRS 16 remeasurement is presented.', bn: 'লিজ ভাড়া হিসেবে ব্যয়; আইএফআরএস ১৬ পুনঃপরিমাপ উপস্থাপন করা হয় না।' },
            { en: 'ECL is replaced by a management-specific bad-debt provision approved by the board.', bn: 'ইসিএল-এর বদলে বোর্ড অনুমোদিত ব্যবস্থাপনা-নির্দিষ্ট কুঋণ সঞ্চিতি।' },
            { en: 'This basis is for internal decision support only and is not a general-purpose framework.', bn: 'এই ভিত্তি কেবল অভ্যন্তরীণ সিদ্ধান্ত সহায়তার জন্য, সাধারণ উদ্দেশ্যের কাঠামো নয়।' },
          ];

  return (
    <div className="space-y-5">
      {/* ---------------- Top control ribbon ---------------- */}
      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><BookOpen size={12} /> {L('Executive statement workbench', 'নির্বাহী বিবরণী ওয়ার্কবেঞ্চ')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Audited financial statements', 'নিরীক্ষিত আর্থিক বিবরণী')} · {isBn ? statements.period.label_bn : statements.period.label_en}
            </h2>
            <p className="lv-hint mt-1">
              {L('Comparative', 'তুলনামূলক')}: {isBn ? statements.comparative.label_bn : statements.comparative.label_en} ·{' '}
              {bookScope} · {journals.length} {L('journals in scope', 'পরিসরের জার্নাল')}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="lv-btn lv-btn-secondary" onClick={() => setPrintOpen(true)}>
              <Printer size={14} /> {L('Print A4 Audited Financial Statements Pack', 'এ৪ নিরীক্ষিত আর্থিক বিবরণী প্যাক প্রিন্ট')}
            </button>
            <button type="button" className="lv-btn lv-btn-primary" onClick={exportWorkbook}>
              <FileSpreadsheet size={14} /> {L('Export 9-Tab Excel Audit Workbook (.xlsx)', '৯-ট্যাব এক্সেল অডিট ওয়ার্কবুক রপ্তানি (.xlsx)')}
            </button>
          </div>
        </div>

        {/* Framework selector */}
        <div className="border-t border-ink-100 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="lv-kicker flex items-center gap-1.5"><BadgeCheck size={11} /> {L('FRC reporting framework', 'এফআরসি প্রতিবেদন কাঠামো')}</p>
            <span className="text-[10px] text-ink-400">{L('Updates the formal compliance header and note disclosures', 'আনুষ্ঠানিক সম্মতি শিরোনাম ও নোট প্রকাশ পরিবর্তন করে')}</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {FRAMEWORKS.map((entry) => {
              const active = entry.key === statements.framework;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => vault.setReportingFramework(entry.key)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    active ? 'border-vault-700 bg-vault-900 text-white shadow-lift' : 'border-ink-200 bg-white hover:border-vault-300'
                  }`}
                >
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-gold-300' : 'text-ink-400'}`}>
                    {entry.key.replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold">{L(entry.short_en, entry.short_bn)}</p>
                  {active && <p className="mt-1 text-[10px] text-vault-200">{L('Currently presented', 'বর্তমানে উপস্থাপিত')}</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-book switcher */}
        <div className="border-t border-ink-100 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="lv-kicker flex items-center gap-1.5"><Layers size={11} /> {L('Multi-book switcher', 'মাল্টি-বুক সুইচার')}</p>
            <span className="text-[10px] text-ink-400">
              {L('Statutory + IFRS adjustments + tax computation in one ledger', 'বিধিবদ্ধ + আইএফআরএস সমন্বয় + কর গণনা একই খতিয়ানে')}
            </span>
          </div>
          <div className="lv-seg mt-2 flex-wrap">
            {BOOK_OPTIONS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                data-active={vault.bookFilter === entry.key}
                className="lv-seg-item"
                onClick={() => vault.setBookFilter(entry.key)}
                title={L(entry.detail_en, entry.detail_bn)}
              >
                {L(entry.en, entry.bn)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">{L(bookOption.detail_en, bookOption.detail_bn)}</p>
        </div>

        {/* Presentation basis + proof */}
        <div className="grid gap-4 border-t border-ink-100 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Scale size={11} /> {L('P&L presentation basis', 'পিএল উপস্থাপন ভিত্তি')}</p>
            <div className="lv-seg mt-2">
              <button type="button" data-active={plBasis === 'IFRS18'} className="lv-seg-item" onClick={() => setPlBasis('IFRS18')}>
                {L('IFRS 18 categories + MPM', 'আইএফআরএস ১৮ শ্রেণি + এমপিএম')}
              </button>
              <button type="button" data-active={plBasis === 'IAS1'} className="lv-seg-item" onClick={() => setPlBasis('IAS1')}>
                {L('Classic IAS 1', 'চিরাচরিত আইএএস ১')}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              {plBasis === 'IFRS18'
                ? L('Operating, investing and financing categories with adjusted EBITDA as a management performance measure.', 'পরিচালন, বিনিয়োগ ও অর্থায়ন শ্রেণি এবং সমন্বিত ইবিআইটিডিএ ব্যবস্থাপনা পারফরম্যান্স পরিমাপ হিসেবে।')
                : L('Revenue − cost of sales − operating expenses, with finance income and cost below operating profit.', 'আয় − বিক্রীত পণ্যের ব্যয় − পরিচালন ব্যয়, পরিচালন মুনাফার নিচে আর্থিক আয় ও ব্যয়।')}
            </p>
          </div>

          <div className={`rounded-2xl border-2 px-4 py-3 ${balanced ? 'border-vault-500 bg-vault-50' : 'border-rose-400 bg-rose-50'}`}>
            <div className="flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-full ${balanced ? 'bg-vault-700 text-white' : 'bg-rose-600 text-white'}`}>
                {balanced ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              </span>
              <div className="min-w-0">
                <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${balanced ? 'text-vault-900' : 'text-rose-900'}`}>
                  {L('Live balance proof', 'লাইভ ব্যালেন্স প্রমাণ')}
                </p>
                <p className={`text-[12px] font-semibold ${balanced ? 'text-vault-800' : 'text-rose-800'}`}>
                  TOTAL ASSETS === TOTAL EQUITY &amp; LIABILITIES
                </p>
              </div>
              <span className={`ml-auto rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ${balanced ? 'bg-vault-700 text-white' : 'bg-rose-600 text-white'}`}>
                {L('Variance', 'পার্থক্য')}: {money(bs.imbalance_poisha)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="lv-kicker">{L('Total assets', 'মোট সম্পদ')}</p>
                <p className="font-money mt-0.5 border-b-4 border-double border-ink-900 pb-0.5 text-[13px] font-semibold text-ink-900">
                  {money(bs.total_assets_poisha)}
                </p>
              </div>
              <div>
                <p className="lv-kicker">{L('Total equity & liabilities', 'মোট ইকুইটি ও দায়')}</p>
                <p className="font-money mt-0.5 border-b-4 border-double border-ink-900 pb-0.5 text-[13px] font-semibold text-ink-900">
                  {money(bs.total_equity_and_liabilities_poisha)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Formal compliance header */}
        <div className="border-t border-ink-100 bg-ink-50/50 px-5 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="lv-kicker">{L('Formal compliance header', 'আনুষ্ঠানিক সম্মতি শিরোনাম')}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-700">{L(framework.legal_en, framework.legal_bn)}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-500">{L(framework.basis_en, framework.basis_bn)}</p>
            </div>
            <div className="shrink-0 text-right">
              <CryptographicSealSvg size={64} variant="audit" verified={vault.auditChain.valid} />
              <p className="mt-1 font-mono text-[8px] text-ink-400">{L('Audit chain', 'অডিট চেইন')} {vault.auditChain.valid ? 'VALID' : 'BROKEN'}</p>
            </div>
          </div>
        </div>

        {/* Headline KPI strip */}
        <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-6">
          {headline.map((card) => (
            <div key={card.label} className="rounded-xl bg-ink-50/70 px-3 py-2.5">
              <p className="lv-kicker flex items-center gap-1"><card.icon size={11} /> {card.label}</p>
              <p className={`font-money mt-1 text-[13px] font-semibold ${card.value < 0n ? 'text-rose-600' : 'text-ink-900'}`}>
                {money(card.value)}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="lv-seg mx-5 mb-4 flex-wrap">
          {TABS.map((entry) => (
            <button key={entry.key} type="button" data-active={tab === entry.key} onClick={() => setTab(entry.key)} className="lv-seg-item">
              <entry.icon size={11} className="mr-1 inline" />
              {L(entry.en, entry.bn)}
            </button>
          ))}
        </div>
      </section>

      {/* ---------------- Statement of financial position ---------------- */}
      {tab === 'SOFP' && (
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker">{L('IAS 1.54 · statement of financial position', 'আইএএস ১.৫৪ · আর্থিক অবস্থানের বিবরণী')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Assets, equity and liabilities', 'সম্পদ, ইকুইটি ও দায়')}</h2>
              <p className="lv-hint mt-1">
                {currentLabel} {L('vs', 'বনাম')} {comparativeLabel} · {L('click any line to drill into its journals', 'যেকোনো লাইনে ক্লিক করে জার্নাল দেখুন')}
              </p>
            </div>
            <span className={`lv-chip ${balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              {balanced ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}
              {balanced ? L('Proof holds', 'প্রমাণ বহাল') : L('Out of balance', 'অসাম্য')}
            </span>
          </div>
          <div className="grid gap-6 px-5 py-5 xl:grid-cols-2">
            <div className="space-y-5">
              <SectionBlock
                section={bs.assets_non_current}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Total non-current assets"
                totalLabel_bn="মোট অচলতি সম্পদ"
              />
              <SectionBlock
                section={bs.assets_current}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                totalLabel_en="Total current assets"
                totalLabel_bn="মোট চলতি সম্পদ"
              />
              <TotalCard
                label_en="TOTAL ASSETS"
                label_bn="মোট সম্পদ"
                amount={bs.total_assets_poisha}
                comparative={bs.total_assets_comparative_poisha}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                isBn={isBn}
                money={money}
                note="A = L + E"
              />
            </div>
            <div className="space-y-5">
              <SectionBlock
                section={bs.equity}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="gold"
                totalLabel_en="Total equity"
                totalLabel_bn="মোট ইকুইটি"
              />
              <SectionBlock
                section={bs.liabilities_non_current}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Total non-current liabilities"
                totalLabel_bn="মোট অচলতি দায়"
              />
              <SectionBlock
                section={bs.liabilities_current}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Total current liabilities"
                totalLabel_bn="মোট চলতি দায়"
              />
              <TotalCard
                label_en="TOTAL EQUITY & LIABILITIES"
                label_bn="মোট ইকুইটি ও দায়"
                amount={bs.total_equity_and_liabilities_poisha}
                comparative={bs.total_equity_and_liabilities_comparative_poisha}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                isBn={isBn}
                money={money}
                tone="ink"
                note="= NCA + CA"
              />
            </div>
          </div>
        </section>
      )}

      {/* ---------------- Profit or loss ---------------- */}
      {tab === 'PL' && (
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker">{plBasis === 'IFRS18' ? L('IFRS 18 · categories and MPM', 'আইএফআরএস ১৮ · শ্রেণি ও এমপিএম') : L('IAS 1 · classic presentation', 'আইএএস ১ · চিরাচরিত উপস্থাপন')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Statement of Profit or Loss', 'মুনাফা বা ক্ষতির বিবরণী')}</h2>
              <p className="lv-hint mt-1">
                {L('Gross profit', 'মোট মুনাফা')}: {money(pl.gross_profit_poisha)} · {L('Profit for the period', 'মেয়াদের মুনাফা')}: {' '}
                <span className="font-semibold text-ink-800">{money(pl.profit_for_period_poisha)}</span>
              </p>
            </div>
            <div className="lv-seg">
              <button type="button" data-active={plBasis === 'IFRS18'} className="lv-seg-item" onClick={() => setPlBasis('IFRS18')}>
                {L('IFRS 18', 'আইএফআরএস ১৮')}
              </button>
              <button type="button" data-active={plBasis === 'IAS1'} className="lv-seg-item" onClick={() => setPlBasis('IAS1')}>
                {L('Classic IAS 1', 'আইএএস ১')}
              </button>
            </div>
          </div>

          {plBasis === 'IFRS18' ? (
            <div className="space-y-5 px-5 py-5">
              <SectionBlock
                section={pl.operating}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                totalLabel_en="Operating profit"
                totalLabel_bn="পরিচালন মুনাফা"
              />
              <TotalCard
                label_en="OPERATING PROFIT"
                label_bn="পরিচালন মুনাফা"
                amount={pl.operating_profit_poisha}
                comparative={pl.operating_profit_comparative_poisha}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                isBn={isBn}
                money={money}
                note="IFRS 18.18"
              />
              <SectionBlock
                section={pl.investing}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="vault"
                totalLabel_en="Profit before financing and tax"
                totalLabel_bn="অর্থায়ন ও করপূর্ব মুনাফা"
              />
              <TotalCard
                label_en="PROFIT BEFORE FINANCING & TAX"
                label_bn="অর্থায়ন ও করপূর্ব মুনাফা"
                amount={pl.profit_before_financing_tax_poisha}
                comparative={pl.profit_before_financing_tax_comparative_poisha}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                isBn={isBn}
                money={money}
                tone="gold"
              />
              <SectionBlock
                section={pl.financing}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Finance costs"
                totalLabel_bn="আর্থিক ব্যয়"
              />
              <SectionBlock
                section={pl.income_tax}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Income tax expense"
                totalLabel_bn="আয়কর ব্যয়"
              />
              <TotalCard
                label_en="PROFIT FOR THE PERIOD"
                label_bn="মেয়াদের মুনাফা"
                amount={pl.profit_for_period_poisha}
                comparative={pl.profit_for_period_comparative_poisha}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                isBn={isBn}
                money={money}
                tone="ink"
                note="IAS 1.81A"
              />

              <div className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-800">
                  {L('IFRS 18 management performance measure bridge', 'আইএফআরএস ১৮ ব্যবস্থাপনা পারফরম্যান্স সেতু')}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: L('Operating profit', 'পরিচালন মুনাফা'), value: pl.mpm.operating_profit_poisha },
                    { label: L('+ Depreciation', '＋ অবচয়'), value: pl.mpm.depreciation_poisha },
                    { label: L('+ ECL charge', '＋ ইসিএল'), value: pl.mpm.ecl_poisha },
                    { label: L('Adjusted EBITDA', 'সমন্বিত ইবিআইটিডিএ'), value: pl.mpm.adjusted_ebitda_poisha },
                  ].map((step, index) => (
                    <div key={step.label} className={index === 3 ? 'rounded-lg bg-white/70 px-2 py-1' : ''}>
                      <p className="text-[10px] font-semibold text-gold-800">{step.label}</p>
                      <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{money(step.value)}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-gold-800">
                  {L('Operating margin', 'পরিচালন মার্জিন')}: {(pl.mpm.operating_margin_bps / 100).toFixed(2)}% · {L('Comparative', 'তুলনামূলক')}:{' '}
                  {(pl.mpm.comparative_margin_bps / 100).toFixed(2)}% · {L('no reclassification of comparatives (IFRS 18.41)', 'তুলনামূলক পুনঃশ্রেণিবিন্যাস নেই (আইএফআরএস ১৮.৪১)')}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto px-5 py-5">
              <table className="lv-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>{L('Classic IAS 1 line', 'চিরাচরিত আইএএস ১ লাইন')}</th>
                    <th className="w-32 text-right">{currentLabel}</th>
                    <th className="w-32 text-right">{comparativeLabel}</th>
                    <th className="w-16 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'revenue', label_en: 'Revenue', label_bn: 'আয়', note: 'Note 3', data: classicPl.revenue, total: false },
                    { key: 'cogs', label_en: 'Cost of sales', label_bn: 'বিক্রীত পণ্যের ব্যয়', note: 'Note 7', data: classicPl.cogs, total: false },
                    { key: 'gross', label_en: 'Gross profit', label_bn: 'মোট মুনাফা', note: undefined, data: { amount: classicPl.revenue.gross, comparative: classicPl.revenue.grossComparative, codes: [...classicPl.revenue.codes, ...classicPl.cogs.codes] }, total: true },
                    { key: 'opex', label_en: 'Operating expenses', label_bn: 'পরিচালন ব্যয়', note: 'Note 13', data: classicPl.opex, total: false },
                    { key: 'op', label_en: 'Operating profit', label_bn: 'পরিচালন মুনাফা', note: undefined, data: classicPl.operatingProfit, total: true },
                    { key: 'fininc', label_en: 'Finance income', label_bn: 'আর্থিক আয়', note: 'Note 6', data: classicPl.financeIncome, total: false },
                    { key: 'fincost', label_en: 'Finance costs', label_bn: 'আর্থিক ব্যয়', note: 'Note 12', data: classicPl.financeCost, total: false },
                    { key: 'pbt', label_en: 'Profit before tax', label_bn: 'করপূর্ব মুনাফা', note: undefined, data: classicPl.pbt, total: true },
                    { key: 'tax', label_en: 'Income tax expense', label_bn: 'আয়কর ব্যয়', note: 'Note 16', data: classicPl.tax, total: false },
                    { key: 'profit', label_en: 'Profit for the period', label_bn: 'মেয়াদের মুনাফা', note: undefined, data: classicPl.profit, total: true },
                  ].map((row) => (
                    <tr
                      key={row.key}
                      className={`${row.total ? 'bg-ink-50/70 font-semibold' : ''} cursor-pointer transition-colors hover:bg-vault-50/40`}
                      onClick={() =>
                        setDrill({
                          codes: row.data.codes,
                          label_en: row.label_en,
                          label_bn: row.label_bn,
                          note_en: row.note ?? 'Aggregate line',
                          note_bn: row.note ? `নোট ${row.note.replace(/^Note\s*/i, '')}` : 'সমষ্টিগত লাইন',
                        })
                      }
                    >
                      <td className="align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-ink-800">{isBn ? row.label_bn : row.label_en}</span>
                          {row.note && <span className={NOTE_PILL}>{row.note}</span>}
                          <ArrowUpRight size={11} className="text-vault-500" />
                        </div>
                      </td>
                      <td className={`font-money text-right text-[12px] ${row.total ? 'border-b-4 border-double border-ink-900 font-semibold text-ink-900' : 'text-ink-800'}`}>
                        {money(row.data.amount)}
                      </td>
                      <td className="font-money text-right text-[11px] text-ink-500">{money(row.data.comparative)}</td>
                      <td className={`font-money text-right text-[10px] ${varianceTone(variancePct(row.data.amount, row.data.comparative))}`}>
                        {(() => {
                          const variance = variancePct(row.data.amount, row.data.comparative);
                          return variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`;
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---------------- Statement of changes in equity ---------------- */}
      {tab === 'SOCIE' && (
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker">{L('IAS 1.106 · statement of changes in equity', 'আইএএস ১.১০৬ · ইকুইটিতে পরিবর্তনের বিবরণী')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Equity roll-forward by reserve', 'রিজার্ভ অনুযায়ী ইকুইটি রোল-ফরোয়ার্ড')}</h2>
              <p className="lv-hint mt-1">
                {L('Opening balance, period profit and closing equity proved to the balance sheet.', 'প্রারম্ভিক ব্যালেন্স, মেয়াদের মুনাফা ও সমাপনী ইকুইটি ব্যালেন্স শিটে প্রমাণিত।')}
              </p>
            </div>
            <span className="lv-chip lv-chip-neutral"><span className={NOTE_PILL}>Note 17</span></span>
          </div>
          <div className="overflow-x-auto">
            <table className="lv-table min-w-[820px]">
              <thead>
                <tr>
                  <th>{L('Movement', 'পরিবর্তন')}</th>
                  <th className="text-right">{L('Share capital', 'শেয়ার মূলধন')}</th>
                  <th className="text-right">{L('Retained earnings', 'সঞ্চিত মুনাফা')}</th>
                  <th className="text-right">{L('Revaluation', 'পুনর্মূল্যায়ন')}</th>
                  <th className="text-right">{currentLabel}</th>
                  <th className="text-right">{comparativeLabel}</th>
                </tr>
              </thead>
              <tbody>
                {statements.changes_in_equity.map((row) => {
                  const codes =
                    row.row_id === 'SOCIE-CAPITAL'
                      ? ['3100']
                      : row.row_id === 'SOCIE-PROFIT'
                        ? accounts.filter((account) => account.account_type === 'REVENUE' || account.account_type === 'EXPENSE').map((account) => account.code)
                        : equityReserveCodes;
                  const openingComparative = bs.equity.comparative_total_poisha - pl.profit_for_period_comparative_poisha;
                  const comparativeAmount =
                    row.row_id === 'SOCIE-OPEN'
                      ? openingComparative
                      : row.row_id === 'SOCIE-PROFIT'
                        ? pl.profit_for_period_comparative_poisha
                        : row.row_id === 'SOCIE-CLOSE'
                          ? bs.equity.comparative_total_poisha
                          : 0n;
                  return (
                    <tr
                      key={row.row_id}
                      className={`${row.is_total ? 'bg-vault-50/70 font-semibold' : ''} cursor-pointer transition-colors hover:bg-vault-50/40`}
                      onClick={() =>
                        setDrill({
                          codes,
                          label_en: row.label_en,
                          label_bn: row.label_bn,
                          note_en: 'Note 17',
                          note_bn: 'নোট ১৭',
                        })
                      }
                    >
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-ink-800">{isBn ? row.label_bn : row.label_en}</span>
                          <ArrowUpRight size={11} className="text-vault-500" />
                        </div>
                      </td>
                      <td className="font-money text-right text-[12px]">{money(row.share_capital_poisha)}</td>
                      <td className="font-money text-right text-[12px]">{money(row.retained_earnings_poisha)}</td>
                      <td className="font-money text-right text-[12px]">{money(row.revaluation_poisha)}</td>
                      <td className={`font-money text-right text-[12px] font-semibold text-ink-900 ${row.is_total ? 'border-b-4 border-double border-ink-900' : ''}`}>
                        {money(row.total_poisha)}
                      </td>
                      <td className="font-money text-right text-[11px] text-ink-500">{money(comparativeAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-[11px] font-semibold text-ink-900">
                    {L('Closing equity per statement of financial position', 'আর্থিক অবস্থান বিবরণী অনুযায়ী সমাপনী ইকুইটি')}
                  </td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[12px] font-semibold">{money(bs.equity.total_poisha)}</td>
                  <td className="font-money text-right text-[11px] text-ink-500">{money(bs.equity.comparative_total_poisha)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ---------------- Statement of cash flows ---------------- */}
      {tab === 'CASH' && (
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker">{L('IAS 7 · statement of cash flows', 'আইএএস ৭ · নগদ প্রবাহ বিবরণী')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">
                {cashBasis === 'INDIRECT' ? L('Indirect method — starting from operating profit', 'পরোক্ষ পদ্ধতি — পরিচালন মুনাফা থেকে শুরু') : L('Direct method — receipts and payments', 'প্রত্যক্ষ পদ্ধতি — প্রাপ্তি ও পরিশোধ')}
              </h2>
              <p className="lv-hint mt-1">
                {L('Cash', 'নগদ')}: {money(cf.opening_cash_poisha)} → {money(cf.closing_cash_poisha)} ·{' '}
                {cf.reconciles ? L('reconciles to the ledger', 'খতিয়ানের সাথে মিলে') : L('difference disclosed', 'পার্থক্য প্রকাশিত')}
              </p>
            </div>
            <div className="lv-seg">
              <button type="button" data-active={cashBasis === 'INDIRECT'} className="lv-seg-item" onClick={() => setCashBasis('INDIRECT')}>
                {L('Indirect', 'পরোক্ষ')}
              </button>
              <button type="button" data-active={cashBasis === 'DIRECT'} className="lv-seg-item" onClick={() => setCashBasis('DIRECT')}>
                {L('Direct', 'প্রত্যক্ষ')}
              </button>
            </div>
          </div>

          {cashBasis === 'INDIRECT' ? (
            <div className="space-y-5 px-5 py-5">
              <SectionBlock
                section={cf.operating}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                totalLabel_en="Net cash from operating activities"
                totalLabel_bn="পরিচালন কার্যক্রম থেকে নিট নগদ"
              />
              <SectionBlock
                section={cf.investing}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="gold"
                totalLabel_en="Net cash from investing activities"
                totalLabel_bn="বিনিয়োগ কার্যক্রম থেকে নিট নগদ"
              />
              <SectionBlock
                section={cf.financing}
                isBn={isBn}
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                books={bookScope}
                money={money}
                onDrill={setDrill}
                accent="ink"
                totalLabel_en="Net cash from financing activities"
                totalLabel_bn="অর্থায়ন কার্যক্রম থেকে নিট নগদ"
              />
              <div className="grid gap-3 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 sm:grid-cols-3">
                <div>
                  <p className="lv-kicker">{L('Net change in cash', 'নগদে নিট পরিবর্তন')}</p>
                  <p className="font-money mt-1 border-b-4 border-double border-ink-900 pb-0.5 text-sm font-semibold text-ink-900">{money(cf.net_change_poisha)}</p>
                </div>
                <div>
                  <p className="lv-kicker">{L('Opening cash', 'প্রারম্ভিক নগদ')}</p>
                  <p className="font-money mt-1 text-sm font-semibold text-ink-900">{money(cf.opening_cash_poisha)}</p>
                </div>
                <div>
                  <p className="lv-kicker">{L('Closing cash', 'সমাপনী নগদ')}</p>
                  <p className="font-money mt-1 border-b-4 border-double border-vault-600 pb-0.5 text-sm font-semibold text-vault-800">{money(cf.closing_cash_poisha)}</p>
                </div>
              </div>
              <p className="text-[10px] text-ink-500">
                {L('Difference to ledger cash', 'খতিয়ান নগদের সাথে পার্থক্য')}: {money(cf.difference_poisha)} · {L('Operating total', 'পরিচালন মোট')}: {money(cf.operating_total_poisha)} ·{' '}
                {L('Investing total', 'বিনিয়োগ মোট')}: {money(cf.investing_total_poisha)} · {L('Financing total', 'অর্থায়ন মোট')}: {money(cf.financing_total_poisha)}
              </p>
            </div>
          ) : (
            <div className="space-y-4 px-5 py-5">
              {(['OPERATING', 'INVESTING', 'FINANCING'] as const).map((section) => {
                const rows = directCash.rows.filter((row) => row.section === section);
                const total = section === 'OPERATING' ? directCash.operating : section === 'INVESTING' ? directCash.investing : directCash.financing;
                const title =
                  section === 'OPERATING'
                    ? L('Cash flows from operating activities', 'পরিচালন কার্যক্রম থেকে নগদ প্রবাহ')
                    : section === 'INVESTING'
                      ? L('Cash flows from investing activities', 'বিনিয়োগ কার্যক্রম থেকে নগদ প্রবাহ')
                      : L('Cash flows from financing activities', 'অর্থায়ন কার্যক্রম থেকে নগদ প্রবাহ');
                return (
                  <div key={section} className="space-y-1.5">
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${section === 'OPERATING' ? 'text-vault-800' : section === 'INVESTING' ? 'text-gold-700' : 'text-ink-700'}`}>{title}</p>
                    <table className="lv-table w-full">
                      <thead>
                        <tr>
                          <th>{L('Receipts / (payments)', 'প্রাপ্তি / (পরিশোধ)')}</th>
                          <th className="w-40 text-right">{L('Amount', 'পরিমাণ')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 && (
                          <tr>
                            <td className="text-[11px] text-ink-400" colSpan={2}>{L('No cash movement in this category.', 'এই শ্রেণিতে কোনো নগদ চলাচল নেই।')}</td>
                          </tr>
                        )}
                        {rows.map((row) => (
                          <tr
                            key={row.key}
                            className="cursor-pointer transition-colors hover:bg-vault-50/40"
                            onClick={() =>
                              setDrill({
                                codes: row.codes,
                                label_en: row.label_en,
                                label_bn: row.label_bn,
                                note_en: 'IAS 7 direct method',
                                note_bn: 'আইএএস ৭ প্রত্যক্ষ পদ্ধতি',
                              })
                            }
                          >
                            <td>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] text-ink-800">{isBn ? row.label_bn : row.label_en}</span>
                                <ArrowUpRight size={11} className="text-vault-500" />
                              </div>
                            </td>
                            <td className={`font-money text-right text-[12px] ${row.amount < 0n ? 'text-rose-600' : 'text-vault-800'}`}>{money(row.amount, { sign: true })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="text-[11px] font-semibold text-ink-900">{L('Net cash', 'নিট নগদ')}</td>
                          <td className="font-money border-b-4 border-double border-ink-900 text-right text-[12px] font-semibold">{money(total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })}
              <div className="grid gap-3 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 sm:grid-cols-4">
                <div>
                  <p className="lv-kicker">{L('Direct net movement', 'প্রত্যক্ষ নিট চলাচল')}</p>
                  <p className="font-money mt-1 border-b-4 border-double border-ink-900 pb-0.5 text-sm font-semibold">{money(directCash.net)}</p>
                </div>
                <div>
                  <p className="lv-kicker">{L('Ledger net movement', 'খতিয়ান নিট চলাচল')}</p>
                  <p className="font-money mt-1 text-sm font-semibold">{money(directCash.ledgerNet)}</p>
                </div>
                <div>
                  <p className="lv-kicker">{L('Opening cash', 'প্রারম্ভিক নগদ')}</p>
                  <p className="font-money mt-1 text-sm font-semibold">{money(cf.opening_cash_poisha)}</p>
                </div>
                <div>
                  <p className="lv-kicker">{L('Closing cash', 'সমাপনী নগদ')}</p>
                  <p className="font-money mt-1 text-sm font-semibold text-vault-800">{money(cf.closing_cash_poisha)}</p>
                </div>
              </div>
              <p className="text-[10px] text-ink-500">
                {L(
                  `Direct presentation is derived from the cash-side legs of ${journals.length} journals; difference to the ledger movement ${money(directCash.difference)}.`,
                  `প্রত্যক্ষ উপস্থাপন ${journals.length} জার্নালের নগদ-দিক থেকে উদ্ভূত; খতিয়ান চলাচলের সাথে পার্থক্য ${money(directCash.difference)}।`,
                )}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---------------- Trial balance ---------------- */}
      {tab === 'TB' && (
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker">{L('Trial balance proof', 'রেওয়ামিল প্রমাণ')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Every ledger account, opening to closing', 'প্রতিটি খতিয়ান হিসাব, প্রারম্ভিক থেকে সমাপনী')}</h2>
              <p className="lv-hint mt-1">
                {L('Click a row to open its journal lines', 'সারিতে ক্লিক করে জার্নাল লাইন দেখুন')} · {tbDebit === tbCredit ? L('debits = credits', 'ডেবিট = ক্রেডিট') : L('out of balance', 'অসাম্য')}
              </p>
            </div>
            <span className={`lv-chip ${tbDebit === tbCredit ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              {money(tbDebit)} = {money(tbCredit)}
            </span>
          </div>
          <div className="max-h-[600px] overflow-auto">
            <table className="lv-table min-w-[1040px]">
              <thead>
                <tr>
                  <th>{L('Code', 'কোড')}</th>
                  <th>{L('Account', 'হিসাব')}</th>
                  <th>{L('Type', 'ধরন')}</th>
                  <th className="text-right">{L('Opening dr', 'প্রারম্ভিক ডেবিট')}</th>
                  <th className="text-right">{L('Opening cr', 'প্রারম্ভিক ক্রেডিট')}</th>
                  <th className="text-right">{L('Period dr', 'কালীন ডেবিট')}</th>
                  <th className="text-right">{L('Period cr', 'কালীন ক্রেডিট')}</th>
                  <th className="text-right">{L('Closing', 'সমাপনী')}</th>
                  <th className="text-right">{comparativeLabel}</th>
                  <th className="w-16 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {statements.trial_balance.map((row) => {
                  const comparative = comparativeClosing.get(row.account_code) ?? 0n;
                  const variance = variancePct(row.balance_poisha, comparative);
                  return (
                    <tr
                      key={row.account_code}
                      className="cursor-pointer transition-colors hover:bg-vault-50/50"
                      onClick={() =>
                        setDrill({
                          codes: [row.account_code],
                          label_en: row.name_en,
                          label_bn: row.name_bn,
                          note_en: 'Trial balance',
                          note_bn: 'রেওয়ামিল',
                        })
                      }
                    >
                      <td className="font-mono text-[11px] font-semibold text-vault-700">{row.account_code}</td>
                      <td className="text-[12px] text-ink-800">{isBn ? row.name_bn : row.name_en}</td>
                      <td className="text-[9px] uppercase tracking-wide text-ink-400">{row.account_type}</td>
                      <td className="font-money text-right text-[10px] text-ink-600">{money(row.opening_debit_poisha)}</td>
                      <td className="font-money text-right text-[10px] text-ink-600">{money(row.opening_credit_poisha)}</td>
                      <td className="font-money text-right text-[10px] text-ink-600">{money(row.period_debit_poisha)}</td>
                      <td className="font-money text-right text-[10px] text-ink-600">{money(row.period_credit_poisha)}</td>
                      <td className="font-money text-right text-[11px] font-semibold text-ink-900">{money(row.balance_poisha)}</td>
                      <td className="font-money text-right text-[10px] text-ink-500">{money(comparative)}</td>
                      <td className={`font-money text-right text-[10px] ${varianceTone(variance)}`}>
                        {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50">
                  <td colSpan={3} className="text-[11px] font-semibold text-ink-900">{L('Totals', 'মোট')}</td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[10px] font-semibold">{money(statements.trial_balance.reduce((total, row) => total + row.opening_debit_poisha, 0n))}</td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[10px] font-semibold">{money(statements.trial_balance.reduce((total, row) => total + row.opening_credit_poisha, 0n))}</td>
                  <td className="font-money text-right text-[10px] font-semibold">{money(statements.trial_balance.reduce((total, row) => total + row.period_debit_poisha, 0n))}</td>
                  <td className="font-money text-right text-[10px] font-semibold">{money(statements.trial_balance.reduce((total, row) => total + row.period_credit_poisha, 0n))}</td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[11px] font-semibold">{money(tbDebit - tbCredit)}</td>
                  <td className="font-money text-right text-[10px] text-ink-500">{L('variance', 'পার্থক্য')}</td>
                  <td className="text-right text-[10px] text-ink-400">{tbDebit === tbCredit ? '0.00' : money(tbDebit - tbCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ---------------- Notes ---------------- */}
      {tab === 'NOTES' && (
        <section className="space-y-3">
          <article className="lv-card lv-card-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="lv-kicker flex items-center gap-1.5"><BookOpen size={12} /> {L('Note 1 · basis of preparation', 'নোট ১ · প্রস্তুতির ভিত্তি')}</p>
                <h2 className="mt-1 text-sm font-semibold text-ink-900">{L(framework.short_en, framework.short_bn)}</h2>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-ink-700">{noteBody(framework.legal_en, framework.legal_bn)}</p>
                <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-ink-500">{noteBody(framework.basis_en, framework.basis_bn)}</p>
                <p className="mt-1 text-[10px] text-ink-400">
                  {L('Books in scope', 'পরিসরের বই')}: {bookScope} · {L('Presented in', 'উপস্থাপিত')}: {vault.tenant.functional_currency} · {L('Figures rounded to poisha', 'সংখ্যা পয়সা পর্যন্ত')}
                </p>
              </div>
              <CryptographicSealSvg size={72} variant="audit" verified={vault.auditChain.valid} />
            </div>
          </article>

          <article className="lv-card lv-card-pad">
            <p className="lv-kicker">{L('Significant accounting policies for this framework', 'এই কাঠামোর উল্লেখযোগ্য হিসাব নীতি')}</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {policyNotes.map((policy) => (
                <li key={policy.en} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-700">
                  <BadgeCheck size={12} className="mt-0.5 shrink-0 text-vault-600" />
                  {noteBody(policy.en, policy.bn)}
                </li>
              ))}
            </ul>
          </article>

          {statements.notes.map((note) => (
            <article key={note.id} className="lv-card lv-card-pad">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">
                  <span className="mr-2 font-mono text-[11px] text-vault-700">Note {note.number}</span>
                  {isBn ? note.title_bn : note.title_en}
                </p>
                <span className="lv-chip lv-chip-neutral">{note.rows.length} {L('rows', 'সারি')}</span>
              </div>
              <p className="lv-hint mt-1.5 leading-relaxed">{isBn ? note.body_bn : note.body_en}</p>
              {note.rows.length > 0 && (
                <table className="lv-table mt-3 w-full">
                  <thead>
                    <tr>
                      <th>{L('Disclosure', 'প্রকাশ')}</th>
                      <th className="w-36 text-right">{currentLabel}</th>
                      <th className="w-36 text-right">{comparativeLabel}</th>
                      <th className="w-16 text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.rows.map((row) => {
                      const variance = variancePct(row.amount_poisha, row.comparative_poisha);
                      return (
                        <tr key={`${note.id}-${row.label_en}`}>
                          <td className="text-[12px] text-ink-700">{isBn ? row.label_bn : row.label_en}</td>
                          <td className="font-money text-right text-[12px] text-ink-900">{money(row.amount_poisha)}</td>
                          <td className="font-money text-right text-[11px] text-ink-500">{money(row.comparative_poisha)}</td>
                          <td className={`font-money text-right text-[10px] ${varianceTone(variance)}`}>
                            {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </article>
          ))}
        </section>
      )}

      {/* ---------------- Footer rail ---------------- */}
      <section className="lv-card lv-card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Download size={12} /> {L('Drill-through & evidence', 'ড্রিল-থ্রু ও প্রমাণ')}</p>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {L('Every line is clickable — the drawer shows the journals, Ledger Lens shows the hash.', 'প্রতিটি লাইন ক্লিকযোগ্য — ড্রয়ারে জার্নাল, লেজার লেন্সে হ্যাশ।')}
            </p>
            <p className="lv-hint mt-0.5">
              {journals.length} {L('posted journals', 'পোস্টেড জার্নাল')} · {L('SHA-256 chain', 'শা-২৫৬ চেইন')} {vault.auditChain.valid ? L('intact', 'অটুট') : L('broken', 'ভাঙা')} ·{' '}
              {L('BigInt poisha throughout', 'সর্বত্র বিগইন্ট পয়সা')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="lv-btn lv-btn-ghost" onClick={() => setTab('SOFP')}>
              <Landmark size={13} /> {L('Back to SOFP', 'এসওএফপি')}
            </button>
            <button type="button" className="lv-btn lv-btn-ghost" onClick={() => setTab('NOTES')}>
              <ScrollText size={13} /> {L('Notes index', 'নোট সূচি')}
            </button>
            <button type="button" className="lv-btn lv-btn-secondary" onClick={() => setPrintOpen(true)}>
              <Printer size={14} /> {L('Print A4 pack', 'এ৪ প্যাক প্রিন্ট')}
            </button>
          </div>
        </div>
      </section>

      <DrillDrawer
        target={drill}
        entries={drillEntries}
        isBn={isBn}
        locale={locale}
        money={money}
        onClose={() => setDrill(null)}
        onOpenLens={(journal) => setLensJournalId(journal.id)}
      />
      <LedgerLensModal journal={lensJournal} onClose={() => setLensJournalId(null)} open={lensJournal !== null} contextLabel={drill ? (isBn ? drill.label_bn : drill.label_en) : undefined} />
      <StatutoryPrintModal open={printOpen} onClose={() => setPrintOpen(false)} mode="IFRS_PACK" />
    </div>
  );
}
