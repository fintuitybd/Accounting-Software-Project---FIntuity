/** Shared Phase 5 ledger vocabularies. Values mirror the existing domain types. */

export const JOURNAL_BOOK_TYPES = ['STATUTORY_BD', 'IFRS_GROUP_ADJ', 'TAX_COMPUTATION', 'MANAGEMENT_MIS'] as const;

/**
 * Phase 5 exposes the statutory book only. book_type is retained on the journal for the later
 * multi-book design, but a second ledger without an accounting-policy/reconciliation design would
 * be unsafe, so the API rejects it rather than silently posting a parallel book.
 */
export const SUPPORTED_BOOK_TYPES = ['STATUTORY_BD'] as const;

export const JOURNAL_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'] as const;

export const JOURNAL_SOURCE_MODULES = [
  'SALES',
  'PURCHASES',
  'BANK_MFS',
  'PAYROLL_LITE',
  'MANUAL_JOURNAL',
  'IFRS_ADJUSTMENT',
  'MASS_IMPORT',
  'REVERSAL',
  'OPENING_BALANCE',
  'INVENTORY',
  'TREASURY',
  'BANK_RECONCILIATION',
  'SUSPENSE',
] as const;

export const OPENING_BALANCE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'] as const;
