PHASE COMPLETION REPORT
Phase: 11 — Reports, VAT registers and financial statements
Status: COMPLETE
Summary: Reports are now a server-authoritative, company- and branch-scoped read model derived from posted journals and posted documents. The production screen at `/app/reports` exposes trial balance, GL detail, profit or loss (month/quarter/YTD/fiscal year/custom), balance sheet (as-of), direct-method cash flow, changes in equity, AR/AP ageing, stock valuation, VAT sales/purchase registers, an internal draft VAT 9.1, a VDS/TDS/challan register and a journal listing. Period and comparative selection are explicit; labels say “for the month ended”, “for the period”, “for the year ended” or “as at” based on the actual range, and no fixed October window remains. Reversed documents are excluded from active VAT registers while linked reversal journals remain in the GL. Credit notes reduce VAT output in their own period; mixed-rate lines carry line-level tax evidence. Statement control checks are returned with the report and block export when they fail. The VAT 9.1 is always `DRAFT — NOT FILED`, shows its GL proof and exceptions, and never emits a filing acknowledgement or government receipt. Management accounts are labelled `Management accounts — unaudited`; the fabricated independent auditor’s report and “audited” labels were removed from the demo print pack. Every statement line drills to the account, posted journals, source document/tax decision and audit trail. CSV is generated from the same server report used on screen; XLSX is built from that CSV and A4 print/Save-as-PDF uses the same report object. Exports require `EXPORT_DATA` and are audited. A bounded 500-journal performance test proves the report query does not degrade into an unbounded scan on realistic data. The phase deliberately does not claim statutory filing readiness or accountant approval of report definitions.

Files changed:

