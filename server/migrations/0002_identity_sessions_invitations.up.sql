-- Phase 3 identity completion. Additive only: no financial data is created or destroyed.
-- Passwords and bearer tokens are stored as verifier hashes. Invitation/reset/verification
-- tokens are single-use and carry no business data beyond their random secret.

ALTER TABLE users
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN password_changed_at timestamptz,
  ADD CONSTRAINT users_failed_login_attempts_check CHECK (failed_login_attempts >= 0);

-- Composite key used by company_memberships to prove that the company and the membership
-- belong to the same organisation. This is a database-level tenant-isolation guard.
ALTER TABLE memberships
  ADD CONSTRAINT memberships_organisation_id_unique UNIQUE (organisation_id, id);

-- Session correlation for the append-only audit trail. The foreign key is added after sessions.
ALTER TABLE audit_events ADD COLUMN session_id uuid;

CREATE TABLE company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  company_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_override text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_memberships_role_override_check CHECK (
    role_override IS NULL OR role_override IN ('OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR', 'AUDITOR')
  ),
  CONSTRAINT company_memberships_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  CONSTRAINT company_memberships_company_fk FOREIGN KEY (organisation_id, company_id)
    REFERENCES companies (organisation_id, id) ON DELETE RESTRICT,
  CONSTRAINT company_memberships_membership_fk FOREIGN KEY (organisation_id, membership_id)
    REFERENCES memberships (organisation_id, id) ON DELETE RESTRICT,
  CONSTRAINT company_memberships_membership_company_unique UNIQUE (membership_id, company_id)
);

CREATE INDEX company_memberships_company_idx ON company_memberships (company_id);
CREATE INDEX company_memberships_organisation_idx ON company_memberships (organisation_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  resend_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_check CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320
  ),
  CONSTRAINT invitations_role_check CHECK (
    role IN ('OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR', 'AUDITOR')
  ),
  CONSTRAINT invitations_resend_count_check CHECK (resend_count >= 0),
  CONSTRAINT invitations_token_hash_unique UNIQUE (token_hash)
);

CREATE UNIQUE INDEX invitations_pending_unique
  ON invitations (organisation_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_organisation_idx ON invitations (organisation_id, created_at);
CREATE INDEX invitations_email_idx ON invitations (lower(email));

CREATE TABLE invitation_companies (
  invitation_id uuid NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  company_id uuid NOT NULL,
  PRIMARY KEY (invitation_id, company_id),
  CONSTRAINT invitation_companies_company_fk FOREIGN KEY (organisation_id, company_id)
    REFERENCES companies (organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX invitation_companies_company_idx ON invitation_companies (company_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  csrf_token_hash text NOT NULL,
  ip inet,
  user_agent text,
  active_organisation_id uuid REFERENCES organisations (id) ON DELETE RESTRICT,
  active_company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT sessions_expiry_order_check CHECK (absolute_expires_at > created_at),
  CONSTRAINT sessions_active_company_pair_check CHECK (
    (active_organisation_id IS NULL) = (active_company_id IS NULL)
  ),
  CONSTRAINT sessions_active_company_fk FOREIGN KEY (active_organisation_id, active_company_id)
    REFERENCES companies (organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
CREATE INDEX sessions_active_idx ON sessions (absolute_expires_at) WHERE revoked_at IS NULL;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_session_fk FOREIGN KEY (session_id)
    REFERENCES sessions (id) ON DELETE RESTRICT;

CREATE INDEX audit_events_session_idx ON audit_events (session_id, created_at);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_verification_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at DESC);

CREATE TABLE rate_limit_counters (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  counter integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_counters_counter_check CHECK (counter >= 0),
  CONSTRAINT rate_limit_counters_bucket_length CHECK (char_length(bucket_key) BETWEEN 1 AND 300)
);

CREATE TRIGGER company_memberships_set_updated_at
  BEFORE UPDATE ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
