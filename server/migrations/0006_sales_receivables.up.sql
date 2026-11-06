-- Phase 7 sales documents, credit notes and receivables.
--
-- The sales subledger is derived from posted documents and receipt allocations, never from a mutable
-- "settled" flag. Posted documents, their lines and tax snapshots are immutable; corrections use a
-- linked document-level reversal. Money is BIGINT poisha; quantities are NUMERIC(18,4).
--
-- Mushak 6.3/6.7 serial series are internal, gap-free sequences. Their legal presentation format is
-- still subject to professional verification; the application labels them accordingly and blocks
-- posting until a named reviewer approves the exact rule-pack version.

-- Statutory serial series are separate from document numbers so a credit note can never consume a
-- 6.3 serial. Existing fiscal years receive the new sequences without changing any current counter.
ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN', 'MUSHAK_63', 'MUSHAK_67'
    )
  );

INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
SELECT fy.company_id, fy.id, 'MUSHAK_63', 'M63-', 1, 4
  FROM fiscal_years fy
ON CONFLICT (company_id, fiscal_year_id, doc_type) DO NOTHING;

INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
SELECT fy.company_id, fy.id, 'MUSHAK_67', 'M67-', 1, 4
  FROM fiscal_years fy
ON CONFLICT (company_id, fiscal_year_id, doc_type) DO NOTHING;

-- The sales service records external reviewer approval of the exact rule-pack version in a
-- company setting. The setting is configuration, not a claim that the application performed review.
ALTER TABLE company_settings DROP CONSTRAINT company_settings_key_check;
ALTER TABLE company_settings
  ADD CONSTRAINT company_settings_key_check CHECK (
    key IN ('language', 'approval_thresholds', 'tax', 'sales_tax_policy')
  );

