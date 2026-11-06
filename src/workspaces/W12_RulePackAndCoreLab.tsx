// LedgerVault — Phase 1 core foundation lab.
//
// This screen is the proving ground for the four Phase 1 engines: BigInt poisha arithmetic
// (money.ts), the 1,220-key bilingual dictionary (i18n.ts + locales), the deterministic tax engine
// (tax-engine/*) and the 25 golden vectors. Nothing here invents a tax rate: every rupee shown in
// the decision panel comes from evaluateTaxDecision() against Rule Pack bd-2026-v1.
//
// Icons are lucide-react only (Phases 1–5 forbid custom SVG art).

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Braces,
  Calculator,
  CalendarClock,
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  Coins,
  Copy,
  FlaskConical,
  Gauge,
  Hash,
  Info,
  Landmark,
  Languages,
  Layers,
  Percent,
  Play,
  RotateCcw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  Sparkles,
  Table2,
  TriangleAlert,
  Vault,
  Wallet,
} from 'lucide-react';

import { applyRateBps, bdtToPoisha, formatPoisha, formatPercentBps, takaInWords } from '../core/money';
import {
  LOCALES,
  createTranslator,
  dictionaryParity,
  localized,
  searchDictionary,
  type DictionaryHit,
  type Locale,
  type Numeral,
} from '../core/i18n';
import { evaluateTaxDecision, isValidBin, isValidTin, previewTaxJournal } from '../core/tax-engine/engine';
import { BD_2026_V1, RULE_PACK_VERSION, activeRules, rulesByDomain } from '../core/tax-engine/rulePack';
import { GOLDEN_CASE_COUNT, runGoldenSuite, type GoldenSuiteResult } from '../core/tax-engine/goldenSuite';
import type {
  DecisionState,
  PaymentMethod,
  TaxCategory,
  TaxCondition,
  TaxDomain,
  TaxEvaluationInput,
  TdsNature,
} from '../core/types';
import { WorkspaceHeader } from '../components/commercial/CommercialShared';
import { useVault } from '../context/VaultContext';
import { FirmCockpit, RuleImpactSimulator } from './W12_FirmCockpit';

const DEMO_DATE = '2026-11-01';
const DEMO_EVALUATED_AT = '2026-11-01T09:00:00.000+06:00';

type Grouping = 'LAKH_CRORE' | 'MILLIONS';

interface LabFacts {
  direction: 'SALE' | 'PURCHASE';
  baseText: string;
  category: TaxCategory;
  tdsNature: TdsNature;
  payment: PaymentMethod;
  withholding: boolean;
  vds: boolean;
  mushak: boolean;
  reverseCharge: boolean;
  challan: boolean;
  sd: boolean;
  creditNote: boolean;
  nilReturn: boolean;
  govtOrBank: boolean;
  bin: string;
  tin: string;
  periodEnd: string;
  partyName: string;
}

const DEFAULT_FACTS: LabFacts = {
  direction: 'SALE',
  baseText: '125000.00',
  category: 'STANDARD_15',
  tdsNature: 'NONE',
  payment: 'BANK',
  withholding: false,
  vds: false,
  mushak: true,
  reverseCharge: false,
  challan: false,
  sd: false,
  creditNote: false,
  nilReturn: false,
  govtOrBank: false,
  bin: '004271836-0203',
  tin: '138547291063',
  periodEnd: new Date().toISOString().slice(0, 10),
  partyName: 'Meghna Distribution Ltd.',
};

const TAX_CATEGORIES: TaxCategory[] = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
];

const TDS_NATURES: TdsNature[] = [
  'NONE',
  'SUPPLY_OF_GOODS',
  'PROFESSIONAL_OR_TECHNICAL_SERVICES',
  'COMMERCIAL_RENT',
  'ADVERTISING_OR_MEDIA',
  'TRANSPORT_OR_LOGISTICS',
  'CONTRACTOR_OR_SUBCONTRACTOR',
];

const PAYMENT_METHODS: PaymentMethod[] = ['BANK', 'MFS', 'CASH', 'CHEQUE', 'CREDIT_CARD'];

const PAYMENT_LABEL_KEY: Record<PaymentMethod, string> = {
  BANK: 'sales.bankTransfer',
  MFS: 'sales.mfs',
  CASH: 'sales.cash',
  CHEQUE: 'sales.cheque',
  CREDIT_CARD: 'sales.card',
};

function decisionVisuals(state: DecisionState): { chip: string; panel: string } {
  switch (state) {
    case 'SUPPORTED':
      return { chip: 'lv-chip-emerald', panel: 'ring-vault-200' };
    case 'SUPPORTED_WITH_CONDITIONS':
      return { chip: 'lv-chip-gold', panel: 'ring-gold-200' };
    case 'MANUAL_REVIEW':
      return { chip: 'bg-amber-50 text-amber-700', panel: 'ring-amber-200' };
    case 'NOT_SUPPORTED':
      return { chip: 'lv-chip-rose', panel: 'ring-rose-200' };
    case 'SOURCE_DISPUTED_OR_EXPIRED':
      return { chip: 'bg-red-50 text-red-700', panel: 'ring-red-200' };
    default:
      return { chip: 'lv-chip-neutral', panel: 'ring-ink-200' };
  }
}

