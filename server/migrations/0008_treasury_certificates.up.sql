-- Phase 9 receipts, payments, treasury challans and withholding certificates.
--
-- This migration adds the persisted Treasury deposit document and certificate records that Phase 8
-- deliberately deferred. Withholding liabilities remain the source of truth created from actual
-- supplier payments. A Treasury challan is a batch of selected liabilities; the deposit journal is
-- Dr liability / Cr bank and is posted atomically with the liability status change. A certificate is
-- created only from a deposited liability, copies its base and tax amount exactly, and remains DRAFT
-- until a qualified reviewer verifies the statutory format. No certificate is marked filed.
--
-- A high-value supplier payment uses a persisted maker-checker approval request instead of posting
-- immediately. The request stores the server-computed snapshot; approval revalidates it against the
-- current open items, tax policy and period before posting. The requester can never approve their own
-- payment.

-- Internal certificate series. The statutory certificate format is not asserted by this schema.
ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN', 'MUSHAK_63', 'MUSHAK_67',
      'TREASURY_CERTIFICATE'
    )
  );

INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
SELECT fy.company_id, fy.id, 'TREASURY_CERTIFICATE', 'CERT-', 1, 4
  FROM fiscal_years fy
ON CONFLICT (company_id, fiscal_year_id, doc_type) DO NOTHING;

-- Treasury deposits are a distinct ledger source so they cannot be confused with purchases or bank
-- reconciliation (Phase 10).
ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY'
    )
  );

-- Evidence references on the settlement documents. A reference is not a file upload; the attachment
-- storage/scanning provider remains an external Phase 10+ decision.
ALTER TABLE sales_receipts ADD COLUMN attachment_reference text;
ALTER TABLE sales_receipts
  ADD CONSTRAINT sales_receipts_attachment_length CHECK (
    attachment_reference IS NULL OR char_length(btrim(attachment_reference)) <= 500
  );

ALTER TABLE purchase_payments ADD COLUMN attachment_reference text;
ALTER TABLE purchase_payments ADD COLUMN approved_by uuid REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE purchase_payments ADD COLUMN approved_at timestamptz;
ALTER TABLE purchase_payments
  ADD CONSTRAINT purchase_payments_attachment_length CHECK (
    attachment_reference IS NULL OR char_length(btrim(attachment_reference)) <= 500
  );
