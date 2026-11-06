# Fintuity Accounting Suite API — backend foundation

This workspace contains the Phase 12 backend: identity and tenancy, server-backed company
configuration, the server-authoritative ledger, the inventory subledger, sales/receivables,
purchases/payables, treasury/withholding certificates, banking/MFS reconciliation, management
reporting, controlled close, approvals and the append-only audit log. It provides a Fastify API,
PostgreSQL pool, Drizzle schema bindings, a versioned SQL migration runner, structured logging,
health checks, Argon2id authentication, server-side sessions, CSRF-protected mutations,
organisations, company memberships, invitations, append-only audit events, company onboarding,
fiscal years and periods, chart of accounts, opening-balance batches, bank/cash/MFS setup, company
settings, manual journals, linked reversals, period status enforcement, an account-level trial
balance, parties, items, branches/warehouses, immutable stock movements, weighted-average valuation,
inventory-to-GL control proof, sales invoice and credit-note posting, customer receipts, AR
allocation, ageing/statements, an AR control proof, supplier bills and expense vouchers, AP
allocation/partial payments, VDS/TDS/reverse-charge liabilities, AP ageing/statements, withholding
control proofs, persisted treasury challans, draft withholding certificates, maker-checker approval
for high-value documents/journals/payments/reversals, immutable bank/MFS statement imports,
deterministic split-aware matching, approved create-GL journals, configurable fee rules,
prepared/reviewed reconciliation sign-off, company/branch-scoped financial statements, VAT registers,
draft VAT 9.1, CSV/XLSX/print report export, persisted close runs with evidence and maker-checker,
suspense resolutions and audit-log CSV export. Payroll and statutory filing remain in the clearly
labelled synthetic demo or a later phase.

## Prerequisites

- Node.js `>=22.18` for running the TypeScript source directly in development and migrations.
  The compiled `dist/` output runs on Node.js 20.19+.
- PostgreSQL 16.
- Docker is optional. Docker Compose is the simplest local option; a manual PostgreSQL install or
  a portable PostgreSQL 16 distribution is documented below.

## Local setup with Docker Compose

1. Copy the example environment file and replace the placeholder password:

   ```bash
   cp .env.example .env
   ```

2. Start PostgreSQL, apply migrations, then start the API:

   ```bash
   docker compose up --build
   ```

   The `migrate` service runs once and must complete before the `api` service starts.
   The API is published on <http://127.0.0.1:3000>.

   > Phase 2 verification note: Docker was not installed in the implementation environment. The
   > Compose file is provided but was not executed there. The same migration, build, start and
   > health checks were verified against a native PostgreSQL 16.15 cluster. Treat the Compose path
   > as requiring a first-run verification on a Docker-equipped machine.

3. Check health:

   ```bash
   curl http://127.0.0.1:3000/health
   ```

4. Stop the stack without deleting data:

   ```bash
   docker compose down
   ```

   `docker compose down -v` also deletes the PostgreSQL volume. That is destructive.

## Local setup without Docker

1. Install PostgreSQL 16 and create a local database and role. Example (adjust names locally):

   ```sql
   CREATE ROLE ledgervault LOGIN PASSWORD 'replace-with-a-local-password' CREATEDB;
   CREATE DATABASE ledgervault OWNER ledgervault;
   ```

   A portable PostgreSQL 16 Windows/Linux archive works too; initialise a disposable cluster with
   `initdb`, start it on a non-default port, and set `DATABASE_URL` accordingly. Do not commit the
   data directory.

2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `POSTGRES_PASSWORD` consistently.

3. Install dependencies from the repository root:

   ```bash
   npm ci
   ```

4. Apply migrations and start the API:

   ```bash
   npm run migrate
   npm run migrate:status
   npm run server:dev
   ```

   `server:dev` uses Node's native TypeScript execution and watches the server source. For a
   compiled process use `npm run build:server && npm run server:start`.

## Environment variables

The API refuses to start when required configuration is missing or invalid. Errors name the
variable, never its value.

