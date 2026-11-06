import { localized, type Locale } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { JournalStatus } from '../../ledger/api';

const STATUS_META: Record<
  JournalStatus,
  { en: string; bn: string; tone: 'neutral' | 'amber' | 'emerald' | 'gold' | 'rose' }
> = {
  DRAFT: { en: 'Draft', bn: 'খসড়া', tone: 'neutral' },
  SUBMITTED: { en: 'Submitted', bn: 'জমা দেওয়া', tone: 'amber' },
  APPROVED: { en: 'Approved', bn: 'অনুমোদিত', tone: 'gold' },
  POSTED: { en: 'Posted', bn: 'পোস্টেড', tone: 'emerald' },
  REVERSED: { en: 'Reversed', bn: 'বাতিল', tone: 'rose' },
};

const TONE_CLASS: Record<string, string> = {
  neutral: 'lv-chip-neutral',
  amber: 'lv-chip-gold',
  emerald: 'lv-chip-emerald',
  gold: 'lv-chip-gold',
  rose: 'lv-chip-rose',
};

export function statusLabel(status: JournalStatus, locale: Locale): string {
  const meta = STATUS_META[status];
  return localized(locale, meta.en, meta.bn);
}

export function StatusChip({ status }: { status: JournalStatus }) {
  const { locale } = usePreferences();
  const meta = STATUS_META[status];
  return (
    <span className={`lv-chip ${TONE_CLASS[meta.tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {localized(locale, meta.en, meta.bn)}
    </span>
  );
}

export function poishaToBdtString(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function PoishaText({ value }: { value: string }) {
  const poisha = BigInt(value);
  if (poisha === 0n) return <span className="text-ink-300">—</span>;
  return <span className="font-mono tabular-nums">{poishaToBdtString(poisha)}</span>;
}

export function parseBdt(value: string): bigint | null {
  const text = value.trim();
  if (!text) return 0n;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

export function dateToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Browser-safe idempotency key; randomUUID is preferred but falls back outside a secure context. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function dateWithin(period: { startDate: string; endDate: string }, date: string): boolean {
  return date >= period.startDate && date <= period.endDate;
}

export function formatDateTime(value: string | null, locale: Locale): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'bn-BD' ? 'bn-BD' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(value: string | null, locale: Locale): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'bn-BD' ? 'bn-BD' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}
