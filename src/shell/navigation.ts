// Production navigation for the server-backed application.
//
// This module is deliberately free of React and API imports so the role-aware navigation can be
// unit-tested. The server remains the authority for every action; these rules only decide which
// entry points are worth showing and prevent an obviously unauthorised screen from loading.

import type { ServerPermission } from '../auth/types';

export type NavigationGroupKey = 'OVERVIEW' | 'REVENUE' | 'SPEND' | 'CASH' | 'ACCOUNTING' | 'CONTROL' | 'ADMIN';

export type NavigationIcon =
  | 'home'
  | 'sales'
  | 'purchases'
  | 'banking'
  | 'treasury'
  | 'ledger'
  | 'inventory'
  | 'masters'
  | 'reports'
  | 'close'
  | 'audit'
  | 'setup'
  | 'team'
  | 'account';

export type SectionKey =
  | 'HOME'
  | 'SALES'
  | 'PURCHASES'
  | 'BANKING'
  | 'TREASURY'
  | 'LEDGER'
  | 'INVENTORY'
  | 'MASTERS'
  | 'REPORTS'
  | 'CLOSE'
  | 'AUDIT'
  | 'SETUP'
  | 'TEAM'
  | 'ACCOUNT';

export interface NavigationGroup {
  key: NavigationGroupKey;
  labelEn: string;
  labelBn: string;
}

/** Permission rules are expressed as sets; an empty rule means "every authenticated member". */
export interface NavigationPermissionRule {
  companyAny?: ServerPermission[];
  companyAll?: ServerPermission[];
  organisationPermission?: ServerPermission;
  /** Alternative rule while the user has no active company (for example first-company setup). */
  noCompany?: NavigationPermissionRule;
}

export interface NavigationSection {
  key: SectionKey;
  path: string;
  group: NavigationGroupKey;
  icon: NavigationIcon;
  labelEn: string;
  labelBn: string;
  descriptionEn: string;
  descriptionBn: string;
  permission: NavigationPermissionRule;
}

export interface NavigationAccess {
  /** False when the membership has no active company yet. */
  hasCompany: boolean;
  hasCompanyPermission: (permission: ServerPermission) => boolean;
  hasOrganisationPermission: (permission: ServerPermission) => boolean;
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  { key: 'OVERVIEW', labelEn: 'Overview', labelBn: 'সারসংক্ষেপ' },
  { key: 'REVENUE', labelEn: 'Sales', labelBn: 'বিক্রয়' },
  { key: 'SPEND', labelEn: 'Purchases', labelBn: 'ক্রয়' },
  { key: 'CASH', labelEn: 'Cash & treasury', labelBn: 'নগদ ও কোষাগার' },
  { key: 'ACCOUNTING', labelEn: 'Accounting', labelBn: 'হিসাবরক্ষণ' },
  { key: 'CONTROL', labelEn: 'Reports & controls', labelBn: 'রিপোর্ট ও নিয়ন্ত্রণ' },
  { key: 'ADMIN', labelEn: 'Administration', labelBn: 'প্রশাসন' },
];

