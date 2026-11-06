-- Development/test rollback only. Close evidence and suspense decisions must not be discarded in a
-- production database; the guard refuses while any persisted decision exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM close_runs)
     OR EXISTS (SELECT 1 FROM suspense_resolutions)
     OR EXISTS (SELECT 1 FROM journals WHERE source_module = 'SUSPENSE')
     OR EXISTS (SELECT 1 FROM accounts WHERE control_subledger = 'SUSPENSE')
     OR EXISTS (SELECT 1 FROM sales_documents WHERE doc_type = 'SALES_INVOICE' AND status = 'APPROVED') THEN
    RAISE EXCEPTION 'Phase 12 evidence exists; archive the database instead of rolling back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS suspense_resolutions_guard ON suspense_resolutions;
DROP FUNCTION IF EXISTS guard_suspense_resolution_mutation();
DROP TABLE IF EXISTS suspense_resolutions;

DROP TRIGGER IF EXISTS close_run_events_append_only ON close_run_events;
DROP FUNCTION IF EXISTS reject_close_run_event_mutation();
DROP TABLE IF EXISTS close_run_events;

DROP TRIGGER IF EXISTS close_runs_guard ON close_runs;
DROP FUNCTION IF EXISTS guard_close_run_mutation();
DROP TRIGGER IF EXISTS close_runs_set_updated_at ON close_runs;
DROP TABLE IF EXISTS close_runs;

ALTER TABLE periods
  DROP COLUMN IF EXISTS reopened_by,
  DROP COLUMN IF EXISTS reopened_at;

ALTER TABLE purchase_documents
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

ALTER TABLE sales_documents
  ADD CONSTRAINT sales_documents_approved_only_credit CHECK (
    doc_type = 'CREDIT_NOTE' OR status <> 'APPROVED'
  );

ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION'
    )
  );

ALTER TABLE accounts DROP CONSTRAINT accounts_control_subledger_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_control_subledger_check CHECK (
    control_subledger IN (
      'NONE', 'AR', 'AP', 'BANK_MFS', 'VAT_CURRENT_ACCOUNT', 'VDS_PAYABLE', 'TDS_PAYABLE',
      'INVENTORY', 'FIXED_ASSETS'
    )
  );
