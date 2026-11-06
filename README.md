# Fintuity Accounting Suite — Bangladeshi Accounting and Business ERP

Fintuity Accounting Suite is a React/TypeScript accounting, VAT, treasury and business-management ERP for Bangladesh. It contains a substantial accounting domain (double-entry journals, audit chain, VAT/VDS/TDS rules, financial statements, imports and audit packs) and a Fastify/PostgreSQL backend with real authentication, server-side sessions, organisation/company membership, invitations, server-enforced permissions, Phase 4 company onboarding, the Phase 5 server-authoritative ledger, Phase 6 inventory, Phase 7 sales/receivables, Phase 8 purchases/payables, Phase 9 treasury/withholding certificates, Phase 10 banking/MFS reconciliation, Phase 11 management reports, draft VAT registers and financial statements, and Phase 12 controlled close, approvals, suspense resolution and an append-only audit log. It is **not yet a production accounting system**: payroll, statutory filing, production email and the remaining compliance decisions are still outstanding.

> **Data warning - do not enter real financial or personal data.** In server-backed mode the shell exposes company setup, the general ledger, master data/inventory, sales/receivables, purchases/payables, treasury/withholding certificates, banking/reconciliation, management reports, controlled close and the audit log. Payroll and the remaining statutory workspaces are still demo-only and are visibly labelled. The explicit demo mode (`VITE_DEMO_MODE=true`) loads synthetic browser data only; it never shares the real identity service or real books. Clearing browser data destroys demo data, not server books. No screen in this repository is certified for real financial records or statutory filing.

## Purpose

This repository is the working codebase for the productionisation programme described in:

- [`docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md`](docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md)
- [`docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md`](docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md)

The original product specification and workflow rules remain in [`SPEC.md`](SPEC.md) and [`WORKFLOW_BLUEPRINT.md`](WORKFLOW_BLUEPRINT.md). Where they disagree with the master plan, the master plan is authoritative.

## Stack

| Layer                     | Technology                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UI                        | React 18, TypeScript 5, Vite 5, Tailwind CSS 3                                                               |
| Domain                    | Pure TypeScript modules under `src/core` (bigint poisha, ledger, tax engine, IFRS statements, import/export) |
| Demo persistence          | Browser `localStorage` + IndexedDB snapshot, isolated behind `VITE_DEMO_MODE`                                |
| API                       | Node.js 22.18+, Fastify 5, Zod 4, Pino 10 (`server/`)                                                        |
| Database                  | PostgreSQL 16, `pg` pool, Drizzle ORM schema bindings, versioned SQL migrations                              |
| Identity                  | Argon2id, server-side sessions, HTTP-only cookies, CSRF, invitations and hashed one-time tokens              |
| Spreadsheet import/export | SheetJS (`xlsx`)                                                                                             |
| Unit tests                | Vitest 3 (frontend domain and server)                                                                        |
| Lint / format             | ESLint 10 + typescript-eslint 8, Prettier 3                                                                  |
| CI                        | GitHub Actions (`.github/workflows/ci.yml`)                                                                  |

## Prerequisites

- Node.js `^20.19.0`, `^22.13.0` or `>=24.0.0` for the frontend (required by ESLint 10)
- Node.js `>=22.18.0` for the server workspace and its TypeScript migration CLI
- npm 10+ (the repository uses lockfile version 3)
- Git
- PostgreSQL 16 for the API; Docker is optional

The verified local baseline used Node.js 24.7.0 and npm 11.5.1.

## Install

```bash
npm ci
```

Use `npm ci` for a reproducible install from `package-lock.json`. Use `npm install` only when intentionally changing dependencies, and commit the updated lockfile.

## Run locally

Server-backed mode (the default):

```bash
cp .env.example .env   # set DATABASE_URL and a local password
npm run migrate
npm run auth:bootstrap -- --email owner@example.test --name "Owner" --organisation "Example Organisation" --password "a-long-local-password"
npm run server:dev     # API on http://127.0.0.1:3000
npm run dev            # Vite on http://localhost:5173, proxying /api
```

The app opens at `/login`. Only a valid session with an active organisation/company membership can
enter `/app`. Phase 4 adds a server-backed company setup wizard at `/app/setup`; Phase 5 adds the
server-authoritative general ledger at `/app/ledger`; Phase 6 adds master data and inventory; Phase 7
adds sales, credit notes and receivables at `/app/sales`; Phase 8 adds supplier bills, expense
vouchers, payments and payables at `/app/purchases`; Phase 9 adds treasury challans, deposits and
withholding certificates at `/app/treasury`; Phase 10 adds statement import, matching, approved
create-GL journals, configurable fees, transfers and reconciliation at `/app/banking`; Phase 11 adds
selectable management accounts, registers, draft VAT schedules and drill-down at `/app/reports`;
Phase 12 adds controlled close and suspense resolution at `/app/close` and the append-only audit log
at `/app/audit`. Payroll and the remaining statutory decisions stay in the clearly labelled demo, and
the shell does not load demo data in server-backed mode. A company can also be created from the
organisation menu without deleting or resetting an existing company.

