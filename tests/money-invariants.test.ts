import { describe, expect, it } from 'vitest';
import {
  JournalPostingError,
  journalTotals,
  postJournal,
  type JournalPostContext,
} from '../src/core/ledger/ledgerEngine';
import { createSeedDataset } from '../src/core/ledger/seedData';
import { applyRateBps, bdtToPoisha, formatPoisha, sumPoisha } from '../src/core/money';
import type { AccountingPeriod } from '../src/core/types';

const dataset = createSeedDataset('APEX');
const periods: AccountingPeriod[] = [
  { code: '2026-10', label: 'October 2026', start_date: '2026-10-01', end_date: '2026-10-31', status: 'OPEN' },
];

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('money invariants (deterministic property cases)', () => {
  it('round-trips decimal BDT strings through integer poisha without floating point', () => {
    const random = makeRng(0x51f15e);
    for (let index = 0; index < 500; index += 1) {
      const whole = Math.floor(random() * 10_000_000);
      const paisa = Math.floor(random() * 100);
      const text = `${whole}.${String(paisa).padStart(2, '0')}`;
      expect(bdtToPoisha(text)).toBe(BigInt(whole) * 100n + BigInt(paisa));
      expect(bdtToPoisha(`(${text})`)).toBe(-(BigInt(whole) * 100n + BigInt(paisa)));
    }
  });

  it('keeps floor <= half-up <= ceiling for positive bases and rates', () => {
    const random = makeRng(0xb4d6e7);
    for (let index = 0; index < 500; index += 1) {
      const base = BigInt(Math.floor(random() * 1_000_000_000) + 1);
      const rateBps = Math.floor(random() * 2_000);
      const floor = applyRateBps(base, rateBps, 'FLOOR');
      const halfUp = applyRateBps(base, rateBps, 'HALF_UP');
      const ceiling = applyRateBps(base, rateBps, 'CEIL');
      expect(floor).toBeLessThanOrEqual(halfUp);
      expect(halfUp).toBeLessThanOrEqual(ceiling);
      expect(ceiling - floor).toBeLessThanOrEqual(1n);
    }
  });

  it('formats each parsed amount with two deterministic decimal places', () => {
    const random = makeRng(0x1ed6e7);
    for (let index = 0; index < 200; index += 1) {
      const poisha = BigInt(Math.floor(random() * 1_000_000_000));
      const formatted = formatPoisha(poisha, { showSymbol: false });
      expect(formatted).toMatch(/^-?[0-9,]+\.\d{2}$/);
      expect(bdtToPoisha(formatted)).toBe(poisha);
    }
  });

  it('posts generated journals that are exactly balanced and preserve every poisha', () => {
    const random = makeRng(0xba1a4ce);
    for (let index = 0; index < 200; index += 1) {
      const amount = BigInt(Math.floor(random() * 100_000_000) + 1);
      const context: JournalPostContext = {
        journals: [],
        periods,
        accounts: dataset.accounts,
        actor: 'property-test',
      };
      const journal = postJournal(
        {
          book_type: 'STATUTORY_BD',
          bin_unit_id: 'BU-DHK',
          document_date: '2026-10-15',
          posting_date: '2026-10-15',
          source_module: 'MANUAL_JOURNAL',
          narration_en: `Generated balanced journal ${index}`,
          narration_bn: `তৈরি সুষম জার্নাল ${index}`,
          created_by: 'property-test',
          lines: [
            { account_code: '5200', debit_poisha: amount },
            { account_code: '1110', credit_poisha: amount },
          ],
        },
        context,
      );
      expect(journal.lines).toHaveLength(2);
      const totals = journalTotals(journal.lines);
      expect(totals.debit_poisha).toBe(amount);
      expect(totals.credit_poisha).toBe(amount);
      expect(totals.balanced).toBe(true);
      expect(sumPoisha(journal.lines.map((line) => line.debit_poisha - line.credit_poisha))).toBe(0n);
      expect(journal.audit_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('never posts a one-poisha unbalanced journal', () => {
    const context: JournalPostContext = {
      journals: [],
      periods,
      accounts: dataset.accounts,
      actor: 'property-test',
    };
    try {
      postJournal(
        {
          book_type: 'STATUTORY_BD',
          bin_unit_id: 'BU-DHK',
          document_date: '2026-10-15',
          posting_date: '2026-10-15',
          source_module: 'MANUAL_JOURNAL',
          narration_en: 'Unbalanced property case',
          narration_bn: 'অসুষম পরীক্ষা',
          created_by: 'property-test',
          lines: [
            { account_code: '5200', debit_poisha: 100_000n },
            { account_code: '1110', credit_poisha: 99_999n },
          ],
        },
        context,
      );
      throw new Error('A one-poisha imbalance must be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(JournalPostingError);
      expect((error as JournalPostingError).code).toBe('UNBALANCED');
    }
  });
});
