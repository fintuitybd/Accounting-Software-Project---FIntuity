# FINTUITY ERP v2.1.0 — MASTER ARCHITECTURE, STATUTORY TDS/VDS, IAS/IFRS & QUIET LEDGER UI/UX SPECIFICATION
**Target Agents:** Gemini 3.8/4.0 Flash & DeepSeek V3/V4.1  
**Jurisdiction:** Bangladesh (ITA 2023, VAT & SD Act 2012, Ord. No. 38 of 2026, Labour Act 2026, FRC / ICAB IAS & IFRS)  
**Core Mathematical Invariant:** $1\text{ BDT} = 100\text{ poisha}$ (`bigint`), rates in basis points (`integer`, $10000\text{ bps} = 100.00\%$), quantities scaled $\times 10000\text{n}$. Zero IEEE-754 floats.

---

## 1. STATUTORY STRESS-TEST RESOLUTIONS & MATHEMATICAL INVARIANTS

### 1.1 Two-Stage Withholding Tax (TDS) & VAT (VDS) Lifecycle with Partial Payment Apportionment
**Statutory Conflict:** Under Income Tax Act 2023 (Sections 86–109), TDS is deductible at the earlier of credit to the vendor's account or payment. Under VAT & SD Act 2012 (Section 49) & Withholding VAT Rules, VDS matures into a Treasury obligation upon payment settlement, and **Mushak 6.6** can only be issued after the corresponding **A-Challan** is deposited.

**Deterministic Two-Bucket Settlement Engine:**
1. **Stage 1 — Invoice Accrual (`purchase_documents.status = 'POSTED'`):**
   Given taxable base $B \in \mathbb{Z}_{\ge 0}$ (poisha), VAT rate $R_{\text{vat}}$, VDS rate $R_{\text{vds}}$, and effective TDS rate $R_{\text{tds}}$:
   $$V_{\text{total}} = \left\lfloor \frac{B \times \text{BigInt}(R_{\text{vat}})}{10000\text{n}} \right\rfloor, \quad \text{VDS}_{\text{total}} = \left\lfloor \frac{B \times \text{BigInt}(R_{\text{vds}})}{10000\text{n}} \right\rfloor, \quad \text{TDS}_{\text{total}} = \left\lfloor \frac{B \times \text{BigInt}(R_{\text{tds}})}{10000\text{n}} \right\rfloor$$
   $$N_{\text{payable}} = B + V_{\text{total}} - \text{VDS}_{\text{total}} - \text{TDS}_{\text{total}}$$
   - **Section 134 e-TIN Penalty Upscale:** If vendor `tin` is null or fails `/^\d{12}$/`, $R_{\text{tds}} = \left\lfloor \frac{R_{\text{tds\_base}} \times 150}{100} \right\rfloor$.
   - **GL Posting at Bill Recognition:**
     - **DR** Expense / Asset / Inventory (`5xxx` / `13xx`): $B$ (if `isRebatable === true`) OR $B + V_{\text{total}}$ (if `isRebatable === false`)
     - **DR** Account `1140` (`VAT Current Account - Input Rebate`): $V_{\text{total}}$ (if `isRebatable === true`, else $0\text{n}$)
     - **CR** Account `2110` (`Accounts Payable - Trade`): $N_{\text{payable}}$
     - **CR** Account `2130` (`Withholding VAT [VDS] Payable`): $\text{VDS}_{\text{total}}$
     - **CR** Account `2140` (`Withholding Tax [TDS] Payable`): $\text{TDS}_{\text{total}}$

2. **Stage 2 — Partial Payment Apportionment ($k$ Installments):**
   When paying net cash $C_i \le N_{\text{remaining}}$ on installment $i$:
   $$\text{If } C_i = N_{\text{remaining}} \text{ (Final Settlement)} \implies \begin{cases} \text{VDS}_i = \text{VDS}_{\text{total}} - \sum_{j=1}^{i-1} \text{VDS}_j \\ \text{TDS}_i = \text{TDS}_{\text{total}} - \sum_{j=1}^{i-1} \text{TDS}_j \end{cases}$$
   $$\text{If } C_i < N_{\text{remaining}} \text{ (Partial Settlement)} \implies \begin{cases} \text{VDS}_i = \left\lfloor \frac{\text{VDS}_{\text{total}} \times C_i}{N_{\text{payable}}} \right\rfloor \\ \text{TDS}_i = \left\lfloor \frac{\text{TDS}_{\text{total}} \times C_i}{N_{\text{payable}}} \right\rfloor \end{cases}$$
   - Gross invoice value discharged in installment $i$: $\Delta G_i = C_i + \text{VDS}_i + \text{TDS}_i$.
   - Exactly $\text{VDS}_i$ and $\text{TDS}_i$ transition from `UNMATURED_ON_BILL` to `READY_FOR_CHALLAN` in the Treasury Studio (`W04` / `/app/treasury`).

