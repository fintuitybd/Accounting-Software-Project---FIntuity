# ERP Master Audit and Implementation Plan

**Product:** LedgerVault / Fintuity Accounting & Business ERP  
**Repository audited:** `C:\Fintuity\Accounting Software Project - Copy`  
**Package version:** `ledgervault@2.0.0`  
**Audit date:** 05 November 2026  
**Document status:** Audit and planning only. No application source code, database schema, configuration, or behaviour was changed.

> **Evidence convention.** File references and line numbers refer to the audited snapshot. Where a line number is given, it is an indicator, not a permanent contract; function names and file paths are the durable references. Findings are classified as **Verified working**, **Verified defect**, **Missing**, **Suspected / needs runtime confirmation**, or **External requirement requiring official verification**. The audit used source inspection, `npx tsc --noEmit`, the existing self-check scripts, the 25-vector golden tax suite, and a live browser smoke check of the development build. No browser storage or application data was altered in the repository.

---

## 1. Executive summary

### 1.1 Verdict

This repository is a **high-fidelity frontend prototype**, not a production accounting system.

It contains genuinely valuable work: a deterministic BigInt money engine, a balanced double-entry journal engine with a SHA-256 chain, a large structured Bangladesh tax rule pack, dynamic financial-statement derivation, XLSX import/export, a complete English/Bangla dictionary pair, and twelve visually ambitious workspaces. The visual shell is more polished than most prototypes. The domain thinking is often stronger than the implementation around it.

It is not yet safe to use for real books, real payroll, real VAT filings, or real company records. The decisive problems are architectural, not cosmetic:

- There is **no backend, no database, no server-side authentication, no server-side authorization, and no multi-user persistence**. The complete ledger is a JavaScript object stored in browser `localStorage` and IndexedDB.
- The app opens **already signed in as an administrator**, exposes a role switcher, and has no password, session, invitation, password-reset, or user-management flow.
- Several workflows are **disconnected simulations**. Quotations, sales orders, delivery challans, purchase orders and GRNs live in React component state and disappear on navigation or refresh. Receipt and payment journals do not update the underlying invoice or bill. New purchases do not create treasury challans. GRNs and challans do not move stock. The bank-reconciliation screen reconciles seeded statement lines, not imported bank statements.
- The reporting layer is locked to **October 2026** while new transactions default to **1 November 2026**. A user can post a transaction and then find it absent from the financial statements.
- The product generates an **“Independent Auditor’s Report” with an opinion and a named chartered-accountancy firm** even though no audit occurred. This is not a cosmetic defect; it must be removed before the product is shown to any external party.
- The most important statutory claims in the rule pack are explicitly marked `[VERIFY]` and `PENDING_TAX_COUNSEL`. They must not be presented to customers as confirmed Bangladesh law until independently checked against the official gazette and reviewed by qualified local professionals.
- There is **no automated test runner, linting, CI, or version-control repository** in the audited folder. The existing self-checks are useful, but they test engine consistency, not the UI, authentication, tenant isolation, storage failure, or real business workflows.

**Recommendation:** do not rewrite from zero. Preserve the domain assets, but productionise the product behind a real server-backed architecture and reduce the initial release scope. The current twelve-workspace breadth is a liability until the accounting core is correct.

### 1.2 What must be preserved

| Asset | Why it matters |
|---|---|
| `src/core/money.ts` | Integer poisha arithmetic; avoids binary floating-point errors in authoritative money. |
| `src/core/ledger/ledgerEngine.ts` | Journal validation, deterministic audit hashing, linked-reversal model, subledger proof concept. |
| `src/core/tax-engine/rulePack.ts` + `engine.ts` | Deterministic, explainable tax decisions. The *structure* is good; the *legal content* needs verification and versioned configuration. |
| `src/core/ifrs-engine/ifrsEngine.ts` | Dynamic statements derived from journals rather than hard-coded report arrays. |
| `src/core/import-export/xlsxEngine.ts` | Dry-run import, row validation, batch journal generation, audit-pack export. |
| `src/core/i18n.ts` + `src/core/locales/*` | 1,222-key English/Bangla parity, Banglish search vocabulary, locale-aware number/date helpers. |
| `src/components/commercial/CommercialShared.tsx` and the 3-zone workbench pattern | A sound starting point for document-oriented ERP interaction. |
| Existing self-check scripts | Useful regression evidence for the money and ledger engines. |

### 1.3 The ten most serious findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | Critical | No real authentication or session. App defaults to authenticated admin; sign-in accepts a username only; any user can switch to any role. | `VaultContext.tsx:339`, `587–613`; `AuthAndOnboardingModal.tsx:367–375`, `648–666`; `App.tsx:89–95` |
| 2 | Critical | No backend or database. The system of record is browser storage; clearing browser data, changing browsers, or opening another device loses the books. No concurrency, tenancy, or server audit trail exists. | `src/core/storage/vaultDb.ts`; `VaultContext.tsx:636–664` |
| 3 | Critical | Switching persona, creating a new company, or importing a vault replaces the complete financial state, with no backup or confirmation. A user can erase the books with one click. | `VaultContext.tsx:835–858`, `1833–1850`, `1885–1903`; `TopBar.tsx:190–193` |
| 4 | Critical | Reporting periods and dates are hard-coded to October 2026, while new documents default to 1 November 2026. New entries do not appear in the statements. | `W02_SalesMushak63.tsx:87–89`; `W03_PurchasesWithholding.tsx:90–92`; `VaultContext.tsx:709`; `App.tsx:270`; `W01_ExecutiveCockpit.tsx:48` |
| 5 | Critical | Periods marked `CLOSED` still accept postings; only `LOCKED` is rejected. The seed marks July, August and September 2026 as `CLOSED`, yet the posting engine permits entries there. | `ledgerEngine.ts:271–285`; `seedData.ts:504–509` |
| 6 | Critical | Sales and purchase pre-invoice workflows are ephemeral React state. Quotations, orders, challans and GRNs vanish on navigation or refresh. The dashboard’s “pending SO/PO” count cannot see them. | `W02_SalesMushak63.tsx:648`, `700–711`; `W03_PurchasesWithholding.tsx:699`, `755–778` |
| 7 | Critical | Credit notes consume Mushak 6.3 invoice serials and use invoice numbering. There is no independent Mushak 6.7 series and no link to the original invoice. | `VaultContext.tsx:905–907`; `W02_SalesMushak63.tsx:829–861`; `ledgerEngine.ts:669–687` |
| 8 | Critical | Customer receipts and supplier payments post journals but do not update the document’s settled amount/status or the AR/AP subledger. Controls immediately disagree after normal use. | `W02_SalesMushak63.tsx:995–1061`; `W03_PurchasesWithholding.tsx:1228–1310` |
| 9 | Critical | The “audited financial statements” print pack fabricates an independent auditor’s opinion, a basis-for-opinion paragraph, key audit matters, and a named CA firm. | `StatutoryPrintModal.tsx:1412–1475`; `W08_IfrsStatementsStudio.tsx:754` |
| 10 | Critical | Reversal reverses one journal only, does not check whether it is already reversed, does not reverse linked settlement/stock effects, and can append the same reversal twice. | `VaultContext.tsx:1098–1133`; `ledgerEngine.ts:576–638` |

### 1.4 Recommended product decision

Build a **production MVP for Bangladeshi trading and service SMEs first**:

- Single legal company per organisation at launch; multi-company schema and switching designed now but exposed later.
- Sales invoices, credit notes, customer receipts, purchase bills, expense vouchers, supplier payments, general journals, inventory for stock items, bank/MFS reconciliation, VAT registers and return preparation, financial statements, period close, audit trail, roles and approvals.
- Bilingual English/Bangla interface with a governed terminology list.
- Defer payroll, fixed assets, manufacturing, secretarial/RJSC registers, 60-client practice cockpit, group consolidation and advanced IFRS multi-book adjustments until the accounting core is trustworthy.

The current app can remain available as a **clearly labelled demo environment** while the production application is built. Demo data must never be mixed with real books.

### 1.5 What “done” means

A release is acceptable only when an accountant can complete the following without developer help, and the resulting books reconcile:

1. Create an organisation and company.
2. Configure fiscal year, tax registrations, branches and numbering.
3. Load or build a chart of accounts.
4. Enter balanced opening balances.
5. Invite users and assign company-scoped roles.
6. Create, approve and post a sales invoice.
7. Receive a customer payment and allocate it to the invoice.
8. Create a purchase bill, receive stock, and pay the supplier with correct withholding.
9. Deposit withholding tax to the treasury and issue/receive the relevant certificate.
10. Reconcile a bank statement.
11. Prepare the VAT return and financial statements for a selected period.
12. Close and lock the period with maker-checker evidence.
13. Correct a mistake through a linked reversal with a reason and approval.
14. Produce an audit trail and a restorable backup.

If any of these fail, the product is not production-ready regardless of how polished the dashboard looks.

---

## 2. Product vision and target users

### 2.1 Product vision

**A calm, trustworthy accounting and business operating system for Bangladeshi organisations, where the books are correct by construction, every statutory figure is explainable, and a normal accountant can complete the day’s work without learning the internal data model.**

The product should be:

- **Correct before clever.** No feature is complete if it can create an unbalanced, duplicate, misclassified or unreconciled accounting record.
- **Prepared, not re-keyed.** A sale, purchase, payment or tax return should assemble from records already captured, not be retyped into a separate screen.
- **Explainable.** Before posting, the user sees the accounting entries and the tax reasoning in plain language. An experienced accountant can open the technical detail.
- **Local by design.** BDT, Bangladeshi fiscal practice, Bangla/English, BIN/TIN, Mushak registers and local banking/MFS behaviour are first-class, not translated afterthoughts.
- **Safe to operate.** Permissions, approvals, period locks, reversals, audit logs and backups are part of the workflow, not an administration afterthought.

### 2.2 Target users

| Persona | Real job | What they need from the product | What would make them abandon it |
|---|---|---|---|
| Owner / Managing Director | Know cash, profit, receivables, payables and tax exposure; approve large payments | One trustworthy summary, exception-based alerts, approvals on a phone, no accounting jargon | A dashboard full of decorative charts that does not answer “how much cash do we have and what must I approve?” |
| Finance manager / controller | Own the close, controls, reconciliations and reporting | Review queues, segregation of duties, period lock, drill-down, reliable statements, exportable evidence | Being unable to trace a report line to a journal and source document |
| Accountant / accounts executive | Enter invoices, bills, receipts, payments, journals; reconcile; prepare VAT | Fast keyboard-friendly entry, reusable masters, automatic tax calculation, clear errors, easy correction | Repeated data entry, hidden mandatory fields, losing a draft on refresh, unexplained posting failures |
| Cashier / transaction operator | Record receipts and payments accurately | Simple receipt/payment screens, cash/bank selection, immediate printable receipt, no ability to alter posted entries | Needing to understand debits and credits to take a payment |
| Inventory / warehouse staff | Receive, issue, transfer and count stock | GRN/delivery notes, warehouse selection, stock visibility, shortage alerts, no accounting clutter | Stock changing without a documented movement |
| HR / payroll officer | Run payroll and statutory deductions | Employee master, salary components, attendance/overtime inputs, payroll register, bank files | A payroll screen that cannot save a run or re-posts the same payroll twice |
| Auditor / tax consultant | Inspect, sample, reconcile and export | Read-only access, immutable audit trail, subledger proofs, exports, source evidence | Being asked to trust a hash chain stored in the browser |
| System administrator | Manage users, roles, companies, integrations and backups | Invitations, role assignment, session control, audit log, backup/restore, health status | A “role switcher” that lets anyone become admin |

### 2.3 Product principles

1. **The general ledger is the only source of financial truth.** Invoices, bills, stock, tax returns and reports are views or derivations of posted journals, not parallel calculations.
2. **A business document and its accounting entries are one transaction.** Posting either succeeds completely or changes nothing.
3. **The user should never need to know a database table, account code, or journal-number format to complete a normal task.** Technical detail is available on demand.
4. **Progressive disclosure.** Guided mode explains the business step; Pro mode exposes account codes, journal previews, bulk actions and keyboard shortcuts.
5. **No silent correction.** Posted records are corrected by linked reversal, never by editing or deleting history.
6. **Every exception has an owner and a next action.** No suspense balance without an ageing queue and a resolution path.
7. **No regulatory claim without a source and a reviewer.** A rate is configuration, not a comment in source code.
8. **No demo data in a real company.** Seed data is an explicit demo mode, not the default production state.

### 2.4 Scope decisions

| Scope | Include in production MVP | Later | Deliberately not planned |
|---|---|---|---|
| Company | Single legal entity per organisation; multi-company schema ready | Multi-company switching, consolidation, intercompany | Group consolidation at launch |
| Branches | BIN units, branch/warehouse fields, branch-aware numbering | Branch-level P&L, transfers, inter-branch loans | Complex transfer pricing |
| Accounting | COA, manual journals, sales, purchases, receipts, payments, opening balances, period close | Recurring journals, budgets, allocations, cost centres, projects | Event-sourced ledger, blockchain |
| Inventory | Stock items, warehouses, GRN, delivery, weighted average, stock valuation | FIFO, batch/expiry, BOM, WIP, manufacturing | Full MRP at launch |
| Tax | Configurable rule pack, VAT registers, 9.1 preparation, VDS/TDS, challans | Direct NBR integration, automated filing | Claiming a return is filed without user confirmation |
| Payroll | Employee master design only; no production payroll | Labour Act payroll, PF, gratuity, WPPF, bank files | Payroll at launch |
| Fixed assets | Schema design only | Asset register, depreciation, disposals | Fixed assets at launch |
| Reports | TB, GL, P&L, BS, cash flow, AR/AP ageing, VAT registers, stock | Budget variance, segment reporting, board packs | Fake “audited” reports |
| Practice firm | None | Multi-client cockpit, engagement workflow | 60-client demo screens in the production app |
| AI | None required | Assisted data entry with human confirmation | Autonomous posting of financial records from unverified text |

---

## 3. Actual current-state assessment

### 3.1 Maturity scorecard

| Dimension | Score (0–10) | Basis |
|---|---:|---|
| Visual polish | 7 | Distinctive shell, consistent spacing in places, strong typography in headings. |
| Domain modelling | 6 | Rich types, BigInt money, tax decisions, journals, subledger concepts. |
| Accounting workflow correctness | 3 | Many cross-module breaks; document state and subledger state diverge. |
| Production data architecture | 1 | No server, no database, no tenant isolation, browser-only persistence. |
| Authentication and security | 0 | No authentication; client-side role switching; plaintext local data. |
| Regulatory readiness | 2 | Useful structure, but unverified legal claims and a fabricated audit opinion. |
| Localization | 5 | Complete key parity, but many inline strings and inconsistent terminology. |
| Test and release engineering | 2 | Self-check scripts and golden suite only; no CI, lint, UI tests or version control. |
| Operational readiness | 0 | No backup service, monitoring, migration, support tooling or release process. |

**Overall:** approximately **2.5/10 for production readiness**, despite a much higher prototype quality. The gap is architectural and operational, not a lack of screens.

### 3.2 Verified working

- `npx tsc --noEmit` exits successfully with no output. The TypeScript build is currently clean.
- The seeded ledger has 62 journals and 17 commercial documents; every seeded journal has at least two lines and balanced debits/credits. The self-check reports ledger totals of 14,049,502,935 poisha.
- The SHA-256 implementation matches Node’s `crypto` for ASCII, Bangla and long strings.
- The audit chain verifies over the 62 seeded journals and breaks when one poisha is tampered with.
- The six seeded subledger control proofs reconcile to zero difference for AR, AP, Bank/MFS, VAT current account, VDS payable and TDS payable.
- The 25 golden tax vectors pass (`25/25`).
- The English and Bangla dictionaries each contain 1,222 keys; automated parity reports no missing keys.
- The IFRS statements derived from the seed balance to zero, and the cash-flow statement reconciles to closing cash in the seeded case.
- The XLSX audit-pack exporter produces a nine-tab workbook (verified by the existing self-check; no generated artifact remains in the repository).
- The import simulator separates valid and invalid rows for all four pipelines.
- The app renders in a browser without console errors at the time of the smoke check.

### 3.3 What is only a demonstration

These features look more complete than they are. They must not be described as production functionality:

- **Login and roles.** “Sign in” selects a seeded user by username; there is no credential check. Any signed-in user can switch to any role. The app opens authenticated by default.
- **Company switching.** “Apex Group / Cloudnine / Rafiq Enterprise” loads a different seeded dataset and discards the current in-memory state. It is a demo persona switcher, not company management.
- **Sales and purchase lifecycle.** Quotations, sales orders, delivery challans, purchase orders and GRNs are local state arrays, not persisted records. The receipt/payment stages post journals but do not update the source document.
- **Stock.** The seed creates 100 units per stock item at 70% of selling price. GRN and delivery-challan stages do not change stock; stock moves only when an invoice or bill is posted. There is no stock ledger, warehouse, count, transfer, or GL reconciliation.
- **Bank reconciliation.** Statement lines are seeded or auto-created as already matched when a transaction posts. There is no statement import in W06. Matching is amount-only and does not exclude journals already used by another line.
- **Treasury.** New purchases do not create challans. The “issued” Mushak 6.6 certificate is synthesised in the UI, and its `amount_poisha` is set to `challan.amount_poisha * 20n`.
- **Payroll.** Employees and payroll rows are seeded. There is no employee CRUD. The posted state is local component state; the same payroll can be posted repeatedly.
- **Secretarial.** Shareholders, incorporation date and filings are hard-coded or local state. Nothing is persisted.
- **Rule impact / practice cockpit.** The 60-client practice view is a seeded demonstration. There is no multi-tenant backend.
- **Audit trail.** The SHA-256 chain proves that the journal lines in the current browser state are internally consistent. It is not an audit log, cannot prove who did what, and can be recomputed by anyone who edits the local state.

### 3.4 Verified defects that change financial meaning

1. **New transactions may not appear in reports.** `VaultContext` builds statements with `periodCode: '2026-10'` and `comparativeCode: '2026-09'`; W02/W03/W05/W01 also hard-code those periods. The default document date in W02 and W03 is `2026-11-01`. A posted November invoice is outside the October statement window.
2. **Closed periods accept postings.** `periodStatusFor` returns the period status, but `isPeriodLocked` checks only `=== 'LOCKED'`; `postJournal` calls `isPeriodLocked`. A `CLOSED` period is therefore open for posting. The seed marks July–September as `CLOSED`.
3. **Unknown periods accept postings.** If no period matches the posting date, `periodStatusFor` returns `OPEN`. A custom company with 12 periods can post outside its fiscal year.
4. **Credit notes are not 6.7 documents.** A credit note is treated as a sale for serial allocation and gets an `M63-...` serial and an `INV-...` number. There is no original-invoice reference, no 6.7 sequence, no return/stock restoration, and no check that the credit note does not exceed the original invoice.
5. **Line-level tax categories are ignored by posting.** The UI lets each line carry a `tax_category`, but `postCommercialDoc` passes a single header `tax_category` to `buildCommercialDoc`; the tax decision is computed on the total base at that one category. Mixed-rate invoices are wrong.
6. **The purchase tax evidence is fabricated.** `postCommercialDoc` creates `M63-SUP-...` for purchases, and `buildCommercialDoc` treats any non-empty `mushak_serial` as valid evidence. A purchase therefore claims input credit without the user entering or attaching a supplier Mushak 6.3.
7. **The missing-e-TIN toggle does not affect posting.** W03’s `missingTin` state is used in the tax preview but not passed to `postCommercialDoc`; the posting rebuilds the party from the master record with its TIN. The preview and the posted amount can differ.
8. **The sales receipt and supplier payment do not settle the document.** They post a manual journal, but never update `settled_poisha` or the document status. AR/AP subledger proofs continue to show the item as open. The dashboard and ageing reports therefore disagree with the GL.
9. **The purchased document may be posted as “paid” immediately.** `postCommercialDoc` defaults `settle` to `payment_method !== 'CREDIT_CARD'`, so a bank sale or bill posts both the document and the settlement in one operation unless the UI explicitly passes `settle: false`. A credit sale can be recorded as cash received by accident; the sales workflow carries a “post and settle” choice, but the underlying default is unsafe.
10. **Reversal is not a document-level correction.** Reversing a sales invoice journal does not reverse the settlement journal, restore stock, reopen the AR item, or mark the commercial document reversed. Reversing a payment does not reopen the bill.
11. **Reversal can duplicate.** `reverseJournal` checks only whether the selected journal is itself a reversal. It does not check whether it is already reversed. A second call can append the same reversal journal object again, breaking the chain.
12. **Document numbers are derived from array length.** `docNumber` uses `commercialDocs.length + 1`. After a rollback, a deleted document can cause a number to be reused; after concurrent sessions, collisions are possible. `postJournal` does not enforce unique journal numbers or IDs.
13. **Mushak 6.3 allocation is fixed to the year 2026.** The allocator defaults to `year = '2026'`; it has no per-company/per-branch sequence table and no transactional lock.
14. **Mushak 6.3 can have gaps.** Rollback removes commercial documents, so a later invoice can reuse a serial. Credit notes also consume invoice serials without being included in the 6.3 sequence audit.
15. **VAT registers include reversed documents.** W05 filters by document date only, not document/journal status. A reversed invoice remains in the sales register and output tax.
16. **The 6.6 certificate base is arbitrary.** `certificateFor` sets `amount_poisha: challan.amount_poisha * 20n`. This assumes the withholding rate is exactly 5% for every certificate, which contradicts the 15% VDS rate used for standard supplies and is not tied to the original invoice.
17. **Payroll can be posted twice.** The posted state is local. Re-entering W10 resets `postedJournal`; the button becomes available again and posts another payroll journal for the same period.
18. **Opening balances in the master-data editor are not posted.** The chart-of-accounts form stores opening debit/credit and party opening balances, but the financial statements derive opening balances exclusively from journals. Editing an account’s opening balance changes the master display, not the books.
19. **The financial statements are monthly but labelled annual.** `buildFinancialStatements` uses a month window, while the print pack says “for the year ended” and the P&L header uses the same year-ended language.
20. **The cash-flow statement contains a plug.** If the indirect cash flow does not reconcile, the engine inserts “Net movement in other working capital and provisions” and still prints the statement, while setting `reconciles: false`. A close process must block, not disguise, a reconciliation failure.
21. **The “audited” pack is fabricated.** The print component renders an independent auditor’s report and signs it “Rafiq & Associates, Chartered Accountants, Dhaka” with the current date. The small print says it is a demonstration, but the document itself is still an audit opinion. This must be removed entirely.
22. **The review screen uses hard-coded signatories.** W09 uses “Farzana Akter” and “Rafiq Chowdhury FCA” as maker/checker regardless of the signed-in user, stores sign-offs in component state, and lets the same operator toggle between maker and checker roles.
23. **The role permission matrix is not enforced server-side.** All checks run in the browser. The `APPROVE_HIGH_VALUE` permission is defined but never checked anywhere; no high-value approval workflow exists.
24. **The default persistence path swallows failures.** `persistState` calls `saveVaultSnapshot(...).catch(() => undefined)`; there is no save indicator, failure banner, retry, or last-saved time. A quota error or private-mode restriction can lose work silently.
25. **No audit log exists for non-journal events.** There is no record of sign-in, role change, export, import, master-data edit, approval, period lock/unlock, or failed posting.

### 3.5 Missing functionality

- General journal entry screen and recurring/adjusting journals.
- Fixed assets, depreciation, disposals and asset register.
- Budgeting and variance analysis.
- Customer/supplier statements and ageing detail with allocation.
- Partial payments, advances, credit limits, write-offs, discounts and debit notes.
- Warehouse-level stock, stock counts, transfers, stock ledger, negative-stock control, and inventory-to-GL reconciliation.
- Bank account CRUD, bank transfers, cheque management and real statement import.
- Attachments/evidence for invoices, bills, certificates and approvals.
- Organisation/company switching with real isolation.
- User invitations, user CRUD, password reset, session management and MFA.
- Approval workflows and segregation of duties at the transaction level.
- Document numbering/sequence configuration.
- Audit log viewer and export.
- Server-side backup and recovery.
- API, integrations, email/SMS notifications, and bank/MFS feeds.
- Automated tests for React components, API, auth, and browser workflows.

### 3.6 Suspected problems requiring confirmation

These are plausible defects but were not fully exercised during the audit:

- Some workspace forms may accept invalid dates or quantities because validation is UI-local and `postJournal` does not validate date format.
- The `W07` duplicate-within-batch warning is marked postable, so the same document can be imported twice in one batch.
- The MFS fee calculation assumes 1.5% for every MFS settlement; the fee may be provider- and contract-specific.
- The “write-off to retained earnings” suspense action may be used without an approval or tax review.
- Some Bangla strings are natural; others may be literal translations. Native accounting review is required.
- The `xlsx` dependency is an older SheetJS community build; a dependency and file-parsing security review is required.
- The `W08` report may include synthetic equity/working-capital lines that do not map cleanly to a single account. The drill-down should be tested with every line.
- The `W01` 13-week forecast and scenario sliders are illustrative; they are not connected to actual cash commitments and should not be presented as a forecast in production.

### 3.7 External requirements requiring official verification