- `server/migrations/0010_reporting_branch_scope.up.sql` — additive `journals.branch_id` dimension, branch FK/index and post-posting branch immutability trigger.
- `server/migrations/0010_reporting_branch_scope.down.sql` — development/test rollback that refuses while branch-attributed journals exist.
- `server/src/db/schema.ts` — Drizzle binding for `journals.branch_id` and the branch/date index.
- `server/src/ledger/ledgerService.ts` — branch attribution on manual/system journals and reversals, branch-aware trial balance/GL/journal listing, and read-only `sourceEvidence` on journal detail.
- `server/src/sales/salesService.ts` — sales/credit-note journals inherit the document branch.
- `server/src/sales/receivablesService.ts` — receipt journals inherit the receipt branch; AR ageing/VAT register accept branch scope.
- `server/src/purchases/purchaseService.ts` — purchase/expense journals inherit the document branch.
- `server/src/purchases/payablesService.ts` — supplier-payment journals inherit the payment branch; AP ageing accepts branch scope.
- `server/src/routes/journals.ts` — branch query support for journal listing and trial balance.
- `server/src/routes/sales.ts` — branch query support for AR ageing and the sales VAT register.
- `server/src/routes/purchases.ts` — branch query support for AP ageing.
- `server/src/reports/types.ts` — exact-poisha report DTOs, template/review metadata, checks, VAT parts and drill-down shapes.
- `server/src/reports/templates.ts` — versioned management/statutory templates with explicit review status and no filing claim.
- `server/src/reports/common.ts` — period/as-of/comparative resolution, exact period labels, branch scope validation and posted-journal balance queries.
- `server/src/reports/statements.ts` — P&L, balance sheet, cash flow, changes in equity, trial balance, GL detail and journal-listing reports; cash-flow classification proof.
- `server/src/reports/registers.ts` — VAT sales/purchase registers, VAT 9.1 draft, VDS/TDS/challan register, stock valuation and AR/AP ageing wrappers.
- `server/src/reports/catalog.ts` — report catalog, periods, fiscal years, branches, templates and definitions.
- `server/src/reports/export.ts` — CSV serialisers that use the same report objects as the screen and include statement summary totals.
- `server/src/reports/definitions.ts` — stable report keys for API/export/audit use.
- `server/src/routes/reports.ts` — company-scoped, permissioned report routes, all-page exports, export-size caps, export blocking and export audit.
- `server/src/app.ts` — registers the report routes.
- `server/tests/integration/reports.test.ts` — period/branch scope, month labels, balance/cash-flow/equity proofs, reversals, credit notes, mixed tax, VAT draft/GL proof, ageing, stock, withholding, CSV/XLSX parity, permissions, tenant isolation and post-period reversal variance.
- `server/tests/integration/reports-performance.test.ts` — 500-journal bounded P&L performance check.
- `server/tests/unit/reports.test.ts` — pure cash-flow classification proof, including an unclassified-movement failure case.
- `server/tests/integration/migrations.test.ts` — migration 0010 apply/rollback/reapply and branch index assertions.
- `src/reports/api.ts` — typed report client and export/audit client.
- `src/pages/reports/ReportsPage.tsx` — production reports workspace with period, comparative, branch and as-of controls, drill-down, export and blocked-export handling.
- `src/pages/reports/reportUi.tsx` — accessible report tables, check list, exceptions and review badges.
- `src/pages/reports/ReportPrintModal.tsx` — A4 print/Save-as-PDF from the same report object, with unaudited/draft labels and no audit opinion.
- `src/pages/reports/JournalEvidenceModal.tsx` — journal lines, source evidence, tax decision, document events and audit trail.
- `src/App.tsx` — `/app/reports` route.
- `src/components/layout/Sidebar.tsx` — reports navigation link.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 11 capability text and reports link.
- `src/auth/api.ts` — exports `API_BASE` for the report download client.
- `src/context/VaultContext.tsx` — selectable demo statement period and derived comparative instead of fixed `2026-10`/`2026-09`.
- `src/components/signature/StatutoryPrintModal.tsx` — removed the fabricated auditor’s report, government/NBR header and “audited” labels; replaced with an unaudited management-accounts cover, draft VAT workbook and neutral internal-document header; filtered reversed documents and removed zero placeholders.
- `src/components/signature/TaxAdvisorCard.tsx` — replaced the unverified filing deadline display with a pending-review status and no deadline assertion.
- `src/workspaces/W01_ExecutiveCockpit.tsx` — dynamic period/today, no fixed October or unverified filing clock.
- `src/workspaces/W03_PurchasesWithholding.tsx` — dynamic VAT period, posted-only register and internal-draft print.
- `src/workspaces/W05_VatRegisters91.tsx` — dynamic period, posted-only documents, actual challan deposits, removed placeholder lines and “safe to file”/filing-window claims.
- `src/workspaces/W08_IfrsStatementsStudio.tsx` — management-accounts/unaudited labels and a statement-period selector.
- `src/workspaces/W12_FirmCockpit.tsx` — filing scenario explicitly labelled illustrative and pending verification.
- `src/workspaces/W12_RulePackAndCoreLab.tsx` — no fixed tax-preview period; filing deadline display replaced with a pending tax-counsel verification status.
- `src/core/ifrs-engine/ifrsEngine.ts` — no fixed default month; VAT note no longer asserts an unverified filing deadline; cash-flow plug already absent and remains absent.
- `src/core/locales/enReports.ts`, `src/core/locales/bnReports.ts` — removed “Big-4”/“audited”/government-form strings.
- `src/core/locales/enTax.ts`, `src/core/locales/bnTax.ts`, `src/core/locales/enOps.ts`, `src/core/locales/bnOps.ts`, `src/core/locales/enCore.ts`, `src/core/locales/bnCore.ts` — filing deadlines and government-form labels now state that verification is pending.
- `src/pages/ledger/JournalComposer.tsx`, `src/pages/ledger/LedgerPage.tsx`, `src/ledger/api.ts` — optional branch selection and branch fields on manual journals.
- `tests/reports-render-smoke.test.ts` — SSR render smoke for the reports shell and unaudited label.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 11 capability, API, migration and limitation documentation.

Database/migrations: `0010_reporting_branch_scope` adds nullable `journals.branch_id`, a composite `(company_id, branch_id)` foreign key to `branches`, a `(company_id, branch_id, posting_date, created_at)` index, and a trigger that prevents branch attribution changing after posting/reversal. Existing journals remain `NULL` and report as Unassigned. The down migration refuses to drop the column while any journal has branch attribution; it is a development/test rollback, not a data-retention policy.

Commands run and actual results:

- `npm run typecheck` → exit 0; app, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 45 warnings (existing hook-dependency/unused-symbol warnings; no new-file errors).
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 7 files, 44 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 24 files, 143 tests passed, including 12 report integration tests, the 500-journal performance test, migration 0010 apply/rollback/reapply and the cash-flow classification unit tests.
- `npm run build` → exit 0; Vite production build completed; existing large-chunk warning only.
- `npm run build:server` → exit 0.
- `npm run selfcheck` → exit 0; all domain, import, gate and golden-suite checks passed (25/25 tax vectors).
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory with no fix available. No dependency was added by this phase.
- `git diff --check` → exit 0; no whitespace errors.
- Automated browser E2E was not run because this repository has no browser E2E harness. Committed evidence is server integration, unit, SSR render smoke and build.

Acceptance criteria:

- Reports use the selected period and scope: PASS — integration tests exercise October/November/December boundaries, comparative October for November, branch `HQ`, `UNASSIGNED` and tenant isolation; fixed October/September constants are removed from the report path.
- Trial balance/balance sheet/cash flow checks are correct and block export on failure: PASS — every statement returns explicit checks; balance sheet/equity/cash-flow assertions pass; VAT export returns `409 REPORT_EXPORT_BLOCKED` when the GL proof fails; the pure cash-flow unit test proves an unclassified movement is detected rather than plugged.
- VAT registers exclude reversed docs and show correct credit-note treatment: PASS — October reversed invoice is absent from the register; November register has a negative credit-note line and mixed `STANDARD_15`/`TRADING_5` evidence; the linked reversal remains in the GL.
- Drill-down reaches the source: PASS — line/account → GL detail → journal detail → `sourceEvidence` (document, tax decision state, rule-pack version, trace ID, events) and audit trail; tests cover a reversed sales journal and a manual journal.
- No fabricated audit/filing claim exists anywhere: PASS — the auditor’s report, NBR/government header, “audited” labels and “safe to file” copy were removed; VAT outputs are `DRAFT — NOT FILED`; management accounts are `unaudited`; remaining “Rafiq & Associates” text is the synthetic demo tenant/practice name, not an audit opinion.
- Exports match the screen: PASS — CSV is generated by the same server report; statement summary rows match the screen cards; XLSX is built from that CSV; print uses the same report object; integration test checks P&L revenue/profit totals in CSV.
- Tests cover the correction and reversal cases: PASS — reversal in the same period nets both VAT and GL; post-period reversal produces a visible VAT timing variance and blocks export; credit notes and mixed-rate lines are covered.

Tests added/updated:

- `server/tests/integration/reports.test.ts` — period boundaries, comparatives, branch scope, P&L/BS/CF/equity proofs, reversals, credit notes, mixed tax, VAT 9.1 draft and GL proof, AR/AP ageing, stock valuation, withholding register, CSV parity, permissions, tenant isolation, drill-down source evidence and post-period reversal blocking.
- `server/tests/integration/reports-performance.test.ts` — 500 journals / 1,000 lines, exact P&L and a 10-second response bound.
- `server/tests/unit/reports.test.ts` — cash-flow classification and unclassified-movement failure.
- `server/tests/integration/migrations.test.ts` — migration 0010 and report index verification.
- `tests/reports-render-smoke.test.ts` — reports shell renders with the unaudited management-accounts label.

Security/accounting review notes:

- Authorization: every report read requires `VIEW_REPORTS`; CSV and XLSX/PDF/print audit calls require `EXPORT_DATA`. The auth guard resolves company membership from the path company id; a user without membership gets 404, not another company’s data.
- Tenant scope: report queries always filter `company_id`; branch scope is an explicit additional filter (`ALL`, `UNASSIGNED`, or a branch UUID). Company-scoped report exports re-run the same server report and audit event.
- Money precision: authoritative amounts remain `BIGINT` poisha in PostgreSQL and `BigInt` in TypeScript; JSON exposes strings. No report aggregates with JavaScript floating point.
- Posting/immutability: reports read only `POSTED` and `REVERSED` journals. Posted journals and lines remain append-only by database trigger; corrections use linked reversals. Branch attribution on a posted journal cannot be changed.
- Reversal: VAT registers exclude `REVERSED` documents; linked reversal journals remain in the GL. A reversal posted in a later period produces an explicit VAT timing exception rather than a hidden adjustment. A second reversal remains rejected by the posting service/database.
- Period handling: report ranges are explicit; unknown/closed/locked periods are not treated as open for posting. Report reads are allowed for any configured period so historical statements remain available.
- Control checks: trial balance, balance-sheet imbalance, ledger balance, cash-flow reconciliation/classification, AR/AP control proofs, stock-to-GL proof and VAT output/input GL proofs are computed server-side. Blocking checks prevent CSV export and audit-gated XLSX/print.
- VAT/statutory: the VAT 9.1 template, line labels, filing deadline and statutory format are versioned and marked `PENDING_TAX_COUNSEL`; the return always says `DRAFT — NOT FILED`. No government receipt, filing acknowledgement or authority signature is generated.
- Audit: CSV export writes `report.exported` with actor, scope, template version, review status and check counts. XLSX/PDF/print call the audit endpoint, which re-runs the report and refuses if a blocking check fails.
- Export bounds: register export is capped at 20,000 lines; journal export at 10,000 journals, with `REPORT_EXPORT_TOO_LARGE` and a request to narrow the period/branch. This prevents an unbounded export query.

