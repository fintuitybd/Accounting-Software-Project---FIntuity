// Pure dashboard derivations.
//
// Every amount originates from a server response. These helpers only select the current period,
// aggregate already-authoritative posting-currency balances and count overdue open items. They are
// deliberately separate from React so the arithmetic and period selection can be tested.

import type { FiscalPeriod } from '../../setup/api';
import type { TrialBalance } from '../../ledger/api';
import type { BankAccount } from '../../setup/api';

export interface OverdueRowLike {
  daysOverdue: number;
  outstandingPoisha: string;
}

export interface OverdueSummary {
  overdueCount: number;
  overduePoisha: bigint;
  openCount: number;
  openPoisha: bigint;
}

export interface CashEntry {
  glAccountId: string;
  name: string;
  kind: BankAccount['kind'];
  balancePoisha: bigint;
}

export interface CashPosition {
  totalPoisha: bigint;
  entries: CashEntry[];
}

export function parsePoisha(value: string): bigint {
  if (!/^-?[0-9]+$/.test(value)) throw new Error(`Invalid poisha value: ${value}`);
  return BigInt(value);
}

export function pickCurrentPeriod(periods: readonly FiscalPeriod[], today: string): FiscalPeriod | null {
  if (periods.length === 0) return null;
  const sorted = [...periods].sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate));
  const containing = sorted.find((period) => period.startDate <= today && period.endDate >= today);
  if (containing) return containing;
  const started = [...sorted].reverse().find((period) => period.startDate <= today);
  if (started) return started;
  return sorted[0] ?? null;
}

export function computeOverdue(rows: readonly OverdueRowLike[]): OverdueSummary {
  let overdueCount = 0;
  let overduePoisha = 0n;
  let openCount = 0;
  let openPoisha = 0n;
  for (const row of rows) {
    const outstanding = parsePoisha(row.outstandingPoisha);
    if (outstanding > 0n) {
      openCount += 1;
      openPoisha += outstanding;
      if (row.daysOverdue > 0) {
        overdueCount += 1;
        overduePoisha += outstanding;
      }
    }
  }
  return { overdueCount, overduePoisha, openCount, openPoisha };
}

/**
 * Map configured bank/cash/MFS accounts to the closing GL balance from the trial balance. Deduplicate
 * by GL account id so two bank records mapped to the same ledger account cannot double-count cash.
 */
export function computeCashPosition(
  accounts: readonly BankAccount[],
  trialBalance: Pick<TrialBalance, 'rows'> | null,
): CashPosition | null {
  if (accounts.length === 0) return null;
  const balances = new Map<string, bigint>();
  for (const row of trialBalance?.rows ?? []) {
    const debit = parsePoisha(row.closingDebitPoisha);
    const credit = parsePoisha(row.closingCreditPoisha);
    balances.set(row.accountId, debit - credit);
  }
  const seen = new Set<string>();
  const entries: CashEntry[] = [];
  let totalPoisha = 0n;
  for (const account of accounts) {
    if (seen.has(account.glAccountId)) continue;
    seen.add(account.glAccountId);
    const balancePoisha = balances.get(account.glAccountId) ?? 0n;
    entries.push({
      glAccountId: account.glAccountId,
      name: account.name,
      kind: account.kind,
      balancePoisha,
    });
    totalPoisha += balancePoisha;
  }
  return { totalPoisha, entries };
}

export function fiscalYearStartFor(
  fiscalYears: readonly { id: string; startDate: string; endDate: string }[],
  period: FiscalPeriod | null,
  today: string,
): string | null {
  if (period) {
    const matching = fiscalYears.find((year) => year.id === period.fiscalYearId);
    if (matching) return matching.startDate;
  }
  const containing = fiscalYears.find((year) => year.startDate <= today && year.endDate >= today);
  if (containing) return containing.startDate;
  const sorted = [...fiscalYears].sort((left, right) => left.startDate.localeCompare(right.startDate));
  return sorted[0]?.startDate ?? period?.startDate ?? null;
}
