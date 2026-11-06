import { describe, expect, it } from 'vitest';
import { classifyCashFlowJournals } from '../../src/reports/statements.ts';

function line(overrides: Partial<Parameters<typeof classifyCashFlowJournals>[0][number]['lines'][number]>) {
  return {
    accountId: '00000000-0000-4000-8000-000000000001',
    accountCode: '1010',
    accountNameEn: 'Cash',
    accountNameBn: null,
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    debitPoisha: 0n,
    creditPoisha: 0n,
    isCash: false,
    ...overrides,
  };
}

describe('cash-flow classification proof', () => {
  it('classifies a cash sale as operating and reconciles exactly', () => {
    const result = classifyCashFlowJournals([
      {
        journalId: 'journal-1',
        lines: [
          line({ accountCode: '1010', accountNameEn: 'Bank', accountId: 'cash', debitPoisha: 10_000n, isCash: true }),
          line({
            accountCode: '4100',
            accountNameEn: 'Revenue',
            accountId: 'revenue',
            accountType: 'REVENUE',
            subCategory: 'OPERATING_REVENUE',
            creditPoisha: 10_000n,
          }),
        ],
      },
    ]);
    expect(result.cashEffectPoisha).toBe(10_000n);
    expect(result.classifiedPoisha).toBe(10_000n);
    expect(result.unclassifiedPoisha).toBe(0n);
    expect(result.lines[0]?.section).toBe('operating');
  });

  it('classifies a PPE purchase as investing and a loan receipt as financing', () => {
    const result = classifyCashFlowJournals([
      {
        journalId: 'journal-ppe',
        lines: [
          line({ accountCode: '1010', accountNameEn: 'Bank', accountId: 'cash', creditPoisha: 8_000n, isCash: true }),
          line({
            accountCode: '1610',
            accountNameEn: 'PPE',
            accountId: 'ppe',
            accountType: 'ASSET',
            subCategory: 'NON_CURRENT_ASSET',
            debitPoisha: 8_000n,
          }),
        ],
      },
      {
        journalId: 'journal-loan',
        lines: [
          line({ accountCode: '1010', accountNameEn: 'Bank', accountId: 'cash', debitPoisha: 20_000n, isCash: true }),
          line({
            accountCode: '2210',
            accountNameEn: 'Long-term loan',
            accountId: 'loan',
            accountType: 'LIABILITY',
            subCategory: 'NON_CURRENT_LIABILITY',
            creditPoisha: 20_000n,
          }),
        ],
      },
    ]);
    expect(result.cashEffectPoisha).toBe(12_000n);
    expect(result.classifiedPoisha).toBe(12_000n);
    expect(result.unclassifiedPoisha).toBe(0n);
    expect(result.lines.find((entry) => entry.section === 'investing')?.amountPoisha).toBe(-8_000n);
    expect(result.lines.find((entry) => entry.section === 'financing')?.amountPoisha).toBe(20_000n);
  });

  it('detects an unclassified cash movement instead of hiding it', () => {
    const result = classifyCashFlowJournals([
      {
        journalId: 'journal-broken',
        lines: [
          line({ accountCode: '1010', accountNameEn: 'Bank', accountId: 'cash', debitPoisha: 10_000n, isCash: true }),
        ],
      },
    ]);
    expect(result.cashEffectPoisha).toBe(10_000n);
    expect(result.classifiedPoisha).toBe(0n);
    expect(result.unclassifiedPoisha).toBe(-10_000n);
  });

  it('does not manufacture a movement for a pure bank transfer', () => {
    const result = classifyCashFlowJournals([
      {
        journalId: 'journal-transfer',
        lines: [
          line({
            accountCode: '1010',
            accountNameEn: 'Bank A',
            accountId: 'cash-a',
            debitPoisha: 10_000n,
            isCash: true,
          }),
          line({
            accountCode: '1011',
            accountNameEn: 'Bank B',
            accountId: 'cash-b',
            creditPoisha: 10_000n,
            isCash: true,
          }),
        ],
      },
    ]);
    expect(result.cashEffectPoisha).toBe(0n);
    expect(result.classifiedPoisha).toBe(0n);
    expect(result.unclassifiedPoisha).toBe(0n);
    expect(result.lines).toHaveLength(0);
  });
});
