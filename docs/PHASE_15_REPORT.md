PHASE COMPLETION REPORT

Phase: 15 — Localization, hardening, performance and release readiness
Status: BLOCKED

Summary: A controlled hardening pass was completed. The build now injects a production CSP that pins the intentional inline scripts by SHA-256; new gates verify built security metadata, tracked-file secrets and gzip bundle budgets; a repeatable PostgreSQL backup/restore drill was implemented and passed; deterministic property tests cover money parsing/formatting, basis-point rounding and generated journals; localization parity/placeholder/format tests were added; import size/row limits and a 12px audit-log text floor were added; and operations, security, release, support, admin, accountant, localization and UAT documents were written. Release readiness is still BLOCKED. The high `xlsx@0.18.5` advisory has no npm fix; production email is not configured; native accountant/tax-counsel UAT did not occur; staging deployment, rollback rehearsal and live monitoring are not configured; several deep-panel setup/banking/purchase strings remain English-only; and no human release sign-off exists.

Files changed:

- `src/security/csp.ts` — builds/hashes the production CSP and injects it once into the HTML build.
- `vite.config.ts` — runs the CSP injection for production builds and supports absolute API origins.
- `scripts/check-built-security.mjs` — re-hashes built inline scripts and verifies CSP/referrer/font/script rules.
- `scripts/check-bundle-budget.mjs` — enforces gzip budgets for entry, auth, shell, page, CSS, XLSX and demo chunks.
- `scripts/check-secrets.mjs` — scans tracked files for high-confidence provider/private keys and non-local DB passwords.
- `scripts/backup-restore-drill.mjs` — creates disposable databases, migrates, dumps, restores and compares schema/data.
- `package.json` — adds `check:secrets`, `check:bundle`, `check:built-security` and `drill:backup-restore`.
- `.github/workflows/ci.yml` — runs secret scan, restore drill, bundle budget and built-security gate.
- `eslint.config.js` — applies Node globals to the new `.mjs` operational scripts.
- `tests/security.test.ts` — proves CSP hashing, API-origin handling and single injection.
- `tests/localization.test.ts` — proves key parity, non-empty values, placeholder parity and locale formatting.
- `tests/money-invariants.test.ts` — deterministic property tests for poisha parsing, rounding and balanced journals.
- `server/tests/unit/app.test.ts` — verifies API CSP, frame denial, nosniff, referrer, COOP, HSTS and no-store.
- `src/pages/purchases/purchasesUi.tsx` — adds a rolling one-year statement/report default date.
- `src/pages/purchases/PayablesPanel.tsx` — replaces a hard-coded 2026 statement start date.
- `src/pages/treasury/TreasuryPage.tsx` — replaces a hard-coded 2026 statement start date.
- `src/pages/banking/ImportPanel.tsx` — dynamic CSV template dates and 1 MB/5,000-row import guard.
- `src/pages/setup/ChartOfAccountsStep.tsx` — 1 MB/5,000-row import guard.
- `src/core/import-export/xlsxEngine.ts` — demo import size/row guard.
- `src/pages/audit/AuditLogPage.tsx` — raises 11px working text to 12px.
- `src/pages/sales/DocumentListPanel.tsx` — removes a year-specific invoice search example.
- `README.md` — records Phase 15 gates, commands and NO-GO release status.
- `server/README.md` — documents the restore drill and matching client/server major version requirement.
- `docs/OPERATIONS.md` — health, logs, alerts, backup/PITR, restore, migration, incidents and headers.
- `docs/SECURITY_REVIEW.md` — verified controls, open high advisory and security decisions.
- `docs/RELEASE_CHECKLIST.md` — mandatory gates with current PASS/FAIL/NOT RUN evidence.
- `docs/SUPPORT_PLAYBOOK.md` — triage, common failures, escalation and safe support rules.
- `docs/ADMIN_GUIDE.md` — setup, roles, approvals, periods, exports and data protection.
- `docs/ACCOUNTANT_GUIDE.md` — period workflow, sales/purchases/treasury/reports/corrections and controls.
- `docs/UAT_PLAN.md` — 25 controlled scenarios and sign-off record; not executed.
- `docs/LOCALIZATION.md` — current coverage, remaining gaps and native review checklist.
- `docs/IMPLEMENTATION_NOTES.md` — Phase 15 record and evidence links.
- `docs/PHASE_15_REPORT.md` — this report.

Database/migrations: none. No schema, posting, period, reversal, tax, report or audit logic was changed.

