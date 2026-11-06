import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock3, FileQuestion, ShieldCheck } from 'lucide-react';

export const BANK_INPUT = 'lv-input min-h-11 w-full text-[14px]';
export const BANK_SELECT = 'lv-select min-h-11 w-full text-[14px]';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

export function statusChip(status: string): ReactNode {
  if (status === 'MATCHED' || status === 'POSTED' || status === 'REVIEWED' || status === 'ACTIVE' || status === 'IMPORTED') {
    return (
      <span className="lv-chip lv-chip-emerald">
        <CheckCircle2 size={12} /> {status.replaceAll('_', ' ')}
      </span>
    );
  }
  if (status === 'PARTIALLY_MATCHED' || status === 'PREPARED' || status === 'SUBMITTED') {
    return (
      <span className="lv-chip lv-chip-gold">
        <Clock3 size={12} /> {status.replaceAll('_', ' ')}
      </span>
    );
  }
  if (status === 'LOCKED' || status === 'REVERSED' || status === 'REJECTED' || status === 'INACTIVE' || status === 'EXCLUDED') {
    return (
      <span className="lv-chip lv-chip-rose">
        <CircleSlash size={12} /> {status.replaceAll('_', ' ')}
      </span>
    );
  }
  if (status === 'CATEGORIZED') {
    return (
      <span className="lv-chip lv-chip-gold">
        <FileQuestion size={12} /> {status}
      </span>
    );
  }
  if (status === 'UNMATCHED' || status === 'DRAFT') {
    return (
      <span className="lv-chip lv-chip-rose">
        <AlertTriangle size={12} /> {status}
      </span>
    );
  }
  if (status === 'PARTIAL') {
    return (
      <span className="lv-chip lv-chip-gold">
        <AlertTriangle size={12} /> {status}
      </span>
    );
  }
  return (
    <span className="lv-chip lv-chip-neutral">
      <ShieldCheck size={12} /> {status.replaceAll('_', ' ')}
    </span>
  );
}

export function boolChip(value: boolean, trueLabel: string, falseLabel: string): ReactNode {
  return (
    <span className={`lv-chip ${value ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
      {value ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {value ? trueLabel : falseLabel}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'negative'
        ? 'text-rose-700 dark:text-rose-300'
        : tone === 'warning'
          ? 'text-amber-700 dark:text-amber-300'
          : 'text-ink-900';
  return (
    <article className="lv-card lv-card-pad">
      <p className="lv-kicker">{label}</p>
      <p className={`font-money mt-2 text-[20px] font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{hint}</p> : null}
    </article>
  );
}
