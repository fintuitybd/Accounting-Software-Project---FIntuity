# GEMINI 3.8 FLASH — TASK-BY-TASK EXECUTION PROMPTS (PHASES 0–5)
**Usage Instructions:** Copy and paste each prompt sequentially into your Gemini 3.8 Flash coding session. Run the verification command at the bottom of each prompt before proceeding to the next prompt.

---

## PROMPT 0.1 & 0.2: MFS WEBHOOK FAIL-CLOSED SECRET & SECRET SCANNER ALLOW-LIST

```markdown
### OBJECTIVE
Execute **Task 0.1** and **Task 0.2** of the Fintuity Accounting Suite remediation plan:
1. Remove the hardcoded fallback secret `'fintuity_mfs_secret_token_2026'` from `server/src/banking/mfsWebhookService.ts` so unconfigured environments fail closed with `AppError(500, 'MFS_WEBHOOK_SECRET_NOT_CONFIGURED')`.
2. Configure a default test secret in `server/tests/setup.ts` so unit and integration tests have a deterministic secret.
3. Update `scripts/check-secrets.mjs` to allow Docker service hostnames (`postgres`, `db`) and replace the example AWS key in `server/tests/unit/emailAndExport.test.ts`.

### EXACT FILE EDITS

#### 1. `server/src/banking/mfsWebhookService.ts`
Locate `getWebhookSecret` (around lines 110–116) and replace it with:
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
Also verify that when HMAC-SHA256 signature validation fails in `processMfsWebhook`, it throws `new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature verification failed')` before any database insert into `mfs_webhook_events`, `receipts`, or `journals`.

#### 2. `server/tests/setup.ts`
Ensure `MFS_WEBHOOK_SECRET` is initialized for tests after `loadDotEnv()`:
```typescript
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();
process.env.MFS_WEBHOOK_SECRET = process.env.MFS_WEBHOOK_SECRET || 'test_mfs_webhook_secret_key_12345';
```

#### 3. `scripts/check-secrets.mjs`
In the `non-local database URL with an embedded password` rule (around lines 25–40), update `allow`:
```javascript
  {
    name: 'non-local database URL with an embedded password',
    regex: /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@([^/\s:]+)/g,
    allow: (match) => {
      const host = match[1] ?? '';
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === 'postgres' ||
        host === 'db' ||
        host.endsWith('.test') ||
        host.endsWith('.local') ||
        host.endsWith('example.test') ||
        /replace-with-a-local-password|not-a-real-secret|ci_only/i.test(match[0] ?? '')
      );
    },
  },
```

#### 4. `server/tests/unit/emailAndExport.test.ts`
Around line 140, replace:
```typescript
user: 'AKIAIOSFODNN7EXAMPLE',
```
with:
```typescript
user: 'MOCK_SES_TEST_USER_KEY',
```

### VERIFICATION COMMANDS
Run:
1. `npm run check:secrets`
2. `npx vitest run server/tests/unit/app.test.ts server/tests/unit/emailAndExport.test.ts`
```

---

## PROMPT 0.3: RESOLVE ALL 9 ESLINT COMPILATION ERRORS SAFELY

```markdown
### OBJECTIVE
Execute **Task 0.3** of the remediation plan: Resolve all 9 ESLint errors across 7 files without altering business logic or breaking loop counters.

### EXACT FILE EDITS

1. **`server/src/banking/mfsWebhookService.ts` (around line 627):**
   - Remove the unused outer declaration `let receiptId: string | null = null;`.
   - Inside the `if (invoiceRow) {` block where the receipt is inserted, declare `const receiptId = crypto.randomUUID();`.

2. **`server/src/compliance/calendarService.ts` (around line 134):**
   - Change `let current = parseIsoDate(statutoryDate);` to `const current = parseIsoDate(statutoryDate);`.

3. **`server/src/inventory/mushak43Service.ts` (around line 1137):**
   - CRITICAL: Keep `movementNo++` untouched inside the raw-material `for` loop.
   - Change `movementNo++` to `movementNo` **only** on line 1137 (the final finished-goods receipt `inventory_movements` insert where `movementNo` is never read again).

