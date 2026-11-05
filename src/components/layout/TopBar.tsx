// LedgerVault — the Lumen control bar.
//
// One floating glass row: collapse the navigation rail, switch organization context, jump into the
// Ctrl+K palette, create a document, flip language or theme, and change the authenticated RBAC role.
// The bar stays single-line at every width — labels retire before controls ever wrap.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Coins,
  Command,
  Contrast,
  Database,
  Download,
  FileText,
  Gauge,
  Hash,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sun,
  Upload,
  Wallet,
  X,
} from 'lucide-react';

import { localized } from '../../core/i18n';
import { tenantByKey } from '../../core/ledger/seedData';
import { ROLE_LABELS, useVault } from '../../context/VaultContext';
import { useWorkspaceNav } from './WorkspaceNav';
import type { TenantEntity, UserRole } from '../../core/types';
import type { WorkspaceKey } from '../../workspaces/registry';
import { entityTypeLabel } from '../../workspaces/registry';

const PERSONA_META: Array<{
  key: TenantEntity['persona_key'];
  label_en: string;
  label_bn: string;
  note_en: string;
  note_bn: string;
  icon: typeof Gauge;
}> = [
  {
    key: 'APEX',
    label_en: 'Apex Group',
    label_bn: 'অ্যাপেক্স গ্রুপ',
    note_en: 'Distribution, manufacturing & retail',
    note_bn: 'বিতরণ, উৎপাদন ও খুচরা',
    icon: Building2,
  },
  {
    key: 'CLOUDNINE',
    label_en: 'Cloudnine',
    label_bn: 'ক্লাউডনাইন',
    note_en: 'Technology services & export',
    note_bn: 'প্রযুক্তি সেবা ও রপ্তানি',
    icon: Sparkles,
  },
  {
    key: 'RAFIQ',
    label_en: 'Rafiq Enterprise',
    label_bn: 'রফিক এন্টারপ্রাইজ',
    note_en: 'Proprietorship & turnover tax',
    note_bn: 'একক প্রতিষ্ঠান ও টার্নওভার কর',
    icon: Wallet,
  },
];

const USER_ROLES: readonly UserRole[] = ['ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR', 'AUDITOR'];

