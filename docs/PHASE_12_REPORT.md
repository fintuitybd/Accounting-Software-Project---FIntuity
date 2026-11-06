PHASE COMPLETION REPORT
Phase: 12 — Close, approvals, controls and audit log
Status: COMPLETE
Summary: Month-end close is now a persisted, server-side workflow. A maker prepares a close run from real control results, resolves exceptions, records an evidence reference and submits it. A different authorised checker re-runs the controls and approves; approval locks the period. Normal postings are rejected in CLOSED and LOCKED periods, and reopening requires a separate permission, a reason and an audit event. High-value approval thresholds now cover sales invoices, credit notes, purchase bills, supplier payments, manual journals and reversals, with self-approval and self-reversal blocked. Suspense is a chart-of-accounts control subledger: a resolution needs a named target account, reason, attachment/evidence reference and a different checker, and approval posts a linked balanced journal. An append-only audit log is queryable and exportable, close packs export as CSV, and the old demo close sign-offs and hard-coded names were removed. The close checklist deliberately contains only controls that exist: trial balance, balance sheet/ledger proof, AR/AP control proofs, bank/MFS reconciliation when statements exist, VAT GL proof when VAT activity exists, and suspense.

Files changed:

- `server/migrations/0011_close_approvals_audit.up.sql` — close runs/events, suspense resolutions, purchase approval fields, period reopen provenance, SUSPENSE control/source values and immutability triggers.
- `server/migrations/0011_close_approvals_audit.down.sql` — development rollback that refuses while close/suspense evidence or approved sales invoices exist.
- `server/src/db/schema.ts` — Drizzle bindings for close runs/events, suspense resolutions, purchase approval fields and period reopen provenance.
- `server/src/close/closeService.ts` — persisted close runs, six implemented controls, submit/approve/reject, period lock, permissioned reopen and close-pack CSV.
- `server/src/suspense/suspenseService.ts` — suspense queue, maker request, checker approval/rejection and linked SUSPENSE journal posting.
- `server/src/audit/auditQueryService.ts` — company-scoped audit query, actor/session/before/after detail and bounded CSV export.
- `server/src/routes/close.ts` — permissioned close, reopen, suspense and close-pack routes.
- `server/src/routes/audit.ts` — audit viewer and CSV export routes.
- `server/src/app.ts` — registers the close and audit routes.
- `server/src/routes/companySetup.ts` — removed the direct period-status PATCH bypass; close/lock/reopen now use the controlled routes.
- `server/src/routes/sales.ts` — generalised high-value document approval route.
- `server/src/sales/salesService.ts` — invoice/credit-note threshold approval, posting enforcement, approval audit and high-value reversal maker check.
- `server/src/routes/purchases.ts` — purchase-document approval route.
- `server/src/purchases/purchaseService.ts` — purchase-bill approval fields/route logic, posting enforcement, approved-draft immutability and high-value reversal maker check.
- `server/src/ledger/ledgerService.ts` — high-value reversal maker check and threshold enforcement in the shared reversal path.
- `server/src/ledger/constants.ts` — `SUSPENSE` journal source.
- `server/src/company/constants.ts` — `SUSPENSE` account control subledger.
- `server/src/auth/permissions.ts` — separate `REOPEN_PERIOD` permission.
- `server/tests/integration/close.test.ts` — close happy path, failed control, maker-checker, lock rejection, suspense, reopen, audit export, immutability and tenant isolation.
- `server/tests/integration/migrations.test.ts` — migration 0011 apply/rollback/reapply and new table assertions.
- `server/tests/integration/ledger.test.ts` — controlled close/reopen period test and high-value reversal test.
- `server/tests/integration/sales.test.ts` — high-value sales-invoice approval test and fixture compatibility.
- `server/tests/integration/purchases.test.ts` — high-value purchase approval test plus period test migrated to controlled reopen.
- `server/tests/integration/banking.test.ts` — period test uses an explicit CLOSED database state.
- `src/close/api.ts` — typed close/suspense client and CSV download.
- `src/audit/api.ts` — typed audit viewer/export client.
- `src/pages/close/ClosePage.tsx` — production close cockpit: persisted checks, evidence, maker/checker decisions, reopen and suspense resolution.
- `src/pages/audit/AuditLogPage.tsx` — audit log viewer, filters, before/after detail and CSV export.
- `src/pages/ledger/PeriodsPanel.tsx` — direct close/lock buttons removed; permissioned reopen calls the controlled workflow.
- `src/pages/sales/DocumentDetailPanel.tsx` — high-value approval action and wording for invoices as well as credit notes.
- `src/pages/purchases/PurchaseDetailPanel.tsx` — high-value purchase-bill approval panel.
- `src/pages/purchases/PurchasesPage.tsx` — passes the approval permission to the detail panel.
- `src/purchases/api.ts` — purchase approval types and endpoint.
- `src/pages/setup/CompanySettingsStep.tsx` — threshold wording now states the enforced document/journal/reversal and payment scope.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 12 capability text and close/audit links.
- `src/App.tsx` — `/app/close` and `/app/audit` routes and Phase 12 footer label.
- `src/components/layout/Sidebar.tsx` — close and audit navigation links.
- `src/workspaces/W09_CloseAndControl.tsx` — removed hard-coded maker/checker names and local sign-off state; suspense one-click write-off removed; links to the controlled close.
- `src/auth/types.ts`, `src/auth/roles.ts` — `REOPEN_PERIOD` permission and label.
- `src/setup/api.ts` — `SUSPENSE` control-subledger option.
- `src/ledger/api.ts` — `SUSPENSE` and `BANK_RECONCILIATION` journal-source types.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 12 capability, API, migration and limitation documentation.
- `docs/PHASE_12_REPORT.md` — this report.

