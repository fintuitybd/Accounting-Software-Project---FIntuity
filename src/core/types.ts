// LedgerVault domain contracts — shared by every engine, workspace and print replica.

export type EntityType =
  | 'PRIVATE_LIMITED'
  | 'PUBLIC_LISTED'
  | 'SOLE_PROPRIETORSHIP'
  | 'PARTNERSHIP'
  | 'STARTUP_REGISTERED'
  | 'BRANCH_FOREIGN'
  | 'EPZ_EZ_UNIT'
  | 'NGO_NPO';

export type ReportingFramework = 'IFRS_FRC_ADOPTED' | 'IFRS_FOR_SMES_BFRS' | 'SIMPLIFIED_MANAGEMENT';

export type BookType = 'STATUTORY_BD' | 'IFRS_GROUP_ADJ' | 'TAX_COMPUTATION' | 'MANAGEMENT_MIS';

export type IndustryPack = 'TRADING_DISTRIBUTION' | 'SERVICES_IT' | 'MANUFACTURING_RMG' | 'ECOMMERCE_FCOMMERCE' | 'PRACTICE_FIRM';

export type VatStatus = 'VAT_REGISTERED_15' | 'TURNOVER_TAX_ENLISTED' | 'EXEMPT' | 'STARTUP_RELIEF';

export type Currency = 'BDT' | 'USD' | 'EUR';

export interface BinUnit {
  id: string;
  bin_number: string;
  unit_name_en: string;
  unit_name_bn: string;
  address: string;
  is_principal: boolean;
}

