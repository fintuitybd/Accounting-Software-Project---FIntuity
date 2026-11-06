# Operations runbook

**Status:** operational procedure for the server-backed release. It does **not** mean the release is
approved. Current release blockers are recorded in `docs/PHASE_15_REPORT.md`.

## 1. Environments

| Environment | Purpose                          | Data                         | Notes                                                       |
| ----------- | -------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Local       | Development and disposable tests | Synthetic only               | `.env` is git-ignored; never use real books                 |
| CI          | Automated verification           | Ephemeral PostgreSQL service | Integration databases are created and dropped per test file |
| Staging     | Migration rehearsal and UAT      | Masked or synthetic copy     | Must use the same PostgreSQL major version as production    |
| Production  | Real books                       | Real financial data          | Server-backed mode only; `VITE_DEMO_MODE=false`             |

Use the same PostgreSQL major version for the server, `pg_dump` and `pg_restore`. A PostgreSQL 17
client restoring into a 16 server can emit `transaction_timeout`, which the older server rejects. The
restore drill fails fast if the client major version does not match the server.

## 2. Health and readiness

| Probe     | Path               | Meaning                              | Alert                                    |
| --------- | ------------------ | ------------------------------------ | ---------------------------------------- |
| Liveness  | `GET /health/live` | Process is running; no database call | Page if it fails twice in 2 minutes      |
| Readiness | `GET /health`      | Database `SELECT 1` succeeds         | Page if it returns non-200 for 2 minutes |
| API proof | `GET /api/v1/ping` | Routing and request IDs work         | Low priority                             |

Every response carries `x-request-id`. Preserve an inbound request ID only when it matches the safe
format; otherwise the server generates a UUID. Production 500 responses contain `INTERNAL_ERROR`, a
generic message and the trace ID, never a stack trace or database detail.

## 3. Logs, monitoring and alerts

Logs are structured JSON (Pino) with service, environment, request ID, safe path, status code and
elapsed milliseconds. Authorization headers, cookies, passwords, tokens, API keys and database URLs
are redacted. Request bodies are not logged. One-time invitation tokens are removed from logged paths.

The repository does not ship a hosted monitoring or error-tracking vendor. Before go-live, connect the
JSON logs and health probes to the chosen platform and configure at least these alerts:

- readiness failure for 2 minutes;
- 5xx rate above 1% for 5 minutes or any sustained 5xx burst;
- p95 API latency above the report budget (10 seconds for the 500-journal report test is the current
  regression ceiling; page-level targets are lower);
- database connection pool exhaustion, replication lag and disk usage above 80%;
- backup older than 24 hours, failed backup job, or failed restore drill;
- spike in failed sign-ins, rate-limit responses, permission denials, exports and posting failures;
- close runs blocked by a control difference, suspense ageing, or reconciliation exceptions;
- any `audit.exported` or bulk export event outside expected hours.

The current alert wiring is a deployment task, not a repository feature. Do not claim monitoring is
live until the probes and alerts are observed firing in the target environment.

## 4. Backup and recovery

### 4.1 Required production configuration

- Encrypted PostgreSQL backups at least daily, retained off-site.
- Continuous WAL archiving for point-in-time recovery (PITR). Configure and test the recovery window
  on the hosting platform; this repository does not provision storage or WAL archiving.
- A second copy in a different failure domain.
- Restricted access to dumps; dumps contain financial and personal data.
- Backup jobs monitored; a backup is not valid until a restore has succeeded.

### 4.2 Restore drill (repeatable)

```bash
npm run drill:backup-restore
```

The drill creates two disposable databases on the configured server, applies all migrations to the
source, inserts a sentinel row, runs `pg_dump --format=custom`, restores into the target with
`pg_restore`, and compares the migration ledger, table list and every table row count. It deletes the
dump and drops both databases afterwards. It refuses to run with `NODE_ENV=production` and never
touches the application database.

On Windows, set `PG_DUMP` and `PG_RESTORE` when the client tools are not on `PATH`:

```powershell
$env:PG_DUMP = 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe'
$env:PG_RESTORE = 'C:\Program Files\PostgreSQL\16\bin\pg_restore.exe'
npm run drill:backup-restore
```

Evidence from the Phase 15 run: 12 migrations, 62 tables, a 480,913-byte custom dump, a successful
restore and an exact row-count comparison. See `docs/PHASE_15_REPORT.md`.

