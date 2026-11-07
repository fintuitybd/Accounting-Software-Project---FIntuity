// Fintuity Accounting Suite — W12 firm cockpit + rule-pack "What Changed?" impact simulator.
//
// Left brain of a practising chartered-accountancy firm: 60 concurrent clients, their statutory
// deadlines, filing readiness and the one click that moves the working context. Right brain: the
// difference between the superseded 2025 working draft and Rule Pack bd-2026-v1, priced against a
// real client base instead of a slide.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileCheck2,
  Filter,
  Flame,
  Gavel,
  Info,
  Search,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';

import { addDays, applyRateBps, daysBetween, formatDate } from '../core/money';
import { evaluateTaxDecision } from '../core/tax-engine/engine';
import { RULE_PACK_VERSION, activeRules } from '../core/tax-engine/rulePack';
import { useVault } from '../context/VaultContext';
import { useWorkspaceNav } from '../components/layout/WorkspaceNav';
import type { TenantEntity, TaxEvaluationInput } from '../core/types';

const TODAY = '2026-11-02';
const FIRM_NAME = 'Rafiq & Associates — Chartered Accountants';

const NAME_PREFIXES = [
  'Apex', 'Meghna', 'Padma', 'Karnaphuli', 'Jamuna', 'Brahmaputra',
  'Surma', 'Teesta', 'Rupsha', 'Korotoa', 'Titas', 'Dhaleshwari',
];
const NAME_SUFFIXES = ['Trading', 'Textiles', 'Foods', 'Pharma', 'Logistics'];
const ENGAGEMENTS = [
  { en: 'VAT & TDS compliance', bn: 'ভ্যাট ও টিডিএস সমতা' },
  { en: 'Statutory audit', bn: 'বিধিবদ্ধ নিরীক্ষা' },
  { en: 'Monthly close', bn: 'মাসিক সমাপনী' },
  { en: 'RJSC secretarial', bn: 'আরজেএসসি সচিবালয়' },
  { en: 'Income tax return', bn: 'আয়কর রিটার্ন' },
  { en: 'Payroll, PF & WPPF', bn: 'পে-রোল, পিএফ ও ডাব্লিউপিপিএফ' },
];
const MANAGERS = ['Farzana Akter', 'Rafiq Chowdhury', 'Imran Hossain', 'Nasrin Sultana', 'Tanjina Rahman'];

type ClientStatus = 'READY' | 'IN_PROGRESS' | 'AT_RISK' | 'BLOCKED';

interface FirmClient {
  id: string;
  name_en: string;
  name_bn: string;
  entity: TenantEntity['entity_type'];
  engagement: { en: string; bn: string };
  period: string;
  due: string;
  readiness: number;
  status: ClientStatus;
  manager: string;
  fee_poisha: bigint;
  persona?: TenantEntity['persona_key'];
  checklist: Array<{ en: string; bn: string; done: boolean }>;
}

function buildClients(): FirmClient[] {
  const clients: FirmClient[] = [];
  for (let index = 0; index < 60; index += 1) {
    const prefix = NAME_PREFIXES[index % NAME_PREFIXES.length];
    const suffix = NAME_SUFFIXES[Math.floor(index / NAME_PREFIXES.length)];
    const isApex = index === 0;
    const isCloud = index === 1;
    const nameEn = isApex
      ? 'Apex Delta Trading Ltd.'
      : isCloud
        ? 'CloudNine Technologies Ltd.'
        : `${prefix} ${suffix} Ltd.`;
    const readiness = (index * 37 + 13) % 101;
    const status: ClientStatus =
      readiness >= 85 ? 'READY' : readiness >= 60 ? 'IN_PROGRESS' : readiness >= 35 ? 'AT_RISK' : 'BLOCKED';
    const engagement = ENGAGEMENTS[index % ENGAGEMENTS.length];
    const due = addDays('2026-11-10', Math.round((index * 50) / 59));
    clients.push({
      id: `CL-${String(index + 1).padStart(3, '0')}`,
      name_en: nameEn,
      name_bn: isApex ? 'অ্যাপেক্স ডেল্টা ট্রেডিং লিমিটেড' : isCloud ? 'ক্লাউডনাইন টেকনোলজিস লিমিটেড' : nameEn,
      entity: index % 7 === 0 ? 'PUBLIC_LISTED' : index % 5 === 0 ? 'PARTNERSHIP' : 'PRIVATE_LIMITED',
      engagement,
      period: 'Oct 2026',
      due,
      readiness,
      status,
      manager: MANAGERS[index % MANAGERS.length],
      fee_poisha: BigInt(1_800_000 + (index % 9) * 750_000),
      persona: isApex ? 'APEX' : isCloud ? 'CLOUDNINE' : undefined,
      checklist: [
        { en: 'Bank & MFS reconciliation signed', bn: 'ব্যাংক ও এমএফএস মিলন স্বাক্ষরিত', done: readiness >= 55 },
        { en: 'Subledger controls proved', bn: 'সাবলেজার নিয়ন্ত্রণ প্রমাণিত', done: readiness >= 65 },
        { en: 'VAT return Mushak 9.1 filed', bn: 'ভ্যাট রিটার্ন মূসক ৯.১ দাখিল', done: readiness >= 75 },
        { en: 'Payroll, PF & WPPF posted', bn: 'পে-রোল, পিএফ ও ডাব্লিউপিপিএফ পোস্টেড', done: readiness >= 60 },
        { en: 'Audit sign-off / board representation', bn: 'নিরীক্ষা স্বাক্ষর / বোর্ড প্রতিনিধিত্ব', done: readiness >= 88 },
      ],
    });
  }
  return clients;
}

