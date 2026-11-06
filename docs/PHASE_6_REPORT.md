# Phase 6 — Master data and inventory

**Status:** COMPLETE

**Completed:** 06 November 2026

## Summary

Phase 6 adds company-scoped master data and an immutable inventory subledger:

- **Parties** — code, bilingual names, customer/supplier type, BIN/TIN format checks, address,
  contact, credit days, credit limit, withholding-buyer and government flags, active status. Codes
  are normalised and unique per company. A party is deactivated, never deleted; deactivation requires
  a reason and is refused while an opening item is still open.
- **Party opening items** — an AR/AP schedule with document type/number, due date, gross and base
  amounts. These are deliberately not posted to the GL by this command; they must be included in the
  approved opening-balance batch. Cancel is a reasoned, audited status change.
- **Items** — SKU, HS code, bilingual names, unit, stock/non-stock flag, default tax category and
  validated inventory/expense accounts from the company COA. Quantities use `NUMERIC(18,4)`:
  four decimal places are accepted and stored as ten-thousandths. Once an item has stock movements,
  its unit, stock/expense accounts and stock-item flag are locked because changing them would
  reinterpret or reclassify existing quantities and values.
- **Branches and warehouses** — branch code/name/BIN/address, one active principal branch, and
  warehouses optionally mapped to a branch. Warehouses and items with non-zero stock cannot be
  deactivated.
- **Stock service** — opening stock, GRN receipt, issue/COGS, sales return, warehouse transfer,
  adjustment increase/decrease and linked reversal. Each command is one item, atomic, company-scoped
  and idempotent via a required `Idempotency-Key`. Stock movements are append-only and carry source,
  actor, timestamp, integer-poisha value and the resulting quantity/value balance.
- **Weighted-average valuation** — per item and warehouse with deterministic half-up rounding to
  poisha. A movement that empties a balance takes the whole remaining value so rounding cannot leave
  an orphan poisha. Transfers move source value to the destination and post no GL journal by
  themselves.
- **Negative stock** — blocked by default. `OVERRIDE_NEGATIVE_STOCK` (owner/admin/controller) plus a
  mandatory reason allows a specific command to go negative; the override and reason are stored on the
  movement and audited. Accountants and operators cannot override.
- **Inventory-to-GL proof** — server-derived stock value by inventory account compared with posted GL
  balances, plus item/warehouse valuation. Differences are returned explicitly and shown in the UI;
  nothing is plugged. A manual journal to an inventory account appears as a visible difference.
- **Audit** — every master create/update/deactivate/reactivate, opening-item create/cancel and stock
  command/reversal writes before/after context, actor, session, request and reason where required.
- **Real-mode UI** — `/app/masters` has searchable, paginated party, item, warehouse and branch
  screens with validation and reasoned deactivation. `/app/inventory` has stock ledger, valuation,
  control proof and a movement form. The old `MasterDataModal` remains demo-only.

The browser smoke test found and fixed one real UI defect: the control-proof and valuation screens
tried to pass four-decimal quantity strings to `BigInt`. Quantity comparison now uses an explicit
decimal-string helper; money values remain `BigInt` poisha.

## Files changed

### Database and server

- `server/migrations/0005_master_data_inventory.up.sql` — branches, parties, party opening items,
  warehouses, items, immutable stock movements, stock balances, constraints, composite tenant FKs,
  indexes, append-only trigger and the `INVENTORY` journal source module.
- `server/migrations/0005_master_data_inventory.down.sql` — development/test rollback; aborts if any
  stock movement or party opening item exists.
- `server/src/db/schema.ts` — Drizzle bindings for the new tables.
- `server/src/master/constants.ts` — party/opening/movement vocabularies, code/BIN/TIN normalisation.
- `server/src/master/partyService.ts` — party and party-opening-item CRUD, validation, deactivation,
  reactivation and audit.
- `server/src/master/itemService.ts` — item CRUD, account validation, stock-history locking and audit.
- `server/src/master/warehouseService.ts` — branch and warehouse CRUD, principal guard, stock-aware
  deactivation and audit.
- `server/src/inventory/quantity.ts` — four-decimal parsing/formatting and deterministic valuation
  arithmetic.
- `server/src/inventory/inventoryService.ts` — stock commands, weighted average, negative-stock
  control, transfer, reversal, ledger/valuation queries and inventory control proof.
