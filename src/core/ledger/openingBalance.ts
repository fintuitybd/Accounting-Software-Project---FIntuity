// Opening balances are a balanced, posted batch — never the mutable opening fields on an account
// master. The batch computes its own debit/credit totals, validates exactly one side per line and
// posts a single OPENING_BALANCE journal through the same period and audit controls as any journal.

import type {
  Account,
  BookType,
  OpeningBalanceBatch,
  OpeningBalanceLine,
} from '../types';
import { periodCodeOf, sumPoisha } from '../money';
import { postJournal, type JournalDraft, type JournalPostContext } from './ledgerEngine';

export interface OpeningBalanceBatchInput {
  id: string;
  batch_date: string;
  book_type?: BookType;
  bin_unit_id: string;
  created_by: string;
  lines: readonly OpeningBalanceLine[];
}

export interface OpeningBalanceValidation {
  valid: boolean;
  balanced: boolean;
  total_debit_poisha: bigint;
  total_credit_poisha: bigint;
  errors: string[];
}

export class OpeningBalanceError extends Error {
  readonly code:
    | 'TOO_FEW_LINES'
    | 'EMPTY_LINE'
    | 'BOTH_SIDES'
    | 'NEGATIVE_AMOUNT'
    | 'NO_DEBIT'
    | 'UNBALANCED'
    | 'UNKNOWN_ACCOUNT'
    | 'INVALID_DATE';

  constructor(code: OpeningBalanceError['code'], message: string) {
    super(message);
    this.name = 'OpeningBalanceError';
    this.code = code;
  }
}

/** Validate without posting, so a draft batch can be reviewed and corrected. */
export function validateOpeningBalanceBatch(
  lines: readonly OpeningBalanceLine[],
  accounts?: readonly Account[],
): OpeningBalanceValidation {
  const errors: string[] = [];
  if (lines.length < 2) errors.push('An opening-balance batch needs at least two lines.');
  const known = accounts ? new Set(accounts.map((account) => account.code)) : null;

  for (const [index, line] of lines.entries()) {
    const debit = line.debit_poisha ?? 0n;
    const credit = line.credit_poisha ?? 0n;
    if (debit < 0n || credit < 0n) {
      errors.push(`Line ${index + 1} carries a negative amount; use the opposite side instead.`);
    }
    if (debit > 0n && credit > 0n) {
      errors.push(`Line ${index + 1} carries both a debit and a credit amount.`);
    }
    if (debit === 0n && credit === 0n) {
      errors.push(`Line ${index + 1} is empty.`);
    }
    if (!line.account_code) {
      errors.push(`Line ${index + 1} has no account code.`);
    } else if (known && !known.has(line.account_code)) {
      errors.push(`Account ${line.account_code} is not in the chart of accounts.`);
    }
  }

  const totalDebit = sumPoisha(lines.map((line) => line.debit_poisha ?? 0n));
  const totalCredit = sumPoisha(lines.map((line) => line.credit_poisha ?? 0n));
  if (totalDebit <= 0n) errors.push('An opening-balance batch must carry a positive debit total.');
  if (totalDebit !== totalCredit) {
    errors.push(
      `Opening balances do not balance: debit ${totalDebit.toString()} poisha vs credit ${totalCredit.toString()} poisha.`,
    );
  }

  return {
    valid: errors.length === 0,
    balanced: totalDebit === totalCredit && totalDebit > 0n,
    total_debit_poisha: totalDebit,
    total_credit_poisha: totalCredit,
    errors,
  };
}

/** Build a batch whose totals are computed from its lines, not supplied by the client. */
export function buildOpeningBalanceBatch(
  input: OpeningBalanceBatchInput,
  accounts?: readonly Account[],
): OpeningBalanceBatch {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.batch_date)) {
    throw new OpeningBalanceError('INVALID_DATE', `Opening-balance date "${input.batch_date}" is not YYYY-MM-DD.`);
  }
  const validation = validateOpeningBalanceBatch(input.lines, accounts);
  if (!validation.valid) {
    const code = validation.errors.some((message) => message.includes('two lines'))
      ? 'TOO_FEW_LINES'
      : validation.errors.some((message) => message.includes('both a debit'))
        ? 'BOTH_SIDES'
        : validation.errors.some((message) => message.includes('negative'))
          ? 'NEGATIVE_AMOUNT'
          : validation.errors.some((message) => message.includes('empty'))
            ? 'EMPTY_LINE'
            : validation.errors.some((message) => message.includes('chart'))
              ? 'UNKNOWN_ACCOUNT'
              : validation.errors.some((message) => message.includes('do not balance'))
                ? 'UNBALANCED'
                : 'NO_DEBIT';
    throw new OpeningBalanceError(code, validation.errors.join(' '));
  }
  return {
    id: input.id,
    batch_date: input.batch_date,
    book_type: input.book_type ?? 'STATUTORY_BD',
    bin_unit_id: input.bin_unit_id,
    lines: input.lines.map((line, index) => ({ ...line, id: line.id ?? `${input.id}-L${index + 1}` })),
    total_debit_poisha: validation.total_debit_poisha,
    total_credit_poisha: validation.total_credit_poisha,
    balanced: validation.balanced,
    status: 'DRAFT',
    created_by: input.created_by,
  };
}

/** The journal draft for a validated batch; source module is always OPENING_BALANCE. */
export function openingBalanceJournalDraft(batch: OpeningBalanceBatch): JournalDraft {
  return {
    id: `${batch.id}::JOURNAL`,
    book_type: batch.book_type,
    bin_unit_id: batch.bin_unit_id,
    period_code: periodCodeOf(batch.batch_date),
    document_date: batch.batch_date,
    posting_date: batch.batch_date,
    tax_point_date: batch.batch_date,
    source_module: 'OPENING_BALANCE',
    source_doc_ref: batch.id,
    narration_en: `Opening balances posted from batch ${batch.id}.`,
    narration_bn: `ব্যাচ ${batch.id} থেকে উদ্বোধনী ব্যালেন্স পোস্ট।`,
    created_by: batch.created_by,
    lines: batch.lines.map((line) => ({
      account_code: line.account_code,
      debit_poisha: line.debit_poisha,
      credit_poisha: line.credit_poisha,
      party_id: line.party_id,
      memo: line.memo,
    })),
  };
}

/**
 * Post the batch as one immutable journal. The caller must supply periods and accounts; the same
 * CLOSED/LOCKED/UNKNOWN rejection as every other posting applies.
 */
export function postOpeningBalanceBatch(
  batch: OpeningBalanceBatch,
  context: JournalPostContext,
): { batch: OpeningBalanceBatch; journal: ReturnType<typeof postJournal> } {
  const journal = postJournal(openingBalanceJournalDraft(batch), context);
  return {
    batch: { ...batch, status: 'POSTED', journal_id: journal.id },
    journal,
  };
}
