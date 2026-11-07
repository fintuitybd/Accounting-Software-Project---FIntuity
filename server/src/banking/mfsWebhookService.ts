import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { allocateSalesNumber, resolvePeriodForNumbering } from '../sales/salesService.ts';
import { postSystemJournalWithinTransaction } from '../ledger/ledgerService.ts';

export type MfsProvider = 'BKASH' | 'NAGAD' | 'SSLCOMMERZ' | 'AAMARPAY';

export interface MfsWebhookEventDto {
  id: string;
  companyId: string;
  provider: MfsProvider;
  externalTrxId: string;
  invoiceId: string | null;
  invoiceNumber?: string | null;
  customerName?: string | null;
  grossAmountPoisha: string;
  grossAmountBdt: string;
  mdrFeeBps: number;
  mdrFeePoisha: string;
  mdrFeeBdt: string;
  netSettledPoisha: string;
  netSettledBdt: string;
  signatureVerified: boolean;
  journalId: string | null;
  rawPayload: string;
  processedAt: string;
}

export interface ProcessMfsWebhookInput {
  companyId: string;
  provider: string;
  signature?: string;
  secret?: string;
  rawPayload?: string;
  payload: {
    externalTrxId?: string;
    trxId?: string;
    trxID?: string;
    paymentRefId?: string;
    transactionId?: string;
    invoiceId?: string | null;
    invoice_id?: string | null;
    merchantInvoiceNumber?: string;
    orderId?: string;
    order_id?: string;
    grossAmountPoisha?: string | number | bigint;
    amount?: string | number;
    mdrFeeBps?: number;
    mdr_fee_bps?: number;
    valueDate?: string;
    [key: string]: unknown;
  };
  audit?: {
    organisationId?: string | null;
    actorUserId?: string | null;
    sessionId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  };
}

export interface PgwBatchTransactionInput {
  externalTrxId: string;
  invoiceId?: string | null;
  grossAmountPoisha?: string | number | bigint;
  amount?: string | number;
  mdrFeeBps?: number;
  valueDate?: string;
}

export interface PgwBatchSettlementInput {
  companyId: string;
  provider: 'SSLCOMMERZ' | 'AAMARPAY';
  batchReference: string;
  settlementDate: string;
  transactions: PgwBatchTransactionInput[];
  secret?: string;
  signature?: string;
  audit?: {
    organisationId?: string | null;
    actorUserId?: string | null;
    sessionId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  };
}

export interface PgwBatchReconciliationResult {
  batchReference: string;
  provider: MfsProvider;
  settlementDate: string;
  totalTransactions: number;
  reconciledCount: number;
  replayedCount: number;
  totalGrossPoisha: string;
  totalGrossBdt: string;
  totalMdrFeePoisha: string;
  totalMdrFeeBdt: string;
  totalNetSettledPoisha: string;
  totalNetSettledBdt: string;
  events: MfsWebhookEventDto[];
}

export function getWebhookSecret(provider: string, overrideSecret?: string): string {
  if (overrideSecret && overrideSecret.trim()) return overrideSecret.trim();
  const upper = provider.toUpperCase();
  const providerKey = `${upper}_WEBHOOK_SECRET`;
  return process.env[providerKey] || process.env.MFS_WEBHOOK_SECRET || 'fintuity_mfs_secret_token_2026';
}

/**
 * Verify HMAC-SHA256 signature using crypto.timingSafeEqual.
 */
export function verifyWebhookSignature(
  rawPayload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !signature.trim()) return false;
  const cleanSig = signature.trim().replace(/^sha256=/i, '');

  const expectedHex = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
  const hexBuf = Buffer.from(expectedHex, 'utf8');
  const sigBuf = Buffer.from(cleanSig, 'utf8');
  if (hexBuf.length === sigBuf.length && crypto.timingSafeEqual(hexBuf, sigBuf)) {
    return true;
  }

  const expectedB64 = crypto.createHmac('sha256', secret).update(rawPayload).digest('base64');
  const b64Buf = Buffer.from(expectedB64, 'utf8');
  if (b64Buf.length === sigBuf.length && crypto.timingSafeEqual(b64Buf, sigBuf)) {
    return true;
  }

  return false;
}