The code contains specific claims about Bangladesh law and practice. None should be treated as confirmed by this audit. The rule pack itself sets `reviewer_status: 'PENDING_TAX_COUNSEL'` and marks rules `[VERIFY]`. See section 14 for the full list and the verification process.

---

## 4. Repository and architecture overview

### 4.1 Repository structure

```text
C:\Fintuity\Accounting Software Project - Copy\
├── index.html                     # single HTML entry, Google Fonts, theme bootstrap
├── package.json                   # React 18 + Vite + TypeScript + Tailwind + xlsx
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
├── SPEC.md                        # original product/technical specification
├── WORKFLOW_BLUEPRINT.md          # workflow, RBAC and accounting rules
├── build.log
├── scripts/
│   ├── selfcheck.ts
│   ├── selfcheck-actions.ts
│   ├── selfcheck-import.ts
│   ├── gate.ts
│   └── smoke-render.ts
├── dist/                          # built artifact (not source)
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── core/
    │   ├── money.ts
    │   ├── i18n.ts
    │   ├── types.ts
    │   ├── locales/ (en/bn core, tax, ops, reports)
    │   ├── storage/vaultDb.ts
    │   ├── tax-engine/ (rulePack, engine, goldenSuite)
    │   ├── ledger/ (ledgerEngine, seedData)
    │   ├── ifrs-engine/ifrsEngine.ts
    │   └── import-export/xlsxEngine.ts
    ├── context/VaultContext.tsx
    ├── components/
    │   ├── auth/AuthAndOnboardingModal.tsx
    │   ├── layout/ (AppShell via App.tsx, Sidebar, TopBar, CommandPalette, WorkspaceNav)
    │   ├── commercial/CommercialShared.tsx
    │   ├── modals/MasterDataModal.tsx
    │   ├── signature/ (TaxAdvisorCard, TransactionComposer, LedgerLensModal, StatutoryPrintModal)
    │   └── svg/ (MoneyFlowSankey, VaultVisuals)
    └── workspaces/
        ├── registry.tsx
        ├── W01_ExecutiveCockpit.tsx
        ├── W02_SalesMushak63.tsx
        ├── W03_PurchasesWithholding.tsx
        ├── W04_TreasuryChallans66.tsx
        ├── W05_VatRegisters91.tsx
        ├── W06_BankingMfsReconcile.tsx
        ├── W07_MassImportExportStudio.tsx
        ├── W08_IfrsStatementsStudio.tsx
        ├── W09_CloseAndControl.tsx
        ├── W10_PayrollLabourSuite.tsx
        ├── W11_SecretarialGovernance.tsx
        ├── W12_RulePackAndCoreLab.tsx
        └── W12_FirmCockpit.tsx
```

**Size:** 51 source files, approximately 2.23 MB of source (1.55 MB of TSX). This is a substantial prototype, not a small demo.

### 4.2 Runtime boot path

1. `index.html` loads `src/main.tsx`.
2. `main.tsx` imports `core/money` first (BigInt JSON patch), then CSS, then `App`.
3. `App` mounts `VaultProvider` and immediately renders `ErpShell`.
4. `ErpShell` defaults to workspace `W01` and renders the full sidebar, top bar and dashboard.
5. There is no public route, no login gate, no URL router, no server call and no protected-route redirect.
6. `VaultProvider` loads the latest browser snapshot; if none exists, it builds the seed dataset. It then persists the complete state on changes.

### 4.3 State and data flow

```text
UI component
   │  user action
   ▼
VaultContext action (login, postCommercialDoc, postManualJournal, import, etc.)
   │  pure domain functions
   ▼
ledgerEngine / tax engine / ifrs engine / xlsx engine
   │  new in-memory VaultState
   ▼
React state + localStorage snapshot + IndexedDB snapshot
   │
   └─ derived views: financial statements, tax decisions, reports, dashboards
```

The design is a **single-page, single-state application**. `VaultState` holds the tenant, users, accounts, journals, documents, challans, bank accounts, statement lines, import batches, certificates, payroll rows, parties, items, periods and statutory records. A change to any one part persists the entire object.

There is no server-side transaction boundary. A “posting” is a sequence of JavaScript mutations followed by a full-state snapshot. If the process is interrupted mid-sequence, the state can be partially updated (for example, a document added before its settlement journal), and the snapshot may or may not capture the result.

### 4.4 Current data model

Important types in `src/core/types.ts`:

- `TenantEntity`: one demo persona/company, with `persona_key`, BIN units, accounting policies. There is no `company_id` on the other records.
- `Account`: flat chart of accounts with code, names, type, subcategory, IFRS category, control subledger, opening debit/credit.
- `JournalEntry` / `JournalLine`: the ledger.
- `CommercialDoc`: sales/purchase document with denormalised party names and a single header `tax_category`.
- `Party`, `InventoryItem`, `Challan`, `VdsCertificate`, `BankAccount`, `BankStatementLine`, `PayrollRun`/employee rows, `ImportBatch`, `AccountingPeriod`.
- `UserAccount`: username, name, role; no password hash, email verification, session, organisation membership, or company scope.

The model has useful accounting concepts, but it is **not normalised for a multi-company, multi-user system**. There are no foreign keys in a database because there is no database. Records refer to each other by string IDs that are generated in the browser.

### 4.5 Persistence

`src/core/storage/vaultDb.ts`:

- Serialises the complete state to JSON, using a BigInt replacer.
- Writes a synchronous copy to `localStorage` and an asynchronous copy to IndexedDB.
- Revives every `*_poisha` key as `bigint`.
- Supports a portable `.vault.json` export and import.
- On load, chooses the newer snapshot by `saved_at`.

This is thoughtful for a local prototype, but it is not an accounting-grade persistence layer:

- Browser storage is per-browser, per-profile; there is no shared team data.
- Any user with the browser profile can read or edit the data.
- Clearing site data or using private mode destroys the books.
- Two tabs can overwrite each other with no conflict detection.
- The full state is written on every change; there is no incremental journal, no optimistic concurrency, and no server-side backup.
- Errors are swallowed; the user is not told that a save failed.

### 4.6 Build and tooling

- `npm run build` = `tsc --noEmit && vite build`.
- `build.log` shows a successful build with 1,974 modules and a 1.56 MB JS bundle (approximately 483 KB gzip in the logged build). The current `dist` may differ.
- `vite.config.ts` has no proxy, no server integration, no route splitting configuration.
- `package.json` has no `test`, `lint`, `format`, `typecheck` script and no CI.
- `tsconfig` is `strict` but disables unused checks; it includes only `src`, so the `scripts/*.ts` self-checks are not type-checked by the build.
- There is no `.git` directory in the audited folder and no repository history. This is a serious delivery risk for a long-running project.
- There is no README, no architecture decision record, no deployment guide, no environment example and no operations documentation beyond `SPEC.md` and `WORKFLOW_BLUEPRINT.md`.

### 4.7 Architectural strengths

- The pure domain layer is separated from React components, which makes it testable and reusable on a server later.
- Money is integer poisha, not floating point.
- Journal posting validates balance and chart-of-accounts membership.
- The audit chain is deterministic and verifies against an independent SHA-256 implementation.
- The tax engine is deterministic and returns explanations, conditions and rule IDs.
- Reports are derived from journals rather than hard-coded arrays.
- The bilingual dictionary is complete at the key level.
- The import/export layer has a dry-run concept and a portable audit pack.

### 4.8 Architectural constraints that require change

1. **Browser-only source of truth** is incompatible with a multi-user accounting product.
2. **No tenant/company scope on records** prevents real multi-company data isolation.
3. **No server authorization** means roles are advisory only.
4. **No transaction boundary** means a failure can produce partial financial state.
5. **No database constraints or foreign keys** means referential integrity is a matter of UI discipline.
6. **No immutable audit log** means journal changes and operational actions cannot be proven.
7. **No migration/versioning strategy** for stored state beyond a version field.
8. **No route model** means no deep links, no bookmarks, no back/forward, and no protected pages.
9. **Hard-coded periods/dates** make the application a frozen demo rather than a live system.
10. **A single monolithic context** (over 2,000 lines) mixes preferences, authentication, ledger mutations, import, storage and UI orchestration.

---

## 5. Existing feature inventory

| Workspace | Files | What the user sees | What actually works | What is simulated, incomplete or unsafe | Status |
|---|---|---|---|---|---|
| W01 Executive cockpit | `W01_ExecutiveCockpit.tsx`, `MoneyFlowSankey`, `TransactionComposer` | KPIs, filing clock, action inbox, natural-language composer, Sankey, 13-week forecast | KPIs derive from statements; composer posts through the ledger; filters open workspaces | Period/date hard-coded; pending approvals do not include local drafts; scenario sliders are illustrative; forecast is an allocation, not a cash-commitment model; no period selector | Partial / demo |
| W02 Sales & Mushak 6.3 | `W02_SalesMushak63.tsx`, `CommercialShared` | Pipeline tabs, invoice table, create/review drawer, tax advisor, print, ledger lens | Tax preview, invoice posting, COGS journal, ledger view, print layout | Quote/order/challan local state; receipt does not settle AR; credit note uses 6.3 serial; line tax categories ignored; stock can go negative; no partial receipt; no due-date/credit control | Partial / unsafe |
| W03 Purchases & VDS/TDS | `W03_PurchasesWithholding.tsx` | Bill/PO/GRN pipeline, tax advisor, 3-way match, payment, print | Tax preview, bill posting, inventory receipt on bill, payment preview | PO/GRN local state; GRN does not move stock; missing-TIN toggle not posted; purchase evidence auto-fabricated; payment does not settle AP; no challan creation; 3-way match is aggregate and overridable without audit | Partial / unsafe |
| W04 Treasury challans & 6.6 | `W04_TreasuryChallans66.tsx` | Challan queue, batch deposit, certificates, chasing | Batch deposit posts a balanced journal and updates challan status; received certificate updates VAT 9.1 input data | New transactions do not create challans; “issued” certificate is synthesised; base is `amount × 20`; no persisted certificate record; chase is a toast | Demo / unsafe |
| W05 VAT registers & 9.1 | `W05_VatRegisters91.tsx` | Purchase/sales registers, Note 18, 9.1 return, GL proof, print/export | Derives register rows and a return from documents; prints; exports | Period hard-coded; reversed docs included; some lines are placeholders (deposited VAT, imported-service rebate, credit notes); filing due date/claims unverified; no period selector | Partial / demo |
| W06 Banking & MFS | `W06_BankingMfsReconcile.tsx` | Bank/MFS cards, statement table, matching | Shows seeded accounts and statement lines; posts fee journals; can mark lines | No statement import; auto-matched lines from postings; amount-only matching; no dedupe; fee history local; no “create and reconcile GL entry”; no bank transfer | Demo / unsafe |
| W07 Mass import/export | `W07_MassImportExportStudio.tsx`, `xlsxEngine` | Four pipelines, dry run, batch commit, rollback, audit pack | XLSX/CSV parsing, validation, balanced journal generation, batch rollback, 9-tab export | No master-data import; no stock update from commercial rows; no challans; duplicate-in-batch is postable; no server backup; row corrections are limited | Partial |
| W08 IFRS statements | `W08_IfrsStatementsStudio.tsx` | SOFP, P&L, SOCIE, cash flow, trial balance, notes, drill-down, print | Dynamic statement derivation; book filters; line drill-down; exports | Fixed October period; monthly P&L labelled annual; no period selector; cash-flow plug; “audited” label and fabricated audit opinion | Partial / unsafe |
| W09 Close & control | `W09_CloseAndControl.tsx` | Control matrix, suspense queue, 11-step close, audit chain verifier | Control proofs, suspense display and allocation, period status update | Sign-offs local and hard-coded; maker/checker is a toggle; lock bypass not server-enforced; no depreciation/payroll for new companies; audit verifier is local-only | Partial / unsafe |
| W10 Payroll | `W10_PayrollLabourSuite.tsx` | Register, overtime, festival bonus, PF/gratuity/WPPF, journal preview, BEFTN/bKash export | Calculates a balanced journal preview; posts via manual journal; exports a workbook | No employee CRUD; seeded rows only; duplicate posting; hard-coded rates and legal reference; no approval; WPPF uses current P&L; no PF fund reconciliation | Demo / unsafe |
| W11 Secretarial | `W11_SecretarialGovernance.tsx` | Shareholding, RJSC filings, licences, NBR notices, pack | Displays seeded/static data; some local workflows | Hard-coded incorporation date and shareholders; renewals/notices local only; no filing; no authority integration | Demo |
| W12 Rule pack & core lab | `W12_RulePackAndCoreLab.tsx`, `W12_FirmCockpit.tsx` | Rule explorer, golden suite, dictionary parity, BigInt lab, 60-client cockpit | Golden suite, dictionary parity, tax lab, rule browsing | Practice cockpit is seeded; no multi-client backend; should be internal/admin or demo-only | Demo / internal |
| Auth & onboarding | `AuthAndOnboardingModal.tsx` | User list, role switcher, permission matrix, 4-step company wizard, backup export/import | Creates a custom tenant with a simple opening journal; exports/imports vault | No password/session; seeded users only; no invitations/user CRUD; onboarding opening balances only cash/bank/capital; no COA import, branches, taxes, bank setup, or confirmation | Demo / unsafe |
| Master data | `MasterDataModal.tsx` | Account, party and item tabs with forms | Add/edit accounts, parties, items; search | Flat COA; opening balances not posted; no account hierarchy; no deletion controls; no audit; no user/company/branch context | Partial |
| Transaction composer | `TransactionComposer.tsx` | Natural-language input, parsed preview, tax card, post button | Deterministic parser for a limited lexicon; preview; posts with `settle: true` | Parser is not validated against real user phrasing; always settles; one line only; no dependency on approval; can post to a generic SKU; no confidence gating | Demo |
| Print/export | `StatutoryPrintModal.tsx`, `xlsxEngine` | Mushak 6.3/6.6/9.1, statements, audit pack | Print layouts; XLSX export | Fabricated audit opinion; `DRAFT` discipline inconsistent; figures fixed to period; no evidence attachments | Partial / unsafe |

**Conclusion:** the inventory is broad, but no workspace is production-complete end-to-end. The most complete assets are the pure engines, not the screens.

---

## 6. Functional completeness assessment

### 6.1 Financial accounting and general ledger

**Current:** a balanced journal engine, chart of accounts, seeded journals, reversal and audit hash.  
**Missing:** a user-facing general journal, opening-balance posting, recurring journals, adjusting entries, attachments, approval, period selection, journal templates, account hierarchy, cost centres/projects, and reliable reversal of document groups.  
**Assessment:** the engine is a real foundation; the product around it is incomplete.

### 6.2 Chart of accounts

**Current:** flat list with code, name, type, subcategory, IFRS category, control subledger and opening fields; add/edit through `MasterDataModal`.  
**Missing:** hierarchy, parent/group, account currency, tax mapping, blocked accounts, account deletion rules, opening-balance batch posting, import from a template, and audit of changes.  
**Defect:** opening balances entered in the master record are not reflected in the financial statements.

### 6.3 Journal entries and vouchers

**Current:** `postJournal`, `validateJournal`, `createReversalJournal`, journal numbering.  
**Missing:** a general journal screen, multi-line entry with validation, attachment/evidence, narration templates, approval, recurring entries, reversal groups, and posting preview.  
**Assessment:** the most important missing screen in the product. Without a general journal, accountants cannot record depreciation, accruals, opening balances, corrections, payroll adjustments or year-end entries.

### 6.4 Accounts receivable and payable

**Current:** invoice and bill records, a simple full-settlement journal path, and a control proof based on `settled_poisha`.  
**Missing:** receipt/payment allocation, partial payments, advances, credit notes linked to invoices, write-offs, discounts, customer/supplier statements, ageing detail, dunning, credit limits, and opening AR/AP.  
**Defect:** the receipt/payment paths do not update `settled_poisha`, so the subledger and GL diverge.

### 6.5 Sales, purchases and invoicing

**Current:** document creation, tax preview, invoice/bill posting, COGS on sales, weighted-average receipt on purchases, print.  
**Missing:** persisted pre-invoice lifecycle, line-level tax computation, discounts, freight, partial delivery, returns, debit notes, approval, credit control, and reliable document numbering.  
**Defects:** credit-note serials; per-line tax ignored; stock not moved at challan/GRN; purchase tax evidence fabricated; default auto-settlement.

### 6.6 Cash and bank management

**Current:** seeded bank/MFS/cash accounts, balances, a fee journal, a basic reconciliation view.  
**Missing:** account CRUD, bank transfers, cheque register, deposit slips, cash count, statement import, matching rules, deduplication, unreconciled queue, and a create-GL-from-statement path.  
**Assessment:** the screen demonstrates the idea; it is not a reconciliation tool.

### 6.7 Inventory and stock

**Current:** item master, 100-unit seed quantities, weighted-average cost, issue/receipt functions, COGS pair.  
**Missing:** stock ledger, warehouse/location, GRN/delivery movement, transfers, counts, adjustments, negative-stock policy, valuation report, reorder levels, batch/expiry, and inventory-to-GL reconciliation.  
**Defects:** stock moves only on invoice/bill; negative stock allowed; no control proof for 1310.

### 6.8 Fixed assets and depreciation

**Missing.** Chart accounts exist (`1610`, `1619`, `5400`) and the close checklist expects a depreciation journal, but there is no asset register, acquisition, depreciation run, disposal or impairment. A new company cannot complete the close step.

### 6.9 Payroll and employees

**Current:** seeded payroll rows, overtime calculation, PF/gratuity/WPPF preview, journal posting, bank-file export.  
**Missing:** employee CRUD, salary structure, attendance/leave, payroll run persistence, approval, payslips, PF fund, gratuity valuation, tax computation, and duplicate prevention.  
**Assessment:** a demo, not payroll.

### 6.10 VAT, taxation and statutory reporting

**Current:** deterministic tax decisions, BIN/TIN checks, VAT categories, VDS/TDS, Mushak registers, a 9.1 return view, a rule explorer and golden suite.  
**Missing:** verified legal content, effective-date enforcement, rule-pack configuration, reviewer sign-off, a period selector, correct treatment of reversed documents, credit-note/debit-note registers, imported-service rebate, actual filing, and evidence attachments.  
**Assessment:** a useful architecture with unverified content and incomplete integration.

### 6.11 Budgeting and financial planning

**Missing.** The 13-week cash “forecast” in W01 is a scenario slider, not a budgeting module.

### 6.12 Financial statements and management reporting

**Current:** dynamic trial balance, IAS 1 balance sheet, IFRS 18-style P&L, IAS 7 indirect cash flow, changes in equity, notes, drill-down, print/export.  
**Missing:** correct period selection, YTD/annual semantics, comparative-year choice, segment/branch reporting, budget variance, consolidation, audit-ready evidence, and a clear “unaudited management accounts” label.  
**Defects:** fixed October, monthly labelled annual, cash-flow plug, fabricated audit opinion.

### 6.13 Branches, warehouses and multiple companies

**Current:** BIN units on the tenant; a persona switcher; branch/warehouse names in some documents.  
**Missing:** company IDs on records, branch-level ledgers, warehouse stock, inter-branch transfers, branch permissions, consolidated reporting, and real company switching.  
**Defect:** switching persona discards the current dataset.

### 6.14 Manufacturing and industry-specific workflows

**Missing.** No BOM, WIP, production order, job costing, wastage, by-product, or industry pack. This is appropriate to defer.

### 6.15 Audit trails, approvals and internal controls

**Current:** journal SHA-256 chain, a control matrix, a close checklist, role labels.  
**Missing:** operational audit log, approval engine, high-value approval, segregation of duties enforcement, period-close evidence, override reasons, attachment evidence, and server-side immutability.  
**Assessment:** the chain is a useful integrity check, not an audit trail.

### 6.16 Data imports, exports and backups

**Current:** four import pipelines, dry run, batch commit/rollback, audit pack; manual `.vault.json` backup.  
**Missing:** master-data import, opening-balance schedule import, bank statement import linked to reconciliation, scheduled backups, encrypted backups, restore verification, and migration tooling.

### 6.17 Integrations

**Missing.** No API, no bank feed, no MFS feed, no email/SMS, no payment gateway, no e-invoicing, no NBR integration. The only external calls are Google Fonts and a browser download. This is appropriate for the first release except for email (invitations/password reset) and bank statement upload.

### 6.18 Localization

**Current:** 1,222-key parity, number/date helpers, Bangla dictionary, Banglish search.  
**Missing:** complete UI coverage through the dictionary, terminology governance, pluralization, server error localization, report label review, native accounting review, and self-hosted fonts.  
**Assessment:** a strong start, but the parity metric does not prove that every visible string is translated naturally.

### 6.19 Testing and quality assurance

**Current:** manual self-check scripts; 25 golden vectors; TypeScript compile.  
**Missing:** a test runner in `package.json`, CI, lint/format, unit tests for every domain function, API integration tests, React component tests, browser E2E, accessibility tests, security tests, migration tests, backup restore, and performance tests.  
**Assessment:** not release-grade.

### 6.20 Overall completeness summary

| Capability | Status | Production ready? |
|---|---|---|
| Money arithmetic | Strong | Mostly, with test expansion |
| Journal validation | Strong | Engine only |
| Tax decision structure | Strong | Content unverified |
| Financial statement derivation | Good foundation | No |
| Sales workflow | Demo | No |
| Purchase workflow | Demo | No |
| AR/AP | Demo | No |
| Inventory | Unsafe partial | No |
| Banking/reconciliation | Demo | No |
| VAT reporting | Demo | No |
| Close/controls | Demo | No |
| Payroll | Demo | No |
| Fixed assets | Missing | No |
| Multi-company/branches | Missing | No |
| Authentication/security | Missing | No |
| Audit trail | Partial, local | No |
| Imports/backups | Partial | No |
| Localization | Good key parity | Needs review |
| Testing/CI | Minimal | No |

---

## 7. Workflow practicality audit

This section answers the question: **what happens when a real person tries to do a real day’s work?** The assessment is based on the actual code paths, not the labels in the sidebar.

### 7.1 Sign in, identity and access

**Who:** every user.  
**Start:** open the application.  
**Actual current steps:**

1. The app loads the last browser snapshot or the seed dataset.
2. `isAuthenticated` defaults to `true` and `currentUser` defaults to the first seeded user, an ADMIN.
3. The user is already inside the financial application with full write access.
4. To change identity, the user opens “Access & roles”, selects a seeded name, and clicks “Sign in”. No password or second factor is requested.
5. The user can also switch role directly from the top bar; the system logs in as the first active user with that role.

**Accounting effect:** none directly, but every subsequent action is attributed to a seed identity that the operator chose. There is no proof of who performed it.  
**Correction:** none needed; there is no failed-login or locked-account state.  
**Reports/outputs:** no login history, session list, or access audit.  
**Permissions:** client-side only; all data remains readable after “sign out”.  
**Failure behaviour:** a missing user name produces an error toast; no credential failure exists.  
**Verdict:** **not authentication.** This is a persona switcher. It is the single largest security and trust defect in the product.

### 7.2 First company setup and onboarding

**Who:** a new administrator or implementation consultant.  
**Start:** top-bar organisation menu → “New company” (requires `MANAGE_USERS_AND_ORG`).  
**Actual current steps:**

1. Four-step modal: legal identity, BIN/e-TIN tax setup, fiscal year/framework, opening cash/bank/capital.
2. Validation: company name required; 13-digit BIN required for VAT-registered; e-TIN, if entered, must be 12 digits; fiscal-year label must contain a year; opening capital must equal cash + bank; no negative balances.
3. On submit, `createCustomTenant` replaces the entire state with a new tenant, a cloned template chart of accounts, 12 monthly periods, one bank account, one cash account, and a single opening journal for cash/bank/capital.
4. The previous company’s accounts, journals, documents, parties, items, challans and records are discarded without an export or confirmation.

**What is missing at setup:** company logo/address details beyond basic fields; branches/BIN units beyond one head office; chart-of-accounts import; opening AR/AP/inventory/fixed assets; tax registration details; bank account list; document numbering; approval thresholds; users; invitations; email verification; data-retention choices; opening balance approval.  
**Failure behaviour:** validation errors are shown in the modal. There is no draft save, no resume, no rollback, and no backup before replacement.  
**Verdict:** a usable demo wizard, not a safe onboarding process.

### 7.3 Chart of accounts and opening balances

**Who:** accountant or controller.  
**Start:** top bar → Master data → Accounts.  
**Actual current steps:**

1. Browse a flat account list; search by code or name.
2. Add or edit an account: code, English/Bangla names, type, subcategory, IFRS category, control subledger, opening debit, opening credit, active flag.
3. Save; the account appears immediately in the list and in the dropdowns.

**Accounting effect:** the account master changes, but the opening debit/credit values are **not posted to the ledger**. Financial statements derive opening balances from journals. The values therefore appear in the master list and the trial-balance “opening” column only if a journal exists; an edited master opening value does not create one.  
**Correction:** editing the account changes the master; it does not correct the ledger.  
**Reports:** the account appears in reports only after a journal line uses it.  
**Permissions:** `MANAGE_MASTERS_AND_COA`.  
**Failure behaviour:** duplicate codes are rejected on add; a code field can be non-numeric or shorter than four digits; no audit log.  
**Verdict:** **partial and misleading.** Opening balances need a dedicated balanced batch with review and posting.

