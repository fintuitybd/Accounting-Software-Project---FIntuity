import { describe, expect, it } from 'vitest';
import { parseBdtToPoisha, formatPoishaAsBdt, parseQuantity } from '../../src/company/money.ts';
import {
  fiscalYearLabel,
  generateMonthlyPeriods,
  isFirstOfMonth,
  isLastOfMonth,
  isValidIsoDate,
} from '../../src/company/dates.ts';
import { parseCsv } from '../../src/company/csv.ts';

describe('Phase 4 money parsing', () => {
  it('converts decimal BDT strings to exact integer poisha without floating point', () => {
    expect(parseBdtToPoisha('0')).toBe(0n);
    expect(parseBdtToPoisha('1')).toBe(100n);
    expect(parseBdtToPoisha('1.5')).toBe(150n);
    expect(parseBdtToPoisha('123456789.99')).toBe(12345678999n);
    expect(formatPoishaAsBdt(12345678999n)).toBe('123456789.99');
  });

  it('rejects negative, exponent, comma and over-precise amounts', () => {
    expect(parseBdtToPoisha('-1.00')).toBeNull();
    expect(parseBdtToPoisha('1e3')).toBeNull();
    expect(parseBdtToPoisha('1,000.00')).toBeNull();
    expect(parseBdtToPoisha('10.999')).toBeNull();
    expect(parseBdtToPoisha('')).toBeNull();
  });

  it('parses quantities with up to four decimals into ten-thousandths', () => {
    expect(parseQuantity('2')).toBe(20000n);
    expect(parseQuantity('2.125')).toBe(21250n);
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('1.00001')).toBeNull();
  });
});

describe('Phase 4 fiscal year generation', () => {
  it('generates a non-July January-to-December year dynamically', () => {
    const periods = generateMonthlyPeriods('2031-01-01', '2031-12-31');
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ code: '2031-01', startDate: '2031-01-01', endDate: '2031-01-31' });
    expect(periods[11]).toMatchObject({ code: '2031-12', startDate: '2031-12-01', endDate: '2031-12-31' });
    expect(fiscalYearLabel('2031-01-01', '2031-12-31')).toBe('FY 2031');
  });

  it('supports a July-to-June fiscal year without hard-coded dates', () => {
    const periods = generateMonthlyPeriods('2032-07-01', '2033-06-30');
    expect(periods).toHaveLength(12);
    expect(periods[0]?.code).toBe('2032-07');
    expect(periods[11]?.code).toBe('2033-06');
    expect(fiscalYearLabel('2032-07-01', '2033-06-30')).toBe('FY 2032-33');
  });

  it('rejects partial months, reversed ranges and impossible dates', () => {
    expect(() => generateMonthlyPeriods('2031-01-02', '2031-12-31')).toThrow(/first day/);
    expect(() => generateMonthlyPeriods('2031-01-01', '2031-12-30')).toThrow(/last day/);
    expect(() => generateMonthlyPeriods('2031-12-01', '2031-01-31')).toThrow(/must not precede/);
    expect(isValidIsoDate('2031-02-29')).toBe(false);
    expect(isValidIsoDate('2032-02-29')).toBe(true);
    expect(isFirstOfMonth('2031-01-01')).toBe(true);
    expect(isLastOfMonth('2031-01-31')).toBe(true);
  });
});

describe('Phase 4 chart-of-accounts CSV parsing', () => {
  it('parses quoted commas and escaped quotes', () => {
    const parsed = parseCsv('code,name_en\r\n1000,"Cash, petty"\r\n1100,"A ""quoted"" name"\r\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      ['code', 'name_en'],
      ['1000', 'Cash, petty'],
      ['1100', 'A "quoted" name'],
    ]);
  });

  it('reports an unterminated quoted field instead of guessing', () => {
    const parsed = parseCsv('code,name_en\n1000,"unterminated');
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.rows).toEqual([]);
  });
});
