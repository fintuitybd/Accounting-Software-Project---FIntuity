PHASE COMPLETION REPORT
Phase: 9 — Receipts, payments, treasury and certificates
Status: COMPLETE
Summary: Connected settlement to the AR/AP subledgers and to persisted treasury records. Customer receipts and supplier payments already exist from Phases 7–8; this phase adds attachment references, audited maker-checker approval for supplier payments at or above the configured payment threshold, and a full treasury flow. The pending queue is the persisted withholding liability register; a treasury challan is the deposit document created atomically at deposit time. VDS/TDS/reverse-charge liabilities created by actual payments or reverse-charge bills can be selected into one treasury challan, posted atomically as Dr liability / Cr bank, marked DEPOSITED with an operator-supplied economic code, and linked to bank evidence. Each deposited VDS/TDS liability creates a persisted draft certificate whose base and tax are copied exactly from the source liability; a database trigger rejects any different amount. Certificates can be cancelled or reissued with audit, and a deposit can be reversed with a linked journal reversal that restores the liabilities to PENDING and cancels the linked draft certificates. The real `/app/treasury` screen replaces the synthetic challan/certificate behaviour in server-backed mode. No certificate is marked issued, printed as final or filed.

Files changed:

- `server/migrations/0008_treasury_certificates.up.sql` — treasury challans/items, draft certificates, payment approval requests, receipt/payment attachment references, liability economic code/deposit links, `TREASURY` journal source, `TREASURY_CERTIFICATE` sequence, triggers and controls.
- `server/migrations/0008_treasury_certificates.down.sql` — development/test rollback; refuses while treasury challans, certificates or payment approvals exist and restores the prior trigger bodies/constraints.
- `server/src/db/schema.ts` — Drizzle bindings for the new columns and treasury/approval tables.
- `server/src/company/constants.ts` — `TREASURY_CERTIFICATE` document type and `CERT-` prefix.
- `server/src/ledger/constants.ts` — `TREASURY` journal source module.
- `server/src/purchases/payablesService.ts` — shared payment preparation/posting, payment approval requests, approve/reject, attachment/approved-by fields, and approval-aware replay.
- `server/src/routes/purchases.ts` — payment attachment, payment-approval list/detail/approve/reject routes and HTTP 202 for a pending approval.
- `server/src/sales/receivablesService.ts` — receipt attachment reference persisted and returned.
- `server/src/routes/sales.ts` — receipt attachment schema and request mapping.
- `server/src/treasury/treasuryService.ts` — liability register, atomic challan deposit, challan reversal, certificate derivation/cancellation/reissue and treasury control proofs.
- `server/src/routes/treasury.ts` — company-scoped treasury API with permissions, schemas and idempotency.
- `server/src/app.ts` — registers the treasury routes.
- `server/tests/integration/treasury.test.ts` — six Phase 9 end-to-end tests.
- `server/tests/integration/migrations.test.ts` — includes migration 0008 in apply/rollback/reapply and table assertions.
- `src/treasury/api.ts` — typed treasury client.
- `src/pages/treasury/TreasuryPage.tsx` — real treasury liability, deposit, certificate and reconciliation screens.
- `src/App.tsx` — `/app/treasury` route and Phase 9 footer.
- `src/components/layout/Sidebar.tsx` — treasury navigation and Phase 9 label.
- `src/pages/CompanyWorkspacePlaceholder.tsx` — Phase 9 capability text and treasury link.
- `src/pages/purchases/PurchasesPage.tsx` — approval permissions passed to payments.
- `src/pages/purchases/PaymentsPanel.tsx` — attachment field, approved-by display, pending approval queue and approve/reject actions.
- `src/pages/purchases/PayablesPanel.tsx` — withholding notice now points to the real treasury flow.
- `src/purchases/api.ts` — payment attachment, approved-by and approval-request types/methods.
- `src/pages/sales/ReceiptsPanel.tsx` — receipt attachment field and detail display.
- `src/sales/api.ts` — receipt attachment type/input.
- `src/setup/api.ts` — `TREASURY_CERTIFICATE` sequence label.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 9 capabilities, APIs, migration and limitations.

Database/migrations: `0008_treasury_certificates` adds `treasury_challans`, `treasury_challan_items`, `treasury_certificates` and `purchase_payment_approval_requests`; adds `attachment_reference` to sales receipts and purchase payments; adds `approved_by`/`approved_at` to purchase payments; adds `economic_code`, `challan_id` and `deposited_at` to withholding liabilities; adds the `TREASURY` journal source and `TREASURY_CERTIFICATE` number sequence. It enforces certificate derivation and immutability, challan total equality, one active deposit per liability, duplicate posted bank deposit references, and approval-request immutability. The down migration refuses to run while any treasury challan, certificate or payment approval exists.

