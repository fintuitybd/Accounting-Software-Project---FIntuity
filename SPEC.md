# LEDGERVAULT: UNIFIED PRODUCT CONCEPT BIBLE & MASTER TECHNICAL SPECIFICATION
# (Formerly Conceptual Project "HISAB" v1.0 & v2.0)
# Target Engine: DeepSeek v4.1 Flash 1017 (OpenCode 200K Context Window)
# Default Language: English (en-BD) with 1-Click Runtime Bangla (bn-BD) Parity

---

## 0. NON-NEGOTIABLE GUARDRAILS FOR DEEPSEEK CODING AGENT

1. **FUNCTIONALITY BEFORE DECORATION (NO CUSTOM SVGs IN PHASES 1–5):**
   - During **Phases 1, 2, 3, 4, and 5**, you are **STRICTLY FORBIDDEN** from writing custom `<svg><path d="..."/></svg>` art, Jamdani patterns, or decorative vector illustrations.
   - Use **ONLY** `lucide-react` icons and clean Tailwind CSS + Framer Motion layout transitions in Phases 1–5.
   - All custom multi-path SVGs are isolated exclusively to **Phase 6** after 100% of the accounting math, tax engine, `.xlsx`/`.csv` import/export studio, IAS/IFRS statements, and 12 workspaces compile and work cleanly.
2. **NO STUBS, NO `// TODO`, NO TRUNCATED FILES:**
   - Never write placeholder comments like `// TODO: implement rest` or `// ... remaining code`. Every file must be 100% complete, self-contained, and compilable under `tsc --noEmit`.
3. **BIGINT POISHA ARITHMETIC & JSON SERIALIZATION SAFETY:**
   - Never use floating-point numbers (`number` with decimals) for authoritative money calculations. All monetary values are stored and calculated as `bigint` minor units (`poisha`, where `1 BDT = 100 poisha`, e.g., `10000000n` = `BDT 1,00,000.00`).
   - Rates use integer basis points (`1500` = `15.00%`, `750` = `7.50%`, `450` = `4.50%`, `300` = `3.00%`).
   - **CRITICAL RUNTIME GUARD:** Register `(BigInt.prototype as any).toJSON = function() { return this.toString() + 'n'; };` at the top of `src/core/money.ts` and import `src/core/money.ts` as the very first line of `src/main.tsx` so `JSON.stringify` never throws `TypeError: Do not know how to serialize a BigInt`.
4. **SINGLE-LEDGER DERIVATION INVARIANT (MATHEMATICAL BALANCE GUARANTEE):**
   - Never hardcode static arrays for Trial Balance, Balance Sheet, P&L, or Mushak 9.1 separately from the General Ledger.
   - `seedData.ts` must seed an `OPENING_BALANCES` journal (`JE-2026-07-0001`) plus 25+ balanced September & October 2026 commercial journals where `SUM(debit_poisha) === SUM(credit_poisha)` on every journal.
   - All financial statements (Trial Balance, IAS 1 Balance Sheet, IFRS 18 P&L, IAS 7 Cash Flows, Subledger Reconciliation, and Mushak 9.1) MUST be computed dynamically from the live `journals` state array. This guarantees `Total Assets === Total Equity + Liabilities` down to `0` poisha at all times, including immediately after user transactions or mass `.xlsx` imports.
5. **SHEETJS (`xlsx`) IMPORT SYNTAX:**
   - Always import SheetJS using `import * as XLSX from 'xlsx';` (never default import `import XLSX from 'xlsx'`).
6. **DETERMINISTIC COMPLIANCE ENGINE:**
   - AI/NLP features (Natural Language Transaction Composer, Variance Commentary) NEVER invent tax rates, legal citations, or post journals directly. All tax calculations come strictly from `evaluateTaxDecision()` reading `bd-2026-v1.json`.

---

## 1. FULL PRODUCT CONCEPT BIBLE (COMPLETE VISION & STAGED ROADMAP)

### 1.1 Vision & The Five Defensible Promises
**Vision:** A Bangladeshi enterprise runs its finance, tax, compliance, IAS/IFRS reporting, corporate governance, and people operations from one calm, fast, high-trust operating system, with books and tax treatments that hold up to NBR and Big-4 auditors.

