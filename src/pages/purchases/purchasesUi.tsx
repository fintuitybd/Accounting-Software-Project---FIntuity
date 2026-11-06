import type { ReactNode } from 'react';
import type { PurchaseDocumentStatus, PurchaseDocumentType } from '../../purchases/api';

export const PURCHASE_INPUT = 'lv-input min-h-11 w-full text-[14px]';
export const PURCHASE_SELECT = 'lv-select min-h-11 w-full text-[14px]';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Rolling twelve-month default for statement/report filters. Not a statutory period rule. */
export function oneYearAgoIso(date = todayIso()): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
}

export function newKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export function docTypeLabel(type: PurchaseDocumentType): string {
  return type === 'PURCHASE_BILL' ? 'Supplier bill' : 'Expense voucher';
}

export function statusChip(status: PurchaseDocumentStatus): ReactNode {
  if (status === 'POSTED') return <span className="lv-chip lv-chip-emerald">Posted</span>;
  if (status === 'REVERSED') return <span className="lv-chip lv-chip-rose">Reversed</span>;
  return <span className="lv-chip lv-chip-neutral">Draft</span>;
}

export function taxStateChip(state: string | null): ReactNode {
  if (!state) return <span className="lv-chip lv-chip-neutral">Not calculated</span>;
  if (state === 'SUPPORTED') return <span className="lv-chip lv-chip-emerald">Supported</span>;
  if (state === 'SUPPORTED_WITH_CONDITIONS')
    return <span className="lv-chip lv-chip-gold">Supported with conditions</span>;
  return <span className="lv-chip lv-chip-rose">{state.replaceAll('_', ' ').toLowerCase()}</span>;
}

export function SectionCard({
  title,
  kicker,
  children,
  action,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="lv-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {kicker ? <p className="lv-kicker">{kicker}</p> : null}
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink-900">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center">
      <p className="text-[14px] font-semibold text-ink-800">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-ink-500">{hint}</p>
    </div>
  );
}

export function ProofRow({
  label,
  gl,
  subledger,
  difference,
  agrees,
}: {
  label: string;
  gl: string;
  subledger: string;
  difference: string;
  agrees: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[13px]">
      <span className="font-semibold text-ink-800">{label}</span>
      <span className="text-ink-500">
        GL {gl} · subledger {subledger} · difference {difference}
      </span>
      <span className={`lv-chip ${agrees ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
        {agrees ? 'Agrees' : 'Difference'}
      </span>
    </div>
  );
}

export function ratePercent(rateBps: number): string {
  return `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 2)}%`;
}