CREATE TABLE sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  doc_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  document_no text,
  statutory_serial text,
  statutory_series text,
  party_id uuid NOT NULL,
  original_document_id uuid,
  original_document_no text,
  doc_date date NOT NULL,
  due_date date NOT NULL,
  payment_terms_days integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  narration_en text NOT NULL,
  narration_bn text,
  credit_reason text,
  attachment_reference text,
  subtotal_poisha bigint NOT NULL DEFAULT 0,
  discount_poisha bigint NOT NULL DEFAULT 0,
  vat_poisha bigint NOT NULL DEFAULT 0,
  gross_poisha bigint NOT NULL DEFAULT 0,
  tax_pack_version text,
  tax_decision_state text,
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz,
  posted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_journal_id uuid,
  posting_idempotency_key text,
  create_idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_documents_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT sales_documents_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_documents_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_documents_original_fk FOREIGN KEY (company_id, original_document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_documents_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_documents_type_check CHECK (doc_type IN ('SALES_INVOICE', 'CREDIT_NOTE')),
  CONSTRAINT sales_documents_status_check CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'REVERSED')),
  CONSTRAINT sales_documents_approved_only_credit CHECK (doc_type = 'CREDIT_NOTE' OR status <> 'APPROVED'),
  CONSTRAINT sales_documents_type_links CHECK (
    (doc_type = 'SALES_INVOICE' AND original_document_id IS NULL AND credit_reason IS NULL)
    OR (
      doc_type = 'CREDIT_NOTE'
      AND original_document_id IS NOT NULL
      AND original_document_no IS NOT NULL
      AND credit_reason IS NOT NULL
      AND char_length(btrim(credit_reason)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT sales_documents_not_self_original CHECK (original_document_id IS NULL OR original_document_id <> id),
  CONSTRAINT sales_documents_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT sales_documents_dates CHECK (due_date >= doc_date),
  CONSTRAINT sales_documents_payment_terms CHECK (payment_terms_days BETWEEN 0 AND 3650),
  CONSTRAINT sales_documents_amounts_non_negative CHECK (
    subtotal_poisha >= 0 AND discount_poisha >= 0 AND vat_poisha >= 0 AND gross_poisha >= 0
  ),
  CONSTRAINT sales_documents_amounts_foot CHECK (gross_poisha = subtotal_poisha + vat_poisha),
  CONSTRAINT sales_documents_narration_length CHECK (char_length(btrim(narration_en)) BETWEEN 1 AND 500),
  CONSTRAINT sales_documents_narration_bn_length CHECK (narration_bn IS NULL OR char_length(btrim(narration_bn)) <= 500),
  CONSTRAINT sales_documents_attachment_length CHECK (
    attachment_reference IS NULL OR char_length(btrim(attachment_reference)) <= 500
  ),
  CONSTRAINT sales_documents_series_check CHECK (
    statutory_series IS NULL
    OR (doc_type = 'SALES_INVOICE' AND statutory_series = 'M63')
    OR (doc_type = 'CREDIT_NOTE' AND statutory_series = 'M67')
  ),
  CONSTRAINT sales_documents_posted_fields CHECK (
    status NOT IN ('POSTED', 'REVERSED')
    OR (
      document_no IS NOT NULL
      AND statutory_serial IS NOT NULL
      AND statutory_series IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND tax_pack_version IS NOT NULL
      AND tax_decision_state IS NOT NULL
      AND char_length(btrim(document_no)) BETWEEN 1 AND 64
      AND char_length(btrim(statutory_serial)) BETWEEN 1 AND 64
    )
  ),
  CONSTRAINT sales_documents_draft_fields CHECK (
    status IN ('POSTED', 'REVERSED')
    OR (document_no IS NULL AND statutory_serial IS NULL AND statutory_series IS NULL)
  ),
  CONSTRAINT sales_documents_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  ),
  CONSTRAINT sales_documents_tax_state_check CHECK (
    tax_decision_state IS NULL
    OR tax_decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  ),
  CONSTRAINT sales_documents_original_no_length CHECK (
    original_document_no IS NULL OR char_length(btrim(original_document_no)) BETWEEN 1 AND 64
  ),
  CONSTRAINT sales_documents_idempotency_length CHECK (
    (posting_idempotency_key IS NULL OR char_length(posting_idempotency_key) BETWEEN 1 AND 200)
    AND (create_idempotency_key IS NULL OR char_length(create_idempotency_key) BETWEEN 1 AND 200)
  )
);

CREATE UNIQUE INDEX sales_documents_document_no_unique
  ON sales_documents (company_id, doc_type, document_no)
  WHERE document_no IS NOT NULL;
CREATE UNIQUE INDEX sales_documents_serial_unique
  ON sales_documents (company_id, statutory_series, statutory_serial)
  WHERE statutory_serial IS NOT NULL;
CREATE UNIQUE INDEX sales_documents_posting_idempotency_unique
  ON sales_documents (company_id, posting_idempotency_key)
  WHERE posting_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX sales_documents_create_idempotency_unique
  ON sales_documents (company_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;
CREATE INDEX sales_documents_company_date_idx ON sales_documents (company_id, doc_date DESC, created_at DESC);
CREATE INDEX sales_documents_company_party_idx ON sales_documents (company_id, party_id, due_date);
CREATE INDEX sales_documents_company_status_idx ON sales_documents (company_id, status, doc_date DESC);
CREATE INDEX sales_documents_company_original_idx ON sales_documents (company_id, original_document_id)
  WHERE original_document_id IS NOT NULL;

CREATE TRIGGER sales_documents_set_updated_at
  BEFORE UPDATE ON sales_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_id uuid,
  description_en text NOT NULL,
  description_bn text,
  quantity numeric(18,4) NOT NULL,
  unit text NOT NULL,
  unit_price_poisha bigint NOT NULL,
  discount_poisha bigint NOT NULL DEFAULT 0,
  tax_category text NOT NULL,
  revenue_account_id uuid NOT NULL,
  warehouse_id uuid,
  original_line_id uuid,
  stock_movement_id uuid,
  line_base_poisha bigint NOT NULL,
  vat_poisha bigint NOT NULL,
  gross_poisha bigint NOT NULL,
  tax_rate_bps integer NOT NULL,
  tax_rule_id text,
  tax_decision_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_document_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT sales_document_lines_document_line_unique UNIQUE (company_id, document_id, line_no),
  CONSTRAINT sales_document_lines_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_document_lines_item_fk FOREIGN KEY (company_id, item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_lines_revenue_fk FOREIGN KEY (company_id, revenue_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_lines_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_lines_original_fk FOREIGN KEY (company_id, original_line_id)
    REFERENCES sales_document_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_lines_stock_fk FOREIGN KEY (company_id, stock_movement_id)
    REFERENCES stock_movements (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_lines_line_no_positive CHECK (line_no >= 1),
  CONSTRAINT sales_document_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_document_lines_price_non_negative CHECK (unit_price_poisha >= 0),
  CONSTRAINT sales_document_lines_discount_non_negative CHECK (discount_poisha >= 0),
  CONSTRAINT sales_document_lines_amounts_non_negative CHECK (
    line_base_poisha >= 0 AND vat_poisha >= 0 AND gross_poisha >= 0
  ),
  CONSTRAINT sales_document_lines_amounts_foot CHECK (gross_poisha = line_base_poisha + vat_poisha),
  CONSTRAINT sales_document_lines_rate_non_negative CHECK (tax_rate_bps >= 0),
  CONSTRAINT sales_document_lines_description_length CHECK (char_length(btrim(description_en)) BETWEEN 1 AND 500),
  CONSTRAINT sales_document_lines_description_bn_length CHECK (
    description_bn IS NULL OR char_length(btrim(description_bn)) <= 500
  ),
  CONSTRAINT sales_document_lines_unit_length CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  CONSTRAINT sales_document_lines_tax_category_check CHECK (
    tax_category IN (
      'STANDARD_15', 'TRADING_5', 'PROCUREMENT_7_5', 'EXPORT_ZERO', 'EXEMPT', 'REVERSE_CHARGE',
      'OUT_OF_SCOPE'
    )
  ),
  CONSTRAINT sales_document_lines_tax_state_check CHECK (
    tax_decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  )
);

CREATE INDEX sales_document_lines_company_document_idx ON sales_document_lines (company_id, document_id);
CREATE INDEX sales_document_lines_company_item_idx ON sales_document_lines (company_id, item_id);
CREATE INDEX sales_document_lines_company_original_idx ON sales_document_lines (company_id, original_line_id)
  WHERE original_line_id IS NOT NULL;

CREATE TABLE sales_document_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  line_id uuid NOT NULL,
  tax_type text NOT NULL DEFAULT 'VAT',
  tax_category text NOT NULL,
  rate_bps integer NOT NULL,
  base_poisha bigint NOT NULL,
  amount_poisha bigint NOT NULL,
  rule_id text,
  rule_pack_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_document_taxes_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_taxes_line_fk FOREIGN KEY (company_id, line_id)
    REFERENCES sales_document_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_taxes_type_check CHECK (tax_type IN ('VAT')),
  CONSTRAINT sales_document_taxes_rate_non_negative CHECK (rate_bps >= 0),
  CONSTRAINT sales_document_taxes_amounts_non_negative CHECK (base_poisha >= 0 AND amount_poisha >= 0)
);

CREATE INDEX sales_document_taxes_company_document_idx ON sales_document_taxes (company_id, document_id);
CREATE INDEX sales_document_taxes_company_line_idx ON sales_document_taxes (company_id, line_id);

CREATE TABLE sales_tax_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  rule_pack_version text NOT NULL,
  rule_pack_status text NOT NULL,
  decision_state text NOT NULL,
  trace_id text NOT NULL,
  input_json jsonb NOT NULL,
  decision_json jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_tax_decisions_document_unique UNIQUE (company_id, document_id),
  CONSTRAINT sales_tax_decisions_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_tax_decisions_state_check CHECK (
    decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  )
);

CREATE TABLE sales_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_document_events_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_document_events_action_length CHECK (char_length(btrim(action)) BETWEEN 1 AND 64),
  CONSTRAINT sales_document_events_reason_length CHECK (reason IS NULL OR char_length(btrim(reason)) <= 500)
);

CREATE INDEX sales_document_events_company_document_idx ON sales_document_events (company_id, document_id, created_at);

CREATE TABLE sales_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  status text NOT NULL DEFAULT 'POSTED',
  receipt_number text NOT NULL,
  receipt_date date NOT NULL,
  party_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  amount_poisha bigint NOT NULL,
  write_off_poisha bigint NOT NULL DEFAULT 0,
  reference text,
  narration_en text,
  narration_bn text,
  journal_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_receipts_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT sales_receipts_number_unique UNIQUE (company_id, receipt_number),
  CONSTRAINT sales_receipts_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT sales_receipts_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipts_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipts_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipts_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipts_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipts_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT sales_receipts_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT sales_receipts_write_off_non_negative CHECK (write_off_poisha >= 0),
  CONSTRAINT sales_receipts_number_length CHECK (char_length(btrim(receipt_number)) BETWEEN 1 AND 64),
  CONSTRAINT sales_receipts_reference_length CHECK (reference IS NULL OR char_length(btrim(reference)) <= 200),
  CONSTRAINT sales_receipts_narration_length CHECK (narration_en IS NULL OR char_length(btrim(narration_en)) <= 500),
  CONSTRAINT sales_receipts_narration_bn_length CHECK (narration_bn IS NULL OR char_length(btrim(narration_bn)) <= 500),
  CONSTRAINT sales_receipts_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT sales_receipts_posted_fields CHECK (journal_id IS NOT NULL),
  CONSTRAINT sales_receipts_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  )
);