/**
 * Computes exact integer MDR fee split using BigInt:
 * mdrFeePoisha = floor(grossAmountPoisha * BigInt(mdrFeeBps) / 10000n)
 * netSettledPoisha = grossAmountPoisha - mdrFeePoisha
 */
export function calculateMdrFeeSplit(
  grossAmountPoisha: bigint,
  mdrFeeBps: number,
): { mdrFeePoisha: bigint; netSettledPoisha: bigint } {
  if (grossAmountPoisha < 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Gross amount cannot be negative.');
  }
  if (mdrFeeBps < 0 || mdrFeeBps > 10000) {
    throw new AppError(400, 'INVALID_MDR_RATE', 'MDR fee basis points must be between 0 and 10000.');
  }
  const mdrFeePoisha = (grossAmountPoisha * BigInt(mdrFeeBps)) / 10000n;
  const netSettledPoisha = grossAmountPoisha - mdrFeePoisha;
  return { mdrFeePoisha, netSettledPoisha };
}

function mapMfsWebhookEvent(
  row: {
    id: string;
    company_id: string;
    provider: string;
    external_trx_id: string;
    invoice_id: string | null;
    invoice_number?: string | null;
    customer_name?: string | null;
    gross_amount_poisha: string | bigint;
    mdr_fee_bps: number;
    mdr_fee_poisha: string | bigint;
    net_settled_poisha: string | bigint;
    signature_verified: boolean;
    journal_id: string | null;
    raw_payload: string;
    processed_at: Date | string;
  },
): MfsWebhookEventDto {
  const gross = BigInt(row.gross_amount_poisha);
  const mdr = BigInt(row.mdr_fee_poisha);
  const net = BigInt(row.net_settled_poisha);
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider as MfsProvider,
    externalTrxId: row.external_trx_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number ?? null,
    customerName: row.customer_name ?? null,
    grossAmountPoisha: gross.toString(),
    grossAmountBdt: formatPoishaAsBdt(gross),
    mdrFeeBps: Number(row.mdr_fee_bps),
    mdrFeePoisha: mdr.toString(),
    mdrFeeBdt: formatPoishaAsBdt(mdr),
    netSettledPoisha: net.toString(),
    netSettledBdt: formatPoishaAsBdt(net),
    signatureVerified: Boolean(row.signature_verified),
    journalId: row.journal_id,
    rawPayload: row.raw_payload,
    processedAt: row.processed_at instanceof Date ? row.processed_at.toISOString() : String(row.processed_at),
  };
}

