# Quiet Ledger design system

**Status:** Phase 13 foundation. Public marketing, authentication and the internal `/design` gallery.
The authenticated workspaces still use the legacy `lv-*` Lumen vocabulary and are migrated in Phase 14.

**Sources of truth**

- CSS variables and `.ql-*` primitives: `src/index.css` (section 0b and the Quiet Ledger primitives).
- Tailwind mapping: `tailwind.config.js` (`ql` colours, `font-ql-*`, `rounded-ql*`, `shadow-ql*`,
  `duration-ql*`, `ql-*` breakpoints).
- Shared brand primitives: `src/components/brand/FintuityBrand.tsx` (compatibility aliases remain in
  `LedgerMark.tsx`).
- Brand assets: `public/brand/fintuity-logo.svg` (the supplied logo, unchanged) and
  `fintuity-favicon.svg` (the same artwork cropped for a small tab icon). The header and compact rail
  frames crop the supplied artboard whitespace visually; the asset itself is not edited.
- Accessible dialog primitive: `src/components/ui/Dialog.tsx`.
- Public marketing layout: `src/marketing/marketing.css`.
- Internal gallery: `src/marketing/pages/DesignSystemPage.tsx` at `/design` (noindex, not linked).

## 1. Colour tokens

All components must use semantic token names. Raw hex values in components are prohibited.

| Token               | Light value | Use                                                   |
| ------------------- | ----------- | ----------------------------------------------------- |
| `ql-paper`          | `#F6F9FA`   | Page canvas, cool mist                                |
| `ql-surface`        | `#FFFFFF`   | Working surface                                       |
| `ql-surface-muted`  | `#EDF4F6`   | Muted surface, table head, chrome                     |
| `ql-surface-raised` | `#FFFFFF`   | Raised surface                                        |
| `ql-ink`            | `#0A1E30`   | Primary text                                          |
| `ql-ink-muted`      | `#3E5263`   | Secondary text                                        |
| `ql-ink-subtle`     | `#586C7B`   | Metadata that must still meet 4.5:1 on muted surfaces |
| `ql-ink-inverse`    | `#FFFFFF`   | Text on dark/strong fills                             |
| `ql-border`         | `#DBE8EB`   | Hairline border                                       |
| `ql-border-strong`  | `#BFD6DC`   | Hover/focus border                                    |
| `ql-brand`          | `#002D60`   | Primary action, logo navy                             |
| `ql-brand-hover`    | `#003B7A`   | Primary action hover                                  |
| `ql-brand-soft`     | `#E6F6F8`   | Brand tint                                            |
| `ql-brand-ink`      | `#FFFFFF`   | Text on brand fill                                    |
| `ql-accent`         | `#007A70`   | Logo teal, eyebrow, accessible accent                 |
| `ql-accent-soft`    | `#DEF7F3`   | Accent tint                                           |
| `ql-success`        | `#067647`   | Posted, balanced                                      |
| `ql-success-soft`   | `#ECFDF3`   | Success tint                                          |
| `ql-warning`        | `#B54708`   | Pending, attention                                    |
| `ql-warning-soft`   | `#FFFAEB`   | Warning tint                                          |
| `ql-danger`         | `#B42318`   | Error, overdue, destructive                           |
| `ql-danger-soft`    | `#FEF2F2`   | Danger tint                                           |
| `ql-info`           | `#175CD3`   | Informational                                         |
| `ql-info-soft`      | `#EFF8FF`   | Info tint                                             |
| `ql-focus`          | `#1D4ED8`   | Keyboard focus ring                                   |

Dark authentication pages override the same variables under `.dark .ql-auth` and `.dark .ql-design`.
The public marketing site intentionally stays on the light cool-mist canvas regardless of the saved
app theme. High-contrast authentication uses `.hc .ql-auth` / `.hc .ql-design`.

**Status is never colour-only.** Every badge, alert or status chip includes text (for example
"Posted", "Overdue", "One bank statement line is unmatched").

