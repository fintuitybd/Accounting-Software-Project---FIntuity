// LedgerVault — Signature component #1: the live pre-save Tax Advisor.
//
// Rendered before a commercial document is committed. It is pure and read-only: the parent passes
// the exact `TaxEvaluationInput`, the deterministic engine returns a `TaxDecision`, and this card
// turns that decision into four layers:
//
//   1. An animated proportional tax waterfall (Framer Motion `layout` springs) splitting the gross
//      into net consideration, VAT, VDS and TDS.
//   2. A poisha-accurate money split and statutory provenance grid.
//   3. Live counterparty / s.46 guardrails with status pills and the automatic +50% TDS upscale.
//   4. An "Explain this calculation" drawer naming the rule id, instrument, clause [VERIFY], formula
//      and the rule pack version that produced every number.
//
// The card never posts. W02 and W03 own the commit.

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Coins,
  FileCheck2,
  Gavel,
  Hash,
  Landmark,
  Lock,
  Percent,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';

import { useVault } from '../../context/VaultContext';
import type { InputCreditOutcome, TaxCondition, TaxDecision, TaxEvaluationInput } from '../../core/types';
import {
  evaluateTaxDecision,
  isValidBin,
  isValidTin,
  previewTaxJournal,
} from '../../core/tax-engine/engine';
import {
  RULE_IDS,
  TDS_RULE_ID_BY_NATURE,
  VAT_RULE_ID_BY_CATEGORY,
  getRule,
} from '../../core/tax-engine/rulePack';
import { formatPercentBps } from '../../core/money';

const ABS = (value: bigint): bigint => (value < 0n ? -value : value);

