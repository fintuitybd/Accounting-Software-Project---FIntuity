PHASE COMPLETION REPORT
Phase: 8 — Purchases, GRN, bills and payables
Status: COMPLETE
Summary: Implemented a server-authoritative procure-to-pay flow for supplier bills and expense vouchers. Drafts persist in PostgreSQL; posting is one transaction that allocates a document number, writes the journal, AP open item, line-level tax evidence, reverse-charge liability and any real stock receipt. Supplier payments are separate documents that allocate to one or more posted bills, support partial payments, compute VDS/TDS from the actual allocation, create pending withholding liabilities, and post Dr AP / Cr bank / Cr VDS payable / Cr TDS payable atomically. AP ageing, supplier statements, an AP control proof and a withholding liability queue with control proof are derived from posted documents and allocations. The real UI replaces the fake W03 pipeline at `/app/purchases`; purchase orders, a separate GRN, three-way matching and purchase returns are explicitly not implemented and are not shown.

Files changed:

- `server/migrations/0007_purchases_payables.up.sql` — purchase documents/lines/tax evidence/decisions/events, payments/allocations, withholding liabilities, AP open-item view, composite tenant FKs, immutability and append-only triggers.
- `server/migrations/0007_purchases_payables.down.sql` — development/test rollback; aborts if purchase documents/payments exist and removes only Phase 8 configuration when empty.
- `server/src/purchases/taxPack.generated.ts` — generated purchase VAT/VDS/TDS/no-TIN/cash-limit snapshot; no hand-typed statutory rate.
- `server/src/purchases/tax.ts` — line-level purchase VAT, input-credit eligibility, missing BIN/Mushak evidence capitalisation, missing-TIN TDS upscale, reverse charge, policy approval gate and audit.
- `server/src/purchases/purchaseService.ts` — draft create/update, review, atomic posting, stock receipt planning, tax evidence, AP open items, reverse-charge liabilities, document reversal and list/detail queries.
- `server/src/purchases/payablesService.ts` — supplier payments, allocation preview/posting, actual VDS/TDS computation, duplicate bank-reference control, payment reversal, AP ageing/statement, open-bill list, withholding queue and control proof.
- `server/src/routes/purchases.ts` — company-scoped purchases/payables API with schemas, permissions and idempotency headers.
- `server/src/app.ts` — registers the purchases routes.
- `server/src/inventory/inventoryService.ts` — purchase goods-receipt planning/application and shared document stock-reversal helpers.
- `server/src/db/schema.ts` — Drizzle bindings for the Phase 8 tables.
- `server/tests/unit/purchaseTax.test.ts` — pack parity, VAT/input-credit, missing TIN/BIN/Mushak, cash limit, reverse charge and blocked-state tests.
- `server/tests/integration/purchases.test.ts` — 10 Phase 8 end-to-end journeys.
- `server/tests/integration/migrations.test.ts` — migration 0007 apply/rollback/reapply assertions.
- `scripts/generate-server-tax-pack.ts` — generates both sales and purchase server snapshots from the single client rule pack.
- `package.json` — formats generated tax snapshots as part of `taxpack:generate`.
- `server/src/sales/taxPack.generated.ts` — regenerated/formatting-only refresh from the shared generator; no rate change.
- `src/purchases/api.ts` — typed purchases/payables client.
- `src/pages/purchases/PurchasesPage.tsx` — real-mode purchases shell and tab routing.
- `src/pages/purchases/PurchaseFormPanel.tsx` — server-persisted bill/expense draft form with line-level classification, evidence and tax facts.
- `src/pages/purchases/PurchaseListPanel.tsx` — bills/expense list, filters and open amounts.
- `src/pages/purchases/PurchaseDetailPanel.tsx` — review, post, reverse, evidence, totals, lines and timeline.
- `src/pages/purchases/PaymentsPanel.tsx` — open-bill allocation, server withholding preview, posting, payment detail and reversal.
- `src/pages/purchases/PayablesPanel.tsx` — AP ageing/control proof, supplier statement, withholding liability queue and withholding proof.
- `src/pages/purchases/TaxPolicyPanel.tsx` — purchase rule-pack status, reviewer approval and control-account mapping.
- `src/pages/purchases/purchasesUi.tsx` — shared purchase UI helpers and status/proof components.
- `src/pages/purchases/purchasesRefs.ts` — shared reference-data type.
- `src/App.tsx` — `/app/purchases` route and Phase 8 footer.
- `src/components/layout/Sidebar.tsx` — purchases navigation, Phase 8 label and updated server-workspace note.
- `src/components/layout/TopBar.tsx` — real-mode purchase-bill quick action and honest demo message.
- `src/workspaces/W03_PurchasesWithholding.tsx` — explicit synthetic-demo warning; the real pipeline is `/app/purchases`.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 8 capability text and purchases link.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 8 capabilities, APIs, migration and limitations.

