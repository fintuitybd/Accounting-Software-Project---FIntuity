-- Phase 4 company configuration: onboarding progress, fiscal years and periods, chart of accounts,
-- opening-balance batches, bank/cash/MFS accounts, company settings and number sequences.
--
-- Financial amounts are BIGINT poisha. Opening balances are DRAFT/SUBMITTED only; the POSTED state
-- deliberately does not exist until the Phase 5 ledger posting service is implemented.

CREATE TABLE company_onboarding (
  company_id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  current_step text NOT NULL DEFAULT 'COMPANY',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_onboarding_company_org_fk FOREIGN KEY (organisation_id, company_id)
    REFERENCES companies (organisation_id, id) ON DELETE RESTRICT,
  CONSTRAINT company_onboarding_step_check CHECK (
    current_step IN ('COMPANY', 'FISCAL_YEAR', 'CHART_OF_ACCOUNTS', 'OPENING_BALANCES', 'BANK_ACCOUNTS', 'SETTINGS')
  )
);

CREATE TRIGGER company_onboarding_set_updated_at
  BEFORE UPDATE ON company_onboarding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_years_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT fiscal_years_company_start_unique UNIQUE (company_id, start_date),
  CONSTRAINT fiscal_years_label_length CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT fiscal_years_date_order CHECK (end_date >= start_date),
  CONSTRAINT fiscal_years_month_boundaries CHECK (
    start_date = date_trunc('month', start_date::timestamp)::date
    AND end_date = (date_trunc('month', end_date::timestamp) + interval '1 month - 1 day')::date
  ),
  CONSTRAINT fiscal_years_status_check CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED'))
);

CREATE INDEX fiscal_years_company_idx ON fiscal_years (company_id, start_date);

CREATE FUNCTION reject_fiscal_year_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM fiscal_years existing
     WHERE existing.company_id = NEW.company_id
       AND existing.id <> NEW.id
       AND daterange(existing.start_date, existing.end_date, '[]')
           && daterange(NEW.start_date, NEW.end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'fiscal year overlaps an existing fiscal year'
      USING ERRCODE = '23505',
            HINT = 'Choose a non-overlapping fiscal year range.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_years_no_overlap
  BEFORE INSERT OR UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION reject_fiscal_year_overlap();

CREATE TRIGGER fiscal_years_set_updated_at
  BEFORE UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  closed_at timestamptz,
  closed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  locked_at timestamptz,
  locked_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  reopened_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periods_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT periods_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT periods_company_start_unique UNIQUE (company_id, start_date),
  CONSTRAINT periods_fiscal_year_fk FOREIGN KEY (company_id, fiscal_year_id)
    REFERENCES fiscal_years (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT periods_code_format CHECK (code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT periods_date_order CHECK (end_date >= start_date),
  CONSTRAINT periods_month_boundaries CHECK (
    start_date = date_trunc('month', start_date::timestamp)::date
    AND end_date = (date_trunc('month', end_date::timestamp) + interval '1 month - 1 day')::date
  ),
  CONSTRAINT periods_status_check CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED'))
);

CREATE INDEX periods_company_dates_idx ON periods (company_id, start_date);
CREATE INDEX periods_fiscal_year_idx ON periods (fiscal_year_id);

CREATE FUNCTION reject_period_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM periods existing
     WHERE existing.company_id = NEW.company_id
       AND existing.id <> NEW.id
       AND daterange(existing.start_date, existing.end_date, '[]')
           && daterange(NEW.start_date, NEW.end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'period overlaps an existing period'
      USING ERRCODE = '23505',
            HINT = 'Choose a non-overlapping period range.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER periods_no_overlap
  BEFORE INSERT OR UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION reject_period_overlap();

CREATE TRIGGER periods_set_updated_at
  BEFORE UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  account_type text NOT NULL,
  sub_category text NOT NULL,
  ifrs_category text NOT NULL DEFAULT 'NA_BALANCE_SHEET',
  parent_id uuid,
  control_subledger text NOT NULL DEFAULT 'NONE',
  currency text NOT NULL DEFAULT 'BDT',
  tax_mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT accounts_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT accounts_parent_fk FOREIGN KEY (company_id, parent_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT accounts_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
  CONSTRAINT accounts_name_length CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 200),
  CONSTRAINT accounts_name_bn_length CHECK (name_bn IS NULL OR char_length(btrim(name_bn)) <= 200),
  CONSTRAINT accounts_type_check CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  CONSTRAINT accounts_sub_category_check CHECK (
    sub_category IN (
      'CURRENT_ASSET', 'NON_CURRENT_ASSET', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY',
      'EQUITY_CAPITAL', 'EQUITY_RESERVES', 'OPERATING_REVENUE', 'COST_OF_SALES',
      'OPERATING_EXPENSE', 'FINANCE_COST', 'INVESTING_INCOME', 'TAX_EXPENSE'
    )
  ),
  CONSTRAINT accounts_ifrs_category_check CHECK (
    ifrs_category IN ('OPERATING', 'INVESTING', 'FINANCING', 'INCOME_TAX', 'DISCONTINUED', 'NA_BALANCE_SHEET')
  ),
  CONSTRAINT accounts_control_subledger_check CHECK (
    control_subledger IN (
      'NONE', 'AR', 'AP', 'BANK_MFS', 'VAT_CURRENT_ACCOUNT', 'VDS_PAYABLE', 'TDS_PAYABLE',
      'INVENTORY', 'FIXED_ASSETS'
    )
  ),
  CONSTRAINT accounts_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT accounts_tax_mapping_object CHECK (jsonb_typeof(tax_mapping_json) = 'object')
);

CREATE INDEX accounts_company_parent_idx ON accounts (company_id, parent_id);
CREATE INDEX accounts_company_type_idx ON accounts (company_id, account_type);

CREATE FUNCTION protect_control_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.control_subledger <> 'NONE' THEN
    IF NEW.code <> OLD.code
       OR NEW.account_type <> OLD.account_type
       OR NEW.control_subledger <> OLD.control_subledger
       OR NEW.is_active = false THEN
      RAISE EXCEPTION 'control account cannot be repurposed, recoded or deactivated'
        USING ERRCODE = '55000',
              HINT = 'Control accounts are protected because reports and subledgers depend on them.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_protect_control
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION protect_control_account();

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE company_settings (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  key text NOT NULL,
  value_json jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key),
  CONSTRAINT company_settings_key_check CHECK (key IN ('language', 'approval_thresholds', 'tax'))
);

CREATE TABLE number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL,
  doc_type text NOT NULL,
  prefix text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  pad integer NOT NULL DEFAULT 4,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT number_sequences_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT number_sequences_company_year_type_unique UNIQUE (company_id, fiscal_year_id, doc_type),
  CONSTRAINT number_sequences_fiscal_year_fk FOREIGN KEY (company_id, fiscal_year_id)
    REFERENCES fiscal_years (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN'
    )
  ),
  CONSTRAINT number_sequences_prefix_check CHECK (char_length(prefix) BETWEEN 1 AND 20),
  CONSTRAINT number_sequences_next_value_check CHECK (next_value >= 1),
  CONSTRAINT number_sequences_pad_check CHECK (pad BETWEEN 1 AND 12),
  CONSTRAINT number_sequences_version_check CHECK (version >= 1)
);

