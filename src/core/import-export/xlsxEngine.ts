// Fintuity Accounting Suite — Phase 2 mass `.xlsx` / `.csv` import studio + 9-tab audit pack.
//
// Four pipelines (bulk journal, sales & purchase, opening balance, bank/MFS) share one simulated
// dry-run contract: nothing is written to the ledger until the user commits, every commercial row is
// pushed through the deterministic tax engine, and a committed batch can be rolled back with linked
// reversal journals instead of deleting history.
//
// Zero-dependency SpreadsheetML & CSV engine replacing SheetJS (xlsx).
import { bdtToPoisha, formatPoisha, poishaToBdtNumber, safeParseBigInt } from '../money';
import type {
  Account,
  AccountingPeriod,
  BankAccount,
  BookType,
  Challan,
  CommercialDoc,
  CommercialDocType,
  FinancialStatements,
  ImportBatch,
  ImportPipeline,
  ImportRow,
  ImportRowStatus,
  ImportSimulation,
  JournalEntry,
  JournalLine,
  Party,
  PaymentMethod,
  SourceModule,
  TaxCategory,
  TdsNature,
  TenantEntity,
} from '../types';
import {
  allocateMushak63Serial,
  buildCommercialDoc,
  journalTotals,
  periodStatusFor,
  type AuditChainResult,
  type JournalDraft,
  type JournalLineDraft,
  type SubledgerReconciliation,
  type TaxAnnotatedDoc,
} from '../ledger/ledgerEngine';

export type ImportSheetRow = Record<string, string | number>;

export interface ImportState {
  tenant: TenantEntity;
  accounts: readonly Account[];
  journals: readonly JournalEntry[];
  commercialDocs: readonly CommercialDoc[];
  periods: readonly AccountingPeriod[];
  parties?: readonly Party[];
  bankAccounts?: readonly BankAccount[];
}

// ---------------------------------------------------------------------------------------------
// Pipeline metadata
// ---------------------------------------------------------------------------------------------

export const PIPELINE_LABEL: Record<ImportPipeline, { en: string; bn: string; description_en: string; description_bn: string }> = {
  BULK_JOURNAL: {
    en: 'Bulk Journals',
    bn: 'বাল্ক জার্নাল',
    description_en: 'One row per journal line, grouped by journal number. Every group must balance to the poisha.',
    description_bn: 'প্রতি সারিতে একটি জার্নাল লাইন, জার্নাল নম্বর অনুযায়ী দলবদ্ধ। প্রতিটি দল পয়সা পর্যন্ত সুষম হতে হবে।',
  },
  SALES_PURCHASE: {
    en: 'Mass Sales/Purchase Vouchers',
    bn: 'বাল্ক বিক্রয়/ক্রয় ভাউচার',
    description_en: 'Commercial documents that carry BIN/e-TIN evidence; the tax engine computes VAT, VDS and TDS.',
    description_bn: 'বিআইএন/ই-টিআইএন প্রমাণসহ বাণিজ্যিক নথি; কর ইঞ্জিন ভ্যাট, ভিডিএস ও টিডিএস গণনা করে।',
  },
  OPENING_BALANCE: {
    en: 'Tally/QB Opening Balance Migration',
    bn: 'ট্যালি/কিউবি উদ্বোধনী ব্যালেন্স মাইগ্রেশন',
    description_en: 'One row per account. The batch is rejected unless total debits equal total credits.',
    description_bn: 'প্রতি হিসাবে একটি সারি। মোট ডেবিট ও ক্রেডিট সমান না হলে ব্যাচ বাতিল হয়।',
  },
  BANK_MFS: {
    en: 'Bank/bKash Statement Upload',
    bn: 'ব্যাংক/বিকাশ বিবরণী আপলোড',
    description_en: 'Statement lines with receipt, payment and fee columns; auto-matched against the ledger.',
    description_bn: 'প্রাপ্তি, পরিশোধ ও ফি কলামসহ বিবরণী লাইন; খাতার সাথে স্বয়ংক্রিয় মিলকরণ।',
  },
};

export const PIPELINE_COLUMNS: Record<ImportPipeline, string[]> = {
  BULK_JOURNAL: ['journal_no', 'date', 'account_code', 'debit', 'credit', 'narration', 'party', 'book_type'],
  SALES_PURCHASE: ['doc_type', 'doc_no', 'date', 'party_name', 'party_bin', 'party_tin', 'base_amount', 'tax_category', 'tds_nature', 'payment_method'],
  OPENING_BALANCE: ['account_code', 'date', 'debit', 'credit', 'narration'],
  BANK_MFS: ['bank_account', 'date', 'description', 'reference', 'receipt', 'payment', 'fee'],
};

const TAX_CATEGORIES: TaxCategory[] = [
  'STANDARD_15',
  'TRADING_5',
  'PROCUREMENT_7_5',
  'EXPORT_ZERO',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
];
const TDS_NATURES: TdsNature[] = [
  'NONE',
  'SUPPLY_OF_GOODS',
  'PROFESSIONAL_OR_TECHNICAL_SERVICES',
  'COMMERCIAL_RENT',
  'ADVERTISING_OR_MEDIA',
  'TRANSPORT_OR_LOGISTICS',
  'CONTRACTOR_OR_SUBCONTRACTOR',
];
const PAYMENT_METHODS: PaymentMethod[] = ['BANK', 'MFS', 'CASH', 'CHEQUE', 'CREDIT_CARD'];


