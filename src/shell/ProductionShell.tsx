// LedgerVault — production authenticated shell.
//
// The shell owns navigation, the role-aware frame and the company context. Every screen is a lazy
// route chunk; the legacy demo workspaces are not imported here at all. Permissions are checked
// again on the server for every read and write; this layer only avoids opening an obviously
// forbidden screen.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Scale, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { usePreferences } from '../preferences/AppPreferences';
import { AppPreferencesProvider } from '../preferences/AppPreferences';
import { AppSidebar } from './AppSidebar';
import { AppTopBar } from './AppTopBar';
import { AppToastStack } from './AppToastStack';
import { CommandPalette } from './CommandPalette';
import { BRAND_NAME } from '../components/brand/FintuityBrand';
import { NotFoundPage, PermissionDeniedPage, RouteErrorBoundary, RouteLoading } from './RouteStates';
import {
  canAccessSection,
  resolveNavigationPath,
  type SectionKey,
} from './navigation';

const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const SalesPage = lazy(() => import('../pages/sales/SalesPage'));
const PurchasesPage = lazy(() => import('../pages/purchases/PurchasesPage'));
const BankingPage = lazy(() => import('../pages/banking/BankingPage'));
const TreasuryPage = lazy(() => import('../pages/treasury/TreasuryPage'));
const LedgerPage = lazy(() => import('../pages/ledger/LedgerPage'));
const InventoryPage = lazy(() => import('../pages/inventory/InventoryPage'));
const MasterDataPage = lazy(() => import('../pages/masters/MasterDataPage'));
const ReportsPage = lazy(() => import('../pages/reports/ReportsPage'));
const ClosePage = lazy(() => import('../pages/close/ClosePage'));
const AuditLogPage = lazy(() => import('../pages/audit/AuditLogPage'));
const CompanySetupPage = lazy(() => import('../pages/setup/CompanySetupPage'));
const TeamAccessPage = lazy(() => import('../pages/TeamAccessPage'));
const AccountPage = lazy(() => import('../pages/AccountPage'));

const PAGES: Record<SectionKey, LazyExoticComponent<ComponentType>> = {
  HOME: DashboardPage,
  SALES: SalesPage,
  PURCHASES: PurchasesPage,
  BANKING: BankingPage,
  TREASURY: TreasuryPage,
  LEDGER: LedgerPage,
  INVENTORY: InventoryPage,
  MASTERS: MasterDataPage,
  REPORTS: ReportsPage,
  CLOSE: ClosePage,
  AUDIT: AuditLogPage,
  SETUP: CompanySetupPage,
  TEAM: TeamAccessPage,
  ACCOUNT: AccountPage,
};

const RAIL_KEY = 'ledgervault.v2.nav.rail';

function readRail(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function ProductionShellContent() {
  const auth = useAuth();
  const { locale, publishToast } = usePreferences();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [rail, setRail] = useState<boolean>(readRail);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);

  const resolved = resolveNavigationPath(location.pathname);
  const section = resolved?.section ?? null;
  const SectionPage = section ? PAGES[section.key] : null;
  const allowed = section ? canAccessSection(section, auth) : false;

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const title = section ? `${L(section.labelEn, section.labelBn)} · ${BRAND_NAME}` : BRAND_NAME;
    document.title = title;
  }, [location.pathname, section, L]);

  useEffect(() => {
    const requested = searchParams.get('company');
    if (!requested || requested === auth.activeCompany?.id) return;
    if (!auth.companies.some((company) => company.id === requested)) return;
    void auth.selectCompany(requested).catch((error) => {
      publishToast({
        tone: 'error',
        title: L('Company could not be opened', 'কোম্পানি খোলা যায়নি'),
        message: error instanceof Error ? error.message : L('The requested company is not available.', 'অনুরোধকৃত কোম্পানি উপলব্ধ নয়।'),
      });
    });
  }, [auth, L, publishToast, searchParams]);

  const toggleRail = useCallback(() => {
    setRail((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        // The preference simply resets on the next visit.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleRail();
      } else if (event.key === 'Escape') {
        setNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  const main = useMemo(() => {
    if (resolved?.redirectTo) {
      return <Navigate to={resolved.redirectTo} replace />;
    }
    if (!section || !SectionPage) {
      return <NotFoundPage pathname={location.pathname} />;
    }
    if (!allowed) {
      return <PermissionDeniedPage sectionLabel={L(section.labelEn, section.labelBn)} />;
    }
    return (
      <RouteErrorBoundary
        key={section.key}
        title={L('This screen could not be displayed', 'এই স্ক্রিনটি দেখানো যায়নি')}
        message={L(
          'No financial action was submitted by this screen. Reload the page. If the problem continues, contact your administrator with the time it happened.',
          'এই স্ক্রিন কোনো আর্থিক কার্যক্রম জমা দেয়নি। পৃষ্ঠাটি পুনরায় লোড করুন। সমস্যা চলতে থাকলে সময়সহ আপনার প্রশাসকের সাথে যোগাযোগ করুন।',
        )}
        reloadLabel={L('Reload page', 'পৃষ্ঠা পুনরায় লোড')}
      >
        <Suspense fallback={<RouteLoading label={L('Loading', 'লোড হচ্ছে')} />}>
          <SectionPage />
        </Suspense>
      </RouteErrorBoundary>
    );
  }, [SectionPage, allowed, L, location.pathname, resolved, section]);

  return (
    <div className="ql-theme ql-app min-h-screen bg-ql-paper text-ql-ink">
      <a href="#main-content" className="ql-skip-link">
        {L('Skip to main content', 'মূল বিষয়বস্তুতে যান')}
      </a>
      <div className="flex min-h-screen">
        <AppSidebar
          currentPath={location.pathname}
          mobileOpen={navOpen}
          rail={rail}
          onClose={() => setNavOpen(false)}
          onToggleRail={toggleRail}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        {navOpen ? (
          <button
            type="button"
            aria-label={L('Close navigation overlay', 'নেভিগেশন ওভারলে বন্ধ করুন')}
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-[45] bg-ql-ink/40 lg:hidden"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopBar currentPath={location.pathname} onOpenMenu={() => setNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
          <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-5 sm:px-5 lg:px-8">
            {main}
          </main>
          <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 border-t border-ql-border px-3 py-4 text-[12px] text-ql-ink-muted sm:px-5 lg:px-8">
            <span className="flex items-center gap-2">
              <ShieldCheck size={14} aria-hidden className="text-ql-brand" />
              {L(
                'Server-backed records · company-scoped access · posted entries are immutable',
                'সার্ভার-ভিত্তিক রেকর্ড · কোম্পানি-সীমাবদ্ধ প্রবেশ · পোস্টকৃত এন্ট্রি অপরিবর্তনীয়',
              )}
            </span>
            <span className="flex items-center gap-2">
              <Scale size={14} aria-hidden />
              {L(
                'Management accounts only · statutory outputs remain drafts until professional review',
                'শুধুমাত্র ব্যবস্থাপনা হিসাব · পেশাদার পর্যালোচনা পর্যন্ত সংবিধিবদ্ধ আউটপুট খসড়া',
              )}
            </span>
          </footer>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AppToastStack />
    </div>
  );
}

export default function ProductionShell() {
  return (
    <AppPreferencesProvider>
      <ProductionShellContent />
    </AppPreferencesProvider>
  );
}
