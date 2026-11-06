import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import {
  postSystemJournalWithinTransaction,
  reverseJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import { requireApprovedPurchaseTaxPolicy } from '../purchases/tax.ts';
import type { PurchaseAuditContext } from '../purchases/purchaseService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type TreasuryTaxType = 'VDS' | 'TDS' | 'REVERSE_CHARGE';
export type TreasuryLiabilityStatus = 'PENDING' | 'DEPOSITED' | 'REVERSED';
export type TreasuryCertificateType = 'VDS' | 'TDS';
export type TreasuryCertificateStatus = 'DRAFT' | 'CANCELLED';

export interface TreasuryLiabilityDto {
  id: string;
  taxType: TreasuryTaxType;
  sourceType: 'BILL' | 'PAYMENT';
  taxPeriod: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  billId: string | null;
  billNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  basePoisha: string;
  baseBdt: string;
  rateBps: number;
  amountPoisha: string;
  amountBdt: string;
  economicCode: string | null;
  status: TreasuryLiabilityStatus;
  challanId: string | null;
  challanNumber: string | null;
  depositedAt: string | null;
  certificateId: string | null;
  certificateNumber: string | null;
  certificateStatus: TreasuryCertificateStatus | null;
  createdAt: string;
}

export interface TreasuryChallanItemDto {
  id: string;
  liabilityId: string;
  taxType: TreasuryTaxType;
  taxPeriod: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  billId: string | null;
  billNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  amountPoisha: string;
  amountBdt: string;
  economicCode: string;
  certificateId: string | null;
  certificateNumber: string | null;
  certificateStatus: TreasuryCertificateStatus | null;
}

export interface TreasuryChallanDto {
  id: string;
  companyId: string;
  challanNumber: string;
  status: 'POSTED' | 'REVERSED';
  depositDate: string;
  bankAccountId: string;
  bankAccountName: string;
  bankKind: string;
  glAccountCode: string;
  bankBranch: string;
  depositReference: string;
  evidenceReference: string;
  totalPoisha: string;
  totalBdt: string;
  journalId: string;
  journalNumber: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  items: TreasuryChallanItemDto[];
}

export interface TreasuryCertificateDto {
  id: string;
  companyId: string;
  certificateType: TreasuryCertificateType;
  certificateNumber: string;
  direction: 'ISSUED' | 'RECEIVED';
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  originalDocumentId: string | null;
  originalDocumentNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  liabilityId: string | null;
  challanId: string | null;
  challanNumber: string | null;
  certificateDate: string;
  basePoisha: string;
  baseBdt: string;
  taxPoisha: string;
  taxBdt: string;
  status: TreasuryCertificateStatus;
  reviewStatus: 'DRAFT_STATUTORY_FORMAT_UNVERIFIED';
  evidenceReference: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  reissuedFromId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface TreasuryProofTaxDto {
  glPoisha: string;
  glBdt: string;
  pendingPoisha: string;
  pendingBdt: string;
  depositedPoisha: string;
  depositedBdt: string;
  differencePoisha: string;
  differenceBdt: string;
  agrees: boolean;
}

export interface TreasuryProofDto {
  asOf: string;
  currency: 'BDT';
  taxes: Record<TreasuryTaxType, TreasuryProofTaxDto>;
  challans: {
    postedPoisha: string;
    postedBdt: string;
    reversedPoisha: string;
    reversedBdt: string;
    depositedLiabilityPoisha: string;
    depositedLiabilityBdt: string;
    differencePoisha: string;
    differenceBdt: string;
    agrees: boolean;
  };
  certificates: {
    draftCount: number;
    draftPoisha: string;
    draftBdt: string;
    cancelledCount: number;
    cancelledPoisha: string;
    cancelledBdt: string;
    label: 'DRAFT — statutory format not verified';
  };
}

interface LiabilityRow {
  id: string;
  tax_type: TreasuryTaxType;
  source_type: 'BILL' | 'PAYMENT';
  tax_period: string;
  party_id: string;
  party_code: string;
  party_name_en: string;
  bill_id: string | null;
  bill_no: string | null;
  supplier_invoice_no: string | null;
  payment_id: string | null;
  payment_number: string | null;
  base_poisha: string;
  rate_bps: number;
  amount_poisha: string;
  economic_code: string | null;
  status: TreasuryLiabilityStatus;
  challan_id: string | null;
  deposited_at: Date | null;
  created_at: Date;
}

const PAYABLE_ACCOUNT_BY_TAX: Record<
  TreasuryTaxType,
  'vdsPayableAccountId' | 'tdsPayableAccountId' | 'reverseChargePayableAccountId'
> = {
  VDS: 'vdsPayableAccountId',
  TDS: 'tdsPayableAccountId',
  REVERSE_CHARGE: 'reverseChargePayableAccountId',
};

function optionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'TREASURY_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function requiredText(value: string, max: number, field: string): string {
  const text = value.trim();
  if (!text || text.length > max) {
    throw new AppError(400, 'TREASURY_FIELD_INVALID', `${field} must be between 1 and ${max} characters.`);
  }
  return text;
}

function auditBase(input: PurchaseAuditContext, companyId: string) {
  return {
    organisationId: input.organisationId,
    companyId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  };
}

async function loadBankAccount(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<{ id: string; name: string; kind: string; gl_account_id: string; gl_code: string }> {
  const result = await database.query<{
    id: string;
    name: string;
    kind: string;
    gl_account_id: string;
    gl_code: string;
    gl_active: boolean;
    gl_type: string;
  }>(
    `SELECT ba.id, ba.name, ba.kind, ba.gl_account_id, a.code AS gl_code,
            a.is_active AS gl_active, a.account_type AS gl_type
       FROM bank_accounts ba
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
      WHERE ba.company_id = $1 AND ba.id = $2 AND ba.status = 'ACTIVE'`,
    [companyId, bankAccountId],
  );
  const bank = result.rows[0];
  if (!bank) throw new AppError(404, 'TREASURY_BANK_ACCOUNT_NOT_FOUND', 'Active bank/cash account not found.');
  if (!bank.gl_active || bank.gl_type !== 'ASSET') {
    throw new AppError(
      409,
      'TREASURY_BANK_ACCOUNT_INVALID',
      'The bank/cash GL account must be an active asset account.',
    );
  }
  return bank;
}

async function resolvePeriod(
  database: Queryable,
  companyId: string,
  date: string,
): Promise<{ fiscal_year_id: string; fiscal_start: Date; status: string; code: string }> {
  const result = await database.query<{
    fiscal_year_id: string;
    fiscal_start: Date;
    status: string;
    code: string;
  }>(
    `SELECT p.fiscal_year_id, fy.start_date AS fiscal_start, p.status, p.code
       FROM periods p
       JOIN fiscal_years fy ON fy.company_id = p.company_id AND fy.id = p.fiscal_year_id
      WHERE p.company_id = $1 AND p.start_date <= $2::date AND p.end_date >= $2::date
      LIMIT 1`,
    [companyId, date],
  );
  const period = result.rows[0];
  if (!period) throw new AppError(400, 'PERIOD_NOT_FOUND', `No accounting period is configured for ${date}.`);
  if (period.status !== 'OPEN') {
    throw new AppError(
      409,
      'PERIOD_NOT_OPEN',
      `The period ${period.code} is ${period.status}; postings are accepted only in an OPEN period.`,
    );
  }
  return period;
}

async function allocateTreasuryNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  fiscalStart: Date,
  docType: 'TREASURY_CHALLAN' | 'TREASURY_CERTIFICATE',
): Promise<string> {
  const result = await client.query<{ id: string; prefix: string; pad: number; next_value: string }>(
    `SELECT id, prefix, pad, next_value::text AS next_value
       FROM number_sequences
      WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = $3
      FOR UPDATE`,
    [companyId, fiscalYearId, docType],
  );
  const sequence = result.rows[0];
  if (!sequence) {
    throw new AppError(
      409,
      'TREASURY_SEQUENCE_MISSING',
      `The ${docType} number sequence is not configured for this fiscal year. Repair the fiscal-year numbering setup.`,
    );
  }
  const value = BigInt(sequence.next_value);
  const year = formatDatabaseDate(fiscalStart).slice(0, 4);
  const number = `${sequence.prefix}${year}-${value.toString().padStart(sequence.pad, '0')}`;
  await client.query(
    `UPDATE number_sequences SET next_value = $3, version = version + 1 WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

export async function allocateDocumentSequenceNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  fiscalStart: Date,
  docType: string,
  prefix: string = '6.6',
  pad: number = 5,
): Promise<string> {
  await client.query(
    `INSERT INTO document_sequences (company_id, fiscal_year_id, doc_type, prefix, pad, next_value)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (company_id, fiscal_year_id, doc_type) DO NOTHING`,
    [companyId, fiscalYearId, docType, prefix, pad],
  );

  const result = await client.query<{ id: string; prefix: string; pad: number; next_value: string }>(
    `SELECT id, prefix, pad, next_value::text AS next_value
       FROM document_sequences
      WHERE company_id = $1 AND fiscal_year_id = $2 AND doc_type = $3
      FOR UPDATE`,
    [companyId, fiscalYearId, docType],
  );
  const sequence = result.rows[0];
  if (!sequence) {
    throw new AppError(500, 'SEQUENCE_ALLOCATION_FAILED', `Could not allocate sequence for ${docType}`);
  }
  const value = BigInt(sequence.next_value);
  const startYear = fiscalStart.getFullYear();
  const endYearSuffix = String((startYear + 1) % 100).padStart(2, '0');
  const fyCode = `${startYear}-${endYearSuffix}`;
  const number = `${sequence.prefix}/${fyCode}/${value.toString().padStart(sequence.pad, '0')}`;
  await client.query(
    `UPDATE document_sequences SET next_value = $3, version = version + 1, updated_at = now() WHERE company_id = $1 AND id = $2`,
    [companyId, sequence.id, (value + 1n).toString()],
  );
  return number;
}

async function lockLiabilities(
  client: PoolClient,
  companyId: string,
  liabilityIds: readonly string[],
): Promise<Map<string, LiabilityRow>> {
  const result = await client.query<LiabilityRow>(
    `SELECT l.id, l.tax_type, l.source_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.economic_code, l.status, l.challan_id, l.deposited_at, l.created_at
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
      WHERE l.company_id = $1 AND l.id = ANY($2::uuid[])
      ORDER BY l.id ASC
      FOR UPDATE OF l`,
    [companyId, [...liabilityIds].sort()],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function challanById(database: Queryable, companyId: string, challanId: string): Promise<TreasuryChallanDto> {
  const header = await database.query<{
    id: string;
    company_id: string;
    challan_number: string;
    status: string;
    deposit_date: Date;
    bank_account_id: string;
    bank_name: string;
    bank_kind: string;
    gl_code: string;
    bank_branch: string;
    deposit_reference: string;
    evidence_reference: string;
    total_poisha: string;
    journal_id: string;
    journal_number: string | null;
    reversal_journal_id: string | null;
    created_by: string;
    created_by_name: string;
    created_at: Date;
    reversed_at: Date | null;
    reversed_by_name: string | null;
  }>(
    `SELECT c.id, c.company_id, c.challan_number, c.status, c.deposit_date, c.bank_account_id,
            ba.name AS bank_name, ba.kind AS bank_kind, a.code AS gl_code,
            c.bank_branch, c.deposit_reference, c.evidence_reference,
            c.total_poisha::text AS total_poisha, c.journal_id, j.journal_number,
            c.reversal_journal_id, c.created_by, cu.name AS created_by_name, c.created_at,
            c.reversed_at, ru.name AS reversed_by_name
       FROM treasury_challans c
       JOIN bank_accounts ba ON ba.company_id = c.company_id AND ba.id = c.bank_account_id
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
       JOIN users cu ON cu.id = c.created_by
       LEFT JOIN users ru ON ru.id = c.reversed_by
       LEFT JOIN journals j ON j.company_id = c.company_id AND j.id = c.journal_id
      WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, challanId],
  );
  const row = header.rows[0];
  if (!row) throw new AppError(404, 'TREASURY_CHALLAN_NOT_FOUND', 'Treasury challan not found.');
  const items = await database.query<{
    id: string;
    liability_id: string;
    tax_type: TreasuryTaxType;
    tax_period: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bill_id: string | null;
    bill_no: string | null;
    supplier_invoice_no: string | null;
    payment_id: string | null;
    payment_number: string | null;
    amount_poisha: string;
    economic_code: string;
    certificate_id: string | null;
    certificate_number: string | null;
    certificate_status: TreasuryCertificateStatus | null;
  }>(
    `SELECT i.id, i.liability_id, i.tax_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            i.amount_poisha::text AS amount_poisha, i.economic_code,
            cert.id AS certificate_id, cert.certificate_number, cert.status AS certificate_status
       FROM treasury_challan_items i
       JOIN purchase_withholding_liabilities l ON l.company_id = i.company_id AND l.id = i.liability_id
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
       LEFT JOIN treasury_certificates cert
         ON cert.company_id = i.company_id AND cert.challan_id = i.challan_id
        AND cert.liability_id = i.liability_id AND cert.status = 'DRAFT'
      WHERE i.company_id = $1 AND i.challan_id = $2
      ORDER BY i.created_at ASC, i.id ASC`,
    [companyId, challanId],
  );
  return {
    id: row.id,
    companyId: row.company_id,
    challanNumber: row.challan_number,
    status: row.status as 'POSTED' | 'REVERSED',
    depositDate: formatDatabaseDate(row.deposit_date),
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_name,
    bankKind: row.bank_kind,
    glAccountCode: row.gl_code,
    bankBranch: row.bank_branch,
    depositReference: row.deposit_reference,
    evidenceReference: row.evidence_reference,
    totalPoisha: row.total_poisha,
    totalBdt: formatPoishaAsBdt(row.total_poisha),
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalJournalId: row.reversal_journal_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    items: items.rows.map((item) => ({
      id: item.id,
      liabilityId: item.liability_id,
      taxType: item.tax_type,
      taxPeriod: item.tax_period,
      partyId: item.party_id,
      partyCode: item.party_code,
      partyNameEn: item.party_name_en,
      billId: item.bill_id,
      billNo: item.bill_no,
      supplierInvoiceNo: item.supplier_invoice_no,
      paymentId: item.payment_id,
      paymentNumber: item.payment_number,
      amountPoisha: item.amount_poisha,
      amountBdt: formatPoishaAsBdt(item.amount_poisha),
      economicCode: item.economic_code,
      certificateId: item.certificate_id,
      certificateNumber: item.certificate_number,
      certificateStatus: item.certificate_status,
    })),
  };
}

