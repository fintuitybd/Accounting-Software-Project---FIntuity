-- Phase 19: Server-Authoritative Labour Act 2026 Payroll Engine & BEFTN Payouts
--
-- Adds Labour Act 2026 payroll tables:
-- 1. payroll_employees (worker classification, statutory salary components, PF enrollment, bank/MFS payout routing)
-- 2. payroll_runs (maker-checker monthly batch runs, GL journal posting link, status lifecycle)
-- 3. payroll_run_lines (line items with Section 108 double-rate overtime, festival bonuses, PF match, Section 86 TDS)

-- 1. PAYROLL EMPLOYEES
CREATE TABLE payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches (id) ON DELETE RESTRICT,
  employee_code text NOT NULL,
  name_en text NOT NULL,
  name_bn text,
  worker_classification text NOT NULL,
  nid_number text,
  etin text,
  joining_date date NOT NULL,
  basic_salary_poisha bigint NOT NULL,
  hra_poisha bigint NOT NULL,
  medical_poisha bigint NOT NULL,
  conveyance_poisha bigint NOT NULL,
  pf_enrolled boolean NOT NULL DEFAULT true,
  pf_rate_bps integer NOT NULL DEFAULT 1000,
  payment_channel text NOT NULL DEFAULT 'BANK',
  bank_name text,
  bank_account_number text,
  bank_routing_number text,
  mfs_number text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_emp_company_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_emp_company_code_uniq UNIQUE (company_id, employee_code),
  CONSTRAINT payroll_emp_worker_class_check CHECK (
    worker_classification IN ('PERMANENT', 'PROBATIONARY', 'CONTRACTUAL', 'PIECE_RATE', 'APPRENTICE')
  ),
  CONSTRAINT payroll_emp_payment_channel_check CHECK (
    payment_channel IN ('BANK', 'BKASH', 'NAGAD', 'CASH')
  ),
  CONSTRAINT payroll_emp_status_check CHECK (
    status IN ('ACTIVE', 'INACTIVE', 'TERMINATED')
  ),
  CONSTRAINT payroll_emp_amounts_non_negative CHECK (
    basic_salary_poisha >= 0 AND hra_poisha >= 0 AND medical_poisha >= 0 AND conveyance_poisha >= 0 AND pf_rate_bps >= 0
  )
);

CREATE INDEX payroll_emp_company_status_idx ON payroll_employees (company_id, status);
CREATE INDEX payroll_emp_company_branch_idx ON payroll_employees (company_id, branch_id);

CREATE TRIGGER payroll_employees_set_updated_at
  BEFORE UPDATE ON payroll_employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. PAYROLL RUNS
CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  batch_date date NOT NULL,
  total_basic_poisha bigint NOT NULL DEFAULT 0,
  total_gross_poisha bigint NOT NULL DEFAULT 0,
  total_ot_poisha bigint NOT NULL DEFAULT 0,
  total_bonus_poisha bigint NOT NULL DEFAULT 0,
  total_tds_poisha bigint NOT NULL DEFAULT 0,
  total_pf_employee_poisha bigint NOT NULL DEFAULT 0,
  total_pf_employer_poisha bigint NOT NULL DEFAULT 0,
  net_payable_poisha bigint NOT NULL DEFAULT 0,
  journal_id uuid REFERENCES journals (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT',
  approved_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  posted_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_company_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_runs_period_fk FOREIGN KEY (company_id, period_id)
    REFERENCES periods (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_runs_company_period_uniq UNIQUE (company_id, period_id),
  CONSTRAINT payroll_runs_status_check CHECK (
    status IN ('DRAFT', 'APPROVED', 'POSTED', 'DISBURSED')
  ),
  CONSTRAINT payroll_runs_totals_non_negative CHECK (
    total_basic_poisha >= 0 AND total_gross_poisha >= 0 AND total_ot_poisha >= 0 AND
    total_bonus_poisha >= 0 AND total_tds_poisha >= 0 AND total_pf_employee_poisha >= 0 AND
    total_pf_employer_poisha >= 0 AND net_payable_poisha >= 0
  )
);

CREATE INDEX payroll_runs_company_status_idx ON payroll_runs (company_id, status);

CREATE TRIGGER payroll_runs_set_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. PAYROLL RUN LINES
CREATE TABLE payroll_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES payroll_runs (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  basic_poisha bigint NOT NULL,
  hra_poisha bigint NOT NULL,
  medical_poisha bigint NOT NULL,
  conveyance_poisha bigint NOT NULL,
  ot_hours_scaled integer NOT NULL DEFAULT 0,
  ot_amount_poisha bigint NOT NULL DEFAULT 0,
  festival_bonus_poisha bigint NOT NULL DEFAULT 0,
  gross_pay_poisha bigint NOT NULL,
  pf_employee_poisha bigint NOT NULL DEFAULT 0,
  pf_employer_poisha bigint NOT NULL DEFAULT 0,
  tds_poisha bigint NOT NULL DEFAULT 0,
  net_pay_poisha bigint NOT NULL,
  CONSTRAINT payroll_run_lines_company_unique UNIQUE (company_id, id),
  CONSTRAINT payroll_lines_employee_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES payroll_employees (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT payroll_lines_company_run_employee_uniq UNIQUE (company_id, run_id, employee_id),
  CONSTRAINT payroll_lines_amounts_non_negative CHECK (
    basic_poisha >= 0 AND hra_poisha >= 0 AND medical_poisha >= 0 AND conveyance_poisha >= 0 AND
    ot_hours_scaled >= 0 AND ot_amount_poisha >= 0 AND festival_bonus_poisha >= 0 AND
    gross_pay_poisha >= 0 AND pf_employee_poisha >= 0 AND pf_employer_poisha >= 0 AND
    tds_poisha >= 0 AND net_pay_poisha >= 0
  )
);

CREATE INDEX payroll_lines_run_idx ON payroll_run_lines (company_id, run_id);
CREATE INDEX payroll_lines_employee_idx ON payroll_run_lines (company_id, employee_id);

-- 4. ALLOW PAYROLL AS SYSTEM JOURNAL SOURCE MODULE
ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'PAYROLL', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION', 'SUSPENSE'
    )
  );
