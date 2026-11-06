// LedgerVault — W01 Executive & CFO cockpit.
//
// The board-level landing screen, deliberately reduced to four financial KPI cards and one action
// inbox, with the composer, money-flow Sankey and 13-week stress lab tucked behind collapsible tabs.
// Every number is derived from the immutable ledger through VaultContext; all money stays BigInt
// poisha and the SVG charts never convert authoritative amounts to floating point.

import { useCallback, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Beaker,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  FileText,
  Landmark,
  Package,
  Percent,
  ReceiptText,
  RotateCcw,
  Scale,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TriangleAlert,
  Wallet,
  Zap,
} from 'lucide-react';

import { TransactionComposer } from '../components/signature/TransactionComposer';
import { MoneyFlowSankey } from '../components/svg/MoneyFlowSankey';
import { BrandMark } from '../components/brand/BrandMark';
import { addDays, applyRateBps, daysBetween, formatCount, formatDate, toBanglaDigits } from '../core/money';

import { useVault } from '../context/VaultContext';
import { useWorkspaceNav } from '../components/layout/WorkspaceNav';
import type { CashForecastWeek } from '../core/types';
import { entityTypeLabel, type WorkspaceKey } from '../workspaces/registry';


const HORIZON = 13;
const SAFETY_WEEKS = 4n;
const LOW_STOCK_THRESHOLD = 10;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type CockpitPanel = 'COMPOSE' | 'FLOW' | 'FORECAST';
type KpiTone = 'emerald' | 'gold' | 'rose' | 'sky';

const KPI_TONES: Record<KpiTone, { icon: string; bar: string; chip: string; glow: string }> = {
  emerald: {
    icon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/15',
    bar: 'from-emerald-500 via-emerald-400/50 to-transparent',
    chip: 'lv-chip-emerald',
    glow: 'bg-emerald-500',
  },
  gold: {
    icon: 'bg-gold-50 text-gold-600 dark:bg-gold-500/10 dark:text-gold-300 ring-1 ring-inset ring-gold-500/15',
    bar: 'from-gold-500 via-gold-400/50 to-transparent',
    chip: 'lv-chip-gold',
    glow: 'bg-gold-500',
  },
  rose: {
    icon: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-inset ring-rose-500/15',
    bar: 'from-rose-500 via-rose-400/50 to-transparent',
    chip: 'lv-chip-rose',
    glow: 'bg-rose-500',
  },
  sky: {
    icon: 'bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-inset ring-sky-500/15',
    bar: 'from-sky-500 via-sky-400/50 to-transparent',
    chip: 'lv-chip-neutral',
    glow: 'bg-sky-500',
  },
};

const INBOX_TONES: Record<KpiTone, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  gold: 'bg-gold-50 text-gold-600 dark:bg-gold-500/10 dark:text-gold-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
};

/** Allocate a BigInt total across weights; the last slice absorbs integer-division residue. */
function allocate(total: bigint, weights: ReadonlyArray<bigint>): bigint[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weights.length === 0 || weightTotal <= 0n) return weights.map(() => 0n);
  const slices: bigint[] = [];
  let used = 0n;
  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      slices.push(total - used);
      return;
    }
    const slice = (total * weight) / weightTotal;
    slices.push(slice);
    used += slice;
  });
  return slices;
}

