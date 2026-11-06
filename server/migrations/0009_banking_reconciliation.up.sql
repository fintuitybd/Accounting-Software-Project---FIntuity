-- Phase 10 banking, MFS and reconciliation.
--
-- Imported statements are evidence, not postings. Every statement line is immutable after import;
-- matching creates explicit allocations to posted journal lines and may never exceed either side.
-- Unexplained activity is resolved through a maker-checker GL request, a configured fee rule or an
-- explicit exclusion with a reason. Reconciliation is persisted per bank account and period, and a
-- reviewed sign-off is locked when the accounting period is closed or locked.
--
-- Fee rates are configuration, never a universal constant. A rule must name its fee expense account
-- and its policy evidence before it can be used.

-- Bank transfers are their own numbered internal document. Existing fiscal years receive the new
-- sequence without changing any current counter.
ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN', 'MUSHAK_63', 'MUSHAK_67',
      'TREASURY_CERTIFICATE', 'BANK_TRANSFER'
    )
  );

INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
SELECT fy.company_id, fy.id, 'BANK_TRANSFER', 'TRF-', 1, 4
  FROM fiscal_years fy
ON CONFLICT (company_id, fiscal_year_id, doc_type) DO NOTHING;

-- Reconciliation-generated journals use a distinct source module so they cannot be submitted or
-- posted through the generic manual-journal routes and bypass the banking approval workflow.
ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION'
    )
  );