| Variable                          | Required | Default                 | Purpose                                                   |
| --------------------------------- | -------- | ----------------------- | --------------------------------------------------------- |
| `NODE_ENV`                        | no       | `development`           | `development`, `test` or `production`.                    |
| `HOST`                            | no       | `127.0.0.1`             | Listen address.                                           |
| `PORT`                            | no       | `3000`                  | Listen port.                                              |
| `DATABASE_URL`                    | **yes**  | —                       | PostgreSQL connection URL.                                |
| `LOG_LEVEL`                       | no       | `info`                  | `fatal`…`trace`, or `silent`.                             |
| `TRUST_PROXY`                     | no       | `false`                 | Trust the reverse proxy's forwarded client address.       |
| `DB_SSL`                          | no       | `disable`               | `require` enables TLS with certificate verification.      |
| `DB_POOL_MAX`                     | no       | `10`                    | Maximum pooled connections.                               |
| `DB_IDLE_TIMEOUT_MS`              | no       | `30000`                 | Idle connection timeout.                                  |
| `DB_CONNECTION_TIMEOUT_MS`        | no       | `5000`                  | Connection acquisition timeout.                           |
| `SHUTDOWN_TIMEOUT_MS`             | no       | `10000`                 | Graceful shutdown deadline before a forced exit.          |
| `APP_ORIGIN`                      | no       | `http://localhost:5173` | Browser origin for same-origin checks and one-time links. |
| `SESSION_IDLE_MINUTES`            | no       | `30`                    | Sliding idle session window.                              |
| `SESSION_ABSOLUTE_HOURS`          | no       | `12`                    | Absolute session lifetime; never extended.                |
| `COOKIE_SECURE`                   | no       | production              | Override secure cookies only for a deliberate TLS proxy.  |
| `PASSWORD_MIN_LENGTH`             | no       | `12`                    | Minimum password length.                                  |
| `LOGIN_MAX_ATTEMPTS`              | no       | `5`                     | Failed attempts before temporary account lock.            |
| `LOGIN_LOCK_MINUTES`              | no       | `15`                    | Temporary lock duration.                                  |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES`  | no       | `15`                    | Database-backed auth rate-limit window.                   |
| `AUTH_RATE_LIMIT_MAX_ATTEMPTS`    | no       | `20`                    | Auth rate-limit budget per IP bucket.                     |
| `INVITATION_EXPIRY_HOURS`         | no       | `168`                   | Invitation lifetime.                                      |
| `PASSWORD_RESET_EXPIRY_MINUTES`   | no       | `60`                    | Reset link lifetime.                                      |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | no       | `24`                    | Verification link lifetime.                               |
| `ARGON2_MEMORY_KIB`               | no       | `19456`                 | Argon2id memory cost.                                     |
| `ARGON2_TIME_COST`                | no       | `2`                     | Argon2id passes.                                          |
| `ARGON2_PARALLELISM`              | no       | `1`                     | Argon2id parallelism.                                     |
| `EMAIL_TRANSPORT`                 | no       | `file`                  | `file` (development outbox) or `memory` (tests).          |
| `EMAIL_OUTBOX_DIR`                | no       | `.tmp/mail`             | Git-ignored development mail outbox.                      |
| `EMAIL_FROM`                      | no       | local sender            | Sender address used by the adapter.                       |
| `POSTGRES_PASSWORD`               | Compose  | —                       | Local PostgreSQL container password only.                 |
| `TEST_DATABASE_URL`               | Tests    | —                       | Maintenance database for disposable integration-test DBs. |

Do not put production secrets in `.env`; use the platform secret store. `.env` is git-ignored.

## Commands

Run from the repository root:

| Command                             | Purpose                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| `npm run server:dev`                | Start the API in watch mode against the configured database.      |
| `npm run build:server`              | Compile the server to `server/dist`.                              |
| `npm run server:start`              | Start the compiled server.                                        |
| `npm run typecheck:server`          | Typecheck server source and tests.                                |
| `npm run test:server`               | Unit and integration tests (integration tests skip without a DB). |
| `npm run test:server:integration`   | Integration tests only.                                           |
| `npm run migrate`                   | Apply pending migrations.                                         |
| `npm run auth:bootstrap -- ...`     | Create the first organisation owner (see below).                  |
| `npm run migrate:status`            | Show applied and pending migrations.                              |
| `npm run migrate:down -- --steps 1` | Roll back development/test migrations.                            |
| `npm run db:reset:dev -- --yes`     | **Destructive** development reset; see below.                     |

## First owner and invitations

There is no public self-signup. Create the first verified owner once against a new database:

```bash
npm run auth:bootstrap -- \
  --email owner@example.test \
  --name "Owner Name" \
  --organisation "Example Organisation" \
  --company "Example Company" \
  --password "a-long-local-password"
```

Omit `--password` to create a single-use password-setup link through the configured email adapter.
A password supplied on the command line can remain in shell history, so prefer the link outside a
disposable development environment. The command never prints the password or the token.

After signing in, an Owner or Admin can invite controllers, accountants, operators and auditors from
`/app/team`. Invitations are single-use, expire automatically, are stored as SHA-256 token hashes and
are audited on create, resend, revoke and acceptance. Non-owner/admin roles require an explicit
company scope. Only an Owner can grant the Owner role; the last active Owner cannot be demoted or
removed, and no user can change their own role.

Phase 3 email delivery is adapter-based: `file` writes plain-text messages to `EMAIL_OUTBOX_DIR` and
`memory` is used by tests. A production SMTP/provider adapter is an external go-live blocker.

## Identity API summary

| Method      | Path                                                           | Access                                           |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------ |
| POST        | `/api/v1/auth/login`                                           | Public, rate-limited, generic errors             |
| POST        | `/api/v1/auth/logout`                                          | Session + CSRF                                   |
| GET         | `/api/v1/auth/me`                                              | Session                                          |
| POST        | `/api/v1/auth/forgot-password`                                 | Public, neutral response                         |
| POST        | `/api/v1/auth/reset-password`                                  | Public, single-use token                         |
| POST        | `/api/v1/auth/verify-email`                                    | Public, single-use token                         |
| POST        | `/api/v1/auth/change-password`                                 | Session + CSRF; revokes other sessions           |
| GET/DELETE  | `/api/v1/auth/sessions[/:id]`                                  | Session; own sessions only                       |
| POST        | `/api/v1/auth/active-company`                                  | Session + CSRF; membership re-checked            |
| GET         | `/api/v1/auth/invitations/:token`                              | Public, minimal metadata                         |
| POST        | `/api/v1/auth/invitations/accept`                              | Public/optional session; single-use token        |
| GET/PATCH   | `/api/v1/organisations/:id/members[/:userId]`                  | Organisation + `MANAGE_USERS_AND_ORG`            |
| GET/POST    | `/api/v1/organisations/:id/invitations`                        | Organisation + `MANAGE_USERS_AND_ORG`            |
| POST/DELETE | `/api/v1/organisations/:id/invitations/:invitationId[/resend]` | Organisation + `MANAGE_USERS_AND_ORG`            |
| GET         | `/api/v1/organisations/:id/companies`                          | Organisation membership                          |
| GET         | `/api/v1/companies[/:companyId]`                               | Session; company membership for the detail route |

Every route must declare its auth mode at registration or the server refuses to start. Company-scoped
routes resolve the caller's membership and effective company role from PostgreSQL; a client-supplied
company id is never trusted. Cross-tenant requests return `404` rather than confirming an identifier.

## Ledger API summary (Phase 5)

| Method | Path                                                               | Access                              |
| ------ | ------------------------------------------------------------------ | ----------------------------------- |
| GET    | `/api/v1/companies/:id/journals`                                   | Company + `VIEW_REPORTS`            |
| GET    | `/api/v1/companies/:id/journals/:journalId`                        | Company + `VIEW_REPORTS`            |
| POST   | `/api/v1/companies/:id/journals`                                   | Company + `POST_TO_GL`              |
| PATCH  | `/api/v1/companies/:id/journals/:journalId`                        | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/journals/:journalId/submit`                 | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/journals/:journalId/approve`                | Company + `APPROVE_HIGH_VALUE`      |
| POST   | `/api/v1/companies/:id/journals/:journalId/post`                   | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/journals/:journalId/reverse`                | Company + `REVERSE_POSTED_JOURNAL`  |
| GET    | `/api/v1/companies/:id/trial-balance?periodId=...` or `?from=&to=` | Company + `VIEW_REPORTS`            |
| GET    | `/api/v1/companies/:id/trial-balance/:accountId?periodId=...`      | Company + `VIEW_REPORTS`            |
| PATCH  | `/api/v1/companies/:id/periods/:periodId`                          | Company + `MANAGE_COMPANY_SETTINGS` |
| POST   | `/api/v1/companies/:id/opening-balances/:batchId/approve`          | Company + `APPROVE_HIGH_VALUE`      |
| POST   | `/api/v1/companies/:id/opening-balances/:batchId/post`             | Company + `POST_TO_GL`              |