async function resolveMfsAccounts(
  client: PoolClient,
  companyId: string,
  provider: string,
): Promise<{
  mfsWalletAccount: { id: string; code: string };
  mdrFeeAccount: { id: string; code: string };
  arAccount: { id: string; code: string };
}> {
  // 1. MFS Merchant Wallet: Account 1120
  let mfsWallet = (
    await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '1120' AND is_active = true LIMIT 1`,
      [companyId],
    )
  ).rows[0];

  if (!mfsWallet) {
    const bankAccount = (
      await client.query<{ gl_account_id: string }>(
        `SELECT gl_account_id FROM bank_accounts
          WHERE company_id = $1 AND (provider = $2 OR kind = 'MFS') AND status = 'ACTIVE' LIMIT 1`,
        [companyId, provider],
      )
    ).rows[0];
    if (bankAccount) {
      const acc = (
        await client.query<{ id: string; code: string }>(
          `SELECT id, code FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true`,
          [companyId, bankAccount.gl_account_id],
        )
      ).rows[0];
      if (acc) mfsWallet = acc;
    }
  }

  if (!mfsWallet) {
    mfsWallet = (
      await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM accounts WHERE company_id = $1 AND control_subledger = 'BANK_MFS' AND is_active = true LIMIT 1`,
        [companyId],
      )
    ).rows[0];
  }

  if (!mfsWallet) {
    const inserted = await client.query<{ id: string; code: string }>(
      `INSERT INTO accounts (
         company_id, code, name_en, name_bn, account_type, sub_category, ifrs_category, control_subledger, currency, is_active
       ) VALUES ($1, '1120', 'Cash at MFS - bKash/Nagad Merchant Wallet', 'এমএফএস মার্চেন্ট ওয়ালেট', 'ASSET', 'CURRENT_ASSET', 'OPERATING', 'BANK_MFS', 'BDT', true)
       RETURNING id, code`,
      [companyId],
    );
    mfsWallet = inserted.rows[0]!;
  }

  // 2. MDR Fee Expense: Account 5190 (IFRS 18 Operating Expenses)
  let mdrFee = (
    await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '5190' AND is_active = true LIMIT 1`,
      [companyId],
    )
  ).rows[0];

  if (!mdrFee) {
    mdrFee = (
      await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '5820' AND is_active = true LIMIT 1`,
        [companyId],
      )
    ).rows[0];
  }

  if (!mdrFee) {
    const inserted = await client.query<{ id: string; code: string }>(
      `INSERT INTO accounts (
         company_id, code, name_en, name_bn, account_type, sub_category, ifrs_category, control_subledger, currency, is_active
       ) VALUES ($1, '5190', 'MFS & Payment Gateway MDR Charges', 'এমএফএস ও গেটওয়ে এমডিআর খরচ', 'EXPENSE', 'OPERATING_EXPENSE', 'OPERATING', 'NONE', 'BDT', true)
       RETURNING id, code`,
      [companyId],
    );
    mdrFee = inserted.rows[0]!;
  }

  // 3. Accounts Receivable: Account 1210
  let ar = (
    await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND code = '1210' AND is_active = true LIMIT 1`,
      [companyId],
    )
  ).rows[0];

  if (!ar) {
    ar = (
      await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM accounts WHERE company_id = $1 AND control_subledger = 'AR' AND is_active = true LIMIT 1`,
        [companyId],
      )
    ).rows[0];
  }

  if (!ar) {
    const inserted = await client.query<{ id: string; code: string }>(
      `INSERT INTO accounts (
         company_id, code, name_en, name_bn, account_type, sub_category, ifrs_category, control_subledger, currency, is_active
       ) VALUES ($1, '1210', 'Trade Accounts Receivable', 'প্রাপ্য হিসাব', 'ASSET', 'CURRENT_ASSET', 'OPERATING', 'AR', 'BDT', true)
       RETURNING id, code`,
      [companyId],
    );
    ar = inserted.rows[0]!;
  }

  return { mfsWalletAccount: mfsWallet, mdrFeeAccount: mdrFee, arAccount: ar };
}

async function resolveBankAccountId(
  client: PoolClient,
  companyId: string,
  provider: string,
  glAccountId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM bank_accounts
      WHERE company_id = $1 AND (provider = $2 OR (gl_account_id = $3 AND kind = 'MFS')) AND status = 'ACTIVE'
      LIMIT 1`,
    [companyId, provider, glAccountId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const anyBank = await client.query<{ id: string }>(
    `SELECT id FROM bank_accounts WHERE company_id = $1 AND status = 'ACTIVE' LIMIT 1`,
    [companyId],
  );
  if (anyBank.rows[0]) return anyBank.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO bank_accounts (
       company_id, name, kind, provider, currency, gl_account_id, status, is_principal
     ) VALUES ($1, $2, 'MFS', $3, 'BDT', $4, 'ACTIVE', false)
     RETURNING id`,
    [companyId, `${provider} Merchant Account`, provider, glAccountId],
  );
  return inserted.rows[0]!.id;
}

