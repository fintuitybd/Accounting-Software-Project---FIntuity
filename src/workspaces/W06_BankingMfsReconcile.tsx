// Fintuity Accounting Suite — W06 Banking, MFS & reconciliation.
//
// City Bank, BRAC Bank, bKash Merchant, Nagad Merchant and petty cash on one ledger. The workbench
// pairs imported statement lines with the exact GL journal (or the nearest invoice/bill), separates
// the 1.5% MFS settlement fee with BigInt poisha math, and posts the fee journal in one click.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Check,
  CircleDollarSign,
  Coins,
  CreditCard,
  Landmark,
  Layers,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wallet,
} from 'lucide-react';

import { WorkspaceHeader } from '../components/commercial/CommercialShared';
import { accountBalance } from '../core/ledger/ledgerEngine';
import { applyRateBps, formatDate, formatPercentBps } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { BankAccount, BankKind, BankStatementLine, JournalEntry } from '../core/types';

const FEE_BPS = 150;
type StatusFilter = 'ALL' | 'UNMATCHED' | 'MATCHED';

const ACCENT: Record<string, { card: string; icon: string; bar: string }> = {
  vault: { card: 'from-vault-50 via-white to-white border-vault-100', icon: 'bg-vault-100 text-vault-700', bar: 'bg-vault-500' },
  gold: { card: 'from-gold-50 via-white to-white border-gold-200', icon: 'bg-gold-100 text-gold-700', bar: 'bg-gold-500' },
  ink: { card: 'from-ink-50 via-white to-white border-ink-200', icon: 'bg-ink-100 text-ink-700', bar: 'bg-ink-500' },
};

function iconFor(kind: BankKind) {
  if (kind === 'MFS') return <Smartphone size={15} />;
  if (kind === 'CASH') return <Coins size={15} />;
  return <Building2 size={15} />;
}

const isMfs = (account: BankAccount): boolean => account.kind === 'MFS';