1. **Tax-Correct by Construction (Supported Set):** Every transaction displays, before saving, which VAT, SD, VDS, TDS, and AIT apply, why (rule ID, statutory clause, Rule Pack version), and how cash splits between the counterparty and the Government Treasury. Unsupported scenarios route safely to `MANUAL_REVIEW`, never guessed.
2. **Two Doors, One Engine:** **Guided Mode** for founders and junior staff with zero accounting training; **Pro Mode** with high-density tables, account codes, multi-book views, and keyboard shortcuts (`Ctrl+K`) for Chartered Accountants and Finance Controllers.
3. **Returns & Month-End Close Are Assembly, Not Re-Keying:** Mushak 6.1, 6.2, 6.3, 6.6, 9.1 VAT returns, VDS/TDS schedules, and month-end close assemble continuously from daily entries.
4. **Framework-Aware IAS/IFRS Books:** Multi-book architecture supporting `IFRS as adopted by FRC Bangladesh`, `IFRS for SMEs`, and `Simplified Management Basis`, fully ready for **IFRS 18** (effective 1 Jan 2027).
5. **Built for Bangladesh's Reality:** English (`en-BD`) default with instant Bangla (`bn-BD`) parity, Banglish search tolerance, Lakh/Crore (`12,34,56,789.00`) formatting, Taka-in-words, bKash/Nagad/Rocket MFS reconciliation, and load-shedding-safe local draft persistence.

### 1.2 Complete Persona Ecosystem
- **Farzana (Accounts Executive, Trading SME — `[MVP Primary]`):** Posts bills/invoices, handles VDS/TDS splits without fear, attaches evidence, runs month-end checks.
- **Mrs. Rahman (Owner-MD, Private Ltd — `[MVP Secondary]`):** Uses executive dashboard, approves payments, monitors cash runway, tax due on the 15th, and compliance rings.
- **External Auditor / Tax Consultant (`[MVP Read-Only & Export]`):** Inspects subledger-to-GL reconciliations, audit hash chains, and exports the 9-tab Excel Audit Pack.
- **Rafiq (Managing Partner, 60-Client Practice Firm — `[R2 Partner Cockpit, Previewed in Prototype]`):** Manages multiple client tenants, filing deadlines, and reviewer sign-offs from one console.
- **Nusrat (F-Commerce Founder — `[R2 Spark Mode]`):** Fast sales capture, courier COD reconciliation (Pathao, RedX, Steadfast), bKash merchant fees, turnover tax tracker.
- **Imran (HR & Admin Manager — `[R2/R3 People Suite, Previewed in Prototype]`):** Runs Labour Act payroll, festival bonuses, overtime, PF, gratuity (IAS 19), and statutory registers.
- **Mr. Hossain (Finance Controller, 400-Person RMG/Manufacturer — `[R3 Industry Suite]`):** Multi-level BOM, WIP costing, back-to-back LCs, bonded warehouse registers, UD/UP tracking, Mushak 4.3 input-output coefficients.
- **Group CFO (Multi-Entity Conglomerate — `[R4 Enterprise]`):** IFRS 10 consolidation, intercompany eliminations, 13-week cash scenario sandbox, covenant monitoring, board packs.

### 1.3 Complete Entity & Industry Taxonomy (Supported in Schema & Setup Wizard)
- **Entity Types:** Private Limited Company (Companies Act 1994, RJSC, WPPF), Public Listed Company (BSEC disclosures, EPS), Sole Proprietorship, Partnership Firm, Registered Startup (SRO tax/VAT relief), Foreign Branch/Liaison Office (BIDA, HO account), EPZ/BEPZA/BEZA/Hi-Tech Park Unit, NGO/NPO/MFI (Fund/donor accounting), Educational/Healthcare Institution, Group of Companies.
- **Industry Packs:** Trading & Distribution `[MVP Core]`, Services/IT/Agencies (export of services, reverse-charge VAT on imported ads/SaaS) `[MVP/R2]`, E-Commerce/F-Commerce (Daraz/Shopify, Courier COD), Retail & POS (EFD/SDC QR), Manufacturing (BOM, Mushak 4.3), RMG & Textile Export (Back-to-Back LC, Bonded Warehouse, UD/UP), Pharma & FMCG (Batch/Expiry, MRP), Construction & Real Estate (IFRS 15 over-time, retention, landowner share), Agriculture/Poultry/Fisheries (IAS 41 biological assets), Transport & Logistics, Hospitality & F&B.

