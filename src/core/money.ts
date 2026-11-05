// Zero-float money engine. All authoritative amounts are bigint poisha (1 BDT = 100 poisha).
// This module MUST be imported before any JSON serialization (see src/main.tsx).

if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

export const POISHA_PER_TAKA = 100n;
export const BPS_DENOMINATOR = 10000n;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBanglaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export function normalizeDigits(input: string): string {
  return toLatinDigits(input);
}

/** Parse a BDT amount to poisha without binary floating point drift. */
export function bdtToPoisha(bdt: number | string | bigint): bigint {
  if (typeof bdt === 'bigint') return bdt;
  if (typeof bdt === 'number') {
    if (!Number.isFinite(bdt)) throw new Error('Cannot convert a non-finite number to poisha');
    return bdtToPoisha(bdt.toFixed(2));
  }
  let s = normalizeDigits(String(bdt)).trim();
  if (!s) return 0n;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[৳,\s]/g, '').replace(/^(Tk|BDT|tk|bdt)/, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') {
    throw new Error(`Invalid BDT amount: ${String(bdt)}`);
  }
  const [wholeRaw = '0', fracRaw = ''] = s.split('.');
  const whole = wholeRaw === '' ? 0n : BigInt(wholeRaw);
  const frac = BigInt((fracRaw + '00').slice(0, 2));
  const value = whole * POISHA_PER_TAKA + frac;
  return negative ? -value : value;
}

/** SheetJS chart coordinates and Excel numeric cells only. Never for authoritative math. */
export function poishaToBdtNumber(poisha: bigint): number {
  return Number(poisha) / 100;
}

export function poishaToExcelNumber(poisha: bigint): number {
  return Math.round(Number(poisha)) / 100;
}

export type RoundingMode = 'HALF_UP' | 'FLOOR' | 'CEIL' | 'STATUTORY_RUPEE_ROUND';

function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Apply integer basis-point rate to a poisha base with an explicit deterministic rounding rule. */
export function applyRateBps(
  basePoisha: bigint,
  rateBps: number,
  mode: RoundingMode = 'HALF_UP',
  divisor = BPS_DENOMINATOR,
): bigint {
  if (!Number.isFinite(rateBps)) throw new Error('Rate must be finite');
  const bps = BigInt(Math.round(rateBps));
  const negative = basePoisha < 0n;
  const base = absBig(basePoisha);
  const raw = base * bps;
  let result: bigint;
  if (mode === 'FLOOR') {
    result = raw / divisor;
  } else if (mode === 'CEIL') {
    result = (raw + divisor - 1n) / divisor;
  } else if (mode === 'STATUTORY_RUPEE_ROUND') {
    // Round to the nearest whole taka (statutory return presentation aid).
    const rounded = (base * bps + (divisor * POISHA_PER_TAKA) / 2n) / divisor;
    result = (rounded / POISHA_PER_TAKA) * POISHA_PER_TAKA;
  } else {
    result = (raw + divisor / 2n) / divisor;
  }
  return negative ? -result : result;
}

/** Round a poisha value to whole taka using a statutory half-up rule. */
export function roundToTaka(poisha: bigint, mode: 'HALF_UP' | 'FLOOR' | 'CEIL' = 'HALF_UP'): bigint {
  const negative = poisha < 0n;
  const abs = absBig(poisha);
  let taka: bigint;
  if (mode === 'FLOOR') taka = abs / POISHA_PER_TAKA;
  else if (mode === 'CEIL') taka = (abs + POISHA_PER_TAKA - 1n) / POISHA_PER_TAKA;
  else taka = (abs + POISHA_PER_TAKA / 2n) / POISHA_PER_TAKA;
  return negative ? -taka : taka;
}