### 1.2 Non-Rebatable Input VAT Capitalization (VAT Act s.46(2) & IAS 2 Para 11)
**Statutory & Accounting Rule:** Under VAT & SD Act 2012 s.46, input VAT is **non-rebatable** if:
1. Supply is taxed at a truncated rate ($5\%$ trading, $7.5\%$ procurement provider, $2\%/2.4\%/4.5\%$ specific schedules), OR
2. Supplier lacks a valid 13-digit BIN (`/^\d{9}-\d{4}$/` or `/^\d{13}$/`), OR
3. Valid **Mushak 6.3** tax invoice is absent, OR
4. Invoice value $> 10000000\text{n}$ poisha ($\text{BDT } 1,00,000.00$) is settled via Cash instead of banking/MFS channels.

Per **IAS 2.11** (*Inventories*) and **IAS 16.16** (*Property, Plant and Equipment*), non-recoverablepurchase taxes must be capitalized into the cost of inventory/asset or expensed directly:
- **GL Impact:** Account `1140` receives $0\text{n}$. Line cost becomes $B_{\text{line}} + V_{\text{line}}$.
- **Mushak 9.1 Impact:** `purchase_document_lines.non_rebatable_vat_poisha` records $V_{\text{line}}$ for disclosure in **Mushak 9.1 Part 4 Note 19/20** without creating a variance between the VAT Return and GL Account `1140`.

### 1.3 Post-Close Credit/Debit Notes (Mushak 6.7 / 6.8 in Month $N+2$ for Locked Month $N$)
- Closed periods (`periods.status = 'LOCKED'`) are immutable.
- A Credit Note (**Mushak 6.7**) or Debit Note (**Mushak 6.8**) issued in Month $N+2$ against an invoice from Month $N$ validates `issue_date - original_invoice_date <= 180 days` (VAT Rule 40) and posts to Month $N+2$ GL, mapping to **Mushak 9.1 Part 6 Note 31** (Decreasing Adjustment for Credit Notes) or **Part 5 Note 26** (Increasing Adjustment for Debit Notes).

### 1.4 Central BIN vs Unit BIN Multi-Branch Architecture
- `companies.binRegistrationMode`: `'CENTRAL_BIN' | 'UNIT_BIN'`.
- Under `'CENTRAL_BIN'`, inter-branch stock transfers issue **Mushak 6.5** with $0\text{n}$ VAT and consolidate into a single company-wide Mushak 9.1.
- Under `'UNIT_BIN'`, each branch (`branches.branchBin`) operates as an independent VAT taxpayer issuing **Mushak 6.3** on inter-branch transfers and filing branch-scoped Mushak 9.1 returns.

### 1.5 Gapless Row-Locked Statutory Numbering & Tally/Excel Cutover
- **Gapless Sequences:** All Mushak (`6.3`, `6.5`, `6.6`, `6.7`, `4.3`) and Challan numbers use `INSERT INTO document_sequences ... ON CONFLICT DO UPDATE SET current_value = document_sequences.current_value + 1 RETURNING current_value` inside `withTransaction()`.
- **Tally/Excel Cutover:** Historical balances, bill-by-bill open AR/AP invoices (`is_opening_document = true`), and FIFO stock lots clear through Account `3999` (`Opening Balance Equity Clearing`). Cutover activation enforces `balance('3999') === 0n`.

---

## 2. AUTHORITATIVE IAS / IFRS FINANCIAL STATEMENTS ENGINE

