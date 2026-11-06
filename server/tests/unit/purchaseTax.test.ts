import { describe, expect, it } from 'vitest';
import {
  BD_2026_V1,
  CASH_DISALLOWANCE_LIMIT_POISHA,
  TDS_NO_TIN_UPSCALE_BPS,
  TDS_RATE_BPS_BY_NATURE,
  TDS_RULE_ID_BY_NATURE,
  VAT_RATE_BPS_BY_CATEGORY,
  VAT_RULE_ID_BY_CATEGORY,
  VDS_RATE_BPS_BY_CATEGORY,
} from '../../../src/core/tax-engine/rulePack.ts';
import { PURCHASE_TAX_PACK } from '../../src/purchases/taxPack.generated.ts';
import {
  assertPostablePurchaseTax,
  calculatePurchaseTax,
  isPostablePurchaseTaxState,
} from '../../src/purchases/tax.ts';
import type { TdsNature, TaxCategory } from '../../../src/core/types.ts';

const validFacts = {
  docDate: '2026-11-15',
  supplierBin: '1234567890123',
  supplierTin: '123456789012',
  supplierTinMissing: false,
  hasMushak63: true,
  paymentMethod: 'BANK',
  isWithholdingEntity: true,
  vdsApplicable: true,
  tdsNature: 'SUPPLY_OF_GOODS',
  reverseChargeChallanHeld: false,
} as const;