export async function processMfsWebhook(
  pool: Pool,
  input: ProcessMfsWebhookInput,
): Promise<{
  event: MfsWebhookEventDto;
  replayed: boolean;
  journalId?: string | null;
  statementLineId?: string | null;
}> {
  const provider = input.provider.toUpperCase().trim() as MfsProvider;
  if (!['BKASH', 'NAGAD', 'SSLCOMMERZ', 'AAMARPAY'].includes(provider)) {
    throw new AppError(400, 'UNSUPPORTED_PROVIDER', `Provider ${input.provider} is not supported.`);
  }

  const rawPayload =
    typeof input.rawPayload === 'string'
      ? input.rawPayload
      : JSON.stringify(input.payload);

  const secret = getWebhookSecret(provider, input.secret);
  const signatureVerified = verifyWebhookSignature(rawPayload, input.signature, secret);

  if (!signatureVerified) {
    throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid or missing webhook signature.');
  }

  const externalTrxId = String(
    input.payload.externalTrxId ||
      input.payload.trxId ||
      input.payload.trxID ||
      input.payload.paymentRefId ||
      input.payload.transactionId ||
      '',
  ).trim();
  if (!externalTrxId) {
    throw new AppError(400, 'INVALID_EXTERNAL_TRX_ID', 'External transaction ID is required.');
  }

  let grossAmountPoisha: bigint;
  if (input.payload.grossAmountPoisha !== undefined && input.payload.grossAmountPoisha !== null) {
    grossAmountPoisha = BigInt(input.payload.grossAmountPoisha);
  } else if (input.payload.amount !== undefined && input.payload.amount !== null) {
    const parsed = parseBdtToPoisha(String(input.payload.amount));
    if (parsed === null) throw new AppError(400, 'INVALID_AMOUNT', 'Invalid transaction amount.');
    grossAmountPoisha = parsed;
  } else {
    throw new AppError(400, 'INVALID_AMOUNT', 'Transaction amount is required.');
  }

  if (grossAmountPoisha <= 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Transaction amount must be positive.');
  }

  const mdrFeeBpsRaw = input.payload.mdrFeeBps ?? input.payload.mdr_fee_bps;
  const mdrFeeBps = mdrFeeBpsRaw !== undefined ? Number(mdrFeeBpsRaw) : 150; // default 1.50%
  const { mdrFeePoisha, netSettledPoisha } = calculateMdrFeeSplit(grossAmountPoisha, mdrFeeBps);

  const targetInvoiceId = (
    input.payload.invoiceId ||
    input.payload.invoice_id ||
    input.payload.orderId ||
    input.payload.order_id ||
    null
  ) as string | null;

  const valueDate =
    input.payload.valueDate && isValidIsoDate(input.payload.valueDate)
      ? input.payload.valueDate
      : new Date().toISOString().slice(0, 10);

  return withTransaction(pool, async (client) => {
    // Advisory lock for idempotency on (companyId, provider, externalTrxId)
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `mfs-webhook:${input.companyId}:${provider}:${externalTrxId}`,
    ]);

    // Enforce idempotency on (company_id, provider, external_trx_id)
    const existing = await client.query<{
      id: string;
      company_id: string;
      provider: string;
      external_trx_id: string;
      invoice_id: string | null;
      gross_amount_poisha: string;
      mdr_fee_bps: number;
      mdr_fee_poisha: string;
      net_settled_poisha: string;
      signature_verified: boolean;
      journal_id: string | null;
      raw_payload: string;
      processed_at: Date;
    }>(
      `SELECT * FROM mfs_webhook_events
        WHERE company_id = $1 AND provider = $2 AND external_trx_id = $3
        LIMIT 1`,
      [input.companyId, provider, externalTrxId],
    );

    if (existing.rows[0]) {
      return {
        event: mapMfsWebhookEvent(existing.rows[0]),
        replayed: true,
        journalId: existing.rows[0].journal_id,
      };
    }

    // 1. Resolve invoice if provided and lock target sales_documents row FOR UPDATE
    let invoiceRow: {
      id: string;
      company_id: string;
      branch_id: string | null;
      party_id: string;
      party_code: string;
      party_name: string;
      status: string;
      gross_poisha: string;
      document_no: string | null;
      created_by: string;
      posted_by: string | null;
    } | null = null;

    if (targetInvoiceId) {
      const invRes = await client.query<{
        id: string;
        company_id: string;
        branch_id: string | null;
        party_id: string;
        party_code: string;
        party_name: string;
        status: string;
        gross_poisha: string;
        document_no: string | null;
        created_by: string;
        posted_by: string | null;
      }>(
        `SELECT sd.id, sd.company_id, sd.branch_id, sd.party_id, sd.status, sd.gross_poisha::text,
                sd.document_no, sd.created_by, sd.posted_by,
                p.code AS party_code, p.name_en AS party_name
           FROM sales_documents sd
           JOIN parties p ON p.company_id = sd.company_id AND p.id = sd.party_id
          WHERE sd.company_id = $1 AND sd.id = $2
            FOR UPDATE OF sd`,
        [input.companyId, targetInvoiceId],
      );

      if (!invRes.rows[0]) {
        throw new AppError(404, 'SALES_DOCUMENT_NOT_FOUND', `Invoice ${targetInvoiceId} not found.`);
      }
      invoiceRow = invRes.rows[0];

      if (invoiceRow.status !== 'POSTED') {
        throw new AppError(
          409,
          'SALES_DOCUMENT_NOT_POSTED',
          `Only posted invoices can be settled. Current status is ${invoiceRow.status}.`,
        );
      }

      // Check open AR amount
      const openRes = await client.query<{ outstanding_poisha: string }>(
        `SELECT outstanding_poisha::text AS outstanding_poisha
           FROM sales_ar_open_items
          WHERE company_id = $1 AND document_id = $2`,
        [input.companyId, targetInvoiceId],
      );
      const openPoisha = openRes.rows[0] ? BigInt(openRes.rows[0].outstanding_poisha) : BigInt(invoiceRow.gross_poisha);
      if (grossAmountPoisha > openPoisha) {
        throw new AppError(
          409,
          'SALES_RECEIPT_ALLOCATION_EXCEEDS_OPEN',
          `The settlement amount of ${formatPoishaAsBdt(grossAmountPoisha)} BDT exceeds the open invoice balance of ${formatPoishaAsBdt(openPoisha)} BDT.`,
          { openBdt: formatPoishaAsBdt(openPoisha) },
        );
      }
    }

    // Resolve system user ID for audit/tracking
    let actorUserId = input.audit?.actorUserId || invoiceRow?.posted_by || invoiceRow?.created_by;
    if (!actorUserId) {
      const userRes = await client.query<{ user_id: string }>(
        `SELECT membership_id AS user_id FROM company_memberships WHERE company_id = $1 LIMIT 1`,
        [input.companyId],
      );
      actorUserId = userRes.rows[0]?.user_id;
    }
    if (!actorUserId) {
      const ownerRes = await client.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
      actorUserId = ownerRes.rows[0]?.id;
    }
    if (!actorUserId) {
      throw new AppError(500, 'USER_NOT_FOUND', 'No valid user found to attribute transaction.');
    }

    // Resolve accounts: 1120 (MFS Wallet), 5190 (MDR Fee Charges), 1210 (Accounts Receivable)
    const { mfsWalletAccount, mdrFeeAccount, arAccount } = await resolveMfsAccounts(
      client,
      input.companyId,
      provider,
    );

    // Resolve bank account id for statement lines
    const bankAccountId = await resolveBankAccountId(
      client,
      input.companyId,
      provider,
      mfsWalletAccount.id,
    );

    // 2. Post balanced 3-line GL journal:
    // DR 1120 MFS Merchant Wallet: netSettledPoisha
    // DR 5190 MFS & Payment Gateway MDR Charges: mdrFeePoisha
    // CR 1210 Accounts Receivable: grossAmountPoisha
    const journalLines: Array<{
      accountId: string;
      debit: string;
      credit: string;
      partyReference?: string | null;
      partyName?: string | null;
      memo?: string | null;
    }> = [
      {
        accountId: mfsWalletAccount.id,
        debit: formatPoishaAsBdt(netSettledPoisha),
        credit: '0',
        memo: `${provider} merchant settlement (${externalTrxId})`,
      },
    ];

    if (mdrFeePoisha > 0n) {
      journalLines.push({
        accountId: mdrFeeAccount.id,
        debit: formatPoishaAsBdt(mdrFeePoisha),
        credit: '0',
        memo: `${provider} MDR charge (${mdrFeeBps} bps)`,
      });
    }

    journalLines.push({
      accountId: arAccount.id,
      debit: '0',
      credit: formatPoishaAsBdt(grossAmountPoisha),
      partyReference: invoiceRow?.party_code ?? null,
      partyName: invoiceRow?.party_name ?? null,
      memo: `AR cleared via ${provider} ${externalTrxId}`,
    });

    const eventId = crypto.randomUUID();
    const period = await resolvePeriodForNumbering(client, input.companyId, valueDate);

    const orgRes = await client.query<{ organisation_id: string }>(
      `SELECT organisation_id FROM companies WHERE id = $1`,
      [input.companyId],
    );
    const organisationId = input.audit?.organisationId || orgRes.rows[0]?.organisation_id || '';

    const journal = await postSystemJournalWithinTransaction(client, {
      organisationId,
      actorUserId,
      sessionId: (input.audit?.sessionId ?? null) as unknown as string,
      ip: input.audit?.ip ?? '127.0.0.1',
      userAgent: input.audit?.userAgent ?? null,
      requestId: input.audit?.requestId ?? `req-mfs-${crypto.randomUUID()}`,
      companyId: input.companyId,
      branchId: invoiceRow?.branch_id ?? null,
      date: valueDate,
      narration: `MFS Webhook collection: ${provider} ${externalTrxId}${invoiceRow?.party_name ? ` — ${invoiceRow.party_name}` : ''}`,
      sourceModule: 'BANK_MFS',
      sourceDocId: eventId,
      sourceDocRef: externalTrxId,
      idempotencyKey: `MFS-WEBHOOK-JOURNAL:${input.companyId}:${provider}:${externalTrxId}`,
      lines: journalLines,
    });

    // If an invoice is attached, also record a sales_receipts & sales_receipt_allocations entry
    let receiptId: string | null = null;
    if (invoiceRow) {
      const receiptNumber = await allocateSalesNumber(
        client,
        input.companyId,
        period.fiscal_year_id,
        period.fiscal_start,
        'RECEIPT',
      );
      receiptId = crypto.randomUUID();
      await client.query(
        `INSERT INTO sales_receipts (
           id, company_id, branch_id, status, receipt_number, receipt_date,
           party_id, bank_account_id, amount_poisha, write_off_poisha,
           reference, narration_en, journal_id, idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          receiptId,
          input.companyId,
          invoiceRow.branch_id,
          'POSTED',
          receiptNumber,
          valueDate,
          invoiceRow.party_id,
          bankAccountId,
          grossAmountPoisha.toString(),
          0,
          externalTrxId,
          `MFS Webhook ${provider} collection for invoice ${invoiceRow.document_no ?? targetInvoiceId}`,
          journal.id,
          `MFS-RECEIPT:${input.companyId}:${provider}:${externalTrxId}`,
          actorUserId,
        ],
      );

      await client.query(
        `INSERT INTO sales_receipt_allocations (
           company_id, receipt_id, document_id, amount_poisha, write_off_poisha, created_by
         ) VALUES ($1,$2,$3,$4,0,$5)`,
        [input.companyId, receiptId, targetInvoiceId, grossAmountPoisha.toString(), actorUserId],
      );
    }

    // 3. Auto-create matched bank_statement_lines record
    const lineNoRes = await client.query<{ next_line: string }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next_line
         FROM bank_statement_lines
        WHERE company_id = $1 AND bank_account_id = $2`,
      [input.companyId, bankAccountId],
    );
    const lineNo = Number(lineNoRes.rows[0]?.next_line || 1);

    const statementLineRes = await client.query<{ id: string }>(
      `INSERT INTO bank_statement_lines (
         company_id, statement_id, bank_account_id, line_no, value_date, description, reference,
         debit_poisha, credit_poisha, balance_poisha, status, fingerprint, match_score, match_reason, matched_journal_id
       ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 0, NULL, 'MATCHED', $8, 100, $9, $10)
       RETURNING id`,
      [
        input.companyId,
        bankAccountId,
        lineNo,
        valueDate,
        `${provider} collection: ${externalTrxId}`,
        externalTrxId,
        netSettledPoisha.toString(),
        `mfs:${provider.toLowerCase()}:${externalTrxId}`,
        'MFS Webhook Auto-Settlement',
        journal.id,
      ],
    );
    const statementLineId = statementLineRes.rows[0]!.id;

    // Record in bank_statement_line_matches
    const bankJournalLine = journal.lines.find((l) => l.accountId === mfsWalletAccount.id);
    if (bankJournalLine) {
      await client.query(
        `INSERT INTO bank_statement_line_matches (
           company_id, bank_account_id, statement_line_id, journal_id, journal_line_id,
           amount_poisha, match_type, match_score, reason, status, matched_by
         ) VALUES ($1,$2,$3,$4,$5,$6,'EXACT',100,$7,'ACTIVE',$8)`,
        [
          input.companyId,
          bankAccountId,
          statementLineId,
          journal.id,
          bankJournalLine.id,
          netSettledPoisha.toString(),
          'MFS Webhook Auto-Settlement',
          actorUserId,
        ],
      );
    }

    // 4. Record event in mfs_webhook_events
    const eventRes = await client.query<{
      id: string;
      company_id: string;
      provider: string;
      external_trx_id: string;
      invoice_id: string | null;
      gross_amount_poisha: string;
      mdr_fee_bps: number;
      mdr_fee_poisha: string;
      net_settled_poisha: string;
      signature_verified: boolean;
      journal_id: string | null;
      raw_payload: string;
      processed_at: Date;
    }>(
      `INSERT INTO mfs_webhook_events (
         id, company_id, provider, external_trx_id, invoice_id,
         gross_amount_poisha, mdr_fee_bps, mdr_fee_poisha, net_settled_poisha,
         signature_verified, journal_id, raw_payload, processed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       RETURNING *`,
      [
        eventId,
        input.companyId,
        provider,
        externalTrxId,
        targetInvoiceId,
        grossAmountPoisha.toString(),
        mdrFeeBps,
        mdrFeePoisha.toString(),
        netSettledPoisha.toString(),
        signatureVerified,
        journal.id,
        rawPayload,
      ],
    );

    return {
      event: mapMfsWebhookEvent({
        ...eventRes.rows[0]!,
        invoice_number: invoiceRow?.document_no ?? null,
        customer_name: invoiceRow?.party_name ?? null,
      }),
      replayed: false,
      journalId: journal.id,
      statementLineId,
    };
  });
}