Isolated demo mode (synthetic data only):

```bash
VITE_DEMO_MODE=true npm run dev
```

Demo mode is visibly banner-labelled, uses a synthetic owner, and never calls the real identity API.
It is not a substitute for the server-backed application.

## Identity and access (Phase 3)

Phase 3 adds real authentication and server-enforced authorization:

- Argon2id password hashing, email verification, login, logout, forgot/reset password and change password;
- server-side session records with idle and absolute expiry, HTTP-only `SameSite=Lax` cookies and CSRF;
- organisations, company memberships, invitations, single-use hashed tokens and append-only audit events;
- an explicit role/permission matrix (Owner, Admin, Controller, Accountant, Operator, Auditor);
- server-side company membership enforcement on every company-scoped route, with cross-tenant responses
  using `404` to avoid confirming another tenant's identifiers;
- `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation/:token`, `/verify-email` and
  `/session-expired` routes, plus account/session and team/invitation screens.

Email delivery currently uses a development `file` outbox. A production SMTP/provider adapter is an
external go-live blocker recorded in the Phase 3 completion report.

## Company onboarding and configuration (Phase 4)

Phase 4 adds server-backed company setup:

- legal identity, entity type, industry, TIN/BIN/RJSC format checks (not statutory validation),
  address, contact, reporting framework, BDT base currency and Asia/Dhaka time zone;
- fiscal years and monthly periods with explicit `OPEN` status, overlap rejection and unknown-date
  rejection (`GET /api/v1/companies/:id/periods/resolve?date=...`);
- chart-of-accounts CRUD with hierarchy, IFRS category, control subledger, tax mapping, protected
  control accounts, per-company unique codes and atomic CSV/XLSX import validation;
- opening-balance batches with account/party/item/fixed-asset schedules, server-computed totals,
  evidence and a balanced-submit guard. A submitted batch is approved by a different user and posted
  once through the Phase 5 ledger service;
- bank/cash/MFS accounts with a `BANK_MFS` GL mapping, masked numbers and one principal account;
- company settings for language, approval thresholds, tax configuration and document numbering,
  with append-only audit events for setup changes;
- a resumable `/app/setup` wizard with server-persisted progress, plus a company switcher that loads
  the selected company without resetting another company.

## Server-authoritative ledger (Phase 5)

Phase 5 moves the ledger into PostgreSQL and adds a real-mode general ledger at `/app/ledger`:

- manual journals with date, narration, account lines, debit/credit, party-reference, cost-centre,
  project, memo and evidence reference; the server validates the configured period, active company
  accounts and exact poisha balance, and never trusts a client total;
- a `DRAFT -> SUBMITTED -> APPROVED -> POSTED` workflow with permission checks, maker-checker
  approval, idempotent posting and a database-enforced `POSTED -> REVERSED` transition;
- linked reversals that mirror every line, require a reason, preserve the original in history and
  reject a second reversal or a reversal of a reversal;
- one-time opening-balance approval and posting through the same posting service, with a permanent
  batch-to-journal link and duplicate-posting rejection;
- explicit period status enforcement (`OPEN`/`CLOSED`/`LOCKED`, unknown dates rejected) and audited
  status changes; the close checklist/sign-off remains Phase 12;
- an account-level trial balance with opening, period and closing columns and journal-line
  drill-down, derived only from posted journals and linked reversals;
- read-only auditor enforcement at the API, append-only audit events and tenant-scoped composite
  foreign keys throughout the ledger;
- journal numbers allocated transactionally from the existing per-company/fiscal-year `JOURNAL`
  sequence (for example `JE-2026-11-0001`) and never reused.

The Phase 5 migration is `server/migrations/0004_ledger.up.sql`. Its down migration aborts if any
journal exists, because destroying posted financial history is not a safe rollback.

## Master data and inventory (Phase 6)

Phase 6 adds real-mode master data at `/app/masters` and the inventory subledger at `/app/inventory`:

- company-scoped parties with code, bilingual names, customer/supplier type, BIN/TIN format checks,
  address, contact, credit days/limit, withholding-buyer and government flags; deactivation replaces
  deletion and is audited with a reason;
- item masters with SKU, HS code, unit, four-decimal quantity precision, stock/non-stock flag,
  default tax category and validated inventory/expense accounts from the company COA. A stock item
  with movements cannot have its stock accounts or stock flag changed;
- branches and warehouses with optional branch mapping; only one active principal branch is allowed;
- an immutable stock subledger for opening stock, GRN receipt, issue/COGS, return, transfer,
  adjustment and linked reversal. Every movement carries a source, actor, timestamp, integer-poisha
  value and the resulting quantity/value balance;