Database/migrations: `0011_close_approvals_audit` adds `close_runs`, `close_run_events` and `suspense_resolutions`; adds `purchase_documents.approved_at/approved_by`, `periods.reopened_by/reopened_at`, the `SUSPENSE` account-control and journal-source values; removes the sales constraint that limited APPROVED status to credit notes. Triggers make audit events, close-run events and decided close/suspense evidence append-only. The down migration refuses while any close evidence, suspense decision or approved sales invoice exists.

Commands run and actual results:

- `npm run typecheck` → exit 0; frontend, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 44 warnings (all pre-existing hook-dependency/unused-symbol warnings; no new warnings).
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 7 files, 44 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 25 files, 151 tests passed, including 5 new Phase 12 close/audit tests, migration 0011 apply/rollback/reapply, the high-value sales-invoice test, the high-value purchase-bill test and the high-value reversal test.
- `npm run build` → exit 0; Vite production build completed; existing large-chunk warning only.
- `npm run build:server` → exit 0.
- `npm run selfcheck` → exit 0; all domain, action, import, gate and 25/25 golden-suite checks passed.
- `git diff --check` → exit 0; no whitespace errors.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory with no fix available. No dependency was added by this phase.
- Automated browser E2E was not run because this repository has no browser E2E harness. Evidence is server integration, unit, SSR render smoke and build.

Acceptance criteria:

- Close run is persisted with evidence and real users: PASS — `close_runs` stores checklist/exception snapshots, SHA-256 hash, evidence reference/note, maker, submitter, checker and timestamps; `close.test.ts` reads it back and checks the persisted events.
- Maker ≠ checker enforced: PASS — the close maker/submitter receives `403 CLOSE_SELF_APPROVAL`; suspense requester receives `403 SUSPENSE_SELF_APPROVAL`; high-value journals/documents/payments/reversals block the creator.
- CLOSED/LOCKED periods reject postings: PASS — posting only accepts `OPEN`; the close test locks a period and a journal submission returns `PERIOD_NOT_OPEN`; the ledger/purchase period tests cover direct CLOSED and LOCKED states and unknown dates.
- Reopen is permissioned, reasoned and audited: PASS — `REOPEN_PERIOD` is required, a 3–500 character reason is mandatory, `period.reopened` is audited and the prior run becomes `REOPENED`.
- High-value approvals work: PASS — journal, sales invoice, credit note, supplier payment and high-value reversal tests exercise threshold blocking, different-checker approval and self-approval rejection.
- Audit log covers material actions and cannot be silently altered: PASS — database triggers reject audit/close-event UPDATE and DELETE; the viewer/export test covers close creation, submission, approval, period lock, suspense and `audit.exported`; company isolation is tested.
- No hard-coded names or local sign-offs remain: PASS — W09 no longer stores sign-offs, has no hard-coded maker/checker names, and points to the server-controlled close.

Tests added/updated:

- `server/tests/integration/close.test.ts` — close happy path, failed AR control, self-approval, suspense maker-checker and posting, reopen, audit viewer/export, evidence immutability and tenant isolation.
- `server/tests/integration/ledger.test.ts` — controlled close/reopen, high-value reversal maker check.
- `server/tests/integration/sales.test.ts` — high-value sales invoice approval and self-approval rejection.
- `server/tests/integration/purchases.test.ts` — high-value purchase bill approval, approved-draft immutability and period-state fixture updates.
- `server/tests/integration/migrations.test.ts` — migration 0011 and new-table/constraint verification.
- `server/tests/integration/banking.test.ts` — period-state fixture updated to the controlled workflow.

Security/accounting review notes:

- Authorization: every close/suspense/audit route declares a server permission and company mode; membership is resolved from the path company ID. The auditor can read and export but cannot create/decide a close or reopen a period.
- Tenant scope: close runs, suspense requests, audit queries and exports always filter `company_id`; cross-company close access returns 404. Audit text search is limited to company/org-member events.
- Posting/atomicity: suspense approval posts through the same ledger transaction, period/account/balance/numbering/idempotency rules as every other journal. Approval locks the period under a row lock; posting locks the period `FOR SHARE`, so a close cannot race a posting.
- Idempotency: close/suspense decisions are transactional status transitions with row locks; a second decision is rejected. Suspense journal idempotency is keyed by the resolution ID.
- Reversal: close/suspense never edits or deletes a posted journal. Suspense clearance is a new linked journal. High-value reversal must be performed by a different user from the creator/poster.
- Audit: `audit_events` and `close_run_events` are append-only by trigger; approved/rejected/reopened close runs cannot be edited/deleted. Every close, suspense, export and approval action writes an audit event with actor, session, request ID, before/after and reason.
- Money precision: all close/suspense amounts remain `BIGINT` poisha / `bigint`; comparisons use integer arithmetic and JSON exposes strings.
- Period handling: only `OPEN` accepts posting; `CLOSED` and `LOCKED` reject; unknown dates reject. Direct period-status PATCH was removed so the controlled close cannot be bypassed.
- Checklist validity: a new company is not blocked by payroll, depreciation, accruals or other unimplemented modules; those steps are absent. Bank reconciliation is not applicable when no statement line was imported. VAT proof is not applicable when there is no VAT activity.

Known limitations:

- The close checklist does not include payroll, depreciation, fixed assets or accrual controls because those modules are not implemented; adding them requires those phases and an accountant-approved checklist.
- Bank reconciliation is enforced only when imported statement lines exist. A bank GL movement with no imported statement does not block the close; it is not yet surfaced as a warning. A business decision is needed on whether missing statement evidence should block.
- VAT proof is evaluated only when VAT activity exists; a company with no VAT activity is not blocked by missing tax-policy approval.
- Reopen requires one authorised user with `REOPEN_PERIOD`; the optional second approver is not implemented. The permission is held by owner/admin/controller.
- Commercial-document rejection is not a separate persisted state: a rejected draft remains editable and unapproved. Close, supplier-payment and suspense decisions have explicit rejection history. A product decision is needed if rejected commercial drafts must be frozen with a reason.
- The audit viewer shows company-scoped events plus organisation-level identity events for users who have active access to the company. Failed sign-ins with no actor are not shown in a company view. Retention, external immutable storage and legal hold are not configured.
- Close pack export is CSV only; there is no server-generated PDF/XLSX close pack.
- No automated browser E2E harness exists; the close/audit screens are covered by typecheck, build and server integration, not browser interaction.
- Payroll, statutory filing, production email and the other external decisions from earlier phases remain outstanding.

Manual or external decisions required:

- Accountant/controller sign-off of the exact close checklist, control thresholds and exception policy, including whether missing bank-statement evidence should block a close.
- Decision on whether period reopen requires a second approver in addition to `REOPEN_PERIOD`.
- Decision on whether rejected commercial drafts must be frozen with an explicit rejection state and reason.
- Audit-log retention period, legal hold, external immutable storage and who may access IP/user-agent fields.
- Approval threshold values per company/document type, including whether sales and purchase documents need separate thresholds from journals/reversals.
- Decision on CSV-only close packs versus a server-generated PDF/XLSX format.

Next-phase dependency verified: YES — the Phase 11 report/control functions and period APIs were exercised by the new close tests, and the server/migration/test suite passes. No earlier-phase capability required by Phase 12 is missing. Phase 13 (public landing page/design system) does not depend on close internals.

Blocker: None for the implemented controlled-close, approval, suspense and audit-log scope. External sign-off of the checklist, retention policy and optional second reopen approver remains a human decision before production use.