Commands run and actual results:

- `npm run typecheck` → exit 0; app, test and server TypeScript pass.
- `npm run lint` → exit 0; 0 errors, 44 pre-existing warnings.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 15 files, 83 tests passed.
- `TEST_DATABASE_URL=<local PostgreSQL 16.15> npm run test:server` → exit 0; 26 files, 157 tests passed against real PostgreSQL.
- `npm run selfcheck` → exit 0; core/actions/import/gate passed, including 25/25 golden tax vectors, 62 seeded journals, six control proofs and the 9-tab audit pack.
- `npm run build` → exit 0; production Vite build completed. Entry 104.50 KB gzip; auth entry 55.44; production shell 17.46; largest non-demo page 34.36; lazy XLSX 141.75; isolated DemoShell 408.17. Warning: `VITE_PUBLIC_SITE_URL` unset and DemoShell exceeds Vite’s 1,600 KB raw warning.
- `npm run build:server` → exit 0.
- `npm run check:bundle` → exit 0; 60 chunks within budgets (level-9 gzip: entry 101.91 KB, XLSX 138.19, DemoShell 393.78).
- `npm run check:built-security` → exit 0; 13 checks passed, both inline script hashes match.
- `npm run check:secrets` → exit 0; no high-confidence secrets in tracked files.
- `PG_DUMP=<PostgreSQL 16.15> PG_RESTORE=<PostgreSQL 16.15> npm run drill:backup-restore` → exit 0; 12 migrations, 62 tables, 480,913-byte custom dump, restore succeeded and every table row count matched. The default PATH client was 17 against a 16 server and correctly failed fast; use matching client binaries.
- `npm audit --omit=dev` → exit 1; one high advisory for `xlsx@0.18.5` (GHSA-4r6h-8v6p-xvw6 prototype pollution; GHSA-5pgg-2g8v-p4x9 ReDoS), no fix available.
- `git diff --check` → exit 0; no whitespace errors.
- Browser CSP smoke on the production preview → landing and login rendered with no CSP console errors; the lazy XLSX chunk imported and parsed a small CSV under the policy. The preview `/api/v1/auth/me` 500 is expected because the preview was run without the API; it is not a CSP failure.
- Lighthouse (in-app browser) on landing and login → accessibility 1.00, best-practices 1.00, SEO 1.00 on both.
- Docker/container scan → not run; Docker is not installed in this environment.
- Staging deployment, migration rehearsal on staging, load test, accountant UAT, native Bangla review, screen-reader pass, 360/768 screenshot matrix and live alert firing → not run.

Acceptance criteria:

- Master-plan release gate passed: FAIL — mandatory gates remain open (high dependency advisory, production email, tax/accountant review, staging/rollback, monitoring, human sign-off).
- Tax/legal claims reviewed and labelled: FAIL — labels are honest (`PENDING_TAX_COUNSEL`, `DRAFT — NOT FILED`, unaudited management accounts) and posting is blocked without reviewer approval, but no qualified reviewer signed the pack/templates.
- All core workflows work for each role: PARTIAL — server integration tests cover auth, tenant isolation, ledger, inventory, sales/AR, purchases/AP, treasury, banking, reports and close; browser UAT did not complete a full period with real users.
- No cross-tenant access or role bypass: PASS — integration tests cover cross-company 404s, role enforcement, auditor read-only, self-role changes and last-owner protection.
- Backup restore demonstrated: PASS — disposable 12-migration/62-table database dumped and restored with exact table row counts.
- Localization/accessibility/performance targets met: FAIL/PARTIAL — dictionary parity/formatting and public/auth Lighthouse pass; deep setup/banking/purchase strings remain English-only, native review/360/768/screen-reader evidence is missing; bundle and report-performance budgets pass.
- Support and rollback plans ready: PARTIAL — support, operations, admin, accountant and UAT documents exist; rollback is documented but not rehearsed on staging.
- Known limitations documented and accepted by the human: FAIL — limitations are documented here but no human acceptance record exists.

Tests added/updated:

- `tests/money-invariants.test.ts` — 500 parsing round trips, 500 rounding bounds, 200 formatted amounts and 200 generated balanced journals plus a one-poisha rejection.
- `tests/localization.test.ts` — key parity, non-empty dictionaries, placeholder parity, fallback, lakh/crore/millions, negatives/zero, Bangla digits, dates and interpolation.
- `tests/security.test.ts` — inline-script extraction/hashing, no `unsafe-inline` scripts, API-origin `connect-src`, single idempotent CSP injection and no false `frame-ancestors` meta claim.
- `server/tests/unit/app.test.ts` — API security headers and production HSTS.
- `scripts/check-built-security.mjs`, `scripts/check-bundle-budget.mjs`, `scripts/check-secrets.mjs` — repeatable release checks.
- `scripts/backup-restore-drill.mjs` — backup/restore proof.

