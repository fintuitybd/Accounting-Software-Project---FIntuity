# Release checklist

**Rule:** this checklist does not waive accounting or security gates. A checked box requires attached
evidence, not an intention. The release is **not approved** while any mandatory gate is open.

## A. Code and accounting gates

| Gate                                        | Evidence required                                         | Phase 15 status                                   |
| ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Typecheck clean                             | `npm run typecheck` exit 0                                | PASS — app, tests and server                      |
| Lint clean                                  | `npm run lint` exit 0 (warnings recorded)                 | PASS — 0 errors, 44 pre-existing warnings         |
| Format clean                                | `npm run format:check` exit 0                             | PASS                                              |
| Frontend tests                              | `npm test` exit 0                                         | PASS — see report                                 |
| Server unit/integration tests               | `npm run test:server` with `TEST_DATABASE_URL`            | PASS — real PostgreSQL                            |
| Domain self-checks + golden tax suite       | `npm run selfcheck` exit 0                                | PASS                                              |
| Production frontend build                   | `npm run build` exit 0                                    | PASS                                              |
| Server build                                | `npm run build:server` exit 0                             | PASS                                              |
| Migration apply/rollback/reapply            | integration test + staging rehearsal                      | PASS on disposable DB; staging rehearsal NOT RUN  |
| Backup restore drill                        | `npm run drill:backup-restore` with matching client major | PASS — 12 migrations, 62 tables, exact row counts |
| Journal balance/immutability                | server integration + property tests                       | PASS                                              |
| Period rejection (UNKNOWN/CLOSED/LOCKED)    | server integration tests                                  | PASS                                              |
| Reversal once-only + linked effects         | server integration tests                                  | PASS                                              |
| AR/AP/VAT/treasury/inventory control proofs | server integration tests                                  | PASS for tested scenarios                         |
| Close maker-checker and lock                | server integration tests                                  | PASS                                              |
| Audit log append-only/export                | server integration tests                                  | PASS                                              |

## B. Security gates

| Gate                      | Evidence required                             | Phase 15 status                                      |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Secret scan               | `npm run check:secrets` exit 0                | PASS                                                 |
| Dependency audit          | no critical/high findings                     | **FAIL** — `xlsx@0.18.5` high, no npm fix            |
| Container/image scan      | scanner report on the deployed image          | NOT RUN — Docker unavailable                         |
| SAST/DAST                 | chosen tooling report                         | NOT RUN — no tool configured                         |
| Security headers/CSP      | `npm run check:built-security` + edge headers | PASS in build; edge config NOT VERIFIED              |
| CSRF/session/cookies      | auth integration tests                        | PASS                                                 |
| Rate limits               | auth/public integration tests                 | PASS                                                 |
| Tenant isolation          | cross-company integration tests               | PASS                                                 |
| Role/auditor enforcement  | role-matrix integration tests                 | PASS                                                 |
| Export permission/audit   | report/audit export tests                     | PASS                                                 |
| File upload limits        | code review + import tests                    | PASS for client guard and 1 MiB API body limit       |
| PII masking/redaction     | unit tests + code review                      | PASS for logs; data-protection review still required |
| Production email delivery | provider configured and delivery observed     | **FAIL** — file/dev outbox only                      |

## C. Localization and accessibility gates

| Gate                                           | Evidence required            | Phase 15 status                                                                          |
| ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| English/Bangla key parity                      | `tests/localization.test.ts` | PASS — complete, non-empty, placeholders match                                           |
| Number/date/currency formatting                | `tests/localization.test.ts` | PASS                                                                                     |
| No hard-coded English in Bangla session        | screen audit                 | **FAIL** — setup step bodies and some deep panels remain English-only                    |
| Native accountant terminology review           | signed review record         | **NOT AVAILABLE** — external reviewer required                                           |
| Report/PDF/Excel labels in both languages      | review evidence              | PARTIAL — server templates are English; statutory review pending                         |
| Self-hosted fonts                              | no Google Fonts request      | PASS                                                                                     |
| No working text below 12px in production pages | DOM/source audit             | PASS for reviewed production pages; demo remains legacy                                  |
| Keyboard/focus/skip link                       | browser checks               | PASS in Phase 14 evidence; 200% zoom not re-run                                          |
| Screen-reader pass in Bangla                   | manual evidence              | NOT RUN                                                                                  |
| 360/768/1440 screenshots                       | evidence pack                | PARTIAL — 360/768 not available in the current browser; Phase 13 checked the public site |

## D. Performance gates

| Gate                            | Evidence required             | Phase 15 status                                    |
| ------------------------------- | ----------------------------- | -------------------------------------------------- |
| Bundle budgets                  | `npm run check:bundle` exit 0 | PASS — 60 chunks                                   |
| Route splitting/lazy XLSX       | build output                  | PASS                                               |
| Report performance budget       | integration test              | PASS — 500-journal P&L under 10 s ceiling          |
| Query indexes                   | migration review              | PASS — company/date/status/account indexes present |
| Pagination on list APIs         | code review                   | PASS for implemented lists                         |
| Load test at target concurrency | load-test report              | NOT RUN — no load-test harness or staging target   |

## E. Release operations gates

| Gate                           | Evidence required                  | Phase 15 status                                                |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| Staging deployment             | staging URL + smoke evidence       | **NOT RUN** — hosting decision outstanding                     |
| Migration rehearsal on staging | command output on staging          | **NOT RUN**                                                    |
| Accountant UAT (2–3 users)     | signed scenario results            | **NOT AVAILABLE**                                              |
| Tax-counsel/rule-pack approval | named reviewer + source references | **NOT AVAILABLE** — pack remains `PENDING_TAX_COUNSEL`         |
| Legal/privacy/terms review     | approved documents                 | **NOT AVAILABLE**                                              |
| Rollback plan                  | tested restore/rollback evidence   | PARTIAL — restore drill passes; staging rollback not rehearsed |
| Monitoring/alerts live         | alert test evidence                | **NOT RUN** — vendor/host decision outstanding                 |
| Support playbook               | this repository                    | PASS — `docs/SUPPORT_PLAYBOOK.md`                              |
| Admin/accountant guides        | this repository                    | PASS — drafts, native review required                          |
| Human release sign-off         | named approver and date            | **NOT PROVIDED**                                               |

## Go/no-go

**Current decision: NO-GO.** The mandatory open gates are the high `xlsx` advisory, production email,
native localization/accountant UAT, tax-counsel approval, staging deployment/rehearsal, live monitoring
and human sign-off. Completing code checks alone does not authorise a production launch.