export interface TenantEntity {
  id: string;
  persona_key: 'APEX' | 'CLOUDNINE' | 'RAFIQ';
  name_en: string;
  name_bn: string;
  trade_name: string;
  entity_type: EntityType;
  industry_pack: IndustryPack;
  tin_number: string;
  rjsc_reg_no: string;
  vat_status: VatStatus;
  is_withholding_entity: boolean;
  reporting_framework: ReportingFramework;
  fiscal_year_label: string;
  functional_currency: 'BDT';
  address_en: string;
  address_bn: string;
  telephone: string;
  email: string;
  bin_units: BinUnit[];
  accounting_policies: {
    inventory_formula: 'WEIGHTED_AVERAGE' | 'FIFO';
    depreciation_method: 'STRAIGHT_LINE' | 'REDUCING_BALANCE';
    ifrs18_early_adoption: boolean;
    ecl_provision_matrix_enabled: boolean;
    cash_disallowance_limit_poisha: bigint;
  };
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type AccountSubCategory =
  | 'CURRENT_ASSET'
  | 'NON_CURRENT_ASSET'
  | 'CURRENT_LIABILITY'
  | 'NON_CURRENT_LIABILITY'
  | 'EQUITY_CAPITAL'
  | 'EQUITY_RESERVES'
  | 'OPERATING_REVENUE'
  | 'COST_OF_SALES'
  | 'OPERATING_EXPENSE'
  | 'FINANCE_COST'
  | 'INVESTING_INCOME'
  | 'TAX_EXPENSE';

export type Ifrs18Category = 'OPERATING' | 'INVESTING' | 'FINANCING' | 'INCOME_TAX' | 'DISCONTINUED' | 'NA_BALANCE_SHEET';

export type ControlSubledger =
  | 'NONE'
  | 'AR'
  | 'AP'
  | 'BANK_MFS'
  | 'VAT_CURRENT_ACCOUNT'
  | 'VDS_PAYABLE'
  | 'TDS_PAYABLE'
  | 'INVENTORY'
  | 'FIXED_ASSETS';

export interface Account {
  code: string;
  name_en: string;
  name_bn: string;
  account_type: AccountType;
  sub_category: AccountSubCategory;
  ifrs18_category: Ifrs18Category;
  ifrs_statement_line_id: string;
  control_subledger: ControlSubledger;
  /**
   * Legacy display-only fields. A posted opening balance comes from an OpeningBalanceBatch journal,
   * never from these mutable master-data values; the reporting engine ignores them.
   */
  opening_debit_poisha: bigint;
  opening_credit_poisha: bigint;
  is_active: boolean;
  note_ref: string;
  cash_flow_tag: 'OPERATING' | 'INVESTING' | 'FINANCING' | 'CASH' | 'NONE';
}

export type DocumentLifecycleStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'SETTLED'
  | 'RECONCILED'
  | 'REVERSED'
  | 'PERIOD_CLOSED';

export type SourceModule =
  | 'SALES'
  | 'PURCHASES'
  | 'BANK_MFS'
  | 'PAYROLL_LITE'
  | 'MANUAL_JOURNAL'
  | 'IFRS_ADJUSTMENT'
  | 'MASS_IMPORT'
  | 'REVERSAL'
  | 'OPENING_BALANCE';

export interface JournalLine {
  id: string;
  line_no: number;
  account_code: string;
  account_name_en: string;
  account_name_bn: string;
  party_id?: string;
  party_name?: string;
  cost_center?: string;
  project_code?: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  journal_number: string;
  book_type: BookType;
  bin_unit_id: string;
  period_code: string;
  document_date: string;
  posting_date: string;
  tax_point_date: string;
  due_date?: string;
  source_module: SourceModule;
  source_doc_id?: string;
  source_doc_ref?: string;
  import_batch_id?: string;
  narration_en: string;
  narration_bn: string;
  currency: Currency;
  exchange_rate_bps: number;
  status: DocumentLifecycleStatus;
  idempotency_key: string;
  rule_pack_version?: string;
  tax_decision_trace_id?: string;
  reversal_of_journal_id?: string;
  reversed_by_journal_id?: string;
  reversal_reason?: string;
  created_by: string;
  approved_by?: string;
  posted_at?: string;
  audit_hash: string;
  prev_audit_hash: string;
  lines: JournalLine[];
}

export type TaxCategory =
  | 'STANDARD_15'
  | 'TRADING_5'
  | 'PROCUREMENT_7_5'
  | 'EXPORT_ZERO'
  | 'EXEMPT'
  | 'REVERSE_CHARGE'
  | 'OUT_OF_SCOPE';

export type TdsNature =
  | 'NONE'
  | 'SUPPLY_OF_GOODS'
  | 'PROFESSIONAL_OR_TECHNICAL_SERVICES'
  | 'COMMERCIAL_RENT'
  | 'ADVERTISING_OR_MEDIA'
  | 'TRANSPORT_OR_LOGISTICS'
  | 'CONTRACTOR_OR_SUBCONTRACTOR';

export type PaymentMethod = 'BANK' | 'MFS' | 'CASH' | 'CHEQUE' | 'CREDIT_CARD';

export type PaymentMethodType = PaymentMethod;

export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

export interface Party {
  id: string;
  code: string;
  name_en: string;
  name_bn: string;
  type: PartyType;
  bin?: string;
  tin?: string;
  address_en: string;
  address_bn: string;
  mobile: string;
  email: string;
  is_withholding_buyer: boolean;
  is_government: boolean;
  credit_days: number;
  opening_balance_poisha: bigint;
  is_active: boolean;
}

/**
 * Inventory master record. Stock items carry a live quantity and a weighted-average carrying cost;
 * the perpetual inventory engine uses both for COGS and receipt valuation (blueprint §4.1–4.2).
 */
export interface InventoryItem {
  id: string;
  sku: string;
  hs_code?: string;
  name_en: string;
  name_bn: string;
  unit_en: string;
  unit_bn: string;
  unit_price_poisha: bigint;
  tax_category: TaxCategory;
  inventory_account: string;
  is_stock_item?: boolean;
  /** Units physically on hand. Seeded stock goods start at 100. */
  qty_on_hand?: number;
  /** Weighted-average unit cost in poisha. Seeded stock goods default to 70% of unit price. */
  unit_cost_poisha?: bigint;
}

/** Backwards-compatible alias retained for engines that already import `Item`. */
export type Item = InventoryItem;

export type StockMovementType = 'RECEIPT' | 'ISSUE' | 'RETURN_IN' | 'RETURN_OUT' | 'ADJUSTMENT';

/**
 * Explicit stock ledger entry. Quantities are in item units; `value_poisha` is the movement value
 * at the weighted-average unit cost. A movement is never inferred from an item balance alone.
 */
export interface StockMovement {
  id: string;
  movement_type: StockMovementType;
  sku: string;
  quantity: number;
  unit_cost_poisha: bigint;
  value_poisha: bigint;
  movement_date?: string;
  source_doc_id?: string;
  source_doc_ref?: string;
  /** True only when the caller explicitly overrode the default no-negative-stock policy. */
  negative_stock_override?: boolean;
}

/**
 * Connected lifecycle stage for a commercial document. Sales and purchase documents share the
 * union so a single `CommercialDoc` can be advanced through either workflow.
 */
export type WorkflowStage =
  | 'QUOTATION'
  | 'SALES_ORDER'
  | 'DELIVERY_CHALLAN'
  | 'INVOICED_POSTED'
  | 'PURCHASE_ORDER'
  | 'GRN_RECEIVED'
  | 'BILL_POSTED'
  | 'SETTLED';

export type BankKind = 'BANK' | 'MFS' | 'CASH';

export interface BankAccount {
  id: string;
  name_en: string;
  name_bn: string;
  account_code: string;
  kind: BankKind;
  provider: string;
  masked_number: string;
  branch: string;
  opening_poisha: bigint;
  accent: string;
}

export type CommercialDocType = 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_BILL' | 'EXPENSE_VOUCHER' | 'IMPORTED_SERVICE';

export interface DocLine {
  id: string;
  sku: string;
  description_en: string;
  description_bn: string;
  quantity: number;
  unit_price_poisha: bigint;
  tax_category: TaxCategory;
  cost_center?: string;
}

/**
 * Per-line tax result calculated BEFORE document totals. The document keeps one aggregate summary
 * (base/VAT/etc.) while this array proves that each line was taxed on its own category.
 */
export interface DocumentLineTax {
  line_id: string;
  sku: string;
  tax_category: TaxCategory;
  base_poisha: bigint;
  sd_poisha: bigint;
  vat_poisha: bigint;
  gross_poisha: bigint;
  vds_poisha: bigint;
  tds_poisha: bigint;
  net_payable_poisha: bigint;
  claimable_poisha: bigint;
  disallowed_poisha: bigint;
  decision_state: DecisionState;
  trace_id: string;
}

export interface CommercialDoc {
  id: string;
  doc_type: CommercialDocType;
  doc_number: string;
  mushak_serial?: string;
  doc_date: string;
  due_date: string;
  party_id: string;
  party_name_en: string;
  party_name_bn: string;
  party_bin?: string;
  party_tin?: string;
  bin_unit_id: string;
  lines: DocLine[];
  /** Per-line tax evidence. Optional for snapshots created before Phase 1 (recomputed on read). */
  line_tax?: DocumentLineTax[];
  /** Every distinct tax category present on the lines, so a mixed-rate document is explicit. */
  tax_categories?: TaxCategory[];
  base_poisha: bigint;
  sd_poisha: bigint;
  vat_poisha: bigint;
  vds_poisha: bigint;
  tds_poisha: bigint;
  gross_poisha: bigint;
  net_payable_poisha: bigint;
  tax_category: TaxCategory;
  /** Distinct Mushak 6.7 documents carry their own CN series and link to the original invoice. */
  original_doc_id?: string;
  original_doc_number?: string;
  tds_nature: TdsNature;
  payment_method: PaymentMethod;
  status: DocumentLifecycleStatus;
  journal_id?: string;
  narration_en: string;
  narration_bn: string;
  mushak63_ref?: string;
  reverse_charge: boolean;
  reference_no?: string;
  /** O2C / P2P lifecycle stage (blueprint §4.1 and §4.2). */
  workflow_stage?: WorkflowStage;
  /** Agreed purchase-order quantity — carried onto the PO and matched at GRN time. */
  po_qty?: number;
  /** Actually received quantity — the GRN leg of the 3-way match. */
  grn_qty?: number;
  /** Logistics facts printed on Mushak 6.3 (vehicle registration and place of supply). */
  vehicle_no?: string;
  destination?: string;
  /** Exact settlement rail behind BANK / MFS (e.g. "bKash Merchant", "City Bank A/C 4471"). */
  payment_channel?: string;
  created_by: string;
  created_at: string;
  settled_poisha: bigint;
  book_type: BookType;
}

/** Canonical name used by the workflow blueprint for the connected document lifecycle. */
export type CommercialDocument = CommercialDoc;

export interface CreateDocInput {
  doc_type: CommercialDocType;
  doc_date: string;
  party_id: string;
  bin_unit_id: string;
  lines: Array<{
    sku: string;
    description_en: string;
    description_bn: string;
    quantity: number;
    unit_price_poisha: bigint;
    tax_category: TaxCategory;
    cost_center?: string;
  }>;
  tax_category: TaxCategory;
  tds_nature: TdsNature;
  payment_method: PaymentMethod;
  narration_en: string;
  narration_bn: string;
  reverse_charge: boolean;
  withhold_vds: boolean;
  sd_applicable: boolean;
  book_type: BookType;
  auto_post: boolean;
  workflow_stage?: WorkflowStage;
  po_qty?: number;
  grn_qty?: number;
  vehicle_no?: string;
  destination?: string;
  payment_channel?: string;
  /** A Mushak 6.7 credit note must identify the invoice it corrects. */
  original_doc_id?: string;
  original_doc_number?: string;
}

export type DecisionState =
  | 'SUPPORTED'
  | 'SUPPORTED_WITH_CONDITIONS'
  | 'MANUAL_REVIEW'
  | 'NOT_SUPPORTED'
  | 'SOURCE_DISPUTED_OR_EXPIRED';

export type TaxDomain = 'VAT' | 'SD' | 'VDS' | 'TDS' | 'REBATE' | 'FILING' | 'REVERSE_CHARGE';

export type RuleStatus = 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED' | 'DRAFT';

export interface TaxRule {
  id: string;
  domain: TaxDomain;
  title_en: string;
  title_bn: string;
  description_en: string;
  description_bn: string;
  rate_bps?: number;
  citation: string;
  instrument: string;
  effective_from: string;
  effective_to?: string;
  gazette_date?: string;
  status: RuleStatus;
  verify_flag: boolean;
  tags: string[];
}

export interface RulePack {
  version: string;
  jurisdiction: 'BD';
  title_en: string;
  title_bn: string;
  published_at: string;
  effective_from: string;
  reviewer: string;
  reviewer_status: 'PENDING_TAX_COUNSEL' | 'SIGNED_OFF';
  rules: TaxRule[];
  historical_notes: Array<{ period: string; note_en: string; note_bn: string }>;
}

export interface TaxCondition {
  code: string;
  satisfied: boolean;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  message_en: string;
  message_bn: string;
  evidence_required?: string;
}

export interface InputCreditOutcome {
  eligible: boolean;
  claimable_poisha: bigint;
  disallowed_poisha: bigint;
  reasons: string[];
  reason_labels_en: string[];
  reason_labels_bn: string[];
  rule_ids: string[];
}

export interface FilingDecision {
  due_date: string;
  days_after_period: number;
  period_label: string;
  rule_id: string;
  citation: string;
  holiday_adjusted: boolean;
  explanation_en: string;
  explanation_bn: string;
}

export interface TaxEvaluationInput {
  direction: 'SALE' | 'PURCHASE';
  base_poisha: bigint;
  tax_category: TaxCategory;
  party_name: string;
  party_bin?: string;
  party_tin?: string;
  is_withholding_entity: boolean;
  vds_applicable: boolean;
  vds_rate_bps?: number;
  tds_nature: TdsNature;
  payment_method: PaymentMethod;
  has_valid_mushak63: boolean;
  is_reverse_charge: boolean;
  has_reverse_charge_challan?: boolean;
  sd_applicable?: boolean;
  is_credit_note?: boolean;
  is_nil_return?: boolean;
  is_government_or_bank?: boolean;
  period_end_date?: string;
  rule_pack_version?: string;
}

export interface TaxDecision {
  trace_id: string;
  decision: DecisionState;
  direction: 'SALE' | 'PURCHASE';
  base_poisha: bigint;
  sd_bps: number;
  sd_poisha: bigint;
  vat_bps: number;
  vat_poisha: bigint;
  gross_poisha: bigint;
  vds_bps: number;
  vds_poisha: bigint;
  tds_bps: number;
  tds_poisha: bigint;
  net_payable_poisha: bigint;
  treasury_payable_poisha: bigint;
  input_credit: InputCreditOutcome;
  conditions: TaxCondition[];
  rule_ids: string[];
  citations: string[];
  explanations_en: string[];
  explanations_bn: string[];
  rule_pack_version: string;
  evaluated_at: string;
  filing?: FilingDecision;
}

export interface TaxAdvisorSnapshot {
  decision: TaxDecision;
  vat_category_label_en: string;
  vat_category_label_bn: string;
  vds_label_en: string;
  vds_label_bn: string;
  tds_label_en: string;
  tds_label_bn: string;
}

export type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED';

/**
 * Result of resolving a posting date against the configured accounting periods. `UNKNOWN` is not a
 * period status: it means no configured period covers the date (or no periods were supplied), and
 * the posting engine must reject it rather than inventing an open period.
 */
export type PeriodResolution = PeriodStatus | 'UNKNOWN';

/** A balanced opening-balance batch is a posted journal, never a mutable account-master field. */
export interface OpeningBalanceLine {
  id?: string;
  account_code: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  party_id?: string;
  memo?: string;
}

export interface OpeningBalanceBatch {
  id: string;
  batch_date: string;
  book_type: BookType;
  bin_unit_id: string;
  lines: OpeningBalanceLine[];
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  balanced: boolean;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  journal_id?: string;
  created_by: string;
}

export interface AccountingPeriod {
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  closed_at?: string;
  closed_by?: string;
  locked_at?: string;
  notes?: string;
}

export type ChallanType = 'VDS' | 'TDS' | 'VAT' | 'AIT';

export type ChallanStatus = 'PENDING' | 'BATCHED' | 'DEPOSITED' | 'CERTIFIED';

export interface Challan {
  id: string;
  challan_number: string;
  type: ChallanType;
  period_code: string;
  amount_poisha: bigint;
  economic_code: string;
  deposit_date?: string;
  status: ChallanStatus;
  journal_id?: string;
  certificate_numbers: string[];
  narration: string;
  party_id?: string;
  /** Treasury deposit provenance captured at batch-deposit time. */
  bank_account_code?: string;
  bank_branch?: string;
  batch_reference?: string;
}

export interface VdsCertificate {
  id: string;
  certificate_number: string;
  direction: 'ISSUED' | 'RECEIVED';
  party_id: string;
  party_name_en: string;
  party_name_bn: string;
  party_bin?: string;
  amount_poisha: bigint;
  vds_poisha: bigint;
  certificate_date: string;
  status: 'PENDING' | 'RECEIVED' | 'VERIFIED';
  related_doc_ref: string;
  challan_id?: string;
}

export interface Notice {
  id: string;
  reference: string;
  authority: string;
  subject_en: string;
  subject_bn: string;
  received_date: string;
  response_due: string;
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string;
}

export interface LicenceRecord {
  id: string;
  name_en: string;
  name_bn: string;
  authority: string;
  number: string;
  expiry_date: string;
  status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  fee_poisha: bigint;
}

export interface Employee {
  id: string;
  employee_code: string;
  name_en: string;
  name_bn: string;
  designation: string;
  worker_class: 'PERMANENT' | 'PROBATIONARY' | 'CONTRACTUAL' | 'PIECE_RATE' | 'APPRENTICE';
  department: string;
  basic_poisha: bigint;
  house_rent_poisha: bigint;
  medical_poisha: bigint;
  transport_poisha: bigint;
  pf_employee_poisha: bigint;
  pf_employer_poisha: bigint;
  tin?: string;
}

export interface PayrollLine {
  employee_id: string;
  employee_name: string;
  basic_poisha: bigint;
  house_rent_poisha: bigint;
  medical_poisha: bigint;
  transport_poisha: bigint;
  overtime_poisha: bigint;
  festival_bonus_poisha: bigint;
  gross_poisha: bigint;
  pf_employee_poisha: bigint;
  pf_employer_poisha: bigint;
  gratuity_poisha: bigint;
  tds_poisha: bigint;
  net_poisha: bigint;
}

export interface PayrollRun {
  id: string;
  period_code: string;
  month_label: string;
  lines: PayrollLine[];
  total_gross_poisha: bigint;
  total_pf_poisha: bigint;
  total_gratuity_poisha: bigint;
  total_tds_poisha: bigint;
  total_net_poisha: bigint;
  wppf_poisha: bigint;
  status: 'DRAFT' | 'POSTED';
  journal_id?: string;
}

export type ImportPipeline = 'BULK_JOURNAL' | 'SALES_PURCHASE' | 'OPENING_BALANCE' | 'BANK_MFS';

export type ImportRowStatus =
  | 'VALID'
  | 'DUPLICATE_DOC_NO'
  | 'DUPLICATE_DOC_WARNING'
  | 'UNBALANCED_JOURNAL'
  | 'INVALID_BIN_WARNING'
  | 'NO_TIN_PENALTY_UPSCALED'
  | 'CASH_OVER_100K_VAT_DISALLOWED'
  | 'INVALID_ACCOUNT'
  | 'PERIOD_CLOSED'
  | 'INVALID_DATE'
  | 'TAX_ENGINE_REVIEW'
  | 'FIXED';

export interface ImportRow {
  row_number: number;
  raw: Record<string, string | number>;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  amount_poisha: bigint;
  vat_poisha: bigint;
  vds_poisha: bigint;
  tds_poisha: bigint;
}

export interface ImportSimulation {
  pipeline: ImportPipeline;
  rows: ImportRow[];
  valid_rows: number;
  invalid_rows: number;
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  output_vat_poisha: bigint;
  input_vat_claimable_poisha: bigint;
  disallowed_vat_poisha: bigint;
  vds_poisha: bigint;
  tds_poisha: bigint;
  balanced: boolean;
  file_name: string;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  pipeline: ImportPipeline;
  committed_at: string;
  committed_by: string;
  row_count: number;
  journal_ids: string[];
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  output_vat_poisha: bigint;
  input_vat_claimable_poisha: bigint;
  vds_poisha: bigint;
  tds_poisha: bigint;
  status: 'COMMITTED' | 'ROLLED_BACK';
  rolled_back_at?: string;
  rollback_journal_ids?: string[];
}

export interface SubledgerProof {
  key: 'AR' | 'AP' | 'BANK_MFS' | 'VAT_CURRENT_ACCOUNT' | 'VDS_PAYABLE' | 'TDS_PAYABLE';
  label_en: string;
  label_bn: string;
  gl_balance_poisha: bigint;
  subledger_balance_poisha: bigint;
  difference_poisha: bigint;
  reconciled: boolean;
  account_codes: string[];
  open_items: number;
}

export interface SuspenseItem {
  id: string;
  journal_id: string;
  journal_number: string;
  date: string;
  amount_poisha: bigint;
  description_en: string;
  description_bn: string;
  age_days: number;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  broken_at?: string;
  message: string;
}

export interface CloseStep {
  id: number;
  title_en: string;
  title_bn: string;
  description_en: string;
  description_bn: string;
  status: 'PENDING' | 'PASSED' | 'WARNING';
  automated: boolean;
  detail_en: string;
  detail_bn: string;
}

export interface AppSettings {
  locale: 'en-BD' | 'bn-BD';
  numeral: 'latin' | 'bn';
  grouping: 'LAKH_CRORE' | 'MILLIONS';
  mode: 'GUIDED' | 'PRO';
  motion: 'FULL' | 'LITE' | 'OFF';
  theme: 'LIGHT' | 'DARK' | 'CONTRAST';
  bookFilter: 'STATUTORY_BD' | 'ALL_IFRS_BOOKS' | 'TAX_COMPUTATION';
}

export interface StatementLine {
  id: string;
  label_en: string;
  label_bn: string;
  note?: string;
  amount_poisha: bigint;
  comparative_poisha: bigint;
  is_subtotal?: boolean;
  is_total?: boolean;
  indent?: number;
  account_codes?: string[];
  variance_pct?: number;
}

export interface StatementSection {
  id: string;
  title_en: string;
  title_bn: string;
  lines: StatementLine[];
  total_poisha: bigint;
  comparative_total_poisha: bigint;
}

export interface FinancialStatements {
  period: { code: string; label_en: string; label_bn: string; start: string; end: string };
  comparative: { code: string; label_en: string; label_bn: string; start: string; end: string };
  framework: ReportingFramework;
  book_filter: AppSettings['bookFilter'];
  balance_sheet: {
    assets_non_current: StatementSection;
    assets_current: StatementSection;
    total_assets_poisha: bigint;
    total_assets_comparative_poisha: bigint;
    equity: StatementSection;
    liabilities_non_current: StatementSection;
    liabilities_current: StatementSection;
    total_equity_and_liabilities_poisha: bigint;
    total_equity_and_liabilities_comparative_poisha: bigint;
    balanced: boolean;
    imbalance_poisha: bigint;
  };
  profit_or_loss: {
    operating: StatementSection;
    operating_profit_poisha: bigint;
    operating_profit_comparative_poisha: bigint;
    investing: StatementSection;
    profit_before_financing_tax_poisha: bigint;
    profit_before_financing_tax_comparative_poisha: bigint;
    financing: StatementSection;
    profit_before_tax_poisha: bigint;
    profit_before_tax_comparative_poisha: bigint;
    income_tax: StatementSection;
    profit_for_period_poisha: bigint;
    profit_for_period_comparative_poisha: bigint;
    gross_profit_poisha: bigint;
    gross_profit_comparative_poisha: bigint;
    mpm: {
      operating_profit_poisha: bigint;
      depreciation_poisha: bigint;
      ecl_poisha: bigint;
      adjusted_ebitda_poisha: bigint;
      operating_margin_bps: number;
      comparative_margin_bps: number;
    };
  };
  changes_in_equity: Array<{
    row_id: string;
    label_en: string;
    label_bn: string;
    share_capital_poisha: bigint;
    retained_earnings_poisha: bigint;
    revaluation_poisha: bigint;
    total_poisha: bigint;
    is_total?: boolean;
  }>;
  cash_flow: {
    operating: StatementSection;
    operating_total_poisha: bigint;
    operating_total_comparative_poisha: bigint;
    investing: StatementSection;
    investing_total_poisha: bigint;
    investing_total_comparative_poisha: bigint;
    financing: StatementSection;
    financing_total_poisha: bigint;
    financing_total_comparative_poisha: bigint;
    net_change_poisha: bigint;
    net_change_comparative_poisha: bigint;
    opening_cash_poisha: bigint;
    opening_cash_comparative_poisha: bigint;
    closing_cash_poisha: bigint;
    closing_cash_comparative_poisha: bigint;
    reconciles: boolean;
    difference_poisha: bigint;
  };
  trial_balance: Array<{
    account_code: string;
    name_en: string;
    name_bn: string;
    account_type: AccountType;
    opening_debit_poisha: bigint;
    opening_credit_poisha: bigint;
    period_debit_poisha: bigint;
    period_credit_poisha: bigint;
    closing_debit_poisha: bigint;
    closing_credit_poisha: bigint;
    balance_poisha: bigint;
  }>;
  notes: Array<{
    id: string;
    number: string;
    title_en: string;
    title_bn: string;
    body_en: string;
    body_bn: string;
    rows: Array<{ label_en: string; label_bn: string; amount_poisha: bigint; comparative_poisha: bigint }>;
  }>;
  kpis: {
    revenue_poisha: bigint;
    expenses_poisha: bigint;
    net_profit_poisha: bigint;
    cash_poisha: bigint;
    receivables_poisha: bigint;
    payables_poisha: bigint;
    output_vat_poisha: bigint;
    input_vat_poisha: bigint;
    vds_payable_poisha: bigint;
    tds_payable_poisha: bigint;
    retained_earnings_poisha: bigint;
  };
}

export interface Mushak91Part {
  part: number;
  title_en: string;
  title_bn: string;
  rows: Array<{ label_en: string; label_bn: string; amount_poisha: bigint; note?: string }>;
  total_poisha: bigint;
}

export interface Mushak91Return {
  period_code: string;
  period_label: string;
  bin: string;
  legal_name: string;
  parts: Mushak91Part[];
  output_tax_poisha: bigint;
  input_rebate_poisha: bigint;
  increasing_adjustment_poisha: bigint;
  decreasing_adjustment_poisha: bigint;
  net_payable_poisha: bigint;
  closing_balance_poisha: bigint;
  due_date: string;
  filing_rule: FilingDecision;
  gl_output_vat_poisha: bigint;
  gl_input_vat_poisha: bigint;
  gl_difference_poisha: bigint;
  reconciled: boolean;
  sales_register: MushakRegisterRow[];
  purchase_register: MushakRegisterRow[];
}

export interface MushakRegisterRow {
  serial: string;
  doc_number: string;
  date: string;
  party_name: string;
  party_bin: string;
  description: string;
  value_poisha: bigint;
  sd_poisha: bigint;
  vat_poisha: bigint;
  vds_poisha: bigint;
  total_poisha: bigint;
  eligible_rebate: boolean;
  disallowance_reason?: string;
}

export interface BankStatementLine {
  id: string;
  account_code: string;
  date: string;
  description: string;
  reference: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  status: 'UNMATCHED' | 'MATCHED' | 'CATEGORIZED';
  matched_doc_ref?: string;
  fee_poisha: bigint;
  journal_id?: string;
}

export interface CashForecastWeek {
  week: number;
  week_start: string;
  label: string;
  inflow_poisha: bigint;
  outflow_poisha: bigint;
  net_poisha: bigint;
  closing_poisha: bigint;
}

export interface LineageProof {
  id: string;
  step: 'TAX_DECISION' | 'JOURNAL' | 'LEDGER' | 'STATEMENT' | 'MUSHAK_RETURN';
  title_en: string;
  title_bn: string;
  reference: string;
  detail_en: string;
  detail_bn: string;
}

export interface ToastMessage {
  id: string;
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message?: string;
}

// ---------------------------------------------------------------------------------------------
// RBAC & onboarding contracts (WORKFLOW_BLUEPRINT.md §3)
// ---------------------------------------------------------------------------------------------

export type UserRole = 'OWNER' | 'ADMIN' | 'CONTROLLER' | 'ACCOUNTANT' | 'OPERATOR' | 'AUDITOR';

export type PermissionAction =
  | 'MANAGE_COMPANY_SETTINGS'
  | 'CREATE_COMMERCIAL_DRAFT'
  | 'DISPATCH_OR_RECEIVE_STOCK'
  | 'POST_TO_GL'
  | 'APPROVE_HIGH_VALUE'
  | 'OVERRIDE_3WAY_VARIANCE'
  | 'REVERSE_POSTED_JOURNAL'
  | 'SUBMIT_CLOSE_MAKER'
  | 'APPROVE_CLOSE_CHECKER'
  | 'MANAGE_MASTERS_AND_COA'
  | 'MANAGE_USERS_AND_ORG'
  | 'VIEW_REPORTS'
  | 'VIEW_LIMITED_REPORTS'
  | 'EXPORT_DATA'
  | 'OVERRIDE_NEGATIVE_STOCK';

export interface UserAccount {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
  email: string;
  designation: string;
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
}

/** Payload collected by the 4-step New Company Onboarding Wizard. */
export interface CustomTenantInput {
  name_en: string;
  name_bn: string;
  trade_name: string;
  entity_type: EntityType;
  industry_pack: IndustryPack;
  tin_number: string;
  bin_number: string;
  rjsc_reg_no: string;
  vat_status: VatStatus;
  is_withholding_entity: boolean;
  reporting_framework: ReportingFramework;
  fiscal_year_label: string;
  address_en: string;
  address_bn: string;
  telephone: string;
  email: string;
  bank_name: string;
  bank_account_masked: string;
  opening_cash_poisha: bigint;
  opening_bank_poisha: bigint;
  opening_capital_poisha: bigint;
}