Commands run and actual results:

- `npm run typecheck` → exit 0; app, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 42 pre-existing warnings, none in the new treasury files.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm test` → exit 0; 5 files, 41 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:server` → exit 0; 20 files, 119 tests passed, including 6 Phase 9 treasury integration tests and migration 0008 apply/rollback/reapply.
- `npm run selfcheck` → exit 0; all core, action, import and gate checks passed, including 25/25 golden tax vectors.
- `npm run build` → exit 0; Vite production build, 2,435.68 kB (706.12 kB gzip), existing large-chunk warning.
- `npm run build:server` → exit 0.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory remains, with no fix available. No dependency was added by this phase.
- `git diff --check` → exit 0; no whitespace errors.
- Interactive browser smoke against a disposable PostgreSQL database and the running API/Vite (`/app/treasury`) → signed in as owner, opened pending liabilities, deposit register, certificates and reconciliation tabs, confirmed no console errors, and confirmed the reconciliation screen shows the intended “purchase tax pack not approved” blocker instead of inventing a proof. No certificate was issued or filed.

Acceptance criteria:

- Receipts/payments reduce the correct open items: PASS — a partial payment allocated across two posted bills reduced each AP open item from 1,150.00 to 650.00; the AP control proof agreed. Existing customer receipts continue to support partial/multiple allocation, write-off and unapplied cash.
- AR/AP/VDS/TDS control accounts reconcile after settlement: PASS — the treasury proof returned `agrees: true` for VDS, TDS and reverse charge, the challan register proof returned zero difference, and the AP ageing proof agreed in the multi-bill payment test.
- Challans and certificates are real, linked and auditable: PASS — treasury challans/items/certificates are persisted with company, source liability, payment, bill, bank evidence, journal and actor links; audit events are written for deposit, reversal, cancellation and reissue.
- Duplicate payment/deposit is blocked: PASS — a duplicate posted bank payment reference returns `409 PURCHASE_PAYMENT_REFERENCE_DUPLICATE`; a second deposit of the same liability returns `409 TREASURY_LIABILITY_NOT_PENDING`; a duplicate posted treasury deposit reference returns `409 TREASURY_DEPOSIT_REFERENCE_DUPLICATE`.
- Certificate amounts derive from the original document, not an arbitrary multiplier: PASS — certificate base and tax equal the source liability base and amount in the integration test, and the database trigger rejects any other value.
- No filing/audit claim is made: PASS — every certificate is `DRAFT` with `DRAFT_STATUTORY_FORMAT_UNVERIFIED`; there is no issue, print-as-final or filed route or button. Treasury outputs carry a “no filing claim” notice.
- Payment approval thresholds and segregation of duties: PASS — a payment at/above the configured `paymentPoisha` threshold returns HTTP 202 without posting; the maker cannot approve their own payment (`PURCHASE_PAYMENT_SELF_APPROVAL`); a different owner/controller approval posts the payment, AP allocation and withholding atomically with `approved_by`/`approved_at`.
- Permissions and tenant isolation: PASS — operator/auditor cannot post a treasury challan; cross-company challan/certificate reads return 404; a deposit using another company's bank account/liability path returns 404.

Tests added/updated:

- `server/tests/integration/treasury.test.ts` — six tests covering partial/multiple supplier allocation, actual VDS/TDS derivation, duplicate payment reference, deposit and duplicate-deposit blocking, duplicate deposit reference, certificate derivation, control proofs, deposit reversal/redeposit, certificate cancellation/reissue, approval thresholds/self-approval and permissions/tenant isolation.
- `server/tests/integration/migrations.test.ts` — migration 0008 apply/rollback/reapply and new table assertions.
- Existing `server/tests/integration/sales.test.ts` continues to cover receipt overpayment/unapplied cash and AR allocation after this phase’s receipt attachment change.
- Interactive browser smoke (not committed as an automated harness) — `/app/treasury` tab rendering and honest tax-policy blocker.

Security/accounting review notes:

