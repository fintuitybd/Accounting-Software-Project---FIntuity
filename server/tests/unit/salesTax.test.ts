import { describe, expect, it } from 'vitest';
import {
  BD_2026_V1,
  VAT_RATE_BPS_BY_CATEGORY,
  VAT_RULE_ID_BY_CATEGORY,
} from '../../../src/core/tax-engine/rulePack.ts';
import { assertPostableSalesTax, calculateSalesTax, isPostableSalesTaxState } from '../../src/sales/tax.ts';
import { SALES_TAX_PACK } from '../../src/sales/taxPack.generated.ts';
import type { TaxCategory } from '../../../src/core/types.ts';

describe('server sales tax configuration', () => {
  it('is generated from the reviewed client rule pack without rate drift', () => {
    expect(SALES_TAX_PACK.version).toBe(BD_2026_V1.version);
    expect(SALES_TAX_PACK.reviewerStatus).toBe(BD_2026_V1.reviewer_status);
    for (const category of Object.keys(VAT_RATE_BPS_BY_CATEGORY) as TaxCategory[]) {
      const generated = SALES_TAX_PACK.categories[category];
      expect(generated.rateBps, category).toBe(VAT_RATE_BPS_BY_CATEGORY[category]);
      expect(generated.ruleId, category).toBe(VAT_RULE_ID_BY_CATEGORY[category]);
    }
  });

  it('calculates each line on its own rate and rounds half-up in integer poisha', () => {
    const decision = calculateSalesTax({
      docDate: '2026-11-01',
      partyBin: '1234567890123',
      lines: [
        {
          lineId: 'line-standard',
          quantity: 20_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 1_000n,
          taxCategory: 'STANDARD_15',
        },
        {
          lineId: 'line-trading',
          quantity: 12_345n,
          unitPricePoisha: 5_000n,
          discountPoisha: 0n,
          taxCategory: 'TRADING_5',
        },
      ],
    });
    expect(decision.lines[0]?.netPoisha).toBe(19_000n);
    expect(decision.lines[0]?.vatPoisha).toBe(2_850n);
    expect(decision.lines[1]?.netPoisha).toBe(6_173n);
    expect(decision.lines[1]?.vatPoisha).toBe(309n);
    expect(decision.subtotalPoisha).toBe(25_173n);
    expect(decision.discountPoisha).toBe(1_000n);
    expect(decision.vatPoisha).toBe(3_159n);
    expect(decision.grossPoisha).toBe(28_332n);
    expect(decision.decisionState).toBe('SUPPORTED');
  });

  it('marks a missing buyer BIN as a condition rather than inventing evidence', () => {
    const decision = calculateSalesTax({
      docDate: '2026-11-01',
      partyBin: null,
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'STANDARD_15',
        },
      ],
    });
    expect(decision.decisionState).toBe('SUPPORTED_WITH_CONDITIONS');
    expect(decision.lines[0]?.warnings.join(' ')).toContain('Customer BIN missing');
    expect(isPostableSalesTaxState(decision.decisionState)).toBe(true);
  });

  it('blocks reverse-charge sales and dates outside the rule-pack effective period', () => {
    expect(() =>
      calculateSalesTax({
        docDate: '2026-11-01',
        partyBin: '1234567890123',
        lines: [
          {
            lineId: 'line-1',
            quantity: 10_000n,
            unitPricePoisha: 10_000n,
            discountPoisha: 0n,
            taxCategory: 'REVERSE_CHARGE',
          },
        ],
      }),
    ).toThrow(/reverse-charge/i);

    const expired = calculateSalesTax({
      docDate: '2025-01-15',
      partyBin: '1234567890123',
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'STANDARD_15',
        },
      ],
    });
    expect(expired.decisionState).toBe('SOURCE_DISPUTED_OR_EXPIRED');
    expect(() => assertPostableSalesTax(expired)).toThrow(/SOURCE_DISPUTED_OR_EXPIRED/);
  });

  it('uses the credit-note net/VAT overrides without re-pricing a return', () => {
    const decision = calculateSalesTax({
      docDate: '2026-11-01',
      partyBin: '1234567890123',
      lines: [
        {
          lineId: 'credit-line',
          quantity: 5_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'STANDARD_15',
          netOverridePoisha: 4_321n,
          vatOverridePoisha: 648n,
        },
      ],
    });
    expect(decision.lines[0]?.netPoisha).toBe(4_321n);
    expect(decision.lines[0]?.vatPoisha).toBe(648n);
    expect(decision.grossPoisha).toBe(4_969n);
  });
});
