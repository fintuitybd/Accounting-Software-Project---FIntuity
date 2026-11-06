# Accountant guide

**Audience:** accountants, controllers and finance managers using the server-backed application.
**Statutory status:** the tax rule pack remains `PENDING_TAX_COUNSEL`. Registers/certificates and the
VAT 9.1 schedule are internal drafts until a named reviewer approves the exact pack and the statutory
format. The system does not file returns or print government receipts.

## 1. Period workflow

1. **Configure** the fiscal year and monthly periods. Every posting needs an explicit `OPEN` period.
2. **Open** the period and reconcile the previous period’s control accounts.
3. **Enter and post** routine documents (sales invoices, credit notes, receipts, bills, expense
   vouchers, payments, journals) with evidence references.
4. **Reconcile** bank/MFS statements; match or create approved GL entries for unexplained lines.
5. **Review** AR/AP ageing, VAT registers, inventory valuation and control proofs.
6. **Resolve** suspense items with a named target account, reason and a different checker.
7. **Close** through the persisted checklist. Maker and checker must differ. Approval locks the period.
8. **Produce** management accounts and internal draft statutory schedules; label them unaudited/draft.
9. **Correct** any error through a linked reversal with a reason; never edit posted history.

## 2. Sales and receivables

- Create a customer and item master first.
- Invoice lines carry quantity, unit price, discount, tax category, revenue account and warehouse.
  VAT is calculated line by line by the server; the browser preview is not authoritative.
- Posting creates the customer AR open item, output VAT, revenue, stock issue and COGS in one
  transaction. It does **not** auto-settle.
- Record a separate receipt, allocate it to one or more invoices (partial receipts allowed), and keep
  unapplied cash visible until allocated.
- Credit notes are separate `M67` documents linked to the original invoice. They do not consume a
  Mushak 6.3 serial. A credit note cannot exceed the original line value/quantity.
- Reverse at document level. The reversal restores AR/stock and cannot be repeated.

## 3. Purchases and payables

- Record the supplier bill with the supplier’s actual invoice number and a user-supplied Mushak 6.3
  evidence reference where input VAT is claimed. The system never invents a supplier serial.
- Choose inventory or expense per line. Stock moves only when a bill with stock lines is posted; there
  is no fake GRN/three-way match screen.
- Missing/invalid supplier e-TIN affects TDS on the posted bill and the actual payment.
- Supplier payments allocate to one or more bills. Withholding liabilities are derived from the actual
  allocation. A high-value payment needs a different approver.
- Reverse a bill/payment through the controlled action; paid bills and duplicate reversals are
  rejected.

## 4. Treasury and withholding

- Pending VDS/TDS/reverse-charge liabilities come only from posted bills/payments.
- Deposit selected liabilities in a challan batch with bank/cash account, reference and evidence. The
  deposit posts Dr liability / Cr bank and marks the liabilities deposited atomically.
- Certificates are drafts derived exactly from the source liability. They are not editable; cancel and
  reissue with a reason.
- Reversing a deposit restores the liabilities and cancels linked draft certificates.
- The certificate format, rates and filing rules require professional verification before external use.

## 5. VAT schedule and reports

- Use the report period selector; never rely on a fixed month.
- The VAT sales register excludes reversed documents and shows credit notes as negative lines.
- The VAT 9.1 schedule is marked **DRAFT — NOT FILED**. It shows its GL proof and exceptions. Export is
  refused if a blocking check fails.
- Management accounts are labelled **Management accounts — unaudited**. There is no auditor’s opinion.
- Drill any statement line to the account, journals, source document, tax decision and audit trail.

## 6. Journals and corrections

- A journal must have at least two lines and exact equal debits/credits. The server rejects an
  unbalanced or zero-line journal.
- Use a real company account; inactive/unknown accounts are rejected.
- A posted journal is immutable. Use a linked reversal with a reason and the required approval. A
  journal can be reversed once; reversing a reversal is not allowed.
- High-value journals/reversals require maker-checker. The creator cannot approve their own item.
- Never “fix” a balance by posting to retained earnings without a documented, approved policy and tax
  review. Suspense resolution requires a target account and evidence.

## 7. Month-end control checklist

- Trial balance debits equal credits.
- Balance sheet balances and cash flow reconciles without a plug.
- AR and AP control proofs agree to the subledgers.
- Bank/MFS reconciliations are prepared and reviewed; unmatched lines have owners.
- Inventory valuation agrees to the inventory GL by item/warehouse.
- VAT current account agrees to the return schedule and GL.
- VDS/TDS payable agrees to pending/deposited liabilities and certificates.
- Suspense has an ageing queue and a resolution plan.
- All required approvals are complete and the close run is submitted by one user and approved by
  another.
- Exports/evidence are stored according to the company’s retention policy.

## 8. What the system does not do

- It does not file VAT returns, issue final statutory certificates or print a government receipt.
- It does not provide an audit opinion or an “audited” pack.
- It does not compute payroll in the production scope, and it does not implement fixed assets,
  purchase orders/GRN/three-way matching, or purchase debit notes.
- It does not replace professional judgement on tax treatment, rates, evidence or filing deadlines.