/**
 * SSLCommerz & AamarPay Batch Settlement Reconciliation
 */
export async function reconcilePgwBatch(
  pool: Pool,
  input: PgwBatchSettlementInput,
): Promise<PgwBatchReconciliationResult> {
  const provider = input.provider.toUpperCase().trim() as MfsProvider;
  if (!['SSLCOMMERZ', 'AAMARPAY'].includes(provider)) {
    throw new AppError(400, 'UNSUPPORTED_PROVIDER', `Provider ${input.provider} is not a supported PGW.`);
  }

  if (!Array.isArray(input.transactions) || input.transactions.length === 0) {
    throw new AppError(400, 'BATCH_TRANSACTIONS_EMPTY', 'Batch must contain at least one transaction.');
  }

  const events: MfsWebhookEventDto[] = [];
  let reconciledCount = 0;
  let replayedCount = 0;
  let totalGross = 0n;
  let totalMdr = 0n;
  let totalNet = 0n;

  for (const trx of input.transactions) {
    const rawPayload = JSON.stringify({
      provider,
      batchReference: input.batchReference,
      ...trx,
    });
    const secret = getWebhookSecret(provider, input.secret);
    const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

    const result = await processMfsWebhook(pool, {
      companyId: input.companyId,
      provider,
      signature,
      secret,
      rawPayload,
      payload: {
        externalTrxId: trx.externalTrxId,
        invoiceId: trx.invoiceId,
        grossAmountPoisha: trx.grossAmountPoisha,
        amount: trx.amount,
        mdrFeeBps: trx.mdrFeeBps ?? (provider === 'SSLCOMMERZ' ? 250 : 250),
        valueDate: trx.valueDate || input.settlementDate,
      },
      audit: input.audit,
    });

    events.push(result.event);
    if (result.replayed) {
      replayedCount += 1;
    } else {
      reconciledCount += 1;
    }
    totalGross += BigInt(result.event.grossAmountPoisha);
    totalMdr += BigInt(result.event.mdrFeePoisha);
    totalNet += BigInt(result.event.netSettledPoisha);
  }

  return {
    batchReference: input.batchReference,
    provider,
    settlementDate: input.settlementDate,
    totalTransactions: input.transactions.length,
    reconciledCount,
    replayedCount,
    totalGrossPoisha: totalGross.toString(),
    totalGrossBdt: formatPoishaAsBdt(totalGross),
    totalMdrFeePoisha: totalMdr.toString(),
    totalMdrFeeBdt: formatPoishaAsBdt(totalMdr),
    totalNetSettledPoisha: totalNet.toString(),
    totalNetSettledBdt: formatPoishaAsBdt(totalNet),
    events,
  };
}

