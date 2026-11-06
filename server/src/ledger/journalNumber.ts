/**
 * Journal number formatting shared by the Phase 5 posting service and tests.
 *
 * The convention is inherited from the existing domain allocator: the company's JOURNAL prefix
 * (default `JE-`) + the accounting period code + a padded sequence, for example
 * `JE-2026-11-0001`. Allocation itself is transactional (number_sequences row lock); this function
 * only formats the already-allocated value.
 */
export function formatJournalNumber(prefix: string, periodCode: string, value: bigint, pad: number): string {
  if (!/^[A-Za-z0-9._/-]{1,20}$/.test(prefix)) {
    throw new Error('Journal prefix contains unsupported characters.');
  }
  if (!/^\d{4}-\d{2}$/.test(periodCode)) {
    throw new Error('Journal period code must be YYYY-MM.');
  }
  if (value < 1n) {
    throw new Error('Journal sequence values start at 1.');
  }
  if (!Number.isInteger(pad) || pad < 1 || pad > 12) {
    throw new Error('Journal sequence padding must be between 1 and 12.');
  }
  return `${prefix}${periodCode}-${value.toString().padStart(pad, '0')}`;
}
