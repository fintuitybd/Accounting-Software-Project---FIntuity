-- Phase 11 reporting scope. Journals gain an optional branch dimension so the general ledger,
-- financial statements and trial balance can be filtered to the same organisational unit as the
-- commercial documents that generated them. Existing journals remain valid and are reported as
-- "Unassigned"; the column is nullable and the migration is additive.
--
-- The branch dimension is deliberately not defaulted to the principal branch: an existing journal
-- must never be silently re-attributed to a branch whose books it did not belong to.

ALTER TABLE journals ADD COLUMN branch_id uuid;

ALTER TABLE journals
  ADD CONSTRAINT journals_branch_fk FOREIGN KEY (company_id, branch_id)
  REFERENCES branches (company_id, id) ON DELETE RESTRICT;

CREATE INDEX journals_company_branch_date_idx
  ON journals (company_id, branch_id, posting_date, created_at);

-- A posted journal is immutable. Branch attribution is part of that record and cannot be changed
-- after posting; a correction must be posted as a linked reversal/new journal.
CREATE FUNCTION protect_journal_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.branch_id IS DISTINCT FROM NEW.branch_id AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'branch attribution of a posted or reversed journal is immutable'
      USING ERRCODE = '55000',
            HINT = 'Post a linked reversal and a corrected journal with the right branch.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journals_protect_branch
  BEFORE UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION protect_journal_branch();

COMMENT ON COLUMN journals.branch_id IS
  'Optional reporting branch. NULL means the journal predates branch attribution or is company-wide; report as Unassigned, never assume the principal branch.';
