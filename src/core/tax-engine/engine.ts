// Deterministic Bangladesh tax engine.
//
// `evaluateTaxDecision()` is the ONLY place where a tax amount is computed. It reads Rule Pack
// bd-2026-v1, never a language model, never a network call and never a hard-coded rate outside the
// pack. The same input always produces the same decision (the trace ID is a 64-bit FNV-1a digest of
// the canonical facts), which is what makes the 25 golden vectors meaningful.
//
// Amount model (all bigint poisha, never floating point):
//   • SD and VAT are charged on the document. For ordinary documents VAT is computed on
//     base + SD; reverse-charge VAT is self-assessed on the base alone because the foreign supplier
//     does not charge Bangladeshi VAT.
//   • VDS and TDS are always deducted from the BASE, never from VAT (no TDS-on-VAT).
//   • Gross invoice        = base + SD + VAT            (ordinary document)
//   • Gross invoice        = base + SD                  (reverse charge: VAT is self-assessed)
//   • Net payable to party = gross − VDS − TDS
//   • Treasury payable     = VDS + TDS                  (ordinary document, per SPEC §3.2)
//   • Treasury payable     = VDS + TDS + reverse-charge VAT (reverse charge, deposited by challan)
//   • Credit notes (Mushak 6.7) negate every monetary field while keeping the same rates.
//
// Direction of withholding: `is_withholding_entity` identifies the party legally obliged to deduct
// at source — on a PURCHASE it is the tenant (we withhold from the supplier), on a SALE it is the
// customer (they withhold from us, creating a VDS receivable and an AIT/TDS credit).
//
// Decision states are derived only from the conditions the engine itself emits:
//   BLOCKER + invalid base        → NOT_SUPPORTED
//   BLOCKER + rule-pack mismatch  → SOURCE_DISPUTED_OR_EXPIRED
//   BLOCKER (out of scope, etc.)  → MANUAL_REVIEW
//   WARNING                       → SUPPORTED_WITH_CONDITIONS
//   otherwise                     → SUPPORTED

import { applyRateBps, bpsToPercent, formatPoisha, isoNow, toLatinDigits } from '../money';
import type {
  Account,
  DecisionState,
  DocumentLineTax,
  FilingDecision,
  InputCreditOutcome,
  InventoryItem,
  PaymentMethod,
  RulePack,
  StockMovement,
  TaxAdvisorSnapshot,
  TaxCategory,
  TaxCondition,
  TaxDecision,
  TaxEvaluationInput,
  TdsNature,
} from '../types';
import {
  BD_2026_V1,
  CASH_DISALLOWANCE_LIMIT_POISHA,
  FILING_SPECIAL_DAYS,
  FILING_STANDARD_DAYS,
  REVERSE_CHARGE_VAT_BPS,
  RULE_IDS,
  SD_RATE_BPS,
  TDS_NO_TIN_UPSCALE_BPS,
  TDS_RATE_BPS_BY_NATURE,
  TDS_RULE_ID_BY_NATURE,
  VAT_RATE_BPS_BY_CATEGORY,
  VAT_RULE_ID_BY_CATEGORY,
  VDS_RATE_BPS_BY_CATEGORY,
  getRule,
  nextWorkingDay,
} from './rulePack';

export interface TaxEngineOptions {
  /** Rule pack override — used by the "What changed?" simulator, never by production posting. */
  rulePack?: RulePack;
  /** Fixed evaluation timestamp so replaying an audit pack produces an identical record. */
  evaluatedAt?: string;
}

/** `TaxDecision` plus the evidence flags the UI needs without re-deriving anything. */
export interface TaxDecisionDetail extends TaxDecision {
  category: TaxCategory;
  effective_category: TaxCategory;
  is_reverse_charge: boolean;
  bin_valid: boolean;
  tin_valid: boolean;
  reverse_charge_vat_poisha: bigint;
  withheld_total_poisha: bigint;
  cash_limit_poisha: bigint;
}

export interface DocumentTaxLineInput {
  id?: string;
  sku?: string;
  quantity: number;
  unit_price_poisha: bigint;
  tax_category: TaxCategory;
}

export interface DocumentTaxLineDecision extends DocumentLineTax {
  decision: TaxDecisionDetail;
}

export interface DocumentTaxSummary {
  decision: TaxDecisionDetail;
  lines: DocumentTaxLineDecision[];
  mixed_tax_categories: boolean;
}

/**
 * The document-level facts shared by every line. Base and category are deliberately absent: the
 * only authoritative source is each line's quantity, price and tax category.
 */
export interface DocumentTaxRequest extends Omit<TaxEvaluationInput, 'base_poisha' | 'tax_category'> {
  lines: readonly DocumentTaxLineInput[];
  /** Header category retained for display; never used to compute a mixed-rate line. */
  fallback_tax_category?: TaxCategory;
}

/** Quantities are carried to two decimal places so money stays in integer poisha. */
export const QUANTITY_SCALE = 100n;

/** Line taxable value using the same quantity scaling as COGS and stock movements. */
export function lineTaxBasePoisha(
  line: Pick<DocumentTaxLineInput, 'quantity' | 'unit_price_poisha'>,
): bigint {
  if (!Number.isFinite(line.quantity) || line.quantity < 0) {
    throw new Error('A line quantity must be a non-negative finite number.');
  }
  if (line.unit_price_poisha < 0n) {
    throw new Error('A line unit price cannot be negative.');
  }
  const quantityScaled = BigInt(Math.round(line.quantity * 100));
  return (quantityScaled * line.unit_price_poisha) / QUANTITY_SCALE;
}

export type TaxJournalGroupId = 'DOCUMENT' | 'SETTLEMENT';

export type TaxJournalPart =
  | 'REVENUE'
  | 'RECEIVABLE'
  | 'INPUT_CREDIT'
  | 'VAT'
  | 'SD'
  | 'VDS'
  | 'TDS'
  | 'REVERSE_CHARGE'
  | 'COST'
  | 'PAYABLE'
  | 'CASH';

export interface TaxJournalPreviewLine {
  line_no: number;
  account_code: string;
  account_name_en: string;
  account_name_bn: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  tax_part: TaxJournalPart;
  memo_en: string;
  memo_bn: string;
}

export interface TaxJournalPreviewGroup {
  id: TaxJournalGroupId;
  title_en: string;
  title_bn: string;
  lines: TaxJournalPreviewLine[];
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  balanced: boolean;
}

export interface TaxJournalPreview {
  direction: 'SALE' | 'PURCHASE';
  groups: TaxJournalPreviewGroup[];
  lines: TaxJournalPreviewLine[];
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  balanced: boolean;
}

// ---------------------------------------------------------------------------------------------
// Identity validation
// ---------------------------------------------------------------------------------------------

function digitsOf(value: string): string {
  return toLatinDigits(value).replace(/[^0-9]/g, '');
}

/** 13-digit BIN in the 9-digit business + 4-digit branch form (e.g. 001482910-0101). */
export function isValidBin(value?: string | null): boolean {
  if (!value) return false;
  const digits = digitsOf(value);
  if (digits.length !== 13) return false;
  if (/^0+$/.test(digits)) return false;
  if (/^(\d)\1{12}$/.test(digits)) return false;
  return true;
}

