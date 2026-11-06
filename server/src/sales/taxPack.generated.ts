// GENERATED FILE — do not edit by hand.
// Source: src/core/tax-engine/rulePack.ts (bd-2026-v1).
// Regenerate with: npm run taxpack:generate
//
// The pack is still marked PENDING_TAX_COUNSEL. Sales posting therefore requires a recorded
// external approval for this exact version before any tax-bearing document can be posted.

export const SALES_TAX_PACK = {
  version: 'bd-2026-v1',
  jurisdiction: 'BD',
  titleEn: 'Bangladesh Statutory Rule Pack 2026 (VAT, SD, VDS, TDS)',
  publishedAt: '2026-10-14',
  effectiveFrom: '2026-07-01',
  reviewer: 'Tax Counsel Review Queue — NBR citations pending sign-off',
  reviewerStatus: 'PENDING_TAX_COUNSEL',
  categories: {
    STANDARD_15: {
      category: 'STANDARD_15',
      rateBps: 1500,
      ruleId: 'VAT_STD_15',
      citation: 'VAT & SD Act 2012, s.15 and First/Third Schedule',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    TRADING_5: {
      category: 'TRADING_5',
      rateBps: 500,
      ruleId: 'VAT_TRADING_5',
      citation: 'VAT & SD Act 2012, Third Schedule (trading tier)',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    PROCUREMENT_7_5: {
      category: 'PROCUREMENT_7_5',
      rateBps: 750,
      ruleId: 'VAT_PROCUREMENT_7_5',
      citation: 'VAT & SD Act 2012, s.49 and the Third Schedule procurement-provider entry',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    EXPORT_ZERO: {
      category: 'EXPORT_ZERO',
      rateBps: 0,
      ruleId: 'VAT_EXPORT_ZERO',
      citation: 'VAT & SD Act 2012, s.24 (zero-rated supply)',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    EXEMPT: {
      category: 'EXEMPT',
      rateBps: 0,
      ruleId: 'VAT_EXEMPT',
      citation: 'VAT & SD Act 2012, First Schedule (exempt goods and services)',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    REVERSE_CHARGE: {
      category: 'REVERSE_CHARGE',
      rateBps: 1500,
      ruleId: 'VAT_REVERSE_CHARGE_S20',
      citation: 'VAT & SD Act 2012, s.20 (imported service — reverse charge)',
      status: 'ACTIVE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      verifyFlag: true,
    },
    OUT_OF_SCOPE: {
      category: 'OUT_OF_SCOPE',
      rateBps: 0,
      ruleId: null,
      citation: null,
      status: null,
      effectiveFrom: null,
      effectiveTo: null,
      verifyFlag: null,
    },
  },
} as const;

export type SalesTaxCategory = keyof typeof SALES_TAX_PACK.categories;
