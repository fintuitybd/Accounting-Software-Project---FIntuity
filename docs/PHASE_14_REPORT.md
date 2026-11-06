PHASE COMPLETION REPORT

Phase: 14 — Application shell, dashboard and workflow UX
Status: PARTIAL

Summary: The authenticated production shell was completed and moved onto the Quiet Ledger design system without importing the demo workspaces. Navigation is grouped and permission-aware, the first-company setup route now works for an organisation owner with no company, and a company/default-branch context is persisted as display-only preferences. Home is now an action dashboard with four KPIs, a server-derived attention queue, permission-filtered quick actions and close readiness. The command palette searches company-scoped documents, parties, items, accounts and journals and offers only permitted actions. Explicit deep-link aliases normalise to the existing query-driven screens, while unknown paths return a localised 404 and forbidden sections return 403. Sales and purchase drafts now autosave to the server with visible save state, retry, validation summary, field errors and an unsaved-change guard. Sales and purchase tables use server pagination, filters, local saved views and column choice. A scoped `.ql-theme` bridge replaces gradients, glass, tiny labels and oversized radii only in the authenticated product, while the synthetic demo shell keeps its own appearance. Browser checks show Lighthouse accessibility 1.00 on Home, Sales, Purchases, Reports, Close, Ledger and Banking, no working text below 12px on the three densest screens, and no horizontal overflow at the available 1000px viewport. The phase remains PARTIAL because localization of several deep legacy panels is still English-only and the required 2–3 accountant usability sessions and 360/768 screenshot pass were not available in this environment.

Files changed:

- `src/demo/DemoShell.tsx` — repaired a literal `\n` import sequence that broke the baseline typecheck.
- `src/shell/CommandPalette.tsx` — repaired the same baseline syntax defect; added permission-aware account search and audit/setup actions.
- `src/pages/dashboard/DashboardPage.tsx` — completed the truncated dashboard; four KPIs, attention queue, quick actions, close readiness, partial-load warnings and read-only auditor context.
- `src/shell/AppSidebar.tsx` — grouped role-aware navigation, persistent/collapsible rail, mobile drawer, company switcher and default-branch selector.
- `src/shell/AppTopBar.tsx` — breadcrumbs, search, language/theme/help controls, user menu, accessible labels and sign-out.
- `src/shell/ProductionShell.tsx` — explicit deep-link redirects, localised route error boundary and route-level lazy loading.
- `src/shell/navigation.ts` — permission rules, no-company setup rule, explicit aliases and unknown-path rejection.
- `src/shell/PageHeader.tsx` — shared page header/breadcrumb contract with router links.
- `src/shell/RouteStates.tsx` — localised 404, 403, loading and error states.
- `src/shell/AppToastStack.tsx` — valid notification region semantics.
- `src/auth/AuthContext.tsx` — exposes whether an active company exists for first-company navigation.
- `src/core/storage/preferences.ts` — stores the default branch as a display-only preference.
- `src/preferences/AppPreferences.tsx` — loads, saves and exposes the default branch; no financial data stored.
- `src/index.css` — scoped Quiet Ledger bridge for legacy workspace classes, dark/high-contrast tokens, minimum readable type, focus and reduced motion.
- `src/pages/forms/draftSupport.tsx` — unsaved-change guard, save-state indicator and validation-summary components.
- `src/pages/tables/TableControls.tsx` — local saved views, column picker and persistence validation.
- `src/pages/sales/SalesPage.tsx` — shared page header, route/query synchronisation, document deep links and unsaved-safe tab navigation.
- `src/pages/sales/DocumentListPanel.tsx` — saved views, column choice and consistent server-filtered list states.
- `src/pages/sales/InvoiceFormPanel.tsx` — server draft autosave, save state, retry, validation summary, field errors, sticky actions, accessible line controls and unsaved guard.
- `src/pages/purchases/PurchasesPage.tsx` — shared page header and route/query synchronisation.
- `src/pages/purchases/PurchaseListPanel.tsx` — server pagination, saved views, column choice and consistent states.
- `src/pages/purchases/PurchaseFormPanel.tsx` — server draft autosave, save state, retry, validation summary, sticky actions, accessible line controls and unsaved guard.
- `src/pages/banking/BankingPage.tsx` — shared page header and Quiet Ledger presentation.
- `src/pages/treasury/TreasuryPage.tsx` — shared page header and Quiet Ledger presentation.
- `src/pages/ledger/LedgerPage.tsx` — shared page header and Quiet Ledger presentation.
- `src/pages/inventory/InventoryPage.tsx` — shared page header and accessible section navigation.
- `src/pages/masters/MasterDataPage.tsx` — shared page header and accessible section navigation.
- `src/pages/reports/ReportsPage.tsx` — shared page header and filter panel separation.
- `src/pages/close/ClosePage.tsx` — shared page header and Quiet Ledger presentation.
- `src/pages/audit/AuditLogPage.tsx` — shared page header, export action and Quiet Ledger presentation.
- `src/pages/setup/CompanySetupPage.tsx` — explicit step deep link, first-company route support and test-fixture dependency fix.
- `src/pages/setup/ChartOfAccountsStep.tsx` — initial account search from a command-palette result.
- `tests/navigation.test.ts` — role/nav matrix, no-company setup, unknown paths, aliases and bilingual labels.
- `tests/dashboard.test.ts` — period selection, overdue aggregation, cash deduplication and fiscal-year selection.
- `tests/table-controls.test.ts` — saved-view/column persistence and malformed-storage handling.
- `tests/shell-render.test.ts` — production shell render, demo-module exclusion and auditor navigation.
- `tests/reports-render-smoke.test.ts` — added the required preferences provider.
- `tests/banking-render-smoke.test.ts` — added the required preferences provider.
- `docs/PHASE_14_REPORT.md` — this report.
- `docs/IMPLEMENTATION_NOTES.md` — phase record.
- `README.md` — Phase 14 behaviour, design bridge, localization status and stale font/close statements corrected.

