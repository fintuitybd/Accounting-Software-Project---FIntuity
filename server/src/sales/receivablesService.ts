import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import {
  postSystemJournalWithinTransaction,
  reverseJournalWithinTransaction,
  type JournalLineInput,
} from '../ledger/ledgerService.ts';
import {
  allocateSalesNumber,
  loadArControlAccount,
  resolvePeriodForNumbering,
  type SalesAuditContext,
} from './salesService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type ArBucket = 'CURRENT' | '1_30' | '31_60' | '61_90' | '91_180' | 'OVER_180';

export interface SalesReceiptAllocationInput {
  documentId: string;
  amount: string;
  writeOff?: string | null;
}

export interface SalesReceiptInput {
  receiptDate: string;
  partyId: string;
  branchId?: string | null;
  bankAccountId: string;
  amount: string;
  writeOffAccountId?: string | null;
  reference?: string | null;
  attachmentReference?: string | null;
  narrationEn?: string | null;
  narrationBn?: string | null;
  allocations: SalesReceiptAllocationInput[];
}

export interface SalesReceiptAllocationDto {
  id: string;
  documentId: string;
  documentNo: string;
  documentDate: string;
  dueDate: string;
  amountPoisha: string;
  amountBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
}

export interface SalesReceiptDto {
  id: string;
  companyId: string;
  branchId: string | null;
  status: 'POSTED' | 'REVERSED';
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountId: string;
  bankAccountName: string;
  bankKind: string;
  glAccountCode: string;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
  unappliedPoisha: string;
  unappliedBdt: string;
  reference: string | null;
  attachmentReference: string | null;
  narrationEn: string | null;
  narrationBn: string | null;
  journalId: string | null;
  journalNumber: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  allocations: SalesReceiptAllocationDto[];
}

export interface SalesReceiptSummaryDto {
  id: string;
  status: 'POSTED' | 'REVERSED';
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  bankAccountName: string;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  allocatedBdt: string;
  writeOffPoisha: string;
  writeOffBdt: string;
  unappliedPoisha: string;
  unappliedBdt: string;
  reference: string | null;
  createdAt: string;
}

export interface ArAgeingRowDto {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  allocatedPoisha: string;
  writeOffPoisha: string;
  creditedPoisha: string;
  outstandingPoisha: string;
  outstandingBdt: string;
  daysOverdue: number;
  bucket: ArBucket | 'CREDIT';
}

export interface ArCreditRowDto {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  unappliedPoisha: string;
  unappliedBdt: string;
}

export interface ArAgeingDto {
  asOf: string;
  currency: 'BDT';
  rows: ArAgeingRowDto[];
  credits: ArCreditRowDto[];
  totals: Record<ArBucket | 'CREDITS' | 'NET', string>;
  proof: {
    controlAccountId: string;
    controlAccountCode: string;
    controlAccountName: string;
    glBalancePoisha: string;
    glBalanceBdt: string;
    subledgerPoisha: string;
    subledgerBdt: string;
    differencePoisha: string;
    differenceBdt: string;
    agrees: boolean;
  };
}

export interface CustomerStatementLineDto {
  id: string;
  date: string;
  kind: 'SALES_INVOICE' | 'CREDIT_NOTE' | 'RECEIPT' | 'WRITE_OFF';
  reference: string;
  memo: string;
  debitPoisha: string;
  debitBdt: string;
  creditPoisha: string;
  creditBdt: string;
  balancePoisha: string;
  balanceBdt: string;
}

export interface CustomerStatementDto {
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyNameBn: string | null;
  from: string;
  to: string;
  openingPoisha: string;
  openingBdt: string;
  debitsPoisha: string;
  creditsPoisha: string;
  closingPoisha: string;
  closingBdt: string;
  lines: CustomerStatementLineDto[];
}

export interface VatRegisterRowDto {
  documentId: string;
  docType: 'SALES_INVOICE' | 'CREDIT_NOTE';
  documentNo: string;
  statutorySerial: string | null;
  docDate: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  partyBin: string | null;
  lineNo: number;
  description: string;
  taxCategory: string;
  rateBps: number;
  basePoisha: string;
  baseBdt: string;
  vatPoisha: string;
  vatBdt: string;
}

export interface VatRegisterDto {
  from: string;
  to: string;
  label: 'Internal register — draft, not filed';
  rows: VatRegisterRowDto[];
  totals: { basePoisha: string; baseBdt: string; vatPoisha: string; vatBdt: string };
}

export interface OpenInvoiceDto {
  documentId: string;
  documentNo: string | null;
  statutorySerial: string | null;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  docDate: string;
  dueDate: string;
  grossPoisha: string;
  grossBdt: string;
  outstandingPoisha: string;
  outstandingBdt: string;
}

function optionalText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'SALES_FIELD_TOO_LONG', `${field} must be at most ${max} characters.`);
  }
  return text;
}

function mapReceiptConstraintError(error: unknown): never {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505') {
    if (pgError.constraint?.includes('idempotency')) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for another receipt.');
    }
    if (pgError.constraint?.includes('number')) {
      throw new AppError(
        409,
        'SALES_RECEIPT_NUMBER_CONFLICT',
        'The receipt-number sequence points at an existing number. Repair the sequence; numbers are never reused.',
      );
    }
  }
  throw error;
}

function parsePositiveMoney(value: string, field: string): bigint {
  const poisha = parseBdtToPoisha(value);
  if (poisha === null || poisha <= 0n) {
    throw new AppError(400, 'SALES_AMOUNT_INVALID', `${field} must be a positive BDT amount with up to 2 decimals.`);
  }
  return poisha;
}

function parseNonNegativeMoney(value: string | null | undefined, field: string): bigint {
  const poisha = parseBdtToPoisha(value ?? '0');
  if (poisha === null || poisha < 0n) {
    throw new AppError(
      400,
      'SALES_AMOUNT_INVALID',
      `${field} must be a non-negative BDT amount with up to 2 decimals.`,
    );
  }
  return poisha;
}

function bucketFor(daysOverdue: number): ArBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  if (daysOverdue <= 90) return '61_90';
  if (daysOverdue <= 180) return '91_180';
  return 'OVER_180';
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function loadParty(
  database: Queryable,
  companyId: string,
  partyId: string,
): Promise<{ id: string; code: string; name_en: string; name_bn: string | null; status: string; type: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    status: string;
    type: string;
  }>(`SELECT id, code, name_en, name_bn, status, type FROM parties WHERE company_id = $1 AND id = $2`, [
    companyId,
    partyId,
  ]);
  const party = result.rows[0];
  if (!party) throw new AppError(404, 'SALES_PARTY_NOT_FOUND', 'Customer not found.');
  if (party.status !== 'ACTIVE') throw new AppError(409, 'SALES_PARTY_INACTIVE', 'The customer is inactive.');
  if (party.type !== 'CUSTOMER' && party.type !== 'BOTH') {
    throw new AppError(400, 'SALES_PARTY_INVALID', 'The selected party is not a customer.');
  }
  return party;
}