function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function maxBig(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

export default function W01_ExecutiveCockpit() {
  const vault = useVault();
  const { navigate } = useWorkspaceNav();
  const {
    locale,
    numeralScript,
    grouping,
    money,
    statements,
    tenant,
    currentUser,
    auditChain,
    motionTier,
    theme,
    challans,
    commercialDocs,
    bankAccounts,
    accounts,
    items,
    statementLines,
  } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const kpis = statements.kpis;
  const firstName = currentUser.full_name.split(' ')[0] || 'there';
  const TODAY = new Date().toISOString().slice(0, 10);

  const [activePanel, setActivePanel] = useState<CockpitPanel>('COMPOSE');
  const [panelOpen, setPanelOpen] = useState(true);
  const [fxShock, setFxShock] = useState(7);
  const [buyerDelay, setBuyerDelay] = useState(10);
  const [supplierAcceleration, setSupplierAcceleration] = useState(0);
  const [restockSurge, setRestockSurge] = useState(12);

  const compactMoney = useCallback(
    (poisha: bigint): string => {
      const negative = poisha < 0n;
      const abs = negative ? -poisha : poisha;
      let text: string;
      if (grouping === 'MILLIONS') {
        const million = 100_000_000n;
        const thousand = 100_000n;
        if (abs >= million) text = `${(Number(abs) / Number(million)).toFixed(2)}M`;
        else if (abs >= thousand) text = `${(Number(abs) / Number(thousand)).toFixed(1)}K`;
        else text = `${Math.round(Number(abs) / 100)}`;
      } else {
        const crore = 1_000_000_000n;
        const lakh = 10_000_000n;
        const thousand = 100_000n;
        if (abs >= crore) text = `${(Number(abs) / Number(crore)).toFixed(2)} Cr`;
        else if (abs >= lakh) text = `${(Number(abs) / Number(lakh)).toFixed(2)} L`;
        else if (abs >= thousand) text = `${(Number(abs) / Number(thousand)).toFixed(1)} K`;
        else text = `${Math.round(Number(abs) / 100)}`;
      }
      const localized = numeralScript === 'bn' ? toBanglaDigits(text) : text;
      return `৳ ${negative ? '−' : ''}${localized}`;
    },
    [grouping, numeralScript],
  );

  // ---- Liquidity -------------------------------------------------------------------------
  const liquidity = useMemo(() => {
    const byCode = new Map(statements.trial_balance.map((row) => [row.account_code, row.balance_poisha]));
    const rows = bankAccounts.map((account) => ({
      ...account,
      balance_poisha: byCode.get(account.account_code) ?? account.opening_poisha,
    }));
    const total = rows.reduce((sum, account) => sum + maxBig(account.balance_poisha, 0n), 0n);
    const opening = rows.reduce((sum, account) => sum + account.opening_poisha, 0n);
    return { rows, total: total > 0n ? total : kpis.cash_poisha, opening };
  }, [bankAccounts, statements.trial_balance, kpis.cash_poisha]);

  const openingToNow = liquidity.total - liquidity.opening;
  const openingPct =
    liquidity.opening !== 0n ? Number((openingToNow * 1000n) / absBig(liquidity.opening)) / 10 : 0;
  const runwayMonths = kpis.expenses_poisha > 0n ? Number(liquidity.total) / Number(kpis.expenses_poisha) : 0;
  const mfsTotal = liquidity.rows
    .filter((account) => account.kind === 'MFS')
    .reduce((sum, account) => sum + maxBig(account.balance_poisha, 0n), 0n);

  // ---- Aging KPIs ------------------------------------------------------------------------
  const receivables = useMemo(() => {
    const open = commercialDocs
      .filter(
        (doc) =>
          doc.doc_type === 'SALES_INVOICE' &&
          doc.status !== 'REVERSED' &&
          doc.gross_poisha > doc.settled_poisha,
      )
      .map((doc) => ({ doc, outstanding: doc.gross_poisha - doc.settled_poisha }));
    const overdue = open.filter((entry) => entry.doc.due_date < TODAY);
    const total = open.reduce((sum, entry) => sum + entry.outstanding, 0n);
    const overdueTotal = overdue.reduce((sum, entry) => sum + entry.outstanding, 0n);
    const worstDays = overdue.reduce(
      (highest, entry) => Math.max(highest, Math.max(0, daysBetween(entry.doc.due_date, TODAY))),
      0,
    );
    const nextDue = open
      .map((entry) => entry.doc.due_date)
      .filter((date) => date >= TODAY)
      .sort()[0] ?? null;
    return { openCount: open.length, total, overdueCount: overdue.length, overdueTotal, worstDays, nextDue };
  }, [commercialDocs]);

  const payables = useMemo(() => {
    const isPurchase = (docType: string): boolean =>
      docType === 'PURCHASE_BILL' || docType === 'EXPENSE_VOUCHER' || docType === 'IMPORTED_SERVICE';
    const open = commercialDocs
      .filter(
        (doc) =>
          isPurchase(doc.doc_type) &&
          doc.status !== 'REVERSED' &&
          doc.gross_poisha > doc.settled_poisha,
      )
      .map((doc) => ({ doc, outstanding: doc.gross_poisha - doc.settled_poisha }));
    const overdue = open.filter((entry) => entry.doc.due_date < TODAY);
    const total = open.reduce((sum, entry) => sum + entry.outstanding, 0n);
    const overdueTotal = overdue.reduce((sum, entry) => sum + entry.outstanding, 0n);
    const nextDue = open
      .map((entry) => entry.doc.due_date)
      .filter((date) => date >= TODAY)
      .sort()[0] ?? null;
    return { openCount: open.length, total, overdueCount: overdue.length, overdueTotal, nextDue };
  }, [commercialDocs]);

  // ---- Statutory tax ---------------------------------------------------------------------
  const outputVat = maxBig(kpis.output_vat_poisha, 0n);
  const inputVat = maxBig(kpis.input_vat_poisha, 0n);
  const netVat = outputVat - inputVat;
  const netVatPayable = netVat > 0n ? netVat : 0n;
  const vdsPayable = maxBig(kpis.vds_payable_poisha, 0n);
  const tdsPayable = maxBig(kpis.tds_payable_poisha, 0n);
  const taxPayable = netVatPayable + vdsPayable + tdsPayable;

  // ---- Action required inbox -------------------------------------------------------------
  const pendingApprovals = useMemo(() => {
    const pending = (doc: (typeof commercialDocs)[number]): boolean =>
      doc.workflow_stage === 'SALES_ORDER' ||
      doc.workflow_stage === 'PURCHASE_ORDER' ||
      doc.status === 'SUBMITTED';
    const sales = commercialDocs.filter(
      (doc) => (doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE') && pending(doc),
    ).length;
    const purchase = commercialDocs.filter(
      (doc) =>
        (doc.doc_type === 'PURCHASE_BILL' ||
          doc.doc_type === 'EXPENSE_VOUCHER' ||
          doc.doc_type === 'IMPORTED_SERVICE') &&
        pending(doc),
    ).length;
    return { sales, purchase };
  }, [commercialDocs]);

  const unmatchedBankLines = useMemo(
    () => statementLines.filter((line) => line.status === 'UNMATCHED'),
    [statementLines],
  );
  const pendingVdsChallans = useMemo(
    () =>
      challans.filter(
        (challan) => challan.type === 'VDS' && (challan.status === 'PENDING' || challan.status === 'BATCHED'),
      ),
    [challans],
  );
  const lowStockItems = useMemo(
    () =>
      items.filter(
        (item) => item.is_stock_item !== false && (item.qty_on_hand ?? 0) <= LOW_STOCK_THRESHOLD,
      ),
    [items],
  );

  const actionItems: Array<{
    id: string;
    count: number;
    label: string;
    hint: string;
    icon: typeof FileText;
    tone: KpiTone;
    target: WorkspaceKey;
  }> = [
    {
      id: 'approvals',
      count: pendingApprovals.sales + pendingApprovals.purchase,
      label: L('Pending SO / PO approvals', 'অনুমোদন বাকি SO / PO'),
      hint: `${formatCount(pendingApprovals.sales, numeralScript)} SO · ${formatCount(pendingApprovals.purchase, numeralScript)} PO`,
      icon: FileText,
      tone: 'gold',
      target: pendingApprovals.sales > 0 ? 'W02' : 'W03',
    },
    {
      id: 'bank',
      count: unmatchedBankLines.length,
      label: L('Unreconciled bank lines', 'অমিলিত ব্যাংক লাইন'),
      hint: L('Statement lines to match', 'মিলানোর অপেক্ষায় বিবরণী'),
      icon: Wallet,
      tone: 'rose',
      target: 'W06',
    },
    {
      id: 'vds',
      count: pendingVdsChallans.length,
      label: L('Pending VDS challans', 'বাকি ভিডিএস চালান'),
      hint: L('Awaiting Treasury deposit', 'কোষাগারে জমার অপেক্ষায়'),
      icon: Landmark,
      tone: 'gold',
      target: 'W04',
    },
    {
      id: 'stock',
      count: lowStockItems.length,
      label: L('Low-stock items', 'কম মজুদের আইটেম'),
      hint: L(`At or below ${LOW_STOCK_THRESHOLD} units`, `${LOW_STOCK_THRESHOLD} ইউনিট বা কম`),
      icon: Package,
      tone: 'sky',
      target: 'W03',
    },
  ];
  const totalActions = actionItems.reduce((sum, item) => sum + item.count, 0);

  // ---- Money flow ------------------------------------------------------------------------
  const flow = useMemo(() => {
    const revenue = maxBig(kpis.revenue_poisha, 0n);
    const output = maxBig(kpis.output_vat_poisha, 0n);
    const vds = maxBig(kpis.vds_payable_poisha, 0n);
    const tds = maxBig(kpis.tds_payable_poisha, 0n);

    const salesDocs = commercialDocs.filter(
      (doc) => doc.doc_type === 'SALES_INVOICE' && doc.status !== 'REVERSED',
    );
    const byParty = new Map<string, { name_en: string; name_bn: string; amount: bigint; category: string }>();
    salesDocs.forEach((doc) => {
      if (doc.base_poisha <= 0n) return;
      const current = byParty.get(doc.party_id) ?? {
        name_en: doc.party_name_en,
        name_bn: doc.party_name_bn,
        amount: 0n,
        category: doc.tax_category,
      };
      current.amount += doc.base_poisha;
      byParty.set(doc.party_id, current);
    });
    const ranked = [...byParty.values()].sort((left, right) => (left.amount > right.amount ? -1 : 1));
    const top = ranked.slice(0, 3);
    const otherTotal = ranked.slice(3).reduce((sum, entry) => sum + entry.amount, 0n);
    const streams =
      top.length > 0
        ? top.map((entry) => ({
            name_en: entry.name_en,
            name_bn: entry.name_bn,
            amount: entry.amount,
            category: entry.category,
          }))
        : revenue > 0n
          ? [{ name_en: 'Operating revenue', name_bn: 'পরিচালন আয়', amount: revenue, category: 'STANDARD_15' }]
          : [];
    if (otherTotal > 0n) {
      streams.push({
        name_en: 'Other customers',
        name_bn: 'অন্যান্য ক্রেতা',
        amount: otherTotal,
        category: 'STANDARD_15',
      });
    }
    const streamTotal = streams.reduce((sum, stream) => sum + stream.amount, 0n);
    const channelAmounts = allocate(
      revenue,
      streams.length > 0 && streamTotal > 0n ? streams.map((stream) => stream.amount) : [1n],
    );

    const rawTreasury = output + vds + tds;
    const treasuryTotal = rawTreasury > revenue ? revenue : rawTreasury;
    const treasurySlices = allocate(
      treasuryTotal,
      [output, vds, tds].some((amount) => amount > 0n) ? [output, vds, tds] : [1n, 1n, 1n],
    );

    const trialByCode = new Map(statements.trial_balance.map((row) => [row.account_code, row.balance_poisha]));
    const cogsWeight = accounts
      .filter((account) => account.sub_category === 'COST_OF_SALES')
      .reduce((sum, account) => sum + maxBig(trialByCode.get(account.code) ?? 0n, 0n), 0n);
    const opexWeight = accounts
      .filter((account) => account.sub_category === 'OPERATING_EXPENSE')
      .reduce((sum, account) => sum + maxBig(trialByCode.get(account.code) ?? 0n, 0n), 0n);
    const costCap = revenue - treasuryTotal;
    const retainedTarget = maxBig(kpis.net_profit_poisha, 0n);
    const retained = retainedTarget > costCap ? (costCap > 0n ? costCap : 0n) : retainedTarget;
    const costTotal = costCap > retained ? costCap - retained : 0n;
    const costSlices = allocate(
      costTotal,
      cogsWeight > 0n || opexWeight > 0n ? [cogsWeight, opexWeight] : [62n, 38n],
    );

    return {
      revenue,
      streams: streams.map((stream, index) => ({
        ...stream,
        amount: channelAmounts[index] ?? 0n,
      })),
      output,
      vds,
      tds,
      treasuryTotal,
      treasurySlices,
      costSlices,
      retained,
    };
  }, [
    commercialDocs,
    accounts,
    statements.trial_balance,
    kpis.revenue_poisha,
    kpis.output_vat_poisha,
    kpis.vds_payable_poisha,
    kpis.tds_payable_poisha,
    kpis.expenses_poisha,
    kpis.net_profit_poisha,
  ]);

  const categoryHint = (category: string): { en: string; bn: string } => {
    switch (category) {
      case 'TRADING_5':
        return { en: 'Trading 5% · retail channel', bn: 'ট্রেডিং ৫% · খুচরা চ্যানেল' };
      case 'EXPORT_ZERO':
        return { en: 'Zero-rated export receipts', bn: 'শূন্য-হার রপ্তানি আদায়' };
      case 'EXEMPT':
        return { en: 'Exempt supplies', bn: 'অব্যহত সরবরাহ' };
      default:
        return { en: 'Standard-rated B2B · 15%', bn: 'প্রমিত হার বিজ-টু-বি · ১৫%' };
    }
  };

  const flowChannels = flow.streams
    .filter((stream) => stream.amount > 0n)
    .map((stream, index) => ({
      id: `stream-${index}`,
      label: L(stream.name_en, stream.name_bn),
      amount_poisha: stream.amount,
      tone: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef'][index % 4],
      hint: L(categoryHint(stream.category).en, categoryHint(stream.category).bn),
    }));

  const flowSinks = [
    {
      id: 'cogs',
      label: L('Cost of sales', 'বিক্রয় ব্যয়'),
      amount_poisha: flow.costSlices[0],
      tone: '#312e81',
      hint: L('COGS, inventory and direct cost', 'সিওজিএস, মজুদ ও প্রত্যক্ষ ব্যয়'),
    },
    {
      id: 'opex',
      label: L('Operating expenses', 'পরিচালন ব্যয়'),
      amount_poisha: flow.costSlices[1],
      tone: '#6366f1',
      hint: L('Payroll, rent and overheads', 'বেতন, ভাড়া ও ওভারহেড'),
    },
    {
      id: 'vat',
      label: L('VAT treasury outflow', 'ভ্যাট কোষাগার বহির্গমন'),
      amount_poisha: flow.treasurySlices[0],
      tone: '#a855f7',
      hint: L('Mushak 9.1 net payable', 'মূসক ৯.১ নিট প্রদেয়'),
    },
    {
      id: 'vds',
      label: L('VDS treasury outflow', 'ভিডিএস কোষাগার বহির্গমন'),
      amount_poisha: flow.treasurySlices[1],
      tone: '#c084fc',
      hint: L('Mushak 6.6 deposits', 'মূসক ৬.৬ জমা'),
    },
    {
      id: 'tds',
      label: L('TDS treasury outflow', 'টিডিএস কোষাগার বহির্গমন'),
      amount_poisha: flow.treasurySlices[2],
      tone: '#f472b6',
      hint: L('Section 86A withholding', 'ধারা ৮৬এ কর্তন'),
    },
    {
      id: 'retained',
      label: L('Net cash retained', 'সঞ্চিত নিট নগদ'),
      amount_poisha: flow.retained,
      tone: theme === 'DARK' ? '#34d399' : '#10b981',
      hint: L('Residual after cost and treasury', 'ব্যয় ও কোষাগারের পর অবশিষ্ট'),
    },
  ].filter((sink) => sink.amount_poisha > 0n);

  // ---- 13-week forecast ------------------------------------------------------------------
  const forecast = useMemo<CashForecastWeek[]>(() => {
    const salesRun = kpis.revenue_poisha / BigInt(HORIZON);
    const costRun = kpis.expenses_poisha / BigInt(HORIZON);
    const deferWeeks = Math.min(HORIZON, Math.max(0, Math.ceil(buyerDelay / 7)));
    const deferred = applyRateBps(salesRun, 3000);
    const fxDelta = applyRateBps(applyRateBps(costRun, 3500), fxShock * 100);
    const surge = applyRateBps(applyRateBps(costRun, 2500), restockSurge * 100);
    const acceleration = applyRateBps(costRun, Math.round((supplierAcceleration / 15) * 2000));
    const accelerationRelease = (acceleration * 3n) / 10n;
    const rows: CashForecastWeek[] = [];
    let opening = liquidity.total;
    let parked = 0n;
    for (let index = 0; index < HORIZON; index += 1) {
      let inflow = salesRun;
      if (deferWeeks > 0) {
        if (index < deferWeeks) {
          inflow -= deferred;
          parked += deferred;
        } else if (index === deferWeeks) {
          inflow += parked;
          parked = 0n;
        }
      }
      let outflow = costRun + fxDelta;
      if (index >= 1 && index <= 4) outflow += surge;
      if (index < 3) outflow += acceleration;
      else outflow -= accelerationRelease;
      outflow = maxBig(outflow, 0n);
      const net = inflow - outflow;
      const closing = opening + net;
      rows.push({
        week: index + 1,
        week_start: addDays(TODAY, index * 7),
        label: L(`Week ${index + 1}`, `সপ্তাহ ${index + 1}`),
        inflow_poisha: inflow,
        outflow_poisha: outflow,
        net_poisha: net,
        closing_poisha: closing,
      });
      opening = closing;
    }
    return rows;
  }, [
    kpis.revenue_poisha,
    kpis.expenses_poisha,
    liquidity.total,
    fxShock,
    buyerDelay,
    supplierAcceleration,
    restockSurge,
    locale,
  ]);

  const safetyFloor = useMemo(() => {
    const weekly = kpis.expenses_poisha / BigInt(HORIZON);
    const opexFloor = weekly * SAFETY_WEEKS;
    // Board risk appetite: never let more than 5% of opening liquidity evaporate in the horizon.
    const riskFloor = applyRateBps(liquidity.total, 9500);
    return maxBig(opexFloor, riskFloor);
  }, [kpis.expenses_poisha, liquidity.total]);

  const opexFloor = useMemo(
    () => (kpis.expenses_poisha / BigInt(HORIZON)) * SAFETY_WEEKS,
    [kpis.expenses_poisha],
  );

  const trough = forecast.reduce(
    (low, week) => (week.closing_poisha < low.closing_poisha ? week : low),
    forecast[0] ?? {
      week: 1,
      week_start: TODAY,
      label: 'Week 1',
      inflow_poisha: 0n,
      outflow_poisha: 0n,
      net_poisha: 0n,
      closing_poisha: 0n,
    },
  );
  const closingCash = forecast[HORIZON - 1]?.closing_poisha ?? 0n;
  const belowFloorWeeks = forecast.filter((week) => week.closing_poisha < safetyFloor);
  const negativeWeeks = forecast.filter((week) => week.closing_poisha < 0n);
  const firstBelow = belowFloorWeeks[0];
  const runwayWeeks = firstBelow ? firstBelow.week : null;
  const cushion = closingCash - safetyFloor;

  const applyPreset = (preset: 'BASE' | 'FX' | 'COLLECT' | 'CRUNCH'): void => {
    switch (preset) {
      case 'BASE':
        setFxShock(0);
        setBuyerDelay(0);
        setSupplierAcceleration(0);
        setRestockSurge(0);
        break;
      case 'FX':
        setFxShock(15);
        setBuyerDelay(10);
        setSupplierAcceleration(0);
        setRestockSurge(12);
        break;
      case 'COLLECT':
        setFxShock(7);
        setBuyerDelay(45);
        setSupplierAcceleration(0);
        setRestockSurge(20);
        break;
      default:
        setFxShock(15);
        setBuyerDelay(30);
        setSupplierAcceleration(15);
        setRestockSurge(35);
        break;
    }
  };

  const sliders = [
    {
      id: 'fx',
      label: L('USD exchange-rate shock', 'ইউএসডি বিনিময় হার ধাক্কা'),
      value: fxShock,
      max: 15,
      suffix: '%',
      hint: L('Applied to the 35% imported-cost share', '৩৫% আমদানি ব্যয়ে প্রয়োগ'),
      icon: <Percent size={12} />,
      set: setFxShock,
    },
    {
      id: 'delay',
      label: L('Top customer collection delay', 'শীর্ষ ক্রেতা আদায় বিলম্ব'),
      value: buyerDelay,
      max: 45,
      suffix: L(' days', ' দিন'),
      hint: L('Defers 30% of weekly collections', 'সাপ্তাহিক আদায়ের ৩০% বিলম্বিত'),
      icon: <Clock3 size={12} />,
      set: setBuyerDelay,
    },
    {
      id: 'supplier',
      label: L('Supplier payment acceleration', 'সরবরাহকারী পরিশোধ ত্বরান্বিত'),
      value: supplierAcceleration,
      max: 15,
      suffix: L(' days', ' দিন'),
      hint: L('Pulls up to 20% of payables forward', 'সর্বোচ্চ ২০% প্রদেয় আগে পরিশোধ'),
      icon: <ArrowUpRight size={12} />,
      set: setSupplierAcceleration,
    },
    {
      id: 'restock',
      label: L('Inventory restock surge', 'মজুদ পুনঃভরণ বৃদ্ধি'),
      value: restockSurge,
      max: 40,
      suffix: '%',
      hint: L('Weeks 2–5 · 25% restock base', 'সপ্তাহ ২–৫ · ২৫% ভিত্তি'),
      icon: <Zap size={12} />,
      set: setRestockSurge,
    },
  ];

  const handlePosted = useCallback((): void => undefined, []);

  const panelTabs: ReadonlyArray<{
    key: CockpitPanel;
    icon: typeof Sparkles;
    title_en: string;
    title_bn: string;
    hint_en: string;
    hint_bn: string;
  }> = [
    {
      key: 'COMPOSE',
      icon: Sparkles,
      title_en: 'Composer',
      title_bn: 'কম্পোজার',
      hint_en: 'Describe a transaction',
      hint_bn: 'লেনদেন বর্ণনা করুন',
    },
    {
      key: 'FLOW',
      icon: Activity,
      title_en: 'Cash flow',
      title_bn: 'নগদ প্রবাহ',
      hint_en: 'Money-flow Sankey',
      hint_bn: 'অর্থপ্রবাহ সাঙ্কি',
    },
    {
      key: 'FORECAST',
      icon: Beaker,
      title_en: '13-week forecast',
      title_bn: '১৩ সপ্তাহের পূর্বাভাস',
      hint_en: 'Stress sandbox',
      hint_bn: 'স্ট্রেস স্যান্ডবক্স',
    },
  ];

  const choosePanel = (key: CockpitPanel): void => {
    if (key === activePanel) {
      setPanelOpen((open) => !open);
      return;
    }
    setActivePanel(key);
    setPanelOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Masthead -------------------------------------------------------------------------- */}
      <section
        className="relative overflow-hidden rounded-[24px] border border-white/[0.08] shadow-panel"
        style={{
          backgroundImage:
            'radial-gradient(900px 480px at 6% -10%, rgba(99,102,241,.52), transparent 60%), radial-gradient(720px 460px at 100% -6%, rgba(168,85,247,.38), transparent 56%), radial-gradient(680px 440px at 52% 128%, rgba(16,185,129,.17), transparent 60%), linear-gradient(135deg, #090913 0%, #101026 54%, #0a0a16 100%)',
        }}
      >
        <div aria-hidden className="hero-grid absolute inset-0 opacity-70" />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-24 h-64 w-64 rounded-full bg-indigo-500/25 blur-[90px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-[100px]"
        />

        <div className="relative grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-center xl:gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <BrandMark size={32} glow={false} className="!rounded-[10px] ring-white/25" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[8.5px] font-bold uppercase tracking-[0.2em] text-white/45">
                  {L('Workspace 01 · Executive cockpit', 'ওয়ার্কস্পেস ০১ · নির্বাহী ককপিট')}
                  <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
                  <span className="font-mono normal-case tracking-[0.02em] text-white/35">
                    {tenant.fiscal_year_label}
                  </span>
                </p>
                <p className="mt-0.5 text-[9.5px] text-white/45">
                  {L(tenant.name_en, tenant.name_bn)}
                  <span className="mx-1.5 text-white/20">·</span>
                  {entityTypeLabel(tenant.entity_type, isBn)}
                </p>
              </div>
            </div>

            <h1 className="mt-4 text-[30px] font-semibold leading-[1.04] tracking-[-0.045em] text-white text-balance sm:text-[38px]">
              {L(`Good morning, ${firstName}.`, `শুভ সকাল, ${firstName}।`)}
            </h1>
            <p className="mt-2.5 max-w-2xl text-[11.5px] leading-relaxed text-white/55 sm:text-[12px]">
              {L(
                `${statements.period.label_en} management accounts are live from the posted ledger. The VAT template and filing deadline are not verified; the return remains an internal draft.`,
                `${statements.period.label_bn} ব্যবস্থাপনা হিসাব পোস্টকৃত খতিয়ান থেকে লাইভ। ভ্যাট টেমপ্লেট ও দাখিলের সময়সীমা যাচাইকৃত নয়; রিটার্ন অভ্যন্তরীণ খসড়া হিসেবে থাকছে।`,
              )}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.055] px-2.5 py-1 text-[9px] font-semibold text-white/60">
                <CalendarClock size={10} className="text-white/40" />
                {L(statements.period.label_en, statements.period.label_bn)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[9px] font-semibold text-emerald-300">
                <ShieldCheck size={10} />
                {auditChain.valid ? L('Audit chain intact', 'অডিট চেইন অটুট') : L('Audit chain review', 'অডিট চেইন পর্যালোচনা')}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold ${
                  statements.balance_sheet.balanced
                    ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
                    : 'border-rose-400/25 bg-rose-400/[0.1] text-rose-300'
                }`}
              >
                <Scale size={10} />
                {statements.balance_sheet.balanced ? L('Books balanced', 'বই সুষম') : L('Books out', 'বই অসুষম')}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.09] bg-white/[0.055] px-2.5 py-1 text-[9px] font-semibold text-white/55">
                <Building2 size={10} className="text-white/40" />
                {entityTypeLabel(tenant.entity_type, isBn)}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('W08')}
                className="group inline-flex items-center gap-1.5 rounded-xl bg-[#ffffff] px-3 py-2 text-[10.5px] font-bold text-[#0b0b16] shadow-lift transition hover:-translate-y-px hover:bg-[#f1f1f7]"
              >
                <ReceiptText size={12} />
                {L('Board pack', 'বোর্ড প্যাক')}
                <ArrowUpRight size={11} className="opacity-50 transition group-hover:opacity-100" />
              </button>
              <button
                type="button"
                onClick={() => navigate('W09')}
                className="group inline-flex items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 py-2 text-[10.5px] font-semibold text-white ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.14]"
              >
                <ShieldCheck size={12} className="text-emerald-300" />
                {L('Close checklist', 'সমাপনী চেকলিস্ট')}
                <ArrowUpRight size={11} className="text-white/40 transition group-hover:text-white/80" />
              </button>
              <span className="ml-1 hidden items-center gap-1.5 text-[8.5px] font-medium text-white/35 sm:inline-flex">
                <span className="h-1 w-1 rounded-full bg-white/30" />
                {L('Live from the immutable ledger', 'অপরিবর্তনীয় খতিয়ান থেকে লাইভ')}
              </span>
            </div>
          </div>

          {/* VAT template review status. No unverified filing deadline is displayed. */}
          <aside className="relative rounded-2xl border border-white/[0.09] bg-white/[0.055] p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/40">
                {L('VAT 9.1 · internal draft', 'ভ্যাট ৯.১ · অভ্যন্তরীণ খসড়া')}
              </p>
              <span className="rounded-full bg-amber-400/[0.14] px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-[0.08em] text-amber-200 ring-1 ring-inset ring-amber-400/25">
                {L('Review', 'পর্যালোচনা')}
              </span>
            </div>
            <p className="mt-3 text-[22px] font-semibold leading-none tracking-[-0.03em] text-white">
              {L('DRAFT — NOT FILED', 'খসড়া — দাখিল হয়নি')}
            </p>
            <p className="mt-2 text-[9.5px] leading-relaxed text-white/45">
              {L(
                'The statutory template, line labels and filing deadline are not verified. Tax counsel must review the register mapping and GL proof before any external filing.',
                'সংবিধিবদ্ধ টেমপ্লেট, লাইন লেবেল ও দাখিলের সময়সীমা যাচাইকৃত নয়। কোনো বাহ্যিক দাখিলের আগে কর পরামর্শককে রেজিস্টার ম্যাপিং ও জিএল প্রমাণ পর্যালোচনা করতে হবে।',
              )}
            </p>
            <button
              type="button"
              onClick={() => navigate('W05')}
              className="group mt-3 flex w-full items-center justify-between gap-2 rounded-xl bg-white/[0.08] px-2.5 py-2 text-left ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.14]"
            >
              <span className="min-w-0">
                <span className="block text-[8px] font-semibold uppercase tracking-[0.1em] text-white/35">
                  {L('Net tax payable', 'নিট কর প্রদেয়')}
                </span>
                <span className="font-money mt-0.5 block truncate text-[12px] font-semibold text-white">
                  {money(taxPayable)}
                </span>
              </span>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/10 text-white/70 transition group-hover:bg-white/20 group-hover:text-white">
                <ArrowUpRight size={12} />
              </span>
            </button>
          </aside>
        </div>
      </section>

      {/* Top row: four financial KPI cards + action inbox ---------------------------------- */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <KpiCard
            icon={Wallet}
            tone="emerald"
            title={L('Cash & bank', 'নগদ ও ব্যাংক')}
            value={money(liquidity.total)}
            chip={`${openingPct >= 0 ? '+' : ''}${openingPct.toFixed(1)}%`}
            caption={L(
              `${liquidity.rows.length} accounts · ${compactMoney(mfsTotal)} in MFS`,
              `${liquidity.rows.length} হিসাব · এমএফএসে ${compactMoney(mfsTotal)}`,
            )}
            detail={
              openingToNow >= 0n
                ? L(`Up ${compactMoney(absBig(openingToNow))} vs opening`, `প্রারম্ভিকের চেয়ে ${compactMoney(absBig(openingToNow))} বেশি`)
                : L(`Down ${compactMoney(absBig(openingToNow))} vs opening`, `প্রারম্ভিকের চেয়ে ${compactMoney(absBig(openingToNow))} কম`)
            }
            cta={L('Banking', 'ব্যাংকিং')}
            footer={`${runwayMonths.toFixed(1)} ${L('months runway', 'মাস রানওয়ে')}`}
            onClick={() => navigate('W06')}
          />
          <KpiCard
            icon={ReceiptText}
            tone={receivables.overdueCount > 0 ? 'rose' : 'emerald'}
            title={L('AR overdue', 'প্রাপ্য বকেয়া')}
            value={money(receivables.overdueTotal)}
            chip={receivables.overdueCount > 0 ? `${formatCount(receivables.overdueCount, numeralScript)} ${L('overdue', 'বকেয়া')}` : L('Clear', 'পরিষ্কার')}
            caption={L(
              `${receivables.openCount} open invoices · ${compactMoney(receivables.total)} outstanding`,
              `${receivables.openCount} খোলা চালান · বকেয়া ${compactMoney(receivables.total)}`,
            )}
            detail={
              receivables.overdueCount > 0
                ? L(`Worst ${receivables.worstDays} days past due`, `সর্বোচ্চ ${receivables.worstDays} দিন বিলম্বিত`)
                : L('No invoice past its due date', 'কোনো চালান মেয়াদোত্তীর্ণ নয়')
            }
            cta={L('Sales & O2C', 'বিক্রয় ও O2C')}
            footer={
              receivables.nextDue
                ? `${L('Next due', 'পরবর্তী মেয়াদ')} ${formatDate(receivables.nextDue, locale)}`
                : L('No AR due', 'কোনো প্রাপ্য বাকি নেই')
            }
            onClick={() => navigate('W02')}
          />
          <KpiCard
            icon={ShoppingCart}
            tone={payables.overdueCount > 0 ? 'rose' : 'gold'}
            title={L('AP due', 'প্রদেয়')}
            value={money(payables.total)}
            chip={payables.overdueCount > 0 ? `${formatCount(payables.overdueCount, numeralScript)} ${L('overdue', 'বকেয়া')}` : L('Clear', 'পরিষ্কার')}
            caption={L(
              `${payables.openCount} open bills · ${compactMoney(payables.overdueTotal)} overdue`,
              `${payables.openCount} খোলা বিল · বকেয়া ${compactMoney(payables.overdueTotal)}`,
            )}
            detail={
              payables.nextDue
                ? L(`Next due ${formatDate(payables.nextDue, locale)}`, `পরবর্তী মেয়াদ ${formatDate(payables.nextDue, locale)}`)
                : L('No supplier bill outstanding', 'কোনো সরবরাহকারী বিল বাকি নেই')
            }
            cta={L('Purchases & P2P', 'ক্রয় ও P2P')}
            footer={`${formatCount(payables.openCount, numeralScript)} ${L('bills in queue', 'বিল তালিকায়')}`}
            onClick={() => navigate('W03')}
          />
          <KpiCard
            icon={Landmark}
            tone="gold"
            title={L('Net tax payable · 15th', 'নিট কর প্রদেয় · ১৫ তারিখ')}
            value={money(taxPayable)}
            chip={L('DRAFT', 'খসড়া')}
            caption={L(
              `VAT ${compactMoney(netVatPayable)} · VDS ${compactMoney(vdsPayable)} · TDS ${compactMoney(tdsPayable)}`,
              `ভ্যাট ${compactMoney(netVatPayable)} · ভিডিএস ${compactMoney(vdsPayable)} · টিডিএস ${compactMoney(tdsPayable)}`,
            )}
            detail={L(
              'VAT 9.1 internal draft — deadline and template not verified',
              'ভ্যাট ৯.১ অভ্যন্তরীণ খসড়া — সময়সীমা ও টেমপ্লেট যাচাইকৃত নয়',
            )}
            cta={L('Review draft', 'খসড়া পর্যালোচনা')}
            footer={L('VAT + VDS + TDS', 'ভ্যাট + ভিডিএস + টিডিএস')}
            onClick={() => navigate('W05')}
          />
        </div>

        {/* Action Required Inbox */}
        <aside className="lv-card relative flex flex-col overflow-hidden" aria-label={L('Action required inbox', 'করণীয় ইনবক্স')}>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-gold-500/[0.07] blur-3xl"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-2 border-b border-line/70 px-4 py-3.5">
            <div>
              <p className="lv-kicker flex items-center gap-1.5">
                <CircleAlert size={11} className="text-gold-500" />
                {L('Action required inbox', 'করণীয় ইনবক্স')}
              </p>
              <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.025em] text-ink-900">
                {L('What needs you today', 'আজ আপনার যা দরকার')}
              </h2>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold ${
                totalActions > 0
                  ? 'border-rose-500/20 bg-rose-500/[0.07] text-rose-600 dark:text-rose-300'
                  : 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-300'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${totalActions > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              {formatCount(totalActions, numeralScript)} {L('open', 'খোলা')}
            </span>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-2 p-2.5">
            {actionItems.map((item) => {
              const Icon = item.icon;
              const clear = item.count === 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.target)}
                  aria-label={L(`Open ${item.label}`, `${item.label} খুলুন`)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-line/70 bg-surface-2/35 p-3 text-left transition duration-200 hover:-translate-y-px hover:border-line-strong hover:bg-surface hover:shadow-sm"
                >
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full opacity-[0.08] blur-xl ${
                      clear ? 'bg-emerald-500' : KPI_TONES[item.tone].glow
                    }`}
                  />
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-[9px] ${
                        clear ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : INBOX_TONES[item.tone]
                      }`}
                    >
                      {clear ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                    </span>
                    <ArrowUpRight
                      size={12}
                      className="text-ink-300 transition duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-bright"
                    />
                  </span>
                  <span className="mt-2.5 flex items-end gap-1.5">
                    <span
                      className={`font-money text-[23px] font-semibold leading-none tabular-nums ${
                        clear ? 'text-ink-300' : 'text-ink-900'
                      }`}
                    >
                      {formatCount(item.count, numeralScript)}
                    </span>
                    {!clear ? (
                      <span className="mb-0.5 h-1 w-1 rounded-full bg-rose-400/80" aria-hidden />
                    ) : null}
                  </span>
                  <span className="mt-1.5 block text-[9.5px] font-semibold leading-tight text-ink-700">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[8px] leading-snug text-ink-400">
                    {clear ? L('All clear', 'সব পরিষ্কার') : item.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-auto flex items-center gap-1.5 border-t border-line/70 px-4 py-2.5 text-[8.5px] leading-relaxed text-ink-400">
            <ShieldCheck size={9} className="shrink-0 text-emerald-500" />
            {L(
              'Every count is live from the immutable ledger — click a card to open its queue.',
              'প্রতিটি সংখ্যা অপরিবর্তনীয় খতিয়ান থেকে লাইভ — কিউ খুলতে কার্ডে ক্লিক করুন।',
            )}
          </p>
        </aside>
      </div>

      {/* Composer · Sankey · forecast — one calm, collapsible tab at a time ------------------ */}
      <section className="space-y-2.5" aria-label={L('Cockpit detail views', 'ককপিট বিস্তারিত দৃশ্য')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="lv-seg !p-1" role="tablist" aria-label={L('Detail views', 'বিস্তারিত দৃশ্য')}>
            {panelTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activePanel === tab.key && panelOpen;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-expanded={active}
                  onClick={() => choosePanel(tab.key)}
                  className="lv-seg-item"
                  data-active={active}
                >
                  <Icon size={12} />
                  <span>{L(tab.title_en, tab.title_bn)}</span>
                  <span className="hidden text-[8px] font-medium opacity-70 lg:inline">
                    {L(tab.hint_en, tab.hint_bn)}
                  </span>
                  {active ? (
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${panelOpen ? 'rotate-180' : ''}`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-ink-400">
            {panelOpen
              ? L('Click the active view to collapse it.', 'সংকুচিত করতে সক্রিয় দৃশ্যে ক্লিক করুন।')
              : L('Collapsed — pick a tab to reopen.', 'সংকুচিত — খুলতে ট্যাব বেছে নিন।')}
          </p>
        </div>

        <AnimatePresence initial={false} mode="wait">
          {panelOpen ? (
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: motionTier === 'OFF' ? 0 : 0.2, ease: EASE }}
            >
              {activePanel === 'COMPOSE' ? (
                <TransactionComposer onPosted={handlePosted} />
              ) : null}

              {activePanel === 'FLOW' ? (
                <section className="lv-card overflow-hidden">
                  <div className="lv-card-header">
                    <div>
                      <p className="lv-kicker flex items-center gap-1.5">
                        <Activity size={11} className="text-brand-bright" />
                        {L('Money-flow Sankey', 'অর্থপ্রবাহ সাঙ্কি')}
                      </p>
                      <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-ink-900">
                        {L('Revenue → costs, tax and retained cash', 'আয় → ব্যয়, কর ও সঞ্চিত নগদ')}
                      </h2>
                      <p className="mt-1 text-[10.5px] text-ink-500">
                        {L(
                          'Cubic-Bézier ribbons · BigInt poisha · hover or focus a node to trace its exact flow',
                          'কিউবিক-বেজিয়ে রিবন · বিগইন্ট পয়সা · সঠিক প্রবাহ দেখতে নোডে হোভার বা ফোকাস করুন',
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="lv-chip lv-chip-neutral">
                        <CircleDollarSign size={10} />
                        {compactMoney(flow.revenue)} {L('inflow', 'আগমন')}
                      </span>
                      <span className="lv-chip lv-chip-gold">
                        <Landmark size={10} />
                        {compactMoney(flow.treasuryTotal)} {L('treasury', 'কোষাগার')}
                      </span>
                      <span className="lv-chip lv-chip-emerald">
                        <ShieldCheck size={10} />
                        {L('Conserved to the poisha', 'পয়সা-নির্ভুল')}
                      </span>
                    </div>
                  </div>
                  <div className="p-2.5 sm:p-4">
                    <MoneyFlowSankey
                      channels={flowChannels}
                      sinks={flowSinks}
                      inflowLabel={L('Gross inflow', 'মোট আগমন')}
                      inflowHint={L(
                        `${flowChannels.length} revenue channels · ${flowSinks.length} applications`,
                        `${flowChannels.length} আয় চ্যানেল · ${flowSinks.length} প্রয়োগ`,
                      )}
                      money={money}
                      compactMoney={compactMoney}
                      motionTier={motionTier}
                      locale={locale}
                      interactionHint={L(
                        'Hover, focus or click a node to trace its ribbon. The legend keeps every small outflow legible.',
                        'প্রবাহ ট্রেস করতে নোডে হোভার, ফোকাস বা ক্লিক করুন। ছোট বহির্গমও লেজেন্ডে স্পষ্ট থাকে।',
                      )}
                    />
                  </div>
                </section>
              ) : null}

              {activePanel === 'FORECAST' ? (
                <section className="lv-card overflow-hidden">
                  <div className="lv-card-header">
                    <div>
                      <p className="lv-kicker flex items-center gap-1.5">
                        <Beaker size={11} className="text-gold-500" />
                        {L('Liquidity lab · stress sandbox', 'তারল্য ল্যাব · স্ট্রেস স্যান্ডবক্স')}
                      </p>
                      <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] text-ink-900">
                        {L('13-week CFO cash forecast', '১৩-সপ্তাহের সিএফও নগদ পূর্বাভাস')}
                      </h2>
                      <p className="mt-1 text-[10.5px] text-ink-500">
                        {L(
                          'Move a slider — every week, the trough, the runway and the safety floor recalculate in BigInt poisha.',
                          'স্লাইডার সরান — প্রতিটি সপ্তাহ, সর্বনিম্ন বিন্দু, রানওয়ে ও নিরাপত্তা সীমা বিগইন্ট পয়সায় পুনর্গণনা হয়।',
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="lv-chip lv-chip-neutral">
                        <CalendarClock size={10} />
                        {L('13 weeks from', '১৩ সপ্তাহ শুরু')} {formatDate(TODAY, locale)}
                      </span>
                      <span
                        className={`lv-chip ${
                          belowFloorWeeks.length === 0
                            ? 'lv-chip-emerald'
                            : belowFloorWeeks.length <= 3
                              ? 'lv-chip bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              : 'lv-chip-rose'
                        }`}
                      >
                        {belowFloorWeeks.length === 0 ? <ShieldCheck size={10} /> : <TriangleAlert size={10} />}
                        {belowFloorWeeks.length === 0
                          ? L('Above safety floor', 'নিরাপত্তা সীমার উপরে')
                          : L(`${belowFloorWeeks.length} weeks below floor`, `${belowFloorWeeks.length} সপ্তাহ সীমার নিচে`)}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_318px]">
                    <div className="p-3 sm:p-4">
                      <ForecastChart
                        weeks={forecast}
                        money={money}
                        compactMoney={compactMoney}
                        safetyFloor={safetyFloor}
                        motionTier={motionTier}
                        locale={locale}
                        belowWeeks={belowFloorWeeks}
                      />

                      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        <ForecastMetric
                          label={L('Week 13 closing', 'সপ্তাহ ১৩ সমাপনী')}
                          value={money(closingCash)}
                          tone={closingCash < 0n ? 'rose' : closingCash < safetyFloor ? 'gold' : 'emerald'}
                          icon={<Wallet size={11} />}
                          hint={cushion >= 0n ? `${compactMoney(cushion)} ${L('above floor', 'সীমার উপরে')}` : `${compactMoney(absBig(cushion))} ${L('below floor', 'সীমার নিচে')}`}
                        />
                        <ForecastMetric
                          label={L('Minimum trough', 'সর্বনিম্ন বিন্দু')}
                          value={money(trough.closing_poisha)}
                          tone={trough.closing_poisha < 0n ? 'rose' : trough.closing_poisha < safetyFloor ? 'gold' : 'emerald'}
                          icon={<TrendingDown size={11} />}
                          hint={`${L('Week', 'সপ্তাহ')} ${formatCount(trough.week, numeralScript)}`}
                        />
                        <ForecastMetric
                          label={L('Runway to floor', 'সীমা পর্যন্ত রানওয়ে')}
                          value={runwayWeeks ? `${formatCount(runwayWeeks, numeralScript)} ${L('wks', 'সপ্তাহ')}` : `13+ ${L('wks', 'সপ্তাহ')}`}
                          tone={runwayWeeks ? 'rose' : 'emerald'}
                          icon={<Clock3 size={11} />}
                          hint={runwayWeeks ? L('before first breach', 'প্রথম লঙ্ঘনের আগে') : L('no breach in horizon', 'সময়সীমায় লঙ্ঘন নেই')}
                        />
                        <ForecastMetric
                          label={L('Negative weeks', 'ঋণাত্মক সপ্তাহ')}
                          value={`${formatCount(negativeWeeks.length, numeralScript)} / ${formatCount(HORIZON, numeralScript)}`}
                          tone={negativeWeeks.length ? 'rose' : 'emerald'}
                          icon={negativeWeeks.length ? <TriangleAlert size={11} /> : <CheckCircle2 size={11} />}
                          hint={L('closing cash below zero', 'সমাপনী নগদ শূন্যের নিচে')}
                        />
                      </div>
                    </div>

                    <aside className="border-t border-line/70 bg-surface-2/35 p-3.5 sm:p-4 xl:border-l xl:border-t-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="lv-kicker flex items-center gap-1.5">
                          <SlidersHorizontal size={11} className="text-gold-500" />
                          {L('Stress levers', 'স্ট্রেস লিভার')}
                        </p>
                        <button
                          type="button"
                          onClick={() => applyPreset('BASE')}
                          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[8.5px] font-semibold text-ink-500 transition hover:bg-ink-100/60 hover:text-ink-800 dark:hover:bg-white/[0.05]"
                        >
                          <RotateCcw size={9} />
                          {L('Reset', 'রিসেট')}
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {(
                          [
                            { id: 'BASE', label: L('Base', 'ভিত্তি') },
                            { id: 'FX', label: L('BDT shock', 'টাকা ধাক্কা') },
                            { id: 'COLLECT', label: L('Collection freeze', 'আদায় স্থবির') },
                            { id: 'CRUNCH', label: L('Liquidity crunch', 'তারল্য সংকট') },
                          ] as const
                        ).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyPreset(preset.id)}
                            className="rounded-full border border-line/70 bg-surface px-2 py-0.5 text-[8.5px] font-semibold text-ink-500 transition hover:border-line-strong hover:text-ink-800"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 space-y-3">
                        {sliders.map((slider) => {
                          const fill = `${Math.max(2, (slider.value / slider.max) * 100)}%`;
                          return (
                            <label key={slider.id} className="block">
                              <span className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-700">
                                  <span className="text-ink-400">{slider.icon}</span>
                                  {slider.label}
                                </span>
                                <span className="font-mono text-[9.5px] font-semibold tabular-nums text-ink-800">
                                  {formatCount(slider.value, numeralScript)}
                                  {slider.suffix}
                                </span>
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={slider.max}
                                step={1}
                                value={slider.value}
                                onChange={(event) => slider.set(Number(event.target.value))}
                                className="lv-range mt-1.5"
                                style={{ ['--lv-range-fill' as string]: fill } as CSSProperties}
                                aria-label={slider.label}
                              />
                              <span className="mt-0.5 block text-[8.5px] leading-snug text-ink-400">{slider.hint}</span>
                            </label>
                          );
                        })}
                      </div>

                      <div className="mt-3 rounded-xl border border-line/70 bg-surface/60 px-2.5 py-2">
                        <p className="flex items-center justify-between gap-2 text-[9px] font-semibold text-ink-600">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck size={10} className="text-emerald-500" />
                            {L('Safety floor', 'নিরাপত্তা সীমা')}
                          </span>
                          <span className="font-money tabular-nums text-ink-900">{money(safetyFloor)}</span>
                        </p>
                        <p className="mt-0.5 font-mono text-[8px] leading-relaxed text-ink-400">
                          {L('5% maximum drawdown · 4-week opex floor', 'সর্বোচ্চ ৫% ড্রডাউন · ৪ সপ্তাহের পরিচালন সীমা')} ·{' '}
                          {compactMoney(opexFloor)}
                        </p>
                      </div>

                      <p className="mt-2 flex items-start gap-1.5 text-[8.5px] leading-relaxed text-ink-400">
                        <CircleAlert size={9} className="mt-0.5 shrink-0 text-ink-400" />
                        {L(
                          'Scenario only. Authoritative balances remain the immutable journal; sliders never write to the ledger.',
                          'শুধু দৃশ্যপট। প্রামাণিক ব্যালেন্স অপরিবর্তনীয় জার্নালেই থাকে; স্লাইডার কখনও খতিয়ানে লেখে না।',
                        )}
                      </p>
                    </aside>
                  </div>
                </section>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Small presentational primitives
// ---------------------------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  tone,
  title,
  value,
  chip,
  caption,
  detail,
  cta,
  footer,
  onClick,
}: {
  icon: typeof Wallet;
  tone: KpiTone;
  title: string;
  value: string;
  chip: string;
  caption: string;
  detail: string;
  cta: string;
  footer: string;
  onClick: () => void;
}) {
  const palette = KPI_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="lv-card lv-card-interactive group relative flex flex-col overflow-hidden p-4 text-left"
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-[0.08] blur-2xl ${palette.glow}`}
      />
      <span className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${palette.bar}`} />
      <span className="relative flex items-start justify-between gap-2">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${palette.icon}`}>
          <Icon size={15} />
        </span>
        <span className={`lv-chip !py-1 ${palette.chip}`}>{chip}</span>
      </span>
      <span className="relative mt-3.5 block text-[8.5px] font-bold uppercase tracking-[0.14em] text-ink-400">
        {title}
      </span>
      <span className="font-money relative mt-1.5 block text-[25px] font-semibold leading-none tracking-[-0.045em] text-ink-900 sm:text-[27px]">
        {value}
      </span>
      <span className="relative mt-2 block text-[9.5px] leading-relaxed text-ink-500">{caption}</span>
      <span className="relative mt-auto flex items-end justify-between gap-2 pt-3">
        <span className="min-w-0 text-[8.5px] leading-snug text-ink-400">{detail}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-ink-500 transition group-hover:text-brand-bright">
          {cta}
          <ArrowUpRight size={10} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </span>
      <span className="relative mt-2.5 flex items-center justify-between gap-2 border-t border-line/60 pt-2 text-[8px] text-ink-400">
        <span className="truncate">{footer}</span>
        <span className={`h-1 w-6 shrink-0 rounded-full ${palette.glow} opacity-60`} />
      </span>
    </button>
  );
}

function ForecastMetric({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'gold' | 'rose';
  icon: ReactNode;
  hint: string;
}) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'gold'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-rose-700 dark:text-rose-300';
  return (
    <div className="rounded-xl border border-line/60 bg-surface-2/40 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        <span className={color}>{icon}</span>
        {label}
      </p>
      <p className={`font-money mt-1 truncate text-[13px] font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 truncate text-[8px] text-ink-400">{hint}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 13-week forecast chart
// ---------------------------------------------------------------------------------------------

function ForecastChart({
  weeks,
  money,
  compactMoney,
  safetyFloor,
  motionTier,
  locale,
  belowWeeks,
}: {
  weeks: ReadonlyArray<CashForecastWeek>;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  compactMoney: (poisha: bigint) => string;
  safetyFloor: bigint;
  motionTier: 'FULL' | 'LITE' | 'OFF';
  locale: 'en-BD' | 'bn-BD';
  belowWeeks: ReadonlyArray<CashForecastWeek>;
}) {
  const uid = safeId(useId());
  const [hover, setHover] = useState<number | null>(null);
  const width = 980;
  const height = 318;
  const plotLeft = 62;
  const plotRight = 18;
  const plotTop = 18;
  const plotBottom = 202;
  const barTop = 228;
  const barBottom = 272;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = plotBottom - plotTop;
  const step = plotWidth / Math.max(1, weeks.length);

  const closingValues = weeks.map((week) => week.closing_poisha);
  const allValues = closingValues.concat([safetyFloor]);
  const rawMax = allValues.reduce((high, value) => (value > high ? value : high), allValues[0] ?? 0n);
  const rawMin = allValues.reduce((low, value) => (value < low ? value : low), allValues[0] ?? 0n);
  const spread = rawMax - rawMin || 1n;
  const pad = spread / 7n || 1n;
  const max = rawMax + pad;
  const min = rawMin - pad;
  const range = max - min || 1n;
  const yFor = (value: bigint): number =>
    plotTop + Number((max - value) * BigInt(plotHeight * 1000)) / 1000 / Number(range);
  const xFor = (index: number): number => plotLeft + step * (index + 0.5);

  const points = weeks.map((week, index) => ({ x: xFor(index), y: yFor(week.closing_poisha) }));
  let line = points.length > 0 ? `M ${points[0].x} ${points[0].y}` : '';
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  const area = points.length > 0 ? `${line} L ${points[points.length - 1].x} ${plotBottom} L ${points[0].x} ${plotBottom} Z` : '';
  const zeroY = yFor(0n);
  const floorY = yFor(safetyFloor);
  const floorVisible = safetyFloor >= min && safetyFloor <= max;
  const barMax = weeks.reduce((high, week) => maxBig(high, maxBig(week.inflow_poisha, week.outflow_poisha)), 1n);
  const barHeight = (value: bigint): number =>
    Math.max(value > 0n ? 1.5 : 0, Number((value * BigInt(barBottom - barTop)) / barMax));
  const ticks = [0, 1, 2, 3, 4].map((index) => min + (range * BigInt(index)) / 4n);
  const active = hover === null ? null : weeks[hover];
  const belowSet = new Set(belowWeeks.map((week) => week.week));
  const troughWeek = weeks.reduce((low, week) => (week.closing_poisha < low.closing_poisha ? week : low), weeks[0]);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-2xl border border-line/60 bg-surface-2/25">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[8.5px] font-medium text-ink-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-indigo-500" /> {L2(locale, 'Closing cash', 'সমাপনী নগদ')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-4 border-t border-dashed border-amber-500" /> {L2(locale, 'Safety floor', 'নিরাপত্তা সীমা')}
              <span className="text-ink-300">· {compactMoney(safetyFloor)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-2 rounded-sm bg-indigo-500/70" /> {L2(locale, 'Inflow', 'আগমন')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-2 rounded-sm bg-rose-500/70" /> {L2(locale, 'Outflow', 'বহির্গমন')}
            </span>
          </div>
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-400">
            {L2(locale, 'Hover a week for the full bridge', 'পূর্ণ সেতু দেখতে সপ্তাহে হোভার করুন')}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label={`13-week closing cash forecast. Minimum trough ${money(troughWeek?.closing_poisha ?? 0n)} in week ${troughWeek?.week ?? 1}. Safety floor ${money(safetyFloor)}.`}
          onMouseLeave={() => setHover(null)}
        >
          <title>13-week cash forecast and stress test</title>
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.015" />
            </linearGradient>
            <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>

          {/* grid */}
          {ticks.map((tick, index) => {
            const y = yFor(tick);
            return (
              <g key={`tick-${index}`}>
                <line x1={plotLeft} y1={y} x2={width - plotRight} y2={y} stroke="rgb(var(--lv-line))" strokeWidth="0.6" strokeDasharray="1 6" />
                <text x={plotLeft - 8} y={y + 3} textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="8.2" fill="rgb(var(--lv-ink-400))">
                  {compactMoney(tick)}
                </text>
              </g>
            );
          })}

          {/* below-floor bands */}
          {weeks.map((week, index) =>
            belowSet.has(week.week) ? (
              <rect
                key={`band-${week.week}`}
                x={xFor(index) - step / 2}
                y={plotTop}
                width={step}
                height={plotBottom - plotTop}
                fill="#f43f5e"
                opacity="0.045"
              />
            ) : null,
          )}

          {/* zero and safety lines */}
          {min < 0n && max > 0n ? (
            <line x1={plotLeft} y1={zeroY} x2={width - plotRight} y2={zeroY} stroke="rgb(var(--lv-line-strong))" strokeWidth="1" />
          ) : null}
          {floorVisible ? (
            <>
              <line x1={plotLeft} y1={floorY} x2={width - plotRight} y2={floorY} stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.8" />
              <text x={width - plotRight - 2} y={floorY - 5} textAnchor="end" fontFamily="Inter, Hind Siliguri, Noto Sans Bengali, system-ui, sans-serif" fontSize="7.8" fontWeight="600" fill="#b45309">
                {L2(locale, 'SAFETY FLOOR', 'নিরাপত্তা সীমা')}
              </text>
            </>
          ) : null}

          {/* area + line */}
          <motion.path d={area} fill={`url(#${uid}-fill)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: motionTier === 'OFF' ? 0 : 0.5 }} />
          <motion.path
            d={line}
            fill="none"
            stroke={`url(#${uid}-line)`}
            strokeWidth="2.2"
            strokeLinecap="round"
            initial={motionTier === 'OFF' ? false : { pathLength: 0 }}
            animate={{ pathLength: 1, d: line }}
            transition={{ duration: motionTier === 'OFF' ? 0 : 0.7, ease: EASE }}
          />

          {/* weekly dots and below-floor marks */}
          {points.map((point, index) => {
            const week = weeks[index];
            const below = belowSet.has(week.week);
            return (
              <g key={`dot-${week.week}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={hover === index ? 4 : below ? 3.1 : 2.2}
                  fill={below ? '#f43f5e' : '#6366f1'}
                  stroke="rgb(var(--lv-surface))"
                  strokeWidth="1.4"
                  style={{ transition: 'r 150ms ease' }}
                />
                {week.week === troughWeek?.week ? (
                  <circle cx={point.x} cy={point.y} r="7" fill="none" stroke={below ? '#f43f5e' : '#f59e0b'} strokeWidth="1" opacity="0.55" />
                ) : null}
              </g>
            );
          })}

          {/* hover guide */}
          {hover !== null && points[hover] ? (
            <g pointerEvents="none">
              <line x1={points[hover].x} y1={plotTop} x2={points[hover].x} y2={barBottom + 8} stroke="rgb(var(--lv-ink-400))" strokeWidth="0.8" strokeDasharray="2 4" opacity="0.65" />
              <circle cx={points[hover].x} cy={points[hover].y} r="5" fill="none" stroke="#6366f1" strokeWidth="1.4" />
            </g>
          ) : null}

          {/* bars */}
          {weeks.map((week, index) => {
            const center = xFor(index);
            const inflowHeight = barHeight(week.inflow_poisha);
            const outflowHeight = barHeight(week.outflow_poisha);
            return (
              <g key={`bar-${week.week}`}>
                <motion.rect
                  x={center - 8}
                  width="7"
                  rx="1.8"
                  fill="#6366f1"
                  fillOpacity="0.8"
                  initial={false}
                  animate={{ y: barBottom - inflowHeight, height: inflowHeight }}
                  transition={{ duration: motionTier === 'OFF' ? 0 : 0.4, ease: EASE }}
                />
                <motion.rect
                  x={center + 1}
                  width="7"
                  rx="1.8"
                  fill="#f43f5e"
                  fillOpacity="0.55"
                  initial={false}
                  animate={{ y: barBottom - outflowHeight, height: outflowHeight }}
                  transition={{ duration: motionTier === 'OFF' ? 0 : 0.4, ease: EASE }}
                />
                <text
                  x={center}
                  y={barBottom + 13}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize="7.4"
                  fill={belowSet.has(week.week) ? '#f43f5e' : 'rgb(var(--lv-ink-400))'}
                  fontWeight={belowSet.has(week.week) ? '700' : '400'}
                >
                  W{week.week}
                </text>
              </g>
            );
          })}

          {/* hover hit areas */}
          {weeks.map((week, index) => (
            <rect
              key={`hit-${week.week}`}
              x={xFor(index) - step / 2}
              y={plotTop}
              width={step}
              height={barBottom - plotTop + 12}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>

        {/* hover card */}
        <AnimatePresence>
          {active ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 2 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute right-3 top-12 w-[218px] rounded-xl border border-line bg-surface/95 p-2.5 shadow-panel backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                  {L2(locale, 'Week', 'সপ্তাহ')} {active.week}
                </p>
                <p className="font-mono text-[8px] text-ink-400">{formatDate(active.week_start, locale)}</p>
              </div>
              <p className={`font-money mt-1 text-[15px] font-semibold tabular-nums ${active.closing_poisha < 0n ? 'text-rose-600 dark:text-rose-400' : active.closing_poisha < safetyFloor ? 'text-amber-700 dark:text-amber-300' : 'text-ink-900'}`}>
                {money(active.closing_poisha)}
              </p>
              <div className="mt-1.5 space-y-0.5 border-t border-line/70 pt-1.5 text-[8.5px]">
                <p className="flex justify-between gap-2 text-ink-500">
                  <span>{L2(locale, 'Inflow', 'আগমন')}</span>
                  <span className="font-money tabular-nums text-ink-700">{money(active.inflow_poisha)}</span>
                </p>
                <p className="flex justify-between gap-2 text-ink-500">
                  <span>{L2(locale, 'Outflow', 'বহির্গমন')}</span>
                  <span className="font-money tabular-nums text-ink-700">{money(active.outflow_poisha)}</span>
                </p>
                <p className="flex justify-between gap-2 text-ink-500">
                  <span>{L2(locale, 'Net', 'নিট')}</span>
                  <span className={`font-money tabular-nums ${active.net_poisha < 0n ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {money(active.net_poisha, { sign: true })}
                  </span>
                </p>
              </div>
              <p className="mt-1 text-[7.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                {active.closing_poisha < safetyFloor
                  ? L2(locale, 'Below safety floor', 'নিরাপত্তা সীমার নিচে')
                  : L2(locale, 'Above safety floor', 'নিরাপত্তা সীমার উপরে')}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function L2(locale: string, en: string, bn: string): string {
  return locale === 'bn-BD' ? bn : en;
}