Posting accepts an optional `Idempotency-Key` header. A retry with the same key returns the original
posted journal; a different key against an already-posted document is rejected. Journal numbers use
the existing company `JOURNAL` sequence (default `JE-`) plus the period code and padded sequence,
for example `JE-2026-11-0001`. The sequence is per company/fiscal year, so a later-period journal
continues the suffix rather than restarting it. Numbers are never reused. Only the statutory BDT book
is exposed in this phase; `book_type` is retained for the later multi-book design.

Opening balances are prepared in the setup wizard, then submitted, approved by a different user and
posted exactly once from the ledger workspace. The batch carries a permanent `journal_id` link and a
one-time `POSTED` state. A linked reversal can reverse the opening journal; the batch then becomes
`REVERSED` and cannot be posted again.

The trial balance is derived only from `POSTED`/`REVERSED` journals and includes linked reversals.
Opening, period and closing balances are computed in integer poisha; the API returns strings and
never trusts a client-supplied total. Closing debit/credit balances are net account balances, so a
reversed pair nets to zero while remaining visible in the drill-down.

## Master data and inventory API summary (Phase 6)

| Method    | Path                                                                      | Access                                   |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| GET/POST  | `/api/v1/companies/:id/parties`                                           | Company; create `MANAGE_MASTERS_AND_COA` |
| GET/PATCH | `/api/v1/companies/:id/parties/:partyId`                                  | Company; update `MANAGE_MASTERS_AND_COA` |
| POST      | `/api/v1/companies/:id/parties/:partyId/deactivate` / `reactivate`        | Company + `MANAGE_MASTERS_AND_COA`       |
| GET/POST  | `/api/v1/companies/:id/parties/:partyId/opening-items`                    | Company; create `MANAGE_MASTERS_AND_COA` |
| POST      | `/api/v1/companies/:id/parties/:partyId/opening-items/:itemId/cancel`     | Company + `MANAGE_MASTERS_AND_COA`       |
| GET/POST  | `/api/v1/companies/:id/items`                                             | Company; create `MANAGE_MASTERS_AND_COA` |
| GET/PATCH | `/api/v1/companies/:id/items/:itemId`                                     | Company; update `MANAGE_MASTERS_AND_COA` |
| POST      | `/api/v1/companies/:id/items/:itemId/deactivate` / `reactivate`           | Company + `MANAGE_MASTERS_AND_COA`       |
| GET/POST  | `/api/v1/companies/:id/branches`                                          | Company; create `MANAGE_MASTERS_AND_COA` |
| PATCH     | `/api/v1/companies/:id/branches/:branchId`                                | Company + `MANAGE_MASTERS_AND_COA`       |
| POST      | `/api/v1/companies/:id/branches/:branchId/deactivate` / `reactivate`      | Company + `MANAGE_MASTERS_AND_COA`       |
| GET/POST  | `/api/v1/companies/:id/warehouses`                                        | Company; create `MANAGE_MASTERS_AND_COA` |
| GET/PATCH | `/api/v1/companies/:id/warehouses/:warehouseId`                           | Company; update `MANAGE_MASTERS_AND_COA` |
| POST      | `/api/v1/companies/:id/warehouses/:warehouseId/deactivate` / `reactivate` | Company + `MANAGE_MASTERS_AND_COA`       |
| GET       | `/api/v1/companies/:id/inventory/balances`                                | Company membership                       |
| GET       | `/api/v1/companies/:id/inventory/movements`                               | Company membership                       |
| GET       | `/api/v1/companies/:id/inventory/control-proof?asOf=YYYY-MM-DD`           | Company + `VIEW_REPORTS`                 |
| POST      | `/api/v1/companies/:id/inventory/movements`                               | Company + `DISPATCH_OR_RECEIVE_STOCK`    |
| POST      | `/api/v1/companies/:id/inventory/commands/:commandId/reverse`             | Company + `DISPATCH_OR_RECEIVE_STOCK`    |

Stock commands require an `Idempotency-Key` header. They are single-item commands; a transfer creates
a linked out/in pair. Quantities are stored as `NUMERIC(18,4)` and submitted as decimal strings with
at most four places. Values are integer poisha. Negative stock is blocked by default;
`allowNegativeStock` additionally requires `OVERRIDE_NEGATIVE_STOCK` and a 3–500 character reason.
The override is stored on the movement and audited.

Stock items must use active inventory (asset) and expense/COGS accounts from the same company.
Changing the unit, either account or the stock-item flag is refused once the item has stock
movements. Items and warehouses with a non-zero stock balance cannot be deactivated. Parties with
open opening items cannot be deactivated.

## Sales, credit notes and receivables API summary (Phase 7)

