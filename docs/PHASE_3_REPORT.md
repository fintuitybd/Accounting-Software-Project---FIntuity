# Phase 3 — Identity, Organisations, Memberships and Invitations

**Status:** COMPLETE (production email delivery remains an external go-live blocker)

**Completed:** 06 November 2026

## Summary

Phase 3 replaces the demo identity switcher with a server-backed identity and tenancy layer:

- Argon2id password hashing, email verification, login, logout, forgot/reset password and change password.
- Server-side sessions with idle and absolute expiry, HTTP-only `SameSite=Lax` cookies, CSRF protection
  for authenticated mutations, session listing/revocation and revoke-all on password reset.
- Organisations, company memberships, invitations with single-use hashed tokens, expiry, resend and
  revocation, and append-only identity/access audit events.
- An explicit role matrix for Owner, Admin, Controller, Accountant, Operator and Auditor, enforced by
  server middleware on every route. Routes fail closed at startup if they do not declare an auth mode.
- Company membership checks on every company-scoped request, with cross-tenant responses using `404`.
- Last-owner protection, prevention of self-role changes, and session revocation on role/password changes.
- `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation/:token`, `/verify-email` and
  `/session-expired` routes plus `/app/account` (password and sessions) and `/app/team` (members,
  invitations and role scope).
- The synthetic demo is isolated behind `VITE_DEMO_MODE=true`, visibly banner-labelled, and makes no
  calls to the real auth API. The real shell starts empty and deliberately shows no financial data until
  the server-authoritative ledger phase.

The legacy local `AuthAndOnboardingModal`, including its role switcher and local company/opening-balance
wizard, was removed because it was client-only and bypassed server authorization. Company onboarding is
deferred to Phase 4.

## Database/migrations

`server/migrations/0002_identity_sessions_invitations.up.sql` (and matching down migration) adds:

