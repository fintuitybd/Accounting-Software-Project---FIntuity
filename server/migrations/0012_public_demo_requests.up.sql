-- Phase 13: public demo requests.
--
-- The landing page is public and unauthenticated. A demo request is a lead, not a financial record,
-- so it is deliberately not scoped to an organisation or company. The server stores only the
-- fields the visitor provides; it does not store the request IP or user agent. Access is write-only
-- through the public API; there is no public read endpoint.

CREATE TABLE demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'NEW',
  source text NOT NULL DEFAULT 'landing',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_requests_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT demo_requests_email_length CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT demo_requests_email_format CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT demo_requests_company_length CHECK (char_length(btrim(company)) BETWEEN 1 AND 200),
  CONSTRAINT demo_requests_message_length CHECK (message IS NULL OR char_length(message) <= 2000),
  CONSTRAINT demo_requests_status_check CHECK (status IN ('NEW', 'CONTACTED', 'CLOSED')),
  CONSTRAINT demo_requests_source_check CHECK (source IN ('landing', 'contact'))
);

CREATE INDEX demo_requests_created_at_idx ON demo_requests (created_at DESC);
CREATE INDEX demo_requests_status_created_idx ON demo_requests (status, created_at DESC);

CREATE TRIGGER demo_requests_set_updated_at
  BEFORE UPDATE ON demo_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE demo_requests IS
  'Public walkthrough requests. Contains contact details only; never financial records.';
COMMENT ON COLUMN demo_requests.source IS
  'Server-set page source (landing or contact). Do not accept an arbitrary client value.';
