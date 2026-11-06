import { describe, expect, it } from 'vitest';
import {
  allocateMushak63Serial,
  buildCommercialDoc,
  createReversalJournal,
  journalTotals,
  JournalPostingError,
  nextCommercialDocNumber,
  periodStatusFor,
  postJournal,
  settleCommercialDoc,
  SettlementError,
  type JournalPostContext,
} from '../src/core/ledger/ledgerEngine';
import {
  buildOpeningBalanceBatch,
  OpeningBalanceError,
  postOpeningBalanceBatch,
  validateOpeningBalanceBatch,
} from '../src/core/ledger/openingBalance';
import { allocateSequence, inspectSequence } from '../src/core/ledger/sequence';
import { createSeedDataset } from '../src/core/ledger/seedData';
import { buildFinancialStatements } from '../src/core/ifrs-engine/ifrsEngine';
import {
  buildCogsJournalLines,
  buildReturnCogsJournalLines,
  calculatePerpetualCogs,
  InsufficientStockError,
  issueInventoryStock,
  receiveInventoryStock,
  returnInventoryStock,
} from '../src/core/tax-engine/engine';
import type { AccountingPeriod, Account, CommercialDoc, DocLine, InventoryItem, JournalEntry } from '../src/core/types';

const dataset = createSeedDataset('APEX');
const customer = dataset.parties.find((party) => party.id === 'PTY-MEGHNA')!;
const supplier = dataset.parties.find((party) => party.id === 'PTY-PADMA')!;

const openPeriods: AccountingPeriod[] = [
  { code: '2026-10', label: 'October 2026', start_date: '2026-10-01', end_date: '2026-10-31', status: 'OPEN' },
  { code: '2026-11', label: 'November 2026', start_date: '2026-11-01', end_date: '2026-11-30', status: 'CLOSED' },
  { code: '2026-12', label: 'December 2026', start_date: '2026-12-01', end_date: '2026-12-31', status: 'LOCKED' },
];

function line(
  id: string,
  sku: string,
  quantity: number,
  unitPricePoisha: bigint,
  taxCategory: DocLine['tax_category'],
): DocLine {
  return {
    id,
    sku,
    description_en: sku,
    description_bn: sku,
    quantity,
    unit_price_poisha: unitPricePoisha,
    tax_category: taxCategory,
  };
}

function postSimpleJournal(date: string, context: JournalPostContext, amount = 100_000n): JournalEntry {
  return postJournal(
    {
      book_type: 'STATUTORY_BD',
      bin_unit_id: 'BU-DHK',
      document_date: date,
      posting_date: date,
      source_module: 'MANUAL_JOURNAL',
      narration_en: 'Domain hardening test',
      narration_bn: 'ডোমেইন হার্ডেনিং পরীক্ষা',
      created_by: 'test',
      lines: [
        { account_code: '5200', debit_poisha: amount },
        { account_code: '1110', credit_poisha: amount },
      ],
    },
    context,
  );
}

function stockItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'ITM-TEST',
    sku: 'TEST-SKU',
    name_en: 'Test stock item',
    name_bn: 'পরীক্ষা মজুদ',
    unit_en: 'pcs',
    unit_bn: 'পিস',
    unit_price_poisha: 20_000n,
    tax_category: 'STANDARD_15',
    inventory_account: '1310',
    is_stock_item: true,
    qty_on_hand: 10,
    unit_cost_poisha: 10_000n,
    ...overrides,
  };
}

