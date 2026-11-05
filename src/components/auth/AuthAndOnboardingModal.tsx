// LedgerVault — identity, role switching and company onboarding.
//
// One focused surface with two jobs:
//   ACCESS      — see who is signed in, switch the active role/user, inspect the RBAC matrix,
//                 sign out, and export/import the complete vault snapshot.
//   ONBOARDING  — a four-step New Company wizard (Legal Identity → BIN/e-TIN → Fiscal Year &
//                 Framework → Opening Cash/Bank/Capital) that calls `createCustomTenant()` once
//                 the opening balance sheet balances.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CircleAlert,
  Download,
  KeyRound,
  Landmark,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';

import { bdtToPoisha } from '../../core/money';
import type {
  CustomTenantInput,
  EntityType,
  IndustryPack,
  PermissionAction,
  ReportingFramework,
  UserRole,
  VatStatus,
} from '../../core/types';
import {
  ALL_PERMISSIONS,
  PERMISSION_MATRIX,
  ROLE_LABELS,
  permissionsForRole,
  useVault,
} from '../../context/VaultContext';

type ModalView = 'ACCESS' | 'ONBOARDING';

export interface AuthAndOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  initialView?: ModalView;
  className?: string;
}

interface Feedback {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface OnboardingDraft {
  name_en: string;
  name_bn: string;
  trade_name: string;
  entity_type: EntityType;
  industry_pack: IndustryPack;
  address_en: string;
  address_bn: string;
  telephone: string;
  email: string;
  bin_number: string;
  tin_number: string;
  rjsc_reg_no: string;
  vat_status: VatStatus;
  is_withholding_entity: boolean;
  reporting_framework: ReportingFramework;
  fiscal_year_label: string;
  bank_name: string;
  bank_account_masked: string;
  opening_cash: string;
  opening_bank: string;
  opening_capital: string;
}

const ENTITY_OPTIONS: ReadonlyArray<{ value: EntityType; en: string; bn: string }> = [
  { value: 'PRIVATE_LIMITED', en: 'Private Limited Company', bn: 'প্রাইভেট লিমিটেড কোম্পানি' },
  { value: 'PUBLIC_LISTED', en: 'Public Listed Company', bn: 'পাবলিক লিস্টেড কোম্পানি' },
  { value: 'SOLE_PROPRIETORSHIP', en: 'Sole Proprietorship', bn: 'একক প্রতিষ্ঠান' },
  { value: 'PARTNERSHIP', en: 'Partnership Firm', bn: 'অংশীদারি প্রতিষ্ঠান' },
  { value: 'STARTUP_REGISTERED', en: 'Registered Startup', bn: 'নিবন্ধিত স্টার্টআপ' },
  { value: 'BRANCH_FOREIGN', en: 'Foreign Branch', bn: 'বিদেশি শাখা' },
  { value: 'EPZ_EZ_UNIT', en: 'EPZ / Economic Zone Unit', bn: 'ইপিজেড / অর্থনৈতিক অঞ্চল ইউনিট' },
  { value: 'NGO_NPO', en: 'NGO / Non-Profit', bn: 'এনজিও / অলাভজনক' },
];

const INDUSTRY_OPTIONS: ReadonlyArray<{ value: IndustryPack; en: string; bn: string }> = [
  { value: 'TRADING_DISTRIBUTION', en: 'Trading & Distribution', bn: 'ট্রেডিং ও বিতরণ' },
  { value: 'SERVICES_IT', en: 'Services / IT', bn: 'সেবা / আইটি' },
  { value: 'MANUFACTURING_RMG', en: 'Manufacturing / RMG', bn: 'উৎপাদন / আরএমজি' },
  { value: 'ECOMMERCE_FCOMMERCE', en: 'E-commerce / F-commerce', bn: 'ই-কমার্স / এফ-কমার্স' },
  { value: 'PRACTICE_FIRM', en: 'Accounting Practice Firm', bn: 'হিসাবরক্ষণ পেশাদার প্রতিষ্ঠান' },
];

const VAT_OPTIONS: ReadonlyArray<{ value: VatStatus; en: string; bn: string }> = [
  { value: 'VAT_REGISTERED_15', en: 'VAT Registered (15%)', bn: 'ভ্যাট নিবন্ধিত (১৫%)' },
  { value: 'TURNOVER_TAX_ENLISTED', en: 'Turnover Tax Enlisted', bn: 'টার্নওভার কর তালিকাভুক্ত' },
  { value: 'EXEMPT', en: 'Exempt', bn: 'মুক্ত' },
  { value: 'STARTUP_RELIEF', en: 'Startup Relief', bn: 'স্টার্টআপ ছাড়' },
];

const FRAMEWORK_OPTIONS: ReadonlyArray<{ value: ReportingFramework; en: string; bn: string; note_en: string; note_bn: string }> = [
  {
    value: 'IFRS_FRC_ADOPTED',
    en: 'IFRS as adopted in Bangladesh',
    bn: 'বাংলাদেশে গৃহীত আইএফআরএস',
    note_en: 'Full IFRS presentation, IFRS 18 early-adoption ready.',
    note_bn: 'পূর্ণ আইএফআরএস উপস্থাপনা, আইএফআরএস ১৮ আগাম গ্রহণের জন্য প্রস্তুত।',
  },
  {
    value: 'IFRS_FOR_SMES_BFRS',
    en: 'IFRS for SMEs (BFRS)',
    bn: 'এসএমই-এর জন্য আইএফআরএস (বিএফআরএস)',
    note_en: 'Reduced-disclosure framework for small and medium entities.',
    note_bn: 'ছোট ও মাঝারি প্রতিষ্ঠানের জন্য সংক্ষিপ্ত প্রকাশনা কাঠামো।',
  },
  {
    value: 'SIMPLIFIED_MANAGEMENT',
    en: 'Simplified Management Accounts',
    bn: 'সরলীকৃত ব্যবস্থাপনা হিসাব',
    note_en: 'Internal management reporting — statutory schedules still apply.',
    note_bn: 'অভ্যন্তরীণ ব্যবস্থাপনা প্রতিবেদন — সংবিধিবদ্ধ সূচি প্রযোজ্য থাকবে।',
  },
];

const PERMISSION_COPY: Record<PermissionAction, { en: string; bn: string }> = {
  CREATE_COMMERCIAL_DRAFT: { en: 'Create commercial drafts', bn: 'বাণিজ্যিক খসড়া তৈরি' },
  DISPATCH_OR_RECEIVE_STOCK: { en: 'Dispatch / receive stock', bn: 'স্টক প্রেরণ / গ্রহণ' },
  POST_TO_GL: { en: 'Post journals to the GL', bn: 'জিএল-এ জার্নাল পোস্ট' },
  APPROVE_HIGH_VALUE: { en: 'Approve high-value documents', bn: 'উচ্চ-মূল্যের ডকুমেন্ট অনুমোদন' },
  OVERRIDE_3WAY_VARIANCE: { en: 'Override 3-way match variance', bn: 'থ্রি-ওয়ে মিল অমিল ওভাররাইড' },
  REVERSE_POSTED_JOURNAL: { en: 'Reverse posted journals', bn: 'পোস্টকৃত জার্নাল রিভার্স' },
  SUBMIT_CLOSE_MAKER: { en: 'Submit period close (Maker)', bn: 'সময়কাল সমাপনী জমা (মেকার)' },
  APPROVE_CLOSE_CHECKER: { en: 'Approve period close (Checker)', bn: 'সময়কাল সমাপনী অনুমোদন (চেকার)' },
  MANAGE_MASTERS_AND_COA: { en: 'Manage masters & chart of accounts', bn: 'মাস্টার ও হিসাবের চার্ট ব্যবস্থাপনা' },
  MANAGE_USERS_AND_ORG: { en: 'Manage users & organisation', bn: 'ব্যবহারকারী ও প্রতিষ্ঠান ব্যবস্থাপনা' },
};

const WIZARD_STEPS: ReadonlyArray<{ en: string; bn: string; hint_en: string; hint_bn: string }> = [
  {
    en: 'Legal Identity',
    bn: 'আইনি পরিচিতি',
    hint_en: 'Registered name, structure and contact details.',
    hint_bn: 'নিবন্ধিত নাম, কাঠামো ও যোগাযোগের বিবরণ।',
  },
  {
    en: 'BIN / e-TIN Tax Setup',
    bn: 'বিআইএন / ই-টিআইএন কর সেটআপ',
    hint_en: 'VAT registration, BIN units and withholding status.',
    hint_bn: 'ভ্যাট নিবন্ধন, বিআইএন ইউনিট ও উৎসে কর অবস্থা।',
  },
  {
    en: 'Fiscal Year & Framework',
    bn: 'অর্থবছর ও কাঠামো',
    hint_en: 'Reporting framework and the July–June posting calendar.',
    hint_bn: 'প্রতিবেদন কাঠামো ও জুলাই–জুন পোস্টিং ক্যালেন্ডার।',
  },
  {
    en: 'Opening Cash / Bank / Capital',
    bn: 'প্রারম্ভিক নগদ / ব্যাংক / মূলধন',
    hint_en: 'A balanced opening entry — debit cash + bank, credit capital.',
    hint_bn: 'ভারসাম্যপূর্ণ প্রারম্ভিক এন্ট্রি — নগদ + ব্যাংক ডেবিট, মূলধন ক্রেডিট।',
  },
];

function createDraft(): OnboardingDraft {
  const year = new Date().getFullYear();
  return {
    name_en: '',
    name_bn: '',
    trade_name: '',
    entity_type: 'PRIVATE_LIMITED',
    industry_pack: 'TRADING_DISTRIBUTION',
    address_en: '',
    address_bn: '',
    telephone: '',
    email: '',
    bin_number: '',
    tin_number: '',
    rjsc_reg_no: '',
    vat_status: 'VAT_REGISTERED_15',
    is_withholding_entity: false,
    reporting_framework: 'IFRS_FOR_SMES_BFRS',
    fiscal_year_label: `FY ${year}-${year + 1}`,
    bank_name: '',
    bank_account_masked: '',
    opening_cash: '',
    opening_bank: '',
    opening_capital: '',
  };
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

function parseBdtInput(value: string): bigint | null {
  try {
    return bdtToPoisha(value);
  } catch {
    return null;
  }
}

function poishaToInput(poisha: bigint): string {
  const negative = poisha < 0n;
  const absolute = negative ? -poisha : poisha;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const tail = fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${whole.toString()}${tail}`;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'U'
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="lv-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-400">{hint}</span> : null}
    </label>
  );
}

function RoleBadge({ role, className = '' }: { role: UserRole; className?: string }) {
  const tone: Record<UserRole, string> = {
    ADMIN: 'bg-vault-100 text-vault-800 ring-vault-200',
    CONTROLLER: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    ACCOUNTANT: 'bg-sky-50 text-sky-700 ring-sky-200',
    OPERATOR: 'bg-amber-50 text-amber-700 ring-amber-200',
    AUDITOR: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset ${tone[role]} ${className}`}>
      {ROLE_LABELS[role].label_en}
    </span>
  );
}

