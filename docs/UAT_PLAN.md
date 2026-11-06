# Accountant UAT plan and sign-off record

**Status: NOT EXECUTED.** No external accountant or tax counsel was available in the implementation
environment. This document is the controlled script for the human UAT; it is not evidence that UAT
passed.

## 1. Participants

| Role                              | Name                 | Organisation         | Date       | Signature  |
| --------------------------------- | -------------------- | -------------------- | ---------- | ---------- |
| UAT lead (accountant)             | ____________________ | ____________________ | __________ | __________ |
| Controller / checker              | ____________________ | ____________________ | __________ | __________ |
| Tax counsel (rule pack/templates) | ____________________ | ____________________ | __________ | __________ |
| Product owner                     | ____________________ | ____________________ | __________ | __________ |

Use a **staging** environment with synthetic or masked data. Never use a production company or real
personal data for UAT.

## 2. Prerequisites

- Staging deployment at a real HTTPS origin with the production build.
- PostgreSQL backup/restore drill passed and a rollback point recorded.
- A test organisation and company; at least two users (maker and checker) with different roles.
- A chart of accounts, one customer, one supplier, one stock item, one service item, one bank/cash
  account and an `OPEN` period.
- The tax pack reviewer record completed only if the reviewer is authorised to approve it; otherwise
  posting must remain blocked and that is the expected result.

## 3. Scenarios

Record PASS/FAIL, evidence (document/journal/report IDs), time taken and comments.

| #   | Role        | Scenario                                                                 | Expected result                                                                        | Result |
| --- | ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------ |
| 1   | Owner       | Sign in, accept invitation, verify email, reset password                 | No financial data before sign-in; reset revokes sessions                               | ☐      |
| 2   | Owner       | Create company, fiscal year, COA, opening batch, bank account            | Server persists; no reset of an existing company; opening batch balances before submit | ☐      |
| 3   | Accountant  | Create a draft sales invoice with two tax categories                     | Draft survives refresh; server computes line VAT; totals not client-authoritative      | ☐      |
| 4   | Controller  | Review and post the invoice                                              | One atomic posting; AR, revenue, VAT, stock/COGS, audit; no auto-settle                | ☐      |
| 5   | Accountant  | Record a partial customer receipt and allocate it                        | Invoice outstanding reduces; AR ageing and control proof agree                         | ☐      |
| 6   | Accountant  | Create a credit note linked to the invoice                               | Own `M67` series; no `M63` consumption; quantity/value limit; stock restored           | ☐      |
| 7   | Accountant  | Create a supplier bill with inventory and expense lines, valid evidence  | Correct input VAT/expense/inventory; AP open item; stock moves only for stock lines    | ☐      |
| 8   | Accountant  | Record a partial supplier payment                                        | AP reduces; VDS/TDS liabilities derive from actual allocation                          | ☐      |
| 9   | Controller  | Deposit withholding liabilities and create draft certificates            | One deposit; liabilities deposited; certificate amounts equal source liability         | ☐      |
| 10  | Accountant  | Import a bank statement, match lines, create a GL entry for an exception | No auto-post on import; no double match; maker-checker for create-GL                   | ☐      |
| 11  | Controller  | Prepare and review a bank reconciliation                                 | Different reviewer; difference shown; lock on period close                             | ☐      |
| 12  | Accountant  | Post a manual journal, then reverse it with a reason                     | Balanced posting; linked reversal; second reversal rejected; original immutable        | ☐      |
| 13  | Accountant  | Attempt to post into an unknown, closed and locked period                | All rejected with a clear code; nothing persisted                                      | ☐      |
| 14  | Accountant  | Post the same document twice / retry the same idempotency key            | One journal/document; duplicate rejected or original result returned                   | ☐      |
| 15  | Controller  | Close the period with a control difference                               | Close blocked; difference visible; no lock to hide it                                  | ☐      |
| 16  | Controller  | Resolve suspense with a target, reason, evidence and different checker   | Balanced linked journal; no one-click retained-earnings write-off                      | ☐      |
| 17  | Controller  | Close with all controls passing; second user approves                    | Period locks; maker ≠ checker; close evidence persisted                                | ☐      |
| 18  | Auditor     | Read reports, drill to evidence, attempt a mutation                      | Read-only; mutation rejected; export permission respected and audited                  | ☐      |
| 19  | Auditor     | Export a report and the audit log                                        | Totals agree; export audited; no cross-company data                                    | ☐      |
| 20  | Admin       | Invite users, change a company-scoped role, revoke a session             | Server-enforced; self-role change blocked; last owner protected                        | ☐      |
| 21  | Admin       | Switch companies / attempt cross-company access by ID                    | Only member companies visible; other company returns not-found                         | ☐      |
| 22  | All         | Switch English/Bangla on every touched screen                            | No missing visible labels; formatting correct; calculations unchanged                  | ☐      |
| 23  | All         | Complete the core journey with keyboard only at 360/768/1440             | Focus visible; no horizontal overflow; no working text below 12px                      | ☐      |
| 24  | Tax counsel | Review every rule/template and record source/reviewer/date               | Approved pack or explicit rejection; no unverified claim presented as final            | ☐      |
| 25  | Operator    | Run the backup/restore drill and migration rehearsal on staging          | Restore exact; rollback point documented                                               | ☐      |

## 4. Time-to-complete measures

| Measure                            | Target   | Actual   |
| ---------------------------------- | -------- | -------- |
| First invoice from a new company   | ________ | ________ |
| Receipt allocation                 | ________ | ________ |
| Manual journal + reversal          | ________ | ________ |
| Month-end close with support       | ________ | ________ |
| “What do I do next?” comprehension | ________ | ________ |

## 5. Defect log

| #   | Severity | Screen | Steps | Expected | Actual | Trace ID | Owner | Status |
| --- | -------- | ------ | ----- | -------- | ------ | -------- | ----- | ------ |
|     |          |        |       |          |        |          |       |        |

## 6. Sign-off

UAT is complete only when:

- every mandatory scenario is PASS or has an accepted, documented limitation;
- no critical/high accounting or security defect remains open;
- the tax counsel/accountant has signed the rule pack and statutory templates they are qualified to
  review;
- the participants sign below.

| Statement                     | Name                 | Decision          | Date       |
| ----------------------------- | -------------------- | ----------------- | ---------- |
| Accounting workflows accepted | ____________________ | ☐ Accept ☐ Reject | __________ |
| Tax/legal labels accepted     | ____________________ | ☐ Accept ☐ Reject | __________ |
| Release approved              | ____________________ | ☐ Go ☐ No-go      | __________ |

**Current sign-off: none. Release remains NO-GO.**
