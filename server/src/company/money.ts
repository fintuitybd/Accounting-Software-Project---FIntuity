/**
 * Exact money parsing for Phase 4 APIs. Clients submit decimal BDT strings; the server converts
 * them to integer poisha with BigInt arithmetic. JavaScript floating point is never authoritative.
 */

const MAX_INTEGER_DIGITS = 16;

export const POISHA_PER_TAKA = 100n;

export function parseBdtToPoisha(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [wholeRaw, fractionRaw = ''] = text.split('.');
  const whole = wholeRaw ?? '';
  if (whole.length > MAX_INTEGER_DIGITS) return null;
  const fraction = (fractionRaw + '00').slice(0, 2);
  return BigInt(whole) * POISHA_PER_TAKA + BigInt(fraction);
}

export function formatPoishaAsBdt(value: bigint | string): string {
  const poisha = typeof value === 'bigint' ? value : BigInt(value);
  const negative = poisha < 0n;
  const absolute = negative ? -poisha : poisha;
  const whole = absolute / POISHA_PER_TAKA;
  const fraction = absolute % POISHA_PER_TAKA;
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

/** Parse a non-negative whole quantity with up to four decimals into ten-thousandths. */
export function parseQuantity(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/.test(text)) return null;
  const [wholeRaw, fractionRaw = ''] = text.split('.');
  const whole = wholeRaw ?? '';
  if (whole.length > 12) return null;
  return BigInt(whole) * 10_000n + BigInt((fractionRaw + '0000').slice(0, 4));
}