CREATE INDEX sales_receipts_company_date_idx ON sales_receipts (company_id, receipt_date DESC, created_at DESC);
CREATE INDEX sales_receipts_company_party_idx ON sales_receipts (company_id, party_id, receipt_date);

CREATE TRIGGER sales_receipts_set_updated_at
  BEFORE UPDATE ON sales_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL,
  document_id uuid NOT NULL,
  amount_poisha bigint NOT NULL DEFAULT 0,
  write_off_poisha bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_receipt_allocations_receipt_fk FOREIGN KEY (company_id, receipt_id)
    REFERENCES sales_receipts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipt_allocations_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES sales_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_receipt_allocations_amount_non_negative CHECK (amount_poisha >= 0 AND write_off_poisha >= 0),
  CONSTRAINT sales_receipt_allocations_positive CHECK (amount_poisha + write_off_poisha > 0)
);

CREATE INDEX sales_receipt_allocations_company_receipt_idx ON sales_receipt_allocations (company_id, receipt_id);
CREATE INDEX sales_receipt_allocations_company_document_idx ON sales_receipt_allocations (company_id, document_id);

-- Derived AR open items. Outstanding is calculated from the invoice, posted receipts and posted
-- credit notes. No mutable settled flag exists.
CREATE VIEW sales_ar_open_items AS
SELECT d.company_id,
       d.id AS document_id,
       d.doc_type,
       d.document_no,
       d.statutory_serial,
       d.party_id,
       d.doc_date,
       d.due_date,
       d.gross_poisha,
       COALESCE(a.allocated_poisha, 0)::bigint AS allocated_poisha,
       COALESCE(a.write_off_poisha, 0)::bigint AS write_off_poisha,
       COALESCE(c.credited_poisha, 0)::bigint AS credited_poisha,
       (d.gross_poisha - COALESCE(a.allocated_poisha, 0) - COALESCE(a.write_off_poisha, 0)
        - COALESCE(c.credited_poisha, 0))::bigint AS outstanding_poisha
  FROM sales_documents d
  LEFT JOIN (
    SELECT al.company_id, al.document_id,
           sum(al.amount_poisha) AS allocated_poisha,
           sum(al.write_off_poisha) AS write_off_poisha
      FROM sales_receipt_allocations al
      JOIN sales_receipts r ON r.company_id = al.company_id AND r.id = al.receipt_id
     WHERE r.status = 'POSTED'
     GROUP BY al.company_id, al.document_id
  ) a ON a.company_id = d.company_id AND a.document_id = d.id
  LEFT JOIN (
    SELECT company_id, original_document_id, sum(gross_poisha) AS credited_poisha
      FROM sales_documents
     WHERE doc_type = 'CREDIT_NOTE' AND status = 'POSTED'
     GROUP BY company_id, original_document_id
  ) c ON c.company_id = d.company_id AND c.original_document_id = d.id
 WHERE d.doc_type = 'SALES_INVOICE' AND d.status = 'POSTED';

