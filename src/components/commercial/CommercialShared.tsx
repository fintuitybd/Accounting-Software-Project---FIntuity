// LedgerVault — commercial workspace primitives.
//
// W02 and W03 are the two halves of the same commercial engine: a multi-line voucher, a live tax
// advisor and a statutory register. These primitives keep the two screens visually identical and
// stop the 40-line line-item editor from being copy-pasted into both workspaces.

import type { ReactNode } from 'react';
import {
  BadgeCheck,
  Banknote,
  ChevronDown,
  Landmark,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

import type { SeedItem } from '../../core/ledger/seedData';
import type { PaymentMethod, TaxCategory } from '../../core/types';

export type MoneyFn = (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
export type LFn = (en: string, bn: string) => string;

// ---------------------------------------------------------------------------------------------
// Settlement rails — the UI choice maps onto the domain PaymentMethod plus a display channel.
// ---------------------------------------------------------------------------------------------

export interface PaymentRail {
  id: string;
  method: PaymentMethod;
  labelEn: string;
  labelBn: string;
  channel: string;
  icon: 'bank' | 'mfs' | 'cash' | 'cheque';
}

export const PAYMENT_RAILS: PaymentRail[] = [
  { id: 'BANK', method: 'BANK', labelEn: 'Bank transfer', labelBn: 'ব্যাংক ট্রান্সফার', channel: 'City Bank · BEFTN', icon: 'bank' },
  { id: 'BKASH', method: 'MFS', labelEn: 'bKash', labelBn: 'বিকাশ', channel: 'bKash Merchant', icon: 'mfs' },
  { id: 'NAGAD', method: 'MFS', labelEn: 'Nagad', labelBn: 'নগদ', channel: 'Nagad Merchant', icon: 'mfs' },
  { id: 'CHEQUE', method: 'CHEQUE', labelEn: 'Cheque', labelBn: 'চেক', channel: 'Cheque clearing', icon: 'cheque' },
  { id: 'CASH', method: 'CASH', labelEn: 'Cash', labelBn: 'নগদ', channel: 'Cash', icon: 'cash' },
];

export function paymentRail(id: string): PaymentRail {
  return PAYMENT_RAILS.find((rail) => rail.id === id) ?? PAYMENT_RAILS[0];
}

// ---------------------------------------------------------------------------------------------
// Draft line model
// ---------------------------------------------------------------------------------------------

export interface DraftLine {
  id: string;
  item_id: string;
  sku: string;
  hs_code: string;
  description_en: string;
  description_bn: string;
  quantity: number;
  unit_price_text: string;
  unit_en: string;
  unit_bn: string;
  tax_category: TaxCategory;
}

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `LINE-${Date.now().toString(36)}-${sequence}`;
}

export function newDraftLine(overrides: Partial<DraftLine> = {}): DraftLine {
  return {
    id: nextId(),
    item_id: 'CUSTOM',
    sku: `CUSTOM-${String(sequence).padStart(3, '0')}`,
    hs_code: '',
    description_en: 'Describe the goods or service',
    description_bn: 'পণ্য বা সেবার বিবরণ লিখুন',
    quantity: 1,
    unit_price_text: '0.00',
    unit_en: 'pcs',
    unit_bn: 'পিস',
    tax_category: 'STANDARD_15',
    ...overrides,
  };
}

export function lineFromItem(item: SeedItem, baseId?: string): DraftLine {
  return {
    id: baseId ?? nextId(),
    item_id: item.id,
    sku: item.sku,
    hs_code: item.hs_code,
    description_en: item.name_en,
    description_bn: item.name_bn,
    quantity: 1,
    unit_price_text: (Number(item.unit_price_poisha) / 100).toFixed(2),
    unit_en: item.unit_en,
    unit_bn: item.unit_bn,
    tax_category: item.tax_category,
  };
}

export function parseBdt(text: string): bigint {
  const clean = text.replace(/[৳,\s]/g, '').replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  if (!/^\d*(\.\d*)?$/.test(clean) || !clean || clean === '.') return 0n;
  const [whole = '0', fraction = ''] = clean.split('.');
  return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
}

export function lineValuePoisha(line: DraftLine): bigint {
  const quantity = BigInt(Math.max(0, Math.round(line.quantity)));
  return quantity * parseBdt(line.unit_price_text);
}

export const VAT_RATE_BPS_BY_CATEGORY: Record<TaxCategory, number> = {
  STANDARD_15: 1500,
  TRADING_5: 500,
  PROCUREMENT_7_5: 750,
  EXPORT_ZERO: 0,
  EXEMPT: 0,
  REVERSE_CHARGE: 1500,
  OUT_OF_SCOPE: 0,
};

export const VAT_CATEGORIES: TaxCategory[] = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
];

