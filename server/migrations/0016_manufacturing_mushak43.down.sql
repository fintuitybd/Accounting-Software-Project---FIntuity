DROP TABLE IF EXISTS production_batches CASCADE;
DROP TABLE IF EXISTS mushak_43_ingredients CASCADE;
DROP TABLE IF EXISTS mushak_43_declarations CASCADE;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'PAYROLL', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY', 'TREASURY',
      'BANK_RECONCILIATION', 'SUSPENSE'
    )
  );

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_source_type_check CHECK (
    source_type IN (
      'MANUAL', 'OPENING', 'GRN', 'SALES', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL'
    )
  );