export const NAVIGATION_SECTIONS: readonly NavigationSection[] = [
  {
    key: 'HOME',
    path: '/app',
    group: 'OVERVIEW',
    icon: 'home',
    labelEn: 'Home',
    labelBn: 'হোম',
    descriptionEn: 'What needs attention today.',
    descriptionBn: 'আজ কী মনোযোগ প্রয়োজন।',
    permission: {},
  },
  {
    key: 'SALES',
    path: '/app/sales',
    group: 'REVENUE',
    icon: 'sales',
    labelEn: 'Sales & receivables',
    labelBn: 'বিক্রয় ও প্রাপ্য',
    descriptionEn: 'Invoices, credit notes, receipts and AR ageing.',
    descriptionBn: 'চালান, ক্রেডিট নোট, রিসিট ও প্রাপ্য এজিং।',
    permission: { companyAny: ['CREATE_COMMERCIAL_DRAFT', 'VIEW_REPORTS', 'VIEW_LIMITED_REPORTS'] },
  },
  {
    key: 'PURCHASES',
    path: '/app/purchases',
    group: 'SPEND',
    icon: 'purchases',
    labelEn: 'Purchases & payables',
    labelBn: 'ক্রয় ও প্রদেয়',
    descriptionEn: 'Bills, expense vouchers, payments and AP ageing.',
    descriptionBn: 'বিল, ব্যয় ভাউচার, পরিশোধ ও প্রদেয় এজিং।',
    permission: { companyAny: ['CREATE_COMMERCIAL_DRAFT', 'VIEW_REPORTS', 'VIEW_LIMITED_REPORTS'] },
  },
  {
    key: 'BANKING',
    path: '/app/banking',
    group: 'CASH',
    icon: 'banking',
    labelEn: 'Banking & reconciliation',
    labelBn: 'ব্যাংকিং ও মিলকরণ',
    descriptionEn: 'Statement import, matching, fees and sign-off.',
    descriptionBn: 'স্টেটমেন্ট আমদানি, মিলকরণ, ফি ও অনুমোদন।',
    permission: { companyAny: ['VIEW_REPORTS', 'POST_TO_GL'] },
  },
  {
    key: 'TREASURY',
    path: '/app/treasury',
    group: 'CASH',
    icon: 'treasury',
    labelEn: 'Treasury & certificates',
    labelBn: 'কোষাগার ও প্রত্যয়নপত্র',
    descriptionEn: 'Withholding liabilities, challans, deposits and certificates.',
    descriptionBn: 'উৎসে কর দায়, চালান, জমা ও প্রত্যয়নপত্র।',
    permission: { companyAny: ['VIEW_REPORTS', 'POST_TO_GL'] },
  },
  {
    key: 'LEDGER',
    path: '/app/ledger',
    group: 'ACCOUNTING',
    icon: 'ledger',
    labelEn: 'General ledger',
    labelBn: 'সাধারণ খতিয়ান',
    descriptionEn: 'Journals, trial balance, periods and opening balances.',
    descriptionBn: 'জার্নাল, রেওয়ামিল, হিসাবকাল ও উদ্বোধনী ব্যালেন্স।',
    permission: { companyAny: ['VIEW_REPORTS', 'POST_TO_GL'] },
  },
  {
    key: 'INVENTORY',
    path: '/app/inventory',
    group: 'ACCOUNTING',
    icon: 'inventory',
    labelEn: 'Inventory',
    labelBn: 'মজুদ',
    descriptionEn: 'Stock moves, valuation and the inventory control proof.',
    descriptionBn: 'স্টক চলাচল, মূল্যায়ন ও মজুদ নিয়ন্ত্রণ প্রমাণ।',
    permission: { companyAny: ['VIEW_REPORTS', 'MANAGE_MASTERS_AND_COA', 'DISPATCH_OR_RECEIVE_STOCK'] },
  },
  {
    key: 'MASTERS',
    path: '/app/masters',
    group: 'ACCOUNTING',
    icon: 'masters',
    labelEn: 'Master data',
    labelBn: 'মাস্টার ডেটা',
    descriptionEn: 'Parties, items, branches and warehouses.',
    descriptionBn: 'পক্ষ, আইটেম, শাখা ও গুদাম।',
    permission: { companyAll: ['MANAGE_MASTERS_AND_COA'] },
  },
  {
    key: 'REPORTS',
    path: '/app/reports',
    group: 'CONTROL',
    icon: 'reports',
    labelEn: 'Reports & statements',
    labelBn: 'রিপোর্ট ও বিবরণী',
    descriptionEn: 'Management accounts, registers and draft statutory schedules.',
    descriptionBn: 'ব্যবস্থাপনা হিসাব, রেজিস্টার ও খসড়া সংবিধিবদ্ধ সূচি।',
    permission: { companyAll: ['VIEW_REPORTS'] },
  },
  {
    key: 'CLOSE',
    path: '/app/close',
    group: 'CONTROL',
    icon: 'close',
    labelEn: 'Close & controls',
    labelBn: 'সমাপনী ও নিয়ন্ত্রণ',
    descriptionEn: 'Control proofs, close runs and suspense resolution.',
    descriptionBn: 'নিয়ন্ত্রণ প্রমাণ, সমাপনী রান ও সাসপেন্স নিষ্পত্তি।',
    permission: { companyAll: ['VIEW_REPORTS'] },
  },
  {
    key: 'AUDIT',
    path: '/app/audit',
    group: 'CONTROL',
    icon: 'audit',
    labelEn: 'Audit log',
    labelBn: 'অডিট লগ',
    descriptionEn: 'Append-only evidence of material actions.',
    descriptionBn: 'গুরুত্বপূর্ণ কার্যক্রমের সংযোজন-শুধু প্রমাণ।',
    permission: { companyAll: ['VIEW_REPORTS'] },
  },
  {
    key: 'SETUP',
    path: '/app/setup',
    group: 'ADMIN',
    icon: 'setup',
    labelEn: 'Company setup',
    labelBn: 'কোম্পানি সেটআপ',
    descriptionEn: 'Company profile, chart of accounts, periods and settings.',
    descriptionBn: 'কোম্পানি প্রোফাইল, হিসাবের চার্ট, হিসাবকাল ও সেটিংস।',
    permission: {
      companyAll: ['MANAGE_COMPANY_SETTINGS'],
      noCompany: { organisationPermission: 'MANAGE_USERS_AND_ORG' },
    },
  },
  {
    key: 'TEAM',
    path: '/app/team',
    group: 'ADMIN',
    icon: 'team',
    labelEn: 'Team & access',
    labelBn: 'টিম ও প্রবেশাধিকার',
    descriptionEn: 'Invitations, roles and company scope.',
    descriptionBn: 'আমন্ত্রণ, ভূমিকা ও কোম্পানি পরিধি।',
    permission: { organisationPermission: 'MANAGE_USERS_AND_ORG' },
  },
  {
    key: 'ACCOUNT',
    path: '/app/account',
    group: 'ADMIN',
    icon: 'account',
    labelEn: 'Account & sessions',
    labelBn: 'অ্যাকাউন্ট ও সেশন',
    descriptionEn: 'Password, active sessions and sign-out.',
    descriptionBn: 'পাসওয়ার্ড, সক্রিয় সেশন ও সাইন আউট।',
    permission: {},
  },
];

