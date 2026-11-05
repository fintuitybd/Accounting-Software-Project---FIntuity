# DeepSeek Phase-by-Phase Execution Prompts

**Companion to:** `docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md`  
**Purpose:** ready-to-copy prompts for implementing the productionisation plan one controlled phase at a time.  
**Audience:** the coding agent working in OpenCode, and the human reviewing each phase.

> **How to use this document.** Paste the “Global execution instructions” block into a new OpenCode session, then paste exactly one phase prompt. Do not paste multiple phases at once. The agent must stop after its completion report and wait for the human. If a dependency is missing or a legal/accounting fact is unverified, the agent must report a blocker rather than inventing an answer.

---

## How to use the phase gates

1. Start each phase on a clean working tree and a dedicated branch (after Phase 0 creates the repository).
2. Paste the global block and the phase prompt.
3. The agent inspects the repository and the relevant master-plan sections before editing.
4. The agent implements only the phase scope.
5. The agent runs the required checks and writes the completion report.
6. The human reviews the report and the changed files.
7. The human explicitly authorises the next phase. The agent must never continue automatically.

If a phase is too large for one controlled session, the agent must stop and propose a concrete split (for example, “Phase 7A: invoice posting; Phase 7B: receipts and allocation”). It must not implement a fake or partial version and label it complete.

---

## Global execution instructions

Copy this block at the start of every phase.

```text
You are implementing one phase of a productionisation plan for a Bangladeshi accounting and business ERP. You are working in the repository at C:\Fintuity\Accounting Software Project - Copy (or the repository root shown by the environment). This is financial software; correctness, security and auditability take priority over speed or visual polish.

AUTHORITATIVE DOCUMENTS
Read these before doing anything:
- docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md
- docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md
Then read the specific master-plan sections named in the phase prompt, plus the files and symbols named there.

NON-NEGOTIABLE RULES
1. Inspect the actual current state. Do not assume a previous phase was completed correctly, even if the phase report says so. Verify the dependency in code, tests and behaviour.
2. Preserve the existing stack and conventions unless the phase explicitly authorises a change. Do not rewrite unrelated working code or perform broad renames, formatting churn or speculative refactors.
3. Do not invent APIs, database fields, components, error codes, business rules, tax rates, statutory requirements or file paths. If a required fact is not in the repository and is not verified, stop and report a blocker.
4. Do not silently remove or disable existing functionality. If something must be replaced, document what, why and how its data/behaviour is migrated.
5. Avoid new dependencies. If a dependency is genuinely required, justify it in the plan and report, pin the version, check its license/security, and prefer the smallest option.
6. Financial data integrity is mandatory:
   - Money is integer minor units (poisha) or a precise decimal; never JavaScript floating point for authoritative amounts.
   - Every journal must balance exactly.
   - Posting must be atomic and idempotent.
   - Posted records are immutable; corrections use linked reversals.
   - Periods must be explicitly OPEN, CLOSED or LOCKED; reject unknown periods.
   - Every company-scoped query and mutation must enforce membership and permission on the server.
   - No client-supplied total, tax amount, status or balance is authoritative.
7. Do not create fake data, dummy endpoints, placeholder interactions or “demo” behaviour in production paths. Demo data must be clearly labelled, isolated and removable. Do not claim a feature works because a screen renders.
8. Validate input at the appropriate client and server boundaries. Return useful, stable error codes; never expose stack traces, secrets or another company’s data.
9. All destructive or irreversible actions need a confirmation that states the consequence. Never delete posted financial history.
10. Every phase must preserve or improve accessibility, localization and responsive behaviour. Do not introduce text below 12px or a colour-only status.
11. Run the checks that the repository supports: typecheck, lint, unit tests, integration tests, E2E where available, and build. If a check cannot run, say exactly why. Never claim success when a command failed or was not run.
12. If you find a critical defect outside the phase scope, record it in the completion report. Do not fix it opportunistically unless the phase explicitly allows it; a broad uncontrolled fix is worse than a documented blocker.
13. Do not commit secrets, local databases, browser storage, generated audit packs or large binaries. Do not force-push or rewrite shared history.
14. Keep the working tree understandable: small, focused changes; meaningful names; comments only where they explain a non-obvious accounting or security decision.
15. At the end, stop. Do not start the next phase. Do not claim the whole product is production-ready.

PHASE COMPLETION REPORT FORMAT
At the end of the phase, output exactly this structure:

PHASE COMPLETION REPORT
Phase: <number and title>
Status: COMPLETE | BLOCKED | PARTIAL
Summary: <what was implemented, in plain language>
Files changed: <list every file, with a one-line reason>
Database/migrations: <none, or migration names and what they change>
Commands run and actual results: <command → exit status and key output>
Acceptance criteria:
  - <criterion>: PASS/FAIL — <evidence>
Tests added/updated: <list>
Security/accounting review notes: <authorization, tenant scope, posting, idempotency, reversal, audit>
Known limitations: <anything not done or not verified>
Manual or external decisions required: <tax counsel, accountant, hosting, legal, etc.>
Next-phase dependency verified: YES/NO — <how>
Blocker (if any): <exactly what is missing and what decision is needed>

STOP CONDITIONS
Stop and report a blocker instead of guessing if:
- A required earlier-phase capability is missing or behaves differently from the plan.
- A legal, tax, payroll, filing or data-protection rule is needed but not verified.
- A database migration would be destructive or cannot be rolled back safely.
- A security boundary (auth, tenant isolation, permission) is unclear.
- The phase would require a large architectural change beyond its scope.
- Tests fail for reasons you cannot fix within scope.
- The work cannot be completed safely in one controlled change.
```

---

## Phase 0 — Repository readiness and baseline

```text
PHASE 0 — REPOSITORY READINESS AND BASELINE

OBJECTIVE
Create a safe, reproducible engineering baseline before any behaviour changes. This phase is about version control, scripts, CI and evidence, not features.

READ FIRST
- Master plan sections 4 (repository/architecture), 19 (testing), 20 (performance/deployment) and 24 (definition of done).
- package.json, tsconfig.json, vite.config.ts, build.log, scripts/*.ts, and the root file list.

INSPECT BEFORE EDITING
- Confirm whether the folder is a Git repository. If it is not, initialise one.
- Inspect the current build, typecheck and self-check commands.
- Check for existing .gitignore, README, CI files, lint/format config, test runner and lockfile.
- Confirm which generated files (dist, local vault exports, audit packs, node_modules) must be ignored.

IMPLEMENT
1. Initialise Git if absent. Create a sensible .gitignore for node_modules, dist, local vault exports, generated .xlsx audit packs, environment files, logs, editor files and OS files. Do not commit secrets or generated artifacts.
2. Add a README.md with: purpose, stack, prerequisites, install, dev, build, typecheck, test, lint, environment, demo mode, data warning and documentation links.
3. Add package scripts for typecheck, lint, format:check, test and build. Keep existing scripts working.
4. Add a minimal ESLint + Prettier (or equivalent) configuration that matches the existing TypeScript/React style. Do not reformat the entire repository in this phase.
5. Add Vitest (or the chosen test runner) and a first smoke test. Move the existing self-check logic behind reusable test helpers where practical, without changing its assertions.
6. Add a CI workflow (GitHub Actions or the repository's host equivalent) that installs from the lockfile, runs typecheck, lint, tests and build. Cache dependencies appropriately.
7. Capture a baseline file or CI artifact of the current build, self-check and golden-suite results. Do not invent results.
8. Create docs/IMPLEMENTATION_NOTES.md with a short template for phase reports. This is supplementary; the two master documents remain authoritative.
9. If the repository has no license/ownership information, add a placeholder note in the README for the human to decide; do not invent a license.

DO NOT
- Do not change application behaviour, UI, accounting logic, data shapes or dependencies beyond the minimal tooling.
- Do not reformat unrelated files.
- Do not commit node_modules, dist, local browser data or generated audit packs.
- Do not add a large framework or test stack that the team cannot maintain.

EXPECTED USER-FACING BEHAVIOUR
None. The app should continue to render as before. The improvement is developer and release safety.

TECHNICAL REQUIREMENTS
- A clean clone can install and run.
- CI is deterministic and fails on typecheck/lint/test/build errors.
- The baseline evidence is reproducible.
- No secrets or personal data are committed.

VALIDATION
- Run install, typecheck, lint, tests and build; record exact results.
- Verify the CI workflow syntax if possible.
- Verify .gitignore excludes the generated files.
- Check that the existing app still starts.

ACCEPTANCE CRITERIA
- Git repository exists with a clean initial commit (or a clear note if the human forbids commits).
- README and scripts are usable.
- CI passes on the baseline.
- Existing self-check/golden results are recorded.
- No application behaviour changed.

BLOCKERS
Report a blocker if the repository cannot be initialised, if the existing build fails for reasons unrelated to this phase, or if the human has not decided on a license/hosting/CI provider.
```

