PHASE COMPLETION REPORT
Phase: 10 — Banking, MFS and reconciliation
Status: COMPLETE
Summary: Banking reconciliation is now a server-backed control based on retained imported statements, explicit unique matching, exception ownership, approved GL creation, configured one-time fees and prepared/reviewed sign-off. Bank/cash/MFS accounts already existed and remain linked to `BANK_MFS` GL accounts; this phase adds reference-safe deactivation and GL-mapping protection. Importing a CSV/XLSX-derived CSV never posts or auto-matches. Statement lines are immutable evidence; matching allocates against available statement and posted-journal capacity, prevents reuse without an explicit split, and records a score and reason. Unexplained lines can be assigned, excluded with a reason, or turned into a `BANK_RECONCILIATION` draft journal that must be submitted and approved by a different user before it posts and matches. Fee rules are per-account configuration with policy evidence; no universal rate is seeded. A fee posts once, can be reversed through a linked journal reversal, and can then be replaced. Transfers post one balanced journal with a dedicated linked reversal. Reconciliation is persisted per account and period, prepared and reviewed by different users, invalidated by new imports or later changes, exported as CSV, and locked with an audit event when the period is closed or locked. The production `/app/banking` page replaces the demo statement table in server-backed mode; the W06 demo remains clearly labelled synthetic and no longer pre-matches its seed or live demo lines.

Files changed:

- `server/migrations/0009_banking_reconciliation.up.sql` — immutable statement imports/lines, explicit match allocations and capacity/reversal triggers, create-GL requests, fee rules/postings, numbered transfers, reconciliation sign-off, period-close lock, `BANK_TRANSFER` sequence and `BANK_RECONCILIATION` journal source.
- `server/migrations/0009_banking_reconciliation.down.sql` — development/test rollback; refuses while any Phase 10 record exists and restores prior sequence/source constraints.
- `server/src/db/schema.ts` — Drizzle bindings for the new banking tables and reversal/status columns.
- `server/src/banking/common.ts` — shared tenant/account/period loaders, line mapping, fingerprinting, signed amount parsing and integer fee calculation.
- `server/src/banking/statementService.ts` — CSV/XLSX-normalised preview, header mapping, row validation, duplicate detection, source retention, immutable import batches and line queries.
- `server/src/banking/matchingService.ts` — deterministic candidate scoring, unique/partial/split matching, unmatch/exclude/exception ownership, create-GL maker-checker, submit/approve/reject/cancel and linked reversal metadata.
- `server/src/banking/feeService.ts` — per-account fee rules, effective-date overlap checks, one-time fee posting, evidence-backed overrides and reversal-aware posting history.
- `server/src/banking/transferService.ts` — numbered transfers with idempotency, atomic balanced journals and linked reversal.
- `server/src/banking/reconciliationService.ts` — computed statement/GL proof, blockers, prepare/review segregation, stale-snapshot protection, period lock and audited CSV report.
- `server/src/routes/banking.ts` — company-scoped banking routes, permissions, validation, bounded import bodies and idempotency keys.
- `server/src/app.ts` — registers the banking routes.
- `server/src/company/bankAccountService.ts` — blocks deactivation and GL remapping while a bank account is referenced by financial or reconciliation history.
- `server/src/company/constants.ts` — adds the `BANK_TRANSFER` document type and prefix.
- `server/src/ledger/constants.ts` — adds the `BANK_RECONCILIATION` journal source.
- `server/src/ledger/ledgerService.ts` — additive system-draft helper used by the banking approval workflow.
- `server/tests/integration/banking.test.ts` — end-to-end import, duplicate, exact/partial/split matching, double-match, create-GL approval/reversal, fee idempotency/override/reversal/repost, reconciliation sign-off/lock/export, transfer reversal, permissions and tenant isolation.
- `server/tests/integration/migrations.test.ts` — migration 0009 apply/rollback/reapply and table assertions.
- `src/banking/api.ts` — typed banking client for imports, matching, GL requests, fee rules, transfers and reconciliation.
- `src/pages/banking/BankingPage.tsx` — server-backed banking workspace shell and account/period selection.
- `src/pages/banking/ImportPanel.tsx` — CSV/XLSX conversion, mapping preview, error/duplicate review, template download and import history.
- `src/pages/banking/LineWorkbenchPanel.tsx` — queue, explained candidates, partial/split match, unmatch, exception ownership, create-GL approval queue, fee posting and exclusion.
- `src/pages/banking/ReconciliationPanel.tsx` — statement/GL proof, blockers, prepare/review/sign-off, history and audited export.
- `src/pages/banking/FeeRulesPanel.tsx` — configurable fee rule register without a default rate.
- `src/pages/banking/TransfersPanel.tsx` — transfer posting and linked reversal.
- `src/pages/banking/bankingUi.tsx` — accessible status chips, date/amount helpers and summary cards.
- `src/App.tsx` — `/app/banking` route, W06 server-mode routing and Phase 10 footer.
- `src/components/layout/Sidebar.tsx` — banking navigation link.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 10 capability text and banking link.
- `src/setup/api.ts` — `BANK_TRANSFER` sequence label.
- `src/context/VaultContext.tsx` — demo statement lines are no longer pre-matched.
- `src/core/ledger/seedData.ts` — demo statement evidence is explicitly unmatched.
- `src/workspaces/W06_BankingMfsReconcile.tsx` — demo-only warning; the 1.5% figure is labelled a demo assumption, not a policy.
- `tests/banking-render-smoke.test.ts` — SSR render smoke for the banking shell and panels.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 10 capabilities, template, API, migration and limitations.
- `docs/PHASE_10_REPORT.md` — this completion report and evidence record.

