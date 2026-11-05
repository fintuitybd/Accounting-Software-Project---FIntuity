// 25 golden Bangladesh tax vectors — the regression wall around `evaluateTaxDecision()`.
//
// Every expected value below was computed by hand from Rule Pack bd-2026-v1, not copied from the
// engine output. Example (GT-01): base BDT 1,00,000.00 = 10,000,000 poisha; 15% VAT =
// 10,000,000 × 1500 bps = 1,500,000 poisha = BDT 15,000.00; gross = 11,500,000 poisha.
//
// The runner adds invariants that must hold for EVERY vector, so a future rate change cannot make
// the books silently unbalanced:
//   • gross = base + SD + VAT            (reverse charge: gross = base + SD)
//   • net payable = gross − VDS − TDS
//   • treasury = VDS + TDS               (+ reverse-charge VAT for imported services)
//   • claimable + disallowed = input VAT (purchases only)
//   • the double-entry preview balances in both groups
//   • the decision state matches the severity of its own conditions

import { bdtToPoisha, formatPoisha, isoNow } from '../money';
import type { RulePack, TaxDecision, TaxEvaluationInput } from '../types';
import {
  evaluateTaxDecision,
  previewTaxJournal,
  type TaxDecisionDetail,
} from './engine';
import { BD_2026_V1, RULE_IDS } from './rulePack';

export interface GoldenExpectation {
  decision?: TaxDecision['decision'];
  base_poisha?: bigint;
  sd_bps?: number;
  sd_poisha?: bigint;
  vat_bps?: number;
  vat_poisha?: bigint;
  vds_bps?: number;
  vds_poisha?: bigint;
  tds_bps?: number;
  tds_poisha?: bigint;
  gross_poisha?: bigint;
  net_payable_poisha?: bigint;
  treasury_payable_poisha?: bigint;
  claimable_poisha?: bigint;
  disallowed_poisha?: bigint;
  input_credit_eligible?: boolean;
  filing_days?: number;
  filing_due_date?: string;
  filing_holiday_adjusted?: boolean;
  must_include_rule_ids?: string[];
  must_include_condition_codes?: string[];
  must_not_include_condition_codes?: string[];
}

export interface GoldenCase {
  id: string;
  title_en: string;
  title_bn: string;
  scenario: string;
  legislation: string;
  input: TaxEvaluationInput;
  expected: GoldenExpectation;
}

