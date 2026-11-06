PHASE COMPLETION REPORT
Phase: 13 — Public landing page and design system foundation
Status: COMPLETE (production launch still requires the external legal, domain and commercial decisions listed below)

Summary: A public marketing site now exists at `/` with a separate lazy entry that does not load the financial workspaces or ledger engine. It presents an honest, bilingual product story: the problem, implemented server-backed workflows, capabilities, Bangladesh fit, controls, audience, onboarding, sales-led contact, FAQ and legal limits. The site uses a new Quiet Ledger token system, self-hosted Inter and Noto Sans Bengali fonts, no customer logos/testimonials/certifications and no invented price list. Real screenshots from the server-backed sales and reporting flows are included with synthetic test data and explicit captions; the unverified tax-counsel label was cropped out. Login, forgot-password, reset, invitation and session-expired pages use the same tokens and real Phase 3 server flows, and the authenticated shell is a separate lazy chunk so auth pages do not download the workspaces. An internal noindex `/design` gallery documents and demonstrates the tokens and components. A public walkthrough-request API stores leads in a rate-limited, write-only `demo_requests` table. The production landing build measured Lighthouse 0.99 performance, 1.00 accessibility, 1.00 best practices and 1.00 SEO, with LCP 2.0s; the production login measured 0.98 performance, 1.00 accessibility, LCP 2.3s.

Files changed:

- `index.html` — landing metadata, canonical/Open Graph/JSON-LD, self-hosted font preload, quiet favicon, removed the Google Fonts request.
- `src/main.tsx` — public marketing and authenticated app are separate lazy entries; a visitor on `/` does not download the app bundle.
- `src/App.tsx` — now the auth-only route shell; the authenticated shell is lazy-loaded after a valid session.
- `src/ErpShell.tsx` — authenticated shell/providers/workspaces moved into their own lazy chunk.
- `src/workspaces/views.ts` — static workspace registry shared by the lazy shell and render tests.
- `src/index.css` — Quiet Ledger `--ql-*` tokens, self-hosted `@font-face`, `ql-*` primitives, semantic typography/focus/motion rules.
- `tailwind.config.js` — `ql` colours, fonts, radius, shadows, breakpoints and motion tokens.
- `vite.config.ts` — `VITE_PUBLIC_SITE_URL` replacement and production warning.
- `.env.example` — documents `VITE_PUBLIC_SITE_URL`.
- `src/marketing/MarketingApp.tsx` — public router/shell, locale persistence, skip link, responsive menu, lazy secondary pages.
- `src/marketing/content.ts` — English/Bangla marketing copy and honest limitations.
- `src/marketing/marketing.css` — marketing layout, responsive grids, product frame, FAQ and footer.
- `src/marketing/usePageMeta.ts` — deterministic title/description/canonical/OG/robots updates.
- `src/marketing/icons.tsx` — small local functional icons so the landing does not pull Lucide into first paint.
- `src/marketing/components/ProductFrame.tsx` — design-system product preview with balanced sample journal.
- `src/marketing/components/DemoRequestForm.tsx` — accessible walkthrough form with real API submission.
- `src/marketing/api.ts` — typed public demo-request client.
- `src/marketing/pages/LandingPage.tsx` — full landing page and real product screenshots.
- `src/marketing/pages/SecurityPage.tsx` — specific security controls and explicit non-claims.
- `src/marketing/pages/ContactPage.tsx` — sales-led contact page.
- `src/marketing/pages/LegalPage.tsx` — software/statutory/demo/privacy notice with pending-review disclosure.
- `src/marketing/pages/DesignSystemPage.tsx` — internal `/design` token and component gallery.
- `src/marketing/pages/NotFoundPage.tsx` — public 404.
- `src/components/brand/LedgerMark.tsx` — flat Quiet Ledger brand mark for public/auth surfaces.
- `src/components/ui/Dialog.tsx` — accessible dialog with focus trap, Escape close, focus restore and body lock.
- `src/pages/auth/AuthLayout.tsx` — Quiet Ledger auth layout, document title/robots/lang, accessible language/theme controls.
- `src/pages/auth/LoginPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `AcceptInvitationPage.tsx`, `VerifyEmailPage.tsx`, `SessionExpiredPage.tsx` — token classes and accessible labels; real server flows unchanged.
- `public/fonts/` — self-hosted Inter and Noto Sans Bengali WOFF2 plus SIL OFL 1.1 licence files.
- `public/marketing/logo.png`, `og-cover.jpg`, `screens/sales-lines.jpg`, `screens/reports-unaudited.jpg` — brand/share assets and real server-backed screenshots with synthetic data.
- `public/robots.txt` — public-site crawl rules; authenticated/auth routes and `/design` disallowed.
- `server/migrations/0012_public_demo_requests.up.sql` — `demo_requests` table, checks, indexes and updated-at trigger.
- `server/migrations/0012_public_demo_requests.down.sql` — refuses to drop the table while any request exists.
- `server/src/routes/public.ts` — public write-only demo-request endpoint with validation and PostgreSQL rate limiting.
- `server/src/app.ts` — registers the public route.
- `server/src/db/schema.ts` — typed `demo_requests` binding.
- `server/tests/integration/public.test.ts` — demo-request validation, storage, no-PII response, rate limit and no-public-read tests.
- `server/tests/integration/migrations.test.ts` — includes migration 0012 in apply/rollback/reapply assertions.
- `tests/marketing.test.ts` — landing content, CTA/link, screenshot labels and no-unverified-claim assertions.
- `docs/DESIGN_SYSTEM.md` — token, typography, spacing, component, accessibility, performance and content contract.
- `docs/PHASE_13_REPORT.md` — this report.
- `README.md`, `server/README.md`, `docs/IMPLEMENTATION_NOTES.md` — Phase 13 routes, migration, design-system link and phase record.

Database/migrations: `0012_public_demo_requests` adds the `demo_requests` table. It is deliberately outside organisation/company scope because a lead is not a financial record. The table contains name, work email, company, optional message, status (`NEW`/`CONTACTED`/`CLOSED`), source (`landing`/`contact`) and timestamps, with length/format/status/source checks, two indexes and a `set_updated_at` trigger. The down migration refuses to run while any demo request exists.

Commands run and actual results:

- `npm run typecheck` → exit 0; frontend, test and server TypeScript all pass.
- `npm run lint` → exit 0; 0 errors, 44 warnings (all pre-existing workspace hook/unused-symbol warnings; no new warnings in Phase 13 files).
- `npm test` → exit 0; 8 files, 47 tests passed.
- `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run test:server` → exit 0; 26 files, 156 tests passed, including the new public demo-request, origin-enforcement and migration 0012 apply/rollback/reapply tests.
- `npm run build` → exit 0; Vite production build completed. Landing chunks: `index` 49.81 KB gzip, `MarketingApp` 19.33 KB gzip, `LedgerMark` 15.83 KB gzip; the auth entry is 53.61 KB gzip and the authenticated `ErpShell` chunk is 637.90 KB gzip lazy. `/` does not request the auth or ErpShell chunks. Existing large-chunk warning only for `ErpShell`.
- `npm run format:check` → exit 0; all matched files use Prettier style.
- `npm run selfcheck` → exit 0; all domain, ledger, tax, import and gate checks passed, including 25/25 golden tax vectors and the 9-tab audit pack.
- `npx lighthouse@12.8.2 http://127.0.0.1:4173/ --only-categories=performance,accessibility,seo,best-practices --chrome-flags="--headless=new --no-sandbox"` → performance 0.99, accessibility 1.00, best practices 1.00, SEO 1.00; FCP 1.5s, LCP 2.0s, CLS 0, TBT 70ms.
- `npx lighthouse@12.8.2 http://127.0.0.1:4173/login --only-categories=performance,accessibility` → performance 0.98, accessibility 1.00; FCP 1.6s, LCP 2.3s, CLS 0, TBT 30ms.
- Lighthouse on `/design`, `/security` and `/legal` → accessibility 1.00, best practices 1.00, SEO 1.00 on each.
- Browser/CDP responsive checks at 360px, 768px and 1440px → `documentElement.scrollWidth` equal to viewport width at each width; no horizontal page overflow.
- Browser E2E → real login against the API and PostgreSQL succeeded and redirected to `/app`; forgot-password UI returned the neutral success message; a valid invitation token rendered the organisation, masked email, role and expiry with the password form; the landing walkthrough form returned "Request received" and wrote a row to `demo_requests`; the language toggle switched the landing to Bangla (including `document.lang`) and back to English.
- Keyboard checks → skip link focused and navigated to `#main-content`; dialog focus moved inside the dialog, Escape closed it and focus returned to the trigger; mobile menu at 360px expanded with seven links.
- `npm audit --omit=dev` → exit 1; only the pre-existing `xlsx` high advisory remains (no fix available). No dependency was added by this phase.

