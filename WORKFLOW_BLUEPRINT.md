# LEDGERVAULT AUTHORITATIVE WORKFLOW, ACCOUNTING & UX BLUEPRINT
# Purpose: Single source of truth for all state machines, TypeScript contracts, accounting rules, and UI layouts.

---

## 1. STRICT TOKEN & EXECUTION RULES (READ FIRST)
1. **NEVER read `src/core/ledger/seedData.ts` (108KB) in full.** If you need its exports, read only lines 1–60.
2. **Read ONLY the files listed in the active Task Prompt.** Do not run broad repository searches.
3. **Never write temporary test scripts (`scripts/smoke-*.ts`).**
4. **Edit all target files for the task first, then run `npx tsc --noEmit` ONCE at the end.** When `npx tsc --noEmit` exits with `0`, STOP IMMEDIATELY.

---

## 2. UNIFIED UX & ERGONOMIC DESIGN STANDARD (SAP FIORI / XERO PATTERN)

To eliminate visual clutter and make the software effortless for both junior clerks and senior accountants, every operational module (`W02 Sales`, `W03 Purchases`, `W04 Challans`, `W06 Banking`, `W08 GL`) MUST follow the **3-Zone ERP Layout Pattern**:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ZONE A: MODULE HEADER & PIPELINE STAGE BAR                                   │
│ [Module Title]                                    [+ Primary Create Button]  │
│ [All (24)] -> [1. Orders (4)] -> [2. Delivery/GRN (3)] -> [3. Billed (12)]   │
│ [Search by Doc #, Party, BIN...]   [Status Filter]   [Date Filter]  [Export] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ZONE B: CLEAN MASTER DATA TABLE (DEFAULT VIEW — NO CLUTTERED INLINE FORMS!)  │
│ Doc #        Date        Party (BIN/TIN)     Stage Status    Amount   Action │
│ SO-2026-004  2026-10-28  Meghna Traders      CONFIRMED      ৳ 57,500  [Next] │
│ INV-2026-019 2026-10-25  Square Pharma       POSTED (M6.3)  ৳ 1,15,000[View] │
└──────────────────────────────────────────────────────────────────────────────┘

WHEN USER CLICKS "+ Primary Create" OR CLICKS A ROW, OPEN ZONE C (MODAL/DRAWER):
┌──────────────────────────────────────────────────────────────────────────────┐
│ ZONE C: FOCUSED DOCUMENT WORKBENCH (SLIDE-OVER DRAWER OR FULL MODAL)         │
│ STEPPER: (1) Order/Quote ──> (2) Delivery/GRN ──> (3) Invoice/Bill ──> (4) Paid
├───────────────────────────────────────────────────┬──────────────────────────┤
│ LEFT 65%: CLEAN DATA ENTRY FORM                   │ RIGHT 35%: LIVE CONTEXT  │
│ - Party Selector (+ Quick New Party button)       │ - Compact Tax Summary    │
│ - Dates, Warehouse, Payment Method, Ref #         │   (Net, VAT, VDS, TDS)   │
│ - Line Items Grid (Item, Stock Badge, Qty, Price) │ - Expandable "Tax Rules  │
│ - 3-Way Match Verification Banner (for Bills)     │   & Journal Preview"     │
├───────────────────────────────────────────────────┴──────────────────────────┤
│ STICKY FOOTER: [Save as Draft]   [Convert / Advance Stage]   [Approve & Post]│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Mandatory UX Rules Across All Screens:
1. **No Inline Form + Table Stacking:** Never stack a huge creation form permanently above the data table. The default view of a module is **Zone A (Pipeline Bar) + Zone B (Data Table)**. Creating or editing a document happens inside **Zone C (Focused Drawer/Modal)**.
2. **No "Demo Scenario" Preset Buttons Cluttering Forms:** If sample fill is needed, put a single subtle `"Fill Sample Data"` link in the modal header.
3. **Progressive Disclosure for Guided vs. Pro Mode:**
   - In `GUIDED` mode: Show plain-language labels, hide raw 4-digit GL account codes in tables, and show a 1-line helper hint at the top of the drawer.
   - In `PRO` mode: Show compact high-density table rows, display 4-digit GL account codes (`1210`, `5100`), and show keyboard shortcut badges.

---

## 3. ROLE-BASED ACCESS CONTROL (RBAC) MATRIX

Every state mutation in `VaultContext.tsx` and action button in the UI must check `hasPermission(permission)`:

```typescript
export type UserRole = 'ADMIN' | 'CONTROLLER' | 'ACCOUNTANT' | 'OPERATOR' | 'AUDITOR';

export type PermissionAction =
  | 'CREATE_COMMERCIAL_DRAFT' // ADMIN, CONTROLLER, ACCOUNTANT, OPERATOR
  | 'DISPATCH_OR_RECEIVE_STOCK' // ADMIN, CONTROLLER, ACCOUNTANT, OPERATOR
  | 'POST_TO_GL'              // ADMIN, CONTROLLER, ACCOUNTANT
  | 'APPROVE_HIGH_VALUE'      // ADMIN, CONTROLLER (Required when Gross > BDT 5,00,000)
  | 'OVERRIDE_3WAY_VARIANCE'  // ADMIN, CONTROLLER
  | 'REVERSE_POSTED_JOURNAL'  // ADMIN, CONTROLLER
  | 'SUBMIT_CLOSE_MAKER'      // ADMIN, CONTROLLER, ACCOUNTANT
  | 'APPROVE_CLOSE_CHECKER'   // ADMIN, CONTROLLER (Must be different user than Maker!)
  | 'MANAGE_MASTERS_AND_COA'  // ADMIN, CONTROLLER, ACCOUNTANT
  | 'MANAGE_USERS_AND_ORG';   // ADMIN
```
- **`AUDITOR` Role:** Has `0` write permissions. All create, edit, post, and reverse buttons are disabled with tooltip `"Read-Only Auditor Mode"`.

---

## 4. END-TO-END WORKFLOW STATE MACHINES & EXACT ACCOUNTING RULES

### 4.1 Workflow A: Order-to-Cash (O2C) & Perpetual Inventory COGS (`W02_SalesMushak63.tsx`)

A Sales transaction progresses through one connected `CommercialDocument` lifecycle (`direction: 'SALE'`):

| Stage # | `workflow_stage` | Allowed Role | Stock Impact | General Ledger & Statutory Impact | Next Action Button |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `QUOTATION` | `OPERATOR+` | None | None (Draft quote for customer) | `"Confirm as Sales Order"` |
| **Stage 2** | `SALES_ORDER` | `OPERATOR+` | Checks `qty <= item.qty_on_hand` (warns if low stock) | None (Commits customer order) | `"Dispatch Delivery Challan"` |
| **Stage 3** | `DELIVERY_CHALLAN` | `OPERATOR+` | **Decrements `item.qty_on_hand`** by line quantity; records `unit_cost_poisha` on each line | Generates Delivery Challan ref (`DC-2026-XXXX`). (Optional/Merged with Stage 4 for direct invoicing) | `"Issue Mushak 6.3 Tax Invoice"` |
| **Stage 4** | `INVOICED_POSTED` | `ACCOUNTANT+` | If not already decremented at Stage 3, decrements `qty_on_hand` now | **Allocates gap-free `Mushak 6.3` serial**; records in **Mushak 6.2 Sales Register**; posts **Atomic Revenue + COGS Journal** (see below) | `"Record Customer Receipt"` |
| **Stage 5** | `SETTLED` | `ACCOUNTANT+` | None | Posts **Customer Receipt Journal** (`Dr Bank/bKash + Dr VDS Receivable 1145 + Dr AIT 1150 / Cr Trade AR 1210`); if VDS > 0, creates expected Customer `Mushak 6.6` record in `W04` | `"View Receipt & Ledger Lens"` |

#### Exact Double-Entry Journal Posted at Stage 4 (`INVOICED_POSTED`):
For any posted Sales Invoice, calculate `totalCogsPoisha = SUM(BigInt(Math.round(line.qty * 100)) * item.unit_cost_poisha / 100n)` for all stock items (`item.is_stock_item !== false`). Emit ONE balanced `JournalEntry`:
1. `Debit 1210 Trade Accounts Receivable` = `gross_poisha` (`base + sd + vat`)
2. `Credit 4100/4110/4120 Sales Revenue` = `base_poisha`
3. `Credit 2120 Output VAT Payable (or 1140 VAT Current Account)` = `vat_poisha + sd_poisha` (if > 0n)
4. `Debit 5100 Cost of Goods Sold (COGS)` = `totalCogsPoisha` (if > 0n)
5. `Credit 1310 Merchandise Inventory` = `totalCogsPoisha` (if > 0n)

*(Note: For a direct Over-the-Counter / Quick Invoice, an Accountant can click `"Direct Post Mushak 6.3 Invoice"` which executes Stage 3 + Stage 4 atomically in one step).*

---

### 4.2 Workflow B: Procure-to-Pay (P2P), Weighted Average Stock & 3-Way Match (`W03_PurchasesWithholding.tsx`)

A Purchase transaction progresses through one connected `CommercialDocument` lifecycle (`direction: 'PURCHASE'`):

| Stage # | `workflow_stage` | Allowed Role | Stock & Costing Impact | General Ledger & Statutory Impact | Next Action Button |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `PURCHASE_ORDER` | `OPERATOR+` | None | Issues `PO-2026-XXXX` with agreed quantities and PO unit prices (`po_qty`, `po_unit_price_poisha`) | `"Receive Goods (Record GRN)"` |
| **Stage 2** | `GRN_RECEIVED` | `OPERATOR+` | **Increments `item.qty_on_hand`** and updates `item.unit_cost_poisha` via **Weighted Average Cost formula** | Records `GRN-2026-XXXX` and actual received quantity (`grn_qty`) | `"Verify 3-Way Match & Post Bill"` |
| **Stage 3** | `BILL_POSTED` | `ACCOUNTANT+` | If direct bill without prior GRN, updates stock & weighted average cost now | Runs **3-Way Match check** (`bill_qty <= grn_qty` and `bill_price <= po_price`). Posts **AP Liability Journal**; appends to **Mushak 6.1 Purchase Register** | `"Pay Supplier & Withhold VDS/TDS"` |
| **Stage 4** | `SETTLED` | `ACCOUNTANT+` | None | Posts **Vendor Payment & Withholding Split Journal**; creates pending **VDS (`Mushak 6.6`)** and **TDS Treasury Challans** in `W04` | `"Go to Treasury Challan Queue"` |

#### Exact Weighted Average Cost Update Formula (Stage 2 / Stage 3):
When receiving `receivedQty` of a stock item at `unitCostPoisha` (Note: if Input VAT is disallowed under s.46—e.g., Supplier BIN invalid or Cash > BDT 1,00,000—the disallowed VAT per unit is added to `unitCostPoisha`!):
```typescript
const oldQty = Math.max(0, item.qty_on_hand ?? 0);
const oldCost = item.unit_cost_poisha ?? item.unit_price_poisha;
const newTotalQty = oldQty + receivedQty;
const newAvgCost = newTotalQty > 0
  ? ((BigInt(Math.round(oldQty * 100)) * oldCost) + (BigInt(Math.round(receivedQty * 100)) * unitCostPoisha)) / BigInt(Math.round(newTotalQty * 100))
  : unitCostPoisha;
```

#### Exact Double-Entry Journals for P2P:
- **At Stage 3 (`BILL_POSTED` — Recording Vendor Bill in AP):**
  - If `input_credit.eligible === true`:
    - `Debit 1310 Merchandise Inventory` (for stock items) or `5300–5330 Expense` (for services) = `base_poisha`
    - `Debit 1140 VAT Current Account` = `vat_poisha`
    - `Credit 2110 Trade Accounts Payable` = `gross_poisha`
  - If `input_credit.eligible === false` (s.46 Rebate Disallowed — e.g., Missing 13-digit BIN, Missing Mushak 6.3, or Cash > BDT 1,00,000 `[VERIFY]`):
    - `Debit 1310 Merchandise Inventory` (or `5100/5300 Expense`) = `base_poisha + vat_poisha` *(Disallowed VAT is capitalized into cost!)*
    - `Credit 2110 Trade Accounts Payable` = `gross_poisha`
- **At Stage 4 (`SETTLED` — Paying Vendor & Withholding VDS/TDS at Source):**
  - `Debit 2110 Trade Accounts Payable` = `gross_poisha`
  - `Credit 1110/1120 Selected Bank or bKash Account` = `payable_to_party_poisha` (`gross - vds - tds`)
  - `Credit 2130 VDS Withheld Payable` = `vds_withheld_poisha` (if > 0n)
  - `Credit 2140 TDS Withheld Payable` = `tds_withheld_poisha` (if > 0n; automatically upscaled by 50% if supplier 12-digit e-TIN is missing `[VERIFY]`)

---

### 4.3 Workflow C: Treasury Deposit & Mushak 6.6 Lifecycle (`W04_TreasuryChallans66.tsx`)
1. Stage 4 of P2P automatically creates `ChallanRecord` rows with `status: 'PENDING_DEPOSIT'`.
2. In `W04`, Accountant selects pending VDS/TDS items, enters Bank Branch & Treasury Challan No. (`TC-2026-XXXX`), and clicks `"Deposit to Government Treasury"`.
3. System posts balanced journal:
   - `Debit 2130 VDS Payable` (and/or `Debit 2140 TDS Payable`) = `deposit_amount_poisha`
   - `Credit 1110 City Bank / Selected Bank Account` = `deposit_amount_poisha`
4. Status transitions to `DEPOSITED_CERT_ISSUED`, unlocking the printable **A4 Mushak 6.6 Certificate**.

---

### 4.4 Workflow D: Deduplicated Multi-Criteria Bank Reconciliation (`W06_BankingMfsReconcile.tsx`)
1. Every `BankStatementLine` tracks `matched_journal_id?: string` and `reconciled: boolean`.
2. **Strict Deduplication Rule:** A `JournalEntry` whose `id` is ALREADY referenced by any reconciled `BankStatementLine.matched_journal_id` is **excluded** from matching other statement lines!
3. **Match Scoring (0–100 pts):**
   - Filter candidate journals that contain a line for the bank/MFS account's GL `account_code` (`1110`, `1115`, `1120`, `1125`, `1130`) with matching direction (inflow = Debit to Bank GL; outflow = Credit to Bank GL).
   - **Amount Score (50 pts):** Exact poisha match (`50 pts`), or matches net of 1.5% MFS fee (`45 pts`).
   - **Date Score (30 pts):** `|statementDate - journalDate| <= 2 days` (`30 pts`), `<= 7 days` (`15 pts`).
   - **Reference/Party Score (20 pts):** Statement description/ref shares a token with journal narration or doc ref (`20 pts`).
4. If no prior GL journal exists for a statement line (e.g., direct bank charge or unrecorded receipt), user can click `"Create & Reconcile GL Entry"`, select the offset GL account (e.g., `5820 Bank & MFS Charges`), post the journal, and mark the line reconciled in one atomic action.

---

### 4.5 Workflow E: Two-Person Maker-Checker Period Close (`W09_CloseAndControl.tsx`)
1. `VaultState` persists `periodCloseStatus: Record<string, { status: 'OPEN' | 'MAKER_SUBMITTED' | 'LOCKED'; maker_name?: string; maker_role?: string; maker_at?: string; checker_name?: string; checker_role?: string; checker_at?: string }>`.
2. **Pre-Close Gate:** Before Maker submission, verify: (a) Trial Balance is balanced (`0n` variance), (b) `2190 Suspense Account` balance is `0n` (or user clears suspense items in `W09`), and (c) Audit Hash Chain is valid.
3. **Maker Step:** `ACCOUNTANT`, `CONTROLLER`, or `ADMIN` clicks `"Submit Period for Close (Maker)"` -> saves `maker_name = currentUser.full_name` and sets status to `MAKER_SUBMITTED`.
4. **Checker Step (Separation of Duties):** Only a `CONTROLLER` or `ADMIN` whose `full_name !== maker_name` can click `"Approve & Lock Period (Checker)"` -> sets status to `LOCKED` and blocks any new journal postings dated in that period.