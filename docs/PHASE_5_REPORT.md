# Phase 5 — Server-authoritative ledger, general journal and opening balances

**Status:** COMPLETE

**Completed:** 06 November 2026

## Summary

Phase 5 moves the authoritative ledger into PostgreSQL and adds a real-mode general ledger at
`/app/ledger`:

- **Journal persistence** — `journals` and `journal_lines` are company-scoped, use composite tenant
  foreign keys, carry integer poisha amounts, and are protected by deferred integrity triggers.
  Every non-draft journal must have at least two lines and exactly equal debit/credit totals.
- **Posting service** — one transaction validates permission, the stored period, active company
  accounts and exact balance; locks the period and the per-company/fiscal-year `JOURNAL` sequence;
  allocates a unique number; writes the header/lines; appends audit events; and commits. Duplicate
  submissions either replay the original result for the same `Idempotency-Key` or return a stable
  conflict code.
- **General journal workflow** — draft, edit, submit, approve and post. Posted records are immutable.
  Journal numbers use the existing `JE-<period>-<padded sequence>` convention and are never reused.
  The API never accepts a client total, status, balance or tax amount.
- **Opening balances** — the Phase 4 batch is submitted, approved by a different user, then posted
  once through the same posting service. A permanent `journal_id` link is written in the same
  transaction, and a second posting is rejected. A linked reversal moves the batch to `REVERSED`;
  it cannot be posted again.
- **Reversal** — requires `REVERSE_POSTED_JOURNAL` and a reason, mirrors every line, links original
  and reversal both ways, leaves the original in history and rejects a second reversal or a reversal
  of a reversal. Opening-balance reversals update the batch link in the same transaction.
- **Period enforcement** — `OPEN`, `CLOSED` and `LOCKED` are explicit. Unknown dates and non-open
  periods reject posting. Status changes require a reason and an audited permission.
- **Trial balance** — account-level opening/period/closing columns and journal-line drill-down,
  derived only from `POSTED`/`REVERSED` journals, never from mutable account fields.
- **Auditor enforcement** — every ledger mutation is permission-gated at the API; the auditor can
  read journals and the trial balance but cannot create, submit, approve, post, reverse or change a
  period.
- **UI** — a real-mode ledger page with journal list/detail, balanced/unbalanced composer, reversal,
  trial balance drill-down, period status and opening-balance review/approval/posting. The synthetic
  workspaces remain isolated in demo mode and are hidden from the real-mode sidebar.

The Phase 4 opening batch in the local development database was inspected after migration: it
remains `SUBMITTED`, balanced at 1,000.00 BDT debit and credit, with no `journal_id` and no posted
journal. It was **not** silently posted by the migration.

## Files changed

### Database and server

- `server/migrations/0004_ledger.up.sql` — journals, journal lines, constraints, deferred integrity
  triggers, immutability triggers and the opening batch approval/posting columns and links.
- `server/migrations/0004_ledger.down.sql` — development/test rollback; aborts if any journal exists.
- `server/src/db/schema.ts` — Drizzle bindings for journals, journal lines and the expanded opening
  batch.
- `server/src/ledger/constants.ts` — ledger statuses, source modules and the supported-book rule.
- `server/src/ledger/journalNumber.ts` — documented journal number formatting.
- `server/src/ledger/ledgerService.ts` — draft/submit/approve/post/reverse, list/detail, period-aware
  validation, sequence allocation, audit and trial balance/drill-down.
- `server/src/idempotency.ts` — strict optional `Idempotency-Key` header parsing.
- `server/src/routes/journals.ts` — journal, posting, reversal and trial balance APIs.
- `server/src/routes/openingBalances.ts` — opening approval and posting routes.
- `server/src/routes/companySetup.ts` — period status route.
- `server/src/company/openingBalanceService.ts` — expanded DTO, approval and one-time posting.
- `server/src/company/periodService.ts` — audited period status transitions.
- `server/src/app.ts` — registers the journal routes.
- `server/README.md` — Phase 5 API/scope/limitations.
- `server/tests/integration/ledger.test.ts` — new Phase 5 integration suite.
- `server/tests/integration/migrations.test.ts` — applies/rolls back migration 0004.
- `server/tests/integration/companySetup.test.ts` — updated the Phase 4 direct-`POSTED` test name.
- `server/tests/unit/journalNumber.test.ts` — number formatting unit tests.

### Frontend