Acceptance criteria:

- Landing page is live and honest: PASS — production build served at `http://127.0.0.1:4173/`; all sections present; no customer logos, testimonials, certifications, audit opinions or prices; legal/statutory/demo limits stated; real screenshots labelled "Synthetic test data". Deployment itself remains an external hosting decision.
- Auth pages work and are accessible: PASS — login, forgot-password and invitation pages exercised against the real Phase 3 API/PostgreSQL; Lighthouse accessibility 1.00 on `/login`; labels, focus, errors and language/theme controls present.
- Design tokens and core components are documented and used: PASS — `docs/DESIGN_SYSTEM.md`, `ql-*` tokens/primitives, `/design` gallery, marketing and auth surfaces use the tokens; no raw hex in new components.
- No fake claims/content: PASS — automated test rejects Independent Auditor, bank-grade, NBR-approved, Big-4 and 100% compliant claims; security page explicitly lists non-claims; legal page states formal terms/privacy/company details are pending review; screenshots crop out the unverified tax-counsel label.
- Performance/accessibility targets met for public/auth pages: PASS — Landing Lighthouse 0.99/1.00/1.00/1.00 with LCP 2.0s; login 0.98 performance/1.00 accessibility with LCP 2.3s; CLS 0; 360/768/1440 no horizontal overflow.
- Existing app still runs (even if not yet restyled): PASS — server-backed sales, reports, banking and close pages loaded with real data; full app tests, server tests, self-checks and build pass.

Tests added/updated:

- `tests/marketing.test.ts` — renders the landing, security and legal pages; checks CTAs/links, screenshot labels and the absence of unverified audit/certification/security claims.
- `server/tests/integration/public.test.ts` — valid request storage, response without contact details, strict validation, source, configured-origin enforcement, one-IP rate limit, 429 envelope and no public read endpoint.
- `server/tests/integration/migrations.test.ts` — migration 0012 apply, table/index presence, rollback/reapply and updated expected counts.

Security/accounting review notes:

- Authorization/tenant scope: `POST /api/v1/public/demo-requests` is intentionally public and not company-scoped; it contains contact details only, never financial records. There is no public read endpoint. All existing company routes remain unchanged and server-authorised.
- CSRF/session: the public form has no session and therefore no CSRF token; it is rate-limited by IP and accepts only a strict Zod-validated JSON object. The public mutation still passes the configured `APP_ORIGIN` same-origin check, so a foreign browser origin receives `403 ORIGIN_NOT_ALLOWED`. Authenticated auth mutations retain the Phase 3 HTTP-only session, CSRF and same-origin checks.
- PII: the table stores only the submitted name, work email, company, optional message and server-set source/status. It does not store the request IP or user agent; logs record only the request id, demo-request id and source, never the contact fields. The form warns against financial records, passwords or sensitive personal data.
- Posting/idempotency/reversal: no ledger, journal, period, document or posting code was changed. Demo-request creation is a single insert; duplicate submissions create separate leads rather than touching financial state. The existing posting/idempotency/reversal invariants are untouched and still covered by the server suite.
- Money: marketing sample amounts are presentation-only and clearly labelled sample data; the application remains bigint poisha and server-authoritative. No client-supplied total, tax, status or balance was introduced.
- Audit: no organisation/actor exists for an anonymous lead, so no `audit_events` row is written; the server log records the request id and demo-request id only. The public table is not exposed for reads.
- SEO/security headers: the API keeps its existing security headers. The static marketing shell still needs production CSP/HSTS/referrer/permissions headers at the hosting/reverse-proxy layer; that remains a deployment task.

