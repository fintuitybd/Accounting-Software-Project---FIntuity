-- Reverse Phase 4 company configuration. No posted financial history exists in this phase, so all
-- Phase 4 configuration tables can be removed in reverse dependency order.

DROP TABLE IF EXISTS opening_balance_lines;
DROP TABLE IF EXISTS opening_balance_batches;
DROP TABLE IF EXISTS bank_accounts;
DROP TABLE IF EXISTS number_sequences;
DROP TABLE IF EXISTS company_settings;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS periods;
DROP TABLE IF EXISTS fiscal_years;
DROP TABLE IF EXISTS company_onboarding;

DROP FUNCTION IF EXISTS validate_opening_balance_period();
DROP FUNCTION IF EXISTS validate_bank_account_gl();
DROP FUNCTION IF EXISTS protect_control_account();
DROP FUNCTION IF EXISTS reject_period_overlap();
DROP FUNCTION IF EXISTS reject_fiscal_year_overlap();
