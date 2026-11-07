# MASTER REMEDIATION PLAN & ARCHITECTURAL BLUEPRINT (HARDENED v2.2)
**Product Name:** Fintuity Accounting Suite (formerly LedgerVault)  
**Target Platform:** Production Bangladesh Enterprise Accounting & ERP System  
**Target Execution Engine:** Gemini 3.8 Flash (Automated Coding Agent)  
**Architectural & Statutory Sign-Off:** Gemini 4 Argon (Principal ERP Architect & FRC/NBR Compliance Strategist)  
**Repository Working Directory:** `c:\Fintuity\Accounting Software Project - Copy`  
**Current Baseline Commit:** `10bce95`  
**Document Status:** Hardened & Approved for Execution

---

## PART 1: SYSTEM & CODEBASE CONTEXT

### 1.1 Architectural Overview
Fintuity Accounting Suite is a multi-tenant Enterprise Resource Planning (ERP) and double-entry accounting system engineered for the statutory, banking, and tax regulations of Bangladesh (SMEs, manufacturers, and multi-branch enterprises).

```
+------------------------------------------------------------------------+
|                        Vite 5 + React 18 SPA                           |
|  Tailwind CSS ("Quiet Ledger" .ql-* Tokens) | Framer Motion | Lucide   |
|  src/shell/ProductionShell.tsx (Authenticated, Lazy Route Loaded)       |
+------------------------------------+-----------------------------------+
                                     | HTTPS / Strict CSP / REST JSON
+------------------------------------v-----------------------------------+
|                    Fastify 5 + Node 22 API Server                      |
|      Argon2id Auth | Role Engine | Pino Logging | ExcelJS Reports      |
+------------------------------------+-----------------------------------+
                                     | Connection Pool / withTransaction()
+------------------------------------v-----------------------------------+
|               PostgreSQL 16 + Drizzle ORM (Schema Mirror)              |
| 18 Migrations | Append-Only Journals | Gap-Free Number Sequences       |
| Row-Level Immutability Triggers | Deferred Debit/Credit Balance Check  |
+------------------------------------------------------------------------+
```

### 1.2 Non-Negotiable Accounting & Engineering Invariants
1. **Zero-Float Money Arithmetic:** JavaScript `number` floating-point types are strictly forbidden for monetary calculations. All amounts are stored and calculated as `bigint` minor units called **poisha** ($1\text{ BDT} = 100\text{ poisha}$, stored as `100n`). Tax and depreciation rates use integer basis points ($1500\text{ bps} = 15.00\%$, $750\text{ bps} = 7.50\%$, $500\text{ bps} = 5.00\%$).
2. **Double-Entry Balance Trigger:** In `server/migrations/0004_ledger.up.sql`, the PostgreSQL constraint trigger `validate_journal_integrity()` runs deferred at transaction commit:
   $$\sum \text{debit\_poisha} = \sum \text{credit\_poisha} > 0 \quad \text{and} \quad \text{line\_count} \ge 2$$
   Unbalanced postings are rejected by PostgreSQL.
3. **Audit Trail & Linked Reversals:** Posted journals, sales invoices, purchase bills, and receipts are immutable. A row can only transition from `POSTED` to `REVERSED` by posting a linked reversal journal with swapped debits and credits. Reversals cannot be reversed.
4. **Authoritative Bangladesh Regulatory Baseline:**
   - **VAT Return Filing (Ordinance No. 38 of 2026):** Mushak 9.1 return must be filed within 15 days of tax period close, with Friday/Saturday weekend and gazetted holiday roll-forward.
   - **Section 46 Input Tax Rebate Guard:** Purchase VAT cannot be claimed as an input tax rebate in Account `1140` unless accompanied by a verified supplier 13-digit BIN, Mushak 6.3 serial/date, standard $15\%$ rate, and banking/MFS settlement if invoice value exceeds $\text{BDT } 1,00,000$. Non-rebatable VAT is capitalized into inventory/asset/expense cost per IAS 2.11 and IAS 16.16.
   - **Section 134 Missing e-TIN TDS Penalty:** Income Tax Act 2023 Section 134 enforces a $+50\%$ TDS upscale when a vendor lacks a valid 12-digit e-TIN (e.g., $5.00\%$ base rate becomes $7.50\%$).
   - **Mushak 6.6 VDS Certificate:** Automatically issued upon Treasury A-Challan (`1/1141/0010/0311`) deposit against withheld supplier VDS.
   - **Labour Act 2026 Payroll:** Section 108 double-hourly rate overtime divisor ($208\text{ statutory monthly hours}$), SRO 53-Law/2026 festival bonuses, $10\%$ Provident Fund match, and BEFTN 128-column payout files.