export interface TreasuryDepositInput {
  depositDate: string;
  bankAccountId: string;
  bankBranch: string;
  depositReference: string;
  evidenceReference: string;
  items: Array<{ liabilityId: string; economicCode: string }>;
}

export async function postTreasuryChallan(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    idempotencyKey: string;
    deposit: TreasuryDepositInput;
  },
): Promise<{ challan: TreasuryChallanDto; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required for a treasury challan.',
    );
  }
  if (!isValidIsoDate(input.deposit.depositDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real deposit date in YYYY-MM-DD format.');
  }
  if (!Array.isArray(input.deposit.items) || input.deposit.items.length === 0) {
    throw new AppError(400, 'TREASURY_LIABILITIES_REQUIRED', 'Select at least one withholding liability to deposit.');
  }
  if (input.deposit.items.length > 500) {
    throw new AppError(400, 'TREASURY_LIABILITIES_INVALID', 'A treasury challan may include at most 500 liabilities.');
  }
  const liabilityIds = input.deposit.items.map((item) => item.liabilityId);
  if (new Set(liabilityIds).size !== liabilityIds.length) {
    throw new AppError(400, 'TREASURY_LIABILITY_DUPLICATE', 'Each withholding liability may appear only once.');
  }
  const bankBranch = requiredText(input.deposit.bankBranch, 200, 'Bank branch');
  const depositReference = requiredText(input.deposit.depositReference, 200, 'Deposit reference');
  const evidenceReference = requiredText(input.deposit.evidenceReference, 500, 'Evidence reference');

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `treasury-challan:${input.companyId}:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM treasury_challans WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { challan: await challanById(client, input.companyId, existing.rows[0].id), replayed: true };
    }

    const bank = await loadBankAccount(client, input.companyId, input.deposit.bankAccountId);
    const period = await resolvePeriod(client, input.companyId, input.deposit.depositDate);
    const policy = await requireApprovedPurchaseTaxPolicy(client, input.companyId, input.deposit.depositDate);
    const liabilities = await lockLiabilities(client, input.companyId, liabilityIds);
    if (liabilities.size !== liabilityIds.length) {
      throw new AppError(
        404,
        'TREASURY_LIABILITY_NOT_FOUND',
        'One or more withholding liabilities were not found in this company.',
      );
    }

    const items: Array<{ liability: LiabilityRow; economicCode: string }> = [];
    for (const requestItem of input.deposit.items) {
      const liability = liabilities.get(requestItem.liabilityId);
      if (!liability) {
        throw new AppError(404, 'TREASURY_LIABILITY_NOT_FOUND', 'Withholding liability not found.');
      }
      if (liability.status !== 'PENDING') {
        throw new AppError(
          409,
          'TREASURY_LIABILITY_NOT_PENDING',
          `Liability ${liability.id} is ${liability.status}; only a PENDING liability can be deposited.`,
          { liabilityId: liability.id, status: liability.status },
        );
      }
      if (liability.challan_id) {
        throw new AppError(
          409,
          'TREASURY_LIABILITY_ALREADY_DEPOSITED',
          'This liability is already linked to a treasury challan. Refresh the pending queue.',
        );
      }
      const economicCode = requiredText(requestItem.economicCode, 32, 'Economic code');
      items.push({ liability, economicCode });
    }

    const total = items.reduce((sum, item) => sum + BigInt(item.liability.amount_poisha), 0n);
    if (total <= 0n) {
      throw new AppError(409, 'TREASURY_TOTAL_INVALID', 'The selected liabilities carry no payable amount.');
    }

    const challanId = randomUUID();
    const challanNumber = await allocateTreasuryNumber(
      client,
      input.companyId,
      period.fiscal_year_id,
      period.fiscal_start,
      'TREASURY_CHALLAN',
    );

    const journalLines: JournalLineInput[] = items.map((item) => ({
      accountId: policy[PAYABLE_ACCOUNT_BY_TAX[item.liability.tax_type as TreasuryTaxType]],
      debit: formatPoishaAsBdt(item.liability.amount_poisha),
      credit: '0',
      partyReference: item.liability.party_code,
      partyName: item.liability.party_name_en,
      memo: `${item.liability.tax_type.replaceAll('_', ' ')} ${item.liability.tax_period} — ${
        item.liability.payment_number ?? item.liability.bill_no ?? item.liability.id
      }`,
    }));
    journalLines.push({
      accountId: bank.gl_account_id,
      debit: '0',
      credit: formatPoishaAsBdt(total),
      memo: `Treasury deposit — ${bankBranch}`,
    });

    const journal = await postSystemJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      date: input.deposit.depositDate,
      narration: `Treasury challan ${challanNumber} — ${items.length} withholding liabilities`,
      sourceModule: 'TREASURY',
      sourceDocId: challanId,
      sourceDocRef: challanNumber,
      idempotencyKey: `TREASURY-CHALLAN:${challanId}`,
      lines: journalLines,
    });

    try {
      await client.query(
        `INSERT INTO treasury_challans (
           id, company_id, challan_number, status, deposit_date, bank_account_id, bank_branch,
           deposit_reference, evidence_reference, total_poisha, journal_id, idempotency_key, created_by
         ) VALUES ($1,$2,$3,'POSTED',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          challanId,
          input.companyId,
          challanNumber,
          input.deposit.depositDate,
          bank.id,
          bankBranch,
          depositReference,
          evidenceReference,
          total.toString(),
          journal.id,
          input.idempotencyKey,
          input.actorUserId,
        ],
      );
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505' && pgError.constraint?.includes('treasury_challans_bank_reference_unique')) {
        throw new AppError(
          409,
          'TREASURY_DEPOSIT_REFERENCE_DUPLICATE',
          'A posted treasury challan already uses this bank/deposit reference. Check the deposit slip before retrying.',
        );
      }
      if (pgError.code === '23505' && pgError.constraint?.includes('idempotency')) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another challan.');
      }
      if (pgError.code === '23505' && pgError.constraint?.includes('number')) {
        throw new AppError(
          409,
          'TREASURY_CHALLAN_NUMBER_CONFLICT',
          'The treasury-challan sequence points at an existing number. Repair the sequence; numbers are never reused.',
        );
      }
      throw error;
    }

    for (const item of items) {
      await client.query(
        `INSERT INTO treasury_challan_items (
           company_id, challan_id, liability_id, tax_type, amount_poisha, economic_code
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.companyId,
          challanId,
          item.liability.id,
          item.liability.tax_type,
          item.liability.amount_poisha,
          item.economicCode,
        ],
      );
      const updated = await client.query(
        `UPDATE purchase_withholding_liabilities
            SET status = 'DEPOSITED', challan_id = $3, deposited_at = now(), economic_code = $4
          WHERE company_id = $1 AND id = $2 AND status = 'PENDING' AND challan_id IS NULL`,
        [input.companyId, item.liability.id, challanId, item.economicCode],
      );
      if (updated.rowCount !== 1) {
        throw new AppError(
          409,
          'TREASURY_LIABILITY_ALREADY_DEPOSITED',
          'Another deposit claimed this liability while the challan was being posted; nothing was committed.',
        );
      }
      if (item.liability.tax_type === 'VDS' || item.liability.tax_type === 'TDS') {
        const certificateId = randomUUID();
        const isMushak66 =
          item.liability.tax_type === 'VDS' &&
          (item.economicCode === '1/1141/0010/0311' || item.economicCode?.includes('1141'));
        const certificateNumber = isMushak66
          ? await allocateDocumentSequenceNumber(
              client,
              input.companyId,
              period.fiscal_year_id,
              period.fiscal_start,
              'MUSHAK_6_6',
              '6.6',
            )
          : await allocateTreasuryNumber(
              client,
              input.companyId,
              period.fiscal_year_id,
              period.fiscal_start,
              'TREASURY_CERTIFICATE',
            );
        await client.query(
          `INSERT INTO treasury_certificates (
             id, company_id, certificate_type, certificate_number, direction, party_id,
             original_document_id, payment_id, liability_id, challan_id, certificate_date,
             base_poisha, tax_poisha, status, evidence_reference, created_by
           ) VALUES ($1,$2,$3,$4,'ISSUED',$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',$13,$14)`,
          [
            certificateId,
            input.companyId,
            item.liability.tax_type,
            certificateNumber,
            item.liability.party_id,
            item.liability.bill_id,
            item.liability.payment_id,
            item.liability.id,
            challanId,
            input.deposit.depositDate,
            item.liability.base_poisha,
            item.liability.amount_poisha,
            evidenceReference,
            input.actorUserId,
          ],
        );
      }
    }

    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'treasury.challan_posted',
      entityType: 'treasury_challan',
      entityId: challanId,
      after: {
        challanNumber,
        depositDate: input.deposit.depositDate,
        bankAccountId: bank.id,
        depositReference,
        evidenceReference,
        totalPoisha: total.toString(),
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        liabilities: items.map((item) => ({
          liabilityId: item.liability.id,
          taxType: item.liability.tax_type,
          amountPoisha: item.liability.amount_poisha,
          economicCode: item.economicCode,
        })),
      },
      reason: 'Treasury deposit posted; liabilities marked DEPOSITED and draft certificates created.',
    });

    return { challan: await challanById(client, input.companyId, challanId), replayed: false };
  });
}

