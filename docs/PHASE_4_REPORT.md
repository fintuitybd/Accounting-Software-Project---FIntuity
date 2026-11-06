# Phase 4 — Company Onboarding, Chart of Accounts and Periods

**Status:** COMPLETE

**Completed:** 06 November 2026

## Summary

Phase 4 adds a server-authoritative company setup capability on top of the Phase 3 identity layer:

- Company creation and profile editing with legal identity, entity type, industry, TIN/BIN/RJSC
  format checks (not statutory validation), registered address, contact, reporting framework,
  fixed BDT base currency and the Asia/Dhaka time zone.
- Fiscal-year creation with dynamically generated monthly `OPEN` periods, overlap rejection at the
  application and database layers, non-July start support, and a date-resolution endpoint that
  rejects dates outside every configured period.
- Chart-of-accounts CRUD with hierarchy, code uniqueness per company, IFRS category, tax mapping,
  control subledgers and database-level protection against recoding, repurposing or deactivating a
  control account. CSV import is parsed on the server; XLSX rows are parsed in the browser and
  revalidated on the server. Imports are atomic and report row-level errors without partial inserts.
- Opening-balance batches with account, party, item and fixed-asset schedules, evidence reference,
  note/checksum support, server-computed totals and a balanced-submit guard. The batch can only be
  `DRAFT` or `SUBMITTED`; the database rejects a `POSTED` status because the Phase 5 ledger service
  does not exist yet.
- Bank/cash/MFS accounts with a `BANK_MFS` GL mapping, masked-only account numbers, one active
  principal account, and audit coverage when the principal is reassigned.
- Company settings for language, reporting framework, approval thresholds, tax configuration and
  document numbering sequences, with append-only audit events.
- A resumable `/app/setup` wizard that persists the current step and all setup data on the server,
  plus organisation-menu links to configure the active company or create another company without
  deleting or resetting the first.

The real-mode shell still withholds invoices, journals, posting and reports. The opening-balance
batch is deliberately **not posted**; it remains `SUBMITTED` pending Phase 5.

## Files changed

- `server/migrations/0003_company_setup.up.sql` — Phase 4 tables, constraints, triggers and indexes.
- `server/migrations/0003_company_setup.down.sql` — development/test rollback of Phase 4 tables.
- `server/src/company/constants.ts` — shared Phase 4 vocabularies and document-type defaults.
- `server/src/company/money.ts` — exact BDT-to-poisha and quantity parsing.
- `server/src/company/dates.ts` — dynamic fiscal-year generation and database date formatting.
- `server/src/company/csv.ts` — server-side CSV parser for chart-of-accounts import.
- `server/src/company/companyService.ts` — company profile create/update and completeness rules.
- `server/src/company/periodService.ts` — fiscal year/period creation, overlap checks and date resolution.
- `server/src/company/accountService.ts` — COA CRUD, control protection, CSV/XLSX row import.
- `server/src/company/openingBalanceService.ts` — draft/submit opening batches and schedule validation.
- `server/src/company/bankAccountService.ts` — bank/cash/MFS setup, masked numbers and principal rule.
- `server/src/company/settingsService.ts` — settings and number-sequence validation/audit.
- `server/src/company/onboardingService.ts` — computed progress, persisted step and completion gate.
- `server/src/routes/companySetup.ts` — company, onboarding, fiscal year, period, bank and settings APIs.
- `server/src/routes/accounts.ts` — chart-of-accounts and import APIs.
- `server/src/routes/openingBalances.ts` — opening-balance APIs.
- `server/src/app.ts` — registers the Phase 4 route plugins.
- `server/src/db/schema.ts` — Drizzle column bindings for the Phase 4 tables.
- `server/tests/integration/companySetup.test.ts` — API onboarding/E2E, isolation, period, COA and opening tests.
- `server/tests/integration/migrations.test.ts` — expects and rolls back the Phase 4 migration.
- `server/tests/unit/companySetup.test.ts` — exact money, date/period and CSV unit tests.
- `src/setup/api.ts` — typed frontend API client for setup resources.
- `src/pages/setup/CompanySetupPage.tsx` — resumable wizard shell and company creation.
- `src/pages/setup/CompanyProfileStep.tsx` — company identity form.
- `src/pages/setup/FiscalYearStep.tsx` — fiscal-year generation, period list and date check.
- `src/pages/setup/ChartOfAccountsStep.tsx` — COA list/editor, deactivation and import.
- `src/pages/setup/OpeningBalancesStep.tsx` — draft editor, schedules, evidence and submit.
- `src/pages/setup/BankAccountsStep.tsx` — bank/cash/MFS setup and principal management.
- `src/pages/setup/CompanySettingsStep.tsx` — language, thresholds, tax and numbering settings.
- `src/pages/setup/setupUi.tsx` — shared setup form/error/status controls.
- `src/App.tsx` — `/app/setup` route and Phase 4 footer.
- `src/auth/api.ts` — preserves API error details for import validation.
- `src/components/layout/TopBar.tsx` — setup and create-another-company menu entries.
- `src/components/layout/Sidebar.tsx` — Phase 4 shell label.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — setup links and Phase 4 copy.
- `README.md` — Phase 4 run/feature notes.
- `server/README.md` — backend scope and limitations updated for Phase 4.
- `docs/IMPLEMENTATION_NOTES.md` — Phase 4 record index entry.
- `docs/PHASE_4_REPORT.md` — this report.

