// Rule Pack bd-2026-v1 — the single source of statutory truth for every tax amount in LedgerVault.
//
// Nothing in the UI, the AI composer or the workspaces may invent a rate. `evaluateTaxDecision()`
// reads only this file, and every rule carries its citation and a `[VERIFY]` flag until tax counsel
// signs the pack off. The 2026 baseline encodes:
//   • Ordinance No. 38 of 2026 (gazetted 14 Oct 2026, effective 13 Oct 2026) replacing s.64 of the
//     VAT & SD Act 2012: Mushak 9.1 is due 15 days after each tax period, 20 days for government,
//     semi-government and autonomous bodies, banks, insurers and nil-return filers.
//   • VAT 15% standard / 5% truncated trading / 7.5% procurement provider / 0% export / exempt.
//   • 15% reverse-charge VAT on imported services under s.20.
//   • s.46 input-credit guardrails (BIN, Mushak 6.3, BDT 1,00,000 cash limit, sub-15% rates).
//   • s.49 VDS withholding plus Mushak 6.6 certification.
//   • TDS under Income Tax Act 2023 ss.89, 90, 91, 92 and 109, upscaled 50% when the vendor's
//     12-digit e-TIN is missing.
//
// All citations are marked [VERIFY] because the pack is pending tax-counsel sign-off.

import type { RulePack, TaxCategory, TaxDomain, TaxRule, TdsNature } from '../types';

export const RULE_PACK_VERSION = 'bd-2026-v1';

/** Central registry so engine, tests and UI never drift on a rule identifier. */
export const RULE_IDS = {
  VAT_FILING_S64_ORD38_2026: 'VAT_FILING_S64_ORD38_2026',
  VAT_FILING_QUARTERLY_TRANSITION_2026: 'VAT_FILING_QUARTERLY_TRANSITION_2026',
  VAT_STD_15: 'VAT_STD_15',
  VAT_TRADING_5: 'VAT_TRADING_5',
  VAT_PROCUREMENT_7_5: 'VAT_PROCUREMENT_7_5',
  VAT_EXPORT_ZERO: 'VAT_EXPORT_ZERO',
  VAT_EXEMPT: 'VAT_EXEMPT',
  VAT_REVERSE_CHARGE_S20: 'VAT_REVERSE_CHARGE_S20',
  SD_SECOND_SCHEDULE_STD: 'SD_SECOND_SCHEDULE_STD',
  S46_REBATE_GUARD: 'S46_REBATE_GUARD',
  VAT_DISALLOWANCE_CAPITALISATION: 'VAT_DISALLOWANCE_CAPITALISATION',
  VDS_WITHHOLDING_S49: 'VDS_WITHHOLDING_S49',
  VDS_CERTIFICATE_MUSHAK_66: 'VDS_CERTIFICATE_MUSHAK_66',
  TDS_GOODS_S89: 'TDS_GOODS_S89',
  TDS_PROF_SVC_S90: 'TDS_PROF_SVC_S90',
  TDS_RENT_S109: 'TDS_RENT_S109',
  TDS_ADVERTISING_S92: 'TDS_ADVERTISING_S92',
  TDS_TRANSPORT_S91: 'TDS_TRANSPORT_S91',
  TDS_NO_TIN_PENALTY_50: 'TDS_NO_TIN_PENALTY_50',
  BIN_FORMAT_THIRTEEN_DIGITS: 'BIN_FORMAT_THIRTEEN_DIGITS',
  ETIN_FORMAT_TWELVE_DIGITS: 'ETIN_FORMAT_TWELVE_DIGITS',
  CASH_DISALLOWANCE_LIMIT_1_LAKH: 'CASH_DISALLOWANCE_LIMIT_1_LAKH',
} as const;

export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

export const STANDARD_VAT_BPS = 1500;
export const TRADING_VAT_BPS = 500;
export const PROCUREMENT_VAT_BPS = 750;
export const REVERSE_CHARGE_VAT_BPS = 1500;

/** Resolved output/input VAT rate for every supported category. */
export const VAT_RATE_BPS_BY_CATEGORY: Record<TaxCategory, number> = {
  STANDARD_15: STANDARD_VAT_BPS,
  TRADING_5: TRADING_VAT_BPS,
  PROCUREMENT_7_5: PROCUREMENT_VAT_BPS,
  EXPORT_ZERO: 0,
  EXEMPT: 0,
  REVERSE_CHARGE: REVERSE_CHARGE_VAT_BPS,
  OUT_OF_SCOPE: 0,
};

/** Supplementary duty default tier for Second Schedule goods (configurable per product). */
export const SD_RATE_BPS = 2000;

/** VDS rates by supply category — the statutory deduction depends on what is being paid for. */
export const VDS_RATE_BPS_BY_CATEGORY: Record<TaxCategory, number> = {
  STANDARD_15: 1500,
  TRADING_5: 500,
  PROCUREMENT_7_5: 750,
  EXPORT_ZERO: 0,
  EXEMPT: 0,
  REVERSE_CHARGE: 0,
  OUT_OF_SCOPE: 0,
};