Database/migrations: none. No schema, API contract, posting, period or audit logic was changed. The new branch selector is a local prefill preference, not a server scope.

Commands run and actual results:

- `npm run typecheck` → exit 0; application, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 44 warnings (pre-existing workspace hook/unused warnings; no new errors).
- `npm test` → exit 0; 12 files, 69 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 26 files, 156 tests passed.
- `npm run build` → exit 0; Vite production build completed. `ErpShell` 3.33 KB (1.43 KB gzip), `ProductionShell` 70.77 KB (17.46 KB gzip); the Sales page and XLSX remain separate lazy chunks (approximately 220 KB / 34 KB gzip and 424 KB / 142 KB gzip). Existing large-chunk warning remains for the lazy XLSX chunk.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm run selfcheck` → exit 0; all domain/ledger/tax/import/gate checks passed, including 25/25 golden tax vectors.
- `git diff --check` → exit 0; no whitespace errors after normalising the edited CSS line endings.
- `npm audit --omit=dev` → exit 1; one pre-existing high advisory for `xlsx@0.18.5` with no fix available. No dependency was added by this phase.
- Browser E2E (in-app Chromium, real API/PostgreSQL): sign-in succeeded and redirected to `/app`; Home rendered with period/KPIs/attention/quick actions/close readiness; command palette searched and navigated to Reports; `/app/sales/new` redirected to `/app/sales?new=1`; unknown `/app/nonsense` returned the 404 screen; Bangla toggle set `document.lang=bn-BD` and translated the shell/dashboard; the blank invoice save produced the validation summary; the unsaved-change guard prevented a `beforeunload`.
- Lighthouse (in-app browser): Home, Sales new, Purchases new, Reports, Close, Ledger and Banking all scored accessibility 1.00 and best-practices 1.00; SEO 1.00 on the authenticated screens. No accessibility failures remained.
- Text-size check (browser DOM): 0 visible text elements below 12px on Home, Sales and Purchases. Horizontal overflow check at the available 1000px viewport: `scrollWidth === innerWidth` on Home, Sales and Purchases.
- 360px/768px viewport screenshots were not run: the in-app browser window has a fixed viewport and no emulation-size tool was exposed in this environment.

Acceptance criteria:

- Core journeys are completable by target roles: PARTIAL — role-aware routes, forms, validation, search and the real server services are present; the local company used for browser checks had no chart of accounts or parties, so a full invoice post was not completed in the browser. Posting is covered by the passing server integration suite.
- Dashboard answers “what needs me today?” without clutter: PASS — exactly four KPI cards plus a server-derived attention list, quick actions and close readiness; missing figures show “Not available”, not false zeroes.
- No fake module/button remains: PASS — production navigation does not import payroll, secretarial, practice cockpit or fake sales/purchase stages; `tests/shell-render.test.ts` asserts their absence.
- Search, filters, tables, forms and error states are consistent: PARTIAL — palette, shell, Home, sales and purchase list/form states and the main workspace headers are consistent; several deep panels retain older table/control patterns and English labels.
- Bangla/English are complete for the exposed screens: FAIL — shell, navigation, dashboard, route states, headers and core sales/purchase list/form controls are bilingual, but banking workbench, parts of purchases, setup step bodies and report internals still contain English-only labels.
- Accessibility/responsive targets met: PARTIAL — Lighthouse accessibility 1.00 on seven authenticated screens, no <12px text on the densest screens and no overflow at 1000px; 360/768 screenshots, 200% zoom and a Bangla screen-reader pass were not available.
- Tests cover the journeys and permissions: PARTIAL — navigation/role, shell render, dashboard arithmetic and table-preference tests are automated; browser journeys were manual because the repository has no browser E2E harness.

Tests added/updated:

- `tests/navigation.test.ts` — every role’s visible sections, operator/auditor restrictions, organisation-admin first-company setup, explicit deep-link aliases, unknown-path rejection, companyAll semantics and bilingual nav labels.
- `tests/dashboard.test.ts` — current-period selection, overdue/open aggregation, cash GL deduplication and fiscal-year-start selection.
- `tests/table-controls.test.ts` — saved-view round trip, malformed storage fallback, known-column filtering and storage-unavailable fallback.
- `tests/shell-render.test.ts` — owner/auditor shell rendering, skip link, demo-module exclusion and no role switcher.
- `tests/reports-render-smoke.test.ts`, `tests/banking-render-smoke.test.ts` — corrected provider harness so the existing screens render again.

Security/accounting review notes:

- Authorization: each route and action remains server-authorised. The shell only hides obviously forbidden entry points; the role/nav tests mirror the authoritative server permission matrix. The auditor shell exposes read-only evidence and does not expose setup or team administration. A new no-company rule allows only an organisation administrator to reach first-company setup; normal company setup still requires `MANAGE_COMPANY_SETTINGS`.
- Tenant scope: every search request, dashboard request and list request carries the active company ID and the server re-checks membership. No client-supplied total, tax, status or balance was introduced. Saved views and the default branch are display preferences only and contain no financial records.
- Posting: untouched. Autosave only creates or updates server-side DRAFT documents. The browser never posts from autosave; posting still uses the existing review/detail path, idempotency keys and server validation. The server remains the authority for tax, totals, stock and journal balance.
- Idempotency: the sales and purchase autosave paths reuse one stable idempotency key for the first create and use the returned document ID for subsequent updates. A manual save racing an autosave replays the same create key rather than creating a second draft.
- Unsaved data: the guard covers refresh/close and same-origin link navigation. It uses the server-saved draft as the source of truth; a failed save shows an error with retry and does not claim success.
- Reversal/period/audit: no reversal, period, close, posting or audit code was changed. All existing server tests still pass.
- Money: all displayed authoritative amounts still come from server strings/BigInt and the existing `money` formatter; no floating-point arithmetic was added to financial values.
- Accessibility: status uses text plus colour, working text is at least 12px in the migrated surfaces, selected tabs carry `aria-current`/`aria-selected`, line-item selects/inputs now have accessible names, and the notification region has a valid role.
- Demo isolation: the production shell never imports the demo providers/workspaces; demo-only modules remain behind `VITE_DEMO_MODE=true` and are visibly synthetic.

Known limitations:

- Localization is incomplete in deep panels. The typed key migration, native Bangla accounting review and error-code localization remain Phase 15 work.
- No automated browser E2E harness exists. Critical journeys were exercised manually against the real API/PostgreSQL; the repository tests cover role/nav, render, derivations and display preferences.
- No usability sessions with 2–3 accountants were possible in this environment. The phase prompt requires them for final acceptance.
- 360px/768px responsive screenshots and a 200% zoom pass were not possible because the in-app browser has a fixed viewport and no resize/emulation tool was exposed. The CSS breakpoints and mobile drawer are present, and Lighthouse uses mobile emulation for its accessibility audit.
- The branch selector is a default prefill for new documents, not a global filter. Sales/purchase list APIs do not expose branch filtering, so a global branch switch would be misleading. Report branch scope remains inside the report filter.
- Saved views/column choices are browser-local, not server-synchronised or shared between users.
- Bulk actions were not added because the implemented workflows have no safe bulk posting/approval operation; bulk posting without review would violate the posting controls.
- Detail/review/create deep links are explicit aliases that normalise to query parameters; they are not fully nested path components.
- Autosave covers sales invoices/credit notes and purchase bills/expense vouchers. Journal, receipt and payment forms retain manual draft actions.
- The first-company setup navigation defect was fixed and browser-verified, but a full new-company onboarding run was not repeated end-to-end in this phase.
- The lazy XLSX chunk remains 424 KB (142 KB gzip); route-level splitting keeps it off the shell and most pages.
- The pre-existing `xlsx@0.18.5` high advisory remains; no dependency was added or upgraded.

Manual or external decisions required:

- Native Bangladeshi accountant review of all Bangla terminology and every exposed deep-panel string.
- Usability sessions with 2–3 accountants: time to first invoice, receipt allocation, journal posting and close, plus “what do I do next?” feedback.
- Decision on whether a true global branch context should filter sales/purchases/ledger APIs; that requires server branch filtering and is not safe to fake in the shell.
- Decision on safe bulk actions and whether saved views should become server-synchronised.
- Phase 15 ownership of the remaining localization key migration, automated E2E harness, responsive screenshot matrix and manual screen-reader pass.

Next-phase dependency verified: YES (with carry-over) — Phase 15 can build on the role-aware shell, four-KPI dashboard, command palette, deep-link aliases, autosave/validation components, table controls and Quiet Ledger bridge. The remaining localization, usability and responsive evidence gaps are explicitly carried into Phase 15 rather than claimed complete.

Blocker: None for the implemented shell/dashboard/UX scope. Phase 14 is PARTIAL because deep-panel localization and the required accountant usability sessions cannot be completed safely without native review and human participants; those are product/release gates, not code blockers.