## Database/migrations

`server/migrations/0003_company_setup.up.sql` and `0003_company_setup.down.sql` add:

- `company_onboarding` — server-persisted wizard step and completion timestamp.
- `fiscal_years` — company-scoped fiscal-year ranges with explicit status and overlap trigger.
- `periods` — monthly periods with `OPEN`/`CLOSED`/`LOCKED`, overlap trigger and composite
  company/fiscal-year foreign key.
- `accounts` — company-scoped chart of accounts, hierarchy, control subledger, tax mapping and a
  control-account protection trigger.
- `company_settings` — validated key/value settings for language, approval thresholds and tax.
- `number_sequences` — per-company/fiscal-year document prefixes, next values, padding and version.
- `bank_accounts` — bank/cash/MFS master, unique GL mapping, masked number and one-principal index.
- `opening_balance_batches` — `DRAFT`/`SUBMITTED` only, evidence, server totals and a partial unique
  index preventing duplicate draft or submitted batches.
- `opening_balance_lines` — account lines with schedule type/JSON, exactly one positive debit or
  credit, and composite tenant foreign keys.

All tables use `company_id` and composite foreign keys for tenant consistency. The down migration
drops the Phase 4 configuration tables in reverse dependency order; no posted financial history
exists in this phase.

## Commands run and actual results

| Command                                         | Result                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                          | exit 0 — all matched files use Prettier style                                                             |
| `npm run typecheck`                             | exit 0 — frontend, test and server TypeScript                                                             |
| `npm run lint`                                  | exit 0 — 0 errors; 42 pre-existing warnings in untouched legacy files                                     |
| `npm test`                                      | exit 0 — 5 files, 41 tests passed                                                                         |
| `TEST_DATABASE_URL=... npm run test:server`     | exit 0 — 11 files, 60 tests passed (26 PostgreSQL integration tests, including 9 new Phase 4 tests)       |
| `npm run selfcheck`                             | exit 0 — all domain, ledger, tax, import and gate checks passed                                           |
| `npm run build`                                 | exit 0 — Vite production build; existing large-chunk warning, now 2,062 kB                                |
| `npm run build:server`                          | exit 0                                                                                                    |
| `npm run migrate` (disposable PostgreSQL 16.15) | exit 0 — `0001`, `0002`, `0003` applied                                                                   |
| `npm run auth:bootstrap -- ...`                 | exit 0 — organisation and owner created without pre-creating a company                                    |
| `npm audit --omit=dev`                          | exit 1 — only the pre-existing `xlsx` high advisory remains; no fix is available in the community package |