- weighted-average valuation per item and warehouse with deterministic half-up rounding to poisha.
  Transfer value follows the source warehouse cost and posts no GL journal by itself;
- negative stock blocked by default. A controller with `OVERRIDE_NEGATIVE_STOCK` may approve a
  specific command with a mandatory reason; the override is stored on the movement and audited;
- server-derived inventory control proof by inventory account, with per-item/warehouse valuation and
  visible differences. Differences are never plugged; a manual GL entry to an inventory account shows
  as an exception until resolved;
- party opening items for AR/AP schedules. They are not posted to the GL by this command; they must be
  included in the approved opening-balance batch;
- real-mode master and inventory screens with search, pagination, validation, deactivation reasons
  and audit-ready detail. The old `MasterDataModal` remains demo-only.

The Phase 6 migration is `server/migrations/0005_master_data_inventory.up.sql`. Its down migration
aborts if any stock movement or party opening item exists.

## Sales, credit notes and receivables (Phase 7)

Phase 7 adds a server-backed order-to-cash flow at `/app/sales`:

- server-persisted sales invoice and credit-note drafts with customer, branch, dates, due date,
  payment terms, narration, attachment reference and line-level item/description/quantity/unit
  price/discount/tax category/revenue account/warehouse;
- line-level VAT calculated by the server from a generated snapshot of the existing rule pack; the
  browser only previews. Posting stores the tax decision, rule-pack version, trace ID and line-level
  VAT evidence;
- posting is one transaction: document number, internal Mushak 6.3 serial, AR open item, output VAT,
  revenue, stock issue, COGS/inventory and audit. It never auto-settles;
- credit notes are separate documents with their own `CN-` number and `M67` serial series, a mandatory
  original-invoice link, reason, quantity/value limits against the original lines, original-cost stock
  restoration and optional controller approval above the configured threshold;
- customer receipts are separate documents with bank/cash/MFS GL account, date, reference, partial
  and multiple invoice allocations, permissioned write-off, unapplied cash and later allocation;
- derived AR ageing with due-date buckets, unapplied customer credits, customer statements and an
  AR control-account proof. Outstanding is derived from posted documents and allocations, never a
  mutable settled flag;
- document timeline, append-only audit events and linked document-level reversal. Posted documents
  and lines are immutable at the database; a second reversal is rejected;
- credit notes and invoices cannot fabricate customer tax evidence. The pack is still marked
  `PENDING_TAX_COUNSEL`, so posting is blocked until a named reviewer records approval for the exact
  server pack version and output VAT account in the Tax policy screen.

The Phase 7 migration is `server/migrations/0006_sales_receivables.up.sql`. Its down migration
aborts if any sales document or receipt exists.

## Purchases, bills and payables (Phase 8)

Phase 8 adds a server-backed procure-to-pay flow at `/app/purchases`:

- server-persisted supplier bill and expense-voucher drafts with supplier, branch, accounting and
  supplier-invoice dates, due date, payment terms, narration, attachment reference, payment method
  and line-level item/description/quantity/unit price/discount/tax category/expense-or-inventory
  account/warehouse;
- line-level VAT from the generated purchase rule-pack snapshot, including input-credit eligibility.
  Missing supplier BIN or a missing user-supplied Mushak 6.3 serial disallows input VAT and
  capitalises it into inventory/expense cost; the system never invents a supplier serial;
- supplier e-TIN and BIN snapshots on the document, an explicit missing-e-TIN fact, VDS applicability
  and TDS nature. A missing/invalid e-TIN upscales TDS by 50% in the posted document and in the
  actual payment; reverse-charge VAT is self-assessed and posted to a payable;
- posting is one transaction: document number, AP open item, inventory receipt or expense,
  claimable/disallowed VAT, reverse-charge liability, tax evidence, audit and any stock movement.
  Stock moves only for stock lines on a posted bill; a separate GRN/PO and three-way match are not
  implemented and are not shown in the real UI;
- supplier payments are separate documents that allocate to one or more posted bills, support
  partial payments, compute VDS/TDS from the actual allocation, create pending withholding
  liabilities, and post Dr AP / Cr bank / Cr VDS payable / Cr TDS payable atomically;
- derived AP ageing, supplier statements, an AP control proof and a VDS/TDS/reverse-charge liability
  queue with control proof;
- document-level reversal with linked journal and stock reversal, duplicate/paid-document guards,
  append-only audit events and server-enforced permissions. A second reversal is rejected.

The Phase 8 migration is `server/migrations/0007_purchases_payables.up.sql`. Its down migration
aborts if any purchase document or payment exists and removes the Phase 8 purchase-policy setting
before restoring the previous company-settings constraint.

## Treasury, deposits and withholding certificates (Phase 9)

Phase 9 adds a server-backed treasury flow at `/app/treasury`:

- a persisted withholding liability register for VDS, TDS and reverse-charge VAT created only from
  actual supplier payments or reverse-charge bills, with party, period, source document, base, rate,
  amount and an operator-supplied Treasury economic code;
- a persisted treasury challan batch that selects one or more PENDING liabilities, records the
  bank/cash account, branch, deposit reference and evidence reference, and posts
  Dr each liability control account / Cr bank in one transaction. The liabilities are locked and
  marked `DEPOSITED` in the same transaction; a second deposit of the same liability is rejected;
- draft withholding certificates created from each deposited VDS/TDS liability. The certificate
  base and tax are copied exactly from the source liability, never multiplied by an arbitrary
  factor. Every certificate is labelled `DRAFT — statutory format not verified`; there is no
  Issue, Print-as-final or Filed action;
- certificate cancellation and reissue with a reason and audit event; the original certificate
  remains in the register as `CANCELLED`;
- deposit reversal with a linked journal reversal, restoration of the liabilities to `PENDING` and
  cancellation of the linked draft certificates. A second reversal is rejected;
- a treasury control proof comparing PENDING liabilities with the VDS/TDS/reverse-charge control
  accounts, plus a challan-register proof and certificate counts;
- high-value supplier payments use a persisted maker-checker request. At or above the company
  payment threshold, the payment does not post; a different controller or administrator must
  approve it. The requester cannot approve their own payment, and the approval revalidates the
  original allocation, withholding, period and open items before posting;
- attachment references on customer receipts and supplier payments. These are evidence references,
  not uploaded files.

The Phase 9 migration is `server/migrations/0008_treasury_certificates.up.sql`. Its down migration
aborts if any treasury challan, certificate or payment approval request exists.

## Banking, MFS and reconciliation (Phase 10)

Phase 10 adds a server-backed banking control at `/app/banking` (and W06 opens the same page in
server-backed mode):

- bank/cash/MFS account setup remains in `/app/setup`. Each account is mapped to an active `ASSET`
  account with the `BANK_MFS` control subledger. The account stores only a masked number. Deactivation
  is refused while the account is referenced by a receipt, payment, treasury challan, imported
  statement, transfer or reconciliation;
- a documented CSV template (`date,description,reference,debit,credit,balance`) with header mapping
  and an XLSX path converted to CSV in the browser. `debit` means money in; `credit` means money out;
  `balance` is optional. Import previews validation, invalid rows, in-file duplicates and duplicates
  already stored for the account. The source content and SHA-256 are retained, the import batch is
  immutable and **no journal, match or fee is posted by import**;
- immutable statement lines with date, description, reference, debit/credit, optional running
  balance, status, match score/reason, matched journal and exception owner;
- deterministic candidate scoring from amount availability, date window, reference and party, with
  an explicit explanation. Fully allocated journal lines are excluded. A journal line cannot be
  reused for another statement line without an explicit `SPLIT` allocation. Partial and split
  matches are supported; over-allocation is rejected by the service and by database triggers;
- create-GL from an unexplained line: choose a real account/party, optional included tax and a
  reason. Equity (including retained earnings) is rejected. A draft `BANK_RECONCILIATION` journal
  is created, submitted and approved by a different user, then posted and matched atomically. A
  manual match is blocked while that request is open;
- configurable fee rules per account (rate in basis points, fixed fee, expense account, effective
  dates and policy/contract evidence). No 1.5% or other universal rate is seeded. A fee journal is
  posted once per statement line; a second posting is rejected. A linked journal reversal marks the
  fee posting `REVERSED` and permits one replacement fee posting. A manual amount override requires
  a reason and evidence, and the account is never guessed;
- bank transfers between two active accounts, numbered from the `BANK_TRANSFER` sequence and posted
  as one balanced journal with idempotency and audit. Reversal creates a linked reversing journal and
  refuses a second reversal. Reversing any matched journal, fee journal, create-GL journal or transfer
  journal updates the linked banking records and unmatches the statement line in the same transaction;
- reconciliation by account and accounting period with statement/GL closing balances (or movement
  when no closing balance is supplied), counts, explicit difference, blockers and history. The
  preparer and reviewer must be different users; review requires approval permission. A prepared
  reconciliation is invalidated by a new import, and closing or locking the period locks the
  reconciliation and writes a system audit event;
- a permissioned, audited CSV reconciliation report.

The Phase 10 migration is `server/migrations/0009_banking_reconciliation.up.sql`. Its down migration
refuses to run while any imported statement, match, fee, transfer, GL request or reconciliation exists.
Live bank/MFS APIs are not implemented; formats and fee rates remain configurable business decisions.

## Reports, VAT registers and financial statements (Phase 11)

Phase 11 adds a server report layer and a production screen at `/app/reports`:

- trial balance, general-ledger detail, profit or loss (month/quarter/YTD/fiscal year/custom range),
  balance sheet (as-of date), direct-method cash flow, changes in equity, AR/AP ageing, stock
  valuation, VAT sales/purchase registers, an internal draft VAT 9.1, a VDS/TDS/challan register and
  a journal listing;
