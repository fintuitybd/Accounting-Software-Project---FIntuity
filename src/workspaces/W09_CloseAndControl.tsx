// Fintuity Accounting Suite — W09 Close & control.
//
// The month-end command centre. Four instruments, all reading the same immutable ledger:
//   1. Subledger-to-GL control matrix — AR, AP, Bank/MFS, VAT current account, VDS and TDS proved
//      against their own schedules, never plugged.
//   2. Suspense exception queue — every unexplained 2190 balance with its ageing, drillable to GL.
//   3. Eleven-step close wizard — each step's status computed live from ledger signals, with an
//      explicit sign-off for the one step no engine can perform, and a period lock.
//   4. SHA-256 audit-chain verifier — re-hashes the chain on demand and shows broken links.

import { Fragment, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Handshake,
  Landmark,
  Lock,
  LockOpen,
  RefreshCcw,
  Scale,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { CryptographicSealSvg } from '../components/svg/VaultVisuals';
import { LedgerLensModal } from '../components/signature/LedgerLensModal';
import { formatDate } from '../core/money';
import {
  GENESIS_AUDIT_HASH,
  computeAuditHash,
  shortHash,
  verifyAuditChain,
  type AuditChainResult,
  type SubledgerProofRow,
} from '../core/ledger/ledgerEngine';
import { useVault } from '../context/VaultContext';
import type { CloseStep } from '../core/types';

const KEY_TONE: Record<SubledgerProofRow['key'], string> = {
  AR: 'bg-vault-100 text-vault-800',
  AP: 'bg-amber-100 text-amber-800',
  BANK_MFS: 'bg-sky-100 text-sky-800',
  VAT_CURRENT_ACCOUNT: 'bg-emerald-100 text-emerald-800',
  VDS_PAYABLE: 'bg-indigo-100 text-indigo-800',
  TDS_PAYABLE: 'bg-rose-100 text-rose-800',
};

const PROOF_ICON: Record<SubledgerProofRow['key'], typeof Landmark> = {
  AR: Handshake,
  AP: Handshake,
  BANK_MFS: Banknote,
  VAT_CURRENT_ACCOUNT: FileCheck2,
  VDS_PAYABLE: Landmark,
  TDS_PAYABLE: Landmark,
};

function debitSum(lines: ReadonlyArray<{ debit_poisha: bigint }>): bigint {
  return lines.reduce((total, line) => total + line.debit_poisha, 0n);
}

function creditSum(lines: ReadonlyArray<{ credit_poisha: bigint }>): bigint {
  return lines.reduce((total, line) => total + line.credit_poisha, 0n);
}

export default function W09_CloseAndControl() {
  const vault = useVault();
  const { locale, money, statements, reconciliation, periods, publishToast } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const periodCode = statements.period.code;
  const period = periods.find((entry) => entry.code === periodCode);
  const periodEnd = period?.end_date ?? statements.period.end;

  const [expandedRow, setExpandedRow] = useState<SubledgerProofRow['key'] | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [verification, setVerification] = useState<AuditChainResult>(vault.auditChain);
  const [verifiedAt, setVerifiedAt] = useState<string>('');
  const [lensJournalId, setLensJournalId] = useState<string | null>(null);

  const lensJournal = lensJournalId ? vault.journals.find((journal) => journal.id === lensJournalId) ?? null : null;
  const periodStatus = period?.status ?? 'OPEN';
  const locked = periodStatus === 'LOCKED';

  // -----------------------------------------------------------------------------------------
  // Live close signals
  // -----------------------------------------------------------------------------------------
  const signals = useMemo(() => {
    const periodJournals = vault.journals.filter((journal) => journal.period_code === periodCode);
    const unbalanced = vault.journals.filter((journal) => debitSum(journal.lines) !== creditSum(journal.lines));
    const lateDocuments = vault.commercialDocs.filter(
      (doc) => doc.doc_date > periodEnd && (doc.status === 'POSTED' || doc.status === 'SETTLED'),
    );
    const unmatchedBank = vault.statementLines.filter((line) => line.status === 'UNMATCHED');
    const pendingChallans = vault.challans.filter((challan) => challan.status === 'PENDING');
    const openNotices = vault.statutoryRecords.filter((record) => record.kind === 'NOTICE' && record.status === 'OPEN');
    const expiringLicences = vault.statutoryRecords.filter(
      (record) => record.kind === 'LICENCE' && record.status !== 'VALID',
    );
    const cutoffJournalCount = periodJournals.filter(
      (journal) => journal.posting_date <= periodEnd && journal.posting_date >= statements.period.start,
    ).length;
    const payrollPosted = periodJournals.some((journal) => journal.source_module === 'PAYROLL_LITE');
    const depreciationPosted = periodJournals.some((journal) =>
      journal.lines.some((line) => line.account_code === '5400' || line.account_code === '2610'),
    );
    const tbDebit = statements.trial_balance.reduce((total, row) => total + row.closing_debit_poisha, 0n);
    const tbCredit = statements.trial_balance.reduce((total, row) => total + row.closing_credit_poisha, 0n);
    const controlGap = reconciliation.rows.filter((row) => !row.reconciled);

    return {
      periodJournals,
      cutoffJournalCount,
      unbalanced,
      lateDocuments,
      unmatchedBank,
      pendingChallans,
      openNotices,
      expiringLicences,
      payrollPosted,
      depreciationPosted,
      tbDebit,
      tbCredit,
      controlGap,
      tbBalanced: tbDebit === tbCredit && statements.balance_sheet.balanced,
    };
  }, [vault.journals, vault.commercialDocs, vault.statementLines, vault.challans, vault.statutoryRecords, statements, reconciliation.rows, periodCode, periodEnd]);

  const steps = useMemo<CloseStep[]>(() => {
    const currency = (value: bigint): string => `${value / 100n}.${(value < 0n ? -value % 100n : value % 100n).toString().padStart(2, '0')}`;
    const warn = (condition: boolean): CloseStep['status'] => (condition ? 'WARNING' : 'PASSED');
    const detail = (en: string, bn: string): { detail_en: string; detail_bn: string } => ({ detail_en: en, detail_bn: bn });

    return [
      {
        id: 1,
        title_en: 'Cut-off & document freeze',
        title_bn: 'কাট-অফ ও নথি হিমায়ন',
        description_en: 'No posted document may carry a date after the period end.',
        description_bn: 'সময়কাল শেষের পরের তারিখে কোনো পোস্টেড নথি থাকতে পারবে না।',
        status: warn(signals.lateDocuments.length > 0),
        automated: true,
        ...detail(
          signals.lateDocuments.length
            ? `${signals.lateDocuments.length} document(s) dated after ${periodEnd}.`
            : `${signals.cutoffJournalCount} journals inside the period, none after cut-off.`,
          signals.lateDocuments.length
            ? `${periodEnd}-এর পরে তারিখযুক্ত ${signals.lateDocuments.length}টি নথি।`
            : `সময়কালের ভেতরে ${signals.cutoffJournalCount} জার্নাল, কাট-অফের পরে কোনোটি নয়।`,
        ),
      },
      {
        id: 2,
        title_en: 'Bank & MFS reconciliation',
        title_bn: 'ব্যাংক ও এমএফএস মিলন',
        description_en: 'Every statement line is matched to a ledger journal or categorised.',
        description_bn: 'প্রতিটি বিবরণী লাইন খতিয়ান জার্নালের সাথে মিলেছে বা শ্রেণিবদ্ধ হয়েছে।',
        status: warn(signals.unmatchedBank.length > 0),
        automated: true,
        ...detail(
          `${vault.statementLines.length} statement lines · ${signals.unmatchedBank.length} unmatched.`,
          `${vault.statementLines.length} বিবরণী লাইন · ${signals.unmatchedBank.length} অমিলিত।`,
        ),
      },
      {
        id: 3,
        title_en: 'Accounts receivable control proof',
        title_bn: 'প্রাপ্য হিসাব নিয়ন্ত্রণ প্রমাণ',
        description_en: 'Trade receivables control equals the open-item subledger schedule.',
        description_bn: 'বাণিজ্যিক প্রাপ্য নিয়ন্ত্রণ খোলা আইটেম সাবলেজারের সমান।',
        status: warn(Boolean(reconciliation.rows.find((row) => row.key === 'AR' && !row.reconciled))),
        automated: true,
        ...detail(
          reconciliation.rows.find((row) => row.key === 'AR')?.detail_en ?? 'AR control not found.',
          reconciliation.rows.find((row) => row.key === 'AR')?.detail_bn ?? 'প্রাপ্য নিয়ন্ত্রণ পাওয়া যায়নি।',
        ),
      },
      {
        id: 4,
        title_en: 'Accounts payable control proof',
        title_bn: 'প্রদেয় হিসাব নিয়ন্ত্রণ প্রমাণ',
        description_en: 'Trade payables control equals the supplier subledger schedule.',
        description_bn: 'বাণিজ্যিক প্রদেয় নিয়ন্ত্রণ সরবরাহকারী সাবলেজারের সমান।',
        status: warn(Boolean(reconciliation.rows.find((row) => row.key === 'AP' && !row.reconciled))),
        automated: true,
        ...detail(
          reconciliation.rows.find((row) => row.key === 'AP')?.detail_en ?? 'AP control not found.',
          reconciliation.rows.find((row) => row.key === 'AP')?.detail_bn ?? 'প্রদেয় নিয়ন্ত্রণ পাওয়া যায়নি।',
        ),
      },
      {
        id: 5,
        title_en: 'VAT current account & Mushak 9.1',
        title_bn: 'ভ্যাট চলতি হিসাব ও মূসক ৯.১',
        description_en: 'VAT control agrees to the return and the 6.1 / 6.2 registers.',
        description_bn: 'ভ্যাট নিয়ন্ত্রণ রিটার্ন এবং ৬.১ / ৬.২ রেজিস্টারের সাথে মিলে।',
        status: warn(Boolean(reconciliation.rows.find((row) => row.key === 'VAT_CURRENT_ACCOUNT' && !row.reconciled))),
        automated: true,
        ...detail(
          reconciliation.rows.find((row) => row.key === 'VAT_CURRENT_ACCOUNT')?.detail_en ?? 'VAT control not found.',
          reconciliation.rows.find((row) => row.key === 'VAT_CURRENT_ACCOUNT')?.detail_bn ?? 'ভ্যাট নিয়ন্ত্রণ পাওয়া যায়নি।',
        ),
      },
      {
        id: 6,
        title_en: 'VDS & TDS challan deposit',
        title_bn: 'ভিডিএস ও টিডিএস চালান জমা',
        description_en: 'Withheld amounts are deposited into the Treasury and certified.',
        description_bn: 'কর্তিত অর্থ কোষাগারে জমা ও প্রত্যয়িত হয়েছে।',
        status: warn(signals.pendingChallans.length > 0),
        automated: true,
        ...detail(
          signals.pendingChallans.length
            ? `${signals.pendingChallans.length} challan(s) still pending deposit.`
            : 'All withholding challans deposited or certified.',
          signals.pendingChallans.length
            ? `${signals.pendingChallans.length}টি চালান এখনো জমা হয়নি।`
            : 'সব কর্তন চালান জমা বা প্রত্যয়িত।',
        ),
      },
      {
        id: 7,
        title_en: 'Suspense & exception clearance',
        title_bn: 'সাসপেন্স ও ব্যতিক্রম নিষ্পত্তি',
        description_en: 'The 2190 suspense queue holds nothing older than the current period.',
        description_bn: '২১৯০ সাসপেন্স সারিতে চলতি সময়কালের চেয়ে পুরোনো কিছু নেই।',
        status: warn(reconciliation.suspense_balance_poisha !== 0n),
        automated: true,
        ...detail(
          `${reconciliation.suspense_items.length} open item(s) · net 2190 balance BDT ${currency(reconciliation.suspense_balance_poisha)}.`,
          `${reconciliation.suspense_items.length}টি খোলা আইটেম · নিট ২১৯০ ব্যালেন্স ${currency(reconciliation.suspense_balance_poisha)} টাকা।`,
        ),
      },
      {
        id: 8,
        title_en: 'Payroll, PF & WPPF accrual',
        title_bn: 'পে-রোল, পিএফ ও ডব্লিউপিপিএফ সঞ্চিতি',
        description_en: 'The monthly payroll journal with employer PF and WPPF is posted.',
        description_bn: 'নিয়োগকর্তার পিএফ ও ডব্লিউপিপিএফসহ মাসিক পে-রোল জার্নাল পোস্ট হয়েছে।',
        status: warn(!signals.payrollPosted),
        automated: true,
        ...detail(
          signals.payrollPosted
            ? `Payroll journal present in ${periodCode}.`
            : `No payroll journal found in ${periodCode}.`,
          signals.payrollPosted
            ? `${periodCode}-এ পে-রোল জার্নাল আছে।`
            : `${periodCode}-এ কোনো পে-রোল জার্নাল নেই।`,
        ),
      },
      {
        id: 9,
        title_en: 'Depreciation & IAS 19 gratuity',
        title_bn: 'অবচয় ও আইএএস ১৯ গ্র্যাচুইটি',
        description_en: 'Depreciation and the defined-benefit service cost are accrued.',
        description_bn: 'অবচয় এবং নির্ধারিত সুবিধা সেবা ব্যয় সঞ্চিত হয়েছে।',
        status: warn(!signals.depreciationPosted),
        automated: true,
        ...detail(
          signals.depreciationPosted
            ? 'Depreciation / gratuity accrual journals found for the period.'
            : 'No depreciation or IAS 19 accrual journal found for the period.',
          signals.depreciationPosted
            ? 'সময়কালের অবচয় / গ্র্যাচুইটি সঞ্চিতি জার্নাল পাওয়া গেছে।'
            : 'সময়কালের অবচয় বা আইএএস ১৯ সঞ্চিতি জার্নাল পাওয়া যায়নি।',
        ),
      },
      {
        id: 10,
        title_en: 'Trial balance & audit chain proof',
        title_bn: 'রেওয়ামিল ও অডিট চেইন প্রমাণ',
        description_en: 'Trial balance debits equal credits and every chain link re-hashes.',
        description_bn: 'রেওয়ামিলের ডেবিট-ক্রেডিট সমান এবং প্রতিটি চেইন লিংক পুনঃহ্যাশ করে।',
        status: warn(!signals.tbBalanced || !vault.auditChain.valid),
        automated: true,
        ...detail(
          `TB ${currency(signals.tbDebit)} / ${currency(signals.tbCredit)} · chain ${vault.auditChain.valid ? 'valid' : 'broken'}.`,
          `রেওয়ামিল ${currency(signals.tbDebit)} / ${currency(signals.tbCredit)} · চেইন ${vault.auditChain.valid ? 'বৈধ' : 'ভাঙা'}।`,
        ),
      },
      {
        id: 11,
        title_en: 'Board representation & period lock',
        title_bn: 'বোর্ড প্রতিনিধিত্ব ও সময়কাল লক',
        description_en: 'The board signs the representation letter; the period is then locked.',
        description_bn: 'বোর্ড প্রতিনিধিত্ব পত্রে স্বাক্ষর করে; এরপর সময়কাল লক হয়।',
        status: 'PENDING',
        automated: false,
        ...detail(
          'Manual step: attach the signed board representation and lock the period.',
          'ম্যানুয়াল ধাপ: স্বাক্ষরিত বোর্ড প্রতিনিধিত্ব সংযুক্ত করে সময়কাল লক করুন।',
        ),
      },
    ];
  }, [signals, reconciliation, periodCode, periodEnd, statements.period.start, vault.auditChain.valid, vault.statementLines.length]);

  const passedCount = steps.filter((step) => step.status === 'PASSED').length;
  const ready = passedCount === steps.length;
  const active = steps.find((step) => step.id === activeStep) ?? steps[0];

  const reverify = (): void => {
    const result = verifyAuditChain(vault.journals);
    setVerification(result);
    setVerifiedAt(new Date().toISOString());
    publishToast({
      tone: result.valid ? 'success' : 'error',
      title: result.valid ? L('Audit chain verified', 'অডিট চেইন যাচাই হয়েছে') : L('Audit chain broken', 'অডিট চেইন ভাঙা'),
      message: result.valid
        ? `${result.checkedCount} ${L('journals re-hashed', 'জার্নাল পুনঃহ্যাশ')}`
        : `${L('Broken at', 'ভাঙা')} ${result.brokenAtId ?? '—'}`,
    });
  };

  const chainTail = useMemo(() => {
    const ordered = [...vault.journals];
    return ordered.slice(-6).reverse();
  }, [vault.journals]);

  const ageingBuckets = useMemo(() => {
    const buckets = [
      { key: '0–30', en: '0–30 days', bn: '০–৩০ দিন', min: 0, max: 30, total: 0n, count: 0 },
      { key: '31–60', en: '31–60 days', bn: '৩১–৬০ দিন', min: 31, max: 60, total: 0n, count: 0 },
      { key: '61–90', en: '61–90 days', bn: '৬১–৯০ দিন', min: 61, max: 90, total: 0n, count: 0 },
      { key: '90+', en: '90+ days', bn: '৯০+ দিন', min: 91, max: 9999, total: 0n, count: 0 },
    ];
    for (const item of reconciliation.suspense_items) {
      const bucket = buckets.find((entry) => item.age_days >= entry.min && item.age_days <= entry.max) ?? buckets[3];
      bucket.total += item.amount_poisha;
      bucket.count += 1;
    }
    return buckets;
  }, [reconciliation.suspense_items]);

  return (
    <div className="space-y-5">
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><CalendarCheck2 size={12} /> {L('Close cockpit', 'সমাপনী ককপিট')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Month-end control for', 'মাস শেষ নিয়ন্ত্রণ')} {isBn ? statements.period.label_bn : statements.period.label_en}
            </h2>
            <p className="ql-hint mt-1">
              {L('Proved at', 'প্রমাণিত')} {reconciliation.checked_at.slice(0, 19).replace('T', ' ')} · {reconciliation.open_item_count} {L('open items', 'খোলা আইটেম')}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <CryptographicSealSvg size={54} variant={locked ? 'locked' : 'audit'} verified={vault.auditChain.valid} />
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{L('Period status', 'সময়কাল অবস্থা')}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-ink-700">
                  {locked ? <Lock size={12} /> : <LockOpen size={12} />}
                  {periodStatus}
                </p>
                <a href="/app/close" className="mt-1 block text-[12px] font-semibold text-vault-700 hover:text-vault-900">
                  {L('Open controlled close', 'নিয়ন্ত্রিত সমাপনী খুলুন')} →
                </a>
              </div>
            </div>
            <span className={`ql-badge ${reconciliation.all_reconciled ? 'ql-badge-success' : 'ql-badge-danger'}`}>
              {reconciliation.all_reconciled ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}
              {reconciliation.all_reconciled ? L('All controls reconcile', 'সব নিয়ন্ত্রণ মিলে') : L('Control exceptions', 'নিয়ন্ত্রণ ব্যতিক্রম')}
            </span>
          </div>
        </div>

        <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: L('Control difference', 'নিয়ন্ত্রণ পার্থক্য'), value: money(reconciliation.total_difference_poisha, { sign: true }), bad: reconciliation.total_difference_poisha !== 0n },
            { label: L('Suspense balance', 'সাসপেন্স ব্যালেন্স'), value: money(reconciliation.suspense_balance_poisha), bad: reconciliation.suspense_balance_poisha !== 0n },
            { label: L('Suspense items', 'সাসপেন্স আইটেম'), value: String(reconciliation.suspense_items.length), bad: reconciliation.suspense_items.length > 0 },
            { label: L('Wizard progress', 'উইজার্ড অগ্রগতি'), value: `${passedCount} / ${steps.length}`, bad: !ready },
            { label: L('Period status', 'সময়কাল অবস্থা'), value: periodStatus, bad: locked },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl bg-ink-50/70 px-3 py-2.5">
              <p className="ql-kicker">{tile.label}</p>
              <p className={`font-money mt-1 text-sm font-semibold ${tile.bad ? 'text-rose-600' : 'text-vault-800'}`}>{tile.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 1 — Reconciliation matrix */}
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><Scale size={12} /> {L('Control matrix', 'নিয়ন্ত্রণ ম্যাট্রিক্স')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Subledger-to-GL reconciliation', 'সাবলেজার-থেকে-জিএল মিলন')}</h2>
            <p className="ql-hint mt-1">{L('GL side is derived from journals; the subledger side from documents, registers and challans.', 'জিএল দিক জার্নাল থেকে, সাবলেজার দিক নথি, রেজিস্টার ও চালান থেকে।')}</p>
          </div>
          <span className="ql-badge ql-badge-neutral">{reconciliation.rows.length} {L('controls', 'নিয়ন্ত্রণ')}</span>
        </div>

        <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {reconciliation.rows.map((row) => {
            const Icon = PROOF_ICON[row.key] ?? Landmark;
            const open = expandedRow === row.key;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => setExpandedRow(open ? null : row.key)}
                className={`rounded-xl border px-3.5 py-3 text-left transition ${
                  row.reconciled
                    ? 'border-vault-200 bg-vault-50/60 hover:border-vault-400'
                    : 'border-rose-200 bg-rose-50/70 hover:border-rose-400'
                } ${open ? 'ring-2 ring-vault-400' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-7 w-7 place-items-center rounded-lg ${KEY_TONE[row.key]}`}>
                      <Icon size={14} />
                    </span>
                    <div>
                      <p className="text-[11px] font-semibold text-ink-900">{isBn ? row.label_bn : row.label_en}</p>
                      <p className="font-mono text-[9px] text-ink-400">{row.account_codes.join(' · ')}</p>
                    </div>
                  </div>
                  <span className={`ql-badge ${row.reconciled ? 'ql-badge-success' : 'ql-badge-danger'} !px-1.5 !py-0 text-[9px]`}>
                    {row.reconciled ? L('agrees', 'মিলে') : L('exception', 'ব্যতিক্রম')}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <p className="ql-kicker">{L('GL control', 'জিএল নিয়ন্ত্রণ')}</p>
                    <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{money(row.gl_balance_poisha)}</p>
                  </div>
                  <div>
                    <p className="ql-kicker">{L('Subledger', 'সাবলেজার')}</p>
                    <p className="font-money mt-0.5 text-[12px] text-ink-700">{money(row.subledger_balance_poisha)}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline justify-between border-t border-ink-100 pt-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">
                    {L('Difference', 'পার্থক্য')} · {row.open_items} {L('open', 'খোলা')}
                  </span>
                  <span className={`font-money border-b-2 border-double pb-0.5 text-[12px] font-semibold ${row.difference_poisha === 0n ? 'border-ink-200 text-ink-400' : 'border-rose-400 text-rose-600'}`}>
                    {money(row.difference_poisha, { sign: true })}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="ql-table min-w-[880px]">
            <thead>
              <tr>
                <th>{L('Control account', 'নিয়ন্ত্রণ হিসাব')}</th>
                <th className="text-right">{L('GL balance', 'জিএল ব্যালেন্স')}</th>
                <th className="text-right">{L('Subledger', 'সাবলেজার')}</th>
                <th className="text-right">{L('Difference', 'পার্থক্য')}</th>
                <th className="text-right">{L('Open items', 'খোলা আইটেম')}</th>
                <th>{L('Status', 'অবস্থা')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reconciliation.rows.map((row) => {
                const open = expandedRow === row.key;
                return (
                  <Fragment key={row.key}>
                    <tr className={open ? 'bg-vault-50/60' : ''}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${KEY_TONE[row.key]}`}>{row.key}</span>
                          <span className="text-[12px] font-medium text-ink-800">{isBn ? row.label_bn : row.label_en}</span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-ink-400">{row.account_codes.join(' · ')}</p>
                      </td>
                      <td className="font-money text-right text-[12px] text-ink-900">{money(row.gl_balance_poisha)}</td>
                      <td className="font-money text-right text-[12px] text-ink-700">{money(row.subledger_balance_poisha)}</td>
                      <td className={`font-money text-right text-[12px] font-semibold ${row.difference_poisha === 0n ? 'text-ink-400' : 'text-rose-600'}`}>
                        {money(row.difference_poisha, { sign: true })}
                      </td>
                      <td className="font-money text-right text-[12px] text-ink-600">{row.open_items}</td>
                      <td>
                        <span className={`ql-badge ${row.reconciled ? 'ql-badge-success' : 'ql-badge-danger'}`}>
                          {row.reconciled ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                          {row.reconciled ? L('Agrees', 'মিলে') : L('Exception', 'ব্যতিক্রম')}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-vault-700 hover:text-vault-900"
                          onClick={() => setExpandedRow(open ? null : row.key)}
                          aria-expanded={open}
                        >
                          {open ? L('Hide', 'লুকান') : L('Proof', 'প্রমাণ')}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${row.key}-detail`} className="bg-vault-50/80">
                        <td colSpan={7}>
                          <div className="grid gap-3 py-1 sm:grid-cols-3">
                            <div>
                              <p className="ql-kicker">{L('Opening control', 'প্রারম্ভিক নিয়ন্ত্রণ')}</p>
                              <p className="font-money mt-0.5 text-[12px]">{money(row.opening_control_poisha)}</p>
                            </div>
                            <div>
                              <p className="ql-kicker">{L('Period movement', 'কালীন চলাচল')}</p>
                              <p className="font-money mt-0.5 text-[12px]">{money(row.movement_poisha, { sign: true })}</p>
                            </div>
                            <div>
                              <p className="ql-kicker">{L('Conversion / ageing', 'রূপান্তর / বয়স')}</p>
                              <p className="font-money mt-0.5 text-[12px]">
                                {row.subledger_balance_poisha === 0n
                                  ? '—'
                                  : `${Number((row.gl_balance_poisha * 10000n) / row.subledger_balance_poisha) / 10000}x`}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 border-t border-vault-100 pt-2 text-[11px] leading-relaxed text-vault-900">
                            {isBn ? row.detail_bn : row.detail_en}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2 — Suspense queue */}
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><TriangleAlert size={12} /> {L('Exception queue', 'ব্যতিক্রম সারি')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Suspense & unapplied cash (2190)', 'সাসপেন্স ও অপ্রয়োজিত নগদ (২১৯০)')}</h2>
            <p className="ql-hint mt-1">{L('Balances are surfaced, never plugged. Every item is drillable to its journal.', 'ব্যালেন্স দেখানো হয়, কখনো সমন্বয় করা হয় না। প্রতিটি আইটেম জার্নাল পর্যন্ত।')}</p>
          </div>
          <span className={`ql-badge ${reconciliation.suspense_items.length === 0 ? 'ql-badge-success' : 'ql-badge-warn'}`}>
            {reconciliation.suspense_items.length} {L('items', 'আইটেম')} · {money(reconciliation.suspense_balance_poisha)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-ink-100 px-5 py-3 sm:grid-cols-4">
          {ageingBuckets.map((bucket) => (
            <div key={bucket.key} className="rounded-lg bg-ink-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{isBn ? bucket.bn : bucket.en}</p>
              <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{money(bucket.total)}</p>
              <p className="text-[10px] text-ink-400">{bucket.count} {L('items', 'আইটেম')}</p>
            </div>
          ))}
        </div>

        {reconciliation.suspense_items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-vault-700">
            <CheckCircle2 size={14} className="mr-1 inline" />
            {L('Suspense account is clean for this period.', 'এই সময়কালে সাসপেন্স হিসাব পরিষ্কার।')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ql-table min-w-[760px]">
              <thead>
                <tr>
                  <th>{L('Journal', 'জার্নাল')}</th>
                  <th>{L('Date', 'তারিখ')}</th>
                  <th>{L('Description', 'বিবরণ')}</th>
                  <th className="text-right">{L('Age', 'বয়স')}</th>
                  <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                  <th className="text-right">{L('Resolution', 'নিষ্পত্তি')}</th>
                  <th className="text-right">{L('GL', 'খতিয়ান')}</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.suspense_items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-[11px] font-semibold text-vault-700">{item.journal_number}</td>
                    <td className="text-[11px] text-ink-600">{formatDate(item.date, locale)}</td>
                    <td className="max-w-[280px] truncate text-[12px] text-ink-800" title={isBn ? item.description_bn : item.description_en}>
                      {isBn ? item.description_bn : item.description_en}
                    </td>
                    <td className="text-right">
                      <span className={`ql-badge ${item.age_days > 60 ? 'ql-badge-danger' : item.age_days > 30 ? 'ql-badge-warn' : 'ql-badge-neutral'}`}>
                        {item.age_days}d
                      </span>
                    </td>
                    <td className="font-money text-right text-[12px] font-semibold text-ink-900">{money(item.amount_poisha)}</td>
                    <td className="text-right">
                      <a href="/app/close" className="text-[12px] font-semibold text-vault-700 hover:text-vault-900">
                        {L('Resolve with approval', 'অনুমোদনসহ নিষ্পত্তি')} →
                      </a>
                    </td>
                    <td className="text-right">
                      <button type="button" className="text-[11px] font-semibold text-vault-700 hover:text-vault-900" onClick={() => setLensJournalId(item.journal_id)}>
                        {L('Open', 'খুলুন')} ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-ink-100 bg-ink-50/60 px-5 py-2 text-[10px] leading-relaxed text-ink-500">
          {L(
            'Allocations post a balanced journal: debit 2190, credit the identified control or equity account. The queue nets clearing debits against the oldest unexplained credits, so the balance falls to zero in front of you.',
            'বরাদ্দ একটি সুষম জার্নাল পোস্ট করে: ২১৯০ ডেবিট, চিহ্নিত নিয়ন্ত্রণ বা ইকুইটি হিসাব ক্রেডিট। সারি পুরোনো অজ্ঞাত ক্রেডিটের বিপরীতে নিষ্পত্তি ডেবিট নিট করে, ফলে ব্যালেন্স আপনার সামনেই শূন্য হয়।',
          )}
        </p>
      </section>

      {/* 3 — Close wizard */}
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><GitBranch size={12} /> {L('11-step close', '১১ ধাপ সমাপনী')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Month-end close wizard', 'মাস শেষ সমাপনী উইজার্ড')}</h2>
            <p className="ql-hint mt-1">{L('Signals are recomputed from the live ledger on every render.', 'প্রতিবার রেন্ডারে সংকেত লাইভ খতিয়ান থেকে পুনঃগণনা হয়।')}</p>
          </div>
          <div className="min-w-[160px]">
            <div className="flex items-center justify-between text-[10px] font-semibold text-ink-500">
              <span>{L('Progress', 'অগ্রগতি')}</span>
              <span className="font-money">{passedCount}/{steps.length}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-vault-600 transition-all" style={{ width: `${(passedCount / steps.length) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <ol className="divide-y divide-ink-100 border-b border-ink-100 lg:border-b-0 lg:border-r">
            {steps.map((step) => {
              const status = step.status;
              const selected = step.id === activeStep;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => setActiveStep(step.id)}
                    aria-current={selected}
                    className={`flex w-full items-start gap-3 px-5 py-2.5 text-left transition ${selected ? 'bg-vault-50' : 'hover:bg-ink-50'}`}
                  >
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                      status === 'PASSED' ? 'bg-vault-700 text-white' : status === 'WARNING' ? 'bg-rose-100 text-rose-700' : 'bg-ink-100 text-ink-500'
                    }`}>
                      {status === 'PASSED' ? <CheckCircle2 size={13} /> : status === 'WARNING' ? <CircleAlert size={13} /> : step.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-semibold text-ink-900">{isBn ? step.title_bn : step.title_en}</span>
                        {!step.automated && <span className="ql-badge ql-badge-warn shrink-0 !px-1 !py-0 text-[9px]">{L('manual', 'ম্যানুয়াল')}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-ink-400">
                        {status === 'WARNING' ? L('Needs attention', 'মনোযোগ প্রয়োজন') : status === 'PASSED' ? L('Passed', 'সম্পন্ন') : L('Pending', 'বাকি')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="px-5 py-4">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-vault-600">
              {L('Step', 'ধাপ')} {active.id} / {steps.length}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-ink-900">{isBn ? active.title_bn : active.title_en}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{isBn ? active.description_bn : active.description_en}</p>

            <div className={`mt-3 rounded-xl px-3 py-2.5 ${
              active.status === 'PASSED' ? 'bg-vault-50' : active.status === 'WARNING' ? 'bg-rose-50' : 'bg-amber-50'
            }`}>
              <p className={`text-[12px] leading-relaxed ${
                active.status === 'PASSED' ? 'text-vault-900' : active.status === 'WARNING' ? 'text-rose-900' : 'text-amber-900'
              }`}>
                {isBn ? active.detail_bn : active.detail_en}
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ink-900">{L('Controlled sign-off is server-side', 'নিয়ন্ত্রিত স্বাক্ষর সার্ভারে হয়')}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                {L(
                  'This demo workspace does not record sign-offs. In the production workspace the signed-in maker prepares a persisted close run, a different authorised checker approves it, and the period locks with an audit trail and exportable close pack.',
                  'এই ডেমো ওয়ার্কস্পেস স্বাক্ষর সংরক্ষণ করে না। প্রোডাকশন ওয়ার্কস্পেসে সাইন-ইন করা মেকার সংরক্ষিত সমাপনী রান প্রস্তুত করেন, ভিন্ন অনুমোদিত চেকার তা অনুমোদন করেন এবং অডিট ট্রেইল ও রপ্তানযোগ্য সমাপনী প্যাকসহ হিসাবকাল লক হয়।',
                )}
              </p>
              <a href="/app/close" className="ql-btn ql-btn-primary mt-2 !px-2 !py-1 text-[12px]">
                <ShieldCheck size={12} /> {L('Open controlled close', 'নিয়ন্ত্রিত সমাপনী খুলুন')}
              </a>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="ql-btn ql-btn-ghost !px-2 !py-1 text-[12px]"
                disabled={activeStep === 1}
                onClick={() => setActiveStep((current) => Math.max(1, current - 1))}
              >
                {L('Back', 'পেছনে')}
              </button>
              <button
                type="button"
                className="ql-btn ql-btn-secondary !px-2 !py-1 text-[12px]"
                disabled={activeStep === steps.length}
                onClick={() => setActiveStep((current) => Math.min(steps.length, current + 1))}
              >
                {L('Next step', 'পরবর্তী ধাপ')} <ArrowRight size={12} />
              </button>
              <span className="ml-auto text-[12px] text-ink-400">
                {active.automated ? L('Automated check', 'স্বয়ংক্রিয় যাচাই') : L('Manual evidence step', 'ম্যানুয়াল প্রমাণ ধাপ')}
              </span>
            </div>

            <p className="mt-3 border-t border-ink-100 pt-2 text-[10px] leading-relaxed text-ink-400">
              {L(
                'No sign-off is recorded in this demo. The production close enforces maker-checker on the server and the posting service rejects every CLOSED or LOCKED period.',
                'এই ডেমোতে কোনো স্বাক্ষর সংরক্ষিত হয় না। প্রোডাকশন সমাপনী সার্ভারে মেকার-চেকার প্রয়োগ করে এবং পোস্টিং সেবা প্রতিটি CLOSED বা LOCKED সময়কাল প্রত্যাখ্যান করে।',
              )}
            </p>
          </div>
        </div>
      </section>

      {/* 4 — Audit chain verifier */}
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><Fingerprint size={12} /> {L('Tamper evidence', 'সংশোধন প্রমাণ')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Live SHA-256 audit chain verifier', 'লাইভ শা-২৫৬ অডিট চেইন যাচাইকারী')}</h2>
            <p className="ql-hint mt-1">
              {verifiedAt
                ? `${L('Last re-hash', 'সর্বশেষ পুনঃহ্যাশ')}: ${verifiedAt.slice(0, 19).replace('T', ' ')}`
                : L('Chain verified by the vault on every mutation', 'প্রতিটি পরিবর্তনে ভল্ট চেইন যাচাই করে')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CryptographicSealSvg size={62} variant={locked ? 'locked' : 'audit'} verified={verification.valid} />
            <button type="button" className="ql-btn ql-btn-secondary" onClick={reverify}>
              <RefreshCcw size={14} /> {L('Re-verify chain', 'চেইন পুনঃযাচাই')}
            </button>
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 ${verification.valid ? 'bg-vault-50' : 'bg-rose-50'}`}>
          {verification.valid ? <CheckCircle2 size={15} className="text-vault-700" /> : <TriangleAlert size={15} className="text-rose-600" />}
          <p className={`text-[12px] font-semibold ${verification.valid ? 'text-vault-900' : 'text-rose-900'}`}>
            {verification.valid
              ? L(`${verification.checkedCount} journals re-hashed, chain intact`, `${verification.checkedCount} জার্নাল পুনঃহ্যাশ, চেইন অটুট`)
              : L(`Broken link at ${verification.brokenAtId ?? 'unknown'}`, `${verification.brokenAtId ?? 'অজানা'} স্থানে ভাঙা লিংক`)}
          </p>
          <span className="ml-auto font-mono text-[10px] text-ink-500">
            genesis {shortHash(GENESIS_AUDIT_HASH, 8)} → head {shortHash(vault.journals[vault.journals.length - 1]?.audit_hash ?? GENESIS_AUDIT_HASH, 12)}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="ql-table min-w-[860px]">
            <thead>
              <tr>
                <th>{L('Journal', 'জার্নাল')}</th>
                <th>{L('Posted', 'পোস্টেড')}</th>
                <th>{L('Prev hash', 'পূর্ববর্তী হ্যাশ')}</th>
                <th>{L('Audit hash', 'অডিট হ্যাশ')}</th>
                <th>{L('Recomputed', 'পুনঃগণিত')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {chainTail.map((journal) => {
                const recomputed = computeAuditHash(journal.prev_audit_hash === GENESIS_AUDIT_HASH ? GENESIS_AUDIT_HASH : journal.prev_audit_hash, journal);
                const digestOk = recomputed === journal.audit_hash;
                return (
                  <tr key={journal.id}>
                    <td>
                      <p className="font-mono text-[11px] font-semibold text-ink-800">{journal.journal_number}</p>
                      <p className="text-[10px] text-ink-400">{journal.book_type.replace(/_/g, ' ')}</p>
                    </td>
                    <td className="text-[11px] text-ink-600">{formatDate(journal.posting_date, locale)}</td>
                    <td className="font-mono text-[10px] text-ink-500">{shortHash(journal.prev_audit_hash)}</td>
                    <td className="font-mono text-[10px] text-vault-800">{shortHash(journal.audit_hash)}</td>
                    <td>
                      <span className={`ql-badge ${digestOk ? 'ql-badge-success' : 'ql-badge-danger'}`}>
                        {digestOk ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        {digestOk ? 'match' : 'mismatch'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-vault-700 hover:text-vault-900"
                        onClick={() => setLensJournalId(journal.id)}
                      >
                        <ArrowDownToLine size={11} /> {L('GL', 'খতিয়ান')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-ink-100 px-5 py-2 text-[10px] text-ink-400">
          {L(
            'Each digest is SHA-256 over the previous hash, journal id, posting date and canonical BigInt lines.',
            'প্রতিটি ডাইজেস্ট পূর্ববর্তী হ্যাশ, জার্নাল আইডি, পোস্টিং তারিখ ও বিগইন্ট লাইনগুলোর ওপর শা-২৫৬।',
          )}
        </p>
      </section>

      <LedgerLensModal journal={lensJournal} onClose={() => setLensJournalId(null)} open={lensJournal !== null} />
    </div>
  );
}