| Method    | Path                                                                | Access                                    |
| --------- | ------------------------------------------------------------------- | ----------------------------------------- |
| GET       | `/api/v1/companies/:id/sales/documents`                             | Company membership                        |
| POST      | `/api/v1/companies/:id/sales/documents`                             | Company + `CREATE_COMMERCIAL_DRAFT`       |
| GET/PATCH | `/api/v1/companies/:id/sales/documents/:documentId`                 | Company; update `CREATE_COMMERCIAL_DRAFT` |
| POST      | `/api/v1/companies/:id/sales/documents/:documentId/approve`         | Company + `APPROVE_HIGH_VALUE`            |
| POST      | `/api/v1/companies/:id/sales/documents/:documentId/post`            | Company + `POST_TO_GL`                    |
| POST      | `/api/v1/companies/:id/sales/documents/:documentId/reverse`         | Company + `REVERSE_POSTED_JOURNAL`        |
| GET       | `/api/v1/companies/:id/sales/open-invoices`                         | Company membership                        |
| GET/POST  | `/api/v1/companies/:id/sales/receipts`                              | Company; post `POST_TO_GL`                |
| GET       | `/api/v1/companies/:id/sales/receipts/:receiptId`                   | Company membership                        |
| POST      | `/api/v1/companies/:id/sales/receipts/:receiptId/allocations`       | Company + `POST_TO_GL`                    |
| POST      | `/api/v1/companies/:id/sales/receipts/:receiptId/reverse`           | Company + `REVERSE_POSTED_JOURNAL`        |
| GET       | `/api/v1/companies/:id/sales/ar-ageing?asOf=YYYY-MM-DD`             | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/sales/customer-statement?partyId=&from=&to=` | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/sales/vat-register?from=&to=`                | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/sales/tax-policy`                            | Company membership                        |
| POST      | `/api/v1/companies/:id/sales/tax-policy/approval`                   | Company + `MANAGE_COMPANY_SETTINGS`       |

Draft creation, posting and receipts require an `Idempotency-Key`; posting a credit note at or above
the configured high-value threshold requires approval by a different controller. Document numbers and
Mushak 6.3/6.7 internal serials are allocated inside the posting transaction from per-company,
per-fiscal-year sequences and are never reused. Credit notes carry `M67` serials and never consume
`M63`. Amounts are integer poisha; quantities are decimal strings with up to four places.

Posting requires a recorded reviewer approval for the exact server tax-pack version and an active
output VAT liability account. The pack remains marked `PENDING_TAX_COUNSEL`; the application stores
the reviewer record, it does not perform the review. Drafts can be created and reviewed without
approval, but posting is blocked.

## Purchases, bills and payables API summary (Phase 8)

| Method    | Path                                                                    | Access                                    |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| GET       | `/api/v1/companies/:id/purchases/documents`                             | Company membership                        |
| POST      | `/api/v1/companies/:id/purchases/documents`                             | Company + `CREATE_COMMERCIAL_DRAFT`       |
| GET/PATCH | `/api/v1/companies/:id/purchases/documents/:documentId`                 | Company; update `CREATE_COMMERCIAL_DRAFT` |
| POST      | `/api/v1/companies/:id/purchases/documents/:documentId/post`            | Company + `POST_TO_GL`                    |
| POST      | `/api/v1/companies/:id/purchases/documents/:documentId/reverse`         | Company + `REVERSE_POSTED_JOURNAL`        |
| GET       | `/api/v1/companies/:id/purchases/open-bills`                            | Company membership                        |
| GET/POST  | `/api/v1/companies/:id/purchases/payments`                              | Company; post `POST_TO_GL`                |
| POST      | `/api/v1/companies/:id/purchases/payments/preview`                      | Company membership                        |
| GET       | `/api/v1/companies/:id/purchases/payments/:paymentId`                   | Company membership                        |
| POST      | `/api/v1/companies/:id/purchases/payments/:paymentId/reverse`           | Company + `REVERSE_POSTED_JOURNAL`        |
| GET       | `/api/v1/companies/:id/purchases/ap-ageing?asOf=YYYY-MM-DD`             | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/purchases/supplier-statement?partyId=&from=&to=` | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/purchases/withholding-liabilities`               | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/purchases/withholding-proof?asOf=YYYY-MM-DD`     | Company + `VIEW_REPORTS`                  |
| GET       | `/api/v1/companies/:id/purchases/tax-policy`                            | Company membership                        |
| POST      | `/api/v1/companies/:id/purchases/tax-policy/approval`                   | Company + `MANAGE_COMPANY_SETTINGS`       |

Draft creation, posting and payments require an `Idempotency-Key`. A posted bank/MFS/cheque payment
requires a unique reference; duplicate posted references are rejected. Bill posting allocates the
document number and commits the journal, AP item, tax evidence, reverse-charge liability and any stock
receipt in one transaction. Supplier payments compute the actual VDS/TDS from the allocation, post
Dr AP / Cr bank / Cr VDS payable / Cr TDS payable, and create pending withholding liabilities. AP
outstanding derives from posted bills less posted payment allocations. Purchase orders, a separate
GRN, three-way matching and purchase debit notes are intentionally not modelled in this phase and are
not exposed by the real UI.

Posting requires a recorded reviewer approval for the exact purchase tax-pack version and active
input-VAT, VDS-payable, TDS-payable and reverse-charge payable accounts. The pack remains marked
`PENDING_TAX_COUNSEL`; the application stores the reviewer record, it does not perform the review.

## Treasury, deposits and withholding certificates API summary (Phase 9)

