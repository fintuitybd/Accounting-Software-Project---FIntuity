// LedgerVault — W02 Sales & Mushak 6.3.
//
// Zone A (header + O2C pipeline tabs + search/filter) over Zone B (clean commercial master table)
// and Zone C (a focused slide-over document workbench with a four-stage stepper). The workbench is
// the only place a document is composed or advanced, so the register never stacks an inline form.
//
// The O2C lifecycle follows blueprint §4.1: quotation → sales order → delivery challan →
// INVOICED_POSTED (gap-free Mushak 6.3 + revenue/COGS) → SETTLED (customer receipt + VDS 6.6).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Hash,
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
  UserCheck,
  UserPlus,
  Wallet,
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
  calculatePerpetualCogs,
  evaluateTaxDecision,
  previewTaxJournal,
} from '../core/tax-engine/engine';
import {
  buildCommercialDoc,
  documentTaxInput,
  type TaxAnnotatedDoc,
} from '../core/ledger/ledgerEngine';
import type { SeedItem } from '../core/ledger/seedData';
import { useVault } from '../context/VaultContext';
import type {
  JournalEntry,
  PaymentMethod,
  PermissionAction,
  TaxCategory,
  TaxEvaluationInput,
} from '../core/types';

const TODAY = '2026-11-01';
const PERIOD_END = '2026-10-31';
const PERIOD_CODE = '2026-10';
const RECEIPT_PREFIX = 'Customer receipt of ';

// ---------------------------------------------------------------------------------------------
// O2C state machine (blueprint §4.1)
// ---------------------------------------------------------------------------------------------

type SalesStage = 'QUOTATION' | 'SALES_ORDER' | 'DELIVERY_CHALLAN' | 'INVOICED_POSTED' | 'SETTLED';
type StageTab = 'ALL' | SalesStage;
type LifecycleFilter = 'ALL' | 'POSTED' | 'DRAFT' | 'REVERSED';
type DateWindow = 'ALL' | '7' | '30' | '90';
type WorkbenchState = { kind: 'create' } | { kind: 'doc'; docId: string };
type WorkbenchMode = 'create' | 'review' | 'settle' | 'view';

interface PipelineEntry {
  doc: TaxAnnotatedDoc;
  stage: SalesStage;
  draft: boolean;
}

interface StageMeta {
  labelEn: string;
  labelBn: string;
  nextEn: string;
  nextBn: string;
  next: SalesStage | null;
  permission: PermissionAction;
  tone: string;
}