- `src/ledger/api.ts` — typed journal, trial balance and period API client.
- `src/auth/api.ts` — optional request headers for `Idempotency-Key`.
- `src/setup/api.ts` — expanded opening batch status/fields and approve/post calls.
- `src/pages/ledger/LedgerPage.tsx` — real-mode ledger shell and journal listing.
- `src/pages/ledger/JournalComposer.tsx` — balanced/unbalanced editor with analysis fields.
- `src/pages/ledger/JournalDetail.tsx` — detail, actions, reversal and audit trail.
- `src/pages/ledger/TrialBalancePanel.tsx` — opening/period/closing report and drill-down.
- `src/pages/ledger/PeriodsPanel.tsx` — period status control.
- `src/pages/ledger/OpeningBalancesPanel.tsx` — review/approve/post once.
- `src/pages/ledger/ledgerUi.tsx` — shared status/date/money helpers.
- `src/pages/setup/OpeningBalancesStep.tsx` — submitted/approved/posted batches are read-only in the
  setup wizard and link to the ledger for approval/posting.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — links to the new ledger.
- `src/components/layout/Sidebar.tsx` — real-mode navigation exposes ledger/setup/team instead of
  demo workspaces.
- `src/App.tsx` — `/app/ledger` route and Phase 5 footer.

### Documentation

- `README.md` — Phase 5 capabilities, run notes and limitations.
- `docs/IMPLEMENTATION_NOTES.md` — Phase 5 record index entry.
- `docs/PHASE_5_REPORT.md` — this report.

## Database/migrations

`0004_ledger`:

- creates `journals` with company/book journal-number uniqueness, idempotency uniqueness, status
  checks, posted-field checks, self-links for reversals and append-only protection;
- creates `journal_lines` with composite company/journal/account foreign keys, one-side-positive
  checks, line-number uniqueness and immutability after submission;
- adds deferred `journals_integrity_check` and `journal_lines_integrity_check` constraint triggers
  that enforce at least two lines and exact debit/credit equality at commit;
- expands `opening_balance_batches` to `DRAFT`, `SUBMITTED`, `APPROVED`, `POSTED`, `REVERSED` with
  approval, posting, idempotency and permanent journal/reversal links;
- replaces the Phase 4 partial unique indexes with one-open and one-posted guards;
- adds no destructive change to existing Phase 4 data. The down migration refuses to run if any
  journal exists.

## Commands run and actual results