### 7.4 Sales invoice: quotation → order → challan → invoice → receipt

**Who:** operator creates drafts; accountant posts; accountant records the receipt.  
**Start:** W02 → “New sales invoice” (or a scenario preset).  
**Actual current steps:**

1. Choose buyer, BIN unit, document date, payment rail, vehicle, destination and narration.
2. Add lines. Each line has item, description, quantity, unit price, tax category, unit and stock badge.
3. The tax advisor computes a preview from the **header** tax category and total base.
4. Save a quotation/order/challan as a local draft, or post the invoice directly.
5. On direct post, `postCommercialDoc` creates a document number, allocates a Mushak 6.3 serial, posts the receivable/revenue/VAT journal, posts COGS/inventory if stock items exist, optionally posts a settlement journal, and creates a statement line marked MATCHED.
6. The pipeline shows the document as INVOICED_POSTED or SETTLED.
7. To record a receipt later, the user opens the document and clicks “Record Customer Receipt”; a manual journal is posted.

**What happens to the information:** the document and journal are added to the in-memory state and persisted as a browser snapshot. Pre-invoice drafts are not persisted at all.  
**Accounting effect:**

- Invoice: Dr AR gross; Cr revenue base; Cr output VAT; Dr COGS / Cr inventory where stock items exist.
- If `settle` is true (the default in `postCommercialDoc` unless the caller passes false): Dr bank net + Dr VDS receivable + Dr AIT; Cr AR gross. The document is marked SETTLED and `settled_poisha = gross`.
- If `settle` is false: document remains POSTED, but the later receipt path posts a manual journal without updating the document.

**Correction:** the user can open the Ledger Lens and reverse one journal. The system marks that journal REVERSED but does not reverse the linked settlement, restore stock, reopen the AR item, or mark the commercial document REVERSED.  
**Reports:** W05 and W08 use fixed October dates. A November invoice may not appear. The VAT register can include a reversed invoice because it filters only by document date.  
**Permissions:** `CREATE_COMMERCIAL_DRAFT` for drafts; `POST_TO_GL` for posting and receipt; `REVERSE_POSTED_JOURNAL` for reversal. The UI does not gate every button, so an auditor can click and receive a rejection toast.  
**Failure behaviour:** if the tax decision is `NOT_SUPPORTED` or `SOURCE_DISPUTED_OR_EXPIRED`, the UI blocks. `MANUAL_REVIEW` is not blocked by `postCommercialDoc` itself. If the period is locked, posting throws. A stock shortage is a warning; posting continues.  
**Verdict:** the core invoice posting is a good prototype, but the end-to-end order-to-cash workflow is not reliable.

**Specific workflow defects:**

- Quotation, sales order and delivery challan are local arrays in W02; leaving the screen loses them.
- Delivery challan does not decrement stock; invoice posting does.
- Line-level tax categories are displayed but not used in the tax decision.
- Credit notes are treated as invoices for numbering and serial allocation.
- Receipt does not allocate to the invoice or update the subledger.
- Default auto-settlement can record a cash receipt for a credit sale.
- No partial payment, advance, discount, write-off, or customer statement.
- Document numbers can be reused after rollback.
- Mushak 6.3 serials are fixed to year 2026 and can gap after rollback.

### 7.5 Credit note and sales return

**Who:** accountant.  
**Start:** W02, toggle “Credit note”, choose buyer and lines, post.  
**Actual current steps:** same form as an invoice; the document type becomes `CREDIT_NOTE`; the tax engine applies negative signs to the document lines; the UI labels it “Mushak 6.7”.

**What actually happens:**

- The document is assigned an `INV-...` document number and receives an `M63-2026-...` serial because the posting code treats sales invoices and credit notes as the same `isSale` category for serial allocation.
- There is no `original_invoice_id`, no return reason, no link to the original invoice, no check that the credit quantity/value is within the original sale, and no stock restoration.
- The AR control proof subtracts all credit notes from the receivable total, not from specific invoices.
- The credit note has no independent 6.7 number series and no 6.7 register.
- If the credit note is reversed, the original credit note document remains POSTED.

**Verdict:** **incorrect statutory and accounting behaviour.** A credit note must be a distinct controlled document, linked to the original invoice, with its own number series, stock/cost reversal where applicable, and approval.

### 7.6 Purchase order → GRN → supplier bill → payment

**Who:** warehouse operator receives; accountant posts the bill and pays.  
**Start:** W03 → new purchase document.  
**Actual current steps:**

1. Choose document type, supplier, date, payment rail, narration, tax category, TDS nature and lines.
2. Toggle VDS, SD, reverse charge, missing e-TIN, cash risk.
3. Save a purchase order draft (local state) or post a bill directly.
4. From a draft PO, “Receive Goods (GRN)” changes the local document stage and records a received quantity; it does not change inventory.
5. “Post bill” posts the purchase journal and, if the stage is GRN or the document is a bill, updates inventory and weighted-average cost.
6. “Pay supplier” posts a manual journal for the full gross payable, VDS and TDS.

**Accounting effect:** the bill posts inventory/expense and input VAT against AP. The payment posts Dr AP / Cr bank / Cr VDS payable / Cr TDS payable.  
**What breaks:**

- PO and GRN are local state; refresh loses them.
- GRN does not increment stock; stock changes when the bill posts, which can be before or after physical receipt.
- The 3-way match uses aggregate quantities and defaults the GRN quantity to the bill quantity. It can be overridden by a role, but the override reason and approver are not recorded.
- The missing-e-TIN toggle affects the preview but not the posted document.
- A purchase bill auto-creates a fake supplier Mushak 6.3 serial and therefore claims input VAT evidence that the user never supplied.
- `PURCHASE_BILL` always routes the cost to inventory `1310`; there is no line-level expense or asset account.
- Payment does not update `settled_poisha` or the AP subledger.
- Payment does not create a treasury challan or a 6.6 certificate.
- There is no purchase return/debit note.

**Correction:** reverse one journal; no document-level reversal; no stock restoration.  
**Reports:** W05 uses the purchase documents; a reversed bill remains included. W03’s open payable count is based on workflow stage, so a paid bill may still appear open in other views.  
**Verdict:** **not a reliable procure-to-pay workflow.**

### 7.7 Expense voucher

**Who:** accountant or operator.  
**Start:** W03, choose “Expense voucher”, choose a supplier/party, lines, TDS nature, payment rail.  
**Actual current steps:** similar to a bill. The expense account is inferred from `TdsNature` through `expenseAccountFor`; the user does not choose the expense account.  
**Accounting effect:** document and settlement journals, auto-settled by default.  
**Problems:** no expense account picker, no cost centre/project, no approval, no receipt attachment, no per-line tax, no reimbursement workflow, no duplicate-receipt protection.  
**Verdict:** a quick-entry demo, not an expense control system.

### 7.8 Customer receipt and AR

**Who:** accountant or cashier.  
**Start:** W02 → open a posted invoice → “Record Customer Receipt”.  
**Actual current steps:**

1. The form takes no amount; it assumes full settlement of `net_payable_poisha`.
2. It posts Dr bank net, Dr VDS receivable, Dr AIT, Cr AR gross.
3. It does not update the invoice’s `settled_poisha`, status or receipt reference.
4. Stage detection looks for a journal whose narration starts with “Customer receipt of ” and contains the invoice number. This is a fragile string match, not a database relationship.

**Problems:** no partial receipts, no multiple-invoice allocation, no advance receipts, no unapplied cash, no customer statement, no receipt number, no cash/bank account choice beyond the rail mapping, no receipt printing, no deposit slip, no reconciliation to the bank statement, no AR ageing detail.  
**Failure:** if the journal is reversed, the invoice remains “unsettled” in the subledger, but the UI may no longer show the receipt.  
**Verdict:** not an AR subledger.

### 7.9 Supplier payment and AP

**Who:** accountant or controller.  
**Start:** W03 → open a posted bill → “Pay Supplier”.  
**Actual current steps:** full gross payment; post a manual journal; no AP allocation update; no challan creation.  
**Problems:** no partial payments, no payment batch, no bank file, no approval, no withholding certificate generation, no discount, no advance, no supplier statement, no payment advice, no duplicate protection beyond a narration prefix.  
**Verdict:** not an AP subledger.

### 7.10 Treasury challans and Mushak 6.6

**Who:** accountant.  
**Start:** W04 → select pending challans → batch deposit.  
**What works:** selecting seeded pending challans and depositing them posts one balanced journal and marks them DEPOSITED.  
**What does not work:**

- New purchase payments do not create challans, so the queue is largely disconnected from daily work.
- The issued 6.6 certificate is synthesised in `certificateFor`; it is not stored as a certificate record.
- The certificate base is `challan.amount_poisha * 20n`, an arbitrary 5% assumption. It is not derived from the original invoice base or the actual withholding rate.
- No TDS certificate, no AIT certificate, no correction/cancellation workflow.
- Chasing a customer certificate is a toast, not an email or task with a due date.
- The batch reference is based on the count of already-deposited challans, not a robust sequence.
- There is no filing evidence, bank receipt attachment, or authority acknowledgement.

**Verdict:** a visual mock of a treasury queue, not a statutory certificate system.

### 7.11 Bank and MFS reconciliation

**Who:** accountant or finance manager.  
**Start:** W06.  
**Actual current steps:**

1. View seeded bank/MFS accounts and statement lines.
2. Select a line, see exact/nearest journal candidates and document candidates.
3. Click reconcile; the line is marked MATCHED or CATEGORIZED based on the first journal with the same amount.
4. For MFS lines, a 1.5% fee journal may be posted; `postedFees` is local state.

**Problems:**

- There is no statement upload in W06. The W07 bank pipeline posts journals to suspense but does not create statement lines.
- When a transaction is posted with settlement, `statementLineFromJournal` creates a statement line already marked MATCHED. The reconciliation screen is therefore not proving anything for new activity.
- Matching ignores date, reference and whether the journal has already been used by another line. One journal can be matched to several statement lines.
- No deduplication; no split matching; no partial matching; no multi-line matching.
- No “create GL entry” for an unexplained bank charge or receipt, despite the module comment.
- Fee posting can duplicate after navigation because the local `postedFees` set resets while the journal remains.
- No bank account CRUD or transfer.
- No reconciliation statement/period lock.

**Verdict:** demonstration only.

### 7.12 VAT registers and Mushak 9.1

**Who:** accountant/controller.  
**Start:** W05.  
**Actual current steps:** view purchase and sales registers, VAT current account, and a 9.1 return assembled from documents; print or export.  
**Problems:**

- Period is hard-coded to `2026-10`.
- Documents are filtered by `doc_date`, not by posted journal status. Reversed documents remain.
- Several return lines are placeholders (for example, “VAT deposited by challan” uses the computed net, not actual deposits; imported-service rebate is `0`; credit notes and bad-debt relief are `0`).
- The GL proof is computed from journals, but the return lines come from documents; the two can diverge after a receipt/payment/reversal.
- No period selection, no filing acknowledgement, no NBR reference, no evidence attachments.
- The due-date and legal content are unverified.

**Verdict:** a useful assembly preview, not a filing-ready return.

### 7.13 Month-end close

**Who:** accountant (maker) and controller/admin (checker).  
**Start:** W09.  
**Actual current steps:**

1. View six control proofs and a suspense queue.
2. Walk an 11-step close checklist; each step’s status is computed from live data.
3. Choose Maker/Checker via a segmented toggle, then click sign-off. The names are hard-coded.
4. When all steps have both sign-offs, click the period lock switch.
5. `setPeriodStatus` changes the period to LOCKED (or OPEN).

**Problems:**

- Sign-offs are local component state; navigating away resets them.
- Maker and checker are not the signed-in users, and the same person can operate both toggles.
- The lock does not require a persisted close run, approval record or reason.
- A period marked CLOSED still accepts postings.
- A new company has no payroll or depreciation journal, so steps 8 and 9 cannot pass.
- Suspense can be cleared to retained earnings with one click, no approval, and a fixed period-end date.
- The audit-chain verifier only checks the current browser state.
- There is no close pack export or evidence attachment.

**Verdict:** a visual checklist, not a controlled close.

### 7.14 Payroll

**Who:** HR/payroll officer and finance.  
**Start:** W10.  
**Actual current steps:** choose a seeded payroll period, edit overtime hours, include festival bonus, preview a journal, post it, export BEFTN/bKash workbooks.  
**Problems:** no employee master, no attendance/leave, no salary structure, no payroll run persistence, no approval, no duplicate prevention, no payslips, no PF fund, no tax computation, no payment reconciliation, hard-coded PF/festival/WPPF rates and legal reference.  
**Verdict:** demo only. Defer from MVP.

### 7.15 Import batch

**Who:** accountant/controller.  
**Start:** W07 → choose pipeline → upload XLSX/CSV or load demo → dry run → commit.  
**What works:** parsing, validation, row statuses, balanced journal generation, batch record, rollback reversals, audit pack.  
**Problems:** no master-data import; commercial imports do not update stock; no challans; no party master update; duplicate-within-batch is postable; no server-side transaction; a failed commit can leave partial state; no scheduled backups; no evidence of source file retention.  
**Verdict:** a promising utility, not production-safe.

### 7.16 Company/persona switching

**Who:** anyone with access to the top bar.  
**Start:** organisation menu → choose Apex/Cloudnine/Rafiq.  
**Actual current steps:** `setPersona` calls `createSeedDataset(persona)`, preserves preferences and users, and replaces all financial data with the seed dataset.  
**Effect:** the current company’s live data is discarded. There is no confirmation, no backup and no audit.  
**Verdict:** **data-loss trap.** In production, company switching must load a different company by ID from the server and must never reset data.

### 7.17 Correction and reversal

**Who:** controller/admin.  
**Start:** Ledger Lens or a journal view → reverse.  
**Actual current steps:** enter a reason, select a reversal date, post the reversing journal. The original is marked REVERSED and the reversal is linked.  
**Problems:** only one journal is reversed; the linked settlement, stock movement, document status, subledger item, challan and certificate are untouched; an already-reversed journal can be reversed again; the reversal does not create a new document version; there is no approval; the reason is not in an audit log; there is no correction report.  
**Verdict:** the reversal *primitive* is good; the correction *workflow* is missing.

### 7.18 Cross-module disconnect matrix

| Event | Journal posted? | Document updated? | Subledger updated? | Stock updated? | Challan/certificate? | Report period? |
|---|---|---|---|---|---|---|
| Sales invoice | Yes | Yes, created | AR open item from document | Yes, on invoice | No | Fixed October, may miss |
| Sales receipt | Yes | **No** | **No** | No | No | Fixed October |
| Credit note | Yes | Yes, but wrong number/serial | Subtracts from total AR, not invoice | **No** | No | Fixed October |
| Purchase bill | Yes | Yes, created | AP open item | Yes, on bill | **No** | Fixed October |
| GRN | **No** | Only local draft | No | **No** | No | N/A |
| Supplier payment | Yes | **No** | **No** | No | **No** | Fixed October |
| Treasury deposit | Yes | Challan status | VDS/TDS control | No | Synthesised 6.6 | Fixed October |
| Bank fee | Yes | No | No | No | No | Fixed October |
| Payroll | Yes | No persisted run | No | No | No | Fixed October |
| Import commercial batch | Yes | Imported docs created | Partially | **No** | **No** | Import date |
| Reversal | Yes | **No** | **No** | **No** | **No** | Reversal date |
| Persona switch | N/A | N/A | N/A | N/A | N/A | **All data replaced** |

### 7.19 Workflow verdict summary

| Workflow | Practical today? | Suitable for real books? | Priority |
|---|---|---|---|
| Sign in / access | No | No | P0 |
| Company onboarding | Only for a demo | No | P0 |
| COA / opening balances | Partly | No | P0 |
| Sales invoice | With care, for a single simple invoice | No | P0 |
| Credit note | No | No | P0 |
| Purchase bill | With care | No | P0 |
| Customer receipt / AR | No | No | P0 |
| Supplier payment / AP | No | No | P0 |
| Treasury / 6.6 | Only seeded data | No | P1 |
| Bank reconciliation | No | No | P1 |
| VAT return | Preview only | No | P1 |
| Month-end close | No | No | P1 |
| Payroll | No | No | P3 |
| Import | With manual verification | No | P2 |
| Reversal/correction | No | No | P0 |

---

## 8. SOP and user journey improvements

### 8.1 Target end-to-end operating SOP

The following is the SOP the product should enforce. It is written for a trading or service SME with a small finance team. A group implementation can add branches and approvals later.

| Step | Who | What the user does | What the system must do | Acceptance evidence |
|---:|---|---|---|---|
| 1 | Administrator | Receives an invitation or creates an organisation; verifies email; sets a password | Create org, verified user, secure session; audit the event | User can sign in from a new browser; previous sessions remain valid; audit log records sign-in |
| 2 | Administrator | Creates the first company: legal name, entity type, TIN/BIN, address, fiscal year, reporting framework | Create company with unique ID; create fiscal year and monthly periods; seed a default COA only after explicit confirmation | Company switcher shows the company; no other company’s data is visible |
| 3 | Accountant | Reviews the chart of accounts; imports or adds accounts; sets control accounts | Validate code uniqueness and hierarchy; protect control accounts from misuse; store tax mappings | Trial balance opens with zero balances; control accounts are marked |
| 4 | Accountant | Enters opening balances by balance-sheet schedule or imports a template | Build a balanced opening journal; show debit/credit totals; require approval; post atomically | Opening trial balance balances; open AR/AP/inventory agree to schedules |
| 5 | Administrator | Invites controller, accountants, operators, auditor | Send signed invitation links; assign company-scoped roles; expire tokens; audit | Each user can sign in; auditor cannot mutate; operator cannot post |
| 6 | Accountant | Configures banks, cash, MFS, branches/warehouses, tax registrations, numbering | Validate uniqueness; store opening balances; require a bank account for bank rails | New invoice can select a real bank/cash account |
| 7 | Operator/accountant | Creates a sales invoice: customer, lines, tax, due date, delivery details | Validate customer, quantities, prices, tax; compute line-level and document totals; save a server-side draft; show journal and tax preview | Draft survives refresh and is visible to another authorised user |
| 8 | Controller | Reviews and posts the invoice | Authorise, assign a gap-free Mushak 6.3 serial inside a transaction, post the journal, create the AR open item, update stock | Invoice appears once; AR ageing shows it; VAT register shows it; stock decreases; audit log records the post |
| 9 | Accountant/cashier | Records a customer receipt, full or partial, and allocates it | Post Dr bank/cash, Cr AR; create an allocation; update invoice balance; allow unapplied cash | Invoice balance decreases; AR ageing agrees; bank statement can match the receipt |
| 10 | Warehouse/accountant | Records GRN and supplier bill; matches PO, GRN and bill | Persist GRN; move stock; match quantities/prices; require override reason and approval for variance | Stock ledger shows receipt; 3-way match evidence is stored; AP open item created |
| 11 | Accountant | Pays supplier, with VDS/TDS where applicable | Post payment and allocations; create challan liabilities; record withholding certificate obligations; prevent duplicate payment | AP balance decreases; challan queue shows the liability; subledger reconciles |
| 12 | Accountant | Deposits challans and records certificates | Post Dr liability / Cr bank; capture challan number, date, bank branch, economic code; store certificate | Treasury register reconciles; 6.6 certificate is linked to the original invoice/payment |
| 13 | Accountant | Imports/enters bank statement; reconciles | Import statement; match by amount/date/reference; prevent duplicate matching; create GL for unexplained lines with approval | Every statement line is matched or in a reviewed exception queue; reconciliation report signs off |
| 14 | Accountant | Prepares VAT return for a selected period | Build registers from posted documents; reconcile to GL; show exceptions; export/print a DRAFT return | GL proof is zero; exceptions are listed; no claim of filing |
| 15 | Controller | Reviews reports, accruals, depreciation, payroll, suspense | Post adjusting journals; resolve suspense; run close checklist | TB balances; control proofs zero; no unexplained suspense |
| 16 | Controller/owner | Submits close; a different checker approves; period locks | Persist maker/checker, evidence and timestamp; block postings in CLOSED and LOCKED periods; allow controlled reopen with reason | Posting after lock is rejected; audit log shows who/when/why |
| 17 | Auditor | Reads and exports | Read-only role; access to journals, source documents, tax decisions, audit log, reconciliation evidence | Auditor cannot mutate; export contains evidence and is logged |

### 8.2 Daily, weekly, monthly and annual routines

**Daily (accountant/operator):**

- Review “Needs action” queue: drafts, receipts to allocate, bills due, bank exceptions.
- Record sales invoices and customer receipts; record purchase bills/GRNs; record cash/bank transactions.
- Check bank/MFS balances against the day’s statements.
- Resolve or assign exceptions; never leave an unexplained suspense item without an owner.

**Weekly (accountant/controller):**

- Review AR/AP ageing and follow up overdue items.
- Reconcile bank/MFS accounts; clear small fees and charges.
- Review tax withholding and pending challans.
- Review unposted drafts and stale documents.

**Monthly (controller):**

- Cut off documents at month end; no back-dated entries after the cut-off without approval.
- Post accruals, depreciation, payroll, inventory adjustments and tax adjustments.
- Reconcile all control accounts and clear suspense.
- Prepare VAT return and management accounts.
- Submit close to a different checker; lock the period.
- Archive the close pack and backup evidence.

**Annually:**

- Complete the fiscal year; roll forward opening balances.
- Prepare statutory financial statements and tax computation.
- Reconcile retained earnings and equity.
- Review chart of accounts, controls and user access.

### 8.3 Role-based “start here” experience

The dashboard should not be the same for everyone.

- **Owner:** cash position, overdue receivables/payables, tax due, approvals waiting, close status, one clear “review and approve” action.
- **Controller:** close checklist, control exceptions, unreconciled bank lines, pending approvals, journals awaiting review, VAT exceptions.
- **Accountant:** my drafts, items needing correction, receipts to allocate, bills to pay, bank lines to match, VAT period status.
- **Operator:** create invoice/bill/receipt/payment; no reports or configuration; no ability to post.
- **Auditor:** read-only reports, journal explorer, evidence, audit log, export.

### 8.4 Error and recovery SOP

| Situation | Current behaviour | Required behaviour |
|---|---|---|
| Wrong customer on a posted invoice | Reverse one journal; document remains; stock not restored | “Void/reverse document” action that reverses the entire document group, restores stock, reopens AR/AP and requires a reason/approval |
| Duplicate payment | No detection | Unique payment reference + allocation check + duplicate warning before posting |
| Receipt posted to wrong bank | Manual journal reversal only; no allocation change | Reallocate receipt, reverse and repost with audit trail |
| Bill entered in a closed period | Allowed because CLOSED is not enforced | Reject; offer “post in current period with original date reference” only through an approved correction |
| Bank line cannot be matched | Stays CATEGORIZED; no GL | Create a draft journal from the statement line, require account/approval, then match |
| VAT return disagrees with GL | Shows a variance; no blocking | Block filing export until variance is zero or an approved reconciliation is attached |
| Import batch has a bad row | Invalid rows excluded; partial commit possible | Whole-batch atomic commit or explicitly approved partial commit; preserve source file and errors |
| Save fails | Silently swallowed | Block the UI, show a clear error, retry, and preserve a local emergency draft |
| User leaves mid-form | Local state lost | Server-side draft autosave with “last saved” and unsaved-change warning |
| Company switch | Replaces data | Load the selected company from the server; never reset data |

### 8.5 In-product guidance requirements

- Every workspace has a one-line purpose and a visible **next action**, not a wall of metrics.
- Empty states explain the first step and link to it.
- Complex forms use a **review step** showing the document totals, tax treatment, journal preview and validation before posting.
- Validation messages say what is wrong, where, why, and how to fix it; never “Invalid input”.
- Confirmation dialogs are reserved for irreversible or high-impact actions and state the consequence in business language.
- Contextual help explains terms (VAT, VDS, TDS, Mushak 6.3, period close) without requiring a manual.
- A persistent “What happens when I post?” panel is available in Guided mode and collapsible in Pro mode.
- There is a visible save state (“Saved at 10:42”, “Saving…”, “Not saved — retry”).
- The app never claims success until the server confirms the posting.

### 8.6 Usability measurements

Track and set targets:

- Time to create and post the first invoice after onboarding: < 10 minutes for an accountant, < 20 for an owner.
- Time to record a receipt and allocate it: < 60 seconds.
- Percentage of invoices posted without a validation error after the first week: > 90%.
- Number of support tickets per 100 documents.
- Close cycle time from cut-off to lock.
- Percentage of bank statement lines auto-matched with a reviewed exception queue.
- User-reported “I don’t know what to do next” incidents.

---

## 9. Authentication and onboarding plan

### 9.1 Current state

- No password, no credential verification, no session token, no email verification, no password reset, no invitation, no user CRUD, no MFA, no rate limiting, no lockout, no session list, no device management.
- `UserAccount` has `username`, `full_name`, `role`, `email`, `designation`, `is_active`, `created_at`, `last_login_at`; no password hash, organisation membership, company access or invitation token.
- The app defaults to `isAuthenticated: true` and the first user (ADMIN).
- Any signed-in user can switch to any role from the top bar and access/roles modal.
- Signing out does not hide data; it only disables write actions via `hasPermission`.
- The complete financial dataset remains visible to anyone with browser access.

### 9.2 Target authentication model