| Method | Path                                                                    | Access                             |
| ------ | ----------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/v1/companies/:id/treasury/liabilities`                            | Company + `VIEW_REPORTS`           |
| PATCH  | `/api/v1/companies/:id/treasury/liabilities/:liabilityId/economic-code` | Company + `POST_TO_GL`             |
| GET    | `/api/v1/companies/:id/treasury/challans`                               | Company + `VIEW_REPORTS`           |
| POST   | `/api/v1/companies/:id/treasury/challans`                               | Company + `POST_TO_GL`             |
| GET    | `/api/v1/companies/:id/treasury/challans/:challanId`                    | Company + `VIEW_REPORTS`           |
| POST   | `/api/v1/companies/:id/treasury/challans/:challanId/reverse`            | Company + `REVERSE_POSTED_JOURNAL` |
| GET    | `/api/v1/companies/:id/treasury/certificates`                           | Company + `VIEW_REPORTS`           |
| GET    | `/api/v1/companies/:id/treasury/certificates/:certificateId`            | Company + `VIEW_REPORTS`           |
| POST   | `/api/v1/companies/:id/treasury/certificates/:certificateId/cancel`     | Company + `APPROVE_HIGH_VALUE`     |
| POST   | `/api/v1/companies/:id/treasury/certificates/:certificateId/reissue`    | Company + `APPROVE_HIGH_VALUE`     |
| GET    | `/api/v1/companies/:id/treasury/proof?asOf=YYYY-MM-DD`                  | Company + `VIEW_REPORTS`           |
| GET    | `/api/v1/companies/:id/purchases/payment-approvals`                     | Company + `VIEW_REPORTS`           |
| GET    | `/api/v1/companies/:id/purchases/payment-approvals/:requestId`          | Company + `VIEW_REPORTS`           |
| POST   | `/api/v1/companies/:id/purchases/payment-approvals/:requestId/approve`  | Company + `APPROVE_HIGH_VALUE`     |
| POST   | `/api/v1/companies/:id/purchases/payment-approvals/:requestId/reject`   | Company + `APPROVE_HIGH_VALUE`     |

A treasury challan requires an `Idempotency-Key`. The server locks the selected PENDING liabilities,
verifies the company tax-policy approval and the OPEN deposit period, allocates the internal
`TREASURY_CHALLAN` number, posts Dr each liability control account / Cr bank/cash, inserts the
persisted challan and items, marks the liabilities `DEPOSITED` with an economic code, and creates
draft VDS/TDS certificates — all in one transaction. A liability already deposited is rejected; a
duplicate posted bank deposit reference is rejected. Certificates copy the source liability's base
and tax exactly; the certificate trigger rejects any mismatch. Certificates are always `DRAFT` and
carry `DRAFT — statutory format not verified`; cancellation and reissue preserve the original row and
write audit events. Reverse the challan to restore its liabilities to `PENDING` and cancel its draft
certificates; a second reversal is rejected.

A supplier payment at or above the company `paymentPoisha` approval threshold creates a persisted
approval request and returns HTTP `202` without posting. The request snapshot is server-computed.
A different user with `APPROVE_HIGH_VALUE` must approve it; the requester cannot self-approve. On
approval the server revalidates the open bills, withholding, period and amounts before posting the
payment, AP allocation, withholding liabilities and journal in one transaction. Rejection is terminal
and posts nothing. Customer receipts support partial/multiple allocations, permissioned write-offs and
unapplied cash; supplier advances are not yet modelled.

## Banking, MFS and reconciliation API summary (Phase 10)

| Method | Path                                                                             | Access                              |
| ------ | -------------------------------------------------------------------------------- | ----------------------------------- |
| GET    | `/api/v1/companies/:id/bank-accounts/:bankAccountId/bank-lines`                  | Company + `VIEW_REPORTS`            |
| GET    | `/api/v1/companies/:id/bank-lines/:lineId`                                       | Company + `VIEW_REPORTS`            |
| GET    | `/api/v1/companies/:id/bank-lines/:lineId/candidates`                            | Company + `VIEW_REPORTS`            |
| POST   | `/api/v1/companies/:id/bank-accounts/:bankAccountId/statements/preview`          | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-accounts/:bankAccountId/statements/import`           | Company + `POST_TO_GL`              |
| GET    | `/api/v1/companies/:id/bank-accounts/:bankAccountId/statements`                  | Company + `VIEW_REPORTS`            |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/match`                                 | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/unmatch`                               | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/exclude`                               | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/assign-exception`                      | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/create-gl`                             | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-gl-requests/:requestId/submit`                       | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-gl-requests/:requestId/approve`                      | Company + `APPROVE_HIGH_VALUE`      |
| GET    | `/api/v1/companies/:id/bank-fee-rules`                                           | Company + `VIEW_REPORTS`            |
| POST   | `/api/v1/companies/:id/bank-fee-rules`                                           | Company + `MANAGE_COMPANY_SETTINGS` |
| PATCH  | `/api/v1/companies/:id/bank-fee-rules/:ruleId`                                   | Company + `MANAGE_COMPANY_SETTINGS` |
| POST   | `/api/v1/companies/:id/bank-lines/:lineId/fee`                                   | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-transfers`                                           | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-transfers/:transferId/reverse`                       | Company + `REVERSE_POSTED_JOURNAL`  |
| GET    | `/api/v1/companies/:id/bank-accounts/:bankAccountId/reconciliation?periodId=...` | Company + `VIEW_REPORTS`            |
| POST   | `/api/v1/companies/:id/bank-reconciliations/prepare`                             | Company + `POST_TO_GL`              |
| POST   | `/api/v1/companies/:id/bank-reconciliations/:reconciliationId/review`            | Company + `APPROVE_HIGH_VALUE`      |
| GET    | `/api/v1/companies/:id/bank-reconciliations/:reconciliationId/report`            | Company + `EXPORT_DATA`             |

The CSV/XLSX template is `date,description,reference,debit,credit,balance`; `debit` is money in and
`credit` is money out. Import retains the normalised source content and SHA-256, validates each row,
rejects in-file and already-imported duplicate fingerprints, and never posts a journal. Matching
consumes statement and journal-line capacity with database triggers; a journal line cannot be reused
for another statement line unless the match is explicitly `SPLIT`. Create-GL journals use the
`BANK_RECONCILIATION` source, must be submitted and approved by a different user, then post and match
in one transaction. Fee rules are configuration with an expense account, effective dates and policy
evidence; no universal rate is seeded. A second fee posting for the same line is rejected while the
first is `POSTED`; a linked journal reversal marks it `REVERSED` and permits one replacement posting.
Reversing a matched journal, fee journal, create-GL journal or transfer journal synchronises the
linked banking records and unmatches the statement line in the same transaction. A reconciliation
must be prepared and then reviewed by a different user; a new import invalidates a prepared snapshot,
and closing/locking the period locks the reconciliation with a system audit event.

## Reports API summary (Phase 11)

All report reads require `VIEW_REPORTS`; CSV and XLSX/PDF/print audit calls require `EXPORT_DATA`.
Company scope comes from the path and is rechecked against membership; `branchId` may be a branch UUID
or `UNASSIGNED`, and is applied to journals and document-based registers. Amounts are integer poisha
strings; no report performs floating-point aggregation.

| Method | Route                                                                                     | Permission     |
| ------ | ----------------------------------------------------------------------------------------- | -------------- |
| GET    | `/api/v1/companies/:id/reports/catalog`                                                   | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/trial-balance?periodId=\|from=&to=`                        | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/general-ledger/:accountId?periodId=\|from=&to=`            | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/profit-and-loss?periodId=\|from=&to=&comparativePeriodId=` | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/balance-sheet?periodId=\|asOf=&comparativeAsOf=`           | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/cash-flow?periodId=\|from=&to=`                            | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/changes-in-equity?periodId=\|from=&to=`                    | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/ar-ageing?asOf=` / `ap-ageing`                             | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/stock-valuation?asOf=`                                     | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/vat-sales-register?periodId=\|from=&to=`                   | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/vat-purchase-register?periodId=\|from=&to=`                | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/vat-return?periodId=\|from=&to=`                           | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/withholding-register?periodId=\|from=&to=`                 | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/journal-listing?...`                                       | `VIEW_REPORTS` |
| GET    | `/api/v1/companies/:id/reports/export/:reportKey?...`                                     | `EXPORT_DATA`  |
| POST   | `/api/v1/companies/:id/reports/export-audit`                                              | `EXPORT_DATA`  |

