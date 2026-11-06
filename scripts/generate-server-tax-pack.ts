// Generates the server-side sales and purchase tax configuration from the single client rule pack.
//
// The server must never re-type a statutory rate. This script reads the existing versioned pack
// (src/core/tax-engine/rulePack.ts) and writes small, immutable snapshots used by the sales and
// purchase posting services. The server unit tests compare the generated files back to the pack so
// a reviewed rate change cannot silently drift between previews and posted documents.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  BD_2026_V1,
  CASH_DISALLOWANCE_LIMIT_POISHA,
  RULE_IDS,
  TDS_NO_TIN_UPSCALE_BPS,
  TDS_RATE_BPS_BY_NATURE,
  TDS_RULE_ID_BY_NATURE,
  VAT_RATE_BPS_BY_CATEGORY,
  VAT_RULE_ID_BY_CATEGORY,
  VDS_RATE_BPS_BY_CATEGORY,
  getRule,
} from '../src/core/tax-engine/rulePack';
import type { TdsNature, TaxCategory } from '../src/core/types';

function ruleSnapshot(ruleId: string | null | undefined) {
  if (!ruleId) return { ruleId: null, citation: null, status: null, effectiveFrom: null, effectiveTo: null, verifyFlag: null };
  const rule = getRule(ruleId);
  return {
    ruleId,
    citation: rule?.citation ?? null,
    status: rule?.status ?? null,
    effectiveFrom: rule?.effective_from ?? null,
    effectiveTo: rule?.effective_to ?? null,
    verifyFlag: rule?.verify_flag ?? null,
  };
}

const categories = Object.entries(VAT_RATE_BPS_BY_CATEGORY).map(([category, rateBps]) => {
  const ruleId = VAT_RULE_ID_BY_CATEGORY[category as TaxCategory];
  const rule = ruleId ? getRule(ruleId) : undefined;
  return {
    category,
    rateBps,
    ruleId,
    citation: rule?.citation ?? null,
    status: rule?.status ?? null,
    effectiveFrom: rule?.effective_from ?? null,
    effectiveTo: rule?.effective_to ?? null,
    verifyFlag: rule?.verify_flag ?? null,
  };
});

const commonPack = {
  version: BD_2026_V1.version,
  jurisdiction: BD_2026_V1.jurisdiction,
  titleEn: BD_2026_V1.title_en,
  publishedAt: BD_2026_V1.published_at,
  effectiveFrom: BD_2026_V1.effective_from,
  reviewer: BD_2026_V1.reviewer,
  reviewerStatus: BD_2026_V1.reviewer_status,
};

const salesPayload = {
  ...commonPack,
  categories: Object.fromEntries(categories.map((entry) => [entry.category, entry])),
};

const vdsRates = Object.fromEntries(
  Object.entries(VDS_RATE_BPS_BY_CATEGORY).map(([category, rateBps]) => [
    category,
    { rateBps, ...ruleSnapshot(RULE_IDS.VDS_WITHHOLDING_S49) },
  ]),
);

const tdsRates = Object.fromEntries(
  Object.entries(TDS_RATE_BPS_BY_NATURE).map(([nature, rateBps]) => [
    nature,
    { rateBps, ...ruleSnapshot(TDS_RULE_ID_BY_NATURE[nature as TdsNature]) },
  ]),
);

const purchasePayload = {
  ...commonPack,
  vatCategories: Object.fromEntries(categories.map((entry) => [entry.category, entry])),
  vdsRates,
  tdsRates,
  tdsNoTinUpscaleBps: TDS_NO_TIN_UPSCALE_BPS,
  tdsNoTinRule: ruleSnapshot(RULE_IDS.TDS_NO_TIN_PENALTY_50),
  vdsCertificateRule: ruleSnapshot(RULE_IDS.VDS_CERTIFICATE_MUSHAK_66),
  binRule: ruleSnapshot(RULE_IDS.BIN_FORMAT_THIRTEEN_DIGITS),
  etinRule: ruleSnapshot(RULE_IDS.ETIN_FORMAT_TWELVE_DIGITS),
  cashLimitRule: ruleSnapshot(RULE_IDS.CASH_DISALLOWANCE_LIMIT_1_LAKH),
  cashDisallowanceLimitPoisha: CASH_DISALLOWANCE_LIMIT_POISHA.toString(),
};

function writeGenerated(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
  console.log(`Wrote ${path}`);
}

const salesPath = resolve(process.cwd(), 'server/src/sales/taxPack.generated.ts');
writeGenerated(
  salesPath,
  `// GENERATED FILE — do not edit by hand.
// Source: src/core/tax-engine/rulePack.ts (${salesPayload.version}).
// Regenerate with: npm run taxpack:generate
//
// The pack is still marked ${salesPayload.reviewerStatus}. Sales posting therefore requires a recorded
// external approval for this exact version before any tax-bearing document can be posted.

export const SALES_TAX_PACK = ${JSON.stringify(salesPayload, null, 2)} as const;

export type SalesTaxCategory = keyof typeof SALES_TAX_PACK.categories;
`,
);

const purchasePath = resolve(process.cwd(), 'server/src/purchases/taxPack.generated.ts');
writeGenerated(
  purchasePath,
  `// GENERATED FILE — do not edit by hand.
// Source: src/core/tax-engine/rulePack.ts (${purchasePayload.version}).
// Regenerate with: npm run taxpack:generate
//
// The pack is still marked ${purchasePayload.reviewerStatus}. Purchase posting therefore requires a
// recorded external approval for this exact version before any tax-bearing document can be posted.
// The pack contains VAT, reverse-charge, VDS, TDS, no-TIN upscale and cash-limit configuration.
// It does not create statutory evidence; a supplier Mushak 6.3 serial is always user-supplied.

export const PURCHASE_TAX_PACK = ${JSON.stringify(purchasePayload, null, 2)} as const;

export type PurchaseTaxCategory = keyof typeof PURCHASE_TAX_PACK.vatCategories;
export type PurchaseVdsCategory = keyof typeof PURCHASE_TAX_PACK.vdsRates;
export type PurchaseTdsNature = keyof typeof PURCHASE_TAX_PACK.tdsRates;
`,
);
