import type { ReactNode } from 'react';
import { CircleAlert, CheckCircle2, Info } from 'lucide-react';
import { ApiError } from '../../auth/api';

export const INPUT_CLASS = 'ql-input min-h-11 w-full text-[14px]';

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] leading-relaxed text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function ErrorBanner({ message, details }: { message: string; details?: unknown }) {
  const rows = importErrorRows(details);
  return (
    <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-700 dark:text-rose-300">
      <p className="flex items-start gap-2 font-semibold">
        <CircleAlert size={15} className="mt-0.5 shrink-0" />
        {message}
      </p>
      {rows.length > 0 ? (
        <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-[12px]">
          {rows.slice(0, 40).map((row, index) => (
            <li key={`${row.row}-${row.field}-${index}`}>
              {row.row > 0 ? `Row ${row.row}` : 'File'}
              {row.field ? ` · ${row.field}` : ''}: {row.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' | 'warning' }) {
  const styles =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        : 'border-line bg-surface-2/50 text-ink-600';
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? CircleAlert : Info;
  return (
    <div role="status" className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed ${styles}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

export function apiErrorDetails(error: unknown): unknown {
  return error instanceof ApiError ? error.details : undefined;
}

export function importErrorRows(details: unknown): Array<{ row: number; field: string; message: string }> {
  if (!details || typeof details !== 'object') return [];
  const errors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((error) => {
      if (!error || typeof error !== 'object') return null;
      const row = (error as { row?: unknown }).row;
      const field = (error as { field?: unknown }).field;
      const message = (error as { message?: unknown }).message;
      if (typeof message !== 'string') return null;
      return {
        row: typeof row === 'number' ? row : 0,
        field: typeof field === 'string' ? field : '',
        message,
      };
    })
    .filter((error): error is { row: number; field: string; message: string } => error !== null);
}

export function poishaToBdtString(value: string): string {
  try {
    const poisha = BigInt(value);
    const negative = poisha < 0n;
    const absolute = negative ? -poisha : poisha;
    const whole = absolute / 100n;
    const fraction = absolute % 100n;
    return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}
