DROP TABLE IF EXISTS withholding_return_lines;
DROP TABLE IF EXISTS withholding_tax_returns;
DROP TABLE IF EXISTS document_sequences;
ALTER TABLE purchase_document_lines DROP COLUMN IF EXISTS non_rebatable_vat_poisha;
