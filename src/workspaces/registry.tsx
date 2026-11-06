// Fintuity Accounting Suite — the twelve-workspace map.
//
// One source of truth for the sidebar in the app shell and the Ctrl+K command palette. The twelve
// workspaces are grouped into four investor-facing chapters, each with a keyboard shortcut, a
// plain-English guided description and bilingual search vocabulary. Keeping the metadata here
// (rather than inside the shell) means the palette can search every workspace in English, Bangla
// and Banglish without importing — or duplicating — a single workspace component.

import {
  BookOpen,
  Building2,
  FileText,
  Gauge,
  Landmark,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';

import type { EntityType } from '../core/types';

/** Every lucide icon shares this component signature. */
export type WorkspaceIcon = typeof Gauge;

export type WorkspaceKey =
  | 'W01'
  | 'W02'
  | 'W03'
  | 'W04'
  | 'W05'
  | 'W06'
  | 'W07'
  | 'W08'
  | 'W09'
  | 'W10'
  | 'W11'
  | 'W12';

export type WorkspaceGroupKey =
  | 'CORE_OPERATIONS'
  | 'ACCOUNTING_REPORTS'
  | 'TAX_STATUTORY'
  | 'CORPORATE_ADMIN';

export interface WorkspaceDescriptor {
  key: WorkspaceKey;
  code: string;
  /** 1-based position in the twelve-workspace chapter (shown in the sidebar). */
  number: number;
  /** Display hint for the keyboard jump, e.g. "⌥1". */
  shortcut: string;
  label_en: string;
  label_bn: string;
  short_en: string;
  short_bn: string;
  hint_en: string;
  hint_bn: string;
  /** Plain-English helper shown in Guided mode. */
  guide_en: string;
  guide_bn: string;
  group: WorkspaceGroupKey;
  icon: WorkspaceIcon;
  /** English / statutory vocabulary the palette matches against. */
  keywords: readonly string[];
  /** Banglish transliterations users actually type ("kroy", "bikroy", "mushak", "beton"). */
  banglish: readonly string[];
}

export const WORKSPACE_GROUPS: ReadonlyArray<{
  key: WorkspaceGroupKey;
  label_en: string;
  label_bn: string;
  caption_en: string;
  caption_bn: string;
}> = [
  {
    key: 'CORE_OPERATIONS',
    label_en: 'Core operations',
    label_bn: 'মূল কার্যক্রম',
    caption_en: 'Daily revenue, spend and cash',
    caption_bn: 'দৈনিক আয়, ব্যয় ও নগদ',
  },
  {
    key: 'ACCOUNTING_REPORTS',
    label_en: 'Accounting & reports',
    label_bn: 'হিসাব ও প্রতিবেদন',
    caption_en: 'The books of record',
    caption_bn: 'রেকর্ডের খতিয়ান',
  },
  {
    key: 'TAX_STATUTORY',
    label_en: 'Tax & statutory (NBR)',
    label_bn: 'কর ও সংবিধিবদ্ধ (এনবিআর)',
    caption_en: 'NBR registers and treasury',
    caption_bn: 'এনবিআর রেজিস্টার ও কোষাগার',
  },
  {
    key: 'CORPORATE_ADMIN',
    label_en: 'Corporate & admin',
    label_bn: 'কর্পোরেট ও প্রশাসন',
    caption_en: 'People, governance and rules',
    caption_bn: 'জনবল, সুশাসন ও বিধি',
  },
];

export const WORKSPACES: readonly WorkspaceDescriptor[] = [
  {
    key: 'W01',
    code: 'W01',
    number: 1,
    shortcut: '⌥1',
    label_en: 'Executive & CFO cockpit',
    label_bn: 'নির্বাহী ও সিএফও ককপিট',
    short_en: 'Dashboard',
    short_bn: 'ড্যাশবোর্ড',
    hint_en: 'Liquidity, statutory tax, IFRS 18 margin, compliance rings, cash stress test',
    hint_bn: 'তারল্য, সংবিধিবদ্ধ কর, আইএফআরএস ১৮ মার্জিন, কমপ্লায়েন্স রিং, নগদ চাপ পরীক্ষা',
    guide_en:
      'Start here every morning. The four cards read cash, tax, profit and compliance in one glance; the composer below turns a plain sentence into a balanced journal.',
    guide_bn:
      'প্রতিদিন সকালে এখান থেকেই শুরু করুন। চারটি কার্ডে নগদ, কর, মুনাফা ও কমপ্লায়েন্স এক নজরে; নিচের কম্পোজার একটি সাধারণ বাক্যকে সুষম জার্নালে রূপ দেয়।',
    group: 'CORE_OPERATIONS',
    icon: Gauge,
    keywords: ['cockpit', 'dashboard', 'kpi', 'liquidity', 'cash forecast', 'composer', 'scenario', 'cfo', 'board'],
    banglish: ['dashboard', 'ki obostha', 'kokpit'],
  },
  {
    key: 'W02',
    code: 'W02',
    number: 2,
    shortcut: '⌥2',
    label_en: 'Sales & Mushak 6.3',
    label_bn: 'বিক্রয় ও মূসক ৬.৩',
    short_en: 'Sales & O2C',
    short_bn: 'বিক্রয় ও O2C',
    hint_en: 'Tax invoices, credit notes, Mushak 6.3 serials and receivables',
    hint_bn: 'কর চালান, ক্রেডিট নোট, মূসক ৬.৩ সিরিয়াল ও প্রাপ্য',
    guide_en:
      'Raise a tax invoice or credit note. Fintuity Accounting Suite allocates the Mushak 6.3 serial, computes VAT and VDS and posts the receivable in one step.',
    guide_bn:
      'কর চালান বা ক্রেডিট নোট তৈরি করুন। ফিনটুইটি অ্যাকাউন্টিং স্যুট মূসক ৬.৩ সিরিয়াল বরাদ্দ করে, ভ্যাট ও ভিডিএস হিসাব করে এক ধাপে প্রাপ্য পোস্ট করে।',
    group: 'CORE_OPERATIONS',
    icon: FileText,
    keywords: ['sales', 'sale', 'invoice', 'mushak 6.3', 'mushak', 'vat', 'customer', 'credit note', 'receivable'],
    banglish: ['bikroy', 'bikri', 'bechlam', 'chalan'],
  },
  {
    key: 'W03',
    code: 'W03',
    number: 3,
    shortcut: '⌥3',
    label_en: 'Purchases & VDS/TDS',
    label_bn: 'ক্রয় ও ভিডিএস/টিডিএস',
    short_en: 'Purchases & P2P',
    short_bn: 'ক্রয় ও P2P',
    hint_en: 'Bills, VDS 4.5%, TDS schedules and payables',
    hint_bn: 'বিল, ভিডিএস ৪.৫%, টিডিএস সিডিউল ও প্রদেয়',
    guide_en:
      'Record a supplier bill or expense. The engine applies VDS at 4.5% and the correct TDS nature, then holds the payable until you settle it.',
    guide_bn:
      'সরবরাহকারীর বিল বা ব্যয় রেকর্ড করুন। ইঞ্জিন ৪.৫% ভিডিএস ও সঠিক টিডিএস প্রকৃতি প্রয়োগ করে, নিষ্পত্তির আগ পর্যন্ত প্রদেয় ধরে রাখে।',
    group: 'CORE_OPERATIONS',
    icon: ShoppingCart,
    keywords: ['purchase', 'purchases', 'bill', 'supplier', 'vds', 'tds', 'withholding', 'payable', 'buy'],
    banglish: ['kroy', 'kroykora', 'kinlam', 'kena', 'dena'],
  },
  {
    key: 'W04',
    code: 'W04',
    number: 4,
    shortcut: '⌥4',
    label_en: 'Treasury challans & 6.6',
    label_bn: 'কোষাগার চালান ও ৬.৬',
    short_en: 'Treasury Challans & 6.6',
    short_bn: 'কোষাগার চালান ও ৬.৬',
    hint_en: 'Challans, deposits and VDS certificates',
    hint_bn: 'চালান, জমা ও ভিডিএস সনদ',
    guide_en:
      'Deposit withheld VAT, VDS or TDS to the Treasury. Each challan clears the liability, records the economic code and issues the 6.6 certificate trail.',
    guide_bn:
      'আটকানো ভ্যাট, ভিডিএস বা টিডিএস কোষাগারে জমা দিন। প্রতিটি চালান দায় পরিশোধ করে, অর্থনৈতিক কোড রেকর্ড করে ও ৬.৬ সনদ তৈরি করে।',
    group: 'TAX_STATUTORY',
    icon: Landmark,
    keywords: ['treasury', 'challan', 'deposit', 'vds certificate', 'mushak 6.6', 'economic code'],
    banglish: ['chalan', 'challan', 'kor', 'kar'],
  },
  {
    key: 'W05',
    code: 'W05',
    number: 5,
    shortcut: '⌥5',
    label_en: 'VAT registers & 9.1 return',
    label_bn: 'ভ্যাট রেজিস্টার ও ৯.১ রিটার্ন',
    short_en: 'VAT Registers & 9.1',
    short_bn: 'ভ্যাট রেজিস্টার ও ৯.১',
    hint_en: 'Mushak 9.1, 6.1 / 6.2 registers and input rebate',
    hint_bn: 'মূসক ৯.১, ৬.১ / ৬.২ রেজিস্টার ও ইনপুট রিবেট',
    guide_en:
      'Review the output and input registers, check the rebate disallowances and file the Mushak 9.1 return before the 15th.',
    guide_bn:
      'আউটপুট ও ইনপুট রেজিস্টার পর্যালোচনা করুন, রিবেট বাতিল যাচাই করুন এবং ১৫ তারিখের আগে মূসক ৯.১ রিটার্ন দাখিল করুন।',
    group: 'TAX_STATUTORY',
    icon: ReceiptText,
    keywords: ['vat', 'mushak 9.1', 'mushak', 'return', 'register', 'input credit', 'rebate', 'filing'],
    banglish: ['mushak', 'mushak91', 'hisab'],
  },
  {
    key: 'W06',
    code: 'W06',
    number: 6,
    shortcut: '⌥6',
    label_en: 'Banking & MFS reconcile',
    label_bn: 'ব্যাংক ও এমএফএস মিলন',
    short_en: 'Banking & MFS',
    short_bn: 'ব্যাংক ও এমএফএস',
    hint_en: 'Bank, bKash and Nagad statement matching',
    hint_bn: 'ব্যাংক, বিকাশ ও নগদ বিবরণী মিলন',
    guide_en:
      'Match bank, bKash and Nagad statement lines to the ledger. Anything that cannot be matched stays in a review queue instead of being plugged.',
    guide_bn:
      'ব্যাংক, বিকাশ ও নগদ বিবরণীর লাইন খতিয়ানের সাথে মিলান। যা মিলানো যায় না তা প্লাগ না করে পর্যালোচনা তালিকায় থাকে।',
    group: 'CORE_OPERATIONS',
    icon: Wallet,
    keywords: ['bank', 'mfs', 'bkash', 'nagad', 'reconcile', 'reconciliation', 'statement', 'wallet'],
    banglish: ['bkash', 'nagad', 'melano', 'hishabnikash', 'bank'],
  },
  {
    key: 'W07',
    code: 'W07',
    number: 7,
    shortcut: '⌥7',
    label_en: 'Mass XLSX/CSV studio',
    label_bn: 'বাল্ক এক্সএলএসএক্স/সিএসভি স্টুডিও',
    short_en: 'Mass Import/Export',
    short_bn: 'বাল্ক আমদানি/রপ্তানি',
    hint_en: 'XLSX / CSV pipelines, validation, commit, rollback and audit pack',
    hint_bn: 'এক্সএলএসএক্স / সিএসভি পাইপলাইন, যাচাই, কমিট, রোলব্যাক ও অডিট প্যাক',
    guide_en:
      'Drop an Excel or CSV file, fix every flagged row in the simulator and commit the batch. A single click rolls the whole batch back with linked reversals.',
    guide_bn:
      'একটি এক্সেল বা সিএসভি ফাইল দিন, সিমুলেটরে চিহ্নিত সারি ঠিক করুন এবং ব্যাচ কমিট করুন। এক ক্লিকে লিংকড রিভার্সালসহ পুরো ব্যাচ রোলব্যাক হয়।',
    group: 'ACCOUNTING_REPORTS',
    icon: Upload,
    keywords: ['import', 'export', 'excel', 'xlsx', 'csv', 'bulk', 'batch', 'rollback', 'template', 'audit pack'],
    banglish: ['excel', 'import', 'export'],
  },
  {
    key: 'W08',
    code: 'W08',
    number: 8,
    shortcut: '⌥8',
    label_en: 'IAS/IFRS financial statements',
    label_bn: 'আইএএস/আইএফআরএস আর্থিক বিবরণী',
    short_en: 'Financial Statements & GL',
    short_bn: 'আর্থিক বিবরণী ও জিএল',
    hint_en: 'IAS 1 / IFRS 18 statements, notes, trial balance and print pack',
    hint_bn: 'আইএএস ১ / আইএফআরএস ১৮ বিবরণী, নোট, রেওয়ামিল ও প্রিন্ট প্যাক',
    guide_en:
      'Read the board-ready statements. Every line is traceable to its accounts, its journals and the tax decision that created them.',
    guide_bn:
      'বোর্ড-প্রস্তুত বিবরণী পড়ুন। প্রতিটি লাইন তার হিসাব, জার্নাল ও যে কর সিদ্ধান্ত তা তৈরি করেছে পর্যন্ত ট্রেসযোগ্য।',
    group: 'ACCOUNTING_REPORTS',
    icon: BookOpen,
    keywords: ['ifrs', 'financial', 'statement', 'balance sheet', 'sofp', 'profit or loss', 'cash flow', 'trial balance', 'notes', 'ias 1', 'ifrs 18'],
    banglish: ['ifrs', 'bilansheet', 'bilans', 'labh', 'kshoti'],
  },
  {
    key: 'W09',
    code: 'W09',
    number: 9,
    shortcut: '⌥9',
    label_en: 'Subledger control & month close',
    label_bn: 'সাবলেজার নিয়ন্ত্রণ ও মাস সমাপনী',
    short_en: 'Month-End Close & Control',
    short_bn: 'মাস-সমাপনী ও নিয়ন্ত্রণ',
    hint_en: 'Subledger-to-GL proofs, suspense queue, 11-step close and audit chain',
    hint_bn: 'সাবলেজার-জিএল প্রমাণ, সাসপেন্স, ১১ ধাপ সমাপনী ও অডিট চেইন',
    guide_en:
      'Prove the control accounts against their subledgers, clear the suspense queue, then walk the eleven-step close and lock the period.',
    guide_bn:
      'নিয়ন্ত্রণ হিসাব সাবলেজারের বিপরীতে প্রমাণ করুন, সাসপেন্স তালিকা পরিষ্কার করুন, তারপর এগারো ধাপের সমাপনী শেষে সময়কাল লক করুন।',
    group: 'ACCOUNTING_REPORTS',
    icon: ShieldCheck,
    keywords: ['close', 'month end', 'reconciliation', 'suspense', 'control', 'audit chain', 'sha-256', 'period lock', 'close wizard'],
    banglish: ['shesh', 'hishabnikash', 'melano', 'baro'],
  },
  {
    key: 'W10',
    code: 'W10',
    number: 10,
    shortcut: '⌥⇧1',
    label_en: 'Labour Act payroll',
    label_bn: 'শ্রম আইন পে-রোল',
    short_en: 'Payroll',
    short_bn: 'পে-রোল',
    hint_en: 'Labour Act 2026 register, PF, gratuity, WPPF, BEFTN / bKash',
    hint_bn: 'শ্রম আইন ২০২৬ রেজিস্টার, পিএফ, গ্র্যাচুইটি, ডব্লিউপিপিএফ, বিইএফটিএন',
    guide_en:
      'Run the monthly payroll under the Labour Act: overtime, festival bonus, PF, gratuity and WPPF are calculated and posted as one balanced journal.',
    guide_bn:
      'শ্রম আইনের অধীনে মাসিক পে-রোল চালান: ওভারটাইম, উৎসব বোনাস, পিএফ, গ্র্যাচুইটি ও ডব্লিউপিপিএফ হিসাব করে এক সুষম জার্নালে পোস্ট হয়।',
    group: 'CORPORATE_ADMIN',
    icon: Users,
    keywords: ['payroll', 'salary', 'wage', 'labour act', 'overtime', 'eid bonus', 'provident fund', 'gratuity', 'wppf', 'tds', 'beftn', 'bkash'],
    banglish: ['borton', 'beton', 'beetoni', 'bhetan', 'grati'],
  },
  {
    key: 'W11',
    code: 'W11',
    number: 11,
    shortcut: '⌥⇧2',
    label_en: 'RJSC & secretarial',
    label_bn: 'আরজেএসসি ও সচিবালয়',
    short_en: 'RJSC & Licences',
    short_bn: 'আরজেএসসি ও লাইসেন্স',
    hint_en: 'RJSC register, share capital, licences, NBR notices and appeals',
    hint_bn: 'আরজেএসসি রেজিস্টার, শেয়ার মূলধন, লাইসেন্স, এনবিআর নোটিশ ও আপিল',
    guide_en:
      'Keep the corporate record clean: RJSC filings, share capital, trade licences and any NBR notice or appeal live in one governed register.',
    guide_bn:
      'কর্পোরেট রেকর্ড পরিচ্ছন্ন রাখুন: আরজেএসসি ফাইলিং, শেয়ার মূলধন, ট্রেড লাইসেন্স এবং এনবিআর নোটিশ বা আপিল এক সুশাসিত রেজিস্টারে থাকে।',
    group: 'CORPORATE_ADMIN',
    icon: Building2,
    keywords: ['rjsc', 'secretarial', 'share capital', 'licence', 'license', 'trade licence', 'nbr', 'notice', 'appeal', 'governance', 'agm'],
    banglish: ['sonod', 'licence', 'notice', 'bima'],
  },
  {
    key: 'W12',
    code: 'W12',
    number: 12,
    shortcut: '⌥⇧3',
    label_en: 'Rule pack & practice cockpit',
    label_bn: 'রুল প্যাক ও প্র্যাকটিস ককপিট',
    short_en: 'System & Rule Pack',
    short_bn: 'সিস্টেম ও রুল প্যাক',
    hint_en: 'Tax rules, citations, dictionary parity and BigInt proofs',
    hint_bn: 'কর বিধি, উদ্ধৃতি, অভিধান সমতা ও বিগইন্ট প্রমাণ',
    guide_en:
      'Audit the engine itself: rule versions, citations, bilingual dictionary parity and the golden BigInt proof suite behind every number.',
    guide_bn:
      'ইঞ্জিন নিজেই অডিট করুন: বিধির সংস্করণ, উদ্ধৃতি, দ্বিভাষিক অভিধান সমতা এবং প্রতিটি সংখ্যার পেছনের গোল্ডেন বিগইন্ট প্রমাণ সেট।',
    group: 'CORPORATE_ADMIN',
    icon: Sparkles,
    keywords: ['rule pack', 'tax rules', 'citation', 'dictionary', 'parity', 'core lab', 'bigint', 'engine'],
    banglish: ['rule', 'kor', 'suchok'],
  },
];

export const WORKSPACE_BY_KEY: Readonly<Record<WorkspaceKey, WorkspaceDescriptor>> = WORKSPACES.reduce(
  (accumulator, workspace) => {
    accumulator[workspace.key] = workspace;
    return accumulator;
  },
  {} as Record<WorkspaceKey, WorkspaceDescriptor>,
);

/**
 * Deliberate reading order inside each ERP module group. Tax opens on the return (W05) before the
 * treasury queue (W04); accounting opens on the statements (W08) before close (W09) and imports
 * (W07). The numeric W-code stays printed on every row.
 */
const GROUP_SEQUENCE: Readonly<Record<WorkspaceGroupKey, readonly WorkspaceKey[]>> = {
  CORE_OPERATIONS: ['W01', 'W02', 'W03', 'W06'],
  ACCOUNTING_REPORTS: ['W08', 'W09', 'W07'],
  TAX_STATUTORY: ['W05', 'W04'],
  CORPORATE_ADMIN: ['W10', 'W11', 'W12'],
};

/** Workspaces belonging to one sidebar group, in the deliberate module-navigation order. */
export function workspacesInGroup(group: WorkspaceGroupKey): WorkspaceDescriptor[] {
  return GROUP_SEQUENCE[group].map((key) => WORKSPACE_BY_KEY[key]).filter(Boolean);
}

/** Keyboard jump target for Alt+1…9 and Alt+Shift+1…3, else null. */
export function workspaceForShortcut(event: {
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}): WorkspaceKey | null {
  if (!event.altKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return null;
  const digit = Number(match[1]);
  if (!event.shiftKey) return `W0${digit}` as WorkspaceKey;
  if (digit >= 1 && digit <= 3) return `W${9 + digit}` as WorkspaceKey;
  return null;
}

const ENTITY_TYPE_LABEL_BN: Record<EntityType, string> = {
  PRIVATE_LIMITED: 'প্রাইভেট লিমিটেড',
  PUBLIC_LISTED: 'পাবলিক লিমিটেড',
  SOLE_PROPRIETORSHIP: 'একক প্রতিষ্ঠান',
  PARTNERSHIP: 'পার্টনারশিপ',
  STARTUP_REGISTERED: 'স্টার্টআপ নিবন্ধিত',
  BRANCH_FOREIGN: 'বিদেশি শাখা',
  EPZ_EZ_UNIT: 'ইপিজেড / ইজেড ইউনিট',
  NGO_NPO: 'এনজিও / এনপিও',
};

/** Human entity type for chrome chips — English or Bangla. */
export function entityTypeLabel(type: EntityType, isBangla: boolean): string {
  return isBangla ? ENTITY_TYPE_LABEL_BN[type] ?? type.replaceAll('_', ' ') : type.replaceAll('_', ' ');
}
