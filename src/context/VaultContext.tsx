// Fintuity Accounting Suite — Phase 2 reactive vault: one immutable ledger, two doors, multi-book views.
//
// Everything a workspace renders comes from this provider: the seeded Apex Delta dataset, the live
// journal array with its SHA-256 chain, the persona / mode / locale / numeral / grouping / motion
// preferences, and the action dispatchers that post, reverse, import, roll back and reconcile.
//
// Persistence is deliberately defensive: the complete state is written through the durable storage
// layer (`vaultDb.ts` — localStorage + IndexedDB), every `*_poisha` key is revived as bigint on load,
// and any corrupt snapshot silently falls back to the seed dataset instead of breaking the app
// (load-shedding-safe local drafts).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createTranslator, type Translator } from '../core/i18n';
import { addDays, formatPoisha, isoNow } from '../core/money';
import { loadStoredPreferences, saveStoredPreferences } from '../core/storage/preferences';
import { useAuth } from '../auth/AuthContext';
import type { AuthCompany, AuthUser, ServerPermission } from '../auth/types';
import { buildFinancialStatements, previousPeriodCode } from '../core/ifrs-engine/ifrsEngine';
import {
  buildCogsJournalLines,
  buildReturnCogsJournalLines,
  calculatePerpetualCogs,
  issueInventoryStock,
  lineTaxBasePoisha,
  receiveInventoryStock,
  returnInventoryStock,
  type StockReceiptLine,
} from '../core/tax-engine/engine';
import {
  downloadVaultFile,
  importVaultFile as readVaultFileFromDisk,
  loadLatestVaultSnapshot,
  loadLocalVaultSnapshot,
  saveVaultSnapshot,
} from '../core/storage/vaultDb';
import {
  allocateMushak63Serial,
  buildCommercialDoc,
  createReversalJournal,
  journalTotals,
  nextCommercialDocNumber,
  postJournal,
  periodStatusFor,
  reconcileSubledgers,
  settleCommercialDoc,
  verifyAuditChain,
  type AuditChainResult,
  type JournalDraft,
  type JournalLineDraft,
  type SettlementResult,
  type SubledgerReconciliation,
  type TaxAnnotatedDoc,
} from '../core/ledger/ledgerEngine';
import {
  createSeedDataset,
  getSeedDataset,
  tenantByKey,
  type PayrollEmployeeRow,
  type SeedDataset,
  type SeedItem,
  type StatutoryNoticeAndLicence,
} from '../core/ledger/seedData';
import {
  applyBatchBalanceRules,
  buildJournalsFromSimulation,
  parseAndSimulateImport,
  type ImportSheetRow,
  type ImportState,
} from '../core/import-export/xlsxEngine';
import type {
  Account,
  AccountingPeriod,
  AppSettings,
  BankAccount,
  BankStatementLine,
  BookType,
  Challan,
  CreateDocInput,
  CustomTenantInput,
  ImportBatch,
  ImportSimulation,
  InventoryItem,
  JournalEntry,
  Party,
  PaymentMethod,
  PermissionAction,
  StockMovement,
  TdsNature,
  TenantEntity,
  ToastMessage,
  UserAccount,
  UserRole,
  VdsCertificate,
} from '../core/types';

const ROLE_PERMISSIONS: Record<PermissionAction, readonly UserRole[]> = {
  MANAGE_COMPANY_SETTINGS: ['OWNER', 'ADMIN', 'CONTROLLER'],
  CREATE_COMMERCIAL_DRAFT: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR'],
  DISPATCH_OR_RECEIVE_STOCK: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR'],
  POST_TO_GL: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT'],
  APPROVE_HIGH_VALUE: ['OWNER', 'ADMIN', 'CONTROLLER'],
  OVERRIDE_3WAY_VARIANCE: ['OWNER', 'ADMIN', 'CONTROLLER'],
  REVERSE_POSTED_JOURNAL: ['OWNER', 'ADMIN', 'CONTROLLER'],
  SUBMIT_CLOSE_MAKER: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT'],
  APPROVE_CLOSE_CHECKER: ['OWNER', 'ADMIN', 'CONTROLLER'],
  MANAGE_MASTERS_AND_COA: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT'],
  MANAGE_USERS_AND_ORG: ['OWNER', 'ADMIN'],
  VIEW_REPORTS: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'AUDITOR'],
  VIEW_LIMITED_REPORTS: ['OPERATOR'],
  EXPORT_DATA: ['OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'AUDITOR'],
  OVERRIDE_NEGATIVE_STOCK: ['OWNER', 'ADMIN', 'CONTROLLER'],
};

