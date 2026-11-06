PHASE COMPLETION REPORT
Phase: 7 — Sales, credit notes and receivables
Status: COMPLETE
Summary: Implemented a server-authoritative order-to-cash flow for sales invoices, credit notes, customer receipts and AR. Drafts persist in PostgreSQL; posting is one transaction that allocates document and statutory serials, stores a line-level VAT decision snapshot, posts Dr AR / Cr revenue / Cr output VAT and Dr COGS / Cr inventory, creates AR open items and updates stock. Credit notes are separate linked documents with their own `M67` series, quantity/value limits against the original invoice and original-cost stock restoration. Receipts are separate documents with partial/multiple allocations, permissioned write-offs and unapplied cash. AR ageing, customer statements, an internal VAT register and an AR control proof are derived from posted documents and allocations, not mutable status. Real-mode `/app/sales` replaces the old fake pipeline; the legacy W02 pipeline remains only in the isolated synthetic demo and is explicitly labelled.
Files changed:

- `server/migrations/0006_sales_receivables.up.sql` — sales documents, lines, tax evidence, tax decisions, events, receipts, allocations, AR view, sequences and append-only/immutability triggers.
- `server/migrations/0006_sales_receivables.down.sql` — development/test rollback that aborts if any sales document or receipt exists.
- `server/src/db/schema.ts` — Drizzle bindings for the new sales tables.
- `server/src/company/constants.ts` — `MUSHAK_63`/`MUSHAK_67` document-sequence types and prefixes.
- `server/src/sales/taxPack.generated.ts` — generated sales VAT snapshot derived from the existing rule pack; no hand-typed rates.
- `server/src/sales/tax.ts` — line-level VAT calculation, decision states, tax snapshot, policy approval and posting gate.
- `server/src/sales/salesService.ts` — draft create/update, review, posting, credit-note approval, document reversal and detail/list queries.
- `server/src/sales/receivablesService.ts` — receipts, allocations, receipt reversal, AR ageing/statement/VAT register and control proof.
- `server/src/routes/sales.ts` — company-scoped sales and receivables API with schemas, permissions and idempotency headers.
- `server/src/inventory/inventoryService.ts` — transaction-scoped sales issue/return/reversal stock planning used by the sales journal.
- `server/src/app.ts` — registers the sales routes.
- `scripts/generate-server-tax-pack.ts` — regenerates the server tax snapshot from the client rule pack.
- `package.json` — adds the `taxpack:generate` script.
- `server/tests/unit/salesTax.test.ts` — tax-pack parity, mixed-rate rounding, missing BIN, blocked reverse-charge/expired pack and credit-note overrides.
- `server/tests/integration/sales.test.ts` — Phase 7 end-to-end suite.
- `server/tests/integration/migrations.test.ts` — migration 0006 apply/rollback/reapply assertions.
- `src/sales/api.ts` — typed sales/receivables client.
- `src/pages/sales/SalesPage.tsx` — real-mode sales shell and tab routing.
- `src/pages/sales/InvoiceFormPanel.tsx` — server-persisted invoice/credit-note draft form.
- `src/pages/sales/DocumentListPanel.tsx` — invoice/credit-note lists and filters.
- `src/pages/sales/DocumentDetailPanel.tsx` — review, post, approve, reverse, tax evidence and timeline.
- `src/pages/sales/ReceiptsPanel.tsx` — receipt posting, allocation, detail and reversal.
- `src/pages/sales/AgeingPanel.tsx` — AR ageing, control proof, CSV export and customer statement.
- `src/pages/sales/VatRegisterPanel.tsx` — internal sales VAT register and CSV export.
- `src/pages/sales/TaxPolicyPanel.tsx` — rule-pack status and reviewer-approval configuration.
- `src/pages/sales/salesUi.tsx`, `src/pages/sales/salesRefs.ts` — shared sales UI helpers/types.
- `src/App.tsx` — `/app/sales` route.
- `src/components/layout/Sidebar.tsx` — Sales & receivables navigation and Phase 7 footer.
- `src/components/layout/TopBar.tsx` — real-mode “New sales invoice” quick action.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 7 context and sales link.
- `src/setup/api.ts` — labels for the new statutory sequences.
- `src/core/tax-engine/rulePack.ts` — explicit `.ts` type import so the server test can compare the generated pack without duplicating it.
- `src/workspaces/W02_SalesMushak63.tsx` — added a clear synthetic-demo warning; the real pipeline is `/app/sales`.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 7 capabilities, APIs, migration and limitations.

Database/migrations: `0006_sales_receivables` adds `sales_documents`, `sales_document_lines`, `sales_document_taxes`, `sales_tax_decisions`, `sales_document_events`, `sales_receipts`, `sales_receipt_allocations` and the derived `sales_ar_open_items` view. It extends the journal source modules, company-settings keys and number-sequence document types with internal `M63`/`M67` series, adds composite tenant foreign keys, check constraints, unique document/serial/idempotency indexes, append-only triggers and posted-document immutability triggers. The down migration refuses to run if any sales document or receipt exists.