async function loadBankAccount(
  database: Queryable,
  companyId: string,
  bankAccountId: string,
): Promise<{
  id: string;
  name: string;
  kind: string;
  gl_account_id: string;
  gl_code: string;
  gl_name: string;
  gl_active: boolean;
  gl_type: string;
}> {
  const result = await database.query<{
    id: string;
    name: string;
    kind: string;
    gl_account_id: string;
    gl_code: string;
    gl_name: string;
    gl_active: boolean;
    gl_type: string;
  }>(
    `SELECT ba.id, ba.name, ba.kind, ba.gl_account_id, a.code AS gl_code, a.name_en AS gl_name,
            a.is_active AS gl_active, a.account_type AS gl_type
       FROM bank_accounts ba
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
      WHERE ba.company_id = $1 AND ba.id = $2 AND ba.status = 'ACTIVE'`,
    [companyId, bankAccountId],
  );
  const bank = result.rows[0];
  if (!bank) throw new AppError(404, 'SALES_BANK_ACCOUNT_NOT_FOUND', 'Active bank/cash account not found.');
  if (!bank.gl_active || bank.gl_type !== 'ASSET') {
    throw new AppError(409, 'SALES_BANK_ACCOUNT_INVALID', 'The bank/cash GL account must be an active asset account.');
  }
  return bank;
}

async function loadWriteOffAccount(
  database: Queryable,
  companyId: string,
  accountId: string,
): Promise<{ id: string; code: string; name_en: string }> {
  const result = await database.query<{
    id: string;
    code: string;
    name_en: string;
    is_active: boolean;
    account_type: string;
  }>(`SELECT id, code, name_en, is_active, account_type FROM accounts WHERE company_id = $1 AND id = $2`, [
    companyId,
    accountId,
  ]);
  const account = result.rows[0];
  if (!account)
    throw new AppError(400, 'SALES_WRITEOFF_ACCOUNT_INVALID', 'Choose a write-off expense account from this company.');
  if (!account.is_active || account.account_type !== 'EXPENSE') {
    throw new AppError(
      400,
      'SALES_WRITEOFF_ACCOUNT_INVALID',
      'The write-off account must be an active EXPENSE account.',
    );
  }
  return { id: account.id, code: account.code, name_en: account.name_en };
}

