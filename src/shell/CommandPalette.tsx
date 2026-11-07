import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Building2,
  FilePlus2,
  FileText,
  Landmark,
  Loader2,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { ServerPermission } from '../auth/types';
import { usePreferences } from '../preferences/AppPreferences';
import { masterApi } from '../masters/api';
import { setupApi } from '../setup/api';
import { salesApi } from '../sales/api';
import { purchaseApi } from '../purchases/api';
import { ledgerApi } from '../ledger/api';
import { visibleNavigationSections, type NavigationSection } from './navigation';

type RowKind = 'NAVIGATION' | 'ACTION' | 'ENTITY';

interface PaletteRow {
  id: string;
  kind: RowKind;
  label: string;
  detail: string;
  href: string;
  icon: typeof Search;
}

interface ActionDefinition {
  id: string;
  labelEn: string;
  labelBn: string;
  detailEn: string;
  detailBn: string;
  href: string;
  icon: typeof Search;
  permissions: ServerPermission[];
  anyPermission?: boolean;
}

const FIXED_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'new-invoice',
    labelEn: 'Create a sales invoice',
    labelBn: 'বিক্রয় চালান তৈরি করুন',
    detailEn: 'Sales → New invoice',
    detailBn: 'বিক্রয় → নতুন চালান',
    href: '/app/sales?new=1',
    icon: FilePlus2,
    permissions: ['CREATE_COMMERCIAL_DRAFT'],
  },
  {
    id: 'new-bill',
    labelEn: 'Record a purchase bill',
    labelBn: 'ক্রয় বিল লিপিবদ্ধ করুন',
    detailEn: 'Purchases → New bill',
    detailBn: 'ক্রয় → নতুন বিল',
    href: '/app/purchases?new=1',
    icon: ShoppingCart,
    permissions: ['CREATE_COMMERCIAL_DRAFT'],
  },
  {
    id: 'receipt',
    labelEn: 'Record a customer receipt',
    labelBn: 'গ্রাহকের প্রাপ্তি লিপিবদ্ধ করুন',
    detailEn: 'Sales → Receipts',
    detailBn: 'বিক্রয় → প্রাপ্তি',
    href: '/app/sales?tab=RECEIPTS',
    icon: Receipt,
    permissions: ['POST_TO_GL'],
  },
  {
    id: 'payment',
    labelEn: 'Pay a supplier',
    labelBn: 'সরবরাহকারীকে পরিশোধ করুন',
    detailEn: 'Purchases → Payments',
    detailBn: 'ক্রয় → পরিশোধ',
    href: '/app/purchases?tab=PAYMENTS',
    icon: Landmark,
    permissions: ['POST_TO_GL'],
  },
  {
    id: 'new-journal',
    labelEn: 'Post a general journal',
    labelBn: 'সাধারণ জার্নাল পোস্ট করুন',
    detailEn: 'General ledger → New journal',
    detailBn: 'সাধারণ খতিয়ান → নতুন জার্নাল',
    href: '/app/ledger?tab=NEW',
    icon: BookOpen,
    permissions: ['POST_TO_GL'],
  },
  {
    id: 'reconcile',
    labelEn: 'Reconcile bank or MFS',
    labelBn: 'ব্যাংক বা এমএফএস মিলকরণ',
    detailEn: 'Banking → Reconciliation',
    detailBn: 'ব্যাংকিং → মিলকরণ',
    href: '/app/banking',
    icon: Landmark,
    permissions: ['VIEW_REPORTS', 'POST_TO_GL'],
    anyPermission: true,
  },
  {
    id: 'reports',
    labelEn: 'Open management reports',
    labelBn: 'ব্যবস্থাপনা রিপোর্ট খুলুন',
    detailEn: 'Reports & statements',
    detailBn: 'রিপোর্ট ও বিবরণী',
    href: '/app/reports',
    icon: FileText,
    permissions: ['VIEW_REPORTS'],
  },
  {
    id: 'close',
    labelEn: 'Prepare the period close',
    labelBn: 'হিসাবকাল সমাপনী প্রস্তুত করুন',
    detailEn: 'Close & controls',
    detailBn: 'সমাপনী ও নিয়ন্ত্রণ',
    href: '/app/close',
    icon: Building2,
    permissions: ['SUBMIT_CLOSE_MAKER', 'VIEW_REPORTS'],
    anyPermission: true,
  },
  {
    id: 'masters',
    labelEn: 'Open master data',
    labelBn: 'মাস্টার ডেটা খুলুন',
    detailEn: 'Parties, items, branches and warehouses',
    detailBn: 'পক্ষ, আইটেম, শাখা ও গুদাম',
    href: '/app/masters',
    icon: Users,
    permissions: ['MANAGE_MASTERS_AND_COA'],
  },
  {
    id: 'audit',
    labelEn: 'Open the audit log',
    labelBn: 'অডিট লগ খুলুন',
    detailEn: 'Append-only evidence of material actions',
    detailBn: 'গুরুত্বপূর্ণ কার্যক্রমের সংযোজন-শুধু প্রমাণ',
    href: '/app/audit',
    icon: ShieldCheck,
    permissions: ['VIEW_REPORTS'],
  },
  {
    id: 'setup',
    labelEn: 'Open company setup',
    labelBn: 'কোম্পানি সেটআপ খুলুন',
    detailEn: 'Company profile, chart of accounts and periods',
    detailBn: 'কোম্পানি প্রোফাইল, হিসাবের চার্ট ও হিসাবকাল',
    href: '/app/setup',
    icon: Building2,
    permissions: ['MANAGE_COMPANY_SETTINGS'],
  },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);
  const [query, setQuery] = useState('');
  const [entityRows, setEntityRows] = useState<PaletteRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tokenRef = useRef(0);
  const companyId = auth.activeCompany?.id ?? '';

  const can = useCallback(
    (permissions: ServerPermission[]) => permissions.some((permission) => auth.hasCompanyPermission(permission)),
    [auth],
  );

  const navigationRows = useMemo<PaletteRow[]>(() => {
    return visibleNavigationSections(auth)
      .filter((section) => section.key !== 'HOME')
      .map((section: NavigationSection) => ({
        id: `nav:${section.key}`,
        kind: 'NAVIGATION',
        label: L(section.labelEn, section.labelBn),
        detail: L(section.descriptionEn, section.descriptionBn),
        href: section.path,
        icon: iconFor(section),
      }));
  }, [auth, L]);

  const actionRows = useMemo<PaletteRow[]>(
    () =>
      FIXED_ACTIONS.filter((action) =>
        action.anyPermission ? can(action.permissions) : action.permissions.every((permission) => can([permission])),
      ).map((action) => ({
        id: `action:${action.id}`,
        kind: 'ACTION',
        label: L(action.labelEn, action.labelBn),
        detail: L(action.detailEn, action.detailBn),
        href: action.href,
        icon: action.icon,
      })),
    [can, L],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setEntityRows([]);
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // Return focus to the control that opened the palette.
      previous?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !companyId) return undefined;
    const term = query.trim();
    if (term.length < 2) {
      setEntityRows([]);
      setSearching(false);
      return undefined;
    }
    const token = ++tokenRef.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchEntities(term)
        .then((rows) => {
          if (token !== tokenRef.current) return;
          setEntityRows(rows);
          setActiveIndex(0);
        })
        .catch(() => {
          if (token === tokenRef.current) setEntityRows([]);
        })
        .finally(() => {
          if (token === tokenRef.current) setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
    // `searchEntities` is intentionally recreated only when its permission scope or company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, open, query, auth, locale]);

  async function searchEntities(term: string): Promise<PaletteRow[]> {
    if (!companyId) return [];
    const requests: Array<Promise<PaletteRow[]>> = [];
    const canReadSales = can(['CREATE_COMMERCIAL_DRAFT', 'VIEW_REPORTS', 'VIEW_LIMITED_REPORTS']);
    const canReadMasters = can(['MANAGE_MASTERS_AND_COA', 'CREATE_COMMERCIAL_DRAFT', 'VIEW_REPORTS']);
    if (canReadSales) {
      requests.push(
        salesApi
          .documents(companyId, { search: term, limit: 5 })
          .then((response) =>
            response.entries.map((entry) => ({
              id: `sales:${entry.id}`,
              kind: 'ENTITY' as const,
              label: entry.documentNo ?? L('Draft invoice', 'খসড়া চালান'),
              detail: `${L('Sales', 'বিক্রয়')} · ${entry.partyNameEn} · ${entry.status}`,
              href: `/app/sales?document=${encodeURIComponent(entry.id)}`,
              icon: Receipt,
            })),
          ),
      );
      requests.push(
        purchaseApi
          .documents(companyId, { search: term, limit: 5 })
          .then((response) =>
            response.entries.map((entry) => ({
              id: `purchase:${entry.id}`,
              kind: 'ENTITY' as const,
              label: entry.documentNo ?? entry.supplierInvoiceNo,
              detail: `${L('Purchase', 'ক্রয়')} · ${entry.partyNameEn} · ${entry.status}`,
              href: `/app/purchases?document=${encodeURIComponent(entry.id)}`,
              icon: ShoppingCart,
            })),
          ),
      );
    }
    if (canReadMasters) {
      requests.push(
        masterApi.parties(companyId, { search: term, pageSize: 5 }).then((response) =>
          response.parties.map((party) => ({
            id: `party:${party.id}`,
            kind: 'ENTITY' as const,
            label: party.nameEn,
            detail: `${L('Party', 'পক্ষ')} · ${party.code} · ${party.type}`,
            href: `/app/masters?tab=PARTIES&search=${encodeURIComponent(party.code)}`,
            icon: Users,
          })),
        ),
      );
      requests.push(
        masterApi.items(companyId, { search: term, pageSize: 5 }).then((response) =>
          response.items.map((item) => ({
            id: `item:${item.id}`,
            kind: 'ENTITY' as const,
            label: item.nameEn,
            detail: `${L('Item', 'আইটেম')} · ${item.sku} · ${item.unit}`,
            href: `/app/masters?tab=ITEMS&search=${encodeURIComponent(item.sku)}`,
            icon: Package,
          })),
        ),
      );
      requests.push(
        setupApi.accounts(companyId, { search: term }).then((response) =>
          response.accounts.slice(0, 5).map((account) => ({
            id: `account:${account.id}`,
            kind: 'ENTITY' as const,
            label: `${account.code} · ${account.nameEn}`,
            detail: `${L('Account', 'হিসাব')} · ${account.accountType} · ${account.controlSubledger}`,
            href: `/app/setup?step=CHART_OF_ACCOUNTS&account=${encodeURIComponent(account.code)}`,
            icon: FileText,
          })),
        ),
      );
    }
    if (auth.hasCompanyPermission('VIEW_REPORTS')) {
      requests.push(
        ledgerApi.journals(companyId, { q: term, limit: 5 }).then((response) =>
          response.entries.map((entry) => ({
            id: `journal:${entry.id}`,
            kind: 'ENTITY' as const,
            label: entry.journalNumber ?? L('Draft journal', 'খসড়া জার্নাল'),
            detail: `${L('Journal', 'জার্নাল')} · ${entry.narrationEn} · ${entry.status}`,
            href: `/app/ledger?journal=${encodeURIComponent(entry.id)}`,
            icon: BookOpen,
          })),
        ),
      );
    }
    const settled = await Promise.allSettled(requests);
    return settled
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .slice(0, 12);
  }

  const filterRows = useCallback(
    (rows: PaletteRow[]) => {
      const term = query.trim().toLowerCase();
      if (!term) return rows.slice(0, 8);
      return rows
        .filter((row) => `${row.label} ${row.detail}`.toLowerCase().includes(term))
        .slice(0, 8);
    },
    [query],
  );

  const rows = useMemo(
    () => [...filterRows(navigationRows), ...filterRows(actionRows), ...entityRows],
    [actionRows, entityRows, filterRows, navigationRows],
  );

  useEffect(() => {
    setActiveIndex((index) => (rows.length === 0 ? 0 : Math.min(index, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openRow = (row: PaletteRow | undefined) => {
    if (!row) return;
    onClose();
    navigate(row.href);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openRow(rows[activeIndex]);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-ql-ink/45" aria-hidden onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={L('Search and commands', 'অনুসন্ধান ও কমান্ড')}
        className="relative w-full max-w-2xl overflow-hidden rounded-ql-modal border border-ql-border bg-ql-surface shadow-ql-popover"
      >
        <div className="flex items-center gap-2.5 border-b border-ql-border px-4 py-1">
          <Search size={19} className="shrink-0 text-ql-accent" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={L('Search documents, parties, items, journals, or screens…', 'ডকুমেন্ট, পক্ষ, আইটেম, জার্নাল বা স্ক্রিন খুঁজুন…')}
            aria-label={L('Search', 'অনুসন্ধান')}
            aria-controls="command-palette-results"
            aria-activedescendant={rows.length > 0 ? `palette-row-${activeIndex}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            className="min-h-14 w-full bg-transparent text-[15px] font-medium text-ql-ink outline-none placeholder:text-ql-ink-subtle"
          />
          {searching ? <Loader2 size={17} className="animate-spin text-ql-accent" aria-label={L('Searching', 'অনুসন্ধান চলছে')} /> : null}
          <kbd className="rounded-md border border-ql-border bg-ql-surface px-1.5 py-0.5 font-mono text-[11px] text-ql-ink-muted">Esc</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-ql-ink-muted">
              {query.trim().length < 2
                ? L('Type at least two characters to search records.', 'রেকর্ড খুঁজতে কমপক্ষে দুটি অক্ষর টাইপ করুন।')
                : searching
                  ? L('Searching…', 'অনুসন্ধান চলছে…')
                  : L('No matching records or screens.', 'মিলে যাওয়া কোনো রেকর্ড বা স্ক্রিন নেই।')}
            </div>
          ) : (
            <ul id="command-palette-results" ref={listRef} role="listbox" aria-label={L('Results', 'ফলাফল')}>
              {rows.map((row, index) => {
                const Icon = row.icon;
                return (
                  <li
                    key={row.id}
                    id={`palette-row-${index}`}
                    data-palette-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      openRow(row);
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-ql-control px-3 py-2.5 transition-colors ${
                      index === activeIndex ? 'bg-ql-accent/10 font-medium text-ql-ink dark:bg-ql-accent/20 dark:text-white' : 'text-ql-ink hover:bg-ql-surface-muted'
                    }`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${index === activeIndex ? 'bg-ql-accent text-white' : 'bg-ql-surface-muted text-ql-ink-muted'}`}>
                      <Icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{row.label}</span>
                      <span className="block truncate text-[12px] text-ql-ink-muted">{row.detail}</span>
                    </span>
                    <span className="shrink-0 rounded-md border border-ql-border px-1.5 py-0.5 text-[11px] font-medium text-ql-ink-subtle">
                      {row.kind === 'ENTITY' ? L('Record', 'রেকর্ড') : row.kind === 'ACTION' ? L('Action', 'কার্যক্রম') : L('Screen', 'স্ক্রিন')}
                    </span>
                    {index === activeIndex ? <ArrowRight size={15} className="shrink-0 text-ql-accent" aria-hidden /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-ql-border px-3 py-2 text-[12px] text-ql-ink-muted">
          <span>{L('↑ ↓ to move', '↑ ↓ চলুন')}</span>
          <span>{L('Enter to open', 'খুলতে Enter')}</span>
          <span>{L('Results are limited to the selected company and your permissions.', 'ফলাফল নির্বাচিত কোম্পানি ও আপনার অনুমতিতে সীমাবদ্ধ।')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function iconFor(section: NavigationSection): typeof Search {
  switch (section.icon) {
    case 'sales':
      return Receipt;
    case 'purchases':
      return ShoppingCart;
    case 'banking':
    case 'treasury':
      return Landmark;
    case 'ledger':
      return BookOpen;
    case 'inventory':
      return Package;
    case 'masters':
      return Users;
    case 'reports':
      return FileText;
    case 'close':
    case 'audit':
      return Building2;
    default:
      return Search;
  }
}

export default CommandPalette;