/** Headline TDS rates under the Income Tax Act 2023, before the no-TIN upscale. */
export const TDS_RATE_BPS_BY_NATURE: Record<TdsNature, number> = {
  NONE: 0,
  SUPPLY_OF_GOODS: 300,
  PROFESSIONAL_OR_TECHNICAL_SERVICES: 1000,
  COMMERCIAL_RENT: 500,
  ADVERTISING_OR_MEDIA: 500,
  TRANSPORT_OR_LOGISTICS: 300,
  CONTRACTOR_OR_SUBCONTRACTOR: 300,
};

/** No-TIN upscale: 3% → 4.5%, 10% → 15%, 5% → 7.5%. Stored in bps of the base rate. */
export const TDS_NO_TIN_UPSCALE_BPS = 5000;

export const VAT_RULE_ID_BY_CATEGORY: Record<TaxCategory, RuleId | null> = {
  STANDARD_15: RULE_IDS.VAT_STD_15,
  TRADING_5: RULE_IDS.VAT_TRADING_5,
  PROCUREMENT_7_5: RULE_IDS.VAT_PROCUREMENT_7_5,
  EXPORT_ZERO: RULE_IDS.VAT_EXPORT_ZERO,
  EXEMPT: RULE_IDS.VAT_EXEMPT,
  REVERSE_CHARGE: RULE_IDS.VAT_REVERSE_CHARGE_S20,
  OUT_OF_SCOPE: null,
};

export const TDS_RULE_ID_BY_NATURE: Record<TdsNature, RuleId | null> = {
  NONE: null,
  SUPPLY_OF_GOODS: RULE_IDS.TDS_GOODS_S89,
  PROFESSIONAL_OR_TECHNICAL_SERVICES: RULE_IDS.TDS_PROF_SVC_S90,
  COMMERCIAL_RENT: RULE_IDS.TDS_RENT_S109,
  ADVERTISING_OR_MEDIA: RULE_IDS.TDS_ADVERTISING_S92,
  TRANSPORT_OR_LOGISTICS: RULE_IDS.TDS_TRANSPORT_S91,
  CONTRACTOR_OR_SUBCONTRACTOR: RULE_IDS.TDS_GOODS_S89,
};

/** s.46: cash settlement above BDT 1,00,000 blocks the input-VAT rebate. 100,000.00 BDT. */
export const CASH_DISALLOWANCE_LIMIT_POISHA = 10_000_000n;

export const FILING_STANDARD_DAYS = 15;
export const FILING_SPECIAL_DAYS = 20;

/**
 * Government holidays that move a statutory due date. Lunar (Eid) dates are gazette-dependent and
 * therefore approximate — marked [VERIFY] until the NBR holiday circular is attached.
 */
export const BD_GOVERNMENT_HOLIDAYS_2026: readonly string[] = [
  '2026-02-21', // International Mother Language Day
  '2026-03-17', // Birthday of Bangabandhu Sheikh Mujibur Rahman
  '2026-03-20', // Eid-ul-Fitr (moon dependent) [VERIFY]
  '2026-03-21', // Eid-ul-Fitr holiday [VERIFY]
  '2026-03-26', // Independence Day
  '2026-04-14', // Pahela Baishakh
  '2026-05-01', // May Day
  '2026-05-27', // Eid-ul-Adha (moon dependent) [VERIFY]
  '2026-05-28', // Eid-ul-Adha holiday [VERIFY]
  '2026-08-15', // National Mourning Day
  '2026-10-20', // Durga Puja — Vijaya Dashami [VERIFY]
  '2026-12-16', // Victory Day
  '2026-12-25', // Christmas Day
];

