-- Phase 18: Section 177 Withholding Tax Returns, Document Sequences and Mushak 6.6 Issuance
--
-- Adds gapless statutory document sequences (Mushak 6.3, 6.5, 6.6, 6.7, 4.3, Challan),
-- Section 177 Withholding Tax Return tables with Schedules A-D deductee lines,
-- and non-rebatable VAT tracking on purchase document lines.

-- 1. GAPLESS DOCUMENT SEQUENCES
CREATE TABLE document_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches (id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years (id) ON DELETE RESTRICT,
  doc_type text NOT NULL,
  prefix text NOT NULL,
  current_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_seq_company_unique UNIQUE (company_id, id),
  CONSTRAINT doc_seq_current_val_non_negative CHECK (current_value >= 0),
  CONSTRAINT doc_seq_type_check CHECK (
    doc_type IN ('MUSHAK_6_3', 'MUSHAK_6_5', 'MUSHAK_6_6', 'MUSHAK_6_7', 'MUSHAK_4_3', 'CHALLAN', 'TDS_CERTIFICATE')
  )
);

CREATE UNIQUE INDEX doc_seq_company_global_fy_type_uniq
  ON document_sequences (company_id, fiscal_year_id, doc_type)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX doc_seq_company_branch_fy_type_uniq
  ON document_sequences (company_id, branch_id, fiscal_year_id, doc_type)
  WHERE branch_id IS NOT NULL;

CREATE INDEX doc_seq_company_lookup_idx
  ON document_sequences (company_id, fiscal_year_id, doc_type);

-- 2. SECTION 177 WITHHOLDING TAX RETURNS
CREATE TABLE withholding_tax_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL,
  return_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_gross_paid_poisha bigint NOT NULL DEFAULT 0,
  total_tds_deducted_poisha bigint NOT NULL DEFAULT 0,
  total_tds_deposited_poisha bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  submission_ack_number text,
  submitted_at timestamptz,
  prepared_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  verified_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wht_returns_company_unique UNIQUE (company_id, id),
  CONSTRAINT wht_returns_fiscal_year_fk FOREIGN KEY (company_id, fiscal_year_id)
    REFERENCES fiscal_years (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT wht_returns_company_type_period_uniq UNIQUE (company_id, return_type, period_start, period_end),
  CONSTRAINT wht_returns_dates_order CHECK (period_end >= period_start),
  CONSTRAINT wht_returns_type_check CHECK (return_type IN ('MONTHLY_177', 'HALF_YEARLY_177', 'ANNUAL_177')),
  CONSTRAINT wht_returns_status_check CHECK (status IN ('DRAFT', 'VERIFIED', 'SUBMITTED')),
  CONSTRAINT wht_returns_amounts_non_negative CHECK (
    total_gross_paid_poisha >= 0 AND total_tds_deducted_poisha >= 0 AND total_tds_deposited_poisha >= 0
  )
);

CREATE INDEX wht_returns_company_period_idx ON withholding_tax_returns (company_id, period_start, period_end);
CREATE INDEX wht_returns_company_status_idx ON withholding_tax_returns (company_id, status);

CREATE TRIGGER withholding_tax_returns_set_updated_at
  BEFORE UPDATE ON withholding_tax_returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. SECTION 177 WITHHOLDING RETURN LINES
CREATE TABLE withholding_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  return_id uuid NOT NULL REFERENCES withholding_tax_returns (id) ON DELETE CASCADE,
  schedule_code text NOT NULL,
  party_id uuid REFERENCES parties (id) ON DELETE RESTRICT,
  source_document_id uuid,
  deductee_name text NOT NULL,
  deductee_tin text,
  deductee_bin text,
  has_etin_penalty_upscale boolean NOT NULL DEFAULT false,
  section_code text NOT NULL,
  economic_code text NOT NULL,
  gross_amount_poisha bigint NOT NULL,
  paid_amount_poisha bigint NOT NULL,
  tds_rate_bps integer NOT NULL,
  tds_amount_poisha bigint NOT NULL,
  payment_date date NOT NULL,
  challan_id uuid,
  challan_number text,
  challan_date date,
  bank_name text,
  anomaly_flags text,
  CONSTRAINT wht_lines_company_unique UNIQUE (company_id, id),
  CONSTRAINT wht_lines_challan_fk FOREIGN KEY (company_id, challan_id)
    REFERENCES treasury_challans (company_id, id) ON DELETE SET NULL,
  CONSTRAINT wht_lines_schedule_check CHECK (
    schedule_code IN ('SCHED_A_SALARY', 'SCHED_B_GOODS', 'SCHED_C_RENT', 'SCHED_D_PROF')
  ),
  CONSTRAINT wht_lines_amounts_check CHECK (
    gross_amount_poisha >= 0 AND paid_amount_poisha >= 0 AND tds_rate_bps >= 0 AND tds_amount_poisha >= 0
  )
);

CREATE INDEX wht_lines_return_idx ON withholding_return_lines (company_id, return_id);
CREATE INDEX wht_lines_schedule_idx ON withholding_return_lines (company_id, return_id, schedule_code);

-- 4. NON-REBATABLE VAT COLUMN ON PURCHASE DOCUMENT LINES
ALTER TABLE purchase_document_lines
  ADD COLUMN IF NOT EXISTS non_rebatable_vat_poisha bigint NOT NULL DEFAULT 0;

-- 5. RELAX LIABILITY_ID ON RECEIVED TREASURY CERTIFICATES (Customer Mushak 6.6)
ALTER TABLE treasury_certificates ALTER COLUMN liability_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION assert_treasury_certificate_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source record;
BEGIN
  IF NEW.direction = 'RECEIVED' THEN
    IF NEW.base_poisha < 0 OR NEW.tax_poisha <= 0 THEN
      RAISE EXCEPTION 'received certificate amounts must be positive' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

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