Use **email + password** for the first release, with server-side sessions. Add optional TOTP MFA for administrators and controllers. Do not add social login in the MVP; it increases support and identity-linking complexity.

Required flows:

1. **Accept invitation** — a signed, single-use, expiring token; set name and password; verify email.
2. **Sign in** — email + password; generic error messages; rate limit by IP and account; audit success/failure.
3. **Sign out** — revoke the current session; other sessions remain listed and revocable.
4. **Forgot password** — always show a neutral response; send a single-use expiring link; do not reveal whether an email exists.
5. **Reset password** — invalidate other sessions; audit.
6. **Verify email** — required before creating a company or inviting users; resend with rate limit.
7. **Change password** — require current password; invalidate other sessions.
8. **MFA (later in MVP or immediately for admins)** — TOTP enrollment, recovery codes, disable with password + code.
9. **Session management** — list devices, last seen, revoke; idle timeout (for example 30 minutes for finance roles, configurable); absolute timeout; secure, HTTP-only, SameSite cookies; CSRF protection for state-changing requests.
10. **Account lockout** — progressive delay and temporary lock after repeated failures; do not leak account existence.

Security requirements:

- Argon2id password hashing with per-user salt and sensible parameters.
- Password policy that encourages length and blocks known-breached passwords; do not impose arbitrary complexity that pushes users to write passwords down.
- No passwords or tokens in logs.
- Session cookie `Secure`, `HttpOnly`, `SameSite=Lax` (or Strict where feasible), with rotation on privilege change.
- CSRF token or double-submit cookie for any cookie-based session.
- Rate limit authentication, password reset, invitation and export endpoints.
- Audit all identity events with IP, user agent, timestamp and outcome.

### 9.3 User, organisation and company model

Recommended model:

- **User** — a person, identified by verified email.
- **Organisation** — the customer/tenant; owns companies and billing.
- **Membership** — user ↔ organisation with a role (owner, admin, controller, accountant, operator, auditor).
- **Company membership** — optional restriction of a user to specific companies/branches.
- **Role permissions** — server-enforced; company-scoped.
- **Invitation** — email, organisation, role, company scope, token, expiry, inviter.
- **Session** — server-side record with revocation.
- **Audit event** — append-only.

Roles for the MVP:

| Role | Company settings | Masters | Create drafts | Post journals | Approve high value | Reverse | Close maker | Close checker | Users | Reports | Export |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Controller | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Accountant | No | Yes | Yes | Yes | No | No | Yes | No | No | Yes | Yes |
| Operator | No | No | Yes | No | No | No | No | No | No | Limited | No |
| Auditor | No | No | No | No | No | No | No | No | No | Read-only | Yes, audited |

The exact matrix must be configurable later; the first release should be simple and defensible. A user must never be able to grant themselves a role. The last owner cannot be removed or demoted.

### 9.4 Onboarding journey

The target onboarding must be resumable, server-persisted and role-aware.

1. **Account** — accept invitation or start a trial; verify email; set password.
2. **Organisation** — legal/trading name, country (Bangladesh), time zone (Asia/Dhaka), default language, billing contact.
3. **Company** — legal name, entity type, industry, TIN, BIN, RJSC number, registered address, contact, logo, reporting framework. Validate formats but allow “not registered yet”.
4. **Fiscal year** — start/end, first period, base currency (BDT), accounting policy defaults. Generate periods; allow a non-July start with an explicit warning.
5. **Chart of accounts** — choose a template (trading, services, manufacturing-lite, blank), preview it, import a CSV/XLSX, or copy from another company the user can access. Do not clone silently.
6. **Opening balances** — enter by account and by customer/supplier/item; show debit/credit totals and a balance check; require approval to post.
7. **Banks and cash** — add bank/MFS/cash accounts with masked numbers, opening balances, branch and signatories.
8. **Tax settings** — VAT status, BIN units/branches, withholding entity status, default tax categories, filing frequency (subject to official verification), numbering series.
9. **Team** — invite controller/accountant/operator/auditor; assign company scope; show the permission summary.
10. **First transaction** — guided creation of a sales invoice or purchase bill; review; post; show where it appears in reports.
11. **Close setup** — approval thresholds, close checklist, period lock policy, backup/export responsibilities.

Every step should have **Save and exit**, **Resume**, and a clear progress indicator. The system must never mark onboarding complete until the company has a balanced opening position and at least one owner/admin with verified access.

### 9.5 Opening balance design

Do not treat opening cash + bank = capital as sufficient. The opening balance workflow must cover:

- Cash and bank.
- Trade receivables by customer and invoice, with ageing.
- Trade payables by supplier and bill, with due dates.
- Inventory by item and warehouse, at cost.
- Fixed assets by class, cost, accumulated depreciation and useful life.
- Loans, leases, provisions and other liabilities.
- Share capital, retained earnings and other equity.
- VAT/TDS/VDS control balances.
- Suspense/unknown items, which must be flagged and approved, not silently plugged.

The system should generate a single balanced opening journal (or an approved opening batch with control totals), store the supporting schedule, and prevent normal trading until the opening balance is approved.

### 9.6 Authentication and onboarding acceptance criteria

- A new user cannot access any company data before accepting a valid invitation and signing in.
- A signed-out user cannot read financial data.
- A user cannot change their own role.
- An auditor cannot mutate any data through the UI or API.
- A company’s data is never visible to a user without membership.
- The onboarding wizard survives refresh and can be resumed.
- Opening balances must balance and require approval before posting.
- Creating a second company never deletes or resets the first.
- The first owner can invite a controller, and the controller can complete the company setup if permitted.
- All identity, invitation, role and onboarding events are audited.

---

## 10. Public landing page plan

### 10.1 Purpose

The landing page must answer, within seconds:

1. What is this product?
2. Who is it for?
3. Why should a Bangladeshi finance team trust it?
4. What does it actually look like and do?
5. What is the next step?

It must not look like an internal dashboard, a template, or an AI-generated SaaS page. It should look like a serious commercial finance product with a point of view.

### 10.2 Audience and message

Primary audience: owners, finance managers and accountants at Bangladeshi trading, service and light-manufacturing companies with 10–500 employees. Secondary: accounting practices and group finance teams (later).

Core message:

> **LedgerVault gives Bangladeshi businesses one reliable place for their books, tax and daily finance operations — built so the ledger, the VAT return and the management reports always agree.**

Supporting messages:

- “Built for Bangladesh, not translated for it.” BDT, Bangla/English, BIN/TIN, Mushak registers, local banks and MFS.
- “See the accounting before you post.” A plain-language tax and journal preview.
- “Close with evidence, not guesswork.” Control accounts, audit trail and period lock.
- “Start with the essentials.” A focused product, not a pile of half-finished modules.

Avoid unsupported claims such as “Big-4 grade”, “audited”, “NBR-approved”, “100% compliant”, “bank-grade security” unless independently true and documented.

### 10.3 Page structure

1. **Header/navigation**
   - Brand mark and wordmark.
   - Product, Solutions, Why LedgerVault, Security, Pricing (if public), Resources.
   - “Sign in” and a primary “Request a demo” or “Start trial”.
   - Mobile menu with the same actions.
2. **Hero**
   - One clear headline, one subheadline, two CTAs (primary: request demo/start trial; secondary: see how it works).
   - A real product visual: a focused sales invoice or close screen, not a collage of floating cards.
   - A small trust strip: “Built for BDT and Bangladeshi VAT”, “Bangla + English”, “Your data, your control” — only claims that are true.
3. **Problem statement**
   - The real pain: spreadsheets and disconnected tools; tax returns assembled by re-keying; month-end surprises; no audit trail; owners waiting for reports.
4. **Product walkthrough**
   - Three or four concrete workflows: invoice → receipt; bill → payment → challan; bank reconciliation; close and reports.
   - Use annotated screenshots or a short interactive demo. Do not use fake data that looks like a real customer.
5. **Core capabilities**
   - Accounting and GL.
   - Sales and receivables.
   - Purchases and payables.
   - Banking and MFS.
   - VAT and withholding.
   - Reports and close.
   - Each with a one-sentence outcome, not a feature dump.
6. **Built for Bangladesh**
   - BDT, lakh/crore formatting, Bangla/English, BIN/TIN, Mushak register preparation, bank/MFS workflows.
   - A clear note that statutory outputs require review and professional sign-off where applicable.
7. **Controls and trust**
   - Roles and approvals, period lock, audit trail, backups, data isolation.
   - Link to a security page with specifics; do not use vague badges.
8. **Who it is for**
   - Trading, services, light manufacturing, accounting practices (coming later).
   - Keep the first release honest: “Designed for small and medium finance teams; group consolidation is on the roadmap.”
9. **Implementation/onboarding**
   - “Import your chart of accounts and opening balances with help.”
   - “Invite your team.”
   - “Start with one company; expand when ready.”
10. **Pricing**
    - If pricing is public, show transparent plans and what is included. If sales-led, say “Talk to us” and explain the implementation process. Do not hide pricing behind a fake “custom” page if the buyer cannot evaluate fit.
11. **FAQ**
    - Data ownership and export.
    - Backup and recovery.
    - Bangla support.
    - VAT/tax responsibility.
    - Migration from Excel/Tally/other software.
    - Multi-company/branch availability.
12. **Final CTA**
    - One action, low friction. “Request a 30-minute walkthrough” or “Start a guided trial”.
13. **Footer**
    - Company/legal entity, address, contact, privacy, terms, security, status page, documentation, changelog.
    - No fake office addresses, phone numbers or certifications.

### 10.4 Landing page visual direction

- Use the product’s real design system, not a separate marketing template.
- Restrained palette: warm paper/ivory background, deep green/ink text, one accent, one warning colour.
- Generous whitespace, strong typographic hierarchy, real interface screenshots.
- No floating 3D objects, random gradients, glassmorphism or decorative SVG art.
- Show the actual ledger/table typography and money formatting; this is part of the product’s credibility.
- Use Bangladeshi business context naturally (Dhaka/Chattogram, BDT, local bank names) without clichés or stock photos of handshakes.
- Mobile-first: hero readable at 360px; CTAs reachable; screenshots legible or replaced with a simplified mobile illustration.
- Performance: static or server-rendered marketing page, no heavy app bundle; target LCP < 2.5s on a mid-range phone.
- SEO: title, description, canonical, Open Graph, structured data for the organisation; no misleading claims.
- Accessibility: WCAG 2.2 AA; keyboard navigation; reduced motion; captions for any video.

### 10.5 Authentication page design

- A dedicated `/login` page, not a modal over the dashboard.
- Clear brand, product context, email/password, “Forgot password”, “Sign in with an invitation”, and a contact link.
- No role selector on the login page.
- Error messages do not reveal whether an email exists.
- A separate `/accept-invitation/:token` page with the inviter/company context.
- Password reset pages with a single purpose and no marketing clutter.
- Session-expired screen that preserves the intended destination and explains what happened.
- Loading, error and offline states.

### 10.6 Landing page acceptance criteria

- A visitor with no account can understand the product and reach a demo/trial without seeing internal demo data.
- The page makes no unverified compliance, audit or security claim.
- The marketing site and app share a coherent identity but do not share the app’s heavy bundle.
- All CTAs work and lead to a real form or scheduling flow.
- Mobile layout has no horizontal overflow and no text below 12px.
- The page is accessible and performant.
- Analytics measure CTA clicks, demo requests and sign-up completion without collecting unnecessary PII.

---

## 11. UI/UX and design system specification

### 11.1 Diagnosis of the current interface

The current “Lumen” system is visually distinctive but reads as a **design-forward AI demo**, not a daily accounting tool:

- 8.5–10px labels, 12.5px table text and extensive uppercase tracking make dense screens hard to read, especially in Bangla and on low-DPI laptops.
- 20–26px card radii, aurora blobs, grain textures, glass panels, gradient buttons, animated sheens and decorative SVGs compete with the financial data.
- The dashboard tries to show everything: KPIs, filing clock, action inbox, natural-language composer, Sankey, 13-week forecast and scenario sliders. It is impressive in a screenshot and exhausting on day 30.
- Some screens use multiple competing accent colours (indigo, violet, gold, emerald, rose) without a strict semantic rule.
- Many controls are small icon buttons with tooltips; keyboard and screen-reader support is inconsistent.
- The visual hierarchy often prioritises the brand header over the user’s next action.
- The app has a beautiful “marketing” layer but weak “ledger” layer: tables, filters, reconciliation, approvals and audit evidence are less considered than the hero visuals.

The redesign should not throw away the craft. It should redirect it: **quiet confidence, dense where it matters, calm everywhere.**

### 11.2 Design direction: “The Quiet Ledger”

A professional finance workspace inspired by well-made ledgers and modern ERP tools, not by consumer dashboards.

- **Personality:** precise, calm, trustworthy, local, understated.
- **Metaphor:** a well-kept ledger: ruled lines, clear columns, totals that foot, annotations in the margin.
- **Primary colour:** deep bottle green / forest (`#14532D` or a similar accessible tone) — trust and permanence, not the generic indigo gradient.
- **Surface:** warm paper (`#F7F5EF`) for the app canvas; white for working surfaces; ink/navy (`#101828`) for text.
- **Accent:** brass/amber (`#B45309` or a controlled gold) for attention and due dates; use sparingly.
- **Semantic colours:** green for posted/balanced; amber for pending/attention; red for error/overdue; blue for informational; grey for neutral.
- **Gradients:** essentially none in the application. A single subtle brand gradient may remain in the logo/marketing hero.
- **Decoration:** no aurora, grain, floating blobs or guilloche in operating screens. Use thin rules, whitespace and typographic hierarchy.
- **Density:** two modes. Guided: 14px base, generous spacing. Pro: 13px base, compact table rows, account codes visible. Never below 12px for working text or 11px for metadata.

**Reference points (patterns, not copies):** Xero for clear bank reconciliation and document flow; QuickBooks for small-business navigation; SAP Fiori for role-based work lists and dense enterprise tables; Tally for the ledger/voucher vocabulary many Bangladeshi accountants already know; Zoho Books for pragmatic localization and packaging. Take the interaction patterns that reduce work; do not copy their visual identities or import their complexity. LedgerVault should have its own quiet-ledger identity.

### 11.3 Design tokens

| Token | Recommendation |
|---|---|
| Font UI | Inter or Source Sans 3; self-hosted. Bangla: Noto Sans Bengali or Hind Siliguri, self-hosted. |
| Font figures | IBM Plex Mono or a tabular variant of the UI font; tabular lining numerals. |
| Base size | 14px guided; 13px pro; line-height 1.5 (1.7 for Bangla). |
| Type scale | 12, 13, 14, 16, 18, 22, 28, 34. Avoid 8–10px working text. |
| Spacing | 4px base; 8, 12, 16, 24, 32, 40, 48, 64. |
| Radius | 6px controls, 8px cards, 10px modals; no 20px+ cards. |
| Border | 1px hairline `#E4E7EC`; stronger `#D0D5DD` on hover/focus. |
| Shadow | One subtle elevation for popovers/modals; cards use border, not heavy shadow. |
| Grid | 12-column desktop, 8-column tablet, 4-column mobile; max content width 1440px. |
| Breakpoints | 360, 480, 640, 768, 1024, 1280, 1440, 1600. |
| Focus | 2px visible focus ring, offset 2px, contrast ≥ 3:1. |
| Motion | 120–200ms for state changes; respect `prefers-reduced-motion`; no decorative looping animation in the app. |

Define these as CSS variables and Tailwind theme tokens. Do not use raw hex values in components. Every colour must have a semantic name (`surface`, `surface-muted`, `text`, `text-muted`, `border`, `brand`, `success`, `warning`, `danger`, `info`).

### 11.4 Typography rules

- Page title: 24–28px semibold, sentence case, no tracking hacks.
- Section title: 16–18px semibold.
- Body: 14px/1.5.
- Table header: 12px medium, sentence case, not 9px uppercase.
- Money: tabular numerals, right aligned, two decimals, currency symbol in the column header or first row, not repeated on every cell.
- Bangla: increase line-height; test every label with real Bangla text; avoid uppercase transforms because they do not apply to Bangla and create inconsistent English/Bangla headings.
- Dates: use a clear format such as `05 Nov 2026` in English and `০৫ নভে ২০২৬` in Bangla; do not use ambiguous `05/11/26`.
- Labels: sentence case, direct verbs (“Save draft”, “Post invoice”, “Allocate receipt”).
- Avoid ALL CAPS for long labels and avoid letter-spacing on body text.

### 11.5 Core components

**Navigation**

- Persistent left sidebar on desktop, collapsible to icons; bottom navigation or drawer on mobile.
- Top-level: Home, Sales, Purchases, Banking, Accounting, Tax, Reports, Settings.
- Hide modules the user cannot access; do not show disabled modules as clutter.
- Company/branch switcher with clear current context; never a data-resetting persona menu.
- Search/command palette (Ctrl/Cmd+K) with entity search (invoice, bill, party, account, journal) and actions.
- Breadcrumbs for nested pages.

**Page header**

- Title, status, period/company context, primary action.
- No decorative hero inside the app.
- Secondary actions in an overflow menu.
- A single “next action” bar for document workflows.

**Data tables**

- Server-side pagination, sorting and filtering.
- Sticky header; sticky first column for identifiers.
- Configurable columns and saved views; sensible defaults per role.
- Row selection and bulk actions where safe.
- Clear empty state, loading skeleton, and error state with retry.
- Money right-aligned, tabular; negative in parentheses or with a clear minus, consistent across the app.
- Status chips with text, not colour alone.
- Row click opens detail; explicit action menu for post/reverse/print.
- Keyboard navigation and accessible table semantics.

**Forms**

- Single-column layout for most forms; two columns only for related short fields.
- Labels above fields; required indicator; help text adjacent.
- Money input with BDT prefix, grouping, two decimals and paste normalization.
- Date input with a calendar and keyboard entry; period selector separate.
- Party/account/item pickers with search, recent items and “create new” where permitted.
- Line-item grid with clear totals, per-line tax, discount and account; keyboard add/remove.
- Autosave drafts server-side with a visible save state.
- Review step before posting; show document totals, tax breakdown, journal preview and any warnings.
- Unsaved-changes guard.
- Server validation errors mapped to the correct field and summarized at the top.

**Buttons**

- One primary action per area.
- Destructive actions use a danger style and confirmation with the consequence stated.
- Loading state disables the button and shows progress.
- Never use a disabled button without explaining why (tooltip or inline reason).

**Cards and KPIs**

- Cards are for summaries, not for every table row.
- KPI card: label, value, comparison, one-line explanation, optional trend, link to detail.
- No decorative gradient backgrounds for financial figures.
- Use a maximum of four KPI cards on a dashboard; the rest belongs in reports.

**Dialogs and drawers**

- Use a full page for complex create/edit flows; use a drawer for quick view/edit and a modal for confirmation.
- Focus trap, Escape to close, restore focus, accessible title/description.
- Never hide a long form in a modal on mobile.

**Notifications**

- Inline validation for forms; toast for transient success/failure; persistent banner for systemic issues (save failure, offline, session expiry).
- Toasts are not the only record of a financial action; the audit log/report is.
- Destructive or high-value actions require confirmation, not just a toast.

**Charts**

- Use charts only for trends/comparisons that are easier to read visually than in a table.
- One accent colour, muted gridlines, accessible labels, a data table alternative.
- No 3D, no gratuitous animation, no Sankey unless it answers a specific question.
- Financial statements are tables, not charts.

**Audit trail**

- A right-side drawer or dedicated page showing who/what/when/why, before/after values, source document, IP/session, and linked reversal.
- Filter by entity, user, action and date.
- Exportable with permission.

**Approval bar**

- Sticky footer: Save draft, Submit for approval, Approve, Post, Reject with reason.
- Shows the current step, approver, threshold and segregation-of-duties rule.
- Disabled actions state the missing permission or approval.

### 11.6 Page templates

1. **List page:** header, primary action, filters, saved views, table, pagination, bulk actions. Example: invoices, bills, journals, parties.
2. **Document workbench:** header with status and number; left form; right context panel (tax summary, journal preview, attachments, audit); sticky action bar. Full page on desktop, stacked on mobile.
3. **Detail page:** summary, timeline, lines, allocations, attachments, audit; actions appropriate to status.
4. **Report page:** period selector, entity/branch filter, report body, totals, drill-down, export/print, comparison.
5. **Settings page:** section navigation, forms with save/cancel, permission warnings, audit of changes.
6. **Close page:** checklist, control proofs, exceptions, sign-offs, lock/reopen, close pack.
7. **Onboarding page:** step navigation, progress, save/resume, preview.

### 11.7 Accessibility

Target WCAG 2.2 AA:

- Minimum 4.5:1 contrast for normal text; 3:1 for large text and UI components.
- Working text at least 12px; preferably 13–14px.
- Full keyboard operation; visible focus; logical tab order.
- Labels for every input; error identification and suggestions.
- Tables with proper headers, captions and scope.
- Accessible names for icon buttons; no icon-only actions without a tooltip/aria-label.
- Respect reduced motion; no flashing or looping decoration.
- Bangla screen-reader testing with at least one VoiceOver/NVDA pass.
- Zoom to 200% without loss of function.
- Touch targets at least 44×44px on mobile.

### 11.8 Responsive behaviour

- **Mobile (360–639px):** single column; bottom nav or drawer; tables become cards or horizontally scrollable with a clear affordance; primary actions fixed at the bottom; no tiny multi-column forms.
- **Tablet (640–1023px):** two-column forms; sidebar drawer; condensed tables.
- **Desktop (1024px+):** persistent sidebar; full workbench; side panels.
- **Wide (1440px+):** max content width; do not stretch forms across the entire screen.
- Test with Bangla text, long company names, 10,000-row tables and 200% zoom.

### 11.9 Content and microcopy

- Use the accountant’s language: “Invoice”, “Bill”, “Receipt”, “Payment”, “Journal”, “Period”, “Post”, “Reverse”, “Allocate”.
- Explain tax terms once, in context; do not use acronyms without expansion on first use.
- Error messages: what happened, why, what to do next, and whether anything was saved.
- Empty states: “No invoices yet. Create your first invoice or import a batch.”
- Confirmations: “Posting this invoice will create an irreversible journal and reserve Mushak serial M63-2026-00042. Continue?”
- Avoid “Oops”, “Something went wrong”, “Magic”, “AI-powered” unless the feature is genuinely AI and the user understands the risk.

### 11.10 Migration from the current UI

- Keep the command palette, the document workbench concept and the bilingual formatting utilities.
- Replace the Lumen tokens with the Quiet Ledger tokens.
- Remove aurora/grain/glass/sheen from operating screens.
- Remove decorative SVGs from finance workflows; keep a single brand mark.
- Rebuild tables, forms, dialogs and state components before restyling individual pages.
- Move from modal-first workflows to routes for complex documents.
- Introduce a component gallery/storybook or a `/design` internal page with every state.
- Do not attempt a page-by-page visual rewrite before the workflow and data model are correct.

### 11.11 Design acceptance criteria

- A new accountant can identify the next action on every screen within five seconds.
- No working text is below 12px; body text is 14px in guided mode.
- Every colour has a semantic token; no arbitrary gradient on a data surface.
- Every table has loading, empty, error and permission-denied states.
- Every form has inline validation, a review step for posting, and an unsaved-changes guard.
- Every destructive action has a confirmation that states the accounting consequence.
- Keyboard-only completion of invoice creation, receipt allocation, journal posting and period close is possible.
- The app passes an automated accessibility scan and a manual keyboard/screen-reader check.

---

## 12. Localization strategy

### 12.1 Current state

- `src/core/i18n.ts` composes 1,222 English and 1,222 Bangla keys; automated parity reports zero missing keys.
- Number, date, grouping and Bangla digit helpers exist.
- A large amount of UI copy is still written inline with `L('English', 'বাংলা')` in components rather than through the dictionary.
- Some labels mix English accounting terms into Bangla sentences; others translate literally.
- Server/API error messages do not exist yet, so there is no error-code localization strategy.
- The app loads fonts from Google Fonts, which creates an external dependency and a privacy/availability concern.

### 12.2 Language policy

- **English (en-BD)** is the default for the first release because most finance teams work in English for accounting records and reports. Bangla is a first-class alternative, not a hidden toggle.
- **Bangla (bn-BD)** must be complete for all user-facing screens, including errors, empty states, confirmations, help, reports and onboarding.
- **Banglish** is a search/input convenience only; it is not a UI language.
- Do not machine-translate legal or tax text. Use a native accounting professional to review terminology and statutory labels.
- Keep accounting terms consistent across the app and reports. A glossary is part of the product, not documentation.

### 12.3 Terminology glossary (proposed; native accountant review required)

