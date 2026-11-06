-- Phase 8 purchases, bills, payments and payables.
--
-- Scope decision recorded in the migration and service comments: this release implements supplier
-- bills and expense vouchers as the receipt document. Purchase orders, a separate GRN document and
-- three-way matching are deliberately NOT modelled, because an aggregate or bill-defaulted match
-- would be misleading. A stock line on a posted bill is a real goods receipt: it moves inventory in
-- the same transaction as the journal. The real UI does not show a three-way match.
--
-- Money is BIGINT poisha; quantities are NUMERIC(18,4). AP outstanding is derived from posted
-- documents and payment allocations, never from a mutable settled flag. Posted documents, lines,
-- tax evidence and allocations are immutable; corrections use linked document-level reversals.

ALTER TABLE company_settings DROP CONSTRAINT company_settings_key_check;
ALTER TABLE company_settings
  ADD CONSTRAINT company_settings_key_check CHECK (
    key IN ('language', 'approval_thresholds', 'tax', 'sales_tax_policy', 'purchase_tax_policy')
  );

CREATE TABLE purchase_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  doc_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  document_no text,
  supplier_invoice_no text NOT NULL,
  supplier_invoice_date date NOT NULL,
  supplier_mushak63_serial text,
  supplier_mushak63_date date,
  reverse_charge_challan_reference text,
  attachment_reference text,
  party_id uuid NOT NULL,
  doc_date date NOT NULL,
  due_date date NOT NULL,
  payment_terms_days integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BDT',
  narration_en text NOT NULL,
  narration_bn text,
  payment_method text NOT NULL DEFAULT 'BANK',
  supplier_bin text,
  supplier_tin text,
  supplier_tin_missing boolean NOT NULL DEFAULT false,
  vds_applicable boolean NOT NULL DEFAULT false,
  tds_nature text NOT NULL DEFAULT 'NONE',
  withholding_entity boolean NOT NULL DEFAULT false,
  subtotal_poisha bigint NOT NULL DEFAULT 0,
  discount_poisha bigint NOT NULL DEFAULT 0,
  vat_poisha bigint NOT NULL DEFAULT 0,
  supplier_vat_poisha bigint NOT NULL DEFAULT 0,
  reverse_charge_vat_poisha bigint NOT NULL DEFAULT 0,
  vat_claimable_poisha bigint NOT NULL DEFAULT 0,
  vat_disallowed_poisha bigint NOT NULL DEFAULT 0,
  cost_poisha bigint NOT NULL DEFAULT 0,
  gross_poisha bigint NOT NULL DEFAULT 0,
  vds_poisha bigint NOT NULL DEFAULT 0,
  tds_poisha bigint NOT NULL DEFAULT 0,
  net_payable_poisha bigint NOT NULL DEFAULT 0,
  tax_pack_version text,
  tax_decision_state text,
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz,
  posted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reversal_journal_id uuid,
  posting_idempotency_key text,
  create_idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_documents_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT purchase_documents_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_documents_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_documents_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_documents_type_check CHECK (doc_type IN ('PURCHASE_BILL', 'EXPENSE_VOUCHER')),
  CONSTRAINT purchase_documents_status_check CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
  CONSTRAINT purchase_documents_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT purchase_documents_dates CHECK (due_date >= doc_date),
  CONSTRAINT purchase_documents_payment_terms CHECK (payment_terms_days BETWEEN 0 AND 3650),
  CONSTRAINT purchase_documents_payment_method_check CHECK (
    payment_method IN ('BANK', 'MFS', 'CASH', 'CHEQUE', 'CREDIT_CARD')
  ),
  CONSTRAINT purchase_documents_tds_nature_check CHECK (
    tds_nature IN (
      'NONE', 'SUPPLY_OF_GOODS', 'PROFESSIONAL_OR_TECHNICAL_SERVICES', 'COMMERCIAL_RENT',
      'ADVERTISING_OR_MEDIA', 'TRANSPORT_OR_LOGISTICS', 'CONTRACTOR_OR_SUBCONTRACTOR'
    )
  ),
  CONSTRAINT purchase_documents_amounts_non_negative CHECK (
    subtotal_poisha >= 0 AND discount_poisha >= 0 AND vat_poisha >= 0
    AND supplier_vat_poisha >= 0 AND reverse_charge_vat_poisha >= 0
    AND vat_claimable_poisha >= 0 AND vat_disallowed_poisha >= 0
    AND cost_poisha >= 0 AND gross_poisha >= 0 AND vds_poisha >= 0 AND tds_poisha >= 0
    AND net_payable_poisha >= 0
  ),
  CONSTRAINT purchase_documents_vat_split CHECK (
    vat_poisha = supplier_vat_poisha + reverse_charge_vat_poisha
    AND vat_poisha = vat_claimable_poisha + vat_disallowed_poisha
  ),
  CONSTRAINT purchase_documents_gross_foot CHECK (gross_poisha = subtotal_poisha + supplier_vat_poisha),
  CONSTRAINT purchase_documents_net_payable_foot CHECK (
    net_payable_poisha = gross_poisha - vds_poisha - tds_poisha
  ),
  CONSTRAINT purchase_documents_supplier_invoice_length CHECK (
    char_length(btrim(supplier_invoice_no)) BETWEEN 1 AND 64
  ),
  CONSTRAINT purchase_documents_narration_length CHECK (char_length(btrim(narration_en)) BETWEEN 1 AND 500),
  CONSTRAINT purchase_documents_narration_bn_length CHECK (
    narration_bn IS NULL OR char_length(btrim(narration_bn)) <= 500
  ),
  CONSTRAINT purchase_documents_attachment_length CHECK (
    attachment_reference IS NULL OR char_length(btrim(attachment_reference)) <= 500
  ),
  CONSTRAINT purchase_documents_mushak_evidence_check CHECK (
    (supplier_mushak63_serial IS NULL AND supplier_mushak63_date IS NULL)
    OR (
      supplier_mushak63_serial IS NOT NULL
      AND supplier_mushak63_date IS NOT NULL
      AND char_length(btrim(supplier_mushak63_serial)) BETWEEN 1 AND 64
    )
  ),
  CONSTRAINT purchase_documents_reverse_charge_reference_length CHECK (
    reverse_charge_challan_reference IS NULL
    OR char_length(btrim(reverse_charge_challan_reference)) BETWEEN 1 AND 200
  ),
  CONSTRAINT purchase_documents_tax_state_check CHECK (
    tax_decision_state IS NULL
    OR tax_decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  ),
  CONSTRAINT purchase_documents_posted_fields CHECK (
    status NOT IN ('POSTED', 'REVERSED')
    OR (
      document_no IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND tax_pack_version IS NOT NULL
      AND tax_decision_state IS NOT NULL
      AND char_length(btrim(document_no)) BETWEEN 1 AND 64
    )
  ),
  CONSTRAINT purchase_documents_draft_fields CHECK (
    status IN ('POSTED', 'REVERSED') OR document_no IS NULL
  ),
  CONSTRAINT purchase_documents_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  ),
  CONSTRAINT purchase_documents_idempotency_length CHECK (
    (posting_idempotency_key IS NULL OR char_length(posting_idempotency_key) BETWEEN 1 AND 200)
    AND (create_idempotency_key IS NULL OR char_length(create_idempotency_key) BETWEEN 1 AND 200)
  )
);