---

## Phase 1 — Shared domain correctness hardening

```text
PHASE 1 — SHARED DOMAIN CORRECTNESS HARDENING

OBJECTIVE
Fix the most dangerous pure-domain defects and lock them with tests before introducing a server. Preserve the existing domain modules; do not rewrite them from scratch.

READ FIRST
- Master plan sections 3.4, 6, 7, 13 and 16.7.
- src/core/money.ts, src/core/types.ts, src/core/ledger/ledgerEngine.ts, src/core/tax-engine/engine.ts, src/core/tax-engine/rulePack.ts, src/core/ifrs-engine/ifrsEngine.ts, src/core/import-export/xlsxEngine.ts.
- scripts/selfcheck.ts, scripts/selfcheck-actions.ts, scripts/selfcheck-import.ts, scripts/gate.ts.
- Current tests and the golden suite.

INSPECT BEFORE EDITING
- Confirm the exact current behaviour of period resolution, reversal, credit notes, document numbering, line-level tax, settlement and stock.
- Reproduce the defects listed below with tests before fixing them. If a defect cannot be reproduced, report it rather than “fixing” by assumption.

IMPLEMENT
1. Period semantics: introduce an explicit UNKNOWN state or equivalent. Posting must reject UNKNOWN, CLOSED and LOCKED periods. Add tests for a date before the first period, after the last period, in a closed period, and in a locked period.
2. Reversal: prevent a second reversal of the same journal/group; prevent reversing a reversal; make the reversal link bidirectional; ensure the reversal is idempotent. Add tests.
3. Credit notes: represent them as distinct documents with their own numbering/series concept and an original-document link. They must not consume a Mushak 6.3 sales-invoice serial. Add tests for the numbering and the link.
4. Document/journal identity: stop deriving numbers from array length. Add a pure sequence allocator interface that can be backed by a database later; ensure uniqueness checks exist in the domain tests. Do not invent a statutory format.
5. Tax input: allow line-level tax facts and compute tax per line before document totals. Keep a single document-level summary. Do not silently apply one header rate to mixed-rate lines. Add tests with at least two categories.
6. Settlement: remove the unsafe “auto-settle everything except credit card” default. Settlement must be an explicit command/decision. Add tests showing that a posted invoice can remain open and that a separate receipt can settle it.
7. Opening balances: model a balanced batch with debit/credit totals; do not treat mutable account opening fields as posted balances. Add tests.
8. Stock: model stock movements explicitly; prevent negative stock or require an explicit policy/override; ensure a sale/return produces the correct movement and COGS pair. Add tests for receipt, issue and return.
9. Cash flow/report checks: remove the silent plug or convert it to an explicit blocking reconciliation failure. If the report cannot reconcile, it must not present a clean statement. Add tests.
10. Add focused regression tests for every defect fixed. Update existing self-checks only when the expected behaviour genuinely changed; explain the change.

DO NOT
- Do not introduce the server/database in this phase.
- Do not perform a wholesale rename of domain types or a broad refactor.
- Do not change UI appearance.
- Do not invent tax rates or legal rules.
- Do not remove existing tests to make the suite pass.
- Do not claim that the domain is production-ready; this phase removes specific correctness traps.

EXPECTED USER-FACING BEHAVIOUR
No intentional visual change. Existing demo flows may become stricter (for example, a closed period rejects a posting; a credit note no longer consumes an invoice serial). That is expected.

TECHNICAL REQUIREMENTS
- Pure functions remain deterministic and free of browser APIs.
- No floating-point money.
- Tests cover the fixed behaviour and the absence of regressions.
- The existing TypeScript build and self-checks pass, or every failure is documented as an intentional change with a migration note.

VALIDATION
Run typecheck, unit tests, self-checks, golden suite and build. For each fixed defect, show the failing test before the fix (where feasible) and the passing test after.

ACCEPTANCE CRITERIA
- Period, reversal, credit-note, numbering, line-tax, settlement, opening-balance and stock defects are fixed or explicitly blocked with evidence.
- Tests prove each fix.
- No unrelated UI or architecture change.
- The completion report lists every behaviour change that the UI will need to adapt to.

BLOCKERS
Stop if a fix requires a product decision (for example, the exact credit-note series format, or the negative-stock policy) or a legal rule that is not verified.
```

---

## Phase 2 — Backend foundation

```text
PHASE 2 — BACKEND FOUNDATION

OBJECTIVE
Add a production-grade server and PostgreSQL foundation with migrations, configuration, logging, health checks and integration tests. Do not move business features yet.

READ FIRST
- Master plan sections 16 and 20.
- Current package.json, tsconfig, vite config, scripts and storage layer.
- Phase 1 report; verify the domain fixes exist and tests pass.

INSPECT BEFORE EDITING
- Confirm Node version, package manager and lockfile.
- Confirm there is no existing server or database code.
- Check whether Docker is available in the target environment; if not, document an alternative.
- Verify the current frontend still builds independently.

IMPLEMENT
1. Create a server workspace (server/) with TypeScript, Fastify, Zod, Pino and a clean configuration module. Keep the frontend build independent.
2. Add PostgreSQL connectivity with a pooled client and Drizzle (or the approved equivalent). Add a health endpoint that checks the database.
3. Add the minimum schema/migration for organisations, users, memberships, companies and audit_events. Include UUIDs, timestamps, status fields and foreign keys. Do not add financial tables yet unless required by the phase.
4. Add a migration runner and a documented rollback story. Migrations must be forward-only in production and tested on a clean database.
5. Add environment validation; .env.example with non-secret placeholders; refuse to start with missing critical configuration.
6. Add structured logging with request IDs; redact secrets/PII; add a consistent error envelope.
7. Add integration tests using a disposable PostgreSQL database/schema. Test health, migrations, configuration failure and a basic route.
8. Add Docker Compose for local Postgres and the API. Do not require Docker for unit tests if an alternative is documented.
9. Add a typed API client foundation on the frontend only if needed; do not wire financial screens yet.
10. Document local setup, migration commands, environment variables and how to reset a development database safely.

DO NOT
- Do not implement auth, companies, documents, journals or reports in this phase beyond the minimum tables needed for the foundation.
- Do not replace the frontend's current state management or delete the demo.
- Do not add Redis, microservices, Kubernetes, GraphQL or an event bus.
- Do not create seed data that looks like real customer data.
- Do not log secrets, passwords or full request bodies containing PII.

EXPECTED USER-FACING BEHAVIOUR
None in the main app. The API health endpoint and developer setup work. The existing demo continues to render.

TECHNICAL REQUIREMENTS
- Clean install, migrate, start and test are documented and reproducible.
- Database connections are pooled; shutdown closes cleanly.
- Errors do not leak stack traces in production mode.
- No secret is committed.
- The server is stateless; no business state in memory.

VALIDATION
Run typecheck, lint, unit tests, integration tests, migration up/down on a clean DB, build, and a health check. Record exact output.

ACCEPTANCE CRITERIA
- Server starts against PostgreSQL.
- Health endpoint reports database status.
- Migrations apply cleanly; rollback/backup plan documented.
- Integration tests pass.
- Frontend build still passes.
- No financial feature is exposed yet.

BLOCKERS
Stop if PostgreSQL/Docker cannot be provisioned, if the human has not chosen a database/hosting approach, or if the existing repository cannot support a second workspace without breaking the frontend.
```

---

## Phase 3 — Identity, organisations, memberships and invitations