| English | Preferred Bangla | Notes |
|---|---|---|
| Chart of accounts | হিসাবের চার্ট | Use consistently; do not alternate with “অ্যাকাউন্ট তালিকা”. |
| General ledger | সাধারণ খতিয়ান | “খতিয়ান” is familiar; avoid “জেনারেল লেজার” in guided mode. |
| Journal entry | জার্নাল এন্ট্রি / দিনলিপি | Use one primary term per context. |
| Debit | ডেবিট | Keep the accounting term; explain on first use. |
| Credit | ক্রেডিট | Same. |
| Trial balance | রেওয়ামিল | Standard. |
| Balance sheet | উদ্বৃত্তপত্র / আর্থিক অবস্থানের বিবরণী | Use “আর্থিক অবস্থানের বিবরণী” in formal reports. |
| Profit and loss | লাভ-ক্ষতির বিবরণী | Standard. |
| Accounts receivable | প্রাপ্য হিসাব | Standard. |
| Accounts payable | প্রদেয় হিসাব | Standard. |
| Invoice | চালান / কর চালান | Distinguish tax invoice (কর চালান) from delivery challan (ডেলিভারি চালান). |
| Bill | বিল | Supplier bill. |
| Receipt | প্রাপ্তি | Customer receipt. |
| Payment | পরিশোধ | Supplier payment. |
| Fiscal year | অর্থবছর | Standard. |
| Accounting period | হিসাবকাল / সময়কাল | Choose one; avoid mixing. |
| Period close | সময়কাল সমাপনী | Use consistently. |
| Post | পোস্ট | Explain “খতিয়ানে যুক্ত করা” in guided mode. |
| Reverse | রিভার্স / বাতিল | Use “বাতিল” for a user action, with a clear explanation that history remains. |
| Allocate | বরাদ্দ | For receipts/payments. |
| Withholding tax (VDS/TDS) | উৎসে কর / ভিডিএস / টিডিএস | Keep statutory acronyms in Pro mode; expand in guided mode. |
| Mushak | মূসক | Keep the form number. |
| Audit trail | অডিট ট্রেইল / নিরীক্ষা পথ | Choose one and define it. |
| Approval | অনুমোদন | Standard. |
| Branch | শাখা | Standard. |
| Warehouse | গুদাম | Standard. |
| Stock | মজুদ | Standard. |
| Depreciation | অবচয় | Standard. |
| Accrual | সঞ্চিতি | Context-dependent; review. |

The glossary must be maintained in `docs/` and in a shared translation file, with a test that fails when a key is missing or a prohibited variant is used.

### 12.4 Translation architecture

- Keep the custom typed dictionary approach if it remains small; add a `TranslationKey` union generated from the English dictionary and a compile-time check that every key exists in Bangla.
- Namespace keys by feature: `common.*`, `auth.*`, `company.*`, `sales.*`, `purchases.*`, `banking.*`, `tax.*`, `reports.*`, `close.*`, `errors.*`.
- Never put user-visible strings directly in components. `L(en, bn)` should be replaced by `t('sales.createTitle')`.
- Server returns stable error codes and structured fields; the client maps them to localized messages. Do not return English prose as the only error contract.
- Support pluralization and count interpolation. Do not concatenate sentences from fragments.
- Keep date/number formatting in one shared module; do not hand-format amounts in components.
- Provide a pseudo-localization mode for QA that lengthens strings and exposes truncation.

### 12.5 Number, currency, date and time rules

- Store money as integer poisha on the server/database; serialize as strings or integer minor units. Never send a floating-point amount as authoritative.
- Display BDT with the `৳` symbol or `BDT` in reports; use lakh/crore grouping by default (`12,34,56,789.00`) and allow millions grouping for international readers.
- Bangla digits are optional. Default to the user’s preference; preserve the same numeric value in exports and APIs.
- Use the Asia/Dhaka time zone for timestamps. Store timestamps in UTC and render in Dhaka time.
- Date input/output: `05 Nov 2026` (English) / `০৫ নভে ২০২৬` (Bangla) in UI; ISO `YYYY-MM-DD` in APIs and storage.
- Financial periods: display the exact period, not “this month” ambiguously. Always show the company and period context near reports.
- Negative amounts: use a consistent convention (parentheses or minus) across all reports and tables; test printing.

### 12.6 Localization QA

- Native Bangladeshi accountant review of all accounting, tax and report labels.
- Screenshot review of every screen in English and Bangla at 360px, 768px and 1440px.
- Automated missing-key and unused-key checks in CI.
- Automated test for number/date formatting at lakh/crore boundaries, negative values, zero, and Bangla digits.
- Manual review of report PDFs and Excel exports in both languages.
- A glossary review before every release.

### 12.7 Localization acceptance criteria

- No visible hard-coded English string in a Bangla session (except proper nouns, document numbers and user data).
- Every error, confirmation, empty state and help text has a translation key.
- Reports print correctly in both languages, including column widths and Bangla line-height.
- Switching language does not change stored data or calculations.
- A Bangla-speaking accountant can complete the core workflows without switching to English.
- The app does not depend on Google Fonts at runtime for production; fonts are self-hosted or have a reliable local fallback.

---

## 13. Accounting integrity requirements

### 13.1 Non-negotiable invariants

| ID | Invariant | Current status | Required control |
|---|---|---|---|
| I-01 | Every posted journal has at least two lines and exactly equal debits and credits. | Enforced in `postJournal` for engine paths. | Preserve; add database/API tests and trigger/constraint where feasible. |
| I-02 | No posted journal line is edited or deleted. Corrections are linked reversals. | UI has no edit; reversal exists. | Enforce append-only at database/permission level; no update/delete route for posted journals. |
| I-03 | Posting is atomic: header, lines, document status, subledger, stock and tax records commit together. | Not atomic; in-memory mutations + snapshot. | Server transaction with row locks and rollback; integration tests for partial failures. |
| I-04 | Duplicate submission is prevented by an idempotency key. | `postJournal` has a key, but document posting does not use a stable key. | Unique `idempotency_key` per company; API requires it; tests. |
| I-05 | Periods are explicitly OPEN, CLOSED or LOCKED; CLOSED and LOCKED reject postings; unknown dates reject. | Only LOCKED rejects; unknown dates open. | Enforce all three states and require a period for every posting; no implicit open period. |
| I-06 | Journal and document numbers are unique per company/branch/type/period and gap-free where statutory. | Not enforced; array-length numbering; rollback reuse. | Database sequences/allocator inside transaction; unique constraints; no reuse after reversal. |
| I-07 | Credit notes are distinct 6.7 documents linked to the original invoice; they do not consume 6.3 serials. | Broken. | Separate type, series, original link, approval, stock/COGS reversal. |
| I-08 | Receipts/payments allocate to specific open items; partial and multiple allocations are supported. | Missing. | Payment/receipt + allocation tables; subledger derivation; tests. |
| I-09 | Inventory movements are recorded as stock transactions and reconcile to the inventory GL. | Broken. | Stock ledger, GRN/issue/transfer/count, weighted average, control proof, negative-stock policy. |
| I-10 | Tax decisions are stored with the document and snapshot the rule pack/version used. | Trace ID exists; rule version is static. | Store full decision + rule pack version + effective dates; never recompute historical tax with current rates. |
| I-11 | Reversal reverses the entire financial effect of a document or journal group, with a reason and approval, and leaves a link. | Partial and unsafe. | Document-level correction service; linked reversal group; stock/subledger restoration; duplicate guard. |
| I-12 | Subledgers reconcile to control accounts at all times; differences are surfaced, not plugged. | Seeded data reconciles; new receipts/payments break it. | Derive from allocations/stock, not document status heuristics; show open items; block close. |
| I-13 | Trial balance debits equal credits; balance sheet balances; cash flow reconciles. | Seed passes; reports can be stale/fixed-period. | Period-aware queries; block close on differences; independent tests. |
| I-14 | Every material action is audited with actor, time, before/after, reason and source. | Only journal hash chain. | Append-only audit log; UI viewer; export; retention. |
| I-15 | Roles and approvals are enforced server-side with segregation of duties. | Client-side only; high-value approval unused. | Auth middleware, policy checks, approval engine, tests for every role. |

### 13.2 Money and rounding

- Keep integer poisha as the authoritative unit. Do not use JavaScript `number` for money in the server or database.
- Store `bigint`/`BIGINT` or `numeric(20,2)` consistently. If using `BIGINT` poisha, document the range and ensure JSON serialization as a string.
- Define rounding once per tax/line/document context. Store the tax decision and rounded amounts. Do not round at display time for authoritative reports.
- Line-level rounding must foot to document totals. If a document-level rounding adjustment is needed, post it to a named rounding account (not a silent plug).
- Foreign currency is out of MVP scope; do not display USD/EUR fields that do not affect the ledger. If retained, mark them “not available” and prevent posting.

### 13.3 Posting transaction algorithm

The server-side posting service should execute, inside one serializable transaction:

1. Authenticate and authorise the actor for the company and action.
2. Validate the idempotency key; return the prior result if it exists.
3. Lock the period row and confirm status `OPEN`.
4. Lock/allocate the next document number and statutory serial (6.3/6.7/6.6/challan) from a sequence table.
5. Validate the document, lines, party, accounts, tax rules and amounts server-side.
6. Compute the tax decision and persist a snapshot with rule pack version.
7. Build and validate journal lines; ensure balance and known accounts.
8. Insert the journal header and lines, document, lines, tax decision, stock movements and subledger links.
9. Update the document status and open items.
10. Append audit events.
11. Commit. If any step fails, roll back everything.

No client-supplied total, tax amount, journal line, account balance or status should be trusted as authoritative.

### 13.4 Document numbering and statutory serials

- Use separate sequences for sales invoice, credit note, purchase bill, expense voucher, receipt, payment, journal, delivery challan, GRN and treasury challan.
- Scope sequences by company, branch/BIN unit, document type and fiscal year as required.
- Allocate inside the posting transaction; never derive from a row count.
- A voided/reversed document keeps its number; never reuse it.
- Provide an admin view of the next number and gaps, with an audit trail for manual overrides (restricted, reason required).
- For Mushak 6.3/6.7/6.6, expose the series and gap report; do not claim statutory correctness until the format is verified.

### 13.5 Periods and close

- `OPEN`: normal posting allowed.
- `CLOSED`: no normal posting; only an authorised correction with a reason, posted in the current period or through a controlled reopen.
- `LOCKED`: no posting or master-data changes that affect the period; reopen requires a separate permission and a reason, with audit and possibly a second approver.
- Unknown date: reject with “No accounting period is configured for this date.”
- Close must be a persisted run with: period, checklist results, evidence, maker, checker, timestamps, lock status and a close pack.
- Block close if trial balance, control proofs, cash flow, suspense policy or required approvals fail.
- Do not allow “write off to retained earnings” as a one-click suspense resolution; require a target account, reason, approval and tax review where applicable.

### 13.6 Reversal and correction

- A reversal must target a **document** or an explicit journal group, not an arbitrary single line set.
- It must create new journals with mirrored lines; the original remains immutable.
- It must link original ↔ reversal, store the reason, actor, approval and timestamp.
- It must reverse all linked effects: settlement, allocation, stock movement, challan/certificate, tax register, document status.
- It must refuse a second reversal of the same target.
- It must not allow reversal of a reversal; post a new correcting document instead.
- It must be authorised by a controller/admin and, above a threshold, by a second approver.
- It must update reports and subledgers in the same transaction.

### 13.7 Reconciliation and subledgers

- AR/AP subledgers must be built from invoices/bills and allocations, not from a mutable `settled_poisha` field alone.
- Every control account must have an open-item schedule and a GL proof.
- Bank/MFS reconciliation must import statements, match with a score, prevent duplicate matches, and create approved GL entries for unexplained lines.
- Inventory must reconcile to the inventory GL by warehouse/item and valuation method.
- VAT current account must reconcile to the return and the GL.
- VDS/TDS payable must reconcile to challans and certificates.
- A difference is an exception with an owner and ageing; never a plug.

### 13.8 Approval and segregation of duties

- Define approval thresholds by company and document type.
- Enforce maker-checker: the approver cannot be the creator for high-value or sensitive actions.
- Require a reason for overrides, manual journals, reversals, period reopen, master-data changes and exports.
- Store approval decisions and evidence.
- Prevent self-approval of one’s own role, permissions or high-value payment.
- Auditor is read-only at the API level, not just the UI.

### 13.9 Audit log

The audit log must answer: **who did what, when, from where, why, and what changed?**

Minimum events:

- Sign-in success/failure, sign-out, session revocation, password reset, MFA change.
- User invited, role changed, company access changed.
- Company/period settings changed.
- Master data created/edited/deactivated.
- Document drafted, submitted, approved, posted, rejected, reversed.
- Journal posted/reversed.
- Period closed/locked/reopened.
- Export/import/backup created or restored.
- Permission denied/high-value override.
- Tax rule pack changed.

The log must be append-only, queryable, exportable and retained per policy. It must not be editable by ordinary admins. The journal hash chain can remain as an additional integrity signal, but it is not a substitute for an audit log.

### 13.10 Accounting integrity acceptance tests

- Post an unbalanced journal via API → rejected; nothing persisted.
- Post a balanced journal twice with the same idempotency key → one journal.
- Post the same document number twice → rejected.
- Post into CLOSED and LOCKED periods → rejected.
- Post outside any configured period → rejected.
- Create a credit note against an invoice → distinct 6.7 number, linked original, no 6.3 consumption.
- Receive a partial customer payment → invoice balance decreases; AR ageing agrees; GL agrees.
- Pay a supplier partially → AP and VDS/TDS liabilities agree; challan exists.
- GRN increases stock; invoice decreases stock; stock ledger and GL reconcile.
- Reverse a posted sale → AR reopened, stock restored, VAT register updated, original linked, second reversal rejected.
- Close a period with a variance → blocked; resolve then close; checker cannot be maker.
- Change a tax rule → historical documents retain their original decision snapshot.
- Delete/clear browser storage → server data remains; sign in on a new browser recovers the books.
- Export a report → totals agree to the on-screen report and the GL.

---

## 14. Bangladesh-specific business and compliance considerations

### 14.1 Critical caveat: current legal claims are not verified

The repository contains very specific claims about Bangladeshi law and practice. They appear in `SPEC.md`, `src/core/tax-engine/rulePack.ts`, `W10_PayrollLabourSuite.tsx`, `W11_SecretarialGovernance.tsx` and the print templates. The rule pack itself is marked `reviewer_status: 'PENDING_TAX_COUNSEL'` and almost every rule has `verify_flag: true`; the payroll screen cites a specific SRO and Act; the print pack cites a filing ordinance.

**This audit does not confirm any of those claims.** They must not be presented to a customer, auditor, regulator or investor as settled law until each has been checked against the current official source and reviewed by a qualified Bangladeshi tax/accounting professional. Some may be correct; some may be inaccurate, superseded, mis-cited or invented. The product must be built so that a wrong rule never silently posts a wrong journal.

Claims that require verification include, at minimum:

- The existence, number, gazette date, effective date and content of the “VAT & SD (Amendment) Ordinance, 2026 (Ordinance No. 38 of 2026)” and the 15-day/20-day Mushak 9.1 filing window.
- The applicable VAT rates and categories (standard 15%, truncated 5%, procurement 7.5%, zero-rated export, exempt, reverse charge), and which goods/services fall into each.
- The s.46 input-credit conditions, including the BIN requirement, Mushak 6.3 evidence, the BDT 1,00,000 cash-payment threshold, and the treatment of truncated-rate supplies.
- VDS rates and the categories to which withholding applies, including the code’s 15% standard rate versus the UI’s 4.5%/5% references.
- TDS sections, rates, bases, thresholds and the 50% no-TIN upscale for goods, professional services, rent, advertising and transport.
- Any filing-frequency, holiday-adjustment or late-filing rule.
- Labour Act payroll rules: PF, gratuity, festival bonus, overtime, WPPF, worker classification, working hours and statutory registers. The cited “Bangladesh Labour (Amendment) Act 2026” and “SRO 53-Law/2026” must be verified.
- IFRS adoption status in Bangladesh, the FRC framework, IFRS for SMEs/BFRS, and the effective date/requirements of IFRS 18.
- RJSC filing forms, deadlines and fees; NBR notice/appeal procedures.
- Data protection and cybersecurity obligations, including the claimed “Personal Data Protection Act 2026” and “Cyber Security Act 2026”.

### 14.2 Confirmed functional requirements (not rate claims)

The following are product requirements that are safe to design around without asserting a specific statutory rate:

- The functional currency is BDT; amounts must support poisha precision and lakh/crore presentation.
- The company needs a configurable fiscal year; July–June is common but not universal.
- The chart of accounts must support control accounts for receivables, payables, bank/MFS, VAT current account, VDS/TDS payable and inventory.
- Sales and purchases need tax-invoice fields, party BIN/TIN, item description, quantity, value, tax and total.
- Withholding and VAT must be configurable by rule, not hard-coded in components.
- The system must produce internal registers and draft statutory schedules; it must not claim to file them.
- User roles, approvals, period locks, audit trails and backups are mandatory controls.
- Reports must be exportable and traceable to source documents.
- Data must be isolated by company and protected from unauthorised access.

### 14.3 Configurable rule pack design

Replace the single compile-time rule pack with a versioned, reviewed data set.

Suggested structure:

```text
jurisdiction: BD
rule_pack_version: bd-2026-v1
status: DRAFT | PENDING_REVIEW | APPROVED | SUPERSEDED
effective_from / effective_to
reviewer_name / reviewer_qualification / reviewed_at / source_document
rules:
  - id
  - domain: VAT | SD | VDS | TDS | AIT | FILING | PAYROLL | OTHER
  - title_en / title_bn
  - rate_bps (nullable)
  - base: NET | GROSS | VAT_INCLUSIVE | ...
  - conditions (structured)
  - citation
  - instrument
  - source_url / gazette_reference
  - effective dates
  - exceptions
  - verification_status
```

Requirements:

- The UI displays the rule pack status and a clear “requires professional review” notice when not approved.
- A document stores the exact rule pack version and tax decision used at posting time.
- Changing a rule never changes a historical posted document; a new rule applies prospectively unless a controlled revaluation is approved.
- Rules can be disabled quickly if a legal change or error is found, with an audit trail and impact report.
- The tax engine returns a `MANUAL_REVIEW` or blocking state when a rule is missing, expired, disputed or unsupported. Do not guess.
- Filing deadlines and holiday adjustments must be configurable data, not a hard-coded 2026 list.
- The system must allow a “not registered / not applicable” company state without forcing a VAT rate.

### 14.4 Statutory outputs

The product may prepare internal versions of:

- Mushak 6.1 purchase register.
- Mushak 6.2 sales register.
- Mushak 6.3 tax invoice.
- Mushak 6.6 withholding certificate.
- Mushak 6.7 credit note.
- Mushak 9.1 VAT return.
- VDS/TDS schedules and treasury challan register.
- Payroll registers and statutory summaries (later).

Every such output must be clearly labelled **DRAFT — NOT FILED** until the user confirms filing outside the system. Do not print an audit opinion, a government receipt, a filing acknowledgement or an authority signature that did not occur.

### 14.5 Payroll and Labour Act considerations

Payroll is not in the MVP. Before it is built:

- Verify every rate and rule with a labour-law professional.
- Model employee classification, working hours, overtime, leave, festival bonus, PF, gratuity, WPPF, deductions and tax.
- Support configurable salary components and effective dates.
- Keep an immutable payroll register per run.
- Require maker-checker approval.
- Support bank/MFS payment files without claiming disbursement.
- Reconcile payroll liabilities (net pay, PF, gratuity, tax, WPPF) to the GL.
- Do not use the company’s current-month P&L to compute WPPF without a documented, reviewed method.

### 14.6 Data protection and privacy

- Treat names, mobile numbers, emails, NID, TIN, BIN, bank details, salary and tax records as sensitive personal/business data.
- Collect only what is needed.
- Encrypt in transit and at rest; restrict access by role and company.
- Mask sensitive identifiers in lists and logs; reveal only on an authorised detail view.
- Maintain an audit trail of access to sensitive records.
- Provide data export and deletion workflows consistent with applicable law and record-retention obligations.
- Do not store secrets or PII in browser localStorage in production.
- Verify the actual data-protection law and any registration/notification obligations with counsel.

### 14.7 Compliance governance

- A named tax counsel/accountant signs off the rule pack and each statutory template.
- Every rule change has a source, a reviewer, a date and an impact assessment.
- The product has a “regulatory changes” page and a change log.
- Customer-facing copy distinguishes “prepared”, “reviewed” and “filed”.
- The system never claims “NBR-approved”, “audited” or “Big-4 grade” without evidence.

---

## 15. Security and permissions assessment

### 15.1 Current security posture

| Area | Current state | Risk |
|---|---|---|
| Authentication | None; username selector; default authenticated admin | Anyone with the browser can act as an administrator |
| Sessions | None | No timeout, revocation, device control or login history |
| Authorization | Client-side `hasPermission`; role switch exposed | Any user can become any role; API would be bypassable |
| Tenant isolation | One global state; persona switcher | Cross-company data exposure and data loss |
| Data at rest | Plain JSON in localStorage/IndexedDB | Theft from the device or browser profile; no encryption |
| Data in transit | Development/static hosting only | No production TLS/session design |
| Audit | Journal hash chain only | No operational accountability; chain can be recomputed locally |
| Export | Any user can download the full vault | Data exfiltration; no approval or audit |
| Import | Admin can replace the full state | Destructive overwrite; no backup |
| File upload | XLSX/CSV parsing in browser | Malicious/large files; no scanning or limits |
| CSP/headers | None in `index.html` | XSS and clickjacking exposure once a server exists |
| Secrets | None visible in source | Future risk if keys are added to the frontend |
| Dependency security | Older `xlsx`; no audit in CI | Parser vulnerabilities and unmaintained code |

### 15.2 Threat model (summary)

| Threat | Example | Required control |
|---|---|---|
| Account takeover | Credential stuffing, weak password | Argon2id, rate limit, MFA for admins, lockout, breached-password check |
| Insider fraud | Accountant creates and approves a payment | Maker-checker, thresholds, segregation of duties, audit log |
| Cross-tenant access | User guesses another company ID | Server-side company membership check on every query; RLS/defence in depth |
| Unauthorised export | Employee downloads all customer data | Permissioned export, reason, watermark, audit, rate limit |
| Tampering | User edits browser storage or API payload | Server authoritative, append-only journals, DB constraints, audit log |
| XSS | Malicious party name/narration | React escaping, CSP, input validation, no `dangerouslySetInnerHTML` |
| SQL injection | Search/filter input | Parameterised queries/ORM, validation |
| CSRF | Cookie-based session | SameSite cookies + CSRF token for mutations |
| File upload attack | Malicious XLSX/CSV | Size/type limits, parser isolation, scanning, no formula execution |
| Data loss | Browser cleared, bad import | Server backups, point-in-time recovery, restore drills, confirmation + export before destructive actions |
| Repudiation | User denies posting | Immutable audit log with actor/session/time |
| Denial of service | Huge report/import | Pagination, limits, background jobs, rate limits |
| Supply chain | Compromised dependency | Lockfile, audit, pinned versions, minimal dependencies |

### 15.3 Target security controls

**Identity and sessions**

- Email verification, password hashing, reset, invitations, MFA for privileged roles.
- Server-side sessions with secure cookies, idle/absolute timeout, revocation and device list.
- Rate limits and generic error messages.
- Audit all identity events.

**Authorization**

- Server-side policy checks on every endpoint.
- Company-scoped membership; no client-supplied `company_id` trusted without membership verification.
- Role matrix with explicit permissions; deny by default.
- High-value approvals and maker-checker.
- Auditor read-only at the query layer.
- Last-owner protection.

**Data protection**

- TLS everywhere; HSTS.
- Encryption at rest for database and object storage; encrypted backups.
- PII masking in logs and list views.
- Data retention and deletion policy.
- Secure file storage with signed URLs, virus scanning and size limits.

**Application security**

- CSP, `X-Frame-Options`/frame-ancestors, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy.
- CSRF protection for cookie sessions.
- Input validation on the server with a shared schema.
- Output encoding by default.
- No secrets in the frontend bundle.
- Dependency scanning, SAST, secret scanning and container scanning in CI.
- Security headers and error handling that do not leak stack traces.

**Operations**

- Least-privilege database and deployment roles.
- Separate environments and secrets.
- Audit log retention and immutable storage.
- Backup encryption, restore drills and disaster recovery runbook.
- Monitoring/alerting for failed logins, permission denials, export spikes, posting failures and backup failures.
- Incident response and breach notification procedure (verify legal obligations).

### 15.4 RBAC and approval requirements

- Roles are assigned at organisation and company level; a user may have different roles in different companies.
- Permissions are explicit and tested; no “role name” checks scattered through UI code.
- The API returns 403 for missing permission and writes an audit event.
- The UI hides or disables actions the user cannot perform and explains why.
- High-value thresholds are configuration, not a comment.
- The creator cannot approve their own high-value document, journal, reversal or close.
- An override requires permission, reason and audit; a second approver for very high values.
- Period reopen requires a distinct permission and reason; possibly a second approver.

### 15.5 Security acceptance criteria

- No financial data is visible without a valid session and company membership.
- A user cannot escalate their own role, invite themselves, or access another company by changing an ID.
- All mutating endpoints are authorised server-side and covered by tests.
- All authentication and authorization failures are logged.
- Passwords are never stored or logged in plaintext.
- Exports require permission, are audited, and can be watermarked.
- The app passes a security review before production; no critical/high vulnerabilities remain open.
- Backup restore is tested and documented.

---

## 16. Database and architecture recommendations

### 16.1 Decision: add a server and database; do not keep browser storage as the source of truth

The current architecture cannot support a real accounting product. The correct response is not to add more features to `VaultContext`; it is to introduce a server-backed system of record while preserving the pure domain logic.