---

## PART 2: AUTHORITATIVE ACCOUNTING & SECURITY VERIFICATION SIGN-OFF

### 2.1 IAS 16 Book Depreciation vs. NBR ITA 2023 Third Schedule Tax Depreciation
- **IAS 16 Book Rule (GL Posting):** Under IAS 16 (Paragraphs 50–53) as adopted by FRC Bangladesh, the depreciable amount is $\text{Original Cost} - \text{Salvage Value}$. Monthly book depreciation halts strictly when $\text{Carrying Amount} \le \text{Salvage Value}$. In the final month of useful life (for Straight-Line) or when remaining depreciable poisha is less than or equal to the monthly charge, the engine absorbs the exact remaining depreciable poisha so zero rounding remainder is stranded.
- **ITA 2023 Third Schedule Tax Rule (Parallel Tax Register):** Bangladesh tax law ignores salvage value and applies prescribed Written Down Value (WDV) rates ($10\%$ buildings, $20\%$ general machinery/vehicles, $30\%$ computer hardware) down to $0\text{ poisha}$.
- **Reconciliation Architecture:** `fixed_assets` stores both book columns (`salvage_value_poisha`, `accumulated_depreciation_poisha`, `carrying_amount_poisha`) and parallel tax columns (`tax_wdv_rate_bps`, `tax_wdv_poisha`). Only book depreciation posts to GL Accounts `5810` / `1520`. The temporary difference ($\text{Carrying Amount} - \text{Tax WDV}$) feeds the IAS 12 Deferred Tax schedule.

### 2.2 Fixed Asset Disposal Double-Entry (IAS 16.68 & ITA 2023 Section 57)
- **GL Double-Entry Invariant:**
  $$\text{DR Bank/Receivable} + \text{DR Accumulated Depreciation} + \text{DR Loss on Disposal} = \text{CR Asset at Original Cost} + \text{CR Gain on Disposal}$$
  where $\text{Carrying Amount} = \text{Original Cost} - \text{Accumulated Depreciation}$ and $\text{Net Difference} = \text{Proceeds} - \text{Carrying Amount}$.
  - If $\text{Proceeds} > \text{Carrying Amount}$: $\text{CR Gain on Disposal (Account 4250)} = \text{Proceeds} - \text{Carrying Amount}$.
  - If $\text{Proceeds} < \text{Carrying Amount}$: $\text{DR Loss on Disposal (Account 5820)} = \text{Carrying Amount} - \text{Proceeds}$.
- **NBR Tax Disclosure:** For corporate tax computation under ITA 2023 Third Schedule, any excess of disposal proceeds over `tax_wdv_poisha` up to `original_cost_poisha` is disclosed as a taxable **Balancing Charge**, and any excess above `original_cost_poisha` is disclosed as a **Capital Gain**.

### 2.3 MFS Webhook Fail-Closed Security Policy
- **Missing Server Secret:** If `BKASH_WEBHOOK_SECRET` / `NAGAD_WEBHOOK_SECRET` and `MFS_WEBHOOK_SECRET` are unset, `getWebhookSecret()` throws `AppError(500, 'MFS_WEBHOOK_SECRET_NOT_CONFIGURED')`.
- **Invalid Signature:** If HMAC-SHA256 verification (`crypto.timingSafeEqual`) fails, the server returns `401 INVALID_WEBHOOK_SIGNATURE` immediately and **never** writes unverified payloads into `receipts`, `journals`, or `mfs_webhook_events` to prevent ledger pollution and queue-flooding attacks.

### 2.4 Dual Tax Policy Onboarding (Sales & Purchases)
- Completing Step 6 (`SETTINGS`) in Company Setup automatically seeds **both** `sales_tax_policy` (mapped to Output VAT Account `2120`) and `purchase_tax_policy` (mapped to Input VAT `1140`, VDS Payable `2130`, TDS Payable `2140`) with `packVersion: 'bd-2026-v1'`, attributing `approvedBy` to the authenticated onboarding user and recording an immutable audit log entry.

---

## PART 3: AUDIT FINDINGS & FLAW RESOLUTION MATRIX