Trial balance, balance sheet, cash flow, AR/AP control proofs and stock valuation return explicit
checks. A failed blocking check returns `409 REPORT_EXPORT_BLOCKED` from the export routes. The VAT
return is always `DRAFT — NOT FILED`, never produces a filing acknowledgement, and carries the
template review status. Management accounts are returned with the `Management accounts — unaudited`
template label. Journal detail returns `sourceEvidence` with the source document, tax decision state,
rule-pack version, trace id and document events, so every report line can drill to evidence.

## Close, approvals and audit API summary (Phase 12)

All close and suspense reads require `VIEW_REPORTS`. Close preparation, refresh and submission
require `SUBMIT_CLOSE_MAKER`; approval/rejection requires `APPROVE_CLOSE_CHECKER`; period reopen
requires `REOPEN_PERIOD`; close-pack export requires `EXPORT_DATA`. Suspense requests use `POST_TO_GL`
and approval uses `APPROVE_HIGH_VALUE`. The server enforces that the checker is not the maker or
submitter; client-supplied status, totals and sign-offs are never trusted.

| Method | Route                                                             | Permission              |
| ------ | ----------------------------------------------------------------- | ----------------------- |
| GET    | `/api/v1/companies/:id/close-runs?periodId=`                      | `VIEW_REPORTS`          |
| GET    | `/api/v1/companies/:id/close-runs/:runId`                         | `VIEW_REPORTS`          |
| POST   | `/api/v1/companies/:id/close-runs`                                | `SUBMIT_CLOSE_MAKER`    |
| POST   | `/api/v1/companies/:id/close-runs/:runId/refresh`                 | `SUBMIT_CLOSE_MAKER`    |
| POST   | `/api/v1/companies/:id/close-runs/:runId/submit`                  | `SUBMIT_CLOSE_MAKER`    |
| POST   | `/api/v1/companies/:id/close-runs/:runId/decide`                  | `APPROVE_CLOSE_CHECKER` |
| POST   | `/api/v1/companies/:id/periods/:periodId/reopen`                  | `REOPEN_PERIOD`         |
| GET    | `/api/v1/companies/:id/close-runs/:runId/pack.csv`                | `EXPORT_DATA`           |
| GET    | `/api/v1/companies/:id/suspense`                                  | `VIEW_REPORTS`          |
| POST   | `/api/v1/companies/:id/suspense/resolutions`                      | `POST_TO_GL`            |
| POST   | `/api/v1/companies/:id/suspense/resolutions/:resolutionId/decide` | `APPROVE_HIGH_VALUE`    |
| GET    | `/api/v1/companies/:id/audit-events?...`                          | `VIEW_REPORTS`          |
| GET    | `/api/v1/companies/:id/audit-events/export.csv?...`               | `EXPORT_DATA`           |

Close runs store a checklist snapshot and SHA-256 hash. Submit and approval re-run the controls, so a
stale checklist cannot be approved. Approval sets the period to `LOCKED`; a later close requires a
new run. Suspense approval posts a linked `SUSPENSE` journal through the same ledger transaction and
period checks as every other posting. The audit log is append-only by database trigger and the
export writes its own `audit.exported` event.

## Public demo requests (Phase 13)

The landing page uses one public, unauthenticated write endpoint. It is not company-scoped because a
lead is not a financial record. There is no public read endpoint.