-- Posted documents are immutable. The only permitted transition is POSTED -> REVERSED with its
-- linked reversal metadata. Deletion is only permitted for an unposted draft.
CREATE FUNCTION protect_sales_document_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'posted sales documents cannot be deleted'
        USING ERRCODE = '55000',
              HINT = 'Post a linked reversal instead of deleting financial history.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed sales document is immutable'
      USING ERRCODE = '55000',
            HINT = 'Post a new correcting document instead of changing a reversed one.';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted sales document may only transition to REVERSED'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
       OR NEW.document_no IS DISTINCT FROM OLD.document_no
       OR NEW.statutory_serial IS DISTINCT FROM OLD.statutory_serial
       OR NEW.statutory_series IS DISTINCT FROM OLD.statutory_series
       OR NEW.party_id IS DISTINCT FROM OLD.party_id
       OR NEW.original_document_id IS DISTINCT FROM OLD.original_document_id
       OR NEW.original_document_no IS DISTINCT FROM OLD.original_document_no
       OR NEW.doc_date IS DISTINCT FROM OLD.doc_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.credit_reason IS DISTINCT FROM OLD.credit_reason
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
       OR NEW.subtotal_poisha IS DISTINCT FROM OLD.subtotal_poisha
       OR NEW.discount_poisha IS DISTINCT FROM OLD.discount_poisha
       OR NEW.vat_poisha IS DISTINCT FROM OLD.vat_poisha
       OR NEW.gross_poisha IS DISTINCT FROM OLD.gross_poisha
       OR NEW.tax_pack_version IS DISTINCT FROM OLD.tax_pack_version
       OR NEW.tax_decision_state IS DISTINCT FROM OLD.tax_decision_state
       OR NEW.tax_snapshot_json IS DISTINCT FROM OLD.tax_snapshot_json
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.posting_idempotency_key IS DISTINCT FROM OLD.posting_idempotency_key
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
    THEN
      RAISE EXCEPTION 'posted sales document fields are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_documents_protect_posted
  BEFORE UPDATE OR DELETE ON sales_documents
  FOR EACH ROW EXECUTE FUNCTION protect_sales_document_row();