- `server/src/routes/masters.ts` — company-scoped master data and opening-item APIs.
- `server/src/routes/inventory.ts` — stock command, reversal, ledger, balance and proof APIs.
- `server/src/ledger/ledgerService.ts` — shared system-journal posting and transaction-scoped journal
  reversal so inventory uses the Phase 5 posting invariants.
- `server/src/ledger/constants.ts` — `INVENTORY` source module.
- `server/src/auth/permissions.ts` — `OVERRIDE_NEGATIVE_STOCK` for owner/admin/controller.
- `server/src/app.ts` — registers the master-data and inventory routes.
- `server/tests/unit/inventoryQuantity.test.ts` — quantity precision and valuation unit tests.
- `server/tests/integration/inventory.test.ts` — Phase 6 integration suite.
- `server/tests/integration/migrations.test.ts` — includes migration 0005 apply/rollback/reapply.

### Frontend

- `src/masters/api.ts` — typed master-data client.
- `src/inventory/api.ts` — typed stock/valuation/proof client.
- `src/pages/masters/MasterDataPage.tsx` — real-mode master-data shell.
- `src/pages/masters/PartyPanel.tsx` — party list/form, opening items and deactivation.
- `src/pages/masters/ItemPanel.tsx` — item list/form with COA account selection.
- `src/pages/masters/LocationPanels.tsx` — warehouse and branch panels.
- `src/pages/inventory/InventoryPage.tsx` — inventory shell and tab state.
- `src/pages/inventory/MovementFormPanel.tsx` — minimal test UI for stock commands.
- `src/pages/inventory/StockLedgerPanel.tsx` — stock ledger, filters and reversal.
- `src/pages/inventory/ValuationPanel.tsx` — item/warehouse valuation.
- `src/pages/inventory/ControlProofPanel.tsx` — inventory-to-GL proof and visible differences.
- `src/pages/inventory/inventoryUi.tsx` — movement labels and decimal-quantity helper.
- `src/App.tsx` — `/app/masters` and `/app/inventory` routes and Phase 6 footer.
- `src/components/layout/Sidebar.tsx` — real-mode links to master data and inventory.
- `src/components/layout/TopBar.tsx` — real-mode master-data quick action.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 6 context and links.
- `src/pages/setup/CompanySetupPage.tsx` — opening-batch wording no longer calls Phase 5 pending.
- `src/pages/setup/CompanySettingsStep.tsx` — posting-service wording.
- `src/auth/types.ts`, `src/auth/api.ts`, `src/auth/roles.ts`, `src/core/types.ts`,
  `src/context/VaultContext.tsx`, `src/ledger/api.ts` — mirror the new permission, source module and
  real-mode navigation.

### Documentation

- `README.md` — Phase 6 capabilities and limitations.
- `server/README.md` — Phase 6 API summary, policy and limitations.
- `docs/IMPLEMENTATION_NOTES.md` — Phase 6 record index entry.
- `docs/PHASE_6_REPORT.md` — this report.

## Database/migrations

`0005_master_data_inventory`:

- extends the journal source-module check with `INVENTORY`;
- creates `branches`, `parties`, `party_opening_items`, `warehouses`, `items`, `stock_movements` and
  `stock_balances`;
- adds composite company foreign keys so a party, item, warehouse, journal or reversal cannot cross a
  tenant boundary;
- adds unique party/item/warehouse codes (case-insensitive), document-number uniqueness, one active
  principal branch and one reversal per stock movement;
- adds quantity/value checks and an append-only trigger on `stock_movements`;
- adds no destructive change to Phase 5 data. The down migration refuses to run if any stock movement
  or party opening item exists.

## Commands run and actual results