export default function W06_BankingMfsReconcile() {
  const { locale, money, bankAccounts, statementLines, journals, commercialDocs, reconcileBankLine, postManualJournal, publishToast } = useVault();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [activeAccount, setActiveAccount] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [postedFees, setPostedFees] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const accountOf = (code: string): BankAccount | undefined => bankAccounts.find((account) => account.account_code === code);

  const balances = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const account of bankAccounts) {
      const openingPosted = journals.some(
        (journal) => journal.source_module === 'OPENING_BALANCE' && journal.lines.some((line) => line.account_code === account.account_code),
      );
      map.set(account.account_code, accountBalance(journals, account.account_code) + (openingPosted ? 0n : account.opening_poisha));
    }
    return map;
  }, [bankAccounts, journals]);

  const unmatchedFor = (account: BankAccount): number =>
    statementLines.filter((line) => line.account_code === account.account_code && line.status === 'UNMATCHED').length;

  const visible = useMemo(
    () =>
      statementLines.filter((line) => {
        const accountOk = activeAccount === 'ALL' || line.account_code === activeAccount;
        const statusOk =
          statusFilter === 'ALL' ||
          (statusFilter === 'UNMATCHED' ? line.status === 'UNMATCHED' : line.status !== 'UNMATCHED');
        return accountOk && statusOk;
      }),
    [statementLines, activeAccount, statusFilter],
  );

  const amounts = (line: BankStatementLine): { gross: bigint; fee: bigint; net: bigint; mfs: boolean; rateBps: number } => {
    const gross = line.debit_poisha > 0n ? line.debit_poisha : line.credit_poisha;
    const account = accountOf(line.account_code);
    const mfs = Boolean(account && isMfs(account));
    const rateBps = mfs ? FEE_BPS : 0;
    const fee = line.fee_poisha > 0n ? line.fee_poisha : mfs ? applyRateBps(gross, FEE_BPS) : 0n;
    return { gross, fee, net: gross - fee, mfs, rateBps };
  };

  const selectedLine =
    visible.find((line) => line.id === selectedLineId) ??
    visible.find((line) => line.status === 'UNMATCHED') ??
    visible[0] ??
    null;

  const exactCandidates = (line: BankStatementLine | null): JournalEntry[] => {
    if (!line) return [];
    const amount = line.debit_poisha > 0n ? line.debit_poisha : line.credit_poisha;
    return journals
      .filter(
        (journal) =>
          journal.status !== 'REVERSED' &&
          journal.lines.some(
            (entry) =>
              entry.account_code === line.account_code &&
              (entry.debit_poisha === amount || entry.credit_poisha === amount),
          ),
      )
      .slice(-4)
      .reverse();
  };

  const nearestCandidates = (line: BankStatementLine | null): JournalEntry[] => {
    if (!line) return [];
    const amount = line.debit_poisha > 0n ? line.debit_poisha : line.credit_poisha;
    return journals
      .filter((journal) => journal.status !== 'REVERSED' && journal.lines.some((entry) => entry.account_code === line.account_code))
      .map((journal) => {
        const bankLine = journal.lines.find((entry) => entry.account_code === line.account_code);
        const journalAmount = bankLine ? bankLine.debit_poisha + bankLine.credit_poisha : 0n;
        const distance = journalAmount > amount ? journalAmount - amount : amount - journalAmount;
        return { journal, distance };
      })
      .sort((left, right) => (left.distance < right.distance ? -1 : left.distance > right.distance ? 1 : 0))
      .slice(0, 3)
      .map((entry) => entry.journal);
  };

  const documentCandidates = (line: BankStatementLine | null) => {
    if (!line) return [];
    const { gross, net } = amounts(line);
    return commercialDocs
      .filter((doc) => doc.status !== 'REVERSED' && (doc.gross_poisha === gross || doc.net_payable_poisha === gross || doc.net_payable_poisha === net))
      .slice(0, 3);
  };

  const exact = exactCandidates(selectedLine);
  const nearest = exact.length > 0 ? [] : nearestCandidates(selectedLine);
  const documents = documentCandidates(selectedLine);

  const counts = useMemo(
    () => ({
      unmatched: statementLines.filter((line) => line.status === 'UNMATCHED').length,
      matched: statementLines.filter((line) => line.status === 'MATCHED').length,
      categorized: statementLines.filter((line) => line.status === 'CATEGORIZED').length,
    }),
    [statementLines],
  );

  const feeControl = useMemo(
    () =>
      visible.reduce(
        (acc, line) => {
          const split = amounts(line);
          if (!split.mfs || line.debit_poisha <= 0n) return acc;
          return { gross: acc.gross + split.gross, fee: acc.fee + split.fee, net: acc.net + split.net, count: acc.count + 1 };
        },
        { gross: 0n, fee: 0n, net: 0n, count: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  const cashTotal = useMemo(
    () => bankAccounts.reduce((total, account) => total + (balances.get(account.account_code) ?? 0n), 0n),
    [bankAccounts, balances],
  );
  const maxBalance = useMemo(
    () =>
      bankAccounts.reduce(
        (max, account) => {
          const balance = balances.get(account.account_code) ?? 0n;
          return balance > max ? balance : max;
        },
        1n,
      ),
    [bankAccounts, balances],
  );

  const reconcile = (line: BankStatementLine, silent = false): boolean => {
    if (line.status === 'MATCHED') return true;
    const split = amounts(line);
    const feeAlreadyPosted = postedFees.includes(line.id);
    let feeJournal: JournalEntry | undefined;
    if (split.fee > 0n && !feeAlreadyPosted) {
      const feeResult = postManualJournal({
        date: line.date,
        narration_en: `MFS settlement fee ${formatPercentBps(split.rateBps, 'latin')} on ${line.reference} — net ${money(split.net)} credited.`,
        narration_bn: `${line.reference}-এ ${formatPercentBps(split.rateBps, 'latin')} এমএফএস নিষ্পত্তি ফি — নিট ${money(split.net)} জমা।`,
        source_module: 'BANK_MFS',
        lines: [
          {
            account_code: '5820',
            account_name_en: 'Bank charges & MFS settlement fees',
            account_name_bn: 'ব্যাংক চার্জ ও এমএফএস নিষ্পত্তি ফি',
            debit_poisha: split.fee,
            memo: `MFS settlement fee on ${line.reference}`,
          },
          {
            account_code: line.account_code,
            account_name_en: accountOf(line.account_code)?.name_en,
            account_name_bn: accountOf(line.account_code)?.name_bn,
            credit_poisha: split.fee,
            memo: 'Fee deducted from the settlement',
          },
        ],
      });
      if (feeResult.ok) {
        feeJournal = feeResult.data;
        setPostedFees((previous) => (previous.includes(line.id) ? previous : [...previous, line.id]));
      } else if (!silent) {
        setNote(feeResult.error ?? L('Fee journal rejected.', 'ফি খতিয়ান বাতিল হয়েছে।'));
        return false;
      }
    }
    const result = reconcileBankLine(line.id);
    if (!result.ok) {
      if (!silent) setNote(result.error ?? L('Reconciliation rejected.', 'মিলকরণ বাতিল হয়েছে।'));
      return false;
    }
    if (!silent) {
      setNote(
        L(
          `Matched ${line.reference} · ${money(split.net)} net · ${split.fee > 0n ? `fee ${money(split.fee)} posted as ${feeJournal?.journal_number ?? 'journal'}` : 'no fee split'}.`,
          `${line.reference} মিলেছে · নিট ${money(split.net)} · ${split.fee > 0n ? `ফি ${money(split.fee)} ${feeJournal?.journal_number ?? 'খতিয়ানে'} পোস্ট` : 'ফি বিভাজন নেই'}।`,
        ),
      );
    }
    return true;
  };

  const reconcileAllMatched = (): void => {
    const targets = visible.filter((line) => line.status === 'UNMATCHED' && exactCandidates(line).length > 0);
    if (targets.length === 0) {
      setNote(L('No unmatched statement line has an exact GL match in this view.', 'এই ভিউতে কোনো অমিলিত লাইনের হুবহু জিএল মিল নেই।'));
      return;
    }
    setBusy(true);
    let count = 0;
    for (const line of targets) {
      if (reconcile(line, true)) count += 1;
    }
    setBusy(false);
    setNote(L(`Reconciled ${count} matched statement line(s) and posted the MFS fee where applicable.`, `${count}টি মিলিত স্টেটমেন্ট লাইন মিলানো হয়েছে এবং প্রযোজ্য ক্ষেত্রে এমএফএস ফি পোস্ট হয়েছে।`));
    publishToast({ tone: 'success', title: L('Reconciliation batch complete', 'মিলকরণ ব্যাচ সম্পন্ন'), message: `${count} ${L('lines reconciled', 'লাইন মিলিত')}` });
  };

  const activeLabel = activeAccount === 'ALL' ? L('All accounts', 'সব হিসাব') : accountOf(activeAccount)?.name_en ?? L('Account', 'হিসাব');
  const selectedSplit = selectedLine ? amounts(selectedLine) : null;

  return (
    <>
      <WorkspaceHeader
        icon={<Landmark size={19} />}
        kickerEn="Workspace 06 · Treasury ops"
        kickerBn="ওয়ার্কস্পেস ০৬ · কোষাগার পরিচালনা"
        titleEn="Banking, MFS & statement reconciliation"
        titleBn="ব্যাংকিং, এমএফএস ও স্টেটমেন্ট মিলকরণ"
        isBn={isBn}
        chips={
          <>
            <span className="ql-badge ql-badge-warn"><Coins size={12} /> {L('Synthetic demo · fee rate is not a policy', 'কৃত্রিম ডেমো · ফি হার কোনো নীতি নয়')}</span>
            <span className={`ql-badge ${counts.unmatched ? 'ql-badge-danger' : 'ql-badge-success'}`}>
              {counts.unmatched ? <TriangleAlert size={12} /> : <ShieldCheck size={12} />} {counts.unmatched} {L('unmatched', 'অমিলিত')}
            </span>
          </>
        }
      />

      <main className="space-y-5">
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {L(
            'This workspace is synthetic demo data. It does not import a real statement, does not prove tenant reconciliation and the 1.5% fee shown here is only a demo assumption. Use the server-backed Banking page for imported statements, approved GL creation, configured fees and reviewed sign-off.',
            'এই ওয়ার্কস্পেস কৃত্রিম ডেমো ডেটা। এটি প্রকৃত স্টেটমেন্ট আমদানি করে না, টেন্যান্ট মিলকরণ প্রমাণ করে না এবং এখানে দেখানো ১.৫% ফি কেবল ডেমো অনুমান। প্রকৃত স্টেটমেন্ট আমদানি, অনুমোদিত জিএল তৈরি, কনফিগার করা ফি ও পর্যালোচিত স্বাক্ষরের জন্য সার্ভার-ভিত্তিক ব্যাংকিং পৃষ্ঠা ব্যবহার করুন।',
          )}
        </div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {bankAccounts.map((account) => {
            const accent = ACCENT[account.accent] ?? ACCENT.vault;
            const unmatched = unmatchedFor(account);
            const active = activeAccount === account.account_code;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => { setActiveAccount(active ? 'ALL' : account.account_code); setSelectedLineId(null); }}
                className={`ql-card group relative overflow-hidden border bg-gradient-to-br p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift ${accent.card} ${active ? 'ring-2 ring-vault-400' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${accent.icon}`}>{iconFor(account.kind)}</span>
                  <span className="ql-badge ql-badge-neutral">{account.kind}</span>
                </div>
                <p className="mt-2 truncate text-[11px] font-semibold text-ink-900">{isBn ? account.name_bn : account.name_en}</p>
                <p className="font-mono text-[9px] text-ink-400">{account.provider} · {account.masked_number}</p>
                <p className="font-money mt-1.5 text-[15px] font-semibold text-ink-900">{money(balances.get(account.account_code) ?? account.opening_poisha)}</p>
                <div className="mt-1 flex items-center justify-between gap-1">
                  {unmatched > 0 ? (
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-rose-600"><TriangleAlert size={9} /> {unmatched} {L('to match', 'মেলাতে হবে')}</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-700"><Check size={9} /> {L('Cleared', 'মিলিত')}</span>
                  )}
                  <span className="text-[9px] text-ink-400">{account.branch}</span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.min(100, Math.max(4, Number(((balances.get(account.account_code) ?? 0n) * 100n) / maxBalance)))}%` }} />
                </div>
              </button>
            );
          })}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="ql-card ql-card-pad">
            <p className="ql-kicker">{L('Total cash & bank', 'মোট নগদ ও ব্যাংক')}</p>
            <p className="font-money mt-2 text-lg font-semibold text-ink-900">{money(cashTotal)}</p>
          </article>
          <article className="ql-card ql-card-pad">
            <p className="ql-kicker">{L('Reconciled', 'মিলিত')}</p>
            <p className="font-money mt-2 text-lg font-semibold text-emerald-700">{counts.matched}</p>
            <p className="text-[9.5px] text-ink-400">{statementLines.length ? `${Math.round((counts.matched / statementLines.length) * 100)}%` : '0%'} {L('of statement lines', 'স্টেটমেন্ট লাইন')}</p>
          </article>
          <article className="ql-card ql-card-pad">
            <p className="ql-kicker">{L('MFS fees in view', 'ভিউতে এমএফএস ফি')}</p>
            <p className="font-money mt-2 text-lg font-semibold text-rose-600">{money(feeControl.fee)}</p>
            <p className="text-[9.5px] text-ink-400">{feeControl.count} {L('settlements at 1.5%', 'নিষ্পত্তি ১.৫% হারে')}</p>
          </article>
          <article className="ql-card ql-card-pad">
            <p className="ql-kicker">{L('Categorised for review', 'পর্যালোচনার জন্য শ্রেণিবদ্ধ')}</p>
            <p className="font-money mt-2 text-lg font-semibold text-amber-600">{counts.categorized}</p>
          </article>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ql-seg">
            {(['ALL', 'UNMATCHED', 'MATCHED'] as StatusFilter[]).map((value) => (
              <button key={value} type="button" className="ql-seg-item" data-active={statusFilter === value} onClick={() => setStatusFilter(value)}>
                {value === 'ALL' ? L('All', 'সব') : value === 'UNMATCHED' ? L('Unmatched', 'অমিলিত') : L('Matched', 'মিলিত')}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-ink-400">{activeLabel} · {visible.length} {L('lines', 'লাইন')}</span>
            <button type="button" className="ql-btn ql-btn-primary !py-1.5" onClick={reconcileAllMatched} disabled={busy}>
              <RefreshCw size={13} /> {busy ? L('Reconciling…', 'মিলছে…') : L('Reconcile all matched', 'সব মিলিত মেলান')} ({visible.filter((line) => line.status === 'UNMATCHED' && exactCandidates(line).length > 0).length})
            </button>
          </div>
        </div>

        {note ? (
          <div className="flex items-start gap-2 rounded-xl border border-vault-200 bg-vault-50 px-3 py-2 text-[10.5px] text-vault-800">
            <BadgeCheck size={13} className="mt-0.5 shrink-0" /> {note}
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          {/* Left: statement lines */}
          <section className="ql-card overflow-hidden">
            <div className="ql-card-header">
              <div>
                <p className="ql-kicker flex items-center gap-1.5"><ScanLine size={12} /> {L('Imported statement lines', 'আমদানি করা স্টেটমেন্ট লাইন')}</p>
                <h2 className="mt-1 text-base font-semibold text-ink-900">{activeLabel}</h2>
              </div>
              <span className="ql-badge ql-badge-neutral">{visible.length} {L('lines', 'লাইন')}</span>
            </div>
            <div className="max-h-[640px] overflow-auto">
              <table className="ql-table min-w-[660px]">
                <thead>
                  <tr>
                    <th>{L('Date', 'তারিখ')}</th>
                    <th>{L('Description', 'বিবরণ')}</th>
                    <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                    <th className="text-right">{L('Fee / net', 'ফি / নিট')}</th>
                    <th>{L('Status', 'অবস্থা')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((line) => {
                    const split = amounts(line);
                    const active = selectedLine?.id === line.id;
                    return (
                      <tr
                        key={line.id}
                        onClick={() => setSelectedLineId(line.id)}
                        className={`cursor-pointer ${active ? 'bg-vault-50/80 ring-1 ring-inset ring-vault-200' : ''}`}
                      >
                        <td className="whitespace-nowrap text-[10px]">{formatDate(line.date, locale)}</td>
                        <td>
                          <p className="max-w-[240px] truncate text-[10.5px] font-medium text-ink-800">{line.description}</p>
                          <p className="font-mono text-[9px] text-ink-400">
                            {line.reference}{line.matched_doc_ref ? ` → ${line.matched_doc_ref}` : ''}
                          </p>
                        </td>
                        <td className="font-money text-right text-[10.5px] font-semibold text-ink-900">
                          {line.debit_poisha > 0n ? '+' : '−'}{money(line.debit_poisha > 0n ? line.debit_poisha : line.credit_poisha, { symbol: false })}
                        </td>
                        <td className="text-right text-[9px]">
                          {split.fee > 0n ? (
                            <span className="block">
                              <span className="text-rose-600">−{money(split.fee, { symbol: false })}</span>
                              <span className="block font-money text-vault-700">{money(split.net, { symbol: false })}</span>
                            </span>
                          ) : <span className="text-ink-300">—</span>}
                        </td>
                        <td>
                          <span className={`ql-badge ${line.status === 'MATCHED' ? 'ql-badge-success' : line.status === 'CATEGORIZED' ? 'ql-badge-warn' : 'ql-badge-danger'}`}>{line.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 ? (
                    <tr><td colSpan={5} className="py-10 text-center text-xs text-ink-400">{L('No statement lines in this view.', 'এই ভিউতে কোনো স্টেটমেন্ট লাইন নেই।')}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-[9.5px] text-ink-500">
              <span className="flex items-center gap-1.5"><Smartphone size={11} /> {L('Demo assumption: the 1.50% rate is not a configured policy. Production fees come from an account rule or an evidence-backed override.', 'ডেমো অনুমান: ১.৫০% হার কোনো কনফিগার করা নীতি নয়। প্রকৃত ফি হিসাব-ভিত্তিক নিয়ম বা প্রমাণসম্মত ওভাররাইড থেকে আসে।')}</span>
              <span>{L('Click a line to open the workbench', 'ওয়ার্কবেঞ্চ খুলতে লাইনে ক্লিক করুন')} <ArrowRight size={10} className="inline" /></span>
            </div>
          </section>

          {/* Right: reconciliation workbench */}
          <section className="ql-card overflow-hidden xl:sticky xl:top-24 xl:self-start">
            <div className="border-b border-ink-100 bg-gradient-to-r from-ink-900 via-vault-950 to-vault-900 px-4 py-3 text-white">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-vault-200">{L('Reconciliation workbench', 'মিলকরণ ওয়ার্কবেঞ্চ')}</p>
              <h2 className="mt-0.5 text-sm font-semibold">{L('Statement line ↔ GL entry', 'স্টেটমেন্ট লাইন ↔ জিএল এন্ট্রি')}</h2>
            </div>

            {!selectedLine || !selectedSplit ? (
              <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
                <Wallet size={26} className="text-ink-300" />
                <p className="text-xs font-semibold text-ink-600">{L('Select a statement line', 'একটি স্টেটমেন্ট লাইন নির্বাচন করুন')}</p>
                <p className="max-w-xs text-[10px] text-ink-400">{L('The workbench shows the exact GL journal, or the nearest invoice/bill candidate.', 'ওয়ার্কবেঞ্চ হুবহু জিএল খতিয়ান বা নিকটতম চালান/বিল দেখায়।')}</p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[10.5px] font-semibold text-ink-800">{selectedLine.description}</p>
                      <p className="font-mono text-[9px] text-ink-400">{selectedLine.reference} · {formatDate(selectedLine.date, locale)}</p>
                    </div>
                    <span className={`ql-badge ${selectedLine.status === 'MATCHED' ? 'ql-badge-success' : selectedLine.status === 'CATEGORIZED' ? 'ql-badge-warn' : 'ql-badge-danger'}`}>{selectedLine.status}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white px-2 py-1 ring-1 ring-ink-100">
                      <p className="text-[8px] uppercase tracking-[0.1em] text-ink-400">{L('Gross', 'মোট')}</p>
                      <p className="font-money text-[11px] font-semibold text-ink-900">{money(selectedSplit.gross)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-1 ring-1 ring-ink-100">
                      <p className="text-[8px] uppercase tracking-[0.1em] text-ink-400">{L('Fee', 'ফি')}</p>
                      <p className="font-money text-[11px] font-semibold text-rose-600">−{money(selectedSplit.fee, { symbol: false })}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-1 ring-1 ring-ink-100">
                      <p className="text-[8px] uppercase tracking-[0.1em] text-ink-400">{L('Net', 'নিট')}</p>
                      <p className="font-money text-[11px] font-semibold text-emerald-700">{money(selectedSplit.net)}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="ql-kicker flex items-center gap-1.5"><ArrowRightLeft size={11} /> {L('GL candidates', 'জিএল প্রার্থী')}</p>
                    <span className="text-[9px] text-ink-400">{exact.length ? L('exact amount match', 'হুবহু অঙ্ক মিল') : L('nearest entries', 'নিকটতম এন্ট্রি')}</span>
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {(exact.length ? exact : nearest).map((journal, index) => {
                      const bankLine = journal.lines.find((entry) => entry.account_code === selectedLine.account_code);
                      return (
                        <div key={journal.id} className={`rounded-xl border px-2.5 py-2 ${index === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-ink-100 bg-white'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-mono text-[10px] font-semibold text-ink-900">{journal.journal_number}</p>
                            <span className={`ql-badge ${index === 0 ? 'ql-badge-success' : 'ql-badge-neutral'}`}>{index === 0 ? L('Best match', 'সেরা মিল') : L('Nearby', 'নিকটবর্তী')}</span>
                          </div>
                          <p className="mt-0.5 truncate text-[9.5px] text-ink-500">{isBn ? journal.narration_bn : journal.narration_en}</p>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-ink-400">
                            <span className="font-mono">{journal.posting_date} · {journal.source_doc_ref ?? journal.source_module}</span>
                            <span className="font-money font-semibold text-ink-800">{money(bankLine ? bankLine.debit_poisha + bankLine.credit_poisha : 0n)}</span>
                          </div>
                        </div>
                      );
                    })}
                    {exact.length === 0 && nearest.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-ink-200 px-2.5 py-3 text-[10px] text-ink-400">{L('No GL entry touches this account yet. The line will be categorised for review.', 'এই হিসাবে এখনো কোনো জিএল এন্ট্রি নেই। লাইনটি পর্যালোচনার জন্য শ্রেণিবদ্ধ হবে।')}</p>
                    ) : null}
                  </div>
                </div>

                {documents.length > 0 ? (
                  <div>
                    <p className="ql-kicker flex items-center gap-1.5"><CreditCard size={11} /> {L('Invoice / bill candidates', 'চালান / বিল প্রার্থী')}</p>
                    <div className="mt-1.5 space-y-1">
                      {documents.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 bg-white px-2.5 py-1.5">
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-semibold text-ink-800">{doc.doc_number} · {doc.party_name_en}</p>
                            <p className="text-[8.5px] text-ink-400">{doc.doc_type.replaceAll('_', ' ')} · {formatDate(doc.doc_date, locale)}</p>
                          </div>
                          <span className="font-money shrink-0 text-[10px] font-semibold text-ink-900">{money(doc.gross_poisha)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-2.5">
                  <p className="ql-kicker flex items-center gap-1.5"><CircleDollarSign size={11} /> {L('Fee journal preview', 'ফি খতিয়ান প্রাকদর্শন')}</p>
                  <p className="mt-1 flex items-center justify-between gap-2 font-mono text-[9.5px] text-ink-600">
                    <span>Dr 5820 · {L('Finance cost', 'অর্থ ব্যয়')}</span>
                    <span className="font-money">{money(selectedSplit.fee, { symbol: false })}</span>
                  </p>
                  <p className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-ink-600">
                    <span>Cr {selectedLine.account_code} · {accountOf(selectedLine.account_code)?.name_en ?? 'Bank'}</span>
                    <span className="font-money">{money(selectedSplit.fee, { symbol: false })}</span>
                  </p>
                  {postedFees.includes(selectedLine.id) ? (
                    <p className="mt-1 flex items-center gap-1 text-[9px] font-semibold text-emerald-700"><Check size={10} /> {L('Fee already posted for this line', 'এই লাইনের ফি ইতিমধ্যে পোস্ট হয়েছে')}</p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => { setBusy(true); reconcile(selectedLine); setBusy(false); }}
                  disabled={selectedLine.status === 'MATCHED' || busy}
                  className="ql-btn ql-btn-primary w-full"
                >
                  <ArrowRightLeft size={14} />
                  {selectedLine.status === 'MATCHED' ? L('Reconciled', 'মিলিত') : selectedSplit.fee > 0n ? L('Reconcile & post fee', 'মিলান ও ফি পোস্ট করুন') : L('Reconcile line', 'লাইন মিলান')}
                </button>
                <p className="text-center text-[8.5px] leading-relaxed text-ink-400">
                  {L('Matching never creates cash. The fee journal is the only posting, and it is hashed into the same chain.', 'মিলকরণ কখনো নগদ তৈরি করে না। কেবল ফি খতিয়ান পোস্ট হয়, যা একই চেইনে হ্যাশ হয়।')}
                </p>
              </div>
            )}
          </section>
        </div>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="ql-card ql-card-pad">
            <div className="flex items-center justify-between gap-2">
              <p className="ql-kicker flex items-center gap-1.5"><CircleDollarSign size={12} /> {L('MFS fee control', 'এমএফএস ফি নিয়ন্ত্রণ')}</p>
              <span className="ql-badge ql-badge-warn">1.50%</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-ink-50 p-3">
                <p className="text-[8.5px] uppercase tracking-[0.1em] text-ink-400">{L('Gross settlement', 'মোট নিষ্পত্তি')}</p>
                <p className="font-money mt-1 text-sm font-semibold text-ink-900">{money(feeControl.gross)}</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 ring-1 ring-inset ring-rose-100">
                <p className="text-[8.5px] uppercase tracking-[0.1em] text-rose-500">{L('Fee @ 1.50%', 'ফি @ ১.৫০%')}</p>
                <p className="font-money mt-1 text-sm font-semibold text-rose-600">−{money(feeControl.fee, { symbol: false })}</p>
              </div>
              <div className="rounded-xl bg-vault-50 p-3 ring-1 ring-inset ring-vault-200">
                <p className="text-[8.5px] uppercase tracking-[0.1em] text-vault-600">{L('Net to bank', 'ব্যাংকে নিট')}</p>
                <p className="font-money mt-1 text-sm font-semibold text-vault-800">{money(feeControl.net)}</p>
              </div>
            </div>
            <p className="ql-hint mt-3">{L('Fee is separated on every MFS settlement line before matching; posted fees are sealed as a Dr 5820 / Cr MFS journal.', 'মিলকরণের আগে প্রতিটি এমএফএস নিষ্পত্তি লাইনে ফি বিভক্ত হয়; পোস্টেড ফি ডেবিট ৫৮২০ / ক্রেডিট এমএফএস খতিয়ান হিসেবে সিল হয়।')}</p>
          </div>

          <div className="ql-card ql-card-pad">
            <p className="ql-kicker flex items-center gap-1.5"><Wallet size={12} /> {L('Reconciliation status', 'মিলকরণ অবস্থা')}</p>
            <div className="mt-3 space-y-2">
              {[
                { label: L('Matched', 'মিলিত'), value: counts.matched, tone: 'bg-vault-100 text-vault-800' },
                { label: L('Categorised for review', 'পর্যালোচনার জন্য শ্রেণিবদ্ধ'), value: counts.categorized, tone: 'bg-gold-100 text-gold-700' },
                { label: L('Unmatched', 'অমিলিত'), value: counts.unmatched, tone: 'bg-rose-50 text-rose-700' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2.5 py-2">
                  <span className="flex items-center gap-1.5 text-[10px] text-ink-700"><span className={`ql-badge ${row.tone}`}>{row.value}</span>{row.label}</span>
                  <span className="text-[9px] text-ink-400">{statementLines.length ? `${Math.round((row.value / statementLines.length) * 100)}%` : '0%'}</span>
                </div>
              ))}
            </div>
            <button type="button" className="ql-btn ql-btn-secondary mt-3 w-full" onClick={() => publishToast({ tone: 'info', title: L('Statement import ready', 'স্টেটমেন্ট আমদানি প্রস্তুত'), message: L('Import the next bank statement from the import studio.', 'ইমপোর্ট স্টুডিও থেকে পরবর্তী স্টেটমেন্ট আমদানি করুন।') })}>
              <Layers size={14} /> {L('Import next statement', 'পরবর্তী স্টেটমেন্ট আমদানি')}
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