export function AuthAndOnboardingModal({
  open,
  onClose,
  initialView = 'ACCESS',
  className = '',
}: AuthAndOnboardingModalProps) {
  const vault = useVault();
  const {
    locale,
    users,
    currentUser,
    isAuthenticated,
    tenant,
    money,
    login,
    logout,
    switchUserRole,
    hasPermission,
    createCustomTenant,
    exportVaultFile,
    importVaultFile,
  } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [view, setView] = useState<ModalView>(initialView);
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>(() => createDraft());
  const [wizardError, setWizardError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setView(initialView);
    setSelectedUserId(currentUser.id);
    setFeedback(null);
    setWizardStep(0);
    setWizardError(null);
    // Reset only when the modal opens, not on every role change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialView]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? currentUser;
  const selectedRole = selectedUser.role;
  const currentRole = currentUser.role;
  const selectedIsCurrent = selectedUser.id === currentUser.id && isAuthenticated;
  const selectedPermissions = permissionsForRole(selectedRole);

  const canOnboard = hasPermission('MANAGE_USERS_AND_ORG');

  const opening = useMemo(() => {
    const cash = parseBdtInput(draft.opening_cash);
    const bank = parseBdtInput(draft.opening_bank);
    const capital = parseBdtInput(draft.opening_capital);
    const total = cash !== null && bank !== null ? cash + bank : null;
    const variance = capital !== null && total !== null ? capital - total : null;
    const valid =
      cash !== null &&
      bank !== null &&
      capital !== null &&
      cash >= 0n &&
      bank >= 0n &&
      capital >= 0n &&
      variance === 0n;
    return { cash, bank, capital, total, variance, valid };
  }, [draft.opening_cash, draft.opening_bank, draft.opening_capital]);

  const stepValid = useMemo(() => {
    if (wizardStep === 0) return draft.name_en.trim().length > 0;
    if (wizardStep === 1) {
      const binDigits = digitsOf(draft.bin_number);
      if (draft.vat_status === 'VAT_REGISTERED_15' && binDigits.length !== 13) return false;
      const tinDigits = digitsOf(draft.tin_number);
      if (tinDigits.length > 0 && tinDigits.length !== 12) return false;
      return true;
    }
    if (wizardStep === 2) return /\d{4}/.test(draft.fiscal_year_label);
    return opening.valid;
  }, [draft.bin_number, draft.fiscal_year_label, draft.name_en, draft.tin_number, draft.vat_status, opening.valid, wizardStep]);

  if (!open) return null;

  const updateDraft = (patch: Partial<OnboardingDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setWizardError(null);
  };

  const handleLogin = (): void => {
    const result = login(selectedUser.username);
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error ?? 'Sign-in failed.' });
      return;
    }
    setSelectedUserId(result.data?.id ?? selectedUser.id);
    setFeedback({ tone: 'success', message: L(`Signed in as ${selectedUser.full_name}.`, `${selectedUser.full_name} হিসেবে সাইন ইন হয়েছে।`) });
  };

  const handleSwitchRole = (role: UserRole): void => {
    const result = switchUserRole(role);
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error ?? 'Role switch failed.' });
      return;
    }
    setSelectedUserId(result.data?.id ?? selectedUser.id);
    setFeedback({
      tone: 'success',
      message: L(
        `Active role is now ${ROLE_LABELS[role].label_en} — ${result.data?.full_name ?? 'user'}.`,
        `সক্রিয় ভূমিকা এখন ${ROLE_LABELS[role].label_bn} — ${result.data?.full_name ?? 'ব্যবহারকারী'}।`,
      ),
    });
  };

  const handleLogout = (): void => {
    logout();
    setFeedback({ tone: 'info', message: L('Signed out. Write actions are locked until a user signs in.', 'সাইন আউট হয়েছে। ব্যবহারকারী সাইন ইন না করা পর্যন্ত লেখা কার্যক্রম লক।') });
  };

  const handleExport = (): void => {
    const fileName = exportVaultFile();
    if (fileName) {
      setFeedback({ tone: 'success', message: L(`Complete vault exported as ${fileName}.`, `সম্পূর্ণ ভল্ট ${fileName} হিসেবে রপ্তানি হয়েছে।`) });
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = await importVaultFile(file);
    setFeedback({
      tone: result.ok ? 'success' : 'error',
      message: result.ok
        ? L(`${file.name} restored — accounts, parties, items and journals are complete.`, `${file.name} পুনরুদ্ধার হয়েছে — হিসাব, পক্ষ, আইটেম ও জার্নাল সম্পূর্ণ।`)
        : result.error ?? L('Import failed.', 'আমদানি ব্যর্থ হয়েছে।'),
    });
  };

  const handleNext = (): void => {
    if (!stepValid) {
      setWizardError(
        wizardStep === 3
          ? L('Opening capital must equal cash + bank, and no balance may be negative.', 'প্রারম্ভিক মূলধন নগদ + ব্যাংকের সমান হতে হবে এবং কোনো স্থিতি ঋণাত্মক হতে পারবে না।')
          : L('Complete the required fields before continuing.', 'চালিয়ে যাওয়ার আগে প্রয়োজনীয় ঘরগুলো পূরণ করুন।'),
      );
      return;
    }
    setWizardError(null);
    setWizardStep((step) => Math.min(3, step + 1));
  };

  const handleSubmit = (): void => {
    if (!canOnboard) {
      setWizardError(L('Only an ADMIN can create a company.', 'শুধুমাত্র একজন অ্যাডমিন কোম্পানি তৈরি করতে পারেন।'));
      return;
    }
    const cash = opening.cash;
    const bank = opening.bank;
    const capital = opening.capital;
    if (!stepValid || cash === null || bank === null || capital === null) {
      setWizardError(L('Complete the balanced opening balances first.', 'প্রথমে ভারসাম্যপূর্ণ প্রারম্ভিক স্থিতি সম্পন্ন করুন।'));
      return;
    }
    const payload: CustomTenantInput = {
      name_en: draft.name_en.trim(),
      name_bn: draft.name_bn.trim(),
      trade_name: draft.trade_name.trim(),
      entity_type: draft.entity_type,
      industry_pack: draft.industry_pack,
      tin_number: draft.tin_number.trim(),
      bin_number: draft.bin_number.trim(),
      rjsc_reg_no: draft.rjsc_reg_no.trim(),
      vat_status: draft.vat_status,
      is_withholding_entity: draft.is_withholding_entity,
      reporting_framework: draft.reporting_framework,
      fiscal_year_label: draft.fiscal_year_label.trim(),
      address_en: draft.address_en.trim(),
      address_bn: draft.address_bn.trim(),
      telephone: draft.telephone.trim(),
      email: draft.email.trim(),
      bank_name: draft.bank_name.trim(),
      bank_account_masked: draft.bank_account_masked.trim(),
      opening_cash_poisha: cash,
      opening_bank_poisha: bank,
      opening_capital_poisha: capital,
    };
    const result = createCustomTenant(payload);
    if (!result.ok) {
      setWizardError(result.error ?? L('The company could not be created.', 'কোম্পানি তৈরি করা যায়নি।'));
      return;
    }
    setFeedback({
      tone: 'success',
      message: L(
        `${result.data?.name_en ?? payload.name_en} is onboarded with ${draft.fiscal_year_label} periods and a balanced opening entry.`,
        `${result.data?.name_en ?? payload.name_en} অনবোর্ড হয়েছে — ${draft.fiscal_year_label} সময়কাল ও ভারসাম্যপূর্ণ প্রারম্ভিক এন্ট্রিসহ।`,
      ),
    });
    setDraft(createDraft());
    setWizardStep(0);
    setWizardError(null);
    setView('ACCESS');
  };

  const feedbackTone =
    feedback?.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : feedback?.tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-sky-200 bg-sky-50 text-sky-800';

  const content = (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-ink-950/60 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={L('Identity, roles and company onboarding', 'পরিচয়, ভূমিকা ও কোম্পানি অনবোর্ডিং')}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28, mass: 0.8 }}
        className={`my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-canvas shadow-panel ${className}`}
      >
        {/* Header */}
        <header className="relative overflow-hidden bg-gradient-to-r from-vault-950 via-vault-900 to-vault-800 px-5 py-4 text-white sm:px-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-gold-400/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
                <KeyRound size={20} strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-vault-200">
                  {L('Identity · RBAC · onboarding', 'পরিচয় · আরবিএসি · অনবোর্ডিং')}
                </p>
                <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">
                  {L('Users, roles & new company', 'ব্যবহারকারী, ভূমিকা ও নতুন কোম্পানি')}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-vault-200/90">
                  {tenant.name_en} · {tenant.fiscal_year_label}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[9px] font-semibold text-vault-100 ring-1 ring-white/15 sm:inline-flex">
                <Lock size={9} /> {L('Durable snapshot', 'টেকসই স্ন্যাপশট')}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-xl bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
                aria-label={L('Close', 'বন্ধ করুন')}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-vault-100 ring-1 ring-white/15">
              <Users size={9} /> {users.length} {L('user accounts', 'ব্যবহারকারী হিসাব')}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${isAuthenticated ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/40' : 'bg-rose-500/20 text-rose-100 ring-rose-300/40'}`}>
              <ShieldCheck size={9} /> {isAuthenticated ? L('signed in', 'সাইন ইন') : L('read-only', 'শুধুমাত্র পাঠযোগ্য')}
            </span>
            <span className="ml-auto hidden font-mono text-[9px] text-vault-300/80 sm:inline">
              {currentUser.full_name} · {ROLE_LABELS[currentRole].label_en}
            </span>
          </div>
        </header>

        {/* View switch */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 sm:px-5">
          <div className="lv-seg">
            <button
              type="button"
              onClick={() => {
                setView('ACCESS');
                setWizardError(null);
              }}
              className="lv-seg-item inline-flex items-center gap-1.5"
              data-active={view === 'ACCESS'}
            >
              <UserRound size={12} /> {L('Access & roles', 'প্রবেশ ও ভূমিকা')}
            </button>
            <button
              type="button"
              onClick={() => {
                setView('ONBOARDING');
                setFeedback(null);
              }}
              className="lv-seg-item inline-flex items-center gap-1.5"
              data-active={view === 'ONBOARDING'}
            >
              <Building2 size={12} /> {L('New company', 'নতুন কোম্পানি')}
            </button>
          </div>
          <span className="text-[10px] text-ink-400">
            {L('Every write action is permission-checked.', 'প্রতিটি লেখা কার্যক্রম অনুমতি-যাচাইকৃত।')}
          </span>
        </div>

        {/* Body */}
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-4 py-4 sm:px-5">
          {feedback ? (
            <div className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${feedbackTone}`}>
              {feedback.tone === 'success' ? <Check size={13} className="mt-0.5 shrink-0" /> : feedback.tone === 'error' ? <CircleAlert size={13} className="mt-0.5 shrink-0" /> : <Sparkles size={13} className="mt-0.5 shrink-0" />}
              <span className="flex-1">{feedback.message}</span>
              <button type="button" onClick={() => setFeedback(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label={L('Dismiss', 'বাতিল')}>
                <X size={12} />
              </button>
            </div>
          ) : null}

          {view === 'ACCESS' ? (
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-3">
                {/* Current session */}
                <section className="lv-card overflow-hidden">
                  <div className="border-b border-line/80 bg-surface-2 px-4 py-2.5">
                    <p className="lv-kicker">{L('Current session', 'বর্তমান সেশন')}</p>
                  </div>
                  <div className="flex items-start gap-3 p-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-vault-900 text-[15px] font-semibold text-gold-200 ring-1 ring-vault-700">
                      {initialsOf(currentUser.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[14px] font-semibold text-ink-900">{currentUser.full_name}</p>
                        <RoleBadge role={currentUser.role} />
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-ink-500">
                        {currentUser.designation} · @{currentUser.username}
                      </p>
                      <p className="mt-0.5 truncate text-[10.5px] text-ink-400">{currentUser.email}</p>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-500">
                        {L(
                          `${permissionsForRole(currentUser.role).length} of ${ALL_PERMISSIONS.length} permissions · ${isAuthenticated ? 'authenticated' : 'signed out (read-only)'}`,
                          `${ALL_PERMISSIONS.length}-এর মধ্যে ${permissionsForRole(currentUser.role).length}টি অনুমতি · ${isAuthenticated ? 'প্রমাণিত' : 'সাইন আউট (শুধুমাত্র পাঠযোগ্য)'}`,
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {isAuthenticated ? (
                        <button type="button" onClick={handleLogout} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink-600 transition hover:border-rose-200 hover:text-rose-700">
                          <LogOut size={11} /> {L('Sign out', 'সাইন আউট')}
                        </button>
                      ) : (
                        <button type="button" onClick={handleLogin} className="inline-flex items-center gap-1 rounded-lg bg-vault-800 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-vault-700">
                          <KeyRound size={11} /> {L('Sign in', 'সাইন ইন')}
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                {/* Role switcher */}
                <section className="lv-card">
                  <div className="lv-card-header">
                    <div>
                      <p className="lv-kicker">{L('Role switcher', 'ভূমিকা পরিবর্তন')}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink-500">
                        {L('Switch the active user to test the permission matrix.', 'অনুমতি ম্যাট্রিক্স পরীক্ষা করতে সক্রিয় ব্যবহারকারী পরিবর্তন করুন।')}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 p-3 sm:grid-cols-2">
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => {
                      const activeUser = users.find((user) => user.role === role && user.is_active);
                      const active = isAuthenticated && currentRole === role;
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => handleSwitchRole(role)}
                          disabled={!activeUser}
                          className={`group rounded-xl border p-2.5 text-left transition ${active ? 'border-brand-bright/60 bg-vault-50 ring-2 ring-brand-bright/15 dark:bg-vault-900/30' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-ink-800">{L(ROLE_LABELS[role].label_en, ROLE_LABELS[role].label_bn)}</span>
                            {active ? <BadgeCheck size={13} className="shrink-0 text-brand-bright" /> : <span className="font-mono text-[9px] text-ink-400">{permissionsForRole(role).length}/{ALL_PERMISSIONS.length}</span>}
                          </div>
                          <p className="mt-0.5 truncate text-[9.5px] text-ink-500">{activeUser?.full_name ?? L('No active user', 'কোনো সক্রিয় ব্যবহারকারী নেই')}</p>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Backup */}
                <section className="rounded-2xl border border-line bg-surface-2 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="lv-kicker">{L('Durable storage & backup', 'টেকসই স্টোরেজ ও ব্যাকআপ')}</p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">
                        {L(
                          'IndexedDB + a complete localStorage snapshot. Export a portable .vault.json for accountant hand-off.',
                          'ইনডেক্সডডিবি + সম্পূর্ণ লোকালস্টোরেজ স্ন্যাপশট। হিসাবরক্ষকের কাছে হস্তান্তরের জন্য পোর্টেবল .vault.json রপ্তানি করুন।',
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={handleExport} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink-600 transition hover:border-line-strong hover:text-ink-900">
                        <Download size={11} /> {L('Export', 'রপ্তানি')}
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canOnboard}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-ink-600 transition hover:border-line-strong hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload size={11} /> {L('Import', 'আমদানি')}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.vault.json,application/json"
                        onChange={handleImport}
                        className="hidden"
                        aria-label={L('Import vault file', 'ভল্ট ফাইল আমদানি')}
                      />
                    </div>
                  </div>
                </section>
              </div>

              {/* Accounts + matrix */}
              <div className="space-y-3">
                <section className="lv-card overflow-hidden">
                  <div className="lv-card-header">
                    <div>
                      <p className="lv-kicker">{L('User accounts', 'ব্যবহারকারী হিসাব')}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink-500">{L('Select an account, then sign in.', 'একটি হিসাব নির্বাচন করে সাইন ইন করুন।')}</p>
                    </div>
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[9px] font-semibold text-ink-600">{users.length}</span>
                  </div>
                  <div className="max-h-[260px] divide-y divide-line overflow-y-auto">
                    {users.map((user) => {
                      const selected = user.id === selectedUser.id;
                      const active = user.id === currentUser.id && isAuthenticated;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition ${selected ? 'bg-vault-50 dark:bg-vault-900/25' : 'hover:bg-surface-2'}`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${selected ? 'bg-vault-900 text-gold-200' : 'bg-ink-100 text-ink-600'}`}>
                            {initialsOf(user.full_name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[11.5px] font-semibold text-ink-800">{user.full_name}</span>
                              {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                            </span>
                            <span className="block truncate text-[9.5px] text-ink-400">
                              @{user.username} · {ROLE_LABELS[user.role].label_en}
                            </span>
                          </span>
                          {selected ? <Check size={13} className="shrink-0 text-brand-bright" /> : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-3.5 py-2.5">
                    <p className="min-w-0 truncate text-[10px] text-ink-500">
                      {L('Sign in as', 'সাইন ইন')} <span className="font-semibold text-ink-800">{selectedUser.full_name}</span>
                    </p>
                    <button
                      type="button"
                      onClick={handleLogin}
                      disabled={selectedIsCurrent}
                      className="lv-btn lv-btn-primary shrink-0 px-2.5 py-1 text-[10.5px]"
                    >
                      {selectedIsCurrent ? L('Current session', 'বর্তমান সেশন') : L('Sign in', 'সাইন ইন')}
                    </button>
                  </div>
                </section>

                <section className="lv-card">
                  <div className="lv-card-header">
                    <div>
                      <p className="lv-kicker">{L('Permission matrix', 'অনুমতি ম্যাট্রিক্স')}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-500">
                        <RoleBadge role={selectedRole} />
                        {L(
                          `${selectedPermissions.length} of ${ALL_PERMISSIONS.length} granted`,
                          `${ALL_PERMISSIONS.length}-এর মধ্যে ${selectedPermissions.length}টি প্রদত্ত`,
                        )}
                      </p>
                    </div>
                  </div>
                  <ul className="divide-y divide-line">
                    {ALL_PERMISSIONS.map((permission) => {
                      const granted = PERMISSION_MATRIX[permission].includes(selectedRole);
                      return (
                        <li key={permission} className="flex items-center gap-2 px-3.5 py-1.5">
                          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${granted ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-500'}`}>
                            {granted ? <Check size={10} /> : <X size={10} />}
                          </span>
                          <span className={`min-w-0 flex-1 truncate text-[10.5px] ${granted ? 'text-ink-700' : 'text-ink-400'}`}>
                            {L(PERMISSION_COPY[permission].en, PERMISSION_COPY[permission].bn)}
                          </span>
                          <span className="hidden font-mono text-[8px] text-ink-300 sm:inline">{permission}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-line bg-surface-2 px-3.5 py-2 text-[9.5px] leading-relaxed text-ink-500">
                    {L(
                      'High-value approval above BDT 5,00,000 is restricted to Admin / Controller. The checker must be a different user from the maker.',
                      '৫,০০,০০০ টাকার বেশি উচ্চ-মূল্যের অনুমোদন কেবল অ্যাডমিন / নিয়ন্ত্রকের জন্য। চেকার অবশ্যই মেকার থেকে ভিন্ন ব্যবহারকারী হতে হবে।',
                    )}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[215px_1fr]">
              {/* Stepper */}
              <aside className="hidden lg:block">
                <ol className="space-y-1.5">
                  {WIZARD_STEPS.map((step, index) => {
                    const done = index < wizardStep;
                    const active = index === wizardStep;
                    return (
                      <li key={step.en}>
                        <div className={`rounded-xl border px-2.5 py-2 transition ${active ? 'border-brand-bright/50 bg-vault-50 dark:bg-vault-900/25' : 'border-line bg-surface'}`}>
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-vault-900 text-gold-200' : 'bg-ink-100 text-ink-500'}`}>
                              {done ? <Check size={10} /> : index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className={`text-[10.5px] font-semibold ${active ? 'text-ink-900' : 'text-ink-600'}`}>{L(step.en, step.bn)}</p>
                              <p className="mt-0.5 text-[9px] leading-snug text-ink-400">{L(step.hint_en, step.hint_bn)}</p>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-3 rounded-xl border border-line bg-surface-2 p-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-400">{L('Creates', 'তৈরি করে')}</p>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-ink-500">
                    {L(
                      'Tenant, primary BIN unit, chart of accounts, 12 open periods, bank/cash account and a balanced opening journal.',
                      'টেন্যান্ট, প্রাথমিক বিআইএন ইউনিট, হিসাবের চার্ট, ১২টি খোলা সময়কাল, ব্যাংক/নগদ হিসাব ও ভারসাম্যপূর্ণ প্রারম্ভিক জার্নাল।',
                    )}
                  </p>
                </div>
              </aside>

              {/* Wizard form */}
              <section className="lv-card overflow-hidden">
                {/* Mobile progress */}
                <div className="flex gap-1 border-b border-line bg-surface px-3 py-2 lg:hidden">
                  {WIZARD_STEPS.map((step, index) => (
                    <span key={step.en} className={`h-1.5 flex-1 rounded-full ${index <= wizardStep ? 'bg-brand-bright' : 'bg-ink-200'}`} />
                  ))}
                </div>

                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
                  <div>
                    <p className="lv-kicker">
                      {L('Step', 'ধাপ')} {wizardStep + 1} / 4
                    </p>
                    <h3 className="mt-0.5 text-[14px] font-semibold text-ink-900">{L(WIZARD_STEPS[wizardStep].en, WIZARD_STEPS[wizardStep].bn)}</h3>
                    <p className="mt-0.5 text-[10.5px] text-ink-500">{L(WIZARD_STEPS[wizardStep].hint_en, WIZARD_STEPS[wizardStep].hint_bn)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[9px] font-semibold text-ink-500">
                    <Lock size={9} /> {L('ADMIN only', 'শুধুমাত্র অ্যাডমিন')}
                  </span>
                </div>

                {!canOnboard ? (
                  <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] text-amber-800">
                    <CircleAlert size={13} className="mt-0.5 shrink-0" />
                    {L(
                      'Your active role cannot create a company. Switch to an Admin account in Access & roles first.',
                      'আপনার সক্রিয় ভূমিকা কোম্পানি তৈরি করতে পারে না। প্রথমে প্রবেশ ও ভূমিকায় অ্যাডমিন হিসাবে পরিবর্তন করুন।',
                    )}
                  </div>
                ) : null}

                <div className="space-y-3 px-4 py-4">
                  {wizardStep === 0 ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={L('Legal name (English) *', 'আইনি নাম (ইংরেজি) *')}>
                          <input className="lv-input" value={draft.name_en} onChange={(event) => updateDraft({ name_en: event.target.value })} placeholder="e.g. Padma Distribution Ltd." />
                        </Field>
                        <Field label={L('Legal name (Bangla)', 'আইনি নাম (বাংলা)')}>
                          <input className="lv-input font-bangla" value={draft.name_bn} onChange={(event) => updateDraft({ name_bn: event.target.value })} placeholder="যেমন পদ্মা ডিস্ট্রিবিউশন লিমিটেড" />
                        </Field>
                        <Field label={L('Trade name', 'বাণিজ্যিক নাম')}>
                          <input className="lv-input" value={draft.trade_name} onChange={(event) => updateDraft({ trade_name: event.target.value })} placeholder="Padma" />
                        </Field>
                        <Field label={L('Entity type', 'প্রতিষ্ঠানের ধরন')}>
                          <select className="lv-select" value={draft.entity_type} onChange={(event) => updateDraft({ entity_type: event.target.value as EntityType })}>
                            {ENTITY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {L(option.en, option.bn)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={L('Industry pack', 'শিল্প প্যাক')}>
                          <select className="lv-select" value={draft.industry_pack} onChange={(event) => updateDraft({ industry_pack: event.target.value as IndustryPack })}>
                            {INDUSTRY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {L(option.en, option.bn)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={L('Telephone', 'টেলিফোন')}>
                          <input className="lv-input" value={draft.telephone} onChange={(event) => updateDraft({ telephone: event.target.value })} placeholder="+880 2 xxxx xxxx" />
                        </Field>
                        <Field label={L('Email', 'ইমেইল')}>
                          <input className="lv-input" type="email" value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} placeholder="accounts@company.com" />
                        </Field>
                        <Field label={L('Registered address (English)', 'নিবন্ধিত ঠিকানা (ইংরেজি)')}>
                          <input className="lv-input" value={draft.address_en} onChange={(event) => updateDraft({ address_en: event.target.value })} placeholder="Level 4, 12 Gulshan Avenue, Dhaka 1212" />
                        </Field>
                        <Field label={L('Registered address (Bangla)', 'নিবন্ধিত ঠিকানা (বাংলা)')}>
                          <input className="lv-input font-bangla" value={draft.address_bn} onChange={(event) => updateDraft({ address_bn: event.target.value })} placeholder="লেভেল ৪, ১২ গুলশান এভিনিউ, ঢাকা ১২১২" />
                        </Field>
                      </div>
                      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[10px] leading-relaxed text-ink-500">
                        <Building2 size={13} className="mt-0.5 shrink-0 text-ink-400" />
                        {L(
                          'The legal name drives the tenant record, the primary BIN unit and all statutory print headers.',
                          'আইনি নাম টেন্যান্ট রেকর্ড, প্রাথমিক বিআইএন ইউনিট এবং সব সংবিধিবদ্ধ প্রিন্ট হেডার নিয়ন্ত্রণ করে।',
                        )}
                      </div>
                    </>
                  ) : null}

                  {wizardStep === 1 ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={L('BIN (13 digits)', 'বিআইএন (১৩ সংখ্যা)')} hint={L('9-digit entity BIN + 4-digit unit code.', '৯ সংখ্যার প্রতিষ্ঠান বিআইএন + ৪ সংখ্যার ইউনিট কোড।')}>
                          <input className="lv-input font-mono" value={draft.bin_number} onChange={(event) => updateDraft({ bin_number: event.target.value })} placeholder="1234567890123" inputMode="numeric" />
                        </Field>
                        <Field label={L('e-TIN (12 digits)', 'ই-টিআইএন (১২ সংখ্যা)')} hint={L('A missing e-TIN upscales supplier TDS by 50%.', 'ই-টিআইএন না থাকলে সরবরাহকারীর টিডিএস ৫০% বাড়ে।')}>
                          <input className="lv-input font-mono" value={draft.tin_number} onChange={(event) => updateDraft({ tin_number: event.target.value })} placeholder="123456789012" inputMode="numeric" />
                        </Field>
                        <Field label={L('RJSC registration no.', 'আরজেএসসি নিবন্ধন নং')}>
                          <input className="lv-input font-mono" value={draft.rjsc_reg_no} onChange={(event) => updateDraft({ rjsc_reg_no: event.target.value })} placeholder="C-123456/2026" />
                        </Field>
                        <Field label={L('VAT status', 'ভ্যাট অবস্থা')}>
                          <select className="lv-select" value={draft.vat_status} onChange={(event) => updateDraft({ vat_status: event.target.value as VatStatus })}>
                            {VAT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {L(option.en, option.bn)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <label className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${draft.is_withholding_entity ? 'border-brand-bright/40 bg-vault-50 dark:bg-vault-900/25' : 'border-line bg-surface'}`}>
                        <input
                          type="checkbox"
                          checked={draft.is_withholding_entity}
                          onChange={(event) => updateDraft({ is_withholding_entity: event.target.checked })}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-vault-700 focus:ring-brand-bright/30"
                        />
                        <span>
                          <span className="block text-[11.5px] font-semibold text-ink-800">{L('Withholding entity', 'উৎসে কর কাটার প্রতিষ্ঠান')}</span>
                          <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-500">
                            {L(
                              'Enable when this company must withhold VDS/TDS at source (Mushak 6.6 and treasury challan queues).',
                              'এই প্রতিষ্ঠানকে উৎসে ভিডিএস/টিডিএস কাটতে হলে চালু করুন (মূসক ৬.৬ ও কোষাগার চালান কিউ)।',
                            )}
                          </span>
                        </span>
                      </label>
                      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[10px] leading-relaxed text-ink-500">
                        <Landmark size={13} className="mt-0.5 shrink-0 text-ink-400" />
                        {L(
                          'A VAT-registered company requires a 13-digit BIN. Turnover-tax and exempt entities may leave BIN blank.',
                          'ভ্যাট-নিবন্ধিত প্রতিষ্ঠানের জন্য ১৩ সংখ্যার বিআইএন আবশ্যক। টার্নওভার কর ও মুক্ত প্রতিষ্ঠান বিআইএন ফাঁকা রাখতে পারে।',
                        )}
                      </div>
                    </>
                  ) : null}

                  {wizardStep === 2 ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={L('Fiscal year label', 'অর্থবছর লেবেল')} hint={L('Bangladesh fiscal year runs July–June.', 'বাংলাদেশের অর্থবছর জুলাই–জুন চলে।')}>
                          <input className="lv-input" value={draft.fiscal_year_label} onChange={(event) => updateDraft({ fiscal_year_label: event.target.value })} placeholder="FY 2026-2027" />
                        </Field>
                        <Field label={L('Reporting framework', 'প্রতিবেদন কাঠামো')}>
                          <select className="lv-select" value={draft.reporting_framework} onChange={(event) => updateDraft({ reporting_framework: event.target.value as ReportingFramework })}>
                            {FRAMEWORK_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {L(option.en, option.bn)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="rounded-xl border border-line bg-surface-2 p-3">
                        <div className="flex items-start gap-2">
                          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                          <div>
                            <p className="text-[11px] font-semibold text-ink-800">
                              {L(FRAMEWORK_OPTIONS.find((option) => option.value === draft.reporting_framework)?.en ?? '', FRAMEWORK_OPTIONS.find((option) => option.value === draft.reporting_framework)?.bn ?? '')}
                            </p>
                            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-500">
                              {L(
                                FRAMEWORK_OPTIONS.find((option) => option.value === draft.reporting_framework)?.note_en ?? '',
                                FRAMEWORK_OPTIONS.find((option) => option.value === draft.reporting_framework)?.note_bn ?? '',
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-line bg-surface p-2.5">
                          <p className="lv-kicker">{L('Periods', 'সময়কাল')}</p>
                          <p className="mt-1 text-[12px] font-semibold text-ink-800">12 × {L('OPEN', 'খোলা')}</p>
                          <p className="text-[9px] text-ink-400">{L('July → June', 'জুলাই → জুন')}</p>
                        </div>
                        <div className="rounded-xl border border-line bg-surface p-2.5">
                          <p className="lv-kicker">{L('Inventory', 'মজুত')}</p>
                          <p className="mt-1 text-[12px] font-semibold text-ink-800">{L('Weighted average', 'ভারিত গড়')}</p>
                          <p className="text-[9px] text-ink-400">{L('Perpetual COGS', 'চিরস্থায়ী সিওজিএস')}</p>
                        </div>
                        <div className="rounded-xl border border-line bg-surface p-2.5">
                          <p className="lv-kicker">{L('Cash limit', 'নগদ সীমা')}</p>
                          <p className="mt-1 text-[12px] font-semibold text-ink-800">৳ 1,00,000</p>
                          <p className="text-[9px] text-ink-400">{L('s.46 input VAT gate', 'ধারা ৪৬ ইনপুট ভ্যাট')}</p>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {wizardStep === 3 ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={L('Opening cash (BDT)', 'প্রারম্ভিক নগদ (টাকা)')} hint={L('Physical cash in hand.', 'হাতে থাকা নগদ।')}>
                          <input className="lv-input font-mono" value={draft.opening_cash} onChange={(event) => updateDraft({ opening_cash: event.target.value })} placeholder="0.00" inputMode="decimal" />
                        </Field>
                        <Field label={L('Opening bank (BDT)', 'প্রারম্ভিক ব্যাংক (টাকা)')} hint={L('Principal bank current account.', 'প্রধান ব্যাংক চলতি হিসাব।')}>
                          <input className="lv-input font-mono" value={draft.opening_bank} onChange={(event) => updateDraft({ opening_bank: event.target.value })} placeholder="0.00" inputMode="decimal" />
                        </Field>
                        <Field label={L('Opening capital (BDT)', 'প্রারম্ভিক মূলধন (টাকা)')} hint={L('Must equal cash + bank for a balanced opening entry.', 'ভারসাম্যপূর্ণ প্রারম্ভিক এন্ট্রির জন্য নগদ + ব্যাংকের সমান হতে হবে।')}>
                          <input className="lv-input font-mono" value={draft.opening_capital} onChange={(event) => updateDraft({ opening_capital: event.target.value })} placeholder="0.00" inputMode="decimal" />
                        </Field>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => updateDraft({ opening_capital: poishaToInput((opening.cash ?? 0n) + (opening.bank ?? 0n)) })}
                            className="lv-btn lv-btn-secondary w-full"
                          >
                            <Wallet size={13} /> {L('Match capital to cash + bank', 'মূলধন = নগদ + ব্যাংক')}
                          </button>
                        </div>
                        <Field label={L('Bank name', 'ব্যাংকের নাম')}>
                          <input className="lv-input" value={draft.bank_name} onChange={(event) => updateDraft({ bank_name: event.target.value })} placeholder="City Bank PLC" />
                        </Field>
                        <Field label={L('Masked account number', 'মাস্ককৃত হিসাব নম্বর')}>
                          <input className="lv-input font-mono" value={draft.bank_account_masked} onChange={(event) => updateDraft({ bank_account_masked: event.target.value })} placeholder="•••• 4821" />
                        </Field>
                      </div>

                      <div className={`rounded-xl border p-3 ${opening.valid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-[10.5px] font-semibold ${opening.valid ? 'text-emerald-800' : 'text-amber-900'}`}>
                            {opening.valid ? L('Opening entry is balanced', 'প্রারম্ভিক এন্ট্রি ভারসাম্যপূর্ণ') : L('Opening entry is not balanced yet', 'প্রারম্ভিক এন্ট্রি এখনও ভারসাম্যপূর্ণ নয়')}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${opening.valid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {opening.variance === null ? '—' : money(opening.variance, { sign: true })}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[8.5px] uppercase tracking-[0.08em] text-ink-500">{L('Cash Dr', 'নগদ ডেবিট')}</p>
                            <p className="font-mono text-[11px] font-semibold text-ink-800">{opening.cash === null ? '—' : money(opening.cash)}</p>
                          </div>
                          <div>
                            <p className="text-[8.5px] uppercase tracking-[0.08em] text-ink-500">{L('Bank Dr', 'ব্যাংক ডেবিট')}</p>
                            <p className="font-mono text-[11px] font-semibold text-ink-800">{opening.bank === null ? '—' : money(opening.bank)}</p>
                          </div>
                          <div>
                            <p className="text-[8.5px] uppercase tracking-[0.08em] text-ink-500">{L('Capital Cr', 'মূলধন ক্রেডিট')}</p>
                            <p className="font-mono text-[11px] font-semibold text-ink-800">{opening.capital === null ? '—' : money(opening.capital)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[10px] leading-relaxed text-ink-500">
                        <CircleAlert size={13} className="mt-0.5 shrink-0 text-ink-400" />
                        {L(
                          'The opening journal is posted as Dr Cash, Dr Bank, Cr Capital. Only a balanced entry is accepted, so the trial balance starts at zero variance.',
                          'প্রারম্ভিক জার্নাল ডেবিট নগদ, ডেবিট ব্যাংক, ক্রেডিট মূলধন হিসেবে পোস্ট হয়। কেবল ভারসাম্যপূর্ণ এন্ট্রি গ্রহণ করা হয়, তাই ট্রায়াল ব্যালেন্স শূন্য ভ্যারিয়েন্সে শুরু হয়।',
                        )}
                      </div>
                    </>
                  ) : null}

                  {wizardError ? (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10.5px] leading-relaxed text-rose-800">
                      <CircleAlert size={13} className="mt-0.5 shrink-0" />
                      {wizardError}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-3">
                  <button type="button" onClick={() => setWizardStep((step) => Math.max(0, step - 1))} disabled={wizardStep === 0} className="lv-btn lv-btn-secondary">
                    <ArrowLeft size={13} /> {L('Back', 'পেছনে')}
                  </button>
                  <span className="text-[9.5px] text-ink-400">
                    {L('Step', 'ধাপ')} {wizardStep + 1}/4
                  </span>
                  {wizardStep < 3 ? (
                    <button type="button" onClick={handleNext} disabled={!stepValid} className="lv-btn lv-btn-primary">
                      {L('Continue', 'চালিয়ে যান')} <ArrowRight size={13} />
                    </button>
                  ) : (
                    <button type="button" onClick={handleSubmit} disabled={!opening.valid || !canOnboard} className="lv-btn lv-btn-primary">
                      <Sparkles size={13} /> {L('Create company', 'কোম্পানি তৈরি')}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );

  return createPortal(content, document.body);
}

export default AuthAndOnboardingModal;