const RULES: TaxRule[] = [
  {
    id: RULE_IDS.VAT_FILING_S64_ORD38_2026,
    domain: 'FILING',
    title_en: 'Mushak 9.1 filing window — Ordinance No. 38 of 2026',
    title_bn: 'মূসক ৯.১ দাখিলের সময়সীমা — অধ্যাদেশ নং ৩৮/২০২৬',
    description_en:
      'Every standard taxpayer files Mushak 9.1 within 15 days after the end of each tax period. Government, semi-government and autonomous bodies, banks, insurers and nil-return filers get 20 days. A due date that falls on a government holiday or the Friday–Saturday weekend moves to the next working day.',
    description_bn:
      'প্রতিটি সাধারণ করদাতা করমেয়াদ শেষের ১৫ দিনের মধ্যে মূসক ৯.১ দাখিল করবেন। সরকার, আধা-সরকারি ও স্বায়ত্তশাসিত সংস্থা, ব্যাংক, বিমা ও শূন্য রিটার্ন দাখিলকারীর জন্য ২০ দিন। ছুটির দিন বা শুক্র–শনিবার সাপ্তাহিক বন্ধে পড়লে পরবর্তী কার্যদিবসে দাখিল হবে।',
    citation:
      'VAT & SD (Amendment) Ordinance, 2026 (Ordinance No. 38 of 2026), s.64 — gazetted 14 Oct 2026, effective 13 Oct 2026',
    instrument: 'Value Added Tax and Supplementary Duty (Amendment) Ordinance, 2026',
    effective_from: '2026-10-13',
    gazette_date: '2026-10-14',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['filing', 'mushak-9.1', 's.64', 'ordinance-38-2026', 'p0-correction'],
  },
  {
    id: RULE_IDS.VAT_FILING_QUARTERLY_TRANSITION_2026,
    domain: 'FILING',
    title_en: 'Superseded quarterly filing transition (Jul–Sep 2026)',
    title_bn: 'বাতিল হওয়া ত্রৈমাসিক দাখিল পরিবর্তন (জুলাই–সেপ্টেম্বর ২০২৬)',
    description_en:
      'The Finance Act 2026 quarterly-filing proposal never took effect: Ordinance No. 38 of 2026 replaced s.64 while the transitional July–September 2026 quarter was still open. The superseded rule is retained for audit replay only and is never applied to new decisions.',
    description_bn:
      'অর্থ আইন ২০২৬-এর ত্রৈমাসিক দাখিল প্রস্তাব কার্যকর হয়নি: জুলাই–সেপ্টেম্বর ২০২৬ অবস্থান্তরকাল চলাকালীনই অধ্যাদেশ নং ৩৮/২০২৬ ধারা ৬৪ প্রতিস্থাপন করে। বাতিল নিয়মটি কেবল অডিট পুনর্বিবেচনার জন্য সংরক্ষিত, নতুন সিদ্ধান্তে কখনো প্রয়োগ হয় না।',
    citation: 'Finance Act 2026 (superseded), s.64 proposal — historical only',
    instrument: 'Finance Act 2026',
    effective_from: '2026-07-01',
    effective_to: '2026-10-12',
    status: 'SUPERSEDED',
    verify_flag: true,
    tags: ['filing', 'transition', 'superseded'],
  },
  {
    id: RULE_IDS.VAT_STD_15,
    domain: 'VAT',
    title_en: 'Standard VAT 15%',
    title_bn: 'আদর্শ ভ্যাট ১৫%',
    description_en:
      'Standard taxable supply and purchase at 15% on the taxable value. Output VAT is payable to the Treasury; input VAT is creditable only when every s.46 condition is satisfied.',
    description_bn:
      'করযোগ্য মূল্যের ওপর ১৫% হারে আদর্শ করযোগ্য সরবরাহ ও ক্রয়। আউটপুট ভ্যাট কোষাগারে প্রদেয়; ইনপুট ভ্যাট কেবল ধারা ৪৬-এর সব শর্ত পূরণ হলেই সমন্বয়যোগ্য।',
    rate_bps: STANDARD_VAT_BPS,
    citation: 'VAT & SD Act 2012, s.15 and First/Third Schedule',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'standard', '15-percent', 's.15'],
  },
  {
    id: RULE_IDS.VAT_TRADING_5,
    domain: 'VAT',
    title_en: 'Truncated 5% trading tier',
    title_bn: 'হ্রাসকৃত ৫% ট্রেডিং স্তর',
    description_en:
      'Trading-stage supply taxed at the truncated 5% rate. Because the rate is below 15%, s.46 denies input-VAT credit to the supplier; any input tax already paid is capitalised into cost.',
    description_bn:
      'ট্রেডিং পর্যায়ের সরবরাহে হ্রাসকৃত ৫% হার। হার ১৫%-এর কম হওয়ায় ধারা ৪৬ অনুযায়ী সরবরাহকারী ইনপুট ভ্যাট সমন্বয় করতে পারেন না; পূর্বে প্রদত্ত ইনপুট কর ব্যয়ে মূলধনায়িত হয়।',
    rate_bps: TRADING_VAT_BPS,
    citation: 'VAT & SD Act 2012, Third Schedule (trading tier)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'trading', '5-percent', 'truncated'],
  },
  {
    id: RULE_IDS.VAT_PROCUREMENT_7_5,
    domain: 'VAT',
    title_en: 'Procurement provider 7.5% with 100% VDS',
    title_bn: 'প্রকিউরমেন্ট প্রোভাইডার ৭.৫% সহ ১০০% ভিডিএস',
    description_en:
      'Procurement-provider services are taxed at 7.5%; a corporate payer must withhold the full amount as VDS and issue Mushak 6.6. The supplier receives no input rebate at this rate.',
    description_bn:
      'প্রকিউরমেন্ট প্রোভাইডার সেবায় ৭.৫% হার; কর্পোরেট ক্রেতা সম্পূর্ণ অর্থ ভিডিএস হিসেবে কর্তন করে মূসক ৬.৬ ইস্যু করবেন। এই হারে সরবরাহকারী কোনো ইনপুট রিবেট পান না।',
    rate_bps: PROCUREMENT_VAT_BPS,
    citation: 'VAT & SD Act 2012, s.49 and the Third Schedule procurement-provider entry',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'procurement', '7.5-percent', 'vds'],
  },
  {
    id: RULE_IDS.VAT_EXPORT_ZERO,
    domain: 'VAT',
    title_en: 'Zero-rated export supply',
    title_bn: 'শূন্য-হার রপ্তানি সরবরাহ',
    description_en:
      'Exports and zero-rated services carry 0% output VAT and remain fully eligible for input-VAT rebate and duty drawback on associated inputs.',
    description_bn:
      'রপ্তানি ও শূন্য-হার সেবায় আউটপুট ভ্যাট ০% এবং সংশ্লিষ্ট ইনপুটে ইনপুট ভ্যাট রিবেট ও শুল্ক ফেরত সম্পূর্ণভাবে প্রযোজ্য।',
    rate_bps: 0,
    citation: 'VAT & SD Act 2012, s.24 (zero-rated supply)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'export', 'zero-rated', 's.24'],
  },
  {
    id: RULE_IDS.VAT_EXEMPT,
    domain: 'VAT',
    title_en: 'Exempt supply',
    title_bn: 'শুল্কমুক্ত সরবরাহ',
    description_en:
      'First Schedule exempt supplies carry no VAT. Input VAT directly attributable to an exempt supply is not creditable and stays in the cost of the supply.',
    description_bn:
      'প্রথম তফসিলভুক্ত শুল্কমুক্ত সরবরাহে ভ্যাট নেই। শুল্কমুক্ত সরবরাহের সাথে সরাসরি সম্পর্কিত ইনপুট ভ্যাট সমন্বয়যোগ্য নয় এবং সরবরাহের ব্যয়ে থাকে।',
    rate_bps: 0,
    citation: 'VAT & SD Act 2012, First Schedule (exempt goods and services)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'exempt', 'first-schedule'],
  },
  {
    id: RULE_IDS.VAT_REVERSE_CHARGE_S20,
    domain: 'REVERSE_CHARGE',
    title_en: 'Reverse-charge VAT on imported services 15%',
    title_bn: 'আমদানি সেবায় রিভার্স-চার্জ ভ্যাট ১৫%',
    description_en:
      'Bangladeshi recipients self-assess 15% VAT on foreign digital services (Meta, Google Ads, AWS, foreign SaaS) under s.20 and deposit it by Treasury Challan. The self-assessed VAT becomes creditable only once the challan is held.',
    description_bn:
      'বাংলাদেশি গ্রাহক ধারা ২০ অনুযায়ী বিদেশি ডিজিটাল সেবায় (মেটা, গুগল অ্যাডস, এডব্লিউএস, বিদেশি স্যাস) ১৫% ভ্যাট স্ব-নির্ধারণ করে ট্রেজারি চালানে জমা দেন। চালান সংরক্ষিত হলেই স্ব-নির্ধারিত ভ্যাট সমন্বয়যোগ্য হয়।',
    rate_bps: REVERSE_CHARGE_VAT_BPS,
    citation: 'VAT & SD Act 2012, s.20 (imported service — reverse charge)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'reverse-charge', 'imported-service', 's.20'],
  },
  {
    id: RULE_IDS.SD_SECOND_SCHEDULE_STD,
    domain: 'SD',
    title_en: 'Supplementary duty — Second Schedule standard tier 20%',
    title_bn: 'সম্পূরক শুল্ক — দ্বিতীয় তফসিল আদর্শ স্তর ২০%',
    description_en:
      'Supplementary duty applies only to goods listed in the Second Schedule. The 20% tier is the pack default and must be overridden per product where the Schedule prescribes another rate. SD forms part of the taxable value before VAT.',
    description_bn:
      'সম্পূরক শুল্ক কেবল দ্বিতীয় তফসিলভুক্ত পণ্যে প্রযোজ্য। ২০% স্তর প্যাকের ডিফল্ট; তফসিলে অন্য হার থাকলে পণ্যভিত্তিকভাবে পরিবর্তন করতে হবে। এসডি ভ্যাটের আগে করযোগ্য মূল্যের অংশ।',
    rate_bps: SD_RATE_BPS,
    citation: 'VAT & SD Act 2012, s.6 and Second Schedule (supplementary duty)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['sd', 'supplementary-duty', 'second-schedule'],
  },
  {
    id: RULE_IDS.S46_REBATE_GUARD,
    domain: 'REBATE',
    title_en: 'Input tax credit conditions — s.46 guard',
    title_bn: 'ইনপুট ট্যাক্স ক্রেডিট শর্ত — ধারা ৪৬ রক্ষাকবচ',
    description_en:
      'Input VAT is creditable only when (a) the supplier BIN is a valid 13-digit registration, (b) a valid Mushak 6.3 is held, (c) the cash payment does not exceed BDT 1,00,000, and (d) the supply was taxed at 15%. Any failed condition disallows the credit.',
    description_bn:
      'ইনপুট ভ্যাট কেবল তখনই সমন্বয়যোগ্য যখন (ক) সরবরাহকারীর বিআইএন বৈধ ১৩ অঙ্ক, (খ) বৈধ মূসক ৬.৩ সংরক্ষিত, (গ) নগদ পরিশোধ ১,০০,০০০ টাকার বেশি নয় এবং (ঘ) সরবরাহে ১৫% কর প্রয়োগ হয়েছে। কোনো শর্ত ব্যর্থ হলে ক্রেডিট বাতিল।',
    citation: 'VAT & SD Act 2012, s.46 (conditions for input tax credit)',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['rebate', 'input-credit', 's.46', 'guard'],
  },
  {
    id: RULE_IDS.VAT_DISALLOWANCE_CAPITALISATION,
    domain: 'REBATE',
    title_en: 'Disallowed input VAT capitalisation',
    title_bn: 'বাতিল ইনপুট ভ্যাট মূলধনায়ন',
    description_en:
      'VAT disallowed by s.46 is never expensed as tax: it is capitalised into inventory (IAS 2) or the qualifying asset (IAS 16), so gross margin and asset carrying value stay correct.',
    description_bn:
      'ধারা ৪৬-এ বাতিল ভ্যাট কর হিসেবে ব্যয় হয় না: তা মজুদ (আইএএস ২) বা যোগ্য সম্পদে (আইএএস ১৬) মূলধনায়িত হয়, ফলে গ্রস মার্জিন ও সম্পদের বহনমূল্য সঠিক থাকে।',
    citation: 'VAT & SD Act 2012, s.46 read with IAS 2.11 and IAS 16.16',
    instrument: 'VAT & SD Act 2012 / IFRS as adopted by FRC Bangladesh',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['rebate', 'capitalisation', 'ias-2', 'ias-16'],
  },
  {
    id: RULE_IDS.VDS_WITHHOLDING_S49,
    domain: 'VDS',
    title_en: 'VDS — VAT deduction at source (s.49)',
    title_bn: 'ভিডিএস — উৎসে ভ্যাট কর্তন (ধারা ৪৯)',
    description_en:
      'A designated withholding entity deducts VDS from the supplier payment at the statutory rate (15% standard, 7.5% procurement, 5% trading), queues a Treasury challan and issues Mushak 6.6 to the supplier.',
    description_bn:
      'মনোনীত উৎসে কর্তনকারী প্রতিষ্ঠান সরবরাহকারীর অর্থ থেকে বিধিবদ্ধ হারে (আদর্শ ১৫%, প্রকিউরমেন্ট ৭.৫%, ট্রেডিং ৫%) ভিডিএস কাটে, ট্রেজারি চালান তৈরি করে এবং সরবরাহকারীকে মূসক ৬.৬ ইস্যু করে।',
    rate_bps: STANDARD_VAT_BPS,
    citation: 'VAT & SD Act 2012, s.49 and the VDS Rules',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vds', 'withholding', 's.49', 'treasury'],
  },
  {
    id: RULE_IDS.VDS_CERTIFICATE_MUSHAK_66,
    domain: 'VDS',
    title_en: 'Mushak 6.6 withholding certificate',
    title_bn: 'মূসক ৬.৬ উৎসে কর্তন সনদ',
    description_en:
      'Every VDS deduction generates a numbered Mushak 6.6 certificate; the supplier claims the decreasing adjustment only after the certificate and the Treasury challan are verified.',
    description_bn:
      'প্রতিটি ভিডিএস কর্তনে নম্বরযুক্ত মূসক ৬.৬ সনদ তৈরি হয়; সনদ ও ট্রেজারি চালান যাচাইয়ের পরেই সরবরাহকারী হ্রাসকারী সমন্বয় দাবি করতে পারেন।',
    citation: 'VAT & SD Rules 2016, Mushak 6.6 read with s.49',
    instrument: 'Value Added Tax and Supplementary Duty Rules, 2016',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vds', 'mushak-6.6', 'certificate'],
  },
  {
    id: RULE_IDS.TDS_GOODS_S89,
    domain: 'TDS',
    title_en: 'TDS on payment to suppliers of goods — 3%',
    title_bn: 'পণ্য সরবরাহকারীকে পরিশোধে টিডিএস — ৩%',
    description_en:
      'TDS at 3% is deducted on the base value exclusive of VAT when a withholding entity pays a supplier of goods. Missing vendor e-TIN upscales the rate by 50% to 4.5%.',
    description_bn:
      'উৎসে কর্তনকারী প্রতিষ্ঠান পণ্য সরবরাহকারীকে পরিশোধে ভ্যাটবিহীন ভিত্তি মূল্যের ওপর ৩% টিডিএস কাটে। সরবরাহকারীর ই-টিআইএন না থাকলে হার ৫০% বেড়ে ৪.৫% হয়।',
    rate_bps: 300,
    citation: 'Income Tax Act 2023, s.89 (payment to suppliers)',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 's.89', 'goods', '3-percent'],
  },
  {
    id: RULE_IDS.TDS_PROF_SVC_S90,
    domain: 'TDS',
    title_en: 'TDS on professional and technical services — 10%',
    title_bn: 'পেশাদার ও কারিগরি সেবায় টিডিএস — ১০%',
    description_en:
      'TDS at 10% applies to professional, audit, tax, legal and technical service fees on the base value exclusive of VAT. Missing vendor e-TIN upscales the rate by 50% to 15%.',
    description_bn:
      'পেশাদার, নিরীক্ষা, কর, আইন ও কারিগরি সেবার ফি-তে ভ্যাটবিহীন ভিত্তি মূল্যের ওপর ১০% টিডিএস প্রযোজ্য। সরবরাহকারীর ই-টিআইএন না থাকলে হার ৫০% বেড়ে ১৫% হয়।',
    rate_bps: 1000,
    citation: 'Income Tax Act 2023, s.90 (professional and technical services)',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 's.90', 'professional', '10-percent'],
  },
  {
    id: RULE_IDS.TDS_RENT_S109,
    domain: 'TDS',
    title_en: 'TDS on commercial rent — 5%',
    title_bn: 'বাণিজ্যিক ভাড়ায় টিডিএস — ৫%',
    description_en:
      'Commercial office and warehouse rent attracts 5% TDS on the base rent. VAT on rent is handled separately by the landlord and does not form part of the TDS base.',
    description_bn:
      'বাণিজ্যিক অফিস ও গুদাম ভাড়ায় ভিত্তি ভাড়ার ওপর ৫% টিডিএস প্রযোজ্য। ভাড়ার ভ্যাট আলাদাভাবে বাড়িওয়ালা বহন করেন এবং টিডিএস ভিত্তির অংশ নয়।',
    rate_bps: 500,
    citation: 'Income Tax Act 2023, s.109 (commercial rent)',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 's.109', 'rent', '5-percent'],
  },
  {
    id: RULE_IDS.TDS_ADVERTISING_S92,
    domain: 'TDS',
    title_en: 'TDS on advertising and media — 5%',
    title_bn: 'বিজ্ঞাপন ও মিডিয়ায় টিডিএস — ৫%',
    description_en:
      'Advertising, media buying and broadcasting payments carry 5% TDS on the base value, alongside the 15% VAT/VDS treatment.',
    description_bn:
      'বিজ্ঞাপন, মিডিয়া ক্রয় ও সম্প্রচার খরচে ভিত্তি মূল্যের ওপর ৫% টিডিএস প্রযোজ্য, সাথে ১৫% ভ্যাট/ভিডিএস প্রযোজ্য।',
    rate_bps: 500,
    citation: 'Income Tax Act 2023, s.92 (advertising and media services)',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 's.92', 'advertising', '5-percent'],
  },
  {
    id: RULE_IDS.TDS_TRANSPORT_S91,
    domain: 'TDS',
    title_en: 'TDS on transport and logistics — 3%',
    title_bn: 'পরিবহন ও লজিস্টিকসে টিডিএস — ৩%',
    description_en:
      'Freight, courier and logistics payments attract 3% TDS on the base freight value; the courier VAT treatment is applied separately.',
    description_bn:
      'মালবাহী, কুরিয়ার ও লজিস্টিকস পরিশোধে ভিত্তি ভাড়ার ওপর ৩% টিডিএস প্রযোজ্য; কুরিয়ারের ভ্যাট আলাদাভাবে হিসাব হয়।',
    rate_bps: 300,
    citation: 'Income Tax Act 2023, s.91 (transport and logistics)',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 's.91', 'transport', '3-percent'],
  },
  {
    id: RULE_IDS.TDS_NO_TIN_PENALTY_50,
    domain: 'TDS',
    title_en: 'No-TIN TDS upscale of 50%',
    title_bn: 'ই-টিআইএন না থাকলে টিডিএস ৫০% বৃদ্ধি',
    description_en:
      'When the vendor has no valid 12-digit e-TIN on file, the statutory TDS rate is increased by 50%: 3% becomes 4.5%, 5% becomes 7.5% and 10% becomes 15%. The upscale is applied before the poisha amount is computed.',
    description_bn:
      'সরবরাহকারীর বৈধ ১২ অঙ্কের ই-টিআইএন না থাকলে বিধিবদ্ধ টিডিএস হার ৫০% বাড়ে: ৩% হয় ৪.৫%, ৫% হয় ৭.৫% এবং ১০% হয় ১৫%। পয়সার অঙ্ক গণনার আগেই এই বৃদ্ধি প্রয়োগ হয়।',
    citation: 'Income Tax Act 2023, s.89/90 read with the Finance Act 2026 no-TIN penalty schedule',
    instrument: 'Income Tax Act, 2023 / Finance Act, 2026',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 'penalty', 'no-tin', '50-percent'],
  },
  {
    id: RULE_IDS.BIN_FORMAT_THIRTEEN_DIGITS,
    domain: 'VAT',
    title_en: 'BIN must be a valid 13-digit registration',
    title_bn: 'বিআইএন অবশ্যই বৈধ ১৩ অঙ্কের নিবন্ধন',
    description_en:
      'A supplier or buyer BIN is accepted only when it contains exactly 13 digits in the 9-digit business identifier plus 4-digit branch form (for example 001482910-0101). Missing or malformed BINs fail the s.46 evidence test.',
    description_bn:
      'সরবরাহকারী বা ক্রেতার বিআইএন কেবল তখনই গ্রহণযোগ্য যখন এতে ৯ অঙ্কের ব্যবসা শনাক্তকরণ ও ৪ অঙ্কের শাখা মিলিয়ে ঠিক ১৩ অঙ্ক থাকে (যেমন ০০১৪৮২৯১০-০১০১)। বিআইএন না থাকলে বা ভুল থাকলে ধারা ৪৬-এর প্রমাণ পরীক্ষা ব্যর্থ হয়।',
    citation: 'VAT & SD Act 2012, s.2(4) and the BIN registration rules',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['vat', 'bin', 'validation', '13-digit'],
  },
  {
    id: RULE_IDS.ETIN_FORMAT_TWELVE_DIGITS,
    domain: 'TDS',
    title_en: 'e-TIN must be a valid 12-digit number',
    title_bn: 'ই-টিআইএন অবশ্যই বৈধ ১২ অঙ্কের নম্বর',
    description_en:
      'A vendor e-TIN is accepted only when it contains exactly 12 digits and is not a placeholder. A missing or malformed e-TIN triggers the 50% TDS upscale.',
    description_bn:
      'সরবরাহকারীর ই-টিআইএন কেবল তখনই গ্রহণযোগ্য যখন এতে ঠিক ১২ অঙ্ক থাকে এবং তা প্লেসহোল্ডার নয়। ই-টিআইএন না থাকলে বা ভুল থাকলে টিডিএসে ৫০% বৃদ্ধি প্রযোজ্য হয়।',
    citation: 'Income Tax Act 2023, s.2(31) and the NBR e-TIN registration rules',
    instrument: 'Income Tax Act, 2023',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['tds', 'tin', 'validation', '12-digit'],
  },
  {
    id: RULE_IDS.CASH_DISALLOWANCE_LIMIT_1_LAKH,
    domain: 'REBATE',
    title_en: 'Cash payment limit of BDT 1,00,000',
    title_bn: 'নগদ পরিশোধের সীমা ১,০০,০০০ টাকা',
    description_en:
      'A single cash settlement above BDT 1,00,000 (10,000,000 poisha) blocks the input-VAT rebate on that purchase, even when every other s.46 condition is satisfied. The limit is compared against the gross cash paid, inclusive of VAT and SD.',
    description_bn:
      'একক নগদ পরিশোধ ১,০০,০০০ টাকা (১,০০,০০,০০০ পয়সা) ছাড়ালে ওই ক্রয়ের ইনপুট ভ্যাট রিবেট বন্ধ হয়ে যায়, যদিও ধারা ৪৬-এর অন্য সব শর্ত পূরণ হয়েছে। সীমাটি ভ্যাট ও এসডিসহ মোট নগদ পরিশোধের সাথে তুলনা করা হয়।',
    citation: 'VAT & SD Act 2012, s.46(1) and the VAT Rules cash-payment condition',
    instrument: 'Value Added Tax and Supplementary Duty Act, 2012',
    effective_from: '2026-07-01',
    status: 'ACTIVE',
    verify_flag: true,
    tags: ['rebate', 'cash-limit', '1-lakh', 's.46'],
  },
];

