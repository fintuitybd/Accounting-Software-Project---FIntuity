-- Development/test rollback for Phase 9. Production migrations are forward-only. Refuse to remove
-- the Treasury tables while any deposit, certificate or approval request exists.
DO $$
BEGIN
  IF to_regclass('public.treasury_challans') IS NOT NULL
     AND (EXISTS (SELECT 1 FROM treasury_challans)
          OR EXISTS (SELECT 1 FROM treasury_certificates)
          OR EXISTS (SELECT 1 FROM purchase_payment_approval_requests)) THEN
    RAISE EXCEPTION 'cannot roll back Phase 9 while treasury challans, certificates or payment approvals exist'
      USING HINT = 'Take a backup and reverse the business documents through the application first.';
  END IF;
END;
$$;

DROP TABLE IF EXISTS treasury_certificates;
DROP TABLE IF EXISTS treasury_challan_items;
DROP TABLE IF EXISTS purchase_payment_approval_requests;

ALTER TABLE purchase_withholding_liabilities
  DROP CONSTRAINT IF EXISTS purchase_withholding_liabilities_company_id_unique,
  DROP CONSTRAINT IF EXISTS purchase_withholding_liabilities_deposited_fields,
  DROP CONSTRAINT IF EXISTS purchase_withholding_liabilities_pending_fields,
  DROP CONSTRAINT IF EXISTS purchase_withholding_liabilities_economic_code_length,
  DROP CONSTRAINT IF EXISTS purchase_withholding_liabilities_challan_fk;

DROP INDEX IF EXISTS purchase_withholding_liabilities_company_challan_idx;

ALTER TABLE purchase_withholding_liabilities
  DROP COLUMN IF EXISTS deposited_at,
  DROP COLUMN IF EXISTS challan_id,
  DROP COLUMN IF EXISTS economic_code;

DROP TABLE IF EXISTS treasury_challans;

DROP FUNCTION IF EXISTS protect_purchase_payment_approval_request();
DROP FUNCTION IF EXISTS protect_treasury_challan_row();
DROP FUNCTION IF EXISTS assert_treasury_certificate_derivation();
DROP FUNCTION IF EXISTS protect_treasury_certificate();
DROP FUNCTION IF EXISTS assert_treasury_challan_total();

ALTER TABLE purchase_payments
  DROP CONSTRAINT IF EXISTS purchase_payments_approved_fields,
  DROP CONSTRAINT IF EXISTS purchase_payments_attachment_length;

ALTER TABLE purchase_payments
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS attachment_reference;

ALTER TABLE sales_receipts
  DROP CONSTRAINT IF EXISTS sales_receipts_attachment_length;
ALTER TABLE sales_receipts
  DROP COLUMN IF EXISTS attachment_reference;

-- Restore the Phase 8 withholding trigger body.
CREATE OR REPLACE FUNCTION protect_purchase_withholding_liability()
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

-- Restore the Phase 8 payment trigger body.
CREATE OR REPLACE FUNCTION protect_purchase_payment_row()
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

-- Restore the Phase 7 receipt trigger body.
CREATE OR REPLACE FUNCTION protect_sales_receipt_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales receipts cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversed sales receipt is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED' THEN
      RAISE EXCEPTION 'a posted sales receipt may only transition to REVERSED' USING ERRCODE = '55000';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
       OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
       OR NEW.party_id IS DISTINCT FROM OLD.party_id
       OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
       OR NEW.amount_poisha IS DISTINCT FROM OLD.amount_poisha
       OR NEW.write_off_poisha IS DISTINCT FROM OLD.write_off_poisha
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.narration_en IS DISTINCT FROM OLD.narration_en
       OR NEW.narration_bn IS DISTINCT FROM OLD.narration_bn
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'posted sales receipt fields are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM number_sequences WHERE doc_type = 'TREASURY_CERTIFICATE';

ALTER TABLE number_sequences DROP CONSTRAINT number_sequences_doc_type_check;
ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_doc_type_check CHECK (
    doc_type IN (
      'SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE_VOUCHER', 'RECEIPT', 'PAYMENT',
      'JOURNAL', 'DELIVERY_CHALLAN', 'GRN', 'TREASURY_CHALLAN', 'MUSHAK_63', 'MUSHAK_67'
    )
  );

ALTER TABLE journals DROP CONSTRAINT journals_source_module_check;
ALTER TABLE journals
  ADD CONSTRAINT journals_source_module_check CHECK (
    source_module IN (
      'SALES', 'PURCHASES', 'BANK_MFS', 'PAYROLL_LITE', 'MANUAL_JOURNAL', 'IFRS_ADJUSTMENT',
      'MASS_IMPORT', 'REVERSAL', 'OPENING_BALANCE', 'INVENTORY'
    )
  );