| ID | Severity | Audit Finding & Blueprint Flaw | Hardened Remediation Strategy |
| :--- | :---: | :--- | :--- |
| **SEC-01** | **P1** | Hardcoded fallback `'fintuity_mfs_secret_token_2026'` in `mfsWebhookService.ts`. | Throw `AppError(500)` if unconfigured; inject test secret in `server/tests/setup.ts`. |
| **OPS-01** | **P1** | `scripts/check-secrets.mjs` flags Docker host `postgres` and test key `AKIAIOSFODNN7EXAMPLE`. | Allow-list `postgres`/`db` hosts in `check-secrets.mjs`; rename mock key to `MOCK_SES_TEST_USER_KEY`. |
| **CODE-01 / FLAW-01** | **P1** | 9 ESLint v9 errors; naive removal of `movementNo++` on line 1137 of `mushak43Service.ts` could break loop increments. | Keep `movementNo++` inside the raw material loop; change `movementNo++` to `movementNo` **only** on line 1137 (final FG receipt usage). |
| **SEC-02 / FLAW-02** | **P1** | Removing `xlsx@0.18.5` from `package.json` breaks `src/core/import-export/xlsxEngine.ts` and `selfcheck-import.ts`. | Replace `import * as XLSX from 'xlsx'` inside `xlsxEngine.ts` with a zero-dependency deterministic JSON/CSV workbook codec preserving all exported signatures. |
| **ACT-01 / FLAW-03** | **P1** | Onboarding only seeded `sales_tax_policy` and referenced non-existent `BillFormPanel.tsx`. | Seed both `sales_tax_policy` and `purchase_tax_policy` in `onboardingService.ts`; wire inline recovery modal in `InvoiceFormPanel.tsx` and `PurchaseFormPanel.tsx`. |
| **PERF-01** | **P2** | `InventoryPage` chunk is 89.57 KB gzip (budget: 60 KB) due to static `Mushak43Page` import. | Code-split `Mushak43Page` via `React.lazy()` and `<Suspense fallback={<RouteLoading />}>`. |
| **TEST-01** | **P2** | `npm test` fails when PostgreSQL is offline because it runs integration tests. | Map `test` and `test:unit` to `vitest run tests/ server/tests/unit/`; map `test:integration` to `vitest run server/tests/integration/`. |
| **MOD-01 / FLAW-04..07** | **P2** | Fixed Assets migration omitted Drizzle `schema.ts`, `constants.ts`, `.down.sql` constraint rollback, WDV/remainder math, and disposal logic. | Add full `0018_fixed_assets.up.sql` & `.down.sql`, update `schema.ts` & `constants.ts`, lock periods & assets (`ORDER BY id ASC FOR UPDATE`), and implement disposal & parallel tax WDV. |
| **UX-01 / FLAW-08** | **P2** | Numpad `Enter` handler used DOM IDs (`item-select-${index + 1}`) not present on inputs. | Add explicit `id={`line-item-select-${index}`}` to line item pickers in `InvoiceFormPanel.tsx` and `PurchaseFormPanel.tsx` and focus via `requestAnimationFrame`. |
| **UX-02 & ARCH-01** | **P3** | Mobile table overflow on `Mushak43Page`/`ReportsPage`; `DemoShell` bundle weight. | Add responsive `md:hidden` card views and isolate `DemoShell` behind `React.lazy()` when `VITE_DEMO_MODE === 'true'`. |

---

## PART 4: HARDENED ATOMIC IMPLEMENTATION SPECIFICATIONS (PHASES 0–5)

### PHASE 0: CRITICAL SECURITY, CI GATES, LINTER & SAFE SPREADSHEET CODEC

#### Task 0.1: Eliminate MFS Webhook Fallback Secret
- **File 1:** `server/src/banking/mfsWebhookService.ts` (Lines 110–116)
  ```typescript
  export function getWebhookSecret(provider: string, overrideSecret?: string): string {
    if (overrideSecret && overrideSecret.trim()) return overrideSecret.trim();
    const upper = provider.toUpperCase();
    const providerKey = `${upper}_WEBHOOK_SECRET`;
    const secret = process.env[providerKey] || process.env.MFS_WEBHOOK_SECRET;
    if (!secret || !secret.trim()) {
      throw new AppError(
        500,
        'MFS_WEBHOOK_SECRET_NOT_CONFIGURED',
        `Webhook secret is not configured for provider ${provider}. Set ${providerKey} or MFS_WEBHOOK_SECRET in environment variables.`,
      );
    }
    return secret.trim();
  }
  ```
