-- Phase 12: controlled close, approvals and suspense resolution.
--
-- Close evidence is a persisted snapshot. A close run records the checklist result, exceptions,
-- evidence reference, maker and checker. The checker approval locks the period. A reopen keeps the
-- closed run and creates an audited reopen record; it never edits the original evidence.
--
-- Suspense resolution is an explicit maker-checker request. The checker posts a linked journal that
-- clears the source line to a named target account. There is no one-click write-off.

ALTER TABLE accounts DROP CONSTRAINT accounts_control_subledger_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_control_subledger_check CHECK (
    control_subledger IN (
      'NONE', 'AR', 'AP', 'BANK_MFS', 'VAT_CURRENT_ACCOUNT', 'VDS_PAYABLE', 'TDS_PAYABLE',
      'INVENTORY', 'FIXED_ASSETS', 'SUSPENSE'
    )
  );

ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION', 'SUSPENSE'
    )
  );

-- High-value sales invoices now use the same maker-checker approval status as credit notes.
ALTER TABLE sales_documents DROP CONSTRAINT sales_documents_approved_only_credit;

ALTER TABLE purchase_documents
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE periods
  ADD COLUMN reopened_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN reopened_at timestamptz;

CREATE TABLE close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  prepared_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  evidence_reference text NOT NULL DEFAULT '',
  evidence_note text,
  checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  exceptions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_hash text,
  reopened_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT close_runs_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT close_runs_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT close_runs_status_check CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REOPENED')
  ),
  CONSTRAINT close_runs_checklist_array CHECK (jsonb_typeof(checklist_json) = 'array'),
  CONSTRAINT close_runs_exceptions_array CHECK (jsonb_typeof(exceptions_json) = 'array'),
  CONSTRAINT close_runs_evidence_length CHECK (char_length(evidence_reference) <= 500),
  CONSTRAINT close_runs_note_length CHECK (evidence_note IS NULL OR char_length(evidence_note) <= 2000),
  CONSTRAINT close_runs_reason_length CHECK (
    decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT close_runs_reopen_reason_length CHECK (
    reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT close_runs_snapshot_hash_format CHECK (
    snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT close_runs_submitted_fields CHECK (
    status = 'DRAFT'
    OR (submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND char_length(btrim(evidence_reference)) BETWEEN 3 AND 500)
  ),
  CONSTRAINT close_runs_decided_fields CHECK (
    status NOT IN ('APPROVED', 'REJECTED')
    OR (decided_at IS NOT NULL AND decided_by IS NOT NULL AND decision_reason IS NOT NULL)
  ),
  CONSTRAINT close_runs_reopened_fields CHECK (
    status <> 'REOPENED'
    OR (reopened_at IS NOT NULL AND reopened_by IS NOT NULL AND reopen_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX close_runs_one_active_idx
  ON close_runs (company_id, period_id)
  WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED');
CREATE INDEX close_runs_company_period_idx ON close_runs (company_id, period_id, created_at DESC);

CREATE TRIGGER close_runs_set_updated_at
  BEFORE UPDATE ON close_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The evidence of an approved/rejected/reopened run is immutable after the decision. The only
-- permitted transition on a closed run is APPROVED -> REOPENED with the reopen fields set.
CREATE FUNCTION guard_close_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'close runs cannot be deleted'
      USING ERRCODE = '55000',
            HINT = 'Create a new close run or reopen the period.';
  END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED', 'REOPENED') THEN
    IF NOT (OLD.status = 'APPROVED' AND NEW.status = 'REOPENED') THEN
      RAISE EXCEPTION 'closed close runs are immutable'
        USING ERRCODE = '55000',
              HINT = 'Record the reopen through the controlled period workflow.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER close_runs_guard
  BEFORE UPDATE OR DELETE ON close_runs
  FOR EACH ROW EXECUTE FUNCTION guard_close_run_mutation();

CREATE TABLE close_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT close_run_events_run_fk FOREIGN KEY (company_id, run_id)
    REFERENCES close_runs (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT close_run_events_action_length CHECK (char_length(btrim(action)) BETWEEN 1 AND 80),
  CONSTRAINT close_run_events_reason_length CHECK (reason IS NULL OR char_length(btrim(reason)) <= 500)
);

CREATE INDEX close_run_events_company_run_idx
  ON close_run_events (company_id, run_id, created_at);

CREATE FUNCTION reject_close_run_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'close run events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER close_run_events_append_only
  BEFORE UPDATE OR DELETE ON close_run_events
  FOR EACH ROW EXECUTE FUNCTION reject_close_run_event_mutation();

CREATE TABLE suspense_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  source_journal_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  suspense_account_id uuid NOT NULL,
  amount_poisha bigint NOT NULL,
  target_account_id uuid NOT NULL,
  reason text NOT NULL,
  attachment_reference text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suspense_resolutions_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT suspense_resolutions_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_journal_fk FOREIGN KEY (company_id, source_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_line_fk FOREIGN KEY (company_id, source_line_id)
    REFERENCES journal_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_suspense_account_fk FOREIGN KEY (company_id, suspense_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_target_account_fk FOREIGN KEY (company_id, target_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_journal_created_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT suspense_resolutions_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'POSTED')
  ),
  CONSTRAINT suspense_resolutions_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT suspense_resolutions_reason_length CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT suspense_resolutions_attachment_length CHECK (
    char_length(btrim(attachment_reference)) BETWEEN 3 AND 500
  ),
  CONSTRAINT suspense_resolutions_decision_reason_length CHECK (
    decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT suspense_resolutions_distinct_accounts CHECK (suspense_account_id <> target_account_id),
  CONSTRAINT suspense_resolutions_posted_fields CHECK (
    status <> 'POSTED' OR (journal_id IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX suspense_resolutions_one_active_idx
  ON suspense_resolutions (company_id, source_line_id)
  WHERE status IN ('PENDING', 'APPROVED', 'POSTED');
CREATE INDEX suspense_resolutions_company_status_idx
  ON suspense_resolutions (company_id, status, requested_at DESC);
CREATE INDEX suspense_resolutions_company_period_idx
  ON suspense_resolutions (company_id, period_id, created_at DESC);

CREATE TRIGGER suspense_resolutions_set_updated_at
  BEFORE UPDATE ON suspense_resolutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION guard_suspense_resolution_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('POSTED', 'REJECTED') THEN
    RAISE EXCEPTION 'decided suspense resolutions are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suspense_resolutions_guard
  BEFORE UPDATE ON suspense_resolutions
  FOR EACH ROW EXECUTE FUNCTION guard_suspense_resolution_mutation();
