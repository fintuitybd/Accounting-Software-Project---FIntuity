// LedgerVault — W03 Purchases, withholding & reverse charge.
//
// Zone A (module header + P2P pipeline tabs + search/filter) over Zone B (clean vendor-document
// master table) and Zone C (a focused slide-over workbench). The workbench carries the visual
// 4-stage stepper, the 3-way match banner, the s.46 input-VAT rebate check, the missing-e-TIN
// +50% TDS indicator and a live payment split preview.
//
// P2P lifecycle follows blueprint §4.2: purchase order → GRN received → bill posted after the
// 3-way match → settled with VDS/TDS withheld at source.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Banknote,
  Boxes,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  FileWarning,
  HandCoins,
  Hash,
  Landmark,
  Layers,
  PackagePlus,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Split,
  Stamp,
  Truck,
  UserPlus,
  Warehouse,
  X,
} from 'lucide-react';

import { MasterDataModal, type MasterDataTab } from '../components/modals/MasterDataModal';
import { LedgerLensModal } from '../components/signature/LedgerLensModal';
import { StatutoryPrintModal } from '../components/signature/StatutoryPrintModal';
import {
  PAYMENT_RAILS,
  StatusPill,
  VAT_CATEGORIES,
  WorkspaceHeader,
  categoryLabel,
  lineFromItem,
  lineValuePoisha,
  newDraftLine,
  parseBdt,
  paymentRail,
  type DemoPreset,
  type DraftLine,
  type MoneyFn,
} from '../components/commercial/CommercialShared';
import { addDays, formatDate, formatPercentBps } from '../core/money';
import {
  evaluateTaxDecision,
  previewTaxJournal,
  receiveInventoryStock,
} from '../core/tax-engine/engine';
import {
  buildCommercialDoc,
  documentTaxInput,
  type JournalLineDraft,
  type TaxAnnotatedDoc,
} from '../core/ledger/ledgerEngine';
import type { SeedItem } from '../core/ledger/seedData';
import { useVault } from '../context/VaultContext';
import type {
  CommercialDocType,
  JournalEntry,
  PaymentMethod,
  PermissionAction,
  TaxCategory,
  TaxEvaluationInput,
  TdsNature,
} from '../core/types';

const TODAY = '2026-11-01';
const PERIOD_END = '2026-10-31';
const PERIOD_CODE = '2026-10';
const PAYMENT_PREFIX = 'Supplier payment of ';

// ---------------------------------------------------------------------------------------------
// P2P state machine (blueprint §4.2)
// ---------------------------------------------------------------------------------------------

type PurchaseStage = 'PURCHASE_ORDER' | 'GRN_RECEIVED' | 'BILL_POSTED' | 'SETTLED';
type StageTab = 'ALL' | PurchaseStage;
type LifecycleFilter = 'ALL' | 'POSTED' | 'DRAFT' | 'REVERSED';
type DateWindow = 'ALL' | '7' | '30' | '90';
type WorkbenchState = { kind: 'create' } | { kind: 'doc'; docId: string };
type WorkbenchMode = 'create' | 'review' | 'settle' | 'view';

interface PurchaseEntry {
  doc: TaxAnnotatedDoc;
  stage: PurchaseStage;
  draft: boolean;
  poQty: number;
  grnQty: number;
  poUnitPrices: Record<string, bigint>;
  missingTin: boolean;
}

interface StageMeta {
  labelEn: string;
  labelBn: string;
  nextEn: string;
  nextBn: string;
  next: PurchaseStage | null;
  permission: PermissionAction;
  tone: string;
}