4. **`server/src/reports/export.ts` (around lines 698–702):**
   - Change `let companyTin = ...`, `let comparativeFrom = ...`, and `let comparativeTo = ...` to `const`.

5. **`server/src/reports/statements.ts` (around line 952):**
   - Change `let pnlProfitBeforeTax = 0n;` to `let pnlProfitBeforeTax: bigint;` and ensure the `catch` block assigns `pnlProfitBeforeTax = 0n;`.

6. **`src/core/import-export/xlsxEngine.ts` (around lines 1124–1130):**
   - Remove any Node-only `require('node:fs')` call from this browser-shared module.

7. **`src/pages/banking/MfsSettlementStudioPanel.tsx` (around line 166):**
   - In the `catch (err)` block, attach `{ cause: err }`:
     ```typescript
     throw new Error(`Invalid JSON in transactions list: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
     ```

### VERIFICATION COMMANDS
Run:
1. `npm run lint` (Must exit 0 with 0 errors)
2. `npm run typecheck`
```

---

## PROMPT 0.4 & 0.5: CODE-SPLIT `InventoryPage` & REPLACE `xlsx@0.18.5` WITH SAFE CODEC

```markdown
### OBJECTIVE
Execute **Task 0.4** and **Task 0.5**:
1. Code-split `Mushak43Page` in `src/pages/inventory/InventoryPage.tsx` using `React.lazy()` so the `InventoryPage` chunk drops below the 60 KB gzip budget.
2. Remove the vulnerable `"xlsx"` dependency from root `package.json` and replace `import * as XLSX from 'xlsx'` inside `src/core/import-export/xlsxEngine.ts` with a zero-dependency deterministic SpreadsheetML/JSON/CSV workbook codec so all existing imports, exports, and `scripts/selfcheck-import.ts` continue to work identically.

### EXACT FILE EDITS

#### 1. `src/pages/inventory/InventoryPage.tsx`
- Replace `import { Mushak43Page } from './Mushak43Page';` (or `./Mushak43Page.tsx`) with:
  ```typescript
  import React, { lazy, Suspense } from 'react';
  import { RouteLoading } from '../../shell/RouteStates';

  const Mushak43Page = lazy(() =>
    import('./Mushak43Page').then((m) => ({ default: m.Mushak43Page }))
  );
  ```
- Wrap the rendered `<Mushak43Page ... />` element in:
  ```tsx
  <Suspense fallback={<RouteLoading label="Loading Mushak 4.3 Studio..." />}>
    <Mushak43Page />
  </Suspense>
  ```

#### 2. `package.json` & `src/core/import-export/xlsxEngine.ts`
- Remove `"xlsx"` from `dependencies` in `package.json`.
- In `src/core/import-export/xlsxEngine.ts`, remove `import * as XLSX from 'xlsx';`.
- Implement an internal zero-dependency workbook container in `src/core/import-export/xlsxEngine.ts` that supports multi-sheet serialization to `Uint8Array` and deserialization from `Uint8Array | ArrayBuffer` (plus CSV text parsing fallback), preserving **every** exported function name, parameter type, and return interface in `xlsxEngine.ts`.

### VERIFICATION COMMANDS
Run:
1. `npm run typecheck`
2. `npm run build && npm run check:bundle`
3. `npx tsx scripts/selfcheck-import.ts`
4. `npm audit --omit=dev`
```

---

## PROMPT 1.1, 1.2 & 1.3: DUAL TAX POLICY ONBOARDING, INLINE RECOVERY & TEST SCRIPT SPLIT