function asString(row: ImportSheetRow, key: string): string {
  const value = row[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asPoisha(row: ImportSheetRow, key: string): bigint {
  const value = row[key];
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'number') return bdtToPoisha(value);
  return safeParseBigInt(value);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function digits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function isValidBinFormat(value: string): boolean {
  const raw = digits(value);
  return raw.length === 13 && !/^0+$/.test(raw) && !/^(\d)\1{12}$/.test(raw);
}

function isValidTinFormat(value: string): boolean {
  const raw = digits(value);
  return raw.length === 12 && !/^0+$/.test(raw) && !/^(\d)\1{11}$/.test(raw);
}

// ---------------------------------------------------------------------------------------------
// Demo batch generator — 25 rows per pipeline, no file needed on disk
// ---------------------------------------------------------------------------------------------

const DEMO_CUSTOMERS = [
  ['Meghna Distribution Ltd.', '004271836-0203', '138547291063'],
  ['Beximco Trading Corporation', '002734198-0301', '217394856021'],
  ['Dhaka Fashion Retail', '007412365-0101', '189273645012'],
  ['Karnaphuli Retail Chain', '006341289-0102', '161039284711'],
  ['Padma Home Appliances', '005618243-0103', '149035728162'],
];

const DEMO_SUPPLIERS = [
  ['Padma Industrial Supplies', '005618243-0101', '149035728164'],
  ['Rupsha Logistics & Courier', '004782316-0103', '165039284716'],
  ['Karnaphuli Traders', '006341289-0102', ''],
  ['Sylhet Agro Traders', '', '178392045612'],
];

/**
 * 25 realistic rows, ready for a 1-click dry run. Two rows are deliberate hard failures (a locked
 * prior period and a document that already exists in the ledger); three carry the warnings a real
 * Bangladeshi ledger produces every week (missing e-TIN, cash above BDT 1,00,000, in-batch duplicate).
 */
export function generateDemoImportBatch(pipelineType: ImportPipeline): ImportSheetRow[] {
  const rows: ImportSheetRow[] = [];
  if (pipelineType === 'SALES_PURCHASE') {
    for (let index = 0; index < 15; index += 1) {
      const customer = DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length];
      const month = index < 8 ? '10' : '11';
      const day = String(((index * 3) % 27) + 1).padStart(2, '0');
      rows.push({
        doc_type: 'SALES_INVOICE',
        doc_no: `IMP-INV-2026-${month}-${String(index + 1).padStart(4, '0')}`,
        date: `2026-${month}-${day}`,
        party_name: customer[0],
        party_bin: customer[1],
        party_tin: customer[2],
        base_amount: 128000 + index * 41500,
        tax_category: 'STANDARD_15',
        tds_nature: 'NONE',
        payment_method: 'BANK',
      });
    }
    for (let index = 0; index < 7; index += 1) {
      const supplier = DEMO_SUPPLIERS[index % DEMO_SUPPLIERS.length];
      rows.push({
        doc_type: 'PURCHASE_BILL',
        // Row 7 re-uses the first purchase number: a classic copy/paste duplicate, warned not blocked.
        doc_no: index === 6 ? 'IMP-PB-2026-10-0001' : `IMP-PB-2026-10-${String(index + 1).padStart(4, '0')}`,
        date: `2026-10-${String(((index * 4) % 27) + 1).padStart(2, '0')}`,
        party_name: supplier[0],
        party_bin: supplier[1],
        party_tin: supplier[2],
        base_amount: 96000 + index * 38000,
        tax_category: 'STANDARD_15',
        tds_nature: index % 2 === 0 ? 'SUPPLY_OF_GOODS' : 'PROFESSIONAL_OR_TECHNICAL_SERVICES',
        payment_method: index === 5 ? 'CASH' : 'BANK',
      });
    }
    rows.push({
      doc_type: 'EXPENSE_VOUCHER',
      doc_no: 'IMP-PV-2026-10-0091',
      date: '2026-10-22',
      party_name: 'Motijheel Properties Ltd.',
      party_bin: '002248173-0101',
      party_tin: '130958472638',
      base_amount: 320000,
      tax_category: 'STANDARD_15',
      tds_nature: 'COMMERCIAL_RENT',
      payment_method: 'BANK',
    });
    rows.push({
      doc_type: 'PURCHASE_BILL',
      doc_no: 'INV-2026-10-0001', // duplicate of an existing posted invoice
      date: '2026-10-24',
      party_name: 'Meghna Distribution Ltd.',
      party_bin: '004271836-0203',
      party_tin: '138547291063',
      base_amount: 215000,
      tax_category: 'STANDARD_15',
      tds_nature: 'NONE',
      payment_method: 'BANK',
    });
    rows.push({
      doc_type: 'PURCHASE_BILL',
      doc_no: 'IMP-PB-2026-06-9999',
      date: '2026-06-18', // locked prior period
      party_name: 'Padma Industrial Supplies',
      party_bin: '005618243-0101',
      party_tin: '149035728164',
      base_amount: 175000,
      tax_category: 'STANDARD_15',
      tds_nature: 'SUPPLY_OF_GOODS',
      payment_method: 'BANK',
    });
    return rows;
  }

  if (pipelineType === 'BULK_JOURNAL') {
    const journals: Array<{ no: string; date: string; lines: Array<[string, number, number, string]> }> = [
      { no: 'IMP-JE-2026-10-9001', date: '2026-10-05', lines: [['1120', 185000, 0, 'bKash merchant collection not yet matched'], ['2190', 0, 185000, 'Unapplied collection — suspense']] },
      { no: 'IMP-JE-2026-10-9002', date: '2026-10-06', lines: [['5820', 1250, 0, 'Bank SMS charge'], ['1110', 0, 1250, 'Charged to City Bank']] },
      { no: 'IMP-JE-2026-10-9003', date: '2026-10-08', lines: [['5330', 46000, 0, 'Freight to Chattogram'], ['2190', 0, 1380, 'TDS withheld, bill not captured yet'], ['1110', 0, 44620, 'Net freight paid']] },
      { no: 'IMP-JE-2026-10-9004', date: '2026-10-11', lines: [['1310', 736000, 0, 'Inventory received, invoice under verification'], ['2190', 0, 736000, 'Supplier bill pending document capture']] },
      { no: 'IMP-JE-2026-10-9005', date: '2026-10-13', lines: [['5200', 42000, 0, 'Contract staff wages'], ['1110', 0, 42000, 'Paid by BEFTN']] },
      { no: 'IMP-JE-2026-10-9006', date: '2026-10-17', lines: [['1130', 25000, 0, 'Petty cash top-up'], ['5820', 500, 0, 'Cash withdrawal charge'], ['1110', 0, 25500, 'Withdrawn from bank']] },
      { no: 'IMP-JE-2026-10-9007', date: '2026-10-21', lines: [['1410', 500000, 0, 'FDR ladder add-on'], ['1110', 0, 500000, 'Funds transferred']] },
      { no: 'IMP-JE-2026-10-9008', date: '2026-10-29', lines: [['5820', 9800, 0, 'Nagad settlement fee'], ['1125', 0, 9800, 'Wallet fee']] },
      { no: 'IMP-JE-2026-10-9011', date: '2026-10-23', lines: [['1130', 18000, 0, 'Courier charges paid from imprest'], ['1110', 0, 18000, 'Imprest reimbursed']] },
      { no: 'IMP-JE-2026-10-9012', date: '2026-10-25', lines: [['1125', 96000, 0, 'Nagad merchant settlement'], ['2190', 0, 96000, 'Unapplied settlement — suspense']] },
    ];
    for (const journal of journals) {
      for (const [code, debit, credit, narration] of journal.lines) {
        rows.push({
          journal_no: journal.no,
          date: journal.date,
          account_code: code,
          debit,
          credit,
          narration,
          party: '',
          book_type: 'STATUTORY_BD',
        });
      }
    }
    // Two rows that deliberately mirror a user copy/paste mistake.
    rows.push({ journal_no: 'IMP-JE-2026-10-9009', date: '2026-10-30', account_code: '5310', debit: 150000, credit: 0, narration: 'Advisory fee — credit leg missing', party: '', book_type: 'STATUTORY_BD' });
    rows.push({ journal_no: 'IMP-JE-2026-10-9010', date: '2026-06-20', account_code: '5200', debit: 90000, credit: 0, narration: 'Locked-period payroll', party: '', book_type: 'STATUTORY_BD' });
    rows.push({ journal_no: 'IMP-JE-2026-10-9010', date: '2026-06-20', account_code: '2160', debit: 0, credit: 90000, narration: 'Locked-period payroll', party: '', book_type: 'STATUTORY_BD' });
    return rows.slice(0, 25);
  }

  if (pipelineType === 'OPENING_BALANCE') {
    const spec: Array<[string, number, number, string]> = [
      ['1110', 4200000, 0, 'City Bank opening'],
      ['1115', 1850000, 0, 'BRAC Bank opening'],
      ['1120', 380000, 0, 'bKash opening'],
      ['1125', 145000, 0, 'Nagad opening'],
      ['1130', 250000, 0, 'Petty cash opening'],
      ['1140', 186000, 0, 'VAT current account opening'],
      ['1210', 3250000, 0, 'Trade receivables opening'],
      ['1310', 5400000, 0, 'Inventory opening'],
      ['1410', 1000000, 0, 'FDR opening'],
      ['1610', 8400000, 0, 'PPE at cost'],
      ['1619', 0, 2600000, 'Accumulated depreciation'],
      ['1710', 3200000, 0, 'ROU assets opening'],
      ['1719', 0, 640000, 'Accumulated ROU depreciation'],
      ['2110', 0, 2450000, 'Trade payables opening'],
      ['2120', 0, 168000, 'Output VAT opening'],
      ['2130', 0, 92000, 'VDS payable opening'],
      ['2140', 0, 66500, 'TDS payable opening'],
      ['2160', 0, 310000, 'Accrued salaries'],
      ['2180', 0, 480000, 'Tax provision opening'],
      ['2210', 0, 3200000, 'Working capital loan'],
      ['2510', 0, 2560000, 'Lease liability'],
      ['2610', 0, 1240000, 'Gratuity obligation'],
      ['3100', 0, 8000000, 'Share capital'],
      ['3200', 0, 6454500, 'Retained earnings (balancing)'],
      ['3200', 0, 0, 'Control row — zero value'],
    ];
    return spec.slice(0, 25).map(([code, debit, credit, narration]) => ({
      account_code: code,
      date: '2026-07-01',
      debit,
      credit,
      narration,
    }));
  }

  const bankRows: ImportSheetRow[] = [];
  for (let index = 0; index < 22; index += 1) {
    const isReceipt = index % 3 !== 2;
    bankRows.push({
      bank_account: index % 5 === 3 ? '1120' : '1110',
      date: `2026-10-${String(((index * 2) % 27) + 1).padStart(2, '0')}`,
      description: isReceipt ? `Customer settlement ${index + 1}` : `Supplier payment ${index + 1}`,
      reference: `BK-2026-10-${String(index + 1).padStart(4, '0')}`,
      receipt: isReceipt ? 142000 + index * 9500 : 0,
      payment: isReceipt ? 0 : 168000 + index * 7200,
      fee: isReceipt ? 0 : 1250,
    });
  }
  bankRows.push({
    bank_account: '1110',
    date: '2026-10-31',
    description: 'Unidentified deposit pending advice',
    reference: 'BK-UNKNOWN-3110',
    receipt: 285000,
    payment: 0,
    fee: 0,
  });
  bankRows.push({
    bank_account: '9999',
    date: '2026-10-31',
    description: 'Unknown account code — should fail',
    reference: 'BK-BAD-ACCOUNT',
    receipt: 50000,
    payment: 0,
    fee: 0,
  });
  bankRows.push({
    bank_account: '1120',
    date: '2026-11-02',
    description: 'bKash batch settlement',
    reference: 'BK-2026-11-0001',
    receipt: 96500,
    payment: 0,
    fee: 250,
  });
  return bankRows.slice(0, 25);
}

// ---------------------------------------------------------------------------------------------
// Validation + dry-run simulation
// ---------------------------------------------------------------------------------------------

interface RowContext {
  state: ImportState;
  accountCodes: Set<string>;
  existingDocNumbers: Set<string>;
  seenDocNumbers: Set<string>;
  bankCodes: Set<string>;
}

function emptyRow(rowNumber: number, raw: ImportSheetRow): ImportRow {
  return {
    row_number: rowNumber,
    raw,
    status: 'VALID',
    errors: [],
    warnings: [],
    amount_poisha: 0n,
    vat_poisha: 0n,
    vds_poisha: 0n,
    tds_poisha: 0n,
  };
}

function priority(status: ImportRowStatus): number {
  switch (status) {
    case 'INVALID_DATE':
      return 10;
    case 'PERIOD_CLOSED':
      return 9;
    case 'UNBALANCED_JOURNAL':
      return 8;
    case 'DUPLICATE_DOC_NO':
      return 7;
    case 'INVALID_ACCOUNT':
      return 6;
    case 'TAX_ENGINE_REVIEW':
      return 5;
    case 'CASH_OVER_100K_VAT_DISALLOWED':
      return 4;
    case 'NO_TIN_PENALTY_UPSCALED':
      return 3;
    case 'DUPLICATE_DOC_WARNING':
      return 2;
    case 'INVALID_BIN_WARNING':
      return 2;
    default:
      return 1;
  }
}

/**
 * A row is postable when its status carries warnings only. Every caller (dry run, balance rules and
 * the committer) shares this one predicate, so the preview can never disagree with the posting.
 */
export function isPostableImportStatus(status: ImportRowStatus): boolean {
  return (
    status === 'VALID' ||
    status === 'FIXED' ||
    status === 'INVALID_BIN_WARNING' ||
    status === 'NO_TIN_PENALTY_UPSCALED' ||
    status === 'CASH_OVER_100K_VAT_DISALLOWED' ||
    status === 'DUPLICATE_DOC_WARNING'
  );
}

const WARNING_STATUSES: ImportRowStatus[] = [
  'INVALID_BIN_WARNING',
  'NO_TIN_PENALTY_UPSCALED',
  'CASH_OVER_100K_VAT_DISALLOWED',
  'DUPLICATE_DOC_WARNING',
];

function mark(row: ImportRow, status: ImportRowStatus, message: string): void {
  if (priority(status) > priority(row.status)) row.status = status;
  if (status === 'VALID') return;
  if (WARNING_STATUSES.includes(status)) {
    if (!row.warnings.includes(message)) row.warnings.push(message);
  } else if (!row.errors.includes(message)) {
    row.errors.push(message);
  }
}

function validateCommon(row: ImportRow, state: ImportState): boolean {
  const date = asString(row.raw, 'date');
  if (!isValidIsoDate(date)) {
    mark(row, 'INVALID_DATE', `Date "${date || '(blank)'}" is not a valid YYYY-MM-DD posting date.`);
    return false;
  }
  const periodStatus = periodStatusFor(state.periods, date);
  if (periodStatus !== 'OPEN') {
    mark(
      row,
      'PERIOD_CLOSED',
      periodStatus === 'UNKNOWN'
        ? `No accounting period is configured for ${date}. Imported postings require an explicit OPEN period.`
        : `The accounting period for ${date} is ${periodStatus} and cannot accept imported postings.`,
    );
    return false;
  }
  return true;
}

/**
 * Dry-run a batch. Nothing is mutated: the caller commits only the rows that come back VALID.
 */
export function parseAndSimulateImport(
  rows: readonly ImportSheetRow[],
  currentState: ImportState,
  options: { pipeline?: ImportPipeline; file_name?: string; benchmark?: string } = {},
): ImportSimulation {
  const pipeline = options.pipeline ?? 'SALES_PURCHASE';
  const context: RowContext = {
    state: currentState,
    accountCodes: new Set(currentState.accounts.map((account) => account.code)),
    existingDocNumbers: new Set(currentState.commercialDocs.map((doc) => doc.doc_number)),
    seenDocNumbers: new Set<string>(),
    bankCodes: new Set(
      (currentState.bankAccounts ?? []).map((account) => account.account_code).concat(['1110', '1115', '1120', '1125', '1130']),
    ),
  };

  const simulated = rows.map((raw, index) => simulateRow(raw, index + 1, pipeline, context));
  const validRows = simulated.filter((row) => isPostableImportStatus(row.status));
  const totalDebit = simulated.reduce((sum, row) => sum + (row.debit_poisha_hint ?? 0n), 0n);
  const totalCredit = simulated.reduce((sum, row) => sum + (row.credit_poisha_hint ?? 0n), 0n);

  return {
    pipeline,
    rows: simulated.map(stripHints),
    valid_rows: validRows.length,
    invalid_rows: simulated.length - validRows.length,
    total_debit_poisha: totalDebit,
    total_credit_poisha: totalCredit,
    output_vat_poisha: simulated.reduce((sum, row) => sum + (row.raw.doc_type === 'SALES_INVOICE' ? row.vat_poisha : 0n), 0n),
    input_vat_claimable_poisha: simulated.reduce(
      (sum, row) => sum + (row.raw.doc_type === 'SALES_INVOICE' ? 0n : row.claimable_hint ?? 0n),
      0n,
    ),
    disallowed_vat_poisha: simulated.reduce((sum, row) => sum + (row.disallowed_hint ?? 0n), 0n),
    vds_poisha: simulated.reduce((sum, row) => sum + row.vds_poisha, 0n),
    tds_poisha: simulated.reduce((sum, row) => sum + row.tds_poisha, 0n),
    balanced: totalDebit === totalCredit,
    file_name: options.file_name ?? `${pipeline.toLowerCase()}-demo-batch.xlsx`,
  };
}

interface SimulatedRow extends ImportRow {
  debit_poisha_hint?: bigint;
  credit_poisha_hint?: bigint;
  claimable_hint?: bigint;
  disallowed_hint?: bigint;
  decision_state_hint?: string;
  doc_hint?: TaxAnnotatedDoc;
  journal_hint?: JournalDraft;
}

function stripHints(row: SimulatedRow): ImportRow {
  return {
    row_number: row.row_number,
    raw: row.raw,
    status: row.status,
    errors: row.errors,
    warnings: row.warnings,
    amount_poisha: row.amount_poisha,
    vat_poisha: row.vat_poisha,
    vds_poisha: row.vds_poisha,
    tds_poisha: row.tds_poisha,
  };
}

function simulateRow(raw: ImportSheetRow, rowNumber: number, pipeline: ImportPipeline, context: RowContext): SimulatedRow {
  const row = emptyRow(rowNumber, raw) as SimulatedRow;
  if (!validateCommon(row, context.state)) return row;

  if (pipeline === 'SALES_PURCHASE') return simulateCommercialRow(row, context);
  if (pipeline === 'BULK_JOURNAL') return simulateJournalRow(row, context);
  if (pipeline === 'OPENING_BALANCE') return simulateOpeningRow(row, context);
  return simulateBankRow(row, context);
}

function simulateCommercialRow(row: SimulatedRow, context: RowContext): SimulatedRow {
  const docNumber = asString(row.raw, 'doc_no');
  const base = asPoisha(row.raw, 'base_amount');
  const partyBin = asString(row.raw, 'party_bin');
  const partyTin = asString(row.raw, 'party_tin');
  const tdsText = (asString(row.raw, 'tds_nature') || 'NONE') as TdsNature;
  const tdsNature = TDS_NATURES.includes(tdsText) ? tdsText : 'NONE';

  row.amount_poisha = base;
  if (!docNumber) {
    mark(row, 'INVALID_ACCOUNT', 'Every commercial row needs a document number.');
    return row;
  }
  if (context.existingDocNumbers.has(docNumber)) {
    mark(row, 'DUPLICATE_DOC_NO', `Document ${docNumber} already exists in the ledger and would be posted twice.`);
  }
  if (context.seenDocNumbers.has(docNumber)) {
    mark(
      row,
      'DUPLICATE_DOC_WARNING',
      `Document ${docNumber} appears more than once inside this batch — the second copy is a probable copy/paste duplicate.`,
    );
  }
  context.seenDocNumbers.add(docNumber);
  if (base <= 0n) {
    mark(row, 'TAX_ENGINE_REVIEW', 'The taxable base is zero, so the tax engine cannot evaluate the document.');
    return row;
  }
  if (partyBin && !isValidBinFormat(partyBin)) {
    mark(row, 'INVALID_BIN_WARNING', `BIN "${partyBin}" is not a 13-digit registration; input VAT will be disallowed under s.46.`);
  }
  if (!partyTin && tdsNature !== 'NONE') {
    mark(row, 'NO_TIN_PENALTY_UPSCALED', 'No 12-digit e-TIN: the TDS rate is upscaled by 50% (3% → 4.5%, 10% → 15%).');
  } else if (partyTin && !isValidTinFormat(partyTin)) {
    mark(row, 'NO_TIN_PENALTY_UPSCALED', `e-TIN "${partyTin}" is not a valid 12-digit number, so the 50% TDS upscale applies.`);
  }

  try {
    const spec = commercialSpecFromRow(row.raw, context.state, context.state.tenant.bin_units[0]?.id ?? 'BU-DHK');
    const built = buildCommercialDoc(spec);
    row.doc_hint = built.doc;
    row.vat_poisha = built.doc.vat_poisha;
    row.vds_poisha = built.doc.vds_poisha;
    row.tds_poisha = built.doc.tds_poisha;
    row.claimable_hint = built.doc.tax_claimable_poisha;
    row.disallowed_hint = built.doc.tax_disallowed_poisha;
    row.decision_state_hint = built.decision.decision;
    row.debit_poisha_hint =
      journalTotals(built.document_lines).debit_poisha + journalTotals(built.settlement_lines).debit_poisha;
    row.credit_poisha_hint = row.debit_poisha_hint;
    const payment = (asString(row.raw, 'payment_method') || 'BANK').toUpperCase();
    const cashLimit = context.state.tenant.accounting_policies.cash_disallowance_limit_poisha;
    const purchaseSide = spec.doc_type === 'PURCHASE_BILL' || spec.doc_type === 'EXPENSE_VOUCHER' || spec.doc_type === 'IMPORTED_SERVICE';
    if (purchaseSide && payment === 'CASH' && built.doc.gross_poisha > cashLimit) {
      mark(
        row,
        'CASH_OVER_100K_VAT_DISALLOWED',
        `Cash settlement of ${formatPoisha(built.doc.gross_poisha)} exceeds the ${formatPoisha(cashLimit)} limit — the input rebate is disallowed under s.46.`,
      );
    }
    if (built.decision.decision === 'NOT_SUPPORTED' || built.decision.decision === 'MANUAL_REVIEW') {
      mark(row, 'TAX_ENGINE_REVIEW', `The tax engine routed this document to ${built.decision.decision}.`);
    }
  } catch (error) {
    mark(row, 'TAX_ENGINE_REVIEW', `Tax engine error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return row;
}

/**
 * One place where an imported commercial row becomes a tax-engine fact. The simulator and the
 * committer both use it, so the dry-run preview can never disagree with what gets posted.
 */
function commercialSpecFromRow(raw: ImportSheetRow, state: ImportState, binUnitId: string) {
  const docType = (asString(raw, 'doc_type') || 'SALES_INVOICE') as CommercialDocType;
  const partyName = asString(raw, 'party_name') || 'Imported counterparty';
  const partyBin = asString(raw, 'party_bin');
  const partyTin = asString(raw, 'party_tin');
  const base = asPoisha(raw, 'base_amount');
  const date = asString(raw, 'date');
  const taxCategoryText = (asString(raw, 'tax_category') || 'STANDARD_15') as TaxCategory;
  const taxCategory = TAX_CATEGORIES.includes(taxCategoryText) ? taxCategoryText : 'STANDARD_15';
  const tdsText = (asString(raw, 'tds_nature') || 'NONE') as TdsNature;
  const paymentText = (asString(raw, 'payment_method') || 'BANK') as PaymentMethod;
  const party: Party = {
    id: `IMP-PTY-${asString(raw, 'doc_no')}`,
    code: `IMP-${asString(raw, 'doc_no')}`,
    name_en: partyName,
    name_bn: partyName,
    type: docType === 'SALES_INVOICE' || docType === 'CREDIT_NOTE' ? 'CUSTOMER' : 'SUPPLIER',
    bin: partyBin || undefined,
    tin: partyTin || undefined,
    address_en: 'Imported address',
    address_bn: 'আমদানি ঠিকানা',
    mobile: '',
    email: '',
    is_withholding_buyer: false,
    is_government: false,
    credit_days: 30,
    opening_balance_poisha: 0n,
    is_active: true,
  };
  const isService = docType === 'EXPENSE_VOUCHER' || docType === 'IMPORTED_SERVICE';
  return {
    doc_type: docType,
    doc_number: asString(raw, 'doc_no'),
    doc_date: date,
    due_date: date,
    party,
    bin_unit_id: binUnitId,
    lines: [
      {
        id: `${asString(raw, 'doc_no')}-L1`,
        sku: 'IMPORT-ROW',
        description_en: `Imported ${docType.toLowerCase().replace(/_/g, ' ')}`,
        description_bn: 'আমদানি করা বাণিজ্যিক নথি',
        quantity: 1,
        unit_price_poisha: base,
        tax_category: taxCategory,
      },
    ],
    base_poisha: base,
    tax_category: taxCategory,
    tds_nature: TDS_NATURES.includes(tdsText) ? tdsText : 'NONE',
    payment_method: PAYMENT_METHODS.includes(paymentText) ? paymentText : 'BANK',
    narration_en: `Imported commercial document ${asString(raw, 'doc_no')}`,
    narration_bn: `আমদানি করা বাণিজ্যিক নথি ${asString(raw, 'doc_no')}`,
    reverse_charge: taxCategory === 'REVERSE_CHARGE',
    // VDS is withheld on services and rent, not on a straight supply of goods.
    vds_applicable: isService,
    // A commercial import carries no supplier Mushak 6.3 evidence column. Never fabricate one: the
    // purchase line records the input-VAT consequence of the evidence that actually exists.
    mushak_serial: undefined,
    tenant_is_withholding_entity: state.tenant.is_withholding_entity,
    cost_account_code: docType === 'PURCHASE_BILL' ? '1310' : undefined,
    book_type: 'STATUTORY_BD' as BookType,
    evaluated_at: `${date}T09:00:00.000+06:00`,
  };
}

function simulateJournalRow(row: SimulatedRow, context: RowContext): SimulatedRow {
  const code = asString(row.raw, 'account_code');
  const debit = asPoisha(row.raw, 'debit');
  const credit = asPoisha(row.raw, 'credit');
  row.amount_poisha = debit > 0n ? debit : credit;
  row.debit_poisha_hint = debit;
  row.credit_poisha_hint = credit;
  if (!context.accountCodes.has(code)) {
    mark(row, 'INVALID_ACCOUNT', `Account ${code || '(blank)'} is not in the chart of accounts.`);
  }
  if (debit > 0n && credit > 0n) {
    mark(row, 'UNBALANCED_JOURNAL', 'A single line cannot carry both a debit and a credit amount.');
  }
  return row;
}

function simulateOpeningRow(row: SimulatedRow, context: RowContext): SimulatedRow {
  const code = asString(row.raw, 'account_code');
  const debit = asPoisha(row.raw, 'debit');
  const credit = asPoisha(row.raw, 'credit');
  row.amount_poisha = debit > 0n ? debit : credit;
  row.debit_poisha_hint = debit;
  row.credit_poisha_hint = credit;
  if (!context.accountCodes.has(code)) {
    mark(row, 'INVALID_ACCOUNT', `Account ${code || '(blank)'} is not in the chart of accounts.`);
  }
  if (debit === 0n && credit === 0n) {
    mark(row, 'UNBALANCED_JOURNAL', 'An opening-balance row with no amount carries no information.');
  }
  return row;
}

function simulateBankRow(row: SimulatedRow, context: RowContext): SimulatedRow {
  const code = asString(row.raw, 'bank_account');
  const receipt = asPoisha(row.raw, 'receipt');
  const payment = asPoisha(row.raw, 'payment');
  const fee = asPoisha(row.raw, 'fee');
  row.amount_poisha = receipt > 0n ? receipt : payment;
  row.debit_poisha_hint = receipt + payment + fee;
  row.credit_poisha_hint = receipt + payment + fee;
  if (!context.bankCodes.has(code) && !context.accountCodes.has(code)) {
    mark(row, 'INVALID_ACCOUNT', `Bank/MFS account ${code || '(blank)'} is not registered.`);
  }
  if (receipt === 0n && payment === 0n && fee === 0n) {
    mark(row, 'UNBALANCED_JOURNAL', 'A statement line with no receipt, payment or fee is empty.');
  }
  return row;
}

/**
 * Group-level validation for the pipelines where balance is a property of the whole batch rather
 * than a single row (bulk journals balance per journal number, opening balances as one journal).
 */
export function applyBatchBalanceRules(simulation: ImportSimulation): ImportSimulation {
  const rows = simulation.rows.map((row) => ({ ...row, errors: [...row.errors], warnings: [...row.warnings] }));
  if (simulation.pipeline === 'BULK_JOURNAL') {
    const groups = new Map<string, ImportRow[]>();
    for (const row of rows) {
      const key = asString(row.raw, 'journal_no');
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const [journalNo, group] of groups) {
      const debit = group.reduce((sum, row) => sum + asPoisha(row.raw, 'debit'), 0n);
      const credit = group.reduce((sum, row) => sum + asPoisha(row.raw, 'credit'), 0n);
      if (group.length < 2) {
        for (const row of group) mark(row, 'UNBALANCED_JOURNAL', `Journal ${journalNo} has only ${group.length} line(s).`);
      }
      if (debit !== credit) {
        for (const row of group) {
          mark(
            row,
            'UNBALANCED_JOURNAL',
            `Journal ${journalNo} is out of balance by ${(Number(debit - credit) / 100).toFixed(2)} BDT.`,
          );
        }
      }
    }
  }
  if (simulation.pipeline === 'OPENING_BALANCE') {
    const debit = rows.reduce((sum, row) => sum + asPoisha(row.raw, 'debit'), 0n);
    const credit = rows.reduce((sum, row) => sum + asPoisha(row.raw, 'credit'), 0n);
    if (debit !== credit) {
      for (const row of rows) {
        mark(
          row,
          'UNBALANCED_JOURNAL',
          `Opening balances do not balance: debits ${(Number(debit) / 100).toFixed(2)} vs credits ${(Number(credit) / 100).toFixed(2)} BDT.`,
        );
      }
    }
  }
  const validRows = rows.filter((row) => isPostableImportStatus(row.status));
  return {
    ...simulation,
    rows,
    valid_rows: validRows.length,
    invalid_rows: rows.length - validRows.length,
    balanced: simulation.total_debit_poisha === simulation.total_credit_poisha,
  };
}

// ---------------------------------------------------------------------------------------------
// Commit / rollback journal construction
// ---------------------------------------------------------------------------------------------

export interface CommitContext {
  state: ImportState;
  batchId: string;
  committedBy: string;
  bookingDate?: string;
}

export interface CommitResult {
  drafts: JournalDraft[];
  docs: TaxAnnotatedDoc[];
  totalDebit: bigint;
  totalCredit: bigint;
  /**
   * Opening-balance batches also re-base the bank/MFS registers, otherwise the control proof would
   * legitimately show a difference between the GL and the register opening balances.
   */
  bank_opening_delta_poisha: Record<string, bigint>;
}

/** Turn a committed simulation into balanced journal drafts. Never mutates the ledger itself. */
export function buildJournalsFromSimulation(simulation: ImportSimulation, context: CommitContext): CommitResult {
  const drafts: JournalDraft[] = [];
  const docs: TaxAnnotatedDoc[] = [];
  const bankOpeningDelta: Record<string, bigint> = {};
  const bankCodes = new Set((context.state.bankAccounts ?? []).map((account) => account.account_code));
  const binUnitId = context.state.tenant.bin_units[0]?.id ?? 'BU-DHK';
  const payable = (row: ImportRow): boolean => isPostableImportStatus(row.status);
  let totalDebit = 0n;
  let totalCredit = 0n;

  if (simulation.pipeline === 'BULK_JOURNAL') {
    const groups = new Map<string, ImportRow[]>();
    for (const row of simulation.rows) {
      if (!payable(row)) continue;
      const key = asString(row.raw, 'journal_no');
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const [journalNo, group] of groups) {
      const lines: JournalLineDraft[] = group.map((row) => {
        const code = asString(row.raw, 'account_code');
        return {
          account_code: code,
          debit_poisha: asPoisha(row.raw, 'debit'),
          credit_poisha: asPoisha(row.raw, 'credit'),
          memo: asString(row.raw, 'narration'),
        };
      });
      const totals = journalTotals(lines);
      if (totals.debit_poisha !== totals.credit_poisha || totals.debit_poisha === 0n) continue;
      totalDebit += totals.debit_poisha;
      totalCredit += totals.credit_poisha;
      drafts.push({
        journal_number: journalNo,
        book_type: (asString(group[0].raw, 'book_type') || 'STATUTORY_BD') as BookType,
        bin_unit_id: binUnitId,
        document_date: asString(group[0].raw, 'date'),
        posting_date: asString(group[0].raw, 'date'),
        source_module: 'MASS_IMPORT',
        source_doc_ref: journalNo,
        import_batch_id: context.batchId,
        narration_en: `Imported journal ${journalNo}`,
        narration_bn: `আমদানি করা জার্নাল ${journalNo}`,
        created_by: context.committedBy,
        lines,
      });
    }
    return { drafts, docs, totalDebit, totalCredit, bank_opening_delta_poisha: bankOpeningDelta };
  }

  if (simulation.pipeline === 'OPENING_BALANCE') {
    const lines: JournalLineDraft[] = simulation.rows
      .filter(payable)
      .map((row) => ({
        account_code: asString(row.raw, 'account_code'),
        debit_poisha: asPoisha(row.raw, 'debit'),
        credit_poisha: asPoisha(row.raw, 'credit'),
        memo: asString(row.raw, 'narration'),
      }))
      .filter((line) => (line.debit_poisha ?? 0n) > 0n || (line.credit_poisha ?? 0n) > 0n);
    const totals = journalTotals(lines);
    if (lines.length >= 2 && totals.debit_poisha === totals.credit_poisha && totals.debit_poisha > 0n) {
      totalDebit += totals.debit_poisha;
      totalCredit += totals.credit_poisha;
      for (const line of lines) {
        if (!bankCodes.has(line.account_code)) continue;
        bankOpeningDelta[line.account_code] =
          (bankOpeningDelta[line.account_code] ?? 0n) + (line.debit_poisha ?? 0n) - (line.credit_poisha ?? 0n);
      }
      const date = asString(simulation.rows[0]?.raw ?? {}, 'date') || '2026-07-01';
      drafts.push({
        book_type: 'STATUTORY_BD',
        bin_unit_id: binUnitId,
        document_date: date,
        posting_date: date,
        source_module: 'OPENING_BALANCE',
        source_doc_ref: `OPENING-${context.batchId}`,
        import_batch_id: context.batchId,
        narration_en: `Opening balances imported in batch ${context.batchId}.`,
        narration_bn: `ব্যাচ ${context.batchId}-এ উদ্বোধনী ব্যালেন্স আমদানি।`,
        created_by: context.committedBy,
        lines,
      });
    }
    return { drafts, docs, totalDebit, totalCredit, bank_opening_delta_poisha: bankOpeningDelta };
  }

  if (simulation.pipeline === 'BANK_MFS') {
    for (const row of simulation.rows) {
      if (!payable(row)) continue;
      const code = asString(row.raw, 'bank_account');
      const receipt = asPoisha(row.raw, 'receipt');
      const payment = asPoisha(row.raw, 'payment');
      const fee = asPoisha(row.raw, 'fee');
      const lines: JournalLineDraft[] = [];
      if (receipt > 0n) {
        // Statement receipts are unapplied until they are matched to a document, so they land in
        // 2190 Suspense rather than in the receivable control account.
        lines.push({ account_code: code, debit_poisha: receipt, memo: 'Statement receipt' });
        lines.push({ account_code: '2190', credit_poisha: receipt, memo: 'Unapplied receipt — suspense' });
      }
      if (payment > 0n) {
        lines.push({ account_code: '2190', debit_poisha: payment, memo: 'Suspense cleared by payment' });
        lines.push({ account_code: code, credit_poisha: payment, memo: 'Statement payment' });
      }
      if (fee > 0n) {
        lines.push({ account_code: '5820', debit_poisha: fee, memo: 'Bank / MFS charge' });
        lines.push({ account_code: code, credit_poisha: fee, memo: 'Charge debited by provider' });
      }
      const totals = journalTotals(lines);
      if (lines.length < 2 || totals.debit_poisha !== totals.credit_poisha) continue;
      totalDebit += totals.debit_poisha;
      totalCredit += totals.credit_poisha;
      drafts.push({
        book_type: 'STATUTORY_BD',
        bin_unit_id: binUnitId,
        document_date: asString(row.raw, 'date'),
        posting_date: asString(row.raw, 'date'),
        source_module: 'MASS_IMPORT',
        source_doc_ref: asString(row.raw, 'reference'),
        import_batch_id: context.batchId,
        narration_en: `Bank statement import — ${asString(row.raw, 'description')}`,
        narration_bn: `ব্যাংক বিবরণী আমদানি — ${asString(row.raw, 'description')}`,
        created_by: context.committedBy,
        lines,
      });
    }
    return { drafts, docs, totalDebit, totalCredit, bank_opening_delta_poisha: bankOpeningDelta };
  }

  // SALES_PURCHASE — rebuild each document through the tax engine and post its two journals.
  for (const row of simulation.rows) {
    if (!payable(row)) continue;
    const base = asPoisha(row.raw, 'base_amount');
    if (base <= 0n) continue;
    const date = asString(row.raw, 'date');
    const spec = commercialSpecFromRow(row.raw, context.state, binUnitId);
    const built = buildCommercialDoc(spec);
    if (spec.doc_type === 'SALES_INVOICE') {
      // Imported sales invoices must still consume the statutory 6.3 series in posting order; a
      // credit note has its own CN document series and never touches this allocator.
      built.doc.mushak_serial = allocateMushak63Serial(
        binUnitId,
        [...context.state.commercialDocs, ...docs],
        spec.doc_date.slice(0, 4),
      );
    }
    const hasSettlement =
      built.settlement_lines.length >= 2 && journalTotals(built.settlement_lines).debit_poisha > 0n;
    if (hasSettlement) {
      built.doc.settled_poisha = built.doc.gross_poisha;
      built.doc.status = 'SETTLED';
    }
    docs.push(built.doc);
    const documentTotals = journalTotals(built.document_lines);
    const settlementTotals = journalTotals(built.settlement_lines);
    totalDebit += documentTotals.debit_poisha + settlementTotals.debit_poisha;
    totalCredit += documentTotals.credit_poisha + settlementTotals.credit_poisha;
    const sourceModule: SourceModule =
      spec.doc_type === 'SALES_INVOICE' || spec.doc_type === 'CREDIT_NOTE' ? 'SALES' : 'PURCHASES';
    drafts.push({
      book_type: 'STATUTORY_BD',
      bin_unit_id: binUnitId,
      document_date: date,
      posting_date: date,
      source_module: sourceModule,
      source_doc_id: built.doc.id,
      source_doc_ref: built.doc.doc_number,
      import_batch_id: context.batchId,
      tax_decision_trace_id: built.doc.tax_trace_id,
      narration_en: built.doc.narration_en,
      narration_bn: built.doc.narration_bn,
      created_by: context.committedBy,
      lines: built.document_lines,
    });
    if (hasSettlement) {
      drafts.push({
        book_type: 'STATUTORY_BD',
        bin_unit_id: binUnitId,
        document_date: date,
        posting_date: context.bookingDate ?? date,
        source_module: 'BANK_MFS',
        source_doc_id: built.doc.id,
        source_doc_ref: built.doc.doc_number,
        import_batch_id: context.batchId,
        narration_en: `Settlement of imported document ${built.doc.doc_number}`,
        narration_bn: `আমদানি করা নথি ${built.doc.doc_number}-এর নিষ্পত্তি`,
        created_by: context.committedBy,
        lines: built.settlement_lines,
      });
    }
  }
  return { drafts, docs, totalDebit, totalCredit, bank_opening_delta_poisha: bankOpeningDelta };
}

function escapeXml(val: unknown): string {
  const str = val === null || val === undefined ? '' : String(val);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeCellFormula(val: unknown): unknown {
  if (typeof val === 'string') {
    if (val.startsWith('=') || val.startsWith('+') || val.startsWith('-') || val.startsWith('@')) {
      return `'${val}`;
    }
  }
  return val;
}

export function buildSpreadsheetML(
  sheets: Array<{ name: string; rows: Array<Array<unknown>>; widths?: number[] }>,
): string {
  const xmlSheets = sheets
    .map((sheet) => {
      const tableRows = sheet.rows
        .map((row) => {
          const cells = row
            .map((cell) => {
              const cleanCell = sanitizeCellFormula(cell);
              const isNum = typeof cleanCell === 'number' && Number.isFinite(cleanCell);
              const type = isNum ? 'Number' : 'String';
              const style = isNum ? ' ss:StyleID="sCurrency"' : '';
              return `    <Cell${style}><Data ss:Type="${type}">${escapeXml(cleanCell)}</Data></Cell>`;
            })
            .join('\n');
          return `   <Row>\n${cells}\n   </Row>`;
        })
        .join('\n');

      const colDefs = sheet.widths
        ? sheet.widths.map((w) => `   <Column ss:Width="${w * 8}"/>`).join('\n')
        : '';

      return ` <Worksheet ss:Name="${escapeXml(sheet.name.slice(0, 31))}">
  <Table>
${colDefs ? colDefs + '\n' : ''}${tableRows}
  </Table>
 </Worksheet>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>Fintuity Accounting Suite</Author>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#0F172A"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="sHeader">
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="sCurrency">
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
 </Styles>
${xmlSheets}
</Workbook>`;
}

export function buildCsv(rows: Array<Array<unknown>>): string {
  return (
    rows
      .map((row) =>
        row
          .map((val) => {
            if (val === null || val === undefined) return '';
            let text = String(val);
            if (text.startsWith('=') || text.startsWith('+') || text.startsWith('-') || text.startsWith('@')) {
              text = `'${text}`;
            }
            return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}

export function downloadWorkbookFile(
  fileName: string,
  content: string,
  mimeType: string = 'application/vnd.ms-excel;charset=utf-8',
): void {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    try {
      const fs = require('node:fs');
      fs.writeFileSync(fileName, content, 'utf8');
    } catch {
      // ignore in non-filesystem environments
    }
  }
}

export function downloadSpreadsheetWorkbook(
  fileName: string,
  sheets: Array<{ name: string; rows: Array<Array<unknown>>; widths?: number[] }>,
): void {
  const xml = buildSpreadsheetML(sheets);
  downloadWorkbookFile(fileName, xml);
}

export function downloadSpreadsheetFromCsv(fileName: string, csvContent: string): void {
  const rows = parseSpreadsheetTextToRows(csvContent);
  downloadSpreadsheetWorkbook(fileName, [{ name: 'Report', rows }]);
}

/** Header row + one worked example, so a user can fill the template without guessing. */
export function downloadSampleTemplateXlsx(pipelineType: ImportPipeline): void {
  const columns = PIPELINE_COLUMNS[pipelineType];
  const examples = generateDemoImportBatch(pipelineType).slice(0, 3);
  const templateRows: Array<Array<unknown>> = [
    columns,
    ...examples.map((ex) => columns.map((col) => ex[col] ?? '')),
  ];
  const notes: Array<Array<unknown>> = [
    ['Fintuity Accounting Suite import template'],
    ['Pipeline', pipelineType],
    ['Description', PIPELINE_LABEL[pipelineType].description_en],
    ['Rules', 'Dates must be YYYY-MM-DD. Amounts are in BDT (not poisha). Every journal group must balance to the poisha.'],
    ['Rules', 'BIN must be 13 digits, e-TIN 12 digits. Missing e-TIN upscales TDS by 50% under the Income Tax Act 2023.'],
    ['Rules', 'Rows that fail validation are reported in the dry run and are never posted.'],
  ];

  downloadSpreadsheetWorkbook(`Fintuity Accounting Suite-${pipelineType.toLowerCase()}-template.xlsx`, [
    { name: 'Template', rows: templateRows },
    { name: 'Read me', rows: notes },
  ]);
}

export function exportSimulationCsv(simulation: ImportSimulation): void {
  const header = ['row', 'status', 'amount_bdt', 'vat_bdt', 'vds_bdt', 'tds_bdt', 'errors', 'warnings'];
  const rows: Array<Array<unknown>> = [
    header,
    ...simulation.rows.map((row) => [
      row.row_number,
      row.status,
      poishaToBdtNumber(row.amount_poisha),
      poishaToBdtNumber(row.vat_poisha),
      poishaToBdtNumber(row.vds_poisha),
      poishaToBdtNumber(row.tds_poisha),
      row.errors.join(' | '),
      row.warnings.join(' | '),
    ]),
  ];
  const csv = buildCsv(rows);
  downloadWorkbookFile(
    `Fintuity Accounting Suite-dry-run-${simulation.pipeline.toLowerCase()}.csv`,
    csv,
    'text/csv;charset=utf-8',
  );
}

// ---------------------------------------------------------------------------------------------
// 9-tab audit pack
// ---------------------------------------------------------------------------------------------

export interface AuditPackState {
  tenant: TenantEntity;
  statements: FinancialStatements;
  journals: readonly JournalEntry[];
  commercialDocs: readonly CommercialDoc[];
  challans: readonly Challan[];
  accounts: readonly Account[];
  subledger?: SubledgerReconciliation | null;
  auditChain?: AuditChainResult | null;
}

const money = (value: bigint): number => poishaToBdtNumber(value);

/**
 * Download the real 9-tab `.xlsx` audit pack an external auditor asks for:
 * Summary · Trial Balance · IAS 1 Balance Sheet · IFRS 18 P&L · IAS 7 Cash Flows ·
 * Mushak 6.1 · Mushak 6.2 · VDS/TDS Schedule · Immutable GL with SHA-256 hashes.
 */
export function exportFullAuditPackXlsx(state: AuditPackState): void {
  const { statements, tenant } = state;
  const periodLabel = statements.period.label_en;
  const comparativeLabel = statements.comparative.label_en;

  // 1 — Summary -------------------------------------------------------------------------------
  const summary: Array<Array<string | number>> = [
    ['LEDGERVault — AUDIT PACK'],
    ['Entity', tenant.name_en],
    ['BIN units', tenant.bin_units.map((unit) => `${unit.unit_name_en} (${unit.bin_number})`).join(' · ')],
    ['TIN', tenant.tin_number],
    ['RJSC', tenant.rjsc_reg_no],
    ['Reporting framework', tenant.reporting_framework],
    ['Rule pack', 'bd-2026-v1'],
    ['Book filter', statements.book_filter],
    ['Current period', periodLabel],
    ['Comparative period', comparativeLabel],
    ['Generated at', new Date().toISOString()],
    [],
    ['Key figures (BDT)', periodLabel, comparativeLabel],
    ['Revenue', money(statements.kpis.revenue_poisha), money(statements.profit_or_loss.operating.comparative_total_poisha)],
    ['Operating profit / (loss)', money(statements.profit_or_loss.operating_profit_poisha), money(statements.profit_or_loss.operating_profit_comparative_poisha)],
    ['Profit / (loss) before financing and tax', money(statements.profit_or_loss.profit_before_financing_tax_poisha), money(statements.profit_or_loss.profit_before_financing_tax_comparative_poisha)],
    ['Profit / (loss) for the period', money(statements.profit_or_loss.profit_for_period_poisha), money(statements.profit_or_loss.profit_for_period_comparative_poisha)],
    ['Adjusted EBITDA (MPM)', money(statements.profit_or_loss.mpm.adjusted_ebitda_poisha), ''],
    ['Total assets', money(statements.balance_sheet.total_assets_poisha), money(statements.balance_sheet.total_assets_comparative_poisha)],
    ['Total equity and liabilities', money(statements.balance_sheet.total_equity_and_liabilities_poisha), money(statements.balance_sheet.total_equity_and_liabilities_comparative_poisha)],
    ['Balance sheet imbalance (must be 0.00)', money(statements.balance_sheet.imbalance_poisha), ''],
    ['Cash flow reconciliation difference (must be 0.00)', money(statements.cash_flow.difference_poisha), ''],
    [],
    ['Audit chain', state.auditChain ? (state.auditChain.valid ? `VALID over ${state.auditChain.checkedCount} journals` : `BROKEN at ${state.auditChain.brokenAtId}`) : 'not verified'],
    ['Journals exported', state.journals.length],
    ['Commercial documents', state.commercialDocs.length],
    ['Treasury challans', state.challans.length],
  ];
  if (state.subledger) {
    summary.push([], ['Subledger control proof', 'GL balance', 'Subledger', 'Difference']);
    for (const row of state.subledger.rows) {
      summary.push([row.label_en, money(row.gl_balance_poisha), money(row.subledger_balance_poisha), money(row.difference_poisha)]);
    }
    summary.push(['Suspense balance (2190)', money(state.subledger.suspense_balance_poisha)]);
  }
  // Summary tab populated

  // 2 — Trial balance --------------------------------------------------------------------------
  const trial: Array<Array<string | number>> = [
    ['Trial balance', periodLabel],
    ['Account', 'Name', 'Type', 'Opening debit', 'Opening credit', 'Period debit', 'Period credit', 'Closing debit', 'Closing credit'],
  ];
  let totals = { od: 0n, oc: 0n, pd: 0n, pc: 0n, cd: 0n, cc: 0n };
  for (const row of statements.trial_balance) {
    trial.push([
      row.account_code,
      row.name_en,
      row.account_type,
      money(row.opening_debit_poisha),
      money(row.opening_credit_poisha),
      money(row.period_debit_poisha),
      money(row.period_credit_poisha),
      money(row.closing_debit_poisha),
      money(row.closing_credit_poisha),
    ]);
    totals = {
      od: totals.od + row.opening_debit_poisha,
      oc: totals.oc + row.opening_credit_poisha,
      pd: totals.pd + row.period_debit_poisha,
      pc: totals.pc + row.period_credit_poisha,
      cd: totals.cd + row.closing_debit_poisha,
      cc: totals.cc + row.closing_credit_poisha,
    };
  }
  trial.push(['', 'TOTAL', '', money(totals.od), money(totals.oc), money(totals.pd), money(totals.pc), money(totals.cd), money(totals.cc)]);
  trial.push(['', 'Control: closing debits = closing credits', totals.cd === totals.cc ? 'OK' : 'OUT OF BALANCE']);

  // 3 — IAS 1 balance sheet -------------------------------------------------------------------
  const bs: Array<Array<string | number>> = [['Statement of financial position (IAS 1)', periodLabel, comparativeLabel]];
  const pushSection = (title: string, section: FinancialStatements['balance_sheet']['assets_current']): void => {
    bs.push([title]);
    for (const line of section.lines) {
      bs.push([`${line.note ? `${line.note} · ` : ''}${line.label_en}`, money(line.amount_poisha), money(line.comparative_poisha)]);
    }
    bs.push([`Total ${title.toLowerCase()}`, money(section.total_poisha), money(section.comparative_total_poisha)], []);
  };
  pushSection('Non-current assets', statements.balance_sheet.assets_non_current);
  pushSection('Current assets', statements.balance_sheet.assets_current);
  bs.push(['TOTAL ASSETS', money(statements.balance_sheet.total_assets_poisha), money(statements.balance_sheet.total_assets_comparative_poisha)], []);
  pushSection('Equity', statements.balance_sheet.equity);
  pushSection('Non-current liabilities', statements.balance_sheet.liabilities_non_current);
  pushSection('Current liabilities', statements.balance_sheet.liabilities_current);
  bs.push(
    ['TOTAL EQUITY AND LIABILITIES', money(statements.balance_sheet.total_equity_and_liabilities_poisha), money(statements.balance_sheet.total_equity_and_liabilities_comparative_poisha)],
    ['Imbalance (must be 0.00)', money(statements.balance_sheet.imbalance_poisha), ''],
  );

  // 4 — IFRS 18 profit or loss ----------------------------------------------------------------
  const pl: Array<Array<string | number>> = [['Statement of profit or loss (IFRS 18 categories)', periodLabel, comparativeLabel]];
  const pushPl = (title: string, section: FinancialStatements['profit_or_loss']['operating']): void => {
    pl.push([title]);
    for (const line of section.lines) {
      pl.push([`${line.note ? `${line.note} · ` : ''}${line.label_en}`, money(line.amount_poisha), money(line.comparative_poisha)]);
    }
    pl.push([`Subtotal — ${title}`, money(section.total_poisha), money(section.comparative_total_poisha)], []);
  };
  pushPl('Operating category', statements.profit_or_loss.operating);
  pl.push(['MANDATORY SUBTOTAL — Operating profit / (loss)', money(statements.profit_or_loss.operating_profit_poisha), money(statements.profit_or_loss.operating_profit_comparative_poisha)], []);
  pushPl('Investing category', statements.profit_or_loss.investing);
  pl.push(
    ['MANDATORY SUBTOTAL — Profit / (loss) before financing and income taxes', money(statements.profit_or_loss.profit_before_financing_tax_poisha), money(statements.profit_or_loss.profit_before_financing_tax_comparative_poisha)],
    [],
  );
  pushPl('Financing category', statements.profit_or_loss.financing);
  pl.push(['Subtotal — Profit / (loss) before income tax', money(statements.profit_or_loss.profit_before_tax_poisha), money(statements.profit_or_loss.profit_before_tax_comparative_poisha)], []);
  pushPl('Income taxes category', statements.profit_or_loss.income_tax);
  pl.push(
    ['PROFIT / (LOSS) FOR THE PERIOD', money(statements.profit_or_loss.profit_for_period_poisha), money(statements.profit_or_loss.profit_for_period_comparative_poisha)],
    [],
    ['Management-defined performance measure — Adjusted EBITDA', 'Amount (BDT)', ''],
    ['Operating profit / (loss)', money(statements.profit_or_loss.mpm.operating_profit_poisha), ''],
    ['Add: depreciation (5400)', money(statements.profit_or_loss.mpm.depreciation_poisha), ''],
    ['Add: expected credit loss provision (5450)', money(statements.profit_or_loss.mpm.ecl_poisha), ''],
    ['Adjusted EBITDA', money(statements.profit_or_loss.mpm.adjusted_ebitda_poisha), ''],
    ['Operating margin (bps)', statements.profit_or_loss.mpm.operating_margin_bps, statements.profit_or_loss.mpm.comparative_margin_bps],
  );

  // 5 — IAS 7 cash flows ----------------------------------------------------------------------
  const cf: Array<Array<string | number>> = [['Statement of cash flows (IAS 7 indirect, starting from Operating Profit)', periodLabel, comparativeLabel]];
  const pushCf = (title: string, section: FinancialStatements['cash_flow']['operating']): void => {
    cf.push([title]);
    for (const line of section.lines) {
      cf.push([line.label_en, money(line.amount_poisha), money(line.comparative_poisha)]);
    }
    cf.push([`Net cash from ${title.toLowerCase()}`, money(section.total_poisha), money(section.comparative_total_poisha)], []);
  };
  pushCf('Operating activities', statements.cash_flow.operating);
  pushCf('Investing activities', statements.cash_flow.investing);
  pushCf('Financing activities', statements.cash_flow.financing);
  cf.push(
    ['Net change in cash and cash equivalents', money(statements.cash_flow.net_change_poisha), money(statements.cash_flow.net_change_comparative_poisha)],
    ['Cash and MFS at the beginning of the period', money(statements.cash_flow.opening_cash_poisha), money(statements.cash_flow.opening_cash_comparative_poisha)],
    ['Cash and MFS at the end of the period', money(statements.cash_flow.closing_cash_poisha), money(statements.cash_flow.closing_cash_comparative_poisha)],
    ['Reconciliation difference (must be 0.00)', money(statements.cash_flow.difference_poisha), ''],
    ['Reconciled', statements.cash_flow.reconciles ? 'YES' : 'NO'],
  );

  // 6 — Mushak 6.1 purchase register ----------------------------------------------------------
  const purchases = state.commercialDocs.filter(
    (doc) =>
      (doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER' || doc.doc_type === 'IMPORTED_SERVICE') &&
      doc.doc_date.slice(0, 7) === statements.period.code,
  );
  const m61: Array<Array<string | number>> = [
    ['Mushak 6.1 — Purchase register', periodLabel],
    ['Serial', 'Supplier', 'BIN', 'Invoice no', 'Date', 'Taxable value', 'VAT', 'Input rebate claimed', 'Disallowed VAT', 'TDS withheld'],
  ];
  let m61Totals = { value: 0n, vat: 0n, claimed: 0n, disallowed: 0n, tds: 0n };
  purchases.forEach((doc, index) => {
    const annotated = doc as Partial<TaxAnnotatedDoc>;
    const claimed = annotated.tax_claimable_poisha ?? 0n;
    const disallowed = annotated.tax_disallowed_poisha ?? 0n;
    m61.push([
      index + 1,
      doc.party_name_en,
      doc.party_bin ?? '—',
      doc.doc_number,
      doc.doc_date,
      money(doc.base_poisha),
      money(doc.vat_poisha),
      money(claimed),
      money(disallowed),
      money(doc.tds_poisha),
    ]);
    m61Totals = {
      value: m61Totals.value + doc.base_poisha,
      vat: m61Totals.vat + doc.vat_poisha,
      claimed: m61Totals.claimed + claimed,
      disallowed: m61Totals.disallowed + disallowed,
      tds: m61Totals.tds + doc.tds_poisha,
    };
  });
  m61.push(['', 'TOTAL', '', '', '', money(m61Totals.value), money(m61Totals.vat), money(m61Totals.claimed), money(m61Totals.disallowed), money(m61Totals.tds)]);

  // 7 — Mushak 6.2 sales register -------------------------------------------------------------
  const sales = state.commercialDocs.filter(
    (doc) => (doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE') && doc.doc_date.slice(0, 7) === statements.period.code,
  );
  const m62: Array<Array<string | number>> = [
    ['Mushak 6.2 — Sales register', periodLabel],
    ['Mushak 6.3 serial', 'Buyer', 'BIN', 'Invoice no', 'Date', 'Taxable value', 'VAT', 'VDS withheld by buyer', 'Gross value'],
  ];
  let m62Totals = { value: 0n, vat: 0n, vds: 0n, gross: 0n };
  for (const doc of sales) {
    m62.push([
      doc.mushak_serial ?? doc.mushak63_ref ?? '—',
      doc.party_name_en,
      doc.party_bin ?? '—',
      doc.doc_number,
      doc.doc_date,
      money(doc.base_poisha),
      money(doc.vat_poisha),
      money(doc.vds_poisha),
      money(doc.gross_poisha),
    ]);
    m62Totals = {
      value: m62Totals.value + doc.base_poisha,
      vat: m62Totals.vat + doc.vat_poisha,
      vds: m62Totals.vds + doc.vds_poisha,
      gross: m62Totals.gross + doc.gross_poisha,
    };
  }
  m62.push(['', 'TOTAL', '', '', '', money(m62Totals.value), money(m62Totals.vat), money(m62Totals.vds), money(m62Totals.gross)]);

  // 8 — VDS/TDS schedule ----------------------------------------------------------------------
  const schedule: Array<Array<string | number>> = [
    ['VDS and TDS schedule', periodLabel],
    ['Challan', 'Type', 'Period', 'Amount', 'Economic code', 'Deposit date', 'Status'],
  ];
  let pending = 0n;
  let deposited = 0n;
  for (const challan of state.challans) {
    schedule.push([
      challan.challan_number,
      challan.type,
      challan.period_code,
      money(challan.amount_poisha),
      challan.economic_code,
      challan.deposit_date ?? '—',
      challan.status,
    ]);
    if (challan.status === 'DEPOSITED' || challan.status === 'CERTIFIED') deposited += challan.amount_poisha;
    else pending += challan.amount_poisha;
  }
  schedule.push([], ['Total deposited', money(deposited)], ['Total pending', money(pending)]);
  schedule.push([], ['Withholding certificates (Mushak 6.6)', 'Party', 'Direction', 'Base', 'VDS', 'Status']);
  for (const doc of state.commercialDocs) {
    if (doc.vds_poisha === 0n) continue;
    schedule.push([
      doc.doc_number,
      doc.party_name_en,
      doc.doc_type === 'SALES_INVOICE' ? 'RECEIVED' : 'ISSUED',
      money(doc.base_poisha),
      money(doc.vds_poisha),
      doc.doc_type === 'SALES_INVOICE' ? 'PENDING' : 'VERIFIED',
    ]);
  }

  // 9 — Immutable GL --------------------------------------------------------------------------
  const gl: Array<Array<string | number>> = [
    ['Immutable general ledger with SHA-256 audit chain', periodLabel],
    ['Journal', 'Date', 'Book', 'Source', 'Narration', 'Line', 'Account', 'Account name', 'Debit', 'Credit', 'Audit hash', 'Previous hash'],
  ];
  for (const journal of state.journals) {
    journal.lines.forEach((line: JournalLine, index) => {
      gl.push([
        index === 0 ? journal.journal_number : '',
        index === 0 ? journal.posting_date : '',
        index === 0 ? journal.book_type : '',
        index === 0 ? journal.source_module : '',
        index === 0 ? journal.narration_en : '',
        line.line_no,
        line.account_code,
        line.account_name_en,
        money(line.debit_poisha),
        money(line.credit_poisha),
        index === 0 ? journal.audit_hash : '',
        index === 0 ? journal.prev_audit_hash : '',
      ]);
    });
  }
  const sheets = [
    { name: 'Summary', rows: summary },
    { name: 'Trial Balance', rows: trial },
    { name: 'IAS 1 Balance Sheet', rows: bs },
    { name: 'IFRS 18 P&L', rows: pl },
    { name: 'IAS 7 Cash Flows', rows: cf },
    { name: 'Mushak 6.1', rows: m61 },
    { name: 'Mushak 6.2', rows: m62 },
    { name: 'VDS-TDS Schedule', rows: schedule },
    { name: 'Immutable GL', rows: gl },
  ];

  const xmlContent = buildSpreadsheetML(sheets);
  const primaryName = `Fintuity Accounting Suite-Audit-Pack-${statements.period.code}-${tenant.persona_key}.xlsx`;
  const legacyName = `LedgerVault-Audit-Pack-${statements.period.code}-${tenant.persona_key}.xlsx`;

  downloadWorkbookFile(primaryName, xmlContent);
  if (typeof window === 'undefined') {
    downloadWorkbookFile(legacyName, xmlContent);
  }
}

const MAX_DEMO_IMPORT_BYTES = 1_000_000;
const MAX_DEMO_IMPORT_ROWS = 5_000;

async function unzipEntries(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const entries = new Map<string, string>();
  let offset = 0;
  const view = new DataView(buffer);

  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compMethod = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
    const fileName = new TextDecoder('utf-8').decode(nameBytes);
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = bytes.subarray(dataStart, dataStart + compSize);

    if (compMethod === 0) {
      entries.set(fileName, new TextDecoder('utf-8').decode(compData));
    } else if (compMethod === 8 && typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(compData);
            controller.close();
          },
        }).pipeThrough(new DecompressionStream('deflate-raw'));
        const decompressed = await new Response(stream).arrayBuffer();
        entries.set(fileName, new TextDecoder('utf-8').decode(decompressed));
      } catch {
        // ignore
      }
    }
    offset = dataStart + compSize;
  }
  return entries;
}

export function parseSpreadsheetTextToRows(text: string): string[][] {
  const trimmed = text.trim();
  if (trimmed.startsWith('<?xml') || trimmed.includes('<Workbook')) {
    const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/gi;
    const cellRegex = /<Cell[^>]*>[\s\S]*?<Data[^>]*>([\s\S]*?)<\/Data>[\s\S]*?<\/Cell>/gi;
    const rows: string[][] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(trimmed)) !== null) {
      const rowContent = rowMatch[1]!;
      const rowCells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const val = cellMatch[1]!
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        rowCells.push(val);
      }
      if (rowCells.length > 0) {
        rows.push(rowCells);
      }
    }
    return rows;
  }

  const delimiter = trimmed.includes('\t') && !trimmed.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;

  while (i < trimmed.length) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      insideQuotes = true;
      i++;
    } else if (char === delimiter) {
      currentRow.push(currentField);
      currentField = '';
      i++;
    } else if (char === '\r') {
      if (nextChar === '\n') i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
    } else if (char === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
    } else {
      currentField += char;
      i++;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function parseSpreadsheetTextToObjects(text: string): ImportSheetRow[] {
  const rows = parseSpreadsheetTextToRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const objects: ImportSheetRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.length === 0 || (row.length === 1 && row[0]?.trim() === '')) continue;
    const obj: ImportSheetRow = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c]!;
      if (key) {
        obj[key] = row[c] ?? '';
      }
    }
    objects.push(obj);
  }
  return objects;
}