Security/accounting review notes:

- Authorization/tenant scope: unchanged and still server-enforced. Every company route resolves membership; client company IDs are not trusted; cross-tenant responses are 404. New tests do not weaken this.
- Posting/idempotency/reversal/period: unchanged. Existing PostgreSQL tests prove atomic posting, exact balance, duplicate/idempotency handling, linked once-only reversal, approval thresholds and UNKNOWN/CLOSED/LOCKED rejection.
- Audit: unchanged append-only events; exports remain permissioned and audited.
- Money: unchanged BigInt poisha; new property tests prove no authoritative floating-point path.
- Security headers: API CSP/HSTS/frame denial verified; static build CSP pins inline scripts by hash. A meta CSP cannot enforce `frame-ancestors`; the edge must set X-Frame-Options/frame-ancestors and HSTS.
- Import limits: browser now rejects files over 1 MB and worksheets over 5,000 rows; the API body limit remains 1 MiB. This reduces but does not remove the `xlsx` advisory risk.
- Secrets: no high-confidence secrets found in tracked files. `.env` remains ignored.
- Accessibility: audit-log 11px text raised to 12px; public/auth Lighthouse accessibility 1.00. Deep-page screen-reader/Bangla review remains open.

Known limitations:

- Release blocker: `xlsx@0.18.5` has two high advisories and no npm fix. Do not claim the dependency gate is green.
- Release blocker: production email delivery is not configured; invitations, verification and reset use the development file outbox.
- Release blocker: no native Bangladeshi accountant/tax-counsel review or UAT sign-off; the rule pack remains `PENDING_TAX_COUNSEL`.
- Release blocker: no staging deployment, no migration rehearsal on staging, no rollback rehearsal against a staging copy.
- Release blocker: no live monitoring/alerting or error-tracking vendor; health/logs/audit are ready but alert firing is unproven.
- Release blocker: no human release approval.
- Localization remains incomplete in setup step bodies, banking workbench, parts of purchases and report internals; dictionary parity is not proof of full visible translation.
- No automated browser E2E harness. Critical browser journeys were not re-run end-to-end in this phase.
- No load test at target concurrency, no container scan (Docker unavailable), no SAST/DAST tool report, no 200% zoom/360/768 screenshot matrix or Bangla screen-reader pass.
- Backup restore is proven on disposable databases; production WAL archiving/PITR, encryption and off-site retention are hosting tasks and were not configured.
- No background job system exists; failed-job handling is a future requirement.
- `VITE_PUBLIC_SITE_URL` was not set for the local build; canonical/OG URLs point at localhost until the production origin is decided.

Manual or external decisions required:

- Replace or formally risk-accept `xlsx@0.18.5` with a reviewed, patched spreadsheet engine.
- Configure production email delivery (SMTP/provider) and verify invitation/reset delivery.
- Native Bangladeshi accountant review of terminology and all deep-panel strings; 2–3 accountant UAT sessions; Bangla screen-reader pass.
- Tax counsel/accountant sign-off of the rule pack, statutory templates, certificate format and filing labels with sources and dates.
- Hosting/domain/TLS/static security headers, staging environment, migration rehearsal, load test, monitoring/alerting and error tracking.
- Encrypted backups, WAL archiving/PITR, off-site retention and a production restore/rollback rehearsal.
- Legal/privacy review: terms, privacy policy, retention/deletion, breach notification and data-processing obligations.
- Container/SAST/DAST scanning in the deployment pipeline.
- Human acceptance of the known limitations and a named release approver.

Next-phase dependency verified: NO — Phase 15 is the final phase in the plan. Release readiness is blocked by the external and security items above; no next phase should start.

Blocker: The release cannot be declared ready. Required decisions/actions are: (1) replace or formally risk-accept the high `xlsx` advisory, (2) configure production email, (3) obtain native accountant/tax-counsel rule-pack and template sign-off plus UAT, (4) deploy staging and rehearse migration/rollback/restore with monitoring alerts firing, and (5) obtain human release approval. Until then the product must not be presented as production-ready or used for real statutory filing.