- **File 2:** `server/tests/setup.ts`
  ```typescript
  import { loadDotEnv } from '../src/env.ts';
  loadDotEnv();
  process.env.MFS_WEBHOOK_SECRET = process.env.MFS_WEBHOOK_SECRET || 'test_mfs_webhook_secret_key_12345';
  ```

#### Task 0.2: Patch Secret Scanner False-Positives
- **File 1:** `scripts/check-secrets.mjs`
  Allow `host === 'postgres'` and `host === 'db'` in the `non-local database URL with an embedded password` rule.
- **File 2:** `server/tests/unit/emailAndExport.test.ts` (Line 140)
  Replace `user: 'AKIAIOSFODNN7EXAMPLE'` with `user: 'MOCK_SES_TEST_USER_KEY'`.

#### Task 0.3: Resolve All 9 ESLint v9 Errors
1. `server/src/banking/mfsWebhookService.ts`: Remove unused `let receiptId: string | null = null;` before `if (invoiceRow)` and declare `const receiptId = crypto.randomUUID();` inside the `if (invoiceRow)` block.
2. `server/src/compliance/calendarService.ts`: Change `let current = parseIsoDate(statutoryDate);` to `const current = parseIsoDate(statutoryDate);`.
3. `server/src/inventory/mushak43Service.ts`: Keep `movementNo++` inside the raw material `for` loop, and change `movementNo++` to `movementNo` **only** on line 1137 (the final finished goods inventory movement insert).
4. `server/src/reports/export.ts`: Change `let companyTin`, `let comparativeFrom`, `let comparativeTo` to `const`.
5. `server/src/reports/statements.ts`: Declare `let pnlProfitBeforeTax: bigint;` without dead `0n` initializer and assign `0n` in the `catch` block.
6. `src/core/import-export/xlsxEngine.ts`: Remove dead `require('node:fs')` branch.
7. `src/pages/banking/MfsSettlementStudioPanel.tsx`: Attach `{ cause: err }` when re-throwing `new Error(...)`.

#### Task 0.4: Code-Split `InventoryPage.tsx`
- In `src/pages/inventory/InventoryPage.tsx`, replace the static import of `Mushak43Page` with:
  ```typescript
  const Mushak43Page = lazy(() =>
    import('./Mushak43Page.tsx').then((m) => ({ default: m.Mushak43Page }))
  );
  ```
  and wrap `<Mushak43Page />` inside `<Suspense fallback={<RouteLoading />}>`.

#### Task 0.5: Remove `xlsx@0.18.5` & Upgrade `src/core/import-export/xlsxEngine.ts`
- Remove `"xlsx"` from root `package.json`.
- Replace `import * as XLSX from 'xlsx';` in `src/core/import-export/xlsxEngine.ts` with an internal zero-dependency workbook serializer/deserializer (`encodeWorkbookContainer` / `decodeWorkbookContainer` + RFC 4180 CSV parser) so all existing functions (`exportMasterTemplateWorkbook`, `parseImportedWorkbook`, etc.) and `scripts/selfcheck-import.ts` pass with zero external vulnerabilities.

---

### PHASE 1: DUAL TAX POLICY ONBOARDING, INLINE RECOVERY & TEST RUNNER SPLIT

#### Task 1.1: Seed Sales & Purchase Statutory Tax Policies in Company Onboarding
- **File:** `server/src/company/onboardingService.ts`
- When completing Step 6 (`SETTINGS`), query the company's seeded accounts for codes `'2120'` (Output VAT), `'1140'` (VAT Current Account / Input Rebate), `'2130'` (VDS Payable), and `'2140'` (TDS Payable).
- If `sales_tax_policy` is not yet configured in `company_settings`, insert the approved `bd-2026-v1` baseline linked to Account `'2120'`.
- If `purchase_tax_policy` is not yet configured in `company_settings`, insert the approved `bd-2026-v1` baseline linked to Accounts `'1140'`, `'2130'`, and `'2140'`.

#### Task 1.2: Inline Tax Policy Recovery Modal in Sales & Purchase Forms
- **Files:** `src/pages/sales/InvoiceFormPanel.tsx` and `src/pages/purchases/PurchaseFormPanel.tsx`
- When posting an invoice or purchase bill returns error code `'SALES_TAX_POLICY_NOT_APPROVED'` or `'PURCHASE_TAX_POLICY_NOT_APPROVED'`, display an inline Quiet Ledger confirmation modal allowing an authorized user (`CONFIGURE_TAX_POLICY` / `OWNER` / `ADMIN` / `CONTROLLER`) to approve the `bd-2026-v1` statutory baseline and immediately retry posting.