const STAGE_META: Record<PurchaseStage, StageMeta> = {
  PURCHASE_ORDER: {
    labelEn: 'Purchase order',
    labelBn: 'ক্রয় অর্ডার',
    nextEn: 'Receive GRN',
    nextBn: 'জিআরএন গ্রহণ',
    next: 'GRN_RECEIVED',
    permission: 'DISPATCH_OR_RECEIVE_STOCK',
    tone: 'bg-ink-100 text-ink-600 ring-ink-200',
  },
  GRN_RECEIVED: {
    labelEn: 'GRN received',
    labelBn: 'জিআরএন গৃহীত',
    nextEn: 'Verify & Post Bill to AP',
    nextBn: 'যাচাই ও এপি-তে বিল পোস্ট',
    next: 'BILL_POSTED',
    permission: 'POST_TO_GL',
    tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  },
  BILL_POSTED: {
    labelEn: 'Bill posted · 3-way',
    labelBn: 'বিল পোস্টেড · থ্রি-ওয়ে',
    nextEn: 'Pay Supplier & Withhold VDS/TDS',
    nextBn: 'সরবরাহকারীকে পরিশোধ ও ভিডিএস/টিডিএস কর্তন',
    next: 'SETTLED',
    permission: 'POST_TO_GL',
    tone: 'bg-vault-100 text-vault-800 ring-vault-200',
  },
  SETTLED: {
    labelEn: 'Settled & withheld',
    labelBn: 'নিষ্পত্তি ও কর্তন',
    nextEn: 'Go to Treasury Challan Queue',
    nextBn: 'ট্রেজারি চালান সারিতে যান',
    next: null,
    permission: 'POST_TO_GL',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
};

const PURCHASE_TABS: Array<{ id: StageTab; labelEn: string; labelBn: string }> = [
  { id: 'ALL', labelEn: 'All', labelBn: 'সব' },
  { id: 'PURCHASE_ORDER', labelEn: '1. Purchase Orders (PO)', labelBn: '১. ক্রয় অর্ডার (পিও)' },
  { id: 'GRN_RECEIVED', labelEn: '2. Goods Receipts (GRN)', labelBn: '২. মাল গ্রহণ (জিআরএন)' },
  { id: 'BILL_POSTED', labelEn: '3. Vendor Bills (3-Way Matched)', labelBn: '৩. সরবরাহকারী বিল (থ্রি-ওয়ে মিলিত)' },
  { id: 'SETTLED', labelEn: '4. Settled & Withheld', labelBn: '৪. নিষ্পত্তি ও কর্তন' },
];

const PURCHASE_STEPS: Array<{
  key: string;
  labelEn: string;
  labelBn: string;
  hintEn: string;
  hintBn: string;
  stages: PurchaseStage[];
}> = [
  {
    key: 'po',
    labelEn: 'Purchase order',
    labelBn: 'ক্রয় অর্ডার',
    hintEn: 'Agreed quantity & PO unit price',
    hintBn: 'সম্মত পরিমাণ ও পিও একক মূল্য',
    stages: ['PURCHASE_ORDER'],
  },
  {
    key: 'grn',
    labelEn: 'GRN',
    labelBn: 'জিআরএন',
    hintEn: 'Goods received at weighted average',
    hintBn: 'ওয়েটেড এভারেজে মাল গ্রহণ',
    stages: ['GRN_RECEIVED'],
  },
  {
    key: 'bill',
    labelEn: 'Vendor bill',
    labelBn: 'সরবরাহকারী বিল',
    hintEn: '3-way match + s.46 input VAT',
    hintBn: 'থ্রি-ওয়ে ম্যাচ + ধারা ৪৬ ইনপুট ভ্যাট',
    stages: ['BILL_POSTED'],
  },
  {
    key: 'paid',
    labelEn: 'Settled',
    labelBn: 'নিষ্পত্তি',
    hintEn: 'VDS/TDS withheld + treasury challans',
    hintBn: 'ভিডিএস/টিডিএস কর্তন + ট্রেজারি চালান',
    stages: ['SETTLED'],
  },
];

const LIFECYCLE_FILTERS: Array<{ id: LifecycleFilter; labelEn: string; labelBn: string }> = [
  { id: 'ALL', labelEn: 'All statuses', labelBn: 'সব অবস্থা' },
  { id: 'POSTED', labelEn: 'Posted', labelBn: 'পোস্টেড' },
  { id: 'DRAFT', labelEn: 'Draft', labelBn: 'খসড়া' },
  { id: 'REVERSED', labelEn: 'Reversed', labelBn: 'রিভার্সড' },
];

const DOC_KINDS: Array<{ id: CommercialDocType; en: string; bn: string; hintEn: string; hintBn: string }> = [
  { id: 'PURCHASE_BILL', en: 'Supplier bill', bn: 'সরবরাহকারী বিল', hintEn: 'Inventory or trading stock', hintBn: 'ইনভেন্টরি বা ট্রেডিং স্টক' },
  { id: 'EXPENSE_VOUCHER', en: 'Expense voucher', bn: 'ব্যয় ভাউচার', hintEn: 'Service or overhead expense', hintBn: 'সেবা বা ওভারহেড ব্যয়' },
  { id: 'IMPORTED_SERVICE', en: 'Imported service', bn: 'আমদানি সেবা', hintEn: 'Reverse-charge VAT 15%', hintBn: 'রিভার্স-চার্জ ভ্যাট ১৫%' },
];

const TDS_NATURES: Array<{ id: TdsNature; en: string; bn: string; bps: number }> = [
  { id: 'SUPPLY_OF_GOODS', en: 'Supply of goods', bn: 'পণ্য সরবরাহ', bps: 300 },
  { id: 'PROFESSIONAL_OR_TECHNICAL_SERVICES', en: 'Professional / technical', bn: 'পেশাগত / কারিগরি', bps: 1000 },
  { id: 'COMMERCIAL_RENT', en: 'Commercial rent', bn: 'বাণিজ্যিক ভাড়া', bps: 500 },
  { id: 'ADVERTISING_OR_MEDIA', en: 'Advertising / media', bn: 'বিজ্ঞাপন / মিডিয়া', bps: 500 },
  { id: 'TRANSPORT_OR_LOGISTICS', en: 'Transport / logistics', bn: 'পরিবহন / লজিস্টিকস', bps: 300 },
  { id: 'CONTRACTOR_OR_SUBCONTRACTOR', en: 'Contractor / subcontractor', bn: 'ঠিকাদার / উপ-ঠিকাদার', bps: 300 },
];

function displayStatus(doc: TaxAnnotatedDoc, journals: JournalEntry[]): 'POSTED' | 'DRAFT' | 'REVERSED' {
  if (doc.status === 'REVERSED') return 'REVERSED';
  const journal = journals.find((entry) => entry.id === (doc.document_journal_id ?? doc.journal_id));
  if (journal?.status === 'REVERSED') return 'REVERSED';
  if (doc.status === 'DRAFT') return 'DRAFT';
  return 'POSTED';
}

function paymentJournalFor(doc: TaxAnnotatedDoc, journals: JournalEntry[]): JournalEntry | undefined {
  return journals.find(
    (entry) =>
      entry.source_module === 'BANK_MFS' &&
      entry.narration_en.startsWith(PAYMENT_PREFIX) &&
      entry.narration_en.includes(doc.doc_number),
  );
}

function stageOfPersistedDoc(doc: TaxAnnotatedDoc, journals: JournalEntry[]): PurchaseStage {
  if (doc.status === 'SETTLED' || paymentJournalFor(doc, journals)) return 'SETTLED';
  const raw = doc.workflow_stage;
  if (raw === 'PURCHASE_ORDER' || raw === 'GRN_RECEIVED') return raw;
  return 'BILL_POSTED';
}

function stageIndex(stage: PurchaseStage): number {
  const index = PURCHASE_STEPS.findIndex((step) => step.stages.includes(stage));
  return index < 0 ? 0 : index;
}

function daysAgoIso(days: number): string {
  const [year, month, day] = TODAY.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function bankCodeFor(method: PaymentMethod, channel?: string): string {
  if (method === 'CASH') return '1130';
  if (method === 'MFS') return (channel ?? '').toLowerCase().includes('nagad') ? '1125' : '1120';
  if ((channel ?? '').toLowerCase().includes('brac')) return '1115';
  return '1110';
}

function renumbered(doc: TaxAnnotatedDoc, prefix: string): string {
  const suffix = doc.doc_number.split('-').slice(-1)[0];
  return `${prefix}-${doc.doc_date.slice(0, 7)}-${suffix}`;
}

function entryQuantities(entry: PurchaseEntry): { billQty: number; poQty: number; grnQty: number; priceVariance: bigint } {
  const billQty = entry.doc.lines.reduce((total, line) => total + Math.max(0, line.quantity), 0);
  const poQty = entry.poQty > 0 ? entry.poQty : billQty;
  const grnQty = entry.grnQty > 0 ? entry.grnQty : poQty;
  const priceVariance = entry.doc.lines.reduce((total, line) => {
    const poPrice = entry.poUnitPrices[line.sku] ?? line.unit_price_poisha;
    const billPrice = line.unit_price_poisha;
    const delta = billPrice > poPrice ? billPrice - poPrice : 0n;
    return total + delta * BigInt(Math.max(0, Math.round(line.quantity)));
  }, 0n);
  return { billQty, poQty, grnQty, priceVariance };
}

function entryMatchOk(entry: PurchaseEntry): boolean {
  const { billQty, poQty, grnQty, priceVariance } = entryQuantities(entry);
  return billQty <= grnQty && grnQty <= poQty && priceVariance === 0n;
}

// ---------------------------------------------------------------------------------------------
// Presentational primitives
// ---------------------------------------------------------------------------------------------

function StageBadge({ stage, isBn }: { stage: PurchaseStage; isBn: boolean }) {
  const meta = STAGE_META[stage];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${meta.tone}`}>
      {isBn ? meta.labelBn : meta.labelEn}
    </span>
  );
}

function StageProgress({ stage }: { stage: PurchaseStage }) {
  const current = stageIndex(stage);
  return (
    <span className="mt-1 flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`h-1 w-4 rounded-full ${index < current ? 'bg-emerald-400' : index === current ? 'bg-vault-600' : 'bg-ink-200'}`}
        />
      ))}
    </span>
  );
}

function StockBadge({ item, quantity, isBn }: { item: SeedItem | undefined; quantity: number; isBn: boolean }) {
  if (!item || item.is_stock_item === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[8.5px] font-semibold text-ink-500">
        <Boxes size={9} /> {isBn ? 'সেবা' : 'Service'}
      </span>
    );
  }
  const onHand = item.qty_on_hand ?? 0;
  if (onHand <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
        <CircleAlert size={9} /> {isBn ? 'স্টক নেই' : 'Out of stock'}
      </span>
    );
  }
  if (onHand < quantity) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
        <Warehouse size={9} /> {isBn ? `${onHand} স্টকে` : `${onHand} on hand`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <Warehouse size={9} /> {isBn ? `${onHand} স্টকে` : `${onHand} in stock`}
    </span>
  );
}

function CostBadge({ item, money, isBn }: { item: SeedItem | undefined; money: MoneyFn; isBn: boolean }) {
  if (!item || item.is_stock_item === false) return null;
  const cost = item.unit_cost_poisha;
  if (cost === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-vault-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-vault-700 ring-1 ring-inset ring-vault-100">
      <ShieldCheck size={9} /> {isBn ? 'ওয়েটেড ব্যয়' : 'Wtd. cost'} {money(cost, { symbol: false })}
    </span>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`block ${className}`}>
      <span className="lv-label">{label}</span>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'emerald' | 'indigo' | 'violet' | 'gold' | 'rose';
}) {
  const tones: Record<string, string> = {
    ink: 'text-ink-900',
    emerald: 'text-emerald-700',
    indigo: 'text-indigo-700',
    violet: 'text-violet-700',
    gold: 'text-gold-700',
    rose: 'text-rose-700',
  };
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`font-money text-[11px] font-semibold ${tones[tone]}`}>{value}</dd>
    </div>
  );
}

function MatchPill({ stage, ok, isBn }: { stage: PurchaseStage; ok: boolean; isBn: boolean }) {
  if (stage === 'PURCHASE_ORDER') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] text-ink-500">
        <FileText size={9} /> {isBn ? 'পিও ইস্যু' : 'PO issued'}
      </span>
    );
  }
  if (stage === 'GRN_RECEIVED') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${
          ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'
        }`}
      >
        <Truck size={9} /> {isBn ? 'পিও = জিআরএন' : 'PO = GRN'}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${
        ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'
      }`}
    >
      {ok ? <CheckCheck size={9} /> : <FileWarning size={9} />} {isBn ? (ok ? 'পিও = জিআরএন = বিল' : 'ভ্যারিয়েন্স') : ok ? 'PO = GRN = Bill' : 'Variance'}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Zone C line editor
// ---------------------------------------------------------------------------------------------

function PurchaseLineEditor({
  lines,
  items,
  money,
  isBn,
  readOnly,
  poUnitPrices,
  onChange,
  onNewItem,
}: {
  lines: DraftLine[];
  items: SeedItem[];
  money: MoneyFn;
  isBn: boolean;
  readOnly: boolean;
  poUnitPrices?: Record<string, bigint>;
  onChange: (lines: DraftLine[]) => void;
  onNewItem?: () => void;
}) {
  const update = (id: string, patch: Partial<DraftLine>): void => {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };
  const selectItem = (line: DraftLine, itemId: string): void => {
    if (itemId === 'CUSTOM') {
      update(line.id, { item_id: 'CUSTOM', sku: `CUSTOM-${line.id.slice(-3)}`, hs_code: '' });
      return;
    }
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const next = lineFromItem(item, line.id);
    next.quantity = line.quantity;
    onChange(lines.map((entry) => (entry.id === line.id ? next : entry)));
  };
  const totalBase = lines.reduce((total, line) => total + lineValuePoisha(line), 0n);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{isBn ? 'লাইন আইটেম' : 'Line items'}</p>
          <p className="text-[9.5px] text-ink-400">
            {isBn
              ? 'স্টক, ওয়েটেড-এভারেজ ব্যয় এবং পিও মূল্যের তুলনা প্রতি লাইনে দেখানো হচ্ছে।'
              : 'Live stock, weighted-average cost and the PO-price comparison sit on every line.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onNewItem ? (
            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 !text-[10px]" onClick={onNewItem}>
              <PackagePlus size={12} /> {isBn ? 'নতুন আইটেম' : '+ New Item'}
            </button>
          ) : null}
          {!readOnly ? (
            <button type="button" className="lv-btn lv-btn-secondary !px-2.5 !py-1 !text-[10.5px]" onClick={() => onChange([...lines, newDraftLine()])}>
              <Plus size={12} /> {isBn ? 'লাইন' : 'Add line'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="lv-table min-w-[900px]">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="min-w-[230px]">{isBn ? 'আইটেম / বিবরণ' : 'Item / description'}</th>
              <th className="w-16 text-right">{isBn ? 'পরিমাণ' : 'Qty'}</th>
              <th className="w-28 text-right">{isBn ? 'একক মূল্য' : 'Unit price'}</th>
              <th className="w-28 text-right">{isBn ? 'মূল্য' : 'Value'}</th>
              <th className="w-40">{isBn ? 'স্টক · ব্যয় · পিও মূল্য' : 'Stock · cost · PO price'}</th>
              <th className="w-32">{isBn ? 'ভ্যাট শ্রেণি' : 'VAT tier'}</th>
              {!readOnly ? <th className="w-8" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = items.find((entry) => entry.sku === line.sku);
              const value = lineValuePoisha(line);
              const poPrice = poUnitPrices?.[line.sku];
              const billPrice = parseBdt(line.unit_price_text);
              const priceDelta = poPrice !== undefined && billPrice > poPrice ? billPrice - poPrice : 0n;
              return (
                <tr key={line.id} className="align-top">
                  <td className="pt-3 font-mono text-[9.5px] text-ink-400">{String(index + 1).padStart(2, '0')}</td>
                  <td className="space-y-1 py-2">
                    {readOnly ? (
                      <>
                        <p className="text-[11px] font-semibold text-ink-900">{isBn ? line.description_bn : line.description_en}</p>
                        <p className="font-mono text-[9px] text-ink-400">
                          {line.sku} · HS {line.hs_code || '—'}
                        </p>
                      </>
                    ) : (
                      <>
                        <select className="lv-input !py-1 text-[10.5px]" value={line.item_id} onChange={(event) => selectItem(line, event.target.value)}>
                          <option value="CUSTOM">{isBn ? 'কাস্টম বিবরণ' : 'Custom description'}</option>
                          {items.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.sku} · {isBn ? entry.name_bn : entry.name_en}
                            </option>
                          ))}
                        </select>
                        <input
                          className="lv-input !py-1 text-[10.5px]"
                          value={isBn ? line.description_bn : line.description_en}
                          onChange={(event) => update(line.id, isBn ? { description_bn: event.target.value } : { description_en: event.target.value })}
                          placeholder={isBn ? 'বিবরণ' : 'Description'}
                        />
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {readOnly ? (
                      <span className="font-money text-[11px] font-semibold text-ink-800">{line.quantity}</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className="lv-input !py-1 text-right font-money text-[11px]"
                        value={line.quantity}
                        onChange={(event) => update(line.id, { quantity: Math.max(1, Number(event.target.value) || 1) })}
                      />
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {readOnly ? (
                      <span className="font-money text-[11px] text-ink-700">{money(parseBdt(line.unit_price_text))}</span>
                    ) : (
                      <input
                        className="lv-input !py-1 text-right font-money text-[11px]"
                        value={line.unit_price_text}
                        onChange={(event) => update(line.id, { unit_price_text: event.target.value })}
                      />
                    )}
                  </td>
                  <td className="py-2 text-right font-money text-[11px] font-semibold text-ink-900">
                    {money(value, { symbol: false })}
                    <span className="block text-[8.5px] font-normal text-ink-400">{isBn ? line.unit_bn : line.unit_en}</span>
                  </td>
                  <td className="space-y-1 py-2">
                    <StockBadge item={item} quantity={line.quantity} isBn={isBn} />
                    <div>
                      <CostBadge item={item} money={money} isBn={isBn} />
                    </div>
                    {poPrice !== undefined ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ring-1 ring-inset ${
                          priceDelta > 0n ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-vault-50 text-vault-700 ring-vault-100'
                        }`}
                      >
                        {isBn ? 'পিও' : 'PO'} {money(poPrice, { symbol: false })}
                        {priceDelta > 0n ? ` · +${money(priceDelta, { symbol: false })}` : ' ✓'}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    {readOnly ? (
                      <span className="text-[10px] text-ink-500">{categoryLabel(line.tax_category, isBn)}</span>
                    ) : (
                      <select
                        className="lv-input !py-1 text-[10px]"
                        value={line.tax_category}
                        onChange={(event) => update(line.id, { tax_category: event.target.value as TaxCategory })}
                      >
                        {VAT_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabel(category, isBn)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {!readOnly ? (
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={lines.length === 1}
                        onClick={() => onChange(lines.filter((entry) => entry.id !== line.id))}
                        className="rounded-lg p-1 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                        title={isBn ? 'লাইন মুছুন' : 'Remove line'}
                      >
                        <X size={13} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50/70">
              <td colSpan={4} className="px-3 py-2 text-right text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                {isBn ? 'মোট' : 'Totals'}
              </td>
              <td className="px-3 py-2 text-right font-money text-[11px] font-semibold text-ink-900">{money(totalBase, { symbol: false })}</td>
              <td colSpan={readOnly ? 2 : 3} className="px-3 py-2 text-[9.5px] text-ink-400">
                {isBn ? 'রিসিটে ওয়েটেড এভারেজ' : 'Weighted average on receipt'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------------------------

export default function W03_PurchasesWithholding() {
  const {
    locale,
    money,
    tenant,
    parties,
    items,
    accounts,
    commercialDocs,
    journals,
    currentUser,
    hasPermission,
    postCommercialDoc,
    postManualJournal,
  } = useVault();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const suppliers = useMemo(
    () => parties.filter((party) => party.type === 'SUPPLIER' || party.type === 'BOTH'),
    [parties],
  );

  const canDraft = hasPermission('CREATE_COMMERCIAL_DRAFT');
  const canPost = hasPermission('POST_TO_GL');
  const canStock = hasPermission('DISPATCH_OR_RECEIVE_STOCK');
  const canOverride = hasPermission('OVERRIDE_3WAY_VARIANCE');
  const canReverse = hasPermission('REVERSE_POSTED_JOURNAL');
  const isAuditor = currentUser.role === 'AUDITOR';

  const [docType, setDocType] = useState<CommercialDocType>('PURCHASE_BILL');
  const [supplierId, setSupplierId] = useState(() => suppliers[0]?.id ?? '');
  const [docDate, setDocDate] = useState(TODAY);
  const [paymentChoice, setPaymentChoice] = useState('BANK');
  const [vehicleNo, setVehicleNo] = useState('DHAKA METRO-GA 11-7788');
  const [destination, setDestination] = useState('Apex Delta warehouse, Tejgaon, Dhaka');
  const [narration, setNarration] = useState('Supplier invoice for trading stock');
  const [category, setCategory] = useState<TaxCategory>('STANDARD_15');
  const [tdsNature, setTdsNature] = useState<TdsNature>('SUPPLY_OF_GOODS');
  const [missingTin, setMissingTin] = useState(false);
  const [withholdVds, setWithholdVds] = useState(true);
  const [sd, setSd] = useState(false);
  const [challanHeld, setChallanHeld] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>(() => {
    const first = items.find((item) => item.sku === 'HS-8471.30') ?? items[0];
    return first ? [{ ...lineFromItem(first), quantity: 5 }] : [newDraftLine()];
  });

  const [draftSeq, setDraftSeq] = useState(1);
  const [drafts, setDrafts] = useState<PurchaseEntry[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchState | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [query, setQuery] = useState('');
  const [stageTab, setStageTab] = useState<StageTab>('ALL');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('ALL');
  const [dateWindow, setDateWindow] = useState<DateWindow>('ALL');
  const [sampleIndex, setSampleIndex] = useState(0);
  const [masterTab, setMasterTab] = useState<MasterDataTab | null>(null);

  const [lensJournalId, setLensJournalId] = useState<string | null>(null);
  const [lensTab, setLensTab] = useState<'ENTRY' | 'INTEGRITY' | 'REVERSAL'>('ENTRY');
  const [lensContext, setLensContext] = useState<string | undefined>(undefined);
  const [printReturnOpen, setPrintReturnOpen] = useState(false);

  const supplier = suppliers.find((party) => party.id === supplierId) ?? suppliers[0] ?? null;
  const rail = paymentRail(paymentChoice);
  const isImported = docType === 'IMPORTED_SERVICE';
  const base = lines.reduce((total, line) => total + lineValuePoisha(line), 0n);
  const cashLimit = tenant.accounting_policies.cash_disallowance_limit_poisha;

  const advisorInput = useMemo<TaxEvaluationInput>(
    () => ({
      direction: 'PURCHASE',
      base_poisha: base,
      tax_category: isImported ? 'REVERSE_CHARGE' : category,
      party_name: supplier?.name_en ?? 'Prospective supplier',
      party_bin: supplier?.bin,
      party_tin: missingTin ? undefined : supplier?.tin,
      is_withholding_entity: true,
      vds_applicable: withholdVds && !isImported,
      tds_nature: isImported ? 'NONE' : tdsNature,
      payment_method: rail.method,
      has_valid_mushak63: !isImported,
      is_reverse_charge: isImported,
      has_reverse_charge_challan: challanHeld,
      sd_applicable: sd && !isImported,
      period_end_date: PERIOD_END,
    }),
    [base, isImported, category, supplier, missingTin, withholdVds, tdsNature, rail.method, challanHeld, sd],
  );
  const decision = useMemo(() => evaluateTaxDecision(advisorInput), [advisorInput]);
  const cashRisk = rail.method === 'CASH' && base > cashLimit;
  const tdsWithTin = useMemo(() => evaluateTaxDecision({ ...advisorInput, party_tin: supplier?.tin }), [advisorInput, supplier]);
  const tdsDelta = decision.tds_poisha - tdsWithTin.tds_poisha;

  const purchaseDocs = useMemo(
    () =>
      commercialDocs
        .filter((doc) => doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER' || doc.doc_type === 'IMPORTED_SERVICE')
        .slice()
        .sort((left, right) => right.doc_date.localeCompare(left.doc_date) || right.created_at.localeCompare(left.created_at)),
    [commercialDocs],
  );

  const persistedEntries = useMemo<PurchaseEntry[]>(
    () =>
      purchaseDocs.map((doc) => {
        const billQty = doc.lines.reduce((total, line) => total + Math.max(0, line.quantity), 0);
        return {
          doc,
          stage: stageOfPersistedDoc(doc, journals),
          draft: false,
          poQty: doc.po_qty ?? billQty,
          grnQty: doc.grn_qty ?? doc.po_qty ?? billQty,
          poUnitPrices: Object.fromEntries(doc.lines.map((line) => [line.sku, line.unit_price_poisha])),
          missingTin: !doc.party_tin,
        };
      }),
    [purchaseDocs, journals],
  );

  const entries = useMemo(
    () =>
      [...drafts, ...persistedEntries].sort(
        (left, right) => right.doc.doc_date.localeCompare(left.doc.doc_date) || right.doc.created_at.localeCompare(left.doc.created_at),
      ),
    [drafts, persistedEntries],
  );

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cutoff = dateWindow === 'ALL' ? null : daysAgoIso(Number(dateWindow));
    return entries.filter((entry) => {
      if (stageTab !== 'ALL' && entry.stage !== stageTab) return false;
      if (lifecycleFilter !== 'ALL' && displayStatus(entry.doc, journals) !== lifecycleFilter) return false;
      if (cutoff && entry.doc.doc_date < cutoff) return false;
      if (!needle) return true;
      return (
        entry.doc.doc_number.toLowerCase().includes(needle) ||
        (entry.doc.mushak_serial ?? '').toLowerCase().includes(needle) ||
        entry.doc.party_name_en.toLowerCase().includes(needle) ||
        entry.doc.party_name_bn.includes(query.trim()) ||
        (entry.doc.party_tin ?? '').includes(needle) ||
        (entry.doc.party_bin ?? '').includes(needle) ||
        entry.doc.narration_en.toLowerCase().includes(needle)
      );
    });
  }, [entries, journals, query, stageTab, lifecycleFilter, dateWindow]);

  const periodDocs = purchaseDocs.filter((doc) => doc.doc_date.startsWith(PERIOD_CODE));
  const totals = useMemo(
    () =>
      periodDocs.reduce(
        (acc, doc) => ({
          base: acc.base + doc.base_poisha,
          vat: acc.vat + doc.vat_poisha,
          claimable: acc.claimable + doc.tax_claimable_poisha,
          disallowed: acc.disallowed + doc.tax_disallowed_poisha,
          vds: acc.vds + doc.vds_poisha,
          tds: acc.tds + doc.tds_poisha,
        }),
        { base: 0n, vat: 0n, claimable: 0n, disallowed: 0n, vds: 0n, tds: 0n },
      ),
    [periodDocs],
  );
  const openPayable = entries
    .filter((entry) => entry.stage === 'BILL_POSTED')
    .reduce((total, entry) => total + entry.doc.net_payable_poisha, 0n);
  const filteredNet = filteredEntries.reduce((total, entry) => total + entry.doc.net_payable_poisha, 0n);

  const activeEntry = workbench?.kind === 'doc' ? entries.find((entry) => entry.doc.id === workbench.docId) ?? null : null;
  const activeDoc = activeEntry?.doc ?? null;
  const activeStage = activeEntry?.stage ?? 'PURCHASE_ORDER';
  const activeSupplier = activeDoc ? parties.find((party) => party.id === activeDoc.party_id) ?? null : supplier;
  const activeDocType = activeDoc?.doc_type ?? docType;
  const activeIsImported = activeDocType === 'IMPORTED_SERVICE';

  const mode: WorkbenchMode = !workbench
    ? 'create'
    : workbench.kind === 'create'
      ? 'create'
      : !activeEntry
        ? 'create'
        : activeEntry.stage === 'SETTLED'
          ? 'view'
          : activeEntry.stage === 'BILL_POSTED'
            ? 'settle'
            : 'review';

  const activeMissingTin = activeDoc ? activeEntry?.missingTin ?? !activeDoc.party_tin : missingTin || !supplier?.tin;

  const activeTaxInput = useMemo<TaxEvaluationInput | null>(() => {
    if (!activeDoc) return null;
    return documentTaxInput(activeDoc, activeEntry?.missingTin ? null : activeSupplier, {
      tenant_is_withholding_entity: tenant.is_withholding_entity,
    });
  }, [activeDoc, activeEntry?.missingTin, activeSupplier, tenant.is_withholding_entity]);

  const activeDecision = useMemo(() => {
    if (!activeDoc || !activeTaxInput) return decision;
    return evaluateTaxDecision(activeTaxInput);
  }, [activeDoc, activeTaxInput, decision]);

  const activeTdsWithoutPenalty = useMemo(() => {
    if (!activeDoc || !activeTaxInput) {
      return evaluateTaxDecision({ ...advisorInput, party_tin: supplier?.tin });
    }
    return evaluateTaxDecision(documentTaxInput(activeDoc, activeSupplier, { tenant_is_withholding_entity: tenant.is_withholding_entity }));
  }, [activeDoc, activeTaxInput, activeSupplier, advisorInput, supplier, tenant.is_withholding_entity]);

  const activeTdsDelta = activeDecision.tds_poisha - activeTdsWithoutPenalty.tds_poisha;
  const penaltyDelta = activeTdsDelta > 0n ? activeTdsDelta : 0n;
  const penaltyActive = activeMissingTin && !activeIsImported && activeDecision.tds_bps > 0;

  const activeCashRisk =
    Boolean(activeTaxInput) &&
    activeTaxInput?.payment_method === 'CASH' &&
    activeDecision.base_poisha > activeDecision.cash_limit_poisha;

  const inputCredit = activeDecision.input_credit;
  const s46Checks = [
    {
      id: 'BIN',
      label: L('13-digit supplier BIN', '১৩-সংখ্যার সরবরাহকারী বিআইএন'),
      ok: activeDecision.bin_valid,
      detail: activeTaxInput?.party_bin ?? '—',
    },
    {
      id: 'TIN',
      label: L('12-digit supplier e-TIN', '১২-সংখ্যার সরবরাহকারী ই-টিআইএন'),
      ok: activeDecision.tin_valid,
      detail: activeTaxInput?.party_tin ?? '—',
    },
    {
      id: 'M63',
      label: L('Mushak 6.3 / RC challan held', 'মূসক ৬.৩ / আরসি চালান সংরক্ষিত'),
      ok: activeIsImported ? Boolean(activeTaxInput?.has_reverse_charge_challan) : Boolean(activeTaxInput?.has_valid_mushak63),
      detail: activeIsImported ? L('Reverse charge', 'রিভার্স চার্জ') : 'Mushak 6.3',
    },
    {
      id: 'CASH',
      label: L('Cash payment within the s.46 cap', 'নগদ পরিশোধ ধারা ৪৬ সীমার মধ্যে'),
      ok: !activeCashRisk,
      detail: money(activeDecision.cash_limit_poisha),
    },
    {
      id: 'RC',
      label: L('Reverse-charge challan where applicable', 'প্রযোজ্য ক্ষেত্রে রিভার্স-চার্জ চালান'),
      ok: !activeIsImported || Boolean(activeTaxInput?.has_reverse_charge_challan),
      detail: activeIsImported ? L('Imported service', 'আমদানি সেবা') : '—',
    },
  ];

  const billRows = useMemo(
    () =>
      activeDoc
        ? activeDoc.lines.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPrice: line.unit_price_poisha }))
        : lines.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPrice: parseBdt(line.unit_price_text) })),
    [activeDoc, lines],
  );
  const billQty = billRows.reduce((total, row) => total + Math.max(0, row.quantity), 0);
  const activePoQty = activeEntry?.poQty ?? billQty;
  const activeGrnQty = activeEntry?.grnQty ?? activePoQty;
  const poUnitPrices = activeEntry?.poUnitPrices ?? {};
  const priceVariance = billRows.reduce((total, row) => {
    const poPrice = poUnitPrices[row.sku] ?? row.unitPrice;
    const delta = row.unitPrice > poPrice ? row.unitPrice - poPrice : 0n;
    return total + delta * BigInt(Math.max(0, Math.round(row.quantity)));
  }, 0n);
  const qtyMatch = billQty <= activeGrnQty && activeGrnQty <= activePoQty;
  const priceMatch = priceVariance === 0n;
  const threeWayOk = qtyMatch && priceMatch;
  const threeWayRelevant =
    mode !== 'create' && (activeStage === 'GRN_RECEIVED' || activeStage === 'BILL_POSTED' || activeStage === 'SETTLED');

  const activeReceipt = useMemo(() => {
    const source = billRows.map((row) => ({
      sku: row.sku,
      quantity: Math.max(0, row.quantity),
      unit_cost_poisha: row.unitPrice,
    }));
    const disallowed = inputCredit.disallowed_poisha < 0n ? -inputCredit.disallowed_poisha : inputCredit.disallowed_poisha;
    return receiveInventoryStock(items, source, {
      basePoisha: activeDecision.base_poisha,
      disallowedVatPoisha: disallowed,
    });
  }, [billRows, inputCredit.disallowed_poisha, activeDecision.base_poisha, items]);

  const activeStockRow = billRows.find((row) => {
    const item = items.find((entry) => entry.sku === row.sku);
    return item && item.is_stock_item !== false;
  });
  const activeStockItem = activeStockRow ? items.find((item) => item.sku === activeStockRow.sku) : undefined;
  const projectedStockItem = activeStockItem ? activeReceipt.items.find((item) => item.sku === activeStockItem.sku) : undefined;

  const activePaymentJournal = activeDoc ? paymentJournalFor(activeDoc, journals) : undefined;
  const activeBankCode = activeDoc ? bankCodeFor(activeDoc.payment_method, activeDoc.payment_channel) : bankCodeFor(rail.method, rail.channel);
  const accountName = (code: string): string => accounts.find((account) => account.code === code)?.name_en ?? code;

  const journalPreview = useMemo(() => {
    const input = activeDoc ? activeTaxInput ?? advisorInput : advisorInput;
    const evaluated = activeDoc ? activeDecision : decision;
    return previewTaxJournal(input, evaluated);
  }, [activeDoc, activeTaxInput, advisorInput, activeDecision, decision]);

  useEffect(() => {
    if (!workbench) return;
    if (masterTab) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setWorkbench(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [workbench, masterTab]);

  const openCreate = (): void => {
    setFeedback(null);
    setWorkbench({ kind: 'create' });
  };

  const openDoc = (docId: string): void => {
    setFeedback(null);
    setWorkbench({ kind: 'doc', docId });
  };

  const closeWorkbench = (): void => {
    setWorkbench(null);
    setFeedback(null);
  };

  const billQtyFromDraft = (): number => lines.reduce((total, line) => total + Math.max(0, Math.round(line.quantity)), 0);

  const buildDraft = (
    stage: PurchaseStage,
    meta?: { poQty?: number; grnQty?: number; poUnitPrices?: Record<string, bigint> },
  ): TaxAnnotatedDoc | null => {
    if (!supplier) return null;
    const prefix = stage === 'PURCHASE_ORDER' ? 'PO' : 'GRN';
    const docNumber = `${prefix}-${docDate.slice(0, 7)}-${String(draftSeq).padStart(4, '0')}`;
    const built = buildCommercialDoc({
      doc_type: docType,
      doc_number: docNumber,
      doc_date: docDate,
      due_date: addDays(docDate, supplier.credit_days || 15),
      party: supplier,
      bin_unit_id: tenant.bin_units[0]?.id ?? '',
      lines: lines.map((line, index) => ({
        id: `${docNumber}-L${index + 1}`,
        sku: line.sku || `PUR-${docDate.replace(/-/g, '')}-${index + 1}`,
        description_en: line.description_en || 'Purchase line',
        description_bn: line.description_bn || line.description_en || 'ক্রয় লাইন',
        quantity: Math.max(1, Math.round(line.quantity)),
        unit_price_poisha: parseBdt(line.unit_price_text),
        tax_category: isImported ? 'REVERSE_CHARGE' : line.tax_category,
      })),
      base_poisha: base,
      tax_category: isImported ? 'REVERSE_CHARGE' : category,
      tds_nature: isImported ? 'NONE' : tdsNature,
      payment_method: rail.method,
      narration_en: narration || 'Purchase document',
      narration_bn: narration || 'ক্রয় দলিল',
      reverse_charge: isImported,
      vds_applicable: withholdVds && !isImported,
      book_type: 'STATUTORY_BD',
      created_by: currentUser.full_name,
      status: 'DRAFT',
      mushak_serial: `M63-SUP-${docDate.slice(0, 7)}-${String(draftSeq).padStart(4, '0')}`,
      vehicle_no: vehicleNo,
      destination,
      payment_channel: rail.channel,
    });
    built.doc.workflow_stage = stage;
    built.doc.po_qty = meta?.poQty ?? (stage === 'PURCHASE_ORDER' ? billQtyFromDraft() : 0);
    built.doc.grn_qty = meta?.grnQty ?? 0;
    if (missingTin) built.doc.party_tin = undefined;
    return built.doc;
  };

  const savePurchaseOrder = (): void => {
    if (!canDraft) {
      setFeedback({ tone: 'error', text: L('Your role cannot create commercial drafts.', 'আপনার ভূমিকা বাণিজ্যিক খসড়া তৈরি করতে পারে না।') });
      return;
    }
    if (!supplier) {
      setFeedback({ tone: 'error', text: L('Select a supplier before saving.', 'সংরক্ষণের আগে সরবরাহকারী নির্বাচন করুন।') });
      return;
    }
    if (base <= 0n) {
      setFeedback({ tone: 'error', text: L('Add at least one line with a positive value.', 'ধনাত্মক মূল্যসহ অন্তত একটি লাইন যোগ করুন।') });
      return;
    }
    const qty = billQtyFromDraft();
    const prices = Object.fromEntries(lines.map((line) => [line.sku, parseBdt(line.unit_price_text)]));
    const draft = buildDraft('PURCHASE_ORDER', { poQty: qty, grnQty: 0, poUnitPrices: prices });
    if (!draft) return;
    setDrafts((previous) => [
      { doc: draft, stage: 'PURCHASE_ORDER', draft: true, poQty: qty, grnQty: 0, poUnitPrices: prices, missingTin },
      ...previous,
    ]);
    setDraftSeq((value) => value + 1);
    setWorkbench({ kind: 'doc', docId: draft.id });
    setFeedback({ tone: 'success', text: `${draft.doc_number} · ${L('purchase order issued', 'ক্রয় অর্ডার ইস্যু')} · ${money(draft.gross_poisha)}` });
  };

  const postBill = (settleNow: boolean): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to post a vendor bill.', 'সরবরাহকারী বিল পোস্টে POST_TO_GL প্রয়োজন।') });
      return;
    }
    if (!supplier) {
      setFeedback({ tone: 'error', text: L('Select a supplier before posting.', 'পোস্ট করার আগে সরবরাহকারী নির্বাচন করুন।') });
      return;
    }
    if (base <= 0n) {
      setFeedback({ tone: 'error', text: L('Add at least one line with a positive value.', 'ধনাত্মক মূল্যসহ অন্তত একটি লাইন যোগ করুন।') });
      return;
    }
    if (decision.decision === 'NOT_SUPPORTED' || decision.decision === 'SOURCE_DISPUTED_OR_EXPIRED') {
      setFeedback({ tone: 'error', text: L('The tax engine blocks this document. Review the advisor guardrails.', 'কর ইঞ্জিন এই দলিল ব্লক করেছে। উপদেষ্টার সতর্কতা দেখুন।') });
      return;
    }
    if (!threeWayOk && settleNow) {
      setFeedback({ tone: 'error', text: L('Resolve the 3-way match before paying the supplier.', 'সরবরাহকারীকে পরিশোধের আগে থ্রি-ওয়ে ম্যাচ সমাধান করুন।') });
      return;
    }
    const qty = billQtyFromDraft();
    const result = postCommercialDoc(
      {
        doc_type: docType,
        doc_date: docDate,
        party_id: supplier.id,
        bin_unit_id: tenant.bin_units[0]?.id ?? '',
        lines: lines.map((line, index) => ({
          sku: line.sku || `PUR-${docDate.replace(/-/g, '')}-${index + 1}`,
          description_en: line.description_en || 'Purchase line',
          description_bn: line.description_bn || line.description_en || 'ক্রয় লাইন',
          quantity: Math.max(1, Math.round(line.quantity)),
          unit_price_poisha: parseBdt(line.unit_price_text),
          tax_category: isImported ? 'REVERSE_CHARGE' : line.tax_category,
        })),
        tax_category: isImported ? 'REVERSE_CHARGE' : category,
        tds_nature: isImported ? 'NONE' : tdsNature,
        payment_method: rail.method,
        narration_en: `${DOC_KINDS.find((kind) => kind.id === docType)?.en} — ${narration || lines[0]?.description_en || 'Purchase'} — ${supplier.name_en}`,
        narration_bn: `${DOC_KINDS.find((kind) => kind.id === docType)?.bn} — ${narration || lines[0]?.description_bn || 'ক্রয়'} — ${supplier.name_bn}`,
        reverse_charge: isImported,
        withhold_vds: withholdVds && !isImported,
        sd_applicable: sd && !isImported,
        book_type: 'STATUTORY_BD',
        auto_post: true,
        workflow_stage: settleNow ? 'SETTLED' : 'BILL_POSTED',
        po_qty: qty,
        grn_qty: qty,
        vehicle_no: vehicleNo,
        destination,
        payment_channel: rail.channel,
      },
      { settle: settleNow },
    );
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Posting rejected.', 'পোস্ট বাতিল হয়েছে।') });
      return;
    }
    setWorkbench({ kind: 'doc', docId: result.data.id });
    setFeedback({
      tone: 'success',
      text: `${result.data.doc_number} · ${L('VDS', 'ভিডিএস')} ${money(result.data.vds_poisha)} · ${L('TDS', 'টিডিএস')} ${money(result.data.tds_poisha)} · ${money(result.data.gross_poisha)}`,
    });
  };

  const receiveGrn = (entry: PurchaseEntry): void => {
    if (!entry.draft) {
      openDoc(entry.doc.id);
      return;
    }
    if (!canStock) {
      setFeedback({ tone: 'error', text: L('DISPATCH_OR_RECEIVE_STOCK is required to record a GRN.', 'জিআরএন রেকর্ডে DISPATCH_OR_RECEIVE_STOCK প্রয়োজন।') });
      return;
    }
    const receivedQty = entry.doc.lines.reduce((total, line) => total + Math.max(0, Math.round(line.quantity)), 0);
    const nextDoc: TaxAnnotatedDoc = {
      ...entry.doc,
      doc_number: renumbered(entry.doc, 'GRN'),
      workflow_stage: 'GRN_RECEIVED',
      grn_qty: receivedQty,
    };
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.doc.id === entry.doc.id
          ? { ...draft, stage: 'GRN_RECEIVED', doc: nextDoc, grnQty: receivedQty, poQty: entry.poQty || receivedQty }
          : draft,
      ),
    );
    setFeedback({
      tone: 'success',
      text: `${entry.doc.doc_number} → ${nextDoc.doc_number} · ${receivedQty} ${L('unit(s) received', 'ইউনিট গৃহীত')}`,
    });
  };

  const updateGrnQty = (entry: PurchaseEntry, value: number): void => {
    const nextQty = Math.max(0, Math.round(value));
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.doc.id === entry.doc.id
          ? { ...draft, grnQty: nextQty, doc: { ...draft.doc, grn_qty: nextQty } }
          : draft,
      ),
    );
  };

  const postBillFromEntry = (entry: PurchaseEntry): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to post the vendor bill.', 'সরবরাহকারী বিল পোস্টে POST_TO_GL প্রয়োজন।') });
      return;
    }
    const matchOk = entryMatchOk(entry);
    if (!matchOk && !canOverride) {
      setFeedback({
        tone: 'error',
        text: L(
          'The 3-way match has a variance. A CONTROLLER or ADMIN must override before this bill can post.',
          'থ্রি-ওয়ে ম্যাচে ভ্যারিয়েন্স আছে। পোস্টের আগে CONTROLLER বা ADMIN-কে ওভাররাইড করতে হবে।',
        ),
      });
      return;
    }
    const { billQty, poQty, grnQty } = entryQuantities(entry);
    const result = postCommercialDoc(
      {
        doc_type: entry.doc.doc_type,
        doc_date: entry.doc.doc_date,
        party_id: entry.doc.party_id,
        bin_unit_id: entry.doc.bin_unit_id,
        lines: entry.doc.lines.map((line) => ({
          sku: line.sku,
          description_en: line.description_en,
          description_bn: line.description_bn,
          quantity: line.quantity,
          unit_price_poisha: line.unit_price_poisha,
          tax_category: line.tax_category,
        })),
        tax_category: entry.doc.tax_category,
        tds_nature: entry.doc.tds_nature,
        payment_method: entry.doc.payment_method,
        narration_en: `Converted from ${entry.doc.doc_number} — ${entry.doc.narration_en}`,
        narration_bn: `${entry.doc.doc_number} থেকে রূপান্তর — ${entry.doc.narration_bn}`,
        reverse_charge: entry.doc.reverse_charge,
        withhold_vds: entry.doc.vds_poisha > 0n,
        sd_applicable: entry.doc.sd_poisha > 0n,
        book_type: entry.doc.book_type,
        auto_post: true,
        workflow_stage: 'BILL_POSTED',
        po_qty: poQty,
        grn_qty: grnQty,
        vehicle_no: entry.doc.vehicle_no,
        destination: entry.doc.destination,
        payment_channel: entry.doc.payment_channel,
      },
      { settle: false },
    );
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Bill posting rejected.', 'বিল পোস্ট বাতিল হয়েছে।') });
      return;
    }
    setDrafts((previous) => previous.filter((draft) => draft.doc.id !== entry.doc.id));
    setWorkbench({ kind: 'doc', docId: result.data.id });
    setFeedback({
      tone: 'success',
      text: `${result.data.doc_number} · ${matchOk ? L('3-way matched', 'থ্রি-ওয়ে মিলিত') : L('override posted', 'ওভাররাইড পোস্টেড')} · ${billQty} ${L('units billed', 'ইউনিট বিলকৃত')}`,
    });
  };

  const paySupplier = (doc: TaxAnnotatedDoc): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to pay the supplier.', 'সরবরাহকারীকে পরিশোধে POST_TO_GL প্রয়োজন।') });
      return;
    }
    const existing = paymentJournalFor(doc, journals);
    if (existing) {
      setFeedback({ tone: 'info', text: `${L('Payment already posted', 'পরিশোধ ইতিমধ্যে পোস্টেড')} · ${existing.journal_number}` });
      return;
    }
    const bankCode = bankCodeFor(doc.payment_method, doc.payment_channel);
    const paymentLines: JournalLineDraft[] = [
      {
        account_code: '2110',
        account_name_en: accountName('2110'),
        debit_poisha: doc.gross_poisha,
        memo: `Trade payable settled — ${doc.doc_number}`,
        party_id: doc.party_id,
        party_name: doc.party_name_en,
      },
    ];
    if (doc.vds_poisha > 0n) {
      paymentLines.push({
        account_code: '2130',
        account_name_en: accountName('2130'),
        credit_poisha: doc.vds_poisha,
        memo: `VDS withheld — Mushak 6.6 challan queued (${doc.doc_number})`,
        party_id: doc.party_id,
        party_name: doc.party_name_en,
      });
    }
    if (doc.tds_poisha > 0n) {
      paymentLines.push({
        account_code: '2140',
        account_name_en: accountName('2140'),
        credit_poisha: doc.tds_poisha,
        memo: `TDS withheld — Treasury challan queued (${doc.doc_number})`,
        party_id: doc.party_id,
        party_name: doc.party_name_en,
      });
    }
    paymentLines.push({
      account_code: bankCode,
      account_name_en: accountName(bankCode),
      credit_poisha: doc.net_payable_poisha,
      memo: `Paid to supplier net of withholding — ${doc.doc_number}`,
      party_id: doc.party_id,
      party_name: doc.party_name_en,
    });

    const result = postManualJournal({
      date: TODAY,
      book_type: doc.book_type,
      narration_en: `${PAYMENT_PREFIX}${doc.doc_number} — ${doc.party_name_en} · VDS ${money(doc.vds_poisha)} · TDS ${money(doc.tds_poisha)}`,
      narration_bn: `সরবরাহকারী পরিশোধ ${doc.doc_number} — ${doc.party_name_bn} · ভিডিএস ${money(doc.vds_poisha)} · টিডিএস ${money(doc.tds_poisha)}`,
      source_module: 'BANK_MFS',
      lines: paymentLines,
    });
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Payment rejected.', 'পরিশোধ বাতিল হয়েছে।') });
      return;
    }
    setFeedback({
      tone: 'success',
      text: `${L('Payment', 'পরিশোধ')} ${result.data.journal_number} · ${money(doc.net_payable_poisha)} ${L('paid', 'প্রদত্ত')} · ${L('VDS/TDS queued for the treasury challan', 'ভিডিএস/টিডিএস ট্রেজারি চালানের জন্য অপেক্ষমাণ')}`,
    });
  };

  const advanceEntry = (entry: PurchaseEntry): void => {
    if (entry.stage === 'PURCHASE_ORDER') {
      receiveGrn(entry);
      return;
    }
    if (entry.stage === 'GRN_RECEIVED') {
      postBillFromEntry(entry);
      return;
    }
    if (entry.stage === 'BILL_POSTED') {
      paySupplier(entry.doc);
      return;
    }
    openDoc(entry.doc.id);
  };

  const quickAction = (entry: PurchaseEntry): void => {
    if (entry.draft && entry.stage === 'PURCHASE_ORDER') {
      receiveGrn(entry);
      return;
    }
    openDoc(entry.doc.id);
  };

  const openLens = (doc: TaxAnnotatedDoc, tab: 'ENTRY' | 'INTEGRITY' | 'REVERSAL' = 'ENTRY'): void => {
    const payment = paymentJournalFor(doc, journals);
    const journalId =
      tab === 'REVERSAL'
        ? doc.document_journal_id ?? doc.journal_id ?? null
        : payment?.id ?? doc.document_journal_id ?? doc.journal_id ?? doc.settlement_journal_id ?? null;
    if (!journalId) {
      setFeedback({ tone: 'error', text: L('This document has no journal yet.', 'এই দলিলের কোনো খতিয়ান নেই।') });
      return;
    }
    setLensJournalId(journalId);
    setLensTab(tab);
    setLensContext(`${doc.doc_number} · ${doc.doc_type.replaceAll('_', ' ')} · ${doc.party_name_en}`);
  };

  const lensJournal = journals.find((journal) => journal.id === lensJournalId) ?? null;

  const tableActionLabel = (entry: PurchaseEntry): string => {
    if (entry.stage === 'SETTLED') return L('Go to Treasury Challan Queue', 'ট্রেজারি চালান সারি');
    return isBn ? STAGE_META[entry.stage].nextBn : STAGE_META[entry.stage].nextEn;
  };

  const presets: DemoPreset[] = [
    {
      id: 'inventory',
      labelEn: 'Standard 15% inventory purchase',
      labelBn: 'আদর্শ ১৫% ইনভেন্টরি ক্রয়',
      hintEn: 'Padma Industrial · 5 laptops · input VAT fully rebate-eligible',
      hintBn: 'পদ্মা ইন্ডাস্ট্রিয়াল · ৫টি ল্যাপটপ · ইনপুট ভ্যাট সম্পূর্ণ রিবেটযোগ্য',
      tone: 'emerald',
    },
    {
      id: 'consultancy',
      labelEn: 'Professional consultancy (VDS + TDS stacked)',
      labelBn: 'পেশাগত পরামর্শ (ভিডিএস + টিডিএস)',
      hintEn: 'Rahman & Chowdhury · 15% VDS + 10% TDS on the same base',
      hintBn: 'রহমান অ্যান্ড চৌধুরী · একই ভিত্তিতে ১৫% ভিডিএস + ১০% টিডিএস',
      tone: 'indigo',
    },
    {
      id: 'missing-tin',
      labelEn: 'Vendor missing e-TIN (50% upscale)',
      labelBn: 'ভেন্ডরের ই-টিআইএন নেই (৫০% বৃদ্ধি)',
      hintEn: 'Karnaphuli Traders · TDS 3% → 4.5% automatically',
      hintBn: 'কর্ণফুলী ট্রেডার্স · টিডিএস ৩% → ৪.৫% স্বয়ংক্রিয়',
      tone: 'rose',
    },
    {
      id: 'cash',
      labelEn: 'Cash purchase > BDT 1,00,000',
      labelBn: 'নগদ ক্রয় > ১,০০,০০০ টাকা',
      hintEn: 's.46 input VAT disallowed and capitalised into inventory cost',
      hintBn: 'ধারা ৪৬ ইনপুট ভ্যাট বাতিল ও ইনভেন্টরি ব্যয়ে মূলধনায়িত',
      tone: 'amber',
    },
    {
      id: 'imported',
      labelEn: 'Meta / Google imported digital service',
      labelBn: 'মেটা / গুগল আমদানি ডিজিটাল সেবা',
      hintEn: 'Reverse-charge VAT 15% · self-assessed challan',
      hintBn: 'রিভার্স-চার্জ ভ্যাট ১৫% · স্ব-নির্ধারিত চালান',
      tone: 'violet',
    },
  ];

  const applyPreset = (preset: DemoPreset): void => {
    setFeedback(null);
    const itemOf = (sku: string) => items.find((item) => item.sku === sku);
    const lineOf = (sku: string, quantity: number, taxCategory: TaxCategory = 'STANDARD_15'): DraftLine => {
      const item = itemOf(sku);
      return item ? { ...lineFromItem(item), quantity, tax_category: taxCategory } : newDraftLine({ quantity, tax_category: taxCategory });
    };
    const supplierByName = (needle: string): string =>
      suppliers.find((party) => party.name_en.toLowerCase().includes(needle.toLowerCase()))?.id ?? suppliers[0]?.id ?? '';

    if (preset.id === 'inventory') {
      setDocType('PURCHASE_BILL');
      setSupplierId(supplierByName('Padma'));
      setLines([lineOf('HS-8471.30', 5)]);
      setCategory('STANDARD_15');
      setTdsNature('SUPPLY_OF_GOODS');
      setMissingTin(false);
      setWithholdVds(true);
      setSd(false);
      setPaymentChoice('BANK');
      setVehicleNo('DHAKA METRO-GA 11-7788');
      setDestination('Apex Delta warehouse, Tejgaon, Dhaka');
      setNarration('Inventory purchase of portable laptop computers — fully rebate-eligible.');
    } else if (preset.id === 'consultancy') {
      setDocType('EXPENSE_VOUCHER');
      setSupplierId(supplierByName('Rahman'));
      setLines([lineOf('SVC-9983.11', 1)]);
      setCategory('STANDARD_15');
      setTdsNature('PROFESSIONAL_OR_TECHNICAL_SERVICES');
      setMissingTin(false);
      setWithholdVds(true);
      setSd(false);
      setPaymentChoice('BANK');
      setVehicleNo('—');
      setDestination('Motijheel C/A, Dhaka 1000');
      setNarration('IT consultancy and systems integration fee — 15% VDS and 10% TDS stacked on the base.');
    } else if (preset.id === 'missing-tin') {
      setDocType('PURCHASE_BILL');
      setSupplierId(supplierByName('Karnaphuli'));
      setLines([lineOf('HS-8544.42', 12)]);
      setCategory('STANDARD_15');
      setTdsNature('SUPPLY_OF_GOODS');
      setMissingTin(true);
      setWithholdVds(true);
      setSd(false);
      setPaymentChoice('BANK');
      setVehicleNo('CHATTOGRAM-THA 11-2233');
      setDestination('Khatunganj, Chattogram 4000');
      setNarration('Purchase from a supplier with no e-TIN on file — TDS upscaled by 50%.');
    } else if (preset.id === 'cash') {
      setDocType('PURCHASE_BILL');
      setSupplierId(supplierByName('Padma'));
      setLines([lineOf('HS-9403.60', 4)]);
      setCategory('STANDARD_15');
      setTdsNature('SUPPLY_OF_GOODS');
      setMissingTin(false);
      setWithholdVds(false);
      setSd(false);
      setPaymentChoice('CASH');
      setVehicleNo('DHAKA METRO-THA 13-9900');
      setDestination('Apex Delta warehouse, Tejgaon, Dhaka');
      setNarration('Cash purchase of wooden office furniture above the s.46 threshold.');
    } else {
      setDocType('IMPORTED_SERVICE');
      setSupplierId(supplierByName('Meta'));
      setLines([lineOf('SVC-7310.10', 1, 'REVERSE_CHARGE')]);
      setCategory('REVERSE_CHARGE');
      setTdsNature('NONE');
      setMissingTin(false);
      setWithholdVds(false);
      setSd(false);
      setPaymentChoice('BANK');
      setVehicleNo('—');
      setDestination('Dublin, Ireland — digital service');
      setNarration('Meta / Google digital advertising imported service — self-assessed reverse-charge VAT 15%.');
    }
  };

  const fillSample = (): void => {
    const preset = presets[sampleIndex % presets.length];
    applyPreset(preset);
    setSampleIndex((value) => value + 1);
    if (!workbench) setWorkbench({ kind: 'create' });
    setFeedback({ tone: 'info', text: `${L('Sample data loaded', 'নমুনা ডেটা লোড')} · ${isBn ? preset.labelBn : preset.labelEn}` });
  };

  const exportCsv = (): void => {
    const header = ['Doc #', 'Date', 'Supplier', 'BIN', 'e-TIN', 'Stage', '3-Way Match', 'Base', 'Input VAT', 'VDS', 'TDS', 'Net payable'];
    const rows = filteredEntries.map((entry) => [
      entry.doc.doc_number,
      entry.doc.doc_date,
      entry.doc.party_name_en,
      entry.doc.party_bin ?? '',
      entry.doc.party_tin ?? '',
      STAGE_META[entry.stage].labelEn,
      entryMatchOk(entry) ? 'PO = GRN = Bill' : 'Variance',
      money(entry.doc.base_poisha, { symbol: false }),
      money(entry.doc.vat_poisha, { symbol: false }),
      money(entry.doc.vds_poisha, { symbol: false }),
      money(entry.doc.tds_poisha, { symbol: false }),
      money(entry.doc.net_payable_poisha, { symbol: false }),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `purchase-register-${TODAY}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stepCurrent = mode === 'create' ? 0 : stageIndex(activeStage);
  const decisionTone =
    activeDecision.decision === 'SUPPORTED'
      ? 'lv-chip-emerald'
      : activeDecision.decision === 'SUPPORTED_WITH_CONDITIONS'
        ? 'lv-chip-gold'
        : 'lv-chip-rose';
  const drawerOpen = workbench !== null && (workbench.kind === 'create' || activeEntry !== null);
  const activeLinesForEditor: DraftLine[] = activeDoc
    ? activeDoc.lines.map((line) => ({
        id: line.id,
        item_id: 'CUSTOM',
        sku: line.sku,
        hs_code: '',
        description_en: line.description_en,
        description_bn: line.description_bn,
        quantity: line.quantity,
        unit_price_text: (Number(line.unit_price_poisha) / 100).toFixed(2),
        unit_en: 'pcs',
        unit_bn: 'পিস',
        tax_category: line.tax_category,
      }))
    : lines;

  return (
    <>
      <WorkspaceHeader
        icon={<Truck size={18} />}
        kickerEn="Workspace 03 · Purchases · Procure-to-Pay"
        kickerBn="ওয়ার্কস্পেস ০৩ · ক্রয় · প্রকিউর-টু-পে"
        titleEn="Vendor bills, 3-way match & withholding"
        titleBn="সরবরাহকারী বিল, থ্রি-ওয়ে ম্যাচ ও কর্তন"
        isBn={isBn}
        chips={
          <>
            <span className="lv-chip lv-chip-gold">
              <Banknote size={12} /> {L('Cash cap', 'নগদ সীমা')} {money(cashLimit)}
            </span>
            <span className="lv-chip lv-chip-neutral">
              <Stamp size={12} /> {L('Mushak 6.1 register', 'মূসক ৬.১ রেজিস্টার')}
            </span>
            <span className="lv-chip lv-chip-emerald">
              <ShieldCheck size={12} /> {L('s.46 guard live', 'ধারা ৪৬ সক্রিয়')}
            </span>
            <span className="lv-chip lv-chip-neutral">
              <Landmark size={12} /> {L('Input VAT claimable', 'দাবিযোগ্য ইনপুট ভ্যাট')} <span className="font-money">{money(totals.claimable)}</span>
            </span>
          </>
        }
        actions={
          <>
            <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[11px]" onClick={() => setPrintReturnOpen(true)}>
              <Printer size={13} /> {L('A4 9.1', 'এ৪ ৯.১')}
            </button>
            <button
              type="button"
              className="lv-btn lv-btn-primary !py-1.5"
              onClick={openCreate}
              disabled={!canDraft}
              title={canDraft ? L('Open the purchase document workbench', 'ক্রয় দলিল ওয়ার্কবেঞ্চ খুলুন') : isAuditor ? 'Read-Only Auditor Mode' : 'CREATE_COMMERCIAL_DRAFT required'}
            >
              <Plus size={14} /> {L('New Purchase Order / Bill', 'নতুন ক্রয় অর্ডার / বিল')}
            </button>
          </>
        }
      />

      <main className="space-y-4">
        {/* ZONE A — pipeline stage bar + filters */}
        <section className="lv-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                {L('Procure-to-pay pipeline', 'প্রকিউর-টু-পে পাইপলাইন')}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-ink-400">
              <span>
                {entries.length} {L('documents', 'দলিল')}
              </span>
              <span className="text-ink-300">·</span>
              <span>
                {L('Open AP', 'খোলা প্রদেয়')} <span className="font-money font-semibold text-ink-700">{money(openPayable)}</span>
              </span>
              <span className="text-ink-300">·</span>
              <span>
                {L('s.46 disallowed', 'ধারা ৪৬ বাতিল')} <span className="font-money font-semibold text-rose-600">{money(totals.disallowed)}</span>
              </span>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
            {PURCHASE_TABS.map((tab) => {
              const count = tab.id === 'ALL' ? entries.length : entries.filter((entry) => entry.stage === tab.id).length;
              const active = stageTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStageTab(tab.id)}
                  aria-pressed={active}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                    active ? 'border-vault-800 bg-vault-900 text-white shadow-lift' : 'border-line bg-surface text-ink-600 hover:border-vault-300 hover:bg-vault-50/60'
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-ink-700'}`}>{isBn ? tab.labelBn : tab.labelEn}</span>
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${active ? 'bg-white/15 text-white' : 'bg-ink-100 text-ink-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-surface-2/40 px-4 py-2.5">
            <label className="relative min-w-[220px] flex-1 sm:max-w-[360px]">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="lv-input !py-1.5 pl-8 text-[11.5px]"
                placeholder={L('Search by bill, supplier, TIN or BIN…', 'বিল, সরবরাহকারী, টিআইএন বা বিআইএন দিয়ে খুঁজুন…')}
                aria-label={L('Search purchase documents', 'ক্রয় দলিল খুঁজুন')}
              />
            </label>
            <select
              value={lifecycleFilter}
              onChange={(event) => setLifecycleFilter(event.target.value as LifecycleFilter)}
              className="lv-input w-auto !py-1.5 !text-[10.5px]"
              aria-label={L('Status filter', 'অবস্থা ফিল্টার')}
            >
              {LIFECYCLE_FILTERS.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {isBn ? filter.labelBn : filter.labelEn}
                </option>
              ))}
            </select>
            <select
              value={dateWindow}
              onChange={(event) => setDateWindow(event.target.value as DateWindow)}
              className="lv-input w-auto !py-1.5 !text-[10.5px]"
              aria-label={L('Date filter', 'তারিখ ফিল্টার')}
            >
              <option value="ALL">{L('All dates', 'সব তারিখ')}</option>
              <option value="7">{L('Last 7 days', 'শেষ ৭ দিন')}</option>
              <option value="30">{L('Last 30 days', 'শেষ ৩০ দিন')}</option>
              <option value="90">{L('Last 90 days', 'শেষ ৯০ দিন')}</option>
            </select>
            <span className="hidden text-[10px] text-ink-400 lg:inline">
              {filteredEntries.length}/{entries.length} {L('shown', 'দেখানো')}
            </span>
            <button type="button" className="lv-btn lv-btn-secondary ml-auto !py-1.5 !text-[10.5px]" onClick={exportCsv}>
              <Download size={12} /> {L('Export', 'রপ্তানি')}
            </button>
          </div>
        </section>

        {/* ZONE B — clean master table with 3-way pills */}
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker flex items-center gap-1.5">
                <Layers size={12} /> {L('Commercial master data', 'বাণিজ্যিক মাস্টার ডেটা')}
              </p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">
                {L('Mushak 6.1 — vendor documents by P2P stage', 'মূসক ৬.১ — পিটুপি ধাপে সরবরাহকারী দলিল')}
              </h2>
              <p className="mt-0.5 text-[10px] text-ink-400">
                {L('Click any row to open the focused workbench. The 3-way pill shows whether PO, GRN and bill agree on quantity and price.', 'যেকোনো সারিতে ক্লিক করে ওয়ার্কবেঞ্চ খুলুন। থ্রি-ওয়ে পিল দেখায় পিও, জিআরএন ও বিল পরিমাণ ও মূল্যে মিলেছে কি না।')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="lv-chip lv-chip-neutral">
                {filteredEntries.length}/{entries.length} {L('docs', 'দলিল')}
              </span>
              <span className="lv-chip lv-chip-gold">
                {L('Filtered net', 'ফিল্টারকৃত নিট')} <span className="font-money">{money(filteredNet)}</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="lv-table min-w-[1240px]">
              <thead>
                <tr>
                  <th>{L('Document', 'দলিল')}</th>
                  <th>{L('Date', 'তারিখ')}</th>
                  <th>{L('Supplier (TIN)', 'সরবরাহকারী (টিআইএন)')}</th>
                  <th>{L('3-Way Match', 'থ্রি-ওয়ে ম্যাচ')}</th>
                  <th>{L('Stage', 'ধাপ')}</th>
                  <th>{L('Stock / GRN', 'স্টক / জিআরএন')}</th>
                  <th className="text-right">{L('Net payable', 'নিট প্রদেয়')}</th>
                  <th className="text-right">{L('Next action', 'পরবর্তী কার্য')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const doc = entry.doc;
                  const matchOk = entryMatchOk(entry);
                  const stockLine = doc.lines.find((line) => {
                    const item = items.find((candidate) => candidate.sku === line.sku);
                    return item && item.is_stock_item !== false;
                  });
                  const stockItem = stockLine ? items.find((item) => item.sku === stockLine.sku) : undefined;
                  return (
                    <tr key={doc.id} className="cursor-pointer" onClick={() => openDoc(doc.id)}>
                      <td>
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-200">
                            {entry.stage === 'SETTLED' ? <CheckCheck size={13} /> : entry.stage === 'GRN_RECEIVED' ? <Truck size={13} /> : <FileText size={13} />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11.5px] font-semibold text-ink-900">{doc.doc_number}</p>
                            <p className="text-[9px] uppercase tracking-wide text-ink-400">
                              {doc.doc_type.replaceAll('_', ' ')}
                              {doc.reverse_charge ? ` · ${L('RC', 'আরসি')}` : ''}
                              {doc.payment_method === 'CASH' ? ` · ${L('CASH', 'নগদ')}` : ''}
                            </p>
                            <p className="mt-0.5 font-mono text-[9px] text-vault-700">{doc.mushak_serial ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-[10.5px]">{formatDate(doc.doc_date, locale)}</td>
                      <td>
                        <p className="text-[11px] font-medium text-ink-800">{doc.party_name_en}</p>
                        <p className={`font-mono text-[9px] ${doc.party_tin ? 'text-ink-400' : 'font-semibold text-rose-600'}`}>
                          {doc.party_tin ? `${L('TIN', 'টিআইএন')} ${doc.party_tin}` : L('Missing TIN — TDS +50%', 'টিআইএন নেই — টিডিএস +৫০%')}
                        </p>
                      </td>
                      <td>
                        <MatchPill stage={entry.stage} ok={matchOk} isBn={isBn} />
                        <p className="mt-0.5 font-mono text-[8.5px] text-ink-400">
                          {entry.stage === 'BILL_POSTED' || entry.stage === 'SETTLED'
                            ? `${entry.poQty}/${entry.grnQty}/${entry.doc.lines.reduce((total, line) => total + line.quantity, 0)}`
                            : `${entry.poQty}/${entry.grnQty || '—'}`}
                        </p>
                      </td>
                      <td>
                        <StageBadge stage={entry.stage} isBn={isBn} />
                        <StageProgress stage={entry.stage} />
                      </td>
                      <td>
                        {stockLine && stockItem ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-vault-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-vault-700 ring-1 ring-inset ring-vault-100">
                            <Warehouse size={9} /> {stockItem.qty_on_hand ?? 0} {L('on hand', 'স্টকে')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[8.5px] font-semibold text-ink-500">
                            <Boxes size={9} /> {L('Service', 'সেবা')}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <p className="font-money text-[11px] font-semibold text-ink-900">{money(doc.net_payable_poisha)}</p>
                        <p className="font-money text-[9px] text-ink-400">
                          {L('VAT', 'ভ্যাট')} {money(doc.vat_poisha, { symbol: false })}
                          {doc.tax_disallowed_poisha > 0n ? ` · s.46 −${money(doc.tax_disallowed_poisha, { symbol: false })}` : ''}
                        </p>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={`lv-btn !px-2.5 !py-1 !text-[10px] ${entry.stage === 'SETTLED' ? 'lv-btn-ghost' : 'lv-btn-secondary'}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            quickAction(entry);
                          }}
                          disabled={
                            entry.stage === 'PURCHASE_ORDER'
                              ? !canStock
                              : entry.stage === 'GRN_RECEIVED' || entry.stage === 'BILL_POSTED'
                                ? !canPost
                                : false
                          }
                          title={entry.stage === 'SETTLED' ? tableActionLabel(entry) : L('Open the workbench to confirm this transition', 'এই রূপান্তর নিশ্চিত করতে ওয়ার্কবেঞ্চ খুলুন')}
                        >
                          {tableActionLabel(entry)} <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-400">
                          <ReceiptText size={18} />
                        </span>
                        <p className="text-xs font-semibold text-ink-600">{L('No purchase document matches these filters.', 'এই ফিল্টারে কোনো ক্রয় দলিল মেলেনি।')}</p>
                        <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[11px]" onClick={openCreate} disabled={!canDraft}>
                          <Plus size={13} /> {L('Create the first purchase document', 'প্রথম ক্রয় দলিল তৈরি করুন')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5 text-[10px] text-ink-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} /> {L('3-way match: bill qty ≤ GRN qty ≤ PO qty and bill price ≤ PO price. Variances need OVERRIDE_3WAY_VARIANCE.', 'থ্রি-ওয়ে ম্যাচ: বিল পরিমাণ ≤ জিআরএন ≤ পিও এবং বিল মূল্য ≤ পিও মূল্য। ভ্যারিয়েন্সে OVERRIDE_3WAY_VARIANCE প্রয়োজন।')}
            </span>
            <span>
              {L('GL control', 'লেজার নিয়ন্ত্রণ')}: 2110 / 2130 / 2140 / 1140 · {filteredEntries.length} {L('documents', 'দলিল')}
            </span>
          </div>
        </section>
      </main>

      {/* ZONE C — focused slide-over document workbench */}
      {drawerOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[75] flex justify-end bg-ink-950/55 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={L('Purchase document workbench', 'ক্রয় দলিল ওয়ার্কবেঞ্চ')}
              onClick={(event) => {
                if (event.target === event.currentTarget) closeWorkbench();
              }}
            >
              <aside className="flex h-full w-full max-w-[1240px] animate-rise flex-col border-l border-line bg-canvas shadow-panel" onClick={(event) => event.stopPropagation()}>
                <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-lift ring-1 ring-white/25">
                        {mode === 'create' ? <FileText size={18} /> : activeStage === 'SETTLED' ? <CheckCheck size={18} /> : <Truck size={18} />}
                      </span>
                      <div className="min-w-0">
                        <p className="lv-kicker">
                          {L(
                            mode === 'create'
                              ? 'Zone C · New purchase document'
                              : mode === 'review'
                                ? 'Zone C · Review & advance'
                                : mode === 'settle'
                                  ? 'Zone C · Pay supplier & withhold'
                                  : 'Zone C · Document file',
                            mode === 'create'
                              ? 'জোন সি · নতুন ক্রয় দলিল'
                              : mode === 'review'
                                ? 'জোন সি · পর্যালোচনা ও অগ্রগতি'
                                : mode === 'settle'
                                  ? 'জোন সি · সরবরাহকারী পরিশোধ ও কর্তন'
                                  : 'জোন সি · দলিল ফাইল',
                          )}
                        </p>
                        <h2 className="mt-0.5 truncate text-base font-semibold tracking-tight text-ink-900">
                          {mode === 'create' ? L('Purchase order / vendor bill composer', 'ক্রয় অর্ডার / সরবরাহকারী বিল কম্পোজার') : activeDoc?.doc_number}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {mode === 'create' ? (
                            <>
                              {DOC_KINDS.map((kind) => (
                                <button
                                  key={kind.id}
                                  type="button"
                                  className="lv-seg-item !px-2 !py-0.5"
                                  data-active={docType === kind.id}
                                  onClick={() => {
                                    setDocType(kind.id);
                                    if (kind.id === 'IMPORTED_SERVICE') {
                                      setCategory('REVERSE_CHARGE');
                                      setTdsNature('NONE');
                                      setWithholdVds(false);
                                    }
                                  }}
                                >
                                  {isBn ? kind.bn : kind.en}
                                </button>
                              ))}
                              {mode === 'create' ? (
                                <button
                                  type="button"
                                  onClick={fillSample}
                                  className="text-[9.5px] font-semibold text-vault-700 underline decoration-dotted underline-offset-2 transition hover:text-vault-900"
                                >
                                  {L('Fill sample data', 'নমুনা ডেটা')}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <StageBadge stage={activeStage} isBn={isBn} />
                              <StatusPill status={displayStatus(activeDoc as TaxAnnotatedDoc, journals)} />
                              <span className="lv-chip lv-chip-neutral !text-[9px]">
                                {L('Supplier', 'সরবরাহকারী')} {activeDoc?.party_name_en}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`hidden items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ring-1 ring-inset sm:inline-flex ${isAuditor ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-vault-50 text-vault-700 ring-vault-100'}`}>
                        <ShieldCheck size={9} /> {isAuditor ? L('Read-Only Auditor Mode', 'শুধুমাত্র পাঠযোগ্য অডিটর মোড') : currentUser.role}
                      </span>
                      <button type="button" onClick={closeWorkbench} className="rounded-xl border border-line bg-surface-2 p-1.5 text-ink-500 transition hover:text-ink-900" aria-label={L('Close workbench', 'ওয়ার্কবেঞ্চ বন্ধ')}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-line sm:grid-cols-4">
                    {PURCHASE_STEPS.map((step, index) => {
                      const current = index === stepCurrent;
                      const done = index < stepCurrent;
                      return (
                        <div key={step.key} className={`relative border-t-2 px-2.5 py-2 ${current ? 'border-vault-600 bg-vault-50/70' : done ? 'border-emerald-400 bg-emerald-50/40' : 'border-line bg-surface'}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-500 text-white' : current ? 'bg-vault-800 text-white' : 'bg-ink-100 text-ink-500'}`}>
                              {done ? <Check size={11} /> : index + 1}
                            </span>
                            <p className={`truncate text-[10px] font-semibold ${current ? 'text-vault-900' : 'text-ink-700'}`}>{isBn ? step.labelBn : step.labelEn}</p>
                          </div>
                          <p className="mt-1 truncate pl-6 text-[8.5px] leading-snug text-ink-400">{isBn ? step.hintBn : step.hintEn}</p>
                        </div>
                      );
                    })}
                  </div>
                </header>

                <div className="grid min-h-0 flex-1 overflow-y-auto xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
                  <div className="space-y-3 p-4 sm:p-5">
                    {mode === 'create' ? (
                      <>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <p className="lv-label">{L('Document type', 'দলিলের ধরন')}</p>
                            <div className="grid gap-1.5 sm:grid-cols-3">
                              {DOC_KINDS.map((kind) => (
                                <button
                                  key={kind.id}
                                  type="button"
                                  onClick={() => {
                                    setDocType(kind.id);
                                    if (kind.id === 'IMPORTED_SERVICE') {
                                      setCategory('REVERSE_CHARGE');
                                      setTdsNature('NONE');
                                      setWithholdVds(false);
                                    }
                                  }}
                                  className={`rounded-xl border px-2.5 py-2 text-left transition ${docType === kind.id ? 'border-vault-400 bg-vault-50' : 'border-line bg-surface hover:border-vault-200'}`}
                                >
                                  <span className="block text-[10.5px] font-semibold text-ink-800">{isBn ? kind.bn : kind.en}</span>
                                  <span className="mt-0.5 block text-[9px] text-ink-400">{isBn ? kind.hintBn : kind.hintEn}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="flex items-end gap-1.5">
                              <Field label={L('Supplier', 'সরবরাহকারী')} className="min-w-0 flex-1">
                                <select className="lv-input !py-1.5 text-[11px]" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                                  <option value="">{L('Select supplier…', 'সরবরাহকারী নির্বাচন…')}</option>
                                  {suppliers.map((party) => (
                                    <option key={party.id} value={party.id}>
                                      {party.name_en} · {L('TIN', 'টিআইএন')} {party.tin ?? L('missing', 'নেই')}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <button type="button" className="lv-btn lv-btn-secondary shrink-0 !px-2 !py-1.5 !text-[9.5px]" onClick={() => setMasterTab('parties')}>
                                <UserPlus size={11} /> {L('New Supplier', 'নতুন সরবরাহকারী')}
                              </button>
                            </div>
                          </div>
                          <Field label={L('Bill date', 'বিলের তারিখ')}>
                            <input type="date" className="lv-input !py-1.5 text-[11px]" value={docDate} onChange={(event) => setDocDate(event.target.value)} />
                          </Field>
                          <Field label={L('Payment method', 'পরিশোধ পদ্ধতি')}>
                            <select className="lv-input !py-1.5 text-[11px]" value={paymentChoice} onChange={(event) => setPaymentChoice(event.target.value)}>
                              {PAYMENT_RAILS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {isBn ? option.labelBn : option.labelEn} · {option.channel}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={L('TDS nature', 'টিডিএস প্রকৃতি')}>
                            <select
                              className="lv-input !py-1.5 text-[11px]"
                              value={isImported ? 'NONE' : tdsNature}
                              disabled={isImported}
                              onChange={(event) => setTdsNature(event.target.value as TdsNature)}
                            >
                              <option value="NONE">{L('No TDS (imported service)', 'কোনো টিডিএস নেই (আমদানি সেবা)')}</option>
                              {TDS_NATURES.map((nature) => (
                                <option key={nature.id} value={nature.id}>
                                  {isBn ? nature.bn : nature.en} · {(nature.bps / 100).toFixed(1)}%
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={L('VAT category', 'ভ্যাট শ্রেণি')}>
                            <select
                              className="lv-input !py-1.5 text-[11px]"
                              value={isImported ? 'REVERSE_CHARGE' : category}
                              disabled={isImported}
                              onChange={(event) => setCategory(event.target.value as TaxCategory)}
                            >
                              {(isImported ? (['REVERSE_CHARGE'] as TaxCategory[]) : VAT_CATEGORIES).map((option) => (
                                <option key={option} value={option}>
                                  {categoryLabel(option, isBn)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={L('Vehicle no.', 'যানবাহন নং')}>
                            <input className="lv-input !py-1.5 font-mono text-[10.5px]" value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} />
                          </Field>
                          <Field label={L('Destination', 'গন্তব্য')}>
                            <input className="lv-input !py-1.5 text-[11px]" value={destination} onChange={(event) => setDestination(event.target.value)} />
                          </Field>
                          <Field label={L('Narration', 'বিবরণ')} className="sm:col-span-2">
                            <input className="lv-input !py-1.5 text-[11px]" value={narration} onChange={(event) => setNarration(event.target.value)} />
                          </Field>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={missingTin}
                            onClick={() => setMissingTin((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition ${missingTin ? 'border-rose-300 bg-rose-50' : 'border-line bg-surface hover:border-vault-200'}`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-ink-800">{L('Missing e-TIN · +50% TDS', 'ই-টিআইএন নেই · +৫০% টিডিএস')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full ${missingTin ? 'bg-rose-500' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${missingTin ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[8.5px] text-ink-400">{L('3% → 4.5% or 10% → 15% automatically', '৩% → ৪.৫% বা ১০% → ১৫% স্বয়ংক্রিয়')}</span>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={withholdVds}
                            disabled={isImported}
                            onClick={() => setWithholdVds((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-60 ${withholdVds && !isImported ? 'border-violet-300 bg-violet-50' : 'border-line bg-surface'}`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-ink-800">{L('Withhold VDS', 'ভিডিএস কর্তন')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full ${withholdVds && !isImported ? 'bg-violet-500' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${withholdVds && !isImported ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[8.5px] text-ink-400">{L('Deposit through Mushak 6.6', 'মূসক ৬.৬-এ জমা')}</span>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={sd}
                            disabled={isImported}
                            onClick={() => setSd((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-60 ${sd && !isImported ? 'border-gold-300 bg-gold-50' : 'border-line bg-surface'}`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-ink-800">{L('Supplementary duty', 'সম্পূরক শুল্ক')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full ${sd && !isImported ? 'bg-gold-500' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${sd && !isImported ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[8.5px] text-ink-400">{L('Second Schedule 20%', 'দ্বিতীয় তফসিল ২০%')}</span>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={challanHeld}
                            disabled={!isImported}
                            onClick={() => setChallanHeld((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-60 ${challanHeld && isImported ? 'border-emerald-300 bg-emerald-50' : 'border-line bg-surface'}`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-ink-800">{L('RC challan held', 'আরসি চালান সংরক্ষিত')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full ${challanHeld && isImported ? 'bg-emerald-500' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${challanHeld && isImported ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[8.5px] text-ink-400">{L('Reverse-charge evidence', 'রিভার্স-চার্জ প্রমাণ')}</span>
                          </button>
                        </div>

                        {cashRisk ? (
                          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-700">
                              <ShieldAlert size={13} /> {L('Section 46 cash-payment input VAT disallowance', 'ধারা ৪৬ নগদ পরিশোধ ইনপুট ভ্যাট বাতিল')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] text-rose-700">
                              {L('Cash payment', 'নগদ পরিশোধ')} {money(decision.gross_poisha)} {L('exceeds the cap', 'সীমা ছাড়িয়েছে')} {money(cashLimit)}. {L('Unclaimable input VAT', 'অদাবিযোগ্য ইনপুট ভ্যাট')}:{' '}
                              <span className="font-money font-semibold">{money(decision.input_credit.disallowed_poisha)}</span> — {L('capitalised into cost.', 'ব্যয়ে মূলধনায়িত।')}
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : activeDoc ? (
                      <>
                        <div className="rounded-2xl border border-line bg-surface p-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">{L('Supplier', 'সরবরাহকারী')}</p>
                              <p className="mt-0.5 truncate text-[13px] font-semibold text-ink-900">{activeDoc.party_name_en}</p>
                              <p className={`font-mono text-[9.5px] ${activeDoc.party_tin ? 'text-ink-400' : 'font-semibold text-rose-600'}`}>
                                {L('BIN', 'বিআইএন')} {activeDoc.party_bin ?? '—'} · {L('e-TIN', 'ই-টিআইএন')} {activeDoc.party_tin ?? L('missing', 'নেই')}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">{L('Gross payable', 'মোট প্রদেয়')}</p>
                              <p className="font-money text-[15px] font-semibold text-ink-900">{money(activeDoc.gross_poisha)}</p>
                              <p className="text-[9px] text-ink-400">
                                {L('Net to supplier', 'সরবরাহকারীকে নিট')} {money(activeDoc.net_payable_poisha)}
                              </p>
                            </div>
                          </div>
                          <dl className="mt-2.5 grid gap-1.5 text-[10px] sm:grid-cols-2">
                            <div className="flex justify-between gap-2">
                              <dt className="text-ink-400">{L('Bill date', 'বিলের তারিখ')}</dt>
                              <dd className="text-ink-700">{formatDate(activeDoc.doc_date, locale)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-ink-400">{L('Payment', 'পরিশোধ')}</dt>
                              <dd className="text-ink-700">{activeDoc.payment_method} · {activeDoc.payment_channel ?? '—'}</dd>
                            </div>
                            <div className="flex justify-between gap-2 sm:col-span-2">
                              <dt className="text-ink-400">{L('Narration', 'বিবরণ')}</dt>
                              <dd className="max-w-[70%] truncate text-right text-ink-700">{activeDoc.narration_en}</dd>
                            </div>
                          </dl>
                        </div>

                        {threeWayRelevant ? (
                          <section className="rounded-2xl border border-line bg-surface">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                                <ClipboardCheck size={12} /> {L('3-Way Match verification', 'থ্রি-ওয়ে ম্যাচ যাচাই')}
                              </p>
                              <span className={`lv-chip !text-[9px] ${threeWayOk ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                                {threeWayOk ? L('PO = GRN = Bill', 'পিও = জিআরএন = বিল') : L('Variance', 'ভ্যারিয়েন্স')}
                              </span>
                            </div>
                            <div className="grid gap-2 p-3 sm:grid-cols-3">
                              {[
                                { id: 'PO', label: L('Purchase order', 'ক্রয় অর্ডার'), qty: activePoQty, hint: L('Agreed quantity', 'সম্মত পরিমাণ'), tone: 'border-ink-200 bg-ink-50' },
                                { id: 'GRN', label: L('Goods receipt', 'মাল গ্রহণ'), qty: activeGrnQty, hint: L('Actually received', 'প্রকৃতপক্ষে গৃহীত'), tone: 'border-indigo-200 bg-indigo-50' },
                                { id: 'BILL', label: L('Vendor bill', 'সরবরাহকারী বিল'), qty: billQty, hint: L('Billed quantity', 'বিলকৃত পরিমাণ'), tone: 'border-vault-200 bg-vault-50' },
                              ].map((cell) => (
                                <div key={cell.id} className={`rounded-xl border px-2.5 py-2 ${cell.tone}`}>
                                  <p className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-ink-500">{cell.id}</p>
                                  <p className="mt-0.5 font-money text-[15px] font-semibold text-ink-900">{cell.qty}</p>
                                  <p className="text-[8.5px] text-ink-400">{cell.hint}</p>
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-3 py-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset ${qtyMatch ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>
                                {qtyMatch ? <CheckCheck size={10} /> : <FileWarning size={10} />} {L('Bill qty ≤ GRN qty ≤ PO qty', 'বিল ≤ জিআরএন ≤ পিও')}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset ${priceMatch ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}>
                                {priceMatch ? <CheckCheck size={10} /> : <FileWarning size={10} />} {L('Bill price ≤ PO price', 'বিল মূল্য ≤ পিও মূল্য')}
                              </span>
                              {priceVariance > 0n ? (
                                <span className="text-[9px] font-semibold text-rose-600">
                                  {L('Price variance', 'মূল্য ভ্যারিয়েন্স')} {money(priceVariance)}
                                </span>
                              ) : null}
                            </div>
                            {mode === 'review' && activeStage === 'GRN_RECEIVED' && activeEntry ? (
                              <div className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-surface-2/40 px-3 py-2">
                                <label className="flex items-center gap-1.5 text-[9.5px] font-semibold text-ink-500">
                                  {L('Received qty (GRN)', 'গৃহীত পরিমাণ (জিআরএন)')}
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    className="lv-input w-20 !py-1 text-right font-money text-[11px]"
                                    value={activeEntry.grnQty}
                                    onChange={(event) => updateGrnQty(activeEntry, Number(event.target.value) || 0)}
                                  />
                                </label>
                                <span className="text-[9px] text-ink-400">
                                  {L('A GRN below the billed quantity blocks posting until a CONTROLLER overrides.', 'বিলকৃত পরিমাণের কম জিআরএন পোস্টিং আটকায়, কন্ট্রোলার ওভাররাইড না করা পর্যন্ত।')}
                                </span>
                              </div>
                            ) : null}
                          </section>
                        ) : null}

                        {activeStage === 'PURCHASE_ORDER' ? (
                          <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-700">
                              <FileText size={13} /> {L('PO commitment — no stock or GL impact yet', 'পিও অঙ্গীকার — এখনো স্টক বা জিএল প্রভাব নেই')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] leading-relaxed text-ink-500">
                              {L('Receiving the GRN carries the agreed quantity and price into the 3-way match. The bill posting applies the weighted-average receipt and the AP journal.', 'জিআরএন গ্রহণে সম্মত পরিমাণ ও মূল্য থ্রি-ওয়ে ম্যাচে যায়। বিল পোস্টিং ওয়েটেড-এভারেজ গ্রহণ ও এপি খতিয়ান প্রয়োগ করে।')}
                            </p>
                          </div>
                        ) : null}

                        {mode === 'settle' && activeDoc ? (
                          <div className="rounded-xl border border-line bg-surface">
                            <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                                <Split size={12} /> {L('Payment split preview', 'পরিশোধ বিভাজন প্রাকদর্শন')}
                              </p>
                              <span className="lv-chip lv-chip-neutral !text-[9px]">{activeBankCode}</span>
                            </div>
                            <dl className="space-y-1 px-3 py-2.5 text-[10.5px]">
                              <Metric label={`Dr 2110 ${L('Trade payable', 'বাণিজ্যিক প্রদেয়')}`} value={money(activeDoc.gross_poisha)} />
                              {activeDoc.vds_poisha > 0n ? <Metric label={`Cr 2130 ${L('VDS withheld', 'ভিডিএস কর্তিত')}`} value={money(activeDoc.vds_poisha)} tone="violet" /> : null}
                              {activeDoc.tds_poisha > 0n ? <Metric label={`Cr 2140 ${L('TDS withheld', 'টিডিএস কর্তিত')}`} value={money(activeDoc.tds_poisha)} tone="gold" /> : null}
                              <Metric label={`Cr ${activeBankCode} ${L('Paid to supplier', 'সরবরাহকারীকে প্রদত্ত')}`} value={money(activeDoc.net_payable_poisha)} tone="emerald" />
                            </dl>
                            {activePaymentJournal ? (
                              <p className="border-t border-line/70 px-3 py-2 text-[9.5px] text-emerald-700">
                                {L('Payment already posted', 'পরিশোধ ইতিমধ্যে পোস্টেড')} · {activePaymentJournal.journal_number}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {activeStage === 'SETTLED' && activeDoc ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-800">
                              <CircleCheck size={13} /> {L('Supplier paid, VDS/TDS withheld', 'সরবরাহকারী পরিশোধিত, ভিডিএস/টিডিএস কর্তিত')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] text-emerald-700">
                              {activePaymentJournal ? `${activePaymentJournal.journal_number} · ${formatDate(activePaymentJournal.posting_date, locale)}` : `${L('Settled', 'নিষ্পত্তি')} ${formatDate(activeDoc.doc_date, locale)}`}
                              {activeDoc.vds_poisha > 0n ? ` · ${L('VDS 6.6', 'ভিডিএস ৬.৬')} ${money(activeDoc.vds_poisha)}` : ''}
                              {activeDoc.tds_poisha > 0n ? ` · ${L('TDS', 'টিডিএস')} ${money(activeDoc.tds_poisha)}` : ''}
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    <PurchaseLineEditor
                      lines={activeLinesForEditor}
                      items={items}
                      money={money}
                      isBn={isBn}
                      readOnly={mode !== 'create'}
                      poUnitPrices={activeEntry?.poUnitPrices}
                      onChange={setLines}
                      onNewItem={mode === 'create' ? () => setMasterTab('items') : undefined}
                    />

                    {mode === 'create' ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[10px]">
                        <span className="flex items-center gap-1.5 text-ink-500">
                          <Sparkles size={12} /> {L('Projected weighted-average receipt', 'প্রাক্কলিত ওয়েটেড-এভারেজ গ্রহণ')}
                          {projectedStockItem ? (
                            <span className="font-money font-semibold text-ink-800">
                              {activeStockItem?.qty_on_hand ?? 0} → {projectedStockItem.qty_on_hand ?? 0}
                            </span>
                          ) : (
                            <span className="font-semibold text-ink-500">{L('No stock impact', 'স্টক প্রভাব নেই')}</span>
                          )}
                        </span>
                        <span className="text-ink-400">
                          {L('Treasury', 'কোষাগার')} <span className="font-money text-gold-700">{money(decision.treasury_payable_poisha)}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* RIGHT 35% — tax summary, s.46 check, TDS penalty, payment split */}
                  <aside className="space-y-3 border-t border-line bg-surface-2/25 p-4 sm:p-5 xl:border-l xl:border-t-0">
                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="lv-kicker flex items-center gap-1.5">
                          <Split size={12} /> {L('Compact tax summary', 'সংক্ষিপ্ত কর সারাংশ')}
                        </p>
                        <span className={`lv-chip ${decisionTone} !text-[9px]`}>{activeDecision.decision.replaceAll('_', ' ')}</span>
                      </div>
                      <dl className="mt-2.5 space-y-1.5 text-[10.5px]">
                        <Metric label={L('Taxable base', 'করযোগ্য ভিত্তি')} value={money(activeDecision.base_poisha)} />
                        <Metric label={L('Input VAT', 'ইনপুট ভ্যাট')} value={money(activeDecision.vat_poisha)} tone="indigo" />
                        {activeDecision.sd_poisha !== 0n ? <Metric label={L('Supplementary duty', 'সম্পূরক শুল্ক')} value={money(activeDecision.sd_poisha)} tone="gold" /> : null}
                        <Metric label={L('Gross bill', 'মোট বিল')} value={money(activeDecision.gross_poisha)} />
                        <Metric label={L('VDS withheld', 'ভিডিএস কর্তিত')} value={money(activeDecision.vds_poisha)} tone="violet" />
                        <Metric label={L('TDS withheld', 'টিডিএস কর্তিত')} value={money(activeDecision.tds_poisha)} tone="gold" />
                        <Metric label={L('Paid to supplier', 'সরবরাহকারীকে প্রদত্ত')} value={money(activeDecision.net_payable_poisha)} tone="emerald" />
                        <Metric label={L('Treasury payable', 'কোষাগারে প্রদেয়')} value={money(activeDecision.treasury_payable_poisha)} />
                      </dl>
                      <p className="lv-hint mt-2.5 text-[9.5px]">
                        {L('VAT rate', 'ভ্যাট হার')} {formatPercentBps(activeDecision.vat_bps, 'latin')} · {L('VDS', 'ভিডিএস')}{' '}
                        {formatPercentBps(activeDecision.vds_bps, 'latin')} · {L('TDS', 'টিডিএস')} {formatPercentBps(activeDecision.tds_bps, 'latin')} · {activeDecision.rule_pack_version}
                      </p>
                    </section>

                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="lv-kicker flex items-center gap-1.5">
                          <ShieldCheck size={12} /> {L('s.46 input VAT rebate check', 'ধারা ৪৬ ইনপুট ভ্যাট রিবেট যাচাই')}
                        </p>
                        <span className={`lv-chip !text-[9px] ${inputCredit.eligible ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                          {inputCredit.eligible ? L('Eligible', 'যোগ্য') : L('Disallowed', 'বাতিল')}
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-vault-50 px-2 py-1.5">
                          <dt className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-vault-700">{L('Claimable', 'দাবিযোগ্য')}</dt>
                          <dd className="font-money text-[11px] font-semibold text-vault-900">{money(inputCredit.claimable_poisha)}</dd>
                        </div>
                        <div className="rounded-lg bg-rose-50 px-2 py-1.5">
                          <dt className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-rose-700">{L('Disallowed', 'বাতিল')}</dt>
                          <dd className="font-money text-[11px] font-semibold text-rose-800">{money(inputCredit.disallowed_poisha)}</dd>
                        </div>
                      </dl>
                      <ul className="mt-2 space-y-1">
                        {s46Checks.map((check) => (
                          <li key={check.id} className="flex items-start justify-between gap-2 text-[9.5px]">
                            <span className="flex min-w-0 items-start gap-1.5">
                              {check.ok ? <CircleCheck size={11} className="mt-0.5 shrink-0 text-emerald-500" /> : <CircleAlert size={11} className="mt-0.5 shrink-0 text-rose-500" />}
                              <span className={check.ok ? 'text-ink-600' : 'font-semibold text-rose-700'}>{check.label}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[8.5px] text-ink-400">{check.detail}</span>
                          </li>
                        ))}
                      </ul>
                      {inputCredit.reason_labels_en.length > 0 ? (
                        <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[8.5px] leading-relaxed text-rose-700">
                          {isBn ? inputCredit.reason_labels_bn.join(' · ') : inputCredit.reason_labels_en.join(' · ')}
                        </p>
                      ) : null}
                    </section>

                    {penaltyActive ? (
                      <section className={`rounded-2xl border p-3.5 ${penaltyDelta > 0n ? 'border-rose-200 bg-rose-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`lv-kicker flex items-center gap-1.5 ${penaltyDelta > 0n ? 'text-rose-700' : 'text-amber-700'}`}>
                            <FileWarning size={12} /> {L('Missing e-TIN · +50% TDS', 'ই-টিআইএন নেই · +৫০% টিডিএস')}
                          </p>
                          <span className="lv-chip lv-chip-rose !text-[9px]">{L('Penalty', 'জরিমানা')}</span>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-600">
                          {L('Without a valid 12-digit e-TIN the TDS rate is upscaled by 50%.', 'বৈধ ১২-সংখ্যার ই-টিআইএন ছাড়া টিডিএস হার ৫০% বৃদ্ধি পায়।')}
                        </p>
                        <div className="mt-2 flex items-baseline gap-2 font-money text-[11px]">
                          <span className="text-ink-400 line-through">{formatPercentBps(activeTdsWithoutPenalty.tds_bps, 'latin')}</span>
                          <ArrowRight size={11} className="text-ink-300" />
                          <span className="font-semibold text-rose-700">{formatPercentBps(activeDecision.tds_bps, 'latin')}</span>
                          <span className="ml-auto font-semibold text-ink-900">{money(activeDecision.tds_poisha)}</span>
                        </div>
                        {penaltyDelta > 0n ? (
                          <p className="mt-1 text-[9px] font-semibold text-rose-700">
                            {L('Extra withholding', 'অতিরিক্ত কর্তন')} +{money(penaltyDelta)}
                          </p>
                        ) : (
                          <p className="mt-1 text-[9px] text-amber-700">{L('Supplier master has no e-TIN — obtain it before payment to release the penalty.', 'সরবরাহকারী মাস্টারে ই-টিআইএন নেই — জরিমানা এড়াতে পরিশোধের আগে সংগ্রহ করুন।')}</p>
                        )}
                      </section>
                    ) : null}

                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <p className="lv-kicker flex items-center gap-1.5">
                        <HandCoins size={12} /> {L('Payment split at settlement', 'নিষ্পত্তিতে পরিশোধ বিভাজন')}
                      </p>
                      <dl className="mt-2 space-y-1.5 text-[10px]">
                        <Metric label={`Dr 2110 ${L('Payable', 'প্রদেয়')}`} value={money(activeDecision.gross_poisha)} />
                        {activeDecision.vds_poisha > 0n ? <Metric label={`Cr 2130 ${L('VDS', 'ভিডিএস')}`} value={money(activeDecision.vds_poisha)} tone="violet" /> : null}
                        {activeDecision.tds_poisha > 0n ? <Metric label={`Cr 2140 ${L('TDS', 'টিডিএস')}`} value={money(activeDecision.tds_poisha)} tone="gold" /> : null}
                        <Metric label={`Cr ${activeBankCode} ${L('Supplier', 'সরবরাহকারী')}`} value={money(activeDecision.net_payable_poisha)} tone="emerald" />
                      </dl>
                      <p className="lv-hint mt-2 text-[9px]">
                        {L('Credits to 2130/2140 become pending Mushak 6.6 and TDS treasury challans in Workspace 04.', '২১৩০/২১৪০ ক্রেডিট ওয়ার্কস্পেস ০৪-এ অপেক্ষমাণ মূসক ৬.৬ ও টিডিএস ট্রেজারি চালান হয়।')}
                      </p>
                    </section>

                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <p className="lv-kicker flex items-center gap-1.5">
                        <Warehouse size={12} /> {L('Weighted-average receipt', 'ওয়েটেড-এভারেজ গ্রহণ')}
                      </p>
                      <dl className="mt-2 space-y-1.5 text-[10px]">
                        <Metric
                          label={L('On hand', 'স্টকে')}
                          value={`${activeStockItem?.qty_on_hand ?? 0} → ${projectedStockItem?.qty_on_hand ?? activeStockItem?.qty_on_hand ?? 0}`}
                        />
                        <Metric
                          label={L('Unit cost', 'একক ব্যয়')}
                          value={`${money(activeStockItem?.unit_cost_poisha ?? 0n, { symbol: false })} → ${money(projectedStockItem?.unit_cost_poisha ?? activeStockItem?.unit_cost_poisha ?? 0n, { symbol: false })}`}
                          tone="indigo"
                        />
                        <Metric label={L('Received qty', 'গৃহীত পরিমাণ')} value={String(activeReceipt.total_received_qty)} />
                      </dl>
                      <p className="lv-hint mt-2 text-[9px]">
                        {L('Disallowed s.46 VAT is capitalised into the per-unit cost before the weighted average is struck.', 'বাতিল ধারা ৪৬ ভ্যাট ওয়েটেড এভারেজের আগে একক ব্যয়ে মূলধনায়িত হয়।')}
                      </p>
                    </section>

                    <details className="group rounded-2xl border border-line bg-surface p-3.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[10.5px] font-semibold text-ink-700">
                        <span className="flex items-center gap-1.5">
                          <FileText size={12} /> {L('Tax rules & journal preview', 'কর নিয়ম ও খতিয়ান প্রাকদর্শন')}
                        </span>
                        <ChevronRight size={13} className="text-ink-400 transition group-open:rotate-90" />
                      </summary>
                      <div className="mt-2.5 space-y-2">
                        <ul className="space-y-1 text-[9.5px] leading-relaxed text-ink-500">
                          {activeDecision.explanations_en.slice(0, 3).map((explanation) => (
                            <li key={explanation} className="flex gap-1.5">
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-vault-400" />
                              <span>{isBn ? activeDecision.explanations_bn[activeDecision.explanations_en.indexOf(explanation)] ?? explanation : explanation}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="space-y-2">
                          {journalPreview.groups.map((group) => (
                            <div key={group.id}>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-400">{isBn ? group.title_bn : group.title_en}</p>
                              <div className="mt-1 space-y-0.5">
                                {group.lines.map((line) => (
                                  <div key={`${group.id}-${line.line_no}`} className="flex items-baseline justify-between gap-2 rounded bg-surface-2 px-1.5 py-1 font-mono text-[8.5px]">
                                    <span className="truncate text-ink-600">
                                      {line.account_code} {line.account_name_en}
                                    </span>
                                    <span className={`shrink-0 ${line.debit_poisha > 0n ? 'text-emerald-700' : 'text-rose-600'}`}>
                                      {line.debit_poisha > 0n ? `Dr ${money(line.debit_poisha, { symbol: false })}` : `Cr ${money(line.credit_poisha, { symbol: false })}`}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>

                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <p className="lv-kicker flex items-center gap-1.5">
                        <ShieldCheck size={12} /> {L('Controls', 'নিয়ন্ত্রণ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className={`lv-chip !text-[9px] ${canDraft ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>CREATE_COMMERCIAL_DRAFT</span>
                        <span className={`lv-chip !text-[9px] ${canStock ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>DISPATCH_OR_RECEIVE</span>
                        <span className={`lv-chip !text-[9px] ${canPost ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>POST_TO_GL</span>
                        <span className={`lv-chip !text-[9px] ${canOverride ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>OVERRIDE_3WAY</span>
                      </div>
                    </section>
                  </aside>
                </div>

                <footer className="shrink-0 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      {feedback ? (
                        <div className={`flex items-start gap-1.5 text-[10px] font-semibold ${feedback.tone === 'success' ? 'text-emerald-700' : feedback.tone === 'error' ? 'text-rose-700' : 'text-vault-700'}`}>
                          {feedback.tone === 'success' ? <CircleCheck size={12} className="mt-0.5 shrink-0" /> : feedback.tone === 'error' ? <ShieldAlert size={12} className="mt-0.5 shrink-0" /> : <Sparkles size={12} className="mt-0.5 shrink-0" />}
                          <span className="truncate">{feedback.text}</span>
                        </div>
                      ) : (
                        <p className="text-[9.5px] text-ink-400">
                          {L('Signed in as', 'সাইন ইন')} {currentUser.full_name} · {currentUser.role}
                          {isAuditor ? ` · ${L('Read-Only Auditor Mode', 'শুধুমাত্র পাঠযোগ্য অডিটর মোড')}` : ''}
                        </p>
                      )}
                      <p className="text-[9.5px] text-ink-400">
                        {L(
                          'Role-checked footer — GRN needs DISPATCH_OR_RECEIVE_STOCK; bill and payment need POST_TO_GL; variance overrides need OVERRIDE_3WAY_VARIANCE.',
                          'ভূমিকা-যাচাইকৃত ফুটার — জিআরএনে DISPATCH_OR_RECEIVE_STOCK; বিল ও পরিশোধে POST_TO_GL; ভ্যারিয়েন্স ওভাররাইডে OVERRIDE_3WAY_VARIANCE।',
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button type="button" className="lv-btn lv-btn-ghost !py-1.5 !text-[10.5px]" onClick={closeWorkbench}>
                        {L('Close', 'বন্ধ')}
                      </button>
                      {mode === 'create' ? (
                        <>
                          <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[10.5px]" onClick={savePurchaseOrder} disabled={!canDraft} title={isAuditor ? 'Read-Only Auditor Mode' : undefined}>
                            <FileText size={13} /> {L('Save as Purchase Order', 'ক্রয় অর্ডার হিসেবে সংরক্ষণ')}
                          </button>
                          <button
                            type="button"
                            className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                            onClick={() => postBill(false)}
                            disabled={!canPost}
                            title={isAuditor ? 'Read-Only Auditor Mode' : !canPost ? 'POST_TO_GL required' : undefined}
                          >
                            <Stamp size={13} /> {activeIsImported ? L('Post Reverse-Charge Bill', 'রিভার্স-চার্জ বিল পোস্ট') : L('Post Vendor Bill to AP', 'এপি-তে সরবরাহকারী বিল পোস্ট')}
                          </button>
                        </>
                      ) : null}
                      {mode === 'review' && activeEntry ? (
                        <button
                          type="button"
                          className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                          onClick={() => advanceEntry(activeEntry)}
                          disabled={activeStage === 'PURCHASE_ORDER' ? !canStock : !canPost || (!entryMatchOk(activeEntry) && !canOverride)}
                          title={isAuditor ? 'Read-Only Auditor Mode' : !canPost && activeStage !== 'PURCHASE_ORDER' ? 'POST_TO_GL required' : undefined}
                        >
                          <ArrowRight size={13} />{' '}
                          {activeStage === 'PURCHASE_ORDER'
                            ? isBn
                              ? STAGE_META.PURCHASE_ORDER.nextBn
                              : STAGE_META.PURCHASE_ORDER.nextEn
                            : !entryMatchOk(activeEntry) && canOverride
                              ? L('Override & Post Bill', 'ওভাররাইড ও বিল পোস্ট')
                              : isBn
                                ? STAGE_META.GRN_RECEIVED.nextBn
                                : STAGE_META.GRN_RECEIVED.nextEn}
                        </button>
                      ) : null}
                      {mode === 'settle' && activeDoc ? (
                        <>
                          <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[10.5px]" onClick={() => openLens(activeDoc)}>
                            <Eye size={13} /> {L('Ledger Lens', 'লেজার লেন্স')}
                          </button>
                          <button
                            type="button"
                            className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                            onClick={() => paySupplier(activeDoc)}
                            disabled={!canPost || Boolean(activePaymentJournal)}
                            title={isAuditor ? 'Read-Only Auditor Mode' : !canPost ? 'POST_TO_GL required' : undefined}
                          >
                            <HandCoins size={13} /> {L('Pay Supplier & Withhold VDS/TDS', 'সরবরাহকারী পরিশোধ ও ভিডিএস/টিডিএস কর্তন')}
                          </button>
                        </>
                      ) : null}
                      {mode === 'view' && activeDoc ? (
                        <>
                          <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[10.5px]" onClick={() => setPrintReturnOpen(true)}>
                            <Printer size={13} /> {L('Print A4 9.1', 'এ৪ ৯.১ প্রিন্ট')}
                          </button>
                          {activeDoc.status !== 'DRAFT' && canReverse ? (
                            <button type="button" className="lv-btn lv-btn-ghost !py-1.5 !text-[10.5px] text-rose-600" onClick={() => openLens(activeDoc, 'REVERSAL')}>
                              <RotateCcw size={13} /> {L('Reverse', 'রিভার্স')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                            onClick={() =>
                              setFeedback({
                                tone: 'info',
                                text: L(
                                  `VDS ${money(activeDoc.vds_poisha)} and TDS ${money(activeDoc.tds_poisha)} are queued on 2130/2140 for the Workspace 04 treasury challan.`,
                                  `ভিডিএস ${money(activeDoc.vds_poisha)} ও টিডিএস ${money(activeDoc.tds_poisha)} ওয়ার্কস্পেস ০৪ ট্রেজারি চালানের জন্য ২১৩০/২১৪০-এ অপেক্ষমাণ।`,
                                ),
                              })
                            }
                          >
                            <Landmark size={13} /> {L('Go to Treasury Challan Queue', 'ট্রেজারি চালান সারি')}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </footer>
              </aside>
            </div>,
            document.body,
          )
        : null}

      <MasterDataModal open={masterTab !== null} onClose={() => setMasterTab(null)} initialTab={masterTab ?? 'parties'} />

      <LedgerLensModal
        journal={lensJournal}
        onClose={() => {
          setLensJournalId(null);
          setLensContext(undefined);
        }}
        open={Boolean(lensJournal)}
        initialTab={lensTab}
        contextLabel={lensContext}
      />
      <StatutoryPrintModal open={printReturnOpen} onClose={() => setPrintReturnOpen(false)} mode="MUSHAK_9_1" periodCode={PERIOD_CODE} />
    </>
  );
}