export async function listMfsWebhookEvents(
  pool: Pool,
  companyId: string,
  options: {
    provider?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ events: MfsWebhookEventDto[]; total: number }> {
  const values: unknown[] = [companyId];
  const conditions = ['e.company_id = $1'];

  if (options.provider && options.provider !== 'ALL') {
    values.push(options.provider.toUpperCase());
    conditions.push(`e.provider = $${values.length}`);
  }

  if (options.from && isValidIsoDate(options.from)) {
    values.push(options.from);
    conditions.push(`e.processed_at >= $${values.length}::date`);
  }

  if (options.to && isValidIsoDate(options.to)) {
    values.push(options.to);
    conditions.push(`e.processed_at <= ($${values.length}::date + interval '1 day')`);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const countQuery = `SELECT count(*)::text AS total FROM mfs_webhook_events e WHERE ${conditions.join(' AND ')}`;
  const countRes = await pool.query<{ total: string }>(countQuery, values);
  const total = Number(countRes.rows[0]?.total ?? 0);

  values.push(limit, offset);
  const dataQuery = `
    SELECT e.*,
           sd.document_no AS invoice_number,
           p.name_en AS customer_name
      FROM mfs_webhook_events e
      LEFT JOIN sales_documents sd ON sd.company_id = e.company_id AND sd.id = e.invoice_id
      LEFT JOIN parties p ON p.company_id = sd.company_id AND p.id = sd.party_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.processed_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  const dataRes = await pool.query<{
    id: string;
    company_id: string;
    provider: string;
    external_trx_id: string;
    invoice_id: string | null;
    invoice_number: string | null;
    customer_name: string | null;
    gross_amount_poisha: string;
    mdr_fee_bps: number;
    mdr_fee_poisha: string;
    net_settled_poisha: string;
    signature_verified: boolean;
    journal_id: string | null;
    raw_payload: string;
    processed_at: Date;
  }>(dataQuery, values);

  return {
    events: dataRes.rows.map(mapMfsWebhookEvent),
    total,
  };
}
