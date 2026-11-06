# Administrator guide

**Audience:** organisation owners and administrators. This guide describes the implemented
server-backed application. It does not replace accounting/tax advice, and it does not claim statutory
certification.

## 1. First setup

1. Sign in at `/login` with the invited email and a password of at least the configured minimum.
2. Complete email verification if prompted.
3. An organisation owner opens **Setup** and creates the first company:
   - legal identity, trade name, entity type, industry and reporting framework;
   - TIN/BIN/RJSC references (format checks only, not statutory validation);
   - registered address, phone/email;
   - fiscal year start/end and monthly periods (explicit `OPEN` status);
   - chart of accounts (typed/manual or CSV/XLSX import, up to 5,000 rows / 1 MB);
   - opening balances as a **DRAFT** batch with evidence; submit/approve/post through the controlled
     workflow, never by editing account master balances;
   - bank/cash/MFS accounts with a `BANK_MFS` GL mapping and one principal account;
   - company settings (language, approval thresholds, numbering, tax configuration).
4. Invite the finance team from **Team & access**. Use company scope and the least-privilege role.

## 2. Roles and separation of duties

| Role       | Typical use                               | Key restrictions                                       |
| ---------- | ----------------------------------------- | ------------------------------------------------------ |
| Owner      | Organisation ownership                    | Only an Owner can grant Owner; last Owner is protected |
| Admin      | Company and user administration           | Cannot grant Owner; cannot change own role             |
| Controller | Review, approve, close, reverse           | Cannot approve own high-value item                     |
| Accountant | Draft and post routine documents/journals | Cannot approve high-value items or manage users        |
| Operator   | Create drafts / operational entry         | Cannot post to the GL or approve                       |
| Auditor    | Read and export evidence                  | Read-only; cannot mutate                               |

The server enforces the matrix. The UI only hides actions. If a user needs more access, change their
company membership deliberately and record why; do not share accounts.

## 3. Periods and close

- Periods are explicit. A missing period rejects posting; a `CLOSED` or `LOCKED` period rejects normal
  posting.
- Close is a persisted run: checklist, evidence, maker and a different checker. A blocking control
  difference must be resolved, not overridden.
- Approval locks the period. Reopening requires the separate `REOPEN_PERIOD` permission and a reason;
  the old close run remains in history and a new run is required before locking again.
- Do not use the close process to hide a reconciliation difference.

## 4. Approvals

- High-value thresholds are company settings. At or above the threshold, the creator cannot approve.
- Supplier payments above the threshold create a pending approval request; a different authorised
  user must approve or reject it.
- Reversals and sensitive corrections require permission, a reason and the configured approval.
- Record the business reason and evidence reference. The audit log records actor, time, action and
  entity; it is append-only.

## 5. Users and invitations

- Invitations are single-use, expire and are stored hashed.
- Resend/revoke an invitation instead of creating a duplicate user.
- A non-owner/admin role must be scoped to a company.
- Session management lets a user revoke other sessions. A password reset revokes sessions.
- Production email delivery must be configured before invitations/resets work for real users; the
  development outbox is not delivery.

## 6. Exports, backups and data protection

- Exports require `EXPORT_DATA` and are audited. Treat every export as confidential financial data.
- There is no full-vault export in server-backed mode. The `.vault.json` export is demo-only.
- Backups are an operator responsibility. See `docs/OPERATIONS.md`; a backup is not valid until a
  restore is tested.
- Never send a database dump, session cookie or password to support. Use the request ID and document
  references.
- Retention/deletion obligations require legal review; do not delete audit events or posted history.

## 7. What administrators must not do

- Do not edit the database directly to change a balance, status or period.
- Do not delete or rewrite posted journals, audit events or close evidence.
- Do not disable the tax-pack approval requirement or invent a Mushak serial/rate.
- Do not switch on demo mode in a production deployment or restore demo data into a real company.
- Do not claim a return/certificate was filed because it was printed or exported.

## 8. Support checklist

When raising a ticket, include company ID, user email/role, time, screen, document/journal number, the
exact error code and the `x-request-id`. Do not include passwords, cookies or unnecessary personal
data.