/** 12-digit NBR e-TIN. Placeholder and repeated digits are rejected. */
export function isValidTin(value?: string | null): boolean {
  if (!value) return false;
  const digits = digitsOf(value);
  if (digits.length !== 12) return false;
  if (/^0+$/.test(digits)) return false;
  if (/^(\d)\1{11}$/.test(digits)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Deterministic trace identity
// ---------------------------------------------------------------------------------------------

function canonicalFacts(input: TaxEvaluationInput, packVersion: string): string {
  return [
    'v1',
    packVersion,
    input.direction,
    input.base_poisha.toString(),
    input.tax_category,
    input.party_name.trim(),
    input.party_bin ?? '',
    input.party_tin ?? '',
    input.is_withholding_entity ? '1' : '0',
    input.vds_applicable ? '1' : '0',
    input.vds_rate_bps === undefined ? '' : String(input.vds_rate_bps),
    input.tds_nature,
    input.payment_method,
    input.has_valid_mushak63 ? '1' : '0',
    input.is_reverse_charge ? '1' : '0',
    input.has_reverse_charge_challan ? '1' : '0',
    input.sd_applicable ? '1' : '0',
    input.is_credit_note ? '1' : '0',
    input.is_nil_return ? '1' : '0',
    input.is_government_or_bank ? '1' : '0',
    input.period_end_date ?? '',
    input.rule_pack_version ?? '',
  ].join('|');
}

/** 64-bit FNV-1a over the canonical facts — stable across browsers, sessions and machines. */
export function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0').toUpperCase();
}

export function taxTraceId(input: TaxEvaluationInput, packVersion: string = BD_2026_V1.version): string {
  return `TAX-${fnv1a64Hex(canonicalFacts(input, packVersion))}`;
}

// ---------------------------------------------------------------------------------------------
// Filing calendar
// ---------------------------------------------------------------------------------------------

const EN_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Accepts YYYY-MM-DD or YYYY-MM and returns the last day covered by the period. */
export function normalizePeriodEnd(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [year, month] = trimmed.split('-').map((part) => Number(part));
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return trimmed;
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  return trimmed;
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface FilingContext {
  periodEndDate: string;
  isGovernmentOrBank?: boolean;
  isNilReturn?: boolean;
  pack?: RulePack;
}

/** Mushak 9.1 deadline under Ordinance No. 38 of 2026 (15 / 20 days, holiday adjusted). */
export function filingDecisionFor(context: FilingContext): FilingDecision {
  const pack = context.pack ?? BD_2026_V1;
  const periodEnd = normalizePeriodEnd(context.periodEndDate);
  const special = Boolean(context.isGovernmentOrBank) || Boolean(context.isNilReturn);
  const days = special ? FILING_SPECIAL_DAYS : FILING_STANDARD_DAYS;
  const nominal = addDaysIso(periodEnd, days);
  const dueDate = nextWorkingDay(nominal);
  const holidayAdjusted = dueDate !== nominal;
  const rule = getRule(RULE_IDS.VAT_FILING_S64_ORD38_2026, pack);
  const monthIndex = Number(periodEnd.slice(5, 7)) - 1;
  const year = periodEnd.slice(0, 4);
  const periodLabel =
    monthIndex >= 0 && monthIndex <= 11 ? `${EN_MONTH_LABELS[monthIndex]} ${year}` : periodEnd;
  const reasonEn = special
    ? 'Government, semi-government and autonomous bodies, banks, insurers and nil-return filers get the 20-day window under Ordinance No. 38 of 2026.'
    : 'Standard taxpayers file Mushak 9.1 within 15 days after the tax period under Ordinance No. 38 of 2026.';
  const reasonBn = special
    ? 'সরকার, আধা-সরকারি ও স্বায়ত্তশাসিত সংস্থা, ব্যাংক, বিমা ও শূন্য রিটার্ন দাখিলকারীরা অধ্যাদেশ নং ৩৮/২০২৬ অনুযায়ী ২০ দিনের সময় পান।'
    : 'সাধারণ করদাতারা অধ্যাদেশ নং ৩৮/২০২৬ অনুযায়ী করমেয়াদের ১৫ দিনের মধ্যে মূসক ৯.১ দাখিল করেন।';
  return {
    due_date: dueDate,
    days_after_period: days,
    period_label: periodLabel,
    rule_id: RULE_IDS.VAT_FILING_S64_ORD38_2026,
    citation: rule?.citation ?? 'VAT & SD (Amendment) Ordinance, 2026, s.64',
    holiday_adjusted: holidayAdjusted,
    explanation_en: holidayAdjusted
      ? `${reasonEn} The nominal due date ${nominal} fell on a government holiday or the Friday–Saturday weekend, so filing moves to the next working day, ${dueDate}.`
      : `${reasonEn} The due date is ${dueDate}.`,
    explanation_bn: holidayAdjusted
      ? `${reasonBn} প্রাপ্ত সময়সীমা ${nominal} সরকারি ছুটি বা শুক্র–শনিবার সাপ্তাহিক বন্ধে পড়ায় দাখিল পরবর্তী কার্যদিবস ${dueDate}-এ সরেছে।`
      : `${reasonBn} সময়সীমা ${dueDate}।`,
  };
}

// ---------------------------------------------------------------------------------------------
// Chart of accounts used by the journal preview (SPEC §4.1)
// ---------------------------------------------------------------------------------------------

interface PreviewAccount {
  code: string;
  name_en: string;
  name_bn: string;
}

const PREVIEW_ACCOUNTS: Record<string, PreviewAccount> = {
  AR: { code: '1210', name_en: 'Trade Accounts Receivable — Control', name_bn: 'বাণিজ্যিক প্রাপ্য হিসাব — নিয়ন্ত্রণ' },
  AP: { code: '2110', name_en: 'Trade Accounts Payable — Control', name_bn: 'বাণিজ্যিক প্রদেয় হিসাব — নিয়ন্ত্রণ' },
  OUTPUT_VAT: { code: '2120', name_en: 'Output VAT Payable', name_bn: 'আউটপুট ভ্যাট প্রদেয়' },
  INPUT_VAT: { code: '1140', name_en: 'VAT Current Account — Mushak 9.1 Note 18', name_bn: 'ভ্যাট চলতি হিসাব — মূসক ৯.১ নোট ১৮' },
  VDS_RECEIVABLE: { code: '1145', name_en: 'VDS Receivable — Customer Mushak 6.6 Pending', name_bn: 'ভিডিএস প্রাপ্য — গ্রাহক মূসক ৬.৬ অপেক্ষমাণ' },
  AIT_RECEIVABLE: { code: '1150', name_en: 'Advance Income Tax (AIT / Customer TDS Credit)', name_bn: 'অগ্রিম আয়কর (এআইটি / গ্রাহক টিডিএস ক্রেডিট)' },
  VDS_PAYABLE: { code: '2130', name_en: 'VDS Withheld Payable to Treasury (Mushak 6.6)', name_bn: 'কোষাগারে প্রদেয় কর্তিত ভিডিএস (মূসক ৬.৬)' },
  TDS_PAYABLE: { code: '2140', name_en: 'TDS Withheld Payable to Treasury', name_bn: 'কোষাগারে প্রদেয় কর্তিত টিডিএস' },
  REVERSE_CHARGE_VAT: { code: '2150', name_en: 'Reverse Charge VAT Payable (Imported Services)', name_bn: 'রিভার্স চার্জ ভ্যাট প্রদেয় (আমদানি সেবা)' },
  REVENUE_STANDARD: { code: '4100', name_en: 'Revenue from Sale of Goods — Local Standard 15%', name_bn: 'পণ্য বিক্রয় আয় — স্থানীয় আদর্শ ১৫%' },
  REVENUE_CONTRACT: { code: '4110', name_en: 'Revenue from Corporate Contracts (VDS Applicable)', name_bn: 'কর্পোরেট চুক্তি আয় (ভিডিএস প্রযোজ্য)' },
  REVENUE_EXPORT: { code: '4120', name_en: 'Export & Zero-Rated Service Revenue', name_bn: 'রপ্তানি ও শূন্য-হার সেবা আয়' },
  COST_OF_SALES: { code: '5100', name_en: 'Cost of Goods Sold (COGS) & Disallowed Input VAT', name_bn: 'বিক্রীত পণ্যের ব্যয় (সিওজিএস) ও বাতিল ইনপুট ভ্যাট' },
  INVENTORY: { code: '1310', name_en: 'Merchandise Inventory — Control', name_bn: 'পণ্যসামগ্রী মজুদ — নিয়ন্ত্রণ' },
  BANK: { code: '1110', name_en: 'City Bank Corporate Current A/C', name_bn: 'সিটি ব্যাংক কর্পোরেট চলতি হিসাব' },
  MFS: { code: '1120', name_en: 'bKash Merchant Settlement Wallet', name_bn: 'বিকাশ মার্চেন্ট সেটেলমেন্ট ওয়ালেট' },
  PETTY_CASH: { code: '1130', name_en: 'Petty Cash Imprest — Dhaka HQ', name_bn: 'ক্ষুদ্র নগদ ইমপ্রেস — ঢাকা প্রধান কার্যালয়' },
};

function settlementAccount(paymentMethod: PaymentMethod): PreviewAccount {
  switch (paymentMethod) {
    case 'MFS':
      return PREVIEW_ACCOUNTS.MFS;
    case 'CASH':
      return PREVIEW_ACCOUNTS.PETTY_CASH;
    case 'BANK':
    case 'CHEQUE':
    case 'CREDIT_CARD':
    default:
      return PREVIEW_ACCOUNTS.BANK;
  }
}

// ---------------------------------------------------------------------------------------------
// Condition construction
// ---------------------------------------------------------------------------------------------

type ConditionSeverity = TaxCondition['severity'];

interface ConditionSpec {
  code: string;
  satisfied: boolean;
  severity: ConditionSeverity;
  message_en: string;
  message_bn: string;
  evidence_required?: string;
}

function makeCondition(spec: ConditionSpec): TaxCondition {
  return {
    code: spec.code,
    satisfied: spec.satisfied,
    severity: spec.severity,
    message_en: spec.message_en,
    message_bn: spec.message_bn,
    ...(spec.evidence_required ? { evidence_required: spec.evidence_required } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

export function evaluateTaxDecision(
  input: TaxEvaluationInput,
  options: TaxEngineOptions = {},
): TaxDecisionDetail {
  const pack = options.rulePack ?? BD_2026_V1;
  const evaluatedAt = options.evaluatedAt ?? isoNow();

  const conditions: TaxCondition[] = [];
  const ruleIds: string[] = [];

  const addRule = (ruleId?: string | null): void => {
    if (!ruleId) return;
    if (!ruleIds.includes(ruleId) && getRule(ruleId, pack)) ruleIds.push(ruleId);
  };
  const addCondition = (spec: ConditionSpec): void => {
    conditions.push(makeCondition(spec));
  };

  const sign = input.is_credit_note ? -1n : 1n;
  const magnitudeBase = input.base_poisha < 0n ? -input.base_poisha : input.base_poisha;
  const invalidBase = magnitudeBase === 0n;

  const rawCategory = input.tax_category;
  const isReverseCharge = Boolean(input.is_reverse_charge) || rawCategory === 'REVERSE_CHARGE';
  const category: TaxCategory = isReverseCharge ? 'REVERSE_CHARGE' : rawCategory;
  const outOfScope = !isReverseCharge && category === 'OUT_OF_SCOPE';
  const direction = input.direction;

  const binValid = isValidBin(input.party_bin);
  const tinValid = isValidTin(input.party_tin);

  if (invalidBase) {
    addCondition({
      code: 'INVALID_BASE',
      satisfied: false,
      severity: 'BLOCKER',
      message_en: 'The taxable base is zero. Nothing can be posted or taxed from an empty value.',
      message_bn: 'করযোগ্য ভিত্তি শূন্য। শূন্য থেকে কোনো হিসাব বা কর নির্ধারণ করা যায় না।',
      evidence_required: 'A positive base amount or a Mushak 6.7 credit note against an existing invoice.',
    });
  }

  const sourceDisputed = Boolean(input.rule_pack_version) && input.rule_pack_version !== pack.version;
  if (sourceDisputed) {
    addCondition({
      code: 'RULE_PACK_VERSION_MISMATCH',
      satisfied: false,
      severity: 'BLOCKER',
      message_en: `The document was prepared against rule pack ${String(input.rule_pack_version)} but the active pack is ${pack.version}. Re-evaluate before posting.`,
      message_bn: `নথিটি রুল প্যাক ${String(input.rule_pack_version)} অনুযায়ী প্রস্তুত, কিন্তু সক্রিয় প্যাক ${pack.version}। পোস্ট করার আগে পুনঃমূল্যায়ন করুন।`,
      evidence_required: 'Rule pack change log and tax-counsel sign-off.',
    });
  }

  // ---- VAT ---------------------------------------------------------------------------------
  const vatBps = isReverseCharge ? REVERSE_CHARGE_VAT_BPS : VAT_RATE_BPS_BY_CATEGORY[category];
  const vatRuleId = isReverseCharge ? RULE_IDS.VAT_REVERSE_CHARGE_S20 : VAT_RULE_ID_BY_CATEGORY[category];

  if (outOfScope) {
    addCondition({
      code: 'OUT_OF_SCOPE_SCENARIO',
      satisfied: false,
      severity: 'BLOCKER',
      message_en:
        'This transaction does not match a supported VAT scenario. It is routed to MANUAL_REVIEW and cannot be posted to the statutory book.',
      message_bn:
        'এই লেনদেন সমর্থিত কোনো ভ্যাট দৃশ্যপটের সাথে মেলে না। এটি ম্যানুয়াল রিভিউতে পাঠানো হয়েছে এবং বিধিবদ্ধ খাতায় পোস্ট করা যাবে না।',
      evidence_required: 'Designated tax reviewer sign-off with the applicable statutory clause.',
    });
  } else {
    addRule(vatRuleId);
  }

  const sdRequested = Boolean(input.sd_applicable);
  const sdEligible = sdRequested && !isReverseCharge && category === 'STANDARD_15';
  const sdBps = sdEligible ? SD_RATE_BPS : 0;
  const sdPositive = applyRateBps(magnitudeBase, sdBps);

  if (sdEligible) {
    addRule(RULE_IDS.SD_SECOND_SCHEDULE_STD);
    addCondition({
      code: 'SUPPLEMENTARY_DUTY_APPLIED',
      satisfied: true,
      severity: 'INFO',
      message_en: `Supplementary duty at ${bpsToPercent(sdBps)} is charged on the base value; VAT is then computed on base + SD.`,
      message_bn: `ভিত্তি মূল্যের ওপর ${bpsToPercent(sdBps)} সম্পূরক শুল্ক প্রযোজ্য; এরপর ভিত্তি + এসডিতে ভ্যাট গণনা হয়।`,
      evidence_required: 'Second Schedule entry for the product.',
    });
  } else if (sdRequested) {
    addCondition({
      code: 'SUPPLEMENTARY_DUTY_NOT_APPLICABLE',
      satisfied: true,
      severity: 'INFO',
      message_en: 'Supplementary duty applies only to Second Schedule goods under the standard VAT category; none was charged.',
      message_bn: 'সম্পূরক শুল্ক কেবল আদর্শ ভ্যাট শ্রেণির দ্বিতীয় তফসিলভুক্ত পণ্যে প্রযোজ্য; কিছু ধার্য হয়নি।',
    });
  }

  const vatBasePositive = isReverseCharge ? magnitudeBase : magnitudeBase + sdPositive;
  const vatPositive = applyRateBps(vatBasePositive, vatBps);
  const grossPositive = isReverseCharge ? magnitudeBase + sdPositive : vatBasePositive + vatPositive;

  if (!isReverseCharge && (category === 'TRADING_5' || category === 'PROCUREMENT_7_5')) {
    addCondition({
      code: 'TRUNCATED_VAT_RATE',
      satisfied: false,
      severity: 'WARNING',
      message_en: `The supply is taxed at ${bpsToPercent(vatBps)}, below the 15% standard rate. s.46 therefore denies input-VAT credit on the associated inputs.`,
      message_bn: `সরবরাহে ${bpsToPercent(vatBps)} কর প্রয়োগ হয়েছে, যা ১৫% আদর্শ হারের নিচে। তাই ধারা ৪৬ অনুযায়ী সংশ্লিষ্ট ইনপুটে ইনপুট ভ্যাট ক্রেডিট বাতিল।`,
      evidence_required: 'Third Schedule applicability note for the truncated rate.',
    });
  }

  if (category === 'EXEMPT') {
    addCondition({
      code: 'EXEMPT_SUPPLY',
      satisfied: true,
      severity: 'INFO',
      message_en: 'Exempt First Schedule supply: no VAT is charged and no input VAT is creditable on directly attributable inputs.',
      message_bn: 'প্রথম তফসিলভুক্ত শুল্কমুক্ত সরবরাহ: কোনো ভ্যাট ধার্য হয় না এবং সরাসরি সংশ্লিষ্ট ইনপুটে ইনপুট ভ্যাট সমন্বয়যোগ্য নয়।',
    });
  }

  // ---- Evidence: BIN and Mushak 6.3 --------------------------------------------------------
  const vatBearingCategory =
    category === 'STANDARD_15' || category === 'TRADING_5' || category === 'PROCUREMENT_7_5';

  if (vatBearingCategory) {
    addRule(RULE_IDS.BIN_FORMAT_THIRTEEN_DIGITS);
    if (binValid) {
      addCondition({
        code: 'BIN_VALID',
        satisfied: true,
        severity: 'INFO',
        message_en: 'The counterparty BIN is a valid 13-digit registration.',
        message_bn: 'প্রতিপক্ষের বিআইএন বৈধ ১৩ অঙ্কের নিবন্ধন।',
      });
    } else {
      addCondition({
        code: 'BIN_MISSING_OR_INVALID',
        satisfied: false,
        severity: 'WARNING',
        message_en:
          'The counterparty BIN is missing or is not a valid 13-digit registration. Input-VAT credit is blocked under s.46 and the Mushak 6.3 evidence is incomplete.',
        message_bn:
          'প্রতিপক্ষের বিআইএন অনুপস্থিত বা বৈধ ১৩ অঙ্কের নিবন্ধন নয়। ধারা ৪৬ অনুযায়ী ইনপুট ভ্যাট ক্রেডিট বন্ধ এবং মূসক ৬.৩ প্রমাণ অসম্পূর্ণ।',
        evidence_required: 'Valid 13-digit BIN (9-digit business identifier + 4-digit branch).',
      });
    }

    if (input.has_valid_mushak63) {
      addCondition({
        code: 'MUSHAK_6_3_PRESENT',
        satisfied: true,
        severity: 'INFO',
        message_en: 'A valid Mushak 6.3 tax invoice is attached to the transaction.',
        message_bn: 'লেনদেনের সাথে বৈধ মূসক ৬.৩ কর চালানপত্র সংযুক্ত আছে।',
      });
    } else {
      addCondition({
        code: 'MUSHAK_6_3_MISSING',
        satisfied: false,
        severity: 'WARNING',
        message_en:
          'No valid Mushak 6.3 tax invoice is attached. Input-VAT credit is blocked until the statutory evidence is complete.',
        message_bn:
          'বৈধ মূসক ৬.৩ কর চালানপত্র সংযুক্ত নেই। বিধিবদ্ধ প্রমাণ সম্পূর্ণ না হলে ইনপুট ভ্যাট ক্রেডিট বন্ধ থাকবে।',
        evidence_required: 'Mushak 6.3 serial, issue date and supplier BIN.',
      });
    }
  }

  // ---- Cash-payment limit ------------------------------------------------------------------
  const isCash = input.payment_method === 'CASH';
  const cashBreach = isCash && grossPositive > CASH_DISALLOWANCE_LIMIT_POISHA;
  if (direction === 'PURCHASE' && isCash) {
    addRule(RULE_IDS.CASH_DISALLOWANCE_LIMIT_1_LAKH);
    if (cashBreach) {
      addCondition({
        code: 'CASH_LIMIT_BREACH',
        satisfied: false,
        severity: 'WARNING',
        message_en: `A cash settlement of ${formatPoisha(grossPositive, { locale: 'en-BD' })} exceeds the ${formatPoisha(CASH_DISALLOWANCE_LIMIT_POISHA, { locale: 'en-BD' })} limit; the input-VAT rebate is disallowed under s.46.`,
        message_bn: `${formatPoisha(grossPositive, { locale: 'bn-BD' })} নগদ পরিশোধ ${formatPoisha(CASH_DISALLOWANCE_LIMIT_POISHA, { locale: 'bn-BD' })} সীমা ছাড়িয়েছে; ধারা ৪৬ অনুযায়ী ইনপুট ভ্যাট রিবেট বাতিল।`,
        evidence_required: 'Bank, MFS or cheque settlement evidence.',
      });
    } else {
      addCondition({
        code: 'CASH_LIMIT_OK',
        satisfied: true,
        severity: 'INFO',
        message_en: 'The cash settlement is within the BDT 1,00,000 limit.',
        message_bn: 'নগদ পরিশোধ ১,০০,০০০ টাকার সীমার মধ্যে আছে।',
      });
    }
  }

  // ---- VDS (s.49) --------------------------------------------------------------------------
  const vdsCategoryEligible =
    !isReverseCharge && (category === 'STANDARD_15' || category === 'TRADING_5' || category === 'PROCUREMENT_7_5');
  let vdsBps = 0;
  let vdsPositive = 0n;

  if (input.vds_applicable) {
    if (!vdsCategoryEligible) {
      addCondition({
        code: 'VDS_NOT_APPLICABLE',
        satisfied: true,
        severity: 'INFO',
        message_en: `VDS does not apply to a ${category} supply because there is no VAT to withhold at source.`,
        message_bn: `${category} সরবরাহে উৎসে কর্তনযোগ্য ভ্যাট নেই, তাই ভিডিএস প্রযোজ্য নয়।`,
      });
    } else if (!input.is_withholding_entity) {
      addCondition({
        code: 'VDS_WAIVED_NOT_WITHHOLDING_ENTITY',
        satisfied: true,
        severity: 'INFO',
        message_en: 'VDS was requested but the payer is not a designated withholding entity, so nothing is deducted at source.',
        message_bn: 'ভিডিএস অনুরোধ করা হয়েছে, তবে পরিশোধকারী মনোনীত উৎসে কর্তনকারী নয়, তাই উৎসে কিছু কর্তন হয়নি।',
      });
    } else {
      const requestedRate = input.vds_rate_bps;
      const rateValid =
        requestedRate === undefined ||
        (Number.isFinite(requestedRate) &&
          Number.isInteger(requestedRate) &&
          requestedRate >= 0 &&
          requestedRate <= 10000);
      if (!rateValid) {
        addCondition({
          code: 'VDS_RATE_OUT_OF_RANGE',
          satisfied: false,
          severity: 'BLOCKER',
          message_en: 'The VDS rate supplied is outside the 0–10,000 basis-point range and cannot be applied.',
          message_bn: 'প্রদত্ত ভিডিএস হার ০–১০,০০০ বেসিস পয়েন্টের সীমার বাইরে, প্রয়োগ করা সম্ভব নয়।',
          evidence_required: 'Statutory VDS rate from the VDS Rules.',
        });
      } else {
        vdsBps = requestedRate ?? VDS_RATE_BPS_BY_CATEGORY[category];
        vdsPositive = applyRateBps(magnitudeBase, vdsBps);
        addRule(RULE_IDS.VDS_WITHHOLDING_S49);
        addRule(RULE_IDS.VDS_CERTIFICATE_MUSHAK_66);
        addCondition({
          code: 'VDS_APPLIED',
          satisfied: true,
          severity: 'INFO',
          message_en: `VDS of ${formatPoisha(vdsPositive, { locale: 'en-BD' })} at ${bpsToPercent(vdsBps)} is withheld from the counterparty and queued for a Treasury challan with a Mushak 6.6 certificate.`,
          message_bn: `${bpsToPercent(vdsBps)} হারে ${formatPoisha(vdsPositive, { locale: 'bn-BD' })} ভিডিএস প্রতিপক্ষ থেকে কর্তন করে মূসক ৬.৬ সনদসহ ট্রেজারি চালানের কিউতে রাখা হয়েছে।`,
          evidence_required: 'Mushak 6.6 certificate and Treasury challan.',
        });
      }
    }
  }

  // ---- TDS (Income Tax Act 2023) -----------------------------------------------------------
  let tdsBps = 0;
  let tdsPositive = 0n;

  if (input.tds_nature !== 'NONE') {
    addRule(RULE_IDS.ETIN_FORMAT_TWELVE_DIGITS);
    if (!input.is_withholding_entity) {
      addCondition({
        code: 'TDS_WAIVED_NOT_WITHHOLDING_ENTITY',
        satisfied: true,
        severity: 'INFO',
        message_en: 'TDS was requested but the payer is not a designated withholding entity, so nothing is deducted at source.',
        message_bn: 'টিডিএস অনুরোধ করা হয়েছে, তবে পরিশোধকারী মনোনীত উৎসে কর্তনকারী নয়, তাই উৎসে কিছু কর্তন হয়নি।',
      });
    } else {
      const baseRate = TDS_RATE_BPS_BY_NATURE[input.tds_nature];
      tdsBps = tinValid
        ? baseRate
        : Math.round((baseRate * (10000 + TDS_NO_TIN_UPSCALE_BPS)) / 10000);
      tdsPositive = applyRateBps(magnitudeBase, tdsBps);
      addRule(TDS_RULE_ID_BY_NATURE[input.tds_nature]);
      addCondition({
        code: 'TDS_APPLIED',
        satisfied: true,
        severity: 'INFO',
        message_en: `TDS of ${formatPoisha(tdsPositive, { locale: 'en-BD' })} at ${bpsToPercent(tdsBps)} is deducted on the base value (never on VAT) and queued for the Treasury.`,
        message_bn: `ভিত্তি মূল্যের ওপর (ভ্যাটের ওপর নয়) ${bpsToPercent(tdsBps)} হারে ${formatPoisha(tdsPositive, { locale: 'bn-BD' })} টিডিএস কর্তন করে কোষাগারের কিউতে রাখা হয়েছে।`,
        evidence_required: 'Withholding statement and Treasury challan.',
      });
      if (!tinValid) {
        addRule(RULE_IDS.TDS_NO_TIN_PENALTY_50);
        addCondition({
          code: 'TIN_MISSING',
          satisfied: false,
          severity: 'WARNING',
          message_en: `No valid 12-digit e-TIN is on file, so the statutory TDS rate was upscaled by 50% from ${bpsToPercent(baseRate)} to ${bpsToPercent(tdsBps)}.`,
          message_bn: `বৈধ ১২ অঙ্কের ই-টিআইএন সংরক্ষিত নেই, তাই বিধিবদ্ধ টিডিএস হার ৫০% বাড়িয়ে ${bpsToPercent(baseRate)} থেকে ${bpsToPercent(tdsBps)} করা হয়েছে।`,
          evidence_required: 'Supplier 12-digit e-TIN certificate.',
        });
      }
    }
  }

  // ---- Input VAT credit (purchases only) ---------------------------------------------------
  const reasonCodes: string[] = [];
  const reasonLabelsEn: string[] = [];
  const reasonLabelsBn: string[] = [];
  const creditRuleIds: string[] = [];
  let claimablePositive = 0n;
  let disallowedPositive = 0n;

  if (direction === 'PURCHASE') {
    addRule(RULE_IDS.S46_REBATE_GUARD);
    creditRuleIds.push(RULE_IDS.S46_REBATE_GUARD);
    let eligible = vatPositive > 0n;

    const block = (code: string, labelEn: string, labelBn: string, ruleId?: string): void => {
      eligible = false;
      if (!reasonCodes.includes(code)) {
        reasonCodes.push(code);
        reasonLabelsEn.push(labelEn);
        reasonLabelsBn.push(labelBn);
      }
      if (ruleId) {
        addRule(ruleId);
        if (!creditRuleIds.includes(ruleId)) creditRuleIds.push(ruleId);
      }
    };

    if (category === 'EXEMPT') {
      block(
        'EXEMPT_INPUT',
        'Input VAT attributable to an exempt supply is not creditable.',
        'শুল্কমুক্ত সরবরাহের সাথে সম্পর্কিত ইনপুট ভ্যাট সমন্বয়যোগ্য নয়।',
        RULE_IDS.VAT_EXEMPT,
      );
    }
    if (category === 'TRADING_5' || category === 'PROCUREMENT_7_5') {
      block(
        'TRUNCATED_RATE',
        `The supply is taxed at ${bpsToPercent(vatBps)}, so s.46 denies the input-VAT rebate.`,
        `সরবরাহে ${bpsToPercent(vatBps)} কর প্রয়োগ হয়েছে, তাই ধারা ৪৬ ইনপুট ভ্যাট রিবেট বাতিল করে।`,
        RULE_IDS.S46_REBATE_GUARD,
      );
    }

    if (isReverseCharge) {
      if (input.has_reverse_charge_challan) {
        addCondition({
          code: 'REVERSE_CHARGE_CHALLAN_VERIFIED',
          satisfied: true,
          severity: 'INFO',
          message_en: 'The reverse-charge Treasury challan is held, so the self-assessed VAT is creditable.',
          message_bn: 'রিভার্স-চার্জ ট্রেজারি চালান সংরক্ষিত আছে, তাই স্ব-নির্ধারিত ভ্যাট সমন্বয়যোগ্য।',
          evidence_required: 'Treasury challan reference.',
        });
      } else {
        block(
          'REVERSE_CHARGE_CHALLAN_MISSING',
          'Reverse-charge VAT needs a Treasury challan reference before it can be credited.',
          'রিভার্স-চার্জ ভ্যাট সমন্বয়ের আগে ট্রেজারি চালানের রেফারেন্স প্রয়োজন।',
          RULE_IDS.S46_REBATE_GUARD,
        );
        addCondition({
          code: 'REVERSE_CHARGE_CHALLAN_MISSING',
          satisfied: false,
          severity: 'WARNING',
          message_en: 'No reverse-charge challan is held yet; the self-assessed VAT stays conditional until it is deposited.',
          message_bn: 'রিভার্স-চার্জ চালান এখনো সংরক্ষিত নেই; জমা না হওয়া পর্যন্ত স্ব-নির্ধারিত ভ্যাট শর্তসাপেক্ষ থাকবে।',
          evidence_required: 'Treasury challan reference for the imported service.',
        });
      }
    } else if (category === 'STANDARD_15' || category === 'EXPORT_ZERO') {
      if (!binValid) {
        block(
          'BIN_INVALID',
          'Supplier BIN is missing or invalid — input rebate blocked under s.46.',
          'সরবরাহকারীর বিআইএন অনুপস্থিত বা ভুল — ধারা ৪৬ অনুযায়ী ইনপুট রিবেট বন্ধ।',
          RULE_IDS.BIN_FORMAT_THIRTEEN_DIGITS,
        );
      }
      if (!input.has_valid_mushak63) {
        block(
          'MISSING_MUSHAK_6_3',
          'No valid Mushak 6.3 tax invoice is attached — input rebate blocked.',
          'বৈধ মূসক ৬.৩ কর চালানপত্র সংযুক্ত নেই — ইনপুট রিবেট বন্ধ।',
          RULE_IDS.S46_REBATE_GUARD,
        );
      }
      if (cashBreach) {
        block(
          'CASH_LIMIT_BREACH',
          'Cash payment exceeds BDT 1,00,000 — input rebate disallowed under s.46.',
          'নগদ পরিশোধ ১,০০,০০০ টাকা ছাড়িয়েছে — ধারা ৪৬ অনুযায়ী ইনপুট রিবেট বাতিল।',
          RULE_IDS.CASH_DISALLOWANCE_LIMIT_1_LAKH,
        );
      }
    }

    claimablePositive = eligible && reasonCodes.length === 0 ? vatPositive : 0n;
    disallowedPositive = vatPositive - claimablePositive;

    if (vatPositive === 0n) {
      addCondition({
        code: 'NO_INPUT_VAT',
        satisfied: true,
        severity: 'INFO',
        message_en: 'This purchase carries no VAT, so there is nothing to credit.',
        message_bn: 'এই ক্রয়ে কোনো ভ্যাট নেই, তাই সমন্বয় করার কিছু নেই।',
      });
    } else if (claimablePositive > 0n) {
      addCondition({
        code: 'INPUT_CREDIT_ELIGIBLE',
        satisfied: true,
        severity: 'INFO',
        message_en: `${formatPoisha(claimablePositive, { locale: 'en-BD' })} of input VAT is claimable in the VAT Current Account.`,
        message_bn: `${formatPoisha(claimablePositive, { locale: 'bn-BD' })} ইনপুট ভ্যাট ভ্যাট চলতি হিসাবে দাবিযোগ্য।`,
        evidence_required: 'Mushak 6.1 purchase register entry.',
      });
    } else {
      addCondition({
        code: 'INPUT_CREDIT_BLOCKED',
        satisfied: false,
        severity: 'INFO',
        message_en: `${formatPoisha(disallowedPositive, { locale: 'en-BD' })} of input VAT is disallowed and capitalised into cost or inventory.`,
        message_bn: `${formatPoisha(disallowedPositive, { locale: 'bn-BD' })} ইনপুট ভ্যাট বাতিল হয়ে ব্যয় বা মজুদে মূলধনায়িত হয়েছে।`,
      });
      addRule(RULE_IDS.VAT_DISALLOWANCE_CAPITALISATION);
      creditRuleIds.push(RULE_IDS.VAT_DISALLOWANCE_CAPITALISATION);
    }
  }

  // ---- Filing calendar ---------------------------------------------------------------------
  let filing: FilingDecision | undefined;
  if (input.period_end_date) {
    filing = filingDecisionFor({
      periodEndDate: input.period_end_date,
      isGovernmentOrBank: input.is_government_or_bank,
      isNilReturn: input.is_nil_return,
      pack,
    });
    addRule(RULE_IDS.VAT_FILING_S64_ORD38_2026);
    addCondition({
      code: 'FILING_DEADLINE',
      satisfied: true,
      severity: 'INFO',
      message_en: `${filing.explanation_en}`,
      message_bn: `${filing.explanation_bn}`,
    });
  }

  // ---- Signed amounts ----------------------------------------------------------------------
  const base = sign * magnitudeBase;
  const sd = sign * sdPositive;
  const vat = sign * vatPositive;
  const gross = sign * grossPositive;
  const vds = sign * vdsPositive;
  const tds = sign * tdsPositive;
  const withheld = vds + tds;
  const netPayable = gross - withheld;
  const reverseChargeVat = isReverseCharge ? vat : 0n;
  const treasury = withheld + reverseChargeVat;
  const claimable = sign * claimablePositive;
  const disallowed = sign * disallowedPositive;

  const decisionState = resolveDecisionState(invalidBase, sourceDisputed, outOfScope, conditions);

  const inputCredit: InputCreditOutcome = {
    eligible: direction === 'PURCHASE' && claimablePositive > 0n,
    claimable_poisha: claimable,
    disallowed_poisha: disallowed,
    reasons: reasonCodes,
    reason_labels_en: reasonLabelsEn,
    reason_labels_bn: reasonLabelsBn,
    rule_ids: Array.from(new Set(creditRuleIds)),
  };

  const citations: string[] = [];
  for (const ruleId of ruleIds) {
    const rule = getRule(ruleId, pack);
    if (rule && !citations.includes(rule.citation)) citations.push(rule.citation);
  }

  const explanationsEn: string[] = [];
  const explanationsBn: string[] = [];
  const explain = (en: string, bn: string): void => {
    explanationsEn.push(en);
    explanationsBn.push(bn);
  };

  if (sign < 0n) {
    explain(
      'Mushak 6.7 credit note: every amount below reverses the original invoice while the rates stay unchanged.',
      'মূসক ৬.৭ ক্রেডিট নোট: নিচের প্রতিটি অঙ্ক মূল চালানপত্রের বিপরীত, হার অপরিবর্তিত থাকে।',
    );
  }

  if (outOfScope) {
    explain(
      'The scenario is outside the supported VAT set, so no rate was guessed and the decision is MANUAL_REVIEW.',
      'দৃশ্যপটটি সমর্থিত ভ্যাট সেটের বাইরে, তাই কোনো হার অনুমান করা হয়নি এবং সিদ্ধান্ত ম্যানুয়াল রিভিউ।',
    );
  } else if (isReverseCharge) {
    explain(
      `Reverse-charge VAT at ${bpsToPercent(vatBps)} is self-assessed on ${formatPoisha(vat, { locale: 'en-BD' })}; the foreign supplier is paid the base only and the VAT is deposited by Treasury challan.`,
      `${bpsToPercent(vatBps)} হারে রিভার্স-চার্জ ভ্যাট ${formatPoisha(vat, { locale: 'bn-BD' })} স্ব-নির্ধারিত; বিদেশি সরবরাহকারীকে কেবল ভিত্তি মূল্য পরিশোধ করা হয় এবং ভ্যাট ট্রেজারি চালানে জমা হয়।`,
    );
  } else if (vatBps > 0) {
    explain(
      `VAT at ${bpsToPercent(vatBps)} on the taxable value ${formatPoisha(sign * vatBasePositive, { locale: 'en-BD' })} = ${formatPoisha(vat, { locale: 'en-BD' })}.`,
      `${bpsToPercent(vatBps)} হারে করযোগ্য মূল্য ${formatPoisha(sign * vatBasePositive, { locale: 'bn-BD' })}-এর ওপর ভ্যাট = ${formatPoisha(vat, { locale: 'bn-BD' })}।`,
    );
  } else {
    explain(
      `${category === 'EXEMPT' ? 'Exempt supply' : category === 'EXPORT_ZERO' ? 'Zero-rated export' : 'Out-of-scope supply'}: output VAT is 0.00%.`,
      `${category === 'EXEMPT' ? 'শুল্কমুক্ত সরবরাহ' : category === 'EXPORT_ZERO' ? 'শূন্য-হার রপ্তানি' : 'পরিধির বাইরের সরবরাহ'}: আউটপুট ভ্যাট ০.০০%।`,
    );
  }

  if (sdEligible) {
    explain(
      `Supplementary duty at ${bpsToPercent(sdBps)} = ${formatPoisha(sd, { locale: 'en-BD' })}, and VAT is charged on base + SD.`,
      `${bpsToPercent(sdBps)} সম্পূরক শুল্ক = ${formatPoisha(sd, { locale: 'bn-BD' })}, এবং ভ্যাট ভিত্তি + এসডির ওপর ধার্য হয়।`,
    );
  }

  if (vdsPositive > 0n) {
    explain(
      `VDS ${formatPoisha(vds, { locale: 'en-BD' })} at ${bpsToPercent(vdsBps)} is withheld from the counterparty payment and deposited with the Treasury against a Mushak 6.6 certificate.`,
      `${bpsToPercent(vdsBps)} হারে ${formatPoisha(vds, { locale: 'bn-BD' })} ভিডিএস প্রতিপক্ষের পরিশোধ থেকে কর্তন করে মূসক ৬.৬ সনদের বিপরীতে কোষাগারে জমা হবে।`,
    );
  }

  if (tdsPositive > 0n) {
    explain(
      `TDS ${formatPoisha(tds, { locale: 'en-BD' })} at ${bpsToPercent(tdsBps)} is deducted on the base value, never on VAT.`,
      `ভিত্তি মূল্যের ওপর ${bpsToPercent(tdsBps)} হারে ${formatPoisha(tds, { locale: 'bn-BD' })} টিডিএস কর্তন, ভ্যাটের ওপর নয়।`,
    );
  }

  if (direction === 'PURCHASE') {
    if (claimablePositive > 0n) {
      explain(
        `Input VAT ${formatPoisha(claimable, { locale: 'en-BD' })} satisfies s.46 and is claimable; disallowed VAT is ${formatPoisha(disallowed, { locale: 'en-BD' })}.`,
        `ইনপুট ভ্যাট ${formatPoisha(claimable, { locale: 'bn-BD' })} ধারা ৪৬ পূরণ করে দাবিযোগ্য; বাতিল ভ্যাট ${formatPoisha(disallowed, { locale: 'bn-BD' })}।`,
      );
    } else if (vatPositive > 0n) {
      explain(
        `Input VAT ${formatPoisha(disallowed, { locale: 'en-BD' })} is disallowed (${reasonCodes.length > 0 ? reasonCodes.join(', ') : 'no eligible credit'}) and is capitalised into the cost of the purchase.`,
        `ইনপুট ভ্যাট ${formatPoisha(disallowed, { locale: 'bn-BD' })} বাতিল (${reasonCodes.length > 0 ? reasonCodes.join(', ') : 'যোগ্য ক্রেডিট নেই'}) এবং ক্রয়ের ব্যয়ে মূলধনায়িত।`,
      );
    }
  }

  explain(
    `Gross invoice ${formatPoisha(gross, { locale: 'en-BD' })}, net payable to the counterparty ${formatPoisha(netPayable, { locale: 'en-BD' })}, payable to the Government Treasury ${formatPoisha(treasury, { locale: 'en-BD' })}.`,
    `মোট চালান ${formatPoisha(gross, { locale: 'bn-BD' })}, প্রতিপক্ষকে নিট প্রদেয় ${formatPoisha(netPayable, { locale: 'bn-BD' })}, সরকারি কোষাগারে প্রদেয় ${formatPoisha(treasury, { locale: 'bn-BD' })}।`,
  );

  if (filing) {
    explain(filing.explanation_en, filing.explanation_bn);
  }

  return {
    trace_id: taxTraceId(input, pack.version),
    decision: decisionState,
    direction,
    base_poisha: base,
    sd_bps: sdBps,
    sd_poisha: sd,
    vat_bps: outOfScope ? 0 : vatBps,
    vat_poisha: vat,
    gross_poisha: gross,
    vds_bps: vdsBps,
    vds_poisha: vds,
    tds_bps: tdsBps,
    tds_poisha: tds,
    net_payable_poisha: netPayable,
    treasury_payable_poisha: treasury,
    input_credit: inputCredit,
    conditions,
    rule_ids: ruleIds,
    citations,
    explanations_en: explanationsEn,
    explanations_bn: explanationsBn,
    rule_pack_version: pack.version,
    evaluated_at: evaluatedAt,
    ...(filing ? { filing } : {}),
    category: rawCategory,
    effective_category: category,
    is_reverse_charge: isReverseCharge,
    bin_valid: binValid,
    tin_valid: tinValid,
    reverse_charge_vat_poisha: reverseChargeVat,
    withheld_total_poisha: withheld,
    cash_limit_poisha: CASH_DISALLOWANCE_LIMIT_POISHA,
  };
}

const DECISION_PRIORITY: Record<DecisionState, number> = {
  SUPPORTED: 0,
  SUPPORTED_WITH_CONDITIONS: 1,
  MANUAL_REVIEW: 2,
  SOURCE_DISPUTED_OR_EXPIRED: 3,
  NOT_SUPPORTED: 4,
};

function worstDecision(states: readonly DecisionState[]): DecisionState {
  return states.reduce<DecisionState>(
    (worst, state) => (DECISION_PRIORITY[state] > DECISION_PRIORITY[worst] ? state : worst),
    'SUPPORTED',
  );
}

function commonRate(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.every((value) => value === values[0]) ? values[0] : 0;
}

function uniqueConditions(conditions: readonly TaxCondition[]): TaxCondition[] {
  const seen = new Set<string>();
  const result: TaxCondition[] = [];
  for (const condition of conditions) {
    const key = `${condition.code}|${condition.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(condition);
  }
  return result;
}

/**
 * Evaluate every line on its own `tax_category`, then aggregate into one document summary.
 *
 * This is the posting-critical rule: a mixed-rate invoice can never be taxed by silently applying
 * one header rate to the grand total. Line rounding is authoritative; the document totals are the
 * exact sum of the line decisions, so they foot without a hidden rounding plug.
 */
export function evaluateDocumentTax(
  request: DocumentTaxRequest,
  options: TaxEngineOptions = {},
): DocumentTaxSummary {
  const { lines, fallback_tax_category, ...documentInput } = request;
  const evaluatedAt = options.evaluatedAt ?? isoNow();
  const lineOptions = { ...options, evaluatedAt };
  const decisions: DocumentTaxLineDecision[] = [];

  for (const [index, line] of lines.entries()) {
    const basePoisha = lineTaxBasePoisha(line);
    if (basePoisha === 0n) continue;
    const input: TaxEvaluationInput = {
      ...documentInput,
      base_poisha: basePoisha,
      tax_category: line.tax_category,
    };
    const decision = evaluateTaxDecision(input, lineOptions);
    decisions.push({
      line_id: line.id ?? `L${index + 1}`,
      sku: line.sku ?? '',
      tax_category: line.tax_category,
      base_poisha: decision.base_poisha,
      sd_poisha: decision.sd_poisha,
      vat_poisha: decision.vat_poisha,
      gross_poisha: decision.gross_poisha,
      vds_poisha: decision.vds_poisha,
      tds_poisha: decision.tds_poisha,
      net_payable_poisha: decision.net_payable_poisha,
      claimable_poisha: decision.input_credit.claimable_poisha,
      disallowed_poisha: decision.input_credit.disallowed_poisha,
      decision_state: decision.decision,
      trace_id: decision.trace_id,
      decision,
    });
  }

  if (decisions.length === 0) {
    throw new Error('A document needs at least one priced line with a positive taxable value.');
  }

  const sum = (selector: (line: DocumentTaxLineDecision) => bigint): bigint =>
    decisions.reduce((total, line) => total + selector(line), 0n);
  const categories = decisions.map((line) => line.tax_category);
  const mixedTaxCategories = new Set(categories).size > 1;
  const category = mixedTaxCategories
    ? (fallback_tax_category ?? decisions[0].tax_category)
    : decisions[0].tax_category;
  const first = decisions[0].decision;

  const basePoisha = sum((line) => line.base_poisha);
  const sdPoisha = sum((line) => line.sd_poisha);
  const vatPoisha = sum((line) => line.vat_poisha);
  const grossPoisha = sum((line) => line.gross_poisha);
  const vdsPoisha = sum((line) => line.vds_poisha);
  const tdsPoisha = sum((line) => line.tds_poisha);
  const netPayablePoisha = sum((line) => line.net_payable_poisha);
  const treasuryPoisha = decisions.reduce((total, line) => total + line.decision.treasury_payable_poisha, 0n);
  const claimablePoisha = sum((line) => line.claimable_poisha);
  const disallowedPoisha = sum((line) => line.disallowed_poisha);
  const reverseChargeVatPoisha = decisions.reduce(
    (total, line) => total + line.decision.reverse_charge_vat_poisha,
    0n,
  );
  const reasonCodes = Array.from(new Set(decisions.flatMap((line) => line.decision.input_credit.reasons)));
  const reasonLabelsEn = Array.from(
    new Set(decisions.flatMap((line) => line.decision.input_credit.reason_labels_en)),
  );
  const reasonLabelsBn = Array.from(
    new Set(decisions.flatMap((line) => line.decision.input_credit.reason_labels_bn)),
  );
  const creditRuleIds = Array.from(
    new Set(decisions.flatMap((line) => line.decision.input_credit.rule_ids)),
  );
  const ruleIds = Array.from(new Set(decisions.flatMap((line) => line.decision.rule_ids)));
  const citations = Array.from(new Set(decisions.flatMap((line) => line.decision.citations)));
  const conditions = uniqueConditions(decisions.flatMap((line) => line.decision.conditions));
  const explanationsEn = Array.from(new Set(decisions.flatMap((line) => line.decision.explanations_en)));
  const explanationsBn = Array.from(new Set(decisions.flatMap((line) => line.decision.explanations_bn)));
  const filing = decisions.find((line) => line.decision.filing)?.decision.filing;
  const decisionState = worstDecision(decisions.map((line) => line.decision_state));

  const inputCredit: InputCreditOutcome = {
    eligible: claimablePoisha !== 0n,
    claimable_poisha: claimablePoisha,
    disallowed_poisha: disallowedPoisha,
    reasons: reasonCodes,
    reason_labels_en: reasonLabelsEn,
    reason_labels_bn: reasonLabelsBn,
    rule_ids: creditRuleIds,
  };

  const aggregate: TaxDecisionDetail = {
    trace_id: `TAX-${fnv1a64Hex(decisions.map((line) => line.trace_id).join('|'))}`,
    decision: decisionState,
    direction: request.direction,
    base_poisha: basePoisha,
    sd_bps: commonRate(decisions.map((line) => line.decision.sd_bps)),
    sd_poisha: sdPoisha,
    vat_bps: commonRate(decisions.map((line) => line.decision.vat_bps)),
    vat_poisha: vatPoisha,
    gross_poisha: grossPoisha,
    vds_bps: commonRate(decisions.map((line) => line.decision.vds_bps)),
    vds_poisha: vdsPoisha,
    tds_bps: commonRate(decisions.map((line) => line.decision.tds_bps)),
    tds_poisha: tdsPoisha,
    net_payable_poisha: netPayablePoisha,
    treasury_payable_poisha: treasuryPoisha,
    input_credit: inputCredit,
    conditions,
    rule_ids: ruleIds,
    citations,
    explanations_en: explanationsEn,
    explanations_bn: explanationsBn,
    rule_pack_version: first.rule_pack_version,
    evaluated_at: evaluatedAt,
    ...(filing ? { filing } : {}),
    category,
    effective_category: mixedTaxCategories ? category : first.effective_category,
    is_reverse_charge: decisions.some((line) => line.decision.is_reverse_charge),
    bin_valid: decisions.every((line) => line.decision.bin_valid),
    tin_valid: decisions.every((line) => line.decision.tin_valid),
    reverse_charge_vat_poisha: reverseChargeVatPoisha,
    withheld_total_poisha: vdsPoisha + tdsPoisha,
    cash_limit_poisha: first.cash_limit_poisha,
  };

  return { decision: aggregate, lines: decisions, mixed_tax_categories: mixedTaxCategories };
}

/**
 * Decision precedence, in one place so the golden suite and the UI cannot disagree:
 * invalid base → NOT_SUPPORTED, disputed rule pack → SOURCE_DISPUTED_OR_EXPIRED,
 * out-of-scope or any other BLOCKER → MANUAL_REVIEW, WARNING → SUPPORTED_WITH_CONDITIONS.
 */
function resolveDecisionState(
  invalidBase: boolean,
  sourceDisputed: boolean,
  outOfScope: boolean,
  conditions: TaxCondition[],
): DecisionState {
  const hasBlocker = conditions.some((condition) => condition.severity === 'BLOCKER');
  const hasWarning = conditions.some((condition) => condition.severity === 'WARNING');
  if (invalidBase) return 'NOT_SUPPORTED';
  if (sourceDisputed) return 'SOURCE_DISPUTED_OR_EXPIRED';
  if (outOfScope || hasBlocker) return 'MANUAL_REVIEW';
  if (hasWarning) return 'SUPPORTED_WITH_CONDITIONS';
  return 'SUPPORTED';
}

// ---------------------------------------------------------------------------------------------
// Transaction orchestrator preview (double-entry, never posted here)
// ---------------------------------------------------------------------------------------------

function previewLine(
  lineNo: number,
  account: PreviewAccount,
  debit: bigint,
  credit: bigint,
  taxPart: TaxJournalPart,
  memoEn: string,
  memoBn: string,
): TaxJournalPreviewLine {
  return {
    line_no: lineNo,
    account_code: account.code,
    account_name_en: account.name_en,
    account_name_bn: account.name_bn,
    debit_poisha: debit,
    credit_poisha: credit,
    tax_part: taxPart,
    memo_en: memoEn,
    memo_bn: memoBn,
  };
}

function groupTotals(
  id: TaxJournalGroupId,
  titleEn: string,
  titleBn: string,
  lines: TaxJournalPreviewLine[],
): TaxJournalPreviewGroup {
  const totalDebit = lines.reduce((sum, line) => sum + line.debit_poisha, 0n);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit_poisha, 0n);
  return {
    id,
    title_en: titleEn,
    title_bn: titleBn,
    lines,
    total_debit_poisha: totalDebit,
    total_credit_poisha: totalCredit,
    balanced: totalDebit === totalCredit,
  };
}

// ---------------------------------------------------------------------------------------------
// Perpetual inventory, weighted-average cost and COGS (blueprint §4.1–4.2)
// ---------------------------------------------------------------------------------------------

export const COGS_ACCOUNT_CODE = '5100';
export const MERCHANDISE_INVENTORY_ACCOUNT_CODE = '1310';
/** Seeded stock goods are carried at 70% of their selling price until a receipt revalues them. */
export const DEFAULT_STOCK_COST_BPS = 7000;

export interface StockMovementLine {
  sku: string;
  quantity: number;
}

export interface StockReceiptLine extends StockMovementLine {
  /** Unit cost in poisha before any disallowed input VAT is capitalised. */
  unit_cost_poisha: bigint;
}

/** Carrying cost used by COGS: the recorded weighted-average cost, else 70% of selling price. */
export function defaultInventoryUnitCost(
  item: Pick<InventoryItem, 'unit_cost_poisha' | 'unit_price_poisha'>,
): bigint {
  if (item.unit_cost_poisha !== undefined) return item.unit_cost_poisha;
  return (item.unit_price_poisha * 7000n) / 10000n;
}

/**
 * Blueprint §4.1 exact COGS formula:
 * `SUM(BigInt(Math.round(line.qty * 100)) * item.unit_cost_poisha / 100n)` over every stock item
 * (`item.is_stock_item !== false`). Non-stock services never create COGS.
 */
export function calculatePerpetualCogs(
  lines: readonly StockMovementLine[],
  items: readonly InventoryItem[],
): bigint {
  let totalCogsPoisha = 0n;
  for (const line of lines) {
    const item = items.find((entry) => entry.sku === line.sku);
    if (!item || item.is_stock_item === false) continue;
    const qtyScaled = BigInt(Math.round(Math.max(0, line.quantity) * 100));
    totalCogsPoisha += (qtyScaled * defaultInventoryUnitCost(item)) / 100n;
  }
  return totalCogsPoisha;
}

/** Aggregate sold/received quantities per SKU so an item is only touched once per document. */
export function stockQuantitiesBySku(lines: readonly StockMovementLine[]): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const line of lines) {
    const qty = Math.max(0, line.quantity);
    if (qty === 0) continue;
    quantities[line.sku] = (quantities[line.sku] ?? 0) + qty;
  }
  return quantities;
}

export interface WeightedAverageCostInput {
  oldQty: number;
  oldCostPoisha: bigint;
  receivedQty: number;
  unitCostPoisha: bigint;
}

export interface WeightedAverageCostResult {
  qty_on_hand: number;
  unit_cost_poisha: bigint;
}

/**
 * Blueprint §4.2 exact weighted-average formula:
 * `(oldQtyScaled * oldCost + receivedQtyScaled * unitCost) / newTotalQtyScaled`.
 * Quantities are scaled by 100 so fractional units stay in integer poisha arithmetic.
 */
export function weightedAverageCost(input: WeightedAverageCostInput): WeightedAverageCostResult {
  const oldQty = Math.max(0, input.oldQty);
  const receivedQty = Math.max(0, input.receivedQty);
  const newTotalQty = oldQty + receivedQty;
  if (newTotalQty <= 0) {
    return { qty_on_hand: 0, unit_cost_poisha: input.unitCostPoisha };
  }
  const oldQtyScaled = BigInt(Math.round(oldQty * 100));
  const receivedQtyScaled = BigInt(Math.round(receivedQty * 100));
  const newTotalQtyScaled = BigInt(Math.round(newTotalQty * 100));
  const newAvgCost =
    (oldQtyScaled * input.oldCostPoisha + receivedQtyScaled * input.unitCostPoisha) /
    newTotalQtyScaled;
  return { qty_on_hand: newTotalQty, unit_cost_poisha: newAvgCost };
}

export interface StockMovementContext {
  movement_date?: string;
  source_doc_id?: string;
  source_doc_ref?: string;
}

export interface ReceiveInventoryOptions extends StockMovementContext {
  /** Document base value, used to apportion disallowed input VAT by line value. */
  basePoisha?: bigint;
  /** Input VAT that s.46 disallows — capitalised into the weighted-average cost. */
  disallowedVatPoisha?: bigint;
  movement_type?: 'RECEIPT' | 'RETURN_IN';
}

export interface ReceiveInventoryResult<T extends InventoryItem> {
  items: T[];
  received_qty_by_sku: Record<string, number>;
  total_received_qty: number;
  total_value_poisha: bigint;
  movements: StockMovement[];
}

export interface StockShortage {
  sku: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends Error {
  readonly shortages: StockShortage[];

  constructor(shortages: StockShortage[]) {
    super(
      `Insufficient stock: ${shortages
        .map((shortage) => `${shortage.sku} requested ${shortage.requested} but ${shortage.available} on hand`)
        .join('; ')}.`,
    );
    this.name = 'InsufficientStockError';
    this.shortages = shortages;
  }
}

function stockMovement(
  type: StockMovement['movement_type'],
  sku: string,
  quantity: number,
  unitCostPoisha: bigint,
  context: StockMovementContext,
  negativeOverride = false,
): StockMovement {
  const quantityScaled = BigInt(Math.round(quantity * 100));
  return {
    id: `${context.source_doc_ref ?? context.source_doc_id ?? 'STOCK'}:${type}:${sku}`,
    movement_type: type,
    sku,
    quantity,
    unit_cost_poisha: unitCostPoisha,
    value_poisha: (quantityScaled * unitCostPoisha) / QUANTITY_SCALE,
    movement_date: context.movement_date,
    source_doc_id: context.source_doc_id,
    source_doc_ref: context.source_doc_ref,
    ...(negativeOverride ? { negative_stock_override: true } : {}),
  };
}

/**
 * Receiving goods (GRN_RECEIVED / PURCHASE_BILL): increment `qty_on_hand` and revalue the item with
 * the weighted-average formula. Disallowed input VAT is added to the per-unit cost first, matching
 * the s.46 capitalization rule in blueprint §4.2.
 */
export function receiveInventoryStock<T extends InventoryItem>(
  items: readonly T[],
  lines: readonly StockReceiptLine[],
  options: ReceiveInventoryOptions = {},
): ReceiveInventoryResult<T> {
  const updated = [...items];
  const indexBySku = new Map(updated.map((item, index) => [item.sku, index]));
  const receivedBySku: Record<string, number> = {};
  const movements: StockMovement[] = [];
  let totalReceivedQty = 0;
  let totalValuePoisha = 0n;
  const disallowedVat = options.disallowedVatPoisha ?? 0n;
  const base = options.basePoisha ?? 0n;
  const movementType = options.movement_type ?? 'RECEIPT';

  for (const line of lines) {
    const index = indexBySku.get(line.sku);
    if (index === undefined) continue;
    const item = updated[index];
    if (item.is_stock_item === false) continue;
    const qty = Math.max(0, line.quantity);
    if (qty <= 0) continue;
    const qtyScaled = BigInt(Math.round(qty * 100));
    const lineValuePoisha = (qtyScaled * line.unit_cost_poisha) / QUANTITY_SCALE;
    let unitCostPoisha = line.unit_cost_poisha;
    if (disallowedVat > 0n && base > 0n) {
      const lineDisallowedVat = (disallowedVat * lineValuePoisha) / base;
      unitCostPoisha += (lineDisallowedVat * QUANTITY_SCALE) / qtyScaled;
    }
    const averaged = weightedAverageCost({
      oldQty: item.qty_on_hand ?? 0,
      oldCostPoisha: defaultInventoryUnitCost(item),
      receivedQty: qty,
      unitCostPoisha,
    });
    updated[index] = {
      ...item,
      qty_on_hand: averaged.qty_on_hand,
      unit_cost_poisha: averaged.unit_cost_poisha,
    };
    receivedBySku[line.sku] = (receivedBySku[line.sku] ?? 0) + qty;
    totalReceivedQty += qty;
    totalValuePoisha += lineValuePoisha;
    movements.push(
      stockMovement(movementType, line.sku, qty, unitCostPoisha, {
        movement_date: options.movement_date,
        source_doc_id: options.source_doc_id,
        source_doc_ref: options.source_doc_ref,
      }),
    );
  }

  return {
    items: updated,
    received_qty_by_sku: receivedBySku,
    total_received_qty: totalReceivedQty,
    total_value_poisha: totalValuePoisha,
    movements,
  };
}

export interface IssueInventoryOptions extends StockMovementContext {
  /**
   * Only an explicit override may take stock below zero. The default is to reject the whole issue
   * so a sale can never silently create a negative inventory balance.
   */
  allow_negative_stock?: boolean;
}

export interface IssueInventoryResult<T extends InventoryItem> {
  items: T[];
  issued_qty_by_sku: Record<string, number>;
  total_issued_qty: number;
  movements: StockMovement[];
  shortages: StockShortage[];
  negative_stock_override: boolean;
}

/** Posting a sales invoice relieves `qty_on_hand` by the sold quantity of each stock item. */
export function issueInventoryStock<T extends InventoryItem>(
  items: readonly T[],
  lines: readonly StockMovementLine[],
  options: IssueInventoryOptions = {},
): IssueInventoryResult<T> {
  const quantities = stockQuantitiesBySku(lines);
  const shortages: StockShortage[] = [];
  const allowNegative = options.allow_negative_stock === true;

  if (!allowNegative) {
    for (const [sku, qty] of Object.entries(quantities)) {
      const item = items.find((entry) => entry.sku === sku);
      if (!item || item.is_stock_item === false) continue;
      const available = item.qty_on_hand ?? 0;
      if (qty > available) shortages.push({ sku, requested: qty, available });
    }
  }
  if (shortages.length > 0) throw new InsufficientStockError(shortages);

  let totalIssuedQty = 0;
  const movements: StockMovement[] = [];
  const updated = items.map((item) => {
    const qty = quantities[item.sku];
    if (!qty || item.is_stock_item === false) return item;
    totalIssuedQty += qty;
    movements.push(
      stockMovement('ISSUE', item.sku, qty, defaultInventoryUnitCost(item), {
        movement_date: options.movement_date,
        source_doc_id: options.source_doc_id,
        source_doc_ref: options.source_doc_ref,
      }),
    );
    return {
      ...item,
      qty_on_hand: (item.qty_on_hand ?? 0) - qty,
    };
  });
  const issuedBySku: Record<string, number> = {};
  for (const [sku, qty] of Object.entries(quantities)) {
    const item = items.find((entry) => entry.sku === sku);
    if (item && item.is_stock_item !== false) issuedBySku[sku] = qty;
  }
  const negativeOverride = allowNegative && updated.some((item) => (item.qty_on_hand ?? 0) < 0);
  return {
    items: updated,
    issued_qty_by_sku: issuedBySku,
    total_issued_qty: totalIssuedQty,
    movements: negativeOverride
      ? movements.map((movement) => ({ ...movement, negative_stock_override: true }))
      : movements,
    shortages: [],
    negative_stock_override: negativeOverride,
  };
}

export interface ReturnInventoryResult<T extends InventoryItem> {
  items: T[];
  returned_qty_by_sku: Record<string, number>;
  total_returned_qty: number;
  cogs_reversed_poisha: bigint;
  movements: StockMovement[];
}

/**
 * A sales return restores the returned units at their weighted-average cost and reverses the COGS
 * pair (Dr Inventory / Cr COGS). It never posts a purchase receipt, because no new liability arises.
 */
export function returnInventoryStock<T extends InventoryItem>(
  items: readonly T[],
  lines: readonly StockMovementLine[],
  options: StockMovementContext = {},
): ReturnInventoryResult<T> {
  const receiptLines: StockReceiptLine[] = lines
    .map((line) => {
      const item = items.find((entry) => entry.sku === line.sku);
      if (!item || item.is_stock_item === false) return null;
      return {
        sku: line.sku,
        quantity: Math.max(0, line.quantity),
        unit_cost_poisha: defaultInventoryUnitCost(item),
      };
    })
    .filter((line): line is StockReceiptLine => line !== null);
  const received = receiveInventoryStock(items, receiptLines, {
    ...options,
    movement_type: 'RETURN_IN',
  });
  return {
    items: received.items,
    returned_qty_by_sku: received.received_qty_by_sku,
    total_returned_qty: received.total_received_qty,
    cogs_reversed_poisha: received.total_value_poisha,
    movements: received.movements,
  };
}

export interface CogsJournalLine {
  account_code: string;
  account_name_en: string;
  account_name_bn: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  memo: string;
}

/**
 * The two balanced legs the sales journal MUST carry (blueprint §4.1):
 * Debit 5100 Cost of Goods Sold / Credit 1310 Merchandise Inventory.
 */
export function buildCogsJournalLines(
  totalCogsPoisha: bigint,
  accounts?: readonly Pick<Account, 'code' | 'name_en' | 'name_bn'>[],
  reference = 'Perpetual inventory',
): CogsJournalLine[] {
  if (totalCogsPoisha <= 0n) return [];
  const cogs = accounts?.find((account) => account.code === COGS_ACCOUNT_CODE);
  const inventory = accounts?.find((account) => account.code === MERCHANDISE_INVENTORY_ACCOUNT_CODE);
  return [
    {
      account_code: COGS_ACCOUNT_CODE,
      account_name_en: cogs?.name_en ?? 'Cost of Goods Sold',
      account_name_bn: cogs?.name_bn ?? 'বিক্রীত পণ্যের ব্যয়',
      debit_poisha: totalCogsPoisha,
      credit_poisha: 0n,
      memo: `${reference} — COGS on issue of stock`,
    },
    {
      account_code: MERCHANDISE_INVENTORY_ACCOUNT_CODE,
      account_name_en: inventory?.name_en ?? 'Merchandise Inventory',
      account_name_bn: inventory?.name_bn ?? 'পণ্যসামগ্রী মজুদ',
      debit_poisha: 0n,
      credit_poisha: totalCogsPoisha,
      memo: `${reference} — merchandise inventory relief`,
    },
  ];
}

/**
 * The mirror image of the COGS pair for a sales return:
 * Debit 1310 Merchandise Inventory / Credit 5100 Cost of Goods Sold.
 */
export function buildReturnCogsJournalLines(
  totalCogsPoisha: bigint,
  accounts?: readonly Pick<Account, 'code' | 'name_en' | 'name_bn'>[],
  reference = 'Sales return',
): CogsJournalLine[] {
  if (totalCogsPoisha <= 0n) return [];
  const cogs = accounts?.find((account) => account.code === COGS_ACCOUNT_CODE);
  const inventory = accounts?.find((account) => account.code === MERCHANDISE_INVENTORY_ACCOUNT_CODE);
  return [
    {
      account_code: MERCHANDISE_INVENTORY_ACCOUNT_CODE,
      account_name_en: inventory?.name_en ?? 'Merchandise Inventory',
      account_name_bn: inventory?.name_bn ?? 'পণ্যসামগ্রী মজুদ',
      debit_poisha: totalCogsPoisha,
      credit_poisha: 0n,
      memo: `${reference} — inventory restored on return`,
    },
    {
      account_code: COGS_ACCOUNT_CODE,
      account_name_en: cogs?.name_en ?? 'Cost of Goods Sold',
      account_name_bn: cogs?.name_bn ?? 'বিক্রীত পণ্যের ব্যয়',
      debit_poisha: 0n,
      credit_poisha: totalCogsPoisha,
      memo: `${reference} — COGS reversed on return`,
    },
  ];
}

export interface InventoryPreviewContext {
  lines: readonly StockMovementLine[];
  items: readonly InventoryItem[];
}

/**
 * Deterministic double-entry preview for the Tax Advisor card and the Phase 2 ledger engine.
 * Amounts are signed, so a Mushak 6.7 credit note produces the mirror image of the invoice and the
 * ledger engine can normalise debit/credit columns when it posts.
 *
 * Pass an `inventory` context to include the perpetual-inventory COGS pair in the DOCUMENT group.
 */
export function previewTaxJournal(
  input: TaxEvaluationInput,
  evaluated?: TaxDecision,
  inventory?: InventoryPreviewContext,
): TaxJournalPreview {
  const decision = (evaluated ?? evaluateTaxDecision(input)) as TaxDecision;
  const base = decision.base_poisha;
  const sd = decision.sd_poisha;
  const vat = decision.vat_poisha;
  const gross = decision.gross_poisha;
  const vds = decision.vds_poisha;
  const tds = decision.tds_poisha;
  const net = decision.net_payable_poisha;
  const claimable = decision.input_credit.claimable_poisha;
  const disallowed = decision.input_credit.disallowed_poisha;
  const isReverseCharge = Boolean(input.is_reverse_charge) || input.tax_category === 'REVERSE_CHARGE';
  const bank = settlementAccount(input.payment_method);
  const party = input.party_name || 'counterparty';
  const documentLines: TaxJournalPreviewLine[] = [];
  const settlementLines: TaxJournalPreviewLine[] = [];
  let lineNo = 0;

  if (input.direction === 'SALE') {
    const revenueAccount =
      input.tax_category === 'EXPORT_ZERO'
        ? PREVIEW_ACCOUNTS.REVENUE_EXPORT
        : vds !== 0n
          ? PREVIEW_ACCOUNTS.REVENUE_CONTRACT
          : PREVIEW_ACCOUNTS.REVENUE_STANDARD;

    lineNo += 1;
    documentLines.push(
      previewLine(
        lineNo,
        PREVIEW_ACCOUNTS.AR,
        gross,
        0n,
        'RECEIVABLE',
        `Invoice to ${party} — gross receivable`,
        `${party} — মোট প্রাপ্য চালান`,
      ),
    );
    lineNo += 1;
    documentLines.push(
      previewLine(
        lineNo,
        revenueAccount,
        0n,
        base,
        'REVENUE',
        'Taxable value of the supply',
        'সরবরাহের করযোগ্য মূল্য',
      ),
    );
    if (sd !== 0n) {
      lineNo += 1;
      documentLines.push(
        previewLine(lineNo, PREVIEW_ACCOUNTS.OUTPUT_VAT, 0n, sd, 'SD', 'Supplementary duty', 'সম্পূরক শুল্ক'),
      );
    }
    if (vat !== 0n) {
      lineNo += 1;
      documentLines.push(
        previewLine(lineNo, PREVIEW_ACCOUNTS.OUTPUT_VAT, 0n, vat, 'VAT', 'Output VAT', 'আউটপুট ভ্যাট'),
      );
    }
    if (inventory) {
      const totalCogsPoisha = calculatePerpetualCogs(inventory.lines, inventory.items);
      if (totalCogsPoisha > 0n) {
        lineNo += 1;
        documentLines.push(
          previewLine(
            lineNo,
            PREVIEW_ACCOUNTS.COST_OF_SALES,
            totalCogsPoisha,
            0n,
            'COST',
            'Perpetual inventory COGS on sale',
            'বিক্রয়ে চিরস্থায়ী মজুদের সিওজিএস',
          ),
        );
        lineNo += 1;
        documentLines.push(
          previewLine(
            lineNo,
            PREVIEW_ACCOUNTS.INVENTORY,
            0n,
            totalCogsPoisha,
            'COST',
            'Merchandise inventory relieved',
            'পণ্যসামগ্রী মজুদ হ্রাস',
          ),
        );
      }
    }

    lineNo += 1;
    settlementLines.push(
      previewLine(lineNo, bank, net, 0n, 'CASH', 'Settlement received net of withholding', 'কর্তনসহ নিট পরিশোধ প্রাপ্তি'),
    );
    if (vds !== 0n) {
      lineNo += 1;
      settlementLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.VDS_RECEIVABLE,
          vds,
          0n,
          'VDS',
          'Customer VDS — Mushak 6.6 pending',
          'গ্রাহক ভিডিএস — মূসক ৬.৬ অপেক্ষমাণ',
        ),
      );
    }
    if (tds !== 0n) {
      lineNo += 1;
      settlementLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.AIT_RECEIVABLE,
          tds,
          0n,
          'TDS',
          'Customer TDS / AIT credit',
          'গ্রাহক টিডিএস / এআইটি ক্রেডিট',
        ),
      );
    }
    lineNo += 1;
    settlementLines.push(
      previewLine(lineNo, PREVIEW_ACCOUNTS.AR, 0n, gross, 'RECEIVABLE', 'Receivable cleared', 'প্রাপ্য হিসাব নিষ্পত্তি'),
    );
  } else {
    const cost = base + sd + disallowed;
    lineNo += 1;
    documentLines.push(
      previewLine(
        lineNo,
        PREVIEW_ACCOUNTS.COST_OF_SALES,
        cost,
        0n,
        'COST',
        disallowed !== 0n ? 'Base + SD + disallowed input VAT capitalised' : 'Base + SD cost of the purchase',
        disallowed !== 0n ? 'ভিত্তি + এসডি + বাতিল ইনপুট ভ্যাট মূলধনায়িত' : 'ক্রয়ের ভিত্তি + এসডি ব্যয়',
      ),
    );
    if (claimable !== 0n) {
      lineNo += 1;
      documentLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.INPUT_VAT,
          claimable,
          0n,
          'INPUT_CREDIT',
          'Claimable input VAT (s.46 satisfied)',
          'দাবিযোগ্য ইনপুট ভ্যাট (ধারা ৪৬ পূর্ণ)',
        ),
      );
    }
    lineNo += 1;
    documentLines.push(
      previewLine(lineNo, PREVIEW_ACCOUNTS.AP, 0n, gross, 'PAYABLE', `Bill from ${party} — gross payable`, `${party} — মোট প্রদেয় বিল`),
    );
    if (isReverseCharge && vat !== 0n) {
      lineNo += 1;
      documentLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.REVERSE_CHARGE_VAT,
          0n,
          vat,
          'REVERSE_CHARGE',
          'Self-assessed reverse-charge VAT',
          'স্ব-নির্ধারিত রিভার্স-চার্জ ভ্যাট',
        ),
      );
    }

    lineNo += 1;
    settlementLines.push(
      previewLine(lineNo, PREVIEW_ACCOUNTS.AP, gross, 0n, 'PAYABLE', 'Payable settled', 'প্রদেয় হিসাব নিষ্পত্তি'),
    );
    if (vds !== 0n) {
      lineNo += 1;
      settlementLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.VDS_PAYABLE,
          0n,
          vds,
          'VDS',
          'VDS withheld — Treasury challan queued',
          'কর্তিত ভিডিএস — ট্রেজারি চালান কিউতে',
        ),
      );
    }
    if (tds !== 0n) {
      lineNo += 1;
      settlementLines.push(
        previewLine(
          lineNo,
          PREVIEW_ACCOUNTS.TDS_PAYABLE,
          0n,
          tds,
          'TDS',
          'TDS withheld — Treasury challan queued',
          'কর্তিত টিডিএস — ট্রেজারি চালান কিউতে',
        ),
      );
    }
    lineNo += 1;
    settlementLines.push(
      previewLine(lineNo, bank, 0n, net, 'CASH', 'Cash/bank paid net of withholding', 'কর্তনসহ নিট নগদ/ব্যাংক পরিশোধ'),
    );
  }

  const groups: TaxJournalPreviewGroup[] = [
    groupTotals('DOCUMENT', 'Document posting', 'নথি পোস্টিং', documentLines),
    groupTotals('SETTLEMENT', 'Settlement posting', 'নিষ্পত্তি পোস্টিং', settlementLines),
  ];
  const lines = groups.flatMap((group) => group.lines);
  const totalDebit = groups.reduce((sum, group) => sum + group.total_debit_poisha, 0n);
  const totalCredit = groups.reduce((sum, group) => sum + group.total_credit_poisha, 0n);

  return {
    direction: input.direction,
    groups,
    lines,
    total_debit_poisha: totalDebit,
    total_credit_poisha: totalCredit,
    balanced: groups.every((group) => group.balanced) && totalDebit === totalCredit,
  };
}

// ---------------------------------------------------------------------------------------------
// Advisor snapshot
// ---------------------------------------------------------------------------------------------

/** Labels + decision bundle for the Tax Advisor card. */
export function taxAdvisorSnapshot(
  input: TaxEvaluationInput,
  decision?: TaxDecision,
  pack: RulePack = BD_2026_V1,
): TaxAdvisorSnapshot {
  const resolved = decision ?? evaluateTaxDecision(input, { rulePack: pack });
  const isReverseCharge = Boolean(input.is_reverse_charge) || input.tax_category === 'REVERSE_CHARGE';
  const vatRuleId = isReverseCharge
    ? RULE_IDS.VAT_REVERSE_CHARGE_S20
    : VAT_RULE_ID_BY_CATEGORY[input.tax_category];
  const vatRule = vatRuleId ? getRule(vatRuleId, pack) : undefined;
  const vdsRule = getRule(RULE_IDS.VDS_WITHHOLDING_S49, pack);
  const tdsRuleId = TDS_RULE_ID_BY_NATURE[input.tds_nature as TdsNature];
  const tdsRule = tdsRuleId ? getRule(tdsRuleId, pack) : undefined;
  return {
    decision: resolved,
    vat_category_label_en: vatRule?.title_en ?? 'Out of scope',
    vat_category_label_bn: vatRule?.title_bn ?? 'পরিধির বাইরে',
    vds_label_en: vdsRule?.title_en ?? 'VDS not applicable',
    vds_label_bn: vdsRule?.title_bn ?? 'ভিডিএস প্রযোজ্য নয়',
    tds_label_en: tdsRule?.title_en ?? 'No TDS',
    tds_label_bn: tdsRule?.title_bn ?? 'টিডিএস প্রযোজ্য নয়',
  };
}
