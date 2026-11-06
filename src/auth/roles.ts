import type { ServerPermission, ServerRole } from './types';

export const SERVER_ROLES: readonly ServerRole[] = [
  'OWNER',
  'ADMIN',
  'CONTROLLER',
  'ACCOUNTANT',
  'OPERATOR',
  'AUDITOR',
];

export const ROLE_LABELS: Record<
  ServerRole,
  { label_en: string; label_bn: string; note_en: string; note_bn: string }
> = {
  OWNER: {
    label_en: 'Owner',
    label_bn: 'মালিক',
    note_en: 'Owns the organisation, can grant ownership and manage every company.',
    note_bn: 'প্রতিষ্ঠানের মালিক, মালিকানা প্রদান ও সব কোম্পানি পরিচালনা করতে পারেন।',
  },
  ADMIN: {
    label_en: 'Admin',
    label_bn: 'প্রশাসক',
    note_en: 'Full control of the ledger, masters, users and the organisation.',
    note_bn: 'লেজার, মাস্টার, ব্যবহারকারী ও প্রতিষ্ঠানের সম্পূর্ণ নিয়ন্ত্রণ।',
  },
  CONTROLLER: {
    label_en: 'Controller',
    label_bn: 'নিয়ন্ত্রক',
    note_en: 'Approves high-value documents, reversals and the two-person close.',
    note_bn: 'উচ্চ-মূল্যের ডকুমেন্ট, রিভার্সাল ও দ্বি-ব্যক্তি সমাপনী অনুমোদন করেন।',
  },
  ACCOUNTANT: {
    label_en: 'Accountant',
    label_bn: 'হিসাবরক্ষক',
    note_en: 'Posts to the GL, maintains masters and submits periods for close.',
    note_bn: 'জিএল-এ পোস্ট করেন, মাস্টার রক্ষণাবেক্ষণ ও সময়কাল সমাপনীর জন্য জমা দেন।',
  },
  OPERATOR: {
    label_en: 'Operator',
    label_bn: 'অপারেটর',
    note_en: 'Creates commercial drafts and dispatches or receives stock — cannot post to GL.',
    note_bn: 'বাণিজ্যিক খসড়া তৈরি ও স্টক প্রেরণ/গ্রহণ করেন — জিএল-এ পোস্ট করতে পারেন না।',
  },
  AUDITOR: {
    label_en: 'Auditor',
    label_bn: 'নিরীক্ষক',
    note_en: 'Read-only. Every write action is disabled at the server.',
    note_bn: 'শুধুমাত্র পাঠযোগ্য। প্রতিটি লেখা কার্যক্রম সার্ভারে নিষ্ক্রিয়।',
  },
};

export const ROLE_TONE: Record<ServerRole, string> = {
  OWNER: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  ADMIN: 'bg-vault-100 text-vault-700 dark:bg-vault-500/15 dark:text-vault-300',
  CONTROLLER: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  ACCOUNTANT: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  OPERATOR: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  AUDITOR: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export const PERMISSION_LABELS: Record<ServerPermission, { en: string; bn: string }> = {
  MANAGE_COMPANY_SETTINGS: { en: 'Company settings', bn: 'কোম্পানি সেটিংস' },
  MANAGE_MASTERS_AND_COA: { en: 'Masters & chart of accounts', bn: 'মাস্টার ও হিসাবের চার্ট' },
  CREATE_COMMERCIAL_DRAFT: { en: 'Create drafts', bn: 'খসড়া তৈরি' },
  DISPATCH_OR_RECEIVE_STOCK: { en: 'Dispatch / receive stock', bn: 'স্টক প্রেরণ / গ্রহণ' },
  POST_TO_GL: { en: 'Post to the ledger', bn: 'লেজারে পোস্ট' },
  APPROVE_HIGH_VALUE: { en: 'Approve high value', bn: 'উচ্চ মূল্য অনুমোদন' },
  OVERRIDE_3WAY_VARIANCE: { en: 'Override 3-way variance', bn: '৩-পক্ষ পার্থক্য ওভাররাইড' },
  REVERSE_POSTED_JOURNAL: { en: 'Reverse posted entries', bn: 'পোস্টকৃত এন্ট্রি রিভার্স' },
  SUBMIT_CLOSE_MAKER: { en: 'Submit close (maker)', bn: 'সমাপনী জমা (মেকার)' },
  APPROVE_CLOSE_CHECKER: { en: 'Approve close (checker)', bn: 'সমাপনী অনুমোদন (চেকার)' },
  REOPEN_PERIOD: { en: 'Reopen a closed period', bn: 'বন্ধ হিসাবকাল পুনরায় খোলা' },
  MANAGE_USERS_AND_ORG: { en: 'Users & organisations', bn: 'ব্যবহারকারী ও প্রতিষ্ঠান' },
  VIEW_REPORTS: { en: 'View reports', bn: 'রিপোর্ট দেখুন' },
  VIEW_LIMITED_REPORTS: { en: 'View limited reports', bn: 'সীমিত রিপোর্ট দেখুন' },
  EXPORT_DATA: { en: 'Export data', bn: 'ডেটা রপ্তানি' },
  OVERRIDE_NEGATIVE_STOCK: { en: 'Override negative stock', bn: 'নেতিবাচক স্টক ওভাররাইড' },
};

export function isServerRole(value: unknown): value is ServerRole {
  return typeof value === 'string' && (SERVER_ROLES as readonly string[]).includes(value);
}