CREATE TABLE bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'IMPORTED',
  source_file_name text NOT NULL,
  source_mime_type text NOT NULL,
  source_file_hash text NOT NULL,
  source_content text NOT NULL,
  mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_rows_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  imported_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_statements_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_statements_company_account_id_unique UNIQUE (company_id, id, bank_account_id),
  CONSTRAINT bank_statements_company_file_unique UNIQUE (company_id, bank_account_id, source_file_hash),
  CONSTRAINT bank_statements_company_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT bank_statements_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statements_status_check CHECK (status IN ('IMPORTED', 'PARTIAL', 'REJECTED')),
  CONSTRAINT bank_statements_file_name_length CHECK (char_length(btrim(source_file_name)) BETWEEN 1 AND 255),
  CONSTRAINT bank_statements_mime_check CHECK (
    source_mime_type IN ('text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ),
  CONSTRAINT bank_statements_hash_length CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT bank_statements_content_bounded CHECK (char_length(source_content) BETWEEN 1 AND 5000000),
  CONSTRAINT bank_statements_row_counts CHECK (
    row_count BETWEEN 0 AND 5000
    AND valid_count >= 0 AND error_count >= 0 AND duplicate_count >= 0
    AND valid_count + error_count = row_count
  ),
  CONSTRAINT bank_statements_error_rows_array CHECK (jsonb_typeof(error_rows_json) = 'array'),
  CONSTRAINT bank_statements_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
);

CREATE INDEX bank_statements_company_account_idx
  ON bank_statements (company_id, bank_account_id, imported_at DESC);

CREATE TRIGGER bank_statements_set_updated_at
  BEFORE UPDATE ON bank_statements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An imported batch is evidence. It is never edited or deleted.
CREATE FUNCTION reject_bank_statement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'bank statement imports are immutable';
END;
$$;

CREATE TRIGGER bank_statements_immutable
  BEFORE UPDATE OR DELETE ON bank_statements
  FOR EACH ROW EXECUTE FUNCTION reject_bank_statement_mutation();

CREATE TABLE bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  statement_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  line_no integer NOT NULL,
  value_date date NOT NULL,
  description text NOT NULL,
  reference text,
  debit_poisha bigint NOT NULL DEFAULT 0,
  credit_poisha bigint NOT NULL DEFAULT 0,
  balance_poisha bigint,
  status text NOT NULL DEFAULT 'UNMATCHED',
  fingerprint text NOT NULL,
  match_score integer,
  match_reason text,
  matched_journal_id uuid,
  exception_owner_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  exception_note text,
  excluded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_statement_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_statement_lines_statement_line_unique UNIQUE (company_id, statement_id, line_no),
  CONSTRAINT bank_statement_lines_fingerprint_unique UNIQUE (company_id, bank_account_id, fingerprint),
  CONSTRAINT bank_statement_lines_statement_fk FOREIGN KEY (company_id, statement_id, bank_account_id)
    REFERENCES bank_statements (company_id, id, bank_account_id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_lines_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_lines_journal_fk FOREIGN KEY (company_id, matched_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_lines_status_check CHECK (
    status IN ('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'CATEGORIZED', 'EXCLUDED')
  ),
  CONSTRAINT bank_statement_lines_amounts CHECK (
    debit_poisha >= 0 AND credit_poisha >= 0 AND (debit_poisha > 0) <> (credit_poisha > 0)
  ),
  CONSTRAINT bank_statement_lines_line_no_positive CHECK (line_no >= 1),
  CONSTRAINT bank_statement_lines_description_length CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT bank_statement_lines_reference_length CHECK (
    reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 200
  ),
  CONSTRAINT bank_statement_lines_fingerprint_length CHECK (char_length(fingerprint) BETWEEN 1 AND 200),
  CONSTRAINT bank_statement_lines_match_score_range CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
  CONSTRAINT bank_statement_lines_match_reason_length CHECK (
    match_reason IS NULL OR char_length(btrim(match_reason)) BETWEEN 1 AND 500
  ),
  CONSTRAINT bank_statement_lines_exception_note_length CHECK (
    exception_note IS NULL OR char_length(btrim(exception_note)) <= 500
  ),
  CONSTRAINT bank_statement_lines_excluded_reason_length CHECK (
    excluded_reason IS NULL OR char_length(btrim(excluded_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT bank_statement_lines_matched_fields CHECK (
    status <> 'MATCHED' OR (matched_journal_id IS NOT NULL AND match_score IS NOT NULL)
  ),
  CONSTRAINT bank_statement_lines_excluded_fields CHECK (
    status <> 'EXCLUDED' OR excluded_reason IS NOT NULL
  )
);

CREATE INDEX bank_statement_lines_company_account_date_idx
  ON bank_statement_lines (company_id, bank_account_id, value_date, line_no);
CREATE INDEX bank_statement_lines_company_status_idx
  ON bank_statement_lines (company_id, bank_account_id, status);
CREATE INDEX bank_statement_lines_company_journal_idx
  ON bank_statement_lines (company_id, matched_journal_id);

CREATE TRIGGER bank_statement_lines_set_updated_at
  BEFORE UPDATE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The imported facts never change. Status, matching, fee and exception metadata may change.
CREATE FUNCTION protect_bank_statement_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank statement lines cannot be deleted';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.statement_id <> OLD.statement_id
     OR NEW.bank_account_id <> OLD.bank_account_id
     OR NEW.line_no <> OLD.line_no
     OR NEW.value_date <> OLD.value_date
     OR NEW.description <> OLD.description
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.debit_poisha <> OLD.debit_poisha
     OR NEW.credit_poisha <> OLD.credit_poisha
     OR NEW.balance_poisha IS DISTINCT FROM OLD.balance_poisha
     OR NEW.fingerprint <> OLD.fingerprint THEN
    RAISE EXCEPTION 'bank statement line imported facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_statement_lines_protect_imported_facts
  BEFORE UPDATE OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION protect_bank_statement_line();

CREATE TABLE bank_statement_line_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  statement_line_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  journal_line_id uuid NOT NULL,
  amount_poisha bigint NOT NULL,
  match_type text NOT NULL,
  match_score integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  matched_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  matched_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_statement_line_matches_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_statement_line_matches_line_fk FOREIGN KEY (company_id, statement_line_id)
    REFERENCES bank_statement_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_line_matches_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_line_matches_journal_line_fk FOREIGN KEY (company_id, journal_line_id)
    REFERENCES journal_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_line_matches_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_statement_line_matches_type_check CHECK (
    match_type IN ('EXACT', 'PARTIAL', 'MANUAL', 'SPLIT')
  ),
  CONSTRAINT bank_statement_line_matches_status_check CHECK (status IN ('ACTIVE', 'REVERSED')),
  CONSTRAINT bank_statement_line_matches_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT bank_statement_line_matches_score_range CHECK (match_score BETWEEN 0 AND 100),
  CONSTRAINT bank_statement_line_matches_reason_length CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT bank_statement_line_matches_reversal_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL AND char_length(btrim(reversal_reason)) BETWEEN 3 AND 500)
  )
);

CREATE UNIQUE INDEX bank_statement_line_matches_one_active
  ON bank_statement_line_matches (company_id, statement_line_id, journal_line_id)
  WHERE status = 'ACTIVE';
CREATE INDEX bank_statement_line_matches_line_idx
  ON bank_statement_line_matches (company_id, statement_line_id, status);
CREATE INDEX bank_statement_line_matches_journal_line_idx
  ON bank_statement_line_matches (company_id, journal_line_id, status);

-- A match may only consume an available amount on the statement line and on the posted journal line,
-- in the same direction and on the bank account's mapped GL account.
CREATE FUNCTION validate_bank_statement_line_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  statement_line record;
  bank_gl_id uuid;
  journal_row record;
  allocated_on_journal_line bigint;
  allocated_on_statement_line bigint;
  journal_line_amount bigint;
  statement_line_amount bigint;
BEGIN
  IF NEW.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT sl.status, sl.bank_account_id, sl.debit_poisha, sl.credit_poisha
    INTO statement_line
    FROM bank_statement_lines sl
   WHERE sl.company_id = NEW.company_id AND sl.id = NEW.statement_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'statement line does not belong to this company'
      USING ERRCODE = '23503';
  END IF;
  IF statement_line.status = 'EXCLUDED' THEN
    RAISE EXCEPTION 'an excluded statement line cannot be matched'
      USING ERRCODE = '23514';
  END IF;
  IF statement_line.bank_account_id <> NEW.bank_account_id THEN
    RAISE EXCEPTION 'statement line belongs to another bank account'
      USING ERRCODE = '23514';
  END IF;

  SELECT ba.gl_account_id
    INTO bank_gl_id
    FROM bank_accounts ba
   WHERE ba.company_id = NEW.company_id AND ba.id = NEW.bank_account_id;

  SELECT jl.journal_id, jl.account_id, jl.debit_poisha, jl.credit_poisha, j.status AS journal_status
    INTO journal_row
    FROM journal_lines jl
    JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
   WHERE jl.company_id = NEW.company_id AND jl.id = NEW.journal_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal line does not belong to this company'
      USING ERRCODE = '23503';
  END IF;
  IF journal_row.journal_id <> NEW.journal_id THEN
    RAISE EXCEPTION 'journal line does not belong to the supplied journal'
      USING ERRCODE = '23514';
  END IF;
  IF journal_row.journal_status <> 'POSTED' THEN
    RAISE EXCEPTION 'only a posted journal can be matched'
      USING ERRCODE = '23514';
  END IF;
  IF journal_row.account_id <> bank_gl_id THEN
    RAISE EXCEPTION 'journal line is not on the bank account GL account'
      USING ERRCODE = '23514';
  END IF;
  IF statement_line.debit_poisha > 0 AND journal_row.debit_poisha = 0 THEN
    RAISE EXCEPTION 'statement debit must match a journal debit to the bank account'
      USING ERRCODE = '23514';
  END IF;
  IF statement_line.credit_poisha > 0 AND journal_row.credit_poisha = 0 THEN
    RAISE EXCEPTION 'statement credit must match a journal credit to the bank account'
      USING ERRCODE = '23514';
  END IF;

  journal_line_amount := journal_row.debit_poisha + journal_row.credit_poisha;
  statement_line_amount := statement_line.debit_poisha + statement_line.credit_poisha;

  SELECT COALESCE(sum(amount_poisha), 0)
    INTO allocated_on_journal_line
    FROM bank_statement_line_matches
   WHERE company_id = NEW.company_id
     AND journal_line_id = NEW.journal_line_id
     AND status = 'ACTIVE'
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT COALESCE(sum(amount_poisha), 0)
    INTO allocated_on_statement_line
    FROM bank_statement_line_matches
   WHERE company_id = NEW.company_id
     AND statement_line_id = NEW.statement_line_id
     AND status = 'ACTIVE'
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF allocated_on_journal_line + NEW.amount_poisha > journal_line_amount THEN
    RAISE EXCEPTION 'the journal line has less than the requested unallocated amount'
      USING ERRCODE = '23514';
  END IF;
  IF allocated_on_statement_line + NEW.amount_poisha > statement_line_amount THEN
    RAISE EXCEPTION 'the statement line has less than the requested unallocated amount'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_statement_line_matches_validate
  BEFORE INSERT OR UPDATE ON bank_statement_line_matches
  FOR EACH ROW EXECUTE FUNCTION validate_bank_statement_line_match();

CREATE FUNCTION protect_bank_statement_line_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank statement matches cannot be deleted';
  END IF;
  IF OLD.status = 'REVERSED' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'a reversed bank match cannot be reactivated';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.bank_account_id <> OLD.bank_account_id
     OR NEW.statement_line_id <> OLD.statement_line_id
     OR NEW.journal_id <> OLD.journal_id
     OR NEW.journal_line_id <> OLD.journal_line_id
     OR NEW.amount_poisha <> OLD.amount_poisha
     OR NEW.match_type <> OLD.match_type
     OR NEW.match_score <> OLD.match_score
     OR NEW.reason <> OLD.reason
     OR NEW.matched_by <> OLD.matched_by
     OR NEW.matched_at <> OLD.matched_at THEN
    RAISE EXCEPTION 'bank match facts are immutable; reverse and re-match instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_statement_line_matches_protect
  BEFORE UPDATE OR DELETE ON bank_statement_line_matches
  FOR EACH ROW EXECUTE FUNCTION protect_bank_statement_line_match();

-- The statement line status is derived from active allocations. It cannot drift from the matches.
CREATE FUNCTION refresh_bank_statement_line_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_line_id uuid;
  target_company_id uuid;
  line_row record;
  allocated bigint;
  latest_journal_id uuid;
  latest_score integer;
  latest_reason text;
BEGIN
  target_line_id := COALESCE(NEW.statement_line_id, OLD.statement_line_id);
  target_company_id := COALESCE(NEW.company_id, OLD.company_id);

  SELECT status, debit_poisha, credit_poisha
    INTO line_row
    FROM bank_statement_lines
   WHERE company_id = target_company_id AND id = target_line_id
   FOR UPDATE;

  IF NOT FOUND OR line_row.status = 'EXCLUDED' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(amount_poisha), 0)
    INTO allocated
    FROM bank_statement_line_matches
   WHERE company_id = target_company_id
     AND statement_line_id = target_line_id
     AND status = 'ACTIVE';

  SELECT journal_id, match_score, reason
    INTO latest_journal_id, latest_score, latest_reason
    FROM bank_statement_line_matches
   WHERE company_id = target_company_id
     AND statement_line_id = target_line_id
     AND status = 'ACTIVE'
   ORDER BY matched_at DESC, id DESC
   LIMIT 1;

  UPDATE bank_statement_lines
     SET status = CASE
           WHEN allocated = 0 THEN 'UNMATCHED'
           WHEN allocated < (line_row.debit_poisha + line_row.credit_poisha) THEN 'PARTIALLY_MATCHED'
           ELSE 'MATCHED'
         END,
         matched_journal_id = latest_journal_id,
         match_score = latest_score,
         match_reason = latest_reason,
         updated_at = now()
   WHERE company_id = target_company_id AND id = target_line_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER bank_statement_line_matches_refresh_status
  AFTER INSERT OR UPDATE ON bank_statement_line_matches
  FOR EACH ROW EXECUTE FUNCTION refresh_bank_statement_line_status();

CREATE TABLE bank_gl_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  statement_line_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  amount_poisha bigint NOT NULL,
  tax_poisha bigint NOT NULL DEFAULT 0,
  primary_account_id uuid NOT NULL,
  tax_account_id uuid,
  party_id uuid,
  reason text NOT NULL,
  evidence_reference text,
  journal_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  cancellation_reason text,
  reversal_journal_id uuid,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_gl_requests_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_gl_requests_company_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT bank_gl_requests_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_line_fk FOREIGN KEY (company_id, statement_line_id)
    REFERENCES bank_statement_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_primary_account_fk FOREIGN KEY (company_id, primary_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_tax_account_fk FOREIGN KEY (company_id, tax_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_gl_requests_status_check CHECK (
    status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'REVERSED')
  ),
  CONSTRAINT bank_gl_requests_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT bank_gl_requests_tax_range CHECK (tax_poisha >= 0 AND tax_poisha <= amount_poisha),
  CONSTRAINT bank_gl_requests_tax_account CHECK (tax_poisha = 0 OR tax_account_id IS NOT NULL),
  CONSTRAINT bank_gl_requests_reason_length CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT bank_gl_requests_evidence_length CHECK (
    evidence_reference IS NULL OR char_length(btrim(evidence_reference)) <= 500
  ),
  CONSTRAINT bank_gl_requests_cancellation_reason_length CHECK (
    cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT bank_gl_requests_reversal_reason_length CHECK (
    reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT bank_gl_requests_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT bank_gl_requests_posted_fields CHECK (
    status NOT IN ('POSTED', 'REVERSED')
    OR (journal_id IS NOT NULL AND approved_by IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT bank_gl_requests_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversal_journal_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX bank_gl_requests_one_open_per_line
  ON bank_gl_requests (company_id, statement_line_id)
  WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED');
CREATE INDEX bank_gl_requests_company_status_idx
  ON bank_gl_requests (company_id, status, created_at);
CREATE INDEX bank_gl_requests_company_line_idx
  ON bank_gl_requests (company_id, statement_line_id);

CREATE TRIGGER bank_gl_requests_set_updated_at
  BEFORE UPDATE ON bank_gl_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION protect_bank_gl_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank GL requests cannot be deleted';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed bank GL request cannot be changed';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status <> 'REVERSED' THEN
    RAISE EXCEPTION 'a posted bank GL request can only move to REVERSED through a linked journal reversal';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
     AND (NEW.reversal_journal_id IS NULL OR NEW.reversed_at IS NULL
          OR NEW.reversed_by IS NULL OR NEW.reversal_reason IS NULL) THEN
    RAISE EXCEPTION 'a reversed bank GL request requires the linked reversal journal and reason';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.bank_account_id <> OLD.bank_account_id
     OR NEW.statement_line_id <> OLD.statement_line_id
     OR NEW.amount_poisha <> OLD.amount_poisha
     OR NEW.tax_poisha <> OLD.tax_poisha
     OR NEW.primary_account_id <> OLD.primary_account_id
     OR NEW.tax_account_id IS DISTINCT FROM OLD.tax_account_id
     OR NEW.party_id IS DISTINCT FROM OLD.party_id
     OR NEW.reason <> OLD.reason
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.created_by <> OLD.created_by
     OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'bank GL request facts are immutable; cancel and create a new request';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_gl_requests_protect
  BEFORE UPDATE OR DELETE ON bank_gl_requests
  FOR EACH ROW EXECUTE FUNCTION protect_bank_gl_request();

CREATE TABLE bank_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  rate_bps integer NOT NULL DEFAULT 0,
  fixed_poisha bigint NOT NULL DEFAULT 0,
  fee_account_id uuid NOT NULL,
  policy_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_fee_rules_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_fee_rules_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_rules_account_fk FOREIGN KEY (company_id, fee_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_rules_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT bank_fee_rules_rate_range CHECK (rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT bank_fee_rules_fixed_non_negative CHECK (fixed_poisha >= 0),
  CONSTRAINT bank_fee_rules_non_zero CHECK (rate_bps > 0 OR fixed_poisha > 0),
  CONSTRAINT bank_fee_rules_policy_length CHECK (char_length(btrim(policy_reference)) BETWEEN 3 AND 500),
  CONSTRAINT bank_fee_rules_effective_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX bank_fee_rules_company_account_idx
  ON bank_fee_rules (company_id, bank_account_id, effective_from DESC);

CREATE TRIGGER bank_fee_rules_set_updated_at
  BEFORE UPDATE ON bank_fee_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bank_fee_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  statement_line_id uuid NOT NULL,
  fee_rule_id uuid,
  fee_account_id uuid NOT NULL,
  computed_poisha bigint,
  amount_poisha bigint NOT NULL,
  override_reason text,
  evidence_reference text,
  basis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  journal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  reversal_journal_id uuid,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_reason text,
  idempotency_key text NOT NULL,
  posted_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_fee_postings_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_fee_postings_company_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT bank_fee_postings_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_line_fk FOREIGN KEY (company_id, statement_line_id)
    REFERENCES bank_statement_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_rule_fk FOREIGN KEY (company_id, fee_rule_id)
    REFERENCES bank_fee_rules (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_account_fk FOREIGN KEY (company_id, fee_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_fee_postings_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT bank_fee_postings_reversal_reason_length CHECK (
    reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT bank_fee_postings_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversal_journal_id IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL)
  ),
  CONSTRAINT bank_fee_postings_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT bank_fee_postings_computed_positive CHECK (computed_poisha IS NULL OR computed_poisha > 0),
  CONSTRAINT bank_fee_postings_override_evidence CHECK (
    (computed_poisha IS NOT NULL AND amount_poisha = computed_poisha)
    OR (
      override_reason IS NOT NULL AND char_length(btrim(override_reason)) BETWEEN 3 AND 500
      AND evidence_reference IS NOT NULL AND char_length(btrim(evidence_reference)) BETWEEN 1 AND 500
    )
  ),
  CONSTRAINT bank_fee_postings_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX bank_fee_postings_one_posted_per_line
  ON bank_fee_postings (company_id, statement_line_id)
  WHERE status = 'POSTED';
CREATE INDEX bank_fee_postings_company_account_idx
  ON bank_fee_postings (company_id, bank_account_id, posted_at DESC);

CREATE FUNCTION reject_bank_fee_posting_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'posted bank fees are immutable';
  END IF;
  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
     AND NEW.reversal_journal_id IS NOT NULL AND NEW.reversed_at IS NOT NULL
     AND NEW.reversed_by IS NOT NULL AND NEW.reversal_reason IS NOT NULL
     AND NEW.company_id = OLD.company_id
     AND NEW.bank_account_id = OLD.bank_account_id
     AND NEW.statement_line_id = OLD.statement_line_id
     AND NEW.fee_rule_id IS NOT DISTINCT FROM OLD.fee_rule_id
     AND NEW.fee_account_id = OLD.fee_account_id
     AND NEW.computed_poisha IS NOT DISTINCT FROM OLD.computed_poisha
     AND NEW.amount_poisha = OLD.amount_poisha
     AND NEW.override_reason IS NOT DISTINCT FROM OLD.override_reason
     AND NEW.evidence_reference IS NOT DISTINCT FROM OLD.evidence_reference
     AND NEW.basis_json = OLD.basis_json
     AND NEW.journal_id = OLD.journal_id
     AND NEW.idempotency_key = OLD.idempotency_key
     AND NEW.posted_by = OLD.posted_by
     AND NEW.posted_at = OLD.posted_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'posted bank fees are immutable; only a linked journal reversal may mark the posting REVERSED';
END;
$$;

CREATE TRIGGER bank_fee_postings_immutable
  BEFORE UPDATE OR DELETE ON bank_fee_postings
  FOR EACH ROW EXECUTE FUNCTION reject_bank_fee_posting_mutation();

CREATE TABLE bank_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  transfer_number text NOT NULL,
  from_bank_account_id uuid NOT NULL,
  to_bank_account_id uuid NOT NULL,
  transfer_date date NOT NULL,
  amount_poisha bigint NOT NULL,
  reference text NOT NULL,
  narration text,
  status text NOT NULL DEFAULT 'POSTED',
  journal_id uuid NOT NULL,
  reversal_journal_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transfers_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_transfers_number_unique UNIQUE (company_id, transfer_number),
  CONSTRAINT bank_transfers_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT bank_transfers_from_fk FOREIGN KEY (company_id, from_bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_transfers_to_fk FOREIGN KEY (company_id, to_bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_transfers_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_transfers_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_transfers_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT bank_transfers_accounts_differ CHECK (from_bank_account_id <> to_bank_account_id),
  CONSTRAINT bank_transfers_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT bank_transfers_reference_length CHECK (char_length(btrim(reference)) BETWEEN 1 AND 200),
  CONSTRAINT bank_transfers_narration_length CHECK (
    narration IS NULL OR char_length(btrim(narration)) <= 500
  ),
  CONSTRAINT bank_transfers_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT bank_transfers_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  )
);

CREATE INDEX bank_transfers_company_date_idx ON bank_transfers (company_id, transfer_date DESC, created_at DESC);
CREATE INDEX bank_transfers_company_from_idx ON bank_transfers (company_id, from_bank_account_id);
CREATE INDEX bank_transfers_company_to_idx ON bank_transfers (company_id, to_bank_account_id);

CREATE TRIGGER bank_transfers_set_updated_at
  BEFORE UPDATE ON bank_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION protect_bank_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank transfers cannot be deleted';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed bank transfer cannot be changed';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.transfer_number <> OLD.transfer_number
     OR NEW.from_bank_account_id <> OLD.from_bank_account_id
     OR NEW.to_bank_account_id <> OLD.to_bank_account_id
     OR NEW.transfer_date <> OLD.transfer_date
     OR NEW.amount_poisha <> OLD.amount_poisha
     OR NEW.reference <> OLD.reference
     OR NEW.narration IS DISTINCT FROM OLD.narration
     OR NEW.journal_id <> OLD.journal_id
     OR NEW.created_by <> OLD.created_by
     OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'bank transfer facts are immutable; reverse instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_transfers_protect
  BEFORE UPDATE OR DELETE ON bank_transfers
  FOR EACH ROW EXECUTE FUNCTION protect_bank_transfer();

-- If a matched journal, fee journal, create-GL journal or transfer journal is reversed through the
-- ledger workflow, every linked banking record must move with it. The match-status trigger then
-- rebuilds the statement-line status. This keeps a reversal linked instead of leaving a stale
-- "matched", "posted" or "transfer posted" state behind.
CREATE FUNCTION sync_banking_links_on_journal_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'REVERSED' AND OLD.status = 'POSTED' THEN
    UPDATE bank_statement_line_matches
       SET status = 'REVERSED',
           reversed_at = now(),
           reversed_by = NEW.reversed_by,
           reversal_reason = COALESCE(NEW.reversal_reason, 'Linked journal reversed through the ledger workflow.')
     WHERE company_id = NEW.company_id AND journal_id = NEW.id AND status = 'ACTIVE';

    UPDATE bank_fee_postings
       SET status = 'REVERSED',
           reversal_journal_id = NEW.reversed_by_journal_id,
           reversed_at = now(),
           reversed_by = NEW.reversed_by,
           reversal_reason = COALESCE(NEW.reversal_reason, 'Linked fee journal reversed through the ledger workflow.')
     WHERE company_id = NEW.company_id AND journal_id = NEW.id AND status = 'POSTED';

    UPDATE bank_gl_requests
       SET status = 'REVERSED',
           reversal_journal_id = NEW.reversed_by_journal_id,
           reversed_at = now(),
           reversed_by = NEW.reversed_by,
           reversal_reason = COALESCE(NEW.reversal_reason, 'Linked create-GL journal reversed through the ledger workflow.')
     WHERE company_id = NEW.company_id AND journal_id = NEW.id AND status = 'POSTED';

    UPDATE bank_transfers
       SET status = 'REVERSED',
           reversal_journal_id = NEW.reversed_by_journal_id,
           reversed_at = now(),
           reversed_by = NEW.reversed_by
     WHERE company_id = NEW.company_id AND journal_id = NEW.id AND status = 'POSTED';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER journals_sync_banking_links_on_reversal
  AFTER UPDATE OF status ON journals
  FOR EACH ROW EXECUTE FUNCTION sync_banking_links_on_journal_reversal();

CREATE TABLE bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  bank_account_id uuid NOT NULL,
  period_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  difference_poisha bigint NOT NULL DEFAULT 0,
  prepared_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  prepared_at timestamptz,
  reviewed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_note text,
  evidence_reference text,
  locked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_reconciliations_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_reconciliations_account_period_unique UNIQUE (company_id, bank_account_id, period_id),
  CONSTRAINT bank_reconciliations_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_reconciliations_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_reconciliations_status_check CHECK (
    status IN ('DRAFT', 'PREPARED', 'REVIEWED', 'LOCKED')
  ),
  CONSTRAINT bank_reconciliations_prepared_fields CHECK (
    status IN ('DRAFT', 'LOCKED')
    OR (prepared_by IS NOT NULL AND prepared_at IS NOT NULL)
  ),
  CONSTRAINT bank_reconciliations_reviewed_fields CHECK (
    status <> 'REVIEWED'
    OR (prepared_by IS NOT NULL AND prepared_at IS NOT NULL
        AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT bank_reconciliations_segregation CHECK (
    prepared_by IS NULL OR reviewed_by IS NULL OR prepared_by <> reviewed_by
  ),
  CONSTRAINT bank_reconciliations_review_note_length CHECK (
    review_note IS NULL OR char_length(btrim(review_note)) <= 500
  ),
  CONSTRAINT bank_reconciliations_evidence_length CHECK (
    evidence_reference IS NULL OR char_length(btrim(evidence_reference)) <= 500
  )
);

CREATE INDEX bank_reconciliations_company_period_idx
  ON bank_reconciliations (company_id, period_id, status);

CREATE TRIGGER bank_reconciliations_set_updated_at
  BEFORE UPDATE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION protect_bank_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank reconciliations cannot be deleted';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.bank_account_id <> OLD.bank_account_id
     OR NEW.period_id <> OLD.period_id
     OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'bank reconciliation identity is immutable';
  END IF;
  IF OLD.status = 'LOCKED' AND NEW.status <> 'LOCKED' THEN
    RAISE EXCEPTION 'a locked bank reconciliation cannot be reopened in this phase';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_reconciliations_protect
  BEFORE UPDATE OR DELETE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION protect_bank_reconciliation();

-- Closing or locking an accounting period locks every reconciliation for that period. The lock is
-- recorded in the append-only audit trail even when the action is performed by the period endpoint.
CREATE FUNCTION lock_bank_reconciliations_for_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('CLOSED', 'LOCKED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    WITH affected AS (
      SELECT br.id, br.company_id, c.organisation_id, br.status
        FROM bank_reconciliations br
        JOIN companies c ON c.id = br.company_id
       WHERE br.company_id = NEW.company_id
         AND br.period_id = NEW.id
         AND br.status <> 'LOCKED'
    ), audited AS (
      INSERT INTO audit_events (
        organisation_id, company_id, actor_user_id, action, entity_type, entity_id,
        before_json, after_json, reason
      )
      SELECT organisation_id, company_id, NULL, 'bank_reconciliation.locked',
             'bank_reconciliation', id,
             jsonb_build_object('status', status),
             jsonb_build_object('status', 'LOCKED', 'periodStatus', NEW.status),
             'Accounting period ' || NEW.code || ' was closed or locked.'
        FROM affected
      RETURNING 1
    )
    UPDATE bank_reconciliations br
       SET status = 'LOCKED', locked_at = COALESCE(br.locked_at, now()), updated_at = now()
      FROM affected a
     WHERE br.company_id = NEW.company_id AND br.id = a.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER periods_lock_bank_reconciliations
  AFTER UPDATE OF status ON periods
  FOR EACH ROW EXECUTE FUNCTION lock_bank_reconciliations_for_period();

COMMENT ON TABLE bank_statements IS
  'Immutable imported bank/MFS statement batches. Source content is retained as evidence; import never posts.';
COMMENT ON TABLE bank_statement_lines IS
  'Imported statement facts. Status and matches are derived; the imported amount, date, reference and description never change.';
COMMENT ON TABLE bank_statement_line_matches IS
  'Explicit allocations from a statement line to a posted bank GL journal line. Reversal is a status change, never a delete.';
COMMENT ON TABLE bank_gl_requests IS
  'Maker-checker request to create and post a GL journal for an unexplained statement line.';
COMMENT ON TABLE bank_fee_rules IS
  'Configurable MFS/bank fee policy per account. No universal rate is seeded.';
COMMENT ON TABLE bank_fee_postings IS
  'One immutable fee journal per statement line, with rule snapshot or evidence-backed override.';
COMMENT ON TABLE bank_transfers IS
  'Internal transfers between bank/MFS/cash accounts, posted as one balanced journal and reversible by a linked reversal.';
COMMENT ON TABLE bank_reconciliations IS
  'Prepared/reviewed reconciliation per bank account and period, locked when the period is closed.';