const CLIENTS = buildClients();

const STATUS_META: Record<ClientStatus, { en: string; bn: string; tone: string; bar: string }> = {
  READY: { en: 'Filing ready', bn: 'দাখিল প্রস্তুত', tone: 'ql-badge-success', bar: 'bg-vault-600' },
  IN_PROGRESS: { en: 'In progress', bn: 'চলমান', tone: 'ql-badge-warn', bar: 'bg-gold-500' },
  AT_RISK: { en: 'At risk', bn: 'ঝুঁকিতে', tone: 'ql-badge-danger', bar: 'bg-rose-500' },
  BLOCKED: { en: 'Blocked', bn: 'অবরুদ্ধ', tone: 'bg-rose-100 text-rose-800', bar: 'bg-rose-700' },
};

export function FirmCockpit() {
  const vault = useVault();
  const { navigate } = useWorkspaceNav();
  const isBn = vault.locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const [filter, setFilter] = useState<'ALL' | ClientStatus | 'NEXT7'>('ALL');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>('CL-001');

  const active = CLIENTS.find((client) => client.id === activeId) ?? CLIENTS[0];

  const summary = useMemo(() => {
    const count = (status: ClientStatus): number => CLIENTS.filter((client) => client.status === status).length;
    const next7 = CLIENTS.filter((client) => {
      const days = daysBetween(TODAY, client.due);
      return days >= 0 && days <= 7;
    });
    const overdue = CLIENTS.filter((client) => daysBetween(TODAY, client.due) < 0);
    return {
      ready: count('READY'),
      progress: count('IN_PROGRESS'),
      risk: count('AT_RISK'),
      blocked: count('BLOCKED'),
      next7,
      overdue,
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CLIENTS.filter((client) => {
      if (filter === 'NEXT7') {
        const days = daysBetween(TODAY, client.due);
        if (days < 0 || days > 7) return false;
      } else if (filter !== 'ALL' && client.status !== filter) {
        return false;
      }
      if (!needle) return true;
      return (
        client.name_en.toLowerCase().includes(needle) ||
        client.id.toLowerCase().includes(needle) ||
        client.manager.toLowerCase().includes(needle) ||
        client.engagement.en.toLowerCase().includes(needle)
      );
    });
  }, [filter, query]);

  const switchClient = (client: FirmClient): void => {
    setActiveId(client.id);
    vault.publishToast({
      tone: 'info',
      title: L('Client context switched', 'ক্লায়েন্ট প্রসঙ্গ পরিবর্তিত'),
      message: `${client.name_en} · ${client.id} · ${L(client.engagement.en, client.engagement.bn)}`,
    });
  };

  const loadLedger = (client: FirmClient): void => {
    if (!client.persona) return;
    if (vault.activePersona === client.persona) {
      vault.publishToast({
        tone: 'info',
        title: L('Ledger already loaded', 'খতিয়ান ইতিমধ্যে লোড'),
        message: `${client.name_en} ${L('is the active tenant.', 'সক্রিয় টেন্যান্ট।')}`,
      });
      return;
    }
    vault.setPersona(client.persona);
  };

  const daysToDue = daysBetween(TODAY, active.due);

  return (
    <section className="ql-card overflow-hidden">
      <div className="ql-card-header">
        <div>
          <p className="ql-kicker flex items-center gap-1.5"><Users size={12} /> {L('Multi-client firm cockpit', 'মাল্টি-ক্লায়েন্ট ফার্ম ককপিট')}</p>
          <h2 className="mt-1 text-base font-semibold text-ink-900">{FIRM_NAME}</h2>
          <p className="ql-hint mt-1">
            {CLIENTS.length} {L('live engagements', 'সক্রিয় এনগেজমেন্ট')} · {summary.next7.length} {L('due this week', 'এই সপ্তাহে বাকি')} ·{' '}
            {summary.overdue.length} {L('overdue', 'বিলম্বিত')} · {activeRules('2026-11-02').length} {L('active rules in', 'সক্রিয় নিয়ম')} {RULE_PACK_VERSION}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="ql-badge ql-badge-success"><CheckCircle2 size={11} /> {summary.ready} {L('ready', 'প্রস্তুত')}</span>
          <span className="ql-badge ql-badge-warn"><ClipboardCheck size={11} /> {summary.progress}</span>
          <span className="ql-badge ql-badge-danger"><Flame size={11} /> {summary.risk + summary.blocked}</span>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* 60-client deadline matrix */}
        <div className="border-b border-ink-100 xl:border-b-0 xl:border-r">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/50 px-4 py-2.5">
            <div className="flex flex-wrap gap-1">
              {([
                ['ALL', L('All 60', 'সব ৬০')],
                ['NEXT7', L('Next 7 days', 'আগামী ৭ দিন')],
                ['READY', L('Ready', 'প্রস্তুত')],
                ['AT_RISK', L('At risk', 'ঝুঁকিতে')],
                ['BLOCKED', L('Blocked', 'অবরুদ্ধ')],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                    filter === key ? 'bg-vault-800 text-white' : 'bg-white text-ink-500 hover:bg-vault-50 hover:text-vault-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1">
              <Search size={11} className="text-ink-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={L('Client, manager or engagement', 'ক্লায়েন্ট, ম্যানেজার বা এনগেজমেন্ট')}
                className="w-44 bg-transparent text-[10px] text-ink-800 outline-none placeholder:text-ink-400"
              />
            </label>
            <span className="text-[10px] text-ink-400"><Filter size={10} className="mr-1 inline" />{filtered.length} / 60</span>
          </div>

          <div className="max-h-[390px] overflow-auto">
            <table className="ql-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{L('Client', 'ক্লায়েন্ট')}</th>
                  <th>{L('Engagement', 'এনগেজমেন্ট')}</th>
                  <th>{L('Deadline', 'সময়সীমা')}</th>
                  <th className="text-right">{L('Readiness', 'প্রস্তুতি')}</th>
                  <th>{L('Status', 'অবস্থা')}</th>
                  <th className="text-right">{L('Switch', 'সুইচ')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client) => {
                  const days = daysBetween(TODAY, client.due);
                  const meta = STATUS_META[client.status];
                  const selected = client.id === activeId;
                  return (
                    <tr
                      key={client.id}
                      onClick={() => switchClient(client)}
                      className={`cursor-pointer transition-colors ${selected ? 'bg-vault-50' : 'hover:bg-ink-50'}`}
                    >
                      <td>
                        <p className="text-[11px] font-semibold text-ink-900">{isBn ? client.name_bn : client.name_en}</p>
                        <p className="font-mono text-[9px] text-ink-400">{client.id} · {client.manager}</p>
                      </td>
                      <td className="text-[10px] text-ink-600">{L(client.engagement.en, client.engagement.bn)}</td>
                      <td>
                        <p className="text-[10px] text-ink-800">{formatDate(client.due, vault.locale)}</p>
                        <p className={`text-[9px] ${days < 0 ? 'text-rose-600' : days <= 7 ? 'text-amber-700' : 'text-ink-400'}`}>
                          {days < 0 ? `${Math.abs(days)}d ${L('late', 'বিলম্ব')}` : `${days}d ${L('left', 'বাকি')}`}
                        </p>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                            <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${client.readiness}%` }} />
                          </div>
                          <span className="font-money w-7 text-right text-[9px] text-ink-500">{client.readiness}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`ql-badge ${meta.tone} !px-1.5 !py-0 text-[9px]`}>{L(meta.en, meta.bn)}</span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            switchClient(client);
                          }}
                          className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold transition ${
                            selected ? 'bg-vault-800 text-white' : 'text-vault-700 hover:bg-vault-50'
                          }`}
                        >
                          {selected ? L('Active', 'সক্রিয়') : L('Open', 'খুলুন')} <ArrowRight size={9} className="inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="px-4 py-8 text-center text-[11px] text-ink-500">{L('No client matches this filter.', 'এই ফিল্টারে কোনো ক্লায়েন্ট নেই।')}</p>
            )}
          </div>
        </div>

        {/* Active client readiness panel */}
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-vault-600">{active.id} · {active.period}</p>
              <h3 className="mt-0.5 text-sm font-semibold text-ink-900">{isBn ? active.name_bn : active.name_en}</h3>
              <p className="mt-0.5 text-[10px] text-ink-500">
                {L(active.engagement.en, active.engagement.bn)} · {active.entity.replace(/_/g, ' ')} · {active.manager}
              </p>
            </div>
            <span className={`ql-badge ${STATUS_META[active.status].tone}`}>{L(STATUS_META[active.status].en, STATUS_META[active.status].bn)}</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-ink-50 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Readiness', 'প্রস্তুতি')}</p>
              <p className="font-money mt-0.5 text-[13px] font-semibold text-ink-900">{active.readiness}%</p>
            </div>
            <div className="rounded-lg bg-ink-50 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Deadline', 'সময়সীমা')}</p>
              <p className={`font-money mt-0.5 text-[12px] font-semibold ${daysToDue < 0 ? 'text-rose-600' : daysToDue <= 7 ? 'text-amber-700' : 'text-ink-900'}`}>
                {daysToDue < 0 ? `${Math.abs(daysToDue)}d ${L('late', 'বিলম্ব')}` : `${daysToDue}d`}
              </p>
            </div>
            <div className="rounded-lg bg-ink-50 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Fee', 'ফি')}</p>
              <p className="font-money mt-0.5 text-[12px] font-semibold text-ink-900">{vault.money(active.fee_poisha)}</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="ql-kicker flex items-center gap-1.5"><FileCheck2 size={11} /> {L('Filing readiness checklist', 'দাখিল প্রস্তুতি চেকলিস্ট')}</p>
            <ul className="mt-1.5 space-y-1">
              {active.checklist.map((item) => (
                <li key={item.en} className="flex items-start gap-1.5 text-[10px]">
                  {item.done ? (
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-vault-600" />
                  ) : (
                    <XCircle size={11} className="mt-0.5 shrink-0 text-ink-300" />
                  )}
                  <span className={item.done ? 'text-ink-700' : 'text-ink-400'}>{L(item.en, item.bn)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 grid gap-1.5">
            <button
              type="button"
              className="ql-btn ql-btn-primary !py-1.5 text-[11px]"
              onClick={() => {
                vault.publishToast({
                  tone: 'success',
                  title: L('Close cockpit opened for the client', 'ক্লায়েন্টের সমাপনী ককপিট খোলা হয়েছে'),
                  message: `${active.name_en} · ${L(active.engagement.en, active.engagement.bn)}`,
                });
                navigate('W09');
              }}
            >
              <ClipboardCheck size={13} /> {L('Open close & control', 'সমাপনী ও নিয়ন্ত্রণ খুলুন')}
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="ql-btn ql-btn-ghost !py-1 text-[10px]" onClick={() => navigate('W08')}>
                <FileCheck2 size={11} /> {L('Statements', 'বিবরণী')}
              </button>
              <button type="button" className="ql-btn ql-btn-ghost !py-1 text-[10px]" onClick={() => navigate('W11')}>
                <Gavel size={11} /> {L('Notices', 'নোটিশ')}
              </button>
            </div>
            {active.persona && (
              <button type="button" className="ql-btn ql-btn-secondary !py-1 text-[10px]" onClick={() => loadLedger(active)}>
                <ArrowUpRight size={11} /> {L('Load this client ledger', 'এই ক্লায়েন্টের খতিয়ান লোড')}
              </button>
            )}
          </div>

          <p className="mt-2 text-[9px] leading-relaxed text-ink-400">
            {L(
              'One click moves the working context for all 60 engagements. Two clients carry seeded demo ledgers; the rest keep their statutory profile and readiness state.',
              'এক ক্লিকে ৬০টি এনগেজমেন্টের কার্যপ্রসঙ্গ পরিবর্তিত হয়। দুটি ক্লায়েন্টে সিডেড ডেমো খতিয়ান আছে; বাকিরা বিধিবদ্ধ প্রোফাইল ও প্রস্তুতি অবস্থা ধরে রাখে।',
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// "What Changed?" — rule impact simulator
// ---------------------------------------------------------------------------------------------

const PRIOR_PACK = 'bd-2025-v4 working draft';

export function RuleImpactSimulator() {
  const vault = useVault();
  const isBn = vault.locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const [clients, setClients] = useState(60);
  const [monthlyVat, setMonthlyVat] = useState(250_000);
  const [supplierSpend, setSupplierSpend] = useState(12_000_000);
  const [prepCost, setPrepCost] = useState(4_500);
  const [discountBps, setDiscountBps] = useState(950);

  // Illustrative scenario only. The statutory filing cycle and deadlines are pending tax-counsel
  // verification; this screen must not be used as evidence of a legal rule.
  const currentReturns = 12;
  const priorReturns = 4;
  const extraReturns = Math.max(0, currentReturns - priorReturns) * clients;
  const extraFilingCost = BigInt(Math.round(extraReturns * prepCost)) * 100n;
  const annualVat = BigInt(Math.round(monthlyVat * clients)) * 100n;
  // Monthly filing pulls roughly one month of VAT forward versus a quarterly cycle.
  const financingCost = applyRateBps(annualVat, discountBps) / 12n;

  const baseInput = useMemo<TaxEvaluationInput>(
    () => ({
      direction: 'PURCHASE',
      base_poisha: BigInt(Math.round(supplierSpend)) * 100n,
      tax_category: 'STANDARD_15',
      party_name: 'Simulated supplier',
      is_withholding_entity: true,
      vds_applicable: true,
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
      has_valid_mushak63: true,
      is_reverse_charge: false,
    }),
    [supplierSpend],
  );

  const tdsGap = useMemo(() => {
    if (baseInput.base_poisha <= 0n) return 0n;
    try {
      const withTin = evaluateTaxDecision({ ...baseInput, party_tin: '138547291063' }, { evaluatedAt: '2026-11-02T09:00:00.000+06:00' });
      const noTin = evaluateTaxDecision({ ...baseInput, party_tin: undefined }, { evaluatedAt: '2026-11-02T09:00:00.000+06:00' });
      return noTin.tds_poisha - withTin.tds_poisha;
    } catch {
      return 0n;
    }
  }, [baseInput]);

  const totalCost = extraFilingCost + financingCost + tdsGap;

  const changes = [
    {
      domain: 'FILING',
      title_en: 'Quarterly → monthly Mushak 9.1',
      title_bn: 'ত্রৈমাসিক → মাসিক মূসক ৯.১',
      prior_en: 'Illustrative prior scenario only. No statutory filing cycle or deadline is asserted.',
      prior_bn: 'শুধুমাত্র দৃষ্টান্তমূলক পূর্ববর্তী দৃশ্যপট। কোনো সংবিধিবদ্ধ ফাইলিং চক্র বা সময়সীমা দাবি করা হয় না।',
      now_en: 'Illustrative scenario only: 12 returns a year. The statutory filing cycle and deadline are not verified and must be confirmed by tax counsel before use.',
      now_bn: 'শুধুমাত্র দৃষ্টান্তমূলক দৃশ্যপট: বছরে ১২টি রিটার্ন। সংবিধিবদ্ধ ফাইলিং চক্র ও সময়সীমা যাচাইকৃত নয় এবং ব্যবহারের আগে কর পরামর্শক দ্বারা নিশ্চিত করতে হবে।',
      citation: 'Pending tax-counsel verification — not a legal citation',
    },
    {
      domain: 'FILING',
      title_en: 'Holiday-adjusted due dates',
      title_bn: 'ছুটিসমন্বিত জবাবের তারিখ',
      prior_en: '2025 draft: due date fixed even when it fell on a Friday–Saturday weekend.',
      prior_bn: '২০২৫ খসড়া: শুক্র–শনিবার সাপ্তাহিক ছুটিতেও তারিখ অপরিবর্তিত।',
      now_en: 'A due date on a government holiday or the Friday–Saturday weekend moves to the next working day.',
      now_bn: 'সরকারি ছুটি বা শুক্র–শনিবার সাপ্তাহিক ছুটিতে পড়লে পরবর্তী কার্যদিবসে দাখিল হবে।',
      citation: 'Rule Pack bd-2026-v1 · FILING',
    },
    {
      domain: 'TDS',
      title_en: 'No-TIN upscale is now priced, not warned',
      title_bn: 'টিআইএন না থাকলে জরিমানা এখন মূল্যায়িত',
      prior_en: '2025 draft: no-TIN suppliers were flagged in a note but the TDS stayed at the headline rate.',
      prior_bn: '২০২৫ খসড়া: টিআইএনবিহীন সরবরাহকারী শুধু নোটে চিহ্নিত হতো, টিডিএস মূল হারেই থাকত।',
      now_en: 'Missing or malformed e-TIN upscales TDS by 50% (3% → 4.5%, 10% → 15%) and posts the extra withholding.',
      now_bn: 'ই-টিআইএন না থাকলে বা ভুল হলে টিডিএস ৫০% বৃদ্ধি (৩% → ৪.৫%, ১০% → ১৫%) এবং অতিরিক্ত কর্তন পোস্ট হয়।',
      citation: 'Income Tax Act 2023 · Rule Pack bd-2026-v1',
    },
    {
      domain: 'VAT',
      title_en: 'S.46 input-credit guard and cash limit',
      title_bn: 'ধারা ৪৬ ইনপুট-ক্রেডিট প্রহরী ও নগদ সীমা',
      prior_en: '2025 draft: input rebate accepted without proving BIN, Mushak 6.3 or the BDT 1,00,000 cash limit.',
      prior_bn: '২০২৫ খসড়া: বিআইএন, মূসক ৬.৩ বা ১,০০,০০০ টাকার নগদ সীমা প্রমাণ ছাড়াই ইনপুট রিবেট গ্রহণ।',
      now_en: 'Every purchase must prove BIN, Mushak 6.3 and non-cash settlement above BDT 1,00,000; otherwise the rebate is disallowed and capitalised.',
      now_bn: 'প্রতিটি ক্রয়ে বিআইএন, মূসক ৬.৩ ও ১,০০,০০০ টাকার বেশি নগদ-বহির্ভূত নিষ্পত্তি প্রমাণ করতে হবে; নাহলে রিবেট বাতিল ও মূলধনায়িত।',
      citation: 'VAT Act 2012 s.46 · Rule Pack bd-2026-v1',
    },
  ];

  const inputs: Array<{ label_en: string; label_bn: string; value: number; setValue: (next: number) => void; step: number; max: number }> = [
    { label_en: 'Clients in the book', label_bn: 'বইয়ে ক্লায়েন্ট', value: clients, setValue: setClients, step: 5, max: 200 },
    { label_en: 'Monthly VAT per client (BDT)', label_bn: 'প্রতি ক্লায়েন্ট মাসিক ভ্যাট (টাকা)', value: monthlyVat, setValue: setMonthlyVat, step: 25000, max: 2_000_000 },
    { label_en: 'Annual supplier spend (BDT)', label_bn: 'বার্ষিক সরবরাহ ব্যয় (টাকা)', value: supplierSpend, setValue: setSupplierSpend, step: 1_000_000, max: 60_000_000 },
    { label_en: 'Cost per return filed (BDT)', label_bn: 'প্রতি রিটার্ন ফাইলিং ব্যয় (টাকা)', value: prepCost, setValue: setPrepCost, step: 250, max: 25_000 },
  ];

  return (
    <section className="ql-card overflow-hidden">
      <div className="ql-card-header">
        <div>
          <p className="ql-kicker flex items-center gap-1.5"><Sparkles size={12} /> {L('What changed?', 'কী পরিবর্তন হলো?')}</p>
          <h2 className="mt-1 text-base font-semibold text-ink-900">
            {PRIOR_PACK} → {RULE_PACK_VERSION} {L('impact simulator', 'প্রভাব সিমুলেটর')}
          </h2>
          <p className="ql-hint mt-1">
            {L(
              'Priced against a real client book: filing frequency, cash timing and the no-TIN upscale.',
              'বাস্তব ক্লায়েন্ট বইয়ের বিপরীতে মূল্যায়িত: ফাইলিং হার, নগদ সময় ও টিআইএন-বিহীন জরিমানা।',
            )}
          </p>
        </div>
        <span className="ql-badge ql-badge-warn"><BadgeCheck size={12} /> {activeRules('2026-11-02').length} {L('active rules', 'সক্রিয় নিয়ম')}</span>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-3 border-b border-ink-100 px-5 py-4 xl:border-b-0 xl:border-r">
          <div className="grid gap-2 sm:grid-cols-2">
            {inputs.map((input) => (
              <label key={input.label_en} className="block">
                <span className="ql-kicker">{L(input.label_en, input.label_bn)}</span>
                <input
                  type="number"
                  min={0}
                  max={input.max}
                  step={input.step}
                  value={input.value}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    input.setValue(Number.isFinite(next) ? Math.max(0, next) : 0);
                  }}
                  className="ql-input mt-0.5 w-full !py-1 text-right font-mono text-[11px]"
                />
              </label>
            ))}
            <label className="block sm:col-span-2">
              <span className="ql-kicker">{L('Working-capital cost of money (bps)', 'কার্যকরী মূলধন ব্যয় (বেসিস পয়েন্ট)')}</span>
              <input
                type="range"
                min={0}
                max={1800}
                step={25}
                value={discountBps}
                onChange={(event) => setDiscountBps(Number(event.target.value))}
                className="ql-range mt-1 w-full"
              />
              <span className="font-money text-[10px] text-ink-500">{(discountBps / 100).toFixed(2)}%</span>
            </label>
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5">
            <p className="ql-kicker">{L('Annualised cost of the change', 'পরিবর্তনের বার্ষিক ব্যয়')}</p>
            <p className="font-money mt-1 border-b-4 border-double border-ink-900 pb-0.5 text-lg font-semibold text-ink-900">
              {vault.money(totalCost)}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Filing effort', 'ফাইলিং পরিশ্রম')}</p>
                <p className="font-money mt-0.5 text-[11px] font-semibold text-ink-800">{vault.money(extraFilingCost)}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Cash timing', 'নগদ সময়')}</p>
                <p className="font-money mt-0.5 text-[11px] font-semibold text-ink-800">{vault.money(financingCost)}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('No-TIN TDS', 'টিআইএন-বিহীন টিডিএস')}</p>
                <p className="font-money mt-0.5 text-[11px] font-semibold text-amber-700">{vault.money(tdsGap)}</p>
              </div>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-ink-500">
              {L(
                `${extraReturns.toLocaleString('en-US')} extra returns a year (${priorReturns} → ${currentReturns} per client). Cash timing values the one-month acceleration of VAT at the discount rate above.`,
                `বছরে ${extraReturns.toLocaleString('en-US')}টি অতিরিক্ত রিটার্ন (প্রতি ক্লায়েন্টে ${priorReturns} → ${currentReturns})। নগদ সময় উপরের ছাড় হারে ভ্যাটের এক মাস আগাম পরিশোধের মূল্য।`,
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          {changes.map((change) => (
            <article key={change.title_en} className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-semibold text-ink-900">{L(change.title_en, change.title_bn)}</p>
                <span className="ql-badge ql-badge-neutral !px-1.5 !py-0 text-[8px]">{change.domain}</span>
              </div>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                <p className="rounded-md bg-ink-50 px-2 py-1 text-[9px] leading-relaxed text-ink-500">
                  <span className="font-semibold text-ink-600">{PRIOR_PACK}: </span>
                  {L(change.prior_en, change.prior_bn)}
                </p>
                <p className="rounded-md bg-vault-50 px-2 py-1 text-[9px] leading-relaxed text-vault-900">
                  <span className="font-semibold">{RULE_PACK_VERSION}: </span>
                  {L(change.now_en, change.now_bn)}
                </p>
              </div>
              <p className="mt-1 flex items-center gap-1 font-mono text-[8px] text-ink-400"><Info size={9} /> {change.citation}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
