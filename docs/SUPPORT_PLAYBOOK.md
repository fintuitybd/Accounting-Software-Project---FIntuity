# Support playbook

## 1. Principles

- Support may explain and guide. Support must not edit posted journals, delete audit events, change
  balances in SQL or bypass period/approval controls.
- Never ask a customer to send a password, session cookie, CSRF token or full database dump.
- Financial corrections use a linked reversal with a reason and the required approval.
- Record every data-changing support action in a ticket and, where the application supports it, in the
  audit log with the customer's authorisation.

## 2. First-line triage

Collect:

1. Company name and company ID (never the full database URL).
2. User email and role.
3. UTC/local time of the incident, screen name and document/journal number.
4. The `x-request-id` from the failing response or browser network tab.
5. The exact error code/message shown; a screenshot of the form is useful but must not include
   unnecessary personal data.
6. Whether the action was attempted once or retried, and the idempotency key if visible in logs.

Do **not** collect passwords, full session cookies, MFA codes, full bank account numbers or NID images.

## 3. Common issues

### Cannot sign in

- Confirm the invitation was accepted and the email is verified.
- Check whether the account is locked after repeated failures; wait for the configured lock window.
- Use the neutral forgot-password flow. Support cannot read or set a password.
- If `SESSION_EXPIRED`, sign in again. If cross-company access is denied, verify membership in
  **Team & access**; do not change company IDs manually.

### Invitation or reset link fails

Links are single-use and expire. An owner/admin can resend an invitation. A reset link cannot be
reused after a successful reset. Check the configured email provider; the development `file` outbox
does not deliver mail.

### Permission denied

- The API is authoritative. The UI only hides actions.
- Check the user's company-scoped role and the required permission in `docs/ADMIN_GUIDE.md`.
- Auditor is read-only and can export where permitted.
- Do not grant Owner/Admin to work around a workflow problem without the customer's approval.

### Posting rejected

| Code/theme                        | Meaning                                                             | Action                                                              |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `PERIOD_UNKNOWN`                  | No configured period covers the date                                | Configure the fiscal year/period or choose a valid date             |
| `PERIOD_CLOSED` / `PERIOD_LOCKED` | Period does not allow normal posting                                | Use a correction in an open period or the controlled reopen process |
| `UNBALANCED`                      | Debits and credits differ                                           | Correct the lines; never force the total                            |
| Unknown/inactive account          | Account is outside the company COA or inactive                      | Choose an active company account                                    |
| Duplicate idempotency/posting     | The request was already committed or the document is already posted | Refresh and inspect; do not retry with a new key blindly            |
| Tax pack not approved             | Posting requires a recorded reviewer approval for the exact pack    | Complete the tax-policy approval process; do not bypass it          |
| Missing evidence/Mushak 6.3       | Purchase input VAT cannot be claimed                                | Obtain and record the supplier evidence; never invent a serial      |

### Import problems

- Use the documented CSV template or a worksheet with the expected headers.
- The API accepts at most 1 MiB per request; the browser rejects files over 1 MB and sheets over 5,000
  rows. Split large files.
- Invalid/duplicate rows are reported; import never posts a journal. Review the preview before commit.
- Retained source content and hashes are evidence; do not delete the import batch to hide a mistake.

### Report does not agree

1. Confirm the company, branch, period and comparative period shown in the report header.
2. Check for reversed documents and later-period reversals/VAT timing variances.
3. Open the drill-down and journal evidence.
4. Run the control proof (AR, AP, VAT, treasury, inventory, bank reconciliation).
5. If a blocking check fails, export is intentionally refused. Do not export a known-bad report as
   final. Escalate with the report scope and trace ID.

### Close blocked

Read the checklist exception. Resolve the underlying control difference; do not lock the period to
hide it. Suspense resolution requires a named target account, evidence, a reason and a different
checker. Reopen requires the `REOPEN_PERIOD` permission and a reason.

### Backup/restore

Follow `docs/OPERATIONS.md`. Support must not restore over the live database. A restore is a controlled
incident action with an approver and a data-loss window.

## 4. Escalation

| Severity | Example                                                                         | Target response                             |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| P1       | Suspected cross-tenant access, data loss, unauthorised posting, production down | Immediate; incident lead and security owner |
| P2       | Posting/close blocked for a company, backup failed, export leaking data         | Within the support SLA; engineering on call |
| P3       | Single-user access issue, report question, import validation                    | Next business day                           |
| P4       | Cosmetic/localization suggestion                                                | Backlog review                              |

Escalate immediately for any suspected data exposure. Preserve logs and audit events; do not delete
evidence.

## 5. Customer communication

- State what is known, what is not known and the next update time.
- Do not claim a legal/tax position or that a return was filed. The product prepares drafts; filing is
  outside the system until verified and confirmed by the customer.
- Do not claim “production-ready”, “audited”, “NBR-approved” or “bank-grade”.
- Confirm destructive actions in writing, including the consequence and the backup/restore point.

## 6. Useful commands (operator only)

```bash
npm run migrate:status
npm run drill:backup-restore
npm run check:built-security
npm run check:secrets
curl -sS http://127.0.0.1:3000/health
```

Never run `db:reset:dev` against production or a shared database.