```markdown
### OBJECTIVE
Execute **Phase 1 (Tasks 1.1, 1.2, and 1.3)**:
1. Auto-seed **both** `sales_tax_policy` and `purchase_tax_policy` (`bd-2026-v1`) during Step 6 (`SETTINGS`) in `server/src/company/onboardingService.ts` so newly onboarded companies can immediately post sales invoices and purchase bills.
2. Add an inline Quiet Ledger Tax Policy Approval recovery modal in `src/pages/sales/InvoiceFormPanel.tsx` and `src/pages/purchases/PurchaseFormPanel.tsx` when `SALES_TAX_POLICY_NOT_APPROVED` or `PURCHASE_TAX_POLICY_NOT_APPROVED` is returned.
3. Split `test`, `test:unit`, and `test:integration` in root `package.json`.

### EXACT FILE EDITS

#### 1. `server/src/company/onboardingService.ts`
When completing Step 6 (`SETTINGS`), look up the company's accounts for codes `'2120'` (Output VAT), `'1140'` (Input VAT Current Account), `'2130'` (VDS Payable), and `'2140'` (TDS Payable). If `sales_tax_policy` or `purchase_tax_policy` is missing in `company_settings`, insert them as `APPROVED` with `packVersion: 'bd-2026-v1'`, `reviewerQualification: 'Statutory Baseline Adoption (Ordinance No. 38 of 2026 & ITA 2023)'`, `approvedBy: actorUserId`, and `approvedAt: new Date().toISOString()`.

#### 2. `src/pages/sales/InvoiceFormPanel.tsx` & `src/pages/purchases/PurchaseFormPanel.tsx`
- In the submit error handler, detect `err?.code === 'SALES_TAX_POLICY_NOT_APPROVED'` (in `InvoiceFormPanel.tsx`) or `err?.code === 'PURCHASE_TAX_POLICY_NOT_APPROVED'` (in `PurchaseFormPanel.tsx`).
- Render a `.ql-card` modal dialog titled `"Adopt Bangladesh Statutory Tax Baseline (bd-2026-v1)"` showing the statutory VAT/TDS account mappings and a `"Confirm Policy & Post Document"` button (`.ql-btn-primary`) that calls the respective `approveTaxPolicy` API endpoint and immediately retries posting the document.

#### 3. `package.json`
Update the test scripts in root `package.json`:
```json
"test": "vitest run tests/ server/tests/unit/",
"test:unit": "vitest run tests/ server/tests/unit/",
"test:integration": "vitest run server/tests/integration/"
```

### VERIFICATION COMMANDS
Run:
1. `npm run typecheck`
2. `npm test`
```

---

## PROMPT 2.1: FIXED ASSETS MIGRATION `0018`, DRIZZLE SCHEMA & LEDGER CONSTANTS

```markdown
### OBJECTIVE
Execute **Task 2.1**: Create PostgreSQL migration `0018_fixed_assets.up.sql` and `0018_fixed_assets.down.sql`, add `'FIXED_ASSETS'` to `server/src/ledger/constants.ts`, and mirror `fixedAssets` and `fixedAssetDepreciationRuns` in `server/src/db/schema.ts`.

### FILES TO CREATE OR MODIFY
1. `server/migrations/0018_fixed_assets.up.sql`
2. `server/migrations/0018_fixed_assets.down.sql`
3. `server/src/ledger/constants.ts`
4. `server/src/db/schema.ts`

### EXACT IMPLEMENTATION

#### 1. `server/migrations/0018_fixed_assets.up.sql`
```sql
CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
  asset_code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  asset_category text NOT NULL CHECK (asset_category IN ('BUILDING', 'PLANT_MACHINERY', 'OFFICE_EQUIPMENT', 'FURNITURE', 'VEHICLES', 'COMPUTERS')),
  acquisition_date date NOT NULL,
  original_cost_poisha bigint NOT NULL CHECK (original_cost_poisha > 0),
  salvage_value_poisha bigint NOT NULL DEFAULT 0 CHECK (salvage_value_poisha >= 0),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  months_depreciated integer NOT NULL DEFAULT 0 CHECK (months_depreciated >= 0),
  depreciation_method text NOT NULL CHECK (depreciation_method IN ('STRAIGHT_LINE', 'REDUCING_BALANCE')),
  depreciation_rate_bps integer NOT NULL CHECK (depreciation_rate_bps >= 0),
  tax_wdv_rate_bps integer NOT NULL DEFAULT 2000 CHECK (tax_wdv_rate_bps >= 0),
  tax_wdv_poisha bigint NOT NULL DEFAULT 0 CHECK (tax_wdv_poisha >= 0),
  asset_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  depreciation_expense_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISPOSED', 'WRITTEN_OFF')),
  accumulated_depreciation_poisha bigint NOT NULL DEFAULT 0 CHECK (accumulated_depreciation_poisha >= 0),
  carrying_amount_poisha bigint NOT NULL CHECK (carrying_amount_poisha >= 0),
  disposed_at date,
  disposal_proceeds_poisha bigint,
  disposal_journal_id uuid REFERENCES journals(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT fixed_assets_code_unique UNIQUE (company_id, asset_code),
  CONSTRAINT fixed_assets_salvage_lte_cost CHECK (salvage_value_poisha <= original_cost_poisha)
);