describe('period semantics', () => {
  it('resolves an explicit UNKNOWN outside every configured period', () => {
    expect(periodStatusFor(openPeriods, '2026-09-30')).toBe('UNKNOWN');
    expect(periodStatusFor(openPeriods, '2027-01-01')).toBe('UNKNOWN');
    expect(periodStatusFor([], '2026-10-15')).toBe('UNKNOWN');
    expect(periodStatusFor(openPeriods, '2026-10-15')).toBe('OPEN');
    expect(periodStatusFor(openPeriods, '2026-11-15')).toBe('CLOSED');
    expect(periodStatusFor(openPeriods, '2026-12-15')).toBe('LOCKED');
  });

  it('rejects posting before the first period, after the last, and in CLOSED/LOCKED periods', () => {
    const context: JournalPostContext = {
      journals: [],
      periods: openPeriods,
      accounts: dataset.accounts,
      actor: 'test',
    };
    const cases: Array<[string, JournalPostingError['code']]> = [
      ['2026-09-30', 'PERIOD_UNKNOWN'],
      ['2027-01-01', 'PERIOD_UNKNOWN'],
      ['2026-11-15', 'PERIOD_CLOSED'],
      ['2026-12-15', 'PERIOD_LOCKED'],
    ];
    for (const [date, code] of cases) {
      try {
        postSimpleJournal(date, context);
        throw new Error(`Posting ${date} should have been rejected.`);
      } catch (error) {
        expect(error).toBeInstanceOf(JournalPostingError);
        expect((error as JournalPostingError).code).toBe(code);
      }
    }
  });

  it('accepts an OPEN period and records the exact posting date', () => {
    const journal = postSimpleJournal('2026-10-15', {
      journals: [],
      periods: openPeriods,
      accounts: dataset.accounts,
      actor: 'test',
    });
    expect(journal.posting_date).toBe('2026-10-15');
    expect(journalTotals(journal.lines).balanced).toBe(true);
  });
});

