-- Phase 20: Manufacturing BOM, NBR Mushak 4.3 Input-Output Engine & IAS 2 COGS Costing
--
-- Adds:
-- 1. mushak_43_declarations (NBR Rule 21 Input-Output Coefficient Declarations)
-- 2. mushak_43_ingredients (Raw material BOM lines with Section 46(3) wastage guardrails)
-- 3. production_batches (IAS 2 production runs with raw material stock deduction, FG addition, and balanced GL posting)
-- 4. Extends source_module check on journals and source_type on stock_movements to include 'MANUFACTURING'

-- 1. MUSHAK 4.3 DECLARATIONS
CREATE TABLE mushak_43_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  declaration_number text NOT NULL,
  finished_item_id uuid NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  output_quantity numeric(16, 4) NOT NULL,
  output_unit text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'DRAFT',
  nbr_submission_date date,
  nbr_division_office text,
  total_rm_cost_poisha bigint NOT NULL DEFAULT 0,
  direct_labor_cost_poisha bigint NOT NULL DEFAULT 0,
  overhead_cost_poisha bigint NOT NULL DEFAULT 0,
  packaging_cost_poisha bigint NOT NULL DEFAULT 0,
  target_profit_margin_bps integer NOT NULL DEFAULT 1500,
  declared_price_poisha bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mushak_43_company_unique UNIQUE (company_id, id),
  CONSTRAINT mushak_43_company_number_unique UNIQUE (company_id, declaration_number),
  CONSTRAINT mushak_43_item_fk FOREIGN KEY (company_id, finished_item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT mushak_43_status_check CHECK (
    status IN ('DRAFT', 'SUBMITTED_TO_NBR', 'APPROVED', 'SUPERSEDED')
  ),
  CONSTRAINT mushak_43_output_qty_positive CHECK (output_quantity > 0),
  CONSTRAINT mushak_43_costs_non_negative CHECK (
    total_rm_cost_poisha >= 0 AND direct_labor_cost_poisha >= 0 AND
    overhead_cost_poisha >= 0 AND packaging_cost_poisha >= 0 AND
    target_profit_margin_bps >= 0 AND declared_price_poisha >= 0
  )
);

CREATE INDEX mushak_43_company_item_idx ON mushak_43_declarations (company_id, finished_item_id);
CREATE INDEX mushak_43_company_status_idx ON mushak_43_declarations (company_id, status);

CREATE TRIGGER mushak_43_declarations_set_updated_at
  BEFORE UPDATE ON mushak_43_declarations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. MUSHAK 4.3 INGREDIENTS
CREATE TABLE mushak_43_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  declaration_id uuid NOT NULL REFERENCES mushak_43_declarations (id) ON DELETE CASCADE,
  raw_item_id uuid NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  net_quantity numeric(16, 4) NOT NULL,
  wastage_bps integer NOT NULL DEFAULT 0,
  gross_quantity numeric(16, 4) NOT NULL,
  unit text NOT NULL,
  rate_per_unit_poisha bigint NOT NULL,
  total_cost_poisha bigint NOT NULL,
  rebatable_input_vat boolean NOT NULL DEFAULT true,
  is_abnormal_wastage boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mushak_43_ingredients_company_unique UNIQUE (company_id, id),
  CONSTRAINT mushak_43_ingredients_declaration_fk FOREIGN KEY (company_id, declaration_id)
    REFERENCES mushak_43_declarations (company_id, id) ON DELETE CASCADE,
  CONSTRAINT mushak_43_ingredients_item_fk FOREIGN KEY (company_id, raw_item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT mushak_43_ingredients_net_qty_positive CHECK (net_quantity > 0),
  CONSTRAINT mushak_43_ingredients_gross_qty_positive CHECK (gross_quantity > 0),
  CONSTRAINT mushak_43_ingredients_wastage_non_negative CHECK (wastage_bps >= 0),
  CONSTRAINT mushak_43_ingredients_rate_non_negative CHECK (rate_per_unit_poisha >= 0),
  CONSTRAINT mushak_43_ingredients_total_non_negative CHECK (total_cost_poisha >= 0)
);

CREATE INDEX mushak_43_ingredients_declaration_idx ON mushak_43_ingredients (company_id, declaration_id);
CREATE INDEX mushak_43_ingredients_raw_item_idx ON mushak_43_ingredients (company_id, raw_item_id);

-- 3. PRODUCTION BATCHES
CREATE TABLE production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  batch_number text NOT NULL,
  declaration_id uuid NOT NULL REFERENCES mushak_43_declarations (id) ON DELETE RESTRICT,
  finished_item_id uuid NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  batch_date date NOT NULL,
  batch_quantity numeric(16, 4) NOT NULL,
  status text NOT NULL DEFAULT 'COMPLETED',
  total_rm_cost_poisha bigint NOT NULL DEFAULT 0,
  direct_labor_cost_poisha bigint NOT NULL DEFAULT 0,
  overhead_cost_poisha bigint NOT NULL DEFAULT 0,
  packaging_cost_poisha bigint NOT NULL DEFAULT 0,
  total_cost_poisha bigint NOT NULL DEFAULT 0,
  unit_cost_poisha bigint NOT NULL DEFAULT 0,
  has_abnormal_wastage boolean NOT NULL DEFAULT false,
  abnormal_wastage_cost_poisha bigint NOT NULL DEFAULT 0,
  vat_rebate_clawback_poisha bigint NOT NULL DEFAULT 0,
  clawback_note text,
  journal_id uuid REFERENCES journals (id) ON DELETE RESTRICT,
  executed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  executed_at timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_batches_company_unique UNIQUE (company_id, id),
  CONSTRAINT production_batches_company_number_unique UNIQUE (company_id, batch_number),
  CONSTRAINT production_batches_declaration_fk FOREIGN KEY (company_id, declaration_id)
    REFERENCES mushak_43_declarations (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_batches_item_fk FOREIGN KEY (company_id, finished_item_id)
    REFERENCES items (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_batches_warehouse_fk FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT production_batches_status_check CHECK (
    status IN ('DRAFT', 'COMPLETED', 'CANCELLED')
  ),
  CONSTRAINT production_batches_quantity_positive CHECK (batch_quantity > 0),
  CONSTRAINT production_batches_costs_non_negative CHECK (
    total_rm_cost_poisha >= 0 AND direct_labor_cost_poisha >= 0 AND
    overhead_cost_poisha >= 0 AND packaging_cost_poisha >= 0 AND
    total_cost_poisha >= 0 AND unit_cost_poisha >= 0 AND
    abnormal_wastage_cost_poisha >= 0 AND vat_rebate_clawback_poisha >= 0
  )
);

CREATE INDEX production_batches_company_status_idx ON production_batches (company_id, status);
CREATE INDEX production_batches_company_item_idx ON production_batches (company_id, finished_item_id);
CREATE INDEX production_batches_company_date_idx ON production_batches (company_id, batch_date);

CREATE TRIGGER production_batches_set_updated_at
  BEFORE UPDATE ON production_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. ALLOW MANUFACTURING AS SYSTEM JOURNAL SOURCE MODULE & STOCK MOVEMENT SOURCE TYPE
ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'PAYROLL', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'MANUFACTURING', 'TREASURY',
      'BANK_RECONCILIATION', 'SUSPENSE'
    )
  );

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_source_type_check CHECK (
    source_type IN (
      'MANUAL', 'OPENING', 'GRN', 'SALES', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL', 'MANUFACTURING'
    )
  );