function shareOf(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((ABS(part) * 10000n) / ABS(total)) / 100;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function ruleCode(ruleId?: string | null): string {
  return ruleId ?? '—';
}

const DIRECTION_COPY = {
  SALE: { en: 'Sales invoice', bn: 'বিক্রয় চালান' },
  PURCHASE: { en: 'Purchase bill', bn: 'ক্রয় বিল' },
} as const;

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

export interface TaxAdvisorCardProps {
  /** The exact evaluation input the form is about to commit. */
  input: TaxEvaluationInput;
  /** Optional pre-computed decision (the engine result the form will post with). */
  decision?: TaxDecision | null;
  titleEn?: string;
  titleBn?: string;
  className?: string;
  compact?: boolean;
  defaultExplainOpen?: boolean;
  showJournalPreview?: boolean;
  /** Controlled missing-TIN simulation. When supplied the +50% upscale toggle is interactive. */
  tinOverride?: boolean;
  onTinOverrideChange?: (missing: boolean) => void;
  footer?: ReactNode;
}

interface CalculationRow {
  key: string;
  labelEn: string;
  labelBn: string;
  amount: bigint;
  formula: string;
  ruleId: string;
  tone: 'emerald' | 'indigo' | 'violet' | 'amber' | 'ink';
}

export function TaxAdvisorCard({
  input,
  decision: decisionProp,
  titleEn,
  titleBn,
  className = '',
  compact = false,
  defaultExplainOpen = false,
  showJournalPreview = false,
  tinOverride,
  onTinOverrideChange,
  footer,
}: TaxAdvisorCardProps) {
  const vault = useVault();
  const { money, locale, numeralScript, tenant } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [explainOpen, setExplainOpen] = useState(defaultExplainOpen);
  const [journalOpen, setJournalOpen] = useState(showJournalPreview);
  const [previewPenalty, setPreviewPenalty] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const signature = [
    input.direction,
    input.base_poisha.toString(),
    input.tax_category,
    input.party_name,
    input.party_bin ?? '',
    input.party_tin ?? '',
    input.is_withholding_entity ? '1' : '0',
    input.vds_applicable ? '1' : '0',
    input.vds_rate_bps ?? 0,
    input.tds_nature,
    input.payment_method,
    input.has_valid_mushak63 ? '1' : '0',
    input.is_reverse_charge ? '1' : '0',
    input.has_reverse_charge_challan ? '1' : '0',
    input.sd_applicable ? '1' : '0',
    input.is_credit_note ? '1' : '0',
    input.is_government_or_bank ? '1' : '0',
  ].join('|');

  const decision = useMemo(
    () => decisionProp ?? evaluateTaxDecision(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, decisionProp],
  );

  const journal = useMemo(
    () => previewTaxJournal(input, decision),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, decision],
  );

  const gross = ABS(decision.gross_poisha);
  const net = ABS(decision.net_payable_poisha);
  const vat = ABS(decision.vat_poisha);
  const vds = ABS(decision.vds_poisha);
  const tds = ABS(decision.tds_poisha);
  const sd = ABS(decision.sd_poisha);
  const base = ABS(decision.base_poisha);
  const treasury = ABS(decision.treasury_payable_poisha);
  const claimable = ABS(decision.input_credit.claimable_poisha);
  const disallowed = ABS(decision.input_credit.disallowed_poisha);

  // Gross decomposes exactly as: net consideration (ex-VAT) + VAT + VDS + TDS. The emerald slice is
  // the commercial consideration after withholding but before VAT, which keeps the four slices
  // additive to the gross while the separate "Net cash to party" row shows the real bank movement.
  const netConsideration = gross > vat + vds + tds ? gross - vat - vds - tds : net > vat ? net - vat : 0n;

  const segments = [
    {
      key: 'net',
      labelEn: 'Net consideration',
      labelBn: 'নিট প্রতিদান',
      noteEn: 'value to the counterparty, before VAT',
      noteBn: 'পক্ষের প্রাপ্য, ভ্যাটের পূর্বে',
      amount: netConsideration,
      pct: shareOf(netConsideration, gross),
      bar: 'bg-gradient-to-r from-emerald-600 to-emerald-400',
      dot: 'bg-emerald-500',
      text: 'text-emerald-700',
      chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    },
    {
      key: 'vat',
      labelEn: 'VAT',
      labelBn: 'ভ্যাট',
      noteEn: 'output tax remitted with Mushak 9.1',
      noteBn: 'মূসক ৯.১-এর সঙ্গে প্রদেয় আউটপুট কর',
      amount: vat,
      pct: shareOf(vat, gross),
      bar: 'bg-gradient-to-r from-indigo-600 to-indigo-400',
      dot: 'bg-indigo-500',
      text: 'text-indigo-700',
      chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    },
    {
      key: 'vds',
      labelEn: 'VDS withheld',
      labelBn: 'ভিডিএস কর্তন',
      noteEn: 'deposited through the Mushak 6.6 challan',
      noteBn: 'মূসক ৬.৬ চালানে জমা',
      amount: vds,
      pct: shareOf(vds, gross),
      bar: 'bg-gradient-to-r from-violet-600 to-violet-400',
      dot: 'bg-violet-500',
      text: 'text-violet-700',
      chip: 'bg-violet-50 text-violet-700 ring-violet-200',
    },
    {
      key: 'tds',
      labelEn: 'TDS withheld',
      labelBn: 'টিডিএস কর্তন',
      noteEn: 'income-tax deduction under s.89–109',
      noteBn: 'ধারা ৮৯–১০৯ অনুযায়ী আয়কর কর্তন',
      amount: tds,
      pct: shareOf(tds, gross),
      bar: 'bg-gradient-to-r from-amber-500 to-amber-400',
      dot: 'bg-amber-500',
      text: 'text-amber-700',
      chip: 'bg-amber-50 text-amber-700 ring-amber-200',
    },
  ];

  const visibleSegments = segments.filter((segment) => segment.amount > 0n);
  const selectedSegment = segments.find((segment) => segment.key === hovered) ?? null;

  const binValid = isValidBin(input.party_bin);
  const tinValid = isValidTin(input.party_tin);
  const tinMissing = tinOverride === undefined ? !tinValid : tinOverride || !tinValid;
  const cashLimit = tenant.accounting_policies.cash_disallowance_limit_poisha;
  const cashOverLimit = base > cashLimit;
  const cashRisk =
    input.direction === 'PURCHASE' && input.payment_method === 'CASH' && cashOverLimit;
  const tdsPenalised = tinMissing && tds > 0n;
  const tdsPenaltyDelta = tdsPenalised ? (tds * 50n) / 150n : 0n;
  const mushakOk = input.is_reverse_charge ? Boolean(input.has_reverse_charge_challan) : input.has_valid_mushak63;

  const previewDecision = useMemo(
    () =>
      evaluateTaxDecision({
        ...input,
        party_tin: undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const previewUpscale = ABS(previewDecision.tds_poisha);
  const previewDelta = previewUpscale > tds ? previewUpscale - tds : 0n;
  const showPreview = !tinMissing && previewPenalty && previewDelta > 0n;

  const toggleTinPenalty = (): void => {
    if (onTinOverrideChange) {
      onTinOverrideChange(!tinMissing);
      return;
    }
    if (!tinValid) return;
    setPreviewPenalty((value) => !value);
  };

  const vatRuleId = input.is_reverse_charge || input.tax_category === 'REVERSE_CHARGE'
    ? RULE_IDS.VAT_REVERSE_CHARGE_S20
    : VAT_RULE_ID_BY_CATEGORY[input.tax_category];
  const tdsRuleId = TDS_RULE_ID_BY_NATURE[input.tds_nature];

  const calculationRows: CalculationRow[] = [
    {
      key: 'base',
      labelEn: 'Taxable base',
      labelBn: 'করযোগ্য ভিত্তি',
      amount: base,
      formula: `Σ (quantity × unit price) = ${money(base, { symbol: false })}`,
      ruleId: 'DOCUMENT_FACTS',
      tone: 'ink',
    },
    {
      key: 'sd',
      labelEn: 'Supplementary duty',
      labelBn: 'সম্পূরক শুল্ক',
      amount: sd,
      formula: `${money(base, { symbol: false })} × 20.00% = ${money(sd, { symbol: false })}`,
      ruleId: RULE_IDS.SD_SECOND_SCHEDULE_STD,
      tone: 'indigo',
    },
    {
      key: 'vat',
      labelEn: 'VAT',
      labelBn: 'ভ্যাট',
      amount: vat,
      formula: input.is_reverse_charge
        ? `${money(base, { symbol: false })} × 15.00% (self-assessed) = ${money(vat, { symbol: false })}`
        : `(${money(base, { symbol: false })} + SD ${money(sd, { symbol: false })}) × ${formatPercentBps(decision.vat_bps, 'latin')} = ${money(vat, { symbol: false })}`,
      ruleId: ruleCode(vatRuleId),
      tone: 'indigo',
    },
    {
      key: 'vds',
      labelEn: 'VDS deducted at source',
      labelBn: 'উৎসে কর্তিত ভিডিএস',
      amount: vds,
      formula: `Base ${money(base, { symbol: false })} × ${formatPercentBps(decision.vds_bps, 'latin')} = ${money(vds, { symbol: false })}`,
      ruleId: RULE_IDS.VDS_WITHHOLDING_S49,
      tone: 'violet',
    },
    {
      key: 'tds',
      labelEn: 'TDS deducted at source',
      labelBn: 'উৎসে কর্তিত টিডিএস',
      amount: tds,
      formula: `${money(base, { symbol: false })} × ${formatPercentBps(decision.tds_bps, 'latin')}${tdsPenalised ? ' (includes +50% no-TIN upscale)' : ''} = ${money(tds, { symbol: false })}`,
      ruleId: ruleCode(tdsRuleId),
      tone: 'amber',
    },
    {
      key: 'net',
      labelEn: 'Net cash to the counterparty',
      labelBn: 'পক্ষের নিট নগদ',
      amount: net,
      formula: `Gross ${money(gross, { symbol: false })} − VDS ${money(vds, { symbol: false })} − TDS ${money(tds, { symbol: false })} = ${money(net, { symbol: false })}`,
      ruleId: 'SETTLEMENT_NETTING',
      tone: 'emerald',
    },
    {
      key: 'treasury',
      labelEn: 'Total payable to NBR treasury',
      labelBn: 'এনবিআর কোষাগারে মোট প্রদেয়',
      amount: treasury,
      formula: `VAT + SD + VDS + TDS = ${money(treasury, { symbol: false })}`,
      ruleId: RULE_IDS.VDS_CERTIFICATE_MUSHAK_66,
      tone: 'ink',
    },
  ];

  const activeRuleIds = Array.from(
    new Set([...decision.rule_ids, ...calculationRows.map((row) => row.ruleId)]),
  ).filter((id) => id !== 'DOCUMENT_FACTS' && id !== 'SETTLEMENT_NETTING');
  const filing = decision.filing;

  return (
    <section
      className={`lv-card overflow-hidden ${compact ? 'text-[12px]' : ''} ${className}`}
      aria-label={L('Tax advisor', 'কর উপদেষ্টা')}
    >
      {/* ---------------------------------------------------------------------------------- */}
      {/* Header                                                                              */}
      {/* ---------------------------------------------------------------------------------- */}
      <header className="relative overflow-hidden border-b border-ink-100 bg-gradient-to-br from-vault-950 via-vault-900 to-vault-800 px-5 py-4 text-white">
        <div className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-gold-400/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
              <Scale size={18} strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-vault-200">
                {L('Live pre-save tax advisor', 'সংরক্ষণের পূর্বে লাইভ কর উপদেষ্টা')}
              </p>
              <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-white">
                {isBn ? titleBn ?? 'কর নির্ধারণ ও যাচাই' : titleEn ?? 'Tax determination & validation'}
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-vault-200">
                <span className="font-semibold text-gold-200">
                  {isBn ? DIRECTION_COPY[input.direction].bn : DIRECTION_COPY[input.direction].en}
                </span>
                <span aria-hidden>·</span>
                <span>{input.tax_category.replaceAll('_', ' ')}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-mono">
                  <Hash size={10} /> {decision.trace_id.slice(0, 14)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <DecisionChip state={decision.decision} isBn={isBn} />
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-vault-100 ring-1 ring-inset ring-white/20">
              <Lock size={9} /> {decision.rule_pack_version}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-vault-100 ring-1 ring-inset ring-white/20">
              {input.payment_method.replaceAll('_', ' ')}
            </span>
          </div>
        </div>
      </header>

      {gross === 0n ? (
        <div className="flex items-start gap-3 px-5 py-10">
          <Calculator className="mt-0.5 shrink-0 text-ink-400" size={18} />
          <div>
            <p className="text-sm font-semibold text-ink-800">
              {L('Enter a value to see the tax breakdown', 'কর বিভাজন দেখতে একটি মূল্য লিখুন')}
            </p>
            <p className="lv-hint mt-1">
              {L(
                'The engine splits the gross into net consideration, VAT, VDS and TDS the moment a taxable value exists.',
                'করণীয় মূল্য পাওয়া মাত্র ইঞ্জিন গ্রসকে নিট প্রতিদান, ভ্যাট, ভিডিএস ও টিডিএস-এ ভাগ করবে।',
              )}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------------------------------ */}
          {/* Animated tax waterfall                                                          */}
          {/* ------------------------------------------------------------------------------ */}
          <div className={`border-b border-ink-100 ${compact ? 'px-4 py-4' : 'px-5 py-5'}`}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="lv-kicker flex items-center gap-1.5">
                  <Sparkles size={11} className="text-violet-500" /> {L('Tax waterfall', 'কর জলপ্রপাত')}
                </p>
                <h4 className="text-sm font-semibold tracking-tight text-ink-900">
                  {L('Where every Taka of the gross invoice lands', 'মোট চালানের প্রতিটি টাকা কোথায় যায়')}
                </h4>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[11px] font-semibold text-ink-700 ring-1 ring-ink-200">
                <Coins size={12} className="text-gold-600" /> {money(gross)}
                <span className="font-normal text-ink-400">100%</span>
              </span>
            </div>

            <motion.div layout className="relative flex h-9 w-full overflow-hidden rounded-2xl bg-ink-100 ring-1 ring-inset ring-ink-200/80">
              <AnimatePresence initial={false}>
                {visibleSegments.map((segment) => (
                  <motion.div
                    key={segment.key}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 190, damping: 26, mass: 0.6 }}
                    onMouseEnter={() => setHovered(segment.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ width: `${clampPct(segment.pct)}%`, minWidth: segment.pct > 0 ? 4 : 0 }}
                    className={`relative h-full cursor-pointer ${segment.bar}`}
                    title={`${isBn ? segment.labelBn : segment.labelEn} · ${money(segment.amount)} · ${segment.pct.toFixed(1)}%`}
                  >
                    {segment.pct > 9 ? (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.12em] text-white/90">
                        {segment.pct.toFixed(0)}%
                      </span>
                    ) : null}
                  </motion.div>
                ))}
              </AnimatePresence>
              <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
            </motion.div>

            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {segments.map((segment) => (
                <button
                  key={segment.key}
                  type="button"
                  onMouseEnter={() => setHovered(segment.key)}
                  onMouseLeave={() => setHovered(null)}
                  className={`rounded-xl border px-2.5 py-2 text-left transition ${
                    hovered === segment.key ? 'border-ink-300 bg-white shadow-sm' : 'border-ink-100 bg-ink-50/50'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${segment.dot}`} />
                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-ink-500">
                      {isBn ? segment.labelBn : segment.labelEn}
                    </span>
                  </span>
                  <span className="mt-1 block font-money text-[12px] font-semibold text-ink-900">
                    {money(segment.amount)}
                  </span>
                  <span className="text-[10px] text-ink-400">{segment.pct.toFixed(1)}% {L('of gross', 'গ্রসের')}</span>
                </button>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-900 px-3 py-2 text-[10px] text-vault-100">
              <span className="flex items-center gap-1.5">
                <Receipt size={11} className="text-gold-300" />
                <span className="font-mono">
                  {money(base, { symbol: false })} + SD {money(sd, { symbol: false })} + VAT {money(vat, { symbol: false })} = {money(gross, { symbol: false })}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-vault-300">
                <Wallet size={11} /> {L('Net cash', 'নিট নগদ')} {money(net)}
                <ArrowRight size={10} /> {L('party', 'পক্ষ')}
              </span>
            </div>

            {selectedSegment ? (
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-500">
                <CircleAlert size={11} className="mt-0.5 shrink-0" />
                {isBn ? selectedSegment.noteBn : selectedSegment.noteEn} · {money(selectedSegment.amount)} ·{' '}
                {selectedSegment.pct.toFixed(2)}%
              </p>
            ) : null}
          </div>

          {/* ------------------------------------------------------------------------------ */}
          {/* Money split + statutory provenance grid                                         */}
          {/* ------------------------------------------------------------------------------ */}
          <div className={`grid gap-0 border-b border-ink-100 lg:grid-cols-2 ${compact ? 'text-[11px]' : ''}`}>
            {/* Left: exact money split */}
            <div className="border-b border-ink-100 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between gap-2 bg-ink-50/60 px-4 py-2">
                <p className="lv-kicker flex items-center gap-1.5">
                  <Coins size={11} className="text-vault-600" /> {L('Money split', 'অর্থ বিভাজন')}
                </p>
                <span className="font-mono text-[9px] text-ink-400">poisha-accurate</span>
              </div>
              <dl className="divide-y divide-ink-100">
                {[
                  { label: L('Base net', 'নিট ভিত্তি'), value: base, tag: 'TAXABLE_VALUE', tone: 'text-ink-900' },
                  { label: L('Supplementary duty (SD)', 'সম্পূরক শুল্ক (এসডি)'), value: sd, tag: 'SD', tone: 'text-ink-900' },
                  { label: L('VAT', 'ভ্যাট'), value: vat, tag: agentVatTag(decision.vat_bps), tone: 'text-indigo-700' },
                  { label: L('VDS deducted at source', 'উৎসে কর্তিত ভিডিএস'), value: vds, tag: 'VDS_S49', tone: 'text-violet-700' },
                  { label: L('TDS deducted at source', 'উৎসে কর্তিত টিডিএস'), value: tds, tag: tdsPenalised ? 'TDS+50%' : 'TDS', tone: 'text-amber-700' },
                  { label: L('Net cash to party', 'পক্ষের নিট নগদ'), value: net, tag: 'NET_SETTLEMENT', tone: 'text-emerald-700' },
                  { label: L('Total payable to NBR treasury', 'এনবিআর কোষাগারে মোট প্রদেয়'), value: treasury, tag: 'TREASURY', tone: 'text-ink-900' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-2 px-4 py-2">
                    <dt className="min-w-0">
                      <span className="block truncate text-[11px] text-ink-600">{row.label}</span>
                      <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-300">{row.tag}</span>
                    </dt>
                    <dd className={`font-money shrink-0 text-[12px] font-semibold ${row.tone}`}>{money(row.value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-1.5 bg-ink-50/60 px-4 py-2">
                <span className="lv-chip lv-chip-neutral font-mono">{decision.rule_pack_version}</span>
                <span className="lv-chip lv-chip-neutral font-mono">{decision.trace_id.slice(0, 12)}</span>
                {input.is_credit_note ? <span className="lv-chip lv-chip-rose">{L('Mushak 6.7 credit note', 'মূসক ৬.৭ ক্রেডিট নোট')}</span> : null}
              </div>
            </div>

            {/* Right: live guardrails */}
            <div>
              <div className="flex items-center justify-between gap-2 bg-ink-50/60 px-4 py-2">
                <p className="lv-kicker flex items-center gap-1.5">
                  <ShieldCheck size={11} className="text-vault-600" /> {L('Statutory guardrails', 'সংবিধিবদ্ধ সতর্কতা')}
                </p>
                <span className="truncate text-[10px] text-ink-400">{input.party_name}</span>
              </div>
              <div className="grid gap-2 p-3">
                <GuardrailCard
                  ok={binValid}
                  tone={binValid ? 'ok' : 'danger'}
                  icon={binValid ? <BadgeCheck size={13} /> : <ShieldAlert size={13} />}
                  title={L('13-digit BIN', '১৩ সংখ্যার বিআইএন')}
                  pill={binValid ? L('Validated', 'যাচাইকৃত') : L('Missing / invalid', 'অনুপস্থিত / অকার্যকর')}
                  value={input.party_bin ?? L('Not provided', 'প্রদান করা হয়নি')}
                  detail={
                    binValid
                      ? L('Mushak 6.3 can be issued with this counterparty BIN.', 'এই বিআইএনসহ মূসক ৬.৩ ইস্যু করা যাবে।')
                      : L('A 13-digit BIN is mandatory on the tax invoice and in the purchase register.', 'কর চালানে ও ক্রয় রেজিস্টারে ১৩ সংখ্যার বিআইএন বাধ্যতামূলক।')
                  }
                />

                <GuardrailCard
                  ok={tinValid && !tinMissing}
                  tone={tinValid && !tinMissing ? 'ok' : tds > 0n ? 'warn' : 'danger'}
                  icon={tinValid && !tinMissing ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
                  title={L('12-digit e-TIN · +50% penalty upscale', '১২ সংখ্যার ই-টিআইএন · +৫০% জরিমানা বৃদ্ধি')}
                  pill={tinMissing ? L('Penalty TDS applied', 'জরিমানা টিডিএস প্রযোজ্য') : L('Validated', 'যাচাইকৃত')}
                  value={input.party_tin ?? L('Missing', 'অনুপস্থিত')}
                  detail={
                    tinMissing
                      ? tdsPenalised
                        ? L(
                            `TDS is automatically upscaled by 50% (${formatPercentBps(decision.tds_bps, 'latin')}); about ${money(tdsPenaltyDelta)} extra is withheld.`,
                            `টিডিএস স্বয়ংক্রিয়ভাবে ৫০% বৃদ্ধি (${formatPercentBps(decision.tds_bps, 'latin')}); প্রায় ${money(tdsPenaltyDelta)} অতিরিক্ত কর্তন।`,
                          )
                        : L('No TDS applies on this document, but the missing e-TIN is still a filing risk.', 'এই দলিলে টিডিএস নেই, তবে ই-টিআইএন অনুপস্থিতি ফাইলিং ঝুঁকি।')
                      : showPreview
                        ? L(`Preview: without a TIN the TDS would rise to ${formatPercentBps(Math.round(decision.tds_bps * 1.5), 'latin')} (+${money(previewDelta)}).`, `প্রাকদর্শন: টিআইএন ছাড়া টিডিএস ${formatPercentBps(Math.round(decision.tds_bps * 1.5), 'latin')} হবে (+${money(previewDelta)})।`)
                        : L('Valid e-TIN on file — no statutory upscale.', 'বৈধ ই-টিআইএন সংরক্ষিত — কোনো বৃদ্ধি নেই।')
                  }
                  action={
                    <button
                      type="button"
                      role="switch"
                      aria-checked={tinMissing}
                      disabled={!tinValid}
                      onClick={toggleTinPenalty}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[9px] font-semibold text-ink-600 transition hover:border-ink-300 disabled:cursor-not-allowed"
                    >
                      <span className={`relative h-3.5 w-6 rounded-full transition ${tinMissing ? 'bg-rose-500' : previewPenalty ? 'bg-amber-500' : 'bg-ink-300'}`}>
                        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${tinMissing || previewPenalty ? 'left-3' : 'left-0.5'}`} />
                      </span>
                      {tinMissing ? L('Automatic', 'স্বয়ংক্রিয়') : L('Preview upscale', 'বৃদ্ধি প্রাকদর্শন')}
                    </button>
                  }
                />

                <GuardrailCard
                  ok={!cashRisk}
                  tone={cashRisk ? 'danger' : 'ok'}
                  icon={cashRisk ? <XCircle size={13} /> : <Banknote size={13} />}
                  title={L('Banking channel vs cash > BDT 1,00,000', 'ব্যাংকিং চ্যানেল বনাম নগদ > ১,০০,০০০ টাকা')}
                  pill={
                    input.direction === 'SALE'
                      ? L('Receipt channel', 'প্রাপ্তি চ্যানেল')
                      : cashRisk
                        ? L('s.46 rebate disallowed', 'ধারা ৪৬ রিবেট বাতিল')
                        : L('Input rebate protected', 'ইনপুট রিবেট সুরক্ষিত')
                  }
                  value={`${input.payment_method === 'CASH' ? L('Cash', 'নগদ') : L('Bank / MFS', 'ব্যাংক / এমএফএস')} · ${money(base)}`}
                  detail={
                    cashRisk
                      ? L(
                          `Cash payment above ${money(cashLimit)} blocks ${money(disallowed)} of input VAT; the disallowed VAT is capitalised into cost.`,
                          `${money(cashLimit)}-এর বেশি নগদে ${money(disallowed)} ইনপুট ভ্যাট বাতিল; বাতিল ভ্যাট ব্যয়ে মূলধনায়িত হয়।`,
                        )
                      : input.direction === 'SALE'
                        ? L('Cash receipts carry no s.46 input-credit consequence for the seller.', 'নগদ প্রাপ্তিতে বিক্রেতার জন্য ধারা ৪৬-এর ইনপুট রিবেট প্রভাব নেই।')
                        : L('Settled through a banking channel — the s.46 rebate guard is satisfied.', 'ব্যাংকিং চ্যানেলে নিষ্পত্তি — ধারা ৪৬ রিবেট শর্ত পূর্ণ।')
                  }
                />

                <GuardrailCard
                  ok={mushakOk}
                  tone={mushakOk ? 'ok' : 'warn'}
                  icon={mushakOk ? <FileCheck2 size={13} /> : <CircleAlert size={13} />}
                  title={L('Mushak 6.3 attachment status', 'মূসক ৬.৩ সংযুক্তি অবস্থা')}
                  pill={mushakOk ? L('Attached', 'সংযুক্ত') : L('Missing', 'অনুপস্থিত')}
                  value={
                    input.is_reverse_charge
                      ? L('Reverse-charge challan', 'রিভার্স-চার্জ চালান')
                      : input.has_valid_mushak63
                        ? L('Supplier tax invoice held', 'সরবরাহকারীর কর চালান সংরক্ষিত')
                        : L('No tax invoice on file', 'কোনো কর চালান নেই')
                  }
                  detail={
                    input.is_reverse_charge
                      ? input.has_reverse_charge_challan
                        ? L('Self-assessed VAT challan is attached — credit claimable.', 'স্ব-নির্ধারিত ভ্যাট চালান সংযুক্ত — রিবেট দাবিযোগ্য।')
                        : L('Attach the reverse-charge treasury challan before claiming input credit.', 'ইনপুট রিবেট দাবির আগে রিভার্স-চার্জ চালান সংযুক্ত করুন।')
                      : L(
                          'The supplier’s Mushak 6.3 is the evidence for input credit; keep it for six years.',
                          'সরবরাহকারীর মূসক ৬.৩ ইনপুট রিবেটের প্রমাণ; ছয় বছর সংরক্ষণ করুন।',
                        )
                  }
                />
              </div>

              {claimable > 0n || disallowed > 0n ? (
                <div className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-vault-50 px-3 py-2 text-[10px] text-vault-800 ring-1 ring-inset ring-vault-200">
                  <Sparkles size={12} />
                  <span className="font-semibold">{L('Claimable', 'দাবিযোগ্য')}: {money(claimable)}</span>
                  {disallowed > 0n ? (
                    <span className="font-semibold text-rose-600">{L('Disallowed', 'বাতিল')}: {money(disallowed)}</span>
                  ) : null}
                  <span className="text-vault-600">{L('VAT current account · Note 18', 'ভ্যাট চলতি হিসাব · নোট ১৮')}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* ------------------------------------------------------------------------------ */}
          {/* Explain this calculation                                                        */}
          {/* ------------------------------------------------------------------------------ */}
          <div className="border-b border-ink-100">
            <button
              type="button"
              onClick={() => setExplainOpen((open) => !open)}
              aria-expanded={explainOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-ink-50/70"
            >
              <span className="flex flex-wrap items-center gap-2">
                <BookOpen size={15} className="text-vault-700" />
                <span className="text-sm font-semibold text-ink-900">
                  {L('Explain this calculation', 'এই হিসাব ব্যাখ্যা করুন')}
                </span>
                <span className="lv-chip lv-chip-neutral">{activeRuleIds.length} {L('rules', 'নিয়ম')}</span>
                <span className="lv-chip lv-chip-gold">{decision.rule_pack_version}</span>
              </span>
              <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform ${explainOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence initial={false}>
              {explainOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden bg-ink-50/40"
                >
                  <div className="space-y-3 px-5 pb-5 pt-1">
                    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                      <div className="flex items-center justify-between gap-2 border-b border-ink-100 bg-ink-50/70 px-3 py-2">
                        <p className="lv-kicker flex items-center gap-1.5">
                          <Calculator size={11} className="text-vault-600" /> {L('Calculation ledger', 'হিসাব খতিয়ান')}
                        </p>
                        <span className="font-mono text-[9px] text-ink-400">{decision.trace_id}</span>
                      </div>
                      <ul className="divide-y divide-ink-100">
                        {calculationRows
                          .filter((row) => row.amount !== 0n || row.key === 'base')
                          .map((row) => {
                            const rule = getRule(row.ruleId);
                            return (
                              <li key={row.key} className="px-3 py-2.5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-semibold text-ink-800">
                                      {isBn ? row.labelBn : row.labelEn}
                                      <span className="ml-2 rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[8.5px] font-normal text-vault-200">
                                        {row.ruleId}
                                      </span>
                                      {rule && rule.verify_flag ? (
                                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-[8px] font-semibold text-amber-700">[VERIFY]</span>
                                      ) : null}
                                    </p>
                                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-500">{row.formula}</p>
                                    {rule ? (
                                      <p className="mt-0.5 text-[9.5px] leading-snug text-ink-400">
                                        <span className="font-semibold text-ink-500">{rule.instrument}</span> · {rule.citation}
                                      </p>
                                    ) : null}
                                  </div>
                                  <span className="font-money shrink-0 text-[12px] font-semibold text-ink-900">{money(row.amount)}</span>
                                </div>
                              </li>
                            );
                          })}
                      </ul>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-ink-200 bg-white p-3">
                        <p className="lv-kicker mb-1.5 flex items-center gap-1.5">
                          <Gavel size={11} className="text-gold-600" /> {L('Statutory provenance', 'সংবিধিবদ্ধ উৎস')}
                        </p>
                        <ul className="space-y-1.5">
                          {activeRuleIds.map((ruleId) => {
                            const rule = getRule(ruleId);
                            return (
                              <li key={ruleId} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-600">
                                <span className="mt-0.5 rounded bg-ink-100 px-1 py-0.5 font-mono text-[8.5px] text-ink-600">{ruleId}</span>
                                <span className="min-w-0">
                                  <span className="block font-semibold text-ink-700">{rule?.title_en ?? L('Resolved by the engine', 'ইঞ্জিন কর্তৃক নির্ধারিত')}</span>
                                  <span className="block text-ink-400">{rule?.citation ?? decision.citations[0] ?? '—'}</span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      <div className="space-y-3">
                        <div className="rounded-xl border border-ink-200 bg-white p-3">
                          <p className="lv-kicker mb-1.5">{L('Rule pack trace', 'রুল প্যাক ট্রেস')}</p>
                          <dl className="space-y-1 font-mono text-[10px] text-ink-600">
                            <div className="flex justify-between gap-3"><dt className="text-ink-400">rule_pack</dt><dd className="text-ink-800">{decision.rule_pack_version}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-ink-400">trace_id</dt><dd className="truncate text-ink-800" title={decision.trace_id}>{decision.trace_id}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-ink-400">evaluated_at</dt><dd className="truncate text-ink-800">{decision.evaluated_at}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-ink-400">direction</dt><dd className="text-ink-800">{decision.direction}</dd></div>
                          </dl>
                        </div>

                        {decision.conditions.length > 0 ? (
                          <div className="rounded-xl border border-ink-200 bg-white p-3">
                            <p className="lv-kicker mb-1.5">{L('Conditions & guardrails', 'শর্ত ও সতর্কতা')}</p>
                            <ul className="space-y-1">
                              {decision.conditions.slice(0, 5).map((condition) => (
                                <ConditionRow key={condition.code} condition={condition} isBn={isBn} />
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <InputCreditPanel outcome={decision.input_credit} isBn={isBn} money={money} />
                      </div>
                    </div>

                    {(isBn ? decision.explanations_bn : decision.explanations_en).length > 0 ? (
                      <div className="rounded-xl border border-ink-200 bg-white p-3">
                        <p className="lv-kicker mb-1.5">{L('Why the engine decided this', 'ইঞ্জিন কেন এই সিদ্ধান্ত নিল')}</p>
                        <ol className="space-y-1.5">
                          {(isBn ? decision.explanations_bn : decision.explanations_en).slice(0, 5).map((explanation, index) => (
                            <li key={`${index}-${explanation.slice(0, 10)}`} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-600">
                              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-vault-100 text-[8px] font-bold text-vault-800">{index + 1}</span>
                              <span>{explanation}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    {filing ? (
                      <div className="flex items-start gap-2.5 rounded-xl border border-gold-200 bg-gold-50 p-3">
                        <Landmark size={14} className="mt-0.5 shrink-0 text-gold-700" />
                        <div className="text-[12px] leading-relaxed text-gold-700">
                          <p className="font-semibold">
                            {L(
                              'Filing deadline pending tax-counsel verification',
                              'দাখিলের সময়সীমা কর পরামর্শকের যাচাইয়ের অপেক্ষায়',
                            )}
                          </p>
                          <p className="mt-0.5">
                            {L(
                              'This demo does not assert a filing deadline, filing frequency or statutory acknowledgement.',
                              'এই ডেমো কোনো দাখিলের সময়সীমা, ফাইলিং ফ্রিকোয়েন্সি বা সংবিধিবদ্ধ স্বীকৃতি দাবি করে না।',
                            )}
                          </p>
                          <p className="mt-1 font-mono text-[12px] text-gold-700/80">
                            {L('Rule pack status', 'রুল প্যাক অবস্থা')}: PENDING_TAX_COUNSEL
                          </p>
                        </div>
                      </div>
                    ) : null}

                    <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-ink-400">
                      <CircleAlert size={10} className="mt-0.5 shrink-0" />
                      {L(
                        'Educational replica of the bd-2026-v1 rule pack. Every citation carries a [VERIFY] flag until tax counsel signs off — confirm against the NBR gazette before filing.',
                        'bd-2026-v1 রুল প্যাকের শিক্ষামূলক প্রতিরূপ। কর পরামর্শকের অনুমোদনের আগে প্রতিটি উদ্ধৃতিতে [VERIFY] চিহ্ন থাকে — ফাইলিংয়ের আগে এনবিআর গেজেটে যাচাই করুন।',
                      )}
                    </p>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* ------------------------------------------------------------------------------ */}
          {/* Optional journal preview                                                        */}
          {/* ------------------------------------------------------------------------------ */}
          <div>
            <button
              type="button"
              onClick={() => setJournalOpen((open) => !open)}
              aria-expanded={journalOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-ink-50/70"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Receipt size={15} className="text-vault-700" />
                <span className="text-sm font-semibold text-ink-900">{L('Journal preview', 'জার্নাল প্রাকদর্শন')}</span>
                <span className={`lv-chip ${journal.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                  {journal.balanced ? L('balanced', 'সমতাবদ্ধ') : L('unbalanced', 'অসমতাবদ্ধ')}
                </span>
              </span>
              <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform ${journalOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence initial={false}>
              {journalOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 px-5 pb-5">
                    {journal.groups.map((group) => (
                      <div key={group.id} className="overflow-hidden rounded-xl border border-ink-200">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50/80 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-600">
                            {isBn ? group.title_bn : group.title_en}
                            <span className="ml-2 font-mono text-[9px] font-normal text-ink-400">{group.id}</span>
                          </p>
                          <span className={`lv-chip ${group.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                            {money(group.total_debit_poisha)} = {money(group.total_credit_poisha)}
                          </span>
                        </div>
                        <table className="lv-table">
                          <thead>
                            <tr>
                              <th className="w-8">#</th>
                              <th>{L('Account', 'হিসাব')}</th>
                              <th className="w-28 text-right">{L('Debit', 'ডেবিট')}</th>
                              <th className="w-28 text-right">{L('Credit', 'ক্রেডিট')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.map((line) => (
                              <tr key={`${group.id}-${line.line_no}`}>
                                <td className="font-mono text-[10px] text-ink-400">{line.line_no}</td>
                                <td>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="font-mono text-[9px] text-ink-400">{line.account_code}</span>
                                    <span className="text-[11px] font-medium text-ink-800">
                                      {isBn ? line.account_name_bn : line.account_name_en}
                                    </span>
                                  </div>
                                </td>
                                <td className="font-money text-right text-[11px] text-ink-900">
                                  {line.debit_poisha > 0n ? money(line.debit_poisha) : <span className="text-ink-300">—</span>}
                                </td>
                                <td className="font-money text-right text-[11px] text-ink-900">
                                  {line.credit_poisha > 0n ? money(line.credit_poisha) : <span className="text-ink-300">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </>
      )}

      {footer ? <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------------------------

function agentVatTag(bps: number): string {
  if (bps === 0) return 'VAT_ZERO';
  if (bps === 1500) return 'VAT_15';
  if (bps === 500) return 'VAT_5';
  if (bps === 750) return 'VAT_7_5';
  return `VAT_${(bps / 100).toFixed(2)}`;
}

function DecisionChip({ state, isBn }: { state: TaxDecision['decision']; isBn: boolean }) {
  const map: Record<TaxDecision['decision'], { en: string; bn: string; className: string }> = {
    SUPPORTED: { en: 'Supported', bn: 'সমর্থিত', className: 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/30' },
    SUPPORTED_WITH_CONDITIONS: { en: 'Supported · conditions', bn: 'সমর্থিত · শর্তসাপেক্ষ', className: 'bg-gold-400/20 text-gold-100 ring-gold-300/30' },
    MANUAL_REVIEW: { en: 'Manual review', bn: 'ম্যানুয়াল যাচাই', className: 'bg-amber-400/20 text-amber-100 ring-amber-300/30' },
    NOT_SUPPORTED: { en: 'Not supported', bn: 'সমর্থিত নয়', className: 'bg-rose-500/20 text-rose-100 ring-rose-300/30' },
    SOURCE_DISPUTED_OR_EXPIRED: { en: 'Source disputed', bn: 'উৎস বিতর্কিত', className: 'bg-rose-500/20 text-rose-100 ring-rose-300/30' },
  };
  const entry = map[state];
  const ok = state === 'SUPPORTED';
  const warn = state === 'SUPPORTED_WITH_CONDITIONS' || state === 'MANUAL_REVIEW';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${entry.className}`}>
      {ok ? <CheckCircle2 size={10} /> : warn ? <AlertTriangle size={10} /> : <XCircle size={10} />}
      {isBn ? entry.bn : entry.en}
    </span>
  );
}

function GuardrailCard({
  ok,
  tone,
  icon,
  title,
  pill,
  value,
  detail,
  action,
}: {
  ok: boolean;
  tone: 'ok' | 'warn' | 'danger';
  icon: ReactNode;
  title: string;
  pill: string;
  value: string;
  detail: string;
  action?: ReactNode;
}) {
  const frame =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50/60'
      : tone === 'danger'
        ? 'border-rose-200 bg-rose-50/70'
        : 'border-amber-200 bg-amber-50/70';
  const chip =
    tone === 'ok'
      ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
      : tone === 'danger'
        ? 'bg-rose-100 text-rose-700 ring-rose-200'
        : 'bg-amber-100 text-amber-700 ring-amber-200';
  const iconChip =
    tone === 'ok' ? 'bg-emerald-100 text-emerald-700' : tone === 'danger' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
  return (
    <div className={`rounded-xl border p-2.5 ${frame}`}>
      <div className="flex items-start gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${iconChip}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-500">{title}</p>
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${chip}`}>
              {ok ? <CheckCircle2 size={8} /> : <AlertTriangle size={8} />} {pill}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] font-semibold text-ink-900" title={value}>{value}</p>
          <p className="mt-0.5 text-[9.5px] leading-snug text-ink-500">{detail}</p>
          {action ? <div className="mt-1.5">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ConditionRow({ condition, isBn }: { condition: TaxCondition; isBn: boolean }) {
  const tone =
    condition.severity === 'BLOCKER'
      ? { icon: <XCircle size={10} />, className: 'text-rose-600', chip: 'bg-rose-100 text-rose-700' }
      : condition.severity === 'WARNING'
        ? { icon: <AlertTriangle size={10} />, className: 'text-amber-600', chip: 'bg-amber-100 text-amber-700' }
        : { icon: <CircleAlert size={10} />, className: 'text-ink-400', chip: 'bg-ink-100 text-ink-600' };
  return (
    <li className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-600">
      <span className={`mt-0.5 shrink-0 ${tone.className}`}>{tone.icon}</span>
      <span>
        <span className={`mr-1 rounded px-1 py-0.5 font-mono text-[8px] uppercase ${tone.chip}`}>{condition.severity}</span>
        {isBn ? condition.message_bn : condition.message_en}
      </span>
    </li>
  );
}

function InputCreditPanel({
  outcome,
  isBn,
  money,
}: {
  outcome: InputCreditOutcome;
  isBn: boolean;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
}) {
  const labels = isBn ? outcome.reason_labels_bn : outcome.reason_labels_en;
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3">
      <p className="lv-kicker mb-1.5">{isBn ? 'ইনপুট রিবেট ফলাফল' : 'Input rebate outcome'}</p>
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className={`lv-chip ${outcome.eligible ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
          {outcome.eligible ? (isBn ? 'যোগ্য' : 'Eligible') : isBn ? 'অযোগ্য' : 'Not eligible'}
        </span>
        <span className="text-ink-600">
          {isBn ? 'দাবিযোগ্য' : 'Claimable'}: <b className="font-money text-ink-900">{money(ABS(outcome.claimable_poisha))}</b>
        </span>
        <span className="text-ink-600">
          {isBn ? 'অগ্রহণযোগ্য' : 'Disallowed'}: <b className="font-money text-rose-700">{money(ABS(outcome.disallowed_poisha))}</b>
        </span>
      </div>
      {labels.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {labels.map((label) => (
            <li key={label} className="flex items-start gap-1.5 text-[9.5px] text-ink-500">
              <Percent size={9} className="mt-0.5 shrink-0 text-ink-400" /> {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default TaxAdvisorCard;
