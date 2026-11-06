// Fintuity Accounting Suite bilingual layer — English (en-BD, default) and Bangla (bn-BD).
//
// The 1,156 workspace / accounting / Mushak labels live in ./locales/* and are composed here so
// that every screen has one translation entry point:
//
//   const t = createTranslator(locale, { numeral });
//   t('sales.title')                       // "Sales & Mushak 6.3"
//   t('rulepack.suitePassed', { pass: 25, fail: 0 })
//
// Missing keys fall back to English and then to the key itself, so a translation gap is visible
// but never crashes a render. The "lab." namespace below is the Phase 1 core foundation screen.
// `searchDictionary()` adds the Banglish tolerance required by the product brief ("kroy",
// "bikroy", "mushak", "ifrs"), searching keys, translated text and transliterated variants.

import {
  formatCount,
  formatPlainNumber,
  formatPoisha,
  toBanglaDigits,
  toLatinDigits,
} from './money';
import { EN_CORE } from './locales/enCore';
import { EN_TAX } from './locales/enTax';
import { EN_OPS } from './locales/enOps';
import { EN_REPORTS } from './locales/enReports';
import { BN_CORE } from './locales/bnCore';
import { BN_TAX } from './locales/bnTax';
import { BN_OPS } from './locales/bnOps';
import { BN_REPORTS } from './locales/bnReports';

export type Locale = 'en-BD' | 'bn-BD';
export type Numeral = 'latin' | 'bn';

export type TranslationValue = string | number | bigint | undefined | null;
export type TranslationVars = Record<string, TranslationValue>;

export interface TranslateOptions {
  /** Override the numeral script used to format numeric placeholders. */
  numeral?: Numeral;
  /** Text returned when the key is missing in both dictionaries. */
  fallback?: string;
}

export interface LocaleDescriptor {
  code: Locale;
  label_en: string;
  label_bn: string;
  native_label: string;
  default_numeral: Numeral;
}

export const DEFAULT_LOCALE: Locale = 'en-BD';

export const LOCALES: readonly LocaleDescriptor[] = [
  { code: 'en-BD', label_en: 'English (en-BD)', label_bn: 'ইংরেজি (en-BD)', native_label: 'English', default_numeral: 'latin' },
  { code: 'bn-BD', label_en: 'Bangla (bn-BD)', label_bn: 'বাংলা (bn-BD)', native_label: 'বাংলা', default_numeral: 'bn' },
];

