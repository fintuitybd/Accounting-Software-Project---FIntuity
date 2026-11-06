-- Development and test rollback only. Production migrations are forward-only; use a restore or a
-- new compensating migration instead of running this file.

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organisations;

DROP FUNCTION IF EXISTS reject_audit_event_mutation();
DROP FUNCTION IF EXISTS set_updated_at();