const SEED_USERS: readonly UserAccount[] = [
  {
    id: 'USR-ADMIN-01',
    username: 'f.akter',
    full_name: 'Farzana Akter',
    role: 'ADMIN',
    email: 'farzana.akter@fintuity.app',
    designation: 'Managing Director',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'USR-CONTROLLER-01',
    username: 'n.sultana',
    full_name: 'Nasrin Sultana',
    role: 'CONTROLLER',
    email: 'nasrin.sultana@fintuity.app',
    designation: 'Financial Controller',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'USR-ACCOUNTANT-01',
    username: 'r.hasan',
    full_name: 'Rakib Hasan',
    role: 'ACCOUNTANT',
    email: 'rakib.hasan@fintuity.app',
    designation: 'Senior Accountant',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'USR-OPERATOR-01',
    username: 's.islam',
    full_name: 'Sumaiya Islam',
    role: 'OPERATOR',
    email: 'sumaiya.islam@fintuity.app',
    designation: 'Sales & Dispatch Operator',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'USR-AUDITOR-01',
    username: 'm.rahman',
    full_name: 'Mizanur Rahman',
    role: 'AUDITOR',
    email: 'mizanur.rahman@fintuity.app',
    designation: 'External Auditor',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

function seededUsers(): UserAccount[] {
  return SEED_USERS.map((user) => ({ ...user }));
}

const READ_ONLY_ERROR = 'Read-Only Auditor Mode — this action is not available to the current role.';

function deny(permission: PermissionAction): { ok: false; error: string } {
  return { ok: false, error: `${READ_ONLY_ERROR} Required permission: ${permission}.` };
}

export type AccountDraft = Pick<Account, 'code' | 'name_en'> & Partial<Omit<Account, 'code' | 'name_en'>>;

export type PartyDraft = Partial<Omit<Party, 'id'>> & { id?: string; name_en: string };

export type ItemDraft = Partial<SeedItem> & { id?: string; name_en?: string };

export const IMPORT_BATCH_PREFIX = 'IMP';
export const LINKED_REVERSAL_NOTE =
  'The original journal stays in the chain, marked REVERSED, and the two entries are linked both ways.';

export interface VaultState {
  activePersona: TenantEntity['persona_key'];
  tenant: TenantEntity;
  mode: AppSettings['mode'];
  locale: AppSettings['locale'];
  numeralScript: AppSettings['numeral'];
  grouping: AppSettings['grouping'];
  motionTier: AppSettings['motion'];
  theme: AppSettings['theme'];
  bookFilter: AppSettings['bookFilter'];
  users: UserAccount[];
  currentUser: UserAccount;
  isAuthenticated: boolean;
  accounts: Account[];
  journals: JournalEntry[];
  commercialDocs: TaxAnnotatedDoc[];
  challans: Challan[];
  bankAccounts: BankAccount[];
  statementLines: BankStatementLine[];
  importBatches: ImportBatch[];
  vdsCertificates: VdsCertificate[];
  payrollRows: PayrollEmployeeRow[];
  parties: Party[];
  items: SeedItem[];
  stockMovements: StockMovement[];
  periods: AccountingPeriod[];
  statutoryRecords: StatutoryNoticeAndLicence[];
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface VaultContextValue extends VaultState {
  t: Translator;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  statements: ReturnType<typeof buildFinancialStatements>;
  statementPeriodCode: string;
  setStatementPeriodCode: (periodCode: string) => void;
  reconciliation: SubledgerReconciliation;
  auditChain: AuditChainResult;
  toasts: ToastMessage[];
  publishToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  // Identity & access control (authorization is resolved by the server session in AuthContext)
  hasPermission: (permission: PermissionAction) => boolean;
  // Master data
  addAccount: (input: AccountDraft) => ActionResult<Account>;
  upsertAccount: (input: AccountDraft) => ActionResult<Account>;
  upsertParty: (input: PartyDraft) => ActionResult<Party>;
  upsertItem: (input: ItemDraft) => ActionResult<SeedItem>;
  // Company onboarding
  createCustomTenant: (input: CustomTenantInput) => ActionResult<TenantEntity>;
  // Data durability
  exportVaultFile: () => string | null;
  importVaultFile: (file: File) => Promise<ActionResult<VaultState>>;
  // Preferences
  setLocale: (locale: AppSettings['locale']) => void;
  setNumeralScript: (numeral: AppSettings['numeral']) => void;
  setGrouping: (grouping: AppSettings['grouping']) => void;
  setMode: (mode: AppSettings['mode']) => void;
  setMotionTier: (motion: AppSettings['motion']) => void;
  setTheme: (theme: AppSettings['theme']) => void;
  setBookFilter: (filter: AppSettings['bookFilter']) => void;
  setReportingFramework: (framework: TenantEntity['reporting_framework']) => void;
  setPeriodStatus: (periodCode: string, status: AccountingPeriod['status']) => ActionResult<AccountingPeriod>;
  setPersona: (persona: TenantEntity['persona_key']) => void;
  resetDemoData: () => void;
  // Ledger actions
  postCommercialDoc: (input: CreateDocInput, options?: { settle?: boolean }) => ActionResult<TaxAnnotatedDoc>;
  settleCommercialDocument: (
    docId: string,
    options?: { bank_account_code?: string; settlement_date?: string },
  ) => ActionResult<SettlementResult<TaxAnnotatedDoc>>;
  postManualJournal: (draft: {
    date: string;
    book_type?: BookType;
    narration_en: string;
    narration_bn: string;
    lines: JournalLineDraft[];
    source_module?: JournalDraft['source_module'];
  }) => ActionResult<JournalEntry>;
  reverseJournal: (journalId: string, reason: string) => ActionResult<JournalEntry>;
  commitImportBatch: (simulation: ImportSimulation) => ActionResult<ImportBatch>;
  rollbackImportBatch: (batchId: string) => ActionResult<ImportBatch>;
  depositTreasuryChallan: (challanId: string) => ActionResult<JournalEntry>;
  depositChallanBatch: (input: {
    challan_ids: string[];
    bank_account_code: string;
    bank_branch: string;
    deposit_date: string;
    batch_reference: string;
  }) => ActionResult<JournalEntry>;
  receiveVdsCertificate: (certificateId: string) => ActionResult<VdsCertificate>;
  reconcileBankLine: (lineId: string) => ActionResult<BankStatementLine>;
  nextMushakSerial: (binUnitId: string, year: string) => string;
  importState: ImportState;
  simulateRows: (rows: ImportSheetRow[], pipeline: ImportSimulation['pipeline']) => ImportSimulation;
}

const VaultContext = createContext<VaultContextValue | null>(null);

// ---------------------------------------------------------------------------------------------
// Initial state + persistence
// ---------------------------------------------------------------------------------------------

function stateFromDataset(dataset: SeedDataset, preferences: Partial<VaultState> = {}): VaultState {
  const users = preferences.users && preferences.users.length > 0 ? preferences.users : seededUsers();
  return {
    activePersona: dataset.tenant.persona_key,
    tenant: dataset.tenant,
    mode: preferences.mode ?? 'PRO',
    locale: preferences.locale ?? 'en-BD',
    numeralScript: preferences.numeralScript ?? 'latin',
    grouping: preferences.grouping ?? 'LAKH_CRORE',
    motionTier: preferences.motionTier ?? 'FULL',
    theme: preferences.theme ?? 'LIGHT',
    bookFilter: preferences.bookFilter ?? 'ALL_IFRS_BOOKS',
    users,
    currentUser: preferences.currentUser ?? users[0],
    isAuthenticated: preferences.isAuthenticated ?? true,
    accounts: dataset.accounts,
    journals: dataset.journals,
    commercialDocs: dataset.commercialDocs,
    challans: dataset.challans,
    bankAccounts: dataset.bankAccounts,
    statementLines: dataset.statementLines,
    importBatches: [],
    vdsCertificates: dataset.vdsCertificates,
    payrollRows: dataset.payrollRows,
    parties: dataset.parties,
    items: withInventoryDefaults(dataset.items),
    stockMovements: [],
    periods: dataset.periods,
    statutoryRecords: dataset.statutoryRecords,
  };
}

function buildInitialState(persona: TenantEntity['persona_key'] = 'APEX'): VaultState {
  return stateFromDataset(getSeedDataset(persona));
}

/**
 * Rebuild a complete VaultState from a restored snapshot. A custom company keeps its persisted
 * tenant rather than being overwritten by the demo persona lookup, and every master-data array is
 * restored verbatim — accounts, parties, items and statutory records are never dropped.
 */
function normalizeRestoredState(revived: Partial<VaultState> | null | undefined): VaultState | null {
  if (!revived || typeof revived !== 'object') return null;
  if (!Array.isArray(revived.accounts) || revived.accounts.length === 0) return null;
  if (!Array.isArray(revived.journals)) return null;
  const persona: TenantEntity['persona_key'] =
    revived.activePersona === 'CLOUDNINE' || revived.activePersona === 'RAFIQ' ? revived.activePersona : 'APEX';
  const base = stateFromDataset(getSeedDataset(persona), revived);
  const users = Array.isArray(revived.users) && revived.users.length > 0 ? revived.users : base.users;
  const savedCurrent = revived.currentUser;
  const currentUser =
    savedCurrent && users.some((user) => user.id === savedCurrent?.id) ? savedCurrent : users[0] ?? base.currentUser;
  const restoredTenant =
    revived.tenant && typeof revived.tenant.id === 'string' && typeof revived.tenant.name_en === 'string'
      ? revived.tenant
      : base.tenant;
  return {
    ...base,
    ...revived,
    tenant: restoredTenant,
    theme: revived.theme ?? base.theme,
    accounts: revived.accounts,
    journals: revived.journals,
    commercialDocs: revived.commercialDocs ?? base.commercialDocs,
    challans: revived.challans ?? base.challans,
    bankAccounts: revived.bankAccounts ?? base.bankAccounts,
    statementLines: revived.statementLines ?? base.statementLines,
    importBatches: revived.importBatches ?? [],
    payrollRows: revived.payrollRows ?? base.payrollRows,
    vdsCertificates: revived.vdsCertificates ?? base.vdsCertificates,
    periods: revived.periods ?? base.periods,
    parties: revived.parties ?? base.parties,
    items: withInventoryDefaults(revived.items ?? base.items),
    stockMovements: revived.stockMovements ?? [],
    statutoryRecords: revived.statutoryRecords ?? base.statutoryRecords,
    users,
    currentUser,
    isAuthenticated: revived.isAuthenticated ?? true,
  };
}

function loadPersistedState(): VaultState | null {
  const restored = loadLocalVaultSnapshot<Partial<VaultState>>();
  return restored ? normalizeRestoredState(restored.state) : null;
}

/**
 * Persist the COMPLETE state — no array is stripped. localStorage gives a synchronous durable copy;
 * IndexedDB is written in parallel for quota headroom and eviction resistance.
 */
function persistState(state: VaultState): void {
  void saveVaultSnapshot(state).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function expenseAccountFor(nature: TdsNature, docType: CreateDocInput['doc_type']): string {
  if (docType === 'PURCHASE_BILL') return '1310';
  if (docType === 'IMPORTED_SERVICE') return '5320';
  switch (nature) {
    case 'COMMERCIAL_RENT':
      return '5300';
    case 'PROFESSIONAL_OR_TECHNICAL_SERVICES':
      return '5310';
    case 'ADVERTISING_OR_MEDIA':
      return '5320';
    case 'TRANSPORT_OR_LOGISTICS':
      return '5330';
    default:
      return '5310';
  }
}

function settlementAccountCode(method: PaymentMethod, channel?: string): string {
  if (method === 'CASH') return '1130';
  if (method === 'MFS') return (channel ?? '').toLowerCase().includes('nagad') ? '1125' : '1120';
  if ((channel ?? '').toLowerCase().includes('brac')) return '1115';
  return '1110';
}

function statementLineFromJournal(journal: JournalEntry, bankCodes: Set<string>, sequence: number): BankStatementLine[] {
  const lines: BankStatementLine[] = [];
  let offset = 0;
  for (const line of journal.lines) {
    if (!bankCodes.has(line.account_code)) continue;
    offset += 1;
    lines.push({
      id: `STL-LIVE-${String(sequence).padStart(4, '0')}-${offset}`,
      account_code: line.account_code,
      date: journal.posting_date,
      description: journal.narration_en,
      reference: journal.journal_number,
      debit_poisha: line.debit_poisha,
      credit_poisha: line.credit_poisha,
      // Demo only: a journal that touches a bank account adds synthetic statement evidence, but it
      // is never pre-matched. The demo accountant must match it explicitly, as in the server flow.
      status: 'UNMATCHED',
      matched_doc_ref: undefined,
      fee_poisha: 0n,
      journal_id: undefined,
    });
  }
  return lines;
}

function accountNameOf(accounts: Account[], code: string): { en: string; bn: string } {
  const account = accounts.find((entry) => entry.code === code);
  return { en: account?.name_en ?? code, bn: account?.name_bn ?? code };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function fiscalStartYear(label: string): number {
  const matches = label.match(/\d{4}/g);
  const parsed = matches && matches[0] ? Number(matches[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

/** Bangladesh fiscal year: July → June, twelve OPEN monthly periods. */
function buildFiscalPeriods(label: string): AccountingPeriod[] {
  const startYear = fiscalStartYear(label);
  const periods: AccountingPeriod[] = [];
  for (let index = 0; index < 12; index += 1) {
    const cursor = new Date(Date.UTC(startYear, 6 + index, 1));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const code = `${year}-${String(month).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    periods.push({
      code,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
      start_date: `${code}-01`,
      end_date: `${code}-${String(lastDay).padStart(2, '0')}`,
      status: 'OPEN',
    });
  }
  return periods;
}

function defaultSubCategory(type: Account['account_type']): Account['sub_category'] {
  switch (type) {
    case 'LIABILITY':
      return 'CURRENT_LIABILITY';
    case 'EQUITY':
      return 'EQUITY_CAPITAL';
    case 'REVENUE':
      return 'OPERATING_REVENUE';
    case 'EXPENSE':
      return 'OPERATING_EXPENSE';
    case 'ASSET':
    default:
      return 'CURRENT_ASSET';
  }
}

function defaultIfrs18Category(type: Account['account_type']): Account['ifrs18_category'] {
  return type === 'REVENUE' || type === 'EXPENSE' ? 'OPERATING' : 'NA_BALANCE_SHEET';
}

function materializeAccount(input: AccountDraft): Account {
  const type = input.account_type ?? 'ASSET';
  return {
    code: input.code.trim(),
    name_en: input.name_en.trim(),
    name_bn: input.name_bn ?? input.name_en.trim(),
    account_type: type,
    sub_category: input.sub_category ?? defaultSubCategory(type),
    ifrs18_category: input.ifrs18_category ?? defaultIfrs18Category(type),
    ifrs_statement_line_id: input.ifrs_statement_line_id ?? '',
    control_subledger: input.control_subledger ?? 'NONE',
    opening_debit_poisha: input.opening_debit_poisha ?? 0n,
    opening_credit_poisha: input.opening_credit_poisha ?? 0n,
    is_active: input.is_active ?? true,
    note_ref: input.note_ref ?? '',
    cash_flow_tag: input.cash_flow_tag ?? (type === 'REVENUE' || type === 'EXPENSE' ? 'OPERATING' : 'NONE'),
  };
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || fallback;
}

/**
 * Perpetual-inventory defaults for seeded goods (blueprint §4.1–4.2): 100 units on hand at a 70%
 * weighted-average cost. Existing quantities and costs are preserved, including an explicit zero.
 */
function withInventoryDefaults<T extends InventoryItem>(items: readonly T[]): T[] {
  return items.map((item) => {
    if (item.is_stock_item === false) return item;
    return {
      ...item,
      qty_on_hand: item.qty_on_hand ?? 100,
      unit_cost_poisha: item.unit_cost_poisha ?? (item.unit_price_poisha * 7000n) / 10000n,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Server-backed shell state
// ---------------------------------------------------------------------------------------------

/**
 * Phase 3 mounts the real shell without pretending the browser ledger is server data. The blank
 * state carries identity and display preferences only; financial workspaces are withheld until the
 * server-authoritative ledger arrives in Phase 5.
 */
function realTenant(company: AuthCompany | null): TenantEntity {
  return {
    id: company?.id ?? 'NO-COMPANY',
    persona_key: 'APEX',
    name_en: company?.legalName ?? 'No company selected',
    name_bn: company?.legalName ?? 'কোনো কোম্পানি নির্বাচিত নয়',
    trade_name: company?.tradeName ?? '',
    entity_type: (company?.entityType as TenantEntity['entity_type']) ?? 'PRIVATE_LIMITED',
    industry_pack: 'TRADING_DISTRIBUTION',
    tin_number: company?.tin ?? '',
    rjsc_reg_no: '',
    vat_status: 'EXEMPT',
    is_withholding_entity: false,
    reporting_framework: 'SIMPLIFIED_MANAGEMENT',
    fiscal_year_label: 'Not configured',
    functional_currency: 'BDT',
    address_en: '',
    address_bn: '',
    telephone: '',
    email: company?.organisationName ?? '',
    bin_units: company?.bin
      ? [
          {
            id: 'PRINCIPAL',
            bin_number: company.bin,
            unit_name_en: 'Principal place of business',
            unit_name_bn: 'প্রধান কার্যালয়',
            address: '',
            is_principal: true,
          },
        ]
      : [],
    accounting_policies: {
      inventory_formula: 'WEIGHTED_AVERAGE',
      depreciation_method: 'STRAIGHT_LINE',
      ifrs18_early_adoption: false,
      ecl_provision_matrix_enabled: false,
      cash_disallowance_limit_poisha: 0n,
    },
  };
}

function authUserToAccount(
  user: AuthUser | null,
  company: AuthCompany | null,
  membership: { role: UserRole } | null,
): UserAccount {
  return {
    id: user?.id ?? 'UNKNOWN',
    username: user?.email.split('@')[0] ?? 'unknown',
    full_name: user?.name ?? 'Unknown user',
    role: company?.role ?? membership?.role ?? 'AUDITOR',
    email: user?.email ?? '',
    designation: company?.role ?? membership?.role ?? 'AUDITOR',
    is_active: user?.status === 'ACTIVE',
    created_at: '2026-01-01T00:00:00.000Z',
    ...(user?.lastLoginAt ? { last_login_at: user.lastLoginAt } : {}),
  };
}

function buildRealState(
  preferences: ReturnType<typeof loadStoredPreferences>,
  currentUser: UserAccount,
  company: AuthCompany | null,
): VaultState {
  return {
    activePersona: 'APEX',
    tenant: realTenant(company),
    mode: preferences.mode ?? 'PRO',
    locale: preferences.locale ?? 'en-BD',
    numeralScript: preferences.numeralScript ?? 'latin',
    grouping: preferences.grouping ?? 'LAKH_CRORE',
    motionTier: preferences.motionTier ?? 'FULL',
    theme: preferences.theme ?? 'LIGHT',
    bookFilter: preferences.bookFilter ?? 'ALL_IFRS_BOOKS',
    users: [currentUser],
    currentUser,
    isAuthenticated: true,
    accounts: [],
    journals: [],
    commercialDocs: [],
    challans: [],
    bankAccounts: [],
    statementLines: [],
    importBatches: [],
    vdsCertificates: [],
    payrollRows: [],
    parties: [],
    items: [],
    stockMovements: [],
    periods: [],
    statutoryRecords: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------------

export function VaultProvider({ children, demoMode }: { children: ReactNode; demoMode: boolean }) {
  const auth = useAuth();
  const currentUser = useMemo(
    () => authUserToAccount(auth.user, auth.activeCompany, auth.activeMembership),
    [auth.user, auth.activeCompany, auth.activeMembership],
  );
  const [state, setState] = useState<VaultState>(() => {
    if (!demoMode) return buildRealState(loadStoredPreferences(), currentUser, auth.activeCompany);
    const base = loadPersistedState() ?? buildInitialState('APEX');
    return {
      ...base,
      currentUser,
      users: base.users.some((user) => user.id === currentUser.id) ? base.users : [...base.users, currentUser],
      isAuthenticated: true,
    };
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [statementPeriodSelection, setStatementPeriodSelection] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const storageReadyRef = useRef(false);

  const defaultStatementPeriod = useMemo(() => {
    const sorted = [...state.periods].sort((left, right) => right.start_date.localeCompare(left.start_date));
    const withActivity = sorted.find((period) =>
      state.journals.some((journal) => journal.period_code === period.code),
    );
    return (withActivity ?? sorted[0])?.code ?? new Date().toISOString().slice(0, 7);
  }, [state.journals, state.periods]);

  const statementPeriodCode =
    statementPeriodSelection && state.periods.some((period) => period.code === statementPeriodSelection)
      ? statementPeriodSelection
      : defaultStatementPeriod;

  const statementComparativeCode = useMemo(() => {
    const sorted = [...state.periods].sort((left, right) => left.start_date.localeCompare(right.start_date));
    const index = sorted.findIndex((period) => period.code === statementPeriodCode);
    return index > 0 ? sorted[index - 1]!.code : previousPeriodCode(statementPeriodCode);
  }, [state.periods, statementPeriodCode]);

  const setStatementPeriodCode = useCallback((periodCode: string) => {
    setStatementPeriodSelection(periodCode);
  }, []);

  const hasPermission = useCallback(
    (permission: PermissionAction): boolean => {
      if (!auth.demoMode) return auth.hasCompanyPermission(permission as ServerPermission);
      const { currentUser: actor, isAuthenticated } = stateRef.current;
      if (!isAuthenticated || !actor || !actor.is_active) return false;
      return ROLE_PERMISSIONS[permission].includes(actor.role);
    },
    [auth],
  );

  // Keep the legacy context identity in step with the server session. In the real shell the
  // financial arrays stay empty until the server-authoritative ledger is introduced.
  useEffect(() => {
    setState((previous) => {
      if (demoMode) {
        return {
          ...previous,
          currentUser,
          users: previous.users.some((user) => user.id === currentUser.id)
            ? previous.users
            : [...previous.users, currentUser],
          isAuthenticated: true,
        };
      }
      return {
        ...previous,
        tenant: realTenant(auth.activeCompany),
        currentUser,
        users: [currentUser],
        isAuthenticated: auth.status === 'authenticated',
      };
    });
  }, [demoMode, currentUser, auth.activeCompany, auth.status]);

  const publishToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `TOAST-${Date.now()}-${Math.round(Math.random() * 9999)}`;
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  // Demo mode keeps the complete synthetic snapshot. The real shell persists display preferences
  // only and never writes financial-shaped data to browser storage.
  useEffect(() => {
    if (!demoMode) {
      saveStoredPreferences({
        mode: state.mode,
        locale: state.locale,
        numeralScript: state.numeralScript,
        grouping: state.grouping,
        motionTier: state.motionTier,
        theme: state.theme,
        bookFilter: state.bookFilter,
      });
      return;
    }
    if (!storageReadyRef.current) return;
    persistState(state);
  }, [state, demoMode]);

  // On a cold start the synchronous localStorage copy paints first; this upgrades to the newest
  // IndexedDB snapshot if it is fresher (for example after localStorage was evicted).
  useEffect(() => {
    if (!demoMode) {
      storageReadyRef.current = true;
      return;
    }
    let cancelled = false;
    const hydrate = async (): Promise<void> => {
      const latest = await loadLatestVaultSnapshot<Partial<VaultState>>();
      if (cancelled) return;
      const normalized =
        latest && latest.source === 'indexeddb' ? normalizeRestoredState(latest.state) : null;
      storageReadyRef.current = true;
      if (normalized) {
        setState(normalized);
      } else {
        persistState(stateRef.current);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = state.locale;
    document.documentElement.dataset.locale = state.locale;
    document.documentElement.dataset.motion = state.motionTier;
    document.documentElement.dataset.mode = state.mode;
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.classList.toggle('dark', state.theme === 'DARK');
    document.documentElement.classList.toggle('hc', state.theme === 'CONTRAST');
    document.documentElement.style.colorScheme = state.theme === 'DARK' ? 'dark' : 'light';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', state.theme === 'DARK' ? '#070b09' : state.theme === 'CONTRAST' ? '#ffffff' : '#f6f5f0');
    }
  }, [state.locale, state.motionTier, state.mode, state.theme]);

  const t = useMemo(
    () => createTranslator(state.locale, { numeral: state.numeralScript }),
    [state.locale, state.numeralScript],
  );

  const money = useCallback(
    (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) =>
      formatPoisha(poisha, {
        locale: state.locale,
        numeral: state.numeralScript,
        grouping: state.grouping,
        showSign: options?.sign,
        showSymbol: options?.symbol,
      }),
    [state.locale, state.numeralScript, state.grouping],
  );

  const statements = useMemo(
    () =>
      buildFinancialStatements({
        tenant: state.tenant,
        accounts: state.accounts,
        journals: state.journals,
        commercialDocs: state.commercialDocs,
        parties: state.parties,
        bankAccounts: state.bankAccounts,
        bookFilter: state.bookFilter,
        periodCode: statementPeriodCode,
        comparativeCode: statementComparativeCode,
      }),
    [
      state.tenant,
      state.accounts,
      state.journals,
      state.commercialDocs,
      state.parties,
      state.bankAccounts,
      state.bookFilter,
      statementComparativeCode,
      statementPeriodCode,
    ],
  );

  const reconciliation = useMemo(
    () => reconcileSubledgers(state.accounts, state.journals, state.commercialDocs, state.bankAccounts),
    [state.accounts, state.journals, state.commercialDocs, state.bankAccounts],
  );

  const auditChain = useMemo(() => verifyAuditChain(state.journals), [state.journals]);

  const importState = useMemo<ImportState>(
    () => ({
      tenant: state.tenant,
      accounts: state.accounts,
      journals: state.journals,
      commercialDocs: state.commercialDocs,
      periods: state.periods,
      parties: state.parties,
      bankAccounts: state.bankAccounts,
    }),
    [state.tenant, state.accounts, state.journals, state.commercialDocs, state.periods, state.parties, state.bankAccounts],
  );

  // ---- Preferences -------------------------------------------------------------------------
  const setLocale = useCallback((locale: AppSettings['locale']) => {
    setState((current) => ({
      ...current,
      locale,
      numeralScript: locale === 'bn-BD' ? 'bn' : 'latin',
    }));
  }, []);

  const setNumeralScript = useCallback((numeral: AppSettings['numeral']) => {
    setState((current) => ({ ...current, numeralScript: numeral }));
  }, []);

  const setGrouping = useCallback((grouping: AppSettings['grouping']) => {
    setState((current) => ({ ...current, grouping }));
  }, []);

  const setMode = useCallback((mode: AppSettings['mode']) => {
    setState((current) => ({ ...current, mode }));
  }, []);

  const setMotionTier = useCallback((motionTier: AppSettings['motion']) => {
    setState((current) => ({ ...current, motionTier }));
  }, []);

  const setTheme = useCallback((theme: AppSettings['theme']) => {
    setState((current) => ({ ...current, theme }));
  }, []);

  // Shareable theme deep-links (`?theme=dark` / `?theme=contrast`) for board screens and kiosks.
  const themeLinkApplied = useRef(false);
  useEffect(() => {
    if (themeLinkApplied.current || typeof window === 'undefined') return;
    themeLinkApplied.current = true;
    const requested = new URLSearchParams(window.location.search).get('theme')?.toUpperCase();
    if (requested === 'LIGHT' || requested === 'DARK' || requested === 'CONTRAST') {
      setTheme(requested);
    }
  }, [setTheme]);

  const setBookFilter = useCallback((bookFilter: AppSettings['bookFilter']) => {
    setState((current) => ({ ...current, bookFilter }));
  }, []);

  // The reporting framework drives the IAS 1 / IFRS 18 compliance header and the disclosure text,
  // so it lives on the tenant rather than in a screen-local toggle.
  const setReportingFramework = useCallback(
    (framework: TenantEntity['reporting_framework']) => {
      if (!hasPermission('MANAGE_MASTERS_AND_COA')) {
        publishToast({ tone: 'error', title: 'Framework unchanged', message: READ_ONLY_ERROR });
        return;
      }
      setState((current) => ({ ...current, tenant: { ...current.tenant, reporting_framework: framework } }));
      publishToast({
        tone: 'info',
        title: 'Reporting framework changed',
        message: `${stateRef.current.tenant.name_en} now presents under ${framework.replace(/_/g, ' ')}.`,
      });
    },
    [hasPermission, publishToast],
  );

  const setPeriodStatus = useCallback(
    (periodCode: string, status: AccountingPeriod['status']): ActionResult<AccountingPeriod> => {
      if (!hasPermission('APPROVE_CLOSE_CHECKER')) return deny('APPROVE_CLOSE_CHECKER');
      const current = stateRef.current;
      const period = current.periods.find((entry) => entry.code === periodCode);
      if (!period) return { ok: false, error: `Period ${periodCode} not found.` };
      const updated: AccountingPeriod = {
        ...period,
        status,
        closed_at: status === 'OPEN' ? undefined : isoNow(),
        closed_by: status === 'OPEN' ? undefined : current.currentUser.full_name,
        locked_at: status === 'LOCKED' ? isoNow() : undefined,
      };
      setState((previous) => ({
        ...previous,
        periods: previous.periods.map((entry) => (entry.code === periodCode ? updated : entry)),
      }));
      publishToast({
        tone: status === 'OPEN' ? 'info' : 'success',
        title: status === 'OPEN' ? `Period ${periodCode} re-opened` : `Period ${periodCode} ${status.toLowerCase()}`,
        message:
          status === 'OPEN'
            ? 'Posting is allowed again for this period.'
            : 'The posting engine now rejects anything dated inside this period.',
      });
      return { ok: true, data: updated };
    },
    [hasPermission, publishToast],
  );

  const setPersona = useCallback(
    (persona: TenantEntity['persona_key']) => {
      if (!demoMode) {
        publishToast({
          tone: 'warning',
          title: 'Company switching is server-controlled',
          message: 'Use the signed-in company switcher. The synthetic persona switch is demo-only.',
        });
        return;
      }
      setState((current) => {
        const fresh = createSeedDataset(persona);
        return stateFromDataset(fresh, {
          mode: current.mode,
          locale: current.locale,
          numeralScript: current.numeralScript,
          grouping: current.grouping,
          motionTier: current.motionTier,
          theme: current.theme,
          bookFilter: current.bookFilter,
          users: current.users,
          currentUser: current.currentUser,
          isAuthenticated: current.isAuthenticated,
        });
      });
      publishToast({
        tone: 'info',
        title: `Switched to ${tenantByKey(persona).name_en}`,
        message: 'Demo dataset reloaded for the new tenant.',
      });
    },
    [publishToast, demoMode],
  );

  const resetDemoData = useCallback(() => {
    if (!demoMode) {
      publishToast({
        tone: 'warning',
        title: 'Demo data reset unavailable',
        message: 'The real shell never loads synthetic financial data.',
      });
      return;
    }
    setState((current) =>
      stateFromDataset(getSeedDataset(current.activePersona), {
        mode: current.mode,
        locale: current.locale,
        numeralScript: current.numeralScript,
        grouping: current.grouping,
        motionTier: current.motionTier,
        theme: current.theme,
        bookFilter: current.bookFilter,
        users: current.users,
        currentUser: current.currentUser,
        isAuthenticated: current.isAuthenticated,
      }),
    );
    publishToast({
      tone: 'success',
      title: 'Demo data restored',
      message: 'The seed ledger, chain and documents were rebuilt from the deterministic dataset.',
    });
  }, [publishToast, demoMode]);

  // ---- Posting -----------------------------------------------------------------------------
  const nextMushakSerial = useCallback((binUnitId: string, year: string) => {
    return allocateMushak63Serial(binUnitId, stateRef.current.commercialDocs, year);
  }, []);

  const postCommercialDoc = useCallback(
    (input: CreateDocInput, options: { settle?: boolean } = {}): ActionResult<TaxAnnotatedDoc> => {
      if (!hasPermission('CREATE_COMMERCIAL_DRAFT')) return deny('CREATE_COMMERCIAL_DRAFT');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const party = current.parties.find((entry) => entry.id === input.party_id);
      if (!party) return { ok: false, error: 'Select a valid counterparty before posting.' };
      const isCreditNote = input.doc_type === 'CREDIT_NOTE';
      if (isCreditNote) {
        if (!input.original_doc_id) {
          return {
            ok: false,
            error:
              'A credit note must reference the original posted sales invoice. Open the invoice and select it before posting the credit note.',
          };
        }
        const original = current.commercialDocs.find((doc) => doc.id === input.original_doc_id);
        if (!original || original.doc_type !== 'SALES_INVOICE') {
          return { ok: false, error: 'The original document for a credit note must be a posted sales invoice.' };
        }
        if (original.party_id !== input.party_id) {
          return { ok: false, error: 'A credit note must be issued to the same party as its original invoice.' };
        }
      }
      const isSale = input.doc_type === 'SALES_INVOICE' || isCreditNote;
      const base = input.lines.reduce((sum, line) => sum + lineTaxBasePoisha(line), 0n);
      if (base <= 0n) return { ok: false, error: 'A document needs at least one priced line.' };

      const docNumber = nextCommercialDocNumber(
        current.commercialDocs,
        input.doc_type,
        input.doc_date,
        input.bin_unit_id,
      );
      const docYear = input.doc_date.slice(0, 4);
      // Only a sales invoice consumes a Mushak 6.3 serial. A credit note has its own CN series and
      // a purchase must carry the supplier's actual evidence; the system never invents one.
      const mushakSerial =
        input.doc_type === 'SALES_INVOICE'
          ? allocateMushak63Serial(input.bin_unit_id, current.commercialDocs, docYear)
          : undefined;

      try {
        const built = buildCommercialDoc({
          doc_type: input.doc_type,
          doc_number: docNumber,
          doc_date: input.doc_date,
          due_date: addDays(input.doc_date, party.credit_days || 15),
          party,
          bin_unit_id: input.bin_unit_id,
          lines: input.lines.map((line, index) => ({ ...line, id: `${docNumber}-L${index + 1}` })),
          base_poisha: base,
          tax_category: input.tax_category,
          tds_nature: input.tds_nature,
          payment_method: input.payment_method,
          narration_en: input.narration_en,
          narration_bn: input.narration_bn,
          reverse_charge: input.reverse_charge,
          reverse_charge_challan_held: input.reverse_charge,
          vds_applicable: input.withhold_vds || isSale ? (input.withhold_vds ? true : party.is_withholding_buyer) : false,
          sd_applicable: input.sd_applicable,
          mushak_serial: mushakSerial,
          original_doc_id: input.original_doc_id,
          original_doc_number: input.original_doc_number,
          cost_account_code: expenseAccountFor(input.tds_nature, input.doc_type),
          book_type: input.book_type,
          created_by: actor,
          tenant_is_withholding_entity: current.tenant.is_withholding_entity,
          vehicle_no: input.vehicle_no,
          destination: input.destination,
          payment_channel: input.payment_channel,
        });

        // ---- Explicit stock movements and COGS ------------------------------------------------
        const isGoodsReceipt =
          !isSale && (input.doc_type === 'PURCHASE_BILL' || input.workflow_stage === 'GRN_RECEIVED');
        let nextItems = current.items;
        const newMovements: StockMovement[] = [];
        let stockNote = '';
        built.doc.workflow_stage =
          input.workflow_stage ?? (isSale ? 'INVOICED_POSTED' : isGoodsReceipt ? 'BILL_POSTED' : 'PURCHASE_ORDER');

        if (input.doc_type === 'SALES_INVOICE') {
          const cogsPoisha = calculatePerpetualCogs(input.lines, current.items);
          const issued = issueInventoryStock(current.items, input.lines, {
            movement_date: input.doc_date,
            source_doc_id: built.doc.id,
            source_doc_ref: docNumber,
          });
          if (cogsPoisha > 0n) {
            built.document_lines.push(...buildCogsJournalLines(cogsPoisha, current.accounts, docNumber));
            stockNote += ` · COGS ${money(cogsPoisha)}`;
          }
          nextItems = issued.items;
          newMovements.push(...issued.movements);
          if (issued.total_issued_qty > 0) stockNote += ` · ${issued.total_issued_qty} unit(s) issued`;
        } else if (isCreditNote) {
          const returned = returnInventoryStock(current.items, input.lines, {
            movement_date: input.doc_date,
            source_doc_id: built.doc.id,
            source_doc_ref: docNumber,
          });
          if (returned.cogs_reversed_poisha > 0n) {
            built.document_lines.push(
              ...buildReturnCogsJournalLines(returned.cogs_reversed_poisha, current.accounts, docNumber),
            );
            stockNote += ` · COGS reversed ${money(returned.cogs_reversed_poisha)}`;
          }
          nextItems = returned.items;
          newMovements.push(...returned.movements);
          if (returned.total_returned_qty > 0) {
            stockNote += ` · ${returned.total_returned_qty} unit(s) returned to stock`;
          }
        } else if (isGoodsReceipt) {
          const receiptLines: StockReceiptLine[] = input.lines.map((line) => ({
            sku: line.sku,
            quantity: line.quantity,
            unit_cost_poisha: line.unit_price_poisha,
          }));
          const disallowedVat =
            built.decision.input_credit.disallowed_poisha < 0n
              ? -built.decision.input_credit.disallowed_poisha
              : built.decision.input_credit.disallowed_poisha;
          const receipt = receiveInventoryStock(current.items, receiptLines, {
            basePoisha: base,
            disallowedVatPoisha: disallowedVat,
            movement_date: input.doc_date,
            source_doc_id: built.doc.id,
            source_doc_ref: docNumber,
          });
          nextItems = receipt.items;
          newMovements.push(...receipt.movements);
          built.doc.grn_qty = receipt.total_received_qty;
          built.doc.po_qty = input.po_qty ?? receipt.total_received_qty;
          if (receipt.total_received_qty > 0) {
            stockNote += ` · ${receipt.total_received_qty} unit(s) received at weighted average`;
          }
        }

        const journals = [...current.journals];
        const documentJournal = postJournal(
          {
            book_type: input.book_type,
            bin_unit_id: input.bin_unit_id,
            document_date: input.doc_date,
            posting_date: input.doc_date,
            source_module: isSale ? 'SALES' : 'PURCHASES',
            source_doc_id: built.doc.id,
            source_doc_ref: docNumber,
            narration_en: input.narration_en,
            narration_bn: input.narration_bn,
            tax_decision_trace_id: built.doc.tax_trace_id,
            rule_pack_version: 'bd-2026-v1',
            created_by: actor,
            approved_by: actor,
            lines: built.document_lines,
          },
          { journals, periods: current.periods, accounts: current.accounts, actor },
        );
        journals.push(documentJournal);
        built.doc.document_journal_id = documentJournal.id;
        const newJournals: JournalEntry[] = [documentJournal];

        // Settlement is never a default. The caller may ask for it explicitly, in which case the
        // same full-settlement command used by a later receipt/payment performs the posting.
        if (options.settle === true && input.doc_type !== 'CREDIT_NOTE') {
          const settlement = settleCommercialDoc(
            built.doc,
            {
              settlement_date: input.doc_date,
              bank_account_code: settlementAccountCode(input.payment_method, input.payment_channel),
              actor,
            },
            { journals, periods: current.periods, accounts: current.accounts, actor },
          );
          journals.push(settlement.journal);
          newJournals.push(settlement.journal);
          built.doc = settlement.doc;
        }

        const bankCodes = new Set(current.bankAccounts.map((bank) => bank.account_code));
        const newStatementLines = newJournals.flatMap((journal, index) =>
          statementLineFromJournal(journal, bankCodes, current.statementLines.length + index + 1),
        );

        setState((previous) => ({
          ...previous,
          journals,
          commercialDocs: [built.doc, ...previous.commercialDocs],
          statementLines: [...newStatementLines, ...previous.statementLines],
          items: nextItems,
          stockMovements: [...newMovements, ...previous.stockMovements],
        }));
        publishToast({
          tone: built.decision.decision === 'SUPPORTED' ? 'success' : 'warning',
          title: `${docNumber} posted`,
          message: `${money(built.doc.gross_poisha)} · VAT ${money(built.doc.vat_poisha)} · VDS ${money(
            built.doc.vds_poisha,
          )} · TDS ${money(built.doc.tds_poisha)}${stockNote}`,
        });
        return { ok: true, data: built.doc };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Posting rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, money, publishToast],
  );

  const settleCommercialDocument = useCallback(
    (
      docId: string,
      options: { bank_account_code?: string; settlement_date?: string } = {},
    ): ActionResult<SettlementResult<TaxAnnotatedDoc>> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const doc = current.commercialDocs.find((entry) => entry.id === docId);
      if (!doc) return { ok: false, error: 'Document not found.' };
      try {
        const journals = [...current.journals];
        const settlement = settleCommercialDoc(
          doc,
          {
            settlement_date: options.settlement_date ?? isoToday(),
            bank_account_code:
              options.bank_account_code ?? settlementAccountCode(doc.payment_method, doc.payment_channel),
            actor,
          },
          { journals, periods: current.periods, accounts: current.accounts, actor },
        );
        journals.push(settlement.journal);
        const bankCodes = new Set(current.bankAccounts.map((bank) => bank.account_code));
        const newStatementLines = statementLineFromJournal(
          settlement.journal,
          bankCodes,
          current.statementLines.length + 1,
        );
        setState((previous) => ({
          ...previous,
          journals,
          commercialDocs: previous.commercialDocs.map((entry) =>
            entry.id === doc.id ? settlement.doc : entry,
          ),
          statementLines: [...newStatementLines, ...previous.statementLines],
        }));
        publishToast({
          tone: 'success',
          title: `${doc.doc_number} settled`,
          message: `${money(doc.gross_poisha - doc.settled_poisha)} · ${settlement.journal.journal_number}`,
        });
        return { ok: true, data: settlement };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Settlement rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, money, publishToast],
  );

  const postManualJournal = useCallback(
    (draft: {
      date: string;
      book_type?: BookType;
      narration_en: string;
      narration_bn: string;
      lines: JournalLineDraft[];
      source_module?: JournalDraft['source_module'];
    }): ActionResult<JournalEntry> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      try {
        const journal = postJournal(
          {
            book_type: draft.book_type ?? 'STATUTORY_BD',
            bin_unit_id: current.tenant.bin_units[0]?.id ?? 'BU-DHK',
            document_date: draft.date,
            posting_date: draft.date,
            source_module: draft.source_module ?? 'MANUAL_JOURNAL',
            narration_en: draft.narration_en,
            narration_bn: draft.narration_bn,
            created_by: actor,
            approved_by: actor,
            lines: draft.lines,
          },
          { journals: current.journals, periods: current.periods, accounts: current.accounts, actor },
        );
        setState((previous) => ({ ...previous, journals: [...previous.journals, journal] }));
        publishToast({
          tone: 'success',
          title: `${journal.journal_number} posted`,
          message: `${money(journalTotals(journal.lines).debit_poisha)} balanced · hash ${journal.audit_hash.slice(0, 12)}…`,
        });
        return { ok: true, data: journal };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Journal rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, money, publishToast],
  );

  const reverseJournal = useCallback(
    (journalId: string, reason: string): ActionResult<JournalEntry> => {
      if (!hasPermission('REVERSE_POSTED_JOURNAL')) return deny('REVERSE_POSTED_JOURNAL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const index = current.journals.findIndex((journal) => journal.id === journalId);
      if (index < 0) return { ok: false, error: 'Journal not found.' };
      const original = current.journals[index];
      if (original.reversal_of_journal_id) {
        return { ok: false, error: 'A reversal journal cannot itself be reversed. Post a correcting entry instead.' };
      }
      try {
        const reversed = createReversalJournal(original, reason || 'Correction requested', reversalDateFor(current.periods, original.posting_date), actor, {
          journals: current.journals,
          periods: current.periods,
          accounts: current.accounts,
          actor,
        });
        const journals = [...current.journals];
        journals[index] = reversed.original;
        journals.push(reversed.reversal);
        setState((previous) => ({ ...previous, journals }));
        publishToast({
          tone: 'success',
          title: `Reversal ${reversed.reversal.journal_number} posted`,
          message: LINKED_REVERSAL_NOTE,
        });
        return { ok: true, data: reversed.reversal };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Reversal rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, publishToast],
  );

  // ---- Treasury challans --------------------------------------------------------------------
  const depositTreasuryChallan = useCallback(
    (challanId: string): ActionResult<JournalEntry> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const challan = current.challans.find((entry) => entry.id === challanId);
      if (!challan) return { ok: false, error: 'Challan not found.' };
      if (challan.status === 'DEPOSITED' || challan.status === 'CERTIFIED') {
        return { ok: false, error: 'This challan has already been deposited.' };
      }
      const accountCode = challan.type === 'VDS' ? '2130' : challan.type === 'TDS' ? '2140' : challan.type === 'AIT' ? '2150' : '2120';
      try {
        const journal = postJournal(
          {
            book_type: 'STATUTORY_BD',
            bin_unit_id: current.tenant.bin_units[0]?.id ?? 'BU-DHK',
            document_date: isoToday(),
            posting_date: isoToday(),
            source_module: 'BANK_MFS',
            source_doc_ref: challan.challan_number,
            narration_en: `${challan.type} challan ${challan.challan_number} deposited to the Treasury (${challan.economic_code}).`,
            narration_bn: `${challan.type} চালান ${challan.challan_number} কোষাগারে জমা (${challan.economic_code})।`,
            created_by: actor,
            lines: [
              {
                account_code: accountCode,
                debit_poisha: challan.amount_poisha,
                memo: `${challan.type} liability cleared`,
                account_name_en: accountNameOf(current.accounts, accountCode).en,
                account_name_bn: accountNameOf(current.accounts, accountCode).bn,
              },
              {
                account_code: '1110',
                credit_poisha: challan.amount_poisha,
                memo: 'Treasury deposit',
                account_name_en: accountNameOf(current.accounts, '1110').en,
                account_name_bn: accountNameOf(current.accounts, '1110').bn,
              },
            ],
          },
          { journals: current.journals, periods: current.periods, accounts: current.accounts, actor },
        );
        setState((previous) => ({
          ...previous,
          journals: [...previous.journals, journal],
          challans: previous.challans.map((entry) =>
            entry.id === challan.id
              ? { ...entry, status: 'DEPOSITED', deposit_date: isoToday(), journal_id: journal.id }
              : entry,
          ),
        }));
        publishToast({
          tone: 'success',
          title: 'Challan deposited',
          message: `${challan.challan_number} · ${money(challan.amount_poisha)}`,
        });
        return { ok: true, data: journal };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Deposit rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, money, publishToast],
  );

  /**
   * Deposit a whole batch of VDS/TDS deductions with one treasury challan. A single settlement
   * journal clears every selected liability (Dr 2130 / Dr 2140 / Cr bank) so the batch is atomic
   * and the SHA-256 chain advances exactly once.
   */
  const depositChallanBatch = useCallback(
    (input: {
      challan_ids: string[];
      bank_account_code: string;
      bank_branch: string;
      deposit_date: string;
      batch_reference: string;
    }): ActionResult<JournalEntry> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const selected = current.challans.filter(
        (challan) =>
          input.challan_ids.includes(challan.id) &&
          challan.status !== 'DEPOSITED' &&
          challan.status !== 'CERTIFIED',
      );
      if (selected.length === 0) {
        return { ok: false, error: 'Select at least one pending challan to deposit.' };
      }
      const bank =
        current.bankAccounts.find((entry) => entry.account_code === input.bank_account_code) ??
        current.bankAccounts[0];
      if (!bank) return { ok: false, error: 'No bank or MFS account is available for settlement.' };

      const sumType = (type: Challan['type']): bigint =>
        selected
          .filter((challan) => challan.type === type)
          .reduce((total, challan) => total + challan.amount_poisha, 0n);
      const vdsTotal = sumType('VDS');
      const tdsTotal = sumType('TDS');
      const vatTotal = sumType('VAT');
      const total = vdsTotal + tdsTotal + vatTotal;
      if (total <= 0n) return { ok: false, error: 'The selected challans carry no payable amount.' };

      const batchNumber = input.batch_reference.trim() || `TCH-${input.deposit_date.replace(/-/g, '')}-01`;
      const lines: JournalLineDraft[] = [];
      const pushLiability = (code: string, amount: bigint, memo: string): void => {
        if (amount <= 0n) return;
        lines.push({
          account_code: code,
          account_name_en: accountNameOf(current.accounts, code).en,
          account_name_bn: accountNameOf(current.accounts, code).bn,
          debit_poisha: amount,
          memo,
        });
      };
      pushLiability('2130', vdsTotal, 'VDS liability cleared through batch challan');
      pushLiability('2140', tdsTotal, 'TDS liability cleared through batch challan');
      pushLiability('2120', vatTotal, 'VAT liability cleared through batch challan');
      lines.push({
        account_code: bank.account_code,
        account_name_en: accountNameOf(current.accounts, bank.account_code).en,
        account_name_bn: accountNameOf(current.accounts, bank.account_code).bn,
        credit_poisha: total,
        memo: `Treasury deposit · ${input.bank_branch || bank.branch}`,
      });

      try {
        const journal = postJournal(
          {
            book_type: 'STATUTORY_BD',
            bin_unit_id: current.tenant.bin_units[0]?.id ?? 'BU-DHK',
            document_date: input.deposit_date,
            posting_date: input.deposit_date,
            source_module: 'BANK_MFS',
            source_doc_ref: batchNumber,
            narration_en: `Batch treasury challan ${batchNumber} — ${selected.length} deduction(s) deposited at ${input.bank_branch || bank.branch}.`,
            narration_bn: `ব্যাচ ট্রেজারি চালান ${batchNumber} — ${selected.length}টি কর্তন ${input.bank_branch || bank.branch}-এ জমা।`,
            created_by: actor,
            approved_by: actor,
            lines,
          },
          { journals: current.journals, periods: current.periods, accounts: current.accounts, actor },
        );
        const ids = new Set(selected.map((challan) => challan.id));
        setState((previous) => ({
          ...previous,
          journals: [...previous.journals, journal],
          challans: previous.challans.map((challan) => {
            if (!ids.has(challan.id)) return challan;
            const sequence = selected.findIndex((entry) => entry.id === challan.id) + 1;
            return {
              ...challan,
              status: 'DEPOSITED',
              deposit_date: input.deposit_date,
              journal_id: journal.id,
              challan_number: `${batchNumber}/${String(sequence).padStart(2, '0')}`,
              bank_account_code: bank.account_code,
              bank_branch: input.bank_branch || bank.branch,
              batch_reference: batchNumber,
              certificate_numbers:
                challan.type === 'VDS' && challan.certificate_numbers.length === 0
                  ? [`6.6/${input.deposit_date.slice(0, 4)}/${batchNumber.split('/').pop() ?? '01'}`]
                  : challan.certificate_numbers,
            };
          }),
        }));
        publishToast({
          tone: 'success',
          title: `Batch challan ${batchNumber} deposited`,
          message: `${selected.length} liabilities · ${money(total)} · ${input.bank_branch || bank.branch}`,
        });
        return { ok: true, data: journal };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Batch deposit rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, money, publishToast],
  );

  /** Mark a customer-issued Mushak 6.6 as received — this feeds the 9.1 Part 6 decreasing adjustment. */
  const receiveVdsCertificate = useCallback(
    (certificateId: string): ActionResult<VdsCertificate> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const certificate = current.vdsCertificates.find((entry) => entry.id === certificateId);
      if (!certificate) return { ok: false, error: 'Certificate not found.' };
      if (certificate.direction !== 'RECEIVED') {
        return { ok: false, error: 'Only customer-issued (received) certificates can be marked as received.' };
      }
      if (certificate.status === 'RECEIVED' || certificate.status === 'VERIFIED') {
        return { ok: true, data: certificate };
      }
      const updated: VdsCertificate = { ...certificate, status: 'RECEIVED' };
      setState((previous) => ({
        ...previous,
        vdsCertificates: previous.vdsCertificates.map((entry) =>
          entry.id === certificateId ? updated : entry,
        ),
      }));
      publishToast({
        tone: 'success',
        title: 'Mushak 6.6 received',
        message: `${certificate.certificate_number} · ${money(certificate.vds_poisha)} added to Mushak 9.1 Part 6 decreasing adjustment.`,
      });
      return { ok: true, data: updated };
    },
    [hasPermission, money, publishToast],
  );

  // ---- Banking -----------------------------------------------------------------------------
  const reconcileBankLine = useCallback(
    (lineId: string): ActionResult<BankStatementLine> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const line = current.statementLines.find((entry) => entry.id === lineId);
      if (!line) return { ok: false, error: 'Statement line not found.' };
      const amount = line.debit_poisha > 0n ? line.debit_poisha : line.credit_poisha;
      const candidate = current.journals.find((journal) =>
        journal.lines.some(
          (entry) =>
            entry.account_code === line.account_code &&
            (entry.debit_poisha === amount || entry.credit_poisha === amount),
        ),
      );
      const updated: BankStatementLine = {
        ...line,
        status: candidate ? 'MATCHED' : 'CATEGORIZED',
        matched_doc_ref: candidate?.source_doc_ref ?? line.matched_doc_ref,
        journal_id: candidate?.id ?? line.journal_id,
      };
      setState((previous) => ({
        ...previous,
        statementLines: previous.statementLines.map((entry) => (entry.id === lineId ? updated : entry)),
      }));
      publishToast({
        tone: candidate ? 'success' : 'warning',
        title: candidate ? 'Statement line matched' : 'Line categorised for review',
        message: candidate
          ? `Matched to ${candidate.journal_number}`
          : 'No single ledger entry matches this amount yet — it stays in the review queue.',
      });
      return { ok: true, data: updated };
    },
    [hasPermission, publishToast],
  );

  // ---- Import studio -----------------------------------------------------------------------
  const simulateRows = useCallback(
    (rows: ImportSheetRow[], pipeline: ImportSimulation['pipeline']) => {
      // Imported commercial rows are validated against the live state so duplicates and locked
      // periods are caught before anything touches the ledger.
      return applyBatchBalanceRules(parseAndSimulateImport(rows, importState, { pipeline }));
    },
    [importState],
  );

  const commitImportBatch = useCallback(
    (simulation: ImportSimulation): ActionResult<ImportBatch> => {
      if (!hasPermission('POST_TO_GL')) return deny('POST_TO_GL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const batchId = `${IMPORT_BATCH_PREFIX}-${Date.now().toString(36).toUpperCase()}`;
      try {
        const result = buildJournalsFromSimulation(simulation, {
          state: importState,
          batchId,
          committedBy: actor,
        });
        const journals = [...current.journals];
        const created: JournalEntry[] = [];
        for (const draft of result.drafts) {
          const posted = postJournal(draft, {
            journals,
            periods: current.periods,
            accounts: current.accounts,
            actor,
          });
          journals.push(posted);
          created.push(posted);
        }
        const batch: ImportBatch = {
          id: batchId,
          file_name: simulation.file_name,
          pipeline: simulation.pipeline,
          committed_at: isoNow(),
          committed_by: actor,
          row_count: simulation.valid_rows,
          journal_ids: created.map((journal) => journal.id),
          total_debit_poisha: result.totalDebit,
          total_credit_poisha: result.totalCredit,
          output_vat_poisha: simulation.output_vat_poisha,
          input_vat_claimable_poisha: simulation.input_vat_claimable_poisha,
          vds_poisha: simulation.vds_poisha,
          tds_poisha: simulation.tds_poisha,
          status: 'COMMITTED',
        };
        const bankCodes = new Set(current.bankAccounts.map((bank) => bank.account_code));
        const newStatementLines = created.flatMap((journal, index) =>
          statementLineFromJournal(journal, bankCodes, current.statementLines.length + index + 1),
        );
        setState((previous) => ({
          ...previous,
          journals,
          commercialDocs: [...result.docs, ...previous.commercialDocs],
          importBatches: [batch, ...previous.importBatches],
          statementLines: [...newStatementLines, ...previous.statementLines],
          bankAccounts: previous.bankAccounts.map((bank) => {
            const delta = result.bank_opening_delta_poisha[bank.account_code];
            return delta ? { ...bank, opening_poisha: bank.opening_poisha + delta } : bank;
          }),
        }));
        publishToast({
          tone: 'success',
          title: `Batch ${batchId} committed`,
          message: `${created.length} journals · ${simulation.valid_rows} rows · ${money(result.totalDebit)} posted`,
        });
        return { ok: true, data: batch };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Commit rejected', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, importState, money, publishToast],
  );

  const rollbackImportBatch = useCallback(
    (batchId: string): ActionResult<ImportBatch> => {
      if (!hasPermission('REVERSE_POSTED_JOURNAL')) return deny('REVERSE_POSTED_JOURNAL');
      const current = stateRef.current;
      const actor = current.currentUser.full_name;
      const batch = current.importBatches.find((entry) => entry.id === batchId);
      if (!batch) return { ok: false, error: 'Batch not found.' };
      if (batch.status === 'ROLLED_BACK') return { ok: false, error: 'This batch has already been rolled back.' };
      try {
        const journals = [...current.journals];
        const rollbackIds: string[] = [];
        for (const journalId of batch.journal_ids) {
          const index = journals.findIndex((journal) => journal.id === journalId);
          if (index < 0) continue;
          const original = journals[index];
          if (original.reversal_of_journal_id) continue;
          const reversed = createReversalJournal(
            original,
            `Rollback of import batch ${batch.id}`,
            reversalDateFor(current.periods, original.posting_date),
            actor,
            { journals, periods: current.periods, accounts: current.accounts, actor },
          );
          journals[index] = reversed.original;
          journals.push(reversed.reversal);
          rollbackIds.push(reversed.reversal.id);
        }
        const updated: ImportBatch = {
          ...batch,
          status: 'ROLLED_BACK',
          rolled_back_at: isoNow(),
          rollback_journal_ids: rollbackIds,
        };
        // A rollback must put the operational registers back too, without deleting document
        // history: imported documents are marked REVERSED, keep their numbers and remain visible
        // as audit evidence. Their journals are reversed, never removed.
        const batchDocNumbers = new Set(
          current.journals
            .filter((journal) => batch.journal_ids.includes(journal.id))
            .map((journal) => journal.source_doc_ref)
            .filter((reference): reference is string => Boolean(reference)),
        );
        const batchJournalIds = new Set(batch.journal_ids);
        setState((previous) => ({
          ...previous,
          journals,
          commercialDocs: previous.commercialDocs.map((doc) =>
            batchDocNumbers.has(doc.doc_number) ? { ...doc, status: 'REVERSED' } : doc,
          ),
          statementLines: previous.statementLines.filter(
            (line) => !line.journal_id || !batchJournalIds.has(line.journal_id),
          ),
          importBatches: previous.importBatches.map((entry) => (entry.id === batchId ? updated : entry)),
        }));
        publishToast({
          tone: 'success',
          title: `Batch ${batchId} rolled back`,
          message: `${rollbackIds.length} linked reversal journals posted · ${batchDocNumbers.size} imported documents marked REVERSED. The original journals stay in the chain.`,
        });
        return { ok: true, data: updated };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Rollback failed', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, publishToast],
  );

  // ---- Master data -------------------------------------------------------------------------
  const addAccount = useCallback(
    (input: AccountDraft): ActionResult<Account> => {
      if (!hasPermission('MANAGE_MASTERS_AND_COA')) return deny('MANAGE_MASTERS_AND_COA');
      const current = stateRef.current;
      const account = materializeAccount(input);
      if (!account.code) return { ok: false, error: 'A four-digit GL account code is required.' };
      if (!account.name_en) return { ok: false, error: 'An account name is required.' };
      if (current.accounts.some((entry) => entry.code === account.code)) {
        return { ok: false, error: `Account ${account.code} already exists in the chart of accounts.` };
      }
      if (account.opening_debit_poisha !== 0n || account.opening_credit_poisha !== 0n) {
        return {
          ok: false,
          error:
            'Opening balances must be posted through a balanced opening-balance batch, not entered on a new account master.',
        };
      }
      setState((previous) => ({ ...previous, accounts: [...previous.accounts, account] }));
      publishToast({
        tone: 'success',
        title: `Account ${account.code} added`,
        message: `${account.name_en} · ${account.account_type.replaceAll('_', ' ')} · opening ${account.opening_debit_poisha > 0n ? 'Dr' : account.opening_credit_poisha > 0n ? 'Cr' : 'nil'}.`,
      });
      return { ok: true, data: account };
    },
    [hasPermission, publishToast],
  );

  const upsertAccount = useCallback(
    (input: AccountDraft): ActionResult<Account> => {
      if (!hasPermission('MANAGE_MASTERS_AND_COA')) return deny('MANAGE_MASTERS_AND_COA');
      const current = stateRef.current;
      const code = input.code.trim();
      if (!code) return { ok: false, error: 'A four-digit GL account code is required.' };
      if (!input.name_en.trim()) return { ok: false, error: 'An account name is required.' };
      const existing = current.accounts.find((entry) => entry.code === code);
      const account = materializeAccount({
        ...(existing ?? {}),
        ...input,
        code,
        name_en: input.name_en.trim(),
      });
      const openingChanged =
        !existing ||
        existing.opening_debit_poisha !== account.opening_debit_poisha ||
        existing.opening_credit_poisha !== account.opening_credit_poisha;
      if (
        openingChanged &&
        (account.opening_debit_poisha !== 0n || account.opening_credit_poisha !== 0n)
      ) {
        return {
          ok: false,
          error:
            'Opening balances must be posted through a balanced opening-balance batch. The account master cannot create or change a posted opening balance.',
        };
      }
      setState((previous) => ({
        ...previous,
        accounts: existing
          ? previous.accounts.map((entry) => (entry.code === code ? account : entry))
          : [...previous.accounts, account],
      }));
      publishToast({
        tone: 'success',
        title: existing ? `Account ${account.code} updated` : `Account ${account.code} added`,
        message: `${account.name_en} · ${account.account_type.replaceAll('_', ' ')} · opening ${account.opening_debit_poisha > 0n ? 'Dr' : account.opening_credit_poisha > 0n ? 'Cr' : 'nil'}.`,
      });
      return { ok: true, data: account };
    },
    [hasPermission, publishToast],
  );

  const upsertParty = useCallback(
    (input: PartyDraft): ActionResult<Party> => {
      if (!hasPermission('MANAGE_MASTERS_AND_COA')) return deny('MANAGE_MASTERS_AND_COA');
      const current = stateRef.current;
      const nameEn = input.name_en.trim();
      if (!nameEn) return { ok: false, error: 'A party name is required.' };
      const index = current.parties.findIndex((party) =>
        input.id ? party.id === input.id : Boolean(input.code) && party.code === input.code,
      );
      const existing = index >= 0 ? current.parties[index] : undefined;
      const id = existing?.id ?? input.id ?? `PARTY-${Date.now().toString(36).toUpperCase()}`;
      const next: Party = {
        id,
        code: input.code ?? existing?.code ?? `P-${String(current.parties.length + 1).padStart(4, '0')}`,
        name_en: nameEn,
        name_bn: input.name_bn ?? existing?.name_bn ?? nameEn,
        type: input.type ?? existing?.type ?? 'CUSTOMER',
        bin: input.bin ?? existing?.bin,
        tin: input.tin ?? existing?.tin,
        address_en: input.address_en ?? existing?.address_en ?? '',
        address_bn: input.address_bn ?? existing?.address_bn ?? '',
        mobile: input.mobile ?? existing?.mobile ?? '',
        email: input.email ?? existing?.email ?? '',
        is_withholding_buyer: input.is_withholding_buyer ?? existing?.is_withholding_buyer ?? false,
        is_government: input.is_government ?? existing?.is_government ?? false,
        credit_days: input.credit_days ?? existing?.credit_days ?? 15,
        opening_balance_poisha: input.opening_balance_poisha ?? existing?.opening_balance_poisha ?? 0n,
        is_active: input.is_active ?? existing?.is_active ?? true,
      };
      setState((previous) => ({
        ...previous,
        parties: previous.parties.some((party) => party.id === id)
          ? previous.parties.map((party) => (party.id === id ? next : party))
          : [...previous.parties, next],
      }));
      publishToast({
        tone: 'success',
        title: existing ? `${next.name_en} updated` : `${next.name_en} added`,
        message: `${next.code} · ${next.type}${next.bin ? ` · BIN ${next.bin}` : ''}.`,
      });
      return { ok: true, data: next };
    },
    [hasPermission, publishToast],
  );

  const upsertItem = useCallback(
    (input: ItemDraft): ActionResult<SeedItem> => {
      if (!hasPermission('MANAGE_MASTERS_AND_COA')) return deny('MANAGE_MASTERS_AND_COA');
      const current = stateRef.current;
      const index = input.id ? current.items.findIndex((item) => item.id === input.id) : -1;
      const existing = index >= 0 ? current.items[index] : undefined;
      const id = existing?.id ?? input.id ?? `ITEM-${Date.now().toString(36).toUpperCase()}`;
      const next = { ...(existing ?? {}), ...input, id } as unknown as SeedItem;
      const name = (next as unknown as { name_en?: unknown }).name_en;
      if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'An item name is required.' };
      setState((previous) => ({
        ...previous,
        items: previous.items.some((item) => item.id === id)
          ? previous.items.map((item) => (item.id === id ? next : item))
          : [...previous.items, next],
      }));
      publishToast({
        tone: 'success',
        title: existing ? `${name} updated` : `${name} added`,
        message: 'Item master persisted with the complete vault snapshot.',
      });
      return { ok: true, data: next };
    },
    [hasPermission, publishToast],
  );

  // ---- Company onboarding ------------------------------------------------------------------
  const createCustomTenant = useCallback(
    (input: CustomTenantInput): ActionResult<TenantEntity> => {
      if (!demoMode) {
        return {
          ok: false,
          error: 'Company onboarding is server-backed from Phase 4; the local demo wizard is disabled.',
        };
      }
      if (!hasPermission('MANAGE_USERS_AND_ORG')) return deny('MANAGE_USERS_AND_ORG');
      const current = stateRef.current;
      const nameEn = input.name_en.trim();
      if (!nameEn) return { ok: false, error: 'The company legal name is required.' };
      if (input.vat_status === 'VAT_REGISTERED_15' && !input.bin_number.trim()) {
        return { ok: false, error: 'A 13-digit BIN is required for a VAT-registered company.' };
      }
      const cash = input.opening_cash_poisha;
      const bank = input.opening_bank_poisha;
      const capital = input.opening_capital_poisha;
      if (cash < 0n || bank < 0n || capital < 0n) {
        return { ok: false, error: 'Opening balances cannot be negative.' };
      }
      if (capital !== cash + bank) {
        return {
          ok: false,
          error: `Opening capital must equal cash + bank (${formatPoisha(cash + bank, {
            locale: current.locale,
            numeral: current.numeralScript,
            grouping: current.grouping,
          })}).`,
        };
      }

      const startYear = fiscalStartYear(input.fiscal_year_label);
      const fiscalYearLabel = input.fiscal_year_label.trim() || `FY ${startYear}-${startYear + 1}`;
      const periods = buildFiscalPeriods(fiscalYearLabel);
      const template = getSeedDataset('APEX');
      const templateBank = template.bankAccounts.find((entry) => entry.kind === 'BANK');
      const templateCash = template.bankAccounts.find((entry) => entry.kind === 'CASH');
      const bankCode = templateBank?.account_code ?? '1110';
      const cashCode = templateCash?.account_code ?? '1125';
      const templateCapital =
        template.accounts.find((entry) => entry.account_type === 'EQUITY' && entry.sub_category === 'EQUITY_CAPITAL') ??
        template.accounts.find((entry) => entry.account_type === 'EQUITY');
      const capitalCode = templateCapital?.code ?? '3000';

      let accounts: Account[] = template.accounts.map((account) => ({
        ...account,
        opening_debit_poisha: 0n,
        opening_credit_poisha: 0n,
      }));
      const ensureAccount = (
        code: string,
        name: string,
        type: Account['account_type'],
        subCategory: Account['sub_category'],
      ): void => {
        if (accounts.some((account) => account.code === code)) return;
        accounts = [
          ...accounts,
          materializeAccount({ code, name_en: name, account_type: type, sub_category: subCategory }),
        ];
      };
      ensureAccount(cashCode, 'Cash in Hand', 'ASSET', 'CURRENT_ASSET');
      ensureAccount(bankCode, 'Bank Current Account', 'ASSET', 'CURRENT_ASSET');
      ensureAccount(capitalCode, 'Owner Capital / Share Capital', 'EQUITY', 'EQUITY_CAPITAL');
      accounts = accounts.map((account) => {
        if (account.code === cashCode) return { ...account, opening_debit_poisha: cash };
        if (account.code === bankCode) return { ...account, opening_debit_poisha: bank };
        if (account.code === capitalCode) return { ...account, opening_credit_poisha: capital };
        return account;
      });

      const tenantSlug = slugify(nameEn, 'company');
      const tenant: TenantEntity = {
        id: `TENANT-${tenantSlug.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
        persona_key: 'APEX',
        name_en: nameEn,
        name_bn: input.name_bn.trim() || nameEn,
        trade_name: input.trade_name.trim() || nameEn,
        entity_type: input.entity_type,
        industry_pack: input.industry_pack,
        tin_number: input.tin_number.trim(),
        rjsc_reg_no: input.rjsc_reg_no.trim(),
        vat_status: input.vat_status,
        is_withholding_entity: input.is_withholding_entity,
        reporting_framework: input.reporting_framework,
        fiscal_year_label: fiscalYearLabel,
        functional_currency: 'BDT',
        address_en: input.address_en.trim(),
        address_bn: input.address_bn.trim() || input.address_en.trim(),
        telephone: input.telephone.trim(),
        email: input.email.trim(),
        bin_units: [
          {
            id: `BU-${tenantSlug.toUpperCase().slice(0, 10)}-01`,
            bin_number: input.bin_number.trim(),
            unit_name_en: 'Head Office',
            unit_name_bn: 'প্রধান কার্যালয়',
            address: input.address_en.trim(),
            is_principal: true,
          },
        ],
        accounting_policies: {
          inventory_formula: 'WEIGHTED_AVERAGE',
          depreciation_method: 'STRAIGHT_LINE',
          ifrs18_early_adoption: input.reporting_framework !== 'SIMPLIFIED_MANAGEMENT',
          ecl_provision_matrix_enabled: true,
          cash_disallowance_limit_poisha: 10_000_000n,
        },
      };

      const bankName = input.bank_name.trim() || templateBank?.provider || 'Principal Bank Account';
      const bankAccounts: BankAccount[] = [
        {
          id: 'BANK-ONBOARD-01',
          name_en: bankName,
          name_bn: templateBank?.name_bn ?? bankName,
          account_code: bankCode,
          kind: 'BANK',
          provider: bankName,
          masked_number: input.bank_account_masked.trim() || templateBank?.masked_number || '•••• 0000',
          branch: templateBank?.branch ?? 'Head Office',
          opening_poisha: bank,
          accent: templateBank?.accent ?? 'vault',
        },
      ];
      if (cashCode !== bankCode) {
        bankAccounts.push({
          id: 'CASH-ONBOARD-01',
          name_en: templateCash?.name_en ?? 'Cash in Hand',
          name_bn: templateCash?.name_bn ?? 'হাতে নগদ',
          account_code: cashCode,
          kind: 'CASH',
          provider: 'Cash',
          masked_number: '—',
          branch: templateCash?.branch ?? 'Head Office',
          opening_poisha: cash,
          accent: templateCash?.accent ?? 'gold',
        });
      }

      const openingLines: JournalLineDraft[] = [];
      const pushOpening = (code: string, debit: bigint, credit: bigint, memo: string): void => {
        const account = accounts.find((entry) => entry.code === code);
        openingLines.push({
          account_code: code,
          account_name_en: account?.name_en ?? code,
          account_name_bn: account?.name_bn ?? code,
          debit_poisha: debit,
          credit_poisha: credit,
          memo,
        });
      };
      if (cash > 0n) pushOpening(cashCode, cash, 0n, 'Opening cash balance');
      if (bank > 0n) pushOpening(bankCode, bank, 0n, 'Opening bank balance');
      if (capital > 0n) pushOpening(capitalCode, 0n, capital, 'Opening capital');

      let openingJournal: JournalEntry | null = null;
      if (openingLines.length > 0) {
        try {
          openingJournal = postJournal(
            {
              book_type: 'STATUTORY_BD',
              bin_unit_id: tenant.bin_units[0].id,
              document_date: periods[0].start_date,
              posting_date: periods[0].start_date,
              source_module: 'OPENING_BALANCE',
              narration_en: `Opening balances on onboarding — ${tenant.name_en}`,
              narration_bn: `অনবোর্ডিং প্রারম্ভিক স্থিতি — ${tenant.name_bn}`,
              created_by: current.currentUser.full_name,
              approved_by: current.currentUser.full_name,
              lines: openingLines,
            },
            { journals: [], periods, accounts, actor: current.currentUser.full_name },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, error: `Opening balances rejected: ${message}` };
        }
      }

      setState((previous) => ({
        ...previous,
        activePersona: 'APEX',
        tenant,
        accounts,
        journals: openingJournal ? [openingJournal] : [],
        commercialDocs: [],
        challans: [],
        bankAccounts,
        statementLines: [],
        importBatches: [],
        vdsCertificates: [],
        payrollRows: [],
        parties: [],
        items: [],
        stockMovements: [],
        periods,
        statutoryRecords: [],
      }));
      publishToast({
        tone: 'success',
        title: `${tenant.name_en} onboarded`,
        message: `${periods.length} open periods · ${openingLines.length} opening lines · ${formatPoisha(capital, {
          locale: current.locale,
          numeral: current.numeralScript,
          grouping: current.grouping,
        })} capital.`,
      });
      return { ok: true, data: tenant };
    },
    [hasPermission, publishToast, demoMode],
  );

  // ---- Vault file export / import ----------------------------------------------------------
  const exportVaultFile = useCallback((): string | null => {
    if (!demoMode) {
      publishToast({
        tone: 'warning',
        title: 'Export unavailable',
        message: 'Server-side exports will be added with the ledger and audit-pack phases. No browser ledger is exported.',
      });
      return null;
    }
    const current = stateRef.current;
    const fileName = downloadVaultFile(current, { companyName: current.tenant.name_en });
    if (!fileName) {
      publishToast({
        tone: 'error',
        title: 'Export blocked',
        message: 'This browser refused the download. Try again from a normal browser tab.',
      });
      return null;
    }
    publishToast({
      tone: 'success',
      title: 'Vault exported',
      message: `${fileName} · ${current.accounts.length} accounts · ${current.parties.length} parties · ${current.items.length} items · ${current.journals.length} journals.`,
    });
    return fileName;
  }, [publishToast, demoMode]);

  const importVaultFile = useCallback(
    async (file: File): Promise<ActionResult<VaultState>> => {
      if (!demoMode) {
        return {
          ok: false,
          error: 'A browser vault cannot be restored into the server-backed shell. Use the server import workflow when it is available.',
        };
      }
      if (!hasPermission('MANAGE_USERS_AND_ORG')) return deny('MANAGE_USERS_AND_ORG');
      try {
        const parsed = await readVaultFileFromDisk<Partial<VaultState>>(file);
        if (!parsed) {
          return { ok: false, error: 'That file is not a valid Fintuity Accounting Suite .vault.json snapshot.' };
        }
        const normalized = normalizeRestoredState(parsed.state);
        if (!normalized) {
          return { ok: false, error: 'The snapshot is missing its chart of accounts or journal chain.' };
        }
        setState(normalized);
        publishToast({
          tone: 'success',
          title: 'Vault restored',
          message: `${parsed.file_name ?? 'Snapshot'} · ${normalized.accounts.length} accounts · ${normalized.parties.length} parties · ${normalized.items.length} items · ${normalized.journals.length} journals.`,
        });
        return { ok: true, data: normalized };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishToast({ tone: 'error', title: 'Import failed', message });
        return { ok: false, error: message };
      }
    },
    [hasPermission, publishToast, demoMode],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      ...state,
      t,
      money,
      statements,
      statementPeriodCode,
      setStatementPeriodCode,
      reconciliation,
      auditChain,
      toasts,
      publishToast,
      dismissToast,
      hasPermission,
      addAccount,
      upsertAccount,
      upsertParty,
      upsertItem,
      createCustomTenant,
      exportVaultFile,
      importVaultFile,
      setLocale,
      setNumeralScript,
      setGrouping,
      setMode,
      setMotionTier,
      setTheme,
      setBookFilter,
      setReportingFramework,
      setPeriodStatus,
      setPersona,
      resetDemoData,
      postCommercialDoc,
      settleCommercialDocument,
      postManualJournal,
      reverseJournal,
      commitImportBatch,
      rollbackImportBatch,
      depositTreasuryChallan,
      depositChallanBatch,
      receiveVdsCertificate,
      reconcileBankLine,
      nextMushakSerial,
      importState,
      simulateRows,
    }),
    [
      state,
      t,
      money,
      statements,
      statementPeriodCode,
      setStatementPeriodCode,
      reconciliation,
      auditChain,
      toasts,
      publishToast,
      dismissToast,
      hasPermission,
      addAccount,
      upsertAccount,
      upsertParty,
      upsertItem,
      createCustomTenant,
      exportVaultFile,
      importVaultFile,
      setLocale,
      setNumeralScript,
      setGrouping,
      setMode,
      setMotionTier,
      setTheme,
      setBookFilter,
      setReportingFramework,
      setPeriodStatus,
      setPersona,
      resetDemoData,
      postCommercialDoc,
      settleCommercialDocument,
      postManualJournal,
      reverseJournal,
      commitImportBatch,
      rollbackImportBatch,
      depositTreasuryChallan,
      depositChallanBatch,
      receiveVdsCertificate,
      reconcileBankLine,
      nextMushakSerial,
      importState,
      simulateRows,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault() must be used inside <VaultProvider>. Wrap the app shell in the provider.');
  }
  return context;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reverse inside the original period while it is still OPEN, so the correcting entry lands in the
 * same reporting window the reader is looking at. Once the period is closed, the reversal is booked
 * in the current period instead — never back-dated into closed books.
 */
function reversalDateFor(periods: readonly AccountingPeriod[], originalDate: string): string {
  return periodStatusFor(periods, originalDate) === 'OPEN' ? originalDate : isoToday();
}
