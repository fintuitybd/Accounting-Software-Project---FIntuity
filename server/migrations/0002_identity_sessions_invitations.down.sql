-- Development/test rollback for Phase 3. Production is forward-only.
DROP TRIGGER IF EXISTS invitations_set_updated_at ON invitations;
DROP TRIGGER IF EXISTS company_memberships_set_updated_at ON company_memberships;

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_session_fk;
ALTER TABLE audit_events DROP COLUMN IF EXISTS session_id;

DROP TABLE IF EXISTS rate_limit_counters;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS invitation_companies;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS company_memberships;

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_organisation_id_unique;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_failed_login_attempts_check,
  DROP COLUMN IF EXISTS password_changed_at,
  DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS failed_login_attempts,
  DROP COLUMN IF EXISTS last_login_at;