CREATE FUNCTION protect_sales_document_line_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  target_company uuid;
  target_document uuid;
BEGIN
  target_company := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  target_document := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  SELECT status INTO parent_status
    FROM sales_documents
   WHERE company_id = target_company AND id = target_document;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'sales document line has no parent document' USING ERRCODE = '23503';
  END IF;
  IF parent_status NOT IN ('DRAFT', 'APPROVED') THEN
    RAISE EXCEPTION 'sales document lines are immutable after posting'
      USING ERRCODE = '55000',
            HINT = 'Post a linked reversal or credit note instead.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER sales_document_lines_protect_posted
  BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines
  FOR EACH ROW EXECUTE FUNCTION protect_sales_document_line_row();

CREATE FUNCTION reject_sales_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000',
          HINT = 'Record a linked reversal or a new document instead of changing history.';
END;
$$;

CREATE TRIGGER sales_document_taxes_append_only
  BEFORE UPDATE OR DELETE ON sales_document_taxes
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER sales_tax_decisions_append_only
  BEFORE UPDATE OR DELETE ON sales_tax_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER sales_document_events_append_only
  BEFORE UPDATE OR DELETE ON sales_document_events
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER sales_receipt_allocations_append_only
  BEFORE UPDATE OR DELETE ON sales_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE FUNCTION protect_sales_receipt_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales receipts cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed sales receipt is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted sales receipt may only transition to REVERSED' USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
       OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
       OR NEW.party_id IS DISTINCT FROM OLD.party_id
       OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
       OR NEW.amount_poisha IS DISTINCT FROM OLD.amount_poisha
       OR NEW.write_off_poisha IS DISTINCT FROM OLD.write_off_poisha
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'posted sales receipt fields are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_receipts_protect_posted
  BEFORE UPDATE OR DELETE ON sales_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_sales_receipt_row();

COMMENT ON TABLE sales_documents IS
  'Sales invoices and credit notes. Posted rows are immutable; AR outstanding is derived, not stored.';
COMMENT ON TABLE sales_document_lines IS
  'Document lines with the server-calculated net base, VAT and tax decision state.';
COMMENT ON TABLE sales_document_taxes IS
  'Immutable line-level VAT evidence snapshot, including the rule-pack version.';
COMMENT ON TABLE sales_tax_decisions IS
  'Immutable document tax decision input/output snapshot used to explain every posted tax amount.';
COMMENT ON TABLE sales_receipts IS
  'Customer receipts. A receipt credits AR for the full amount; allocations determine which invoices it clears.';
COMMENT ON TABLE sales_receipt_allocations IS
  'Append-only allocation of posted receipt cash and permissioned write-off to specific invoices.';
COMMENT ON VIEW sales_ar_open_items IS
  'Derived invoice-level AR open items from posted invoices, posted receipts and posted credit notes.';