- Authorization: treasury reads require `VIEW_REPORTS`; deposit/economic-code changes require `POST_TO_GL`; deposit reversal requires `REVERSE_POSTED_JOURNAL`; certificate cancellation/reissue and payment approvals require `APPROVE_HIGH_VALUE`; auditors are read-only at the API.
- Tenant scope: every treasury/approval table carries `company_id`; composite foreign keys prevent cross-company liability, challan, certificate, payment, bill, bank, journal and party references; cross-company reads/writes return 404.
- Posting: a challan locks its PENDING liabilities, verifies the approved purchase tax policy and OPEN period, allocates the `TREASURY_CHALLAN` number, posts Dr each liability control account / Cr bank, inserts the challan/items, marks liabilities DEPOSITED and creates certificates in one transaction. The deferred constraint trigger rejects a challan whose total differs from its items.
- Idempotency: challan posting uses a company-scoped advisory lock and unique idempotency key, replaying the original challan. A different key for an already-deposited liability is rejected.
- Duplicate control: a partial unique index prevents a posted bank deposit reference from being reused; liability status + row locks prevent the same liability being deposited twice. A reversed deposit keeps its history and can be followed by a new deposit reference.
- Reversal: deposit reversal posts a linked journal reversal, marks the challan REVERSED, restores liabilities to PENDING and cancels the linked draft certificates; a second reversal is rejected. Original challans, journals and liabilities are never deleted.
- Certificates: generated only from a deposited VDS/TDS liability; a trigger enforces exact source base/tax and source links. Certificates are immutable except DRAFT → CANCELLED; cancellation/reissue preserves the original row and writes audit events. No final issue/filing path exists.
- Approval: the approval request stores a server-computed snapshot; approval revalidates current open items, withholding, tax policy, period and totals before posting. The requester cannot approve; rejection is terminal and posts nothing.
- Money/precision: authoritative amounts remain BigInt poisha in TypeScript and `BIGINT` in PostgreSQL; certificate/challan totals and control proofs use integer arithmetic. No client-supplied total is authoritative; the client sends liability selections and the server computes the deposit total.
- Audit: deposit, reversal, economic-code, payment-approval requested/approved/rejected, certificate cancellation and reissue events include actor, session, request, before/after and reason.

Known limitations:

- AIT is not modelled because the verified purchase rule pack does not provide an AIT rate/base in the purchase flow. Only VDS, TDS and reverse-charge VAT liabilities are created. Adding AIT requires tax-counsel confirmation.
- Received certificates are not generated because the Phase 7 customer-receipt model does not capture customer withholding. The certificate model has a direction field, but this phase only issues draft certificates from supplier-payment withholding.
- Certificates remain DRAFT. There is no statutory-format print/export, no government acknowledgement, and no filing workflow; those require professional verification.
- Treasury economic codes are operator-supplied and required at deposit; the application never invents a code. The liability carries the code after deposit and freezes it.
- Attachment/evidence fields are references only; there is no file upload, object storage, virus scan or download authorization.
- Supplier advances/unapplied supplier payments are not modelled. Customer receipts do support overpayment/unapplied cash and permissioned write-offs.
- Bank statement import/reconciliation, bank transfers and statement matching remain Phase 10.
- The treasury proof compares current PENDING liabilities with the GL as of the selected date, following the Phase 8 proof convention; it is not a full historical status reconstruction.
- Two different payment-approval requests with different idempotency keys could be created for the same bills; open-item locking and allocation limits prevent over-payment, but an explicit duplicate-request warning is not implemented.
- No automated browser E2E harness exists. The committed evidence is API/unit/integration plus an interactive treasury page smoke.
- The pre-existing `xlsx` high advisory remains; no dependency was added by this phase.
- The tax pack remains `PENDING_TAX_COUNSEL`; the approval screen records an external reviewer decision but does not replace professional review.

Manual or external decisions required:

- Tax counsel must verify the statutory certificate form/number, VDS/TDS rates and bases, AIT applicability, economic-code requirements, and whether any certificate may be issued or filed. Until then every certificate must remain DRAFT.
- The accountant/controller must confirm the VDS/TDS/reverse-charge control-account mapping, the payment approval threshold, and whether treasury economic codes are per tax type or transaction-specific.
- The business must decide whether customer-withholding/received certificates and supplier advances are required for launch.
- An attachment storage/scanning provider and retention policy are required before storing evidence files.
- Phase 10 must decide bank statement formats and reconciliation policy; this phase only records deposit references/evidence.

Next-phase dependency verified: YES — Phase 10 can consume active bank/cash accounts, posted receipts/payments, the GL, persisted treasury deposit references and bank evidence references. The Phase 9 treasury API deliberately does not import or reconcile bank statements.

Blocker: None. Statutory certificate format/rates remain unverified but are an operational gate: outputs are DRAFT-only and cannot be issued or filed by this phase.