Commands run and actual results:

- `npm run typecheck` → exit 0; app, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 42 pre-existing warnings in legacy files, none in the new sales files.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 5 files, 41 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 17 files, 95 tests passed, including 10 Phase 7 integration tests, 5 sales-tax unit tests and migration 0006 apply/rollback/reapply.
- `npm run selfcheck` → exit 0; all core, action, import and gate checks passed, including 25/25 golden tax vectors.
- `npm run build` → exit 0; Vite production build, 2,314.99 kB (681.82 kB gzip), existing large-chunk warning.
- `npm run build:server` → exit 0.
- `npm run migrate:status` (local PostgreSQL 16.15, Phase 7 development database) → exit 0; `0001`–`0006` applied with valid checksums.
- `npm run taxpack:generate` → exit 0; regenerated `server/src/sales/taxPack.generated.ts` with no diff.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory remains, with no fix available. No dependency was added by this phase.
- `git diff --check` → exit 0; no whitespace errors.
- Browser smoke against the running API and Vite (`/app/sales`) → signed in as an owner, created and posted a mixed-rate invoice through the form, opened the receipt detail, AR ageing/control proof, VAT register and tax-policy screens, and confirmed no console errors after fixes. The smoke found and fixed a real UI defect: the page requested `pageSize=200` from master-data endpoints whose maximum is 100, producing a validation banner.

Acceptance criteria:

- Invoice, credit note and receipt work end-to-end: PASS — invoice posting creates the journal, AR item, VAT evidence and stock movement; credit note is linked to the original; receipt posts cash/write-off/AR and allocations in one transaction. Covered by `server/tests/integration/sales.test.ts`.
- AR ageing and control account agree after partial/multiple receipts: PASS — after two receipts and a later unapplied-cash allocation the proof returned `differencePoisha: 0`; the test also reverses a receipt and re-proves the control account.
- Credit note does not consume a 6.3 serial and restores stock/cost: PASS — credit note received `M67-2026-…`, `MUSHAK_63` next value stayed at `2` after the credit note, and stock/value moved from `98`/`980000` to `99`/`990000` at original cost.
- Mixed-rate tax is correct: PASS — line 1 `STANDARD_15` net 190.00/VAT 28.50; line 2 `TRADING_5` net 61.73/VAT 3.09; document gross 283.32 with exact integer poisha.
- Drafts persist and are visible to authorised users: PASS — draft was created, re-read after refresh/reload and posted later; the browser smoke also created a draft through the UI and posted it.
- Reversal restores AR/stock and cannot be repeated: PASS — invoice reversal restores stock `96`/`960000` to `99`/`990000`, removes the open item and a second reversal returns `409 SALES_DOCUMENT_ALREADY_REVERSED`; credit-note reversal restores stock `99`/`990000` to `98`/`980000` and reopens AR.
- No fake workflow stage remains: PASS for real mode — `/app/sales` exposes only invoice, credit-note, receipt, ageing/statement, VAT and tax-policy screens; no quotation/order/challan controls exist. The legacy W02 pipeline is reachable only in the labelled synthetic demo and now carries an explicit warning.
- Tax rules are not presented as final: PASS — posting returns `409 SALES_TAX_POLICY_NOT_APPROVED` until a named reviewer approval for the exact pack version and output VAT account is recorded; the pack remains labelled `PENDING_TAX_COUNSEL` in the UI.
- Posted records are immutable and tenant-scoped: PASS — direct SQL updates/deletes on posted documents, lines and tax decisions return `55000`; composite foreign keys and service filters reject cross-company access.

Tests added/updated:

- `server/tests/integration/sales.test.ts` — 10 tests covering draft persistence, tax-policy gate, mixed-rate posting, AR/VAT/COGS/stock journal agreement, credit-note limits and M67 series, stock restoration, partial/multiple receipts, over-allocation, unapplied-cash allocation, receipt reversal, AR ageing/control proof, customer statement, VAT register relevance, invoice/credit-note reversal, high-value approval and maker-checker, concurrent idempotent posting, permissions and cross-company isolation.
- `server/tests/unit/salesTax.test.ts` — generated-pack parity with the client rule pack, per-line rounding, mixed rates, missing BIN conditions, blocked reverse-charge/expired pack and credit-note overrides.
- `server/tests/integration/migrations.test.ts` — adds `0006_sales_receivables` to apply, rollback and reapply checks and asserts the new tables are removed.

Security/accounting review notes:

- Authorization: draft create/update requires `CREATE_COMMERCIAL_DRAFT`; posting and receipts require `POST_TO_GL`; credit-note approval and write-off require `APPROVE_HIGH_VALUE`; reversal requires `REVERSE_POSTED_JOURNAL`; tax-policy approval requires `MANAGE_COMPANY_SETTINGS`. Auditors remain read-only at the API.
- Tenant scope: every sales table carries `company_id` and composite foreign keys prevent cross-company party, item, warehouse, account, document, receipt, allocation or journal references. Cross-company reads/writes return `404`.
- Posting: document number, statutory serial, journal, AR item, tax evidence, stock movement and audit are written in one transaction. The journal uses the Phase 5 posting service, so period/OPEN, account, balance, numbering and audit rules are shared.
- Idempotency: draft creation and posting use company-scoped idempotency keys; posting serialises concurrent retries with a transaction advisory lock and replays the original result. Receipts do the same. A different key for an already-posted document returns `409`.
- AR subledger: outstanding derives from posted invoices less posted receipt allocations and posted credit notes. There is no mutable “settled” flag. Ageing uses an as-of allocation/credit-note cutoff and proves the company-wide AR control account even when a customer filter is applied.
- Stock/COGS: invoice stock issues use weighted-average valuation; credit notes restore the original issue cost (proportionally for partial returns). Invoice/credit-note reversals create linked stock reversal movements. Stock and GL values reconcile in the tests.
- Reversal: original documents and journals remain immutable; reversal creates a mirrored journal and linked stock movements, records actor/reason, and refuses a second reversal or reversal-of-reversal.
- Tax: line-level integer-poisha VAT, rule ID/citation/version persisted per line, full decision input/output snapshot and trace ID stored. Historical posted documents retain their snapshot. Posting is blocked if the pack is not approved for the company, not effective for the document date, or returns an unsupported decision.
- Audit: draft/update/approve/post/reverse/receipt/allocate/tax-approval actions append audit events with actor, session, request and before/after context. Sales document events provide a human-readable timeline.
- Money/precision: authoritative amounts are BigInt poisha in TypeScript and `BIGINT` in PostgreSQL; quantities are `NUMERIC(18,4)`; no authoritative floating point is used.

Known limitations:

- Quotation, sales order and delivery challan are intentionally not implemented as server documents. The real UI does not show them; the old demo pipeline is labelled synthetic-only.
- Attachments are evidence references, not uploaded files. There is no object-storage adapter, virus scan or download authorization yet.
- Statutory serials are company-wide per fiscal year. Branch/BIN-unit-scoped series and the final Mushak 6.3/6.7 presentation format require tax/professional confirmation.
- Credit notes are quantity-based returns linked to original lines. A price-only credit adjustment is not supported; it needs a controlled value-adjustment design.
- A credit note can exceed an invoice’s remaining open balance when the invoice was already partly paid, producing a customer credit shown as a negative open item/credit row. There is no refund or customer-advance document workflow yet.
- Later allocation of unapplied cash has no separate business allocation date; historical ageing uses the allocation creation timestamp. A dedicated allocation-date field is desirable.
- Receipts do not perform bank/MFS reconciliation and do not create treasury challans or 6.6 certificates.
- No customer credit-limit enforcement, dunning, collection tasks, invoice/statement PDF email, or receipt printing.
- No automated browser E2E harness exists. The committed tests are API/unit/integration plus the existing render smoke; the browser journey was an interactive smoke.
- The tax pack remains `PENDING_TAX_COUNSEL`; the approval screen records an external reviewer decision but does not replace professional review.
- The pre-existing `xlsx` high advisory remains; no dependency was added by this phase. The production bundle remains a single large chunk.

Manual or external decisions required:

- Tax counsel must verify and approve the applicable VAT rates, categories, effective dates and evidence rules, and must confirm the legal Mushak 6.3/6.7 serial format and whether separate series are required per branch/BIN unit.
- The accountant/controller must confirm the production mapping of AR control, revenue, output VAT, inventory, COGS and write-off accounts, and the high-value credit-note threshold.
- The business must decide the treatment of over-credited/partly paid invoices (customer credit, refund or future allocation) and whether a customer-advance/refund document is required.
- The business must confirm whether quotation/order/challan workflow is required; it remains deferred rather than faked.
- An attachment storage/scanning provider and retention policy are required before storing file evidence.
- Production email, bank/MFS feeds, payment gateways and printing/PDF delivery remain external/integration decisions.

Next-phase dependency verified: YES — Phase 5 ledger posting/reversal and Phase 6 parties, items, warehouses, stock valuation and periods were inspected and exercised by the Phase 7 tests. Phase 8 can consume the sales AR subledger and inventory movement helpers, but purchases/AP are not implemented here.

Blocker: None. The pending tax-counsel sign-off is an operational gate enforced by `SALES_TAX_POLICY_NOT_APPROVED`, not a hidden ledger bypass; a named reviewer must record approval for the exact pack version before go-live.
