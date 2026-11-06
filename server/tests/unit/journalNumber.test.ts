import { describe, expect, it } from 'vitest';
import { formatJournalNumber } from '../../src/ledger/journalNumber.ts';

describe('Phase 5 journal number formatting', () => {
  it('keeps the existing prefix-period-sequence convention and zero padding', () => {
    expect(formatJournalNumber('JE-', '2026-11', 1n, 4)).toBe('JE-2026-11-0001');
    expect(formatJournalNumber('JV-', '2026-11', 42n, 6)).toBe('JV-2026-11-000042');
  });

  it('rejects malformed prefixes, periods, values and padding', () => {
    expect(() => formatJournalNumber('JE ', '2026-11', 1n, 4)).toThrow();
    expect(() => formatJournalNumber('JE-', '2026-1', 1n, 4)).toThrow();
    expect(() => formatJournalNumber('JE-', '2026-11', 0n, 4)).toThrow();
    expect(() => formatJournalNumber('JE-', '2026-11', 1n, 0)).toThrow();
  });
});
