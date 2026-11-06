import type { ReactNode } from 'react';
import type { SalesDocumentStatus, SalesDocumentType } from '../../sales/api';

export const SALES_INPUT = 'lv-input min-h-11 w-full text-[14px]';
export const SALES_SELECT = 'lv-select min-h-11 w-full text-[14px]';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function newIdempotencyKey(prefix: string): string {
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

export function docTypeLabel(type: SalesDocumentType): string {
  return type === 'SALES_INVOICE' ? 'Sales invoice' : 'Credit note';
}

export function statusTone(status: SalesDocumentStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'lv-chip-neutral';
    case 'APPROVED':
      return 'lv-chip-gold';
    case 'POSTED':
      return 'lv-chip-emerald';
    case 'REVERSED':
      return 'lv-chip-rose';
  }
}

export function StatusChip({ status, label }: { status: SalesDocumentStatus | 'POSTED_RECEIPT' | 'REVERSED_RECEIPT'; label?: string }) {
  const text =
    label ??
    (status === 'POSTED_RECEIPT'
      ? 'Posted receipt'
      : status === 'REVERSED_RECEIPT'
        ? 'Reversed receipt'
        : status.charAt(0) + status.slice(1).toLowerCase());
  if (status === 'POSTED' || status === 'POSTED_RECEIPT') {
    return <span className="lv-chip lv-chip-emerald">{text}</span>;
  }
  if (status === 'REVERSED' || status === 'REVERSED_RECEIPT') {
    return <span className="lv-chip lv-chip-rose">{text}</span>;
  }
  if (status === 'APPROVED') return <span className="lv-chip lv-chip-gold">{text}</span>;
  return <span className="lv-chip lv-chip-neutral">{text}</span>;
}

export function TaxStateChip({ state }: { state: string | null }) {
  if (!state) return <span className="lv-chip lv-chip-neutral">Not calculated</span>;
  if (state === 'SUPPORTED') return <span className="lv-chip lv-chip-emerald">Supported</span>;
  if (state === 'SUPPORTED_WITH_CONDITIONS') return <span className="lv-chip lv-chip-gold">Supported with conditions</span>;
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
