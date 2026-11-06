-- Phase 6 master data and inventory.
--
-- Parties, items, branches/warehouses and the immutable stock subledger. Quantities are
-- NUMERIC(18,4): four decimal places are accepted (for example kg/metres) and the API stores them
-- as ten-thousandths. Money remains BIGINT poisha. Stock movements are append-only and are valued
-- by the weighted-average service; stock_balances is the concurrency-controlled current position.

-- The inventory posting service uses its own ledger source module so inventory journals are
-- distinguishable from sales, purchases and manual journals.
ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY'
    )
  );

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  address text,
  bin text,
  is_principal boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branches_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT branches_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT branches_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT branches_code_length CHECK (char_length(btrim(code)) BETWEEN 1 AND 32),
  CONSTRAINT branches_name_length CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 200),
  CONSTRAINT branches_name_bn_length CHECK (name_bn IS NULL OR char_length(btrim(name_bn)) <= 200),
  CONSTRAINT branches_address_length CHECK (address IS NULL OR char_length(address) <= 500),
  CONSTRAINT branches_bin_format CHECK (bin IS NULL OR bin ~ '^[0-9]{13}$')
);

CREATE UNIQUE INDEX branches_company_code_lower_unique ON branches (company_id, lower(btrim(code)));
CREATE UNIQUE INDEX branches_one_principal ON branches (company_id) WHERE is_principal = true AND status = 'ACTIVE';
CREATE INDEX branches_company_status_idx ON branches (company_id, status, name_en);

CREATE TRIGGER branches_set_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  type text NOT NULL,
  bin text,
  tin text,
  address_en text,
  address_bn text,
  phone text,
  email text,
  credit_days integer NOT NULL DEFAULT 0,
  credit_limit_poisha bigint NOT NULL DEFAULT 0,
  is_withholding_buyer boolean NOT NULL DEFAULT false,
  is_government boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT parties_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT parties_type_check CHECK (type IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
  CONSTRAINT parties_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT parties_code_length CHECK (char_length(btrim(code)) BETWEEN 1 AND 32),
  CONSTRAINT parties_name_length CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 200),
  CONSTRAINT parties_name_bn_length CHECK (name_bn IS NULL OR char_length(btrim(name_bn)) <= 200),
  CONSTRAINT parties_bin_format CHECK (bin IS NULL OR bin ~ '^[0-9]{13}$'),
  CONSTRAINT parties_tin_format CHECK (tin IS NULL OR tin ~ '^[0-9]{12}$'),
  CONSTRAINT parties_address_en_length CHECK (address_en IS NULL OR char_length(address_en) <= 500),
  CONSTRAINT parties_address_bn_length CHECK (address_bn IS NULL OR char_length(address_bn) <= 500),
  CONSTRAINT parties_phone_length CHECK (phone IS NULL OR char_length(btrim(phone)) <= 32),
  CONSTRAINT parties_email_length CHECK (email IS NULL OR char_length(btrim(email)) <= 320),
  CONSTRAINT parties_credit_days_range CHECK (credit_days BETWEEN 0 AND 3650),
  CONSTRAINT parties_credit_limit_non_negative CHECK (credit_limit_poisha >= 0)
);

CREATE UNIQUE INDEX parties_company_code_lower_unique ON parties (company_id, lower(btrim(code)));
CREATE INDEX parties_company_status_idx ON parties (company_id, status, name_en);
CREATE INDEX parties_company_type_idx ON parties (company_id, type, status);

CREATE TRIGGER parties_set_updated_at
  BEFORE UPDATE ON parties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE party_opening_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  party_id uuid NOT NULL,
  document_type text NOT NULL,
  document_no text NOT NULL,
  due_date date NOT NULL,
  amount_poisha bigint NOT NULL,
  base_poisha bigint,
  memo text,
  status text NOT NULL DEFAULT 'OPEN',
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_opening_items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT party_opening_items_document_unique UNIQUE (company_id, document_type, document_no),
  CONSTRAINT party_opening_items_party_fk FOREIGN KEY (company_id, party_id)
    REFERENCES parties (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT party_opening_items_document_type_check CHECK (
    document_type IN ('SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER')
  ),
  CONSTRAINT party_opening_items_status_check CHECK (status IN ('OPEN', 'CANCELLED')),
  CONSTRAINT party_opening_items_amount_positive CHECK (amount_poisha > 0),
  CONSTRAINT party_opening_items_base_non_negative CHECK (base_poisha IS NULL OR base_poisha >= 0),
  CONSTRAINT party_opening_items_document_no_length CHECK (char_length(btrim(document_no)) BETWEEN 1 AND 64),
  CONSTRAINT party_opening_items_memo_length CHECK (memo IS NULL OR char_length(memo) <= 500),
  CONSTRAINT party_opening_items_cancel_fields CHECK (
    status <> 'CANCELLED'
    OR (
      cancel_reason IS NOT NULL
      AND char_length(btrim(cancel_reason)) BETWEEN 3 AND 500
      AND cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
    )
  )
);