CREATE UNIQUE INDEX purchase_documents_document_no_unique
  ON purchase_documents (company_id, doc_type, document_no)
  WHERE document_no IS NOT NULL;
CREATE UNIQUE INDEX purchase_documents_posting_idempotency_unique
  ON purchase_documents (company_id, posting_idempotency_key)
  WHERE posting_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX purchase_documents_create_idempotency_unique
  ON purchase_documents (company_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;
CREATE INDEX purchase_documents_company_date_idx ON purchase_documents (company_id, doc_date DESC, created_at DESC);
CREATE INDEX purchase_documents_company_party_idx ON purchase_documents (company_id, party_id, due_date);
CREATE INDEX purchase_documents_company_status_idx ON purchase_documents (company_id, status, doc_date DESC);

CREATE TRIGGER purchase_documents_set_updated_at
  BEFORE UPDATE ON purchase_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_document_lines (
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
  account_id uuid NOT NULL,
  warehouse_id uuid,
  stock_movement_id uuid,
  line_base_poisha bigint NOT NULL,
  vat_poisha bigint NOT NULL,
  vat_claimable_poisha bigint NOT NULL,
  vat_disallowed_poisha bigint NOT NULL,
  cost_poisha bigint NOT NULL,
  supplier_payable_poisha bigint NOT NULL,
  tax_rate_bps integer NOT NULL,
  vds_rate_bps integer NOT NULL DEFAULT 0,
  tax_rule_id text,
  tax_decision_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_document_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT purchase_document_lines_document_line_unique UNIQUE (company_id, document_id, line_no),
  CONSTRAINT purchase_document_lines_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE CASCADE,
  CONSTRAINT purchase_document_lines_item_fk FOREIGN KEY (company_id, item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_lines_account_fk FOREIGN KEY (company_id, account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_lines_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_lines_stock_fk FOREIGN KEY (company_id, stock_movement_id)
    REFERENCES stock_movements (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_lines_line_no_positive CHECK (line_no >= 1),
  CONSTRAINT purchase_document_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT purchase_document_lines_price_non_negative CHECK (unit_price_poisha >= 0),
  CONSTRAINT purchase_document_lines_discount_non_negative CHECK (discount_poisha >= 0),
  CONSTRAINT purchase_document_lines_amounts_non_negative CHECK (
    line_base_poisha >= 0 AND vat_poisha >= 0 AND vat_claimable_poisha >= 0
    AND vat_disallowed_poisha >= 0 AND cost_poisha >= 0 AND supplier_payable_poisha >= 0
  ),
  CONSTRAINT purchase_document_lines_vat_split CHECK (
    vat_poisha = vat_claimable_poisha + vat_disallowed_poisha
  ),
  CONSTRAINT purchase_document_lines_cost_foot CHECK (cost_poisha = line_base_poisha + vat_disallowed_poisha),
  CONSTRAINT purchase_document_lines_rate_non_negative CHECK (tax_rate_bps >= 0 AND vds_rate_bps >= 0),
  CONSTRAINT purchase_document_lines_description_length CHECK (
    char_length(btrim(description_en)) BETWEEN 1 AND 500
  ),
  CONSTRAINT purchase_document_lines_description_bn_length CHECK (
    description_bn IS NULL OR char_length(btrim(description_bn)) <= 500
  ),
  CONSTRAINT purchase_document_lines_unit_length CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  CONSTRAINT purchase_document_lines_tax_category_check CHECK (
    tax_category IN (
      'STANDARD_15', 'TRADING_5', 'PROCUREMENT_7_5', 'EXPORT_ZERO', 'EXEMPT', 'REVERSE_CHARGE',
      'OUT_OF_SCOPE'
    )
  ),
  CONSTRAINT purchase_document_lines_tax_state_check CHECK (
    tax_decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  )
);

CREATE INDEX purchase_document_lines_company_document_idx ON purchase_document_lines (company_id, document_id);
CREATE INDEX purchase_document_lines_company_item_idx ON purchase_document_lines (company_id, item_id);
CREATE INDEX purchase_document_lines_company_account_idx ON purchase_document_lines (company_id, account_id);

CREATE TABLE purchase_document_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  line_id uuid,
  tax_type text NOT NULL,
  tax_category text NOT NULL,
  rate_bps integer NOT NULL,
  base_poisha bigint NOT NULL,
  amount_poisha bigint NOT NULL,
  claimable_poisha bigint NOT NULL DEFAULT 0,
  disallowed_poisha bigint NOT NULL DEFAULT 0,
  rule_id text,
  rule_pack_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_document_taxes_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_taxes_line_fk FOREIGN KEY (company_id, line_id)
    REFERENCES purchase_document_lines (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_taxes_type_check CHECK (
    tax_type IN ('VAT', 'REVERSE_CHARGE', 'VDS', 'TDS')
  ),
  CONSTRAINT purchase_document_taxes_line_required CHECK (
    tax_type IN ('VDS', 'TDS') OR line_id IS NOT NULL
  ),
  CONSTRAINT purchase_document_taxes_rate_non_negative CHECK (rate_bps >= 0),
  CONSTRAINT purchase_document_taxes_amounts_non_negative CHECK (
    base_poisha >= 0 AND amount_poisha >= 0 AND claimable_poisha >= 0 AND disallowed_poisha >= 0
  ),
  CONSTRAINT purchase_document_taxes_split CHECK (
    tax_type IN ('VDS', 'TDS') OR amount_poisha = claimable_poisha + disallowed_poisha
  )
);

CREATE INDEX purchase_document_taxes_company_document_idx ON purchase_document_taxes (company_id, document_id);
CREATE INDEX purchase_document_taxes_company_type_idx ON purchase_document_taxes (company_id, tax_type);

CREATE TABLE purchase_tax_decisions (
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
  CONSTRAINT purchase_tax_decisions_document_unique UNIQUE (company_id, document_id),
  CONSTRAINT purchase_tax_decisions_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_tax_decisions_state_check CHECK (
    decision_state IN (
      'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'MANUAL_REVIEW', 'NOT_SUPPORTED',
      'SOURCE_DISPUTED_OR_EXPIRED'
    )
  )
);

CREATE TABLE purchase_document_events (
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
  CONSTRAINT purchase_document_events_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_document_events_action_length CHECK (char_length(btrim(action)) BETWEEN 1 AND 64),
  CONSTRAINT purchase_document_events_reason_length CHECK (reason IS NULL OR char_length(btrim(reason)) <= 500)
);

CREATE INDEX purchase_document_events_company_document_idx
  ON purchase_document_events (company_id, document_id, created_at);

CREATE TABLE purchase_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  status text NOT NULL DEFAULT 'POSTED',
  payment_number text NOT NULL,
  payment_date date NOT NULL,
  party_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  amount_poisha bigint NOT NULL,
  vds_poisha bigint NOT NULL DEFAULT 0,
  tds_poisha bigint NOT NULL DEFAULT 0,
  allocated_poisha bigint NOT NULL,
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
  CONSTRAINT purchase_payments_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT purchase_payments_number_unique UNIQUE (company_id, payment_number),
  CONSTRAINT purchase_payments_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT purchase_payments_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payments_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payments_bank_fk FOREIGN KEY (company_id, bank_account_id)
    REFERENCES bank_accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payments_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payments_reversal_journal_fk FOREIGN KEY (company_id, reversal_journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payments_status_check CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT purchase_payments_amount_non_negative CHECK (amount_poisha >= 0),
  CONSTRAINT purchase_payments_withholding_non_negative CHECK (vds_poisha >= 0 AND tds_poisha >= 0),
  CONSTRAINT purchase_payments_allocated_positive CHECK (allocated_poisha > 0),
  CONSTRAINT purchase_payments_allocated_foot CHECK (
    allocated_poisha = amount_poisha + vds_poisha + tds_poisha
  ),
  CONSTRAINT purchase_payments_number_length CHECK (char_length(btrim(payment_number)) BETWEEN 1 AND 64),
  CONSTRAINT purchase_payments_reference_length CHECK (
    reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 200
  ),
  CONSTRAINT purchase_payments_narration_length CHECK (
    narration_en IS NULL OR char_length(btrim(narration_en)) <= 500
  ),
  CONSTRAINT purchase_payments_narration_bn_length CHECK (
    narration_bn IS NULL OR char_length(btrim(narration_bn)) <= 500
  ),
  CONSTRAINT purchase_payments_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT purchase_payments_posted_fields CHECK (journal_id IS NOT NULL),
  CONSTRAINT purchase_payments_reversed_fields CHECK (
    status <> 'REVERSED'
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_journal_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX purchase_payments_bank_reference_unique
  ON purchase_payments (company_id, bank_account_id, btrim(reference))
  WHERE reference IS NOT NULL AND status = 'POSTED';
CREATE INDEX purchase_payments_company_date_idx ON purchase_payments (company_id, payment_date DESC, created_at DESC);
CREATE INDEX purchase_payments_company_party_idx ON purchase_payments (company_id, party_id, payment_date);

CREATE TRIGGER purchase_payments_set_updated_at
  BEFORE UPDATE ON purchase_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  document_id uuid NOT NULL,
  amount_poisha bigint NOT NULL,
  base_poisha bigint NOT NULL,
  vds_poisha bigint NOT NULL DEFAULT 0,
  tds_poisha bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_payment_allocations_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT purchase_payment_allocations_payment_fk FOREIGN KEY (company_id, payment_id)
    REFERENCES purchase_payments (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payment_allocations_document_fk FOREIGN KEY (company_id, document_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_payment_allocations_amounts CHECK (
    amount_poisha > 0 AND base_poisha >= 0 AND vds_poisha >= 0 AND tds_poisha >= 0
  )
);

CREATE INDEX purchase_payment_allocations_company_payment_idx
  ON purchase_payment_allocations (company_id, payment_id);
CREATE INDEX purchase_payment_allocations_company_document_idx
  ON purchase_payment_allocations (company_id, document_id);

CREATE TABLE purchase_withholding_liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  bill_id uuid,
  payment_id uuid,
  allocation_id uuid,
  party_id uuid NOT NULL,
  tax_type text NOT NULL,
  tax_period text NOT NULL,
  base_poisha bigint NOT NULL,
  rate_bps integer NOT NULL,
  amount_poisha bigint NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  journal_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_withholding_liabilities_bill_fk FOREIGN KEY (company_id, bill_id)
    REFERENCES purchase_documents (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_withholding_liabilities_payment_fk FOREIGN KEY (company_id, payment_id)
    REFERENCES purchase_payments (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_withholding_liabilities_allocation_fk FOREIGN KEY (company_id, allocation_id)
    REFERENCES purchase_payment_allocations (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_withholding_liabilities_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_withholding_liabilities_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_withholding_liabilities_source_check CHECK (
    (source_type = 'BILL' AND bill_id IS NOT NULL AND payment_id IS NULL AND allocation_id IS NULL
      AND tax_type = 'REVERSE_CHARGE')
    OR (source_type = 'PAYMENT' AND bill_id IS NOT NULL AND payment_id IS NOT NULL
      AND allocation_id IS NOT NULL AND tax_type IN ('VDS', 'TDS'))
  ),
  CONSTRAINT purchase_withholding_liabilities_tax_type_check CHECK (
    tax_type IN ('VDS', 'TDS', 'REVERSE_CHARGE')
  ),
  CONSTRAINT purchase_withholding_liabilities_status_check CHECK (
    status IN ('PENDING', 'DEPOSITED', 'REVERSED')
  ),
  CONSTRAINT purchase_withholding_liabilities_period_check CHECK (tax_period ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT purchase_withholding_liabilities_amounts CHECK (
    base_poisha >= 0 AND rate_bps >= 0 AND amount_poisha > 0
  ),
  CONSTRAINT purchase_withholding_liabilities_reversed_fields CHECK (
    status <> 'REVERSED' OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)
  )
);

CREATE INDEX purchase_withholding_liabilities_company_status_idx
  ON purchase_withholding_liabilities (company_id, status, tax_type, tax_period);
CREATE INDEX purchase_withholding_liabilities_company_payment_idx
  ON purchase_withholding_liabilities (company_id, payment_id);
CREATE INDEX purchase_withholding_liabilities_company_bill_idx
  ON purchase_withholding_liabilities (company_id, bill_id);

-- AP open items derive from posted bills/expense vouchers less posted payment allocations. There is
-- no mutable settled flag and no purchase debit-note support in this phase.
CREATE VIEW purchase_ap_open_items AS
SELECT d.company_id,
       d.id AS document_id,
       d.doc_type,
       d.document_no,
       d.supplier_invoice_no,
       d.party_id,
       d.doc_date,
       d.due_date,
       d.gross_poisha,
       COALESCE(a.allocated_poisha, 0)::bigint AS allocated_poisha,
       (d.gross_poisha - COALESCE(a.allocated_poisha, 0))::bigint AS outstanding_poisha
  FROM purchase_documents d
  LEFT JOIN (
    SELECT al.company_id, al.document_id, sum(al.amount_poisha) AS allocated_poisha
      FROM purchase_payment_allocations al
      JOIN purchase_payments p ON p.company_id = al.company_id AND p.id = al.payment_id
     WHERE p.status = 'POSTED'
     GROUP BY al.company_id, al.document_id
  ) a ON a.company_id = d.company_id AND a.document_id = d.id
 WHERE d.status = 'POSTED';

-- Posted purchase documents are immutable. The only permitted transition is POSTED -> REVERSED
-- with its linked reversal metadata. Deletion is only permitted for an unposted draft.
CREATE FUNCTION protect_purchase_document_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'posted purchase documents cannot be deleted'
        USING ERRCODE = '55000',
              HINT = 'Post a linked reversal instead of deleting financial history.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed purchase document is immutable'
      USING ERRCODE = '55000',
            HINT = 'Post a new correcting document instead of changing a reversed one.';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'POSTED') THEN
    RAISE EXCEPTION 'a draft purchase document may only be posted or remain a draft'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted purchase document may only transition to REVERSED'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
       OR NEW.document_no IS DISTINCT FROM OLD.document_no
       OR NEW.supplier_invoice_no IS DISTINCT FROM OLD.supplier_invoice_no
       OR NEW.supplier_invoice_date IS DISTINCT FROM OLD.supplier_invoice_date
       OR NEW.supplier_mushak63_serial IS DISTINCT FROM OLD.supplier_mushak63_serial
       OR NEW.supplier_mushak63_date IS DISTINCT FROM OLD.supplier_mushak63_date
       OR NEW.reverse_charge_challan_reference IS DISTINCT FROM OLD.reverse_charge_challan_reference
       OR NEW.attachment_reference IS DISTINCT FROM OLD.attachment_reference
       OR NEW.party_id IS DISTINCT FROM OLD.party_id
       OR NEW.doc_date IS DISTINCT FROM OLD.doc_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.supplier_bin IS DISTINCT FROM OLD.supplier_bin
       OR NEW.supplier_tin IS DISTINCT FROM OLD.supplier_tin
       OR NEW.supplier_tin_missing IS DISTINCT FROM OLD.supplier_tin_missing
       OR NEW.vds_applicable IS DISTINCT FROM OLD.vds_applicable
       OR NEW.tds_nature IS DISTINCT FROM OLD.tds_nature
       OR NEW.withholding_entity IS DISTINCT FROM OLD.withholding_entity
       OR NEW.subtotal_poisha IS DISTINCT FROM OLD.subtotal_poisha
       OR NEW.discount_poisha IS DISTINCT FROM OLD.discount_poisha
       OR NEW.vat_poisha IS DISTINCT FROM OLD.vat_poisha
       OR NEW.supplier_vat_poisha IS DISTINCT FROM OLD.supplier_vat_poisha
       OR NEW.reverse_charge_vat_poisha IS DISTINCT FROM OLD.reverse_charge_vat_poisha
       OR NEW.vat_claimable_poisha IS DISTINCT FROM OLD.vat_claimable_poisha
       OR NEW.vat_disallowed_poisha IS DISTINCT FROM OLD.vat_disallowed_poisha
       OR NEW.cost_poisha IS DISTINCT FROM OLD.cost_poisha
       OR NEW.gross_poisha IS DISTINCT FROM OLD.gross_poisha
       OR NEW.vds_poisha IS DISTINCT FROM OLD.vds_poisha
       OR NEW.tds_poisha IS DISTINCT FROM OLD.tds_poisha
       OR NEW.net_payable_poisha IS DISTINCT FROM OLD.net_payable_poisha
       OR NEW.tax_pack_version IS DISTINCT FROM OLD.tax_pack_version
       OR NEW.tax_decision_state IS DISTINCT FROM OLD.tax_decision_state
       OR NEW.tax_snapshot_json IS DISTINCT FROM OLD.tax_snapshot_json
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.posting_idempotency_key IS DISTINCT FROM OLD.posting_idempotency_key
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
    THEN
      RAISE EXCEPTION 'posted purchase document fields are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_documents_protect_posted
  BEFORE UPDATE OR DELETE ON purchase_documents
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_document_row();

CREATE FUNCTION protect_purchase_document_line_row()
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
    FROM purchase_documents
   WHERE company_id = target_company AND id = target_document;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'purchase document line has no parent document' USING ERRCODE = '23503';
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'purchase document lines are immutable after posting'
      USING ERRCODE = '55000',
            HINT = 'Post a linked reversal instead.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER purchase_document_lines_protect_posted
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_document_lines
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_document_line_row();

CREATE TRIGGER purchase_document_taxes_append_only
  BEFORE UPDATE OR DELETE ON purchase_document_taxes
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER purchase_tax_decisions_append_only
  BEFORE UPDATE OR DELETE ON purchase_tax_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER purchase_document_events_append_only
  BEFORE UPDATE OR DELETE ON purchase_document_events
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE TRIGGER purchase_payment_allocations_append_only
  BEFORE UPDATE OR DELETE ON purchase_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_sales_history_mutation();

CREATE FUNCTION protect_purchase_payment_row()
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
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'posted purchase payment fields are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_payments_protect_posted
  BEFORE UPDATE OR DELETE ON purchase_payments
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_payment_row();

CREATE FUNCTION protect_purchase_withholding_liability()
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
  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('PENDING', 'DEPOSITED', 'REVERSED'))
    OR (OLD.status = 'DEPOSITED' AND NEW.status = 'DEPOSITED')
  ) THEN
    RAISE EXCEPTION 'invalid withholding liability status transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_withholding_liabilities_protect
  BEFORE UPDATE OR DELETE ON purchase_withholding_liabilities
  FOR EACH ROW EXECUTE FUNCTION protect_purchase_withholding_liability();

COMMENT ON TABLE purchase_documents IS
  'Supplier bills and expense vouchers. A stock line is a real goods receipt; PO/GRN/three-way match are not modelled.';
COMMENT ON TABLE purchase_document_lines IS
  'Line-level inventory/expense classification, VAT, input-credit split and cost after disallowed VAT.';
COMMENT ON TABLE purchase_document_taxes IS
  'Immutable VAT, reverse-charge, VDS and TDS evidence snapshot for a purchase document.';
COMMENT ON TABLE purchase_tax_decisions IS
  'Immutable document tax decision input/output snapshot, including supplier TIN/BIN and evidence facts.';
COMMENT ON TABLE purchase_payments IS
  'Supplier payments. Cash paid plus actual VDS/TDS equals the gross amount allocated to bills.';
COMMENT ON TABLE purchase_payment_allocations IS
  'Append-only allocation of a posted payment to supplier bills, including the actual withholding.';
COMMENT ON TABLE purchase_withholding_liabilities IS
  'VDS/TDS liabilities created from payments and reverse-charge VAT from bills, queued for Treasury deposit.';
COMMENT ON VIEW purchase_ap_open_items IS
  'Derived supplier-bill open items from posted documents and posted payment allocations.';