```text
PHASE 3 — IDENTITY, ORGANISATIONS, MEMBERSHIPS AND INVITATIONS

OBJECTIVE
Replace the demo role switcher with real authentication, server-side sessions, organisation/company membership, invitations and server-enforced permissions.

READ FIRST
- Master plan sections 9, 15 and 16.
- Phase 2 report and the server foundation.
- Current AuthAndOnboardingModal, VaultContext auth functions, TopBar role switcher and App boot.

INSPECT BEFORE EDITING
- Verify the server, database and migration runner work.
- Verify the current app's auth behaviour and identify every place that assumes `isAuthenticated` or role switching.
- Check whether email sending is available; if not, use a test adapter and document the production blocker.

IMPLEMENT
1. Database: users, organisations, memberships, company_memberships, invitations, sessions, password reset tokens (hashed), email verification tokens, audit events. Add constraints and indexes.
2. Auth service: Argon2id password hashing, email verification, login, logout, session issue/revoke, password reset, invitation acceptance, rate limiting, generic error messages, audit events.
3. Sessions: HTTP-only, Secure (in production), SameSite cookies; server-side session records; idle/absolute expiry; CSRF protection for mutations; revoke-all on password reset.
4. Authorization: server-side permission middleware for every route; company membership check; deny by default; role matrix from the master plan. Remove production role switching.
5. Invitations: admin creates an invitation with email, role and company scope; signed single-use token; expiry; resend; audit; accept page.
6. Frontend: `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation/:token`, `/session-expired`. Add a protected route/auth gate. Signed-out users must not see financial data.
7. Company switcher: load only companies the user belongs to; do not reset data; preserve the selected company in the URL/session.
8. Demo mode: if retained, isolate it behind an explicit environment/flag with synthetic data and a visible banner. It must not share real auth or real data.
9. Tests: auth flows, invitation expiry, password reset, session revocation, CSRF, rate limits, role matrix, cross-tenant access, auditor read-only, last-owner protection.

DO NOT
- Do not implement company setup or financial modules in this phase.
- Do not allow a user to change their own role.
- Do not store passwords/tokens in plaintext or logs.
- Do not use client-side role checks as the only enforcement.
- Do not leave a hidden “switch role” path in production.
- Do not use real customer emails in tests.

EXPECTED USER-FACING BEHAVIOUR
A new user must accept an invitation and sign in. A signed-out visitor sees the public/login page, not the dashboard. An auditor can read but not write. A user sees only their companies. A password reset and session expiry work.

TECHNICAL REQUIREMENTS
- All auth mutations are audited.
- All financial routes added later must use the same authorization middleware.
- Cookies are secure; CSRF is handled; sessions can be revoked.
- Email templates are plain, clear and localized.
- No sensitive data in URL tokens beyond the single-use token.

VALIDATION
Run typecheck, lint, unit/integration tests, E2E auth flows, build. Test with two users and two companies. Attempt cross-tenant access, role escalation, expired invitation, reused token and CSRF.

ACCEPTANCE CRITERIA
- No financial data is accessible without a valid session and membership.
- Invitations, verification, reset and session management work end-to-end.
- Server-side permissions match the documented matrix.
- Auditor cannot mutate.
- No production role switcher remains.
- Audit log records identity and access events.
- Tests prove tenant isolation and role enforcement.

BLOCKERS
Stop if email delivery cannot be configured for real use, if the role matrix needs a product decision, or if the frontend cannot be gated without exposing data.
```

---

## Phase 4 — Company onboarding, chart of accounts and periods

```text
PHASE 4 — COMPANY ONBOARDING, CHART OF ACCOUNTS AND PERIODS

OBJECTIVE
Enable a real company to be created and configured, with a validated opening-balance batch prepared for posting. Opening balances cannot be marked posted until the ledger service exists in Phase 5.

READ FIRST
- Master plan sections 8, 9.4–9.5, 13.5, 16.5–16.6 and 17.2.
- Phase 3 report; verify auth/membership/company APIs.
- Current onboarding wizard, MasterDataModal, seedData periods and Account/Party types.

INSPECT BEFORE EDITING
- Verify companies exist in the database and are scoped to organisations.
- Confirm how periods are currently generated and hard-coded.
- Confirm the chart-of-accounts and opening-balance data model.
- Check whether a COA import format already exists; if not, define a minimal CSV template.

IMPLEMENT
1. Company setup API/UI: legal identity, entity type, industry, TIN/BIN, RJSC number, address, contact, reporting framework, base currency BDT, time zone Asia/Dhaka. Allow “not registered yet” where legally acceptable.
2. Fiscal year and period generation: start/end, monthly periods, explicit OPEN status; reject overlapping periods; support a non-July start; no hard-coded 2026 dates.
3. Chart of accounts: hierarchy/parent, code, names, type, subcategory, IFRS category, control subledger, tax mapping, active status. Add/edit/deactivate; protect control accounts. Add CSV/XLSX import with validation.
4. Opening balances: a DRAFT batch with account lines and party/item/fixed-asset schedules; debit/credit totals; balance check; evidence; save/submit for posting. Do not store opening balances only on master records and do not mark them POSTED in this phase.
5. Banks/cash/MFS: add accounts with GL mapping, masked number, branch, opening balance; one principal bank/cash minimum.
6. Company settings: numbering prefixes/sequences, approval thresholds, language, time zone, reporting framework, tax settings. Audit changes.
7. Onboarding wizard: server-persisted, resumable, step validation, save/exit, progress. Creating a second company must not delete the first.
8. Tests: onboarding E2E, period generation, unknown-date rejection, balanced/imbalanced opening batch, COA import, cross-company isolation, permissions.

DO NOT
- Do not implement sales/purchases/journals in this phase.
- Do not clone a demo company silently.
- Do not use hard-coded fiscal periods or dates.
- Do not allow an unbalanced opening batch to be submitted.
- Do not mark an opening batch POSTED before the Phase 5 ledger service exists.
- Do not delete or overwrite another company’s chart of accounts.
- Do not invent BIN/TIN validation rules beyond format checks that are clearly labelled; do not claim statutory validation.

EXPECTED USER-FACING BEHAVIOUR
An authorised administrator can create a company, configure its fiscal year, load a COA, prepare a balanced opening batch, add bank/cash accounts and resume onboarding after a refresh. No other company’s data is visible. The opening batch is clearly marked DRAFT/pending posting.

TECHNICAL REQUIREMENTS
- Every company-scoped query checks membership on the server.
- Opening batch data is persisted with balanced-total validation and evidence; posting is deferred to Phase 5.
- Account codes are unique per company; control accounts cannot be repurposed silently.
- All setup changes are audited.
- No mutable opening balance can silently diverge from the ledger once posted.

VALIDATION
Run typecheck, lint, unit/integration tests, onboarding E2E, build. Test a balanced and unbalanced opening batch, a duplicate account code, a COA import with errors, a second company, and an unknown posting date.

ACCEPTANCE CRITERIA
- A new company can be created and resumed.
- The opening batch balances and is saved as DRAFT with evidence.
- Periods are generated correctly and unknown dates are rejected.
- The company switcher loads the correct data and never resets it.
- All setup events are audited.
- Tests cover permissions and cross-company isolation.
- No opening batch is falsely marked POSTED.

BLOCKERS
Stop if the product requires opening balances to be posted before Phase 5. In that case, split this phase into 4A (company/COA/periods) and 4B (opening balances after the ledger service), or move Phase 5 earlier. Do not fake the posting.
```

---

## Phase 5 — Server-authoritative ledger, general journal and opening balances

