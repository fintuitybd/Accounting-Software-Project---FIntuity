import { useEffect, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';

/**
 * Browser-level unsaved-change guard.
 *
 * React Router's `useBlocker` is only available to data routers; this application uses
 * `BrowserRouter`. The hook therefore covers refresh/close and same-origin link navigation, which
 * are the two ways a user normally leaves a form. Server-side drafts remain the source of truth.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent): string => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target === '_blank' || target.hasAttribute('download')) return;
      const href = target.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}

export type DraftSaveState = 'IDLE' | 'DIRTY' | 'SAVING' | 'SAVED' | 'ERROR' | 'INCOMPLETE';

export function DraftSaveIndicator({
  state,
  savedAt,
  error,
  onRetry,
  labels,
}: {
  state: DraftSaveState;
  savedAt: Date | null;
  error: string | null;
  onRetry?: () => void;
  labels: {
    idle: string;
    dirty: string;
    saving: string;
    saved: string;
    error: string;
    incomplete: string;
    retry: string;
  };
}) {
  if (state === 'IDLE') return null;
  const savedLabel = savedAt
    ? `${labels.saved} ${savedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : labels.saved;
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-[12px]">
      {state === 'SAVING' ? (
        <span className="flex items-center gap-1.5 text-ql-ink-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden /> {labels.saving}
        </span>
      ) : null}
      {state === 'SAVED' ? (
        <span className="flex items-center gap-1.5 text-ql-success">
          <CheckCircle2 size={14} aria-hidden /> {savedLabel}
        </span>
      ) : null}
      {state === 'DIRTY' || state === 'INCOMPLETE' ? (
        <span className="flex items-center gap-1.5 text-ql-warning">
          <CircleAlert size={14} aria-hidden /> {state === 'INCOMPLETE' ? labels.incomplete : labels.dirty}
        </span>
      ) : null}
      {state === 'ERROR' ? (
        <span className="flex flex-wrap items-center gap-2 text-ql-danger">
          <span className="flex items-center gap-1.5">
            <CircleAlert size={14} aria-hidden /> {error || labels.error}
          </span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="ql-btn ql-btn-secondary ql-btn-sm">
              {labels.retry}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function ValidationSummary({ errors, title }: { errors: Array<{ message: string; href?: string }>; title: string }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-ql border border-ql-danger/30 bg-ql-danger-soft px-4 py-3 text-[13px] text-ql-ink">
      <p className="flex items-center gap-2 font-semibold text-ql-danger">
        <CircleAlert size={16} aria-hidden /> {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {errors.map((entry) => (
          <li key={entry.message}>
            {entry.href ? (
              <a href={entry.href} className="underline underline-offset-2">
                {entry.message}
              </a>
            ) : (
              entry.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FormHint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[12px] leading-5 text-ql-ink-muted">{children}</span>;
}