export const BD_2026_V1: RulePack = {
  version: RULE_PACK_VERSION,
  jurisdiction: 'BD',
  title_en: 'Bangladesh Statutory Rule Pack 2026 (VAT, SD, VDS, TDS)',
  title_bn: 'বাংলাদেশ বিধিবদ্ধ রুল প্যাক ২০২৬ (ভ্যাট, এসডি, ভিডিএস, টিডিএস)',
  published_at: '2026-10-14',
  effective_from: '2026-07-01',
  reviewer: 'Tax Counsel Review Queue — NBR citations pending sign-off',
  reviewer_status: 'PENDING_TAX_COUNSEL',
  rules: RULES,
  historical_notes: [
    {
      period: '2026-07-01 .. 2026-10-12',
      note_en:
        'Transitional quarter. The Finance Act 2026 quarterly-filing proposal was published but superseded before it could govern a filing cycle; the quarter is preserved for audit replay only.',
      note_bn:
        'অবস্থান্তরকালীন ত্রৈমাসিক। অর্থ আইন ২০২৬-এর ত্রৈমাসিক দাখিল প্রস্তাব প্রকাশিত হয়েছিল কিন্তু কোনো দাখিল চক্র পরিচালনার আগেই বাতিল হয়; ত্রৈমাসিকটি কেবল অডিট পুনর্বিবেচনার জন্য সংরক্ষিত।',
    },
    {
      period: '2026-10-13 ..',
      note_en:
        'Ordinance No. 38 of 2026 (gazetted 14 Oct 2026, effective 13 Oct 2026) replaced s.64 of the VAT & SD Act 2012. Mushak 9.1 is now due 15 days after each tax period, or 20 days for government, semi-government and autonomous bodies, banks, insurers and nil-return filers.',
      note_bn:
        'অধ্যাদেশ নং ৩৮/২০২৬ (গেজেট ১৪ অক্টোবর ২০২৬, কার্যকর ১৩ অক্টোবর ২০২৬) ভ্যাট ও এসডি আইন ২০১২-এর ধারা ৬৪ প্রতিস্থাপন করেছে। এখন মূসক ৯.১ করমেয়াদ শেষের ১৫ দিনের মধ্যে, এবং সরকার, আধা-সরকারি ও স্বায়ত্তশাসিত সংস্থা, ব্যাংক, বিমা ও শূন্য রিটার্ন দাখিলকারীর জন্য ২০ দিনের মধ্যে দাখিল করতে হবে।',
    },
    {
      period: '2027-01-01 ..',
      note_en:
        'IFRS 18 becomes effective 1 January 2027. It changes presentation and disclosure, not tax law: the tax engine keeps producing the same rule pack while the reporting layer adds the five P&L categories and the two mandatory subtotals.',
      note_bn:
        'আইএফআরএস ১৮ ১ জানুয়ারি ২০২৭ থেকে কার্যকর। এটি উপস্থাপন ও প্রকাশ বদলায়, কর আইন নয়: কর ইঞ্জিন একই রুল প্যাক দিতে থাকবে, আর রিপোর্টিং স্তর পাঁচটি লাভ-ক্ষতি বিভাগ ও দুটি বাধ্যতামূলক উপমোট যোগ করবে।',
    },
  ],
};

