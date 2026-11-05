import { describe, expect, it } from 'vitest';
import { buildFinancialStatements } from '../src/core/ifrs-engine/ifrsEngine';
import { reconcileSubledgers, verifyAuditChain } from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';

const dataset = createSeedDataset('APEX');

describe('seed ledger invariants', () => {
  it('contains only balanced journals with at least two lines and a positive debit', () => {
    expect(dataset.journals.length).toBeGreaterThan(0);
    for (const journal of dataset.journals) {
      const debit = journal.lines.reduce((total, line) => total + line.debit_poisha, 0n);
      const credit = journal.lines.reduce((total, line) => total + line.credit_poisha, 0n);
      expect(journal.lines.length).toBeGreaterThanOrEqual(2);
      expect(debit).toBe(credit);
      expect(debit).toBeGreaterThan(0n);
    }
  });

  it('has a valid audit chain and rejects a one-poisha tamper', () => {
    const chain = verifyAuditChain(dataset.journals);
    expect(chain.valid).toBe(true);
    expect(chain.checkedCount).toBe(dataset.journals.length);

    const tampered = dataset.journals.map((journal, index) =>
      index === 3
        ? {
            ...journal,
            lines: journal.lines.map((line, lineIndex) =>
              lineIndex === 0 ? { ...line, debit_poisha: line.debit_poisha + 1n } : line,
            ),
          }
        : journal,
    );
    expect(verifyAuditChain(tampered).valid).toBe(false);
  });

  it('reconciles every control account to its subledger', () => {
    const recon = reconcileSubledgers(dataset.accounts, dataset.journals, dataset.commercialDocs, dataset.bankAccounts);
    expect(recon.rows).toHaveLength(6);
    expect(recon.all_reconciled).toBe(true);
    expect(recon.total_difference_poisha).toBe(0n);
    expect(recon.suspense_balance_poisha).toBeGreaterThan(0n);
  });
});

describe('seed financial statements', () => {
  it.each(['STATUTORY_BD', 'ALL_IFRS_BOOKS', 'TAX_COMPUTATION'] as const)(
    'balances and reconciles for %s',
    (bookFilter) => {
      const statements = buildFinancialStatements({
        tenant: dataset.tenant,
        accounts: dataset.accounts,
        journals: dataset.journals,
        commercialDocs: dataset.commercialDocs,
        parties: dataset.parties,
        bankAccounts: dataset.bankAccounts,
        bookFilter,
        periodCode: '2026-10',
        comparativeCode: '2026-09',
      });

      expect(statements.balance_sheet.balanced).toBe(true);
      expect(statements.balance_sheet.imbalance_poisha).toBe(0n);
      expect(statements.balance_sheet.total_assets_poisha).toBe(
        statements.balance_sheet.total_equity_and_liabilities_poisha,
      );
      expect(statements.cash_flow.reconciles).toBe(true);
      expect(statements.cash_flow.opening_cash_poisha + statements.cash_flow.net_change_poisha).toBe(
        statements.cash_flow.closing_cash_poisha,
      );
      expect(statements.profit_or_loss.operating_profit_poisha + statements.profit_or_loss.investing.total_poisha).toBe(
        statements.profit_or_loss.profit_before_financing_tax_poisha,
      );
      expect(
        statements.profit_or_loss.profit_before_financing_tax_poisha + statements.profit_or_loss.financing.total_poisha,
      ).toBe(statements.profit_or_loss.profit_before_tax_poisha);

      const debit = statements.trial_balance.reduce((total, row) => total + row.closing_debit_poisha, 0n);
      const credit = statements.trial_balance.reduce((total, row) => total + row.closing_credit_poisha, 0n);
      expect(debit).toBe(credit);
    },
  );
});
