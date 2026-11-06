import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { usePreferences } from '../preferences/AppPreferences';
import type { ToastMessage } from '../core/types';

const TONE: Record<
  ToastMessage['tone'],
  { icon: typeof CheckCircle2; ring: string; bar: string; iconClass: string; label: string; labelBn: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-ql-success/30',
    bar: 'bg-ql-success',
    iconClass: 'text-ql-success',
    label: 'Success',
    labelBn: 'সফল',
  },
  warning: {
    icon: TriangleAlert,
    ring: 'border-ql-warning/35',
    bar: 'bg-ql-warning',
    iconClass: 'text-ql-warning',
    label: 'Attention',
    labelBn: 'মনোযোগ',
  },
  error: {
    icon: CircleAlert,
    ring: 'border-ql-danger/35',
    bar: 'bg-ql-danger',
    iconClass: 'text-ql-danger',
    label: 'Error',
    labelBn: 'ত্রুটি',
  },
  info: {
    icon: Info,
    ring: 'border-ql-border',
    bar: 'bg-ql-info',
    iconClass: 'text-ql-info',
    label: 'Notice',
    labelBn: 'বিজ্ঞপ্তি',
  },
};

export function AppToastStack() {
  const { toasts, dismissToast, locale } = usePreferences();
  const L = (en: string, bn: string): string => (locale === 'bn-BD' ? bn : en);
  return (
    <div
      role="region"
      className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(92vw,380px)] flex-col gap-2"
      aria-live="polite"
      aria-label={L('Notifications', 'বিজ্ঞপ্তি')}
    >
      {toasts.map((toast) => {
        const tone = TONE[toast.tone] ?? TONE.info;
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-ql border bg-ql-surface px-4 py-3 shadow-ql-popover ${tone.ring}`}
          >
            <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`} aria-hidden />
            <Icon size={17} className={`mt-0.5 shrink-0 ${tone.iconClass}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-5 text-ql-ink">{toast.title}</p>
              {toast.message ? <p className="mt-0.5 text-[13px] leading-5 text-ql-ink-muted">{toast.message}</p> : null}
              <span className="sr-only">{L(tone.label, tone.labelBn)}</span>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink"
              aria-label={L('Dismiss notification', 'বিজ্ঞপ্তি বন্ধ করুন')}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default AppToastStack;
