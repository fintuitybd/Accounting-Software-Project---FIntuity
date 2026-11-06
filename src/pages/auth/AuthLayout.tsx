import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Globe2, Moon, ShieldCheck, Sun } from 'lucide-react';
import { BRAND_NAME, FintuityLogo, FintuityMark } from '../../components/brand/FintuityBrand';
import { loadStoredPreferences, saveStoredPreferences } from '../../core/storage/preferences';
import { localized } from '../../core/i18n';
import type { AppSettings } from '../../core/types';

export interface AuthUiState {
  locale: AppSettings['locale'];
  theme: AppSettings['theme'];
  L: (en: string, bn: string) => string;
  setLocale: (locale: AppSettings['locale']) => void;
  toggleTheme: () => void;
}

export function useAuthUi(): AuthUiState {
  const stored = loadStoredPreferences();
  const [locale, setLocaleState] = useState<AppSettings['locale']>(stored.locale ?? 'en-BD');
  const [theme, setTheme] = useState<AppSettings['theme']>(stored.theme ?? 'LIGHT');

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.classList.toggle('dark', theme === 'DARK');
    root.classList.toggle('hc', theme === 'CONTRAST');
    saveStoredPreferences({ ...loadStoredPreferences(), locale, theme });
  }, [locale, theme]);

  const setLocale = useCallback((next: AppSettings['locale']) => setLocaleState(next), []);
  const toggleTheme = useCallback(
    () => setTheme((current) => (current === 'DARK' ? 'LIGHT' : 'DARK')),
    [],
  );

  return {
    locale,
    theme,
    L: (en, bn) => localized(locale, en, bn),
    setLocale,
    toggleTheme,
  };
}