### 1.4 Authoritative 2026 Bangladesh Regulatory Baseline (All Rules Tagged `[VERIFY]`)
1. **P0 Correction — VAT Return Filing Frequency (Ordinance No. 38 of 2026):**
   - The earlier Finance Act 2026 quarterly-filing proposal was superseded by the **Value Added Tax and Supplementary Duty (Amendment) Ordinance, 2026 (Ordinance No. 38 of 2026, gazetted 14 October 2026, effective 13 October 2026)**, which replaced Section 64 of the VAT & SD Act 2012.
   - **Current Rule:** Standard taxpayers must file **Mushak 9.1** within **15 days** after each tax period (next working day if the 15th is a government holiday). Government, semi-government, autonomous bodies, banks, insurance entities, and nil-return filers may file within **20 days**. (Historical July–September 2026 transition period is preserved in Rule Pack metadata).
2. **Labour Law Baseline (`[R2/R3]`):** Incorporates the **Bangladesh Labour (Amendment) Act 2026** and **SRO 53-Law/2026 (16 Feb 2026)** amending the Bangladesh Labour Rules 2015 via configurable worker-classification profiles (Permanent, Probationary, Contractual, Piece-rate, Apprentice).
3. **Data Protection & Cybersecurity (`[MVP Controls]`):** Aligned with the **Personal Data Protection Act 2026 (Act No. 63 of 2026)** and **Cyber Security Act 2026 (Act No. 81 & Amendment Act No. 99 of 2026)** via PII field masking (NID, TIN, Bank/MFS), role-based access, data portability export, and SHA-256 tamper-evident audit logging.
4. **Financial Reporting Framework (FRC Bangladesh & IFRS 18):**
   - Distinguishes `Full IFRS as adopted by FRC Bangladesh`, `IFRS for SMEs as adopted in Bangladesh`, and `Simplified Management Basis`.
   - Implements **IFRS 18 (Presentation and Disclosure in Financial Statements, effective 1 Jan 2027)** with the 5 P&L categories (`Operating`, `Investing`, `Financing`, `Income Taxes`, `Discontinued Operations`), the 2 mandatory subtotals (`Operating Profit/Loss` and `Profit/Loss Before Financing and Income Taxes`), Management-Defined Performance Measures (MPMs), and the updated **IAS 7 Indirect Cash Flow method starting directly from Operating Profit**.

---

## 2. UNIFIED DIRECTORY STRUCTURE & CORE DATA CONTRACTS

Build the entire application inside a clean, single-package Vite + React + TypeScript project so `npm install && npm run dev` works with zero workspace symlink errors:

```text
ledgervault/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
└── src/
    ├── main.tsx
    ├── index.css
    ├── core/
    │   ├── money.ts                 # BigInt poisha math, JSON polyfill, Lakh/Crore formatter, Taka-in-Words (EN & BN)
    │   ├── i18n.ts                  # English (en-BD default) & Bangla (bn-BD) dictionaries + Banglish search helper
    │   ├── types.ts                 # Complete domain types (Entity, Account, Journal, CommercialDoc, TaxDecision, etc.)
    │   ├── tax-engine/
    │   │   ├── rulePack.ts          # bd-2026-v1 Rule Pack (Ordinance 38/2026, VAT, SD, VDS, TDS, s.46 Rebate, Reverse Charge)
    │   │   ├── engine.ts            # Deterministic evaluateTaxDecision() & Transaction Orchestrator preview
    │   │   └── goldenSuite.ts       # 25 comprehensive Bangladesh tax test scenarios + live runner
    │   ├── ledger/
    │   │   ├── ledgerEngine.ts      # Self-balancing journal validator, reversal generator, subledger control reconciler, SHA-256 hash chain
    │   │   └── seedData.ts          # Complete balanced Sep & Oct 2026 dataset for Apex Delta Trading Ltd. + 2 switchable personas
    │   ├── ifrs-engine/
    │   │   └── ifrsEngine.ts        # Dynamic Trial Balance, IAS 1 Balance Sheet, IFRS 18 P&L, IAS 7 Cash Flows (starting at Operating Profit), Equity, Notes
    │   └── import-export/
    │       └── xlsxEngine.ts        # SheetJS (.xlsx) & .csv parser, dry-run simulator, atomic batch commit, 1-click rollback, 9-tab Audit Pack exporter
    ├── context/
    │   └── VaultContext.tsx         # Global reactive store with LocalStorage persistence, Persona Switcher, Mode, Locale, and Motion Tier
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx         # Sidebar (12 workspaces) + Top Control Bar (Persona, Guided/Pro, EN/BN, Latin/BN numerals, Motion Tier)
    │   │   └── CommandPalette.tsx   # Ctrl+K / Cmd+K instant fuzzy & Banglish command jumper
    │   ├── signature/
    │   │   ├── TaxAdvisorCard.tsx   # Live pre-save tax breakdown, Tax Waterfall, Counterparty checks, "Explain This" provenance drawer
    │   │   ├── TransactionComposer.tsx # Natural language EN/BN/Banglish parser -> live structured draft + Tax Waterfall
    │   │   ├── LedgerLensModal.tsx  # 3D flip / slide-over showing balanced double-entry lines, Multi-Book tag, and SHA-256 hash
    │   │   └── StatutoryPrintModal.tsx # Pixel-faithful A4 print layouts: Mushak 6.3, Mushak 6.6, Mushak 9.1, and Audited IFRS Statements
    │   └── svg/                     # (BUILT IN PHASE 6 ONLY)
    │       ├── VaultVisuals.tsx     # Prismatic Crest Logo, Jamdani Guilloche Watermark, Compliance Rings SVG, Period-Locked Seal
    │       └── MoneyFlowSankey.tsx  # Animated Cubic-Bezier Cash & Tax Flow Sankey Diagram
    └── workspaces/
        ├── W01_ExecutiveCockpit.tsx # KPIs, Composer, Compliance Rings, Sankey Map, 13-Week CFO Cash Forecast & Scenario Sliders
        ├── W02_SalesMushak63.tsx    # Quotes, Invoices, Credit Notes (6.7), gap-free Mushak 6.3 serial allocation, VDS buyer flag, A4 print
        ├── W03_PurchasesWithholding.tsx # Vendor Bills, VDS/TDS split at payment, Missing TIN 50% penalty, Cash >100k disallowance, Reverse Charge VAT
        ├── W04_TreasuryChallans66.tsx # VDS/TDS Treasury Challan batching, Mushak 6.6 Certificate issuance, Customer 6.6 chasing queue
        ├── W05_VatRegisters91.tsx   # Mushak 6.1 Purchase Register, 6.2 Sales Register, VAT Current Account (Note 18), Mushak 9.1 Return Pack + GL Proof
        ├── W06_BankingMfsReconcile.tsx # City Bank, BRAC Bank, bKash & Nagad Merchant wallets, fee auto-split, statement auto-matcher
        ├── W07_MassImportExportStudio.tsx # 4-Pipeline .XLSX / .CSV Import Studio, Dry-Run Simulation, 1-Click Batch Rollback, 9-Tab Excel Export
        ├── W08_IfrsStatementsStudio.tsx # FRC Matrix Banner, Multi-Book Switcher, IAS 1 BS, IFRS 18 P&L + MPMs, IAS 7 Cash Flow, Equity, Notes, GL Drilldown
        ├── W09_CloseAndControl.tsx  # Subledger-to-GL Reconciliation Dashboard, Suspense Queue, 11-Step Month-End Close Wizard, SHA-256 Verifier
        ├── W10_PayrollLabourSuite.tsx # Labour Act 2026 Payroll-Lite, Worker Classes, Festival Bonus, Overtime, PF, IAS 19 Gratuity, BEFTN/bKash export
        ├── W11_SecretarialGovernance.tsx # RJSC Registers, Share Ledger, Trade/Fire/Env/DIFE Licence Tracker, NBR Notice & Appeals Manager
        └── W12_RulePackAndFirmCockpit.tsx # bd-2026-v1 Rule Explorer, Live 25 Golden Test Runner, "What Changed?" Impact Simulator, 60-Client Practice View
```