Recommended target:

```text
┌──────────────────────────────┐
│ Browser: React + Vite         │
│ - routes, forms, tables       │
│ - previews using shared domain│
│ - no authoritative balances   │
└──────────────┬───────────────┘
               │ HTTPS / JSON
┌──────────────▼───────────────┐
│ API: Node + Fastify + Zod     │
│ - authn/authz, tenancy        │
│ - posting transactions        │
│ - reporting queries           │
│ - audit log, jobs             │
└───────┬───────────────┬───────┘
        │               │
┌───────▼──────┐  ┌─────▼──────────────┐
│ PostgreSQL   │  │ Object storage      │
│ - ledger     │  │ - attachments       │
│ - documents  │  │ - exports/backups   │
│ - audit      │  └─────────────────────┘
└──────────────┘
```

Optional supporting services: email provider (invitations/reset), background job runner (reports/imports), error tracking, metrics/logs, and later bank/MFS integrations.

### 16.2 Stack recommendation

Keep the existing frontend stack where practical:

- React 18 + Vite + TypeScript.
- Tailwind CSS (rebuilt design tokens).
- React Router for real routes.
- TanStack Query for server state, caching and mutation states.
- React Hook Form + Zod for forms and shared validation.
- A small component library built in-repo, not a wholesale UI framework swap.

Add the server:

- **Node.js 20 LTS + TypeScript**.
- **Fastify** for a small, fast, explicit HTTP API. It is easier to reason about than a large framework for this team size.
- **Zod** for request/response validation and shared schemas.
- **PostgreSQL 16** as the database.
- **Drizzle ORM + drizzle-kit** for typed schema and SQL migrations. It produces readable SQL and does not hide transactions.
- **Vitest** for unit/integration tests.
- **Playwright** for browser E2E.
- **Pino** for structured logs.
- **OpenAPI** generated from the route schemas for documentation and external integrations.

Why not a no-code/BaaS-only approach: the product needs explicit posting transactions, database constraints, audit retention and self-hosting options for Bangladeshi customers. A managed Postgres is fine, but the application logic should remain in the codebase.

Why not microservices: the domain is tightly coupled around the ledger; a modular monolith is simpler, faster and safer for this stage.

### 16.3 Repository layout recommendation

```text
/
├── src/                    # React frontend (existing, incrementally migrated)
├── server/                 # Fastify API
│   ├── src/
│   │   ├── app.ts
│   │   ├── auth/
│   │   ├── companies/
│   │   ├── ledger/
│   │   ├── sales/
│   │   ├── purchases/
│   │   ├── banking/
│   │   ├── tax/
│   │   ├── reports/
│   │   ├── audit/
│   │   └── jobs/
│   ├── migrations/
│   └── tests/
├── packages/domain/        # shared pure TypeScript domain (migrated from src/core)
├── packages/shared/        # shared types, Zod schemas, error codes
├── docs/
├── scripts/
├── docker-compose.yml
└── package.json            # workspace scripts
```

The domain package must remain free of browser and Node-specific APIs so it can run on both sides. The server is the only place that persists authoritative results. The client may run previews for responsiveness, but it must send the facts, not the computed totals, and display the server’s result after posting.

### 16.4 API design principles

- REST resources, not a single “do everything” endpoint.
- Every request validated with Zod; every response typed.
- Consistent error envelope: `{ code, message, fieldErrors?, details?, traceId }`.
- Money as strings or integer minor units, never floats.
- Dates as ISO `YYYY-MM-DD`; timestamps as ISO 8601 UTC.
- Idempotency key required for posting, payments and imports.
- Pagination, sorting, filtering and search on list endpoints.
- No client-supplied company ID trusted without membership verification.
- OpenAPI spec generated and tested.

Suggested core endpoints (illustrative, not exhaustive):

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /invitations/accept

GET    /me
GET    /organisations
POST   /organisations
GET    /companies
POST   /companies
GET    /companies/:id/periods
POST   /companies/:id/periods/:code/close
POST   /companies/:id/periods/:code/reopen

GET    /companies/:id/accounts
POST   /companies/:id/accounts
GET    /companies/:id/parties
POST   /companies/:id/parties
GET    /companies/:id/items
POST   /companies/:id/items

GET    /companies/:id/documents?type=&status=&period=
POST   /companies/:id/documents
POST   /companies/:id/documents/:id/submit
POST   /companies/:id/documents/:id/approve
POST   /companies/:id/documents/:id/post
POST   /companies/:id/documents/:id/reverse

GET    /companies/:id/journals
POST   /companies/:id/journals
POST   /companies/:id/journals/:id/reverse

POST   /companies/:id/receipts
POST   /companies/:id/payments
POST   /companies/:id/allocations

GET    /companies/:id/bank-accounts
POST   /companies/:id/bank-statements/import
POST   /companies/:id/bank-lines/:id/match
POST   /companies/:id/bank-lines/:id/create-journal

