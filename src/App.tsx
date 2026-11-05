// LedgerVault — application shell.
//
// A calm operating-system frame around twelve financial workspaces: a persistent (and collapsible)
// navigation rail, a single floating control bar, the onboarding/access modal, the command palette
// and a restrained toast stack. All financial logic remains behind `VaultContext`; this file only
// routes between screens and decides which screens own their masthead.

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Hash,
  Info,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';

import { localized, monthYearLabel } from './core/i18n';
import { formatDate } from './core/money';
import { useVault, VaultProvider } from './context/VaultContext';
import type { AppSettings, ToastMessage } from './core/types';
import { CommandPalette } from './components/layout/CommandPalette';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { WorkspaceNavProvider } from './components/layout/WorkspaceNav';
import { AuthAndOnboardingModal } from './components/auth/AuthAndOnboardingModal';
import { MasterDataModal } from './components/modals/MasterDataModal';
import {
  WORKSPACE_BY_KEY,
  WORKSPACE_GROUPS,
  WORKSPACES,
  workspaceForShortcut,
  type WorkspaceKey,
} from './workspaces/registry';
import W01_ExecutiveCockpit from './workspaces/W01_ExecutiveCockpit';
import W02_SalesMushak63 from './workspaces/W02_SalesMushak63';
import W03_PurchasesWithholding from './workspaces/W03_PurchasesWithholding';
import W04_TreasuryChallans66 from './workspaces/W04_TreasuryChallans66';
import W05_VatRegisters91 from './workspaces/W05_VatRegisters91';
import W06_BankingMfsReconcile from './workspaces/W06_BankingMfsReconcile';
import W07_MassImportExportStudio from './workspaces/W07_MassImportExportStudio';
import W08_IfrsStatementsStudio from './workspaces/W08_IfrsStatementsStudio';
import W09_CloseAndControl from './workspaces/W09_CloseAndControl';
import W10_PayrollLabourSuite from './workspaces/W10_PayrollLabourSuite';
import W11_SecretarialGovernance from './workspaces/W11_SecretarialGovernance';
import W12_RulePackAndCoreLab from './workspaces/W12_RulePackAndCoreLab';

const WORKSPACE_VIEWS: Record<WorkspaceKey, ComponentType> = {
  W01: W01_ExecutiveCockpit,
  W02: W02_SalesMushak63,
  W03: W03_PurchasesWithholding,
  W04: W04_TreasuryChallans66,
  W05: W05_VatRegisters91,
  W06: W06_BankingMfsReconcile,
  W07: W07_MassImportExportStudio,
  W08: W08_IfrsStatementsStudio,
  W09: W09_CloseAndControl,
  W10: W10_PayrollLabourSuite,
  W11: W11_SecretarialGovernance,
  W12: W12_RulePackAndCoreLab,
};

/** These screens render their own kiosk masthead — the shell must not add a second one. */
const OWNS_MASTHEAD = new Set<WorkspaceKey>(['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W12']);

const BOOK_OPTIONS: Array<{ value: AppSettings['bookFilter']; en: string; bn: string }> = [
  { value: 'STATUTORY_BD', en: 'Statutory BD', bn: 'বিডি সংবিধিবদ্ধ' },
  { value: 'ALL_IFRS_BOOKS', en: 'All IFRS books', bn: 'সব আইএফআরএস বই' },
  { value: 'TAX_COMPUTATION', en: 'Tax computation', bn: 'কর হিসাব' },
];

const RAIL_KEY = 'ledgervault.v2.nav.rail';