| Method | Route                          | Behaviour                                                                                                                                                       |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/public/demo-requests` | Validate name, work email, company, optional message and source; rate-limit by IP (5/hour); insert into `demo_requests`; return a reference and generic message |

The server stores the submitted contact details only in `demo_requests`; it does not store the request
IP or user agent in that table, and it does not log the visitor's name, email, company or message.
The route uses the same PostgreSQL-backed fixed-window rate limiter as authentication, so the limit is
shared across API instances. The migration is
`server/migrations/0012_public_demo_requests.up.sql`; its down migration refuses to run while any demo
request exists. Production notification/CRM delivery is an operational decision, not silently
simulated by the API.

## Migrations and rollback

Migrations live in `server/migrations/` as paired `NNNN_name.up.sql` and `NNNN_name.down.sql`
files. The runner stores the id, checksum and execution time in `schema_migrations`, takes a
PostgreSQL advisory lock and runs each migration in its own transaction.

- **Production is forward-only.** `migrate:down` refuses to run when `NODE_ENV=production`.
- Applied migration files must never be edited. The checksum check fails loudly if one changed;
  add a new migration instead.
- Before a production deployment, take a verified `pg_dump`/PITR backup, run the migration on a
  staging copy, then apply it in a controlled window. The rollback strategy is restore-to-backup
  or a new forward compensating migration — never an in-place down migration against real books.
- The down migrations exist for development and disposable test databases only.
- A migration that would destroy financial history must not be written; use additive,
  backward-compatible steps (add nullable column, backfill, then enforce).

Phase 7 is `server/migrations/0006_sales_receivables.up.sql`. Its down migration refuses to run when
any sales document or receipt exists; it deletes only the new number sequences and the
`sales_tax_policy` setting when the database is otherwise empty.

Phase 8 is `server/migrations/0007_purchases_payables.up.sql`. Its down migration refuses to run when
any purchase document or payment exists, removes the Phase 8 purchase-policy setting, and restores
the previous company-settings constraint when the database is otherwise empty.

Phase 9 is `server/migrations/0008_treasury_certificates.up.sql`. It adds treasury challans/items,
draft certificates, payment approval requests, settlement attachment references, treasury economic
codes, the `TREASURY` journal source and the `TREASURY_CERTIFICATE` sequence. Its down migration
refuses to run when any challan, certificate or payment approval request exists.

Phase 10 is `server/migrations/0009_banking_reconciliation.up.sql`. It adds immutable statement
imports and lines, explicit match allocations with capacity/reversal triggers, create-GL requests,
fee rules/postings, numbered bank transfers, reconciliation sign-off, the `BANK_TRANSFER` sequence
and the `BANK_RECONCILIATION` journal source. Database triggers reject over-allocation, deletion of
imported facts or matches, duplicate fee postings and mutation of posted reconciliation records.
Closing or locking a period locks its reconciliations and writes a system audit event. Its down
migration refuses to run while any Phase 10 record exists.

Phase 11 is `server/migrations/0010_reporting_branch_scope.up.sql`. It adds an optional
`journals.branch_id` dimension, a composite branch foreign key and a branch/date index, plus a trigger
that prevents branch attribution changing after posting. Existing journals remain `NULL` and report
as Unassigned rather than being silently assigned to the principal branch. Its down migration refuses
to drop the column while any journal has branch attribution.

Phase 12 is `server/migrations/0011_close_approvals_audit.up.sql`. It adds `close_runs`,
`close_run_events`, `suspense_resolutions`, purchase-document approval fields, period reopen
provenance and the `SUSPENSE` account-control/journal-source values. Triggers reject deletion of
close runs, mutation of decided close evidence/events and mutation of decided suspense requests. Its
down migration refuses to run while any close evidence, suspense decision or approved sales invoice
exists.

Phase 13 is `server/migrations/0012_public_demo_requests.up.sql`. It adds the `demo_requests` table
for public walkthrough requests with length/format/status/source checks and a `set_updated_at`
trigger. It is deliberately outside organisation/company scope because a lead is not a financial
record. Its down migration refuses to run while any demo request exists.

A pre-deployment backup can be taken with PostgreSQL's own tools:

```bash
pg_dump --format=custom --no-owner --file=ledgervault-before-migration.dump "$DATABASE_URL"
# Verify the restore into a NEW database, never over the live one:
createdb ledgervault_restore_check
pg_restore --no-owner --dbname=ledgervault_restore_check ledgervault-before-migration.dump
```

Use `pg_dump`/`pg_restore` major versions that match the PostgreSQL server. A newer client can emit
settings the older server rejects (for example `transaction_timeout`). From the repository root, the
repeatable drill is:

```bash
npm run drill:backup-restore
```

It creates and drops disposable databases, applies every migration, inserts a sentinel row, dumps,
restores and compares the migration ledger, table list and every row count. It refuses to run with
`NODE_ENV=production`. Set `PG_DUMP`/`PG_RESTORE` when the matching client binaries are not on `PATH`.

A dump is not a valid backup until a restore has been tested. Do not commit dumps; `.gitignore`
excludes `*.dump` and `*.backup`.

### Safe development reset

`npm run db:reset:dev -- --yes` drops and recreates the `public` schema. It refuses to run in
production and refuses any database whose name does not end in `_dev` or `_test`. It deletes all
local data; take a `pg_dump` first if the data matters. Never run it against a shared database.

## Health and logging

- `GET /health/live` — process liveness only; no database access.
- `GET /health` — readiness; executes `SELECT 1` and returns `200` when the database is reachable,
  or `503` with a generic failure when it is not.
- `GET /api/v1/ping` — minimal route proving routing, request IDs and the error envelope.

Every response includes `x-request-id`. A valid inbound `x-request-id` is preserved; otherwise a
UUID is generated. Logs are JSON (Pino) with service, environment, request id and elapsed time.
Authorization, cookies, passwords, tokens, API keys and database URLs are redacted. Request
bodies are not logged. Production 500 responses contain a stable error code, a generic message and
the trace id — never a stack trace or database detail.

## Integration tests

`TEST_DATABASE_URL` must point at a PostgreSQL maintenance database whose role can `CREATEDB`
(the Compose/CI `ledgervault` role can). Each integration test file creates a uniquely named
database, migrates it, exercises the API, then drops it. Without `TEST_DATABASE_URL`, integration
tests are reported as skipped, not silently passed.

Example:

```bash
TEST_DATABASE_URL=postgresql://ledgervault:replace-with-a-local-password@127.0.0.1:5432/ledgervault npm run test:server:integration
```

On PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://ledgervault:replace-with-a-local-password@127.0.0.1:5432/ledgervault'
npm run test:server:integration
```

## Scope and known limitations

- Phase 3 adds authentication, sessions, invitations, memberships and server-side permissions.
- Phase 4 adds company onboarding, fiscal years and monthly periods, chart of accounts, opening
  balance batches, bank/cash/MFS accounts and company settings.
- Phase 5 adds the server-authoritative ledger: manual journals, linked reversals, opening-balance
  approval/posting, period status enforcement, an account-level trial balance and read-only auditor
  enforcement. Journal and opening posting are transactional, idempotent where a key is supplied,
  and audited. Journal lines and posted records are append-only by database trigger.
