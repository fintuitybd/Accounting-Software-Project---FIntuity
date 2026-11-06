// Phase 2 final gate: re-run every engine check in one pass.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { verifyAuditChain, reconcileSubledgers } from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';
import { buildFinancialStatements } from '../src/core/ifrs-engine/ifrsEngine';
import { runGoldenSuite } from '../src/core/tax-engine/goldenSuite';
import {
  applyBatchBalanceRules,
  buildJournalsFromSimulation,
  exportFullAuditPackXlsx,
  generateDemoImportBatch,
  parseAndSimulateImport,
  type ImportState,
} from '../src/core/import-export/xlsxEngine';
import { postJournal } from '../src/core/ledger/ledgerEngine';

const fail: string[] = [];
const check = (condition: boolean, label: string): void => {
  if (!condition) fail.push(label);
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
};

const dataset = createSeedDataset('APEX');
const chain = verifyAuditChain(dataset.journals);
const recon = reconcileSubledgers(dataset.accounts, dataset.journals, dataset.commercialDocs, dataset.bankAccounts);
const fs = buildFinancialStatements({
  tenant: dataset.tenant,
  accounts: dataset.accounts,
  journals: dataset.journals,
  commercialDocs: dataset.commercialDocs,
  parties: dataset.parties,
  bankAccounts: dataset.bankAccounts,
  bookFilter: 'ALL_IFRS_BOOKS',
  periodCode: '2026-10',
  comparativeCode: '2026-09',
});
const golden = runGoldenSuite();

console.log(`\njournals=${dataset.journals.length} documents=${dataset.commercialDocs.length} challans=${dataset.challans.length} statements=${dataset.statementLines.length} payroll=${dataset.payrollRows.length}`);
check(chain.valid, `SHA-256 audit chain valid over ${chain.checkedCount} journals`);
check(recon.all_reconciled, 'all six subledger control accounts reconcile');
check(recon.rows.length === 6, 'six control proofs generated');
check(fs.balance_sheet.balanced, `IAS 1 balance sheet balanced (imbalance ${fs.balance_sheet.imbalance_poisha})`);
check(fs.balance_sheet.total_assets_poisha === fs.balance_sheet.total_equity_and_liabilities_poisha, 'total assets === total equity + liabilities');
check(fs.cash_flow.reconciles, `IAS 7 cash flow reconciles exactly (difference ${fs.cash_flow.difference_poisha})`);
check(fs.cash_flow.opening_cash_poisha + fs.cash_flow.net_change_poisha === fs.cash_flow.closing_cash_poisha, 'opening cash + net change = closing cash + MFS');
check(fs.profit_or_loss.operating_profit_poisha + fs.profit_or_loss.investing.total_poisha === fs.profit_or_loss.profit_before_financing_tax_poisha, 'IFRS 18 mandatory subtotal 2');
check(fs.profit_or_loss.profit_for_period_poisha === fs.profit_or_loss.profit_before_tax_poisha + fs.profit_or_loss.income_tax.total_poisha, 'profit for the period = PBT + income taxes');
check(fs.profit_or_loss.mpm.adjusted_ebitda_poisha === fs.profit_or_loss.mpm.operating_profit_poisha + fs.profit_or_loss.mpm.depreciation_poisha + fs.profit_or_loss.mpm.ecl_poisha, 'Adjusted EBITDA reconciles to Operating Profit');
check(fs.notes.length >= 5, `${fs.notes.length} notes to the financial statements built`);
check(golden.failed === 0 && golden.total === 25, `25 golden tax vectors still pass (${golden.passed}/${golden.total})`);

const openPeriods = dataset.periods.map((period) => ({ ...period, status: 'OPEN' as const }));
const state: ImportState = {
  tenant: dataset.tenant,
  accounts: dataset.accounts,
  journals: dataset.journals,
  commercialDocs: dataset.commercialDocs,
  periods: dataset.periods,
  parties: dataset.parties,
  bankAccounts: dataset.bankAccounts,
};
for (const pipeline of ['SALES_PURCHASE', 'BULK_JOURNAL', 'OPENING_BALANCE', 'BANK_MFS'] as const) {
  const pipelineState: ImportState =
    pipeline === 'OPENING_BALANCE' ? { ...state, periods: openPeriods } : state;
  const simulation = applyBatchBalanceRules(parseAndSimulateImport(generateDemoImportBatch(pipeline), pipelineState, { pipeline }));
  check(simulation.rows.length === 25, `${pipeline}: exactly 25 demo rows`);
  check(simulation.valid_rows > 0 && simulation.invalid_rows > 0, `${pipeline}: dry run separates valid from rejected rows`);
  const result = buildJournalsFromSimulation(simulation, { state: pipelineState, batchId: `B-${pipeline}`, committedBy: 'gate' });
  const scratch = [...dataset.journals];
  const postingPeriods = pipeline === 'OPENING_BALANCE' ? openPeriods : dataset.periods;
  for (const draft of result.drafts) {
    scratch.push(postJournal(draft, { journals: scratch, periods: postingPeriods, accounts: dataset.accounts, actor: 'gate' }));
  }
  check(verifyAuditChain(scratch).valid, `${pipeline}: chain survives commit`);
  const after = buildFinancialStatements({
    tenant: dataset.tenant,
    accounts: dataset.accounts,
    journals: scratch,
    commercialDocs: [...dataset.commercialDocs, ...result.docs],
    bankAccounts: dataset.bankAccounts,
    bookFilter: 'ALL_IFRS_BOOKS',
    periodCode: '2026-10',
    comparativeCode: '2026-09',
  });
  check(after.balance_sheet.balanced && after.cash_flow.reconciles, `${pipeline}: statements stay balanced after commit`);
}

const target = 'scripts/gate-audit-pack.xlsx';
if (existsSync(target)) rmSync(target);
process.chdir('scripts');
exportFullAuditPackXlsx({
  tenant: dataset.tenant,
  statements: fs,
  journals: dataset.journals,
  commercialDocs: dataset.commercialDocs,
  challans: dataset.challans,
  accounts: dataset.accounts,
  subledger: recon,
  auditChain: chain,
});
process.chdir('..');
const packPath = 'scripts/LedgerVault-Audit-Pack-2026-10-APEX.xlsx';
const size = existsSync(packPath) ? readFileSync(packPath).length : 0;
check(size > 20000, `9-tab audit pack written (${(size / 1024).toFixed(0)} KB)`);

console.log(`\n${fail.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fail.join(' | ')}`}`);
if (fail.length > 0) process.exitCode = 1;
