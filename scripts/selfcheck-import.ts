// Phase 2 runtime self-check #2: import studio + audit pack export (not part of the app bundle).
import { existsSync, rmSync } from 'node:fs';
import { postJournal, verifyAuditChain, reconcileSubledgers } from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';
import { buildFinancialStatements } from '../src/core/ifrs-engine/ifrsEngine';
import {
  applyBatchBalanceRules,
  buildJournalsFromSimulation,
  exportFullAuditPackXlsx,
  generateDemoImportBatch,
  parseAndSimulateImport,
  type ImportState,
} from '../src/core/import-export/xlsxEngine';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${message}`);
  }
}

const dataset = createSeedDataset('APEX');
// The demo opening-balance batch is dated at the fiscal-year start, which the seed exposes as
// CLOSED. A historical opening batch can only post when the operator reopens/authorises the
// period, so this harness uses an OPEN view rather than bypassing the production rule.
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
  const rows = generateDemoImportBatch(pipeline);
  const pipelineState: ImportState =
    pipeline === 'OPENING_BALANCE' ? { ...state, periods: openPeriods } : state;
  const simulation = applyBatchBalanceRules(parseAndSimulateImport(rows, pipelineState, { pipeline }));
  console.log(
    `[${pipeline}] rows=${simulation.rows.length} valid=${simulation.valid_rows} invalid=${simulation.invalid_rows} outVat=${Number(
      simulation.output_vat_poisha,
    ) / 100} inVat=${Number(simulation.input_vat_claimable_poisha) / 100} vds=${Number(simulation.vds_poisha) / 100} tds=${
      Number(simulation.tds_poisha) / 100
    } balanced=${simulation.balanced}`,
  );
  const failing = simulation.rows.filter((row) => row.errors.length > 0);
  for (const row of failing.slice(0, 4)) {
    console.log(`   row ${row.row_number} ${row.status}: ${row.errors[0]}`);
  }
  assert(simulation.rows.length > 0, `${pipeline}: demo batch generates rows`);
  assert(simulation.invalid_rows > 0, `${pipeline}: demo batch exercises validation failures`);
  assert(simulation.valid_rows > 0, `${pipeline}: demo batch has valid rows`);

  // Commit the valid rows into a scratch ledger and prove the chain + statements still hold.
  const result = buildJournalsFromSimulation(simulation, {
    state: pipelineState,
    batchId: `BATCH-${pipeline}`,
    committedBy: 'selfcheck',
  });
  const scratch = [...dataset.journals];
  const postingPeriods = pipeline === 'OPENING_BALANCE' ? openPeriods : dataset.periods;
  for (const draft of result.drafts) {
    const posted = postJournal(draft, { journals: scratch, periods: postingPeriods, accounts: dataset.accounts, actor: 'selfcheck' });
    scratch.push(posted);
  }
  const chain = verifyAuditChain(scratch);
  assert(chain.valid, `${pipeline}: audit chain survives the committed import (${result.drafts.length} journals)`);
  const fs = buildFinancialStatements({
    tenant: dataset.tenant,
    accounts: dataset.accounts,
    journals: scratch,
    commercialDocs: [...dataset.commercialDocs, ...result.docs],
    bankAccounts: dataset.bankAccounts,
    bookFilter: 'ALL_IFRS_BOOKS',
    periodCode: '2026-10',
    comparativeCode: '2026-09',
  });
  assert(fs.balance_sheet.balanced, `${pipeline}: balance sheet still balances after commit (imbalance ${fs.balance_sheet.imbalance_poisha})`);
  assert(fs.cash_flow.reconciles, `${pipeline}: cash flow still reconciles after commit (diff ${fs.cash_flow.difference_poisha})`);
  const recon = reconcileSubledgers(
    dataset.accounts,
    scratch,
    [...dataset.commercialDocs, ...result.docs],
    dataset.bankAccounts.map((bank) => ({
      ...bank,
      opening_poisha: bank.opening_poisha + (result.bank_opening_delta_poisha[bank.account_code] ?? 0n),
    })),
  );
  if (!recon.all_reconciled) {
    console.log('   subledger differences after import:');
    for (const row of recon.rows) if (!row.reconciled) console.log(`     ${row.key} diff=${Number(row.difference_poisha) / 100}`);
  }
  assert(recon.all_reconciled, `${pipeline}: subledger proofs still reconcile after commit`);
}

// Audit pack export
const fsBase = buildFinancialStatements({
  tenant: dataset.tenant,
  accounts: dataset.accounts,
  journals: dataset.journals,
  commercialDocs: dataset.commercialDocs,
  bankAccounts: dataset.bankAccounts,
  bookFilter: 'ALL_IFRS_BOOKS',
  periodCode: '2026-10',
  comparativeCode: '2026-09',
});
const exportPath = 'scripts/audit-pack-selftest.xlsx';
if (existsSync(exportPath)) rmSync(exportPath);
process.chdir('scripts');
exportFullAuditPackXlsx({
  tenant: dataset.tenant,
  statements: fsBase,
  journals: dataset.journals,
  commercialDocs: dataset.commercialDocs,
  challans: dataset.challans,
  accounts: dataset.accounts,
  subledger: reconcileSubledgers(dataset.accounts, dataset.journals, dataset.commercialDocs, dataset.bankAccounts),
  auditChain: verifyAuditChain(dataset.journals),
});
process.chdir('..');
const written = existsSync('scripts/LedgerVault-Audit-Pack-2026-10-APEX.xlsx');
assert(written, 'audit pack .xlsx is written with all 9 tabs');
if (written) {
  const { readFileSync } = require('node:fs');
  const size = readFileSync('scripts/LedgerVault-Audit-Pack-2026-10-APEX.xlsx').length;
  console.log(`   audit pack size = ${(size / 1024).toFixed(1)} KB`);
  assert(size > 20000, 'audit pack contains real worksheet data');
}
