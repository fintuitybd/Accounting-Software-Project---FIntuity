# Security review — Phase 15

**Scope:** server-backed application, API, static shell and release process.
**Result:** controls pass the tested server-side boundaries; **release is blocked** by one high
dependency advisory, the missing production email adapter and the external legal/accountant gates.

## 1. Authentication and sessions

Verified in code and PostgreSQL integration tests:

- Argon2id password hashing with configurable memory/time/parallelism; passwords are never logged.
- Email verification, single-use hashed invitation/reset tokens, expiry, resend, revoke and acceptance.
- Server-side opaque sessions with idle and absolute expiry, revocation, session listing, and
  revoke-others on password change/reset.
- HTTP-only session cookie, `SameSite=Lax`, `Secure` in production; separate readable CSRF cookie;
  CSRF checked on mutations; same-origin mutation check.
- Login rate limiting and temporary account lockout; generic authentication errors.
- Last-owner protection and self-role-change prevention.
- All auth failures and permission denials are written to the append-only audit log.

## 2. Authorization and tenant isolation

- Every route declares an auth mode at registration; the server fails closed if one does not.
- Company-scoped routes resolve membership from PostgreSQL. A client-supplied company ID is never
  trusted without membership verification.
- Cross-tenant reads return `404`, not another tenant's data.
- The role matrix is server-enforced; the auditor is read-only at the API and export remains
  permissioned and audited.
- Maker-checker / segregation of duties is enforced for high-value documents, journals, payments,
  reversals, suspense resolution and period close. The creator cannot approve their own item.
- Integration tests exercise cross-company access, role bypass, auditor writes, self-role changes,
  last-owner protection, duplicate invitations/tokens and CSRF.

## 3. Application security

- Parameterised SQL through `pg`/Drizzle; Zod validation at the API boundary; stable error codes and a
  trace ID; no stack traces or database details in production responses.
- Request body limit is 1 MiB. XLSX/CSV imports are parsed in the browser; the server receives
  validated text/rows, never a raw workbook. Client imports now reject files over 1 MB and worksheets
  over 5,000 rows before sending data.
- React escaping is used; no new `dangerouslySetInnerHTML` was introduced. The API sets a restrictive
  CSP and the static build pins its two intentional inline scripts by SHA-256 hash.
- Security headers: API and built shell verified by `npm run check:built-security`; the edge host must
  add HSTS/frame-ancestors (a meta tag cannot enforce them).
- PII: request bodies are not logged; authorization/cookies/tokens/database URLs are redacted; one-time
  invitation tokens are removed from logged paths; list views mask identifiers where the API returns
  masked values.
- Exports require `EXPORT_DATA` and are audited. The full vault export is demo-only; production has no
  full-database download.

## 4. Dependency and secret findings

`npm audit --omit=dev` reports **one high-severity finding**: `xlsx@0.18.5` has a prototype-pollution
advisory (GHSA-4r6h-8v6p-xvw6) and a ReDoS advisory (GHSA-5pgg-2g8v-p4x9). npm reports **no fix
available** because the maintained SheetJS releases are no longer published to the npm registry.

Mitigations currently in place:

- parsing happens on the user's own machine, not on the API;
- the server never accepts a raw workbook or executes formulas/macros;
- file size and worksheet row limits reduce resource-exhaustion and oversized-input risk;
- the XLSX engine is a lazy chunk, not part of first paint or the public landing entry.

This is **not** a fix. Replacing or vendoring a reviewed, patched spreadsheet engine is a product and
supply-chain decision. Until then the release gate is not green.

`npm run check:secrets` scans tracked files for private keys, cloud/provider tokens, live payment keys,
JWT-like credentials and non-local database URLs with embedded passwords. Phase 15 result: pass.

Container scanning was **not run** because Docker is not installed in the implementation environment.
Run the chosen image scanner (Trivy/Grype/cloud registry scanner) in the deployment pipeline and fail
on critical/high findings.

## 5. Operational security

- Production configuration rejects localhost `APP_ORIGIN`, uses secure cookies and enables HSTS.
- The API uses a pooled database connection with TLS support (`DB_SSL=require`), least-privilege
  database roles are a deployment requirement, and secrets belong in the platform secret store.
- Backups and PITR require encryption and access logging. A tested restore drill is available and was
  demonstrated against PostgreSQL 16.15.
- No hosted error tracker or alerting vendor is configured. The JSON logs, request IDs, health probes
  and audit log are ready to connect; claim monitoring live only after the alerts are observed.

## 6. Open security decisions

1. Approve replacing `xlsx` with a maintained, reviewed library (preferred) or formally accept the
   documented risk with compensating controls and a removal date.
2. Configure a production email provider; the current `file` outbox does not deliver invitations,
   verification or reset messages.
3. Configure the static host security headers, TLS, HSTS and CSP at the edge.
4. Configure encrypted backups, WAL archiving/PITR and off-site retention.
5. Run dependency, secret, container and SAST scans in the deployment pipeline.
6. Complete the data-protection review for retention, deletion, breach notification and cross-border
   processing.
7. Decide whether `/design` must be blocked at the edge in production (it is `noindex,nofollow` and
   unlinked, but reachable by URL).