```text
PHASE 5 — SERVER-AUTHORITATIVE LEDGER, GENERAL JOURNAL AND OPENING BALANCES

OBJECTIVE
Move the ledger to the server, give accountants a safe general journal, and post the Phase 4 opening-balance batch atomically.

READ FIRST
- Master plan sections 13, 16.6–16.7, 17 and Phase 1 domain changes.
- Current ledgerEngine, VaultContext posting actions, LedgerLensModal and W09.
- Phase 4 report; verify companies, periods, accounts and the DRAFT opening batch.

INSPECT BEFORE EDITING
- Verify the domain posting command and period rules from Phase 1.
- Verify company/account/period tables and membership.
- Confirm the Phase 4 opening batch is persisted, balanced and NOT already marked posted.
- Identify every current UI path that calls postManualJournal or postJournal.
- Confirm the current journal numbering and audit behaviour.

IMPLEMENT
1. Database: journals, journal_lines, sequences, audit_events. Constraints: company scope, unique journal number, idempotency key, at least two lines, debit/credit balance, known account. Use a transaction.
2. Posting service: validate permission/period/accounts/balance; allocate the next number inside a lock/transaction; insert header/lines; append audit events; commit. Return a stable result.
3. General journal API/UI: date, book type (if retained), narration, lines with account, debit/credit, party/cost centre/project, memo, attachment, preview, submit/approve/post. Show a balanced/unbalanced state.
4. Opening-balance posting: post the Phase 4 DRAFT batch through the same ledger service, with approval, idempotency, a permanent batch↔journal link and a one-time posted state. Reject duplicate posting.
5. Journal detail: lines, source, status, created/approved by, reversal link, audit trail. No edit/delete on posted journals.
6. Reversal: target a journal or journal group; require reason and permission; create a linked reversal; reject duplicates; update the original status; audit. Do not allow reversing a reversal.
7. Period API: OPEN/CLOSED/LOCKED; reject CLOSED/LOCKED/UNKNOWN for normal posting; audit status changes. Do not implement the full close wizard yet; that is Phase 12.
8. Trial balance API/report at account level, with opening/period/closing and drill-down. Ensure it derives from journals, not mutable account fields.
9. Read-only auditor role enforcement at the API.
10. Tests: balanced/unbalanced, zero lines, unknown account, locked/closed/unknown period, idempotency, concurrency, duplicate number, reversal duplicate, opening batch posting/duplicate, tenant isolation, audit log.

DO NOT
- Do not implement sales/purchases/banking/reports beyond the trial balance needed to verify the ledger.
- Do not leave an in-memory or localStorage path as the authoritative ledger.
- Do not allow manual journal posting without server permission.
- Do not allow editing/deleting posted journals.
- Do not mark an opening batch posted twice or without approval.
- Do not implement the close sign-off UI; only period status enforcement.
- Do not invent journal number formats beyond the existing convention unless documented.

EXPECTED USER-FACING BEHAVIOUR
An accountant can create and post a balanced manual journal, see it in the trial balance and journal list, drill to lines, and reverse it with a reason. The opening batch can be reviewed, approved and posted once. A second user sees the result. An auditor can read but not post. A closed/locked period rejects posting with a clear message.

TECHNICAL REQUIREMENTS
- Posting is a single database transaction.
- Duplicate submissions are rejected or return the original result.
- Journal numbers are unique per company/book and never reused.
- Opening balances and normal journals use the same posting invariants.
- The audit log records post/reverse/period/opening changes with actor and reason.
- The API never trusts client totals.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, concurrency tests, build. Verify the trial balance against a known set of journals and the posted opening batch. Attempt duplicate posting, double reversal, duplicate opening posting, cross-company access and posting in a closed period.

ACCEPTANCE CRITERIA
- A balanced journal posts exactly once; an unbalanced/duplicate/locked/unknown entry is rejected.
- The opening batch posts once and the trial balance agrees.
- Trial balance debits equal credits.
- Reversal is linked, idempotent and blocked on a second attempt.
- Period status is enforced server-side.
- Auditor is read-only.
- Every action is audited.
- Existing UI is either migrated or clearly marked as demo-only; no fake ledger remains as the source of truth.

BLOCKERS
Stop if Phase 1 domain rules or Phase 4 accounts/periods/opening batch are not actually available, if the database transaction/concurrency design is unclear, or if a migration from the current browser ledger is required and unsafe.
```

---

## Phase 6 — Master data and inventory

```text
PHASE 6 — MASTER DATA AND INVENTORY

OBJECTIVE
Make parties, items, warehouses and stock movements reliable and reconcile them to the general ledger.

READ FIRST
- Master plan sections 6.2, 6.7, 7.3, 13.7, 16.5 and 17.1.
- Phase 5 report; verify server ledger and trial balance.
- Current MasterDataModal, InventoryItem/Party types, withInventoryDefaults, receiveInventoryStock and issueInventoryStock.

INSPECT BEFORE EDITING
- Verify accounts and periods are server-backed.
- Confirm the existing item/party fields and how the UI creates/edits them.
- Confirm current stock behaviour: seed quantities, GRN/challan, invoice/bill movements, negative stock.
- Check whether a warehouse concept exists beyond names in documents.

IMPLEMENT
1. Server tables and APIs for parties, party opening items, items, warehouses, stock_movements and stock balances. Company-scoped, with constraints.
2. Party CRUD: code, names, type, BIN/TIN, address, contact, credit days, credit limit, withholding buyer, government flag, active status. Validate formats but do not claim statutory verification. Deactivate rather than delete referenced parties.
3. Item CRUD: SKU, HS code, names, unit, stock/non-stock, default tax category, inventory/expense account, active status. Support decimal quantities (kg/metres) with a documented precision.
4. Warehouse CRUD and branch mapping.
5. Stock service: opening stock, GRN receipt, sales issue, return, transfer, adjustment. Weighted-average cost with deterministic rounding. Prevent negative stock by default; allow an explicit, permissioned override with reason if the business requires it.
6. Inventory control proof: stock valuation by item/warehouse reconciles to the inventory GL. Show differences; do not plug.
7. Master-data audit events: who changed what, before/after, reason for sensitive changes.
8. UI: usable master-data screens and stock ledger/valuation views; do not rely on the old modal for everything. Provide search, pagination and validation.
9. Tests: party/item validation, duplicate codes/SKUs, decimal quantities, weighted average, negative stock, transfer, return, control proof, permissions, cross-company isolation.

DO NOT
- Do not implement sales/purchase documents in this phase. Use service-level stock commands and a minimal test UI.
- Do not use floating-point quantities/money without a documented representation.
- Do not silently allow negative stock if the product policy forbids it.
- Do not delete referenced masters.
- Do not invent tax rates or category mappings.

EXPECTED USER-FACING BEHAVIOUR
An authorised user can create a party, item and warehouse, record an opening/stock movement, see a stock ledger and valuation, and understand why an item is short. Inventory reconciles to the GL.

TECHNICAL REQUIREMENTS
- Quantities use a precise decimal type; money uses integer poisha.
- Stock movements are immutable; corrections use reversal/adjustment.
- Every movement has a source, actor and timestamp.
- Inventory accounts are validated against the company COA.
- The stock ledger and GL proof are server-derived.

VALIDATION
Run typecheck, lint, unit/integration tests, build. Test weighted average with multiple receipts, a sale/issue, a return, a transfer, a negative-stock attempt and a cross-company access attempt.

ACCEPTANCE CRITERIA
- Parties/items/warehouses are CRUD-capable and audited.
- Stock movements produce correct quantities and values.
- Negative stock is blocked or explicitly approved per policy.
- Inventory control proof reconciles; differences are visible.
- Decimal units work.
- No master data from another company is accessible.

BLOCKERS
Stop if the business has not decided the negative-stock policy, the unit precision, or whether warehouses are required at launch. Do not guess these accounting/product rules.
```

---

## Phase 7 — Sales, credit notes and receivables