/** Phase 1 core-foundation screen — English. */
export const EN_LAB: Readonly<Record<string, string>> = {
  'lab.badge': 'Phase 1 · Core foundation',
  'lab.title': 'Fintuity Accounting Suite Core Lab',
  'lab.subtitle':
    'Zero-float poisha arithmetic, bilingual dictionaries and the deterministic Bangladesh tax engine.',
  'lab.footer':
    'Every figure on this page is computed live from BigInt poisha arithmetic and Rule Pack bd-2026-v1. Statutory positions are decision support, not a substitute for professional sign-off.',
  'lab.dictionaryKeys': 'Dictionary keys',
  'lab.parity': 'EN / BN parity',
  'lab.parityComplete': 'Complete',
  'lab.parityIncomplete': 'Incomplete',
  'lab.jsonPatch': 'BigInt JSON patch',
  'lab.statusActive': 'Registered',
  'lab.statusMissing': 'Not registered',
  'lab.moneyTitle': 'Money engine',
  'lab.moneySubtitle':
    'BigInt poisha, Lakh/Crore grouping, Latin ↔ Bangla numerals and statutory Taka-in-words.',
  'lab.sampleTable': 'Sample formatting',
  'lab.columnSample': 'Amount (BDT)',
  'lab.columnActiveFormat': 'Active format',
  'lab.columnWordsEn': 'Taka in words (English)',
  'lab.columnWordsBn': 'Taka in words (Bangla)',
  'lab.rateTitle': 'Basis-point rate application',
  'lab.rateSubtitle':
    'applyRateBps() never touches binary floating point; every rounding mode is explicit.',
  'lab.columnBase': 'Base',
  'lab.columnHalfUp': 'HALF_UP',
  'lab.columnFloor': 'FLOOR',
  'lab.columnCeil': 'CEIL',
  'lab.bigintTitle': 'Serialization guard',
  'lab.bigintSubtitle':
    'The BigInt JSON patch installs itself when money.ts loads, so snapshots and audit exports never throw.',
  'lab.copyJson': 'Copy decision JSON',
  'lab.copied': 'Copied',
  'lab.taxTitle': 'Tax decision lab',
  'lab.taxSubtitle': 'Change the facts; the engine recomputes every poisha and cites the rule.',
  'lab.inputs': 'Transaction facts',
  'lab.baseAmount': 'Base amount (BDT)',
  'lab.invalidAmount': 'Enter a valid amount, for example 125000.00',
  'lab.direction': 'Direction',
  'lab.sale': 'Sale',
  'lab.purchase': 'Purchase',
  'lab.tdsNature': 'TDS nature',
  'lab.withholdingEntity': 'Withholding entity',
  'lab.mushakAttached': 'Mushak 6.3 attached',
  'lab.challanHeld': 'Reverse-charge challan held',
  'lab.sdApplicable': 'Supplementary duty applies',
  'lab.creditNote': 'Mushak 6.7 credit note',
  'lab.nilReturn': 'Nil-return filer',
  'lab.govtOrBank': 'Government / bank / insurer',
  'lab.partyBin': 'Counterparty BIN',
  'lab.partyTin': 'Counterparty e-TIN',
  'lab.periodEnd': 'Tax period end',
  'lab.decisionSubtitle': 'Rule Pack {version} · trace {trace}',
  'lab.suiteIdle': 'Run the suite to verify all 25 vectors.',
  'lab.scenario': 'Scenario',
  'lab.assertions': 'Assertions',
  'lab.firstFailure': 'First failure',
  'lab.showChecks': 'Show checks',
  'lab.hideChecks': 'Hide checks',
  'lab.noRules': 'No rules in this domain.',
  'lab.journalBalanced': 'Preview balanced',
  'lab.journalUnbalanced': 'Preview unbalanced',
  'lab.searchDictionary': 'Search the dictionary — English, Bangla or Banglish',
  'lab.searchHint': 'Try “kroy”, “bikroy”, “mushak”, “ifrs”.',
  'lab.searchNoResults': 'No dictionary match.',
  'lab.goldenShort': 'Golden vectors',
  'lab.activeRules': 'Active rules',
  'lab.bps': 'bps',
  'lab.amount': 'Amount',
  'lab.poisha': 'Poisha',
  'lab.trace': 'Trace',
};