Integration tests used a disposable PostgreSQL 16.15 cluster. Docker was not available in this
environment, so the Compose path remains unverified locally. The PostgreSQL binary was a portable
distribution used only for verification; no database files or secrets were committed. One
intermediate `npm run test:server` rerun failed with `ECONNREFUSED` because that temporary cluster
had already been stopped; after restarting it, the same command passed 60/60 tests.

## Browser/E2E evidence

Exercised through the in-app browser against the real API and PostgreSQL:

- Signed in as the bootstrapped owner, opened `/app/setup`, and created a company through the UI.
- Created a January-to-December fiscal year (non-July start) and saw 12 monthly `OPEN` periods.
- Added three accounts, including a `BANK_MFS` control account and an `AP` control account.
- Entered a balanced opening batch with an evidence reference, saved it as `DRAFT`, refreshed the
  page and resumed on the same step with the draft intact.
- Submitted the batch after the confirmation dialog; the UI showed `SUBMITTED · pending posting`
  and explicitly stated that it is not `POSTED`.
- Added a principal bank account with a masked number and `BANK_MFS` GL mapping.
- Saved language, approval thresholds, tax configuration and numbering settings; onboarding reached
  100%, completed, and the audit log contained `company.created`, `fiscal_year.created`,
  `account.created`, `opening_balance.created`, `opening_balance.submitted`, `bank_account.created`,
  `company.settings_updated` and `company.onboarding_completed`.
- Created a second company from the organisation menu; the switcher listed both companies and
  switching back to the first loaded its completed setup unchanged.

## Acceptance criteria

- A new company can be created and resumed: **PASS** — API integration test plus browser refresh and
  continuation on the same persisted step.
- The opening batch balances and is saved as `DRAFT` with evidence: **PASS** — balanced/unbalanced
  tests, evidence guard, browser draft/submit flow; the database stores only `DRAFT`/`SUBMITTED`.
- Periods are generated correctly and unknown dates are rejected: **PASS** — 12-period non-July
  generation, overlap rejection, `GET /periods/resolve` returns `PERIOD_NOT_FOUND` for an unknown
  date, and opening-batch creation rejects an unknown date.
- The company switcher loads the correct data and never resets it: **PASS** — second company created
  through the UI; both remained in the switcher; the first company's completed setup was intact.
- All setup events are audited: **PASS** — integration assertions plus browser-flow audit query.
- Tests cover permissions and cross-company isolation: **PASS** — accountant/auditor/operator role
  tests, cross-organisation `404` reads and writes.
- No opening batch is falsely marked `POSTED`: **PASS** — database check constraint rejects `POSTED`
  and the API/UI expose only `DRAFT`/`SUBMITTED`.
- Company profile, COA, banks/cash/MFS and settings requirements: **PASS** — implemented and
  exercised through API tests and the browser wizard.

## Tests added/updated

- `server/tests/integration/companySetup.test.ts` — full onboarding E2E, second company preservation,
  period generation/overlap, unknown-date rejection, balanced/imbalanced opening batches, evidence
  requirement, duplicate account codes, control-account protection, CSV/XLSX import validation,
  cross-company isolation, role permissions and principal bank constraints.
- `server/tests/unit/companySetup.test.ts` — exact BDT-to-poisha parsing, quantity parsing, dynamic
  fiscal-year generation, month-boundary/date validation and CSV parsing.
- `server/tests/integration/migrations.test.ts` — Phase 4 tables, rollback and reapply.
- Existing frontend smoke and server identity tests remain green.

## Security/accounting review notes

- **Authorization:** every new route declares an auth mode. Company creation requires an active
  organisation membership, verified email, `MANAGE_USERS_AND_ORG`, and an Owner/Admin role. Company
  profile, fiscal year, bank and settings writes require `MANAGE_COMPANY_SETTINGS`; chart-of-accounts
  writes require `MANAGE_MASTERS_AND_COA`; opening-batch submission requires `POST_TO_GL`. Auditors
  can read but cannot mutate; operators cannot prepare opening batches.
