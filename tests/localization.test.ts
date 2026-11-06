import { describe, expect, it } from 'vitest';
import {
  BN_DICTIONARY,
  EN_DICTIONARY,
  dictionaryParity,
  interpolate,
  monthYearLabel,
  translate,
} from '../src/core/i18n';
import { formatPoisha, formatPlainNumber } from '../src/core/money';

function placeholders(value: string): string[] {
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1] ?? '').sort();
}

describe('localization release gate', () => {
  it('keeps English and Bangla dictionaries complete and non-empty', () => {
    const parity = dictionaryParity();
    expect(parity.complete).toBe(true);
    expect(parity.missing_in_bn).toEqual([]);
    expect(parity.missing_in_en).toEqual([]);
    expect(parity.en_keys).toBeGreaterThan(1_200);
    for (const [key, value] of Object.entries(EN_DICTIONARY)) {
      expect(value.trim(), `English value for ${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries(BN_DICTIONARY)) {
      expect(value.trim(), `Bangla value for ${key}`).not.toBe('');
    }
  });

  it('preserves every interpolation placeholder across languages', () => {
    for (const key of Object.keys(EN_DICTIONARY)) {
      const english = EN_DICTIONARY[key] ?? '';
      const bangla = BN_DICTIONARY[key] ?? '';
      expect(placeholders(bangla), `placeholders for ${key}`).toEqual(placeholders(english));
    }
  });

  it('falls back visibly rather than crashing when a key is missing', () => {
    expect(translate('bn-BD', 'release.missing.key', undefined, { fallback: 'Fallback' })).toBe('Fallback');
    expect(translate('bn-BD', 'release.missing.key')).toBe('release.missing.key');
  });

  it('formats lakh/crore boundaries, negatives, zero and Bangla digits exactly', () => {
    expect(formatPoisha(0n, { showSymbol: false })).toBe('0.00');
    expect(formatPoisha(100n, { showSymbol: false })).toBe('1.00');
    expect(formatPoisha(-100n, { showSymbol: false })).toBe('−1.00');
    expect(formatPoisha(9_999_999_900n, { showSymbol: false })).toBe('9,99,99,999.00');
    expect(formatPoisha(999_999_999_00n, { showSymbol: false })).toBe('99,99,99,999.00');
    expect(formatPoisha(123_456_789_00n, { showSymbol: false })).toBe('12,34,56,789.00');
    expect(formatPoisha(123_456_789_00n, { locale: 'bn-BD', showSymbol: false })).toBe('১২,৩৪,৫৬,৭৮৯.০০');
    expect(formatPlainNumber('123456789.50', { grouping: 'LAKH_CRORE' })).toBe('12,34,56,789.50');
    expect(formatPlainNumber('123456789.50', { grouping: 'MILLIONS' })).toBe('123,456,789.50');
  });

  it('formats dates and placeholders in the active locale', () => {
    expect(monthYearLabel('2026-11-01', 'en-BD')).toBe('November 2026');
    expect(monthYearLabel('2026-11-01', 'bn-BD')).toBe('নভেম্বর ২০২৬');
    expect(interpolate('Amount {amount}', { amount: 123_456_789_00n }, 'en-BD')).toBe('Amount ৳ 12,34,56,789.00');
    expect(interpolate('Count {count}', { count: 1234 }, 'bn-BD')).toBe('Count ১,২৩৪');
  });
});
