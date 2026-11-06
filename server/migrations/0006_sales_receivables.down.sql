-- Development/test rollback for Phase 7. This refuses to run once any sales document or receipt
-- exists so a down migration can never erase posted financial history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales_documents LIMIT 1)
     OR EXISTS (SELECT 1 FROM sales_receipts LIMIT 1) THEN
    RAISE EXCEPTION 'sales_documents or sales_receipts contain data; Phase 7 down migration refused'
      USING HINT = 'Restore from a verified backup or write a forward compensating migration.';
  END IF;
END;
$$;

DROP VIEW IF EXISTS sales_ar_open_items;

DROP TABLE IF EXISTS sales_receipt_allocations;
DROP TABLE IF EXISTS sales_receipts;
DROP TABLE IF EXISTS sales_document_events;
DROP TABLE IF EXISTS sales_tax_decisions;
DROP TABLE IF EXISTS sales_document_taxes;
DROP TABLE IF EXISTS sales_document_lines;
DROP TABLE IF EXISTS sales_documents;

DROP FUNCTION IF EXISTS protect_sales_receipt_row();
DROP FUNCTION IF EXISTS reject_sales_history_mutation();
DROP FUNCTION IF EXISTS protect_sales_document_line_row();
DROP FUNCTION IF EXISTS protect_sales_document_row();

DELETE FROM number_sequences WHERE doc_type IN ('MUSHAK_63', 'MUSHAK_67');

DELETE FROM company_settings WHERE key = 'sales_tax_policy';
ALTER TABLE company_settings DROP CONSTRAINT company_settings_key_check;
ALTER TABLE company_settings
  ADD CONSTRAINT company_settings_key_check CHECK (key IN ('language', 'approval_thresholds', 'tax'));

ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN'
    )
  );