export async function listTreasuryChallans(
  database: Queryable,
  companyId: string,
  filters: {
    status?: 'POSTED' | 'REVERSED';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: TreasuryChallanDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['c.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.status) add('c.status = ?', filters.status);
  if (filters.from) add('c.deposit_date >= ?::date', filters.from);
  if (filters.to) add('c.deposit_date <= ?::date', filters.to);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM treasury_challans c WHERE ${where.join(' AND ')}`,
    params,
  );
  const ids = await database.query<{ id: string }>(
    `SELECT c.id FROM treasury_challans c
      WHERE ${where.join(' AND ')}
      ORDER BY c.deposit_date DESC, c.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const entries: TreasuryChallanDto[] = [];
  for (const row of ids.rows) {
    entries.push(await challanById(database, companyId, row.id));
  }
  return { entries, total: Number(count.rows[0]?.total ?? 0), limit, offset };
}

export async function getTreasuryChallan(
  database: Queryable,
  companyId: string,
  challanId: string,
): Promise<TreasuryChallanDto> {
  return challanById(database, companyId, challanId);
}

export async function reverseTreasuryChallan(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    challanId: string;
    date: string;
    reason: string;
  },
): Promise<TreasuryChallanDto> {
  if (!isValidIsoDate(input.date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'TREASURY_REVERSAL_REASON_REQUIRED',
      'A reversal reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; status: string; journal_id: string }>(
      `SELECT id, status, journal_id FROM treasury_challans
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.challanId],
    );
    const challan = result.rows[0];
    if (!challan) throw new AppError(404, 'TREASURY_CHALLAN_NOT_FOUND', 'Treasury challan not found.');
    if (challan.status === 'REVERSED') {
      throw new AppError(409, 'TREASURY_CHALLAN_ALREADY_REVERSED', 'This treasury challan has already been reversed.');
    }
    const reversed = await reverseJournalWithinTransaction(client, {
      ...auditBase(input, input.companyId),
      companyId: input.companyId,
      journalId: challan.journal_id,
      date: input.date,
      reason,
    });
    const updated = await client.query(
      `UPDATE treasury_challans
          SET status = 'REVERSED', reversal_journal_id = $3, reversed_at = now(), reversed_by = $4
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, input.challanId, reversed.reversal.id, input.actorUserId],
    );
    if (updated.rowCount !== 1) {
      throw new AppError(409, 'TREASURY_CHALLAN_REVERSAL_CONFLICT', 'The challan changed while it was being reversed.');
    }
    const liabilities = await client.query(
      `UPDATE purchase_withholding_liabilities
          SET status = 'PENDING', challan_id = NULL, deposited_at = NULL
        WHERE company_id = $1 AND challan_id = $2 AND status = 'DEPOSITED'`,
      [input.companyId, input.challanId],
    );
    if (liabilities.rowCount === 0) {
      throw new AppError(
        409,
        'TREASURY_CHALLAN_LIABILITY_LINK_MISSING',
        'No deposited liabilities were linked to this challan; reversal was rolled back.',
      );
    }
    await client.query(
      `UPDATE treasury_certificates
          SET status = 'CANCELLED', cancellation_reason = $3, cancelled_at = now(), cancelled_by = $4
        WHERE company_id = $1 AND challan_id = $2 AND status = 'DRAFT'`,
      [input.companyId, input.challanId, `Deposit reversed: ${reason}`, input.actorUserId],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'treasury.challan_reversed',
      entityType: 'treasury_challan',
      entityId: input.challanId,
      before: { status: 'POSTED', journalId: challan.journal_id },
      after: {
        status: 'REVERSED',
        reversalJournalId: reversed.reversal.id,
        reason,
        restoredLiabilities: liabilities.rowCount,
      },
      reason,
    });
    return challanById(client, input.companyId, input.challanId);
  });
}

