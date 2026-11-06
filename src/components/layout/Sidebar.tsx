// LedgerVault — persistent workspace sidebar.
//
// The Lumen navigation rail: a porcelain column with a gradient identity tile, a deep-space tenant
// card, four quiet module groups and live exception badges. On desktop it collapses to an 84px icon
// rail (persisted by the shell); on mobile it becomes a full-height drawer. Every row keeps its
// keyboard jump, bilingual label and live queue badge.

import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileBarChart,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings2,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  UserCog,
  X,
} from 'lucide-react';

import { localized } from '../../core/i18n';
import { RULE_PACK_VERSION } from '../../core/tax-engine/rulePack';
import { useVault } from '../../context/VaultContext';
import { useAuth } from '../../auth/AuthContext';
import { BrandMark } from '../brand/BrandMark';
import {
  WORKSPACE_GROUPS,
  entityTypeLabel,
  workspacesInGroup,
  type WorkspaceGroupKey,
  type WorkspaceKey,
} from '../../workspaces/registry';

const COLLAPSE_KEY = 'ledgervault.v2.nav.collapsed';

interface SidebarBadge {
  count: number;
  tone: 'amber' | 'rose' | 'emerald' | 'neutral';
  label: string;
}

const BADGE_TONE: Record<SidebarBadge['tone'], string> = {
  amber: 'bg-amber-500/12 text-amber-700 ring-amber-600/20 dark:text-amber-300 dark:ring-amber-400/25',
  rose: 'bg-rose-500/12 text-rose-700 ring-rose-600/20 dark:text-rose-300 dark:ring-rose-400/25',
  emerald: 'bg-emerald-500/12 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25',
  neutral: 'bg-ink-100 text-ink-600 ring-line dark:text-ink-300',
};

const RAIL_DOT: Record<SidebarBadge['tone'], string> = {
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  emerald: 'bg-emerald-500',
  neutral: 'bg-ink-400',
};

function readCollapsed(): Partial<Record<WorkspaceGroupKey, boolean>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export interface SidebarProps {
  active: WorkspaceKey;
  mobileOpen: boolean;
  rail: boolean;
  onToggleRail: () => void;
  onClose: () => void;
  onOpenPalette: () => void;
  onNavigate: (key: WorkspaceKey) => void;
}