async function assertActiveBranch(
  database: Queryable,
  companyId: string,
  branchId: string | null | undefined,
): Promise<void> {
  if (!branchId) return;
  const result = await database.query<{ id: string; status: string }>(
    `SELECT id, status FROM branches WHERE company_id = $1 AND id = $2`,
    [companyId, branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new AppError(404, 'SALES_BRANCH_NOT_FOUND', 'Branch not found.');
  if (branch.status !== 'ACTIVE') throw new AppError(409, 'SALES_BRANCH_INACTIVE', 'The branch is inactive.');
}

async function lockInvoices(
  client: PoolClient,
  companyId: string,
  partyId: string,
  documentIds: readonly string[],
): Promise<Map<string, { id: string; document_no: string | null; gross_poisha: string; due_date: Date }>> {
  if (documentIds.length === 0) return new Map();
  const result = await client.query<{
    id: string;
    document_no: string | null;
    gross_poisha: string;
    due_date: Date;
    party_id: string;
    status: string;
    doc_type: string;
  }>(
    `SELECT id, document_no, gross_poisha::text AS gross_poisha, due_date, party_id, status, doc_type
       FROM sales_documents
      WHERE company_id = $1 AND id = ANY($2::uuid[])
      ORDER BY id ASC
      FOR UPDATE`,
    [companyId, [...documentIds].sort()],
  );
  const found = new Map(result.rows.map((row) => [row.id, row]));
  for (const id of documentIds) {
    const row = found.get(id);
    if (!row) throw new AppError(404, 'SALES_DOCUMENT_NOT_FOUND', 'Invoice not found.');
    if (row.doc_type !== 'SALES_INVOICE' || row.status !== 'POSTED') {
      throw new AppError(
        409,
        'SALES_RECEIPT_INVOICE_INVALID',
        'Receipts can only be allocated to a posted sales invoice.',
      );
    }
    if (row.party_id !== partyId) {
      throw new AppError(
        400,
        'SALES_RECEIPT_PARTY_MISMATCH',
        'Every allocated invoice must belong to the selected customer.',
      );
    }
  }
  return found;
}

async function loadOpenAmounts(
  database: Queryable,
  companyId: string,
  documentIds: readonly string[],
): Promise<Map<string, bigint>> {
  if (documentIds.length === 0) return new Map();
  const result = await database.query<{ document_id: string; outstanding_poisha: string }>(
    `SELECT document_id, outstanding_poisha::text AS outstanding_poisha
       FROM sales_ar_open_items
      WHERE company_id = $1 AND document_id = ANY($2::uuid[])`,
    [companyId, [...documentIds]],
  );
  return new Map(result.rows.map((row) => [row.document_id, BigInt(row.outstanding_poisha)]));
}

async function receiptById(database: Queryable, companyId: string, receiptId: string): Promise<SalesReceiptDto> {
  const result = await database.query<{
    id: string;
    company_id: string;
    branch_id: string | null;
    status: string;
    receipt_number: string;
    receipt_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bank_account_id: string;
    bank_name: string;
    bank_kind: string;
    gl_code: string;
    amount_poisha: string;
    write_off_poisha: string;
    reference: string | null;
    attachment_reference: string | null;
    narration_en: string | null;
    narration_bn: string | null;
    journal_id: string | null;
    journal_number: string | null;
    reversal_journal_id: string | null;
    created_by: string;
    created_by_name: string;
    created_at: Date;
    reversed_at: Date | null;
    reversed_by_name: string | null;
  }>(
    `SELECT r.id, r.company_id, r.branch_id, r.status, r.receipt_number, r.receipt_date,
            r.party_id, p.code AS party_code, p.name_en AS party_name_en,
            r.bank_account_id, ba.name AS bank_name, ba.kind AS bank_kind, a.code AS gl_code,
            r.amount_poisha::text AS amount_poisha, r.write_off_poisha::text AS write_off_poisha,
            r.reference, r.attachment_reference, r.narration_en, r.narration_bn,
            r.journal_id, j.journal_number,
            r.reversal_journal_id, r.created_by, cu.name AS created_by_name, r.created_at,
            r.reversed_at, ru.name AS reversed_by_name
       FROM sales_receipts r
       JOIN parties p ON p.company_id = r.company_id AND p.id = r.party_id
       JOIN bank_accounts ba ON ba.company_id = r.company_id AND ba.id = r.bank_account_id
       JOIN accounts a ON a.company_id = ba.company_id AND a.id = ba.gl_account_id
       JOIN users cu ON cu.id = r.created_by
       LEFT JOIN users ru ON ru.id = r.reversed_by
       LEFT JOIN journals j ON j.company_id = r.company_id AND j.id = r.journal_id
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, receiptId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'SALES_RECEIPT_NOT_FOUND', 'Customer receipt not found.');
  const allocations = await database.query<{
    id: string;
    document_id: string;
    document_no: string;
    doc_date: Date;
    due_date: Date;
    amount_poisha: string;
    write_off_poisha: string;
  }>(
    `SELECT al.id, al.document_id, d.document_no, d.doc_date, d.due_date,
            al.amount_poisha::text AS amount_poisha, al.write_off_poisha::text AS write_off_poisha
       FROM sales_receipt_allocations al
       JOIN sales_documents d ON d.company_id = al.company_id AND d.id = al.document_id
      WHERE al.company_id = $1 AND al.receipt_id = $2
      ORDER BY al.created_at ASC, al.id ASC`,
    [companyId, receiptId],
  );
  const allocated = allocations.rows.reduce((sum, entry) => sum + BigInt(entry.amount_poisha), 0n);
  const writeOff = allocations.rows.reduce((sum, entry) => sum + BigInt(entry.write_off_poisha), 0n);
  const amount = BigInt(row.amount_poisha);
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    status: row.status as 'POSTED' | 'REVERSED',
    receiptNumber: row.receipt_number,
    receiptDate: formatDatabaseDate(row.receipt_date),
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_name,
    bankKind: row.bank_kind,
    glAccountCode: row.gl_code,
    amountPoisha: amount.toString(),
    amountBdt: formatPoishaAsBdt(amount),
    allocatedPoisha: allocated.toString(),
    allocatedBdt: formatPoishaAsBdt(allocated),
    writeOffPoisha: writeOff.toString(),
    writeOffBdt: formatPoishaAsBdt(writeOff),
    unappliedPoisha: (amount - allocated).toString(),
    unappliedBdt: formatPoishaAsBdt(amount - allocated),
    reference: row.reference,
    attachmentReference: row.attachment_reference,
    narrationEn: row.narration_en,
    narrationBn: row.narration_bn,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    reversalJournalId: row.reversal_journal_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    reversedAt: row.reversed_at?.toISOString() ?? null,
    reversedByName: row.reversed_by_name,
    allocations: allocations.rows.map((entry) => ({
      id: entry.id,
      documentId: entry.document_id,
      documentNo: entry.document_no,
      documentDate: formatDatabaseDate(entry.doc_date),
      dueDate: formatDatabaseDate(entry.due_date),
      amountPoisha: entry.amount_poisha,
      amountBdt: formatPoishaAsBdt(entry.amount_poisha),
      writeOffPoisha: entry.write_off_poisha,
      writeOffBdt: formatPoishaAsBdt(entry.write_off_poisha),
    })),
  };
}

export async function postSalesReceipt(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    idempotencyKey: string;
    canWriteOff: boolean;
    receipt: SalesReceiptInput;
  },
): Promise<{ receipt: SalesReceiptDto; replayed: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'A valid Idempotency-Key header is required for a customer receipt.',
    );
  }
  const receiptDate = input.receipt.receiptDate;
  if (!isValidIsoDate(receiptDate))
    throw new AppError(400, 'INVALID_DATE', 'Use a real receipt date in YYYY-MM-DD format.');
  const amount = parsePositiveMoney(input.receipt.amount, 'Receipt amount');
  if (!Array.isArray(input.receipt.allocations) || input.receipt.allocations.length > 500) {
    throw new AppError(400, 'SALES_RECEIPT_ALLOCATIONS_INVALID', 'A receipt may allocate to at most 500 invoices.');
  }

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `sales-receipt:${input.companyId}:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM sales_receipts WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.companyId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { receipt: await receiptById(client, input.companyId, existing.rows[0].id), replayed: true };
    }

    const party = await loadParty(client, input.companyId, input.receipt.partyId);
    await assertActiveBranch(client, input.companyId, input.receipt.branchId);
    const bank = await loadBankAccount(client, input.companyId, input.receipt.bankAccountId);
    const arAccount = await loadArControlAccount(client, input.companyId);
    const allocationInputs = input.receipt.allocations.map((allocation) => ({
      documentId: allocation.documentId,
      amount: parseNonNegativeMoney(allocation.amount, 'Allocation amount'),
      writeOff: parseNonNegativeMoney(allocation.writeOff, 'Allocation write-off'),
    }));
    if (allocationInputs.some((entry) => entry.amount + entry.writeOff <= 0n)) {
      throw new AppError(400, 'SALES_RECEIPT_ALLOCATION_INVALID', 'Every allocation must clear a positive amount.');
    }
    const documentIds = [...new Set(allocationInputs.map((entry) => entry.documentId))];
    await lockInvoices(client, input.companyId, party.id, documentIds);
    const openAmounts = await loadOpenAmounts(client, input.companyId, documentIds);
    const cashAllocated = allocationInputs.reduce((sum, entry) => sum + entry.amount, 0n);
    const writeOff = allocationInputs.reduce((sum, entry) => sum + entry.writeOff, 0n);
    if (cashAllocated > amount) {
      throw new AppError(409, 'SALES_RECEIPT_OVER_ALLOCATED', 'Cash allocations cannot exceed the receipt amount.');
    }
    if (writeOff > 0n && !input.canWriteOff) {
      throw new AppError(
        403,
        'SALES_RECEIPT_WRITEOFF_FORBIDDEN',
        'A receivable write-off requires the APPROVE_HIGH_VALUE permission. Record the cash receipt without the write-off or ask a controller.',
      );
    }
    if (writeOff > 0n && !input.receipt.writeOffAccountId) {
      throw new AppError(400, 'SALES_WRITEOFF_ACCOUNT_REQUIRED', 'Choose the expense account for the write-off.');
    }
    const writeOffAccount =
      writeOff > 0n ? await loadWriteOffAccount(client, input.companyId, input.receipt.writeOffAccountId!) : null;
    for (const allocation of allocationInputs) {
      const open = openAmounts.get(allocation.documentId) ?? 0n;
      if (allocation.amount + allocation.writeOff > open) {
        throw new AppError(
          409,
          'SALES_RECEIPT_ALLOCATION_EXCEEDS_OPEN',
          `Allocation to invoice ${allocation.documentId} exceeds its open amount.`,
          {
            documentId: allocation.documentId,
            openPoisha: open.toString(),
            requestedPoisha: (allocation.amount + allocation.writeOff).toString(),
          },
        );
      }
    }

    const period = await resolvePeriodForNumbering(client, input.companyId, receiptDate);
    const receiptNumber = await allocateSalesNumber(
      client,
      input.companyId,
      period.fiscal_year_id,
      period.fiscal_start,
      'RECEIPT',
    );
    const receiptId = randomUUID();
    const journalLines: JournalLineInput[] = [
      {
        accountId: bank.gl_account_id,
        debit: formatPoishaAsBdt(amount),
        credit: '0',
        partyReference: party.code,
        partyName: party.name_en,
        memo: 'Customer receipt deposited',
      },
    ];
    if (writeOff > 0n && writeOffAccount) {
      journalLines.push({
        accountId: writeOffAccount.id,
        debit: formatPoishaAsBdt(writeOff),
        credit: '0',
        partyReference: party.code,
        partyName: party.name_en,
        memo: 'Receivable write-off',
      });
    }
    journalLines.push({
      accountId: arAccount.id,
      debit: '0',
      credit: formatPoishaAsBdt(amount + writeOff),
      partyReference: party.code,
      partyName: party.name_en,
      memo: 'Trade receivable cleared',
    });

    const journal = await postSystemJournalWithinTransaction(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      companyId: input.companyId,
      branchId: input.receipt.branchId ?? null,
      date: receiptDate,
      narration: `Customer receipt ${receiptNumber} — ${party.name_en}`,
      sourceModule: 'SALES',
      sourceDocId: receiptId,
      sourceDocRef: receiptNumber,
      idempotencyKey: `SALES-RECEIPT:${receiptId}`,
      lines: journalLines,
    });

    try {
      await client.query(
        `INSERT INTO sales_receipts (
           id, company_id, branch_id, status, receipt_number, receipt_date, party_id,
           bank_account_id, amount_poisha, write_off_poisha, reference, attachment_reference,
           narration_en, narration_bn, journal_id, idempotency_key, created_by
         ) VALUES ($1,$2,$3,'POSTED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          receiptId,
          input.companyId,
          input.receipt.branchId ?? null,
          receiptNumber,
          receiptDate,
          party.id,
          bank.id,
          amount.toString(),
          writeOff.toString(),
          optionalText(input.receipt.reference, 200, 'Receipt reference'),
          optionalText(input.receipt.attachmentReference, 500, 'Receipt attachment reference'),
          optionalText(input.receipt.narrationEn, 500, 'Receipt narration'),
          optionalText(input.receipt.narrationBn, 500, 'Bangla receipt narration'),
          journal.id,
          input.idempotencyKey,
          input.actorUserId,
        ],
      );
    } catch (error) {
      mapReceiptConstraintError(error);
    }
    for (const allocation of allocationInputs) {
      await client.query(
        `INSERT INTO sales_receipt_allocations (
           company_id, receipt_id, document_id, amount_poisha, write_off_poisha, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.companyId,
          receiptId,
          allocation.documentId,
          allocation.amount.toString(),
          allocation.writeOff.toString(),
          input.actorUserId,
        ],
      );
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'sales.receipt_posted',
      entityType: 'sales_receipt',
      entityId: receiptId,
      after: {
        receiptNumber,
        partyId: party.id,
        amountPoisha: amount.toString(),
        writeOffPoisha: writeOff.toString(),
        cashAllocatedPoisha: cashAllocated.toString(),
        unappliedPoisha: (amount - cashAllocated).toString(),
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        allocations: allocationInputs.map((entry) => ({
          documentId: entry.documentId,
          amountPoisha: entry.amount.toString(),
          writeOffPoisha: entry.writeOff.toString(),
        })),
      },
      reason: 'Customer receipt posted with AR allocations in one transaction.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return { receipt: await receiptById(client, input.companyId, receiptId), replayed: false };
  });
}

