import { describe, expect, it } from 'vitest';
import { applyRateBps, bdtToPoisha, formatPoisha, roundToTaka, sumPoisha } from '../src/core/money';
import { sha256Hex } from '../src/core/ledger/ledgerEngine';

describe('money primitives', () => {
  it('parses BDT amounts to integer poisha without floating point drift', () => {
    expect(bdtToPoisha('1,23,45,678.90')).toBe(1234567890n);
    expect(bdtToPoisha('৳ ১,২৩৪.৫০')).toBe(123450n);
    expect(bdtToPoisha('(1,000.00)')).toBe(-100000n);
    expect(bdtToPoisha('0.005')).toBe(0n);
  });

  it('applies basis-point rates with the explicit rounding mode', () => {
    expect(applyRateBps(10000000n, 1500)).toBe(1500000n);
    expect(applyRateBps(5n, 1500, 'FLOOR')).toBe(0n);
    expect(applyRateBps(5n, 1500, 'CEIL')).toBe(1n);
    // roundToTaka returns whole taka, not poisha: 12,345 poisha = 123.45 taka -> 123 taka.
    expect(roundToTaka(12345n)).toBe(123n);
  });

  it('formats poisha with lakh/crore grouping', () => {
    expect(formatPoisha(1234567890n)).toBe('৳ 1,23,45,678.90');
    expect(formatPoisha(-100000n)).toBe('−৳ 1,000.00');
    expect(sumPoisha([1n, 2n, 3n])).toBe(6n);
  });
});

describe('audit hash primitive', () => {
  it('matches independently published SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });
});