CREATE INDEX fixed_assets_company_status_idx ON fixed_assets(company_id, status);

CREATE TABLE fixed_asset_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  run_date date NOT NULL,
  total_depreciation_poisha bigint NOT NULL CHECK (total_depreciation_poisha >= 0),
  journal_id uuid REFERENCES journals(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depr_runs_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT depr_runs_period_unique UNIQUE (company_id, period_id)
);

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals ADD CONSTRAINT journals_source_module_check CHECK (
  source_module IN (
    'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'PAYROLL', 'MANUAL_JOURNAL',
    'IFRS_ADJUSTMENT', 'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY',
    'MANUFACTURING', 'TREASURY', 'BANK_RECONCILIATION', 'SUSPENSE', 'FIXED_ASSETS'
  )
);
```

#### 2. `server/migrations/0018_fixed_assets.down.sql`
```sql
DROP TABLE IF EXISTS fixed_asset_depreciation_runs;
DROP TABLE IF EXISTS fixed_assets;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals ADD CONSTRAINT journals_source_module_check CHECK (
  source_module IN (
    'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'PAYROLL', 'MANUAL_JOURNAL',
    'IFRS_ADJUSTMENT', 'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY',
    'MANUFACTURING', 'TREASURY', 'BANK_RECONCILIATION', 'SUSPENSE'
  )
);
```

#### 3. `server/src/ledger/constants.ts` & `server/src/db/schema.ts`
- Add `'FIXED_ASSETS'` to `JOURNAL_SOURCE_MODULES` in `server/src/ledger/constants.ts`.
- Add the corresponding `fixedAssets` and `fixedAssetDepreciationRuns` `pgTable` definitions to `server/src/db/schema.ts`.

### VERIFICATION COMMANDS
Run:
1. `npm run typecheck`
2. `npx vitest run server/tests/unit/migrations.test.ts`
```

---

## PROMPT 2.2 & 2.3: FIXED ASSET BACKEND ENGINE (IAS 16 + ITA 2023 3RD SCHEDULE + DISPOSAL) & ROUTES