/** Phase 1 core-foundation screen — Bangla. */
export const BN_LAB: Readonly<Record<string, string>> = {
  'lab.badge': 'ফেজ ১ · কোর ভিত্তি',
  'lab.title': 'ফিনটুইটি অ্যাকাউন্টিং স্যুট কোর ল্যাব',
  'lab.subtitle':
    'শূন্য-ফ্লোট পয়সার হিসাব, দ্বিভাষিক অভিধান এবং নির্ধারক বাংলাদেশ কর ইঞ্জিন।',
  'lab.footer':
    'এই পাতার প্রতিটি সংখ্যা বিগইন্ট পয়সা হিসাব ও রুল প্যাক bd-2026-v1 থেকে সরাসরি গণনা করা। বৈধ কর অবস্থান পেশাদার সম্মতির বিকল্প নয়।',
  'lab.dictionaryKeys': 'অভিধান কী',
  'lab.parity': 'ইংরেজি / বাংলা সমতা',
  'lab.parityComplete': 'সম্পূর্ণ',
  'lab.parityIncomplete': 'অসম্পূর্ণ',
  'lab.jsonPatch': 'বিগইন্ট জেসন প্যাচ',
  'lab.statusActive': 'নিবন্ধিত',
  'lab.statusMissing': 'নিবন্ধিত নয়',
  'lab.moneyTitle': 'টাকা ইঞ্জিন',
  'lab.moneySubtitle':
    'বিগইন্ট পয়সা, লক্ষ/কোটি গ্রুপিং, ল্যাটিন ↔ বাংলা সংখ্যা এবং আইনসম্মত কথায় টাকা।',
  'lab.sampleTable': 'নমুনা ফরম্যাটিং',
  'lab.columnSample': 'পরিমাণ (টাকা)',
  'lab.columnActiveFormat': 'সক্রিয় ফরম্যাট',
  'lab.columnWordsEn': 'কথায় টাকা (ইংরেজি)',
  'lab.columnWordsBn': 'কথায় টাকা (বাংলা)',
  'lab.rateTitle': 'বেসিস পয়েন্ট হারে প্রয়োগ',
  'lab.rateSubtitle':
    'applyRateBps() কখনো বাইনারি ফ্লোট ব্যবহার করে না; প্রতিটি রাউন্ডিং পদ্ধতি স্পষ্ট।',
  'lab.columnBase': 'ভিত্তি',
  'lab.columnHalfUp': 'হাফ-আপ',
  'lab.columnFloor': 'ফ্লোর',
  'lab.columnCeil': 'সিল',
  'lab.bigintTitle': 'সিরিয়ালাইজেশন সুরক্ষা',
  'lab.bigintSubtitle':
    'মানি.টিএস লোড হলেই বিগইন্ট জেসন প্যাচ চালু হয়, তাই স্ন্যাপশট ও অডিট এক্সপোর্ট কখনো ব্যর্থ হয় না।',
  'lab.copyJson': 'ডিসিশন জেসন কপি',
  'lab.copied': 'কপি হয়েছে',
  'lab.taxTitle': 'কর সিদ্ধান্ত ল্যাব',
  'lab.taxSubtitle': 'তথ্য বদলান; ইঞ্জিন প্রতিটি পয়সা পুনঃগণনা করে নিয়ম উদ্ধৃত করে।',
  'lab.inputs': 'লেনদেনের তথ্য',
  'lab.baseAmount': 'ভিত্তি পরিমাণ (টাকা)',
  'lab.invalidAmount': 'বৈধ পরিমাণ লিখুন, যেমন ১২৫০০০.০০',
  'lab.direction': 'দিক',
  'lab.sale': 'বিক্রয়',
  'lab.purchase': 'ক্রয়',
  'lab.tdsNature': 'টিডিএস ধরন',
  'lab.withholdingEntity': 'উৎসে কর্তনকারী প্রতিষ্ঠান',
  'lab.mushakAttached': 'মূসক ৬.৩ সংযুক্ত',
  'lab.challanHeld': 'রিভার্স-চার্জ চালান সংরক্ষিত',
  'lab.sdApplicable': 'সম্পূরক শুল্ক প্রযোজ্য',
  'lab.creditNote': 'মূসক ৬.৭ ক্রেডিট নোট',
  'lab.nilReturn': 'শূন্য রিটার্ন দাখিলকারী',
  'lab.govtOrBank': 'সরকারি / ব্যাংক / বিমা',
  'lab.partyBin': 'প্রতিপক্ষের বিআইএন',
  'lab.partyTin': 'প্রতিপক্ষের ই-টিআইএন',
  'lab.periodEnd': 'করমেয়াদ শেষ',
  'lab.decisionSubtitle': 'রুল প্যাক {version} · ট্রেস {trace}',
  'lab.suiteIdle': 'সব ২৫টি ভেক্টর যাচাই করতে স্যুট চালান।',
  'lab.scenario': 'দৃশ্যপট',
  'lab.assertions': 'যাচাই',
  'lab.firstFailure': 'প্রথম ব্যর্থতা',
  'lab.showChecks': 'যাচাই দেখান',
  'lab.hideChecks': 'যাচাই লুকান',
  'lab.noRules': 'এই ক্ষেত্রে কোনো নিয়ম নেই।',
  'lab.journalBalanced': 'প্রিভিউ সুষম',
  'lab.journalUnbalanced': 'প্রিভিউ অসুষম',
  'lab.searchDictionary': 'অভিধানে খুঁজুন — ইংরেজি, বাংলা বা বাংলিশ',
  'lab.searchHint': '“kroy”, “bikroy”, “mushak”, “ifrs” চেষ্টা করুন।',
  'lab.searchNoResults': 'অভিধানে কিছু মেলেনি।',
  'lab.goldenShort': 'গোল্ডেন ভেক্টর',
  'lab.activeRules': 'সক্রিয় নিয়ম',
  'lab.bps': 'বেসিস পয়েন্ট',
  'lab.amount': 'পরিমাণ',
  'lab.poisha': 'পয়সা',
  'lab.trace': 'ট্রেস',
};

export type Dictionary = Readonly<Record<string, string>>;

export const EN_DICTIONARY: Dictionary = {
  ...EN_CORE,
  ...EN_TAX,
  ...EN_OPS,
  ...EN_REPORTS,
  ...EN_LAB,
};

export const BN_DICTIONARY: Dictionary = {
  ...BN_CORE,
  ...BN_TAX,
  ...BN_OPS,
  ...BN_REPORTS,
  ...BN_LAB,
};

export const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = {
  'en-BD': EN_DICTIONARY,
  'bn-BD': BN_DICTIONARY,
};

export const EN_MONTHS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const BN_MONTHS: readonly string[] = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? EN_DICTIONARY;
}

