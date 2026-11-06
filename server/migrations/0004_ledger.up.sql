-- Phase 5 server-authoritative ledger: journals, journal lines, posting integrity and the
-- permanent opening-balance batch <-> journal link.
--
-- Amounts are BIGINT poisha. Journal numbers are allocated from number_sequences inside the same
-- transaction that posts the journal. Posted journals and their lines are append-only; corrections
-- use linked reversals. The constraints and deferred triggers below are the database backstop for
-- the application posting service.

CREATE TABLE journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  journal_number text,
  book_type text NOT NULL DEFAULT 'STATUTORY_BD',
  period_id uuid NOT NULL,
  document_date date NOT NULL,
  posting_date date NOT NULL,
  source_module text NOT NULL,
  source_doc_id uuid,
  source_doc_ref text,
  narration_en text NOT NULL,
  narration_bn text,
  currency text NOT NULL DEFAULT 'BDT',
  status text NOT NULL DEFAULT 'DRAFT',
  idempotency_key text,
  attachment_reference text,
  reversal_of_journal_id uuid,
  reversed_by_journal_id uuid,
  reversal_reason text,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz,
  posted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journals_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT journals_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_reversal_of_fk FOREIGN KEY (company_id, reversal_of_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_reversed_by_fk FOREIGN KEY (company_id, reversed_by_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_book_type_check CHECK (
    book_type IN ('STATUTORY_BD', 'IFRS_GROUP_ADJ', 'TAX_COMPUTATION', 'MANAGEMENT_MIS')
  ),
  CONSTRAINT journals_status_check CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED')
  ),
  CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE'
    )
  ),
  CONSTRAINT journals_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT journals_narration_length CHECK (char_length(btrim(narration_en)) BETWEEN 1 AND 500),
  CONSTRAINT journals_narration_bn_length CHECK (
    narration_bn IS NULL OR char_length(btrim(narration_bn)) <= 500
  ),
  CONSTRAINT journals_source_ref_length CHECK (
    source_doc_ref IS NULL OR char_length(source_doc_ref) <= 200
  ),
  CONSTRAINT journals_attachment_length CHECK (
    attachment_reference IS NULL OR char_length(btrim(attachment_reference)) <= 500
  ),
  CONSTRAINT journals_idempotency_length CHECK (
    idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 200
  ),
  CONSTRAINT journals_reversal_reason_length CHECK (
    reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 500
  ),
  CONSTRAINT journals_number_status CHECK (
    journal_number IS NULL OR status IN ('POSTED', 'REVERSED')
  ),
  CONSTRAINT journals_posted_fields CHECK (
    status NOT IN ('POSTED', 'REVERSED')
    OR (journal_number IS NOT NULL AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
  ),
  CONSTRAINT journals_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (
      reversed_by_journal_id IS NOT NULL
      AND reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL
    )
  ),
  CONSTRAINT journals_reversal_link CHECK (
    reversal_of_journal_id IS NULL OR source_module = 'REVERSAL'
  ),
  CONSTRAINT journals_reversal_not_self CHECK (
    reversal_of_journal_id IS NULL OR reversal_of_journal_id <> id
  ),
  CONSTRAINT journals_reversed_not_self CHECK (
    reversed_by_journal_id IS NULL OR reversed_by_journal_id <> id
  ),
  CONSTRAINT journals_reversed_link CHECK (
    reversed_by_journal_id IS NULL OR status = 'REVERSED'
  )
);

-- A journal number is unique per company and book and is never reused. Draft journals carry no
-- number; the partial index permits any number of drafts without weakening posted uniqueness.
CREATE UNIQUE INDEX journals_company_book_number_unique
  ON journals (company_id, book_type, journal_number)
  WHERE journal_number IS NOT NULL;