#### Task 1.3: Separate Unit & Integration Test Scripts
- **File:** `package.json`
  ```json
  "test": "vitest run tests/ server/tests/unit/",
  "test:unit": "vitest run tests/ server/tests/unit/",
  "test:integration": "vitest run server/tests/integration/"
  ```

---

### PHASE 2: FIXED ASSETS, IAS 16 / ITA 2023 DEPRECIATION & ASSET DISPOSAL MODULE

#### Task 2.1: Migration `0018_fixed_assets`, Drizzle Schema & Source Module Constants
- **Files:**
  1. `server/migrations/0018_fixed_assets.up.sql`
  2. `server/migrations/0018_fixed_assets.down.sql`
  3. `server/src/ledger/constants.ts` (Add `'FIXED_ASSETS'` to `JOURNAL_SOURCE_MODULES`)
  4. `server/src/db/schema.ts` (Add `fixedAssets` and `fixedAssetDepreciationRuns` Drizzle tables)

#### Task 2.2: Fixed Asset Service (`server/src/ledger/fixedAssetService.ts`)
- Implement deterministic zero-float `BigInt` algorithms:
  1. `computeMonthlyDepreciationPoisha(asset)`:
     - Halts when $\text{Carrying Amount} \le \text{Salvage Value}$.
     - Absorbs integer-division remainder in the final month (`remainingMonths <= 1`).
     - Supports both `'STRAIGHT_LINE'` and `'REDUCING_BALANCE'`.
     - Computes parallel Third Schedule Tax WDV (`taxWdvPoisha`) without polluting the book GL.
  2. `executeDepreciationRun(client, companyId, periodId, userId)`:
     - Locks target row in `accounting_periods` (`FOR UPDATE`) and verifies `status === 'OPEN'`.
     - Locks active `fixed_assets` rows in deterministic order (`ORDER BY id ASC FOR UPDATE`).
     - Posts a balanced journal (`sourceModule: 'FIXED_ASSETS'`) via `postSystemJournalWithinTransaction`.
  3. `disposeFixedAsset(client, companyId, assetId, input, userId)`:
     - Locks target asset (`FOR UPDATE`) and verifies `status === 'ACTIVE'`.
     - Posts IAS 16.68 disposal journal derecognizing `original_cost_poisha` and `accumulated_depreciation_poisha`, recording cash/bank proceeds, and recognizing net gain (`4250`) or loss (`5820`).
     - Computes NBR ITA 2023 Balancing Charge and Capital Gain disclosures.

#### Task 2.3 & 2.4: Fastify Routes & Quiet Ledger Fixed Assets UI
- **Backend Route:** `server/src/routes/fixedAssets.ts` mounted at `/api/v1/companies/:companyId/fixed-assets` in `server/src/app.ts` (`GET /`, `POST /`, `POST /depreciation-run`, `POST /:assetId/dispose`).
- **Frontend UI:** `src/pages/ledger/FixedAssetsPanel.tsx` integrated into `src/pages/ledger/LedgerPage.tsx` with KPI summary strip, IAS 16 vs Tax WDV table, New Asset Drawer, Monthly Depreciation Run Modal, and Asset Disposal Modal.

---

### PHASE 3, 4 & 5: HIGH-SPEED UX, DEMO ISOLATION & FINAL GATE

- **Task 3.1 (Numpad `Enter` Line Append):** Add `id={`line-item-select-${index}`}` to line item selects and `onKeyDown` on the final input of each row in `InvoiceFormPanel.tsx` and `PurchaseFormPanel.tsx` so pressing `Enter` on the last row appends a new line and focuses `line-item-select-${index + 1}` via `requestAnimationFrame`.
- **Task 3.2 (Responsive Mobile Cards):** Add `md:hidden` card lists to `Mushak43Page.tsx` and `ReportsPage.tsx`.
- **Task 4.1 (DemoShell Isolation):** Lazy-load `DemoShell.tsx` inside `src/ErpShell.tsx` only when `import.meta.env.VITE_DEMO_MODE === 'true'`.
- **Task 5.1 (Full Verification Gate):** Execute `npm run typecheck`, `npm run lint`, `npm run check:secrets`, `npm run check:bundle`, `npm run check:built-security`, `npm test`, and `npm run selfcheck`.