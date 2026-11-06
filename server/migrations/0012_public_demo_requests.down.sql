-- Development/test rollback only. Demo requests are contact records that must not be discarded
-- silently in a production database; the guard refuses while any request exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM demo_requests) THEN
    RAISE EXCEPTION 'demo request records exist; archive the database instead of rolling back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS demo_requests_set_updated_at ON demo_requests;
DROP TABLE IF EXISTS demo_requests;
