# LedgerVault — Bangladeshi Accounting and Business ERP (prototype)

LedgerVault is a browser-only React/TypeScript prototype of a Bangladeshi accounting, VAT, treasury and business-management ERP. It contains a substantial accounting domain (double-entry journals, audit chain, VAT/VDS/TDS rules, financial statements, imports and audit packs), but it is **not yet a production accounting system**.

> **Data warning — do not enter real financial or personal data.** The current application keeps its entire books in this browser profile (`localStorage` plus an IndexedDB mirror). There is no server, login, multi-user access, company isolation, automatic backup or restore. Clearing site data, using private browsing or switching browsers can destroy the books. The app seeds synthetic demo data on first load. Phase 0 only establishes a safe engineering baseline; it does not make this prototype production-ready.

## Purpose

This repository is the working codebase for the productionisation programme described in:

- [`docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md`](docs/ERP_MASTER_AUDIT_AND_IMPLEMENTATION_PLAN.md)
- [`docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md`](docs/DEEPSEEK_PHASE_BY_PHASE_EXECUTION_PROMPTS.md)

The original product specification and workflow rules remain in [`SPEC.md`](SPEC.md) and [`WORKFLOW_BLUEPRINT.md`](WORKFLOW_BLUEPRINT.md). Where they disagree with the master plan, the master plan is authoritative.

## Stack

| Layer                     | Technology                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UI                        | React 18, TypeScript 5, Vite 5, Tailwind CSS 3                                                               |
| Domain                    | Pure TypeScript modules under `src/core` (bigint poisha, ledger, tax engine, IFRS statements, import/export) |
| Prototype persistence     | Browser `localStorage` + IndexedDB snapshot                                                                  |
| Spreadsheet import/export | SheetJS (`xlsx`)                                                                                             |
| Unit tests                | Vitest 3                                                                                                     |
| Lint / format             | ESLint 10 + typescript-eslint 8, Prettier 3                                                                  |
| CI                        | GitHub Actions (`.github/workflows/ci.yml`)                                                                  |

## Prerequisites

- Node.js `^20.19.0`, `^22.13.0` or `>=24.0.0` (required by ESLint 10)
- npm 10+ (the repository uses lockfile version 3)
- Git

The verified local baseline used Node.js 24.7.0 and npm 11.5.1.

## Install

```bash
npm ci
```

Use `npm ci` for a reproducible install from `package-lock.json`. Use `npm install` only when intentionally changing dependencies, and commit the updated lockfile.

## Run locally

```bash
npm run dev
```

Vite serves the app at <http://localhost:5173> and opens it in the default browser. The first load creates the synthetic APEX seed dataset.

## Build and preview

```bash
npm run build
npm run preview
```

`npm run build` runs the application typecheck and then creates a production bundle in `dist/`.

## Quality commands

| Command                    | What it does                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | Typechecks application source and the `tests/` suite                                                |
| `npm run lint`             | Runs ESLint over the repository (0 errors required; existing warnings are recorded in the baseline) |
| `npm run format:check`     | Checks Prettier formatting for tests, tooling, CI and documentation                                 |
| `npm run format`           | Writes Prettier formatting for the same scoped set                                                  |
| `npm test`                 | Runs the Vitest suite once                                                                          |
| `npm run test:watch`       | Runs Vitest in watch mode                                                                           |
| `npm run selfcheck`        | Runs the existing domain self-checks (core ledger, actions, import, gate) through esbuild           |
| `npm run selfcheck:render` | Runs the legacy server-render smoke script (known stale; see the baseline)                          |
| `npm run build`            | Typechecks and builds the production bundle                                                         |

`npm run format:check` currently excludes the existing `src/`, `scripts/` and legacy root configuration from formatting. Reformatting them would create a large unrelated diff; a dedicated formatting-only change should widen the gate later. ESLint still analyses all application and script source.

## Existing domain self-checks

The original self-check scripts are preserved unchanged and are now runnable through npm:

- `npm run selfcheck:core` — seed ledger balance, audit chain, subledger reconciliation and financial statements.
- `npm run selfcheck:actions` — serial allocation, sale/purchase journals, reversal, locked periods, unbalanced journals, unknown accounts and idempotency.
- `npm run selfcheck:import` — import dry runs, commit safety and audit-pack export.
- `npm run selfcheck:gate` — consolidated engine gate, including all 25 golden tax vectors.

These scripts are bundled with the esbuild binary already supplied by Vite; they are not part of the application bundle. Generated `.xlsx` audit packs are written under `scripts/` and are git-ignored.

The older `scripts/smoke-render.ts` uses obsolete workspace keys (`cockpit`, `ledger`, …) instead of the current `W01`–`W12` keys, so it fails against the current UI. It is retained for history and labelled in the baseline. The maintained render smoke test is `tests/render-smoke.test.ts`.

## Environment

The current application reads no environment variables and has no server or API configuration. Do not commit `.env` files; `.gitignore` excludes them. If future phases introduce configuration, add a documented `.env.example` with non-secret defaults.

The page also requests Google Fonts from `fonts.googleapis.com`. Offline use falls back to locally available fonts.

## Demo data, persistence and data safety

- On first load, `VaultProvider` builds and persists the APEX seed dataset. Demo personas and synthetic parties are defined in `src/core/ledger/seedData.ts`.
- The complete vault snapshot is written to `localStorage` under `ledgervault.v2.vault` and mirrored to IndexedDB database `ledgervault.vaultdb`.
- The UI includes a local `.vault.json` export/import path for prototype hand-offs. It is not an accounting-grade backup and must not be used for real books.
- No screen in this prototype is certified for real financial records. Treat all visible data as synthetic until the server-authoritative phases replace browser storage.
- Generated audit packs, vault exports and build output are excluded from Git. Never commit real customer or financial data.

## Repository layout

```text
src/
  core/                 Pure domain: money, types, ledger, tax engine, IFRS, import/export, storage
  context/              VaultProvider and prototype actions
  components/           Shell, auth/onboarding, commercial and signature UI
  workspaces/           W01–W12 workspace views and registry
scripts/                Legacy domain self-checks and render smoke script
tests/                  Vitest smoke, golden-suite, seed-ledger and render tests
docs/                   Master audit/plan, phase prompts, baseline and implementation notes
.github/workflows/      GitHub Actions CI
```

## Baseline and phase records

- [`docs/BASELINE.md`](docs/BASELINE.md) records the exact pre-change build, self-check, golden-suite, test and audit results, including the known legacy render-smoke failure.
- [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md) is the template for phase completion reports.
- `build.log` is a historical local artifact from an earlier build and is intentionally git-ignored; it is not the current baseline.

## License and ownership

**License status: undecided.** No open-source or commercial licence is granted by this repository. The human owner must confirm copyright ownership, the licence and distribution terms before sharing or deploying the code. Do not assume this project is open source.

## Current limitations

This phase deliberately does not add authentication, a server, a database, tenant isolation, migrations or production deployment. Those arrive in later phases. See the master plan for the full gap list and phase order.
