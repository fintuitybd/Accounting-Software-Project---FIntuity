import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.ts';
import {
  divideRoundHalfUp,
  formatQuantity,
  impliedUnitCostPoisha,
  outboundValuePoisha,
  parsePositiveQuantity,
  receiptValuePoisha,
} from '../../src/inventory/quantity.ts';

describe('inventory quantity and valuation arithmetic', () => {
  it('parses four-decimal quantities exactly without floating point', () => {
    expect(parsePositiveQuantity('1.2345')).toBe(12_345n);
    expect(parsePositiveQuantity('10')).toBe(100_000n);
    expect(parsePositiveQuantity('0.0001')).toBe(1n);
    expect(formatQuantity(12_345n)).toBe('1.2345');
    expect(formatQuantity(-60_000n)).toBe('-6.0000');
  });

  it('rejects zero, negative, malformed and over-precise quantities', () => {
    for (const value of ['0', '-1', '1.23456', 'abc', '', '1,000']) {
      expect(() => parsePositiveQuantity(value)).toThrow(AppError);
    }
  });

  it('rounds valuation divisions half-up deterministically', () => {
    expect(divideRoundHalfUp(10n, 4n)).toBe(3n);
    expect(divideRoundHalfUp(11n, 4n)).toBe(3n);
    expect(divideRoundHalfUp(-10n, 4n)).toBe(-3n);
    expect(divideRoundHalfUp(10n, -4n)).toBe(-3n);
  });

  it('values receipts and partial issues at weighted average', () => {
    // 10 kg @ 100.00 then 10 kg @ 120.00 => 20 kg / 220,000 poisha, average 110.00.
    const first = receiptValuePoisha(100_000n, 10_000n);
    const second = receiptValuePoisha(100_000n, 12_000n);
    const totalValue = first + second;
    expect(first).toBe(100_000n);
    expect(second).toBe(120_000n);
    expect(totalValue).toBe(220_000n);
    expect(impliedUnitCostPoisha(200_000n, totalValue)).toBe(11_000n);
    // Issue 5 kg: 5 * 220,000 / 20 = 55,000 poisha.
    expect(outboundValuePoisha(50_000n, 200_000n, totalValue)).toBe(55_000n);
    // Issuing the exact remainder takes the whole remaining value and cannot strand a poisha.
    expect(outboundValuePoisha(150_000n, 150_000n, 165_000n)).toBe(165_000n);
  });

  it('rounds a fractional division to the nearest poisha', () => {
    // 1 kg of a 3 kg / 100 poisha balance = 33.333... poisha -> 33 poisha.
    expect(outboundValuePoisha(10_000n, 30_000n, 100n)).toBe(33n);
  });
});