### 2.1 `src/core/money.ts` Specification (Zero-Float Poisha Math)
Implement and export:
1. **Global BigInt JSON Patch (Execute immediately on module load):**
   ```typescript
   if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
     (BigInt.prototype as any).toJSON = function () {
       return this.toString();
     };
   }
   ```
2. `bdtToPoisha(bdt: number | string): bigint`: Converts `"1250.50"` or `1250.5` cleanly via string manipulation (`whole * 100n + frac`) without binary float drift.
3. `poishaToBdtNumber(poisha: bigint): number`: Only used for chart axis coordinates or SheetJS numeric cells (`Number(poisha) / 100`).
4. `applyRateBps(basePoisha: bigint, rateBps: number, mode: 'HALF_UP' | 'FLOOR' | 'CEIL' = 'HALF_UP'): bigint`:
   - `HALF_UP`: `((basePoisha * BigInt(Math.round(rateBps))) + 5000n) / 10000n`.
5. `formatPoisha(poisha: bigint, opts?: { locale?: 'en-BD' | 'bn-BD'; numeral?: 'latin' | 'bn'; grouping?: 'LAKH_CRORE' | 'MILLIONS'; showSymbol?: boolean; showSign?: boolean }): string`:
   - Formats `12345678900n` as `৳ 12,34,56,789.00` (or `৳ ১২,৩৪,৫৬,৭৮৯.০০` when `numeral === 'bn'`).
6. `takaInWords(poisha: bigint, locale: 'en-BD' | 'bn-BD'): string`:
   - Converts poisha into statutory Bangladeshi words in both English (`"One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Taka and Ninety Poisha Only"`) and Bangla (`"এক কোটি তেইশ লক্ষ পঁয়তাল্লিশ হাজার ছয়শত আটাত্তর টাকা নব্বই পয়সা মাত্র"`).

---

## 3. DETERMINISTIC TAX ENGINE & 25 GOLDEN VECTORS (`src/core/tax-engine/`)

### 3.1 Rule Pack (`bd-2026-v1`) Core Rules (All Legal Citations Marked `[VERIFY]`)
Build `rulePack.ts` and `engine.ts` to evaluate `TaxEvaluationInput` and return a complete `TaxDecision` object:

| Rule ID | Domain | Rate (bps) | Statutory Citation (`[VERIFY]`) | Trigger & Deterministic Accounting Behaviour |
|---|---|---|---|---|
| `VAT_FILING_S64_ORD38_2026` | `FILING` | N/A | VAT & SD (Amendment) Ordinance 2026 (Ord. No. 38 of 2026, gazetted 14 Oct 2026, eff. 13 Oct 2026), s.64 | Mushak 9.1 due within **15 days** after tax period end (**20 days** for Govt/Banks/Insurers/Nil filers). |
| `VAT_STD_15` | `VAT` | `1500` (15%) | VAT & SD Act 2012, s.15 & First/Third Schedule `[VERIFY]` | Standard taxable supply/purchase. Eligible for input credit ONLY if s.46 conditions pass. |
| `VAT_TRADING_5` | `VAT` | `500` (5%) | VAT & SD Act 2012, Third Schedule Trading Tier `[VERIFY]` | Truncated 5% trading rate. Automatically sets `input_credit.eligible = false` per s.46. |
| `VAT_PROCUREMENT_7_5` | `VAT` | `750` (7.5%) | VAT & SD Act 2012 / VDS Rules Procurement Provider `[VERIFY]` | 7.5% rate; mandatory 100% VDS withholding by corporate payer; no input rebate for supplier. |
| `VAT_EXPORT_ZERO` | `VAT` | `0` (0%) | VAT & SD Act 2012, s.24 Zero-Rated Export `[VERIFY]` | 0% Output VAT; 100% eligible for Input VAT rebate / duty drawback on associated inputs. |
| `VAT_EXEMPT` | `VAT` | `0` (Exempt) | VAT & SD Act 2012, First Schedule `[VERIFY]` | Exempt supply; disallows input VAT credit on directly attributable inputs. |
| `VAT_REVERSE_CHARGE_S20` | `VAT` | `1500` (15%) | VAT & SD Act 2012, s.20 Imported Service `[VERIFY]` | Self-assessed 15% VAT on foreign digital services (Meta/Google Ads, AWS, foreign SaaS); payable via Treasury Challan. |
| `S46_REBATE_GUARD` | `REBATE` | N/A | VAT & SD Act 2012, s.46 Input Tax Credit Conditions `[VERIFY]` | Blocks Input VAT credit if: (a) Supplier 13-digit BIN invalid/missing, (b) Mushak 6.3 missing, (c) Cash payment > BDT 1,00,000 (`10000000n` poisha), or (d) Output/Purchase rate < 15%. Capitalizes disallowed VAT into expense/inventory cost. |
| `VDS_WITHHOLDING_S49` | `VDS` | `1500` / `750` / `500` | VAT & SD Act 2012, s.49 & VDS Rules `[VERIFY]` | When payer is a Withholding Entity on VDS-mandatory services/supplies, deducts VDS from vendor payment, queues Treasury Challan, and generates **Mushak 6.6**. |
| `TDS_GOODS_S89` | `TDS` | `300` (3%) | Income Tax Act 2023, s.89 Payment to Suppliers `[VERIFY]` | Deducted on Base amount (excl. VAT). Upscaled by 50% to `450 bps` (4.5%) if vendor 12-digit e-TIN is missing! |
| `TDS_PROF_SVC_S90` | `TDS` | `1000` (10%) | Income Tax Act 2023, s.90 Professional/Technical Services `[VERIFY]` | Deducted on Base amount (excl. VAT). Upscaled by 50% to `1500 bps` (15%) if vendor e-TIN is missing! |
| `TDS_RENT_S109` | `TDS` | `500` (5%) | Income Tax Act 2023, s.109 Commercial Rent `[VERIFY]` | 5% TDS on base rent + 15% VAT/VDS handling. |
| `TDS_ADVERTISING_S92` | `TDS` | `500` (5%) | Income Tax Act 2023, s.92 Media/Advertising `[VERIFY]` | 5% TDS on base + 15% VDS. |
| `TDS_TRANSPORT_S91` | `TDS` | `300` (3%) | Income Tax Act 2023, s.91 Transport/Logistics `[VERIFY]` | 3% TDS on base freight. |

### 3.2 Stacking & Settlement Formula (Enforced in `engine.ts`)
For any commercial bill or payment:
- $\text{Gross Invoice} = \text{Base Net} + \text{SD} + \text{VAT}$
- Both **VDS** and **TDS** calculate against $\text{Base Net}$ (never TDS-on-VAT).
- $\text{Net Payable to Counterparty} = \text{Gross Invoice} - \text{VDS Withheld} - \text{TDS Withheld}$
- $\text{Payable to Government Treasury} = \text{VDS Withheld} + \text{TDS Withheld}$

---

## 4. SELF-BALANCING SEED DATASET & MULTI-BOOK CHART OF ACCOUNTS (`src/core/ledger/seedData.ts`)

Seed a rich, realistic dataset for **Apex Delta Trading Ltd.** (`TIN: 549821003412`, Principal Dhaka BIN: `001482910-0101`, Chattogram Branch BIN: `001482910-0102`, Reporting Framework: `IFRS_FRC_ADOPTED` with `IFRS 18` enabled) plus two switchable demo personas (*CloudNine Digital Ltd.* and *Rafiq & Associates CA Practice*).