export async function allocateSalesReceipt(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    receiptId: string;
    allocations: SalesReceiptAllocationInput[];
  },
): Promise<SalesReceiptDto> {
  return withTransaction(pool, async (client) => {
    const receiptResult = await client.query<{
      id: string;
      status: string;
      party_id: string;
      amount_poisha: string;
    }>(
      `SELECT id, status, party_id, amount_poisha::text AS amount_poisha
         FROM sales_receipts WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.receiptId],
    );
    const receipt = receiptResult.rows[0];
    if (!receipt) throw new AppError(404, 'SALES_RECEIPT_NOT_FOUND', 'Customer receipt not found.');
    if (receipt.status !== 'POSTED')
      throw new AppError(409, 'SALES_RECEIPT_REVERSED', 'A reversed receipt cannot be allocated.');
    const existing = await client.query<{ amount_poisha: string }>(
      `SELECT COALESCE(sum(amount_poisha), 0)::text AS amount_poisha
         FROM sales_receipt_allocations WHERE company_id = $1 AND receipt_id = $2`,
      [input.companyId, input.receiptId],
    );
    const alreadyAllocated = BigInt(existing.rows[0]?.amount_poisha ?? '0');
    const unapplied = BigInt(receipt.amount_poisha) - alreadyAllocated;
    const allocationInputs = input.allocations.map((allocation) => ({
      documentId: allocation.documentId,
      amount: parsePositiveMoney(allocation.amount, 'Allocation amount'),
      writeOff: parseNonNegativeMoney(allocation.writeOff, 'Allocation write-off'),
    }));
    if (allocationInputs.some((entry) => entry.writeOff > 0n)) {
      throw new AppError(
        400,
        'SALES_RECEIPT_WRITEOFF_ON_ALLOCATION',
        'A later allocation cannot create a write-off. Record a new permissioned receipt for a write-off.',
      );
    }
    const cash = allocationInputs.reduce((sum, entry) => sum + entry.amount, 0n);
    if (cash <= 0n || cash > unapplied) {
      throw new AppError(
        409,
        'SALES_RECEIPT_UNAPPLIED_EXCEEDED',
        `The new allocation must be positive and cannot exceed the unapplied cash of ${formatPoishaAsBdt(unapplied)} BDT.`,
        { unappliedPoisha: unapplied.toString() },
      );
    }
    const documentIds = [...new Set(allocationInputs.map((entry) => entry.documentId))];
    await lockInvoices(client, input.companyId, receipt.party_id, documentIds);
    const openAmounts = await loadOpenAmounts(client, input.companyId, documentIds);
    for (const allocation of allocationInputs) {
      const open = openAmounts.get(allocation.documentId) ?? 0n;
      if (allocation.amount > open) {
        throw new AppError(
          409,
          'SALES_RECEIPT_ALLOCATION_EXCEEDS_OPEN',
          'Allocation exceeds the invoice open amount.',
          {
            documentId: allocation.documentId,
            openPoisha: open.toString(),
            requestedPoisha: allocation.amount.toString(),
          },
        );
      }
    }
    for (const allocation of allocationInputs) {
      await client.query(
        `INSERT INTO sales_receipt_allocations (
           company_id, receipt_id, document_id, amount_poisha, write_off_poisha, created_by
         ) VALUES ($1,$2,$3,$4,0,$5)`,
        [input.companyId, input.receiptId, allocation.documentId, allocation.amount.toString(), input.actorUserId],
      );
    }
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'sales.receipt_allocated',
      entityType: 'sales_receipt',
      entityId: input.receiptId,
      after: {
        allocations: allocationInputs.map((entry) => ({
          documentId: entry.documentId,
          amountPoisha: entry.amount.toString(),
        })),
        remainingUnappliedPoisha: (unapplied - cash).toString(),
      },
      reason: 'Unapplied customer cash allocated to posted invoices; no new GL entry is required.',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return receiptById(client, input.companyId, input.receiptId);
  });
}

export async function reverseSalesReceipt(
  pool: Pool,
  input: SalesAuditContext & {
    companyId: string;
    receiptId: string;
    date: string;
    reason: string;
    canReverse: boolean;
  },
): Promise<SalesReceiptDto> {
  if (!input.canReverse) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to reverse a posted receipt.');
  }
  if (!isValidIsoDate(input.date))
    throw new AppError(400, 'INVALID_DATE', 'Use a real reversal date in YYYY-MM-DD format.');
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'SALES_REVERSAL_REASON_REQUIRED',
      'A reversal reason between 3 and 500 characters is required.',
    );
  }
  return withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; status: string; journal_id: string | null }>(
      `SELECT id, status, journal_id FROM sales_receipts WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.receiptId],
    );
    const receipt = result.rows[0];
    if (!receipt) throw new AppError(404, 'SALES_RECEIPT_NOT_FOUND', 'Customer receipt not found.');
    if (receipt.status === 'REVERSED') {
      throw new AppError(409, 'SALES_RECEIPT_ALREADY_REVERSED', 'This receipt has already been reversed.');
    }
    if (!receipt.journal_id) {
      throw new AppError(
        409,
        'SALES_RECEIPT_JOURNAL_MISSING',
        'The receipt journal could not be found; reversal was rolled back.',
      );
    }
    const reversed = await reverseJournalWithinTransaction(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      companyId: input.companyId,
      journalId: receipt.journal_id,
      date: input.date,
      reason,
    });
    await client.query(
      `UPDATE sales_receipts
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3,
              reversal_journal_id = $4, updated_at = now()
        WHERE company_id = $1 AND id = $2 AND status = 'POSTED'`,
      [input.companyId, input.receiptId, input.actorUserId, reversed.reversal.id],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'sales.receipt_reversed',
      entityType: 'sales_receipt',
      entityId: input.receiptId,
      before: { status: 'POSTED', journalId: receipt.journal_id },
      after: { status: 'REVERSED', reversalJournalId: reversed.reversal.id, reason },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return receiptById(client, input.companyId, input.receiptId);
  });
}