| Command                                                                | Result                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run migrate` (local PostgreSQL 16.15, existing 0001 dev database) | exit 0 — applied `0002`–`0005`; 1 already recorded                                                                                                                                                                                  |
| `npm run migrate:status`                                               | exit 0 — `0001`–`0005` all applied, checksums valid                                                                                                                                                                                 |
| `npm run typecheck`                                                    | exit 0 — app, test and server TypeScript                                                                                                                                                                                            |
| `npm run lint`                                                         | exit 0 — 0 errors; 42 pre-existing warnings in untouched legacy files, none in new Phase 6 files                                                                                                                                    |
| `npm run format:check`                                                 | exit 0 — all matched files use Prettier style                                                                                                                                                                                       |
| `npm test`                                                             | exit 0 — 5 files, 41 tests passed                                                                                                                                                                                                   |
| `TEST_DATABASE_URL=... npm run test:server`                            | exit 0 — 15 files, 80 tests passed (5 Phase 6 integration tests, 5 quantity unit tests)                                                                                                                                             |
| `npm run selfcheck`                                                    | exit 0 — all core, action, import and gate checks passed; 25/25 golden tax vectors                                                                                                                                                  |
| `npm run build`                                                        | exit 0 — Vite production build; existing large-chunk warning, 2,216.85 kB (658.89 kB gzip)                                                                                                                                          |
| `npm run build:server`                                                 | exit 0                                                                                                                                                                                                                              |
| `npm audit --omit=dev`                                                 | exit 1 — only the pre-existing `xlsx` high advisory remains; no new dependency was added                                                                                                                                            |
| `git diff --check`                                                     | exit 0 — no whitespace errors                                                                                                                                                                                                       |
| Browser smoke (`http://localhost:5173`)                                | signed in, opened `/app/masters` and `/app/inventory`, created a company fixture via the API, recorded opening/issue stock, verified the ledger and a zero-difference control proof; found and fixed the decimal-quantity UI defect |

No automated browser E2E harness exists in the repository. The browser smoke was an interactive
verification of the real-mode UI against the local API and PostgreSQL, not a committed E2E suite.

## Acceptance criteria

- **Parties/items/warehouses are CRUD-capable and audited:** PASS — create/update/deactivate/
  reactivate APIs and screens; integration tests cover duplicate code/SKU, invalid BIN, item-account
  type rejection, permission denial, opening-item cancellation and before/after audit events.
- **Stock movements produce correct quantities and values:** PASS — opening 10 @ 100.00 then GRN
  10 @ 120.00 gives 20 kg / 220,000 poisha / 110.00 average; issue 5 gives 55,000; return 2 gives
  22,000; transfer 3 carries 33,000 to the second warehouse; 1.2345 kg at 10.00 values at 1,235
  poisha. Idempotent replay produces no duplicate movement.
- **Negative stock is blocked or explicitly approved per policy:** PASS — issue above balance returns
  `409 STOCK_INSUFFICIENT`; accountant override returns `403 NEGATIVE_STOCK_OVERRIDE_FORBIDDEN`;
  controller without a reason returns `400`; controller with reason posts `-1.0000` / `-10,000`
  poisha and the movement records the override reason.
- **Inventory control proof reconciles; differences are visible:** PASS — stock 30,000 and GL 30,000
  with zero difference after stock commands; a manual Dr inventory 500.00 produces GL 80,000 vs stock
  30,000, difference `-50,000` poisha, returned in `differences` and highlighted in the UI. No plug
  entry exists.
- **Decimal units work:** PASS — `NUMERIC(18,4)` storage, decimal-string API, 1.2345 kg test and UI
  display with four places.
- **No master data from another company is accessible:** PASS — cross-company party/item reads return
  `404`; a scoped accountant receives `404 COMPANY_NOT_FOUND`; a cross-company stock command receives
  `404 ITEM_NOT_FOUND`; the second company's list is empty.
- **Stock movements are immutable and corrections use reversal:** PASS — database trigger rejects
  update/delete; reversing an issue creates a linked `REVERSAL_IN`, reverses the inventory journal,
  sets the original journal `REVERSED`, and a second reversal returns `409 STOCK_ALREADY_REVERSED`;
  reversing a reversal returns `409 REVERSAL_OF_REVERSAL`.
- **Referenced masters are not deleted:** PASS — no delete route exists; stock-bearing items and
  warehouses and parties with open opening items refuse deactivation; all deactivations require a
  reason.

## Tests added/updated

- `server/tests/integration/inventory.test.ts` — 5 tests covering master validation/audit/deactivation,
  weighted average, decimal quantities, return, transfer, insufficient stock, sequential and
  concurrent idempotent replay, negative-stock permissions and reason, inventory-to-GL proof,
  manual-journal difference visibility, stock/journal reversal, reversal-of-reversal, cross-company
  isolation and role permissions.
- `server/tests/unit/inventoryQuantity.test.ts` — quantity parsing/precision, half-up rounding,
  receipt value, weighted average and full-remainder issue.
- `server/tests/integration/migrations.test.ts` — migration 0005 apply/rollback/reapply and new tables.

## Security/accounting review notes

- **Authorization:** every master mutation requires `MANAGE_MASTERS_AND_COA`; stock commands require
  `DISPATCH_OR_RECEIVE_STOCK`; negative stock additionally requires `OVERRIDE_NEGATIVE_STOCK`.
  Auditors are read-only; operators can dispatch/receive stock but cannot change masters.
