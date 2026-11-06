// LedgerVault — Phase 2 immutable multi-book double-entry core.
//
// Four guarantees live in this module and every workspace inherits them:
//   1. A journal is posted only if it has at least two lines, at least one debit, and
//      SUM(debit_poisha) === SUM(credit_poisha) exactly (bigint, never a float).
//   2. Every posted journal is sealed into a deterministic SHA-256 hash chain computed with a pure
//      synchronous TypeScript digest — no `crypto.subtle`, no async seeding, no network. The chain
//      proves that no historical line was edited after signing.
//   3. Reversals never delete history: the original is marked REVERSED, the reversal is linked to it
//      with `reversal_of_journal_id`, and both stay in the chain.
//   4. Mushak 6.3 serials are allocated gap-free per BIN unit, but only when a sales invoice reaches
//      POSTED, so a draft or a VOID invoice can never punch a hole in the statutory book.
//
// The module also owns the document → journal bridge: `buildCommercialDoc()` asks the deterministic
// tax engine for the TaxDecision and derives the balanced DOCUMENT + SETTLEMENT journal lines from
// `previewTaxJournal()`. No rate, no VAT amount and no withholding amount is invented here.

import type {
  Account,
  AccountingPeriod,
  BankAccount,
  BookType,
  Challan,
  CommercialDoc,
  CommercialDocType,
  Currency,
  DecisionState,
  DocLine,
  DocumentLifecycleStatus,
  DocumentLineTax,
  JournalEntry,
  JournalLine,
  Party,
  PaymentMethod,
  PeriodResolution,
  SourceModule,
  SubledgerProof,
  SuspenseItem,
  TaxCategory,
  TaxCondition,
  TaxDecision,
  TaxEvaluationInput,
  TdsNature,
} from '../types';
import {
  evaluateDocumentTax,
  evaluateTaxDecision,
  lineTaxBasePoisha,
  previewTaxJournal,
  type DocumentTaxLineInput,
  type TaxDecisionDetail,
  type TaxJournalPreviewLine,
} from '../tax-engine/engine';
import { daysBetween, isoNow, periodCodeOf, sumPoisha } from '../money';
import { allocateSequence, inspectSequence } from './sequence';

// ---------------------------------------------------------------------------------------------
// Deterministic synchronous SHA-256
// ---------------------------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function utf8Bytes(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
  const out: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/**
 * Pure synchronous SHA-256 → lowercase hex. Deterministic across browsers, Node and CI runners, so
 * an audit hash computed while seeding is byte-identical to one recomputed by an external auditor.
 */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000) >>> 0, false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4, false);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** Genesis link: the chain starts from 64 zeroes so the first journal is verifiable too. */
export const GENESIS_AUDIT_HASH = '0'.repeat(64);