Known limitations:

- No production deployment. `VITE_PUBLIC_SITE_URL` must be set to the real HTTPS origin; the local build intentionally falls back to `http://localhost:5173` and emits a warning. Hosting, TLS, CDN, caching and static security headers are not configured.
- Formal legal terms, a full privacy policy, the legal entity name, registered address, trade licence and direct contact details are pending legal review. The `/legal` page states this and does not invent them.
- Pricing is sales-led and unpublished. No plan names or prices were invented.
- Demo-request notification/CRM delivery and an internal lead-review UI are not implemented. Requests are stored in PostgreSQL and must be monitored operationally; a formal retention schedule is pending legal review.
- The marketing pages are client-rendered React with static metadata and a `<noscript>` summary. Lighthouse SEO is 1.00, but a crawler that does not execute JavaScript sees only the noscript summary. Server-side pre-rendering would be a later improvement.
- The real screenshots show the current legacy Lumen workspaces; the Quiet Ledger workspace migration is Phase 14. They are labelled synthetic test data and the unverified "External Tax Counsel" label was cropped out.
- There is no automated browser E2E harness in the repository. Login, forgot-password, invitation, dialog, mobile menu, skip link and demo-request flows were exercised through the in-app browser/CDP.
- `/design` is reachable by URL in production but is `noindex,nofollow` and unlinked. If it must be internal-only, add authentication or a deploy-time block.
- `robots.txt` does not declare a sitemap because the production domain is undecided.
- The authenticated `ErpShell` chunk remains approximately 638 KB gzip; the landing and auth entry do not load it, but the shell itself is not split further until Phase 14.
- The pre-existing `xlsx@0.18.5` high advisory remains; no dependency was added or upgraded in this phase.
- Critical defect outside Phase 13 scope: the real-mode sales workspace still displays "Rule pack bd-2026-v1 · External Tax Counsel" even though the rule pack is marked `PENDING_TAX_COUNSEL`. This could imply a verification that has not happened. It was excluded from the marketing screenshots but must be corrected before external use.

Manual or external decisions required:

- Legal review and publication of the legal entity, registered address, trade licence, contact details, privacy policy and terms of service.
- Approval of the statutory/audit/tax disclaimers and the demo-request retention/deletion policy.
- Pricing and packaging model, or confirmation that pricing remains sales-led.
- Production domain, TLS, hosting/CDN and static security headers (`VITE_PUBLIC_SITE_URL`, CSP, HSTS, cache policy).
- Demo-request notification/CRM workflow and who is responsible for responding.
- Data-protection review for the lead contact fields and log retention.
- Accountant/tax counsel review of the rule-pack labels and rates shown in the application; the marketing site deliberately does not present them as confirmed.

Next-phase dependency verified: YES — Phase 14 can reuse the `ql-*` tokens, typography, components, auth layout and `/design` gallery. The auth pages use real Phase 3 server flows, the auth entry is separate from the lazy `ErpShell`, and the existing app still runs and passes its suites. The remaining app-shell weight and the legacy workspace vocabulary are deliberately left for Phase 14.

Blocker: None for the implemented Phase 13 scope. Production launch is gated by the legal/company/privacy decisions, the production domain/hosting and static security headers, the pricing decision, and the demo-request notification/retention decision.