export function Sidebar({
  active,
  mobileOpen,
  rail,
  onToggleRail,
  onClose,
  onOpenPalette,
  onNavigate,
}: SidebarProps) {
  const vault = useVault();
  const auth = useAuth();
  const location = useLocation();
  const { tenant, locale, motionTier } = vault;
  const isBn = locale === 'bn-BD';
  const L = useCallback((en: string, bn: string): string => localized(locale, en, bn), [locale]);
  const [collapsed, setCollapsed] = useState<Partial<Record<WorkspaceGroupKey, boolean>>>(readCollapsed);

  const badges = useMemo<Partial<Record<WorkspaceKey, SidebarBadge>>>(() => {
    const pendingChallans = vault.challans.filter(
      (challan) => challan.status === 'PENDING' || challan.status === 'BATCHED',
    ).length;
    const unmatchedLines = vault.statementLines.filter((line) => line.status === 'UNMATCHED').length;
    const openInvoices = vault.commercialDocs.filter(
      (doc) => doc.doc_type === 'SALES_INVOICE' && doc.status === 'POSTED',
    ).length;
    const pendingCertificates = vault.vdsCertificates.filter((cert) => cert.status === 'PENDING').length;
    const expiringLicences = vault.statutoryRecords.filter(
      (record) => record.status === 'EXPIRING' || record.status === 'EXPIRED',
    ).length;
    const controlGaps =
      vault.reconciliation.rows.filter((row) => !row.reconciled).length + vault.reconciliation.open_item_count;
    const committedBatches = vault.importBatches.filter((batch) => batch.status === 'COMMITTED').length;

    const result: Partial<Record<WorkspaceKey, SidebarBadge>> = {};
    if (openInvoices > 0) result.W02 = { count: openInvoices, tone: 'emerald', label: L('open invoices', 'খোলা চালান') };
    if (pendingCertificates > 0) result.W03 = { count: pendingCertificates, tone: 'amber', label: L('VDS certificates pending', 'ভিডিএস সনদ বাকি') };
    if (pendingChallans > 0) result.W04 = { count: pendingChallans, tone: 'amber', label: L('challans awaiting deposit', 'চালান জমার অপেক্ষায়') };
    if (unmatchedLines > 0) result.W06 = { count: unmatchedLines, tone: 'rose', label: L('unreconciled bank lines', 'অমিলিত ব্যাংক লাইন') };
    if (committedBatches > 0) result.W07 = { count: committedBatches, tone: 'neutral', label: L('committed batches', 'কমিট ব্যাচ') };
    if (controlGaps > 0) result.W09 = { count: controlGaps, tone: 'rose', label: L('control gaps', 'নিয়ন্ত্রণ ঘাটতি') };
    if (expiringLicences > 0) result.W11 = { count: expiringLicences, tone: 'amber', label: L('licences expiring', 'মেয়াদোত্তীর্ণ লাইসেন্স') };
    if (!vault.auditChain.valid) result.W12 = { count: 1, tone: 'rose', label: L('audit chain broken', 'অডিট চেইন ভাঙা') };
    return result;
    // `vault` re-renders on every ledger action; the derived counts are intentionally cheap.
  }, [vault, L]);

  const toggleGroup = (key: WorkspaceGroupKey): void => {
    setCollapsed((current) => {
      const next = { ...current, [key]: !current[key] };
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // Private mode — the section simply re-opens on the next visit.
      }
      return next;
    });
  };

  const initials = tenant.name_en
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  const pendingChallans = badges.W04?.count ?? 0;
  const navEase: [number, number, number, number] = [0.16, 1, 0.3, 1];
  const duration = motionTier === 'OFF' ? 0 : 0.22;

  return (
    <aside
      aria-label={L('Workspace navigation', 'ওয়ার্কস্পেস নেভিগেশন')}
      className={`fixed inset-y-0 left-0 z-50 flex w-[288px] flex-col border-r border-line/80 bg-[rgb(var(--lv-sidebar))] transition-[width,transform] duration-300 ease-out-expo lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-white/[0.06] ${
        rail ? 'lg:w-[84px]' : 'lg:w-[288px]'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="h-1 w-full shrink-0 ql-brand-gradient" aria-hidden="true" />
      {/* A single soft aurora wash, not a pattern — keeps the rail calm. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-[-120px] h-[320px] w-[320px] rounded-full opacity-60 blur-3xl dark:opacity-40"
        style={{ background: 'radial-gradient(circle, rgba(0,176,160,.18), transparent 68%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-28 bottom-[-140px] h-[300px] w-[300px] rounded-full opacity-50 blur-3xl dark:opacity-30"
        style={{ background: 'radial-gradient(circle, rgba(0,45,96,.16), transparent 68%)' }}
      />

      {/* Identity ------------------------------------------------------------------------- */}
      <div
        className={`relative flex items-center gap-2.5 px-4 pb-3.5 pt-4 ${
          rail ? 'lg:flex-col lg:gap-2 lg:px-0' : ''
        }`}
      >
        <BrandMark size={40} />
        <div className={`min-w-0 flex-1 ${rail ? 'lg:hidden' : ''}`}>
          <p className="truncate text-[14px] font-semibold leading-tight tracking-[-0.03em] text-ink-900">
            Fintuity Accounting Suite
          </p>
          <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            {L('Finance & tax OS', 'ফিন্যান্স ও ট্যাক্স ওএস')}
          </p>
        </div>
        <span
          className={`rounded-full border border-line bg-surface-2/80 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-ink-400 ${
            rail ? 'lg:hidden' : ''
          }`}
        >
          v2.6
        </span>
        <button
          type="button"
          onClick={onToggleRail}
          aria-label={rail ? L('Expand navigation', 'নেভিগেশন প্রসারিত করুন') : L('Collapse navigation', 'নেভিগেশন সংকুচিত করুন')}
          title={rail ? L('Expand navigation', 'নেভিগেশন প্রসারিত করুন') : L('Collapse navigation', 'নেভিগেশন সংকুচিত করুন')}
          aria-pressed={rail}
          className={`hidden h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-transparent text-ink-400 transition hover:border-line hover:bg-surface hover:text-ink-800 lg:grid ${
            rail ? 'lg:mx-auto' : ''
          }`}
        >
          {rail ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={L('Close navigation', 'নেভিগেশন বন্ধ করুন')}
          className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-900 lg:hidden"
        >
          <X size={17} />
        </button>
      </div>

      {/* Tenant identity ------------------------------------------------------------------ */}
      <div
        className={`relative mx-3 mb-3 overflow-hidden rounded-2xl border border-white/[0.08] p-3 text-white shadow-lift ${
          rail ? 'lg:hidden' : ''
        }`}
        style={{
          backgroundImage:
            'radial-gradient(120% 140% at 0% 0%, rgba(99,102,241,.5), transparent 52%), radial-gradient(140% 120% at 100% 100%, rgba(168,85,247,.32), transparent 56%), linear-gradient(140deg, #0c0c18, #101024 58%, #0a0a15)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(circle at 90% 10%, black, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(circle at 90% 10%, black, transparent 75%)',
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white/[0.09] text-[10px] font-bold tracking-wide text-white ring-1 ring-inset ring-white/[0.12]">
            {initials || 'LV'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] font-semibold leading-tight">{L(tenant.name_en, tenant.name_bn)}</p>
            <p className="mt-0.5 truncate text-[8.5px] text-white/50">{entityTypeLabel(tenant.entity_type, isBn)}</p>
          </div>
          <span className="status-dot shrink-0" aria-hidden />
        </div>
        <div className="relative mt-2.5 flex items-center gap-1.5">
          <span className="truncate rounded-md bg-white/[0.06] px-1.5 py-1 font-mono text-[7.5px] uppercase tracking-[0.06em] text-white/55 ring-1 ring-inset ring-white/[0.06]">
            TIN {tenant.tin_number || '—'}
          </span>
          <span className="rounded-md bg-emerald-400/[0.12] px-1.5 py-1 font-mono text-[7.5px] font-semibold uppercase tracking-[0.06em] text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
            {auth.demoMode ? 'DEMO' : 'SERVER'}
          </span>
        </div>
      </div>

      {/* Rail tenant chip ----------------------------------------------------------------- */}
      <button
        type="button"
        onClick={onOpenPalette}
        title={`${L(tenant.name_en, tenant.name_bn)} · ${entityTypeLabel(tenant.entity_type, isBn)}`}
        className={`mx-auto mb-3 hidden h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-[9px] font-bold text-ink-600 shadow-sm transition hover:border-line-strong hover:text-ink-900 ${
          rail ? 'lg:grid' : ''
        }`}
      >
        {initials || 'LV'}
      </button>

      {/* Search --------------------------------------------------------------------------- */}
      <button
        type="button"
        onClick={onOpenPalette}
        className={`group relative mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-line/80 bg-surface/70 px-2.5 py-2 text-left shadow-sm transition hover:border-line-strong hover:bg-surface ${
          rail ? 'lg:mx-auto lg:h-9 lg:w-9 lg:justify-center lg:px-0' : ''
        }`}
        aria-label={L('Search or jump to', 'খুঁজুন বা যান')}
        title={L('Search or jump to (Ctrl+K)', 'খুঁজুন বা যান (Ctrl+K)')}
      >
        <Search size={14} className="shrink-0 text-ink-400 transition group-hover:text-brand-bright" />
        <span className={`min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink-500 ${rail ? 'lg:hidden' : ''}`}>
          {L('Search or jump to…', 'খুঁজুন বা যান…')}
        </span>
        <kbd className={`lv-kbd shrink-0 !py-0.5 !text-[8.5px] ${rail ? 'lg:hidden' : ''}`}>⌘K</kbd>
      </button>

      {/* Navigation ----------------------------------------------------------------------- */}
      <nav className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-4 no-scrollbar">
        {!auth.demoMode ? (
          <section className="mb-2" aria-label={L('Server workspace', 'সার্ভার ওয়ার্কস্পেস')}>
            <p className="px-2 pb-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-ink-400">
              {L('Accounting', 'হিসাবরক্ষণ')}
            </p>
            <div className="space-y-0.5">
              <Link
                to="/app/ledger"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/ledger') ? 'page' : undefined}
                title={L('General ledger', 'সাধারণ লেজার')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/ledger')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <BookOpen size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('General ledger', 'সাধারণ লেজার')}</span>
              </Link>
              <Link
                to="/app/reports"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/reports') ? 'page' : undefined}
                title={L('Reports & statements', 'রিপোর্ট ও বিবরণী')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/reports')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <FileBarChart size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Reports & statements', 'রিপোর্ট ও বিবরণী')}</span>
              </Link>
              {auth.hasCompanyPermission('VIEW_REPORTS') ? (
                <Link
                  to="/app/close"
                  onClick={onClose}
                  aria-current={location.pathname.startsWith('/app/close') ? 'page' : undefined}
                  title={L('Close & controls', 'সমাপনী ও নিয়ন্ত্রণ')}
                  className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                    rail ? 'lg:justify-center lg:px-0' : ''
                  } ${
                    location.pathname.startsWith('/app/close')
                      ? 'bg-ink-900 text-white dark:bg-white/10'
                      : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                    <ClipboardCheck size={14} />
                  </span>
                  <span className={rail ? 'lg:hidden' : ''}>{L('Close & controls', 'সমাপনী ও নিয়ন্ত্রণ')}</span>
                </Link>
              ) : null}
              {auth.hasCompanyPermission('VIEW_REPORTS') ? (
                <Link
                  to="/app/audit"
                  onClick={onClose}
                  aria-current={location.pathname.startsWith('/app/audit') ? 'page' : undefined}
                  title={L('Audit log', 'অডিট লগ')}
                  className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                    rail ? 'lg:justify-center lg:px-0' : ''
                  } ${
                    location.pathname.startsWith('/app/audit')
                      ? 'bg-ink-900 text-white dark:bg-white/10'
                      : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                    <ShieldCheck size={14} />
                  </span>
                  <span className={rail ? 'lg:hidden' : ''}>{L('Audit log', 'অডিট লগ')}</span>
                </Link>
              ) : null}
              <Link
                to="/app/sales"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/sales') ? 'page' : undefined}
                title={L('Sales & receivables', 'বিক্রয় ও প্রাপ্য')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/sales')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Receipt size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Sales & receivables', 'বিক্রয় ও প্রাপ্য')}</span>
              </Link>
              <Link
                to="/app/purchases"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/purchases') ? 'page' : undefined}
                title={L('Purchases & payables', 'ক্রয় ও প্রদেয়')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/purchases')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <ShoppingCart size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Purchases & payables', 'ক্রয় ও প্রদেয়')}</span>
              </Link>
              <Link
                to="/app/treasury"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/treasury') ? 'page' : undefined}
                title={L('Treasury & certificates', 'ট্রেজারি ও প্রত্যয়নপত্র')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/treasury')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Landmark size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Treasury & certificates', 'ট্রেজারি ও প্রত্যয়নপত্র')}</span>
              </Link>
              <Link
                to="/app/banking"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/banking') ? 'page' : undefined}
                title={L('Banking & reconciliation', 'ব্যাংকিং ও মিলকরণ')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/banking')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Landmark size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Banking & reconciliation', 'ব্যাংকিং ও মিলকরণ')}</span>
              </Link>
              <Link
                to="/app/masters"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/masters') ? 'page' : undefined}
                title={L('Master data', 'মাস্টার ডেটা')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/masters')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Database size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Master data', 'মাস্টার ডেটা')}</span>
              </Link>
              <Link
                to="/app/inventory"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/inventory') ? 'page' : undefined}
                title={L('Inventory', 'ইনভেন্টরি')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/inventory')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Boxes size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Inventory', 'ইনভেন্টরি')}</span>
              </Link>
              <Link
                to="/app/setup"
                onClick={onClose}
                aria-current={location.pathname.startsWith('/app/setup') ? 'page' : undefined}
                title={L('Company setup', 'কোম্পানি সেটআপ')}
                className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                  rail ? 'lg:justify-center lg:px-0' : ''
                } ${
                  location.pathname.startsWith('/app/setup')
                    ? 'bg-ink-900 text-white dark:bg-white/10'
                    : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                  <Settings2 size={14} />
                </span>
                <span className={rail ? 'lg:hidden' : ''}>{L('Company setup', 'কোম্পানি সেটআপ')}</span>
              </Link>
              {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') ? (
                <Link
                  to="/app/team"
                  onClick={onClose}
                  aria-current={location.pathname.startsWith('/app/team') ? 'page' : undefined}
                  title={L('Team & access', 'টিম ও প্রবেশাধিকার')}
                  className={`flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-[12px] font-semibold transition ${
                    rail ? 'lg:justify-center lg:px-0' : ''
                  } ${
                    location.pathname.startsWith('/app/team')
                      ? 'bg-ink-900 text-white dark:bg-white/10'
                      : 'text-ink-700 hover:bg-ink-100/60 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.04]">
                    <UserCog size={14} />
                  </span>
                  <span className={rail ? 'lg:hidden' : ''}>{L('Team & access', 'টিম ও প্রবেশাধিকার')}</span>
                </Link>
              ) : null}
            </div>
            <p className={`mt-3 px-2 text-[12px] leading-relaxed text-ink-400 ${rail ? 'lg:hidden' : ''}`}>
              {L(
                'Banking, payroll, VAT returns, close and the remaining reports stay in the clearly labelled demo until their server phases are complete.',
                'ব্যাংকিং, পে-রোল, ভ্যাট রিটার্ন, ক্লোজ ও বাকি রিপোর্ট তাদের সার্ভার ধাপ শেষ না হওয়া পর্যন্ত স্পষ্টভাবে চিহ্নিত ডেমোতে থাকবে।',
              )}
            </p>
          </section>
        ) : (
          WORKSPACE_GROUPS.map((group, groupIndex) => {
          const items = workspacesInGroup(group.key);
          if (items.length === 0) return null;
          const isCollapsed = !rail && Boolean(collapsed[group.key]);
          return (
            <section key={group.key} className="mb-0.5" aria-label={L(group.label_en, group.label_bn)}>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!isCollapsed}
                title={L(group.caption_en, group.caption_bn)}
                className={`group flex w-full items-center gap-2 rounded-lg px-2 pb-1.5 pt-2.5 text-left transition hover:bg-ink-100/40 dark:hover:bg-white/[0.03] ${
                  rail ? 'lg:hidden' : ''
                }`}
              >
                <span className="flex-1 text-[8.5px] font-bold uppercase tracking-[0.18em] text-ink-400">
                  {L(group.label_en, group.label_bn)}
                </span>
                <span className="font-mono text-[8px] tabular-nums text-ink-300">
                  {String(items.length).padStart(2, '0')}
                </span>
                <motion.span
                  animate={{ rotate: isCollapsed ? -90 : 0 }}
                  transition={{ duration }}
                  className="text-ink-300"
                >
                  <ChevronDown size={12} />
                </motion.span>
              </button>

              {/* Rail: a hairline between groups instead of a label. */}
              {rail ? (
                <div
                  className={`mx-auto my-2 hidden h-px w-7 bg-line/80 lg:block ${groupIndex === 0 ? 'lg:!mt-0' : ''}`}
                  aria-hidden
                />
              ) : null}

              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration, ease: navEase }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5 pb-1 pt-0.5">
                      {items.map((workspace) => {
                        const isActive = workspace.key === active;
                        const Icon = workspace.icon;
                        const badge = badges[workspace.key];
                        const label = L(workspace.short_en, workspace.short_bn);
                        return (
                          <button
                            key={workspace.key}
                            type="button"
                            onClick={() => onNavigate(workspace.key)}
                            aria-current={isActive ? 'page' : undefined}
                            title={`${label} · ${workspace.shortcut}`}
                            className={`lv-nav-item group relative flex w-full items-center gap-2.5 rounded-xl px-2 py-[7px] text-left ${
                              isActive ? 'text-white' : 'text-ink-700'
                            } ${rail ? 'lg:justify-center lg:px-0' : ''}`}
                          >
                            {isActive && (
                              <motion.span
                                layoutId="activeNavPill"
                                className="lv-nav-pill absolute inset-0 rounded-xl"
                                transition={
                                  motionTier === 'OFF'
                                    ? { duration: 0 }
                                    : { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }
                                }
                              />
                            )}
                            <span
                              className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-lg transition ${
                                isActive
                                  ? 'text-white'
                                  : 'bg-ink-100/70 text-ink-500 group-hover:bg-vault-50 group-hover:text-brand-bright dark:bg-white/[0.04]'
                              }`}
                            >
                              <Icon size={14} strokeWidth={isActive ? 2.1 : 1.85} />
                              {badge ? (
                                <span
                                  aria-hidden
                                  className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-[rgb(var(--lv-sidebar))] ${
                                    rail ? 'hidden lg:block' : 'hidden'
                                  } ${RAIL_DOT[badge.tone]}`}
                                />
                              ) : null}
                            </span>
                            <span className={`relative z-10 min-w-0 flex-1 ${rail ? 'lg:hidden' : ''}`}>
                              <span
                                className={`block truncate text-[11.5px] font-semibold leading-tight tracking-[-0.01em] ${
                                  isActive ? 'text-white' : 'text-ink-700'
                                }`}
                              >
                                {label}
                              </span>
                            </span>
                            <span className={`relative z-10 flex shrink-0 items-center gap-1 ${rail ? 'lg:hidden' : ''}`}>
                              {badge ? (
                                <span
                                  className={`inline-flex min-w-[16px] items-center justify-center rounded-full px-1 py-0.5 font-mono text-[8.5px] font-semibold tabular-nums ring-1 ring-inset ${
                                    isActive ? 'bg-white/15 text-white ring-white/20' : BADGE_TONE[badge.tone]
                                  }`}
                                  title={badge.label}
                                >
                                  {badge.count > 99 ? '99+' : badge.count}
                                </span>
                              ) : null}
                              <kbd
                                className={`hidden font-mono text-[8px] tabular-nums transition-opacity sm:inline ${
                                  isActive ? 'text-white/60 opacity-100' : 'text-ink-300 opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                {workspace.shortcut}
                              </kbd>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          );
          })
        )}
      </nav>

      {/* Footer -------------------------------------------------------------------------- */}
      <div className={`relative border-t border-line/70 px-3.5 py-3.5 ${rail ? 'lg:hidden' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[9.5px] font-semibold text-ink-600">
            <span
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                auth.demoMode
                  ? vault.auditChain.valid
                    ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.12)]'
                    : 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,.12)]'
                  : 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.12)]'
              }`}
            />
            {auth.demoMode
              ? vault.auditChain.valid
                ? L('Audit chain intact', 'অডিট চেইন অটুট')
                : L('Audit chain broken', 'অডিট চেইন ভাঙা')
              : L('Server identity active', 'সার্ভার পরিচয় সক্রিয়')}
          </span>
          <span className="font-mono text-[8.5px] tabular-nums text-ink-400">
            {auth.demoMode ? `${vault.auditChain.checkedCount} ${L('sealed', 'সিল')}` : L('Phase 9', 'ফেজ ৯')}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-400">
            {auth.demoMode ? `Rule pack ${RULE_PACK_VERSION}` : L('Server session', 'সার্ভার সেশন')}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-line/80 bg-surface-2/70 px-1.5 py-0.5 text-[8px] font-semibold text-ink-500">
            <Sparkles size={8} className="text-saffron" />
            {auth.demoMode
              ? pendingChallans > 0
                ? L(`${pendingChallans} treasury`, `${pendingChallans} কোষাগার`)
                : L('All clear', 'সব পরিষ্কার')
              : L('CSRF protected', 'সিএসআরএফ সুরক্ষিত')}
          </span>
        </div>
      </div>

      {/* Rail footer: a compact live status capsule. */}
      <div className={`hidden border-t border-line/70 py-3 ${rail ? 'lg:flex lg:flex-col lg:items-center lg:gap-2' : ''}`}>
        <span
          title={
            auth.demoMode
              ? vault.auditChain.valid
                ? L('Audit chain intact', 'অডিট চেইন অটুট')
                : L('Audit chain broken', 'অডিট চেইন ভাঙা')
              : L('Server identity active', 'সার্ভার পরিচয় সক্রিয়')
          }
          className={`inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.12)]`}
        />
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface-2/60 text-ink-400" title={auth.demoMode ? `Rule pack ${RULE_PACK_VERSION}` : L('Server session', 'সার্ভার সেশন')}>
          <ShieldCheck size={12} />
        </span>
      </div>
    </aside>
  );
}

export default Sidebar;