- **Tenant scope:** all tables carry `company_id`; composite foreign keys prevent cross-company party,
  item, warehouse, journal and reversal references. Cross-company reads return `404`.
- **Posting:** stock and its inventory journal are written in one transaction. Inventory uses the
  shared Phase 5 journal posting service for period/account/balance/number/sequence/audit checks.
- **Idempotency:** a required `Idempotency-Key` is unique per company and movement number. A
  transaction-scoped advisory lock serialises concurrent retries, so the second request replays the
  original command instead of duplicating stock or raising a unique violation.
- **Concurrency:** stock balances are locked with `FOR UPDATE`; transfers and reversals acquire
  warehouse locks in sorted warehouse-id order so opposite transfers cannot deadlock. Retries with
  the same idempotency key serialise on an advisory lock.
- **Reversal:** stock movements are append-only by trigger. Reversal creates a new linked movement and
  calls the transaction-scoped ledger reversal; original journal and movement remain in history. A
  second reversal and reversal-of-reversal are rejected.
- **Money/precision:** quantities are `NUMERIC(18,4)`; values and unit costs are integer poisha.
  Weighted-average division uses deterministic half-up rounding. No authoritative JavaScript floating
  point is used.
- **Periods:** inventory journals use the Phase 5 OPEN/CLOSED/LOCKED/unknown-period rules.
- **Negative stock:** blocked by default; only an explicit, permissioned, reasoned exception is
  recorded and audited.
- **Audit:** master and stock events include actor, session, request, IP/user-agent, before/after and
  reason where required. Audit storage is append-only.

## Known limitations

- Stock commands are single-item commands. A transfer carries one source/destination pair. Multi-line
  GRN/invoice commands belong to Phases 7–8.
- Party opening items are an AR/AP schedule and are not posted to the GL by this phase. AR/AP
  allocation, ageing and statements arrive in Phase 7.
- No stock count document, reorder level, FIFO/lot/batch/expiry, BOM, WIP or multi-location bin.
- Negative stock is an exceptional controller override. A receipt that clears a negative balance at a
  different cost can leave a residual value that requires a stock adjustment; the control proof will
  still reconcile and show the position rather than hide it.
- The inventory control proof is account-level with an item/warehouse breakdown. If two items share
  one inventory account, the GL cannot be split by item without a movement-level account snapshot;
  the account-level proof is authoritative.
- Warehouse/branch mapping is optional; the product does not require a branch at launch. This is the
  plan default and must be confirmed by the business.
- The UI uses `window.prompt` for deactivation and reversal reasons, consistent with the current
  period/reversal pages. A dedicated reason dialog is desirable but not part of this phase.
- The production bundle remains a single large chunk (2,216.85 kB, 658.89 kB gzip). Code splitting
  is deferred; the existing Vite warning is unchanged in character.
- No browser E2E automation exists; the interactive smoke is not a substitute for a committed suite.
- The pre-existing `xlsx` high advisory remains; no dependency was added by this phase.

## Manual or external decisions required

- Confirm the business policy defaults adopted from the master plan: negative stock blocked except
  for a controller override with a reason; four-decimal quantity precision; warehouses available at
  launch but branch mapping optional.
- Confirm the account policy for stock adjustments, opening stock and GRN clearing offsets. The
  service requires an active company account but does not choose one.
- Confirm whether party opening items must always be included in the opening-balance batch before
  go-live, and who reviews that schedule.
- Complete tax/statutory review before any tax category or rate is presented as final. Phase 6 reuses
  the existing category list and does not add rates.
- Confirm whether stock commands should require `POST_TO_GL` in addition to
  `DISPATCH_OR_RECEIVE_STOCK`; the current implementation follows the existing permission matrix,
  where stock operators receive stock and the service posts the matching inventory journal.

## Next-phase dependency verified: YES

Phase 5 server ledger, accounts, periods and posting service were inspected and exercised. Phase 6
uses `postSystemJournalWithinTransaction` and `reverseJournalWithinTransaction` so inventory cannot
create a second posting path. Phase 7 can consume the party, item, warehouse and stock services,
while document posting remains a separate Phase 7/8 responsibility.

## Blocker

None. The negative-stock, precision and warehouse defaults are those stated in the authoritative
implementation plan; business confirmation is recorded as a manual decision above.