export function categoryLabel(category: TaxCategory, isBn: boolean): string {
  const labels: Record<TaxCategory, [string, string]> = {
    STANDARD_15: ['Standard 15%', 'আদর্শ ১৫%'],
    TRADING_5: ['Trading 5%', 'ট্রেডিং ৫%'],
    PROCUREMENT_7_5: ['Procurement 7.5%', 'প্রকিউরমেন্ট ৭.৫%'],
    EXPORT_ZERO: ['Zero-rated export', 'শূন্য-হার রপ্তানি'],
    EXEMPT: ['Exempt', 'অব্যাহতিপ্রাপ্ত'],
    REVERSE_CHARGE: ['Reverse charge 15%', 'রিভার্স চার্জ ১৫%'],
    OUT_OF_SCOPE: ['Out of scope', 'পরিধির বাইরে'],
  };
  const entry = labels[category];
  return isBn ? entry[1] : entry[0];
}

// ---------------------------------------------------------------------------------------------
// Header + KPI + toggles
// ---------------------------------------------------------------------------------------------

export function WorkspaceHeader({
  icon,
  kickerEn,
  kickerBn,
  titleEn,
  titleBn,
  isBn,
  chips,
  actions,
}: {
  icon: ReactNode;
  kickerEn: string;
  kickerBn: string;
  titleEn: string;
  titleBn: string;
  isBn: boolean;
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="no-print relative overflow-hidden rounded-[22px] border border-line/80 bg-surface/85 px-4 py-4 shadow-card backdrop-blur-xl sm:px-5">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-vault-400/70 to-transparent" />
      <span className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-vault-400/10 blur-3xl" />
      <span className="pointer-events-none absolute -bottom-32 left-1/3 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="brand-gradient relative grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-white shadow-lift ring-1 ring-white/25">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-vault-600">
              <span className="status-dot" />
              <span className="truncate">{isBn ? kickerBn : kickerEn}</span>
            </p>
            <h1 className="mt-1 truncate font-display text-[21px] font-semibold leading-tight tracking-[-0.02em] text-ink-900 sm:text-[23px]">
              {isBn ? titleBn : titleEn}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chips}
          {actions}
        </div>
      </div>
    </header>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'vault',
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'vault' | 'gold' | 'rose' | 'indigo' | 'violet';
  onClick?: () => void;
  active?: boolean;
}) {
  const tones: Record<string, string> = {
    vault: 'from-vault-50 to-white text-vault-800 border-vault-100',
    gold: 'from-gold-50 to-white text-gold-700 border-gold-200',
    rose: 'from-rose-50 to-white text-rose-700 border-rose-100',
    indigo: 'from-indigo-50 to-white text-indigo-700 border-indigo-100',
    violet: 'from-violet-50 to-white text-violet-700 border-violet-100',
  };
  const badges: Record<string, string> = {
    vault: 'bg-vault-100 text-vault-700',
    gold: 'bg-gold-100 text-gold-700',
    rose: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    violet: 'bg-violet-100 text-violet-700',
  };
  const Tag = onClick ? 'button' : 'article';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`lv-card group relative overflow-hidden border bg-gradient-to-br p-4 text-left transition ${tones[tone]} ${
        onClick ? 'hover:-translate-y-0.5 hover:shadow-lift' : ''
      } ${active ? 'ring-2 ring-vault-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label}</p>
        {icon ? <span className={`grid h-7 w-7 place-items-center rounded-lg ${badges[tone]}`}>{icon}</span> : null}
      </div>
      <p className="font-money mt-2 text-xl font-semibold tracking-tight text-ink-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-snug text-ink-400">{hint}</p> : null}
    </Tag>
  );
}

export function ToggleRow({
  checked,
  onChange,
  labelEn,
  labelBn,
  hintEn,
  hintBn,
  isBn,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelEn: string;
  labelBn: string;
  hintEn?: string;
  hintBn?: string;
  isBn: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
        checked ? 'border-vault-300 bg-vault-50/70' : 'border-ink-200 bg-white hover:border-vault-200'
      } disabled:cursor-not-allowed disabled:opacity-70`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-ink-800">{isBn ? labelBn : labelEn}</span>
          {hintEn || hintBn ? (
            <span className="mt-0.5 block text-[10px] leading-snug text-ink-400">
              {isBn ? hintBn ?? hintEn : hintEn ?? hintBn}
            </span>
          ) : null}
        </span>
        <span
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${
            checked ? 'bg-vault-600' : 'bg-ink-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
              checked ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Demo scenario presets
// ---------------------------------------------------------------------------------------------

export interface DemoPreset {
  id: string;
  labelEn: string;
  labelBn: string;
  hintEn: string;
  hintBn: string;
  tone: 'emerald' | 'indigo' | 'violet' | 'amber' | 'rose';
}

const PRESET_TONES: Record<DemoPreset['tone'], string> = {
  emerald: 'border-vault-200 bg-vault-50/80 text-vault-800 hover:border-vault-400',
  indigo: 'border-indigo-200 bg-indigo-50/80 text-indigo-800 hover:border-indigo-400',
  violet: 'border-violet-200 bg-violet-50/80 text-violet-800 hover:border-violet-400',
  amber: 'border-amber-200 bg-amber-50/80 text-amber-800 hover:border-amber-400',
  rose: 'border-rose-200 bg-rose-50/80 text-rose-800 hover:border-rose-400',
};

export function DemoPresetBar({
  presets,
  onLoad,
  isBn,
  activeId,
}: {
  presets: DemoPreset[];
  onLoad: (preset: DemoPreset) => void;
  isBn: boolean;
  activeId?: string | null;
}) {
  return (
    <section className="lv-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-gradient-to-r from-vault-950 via-vault-900 to-vault-800 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-gold-300" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-vault-100">
            {isBn ? 'ডেমো দৃশ্যপট — এক ক্লিকে লোড' : 'Investor demo scenarios — load in one click'}
          </p>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-vault-100 ring-1 ring-white/15">
          {presets.length} {isBn ? 'দৃশ্যপট' : 'scenarios'}
        </span>
      </div>
      <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onLoad(preset)}
            className={`group rounded-xl border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${PRESET_TONES[preset.tone]} ${
              activeId === preset.id ? 'ring-2 ring-vault-300' : ''
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold leading-tight">{isBn ? preset.labelBn : preset.labelEn}</span>
              <ChevronDown size={12} className="shrink-0 -rotate-90 opacity-50 transition group-hover:opacity-100" />
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug opacity-70">
              {isBn ? preset.hintBn : preset.hintEn}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Multi-line voucher editor
// ---------------------------------------------------------------------------------------------

export function LineItemsEditor({
  lines,
  items,
  onChange,
  money,
  isBn,
  titleEn = 'Line items',
  titleBn = 'লাইন আইটেম',
}: {
  lines: DraftLine[];
  items: SeedItem[];
  onChange: (lines: DraftLine[]) => void;
  money: MoneyFn;
  isBn: boolean;
  titleEn?: string;
  titleBn?: string;
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
  const estimatedVat = lines.reduce(
    (total, line) => total + (lineValuePoisha(line) * BigInt(VAT_RATE_BPS_BY_CATEGORY[line.tax_category])) / 10000n,
    0n,
  );

  return (
    <section className="border-t border-ink-100">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50/70 px-5 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
            {isBn ? titleBn : titleEn}
          </p>
          <p className="text-[11px] text-ink-400">
            {isBn
              ? 'সিডেড আইটেম নির্বাচন করলে এইচএস কোড, একক ও ভ্যাট স্বয়ংক্রিয়ভাবে বসবে।'
              : 'Pick a seeded item to auto-fill HS code, UoM, unit price and the default VAT tier.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...lines, newDraftLine()])}
          className="lv-btn lv-btn-secondary !py-1.5"
        >
          <Plus size={13} /> {isBn ? 'লাইন যোগ' : 'Add line'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="lv-table min-w-[900px]">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="min-w-[220px]">{isBn ? 'আইটেম / বিবরণ' : 'Item / description'}</th>
              <th className="w-24">{isBn ? 'এইচএস কোড' : 'HS code'}</th>
              <th className="w-16 text-right">{isBn ? 'পরিমাণ' : 'Qty'}</th>
              <th className="w-14">{isBn ? 'একক' : 'UoM'}</th>
              <th className="w-32 text-right">{isBn ? 'একক মূল্য' : 'Unit price'}</th>
              <th className="w-32 text-right">{isBn ? 'মূল্য' : 'Value'}</th>
              <th className="w-36">{isBn ? 'ভ্যাট শ্রেণি' : 'VAT tier'}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const value = lineValuePoisha(line);
              return (
                <tr key={line.id} className="align-top">
                  <td className="pt-3 font-mono text-[10px] text-ink-400">{String(index + 1).padStart(2, '0')}</td>
                  <td className="space-y-1.5 py-2">
                    <select
                      className="lv-input !py-1.5 text-[11px]"
                      value={line.item_id}
                      onChange={(event) => selectItem(line, event.target.value)}
                    >
                      <option value="CUSTOM">{isBn ? 'কাস্টম বিবরণ' : 'Custom description'}</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} · {isBn ? item.name_bn : item.name_en}
                        </option>
                      ))}
                    </select>
                    <input
                      className="lv-input !py-1.5 text-[11px]"
                      value={isBn ? line.description_bn : line.description_en}
                      onChange={(event) =>
                        update(
                          line.id,
                          isBn
                            ? { description_bn: event.target.value }
                            : { description_en: event.target.value },
                        )
                      }
                      placeholder={isBn ? 'বিবরণ' : 'Description'}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      className="lv-input !py-1.5 font-mono text-[10px]"
                      value={line.hs_code}
                      onChange={(event) => update(line.id, { hs_code: event.target.value })}
                      placeholder="8471.30.00"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="lv-input !py-1.5 text-right font-money text-[11px]"
                      value={line.quantity}
                      onChange={(event) =>
                        update(line.id, { quantity: Math.max(1, Number(event.target.value) || 1) })
                      }
                    />
                  </td>
                  <td className="py-2 text-[10px] text-ink-500">{isBn ? line.unit_bn : line.unit_en}</td>
                  <td className="py-2">
                    <input
                      className="lv-input !py-1.5 text-right font-money text-[11px]"
                      value={line.unit_price_text}
                      onChange={(event) => update(line.id, { unit_price_text: event.target.value })}
                    />
                  </td>
                  <td className="py-2 text-right font-money text-[11px] font-semibold text-ink-900">
                    {money(value, { symbol: false })}
                  </td>
                  <td className="py-2">
                    <select
                      className="lv-input !py-1.5 text-[10px]"
                      value={line.tax_category}
                      onChange={(event) => update(line.id, { tax_category: event.target.value as TaxCategory })}
                    >
                      {VAT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {categoryLabel(category, isBn)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      disabled={lines.length === 1}
                      onClick={() => onChange(lines.filter((entry) => entry.id !== line.id))}
                      className="rounded-lg p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                      title={isBn ? 'লাইন মুছুন' : 'Remove line'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50/80">
              <td colSpan={6} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                {isBn ? 'মোট' : 'Totals'}
              </td>
              <td className="px-3 py-2 text-right font-money text-[11px] font-semibold text-ink-900">
                {money(totalBase, { symbol: false })}
              </td>
              <td colSpan={2} className="px-3 py-2 text-[10px] text-ink-400">
                {isBn ? 'আনুমানিক ভ্যাট' : 'Est. VAT'} {money(estimatedVat)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Register controls
// ---------------------------------------------------------------------------------------------

export function SearchFilterBar({
  query,
  onQuery,
  status,
  onStatus,
  statuses,
  isBn,
  right,
}: {
  query: string;
  onQuery: (value: string) => void;
  status: string;
  onStatus: (value: string) => void;
  statuses: Array<{ id: string; labelEn: string; labelBn: string }>;
  isBn: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[340px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="lv-input !py-1.5 pl-8 text-[12px]"
            placeholder={
              isBn
                ? 'চালান / মূসক সিরিয়াল / পক্ষ দিয়ে খুঁজুন…'
                : 'Search invoice, Mushak serial or party…'
            }
          />
        </label>
        <div className="lv-seg">
          {statuses.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="lv-seg-item"
              data-active={status === entry.id}
              onClick={() => onStatus(entry.id)}
            >
              {isBn ? entry.labelBn : entry.labelEn}
            </button>
          ))}
        </div>
      </div>
      {right}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'POSTED' || status === 'SETTLED' || status === 'RECONCILED'
      ? 'bg-vault-100 text-vault-800 ring-vault-200'
      : status === 'REVERSED'
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : status === 'DRAFT'
          ? 'bg-ink-100 text-ink-600 ring-ink-200'
          : 'bg-amber-50 text-amber-700 ring-amber-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${tone}`}>
      {status}
    </span>
  );
}

export function EmptyRegister({ colSpan, isBn, messageEn, messageBn }: { colSpan: number; isBn: boolean; messageEn: string; messageBn: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-400">
            <Banknote size={18} />
          </span>
          <p className="text-xs font-semibold text-ink-600">{isBn ? messageBn : messageEn}</p>
          <p className="text-[10px] text-ink-400">
            {isBn ? 'উপরের ফর্মটি পূরণ করে প্রথম দলিল পোস্ট করুন।' : 'Fill the voucher above to post the first document.'}
          </p>
        </div>
      </td>
    </tr>
  );
}

export function VerifiedChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-vault-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-vault-800 ring-1 ring-inset ring-vault-200">
      <BadgeCheck size={10} /> {label}
    </span>
  );
}

export function TreasuryChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gold-700 ring-1 ring-inset ring-gold-200">
      <Landmark size={10} /> {label}
    </span>
  );
}
