// LedgerVault — Signature component #2: the Transaction Composer.
//
// One natural-language bar accepts English, Bangla or Banglish, parses it *deterministically* (no
// model call, no network: the same sentence always produces the same draft), then renders the live
// TaxAdvisorCard for a 1-click post into the balanced ledger through `VaultContext`.
//
// The parser is intentionally a small grammar, not magic:
//   - direction    ← verb lexicon (paid / sold / dilam / bikroy ...)
//   - amount       ← currency-anchored number, or quantity × unit price ("200 bags at BDT 550")
//   - counterparty ← known-party token match first, then the "to X" / "থেকে X" clause
//   - settlement   ← bKash / Nagad / bank / card / cash / cheque lexicon
//   - tax nature   ← consultancy, rent, advertising, transport, contractor, goods ...
//
// Everything the parse could not pin down stays visible and editable before posting — the composer
// never guesses silently.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Coins,
  CreditCard,
  FileText,
  Landmark,
  Languages,
  Package,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  Store,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { useVault } from '../../context/VaultContext';
import { useWorkspaceNav } from '../layout/WorkspaceNav';
import { evaluateTaxDecision, previewTaxJournal } from '../../core/tax-engine/engine';
import type {
  CommercialDoc,
  CreateDocInput,
  Party,
  PaymentMethod,
  TaxCategory,
  TaxEvaluationInput,
  TdsNature,
} from '../../core/types';

// ---------------------------------------------------------------------------------------------
// Lexicons + deterministic parser
// ---------------------------------------------------------------------------------------------

type Direction = 'SALE' | 'PURCHASE';
type LanguageTag = 'EN' | 'BN' | 'BANGLISH';

export interface ParsedTransaction {
  language: LanguageTag;
  direction: Direction | null;
  amount_poisha: bigint;
  quantity: number;
  unit_price_poisha: bigint | null;
  unit: string | null;
  description_en: string;
  description_bn: string;
  party_query: string | null;
  payment_method: PaymentMethod;
  tax_category: TaxCategory;
  tds_nature: TdsNature;
  reverse_charge: boolean;
  confidence: number;
  notes: string[];
}

const SALE_VERBS = [
  'sold',
  'sell',
  'sale',
  'invoiced',
  'invoicing',
  'billed',
  'bikroy',
  'bikri',
  'bechlam',
  'bechechi',
  'bechi',
  'বিক্রয়',
  'বিক্রি',
  'বেচেছি',
  'বেচলাম',
  'বেচে',
];

const PURCHASE_VERBS = [
  'paid',
  'pay',
  'paying',
  'bought',
  'buy',
  'purchase',
  'purchased',
  'spent',
  'expense',
  'dilam',
  'diyechi',
  'dilum',
  'kinechi',
  'kinlam',
  'kroy',
  'kini',
  'খরচ',
  'প্রদান',
  'পরিশোধ',
  'দিলাম',
  'দিয়েছি',
  'কিনেছি',
  'কিনলাম',
];

const REVERSE_CHARGE_WORDS = [
  'meta',
  'facebook',
  'google',
  'aws',
  'amazon web',
  'adobe',
  'microsoft',
  'openai',
  'foreign',
  'overseas',
  'imported service',
  'reverse charge',
  'বিদেশি',
  'বিলেত',
  'আমদানি',
];

const SERVICE_WORDS = [
  'consultancy',
  'consulting',
  'consultant',
  'advisory',
  'professional fee',
  'service',
  'services',
  'পরামর্শ',
  'সেবা',
  'ফি',
];

const UNIT_WORDS: Array<{ pattern: RegExp; unit: string }> = [
  { pattern: /bags?|বস্তা|ব্যাগ/, unit: 'bag' },
  { pattern: /pcs?|pieces?|পিস/, unit: 'pcs' },
  { pattern: /units?|টি|ইউনিট/, unit: 'unit' },
  { pattern: /kgs?|kg|কেজি|কিলো/, unit: 'kg' },
  { pattern: /tons?|tonnes?|টন/, unit: 'ton' },
  { pattern: /litres?|liters?|ltr|লিটার/, unit: 'litre' },
  { pattern: /dozen|ডজন/, unit: 'dozen' },
  { pattern: /metres?|meters?|mtr|মিটার/, unit: 'metre' },
  { pattern: /সিমেন্ট/, unit: 'bag' },
];

const BN_GLOSSARY: Array<[RegExp, string]> = [
  [/cement/i, 'সিমেন্ট'],
  [/consult|advisory/i, 'পরামর্শ সেবা'],
  [/advertis|ads?\b|meta|facebook|google/i, 'বিজ্ঞাপন সেবা'],
  [/rent/i, 'অফিস ভাড়া'],
  [/transport|freight|courier/i, 'পরিবহন সেবা'],
  [/software|subscription|licen[cs]e/i, 'সফটওয়্যার সেবা'],
  [/salary|payroll/i, 'বেতন'],
  [/utilit|electric|gas|water/i, 'ইউটিলিটি বিল'],
];

const EN_GLOSSARY: Array<[RegExp, string]> = [
  [/পরামর্শ/, 'Professional consultancy service'],
  [/ভাড়া/, 'Commercial rent'],
  [/বিজ্ঞাপন/, 'Advertising & media service'],
  [/পরিবহন/, 'Transport & logistics service'],
  [/সিমেন্ট/, 'Cement'],
  [/বেতন/, 'Salary'],
  [/বিদ্যুৎ|গ্যাস|ইউটিলিটি/, 'Utility bill'],
];

const FILLER_WORDS =
  /\b(paid|pay|paying|sold|sell|sale|bought|buy|purchase|purchased|invoice|invoiced|billed|bill|expense|spent|to|from|via|by|through|using|at|for|on|the|a|an|of|and|with|today|please|bdt|tk|taka|cash|bank|card|cheque|check|account|taka)\b/gi;

const BN_FILLER = /(দিলাম|দিয়েছি|পেয়েছি|কিনেছি|বিক্রয়|বিক্রি|খরচ|প্রদান|পরিশোধ|থেকে|কাছে|টাকা|নগদ|বিকাশ|ব্যাংক|মাধ্যমে|করেছি|হয়েছে)/g;

/** Unit nouns stripped out of the free-text description ("200 bags cement" → "cement"). */
const UNIT_STRIP = new RegExp(
  `\\b(${UNIT_WORDS.map((entry) => entry.pattern.source).join('|')})\\b`,
  'gi',
);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLatinNumberString(value: string): string {
  const bn = '০১২৩৪৫৬৭৮৯';
  return value.replace(/[০-৯]/g, (digit) => String(bn.indexOf(digit)));
}

function parseTaka(raw: string, multiplier: bigint): bigint {
  const cleaned = toLatinNumberString(raw).replace(/[^0-9.]/g, '');
  if (!cleaned) return 0n;
  const [whole, fraction = ''] = cleaned.split('.');
  const paisa = `${fraction}00`.slice(0, 2);
  try {
    const wholePart = BigInt(whole || '0');
    const paisaPart = BigInt(paisa || '0');
    return (wholePart * 100n + paisaPart) * multiplier;
  } catch {
    return 0n;
  }
}

interface NumberToken {
  raw: string;
  index: number;
  poisha: bigint;
  multiplier: bigint;
}

const MULTIPLIERS: Array<{ pattern: RegExp; factor: bigint }> = [
  { pattern: /^(?:lakh|lac|lakhs|লাখ|লক্ষ)/, factor: 100000n },
  { pattern: /^(?:crore|cr|কোটি)/, factor: 10000000n },
  { pattern: /^(?:thousand|hazar|হাজার|k)$/, factor: 1000n },
];

function extractNumberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  const pattern = /(\d[\d,]*(?:\.\d+)?)/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const raw = match[1];
    const suffix = text.slice(match.index + raw.length, match.index + raw.length + 12);
    let factor = 1n;
    for (const entry of MULTIPLIERS) {
      if (entry.pattern.test(suffix.trim().toLowerCase())) {
        factor = entry.factor;
        break;
      }
    }
    tokens.push({ raw, index: match.index, poisha: parseTaka(raw, factor), multiplier: factor });
    match = pattern.exec(text);
  }
  return tokens;
}