CREATE INDEX party_opening_items_company_party_idx ON party_opening_items (company_id, party_id, status, due_date);
CREATE INDEX party_opening_items_company_due_idx ON party_opening_items (company_id, status, due_date);

CREATE TRIGGER party_opening_items_set_updated_at
  BEFORE UPDATE ON party_opening_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid,
  code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  address text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT warehouses_company_code_unique UNIQUE (company_id, code),
  CONSTRAINT warehouses_branch_fk FOREIGN KEY (company_id, branch_id)
    REFERENCES branches (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT warehouses_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT warehouses_code_length CHECK (char_length(btrim(code)) BETWEEN 1 AND 32),
  CONSTRAINT warehouses_name_length CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 200),
  CONSTRAINT warehouses_name_bn_length CHECK (name_bn IS NULL OR char_length(btrim(name_bn)) <= 200),
  CONSTRAINT warehouses_address_length CHECK (address IS NULL OR char_length(address) <= 500)
);

CREATE UNIQUE INDEX warehouses_company_code_lower_unique ON warehouses (company_id, lower(btrim(code)));
CREATE INDEX warehouses_company_status_idx ON warehouses (company_id, status, name_en);
CREATE INDEX warehouses_company_branch_idx ON warehouses (company_id, branch_id);

CREATE TRIGGER warehouses_set_updated_at
  BEFORE UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  sku text NOT NULL,
  hs_code text,
  name_en text NOT NULL,
  name_bn text,
  unit text NOT NULL,
  unit_bn text,
  is_stock_item boolean NOT NULL DEFAULT true,
  default_tax_category text NOT NULL DEFAULT 'STANDARD_15',
  inventory_account_id uuid,
  expense_account_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT items_company_sku_unique UNIQUE (company_id, sku),
  CONSTRAINT items_inventory_account_fk FOREIGN KEY (company_id, inventory_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT items_expense_account_fk FOREIGN KEY (company_id, expense_account_id)
    REFERENCES accounts (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT items_status_check CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT items_sku_length CHECK (char_length(btrim(sku)) BETWEEN 1 AND 64),
  CONSTRAINT items_hs_code_format CHECK (hs_code IS NULL OR hs_code ~ '^[0-9A-Za-z.-]{2,20}$'),
  CONSTRAINT items_name_length CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 200),
  CONSTRAINT items_name_bn_length CHECK (name_bn IS NULL OR char_length(btrim(name_bn)) <= 200),
  CONSTRAINT items_unit_length CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  CONSTRAINT items_unit_bn_length CHECK (unit_bn IS NULL OR char_length(btrim(unit_bn)) <= 40),
  CONSTRAINT items_tax_category_check CHECK (
    default_tax_category IN (
      'STANDARD_15', 'TRADING_5', 'PROCUREMENT_7_5', 'EXPORT_ZERO', 'EXEMPT', 'REVERSE_CHARGE',
      'OUT_OF_SCOPE'
    )
  ),
  CONSTRAINT items_stock_accounts_check CHECK (
    is_stock_item = false
    OR (inventory_account_id IS NOT NULL AND expense_account_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX items_company_sku_lower_unique ON items (company_id, lower(btrim(sku)));
CREATE INDEX items_company_status_idx ON items (company_id, status, name_en);
CREATE INDEX items_company_inventory_account_idx ON items (company_id, inventory_account_id);

CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  movement_no integer NOT NULL,
  idempotency_key text NOT NULL,
  movement_type text NOT NULL,
  movement_date date NOT NULL,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL,
  unit_cost_poisha bigint NOT NULL,
  value_poisha bigint NOT NULL,
  balance_after_quantity numeric(18,4) NOT NULL,
  balance_after_value_poisha bigint NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  source_doc_id uuid,
  journal_id uuid,
  reversal_of_movement_id uuid,
  reversal_reason text,
  negative_stock_override boolean NOT NULL DEFAULT false,
  override_reason text,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_company_id_unique UNIQUE (company_id, id),
  CONSTRAINT stock_movements_command_no_unique UNIQUE (company_id, command_id, movement_no),
  CONSTRAINT stock_movements_idempotency_no_unique UNIQUE (company_id, idempotency_key, movement_no),
  CONSTRAINT stock_movements_item_fk FOREIGN KEY (company_id, item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_journal_fk FOREIGN KEY (company_id, journal_id)
    REFERENCES journals (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_reversal_fk FOREIGN KEY (company_id, reversal_of_movement_id)
    REFERENCES stock_movements (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_type_check CHECK (
    movement_type IN (
      'OPENING_RECEIPT', 'GRN_RECEIPT', 'ISSUE', 'RETURN_IN', 'TRANSFER_OUT', 'TRANSFER_IN',
      'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL_IN', 'REVERSAL_OUT'
    )
  ),
  CONSTRAINT stock_movements_source_type_check CHECK (
    source_type IN ('MANUAL', 'OPENING', 'GRN', 'SALES', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL')
  ),
  CONSTRAINT stock_movements_movement_no_positive CHECK (movement_no >= 1),
  CONSTRAINT stock_movements_quantity_positive CHECK (quantity > 0),
  CONSTRAINT stock_movements_unit_cost_non_negative CHECK (unit_cost_poisha >= 0),
  CONSTRAINT stock_movements_value_non_negative CHECK (value_poisha >= 0),
  CONSTRAINT stock_movements_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT stock_movements_source_ref_length CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  CONSTRAINT stock_movements_reversal_fields CHECK (
    movement_type NOT IN ('REVERSAL_IN', 'REVERSAL_OUT')
    OR (
      reversal_of_movement_id IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND char_length(btrim(reversal_reason)) BETWEEN 3 AND 500
    )
  ),
  CONSTRAINT stock_movements_override_fields CHECK (
    negative_stock_override = false
    OR (
      override_reason IS NOT NULL
      AND char_length(btrim(override_reason)) BETWEEN 3 AND 500
    )
  )
);

CREATE UNIQUE INDEX stock_movements_one_reversal
  ON stock_movements (company_id, reversal_of_movement_id)
  WHERE reversal_of_movement_id IS NOT NULL;
CREATE INDEX stock_movements_company_date_idx ON stock_movements (company_id, movement_date DESC, created_at DESC);
CREATE INDEX stock_movements_company_item_idx ON stock_movements (company_id, item_id, movement_date DESC);
CREATE INDEX stock_movements_company_warehouse_idx ON stock_movements (company_id, warehouse_id, movement_date DESC);
CREATE INDEX stock_movements_company_command_idx ON stock_movements (company_id, command_id);
CREATE INDEX stock_movements_company_journal_idx ON stock_movements (company_id, journal_id);

-- Stock history is immutable. Corrections are posted as reversal movements, never by editing or
-- deleting the original movement.
CREATE FUNCTION reject_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only'
    USING ERRCODE = '55000',
          HINT = 'Post a linked reversal movement instead of changing stock history.';
END;
$$;

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();

CREATE TABLE stock_balances (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL DEFAULT 0,
  value_poisha bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, item_id, warehouse_id),
  CONSTRAINT stock_balances_item_fk FOREIGN KEY (company_id, item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_balances_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT
);

CREATE INDEX stock_balances_company_warehouse_idx ON stock_balances (company_id, warehouse_id);
CREATE INDEX stock_balances_company_value_idx ON stock_balances (company_id, value_poisha);

CREATE TRIGGER stock_balances_set_updated_at
  BEFORE UPDATE ON stock_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE stock_movements IS 'Immutable stock subledger. Every row carries source, actor and timestamp; corrections are reversals.';
COMMENT ON TABLE stock_balances IS 'Current item/warehouse quantity and value maintained under a row lock by the stock service.';
