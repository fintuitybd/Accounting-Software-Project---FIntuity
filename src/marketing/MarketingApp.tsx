import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, X } from './icons';
import { BRAND_NAME, FintuityLoader, FintuityLogo } from '../components/brand/FintuityBrand';
import { marketingCopy, text, type LocalizedText, type MarketingLocale } from './content';
import './marketing.css';
import LandingPage from './pages/LandingPage';

// The landing page is the first paint. Secondary pages, including the internal design gallery,
// are fetched only when visited so a visitor does not download the component gallery or the
// legal/security copy to read the home page.
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export interface MarketingUi {
  locale: MarketingLocale;
  setLocale: (locale: MarketingLocale) => void;
  t: (value: LocalizedText) => string;
}

export const MarketingUiContext = createContext<MarketingUi | null>(null);
const LOCALE_KEY = 'fintuity.marketing.locale';

export function useMarketingUi(): MarketingUi {
  const value = useContext(MarketingUiContext);
  if (!value) throw new Error('useMarketingUi must be used inside MarketingApp.');
  return value;
}

function readLocale(): MarketingLocale {
  if (typeof window === 'undefined') return 'en-BD';
  try {
    return window.localStorage.getItem(LOCALE_KEY) === 'bn-BD' ? 'bn-BD' : 'en-BD';
  } catch {
    return 'en-BD';
  }
}

export default function MarketingApp() {
  const [locale, setLocaleState] = useState<MarketingLocale>(readLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // The choice simply resets next visit.
    }
  }, [locale]);

  const value = useMemo<MarketingUi>(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: (copy) => text(copy, locale),
    }),
    [locale],
  );

  return (
    <MarketingUiContext.Provider value={value}>
      <BrowserRouter>
        <MarketingShell>
          <Suspense fallback={<MarketingLoading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/legal" element={<LegalPage />} />
              <Route path="/design" element={<DesignSystemPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </MarketingShell>
      </BrowserRouter>
    </MarketingUiContext.Provider>
  );
}

function MarketingShell({ children }: { children: ReactNode }) {
  const { t } = useMarketingUi();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        window.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.hash]);

  const links = [
    { href: '/#product', label: t(marketingCopy.nav.product) },
    { href: '/#workflows', label: t(marketingCopy.nav.workflows) },
    { href: '/#capabilities', label: t(marketingCopy.nav.capabilities) },
    { href: '/security', label: t(marketingCopy.nav.security) },
    { href: '/#faq', label: t(marketingCopy.nav.faq) },
  ];

  return (
    <div className="mkt-root ql-theme">
      <a href="#main-content" className="ql-skip-link">
        {t({
          en: 'Skip to main content',
          bn: 'মূল বিষয়বস্তুতে যান',
        })}
      </a>
      <header className="mkt-header">
        <div className="mkt-container flex min-h-[72px] items-center justify-between gap-4">
          <Link to="/" className="flex min-h-11 items-center gap-2.5" aria-label={`${BRAND_NAME} home`}>
            <FintuityLogo height={52} className="max-w-[220px]" />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {links.map((link) =>
              link.href.startsWith('/#') ? (
                <a key={link.href} href={link.href} className="mkt-nav-link">
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} to={link.href} className="mkt-nav-link">
                  {link.label}
                </Link>
              ),
            )}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <LanguageButton />
            <a href="/login" className="ql-btn ql-btn-secondary ql-btn-sm">
              {t(marketingCopy.actions.signIn)}
            </a>
            <a href="/#contact" className="ql-btn ql-btn-primary ql-btn-sm">
              {t(marketingCopy.actions.requestDemo)}
            </a>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <LanguageButton />
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-ql-control border border-ql-border-strong bg-ql-surface text-ql-ink"
              aria-expanded={menuOpen}
              aria-controls="marketing-mobile-nav"
              aria-label={menuOpen ? t(marketingCopy.actions.closeMenu) : t(marketingCopy.actions.openMenu)}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div id="marketing-mobile-nav" className="border-t border-ql-border lg:hidden">
            <nav className="mkt-container flex flex-col py-3" aria-label="Mobile">
              {links.map((link) =>
                link.href.startsWith('/#') ? (
                  <a key={link.href} href={link.href} className="mkt-nav-link">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} to={link.href} className="mkt-nav-link">
                    {link.label}
                  </Link>
                ),
              )}
              <div className="mt-3 grid gap-2 border-t border-ql-border pt-3">
                <a href="/login" className="ql-btn ql-btn-secondary w-full">
                  {t(marketingCopy.actions.signIn)}
                </a>
                <a href="/#contact" className="ql-btn ql-btn-primary w-full">
                  {t(marketingCopy.actions.requestDemo)}
                </a>
              </div>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="main-content">{children}</main>

      <footer className="mkt-footer">
        <div className="mkt-container">
          <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <FintuityLogo height={44} className="max-w-[180px]" />
              <p className="mkt-small mt-3 max-w-sm">{t(marketingCopy.footer.line)}</p>
              <p className="mkt-small mt-3 max-w-sm">{t(marketingCopy.footer.disclaimer)}</p>
            </div>
            <FooterColumn title={t(marketingCopy.footer.product)}>
              <a href="/#workflows">{t(marketingCopy.footer.workflows)}</a>
              <a href="/#capabilities">{t(marketingCopy.footer.capabilities)}</a>
              <a href="/#bangladesh">{t(marketingCopy.footer.bangladesh)}</a>
              <a href="/#controls">{t(marketingCopy.footer.controls)}</a>
              <a href="/#faq">{t(marketingCopy.footer.faq)}</a>
            </FooterColumn>
            <FooterColumn title={t(marketingCopy.footer.company)}>
              <Link to="/security">{t(marketingCopy.footer.security)}</Link>
              <Link to="/legal">{t(marketingCopy.footer.legal)}</Link>
              <a href="/#contact">{t(marketingCopy.footer.contact)}</a>
              <a href="/login">{t(marketingCopy.footer.signIn)}</a>
            </FooterColumn>
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-ql-border pt-5 text-[13px] text-ql-ink-subtle sm:flex-row sm:items-center sm:justify-between">
            <span>{BRAND_NAME} · Bangladesh</span>
            <span>
              {t({
                en: 'Built for BDT, Bangla and English. Statutory outputs require professional review.',
                bn: 'বিডিটি, বাংলা ও ইংরেজির জন্য তৈরি। সংবিধিবদ্ধ আউটপুটে পেশাদার পর্যালোচনা প্রয়োজন।',
              })}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function MarketingLoading() {
  const { locale } = useMarketingUi();
  return (
    <div className="mkt-container mkt-section">
      <FintuityLoader
        size={42}
        label="Loading page…"
        labelBn="পৃষ্ঠা লোড হচ্ছে…"
        locale={locale}
      />
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-ql-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function LanguageButton() {
  const { locale, setLocale, t } = useMarketingUi();
  const visible = t(marketingCopy.actions.switchLanguage);
  const label = t(marketingCopy.actions.switchLanguageLabel);
  return (
    <button
      type="button"
      className="ql-btn ql-btn-ghost min-h-11 px-3 text-[13px]"
      onClick={() => setLocale(locale === 'bn-BD' ? 'en-BD' : 'bn-BD')}
      /* Include the visible label so speech-control users can say what they see. */
      aria-label={`${visible} — ${label}`}
    >
      {visible}
    </button>
  );
}