- Phase 6 adds company-scoped parties, items, branches/warehouses, the immutable stock subledger,
  weighted-average valuation, negative-stock control with an explicit permissioned override,
  stock-command reversal, party opening schedules and inventory-to-GL control proof. Stock commands
  are transactional and require an idempotency key; stock movements are append-only by trigger.
- Phase 7 adds server-persisted sales drafts, atomic invoice posting, line-level VAT evidence,
  6.7-style credit notes, customer receipts with partial/multiple allocations, unapplied cash,
  permissioned write-off, AR ageing/statements, AR control proof and document-level reversal. Posted
  documents and lines are immutable by trigger; tax decisions and allocations are append-only.
- Phase 8 adds supplier bill and expense-voucher drafts, atomic bill posting with line-level input VAT
  and inventory/expense classification, supplier e-TIN/BIN snapshots, a user-supplied Mushak 6.3
  evidence field, reverse-charge VAT, AP allocations, partial supplier payments, pending VDS/TDS
  liabilities, AP ageing/statements, withholding control proofs and linked document/payment reversal.
  A stock line on a posted bill is a real receipt; purchase orders, a separate GRN, three-way matching
  and purchase debit notes are explicitly not implemented and are not shown in the real UI.
- Phase 9 adds persisted treasury challans and liability links, atomic withholding deposits, draft
  VDS/TDS certificates derived from the source liability, certificate cancellation/reissue, deposit
  reversal and treasury control proofs. High-value supplier payments use persisted maker-checker
  approval. Customer receipts already support unapplied cash and permissioned write-off; supplier
  advances are not yet modelled.
- Phase 10 adds immutable bank/MFS statement imports, deterministic split-aware matching, approved
  create-GL journals, configurable fee rules, bank transfers and prepared/reviewed reconciliation
  sign-off. Bank/MFS statement layouts and fee rates are configuration, not universal assumptions;
  the business must configure each account's template mapping and fee evidence.
- Phase 11 adds company/branch-scoped trial balance, GL detail, profit or loss, balance sheet, direct
  cash flow, changes in equity, AR/AP ageing, stock valuation, VAT registers, draft VAT 9.1,
  VDS/TDS/challan register and journal listing. Export is blocked by failed control checks; CSV comes
  from the same server report, and XLSX/print are audited. Management accounts are labelled unaudited
  and the VAT draft is labelled not filed. Report definitions, statutory line labels and filing
  deadlines remain pending accountant/tax-counsel review.
- Payroll, the close checklist/sign-off, immutable audit-log viewer and controlled period reopen are
  Phase 12; Phase 5 only enforces `OPEN`/`CLOSED`/`LOCKED`. Those workspaces remain in the visibly
  labelled synthetic demo.
- Journal line `party_reference`/`party_name` remain descriptive text; the sales AR subledger now
  links invoices, receipts and allocations to the party master. `attachment_reference` stores an
  evidence reference only, not file content; there is no upload/storage adapter yet.
- Party opening items are an AR/AP schedule and are not posted to the GL. They must be included in the
  approved opening-balance batch. Sales AR allocation/ageing are implemented in Phase 7; AP
  allocation, supplier statements and the withholding liability queue are implemented in Phase 8.
  Treasury deposits, bank evidence references and draft withholding certificates are implemented in
  Phase 9. Certificates remain draft because the statutory format is not verified.
- The sales and purchase tax packs are still marked `PENDING_TAX_COUNSEL`. A company must record a
  named reviewer's approval for the exact server pack version before posting. The application does
  not claim that the rates, VDS/TDS treatments or Mushak serial presentation format are final;
  confirm all of them with qualified tax counsel.
- Phase 9 certificate records support `VDS` and `TDS` issued from supplier-payment withholding.
  AIT is not modelled because the rule pack does not provide a verified AIT rate/base in the purchase
  flow; adding it requires tax-counsel confirmation. Received certificates are not generated because
  the current customer-receipt model does not capture customer withholding. No certificate is marked
  issued, printed as final or filed; those require statutory-format approval and a later workflow.
- Treasury economic codes are operator-supplied and are never invented by the application. A
  liability must have a code before it can be deposited.
- Attachment and evidence fields are references only; there is no object storage, virus scan or
  download authorization yet. Statement import stores the normalised CSV source in PostgreSQL and the
  original XLSX is converted in the browser; binary file retention in object storage remains an
  external decision. Bank statement import does not consume live bank APIs.
- Stock valuation is per item/warehouse weighted average. There is no FIFO, batch/expiry, stock count
  document, reorder level or multi-line stock command yet. A stock command carries one item, and a
  transfer carries one source/destination pair. A stock item used on a purchase bill must point at an
  active ASSET account with the `INVENTORY` control subledger so the inventory GL proof remains
  meaningful.
- Negative stock is an explicit controller exception, not a supported normal workflow. A receipt that
  clears a negative balance at a different cost can leave a residual value requiring a stock
  adjustment; the control proof will still reconcile and show the position.
- The inventory control proof compares stock value with the inventory GL account. Manual journals to
  an inventory account appear as visible differences; they are never plugged.
- Journal group reversal is not applicable yet because Phase 5 journals are single manual journals or
  one opening batch. Document-group reversal arrives with the document families in later phases.
- Phase 4 configuration tables exist; they are not financial-history tables. `audit_events` is
  append-only by trigger, but a production deployment must also use a least-privilege application
  role that does not own the tables and cannot `TRUNCATE` or disable triggers.
- Production email delivery is not implemented. The `file` adapter is a development outbox, not a
  delivery mechanism. Configure and verify an SMTP/provider adapter before go-live.
- There is no breached-password service; the local policy blocks only obvious common choices.
- Rate-limit counters and expired sessions are not purged automatically yet; add retention jobs
  before high-volume production use.
- The password-reset/verification/invitation flows are tested with an in-memory adapter and a real
  PostgreSQL database, but not against a live mail provider.
- The server is stateless except for PostgreSQL state; no business state is kept in process memory.
- MFA, device naming, administrator session revocation across users, and SSO are later work.