Fintuity's reporting engine (`server/src/reports/statements.ts` & `src/pages/reports/ReportsPage.tsx`) prepares audit-ready financial statements compliant with **ICAB / FRC Bangladesh** adoption of IAS and IFRS:

```
+----------------------------------------------------------------------------------------------------------+
|                         FINTUITY IAS / IFRS STATEMENT PREPARATION ARCHITECTURE                           |
+------------------------+------------------------------------+--------------------------------------------+
| Standard               | Statement / Schedule               | Key Mandatory Structural Features          |
+------------------------+------------------------------------+--------------------------------------------+
| IFRS 18 (Superseding   | Statement of Profit or Loss and    | 5 Mandatory Categories: Operating,         |
| IAS 1 P&L presentation)| Other Comprehensive Income         | Investing, Financing, Income Taxes,        |
|                        |                                    | Discontinued Ops. Mandatory Subtotals:     |
|                        |                                    | Operating Profit, Profit Before Financing  |
|                        |                                    | & Income Tax, Net Profit.                  |
+------------------------+------------------------------------+--------------------------------------------+
| IAS 1                  | Statement of Financial Position    | Current / Non-Current split, Note cross-   |
|                        | & Statement of Changes in Equity   | refs (Notes 1-32), Comparative Prior Year, |
|                        |                                    | Balance Sheet Proof (A - L - E === 0n).    |
+------------------------+------------------------------------+--------------------------------------------+
| IAS 7                  | Statement of Cash Flows            | Dual toggle: Direct Method & Indirect      |
|                        | (Direct & Indirect Methods)        | Method. Explicit line items for Cash Paid  |
|                        |                                    | for Vendor TDS, VDS, and Quarterly AIT.    |
+------------------------+------------------------------------+--------------------------------------------+
| IAS 12                 | Income Tax & Deferred Tax Note     | Reconciles Accounting PBT to Taxable       |
|                        | (ITA 2023 s.154 AIT & s.163 MinTax)| Income; offsets AIT Asset (1150) & Customer|
|                        |                                    | TDS Credit against Tax Provision (2170).   |
+------------------------+------------------------------------+--------------------------------------------+
| IAS 2                  | Inventory Valuation & COGS Note    | Raw Materials (1310), WIP (1315), Finished |
|                        |                                    | Goods (1320); FIFO/Weighted Avg; s.46(2)   |
|                        |                                    | non-rebatable VAT absorption disclosure.   |
+------------------------+------------------------------------+--------------------------------------------+
```

### 2.1 IFRS 18 Statement of Profit or Loss (Multi-Step Structure)
Every GL revenue/expense account maps deterministically to an **IFRS 18 Category**:
1. **Operating Category:**
   - Revenue from Contracts with Customers (IFRS 15) — Net of Output VAT & SD (`4110`–`4190`)
   - Less: Sales Returns & Mushak 6.7 Credit Allowances (`4195`)
   - **Net Operating Revenue**
   - Less: Cost of Goods Sold / Cost of Services (`5200`–`5290`, including absorbed non-rebatable VAT and Mushak 4.3 normal wastage)
   - **Gross Profit** (with Gross Margin bps badge)
   - Less: General & Administrative Expenses (`5110`–`5189`, `5310`–`5390` Labour Act Payroll, PF, WPPF $5\%$ allocation)
   - Less: Selling, Distribution & MFS/PGW MDR Charges (`5190`)
   - **Subtotal 1: Operating Profit or Loss (EBIT)** *(IFRS 18 Mandatory Subtotal)*
2. **Investing Category:**
   - Interest / Dividend Income from Investments, Gain/Loss on Disposal of PPE (`4210`–`4290`)
   - **Subtotal 2: Profit or Loss Before Financing and Income Taxes** *(IFRS 18 Mandatory Subtotal)*
3. **Financing Category:**
   - Interest Expense on Bank Loans / Lease Liabilities (IFRS 16), Bank Charges & Excise Duty (`5410`–`5490`)
   - **Profit or Loss Before Income Tax (PBT)**
4. **Income Taxes Category (IAS 12 & ITA 2023):**
   - Current Corporate Tax Expense (higher of Regular Corporate Tax vs ITA 2023 s.163 Minimum Tax on Gross Receipts / TDS under s.89–92)
   - Deferred Tax Expense / (Income) (`5510`–`5520`)
   - **Profit or Loss for the Period (Net Profit)**

