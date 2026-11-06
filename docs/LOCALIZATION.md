# Localization status and review guide

## 1. Current implementation

- English (`en-BD`, default) and Bangla (`bn-BD`) dictionaries are composed in `src/core/i18n.ts`.
- `tests/localization.test.ts` enforces:
  - complete key parity (no key missing in either language);
  - no empty translations;
  - identical interpolation placeholders across languages;
  - lakh/crore and millions grouping, negatives, zero, Bangla digits, date and placeholder formatting.
- The production shell, navigation, dashboard, route states, auth pages and the main sales/purchase
  list/form controls are bilingual.
- Fonts are self-hosted under `public/fonts` (Inter and Noto Sans Bengali, SIL OFL 1.1). No Google Fonts
  request is made; `npm run check:built-security` verifies this.
- Status chips use text plus colour. Working text in the reviewed production pages is at least 12px;
  the audit log's remaining 11px text was raised to 12px in Phase 15.

## 2. What is not complete

The master plan's target is a typed key dictionary (`t('sales.createTitle')`) rather than inline
`L('English', 'বাংলা')`. The codebase still contains a large number of inline bilingual pairs (the
legacy/demo workspaces account for most of them), and several server-backed deep panels are
English-only:

- setup step bodies: company profile, chart of accounts, fiscal year (partly), bank accounts, opening
  balances, company settings;
- banking statement import/workbench;
- parts of purchases (payables/search/status helpers);
- report export/print internals and server report column labels;
- some validation/error prose that originates in the browser rather than a stable API error code.

Automated dictionary parity does **not** prove that every visible string is translated. A Bangla DOM
pass and native review are still required.

## 3. Terminology review

The proposed glossary is in the master plan, section 12.3. Native accounting review must confirm at
least:

- chart of accounts, general ledger, journal, trial balance, balance sheet, P&L;
- debit/credit explanations for guided mode;
- invoice vs bill vs challan vs delivery challan;
- receipt vs payment vs allocation;
- fiscal year vs accounting period vs close;
- VDS/TDS/AIT, Mushak form numbers, certificate and return labels;
- reversal/cancellation wording (history remains; nothing is deleted);
- audit trail and approval terms.

Do not machine-translate legal, tax, payroll or filing text. The rule pack and statutory templates
remain `PENDING_TAX_COUNSEL` until a qualified reviewer records a source, date and decision.

## 4. Localization QA checklist

- [ ] Native accountant reviews every accounting/tax/report label.
- [ ] Screenshot every production screen in English and Bangla at 360px, 768px and 1440px.
- [ ] Run a Bangla screen-reader pass on the core journey.
- [ ] Verify report PDF/print and Excel exports in both languages, including column widths and Bangla
      line height.
- [ ] Confirm switching language never changes stored data or calculations.
- [ ] Confirm no visible hard-coded English remains in a Bangla session (proper nouns, document
      numbers and user data excepted).
- [ ] Add newly introduced strings to the dictionary and keep the parity/placeholder test green.
- [ ] Re-check the glossary before every release.

## 5. Rules for new work

- Do not add a user-visible string without an English and Bangla value.
- Do not concatenate sentences from translated fragments; use interpolation with named placeholders.
- Do not format dates or money by hand in components; use the shared helpers.
- Do not put legal/tax claims in a translation file without the reviewer status and source.
- API errors must remain stable codes; the client maps them to localized messages.