## 2. Typography

- UI and marketing: **Inter** variable (400–700), self-hosted at `public/fonts/inter-latin-400-700.woff2`.
- Bangla: **Noto Sans Bengali** variable (400–700), self-hosted in Bengali and Latin subsets.
- Fallback: `system-ui`, `-apple-system`, `Segoe UI`, `sans-serif`.
- Money: tabular lining numerals via `font-variant-numeric: tabular-nums lining-nums`.
- Type scale: 12, 13, 14, 16, 18, 22, 28, 34 for working UI; marketing display uses
  `clamp(2.15rem, 5.6vw, 3.75rem)`.
- Base sizes: 16px public body, 14px auth body, 13–14px working text. **Never below 12px.**
- Bangla line-height: 1.7–1.75; no uppercase transforms and no negative letter-spacing.
- Labels are sentence case. Avoid uppercase tracking for working labels.
- Dates use a clear format (`12 Nov 2026` / `১২ নভে ২০২৬`), never ambiguous numeric dates.

The English marketing page uses the Latin label “Bangla” and the ISO-style “BDT” prefix in the
sample ledger. This prevents the browser from downloading the 107 KB Bengali font just to render a
single Taka glyph before the visitor selects Bangla. The Bangla page uses the local symbol and
Bangla numerals.

**Font licences:** both families are licensed under the SIL Open Font License 1.1. Copies are in
`public/fonts/LICENSE-Inter.txt` and `public/fonts/LICENSE-NotoSansBengali.txt`.

## 3. Spacing, radius, elevation and motion

| Token          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Spacing base   | 4px                                                                    |
| Spacing scale  | 4, 8, 12, 16, 24, 32, 40, 48, 64                                       |
| Radius control | 6px (`rounded-ql-control`)                                             |
| Radius card    | 8px (`rounded-ql`)                                                     |
| Radius modal   | 10px (`rounded-ql-modal`)                                              |
| Radius pill    | 9999px                                                                 |
| Card shadow    | `0 1px 2px rgb(16 24 40 / .04), 0 3px 10px -4px rgb(16 24 40 / .08)`   |
| Popover shadow | `0 18px 45px -18px rgb(16 24 40 / .28), 0 2px 8px rgb(16 24 40 / .08)` |
| Focus          | 2px solid `ql-focus`, offset 2px                                       |
| Motion fast    | 120ms                                                                  |
| Motion base    | 180ms                                                                  |
| Motion slow    | 220ms                                                                  |
| Motion easing  | `cubic-bezier(0.22, 1, 0.36, 1)`                                       |

`prefers-reduced-motion` disables animation and smooth scrolling inside `.ql-theme`. The authenticated
app also has its existing motion preference (`OFF` / `LITE`).

## 4. Breakpoints

| Name         | Width  | Use                                            |
| ------------ | ------ | ---------------------------------------------- |
| `ql-xs`      | 360px  | Small phone; the primary responsive test floor |
| default `sm` | 640px  | Large phone / small tablet                     |
| default `md` | 768px  | Tablet                                         |
| default `lg` | 1024px | Desktop shell                                  |
| default `xl` | 1280px | Wide desktop                                   |
| `ql-3xl`     | 1440px | Reference desktop width                        |
| `ql-4xl`     | 1600px | Very wide                                      |

Grids use `minmax(0, 1fr)` so a wide table or long identifier cannot force the page wider than the
viewport. Tables that cannot fit scroll inside their own container.

## 5. Components

Quiet Ledger primitives live in `src/index.css`:

- `ql-theme`, `ql-skip-link`
- `ql-btn` + `ql-btn-primary`, `ql-btn-secondary`, `ql-btn-ghost`, `ql-btn-accent`, `ql-btn-danger`,
  `ql-btn-sm`