const ROLE_TONE: Record<UserRole, string> = {
  ADMIN: 'bg-vault-100 text-vault-700 dark:bg-vault-500/15 dark:text-vault-300',
  CONTROLLER: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  ACCOUNTANT: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  OPERATOR: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  AUDITOR: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const QUICK_ACTIONS: ReadonlyArray<{
  id: 'INVOICE' | 'BILL' | 'MASTERS';
  key?: WorkspaceKey;
  icon: typeof FileText;
  label_en: string;
  label_bn: string;
  desc_en: string;
  desc_bn: string;
}> = [
  {
    id: 'INVOICE',
    key: 'W02',
    icon: FileText,
    label_en: 'New sales invoice',
    label_bn: 'নতুন বিক্রয় চালান',
    desc_en: 'Mushak 6.3 · VAT & VDS',
    desc_bn: 'মূসক ৬.৩ · ভ্যাট ও ভিডিএস',
  },
  {
    id: 'BILL',
    key: 'W03',
    icon: ShoppingCart,
    label_en: 'New purchase bill',
    label_bn: 'নতুন ক্রয় বিল',
    desc_en: 'VDS 4.5% · TDS schedule',
    desc_bn: 'ভিডিএস ৪.৫% · টিডিএস সিডিউল',
  },
  {
    id: 'MASTERS',
    icon: Database,
    label_en: 'Master data manager',
    label_bn: 'মাস্টার ডেটা ম্যানেজার',
    desc_en: 'Chart of accounts · parties · items',
    desc_bn: 'হিসাবের চার্ট · পক্ষ · আইটেম',
  },
];

const MENU_TRANSITION = { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const };

type MenuKey = 'org' | 'create' | 'settings' | 'user' | null;

export interface TopBarProps {
  rail: boolean;
  onToggleRail: () => void;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
  onOpenMasters: () => void;
  onOpenOnboarding: () => void;
  onOpenAccess: () => void;
}

export function TopBar({
  rail,
  onToggleRail,
  onOpenMenu,
  onOpenPalette,
  onOpenMasters,
  onOpenOnboarding,
  onOpenAccess,
}: TopBarProps) {
  const vault = useVault();
  const { navigate } = useWorkspaceNav();
  const { locale, currentUser, isAuthenticated, tenant, users, theme, mode, numeralScript, grouping } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const [menu, setMenu] = useState<MenuKey>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('[data-topmenu]')) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const activePersona = useMemo(
    () => PERSONA_META.find((persona) => persona.key === vault.activePersona) ?? PERSONA_META[0],
    [vault.activePersona],
  );
  const bin = tenant.bin_units[0]?.bin_number ?? '—';
  const tenantInitials = initialsOf(tenant.name_en);
  const isDark = theme === 'DARK';

  const closeMenu = (): void => setMenu(null);
  const toggleMenu = (key: Exclude<MenuKey, null>): void => {
    setMenu((current) => (current === key ? null : key));
  };

  const choosePersona = (persona: TenantEntity['persona_key']): void => {
    vault.setPersona(persona);
    closeMenu();
  };

  const runQuickAction = (id: (typeof QUICK_ACTIONS)[number]['id'], key?: WorkspaceKey): void => {
    closeMenu();
    if (id === 'MASTERS') {
      onOpenMasters();
      return;
    }
    if (key) navigate(key);
  };

  const handleRole = (role: UserRole): void => {
    closeMenu();
    const result = vault.switchUserRole(role);
    if (!result.ok) {
      vault.publishToast({
        tone: 'error',
        title: L('Role unchanged', 'ভূমিকা অপরিবর্তিত'),
        message:
          result.error ??
          L('No active user is configured for that role.', 'সেই ভূমিকার জন্য কোনো সক্রিয় ব্যবহারকারী নেই।'),
      });
    }
  };

  const handleExport = (): void => {
    closeMenu();
    vault.exportVaultFile();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    closeMenu();
    const result = await vault.importVaultFile(file);
    if (!result.ok) {
      vault.publishToast({
        tone: 'error',
        title: L('Restore failed', 'পুনরুদ্ধার ব্যর্থ'),
        message: result.error ?? L('That file could not be restored.', 'ফাইলটি পুনরুদ্ধার করা যায়নি।'),
      });
    }
  };

  return (
    <div className="sticky top-0 z-40 px-3 pt-3 sm:px-4 lg:px-6">
      <header className="glass-bar relative mx-auto flex max-w-[1600px] items-center gap-1 rounded-[18px] px-2 py-2 sm:gap-1.5 sm:px-2.5">
        {/* Navigation controls */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={L('Open navigation', 'নেভিগেশন খুলুন')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-900 lg:hidden"
        >
          <Menu size={18} />
        </button>
        <button
          type="button"
          onClick={onToggleRail}
          aria-label={rail ? L('Expand navigation', 'নেভিগেশন প্রসারিত করুন') : L('Collapse navigation', 'নেভিগেশন সংকুচিত করুন')}
          title={rail ? L('Expand navigation', 'নেভিগেশন প্রসারিত করুন') : L('Collapse navigation', 'নেভিগেশন সংকুচিত করুন')}
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-400 transition hover:bg-ink-100/70 hover:text-ink-900 lg:grid"
        >
          {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        {/* Organization switcher */}
        <div className="relative shrink-0" data-topmenu>
          <button
            type="button"
            onClick={() => toggleMenu('org')}
            aria-haspopup="dialog"
            aria-expanded={menu === 'org'}
            className="group flex items-center gap-2 rounded-xl p-1 pr-1 transition hover:bg-ink-100/60 dark:hover:bg-white/[0.045]"
          >
            <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[10px] brand-gradient text-[9.5px] font-bold tracking-wide text-white shadow-sm ring-1 ring-white/25">
              {tenantInitials}
              <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300 ring-[1.5px] ring-[#3f3ac9]" />
            </span>
            <span className="hidden min-w-0 max-w-[170px] text-left sm:block">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[11.5px] font-semibold leading-tight tracking-[-0.01em] text-ink-900">
                  {L(tenant.name_en, tenant.name_bn)}
                </span>
                <span className="rounded-[4px] bg-vault-50 px-1 py-px font-mono text-[7px] font-bold uppercase tracking-[0.06em] text-vault-600 dark:bg-vault-500/10 dark:text-vault-300">
                  {activePersona.key.slice(0, 4)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-1 font-mono text-[7.5px] leading-none text-ink-400">
                <span className="uppercase tracking-[0.05em]">{entityTypeLabel(tenant.entity_type, isBn)}</span>
                <span className="text-ink-300">·</span>
                <span className="truncate">BIN {bin}</span>
              </span>
            </span>
            <ChevronsUpDown size={12} className="hidden shrink-0 text-ink-400 transition group-hover:text-ink-600 sm:block" />
          </button>

          <Popover open={menu === 'org'} align="left" width="w-[min(92vw,380px)]" label={L('Organization', 'প্রতিষ্ঠান')}>
            <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3.5">
              <div>
                <p className="lv-kicker">{L('Organization context', 'প্রতিষ্ঠানের প্রেক্ষাপট')}</p>
                <p className="mt-1 text-[12px] font-semibold text-ink-900">
                  {L('Switch company', 'প্রতিষ্ঠান পরিবর্তন')}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMenu}
                className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                aria-label={L('Close', 'বন্ধ')}
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-1.5">
              {PERSONA_META.map((persona) => {
                const entity = tenantByKey(persona.key);
                const Icon = persona.icon;
                const active = vault.activePersona === persona.key && tenant.id === entity.id;
                return (
                  <button
                    key={persona.key}
                    type="button"
                    onClick={() => choosePersona(persona.key)}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
                      active
                        ? 'bg-vault-50/80 ring-1 ring-inset ring-vault-100 dark:bg-vault-500/[0.08] dark:ring-vault-500/15'
                        : 'hover:bg-ink-100/60 dark:hover:bg-white/[0.045]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                        active
                          ? 'brand-gradient text-white shadow-sm'
                          : 'bg-ink-100 text-ink-500 dark:bg-white/[0.05]'
                      }`}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-semibold text-ink-900">
                          {L(persona.label_en, persona.label_bn)}
                        </span>
                        <span
                          className={`rounded px-1 py-px font-mono text-[7.5px] font-bold uppercase ${
                            active
                              ? 'bg-vault-100 text-vault-600 dark:bg-vault-500/15 dark:text-vault-300'
                              : 'bg-ink-100 text-ink-400 dark:bg-white/[0.06]'
                          }`}
                        >
                          {persona.key}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-ink-500">
                        {L(persona.note_en, persona.note_bn)}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[8px] text-ink-400">
                        <span>{entity.fiscal_year_label}</span>
                        <span className="text-ink-300">·</span>
                        <span>BIN {entity.bin_units[0]?.bin_number ?? '—'}</span>
                      </span>
                    </span>
                    {active ? <Check size={14} className="mt-1 shrink-0 text-brand-bright" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-line/70 p-2">
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onOpenOnboarding();
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line-strong/70 bg-surface-2/40 px-2.5 py-2 text-left transition hover:border-brand-bright/50 hover:bg-surface-2"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-bright">
                  <Plus size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-ink-800">
                    {L('New organization', 'নতুন প্রতিষ্ঠান')}
                  </span>
                  <span className="block text-[9px] text-ink-400">
                    {L('4-step onboarding wizard', '৪ ধাপের অনবোর্ডিং উইজার্ড')}
                  </span>
                </span>
              </button>
            </div>
          </Popover>
        </div>

        {/* Command bar */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={L('Open command palette (Ctrl+K)', 'কমান্ড প্যালেট খুলুন (Ctrl+K)')}
          className="group mx-1 hidden min-w-0 max-w-[460px] flex-1 items-center gap-2 rounded-xl border border-line/80 bg-surface-2/50 px-2.5 py-2 text-left transition hover:border-line-strong hover:bg-surface md:flex"
        >
          <Search size={13} className="shrink-0 text-ink-400 transition group-hover:text-brand-bright" />
          <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink-400">
            {L('Search workspaces, actions, accounts…', 'ওয়ার্কস্পেস, কাজ, হিসাব খুঁজুন…')}
          </span>
          <span className="hidden items-center gap-0.5 lg:flex">
            <kbd className="lv-kbd !px-1 !py-0.5 !text-[8px]">⌘</kbd>
            <kbd className="lv-kbd !px-1 !py-0.5 !text-[8px]">K</kbd>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label={L('Search', 'খুঁজুন')}
            className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-900 md:hidden"
          >
            <Search size={15} />
          </button>

          {/* Quick create */}
          <div className="relative" data-topmenu>
            <button
              type="button"
              onClick={() => toggleMenu('create')}
              aria-haspopup="menu"
              aria-expanded={menu === 'create'}
              className="lv-btn lv-btn-primary h-9 !gap-1.5 !rounded-xl !px-2.5 !py-0 !text-[11px] sm:!px-3"
            >
              <Plus size={13} strokeWidth={2.5} />
              <span className="hidden sm:inline">{L('Create', 'তৈরি')}</span>
              <ChevronDown size={10} className="hidden opacity-70 sm:block" />
            </button>
            <Popover open={menu === 'create'} align="right" width="w-[min(92vw,350px)]" label={L('Quick create', 'দ্রুত তৈরি')}>
              <div className="border-b border-line/70 px-4 py-3.5">
                <p className="lv-kicker flex items-center gap-1.5">
                  <Command size={10} />
                  {L('Quick create', 'দ্রুত তৈরি')}
                </p>
                <p className="mt-1 text-[10.5px] text-ink-500">
                  {L('Open the right workflow in one click.', 'এক ক্লিকে সঠিক ওয়ার্কফ্লো খুলুন।')}
                </p>
              </div>
              <div className="p-1.5">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      onClick={() => runQuickAction(action.id, action.key)}
                      className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-ink-100/60 dark:hover:bg-white/[0.045]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink-500 ring-1 ring-inset ring-line/70 transition group-hover:bg-vault-50 group-hover:text-brand-bright group-hover:ring-vault-100">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11.5px] font-semibold text-ink-800">
                          {L(action.label_en, action.label_bn)}
                        </span>
                        <span className="block text-[9.5px] text-ink-400">{L(action.desc_en, action.desc_bn)}</span>
                      </span>
                      {action.key ? <span className="font-mono text-[8.5px] text-ink-300">{action.key}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-line/70 bg-surface-2/35 px-3 py-2.5">
                <p className="lv-label flex items-center gap-1.5">
                  <Database size={10} className="text-ink-400" />
                  {L('Vault backup & restore', 'ভল্ট ব্যাকআপ ও পুনরুদ্ধার')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-[10px] font-semibold text-ink-600 transition hover:border-line-strong hover:text-ink-900"
                  >
                    <Download size={11} /> {L('Backup', 'ব্যাকআপ')}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-[10px] font-semibold text-ink-600 transition hover:border-line-strong hover:text-ink-900"
                  >
                    <Upload size={11} /> {L('Restore', 'পুনরুদ্ধার')}
                  </button>
                </div>
                <p className="mt-1.5 text-[8px] leading-relaxed text-ink-400">
                  {L(
                    'A portable snapshot of accounts, parties, items and the full journal chain.',
                    'হিসাব, পক্ষ, আইটেম ও সম্পূর্ণ জার্নাল চেইনের পোর্টেবল স্ন্যাপশট।',
                  )}
                </p>
              </div>
            </Popover>
          </div>

          {/* Language */}
          <div className="lv-seg hidden !gap-0 !p-[3px] sm:inline-flex" role="group" aria-label={L('Language', 'ভাষা')}>
            {(
              [
                { value: 'en-BD' as const, label: 'EN' },
                { value: 'bn-BD' as const, label: 'বাংলা' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={locale === option.value}
                onClick={() => vault.setLocale(option.value)}
                className="lv-seg-item !rounded-lg !px-2 !py-1.5 !text-[9.5px]"
                data-active={locale === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Theme quick toggle */}
          <button
            type="button"
            onClick={() => vault.setTheme(isDark ? 'LIGHT' : 'DARK')}
            aria-label={isDark ? L('Switch to light theme', 'লাইট থিমে যান') : L('Switch to dark theme', 'ডার্ক থিমে যান')}
            title={isDark ? L('Light theme', 'লাইট থিম') : L('Dark theme', 'ডার্ক থিম')}
            className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 transition hover:bg-ink-100/70 hover:text-ink-900"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Display settings */}
          <div className="relative" data-topmenu>
            <button
              type="button"
              onClick={() => toggleMenu('settings')}
              aria-label={L('Display settings', 'প্রদর্শন সেটিংস')}
              title={L('Display settings', 'প্রদর্শন সেটিংস')}
              aria-haspopup="dialog"
              aria-expanded={menu === 'settings'}
              className={`grid h-9 w-9 place-items-center rounded-[10px] transition ${
                menu === 'settings'
                  ? 'bg-ink-100 text-ink-900 dark:bg-white/[0.07]'
                  : 'text-ink-500 hover:bg-ink-100/70 hover:text-ink-900'
              }`}
            >
              <Settings2 size={15} />
            </button>
            <Popover open={menu === 'settings'} align="right" width="w-[min(92vw,330px)]" label={L('Display settings', 'প্রদর্শন সেটিংস')}>
              <div className="border-b border-line/70 px-4 py-3.5">
                <p className="lv-kicker flex items-center gap-1.5">
                  <Settings2 size={11} className="text-ink-400" />
                  {L('Display settings', 'প্রদর্শন সেটিংস')}
                </p>
                <p className="mt-1 text-[10.5px] text-ink-500">
                  {L('Applies instantly and is saved with the vault.', 'সাথে সাথে প্রযোজ্য এবং ভল্টে সংরক্ষিত।')}
                </p>
              </div>
              <div className="divide-y divide-line/70">
                <ChoiceRow
                  label={L('Mode', 'মোড')}
                  hint={L('Guided labels for juniors, dense tables for Pro.', 'জুনিয়রের জন্য নির্দেশিত লেবেল, প্রো-এর জন্য ঘন টেবিল।')}
                  value={mode}
                  onChange={vault.setMode}
                  options={[
                    { value: 'GUIDED', label: L('Guided', 'নির্দেশিত') },
                    { value: 'PRO', label: L('Pro', 'প্রো') },
                  ]}
                />
                <ChoiceRow
                  label={L('Numeral script', 'অঙ্ক লিপি')}
                  value={numeralScript}
                  onChange={vault.setNumeralScript}
                  options={[
                    { value: 'latin', label: '1,234', icon: <Hash size={9} /> },
                    { value: 'bn', label: '১,২৩৪', icon: <Hash size={9} /> },
                  ]}
                />
                <ChoiceRow
                  label={L('Number grouping', 'সংখ্যা গ্রুপিং')}
                  value={grouping}
                  onChange={vault.setGrouping}
                  options={[
                    { value: 'LAKH_CRORE', label: L('Lakh / Cr', 'লাখ / কোটি'), icon: <Coins size={9} /> },
                    { value: 'MILLIONS', label: L('Millions', 'মিলিয়ন'), icon: <Coins size={9} /> },
                  ]}
                />
                <ChoiceRow
                  label={L('Theme', 'থিম')}
                  value={theme}
                  onChange={vault.setTheme}
                  options={[
                    { value: 'LIGHT', label: L('Light', 'লাইট'), icon: <Sun size={9} /> },
                    { value: 'DARK', label: L('Dark', 'ডার্ক'), icon: <Moon size={9} /> },
                    { value: 'CONTRAST', label: L('Contrast', 'কনট্রাস্ট'), icon: <Contrast size={9} /> },
                  ]}
                />
              </div>
            </Popover>
          </div>

          {/* User & role */}
          <div className="relative" data-topmenu>
            <button
              type="button"
              onClick={() => toggleMenu('user')}
              aria-haspopup="dialog"
              aria-expanded={menu === 'user'}
              className={`ml-0.5 flex h-9 items-center gap-1.5 rounded-xl border py-1 pl-1 pr-1.5 text-left transition ${
                menu === 'user'
                  ? 'border-line-strong bg-ink-100 dark:bg-white/[0.07]'
                  : 'border-line/80 bg-surface/60 hover:border-line-strong'
              }`}
            >
              <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#0b0b16] text-[8.5px] font-bold text-white ring-1 ring-white/10">
                {initialsOf(currentUser.full_name)}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[rgb(var(--lv-surface))] ${
                    isAuthenticated ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                />
              </span>
              <span className="hidden min-w-0 md:block">
                <span className="block max-w-[92px] truncate text-[9.5px] font-semibold leading-tight text-ink-800">
                  {currentUser.full_name.split(' ')[0]}
                </span>
                <span className="block text-[7px] font-bold uppercase tracking-[0.08em] text-ink-400">
                  {isAuthenticated ? ROLE_LABELS[currentUser.role].label_en : L('Read-only', 'পাঠযোগ্য')}
                </span>
              </span>
              <span className={`hidden rounded-[5px] px-1 py-0.5 font-mono text-[7.5px] font-bold uppercase tracking-[0.04em] sm:inline ${ROLE_TONE[currentUser.role]}`}>
                {currentUser.role}
              </span>
              <ChevronDown size={10} className="hidden shrink-0 text-ink-400 sm:block" />
            </button>

            <Popover open={menu === 'user'} align="right" width="w-[min(92vw,340px)]" label={L('User and role', 'ব্যবহারকারী ও ভূমিকা')}>
              <div className="flex items-start gap-2.5 border-b border-line/70 px-4 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b0b16] text-[10px] font-bold text-white ring-1 ring-white/10">
                  {initialsOf(currentUser.full_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-ink-900">{currentUser.full_name}</p>
                  <p className="truncate text-[9.5px] text-ink-400">
                    {currentUser.designation} · @{currentUser.username}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[9px] font-semibold">
                    <ShieldCheck size={9} className={isAuthenticated ? 'text-emerald-500' : 'text-rose-500'} />
                    <span className={isAuthenticated ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}>
                      {isAuthenticated ? L('Authenticated session', 'প্রমাণিত সেশন') : L('Read-only session', 'শুধুমাত্র পাঠযোগ্য সেশন')}
                    </span>
                  </p>
                </div>
              </div>
              <div className="p-1.5">
                <p className="px-1.5 pb-1 pt-0.5 text-[8px] font-bold uppercase tracking-[0.13em] text-ink-400">
                  {L('Switch role', 'ভূমিকা পরিবর্তন')}
                </p>
                {USER_ROLES.map((role) => {
                  const roleUser = users.find((user) => user.is_active && user.role === role);
                  const active = isAuthenticated && currentUser.role === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleRole(role)}
                      disabled={!roleUser}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        active ? 'bg-vault-50 ring-1 ring-inset ring-vault-100 dark:bg-vault-500/[0.08] dark:ring-vault-500/15' : 'hover:bg-ink-100/60 dark:hover:bg-white/[0.045]'
                      }`}
                    >
                      <span className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[7.5px] font-bold uppercase tracking-[0.04em] ${ROLE_TONE[role]}`}>
                        {role}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-semibold text-ink-700">
                          {roleUser?.full_name ?? L('No active user', 'কোনো সক্রিয় ব্যবহারকারী নেই')}
                        </span>
                        <span className="block truncate text-[8.5px] text-ink-400">
                          {L(ROLE_LABELS[role].note_en, ROLE_LABELS[role].note_bn)}
                        </span>
                      </span>
                      {active ? <Check size={13} className="shrink-0 text-brand-bright" /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-line/70 px-2 py-2">
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    onOpenAccess();
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-[10px] font-semibold text-ink-600 transition hover:border-line-strong hover:text-ink-900"
                >
                  <ShieldCheck size={11} /> {L('Access & roles', 'প্রবেশ ও ভূমিকা')}
                </button>
              </div>
            </Popover>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.vault.json,application/json"
        onChange={handleImport}
        className="hidden"
        aria-label={L('Restore vault file', 'ভল্ট ফাইল পুনরুদ্ধার')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Small control primitives
// ---------------------------------------------------------------------------------------------

function Popover({
  open,
  align,
  width,
  label,
  children,
}: {
  open: boolean;
  align: 'left' | 'right';
  width: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.99 }}
          transition={MENU_TRANSITION}
          className={`glass-panel absolute top-full z-50 mt-2 overflow-hidden rounded-2xl ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          role="dialog"
          aria-label={label}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[10px] font-semibold text-ink-700">{label}</span>
        <div className="lv-seg shrink-0 !p-[3px]" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
              data-active={value === option.value}
              className="lv-seg-item !rounded-lg !px-2 !py-1 !text-[9px]"
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {hint ? <p className="mt-1 text-[8.5px] leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'LV'
  );
}

export default TopBar;