- explicit company and branch scope, selectable accounting period and comparative period, exact
  period labels ("for the month ended…", "for the period…", "as at…") and no fixed October window;
- statement totals are derived only from posted journals (`POSTED` plus linked `REVERSED` history).
  Trial balance, balance-sheet and cash-flow checks are returned with the report and block export
  when they fail. The cash-flow statement has no plug; an unclassified cash movement is shown as an
  exception;
- VAT registers exclude reversed documents, include credit notes as negative lines and retain
  line-level mixed-rate evidence. The VAT 9.1 draft shows its GL proof, differences and exceptions,
  carries a `DRAFT — NOT FILED` status and never generates a filing acknowledgement or government
  receipt. The template and line labels are marked as pending tax-counsel review;
- every statement line drills to the account, its posted journals, the source document/tax decision
  and the journal audit trail. Reversed, manual and imported journals keep their evidence and links;
- CSV export is generated by the same server report used on screen; XLSX is built from that CSV;
  A4 print/Save-as-PDF uses the same report object. Exports are permissioned (`EXPORT_DATA`) and
  audited. The UI labels management accounts **“Management accounts — unaudited”** and contains no
  fabricated independent auditor’s report or “audited” claim;
- journal-scoped branch attribution is additive (`journals.branch_id`). Existing journals remain
  valid and are reported as Unassigned; they are never silently attributed to the principal branch.

The Phase 11 migration is `server/migrations/0010_reporting_branch_scope.up.sql`. Its down migration
refuses to drop branch attribution while any journal carries it. Report definitions and statutory
line labels require accountant/tax-counsel sign-off before they can be treated as filing-ready.

## Close, approvals, controls and audit log (Phase 12)

Phase 12 adds a production close workspace at `/app/close` and an audit viewer at `/app/audit`:

- a persisted close run records the accounting period, checklist results, exceptions, evidence
  reference/note, maker, submitter, checker, timestamps and a SHA-256 snapshot hash. A close run
  cannot be submitted or approved while a blocking control fails;
- the checklist covers only implemented controls: trial balance, balance sheet/ledger proof, AR and
  AP control proofs (not applicable when no control account exists), bank/MFS reconciliation
  (not applicable when no statement was imported), VAT GL proof when VAT activity exists, and the
  suspense control. Payroll, depreciation and other unimplemented modules are deliberately absent;
- the maker submits; a different authorised checker approves and the period becomes `LOCKED`.
  Self-approval is rejected on the server. Normal postings are rejected in `CLOSED` and `LOCKED`
  periods, and a missing period is still rejected;
- reopening a closed/locked period requires the separate `REOPEN_PERIOD` permission, a reason and
  an audit event. The approved close run remains in history as `REOPENED`; a new run is required
  before the period can lock again;
- high-value approval thresholds apply to sales invoices, credit notes, purchase bills, supplier
  payments, manual journals and reversals. The creator cannot approve or reverse their own
  high-value item;
- suspense is a normal chart-of-accounts account tagged with the `SUSPENSE` control subledger. A
  resolution requires the source line, a named target account, a reason, an attachment/evidence
  reference and a different checker. Approval posts a linked balanced journal; there is no
  one-click retained-earnings write-off;
- the audit log is append-only at the database level and queryable by company, date, action, entity,
  actor and free text. CSV export requires `EXPORT_DATA` and is itself audited. The viewer includes
  company activity and organisation-level identity events for users with access to the company;
- the close pack CSV contains the persisted checklist, exceptions, evidence, maker/checker history
  and run events. It is an internal evidence artefact, not an audit opinion.

The Phase 12 migration is `server/migrations/0011_close_approvals_audit.up.sql`. Its down migration
refuses to run while any close run, suspense resolution or suspense journal exists.

## Public site, auth surfaces and Quiet Ledger design system (Phase 13)

Phase 13 adds a public marketing site and the forward design system:

- `/` is a public landing page for the honest server-backed release. It loads a separate lazy entry;
  a visitor does not download the financial workspaces, providers or ledger engine. The built
  landing entry is roughly 85 KB gzipped including React, routing, content and fonts metadata. Auth
  routes load a roughly 54 KB gzip auth entry; the authenticated shell is a separate roughly 638 KB
  gzip chunk loaded only after sign-in;
- the sections cover the problem, implemented workflows, capabilities, Bangladesh fit, controls,
  audience, onboarding, sales-led contact, FAQ and the legal/statutory limitations. There are no
  invented customer logos, testimonials, certifications, audit opinions or prices;
- real screenshots from the server-backed sales and reporting flows are included with synthetic test
  data and explicit captions. The workspace visual refresh remains Phase 14;