Known limitations:

- PDF is produced through the browser’s print/Save-as-PDF path from the A4 report layout; no server-generated binary PDF is produced. This avoids adding a PDF/font dependency but means PDF output depends on the browser and installed Bangla fonts.
- VAT 9.1 labels, parts and filing deadlines are internal draft mappings, not an approved statutory template. A qualified tax counsel must approve them before any filing use.
- Report definitions, management-accounts presentation and statutory line labels remain pending accountant sign-off.
- Cash flow is presented using the direct method derived from posted cash journals, deliberately chosen so the statement reconciles by construction without a plug. An indirect-method presentation (starting from operating profit) remains an accountant decision.
- Branch attribution is additive. Sales/purchase documents, receipts and payments carry branch; manual journals can carry branch; inventory, treasury and banking journals currently remain `NULL`/Unassigned. A branch-scoped statement can therefore exclude those unassigned journals; the scope is explicit and never silently assigned to the principal branch.
- Stock valuation is movement-based weighted average by item/warehouse; it does not produce separate warehouse-level GL accounts.
- Bank-account opening balances remain schedule metadata; cash-flow and balance-sheet figures use posted journals only. A company must post an approved opening-balance batch for those balances to appear in reports.
- Cash-flow scope is the configured bank/cash/MFS register accounts plus accounts with the `BANK_MFS` control subledger. A cash account that is neither configured nor tagged is excluded; the report lists the accounts it used so the configuration can be corrected.
- AR/AP branch proofs use the document/receipt branch. If a receipt/payment is attributed to a different branch from its document, a branch-filtered proof can differ; the difference is shown and blocks export.
- The withholding register shows liabilities and deposits but does not yet produce a full VDS/TDS GL proof because that depends on the approved purchase tax policy mapping; the mapping status is displayed.
- Print of a paginated VAT register or journal listing uses the current page; CSV export fetches all pages up to the cap. There is no streaming export.
- No automated browser E2E harness exists; evidence is API/unit/integration, SSR render smoke and build.
- The pre-existing `xlsx` high advisory remains; the phase added no dependency.

Manual or external decisions required:

- Accountant sign-off of every report definition, management-accounts presentation, cash-flow method and branch-attribution policy.
- Tax counsel sign-off of the VAT 9.1 template, parts, line labels, due-date/filing rules and any future statutory format; no filing claim may be made before that.
- Decision on whether to generate a true server-side PDF (with an embedded Bangla font) instead of browser print/Save-as-PDF.
- Decision on branch attribution for inventory, treasury and banking journals, and on how legacy unassigned journals should be treated in branch reports.
- Decision on whether the direct cash-flow statement is acceptable for statutory/management use or an indirect presentation must be added.
- Business decision on the export caps and retention/watermarking policy for exported report files.

Next-phase dependency verified: YES — Phase 12 can use the report read model, control checks, `sourceEvidence`, branch dimension and audit/export events. Verified by running the full server integration suite (143 tests), the 500-journal report performance test and migration 0010 apply/rollback/reapply. The close/approval workflow itself (persisted close runs, maker-checker sign-off, immutable audit-log viewer, controlled reopen) is not implemented in this phase and remains Phase 12.

Blocker: None for the implemented unaudited management-reporting and draft-statutory-output layer. Filing/statutory use remains blocked by the external accountant/tax-counsel decisions listed above; the product does not claim filing readiness.
