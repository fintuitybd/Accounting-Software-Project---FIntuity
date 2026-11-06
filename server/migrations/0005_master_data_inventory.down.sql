-- Development/test rollback for Phase 6. Financial subledger history must never be destroyed by a
-- rollback: the migration aborts if any stock movement or party opening item exists. Masters alone
-- can be recreated from export, but a posted stock history cannot.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM stock_movements) THEN
    RAISE EXCEPTION 'cannot roll back Phase 6 while stock movements exist; archive the inventory subledger first'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM party_opening_items) THEN
    RAISE EXCEPTION 'cannot roll back Phase 6 while party opening items exist; archive the AR/AP opening schedule first'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TABLE IF EXISTS stock_balances;
DROP TABLE IF EXISTS stock_movements;
DROP FUNCTION IF EXISTS reject_stock_movement_mutation();
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS party_opening_items;
DROP TABLE IF EXISTS parties;
DROP TABLE IF EXISTS branches;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE'
    )
  );