describe('reversal safety', () => {
  it('links both ways, refuses a second reversal, refuses reversing a reversal, and is idempotent', () => {
    const journals: JournalEntry[] = [];
    const context: JournalPostContext = {
      journals,
      periods: openPeriods,
      accounts: dataset.accounts,
      actor: 'test',
    };
    const original = postSimpleJournal('2026-10-15', context);
    journals.push(original);

    const first = createReversalJournal(original, 'Correction', '2026-10-16', 'test', context);
    expect(first.original.status).toBe('REVERSED');
    expect(first.original.reversed_by_journal_id).toBe(first.reversal.id);
    expect(first.reversal.reversal_of_journal_id).toBe(original.id);
    expect(first.reversal.journal_number).not.toBe(original.journal_number);

    const withReversal = [...journals, first.reversal];
    const retry = createReversalJournal(original, 'Correction', '2026-10-16', 'test', {
      ...context,
      journals: withReversal,
    });
    expect(retry.reversal.id).toBe(first.reversal.id);

    try {
      createReversalJournal(first.original, 'Second attempt', '2026-10-17', 'test', {
        ...context,
        journals: withReversal,
      });
      throw new Error('A second reversal should have been rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(JournalPostingError);
      expect((error as JournalPostingError).code).toBe('REVERSAL_ALREADY_REVERSED');
    }

    try {
      createReversalJournal(first.reversal, 'Reverse a reversal', '2026-10-17', 'test', {
        ...context,
        journals: withReversal,
      });
      throw new Error('Reversing a reversal should have been rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(JournalPostingError);
      expect((error as JournalPostingError).code).toBe('REVERSAL_OF_REVERSAL');
    }
  });
});

describe('credit-note identity and numbering', () => {
  it('uses its own CN series, never consumes a Mushak 6.3 serial, and keeps the original link', () => {
    const invoice = buildCommercialDoc({
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-10-0901',
      doc_date: '2026-10-10',
      due_date: '2026-10-25',
      party: customer,
      bin_unit_id: 'BU-DHK',
      lines: [line('L1', 'SVC-TEST', 1, 1_000_000n, 'STANDARD_15')],
      base_poisha: 1_000_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Test invoice',
      narration_bn: 'পরীক্ষা চালান',
      mushak_serial: 'M63-2026-00091',
      book_type: 'STATUTORY_BD',
    }).doc;

    const creditNote = buildCommercialDoc({
      doc_type: 'CREDIT_NOTE',
      doc_number: 'CN-2026-10-0007',
      doc_date: '2026-10-20',
      due_date: '2026-10-20',
      party: customer,
      bin_unit_id: 'BU-DHK',
      lines: [line('L1', 'SVC-TEST', 1, 500_000n, 'STANDARD_15')],
      base_poisha: 500_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Test credit note',
      narration_bn: 'পরীক্ষা ক্রেডিট নোট',
      original_doc_id: invoice.id,
      original_doc_number: invoice.doc_number,
      book_type: 'STATUTORY_BD',
    }).doc;

    expect(creditNote.doc_type).toBe('CREDIT_NOTE');
    expect(creditNote.doc_number.startsWith('CN-')).toBe(true);
    expect(creditNote.mushak_serial).toBeUndefined();
    expect(creditNote.mushak63_ref).toBeUndefined();
    expect(creditNote.original_doc_id).toBe(invoice.id);
    expect(creditNote.original_doc_number).toBe('INV-2026-10-0901');
    expect(creditNote.vat_poisha).toBe(75_000n);

    const docs: CommercialDoc[] = [invoice, creditNote];
    expect(allocateMushak63Serial('BU-DHK', docs, '2026')).toBe('M63-2026-00092');
    expect(nextCommercialDocNumber(docs, 'CREDIT_NOTE', '2026-10-20', 'BU-DHK')).toBe('CN-2026-10-0008');

    // A reversed document keeps its number and serial, so neither may be reused.
    const reversedInvoice: CommercialDoc = { ...invoice, status: 'REVERSED' };
    expect(allocateMushak63Serial('BU-DHK', [reversedInvoice], '2026')).toBe('M63-2026-00092');
    expect(nextCommercialDocNumber([reversedInvoice], 'SALES_INVOICE', '2026-10-20', 'BU-DHK')).toBe(
      'INV-2026-10-0902',
    );
  });

  it('allocates from the highest used number and reports gaps instead of reusing a length', () => {
    const used = ['INV-2026-10-0001', 'INV-2026-10-0005'];
    const next = allocateSequence({
      series: 'SALES_INVOICE',
      scope: 'BU-DHK',
      period: '2026-10',
      prefix: 'INV',
      used_numbers: used,
    });
    expect(next.number).toBe('INV-2026-10-0006');

    const audit = inspectSequence({
      series: 'SALES_INVOICE',
      scope: 'BU-DHK',
      period: '2026-10',
      prefix: 'INV',
      used_numbers: used,
    });
    expect(audit.gap_free).toBe(false);
    expect(audit.missing_values).toEqual([2, 3, 4]);

    const numbered = ['INV-2026-10-0001', 'INV-2026-10-0005', 'INV-2026-10-0005'];
    expect(
      inspectSequence({
        series: 'SALES_INVOICE',
        scope: 'BU-DHK',
        period: '2026-10',
        prefix: 'INV',
        used_numbers: numbered,
      }).duplicate_values,
    ).toEqual([5]);
  });

  it('rejects duplicate journal numbers and duplicate journal ids', () => {
    const first = postJournal(
      {
        id: 'JRN-DUP',
        journal_number: 'JE-2026-10-9001',
        book_type: 'STATUTORY_BD',
        bin_unit_id: 'BU-DHK',
        document_date: '2026-10-15',
        posting_date: '2026-10-15',
        source_module: 'MANUAL_JOURNAL',
        narration_en: 'First',
        narration_bn: 'প্রথম',
        created_by: 'test',
        lines: [
          { account_code: '5200', debit_poisha: 100n },
          { account_code: '1110', credit_poisha: 100n },
        ],
      },
      { journals: [], periods: openPeriods, accounts: dataset.accounts },
    );

    expect(() =>
      postJournal(
        {
          id: 'JRN-OTHER',
          journal_number: 'JE-2026-10-9001',
          book_type: 'STATUTORY_BD',
          bin_unit_id: 'BU-DHK',
          document_date: '2026-10-15',
          posting_date: '2026-10-15',
          source_module: 'MANUAL_JOURNAL',
          narration_en: 'Duplicate number',
          narration_bn: 'নকল নম্বর',
          created_by: 'test',
          lines: [
            { account_code: '5200', debit_poisha: 100n },
            { account_code: '1110', credit_poisha: 100n },
          ],
        },
        { journals: [first], periods: openPeriods, accounts: dataset.accounts },
      ),
    ).toThrowError(JournalPostingError);

    expect(() =>
      postJournal(
        {
          id: 'JRN-DUP',
          journal_number: 'JE-2026-10-9002',
          book_type: 'STATUTORY_BD',
          bin_unit_id: 'BU-DHK',
          document_date: '2026-10-15',
          posting_date: '2026-10-15',
          source_module: 'MANUAL_JOURNAL',
          narration_en: 'Duplicate id',
          narration_bn: 'নকল আইডি',
          created_by: 'test',
          lines: [
            { account_code: '5200', debit_poisha: 100n },
            { account_code: '1110', credit_poisha: 100n },
          ],
        },
        { journals: [first], periods: openPeriods, accounts: dataset.accounts },
      ),
    ).toThrowError(JournalPostingError);
  });
});

describe('line-level tax', () => {
  it('taxes a mixed-rate sale per line instead of applying one header rate to the total', () => {
    const built = buildCommercialDoc({
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-10-0902',
      doc_date: '2026-10-12',
      due_date: '2026-10-27',
      party: customer,
      bin_unit_id: 'BU-DHK',
      lines: [
        line('L1', 'LOCAL-GOODS', 1, 1_000_000n, 'STANDARD_15'),
        line('L2', 'EXPORT-SERVICE', 1, 2_000_000n, 'EXPORT_ZERO'),
      ],
      base_poisha: 3_000_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Mixed-rate sale',
      narration_bn: 'মিশ্র হার বিক্রয়',
      mushak_serial: 'M63-2026-00092',
      book_type: 'STATUTORY_BD',
    });

    expect(built.doc.line_tax).toHaveLength(2);
    expect(built.doc.line_tax?.map((entry) => entry.tax_category)).toEqual(['STANDARD_15', 'EXPORT_ZERO']);
    expect(built.doc.line_tax?.[0].vat_poisha).toBe(150_000n);
    expect(built.doc.line_tax?.[1].vat_poisha).toBe(0n);
    expect(built.doc.vat_poisha).toBe(150_000n);
    expect(built.doc.gross_poisha).toBe(3_150_000n);
    expect(built.doc.tax_categories).toEqual(['STANDARD_15', 'EXPORT_ZERO']);
    expect(journalTotals(built.document_lines).balanced).toBe(true);
    expect(journalTotals(built.settlement_lines).balanced).toBe(true);
  });

  it('rejects a caller-supplied document base that disagrees with its lines', () => {
    expect(() =>
      buildCommercialDoc({
        doc_type: 'SALES_INVOICE',
        doc_number: 'INV-2026-10-0999',
        doc_date: '2026-10-12',
        due_date: '2026-10-27',
        party: customer,
        bin_unit_id: 'BU-DHK',
        lines: [line('L1', 'LOCAL-GOODS', 1, 1_000_000n, 'STANDARD_15')],
        base_poisha: 900_000n,
        tax_category: 'STANDARD_15',
        tds_nature: 'NONE',
        payment_method: 'BANK',
        narration_en: 'Mismatched base',
        narration_bn: 'অমিল ভিত্তি',
        book_type: 'STATUTORY_BD',
      }),
    ).toThrow(/does not match its line total/);
  });

  it('computes input-VAT eligibility per purchase line', () => {
    const built = buildCommercialDoc({
      doc_type: 'PURCHASE_BILL',
      doc_number: 'PB-2026-10-0903',
      doc_date: '2026-10-12',
      due_date: '2026-10-27',
      party: supplier,
      bin_unit_id: 'BU-DHK',
      lines: [
        line('L1', 'STANDARD-GOODS', 1, 1_000_000n, 'STANDARD_15'),
        line('L2', 'TRADING-GOODS', 1, 1_000_000n, 'TRADING_5'),
      ],
      base_poisha: 2_000_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Mixed-rate purchase',
      narration_bn: 'মিশ্র হার ক্রয়',
      mushak_serial: 'M63-SUP-2026-0903',
      book_type: 'STATUTORY_BD',
      tenant_is_withholding_entity: true,
    });

    expect(built.doc.vat_poisha).toBe(200_000n);
    expect(built.doc.tax_claimable_poisha).toBe(150_000n);
    expect(built.doc.tax_disallowed_poisha).toBe(50_000n);
    expect(built.doc.line_tax?.[0].claimable_poisha).toBe(150_000n);
    expect(built.doc.line_tax?.[1].claimable_poisha).toBe(0n);
    expect(built.doc.line_tax?.[1].disallowed_poisha).toBe(50_000n);
    expect(journalTotals(built.document_lines).balanced).toBe(true);
  });
});

describe('explicit settlement', () => {
  it('leaves a posted invoice open, then settles it through a separate receipt command', () => {
    const built = buildCommercialDoc({
      doc_type: 'SALES_INVOICE',
      doc_number: 'INV-2026-10-0904',
      doc_date: '2026-10-14',
      due_date: '2026-10-29',
      party: customer,
      bin_unit_id: 'BU-DHK',
      lines: [line('L1', 'SALE-GOODS', 1, 1_000_000n, 'STANDARD_15')],
      base_poisha: 1_000_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Open invoice',
      narration_bn: 'খোলা চালান',
      mushak_serial: 'M63-2026-00094',
      book_type: 'STATUTORY_BD',
    });

    expect(built.doc.status).toBe('POSTED');
    expect(built.doc.settled_poisha).toBe(0n);

    const journals: JournalEntry[] = [];
    const context: JournalPostContext = {
      journals,
      periods: openPeriods,
      accounts: dataset.accounts,
      actor: 'test',
    };
    const documentJournal = postJournal(
      {
        book_type: 'STATUTORY_BD',
        bin_unit_id: 'BU-DHK',
        document_date: built.doc.doc_date,
        posting_date: built.doc.doc_date,
        source_module: 'SALES',
        source_doc_id: built.doc.id,
        source_doc_ref: built.doc.doc_number,
        narration_en: built.doc.narration_en,
        narration_bn: built.doc.narration_bn,
        created_by: 'test',
        lines: built.document_lines,
      },
      context,
    );
    journals.push(documentJournal);
    const posted: typeof built.doc = {
      ...built.doc,
      document_journal_id: documentJournal.id,
    };
    expect(posted.status).toBe('POSTED');
    expect(posted.settled_poisha).toBe(0n);

    const settled = settleCommercialDoc(
      posted,
      {
        settlement_date: '2026-10-20',
        bank_account_code: '1110',
        actor: 'test',
      },
      { ...context, journals },
    );
    expect(settled.doc.status).toBe('SETTLED');
    expect(settled.doc.settled_poisha).toBe(settled.doc.gross_poisha);
    expect(settled.doc.settlement_journal_id).toBe(settled.journal.id);
    expect(journalTotals(settled.journal.lines).balanced).toBe(true);
    expect(posted.settled_poisha).toBe(0n);

    expect(() =>
      settleCommercialDoc(
        settled.doc,
        { settlement_date: '2026-10-21', bank_account_code: '1110', actor: 'test' },
        { ...context, journals: [...journals, settled.journal] },
      ),
    ).toThrowError(SettlementError);
  });

  it('refuses a credit note as a settleable receivable', () => {
    const creditNote = buildCommercialDoc({
      doc_type: 'CREDIT_NOTE',
      doc_number: 'CN-2026-10-0009',
      doc_date: '2026-10-20',
      due_date: '2026-10-20',
      party: customer,
      bin_unit_id: 'BU-DHK',
      lines: [line('L1', 'SALE-GOODS', 1, 100_000n, 'STANDARD_15')],
      base_poisha: 100_000n,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
      narration_en: 'Credit note',
      narration_bn: 'ক্রেডিট নোট',
      original_doc_id: 'DOC-INV-2026-10-0904',
      original_doc_number: 'INV-2026-10-0904',
      book_type: 'STATUTORY_BD',
    }).doc;

    expect(() =>
      settleCommercialDoc(
        creditNote,
        { settlement_date: '2026-10-21', bank_account_code: '1110', actor: 'test' },
        { journals: [], periods: openPeriods, accounts: dataset.accounts },
      ),
    ).toThrowError(SettlementError);
  });
});

describe('opening balances', () => {
  it('builds and posts one balanced batch with computed totals', () => {
    const batch = buildOpeningBalanceBatch(
      {
        id: 'OB-TEST-001',
        batch_date: '2026-10-01',
        bin_unit_id: 'BU-DHK',
        created_by: 'test',
        lines: [
          { account_code: '1110', debit_poisha: 1_000_000n, credit_poisha: 0n },
          { account_code: '3100', debit_poisha: 0n, credit_poisha: 1_000_000n },
        ],
      },
      dataset.accounts,
    );
    expect(batch.balanced).toBe(true);
    expect(batch.total_debit_poisha).toBe(1_000_000n);
    expect(batch.total_credit_poisha).toBe(1_000_000n);
    expect(batch.status).toBe('DRAFT');

    const posted = postOpeningBalanceBatch(batch, {
      journals: [],
      periods: openPeriods,
      accounts: dataset.accounts,
      actor: 'test',
    });
    expect(posted.batch.status).toBe('POSTED');
    expect(posted.journal.source_module).toBe('OPENING_BALANCE');
    expect(posted.journal.id).toBe(posted.batch.journal_id);
    expect(journalTotals(posted.journal.lines).balanced).toBe(true);
  });

  it('rejects an unbalanced batch rather than silently posting it', () => {
    const lines = [
      { account_code: '1110', debit_poisha: 100_000n, credit_poisha: 0n },
      { account_code: '3100', debit_poisha: 0n, credit_poisha: 90_000n },
    ];
    expect(validateOpeningBalanceBatch(lines, dataset.accounts).valid).toBe(false);
    expect(() =>
      buildOpeningBalanceBatch(
        { id: 'OB-BAD', batch_date: '2026-10-01', bin_unit_id: 'BU-DHK', created_by: 'test', lines },
        dataset.accounts,
      ),
    ).toThrowError(OpeningBalanceError);
  });

  it('ignores mutable account-master opening fields in the financial statements', () => {
    const accounts: Account[] = [
      ...dataset.accounts,
      {
        ...dataset.accounts[0],
        code: '1999',
        name_en: 'Master-field-only opening account',
        name_bn: 'শুধু মাস্টার ফিল্ড উদ্বোধনী হিসাব',
        opening_debit_poisha: 9_999_999n,
        opening_credit_poisha: 0n,
      },
    ];
    const statements = buildFinancialStatements({
      tenant: dataset.tenant,
      accounts,
      journals: [],
      bookFilter: 'STATUTORY_BD',
      periodCode: '2026-10',
      comparativeCode: '2026-09',
    });
    const row = statements.trial_balance.find((entry) => entry.account_code === '1999');
    expect(row?.opening_debit_poisha ?? 0n).toBe(0n);
    expect(row?.closing_debit_poisha ?? 0n).toBe(0n);
  });
});

describe('explicit stock movements', () => {
  it('records receipt, issue and return movements with the correct COGS pair', () => {
    const start = [stockItem()];
    const received = receiveInventoryStock(start, [{ sku: 'TEST-SKU', quantity: 5, unit_cost_poisha: 20_000n }], {
      source_doc_ref: 'GRN-TEST-1',
      movement_date: '2026-10-01',
    });
    expect(received.items[0].qty_on_hand).toBe(15);
    expect(received.movements).toHaveLength(1);
    expect(received.movements[0].movement_type).toBe('RECEIPT');
    expect(received.movements[0].value_poisha).toBe(100_000n);

    const cogs = calculatePerpetualCogs([{ sku: 'TEST-SKU', quantity: 4 }], received.items);
    expect(cogs).toBe(53_332n);
    const issued = issueInventoryStock(received.items, [{ sku: 'TEST-SKU', quantity: 4 }], {
      source_doc_ref: 'INV-TEST-1',
      movement_date: '2026-10-02',
    });
    expect(issued.items[0].qty_on_hand).toBe(11);
    expect(issued.movements[0].movement_type).toBe('ISSUE');
    expect(issued.movements[0].quantity).toBe(4);

    const issuePair = buildCogsJournalLines(cogs, dataset.accounts, 'INV-TEST-1');
    expect(issuePair[0]).toMatchObject({ account_code: '5100', debit_poisha: cogs, credit_poisha: 0n });
    expect(issuePair[1]).toMatchObject({ account_code: '1310', debit_poisha: 0n, credit_poisha: cogs });

    const returned = returnInventoryStock(issued.items, [{ sku: 'TEST-SKU', quantity: 2 }], {
      source_doc_ref: 'CN-TEST-1',
      movement_date: '2026-10-03',
    });
    expect(returned.items[0].qty_on_hand).toBe(13);
    expect(returned.movements[0].movement_type).toBe('RETURN_IN');
    expect(returned.cogs_reversed_poisha).toBe(2n * returned.movements[0].unit_cost_poisha);

    const returnPair = buildReturnCogsJournalLines(returned.cogs_reversed_poisha, dataset.accounts, 'CN-TEST-1');
    expect(returnPair[0]).toMatchObject({ account_code: '1310', debit_poisha: returned.cogs_reversed_poisha });
    expect(returnPair[1]).toMatchObject({ account_code: '5100', credit_poisha: returned.cogs_reversed_poisha });
    expect(journalTotals([...returnPair])).toMatchObject({
      debit_poisha: returned.cogs_reversed_poisha,
      credit_poisha: returned.cogs_reversed_poisha,
      balanced: true,
    });
  });

  it('rejects negative stock by default and only allows it with an explicit override', () => {
    const items = [stockItem({ qty_on_hand: 3 })];
    expect(() =>
      issueInventoryStock(items, [{ sku: 'TEST-SKU', quantity: 10 }], { source_doc_ref: 'INV-SHORT' }),
    ).toThrowError(InsufficientStockError);

    const overridden = issueInventoryStock(items, [{ sku: 'TEST-SKU', quantity: 10 }], {
      source_doc_ref: 'INV-OVERRIDE',
      allow_negative_stock: true,
    });
    expect(overridden.items[0].qty_on_hand).toBe(-7);
    expect(overridden.negative_stock_override).toBe(true);
  });
});

describe('cash-flow reconciliation', () => {
  it('does not insert a plug when the indirect statement cannot reconcile', () => {
    const journal = postJournal(
      {
        book_type: 'STATUTORY_BD',
        bin_unit_id: 'BU-DHK',
        document_date: '2026-10-15',
        posting_date: '2026-10-15',
        source_module: 'MANUAL_JOURNAL',
        narration_en: 'Non-cash asset movement that the working-capital map does not classify',
        narration_bn: 'অ-নগদ সম্পদ পরিবর্তন',
        created_by: 'test',
        lines: [
          { account_code: '1219', debit_poisha: 100_000n },
          { account_code: '1110', credit_poisha: 100_000n },
        ],
      },
      { journals: [], periods: openPeriods, accounts: dataset.accounts },
    );
    const statements = buildFinancialStatements({
      tenant: dataset.tenant,
      accounts: dataset.accounts,
      journals: [journal],
      bookFilter: 'STATUTORY_BD',
      periodCode: '2026-10',
      comparativeCode: '2026-09',
    });

    expect(statements.cash_flow.reconciles).toBe(false);
    expect(statements.cash_flow.difference_poisha).not.toBe(0n);
    expect(statements.cash_flow.operating.lines.some((entry) => entry.id === 'CF.OP.PLUG')).toBe(false);
    expect(
      statements.cash_flow.operating.lines.some((entry) =>
        entry.label_en.toLowerCase().includes('other working capital'),
      ),
    ).toBe(false);
  });
});
