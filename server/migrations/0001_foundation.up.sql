-- Foundation identity, tenancy and audit tables. No financial or customer data is created here.
-- Forward-only in production: every change must add a new migration with a matching down script
-- for development and test databases.

CREATE TABLE organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text NOT NULL DEFAULT 'BD',
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT organisations_country_format CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT organisations_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'INVITED',
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalised CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT users_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT users_status_check CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  CONSTRAINT users_password_hash_length CHECK (password_hash IS NULL OR char_length(password_hash) >= 20)
);

CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'INVITED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_organisation_user_unique UNIQUE (organisation_id, user_id),
  CONSTRAINT memberships_role_check CHECK (role IN ('OWNER', 'ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'OPERATOR', 'AUDITOR')),
  CONSTRAINT memberships_status_check CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED'))
);

CREATE INDEX memberships_organisation_idx ON memberships (organisation_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE RESTRICT,
  legal_name text NOT NULL,
  trade_name text,
  entity_type text,
  industry text,
  tin text,
  bin text,
  rjsc_no text,
  address text,
  phone text,
  email text,
  reporting_framework text,
  base_currency text NOT NULL DEFAULT 'BDT',
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_organisation_id_unique UNIQUE (organisation_id, id),
  CONSTRAINT companies_legal_name_length CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 200),
  CONSTRAINT companies_base_currency_format CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT companies_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE INDEX companies_organisation_idx ON companies (organisation_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations (id) ON DELETE RESTRICT,
  company_id uuid,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  reason text,
  ip inet,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_action_length CHECK (char_length(btrim(action)) BETWEEN 1 AND 100),
  CONSTRAINT audit_events_entity_type_length CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 100),
  CONSTRAINT audit_events_company_requires_organisation CHECK (company_id IS NULL OR organisation_id IS NOT NULL),
  CONSTRAINT audit_events_company_organisation_fk FOREIGN KEY (organisation_id, company_id)
    REFERENCES companies (organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX audit_events_organisation_created_idx ON audit_events (organisation_id, created_at);
CREATE INDEX audit_events_company_created_idx ON audit_events (company_id, created_at);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, created_at);

CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_set_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Audit events are append-only. This trigger is a database-level guard against accidental or
-- malicious UPDATE/DELETE from the application role. Production should additionally use a
-- least-privilege role that does not own the table and has no TRUNCATE right.
CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only'
    USING ERRCODE = '55000',
          HINT = 'Record a new audit event instead of changing history.';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

COMMENT ON TABLE audit_events IS 'Append-only audit trail. UPDATE and DELETE are rejected by trigger.';