### 4.3 Production restore runbook

1. Declare an incident and stop application writes (put the API behind a maintenance response or
   scale it to zero). Do not let a restore run against a live write path.
2. Record the incident time, the last known good transaction and the backup/PITR target. Preserve the
   failed database volume for forensic review.
3. Restore to a **new** database instance. Never overwrite the only copy.
4. Run `npm run migrate:status` against the restored database and verify the expected migration count
   and checksums.
5. Run the control proofs and a read-only sign-in. Verify trial balance, AR/AP, VAT, treasury,
   inventory and bank reconciliation before allowing writes.
6. Point the API at the restored database, rotate database credentials if compromise is suspected,
   and monitor the first postings.
7. Record the restore evidence, data-loss window, approver and follow-up actions. Notify affected
   customers and regulators where the verified legal obligations require it.

### 4.4 Migration rehearsal

Before a production migration:

1. Take a verified backup and note the restore point.
2. Restore it into staging with the same PostgreSQL major version.
3. Run `npm run migrate` and `npm run migrate:status` on staging.
4. Run typecheck, tests, server tests and smoke checks against staging.
5. Confirm the down migration policy. Production is forward-only; rollback is restore-to-backup or a
   new compensating migration, never an in-place destructive down migration.

Migrations that would delete posted financial history must not be written. Existing down migrations
refuse to run while financial records exist.

## 5. Failed jobs and asynchronous work

There is no background job runner in this release. Posting, imports, allocations, reconciliation and
close operations are synchronous PostgreSQL transactions and either commit completely or roll back.
XLSX parsing happens in the browser and posts validated JSON/CSV to the API; it is not a server job.

If a queue or scheduled job is added later, it must have an idempotency key, bounded retries with
backoff, a dead-letter queue, an operator-visible failure record and an audit event. Do not add a
fire-and-forget job that can post twice.

## 6. Security headers and edge configuration

The production HTML build injects a Content-Security-Policy meta tag with SHA-256 hashes for the
theme bootstrap and JSON-LD blocks. Re-verify it after every build:

```bash
npm run check:built-security
```

The API already sets `x-content-type-options`, `x-frame-options`, `referrer-policy`,
`permissions-policy`, `cross-origin-opener-policy`, a restrictive API CSP and HSTS in production.

The static host/reverse proxy must also set headers because a meta tag cannot enforce
`frame-ancestors` or HSTS:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

If the API is served from a different origin, add that exact origin to the CSP `connect-src` via
`VITE_API_BASE_URL`; do not add `*`. TLS is mandatory. Set `APP_ORIGIN` to the public HTTPS origin;
production configuration rejects localhost.

## 7. Data protection and retention

- Treat names, mobile numbers, emails, NID, TIN, BIN, bank details and payroll/tax records as
  sensitive. Do not put real data in Git, browser storage, screenshots, logs or test fixtures.
- Backups and exports contain personal data. Encrypt them, restrict access and log access.
- The retention schedule and deletion/export obligations require legal review. The repository does
  not invent a statutory retention period.
- The public demo-request table stores lead contact details outside company scope and has no public
  read endpoint. Its retention period is an operational/legal decision.

## 8. Incident response

1. **Identify and classify** — data exposure, unauthorised posting, cross-tenant access, lost
   availability, backup failure or suspected credential compromise.
2. **Contain** — revoke sessions, disable the affected account, block the route at the edge, or take
   the API read-only. Preserve logs, database snapshots and audit events.
3. **Assess** — use `audit_events`, request IDs, posting/journal links and reconciliation proofs to
   establish what changed and which companies are affected.
4. **Eradicate and recover** — rotate secrets, patch, restore from a verified backup if needed, and
   re-run control proofs before resuming writes.
5. **Notify** — follow the verified legal/contractual notification obligations. Do not guess the
   regulator, deadline or wording.
6. **Review** — write a blameless post-incident report with timeline, root cause, data impact,
   corrective actions and owners.

Never delete posted financial history or audit events to hide an incident. Corrections use linked
reversals with a reason and approval.

## 9. Release and support

See `docs/RELEASE_CHECKLIST.md`, `docs/SUPPORT_PLAYBOOK.md`, `docs/ADMIN_GUIDE.md`,
`docs/ACCOUNTANT_GUIDE.md` and `docs/UAT_PLAN.md`.