export function getRule(ruleId: string, pack: RulePack = BD_2026_V1): TaxRule | undefined {
  return pack.rules.find((rule) => rule.id === ruleId);
}

export function rulesByDomain(domain: TaxDomain | 'ALL', pack: RulePack = BD_2026_V1): TaxRule[] {
  const rules = domain === 'ALL' ? pack.rules : pack.rules.filter((rule) => rule.domain === domain);
  return [...rules].sort((a, b) => a.id.localeCompare(b.id));
}

export function ruleCitation(ruleId: string, pack: RulePack = BD_2026_V1): string {
  return getRule(ruleId, pack)?.citation ?? '';
}

function utcDay(isoDate: string): Date | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Bangladesh government offices are closed Friday (5) and Saturday (6). */
export function isWeekend(isoDate: string): boolean {
  const date = utcDay(isoDate);
  if (!date) return false;
  const day = date.getUTCDay();
  return day === 5 || day === 6;
}

export function isGovernmentHoliday(isoDate: string): boolean {
  return BD_GOVERNMENT_HOLIDAYS_2026.includes(isoDate);
}

function addIsoDays(isoDate: string, days: number): string {
  const date = utcDay(isoDate);
  if (!date) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Advance a statutory due date past the BDT weekend and the gazetted holiday list. */
export function nextWorkingDay(isoDate: string): string {
  let candidate = isoDate;
  for (let guard = 0; guard < 30; guard += 1) {
    if (!isWeekend(candidate) && !isGovernmentHoliday(candidate)) return candidate;
    candidate = addIsoDays(candidate, 1);
  }
  return candidate;
}

export function addWorkingDays(isoDate: string, days: number): string {
  return nextWorkingDay(addIsoDays(isoDate, days));
}

export function isRuleActiveOn(rule: TaxRule, isoDate: string, pack: RulePack = BD_2026_V1): boolean {
  if (rule.status !== 'ACTIVE') return false;
  if (rule.effective_from && rule.effective_from > isoDate) return false;
  if (rule.effective_to && rule.effective_to < isoDate) return false;
  return isoDate >= pack.effective_from;
}

export function activeRules(isoDate: string, pack: RulePack = BD_2026_V1): TaxRule[] {
  return pack.rules.filter((rule) => isRuleActiveOn(rule, isoDate, pack));
}