CREATE UNIQUE INDEX journals_company_idempotency_unique
  ON journals (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX journals_one_reversal
  ON journals (company_id, reversal_of_journal_id)
  WHERE reversal_of_journal_id IS NOT NULL;

CREATE UNIQUE INDEX journals_one_reversed_by
  ON journals (company_id, reversed_by_journal_id)
  WHERE reversed_by_journal_id IS NOT NULL;

CREATE INDEX journals_company_date_idx ON journals (company_id, posting_date, created_at);
CREATE INDEX journals_company_status_idx ON journals (company_id, status, posting_date);
CREATE INDEX journals_company_source_idx ON journals (company_id, source_module, posting_date);
CREATE INDEX journals_company_period_idx ON journals (company_id, period_id);

CREATE TRIGGER journals_set_updated_at
  BEFORE UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  journal_id uuid NOT NULL,
  line_no integer NOT NULL,
  account_id uuid NOT NULL,
  party_reference text,
  party_name text,
  cost_center text,
  project_code text,
  debit_poisha bigint NOT NULL DEFAULT 0,
  credit_poisha bigint NOT NULL DEFAULT 0,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT journal_lines_journal_line_unique UNIQUE (company_id, journal_id, line_no),
  CONSTRAINT journal_lines_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE CASCADE,
  CONSTRAINT journal_lines_account_fk FOREIGN KEY (company_id, account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT journal_lines_line_no_positive CHECK (line_no >= 1),
  CONSTRAINT journal_lines_amounts_non_negative CHECK (debit_poisha >= 0 AND credit_poisha >= 0),
  CONSTRAINT journal_lines_one_side CHECK ((debit_poisha > 0) <> (credit_poisha > 0)),
  CONSTRAINT journal_lines_party_reference_length CHECK (
    party_reference IS NULL OR char_length(btrim(party_reference)) <= 200
  ),
  CONSTRAINT journal_lines_party_name_length CHECK (
    party_name IS NULL OR char_length(btrim(party_name)) <= 200
  ),
  CONSTRAINT journal_lines_cost_center_length CHECK (
    cost_center IS NULL OR char_length(btrim(cost_center)) <= 120
  ),
  CONSTRAINT journal_lines_project_code_length CHECK (
    project_code IS NULL OR char_length(btrim(project_code)) <= 120
  ),
  CONSTRAINT journal_lines_memo_length CHECK (memo IS NULL OR char_length(memo) <= 500)
);

CREATE INDEX journal_lines_company_journal_idx ON journal_lines (company_id, journal_id);
CREATE INDEX journal_lines_company_account_idx ON journal_lines (company_id, account_id);

CREATE TRIGGER journal_lines_set_updated_at
  BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Posted journals are immutable. The only permitted update to a POSTED row is the linked
-- POSTED -> REVERSED transition; a REVERSED row cannot be changed at all. Submitted/approved
-- content is frozen and may only move through the approval/posting state machine.
CREATE FUNCTION protect_journal_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft journals can be deleted'
        USING ERRCODE = '55000',
              HINT = 'Post a linked reversal instead of deleting posted history.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id <> OLD.id OR NEW.company_id <> OLD.company_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'journal identity and creator cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('POSTED', 'REVERSED') THEN
    IF OLD.status = 'REVERSED' THEN
      RAISE EXCEPTION 'a reversed journal is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.reversal_of_journal_id IS NOT NULL THEN
      RAISE EXCEPTION 'a reversal journal cannot be reversed; post a new correcting journal'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status <> 'REVERSED'
       OR NEW.reversed_by_journal_id IS NULL
       OR NEW.reversed_at IS NULL
       OR NEW.reversed_by IS NULL
       OR NEW.reversal_reason IS NULL
       OR NEW.journal_number IS DISTINCT FROM OLD.journal_number
       OR NEW.book_type IS DISTINCT FROM OLD.book_type
       OR NEW.period_id IS DISTINCT FROM OLD.period_id
       OR NEW.document_date IS DISTINCT FROM OLD.document_date
       OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
       OR NEW.source_module IS DISTINCT FROM OLD.source_module
       OR NEW.source_doc_id IS DISTINCT FROM OLD.source_doc_id
       OR NEW.source_doc_ref IS DISTINCT FROM OLD.source_doc_ref
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
       OR NEW.reversal_of_journal_id IS DISTINCT FROM OLD.reversal_of_journal_id
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by THEN
      RAISE EXCEPTION 'posted journals are immutable; use a linked reversal'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'DRAFT' THEN
    IF NEW.status NOT IN ('SUBMITTED', 'APPROVED', 'POSTED') THEN
      RAISE EXCEPTION 'invalid journal status transition'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.book_type IS DISTINCT FROM OLD.book_type
       OR NEW.period_id IS DISTINCT FROM OLD.period_id
       OR NEW.document_date IS DISTINCT FROM OLD.document_date
       OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
       OR NEW.source_module IS DISTINCT FROM OLD.source_module
       OR NEW.source_doc_id IS DISTINCT FROM OLD.source_doc_id
       OR NEW.source_doc_ref IS DISTINCT FROM OLD.source_doc_ref
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
       OR NEW.reversal_of_journal_id IS DISTINCT FROM OLD.reversal_of_journal_id
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
      RAISE EXCEPTION 'submitted journal content is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'REVERSED' THEN
    RAISE EXCEPTION 'only a posted journal can be reversed'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'SUBMITTED' AND (NEW.submitted_at IS NULL OR NEW.submitted_by IS NULL) THEN
    RAISE EXCEPTION 'a submitted journal requires submitted_at and submitted_by'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' AND (NEW.approved_at IS NULL OR NEW.approved_by IS NULL) THEN
    RAISE EXCEPTION 'an approved journal requires approved_at and approved_by'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journals_protect_posted
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION protect_journal_rows();

-- Journal lines may only be inserted, updated or deleted while the parent journal is DRAFT.
CREATE FUNCTION protect_journal_lines()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
    FROM journals
   WHERE company_id = COALESCE(NEW.company_id, OLD.company_id)
     AND id = COALESCE(NEW.journal_id, OLD.journal_id);

  IF parent_status IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'journal lines are immutable after submission; use a linked reversal'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER journal_lines_protect_posted
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION protect_journal_lines();

-- Deferred integrity check: every non-draft journal must have at least two lines and exactly
-- equal debit/credit totals with a positive debit. Deferred means the service can insert the
-- header and lines in any order inside one transaction; the check runs at COMMIT.
CREATE FUNCTION validate_journal_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_company uuid;
  target_journal uuid;
  journal_status text;
  line_count integer;
  debit_total bigint;
  credit_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    target_company := NEW.company_id;
    target_journal := NEW.id;
  ELSE
    target_company := COALESCE(NEW.company_id, OLD.company_id);
    target_journal := COALESCE(NEW.journal_id, OLD.journal_id);
  END IF;

  SELECT status INTO journal_status
    FROM journals
   WHERE company_id = target_company AND id = target_journal;
  IF NOT FOUND OR journal_status = 'DRAFT' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), COALESCE(sum(debit_poisha), 0), COALESCE(sum(credit_poisha), 0)
    INTO line_count, debit_total, credit_total
    FROM journal_lines
   WHERE company_id = target_company AND journal_id = target_journal;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'journal % must have at least two lines', target_journal
      USING ERRCODE = '23514';
  END IF;
  IF debit_total <= 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal % is unbalanced: debit % vs credit % poisha', target_journal, debit_total, credit_total
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journals_integrity_check
  AFTER INSERT OR UPDATE ON journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_journal_integrity();