function isAdjacent(
  text: string,
  index: number,
  rawLength: number,
  patterns: RegExp[],
  window = 24,
): boolean {
  const before = text.slice(Math.max(0, index - window), index);
  const after = text.slice(index + rawLength, index + rawLength + window);
  return patterns.some((pattern) => pattern.test(before) || pattern.test(after));
}

const CURRENCY_NEAR = [/(?:bdt|tk|৳|taka|টাকা)\s*:?\s*$/i, /^\s*(?:bdt|tk|taka|৳|টাকা)/i];
const UNIT_RATE_NEAR = [/(?:at|@|per|each|প্রতি)\s*(?:bdt|tk|৳|taka|টাকা)?\s*:?\s*$/i];

function lookupUnit(text: string): string | null {
  for (const entry of UNIT_WORDS) {
    if (entry.pattern.test(text)) return entry.unit;
  }
  return null;
}

function extractPartyQuery(text: string): string | null {
  const en =
    text.match(
      /\b(?:to|from|for the account of|in favour of)\s+([a-z][a-z0-9&.'\- ]{1,44}?)(?=\s+(?:via|by|through|using|against|on|at|in)\b|[,.!?;]|$)/i,
    ) ?? null;
  if (en) return cleanPartyName(en[1]);
  const bn = text.match(/([\u0980-\u09FF][\u0980-\u09FF\s.]{0,34}?)\s*(?:এর\s*কাছে|র\s*কাছে|কে|থেকে)/);
  if (bn) return cleanPartyName(bn[1]);
  return null;
}

function cleanPartyName(value: string): string {
  return value
    .replace(/^(the|mr|mrs|ms)\s+/i, '')
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(raw: string): LanguageTag {
  const hasBangla = /[\u0980-\u09FF]/.test(raw);
  const hasLatin = /[a-z]/i.test(raw);
  if (hasBangla && hasLatin) return 'BANGLISH';
  if (hasBangla) return 'BN';
  return 'EN';
}

function detectDirection(text: string): { direction: Direction | null; verb: string | null } {
  for (const verb of SALE_VERBS) {
    if (text.includes(verb)) return { direction: 'SALE', verb };
  }
  for (const verb of PURCHASE_VERBS) {
    if (text.includes(verb)) return { direction: 'PURCHASE', verb };
  }
  return { direction: null, verb: null };
}

function detectPaymentMethod(text: string): { method: PaymentMethod; matched: string | null } {
  const rules: Array<{ pattern: RegExp; method: PaymentMethod }> = [
    { pattern: /bkash|bikash|nagad|rocket|upay|mfs|বিকাশ|রকেট|উপায়/, method: 'MFS' },
    { pattern: /credit card|debit card|card|visa|mastercard|কার্ড/, method: 'CREDIT_CARD' },
    { pattern: /cheque|check|চেক/, method: 'CHEQUE' },
    { pattern: /cash|hand|ক্যাশ|নগদ|নগদে/, method: 'CASH' },
    {
      pattern: /bank|city bank|brac|dbbl|hsbc|islami|account|transfer|ব্যাংক|হিসাব/,
      method: 'BANK',
    },
  ];
  for (const rule of rules) {
    const found = text.match(rule.pattern);
    if (found) return { method: rule.method, matched: found[0] };
  }
  return { method: 'BANK', matched: null };
}

function detectTdsNature(text: string, direction: Direction | null): TdsNature {
  if (/consult|advisory|professional|পরামর্শ|ফি/.test(text)) return 'PROFESSIONAL_OR_TECHNICAL_SERVICES';
  if (/rent|ভাড়া/.test(text)) return 'COMMERCIAL_RENT';
  if (/ads?\b|advertis|marketing|promotion|বিজ্ঞাপন/.test(text)) return 'ADVERTISING_OR_MEDIA';
  if (/transport|freight|courier|logistics|পরিবহন/.test(text)) return 'TRANSPORT_OR_LOGISTICS';
  if (/contractor|subcontract|construction|ঠিকাদার/.test(text)) return 'CONTRACTOR_OR_SUBCONTRACTOR';
  if (direction === 'SALE') return 'NONE';
  if (/goods|cement|bag|stock|পণ্য|সিমেন্ট|বস্তা/.test(text)) return 'SUPPLY_OF_GOODS';
  return direction === 'PURCHASE' ? 'SUPPLY_OF_GOODS' : 'NONE';
}

function detectCategory(text: string): { category: TaxCategory; reverseCharge: boolean } {
  if (REVERSE_CHARGE_WORDS.some((word) => text.includes(word))) {
    return { category: 'REVERSE_CHARGE', reverseCharge: true };
  }
  if (/export|রপ্তানি/.test(text)) return { category: 'EXPORT_ZERO', reverseCharge: false };
  if (/\bexempt\b|মুক্ত/.test(text)) return { category: 'EXEMPT', reverseCharge: false };
  if (/7\.5%|7\.5 percent|procurement|ক্রয় সংস্থা/.test(text)) {
    return { category: 'PROCUREMENT_7_5', reverseCharge: false };
  }
  if (/\b5%|5 percent|trading|ট্রেডিং/.test(text)) return { category: 'TRADING_5', reverseCharge: false };
  return { category: 'STANDARD_15', reverseCharge: false };
}

function describeSubject(raw: string, text: string, partyQuery: string | null): { en: string; bn: string } {
  let working = raw;

  if (partyQuery) {
    working = working.replace(new RegExp(escapeRegExp(partyQuery), 'gi'), ' ');
  }
  working = working.replace(/[\d,]+(?:\.\d+)?/g, ' ');
  working = working.replace(
    /\b(via|by|through|using|to|from|at|for|on|the|a|an|bdt|tk|taka|cash|bank|card|cheque|account)\b/gi,
    ' ',
  );
  working = working.replace(FILLER_WORDS, ' ');
  working = working.replace(BN_FILLER, ' ');
  working = working.replace(UNIT_STRIP, ' ');
  working = working.replace(/[^\w\u0980-\u09FF\s.&-]/g, ' ');
  working = working.replace(/\s+/g, ' ').trim();

  if (working.length < 3) {
    const hasBangla = /[\u0980-\u09FF]/.test(raw);
    return hasBangla
      ? { en: 'Goods / services as described', bn: 'বর্ণনা অনুযায়ী পণ্য / সেবা' }
      : { en: 'Goods / services as described', bn: 'বর্ণনা অনুযায়ী পণ্য / সেবা' };
  }

  const words = working.split(' ').slice(0, 6).join(' ');
  const en = capitalize(words);
  let bn = '';
  for (const [pattern, label] of BN_GLOSSARY) {
    if (pattern.test(raw)) {
      bn = label;
      break;
    }
  }
  if (!bn) {
    for (const [pattern, label] of EN_GLOSSARY) {
      if (pattern.test(raw)) {
        bn = label;
        break;
      }
    }
  }
  if (!bn) bn = /[\u0980-\u09FF]/.test(raw) ? words : 'বর্ণনা অনুযায়ী পণ্য / সেবা';
  return { en, bn };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function parseTransaction(rawInput: string): ParsedTransaction {
  const raw = rawInput.trim();
  const text = normalizeText(toLatinNumberString(raw)).replace(/\s+/g, ' ');
  const notes: string[] = [];

  const language = detectLanguage(raw);
  const { direction, verb } = detectDirection(text);
  if (verb) notes.push(`Direction from “${verb}” → ${direction ?? 'unknown'}`);

  const payment = detectPaymentMethod(text);
  if (payment.matched) notes.push(`Settlement channel “${payment.matched}” → ${payment.method}`);

  const tokens = extractNumberTokens(text);
  const unit = lookupUnit(text);

  let quantity = 0;
  let quantityToken: NumberToken | null = null;
  if (unit) {
    const unitPattern = new RegExp(
      `(${UNIT_WORDS.map((entry) => entry.pattern.source).join('|')})`,
      'i',
    );
    const unitMatch = text.match(unitPattern);
    if (unitMatch && unitMatch.index !== undefined) {
      const before = text.slice(0, unitMatch.index);
      const quantityMatch = before.match(/(\d[\d,]*(?:\.\d+)?)\s*$/);
      if (quantityMatch) {
        const index = before.length - quantityMatch[0].length;
        const token = tokens.find((candidate) => candidate.index === index);
        quantityToken = token ?? null;
        quantity = Number(toLatinNumberString(quantityMatch[1]).replace(/,/g, '')) || 0;
        if (quantity > 0) notes.push(`Quantity ${quantity} ${unit}`);
      }
    }
  }

  const unitPriceToken =
    tokens.find((token) => isAdjacent(text, token.index, token.raw.length, UNIT_RATE_NEAR, 12)) ??
    null;
  const currencyToken =
    tokens.find(
      (token) =>
        token !== quantityToken &&
        isAdjacent(text, token.index, token.raw.length, CURRENCY_NEAR, 14),
    ) ?? null;

  let amount = 0n;
  let unitPrice: bigint | null = null;

  if (quantityToken && unitPriceToken && quantity > 0) {
    unitPrice = unitPriceToken.poisha;
    amount = BigInt(quantity) * unitPrice;
    notes.push(`Amount = ${quantity} × unit price → ${amount.toString()} poisha`);
  } else if (currencyToken) {
    amount = currencyToken.poisha;
    notes.push(`Currency-anchored amount “${currencyToken.raw}”`);
  } else if (quantityToken && tokens.length > 1) {
    const bigger = tokens
      .filter((token) => token !== quantityToken)
      .sort((a, b) => (a.poisha > b.poisha ? -1 : 1))[0];
    amount = bigger.poisha;
    notes.push(`Largest non-quantity number “${bigger.raw}”`);
  } else if (tokens.length > 0) {
    const biggest = [...tokens].sort((a, b) => (a.poisha > b.poisha ? -1 : 1))[0];
    amount = biggest.poisha;
    notes.push(`Largest number “${biggest.raw}”`);
  }

  if (amount > 0n && quantity === 0) {
    quantity = 1;
  }
  if (amount > 0n && unitPrice === null && quantity > 1) {
    unitPrice = amount / BigInt(quantity);
  }

  const partyQuery = extractPartyQuery(raw);
  if (partyQuery) notes.push(`Counterparty phrase “${partyQuery}”`);

  const { category, reverseCharge } = detectCategory(text);
  const tdsNature = detectTdsNature(text, direction);
  const description = describeSubject(raw, text, partyQuery);

  let confidence = 25;
  if (amount > 0n) confidence += 30;
  if (direction) confidence += 20;
  if (partyQuery) confidence += 15;
  if (payment.matched) confidence += 10;
  if (confidence > 98) confidence = 98;

  return {
    language,
    direction,
    amount_poisha: amount,
    quantity,
    unit_price_poisha: unitPrice,
    unit,
    description_en: description.en,
    description_bn: description.bn,
    party_query: partyQuery,
    payment_method: payment.method,
    tax_category: category,
    tds_nature: tdsNature,
    reverse_charge: reverseCharge,
    confidence,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Demo chips — one click, fully deterministic parse
// ---------------------------------------------------------------------------------------------

interface DemoChip {
  id: string;
  tag: string;
  labelEn: string;
  labelBn: string;
  text: string;
}

const DEMO_CHIPS: DemoChip[] = [
  {
    id: 'consultancy',
    tag: 'EN',
    labelEn: 'Consultancy · City Bank',
    labelBn: 'পরামর্শ বিল · সিটি ব্যাংক',
    text: 'Paid BDT 1,00,000 consultancy fee to Rahman & Chowdhury Chartered Accountants via City Bank',
  },
  {
    id: 'cement',
    tag: 'EN',
    labelEn: 'Cement sale · 200 bags',
    labelBn: 'সিমেন্ট বিক্রয় · ২০০ বস্তা',
    text: 'Sold 200 bags Cement at BDT 550 to Meghna Distribution Ltd.',
  },
  {
    id: 'meta-ads',
    tag: 'EN',
    labelEn: 'Meta Ads · BRAC card',
    labelBn: 'মেটা অ্যাড · ব্র্যাক কার্ড',
    text: 'Paid Meta Ads BDT 80,000 via BRAC Card',
  },
  {
    id: 'bangla-rent',
    tag: 'বাংলা',
    labelEn: 'Office rent · bKash',
    labelBn: 'অফিস ভাড়া · বিকাশ',
    text: 'মতিঝিল প্রপার্টিজ লিমিটেডকে বিকাশে ৫০,০০০ টাকা অফিস ভাড়া দিলাম',
  },
  {
    id: 'bangla-sale',
    tag: 'বাংলা',
    labelEn: 'Cement sale · বাংলা',
    labelBn: 'সিমেন্ট বিক্রয় · বাংলা',
    text: 'মেঘনা ডিস্ট্রিবিউশন লিমিটেডের কাছে ২০০ বস্তা সিমেন্ট বিক্রি করেছি বস্তা প্রতি ৫৫০ টাকা, বিকাশে',
  },
  {
    id: 'banglish-consult',
    tag: 'Banglish',
    labelEn: 'Consultancy · Banglish',
    labelBn: 'পরামর্শ · বাংলিশ',
    text: 'Rahman & Chowdhury ke BDT 25,000 consultancy fee dilam bKash e',
  },
];

const PAYMENT_METHODS: PaymentMethod[] = ['BANK', 'MFS', 'CASH', 'CHEQUE', 'CREDIT_CARD'];
const CATEGORIES: TaxCategory[] = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
];
const TDS_NATURES: TdsNature[] = [
  'NONE',
  'SUPPLY_OF_GOODS',
  'PROFESSIONAL_OR_TECHNICAL_SERVICES',
  'COMMERCIAL_RENT',
  'ADVERTISING_OR_MEDIA',
  'TRANSPORT_OR_LOGISTICS',
  'CONTRACTOR_OR_SUBCONTRACTOR',
];

const HUMAN_LABEL: Record<string, string> = {
  STANDARD_15: 'Standard 15%',
  TRADING_5: 'Trading 5%',
  PROCUREMENT_7_5: 'Procurement 7.5%',
  EXPORT_ZERO: 'Export 0%',
  EXEMPT: 'Exempt',
  REVERSE_CHARGE: 'Reverse charge 15%',
  OUT_OF_SCOPE: 'Out of scope',
  SUPPLY_OF_GOODS: 'Supply of goods',
  PROFESSIONAL_OR_TECHNICAL_SERVICES: 'Professional / technical',
  COMMERCIAL_RENT: 'Commercial rent',
  ADVERTISING_OR_MEDIA: 'Advertising / media',
  TRANSPORT_OR_LOGISTICS: 'Transport / logistics',
  CONTRACTOR_OR_SUBCONTRACTOR: 'Contractor / subcontractor',
  NONE: 'No TDS',
  BANK: 'Bank transfer',
  MFS: 'MFS (bKash / Nagad)',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  CREDIT_CARD: 'Credit card',
};

const HUMAN_LABEL_BN: Record<string, string> = {
  STANDARD_15: 'প্রমিত ১৫%',
  TRADING_5: 'ট্রেডিং ৫%',
  PROCUREMENT_7_5: 'ক্রয় ৭.৫%',
  EXPORT_ZERO: 'রপ্তানি ০%',
  EXEMPT: 'অব্যহত',
  REVERSE_CHARGE: 'রিভার্স চার্জ ১৫%',
  OUT_OF_SCOPE: 'পরিধির বাইরে',
  SUPPLY_OF_GOODS: 'পণ্য সরবরাহ',
  PROFESSIONAL_OR_TECHNICAL_SERVICES: 'পেশাদার / কারিগরি',
  COMMERCIAL_RENT: 'বাণিজ্যিক ভাড়া',
  ADVERTISING_OR_MEDIA: 'বিজ্ঞাপন / মিডিয়া',
  TRANSPORT_OR_LOGISTICS: 'পরিবহন / লজিস্টিকস',
  CONTRACTOR_OR_SUBCONTRACTOR: 'ঠিকাদার / সাবকন্ট্রাক্টর',
  NONE: 'কোনো টিডিএস নেই',
  BANK: 'ব্যাংক ট্রান্সফার',
  MFS: 'এমএফএস (বিকাশ / নগদ)',
  CASH: 'নগদ',
  CHEQUE: 'চেক',
  CREDIT_CARD: 'ক্রেডিট কার্ড',
};

const DOC_TYPE_LABEL_BN: Record<string, string> = {
  SALES_INVOICE: 'বিক্রয় চালান',
  PURCHASE_BILL: 'ক্রয় বিল',
  EXPENSE_VOUCHER: 'ব্যয় ভাউচার',
  IMPORTED_SERVICE: 'আমদানি সেবা',
};

// ---------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------

export interface TransactionComposerProps {
  className?: string;
  defaultText?: string;
  autoFocus?: boolean;
  onPosted?: (doc: CommercialDoc) => void;
  onOpenJournal?: (journalId: string) => void;
}

function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function bpsLabel(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const remainder = Math.abs(bps % 100);
  return remainder === 0 ? `${whole}%` : `${whole}.${String(remainder).padStart(2, '0')}%`;
}

function decisionTone(state: string): { className: string; en: string; bn: string } {
  if (state === 'SUPPORTED') {
    return { className: 'lv-chip-emerald', en: 'Engine supported', bn: 'ইঞ্জিন সমর্থিত' };
  }
  if (state === 'SUPPORTED_WITH_CONDITIONS') {
    return { className: 'lv-chip-gold', en: 'Supported with conditions', bn: 'শর্তসাপেক্ষে সমর্থিত' };
  }
  if (state === 'MANUAL_REVIEW') {
    return { className: 'lv-chip-gold', en: 'Manual review', bn: 'ম্যানুয়াল পর্যালোচনা' };
  }
  if (state === 'NOT_SUPPORTED') {
    return { className: 'lv-chip-rose', en: 'Not supported', bn: 'সমর্থিত নয়' };
  }
  return { className: 'lv-chip-rose', en: 'Source disputed or expired', bn: 'উৎস বিতর্কিত বা মেয়াদোত্তীর্ণ' };
}

/** Mirrors VaultContext's expense routing so the preview names the account that will be posted. */
function expenseAccountCode(nature: TdsNature, docType: CreateDocInput['doc_type']): string {
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

/** Normalise the engine's signed preview lines into strict debit / credit columns. */
function normalisedPreviewLines<T extends { debit_poisha: bigint; credit_poisha: bigint }>(
  lines: ReadonlyArray<T>,
): Array<T & { debit: bigint; credit: bigint }> {
  return lines.map((line) => {
    let debit = line.debit_poisha;
    let credit = line.credit_poisha;
    if (debit < 0n) {
      credit += -debit;
      debit = 0n;
    }
    if (credit < 0n) {
      debit += -credit;
      credit = 0n;
    }
    return { ...line, debit, credit };
  });
}

interface WaterfallRow {
  key: string;
  label: string;
  amount: bigint;
  tone: string;
  sign: '+' | '−' | '=' | '';
  emphasis?: boolean;
  hidden?: boolean;
  note?: string;
}

export function TransactionComposer({
  className = '',
  defaultText = '',
  autoFocus = false,
  onPosted,
  onOpenJournal,
}: TransactionComposerProps) {
  const vault = useVault();
  const { navigate } = useWorkspaceNav();
  const { money, locale, tenant, parties, items, commercialDocs, accounts, mode, motionTier, theme } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const humanLabel = (key: string): string => (isBn ? HUMAN_LABEL_BN[key] ?? HUMAN_LABEL[key] : HUMAN_LABEL[key]) ?? key;

  const [text, setText] = useState<string>(defaultText);
  const [direction, setDirection] = useState<Direction>('PURCHASE');
  const [partyId, setPartyId] = useState<string>('');
  const [category, setCategory] = useState<TaxCategory>('STANDARD_15');
  const [method, setMethod] = useState<PaymentMethod>('BANK');
  const [tdsNature, setTdsNature] = useState<TdsNature>('SUPPLY_OF_GOODS');
  const [postingDate, setPostingDate] = useState<string>('');
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string; docNumber?: string } | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [journalTab, setJournalTab] = useState<'DOCUMENT' | 'SETTLEMENT'>('DOCUMENT');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const parsed = useMemo(() => parseTransaction(text), [text]);

  const defaultPostingDate = useMemo(() => {
    const reportingPeriod = vault.statements.period;
    const reportingOpen = vault.periods.some(
      (period) => period.code === reportingPeriod.code && period.status === 'OPEN',
    );
    // The cockpit's statements are built for the reporting period, so a demo post that should
    // move the dashboard must land inside it. When the real calendar has rolled past the seeded
    // period, the last open date of the reporting period is the honest default.
    if (reportingOpen) return reportingPeriod.end;
    const today = new Date().toISOString().slice(0, 10);
    const open = vault.periods
      .filter((period) => period.status === 'OPEN')
      .slice()
      .sort((a, b) => a.end_date.localeCompare(b.end_date));
    if (open.length === 0) return today;
    const first = open[0];
    const last = open[open.length - 1];
    if (today >= first.start_date && today <= last.end_date) return today;
    if (today < first.start_date) return first.start_date;
    return last.end_date;
  }, [vault.periods, vault.statements.period]);

  useEffect(() => {
    setPostingDate((current) => current || defaultPostingDate);
  }, [defaultPostingDate]);

  const eligibleParties = useMemo(() => {
    const wanted: Array<Party['type']> = direction === 'SALE' ? ['CUSTOMER', 'BOTH'] : ['SUPPLIER', 'BOTH'];
    return parties.filter((party) => party.is_active && wanted.includes(party.type));
  }, [parties, direction]);

  // Deterministic best-party match: token overlap between the sentence and the party master.
  const suggestedPartyId = useMemo(() => {
    const withSettlement = normalizeText(toLatinNumberString(text));
    const haystack = withSettlement.split(/\b(?:via|by|through|using|with)\b/)[0];
    if (!haystack) return '';
    let bestId = '';
    let bestScore = 0;
    for (const party of eligibleParties) {
      const names = [party.name_en, party.name_bn, party.code];
      let score = 0;
      for (const name of names) {
        const tokens = normalizeText(toLatinNumberString(name))
          .split(' ')
          .filter((token) => token.length > 2);
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
        }
        if (tokens.length > 1 && haystack.includes(tokens.join(' '))) score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = party.id;
      }
    }
    return bestScore >= 1 ? bestId : '';
  }, [text, eligibleParties]);

  useEffect(() => {
    setDirection(parsed.direction ?? 'PURCHASE');
    setCategory(parsed.tax_category);
    setMethod(parsed.payment_method);
    setTdsNature(parsed.tds_nature);
    setResult(null);
  }, [parsed.direction, parsed.tax_category, parsed.payment_method, parsed.tds_nature, text]);

  useEffect(() => {
    setPartyId(suggestedPartyId);
  }, [suggestedPartyId, text]);

  const selectedParty = useMemo(() => parties.find((party) => party.id === partyId) ?? null, [parties, partyId]);

  const binUnit = useMemo(
    () => tenant.bin_units.find((unit) => unit.is_principal) ?? tenant.bin_units[0] ?? null,
    [tenant.bin_units],
  );

  const catalog = useMemo(
    () => items as unknown as Array<{ sku?: string; name_en?: string; name_bn?: string; unit_en?: string }>,
    [items],
  );

  const matchedItem = useMemo(() => {
    const haystack = normalizeText(text);
    if (!haystack) return null;
    for (const item of catalog) {
      const name = item.name_en ? normalizeText(item.name_en) : '';
      if (name && name.length > 3 && haystack.includes(name)) return item;
    }
    return null;
  }, [catalog, text]);

  const taxInput: TaxEvaluationInput = useMemo(
    () => ({
      direction,
      base_poisha: parsed.amount_poisha,
      tax_category: category,
      party_name: selectedParty?.name_en ?? parsed.party_query ?? 'Unidentified counterparty',
      party_bin: selectedParty?.bin,
      party_tin: selectedParty?.tin,
      is_withholding_entity: tenant.is_withholding_entity,
      vds_applicable:
        direction === 'SALE' ? Boolean(selectedParty?.is_withholding_buyer) : tenant.is_withholding_entity,
      tds_nature: tdsNature,
      payment_method: method,
      has_valid_mushak63: true,
      is_reverse_charge: parsed.reverse_charge || category === 'REVERSE_CHARGE',
      is_government_or_bank: Boolean(selectedParty?.is_government),
    }),
    [direction, parsed.amount_poisha, category, selectedParty, parsed.party_query, parsed.reverse_charge, tenant, tdsNature, method],
  );

  const decision = useMemo(() => evaluateTaxDecision(taxInput), [taxInput]);
  const preview = useMemo(() => previewTaxJournal(taxInput, decision), [taxInput, decision]);

  const canPost = Boolean(binUnit && selectedParty && parsed.amount_poisha > 0n && parsed.quantity > 0);
  const hasAmount = parsed.amount_poisha > 0n;

  const isService =
    category === 'REVERSE_CHARGE' ||
    tdsNature === 'PROFESSIONAL_OR_TECHNICAL_SERVICES' ||
    tdsNature === 'COMMERCIAL_RENT' ||
    tdsNature === 'ADVERTISING_OR_MEDIA' ||
    tdsNature === 'TRANSPORT_OR_LOGISTICS' ||
    tdsNature === 'CONTRACTOR_OR_SUBCONTRACTOR' ||
    SERVICE_WORDS.some((word) => normalizeText(text).includes(word));

  const docType: CreateDocInput['doc_type'] =
    direction === 'SALE'
      ? 'SALES_INVOICE'
      : category === 'REVERSE_CHARGE'
        ? 'IMPORTED_SERVICE'
        : isService
          ? 'EXPENSE_VOUCHER'
          : 'PURCHASE_BILL';

  const base = absBig(decision.base_poisha);
  const gross = absBig(decision.gross_poisha);
  const vat = absBig(decision.vat_poisha);
  const sd = absBig(decision.sd_poisha);
  const vds = absBig(decision.vds_poisha);
  const tds = absBig(decision.tds_poisha);
  const net = absBig(decision.net_payable_poisha);
  const treasury = absBig(decision.treasury_payable_poisha);
  const barScale = [base, gross, net, vds, tds, vat, sd].reduce((max, value) => (value > max ? value : max), 1n);
  const toneForNet = theme === 'DARK' ? '#34d399' : '#10b981';

  const waterfallRows: WaterfallRow[] = [
    { key: 'base', label: L('Taxable value', 'করযোগ্য মূল্য'), amount: base, tone: '#6366f1', sign: '' },
    { key: 'vat', label: `${L('VAT', 'ভ্যাট')} · ${bpsLabel(decision.vat_bps)}`, amount: vat, tone: '#8b5cf6', sign: '+', hidden: vat === 0n },
    { key: 'sd', label: `${L('Supplementary duty', 'সম্পূরক শুল্ক')} · ${bpsLabel(decision.sd_bps)}`, amount: sd, tone: '#c084fc', sign: '+', hidden: sd === 0n },
    { key: 'gross', label: L('Gross invoice value', 'মোট চালান মূল্য'), amount: gross, tone: toneForNet, sign: '=', emphasis: true },
    { key: 'vds', label: `${L('VDS withheld', 'ভিডিএস আটকানো')} · ${bpsLabel(decision.vds_bps)}`, amount: vds, tone: '#f59e0b', sign: '−', hidden: vds === 0n },
    { key: 'tds', label: `${L('TDS withheld', 'টিডিএস আটকানো')} · ${bpsLabel(decision.tds_bps)}`, amount: tds, tone: '#f472b6', sign: '−', hidden: tds === 0n },
    { key: 'net', label: L('Net cash to party', 'পক্ষকে নিট নগদ'), amount: net, tone: '#10b981', sign: '=', emphasis: true },
  ];
  const visibleWaterfall = waterfallRows.filter((row) => !row.hidden);

  const activeGroup = preview.groups.find((group) => group.id === journalTab) ?? preview.groups[0];
  const effectiveCostAccount = useMemo(() => {
    if (direction !== 'PURCHASE') return null;
    const code = expenseAccountCode(tdsNature, docType);
    const account = accounts.find((entry) => entry.code === code);
    return {
      code,
      name_en: account?.name_en ?? code,
      name_bn: account?.name_bn ?? code,
    };
  }, [direction, tdsNature, docType, accounts]);
  const displayLines = useMemo(
    () =>
      normalisedPreviewLines(activeGroup?.lines ?? []).map((line) =>
        effectiveCostAccount && line.account_code === '5100'
          ? {
              ...line,
              account_code: effectiveCostAccount.code,
              account_name_en: effectiveCostAccount.name_en,
              account_name_bn: effectiveCostAccount.name_bn,
            }
          : line,
      ),
    [activeGroup, effectiveCostAccount],
  );
  const journalTotals = useMemo(
    () =>
      displayLines.reduce(
        (totals, line) => ({ debit: totals.debit + line.debit, credit: totals.credit + line.credit }),
        { debit: 0n, credit: 0n },
      ),
    [displayLines],
  );

  const handlePost = useCallback(() => {
    if (!binUnit) {
      setResult({ ok: false, message: L('No BIN unit configured', 'কোনো বিআইএন ইউনিট নেই') });
      return;
    }
    if (!selectedParty) {
      setResult({
        ok: false,
        message: L('Pick a counterparty first', 'প্রথমে প্রতিপক্ষ নির্বাচন করুন'),
        detail: L(
          'Every posted document needs a party id so the AR/AP control account stays reconciled.',
          'প্রতিটি পোস্টেড ডকুমেন্টে party id দরকার, যাতে এআর/এপি কন্ট্রোল হিসাব মিলে থাকে।',
        ),
      });
      return;
    }
    if (parsed.amount_poisha <= 0n) {
      setResult({
        ok: false,
        message: L('No amount detected', 'কোনো টাকার অঙ্ক পাওয়া যায়নি'),
        detail: L('Try “Paid BDT 25,000 …” or “Sold 10 pcs at BDT 500”.', 'লিখুন “Paid BDT 25,000 …” বা “Sold 10 pcs at BDT 500”।'),
      });
      return;
    }

    const unitPrice = parsed.unit_price_poisha ?? parsed.amount_poisha / BigInt(Math.max(1, parsed.quantity));
    const payload: CreateDocInput = {
      doc_type: docType,
      doc_date: postingDate || defaultPostingDate,
      party_id: selectedParty.id,
      bin_unit_id: binUnit.id,
      lines: [
        {
          sku: matchedItem?.sku ?? (isService ? 'SVC-GENERIC' : 'SKU-GENERIC'),
          description_en: parsed.description_en,
          description_bn: parsed.description_bn,
          quantity: Math.max(1, parsed.quantity),
          unit_price_poisha: unitPrice,
          tax_category: category,
          cost_center: 'GENERAL',
        },
      ],
      tax_category: category,
      tds_nature: tdsNature,
      payment_method: method,
      narration_en: parsed.description_en,
      narration_bn: parsed.description_bn,
      reverse_charge: category === 'REVERSE_CHARGE',
      withhold_vds: taxInput.vds_applicable,
      sd_applicable: false,
      book_type: 'STATUTORY_BD',
      auto_post: true,
    };

    const outcome = vault.postCommercialDoc(payload, { settle: true });
    if (!outcome.ok) {
      setResult({
        ok: false,
        message: L('Posting rejected by the ledger', 'লেজার পোস্টিং প্রত্যাখ্যান করেছে'),
        detail: outcome.error,
      });
      return;
    }

    const posted = outcome.data as unknown as (CommercialDoc & { tax_trace_id?: string }) | undefined;
    setResult({
      ok: true,
      message: L(
        `Posted ${posted?.doc_number ?? 'journal'} to the balanced ledger`,
        `${posted?.doc_number ?? 'জার্নাল'} সুষম লেজারে পোস্ট হয়েছে`,
      ),
      detail:
        direction === 'SALE' && posted?.mushak_serial
          ? L(`Mushak 6.3 serial ${posted.mushak_serial} allocated`, `মূসক ৬.৩ সিরিয়াল ${posted.mushak_serial} বরাদ্দ`)
          : L(
              `Journal sealed with a SHA-256 audit hash${posted?.tax_trace_id ? ` · ${posted.tax_trace_id.slice(0, 16)}` : ''}`,
              `জার্নালটি SHA-256 অডিট হ্যাশে সিল হয়েছে${posted?.tax_trace_id ? ` · ${posted.tax_trace_id.slice(0, 16)}` : ''}`,
            ),
      docNumber: posted?.doc_number,
    });
    if (posted && onPosted) onPosted(posted);
  }, [
    binUnit,
    selectedParty,
    parsed,
    docType,
    postingDate,
    defaultPostingDate,
    matchedItem,
    isService,
    category,
    tdsNature,
    method,
    taxInput.vds_applicable,
    vault,
    L,
    onPosted,
  ]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handlePost();
    }
  };

  const chooseScenario = (chip: DemoChip): void => {
    setText(chip.text);
    setResult(null);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  };

  const recent = (commercialDocs as unknown as CommercialDoc[]).slice(0, 3);
  const registerTarget = direction === 'SALE' ? 'W02' : 'W03';
  const tone = decisionTone(decision.decision);
  const duration = motionTier === 'OFF' ? 0 : 0.28;

  return (
    <section
      className={`relative overflow-hidden rounded-[26px] border border-line/90 bg-surface shadow-card ${className}`}
      aria-label={L('Natural language transaction composer', 'স্বাভাবিক ভাষার লেনদেন কম্পোজার')}
    >
      <div className="lv-aurora" />
      <div className="lv-grain pointer-events-none absolute inset-0" />

      {/* Header */}
      <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="brand-gradient relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl text-white shadow-lift ring-1 ring-white/20">
            <Wand2 size={19} strokeWidth={1.8} />
            <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
          </span>
          <div className="min-w-0">
            <p className="lv-kicker flex items-center gap-1.5">
              <Sparkles size={11} className="text-gold-500" />
              {L('Natural-language journal', 'স্বাভাবিক ভাষার জার্নাল')}
            </p>
            <h2 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-[-0.025em] text-ink-900 sm:text-[21px]">
              {L('Describe it. We will balance it.', 'লিখুন। আমরা ভারসাম্য করব।')}
            </h2>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-ink-500">
              {L(
                'English, বাংলা or Banglish · deterministic parse, no model call · the journal is computed before you post.',
                'English, বাংলা বা Banglish · নির্ধারিত পার্সিং, এআই কল নেই · পোস্টের আগেই জার্নাল গণনা হয়।',
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="lv-chip lv-chip-neutral">
            <Languages size={10} />
            {parsed.language}
          </span>
          <span className="lv-chip lv-chip-gold">
            <Scale size={10} />
            {parsed.confidence}% {L('confidence', 'নির্ভরযোগ্যতা')}
          </span>
          <span className="lv-chip lv-chip-emerald">
            <ShieldCheck size={10} />
            {L('Audit sealed', 'অডিট সিল')}
          </span>
        </div>
      </header>

      {/* Scenarios */}
      <div className="relative border-b border-line/60 px-4 py-3 sm:px-6">
        <div className="mb-2 flex items-center gap-2">
          <Zap size={11} className="text-gold-500" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            {L('1-tap scenarios', '১-ট্যাপ দৃশ্যপট')}
          </span>
          <span className="text-[9px] text-ink-300">·</span>
          <span className="text-[9px] text-ink-400">{L('EN · বাংলা · Banglish', 'ইংরেজি · বাংলা · বাংলিশ')}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
          {DEMO_CHIPS.map((chip) => {
            const active = text === chip.text;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => chooseScenario(chip)}
                className={`group relative flex h-full flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition ${
                  active
                    ? 'border-vault-400/45 bg-vault-50/60 shadow-sm dark:border-vault-500/30 dark:bg-vault-500/[0.07]'
                    : 'border-line/80 bg-surface-2/40 hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface'
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-[10.5px] font-semibold text-ink-800">
                    {isBn ? chip.labelBn : chip.labelEn}
                  </span>
                  <span
                    className={`rounded px-1 py-px font-mono text-[8px] font-semibold ${
                      chip.tag === 'বাংলা'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : chip.tag === 'Banglish'
                          ? 'bg-gold-500/10 text-gold-600 dark:text-gold-300'
                          : 'bg-ink-100 text-ink-500 dark:bg-white/[0.06]'
                    }`}
                  >
                    {chip.tag}
                  </span>
                </span>
                <span className="line-clamp-1 w-full text-[9.5px] leading-snug text-ink-400 transition group-hover:text-ink-500">
                  {chip.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Command bar */}
      <div className="relative px-4 py-4 sm:px-6">
        <div
          className="rounded-2xl p-[1.5px] transition-all duration-300"
          style={{
            background: focused
              ? 'linear-gradient(120deg, rgb(var(--lv-emerald)), rgb(var(--lv-saffron)) 65%, rgb(var(--lv-emerald-bright)))'
              : 'rgb(var(--lv-line))',
            boxShadow: focused ? '0 24px 70px -36px rgba(79,70,229,0.55)' : 'none',
          }}
        >
          <div className="rounded-[15px] bg-surface">
            <div className="flex items-start gap-3 px-3.5 py-3 sm:px-4">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500 dark:bg-white/[0.05]">
                <Sparkles size={15} className={focused ? 'text-gold-500' : 'text-ink-400'} />
              </span>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoFocus={autoFocus}
                rows={2}
                spellCheck={false}
                placeholder={L(
                  'e.g. Paid BDT 1,00,000 consultancy fee to Rahim Advisory via City Bank',
                  'যেমন: বিকাশে ৫০,০০০ টাকা অফিস ভাড়া দিলাম',
                )}
                className="min-h-[54px] w-full resize-none bg-transparent pt-1 text-[15px] font-medium leading-relaxed tracking-[-0.01em] text-ink-900 outline-none placeholder:text-ink-400 sm:text-[16px]"
                aria-label={L('Describe a transaction', 'লেনদেন বর্ণনা করুন')}
              />
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <kbd className="lv-kbd hidden sm:inline-flex">⌘↵</kbd>
                {text ? (
                  <button
                    type="button"
                    onClick={() => {
                      setText('');
                      setResult(null);
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/[0.06]"
                    aria-label={L('Clear', 'মুছুন')}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-3.5 py-2 sm:px-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <ParsedChip
                  active
                  icon={direction === 'SALE' ? <Store size={9} /> : <Building2 size={9} />}
                  label={direction === 'SALE' ? L('Sale', 'বিক্রয়') : L('Purchase', 'ক্রয়')}
                  tone="emerald"
                />
                <ParsedChip
                  active={hasAmount}
                  icon={<Coins size={9} />}
                  label={hasAmount ? money(parsed.amount_poisha) : L('no amount', 'অঙ্ক নেই')}
                  tone={hasAmount ? 'neutral' : 'danger'}
                />
                <ParsedChip
                  active={Boolean(selectedParty || parsed.party_query)}
                  icon={<FileText size={9} />}
                  label={selectedParty ? (isBn ? selectedParty.name_bn : selectedParty.name_en) : parsed.party_query ?? L('no party yet', 'পক্ষ নেই')}
                  tone={selectedParty ? 'neutral' : 'warn'}
                />
                <span className="hidden items-center gap-1.5 sm:flex">
                  <ParsedChip
                    active
                    icon={
                      method === 'CREDIT_CARD' ? (
                        <CreditCard size={9} />
                      ) : method === 'CASH' ? (
                        <Banknote size={9} />
                      ) : (
                        <Landmark size={9} />
                      )
                    }
                    label={humanLabel(method)}
                    tone="neutral"
                  />
                  <ParsedChip
                    active
                    icon={<ChevronRight size={9} />}
                    label={humanLabel(category)}
                    tone="gold"
                  />
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden text-[9px] text-ink-400 md:inline">
                  {canPost
                    ? L('Ready to post', 'পোস্টের জন্য প্রস্তুত')
                    : L('Party + amount required', 'পক্ষ ও অঙ্ক প্রয়োজন')}
                </span>
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={!canPost}
                  className="brand-gradient group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl px-3 py-2 text-[11px] font-semibold text-white shadow-lift transition hover:-translate-y-px hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-transparent opacity-0 transition group-hover:opacity-100" />
                  <ShieldCheck size={13} className="relative z-10 text-white/80" />
                  <span className="relative z-10">{L('Approve & Post to Ledger', 'খতিয়ানে অনুমোদন ও পোস্ট')}</span>
                  <ArrowRight size={12} className="relative z-10 transition group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {parsed.notes.length > 0 ? (
          <details className="group mt-2 rounded-xl border border-line/60 bg-surface-2/40 px-3 py-1.5">
            <summary className="cursor-pointer list-none text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-400 transition hover:text-ink-600">
              <span className="inline-flex items-center gap-1.5">
                <ChevronRight size={10} className="transition group-open:rotate-90" />
                {L('How this was parsed', 'কীভাবে পার্স হলো')} · {parsed.notes.length}
              </span>
            </summary>
            <ul className="mt-1.5 space-y-0.5 pb-1">
              {parsed.notes.map((note) => (
                <li key={note} className="font-mono text-[9.5px] leading-relaxed text-ink-500">
                  · {note}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* Core draft fields */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="lv-label !mb-1 !text-[9px]">{L('Counterparty', 'প্রতিপক্ষ')}</span>
            <select
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
              className={`lv-select !py-1.5 !text-[11px] ${partyId ? '' : '!border-amber-400/60 !bg-amber-500/[0.04]'}`}
            >
              <option value="">{L('— select party —', '— পক্ষ নির্বাচন —')}</option>
              {eligibleParties.map((party) => (
                <option key={party.id} value={party.id}>
                  {isBn ? party.name_bn : party.name_en}
                  {party.bin ? ` · BIN ${party.bin}` : ` · ${L('no BIN', 'বিআইএন নেই')}`}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="lv-label !mb-1 !text-[9px]">{L('Settlement', 'নিষ্পত্তি')}</span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              className="lv-select !py-1.5 !text-[11px]"
            >
              {PAYMENT_METHODS.map((entry) => (
                <option key={entry} value={entry}>
                  {humanLabel(entry)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="lv-label !mb-1 !text-[9px]">{L('VAT category', 'ভ্যাট শ্রেণি')}</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as TaxCategory)}
              className="lv-select !py-1.5 !text-[11px]"
            >
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {humanLabel(entry)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="lv-label !mb-1 !text-[9px]">{L('Posting date', 'পোস্টিং তারিখ')}</span>
            <div className="relative">
              <CalendarDays size={12} className="pointer-events-none absolute right-2.5 top-2 text-ink-400" />
              <input
                type="date"
                value={postingDate}
                onChange={(event) => setPostingDate(event.target.value)}
                className="lv-input !py-1.5 !pr-8 !text-[11px]"
              />
            </div>
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDraftOpen((open) => !open)}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-500 transition hover:bg-ink-100/60 hover:text-ink-800 dark:hover:bg-white/[0.05]"
          >
            <ChevronRight size={10} className={`transition ${draftOpen ? 'rotate-90' : ''}`} />
            {L('Advanced draft parameters', 'উন্নত খসড়া প্যারামিটার')}
          </button>
          <span className="text-[9px] text-ink-300">·</span>
          <span className="text-[9px] text-ink-400">
            {isBn ? DOC_TYPE_LABEL_BN[docType] ?? docType : docType.replaceAll('_', ' ').toLowerCase()} · {parsed.quantity > 0 ? parsed.quantity : 0}{' '}
            {parsed.unit ?? L('unit', 'একক')} · {L('unit price', 'একক মূল্য')} {money(parsed.unit_price_poisha ?? 0n)}
          </span>
          <span className="pro-only ml-auto font-mono text-[9px] text-ink-400">
            {selectedParty?.code ?? '—'} · {binUnit?.id ?? '—'}
          </span>
        </div>

        <AnimatePresence initial={false}>
          {draftOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl border border-line/60 bg-surface-2/40 p-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="block">
                  <span className="lv-label !mb-1 !text-[9px]">{L('TDS nature', 'টিডিএস প্রকৃতি')}</span>
                  <select
                    value={tdsNature}
                    onChange={(event) => setTdsNature(event.target.value as TdsNature)}
                    className="lv-select !py-1.5 !text-[11px]"
                  >
                    {TDS_NATURES.map((entry) => (
                      <option key={entry} value={entry}>
                        {humanLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="lv-label !mb-1 !text-[9px]">{L('BIN unit', 'বিআইএন ইউনিট')}</span>
                  <select value={binUnit?.id ?? ''} disabled className="lv-select !py-1.5 !text-[11px]">
                    {(tenant.bin_units.length > 0 ? tenant.bin_units : []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_name_en} · {unit.bin_number}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <p className="lv-hint text-[9.5px]">
                    {L(
                      'The engine re-derives VAT, VDS, TDS and every journal line on each keystroke.',
                      'প্রতিটি কীস্ট্রোকে ইঞ্জিন ভ্যাট, ভিডিএস, টিডিএস ও প্রতিটি জার্নাল লাইন পুনরায় নির্ণয় করে।',
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!selectedParty && hasAmount ? (
          <p className="mt-2 flex items-center gap-1.5 text-[9.5px] font-medium text-amber-700 dark:text-amber-300">
            <CircleAlert size={10} />
            {L(
              'A counterparty is required before posting — the suggested party appears above when the name is recognised.',
              'পোস্ট করার আগে প্রতিপক্ষ প্রয়োজন — নাম শনাক্ত হলে উপরে প্রস্তাবিত পক্ষ দেখাবে।',
            )}
          </p>
        ) : null}
      </div>

      {/* Live waterfall + double-entry preview */}
      <AnimatePresence initial={false}>
        {hasAmount && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration + 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-line/70"
          >
            <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              {/* Tax waterfall */}
              <div className="rounded-2xl border border-line/70 bg-surface-2/35 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="lv-kicker flex items-center gap-1.5">
                      <ReceiptText size={11} className="text-gold-500" />
                      {L('Live tax waterfall', 'লাইভ কর ওয়াটারফল')}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-ink-800">
                      {L('How the gross becomes cash', 'যেভাবে মোট নগদ হয়')}
                    </p>
                  </div>
                  <span className={`lv-chip ${tone.className}`}>
                    <Scale size={10} />
                    {L(tone.en, tone.bn)}
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {visibleWaterfall.map((row) => {
                    const width = Number((row.amount * 1000n) / barScale) / 10;
                    return (
                      <div key={row.key} className={row.emphasis ? 'border-t border-line/60 pt-2' : ''}>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-[9px] ${
                              row.emphasis ? 'font-semibold text-ink-700' : 'text-ink-500'
                            }`}
                          >
                            {row.sign ? <span className="mr-1 inline-block w-2 text-ink-300">{row.sign}</span> : null}
                            {row.label}
                          </span>
                          <span
                            className={`font-money shrink-0 text-[10.5px] tabular-nums ${
                              row.emphasis ? 'font-semibold text-ink-900' : 'text-ink-700'
                            }`}
                          >
                            {money(row.amount)}
                          </span>
                        </div>
                        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-ink-100/80 dark:bg-white/[0.06]">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: row.tone }}
                            initial={false}
                            animate={{ width: `${Math.max(row.amount > 0n ? 2 : 0, Math.min(100, width))}%` }}
                            transition={{ duration: motionTier === 'OFF' ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-line/60 pt-2.5">
                  <MiniStat label={L('Treasury payable', 'কোষাগারে প্রদেয়')} value={money(treasury)} tone="gold" />
                  <MiniStat label={L('Input credit claimable', 'ইনপুট ক্রেডিট দাবিযোগ্য')} value={money(absBig(decision.input_credit.claimable_poisha))} tone="emerald" />
                  <MiniStat label={L('Net to party', 'পক্ষকে নিট')} value={money(net)} tone="neutral" />
                  <MiniStat
                    label={L('Effective VAT', 'কার্যকর ভ্যাট')}
                    value={`${bpsLabel(decision.vat_bps)} · ${money(vat)}`}
                    tone="neutral"
                    mono
                  />
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-relaxed text-ink-400">
                  <ShieldCheck size={10} className="mt-0.5 shrink-0 text-emerald-500" />
                  {decision.explanations_en?.[0]
                    ? isBn
                      ? decision.explanations_bn?.[0] ?? decision.explanations_en[0]
                      : decision.explanations_en[0]
                    : L(
                        'Every figure above comes from the deterministic rule pack and is traceable to a citation.',
                        'উপরের প্রতিটি সংখ্যা নির্ধারিত রুল প্যাক থেকে এসেছে এবং উদ্ধৃতি পর্যন্ত ট্রেসযোগ্য।',
                      )}
                </p>
              </div>

              {/* Double-entry preview */}
              <div className="rounded-2xl border border-line/70 bg-surface-2/35 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="lv-kicker flex items-center gap-1.5">
                      <BookOpen size={11} className="text-emerald-500" />
                      {L('Double-entry preview', 'দ্বৈত-এন্ট্রি প্রিভিউ')}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-ink-800">
                      {L('Exactly what will hit the ledger', 'খতিয়ানে ঠিক যা পোস্ট হবে')}
                    </p>
                  </div>
                  <span
                    className={`lv-chip ${
                      journalTotals.debit === journalTotals.credit ? 'lv-chip-emerald' : 'lv-chip-rose'
                    }`}
                  >
                    <Check size={10} />
                    {L('Balanced', 'সুষম')}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-1">
                  {preview.groups.map((groupEntry) => (
                    <button
                      key={groupEntry.id}
                      type="button"
                      onClick={() => setJournalTab(groupEntry.id)}
                      className={`rounded-lg px-2 py-1 text-[9px] font-semibold transition ${
                        (activeGroup?.id ?? 'DOCUMENT') === groupEntry.id
                          ? 'bg-vault-900 text-white shadow-sm'
                          : 'text-ink-500 hover:bg-ink-100/70 dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      {groupEntry.id === 'DOCUMENT' ? L('Document', 'ডকুমেন্ট') : L('Settlement', 'নিষ্পত্তি')}
                      <span className="ml-1 font-mono opacity-60">{groupEntry.lines.length}</span>
                    </button>
                  ))}
                  <span className="ml-auto font-mono text-[8.5px] text-ink-400">
                    {L('DR', 'ডেবিট')} = {L('CR', 'ক্রেডিট')}
                  </span>
                </div>

                <div className="mt-1.5 overflow-hidden rounded-xl border border-line/70 bg-surface/70">
                  <div className="grid grid-cols-[minmax(0,1fr)_70px_70px] gap-1 border-b border-line/70 bg-ink-50/60 px-2.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-ink-400 dark:bg-white/[0.03]">
                    <span>{L('Account', 'হিসাব')}</span>
                    <span className="text-right">{L('Debit', 'ডেবিট')}</span>
                    <span className="text-right">{L('Credit', 'ক্রেডিট')}</span>
                  </div>
                  <div className="max-h-[174px] overflow-y-auto">
                    {displayLines.map((line, index) => (
                      <div
                        key={`${line.account_code}-${line.line_no}-${index}`}
                        className={`grid grid-cols-[minmax(0,1fr)_70px_70px] items-center gap-1 px-2.5 py-[5px] ${
                          index % 2 === 0 ? '' : 'bg-ink-50/35 dark:bg-white/[0.015]'
                        }`}
                        title={line.memo_en}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="pro-only shrink-0 rounded bg-ink-100 px-1 py-px font-mono text-[7.5px] text-ink-500 dark:bg-white/[0.06]">
                              {line.account_code}
                            </span>
                            <span className="truncate text-[10px] font-medium text-ink-700">
                              {isBn ? line.account_name_bn : line.account_name_en}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[8px] leading-tight text-ink-400">
                            {isBn ? line.memo_bn : line.memo_en}
                          </span>
                        </span>
                        <span className="font-money text-right text-[10px] tabular-nums text-ink-800">
                          {line.debit > 0n ? money(line.debit) : <span className="text-ink-300">—</span>}
                        </span>
                        <span className="font-money text-right text-[10px] tabular-nums text-ink-800">
                          {line.credit > 0n ? money(line.credit) : <span className="text-ink-300">—</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_70px_70px] items-center gap-1 border-t border-line/70 bg-ink-50/60 px-2.5 py-1.5 text-[9.5px] font-semibold text-ink-700 dark:bg-white/[0.03]">
                    <span>
                      {L('Totals', 'মোট')} · {displayLines.length} {L('lines', 'লাইন')}
                    </span>
                    <span className="font-money text-right tabular-nums">{money(journalTotals.debit)}</span>
                    <span className="font-money text-right tabular-nums">{money(journalTotals.credit)}</span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="lv-chip lv-chip-neutral !text-[9px]">
                    <ShieldCheck size={9} />
                    SHA-256 {L('chain', 'চেইন')}
                  </span>
                  <span className="lv-chip lv-chip-neutral !text-[9px]">
                    {L('Mushak serial auto-allocated', 'মূসক সিরিয়াল স্বয়ংক্রিয়')}
                  </span>
                  <span className="lv-chip lv-chip-neutral !text-[9px]">
                    {preview.groups.length > 1 ? L('+ settlement journal', '+ নিষ্পত্তি জার্নাল') : L('single journal', 'একক জার্নাল')}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer / result */}
      <footer className="relative border-t border-line/70 bg-surface-2/35 px-4 py-3 sm:px-6">
        {result ? (
          <div
            className={`mb-2.5 flex items-start gap-2 rounded-xl border px-3 py-2 ${
              result.ok
                ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                : 'border-rose-500/25 bg-rose-500/[0.06]'
            }`}
          >
            {result.ok ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
            )}
            <div className="min-w-0 flex-1 text-[10.5px] leading-relaxed">
              <p className={`font-semibold ${result.ok ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'}`}>
                {result.message}
              </p>
              {result.detail ? (
                <p className={result.ok ? 'text-emerald-700 dark:text-emerald-300/80' : 'text-rose-700 dark:text-rose-300/80'}>
                  {result.detail}
                </p>
              ) : null}
            </div>
            {result.ok ? (
              <button
                type="button"
                onClick={() => (onOpenJournal ? onOpenJournal('') : navigate(registerTarget))}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/25 bg-surface px-2 py-1 text-[9px] font-semibold text-emerald-800 transition hover:border-emerald-500/40 dark:text-emerald-200"
              >
                {L('Open register', 'রেজিস্টার খুলুন')}
                <ArrowUpRight size={10} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9.5px] text-ink-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {L(
                'Posting updates the ledger, the statements, the VAT return and every cockpit KPI instantly.',
                'পোস্ট করলে খতিয়ান, বিবরণী, ভ্যাট রিটার্ন ও ককপিটের সব কেপিআই তাৎক্ষণিক হালনাগাদ হয়।',
              )}
            </p>
            {recent.length > 0 ? (
              <p className="mt-1 truncate font-mono text-[9px] text-ink-400">
                {L('Latest', 'সর্বশেষ')}: {recent[0].doc_number} · {money(recent[0].gross_poisha)} ·{' '}
                {recent[0].status}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-[9px] text-ink-400 sm:flex">
              <kbd className="lv-kbd !px-1 !py-0.5 !text-[8px]">⌘</kbd>
              <kbd className="lv-kbd !px-1 !py-0.5 !text-[8px]">↵</kbd>
              {L('to post', 'পোস্ট')}
            </span>
            <button
              type="button"
              onClick={() => setDraftOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-500 transition hover:text-ink-800"
            >
              {mode === 'GUIDED' ? L('Guided draft', 'নির্দেশিত খসড়া') : L('Pro draft', 'প্রো খসড়া')}
              <ChevronRight size={9} className={`transition ${draftOpen ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone,
  mono = false,
}: {
  label: string;
  value: string;
  tone: 'gold' | 'emerald' | 'neutral';
  mono?: boolean;
}) {
  const color =
    tone === 'gold'
      ? 'text-gold-600 dark:text-gold-300'
      : tone === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-300'
        : 'text-ink-800';
  return (
    <div className="rounded-lg border border-line/60 bg-surface/60 px-2 py-1.5">
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</p>
      <p className={`mt-0.5 truncate ${mono ? 'font-mono text-[9.5px]' : 'font-money text-[10.5px] font-semibold'} ${color}`}>
        {value}
      </p>
    </div>
  );
}

function ParsedChip({
  active,
  icon,
  label,
  tone,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  tone: 'emerald' | 'gold' | 'neutral' | 'warn' | 'danger';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
      : tone === 'gold'
        ? 'bg-gold-500/10 text-gold-600 ring-gold-500/20 dark:text-gold-300'
        : tone === 'danger'
          ? 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300'
          : tone === 'warn'
            ? 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300'
            : 'bg-surface text-ink-600 ring-line';
  return (
    <span
      className={`inline-flex max-w-[190px] items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${toneClass} ${
        active ? '' : 'opacity-45'
      }`}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

export default TransactionComposer;