| Command                                     | Result                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run migrate` (local PostgreSQL 16.15)  | exit 0 — `0004_ledger` applied                                                                            |
| `npm run migrate:status`                    | exit 0 — `0001`–`0004` applied, checksums valid                                                           |
| `npm run typecheck`                         | exit 0 — app, test and server TypeScript                                                                  |
| `npm run lint`                              | exit 0 — 0 errors; 42 pre-existing warnings in untouched legacy files, none in new ledger files           |
| `npm run format:check`                      | exit 0 — all matched files use Prettier style                                                             |
| `npm test`                                  | exit 0 — 5 files, 41 tests passed                                                                         |
| `TEST_DATABASE_URL=... npm run test:server` | exit 0 — 13 files, 70 tests passed (including 8 Phase 5 integration tests and 2 number-format unit tests) |
| `npm run selfcheck`                         | exit 0 — all domain, ledger, tax, import and gate checks passed                                           |
| `npm run build`                             | exit 0 — Vite production build; existing large-chunk warning, 2,127.00 kB                                 |
| `npm run build:server`                      | exit 0                                                                                                    |
| `npm audit --omit=dev`                      | exit 1 — only the pre-existing `xlsx` high advisory remains; no new dependency was added                  |
| `git diff --check`                          | exit 0 — no whitespace errors                                                                             |

The first Phase 5 integration run exposed several test/implementation issues: a reversal-number
expectation that ignored the per-fiscal-year sequence, auth rate limiting after many fixture
logins, and an unused `$2` parameter in the opening-reversal SQL. All were fixed; the final suite
passes 70/70.

No browser E2E harness exists in this repository. The real-mode UI was verified by production build
and the server API by PostgreSQL integration tests; it was not driven through a browser automation
suite.

## Acceptance criteria

- **A balanced journal posts exactly once; an unbalanced/duplicate/locked/unknown entry is
  rejected:** PASS — `ledger.test.ts` covers balanced posting, replay, different-key conflict,
  unbalanced submit, zero lines, unknown/inactive accounts, `CLOSED`/`LOCKED`/unknown periods and a
  database-level unbalanced `POSTED` attempt.
- **The opening batch posts once and the trial balance agrees:** PASS — approval/post test verifies
  a permanent link, one journal, 5,000.00 BDT debit/credit, TB totals equal and duplicate posting
  rejected. The existing development batch remains preserved and unposted.
- **Trial balance debits equal credits:** PASS — totals are zero-difference in the posting and
  opening tests; the report derives only from posted/reversed journals.
- **Reversal is linked, idempotent and blocked on a second attempt:** PASS — original/reversal
  two-way links, mirrored lines, reason/audit, second reversal `409 REVERSAL_ALREADY_EXISTS`, and
  reversal-of-reversal `409 REVERSAL_OF_REVERSAL`.
- **Period status is enforced server-side:** PASS — close, reopen, lock, unknown-date and
  `PERIOD_NOT_OPEN` tests; period changes are audited with actor and reason.
- **Auditor is read-only:** PASS — auditor reads journals/detail/TB but receives `403 FORBIDDEN` for
  create, edit, submit, approve, reverse, period change and opening preparation.
- **Every action is audited:** PASS — journal created/updated/submitted/approved/posted/reversed,
  opening approved/posted and period status changes are written to append-only `audit_events`.
- **Existing UI is either migrated or clearly marked as demo-only; no fake ledger remains as the
  source of truth:** PASS — real mode uses `/app/ledger` and PostgreSQL; real mode never loads a
  browser ledger; demo workspaces remain synthetic and labelled, and the real-mode sidebar exposes
  ledger/setup/team rather than the demo workspace list.

## Tests added/updated

- `server/tests/integration/ledger.test.ts` — 8 tests covering posting, validation, DB trigger
  integrity, periods, numbering/concurrency/sequence conflict, reversal, opening posting/duplicate,
  high-value approval/self-approval, tenant isolation and auditor read-only enforcement.
- `server/tests/unit/journalNumber.test.ts` — journal number convention and invalid-input rejection.
- `server/tests/integration/migrations.test.ts` — migration 0004 apply/rollback/reapply.
- `server/tests/integration/companySetup.test.ts` — updated the direct-`POSTED` guard description.

## Security/accounting review notes

- **Authorization:** every ledger route resolves company membership and permission from PostgreSQL;
  `POST_TO_GL`, `APPROVE_HIGH_VALUE`, `REVERSE_POSTED_JOURNAL` and `MANAGE_COMPANY_SETTINGS` gate the
  relevant mutations. Cross-company requests return `404`.
- **Tenant scope:** journals, lines, periods and opening batches use composite company foreign keys;
  a line cannot reference another company's journal or account.
- **Posting:** single transaction, period row `FOR SHARE`, sequence `FOR UPDATE`, unique company/book
  number, unique company idempotency key, deferred balance trigger, audit append before commit.
- **Immutability:** posted journals can only transition `POSTED -> REVERSED`; lines are frozen after
  submission; posted journal deletion is rejected; audit events remain append-only.
- **Reversal:** mirrored lines, permanent two-way link, mandatory reason, duplicate guard,
  reversal-of-reversal guard and opening-batch status update in the same transaction.
- **Money:** authoritative amounts are `BIGINT` poisha; JSON amounts are strings; no floating point
  is used for posting, balancing, numbering or trial balance.
- **Approval:** opening balances always require a different maker/checker. Manual journals require
  approval only when the configured high-value threshold is greater than zero; default `0` means no
  mandatory high-value approval, not a hidden approval bypass.
- **Audit:** append-only, actor/session/request/IP/user-agent context, before/after, and reason where
  required.

## Known limitations

- Journal group reversal is not applicable yet; Phase 5 reverses a single manual journal or the
  single opening journal. Document-family groups arrive with sales/purchases/receipts in later phases.
- `party_reference` and `party_name` are descriptive text until the Phase 6 party master exists; they
  are not an authoritative subledger link.
- `attachment_reference` stores an evidence reference only; there is no file upload or attachment
  store in this phase.
- Opening balances require a second approver. A single-user company cannot self-approve opening
  balances; invite a controller/administrator or agree a policy in the next phase.
- High-value approval is opt-in through company settings. The default threshold is `0` (no mandatory
  approval); a company must configure a positive threshold to enforce maker-checker on manual
  journals.
- Only the statutory BDT book is exposed. `book_type` is retained in the schema for a later
  multi-book design.
- The period status UI uses a browser prompt for the reason; the full close checklist, sign-off and
  close pack remain Phase 12.
- No PDF/Excel export of the trial balance yet; that belongs to Phase 11.
- No browser E2E automation exists; Docker Compose was not exercised in this environment (native
  PostgreSQL 16.15 was used).
- The pre-existing `xlsx` high advisory remains; no dependency was added by this phase.

## Manual or external decisions required

- Confirm the company policy for the high-value approval threshold and whether opening balances must
  always require a second approver.
- Confirm the journal number format and whether the suffix should continue across fiscal-year periods
  (current server behaviour) or restart per period.
- Choose an evidence/attachment storage provider before accepting file uploads.
- Approve the Phase 12 close checklist, reopen approvals and sign-off design.
- Complete tax/statutory review before any VAT or filing output is exposed; Phase 5 does not claim
  statutory correctness.

## Next-phase dependency verified: YES

Phase 1 period rules (`OPEN`/`CLOSED`/`LOCKED`/unknown) are mirrored and enforced server-side; Phase 4
companies, accounts, periods and opening batch are persisted and were inspected; the posting service
exposes `postJournalWithinTransaction` for later document families. Phase 6 can add party/item master
data and reuse the ledger invariants without creating a second posting path.

## Blocker

None.