```markdown
### OBJECTIVE
Execute **Task 2.2** and **Task 2.3**:
1. Create `server/src/ledger/fixedAssetService.ts` implementing Fixed Asset registration, IAS 16 Straight-Line & Reducing-Balance monthly book depreciation (halting strictly at `salvage_value_poisha` and absorbing final-month integer remainders), parallel NBR ITA 2023 Third Schedule Tax WDV computation, deadlock-free `ORDER BY id ASC FOR UPDATE` locking, and IAS 16.68 Fixed Asset Disposal journal posting.
2. Create `server/src/routes/fixedAssets.ts` and register it in `server/src/app.ts` under `/api/v1/companies/:companyId/fixed-assets`.
3. Create unit tests in `server/tests/unit/fixedAssetMath.test.ts`.

### EXACT IMPLEMENTATION REQUIREMENTS (`server/src/ledger/fixedAssetService.ts`)

1. **`computeMonthlyDepreciationPoisha(asset)`:**
   - `const depreciableRemaining = asset.carryingAmountPoisha - asset.salvageValuePoisha;`
   - If `depreciableRemaining <= 0n`, return `0n`.
   - `const remainingMonths = asset.usefulLifeMonths - asset.monthsDepreciated;`
   - If `asset.depreciationMethod === 'STRAIGHT_LINE'`:
     - If `remainingMonths <= 1`, return `depreciableRemaining` (absorbs any poisha remainder so `carryingAmountPoisha` lands on `salvageValuePoisha`).
     - Otherwise `monthlyCharge = (asset.originalCostPoisha - asset.salvageValuePoisha) / BigInt(asset.usefulLifeMonths)`.
   - If `asset.depreciationMethod === 'REDUCING_BALANCE'`:
     - `monthlyCharge = (asset.carryingAmountPoisha * BigInt(asset.depreciationRateBps)) / 120000n`.
     - If `remainingMonths <= 1` or `monthlyCharge > depreciableRemaining`, return `depreciableRemaining`.
   - Parallel Tax WDV monthly step:
     - `taxDepr = (asset.taxWdvPoisha * BigInt(asset.taxWdvRateBps)) / 120000n` (floors at `0n`, ignores salvage value per ITA 2023 3rd Schedule).

2. **`executeDepreciationRun(client, companyId, input, actorUserId)`:**
   - Lock the target period in `accounting_periods` (`SELECT id, status, end_date FROM accounting_periods WHERE company_id = $1 AND id = $2 FOR UPDATE`) and throw `AppError(409, 'PERIOD_NOT_OPEN')` if `status !== 'OPEN'`.
   - Lock all active assets for the company in deterministic primary-key order (`SELECT * FROM fixed_assets WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY id ASC FOR UPDATE`).
   - Aggregate debit lines (`depreciation_expense_account_id`) and credit lines (`accumulated_depreciation_account_id`), post a single balanced journal with `sourceModule: 'FIXED_ASSETS'` via `postSystemJournalWithinTransaction`, update each asset's `accumulated_depreciation_poisha`, `carrying_amount_poisha`, `months_depreciated`, and `tax_wdv_poisha`, and insert into `fixed_asset_depreciation_runs`.

3. **`disposeFixedAsset(client, companyId, assetId, input, actorUserId)`:**
   - Lock the target asset row (`FOR UPDATE`), verify `status === 'ACTIVE'`.
   - Compute `carryingAmountPoisha = originalCostPoisha - accumulatedDepreciationPoisha` and `netDiffPoisha = proceedsPoisha - carryingAmountPoisha`.
   - Build balanced journal lines:
     - **DR** Bank/Receivable Account: `proceedsPoisha` (if `> 0n`)
     - **DR** Accumulated Depreciation Account: `accumulatedDepreciationPoisha` (if `> 0n`)
     - **DR** Loss on Disposal Account: `-netDiffPoisha` (if `netDiffPoisha < 0n`)
     - **CR** Fixed Asset Cost Account: `originalCostPoisha`
     - **CR** Gain on Disposal Account: `netDiffPoisha` (if `netDiffPoisha > 0n`)
   - Post journal (`sourceModule: 'FIXED_ASSETS'`), mark asset `status = 'DISPOSED'`, `carrying_amount_poisha = 0n`, and return both IAS 16 gain/loss and NBR ITA 2023 Balancing Charge / Capital Gain disclosures.

### VERIFICATION COMMANDS
Run:
1. `npm run typecheck`
2. `npx vitest run server/tests/unit/fixedAssetMath.test.ts`
```

---

## PROMPT 2.4: QUIET LEDGER FIXED ASSETS FRONTEND STUDIO (`FixedAssetsPanel.tsx`)