GET    /companies/:id/reports/trial-balance
GET    /companies/:id/reports/profit-loss
GET    /companies/:id/reports/balance-sheet
GET    /companies/:id/reports/cash-flow
GET    /companies/:id/reports/ar-ageing
GET    /companies/:id/reports/vat-registers
GET    /companies/:id/audit-events
```

### 16.5 Database schema outline

Use `company_id` on every financial table. Use UUIDs for IDs and human-readable document numbers separately. Use `BIGINT` poisha or `NUMERIC(20,2)` consistently; do not mix.

**Identity and tenancy**

- `organisations` (id, name, country, timezone, status, created_at).
- `users` (id, email, password_hash, name, status, email_verified_at, mfa_secret, created_at).
- `memberships` (id, organisation_id, user_id, role, status).
- `company_memberships` (membership_id, company_id, role_override?, branch_scope?).
- `invitations` (id, organisation_id, email, role, token_hash, expires_at, accepted_at, invited_by).
- `sessions` (id, user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at).

**Company configuration**

- `companies` (id, organisation_id, legal_name, trade_name, entity_type, industry, tin, bin, rjsc_no, address, phone, email, reporting_framework, base_currency, status, created_at).
- `branches` / `bin_units` (id, company_id, name, bin, address, is_principal).
- `fiscal_years` (id, company_id, label, start_date, end_date, status).
- `periods` (id, company_id, fiscal_year_id, code, start_date, end_date, status, locked_at, locked_by, reopened_reason).
- `company_settings` (company_id, key, value_json, updated_by, updated_at).
- `number_sequences` (company_id, branch_id, doc_type, fiscal_year, prefix, next_value, pad, version).
- `tax_registrations` (company_id, type, number, status, effective dates, metadata).
- `tax_rule_packs` and `tax_rules` (version, domain, rate, conditions, citation, source, status, reviewer).

**Accounting**

- `accounts` (id, company_id, code, name_en, name_bn, type, sub_category, parent_id, ifrs_category, control_subledger, currency, is_active, tax_mapping_json).
- `opening_balance_batches` (id, company_id, period_id, status, created_by, approved_by, posted_journal_id).
- `opening_balance_lines` (batch_id, account_id, party_id?, debit_poisha, credit_poisha, memo).
- `journals` (id, company_id, branch_id, journal_number, book_type, posting_date, document_date, period_id, source_type, source_id, narration, status, idempotency_key, reversal_of_id, reversed_by_id, created_by, approved_by, posted_at, created_at).
- `journal_lines` (id, journal_id, line_no, account_id, party_id?, debit_poisha, credit_poisha, memo, cost_center, project, tax_decision_id?).
- Unique: `(company_id, journal_number)`, `(company_id, idempotency_key)`.
- No update/delete on posted journals; status/reversal links only.

**Parties, items, inventory**

- `parties` (id, company_id, code, name_en, name_bn, type, bin, tin, address, phone, email, credit_days, credit_limit, is_withholding_buyer, is_government, status).
- `party_opening_items` (party_id, document_type, document_no, due_date, amount_poisha, base_poisha?).
- `items` (id, company_id, sku, hs_code, name_en, name_bn, unit, is_stock_item, default_tax_category, inventory_account_id, status).
- `warehouses` (id, company_id, branch_id, name, code, address, status).
- `stock_movements` (id, company_id, item_id, warehouse_id, movement_type, date, quantity NUMERIC(18,4), unit_cost_poisha, value_poisha, source_type, source_id, journal_id?, created_by).
- `stock_balances` (company_id, item_id, warehouse_id, quantity, value_poisha, updated_at) or a view over movements.
- `stock_counts` / `stock_transfers` later.

**Documents and settlement**

- `documents` (id, company_id, branch_id, doc_type, doc_number, legal_serial, original_document_id?, party_id, status, doc_date, due_date, currency, base_poisha, sd_poisha, vat_poisha, vds_poisha, tds_poisha, gross_poisha, net_payable_poisha, tax_category, tds_nature, payment_method, narration_en, narration_bn, created_by, approved_by, posted_at, reversed_by_id, idempotency_key).
- Unique: `(company_id, doc_type, doc_number)` and `(company_id, doc_type, legal_serial)` where applicable.
- `document_lines` (id, document_id, line_no, item_id?, description_en, description_bn, quantity NUMERIC(18,4), unit_price_poisha, discount_poisha, tax_category, account_id?, warehouse_id?, tax_decision_id?).
- `document_taxes` (document_id, line_id?, tax_type, rate_bps, base_poisha, amount_poisha, rule_id, rule_pack_version).
- `tax_decisions` (id, company_id, document_id?, journal_id?, input_json, decision_json, rule_pack_version, trace_id, created_at).
- `receipts` / `payments` (id, company_id, party_id, date, bank_account_id, amount_poisha, reference, status, journal_id, created_by, approved_by).
- `allocations` (id, receipt_id/payment_id, document_id, amount_poisha, discount_poisha, writeoff_poisha, created_at).
- `advances` / unapplied cash later.

**Banking and treasury**

- `bank_accounts` (id, company_id, branch_id, name, kind, provider, masked_number, currency, gl_account_id, opening_poisha, status).
- `bank_statements` (id, company_id, bank_account_id, period_start/end, file_id, imported_by, imported_at, status).
- `bank_statement_lines` (id, statement_id, date, description, reference, debit_poisha, credit_poisha, status, matched_journal_id?, match_type, confidence, created_at).
- `reconciliations` (id, company_id, bank_account_id, period_id, status, prepared_by, reviewed_by, completed_at, evidence_file_id).
- `challans` (id, company_id, type, period_id, amount_poisha, economic_code, status, deposit_date, bank_account_id, certificate_id?, journal_id, created_by).
- `certificates` (id, company_id, type, number, direction, party_id, original_document_id, amount_poisha, tax_poisha, date, status, challan_id, evidence_file_id).

**Audit, attachments, jobs**

- `audit_events` (id, organisation_id, company_id, actor_user_id, session_id, action, entity_type, entity_id, before_json, after_json, reason, ip, user_agent, created_at). Append-only.
- `attachments` (id, company_id, entity_type, entity_id, file_name, mime_type, size, storage_key, checksum, uploaded_by, created_at, virus_scan_status).
- `import_batches` (id, company_id, pipeline, file_id, status, row_count, valid_rows, committed_by, committed_at, rollback_journal_ids).
- `background_jobs` (id, type, payload, status, attempts, started_at, finished_at, error).

**Later modules**

- `employees`, `salary_components`, `payroll_runs`, `payroll_lines`, `payroll_payments`.
- `fixed_assets`, `depreciation_runs`, `disposals`.
- `budgets`, `budget_lines`.
- `consolidation_groups`, `intercompany_transactions`.

### 16.6 Database integrity rules

- Foreign keys on every relation; no orphan journal lines, allocations, stock movements or documents.
- Check constraints: non-negative quantities/prices where appropriate; debit XOR credit; at least two lines per journal; no zero-line journals.
- Unique constraints on account code per company, document number per company/type, journal number per company/book, idempotency key, party code, item SKU, bank account GL code.
- `ON DELETE RESTRICT` for financial records; use status/deactivation, never delete posted history.
- A database trigger or posting function validates the journal debit/credit total at commit, because application-only validation is not enough.
- Use `SERIALIZABLE` or explicit row locks for period and sequence allocation. Handle serialization failures with a retry and a clear user message.
- Store `created_at`, `created_by`, `updated_at`, `updated_by` on mutable master/config tables; posted financial tables are append-only.
- Use an outbox/job table for emails, reports and integrations; do not perform slow work inside a posting transaction.

### 16.7 Posting service design

- One service per document family: sales, purchases, receipts, payments, journals, inventory, treasury.
- Each service accepts a validated command, checks permission and period, allocates sequences, computes tax, writes all related rows, and returns a result.
- Domain functions from `packages/domain` are used for pure calculation; they never write to the database.
- The server stores the calculated result; the client may preview with the same domain functions but cannot override the authoritative total.
- Every command supports an `Idempotency-Key` header; the result is stored and replayed.
- Failures return a stable code and no partial state.
- A posting attempt and failure are logged with enough context to diagnose, without logging secrets.

### 16.8 Migration from the current prototype

Do not attempt a silent migration of every localStorage snapshot. Plan:

1. Export the existing `.vault.json` from the demo only.
2. Build a one-way importer that maps accounts, parties, items, open documents and journals into the new schema.
3. Validate the imported trial balance and control proofs against the source; produce a reconciliation report.
4. Require an explicit confirmation and a backup before import.
5. Mark imported records with a source tag; do not pretend they are native server records.
6. For real customers, use a guided onboarding and opening-balance import rather than importing demo data.

### 16.9 Offline and local drafts

- Do not claim offline multi-user accounting.
- Allow local autosave of unposted drafts for resilience, but the server draft is the source of truth.
- If the network is unavailable, clearly show “Offline — changes are not saved to the server” and prevent posting.
- Do not store authoritative balances or the full ledger in localStorage in production.
- If an offline-first requirement emerges later, design a proper sync engine with conflict resolution; do not bolt it onto the current snapshot model.

### 16.10 Architecture acceptance criteria

- All authoritative data is server-side and backed up.
- A failed posting leaves no partial records.
- Two users can work concurrently without overwriting each other; conflicts are detected.
- Every company-scoped query is authorised.
- The client cannot compute and submit a different total than the server calculates.
- The database rejects duplicate numbers, orphan lines and unbalanced journals.
- The API is documented and tested.
- The demo mode is separate and clearly labelled.

---

## 17. Reporting and financial statement requirements

### 17.1 Required reports for the MVP

| Report | Purpose | Key requirements |
|---|---|---|
| Trial balance | Prove debits = credits; opening/period/closing | Select period/date range; account-level detail; drill to journal; export |
| General ledger detail | Audit a single account | Opening balance, transactions, running balance, source document, tax decision |
| Profit or loss | Management and statutory performance | Month/YTD, comparative prior period/year, revenue/expense classification, drill-down |
| Balance sheet | Financial position | As-of date, current/non-current classification, equity roll-forward, balanced check |
| Cash flow | Cash movement | Indirect method from operating profit, working-capital changes, investing/financing, reconciliation to cash |
| Changes in equity | Equity movement | Opening, profit, owner transactions, closing |
| AR ageing | Collect cash | Customer, invoice, due date, buckets, outstanding, allocated/unallocated |
| AP ageing | Pay suppliers | Supplier, bill, due date, buckets, outstanding, withholding |
| Customer statement | Send to customer | Opening, invoices, receipts, credit notes, closing; PDF/email |
| Supplier statement | Reconcile supplier | Opening, bills, payments, debit notes, closing |
| VAT 6.1/6.2 registers | VAT preparation | Period, taxable value, VAT, VDS, rebate eligibility, exceptions |
| VAT 9.1 return | Draft filing | Parts, GL proof, zero variance, DRAFT watermark |
| VDS/TDS challan register | Treasury | Liability, deposit, certificate, outstanding |
| Stock valuation/movement | Inventory control | Item/warehouse, quantity, cost, value, movement history |
| Journal listing | Audit | Filters, source, actor, status, reversal links |
| Close pack | Evidence | Checklist, control proofs, exceptions, sign-offs, audit log |
| Audit pack | External audit | Statements, TB, GL, documents, tax decisions, reconciliations, audit log |

### 17.2 Period semantics

- **P&L / cash flow / changes in equity:** require a range (month, quarter, YTD, fiscal year, custom). Label the exact range, never just “year ended” for a monthly report.
- **Balance sheet:** require an as-of date. The default is the end of the selected period.
- **Comparatives:** default to the prior period for monthly management accounts and the prior fiscal year for statutory accounts. Make the choice explicit.
- **Opening balances:** derive from all journals before the range start, not from a mutable account field.
- **Multi-book:** keep `book_type` in journals but do not expose multiple books until the accounting policy and reconciliation between books are defined. The current multi-book filter is a presentation filter, not a consolidation engine.
- **Branch/company:** every report must show the company and branch scope; no implicit “all data” for a user without permission.

### 17.3 Calculation rules

- Revenue and expense normal sides must be consistent; do not sum signed amounts without a normal-side helper.
- COGS must come from stock movements, not a display calculation; service costs use the appropriate expense account.
- Tax expense, deferred tax and current tax must be separated; do not present a single unexplained “tax” line.
- Retained earnings must roll forward from opening + profit − distributions ± adjustments.
- Cash flow must reconcile to the cash/MFS control accounts. A difference must block close and be displayed, not plugged.
- Balance sheet must balance to zero. If it does not, show the difference prominently and block statutory export.
- Rounding must be documented; no hidden rounding accounts.
- The report engine must not depend on the current date or a hard-coded 2026 period.

### 17.4 Drill-down and evidence

Every report line should support:

1. Report line → accounts.
2. Account → journals.
3. Journal → lines, source document, tax decision, attachments.
4. Source document → approval, audit events, reversal link.

This traceability is a core differentiator. It must work for a reversed document, an imported batch, a manual journal and a tax adjustment.

### 17.5 Print and export

- A4 print layouts for invoices, bills, credit notes, statements, VAT schedules, financial statements and close pack.
- PDF export with a stable layout, page numbers, company identity, period and “DRAFT/UNAUDITED” status.
- Excel export for registers and audit packs, with formulas where useful but totals frozen/verifiable.
- CSV export for data portability.
- Every export is permissioned, logged and watermarked with company/user/time where appropriate.
- Do not generate an audit opinion. Label management accounts **“Management accounts — unaudited”**.
- Do not label a return as filed; label it **“Draft for review”**.

### 17.6 Reporting acceptance criteria

- The user can select any configured period and see the correct P&L, balance sheet and cash flow.
- A new November transaction appears in November reports and does not silently disappear.
- The report total equals the sum of its drill-down journals.
- Trial balance, balance sheet and cash flow checks are visible and block export/close when failing.
- AR/AP ageing agrees to the control accounts after partial receipts/payments.
- VAT registers exclude reversed documents and include credit notes in the correct period.
- Exports match the on-screen figures.
- No report contains a fabricated audit opinion or filing acknowledgement.

---

## 18. Integration and data-management considerations

### 18.1 Import priorities

1. **Chart of accounts** — CSV/XLSX template with code, name, type, parent, control account, tax mapping.
2. **Parties** — customers/suppliers with BIN/TIN, address, credit terms, opening balances.
3. **Items** — SKU, description, unit, tax category, cost, opening stock by warehouse.
4. **Opening balances** — balanced schedule with AR/AP/inventory/fixed assets/equity.
5. **Sales/purchase documents** — optional historical import, with a separate “opening” or “historical” mode and explicit reconciliation.
6. **Bank/MFS statements** — CSV/XLSX; mapping rules; duplicate detection; reconciliation.
7. **Journals** — bulk journal import with validation and batch rollback.

Every import must support dry run, row-level errors, a downloadable error file, an idempotency key, atomic commit, and an audit record of the source file and actor.

### 18.2 Export and portability

- Full company data export in a documented format (JSON/CSV + attachments).
- Financial statements and registers in PDF/XLSX.
- Audit pack with source evidence.
- VAT/TDS schedules in a format an accountant can review.
- Payroll payment files later.
- Data export must be permissioned, rate-limited, audited and encrypted if it contains PII.
- Provide a documented restore path; an export that cannot be restored is not a backup.

### 18.3 Bank and MFS integration

MVP: statement upload + reconciliation. Do not promise live bank feeds.

Later:

- Bank API/feeds where available and commercially sensible.
- bKash/Nagad merchant settlement reports.
- Courier COD reconciliation for e-commerce.
- Payment initiation only with strong approval, idempotency and audit; not in MVP.
- Fee and charge mapping per provider.

### 18.4 Email, SMS and notifications

- Email is required for invitations, verification, password reset and critical alerts.
- Use a reputable provider with SPF/DKIM/DMARC; do not send from the application server directly.
- SMS is optional and costly; use for high-value approvals or OTP if required.
- Notification preferences per user; no sensitive amounts in email subjects.
- Audit notification delivery failures.

### 18.5 Attachments and evidence

- Invoices, bills, delivery challans, GRNs, bank statements, challans, certificates, approvals and close evidence.
- Store in object storage, not the database blob.
- Virus scan; allow only expected MIME types; size limits.
- Signed, time-limited URLs; access checked by company/entity permission.
- Checksum, uploader, timestamp and retention metadata.
- Do not allow an attachment to be deleted if it is referenced by a posted record; use a retention/legal hold policy.

### 18.6 Accounting-practice and group features

Defer, but design the schema:

- Multi-client practice cockpit (organisation-level).
- Engagement, reviewer and sign-off workflow.
- Client data isolation.
- Group consolidation, intercompany eliminations and minority interests.
- Multi-currency and translation.
- Consolidation should never be faked by summing unrelated company datasets.

### 18.7 Integration acceptance criteria

- A customer can migrate opening balances from a template without developer help.
- Imports are atomic and reversible with an audit trail.
- Bank statement import produces a reconciliation queue, not a set of auto-matched entries.
- Exports can be restored into a new environment and reconcile to the source.
- No integration can post a journal without permission and audit.
- File handling is secure and bounded.

---

## 19. Testing and quality assurance strategy

### 19.1 Current test inventory

| Asset | What it verifies | Gaps |
|---|---|---|
| `npx tsc --noEmit` | TypeScript types | Does not test runtime behaviour |
| `scripts/selfcheck.ts` | SHA-256, seed balance, chain, subledger proofs, statements | Seed-specific; not in CI; not in package scripts |
| `scripts/selfcheck-actions.ts` | Serial allocation, sale/purchase journals, reversal, locked period, idempotency | Does not test document/subledger updates, credit notes, partial payments, duplicate reversal |
| `scripts/selfcheck-import.ts` | Import pipelines, validation, chain survival, audit pack | Does not test stock/challan updates, duplicate-in-batch, server transactions |
| `scripts/gate.ts` | Combined engine checks and audit pack | Writes artifacts; not automated; uses the same assumptions as the engine |
| Golden suite | 25 tax vectors | Expected values are derived from the same rule assumptions; no independent statutory oracle |
| Dictionary parity | 1,222 keys match | Does not prove UI coverage or translation quality |

### 19.2 Test pyramid

**Unit tests (fast, many)**

- Money parsing, formatting, rounding, lakh/crore, Bangla digits, negative values, big values.
- Tax engine for every rule, condition, rate, effective date, missing evidence and manual-review path.
- Journal validation: unbalanced, zero lines, negative amounts, unknown accounts, locked period, duplicate idempotency.
- Period resolution: open/closed/locked/unknown.
- Document numbering and serial allocation under concurrency.
- Reversal: linked, duplicate, reversed journal, document group.
- Allocation: partial, multiple invoices, overpayment, write-off.
- Stock: receipt, issue, weighted average, negative policy, returns.
- IFRS/report totals and balance checks.

**Property-based tests**

- Any combination of balanced journal lines must round-trip through serialization and preserve totals.
- Sum of debits equals credits after any valid posting sequence.
- Trial balance always balances after any sequence of valid postings and reversals.
- A document plus its reversal has zero net effect on every account and stock quantity.
- No sequence allocation returns the same number twice under concurrent requests.

**Integration tests**

- API + PostgreSQL with a real database (Testcontainers or a disposable schema).
- Auth flows, invitations, password reset, session expiry, MFA.
- Tenant isolation: user A cannot read/write company B.
- Permission matrix for every role and endpoint.
- Posting transaction rollback on failure.
- Unique constraints and idempotency.
- Migrations from empty and from the previous schema version.
- Import commit/rollback.
- Period close/lock/reopen.
- Audit log completeness.

**End-to-end tests (Playwright)**

- Sign in, create company, configure period, load COA, enter opening balances.
- Create and post a sales invoice; receive partial payment; see AR ageing.
- Create a credit note linked to the invoice; see 6.7 and stock return.
- Create PO, GRN, bill, payment, challan, certificate.
- Import a bank statement and reconcile.
- Prepare VAT return and resolve a variance.
- Close period with maker-checker; attempt a posting after lock; reopen with reason.
- Invite an auditor; verify read-only.
- Export and restore a backup.
- English/Bangla switch on every critical screen.

**Accessibility tests**

- Automated axe scan on every main page.
- Keyboard-only journey.
- Screen-reader labels for forms, tables and dialogs.
- Contrast and zoom checks.

**Performance tests**

- 100k journals, 10k parties, 5k items, 1k bank lines.
- Report queries under a defined budget.
- Import of 10k rows with progress and cancellation.
- Concurrent posting of 50 documents.

**Security tests**

- Auth bypass attempts, IDOR/tenant isolation, CSRF, XSS, SQL injection, file upload abuse, rate limits, export authorization.
- Dependency and container scans.
- Secret scanning.

**Migration and recovery tests**

- Restore a backup into a clean environment and reconcile.
- Rehearse point-in-time recovery.
- Test a failed migration rollback.

### 19.3 Test data and independence

- Do not generate expected tax amounts from the same engine under test. Use independently calculated vectors reviewed by a tax professional.
- Keep demo data deterministic and separate from production.
- Use synthetic customers/suppliers with clearly fake names; never use real PII.
- Test both English and Bangla strings, including long labels.
- Test negative, zero, maximum and decimal values.

### 19.4 CI gates

Every pull request must run:

1. Install with a lockfile.
2. Lint and format check.
3. TypeScript build (frontend, server, shared packages).
4. Unit tests.
5. Integration tests with PostgreSQL.
6. E2E smoke tests.
7. Accessibility smoke test.
8. Dependency/security scan.
9. Build and bundle-size check.
10. Migration check.

No merge if a gate fails. No deployment without a green pipeline and a migration plan.

### 19.5 Quality acceptance criteria

- Critical accounting invariants have automated tests at both domain and API levels.
- Every role/permission combination has a test.
- Tenant isolation is tested with at least two companies and two users.
- Critical business journeys have E2E coverage.
- Accessibility checks are part of CI.
- A backup restore is demonstrated before production.
- The tax rule pack has an independent review record.
- No release notes claim a feature is complete unless its tests and acceptance criteria pass.

---

## 20. Performance, deployment, backup and recovery

### 20.1 Current performance profile

- Source: 51 files, 2.23 MB; 1.55 MB of TSX.
- Build log: 1,974 modules, 1.56 MB JS, ~483 KB gzip; no route splitting.
- `xlsx`, `framer-motion`, all 12 workspaces and decorative SVG components are in the main bundle.
- Every state change serialises the entire vault to localStorage and IndexedDB. This will become slow as journals grow.
- Tables render all filtered rows; no pagination or virtualisation.
- Reports derive from all journals in memory on every relevant state change.
- No performance budget, profiling, or load tests.

### 20.2 Performance targets

- Initial app shell on a mid-range Android phone over 4G: LCP < 2.5s, INP < 200ms, CLS < 0.1.
- Route-level code splitting: each major workspace lazy-loaded; `xlsx` loaded only in import/export flows; charts loaded only on dashboard/report pages.
- Main bundle budget: < 300 KB gzip for the initial authenticated shell (excluding lazy chunks).
- Table pages: server-paginated, < 500ms for a normal page; virtualise only if needed.
- Report queries: < 2s for 100k journal lines; use indexes and, if necessary, materialised views.
- Posting: < 500ms for a normal document, including tax calculation and constraints.
- Import: progress, cancellation and a bounded batch size.
- No synchronous full-state serialisation on user interactions.

### 20.3 Deployment topology

Recommended first production topology:

- One stateless API container (scale horizontally later).
- One PostgreSQL instance with managed backups (or a managed Postgres service).
- Object storage for attachments/backups (S3-compatible/MinIO).
- Reverse proxy/TLS (Caddy/Nginx or a cloud load balancer).
- Separate staging and production environments.
- Background worker for exports/imports/emails if needed.
- Centralised logs, metrics and error tracking.
- Secrets in a managed secret store, not `.env` committed to git.

Use Docker Compose for local/staging; a managed container platform or VPS with a clear runbook for production. Do not run PostgreSQL in the same container as the API for production.

### 20.4 Database operations

- Migrations are versioned, reviewed and tested against a copy of production-like data.
- Backward-compatible migrations first (add nullable column, backfill, then enforce).
- No destructive migration without a backup and a rollback plan.
- Indexes on company_id, period_id, posting_date, document_number, party_id, account_id, status and idempotency key.
- Partition very large journal/audit tables by company or period if needed later; do not prematurely partition.
- Monitor slow queries and lock contention.
- Use connection pooling.

### 20.5 Backup and recovery

**Targets (to be agreed with the business):**

- Recovery Point Objective (RPO): ≤ 15 minutes for transactional data; ≤ 24 hours for attachments if using object storage versioning.
- Recovery Time Objective (RTO): ≤ 4 hours for a regional outage; ≤ 1 hour for accidental deletion of a single company (logical restore).

**Requirements:**

- Daily encrypted full backup plus continuous WAL archiving/point-in-time recovery.
- Object storage versioning and lifecycle rules.
- Backups stored in a separate failure domain/region.
- Restore drills at least quarterly; document the result.
- A “company export” that can be restored independently.
- No backup is considered valid until a restore has been tested.
- Retention policy aligned with legal/accounting requirements and customer contracts.
- Access to backups restricted and audited.

### 20.6 Monitoring and operations

- Uptime and health checks for API, database, storage and background jobs.
- Error tracking with release/version and request trace IDs.
- Metrics: request latency, error rate, posting failures, queue depth, backup status, storage usage.
- Alerts for failed backups, failed migrations, high error rates, auth anomalies, disk/database saturation.
- Audit log retention and integrity monitoring.
- Runbooks for: service down, database down, failed deployment, compromised account, data loss, backup restore, certificate expiry.
- On-call/ownership and escalation path.

### 20.7 Release process

1. Feature branch → pull request.
2. CI gates pass.
3. Code review by a human for accounting/security-critical changes.
4. Staging deployment with migrations.
5. Smoke test and accountant UAT for the affected workflow.
6. Production deployment during a low-risk window.
7. Post-deploy verification: health, sample posting, report check, backup.
8. Rollback plan: previous image + reversible migration; restore only if necessary.
9. Release notes with known limitations.

### 20.8 Operational acceptance criteria

- A new environment can be provisioned from documented steps.
- Backups run automatically and restores are tested.
- The team can detect and respond to a failed posting, failed backup, or auth incident.
- The app meets the performance budget on a representative device/network.
- No production deployment depends on a developer’s laptop or an untracked local file.

---

## 21. Prioritized feature roadmap

### 21.1 Now: production MVP

| Priority | Capability | Why |
|---:|---|---|
| 1 | Server, database, auth, organisations, companies, memberships | Without this, nothing is safe or multi-user |
| 2 | Chart of accounts, fiscal years, periods, opening balances | Foundation for every transaction |
| 3 | General journal and posting engine with period controls | Accountants cannot operate without adjustments |
| 4 | Sales invoices, credit notes, receipts and AR allocation | Core revenue cycle |
| 5 | Purchase bills, GRNs, payments and AP allocation | Core spend cycle |
| 6 | Inventory for stock items, stock ledger and COGS | Required for trading businesses |
| 7 | Bank/MFS accounts, statement import and reconciliation | Cash control |
| 8 | VAT registers and draft 9.1, with GL proof | Core Bangladesh requirement |
| 9 | Trial balance, P&L, balance sheet, cash flow, AR/AP ageing | Management and statutory reporting |
| 10 | Period close, maker-checker, audit log, backups | Trust and control |
| 11 | Bilingual UI and professional design system | Adoption |
| 12 | Import/export, onboarding and support tooling | Migration and operations |

### 21.2 Next

- Fixed assets and depreciation.
- Payroll and Labour Act compliance (after legal review).
- Budgeting and variance.
- Multi-branch P&L, warehouse transfers, stock counts.
- Customer/supplier portals and email statements.
- Bank/MFS feeds.
- Approval workflows by amount/category.
- Recurring journals and allocations.
- Multi-company switching and consolidated reporting (design first).
- Attachments and document retention.
- Practice-firm cockpit (only with real multi-tenant backend).

### 21.3 Later

- Manufacturing: BOM, WIP, production orders, wastage, job costing.
- Multi-currency and FX revaluation.
- IFRS adjustments/multi-book with reconciliation.
- Group consolidation, intercompany eliminations, minority interests.
- Industry packs (RMG, pharma, construction, e-commerce).
- Advanced analytics, cash forecasting, scenario planning.
- Public API and partner integrations.
- E-invoicing/NBR integration where officially supported.

### 21.4 Not planned

- Autonomous AI posting of financial transactions without human review.
- A fabricated audit opinion or “audited” label.
- A 60-client practice cockpit before multi-tenancy is real.
- A blockchain/ledger gimmick.
- Decorative dashboards that do not answer an operational question.
- Feature breadth that outpaces accounting correctness.

### 21.5 Module disposition

| Module | MVP decision | Reason |
|---|---|---|
| W01 Dashboard | Rebuild small | Current cockpit is a demo collage; production needs an action-oriented home |
| W02 Sales | Rebuild on server | Core, but current workflow is unsafe |
| W03 Purchases | Rebuild on server | Core, but current workflow is unsafe |
| W04 Treasury | Rebuild after payments | Must be driven by actual liabilities |
| W05 VAT | Rebuild after ledger | Registers/returns must derive from posted data and verified rules |
| W06 Banking | Rebuild | Current reconciliation is not real |
| W07 Import/Export | Keep concept, rebuild | Valuable, but needs server transactions and stock/challans |
| W08 Statements | Keep engine, rebuild period/UI | Strong derivation, wrong labels/periods/audit claim |
| W09 Close | Rebuild | Current sign-offs are local/hard-coded |
| W10 Payroll | Defer | Not safe or complete |
| W11 Secretarial | Defer | Not core; hard-coded and local |
| W12 Rule lab | Internal/admin only | Useful diagnostics; not a customer workspace |
| W12 Firm cockpit | Defer | Requires real multi-client backend |
| Auth/onboarding | Replace | Current flow is a demo, not auth |
| Master data | Rebuild | Flat COA, unused opening balances, no audit |
| Composer | Defer or make review-only | Natural-language posting needs guardrails and user confirmation |

---

## 22. Detailed phase-by-phase implementation plan

The phases below are ordered by dependency and risk. Each phase must end with a green build, tests and a human-readable completion report. A phase is not “done” because code was written; it is done when its acceptance criteria are demonstrated.

### Phase 0 — Repository readiness and baseline

**Objective:** create a safe engineering baseline before changing behaviour.

**Problems addressed:** no git, no CI, no lint, no test script, no baseline evidence, no docs directory.

**Changes:**

- Initialise a Git repository and a clear `.gitignore` (node_modules, dist, local vault exports, secrets, OS files).
- Add `README.md` with setup/run/build/test instructions.
- Add `npm` scripts for `typecheck`, `test`, `lint`, `format:check`, `build`.
- Add ESLint/Prettier (or an equivalent minimal lint/format setup).
- Add Vitest and a first test harness; move the self-check logic into repeatable tests where practical.
- Add a GitHub Actions (or equivalent) pipeline for install → typecheck → test → build.
- Capture the current build, self-check and golden-suite outputs as the baseline.
- Add a short `docs/IMPLEMENTATION_NOTES.md` for phase reports (not a substitute for the two master documents).
- Do not change UI behaviour in this phase.

**Dependencies:** none.

**Acceptance:** clean clone installs; typecheck/test/build pass in CI; no application behaviour changes; the baseline is recorded; no secrets are committed.

**Tests:** CI pipeline itself; a trivial unit test; a build on a clean checkout.

**Risks:** adding tooling can expose existing failures. Do not hide them; record them.

**DoD:** repository is version-controlled and reproducible; every later phase can rely on CI.

### Phase 1 — Shared domain correctness hardening

**Objective:** fix the most dangerous pure-domain defects and lock them with tests before adding a server.

**Problems addressed:** duplicate reversal, locked/closed/unknown period, credit-note numbering, idempotency, document numbering, line-level tax computation, opening balance semantics, stock movement/negative stock, cash-flow plug, current comments that overstate correctness.

**Changes:**

- Make period resolution explicit: `OPEN`, `CLOSED`, `LOCKED`, `UNKNOWN`; reject unknown and non-open for posting.
- Add a document-level reversal model and duplicate-reversal guard; ensure a reversal cannot be reversed.
- Separate credit-note numbering/serial allocation from sales invoices; add original-document linkage in the domain types.
- Add a server-compatible posting command that accepts line-level tax facts and computes each line before document totals.
- Remove the “auto-settle” default from the domain; settlement is a separate command.
- Make opening balances a balanced batch with posting, not a mutable account field.
- Add stock movement commands; prevent negative stock or require an explicit policy/override.
- Remove the cash-flow plug or make it a blocking reconciliation error.
- Add tests for every fixed rule.

**Dependencies:** Phase 0.

**Acceptance:** all new tests pass; the old self-checks still pass or are updated with justification; the current demo can still render, even if some UI paths temporarily use the old adapters.

**Tests:** unit/property tests for reversal, periods, credit notes, idempotency, numbering, line tax, stock, reports.

**Risks:** changing domain types ripples into UI. Keep backward-compatible adapters where possible; do not do a giant rename.

**DoD:** the core invariants are enforced in pure functions and proven by tests.

### Phase 2 — Backend foundation

**Objective:** stand up the server, database and operational skeleton without moving business features yet.

**Problems addressed:** no backend, no DB, no migrations, no logging, no health checks.

**Changes:**

- Add `server/` with Fastify, configuration, structured logging, error handling and health endpoints.
- Add PostgreSQL and Drizzle; create the first migration for users, organisations, memberships, companies, periods, and audit events (minimal).
- Add Docker Compose for local Postgres and the API.
- Add environment validation and `.env.example`; no secrets committed.
- Add integration test harness against a disposable Postgres.
- Add database migration scripts and a rollback strategy.
- Keep the frontend unchanged and the demo working.

**Dependencies:** Phase 0.

**Acceptance:** `docker compose up` starts Postgres/API; health endpoint returns DB status; migrations apply cleanly; tests pass; no financial feature is exposed yet.

**Tests:** health, migration up/down, connection failure, configuration validation.

**Risks:** database choice/operations. Document the decision and backup plan.

**DoD:** a reliable server/database foundation exists and is reproducible.

### Phase 3 — Identity, organisations, memberships and invitations

**Objective:** replace the demo role switcher with real authentication and company-scoped membership.

**Problems addressed:** no password/session, default admin, role switching, no user management, no tenant isolation, data visible when signed out.

**Changes:**

- Implement users, Argon2id passwords, email verification, password reset, invitations, sessions, CSRF, rate limits and audit events.
- Add organisation/company membership and server-side authorization middleware.
- Build `/login`, `/accept-invitation`, `/forgot-password`, `/reset-password`, `/session-expired`.
- Add a company switcher that loads the selected company from the server (initially only one company per user in the UI).
- Remove the role switcher from the production UI; retain a clearly labelled demo mode only if it uses isolated demo data and no real auth.
- Add tests for every role and cross-tenant access.

**Dependencies:** Phase 2.

**Acceptance:** no financial data without a session; a user can only access companies they belong to; role changes require admin and are audited; auditor is read-only at the API; app opens on login, not the dashboard.

**Tests:** auth flows, invitation expiry, password reset, session revocation, role matrix, tenant isolation, CSRF, rate limits.

**Risks:** email deliverability; invitation UX. Use a test email adapter in CI.

**DoD:** authentication and access control are real, server-enforced and tested.

### Phase 4 — Company onboarding, chart of accounts and periods

**Objective:** make it possible to create and configure a real company. Opening-balance capture is prepared here but cannot be marked posted until the ledger service exists in Phase 5.

**Problems addressed:** demo onboarding, hard-coded periods, no COA import, no company settings, no bank/cash account setup.

**Changes:**

- Server-backed company setup wizard.
- Fiscal year/period generation with explicit statuses.
- Chart of accounts CRUD with hierarchy, control accounts and tax mappings; CSV/XLSX import.
- Opening-balance **batch data model and entry screen**: AR/AP/inventory/fixed asset/equity schedules, debit/credit totals, balance check and evidence. It remains DRAFT until Phase 5 posts it through the ledger service.
- Bank/cash/MFS account setup with GL mapping and opening balances.
- Company settings: numbering, approval thresholds, language, time zone, reporting framework.
- Audit all setup changes.

**Dependencies:** Phase 3.

**Acceptance:** a new company can be created, resumed, and completed; the opening batch can be entered, validated, saved and balanced; no data from another company is visible; periods reject unknown dates. **The opening batch is not marked POSTED in this phase.**

**Tests:** onboarding E2E, opening batch balance/imbalance validation, COA import validation, period generation, cross-company isolation.

**Risks:** importing messy real-world COAs. Provide templates and clear errors. Avoid a fake “posted” state before the ledger exists.

**DoD:** a real company can be configured with a validated, balanced opening batch ready for ledger posting.

### Phase 5 — Server-authoritative ledger, general journal and opening balances

**Objective:** move the ledger to the server, give accountants a proper general journal, and post the opening-balance batch atomically.

**Problems addressed:** no journal UI, browser-only ledger, no atomic posting, no audit log for journals, no period enforcement, no account balances API, opening balances stored but not posted.

**Changes:**

- Server account balances, trial balance and journal endpoints.
- Posting service with transaction, idempotency, period lock, unique numbering and audit events.
- General journal UI: multi-line, debit/credit, account picker, party/cost centre, narration, attachment, preview, submit/approve/post.
- Opening-balance posting through the same ledger service, with approval and a permanent link to the batch/evidence.
- Journal detail with lines, source, status, reversal link and audit trail.
- Reversal command at journal-group level; no duplicate reversal.
- Period close/lock API; no posting to CLOSED/LOCKED/UNKNOWN.
- Read-only auditor access.

**Dependencies:** Phase 4.

**Acceptance:** a manual journal posts atomically; the opening batch posts atomically and balances; unbalanced/duplicate/locked entries are rejected; trial balance agrees; reversal links and blocks duplicates; every action is audited; a second user sees the result.

**Tests:** API integration, posting failure rollback, idempotency, concurrency, permissions, period states, reversal, audit log, opening batch posting/repost prevention.

**Risks:** migrating existing seed journals; use an import/validation step. Do not allow an opening batch to post twice.

**DoD:** the ledger is server-authoritative, the accountant has a usable journal screen, and the opening position is genuinely posted.

### Phase 6 — Master data and inventory

**Objective:** make parties, items, warehouses and stock movements reliable.

**Problems addressed:** flat masters, unused opening balances, no stock ledger/warehouse, stock changes only on invoice/bill, no inventory-to-GL proof.

**Changes:**

- Party CRUD with BIN/TIN validation, credit terms, status, opening items.
- Item CRUD with unit, HS code, tax category, inventory/expense account, status.
- Warehouse CRUD and branch mapping.
- Stock movement service: opening, GRN, issue, transfer, adjustment, return; weighted average; negative-stock policy.
- Stock ledger, stock valuation and inventory control proof.
- Master-data audit events and permission checks.

**Dependencies:** Phase 5.

**Acceptance:** a GRN increases stock; an issue decreases stock; COGS/inventory post correctly; negative stock is blocked or explicitly approved; stock valuation reconciles to GL; a party/item can be deactivated but not silently deleted.

**Tests:** quantity/cost math, weighted average, negative stock, transfer, return, control proof, permission.

**Risks:** unit precision (kg/metres); use decimal quantities (not integer rounding) and document it.

**DoD:** inventory is a real subledger, not a display quantity.

### Phase 7 — Sales, credit notes and receivables

**Objective:** implement a correct order-to-cash flow on the server.

**Problems addressed:** local drafts, ignored line tax, credit-note serials, auto-settlement, missing AR allocation, reversed docs in VAT, document number reuse.

**Changes:**

- Persist quotations, sales orders, delivery challans and invoices (or, if the MVP simplifies, support draft → posted invoice and explicitly defer quote/order/challan; do not fake them).
- Line-level tax calculation and document totals; tax decision snapshot.
- Separate invoice posting and customer receipt; no auto-settlement.
- Credit-note type, 6.7 series, original invoice link, stock/COGS reversal, approval.
- AR open items and allocation; partial/multiple receipts; unapplied cash.
- Customer statements and ageing.
- Document-level reversal.
- Status timeline and audit trail.

**Dependencies:** Phase 6, Phase 5.

**Acceptance:** invoice → partial receipt → balance → credit note → balance; AR ageing and control account agree; VAT register excludes reversed documents; credit note does not consume 6.3; stock and COGS reverse correctly; drafts survive refresh.

**Tests:** E2E sales journey, multi-rate tax, credit note limits, partial/multiple allocation, duplicate posting, reversal, VAT register, permissions.

**Risks:** scope of quote/order/challan. If not fully implemented, hide it rather than showing fake stages.

**DoD:** a sales invoice and receipt can be trusted in real books.

### Phase 8 — Purchases, GRN, bills and payables

**Objective:** implement a correct procure-to-pay flow.

**Problems addressed:** local GRN, missing TIN preview mismatch, fabricated supplier 6.3, inventory misclassification, no AP allocation, no challans.

**Changes:**

- Server purchase order/GRN/bill flow if retained; otherwise a bill + receipt model with explicit limitations.
- Line-level expense/inventory account and tax.
- 3-way match with per-line quantities/prices, evidence, variance reason and approval.
- Supplier Mushak 6.3 evidence field/attachment; no auto-fabricated evidence.
- Missing e-TIN handling on the actual posting.
- AP open items and allocation; partial payments.
- VDS/TDS liability creation and challan/certificate records on payment.
- Purchase return/debit note (basic).
- Document-level reversal.

**Dependencies:** Phase 7, Phase 6.

**Acceptance:** PO → GRN → bill → partial payment → challan; stock and GL agree; 3-way variance requires approval; missing TIN changes the posted withholding; no fake supplier serial; AP ageing agrees.

**Tests:** E2E purchase journey, 3-way match per line, override audit, TIN, VDS/TDS, stock, AP allocation, reversal.

**Risks:** complexity of 3-way matching. Start with exact match and a controlled override; do not pretend to support complex partial receipts until implemented.

**DoD:** a purchase bill and payment can be trusted in real books.

### Phase 9 — Receipts, payments, treasury and certificates

**Objective:** connect settlement to subledgers and statutory records.

**Problems addressed:** manual receipts not linked, no challans, synthetic certificates, duplicate payments, no bank-file generation.

**Changes:**

- Receipt/payment screens with allocation, bank account, reference, date, attachment.
- Unapplied cash and advance handling.
- Treasury challan creation from withholding, batch deposit, economic code, bank/branch, evidence.
- Certificate records linked to source documents and challans; print/export.
- Payment approval thresholds and maker-checker.
- BEFTN/bKash file generation later; do not claim disbursement.
- Reconciliation to GL and subledger.

**Dependencies:** Phase 8.

**Acceptance:** a payment creates AP allocation and challan liabilities; a deposit clears the liability and links a certificate; duplicate payment is blocked; AR/AP/VDS/TDS control proofs agree; certificates contain the correct base/tax amount.

**Tests:** allocation, over/underpayment, duplicate, challan batch, certificate linkage, control proofs, approval.

**Risks:** statutory certificate format. Mark as draft until verified.

**DoD:** settlement and treasury are connected, not separate demos.

### Phase 10 — Banking, MFS and reconciliation

**Objective:** make bank/MFS reconciliation a real control.

**Problems addressed:** seeded statement lines, auto-matched entries, no import, amount-only matching, local fee state, no GL creation.

**Changes:**

- Bank account CRUD and transfers.
- Statement import with column mapping, duplicate detection, file retention.
- Matching by amount/date/reference, unique journal use, confidence score and manual override.
- Split/partial matching and multi-line matching where needed.
- Create GL journal from an unexplained statement line with approval.
- MFS fee handling configurable, not a fixed 1.5%.
- Reconciliation report, period sign-off, audit trail.

**Dependencies:** Phase 9.

**Acceptance:** import a statement; match lines; no journal can match twice; fee posts once; unexplained lines go to a reviewed queue; reconciliation report agrees to bank GL; period close uses the reconciliation.

**Tests:** import mapping, duplicate detection, matching score, double-match prevention, fee idempotency, create-GL, permissions.

**Risks:** bank formats vary. Start with a simple CSV template and iterate.

**DoD:** cash can be reconciled with evidence.

### Phase 11 — Reports, VAT registers and financial statements

**Objective:** replace fixed-period demo reports with correct, selectable reports.

**Problems addressed:** hard-coded October, reversed docs in VAT, monthly-vs-annual labels, cash-flow plug, fake audit opinion, no drill-down for all lines.

**Changes:**

- Period/date selectors and company/branch scope on every report.
- Trial balance, GL, P&L (month/YTD/year), balance sheet, cash flow, equity, AR/AP ageing, stock valuation.
- VAT registers and draft 9.1 with GL proof and exception blocking.
- Report-to-journal-to-document-to-tax-decision drill-down.
- Export/print with DRAFT/UNAUDITED labels; remove the auditor’s report.
- Performance indexes and pagination.

**Dependencies:** Phase 10.

**Acceptance:** a November transaction appears in November reports; a reversed invoice disappears from the VAT register and output tax; P&L labels the exact range; balance sheet/cash flow checks block export on failure; exports match on-screen totals.

**Tests:** period boundaries, reversals, credit notes, multi-rate tax, comparatives, drill-down, export parity, performance.

**Risks:** report semantics; have an accountant sign off each report definition.

**DoD:** reports are trustworthy for management and audit preparation.

### Phase 12 — Close, approvals, controls and audit log

**Objective:** make month-end close and internal control real.

**Problems addressed:** local sign-offs, hard-coded names, CLOSED loophole, unused high-value approval, no audit log, no override evidence.

**Changes:**

- Persisted close run with checklist, control proofs, exceptions, evidence and sign-offs.
- Maker-checker using real users; no self-approval.
- Approval thresholds, segregation of duties, override reasons.
- Period status enforcement at the database/API; reopen with permission/reason/audit.
- Immutable audit log and viewer/export.
- Suspense policy: target account, reason, approval; no one-click retained-earnings write-off.
- Close pack export.

**Dependencies:** Phase 11.

**Acceptance:** a period cannot close with failing checks; maker ≠ checker; posting after lock is rejected; every sign-off is persisted and visible; the audit log reconstructs the close; reopen requires reason and is audited.

**Tests:** close happy path, failed check, self-approval rejection, lock enforcement, reopen, audit completeness, permissions.

**Risks:** workflow complexity. Keep the MVP close checklist to the controls that actually exist.

**DoD:** the close is a controlled, evidence-backed process.

### Phase 13 — Public landing page and design system foundation

**Objective:** establish a credible public identity and a reusable professional UI system.

**Problems addressed:** no landing page, generic AI-dashboard look, inconsistent components, tiny text, decorative clutter.

**Changes:**

- Implement the Quiet Ledger tokens, typography, spacing and core components.
- Build the public landing page with real product screenshots and honest claims.
- Build login/forgot/reset/invite pages.
- Add a component gallery or internal design page with states.
- Add accessibility and responsive baselines.
- Remove decorative SVG/aurora/grain from operating screens.
- Do not redesign every workspace yet; establish the system and apply it to auth/landing plus 2–3 core screens.

**Dependencies:** Phase 3 for auth pages; can start in parallel with later feature phases if design work is isolated.

**Acceptance:** landing page loads fast, makes no false claims, and leads to a working demo/trial; auth pages are accessible; the design system is documented and used consistently on the first screens.

**Tests:** Lighthouse/accessibility, responsive screenshots, link/CTA tests.

**Risks:** visual work can distract from accounting correctness. Keep it time-boxed and behind a design gate.

**DoD:** the product has a credible public face and a design system, not just a skin.

### Phase 14 — Application shell, dashboard and workflow UX

**Objective:** make the authenticated product fast to learn and use with the new design system.

**Problems addressed:** crowded dashboard, 12 equal workspaces, poor task guidance, tiny tables, modal overload, no global search.

**Changes:**

- New role-aware navigation with a smaller top-level model.
- Action-oriented dashboard: cash, overdue AR/AP, tax due, approvals, close status, exceptions.
- Route-based document pages with autosave, review and sticky actions.
- Rebuilt tables/forms/dialogs using the design system.
- Global search and command palette for entities/actions.
- Empty/loading/error/permission states.
- Responsive behaviour and keyboard shortcuts.
- Contextual help and onboarding checklist.

**Dependencies:** Phase 13, Phases 5–12 for the underlying features.

**Acceptance:** a new accountant can complete invoice, receipt, bill, payment, journal and close without training; every screen has a clear next action; keyboard and mobile basics work; no fake screens.

**Tests:** E2E journeys, accessibility, responsive, usability sessions with 2–3 accountants.

**Risks:** scope. Redesign only screens whose workflows are already server-backed and correct.

**DoD:** the product is usable, not merely presentable.

### Phase 15 — Localization, hardening, performance and release readiness

**Objective:** close the gap between a working product and a dependable release.

**Problems addressed:** inline strings, translation quality, bundle size, test gaps, security, backups, operations.

**Changes:**

- Complete the translation-key migration and native review.
- Self-host fonts; remove external dependencies where required.
- Route-level code splitting; lazy-load XLSX/charts.
- Full test suite, security review, performance test, accessibility audit.
- Backup/restore drill, incident runbooks, monitoring/alerts.
- Dependency updates and vulnerability remediation.
- Migration rehearsal, UAT with accountants, release checklist.
- Documentation: admin guide, accountant guide, support playbook, API docs.

**Dependencies:** all prior phases.

**Acceptance:** CI green; no critical/high security findings; accessibility target met; performance budget met; backup restore demonstrated; UAT sign-off; no critical accounting defect open; support and rollback plans ready.

**Tests:** full regression, load, security, restore, UAT.

**Risks:** release pressure. Do not waive accounting/security gates.

**DoD:** the product can be operated by a real customer with support and recovery.

---

## 23. Risks, dependencies and mitigation strategies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Regulatory content is wrong or outdated | High | Critical | Treat all current rules as unverified; require tax counsel sign-off; version rules; display review status; block unapproved rules; monitor official sources |
| Scope remains 12 workspaces before core is correct | High | High | Enforce MVP scope; hide/defer payroll, secretarial, practice cockpit, manufacturing; one release gate per phase |
| Data loss during migration or browser use | High | Critical | Server source of truth; backups/PITR; export before destructive actions; remove persona wipe; migration dry run |
| Accounting bug reaches real books | Medium | Critical | Domain tests, property tests, API integration, DB constraints, accountant UAT, reversal/repair runbook |
| Double posting/duplicate payments | High | High | Idempotency keys, unique constraints, transaction, duplicate detection, approvals |
| Tenant data leak | Medium | Critical | Company-scoped queries, membership checks, RLS/defence in depth, isolation tests |
| Auth/user management is rushed | High | Critical | Dedicated phase; security review; no role switching in production |
| Model writes code faster than it verifies | High | High | Strict phase gates; tests; stop conditions; human review of accounting/security changes |
| Localization feels machine-translated | Medium | High | Native accountant review; glossary; screenshot review; no literal translation |
| Visual redesign delays core work | Medium | Medium | Design system phase after core; time-box; do not restyle fake workflows |
| Performance degrades with real data | Medium | High | Pagination, indexes, code splitting, load tests, query budgets |
| Bank/MFS formats vary | High | Medium | Start with CSV template; mapping UI; manual exception queue |
| Attachment/file security | Medium | High | Object storage, scanning, MIME/size limits, signed URLs, access checks |
| Email deliverability | Medium | Medium | Reputable provider, SPF/DKIM/DMARC, test adapter, fallback contact |
| Hosting/data residency requirements | Medium | High | Confirm with customers; support self-hosted/regional deployment; document data location |
| Key-person dependency | Medium | High | Documentation, ADRs, runbooks, code review, no hidden local setup |
| Users resist new workflow | Medium | High | Involve accountants early; guided mode; migration support; preserve familiar Excel exports |
| Backup exists but restore fails | Medium | Critical | Quarterly restore drills; restore into clean environment; record evidence |

### 23.1 Human dependencies

- A qualified Bangladeshi accountant/tax practitioner to review rules, reports, VAT return layout and terminology.
- A labour-law/payroll specialist before payroll.
- A security reviewer before production.
- A product owner to enforce scope and reject feature sprawl.
- 2–3 pilot customers/accountants for UAT.
- Hosting/domain/email decisions.

### 23.2 Technical dependencies

- PostgreSQL and a reliable hosting environment.
- Email provider.
- Object storage.
- CI/CD runner.
- Monitoring/error tracking.
- Domain name/TLS.
- Backup storage in a separate failure domain.

---

## 24. Acceptance criteria and definition of a production-ready product

### 24.1 Functional acceptance

- A new organisation can onboard, configure a company, load a COA, enter balanced opening balances, invite users and post a first invoice without developer help.
- Sales, credit notes, receipts, purchases, GRNs, bills, payments, journals, inventory, banking and VAT preparation work end-to-end on the server.
- Every document has a clear lifecycle, permission rules, audit trail, correction path and report impact.
- No feature is a dead end: every button either works, is disabled with an explanation, or is removed.
- No screen displays demo data unless the environment is explicitly labelled DEMO.

### 24.2 Accounting acceptance

- Every posted journal balances and is immutable.
- Trial balance, balance sheet and cash flow reconcile; differences block close/export.
- AR/AP/inventory/VAT/VDS/TDS control accounts reconcile to their subledgers.
- Credit notes are distinct 6.7 documents linked to the original sale.
- Receipts/payments allocate correctly, including partial and multiple allocations.
- Stock movements and COGS agree to the inventory GL.
- Reversals are complete, linked, approved and idempotent.
- Periods enforce OPEN/CLOSED/LOCKED/UNKNOWN correctly.
- Document and statutory numbers are unique and controlled.
- Tax decisions are stored with the rule pack version and can be explained.
- No fabricated audit opinion or filing acknowledgement exists.

### 24.3 Security acceptance

- Authentication, sessions, password reset, invitations, MFA for privileged roles and user management work.
- Authorization is server-side and company-scoped; no cross-tenant access.
- Auditor is read-only at the API.
- Passwords/secrets are not exposed; data is encrypted in transit and at rest.
- Exports/imports/attachments are permissioned and audited.
- Security review has no open critical/high findings.
- Audit log is complete and append-only for material actions.

### 24.4 UX and localization acceptance

- A new accountant can complete the core journeys with guided mode; an experienced accountant can work efficiently in Pro mode.
- English and Bangla are complete and reviewed; no missing visible strings.
- The interface meets WCAG 2.2 AA for the tested flows.
- Responsive layouts work at 360px, 768px and 1440px.
- Every form has validation, save state, error recovery and a review step before posting.
- Every table has pagination, filters, empty/loading/error states.
- The landing page is credible, honest, fast and accessible.

### 24.5 Operational acceptance

- CI is green; tests cover the critical journeys and invariants.
- Backups run automatically; a restore has been demonstrated.
- Monitoring/alerting is live; runbooks exist.
- Migrations are tested and reversible/backed up.
- Performance meets the budget on a representative device/network.
- Support and incident processes are documented.
- A pilot customer has completed an accounting period with UAT sign-off.

### 24.6 Release gate

Do not release if any of the following is true:

- A critical or high accounting-integrity defect is open.
- Any posting can create an unbalanced or duplicate journal.
- A user can access another company’s data.
- A signed-out or unauthorised user can read financial data.
- A period can be closed with a failed control proof.
- A fabricated audit opinion or false filing claim is present.
- A backup restore has not been demonstrated.
- The tax rule pack has not been reviewed and approved for the claims it presents.
- A critical/high security finding is open.
- The core workflows fail in UAT.

### 24.7 Definition of done for every phase

A phase is done only when:

1. The objective and scope are met.
2. The code is reviewed and merged.
3. Typecheck, lint, unit, integration, E2E (where relevant) and build pass.
4. Acceptance criteria are demonstrated with evidence.
5. Security and accounting impacts are reviewed.
6. Migrations are tested and reversible.
7. Documentation/runbooks are updated.
8. The completion report lists changes, files, tests, limitations and open questions.
9. The phase stops; no automatic move to the next phase.

---

## Appendix A — Evidence index

| Area | Files / symbols |
|---|---|
| App boot and routing | `src/main.tsx`, `src/App.tsx`, `src/workspaces/registry.tsx` |
| Global state, auth, actions | `src/context/VaultContext.tsx` |
| Persistence | `src/core/storage/vaultDb.ts` |
| Money | `src/core/money.ts` |
| Domain types | `src/core/types.ts` |
| Ledger and audit chain | `src/core/ledger/ledgerEngine.ts` |
| Seed data and periods | `src/core/ledger/seedData.ts` |
| Tax rules and engine | `src/core/tax-engine/rulePack.ts`, `engine.ts`, `goldenSuite.ts` |
| Financial statements | `src/core/ifrs-engine/ifrsEngine.ts` |
| Import/export | `src/core/import-export/xlsxEngine.ts` |
| Localization | `src/core/i18n.ts`, `src/core/locales/*` |
| Auth/onboarding UI | `src/components/auth/AuthAndOnboardingModal.tsx` |
| Shell/navigation | `src/components/layout/Sidebar.tsx`, `TopBar.tsx`, `CommandPalette.tsx`, `WorkspaceNav.tsx` |
| Master data | `src/components/modals/MasterDataModal.tsx` |
| Commercial primitives | `src/components/commercial/CommercialShared.tsx` |
| Tax advisor | `src/components/signature/TaxAdvisorCard.tsx` |
| Composer | `src/components/signature/TransactionComposer.tsx` |
| Ledger lens | `src/components/signature/LedgerLensModal.tsx` |
| Print/statutory | `src/components/signature/StatutoryPrintModal.tsx` |
| W01 | `src/workspaces/W01_ExecutiveCockpit.tsx` |
| W02 | `src/workspaces/W02_SalesMushak63.tsx` |
| W03 | `src/workspaces/W03_PurchasesWithholding.tsx` |
| W04 | `src/workspaces/W04_TreasuryChallans66.tsx` |
| W05 | `src/workspaces/W05_VatRegisters91.tsx` |
| W06 | `src/workspaces/W06_BankingMfsReconcile.tsx` |
| W07 | `src/workspaces/W07_MassImportExportStudio.tsx` |
| W08 | `src/workspaces/W08_IfrsStatementsStudio.tsx` |
| W09 | `src/workspaces/W09_CloseAndControl.tsx` |
| W10 | `src/workspaces/W10_PayrollLabourSuite.tsx` |
| W11 | `src/workspaces/W11_SecretarialGovernance.tsx` |
| W12 | `src/workspaces/W12_RulePackAndCoreLab.tsx`, `W12_FirmCockpit.tsx` |
| Design system | `src/index.css`, `tailwind.config.js` |
| Build/tests | `package.json`, `scripts/*.ts`, `build.log` |

## Appendix B — Critical defect register

| ID | Severity | Defect | Evidence | Required fix | Phase |
|---|---|---|---|---|---|
| C-01 | Critical | No authentication; default authenticated admin; username-only sign-in; role switching | `VaultContext.tsx:339`, `587–613`; `AuthAndOnboardingModal.tsx:367–375`, `648–666` | Real auth, sessions, server-side roles; remove production role switcher | 3 |
| C-02 | Critical | Browser-only system of record; no server/database | `vaultDb.ts`; `VaultContext.tsx:636–664` | Server + PostgreSQL; server-authoritative ledger | 2–5 |
| C-03 | Critical | Persona/company switch and onboarding wipe financial state | `VaultContext.tsx:835–858`, `1833–1850`; `TopBar.tsx:190–193` | Real company IDs, server data, confirmation, never reset | 3–4 |
| C-04 | Critical | Hard-coded October periods and dates; new transactions default November | `W02:87–89`; `W03:90–92`; `VaultContext:709`; `App:270`; `W01:48` | Period/date selectors; derive from company configuration; no hard-coded dates | 11, 14 |
| C-05 | Critical | CLOSED periods accept postings; unknown periods open | `ledgerEngine.ts:271–285`; `seedData.ts:504–509` | Explicit period states; reject non-OPEN; require configured period | 1, 5, 12 |
| C-06 | Critical | Sales/purchase drafts, orders, challans, GRNs are local React state | `W02:648`, `700–711`; `W03:699`, `755–778` | Persist server-side drafts; do not show fake lifecycle stages | 7, 8 |
| C-07 | Critical | Credit notes consume 6.3 serials and use invoice numbering | `VaultContext:905–907`; `W02:829–861`; `ledgerEngine:669–687` | Separate 6.7 type, series, original link, stock/cost reversal | 1, 7 |
| C-08 | Critical | Receipts/payments do not settle documents/subledgers | `W02:995–1061`; `W03:1228–1310` | Allocation model; update open items in one transaction | 7, 8, 9 |
| C-09 | Critical | New payments do not create challans/certificates | `VaultContext:888–1052`; W03 payment path | Create liabilities/challans on withholding; link certificates | 8, 9 |
| C-10 | Critical | Synthetic 6.6 certificate with `amount × 20` | `W04:128–149` | Persist certificate; derive base/tax from source document; verify format | 9 |
| C-11 | Critical | VAT registers include reversed documents | `W05:181–212`; reversal does not update docs | Filter by posted/reversed status; update registers transactionally | 11 |
| C-12 | Critical | Fabricated independent auditor’s report and “audited” labels | `StatutoryPrintModal:1412–1475`; `W08:754` | Remove auditor report; label management accounts unaudited | 11 |
| C-13 | Critical | Reversal is single-journal, can duplicate, does not restore linked effects | `VaultContext:1098–1133`; `ledgerEngine:576–638` | Document/group reversal, duplicate guard, stock/subledger links | 1, 5, 7, 8 |
| C-14 | Critical | Document/journal numbering from array length; no uniqueness | `VaultContext:902–904`; `ledgerEngine:527–569` | Sequence tables, unique constraints, transactional allocation | 1, 5 |
| C-15 | High | Per-line tax categories ignored; header rate applied to total | `W02:841–846`; `postCommercialDoc`; `buildCommercialDoc` | Line-level tax calculation and totals | 1, 7, 8 |
| C-16 | High | Purchase input VAT evidence auto-fabricated | `VaultContext:905–907`; `buildCommercialDoc:920` | Require supplier 6.3 evidence; never auto-generate statutory proof | 8 |
| C-17 | High | VDS/TDS rates inconsistent/unverified; UI shows 4.5%/5% vs 15% engine | `rulePack:70–89`; W03:160 | Verify rates; configurable rules; consistent UI | 1, 8, 11 |
| C-18 | High | Missing-e-TIN toggle not applied on posting | `W03:689`, `728`, `1086–1113` | Pass actual tax facts to posting; preview = posted | 8 |
| C-19 | High | Inventory unsafe: GRN/challan no movement, negative stock, no GL proof | `W02:944–972`; `W03:1126–1153`; `engine.ts:1174–1195`; `reconcileSubledgers` | Stock ledger, warehouse, negative policy, control proof | 6, 8 |
| C-20 | High | Master-data opening balances not posted | `MasterDataModal:480–500`; `VaultContext:1717–1721`; `ifrsEngine` journals only | Balanced opening batch, approval, posting | 4 |
| C-21 | High | No general journal UI; no depreciation/accrual adjustments | `postManualJournal` only internal; no screen | Build general journal and adjusting entries | 5 |
| C-22 | High | No user management/invites/password reset/session | `AuthAndOnboardingModal` seeded users only | Real identity lifecycle | 3 |
| C-23 | High | No audit log; local hash chain only | `ledgerEngine:206–238`; no event log | Immutable audit events, viewer, export | 12 |
| C-24 | High | Close sign-offs local/hard-coded; maker-checker toggle | `W09:101–104`, `334–338` | Persisted close run, real users, server enforcement | 12 |
| C-25 | High | High-value approval permission unused | `types.ts:969`; `VaultContext:98`; no call site | Approval engine + thresholds + audit | 12 |
| C-26 | High | Bank reconciliation not real: no import, duplicate matching, local fee state | `W06:107–149`, `191–241`; `VaultContext:1351–1385` | statement import, dedupe, matching, create-GL | 10 |
| C-27 | High | Import duplicate warning is postable; no stock/challan integration | `xlsxEngine:418–426`, `937–990`; `VaultContext:1397–1464` | Block duplicates; integrate stock/challans; server batch | 6–9 |
| C-28 | High | Payroll can be posted twice; no employee master/persistence | `W10:90`, `220–249` | Persist payroll runs, idempotency, approval; defer if not ready | Deferred |
| C-29 | Medium | Secretarial data local/hard-coded | `W11:112–117`, `137–169`, `383` | Persist or defer | Deferred |
| C-30 | High | Monthly statements labelled annual | `ifrsEngine:417`; `StatutoryPrintModal:1423`, `1558` | Correct range labels; period selectors | 11 |
| C-31 | High | Cash-flow plug disguises differences | `ifrsEngine:887–898` | Block on difference; no plug in statutory output | 1, 11 |
| C-32 | High | No test runner/CI/lint/git | `package.json`; no `.git` | Engineering baseline | 0 |
| C-33 | High | No CSP/security headers; plaintext local PII; unrestricted export | `index.html`; `vaultDb`; `TopBar` export | Security controls, permissioned exports | 3, 15 |
| C-34 | High | No attachments/evidence | none | Object storage + linked evidence | 9, 15 |
| C-35 | High | No AR/AP allocation/partial/statement | W02/W03 full only | Allocation/subledger | 7, 8 |
| C-36 | High | No multi-company/branch isolation; persona switch | global `VaultState` | company_id schema + server | 2–4 |
| C-37 | Medium | Currency support is cosmetic | `Currency` type; BDT-only tenant | Remove unsupported UI or implement FX later | Later |
| C-38 | Medium | Tiny text/decorative UI hurts daily use | `index.css:413–417`, `457–465`; Lumen tokens | Quiet Ledger redesign | 13–14 |
| C-39 | Critical | No landing page; app opens on dashboard | `App.tsx:89–95`; no router | Public site + auth routes | 13 |
| C-40 | High | Rule pack effective dates not enforced; static pending review | `engine.ts:349–354`; `rulePack.ts` | Versioned rules, effective dates, reviewer status | 1, 11 |
| C-41 | High | `postJournal` accepts invalid dates/unknown periods | `ledgerEngine:271–285`, `467–570` | Server date/period validation | 1, 5 |
| C-42 | High | Export/import whole vault without backup/confirmation | `VaultContext:1866–1911`; `TopBar` | Permissioned, audited, backed-up migration | 3–4 |
| C-43 | Medium | W12 practice cockpit is a seeded 60-client demo | `W12_FirmCockpit` | Hide/defer until real multi-tenant | Deferred |
| C-44 | High | No fixed assets/depreciation; close step cannot pass | no module; `W09` | Defer close step or implement fixed assets | Later |
| C-45 | High | Save failures swallowed; no last-saved state | `VaultContext:413–415` | Surface save status, retry, server draft | 2–4 |
| C-46 | Medium | Google Fonts external dependency | `index.html` | Self-host fonts | 13–15 |

## Appendix C — Verification log

| Check | Command / method | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` | Passed, no output |
| Seed journal balance | `scripts/selfcheck.ts` | 62 journals, all balanced, total 14,049,502,935 poisha |
| SHA-256 correctness | `scripts/selfcheck.ts` | Matches Node `crypto` for ASCII/Bangla/long strings |
| Audit chain | `scripts/selfcheck.ts` | Valid over 62 journals; one-poisha tamper breaks it |
| Subledger proofs | `scripts/selfcheck.ts` | Six controls reconcile to zero in the seed |
| Statements | `scripts/selfcheck.ts` | Three book filters balance; cash flow reconciles in the seed |
| Action checks | `scripts/selfcheck-actions.ts` | Serial, sale/purchase, reversal, locked period, idempotency pass |
| Import checks | `scripts/selfcheck-import.ts` | Four pipelines validate; chain survives; audit pack writes |
| Golden tax suite | Bundled `goldenSuite.ts` | 25/25 pass |
| Dictionary parity | Bundled `i18n.ts` | 1,222 EN / 1,222 BN, no missing keys |
| Browser smoke | Vite dev server + browser | App rendered, no console errors observed |
| Bundle | `build.log` | 1,974 modules, ~1.56 MB JS, ~483 KB gzip in logged build |

**Important limitation:** these checks validate internal consistency and the seeded demo. They do not prove production correctness, multi-user behaviour, security, or statutory accuracy.

## Appendix D — Open decisions requiring human input

1. Which legal entity/regulatory claims are actually approved for the first release? Who signs off the rule pack?
2. Is the first release single-company or multi-company? Is multi-branch needed at launch?
3. Which host/deployment region and data-residency commitments are required?
4. Which email provider and domain will be used for invitations/reset?
5. Which bank/MFS statement formats should be supported first?
6. Is self-service trial registration required, or is onboarding sales-led/invite-only?
7. Which roles/approval thresholds does the first pilot customer need?
8. Are attachments required at launch, or can they be phase 2?
9. Which reports must be printed/filed first, and who reviews their layout?
10. What is the acceptable RPO/RTO and backup retention?
11. Is payroll in scope for the first customer? If yes, who is the labour-law reviewer?
12. Which pricing/packaging model is intended (per company, per user, per module)?
13. What is the brand decision: keep “LedgerVault”, rename, or use a sub-brand under Fintuity?
14. What is the migration source for pilot customers (Excel, Tally, QuickBooks, manual)?

## Appendix E — Glossary

- **Accrual:** an expense or revenue recognized before cash settlement.
- **Allocation:** linking a receipt/payment to one or more open invoices/bills.
- **AR / AP:** accounts receivable / accounts payable control accounts and subledgers.
- **Audit log:** append-only record of who did what, when and why.
- **Chart of accounts (COA):** the structured list of ledger accounts.
- **Control account:** a GL account whose balance must equal a subledger schedule.
- **Credit note:** a document reducing a previously invoiced sale; in Bangladesh, commonly associated with Mushak 6.7.
- **GRN:** goods received note; evidence of physical receipt.
- **Idempotency key:** a unique key that prevents the same command from posting twice.
- **Journal:** a balanced set of debit and credit lines.
- **Mushak:** the prescribed Bangladesh VAT forms (6.1, 6.2, 6.3, 6.6, 6.7, 9.1, etc.), subject to official verification.
- **Period:** an accounting window (usually a month) with an open/closed/locked status.
- **Posting:** committing a document or journal to the ledger.
- **Reversal:** a new, linked entry that negates a posted entry while preserving history.
- **Subledger:** detail behind a control account (customers, suppliers, inventory, tax).
- **TDS/VDS:** tax deducted/withheld at source; rates and rules require verification.
- **Trial balance:** list of account balances proving total debits equal total credits.
- **UAT:** user acceptance testing with real accountants/business users.

---

*End of master plan.*