Database/migrations: `0007_purchases_payables` adds `purchase_documents`, `purchase_document_lines`, `purchase_document_taxes`, `purchase_tax_decisions`, `purchase_document_events`, `purchase_payments`, `purchase_payment_allocations`, `purchase_withholding_liabilities` and the derived `purchase_ap_open_items` view. It extends `company_settings` with `purchase_tax_policy`, adds composite tenant foreign keys, check/unique indexes for document/payment identity and bank references, append-only tax/allocation/event triggers, posted-document/line/payment immutability triggers and a withholding-status transition guard. The down migration refuses to run when purchase documents or payments exist; it removes the Phase 8 purchase-policy setting and restores the previous company-settings constraint.

Commands run and actual results:

- `npm run taxpack:generate` → exit 0; regenerated sales and purchase snapshots from `bd-2026-v1` and formatted both files.
- `npm run typecheck` → exit 0; app, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 42 pre-existing warnings in legacy files, none introduced by the new purchases files.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 5 files, 41 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:server` → exit 0; 19 files, 113 tests passed, including 10 Phase 8 integration tests, 8 purchase-tax unit tests and migration 0007 apply/rollback/reapply.
- `npm run selfcheck` → exit 0; all core, action, import and gate checks passed, including 25/25 golden tax vectors.
- `npm run build` → exit 0; Vite production build, 2,393.90 kB (698.55 kB gzip), existing large-chunk warning.
- `npm run build:server` → exit 0.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory remains, with no fix available. No dependency was added by this phase.
- `git diff --check` → exit 0; no whitespace errors.
- Browser smoke against a disposable PostgreSQL database and the running API/Vite (`/app/purchases`) → signed in as owner, created a stock supplier bill, reviewed server totals (base 1,000.00, VAT 150.00, VDS 150.00, TDS 30.00, net 970.00), posted it, saw AP outstanding 1,150.00, previewed a payment (cash 970.00), posted it, saw the AP item clear, reversed the payment, saw AP reopen to 1,150.00, and confirmed AP ageing and withholding control proofs agree. No console errors.

Acceptance criteria:

- Bill, payment and AP ageing work end-to-end: PASS — stock/expense bill posting, payment preview/posting, AP reopen after reversal and ageing/control proof are covered by `server/tests/integration/purchases.test.ts` and the browser smoke.
- Stock/expense classification is correct: PASS — line-level inventory vs expense accounts are enforced; stock lines move stock and expense lines do not; the test asserts 1310/5200 journal debits and stock balances.
- Missing TIN affects the posted amount: PASS — supplier e-TIN snapshot/missing flag upscales TDS from 3% to 4.5%; the posted bill net payable and the actual payment withholding both change; covered by the missing-TIN test.
- VDS/TDS liabilities and challan queue are created and reconcile: PASS — actual payment withholding creates `PENDING` VDS/TDS liabilities; reverse-charge bills create `PENDING` reverse-charge liabilities; the withholding proof returned zero difference for VDS/TDS/reverse charge. Actual Treasury challan deposit, bank evidence and Mushak 6.6 certificate records are Phase 9 and are clearly labelled as such.
- 3-way match is per-line and audited, or not shown: PASS — no PO/GRN/three-way endpoint or real-mode control exists. The bill is the goods-receipt document for stock lines, and the UI explicitly states that PO/GRN/three-way matching are not implemented. The legacy W03 demo is labelled synthetic-only.
- Reversal restores AP/stock and cannot be repeated: PASS — bill reversal posts a linked journal and stock reversal, removes the AP item, sets the document `REVERSED`, and a second reversal returns `409 PURCHASE_DOCUMENT_ALREADY_REVERSED`; payment reversal restores AP and reverses withholding liabilities once.
- No payables from another company are accessible: PASS — every query filters `company_id`, composite foreign keys prevent cross-company references, and the integration test returns `404` for a cross-company document/supplier.
- No fabricated supplier Mushak 6.3 evidence: PASS — the serial/date are user-supplied; missing evidence disallows and capitalises input VAT rather than inventing a serial.
- Posted records immutable and audited: PASS — DB triggers block updates/deletes on posted documents, lines, payments and tax evidence; audit events and document timelines are written in the same transaction.

Tests added/updated:

- `server/tests/integration/purchases.test.ts` — 10 tests covering tax-policy gating, stock/expense posting, expense voucher, missing TIN, full/partial payments, duplicate bank reference, idempotent replay, AP ageing/statement, missing Mushak evidence, reverse charge, bill/payment reversal, permissions, tenant isolation and closed periods.
- `server/tests/unit/purchaseTax.test.ts` — generated pack parity with the client rule pack; line VAT/input credit; missing TIN upscale; missing BIN/Mushak capitalisation; truncated 5%; cash limit; reverse charge; out-of-scope/expired pack blocking.
- `server/tests/integration/migrations.test.ts` — migration 0007 apply, rollback and reapply.
- Browser smoke (not committed as an automated harness) — real `/app/purchases` bill → payment → reversal → AP/withholding proof journey.

Security/accounting review notes:

- Authorization: draft create/update requires `CREATE_COMMERCIAL_DRAFT`; posting and payments require `POST_TO_GL`; reversal requires `REVERSE_POSTED_JOURNAL`; tax-policy approval requires `MANAGE_COMPANY_SETTINGS`; auditors are read-only at the API.
- Tenant scope: every purchase table carries `company_id`; composite foreign keys prevent cross-company party/item/warehouse/account/document/payment/allocation/journal references; cross-company reads/writes return `404`.
- Posting: document number, journal, AP item, tax decision/evidence, reverse-charge liability and any stock receipt are written in one transaction through the Phase 5 posting service. No client-supplied total, tax amount or status is authoritative; the draft totals are recomputed and compared at posting.
- Idempotency: draft creation, posting and payments use company-scoped keys with transactional advisory locks and replay the original result. A different key for an already-posted document/payment is rejected.
- AP subledger: outstanding derives from posted documents less posted payment allocations. There is no mutable “settled” flag. Ageing includes an AP control-account proof and surfaces differences.
- Withholding: liabilities are created from actual payment allocations and reverse-charge bills, never from a preview. Reversal marks the linked liabilities `REVERSED`; liabilities already `DEPOSITED` block reversal and require the Treasury correction process.
- Stock: stock lines on a posted bill create a real `GRN_RECEIPT` movement and weighted-average balance update. Reversal uses linked `REVERSAL_OUT` movements; a reversal that would drive stock negative is rejected. Inventory value includes disallowed input VAT so stock and the inventory GL agree.
- Tax: line-level integer-poisha calculations; evidence and rule pack/version are stored per document; the pack remains `PENDING_TAX_COUNSEL` and posting is blocked until a named reviewer approves the exact version and control accounts. Historical documents retain their snapshot.
- Money/precision: authoritative amounts are BigInt poisha in TypeScript and `BIGINT` in PostgreSQL; quantities are `NUMERIC(18,4)`; no authoritative floating point is used.
- Periods: bill/payment posting uses explicit OPEN periods and rejects unknown/closed/locked dates. Reversal dates are validated the same way.

Known limitations:

- Purchase orders, a separate GRN document and three-way matching are not implemented. A bill with stock lines is the real receipt event; the real UI does not show a fake three-way match. The legacy W03 demo is explicitly labelled synthetic-only.
- Purchase returns/debit notes are deferred and hidden. There is no supplier debit-note document, supplier refund, or purchase-price variance workflow.
- Attachments are evidence references only; there is no file upload, object storage, virus scan or download authorization.
- Treasury challan deposit, bank evidence and Mushak 6.6 certificates are Phase 9. The current screen is a pending liability queue with a control proof, not a filed challan or certificate.
- Payment approval thresholds, maker-checker for high-value payments and payment batching are not implemented in this phase; Phase 9/12 must add them.
- Supplier-invoice duplicate detection is not a unique control; idempotency and unique bank references protect retries and duplicate payments, but the same supplier invoice number could be entered under a different key. A manual/approved duplicate check is still needed.
- A non-stock purchase line can post to an ASSET account for a capitalisable purchase, but there is no fixed-asset register or depreciation workflow.
- Reverse-charge input credit is determined from the challan reference recorded at bill posting. Obtaining or changing the challan later requires a controlled correcting workflow that is not implemented; the current design never silently reclassifies a posted bill.
- The s.46 cash-limit test uses the bill's declared payment method at posting. A later cash settlement of a bill originally declared as credit is not re-evaluated; a payment-time cash-limit control is still required. Likewise, later supplier BIN/Mushak evidence does not automatically reclassify already-disallowed input VAT.
- Payment allocations are validated against the current open amount, and AP ageing uses payment dates. A backdated payment policy/approval is not implemented; users should avoid backdating settlements until that control is added.
- A stock item must use an active ASSET inventory account with the `INVENTORY` control subledger. Items created in Phase 6 with a non-control inventory asset account will be blocked with a clear error until the chart-of-accounts mapping is corrected; this is deliberate so inventory and the GL control account agree.
- Document numbers and purchase sequences are company-wide per fiscal year. Branch/BIN-unit-scoped purchase numbering is not implemented; the final statutory format remains a tax/professional decision.
- No automated browser E2E harness exists. The committed tests are API/unit/integration plus the existing render smoke; the browser journey was an interactive smoke against a disposable database.
- The tax pack remains `PENDING_TAX_COUNSEL`; the approval screen records an external reviewer decision but does not replace professional review.
- The pre-existing `xlsx` high advisory remains; no dependency was added by this phase. The production bundle remains a single large chunk.
- AP ageing and supplier statement use a selectable as-of date. Future-dated bills are correctly excluded from an earlier as-of date; the UI shows the selected date so this is visible rather than silent.

Manual or external decisions required:

- Tax counsel must verify and approve the applicable VAT rates, input-credit conditions, VDS/TDS rates, no-TIN upscale, reverse-charge treatment, cash limit and supplier Mushak 6.3 evidence rules, and confirm the statutory presentation of any evidence/certificate.
- The accountant/controller must confirm the production mapping of AP control, input VAT, VDS payable, TDS payable, reverse-charge payable, inventory and expense accounts, and the treatment of disallowed VAT capitalisation.
- The business must confirm whether PO/GRN/three-way matching and purchase returns/debit notes are required for launch, and whether payments need maker-checker approval thresholds.
- An attachment storage/scanning provider and retention policy are required before storing file evidence.
- Phase 9 must decide the Treasury challan, deposit evidence and Mushak 6.6 certificate format with tax counsel before issuing certificates.

Next-phase dependency verified: YES — Phase 9 can consume the Phase 8 supplier payment/allocation and withholding-liability model, and Phase 7 AR/receipt patterns are present. Phase 6 inventory is exercised by the Phase 8 stock receipt and reversal tests. Phase 5 ledger posting/reversal and period enforcement are used by every Phase 8 posting.

Blocker: None. The pending tax-counsel sign-off is an operational gate enforced by `PURCHASE_TAX_POLICY_NOT_APPROVED`, not a hidden ledger bypass; a named reviewer must record approval for the exact pack version before go-live.