function readRail(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App({ initialView = 'W01' }: { initialView?: WorkspaceKey } = {}) {
  return (
    <VaultProvider>
      <ErpShell initialView={initialView} />
    </VaultProvider>
  );
}

function ErpShell({ initialView = 'W01' }: { initialView?: WorkspaceKey } = {}) {
  const vault = useVault();
  const [view, setView] = useState<WorkspaceKey>(initialView);
  const [navOpen, setNavOpen] = useState(false);
  const [rail, setRail] = useState<boolean>(readRail);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mastersOpen, setMastersOpen] = useState(false);
  const [authView, setAuthView] = useState<'ACCESS' | 'ONBOARDING' | null>(null);

  const L = useCallback((en: string, bn: string) => localized(vault.locale, en, bn), [vault.locale]);
  const current = WORKSPACE_BY_KEY[view] ?? WORKSPACES[0];
  const group = WORKSPACE_GROUPS.find((entry) => entry.key === current.group);
  const ActiveWorkspace = WORKSPACE_VIEWS[view] ?? W01_ExecutiveCockpit;
  const bookLabel = BOOK_OPTIONS.find((option) => option.value === vault.bookFilter) ?? BOOK_OPTIONS[1];
  const WorkspaceIcon = current.icon;
  const hasOwnMasthead = OWNS_MASTHEAD.has(view);

  useEffect(() => {
    setNavOpen(false);
    // Every workspace opens at its own masthead rather than inheriting the previous scroll depth.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setRail((value) => {
          const next = !value;
          try {
            window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
          } catch {
            // The choice simply resets next visit.
          }
          return next;
        });
        return;
      }
      const shortcut = workspaceForShortcut(event);
      if (shortcut) {
        event.preventDefault();
        setView(shortcut);
        return;
      }
      if (event.key === 'Escape') {
        setNavOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleRail = useCallback(() => {
    setRail((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        // The choice simply resets next visit.
      }
      return next;
    });
  }, []);

  const navigate = useCallback((key: WorkspaceKey) => {
    setView(key);
    setNavOpen(false);
  }, []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openCreate = useCallback(() => setView('W02'), []);
  const navValue = useMemo(() => ({ navigate, openPalette, openCreate }), [navigate, openPalette, openCreate]);

  const motionDuration = vault.motionTier === 'OFF' ? 0 : vault.motionTier === 'LITE' ? 0.16 : 0.28;

  return (
    <WorkspaceNavProvider value={navValue}>
      <div className="min-h-screen bg-canvas text-ink-900">
        <div className="flex min-h-screen">
          <Sidebar
            active={view}
            mobileOpen={navOpen}
            rail={rail}
            onToggleRail={toggleRail}
            onClose={() => setNavOpen(false)}
            onOpenPalette={openPalette}
            onNavigate={navigate}
          />

          {navOpen && (
            <button
              type="button"
              aria-label={L('Close navigation overlay', 'নেভিগেশন ওভারলে বন্ধ করুন')}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-[45] bg-ink-950/50 backdrop-blur-sm lg:hidden"
            />
          )}

          <div className="min-w-0 flex-1">
            <TopBar
              rail={rail}
              onToggleRail={toggleRail}
              onOpenMenu={() => setNavOpen(true)}
              onOpenPalette={openPalette}
              onOpenMasters={() => setMastersOpen(true)}
              onOpenOnboarding={() => setAuthView('ONBOARDING')}
              onOpenAccess={() => setAuthView('ACCESS')}
            />

            <main className="mx-auto w-full max-w-[1600px] px-3 pb-16 pt-3 sm:px-4 lg:px-6">
              {vault.mode === 'GUIDED' && (
                <GuidedBanner
                  textEn={current.guide_en}
                  textBn={current.guide_bn}
                  labelEn={current.label_en}
                  labelBn={current.label_bn}
                  onSwitchPro={() => vault.setMode('PRO')}
                />
              )}

              {!hasOwnMasthead && (
                <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="brand-gradient mt-0.5 hidden h-11 w-11 shrink-0 place-items-center rounded-[14px] text-white shadow-lift ring-1 ring-white/20 sm:grid">
                      <WorkspaceIcon size={19} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0">
                      <nav className="inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-surface/70 px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-[0.13em] text-ink-400 shadow-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                        <span>{L(group?.label_en ?? '', group?.label_bn ?? '')}</span>
                        <ChevronRight size={9} className="text-ink-300" />
                        <span className="font-mono tracking-[0.06em] text-brand-bright">{current.code}</span>
                      </nav>
                      <h1 className="mt-2.5 text-[27px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink-900 text-balance sm:text-[32px]">
                        {L(current.label_en, current.label_bn)}
                      </h1>
                      <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-ink-500">
                        {L(current.hint_en, current.hint_bn)}
                        <span className="mx-1.5 text-ink-300">·</span>
                        {monthYearLabel(vault.statements.period.start, vault.locale)}
                        <span className="mx-1.5 text-ink-300">·</span>
                        {L(bookLabel.en, bookLabel.bn)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`lv-chip ${
                        vault.statements.balance_sheet.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'
                      }`}
                    >
                      <Scale size={11} />
                      {vault.statements.balance_sheet.balanced
                        ? L('Balanced to 0 poisha', '০ পয়সায় সুষম')
                        : L('Out of balance', 'অসুষম')}
                    </span>
                    <span className="lv-chip lv-chip-neutral">
                      <Hash size={11} />
                      <span className="font-money">
                        {vault.auditChain.checkedCount} {L('journals sealed', 'জার্নাল সিল')}
                      </span>
                    </span>
                    <span className="lv-chip lv-chip-gold">
                      <ShieldCheck size={11} />
                      {vault.tenant.fiscal_year_label}
                    </span>
                    <span className="lv-chip lv-chip-neutral">
                      <span className="font-mono">{formatDate('2026-11-02', vault.locale)}</span>
                    </span>
                  </div>
                </header>
              )}

              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: vault.motionTier === 'OFF' ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: vault.motionTier === 'OFF' ? 0 : -6 }}
                  transition={{ duration: motionDuration, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ActiveWorkspace />
                </motion.div>
              </AnimatePresence>

              <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-4 text-[9px] text-ink-400">
                <span className="flex items-center gap-2">
                  <ShieldCheck size={11} className={vault.auditChain.valid ? 'text-emerald-500' : 'text-rose-500'} />
                  {L(
                    'Deterministic ledger · SHA-256 audit chain · BigInt poisha',
                    'নির্ধারিত লেজার · SHA-256 অডিট চেইন · বিগইন্ট পয়সা',
                  )}
                </span>
                <span className="font-mono uppercase tracking-[0.12em]">
                  {L('BD 2026 · decision support only', 'বিডি ২০২৬ · শুধু সিদ্ধান্ত সহায়তা')}
                </span>
              </footer>
            </main>
          </div>
        </div>

        <ToastStack />
        <MasterDataModal open={mastersOpen} onClose={() => setMastersOpen(false)} />
        <AuthAndOnboardingModal
          open={authView !== null}
          initialView={authView ?? 'ACCESS'}
          onClose={() => setAuthView(null)}
        />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />
      </div>
    </WorkspaceNavProvider>
  );
}

