# Implementation Notes

This is the working template for phase completion reports. The two master documents remain
authoritative:

- `docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md`
- `docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md`

Copy the structure below into the phase report or into a new dated note. Record commands that were
actually run, their real exit status and the evidence produced. If a check was not run, say so and
explain why. Never describe planned work as completed and never claim a feature works because a
screen renders.

---

## PHASE COMPLETION REPORT

**Phase:** `<number and title>`

**Status:** `COMPLETE | BLOCKED | PARTIAL`

**Summary:** `<what was implemented, in plain language>`

**Files changed:**

- `<path>` — <one-line reason>

**Database/migrations:** `<none, or migration names and what they change>`

**Commands run and actual results:**

- `<command>` → exit `<status>`; <key output or reason not run>

**Acceptance criteria:**

- `<criterion>`: `PASS | FAIL | PARTIAL` — <evidence>

**Tests added/updated:**

- `<test file or command>` — <what it proves>

**Security/accounting review notes:** <authorization, tenant scope, posting, idempotency, reversal,
audit, money precision, period handling>

**Known limitations:** <anything not done or not verified>

**Manual or external decisions required:** <tax counsel, accountant, hosting, legal, licensing,
CI provider, etc.>

**Next-phase dependency verified:** `YES | NO` — <how the dependency was inspected or exercised>

**Blocker (if any):** <exactly what is missing and what decision is needed>

---

## Phase record index

| Phase | Title                             | Status   | Evidence                                       |
| ----- | --------------------------------- | -------- | ---------------------------------------------- |
| 0     | Repository readiness and baseline | COMPLETE | `docs/BASELINE.md`, `.github/workflows/ci.yml` |