function DecisionGlyph({ state, className }: { state: DecisionState; className?: string }) {
  if (state === 'SUPPORTED') return <ShieldCheck className={className} size={18} />;
  if (state === 'SUPPORTED_WITH_CONDITIONS') return <TriangleAlert className={className} size={18} />;
  if (state === 'MANUAL_REVIEW') return <Info className={className} size={18} />;
  if (state === 'NOT_SUPPORTED') return <CircleX className={className} size={18} />;
  return <ShieldAlert className={className} size={18} />;
}

function severityTone(severity: TaxCondition['severity']): { chip: string; icon: JSX.Element } {
  if (severity === 'BLOCKER') {
    return { chip: 'lv-chip-rose', icon: <ShieldAlert size={13} /> };
  }
  if (severity === 'WARNING') {
    return { chip: 'lv-chip-gold', icon: <TriangleAlert size={13} /> };
  }
  return { chip: 'lv-chip-neutral', icon: <Info size={13} /> };
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="lv-kicker">{label}</span>
      <div className="lv-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="lv-seg-item"
            data-active={option.value === value}
            title={option.title}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs font-medium transition ${
        checked
          ? 'border-vault-300 bg-vault-50 text-vault-900'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
      }`}
    >
      <span className="leading-snug">{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-vault-600' : 'bg-ink-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

interface SectionHeadingProps {
  icon: JSX.Element;
  title: string;
  subtitle?: string;
  badge?: JSX.Element;
  action?: JSX.Element;
}

function SectionHeading({ icon, title, subtitle, badge, action }: SectionHeadingProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-vault-50 text-vault-700">{icon}</span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-800">{title}</h2>
            {badge}
          </div>
          {subtitle ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

interface StatCardProps {
  icon: JSX.Element;
  label: string;
  value: string;
  hint: string;
  badge?: JSX.Element;
}

function StatCard({ icon, label, value, hint, badge }: StatCardProps) {
  return (
    <div className="lv-card lv-card-pad flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="lv-kicker">{label}</span>
        <span className="text-vault-600">{icon}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="lv-kpi-value font-money">{value}</span>
        {badge}
      </div>
      <p className="lv-hint">{hint}</p>
    </div>
  );
}

export default function W12_RulePackAndCoreLab() {
  // Locale, numerals and grouping come from the ERP shell so the top control bar and the lab's own
  // toggles stay in lock-step. Every other Phase 1 line below is preserved unchanged.
  const { locale, numeralScript: numeral, grouping, setLocale, setNumeralScript: setNumeral, setGrouping } = useVault();
  const [facts, setFacts] = useState<LabFacts>(DEFAULT_FACTS);
  const [domain, setDomain] = useState<TaxDomain | 'ALL'>('ALL');
  const [suite, setSuite] = useState<GoldenSuiteResult | null>(null);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [query, setQuery] = useState('kroy');
  const [copied, setCopied] = useState(false);

  const t = useMemo(() => createTranslator(locale, { numeral }), [locale, numeral]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const money = useCallback(
    (value: bigint) => formatPoisha(value, { locale, numeral, grouping }),
    [locale, numeral, grouping],
  );

  const patch = useCallback((partial: Partial<LabFacts>) => {
    setFacts((previous) => ({ ...previous, ...partial }));
  }, []);

  const chooseLocale = useCallback((next: Locale) => {
    setLocale(next);
    setNumeral(next === 'bn-BD' ? 'bn' : 'latin');
  }, []);

  const parsedBase = useMemo(() => {
    try {
      return { value: bdtToPoisha(facts.baseText), error: false };
    } catch {
      return { value: 0n, error: true };
    }
  }, [facts.baseText]);

  const input = useMemo<TaxEvaluationInput>(
    () => ({
      direction: facts.direction,
      base_poisha: parsedBase.value,
      tax_category: facts.category,
      party_name: facts.partyName,
      party_bin: facts.bin.trim() || undefined,
      party_tin: facts.tin.trim() || undefined,
      is_withholding_entity: facts.withholding,
      vds_applicable: facts.vds,
      tds_nature: facts.tdsNature,
      payment_method: facts.payment,
      has_valid_mushak63: facts.mushak,
      is_reverse_charge: facts.reverseCharge || facts.category === 'REVERSE_CHARGE',
      has_reverse_charge_challan: facts.challan,
      sd_applicable: facts.sd,
      is_credit_note: facts.creditNote,
      is_nil_return: facts.nilReturn,
      is_government_or_bank: facts.govtOrBank,
      period_end_date: facts.periodEnd || undefined,
    }),
    [facts, parsedBase.value],
  );

  const decision = useMemo(
    () => evaluateTaxDecision(input, { evaluatedAt: DEMO_EVALUATED_AT }),
    [input],
  );

  const preview = useMemo(() => previewTaxJournal(input, decision), [input, decision]);

  const parity = useMemo(() => dictionaryParity(), []);
  const activeRuleCount = useMemo(() => activeRules(DEMO_DATE).length, []);
  const domains = useMemo(
    () => Array.from(new Set(BD_2026_V1.rules.map((rule) => rule.domain))).sort(),
    [],
  );
  const ruleList = useMemo(() => rulesByDomain(domain), [domain]);

  const hits = useMemo<DictionaryHit[]>(() => searchDictionary(locale, query, 6), [locale, query]);

  const jsonPatchPreview = useMemo(() => {
    try {
      return JSON.stringify(
        { amount_poisha: 10_000_000n, vat_bps: 1500, net_payable_poisha: decision.net_payable_poisha },
        null,
        2,
      );
    } catch (error) {
      return String(error);
    }
  }, [decision.net_payable_poisha]);

  const moneySamples = useMemo(
    () => [
      bdtToPoisha('123456789.00'),
      bdtToPoisha('12345.67'),
      bdtToPoisha('115000.00'),
      bdtToPoisha('-3500.00'),
    ],
    [],
  );

  const rateSamples = useMemo(() => [1500, 750, 500], []);
  const rateBase = useMemo(() => bdtToPoisha('12345.67'), []);

  const runSuite = useCallback(() => {
    setSuite(runGoldenSuite());
    setExpandedCase(null);
  }, []);

  const copyDecision = useCallback(() => {
    const payload = JSON.stringify(decision, null, 2);
    const finish = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(finish).catch(() => undefined);
    }
  }, [decision]);

  const allPassed = suite !== null && suite.failed === 0;

  return (
    <>
      <WorkspaceHeader
        icon={<Vault size={19} />}
        kickerEn={t('lab.badge')}
        kickerBn={t('lab.badge')}
        titleEn={t('lab.title')}
        titleBn={t('lab.title')}
        isBn={locale === 'bn-BD'}
        actions={
          <>
            <Segmented
              label={t('top.language')}
              value={locale}
              onChange={chooseLocale}
              options={LOCALES.map((entry) => ({
                value: entry.code,
                label: entry.code === 'en-BD' ? 'EN' : 'বাংলা',
                title: entry.native_label,
              }))}
            />
            <Segmented
              label={t('top.numerals')}
              value={numeral}
              onChange={setNumeral}
              options={[
                { value: 'latin', label: '1,234' },
                { value: 'bn', label: '১২,৩৪' },
              ]}
            />
            <Segmented
              label={t('top.grouping')}
              value={grouping}
              onChange={setGrouping}
              options={[
                { value: 'LAKH_CRORE', label: t('top.lakh') },
                { value: 'MILLIONS', label: t('top.millions') },
              ]}
            />
          </>
        }
      />

      <main className="space-y-6">
        <FirmCockpit />
        <RuleImpactSimulator />
        <section className="grid gap-4 lg:grid-cols-[1.4fr_2fr]">
          <div className="lv-card lv-card-pad relative overflow-hidden">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-vault-100/70" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-gold-100/60" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-gold-600" />
                <span className="lv-kicker">{t('lab.badge')}</span>
              </div>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-ink-900">
                {t('lab.title')}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600">{t('lab.subtitle')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="lv-chip lv-chip-emerald">
                  <BadgeCheck size={13} /> {RULE_PACK_VERSION}
                </span>
                <span className="lv-chip lv-chip-gold">
                  <FlaskConical size={13} /> {GOLDEN_CASE_COUNT} {t('lab.goldenShort')}
                </span>
                <span className="lv-chip lv-chip-neutral">
                  <Languages size={13} /> EN / BN
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={<BookOpen size={16} />}
              label={t('rulepack.activePack')}
              value={RULE_PACK_VERSION}
              hint={`${activeRuleCount} / ${BD_2026_V1.rules.length} ${t('lab.activeRules')}`}
              badge={<span className="lv-chip lv-chip-gold">{t('rulepack.reviewPending')}</span>}
            />
            <StatCard
              icon={<FlaskConical size={16} />}
              label={t('lab.goldenShort')}
              value={suite ? `${suite.passed} / ${suite.total}` : `${GOLDEN_CASE_COUNT}`}
              hint={suite ? `${suite.checks_run} ${t('lab.assertions')} · ${suite.duration_ms} ms` : t('lab.suiteIdle')}
              badge={
                suite ? (
                  <span className={`lv-chip ${allPassed ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                    {allPassed ? <Check size={13} /> : <CircleX size={13} />}
                    {allPassed ? t('rulepack.passCount') : t('rulepack.failCount')}
                  </span>
                ) : undefined
              }
            />
            <StatCard
              icon={<Languages size={16} />}
              label={t('lab.dictionaryKeys')}
              value={`${parity.en_keys}`}
              hint={`EN ${parity.en_keys} · BN ${parity.bn_keys} · ${t('lab.parity')}`}
              badge={
                <span className={`lv-chip ${parity.complete ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                  {parity.complete ? t('lab.parityComplete') : t('lab.parityIncomplete')}
                </span>
              }
            />
            <StatCard
              icon={<Braces size={16} />}
              label={t('lab.jsonPatch')}
              value={t('lab.statusActive')}
              hint={jsonPatchPreview.replace(/\s+/g, ' ').slice(0, 78)}
            />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="lv-card">
            <SectionHeading
              icon={<Coins size={16} />}
              title={t('lab.moneyTitle')}
              subtitle={t('lab.moneySubtitle')}
              badge={<span className="lv-chip lv-chip-neutral">bigint</span>}
            />
            <div className="overflow-x-auto">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th className="text-right">{t('lab.columnSample')}</th>
                    <th className="text-right">{t('lab.columnActiveFormat')}</th>
                    <th>{t('lab.columnWordsEn')}</th>
                    <th>{t('lab.columnWordsBn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {moneySamples.map((sample) => (
                    <tr key={sample.toString()}>
                      <td className="whitespace-nowrap text-right font-money text-ink-900">
                        {formatPoisha(sample, { locale: 'en-BD', numeral: 'latin', grouping, showSymbol: false })}
                      </td>
                      <td className="whitespace-nowrap text-right font-money font-semibold text-vault-800">
                        {money(sample)}
                      </td>
                      <td className="max-w-[240px] text-xs leading-relaxed text-ink-600">
                        {takaInWords(sample, 'en-BD')}
                      </td>
                      <td className="max-w-[260px] font-bangla text-xs leading-relaxed text-ink-600">
                        {takaInWords(sample, 'bn-BD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lv-card">
            <SectionHeading
              icon={<Percent size={16} />}
              title={t('lab.rateTitle')}
              subtitle={t('lab.rateSubtitle')}
              badge={<span className="lv-chip lv-chip-neutral">bps</span>}
            />
            <div className="overflow-x-auto">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th className="text-right">{t('lab.columnBase')}</th>
                    <th className="text-right">{t('rulepack.rate')}</th>
                    <th className="text-right">{t('lab.columnHalfUp')}</th>
                    <th className="text-right">{t('lab.columnFloor')}</th>
                    <th className="text-right">{t('lab.columnCeil')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rateSamples.map((rateBps) => (
                    <tr key={rateBps}>
                      <td className="whitespace-nowrap text-right font-money text-ink-900">{money(rateBase)}</td>
                      <td className="whitespace-nowrap text-right font-money text-vault-800">
                        {formatPercentBps(rateBps, numeral)}
                      </td>
                      <td className="whitespace-nowrap text-right font-money">
                        {money(applyRateBps(rateBase, rateBps, 'HALF_UP'))}
                      </td>
                      <td className="whitespace-nowrap text-right font-money">
                        {money(applyRateBps(rateBase, rateBps, 'FLOOR'))}
                      </td>
                      <td className="whitespace-nowrap text-right font-money">
                        {money(applyRateBps(rateBase, rateBps, 'CEIL'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="lv-card h-fit">
            <SectionHeading
              icon={<Calculator size={16} />}
              title={t('lab.inputs')}
              subtitle={t('lab.taxSubtitle')}
            />
            <div className="space-y-4 p-5">
              <Segmented
                label={t('lab.direction')}
                value={facts.direction}
                onChange={(next) => patch({ direction: next })}
                options={[
                  { value: 'SALE', label: t('lab.sale') },
                  { value: 'PURCHASE', label: t('lab.purchase') },
                ]}
              />

              <div>
                <label className="lv-label" htmlFor="lab-base">
                  {t('lab.baseAmount')}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                    ৳
                  </span>
                  <input
                    id="lab-base"
                    className="lv-input pl-7 font-money"
                    inputMode="decimal"
                    value={facts.baseText}
                    onChange={(event) => patch({ baseText: event.target.value })}
                  />
                </div>
                {parsedBase.error ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{t('lab.invalidAmount')}</p>
                ) : (
                  <p className="mt-1 text-xs text-ink-500 font-money">
                    {money(parsedBase.value)} · {parsedBase.value.toString()} {t('lab.poisha')}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="lv-label" htmlFor="lab-category">
                    {t('sales.taxCategory')}
                  </label>
                  <select
                    id="lab-category"
                    className="lv-input"
                    value={facts.category}
                    onChange={(event) => {
                      const next = event.target.value as TaxCategory;
                      patch({ category: next, reverseCharge: next === 'REVERSE_CHARGE' });
                    }}
                  >
                    {TAX_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {t(`tax.category.${category}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lv-label" htmlFor="lab-tds">
                    {t('lab.tdsNature')}
                  </label>
                  <select
                    id="lab-tds"
                    className="lv-input"
                    value={facts.tdsNature}
                    onChange={(event) => patch({ tdsNature: event.target.value as TdsNature })}
                  >
                    {TDS_NATURES.map((nature) => (
                      <option key={nature} value={nature}>
                        {t(`tax.tdsNature.${nature}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lv-label" htmlFor="lab-payment">
                    {t('sales.paymentMethod')}
                  </label>
                  <select
                    id="lab-payment"
                    className="lv-input"
                    value={facts.payment}
                    onChange={(event) => patch({ payment: event.target.value as PaymentMethod })}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {t(PAYMENT_LABEL_KEY[method])}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lv-label" htmlFor="lab-period">
                    {t('lab.periodEnd')}
                  </label>
                  <input
                    id="lab-period"
                    type="date"
                    className="lv-input font-money"
                    value={facts.periodEnd}
                    onChange={(event) => patch({ periodEnd: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="lv-label" htmlFor="lab-bin">
                    {t('lab.partyBin')}
                  </label>
                  <input
                    id="lab-bin"
                    className="lv-input font-money"
                    value={facts.bin}
                    onChange={(event) => patch({ bin: event.target.value })}
                  />
                  <span className={`mt-1 inline-flex ${isValidBin(facts.bin) ? 'text-vault-700' : 'text-rose-600'}`}>
                    <span className="lv-chip lv-chip-neutral">
                      {isValidBin(facts.bin) ? <BadgeCheck size={13} /> : <CircleX size={13} />}
                      {isValidBin(facts.bin) ? t('tax.check.valid') : t('tax.check.invalid')}
                    </span>
                  </span>
                </div>
                <div>
                  <label className="lv-label" htmlFor="lab-tin">
                    {t('lab.partyTin')}
                  </label>
                  <input
                    id="lab-tin"
                    className="lv-input font-money"
                    value={facts.tin}
                    onChange={(event) => patch({ tin: event.target.value })}
                  />
                  <span className="mt-1 inline-flex">
                    <span className="lv-chip lv-chip-neutral">
                      {isValidTin(facts.tin) ? <BadgeCheck size={13} /> : <CircleX size={13} />}
                      {isValidTin(facts.tin) ? t('tax.check.valid') : t('tax.check.invalid')}
                    </span>
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle
                  checked={facts.withholding}
                  onChange={(next) => patch({ withholding: next })}
                  label={t('lab.withholdingEntity')}
                />
                <Toggle
                  checked={facts.vds}
                  onChange={(next) => patch({ vds: next })}
                  label={t('tax.part.VDS')}
                />
                <Toggle
                  checked={facts.mushak}
                  onChange={(next) => patch({ mushak: next })}
                  label={t('lab.mushakAttached')}
                />
                <Toggle
                  checked={facts.reverseCharge}
                  onChange={(next) => patch({ reverseCharge: next })}
                  label={t('sales.reverseCharge')}
                />
                <Toggle
                  checked={facts.challan}
                  onChange={(next) => patch({ challan: next })}
                  label={t('lab.challanHeld')}
                />
                <Toggle
                  checked={facts.sd}
                  onChange={(next) => patch({ sd: next })}
                  label={t('lab.sdApplicable')}
                />
                <Toggle
                  checked={facts.creditNote}
                  onChange={(next) => patch({ creditNote: next })}
                  label={t('lab.creditNote')}
                />
                <Toggle
                  checked={facts.nilReturn}
                  onChange={(next) => patch({ nilReturn: next })}
                  label={t('lab.nilReturn')}
                />
                <Toggle
                  checked={facts.govtOrBank}
                  onChange={(next) => patch({ govtOrBank: next })}
                  label={t('lab.govtOrBank')}
                />
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
                <Info size={13} className="shrink-0 text-vault-600" />
                {t('tax.advisor.hint')}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${decision.trace_id}-${decision.decision}-${decision.vat_poisha.toString()}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="lv-card overflow-hidden"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 bg-gradient-to-br from-white to-vault-50/60 px-5 py-4 dark:border-line/80 dark:from-surface dark:to-vault-950">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-vault-700 text-white">
                      <Scale size={17} />
                    </span>
                    <div>
                      <p className="lv-kicker">{t('lab.taxTitle')}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`lv-chip ${decisionVisuals(decision.decision).chip}`}>
                          <DecisionGlyph state={decision.decision} className="h-3.5 w-3.5" />
                          {t(`tax.decision.${decision.decision}`)}
                        </span>
                        <span className="text-xs text-ink-500">
                          {t('lab.decisionSubtitle', {
                            version: decision.rule_pack_version,
                            trace: decision.trace_id,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button type="button" className="lv-btn lv-btn-secondary" onClick={copyDecision}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? t('lab.copied') : t('lab.copyJson')}
                  </button>
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <div>
                    <p className="lv-kicker mb-2">{t('tax.advisor.breakdown')}</p>
                    <table className="w-full text-sm">
                      <tbody>
                        {[
                          { label: t('tax.advisor.taxableValue'), value: decision.base_poisha, rate: '' },
                          {
                            label: t('tax.part.SD'),
                            value: decision.sd_poisha,
                            rate: decision.sd_bps ? formatPercentBps(decision.sd_bps, numeral) : '',
                          },
                          {
                            label: t('tax.part.VAT'),
                            value: decision.vat_poisha,
                            rate: decision.vat_bps ? formatPercentBps(decision.vat_bps, numeral) : '',
                          },
                          { label: t('tax.advisor.grossInvoice'), value: decision.gross_poisha, rate: '', strong: true },
                          {
                            label: t('tax.part.VDS'),
                            value: decision.vds_poisha,
                            rate: decision.vds_bps ? formatPercentBps(decision.vds_bps, numeral) : '',
                          },
                          {
                            label: t('tax.part.TDS'),
                            value: decision.tds_poisha,
                            rate: decision.tds_bps ? formatPercentBps(decision.tds_bps, numeral) : '',
                          },
                          {
                            label: t('tax.advisor.netToParty'),
                            value: decision.net_payable_poisha,
                            rate: '',
                            strong: true,
                          },
                          {
                            label: t('tax.advisor.toTreasury'),
                            value: decision.treasury_payable_poisha,
                            rate: '',
                            strong: true,
                          },
                        ].map((row) => (
                          <tr
                            key={row.label}
                            className={row.strong ? 'border-b-0' : 'border-b border-ink-100 last:border-b-0'}
                          >
                            <td className="py-1.5 pr-2 text-ink-600">
                              <span className="flex items-center gap-2">
                                {row.label}
                                {row.rate ? (
                                  <span className="lv-chip lv-chip-neutral font-money">{row.rate}</span>
                                ) : null}
                              </span>
                            </td>
                            <td
                              className={`py-1.5 text-right font-money ${
                                row.strong ? 'font-semibold text-vault-800' : 'text-ink-800'
                              }`}
                            >
                              {money(row.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-3 rounded-xl border border-ink-100 bg-ink-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="lv-kicker">{t('tax.advisor.inputCredit')}</span>
                        <span
                          className={`lv-chip ${
                            input.direction === 'SALE'
                              ? 'lv-chip-neutral'
                              : decision.input_credit.eligible
                                ? 'lv-chip-emerald'
                                : 'lv-chip-rose'
                          }`}
                        >
                          {input.direction === 'SALE'
                            ? t('common.na')
                            : decision.input_credit.eligible
                              ? t('tax.advisor.eligible')
                              : t('tax.advisor.ineligible')}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-ink-500">{t('tax.advisor.claimable')}</p>
                          <p className="font-money font-semibold text-ink-900">
                            {money(decision.input_credit.claimable_poisha)}
                          </p>
                        </div>
                        <div>
                          <p className="text-ink-500">{t('tax.advisor.disallowed')}</p>
                          <p className="font-money font-semibold text-ink-900">
                            {money(decision.input_credit.disallowed_poisha)}
                          </p>
                        </div>
                      </div>
                      {decision.input_credit.reason_labels_en.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-600">
                          {decision.input_credit.reason_labels_en.map((reason, index) => (
                            <li key={reason} className="flex gap-1.5">
                              <CircleX size={12} className="mt-0.5 shrink-0 text-rose-500" />
                              <span>
                                {localized(
                                  locale,
                                  reason,
                                  decision.input_credit.reason_labels_bn[index] ?? reason,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="lv-kicker mb-2">{t('tax.advisor.conditions')}</p>
                      <ul className="space-y-1.5">
                        {decision.conditions.map((condition, index) => (
                          <li
                            key={`${condition.code}-${index}`}
                            className="flex items-start gap-2 rounded-lg border border-ink-100 px-2.5 py-2"
                          >
                            <span className={`lv-chip shrink-0 ${severityTone(condition.severity).chip}`}>
                              {severityTone(condition.severity).icon}
                              {condition.severity}
                            </span>
                            <span className="text-[11px] leading-relaxed text-ink-600">
                              {localized(locale, condition.message_en, condition.message_bn)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {decision.filing ? (
                      <div className="rounded-xl border border-gold-200 bg-gold-50/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="lv-kicker flex items-center gap-1.5">
                            <CalendarClock size={13} /> {t('tax.filing.title')}
                          </span>
                          <span className="lv-chip lv-chip-gold">
                            {localized(locale, 'PENDING TAX-COUNSEL VERIFICATION', 'কর পরামর্শকের যাচাইয়ের অপেক্ষায়')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-ink-600">
                          {localized(
                            locale,
                            'No filing deadline is asserted by this demo. The rule pack and statutory template are not approved for filing use.',
                            'এই ডেমো কোনো দাখিলের সময়সীমা দাবি করে না। রুল প্যাক ও সংবিধিবদ্ধ টেমপ্লেট দাখিলের ব্যবহারের জন্য অনুমোদিত নয়।',
                          )}
                        </p>
                      </div>
                    ) : null}

                    <div>
                      <p className="lv-kicker mb-2">{t('tax.advisor.citations')}</p>
                      <ul className="space-y-1">
                        {decision.rule_ids.map((ruleId) => {
                          const rule = BD_2026_V1.rules.find((entry) => entry.id === ruleId);
                          return (
                            <li key={ruleId} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="rounded bg-vault-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-vault-800">
                                {ruleId}
                              </span>
                              <span className="text-ink-500">
                                {localized(locale, rule?.citation ?? '', rule?.citation ?? '')}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="border-t border-ink-100 bg-ink-50/40 px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="lv-kicker flex items-center gap-1.5">
                      <Table2 size={13} /> {t('tax.advisor.journal')}
                    </p>
                    <span className={`lv-chip ${preview.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                      {preview.balanced ? <Check size={13} /> : <CircleX size={13} />}
                      {preview.balanced ? t('lab.journalBalanced') : t('lab.journalUnbalanced')}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {preview.groups.map((group) => (
                      <div key={group.id} className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                        <div className="flex items-center justify-between border-b border-ink-100 px-3 py-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">
                            {localized(locale, group.title_en, group.title_bn)}
                          </span>
                          <span className="font-money text-[11px] text-ink-500">
                            {money(group.total_debit_poisha)}
                          </span>
                        </div>
                        <table className="lv-table text-[11px]">
                          <tbody>
                            {group.lines.map((line) => (
                              <tr key={`${group.id}-${line.line_no}`}>
                                <td className="whitespace-nowrap font-mono text-[10px] text-ink-500">
                                  {line.account_code}
                                </td>
                                <td className="min-w-0 text-ink-700">
                                  {localized(locale, line.account_name_en, line.account_name_bn)}
                                </td>
                                <td className="whitespace-nowrap text-right font-money text-ink-800">
                                  {line.debit_poisha === 0n ? '' : money(line.debit_poisha)}
                                </td>
                                <td className="whitespace-nowrap text-right font-money text-ink-800">
                                  {line.credit_poisha === 0n ? '' : money(line.credit_poisha)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1">
                    {decision.explanations_en.map((explanation, index) => (
                      <p
                        key={`explanation-${index}`}
                        className="flex gap-1.5 text-[11px] leading-relaxed text-ink-600"
                      >
                        <ArrowRight size={12} className="mt-0.5 shrink-0 text-vault-500" />
                        {localized(locale, explanation, decision.explanations_bn[index] ?? explanation)}
                      </p>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <section className="lv-card">
          <SectionHeading
            icon={<BookOpen size={16} />}
            title={t('rulepack.ruleExplorer')}
            subtitle={localized(locale, BD_2026_V1.title_en, BD_2026_V1.title_bn)}
            badge={
              <>
                <span className="lv-chip lv-chip-emerald">{RULE_PACK_VERSION}</span>
                <span className="lv-chip lv-chip-gold">{t('rulepack.reviewPending')}</span>
              </>
            }
            action={
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="lv-seg-item"
                  data-active={domain === 'ALL'}
                  onClick={() => setDomain('ALL')}
                >
                  {t('common.all')}
                </button>
                {domains.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="lv-seg-item"
                    data-active={domain === entry}
                    onClick={() => setDomain(entry)}
                  >
                    {t(`tax.part.${entry}`)}
                  </button>
                ))}
              </div>
            }
          />
          <div className="max-h-[560px] overflow-auto">
            <table className="lv-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>{t('rulepack.domain')}</th>
                  <th>{t('rulepack.ruleExplorer')}</th>
                  <th className="text-right">{t('rulepack.rate')}</th>
                  <th>{t('rulepack.citation')}</th>
                  <th>{t('rulepack.effective')}</th>
                  <th>{t('rulepack.status')}</th>
                </tr>
              </thead>
              <tbody>
                {ruleList.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <span className="lv-chip lv-chip-neutral">{rule.domain}</span>
                    </td>
                    <td className="min-w-[240px]">
                      <p className="font-medium text-ink-900">{localized(locale, rule.title_en, rule.title_bn)}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-ink-400">{rule.id}</p>
                    </td>
                    <td className="whitespace-nowrap text-right font-money">
                      {typeof rule.rate_bps === 'number' ? formatPercentBps(rule.rate_bps, numeral) : '—'}
                    </td>
                    <td className="max-w-[420px] text-[11px] leading-relaxed text-ink-500">
                      {rule.citation}
                      {rule.verify_flag ? (
                        <span className="ml-1.5 lv-chip bg-amber-50 text-amber-700">{t('tax.badge.verify')}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap font-money text-[11px] text-ink-500">
                      {rule.effective_from}
                      {rule.effective_to ? ` → ${rule.effective_to}` : ''}
                    </td>
                    <td>
                      <span
                        className={`lv-chip ${
                          rule.status === 'ACTIVE'
                            ? 'lv-chip-emerald'
                            : rule.status === 'SUPERSEDED'
                              ? 'lv-chip-gold'
                              : 'lv-chip-rose'
                        }`}
                      >
                        {rule.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lv-card">
          <SectionHeading
            icon={<FlaskConical size={16} />}
            title={t('rulepack.goldenSuite')}
            subtitle={t('rulepack.goldenSubtitle')}
            badge={
              suite ? (
                <>
                  <span className="lv-chip lv-chip-neutral">
                    {t('rulepack.passCount')}: {suite.passed}
                  </span>
                  <span className={`lv-chip ${suite.failed === 0 ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                    {t('rulepack.failCount')}: {suite.failed}
                  </span>
                  <span className="lv-chip lv-chip-neutral">
                    {suite.checks_run} {t('lab.assertions')}
                  </span>
                </>
              ) : undefined
            }
            action={
              <button type="button" className="lv-btn lv-btn-primary" onClick={runSuite}>
                {suite ? <RotateCcw size={15} /> : <Play size={15} />}
                {t('rulepack.runSuite')}
              </button>
            }
          />
          <div className="p-5">
            {suite === null ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 py-10 text-center">
                <Gauge size={22} className="text-vault-500" />
                <p className="text-sm text-ink-500">{t('lab.suiteIdle')}</p>
                <button type="button" className="lv-btn lv-btn-secondary" onClick={runSuite}>
                  <Play size={14} /> {t('rulepack.runSuite')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    allPassed
                      ? 'border-vault-200 bg-vault-50 text-vault-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  {allPassed ? <CircleCheck size={16} /> : <ShieldAlert size={16} />}
                  <span className="font-semibold">
                    {t('rulepack.suitePassed', { pass: suite.passed, fail: suite.failed })}
                  </span>
                  <span className="text-ink-500">
                    {suite.rule_pack_version} · {suite.duration_ms} ms · {t('rulepack.regression')}
                  </span>
                </div>

                <div className="overflow-hidden rounded-xl border border-ink-200">
                  <table className="lv-table">
                    <thead>
                      <tr>
                        <th className="w-10" />
                        <th>{t('lab.scenario')}</th>
                        <th>{t('common.status')}</th>
                        <th className="text-right">{t('lab.assertions')}</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {suite.results.map((result) => {
                        const expanded = expandedCase === result.id;
                        return (
                          <Fragment key={result.id}>
                            <tr
                              className="cursor-pointer"
                              tabIndex={0}
                              onClick={() => setExpandedCase(expanded ? null : result.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setExpandedCase(expanded ? null : result.id);
                                }
                              }}
                            >
                              <td>
                                {result.passed ? (
                                  <CircleCheck size={16} className="text-vault-600" />
                                ) : (
                                  <CircleX size={16} className="text-rose-600" />
                                )}
                              </td>
                              <td>
                                <p className="font-medium text-ink-900">
                                  {localized(locale, result.title_en, result.title_bn)}
                                </p>
                                <p className="mt-0.5 text-[11px] text-ink-500">
                                  <span className="font-mono text-[10px] text-ink-400">{result.id}</span> ·{' '}
                                  {result.scenario} · {result.legislation}
                                </p>
                              </td>
                              <td>
                                <span className={`lv-chip ${decisionVisuals(result.decision.decision).chip}`}>
                                  {t(`tax.decision.${result.decision.decision}`)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap text-right font-money text-ink-500">
                                {result.checks.length - result.failed_checks.length}/{result.checks.length}
                              </td>
                              <td>
                                <ChevronRight
                                  size={14}
                                  className={`text-ink-400 transition ${expanded ? 'rotate-90' : ''}`}
                                />
                              </td>
                            </tr>
                            {expanded ? (
                              <tr>
                                <td colSpan={5} className="bg-ink-50/60">
                                  {result.failed_checks.length > 0 ? (
                                    <p className="mb-2 text-xs font-semibold text-rose-700">
                                      {t('lab.firstFailure')}: {result.failed_checks[0].field} —{' '}
                                      {result.failed_checks[0].expected} ≠ {result.failed_checks[0].actual}
                                    </p>
                                  ) : null}
                                  <div className="max-h-64 overflow-auto rounded-lg border border-ink-200 bg-white">
                                    <table className="lv-table text-[11px]">
                                      <thead>
                                        <tr>
                                          <th className="w-8" />
                                          <th>{t('common.figure')}</th>
                                          <th>{t('rulepack.expected')}</th>
                                          <th>{t('rulepack.actual')}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {result.checks.map((check) => (
                                          <tr key={`${result.id}-${check.field}`}>
                                            <td>
                                              {check.passed ? (
                                                <Check size={13} className="text-vault-600" />
                                              ) : (
                                                <CircleX size={13} className="text-rose-600" />
                                              )}
                                            </td>
                                            <td className="font-mono text-[10px] text-ink-500">{check.field}</td>
                                            <td className="font-money text-ink-700">{check.expected}</td>
                                            <td
                                              className={`font-money ${
                                                check.passed ? 'text-ink-700' : 'font-semibold text-rose-700'
                                              }`}
                                            >
                                              {check.actual}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="lv-card">
            <SectionHeading
              icon={<Search size={16} />}
              title={t('lab.searchDictionary')}
              subtitle={t('lab.searchHint')}
            />
            <div className="space-y-3 p-5">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  className="lv-input pl-9"
                  value={query}
                  aria-label={t('lab.searchDictionary')}
                  placeholder={t('lab.searchDictionary')}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['kroy', 'bikroy', 'mushak', 'ifrs', 'bkash', 'tantra'].map((term) => (
                  <button
                    key={term}
                    type="button"
                    className="lv-chip lv-chip-neutral hover:bg-vault-100 hover:text-vault-900"
                    onClick={() => setQuery(term)}
                  >
                    {term}
                  </button>
                ))}
              </div>
              {hits.length === 0 ? (
                <p className="lv-hint">{t('lab.searchNoResults')}</p>
              ) : (
                <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200">
                  {hits.map((hit) => (
                    <li key={hit.key} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[10px] text-vault-700">{hit.key}</p>
                        <p className={`truncate text-xs text-ink-700 ${locale === 'bn-BD' ? 'font-bangla' : ''}`}>
                          {hit.text}
                        </p>
                      </div>
                      <span className="lv-chip lv-chip-neutral shrink-0 font-money">{hit.score}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="lv-card lv-card-pad">
              <div className="flex items-center gap-2">
                <Sigma size={16} className="text-vault-600" />
                <span className="lv-kicker">{t('lab.bigintTitle')}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-600">{t('lab.bigintSubtitle')}</p>
              <pre className="lv-code mt-3 overflow-x-auto">{jsonPatchPreview}</pre>
            </div>
            <div className="lv-card lv-card-pad">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-vault-600" />
                <span className="lv-kicker">{t('rulepack.traceability')}</span>
              </div>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-600">
                <li className="flex gap-2">
                  <BadgeCheck size={14} className="mt-0.5 shrink-0 text-vault-600" />
                  {t('tax.advisor.priceExcl')}
                </li>
                <li className="flex gap-2">
                  <BadgeCheck size={14} className="mt-0.5 shrink-0 text-vault-600" />
                  {t('tax.tds.base')}
                </li>
                <li className="flex gap-2">
                  <BadgeCheck size={14} className="mt-0.5 shrink-0 text-vault-600" />
                  {t('rulepack.regression')}
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="lv-chip lv-chip-emerald">
                  <Hash size={12} /> {decision.trace_id.slice(0, 18)}
                </span>
                <span className="lv-chip lv-chip-neutral">
                  <Landmark size={12} /> {t('tax.advisor.toTreasury')}
                </span>
              </div>
            </div>
          </div>
        </section>

        <footer className="no-print flex flex-col gap-2 border-t border-ink-200 pt-4 text-[11px] leading-relaxed text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-4xl">{t('lab.footer')}</p>
          <p className="flex shrink-0 items-center gap-1.5">
            <Wallet size={13} /> {RULE_PACK_VERSION} · {DEMO_DATE}
          </p>
        </footer>
      </main>
    </>
  );
}
