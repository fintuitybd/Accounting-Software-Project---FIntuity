import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  CircleHelp,
  Languages,
  LogOut,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/roles';
import { usePreferences } from '../preferences/AppPreferences';
import { Dialog } from '../components/ui/Dialog';
import { navigationGroup, resolveNavigationPath } from './navigation';

export interface AppTopBarProps {
  currentPath: string;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
}

export function AppTopBar({ currentPath, onOpenMenu, onOpenPalette }: AppTopBarProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { locale, setLocale, theme, toggleTheme, publishToast } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const resolved = resolveNavigationPath(currentPath);
  const section = resolved?.section;
  const group = section ? navigationGroup(section.group) : null;
  const role = auth.activeCompany ? ROLE_LABELS[auth.activeCompany.role] : null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.logout();
      navigate('/login', { replace: true });
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('Sign-out failed', 'সাইন আউট ব্যর্থ'),
        message: error instanceof Error ? error.message : L('Your session was not ended. Try again.', 'আপনার সেশন শেষ হয়নি। আবার চেষ্টা করুন।'),
      });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ql-border bg-ql-surface/95 backdrop-blur supports-[backdrop-filter]:bg-ql-surface/85">
      <div className="flex min-h-16 items-center gap-2 px-3 sm:px-5 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink lg:hidden"
          aria-label={L('Open navigation', 'নেভিগেশন খুলুন')}
        >
          <Menu size={21} aria-hidden />
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-1.5 text-[13px] text-ql-ink-muted sm:flex">
          <Link to="/app" className="rounded-ql-control px-1.5 py-1 hover:bg-ql-surface-muted hover:text-ql-ink">
            {L('Home', 'হোম')}
          </Link>
          {group && section && section.key !== 'HOME' ? (
            <>
              <span aria-hidden className="text-ql-ink-subtle">/</span>
              <span>{L(group.labelEn, group.labelBn)}</span>
              <span aria-hidden className="text-ql-ink-subtle">/</span>
              <span className="truncate font-medium text-ql-ink" aria-current="page">
                {L(section.labelEn, section.labelBn)}
              </span>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex h-11 items-center gap-2 rounded-ql-control border border-ql-border px-3 text-[13px] text-ql-ink-muted hover:border-ql-border-strong hover:text-ql-ink"
          >
            <Search size={17} aria-hidden />
            <span className="sr-only">{L('Search or jump to', 'খুঁজুন বা যান')}</span>
            <span className="hidden sm:inline" aria-hidden>{L('Search', 'খুঁজুন')}</span>
            <kbd className="hidden rounded border border-ql-border px-1.5 py-0.5 font-mono text-[12px] sm:inline">Ctrl K</kbd>
          </button>

          <button
            type="button"
            onClick={() => setLocale(locale === 'bn-BD' ? 'en-BD' : 'bn-BD')}
            className="flex h-11 items-center gap-1 rounded-ql-control px-2.5 text-[13px] font-medium text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink"
            aria-label={locale === 'bn-BD' ? 'বাংলা — ইংরেজিতে পরিবর্তন করুন' : 'English — switch to Bangla'}
          >
            <Languages size={17} aria-hidden />
            <span className="hidden sm:inline">{locale === 'bn-BD' ? 'বাংলা' : 'English'}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="grid h-11 w-11 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink"
            aria-label={theme === 'DARK' ? L('Use light theme', 'হালকা থিম ব্যবহার করুন') : L('Use dark theme', 'গাঢ় থিম ব্যবহার করুন')}
          >
            {theme === 'DARK' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-ql-control text-ql-ink-muted hover:bg-ql-surface-muted hover:text-ql-ink"
            aria-label={L('Help and keyboard shortcuts', 'সহায়তা ও কীবোর্ড শর্টকাট')}
          >
            <CircleHelp size={18} aria-hidden />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-11 items-center gap-2 rounded-ql-control px-2 text-left hover:bg-ql-surface-muted"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-ql-brand-soft text-[13px] font-semibold text-ql-brand">
                {initials(auth.user?.name ?? auth.user?.email ?? '?')}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-[150px] truncate text-[13px] font-medium leading-4 text-ql-ink">
                  {auth.user?.name ?? L('Signed in', 'সাইন ইন করা')}
                </span>
                <span className="block max-w-[150px] truncate text-[12px] leading-4 text-ql-ink-muted">
                  {role ? L(role.label_en, role.label_bn) : auth.activeMembership?.role ?? ''}
                </span>
              </span>
              <ChevronDown size={16} aria-hidden className="text-ql-ink-subtle" />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                aria-label={L('Account menu', 'অ্যাকাউন্ট মেনু')}
                className="absolute right-0 mt-1 w-[260px] overflow-hidden rounded-ql border border-ql-border bg-ql-surface p-1.5 shadow-ql-popover"
              >
                <div className="border-b border-ql-border px-2.5 py-2">
                  <p className="truncate text-[13px] font-semibold text-ql-ink">{auth.user?.name}</p>
                  <p className="truncate text-[12px] text-ql-ink-muted">{auth.user?.email}</p>
                  {role ? (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-ql-ink-muted">
                      <ShieldCheck size={13} aria-hidden /> {L(role.label_en, role.label_bn)}
                    </p>
                  ) : null}
                </div>
                <Link
                  to="/app/account"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-10 items-center gap-2 rounded-ql-control px-2.5 text-[13px] text-ql-ink hover:bg-ql-surface-muted"
                >
                  <UserRound size={16} aria-hidden /> {L('Account & sessions', 'অ্যাকাউন্ট ও সেশন')}
                </Link>
                {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') ? (
                  <Link
                    to="/app/team"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-10 items-center gap-2 rounded-ql-control px-2.5 text-[13px] text-ql-ink hover:bg-ql-surface-muted"
                  >
                    <Users size={16} aria-hidden /> {L('Team & access', 'টিম ও প্রবেশাধিকার')}
                  </Link>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className="flex min-h-10 w-full items-center gap-2 rounded-ql-control px-2.5 text-left text-[13px] text-ql-danger hover:bg-ql-danger-soft disabled:opacity-60"
                >
                  <LogOut size={16} aria-hidden /> {signingOut ? L('Signing out…', 'সাইন আউট হচ্ছে…') : L('Sign out', 'সাইন আউট')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={L('Help and keyboard shortcuts', 'সহায়তা ও কীবোর্ড শর্টকাট')}
        description={L(
          'Work from the navigation or the command palette. Every action is permission-checked by the server.',
          'নেভিগেশন বা কমান্ড প্যালেট থেকে কাজ করুন। প্রতিটি কার্যক্রম সার্ভার দ্বারা অনুমতি-যাচাইকৃত।',
        )}
      >
        <dl className="space-y-3 text-[13px] leading-6 text-ql-ink-muted">
          <div>
            <dt className="font-semibold text-ql-ink">Ctrl / ⌘ + K</dt>
            <dd>{L('Search documents, parties, items and journals, or jump to a screen.', 'ডকুমেন্ট, পক্ষ, আইটেম ও জার্নাল খুঁজুন বা স্ক্রিনে যান।')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ql-ink">Ctrl / ⌘ + B</dt>
            <dd>{L('Collapse or expand the navigation rail on desktop.', 'ডেস্কটপে নেভিগেশন রেল সংকুচিত বা প্রসারিত করুন।')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ql-ink">{L('Posting is irreversible', 'পোস্টিং অপরিবর্তনীয়')}</dt>
            <dd>
              {L(
                'Review the tax and journal preview before posting. Posted records can only be corrected through a linked reversal with a reason and the required permission.',
                'পোস্ট করার আগে কর ও জার্নাল প্রিভিউ পর্যালোচনা করুন। পোস্টকৃত রেকর্ড শুধুমাত্র কারণ ও প্রয়োজনীয় অনুমতিসহ সংযুক্ত রিভার্সালের মাধ্যমে সংশোধন করা যায়।',
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ql-ink">{L('Data and statutory limits', 'ডেটা ও সংবিধিবদ্ধ সীমা')}</dt>
            <dd>
              {L(
                'Screens show server-backed records from the selected company. Tax and statutory outputs remain drafts until a qualified professional reviews the applicable rules; this build does not file returns.',
                'স্ক্রিনগুলো নির্বাচিত কোম্পানির সার্ভার-ভিত্তিক রেকর্ড দেখায়। যোগ্য পেশাদার প্রযোজ্য নিয়ম পর্যালোচনা না করা পর্যন্ত কর ও সংবিধিবদ্ধ আউটপুট খসড়া থাকে; এই সংস্করণ রিটার্ন দাখিল করে না।',
              )}
            </dd>
          </div>
        </dl>
      </Dialog>
    </header>
  );
}

function initials(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\u0980-\u09FF ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default AppTopBar;