```text
PHASE 7 — SALES, CREDIT NOTES AND RECEIVABLES

OBJECTIVE
Implement a correct order-to-cash flow: persisted drafts, invoice posting, credit notes, customer receipts and AR allocation.

READ FIRST
- Master plan sections 7.4–7.5, 7.8, 13, 16.5–16.7 and 17.
- Phase 6 report; verify parties, items, stock and accounts.
- Current W02, postCommercialDoc, buildCommercialDoc, previewTaxJournal, postManualJournal and tax engine.

INSPECT BEFORE EDITING
- Verify the server ledger, accounts, parties, items, stock and periods.
- Reproduce the current defects: local drafts, header-only tax, auto-settlement, receipt not settling AR, credit note serial reuse.
- Check the tax rule pack status. If the relevant rates are not approved, do not hard-code them; report a blocker or use a clearly labelled configuration placeholder that blocks posting.

IMPLEMENT
1. Server document model: quotation/order/challan/invoice only if fully supported; otherwise implement draft → posted invoice and remove fake stages. Persist drafts server-side.
2. Invoice creation: customer, branch, dates, due date, payment terms, lines with item/description/quantity/unit price/discount/tax category/account, narration, attachments, currency BDT.
3. Line-level tax calculation and document totals; persist a tax decision snapshot with rule pack/version; show a review screen before posting.
4. Invoice posting: validate permission/period/party/items/tax/stock; allocate a gap-free Mushak 6.3 serial and document number in a transaction; post Dr AR / Cr revenue / Cr VAT and Dr COGS / Cr inventory; create AR open items; update stock; audit. Do not auto-settle.
5. Credit notes: distinct type, independent number/series (6.7 concept), mandatory original invoice link, reason, quantity/value validation against the original, stock/COGS reversal, approval where required, AR adjustment. They must not consume 6.3 serials.
6. Customer receipts: separate receipt document, bank/cash account, date, reference, amount, allocation to one or more invoices, partial receipts, discount/write-off (permissioned), unapplied cash. Update AR open items and GL in one transaction.
7. AR ageing and customer statement: invoice/credit/receipt detail, due dates, buckets, outstanding.
8. Document status timeline and audit trail; document-level reversal with linked effects.
9. UI: list, create, review/post, detail, receipts and ageing. Use the design system; do not use the old fake pipeline if stages are not implemented.
10. Tests: invoice posting, multi-rate tax, stock/COGS, partial/multiple receipts, credit note limits, duplicate posting, reversal, VAT register relevance, permissions, tenant isolation.

DO NOT
- Do not implement purchases or banking in this phase.
- Do not auto-settle a credit sale.
- Do not let the client submit authoritative tax/total amounts.
- Do not fabricate supplier/customer tax evidence.
- Do not claim a quote/order/challan workflow exists if it is not persisted and tested.
- Do not use a hard-coded 2026 date or period.

EXPECTED USER-FACING BEHAVIOUR
An accountant creates and posts a sales invoice, sees it in AR and VAT, records a partial receipt, allocates it, and sees the remaining balance. A credit note is a separate 6.7-style document linked to the original, with stock/cost reversal. Drafts survive refresh. Reversal is controlled.

TECHNICAL REQUIREMENTS
- Posting is atomic and idempotent.
- AR subledger derives from documents and allocations, not a mutable status.
- Stock and COGS agree to the inventory ledger.
- Document numbers and statutory serials are transactional and unique.
- Receipt allocation cannot exceed the open amount or target another company’s invoice.
- Tax decisions are stored and explainable.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build. Test concurrent invoice posting, duplicate submission, partial receipt, multiple invoices, over-allocation, credit note above original, reversal, cross-company access and a mixed-rate invoice.

ACCEPTANCE CRITERIA
- Invoice, credit note and receipt work end-to-end.
- AR ageing and control account agree after partial/multiple receipts.
- Credit note does not consume a 6.3 serial and restores stock/cost.
- Mixed-rate tax is correct.
- Drafts persist and are visible to authorised users.
- Reversal restores AR/stock and cannot be repeated.
- No fake workflow stage remains.

BLOCKERS
Stop if the tax rules or statutory serial format are unverified and would be presented as final, if the stock/COGS policy is unclear, or if Phase 6 inventory is incomplete. Do not invent a legal rate or format.
```

---

## Phase 8 — Purchases, GRN, bills and payables

```text
PHASE 8 — PURCHASES, GRN, BILLS AND PAYABLES

OBJECTIVE
Implement a correct procure-to-pay flow: supplier master, PO/GRN if supported, bill posting, AP open items, withholding liabilities and payments.

READ FIRST
- Master plan sections 7.6–7.9, 13, 16.5–16.7 and 17.
- Phase 7 report; verify sales/AR, tax engine, inventory and accounts.
- Current W03, postCommercialDoc, buildCommercialDoc, 3-way match code and paySupplier.

INSPECT BEFORE EDITING
- Verify supplier parties, items, warehouses, stock and periods.
- Reproduce current defects: local GRN, missing-TIN preview mismatch, fake supplier 6.3, inventory-only purchase account, payment not settling AP, no challans.
- Check the approved tax rules. If rates/evidence rules are unverified, block posting or use a clearly labelled draft configuration; do not present them as final.

IMPLEMENT
1. Purchase document model: purchase order, GRN, bill and expense voucher only if fully supported; otherwise implement bill/expense with explicit limitations. Persist drafts server-side.
2. Supplier bill/expense creation: supplier, branch, dates, due date, payment terms, lines with item/description/quantity/price/discount/tax/expense or inventory account, narration, attachments.
3. Tax: line-level tax calculation; supplier BIN/TIN; VDS/TDS facts; reverse charge; missing-TIN handling applied to the posted transaction (not just preview); supplier Mushak 6.3 evidence field/attachment. Never auto-generate statutory evidence.
4. GRN/3-way match (if retained): persist PO/GRN quantities and prices; per-line match; variance reason and approval; no aggregate-only shortcut. If not fully implemented, do not show a fake 3-way match.
5. Bill posting: post inventory/expense and input VAT against AP; create AP open items; update stock only on a real receipt; audit. Do not auto-pay.
6. Supplier payment: separate payment document, bank/cash account, amount, allocation to one or more bills, partial payments, withholding liabilities and challan queue; update AP and GL atomically.
7. Purchase returns/debit notes (basic) if in scope; otherwise explicitly defer and hide.
8. AP ageing and supplier statement.
9. Document-level reversal with linked effects.
10. Tests: bill posting with inventory and expense, missing TIN, VDS/TDS, 3-way match per line, partial payment, duplicate payment, reversal, AP ageing, permissions, tenant isolation.

DO NOT
- Do not implement banking/reconciliation in this phase.
- Do not fabricate a supplier Mushak 6.3 serial.
- Do not ignore the missing-e-TIN state when posting.
- Do not route every purchase bill to inventory.
- Do not show a 3-way match that uses aggregate quantities or defaults to the bill quantity.
- Do not create a challan without a real withholding liability.

EXPECTED USER-FACING BEHAVIOUR
An accountant records a supplier bill with the correct tax and expense/inventory classification, sees AP, pays partially or fully, and sees the AP balance reduce. If a GRN is retained, stock moves at receipt and the 3-way match is evidence-based. A missing e-TIN changes the posted withholding.

TECHNICAL REQUIREMENTS
- Bill/payment posting is atomic and idempotent.
- AP subledger derives from bills and allocations.
- Inventory and COGS/expense classification is line-level.
- Withholding liabilities and challan records are created from the actual payment.
- No client-authoritative totals.
- Tax evidence is attached, not invented.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build. Test a stock bill, a service expense, a missing-TIN supplier, a partial payment, a duplicate payment, a 3-way variance, a reversal, and cross-company access.

ACCEPTANCE CRITERIA
- Bill, payment and AP ageing work end-to-end.
- Stock/expense classification is correct.
- Missing TIN affects the posted amount.
- VDS/TDS liabilities and challan queue are created and reconcile.
- 3-way match is per-line and audited, or not shown.
- Reversal restores AP/stock and cannot be repeated.
- No payables from another company are accessible.

BLOCKERS
Stop if the tax evidence/rates are unverified, if the GRN/3-way match scope is undecided, or if Phase 6 inventory is incomplete. Do not invent a supplier serial or a withholding rate.
```

---

## Phase 9 — Receipts, payments, treasury and certificates

```text
PHASE 9 — RECEIPTS, PAYMENTS, TREASURY AND CERTIFICATES

OBJECTIVE
Connect settlement to the AR/AP subledgers and to treasury challans/certificates so payments and withholdings are traceable.

READ FIRST
- Master plan sections 7.8–7.10, 13, 14.3–14.4, 16.5 and 17.
- Phase 8 report; verify supplier bills/payments and AR/AP.
- Current W02 receipt, W03 payment, W04 challans, W05 VAT, VaultContext deposit functions.

INSPECT BEFORE EDITING
- Verify payments/receipts and open items exist.
- Confirm how VDS/TDS liabilities are represented and whether challans are created.
- Check the current certificate model and the synthetic `amount × 20` behaviour.
- Confirm the approved rule pack status. Do not print or file a certificate as final without verification.

IMPLEMENT
1. Formal receipt and payment documents with number, date, party, bank/cash account, amount, reference, attachment, status, created/approved by. One payment may allocate to multiple bills; one receipt to multiple invoices.
2. Allocation service with partial payments, discounts/write-offs (permissioned), overpayment/unapplied cash, and reversal. Update AR/AP open items and GL in one transaction.
3. Treasury liabilities: create VDS/TDS/AIT liabilities from actual withholding, with period, party, source document, amount, economic code and status.
4. Challan batch: select liabilities, choose bank/branch/date/reference, post Dr liability / Cr bank, mark deposited, store evidence. No duplicate deposit.
5. Certificate records: type, number, direction, party, original document, base, tax, date, status, challan link, evidence. Derive amounts from the source; do not multiply by an arbitrary factor. Mark outputs as draft until the statutory format is verified.
6. Register views: pending/deposited challans, certificates issued/received, reconciliation to VDS/TDS control accounts.
7. Approval and segregation of duties for payments above a configurable threshold.
8. Tests: partial/multiple allocation, overpayment, duplicate payment, duplicate deposit, certificate derivation, control proofs, permissions, tenant isolation.

DO NOT
- Do not implement bank statement import/reconciliation in this phase (Phase 10).
- Do not create a challan without a real liability.
- Do not invent a certificate base/rate or a statutory form number.
- Do not allow a certificate to be edited after issue; correct via cancellation/reissue with audit.
- Do not mark a return or certificate as filed.

EXPECTED USER-FACING BEHAVIOUR
A receipt/payment is allocated to open items and the subledger balance changes. A withholding payment creates a pending challan. A deposit clears the liability and links evidence. A certificate is generated from the source document and shows its review status.

TECHNICAL REQUIREMENTS
- Settlement and allocation are atomic.
- No duplicate allocation beyond the open amount.
- Challan/certificate records are persisted, not synthesised on render.
- Control accounts reconcile.
- Every action is audited.
- Statutory outputs are labelled DRAFT until approved.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build. Test allocation, overpayment, duplicate payment, duplicate deposit, certificate amounts, control proofs, approval thresholds and cross-company access.

ACCEPTANCE CRITERIA
- Receipts/payments reduce the correct open items.
- AR/AP/VDS/TDS control accounts reconcile after settlement.
- Challans and certificates are real, linked and auditable.
- Duplicate payment/deposit is blocked.
- Certificate amounts derive from the original document, not an arbitrary multiplier.
- No filing/audit claim is made.

BLOCKERS
Stop if the certificate format/rates are unverified, if the withholding liability model is unclear, or if Phase 8 AP is incomplete.
```