### 4.1 Complete Chart of Accounts (`Account[]`)
Include these exact accounts so every IAS 1, IFRS 18, IAS 7, and Mushak report maps cleanly:
- **Assets (`1000–1999`):**
  - `1110` City Bank Corporate Current A/C (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `BANK_MFS`)
  - `1115` BRAC Bank Foreign Currency & Trade A/C (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `BANK_MFS`)
  - `1120` bKash Merchant Settlement Wallet (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `BANK_MFS`)
  - `1125` Nagad Corporate Merchant Wallet (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `BANK_MFS`)
  - `1130` Petty Cash Imprest — Dhaka HQ (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `BANK_MFS`)
  - `1140` VAT Current Account — Mushak 9.1 Note 18 (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `VAT_CURRENT_ACCOUNT`)
  - `1145` VDS Receivable — Customer Mushak 6.6 Pending (`CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1150` Advance Income Tax (AIT / Customer TDS Credit) (`CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1210` Trade Accounts Receivable — Control (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `AR`)
  - `1219` Allowance for Expected Credit Losses — IFRS 9 ECL (`CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1310` Merchandise Inventory — Weighted Average (`CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `INVENTORY`)
  - `1410` Short-Term Fixed Deposit Receipt (FDR Investment) (`CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1610` Property, Plant & Equipment (Cost) (`NON_CURRENT_ASSET`, `NA_BALANCE_SHEET`, Subledger: `FIXED_ASSETS`)
  - `1619` Accumulated Depreciation — PPE (`NON_CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1710` Right-of-Use Assets — Warehouse & Office Leases (IFRS 16) (`NON_CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1719` Accumulated Depreciation — ROU Assets (IFRS 16) (`NON_CURRENT_ASSET`, `NA_BALANCE_SHEET`)
  - `1810` Deferred Tax Asset (IAS 12) (`NON_CURRENT_ASSET`, `NA_BALANCE_SHEET`)
- **Liabilities (`2000–2999`):**
  - `2110` Trade Accounts Payable — Control (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`, Subledger: `AP`)
  - `2120` Output VAT Payable (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2130` VDS Withheld Payable to Treasury (Mushak 6.6) (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`, Subledger: `VDS_PAYABLE`)
  - `2140` TDS Withheld Payable to Treasury (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`, Subledger: `TDS_PAYABLE`)
  - `2150` Reverse Charge VAT Payable (Imported Services) (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2160` Accrued Salaries, Festival Bonus & PF Payable (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2170` WPPF & Welfare Fund Provision (Labour Act) (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2180` Current Income Tax Provision (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2190` Suspense & Unapplied Cash Clearing Account (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2210` Short-Term Working Capital Loan (LTR / CC) (`CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2510` Lease Liabilities — Non-Current & Current (IFRS 16) (`NON_CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
  - `2610` Defined Benefit Gratuity Obligation (IAS 19) (`NON_CURRENT_LIABILITY`, `NA_BALANCE_SHEET`)
- **Equity (`3000–3999`):**
  - `3100` Issued & Paid-Up Share Capital (`EQUITY_CAPITAL`, `NA_BALANCE_SHEET`)
  - `3200` Retained Earnings / Accumulated Surplus (`EQUITY_RESERVES`, `NA_BALANCE_SHEET`)
- **Revenue & Income (`4000–4999`):**
  - `4100` Revenue from Sale of Goods — Local Standard 15% (`OPERATING_REVENUE`, `OPERATING`)
  - `4110` Revenue from Corporate Contracts (VDS Applicable) (`OPERATING_REVENUE`, `OPERATING`)
  - `4120` Export & Zero-Rated Service Revenue (`OPERATING_REVENUE`, `OPERATING`)
  - `4200` Sales Returns & Credit Note Adjustments (Mushak 6.7) (`OPERATING_REVENUE`, `OPERATING`)
  - `4500` Interest Income on Independent FDR Investments (`INVESTING_INCOME`, `INVESTING`)
- **Expenses (`5000–5999`):**
  - `5100` Cost of Goods Sold (COGS) & Disallowed Input VAT (`COST_OF_SALES`, `OPERATING`)
  - `5200` Salaries, Wages, Overtime & Festival Bonuses (`OPERATING_EXPENSE`, `OPERATING`)
  - `5210` Employer PF Contribution & IAS 19 Gratuity Service Cost (`OPERATING_EXPENSE`, `OPERATING`)
  - `5300` Commercial Office & Warehouse Rent (`OPERATING_EXPENSE`, `OPERATING`)
  - `5310` Professional, Audit, Tax & Legal Consultancy Fees (`OPERATING_EXPENSE`, `OPERATING`)
  - `5320` Digital Marketing, Cloud & Imported SaaS (Meta/Google/AWS) (`OPERATING_EXPENSE`, `OPERATING`)
  - `5330` Freight, Transport & Courier Delivery Charges (`OPERATING_EXPENSE`, `OPERATING`)
  - `5400` Depreciation Expense — PPE & IFRS 16 ROU Assets (`OPERATING_EXPENSE`, `OPERATING`)
  - `5450` Expected Credit Loss (ECL) Impairment Expense (IFRS 9) (`OPERATING_EXPENSE`, `OPERATING`)
  - `5800` Interest Expense on Bank LTR/CC Borrowings (`FINANCE_COST`, `FINANCING`)
  - `5810` Interest Unwinding on IFRS 16 Lease & IAS 19 Liabilities (`FINANCE_COST`, `FINANCING`)
  - `5820` Bank Charges, Excise Duty & bKash/Nagad Settlement Fees (`FINANCE_COST`, `FINANCING`)
  - `5900` Corporate Income Tax Expense (`TAX_EXPENSE`, `INCOME_TAX`)

---

## 5. IFRS 18 & IAS 7 DYNAMIC REPORTING RULES (`src/core/ifrs-engine/ifrsEngine.ts`)

1. **IFRS 18 Statement of Profit or Loss Waterfall:**
   - **Operating Category:** All `OPERATING` accounts (`4100–4200` less `5100–5450`) $\rightarrow$ **Mandatory Subtotal 1: Operating Profit / (Loss)**.
   - **Investing Category:** All `INVESTING` accounts (`4500` FDR investment returns) $\rightarrow$ **Mandatory Subtotal 2: Profit / (Loss) Before Financing and Income Taxes** (`Operating Profit + Investing Income`).
   - **Financing Category:** All `FINANCING` accounts (`5800` Bank interest, `5810` IFRS 16 Lease interest & IAS 19 net interest, `5820` Bank/MFS fees) $\rightarrow$ **Subtotal: Profit / (Loss) Before Income Tax (PBT)**.
   - **Income Taxes Category:** `5900` Corporate Tax Expense $\rightarrow$ **Profit / (Loss) for the Period**.
   - **Management-Defined Performance Measures (MPMs) Disclosure Panel:** Displays `Adjusted EBITDA = Operating Profit + Depreciation (5400) + IFRS 9 ECL Provision (5450)` with a side-by-side reconciliation table to `Operating Profit` per IFRS 18 paragraphs 117–125.
2. **IAS 7 Statement of Cash Flows (Updated for IFRS 18):**
   - Under the **Indirect Method**, Line 1 MUST start with **Operating Profit / (Loss)** (per IFRS 18 consequential amendments to IAS 7), then adjust for non-cash operating items (`5400` Depreciation, `5450` ECL), changes in working capital (`AR`, `Inventory`, `VAT Current Account`, `AP`, `VDS/TDS Payable`), and tax paid.

---

## 6. PHASED BUILD ROADMAP (6 PHASES)

- **PHASE 1:** Project configuration + `src/core/money.ts` + `src/core/i18n.ts` + `src/core/types.ts` + `src/core/tax-engine/` (`rulePack.ts`, `engine.ts`, `goldenSuite.ts`).
- **PHASE 2:** `src/core/ledger/ledgerEngine.ts` + `src/core/ledger/seedData.ts` + `src/core/ifrs-engine/ifrsEngine.ts` + `src/core/import-export/xlsxEngine.ts` + `src/context/VaultContext.tsx`.
- **PHASE 3:** Layout & Signature Components (`AppShell.tsx`, `CommandPalette.tsx`, `TaxAdvisorCard.tsx`, `TransactionComposer.tsx`, `LedgerLensModal.tsx`, `StatutoryPrintModal.tsx`) using `lucide-react` icons only.
- **PHASE 4:** Workspaces 1 to 6 (`W01_ExecutiveCockpit` through `W06_BankingMfsReconcile`).
- **PHASE 5:** Workspaces 7 to 12 (`W07_MassImportExportStudio` through `W12_RulePackAndFirmCockpit`) + `App.tsx` wiring + full TypeScript compile check.
- **PHASE 6:** Custom SVGs & Choreography (`src/components/svg/VaultVisuals.tsx`, `src/components/svg/MoneyFlowSankey.tsx`, Jamdani guilloche watermarks, spring physics).