export interface GoldenCheck {
  field: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface GoldenCaseResult {
  id: string;
  title_en: string;
  title_bn: string;
  scenario: string;
  legislation: string;
  passed: boolean;
  checks: GoldenCheck[];
  failed_checks: GoldenCheck[];
  decision: TaxDecisionDetail;
  input: TaxEvaluationInput;
}

export interface GoldenSuiteResult {
  total: number;
  passed: number;
  failed: number;
  checks_run: number;
  results: GoldenCaseResult[];
  ran_at: string;
  rule_pack_version: string;
  duration_ms: number;
  ok: boolean;
}

export interface GoldenSuiteOptions {
  pack?: RulePack;
  evaluatedAt?: string;
}

const BIN_VALID = '006123789-0304';
const BIN_INVALID = 'BIN-4411';
const TIN_VALID = '138547291063';
const TIN_MISSING = '';

/** A purchase base with no VAT (exempt) or a foreign bill uses the same helper shape. */
function purchaseInput(overrides: Partial<TaxEvaluationInput>): TaxEvaluationInput {
  return {
    direction: 'PURCHASE',
    base_poisha: bdtToPoisha('50000.00'),
    tax_category: 'STANDARD_15',
    party_name: 'Padma Traders',
    party_bin: BIN_VALID,
    party_tin: TIN_VALID,
    is_withholding_entity: true,
    vds_applicable: false,
    tds_nature: 'NONE',
    payment_method: 'BANK',
    has_valid_mushak63: true,
    is_reverse_charge: false,
    ...overrides,
  };
}

function saleInput(overrides: Partial<TaxEvaluationInput>): TaxEvaluationInput {
  return {
    direction: 'SALE',
    base_poisha: bdtToPoisha('100000.00'),
    tax_category: 'STANDARD_15',
    party_name: 'Meghna Distribution Ltd.',
    party_bin: BIN_VALID,
    party_tin: TIN_VALID,
    is_withholding_entity: false,
    vds_applicable: false,
    tds_nature: 'NONE',
    payment_method: 'BANK',
    has_valid_mushak63: true,
    is_reverse_charge: false,
    ...overrides,
  };
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'GT-01',
    title_en: 'Standard 15% VAT sale settled through the bank',
    title_bn: 'ব্যাংক নিষ্পত্তিতে আদর্শ ১৫% ভ্যাট বিক্রয়',
    scenario: 'VAT_STD_15',
    legislation: 'VAT & SD Act 2012, s.15',
    input: saleInput({ party_name: 'Meghna Distribution Ltd.' }),
    expected: {
      decision: 'SUPPORTED',
      vat_bps: 1500,
      vat_poisha: bdtToPoisha('15000.00'),
      gross_poisha: bdtToPoisha('115000.00'),
      net_payable_poisha: bdtToPoisha('115000.00'),
      treasury_payable_poisha: 0n,
      must_include_rule_ids: [RULE_IDS.VAT_STD_15],
      must_include_condition_codes: ['BIN_VALID', 'MUSHAK_6_3_PRESENT'],
    },
  },
  {
    id: 'GT-02',
    title_en: 'Corporate VDS-withholding buyer deducts 15% at source',
    title_bn: 'কর্পোরেট ভিডিএস ক্রেতা উৎসে ১৫% কর্তন করেন',
    scenario: 'VDS_WITHHOLDING_S49 — sale side',
    legislation: 'VAT & SD Act 2012, s.49',
    input: saleInput({ is_withholding_entity: true, vds_applicable: true, period_end_date: '2026-10-31' }),
    expected: {
      decision: 'SUPPORTED',
      vds_bps: 1500,
      vds_poisha: bdtToPoisha('15000.00'),
      net_payable_poisha: bdtToPoisha('100000.00'),
      treasury_payable_poisha: bdtToPoisha('15000.00'),
      filing_days: 15,
      filing_due_date: '2026-11-15',
      filing_holiday_adjusted: false,
      must_include_rule_ids: [RULE_IDS.VDS_WITHHOLDING_S49, RULE_IDS.VDS_CERTIFICATE_MUSHAK_66],
      must_include_condition_codes: ['VDS_APPLIED'],
    },
  },
  {
    id: 'GT-03',
    title_en: 'Sale to a buyer whose BIN is malformed',
    title_bn: 'ভুল বিআইএনযুক্ত ক্রেতার কাছে বিক্রয়',
    scenario: 'BIN_FORMAT_THIRTEEN_DIGITS',
    legislation: 'VAT & SD Act 2012, s.2(4)',
    input: saleInput({ party_bin: BIN_INVALID }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_poisha: bdtToPoisha('15000.00'),
      gross_poisha: bdtToPoisha('115000.00'),
      must_include_condition_codes: ['BIN_MISSING_OR_INVALID'],
      must_include_rule_ids: [RULE_IDS.BIN_FORMAT_THIRTEEN_DIGITS],
    },
  },
  {
    id: 'GT-04',
    title_en: 'Zero-rated export keeps 0% output VAT',
    title_bn: 'শূন্য-হার রপ্তানিতে আউটপুট ভ্যাট ০%',
    scenario: 'VAT_EXPORT_ZERO',
    legislation: 'VAT & SD Act 2012, s.24',
    input: saleInput({ tax_category: 'EXPORT_ZERO', party_name: 'Nordkap Import AB' }),
    expected: {
      decision: 'SUPPORTED',
      vat_bps: 0,
      vat_poisha: 0n,
      gross_poisha: bdtToPoisha('100000.00'),
      net_payable_poisha: bdtToPoisha('100000.00'),
      treasury_payable_poisha: 0n,
      must_include_rule_ids: [RULE_IDS.VAT_EXPORT_ZERO],
    },
  },
  {
    id: 'GT-05',
    title_en: 'Mushak 6.7 credit note reverses every amount',
    title_bn: 'মূসক ৬.৭ ক্রেডিট নোট প্রতিটি অঙ্ক উল্টে দেয়',
    scenario: 'CREDIT_NOTE_MUSHAK_6_7',
    legislation: 'VAT & SD Act 2012, s.39 / Mushak 6.7',
    input: saleInput({ base_poisha: bdtToPoisha('20000.00'), is_credit_note: true }),
    expected: {
      decision: 'SUPPORTED',
      base_poisha: bdtToPoisha('-20000.00'),
      vat_poisha: bdtToPoisha('-3000.00'),
      gross_poisha: bdtToPoisha('-23000.00'),
      net_payable_poisha: bdtToPoisha('-23000.00'),
      treasury_payable_poisha: 0n,
    },
  },
  {
    id: 'GT-06',
    title_en: 'Supplementary duty at 20% is added before VAT',
    title_bn: '২০% সম্পূরক শুল্ক ভ্যাটের আগে যোগ হয়',
    scenario: 'SD_SECOND_SCHEDULE',
    legislation: 'VAT & SD Act 2012, s.6 and Second Schedule',
    input: saleInput({ sd_applicable: true }),
    expected: {
      decision: 'SUPPORTED',
      sd_bps: 2000,
      sd_poisha: bdtToPoisha('20000.00'),
      vat_poisha: bdtToPoisha('18000.00'),
      gross_poisha: bdtToPoisha('138000.00'),
      net_payable_poisha: bdtToPoisha('138000.00'),
      must_include_condition_codes: ['SUPPLEMENTARY_DUTY_APPLIED'],
    },
  },
  {
    id: 'GT-07',
    title_en: 'Out-of-scope scenario routes to manual review, never a guess',
    title_bn: 'পরিধির বাইরের দৃশ্যপট ম্যানুয়াল রিভিউতে যায়, অনুমান নয়',
    scenario: 'OUT_OF_SCOPE',
    legislation: 'Deterministic compliance guardrail',
    input: saleInput({ tax_category: 'OUT_OF_SCOPE', base_poisha: bdtToPoisha('40000.00') }),
    expected: {
      decision: 'MANUAL_REVIEW',
      vat_bps: 0,
      vat_poisha: 0n,
      gross_poisha: bdtToPoisha('40000.00'),
      must_include_condition_codes: ['OUT_OF_SCOPE_SCENARIO'],
    },
  },
  {
    id: 'GT-08',
    title_en: 'December filing shifts off the Friday–Saturday weekend',
    title_bn: 'ডিসেম্বরের দাখিল শুক্র–শনিবার সাপ্তাহিক বন্ধ এড়িয়ে সরেছে',
    scenario: 'VAT_FILING_S64_ORD38_2026 — holiday adjustment',
    legislation: 'Ordinance No. 38 of 2026, s.64',
    input: saleInput({ period_end_date: '2026-12-31' }),
    expected: {
      decision: 'SUPPORTED',
      filing_days: 15,
      filing_due_date: '2027-01-17',
      filing_holiday_adjusted: true,
      must_include_rule_ids: [RULE_IDS.VAT_FILING_S64_ORD38_2026],
    },
  },
  {
    id: 'GT-09',
    title_en: 'Eligible 15% purchase claims the full input rebate',
    title_bn: 'যোগ্য ১৫% ক্রয়ে সম্পূর্ণ ইনপুট রিবেট দাবি',
    scenario: 'S46_REBATE_GUARD — all conditions satisfied',
    legislation: 'VAT & SD Act 2012, s.46',
    input: purchaseInput({ base_poisha: bdtToPoisha('100000.00') }),
    expected: {
      decision: 'SUPPORTED',
      vat_poisha: bdtToPoisha('15000.00'),
      claimable_poisha: bdtToPoisha('15000.00'),
      disallowed_poisha: 0n,
      input_credit_eligible: true,
      must_include_rule_ids: [RULE_IDS.S46_REBATE_GUARD],
      must_include_condition_codes: ['INPUT_CREDIT_ELIGIBLE'],
    },
  },
  {
    id: 'GT-10',
    title_en: 'Cash purchase above BDT 1,00,000 loses the input rebate',
    title_bn: '১,০০,০০০ টাকার বেশি নগদ ক্রয়ে ইনপুট রিবেট বাতিল',
    scenario: 'CASH_DISALLOWANCE_LIMIT_1_LAKH',
    legislation: 'VAT & SD Act 2012, s.46 (cash-payment condition)',
    input: purchaseInput({ base_poisha: bdtToPoisha('100000.00'), payment_method: 'CASH' }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_poisha: bdtToPoisha('15000.00'),
      gross_poisha: bdtToPoisha('115000.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('15000.00'),
      input_credit_eligible: false,
      must_include_condition_codes: ['CASH_LIMIT_BREACH'],
      must_include_rule_ids: [RULE_IDS.CASH_DISALLOWANCE_LIMIT_1_LAKH],
    },
  },
  {
    id: 'GT-11',
    title_en: 'Invalid supplier BIN blocks input VAT',
    title_bn: 'ভুল সরবরাহকারী বিআইএন ইনপুট ভ্যাট বন্ধ করে',
    scenario: 'S46_REBATE_GUARD — BIN evidence',
    legislation: 'VAT & SD Act 2012, s.46',
    input: purchaseInput({ party_bin: BIN_INVALID }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_poisha: bdtToPoisha('7500.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('7500.00'),
      input_credit_eligible: false,
      must_include_condition_codes: ['BIN_MISSING_OR_INVALID'],
    },
  },
  {
    id: 'GT-12',
    title_en: 'Missing Mushak 6.3 blocks input VAT',
    title_bn: 'মূসক ৬.৩ না থাকলে ইনপুট ভ্যাট বন্ধ',
    scenario: 'S46_REBATE_GUARD — Mushak 6.3 evidence',
    legislation: 'VAT & SD Act 2012, s.46',
    input: purchaseInput({ has_valid_mushak63: false }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_poisha: bdtToPoisha('7500.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('7500.00'),
      must_include_condition_codes: ['MUSHAK_6_3_MISSING'],
    },
  },
  {
    id: 'GT-13',
    title_en: 'Truncated 5% trading purchase never earns a rebate',
    title_bn: 'হ্রাসকৃত ৫% ট্রেডিং ক্রয়ে রিবেট হয় না',
    scenario: 'VAT_TRADING_5',
    legislation: 'VAT & SD Act 2012, Third Schedule',
    input: purchaseInput({ tax_category: 'TRADING_5', base_poisha: bdtToPoisha('100000.00') }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_bps: 500,
      vat_poisha: bdtToPoisha('5000.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('5000.00'),
      must_include_rule_ids: [RULE_IDS.VAT_TRADING_5],
      must_include_condition_codes: ['TRUNCATED_VAT_RATE'],
    },
  },
  {
    id: 'GT-14',
    title_en: 'Procurement provider 7.5% with mandatory 7.5% VDS',
    title_bn: 'প্রকিউরমেন্ট প্রোভাইডার ৭.৫% সহ বাধ্যতামূলক ৭.৫% ভিডিএস',
    scenario: 'VAT_PROCUREMENT_7_5 + VDS_WITHHOLDING_S49',
    legislation: 'VAT & SD Act 2012, s.49',
    input: purchaseInput({
      tax_category: 'PROCUREMENT_7_5',
      base_poisha: bdtToPoisha('100000.00'),
      vds_applicable: true,
      vds_rate_bps: 750,
    }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_bps: 750,
      vat_poisha: bdtToPoisha('7500.00'),
      vds_bps: 750,
      vds_poisha: bdtToPoisha('7500.00'),
      gross_poisha: bdtToPoisha('107500.00'),
      net_payable_poisha: bdtToPoisha('100000.00'),
      treasury_payable_poisha: bdtToPoisha('7500.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('7500.00'),
      must_include_condition_codes: ['VDS_APPLIED', 'TRUNCATED_VAT_RATE'],
    },
  },
  {
    id: 'GT-15',
    title_en: 'Exempt purchase with a nil-return 20-day filing window',
    title_bn: 'শুল্কমুক্ত ক্রয় ও শূন্য রিটার্নে ২০ দিনের দাখিল সময়',
    scenario: 'VAT_EXEMPT + VAT_FILING special window',
    legislation: 'VAT & SD Act 2012, First Schedule; Ordinance No. 38 of 2026, s.64',
    input: purchaseInput({
      tax_category: 'EXEMPT',
      base_poisha: bdtToPoisha('100000.00'),
      is_nil_return: true,
      period_end_date: '2026-12-31',
    }),
    expected: {
      decision: 'SUPPORTED',
      vat_bps: 0,
      vat_poisha: 0n,
      gross_poisha: bdtToPoisha('100000.00'),
      claimable_poisha: 0n,
      disallowed_poisha: 0n,
      filing_days: 20,
      filing_due_date: '2027-01-20',
      filing_holiday_adjusted: false,
      must_include_rule_ids: [RULE_IDS.VAT_EXEMPT],
      must_include_condition_codes: ['EXEMPT_SUPPLY'],
    },
  },
  {
    id: 'GT-16',
    title_en: 'Reverse-charge VAT creditable once the challan is held',
    title_bn: 'চালান সংরক্ষিত হলে রিভার্স-চার্জ ভ্যাট সমন্বয়যোগ্য',
    scenario: 'VAT_REVERSE_CHARGE_S20 — challan held',
    legislation: 'VAT & SD Act 2012, s.20',
    input: purchaseInput({
      tax_category: 'REVERSE_CHARGE',
      is_reverse_charge: true,
      party_name: 'Meta Platforms Ireland Ltd.',
      party_bin: undefined,
      party_tin: undefined,
      has_valid_mushak63: false,
      has_reverse_charge_challan: true,
      base_poisha: bdtToPoisha('30000.00'),
    }),
    expected: {
      decision: 'SUPPORTED',
      vat_bps: 1500,
      vat_poisha: bdtToPoisha('4500.00'),
      gross_poisha: bdtToPoisha('30000.00'),
      net_payable_poisha: bdtToPoisha('30000.00'),
      treasury_payable_poisha: bdtToPoisha('4500.00'),
      claimable_poisha: bdtToPoisha('4500.00'),
      disallowed_poisha: 0n,
      input_credit_eligible: true,
      must_include_rule_ids: [RULE_IDS.VAT_REVERSE_CHARGE_S20],
      must_include_condition_codes: ['REVERSE_CHARGE_CHALLAN_VERIFIED'],
      must_not_include_condition_codes: ['BIN_MISSING_OR_INVALID', 'MUSHAK_6_3_MISSING'],
    },
  },
  {
    id: 'GT-17',
    title_en: 'Reverse-charge VAT stays conditional without a challan',
    title_bn: 'চালান ছাড়া রিভার্স-চার্জ ভ্যাট শর্তসাপেক্ষ থাকে',
    scenario: 'VAT_REVERSE_CHARGE_S20 — challan missing',
    legislation: 'VAT & SD Act 2012, s.20 and s.46',
    input: purchaseInput({
      tax_category: 'REVERSE_CHARGE',
      is_reverse_charge: true,
      party_name: 'Amazon Web Services EMEA SARL',
      party_bin: undefined,
      party_tin: undefined,
      has_valid_mushak63: false,
      has_reverse_charge_challan: false,
      base_poisha: bdtToPoisha('30000.00'),
    }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      vat_poisha: bdtToPoisha('4500.00'),
      gross_poisha: bdtToPoisha('30000.00'),
      treasury_payable_poisha: bdtToPoisha('4500.00'),
      claimable_poisha: 0n,
      disallowed_poisha: bdtToPoisha('4500.00'),
      input_credit_eligible: false,
      must_include_condition_codes: ['REVERSE_CHARGE_CHALLAN_MISSING'],
    },
  },
  {
    id: 'GT-18',
    title_en: 'TDS 3% on goods with a valid e-TIN',
    title_bn: 'বৈধ ই-টিআইএনসহ পণ্যে ৩% টিডিএস',
    scenario: 'TDS_GOODS_S89',
    legislation: 'Income Tax Act 2023, s.89',
    input: purchaseInput({ base_poisha: bdtToPoisha('100000.00'), tds_nature: 'SUPPLY_OF_GOODS' }),
    expected: {
      decision: 'SUPPORTED',
      tds_bps: 300,
      tds_poisha: bdtToPoisha('3000.00'),
      gross_poisha: bdtToPoisha('115000.00'),
      net_payable_poisha: bdtToPoisha('112000.00'),
      treasury_payable_poisha: bdtToPoisha('3000.00'),
      claimable_poisha: bdtToPoisha('15000.00'),
      must_include_rule_ids: [RULE_IDS.TDS_GOODS_S89],
    },
  },
  {
    id: 'GT-19',
    title_en: 'Missing e-TIN upscales goods TDS from 3% to 4.5%',
    title_bn: 'ই-টিআইএন না থাকলে পণ্যের টিডিএস ৩% থেকে ৪.৫%',
    scenario: 'TDS_NO_TIN_PENALTY_50',
    legislation: 'Income Tax Act 2023, s.89 + Finance Act 2026',
    input: purchaseInput({
      base_poisha: bdtToPoisha('100000.00'),
      tds_nature: 'SUPPLY_OF_GOODS',
      party_tin: TIN_MISSING,
    }),
    expected: {
      decision: 'SUPPORTED_WITH_CONDITIONS',
      tds_bps: 450,
      tds_poisha: bdtToPoisha('4500.00'),
      net_payable_poisha: bdtToPoisha('110500.00'),
      treasury_payable_poisha: bdtToPoisha('4500.00'),
      must_include_rule_ids: [RULE_IDS.TDS_NO_TIN_PENALTY_50],
      must_include_condition_codes: ['TIN_MISSING'],
    },
  },
  {
    id: 'GT-20',
    title_en: 'TDS 10% on professional services with a valid e-TIN',
    title_bn: 'বৈধ ই-টিআইএনসহ পেশাদার সেবায় ১০% টিডিএস',
    scenario: 'TDS_PROF_SVC_S90',
    legislation: 'Income Tax Act 2023, s.90',
    input: purchaseInput({
      base_poisha: bdtToPoisha('50000.00'),
      tds_nature: 'PROFESSIONAL_OR_TECHNICAL_SERVICES',
      party_name: 'Rahman Huq & Co. Chartered Accountants',
    }),
    expected: {
      decision: 'SUPPORTED',
      tds_bps: 1000,
      tds_poisha: bdtToPoisha('5000.00'),
      gross_poisha: bdtToPoisha('57500.00'),
      net_payable_poisha: bdtToPoisha('52500.00'),
      treasury_payable_poisha: bdtToPoisha('5000.00'),
      must_include_rule_ids: [RULE_IDS.TDS_PROF_SVC_S90],
    },
  },
  {
    id: 'GT-21',
    title_en: 'Commercial rent carries 5% TDS beside 15% VAT',
    title_bn: 'বাণিজ্যিক ভাড়ায় ১৫% ভ্যাটের সাথে ৫% টিডিএস',
    scenario: 'TDS_RENT_S109',
    legislation: 'Income Tax Act 2023, s.109',
    input: purchaseInput({
      base_poisha: bdtToPoisha('20000.00'),
      tds_nature: 'COMMERCIAL_RENT',
      party_name: 'Gulshan Tower Owners Association',
      vds_applicable: false,
    }),
    expected: {
      decision: 'SUPPORTED',
      vat_poisha: bdtToPoisha('3000.00'),
      tds_bps: 500,
      tds_poisha: bdtToPoisha('1000.00'),
      gross_poisha: bdtToPoisha('23000.00'),
      net_payable_poisha: bdtToPoisha('22000.00'),
      treasury_payable_poisha: bdtToPoisha('1000.00'),
      must_include_rule_ids: [RULE_IDS.TDS_RENT_S109],
    },
  },
  {
    id: 'GT-22',
    title_en: 'Advertising carries 5% TDS and 15% VDS together',
    title_bn: 'বিজ্ঞাপনে একসাথে ৫% টিডিএস ও ১৫% ভিডিএস',
    scenario: 'TDS_ADVERTISING_S92 + VDS_WITHHOLDING_S49',
    legislation: 'Income Tax Act 2023, s.92; VAT & SD Act 2012, s.49',
    input: purchaseInput({
      base_poisha: bdtToPoisha('40000.00'),
      tds_nature: 'ADVERTISING_OR_MEDIA',
      vds_applicable: true,
      party_name: 'Karnival Media Ltd.',
    }),
    expected: {
      decision: 'SUPPORTED',
      vat_poisha: bdtToPoisha('6000.00'),
      vds_bps: 1500,
      vds_poisha: bdtToPoisha('6000.00'),
      tds_poisha: bdtToPoisha('2000.00'),
      gross_poisha: bdtToPoisha('46000.00'),
      net_payable_poisha: bdtToPoisha('38000.00'),
      treasury_payable_poisha: bdtToPoisha('8000.00'),
      claimable_poisha: bdtToPoisha('6000.00'),
      must_include_rule_ids: [RULE_IDS.TDS_ADVERTISING_S92, RULE_IDS.VDS_WITHHOLDING_S49],
    },
  },
  {
    id: 'GT-23',
    title_en: 'Transport and logistics TDS at 3%',
    title_bn: 'পরিবহন ও লজিস্টিকসে ৩% টিডিএস',
    scenario: 'TDS_TRANSPORT_S91',
    legislation: 'Income Tax Act 2023, s.91',
    input: purchaseInput({
      base_poisha: bdtToPoisha('15000.00'),
      tds_nature: 'TRANSPORT_OR_LOGISTICS',
      party_name: 'Sundarban Courier Service',
    }),
    expected: {
      decision: 'SUPPORTED',
      vat_poisha: bdtToPoisha('2250.00'),
      tds_bps: 300,
      tds_poisha: bdtToPoisha('450.00'),
      gross_poisha: bdtToPoisha('17250.00'),
      net_payable_poisha: bdtToPoisha('16800.00'),
      treasury_payable_poisha: bdtToPoisha('450.00'),
      must_include_rule_ids: [RULE_IDS.TDS_TRANSPORT_S91],
    },
  },
  {
    id: 'GT-24',
    title_en: 'A zero base is not supported — nothing is guessed',
    title_bn: 'শূন্য ভিত্তি সমর্থিত নয় — কিছুই অনুমান করা হয় না',
    scenario: 'INVALID_BASE',
    legislation: 'Deterministic compliance guardrail',
    input: saleInput({ base_poisha: 0n }),
    expected: {
      decision: 'NOT_SUPPORTED',
      base_poisha: 0n,
      vat_poisha: 0n,
      gross_poisha: 0n,
      net_payable_poisha: 0n,
      treasury_payable_poisha: 0n,
      must_include_condition_codes: ['INVALID_BASE'],
    },
  },
  {
    id: 'GT-25',
    title_en: 'A document built on another rule pack version is disputed',
    title_bn: 'অন্য রুল প্যাক সংস্করণে তৈরি নথি বিতর্কিত',
    scenario: 'RULE_PACK_VERSION_MISMATCH',
    legislation: 'Rule Pack governance — source of truth',
    input: saleInput({ rule_pack_version: 'bd-2025-v9' }),
    expected: {
      decision: 'SOURCE_DISPUTED_OR_EXPIRED',
      vat_poisha: bdtToPoisha('15000.00'),
      gross_poisha: bdtToPoisha('115000.00'),
      must_include_condition_codes: ['RULE_PACK_VERSION_MISMATCH'],
      must_include_rule_ids: [RULE_IDS.VAT_STD_15],
    },
  },
];

export const GOLDEN_CASE_COUNT = GOLDEN_CASES.length;

function display(value: string | number | bigint | boolean | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'bigint') {
    return `${formatPoisha(value, { locale: 'en-BD' })} (${value.toString()} poisha)`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function stateEvidenceHolds(decision: TaxDecisionDetail): boolean {
  const codes = new Set(decision.conditions.map((condition) => condition.code));
  const hasWarning = decision.conditions.some((condition) => condition.severity === 'WARNING');
  const hasBlocker = decision.conditions.some((condition) => condition.severity === 'BLOCKER');
  switch (decision.decision) {
    case 'SUPPORTED':
      return !hasWarning && !hasBlocker;
    case 'SUPPORTED_WITH_CONDITIONS':
      return hasWarning && !hasBlocker;
    case 'MANUAL_REVIEW':
      return hasBlocker;
    case 'SOURCE_DISPUTED_OR_EXPIRED':
      return hasBlocker && codes.has('RULE_PACK_VERSION_MISMATCH');
    case 'NOT_SUPPORTED':
      return codes.has('INVALID_BASE');
    default:
      return false;
  }
}

export function runGoldenCase(
  testCase: GoldenCase,
  pack: RulePack = BD_2026_V1,
  evaluatedAt: string = isoNow(),
): GoldenCaseResult {
  const decision = evaluateTaxDecision(testCase.input, { rulePack: pack, evaluatedAt });
  const preview = previewTaxJournal(testCase.input, decision);
  const expected = testCase.expected;
  const checks: GoldenCheck[] = [];

  const add = (
    field: string,
    expectedValue: string | number | bigint | boolean | undefined,
    actualValue: string | number | bigint | boolean | undefined,
  ): void => {
    checks.push({
      field,
      expected: display(expectedValue),
      actual: display(actualValue),
      passed: expectedValue === actualValue,
    });
  };

  if (expected.decision !== undefined) add('decision', expected.decision, decision.decision);
  if (expected.base_poisha !== undefined) add('base_poisha', expected.base_poisha, decision.base_poisha);
  if (expected.sd_bps !== undefined) add('sd_bps', expected.sd_bps, decision.sd_bps);
  if (expected.sd_poisha !== undefined) add('sd_poisha', expected.sd_poisha, decision.sd_poisha);
  if (expected.vat_bps !== undefined) add('vat_bps', expected.vat_bps, decision.vat_bps);
  if (expected.vat_poisha !== undefined) add('vat_poisha', expected.vat_poisha, decision.vat_poisha);
  if (expected.vds_bps !== undefined) add('vds_bps', expected.vds_bps, decision.vds_bps);
  if (expected.vds_poisha !== undefined) add('vds_poisha', expected.vds_poisha, decision.vds_poisha);
  if (expected.tds_bps !== undefined) add('tds_bps', expected.tds_bps, decision.tds_bps);
  if (expected.tds_poisha !== undefined) add('tds_poisha', expected.tds_poisha, decision.tds_poisha);
  if (expected.gross_poisha !== undefined) add('gross_poisha', expected.gross_poisha, decision.gross_poisha);
  if (expected.net_payable_poisha !== undefined) {
    add('net_payable_poisha', expected.net_payable_poisha, decision.net_payable_poisha);
  }
  if (expected.treasury_payable_poisha !== undefined) {
    add('treasury_payable_poisha', expected.treasury_payable_poisha, decision.treasury_payable_poisha);
  }
  if (expected.claimable_poisha !== undefined) {
    add('input_credit.claimable_poisha', expected.claimable_poisha, decision.input_credit.claimable_poisha);
  }
  if (expected.disallowed_poisha !== undefined) {
    add('input_credit.disallowed_poisha', expected.disallowed_poisha, decision.input_credit.disallowed_poisha);
  }
  if (expected.input_credit_eligible !== undefined) {
    add('input_credit.eligible', expected.input_credit_eligible, decision.input_credit.eligible);
  }

  if (expected.filing_days !== undefined || expected.filing_due_date !== undefined || expected.filing_holiday_adjusted !== undefined) {
    const filing = decision.filing;
    if (expected.filing_days !== undefined) {
      add('filing.days_after_period', expected.filing_days, filing?.days_after_period);
    }
    if (expected.filing_due_date !== undefined) {
      add('filing.due_date', expected.filing_due_date, filing?.due_date);
    }
    if (expected.filing_holiday_adjusted !== undefined) {
      add('filing.holiday_adjusted', expected.filing_holiday_adjusted, filing?.holiday_adjusted);
    }
  }

  for (const ruleId of expected.must_include_rule_ids ?? []) {
    add(`rule_ids includes ${ruleId}`, true, decision.rule_ids.includes(ruleId));
  }

  const conditionCodes = decision.conditions.map((condition) => condition.code);
  for (const code of expected.must_include_condition_codes ?? []) {
    add(`conditions includes ${code}`, true, conditionCodes.includes(code));
  }
  for (const code of expected.must_not_include_condition_codes ?? []) {
    add(`conditions excludes ${code}`, true, !conditionCodes.includes(code));
  }

  // ---- Invariants that must hold for every vector ------------------------------------------
  add('invariant.gross', decision.base_poisha + decision.sd_poisha + (decision.is_reverse_charge ? 0n : decision.vat_poisha), decision.gross_poisha);
  add('invariant.net', decision.gross_poisha - decision.vds_poisha - decision.tds_poisha, decision.net_payable_poisha);
  add(
    'invariant.treasury',
    decision.vds_poisha + decision.tds_poisha + (decision.is_reverse_charge ? decision.vat_poisha : 0n),
    decision.treasury_payable_poisha,
  );
  if (testCase.input.direction === 'PURCHASE') {
    add(
      'invariant.input_credit',
      decision.vat_poisha,
      decision.input_credit.claimable_poisha + decision.input_credit.disallowed_poisha,
    );
  } else {
    add('invariant.sale_has_no_input_credit', true, decision.input_credit.claimable_poisha === 0n);
  }
  add('invariant.preview_balanced', true, preview.balanced);
  add('invariant.state_evidence', true, stateEvidenceHolds(decision));

  const failed = checks.filter((check) => !check.passed);

  return {
    id: testCase.id,
    title_en: testCase.title_en,
    title_bn: testCase.title_bn,
    scenario: testCase.scenario,
    legislation: testCase.legislation,
    passed: failed.length === 0,
    checks,
    failed_checks: failed,
    decision,
    input: testCase.input,
  };
}

/** Run all 25 vectors against a rule pack. Pure, synchronous and network-free. */
export function runGoldenSuite(options: GoldenSuiteOptions = {}): GoldenSuiteResult {
  const startedAt = Date.now();
  const pack = options.pack ?? BD_2026_V1;
  const evaluatedAt = options.evaluatedAt ?? isoNow();
  const results = GOLDEN_CASES.map((testCase) => runGoldenCase(testCase, pack, evaluatedAt));
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  return {
    total: results.length,
    passed,
    failed,
    checks_run: results.reduce((sum, result) => sum + result.checks.length, 0),
    results,
    ran_at: evaluatedAt,
    rule_pack_version: pack.version,
    duration_ms: Date.now() - startedAt,
    ok: failed === 0,
  };
}