- `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation/:token`, `/verify-email` and
  `/session-expired` use the Quiet Ledger tokens. They remain real Phase 3 server flows and are
  `noindex,nofollow`;
- `/design` is an internal, noindex component gallery for tokens, typography, buttons, forms, badges,
  alerts, tables, dialog, and loading/empty/error/permission states. It is not linked publicly;
- `POST /api/v1/public/demo-requests` stores a rate-limited walkthrough request in `demo_requests`.
  The public API is write-only; there is no public read. The server stores the contact details and
  never logs them. Production email notification/CRM handling remains an operational decision;
- Inter and Noto Sans Bengali are self-hosted under `public/fonts` (SIL OFL 1.1). No external font
  stylesheet is requested. The English page uses “Bangla” and “BDT” so the 107 KB Bengali font is
  not downloaded for a single glyph;
- the production landing build measured Lighthouse 0.99 performance / 1.00 accessibility / 1.00 best
  practices / 1.00 SEO locally, with LCP 2.0s; the production login measured 0.98 performance /
  1.00 accessibility with LCP 2.3s. Re-measure on the real host/CDN.

The design contract is documented in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). Production
builds must set `VITE_PUBLIC_SITE_URL` to the canonical HTTPS origin for canonical/Open Graph links.
The migration is `server/migrations/0012_public_demo_requests.up.sql`; its down migration refuses to
run while a demo request exists.

## Application shell, dashboard and workflow UX (Phase 14)

Phase 14 moves the authenticated operating screens onto the Quiet Ledger language and makes the
server-backed work queue the first screen:

- role-aware navigation with grouped sections, a persistent desktop rail, a mobile drawer and an
  explicit company context. The sidebar also stores a **default branch for new documents**; it never
  limits what the user may see and is clearly labelled as a prefill, not an authorisation scope;
- a command palette (`Ctrl/Cmd+K`) that searches invoices, credit notes, bills, parties, items,
  accounts and journals within the selected company and permission scope, and exposes only
  permitted actions. Account results open the chart-of-accounts step with the code prefilled;
- a Home dashboard with at most four KPIs (cash, overdue AR, overdue AP, net VAT payable), a
  server-derived “Needs attention” queue (drafts, approvals, close blockers, unmatched bank lines,
  suspense, control-proof differences and VAT exceptions), permission-filtered quick actions and
  close readiness. Missing figures render as “Not available” rather than a false zero;
- shared page headers, breadcrumbs and document deep links. Explicit aliases such as
  `/app/sales/new`, `/app/sales/invoices/:id`, `/app/purchases/bills/:id` and
  `/app/ledger/journals/:id` normalise to the query-driven screens; unknown paths still return a
  localised 404 and cross-role access returns a 403;
- sales and purchase drafts autosave to the server after the required fields are complete, with a
  visible save state, retry action, validation summary, field-level errors and an unsaved-change
  guard. The browser never supplies an authoritative total, tax amount or posting status;
- server-paginated sales and purchase tables with filters, local saved views, column choice and
  consistent loading, empty, error and permission states. Saved views and column choices contain
  display preferences only;
- a scoped `.ql-theme` bridge replaces the legacy gradients, glass, tiny uppercase labels and
  20px card radii in production while leaving the isolated demo shell unchanged. Working text is
  at least 12px, statuses are text plus colour, and dark/high-contrast modes use the same semantic
  tokens;
- the demo-only payroll, secretarial, practice-cockpit and fake pipeline screens are not imported by
  the production shell. They remain reachable only through the explicit `VITE_DEMO_MODE=true`
  synthetic demo.

The route-level lazy loading now produces a small `ErpShell` entry and separate page chunks; the
XLSX engine remains a lazy chunk. Phase 14 does not add a migration.

Localization status: the shell, navigation, dashboard, route states, page headers and the exposed
sales/purchase list and form controls have complete English/Bangla copy. Several deep panels
(banking exception workbench, some purchase sub-ledgers, setup step bodies and report internals)
still contain English-only labels from earlier phases; this is recorded as a limitation, not
described as complete. The key-dictionary migration and native accountant review remain release
gates. See [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md).

## Hardening and release readiness (Phase 15)

Phase 15 adds machine-verifiable release gates without declaring the product production-ready:

- a production Content-Security-Policy is injected at build time and pins the theme/JSON-LD inline
  scripts by SHA-256; `npm run check:built-security` re-hashes the built HTML and verifies headers,
  referrer policy and the absence of external font/script origins;
- `npm run check:secrets` scans tracked files for private keys and provider tokens;
- `npm run check:bundle` enforces gzip budgets for the entry, auth, shell, page, CSS, lazy XLSX and
  isolated demo chunks;
- `npm run drill:backup-restore` creates disposable PostgreSQL databases, applies all migrations, takes
  a custom-format `pg_dump`, restores into a second database and compares the migration ledger, table
  list and every table row count. It requires matching PostgreSQL client/server major versions and
  refuses to run with `NODE_ENV=production`;