ALTER TABLE purchase_payments
  ADD CONSTRAINT purchase_payments_approved_fields CHECK (
    (approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

-- Composite tenant foreign keys from Treasury tables require the Phase 8 liability table to expose a
-- (company_id, id) unique key. It did not need one until now.
ALTER TABLE purchase_withholding_liabilities
  ADD CONSTRAINT purchase_withholding_liabilities_company_id_unique UNIQUE (company_id, id);

-- A persisted payment approval request. The snapshot is server-computed; the client never supplies an
-- authoritative approval amount. Rejection is terminal; a new request needs a new idempotency key.
CREATE TABLE purchase_payment_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING',
  request_json jsonb NOT NULL,
  cash_poisha bigint NOT NULL,
  vds_poisha bigint NOT NULL DEFAULT 0,
  tds_poisha bigint NOT NULL DEFAULT 0,
  allocated_poisha bigint NOT NULL DEFAULT 0,
  requested_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  payment_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_payment_approval_requests_company_unique UNIQUE (company_id, id),
  CONSTRAINT purchase_payment_approval_requests_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT purchase_payment_approval_requests_payment_fk FOREIGN KEY (company_id, payment_id)
    REFERENCES purchase_payments (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payment_approval_requests_status_check CHECK (
    status IN ('PENDING', 'REJECTED', 'POSTED')
  ),
  CONSTRAINT purchase_payment_approval_requests_amounts CHECK (
    cash_poisha >= 0 AND vds_poisha >= 0 AND tds_poisha >= 0 AND allocated_poisha >= 0
  ),
  CONSTRAINT purchase_payment_approval_requests_json_object CHECK (jsonb_typeof(request_json) = 'object'),
  CONSTRAINT purchase_payment_approval_requests_idempotency_length CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 1 AND 200
  ),
  CONSTRAINT purchase_payment_approval_requests_reason_length CHECK (
    decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT purchase_payment_approval_requests_posted_fields CHECK (
    status <> 'POSTED'
    OR (payment_id IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT purchase_payment_approval_requests_rejected_fields CHECK (
    status <> 'REJECTED'
    OR (
      payment_id IS NULL
      AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL
      AND decision_reason IS NOT NULL
    )
  )
);

CREATE INDEX purchase_payment_approval_requests_company_status_idx
  ON purchase_payment_approval_requests (company_id, status, requested_at DESC);

-- Treasury challan deposit batch. One batch can settle several VDS/TDS/reverse-charge liabilities;
-- the journal clears each liability control account and credits the bank/cash account once.
CREATE TABLE treasury_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  challan_number text NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  deposit_date date NOT NULL,
  bank_account_id uuid NOT NULL,
  bank_branch text NOT NULL,
  deposit_reference text NOT NULL,
  evidence_reference text NOT NULL,
  total_poisha bigint NOT NULL,
  journal_id uuid NOT NULL,
  reversal_journal_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challans_company_unique UNIQUE (company_id, id),
  CONSTRAINT treasury_challans_number_unique UNIQUE (company_id, challan_number),
  CONSTRAINT treasury_challans_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT treasury_challans_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challans_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challans_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challans_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT treasury_challans_total_positive CHECK (total_poisha > 0),
  CONSTRAINT treasury_challans_number_length CHECK (char_length(btrim(challan_number)) BETWEEN 1 AND 64),
  CONSTRAINT treasury_challans_branch_length CHECK (char_length(btrim(bank_branch)) BETWEEN 1 AND 200),
  CONSTRAINT treasury_challans_reference_length CHECK (
    char_length(btrim(deposit_reference)) BETWEEN 1 AND 200
  ),
  CONSTRAINT treasury_challans_evidence_length CHECK (
    char_length(btrim(evidence_reference)) BETWEEN 1 AND 500
  ),
  CONSTRAINT treasury_challans_idempotency_length CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 1 AND 200
  ),
  CONSTRAINT treasury_challans_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX treasury_challans_bank_reference_unique
  ON treasury_challans (company_id, bank_account_id, btrim(deposit_reference))
  WHERE status = 'POSTED';
CREATE INDEX treasury_challans_company_date_idx
  ON treasury_challans (company_id, deposit_date DESC, created_at DESC);

CREATE TABLE treasury_challan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  challan_id uuid NOT NULL,
  liability_id uuid NOT NULL,
  tax_type text NOT NULL,
  amount_poisha bigint NOT NULL,
  economic_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_challan_items_company_unique UNIQUE (company_id, id),
  CONSTRAINT treasury_challan_items_batch_unique UNIQUE (company_id, challan_id, liability_id),
  CONSTRAINT treasury_challan_items_challan_fk FOREIGN KEY (company_id, challan_id)
    REFERENCES treasury_challans (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challan_items_liability_fk FOREIGN KEY (company_id, liability_id)
    REFERENCES purchase_withholding_liabilities (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_challan_items_tax_type_check CHECK (
    tax_type IN ('VDS', 'TDS', 'REVERSE_CHARGE')
  ),
  CONSTRAINT treasury_challan_items_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT treasury_challan_items_economic_code_length CHECK (
    char_length(btrim(economic_code)) BETWEEN 1 AND 32
  )
);

CREATE INDEX treasury_challan_items_company_challan_idx
  ON treasury_challan_items (company_id, challan_id);
CREATE INDEX treasury_challan_items_company_liability_idx
  ON treasury_challan_items (company_id, liability_id);

-- A deposit batch's total must equal the sum of its items. The deferred constraint trigger lets the
-- service insert the header and items in one transaction but refuses a mismatched commit.
CREATE FUNCTION assert_treasury_challan_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_company uuid;
  target_challan uuid;
  item_total bigint;
  header_total bigint;
BEGIN
  target_company := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  target_challan := CASE WHEN TG_OP = 'DELETE' THEN OLD.challan_id ELSE NEW.challan_id END;
  SELECT COALESCE(sum(amount_poisha), 0) INTO item_total
    FROM treasury_challan_items
   WHERE company_id = target_company AND challan_id = target_challan;
  SELECT total_poisha INTO header_total
    FROM treasury_challans
   WHERE company_id = target_company AND id = target_challan;
  IF header_total IS NOT NULL AND item_total <> header_total THEN
    RAISE EXCEPTION 'treasury challan total does not equal its liability items'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER treasury_challan_items_total_check
  AFTER INSERT OR UPDATE OR DELETE ON treasury_challan_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_treasury_challan_total();

-- Liabilities gain the Treasury economic code and the active deposit link. A reversed deposit clears
-- the active link while the append-only treasury_challan_items history remains.
ALTER TABLE purchase_withholding_liabilities ADD COLUMN economic_code text;
ALTER TABLE purchase_withholding_liabilities ADD COLUMN challan_id uuid;
ALTER TABLE purchase_withholding_liabilities ADD COLUMN deposited_at timestamptz;
ALTER TABLE purchase_withholding_liabilities
  ADD CONSTRAINT purchase_withholding_liabilities_challan_fk FOREIGN KEY (company_id, challan_id)
    REFERENCES treasury_challans (company_id, id) ON DELETE RESTRICT;
ALTER TABLE purchase_withholding_liabilities
  ADD CONSTRAINT purchase_withholding_liabilities_economic_code_length CHECK (
    economic_code IS NULL OR char_length(btrim(economic_code)) BETWEEN 1 AND 32
  );
ALTER TABLE purchase_withholding_liabilities
  ADD CONSTRAINT purchase_withholding_liabilities_deposited_fields CHECK (
    status <> 'DEPOSITED' OR (challan_id IS NOT NULL AND deposited_at IS NOT NULL)
  );
ALTER TABLE purchase_withholding_liabilities
  ADD CONSTRAINT purchase_withholding_liabilities_pending_fields CHECK (
    status <> 'PENDING' OR (challan_id IS NULL AND deposited_at IS NULL)
  );

CREATE INDEX purchase_withholding_liabilities_company_challan_idx
  ON purchase_withholding_liabilities (company_id, challan_id)
  WHERE challan_id IS NOT NULL;

-- Certificates are derived records, never computed on render. The trigger below enforces that the
-- base and tax are identical to the source liability, so no arbitrary multiplier can be introduced.
CREATE TABLE treasury_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  certificate_type text NOT NULL,
  certificate_number text NOT NULL,
  direction text NOT NULL DEFAULT 'ISSUED',
  party_id uuid NOT NULL,
  original_document_id uuid,
  payment_id uuid,
  liability_id uuid NOT NULL,
  challan_id uuid,
  certificate_date date NOT NULL,
  base_poisha bigint NOT NULL,
  tax_poisha bigint NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  evidence_reference text,
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reissued_from_id uuid,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_certificates_company_unique UNIQUE (company_id, id),
  CONSTRAINT treasury_certificates_number_unique UNIQUE (company_id, certificate_number),
  CONSTRAINT treasury_certificates_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_original_fk FOREIGN KEY (company_id, original_document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_payment_fk FOREIGN KEY (company_id, payment_id)
    REFERENCES purchase_payments (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_liability_fk FOREIGN KEY (company_id, liability_id)
    REFERENCES purchase_withholding_liabilities (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_challan_fk FOREIGN KEY (company_id, challan_id)
    REFERENCES treasury_challans (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_reissued_fk FOREIGN KEY (company_id, reissued_from_id)
    REFERENCES treasury_certificates (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT treasury_certificates_type_check CHECK (certificate_type IN ('VDS', 'TDS')),
  CONSTRAINT treasury_certificates_direction_check CHECK (direction IN ('ISSUED', 'RECEIVED')),
  CONSTRAINT treasury_certificates_status_check CHECK (status IN ('DRAFT', 'CANCELLED')),
  CONSTRAINT treasury_certificates_amounts CHECK (base_poisha >= 0 AND tax_poisha > 0),
  CONSTRAINT treasury_certificates_number_length CHECK (
    char_length(btrim(certificate_number)) BETWEEN 1 AND 64
  ),
  CONSTRAINT treasury_certificates_evidence_length CHECK (
    evidence_reference IS NULL OR char_length(btrim(evidence_reference)) BETWEEN 1 AND 500
  ),
  CONSTRAINT treasury_certificates_cancellation_length CHECK (
    cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 3 AND 500
  ),
  CONSTRAINT treasury_certificates_cancelled_fields CHECK (
    status <> 'CANCELLED'
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL)
  ),
  CONSTRAINT treasury_certificates_issued_source CHECK (
    direction <> 'ISSUED'
    OR (original_document_id IS NOT NULL AND payment_id IS NOT NULL AND challan_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX treasury_certificates_active_liability_unique
  ON treasury_certificates (company_id, liability_id)
  WHERE status = 'DRAFT';
CREATE INDEX treasury_certificates_company_status_idx
  ON treasury_certificates (company_id, status, certificate_date DESC);
CREATE INDEX treasury_certificates_company_party_idx
  ON treasury_certificates (company_id, party_id, certificate_date DESC);

CREATE FUNCTION assert_treasury_certificate_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source record;
BEGIN
  SELECT tax_type, party_id, bill_id, payment_id, challan_id, base_poisha, amount_poisha
    INTO source
    FROM purchase_withholding_liabilities
   WHERE company_id = NEW.company_id AND id = NEW.liability_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'certificate source liability was not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.certificate_type <> source.tax_type
     OR NEW.party_id <> source.party_id
     OR NEW.original_document_id IS DISTINCT FROM source.bill_id
     OR NEW.payment_id IS DISTINCT FROM source.payment_id
     OR NEW.challan_id IS DISTINCT FROM source.challan_id
     OR NEW.base_poisha <> source.base_poisha
     OR NEW.tax_poisha <> source.amount_poisha
  THEN
    RAISE EXCEPTION 'certificate amounts and source links must derive from the withholding liability'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.certificate_type NOT IN ('VDS', 'TDS') THEN
    RAISE EXCEPTION 'a withholding certificate requires a VDS or TDS liability' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_certificates_derive_source
  BEFORE INSERT ON treasury_certificates
  FOR EACH ROW EXECUTE FUNCTION assert_treasury_certificate_derivation();

CREATE FUNCTION protect_treasury_certificate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'treasury certificates cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'a cancelled treasury certificate is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'a draft treasury certificate may only transition to CANCELLED'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.certificate_type IS DISTINCT FROM OLD.certificate_type
     OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.party_id IS DISTINCT FROM OLD.party_id
     OR NEW.original_document_id IS DISTINCT FROM OLD.original_document_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.liability_id IS DISTINCT FROM OLD.liability_id
     OR NEW.challan_id IS DISTINCT FROM OLD.challan_id
     OR NEW.certificate_date IS DISTINCT FROM OLD.certificate_date
     OR NEW.base_poisha IS DISTINCT FROM OLD.base_poisha
     OR NEW.tax_poisha IS DISTINCT FROM OLD.tax_poisha
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.reissued_from_id IS DISTINCT FROM OLD.reissued_from_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'treasury certificate financial fields are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_certificates_protect
  BEFORE UPDATE OR DELETE ON treasury_certificates
  FOR EACH ROW EXECUTE FUNCTION protect_treasury_certificate();

CREATE FUNCTION protect_treasury_challan_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'treasury challans cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed treasury challan is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted treasury challan may only transition to REVERSED'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.challan_number IS DISTINCT FROM OLD.challan_number
       OR NEW.deposit_date IS DISTINCT FROM OLD.deposit_date
       OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
       OR NEW.bank_branch IS DISTINCT FROM OLD.bank_branch
       OR NEW.deposit_reference IS DISTINCT FROM OLD.deposit_reference
       OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
       OR NEW.total_poisha IS DISTINCT FROM OLD.total_poisha
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'treasury challan financial fields are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_challans_protect
  BEFORE UPDATE OR DELETE ON treasury_challans
  FOR EACH ROW EXECUTE FUNCTION protect_treasury_challan_row();

CREATE FUNCTION protect_purchase_payment_approval_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment approval requests cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a decided payment approval request is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('REJECTED', 'POSTED') THEN
    RAISE EXCEPTION 'a pending payment approval request may only be rejected or posted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.request_json IS DISTINCT FROM OLD.request_json
     OR NEW.cash_poisha IS DISTINCT FROM OLD.cash_poisha
     OR NEW.vds_poisha IS DISTINCT FROM OLD.vds_poisha
     OR NEW.tds_poisha IS DISTINCT FROM OLD.tds_poisha
     OR NEW.allocated_poisha IS DISTINCT FROM OLD.allocated_poisha
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'payment approval request snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_payment_approval_requests_protect
  BEFORE UPDATE OR DELETE ON purchase_payment_approval_requests
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_payment_approval_request();

-- Replace the Phase 8 withholding trigger so a deposit can set the challan link and a challan reversal
-- can clear it, without permitting any change to the underlying financial facts.
CREATE OR REPLACE FUNCTION protect_purchase_withholding_liability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'withholding liabilities cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed withholding liability is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
     OR NEW.party_id IS DISTINCT FROM OLD.party_id
     OR NEW.tax_type IS DISTINCT FROM OLD.tax_type
     OR NEW.tax_period IS DISTINCT FROM OLD.tax_period
     OR NEW.base_poisha IS DISTINCT FROM OLD.base_poisha
     OR NEW.rate_bps IS DISTINCT FROM OLD.rate_bps
     OR NEW.amount_poisha IS DISTINCT FROM OLD.amount_poisha
     OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'withholding liability financial fields are immutable' USING ERRCODE = '55000';
  END IF;

  -- The economic code is operational Treasury configuration, not a financial fact. It may be entered
  -- while the liability is pending, but is frozen once it has been deposited.
  IF OLD.status <> 'PENDING'
     AND NEW.economic_code IS DISTINCT FROM OLD.economic_code
  THEN
    RAISE EXCEPTION 'withholding liability economic code is frozen after deposit' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'PENDING' THEN
    IF NEW.status NOT IN ('PENDING', 'DEPOSITED', 'REVERSED') THEN
      RAISE EXCEPTION 'invalid withholding liability status transition' USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'DEPOSITED'
       AND (NEW.challan_id IS NULL OR NEW.deposited_at IS NULL)
    THEN
      RAISE EXCEPTION 'a deposited withholding liability requires a challan and deposit timestamp'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'DEPOSITED' THEN
    IF NEW.status = 'PENDING' THEN
      IF NEW.challan_id IS NOT NULL OR NEW.deposited_at IS NOT NULL THEN
        RAISE EXCEPTION 'a reversal must clear the active treasury challan link' USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.status <> 'DEPOSITED' THEN
      RAISE EXCEPTION 'a deposited withholding liability may only be reversed to PENDING'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid withholding liability status transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the Phase 8 payment trigger to freeze the new approval and attachment fields.
CREATE OR REPLACE FUNCTION protect_purchase_payment_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase payments cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed purchase payment is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted purchase payment may only transition to REVERSED'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.payment_number IS DISTINCT FROM OLD.payment_number
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.party_id IS DISTINCT FROM OLD.party_id
       OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
       OR NEW.amount_poisha IS DISTINCT FROM OLD.amount_poisha
       OR NEW.vds_poisha IS DISTINCT FROM OLD.vds_poisha
       OR NEW.tds_poisha IS DISTINCT FROM OLD.tds_poisha
       OR NEW.allocated_poisha IS DISTINCT FROM OLD.allocated_poisha
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
      RAISE EXCEPTION 'posted purchase payment fields are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the Phase 7 receipt trigger to freeze the attachment reference.
CREATE OR REPLACE FUNCTION protect_sales_receipt_row()
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
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
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

COMMENT ON TABLE purchase_payment_approval_requests IS
  'Maker-checker requests for supplier payments at or above the company payment threshold.';
COMMENT ON TABLE treasury_challans IS
  'Persisted Treasury deposit batches: Dr VDS/TDS/reverse-charge liabilities, Cr bank/cash.';
COMMENT ON TABLE treasury_challan_items IS
  'Append-only links from a Treasury deposit batch to the selected withholding liabilities.';
COMMENT ON TABLE treasury_certificates IS
  'Draft withholding certificates derived exactly from a deposited VDS/TDS liability; not filed.';
COMMENT ON COLUMN purchase_withholding_liabilities.economic_code IS
  'Treasury economic code supplied by the company; this migration does not invent any code.';
COMMENT ON COLUMN purchase_withholding_liabilities.challan_id IS
  'Active Treasury deposit batch. Cleared only by a linked deposit reversal; item history is retained.';