- `users.last_login_at`, `failed_login_attempts`, `locked_until`, `password_changed_at`.
- `company_memberships` with organisation/company/membership consistency foreign keys and role override.
- `invitations`, `invitation_companies`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens` and `rate_limit_counters`.
- `audit_events.session_id` and its session foreign key/index.
- Partial unique pending-invitation index, unique token hashes, role/status checks, expiry checks,
  composite tenant-isolation foreign keys and `updated_at` triggers.

## Commands run and actual results

| Command                                     | Result                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                      | exit 0 — all matched files use Prettier style                                                                             |
| `npm run typecheck`                         | exit 0 — frontend, test and server TypeScript                                                                             |
| `npm run lint`                              | exit 0 — 0 errors; 42 pre-existing warnings in untouched legacy files                                                     |
| `npm test`                                  | exit 0 — 5 files, 41 tests passed                                                                                         |
| `TEST_DATABASE_URL=... npm run test:server` | exit 0 — 9 files, 43 tests passed                                                                                         |
| `npm run selfcheck`                         | exit 0 — all domain, ledger, tax, import and gate checks passed                                                           |
| `npm run build`                             | exit 0 — Vite production build (existing >1600 kB chunk warning)                                                          |
| `npm run build:server`                      | exit 0                                                                                                                    |
| `npm run migrate` (dev database)            | exit 0 — both migrations applied                                                                                          |
| `npm run auth:bootstrap -- ...`             | exit 0 — organisation, owner and company created                                                                          |
| `npm audit --omit=dev`                      | exit 1 — only the pre-existing `xlsx` high advisory remains; the React Router advisory was removed by upgrading to 7.18.5 |

Integration tests used a disposable PostgreSQL 16.15 database. Docker was not available in this
environment, so the Compose path remains unverified locally.

## Browser/E2E evidence

Exercised through the in-app browser against the real API and PostgreSQL:

- Signed-out `/app` redirects to `/login?returnTo=%2Fapp`.
- Owner login, account page, team page and company switcher.
- Invitation creation through the team UI; the development file outbox contained the single-use link.
- Invitation acceptance created the accountant account, set the company scope and signed the invitee in.
- The accountant saw only the assigned company and no team-management link.
- Password reset from the outbox link revoked the old session; login with the new password worked.
- An idle-expired session redirected to `/session-expired` on the next authenticated request.
- A live CSRF-less mutation returned `403 CSRF_FAILED`.
- Demo mode loaded synthetic data with a visible banner and made zero `/api/v1/auth` requests.

## Acceptance criteria

- No financial data without a valid session and membership: **PASS** — the protected route gate,
  server `401`/`404` responses, real-mode blank shell and browser redirect were all exercised.
- Invitations, verification, reset and session management end-to-end: **PASS** — integration tests and
  browser flows; email delivery used the documented development adapter.
- Server-side permissions match the documented matrix: **PASS** — unit matrix assertions and
  integration role enforcement.
- Auditor cannot mutate: **PASS** — auditor read succeeds; invitation/member mutations return `403`.
- No production role switcher: **PASS** — `switchUserRole` and the legacy modal are gone.
- Audit log records identity and access events: **PASS** — login, invitation, acceptance, membership,
  password reset and access-denied rows verified.
- Tests prove tenant isolation and role enforcement: **PASS** — two organisations/companies, cross-tenant
  `404`, malformed identifiers, last-owner and self-change protections.

## Tests added/updated

- `server/tests/integration/auth.test.ts` — login, sessions, expiry, revocation, invitations (create,
  accept, expiry, reuse, resend), CSRF, rate limits, role matrix, auditor read-only, cross-tenant,
  last-owner, self-role, email verification, password reset, audit and generic errors.
- `server/tests/unit/auth.test.ts` — permission matrix, password policy/Argon2id, token hashing,
  cookie flags, log redaction and role assignment.
- `server/tests/unit/config.test.ts` — production cookie defaults and localhost-origin rejection.
- `server/tests/integration/migrations.test.ts` — Phase 3 tables and rollback/reapply.
- `server/tests/integration/health.test.ts` — company route now requires authentication.
- `server/tests/unit/app.test.ts` — route auth declaration and production config.
- `tests/render-smoke.test.ts` — explicit test-only demo harness after the production app gained an
  identity gate.

## Security/accounting review notes

- **Authorization:** all routes declare an auth mode at registration; unknown routes fail startup.
  Organisation/company membership, effective role and permission are resolved from PostgreSQL. Deny by
  default; cross-tenant and malformed identifiers return `404`.
- **Tenant scope:** composite foreign keys prove company/membership/organisation consistency. Explicit
  company scope restricts non-owner/admin members; only owners/admins are organisation-wide by default.
- **Posting/accounting:** no financial posting was introduced in this phase. No money amounts, journal
  entries, periods or balances are trusted from the client.
- **Idempotency/replay:** invitations, reset and verification tokens are single-use and stored hashed.
  Concurrent invitation creation is translated from a unique violation to `409`; invitation acceptance
  and role changes use row locks.
- **Reversal:** not applicable to Phase 3; no financial history was created or mutated.
- **Audit:** identity events are append-only and include actor, session, organisation/company, IP,
  user agent and request id where applicable. Tokens and passwords are never written to audit or logs;
  invitation tokens are redacted from request paths before logging.
- **Sessions/cookies:** Argon2id, opaque server-side session records, idle/absolute expiry, HTTP-only
  session cookie, readable CSRF cookie with hashed server-side comparison, `Secure` in production,
  `SameSite=Lax`, session revocation and revoke-all on reset.
- **Rate limiting/lockout:** PostgreSQL-backed buckets by IP and account, generic login errors, account
  lock after repeated failures and neutral forgot-password responses.

## Known limitations

- Production email delivery is not implemented. `EMAIL_TRANSPORT=file` is a development outbox and
  `memory` is for tests. A real SMTP/provider adapter and verified sender domain are required before
  inviting real users.
- MFA, breached-password-list integration, administrator cross-user session revocation, device naming,
  SSO and email-change verification are later work.
- Company scope is set at invitation time and shown read-only; editing/removing an existing member's
  company scope is deferred.
- An owner cannot change their own role, so ownership transfer needs a deliberate future workflow.
- Rate-limit counters and expired session records are not purged by a scheduled job yet.
- Frontend CSP/security headers are not configured in the Vite/static shell; API responses carry the
  security headers. This is a later hardening item.
- Docker Compose was not executable in this environment; the documented Compose path needs a first run
  on a Docker-equipped machine.
- The pre-existing `xlsx@0.18.5` high advisory has no available fix in the community package; file
  parsing remains a security-review item before production import is enabled.
- The financial workspaces remain unavailable in real mode by design; no fake data or endpoint was added.

## Manual or external decisions required

- Choose and configure a production email provider/SMTP relay, sender domain, SPF/DKIM/DMARC and
  delivery monitoring.
- Decide the ownership-transfer workflow and whether an owner may ever change their own role through a
  separate, audited transfer process.
- Confirm data-retention and audit-log retention periods, and the data-protection review for PII in the
  audit trail.
- Confirm hosting/TLS/reverse-proxy configuration so `APP_ORIGIN`, `TRUST_PROXY` and secure cookies are
  correct in production.
- Plan migration of the legacy `xlsx` parsing path or accept a documented risk before import is exposed.

## Next-phase dependency verified

**YES** — Phase 4 can build company onboarding on `/api/v1/me`, organisation membership, the company
membership model, server-side permission middleware and the `/app` protected shell. Company creation,
fiscal periods and chart-of-accounts APIs do not exist yet, as required by the phase boundary.

## Blocker

No code blocker for Phase 3. Production invitations, verification and password resets cannot reach real
users until an email provider adapter is configured; the current development outbox is explicitly not
delivery.
