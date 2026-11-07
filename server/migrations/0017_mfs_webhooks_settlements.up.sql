-- Phase 22: MFS Webhooks, Automatic MDR Fee Split (Account 5190) & PGW Batch Settlement Reconciliation
--
-- Adds:
-- 1. mfs_webhook_events (HMAC-SHA256 authenticated webhook events for bKash, Nagad, SSLCommerz, AamarPay)
-- 2. Makes bank_statement_lines.statement_id nullable to allow auto-created MFS webhook statement lines

CREATE TABLE mfs_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  external_trx_id text NOT NULL,
  invoice_id uuid REFERENCES sales_documents (id) ON DELETE RESTRICT,
  gross_amount_poisha bigint NOT NULL,
  mdr_fee_bps integer NOT NULL,
  mdr_fee_poisha bigint NOT NULL,
  net_settled_poisha bigint NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  journal_id uuid REFERENCES journals (id) ON DELETE RESTRICT,
  raw_payload text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfs_webhook_provider_trx_uniq UNIQUE (company_id, provider, external_trx_id),
  CONSTRAINT mfs_webhook_provider_check CHECK (provider IN ('BKASH', 'NAGAD', 'SSLCOMMERZ', 'AAMARPAY')),
  CONSTRAINT mfs_webhook_amounts_check CHECK (
    gross_amount_poisha >= 0 AND mdr_fee_bps >= 0 AND mdr_fee_poisha >= 0 AND net_settled_poisha >= 0
    AND gross_amount_poisha = mdr_fee_poisha + net_settled_poisha
  )
);

CREATE INDEX mfs_webhook_events_company_invoice_idx ON mfs_webhook_events (company_id, invoice_id);
CREATE INDEX mfs_webhook_events_company_provider_idx ON mfs_webhook_events (company_id, provider, processed_at DESC);

-- Allow statement_id on bank_statement_lines to be nullable for direct MFS webhook settlement lines
ALTER TABLE bank_statement_lines ALTER COLUMN statement_id DROP NOT NULL;