export function shortHash(hash: string, length = 12): string {
  if (!hash) return '';
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

// ---------------------------------------------------------------------------------------------
// Canonical line serialisation + audit hash
// ---------------------------------------------------------------------------------------------

/**
 * Canonical, order-independent-inside-the-journal string for the audit digest. Every booked fact
 * that changes money is included; memos and display names are deliberately excluded so a cosmetic
 * label edit does not break the chain (an amount or account edit does).
 */
export function canonicalLinesString(lines: ReadonlyArray<Pick<JournalLine, 'line_no' | 'account_code' | 'debit_poisha' | 'credit_poisha' | 'party_id'>>): string {
  return lines
    .slice()
    .sort((left, right) => left.line_no - right.line_no)
    .map(
      (line) =>
        `${line.line_no}|${line.account_code}|${line.debit_poisha.toString()}|${line.credit_poisha.toString()}|${line.party_id ?? ''}`,
    )
    .join(';');
}

/** `audit_hash = sha256Hex(prev_audit_hash + id + posting_date + canonicalLinesString)`. */
export function computeAuditHash(
  prevAuditHash: string,
  journal: Pick<JournalEntry, 'id' | 'posting_date' | 'lines'>,
): string {
  return sha256Hex(
    `${prevAuditHash}${journal.id}${journal.posting_date}${canonicalLinesString(journal.lines)}`,
  );
}

export interface AuditChainResult {
  valid: boolean;
  checkedCount: number;
  brokenAtId?: string;
}

/** Verify every link and every digest of the chain in posting order. */
export function verifyAuditChain(journals: readonly JournalEntry[]): AuditChainResult {
  let previous = GENESIS_AUDIT_HASH;
  let checkedCount = 0;
  for (const journal of journals) {
    if (journal.prev_audit_hash !== previous) {
      return { valid: false, checkedCount, brokenAtId: journal.id };
    }
    const expected = computeAuditHash(previous, journal);
    if (expected !== journal.audit_hash) {
      return { valid: false, checkedCount, brokenAtId: journal.id };
    }
    previous = journal.audit_hash;
    checkedCount += 1;
  }
  return { valid: true, checkedCount };
}

// ---------------------------------------------------------------------------------------------
// Journal totals + validation
// ---------------------------------------------------------------------------------------------

export function journalTotals(
  lines: ReadonlyArray<{ debit_poisha?: bigint; credit_poisha?: bigint }>,
): {
  debit_poisha: bigint;
  credit_poisha: bigint;
  balanced: boolean;
} {
  const debit = sumPoisha(lines.map((line) => line.debit_poisha ?? 0n));
  const credit = sumPoisha(lines.map((line) => line.credit_poisha ?? 0n));
  return { debit_poisha: debit, credit_poisha: credit, balanced: debit === credit };
}

export interface JournalValidationResult {
  valid: boolean;
  balanced: boolean;
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  errors: string[];
  errors_bn: string[];
}

export interface JournalValidationOptions {
  periods?: readonly AccountingPeriod[];
  accounts?: readonly Account[];
  requirePostedPeriod?: boolean;
}

/**
 * Resolve a posting date to exactly one configured period. No match is UNKNOWN, never an implicit
 * OPEN. A date must not fall between two configured periods either.
 */
export function periodStatusFor(
  periods: readonly AccountingPeriod[] | undefined,
  postingDate: string,
): PeriodResolution {
  if (!periods || periods.length === 0) return 'UNKNOWN';
  const code = periodCodeOf(postingDate);
  const period =
    periods.find((entry) => entry.code === code) ??
    periods.find((entry) => postingDate >= entry.start_date && postingDate <= entry.end_date);
  return period ? period.status : 'UNKNOWN';
}

/** True for a configured CLOSED or LOCKED period. Kept for compatibility with older callers. */
export function isPeriodLocked(periods: readonly AccountingPeriod[] | undefined, postingDate: string): boolean {
  const status = periodStatusFor(periods, postingDate);
  return status === 'CLOSED' || status === 'LOCKED';
}

export function isPeriodPostable(periods: readonly AccountingPeriod[] | undefined, postingDate: string): boolean {
  return periodStatusFor(periods, postingDate) === 'OPEN';
}

export function validateJournal(
  journal: Pick<JournalEntry, 'lines' | 'posting_date' | 'book_type'> &
    Partial<Pick<JournalEntry, 'journal_number' | 'narration_en'>>,
  options: JournalValidationOptions = {},
): JournalValidationResult {
  const errors: string[] = [];
  const errorsBn: string[] = [];
  const totals = journalTotals(journal.lines);

  if (journal.lines.length < 2) {
    errors.push('A journal needs at least two lines.');
    errorsBn.push('একটি জার্নালে অন্তত দুইটি লাইন থাকতে হবে।');
  }
  if (totals.debit_poisha <= 0n) {
    errors.push('A journal must carry a positive debit total.');
    errorsBn.push('জার্নালের মোট ডেবিট ধনাত্মক হতে হবে।');
  }
  if (!totals.balanced) {
    errors.push(
      `Journal is unbalanced: debit ${totals.debit_poisha.toString()} poisha vs credit ${totals.credit_poisha.toString()} poisha.`,
    );
    errorsBn.push(
      `জার্নাল অসুষম: ডেবিট ${totals.debit_poisha.toString()} পয়সা বনাম ক্রেডিট ${totals.credit_poisha.toString()} পয়সা।`,
    );
  }

  for (const line of journal.lines) {
    const debit = line.debit_poisha ?? 0n;
    const credit = line.credit_poisha ?? 0n;
    if (debit < 0n || credit < 0n) {
      errors.push(`Line ${line.line_no} carries a negative amount. Use the opposite side instead.`);
      errorsBn.push(`লাইন ${line.line_no}-এ ঋণাত্মক অঙ্ক আছে। বিপরীত দিকে বসান।`);
    }
    if (debit > 0n && credit > 0n) {
      errors.push(`Line ${line.line_no} holds both a debit and a credit amount.`);
      errorsBn.push(`লাইন ${line.line_no}-এ ডেবিট ও ক্রেডিট দুইটিই আছে।`);
    }
    if (debit === 0n && credit === 0n) {
      errors.push(`Line ${line.line_no} is empty.`);
      errorsBn.push(`লাইন ${line.line_no} শূন্য।`);
    }
    if (!line.account_code) {
      errors.push(`Line ${line.line_no} has no account code.`);
      errorsBn.push(`লাইন ${line.line_no}-এ হিসাব কোড নেই।`);
    }
  }

  if (options.accounts && options.accounts.length > 0) {
    const known = new Set(options.accounts.map((account) => account.code));
    for (const line of journal.lines) {
      if (line.account_code && !known.has(line.account_code)) {
        errors.push(`Account ${line.account_code} is not in the chart of accounts.`);
        errorsBn.push(`হিসাব ${line.account_code} হিসাব তালিকায় নেই।`);
      }
    }
  }

  if (options.periods) {
    const status = periodStatusFor(options.periods, journal.posting_date);
    if (status !== 'OPEN') {
      const label = status === 'UNKNOWN' ? 'not configured' : status;
      errors.push(`The period for ${journal.posting_date} is ${label} and cannot accept postings.`);
      errorsBn.push(
        status === 'UNKNOWN'
          ? `${journal.posting_date} তারিখের কোনো হিসাবকাল কনফিগার করা নেই, পোস্টিং গ্রহণ করা যাবে না।`
          : `${journal.posting_date} মেয়াদের হিসাব ${status} এবং পোস্টিং গ্রহণ করা যাবে না।`,
      );
    }
  } else if (options.requirePostedPeriod) {
    errors.push(`No accounting period is configured for ${journal.posting_date}.`);
    errorsBn.push(`${journal.posting_date} তারিখের কোনো হিসাবকাল কনফিগার করা নেই।`);
  }

  return {
    valid: errors.length === 0,
    balanced: totals.balanced,
    total_debit_poisha: totals.debit_poisha,
    total_credit_poisha: totals.credit_poisha,
    errors,
    errors_bn: errorsBn,
  };
}

// ---------------------------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------------------------

export interface JournalLineDraft {
  account_code: string;
  debit_poisha?: bigint;
  credit_poisha?: bigint;
  account_name_en?: string;
  account_name_bn?: string;
  party_id?: string;
  party_name?: string;
  cost_center?: string;
  project_code?: string;
  memo?: string;
}

export interface JournalDraft {
  id?: string;
  journal_number?: string;
  book_type: BookType;
  bin_unit_id: string;
  period_code?: string;
  document_date: string;
  posting_date?: string;
  tax_point_date?: string;
  due_date?: string;
  source_module: SourceModule;
  source_doc_id?: string;
  source_doc_ref?: string;
  import_batch_id?: string;
  narration_en: string;
  narration_bn: string;
  currency?: Currency;
  exchange_rate_bps?: number;
  status?: DocumentLifecycleStatus;
  idempotency_key?: string;
  rule_pack_version?: string;
  tax_decision_trace_id?: string;
  reversal_of_journal_id?: string;
  reversed_by_journal_id?: string;
  reversal_reason?: string;
  created_by: string;
  approved_by?: string;
  posted_at?: string;
  lines: JournalLineDraft[];
}

export interface JournalPostContext {
  journals: readonly JournalEntry[];
  periods?: readonly AccountingPeriod[];
  accounts?: readonly Account[];
  actor?: string;
  now?: string;
}

export class JournalPostingError extends Error {
  readonly code:
    | 'UNBALANCED'
    | 'TOO_FEW_LINES'
    | 'NO_DEBIT'
    | 'PERIOD_UNKNOWN'
    | 'PERIOD_CLOSED'
    | 'PERIOD_LOCKED'
    | 'UNKNOWN_ACCOUNT'
    | 'EMPTY'
    | 'DUPLICATE_JOURNAL'
    | 'DUPLICATE_JOURNAL_ID'
    | 'REVERSAL_ALREADY_REVERSED'
    | 'REVERSAL_OF_REVERSAL';

  constructor(code: JournalPostingError['code'], message: string) {
    super(message);
    this.name = 'JournalPostingError';
    this.code = code;
  }
}

function journalBookTag(book: BookType): string {
  return book === 'STATUTORY_BD' ? 'JE' : book === 'IFRS_GROUP_ADJ' ? 'IF' : book === 'TAX_COMPUTATION' ? 'TX' : 'MG';
}

export function journalNumberPrefix(postingDate: string, book: BookType): string {
  return `${journalBookTag(book)}-${periodCodeOf(postingDate)}`;
}

/**
 * Next sequential journal number for a book + period. The pure allocator uses the highest issued
 * number, never the number of rows, so deleting an unrelated row cannot renumber the ledger.
 */
export function nextJournalNumber(
  journals: readonly JournalEntry[],
  postingDate: string,
  book: BookType,
): string {
  return allocateSequence({
    series: 'JOURNAL',
    scope: book,
    period: periodCodeOf(postingDate),
    prefix: journalBookTag(book),
    used_numbers: journals.map((journal) => journal.journal_number),
  }).number;
}

const DOCUMENT_PREFIX: Record<CommercialDocType, string> = {
  SALES_INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  PURCHASE_BILL: 'PB',
  EXPENSE_VOUCHER: 'PV',
  IMPORTED_SERVICE: 'IMP',
};

/**
 * Next commercial document number in its own series/scope/period. Credit notes therefore never
 * consume a sales-invoice sequence and a deleted row never causes a number to be reused.
 */
export function nextCommercialDocNumber(
  docs: readonly CommercialDoc[],
  docType: CommercialDocType,
  docDate: string,
  binUnitId: string,
): string {
  return allocateSequence({
    series: docType,
    scope: binUnitId,
    period: docDate.slice(0, 7),
    prefix: DOCUMENT_PREFIX[docType],
    used_numbers: docs
      .filter((doc) => doc.doc_type === docType && doc.bin_unit_id === binUnitId)
      .map((doc) => doc.doc_number),
  }).number;
}

function accountNames(
  code: string,
  accounts: readonly Account[] | undefined,
  draft: JournalLineDraft,
): { name_en: string; name_bn: string } {
  if (draft.account_name_en && draft.account_name_bn) {
    return { name_en: draft.account_name_en, name_bn: draft.account_name_bn };
  }
  const account = accounts?.find((entry) => entry.code === code);
  return {
    name_en: draft.account_name_en ?? account?.name_en ?? `Account ${code}`,
    name_bn: draft.account_name_bn ?? account?.name_bn ?? `হিসাব ${code}`,
  };
}

/**
 * Post a journal into the live chain. Deterministic and synchronous: the audit hash is computed at
 * the moment of posting so seeding, runtime entry and imports all produce identical chains.
 */
export function postJournal(draft: JournalDraft, context: JournalPostContext): JournalEntry {
  if (draft.idempotency_key) {
    const existing = context.journals.find((journal) => journal.idempotency_key === draft.idempotency_key);
    if (existing) return existing;
  }

  const postingDate = draft.posting_date ?? draft.document_date;
  const periodStatus = periodStatusFor(context.periods, postingDate);
  if (periodStatus !== 'OPEN') {
    const periodCode = periodCodeOf(postingDate);
    if (periodStatus === 'UNKNOWN') {
      throw new JournalPostingError(
        'PERIOD_UNKNOWN',
        `No accounting period is configured for ${postingDate}. Posting was rejected.`,
      );
    }
    throw new JournalPostingError(
      periodStatus === 'CLOSED' ? 'PERIOD_CLOSED' : 'PERIOD_LOCKED',
      `Cannot post ${draft.journal_number ?? draft.id ?? 'journal'} into the ${periodStatus} period ${periodCode}.`,
    );
  }

  const lines: JournalLine[] = draft.lines.map((line, index) => {
    const names = accountNames(line.account_code, context.accounts, line);
    return {
      id: `${draft.id ?? draft.journal_number ?? 'JRN'}-L${String(index + 1).padStart(2, '0')}`,
      line_no: index + 1,
      account_code: line.account_code,
      account_name_en: names.name_en,
      account_name_bn: names.name_bn,
      party_id: line.party_id,
      party_name: line.party_name,
      cost_center: line.cost_center,
      project_code: line.project_code,
      debit_poisha: line.debit_poisha ?? 0n,
      credit_poisha: line.credit_poisha ?? 0n,
      memo: line.memo,
    };
  });

  if (lines.length === 0) {
    throw new JournalPostingError('EMPTY', 'A journal needs at least two lines.');
  }
  if (lines.length < 2) {
    throw new JournalPostingError('TOO_FEW_LINES', 'A journal needs at least two lines.');
  }
  const totals = journalTotals(lines);
  if (totals.debit_poisha <= 0n) {
    throw new JournalPostingError('NO_DEBIT', 'A journal must carry a positive debit total.');
  }
  if (!totals.balanced) {
    throw new JournalPostingError(
      'UNBALANCED',
      `Unbalanced journal: debit ${totals.debit_poisha.toString()} vs credit ${totals.credit_poisha.toString()} poisha.`,
    );
  }
  if (context.accounts && context.accounts.length > 0) {
    const known = new Set(context.accounts.map((account) => account.code));
    for (const line of lines) {
      if (!known.has(line.account_code)) {
        throw new JournalPostingError(
          'UNKNOWN_ACCOUNT',
          `Account ${line.account_code} is not in the chart of accounts.`,
        );
      }
    }
  }

  if (draft.id && context.journals.some((journal) => journal.id === draft.id)) {
    throw new JournalPostingError(
      'DUPLICATE_JOURNAL_ID',
      `Journal id ${draft.id} already exists. A posted journal is immutable; use a reversal instead.`,
    );
  }

  const journalNumber =
    draft.journal_number ??
    nextJournalNumber(context.journals, postingDate, draft.book_type);
  if (context.journals.some((journal) => journal.journal_number === journalNumber)) {
    throw new JournalPostingError(
      'DUPLICATE_JOURNAL',
      `Journal number ${journalNumber} already exists. Sequence allocation must never reuse a number.`,
    );
  }
  const id = draft.id ?? `${journalNumber}::${draft.book_type}`;
  const previous = context.journals.length
    ? context.journals[context.journals.length - 1].audit_hash
    : GENESIS_AUDIT_HASH;

  const unsigned = {
    id,
    journal_number: journalNumber,
    book_type: draft.book_type,
    bin_unit_id: draft.bin_unit_id,
    period_code: draft.period_code ?? periodCodeOf(postingDate),
    document_date: draft.document_date,
    posting_date: postingDate,
    tax_point_date: draft.tax_point_date ?? draft.document_date,
    due_date: draft.due_date,
    source_module: draft.source_module,
    source_doc_id: draft.source_doc_id,
    source_doc_ref: draft.source_doc_ref,
    import_batch_id: draft.import_batch_id,
    narration_en: draft.narration_en,
    narration_bn: draft.narration_bn,
    currency: draft.currency ?? ('BDT' as Currency),
    exchange_rate_bps: draft.exchange_rate_bps ?? 10000,
    status: draft.status ?? ('POSTED' as DocumentLifecycleStatus),
    idempotency_key:
      draft.idempotency_key ?? `${journalNumber}|${draft.book_type}|${context.actor ?? draft.created_by}`,
    rule_pack_version: draft.rule_pack_version,
    tax_decision_trace_id: draft.tax_decision_trace_id,
    reversal_of_journal_id: draft.reversal_of_journal_id,
    reversed_by_journal_id: draft.reversed_by_journal_id,
    reversal_reason: draft.reversal_reason,
    created_by: draft.created_by,
    approved_by: draft.approved_by,
    posted_at: draft.posted_at ?? context.now ?? isoNow(),
    lines,
  } satisfies Omit<JournalEntry, 'audit_hash' | 'prev_audit_hash'>;

  const auditHash = computeAuditHash(previous, unsigned);

  return { ...unsigned, prev_audit_hash: previous, audit_hash: auditHash };
}

/**
 * Linked reversal. Swaps every debit for a credit (and vice versa), keeps the original in the chain,
 * marks it REVERSED and records the two-way link plus the reason.
 */
export function createReversalJournal(
  originalJournal: JournalEntry,
  reason: string,
  reversalDate: string,
  actor: string,
  context?: JournalPostContext,
): { original: JournalEntry; reversal: JournalEntry } {
  if (originalJournal.reversal_of_journal_id) {
    throw new JournalPostingError(
      'REVERSAL_OF_REVERSAL',
      `Journal ${originalJournal.journal_number} is itself a reversal. Post a new correcting document instead of reversing it.`,
    );
  }

  const journals = context?.journals ?? [originalJournal];
  const accounts = context?.accounts;
  const existingReversal = journals.find(
    (journal) => journal.reversal_of_journal_id === originalJournal.id,
  );
  if (originalJournal.status === 'REVERSED' || originalJournal.reversed_by_journal_id) {
    throw new JournalPostingError(
      'REVERSAL_ALREADY_REVERSED',
      `Journal ${originalJournal.journal_number} has already been reversed${originalJournal.reversed_by_journal_id ? ` by ${originalJournal.reversed_by_journal_id}` : ''}.`,
    );
  }
  if (existingReversal) {
    // A retry with a stale in-memory copy of the original is idempotent: return the reversal that
    // is already in the chain instead of appending a duplicate.
    return {
      original: {
        ...originalJournal,
        status: 'REVERSED',
        reversed_by_journal_id: existingReversal.id,
        reversal_reason: existingReversal.reversal_reason ?? reason,
      },
      reversal: existingReversal,
    };
  }

  const lines: JournalLineDraft[] = originalJournal.lines.map((line) => ({
    account_code: line.account_code,
    account_name_en: line.account_name_en,
    account_name_bn: line.account_name_bn,
    debit_poisha: line.credit_poisha,
    credit_poisha: line.debit_poisha,
    party_id: line.party_id,
    party_name: line.party_name,
    cost_center: line.cost_center,
    project_code: line.project_code,
    memo: `Reversal of ${originalJournal.journal_number}`,
  }));

  const reversal = postJournal(
    {
      id: `${originalJournal.id}::REV`,
      journal_number: nextJournalNumber(journals, reversalDate, originalJournal.book_type),
      book_type: originalJournal.book_type,
      bin_unit_id: originalJournal.bin_unit_id,
      document_date: reversalDate,
      posting_date: reversalDate,
      tax_point_date: reversalDate,
      source_module: 'REVERSAL',
      source_doc_id: originalJournal.source_doc_id,
      source_doc_ref: originalJournal.source_doc_ref,
      narration_en: `Reversal of ${originalJournal.journal_number} — ${reason}`,
      narration_bn: `${originalJournal.journal_number} বাতিল — ${reason}`,
      status: 'POSTED',
      idempotency_key: `REVERSAL|${originalJournal.id}|${reversalDate}`,
      reversal_of_journal_id: originalJournal.id,
      reversal_reason: reason,
      created_by: actor,
      approved_by: actor,
      lines,
    },
    {
      journals,
      periods: context?.periods,
      accounts,
      actor,
      now: context?.now,
    },
  );

  return {
    original: {
      ...originalJournal,
      status: 'REVERSED',
      reversed_by_journal_id: reversal.id,
      reversal_reason: reason,
    },
    reversal,
  };
}

// ---------------------------------------------------------------------------------------------
// Gap-free Mushak 6.3 serial allocator (per BIN unit)
// ---------------------------------------------------------------------------------------------

const MUSHak63_PATTERN = /^M63-(\d{4})-(\d{5})$/;

export interface Mushak63SequenceState {
  bin_unit_id: string;
  year: string;
  last_sequence: number;
  next_sequence: number;
  next_serial: string;
  gap_free: boolean;
  missing_sequences: number[];
  duplicate_serials: string[];
}

function mushak63Sequence(serial: string | undefined, year: string): number | null {
  if (!serial) return null;
  const match = MUSHak63_PATTERN.exec(serial.trim());
  if (!match) return null;
  if (match[1] !== year) return null;
  return Number(match[2]);
}

/**
 * Allocate the next gap-free serial for a BIN unit. Only POSTED (or later) sales invoices consume a
 * serial, so drafts and void documents never punch a hole in the statutory series.
 */
export function allocateMushak63Serial(
  binUnitId: string,
  existingDocs: readonly CommercialDoc[],
  year: string,
): string {
  if (!/^\d{4}$/.test(year)) {
    throw new Error(`Mushak 6.3 allocation needs an explicit four-digit year, received "${year}".`);
  }
  const usedSerials = existingDocs
    .filter(
      (doc) =>
        doc.bin_unit_id === binUnitId &&
        doc.doc_type === 'SALES_INVOICE' &&
        doc.status !== 'DRAFT' &&
        doc.status !== 'SUBMITTED' &&
        doc.status !== 'APPROVED',
    )
    .map((doc) => doc.mushak_serial)
    .filter((serial): serial is string => Boolean(serial));
  return allocateSequence({
    series: 'MUSHAK_63',
    scope: binUnitId,
    period: year,
    prefix: 'M63',
    used_numbers: usedSerials,
    width: 5,
  }).number;
}

/** Audit the statutory series for gaps and duplicates — surfaced on the compliance dashboard. */
export function inspectMushak63Sequence(
  binUnitId: string,
  existingDocs: readonly CommercialDoc[],
  year: string,
): Mushak63SequenceState {
  const used: number[] = [];
  const serials: string[] = [];
  for (const doc of existingDocs) {
    if (doc.bin_unit_id !== binUnitId || doc.doc_type !== 'SALES_INVOICE') continue;
    if (doc.status === 'DRAFT' || doc.status === 'SUBMITTED' || doc.status === 'APPROVED') continue;
    if (!doc.mushak_serial) continue;
    const sequence = mushak63Sequence(doc.mushak_serial, year);
    if (sequence === null) continue;
    used.push(sequence);
    serials.push(doc.mushak_serial);
  }
  const audit = inspectSequence({
    series: 'MUSHAK_63',
    scope: binUnitId,
    period: year,
    prefix: 'M63',
    used_numbers: serials,
    width: 5,
  });
  return {
    bin_unit_id: binUnitId,
    year,
    last_sequence: audit.last_value,
    next_sequence: audit.next_value,
    next_serial: `M63-${year}-${String(audit.next_value).padStart(5, '0')}`,
    gap_free: audit.gap_free,
    missing_sequences: audit.missing_values,
    duplicate_serials: audit.duplicate_values.map((value) => `M63-${year}-${String(value).padStart(5, '0')}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Document → tax decision → balanced journal lines
// ---------------------------------------------------------------------------------------------

/** A CommercialDoc enriched with the deterministic tax evidence that produced it. */
export interface TaxAnnotatedDoc extends CommercialDoc {
  tax_decision_state: DecisionState;
  tax_claimable_poisha: bigint;
  tax_disallowed_poisha: bigint;
  tax_trace_id: string;
  tax_rule_ids: string[];
  tax_citations: string[];
  tax_explanations_en: string[];
  tax_explanations_bn: string[];
  tax_conditions: TaxCondition[];
  vat_bps: number;
  vds_bps: number;
  tds_bps: number;
  reverse_charge_challan_held: boolean;
  settlement_journal_id?: string;
  document_journal_id?: string;
}

export interface DocumentTaxOptions {
  tenant_is_withholding_entity?: boolean;
  evaluated_at?: string;
}

/** Map a stored commercial document back to the exact facts the tax engine evaluated. */
export function documentTaxInput(
  doc: CommercialDoc,
  party?: Party | null,
  options: DocumentTaxOptions = {},
): TaxEvaluationInput {
  const direction: 'SALE' | 'PURCHASE' =
    doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE' ? 'SALE' : 'PURCHASE';
  const tenantWithholding = options.tenant_is_withholding_entity ?? true;
  const isSale = direction === 'SALE';
  const partyBin = doc.party_bin ?? party?.bin;
  const partyTin = doc.party_tin ?? party?.tin;
  return {
    direction,
    base_poisha: doc.base_poisha < 0n ? -doc.base_poisha : doc.base_poisha,
    tax_category: doc.tax_category,
    party_name: doc.party_name_en,
    party_bin: partyBin,
    party_tin: partyTin,
    is_withholding_entity: isSale ? Boolean(party?.is_withholding_buyer) : tenantWithholding,
    vds_applicable: doc.vds_poisha !== 0n,
    tds_nature: doc.tds_nature,
    payment_method: doc.payment_method,
    has_valid_mushak63: Boolean(doc.mushak63_ref) || isSale,
    is_reverse_charge: doc.reverse_charge,
    has_reverse_charge_challan: (doc as Partial<TaxAnnotatedDoc>).reverse_charge_challan_held ?? false,
    sd_applicable: doc.sd_poisha !== 0n,
    is_credit_note: doc.doc_type === 'CREDIT_NOTE',
    is_government_or_bank: Boolean(party?.is_government),
    period_end_date: doc.doc_date.slice(0, 7),
    rule_pack_version: doc.reference_no?.startsWith('RP:') ? doc.reference_no.slice(3) : undefined,
  };
}

export interface DocumentTaxOutcome {
  decision: TaxDecisionDetail;
  input: TaxEvaluationInput;
  claimable_poisha: bigint;
  disallowed_poisha: bigint;
  trace_id: string;
  state: TaxDecision['decision'];
  rule_ids: string[];
  direction: 'SALE' | 'PURCHASE';
}

/** Single source of truth for "what tax did this document carry, and why". */
export function documentTaxOutcome(
  doc: CommercialDoc,
  party?: Party | null,
  options: DocumentTaxOptions = {},
): DocumentTaxOutcome {
  const input = documentTaxInput(doc, party, options);
  const lineInputs: DocumentTaxLineInput[] = doc.lines.map((line) => ({
    id: line.id,
    sku: line.sku,
    quantity: line.quantity,
    unit_price_poisha: line.unit_price_poisha,
    tax_category: line.tax_category ?? doc.tax_category,
  }));
  const decision =
    lineInputs.length > 0
      ? evaluateDocumentTax(
          {
            ...input,
            lines: lineInputs,
            fallback_tax_category: doc.tax_category,
          },
          options.evaluated_at ? { evaluatedAt: options.evaluated_at } : {},
        ).decision
      : evaluateTaxDecision(
          input,
          options.evaluated_at ? { evaluatedAt: options.evaluated_at } : {},
        );
  const sign = doc.doc_type === 'CREDIT_NOTE' ? -1n : 1n;
  const claimable = sign * decision.input_credit.claimable_poisha;
  const disallowed = sign * decision.input_credit.disallowed_poisha;
  return {
    decision,
    input,
    claimable_poisha: claimable < 0n ? -claimable : claimable,
    disallowed_poisha: disallowed < 0n ? -disallowed : disallowed,
    trace_id: decision.trace_id,
    state: decision.decision,
    rule_ids: decision.rule_ids,
    direction: input.direction,
  };
}

export interface CommercialDocSpec {
  doc_type: CommercialDocType;
  doc_number: string;
  doc_date: string;
  due_date: string;
  party: Party;
  bin_unit_id: string;
  lines: DocLine[];
  base_poisha: bigint;
  tax_category: TaxCategory;
  tds_nature: TdsNature;
  payment_method: PaymentMethod;
  narration_en: string;
  narration_bn: string;
  reverse_charge?: boolean;
  reverse_charge_challan_held?: boolean;
  /** VDS applies to services and to supplies bought by a designated withholding entity. */
  vds_applicable?: boolean;
  /** Supplementary duty is line-level: only standard-rated Second Schedule lines carry it. */
  sd_applicable?: boolean;
  book_type?: BookType;
  created_by?: string;
  mushak_serial?: string;
  reference_no?: string;
  status?: DocumentLifecycleStatus;
  settled_poisha?: bigint;
  vehicle_no?: string;
  destination?: string;
  payment_channel?: string;
  /** Mushak 6.7 credit notes carry their own series and point at the invoice they correct. */
  original_doc_id?: string;
  original_doc_number?: string;
  /** Redirect the COST leg (e.g. 1310 Inventory or 5310 Consultancy) away from 5100 COGS. */
  cost_account_code?: string;
  cost_account_name_en?: string;
  cost_account_name_bn?: string;
  /** Redirect the revenue leg (e.g. 4200 Sales Returns for a Mushak 6.7 credit note). */
  revenue_account_code?: string;
  revenue_account_name_en?: string;
  revenue_account_name_bn?: string;
  tenant_is_withholding_entity?: boolean;
  is_credit_note?: boolean;
  evaluated_at?: string;
}

export interface BuiltCommercialDoc {
  doc: TaxAnnotatedDoc;
  decision: TaxDecisionDetail;
  input: TaxEvaluationInput;
  document_lines: JournalLineDraft[];
  settlement_lines: JournalLineDraft[];
}

/** Convert signed preview lines into a debit/credit-safe journal draft payload. */
export function normalisePreviewLines(
  lines: ReadonlyArray<TaxJournalPreviewLine>,
): JournalLineDraft[] {
  return lines.map((line) => {
    let debit = line.debit_poisha;
    let credit = line.credit_poisha;
    if (debit < 0n) {
      credit += -debit;
      debit = 0n;
    }
    if (credit < 0n) {
      debit += -credit;
      credit = 0n;
    }
    return {
      account_code: line.account_code,
      account_name_en: line.account_name_en,
      account_name_bn: line.account_name_bn,
      debit_poisha: debit,
      credit_poisha: credit,
      memo: line.memo_en,
    };
  });
}

/**
 * Build a commercial document from its commercial facts. The tax engine supplies every amount, so a
 * seeded invoice, a UI-entered invoice and an imported invoice can never disagree.
 */
export function buildCommercialDoc(spec: CommercialDocSpec): BuiltCommercialDoc {
  const direction: 'SALE' | 'PURCHASE' =
    spec.doc_type === 'SALES_INVOICE' || spec.doc_type === 'CREDIT_NOTE' ? 'SALE' : 'PURCHASE';
  const party = spec.party;
  const isSale = direction === 'SALE';
  const input: TaxEvaluationInput = {
    direction,
    base_poisha: spec.base_poisha,
    tax_category: spec.tax_category,
    party_name: party.name_en,
    party_bin: party.bin,
    party_tin: party.tin,
    is_withholding_entity: isSale
      ? party.is_withholding_buyer
      : (spec.tenant_is_withholding_entity ?? true),
    vds_applicable: spec.vds_applicable ?? (isSale ? party.is_withholding_buyer : false),
    tds_nature: spec.tds_nature,
    payment_method: spec.payment_method,
    has_valid_mushak63: isSale ? true : Boolean(spec.mushak_serial),
    is_reverse_charge: Boolean(spec.reverse_charge),
    has_reverse_charge_challan: Boolean(spec.reverse_charge_challan_held),
    sd_applicable: Boolean(spec.sd_applicable),
    is_credit_note: Boolean(spec.is_credit_note) || spec.doc_type === 'CREDIT_NOTE',
    is_government_or_bank: party.is_government,
    period_end_date: spec.doc_date.slice(0, 7),
  };

  // The lines are authoritative. A caller-supplied base that disagrees with the lines is rejected
  // rather than trusted, so a preview and a posted total can never silently diverge.
  const derivedBase = spec.lines.reduce((total, line) => total + lineTaxBasePoisha(line), 0n);
  if (derivedBase !== spec.base_poisha) {
    throw new Error(
      `Document ${spec.doc_number} base ${spec.base_poisha.toString()} poisha does not match its line total ${derivedBase.toString()} poisha.`,
    );
  }
  if (derivedBase <= 0n) {
    throw new Error(`Document ${spec.doc_number} needs at least one priced line.`);
  }

  const lineInputs: DocumentTaxLineInput[] = spec.lines.map((line) => ({
    id: line.id,
    sku: line.sku,
    quantity: line.quantity,
    unit_price_poisha: line.unit_price_poisha,
    tax_category: line.tax_category ?? spec.tax_category,
  }));
  const summary = evaluateDocumentTax(
    {
      ...input,
      lines: lineInputs,
      fallback_tax_category: spec.tax_category,
    },
    spec.evaluated_at ? { evaluatedAt: spec.evaluated_at } : {},
  );
  const decision = summary.decision;
  const preview = previewTaxJournal(input, decision);
  const sign = input.is_credit_note ? -1n : 1n;
  const abs = (value: bigint): bigint => (value < 0n ? -value : value);
  const lineTax: DocumentLineTax[] = summary.lines.map((line) => ({
    line_id: line.line_id,
    sku: line.sku,
    tax_category: line.tax_category,
    base_poisha: line.base_poisha,
    sd_poisha: line.sd_poisha,
    vat_poisha: line.vat_poisha,
    gross_poisha: line.gross_poisha,
    vds_poisha: line.vds_poisha,
    tds_poisha: line.tds_poisha,
    net_payable_poisha: line.net_payable_poisha,
    claimable_poisha: line.claimable_poisha,
    disallowed_poisha: line.disallowed_poisha,
    decision_state: line.decision_state,
    trace_id: line.trace_id,
  }));

  const documentLines = normalisePreviewLines(
    preview.groups.find((group) => group.id === 'DOCUMENT')?.lines ?? [],
  );
  const settlementLines = normalisePreviewLines(
    preview.groups.find((group) => group.id === 'SETTLEMENT')?.lines ?? [],
  );

  if (spec.cost_account_code) {
    for (const line of [...documentLines, ...settlementLines]) {
      if (line.account_code === '5100') {
        line.account_code = spec.cost_account_code;
        line.account_name_en = spec.cost_account_name_en ?? line.account_name_en;
        line.account_name_bn = spec.cost_account_name_bn ?? line.account_name_bn;
      }
    }
  }

  if (spec.revenue_account_code) {
    for (const line of [...documentLines, ...settlementLines]) {
      if (line.account_code === '4100' || line.account_code === '4110' || line.account_code === '4120') {
        line.account_code = spec.revenue_account_code;
        line.account_name_en = spec.revenue_account_name_en ?? line.account_name_en;
        line.account_name_bn = spec.revenue_account_name_bn ?? line.account_name_bn;
      }
    }
  }

  const doc: TaxAnnotatedDoc = {
    id: `DOC-${spec.doc_number}`,
    doc_type: spec.doc_type,
    doc_number: spec.doc_number,
    mushak_serial: spec.mushak_serial,
    doc_date: spec.doc_date,
    due_date: spec.due_date,
    party_id: party.id,
    party_name_en: party.name_en,
    party_name_bn: party.name_bn,
    party_bin: party.bin,
    party_tin: party.tin,
    bin_unit_id: spec.bin_unit_id,
    lines: spec.lines,
    line_tax: lineTax,
    tax_categories: Array.from(new Set(spec.lines.map((line) => line.tax_category))),
    base_poisha: abs(sign * decision.base_poisha),
    sd_poisha: abs(sign * decision.sd_poisha),
    vat_poisha: abs(sign * decision.vat_poisha),
    vds_poisha: abs(sign * decision.vds_poisha),
    tds_poisha: abs(sign * decision.tds_poisha),
    gross_poisha: abs(sign * decision.gross_poisha),
    net_payable_poisha: abs(sign * decision.net_payable_poisha),
    tax_category: spec.tax_category,
    tds_nature: spec.tds_nature,
    payment_method: spec.payment_method,
    status: spec.status ?? 'POSTED',
    narration_en: spec.narration_en,
    narration_bn: spec.narration_bn,
    mushak63_ref:
      spec.doc_type === 'SALES_INVOICE' ? spec.doc_number : spec.mushak_serial,
    reverse_charge: Boolean(spec.reverse_charge),
    original_doc_id: spec.original_doc_id,
    original_doc_number: spec.original_doc_number,
    reference_no: spec.reference_no,
    vehicle_no: spec.vehicle_no,
    destination: spec.destination,
    payment_channel: spec.payment_channel,
    created_by: spec.created_by ?? 'farzana',
    created_at: `${spec.doc_date}T10:00:00.000+06:00`,
    settled_poisha: spec.settled_poisha ?? 0n,
    book_type: spec.book_type ?? 'STATUTORY_BD',
    tax_decision_state: decision.decision,
    tax_claimable_poisha: abs(sign * decision.input_credit.claimable_poisha),
    tax_disallowed_poisha: abs(sign * decision.input_credit.disallowed_poisha),
    tax_trace_id: decision.trace_id,
    tax_rule_ids: decision.rule_ids,
    tax_citations: decision.citations,
    tax_explanations_en: decision.explanations_en,
    tax_explanations_bn: decision.explanations_bn,
    tax_conditions: decision.conditions,
    vat_bps: decision.vat_bps,
    vds_bps: decision.vds_bps,
    tds_bps: decision.tds_bps,
    reverse_charge_challan_held: Boolean(spec.reverse_charge_challan_held),
  };

  return { doc, decision, input, document_lines: documentLines, settlement_lines: settlementLines };
}

// ---------------------------------------------------------------------------------------------
// Explicit settlement command
// ---------------------------------------------------------------------------------------------

export class SettlementError extends Error {
  readonly code:
    | 'DOCUMENT_NOT_FOUND'
    | 'DOCUMENT_NOT_POSTED'
    | 'ALREADY_SETTLED'
    | 'NOTHING_OUTSTANDING'
    | 'CREDIT_NOTE_NOT_SETTLEABLE'
    | 'PARTIAL_SETTLEMENT_NOT_SUPPORTED'
    | 'BANK_ACCOUNT_REQUIRED';

  constructor(code: SettlementError['code'], message: string) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
  }
}

export interface SettlementRequest {
  settlement_date: string;
  bank_account_code: string;
  actor: string;
  /** Optional assertion: settlement is full-only in Phase 1, so this must equal the outstanding. */
  amount_poisha?: bigint;
  journal_number?: string;
}

export interface SettlementResult<T extends CommercialDoc> {
  doc: T;
  journal: JournalEntry;
}

/** The balanced receipt/payment legs for a posted document, using its stored withholding facts. */
export function settlementJournalLines(
  doc: CommercialDoc,
  bankAccountCode: string,
): JournalLineDraft[] {
  if (doc.doc_type === 'CREDIT_NOTE') {
    throw new SettlementError(
      'CREDIT_NOTE_NOT_SETTLEABLE',
      'A credit note reduces a receivable; it is not settled by a separate receipt.',
    );
  }
  const bankAmount = doc.gross_poisha - doc.vds_poisha - doc.tds_poisha;
  const isSale = doc.doc_type === 'SALES_INVOICE';
  const lines: JournalLineDraft[] = [];

  if (isSale) {
    lines.push(
      {
        account_code: bankAccountCode,
        debit_poisha: bankAmount,
        party_id: doc.party_id,
        party_name: doc.party_name_en,
        memo: `Customer receipt net of withholding — ${doc.doc_number}`,
      },
      ...(doc.vds_poisha > 0n
        ? [
            {
              account_code: '1145',
              debit_poisha: doc.vds_poisha,
              party_id: doc.party_id,
              party_name: doc.party_name_en,
              memo: `Customer VDS receivable — Mushak 6.6 pending (${doc.doc_number})`,
            },
          ]
        : []),
      ...(doc.tds_poisha > 0n
        ? [
            {
              account_code: '1150',
              debit_poisha: doc.tds_poisha,
              party_id: doc.party_id,
              party_name: doc.party_name_en,
              memo: `Customer TDS / AIT credit — ${doc.doc_number}`,
            },
          ]
        : []),
      {
        account_code: '1210',
        credit_poisha: doc.gross_poisha,
        party_id: doc.party_id,
        party_name: doc.party_name_en,
        memo: `Trade receivable cleared — ${doc.doc_number}`,
      },
    );
    return lines;
  }

  lines.push(
    {
      account_code: '2110',
      debit_poisha: doc.gross_poisha,
      party_id: doc.party_id,
      party_name: doc.party_name_en,
      memo: `Trade payable settled — ${doc.doc_number}`,
    },
    ...(doc.vds_poisha > 0n
      ? [
          {
            account_code: '2130',
            credit_poisha: doc.vds_poisha,
            party_id: doc.party_id,
            party_name: doc.party_name_en,
            memo: `VDS withheld — Mushak 6.6 challan queued (${doc.doc_number})`,
          },
        ]
      : []),
    ...(doc.tds_poisha > 0n
      ? [
          {
            account_code: '2140',
            credit_poisha: doc.tds_poisha,
            party_id: doc.party_id,
            party_name: doc.party_name_en,
            memo: `TDS withheld — Treasury challan queued (${doc.doc_number})`,
          },
        ]
      : []),
    {
      account_code: bankAccountCode,
      credit_poisha: bankAmount,
      party_id: doc.party_id,
      party_name: doc.party_name_en,
      memo: `Paid to supplier net of withholding — ${doc.doc_number}`,
    },
  );
  return lines;
}

/**
 * Explicit, full settlement of one posted document. Posting the document never settles it; a
 * caller must invoke this command (or pass an explicit `settle: true` at creation, which calls the
 * same command). The journal is idempotent by document id and the document is updated only after
 * the balanced journal has been sealed.
 */
export function settleCommercialDoc<T extends TaxAnnotatedDoc | CommercialDoc>(
  doc: T,
  request: SettlementRequest,
  context: JournalPostContext,
): SettlementResult<T> {
  if (!request.bank_account_code) {
    throw new SettlementError('BANK_ACCOUNT_REQUIRED', 'A bank/MFS/cash account is required to settle.');
  }
  if (doc.doc_type === 'CREDIT_NOTE') {
    throw new SettlementError(
      'CREDIT_NOTE_NOT_SETTLEABLE',
      'A credit note reduces a receivable; it is not settled by a separate receipt.',
    );
  }
  if (doc.status === 'SETTLED' || doc.settled_poisha >= doc.gross_poisha) {
    throw new SettlementError('ALREADY_SETTLED', `Document ${doc.doc_number} is already settled.`);
  }
  if (doc.status !== 'POSTED') {
    throw new SettlementError(
      'DOCUMENT_NOT_POSTED',
      `Document ${doc.doc_number} is ${doc.status}; only a POSTED document can be settled.`,
    );
  }
  if (doc.settled_poisha > 0n) {
    throw new SettlementError(
      'PARTIAL_SETTLEMENT_NOT_SUPPORTED',
      `Document ${doc.doc_number} already carries a partial settlement; partial allocations are not supported in this phase.`,
    );
  }
  const outstanding = doc.gross_poisha - doc.settled_poisha;
  if (outstanding <= 0n) {
    throw new SettlementError('NOTHING_OUTSTANDING', `Document ${doc.doc_number} has nothing outstanding.`);
  }
  if (request.amount_poisha !== undefined && request.amount_poisha !== outstanding) {
    throw new SettlementError(
      'PARTIAL_SETTLEMENT_NOT_SUPPORTED',
      `Full settlement of ${outstanding.toString()} poisha is required in this phase; partial allocations are not yet supported.`,
    );
  }

  const lines = settlementJournalLines(doc, request.bank_account_code);
  const isSale = doc.doc_type === 'SALES_INVOICE';
  const journal = postJournal(
    {
      book_type: doc.book_type,
      bin_unit_id: doc.bin_unit_id,
      document_date: request.settlement_date,
      posting_date: request.settlement_date,
      tax_point_date: request.settlement_date,
      journal_number: request.journal_number,
      source_module: 'BANK_MFS',
      source_doc_id: doc.id,
      source_doc_ref: doc.doc_number,
      narration_en: `${isSale ? 'Customer receipt of' : 'Supplier payment of'} ${doc.doc_number} — ${doc.party_name_en}`,
      narration_bn: `${isSale ? 'গ্রাহক প্রাপ্তি' : 'সরবরাহকারী পরিশোধ'} ${doc.doc_number} — ${doc.party_name_bn}`,
      tax_decision_trace_id: (doc as Partial<TaxAnnotatedDoc>).tax_trace_id,
      idempotency_key: `SETTLEMENT|${doc.id}`,
      created_by: request.actor,
      approved_by: request.actor,
      lines,
    },
    context,
  );

  return {
    doc: {
      ...doc,
      status: 'SETTLED',
      workflow_stage: 'SETTLED',
      settled_poisha: doc.settled_poisha + outstanding,
      settlement_journal_id: journal.id,
    },
    journal,
  };
}

// ---------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------

export interface AccountMovement {
  code: string;
  debit_poisha: bigint;
  credit_poisha: bigint;
  /** debit-positive net movement */
  net_poisha: bigint;
}

/** Debit-positive movement per account code across an arbitrary journal selection. */
export function accountMovements(journals: readonly JournalEntry[]): Map<string, AccountMovement> {
  const map = new Map<string, AccountMovement>();
  for (const journal of journals) {
    for (const line of journal.lines) {
      const current = map.get(line.account_code) ?? {
        code: line.account_code,
        debit_poisha: 0n,
        credit_poisha: 0n,
        net_poisha: 0n,
      };
      current.debit_poisha += line.debit_poisha;
      current.credit_poisha += line.credit_poisha;
      current.net_poisha = current.debit_poisha - current.credit_poisha;
      map.set(line.account_code, current);
    }
  }
  return map;
}

export function accountBalance(journals: readonly JournalEntry[], code: string): bigint {
  let balance = 0n;
  for (const journal of journals) {
    for (const line of journal.lines) {
      if (line.account_code !== code) continue;
      balance += line.debit_poisha - line.credit_poisha;
    }
  }
  return balance;
}

/** Normal-side balance: assets/expenses are debit-positive, everything else credit-positive. */
export function normalSideBalance(account: Account | undefined, debitPositive: bigint): bigint {
  if (!account) return debitPositive;
  if (account.account_type === 'ASSET' || account.account_type === 'EXPENSE') return debitPositive;
  return -debitPositive;
}

// ---------------------------------------------------------------------------------------------
// Subledger-to-GL control reconciliation
// ---------------------------------------------------------------------------------------------

export interface SubledgerProofRow extends SubledgerProof {
  opening_control_poisha: bigint;
  movement_poisha: bigint;
  detail_en: string;
  detail_bn: string;
}

export interface SubledgerReconciliation {
  rows: SubledgerProofRow[];
  all_reconciled: boolean;
  total_difference_poisha: bigint;
  suspense_balance_poisha: bigint;
  suspense_items: SuspenseItem[];
  checked_at: string;
  open_item_count: number;
}

const OPENING_MODULE: SourceModule = 'OPENING_BALANCE';

function normalSideForKey(key: SubledgerProof['key']): 'DEBIT' | 'CREDIT' {
  return key === 'AR' || key === 'BANK_MFS' || key === 'VAT_CURRENT_ACCOUNT' ? 'DEBIT' : 'CREDIT';
}

function sumCodes(
  movements: Map<string, AccountMovement>,
  codes: readonly string[],
  side: 'DEBIT' | 'CREDIT',
): bigint {
  let total = 0n;
  for (const code of codes) {
    const movement = movements.get(code);
    if (!movement) continue;
    total += side === 'DEBIT' ? movement.net_poisha : -movement.net_poisha;
  }
  return total;
}

function postedCommercial(docs: readonly CommercialDoc[]): CommercialDoc[] {
  return docs.filter(
    (doc) =>
      doc.status === 'POSTED' ||
      doc.status === 'SETTLED' ||
      doc.status === 'RECONCILED' ||
      doc.status === 'PERIOD_CLOSED',
  );
}

const PURCHASE_DOC_TYPES: CommercialDocType[] = ['PURCHASE_BILL', 'EXPENSE_VOUCHER', 'IMPORTED_SERVICE'];

/**
 * Prove every control account against its underlying subledger schedule.
 *
 * The GL side is derived from the immutable journals; the subledger side is derived independently
 * from documents, registers and challans. Any difference — including an unexplained 2190 Suspense
 * balance — is surfaced rather than plugged.
 */
export function reconcileSubledgers(
  accounts: readonly Account[],
  journals: readonly JournalEntry[],
  commercialDocs: readonly CommercialDoc[],
  bankAccounts: readonly BankAccount[],
): SubledgerReconciliation {
  const allMovements = accountMovements(journals);
  const openingMovements = accountMovements(journals.filter((j) => j.source_module === OPENING_MODULE));
  const docs = postedCommercial(commercialDocs);
  const rows: SubledgerProofRow[] = [];

  const bankCodes = accounts
    .filter((account) => account.control_subledger === 'BANK_MFS')
    .map((account) => account.code);
  const cashCodes = bankCodes.length
    ? bankCodes
    : bankAccounts.map((account) => account.account_code);

  const buildRow = (
    key: SubledgerProof['key'],
    labelEn: string,
    labelBn: string,
    codes: string[],
    subledger: bigint,
    openItems: number,
    detailEn: string,
    detailBn: string,
  ): SubledgerProofRow => {
    const side = normalSideForKey(key);
    const glClosing = sumCodes(allMovements, codes, side);
    const opening = sumCodes(openingMovements, codes, side);
    const difference = glClosing - subledger;
    return {
      key,
      label_en: labelEn,
      label_bn: labelBn,
      gl_balance_poisha: glClosing,
      subledger_balance_poisha: subledger,
      difference_poisha: difference,
      reconciled: difference === 0n,
      account_codes: codes,
      open_items: openItems,
      opening_control_poisha: opening,
      movement_poisha: glClosing - opening,
      detail_en: detailEn,
      detail_bn: detailBn,
    };
  };

  // ---- AR -----------------------------------------------------------------------------------
  const invoices = docs.filter((doc) => doc.doc_type === 'SALES_INVOICE');
  const creditNotes = docs.filter((doc) => doc.doc_type === 'CREDIT_NOTE');
  const arOpen = invoices.reduce((sum, doc) => sum + (doc.gross_poisha - doc.settled_poisha), 0n);
  const arCredit = creditNotes.reduce((sum, doc) => sum + (doc.gross_poisha - doc.settled_poisha), 0n);
  const arOpening = sumCodes(openingMovements, ['1210'], 'DEBIT');
  rows.push(
    buildRow(
      'AR',
      'Trade receivables — control',
      'বাণিজ্যিক প্রাপ্য — নিয়ন্ত্রণ',
      ['1210'],
      arOpening + arOpen - arCredit,
      invoices.filter((doc) => doc.gross_poisha !== doc.settled_poisha).length + creditNotes.length,
      `${invoices.length} posted invoices, ${creditNotes.length} Mushak 6.7 credit notes, ${arOpening === 0n ? 'no' : 'an'} opening control balance carried from the opening journal.`,
      `${invoices.length} পোস্টকৃত চালান, ${creditNotes.length} মূসক ৬.৭ ক্রেডিট নোট, উদ্বোধনী জার্নাল থেকে ${arOpening === 0n ? 'কোনো' : 'একটি'} উদ্বোধনী নিয়ন্ত্রণ ব্যালেন্স।`,
    ),
  );

  // ---- AP -----------------------------------------------------------------------------------
  const bills = docs.filter((doc) => PURCHASE_DOC_TYPES.includes(doc.doc_type));
  const apOpen = bills.reduce((sum, doc) => sum + (doc.gross_poisha - doc.settled_poisha), 0n);
  const apOpening = sumCodes(openingMovements, ['2110'], 'CREDIT');
  rows.push(
    buildRow(
      'AP',
      'Trade payables — control',
      'বাণিজ্যিক প্রদেয় — নিয়ন্ত্রণ',
      ['2110'],
      apOpening + apOpen,
      bills.filter((doc) => doc.gross_poisha !== doc.settled_poisha).length,
      `${bills.length} posted supplier bills, ${bills.filter((doc) => doc.gross_poisha !== doc.settled_poisha).length} still open, plus the opening control balance.`,
      `${bills.length} পোস্টকৃত সরবরাহকারী বিল, ${bills.filter((doc) => doc.gross_poisha !== doc.settled_poisha).length} এখনো খোলা, সাথে উদ্বোধনী নিয়ন্ত্রণ ব্যালেন্স।`,
    ),
  );

  // ---- Bank / MFS ---------------------------------------------------------------------------
  let bankSubledger = 0n;
  let bankMovementCount = 0;
  const coveredCodes = new Set<string>();
  for (const bank of bankAccounts) {
    coveredCodes.add(bank.account_code);
    let movement = 0n;
    for (const journal of journals) {
      if (journal.source_module === OPENING_MODULE) continue;
      for (const line of journal.lines) {
        if (line.account_code !== bank.account_code) continue;
        movement += line.debit_poisha - line.credit_poisha;
        bankMovementCount += 1;
      }
    }
    bankSubledger += bank.opening_poisha + movement;
  }
  for (const code of cashCodes) {
    if (coveredCodes.has(code)) continue;
    bankSubledger += accountBalance(journals, code);
  }
  rows.push(
    buildRow(
      'BANK_MFS',
      'Bank, MFS and petty cash',
      'ব্যাংক, এমএফএস ও ক্ষুদ্র নগদ',
      cashCodes,
      bankSubledger,
      bankAccounts.length,
      `${bankAccounts.length} registers (City Bank, BRAC Bank, bKash, Nagad, petty cash) with ${bankMovementCount} booked movements reconciled to the control accounts 1110–1130.`,
      `${bankAccounts.length} রেজিস্টার (সিটি ব্যাংক, ব্র্যাক ব্যাংক, বিকাশ, নগদ, ক্ষুদ্র নগদ) এবং ${bankMovementCount}টি লেনদেন নিয়ন্ত্রণ হিসাব ১১১০–১১৩০-এর সাথে মিলিয়ে দেখা হয়েছে।`,
    ),
  );

  // ---- VAT current account ------------------------------------------------------------------
  let inputFromDocs = 0n;
  for (const doc of bills) {
    try {
      inputFromDocs += documentTaxOutcome(doc).claimable_poisha;
    } catch {
      inputFromDocs += doc.vat_poisha;
    }
  }
  let vatUtilised = 0n;
  for (const journal of journals) {
    if (journal.source_module === OPENING_MODULE) continue;
    for (const line of journal.lines) {
      if (line.account_code !== '1140') continue;
      vatUtilised += line.credit_poisha;
    }
  }
  const vatOpening = sumCodes(openingMovements, ['1140'], 'DEBIT');
  rows.push(
    buildRow(
      'VAT_CURRENT_ACCOUNT',
      'VAT current account (Mushak 9.1)',
      'ভ্যাট চলতি হিসাব (মূসক ৯.১)',
      ['1140'],
      vatOpening + inputFromDocs - vatUtilised,
      bills.filter((doc) => ((doc as Partial<TaxAnnotatedDoc>).tax_claimable_poisha ?? 0n) > 0n).length,
      `s.46-eligible input VAT from ${bills.length} purchase documents less ${vatUtilised === 0n ? 'no' : 'the'} Mushak 9.1 utilisation traced to filing journals.`,
      `${bills.length} ক্রয় নথির ধারা ৪৬-যোগ্য ইনপুট ভ্যাট থেকে ${vatUtilised === 0n ? 'কোনো' : ''} মূসক ৯.১ ব্যবহার বাদ দেওয়া হয়েছে।`,
    ),
  );

  // ---- VDS payable ---------------------------------------------------------------------------
  const settledDocs = bills.filter((doc) => doc.settled_poisha > 0n);
  const vdsWithheld = settledDocs.reduce((sum, doc) => sum + doc.vds_poisha, 0n);
  const tdsWithheld = settledDocs.reduce((sum, doc) => sum + doc.tds_poisha, 0n);
  let vdsDeposited = 0n;
  let tdsDeposited = 0n;
  for (const journal of journals) {
    if (journal.source_module === OPENING_MODULE) continue;
    for (const line of journal.lines) {
      if (line.account_code === '2130') vdsDeposited += line.debit_poisha;
      if (line.account_code === '2140') tdsDeposited += line.debit_poisha;
    }
  }
  const vdsOpening = sumCodes(openingMovements, ['2130'], 'CREDIT');
  const tdsOpening = sumCodes(openingMovements, ['2140'], 'CREDIT');
  rows.push(
    buildRow(
      'VDS_PAYABLE',
      'VDS withheld payable (Mushak 6.6)',
      'কর্তিত ভিডিএস প্রদেয় (মূসক ৬.৬)',
      ['2130'],
      vdsOpening + vdsWithheld - vdsDeposited,
      settledDocs.filter((doc) => doc.vds_poisha > 0n).length,
      `${settledDocs.filter((doc) => doc.vds_poisha > 0n).length} settled bills withheld VDS; ${vdsDeposited > 0n ? 'Treasury challans have been deposited' : 'no challan deposited yet'}.`,
      `${settledDocs.filter((doc) => doc.vds_poisha > 0n).length} নিষ্পত্তিকৃত বিলে ভিডিএস কর্তন হয়েছে; ${vdsDeposited > 0n ? 'ট্রেজারি চালান জমা হয়েছে' : 'এখনো চালান জমা হয়নি'}।`,
    ),
  );
  rows.push(
    buildRow(
      'TDS_PAYABLE',
      'TDS withheld payable',
      'কর্তিত টিডিএস প্রদেয়',
      ['2140'],
      tdsOpening + tdsWithheld - tdsDeposited,
      settledDocs.filter((doc) => doc.tds_poisha > 0n).length,
      `${settledDocs.filter((doc) => doc.tds_poisha > 0n).length} settled bills withheld TDS; ${tdsDeposited > 0n ? 'Treasury challans have been deposited' : 'no challan deposited yet'}.`,
      `${settledDocs.filter((doc) => doc.tds_poisha > 0n).length} নিষ্পত্তিকৃত বিলে টিডিএস কর্তন হয়েছে; ${tdsDeposited > 0n ? 'ট্রেজারি চালান জমা হয়েছে' : 'এখনো চালান জমা হয়নি'}।`,
    ),
  );

  // ---- Suspense ------------------------------------------------------------------------------
  const suspenseMovement = allMovements.get('2190');
  const suspenseBalance = suspenseMovement ? -suspenseMovement.net_poisha : 0n;
  const referenceDate = journals.reduce(
    (latest, journal) => (journal.posting_date > latest ? journal.posting_date : latest),
    journals[0]?.posting_date ?? '2026-10-31',
  );
  const suspenseJournals = journals.filter(
    (journal) =>
      journal.source_module !== OPENING_MODULE &&
      journal.lines.some((line) => line.account_code === '2190'),
  );
  const suspenseCreditRows = suspenseJournals
    .map((journal) => ({
      journal,
      amount: journal.lines
        .filter((line) => line.account_code === '2190')
        .reduce((sum, line) => sum + line.credit_poisha - line.debit_poisha, 0n),
    }))
    .filter((entry) => entry.amount > 0n)
    .sort((left, right) => left.journal.posting_date.localeCompare(right.journal.posting_date));
  let suspensePool = suspenseJournals
    .map((journal) =>
      journal.lines
        .filter((line) => line.account_code === '2190')
        .reduce((sum, line) => sum + line.debit_poisha - line.credit_poisha, 0n),
    )
    .filter((amount) => amount > 0n)
    .reduce((sum, amount) => sum + amount, 0n);

  // Clearing debits are netted against the oldest unexplained credits, so the queue shows only what
  // is still genuinely unapplied — never the allocation journal that cleared it.
  const suspenseItems: SuspenseItem[] = [];
  for (const entry of suspenseCreditRows) {
    const applied = suspensePool >= entry.amount ? entry.amount : suspensePool;
    suspensePool -= applied;
    const openPoisha = entry.amount - applied;
    if (openPoisha <= 0n) continue;
    suspenseItems.push({
      id: `SUS-${entry.journal.id}`,
      journal_id: entry.journal.id,
      journal_number: entry.journal.journal_number,
      date: entry.journal.posting_date,
      amount_poisha: openPoisha,
      description_en: entry.journal.narration_en,
      description_bn: entry.journal.narration_bn,
      age_days: Math.max(0, daysBetween(entry.journal.posting_date, referenceDate)),
    });
  }

  const totalDifference = rows.reduce((sum, row) => sum + (row.difference_poisha < 0n ? -row.difference_poisha : row.difference_poisha), 0n);

  return {
    rows,
    all_reconciled: rows.every((row) => row.reconciled),
    total_difference_poisha: totalDifference,
    suspense_balance_poisha: suspenseBalance,
    suspense_items: suspenseItems,
    checked_at: isoNow(),
    open_item_count: rows.reduce((sum, row) => sum + row.open_items, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Small helpers shared by the seeds, the context and the studios
// ---------------------------------------------------------------------------------------------

/** Highest posting date in the ledger — the "as at" date used by dashboards. */
export function ledgerAsAt(journals: readonly JournalEntry[]): string {
  return journals.reduce((latest, journal) => (journal.posting_date > latest ? journal.posting_date : latest), '');
}

export function journalsForPeriod(
  journals: readonly JournalEntry[],
  periodCode: string,
  bookFilter: BookType[] | null = null,
): JournalEntry[] {
  return journals.filter(
    (journal) =>
      journal.period_code === periodCode && (bookFilter === null || bookFilter.includes(journal.book_type)),
  );
}

/** True when the challan schedule still has an undeposited balance for the period. */
export function pendingChallans(challans: readonly Challan[]): Challan[] {
  return challans.filter((challan) => challan.status === 'PENDING' || challan.status === 'BATCHED');
}

export function challanTotals(challans: readonly Challan[]): { pending_poisha: bigint; deposited_poisha: bigint } {
  return challans.reduce(
    (totals, challan) => {
      if (challan.status === 'DEPOSITED' || challan.status === 'CERTIFIED') {
        totals.deposited_poisha += challan.amount_poisha;
      } else {
        totals.pending_poisha += challan.amount_poisha;
      }
      return totals;
    },
    { pending_poisha: 0n, deposited_poisha: 0n },
  );
}