---

## Phase 10 — Banking, MFS and reconciliation

```text
PHASE 10 — BANKING, MFS AND RECONCILIATION

OBJECTIVE
Make bank/MFS reconciliation a real control based on imported statements, unique matching, exception handling and audited sign-off.

READ FIRST
- Master plan sections 7.11, 13.7, 16.5 and 17.
- Phase 9 report; verify bank accounts, receipts/payments and GL.
- Current W06, BankStatementLine type, reconcileBankLine, statementLineFromJournal and W07 BANK_MFS pipeline.

INSPECT BEFORE EDITING
- Verify bank accounts exist and are linked to GL accounts.
- Confirm whether statement import exists anywhere; if not, design a CSV template.
- Reproduce current issues: seeded/auto-matched lines, amount-only matching, double matching, local fee state, no create-GL.
- Confirm the approved MFS fee policy; do not hard-code 1.5% as a universal truth.

IMPLEMENT
1. Bank account CRUD: name, kind (bank/MFS/cash), provider, masked number, branch, GL account, opening balance, status. Restrict deactivation if referenced.
2. Bank transfers between accounts, with a linked journal pair and audit.
3. Statement import: CSV/XLSX template with mapping, preview, duplicate detection, error rows, source file retention, import batch. No auto-posting.
4. Statement lines: date, description, reference, debit/credit, balance if available, status, matched journal/document, match score.
5. Matching service: amount + date window + reference/party; exclude journals already used; support exact, partial/split and manual match; confidence reason; manual override with audit.
6. Create GL from statement line: choose account/party, amount, tax if relevant, reason; create a draft journal, require approval, then match. Do not silently plug to suspense without a queue.
7. MFS fees: configurable rate/fee rules per provider/account; post a fee journal once; prevent duplicate fee posting; allow manual fee override with evidence.
8. Reconciliation: by account and period; matched/unmatched/categorized; prepared/reviewed sign-off; lock the reconciliation when the period is closed; export a reconciliation report.
9. UI: import, queue, matched view, exceptions, create-GL, sign-off. Replace the demo statement table.
10. Tests: import validation, duplicate detection, unique matching, partial/split, create-GL approval, fee idempotency, period sign-off, permissions, tenant isolation.

DO NOT
- Do not auto-match a new transaction just because it created a statement line.
- Do not allow one journal to match multiple lines.
- Do not use a fixed 1.5% fee as a universal rule.
- Do not post unexplained bank activity directly to retained earnings.
- Do not implement live bank APIs in this phase.
- Do not claim reconciliation is complete without a reviewed sign-off.

EXPECTED USER-FACING BEHAVIOUR
An accountant imports a statement, sees unmatched lines, matches them or creates a reviewed journal, resolves fees once, and signs off the reconciliation. The bank GL and statement balance agree or the difference is explicit.

TECHNICAL REQUIREMENTS
- Import is permissioned, bounded and audited.
- Matching is deterministic and explainable.
- One journal line cannot settle multiple statement lines unless explicitly split/allocated.
- Reconciliation status is persisted.
- Every manual GL creation is approved and audited.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build. Test a CSV with duplicates/invalid rows, exact and partial matching, double-match prevention, fee posting twice, create-GL, sign-off and cross-company access.

ACCEPTANCE CRITERIA
- Statement import works with a documented template.
- Matching is unique and explainable.
- Exceptions have an owner and resolution path.
- Fees post once.
- Reconciliation sign-off is persisted and audited.
- No seeded/auto-matched lines masquerade as reconciliation.

BLOCKERS
Stop if bank/MFS formats or fee policies are undecided, if the chart of accounts lacks the necessary bank/fee accounts, or if Phase 9 settlement is incomplete.
```

---

## Phase 11 — Reports, VAT registers and financial statements

```text
PHASE 11 — REPORTS, VAT REGISTERS AND FINANCIAL STATEMENTS

OBJECTIVE
Replace fixed-period demo reports with correct, selectable, drillable reports and draft VAT schedules.

READ FIRST
- Master plan sections 6.12, 7.12, 13, 14.3–14.4, 17 and 3.4.
- Phase 10 report; verify ledger, documents, allocations, inventory, payments and challans.
- Current ifrsEngine, W05, W08, StatutoryPrintModal, W01 KPI derivation and VaultContext statement period.

INSPECT BEFORE EDITING
- Confirm the journal/document data is complete and status-aware.
- Reproduce: fixed October period, monthly-vs-annual labels, reversed documents in VAT, cash-flow plug, fabricated auditor report, missing drill-down.
- Confirm which tax rules are approved. If not approved, reports must show the review status and block any claim of filing.

IMPLEMENT
1. Report query layer on the server: trial balance, GL detail, P&L (month/YTD/year), balance sheet, cash flow, changes in equity, AR/AP ageing, stock valuation, VAT registers, VDS/TDS/challan register, journal listing.
2. Period selectors: range for P&L/cash flow, as-of for balance sheet; company/branch scope; comparative period/year selection. No hard-coded dates.
3. Correct labels: “for the month/period ended”, “for the year ended”, “as at”; never label a monthly report as annual.
4. Reversed documents excluded from active registers; credit notes and returns treated correctly; no placeholder lines.
5. VAT 9.1 draft: parts/registers, GL proof, exceptions, zero-variance check, DRAFT watermark, export/print. Do not claim filing. Do not print a government receipt.
6. Statements: derive from posted journals; balance/cash-flow checks; block export/close on failure; remove the cash-flow plug; add an “unaudited management accounts” label.
7. Drill-down: report line → accounts → journals → source document/tax decision/audit; works for reversed/imported/manual entries.
8. Remove the fabricated independent auditor’s report and any “audited” label from UI/print/export. Replace with a clearly labelled management-accounts cover.
9. Export/print: PDF/XLSX/CSV; figures match the screen; permissioned and audited; A4 layouts tested in English/Bangla.
10. Performance: indexes, pagination/streaming where needed; test with large data.
11. Tests: period boundaries, comparatives, reversals, credit notes, mixed tax, control proofs, export parity, cash-flow failure, permissions.

DO NOT
- Do not hard-code periods, dates, rates or filing deadlines.
- Do not generate an audit opinion or a filing acknowledgement.
- Do not include reversed/unposted documents in VAT output.
- Do not hide a reconciliation difference with a plug.
- Do not present a report as “audited” or “Big-4 grade”.
- Do not invent statutory line labels; mark unverified templates for professional review.

EXPECTED USER-FACING BEHAVIOUR
The accountant selects a period and sees the correct statements/registers. A November transaction appears in November. A reversed invoice disappears from the VAT output. Every line drills to evidence. The VAT return is marked draft. Management accounts are marked unaudited, with no fake auditor report.

TECHNICAL REQUIREMENTS
- All report queries are company-scoped and permissioned.
- Money totals are exact; no floating-point aggregation.
- Export and print use the same source as the screen.
- VAT/statutory templates are versioned and marked review status.
- Report performance is bounded; no full-table scans on large data.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, report snapshot tests, export parity tests and performance checks. Test period boundaries, reversed docs, credit notes, and a failed cash-flow reconciliation.

ACCEPTANCE CRITERIA
- Reports use the selected period and scope.
- Trial balance/balance sheet/cash flow checks are correct and block export on failure.
- VAT registers exclude reversed docs and show correct credit-note treatment.
- Drill-down reaches the source.
- No fabricated audit/filing claim exists anywhere.
- Exports match the screen.
- Tests cover the correction and reversal cases.

BLOCKERS
Stop if the tax rules/templates are unverified, if the data model cannot distinguish reversed/posted documents reliably, or if the accountant has not approved the report definitions.
```