CREATE INDEX number_sequences_company_idx ON number_sequences (company_id, fiscal_year_id);

CREATE TRIGGER number_sequences_set_updated_at
  BEFORE UPDATE ON number_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL,
  provider text,
  masked_number text,
  branch text,
  currency text NOT NULL DEFAULT 'BDT',
  gl_account_id uuid NOT NULL,
  opening_poisha bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  is_principal boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_accounts_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT bank_accounts_company_gl_unique UNIQUE (company_id, gl_account_id),
  CONSTRAINT bank_accounts_gl_fk FOREIGN KEY (company_id, gl_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT bank_accounts_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT bank_accounts_kind_check CHECK (kind IN ('BANK', 'MFS', 'CASH')),
  CONSTRAINT bank_accounts_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT bank_accounts_opening_non_negative CHECK (opening_poisha >= 0),
  CONSTRAINT bank_accounts_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE UNIQUE INDEX bank_accounts_one_principal
  ON bank_accounts (company_id)
  WHERE is_principal AND status = 'ACTIVE';

CREATE INDEX bank_accounts_company_idx ON bank_accounts (company_id, status);

CREATE FUNCTION validate_bank_account_gl()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account record;
BEGIN
  SELECT account_type, control_subledger, is_active
    INTO account
    FROM accounts
   WHERE company_id = NEW.company_id AND id = NEW.gl_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank GL account does not belong to this company'
      USING ERRCODE = '23503';
  END IF;
  IF account.account_type <> 'ASSET' OR account.control_subledger <> 'BANK_MFS' THEN
    RAISE EXCEPTION 'bank GL account must be an active ASSET account with BANK_MFS control subledger'
      USING ERRCODE = '23514';
  END IF;
  IF account.is_active = false AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'bank GL account must be active'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_accounts_validate_gl
  BEFORE INSERT OR UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION validate_bank_account_gl();

CREATE TRIGGER bank_accounts_set_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE opening_balance_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  batch_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  currency text NOT NULL DEFAULT 'BDT',
  total_debit_poisha bigint NOT NULL DEFAULT 0,
  total_credit_poisha bigint NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT false,
  evidence_reference text,
  evidence_note text,
  evidence_checksum text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_balance_batches_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT opening_balance_batches_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT opening_balance_batches_currency_bdt CHECK (currency = 'BDT'),
  CONSTRAINT opening_balance_batches_status_check CHECK (status IN ('DRAFT', 'SUBMITTED')),
  CONSTRAINT opening_balance_batches_totals_non_negative CHECK (
    total_debit_poisha >= 0 AND total_credit_poisha >= 0
  ),
  CONSTRAINT opening_balance_batches_submit_guard CHECK (
    status <> 'SUBMITTED'
    OR (
      balanced
      AND total_debit_poisha = total_credit_poisha
      AND total_debit_poisha > 0
      AND evidence_reference IS NOT NULL
      AND char_length(btrim(evidence_reference)) > 0
      AND submitted_at IS NOT NULL
    )
  ),
  CONSTRAINT opening_balance_batches_evidence_checksum CHECK (
    evidence_checksum IS NULL OR evidence_checksum ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX opening_balance_batches_one_submitted
  ON opening_balance_batches (company_id)
  WHERE status = 'SUBMITTED';

CREATE UNIQUE INDEX opening_balance_batches_one_draft
  ON opening_balance_batches (company_id)
  WHERE status = 'DRAFT';

CREATE INDEX opening_balance_batches_company_idx ON opening_balance_batches (company_id, created_at);

CREATE FUNCTION validate_opening_balance_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period record;
BEGIN
  SELECT start_date, end_date INTO period
    FROM periods
   WHERE company_id = NEW.company_id AND id = NEW.period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opening balance period does not belong to this company'
      USING ERRCODE = '23503';
  END IF;
  IF NEW.batch_date < period.start_date OR NEW.batch_date > period.end_date THEN
    RAISE EXCEPTION 'opening balance date is outside the selected period'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opening_balance_batches_validate_period
  BEFORE INSERT OR UPDATE ON opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION validate_opening_balance_period();

CREATE TRIGGER opening_balance_batches_set_updated_at
  BEFORE UPDATE ON opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE opening_balance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  line_no integer NOT NULL,
  account_id uuid NOT NULL,
  schedule_type text NOT NULL DEFAULT 'ACCOUNT',
  schedule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  debit_poisha bigint NOT NULL DEFAULT 0,
  credit_poisha bigint NOT NULL DEFAULT 0,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_balance_lines_batch_line_unique UNIQUE (batch_id, line_no),
  CONSTRAINT opening_balance_lines_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT opening_balance_lines_batch_fk FOREIGN KEY (company_id, batch_id)
    REFERENCES opening_balance_batches (company_id, id) ON DELETE CASCADE,
  CONSTRAINT opening_balance_lines_account_fk FOREIGN KEY (company_id, account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT opening_balance_lines_line_no_positive CHECK (line_no >= 1),
  CONSTRAINT opening_balance_lines_amounts_non_negative CHECK (debit_poisha >= 0 AND credit_poisha >= 0),
  CONSTRAINT opening_balance_lines_one_side CHECK ((debit_poisha > 0) <> (credit_poisha > 0)),
  CONSTRAINT opening_balance_lines_schedule_type_check CHECK (
    schedule_type IN ('ACCOUNT', 'PARTY', 'ITEM', 'FIXED_ASSET')
  ),
  CONSTRAINT opening_balance_lines_schedule_object CHECK (jsonb_typeof(schedule_json) = 'object'),
  CONSTRAINT opening_balance_lines_memo_length CHECK (memo IS NULL OR char_length(memo) <= 500)
);

CREATE INDEX opening_balance_lines_company_batch_idx ON opening_balance_lines (company_id, batch_id);
CREATE INDEX opening_balance_lines_account_idx ON opening_balance_lines (company_id, account_id);

CREATE TRIGGER opening_balance_lines_set_updated_at
  BEFORE UPDATE ON opening_balance_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE opening_balance_batches IS
  'Opening balances remain DRAFT or SUBMITTED until Phase 5 posts them through the ledger service.';
COMMENT ON COLUMN opening_balance_batches.status IS
  'DRAFT or SUBMITTED only. POSTED is intentionally absent until the ledger posting service exists.';
COMMENT ON TABLE accounts IS
  'Company chart of accounts. Accounts with a control_subledger other than NONE are protected from recoding and deactivation.';
