import { describe, expect, it } from 'vitest';
import type { BankAccount, FiscalPeriod } from '../src/setup/api';
import type { TrialBalance } from '../src/ledger/api';
import {
  computeCashPosition,
  computeOverdue,
  fiscalYearStartFor,
  pickCurrentPeriod,
} from '../src/pages/dashboard/dashboardData';

function period(code: string, startDate: string, endDate: string, fiscalYearId = 'fy-1'): FiscalPeriod {
  return {
    id: `period-${code}`,
    companyId: 'company-1',
    fiscalYearId,
    code,
    label: code,
    startDate,
    endDate,
    status: 'OPEN',
    closedAt: null,
    lockedAt: null,
    reopenedReason: null,
  };
}

function bank(id: string, glAccountId: string, name: string): BankAccount {
  return {
    id,
    companyId: 'company-1',
    name,
    kind: 'BANK',
    provider: 'Test',
    maskedNumber: '•••• 1',
    branch: null,
    currency: 'BDT',
    glAccountId,
    glAccountCode: '1010',
    glAccountName: 'Bank',
    openingPoisha: '0',
    openingBdt: '0.00',
    status: 'ACTIVE',
    isPrincipal: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function trial(rows: Array<{ accountId: string; debit: string; credit: string }>): Pick<TrialBalance, 'rows'> {
  return {
    rows: rows.map((row) => ({
      accountId: row.accountId,
      accountCode: '1010',
      accountNameEn: 'Bank',
      accountNameBn: null,
      accountType: 'ASSET',
      subCategory: 'CURRENT_ASSET',
      openingDebitPoisha: '0',
      openingCreditPoisha: '0',
      openingNetPoisha: '0',
      periodDebitPoisha: '0',
      periodCreditPoisha: '0',
      periodNetPoisha: '0',
      closingDebitPoisha: row.debit,
      closingCreditPoisha: row.credit,
      closingNetPoisha: '0',
    })),
  };
}

describe('dashboard derivations', () => {
  it('selects the period containing today, then the latest started period', () => {
    const periods = [period('2026-07', '2026-07-01', '2026-07-31'), period('2026-08', '2026-08-01', '2026-08-31')];
    expect(pickCurrentPeriod(periods, '2026-08-15')?.code).toBe('2026-08');
    expect(pickCurrentPeriod(periods, '2026-09-10')?.code).toBe('2026-08');
    expect(pickCurrentPeriod(periods, '2026-06-10')?.code).toBe('2026-07');
    expect(pickCurrentPeriod([], '2026-08-15')).toBeNull();
  });

  it('sums only positive open items and counts overdue separately', () => {
    const summary = computeOverdue([
      { daysOverdue: 5, outstandingPoisha: '10000' },
      { daysOverdue: 0, outstandingPoisha: '5000' },
      { daysOverdue: 40, outstandingPoisha: '2500' },
      { daysOverdue: 3, outstandingPoisha: '0' },
      { daysOverdue: 2, outstandingPoisha: '-1500' },
    ]);
    expect(summary.openCount).toBe(3);
    expect(summary.openPoisha).toBe(17500n);
    expect(summary.overdueCount).toBe(2);
    expect(summary.overduePoisha).toBe(12500n);
  });

  it('deduplicates cash accounts mapped to the same GL account', () => {
    const cash = computeCashPosition(
      [
        bank('bank-1', 'gl-1', 'Main bank'),
        bank('bank-2', 'gl-1', 'Duplicate mapping'),
        bank('cash-1', 'gl-2', 'Cash'),
      ],
      trial([
        { accountId: 'gl-1', debit: '120000', credit: '20000' },
        { accountId: 'gl-2', debit: '30000', credit: '0' },
      ]),
    );
    expect(cash?.entries).toHaveLength(2);
    expect(cash?.totalPoisha).toBe(130000n);
  });

  it('returns no cash position when no account is configured', () => {
    expect(computeCashPosition([], trial([]))).toBeNull();
  });

  it('uses the period fiscal year before guessing from today', () => {
    const years = [
      { id: 'fy-1', startDate: '2025-07-01', endDate: '2026-06-30' },
      { id: 'fy-2', startDate: '2026-07-01', endDate: '2027-06-30' },
    ];
    expect(fiscalYearStartFor(years, period('2026-07', '2026-07-01', '2026-07-31', 'fy-2'), '2026-08-01')).toBe(
      '2026-07-01',
    );
    expect(fiscalYearStartFor(years, null, '2026-02-01')).toBe('2025-07-01');
    expect(fiscalYearStartFor([], null, '2026-02-01')).toBeNull();
  });
});