---

## Phase 12 — Close, approvals, controls and audit log

```text
PHASE 12 — CLOSE, APPROVALS, CONTROLS AND AUDIT LOG

OBJECTIVE
Make month-end close and internal control real: persisted close runs, maker-checker, approval thresholds, period enforcement and an immutable audit log.

READ FIRST
- Master plan sections 7.13, 7.17, 13, 15.4 and 16.5.
- Phase 11 report; verify reports, periods and control proofs.
- Current W09, VaultContext setPeriodStatus/reverseJournal, LedgerLensModal and permission matrix.

INSPECT BEFORE EDITING
- Verify period status enforcement at the API/database.
- Verify control proofs and suspense derivation.
- Reproduce: local/hard-coded sign-offs, maker/checker toggle, CLOSED posting loophole, unused high-value approval, no audit log, one-click suspense write-off.
- Confirm which close steps can actually be automated with the current modules; do not include a step that cannot pass.

IMPLEMENT
1. Audit log: append-only events for auth, master data, documents, journals, payments, reversals, period changes, exports/imports, approvals and permission denials. Include actor/session/time/before/after/reason/IP/user-agent where appropriate. Provide a viewer and export.
2. Approval engine: configurable thresholds by company/document type; maker-checker; no self-approval; required reason for overrides; approval/rejection history. Enforce on the server.
3. Close run: period, checklist, control results, exceptions, evidence, maker, checker, timestamps, status. Persist; no local component state.
4. Close checklist: only include controls that exist (TB, control proofs, bank reconciliation, VAT proof, suspense, required accruals/depreciation if implemented, audit chain if still used). A new company must not be blocked by a module that is not in scope; either implement the module or remove the step with a documented reason.
5. Period status: OPEN/CLOSED/LOCKED; close requires a complete persisted run and a different checker; reopen requires a separate permission, reason, audit and possibly a second approver. Posting to CLOSED/LOCKED is rejected.
6. Suspense: target account, reason, attachment, approval; no one-click retained-earnings write-off. Ageing and ownership.
7. High-value approval: enforce the permission/threshold on documents, payments, journals and reversals; auditor read-only.
8. Close pack export and audit evidence.
9. Tests: close happy path, failed control, self-approval rejection, maker=checker rejection, lock enforcement, reopen, audit completeness, threshold/role matrix, tenant isolation.

DO NOT
- Do not hard-code signatory names.
- Do not store sign-offs in component state.
- Do not allow the same user to be maker and checker.
- Do not allow CLOSED periods to accept normal postings.
- Do not let an admin silently edit/delete audit events.
- Do not include a close step that cannot pass for a valid new company.
- Do not claim the close is complete without persisted evidence.

EXPECTED USER-FACING BEHAVIOUR
A controller prepares the close, sees which controls pass/fail, resolves exceptions, submits; a different authorised checker approves; the period locks. Posting after lock is rejected with a clear message. Reopening requires a reason and is audited. The audit log shows the full history.

TECHNICAL REQUIREMENTS
- Approval and close decisions are server-side and transactional.
- Audit log is append-only and queryable.
- Period enforcement is database/API-level.
- Thresholds and roles are configuration, not code comments.
- No self-approval or privilege escalation.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build. Test close with a failed control, self-approval, maker=checker, lock bypass, reopen, audit export and cross-company access.

ACCEPTANCE CRITERIA
- Close run is persisted with evidence and real users.
- Maker ≠ checker enforced.
- CLOSED/LOCKED periods reject postings.
- Reopen is permissioned, reasoned and audited.
- High-value approvals work.
- Audit log covers material actions and cannot be silently altered.
- No hard-coded names or local sign-offs remain.

BLOCKERS
Stop if the close checklist depends on modules not in scope, if the approval policy/thresholds are undecided, or if the audit-log retention/legal requirements are unclear.
```

---

## Phase 13 — Public landing page and design system foundation

```text
PHASE 13 — PUBLIC LANDING PAGE AND DESIGN SYSTEM FOUNDATION

OBJECTIVE
Establish a credible public identity and a reusable, accessible professional design system, starting with the marketing site and auth pages.

READ FIRST
- Master plan sections 10 and 11.
- Phase 3/14 work for auth routes; current index.html, index.css, tailwind config, BrandMark, App shell and auth pages.
- The actual product screens that can be shown honestly (server-backed flows only).

INSPECT BEFORE EDITING
- Confirm which workflows are genuinely implemented; do not screenshot fake ones.
- Inventory current design tokens, fonts, colours, radii, shadows and components.
- Confirm the public routes and auth routes.
- Check bundle size, font loading and accessibility.

IMPLEMENT
1. Define the Quiet Ledger design tokens: colour, typography, spacing, radius, shadow, breakpoints, focus, motion. Put them in CSS variables/Tailwind; document them.
2. Build the public landing page with the sections in the master plan: header, hero, problem, workflows, capabilities, Bangladesh fit, controls, audience, onboarding, pricing/contact, FAQ, final CTA, footer.
3. Use real product screenshots from implemented flows; label demo data clearly. No fake customer logos, testimonials, certifications or audit claims.
4. Build accessible login/forgot/reset/invite pages using the new tokens.
5. Add a component gallery/internal design page showing buttons, inputs, tables, states, dialogs, alerts, badges, empty/loading/error states.
6. Self-host fonts or provide a reliable local fallback; remove avoidable external font dependency.
7. Responsive: 360px, 768px, 1440px; no horizontal overflow; legible text.
8. Accessibility: WCAG 2.2 AA for the landing/auth pages; keyboard, focus, contrast, reduced motion.
9. Performance: marketing site should not load the app bundle; use static assets, lazy images, sensible caching. Target LCP < 2.5s.
10. SEO/metadata: title, description, canonical, Open Graph, structured data; no misleading claims.
11. Tests: link/CTA, responsive screenshots, Lighthouse/axe, auth-page E2E.

DO NOT
- Do not redesign all twelve workspaces in this phase.
- Do not use aurora/grain/glass/random gradients or decorative SVG in the marketing/auth core.
- Do not use tiny text or uppercase tracking for working labels.
- Do not make unverified compliance/security claims.
- Do not show a fake dashboard or fake “audited” report.
- Do not add a heavy marketing framework.

EXPECTED USER-FACING BEHAVIOUR
A visitor sees a professional, credible site, understands the product and can sign in/request a demo. The login/reset/invite pages are clear and accessible. The design system is visibly consistent.

TECHNICAL REQUIREMENTS
- Tokens are the single source of truth; no arbitrary hex values in components.
- Landing is separate from the app bundle where practical.
- Auth pages use real server flows from Phase 3.
- No false claims; legal/tax disclaimers are clear.
- Accessibility and performance budgets are measured.

VALIDATION
Run typecheck, lint, tests, build. Run Lighthouse/axe on landing/auth; test at 360/768/1440; test keyboard-only; verify CTAs.

ACCEPTANCE CRITERIA
- Landing page is live and honest.
- Auth pages work and are accessible.
- Design tokens and core components are documented and used.
- No fake claims/content.
- Performance/accessibility targets met for the public/auth pages.
- Existing app still runs (even if not yet restyled).

BLOCKERS
Stop if brand naming/positioning, legal disclaimers, pricing, or demo-vs-production policy are undecided. Do not invent customer logos, certifications or claims.
```

---

## Phase 14 — Application shell, dashboard and workflow UX