export function sumPoisha(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function absPoisha(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function maxPoisha(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minPoisha(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Convert a poisha value at a quoted BDT/USD bps rate (1200000 = 120.0000). */
export function convertCurrencyPoisha(amountPoisha: bigint, exchangeRateBps: number): bigint {
  return applyRateBps(amountPoisha, exchangeRateBps, 'HALF_UP');
}

export function bpsToPercent(rateBps: number): string {
  const whole = Math.trunc(rateBps / 100);
  const frac = Math.abs(rateBps % 100);
  return `${whole}.${String(frac).padStart(2, '0')}%`;
}

interface FormatOptions {
  locale?: 'en-BD' | 'bn-BD';
  numeral?: 'latin' | 'bn';
  grouping?: 'LAKH_CRORE' | 'MILLIONS';
  showSymbol?: boolean;
  showSign?: boolean;
  decimals?: number;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let head = digits.slice(0, -3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head.length) groups.unshift(head);
  return `${groups.join(',')},${last3}`;
}

function groupMillions(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPlainNumber(
  value: number | string,
  opts: Pick<FormatOptions, 'numeral' | 'grouping'> = {},
): string {
  const numeral = opts.numeral || 'latin';
  const grouping = opts.grouping || 'LAKH_CRORE';
  const s = typeof value === 'number' ? value.toFixed(2) : value;
  const negative = s.startsWith('-');
  const clean = negative ? s.slice(1) : s;
  const [whole, frac] = clean.split('.');
  const grouped = grouping === 'MILLIONS' ? groupMillions(whole) : groupIndian(whole);
  let out = frac !== undefined ? `${grouped}.${frac}` : grouped;
  if (negative) out = `-${out}`;
  return numeral === 'bn' ? toBanglaDigits(out) : out;
}

export function formatPoisha(poisha: bigint, opts: FormatOptions = {}): string {
  const locale = opts.locale || 'en-BD';
  const numeral = opts.numeral || (locale === 'bn-BD' ? 'bn' : 'latin');
  const grouping = opts.grouping || 'LAKH_CRORE';
  const showSymbol = opts.showSymbol !== false;
  const decimals = opts.decimals ?? 2;
  const negative = poisha < 0n;
  const abs = absBig(poisha);
  const taka = abs / POISHA_PER_TAKA;
  const paisa = abs % POISHA_PER_TAKA;
  const whole = taka.toString();
  const frac = decimals === 0 ? '' : String(paisa).padStart(2, '0').slice(0, decimals);
  const grouped = grouping === 'MILLIONS' ? groupMillions(whole) : groupIndian(whole);
  let text = decimals === 0 ? grouped : `${grouped}.${frac}`;
  if (numeral === 'bn') text = toBanglaDigits(text);
  const sign = negative ? '−' : opts.showSign ? '+' : '';
  const symbol = showSymbol ? '৳ ' : '';
  return `${sign}${symbol}${text}`;
}

export function formatPoishaCompact(poisha: bigint, locale: 'en-BD' | 'bn-BD' = 'en-BD'): string {
  const abs = absPoisha(poisha);
  const crore = 1000000000n; // 1 crore taka in poisha
  const lakh = 10000000n; // 1 lakh taka in poisha
  const thousand = 100000n;
  let value: string;
  if (abs >= crore) value = `${(Number(abs) / Number(crore)).toFixed(2)} Cr`;
  else if (abs >= lakh) value = `${(Number(abs) / Number(lakh)).toFixed(2)} L`;
  else if (abs >= thousand) value = `${(Number(abs) / Number(thousand)).toFixed(1)} K`;
  else value = formatPoisha(poisha, { locale, showSymbol: false, decimals: 0, grouping: 'LAKH_CRORE' });
  const out = `৳ ${poisha < 0n ? '−' : ''}${value}`;
  return locale === 'bn-BD' ? toBanglaDigits(out) : out;
}

export function formatCount(value: number, numeral: 'latin' | 'bn' = 'latin'): string {
  const s = groupIndian(String(Math.trunc(Math.abs(value))));
  const signed = value < 0 ? `-${s}` : s;
  return numeral === 'bn' ? toBanglaDigits(signed) : signed;
}

export function formatPercentBps(rateBps: number, numeral: 'latin' | 'bn' = 'latin'): string {
  const out = bpsToPercent(rateBps);
  return numeral === 'bn' ? toBanglaDigits(out) : out;
}

export function formatDate(date: string, locale: 'en-BD' | 'bn-BD' = 'en-BD'): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const en = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (locale === 'en-BD') return en;
  const monthsBn = ['জানু', 'ফেব', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুল', 'আগ', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];
  const bn = `${toBanglaDigits(String(d.getDate()).padStart(2, '0'))} ${monthsBn[d.getMonth()]} ${toBanglaDigits(String(d.getFullYear()))}`;
  return bn;
}

const EN_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function enTwo(n: number): string {
  if (n < 20) return EN_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${EN_TENS[t]}${o ? ` ${EN_ONES[o]}` : ''}`;
}

function enThree(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${EN_ONES[h]} Hundred`);
  if (r) parts.push(enTwo(r));
  return parts.join(' ');
}

export function numberToWordsEnglish(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${enThree(crore)} Crore`);
  if (lakh) parts.push(`${enThree(lakh)} Lakh`);
  if (thousand) parts.push(`${enThree(thousand)} Thousand`);
  if (rest) parts.push(enThree(rest));
  return parts.join(' ').trim();
}

const BN_WORDS_0_99: string[] = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

function bnTwo(n: number): string {
  return BN_WORDS_0_99[Math.max(0, Math.min(99, n))];
}

function bnThree(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${BN_WORDS_0_99[h]}শত`);
  if (r) parts.push(bnTwo(r));
  return parts.join(' ');
}

export function numberToWordsBangla(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n === 0) return 'শূন্য';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${bnThree(crore)} কোটি`);
  if (lakh) parts.push(`${bnThree(lakh)} লক্ষ`);
  if (thousand) parts.push(`${bnThree(thousand)} হাজার`);
  if (rest) parts.push(bnThree(rest));
  return parts.join(' ').trim();
}

export function takaInWords(poisha: bigint, locale: 'en-BD' | 'bn-BD'): string {
  const negative = poisha < 0n;
  const abs = absPoisha(poisha);
  const taka = Number(abs / POISHA_PER_TAKA);
  const paisa = Number(abs % POISHA_PER_TAKA);
  if (locale === 'bn-BD') {
    const t = `${numberToWordsBangla(taka)} টাকা`;
    const p = paisa ? ` ${numberToWordsBangla(paisa)} পয়সা` : '';
    return `${negative ? 'ঋণাত্মক ' : ''}${t}${p} মাত্র`;
  }
  const t = `${numberToWordsEnglish(taka)} Taka`;
  const p = paisa ? ` and ${numberToWordsEnglish(paisa)} Poisha` : '';
  return `${negative ? 'Minus ' : ''}${t}${p} Only`;
}

export function safeParseBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return bdtToPoisha(value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[৳,\s]/g, '').replace(/n$/, '');
    if (!cleaned) return fallback;
    try {
      return BigInt(cleaned);
    } catch {
      try {
        return bdtToPoisha(cleaned);
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

/** Revive a JSON snapshot: any key ending in _poisha becomes a bigint. */
export function revivePoishaDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => revivePoishaDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.endsWith('_poisha')) {
        out[k] = safeParseBigInt(v);
      } else if (v && typeof v === 'object') {
        out[k] = revivePoishaDeep(v);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }
  return value;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function currentDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function periodCodeOf(date: string): string {
  return date.slice(0, 7);
}

export function isoNow(): string {
  return new Date().toISOString();
}