export const SECTION_BY_KEY: Readonly<Record<SectionKey, NavigationSection>> = Object.fromEntries(
  NAVIGATION_SECTIONS.map((section) => [section.key, section]),
) as Record<SectionKey, NavigationSection>;

export function canAccessSection(section: NavigationSection, access: NavigationAccess): boolean {
  const rule = !access.hasCompany && section.permission.noCompany ? section.permission.noCompany : section.permission;
  if (rule.organisationPermission && !access.hasOrganisationPermission(rule.organisationPermission)) return false;
  if (rule.companyAll && !rule.companyAll.every((permission) => access.hasCompanyPermission(permission))) return false;
  if (rule.companyAny && rule.companyAny.length > 0) {
    if (!rule.companyAny.some((permission) => access.hasCompanyPermission(permission))) return false;
  }
  return true;
}

export function visibleNavigationSections(access: NavigationAccess): NavigationSection[] {
  return NAVIGATION_SECTIONS.filter((section) => canAccessSection(section, access));
}

export interface NavigationResult {
  section: NavigationSection;
  /** True when the path is the canonical link destination (the root of the section). */
  canonical: boolean;
  /** A URL-safe alias that should be normalised to a query-driven screen. */
  redirectTo?: string;
}

const FIXED_ALIASES: Readonly<Record<string, string>> = {
  '/app/sales/new': '/app/sales?new=1',
  '/app/sales/invoices': '/app/sales?tab=INVOICES',
  '/app/sales/credit-notes': '/app/sales?tab=CREDIT_NOTES',
  '/app/sales/credit-notes/new': '/app/sales?tab=CREDIT_NOTES&new=credit',
  '/app/sales/receipts': '/app/sales?tab=RECEIPTS',
  '/app/sales/ageing': '/app/sales?tab=AGEING',
  '/app/purchases/new': '/app/purchases?new=1',
  '/app/purchases/expense/new': '/app/purchases?new=expense',
  '/app/purchases/bills': '/app/purchases?tab=BILLS',
  '/app/purchases/payments': '/app/purchases?tab=PAYMENTS',
  '/app/ledger/new': '/app/ledger?tab=NEW',
  '/app/ledger/trial-balance': '/app/ledger?tab=TRIAL_BALANCE',
  '/app/ledger/periods': '/app/ledger?tab=PERIODS',
  '/app/reports/vat-return': '/app/reports?report=VAT_RETURN_DRAFT',
  '/app/reports/trial-balance': '/app/reports?report=TRIAL_BALANCE',
  '/app/reports/ar-ageing': '/app/reports?report=AR_AGEING',
  '/app/reports/ap-ageing': '/app/reports?report=AP_AGEING',
};