```markdown
### OBJECTIVE
Execute **Task 2.4**: Build the Quiet Ledger Fixed Assets & IAS 16 / ITA 2023 Depreciation Studio in `src/pages/ledger/FixedAssetsPanel.tsx`, add client API methods in `src/ledger/api.ts`, and mount the `"FIXED_ASSETS"` tab in `src/pages/ledger/LedgerPage.tsx`.

### FILES TO CREATE OR MODIFY
1. `src/ledger/api.ts`
2. `src/pages/ledger/FixedAssetsPanel.tsx`
3. `src/pages/ledger/LedgerPage.tsx`
4. `src/core/locales/enCore.ts` & `src/core/locales/bnCore.ts`

### UI/UX REQUIREMENTS (`src/pages/ledger/FixedAssetsPanel.tsx`)
Use **only** Quiet Ledger classes (`.ql-card`, `.ql-table`, `.ql-btn-primary`, `.ql-btn-secondary`, `.ql-badge`, `.ql-mono`):
1. **4-Card KPI Strip:**
   - `Gross Fixed Assets at Cost (BDT)`
   - `Accumulated Depreciation (BDT)`
   - `IAS 16 Net Carrying Amount (BDT)`
   - `ITA 2023 3rd Schedule Tax WDV & Temporary Difference (BDT)`
2. **Interactive Fixed Asset Register Table:**
   - Columns: `Asset Code`, `Name & Category`, `Acquisition Date`, `Method & Rate`, `Original Cost`, `Salvage Value`, `Accumulated Depr.`, `IAS 16 Carrying Value`, `Tax WDV (ITA 2023)`, `Status`, and `Actions` (`Dispose Asset`).
   - All monetary values formatted in Bangladeshi Lakh/Crore notation inside `.ql-mono` (`tabular-nums`).
3. **3 Interactive Modals / Drawers:**
   - **Register New Asset Modal:** Category picker auto-suggests default ITA 2023 Third Schedule Tax WDV rate (`BUILDING` $10\%$, `PLANT_MACHINERY` $20\%$, `COMPUTERS` $30\%$) and GL accounts (`1510` Asset Cost, `1520` Accumulated Depreciation, `5810` Depreciation Expense).
   - **Monthly Depreciation Run Modal:** Selects open period, previews exact per-asset depreciation charge and balanced GL journal (`DR 5810 / CR 1520`), and executes in 1 click.
   - **IAS 16 Asset Disposal Modal:** Inputs disposal date, proceeds (BDT), and settlement bank account, displaying a live preview of the 5-leg disposal journal, IAS 16 Gain/Loss, and NBR Balancing Charge before posting.

### VERIFICATION COMMANDS
Run:
1. `npm run typecheck`
2. `npm run build && npm run check:bundle`
```

---

## PROMPT 3.1, 3.2, 4.1 & 5.1: NUMPAD UX, RESPONSIVE CARDS, DEMO ISOLATION & FINAL GATE

```markdown
### OBJECTIVE
Execute **Phase 3 (Tasks 3.1, 3.2)**, **Phase 4 (Task 4.1)**, and **Phase 5 (Task 5.1)**:
1. Add Excel-style Numpad `Enter` row addition and deterministic focus management to `src/pages/sales/InvoiceFormPanel.tsx` and `src/pages/purchases/PurchaseFormPanel.tsx`.
2. Add responsive mobile card views (`md:hidden`) to `src/pages/inventory/Mushak43Page.tsx` and `src/pages/reports/ReportsPage.tsx`.
3. Isolate `DemoShell` behind `React.lazy()` in `src/ErpShell.tsx` so production builds exclude demo workspace chunks.
4. Run the complete release verification suite.

### EXACT FILE EDITS

#### 1. `src/pages/sales/InvoiceFormPanel.tsx` & `src/pages/purchases/PurchaseFormPanel.tsx`
- Add `id={`invoice-line-item-${index}`}` (and `id={`purchase-line-item-${index}`}` in purchases) to the first interactive input/select of each line row.
- On the last interactive field of each line row, attach:
  ```typescript
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey && index === lines.length - 1) {
      e.preventDefault();
      addLine();
      requestAnimationFrame(() => {
        document.getElementById(`invoice-line-item-${index + 1}`)?.focus();
      });
    }
  }}
  ```

#### 2. `src/pages/inventory/Mushak43Page.tsx` & `src/pages/reports/ReportsPage.tsx`
- Add `hidden md:block` to wide desktop table wrappers and add a companion `<div className="md:hidden space-y-3">` rendering each item/statement row as a compact `.ql-card` with `.ql-mono` amounts.

#### 3. `src/ErpShell.tsx`
- Replace any static import of `DemoShell` with:
  ```typescript
  const DemoShell = React.lazy(() =>
    import('./demo/DemoShell').then((m) => ({ default: m.DemoShell }))
  );
  ```
  so Rollup isolates it from the main entry bundle.

### FINAL RELEASE VERIFICATION GATE
Run all commands sequentially and verify exit code 0 on every gate:
1. `npm run typecheck`
2. `npm run lint`
3. `npm run check:secrets`
4. `npm run build`
5. `npm run check:bundle`
6. `npm run check:built-security`
7. `npm test`
8. `npm run selfcheck`
```