export async function listSalesReceipts(
  database: Queryable,
  companyId: string,
  filters: {
    partyId?: string;
    from?: string;
    to?: string;
    status?: 'POSTED' | 'REVERSED';
    limit?: number;
    offset?: number;
  },
): Promise<{ entries: SalesReceiptSummaryDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const params: unknown[] = [companyId];
  const where = ['r.company_id = $1'];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.partyId) add('r.party_id = ?', filters.partyId);
  if (filters.from) add('r.receipt_date >= ?::date', filters.from);
  if (filters.to) add('r.receipt_date <= ?::date', filters.to);
  if (filters.status) add('r.status = ?', filters.status);
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM sales_receipts r WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, offset);
  const result = await database.query<{
    id: string;
    status: string;
    receipt_number: string;
    receipt_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    bank_name: string;
    amount_poisha: string;
    reference: string | null;
    created_at: Date;
    allocated_poisha: string;
    write_off_poisha: string;
  }>(
    `SELECT r.id, r.status, r.receipt_number, r.receipt_date, r.party_id,
            p.code AS party_code, p.name_en AS party_name_en, ba.name AS bank_name,
            r.amount_poisha::text AS amount_poisha, r.reference, r.created_at,
            COALESCE(sum(al.amount_poisha), 0)::text AS allocated_poisha,
            COALESCE(sum(al.write_off_poisha), 0)::text AS write_off_poisha
       FROM sales_receipts r
       JOIN parties p ON p.company_id = r.company_id AND p.id = r.party_id
       JOIN bank_accounts ba ON ba.company_id = r.company_id AND ba.id = r.bank_account_id
       LEFT JOIN sales_receipt_allocations al ON al.company_id = r.company_id AND al.receipt_id = r.id
      WHERE ${where.join(' AND ')}
      GROUP BY r.id, p.code, p.name_en, ba.name
      ORDER BY r.receipt_date DESC, r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    entries: result.rows.map((row) => {
      const amount = BigInt(row.amount_poisha);
      const allocated = BigInt(row.allocated_poisha);
      return {
        id: row.id,
        status: row.status as 'POSTED' | 'REVERSED',
        receiptNumber: row.receipt_number,
        receiptDate: formatDatabaseDate(row.receipt_date),
        partyId: row.party_id,
        partyCode: row.party_code,
        partyNameEn: row.party_name_en,
        bankAccountName: row.bank_name,
        amountPoisha: amount.toString(),
        amountBdt: formatPoishaAsBdt(amount),
        allocatedPoisha: allocated.toString(),
        allocatedBdt: formatPoishaAsBdt(allocated),
        writeOffPoisha: row.write_off_poisha,
        writeOffBdt: formatPoishaAsBdt(row.write_off_poisha),
        unappliedPoisha: (amount - allocated).toString(),
        unappliedBdt: formatPoishaAsBdt(amount - allocated),
        reference: row.reference,
        createdAt: row.created_at.toISOString(),
      };
    }),
    total: Number(count.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getSalesReceipt(
  database: Queryable,
  companyId: string,
  receiptId: string,
): Promise<SalesReceiptDto> {
  return receiptById(database, companyId, receiptId);
}

export async function getArAgeing(
  database: Queryable,
  companyId: string,
  asOf: string,
  partyId?: string,
  branchId?: string | null,
): Promise<ArAgeingDto> {
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real ageing date in YYYY-MM-DD format.');
  const params: unknown[] = [companyId, asOf];
  let partyFilter = '';
  if (partyId) {
    params.push(partyId);
    partyFilter = ` AND d.party_id = $${params.length}`;
  }
  let branchFilter = '';
  if (branchId === 'UNASSIGNED') {
    branchFilter = ' AND d.branch_id IS NULL';
  } else if (branchId) {
    params.push(branchId);
    branchFilter = ` AND d.branch_id = $${params.length}`;
  }
  const open = await database.query<{
    document_id: string;
    document_no: string | null;
    statutory_serial: string | null;
    party_id: string;
    party_code: string;
    party_name_en: string;
    doc_date: Date;
    due_date: Date;
    gross_poisha: string;
    allocated_poisha: string;
    write_off_poisha: string;
    credited_poisha: string;
    outstanding_poisha: string;
  }>(
    `SELECT d.id AS document_id, d.document_no, d.statutory_serial, d.party_id,
            p.code AS party_code, p.name_en AS party_name_en, d.doc_date, d.due_date,
            d.gross_poisha::text AS gross_poisha,
            COALESCE(a.allocated_poisha, 0)::text AS allocated_poisha,
            COALESCE(a.write_off_poisha, 0)::text AS write_off_poisha,
            COALESCE(c.credited_poisha, 0)::text AS credited_poisha,
            (d.gross_poisha - COALESCE(a.allocated_poisha, 0) - COALESCE(a.write_off_poisha, 0)
              - COALESCE(c.credited_poisha, 0))::text AS outstanding_poisha
       FROM sales_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       LEFT JOIN (
         SELECT al.company_id, al.document_id,
                sum(al.amount_poisha) AS allocated_poisha,
                sum(al.write_off_poisha) AS write_off_poisha
           FROM sales_receipt_allocations al
           JOIN sales_receipts r ON r.company_id = al.company_id AND r.id = al.receipt_id
          WHERE r.status = 'POSTED' AND r.receipt_date <= $2::date
            AND al.created_at < ($2::date + interval '1 day')
          GROUP BY al.company_id, al.document_id
       ) a ON a.company_id = d.company_id AND a.document_id = d.id
       LEFT JOIN (
         SELECT company_id, original_document_id, sum(gross_poisha) AS credited_poisha
           FROM sales_documents
          WHERE doc_type = 'CREDIT_NOTE' AND status = 'POSTED' AND doc_date <= $2::date
          GROUP BY company_id, original_document_id
       ) c ON c.company_id = d.company_id AND c.original_document_id = d.id
      WHERE d.company_id = $1 AND d.doc_type = 'SALES_INVOICE'
        AND d.status = 'POSTED' AND d.doc_date <= $2::date
        AND (d.gross_poisha - COALESCE(a.allocated_poisha, 0) - COALESCE(a.write_off_poisha, 0)
             - COALESCE(c.credited_poisha, 0)) <> 0${partyFilter}${branchFilter}
      ORDER BY p.name_en ASC, d.due_date ASC, d.document_no ASC`,
    params,
  );
  const creditsParams: unknown[] = [companyId, asOf];
  let creditPartyFilter = '';
  if (partyId) {
    creditsParams.push(partyId);
    creditPartyFilter = ` AND r.party_id = $${creditsParams.length}`;
  }
  if (branchId === 'UNASSIGNED') {
    creditPartyFilter += ' AND r.branch_id IS NULL';
  } else if (branchId) {
    creditsParams.push(branchId);
    creditPartyFilter += ` AND r.branch_id = $${creditsParams.length}`;
  }
  const credits = await database.query<{
    receipt_id: string;
    receipt_number: string;
    receipt_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    unapplied_poisha: string;
  }>(
    `SELECT r.id AS receipt_id, r.receipt_number, r.receipt_date, r.party_id,
            p.code AS party_code, p.name_en AS party_name_en,
            (r.amount_poisha - COALESCE(sum(al.amount_poisha), 0))::text AS unapplied_poisha
       FROM sales_receipts r
       JOIN parties p ON p.company_id = r.company_id AND p.id = r.party_id
       LEFT JOIN sales_receipt_allocations al
         ON al.company_id = r.company_id AND al.receipt_id = r.id
        AND al.created_at < ($2::date + interval '1 day')
      WHERE r.company_id = $1 AND r.status = 'POSTED' AND r.receipt_date <= $2::date${creditPartyFilter}
      GROUP BY r.id, p.code, p.name_en
     HAVING (r.amount_poisha - COALESCE(sum(al.amount_poisha), 0)) > 0
      ORDER BY r.receipt_date ASC`,
    creditsParams,
  );
  const rows: ArAgeingRowDto[] = open.rows.map((row) => {
    const outstanding = BigInt(row.outstanding_poisha);
    const daysOverdue = daysBetween(formatDatabaseDate(row.due_date), asOf);
    return {
      documentId: row.document_id,
      documentNo: row.document_no,
      statutorySerial: row.statutory_serial,
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      docDate: formatDatabaseDate(row.doc_date),
      dueDate: formatDatabaseDate(row.due_date),
      grossPoisha: row.gross_poisha,
      grossBdt: formatPoishaAsBdt(row.gross_poisha),
      allocatedPoisha: row.allocated_poisha,
      writeOffPoisha: row.write_off_poisha,
      creditedPoisha: row.credited_poisha,
      outstandingPoisha: row.outstanding_poisha,
      outstandingBdt: formatPoishaAsBdt(row.outstanding_poisha),
      daysOverdue,
      bucket: outstanding < 0n ? 'CREDIT' : bucketFor(daysOverdue),
    };
  });
  const totals: Record<ArBucket | 'CREDITS' | 'NET', string> = {
    CURRENT: '0',
    '1_30': '0',
    '31_60': '0',
    '61_90': '0',
    '91_180': '0',
    OVER_180: '0',
    CREDITS: '0',
    NET: '0',
  };
  let net = 0n;
  for (const row of rows) {
    const amount = BigInt(row.outstandingPoisha);
    net += amount;
    if (amount < 0n) {
      totals.CREDITS = (BigInt(totals.CREDITS) - amount).toString();
    } else if (row.bucket !== 'CREDIT') {
      totals[row.bucket] = (BigInt(totals[row.bucket]) + amount).toString();
    }
  }
  for (const credit of credits.rows) {
    const amount = BigInt(credit.unapplied_poisha);
    net -= amount;
    totals.CREDITS = (BigInt(totals.CREDITS) + amount).toString();
  }
  totals.NET = net.toString();
  if (partyId) {
    // A customer-filtered ageing view still has to prove the same scoped control account. Compute
    // the proof from the unfiltered schedule rather than comparing a filtered subledger to total GL.
    const global = await getArAgeing(database, companyId, asOf, undefined, branchId);
    return {
      asOf,
      currency: 'BDT',
      rows,
      credits: credits.rows.map((row) => ({
        receiptId: row.receipt_id,
        receiptNumber: row.receipt_number,
        receiptDate: formatDatabaseDate(row.receipt_date),
        partyId: row.party_id,
        partyCode: row.party_code,
        partyNameEn: row.party_name_en,
        unappliedPoisha: row.unapplied_poisha,
        unappliedBdt: formatPoishaAsBdt(row.unapplied_poisha),
      })),
      totals,
      proof: global.proof,
    };
  }
  const arAccount = await loadArControlAccount(database, companyId);
  const glValues: unknown[] = [companyId, arAccount.id, asOf];
  let glBranchFilter = '';
  if (branchId === 'UNASSIGNED') {
    glBranchFilter = 'AND j.branch_id IS NULL';
  } else if (branchId) {
    glValues.push(branchId);
    glBranchFilter = `AND j.branch_id = $${glValues.length}`;
  }
  const gl = await database.query<{ balance: string }>(
    `SELECT COALESCE(sum(l.debit_poisha - l.credit_poisha), 0)::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND j.posting_date <= $3::date
        AND j.status IN ('POSTED', 'REVERSED') ${glBranchFilter}`,
    glValues,
  );
  const glBalance = BigInt(gl.rows[0]?.balance ?? '0');
  const difference = net - glBalance;
  return {
    asOf,
    currency: 'BDT',
    rows,
    credits: credits.rows.map((row) => ({
      receiptId: row.receipt_id,
      receiptNumber: row.receipt_number,
      receiptDate: formatDatabaseDate(row.receipt_date),
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      unappliedPoisha: row.unapplied_poisha,
      unappliedBdt: formatPoishaAsBdt(row.unapplied_poisha),
    })),
    totals,
    proof: {
      controlAccountId: arAccount.id,
      controlAccountCode: arAccount.code,
      controlAccountName: arAccount.nameEn,
      glBalancePoisha: glBalance.toString(),
      glBalanceBdt: formatPoishaAsBdt(glBalance),
      subledgerPoisha: net.toString(),
      subledgerBdt: formatPoishaAsBdt(net),
      differencePoisha: difference.toString(),
      differenceBdt: formatPoishaAsBdt(difference),
      agrees: difference === 0n,
    },
  };
}

export async function getCustomerStatement(
  database: Queryable,
  companyId: string,
  partyId: string,
  from: string,
  to: string,
): Promise<CustomerStatementDto> {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    throw new AppError(400, 'INVALID_DATE', 'Choose a valid statement date range.');
  }
  const party = await database.query<{ id: string; code: string; name_en: string; name_bn: string | null }>(
    `SELECT id, code, name_en, name_bn FROM parties WHERE company_id = $1 AND id = $2`,
    [companyId, partyId],
  );
  const row = party.rows[0];
  if (!row) throw new AppError(404, 'SALES_PARTY_NOT_FOUND', 'Customer not found.');

  const before = await database.query<{
    invoices: string;
    credits: string;
    receipts: string;
    write_offs: string;
  }>(
    `SELECT
       COALESCE((SELECT sum(gross_poisha) FROM sales_documents
                  WHERE company_id = $1 AND party_id = $2 AND doc_type = 'SALES_INVOICE'
                    AND status = 'POSTED' AND doc_date < $3::date), 0)::text AS invoices,
       COALESCE((SELECT sum(gross_poisha) FROM sales_documents
                  WHERE company_id = $1 AND party_id = $2 AND doc_type = 'CREDIT_NOTE'
                    AND status = 'POSTED' AND doc_date < $3::date), 0)::text AS credits,
       COALESCE((SELECT sum(amount_poisha) FROM sales_receipts
                  WHERE company_id = $1 AND party_id = $2 AND status = 'POSTED'
                    AND receipt_date < $3::date), 0)::text AS receipts,
       COALESCE((SELECT sum(al.write_off_poisha) FROM sales_receipt_allocations al
                  JOIN sales_receipts r ON r.company_id = al.company_id AND r.id = al.receipt_id
                 WHERE al.company_id = $1 AND r.party_id = $2 AND r.status = 'POSTED'
                   AND r.receipt_date < $3::date), 0)::text AS write_offs`,
    [companyId, partyId, from],
  );
  const opening =
    BigInt(before.rows[0]?.invoices ?? '0') -
    BigInt(before.rows[0]?.credits ?? '0') -
    BigInt(before.rows[0]?.receipts ?? '0') -
    BigInt(before.rows[0]?.write_offs ?? '0');

  const entries = await database.query<{
    id: string;
    entry_date: Date;
    kind: 'SALES_INVOICE' | 'CREDIT_NOTE' | 'RECEIPT' | 'WRITE_OFF';
    reference: string;
    memo: string;
    debit_poisha: string;
    credit_poisha: string;
    sort_order: number;
  }>(
    `SELECT d.id, d.doc_date AS entry_date, d.doc_type AS kind,
            COALESCE(d.document_no, 'Draft') AS reference,
            CONCAT('Invoice for ', d.document_no) AS memo,
            d.gross_poisha::text AS debit_poisha, '0' AS credit_poisha, 1 AS sort_order
       FROM sales_documents d
      WHERE d.company_id = $1 AND d.party_id = $2 AND d.doc_type = 'SALES_INVOICE'
        AND d.status = 'POSTED' AND d.doc_date BETWEEN $3::date AND $4::date
     UNION ALL
     SELECT d.id, d.doc_date, d.doc_type,
            COALESCE(d.document_no, 'Draft'),
            CONCAT('Credit note for ', COALESCE(d.original_document_no, '')),
            '0', d.gross_poisha::text, 2
       FROM sales_documents d
      WHERE d.company_id = $1 AND d.party_id = $2 AND d.doc_type = 'CREDIT_NOTE'
        AND d.status = 'POSTED' AND d.doc_date BETWEEN $3::date AND $4::date
     UNION ALL
     SELECT r.id, r.receipt_date, 'RECEIPT', r.receipt_number,
            CONCAT('Customer receipt', CASE WHEN r.reference IS NULL THEN '' ELSE CONCAT(' · ', r.reference) END),
            '0', r.amount_poisha::text, 3
       FROM sales_receipts r
      WHERE r.company_id = $1 AND r.party_id = $2 AND r.status = 'POSTED'
        AND r.receipt_date BETWEEN $3::date AND $4::date
     UNION ALL
     SELECT r.id, r.receipt_date, 'WRITE_OFF', r.receipt_number,
            CONCAT('Receivable write-off on ', r.receipt_number),
            '0', sum(al.write_off_poisha)::text, 4
       FROM sales_receipts r
       JOIN sales_receipt_allocations al ON al.company_id = r.company_id AND al.receipt_id = r.id
      WHERE r.company_id = $1 AND r.party_id = $2 AND r.status = 'POSTED'
        AND r.receipt_date BETWEEN $3::date AND $4::date
      GROUP BY r.id
     HAVING sum(al.write_off_poisha) > 0
      ORDER BY entry_date ASC, sort_order ASC, reference ASC`,
    [companyId, partyId, from, to],
  );
  let balance = opening;
  let debits = 0n;
  let credits = 0n;
  const lines: CustomerStatementLineDto[] = entries.rows.map((entry) => {
    const debit = BigInt(entry.debit_poisha);
    const credit = BigInt(entry.credit_poisha);
    debits += debit;
    credits += credit;
    balance += debit - credit;
    return {
      id: entry.id,
      date: formatDatabaseDate(entry.entry_date),
      kind: entry.kind,
      reference: entry.reference,
      memo: entry.memo,
      debitPoisha: debit.toString(),
      debitBdt: formatPoishaAsBdt(debit),
      creditPoisha: credit.toString(),
      creditBdt: formatPoishaAsBdt(credit),
      balancePoisha: balance.toString(),
      balanceBdt: formatPoishaAsBdt(balance),
    };
  });
  return {
    partyId: row.id,
    partyCode: row.code,
    partyNameEn: row.name_en,
    partyNameBn: row.name_bn,
    from,
    to,
    openingPoisha: opening.toString(),
    openingBdt: formatPoishaAsBdt(opening),
    debitsPoisha: debits.toString(),
    creditsPoisha: credits.toString(),
    closingPoisha: balance.toString(),
    closingBdt: formatPoishaAsBdt(balance),
    lines,
  };
}

export async function getVatRegister(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
  branchId?: string | null,
): Promise<VatRegisterDto> {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    throw new AppError(400, 'INVALID_DATE', 'Choose a valid VAT register date range.');
  }
  const values: unknown[] = [companyId, from, to];
  let branchFilter = '';
  if (branchId === 'UNASSIGNED') {
    branchFilter = 'AND d.branch_id IS NULL';
  } else if (branchId) {
    values.push(branchId);
    branchFilter = `AND d.branch_id = $${values.length}`;
  }
  const result = await database.query<{
    document_id: string;
    doc_type: 'SALES_INVOICE' | 'CREDIT_NOTE';
    document_no: string;
    statutory_serial: string | null;
    doc_date: Date;
    party_id: string;
    party_code: string;
    party_name_en: string;
    party_bin: string | null;
    line_no: number;
    description_en: string;
    tax_category: string;
    rate_bps: number;
    base_poisha: string;
    amount_poisha: string;
  }>(
    `SELECT d.id AS document_id, d.doc_type, d.document_no, d.statutory_serial, d.doc_date,
            d.party_id, p.code AS party_code, p.name_en AS party_name_en, p.bin AS party_bin,
            l.line_no, l.description_en, t.tax_category, t.rate_bps,
            t.base_poisha::text AS base_poisha, t.amount_poisha::text AS amount_poisha
       FROM sales_documents d
       JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
       JOIN sales_document_taxes t ON t.company_id = d.company_id AND t.document_id = d.id
       JOIN sales_document_lines l ON l.company_id = t.company_id AND l.id = t.line_id
      WHERE d.company_id = $1 AND d.status = 'POSTED'
        AND d.doc_date BETWEEN $2::date AND $3::date ${branchFilter}
      ORDER BY d.doc_date ASC, d.doc_type ASC, d.document_no ASC, l.line_no ASC`,
    values,
  );
  let base = 0n;
  let vat = 0n;
  const rows: VatRegisterRowDto[] = result.rows.map((row) => {
    const sign = row.doc_type === 'CREDIT_NOTE' ? -1n : 1n;
    const rowBase = BigInt(row.base_poisha) * sign;
    const rowVat = BigInt(row.amount_poisha) * sign;
    base += rowBase;
    vat += rowVat;
    return {
      documentId: row.document_id,
      docType: row.doc_type,
      documentNo: row.document_no,
      statutorySerial: row.statutory_serial,
      docDate: formatDatabaseDate(row.doc_date),
      partyId: row.party_id,
      partyCode: row.party_code,
      partyNameEn: row.party_name_en,
      partyBin: row.party_bin,
      lineNo: row.line_no,
      description: row.description_en,
      taxCategory: row.tax_category,
      rateBps: row.rate_bps,
      basePoisha: rowBase.toString(),
      baseBdt: formatPoishaAsBdt(rowBase),
      vatPoisha: rowVat.toString(),
      vatBdt: formatPoishaAsBdt(rowVat),
    };
  });
  return {
    from,
    to,
    label: 'Internal register — draft, not filed',
    rows,
    totals: {
      basePoisha: base.toString(),
      baseBdt: formatPoishaAsBdt(base),
      vatPoisha: vat.toString(),
      vatBdt: formatPoishaAsBdt(vat),
    },
  };
}

export async function listOpenInvoices(
  database: Queryable,
  companyId: string,
  filters: { partyId?: string; asOf?: string } = {},
): Promise<OpenInvoiceDto[]> {
  const asOf = filters.asOf ?? new Date().toISOString().slice(0, 10);
  if (!isValidIsoDate(asOf)) throw new AppError(400, 'INVALID_DATE', 'Use a real open-item date.');
  const params: unknown[] = [companyId, asOf];
  let partyFilter = '';
  if (filters.partyId) {
    params.push(filters.partyId);
    partyFilter = ` AND o.party_id = $${params.length}`;
  }
  const result = await database.query<{
    document_id: string;
    document_no: string | null;
    statutory_serial: string | null;
    party_id: string;
    party_code: string;
    party_name_en: string;
    doc_date: Date;
    due_date: Date;
    gross_poisha: string;
    outstanding_poisha: string;
  }>(
    `SELECT o.document_id, o.document_no, o.statutory_serial, o.party_id,
            p.code AS party_code, p.name_en AS party_name_en, o.doc_date, o.due_date,
            o.gross_poisha::text AS gross_poisha, o.outstanding_poisha::text AS outstanding_poisha
       FROM sales_ar_open_items o
       JOIN parties p ON p.company_id = o.company_id AND p.id = o.party_id
      WHERE o.company_id = $1 AND o.doc_date <= $2::date AND o.outstanding_poisha > 0${partyFilter}
      ORDER BY o.due_date ASC, o.document_no ASC`,
    params,
  );
  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentNo: row.document_no,
    statutorySerial: row.statutory_serial,
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    docDate: formatDatabaseDate(row.doc_date),
    dueDate: formatDatabaseDate(row.due_date),
    grossPoisha: row.gross_poisha,
    grossBdt: formatPoishaAsBdt(row.gross_poisha),
    outstandingPoisha: row.outstanding_poisha,
    outstandingBdt: formatPoishaAsBdt(row.outstanding_poisha),
  }));
}