export async function listTreasuryLiabilities(
  database: Queryable,
  companyId: string,
  filters: {
    status?: TreasuryLiabilityStatus;
    taxType?: TreasuryTaxType;
    partyId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: TreasuryLiabilityDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['l.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.status) add('l.status = ?', filters.status);
  if (filters.taxType) add('l.tax_type = ?', filters.taxType);
  if (filters.partyId) add('l.party_id = ?', filters.partyId);
  if (filters.from) add('l.tax_period >= ?', filters.from);
  if (filters.to) add('l.tax_period <= ?', filters.to);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM purchase_withholding_liabilities l WHERE ${where.join(' AND ')}`,
    params,
  );
  const result = await database.query<{
    id: string;
    tax_type: TreasuryTaxType;
    source_type: 'BILL' | 'PAYMENT';
    tax_period: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bill_id: string | null;
    bill_no: string | null;
    supplier_invoice_no: string | null;
    payment_id: string | null;
    payment_number: string | null;
    base_poisha: string;
    rate_bps: number;
    amount_poisha: string;
    economic_code: string | null;
    status: TreasuryLiabilityStatus;
    challan_id: string | null;
    challan_number: string | null;
    deposited_at: Date | null;
    certificate_id: string | null;
    certificate_number: string | null;
    certificate_status: TreasuryCertificateStatus | null;
    created_at: Date;
  }>(
    `SELECT l.id, l.tax_type, l.source_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.economic_code, l.status, l.challan_id, c.challan_number, l.deposited_at,
            cert.id AS certificate_id, cert.certificate_number, cert.status AS certificate_status,
            l.created_at
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
       LEFT JOIN treasury_challans c ON c.company_id = l.company_id AND c.id = l.challan_id
       LEFT JOIN treasury_certificates cert
         ON cert.company_id = l.company_id AND cert.liability_id = l.id AND cert.status = 'DRAFT'
      WHERE ${where.join(' AND ')}
      ORDER BY l.tax_period ASC, l.created_at ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return {
    entries: result.rows.map((row) => ({
      id: row.id,
      taxType: row.tax_type,
      sourceType: row.source_type,
      taxPeriod: row.tax_period,
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      billId: row.bill_id,
      billNo: row.bill_no,
      supplierInvoiceNo: row.supplier_invoice_no,
      paymentId: row.payment_id,
      paymentNumber: row.payment_number,
      basePoisha: row.base_poisha,
      baseBdt: formatPoishaAsBdt(row.base_poisha),
      rateBps: row.rate_bps,
      amountPoisha: row.amount_poisha,
      amountBdt: formatPoishaAsBdt(row.amount_poisha),
      economicCode: row.economic_code,
      status: row.status,
      challanId: row.challan_id,
      challanNumber: row.challan_number,
      depositedAt: row.deposited_at?.toISOString() ?? null,
      certificateId: row.certificate_id,
      certificateNumber: row.certificate_number,
      certificateStatus: row.certificate_status,
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(count.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function setTreasuryLiabilityEconomicCode(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    liabilityId: string;
    economicCode: string;
  },
): Promise<TreasuryLiabilityDto> {
  const economicCode = requiredText(input.economicCode, 32, 'Economic code');
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ status: string; economic_code: string | null }>(
      `SELECT status, economic_code FROM purchase_withholding_liabilities
        WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.liabilityId],
    );
    const liability = existing.rows[0];
    if (!liability) throw new AppError(404, 'TREASURY_LIABILITY_NOT_FOUND', 'Withholding liability not found.');
    if (liability.status !== 'PENDING') {
      throw new AppError(
        409,
        'TREASURY_LIABILITY_ECONOMIC_CODE_LOCKED',
        'The economic code cannot change after the liability has been deposited or reversed.',
      );
    }
    await client.query(
      `UPDATE purchase_withholding_liabilities SET economic_code = $3
        WHERE company_id = $1 AND id = $2 AND status = 'PENDING'`,
      [input.companyId, input.liabilityId, economicCode],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'treasury.liability_economic_code_set',
      entityType: 'purchase_withholding_liability',
      entityId: input.liabilityId,
      before: { economicCode: liability.economic_code },
      after: { economicCode },
      reason: 'Treasury economic code recorded before deposit.',
    });
    const refreshed = await treasuryLiabilityById(client, input.companyId, input.liabilityId);
    return refreshed;
  });
}

async function treasuryLiabilityById(
  database: Queryable,
  companyId: string,
  liabilityId: string,
): Promise<TreasuryLiabilityDto> {
  const result = await database.query<{
    id: string;
    tax_type: TreasuryTaxType;
    source_type: 'BILL' | 'PAYMENT';
    tax_period: string;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bill_id: string | null;
    bill_no: string | null;
    supplier_invoice_no: string | null;
    payment_id: string | null;
    payment_number: string | null;
    base_poisha: string;
    rate_bps: number;
    amount_poisha: string;
    economic_code: string | null;
    status: TreasuryLiabilityStatus;
    challan_id: string | null;
    challan_number: string | null;
    deposited_at: Date | null;
    certificate_id: string | null;
    certificate_number: string | null;
    certificate_status: TreasuryCertificateStatus | null;
    created_at: Date;
  }>(
    `SELECT l.id, l.tax_type, l.source_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.economic_code, l.status, l.challan_id, c.challan_number, l.deposited_at,
            cert.id AS certificate_id, cert.certificate_number, cert.status AS certificate_status,
            l.created_at
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
       LEFT JOIN treasury_challans c ON c.company_id = l.company_id AND c.id = l.challan_id
       LEFT JOIN treasury_certificates cert
         ON cert.company_id = l.company_id AND cert.liability_id = l.id AND cert.status = 'DRAFT'
      WHERE l.company_id = $1 AND l.id = $2`,
    [companyId, liabilityId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'TREASURY_LIABILITY_NOT_FOUND', 'Withholding liability not found.');
  return {
    id: row.id,
    taxType: row.tax_type,
    sourceType: row.source_type,
    taxPeriod: row.tax_period,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    billId: row.bill_id,
    billNo: row.bill_no,
    supplierInvoiceNo: row.supplier_invoice_no,
    paymentId: row.payment_id,
    paymentNumber: row.payment_number,
    basePoisha: row.base_poisha,
    baseBdt: formatPoishaAsBdt(row.base_poisha),
    rateBps: row.rate_bps,
    amountPoisha: row.amount_poisha,
    amountBdt: formatPoishaAsBdt(row.amount_poisha),
    economicCode: row.economic_code,
    status: row.status,
    challanId: row.challan_id,
    challanNumber: row.challan_number,
    depositedAt: row.deposited_at?.toISOString() ?? null,
    certificateId: row.certificate_id,
    certificateNumber: row.certificate_number,
    certificateStatus: row.certificate_status,
    createdAt: row.created_at.toISOString(),
  };
}

async function certificateById(
  database: Queryable,
  companyId: string,
  certificateId: string,
): Promise<TreasuryCertificateDto> {
  const result = await database.query<{
    id: string;
    company_id: string;
    certificate_type: TreasuryCertificateType;
    certificate_number: string;
    direction: 'ISSUED' | 'RECEIVED';
    party_id: string;
    party_code: string;
    party_name_en: string;
    original_document_id: string | null;
    original_document_no: string | null;
    supplier_invoice_no: string | null;
    payment_id: string | null;
    payment_number: string | null;
    liability_id: string;
    challan_id: string | null;
    challan_number: string | null;
    certificate_date: Date;
    base_poisha: string;
    tax_poisha: string;
    status: TreasuryCertificateStatus;
    evidence_reference: string | null;
    cancellation_reason: string | null;
    cancelled_at: Date | null;
    cancelled_by_name: string | null;
    reissued_from_id: string | null;
    created_by: string;
    created_by_name: string;
    created_at: Date;
  }>(
    `SELECT cert.id, cert.company_id, cert.certificate_type, cert.certificate_number, cert.direction,
            cert.party_id, p.code AS party_code, p.name_en AS party_name_en,
            cert.original_document_id, d.document_no AS original_document_no,
            d.supplier_invoice_no, cert.payment_id, pay.payment_number, cert.liability_id,
            cert.challan_id, c.challan_number, cert.certificate_date,
            cert.base_poisha::text AS base_poisha, cert.tax_poisha::text AS tax_poisha,
            cert.status, cert.evidence_reference, cert.cancellation_reason, cert.cancelled_at,
            cu.name AS cancelled_by_name, cert.reissued_from_id, cert.created_by,
            creator.name AS created_by_name, cert.created_at
       FROM treasury_certificates cert
       JOIN parties p ON p.company_id = cert.company_id AND p.id = cert.party_id
       LEFT JOIN purchase_documents d ON d.company_id = cert.company_id AND d.id = cert.original_document_id
       LEFT JOIN purchase_payments pay ON pay.company_id = cert.company_id AND pay.id = cert.payment_id
       LEFT JOIN treasury_challans c ON c.company_id = cert.company_id AND c.id = cert.challan_id
       JOIN users creator ON creator.id = cert.created_by
       LEFT JOIN users cu ON cu.id = cert.cancelled_by
      WHERE cert.company_id = $1 AND cert.id = $2`,
    [companyId, certificateId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'TREASURY_CERTIFICATE_NOT_FOUND', 'Withholding certificate not found.');
  return {
    id: row.id,
    companyId: row.company_id,
    certificateType: row.certificate_type,
    certificateNumber: row.certificate_number,
    direction: row.direction,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    originalDocumentId: row.original_document_id,
    originalDocumentNo: row.original_document_no,
    supplierInvoiceNo: row.supplier_invoice_no,
    paymentId: row.payment_id,
    paymentNumber: row.payment_number,
    liabilityId: row.liability_id,
    challanId: row.challan_id,
    challanNumber: row.challan_number,
    certificateDate: formatDatabaseDate(row.certificate_date),
    basePoisha: row.base_poisha,
    baseBdt: formatPoishaAsBdt(row.base_poisha),
    taxPoisha: row.tax_poisha,
    taxBdt: formatPoishaAsBdt(row.tax_poisha),
    status: row.status,
    reviewStatus: 'DRAFT_STATUTORY_FORMAT_UNVERIFIED',
    evidenceReference: row.evidence_reference,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledByName: row.cancelled_by_name,
    reissuedFromId: row.reissued_from_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listTreasuryCertificates(
  database: Queryable,
  companyId: string,
  filters: {
    type?: TreasuryCertificateType;
    status?: TreasuryCertificateStatus;
    direction?: 'ISSUED' | 'RECEIVED';
    partyId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: TreasuryCertificateDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['cert.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.type) add('cert.certificate_type = ?', filters.type);
  if (filters.status) add('cert.status = ?', filters.status);
  if (filters.direction) add('cert.direction = ?', filters.direction);
  if (filters.partyId) add('cert.party_id = ?', filters.partyId);
  if (filters.from) add('cert.certificate_date >= ?::date', filters.from);
  if (filters.to) add('cert.certificate_date <= ?::date', filters.to);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM treasury_certificates cert WHERE ${where.join(' AND ')}`,
    params,
  );
  const ids = await database.query<{ id: string }>(
    `SELECT cert.id FROM treasury_certificates cert
      WHERE ${where.join(' AND ')}
      ORDER BY cert.certificate_date DESC, cert.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const entries: TreasuryCertificateDto[] = [];
  for (const row of ids.rows) entries.push(await certificateById(database, companyId, row.id));
  return { entries, total: Number(count.rows[0]?.total ?? 0), limit, offset };
}

export async function getTreasuryCertificate(
  database: Queryable,
  companyId: string,
  certificateId: string,
): Promise<TreasuryCertificateDto> {
  return certificateById(database, companyId, certificateId);
}

async function cancelCertificateWithinTransaction(
  client: PoolClient,
  input: PurchaseAuditContext & { companyId: string; certificateId: string; reason: string },
): Promise<{ certificate: TreasuryCertificateDto; cancelled: { id: string; number: string } }> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'TREASURY_CERTIFICATE_REASON_REQUIRED',
      'A cancellation or reissue reason between 3 and 500 characters is required.',
    );
  }
  const result = await client.query<{
    id: string;
    status: string;
    challan_id: string | null;
    certificate_number: string;
  }>(
    `SELECT id, status, challan_id, certificate_number FROM treasury_certificates
      WHERE company_id = $1 AND id = $2 FOR UPDATE`,
    [input.companyId, input.certificateId],
  );
  const certificate = result.rows[0];
  if (!certificate) throw new AppError(404, 'TREASURY_CERTIFICATE_NOT_FOUND', 'Withholding certificate not found.');
  if (certificate.status === 'CANCELLED') {
    throw new AppError(409, 'TREASURY_CERTIFICATE_ALREADY_CANCELLED', 'This certificate is already cancelled.');
  }
  if (certificate.challan_id) {
    const batch = await client.query<{ status: string }>(
      `SELECT status FROM treasury_challans WHERE company_id = $1 AND id = $2`,
      [input.companyId, certificate.challan_id],
    );
    if (batch.rows[0]?.status === 'REVERSED') {
      throw new AppError(
        409,
        'TREASURY_CERTIFICATE_CHALLAN_REVERSED',
        'The linked treasury challan is reversed; the certificate is cancelled with the deposit.',
      );
    }
  }
  await client.query(
    `UPDATE treasury_certificates
        SET status = 'CANCELLED', cancellation_reason = $3, cancelled_at = now(), cancelled_by = $4
      WHERE company_id = $1 AND id = $2 AND status = 'DRAFT'`,
    [input.companyId, input.certificateId, reason, input.actorUserId],
  );
  await writeAuditEvent(client, {
    ...auditBase(input, input.companyId),
    action: 'treasury.certificate_cancelled',
    entityType: 'treasury_certificate',
    entityId: input.certificateId,
    before: { status: 'DRAFT', certificateNumber: certificate.certificate_number },
    after: { status: 'CANCELLED', reason },
    reason,
  });
  return {
    certificate: await certificateById(client, input.companyId, input.certificateId),
    cancelled: { id: certificate.id, number: certificate.certificate_number },
  };
}

export async function cancelTreasuryCertificate(
  pool: Pool,
  input: PurchaseAuditContext & { companyId: string; certificateId: string; reason: string },
): Promise<TreasuryCertificateDto> {
  return withTransaction(pool, async (client) => {
    const result = await cancelCertificateWithinTransaction(client, input);
    return result.certificate;
  });
}

export async function reissueTreasuryCertificate(
  pool: Pool,
  input: PurchaseAuditContext & {
    companyId: string;
    certificateId: string;
    reason: string;
    evidenceReference?: string | null;
  },
): Promise<TreasuryCertificateDto> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'TREASURY_CERTIFICATE_REASON_REQUIRED',
      'A reissue reason between 3 and 500 characters is required.',
    );
  }
  const evidenceReference = optionalText(input.evidenceReference, 500, 'Evidence reference');
  return withTransaction(pool, async (client) => {
    const source = await client.query<{
      id: string;
      status: TreasuryCertificateStatus;
      certificate_type: TreasuryCertificateType;
      certificate_number: string;
      direction: 'ISSUED' | 'RECEIVED';
      party_id: string;
      original_document_id: string | null;
      payment_id: string | null;
      liability_id: string;
      challan_id: string | null;
      certificate_date: Date;
      base_poisha: string;
      tax_poisha: string;
      evidence_reference: string | null;
    }>(
      `SELECT id, status, certificate_type, certificate_number, direction, party_id,
              original_document_id, payment_id, liability_id, challan_id, certificate_date,
              base_poisha::text AS base_poisha, tax_poisha::text AS tax_poisha, evidence_reference
         FROM treasury_certificates WHERE company_id = $1 AND id = $2
         FOR UPDATE`,
      [input.companyId, input.certificateId],
    );
    const certificate = source.rows[0];
    if (!certificate) throw new AppError(404, 'TREASURY_CERTIFICATE_NOT_FOUND', 'Withholding certificate not found.');
    if (certificate.challan_id) {
      const batch = await client.query<{ status: string }>(
        `SELECT status FROM treasury_challans WHERE company_id = $1 AND id = $2`,
        [input.companyId, certificate.challan_id],
      );
      if (batch.rows[0]?.status === 'REVERSED') {
        throw new AppError(
          409,
          'TREASURY_CERTIFICATE_CHALLAN_REVERSED',
          'The linked treasury challan is reversed; a replacement is created only by a new deposit.',
        );
      }
    }
    const active = await client.query<{ id: string; certificate_number: string }>(
      `SELECT id, certificate_number FROM treasury_certificates
        WHERE company_id = $1 AND liability_id = $2 AND status = 'DRAFT'`,
      [input.companyId, certificate.liability_id],
    );
    if (active.rows[0] && active.rows[0].id !== certificate.id) {
      throw new AppError(
        409,
        'TREASURY_CERTIFICATE_ALREADY_REISSUED',
        `An active draft certificate (${active.rows[0].certificate_number}) already exists for this liability.`,
      );
    }
    if (certificate.status === 'DRAFT') {
      const cancelled = await client.query(
        `UPDATE treasury_certificates
            SET status = 'CANCELLED', cancellation_reason = $3, cancelled_at = now(), cancelled_by = $4
          WHERE company_id = $1 AND id = $2 AND status = 'DRAFT'`,
        [input.companyId, certificate.id, `Reissued: ${reason}`, input.actorUserId],
      );
      if (cancelled.rowCount !== 1) {
        throw new AppError(
          409,
          'TREASURY_CERTIFICATE_REISSUE_CONFLICT',
          'The certificate changed while it was being reissued.',
        );
      }
      await writeAuditEvent(client, {
        ...auditBase(input, input.companyId),
        action: 'treasury.certificate_cancelled',
        entityType: 'treasury_certificate',
        entityId: certificate.id,
        before: { status: 'DRAFT', certificateNumber: certificate.certificate_number },
        after: { status: 'CANCELLED', reason: `Reissued: ${reason}` },
        reason: `Reissued: ${reason}`,
      });
    }
    const period = await resolvePeriod(client, input.companyId, formatDatabaseDate(certificate.certificate_date));
    const isMushak66 = certificate.certificate_number.startsWith('6.6/');
    const certificateNumber = isMushak66
      ? await allocateDocumentSequenceNumber(
          client,
          input.companyId,
          period.fiscal_year_id,
          period.fiscal_start,
          'MUSHAK_6_6',
          '6.6',
        )
      : await allocateTreasuryNumber(
          client,
          input.companyId,
          period.fiscal_year_id,
          period.fiscal_start,
          'TREASURY_CERTIFICATE',
        );
    const newId = randomUUID();
    await client.query(
      `INSERT INTO treasury_certificates (
         id, company_id, certificate_type, certificate_number, direction, party_id,
         original_document_id, payment_id, liability_id, challan_id, certificate_date,
         base_poisha, tax_poisha, status, evidence_reference, reissued_from_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16)`,
      [
        newId,
        input.companyId,
        certificate.certificate_type,
        certificateNumber,
        certificate.direction,
        certificate.party_id,
        certificate.original_document_id,
        certificate.payment_id,
        certificate.liability_id,
        certificate.challan_id,
        formatDatabaseDate(certificate.certificate_date),
        certificate.base_poisha,
        certificate.tax_poisha,
        evidenceReference ?? certificate.evidence_reference,
        input.certificateId,
        input.actorUserId,
      ],
    );
    await writeAuditEvent(client, {
      ...auditBase(input, input.companyId),
      action: 'treasury.certificate_reissued',
      entityType: 'treasury_certificate',
      entityId: newId,
      before: { certificateId: certificate.id, certificateNumber: certificate.certificate_number },
      after: { certificateId: newId, certificateNumber, reissuedFromId: input.certificateId },
      reason,
    });
    return certificateById(client, input.companyId, newId);
  });
}

export async function getTreasuryProof(
  database: Queryable,
  companyId: string,
  asOf: string,
): Promise<TreasuryProofDto> {
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real proof date in YYYY-MM-DD format.');
  const policy = await requireApprovedPurchaseTaxPolicy(database, companyId, asOf);
  const liability = await database.query<{ tax_type: TreasuryTaxType; status: string; amount: string }>(
    `SELECT l.tax_type, l.status, COALESCE(sum(l.amount_poisha), 0)::bigint::text AS amount
       FROM purchase_withholding_liabilities l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND j.posting_date <= $2::date AND j.status IN ('POSTED', 'REVERSED')
      GROUP BY l.tax_type, l.status`,
    [companyId, asOf],
  );
  const liabilityByKey = new Map(liability.rows.map((row) => [`${row.tax_type}:${row.status}`, BigInt(row.amount)]));
  const gl = await database.query<{ account_id: string; balance: string }>(
    `SELECT l.account_id, COALESCE(sum(l.credit_poisha - l.debit_poisha), 0)::bigint::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.account_id = ANY($2::uuid[])
        AND j.posting_date <= $3::date AND j.status IN ('POSTED', 'REVERSED')
      GROUP BY l.account_id`,
    [companyId, [policy.vdsPayableAccountId, policy.tdsPayableAccountId, policy.reverseChargePayableAccountId], asOf],
  );
  const glByAccount = new Map(gl.rows.map((row) => [row.account_id, BigInt(row.balance)]));
  const taxProof = (taxType: TreasuryTaxType, accountId: string): TreasuryProofTaxDto => {
    const glPoisha = glByAccount.get(accountId) ?? 0n;
    const pendingPoisha = liabilityByKey.get(`${taxType}:PENDING`) ?? 0n;
    const depositedPoisha = liabilityByKey.get(`${taxType}:DEPOSITED`) ?? 0n;
    const difference = pendingPoisha - glPoisha;
    return {
      glPoisha: glPoisha.toString(),
      glBdt: formatPoishaAsBdt(glPoisha),
      pendingPoisha: pendingPoisha.toString(),
      pendingBdt: formatPoishaAsBdt(pendingPoisha),
      depositedPoisha: depositedPoisha.toString(),
      depositedBdt: formatPoishaAsBdt(depositedPoisha),
      differencePoisha: difference.toString(),
      differenceBdt: formatPoishaAsBdt(difference),
      agrees: difference === 0n,
    };
  };
  const challan = await database.query<{ status: string; total: string }>(
    `SELECT status, COALESCE(sum(total_poisha), 0)::bigint::text AS total
       FROM treasury_challans
      WHERE company_id = $1 AND deposit_date <= $2::date
      GROUP BY status`,
    [companyId, asOf],
  );
  const challanByStatus = new Map(challan.rows.map((row) => [row.status, BigInt(row.total)]));
  const postedChallans = challanByStatus.get('POSTED') ?? 0n;
  const reversedChallans = challanByStatus.get('REVERSED') ?? 0n;
  const depositedItems = await database.query<{ total: string }>(
    `SELECT COALESCE(sum(i.amount_poisha), 0)::bigint::text AS total
       FROM treasury_challan_items i
       JOIN treasury_challans c ON c.company_id = i.company_id AND c.id = i.challan_id
      WHERE i.company_id = $1 AND c.status = 'POSTED' AND c.deposit_date <= $2::date`,
    [companyId, asOf],
  );
  const depositedLiability = BigInt(depositedItems.rows[0]?.total ?? '0');
  const challanDifference = depositedLiability - postedChallans;
  const certificates = await database.query<{ status: string; count: string; total: string }>(
    `SELECT status, count(*)::text AS count, COALESCE(sum(tax_poisha), 0)::bigint::text AS total
       FROM treasury_certificates
      WHERE company_id = $1 AND certificate_date <= $2::date
      GROUP BY status`,
    [companyId, asOf],
  );
  const certificateByStatus = new Map(
    certificates.rows.map((row) => [row.status, { count: Number(row.count), total: BigInt(row.total) }]),
  );
  const draft = certificateByStatus.get('DRAFT') ?? { count: 0, total: 0n };
  const cancelled = certificateByStatus.get('CANCELLED') ?? { count: 0, total: 0n };
  return {
    asOf,
    currency: 'BDT',
    taxes: {
      VDS: taxProof('VDS', policy.vdsPayableAccountId),
      TDS: taxProof('TDS', policy.tdsPayableAccountId),
      REVERSE_CHARGE: taxProof('REVERSE_CHARGE', policy.reverseChargePayableAccountId),
    },
    challans: {
      postedPoisha: postedChallans.toString(),
      postedBdt: formatPoishaAsBdt(postedChallans),
      reversedPoisha: reversedChallans.toString(),
      reversedBdt: formatPoishaAsBdt(reversedChallans),
      depositedLiabilityPoisha: depositedLiability.toString(),
      depositedLiabilityBdt: formatPoishaAsBdt(depositedLiability),
      differencePoisha: challanDifference.toString(),
      differenceBdt: formatPoishaAsBdt(challanDifference),
      agrees: challanDifference === 0n,
    },
    certificates: {
      draftCount: draft.count,
      draftPoisha: draft.total.toString(),
      draftBdt: formatPoishaAsBdt(draft.total),
      cancelledCount: cancelled.count,
      cancelledPoisha: cancelled.total.toString(),
      cancelledBdt: formatPoishaAsBdt(cancelled.total),
      label: 'DRAFT — statutory format not verified',
    },
  };
}

export interface RecordCustomerMushak66Input {
  companyId: string;
  actorUserId: string;
  partyId: string;
  certificateNumber: string;
  certificateDate: string;
  basePoisha: bigint;
  taxPoisha: bigint;
  evidenceReference?: string | null;
  salesReceiptId?: string | null;
  salesDocumentId?: string | null;
}

export async function recordCustomerMushak66(
  database: Queryable,
  input: RecordCustomerMushak66Input,
): Promise<TreasuryCertificateDto> {
  if (!isValidIsoDate(input.certificateDate)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real certificate date in YYYY-MM-DD format.');
  }
  const certNumber = input.certificateNumber.trim();
  if (!certNumber) {
    throw new AppError(400, 'CERTIFICATE_NUMBER_REQUIRED', 'Customer Mushak 6.6 certificate number is required.');
  }
  if (input.taxPoisha <= 0n) {
    throw new AppError(400, 'CERTIFICATE_TAX_INVALID', 'Tax amount must be greater than zero.');
  }

  const certificateId = randomUUID();
  await database.query(
    `INSERT INTO treasury_certificates (
       id, company_id, certificate_type, certificate_number, direction, party_id,
       certificate_date, base_poisha, tax_poisha, status, evidence_reference, created_by
     ) VALUES ($1, $2, 'VDS', $3, 'RECEIVED', $4, $5, $6, $7, 'DRAFT', $8, $9)`,
    [
      certificateId,
      input.companyId,
      certNumber,
      input.partyId,
      input.certificateDate,
      input.basePoisha.toString(),
      input.taxPoisha.toString(),
      input.evidenceReference ?? null,
      input.actorUserId,
    ],
  );

  return certificateById(database, input.companyId, certificateId);
}