export async function parseBufferToRows(buffer: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    const entries = await unzipEntries(buffer);
    const sharedStringsXml = entries.get('xl/sharedStrings.xml') ?? '';
    const sharedStrings: string[] = [];
    if (sharedStringsXml) {
      const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/gi;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(sharedStringsXml)) !== null) {
        sharedStrings.push(
          tMatch[1]!
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'"),
        );
      }
    }

    const sheetXml =
      entries.get('xl/worksheets/sheet1.xml') ??
      Array.from(entries.entries()).find(([k]) => k.startsWith('xl/worksheets/'))?.[1] ??
      '';
    if (sheetXml) {
      const rows: string[][] = [];
      const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/gi;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowContent = rMatch[1]!;
        const cells: string[] = [];
        const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
        let cMatch: RegExpExecArray | null;
        while ((cMatch = cellRegex.exec(rowContent)) !== null) {
          const attrs = cMatch[1]!;
          const body = cMatch[2]!;
          const typeMatch = /\bt="([^"]*)"/.exec(attrs);
          const type = typeMatch ? typeMatch[1] : '';

          let val = '';
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (vMatch) {
            val = vMatch[1]!;
          } else {
            const isMatch = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body);
            if (isMatch) val = isMatch[1]!;
          }

          if (type === 's') {
            const idx = parseInt(val, 10);
            val = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx]! : val;
          } else {
            val = val
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'");
          }
          cells.push(val);
        }
        if (cells.length > 0) rows.push(cells);
      }
      return rows;
    }
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  return parseSpreadsheetTextToRows(text);
}

