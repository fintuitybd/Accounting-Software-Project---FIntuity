# Engineering Baseline — Phase 0

Recorded: 2026-11-06
Repository: `C:\Fintuity\Accounting Software Project - Copy`
Baseline source commit: `22441fe` (`chore: initial repository baseline`)

This file records what the repository actually did before Phase 0 tooling was added. It is evidence,
not a claim that the prototype is production-ready. No result below was inferred or fabricated.

## Environment

| Item                  | Value                                       |
| --------------------- | ------------------------------------------- |
| OS                    | Windows (`win32`)                           |
| Node.js               | 24.7.0                                      |
| npm                   | 11.5.1                                      |
| TypeScript (resolved) | 5.9.3                                       |
| Vite (resolved)       | 5.4.21                                      |
| React / React DOM     | 18.3.1                                      |
| xlsx                  | 0.18.5                                      |
| Git                   | 2.56.0.windows.4 (installed during Phase 0) |

At the start of Phase 0 the folder was not a Git repository and `git` was not on `PATH`.

## Build baseline

Command: `npm run build`

Result: **exit 0**

```text
vite v5.4.21 building for production...
✓ 1979 modules transformed.
dist/index.html                     2.63 kB │ gzip:   1.27 kB
dist/assets/index-C2sIt5dN.css    121.30 kB │ gzip:  20.31 kB
dist/assets/index-BB3YPjK_.js   1,905.51 kB │ gzip: 582.87 kB
✓ built in 13.93s
```

Vite emitted a chunk-size warning because the main JS chunk exceeds the configured 1,600 kB
warning limit. This is a known prototype performance issue, not a Phase 0 regression.

The pre-existing `build.log` is stale: it records 1,974 modules, a 1,557.04 kB JS chunk and 483.06
kB gzip from an earlier source state. It is now git-ignored; this document supersedes it as the
current baseline.

## Domain self-check baseline

Command: `npm run selfcheck` (runs the four scripts below in sequence)

Result: **exit 0**

### `npm run selfcheck:core`

- 62 seeded journals, 17 commercial documents, 6 challans.
- Every seeded journal is balanced, has at least two lines and a positive debit.
- Ledger total: 14,049,502,935 poisha debit and credit.
- Audit chain valid over 62 journals; a one-poisha tamper breaks the chain.
- All six control accounts reconcile with difference 0.
- Suspense balance surfaced: 28,500,000 poisha.
- `STATUTORY_BD`, `ALL_IFRS_BOOKS` and `TAX_COMPUTATION` statements all balance and reconcile.

### `npm run selfcheck:actions`

- 22 assertions passed.
- Mushak 6.3 serial allocation: next Dhaka serial `M63-2026-00006`; Chattogram series starts at
  `M63-2026-00001`; Dhaka series gap-free through 5.
- Sale and purchase document/settlement journals balance; output VAT 3,750,000 poisha on the test
  sale; net payable equals gross − VDS − TDS.
- Runtime posting, linked reversal, locked-period rejection, unbalanced-journal rejection,
  unknown-account rejection and idempotency all pass.
- Final chain verifies over 65 journals.

### `npm run selfcheck:import`

- Four pipelines exercised: `SALES_PURCHASE`, `BULK_JOURNAL`, `OPENING_BALANCE`, `BANK_MFS`.
- Each produces 25 rows with a mix of valid and rejected rows; valid rows are committed to a scratch
  ledger and the chain, statements and subledger proofs survive.
- Audit pack exported: 161.2 KB, all 9 tabs, containing real worksheet data.

### `npm run selfcheck:gate`

- 29 checks passed, including all 25 golden tax vectors (`25/25`).
- Audit chain valid over 62 journals; six control proofs; IAS 1 balance sheet balanced (imbalance
  0); IAS 7 cash flow reconciles (difference 0); IFRS 18 subtotal 2 and Adjusted EBITDA reconcile.
- 7 notes to the financial statements built.
- 9-tab audit pack written (161 KB).
- Final line: `ALL CHECKS PASSED`.

## Test and static-check baseline

| Command                | Result | Notes                                                                                                  |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`    | exit 0 | Application source and `tests/` typecheck                                                              |
| `npm test`             | exit 0 | 4 test files, 23 tests passed                                                                          |
| `npm run lint`         | exit 0 | 0 errors, 47 pre-existing warnings (unused locals and hook dependencies)                               |
| `npm run format:check` | exit 0 | Scoped to tests, tooling, CI and documentation; existing `src/` and `scripts/` are excluded in Phase 0 |
| `npm run build`        | exit 0 | Same build evidence as above                                                                           |

The Vitest suite added in Phase 0 covers:

- money parsing, basis-point rounding, lakh/crore formatting and SHA-256 vectors;
- all 25 golden tax vectors;
- seed-ledger balance, audit-chain tamper detection, six subledger reconciliations and all three
  statement book filters;
- server-render smoke for all twelve current workspace keys (`W01`–`W12`).

## Known baseline failure — legacy render smoke

Command: `npm run selfcheck:render`

Result: **exit 1 — pre-existing failure, not caused by Phase 0**

The script renders 91 KB of markup for five attempts and reports no crash and no literal
`undefined`, but 13 content assertions fail:

- cockpit: `Subledger control proof`, `Cash, bank`
- ledger: `Immutable journal register`, `Double-entry inspector`, `Post a transaction`
- statements: `IAS 1 balance sheet`, `Trial balance`, `TOTAL ASSETS`
- import: `Dry-run simulator`, `Load 25-row demo batch`, `Download .xlsx audit pack`
- rulepack: `LedgerVault Core Lab`, `Golden vectors`

Root cause: `scripts/smoke-render.ts` passes obsolete workspace keys (`cockpit`, `ledger`,
`statements`, `import`, `rulepack`). The current `WorkspaceKey` union is `W01`–`W12`, and
`src/App.tsx` falls back to `W01_ExecutiveCockpit` for an unknown key, so every attempt renders the
default cockpit. The maintained `tests/render-smoke.test.ts` uses the valid keys and passes all
twelve workspaces.

The legacy script and its assertions were deliberately left unchanged in Phase 0. It is not part of
the CI gate. It should be repaired or retired in a later test-focused change.

## Dependency audit baseline

Command: `npm audit`

Result: **exit 1 — 16 vulnerabilities (12 moderate, 2 high, 2 critical)**

| Package                                    | Severity | Scope                   | Status                                                                                                                             |
| ------------------------------------------ | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `xlsx`                                     | high     | Production dependency   | No npm fix available; SheetJS prototype pollution and ReDoS advisories. Requires a later, separately reviewed dependency decision. |
| `tinypool` (via Vitest)                    | critical | Development/test only   | Audit proposes Vitest 5, which requires a Vite major upgrade; deferred beyond Phase 0.                                             |
| `@vitest/mocker` (via Vitest)              | moderate | Development/test only   | Same Vitest major-upgrade constraint.                                                                                              |
| `esbuild` (via Vite 5)                     | moderate | Development server only | Fix requires a Vite major upgrade; deferred beyond Phase 0.                                                                        |
| `minimatch` (via ESLint/typescript-eslint) | moderate | Development tooling     | Tooling-only denial-of-service advisory; deferred pending compatible updates.                                                      |

No production application behaviour or UI was changed in Phase 0. No secrets, local vault exports,
generated audit packs, `node_modules` or `dist` were committed.

## Reproducing this baseline

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run selfcheck
npm run build
npm run selfcheck:render   # expected to fail until the legacy script is repaired
```
