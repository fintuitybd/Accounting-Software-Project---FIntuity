DROP TABLE IF EXISTS payroll_run_lines;
DROP TABLE IF EXISTS payroll_runs;
DROP TABLE IF EXISTS payroll_employees;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION', 'SUSPENSE'
    )
  );