### 2.2 IAS 1 Statement of Financial Position (Balance Sheet) & Tax Asset/Liability Netting
- **Non-Current Assets:** PPE at Cost (`1510`) less Accumulated Depreciation (`1520`), Intangible Assets (`1530`), Deferred Tax Assets (`1540`).
- **Current Assets:**
  - Inventories (`1310` Raw Materials, `1315` WIP, `1320` Finished Goods)
  - Trade & Other Receivables (`1210` AR Control, net of IFRS 9 Expected Credit Loss allowance `1215`)
  - **Statutory Tax & VAT Assets:**
    - `1140` VAT Current Account (Mushak 9.1 Note 65 Closing Carryforward Balance)
    - `1145` Customer VDS Receivable (Backed by verified Customer Mushak 6.6 certificates)
    - `1150` Advance Income Tax (AIT Paid under s.154 + Customer TDS Deducted at Source)
  - Cash and Cash Equivalents (`1110` Bank Accounts, `1120` bKash/Nagad MFS Wallets, `1130` Petty Cash)
- **Equity:** Issued Share Capital (`3110`), Retained Earnings (`3210` + Current Period IFRS 18 Net Profit), Statutory Reserves (`3310`). *(Zero-balance check on `3999` Opening Balance Clearing).*
- **Non-Current Liabilities:** Long-Term Borrowings (`2510`), Lease Liabilities (`2520`), Deferred Tax Liabilities (`2530`), Gratuity / PF Obligations (`2540`).
- **Current Liabilities:**
  - Trade & Other Payables (`2110` AP Control)
  - **Statutory Withholding & Tax Payables:**
    - `2120` Output VAT Payable
    - `2130` Withholding VAT (VDS) Payable (Pending A-Challan `1/1141/0010/0311`)
    - `2140` Vendor Withholding Tax (TDS) Payable (Pending A-Challan `1/1141/0010/0111`–`0116`)
    - `2141` Employee Salary TDS Payable (`1/1141/0010/0112`)
    - `2150` Provident Fund & WPPF Payable (`2155`)
    - `2160` Net Salaries Payable
    - `2170` Provision for Corporate Income Tax (IAS 12)

### 2.3 IAS 7 Statement of Cash Flows (Direct & Indirect Methods)
- **Operating Activities (Direct Method):**
  - $(+)$ Cash Receipts from Customers (Net of Customer VDS/TDS withheld)
  - $(-)$ Cash Paid to Suppliers & Employees
  - $(-)$ **Cash Paid to Government Treasury for VDS & Net VAT (A-Challan `1/1141/0010/0311`)**
  - $(-)$ **Cash Paid to Government Treasury for Withheld TDS & Quarterly AIT (A-Challans `0101`–`0116`)**
  - $(-)$ Cash Paid for MFS/PGW MDR Fees & Bank Charges
- **Operating Activities (Indirect Method):**
  - Starts with **IFRS 18 Profit Before Income Tax (PBT)** $\rightarrow$ adjusts for non-cash Depreciation, Finance Costs $\rightarrow$ Working Capital changes ($\Delta\text{AR}$, $\Delta\text{Inventory}$, $\Delta\text{VAT Current Account}$, $\Delta\text{AP}$, $\Delta\text{TDS/VDS Payable}$) $\rightarrow$ less Income Taxes & AIT Paid in Cash.
- **Reconciliation Invariant:** Both methods MUST yield the exact same `Net Cash from Operating Activities` in `bigint` poisha, and $\text{Opening Cash} + \Delta\text{Cash} \equiv \text{Closing Balance of } (1110 + 1120 + 1130)$.

---

## 3. WORLD-CLASS UI/UX SPECIFICATION: THE "QUIET LEDGER" (`.ql-*`) DESIGN SYSTEM

To surpass Tally, QuickBooks, and Xero, Fintuity enforces the **Quiet Ledger** aesthetic—combining Swiss financial typography with Linear/Stripe-grade interactive speed.