- new deterministic property tests cover money parsing/formatting, basis-point rounding and generated
  balanced journals; localization tests enforce dictionary parity, placeholders and lakh/crore/date
  formatting;
- browser file imports now reject files over 1 MB and worksheets over 5,000 rows, and the audit-log
  text floor is 12px;
- operations, security, release, support, admin, accountant and UAT documents are in
  [`docs/OPERATIONS.md`](docs/OPERATIONS.md), [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md),
  [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md), [`docs/SUPPORT_PLAYBOOK.md`](docs/SUPPORT_PLAYBOOK.md),
  [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md), [`docs/ACCOUNTANT_GUIDE.md`](docs/ACCOUNTANT_GUIDE.md)
  and [`docs/UAT_PLAN.md`](docs/UAT_PLAN.md).

**Release status: NO-GO.** The high `xlsx@0.18.5` advisory has no npm fix, production email delivery
is not configured, native accountant/tax-counsel UAT has not occurred, staging/rollback/monitoring are
not configured, some deep-panel localization is incomplete and no human release sign-off exists. See
[`docs/PHASE_15_REPORT.md`](docs/PHASE_15_REPORT.md) and the release checklist.

## Quick start with Docker Compose:

```bash
cp .env.example .env   # replace the placeholder password
docker compose up --build
curl http://127.0.0.1:3000/health
```

Full setup, environment, migration, rollback and reset instructions are in
[`server/README.md`](server/README.md). Integration tests need `TEST_DATABASE_URL` and create
disposable databases; they skip rather than pretend to pass when no database is configured.

## Build and preview

```bash
npm run build
npm run preview
```

`npm run build` runs the application typecheck and then creates a production bundle in `dist/`.

## Quality commands

| Command                        | What it does                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `npm run typecheck`            | Typechecks the application, `tests/` and the server workspace                                       |
| `npm run typecheck:app`        | Typechecks only the React application and frontend tests                                            |
| `npm run typecheck:server`     | Typechecks only the server workspace                                                                |
| `npm run lint`                 | Runs ESLint over the repository (0 errors required; existing warnings are recorded in the baseline) |
| `npm run format:check`         | Checks Prettier formatting for tests, tooling, server, CI and documentation                         |
| `npm run format`               | Writes Prettier formatting for the same scoped set                                                  |
| `npm test`                     | Runs the frontend Vitest suite once                                                                 |
| `npm run test:watch`           | Runs frontend Vitest in watch mode                                                                  |
| `npm run test:server`          | Runs server unit and integration tests (integration skips without a database)                       |
| `npm run selfcheck`            | Runs the existing domain self-checks (core ledger, actions, import, gate) through esbuild           |
| `npm run selfcheck:render`     | Runs the legacy server-render smoke script (known stale; see the baseline)                          |
| `npm run check:secrets`        | Scans tracked files for high-confidence secrets                                                     |
| `npm run check:bundle`         | Enforces gzip bundle budgets on `dist/` after a build                                               |
| `npm run check:built-security` | Verifies the built CSP hashes, referrer policy and external-origin absence                          |
| `npm run drill:backup-restore` | Creates disposable databases and proves a `pg_dump`/`pg_restore` round trip                         |
| `npm run build`                | Typechecks and builds the frontend production bundle                                                |
| `npm run build:server`         | Compiles the server to `server/dist`                                                                |

`npm run format:check` currently excludes the existing `src/`, `scripts/` and legacy root configuration from formatting. Reformatting them would create a large unrelated diff; a dedicated formatting-only change should widen the gate later. ESLint still analyses all application and script source.

## Existing domain self-checks

The original self-check scripts are preserved unchanged and are now runnable through npm:

- `npm run selfcheck:core` — seed ledger balance, audit chain, subledger reconciliation and financial statements.
- `npm run selfcheck:actions` — serial allocation, sale/purchase journals, reversal, locked periods, unbalanced journals, unknown accounts and idempotency.
- `npm run selfcheck:import` — import dry runs, commit safety and audit-pack export.
- `npm run selfcheck:gate` — consolidated engine gate, including all 25 golden tax vectors.

These scripts are bundled with the esbuild binary already supplied by Vite; they are not part of the application bundle. Generated `.xlsx` audit packs are written under `scripts/` and are git-ignored.

The older `scripts/smoke-render.ts` uses obsolete workspace keys (`cockpit`, `ledger`, …) instead of the current `W01`–`W12` keys, so it fails against the current UI. It is retained for history and labelled in the baseline. The maintained render smoke test is `tests/render-smoke.test.ts`.

## Environment

The React application reads `VITE_DEMO_MODE` (default `false`) and `VITE_API_BASE_URL` (default
`/api/v1`). The API reads the variables documented in [`server/README.md`](server/README.md).
`.env.example` contains non-secret placeholders; copy it to `.env` for local work. `.env`, local
PostgreSQL data, mail outboxes and dumps are git-ignored. Never commit a secret or production
connection string.

