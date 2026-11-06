-- Development/test rollback for Phase 11 reporting scope. This refuses to run once any journal has
-- branch attribution: dropping the column would silently destroy audit evidence. A production
-- rollback therefore requires an explicit data-retention decision, not merely this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM journals WHERE branch_id IS NOT NULL) THEN
    RAISE EXCEPTION 'refusing to drop journals.branch_id while branch-attributed journals exist'
      USING ERRCODE = '55000',
            HINT = 'Archive/report the branch attribution first; this down migration is not a data-retention policy.';
  END IF;
END;
$$;

DROP TRIGGER journals_protect_branch ON journals;
DROP FUNCTION protect_journal_branch();
DROP INDEX journals_company_branch_date_idx;
ALTER TABLE journals DROP CONSTRAINT journals_branch_fk;
ALTER TABLE journals DROP COLUMN branch_id;
