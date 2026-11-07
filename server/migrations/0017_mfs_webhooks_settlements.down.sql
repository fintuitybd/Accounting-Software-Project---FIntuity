DROP TABLE IF EXISTS mfs_webhook_events CASCADE;
DELETE FROM bank_statement_lines WHERE statement_id IS NULL;
ALTER TABLE bank_statement_lines ALTER COLUMN statement_id SET NOT NULL;
