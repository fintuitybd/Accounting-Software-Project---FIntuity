import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  ChevronLeft,
  ClipboardCheck,
  Database,
  FileBarChart,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import { usePreferences } from '../preferences/AppPreferences';
import { masterApi, type Branch } from '../masters/api';
import { FintuityLogo, FintuityMark } from '../components/brand/FintuityBrand';
import {
  NAVIGATION_GROUPS,
  resolveNavigationPath,
  visibleNavigationSections,
  type NavigationIcon,
  type NavigationSection,
} from './navigation';

const ICONS: Record<NavigationIcon, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  sales: Receipt,
  purchases: ShoppingCart,
  banking: Banknote,
  treasury: Building2,
  ledger: BookOpen,
  inventory: Boxes,
  masters: Database,
  reports: FileBarChart,
  close: ClipboardCheck,
  audit: ShieldCheck,
  compliance: CalendarClock,
  setup: Settings2,
  team: UserCog,
  account: Users,
};

export interface AppSidebarProps {
  currentPath: string;
  mobileOpen: boolean;
  rail: boolean;
  onClose: () => void;
  onToggleRail: () => void;
  onOpenPalette: () => void;
}

export function AppSidebar({
  currentPath,
  mobileOpen,
  rail,
  onClose,
  onToggleRail,
  onOpenPalette,
}: AppSidebarProps) {
  const auth = useAuth();
  const { locale, defaultBranchId, setDefaultBranchId, publishToast } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const active = resolveNavigationPath(currentPath)?.section.key ?? 'HOME';
  const visible = useMemo(() => visibleNavigationSections(auth), [auth]);
  const grouped = useMemo(
    () =>
      NAVIGATION_GROUPS.map((group) => ({
        group,
        items: visible.filter((item) => item.group === group.key),
      })).filter((entry) => entry.items.length > 0),
    [visible],
  );

  const changeCompany = async (companyId: string) => {
    if (!companyId || companyId === auth.activeCompany?.id) return;
    try {
      await auth.selectCompany(companyId);
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('Company could not be changed', 'কোম্পানি পরিবর্তন করা যায়নি'),
        message: error instanceof Error ? error.message : L('Try again.', 'আবার চেষ্টা করুন।'),
      });
    }
  };

  const company = auth.activeCompany;
  const role = company ? ROLE_LABELS[company.role] : null;

  useEffect(() => {
    const companyId = company?.id;
    if (!companyId) {
      setBranches([]);
      return undefined;
    }
    let cancelled = false;
    void masterApi
      .branches(companyId, false)
      .then((response) => {
        if (!cancelled) setBranches(response.branches.filter((branch) => branch.status === 'ACTIVE'));
      })
      .catch(() => {
        // Branch selection is a convenience for new drafts; it never blocks navigation.
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [company?.id]);

  return (
    <aside
      aria-label={L('Main navigation', 'প্রধান নেভিগেশন')}
      className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-ql-border bg-ql-surface transition-[width,transform] duration-ql motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
        rail ? 'lg:w-[76px]' : 'lg:w-[280px]'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
    >
      <div className="h-1 w-full shrink-0 ql-brand-gradient" aria-hidden="true" />
      <div className={`flex items-center gap-2 border-b border-ql-border px-4 py-4 ${rail ? 'lg:justify-center lg:px-0' : ''}`}>
        {rail ? (
          <FintuityMark size={36} className="fintuity-mark-glow" />
        ) : (
          <div className="min-w-0 flex-1">
            <FintuityLogo height={46} />
            <p className="mt-1.5 truncate text-[12px] leading-4 text-ql-ink-muted">
              {L('Accounting & tax workspace', 'হিসাব ও কর কার্যস্থান')}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleRail}
          aria-label={rail ? L('Expand navigation', 'নেভিগেশন প্রসারিত করুন') : L('Collapse navigation', 'নেভিগেশন সংকুচিত করুন')}
          aria-pressed={rail}
          className={`hidden h-10 w-10 shrink-0 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink lg:grid ${rail ? 'lg:absolute lg:right-2 lg:top-4' : ''}`}
        >
          {rail ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={L('Close navigation', 'নেভিগেশন বন্ধ করুন')}
          className="grid h-10 w-10 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink lg:hidden"
        >
          <X size={19} aria-hidden />
        </button>
      </div>

      <div className={`border-b border-ql-border px-3 py-3 ${rail ? 'lg:hidden' : ''}`}>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ql-ink-muted">{L('Active company', 'সক্রিয় কোম্পানি')}</span>
          {auth.companies.length > 1 ? (
            <select
              value={company?.id ?? ''}
              onChange={(event) => void changeCompany(event.target.value)}
              className="ql-select text-[13px]"
              aria-label={L('Switch company', 'কোম্পানি পরিবর্তন করুন')}
            >
              {auth.companies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.legalName}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate rounded-ql-control border border-ql-border bg-ql-surface-muted px-3 py-2 text-[13px] font-medium text-ql-ink">
              {company?.legalName ?? L('No company access', 'কোম্পানি প্রবেশাধিকার নেই')}
            </p>
          )}
        </label>
        {company && branches.length > 0 ? (
          <label className="mt-2 block">
            <span className="mb-1 block text-[12px] font-medium text-ql-ink-muted">
              {L('Default branch for new documents', 'নতুন নথির ডিফল্ট শাখা')}
            </span>
            <select
              value={defaultBranchId ?? ''}
              onChange={(event) => setDefaultBranchId(event.target.value || null)}
              className="ql-select text-[13px]"
              aria-label={L('Default branch for new documents', 'নতুন নথির ডিফল্ট শাখা')}
            >
              <option value="">{L('No default branch', 'কোনো ডিফল্ট শাখা নেই')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} · {branch.nameEn}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] leading-4 text-ql-ink-subtle">
              {L('Prefills drafts only. It does not restrict what you can see.', 'শুধু খসড়া পূরণ করে। আপনি কী দেখতে পাবেন তা সীমাবদ্ধ করে না।')}
            </span>
          </label>
        ) : null}
        {company && role ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ql-ink-muted">
            <ShieldCheck size={13} aria-hidden className="text-ql-brand" />
            {L(role.label_en, role.label_bn)}
            {company.explicitScope ? <span className="text-ql-ink-subtle">· {L('company scope', 'কোম্পানি পরিধি')}</span> : null}
          </p>
        ) : null}
      </div>

      <div className={`px-3 py-3 ${rail ? 'lg:px-2' : ''}`}>
        <button
          type="button"
          onClick={onOpenPalette}
          className={`flex min-h-10 w-full items-center gap-2.5 rounded-ql-control border border-ql-border bg-ql-surface-muted px-3 text-left text-[13px] text-ql-ink-muted hover:border-ql-border-strong hover:text-ql-ink ${
            rail ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <Search size={16} aria-hidden />
          <span className="sr-only">{L('Search or jump to', 'খুঁজুন বা যান')}</span>
          <span className={`flex-1 ${rail ? 'lg:hidden' : ''}`} aria-hidden>{L('Search or jump to…', 'খুঁজুন বা যান…')}</span>
          <kbd className={`rounded border border-ql-border bg-ql-surface px-1.5 py-0.5 font-mono text-[12px] ${rail ? 'lg:hidden' : ''}`} aria-hidden>Ctrl K</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label={L('Workspace sections', 'কার্যস্থান বিভাগ')}>
        {grouped.map(({ group, items }) => (
          <div key={group.key} className="mb-2">
            <p className={`px-2 pb-1 pt-2 text-[12px] font-semibold text-ql-ink-subtle ${rail ? 'lg:sr-only' : ''}`}>
              {L(group.labelEn, group.labelBn)}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.key}>
                  <NavLinkItem
                    item={item}
                    active={active === item.key}
                    rail={rail}
                    onNavigate={onClose}
                    label={L(item.labelEn, item.labelBn)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={`border-t border-ql-border px-4 py-3 text-[12px] leading-5 text-ql-ink-muted ${rail ? 'lg:hidden' : ''}`}>
        <p className="flex items-center gap-1.5 font-medium text-ql-ink">
          <span className="h-2 w-2 rounded-full bg-ql-success" aria-hidden />
          {L('Server session active', 'সার্ভার সেশন সক্রিয়')}
        </p>
        <p className="mt-1">{L('Company-scoped data · server-enforced permissions', 'কোম্পানি-সীমাবদ্ধ ডেটা · সার্ভার-প্রয়োগকৃত অনুমতি')}</p>
      </div>

      {rail ? (
        <div className="hidden border-t border-ql-border py-3 lg:flex lg:flex-col lg:items-center lg:gap-2">
          <span className="h-2 w-2 rounded-full bg-ql-success" aria-hidden />
          <ChevronLeft size={14} className="text-ql-ink-subtle" aria-hidden />
        </div>
      ) : null}
    </aside>
  );
}

function NavLinkItem({
  item,
  active,
  rail,
  label,
  onNavigate,
}: {
  item: NavigationSection;
  active: boolean;
  rail: boolean;
  label: string;
  onNavigate: () => void;
}) {
  const Icon = ICONS[item.icon] ?? LayoutDashboard;
  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={rail ? label : undefined}
      className={`flex min-h-10 items-center gap-2.5 rounded-ql-control px-2.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-ql-brand text-ql-brand-ink' : 'text-ql-ink hover:bg-ql-surface-muted'
      } ${rail ? 'lg:justify-center lg:px-0' : ''}`}
    >
      <Icon size={18} aria-hidden className="shrink-0" />
      <span className={rail ? 'lg:sr-only' : 'truncate'}>{label}</span>
    </Link>
  );
}

export default AppSidebar;