export function AuthLayout({
  ui,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  ui: AuthUiState;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existingRobots?.getAttribute('content') ?? null;
    let createdRobots: HTMLMetaElement | null = null;

    document.title = title.includes(BRAND_NAME) ? title : `${title} — ${BRAND_NAME}`;
    if (existingRobots) {
      existingRobots.setAttribute('content', 'noindex,nofollow');
    } else {
      createdRobots = document.createElement('meta');
      createdRobots.name = 'robots';
      createdRobots.content = 'noindex,nofollow';
      document.head.appendChild(createdRobots);
    }

    return () => {
      document.title = previousTitle;
      if (createdRobots) {
        createdRobots.remove();
      } else if (existingRobots && previousRobots !== null) {
        existingRobots.setAttribute('content', previousRobots);
      }
    };
  }, [title]);

  return (
    <div className="ql-theme ql-auth min-h-screen bg-ql-paper px-4 py-6 text-ql-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/login"
            className="flex min-h-11 items-center gap-2.5 rounded-ql-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ql-focus"
          >
            <span className="flex flex-col gap-1.5">
              <FintuityLogo height={52} className="max-w-[220px]" />
              <span className="block text-[12px] text-ql-ink-muted">
                {ui.L('Finance & tax operating system', 'অর্থ ও কর পরিচালনা ব্যবস্থা')}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => ui.setLocale(ui.locale === 'bn-BD' ? 'en-BD' : 'bn-BD')}
              className="ql-btn ql-btn-secondary min-h-10 px-3 text-[13px]"
              aria-label={`${ui.locale === 'bn-BD' ? 'English' : 'Bangla'} — ${ui.L('switch language', 'ভাষা পরিবর্তন')}`}
            >
              <Globe2 size={15} aria-hidden="true" />
              {ui.locale === 'bn-BD' ? 'English' : 'Bangla'}
            </button>
            <button
              type="button"
              onClick={ui.toggleTheme}
              className="grid h-10 w-10 place-items-center rounded-ql-control border border-ql-border-strong bg-ql-surface text-ql-ink-muted transition hover:border-ql-ink-subtle hover:text-ql-ink"
              aria-label={
                ui.theme === 'DARK'
                  ? ui.L('Use light theme', 'লাইট থিম ব্যবহার করুন')
                  : ui.L('Use dark theme', 'ডার্ক থিম ব্যবহার করুন')
              }
            >
              {ui.theme === 'DARK' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center py-8 lg:py-12">
          <div className={`grid w-full gap-10 ${wide ? 'max-w-5xl' : 'max-w-4xl'} lg:grid-cols-[0.8fr_1.2fr] lg:items-center`}>
            <aside className="hidden lg:block">
              <div className="ql-auth-panel">
                <FintuityMark size={44} title="" className="mb-6 opacity-95" />
                <p className="text-[13px] font-semibold text-white/80">
                  {ui.L('Accounting and finance operations', 'হিসাব ও অর্থ পরিচালনা')}
                </p>
                <h2 className="mt-3 max-w-sm text-[30px] font-semibold leading-[1.12] tracking-[-0.035em]">
                  {ui.L('One reliable place for the books.', 'হিসাবের জন্য এক নির্ভরযোগ্য জায়গা।')}
                </h2>
                <p className="ql-auth-panel-muted mt-3 max-w-sm text-[14px] leading-6">
                  {ui.L(
                    'Company-scoped access, server-checked approvals and an append-only audit log. No demo data in a real company.',
                    'কোম্পানি-সীমাবদ্ধ প্রবেশ, সার্ভারে যাচাইকৃত অনুমোদন ও কেবল-সংযোজনযোগ্য অডিট লগ। প্রকৃত কোম্পানিতে ডেমো ডেটা নেই।',
                  )}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {[
                    ui.L('Server-verified session', 'সার্ভার-যাচাইকৃত সেশন'),
                    ui.L('Role and company membership checks', 'ভূমিকা ও কোম্পানি সদস্যপদ যাচাই'),
                    ui.L('HTTP-only cookies and CSRF protection', 'এইচটিটিপি-অনলি কুকি ও সিএসআরএফ সুরক্ষা'),
                  ].map((item) => (
                    <li key={item} className="ql-auth-panel-muted flex items-start gap-2 text-[13px] leading-6">
                      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#7fe8dd]" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <div className={`w-full ${wide ? 'lg:max-w-2xl' : 'lg:max-w-md'} lg:justify-self-end`}>
              <div className="relative overflow-hidden rounded-ql border border-ql-border bg-ql-surface p-6 shadow-ql-card sm:p-8">
                <div className="absolute inset-x-0 top-0 h-1 ql-brand-gradient" aria-hidden="true" />
                <div className="mb-6">
                  <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ql-ink">
                    {title}
                  </h1>
                  <p className="mt-2 text-[14px] leading-6 text-ql-ink-muted">{subtitle}</p>
                </div>
                {children}
              </div>
              {footer ? <div className="mt-5 text-center text-[13px] text-ql-ink-muted">{footer}</div> : null}
            </div>
          </div>
        </main>

        <footer className="flex flex-col gap-2 border-t border-ql-border pt-4 text-[13px] text-ql-ink-subtle sm:flex-row sm:items-center sm:justify-between">
          <span>{ui.L('Bangladesh · BDT · Asia/Dhaka', 'বাংলাদেশ · বিডিটি · এশিয়া/ঢাকা')}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{ui.L('Need access? Ask your organisation owner.', 'প্রবেশ দরকার? প্রতিষ্ঠানের মালিককে বলুন।')}</span>
            <a href="/#contact" className="ql-link text-[13px]">
              {ui.L('Contact', 'যোগাযোগ')}
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <div className="ql-alert ql-alert-danger mb-4" role="alert">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-ql-danger" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AuthSuccess({ message }: { message: string }) {
  return (
    <div className="ql-alert ql-alert-success mb-4" role="status">
      <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ql-success" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="ql-label">{label}</span>
      {children}
      {hint ? <span className="ql-hint">{hint}</span> : null}
    </label>
  );
}