const DOCUMENT_ALIASES: ReadonlyArray<{ pattern: RegExp; section: SectionKey; target: (id: string) => string }> = [
  {
    pattern: /^\/app\/sales\/invoices\/([^/]+)$/,
    section: 'SALES',
    target: (id) => `/app/sales?document=${encodeURIComponent(id)}`,
  },
  {
    pattern: /^\/app\/sales\/credit-notes\/([^/]+)$/,
    section: 'SALES',
    target: (id) => `/app/sales?tab=CREDIT_NOTES&document=${encodeURIComponent(id)}`,
  },
  {
    pattern: /^\/app\/sales\/receipts\/([^/]+)$/,
    section: 'SALES',
    target: (id) => `/app/sales?tab=RECEIPTS&receipt=${encodeURIComponent(id)}`,
  },
  {
    pattern: /^\/app\/purchases\/bills\/([^/]+)$/,
    section: 'PURCHASES',
    target: (id) => `/app/purchases?document=${encodeURIComponent(id)}`,
  },
  {
    pattern: /^\/app\/purchases\/payments\/([^/]+)$/,
    section: 'PURCHASES',
    target: (id) => `/app/purchases?tab=PAYMENTS&payment=${encodeURIComponent(id)}`,
  },
  {
    pattern: /^\/app\/ledger\/journals\/([^/]+)$/,
    section: 'LEDGER',
    target: (id) => `/app/ledger?journal=${encodeURIComponent(id)}`,
  },
];

/**
 * Resolve an application path to a section. Paths below a section are not silently treated as the
 * list page; only explicit aliases are normalised. A broken deep link renders a 404 instead of
 * pretending to be valid.
 */
export function resolveNavigationPath(pathname: string): NavigationResult | null {
  const normalised = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalised === '/app' || normalised === '/app/home') {
    return { section: SECTION_BY_KEY.HOME, canonical: true };
  }
  const section = NAVIGATION_SECTIONS.find((candidate) => candidate.path === normalised);
  if (section) return { section, canonical: true };
  const redirectTo = FIXED_ALIASES[normalised];
  if (redirectTo) {
    const target = [...NAVIGATION_SECTIONS]
      .filter((candidate) => redirectTo.startsWith(candidate.path))
      .sort((left, right) => right.path.length - left.path.length)[0];
    return { section: target ?? SECTION_BY_KEY.HOME, canonical: false, redirectTo };
  }
  for (const alias of DOCUMENT_ALIASES) {
    const match = alias.pattern.exec(normalised);
    if (match?.[1]) {
      return { section: SECTION_BY_KEY[alias.section], canonical: false, redirectTo: alias.target(match[1]) };
    }
  }
  return null;
}

export function navigationGroup(key: NavigationGroupKey): NavigationGroup {
  return NAVIGATION_GROUPS.find((group) => group.key === key) ?? NAVIGATION_GROUPS[0]!;
}

export function isKnownApplicationPrefix(pathname: string): boolean {
  return NAVIGATION_SECTIONS.some(
    (section) => pathname === section.path || pathname.startsWith(`${section.path}/`),
  );
}
