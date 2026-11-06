// Phase 2 action-level self-check: the exact engine paths the VaultContext dispatchers use.
import {
  allocateMushak63Serial,
  buildCommercialDoc,
  createReversalJournal,
  inspectMushak63Sequence,
  journalTotals,
  postJournal,
  verifyAuditChain,
} from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${message}`);
  }
}

const dataset = createSeedDataset('APEX');
const customer = dataset.parties.find((party) => party.type === 'CUSTOMER')!;
const supplier = dataset.parties.find((party) => party.type === 'SUPPLIER')!;

// 1. Gap-free Mushak 6.3 allocation per BIN unit
const serial = allocateMushak63Serial('BU-DHK', dataset.commercialDocs, '2026');
assert(serial === 'M63-2026-00006', `next Dhaka Mushak 6.3 serial is ${serial}`);
const chattogramSerial = allocateMushak63Serial('BU-CTG', dataset.commercialDocs, '2026');
assert(chattogramSerial === 'M63-2026-00001', `Chattogram unit starts its own series (${chattogramSerial})`);
const sequence = inspectMushak63Sequence('BU-DHK', dataset.commercialDocs, '2026');
assert(sequence.gap_free, `Dhaka Mushak 6.3 series is gap-free through ${sequence.last_sequence}`);

// 2. Sales invoice exactly as the shell composes it
const saleBuilt = buildCommercialDoc({
  doc_type: 'SALES_INVOICE',
  doc_number: 'INV-2026-10-9001',
  doc_date: '2026-10-31',
  due_date: '2026-11-15',
  party: customer,
  bin_unit_id: 'BU-DHK',
  lines: [
    {
      id: 'L1',
      sku: 'SVC-SALE',
      description_en: 'Consultancy services',
      description_bn: 'পরামর্শ সেবা',
      quantity: 1,
      unit_price_poisha: 25000000n,
      tax_category: 'STANDARD_15',
    },
  ],
  base_poisha: 25000000n,
  tax_category: 'STANDARD_15',
  tds_nature: 'NONE',
  payment_method: 'BANK',
  narration_en: 'Consultancy services rendered',
  narration_bn: 'প্রদত্ত পরামর্শ সেবা',
  mushak_serial: serial,
  book_type: 'STATUTORY_BD',
  created_by: 'selfcheck',
});
const saleDocTotals = journalTotals(saleBuilt.document_lines);
const saleSettleTotals = journalTotals(saleBuilt.settlement_lines);
assert(saleDocTotals.balanced && saleDocTotals.debit_poisha > 0n, 'sales document journal balances');
assert(saleSettleTotals.balanced && saleSettleTotals.debit_poisha > 0n, 'sales settlement journal balances');
assert(saleBuilt.doc.vat_poisha === 3750000n, `output VAT at 15% = ${saleBuilt.doc.vat_poisha} poisha`);
assert(saleBuilt.doc.gross_poisha === 28750000n, 'gross = base + VAT');
assert(saleBuilt.doc.gross_poisha === saleBuilt.doc.net_payable_poisha, 'no withholding for a non-withholding buyer');

// 3. Purchase bill with VDS + TDS and a missing e-TIN
const purchaseBuilt = buildCommercialDoc({
  doc_type: 'PURCHASE_BILL',
  doc_number: 'PB-2026-10-9001',
  doc_date: '2026-10-31',
  due_date: '2026-11-15',
  party: supplier,
  bin_unit_id: 'BU-DHK',
  lines: [
    {
      id: 'L1',
      sku: 'SVC-PURCHASE',
      description_en: 'Supplier bill',
      description_bn: 'সরবরাহকারী বিল',
      quantity: 1,
      unit_price_poisha: 10000000n,
      tax_category: 'STANDARD_15',
    },
  ],
  base_poisha: 10000000n,
  tax_category: 'STANDARD_15',
  tds_nature: 'PROFESSIONAL_OR_TECHNICAL_SERVICES',
  payment_method: 'BANK',
  narration_en: 'Supplier bill',
  narration_bn: 'সরবরাহকারী বিল',
  vds_applicable: true,
  mushak_serial: 'M63-IMP-TEST',
  tenant_is_withholding_entity: true,
  book_type: 'STATUTORY_BD',
  created_by: 'selfcheck',
});
assert(journalTotals(purchaseBuilt.document_lines).balanced, 'purchase document journal balances');
assert(journalTotals(purchaseBuilt.settlement_lines).balanced, 'purchase settlement journal balances');
assert(
  purchaseBuilt.doc.gross_poisha - purchaseBuilt.doc.vds_poisha - purchaseBuilt.doc.tds_poisha ===
    purchaseBuilt.doc.net_payable_poisha,
  'net payable = gross − VDS − TDS',
);

// 4. Post, then reverse, then verify the chain and the two-way link
const journals = [...dataset.journals];
const documentJournal = postJournal(
  {
    book_type: 'STATUTORY_BD',
    bin_unit_id: 'BU-DHK',
    document_date: '2026-10-31',
    posting_date: '2026-10-31',
    source_module: 'SALES',
    source_doc_ref: 'INV-2026-10-9001',
    narration_en: 'Self-check sale',
    narration_bn: 'স্ব-যাচাই বিক্রয়',
    created_by: 'selfcheck',
    lines: saleBuilt.document_lines,
  },
  { journals, periods: dataset.periods, accounts: dataset.accounts, actor: 'selfcheck' },
);
journals.push(documentJournal);
assert(verifyAuditChain(journals).valid, 'chain verifies after a runtime posting');

const revoked = createReversalJournal(documentJournal, 'Customer cancelled the order', '2026-10-31', 'selfcheck', {
  journals,
  periods: dataset.periods,
  accounts: dataset.accounts,
  actor: 'selfcheck',
});
const index = journals.findIndex((journal) => journal.id === documentJournal.id);
journals[index] = revoked.original;
journals.push(revoked.reversal);
const reversedChain = verifyAuditChain(journals);
assert(reversedChain.valid, 'chain verifies after a linked reversal');
assert(revoked.original.status === 'REVERSED', 'original journal is marked REVERSED');
assert(revoked.original.reversed_by_journal_id === revoked.reversal.id, 'original points at the reversal');
assert(revoked.reversal.reversal_of_journal_id === revoked.original.id, 'reversal points back at the original');
assert(
  journalTotals(revoked.reversal.lines).debit_poisha === journalTotals(documentJournal.lines).credit_poisha,
  'reversal debit total equals the original credit total (debit/credit swapped)',
);
let secondReversalRejected = false;
try {
  createReversalJournal(revoked.original, 'Duplicate reversal attempt', '2026-10-31', 'selfcheck', {
    journals,
    periods: dataset.periods,
    accounts: dataset.accounts,
    actor: 'selfcheck',
  });
} catch {
  secondReversalRejected = true;
}
assert(secondReversalRejected, 'a second reversal of the same journal is rejected');
let reversalOfReversalRejected = false;
try {
  createReversalJournal(revoked.reversal, 'Reverse the reversal', '2026-10-31', 'selfcheck', {
    journals,
    periods: dataset.periods,
    accounts: dataset.accounts,
    actor: 'selfcheck',
  });
} catch {
  reversalOfReversalRejected = true;
}
assert(reversalOfReversalRejected, 'reversing a reversal is rejected');

// 5. Period lock is enforced
let lockedRejected = false;
try {
  postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: '2026-06-15',
      posting_date: '2026-06-15',
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Locked period probe',
      narration_bn: 'লকড মেয়াদ পরীক্ষা',
      created_by: 'selfcheck',
      lines: [
        { account_code: '5200', debit_poisha: 100n },
        { account_code: '1110', credit_poisha: 100n },
      ],
    },
    { journals, periods: dataset.periods, accounts: dataset.accounts },
  );
} catch {
  lockedRejected = true;
}
assert(lockedRejected, 'posting into the LOCKED June 2026 period is rejected');

let closedRejected = false;
try {
  postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: '2026-09-15',
      posting_date: '2026-09-15',
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Closed period probe',
      narration_bn: 'বন্ধ মেয়াদ পরীক্ষা',
      created_by: 'selfcheck',
      lines: [
        { account_code: '5200', debit_poisha: 100n },
        { account_code: '1110', credit_poisha: 100n },
      ],
    },
    { journals, periods: dataset.periods, accounts: dataset.accounts },
  );
} catch {
  closedRejected = true;
}
assert(closedRejected, 'posting into the CLOSED September 2026 period is rejected');

let unknownRejected = false;
try {
  postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: '2025-12-15',
      posting_date: '2025-12-15',
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Unknown period probe',
      narration_bn: 'অজানা মেয়াদ পরীক্ষা',
      created_by: 'selfcheck',
      lines: [
        { account_code: '5200', debit_poisha: 100n },
        { account_code: '1110', credit_poisha: 100n },
      ],
    },
    { journals, periods: dataset.periods, accounts: dataset.accounts },
  );
} catch {
  unknownRejected = true;
}
assert(unknownRejected, 'posting outside every configured period is rejected');

// 6. Unbalanced journals are rejected before they reach the chain
let unbalancedRejected = false;
try {
  postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: '2026-10-31',
      posting_date: '2026-10-31',
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Unbalanced probe',
      narration_bn: 'অসুষম পরীক্ষা',
      created_by: 'selfcheck',
      lines: [
        { account_code: '5200', debit_poisha: 1000n },
        { account_code: '1110', credit_poisha: 999n },
      ],
    },
    { journals, periods: dataset.periods, accounts: dataset.accounts },
  );
} catch {
  unbalancedRejected = true;
}
assert(unbalancedRejected, 'an unbalanced journal is rejected');

// 7. Unknown account codes are rejected
let unknownAccountRejected = false;
try {
  postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: '2026-10-31',
      posting_date: '2026-10-31',
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Unknown account probe',
      narration_bn: 'অজানা হিসাব পরীক্ষা',
      created_by: 'selfcheck',
      lines: [
        { account_code: '9999', debit_poisha: 100n },
        { account_code: '1110', credit_poisha: 100n },
      ],
    },
    { journals, periods: dataset.periods, accounts: dataset.accounts },
  );
} catch {
  unknownAccountRejected = true;
}
assert(unknownAccountRejected, 'posting to an account outside the chart of accounts is rejected');

// 8. Idempotency: the same key never posts twice
const first = postJournal(
  {
    book_type: 'STATUTORY_BD',
    bin_unit_id: 'BU-DHK',
    document_date: '2026-10-31',
    posting_date: '2026-10-31',
    source_module: 'MANUAL_JOURNAL',
    idempotency_key: 'IDEMPOTENT-TEST',
    narration_en: 'Idempotency probe',
    narration_bn: 'আইডেম্পোটেন্সি পরীক্ষা',
    created_by: 'selfcheck',
    lines: [
      { account_code: '5200', debit_poisha: 500n },
      { account_code: '1110', credit_poisha: 500n },
    ],
  },
  { journals, periods: dataset.periods, accounts: dataset.accounts },
);
journals.push(first);
const second = postJournal(
  {
    book_type: 'STATUTORY_BD',
    bin_unit_id: 'BU-DHK',
    document_date: '2026-10-31',
    posting_date: '2026-10-31',
    source_module: 'MANUAL_JOURNAL',
    idempotency_key: 'IDEMPOTENT-TEST',
    narration_en: 'Idempotency probe',
    narration_bn: 'আইডেম্পোটেন্সি পরীক্ষা',
    created_by: 'selfcheck',
    lines: [
      { account_code: '5200', debit_poisha: 500n },
      { account_code: '1110', credit_poisha: 500n },
    ],
  },
  { journals, periods: dataset.periods, accounts: dataset.accounts },
);
assert(second.id === first.id, 'the same idempotency key returns the original journal');
assert(verifyAuditChain(journals).valid, `final chain verifies over ${journals.length} journals`);