```text
PHASE 14 — APPLICATION SHELL, DASHBOARD AND WORKFLOW UX

OBJECTIVE
Make the authenticated product fast to learn and efficient to operate, using the design system and the real server-backed workflows.

READ FIRST
- Master plan sections 8, 11, 12 and 21.
- Phase 13 report; verify the design system and auth pages.
- Phases 5–12; verify the workflows are real.
- Current App, Sidebar, TopBar, CommandPalette, W01–W12 and localization.

INSPECT BEFORE EDITING
- Confirm which modules are server-backed and safe to expose.
- Inventory every route, nav item and fake workflow.
- Identify dead/disabled screens that must be hidden.
- Check current accessibility/responsive/localization gaps.
- Confirm the role matrix and which nav items each role should see.

IMPLEMENT
1. New app shell: role-aware sidebar/navigation, company/branch switcher, global search/command palette, breadcrumbs, page headers, user menu, help.
2. Dashboard: action-oriented, role-aware, four KPI cards maximum, cash, overdue AR/AP, tax due, approvals, close status, exceptions, quick actions. No decorative Sankey/forecast unless it is real and useful.
3. Routes: list/detail/create/review/report/settings pages; deep links; back/forward; unsaved-change guard; 404/permission-denied.
4. Rebuild the core screens using the design system: invoices, bills, receipts, payments, journals, banking, reports, close, settings. Apply to real workflows only.
5. Forms: autosave server drafts, validation summary, field errors, review step, sticky actions, attachments where supported.
6. Tables: server pagination, filters, saved views, column choice, bulk actions, empty/loading/error/permission states.
7. Global search: entities (documents, parties, accounts, journals) and actions, permission-aware.
8. Localization: finish key migration; no inline user-facing strings; review Bangla; number/date formatting.
9. Accessibility/responsive: WCAG 2.2 AA, keyboard journeys, 360/768/1440, self-hosted fonts.
10. Remove/hide demo modules that are not production-ready (payroll, secretarial, practice cockpit, fake stages) rather than leaving dead buttons.
11. Tests: E2E critical journeys, accessibility, responsive, localization, permissions.

DO NOT
- Do not restyle fake workflows.
- Do not keep all 12 equal nav items if the product is smaller; hide what is not ready.
- Do not add a feature just to fill the dashboard.
- Do not break deep links, permissions or server flows.
- Do not reintroduce a role switcher or demo data in production.
- Do not use text below 12px or colour-only statuses.

EXPECTED USER-FACING BEHAVIOUR
A new accountant can sign in, see what needs attention, create/allocate/post the core documents, find anything via search, and understand the next step. An experienced accountant can work quickly with keyboard and dense tables. An auditor sees read-only evidence.

TECHNICAL REQUIREMENTS
- Every nav item and action is backed by a real API/permission.
- No fake/placeholder screen in production.
- Drafts survive refresh; posting has a review step; save state is visible.
- Route-level code splitting; xlsx/charts lazy-loaded.
- Localization and accessibility are part of the definition of done.

VALIDATION
Run typecheck, lint, unit/integration/E2E tests, build, Lighthouse/axe, responsive screenshots. Conduct usability sessions with 2–3 accountants; record findings and fix critical issues.

ACCEPTANCE CRITERIA
- Core journeys are completable by target roles.
- Dashboard answers “what needs me today?” without clutter.
- No fake module/button remains.
- Search, filters, tables, forms and error states are consistent.
- Bangla/English are complete for the exposed screens.
- Accessibility/responsive targets met.
- Tests cover the journeys and permissions.

BLOCKERS
Stop if a workflow is not actually implemented, if the role/nav model is undecided, or if a redesign would expose fake data. Do not “finish” the UI by hiding unfinished features without documenting the product gap.
```

---

## Phase 15 — Localization, hardening, performance and release readiness

```text
PHASE 15 — LOCALIZATION, HARDENING, PERFORMANCE AND RELEASE READINESS

OBJECTIVE
Close the gap between a working product and a dependable release: complete localization, security, testing, performance, backup/recovery and operations.

READ FIRST
- Master plan sections 12, 15, 19, 20, 23 and 24.
- All prior phase reports; verify every dependency.
- Current tests, CI, security config, deployment docs and translation files.

INSPECT BEFORE EDITING
- Run the full suite and record the real current state.
- Audit for missing translation keys, inline strings, hard-coded dates/rates, TODOs, fake data, role bypasses and export/import risks.
- Check bundle size, slow queries, backup configuration and restore evidence.
- Verify the tax rule pack review status and the legal disclaimers.

IMPLEMENT
1. Localization: complete key migration; native accountant review; report/PDF/Excel strings; pluralization/interpolation; locale formatting tests; self-host fonts.
2. Security: CSP/headers, CSRF, session configuration, rate limits, permission tests, tenant isolation tests, dependency/secret/container scans, file upload limits, PII masking, export controls.
3. Testing: fill unit/integration/E2E gaps; property tests for money/journal invariants; accessibility tests; migration tests; backup restore drills; load tests.
4. Performance: route splitting, lazy XLSX/charts, query indexes, pagination, report budgets, bundle budgets.
5. Reliability: health checks, monitoring/alerts, error tracking, backup/PITR, restore runbook, incident response, failed-job handling.
6. Release: staging deployment, migration rehearsal, UAT with accountants, release checklist, rollback plan, support playbook, admin/accountant guides.
7. Remove dead demo routes/assets that are not clearly labelled; ensure demo data cannot mix with production.
8. Verify no critical/high defect from the master-plan register remains open; if one does, stop and report it.

DO NOT
- Do not waive accounting/security gates to hit a date.
- Do not claim “production-ready” without evidence.
- Do not hide failing tests or known limitations.
- Do not leave fake audit/filing claims, hard-coded rates or demo data in production.
- Do not deploy without a tested backup restore and rollback plan.

EXPECTED USER-FACING BEHAVIOUR
The product is complete in its stated scope, bilingual, accessible, fast enough, secure and recoverable. A pilot customer can complete an accounting period with support.

TECHNICAL REQUIREMENTS
- CI green; no critical/high security findings.
- All critical journeys have E2E coverage.
- Backups run and restore is proven.
- Monitoring/alerts are live.
- Performance budgets are met.
- Documentation/runbooks exist.

VALIDATION
Run the full suite, security scan, accessibility audit, performance test, restore drill, migration rehearsal and UAT. Record exact results and remaining limitations.

ACCEPTANCE CRITERIA
- Master-plan release gate passed.
- Tax/legal claims reviewed and labelled.
- All core workflows work for each role.
- No cross-tenant access or role bypass.
- Backup restore demonstrated.
- Localization/accessibility/performance targets met.
- Support and rollback plans ready.
- Known limitations documented and accepted by the human.

BLOCKERS
Stop if the tax counsel/accountant UAT is unavailable, if a critical defect/security finding remains, if backup restore fails, or if deployment/legal decisions are unresolved. Do not declare release readiness without human sign-off.
```

---

## Phase dependency map

| Phase | Depends on | Produces |
|---|---|---|
| 0 | — | Git, CI, scripts, baseline |
| 1 | 0 | Corrected domain invariants and tests |
| 2 | 0 | Server, Postgres, migrations, health |
| 3 | 2 | Auth, organisations, memberships, invitations |
| 4 | 3 | Company setup, periods, COA, DRAFT opening batch |
| 5 | 4 | Server ledger, manual journal, trial balance, posted opening balances |
| 6 | 5 | Parties, items, warehouses, stock ledger |
| 7 | 6, 5 | Sales invoices, credit notes, receipts, AR |
| 8 | 7, 6 | Purchases, GRN, bills, payments, AP |
| 9 | 8 | Allocations, treasury, challans, certificates |
| 10 | 9 | Bank/MFS import, reconciliation |
| 11 | 10 | Reports, VAT registers, statements |
| 12 | 11 | Close, approvals, audit log |
| 13 | 3 (auth pages) | Landing, auth visuals, design system |
| 14 | 12, 13 | App shell, dashboard, workflow UX, localization |
| 15 | All | Hardening, performance, release |

**Note on Phase 4 and Phase 5:** Phase 4 prepares and validates the opening-balance batch but must not mark it posted. Phase 5 posts it through the ledger service. If the product requires opening balances to be posted earlier, split Phase 4 into 4A (company/COA/periods) and 4B (opening balances after the ledger service), or move Phase 5 earlier. Do not fake a posted opening balance.

---

## What to do when the user asks to “go faster”

Do not skip phases or combine several large phases into one prompt. A safe acceleration is:

- Run independent design work (Phase 13) in parallel with backend phases, provided it does not touch fake workflows.
- Split a phase into smaller vertical slices (for example, invoice posting before credit notes).
- Reduce scope within a phase, not quality gates.
- Defer non-MVP modules (payroll, secretarial, fixed assets, practice cockpit).

Never accelerate by:

- Removing tests or bypassing authorization.
- Keeping localStorage as the source of truth.
- Hard-coding rates or dates to make a demo work.
- Marking a fake screen as complete.
- Skipping backup restore or tenant-isolation checks.

---

*End of execution prompts.*