export function defaultNumeral(locale: Locale): Numeral {
  return locale === 'bn-BD' ? 'bn' : 'latin';
}

export function hasTranslation(locale: Locale, key: string): boolean {
  return Boolean(getDictionary(locale)[key]);
}

function formatPlaceholder(value: TranslationValue, locale: Locale, numeral: Numeral): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'bigint') {
    return formatPoisha(value, { locale, numeral, grouping: 'LAKH_CRORE' });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return formatCount(value, numeral);
    return formatPlainNumber(value, { numeral, grouping: 'LAKH_CRORE' });
  }
  return String(value);
}

export function interpolate(template: string, vars?: TranslationVars, locale: Locale = DEFAULT_LOCALE, numeral?: Numeral): string {
  if (!vars) return template;
  const script = numeral ?? defaultNumeral(locale);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in vars)) return match;
    return formatPlaceholder(vars[name], locale, script);
  });
}

export function translate(
  locale: Locale,
  key: string,
  vars?: TranslationVars,
  options: TranslateOptions = {},
): string {
  const dictionary = getDictionary(locale);
  const template = dictionary[key] ?? EN_DICTIONARY[key] ?? options.fallback ?? key;
  return interpolate(template, vars, locale, options.numeral);
}

/** Short alias: `t('en-BD', 'common.total')`. */
export const t = translate;

export type Translator = (key: string, vars?: TranslationVars) => string;

export function createTranslator(locale: Locale, options: TranslateOptions = {}): Translator {
  return (key, vars) => translate(locale, key, vars, options);
}

/** Pick the correct field of a bilingual row without repeating ternaries in every workspace. */
export function localized(locale: Locale, english: string, bangla: string): string {
  return locale === 'bn-BD' ? bangla : english;
}

export function localeLabel(locale: Locale, viewLocale: Locale = locale): string {
  const descriptor = LOCALES.find((entry) => entry.code === locale) ?? LOCALES[0];
  return viewLocale === 'bn-BD' ? descriptor.label_bn : descriptor.label_en;
}

/** "October 2026" / "অক্টোবর ২০২৬" from an ISO date or period code. */
export function monthYearLabel(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const safeIndex = Math.min(11, Math.max(0, monthIndex));
  if (locale === 'bn-BD') {
    return `${BN_MONTHS[safeIndex]} ${toBanglaDigits(String(year))}`;
  }
  return `${EN_MONTHS[safeIndex]} ${year}`;
}

export interface DictionaryParity {
  en_keys: number;
  bn_keys: number;
  missing_in_bn: string[];
  missing_in_en: string[];
  complete: boolean;
}

