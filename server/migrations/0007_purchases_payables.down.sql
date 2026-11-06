-- Development/test rollback for Phase 8. Production migrations are forward-only. Refuse to drop
-- the tables while any purchase document, payment or withholding liability exists.
DO $$
BEGIN
  IF to_regclass('public.purchase_documents') IS NOT NULL
     AND (EXISTS (SELECT 1 FROM purchase_documents) OR EXISTS (SELECT 1 FROM purchase_payments)) THEN
    RAISE EXCEPTION 'cannot roll back Phase 8 while purchase documents or payments exist'
      USING HINT = 'Take a backup and reverse the business documents through the application first.';
  END IF;
END;
$$;

DROP VIEW IF EXISTS purchase_ap_open_items;

-- The purchase policy is Phase 8 configuration, not financial history. Remove it before restoring
-- the pre-Phase-8 company_settings key constraint.
DELETE FROM company_settings WHERE key = 'purchase_tax_policy';

DROP TABLE IF EXISTS purchase_withholding_liabilities;
DROP TABLE IF EXISTS purchase_payment_allocations;
DROP TABLE IF EXISTS purchase_payments;
DROP TABLE IF EXISTS purchase_document_events;
DROP TABLE IF EXISTS purchase_tax_decisions;
DROP TABLE IF EXISTS purchase_document_taxes;
DROP TABLE IF EXISTS purchase_document_lines;
DROP TABLE IF EXISTS purchase_documents;

DROP FUNCTION IF EXISTS protect_purchase_withholding_liability();
DROP FUNCTION IF EXISTS protect_purchase_payment_row();
DROP FUNCTION IF EXISTS protect_purchase_document_line_row();
DROP FUNCTION IF EXISTS protect_purchase_document_row();

ALTER TABLE company_settings DROP CONSTRAINT company_settings_key_check;
ALTER TABLE company_settings
  ADD CONSTRAINT company_settings_key_check CHECK (
    key IN ('language', 'approval_thresholds', 'tax', 'sales_tax_policy')
  );