CREATE CONSTRAINT TRIGGER journal_lines_integrity_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_journal_integrity();

COMMENT ON TABLE journals IS
  'Server-authoritative journal headers. Posted rows are immutable; corrections use linked reversals.';
COMMENT ON COLUMN journals.journal_number IS
  'Allocated from number_sequences at posting: <company JOURNAL prefix><period code>-<padded sequence>. Never reused.';
COMMENT ON COLUMN journals.attachment_reference IS
  'External evidence/attachment reference only. No file content is stored in this phase.';
COMMENT ON TABLE journal_lines IS
  'Balanced journal lines. party_reference/party_name are descriptive until the Phase 6 party master exists.';
COMMENT ON FUNCTION validate_journal_integrity() IS
  'Deferred database backstop for at-least-two-lines and exact debit/credit equality on every non-draft journal.';

-- Opening-balance posting lifecycle. Phase 4 deliberately allowed only DRAFT/SUBMITTED. Phase 5
-- adds explicit approval and a single posted journal link, without creating a second posting path.
ALTER TABLE opening_balance_batches
  DROP CONSTRAINT opening_balance_batches_status_check;
ALTER TABLE opening_balance_batches
  ADD CONSTRAINT opening_balance_batches_status_check CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED')
  );

ALTER TABLE opening_balance_batches
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN posted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN journal_id uuid,
  ADD COLUMN posting_idempotency_key text,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN reversal_journal_id uuid;

ALTER TABLE opening_balance_batches
  ADD CONSTRAINT opening_balance_batches_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT opening_balance_batches_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT opening_balance_batches_posting_key_length CHECK (
    posting_idempotency_key IS NULL OR char_length(posting_idempotency_key) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT opening_balance_batches_post_guard CHECK (
    status NOT IN ('POSTED', 'REVERSED')
    OR (journal_id IS NOT NULL AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
  ),
  ADD CONSTRAINT opening_balance_batches_approval_guard CHECK (
    status NOT IN ('APPROVED', 'POSTED', 'REVERSED')
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  ADD CONSTRAINT opening_balance_batches_reversal_guard CHECK (
    status <> 'REVERSED'
    OR (reversal_journal_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL)
  );

ALTER TABLE opening_balance_batches
  DROP CONSTRAINT opening_balance_batches_submit_guard;
ALTER TABLE opening_balance_batches
  ADD CONSTRAINT opening_balance_batches_submit_guard CHECK (
    status = 'DRAFT'
    OR (
      balanced
      AND total_debit_poisha = total_credit_poisha
      AND total_debit_poisha > 0
      AND evidence_reference IS NOT NULL
      AND char_length(btrim(evidence_reference)) > 0
      AND submitted_at IS NOT NULL
    )
  );

DROP INDEX opening_balance_batches_one_submitted;
CREATE UNIQUE INDEX opening_balance_batches_one_open
  ON opening_balance_batches (company_id)
  WHERE status IN ('SUBMITTED', 'APPROVED');
CREATE UNIQUE INDEX opening_balance_batches_one_posted
  ON opening_balance_batches (company_id)
  WHERE status IN ('POSTED', 'REVERSED');
CREATE UNIQUE INDEX opening_balance_batches_journal_unique
  ON opening_balance_batches (company_id, journal_id)
  WHERE journal_id IS NOT NULL;
CREATE UNIQUE INDEX opening_balance_batches_posting_key_unique
  ON opening_balance_batches (company_id, posting_idempotency_key)
  WHERE posting_idempotency_key IS NOT NULL;

COMMENT ON COLUMN opening_balance_batches.status IS
  'DRAFT -> SUBMITTED -> APPROVED -> POSTED; REVERSED only through a linked journal reversal.';
COMMENT ON COLUMN opening_balance_batches.journal_id IS
  'Permanent link to the single posted opening-balance journal. Unique per company.';