/** Compile-time-style parity audit used by the Phase 1 lab and by release checks. */
export function dictionaryParity(): DictionaryParity {
  const enKeys = Object.keys(EN_DICTIONARY);
  const bnKeys = Object.keys(BN_DICTIONARY);
  const bnSet = new Set(bnKeys);
  const enSet = new Set(enKeys);
  const missingInBn = enKeys.filter((key) => !bnSet.has(key)).sort();
  const missingInEn = bnKeys.filter((key) => !enSet.has(key)).sort();
  return {
    en_keys: enKeys.length,
    bn_keys: bnKeys.length,
    missing_in_bn: missingInBn,
    missing_in_en: missingInEn,
    complete: missingInBn.length === 0 && missingInEn.length === 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Banglish search
// ---------------------------------------------------------------------------------------------

/**
 * Latin transliterations of common Bangladeshi finance words, mapped to the English vocabulary
 * that actually appears in dictionary keys. "kroy" finds purchases, "bikroy" finds sales.
 */
export const BANGLISH_TERMS: Readonly<Record<string, readonly string[]>> = {
  kroy: ['purchase', 'purchases', 'buy', 'bill'],
  kroykora: ['purchase', 'purchases'],
  kinlam: ['purchase', 'purchases'],
  kena: ['purchase', 'purchases'],
  bikroy: ['sale', 'sales', 'sell', 'invoice'],
  bikri: ['sale', 'sales', 'invoice'],
  bechlam: ['sale', 'sales'],
  mushak: ['vat', 'mushak', 'return', 'tax'],
  mushak91: ['vat', 'return', 'mushak'],
  mushak63: ['vat', 'invoice', 'mushak'],
  chalan: ['challan', 'treasury', 'deposit'],
  challan: ['challan', 'treasury', 'deposit'],
  kor: ['tax'],
  kar: ['tax'],
  vat: ['vat'],
  vds: ['vds'],
  tds: ['tds'],
  tin: ['tin'],
  bin: ['bin'],
  hisab: ['account', 'ledger', 'balance'],
  hishab: ['account', 'ledger', 'balance'],
  khatiyan: ['ledger', 'register'],
  borton: ['payroll', 'salary'],
  beton: ['payroll', 'salary'],
  beetoni: ['payroll', 'salary'],
  bhetan: ['allowance'],
  bilansheet: ['balance', 'sheet', 'sofp'],
  bilans: ['balance', 'sheet'],
  shonchito: ['retained', 'equity', 'reserve'],
  labh: ['profit', 'gain'],
  kshoti: ['loss'],
  baki: ['due', 'outstanding', 'receivable'],
  dena: ['payable', 'due'],
  taka: ['amount', 'money', 'bdt'],
  poisa: ['poisha', 'money'],
  bank: ['bank'],
  bkash: ['bkash', 'mfs', 'wallet'],
  nagad: ['nagad', 'mfs', 'wallet'],
  excel: ['excel', 'xlsx', 'import', 'export'],
  ifrs: ['ifrs', 'report', 'financial'],
  suchok: ['index', 'register'],
  sonchoy: ['savings', 'fund'],
  rin: ['loan', 'borrowing'],
  grati: ['gratuity'],
  bima: ['insurance'],
  aay: ['income'],
  khoroch: ['expense'],
  mulo: ['depreciation'],
  shulko: ['duty'],
  chhuti: ['holiday'],
  melano: ['reconcile', 'match'],
  hishabnikash: ['reconciliation'],
  shesh: ['close', 'closing'],
  khola: ['open', 'opening'],
  baro: ['large'],
  choto: ['small'],
};

let reverseIndex: Map<string, string[]> | null = null;

function banglishReverseIndex(): Map<string, string[]> {
  if (reverseIndex) return reverseIndex;
  const index = new Map<string, string[]>();
  for (const [term, targets] of Object.entries(BANGLISH_TERMS)) {
    const existing = index.get(term) ?? [];
    index.set(term, Array.from(new Set([...existing, ...targets])));
  }
  reverseIndex = index;
  return index;
}

/** Normalize for search: lowercase, Bangla digits to Latin, punctuation to spaces. */
export function normalizeSearch(input: string): string {
  return toLatinDigits(String(input))
    .toLowerCase()
    .replace(/[’'`"“”]/g, '')
    .replace(/[^a-z0-9\u0980-\u09FF.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expand a Banglish query into the English terms used by dictionary keys. */
export function banglishCandidates(query: string): string[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const index = banglishReverseIndex();
  const candidates = new Set<string>([normalized]);
  for (const token of normalized.split(' ')) {
    if (token.length < 2) continue;
    const mapped = index.get(token);
    if (mapped) mapped.forEach((term) => candidates.add(term));
    candidates.add(token);
  }
  return Array.from(candidates);
}

/** Loose relevance score used by the command palette and the Phase 1 search box. */
export function fuzzyScore(query: string, text: string): number {
  const q = normalizeSearch(query);
  const value = normalizeSearch(text);
  if (!q || !value) return 0;
  if (value === q) return 1000;
  if (value.startsWith(q)) return 850;
  if (value.includes(` ${q}`)) return 780;
  if (value.includes(q)) return 700;
  if (value.split(' ').some((token) => token.startsWith(q))) return 640;
  let cursor = 0;
  for (const char of value) {
    if (char === q[cursor]) cursor += 1;
    if (cursor === q.length) return Math.max(240, 420 - Math.min(180, value.length));
  }
  return 0;
}

export interface DictionaryHit {
  key: string;
  text: string;
  score: number;
}

/** Search the active dictionary by key, translated text or Banglish transliteration. */
export function searchDictionary(locale: Locale, query: string, limit = 10): DictionaryHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const dictionary = getDictionary(locale);
  const english = getDictionary('en-BD');
  const candidates = banglishCandidates(trimmed);
  const hits: DictionaryHit[] = [];
  for (const [key, text] of Object.entries(dictionary)) {
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(best, fuzzyScore(candidate, key), fuzzyScore(candidate, text));
      if (best >= 1000) break;
    }
    if (best === 0 && locale !== 'en-BD') {
      best = fuzzyScore(trimmed, english[key] ?? '');
    }
    if (best > 0) hits.push({ key, text, score: best });
  }
  hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return hits.slice(0, Math.max(1, limit));
}