function GuidedBanner({
  textEn,
  textBn,
  labelEn,
  labelBn,
  onSwitchPro,
}: {
  textEn: string;
  textBn: string;
  labelEn: string;
  labelBn: string;
  onSwitchPro: () => void;
}) {
  const vault = useVault();
  const L = (en: string, bn: string): string => localized(vault.locale, en, bn);
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: vault.motionTier === 'OFF' ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="relative mb-3 overflow-hidden rounded-2xl border border-line/80 bg-surface/80 shadow-sm backdrop-blur-sm"
    >
      <span className="brand-gradient absolute inset-y-0 left-0 w-[3px]" />
      <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-gold-500/[0.06] blur-3xl" />
      <div className="relative flex flex-wrap items-start gap-3 px-4 py-3">
        <span className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-white shadow-lift ring-1 ring-white/20">
          <Sparkles size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[8.5px] font-bold uppercase tracking-[0.16em] text-brand-bright">
            {L('Guided mode · plain English', 'নির্দেশিত মোড · সহজ ভাষা')}
            <span className="rounded-full bg-vault-50 px-1.5 py-0.5 font-mono text-[8px] font-semibold normal-case tracking-[0.02em] text-vault-600 dark:bg-vault-500/10 dark:text-vault-300">
              {L(labelEn, labelBn)}
            </span>
          </p>
          <p className="mt-1 max-w-4xl text-[11.5px] font-medium leading-relaxed text-ink-800">{L(textEn, textBn)}</p>
          <p className="mt-0.5 text-[9.5px] text-ink-500">
            {L(
              'Pro mode compacts tables, reveals account codes and removes the helper copy.',
              'প্রো মোড টেবিল সংকুচিত করে, হিসাব কোড দেখায় এবং সহায়ক লেখা সরিয়ে দেয়।',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchPro}
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line/80 bg-surface px-2.5 py-1.5 text-[10px] font-semibold text-ink-700 shadow-sm transition hover:border-line-strong hover:text-ink-900"
        >
          {L('Try Pro mode', 'প্রো মোড দেখুন')}
          <ArrowRight size={11} className="transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </motion.div>
  );
}

const TOAST_TONE: Record<
  ToastMessage['tone'],
  { icon: typeof CheckCircle2; ring: string; bar: string; iconColor: string; title: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-emerald-500/25',
    bar: 'bg-emerald-500',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    title: 'text-ink-900',
  },
  warning: {
    icon: TriangleAlert,
    ring: 'border-amber-500/30',
    bar: 'bg-amber-500',
    iconColor: 'text-amber-600 dark:text-amber-400',
    title: 'text-ink-900',
  },
  error: {
    icon: CircleAlert,
    ring: 'border-rose-500/30',
    bar: 'bg-rose-500',
    iconColor: 'text-rose-600 dark:text-rose-400',
    title: 'text-ink-900',
  },
  info: {
    icon: Info,
    ring: 'border-line',
    bar: 'bg-ink-400',
    iconColor: 'text-ink-500',
    title: 'text-ink-900',
  },
};

function ToastStack() {
  const { toasts, dismissToast, locale } = useVault();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const tone = TOAST_TONE[toast.tone] ?? TOAST_TONE.info;
          const Icon = tone.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.97 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className={`glass-panel pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-2xl border px-3.5 py-3 ${tone.ring}`}
              role="status"
            >
              <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`} />
              <Icon size={15} className={`mt-0.5 shrink-0 ${tone.iconColor}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-[12px] font-semibold leading-snug ${tone.title}`}>{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{toast.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 rounded-md p-0.5 text-ink-400 transition hover:text-ink-800"
                aria-label={localized(locale, 'Dismiss notification', 'বিজ্ঞপ্তি বন্ধ করুন')}
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