### 3.1 Visual & Typographic Hierarchy
1. **Tri-Font Pairing:**
   - **UI & Headings:** `'Inter'`, tracking `-0.015em` on headings, crisp `500`/`600` weights.
   - **Bangla Script:** `'Noto Sans Bengali'`, line-height `1.6` to prevent vowel-sign (*kar*) clipping on Mushak forms.
   - **Financial Figures & Codes:** `'JetBrains Mono'` / monospace with mandatory `font-variant-numeric: tabular-nums` (`.ql-mono`) so every poisha decimal, 12-digit e-TIN, 13-digit BIN, and 13-digit Treasury Economic Code aligns vertically down to the pixel.
2. **Surface & Color Tokens (`src/index.css`):**
   - Background Canvas: `#F8FAFC` (Slate 50) in Light Mode / `#0B0F17` in Dark Mode.
   - Elevated Card (`.ql-card`): `#FFFFFF` with `1px solid #E2E8F0` hairline border, subtle `0 1px 2px rgba(15, 23, 42, 0.04)` shadow, `8px` border radius.
   - Semantic Accents:
     - Primary Authority: `#0F172A` (Deep Slate) & `#0284C7` (Ledger Blue)
     - Statutory Compliant / Balanced (`ql-badge-success`): `#059669` on `#ECFDF5`
     - Section 134 Penalty / Rebate Warning (`ql-badge-warn`): `#D97706` on `#FFFBEB`
     - Unbalanced / Overdue / Disallowed (`ql-badge-danger`): `#DC2626` on `#FEF2F2`

### 3.2 Signature UX Workflows
1. **Live Tax Split Waterfall Card (In Purchase & Payment Composers):**
   As the accountant types an invoice amount or selects a vendor, a sticky right-hand **Statutory Waterfall Card** updates in `< 16ms`:
   ```
   Base Supply (Sec 89 Goods)           BDT 1,00,000.00
   + Input VAT (15.00% - Mushak 6.3)    BDT   15,000.00  [✓ Sec 46 Rebatable -> Acct 1140]
   - Withholding VAT / VDS (0.00%)      BDT        0.00
   - Withholding Tax / TDS (4.50%*)     BDT   (4,500.00) [! Sec 134: +50% No e-TIN Upscale]
   ----------------------------------------------------------------------------------------
   = Net Payable to Vendor (Acct 2110)  BDT 1,10,500.00
   = Treasury Challan Queue (1/1141/..) BDT    4,500.00
   ```
2. **Interactive IFRS Statement Drill-Down (`LedgerLensModal`):**
   Every row in the IFRS 18 P&L, IAS 1 Balance Sheet, IAS 7 Cash Flow, Mushak 9.1, and Section 177 Return is interactive. Clicking any line or `Note [14]` pill opens a slide-over **3-Level Audit Trail Drawer**:
   - **Level 1:** Contributing GL Accounts & Period Movements.
   - **Level 2:** Individual Posted Journals with SHA-256 chain verification badge.
   - **Level 3:** Source Document preview (printable Mushak 6.3, Mushak 6.6 Certificate, or Bank A-Challan).
3. **One-Click Treasury & Mushak 6.6 Batch Studio (`/app/treasury`):**
   - Split-view workbench: Left pane groups open VDS (`2130`) and TDS (`2140`/`2141`) liabilities by **13-digit Economic Code**; Right pane renders a live preview of the **Bangladesh Bank A-Challan** and the resulting **Mushak 6.6 Certificates** that will be auto-issued upon posting.

---

## 4. COMPLETE DRIZZLE ORM SCHEMA EXTENSIONS (`server/src/db/schema.ts`)

All new tables enforce `companyId` foreign-key isolation (`onDelete: 'restrict'`), `bigint` poisha columns, and compound indexes:

```typescript
// 1. GAPLESS DOCUMENT SEQUENCES (Mushak 6.3, 6.5, 6.6, 6.7, 4.3, Challans)
export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(), // 'MUSHAK_6_3' | 'MUSHAK_6_5' | 'MUSHAK_6_6' | 'MUSHAK_6_7' | 'MUSHAK_4_3' | 'CHALLAN'
    prefix: text('prefix').notNull(),
    currentValue: bigint('current_value', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('doc_seq_company_branch_fy_type_uniq').on(t.companyId, t.branchId, t.fiscalYearId, t.docType),
  ]
);

// 2. BANGLADESH GAZETTED HOLIDAYS & COMPLIANCE CALENDAR
export const bdGazettedHolidays = pgTable(
  'bd_gazetted_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    holidayDate: date('holiday_date').notNull(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    holidayType: text('holiday_type').notNull(), // 'NATIONAL' | 'EID' | 'RELIGIOUS' | 'BANK_HOLIDAY' | 'EXECUTIVE_ORDER'
    isConfirmed: boolean('is_confirmed').notNull().default(true),
  },
  (t) => [index('bd_holidays_date_idx').on(t.holidayDate)]
);

export const complianceCalendarEvents = pgTable(
  'compliance_calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').references(() => periods.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
    titleEn: text('title_en').notNull(),
    titleBn: text('title_bn').notNull(),
    statutoryBody: text('statutory_body').notNull(), // 'NBR_VAT' | 'NBR_TAX' | 'RJSC' | 'MOLE'
    category: text('category').notNull(), // 'VAT_91' | 'VDS_DEPOSIT' | 'TDS_MONTHLY' | 'TDS_177' | 'AIT_Q' | 'ANNUAL_TAX' | 'RJSC_ANNUAL'
    statutoryDeadline: date('statutory_deadline').notNull(),
    adjustedDeadline: date('adjusted_deadline').notNull(),
    estimatedLiabilityPoisha: bigint('estimated_liability_poisha', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'PREPARED' | 'FILED' | 'OVERDUE'
    autoLockPeriodOnExpiry: boolean('auto_lock_period_on_expiry').notNull().default(false),
    filedAt: timestamp('filed_at', { withTimezone: true, mode: 'date' }),
    filingReference: text('filing_reference'),
    challanId: uuid('challan_id').references(() => treasuryChallans.id, { onDelete: 'set null' }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('comp_cal_company_deadline_idx').on(t.companyId, t.adjustedDeadline),
    unique('comp_cal_company_period_cat_uniq').on(t.companyId, t.periodId, t.category),
  ]
);

// 3. SECTION 177 WITHHOLDING TAX RETURNS & DEDUCTEE LINES
export const withholdingTaxReturns = pgTable(
  'withholding_tax_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
    returnType: text('return_type').notNull(), // 'MONTHLY_177' | 'HALF_YEARLY_177' | 'ANNUAL_177'
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    totalGrossPaidPoisha: bigint('total_gross_paid_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsDeductedPoisha: bigint('total_tds_deducted_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsDepositedPoisha: bigint('total_tds_deposited_poisha', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'VERIFIED' | 'SUBMITTED'
    submissionAckNumber: text('submission_ack_number'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    preparedBy: uuid('prepared_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('wht_returns_company_type_period_uniq').on(t.companyId, t.returnType, t.periodStart, t.periodEnd),
  ]
);

export const withholdingReturnLines = pgTable(
  'withholding_return_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    returnId: uuid('return_id').notNull().references(() => withholdingTaxReturns.id, { onDelete: 'cascade' }),
    scheduleCode: text('schedule_code').notNull(), // 'SCHED_A_SALARY' | 'SCHED_B_GOODS' | 'SCHED_C_RENT' | 'SCHED_D_PROF'
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }),
    sourceDocumentId: uuid('source_document_id'),
    deducteeName: text('deductee_name').notNull(),
    deducteeTin: text('deductee_tin'),
    deducteeBin: text('deductee_bin'),
    hasEtinPenaltyUpscale: boolean('has_etin_penalty_upscale').notNull().default(false),
    sectionCode: text('section_code').notNull(), // 'SEC_86' | 'SEC_89' | 'SEC_90' | 'SEC_91' | 'SEC_92' | 'SEC_109'
    economicCode: text('economic_code').notNull(), // 13-digit Bangladesh Bank code
    grossAmountPoisha: bigint('gross_amount_poisha', { mode: 'bigint' }).notNull(),
    paidAmountPoisha: bigint('paid_amount_poisha', { mode: 'bigint' }).notNull(),
    tdsRateBps: integer('tds_rate_bps').notNull(),
    tdsAmountPoisha: bigint('tds_amount_poisha', { mode: 'bigint' }).notNull(),
    paymentDate: date('payment_date').notNull(),
    challanId: uuid('challan_id').references(() => treasuryChallans.id, { onDelete: 'set null' }),
    challanNumber: text('challan_number'),
    challanDate: date('challan_date'),
    bankName: text('bank_name'),
    anomalyFlags: text('anomaly_flags'), // JSON array: ['MISSING_ETIN', 'LATE_CHALLAN_DEPOSIT', 'UNDEPOSITED_TDS']
  },
  (t) => [index('wht_lines_return_idx').on(t.companyId, t.returnId)]
);

// 4. LABOUR ACT 2026 PAYROLL TABLES
export const payrollEmployees = pgTable(
  'payroll_employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    employeeCode: text('employee_code').notNull(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn'),
    workerClassification: text('worker_classification').notNull(), // 'PERMANENT' | 'PROBATIONARY' | 'CONTRACTUAL' | 'PIECE_RATE' | 'APPRENTICE'
    nidNumber: text('nid_number'),
    etin: text('etin'),
    joiningDate: date('joining_date').notNull(),
    basicSalaryPoisha: bigint('basic_salary_poisha', { mode: 'bigint' }).notNull(),
    houseRentAllowancePoisha: bigint('hra_poisha', { mode: 'bigint' }).notNull(),
    medicalAllowancePoisha: bigint('medical_poisha', { mode: 'bigint' }).notNull(),
    conveyanceAllowancePoisha: bigint('conveyance_poisha', { mode: 'bigint' }).notNull(),
    pfEnrolled: boolean('pf_enrolled').notNull().default(true),
    pfRateBps: integer('pf_rate_bps').notNull().default(1000),
    paymentChannel: text('payment_channel').notNull().default('BANK'), // 'BANK' | 'BKASH' | 'NAGAD' | 'CASH'
    bankName: text('bank_name'),
    bankAccountNumber: text('bank_account_number'),
    bankRoutingNumber: text('bank_routing_number'),
    mfsNumber: text('mfs_number'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('payroll_emp_company_code_uniq').on(t.companyId, t.employeeCode)]
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').notNull().references(() => periods.id, { onDelete: 'restrict' }),
    batchDate: date('batch_date').notNull(),
    totalBasicPoisha: bigint('total_basic_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalGrossPoisha: bigint('total_gross_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalOtPoisha: bigint('total_ot_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalBonusPoisha: bigint('total_bonus_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsPoisha: bigint('total_tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalPfEmployeePoisha: bigint('total_pf_employee_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalPfEmployerPoisha: bigint('total_pf_employer_poisha', { mode: 'bigint' }).notNull().default(0n),
    netPayablePoisha: bigint('net_payable_poisha', { mode: 'bigint' }).notNull().default(0n),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'APPROVED' | 'POSTED' | 'DISBURSED'
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('payroll_runs_company_period_uniq').on(t.companyId, t.periodId)]
);

export const payrollRunLines = pgTable(
  'payroll_run_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull().references(() => payrollEmployees.id, { onDelete: 'restrict' }),
    basicPoisha: bigint('basic_poisha', { mode: 'bigint' }).notNull(),
    hraPoisha: bigint('hra_poisha', { mode: 'bigint' }).notNull(),
    medicalPoisha: bigint('medical_poisha', { mode: 'bigint' }).notNull(),
    conveyancePoisha: bigint('conveyance_poisha', { mode: 'bigint' }).notNull(),
    otHoursScaled: integer('ot_hours_scaled').notNull().default(0),
    otAmountPoisha: bigint('ot_amount_poisha', { mode: 'bigint' }).notNull().default(0n),
    festivalBonusPoisha: bigint('festival_bonus_poisha', { mode: 'bigint' }).notNull().default(0n),
    grossPayPoisha: bigint('gross_pay_poisha', { mode: 'bigint' }).notNull(),
    pfEmployeePoisha: bigint('pf_employee_poisha', { mode: 'bigint' }).notNull().default(0n),
    pfEmployerPoisha: bigint('pf_employer_poisha', { mode: 'bigint' }).notNull().default(0n),
    tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    netPayPoisha: bigint('net_pay_poisha', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('payroll_lines_run_idx').on(t.companyId, t.runId)]
);

// 5. MANUFACTURING BOM, MUSHAK 4.3 & PRODUCTION BATCHES
export const mushak43Declarations = pgTable(
  'mushak_43_declarations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    declarationNumber: text('declaration_number').notNull(),
    finishedItemId: uuid('finished_item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
    outputQuantityScaled: bigint('output_quantity_scaled', { mode: 'bigint' }).notNull(),
    outputUnit: text('output_unit').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'SUBMITTED_TO_NBR' | 'APPROVED' | 'SUPERSEDED'
    nbrSubmissionDate: date('nbr_submission_date'),
    nbrDivisionOffice: text('nbr_division_office'),
    totalRmCostPoisha: bigint('total_rm_cost_poisha', { mode: 'bigint' }).notNull().default(0n),
    directLaborCostPoisha: bigint('direct_labor_cost_poisha', { mode: 'bigint' }).notNull().default(0n),
    overheadCostPoisha: bigint('overhead_cost_poisha', { mode: 'bigint' }).notNull().default(0n),
    packagingCostPoisha: bigint('packaging_cost_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalValueAdditionPoisha: bigint('total_value_addition_poisha', { mode: 'bigint' }).notNull().default(0n),
    targetProfitMarginBps: integer('target_profit_margin_bps').notNull().default(1500),
    declaredPricePoisha: bigint('declared_price_poisha', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('mushak_43_company_num_uniq').on(t.companyId, t.declarationNumber)]
);

export const mushak43Ingredients = pgTable(
  'mushak_43_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    declarationId: uuid('declaration_id').notNull().references(() => mushak43Declarations.id, { onDelete: 'cascade' }),
    rawItemId: uuid('raw_item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
    netQuantityScaled: bigint('net_quantity_scaled', { mode: 'bigint' }).notNull(),
    wastageBps: integer('wastage_bps').notNull().default(0),
    grossQuantityScaled: bigint('gross_quantity_scaled', { mode: 'bigint' }).notNull(),
    unit: text('unit').notNull(),
    ratePerUnitPoisha: bigint('rate_per_unit_poisha', { mode: 'bigint' }).notNull(),
    totalCostPoisha: bigint('total_cost_poisha', { mode: 'bigint' }).notNull(),
    rebatableInputVat: boolean('rebatable_input_vat').notNull().default(true),
  },
  (t) => [index('mushak_43_ing_decl_idx').on(t.companyId, t.declarationId)]
);

export const productionBatches = pgTable(
  'production_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    declarationId: uuid('declaration_id').notNull().references(() => mushak43Declarations.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'restrict' }),
    batchNumber: text('batch_number').notNull(),
    productionDate: date('production_date').notNull(),
    producedQtyScaled: bigint('produced_qty_scaled', { mode: 'bigint' }).notNull(),
    totalRmConsumedPoisha: bigint('total_rm_consumed_poisha', { mode: 'bigint' }).notNull(),
    totalOverheadAbsorbedPoisha: bigint('total_overhead_absorbed_poisha', { mode: 'bigint' }).notNull(),
    totalFgCostPoisha: bigint('total_fg_cost_poisha', { mode: 'bigint' }).notNull(),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('POSTED'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('prod_batches_company_num_uniq').on(t.companyId, t.batchNumber)]
);

// 6. MFS WEBHOOKS & PAYMENT GATEWAY SETTLEMENTS
export const mfsWebhookEvents = pgTable(
  'mfs_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(), // 'BKASH' | 'NAGAD' | 'SSLCOMMERZ' | 'AAMARPAY'
    externalTrxId: text('external_trx_id').notNull(),
    invoiceId: uuid('invoice_id').references(() => salesDocuments.id, { onDelete: 'restrict' }),
    grossAmountPoisha: bigint('gross_amount_poisha', { mode: 'bigint' }).notNull(),
    mdrFeeBps: integer('mdr_fee_bps').notNull(),
    mdrFeePoisha: bigint('mdr_fee_poisha', { mode: 'bigint' }).notNull(),
    netSettledPoisha: bigint('net_settled_poisha', { mode: 'bigint' }).notNull(),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    rawPayload: text('raw_payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [unique('mfs_webhook_provider_trx_uniq').on(t.companyId, t.provider, t.externalTrxId)]
);
```