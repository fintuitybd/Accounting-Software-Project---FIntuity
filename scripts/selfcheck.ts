// Phase 2 runtime self-check (not part of the app bundle, not type-checked by tsc).
// Run via: node_modules\.bin\esbuild scripts/selfcheck.ts --bundle --platform=node --format=cjs --outfile=scripts/selfcheck.cjs
import { createHash } from 'node:crypto';
import { sha256Hex, verifyAuditChain, reconcileSubledgers } from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';
import { buildFinancialStatements } from '../src/core/ifrs-engine/ifrsEngine';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${message}`);
  }
}

const samples = [
  '',
  'abc',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
  'The quick brown fox jumps over the lazy dog',
  'আইএফআরএস ১৮ এবং মূসক ৯.১ — ৳ ১২,৩৪,৫৬,৭৮৯.০০',
  'x'.repeat(1000),
];
for (const sample of samples) {
  const expected = createHash('sha256').update(sample, 'utf8').digest('hex');
  assert(sha256Hex(sample) === expected, `sha256 matches node:crypto for ${JSON.stringify(sample.slice(0, 24))}`);
}

const dataset = createSeedDataset('APEX');
console.log(`\njournals=${dataset.journals.length} documents=${dataset.commercialDocs.length} challans=${dataset.challans.length}`);

let totalDr = 0n;
let totalCr = 0n;
let unbalanced = 0;
for (const journal of dataset.journals) {
  let dr = 0n;
  let cr = 0n;
  for (const line of journal.lines) {
    dr += line.debit_poisha;
    cr += line.credit_poisha;
  }
  if (dr !== cr || dr <= 0n || journal.lines.length < 2) {
    unbalanced += 1;
    console.error(`  unbalanced ${journal.journal_number} dr=${dr} cr=${cr} lines=${journal.lines.length}`);
  }
  totalDr += dr;
  totalCr += cr;
}
assert(unbalanced === 0, 'every seeded journal is balanced with >= 2 lines and a positive debit');
assert(totalDr === totalCr, `ledger totals tie (${totalDr} poisha)`);

const chain = verifyAuditChain(dataset.journals);
assert(chain.valid, `audit chain verifies over ${chain.checkedCount} journals${chain.brokenAtId ? ` (broken at ${chain.brokenAtId})` : ''}`);

const recon = reconcileSubledgers(dataset.accounts, dataset.journals, dataset.commercialDocs, dataset.bankAccounts);
for (const row of recon.rows) {
  console.log(
    `  ${row.key.padEnd(20)} gl=${row.gl_balance_poisha.toString().padStart(12)} sub=${row.subledger_balance_poisha
      .toString()
      .padStart(12)} diff=${row.difference_poisha.toString().padStart(8)} open=${row.open_items}`,
  );
}
assert(recon.all_reconciled, `all six control accounts reconcile (total diff ${recon.total_difference_poisha})`);
assert(recon.suspense_balance_poisha > 0n, `suspense balance surfaced (${recon.suspense_balance_poisha})`);

// Prove that an edited line breaks the chain.
const tampered = dataset.journals.map((journal, index) =>
  index === 3
    ? { ...journal, lines: journal.lines.map((line, lineIndex) => (lineIndex === 0 ? { ...line, debit_poisha: line.debit_poisha + 1n } : line)) }
    : journal,
);
assert(!verifyAuditChain(tampered).valid, 'tampering with one poisha breaks the audit chain');

for (const code of ['1110', '1120', '1130', '1140', '1210', '1310', '2110', '2120', '2130', '2140', '2180', '2190', '3100', '3200']) {
  let balance = 0n;
  for (const journal of dataset.journals) {
    for (const line of journal.lines) {
      if (line.account_code === code) balance += line.debit_poisha - line.credit_poisha;
    }
  }
  console.log(`  balance ${code} = ${(Number(balance) / 100).toLocaleString('en-US')}`);
}

// ---- Financial statements ---------------------------------------------------------------
for (const filter of ['STATUTORY_BD', 'ALL_IFRS_BOOKS', 'TAX_COMPUTATION'] as const) {
  const fs = buildFinancialStatements({
    tenant: dataset.tenant,
    accounts: dataset.accounts,
    journals: dataset.journals,
    commercialDocs: dataset.commercialDocs,
    parties: dataset.parties,
    bankAccounts: dataset.bankAccounts,
    bookFilter: filter,
    periodCode: '2026-10',
    comparativeCode: '2026-09',
  });
  const money = (value: bigint): string => (Number(value) / 100).toLocaleString('en-US');
  console.log(`\n[${filter}]`);
  console.log(`  total assets          ${money(fs.balance_sheet.total_assets_poisha)}`);
  console.log(`  equity + liabilities  ${money(fs.balance_sheet.total_equity_and_liabilities_poisha)}`);
  console.log(`  imbalance             ${money(fs.balance_sheet.imbalance_poisha)}`);
  console.log(
    `  operating ${money(fs.profit_or_loss.operating_profit_poisha)} | PBTFI ${money(
      fs.profit_or_loss.profit_before_financing_tax_poisha,
    )} | PBT ${money(fs.profit_or_loss.profit_before_tax_poisha)} | PAT ${money(
      fs.profit_or_loss.profit_for_period_poisha,
    )} | EBITDA ${money(fs.profit_or_loss.mpm.adjusted_ebitda_poisha)}`,
  );
  console.log(
    `  cash opening ${money(fs.cash_flow.opening_cash_poisha)} + net ${money(
      fs.cash_flow.net_change_poisha,
    )} = ${money(fs.cash_flow.opening_cash_poisha + fs.cash_flow.net_change_poisha)} vs closing ${money(
      fs.cash_flow.closing_cash_poisha,
    )} | reconciles=${fs.cash_flow.reconciles} diff=${money(fs.cash_flow.difference_poisha)}`,
  );
  assert(fs.balance_sheet.balanced, `${filter}: balance sheet balances to 0 poisha`);
  assert(fs.cash_flow.reconciles, `${filter}: IAS 7 cash flow reconciles to closing cash + MFS`);
  assert(
    fs.profit_or_loss.operating_profit_poisha +
      fs.profit_or_loss.investing.total_poisha ===
      fs.profit_or_loss.profit_before_financing_tax_poisha,
    `${filter}: IFRS 18 mandatory subtotal 2 is arithmetically correct`,
  );
  assert(
    fs.profit_or_loss.profit_before_financing_tax_poisha + fs.profit_or_loss.financing.total_poisha ===
      fs.profit_or_loss.profit_before_tax_poisha,
    `${filter}: PBT = PBTFI + financing`,
  );
  const totalDebit = fs.trial_balance.reduce((sum, row) => sum + row.closing_debit_poisha, 0n);
  const totalCredit = fs.trial_balance.reduce((sum, row) => sum + row.closing_credit_poisha, 0n);
  assert(totalDebit === totalCredit, `${filter}: trial balance closing debits equal credits`);
}

