-- Development/test rollback for Phase 10. Financial history is never silently discarded: the
-- migration refuses while any imported statement, match, fee, transfer, GL request or reconciliation
-- exists. Production rollback remains forward-only via the migration runner.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bank_statements
    UNION ALL SELECT 1 FROM bank_statement_lines
    UNION ALL SELECT 1 FROM bank_statement_line_matches
    UNION ALL SELECT 1 FROM bank_gl_requests
    UNION ALL SELECT 1 FROM bank_fee_rules
    UNION ALL SELECT 1 FROM bank_fee_postings
    UNION ALL SELECT 1 FROM bank_transfers
    UNION ALL SELECT 1 FROM bank_reconciliations
  ) THEN
    RAISE EXCEPTION 'Phase 10 banking data exists; rollback is refused to preserve financial evidence';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS periods_lock_bank_reconciliations ON periods;
DROP FUNCTION IF EXISTS lock_bank_reconciliations_for_period();
DROP TRIGGER IF EXISTS journals_sync_banking_links_on_reversal ON journals;
DROP FUNCTION IF EXISTS sync_banking_links_on_journal_reversal();

-- Drop tables first so their triggers release the trigger functions.
DROP TABLE IF EXISTS bank_reconciliations;
DROP TABLE IF EXISTS bank_transfers;
DROP TABLE IF EXISTS bank_fee_postings;
DROP TABLE IF EXISTS bank_fee_rules;
DROP TABLE IF EXISTS bank_gl_requests;
DROP TABLE IF EXISTS bank_statement_line_matches;
DROP TABLE IF EXISTS bank_statement_lines;
DROP TABLE IF EXISTS bank_statements;

DROP FUNCTION IF EXISTS protect_bank_reconciliation();
DROP FUNCTION IF EXISTS protect_bank_transfer();
DROP FUNCTION IF EXISTS reject_bank_fee_posting_mutation();
DROP FUNCTION IF EXISTS protect_bank_gl_request();
DROP FUNCTION IF EXISTS refresh_bank_statement_line_status();
DROP FUNCTION IF EXISTS protect_bank_statement_line_match();
DROP FUNCTION IF EXISTS validate_bank_statement_line_match();
DROP FUNCTION IF EXISTS protect_bank_statement_line();
DROP FUNCTION IF EXISTS reject_bank_statement_mutation();

DELETE FROM number_sequences WHERE doc_type = 'BANK_TRANSFER';

ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN', 'MUSHAK_63', 'MUSHAK_67',
      'TREASURY_CERTIFICATE'
    )
  );

ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY'
    )
  );