describe('server purchase tax configuration', () => {
  it('is generated from the reviewed client rule pack without rate drift', () => {
    expect(PURCHASE_TAX_PACK.version).toBe(BD_2026_V1.version);
    expect(PURCHASE_TAX_PACK.reviewerStatus).toBe(BD_2026_V1.reviewer_status);
    for (const category of Object.keys(VAT_RATE_BPS_BY_CATEGORY) as TaxCategory[]) {
      expect(PURCHASE_TAX_PACK.vatCategories[category].rateBps, category).toBe(VAT_RATE_BPS_BY_CATEGORY[category]);
      expect(PURCHASE_TAX_PACK.vatCategories[category].ruleId, category).toBe(VAT_RULE_ID_BY_CATEGORY[category]);
      expect(PURCHASE_TAX_PACK.vdsRates[category].rateBps, category).toBe(VDS_RATE_BPS_BY_CATEGORY[category]);
    }
    for (const nature of Object.keys(TDS_RATE_BPS_BY_NATURE) as TdsNature[]) {
      expect(PURCHASE_TAX_PACK.tdsRates[nature].rateBps, nature).toBe(TDS_RATE_BPS_BY_NATURE[nature]);
      expect(PURCHASE_TAX_PACK.tdsRates[nature].ruleId, nature).toBe(TDS_RULE_ID_BY_NATURE[nature]);
    }
    expect(PURCHASE_TAX_PACK.tdsNoTinUpscaleBps).toBe(TDS_NO_TIN_UPSCALE_BPS);
    expect(PURCHASE_TAX_PACK.cashDisallowanceLimitPoisha).toBe(CASH_DISALLOWANCE_LIMIT_POISHA.toString());
  });

  it('calculates VAT, VDS and TDS in integer poisha with a valid tax invoice', () => {
    const decision = calculatePurchaseTax({
      facts: validFacts,
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
    expect(decision.lines[0]?.netPoisha).toBe(10_000n);
    expect(decision.lines[0]?.vatPoisha).toBe(1_500n);
    expect(decision.lines[0]?.vatClaimablePoisha).toBe(1_500n);
    expect(decision.lines[0]?.vatDisallowedPoisha).toBe(0n);
    expect(decision.lines[0]?.costPoisha).toBe(10_000n);
    expect(decision.subtotalPoisha).toBe(10_000n);
    expect(decision.grossPoisha).toBe(11_500n);
    expect(decision.vdsPoisha).toBe(1_500n);
    expect(decision.tdsPoisha).toBe(300n);
    expect(decision.netPayablePoisha).toBe(9_700n);
    expect(decision.decisionState).toBe('SUPPORTED');
  });

  it('upscales TDS by 50% when the supplier e-TIN is missing or explicitly overridden', () => {
    const missing = calculatePurchaseTax({
      facts: { ...validFacts, supplierTin: null },
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
    expect(missing.tdsPoisha).toBe(450n);
    expect(missing.netPayablePoisha).toBe(9_550n);
    expect(missing.warnings.join(' ')).toContain('upscaled');

    const overridden = calculatePurchaseTax({
      facts: { ...validFacts, supplierTinMissing: true },
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
    expect(overridden.tdsPoisha).toBe(450n);
  });

  it('disallows and capitalises input VAT when BIN or Mushak 6.3 evidence is missing', () => {
    const decision = calculatePurchaseTax({
      facts: { ...validFacts, supplierBin: null, hasMushak63: false },
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
    expect(decision.lines[0]?.vatPoisha).toBe(1_500n);
    expect(decision.lines[0]?.vatClaimablePoisha).toBe(0n);
    expect(decision.lines[0]?.vatDisallowedPoisha).toBe(1_500n);
    expect(decision.lines[0]?.costPoisha).toBe(11_500n);
    expect(decision.grossPoisha).toBe(11_500n);
    expect(decision.decisionState).toBe('SUPPORTED_WITH_CONDITIONS');
    expect(isPostablePurchaseTaxState(decision.decisionState)).toBe(true);
    expect(decision.lines[0]?.warnings.join(' ')).toContain('Input VAT is disallowed');
  });

  it('disallows input VAT on truncated 5% purchases without inventing a credit', () => {
    const decision = calculatePurchaseTax({
      facts: validFacts,
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'TRADING_5',
        },
      ],
    });
    expect(decision.lines[0]?.vatPoisha).toBe(500n);
    expect(decision.lines[0]?.vatClaimablePoisha).toBe(0n);
    expect(decision.lines[0]?.vatDisallowedPoisha).toBe(500n);
    expect(decision.lines[0]?.costPoisha).toBe(10_500n);
    expect(decision.vdsPoisha).toBe(500n);
  });

  it('applies the cash-limit guard to the supplier payable including VAT', () => {
    const below = calculatePurchaseTax({
      facts: { ...validFacts, paymentMethod: 'CASH' },
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 5_000_000n,
          discountPoisha: 0n,
          taxCategory: 'STANDARD_15',
        },
      ],
    });
    expect(below.lines[0]?.vatClaimablePoisha).toBe(750_000n);

    const above = calculatePurchaseTax({
      facts: { ...validFacts, paymentMethod: 'CASH' },
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000_000n,
          discountPoisha: 0n,
          taxCategory: 'STANDARD_15',
        },
      ],
    });
    expect(above.lines[0]?.vatClaimablePoisha).toBe(0n);
    expect(above.lines[0]?.vatDisallowedPoisha).toBe(1_500_000n);
    expect(above.warnings.join(' ')).toContain('cash settlement');
  });

  it('self-assesses reverse-charge VAT and only claims it when a challan reference is held', () => {
    const withoutChallan = calculatePurchaseTax({
      facts: { ...validFacts, vdsApplicable: false, tdsNature: 'NONE' },
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'REVERSE_CHARGE',
        },
      ],
    });
    expect(withoutChallan.supplierVatPoisha).toBe(0n);
    expect(withoutChallan.reverseChargeVatPoisha).toBe(1_500n);
    expect(withoutChallan.grossPoisha).toBe(10_000n);
    expect(withoutChallan.lines[0]?.vatClaimablePoisha).toBe(0n);
    expect(withoutChallan.lines[0]?.costPoisha).toBe(11_500n);

    const withChallan = calculatePurchaseTax({
      facts: {
        ...validFacts,
        vdsApplicable: false,
        tdsNature: 'NONE',
        reverseChargeChallanHeld: true,
      },
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'REVERSE_CHARGE',
        },
      ],
    });
    expect(withChallan.lines[0]?.vatClaimablePoisha).toBe(1_500n);
    expect(withChallan.lines[0]?.costPoisha).toBe(10_000n);
  });

  it('blocks out-of-scope purchases and dates outside the rule-pack effective period', () => {
    const outOfScope = calculatePurchaseTax({
      facts: validFacts,
      lines: [
        {
          lineId: 'line-1',
          quantity: 10_000n,
          unitPricePoisha: 10_000n,
          discountPoisha: 0n,
          taxCategory: 'OUT_OF_SCOPE',
        },
      ],
    });
    expect(outOfScope.decisionState).toBe('NOT_SUPPORTED');
    expect(() => assertPostablePurchaseTax(outOfScope)).toThrow(/NOT_SUPPORTED/);

    const expired = calculatePurchaseTax({
      facts: { ...validFacts, docDate: '2025-01-15' },
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
    expect(() => assertPostablePurchaseTax(expired)).toThrow(/SOURCE_DISPUTED_OR_EXPIRED/);
  });
});