Database/migrations: `0009_banking_reconciliation` adds `bank_statements`, `bank_statement_lines`, `bank_statement_line_matches`, `bank_gl_requests`, `bank_fee_rules`, `bank_fee_postings`, `bank_transfers` and `bank_reconciliations`; adds the `BANK_TRANSFER` sequence and `BANK_RECONCILIATION` journal source; adds match capacity/direction/immutability triggers, statement/source immutability, fee-posting and GL-request protection, reconciliation protection and period-close locking. Reversal of any linked journal updates match, fee, create-GL and transfer links in the same transaction. The down migration refuses while any Phase 10 record exists.

Commands run and actual results:

- `npm run typecheck` → exit 0; app, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 40 pre-existing warnings, none in the new banking files.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 6 files, 43 tests passed, including the new banking render smoke.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 21 files, 126 tests passed, including 7 Phase 10 integration tests and migration 0009 apply/rollback/reapply.
- `npm run build` → exit 0; Vite production build, 2,520.51 kB (725.11 kB gzip), existing large-chunk warning.
- `npm run build:server` → exit 0.
- `npm run selfcheck` → exit 0; all core, action, import and gate checks passed, including 25/25 golden tax vectors.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory remains, with no fix available. No dependency was added by this phase.
- `git diff --check` → exit 0; no whitespace errors.
- Automated browser E2E was not run because this repository has no browser E2E harness. The committed evidence is API/unit/integration/SSR render smoke.

Acceptance criteria:

- Statement import works with a documented template: PASS — the documented `date,description,reference,debit,credit,balance` CSV template, XLSX conversion, mapping, preview and retained import batch are implemented and exercised by `server/tests/integration/banking.test.ts`; invalid and duplicate rows are retained as import errors with no journal postings.
- Matching is unique and explainable: PASS — candidates carry an amount/date/reference/party score and reason; database triggers and the service reject over-allocation, a fully matched line, and journal-line reuse without an explicit `SPLIT`. Exact and partial/split cases are tested.
- Exceptions have an owner and resolution path: PASS — imported lines default to the importer as owner, an assign endpoint/UI records an eligible owner and note, and resolution is match, create approved GL, fee, or reasoned exclusion. Open exceptions block reconciliation sign-off.
- Fees post once: PASS — a configured 150 bps test rule produced 15.00 BDT on 1,000.00 BDT; the same idempotency key replayed, a different key was rejected while posted, a linked journal reversal marked the posting `REVERSED`, and a replacement fee posted once. No universal rate is seeded.
- Reconciliation sign-off is persisted and audited: PASS — prepare and review are persisted separately, the preparer cannot review, stale snapshots are rejected, the review is audited, and closing the period changed the reconciliation to `LOCKED` with a system audit event.
- No seeded/auto-matched lines masquerade as reconciliation: PASS — production import never posts or matches; the demo seed and demo live-line helper now create `UNMATCHED` lines, and the demo workspace carries an explicit synthetic warning.

Tests added/updated:

- `server/tests/integration/banking.test.ts` — CSV preview/import, invalid and duplicate rows, source retention without postings, exact match with score/reason, double-match prevention, explicit split, matched-journal reversal unmatching, create-GL maker-checker approval and linked reversal, fee idempotency/override/reversal/repost, transfer posting/reversal/idempotency, reconciliation prepare/self-review block/independent review/period lock/export, permissions, tenant isolation, bank-account reference and GL-change protection.
- `server/tests/integration/migrations.test.ts` — migration 0009 apply/rollback/reapply and new table assertions.
- `tests/banking-render-smoke.test.ts` — SSR render smoke for the banking shell and all new panels.

Security/accounting review notes:

- Authorization: reads require `VIEW_REPORTS`; import/preview/match/unmatch/exclude/assign/create-GL/submit/cancel/fee/transfer require `POST_TO_GL`; GL approval, reconciliation review and request rejection require `APPROVE_HIGH_VALUE`; transfer reversal requires `REVERSE_POSTED_JOURNAL`; fee-rule changes require `MANAGE_COMPANY_SETTINGS`; reconciliation export requires `EXPORT_DATA`. Auditors are read-only at the API.
- Tenant scope: every banking table carries `company_id`; composite foreign keys prevent cross-company bank, statement, journal, line, account, party, period and request references. Cross-company reads/writes return 404.
- Posting: import is evidence-only. Fee and transfer journals are system-posted atomically. Create-GL drafts use the distinct `BANK_RECONCILIATION` source, cannot be posted through generic manual-journal routes, require a different approver, and post plus match atomically. Every journal is revalidated for balance, open period, active accounts and source rules.
- Idempotency: statement import, fee posting, transfer posting and create-GL creation store company-scoped idempotency keys and replay the original result. GL approval replays for the same approver and rejects duplicate approval by another user.
- Matching capacity: database triggers enforce that active allocations cannot exceed the statement line or the posted journal-line amount, that the GL account and direction agree, and that imported facts and matches are not edited or deleted. One journal line cannot be reused for another statement line without an explicit `SPLIT`.
- Reversal: journal reversal synchronises active matches, fee postings, create-GL requests and transfers in the same transaction. Original journals, statements, matches, fees and transfers remain immutable and linked; a second reversal is rejected.
- Period handling: imports and matches are allowed only in an explicitly `OPEN` period; unknown periods are rejected. Reconciliation is by account and period. Closing or locking the period locks every reconciliation for that period and writes a system audit event.
- Sign-off: prepare and review are separate persisted acts with different users; review recomputes the proof and rejects a stale snapshot or any remaining blocker. A new import invalidates a prepared reconciliation.
- Money/precision: authoritative amounts remain BigInt poisha in TypeScript and `BIGINT` in PostgreSQL; JSON exposes strings. Fee arithmetic uses integer half-up basis points. No JavaScript floating point is used for authoritative amounts or totals.
- Audit: import, match, unmatch, exclusion, exception assignment, create-GL created/submitted/approved/rejected/cancelled/reversed, fee-rule changes, fee posting/reversal, transfer posting/reversal, reconciliation prepared/drafted/reviewed/invalidated/locked and export are audited with actor, request, reason and before/after where applicable.

Known limitations:

- The phase implements a documented generic CSV/XLSX mapping, not provider-specific live bank/MFS feeds. Provider statement layouts and fee rates remain business configuration.
- XLSX is converted to CSV in the browser; the retained source is the normalised CSV plus file name, MIME type and SHA-256. Original binary XLSX retention would require object storage.
- The fingerprint rule treats an exact duplicate date/amount/reference/description/balance in the same account as a duplicate. A genuinely identical transaction requires a distinct reference/balance or a documented manual resolution; there is no override.
- The matching UI submits one candidate per action. The API supports multiple allocations in one request; a split across several journals is achieved by repeated partial matches.
- Exception ownership can be assigned by API to any active OWNER/ADMIN/CONTROLLER/ACCOUNTANT; the UI provides a self-assignment shortcut rather than a full member picker.
- Reconciliation export is CSV. PDF/print layouts and close-pack integration are Phase 11/12.
- Reopening a locked period does not unlock a reconciliation; the locked history remains. A controlled reopen/correction workflow is still required in a later phase.
- The close workflow does not yet block period close when a bank reconciliation is unreviewed. This phase locks whatever exists when the period closes; Phase 12 must add that close gate.
- No live bank/MFS APIs, payment gateways or automatic statement delivery are implemented.
- No automated browser E2E harness exists; the committed evidence is API/unit/integration plus SSR render smoke.
- The pre-existing `xlsx` high advisory remains; the phase added no dependency.
- Bank account opening balance is schedule metadata; reconciliation uses the posted GL closing balance and the statement-provided closing balance, and shows the difference explicitly.

Manual or external decisions required:

- The business/accountant must configure each bank/MFS account's fee rules, fee expense account, effective dates and provider/contract evidence. No rate is assumed.
- The business must confirm which statement columns and date formats each provider uses; the generic template and mapping are the supported import path.
- The accountant/controller must confirm the chart-of-accounts mapping for bank/MFS clearing and fee expense accounts before live use.
- Tax counsel/accountant must confirm whether bank charges or MFS fees include recoverable VAT/excise and how any tax split should be coded. The phase allows an included-tax split with a chosen account and second-user approval; it does not invent a rate.
- An object-storage and retention/scanning policy is required before retaining original binary statement files.
- Phase 12 must decide the close gate for unreviewed bank reconciliations and the controlled period-reopen/unlock policy.
- The `xlsx` security advisory remains an external dependency decision.

Next-phase dependency verified: YES — Phase 11 can query persisted `bank_statements`, `bank_statement_lines`, active/reversed matches, create-GL requests, fee postings, transfers and reconciliation status/snapshots, with explicit company/period scope, BigInt amounts and audit events. Posted journals use the separate `BANK_RECONCILIATION` or `BANK_MFS` sources and remain immutable.

Blocker: None.