const STAGE_META: Record<SalesStage, StageMeta> = {
  QUOTATION: {
    labelEn: 'Quotation',
    labelBn: 'কোটেশন',
    nextEn: 'Confirm SO',
    nextBn: 'এসও নিশ্চিত করুন',
    next: 'SALES_ORDER',
    permission: 'CREATE_COMMERCIAL_DRAFT',
    tone: 'bg-ink-100 text-ink-600 ring-ink-200',
  },
  SALES_ORDER: {
    labelEn: 'Sales order',
    labelBn: 'বিক্রয় অর্ডার',
    nextEn: 'Dispatch Challan',
    nextBn: 'চালান প্রেরণ',
    next: 'DELIVERY_CHALLAN',
    permission: 'CREATE_COMMERCIAL_DRAFT',
    tone: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  DELIVERY_CHALLAN: {
    labelEn: 'Delivery challan',
    labelBn: 'ডেলিভারি চালান',
    nextEn: 'Issue Mushak 6.3 Invoice',
    nextBn: 'মূসক ৬.৩ চালান ইস্যু',
    next: 'INVOICED_POSTED',
    permission: 'POST_TO_GL',
    tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  },
  INVOICED_POSTED: {
    labelEn: 'Mushak 6.3 posted',
    labelBn: 'মূসক ৬.৩ পোস্টেড',
    nextEn: 'Record Customer Receipt',
    nextBn: 'গ্রাহক প্রাপ্তি রেকর্ড',
    next: 'SETTLED',
    permission: 'POST_TO_GL',
    tone: 'bg-vault-100 text-vault-800 ring-vault-200',
  },
  SETTLED: {
    labelEn: 'Settled',
    labelBn: 'নিষ্পত্তিকৃত',
    nextEn: 'View Receipt & Ledger Lens',
    nextBn: 'প্রাপ্তি ও লেজার লেন্স দেখুন',
    next: null,
    permission: 'CREATE_COMMERCIAL_DRAFT',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
};

const SALES_TABS: Array<{ id: StageTab; labelEn: string; labelBn: string }> = [
  { id: 'ALL', labelEn: 'All', labelBn: 'সব' },
  { id: 'QUOTATION', labelEn: '1. Quotations', labelBn: '১. কোটেশন' },
  { id: 'SALES_ORDER', labelEn: '2. Sales Orders', labelBn: '২. বিক্রয় অর্ডার' },
  { id: 'DELIVERY_CHALLAN', labelEn: '3. Delivery Challans', labelBn: '৩. ডেলিভারি চালান' },
  { id: 'INVOICED_POSTED', labelEn: '4. Mushak 6.3 Invoices', labelBn: '৪. মূসক ৬.৩ চালান' },
  { id: 'SETTLED', labelEn: '5. Settled', labelBn: '৫. নিষ্পত্তি' },
];

const SALES_STEPS: Array<{
  key: string;
  labelEn: string;
  labelBn: string;
  hintEn: string;
  hintBn: string;
  stages: SalesStage[];
}> = [
  {
    key: 'order',
    labelEn: 'Quote / Order',
    labelBn: 'কোট / অর্ডার',
    hintEn: 'Quotation confirmed as a sales order',
    hintBn: 'কোটেশন বিক্রয় অর্ডারে নিশ্চিত',
    stages: ['QUOTATION', 'SALES_ORDER'],
  },
  {
    key: 'delivery',
    labelEn: 'Delivery',
    labelBn: 'ডেলিভারি',
    hintEn: 'Challan, vehicle & stock check',
    hintBn: 'চালান, যানবাহন ও স্টক যাচাই',
    stages: ['DELIVERY_CHALLAN'],
  },
  {
    key: 'invoice',
    labelEn: 'Mushak 6.3',
    labelBn: 'মূসক ৬.৩',
    hintEn: 'Gap-free serial + perpetual COGS',
    hintBn: 'ফাঁকহীন সিরিয়াল + সিওজিএস',
    stages: ['INVOICED_POSTED'],
  },
  {
    key: 'paid',
    labelEn: 'Settled',
    labelBn: 'নিষ্পত্তি',
    hintEn: 'Customer receipt + VDS 6.6',
    hintBn: 'গ্রাহক প্রাপ্তি + ভিডিএস ৬.৬',
    stages: ['SETTLED'],
  },
];

const LIFECYCLE_FILTERS: Array<{ id: LifecycleFilter; labelEn: string; labelBn: string }> = [
  { id: 'ALL', labelEn: 'All statuses', labelBn: 'সব অবস্থা' },
  { id: 'POSTED', labelEn: 'Posted', labelBn: 'পোস্টেড' },
  { id: 'DRAFT', labelEn: 'Draft', labelBn: 'খসড়া' },
  { id: 'REVERSED', labelEn: 'Reversed', labelBn: 'রিভার্সড' },
];

function displayStatus(doc: TaxAnnotatedDoc, journals: JournalEntry[]): 'POSTED' | 'DRAFT' | 'REVERSED' {
  if (doc.status === 'REVERSED') return 'REVERSED';
  const journal = journals.find((entry) => entry.id === (doc.document_journal_id ?? doc.journal_id));
  if (journal?.status === 'REVERSED') return 'REVERSED';
  if (doc.status === 'DRAFT') return 'DRAFT';
  return 'POSTED';
}

/** The receipt journal we post from Zone C is the durable evidence that stage 5 was reached. */
function receiptJournalFor(doc: TaxAnnotatedDoc, journals: JournalEntry[]): JournalEntry | undefined {
  return journals.find(
    (entry) =>
      entry.source_module === 'BANK_MFS' &&
      entry.narration_en.startsWith(RECEIPT_PREFIX) &&
      entry.narration_en.includes(doc.doc_number),
  );
}

function stageOfPersistedDoc(doc: TaxAnnotatedDoc, journals: JournalEntry[]): SalesStage {
  if (doc.status === 'SETTLED' || receiptJournalFor(doc, journals)) return 'SETTLED';
  const raw = doc.workflow_stage;
  if (
    raw === 'QUOTATION' ||
    raw === 'SALES_ORDER' ||
    raw === 'DELIVERY_CHALLAN' ||
    raw === 'INVOICED_POSTED'
  ) {
    return raw;
  }
  return 'INVOICED_POSTED';
}

function stageIndex(stage: SalesStage): number {
  const index = SALES_STEPS.findIndex((step) => step.stages.includes(stage));
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

function draftNumberFor(stage: SalesStage, docDate: string, sequence: number): string {
  const prefix = stage === 'QUOTATION' ? 'QTN' : stage === 'SALES_ORDER' ? 'SO' : 'DC';
  return `${prefix}-${docDate.slice(0, 7)}-${String(sequence).padStart(4, '0')}`;
}

function renumbered(doc: TaxAnnotatedDoc, prefix: string): string {
  const suffix = doc.doc_number.split('-').slice(-1)[0];
  return `${prefix}-${doc.doc_date.slice(0, 7)}-${suffix}`;
}

// ---------------------------------------------------------------------------------------------
// Small presentational primitives
// ---------------------------------------------------------------------------------------------

function StageBadge({ stage, isBn }: { stage: SalesStage; isBn: boolean }) {
  const meta = STAGE_META[stage];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${meta.tone}`}
    >
      {isBn ? meta.labelBn : meta.labelEn}
    </span>
  );
}

function StageProgress({ stage }: { stage: SalesStage }) {
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

function StockBadge({
  item,
  quantity,
  isBn,
}: {
  item: SeedItem | undefined;
  quantity: number;
  isBn: boolean;
}) {
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
        <Warehouse size={9} /> {isBn ? `${onHand} আছে · ঘাটতি` : `${onHand} on hand · short`}
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
      <Sparkles size={9} /> {isBn ? 'একক ব্যয়' : 'Unit cost'} {money(cost, { symbol: false })}
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

function Metric({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'emerald' | 'indigo' | 'violet' | 'gold' | 'rose' }) {
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

// ---------------------------------------------------------------------------------------------
// Zone C line editor (stock and unit-cost badges live on every line)
// ---------------------------------------------------------------------------------------------

function SalesLineEditor({
  lines,
  items,
  money,
  isBn,
  readOnly,
  onChange,
  onNewItem,
}: {
  lines: DraftLine[];
  items: SeedItem[];
  money: MoneyFn;
  isBn: boolean;
  readOnly: boolean;
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
  const totalCogs = calculatePerpetualCogs(lines, items);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            {isBn ? 'লাইন আইটেম' : 'Line items'}
          </p>
          <p className="text-[9.5px] text-ink-400">
            {isBn
              ? 'প্রতিটি লাইনে স্টক ও ওয়েটেড-এভারেজ একক ব্যয় দেখানো হচ্ছে।'
              : 'Every line carries its live stock position and weighted-average unit cost.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onNewItem ? (
            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 !text-[10px]" onClick={onNewItem}>
              <PackagePlus size={12} /> {isBn ? 'নতুন আইটেম' : '+ New Item'}
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              className="lv-btn lv-btn-secondary !px-2.5 !py-1 !text-[10.5px]"
              onClick={() => onChange([...lines, newDraftLine()])}
            >
              <Plus size={12} /> {isBn ? 'লাইন' : 'Add line'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="lv-table min-w-[860px]">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="min-w-[230px]">{isBn ? 'আইটেম / বিবরণ' : 'Item / description'}</th>
              <th className="w-16 text-right">{isBn ? 'পরিমাণ' : 'Qty'}</th>
              <th className="w-28 text-right">{isBn ? 'একক মূল্য' : 'Unit price'}</th>
              <th className="w-28 text-right">{isBn ? 'মূল্য' : 'Value'}</th>
              <th className="w-32">{isBn ? 'স্টক · ব্যয়' : 'Stock · cost'}</th>
              <th className="w-32">{isBn ? 'ভ্যাট শ্রেণি' : 'VAT tier'}</th>
              {!readOnly ? <th className="w-8" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = items.find((entry) => entry.sku === line.sku);
              const value = lineValuePoisha(line);
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
                          onChange={(event) =>
                            update(line.id, isBn ? { description_bn: event.target.value } : { description_en: event.target.value })
                          }
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
              <td className="px-3 py-2 text-right font-money text-[11px] font-semibold text-ink-900">
                {money(totalBase, { symbol: false })}
              </td>
              <td colSpan={readOnly ? 2 : 3} className="px-3 py-2 text-[9.5px] text-ink-400">
                {isBn ? 'সিওজিএস' : 'COGS'} {money(totalCogs)}
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

export default function W02_SalesMushak63() {
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
    settleCommercialDocument,
    nextMushakSerial,
  } = useVault();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const customers = useMemo(
    () => parties.filter((party) => party.type === 'CUSTOMER' || party.type === 'BOTH'),
    [parties],
  );

  const canDraft = hasPermission('CREATE_COMMERCIAL_DRAFT');
  const canPost = hasPermission('POST_TO_GL');
  const canReverse = hasPermission('REVERSE_POSTED_JOURNAL');
  const isAuditor = currentUser.role === 'AUDITOR';

  const [partyId, setPartyId] = useState(() => customers[0]?.id ?? '');
  const [binUnitId, setBinUnitId] = useState(tenant.bin_units[0]?.id ?? '');
  const [docDate, setDocDate] = useState(TODAY);
  const [paymentChoice, setPaymentChoice] = useState('BANK');
  const [vehicleNo, setVehicleNo] = useState('DHAKA METRO-GA 13-4521');
  const [destination, setDestination] = useState('Tejgaon I/A, Dhaka 1208');
  const [narration, setNarration] = useState('Corporate supply of portable laptop computers');
  const [isCreditNote, setIsCreditNote] = useState(false);
  const [corporateVds, setCorporateVds] = useState(false);
  const [sd, setSd] = useState(false);
  const [category, setCategory] = useState<TaxCategory>('STANDARD_15');
  const [lines, setLines] = useState<DraftLine[]>(() => {
    const first = items.find((item) => item.sku === 'HS-8471.30') ?? items[0];
    if (!first) return [newDraftLine()];
    return [{ ...lineFromItem(first), quantity: 2 }];
  });

  const [draftSeq, setDraftSeq] = useState(1);
  const [drafts, setDrafts] = useState<PipelineEntry[]>([]);
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
  const [printDoc, setPrintDoc] = useState<TaxAnnotatedDoc | null>(null);

  const buyer = customers.find((party) => party.id === partyId) ?? customers[0] ?? null;
  const rail = paymentRail(paymentChoice);
  const base = lines.reduce((total, line) => total + lineValuePoisha(line), 0n);
  const nextSerial = nextMushakSerial(
    binUnitId || tenant.bin_units[0]?.id || '',
    docDate.slice(0, 4),
  );

  const advisorInput = useMemo<TaxEvaluationInput>(
    () => ({
      direction: 'SALE',
      base_poisha: base,
      tax_category: category,
      party_name: buyer?.name_en ?? 'Prospective buyer',
      party_bin: buyer?.bin,
      party_tin: buyer?.tin,
      is_withholding_entity: corporateVds,
      vds_applicable: corporateVds,
      tds_nature: 'NONE',
      payment_method: rail.method,
      has_valid_mushak63: true,
      is_reverse_charge: false,
      sd_applicable: sd,
      is_credit_note: isCreditNote,
      period_end_date: PERIOD_END,
    }),
    [base, category, buyer, corporateVds, rail.method, sd, isCreditNote],
  );
  const decision = useMemo(() => evaluateTaxDecision(advisorInput), [advisorInput]);

  const salesDocs = useMemo(
    () =>
      commercialDocs
        .filter((doc) => doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE')
        .slice()
        .sort((left, right) => right.doc_date.localeCompare(left.doc_date) || right.created_at.localeCompare(left.created_at)),
    [commercialDocs],
  );

  const persistedEntries = useMemo<PipelineEntry[]>(
    () => salesDocs.map((doc) => ({ doc, stage: stageOfPersistedDoc(doc, journals), draft: false })),
    [salesDocs, journals],
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
        (entry.doc.party_bin ?? '').toLowerCase().includes(needle) ||
        entry.doc.narration_en.toLowerCase().includes(needle)
      );
    });
  }, [entries, journals, query, stageTab, lifecycleFilter, dateWindow]);

  const periodDocs = salesDocs.filter((doc) => doc.doc_date.startsWith(PERIOD_CODE));
  const periodGross = periodDocs.reduce((total, doc) => total + doc.gross_poisha, 0n);
  const periodVat = periodDocs.reduce((total, doc) => total + doc.vat_poisha, 0n);
  const openReceivable = entries
    .filter((entry) => entry.stage === 'INVOICED_POSTED')
    .reduce((total, entry) => total + entry.doc.net_payable_poisha, 0n);
  const filteredGross = filteredEntries.reduce((total, entry) => total + entry.doc.gross_poisha, 0n);

  const activeEntry = workbench?.kind === 'doc' ? entries.find((entry) => entry.doc.id === workbench.docId) ?? null : null;
  const activeDoc = activeEntry?.doc ?? null;
  const activeStage = activeEntry?.stage ?? 'QUOTATION';
  const activeParty = activeDoc ? parties.find((party) => party.id === activeDoc.party_id) ?? null : buyer;

  const mode: WorkbenchMode = !workbench
    ? 'create'
    : workbench.kind === 'create'
      ? 'create'
      : !activeEntry
        ? 'create'
        : activeEntry.doc.doc_type === 'CREDIT_NOTE'
          ? 'view'
          : activeEntry.stage === 'SETTLED'
            ? 'view'
            : activeEntry.stage === 'INVOICED_POSTED'
              ? 'settle'
              : 'review';

  const activeTaxInput = useMemo<TaxEvaluationInput | null>(() => {
    if (!activeDoc) return null;
    return documentTaxInput(activeDoc, activeParty, { tenant_is_withholding_entity: tenant.is_withholding_entity });
  }, [activeDoc, activeParty, tenant.is_withholding_entity]);

  const activeDecision = useMemo(() => {
    if (!activeDoc || !activeTaxInput) return decision;
    return evaluateTaxDecision(activeTaxInput);
  }, [activeDoc, activeTaxInput, decision]);

  const activeCogs = useMemo(
    () => (activeDoc ? calculatePerpetualCogs(activeDoc.lines, items) : calculatePerpetualCogs(lines, items)),
    [activeDoc, lines, items],
  );

  const journalPreview = useMemo(() => {
    const input = activeDoc ? activeTaxInput ?? advisorInput : advisorInput;
    const evaluated = activeDoc ? activeDecision : decision;
    const inventoryLines = activeDoc
      ? activeDoc.lines.map((line) => ({ sku: line.sku, quantity: line.quantity }))
      : lines.map((line) => ({ sku: line.sku, quantity: line.quantity }));
    return previewTaxJournal(input, evaluated, { lines: inventoryLines, items });
  }, [activeDoc, activeTaxInput, advisorInput, activeDecision, decision, lines, items]);

  const stockShortLines = useMemo(() => {
    const sourceLines = activeDoc ? activeDoc.lines : lines;
    return sourceLines.filter((line) => {
      const item = items.find((entry) => entry.sku === line.sku);
      if (!item || item.is_stock_item === false) return false;
      return line.quantity > (item.qty_on_hand ?? 0);
    });
  }, [activeDoc, lines, items]);

  const receiptJournal = activeDoc ? receiptJournalFor(activeDoc, journals) : undefined;
  const receiptBankCode = activeDoc ? bankCodeFor(activeDoc.payment_method, activeDoc.payment_channel) : '1110';
  const accountName = (code: string): string => accounts.find((account) => account.code === code)?.name_en ?? code;

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

  const buildDraft = (stage: SalesStage): TaxAnnotatedDoc | null => {
    if (!buyer) return null;
    const docNumber = draftNumberFor(stage, docDate, draftSeq);
    const built = buildCommercialDoc({
      doc_type: isCreditNote ? 'CREDIT_NOTE' : 'SALES_INVOICE',
      doc_number: docNumber,
      doc_date: docDate,
      due_date: addDays(docDate, buyer.credit_days || 15),
      party: buyer,
      bin_unit_id: binUnitId || tenant.bin_units[0]?.id || '',
      lines: lines.map((line, index) => ({
        id: `${docNumber}-L${index + 1}`,
        sku: line.sku || `SALE-${docDate.replace(/-/g, '')}-${index + 1}`,
        description_en: line.description_en || 'Sales line',
        description_bn: line.description_bn || line.description_en || 'বিক্রয় লাইন',
        quantity: Math.max(1, Math.round(line.quantity)),
        unit_price_poisha: parseBdt(line.unit_price_text),
        tax_category: line.tax_category,
      })),
      base_poisha: base,
      tax_category: category,
      tds_nature: 'NONE',
      payment_method: rail.method,
      narration_en: narration || 'Sales document',
      narration_bn: narration || 'বিক্রয় দলিল',
      reverse_charge: false,
      vds_applicable: corporateVds,
      sd_applicable: sd,
      book_type: 'STATUTORY_BD',
      created_by: currentUser.full_name,
      status: 'DRAFT',
      vehicle_no: vehicleNo,
      destination,
      payment_channel: rail.channel,
    });
    built.doc.workflow_stage = stage;
    return built.doc;
  };

  const saveDraft = (stage: SalesStage): void => {
    if (!canDraft) {
      setFeedback({ tone: 'error', text: L('Your role cannot create commercial drafts.', 'আপনার ভূমিকা বাণিজ্যিক খসড়া তৈরি করতে পারে না।') });
      return;
    }
    if (!buyer) {
      setFeedback({ tone: 'error', text: L('Select a buyer before saving.', 'সংরক্ষণের আগে ক্রেতা নির্বাচন করুন।') });
      return;
    }
    if (base <= 0n) {
      setFeedback({ tone: 'error', text: L('Add at least one line with a positive value.', 'ধনাত্মক মূল্যসহ অন্তত একটি লাইন যোগ করুন।') });
      return;
    }
    const draft = buildDraft(stage);
    if (!draft) return;
    setDrafts((previous) => [{ doc: draft, stage, draft: true }, ...previous]);
    setDraftSeq((value) => value + 1);
    setWorkbench({ kind: 'doc', docId: draft.id });
    setFeedback({
      tone: 'success',
      text: `${draft.doc_number} · ${STAGE_META[stage].labelEn} · ${money(draft.gross_poisha)}`,
    });
  };

  const postSalesInvoice = (settleNow: boolean): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to issue a Mushak 6.3 invoice.', 'মূসক ৬.৩ চালান ইস্যুতে POST_TO_GL প্রয়োজন।') });
      return;
    }
    if (!buyer) {
      setFeedback({ tone: 'error', text: L('Select a buyer before posting.', 'পোস্ট করার আগে ক্রেতা নির্বাচন করুন।') });
      return;
    }
    if (base <= 0n) {
      setFeedback({ tone: 'error', text: L('Add at least one line with a positive value.', 'ধনাত্মক মূল্যসহ অন্তত একটি লাইন যোগ করুন।') });
      return;
    }
    if (decision.decision === 'NOT_SUPPORTED' || decision.decision === 'SOURCE_DISPUTED_OR_EXPIRED') {
      setFeedback({ tone: 'error', text: L('The tax engine blocks this document. Review the advisor guardrails.', 'কর ইঞ্জিন এই দলিল ব্লক করেছে। উপদেশকের সতর্কতা দেখুন।') });
      return;
    }
    const result = postCommercialDoc(
      {
        doc_type: isCreditNote ? 'CREDIT_NOTE' : 'SALES_INVOICE',
        doc_date: docDate,
        party_id: buyer.id,
        bin_unit_id: binUnitId || tenant.bin_units[0]?.id || '',
        lines: lines.map((line, index) => ({
          sku: line.sku || `SALE-${docDate.replace(/-/g, '')}-${index + 1}`,
          description_en: line.description_en || 'Sales line',
          description_bn: line.description_bn || line.description_en || 'বিক্রয় লাইন',
          quantity: Math.max(1, Math.round(line.quantity)),
          unit_price_poisha: parseBdt(line.unit_price_text),
          tax_category: line.tax_category,
        })),
        tax_category: category,
        tds_nature: 'NONE',
        payment_method: rail.method,
        narration_en: `${isCreditNote ? 'Credit note (Mushak 6.7)' : 'Sales invoice (Mushak 6.3)'} — ${narration || lines[0]?.description_en || 'Supply'} — ${buyer.name_en}`,
        narration_bn: `${isCreditNote ? 'ক্রেডিট নোট (মূসক ৬.৭)' : 'বিক্রয় চালান (মূসক ৬.৩)'} — ${narration || lines[0]?.description_bn || 'সরবরাহ'} — ${buyer.name_bn}`,
        reverse_charge: false,
        withhold_vds: corporateVds,
        sd_applicable: sd,
        book_type: 'STATUTORY_BD',
        auto_post: true,
        workflow_stage: settleNow ? 'SETTLED' : 'INVOICED_POSTED',
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
      text: `${result.data.doc_number} · ${L('Mushak 6.3', 'মূসক ৬.৩')} ${result.data.mushak_serial ?? '—'} · ${money(result.data.gross_poisha)}`,
    });
  };

  const convertDraftToInvoice = (entry: PipelineEntry): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to issue the Mushak 6.3 invoice.', 'মূসক ৬.৩ চালান ইস্যুতে POST_TO_GL প্রয়োজন।') });
      return;
    }
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
        workflow_stage: 'INVOICED_POSTED',
        vehicle_no: entry.doc.vehicle_no,
        destination: entry.doc.destination,
        payment_channel: entry.doc.payment_channel,
      },
      { settle: false },
    );
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Invoice posting rejected.', 'চালান পোস্ট বাতিল হয়েছে।') });
      return;
    }
    setDrafts((previous) => previous.filter((draft) => draft.doc.id !== entry.doc.id));
    setWorkbench({ kind: 'doc', docId: result.data.id });
    setFeedback({
      tone: 'success',
      text: `${result.data.doc_number} · ${L('Mushak 6.3 issued', 'মূসক ৬.৩ ইস্যু')} · ${money(result.data.gross_poisha)} · ${L('COGS', 'সিওজিএস')} ${money(calculatePerpetualCogs(result.data.lines, items))}`,
    });
  };

  const recordReceipt = (doc: TaxAnnotatedDoc): void => {
    if (!canPost) {
      setFeedback({ tone: 'error', text: L('POST_TO_GL is required to record a customer receipt.', 'গ্রাহক প্রাপ্তি রেকর্ডে POST_TO_GL প্রয়োজন।') });
      return;
    }
    const existing = receiptJournalFor(doc, journals);
    if (existing) {
      setFeedback({ tone: 'info', text: `${L('Receipt already posted', 'প্রাপ্তি ইতিমধ্যে পোস্টেড')} · ${existing.journal_number}` });
      return;
    }
    const result = settleCommercialDocument(doc.id, {
      bank_account_code: bankCodeFor(doc.payment_method, doc.payment_channel),
      settlement_date: TODAY,
    });
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Receipt rejected.', 'প্রাপ্তি বাতিল হয়েছে।') });
      return;
    }
    setFeedback({
      tone: 'success',
      text: `${L('Receipt', 'প্রাপ্তি')} ${result.data.journal.journal_number} · ${money(
        result.data.journal.lines
          .filter((line) => line.account_code === bankCodeFor(doc.payment_method, doc.payment_channel))
          .reduce((total, line) => total + line.debit_poisha, 0n),
      )} · ${L('invoice settled and AR 1210 cleared', 'চালান নিষ্পত্তি ও এআর ১২১০ সমন্বয়')}`,
    });
  };

  const advanceEntry = (entry: PipelineEntry): void => {
    if (!entry.draft) {
      if (entry.stage === 'INVOICED_POSTED') {
        recordReceipt(entry.doc);
      } else {
        openDoc(entry.doc.id);
      }
      return;
    }
    if (entry.stage === 'QUOTATION') {
      const nextDoc: TaxAnnotatedDoc = {
        ...entry.doc,
        doc_number: renumbered(entry.doc, 'SO'),
        workflow_stage: 'SALES_ORDER',
      };
      setDrafts((previous) => previous.map((draft) => (draft.doc.id === entry.doc.id ? { ...draft, stage: 'SALES_ORDER', doc: nextDoc } : draft)));
      setFeedback({ tone: 'success', text: `${entry.doc.doc_number} → ${nextDoc.doc_number} · ${L('sales order confirmed', 'বিক্রয় অর্ডার নিশ্চিত')}` });
      return;
    }
    if (entry.stage === 'SALES_ORDER') {
      const nextDoc: TaxAnnotatedDoc = {
        ...entry.doc,
        doc_number: renumbered(entry.doc, 'DC'),
        workflow_stage: 'DELIVERY_CHALLAN',
      };
      setDrafts((previous) => previous.map((draft) => (draft.doc.id === entry.doc.id ? { ...draft, stage: 'DELIVERY_CHALLAN', doc: nextDoc } : draft)));
      setFeedback({ tone: 'success', text: `${entry.doc.doc_number} → ${nextDoc.doc_number} · ${L('challan dispatched', 'চালান প্রেরিত')}` });
      return;
    }
    if (entry.stage === 'DELIVERY_CHALLAN') {
      convertDraftToInvoice(entry);
      return;
    }
    openDoc(entry.doc.id);
  };

  const quickAction = (entry: PipelineEntry): void => {
    if (entry.doc.doc_type === 'CREDIT_NOTE' || entry.stage === 'SETTLED') {
      openDoc(entry.doc.id);
      return;
    }
    if (entry.draft && (entry.stage === 'QUOTATION' || entry.stage === 'SALES_ORDER')) {
      advanceEntry(entry);
      return;
    }
    openDoc(entry.doc.id);
  };

  const openLens = (doc: TaxAnnotatedDoc, tab: 'ENTRY' | 'INTEGRITY' | 'REVERSAL' = 'ENTRY'): void => {
    const receipt = receiptJournalFor(doc, journals);
    const journalId =
      tab === 'REVERSAL'
        ? doc.document_journal_id ?? doc.journal_id ?? null
        : receipt?.id ?? doc.document_journal_id ?? doc.journal_id ?? doc.settlement_journal_id ?? null;
    if (!journalId) {
      setFeedback({ tone: 'error', text: L('This document has no journal yet.', 'এই দলিলের কোনো খতিয়ান নেই।') });
      return;
    }
    setLensJournalId(journalId);
    setLensTab(tab);
    setLensContext(`${doc.doc_number} · ${doc.mushak_serial ?? 'Mushak 6.3'} · ${doc.party_name_en}`);
  };

  const lensJournal = journals.find((journal) => journal.id === lensJournalId) ?? null;

  const tableActionLabel = (entry: PipelineEntry): string => {
    if (entry.doc.doc_type === 'CREDIT_NOTE') return L('View credit note', 'ক্রেডিট নোট দেখুন');
    if (entry.stage === 'SETTLED') return L('View Receipt & Ledger Lens', 'প্রাপ্তি ও লেন্স দেখুন');
    return isBn ? STAGE_META[entry.stage].nextBn : STAGE_META[entry.stage].nextEn;
  };

  const presets: DemoPreset[] = [
    {
      id: 'standard',
      labelEn: 'Standard 15% local sale',
      labelBn: 'আদর্শ ১৫% স্থানীয় বিক্রয়',
      hintEn: 'Meghna Distribution · 2 laptops · bank transfer · output VAT 15%',
      hintBn: 'মেঘনা ডিস্ট্রিবিউশন · ২টি ল্যাপটপ · ব্যাংক ট্রান্সফার · আউটপুট ভ্যাট ১৫%',
      tone: 'emerald',
    },
    {
      id: 'vds',
      labelEn: 'VDS-withholding corporate buyer',
      labelBn: 'ভিডিএস-কর্তনকারী কর্পোরেট ক্রেতা',
      hintEn: 'Beximco · 4 routers · 5% VDS withheld · customer Mushak 6.6 tracked',
      hintBn: 'বেক্সিমকো · ৪টি রাউটার · ৫% ভিডিএস কর্তন · গ্রাহক মূসক ৬.৬ ট্র্যাক',
      tone: 'violet',
    },
    {
      id: 'export',
      labelEn: 'Zero-rated export sale',
      labelBn: 'শূন্য-হার রপ্তানি বিক্রয়',
      hintEn: 'Chattogram Port · cotton linen · 0% VAT · zero-rated register line',
      hintBn: 'চট্টগ্রাম বন্দর · তুলা লিনেন · ০% ভ্যাট · শূন্য-হার রেজিস্টার',
      tone: 'indigo',
    },
    {
      id: 'credit',
      labelEn: 'Credit note adjustment (Mushak 6.7)',
      labelBn: 'ক্রেডিট নোট সমন্বয় (মূসক ৬.৭)',
      hintEn: 'Beximco · damaged furniture · linked negative posting',
      hintBn: 'বেক্সিমকো · ক্ষতিগ্রস্ত আসবাব · লিংকড ঋণাত্মক পোস্টিং',
      tone: 'amber',
    },
  ];

  const applyPreset = (preset: DemoPreset): void => {
    setFeedback(null);
    const itemOf = (sku: string) => items.find((item) => item.sku === sku);
    const lineOf = (sku: string, quantity: number, fallbackCategory: TaxCategory = 'STANDARD_15'): DraftLine => {
      const item = itemOf(sku);
      if (item) return { ...lineFromItem(item), quantity, tax_category: fallbackCategory };
      return newDraftLine({ quantity, tax_category: fallbackCategory });
    };
    if (preset.id === 'standard') {
      setPartyId(customers.find((party) => party.name_en.includes('Meghna'))?.id ?? customers[0]?.id ?? '');
      setLines([lineOf('HS-8471.30', 2)]);
      setCategory('STANDARD_15');
      setPaymentChoice('BANK');
      setCorporateVds(false);
      setSd(false);
      setIsCreditNote(false);
      setVehicleNo('DHAKA METRO-GA 13-4521');
      setDestination('Tejgaon I/A, Dhaka 1208');
      setNarration('Corporate supply of portable laptop computers to Meghna Distribution Ltd.');
    } else if (preset.id === 'vds') {
      setPartyId(customers.find((party) => party.is_withholding_buyer)?.id ?? customers[0]?.id ?? '');
      setLines([lineOf('HS-8517.62', 4)]);
      setCategory('STANDARD_15');
      setPaymentChoice('BANK');
      setCorporateVds(true);
      setSd(false);
      setIsCreditNote(false);
      setVehicleNo('DHAKA METRO-GA 11-7788');
      setDestination('Beximco Industrial Park, Kashimpur, Gazipur');
      setNarration('Corporate supply of network routers to Beximco Trading Corporation — VDS deducted at source.');
    } else if (preset.id === 'export') {
      setPartyId(customers.find((party) => party.name_en.includes('Dhaka Fashion'))?.id ?? customers[0]?.id ?? '');
      setLines([lineOf('HS-6302.60', 6, 'EXPORT_ZERO')]);
      setCategory('EXPORT_ZERO');
      setPaymentChoice('BANK');
      setCorporateVds(false);
      setSd(false);
      setIsCreditNote(false);
      setVehicleNo('TRUCK-CHT-11-2288');
      setDestination('Chattogram Port, export consignment — HS 6302.60');
      setNarration('Zero-rated export of cotton household linen; shipping bill and EXP form attached.');
    } else {
      setPartyId(customers.find((party) => party.is_withholding_buyer)?.id ?? customers[0]?.id ?? '');
      setLines([lineOf('HS-9403.60', 1)]);
      setCategory('STANDARD_15');
      setPaymentChoice('BANK');
      setCorporateVds(true);
      setSd(false);
      setIsCreditNote(true);
      setVehicleNo('DHAKA METRO-GA 13-4521');
      setDestination('Beximco Industrial Park, Kashimpur, Gazipur');
      setNarration('Credit note for damaged wooden furniture against INV-2026-10-0012 — Mushak 6.7.');
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
    const header = ['Doc #', 'Date', 'Buyer', 'BIN', 'Stage', 'Mushak 6.3', 'Base', 'VAT', 'VDS', 'Gross', 'Net'];
    const rows = filteredEntries.map((entry) => [
      entry.doc.doc_number,
      entry.doc.doc_date,
      entry.doc.party_name_en,
      entry.doc.party_bin ?? '',
      STAGE_META[entry.stage].labelEn,
      entry.doc.mushak_serial ?? '',
      money(entry.doc.base_poisha, { symbol: false }),
      money(entry.doc.vat_poisha, { symbol: false }),
      money(entry.doc.vds_poisha, { symbol: false }),
      money(entry.doc.gross_poisha, { symbol: false }),
      money(entry.doc.net_payable_poisha, { symbol: false }),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales-register-${TODAY}.csv`;
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

  return (
    <>
      <WorkspaceHeader
        icon={<ReceiptText size={18} />}
        kickerEn="Workspace 02 · Sales · Order-to-Cash"
        kickerBn="ওয়ার্কস্পেস ০২ · বিক্রয় · অর্ডার-টু-ক্যাশ"
        titleEn="Sales documents & Mushak 6.3"
        titleBn="বিক্রয় দলিল ও মূসক ৬.৩"
        isBn={isBn}
        chips={
          <>
            <span className="lv-chip lv-chip-emerald">
              <Hash size={12} /> {L('Next serial', 'পরবর্তী সিরিয়াল')} <span className="font-mono">{nextSerial}</span>
            </span>
            <span className="lv-chip lv-chip-gold">
              <BadgeCheck size={12} /> {L('Gap-free sequence', 'ফাঁকহীন ক্রম')}
            </span>
            <span className="lv-chip lv-chip-neutral">
              <UserCheck size={12} /> {customers.length} {L('buyers', 'ক্রেতা')}
            </span>
            <span className="lv-chip lv-chip-neutral">
              <Wallet size={12} /> {L('Oct sales', 'অক্টোবর বিক্রয়')} <span className="font-money">{money(periodGross)}</span>
            </span>
          </>
        }
        actions={
          <button
            type="button"
            className="lv-btn lv-btn-primary !py-1.5"
            onClick={openCreate}
            disabled={!canDraft}
            title={canDraft ? L('Open the sales document workbench', 'বিক্রয় দলিল ওয়ার্কবেঞ্চ খুলুন') : isAuditor ? 'Read-Only Auditor Mode' : 'CREATE_COMMERCIAL_DRAFT required'}
          >
            <Plus size={14} /> {L('New Sales Document', 'নতুন বিক্রয় দলিল')}
          </button>
        }
      />

      <main className="space-y-4">
        <div
          role="status"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <span className="font-semibold">{L('Synthetic demo only.', 'শুধুমাত্র কৃত্রিম ডেমো।')}</span>{' '}
          {L(
            'This local quotation/order/challan pipeline is not the server-backed sales workflow and never writes real books. Signed-in companies use Sales & receivables with server-persisted drafts, posting and receipts.',
            'এই স্থানীয় কোটেশন/অর্ডার/চালান পাইপলাইন সার্ভার-ভিত্তিক বিক্রয় ওয়ার্কফ্লো নয় এবং কখনও বাস্তব হিসাব লেখে না। সাইন-ইন করা কোম্পানিগুলো সার্ভার-সংরক্ষিত খসড়া, পোস্টিং ও রিসিটসহ বিক্রয় ও প্রাপ্য ব্যবহার করে।',
          )}
        </div>
        {/* ZONE A — module header, pipeline stage bar, search & filters */}
        <section className="lv-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                {L('Order-to-cash pipeline', 'অর্ডার-টু-ক্যাশ পাইপলাইন')}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-ink-400">
              <span>
                {entries.length} {L('documents', 'দলিল')}
              </span>
              <span className="text-ink-300">·</span>
              <span>
                {L('Open AR', 'খোলা প্রাপ্য')} <span className="font-money font-semibold text-ink-700">{money(openReceivable)}</span>
              </span>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-3 py-2.5">
            {SALES_TABS.map((tab) => {
              const count = tab.id === 'ALL' ? entries.length : entries.filter((entry) => entry.stage === tab.id).length;
              const active = stageTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStageTab(tab.id)}
                  aria-pressed={active}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                    active
                      ? 'border-vault-800 bg-vault-900 text-white shadow-lift'
                      : 'border-line bg-surface text-ink-600 hover:border-vault-300 hover:bg-vault-50/60'
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-ink-700'}`}>{isBn ? tab.labelBn : tab.labelEn}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                      active ? 'bg-white/15 text-white' : 'bg-ink-100 text-ink-500'
                    }`}
                  >
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
                placeholder={L('Search by Doc #, buyer, BIN or Mushak serial…', 'দলিল নং, ক্রেতা, বিআইএন বা মূসক সিরিয়াল দিয়ে খুঁজুন…')}
                aria-label={L('Search sales documents', 'বিক্রয় দলিল খুঁজুন')}
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

        {/* ZONE B — clean master table, no inline creation form */}
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker flex items-center gap-1.5">
                <Layers size={12} /> {L('Commercial master data', 'বাণিজ্যিক মাস্টার ডেটা')}
              </p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">
                {L('Mushak 6.2 — sales documents by lifecycle stage', 'মূসক ৬.২ — জীবনচক্র ধাপে বিক্রয় দলিল')}
              </h2>
              <p className="mt-0.5 text-[10px] text-ink-400">
                {L('Click any row to open the focused document workbench. Quote and order steps advance in one click.', 'যেকোনো সারিতে ক্লিক করে ফোকাসড ডকুমেন্ট ওয়ার্কবেঞ্চ খুলুন। কোট ও অর্ডার ধাপ এক ক্লিকে এগোয়।')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="lv-chip lv-chip-neutral">
                {filteredEntries.length}/{entries.length} {L('docs', 'দলিল')}
              </span>
              <span className="lv-chip lv-chip-emerald">
                {L('Filtered gross', 'ফিল্টারকৃত মোট')} <span className="font-money">{money(filteredGross)}</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="lv-table min-w-[1140px]">
              <thead>
                <tr>
                  <th>{L('Document', 'দলিল')}</th>
                  <th>{L('Date', 'তারিখ')}</th>
                  <th>{L('Buyer (BIN)', 'ক্রেতা (বিআইএন)')}</th>
                  <th>{L('Stage', 'ধাপ')}</th>
                  <th>{L('Stock', 'স্টক')}</th>
                  <th className="text-right">{L('Amount', 'অঙ্ক')}</th>
                  <th className="text-right">{L('Next action', 'পরবর্তী কার্য')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const doc = entry.doc;
                  const stockLines = doc.lines.flatMap((line) => {
                    const item = items.find((candidate) => candidate.sku === line.sku);
                    return item && item.is_stock_item !== false ? [{ line, item }] : [];
                  });
                  const shortLines = stockLines.filter(({ line, item }) => (item.qty_on_hand ?? 0) < line.quantity);
                  const minOnHand = stockLines.length
                    ? Math.min(...stockLines.map(({ item }) => item.qty_on_hand ?? 0))
                    : null;
                  return (
                    <tr key={doc.id} className="cursor-pointer" onClick={() => openDoc(doc.id)}>
                      <td>
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-vault-50 text-vault-700 ring-1 ring-inset ring-vault-100">
                            {entry.stage === 'SETTLED' ? <CheckCheck size={13} /> : entry.stage === 'DELIVERY_CHALLAN' ? <Truck size={13} /> : <FileText size={13} />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11.5px] font-semibold text-ink-900">{doc.doc_number}</p>
                            <p className="text-[9px] uppercase tracking-wide text-ink-400">
                              {doc.doc_type === 'CREDIT_NOTE'
                                ? L('Mushak 6.7 credit note', 'মূসক ৬.৭ ক্রেডিট নোট')
                                : entry.stage === 'QUOTATION'
                                  ? L('Quotation', 'কোটেশন')
                                  : entry.stage === 'SALES_ORDER'
                                    ? L('Sales order', 'বিক্রয় অর্ডার')
                                    : entry.stage === 'DELIVERY_CHALLAN'
                                      ? L('Delivery challan', 'ডেলিভারি চালান')
                                      : L('Tax invoice', 'কর চালান')}
                            </p>
                            <p className="mt-0.5 font-mono text-[9px] text-vault-700">{doc.mushak_serial ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-[10.5px]">{formatDate(doc.doc_date, locale)}</td>
                      <td>
                        <p className="text-[11px] font-medium text-ink-800">{doc.party_name_en}</p>
                        <p className={`font-mono text-[9px] ${doc.party_bin ? 'text-ink-400' : 'font-semibold text-rose-600'}`}>
                          {doc.party_bin ?? L('No BIN', 'বিআইএন নেই')}
                        </p>
                      </td>
                      <td>
                        <StageBadge stage={entry.stage} isBn={isBn} />
                        <StageProgress stage={entry.stage} />
                      </td>
                      <td>
                        {stockLines.length === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[8.5px] font-semibold text-ink-500">
                            <Boxes size={9} /> {L('Service', 'সেবা')}
                          </span>
                        ) : shortLines.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                            <ShieldAlert size={9} /> {shortLines.length} {L('short line(s)', 'ঘাটতি লাইন')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            <Warehouse size={9} /> {minOnHand ?? 0} {L('on hand', 'স্টকে')}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <p className="font-money text-[11px] font-semibold text-ink-900">{money(doc.gross_poisha)}</p>
                        <p className="font-money text-[9px] text-ink-400">
                          {L('VAT', 'ভ্যাট')} {money(doc.vat_poisha, { symbol: false })}
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
                            entry.doc.doc_type === 'CREDIT_NOTE'
                              ? false
                              : !entry.draft && entry.stage === 'INVOICED_POSTED'
                                ? !canPost
                                : entry.stage === 'DELIVERY_CHALLAN'
                                  ? !canPost
                                  : entry.stage === 'SALES_ORDER' || entry.stage === 'QUOTATION'
                                    ? !canDraft
                                    : false
                          }
                          title={
                            entry.stage === 'DELIVERY_CHALLAN' || (entry.stage === 'INVOICED_POSTED' && !entry.draft)
                              ? L('Open the workbench to confirm this posting', 'এই পোস্টিং নিশ্চিত করতে ওয়ার্কবেঞ্চ খুলুন')
                              : tableActionLabel(entry)
                          }
                        >
                          {tableActionLabel(entry)} <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-400">
                          <FilePlus2 size={18} />
                        </span>
                        <p className="text-xs font-semibold text-ink-600">
                          {L('No sales document matches these filters.', 'এই ফিল্টারে কোনো বিক্রয় দলিল মেলেনি।')}
                        </p>
                        <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[11px]" onClick={openCreate} disabled={!canDraft}>
                          <Plus size={13} /> {L('Create the first sales document', 'প্রথম বিক্রয় দলিল তৈরি করুন')}
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
              <ShieldCheck size={12} /> {L('VDS is derived from the buyer master; the workbench toggle can override it for the document.', 'ভিডিএস ক্রেতা মাস্টার থেকে নির্ধারিত; ওয়ার্কবেঞ্চে দলিলের জন্য পরিবর্তন করা যায়।')}
            </span>
            <span>
              {L('Ledger control', 'লেজার নিয়ন্ত্রণ')}: 1210 / 4100 / 2120 / 5100 · {filteredEntries.length} {L('documents', 'দলিল')}
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
              aria-label={L('Sales document workbench', 'বিক্রয় দলিল ওয়ার্কবেঞ্চ')}
              onClick={(event) => {
                if (event.target === event.currentTarget) closeWorkbench();
              }}
            >
              <aside className="flex h-full w-full max-w-[1240px] animate-rise flex-col border-l border-line bg-canvas shadow-panel" onClick={(event) => event.stopPropagation()}>
                <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-lift ring-1 ring-white/25">
                        {mode === 'create' ? <FilePlus2 size={18} /> : activeStage === 'SETTLED' ? <CheckCheck size={18} /> : <ReceiptText size={18} />}
                      </span>
                      <div className="min-w-0">
                        <p className="lv-kicker">
                          {L(
                            mode === 'create'
                              ? 'Zone C · New sales document'
                              : mode === 'review'
                                ? 'Zone C · Review & advance'
                                : mode === 'settle'
                                  ? 'Zone C · Record receipt'
                                  : 'Zone C · Document file',
                            mode === 'create'
                              ? 'জোন সি · নতুন বিক্রয় দলিল'
                              : mode === 'review'
                                ? 'জোন সি · পর্যালোচনা ও অগ্রগতি'
                                : mode === 'settle'
                                  ? 'জোন সি · প্রাপ্তি রেকর্ড'
                                  : 'জোন সি · দলিল ফাইল',
                          )}
                        </p>
                        <h2 className="mt-0.5 truncate text-base font-semibold tracking-tight text-ink-900">
                          {mode === 'create' ? L('Multi-line Mushak 6.3 voucher', 'মাল্টি-লাইন মূসক ৬.৩ ভাউচার') : activeDoc?.doc_number}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {mode === 'create' ? (
                            <span className="lv-chip lv-chip-neutral">
                              <Hash size={11} /> {nextSerial}
                            </span>
                          ) : (
                            <>
                              <StageBadge stage={activeStage} isBn={isBn} />
                              <StatusPill status={displayStatus(activeDoc as TaxAnnotatedDoc, journals)} />
                              <span className="lv-chip lv-chip-neutral !text-[9px]">
                                {L('Buyer', 'ক্রেতা')} {activeDoc?.party_name_en}
                              </span>
                            </>
                          )}
                          {mode === 'create' ? (
                            <button
                              type="button"
                              onClick={fillSample}
                              className="text-[9.5px] font-semibold text-vault-700 underline decoration-dotted underline-offset-2 transition hover:text-vault-900"
                            >
                              {L('Fill sample data', 'নমুনা ডেটা')}
                            </button>
                          ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`hidden items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ring-1 ring-inset sm:inline-flex ${isAuditor ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-vault-50 text-vault-700 ring-vault-100'}`}>
                        <ShieldCheck size={9} />
                        {isAuditor ? L('Read-Only Auditor Mode', 'শুধুমাত্র পাঠযোগ্য অডিটর মোড') : currentUser.role}
                      </span>
                      <button
                        type="button"
                        onClick={closeWorkbench}
                        className="rounded-xl border border-line bg-surface-2 p-1.5 text-ink-500 transition hover:text-ink-900"
                        aria-label={L('Close workbench', 'ওয়ার্কবেঞ্চ বন্ধ')}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                  <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-line sm:grid-cols-4">
                    {SALES_STEPS.map((step, index) => {
                      const current = index === stepCurrent;
                      const done = index < stepCurrent;
                      return (
                        <div
                          key={step.key}
                          className={`relative border-t-2 px-2.5 py-2 ${current ? 'border-vault-600 bg-vault-50/70' : done ? 'border-emerald-400 bg-emerald-50/40' : 'border-line bg-surface'}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                                done ? 'bg-emerald-500 text-white' : current ? 'bg-vault-800 text-white' : 'bg-ink-100 text-ink-500'
                              }`}
                            >
                              {done ? <Check size={11} /> : index + 1}
                            </span>
                            <p className={`truncate text-[10px] font-semibold ${current ? 'text-vault-900' : 'text-ink-700'}`}>
                              {isBn ? step.labelBn : step.labelEn}
                            </p>
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
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="lv-label !mb-0">{L('Document type', 'দলিলের ধরন')}</p>
                            <p className="text-[9.5px] text-ink-400">{L('Credit notes post a linked Mushak 6.7 reversal.', 'ক্রেডিট নোট লিংকড মূসক ৬.৭ রিভার্সাল পোস্ট করে।')}</p>
                          </div>
                          <div className="lv-seg">
                            <button type="button" className="lv-seg-item" data-active={!isCreditNote} onClick={() => setIsCreditNote(false)}>
                              {L('Invoice', 'চালান')}
                            </button>
                            <button type="button" className="lv-seg-item" data-active={isCreditNote} onClick={() => setIsCreditNote(true)}>
                              {L('Credit note', 'ক্রেডিট নোট')}
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <div className="flex items-end gap-1.5">
                              <Field label={L('Buyer (customer)', 'ক্রেতা (গ্রাহক)')} className="min-w-0 flex-1">
                                <select
                                  className="lv-input !py-1.5 text-[11px]"
                                  value={partyId}
                                  onChange={(event) => {
                                    setPartyId(event.target.value);
                                    setCorporateVds(parties.find((party) => party.id === event.target.value)?.is_withholding_buyer ?? false);
                                  }}
                                >
                                  <option value="">{L('Select buyer…', 'ক্রেতা নির্বাচন…')}</option>
                                  {customers.map((party) => (
                                    <option key={party.id} value={party.id}>
                                      {party.name_en} · {party.bin ?? L('no BIN', 'বিআইএন নেই')}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <button type="button" className="lv-btn lv-btn-secondary shrink-0 !px-2 !py-1.5 !text-[9.5px]" onClick={() => setMasterTab('parties')}>
                                <UserPlus size={11} /> {L('New Customer', 'নতুন ক্রেতা')}
                              </button>
                            </div>
                          </div>
                          <Field label={L('Document date', 'দলিলের তারিখ')}>
                            <input type="date" className="lv-input !py-1.5 text-[11px]" value={docDate} onChange={(event) => setDocDate(event.target.value)} />
                          </Field>
                          <Field label={L('BIN unit', 'বিআইএন ইউনিট')}>
                            <select className="lv-input !py-1.5 text-[11px]" value={binUnitId} onChange={(event) => setBinUnitId(event.target.value)}>
                              {tenant.bin_units.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.unit_name_en} · {unit.bin_number}
                                </option>
                              ))}
                            </select>
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
                          <Field label={L('Document VAT treatment', 'দলিলের ভ্যাট নির্ধারণ')}>
                            <select className="lv-input !py-1.5 text-[11px]" value={category} onChange={(event) => setCategory(event.target.value as TaxCategory)}>
                              {VAT_CATEGORIES.map((option) => (
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

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={corporateVds}
                            onClick={() => setCorporateVds((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition ${corporateVds ? 'border-violet-300 bg-violet-50' : 'border-line bg-surface hover:border-vault-200'}`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-[10.5px] font-semibold text-ink-800">{L('Corporate VDS-withholding buyer', 'কর্পোরেট ভিডিএস-কর্তনকারী ক্রেতা')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full transition ${corporateVds ? 'bg-violet-600' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${corporateVds ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[9px] text-ink-400">{L('Tracks the customer Mushak 6.6 receivable and VDS settlement leg.', 'গ্রাহক মূসক ৬.৬ প্রাপ্য ও ভিডিএস লাইন ট্র্যাক করে।')}</span>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={sd}
                            onClick={() => setSd((value) => !value)}
                            className={`rounded-xl border px-3 py-2 text-left transition ${sd ? 'border-gold-300 bg-gold-50' : 'border-line bg-surface hover:border-vault-200'}`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-[10.5px] font-semibold text-ink-800">{L('Supplementary duty on this supply', 'এই সরবরাহে সম্পূরক শুল্ক')}</span>
                              <span className={`relative h-4 w-8 shrink-0 rounded-full transition ${sd ? 'bg-gold-500' : 'bg-ink-300'}`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${sd ? 'left-[18px]' : 'left-0.5'}`} />
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[9px] text-ink-400">{L('Second Schedule 20% SD; VAT is computed on base + SD.', 'দ্বিতীয় তফসিল ২০% এসডি; ভ্যাট ভিত্তি + এসডিতে গণনা হয়।')}</span>
                          </button>
                        </div>
                      </>
                    ) : activeDoc ? (
                      <>
                        <div className="rounded-2xl border border-line bg-surface p-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">{L('Counterparty', 'প্রতিপক্ষ')}</p>
                              <p className="mt-0.5 truncate text-[13px] font-semibold text-ink-900">{activeDoc.party_name_en}</p>
                              <p className="font-mono text-[9.5px] text-ink-400">
                                {L('BIN', 'বিআইএন')} {activeDoc.party_bin ?? '—'} · {L('e-TIN', 'ই-টিআইএন')} {activeDoc.party_tin ?? '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">{L('Gross', 'মোট')}</p>
                              <p className="font-money text-[15px] font-semibold text-ink-900">{money(activeDoc.gross_poisha)}</p>
                              <p className="text-[9px] text-ink-400">
                                {L('Net receivable', 'নিট প্রাপ্য')} {money(activeDoc.net_payable_poisha)}
                              </p>
                            </div>
                          </div>
                          <dl className="mt-2.5 grid gap-1.5 text-[10px] sm:grid-cols-2">
                            <div className="flex justify-between gap-2">
                              <dt className="text-ink-400">{L('Document date', 'দলিলের তারিখ')}</dt>
                              <dd className="text-ink-700">{formatDate(activeDoc.doc_date, locale)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-ink-400">{L('Payment', 'পরিশোধ')}</dt>
                              <dd className="text-ink-700">
                                {activeDoc.payment_method} · {activeDoc.payment_channel ?? '—'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2 sm:col-span-2">
                              <dt className="text-ink-400">{L('Narration', 'বিবরণ')}</dt>
                              <dd className="max-w-[70%] truncate text-right text-ink-700">{activeDoc.narration_en}</dd>
                            </div>
                            {activeDoc.vehicle_no || activeDoc.destination ? (
                              <div className="flex justify-between gap-2 sm:col-span-2">
                                <dt className="text-ink-400">{L('Logistics', 'লজিস্টিকস')}</dt>
                                <dd className="max-w-[70%] truncate text-right font-mono text-[9.5px] text-ink-600">
                                  {activeDoc.vehicle_no ?? '—'} · {activeDoc.destination ?? '—'}
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>

                        {activeStage === 'QUOTATION' || activeStage === 'SALES_ORDER' ? (
                          <div className={`rounded-xl border px-3 py-2.5 ${stockShortLines.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-vault-100 bg-vault-50'}`}>
                            <p className={`flex items-center gap-1.5 text-[10.5px] font-semibold ${stockShortLines.length > 0 ? 'text-amber-800' : 'text-vault-800'}`}>
                              {stockShortLines.length > 0 ? <ShieldAlert size={13} /> : <CheckCheck size={13} />}
                              {stockShortLines.length > 0
                                ? L('Stock availability warning before confirmation', 'নিশ্চিত করার আগে স্টক সতর্কতা')
                                : L('Stock is available for every line', 'প্রতিটি লাইনের স্টক পর্যাপ্ত')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] leading-relaxed text-ink-500">
                              {stockShortLines.length > 0
                                ? L(
                                    `${stockShortLines.length} line(s) exceed the quantity on hand. The order may still be confirmed, but dispatch will drive inventory negative.`,
                                    `${stockShortLines.length}টি লাইন হাতে থাকা পরিমাণের বেশি। অর্ডার নিশ্চিত করা যায়, তবে প্রেরণে স্টক ঋণাত্মক হবে।`,
                                  )
                                : L('Confirm the order, then dispatch the delivery challan from the same document.', 'অর্ডার নিশ্চিত করুন, তারপর একই দলিল থেকে ডেলিভারি চালান প্রেরণ করুন।')}
                            </p>
                          </div>
                        ) : null}

                        {activeStage === 'DELIVERY_CHALLAN' ? (
                          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-indigo-800">
                              <Truck size={13} /> {L('Challan is ready for the gap-free Mushak 6.3 serial', 'চালান ফাঁকহীন মূসক ৬.৩ সিরিয়ালের জন্য প্রস্তুত')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] leading-relaxed text-indigo-700">
                              {L(
                                `Invoice issue allocates ${nextSerial} atomically, relieves ${activeCogs > 0n ? money(activeCogs) : 'zero'} of COGS from inventory, and posts revenue + output VAT.`,
                                `চালান ইস্যুতে ${nextSerial} বরাদ্দ হয়, মজুদ থেকে ${activeCogs > 0n ? money(activeCogs) : 'শূন্য'} সিওজিএস কমে, এবং রাজস্ব + আউটপুট ভ্যাট পোস্ট হয়।`,
                              )}
                            </p>
                          </div>
                        ) : null}

                        {activeStage === 'INVOICED_POSTED' && mode === 'settle' && activeDoc ? (
                          <div className="rounded-xl border border-line bg-surface">
                            <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-surface-2/60 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                                <Split size={12} /> {L('Customer receipt split', 'গ্রাহক প্রাপ্তি বিভাজন')}
                              </p>
                              <span className="lv-chip lv-chip-neutral !text-[9px]">{receiptBankCode}</span>
                            </div>
                            <dl className="space-y-1 px-3 py-2.5 text-[10.5px]">
                              <Metric label={`Dr ${accountName(receiptBankCode)}`} value={money(activeDoc.net_payable_poisha)} tone="emerald" />
                              {activeDoc.vds_poisha > 0n ? <Metric label={`Dr 1145 ${L('VDS receivable', 'ভিডিএস প্রাপ্য')}`} value={money(activeDoc.vds_poisha)} tone="violet" /> : null}
                              {activeDoc.tds_poisha > 0n ? <Metric label={`Dr 1150 ${L('AIT / customer TDS', 'এআইটি / গ্রাহক টিডিএস')}`} value={money(activeDoc.tds_poisha)} tone="gold" /> : null}
                              <Metric label={`Cr 1210 ${L('Trade receivable', 'বাণিজ্যিক প্রাপ্য')}`} value={money(activeDoc.gross_poisha)} />
                            </dl>
                            {receiptJournal ? (
                              <p className="border-t border-line/70 px-3 py-2 text-[9.5px] text-emerald-700">
                                {L('Receipt already posted', 'প্রাপ্তি ইতিমধ্যে পোস্টেড')} · {receiptJournal.journal_number}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {activeStage === 'SETTLED' && activeDoc ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-800">
                              <CircleCheck size={13} /> {L('Receivable cleared', 'প্রাপ্য নিষ্পত্তি হয়েছে')}
                            </p>
                            <p className="mt-0.5 text-[9.5px] text-emerald-700">
                              {receiptJournal
                                ? `${receiptJournal.journal_number} · ${formatDate(receiptJournal.posting_date, locale)}`
                                : `${L('Settled on', 'নিষ্পত্তি')} ${formatDate(activeDoc.doc_date, locale)}`}
                              {activeDoc.vds_poisha > 0n ? ` · ${L('VDS 6.6 pending', 'ভিডিএস ৬.৬ অপেক্ষমাণ')} ${money(activeDoc.vds_poisha)}` : ''}
                            </p>
                          </div>
                        ) : null}

                        {activeDoc.status === 'DRAFT' ? (
                          <div className="rounded-xl border border-line bg-surface-2/50 px-3 py-2">
                            <p className="text-[9.5px] text-ink-500">
                              {L(
                                'Draft pipeline documents are not posted to the GL. Advancing to the invoice or bill stage is the posting event.',
                                'খসড়া পাইপলাইন দলিল জিএল-এ পোস্ট হয় না। চালান বা বিল ধাপে অগ্রগতিই পোস্টিং ইভেন্ট।',
                              )}
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    <SalesLineEditor
                      lines={
                        activeDoc
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
                          : lines
                      }
                      items={items}
                      money={money}
                      isBn={isBn}
                      readOnly={mode !== 'create'}
                      onChange={setLines}
                      onNewItem={mode === 'create' ? () => setMasterTab('items') : undefined}
                    />

                    {activeDoc && mode !== 'create' ? null : (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[10px]">
                        <span className="flex items-center gap-1.5 text-ink-500">
                          <Sparkles size={12} className="text-vault-600" /> {L('COGS preview', 'সিওজিএস প্রাকদর্শন')}{' '}
                          <span className="font-money font-semibold text-ink-800">{money(activeCogs)}</span>
                        </span>
                        <span className="text-ink-400">
                          {L('Preview serial', 'প্রাকদর্শন সিরিয়াল')} <span className="font-mono text-vault-800">{nextSerial}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* RIGHT 35% — live tax summary, s.46 context, journal preview */}
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
                        {activeDecision.sd_poisha !== 0n ? <Metric label={L('Supplementary duty', 'সম্পূরক শুল্ক')} value={money(activeDecision.sd_poisha)} tone="gold" /> : null}
                        <Metric label={L('Output VAT', 'আউটপুট ভ্যাট')} value={money(activeDecision.vat_poisha)} tone="indigo" />
                        <Metric label={L('VDS withheld', 'ভিডিএস কর্তন')} value={money(activeDecision.vds_poisha)} tone="violet" />
                        {activeDecision.tds_poisha !== 0n ? <Metric label={L('TDS / AIT', 'টিডিএস / এআইটি')} value={money(activeDecision.tds_poisha)} tone="gold" /> : null}
                        <Metric label={L('Gross invoice', 'মোট চালান')} value={money(activeDecision.gross_poisha)} />
                        <Metric label={L('Net receivable', 'নিট প্রাপ্য')} value={money(activeDecision.net_payable_poisha)} tone="emerald" />
                        <Metric label={L('Treasury payable', 'কোষাগারে প্রদেয়')} value={money(activeDecision.treasury_payable_poisha)} />
                      </dl>
                      <p className="lv-hint mt-2.5 text-[9.5px]">
                        {L('VAT rate', 'ভ্যাট হার')} {formatPercentBps(activeDecision.vat_bps, 'latin')} · {L('VDS', 'ভিডিএস')}{' '}
                        {formatPercentBps(activeDecision.vds_bps, 'latin')} · {activeDecision.rule_pack_version}
                      </p>
                    </section>

                    <section className="rounded-2xl border border-line bg-surface p-3.5">
                      <p className="lv-kicker flex items-center gap-1.5">
                        <Warehouse size={12} /> {L('Stock & cost context', 'স্টক ও ব্যয় প্রসঙ্গ')}
                      </p>
                      <dl className="mt-2 space-y-1.5 text-[10px]">
                        <Metric label={L('Perpetual COGS', 'চিরস্থায়ী সিওজিএস')} value={money(activeCogs)} tone="rose" />
                        <Metric label={L('Gross margin', 'গ্রস মার্জিন')} value={money(activeDecision.base_poisha - activeCogs)} tone="emerald" />
                        <Metric
                          label={L('Short lines', 'ঘাটতি লাইন')}
                          value={String(stockShortLines.length)}
                          tone={stockShortLines.length > 0 ? 'rose' : 'emerald'}
                        />
                      </dl>
                      <p className="lv-hint mt-2 text-[9.5px]">
                        {L('COGS = Σ(scaled qty × weighted-average unit cost) ÷ 100, posted atomically with the Mushak 6.3 invoice.', 'সিওজিএস = Σ(স্কেলকৃত পরিমাণ × ওয়েটেড-এভারেজ একক ব্যয়) ÷ ১০০, মূসক ৬.৩ চালানের সঙ্গে পোস্ট হয়।')}
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
                        <div className="flex flex-wrap gap-1">
                          <span className="lv-chip lv-chip-neutral !text-[8.5px]">{activeDecision.rule_ids.length} {L('rules', 'নিয়ম')}</span>
                          <span className="lv-chip lv-chip-neutral !text-[8.5px]">{activeDecision.citations.length} {L('citations', 'উদ্ধৃতি')}</span>
                          <span className="lv-chip lv-chip-neutral !text-[8.5px]">{activeDecision.trace_id.slice(0, 12)}…</span>
                        </div>
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
                              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                                {isBn ? group.title_bn : group.title_en}
                              </p>
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
                        <ShieldCheck size={12} /> {L('Controls & posting evidence', 'নিয়ন্ত্রণ ও পোস্টিং প্রমাণ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className={`lv-chip !text-[9px] ${canDraft ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>CREATE_COMMERCIAL_DRAFT</span>
                        <span className={`lv-chip !text-[9px] ${canPost ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>POST_TO_GL</span>
                      </div>
                      <p className="mt-2 text-[9.5px] leading-relaxed text-ink-500">
                        {L(
                          'Stage 4 allocates the gap-free serial and posts Dr 1210 / Cr 4100 + 2120; stage 5 posts Dr bank + 1145 + 1150 / Cr 1210.',
                          'ধাপ ৪ ফাঁকহীন সিরিয়াল বরাদ্দ করে Dr 1210 / Cr 4100 + 2120 পোস্ট করে; ধাপ ৫ Dr ব্যাংক + 1145 + 1150 / Cr 1210 পোস্ট করে।',
                        )}
                      </p>
                    </section>
                  </aside>
                </div>

                <footer className="shrink-0 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      {feedback ? (
                        <div
                          className={`flex items-start gap-1.5 text-[10px] font-semibold ${
                            feedback.tone === 'success' ? 'text-emerald-700' : feedback.tone === 'error' ? 'text-rose-700' : 'text-vault-700'
                          }`}
                        >
                          {feedback.tone === 'success' ? (
                            <CircleCheck size={12} className="mt-0.5 shrink-0" />
                          ) : feedback.tone === 'error' ? (
                            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                          ) : (
                            <Sparkles size={12} className="mt-0.5 shrink-0" />
                          )}
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
                          'Role-checked footer — the posting leg needs POST_TO_GL; drafting needs CREATE_COMMERCIAL_DRAFT.',
                          'ভূমিকা-যাচাইকৃত ফুটার — পোস্টিং লেগে POST_TO_GL; খসড়ায় CREATE_COMMERCIAL_DRAFT প্রয়োজন।',
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button type="button" className="lv-btn lv-btn-ghost !py-1.5 !text-[10.5px]" onClick={closeWorkbench}>
                        {L('Close', 'বন্ধ')}
                      </button>
                      {mode === 'create' ? (
                        <>
                          <button
                            type="button"
                            className="lv-btn lv-btn-secondary !py-1.5 !text-[10.5px]"
                            onClick={() => saveDraft('QUOTATION')}
                            disabled={!canDraft}
                            title={isAuditor ? 'Read-Only Auditor Mode' : undefined}
                          >
                            <FileText size={13} /> {L('Save as Quotation', 'কোটেশন হিসেবে সংরক্ষণ')}
                          </button>
                          <button
                            type="button"
                            className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                            onClick={() => postSalesInvoice(false)}
                            disabled={!canPost}
                            title={isAuditor ? 'Read-Only Auditor Mode' : !canPost ? 'POST_TO_GL required' : undefined}
                          >
                            <Stamp size={13} /> {isCreditNote ? L('Post Credit Note (Mushak 6.7)', 'ক্রেডিট নোট পোস্ট (মূসক ৬.৭)') : L('Issue Mushak 6.3 Invoice', 'মূসক ৬.৩ চালান ইস্যু')}
                          </button>
                        </>
                      ) : null}
                      {mode === 'review' && activeEntry ? (
                        <button
                          type="button"
                          className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]"
                          onClick={() => advanceEntry(activeEntry)}
                          disabled={activeStage === 'DELIVERY_CHALLAN' ? !canPost : !canDraft}
                          title={isAuditor ? 'Read-Only Auditor Mode' : undefined}
                        >
                          <ArrowRight size={13} /> {isBn ? STAGE_META[activeStage].nextBn : STAGE_META[activeStage].nextEn}
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
                            onClick={() => recordReceipt(activeDoc)}
                            disabled={!canPost || Boolean(receiptJournal)}
                            title={isAuditor ? 'Read-Only Auditor Mode' : !canPost ? 'POST_TO_GL required' : undefined}
                          >
                            <Banknote size={13} /> {L('Record Customer Receipt', 'গ্রাহক প্রাপ্তি রেকর্ড')}
                          </button>
                        </>
                      ) : null}
                      {mode === 'view' && activeDoc ? (
                        <>
                          <button type="button" className="lv-btn lv-btn-secondary !py-1.5 !text-[10.5px]" onClick={() => setPrintDoc(activeDoc)}>
                            <Printer size={13} /> {L('Print A4 6.3', 'এ৪ ৬.৩ প্রিন্ট')}
                          </button>
                          {activeDoc.status !== 'DRAFT' && canReverse ? (
                            <button type="button" className="lv-btn lv-btn-ghost !py-1.5 !text-[10.5px] text-rose-600" onClick={() => openLens(activeDoc, 'REVERSAL')}>
                              <RotateCcw size={13} /> {L('Reverse', 'রিভার্স')}
                            </button>
                          ) : null}
                          <button type="button" className="lv-btn lv-btn-primary !py-1.5 !text-[10.5px]" onClick={() => openLens(activeDoc)}>
                            <Eye size={13} /> {activeStage === 'SETTLED' ? L('View Receipt & Ledger Lens', 'প্রাপ্তি ও লেন্স দেখুন') : L('Ledger Lens', 'লেজার লেন্স')}
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
      <StatutoryPrintModal open={printDoc !== null} onClose={() => setPrintDoc(null)} mode="MUSHAK_6_3" doc={printDoc} />
    </>
  );
}
