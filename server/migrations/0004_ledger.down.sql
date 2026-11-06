-- Development/test rollback for Phase 5. Posted financial history must never be destroyed by a
-- rollback: the migration aborts if any journal exists. Export/archive and obtain a controlled
-- migration decision before rolling back a ledger that has accepted even a draft journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM journals) THEN
    RAISE EXCEPTION 'cannot roll back Phase 5 while journals exist; archive and reconcile the ledger first'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP INDEX IF EXISTS opening_balance_batches_posting_key_unique;
DROP INDEX IF EXISTS opening_balance_batches_journal_unique;
DROP INDEX IF EXISTS opening_balance_batches_one_posted;
DROP INDEX IF EXISTS opening_balance_batches_one_open;

ALTER TABLE opening_balance_batches
  DROP CONSTRAINT IF EXISTS opening_balance_batches_reversal_guard,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_approval_guard,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_post_guard,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_posting_key_length,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_reversal_journal_fk,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_journal_fk,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_status_check,
  DROP CONSTRAINT IF EXISTS opening_balance_batches_submit_guard;

ALTER TABLE opening_balance_batches
  DROP COLUMN IF EXISTS reversal_journal_id,
  DROP COLUMN IF EXISTS reversed_by,
  DROP COLUMN IF EXISTS reversed_at,
  DROP COLUMN IF EXISTS posting_idempotency_key,
  DROP COLUMN IF EXISTS journal_id,
  DROP COLUMN IF EXISTS posted_by,
  DROP COLUMN IF EXISTS posted_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at;

ALTER TABLE opening_balance_batches
  ADD CONSTRAINT opening_balance_batches_status_check CHECK (status IN ('DRAFT', 'SUBMITTED'));
ALTER TABLE opening_balance_batches
  ADD CONSTRAINT opening_balance_batches_submit_guard CHECK (
    status <> 'SUBMITTED'
    OR (
      balanced
      AND total_debit_poisha = total_credit_poisha
      AND total_debit_poisha > 0
      AND evidence_reference IS NOT NULL
      AND char_length(btrim(evidence_reference)) > 0
      AND submitted_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX opening_balance_batches_one_submitted
  ON opening_balance_batches (company_id)
  WHERE status = 'SUBMITTED';

DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journals;

DROP FUNCTION IF EXISTS validate_journal_integrity();
DROP FUNCTION IF EXISTS protect_journal_lines();
DROP FUNCTION IF EXISTS protect_journal_rows();