- **Tenant scope:** every company-scoped query/mutation uses the served company id and all joins are
  company-qualified. Cross-tenant reads and writes return `404 COMPANY_NOT_FOUND`; tests prove both
  directions across two organisations.
- **Posting/accounting:** no journal or posting service was introduced. Opening balances are a
  validated batch, not ledger history. Debit/credit totals are computed from database lines on every
  save and submit; client totals are never trusted. `POSTED` is absent from the database status check.
- **Idempotency/replay:** unique indexes prevent duplicate draft or submitted opening batches;
  duplicate submission returns `409`; account codes and fiscal-year ranges are unique. Company
  creation itself has no client idempotency key (see Known limitations).
- **Reversal:** not applicable in Phase 4; no posted financial history exists.
- **Audit:** setup changes append to `audit_events` in the same transaction as the mutation, including
  onboarding step changes, account deactivation, opening-batch submission and principal bank
  reassignment. The audit table remains append-only by trigger.
- **Money:** all authoritative amounts are `BIGINT` poisha. API inputs are decimal BDT strings parsed
  with BigInt arithmetic; no JavaScript floating point is authoritative.
- **Periods:** statuses are explicit; overlap triggers and composite constraints are in the database;
  unknown dates reject rather than opening an implicit period.

## Known limitations

- Opening balances are not posted until Phase 5. This is by design and is the explicit phase boundary;
  no fake `POSTED` state or posting endpoint exists.
- Company creation is not protected by a client idempotency key. A retried create request could create
  two companies with the same legal name; legal-name uniqueness is not enforced.
- The setup wizard is resumable and server-persisted, but its new form copy is primarily English with
  bilingual page/step framing. Full Bengali translation is deferred to the localization phase.
- The opening-balance evidence is a reference/note/checksum, not an uploaded file. Attachment storage
  and virus scanning are later work.
- No starter COA template is shipped; the minimal CSV template and blank chart are implemented. A
  reviewed trading/services/manufacturing starter chart is later work.
- The server accepts up to 2,000 COA rows and the API request body limit is 1 MiB. XLSX parsing happens
  in the browser using the existing `xlsx` package, whose high advisory remains open.
- Time zone is fixed to Asia/Dhaka and base currency to BDT in this release.
- Bank/cash/MFS opening values are schedule metadata. A submitted opening batch is authoritative and
  blocks later metadata edits, but reconciliation between the two is a Phase 5 posting concern.
- Docker Compose and a production SMTP adapter remain unverified; both are recorded from earlier
  phases.

## Manual or external decisions required

- An accountant must review the applied chart of accounts, control-account mapping, opening schedules
  and evidence before Phase 5 posts the batch.
- Tax counsel must confirm VAT registration status, filing frequency, TIN/BIN handling and any
  statutory numbering formats. The application performs format checks only and does not claim
  statutory validation.
- The product owner must confirm that deferring opening-balance posting to Phase 5 is acceptable. If a
  posted opening position is required earlier, Phase 5 must be pulled forward or the phase split into
  4A/4B rather than faking a posted state.
- Decide the production evidence-attachment store, retention period and access controls.
- Configure production email delivery and Docker/host deployment paths before real onboarding.

## Next-phase dependency verified

**YES** — Phase 5 can consume a company with generated periods, a protected chart of accounts, a
`SUBMITTED` balanced opening batch with evidence, and bank/cash/MFS GL mappings. The batch's
`period_id`, lines and totals are persisted with composite tenant foreign keys, and the schema
deliberately has no `POSTED` state for Phase 5 to extend through the ledger posting service.

## Blocker

No code blocker for Phase 5. Phase 5 must add the journal/posting schema, period-lock enforcement,
idempotency and the atomic opening-batch posting command; Phase 4 must not be interpreted as having
posted the opening position.