export async function parseBufferToObjects(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const rows = await parseBufferToRows(buffer);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const objects: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.length === 0 || (row.length === 1 && row[0]?.trim() === '')) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c]!;
      if (key) obj[key] = row[c] ?? '';
    }
    objects.push(obj);
  }
  return objects;
}

/** Read an uploaded `.xlsx` / `.csv` file into plain rows. */
export async function parseImportFile(file: File): Promise<ImportSheetRow[]> {
  if (file.size > MAX_DEMO_IMPORT_BYTES) {
    throw new Error(`The import file is larger than ${Math.round(MAX_DEMO_IMPORT_BYTES / 1000)} KB.`);
  }
  const buffer = await file.arrayBuffer();
  const rows = await parseBufferToObjects(buffer);
  if (rows.length > MAX_DEMO_IMPORT_ROWS) {
    throw new Error(`The worksheet has more than ${MAX_DEMO_IMPORT_ROWS} rows.`);
  }
  return rows as ImportSheetRow[];
}

/** Build an ImportBatch record after a commit so the studio can roll it back in one click. */
export function batchRecordFromCommit(
  simulation: ImportSimulation,
  result: CommitResult,
  batchId: string,
  committedBy: string,
): ImportBatch {
  return {
    id: batchId,
    file_name: simulation.file_name,
    pipeline: simulation.pipeline,
    committed_at: new Date().toISOString(),
    committed_by: committedBy,
    row_count: simulation.valid_rows,
    journal_ids: [],
    total_debit_poisha: result.totalDebit,
    total_credit_poisha: result.totalCredit,
    output_vat_poisha: simulation.output_vat_poisha,
    input_vat_claimable_poisha: simulation.input_vat_claimable_poisha,
    vds_poisha: simulation.vds_poisha,
    tds_poisha: simulation.tds_poisha,
    status: 'COMMITTED',
  };
}