- `ql-input`, `ql-select`, `ql-textarea`, `ql-label`, `ql-hint`, `ql-field-error`
- `ql-card`, `ql-card-muted`
- `ql-badge` + neutral / brand / success / warning / danger / info
- `ql-alert` + info / success / warning / danger
- `ql-table` (caption, header, body, money alignment)
- `ql-money`, `ql-rule`, `ql-ledger-rule`
- `ql-eyebrow`, `ql-display`, `ql-link`
- `ql-spinner`, `ql-skeleton`

The internal gallery at `/design` shows buttons, inputs, selects, textareas, badges, alerts, tables,
money formatting, loading, empty, error and permission-denied states, and an accessible dialog.
It is excluded from search and linked only for internal review.

`Dialog` provides a focus trap, Escape-to-close, focus restoration, ARIA title/description and a
body scroll lock. Destructive actions state the consequence in plain language.

**Legacy vocabulary:** the twelve authenticated workspaces still use `lv-*` classes and the Lumen
colour tokens. Do not mix `lv-*` into new public/auth surfaces. Phase 14 migrates the workspaces and
then removes the legacy vocabulary.

## 6. Accessibility contract (WCAG 2.2 AA)

- Normal text contrast is at least 4.5:1; large text and UI components at least 3:1.
- Every input has a visible label; errors are inline and linked with `aria-describedby`.
- Icon-only controls have an accessible name; visible labels are included in the accessible name
  for language/theme switches.
- Keyboard focus is visible and logical. The dialog traps and restores focus.
- Status carries text, not colour alone.
- Touch targets are at least 44px on the public/auth surfaces.
- The page remains usable at 200% zoom and at 360px width with no horizontal page overflow.
- Reduced motion is respected. No flashing or looping decoration.
- Marketing sections use semantic landmarks, heading order and `aria-labelledby`.

## 7. Performance and SEO

- Marketing, auth and authenticated app are separate lazy entries. `/` loads only the marketing
  chunks. Auth routes load the auth entry (about 54 KB gzip) and only the authenticated `/app` route
  fetches the `ErpShell` chunk (about 638 KB gzip). The financial workspaces and providers are not in
  the initial request.
- `index.html` is the single document for the SPA. Marketing metadata is the default; auth pages set
  their own title and `noindex,nofollow` meta at mount.
- Canonical, Open Graph and structured-data URLs use `VITE_PUBLIC_SITE_URL`. A production build must
  set it to the real HTTPS origin; the localhost fallback is for development only and emits a build
  warning.
- `public/robots.txt` allows the public site and disallows the authenticated/auth routes and
  `/design`.
- Marketing images are lazy below the fold; the hero uses the design-system product frame rather
  than a heavy raster image.
- Fonts are self-hosted with `font-display: swap`; only Inter is preloaded.

**Measured locally** with Lighthouse 12.8.2 against the production build (`vite preview`), mobile
throttling, single run:

| Category       | Score |
| -------------- | ----- |
| Performance    | 0.99  |
| Accessibility  | 1.00  |
| Best practices | 1.00  |
| SEO            | 1.00  |

Landing: FCP 1.5s, LCP 2.0s, CLS 0. Login: performance 0.98, accessibility 1.00, LCP 2.3s, CLS 0.
Re-measure on the production host and CDN; localhost results are not a hosting guarantee.

## 8. Content and claims

- No customer logos, testimonials, certifications, audit opinions or “NBR-approved” claims.
- No invented legal entity, address, phone number or price list.
- Statutory outputs are labelled drafts; the product does not file returns or issue audit opinions.
- Demo data is synthetic and labelled. Real company screenshots are never mixed with demo data.
- The legal page states that formal terms, privacy policy and company registration details are
  pending legal review. Do not replace that notice with invented legal text.
- Pricing is sales-led (“talk to us”) until a commercial decision is made.

## 9. Verification commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

For the public pages, also run Lighthouse/axe against the built site and check 360px, 768px and
1440px with keyboard-only navigation. The phase report records the exact results.