Fonts are self-hosted from `public/fonts` (Inter and Noto Sans Bengali, SIL OFL 1.1). Offline use falls back to locally available fonts; no external font stylesheet is requested.

## Demo data, persistence and data safety

- Server-backed mode never loads a browser ledger or demo snapshot. It persists display preferences only and exposes the PostgreSQL-backed company setup, general ledger, master data/inventory, sales/receivables, purchases/payables, treasury/certificates, banking/reconciliation, management reports, controlled close and audit log. Payroll, secretarial and the synthetic practice cockpit remain demo-only.
- `VITE_DEMO_MODE=true` loads and persists the APEX seed dataset, visibly labelled as synthetic. Demo personas and synthetic parties are defined in `src/core/ledger/seedData.ts`.
- In demo mode the complete vault snapshot is written to `localStorage` under `ledgervault.v2.vault` and mirrored to IndexedDB database `ledgervault.vaultdb`. The `.vault.json` export/import path is demo-only and is not an accounting-grade backup.
- A production deployment must leave `VITE_DEMO_MODE=false`. Demo data must never be restored into a real company.
- Generated audit packs, vault exports and build output are excluded from Git. Never commit real customer or financial data.

## Repository layout

```text
src/
  core/                 Pure domain: money, types, ledger, tax engine, IFRS, import/export, storage
  auth/                 Auth context, API client, roles, guards
  context/              VaultProvider and prototype actions
  ledger/               Typed client for the server ledger API
  components/           Shell, commercial and signature UI
  pages/                Auth, account/team, setup, ledger, master-data, inventory, sales, purchases, treasury, banking and reports pages
  workspaces/           W01–W12 demo workspace views and registry
server/                 Fastify API, PostgreSQL pool, Drizzle schema and SQL migrations
scripts/                Legacy domain self-checks and render smoke script
tests/                  Vitest smoke, golden-suite, seed-ledger and render tests
docs/                   Master audit/plan, phase prompts, baseline and implementation notes
docker-compose.yml      Local PostgreSQL, migration job and API
.github/workflows/      GitHub Actions CI
```

## Baseline and phase records

- [`docs/BASELINE.md`](docs/BASELINE.md) records the exact pre-change build, self-check, golden-suite, test and audit results, including the known legacy render-smoke failure.
- [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md) is the template for phase completion reports.
- `build.log` is a historical local artifact from an earlier build and is intentionally git-ignored; it is not the current baseline.

## License and ownership

**License status: undecided.** No open-source or commercial licence is granted by this repository. The human owner must confirm copyright ownership, the licence and distribution terms before sharing or deploying the code. Do not assume this project is open source.

## Current limitations

Phase 3 adds real identity, sessions, organisation/company membership, invitations and server-side
authorization. Phase 4 adds server-backed company onboarding, periods and the chart of accounts.
Phase 5 adds the server-authoritative general ledger, linked reversals, opening-balance
approval/posting, period status enforcement and an account-level trial balance. Phase 6 adds
company-scoped parties, items, branches/warehouses, the immutable stock subledger, weighted-average
valuation, negative-stock control, linked stock reversals and inventory-to-GL control proof. Phase 7
adds sales drafts, invoice posting, line-level VAT evidence, 6.7-style credit notes, customer receipts
and allocations, AR ageing/statements and an AR control proof. Phase 8 adds supplier bills, expense
vouchers, line-level input VAT and inventory/expense classification, AP allocations, partial supplier
payments, VDS/TDS/reverse-charge liability queues, AP ageing/statements and linked reversals. Phase
9 adds persisted treasury challans, atomic withholding deposits, draft certificates derived from the
source liability, deposit/certificate correction and treasury control proofs. Phase 10 adds retained
statement imports, unique/explained matching with split allocations, approved create-GL journals,
configurable one-time fees, bank transfers, and prepared/reviewed reconciliation sign-off that locks
with the period. Phase 11 adds company/branch-scoped management accounts and registers, draft VAT 9.1
with GL proof and export blocking, drill-down to source/audit evidence, and parity-checked CSV/XLSX/A4
output. Phase 12 adds persisted close runs with maker-checker evidence, locked-period enforcement,
permissioned reopen, high-value document/journal/payment/reversal approvals, evidence-backed suspense
resolution, an append-only audit log viewer/export and a close-pack export. Payroll, statutory filing,
purchase orders/GRN/three-way matching and the remaining compliance decisions remain unavailable
until their phases. Production email delivery is not configured; the current adapter
writes to a git-ignored local outbox for development and tests. The tax rule pack is still pending
professional sign-off; sales and purchase posting require a recorded reviewer approval for the exact
pack version. The demo remains synthetic and isolated. See the master plan for the full gap list and
phase order.
