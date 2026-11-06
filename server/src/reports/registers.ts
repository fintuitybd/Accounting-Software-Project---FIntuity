import type { Pool, PoolClient } from 'pg';
import { formatDatabaseDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { getApAgeing } from '../purchases/payablesService.ts';
import { getPurchaseTaxPolicy } from '../purchases/tax.ts';
import { getArAgeing } from '../sales/receivablesService.ts';
import { getSalesTaxPolicy } from '../sales/tax.ts';
import { formatQuantity, impliedUnitCostPoisha, parseStoredQuantity } from '../inventory/quantity.ts';
import { checkDto, reportGeneratedAt, resolveAsOfScope, resolveRangeScope, type ReportScopeInput } from './common.ts';
import { REPORT_TEMPLATES } from './templates.ts';
import type {
  AgeingReportDto,
  ReportCheckDto,
  ReportExceptionDto,
  StockValuationDto,
  StockValuationRowDto,
  VatCategorySummaryDto,
  VatRegisterLineDto,
  VatRegisterReportDto,
  VatReturnDraftDto,
  VatReturnPartDto,
  VatReturnPartRowDto,
  WithholdingRegisterDto,
  WithholdingRegisterRowDto,
} from './types.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

function canExportFrom(checks: ReportCheckDto[]): boolean {
  return checks.every((check) => !check.blocksExport || check.passed);
}

function addBranchFilter(values: unknown[], branchId: string | null, alias: string, column = 'branch_id'): string {
  if (branchId === 'UNASSIGNED') return `AND ${alias}.${column} IS NULL`;
  if (!branchId) return '';
  values.push(branchId);
  return `AND ${alias}.${column} = $${values.length}`;
}

function taxPeriodBounds(from: string, to: string): { from: string; to: string } {
  return { from: from.slice(0, 7), to: to.slice(0, 7) };
}

interface RegisterPageInput extends ReportScopeInput {
  page?: number;
  pageSize?: number;
}

interface SalesRegisterSql {
  base: string;
  values: unknown[];
}

function salesRegisterSql(companyId: string, from: string, to: string, branchId: string | null): SalesRegisterSql {
  const values: unknown[] = [companyId, from, to];
  const branchFilter = addBranchFilter(values, branchId, 'd');
  return {
    values,
    base: `
      SELECT d.id AS document_id, d.doc_type, d.document_no, d.statutory_serial,
             d.status AS document_status, d.doc_date, d.party_id, p.code AS party_code,
             p.name_en AS party_name_en, p.bin AS party_bin, l.line_no, l.description_en,
             t.tax_category, t.rate_bps,
             t.base_poisha, t.amount_poisha, 0::bigint AS claimable_poisha,
             0::bigint AS disallowed_poisha,
             (CASE WHEN d.doc_type = 'CREDIT_NOTE' THEN -1 ELSE 1 END)::bigint AS sign
        FROM sales_documents d
        JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
        JOIN sales_document_taxes t ON t.company_id = d.company_id AND t.document_id = d.id
        JOIN sales_document_lines l ON l.company_id = t.company_id AND l.id = t.line_id
       WHERE d.company_id = $1 AND d.status = 'POSTED'
         AND d.doc_date BETWEEN $2::date AND $3::date ${branchFilter}
    `,
  };
}

function purchaseRegisterSql(companyId: string, from: string, to: string, branchId: string | null): SalesRegisterSql {
  const values: unknown[] = [companyId, from, to];
  const branchFilter = addBranchFilter(values, branchId, 'd');
  return {
    values,
    base: `
      SELECT d.id AS document_id, d.doc_type, d.document_no,
             d.supplier_mushak63_serial AS statutory_serial, d.status AS document_status,
             d.doc_date, d.party_id, p.code AS party_code, p.name_en AS party_name_en,
             p.bin AS party_bin, COALESCE(l.line_no, 1) AS line_no,
             COALESCE(l.description_en, d.narration_en) AS description_en,
             t.tax_category, t.rate_bps, t.base_poisha, t.amount_poisha,
             t.claimable_poisha, t.disallowed_poisha, 1::bigint AS sign
        FROM purchase_documents d
        JOIN parties p ON p.company_id = d.company_id AND p.id = d.party_id
        JOIN purchase_document_taxes t ON t.company_id = d.company_id AND t.document_id = d.id
        LEFT JOIN purchase_document_lines l
          ON l.company_id = t.company_id AND l.id = t.line_id
       WHERE d.company_id = $1 AND d.status = 'POSTED'
         AND t.tax_type IN ('VAT', 'REVERSE_CHARGE')
         AND d.doc_date BETWEEN $2::date AND $3::date ${branchFilter}
    `,
  };
}

interface RegisterAggregateRow {
  base_poisha: string;
  vat_poisha: string;
  claimable_poisha: string;
  disallowed_poisha: string;
  credit_base_poisha: string;
  credit_vat_poisha: string;
  line_count: number;
}

interface RegisterLineRow {
  document_id: string;
  doc_type: string;
  document_no: string | null;
  statutory_serial: string | null;
  document_status: string;
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
  vat_poisha: string;
  claimable_poisha: string;
  disallowed_poisha: string;
}

interface RegisterSummaryRow {
  tax_category: string;
  rate_bps: number;
  line_count: number;
  base_poisha: string;
  vat_poisha: string;
  claimable_poisha: string;
  disallowed_poisha: string;
}

async function reversedDocumentCount(
  database: Queryable,
  table: 'sales_documents' | 'purchase_documents',
  companyId: string,
  from: string,
  to: string,
  branchId: string | null,
): Promise<number> {
  const values: unknown[] = [companyId, from, to];
  const branchFilter = addBranchFilter(values, branchId, 'd');
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} d
      WHERE d.company_id = $1 AND d.status = 'REVERSED'
        AND d.doc_date BETWEEN $2::date AND $3::date ${branchFilter}`,
    values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function getRegisterReport(
  database: Queryable,
  companyId: string,
  direction: 'SALES' | 'PURCHASES',
  input: RegisterPageInput,
): Promise<VatRegisterReportDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const sql =
    direction === 'SALES'
      ? salesRegisterSql(companyId, from, to, resolved.scope.branchId)
      : purchaseRegisterSql(companyId, from, to, resolved.scope.branchId);
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 500);
  const offset = (page - 1) * pageSize;

  const aggregate = await database.query<RegisterAggregateRow>(
    `SELECT
       COALESCE(SUM(r.sign * r.base_poisha), 0)::text AS base_poisha,
       COALESCE(SUM(r.sign * r.amount_poisha), 0)::text AS vat_poisha,
       COALESCE(SUM(r.claimable_poisha), 0)::text AS claimable_poisha,
       COALESCE(SUM(r.disallowed_poisha), 0)::text AS disallowed_poisha,
       COALESCE(SUM(CASE WHEN r.doc_type = 'CREDIT_NOTE' THEN r.base_poisha ELSE 0 END), 0)::text AS credit_base_poisha,
       COALESCE(SUM(CASE WHEN r.doc_type = 'CREDIT_NOTE' THEN r.amount_poisha ELSE 0 END), 0)::text AS credit_vat_poisha,
       COUNT(*)::int AS line_count
     FROM (${sql.base}) r`,
    sql.values,
  );
  const summary = await database.query<RegisterSummaryRow>(
    `SELECT r.tax_category, r.rate_bps, COUNT(*)::int AS line_count,
            COALESCE(SUM(r.sign * r.base_poisha), 0)::text AS base_poisha,
            COALESCE(SUM(r.sign * r.amount_poisha), 0)::text AS vat_poisha,
            COALESCE(SUM(r.claimable_poisha), 0)::text AS claimable_poisha,
            COALESCE(SUM(r.disallowed_poisha), 0)::text AS disallowed_poisha
       FROM (${sql.base}) r
      GROUP BY r.tax_category, r.rate_bps
      ORDER BY r.tax_category, r.rate_bps`,
    sql.values,
  );
  const pageValues = [...sql.values, pageSize, offset];
  const rows = await database.query<RegisterLineRow>(
    `SELECT r.document_id, r.doc_type, r.document_no, r.statutory_serial, r.document_status,
            r.doc_date, r.party_id, r.party_code, r.party_name_en, r.party_bin, r.line_no, r.description_en,
            r.tax_category, r.rate_bps,
            (r.sign * r.base_poisha)::text AS base_poisha,
            (r.sign * r.amount_poisha)::text AS vat_poisha,
            r.claimable_poisha::text AS claimable_poisha,
            r.disallowed_poisha::text AS disallowed_poisha
       FROM (${sql.base}) r
      ORDER BY r.doc_date ASC, r.document_no ASC, r.line_no ASC
      LIMIT $${sql.values.length + 1} OFFSET $${sql.values.length + 2}`,
    pageValues,
  );

  const reversedCount = await reversedDocumentCount(
    database,
    direction === 'SALES' ? 'sales_documents' : 'purchase_documents',
    companyId,
    from,
    to,
    resolved.scope.branchId,
  );

  const mappedRows: VatRegisterLineDto[] = rows.rows.map((row) => ({
    documentId: row.document_id,
    documentNo: row.document_no,
    statutorySerial: row.statutory_serial,
    documentType: row.doc_type as VatRegisterLineDto['documentType'],
    documentStatus: 'POSTED',
    documentDate: formatDatabaseDate(row.doc_date),
    partyId: row.party_id,
    partyCode: row.party_code,
    partyNameEn: row.party_name_en,
    partyBin: row.party_bin,
    description: row.description_en,
    lineNo: row.line_no,
    taxCategory: row.tax_category,
    rateBps: row.rate_bps,
    basePoisha: row.base_poisha,
    vatPoisha: row.vat_poisha,
    claimablePoisha: row.claimable_poisha,
    disallowedPoisha: row.disallowed_poisha,
  }));

  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'REVERSED_DOCUMENTS_EXCLUDED',
      labelEn: 'Reversed documents are excluded from the active register',
      labelBn: 'বাতিল ডকুমেন্ট সক্রিয় রেজিস্টার থেকে বাদ',
      passed: true,
      detailEn: `${reversedCount} reversed document${reversedCount === 1 ? '' : 's'} in the period ${reversedCount === 1 ? 'was' : 'were'} excluded. Linked reversal journals remain in the general ledger.`,
      detailBn: `সময়কালে ${reversedCount}টি বাতিল ডকুমেন্ট বাদ দেওয়া হয়েছে। লিংকড রিভার্সাল জার্নাল সাধারণ খাতায় রয়েছে।`,
      blocksExport: false,
    }),
    checkDto({
      key: 'POSTED_DOCUMENTS_ONLY',
      labelEn: 'Only posted documents are included',
      labelBn: 'শুধুমাত্র পোস্টকৃত ডকুমেন্ট অন্তর্ভুক্ত',
      passed: true,
      detailEn: 'Draft, approved-but-unposted and reversed documents cannot enter the register.',
      detailBn: 'খসড়া, অনুমোদিত-কিন্তু-অপোস্ট এবং বাতিল ডকুমেন্ট রেজিস্টারে প্রবেশ করতে পারে না।',
      blocksExport: false,
    }),
  ];

  return {
    reportKey: direction === 'SALES' ? 'VAT_SALES_REGISTER' : 'VAT_PURCHASE_REGISTER',
    titleEn:
      direction === 'SALES' ? 'Sales VAT register (internal 6.2-style)' : 'Purchase VAT register (internal 6.1-style)',
    titleBn:
      direction === 'SALES'
        ? 'বিক্রয় ভ্যাট রেজিস্টার (অভ্যন্তরীণ ৬.২-ধাঁচ)'
        : 'ক্রয় ভ্যাট রেজিস্টার (অভ্যন্তরীণ ৬.১-ধাঁচ)',
    scope: resolved.scope,
    basis: 'POSTED_DOCUMENTS_AND_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.vatRegisters.reviewStatus,
    template: REPORT_TEMPLATES.vatRegisters,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    direction,
    rows: mappedRows,
    lineCount: aggregate.rows[0]?.line_count ?? 0,
    totals: {
      basePoisha: aggregate.rows[0]?.base_poisha ?? '0',
      vatPoisha: aggregate.rows[0]?.vat_poisha ?? '0',
      claimablePoisha: aggregate.rows[0]?.claimable_poisha ?? '0',
      disallowedPoisha: aggregate.rows[0]?.disallowed_poisha ?? '0',
      creditNoteBasePoisha: aggregate.rows[0]?.credit_base_poisha ?? '0',
      creditNoteVatPoisha: aggregate.rows[0]?.credit_vat_poisha ?? '0',
      reversedDocumentCount: reversedCount,
    },
    summaryByCategory: summary.rows.map((row) => ({
      taxCategory: row.tax_category,
      rateBps: row.rate_bps,
      lineCount: row.line_count,
      basePoisha: row.base_poisha,
      vatPoisha: row.vat_poisha,
      claimablePoisha: row.claimable_poisha,
      disallowedPoisha: row.disallowed_poisha,
    })),
    page,
    pageSize,
  };
}

export function getSalesVatRegisterReport(
  database: Queryable,
  companyId: string,
  input: RegisterPageInput,
): Promise<VatRegisterReportDto> {
  return getRegisterReport(database, companyId, 'SALES', input);
}

export function getPurchaseVatRegisterReport(
  database: Queryable,
  companyId: string,
  input: RegisterPageInput,
): Promise<VatRegisterReportDto> {
  return getRegisterReport(database, companyId, 'PURCHASES', input);
}

interface GlAccountRow {
  id: string;
  code: string;
  name_en: string;
  account_type: string;
}

async function findFallbackVatAccount(
  database: Queryable,
  companyId: string,
  side: 'OUTPUT' | 'INPUT',
): Promise<GlAccountRow | null> {
  const codes = side === 'OUTPUT' ? ['2120'] : ['1140'];
  const result = await database.query<GlAccountRow>(
    `SELECT id, code, name_en, account_type FROM accounts
      WHERE company_id = $1 AND is_active = true AND code = ANY($2::text[])
      ORDER BY array_position($2::text[], code) LIMIT 1`,
    [companyId, codes],
  );
  if (result.rows[0]) return result.rows[0];
  const control = await database.query<GlAccountRow>(
    `SELECT id, code, name_en, account_type FROM accounts
      WHERE company_id = $1 AND is_active = true AND control_subledger = 'VAT_CURRENT_ACCOUNT'
        AND account_type = $2
      ORDER BY code LIMIT 1`,
    [companyId, side === 'OUTPUT' ? 'LIABILITY' : 'ASSET'],
  );
  return control.rows[0] ?? null;
}

async function accountPeriodBalance(
  database: Queryable,
  companyId: string,
  accountId: string,
  from: string,
  to: string,
  side: 'CREDIT' | 'DEBIT',
  branchId: string | null,
): Promise<bigint> {
  const values: unknown[] = [companyId, accountId, from, to];
  const branchFilter = addBranchFilter(values, branchId, 'j');
  const expression = side === 'CREDIT' ? 'l.credit_poisha - l.debit_poisha' : 'l.debit_poisha - l.credit_poisha';
  const result = await database.query<{ balance: string }>(
    `SELECT COALESCE(SUM(${expression}), 0)::text AS balance
       FROM journal_lines l
       JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = $1 AND l.account_id = $2
        AND j.posting_date BETWEEN $3::date AND $4::date
        AND j.status IN ('POSTED', 'REVERSED') ${branchFilter}`,
    values,
  );
  return BigInt(result.rows[0]?.balance ?? '0');
}

async function withholdingTotals(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
): Promise<{ vds: bigint; tds: bigint; reverseCharge: bigint }> {
  const bounds = taxPeriodBounds(from, to);
  const result = await database.query<{ tax_type: string; amount: string }>(
    `SELECT tax_type, COALESCE(SUM(amount_poisha), 0)::text AS amount
       FROM purchase_withholding_liabilities
      WHERE company_id = $1 AND tax_period BETWEEN $2 AND $3
        AND status <> 'REVERSED' AND reversed_at IS NULL
      GROUP BY tax_type`,
    [companyId, bounds.from, bounds.to],
  );
  const map = new Map(result.rows.map((row) => [row.tax_type, BigInt(row.amount)]));
  return {
    vds: map.get('VDS') ?? 0n,
    tds: map.get('TDS') ?? 0n,
    reverseCharge: map.get('REVERSE_CHARGE') ?? 0n,
  };
}

async function challanDeposits(
  database: Queryable,
  companyId: string,
  from: string,
  to: string,
): Promise<
  Array<{ challanId: string; challanNumber: string; depositDate: string; status: string; totalPoisha: string }>
> {
  const result = await database.query<{
    id: string;
    challan_number: string;
    deposit_date: Date;
    status: string;
    total_poisha: string;
  }>(
    `SELECT c.id, c.challan_number, c.deposit_date, c.status, c.total_poisha::text AS total_poisha
       FROM treasury_challans c
      WHERE c.company_id = $1 AND c.deposit_date BETWEEN $2::date AND $3::date
      ORDER BY c.deposit_date ASC, c.challan_number ASC`,
    [companyId, from, to],
  );
  return result.rows.map((row) => ({
    challanId: row.id,
    challanNumber: row.challan_number,
    depositDate: formatDatabaseDate(row.deposit_date),
    status: row.status,
    totalPoisha: row.total_poisha,
  }));
}

function part(
  partNumber: number,
  titleEn: string,
  titleBn: string,
  rows: VatReturnPartRowDto[],
  totalOverride?: bigint,
): VatReturnPartDto {
  const total = totalOverride ?? rows.reduce((sum, row) => sum + BigInt(row.amountPoisha), 0n);
  return { part: partNumber, titleEn, titleBn, rows, totalPoisha: total.toString() };
}

function categoryAmount(
  summary: VatCategorySummaryDto[],
  category: string,
  field: 'basePoisha' | 'vatPoisha' | 'claimablePoisha' | 'disallowedPoisha',
): bigint {
  return summary.filter((row) => row.taxCategory === category).reduce((sum, row) => sum + BigInt(row[field]), 0n);
}

function categoryRows(
  summary: VatCategorySummaryDto[],
  field: 'basePoisha' | 'vatPoisha' | 'claimablePoisha' | 'disallowedPoisha',
): VatReturnPartRowDto[] {
  return summary.map((row) => ({
    labelEn: `${row.taxCategory.replaceAll('_', ' ')} at ${(row.rateBps / 100).toFixed(2)}%`,
    labelBn: `${row.taxCategory.replaceAll('_', ' ')} — ${(row.rateBps / 100).toFixed(2)}%`,
    amountPoisha: row[field],
    note: null,
  }));
}

export async function getVatReturnDraft(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<VatReturnDraftDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const sales = await getSalesVatRegisterReport(database, companyId, {
    ...input,
    from,
    to,
    page: 1,
    pageSize: 1,
  });
  const purchases = await getPurchaseVatRegisterReport(database, companyId, {
    ...input,
    from,
    to,
    page: 1,
    pageSize: 1,
  });
  const salesPolicy = await getSalesTaxPolicy(database, companyId);
  const purchasePolicy = await getPurchaseTaxPolicy(database, companyId);
  let outputAccount: GlAccountRow | null = null;
  let inputAccount: GlAccountRow | null = null;
  let mappingSource: 'TAX_POLICY_APPROVAL' | 'CONTROL_ACCOUNT' | 'UNMAPPED' = 'UNMAPPED';
  if (salesPolicy.approval?.outputVatAccountId) {
    const row = await database.query<GlAccountRow>(
      `SELECT id, code, name_en, account_type FROM accounts WHERE company_id = $1 AND id = $2`,
      [companyId, salesPolicy.approval.outputVatAccountId],
    );
    outputAccount = row.rows[0] ?? null;
  }
  if (purchasePolicy.approval?.inputVatAccountId) {
    const row = await database.query<GlAccountRow>(
      `SELECT id, code, name_en, account_type FROM accounts WHERE company_id = $1 AND id = $2`,
      [companyId, purchasePolicy.approval.inputVatAccountId],
    );
    inputAccount = row.rows[0] ?? null;
  }
  if (outputAccount && inputAccount) {
    mappingSource = 'TAX_POLICY_APPROVAL';
  } else {
    outputAccount = outputAccount ?? (await findFallbackVatAccount(database, companyId, 'OUTPUT'));
    inputAccount = inputAccount ?? (await findFallbackVatAccount(database, companyId, 'INPUT'));
    if (outputAccount || inputAccount) {
      mappingSource = 'CONTROL_ACCOUNT';
    }
  }

  const outputGl = outputAccount
    ? await accountPeriodBalance(database, companyId, outputAccount.id, from, to, 'CREDIT', resolved.scope.branchId)
    : 0n;
  const inputGl = inputAccount
    ? await accountPeriodBalance(database, companyId, inputAccount.id, from, to, 'DEBIT', resolved.scope.branchId)
    : 0n;
  const outputRegister = BigInt(sales.totals.vatPoisha);
  const inputRegister = BigInt(purchases.totals.claimablePoisha);
  const outputDifference = outputRegister - outputGl;
  const inputDifference = inputRegister - inputGl;
  const withholding = await withholdingTotals(database, companyId, from, to);
  const standardBase = categoryAmount(sales.summaryByCategory, 'STANDARD_15', 'basePoisha');
  const tradingBase = categoryAmount(sales.summaryByCategory, 'TRADING_5', 'basePoisha');
  const procurementBase = categoryAmount(sales.summaryByCategory, 'PROCUREMENT_7_5', 'basePoisha');
  const zeroBase = categoryAmount(sales.summaryByCategory, 'EXPORT_ZERO', 'basePoisha');
  const exemptBase = categoryAmount(sales.summaryByCategory, 'EXEMPT', 'basePoisha');
  const outOfScopeBase = categoryAmount(sales.summaryByCategory, 'OUT_OF_SCOPE', 'basePoisha');
  const creditBase = BigInt(sales.totals.creditNoteBasePoisha);
  const creditVat = BigInt(sales.totals.creditNoteVatPoisha);

  const parts: VatReturnPartDto[] = [
    part(1, 'Taxpayer identity and return period', 'করদাতার পরিচয় ও রিটার্ন সময়কাল', [
      {
        labelEn: 'Legal name',
        labelBn: 'নিবন্ধিত নাম',
        amountPoisha: '0',
        note: resolved.company.legal_name,
      },
      {
        labelEn: 'BIN',
        labelBn: 'বিআইএন',
        amountPoisha: '0',
        note: resolved.branch?.code
          ? `${resolved.company.bin ?? 'Not configured'} / branch ${resolved.branch.code}`
          : (resolved.company.bin ?? 'Not configured'),
      },
      {
        labelEn: 'Return period',
        labelBn: 'রিটার্ন সময়কাল',
        amountPoisha: '0',
        note: `${from} to ${to}`,
      },
    ]),
    part(
      2,
      'Output tax summary (internal mapping)',
      'আউটপুট কর সারসংক্ষেপ (অভ্যন্তরীণ ম্যাপিং)',
      [
        {
          labelEn: 'Standard-rated taxable value',
          labelBn: 'আদর্শ হারে করযোগ্য মূল্য',
          amountPoisha: standardBase.toString(),
          note: null,
        },
        {
          labelEn: 'Trading-rate taxable value',
          labelBn: 'ট্রেডিং হারে করযোগ্য মূল্য',
          amountPoisha: tradingBase.toString(),
          note: null,
        },
        {
          labelEn: 'Procurement-rate taxable value',
          labelBn: 'প্রকিউরমেন্ট হারে করযোগ্য মূল্য',
          amountPoisha: procurementBase.toString(),
          note: null,
        },
        {
          labelEn: 'Output VAT',
          labelBn: 'আউটপুট ভ্যাট',
          amountPoisha: outputRegister.toString(),
          note: 'Register total, including negative credit-note lines.',
        },
      ],
      outputRegister,
    ),
    part(
      3,
      'Zero-rated, exempt and out-of-scope supplies',
      'শূন্য হার, অব্যাহতি ও পরিধির বাইরে সরবরাহ',
      [
        {
          labelEn: 'Export / zero-rated value',
          labelBn: 'রপ্তানি / শূন্য হার মূল্য',
          amountPoisha: zeroBase.toString(),
          note: null,
        },
        {
          labelEn: 'Exempt supplies',
          labelBn: 'অব্যাহতিপ্রাপ্ত সরবরাহ',
          amountPoisha: exemptBase.toString(),
          note: null,
        },
        { labelEn: 'Out of scope', labelBn: 'পরিধির বাইরে', amountPoisha: outOfScopeBase.toString(), note: null },
      ],
      zeroBase + exemptBase + outOfScopeBase,
    ),
    part(
      4,
      'Input tax summary (internal mapping)',
      'ইনপুট কর সারসংক্ষেপ (অভ্যন্তরীণ ম্যাপিং)',
      [
        ...categoryRows(purchases.summaryByCategory, 'basePoisha').map((row) => ({
          ...row,
          labelEn: `Taxable purchases — ${row.labelEn}`,
          labelBn: `করযোগ্য ক্রয় — ${row.labelBn}`,
        })),
        {
          labelEn: 'Input VAT claimable',
          labelBn: 'দাবিযোগ্য ইনপুট ভ্যাট',
          amountPoisha: inputRegister.toString(),
          note: null,
        },
        {
          labelEn: 'Input VAT disallowed',
          labelBn: 'বাতিল ইনপুট ভ্যাট',
          amountPoisha: purchases.totals.disallowedPoisha,
          note: 'Capitalised or expensed according to the purchase decision; never claimed as a rebate.',
        },
      ],
      inputRegister,
    ),
    part(
      5,
      'Withholding and treasury deposits',
      'উৎসে কর ও কোষাগার জমা',
      [
        {
          labelEn: 'VDS withheld (internal register)',
          labelBn: 'কর্তিত ভিডিএস (অভ্যন্তরীণ রেজিস্টার)',
          amountPoisha: withholding.vds.toString(),
          note: null,
        },
        {
          labelEn: 'TDS withheld (internal register)',
          labelBn: 'কর্তিত টিডিএস (অভ্যন্তরীণ রেজিস্টার)',
          amountPoisha: withholding.tds.toString(),
          note: null,
        },
        {
          labelEn: 'Reverse-charge VAT withheld',
          labelBn: 'রিভার্স চার্জ ভ্যাট কর্তন',
          amountPoisha: withholding.reverseCharge.toString(),
          note: null,
        },
      ],
      withholding.vds + withholding.tds + withholding.reverseCharge,
    ),
    part(
      6,
      'Credit-note and returns adjustment',
      'ক্রেডিট নোট ও ফেরত সমন্বয়',
      [
        {
          labelEn: 'Credit notes in the period (taxable value)',
          labelBn: 'সময়কালের ক্রেডিট নোট (করযোগ্য মূল্য)',
          amountPoisha: creditBase.toString(),
          note: 'Included as negative lines in the sales register; not deducted a second time.',
        },
        {
          labelEn: 'Credit notes in the period (VAT)',
          labelBn: 'সময়কালের ক্রেডিট নোট (ভ্যাট)',
          amountPoisha: creditVat.toString(),
          note: 'Included as negative lines in the output VAT total.',
        },
      ],
      creditVat,
    ),
    part(
      7,
      'GL proof',
      'সাধারণ খাতা প্রমাণ',
      [
        {
          labelEn: 'Output VAT per register',
          labelBn: 'রেজিস্টার অনুযায়ী আউটপুট ভ্যাট',
          amountPoisha: outputRegister.toString(),
          note: null,
        },
        {
          labelEn: 'Output VAT per general ledger',
          labelBn: 'সাধারণ খাতা অনুযায়ী আউটপুট ভ্যাট',
          amountPoisha: outputGl.toString(),
          note: outputAccount?.code ?? 'Unmapped',
        },
        {
          labelEn: 'Output variance (must be zero)',
          labelBn: 'আউটপুট পার্থক্য (শূন্য হতে হবে)',
          amountPoisha: outputDifference.toString(),
          note: null,
        },
        {
          labelEn: 'Input VAT claimable per register',
          labelBn: 'রেজিস্টার অনুযায়ী দাবিযোগ্য ইনপুট ভ্যাট',
          amountPoisha: inputRegister.toString(),
          note: null,
        },
        {
          labelEn: 'Input VAT per general ledger',
          labelBn: 'সাধারণ খাতা অনুযায়ী ইনপুট ভ্যাট',
          amountPoisha: inputGl.toString(),
          note: inputAccount?.code ?? 'Unmapped',
        },
        {
          labelEn: 'Input variance (must be zero)',
          labelBn: 'ইনপুট পার্থক্য (শূন্য হতে হবে)',
          amountPoisha: inputDifference.toString(),
          note: null,
        },
      ],
      outputDifference + inputDifference,
    ),
  ];

  const exceptions: ReportExceptionDto[] = [];
  if (!salesPolicy.approval) {
    exceptions.push({
      code: 'SALES_TAX_POLICY_NOT_APPROVED',
      severity: 'WARNING',
      messageEn:
        'The sales tax rule pack has no recorded professional approval. This draft cannot support a filing claim.',
      messageBn: 'বিক্রয় কর রুল প্যাকে পেশাদার অনুমোদনের রেকর্ড নেই। এই খসড়া দাখিলের দাবি সমর্থন করতে পারে না।',
      amountPoisha: null,
      documentCount: null,
    });
  }
  if (!purchasePolicy.approval) {
    exceptions.push({
      code: 'PURCHASE_TAX_POLICY_NOT_APPROVED',
      severity: 'WARNING',
      messageEn:
        'The purchase tax rule pack has no recorded professional approval. This draft cannot support a filing claim.',
      messageBn: 'ক্রয় কর রুল প্যাকে পেশাদার অনুমোদনের রেকর্ড নেই। এই খসড়া দাখিলের দাবি সমর্থন করতে পারে না।',
      amountPoisha: null,
      documentCount: null,
    });
  }
  if (!outputAccount) {
    exceptions.push({
      code: 'OUTPUT_VAT_ACCOUNT_UNMAPPED',
      severity: 'BLOCKER',
      messageEn: 'No output VAT account is approved or configured. The GL proof cannot be completed.',
      messageBn: 'কোনো আউটপুট ভ্যাট হিসাব অনুমোদিত বা কনফিগার করা নেই। জিএল প্রমাণ সম্পূর্ণ করা যাবে না।',
      amountPoisha: null,
      documentCount: null,
    });
  }
  if (!inputAccount) {
    exceptions.push({
      code: 'INPUT_VAT_ACCOUNT_UNMAPPED',
      severity: 'BLOCKER',
      messageEn: 'No input VAT account is approved or configured. The GL proof cannot be completed.',
      messageBn: 'কোনো ইনপুট ভ্যাট হিসাব অনুমোদিত বা কনফিগার করা নেই। জিএল প্রমাণ সম্পূর্ণ করা যাবে না।',
      amountPoisha: null,
      documentCount: null,
    });
  }
  if (outputDifference !== 0n) {
    exceptions.push({
      code: 'OUTPUT_VAT_GL_VARIANCE',
      severity: 'BLOCKER',
      messageEn: `Output VAT register differs from the GL by ${formatPoishaAsBdt(outputDifference)} BDT.`,
      messageBn: `আউটপুট ভ্যাট রেজিস্টার জিএলের সাথে ${formatPoishaAsBdt(outputDifference)} টাকায় পার্থক্য দেখাচ্ছে।`,
      amountPoisha: outputDifference.toString(),
      documentCount: null,
    });
  }
  if (inputDifference !== 0n) {
    exceptions.push({
      code: 'INPUT_VAT_GL_VARIANCE',
      severity: 'BLOCKER',
      messageEn: `Input VAT register differs from the GL by ${formatPoishaAsBdt(inputDifference)} BDT.`,
      messageBn: `ইনপুট ভ্যাট রেজিস্টার জিএলের সাথে ${formatPoishaAsBdt(inputDifference)} টাকায় পার্থক্য দেখাচ্ছে।`,
      amountPoisha: inputDifference.toString(),
      documentCount: null,
    });
  }
  if (sales.totals.reversedDocumentCount > 0) {
    exceptions.push({
      code: 'REVERSED_DOCUMENT_TIMING',
      severity: 'WARNING',
      messageEn: `${sales.totals.reversedDocumentCount} reversed sales document(s) in this period were excluded from the register. If the reversal journal is in a later period, the GL proof will still contain the original tax; review the timing before relying on the GL variance.`,
      messageBn: `এই সময়কালে ${sales.totals.reversedDocumentCount}টি বাতিল বিক্রয় ডকুমেন্ট রেজিস্টার থেকে বাদ দেওয়া হয়েছে। রিভার্সাল জার্নাল পরবর্তী সময়কালে হলে জিএল প্রমাণে মূল কর থাকবে; জিএল পার্থক্যের উপর নির্ভর করার আগে সময়কাল পর্যালোচনা করুন।`,
      amountPoisha: null,
      documentCount: sales.totals.reversedDocumentCount,
    });
  }

  const zeroVariance = outputDifference === 0n && inputDifference === 0n;
  const blockingException = exceptions.some((entry) => entry.severity === 'BLOCKER');
  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'VAT_OUTPUT_GL_PROOF',
      labelEn: 'Output VAT register agrees to the GL',
      labelBn: 'আউটপুট ভ্যাট রেজিস্টার জিএলের সাথে মেলে',
      passed: outputDifference === 0n && Boolean(outputAccount),
      differencePoisha: outputDifference,
      detailEn: outputAccount
        ? `Register ${formatPoishaAsBdt(outputRegister)} BDT; GL ${formatPoishaAsBdt(outputGl)} BDT.`
        : 'No output VAT account is mapped.',
      detailBn: outputAccount
        ? `রেজিস্টার ${formatPoishaAsBdt(outputRegister)} টাকা; জিএল ${formatPoishaAsBdt(outputGl)} টাকা।`
        : 'কোনো আউটপুট ভ্যাট হিসাব ম্যাপ করা নেই।',
    }),
    checkDto({
      key: 'VAT_INPUT_GL_PROOF',
      labelEn: 'Input VAT register agrees to the GL',
      labelBn: 'ইনপুট ভ্যাট রেজিস্টার জিএলের সাথে মেলে',
      passed: inputDifference === 0n && Boolean(inputAccount),
      differencePoisha: inputDifference,
      detailEn: inputAccount
        ? `Register ${formatPoishaAsBdt(inputRegister)} BDT; GL ${formatPoishaAsBdt(inputGl)} BDT.`
        : 'No input VAT account is mapped.',
      detailBn: inputAccount
        ? `রেজিস্টার ${formatPoishaAsBdt(inputRegister)} টাকা; জিএল ${formatPoishaAsBdt(inputGl)} টাকা।`
        : 'কোনো ইনপুট ভ্যাট হিসাব ম্যাপ করা নেই।',
    }),
    checkDto({
      key: 'VAT_DRAFT_NOT_FILED',
      labelEn: 'Return remains a draft and is not filed',
      labelBn: 'রিটার্ন খসড়া এবং দাখিল হয়নি',
      passed: true,
      detailEn: 'No filing acknowledgement, government receipt or authority signature is generated.',
      detailBn: 'কোনো দাখিল স্বীকৃতি, সরকারি রসিদ বা কর্তৃপক্ষের স্বাক্ষর তৈরি হয় না।',
      blocksExport: false,
    }),
  ];

  const netPayable = outputRegister - inputRegister;
  const excessInput = netPayable < 0n ? -netPayable : 0n;
  return {
    reportKey: 'VAT_RETURN_DRAFT',
    titleEn: `Internal VAT return draft ${resolved.scope.labelEn}`,
    titleBn: `অভ্যন্তরীণ ভ্যাট রিটার্ন খসড়া ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_DOCUMENTS_AND_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.vatReturn.reviewStatus,
    template: REPORT_TEMPLATES.vatReturn,
    checks,
    canExport: !blockingException && zeroVariance,
    generatedAt: reportGeneratedAt(),
    filing: {
      status: 'DRAFT',
      canFile: false,
      watermark: 'DRAFT — NOT FILED',
      filingClaim: 'NONE',
    },
    parts,
    totals: {
      outputVatPoisha: outputRegister.toString(),
      inputVatClaimablePoisha: inputRegister.toString(),
      inputVatDisallowedPoisha: purchases.totals.disallowedPoisha,
      creditNoteVatPoisha: creditVat.toString(),
      vdsWithheldPoisha: withholding.vds.toString(),
      tdsWithheldPoisha: withholding.tds.toString(),
      netPayablePoisha: (netPayable > 0n ? netPayable : 0n).toString(),
      excessInputCarriedForwardPoisha: excessInput.toString(),
    },
    glProof: {
      outputVatAccountId: outputAccount?.id ?? null,
      outputVatAccountCode: outputAccount?.code ?? null,
      outputVatGlPoisha: outputGl.toString(),
      outputVatRegisterPoisha: outputRegister.toString(),
      outputVatDifferencePoisha: outputDifference.toString(),
      inputVatAccountId: inputAccount?.id ?? null,
      inputVatAccountCode: inputAccount?.code ?? null,
      inputVatGlPoisha: inputGl.toString(),
      inputVatRegisterPoisha: inputRegister.toString(),
      inputVatDifferencePoisha: inputDifference.toString(),
      mappingSource,
    },
    zeroVariance,
    exceptions,
  };
}

interface WithholdingRow {
  id: string;
  tax_type: string;
  source_type: string;
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
  status: string;
  challan_id: string | null;
  challan_number: string | null;
  deposit_date: Date | null;
  reversed_at: Date | null;
}

export async function getWithholdingRegisterReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<WithholdingRegisterDto> {
  const resolved = await resolveRangeScope(database, companyId, input);
  const from = resolved.from!;
  const to = resolved.to!;
  const bounds = taxPeriodBounds(from, to);
  const result = await database.query<WithholdingRow>(
    `SELECT l.id, l.tax_type, l.source_type, l.tax_period, l.party_id, p.code AS party_code,
            p.name_en AS party_name_en, l.bill_id, d.document_no AS bill_no,
            d.supplier_invoice_no, l.payment_id, pay.payment_number,
            l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.status, l.challan_id, c.challan_number, c.deposit_date, l.reversed_at
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN purchase_payments pay ON pay.company_id = l.company_id AND pay.id = l.payment_id
       LEFT JOIN treasury_challans c ON c.company_id = l.company_id AND c.id = l.challan_id
      WHERE l.company_id = $1 AND l.tax_period BETWEEN $2 AND $3
      ORDER BY l.tax_period ASC, l.created_at ASC`,
    [companyId, bounds.from, bounds.to],
  );
  const rows: WithholdingRegisterRowDto[] = result.rows.map((row) => ({
    liabilityId: row.id,
    taxType: row.tax_type as WithholdingRegisterRowDto['taxType'],
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
    rateBps: row.rate_bps,
    amountPoisha: row.amount_poisha,
    status: row.status,
    challanId: row.challan_id,
    challanNumber: row.challan_number,
    depositDate: row.deposit_date ? formatDatabaseDate(row.deposit_date) : null,
    reversedAt: row.reversed_at?.toISOString() ?? null,
  }));

  const totalsMap = new Map<string, { amount: bigint; count: number }>();
  for (const row of rows) {
    if (row.status === 'REVERSED' || row.reversedAt) continue;
    const key = `${row.taxType}|${row.status}`;
    const current = totalsMap.get(key) ?? { amount: 0n, count: 0 };
    current.amount += BigInt(row.amountPoisha);
    current.count += 1;
    totalsMap.set(key, current);
  }
  const deposits = await challanDeposits(database, companyId, from, to);

  const policy = await getPurchaseTaxPolicy(database, companyId);
  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'WITHHOLDING_MAPPING',
      labelEn: 'Withholding control accounts are mapped',
      labelBn: 'উৎসে কর নিয়ন্ত্রণ হিসাব ম্যাপ করা আছে',
      passed: Boolean(policy.approval),
      detailEn: policy.approval
        ? 'The approved purchase tax policy maps VDS, TDS and reverse-charge payable accounts.'
        : 'The purchase tax policy has no recorded approval. The register is still shown, but a GL control proof and filing claim are blocked.',
      detailBn: policy.approval
        ? 'অনুমোদিত ক্রয় কর নীতি ভিডিএস, টিডিএস ও রিভার্স-চার্জ প্রদেয় হিসাব ম্যাপ করে।'
        : 'ক্রয় কর নীতির অনুমোদনের রেকর্ড নেই। রেজিস্টার দেখানো হয়, তবে জিএল নিয়ন্ত্রণ প্রমাণ ও দাখিলের দাবি বন্ধ থাকে।',
      blocksExport: false,
    }),
    checkDto({
      key: 'CHALLAN_REGISTER_PRESENT',
      labelEn: 'Treasury challan register is included',
      labelBn: 'কোষাগার চালান রেজিস্টার অন্তর্ভুক্ত',
      passed: true,
      detailEn: `${deposits.length} challan${deposits.length === 1 ? '' : 's'} in the selected period.`,
      detailBn: `নির্বাচিত সময়কালে ${deposits.length}টি চালান।`,
      blocksExport: false,
    }),
  ];

  return {
    reportKey: 'WITHHOLDING_REGISTER',
    titleEn: `VDS/TDS and challan register ${resolved.scope.labelEn}`,
    titleBn: `ভিডিএস/টিডিএস ও চালান রেজিস্টার ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_DOCUMENTS_AND_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.withholding.reviewStatus,
    template: REPORT_TEMPLATES.withholding,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    rows,
    lineCount: rows.length,
    totals: [...totalsMap.entries()].map(([key, value]) => {
      const [taxType, status] = key.split('|') as [string, string];
      return { taxType, status, amountPoisha: value.amount.toString(), count: value.count };
    }),
    deposits,
  };
}

interface StockRow {
  item_id: string;
  sku: string;
  item_name_en: string;
  item_name_bn: string | null;
  unit: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name_en: string;
  quantity: string;
  value_poisha: string;
}

export async function getStockValuationReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput,
): Promise<StockValuationDto> {
  const resolved = await resolveAsOfScope(database, companyId, input);
  const asOf = resolved.asOf!;
  const values: unknown[] = [companyId, asOf];
  let branchFilter = '';
  if (resolved.scope.branchScope === 'UNASSIGNED') {
    branchFilter = 'AND w.branch_id IS NULL';
  } else if (resolved.scope.branchId) {
    values.push(resolved.scope.branchId);
    branchFilter = `AND w.branch_id = $${values.length}`;
  }
  const result = await database.query<StockRow>(
    `SELECT i.id AS item_id, i.sku, i.name_en AS item_name_en, i.name_bn AS item_name_bn, i.unit,
            w.id AS warehouse_id, w.code AS warehouse_code, w.name_en AS warehouse_name_en,
            SUM(CASE WHEN sm.movement_type IN
                  ('OPENING_RECEIPT','GRN_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','REVERSAL_IN')
                THEN sm.quantity ELSE -sm.quantity END)::text AS quantity,
            SUM(CASE WHEN sm.movement_type IN
                  ('OPENING_RECEIPT','GRN_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','REVERSAL_IN')
                THEN sm.value_poisha ELSE -sm.value_poisha END)::text AS value_poisha
       FROM stock_movements sm
       JOIN items i ON i.company_id = sm.company_id AND i.id = sm.item_id
       JOIN warehouses w ON w.company_id = sm.company_id AND w.id = sm.warehouse_id
      WHERE sm.company_id = $1 AND sm.movement_date <= $2::date ${branchFilter}
      GROUP BY i.id, i.sku, i.name_en, i.name_bn, i.unit, w.id, w.code, w.name_en
     HAVING SUM(CASE WHEN sm.movement_type IN
                  ('OPENING_RECEIPT','GRN_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','REVERSAL_IN')
                THEN sm.quantity ELSE -sm.quantity END) <> 0
         OR SUM(CASE WHEN sm.movement_type IN
                  ('OPENING_RECEIPT','GRN_RECEIPT','RETURN_IN','TRANSFER_IN','ADJUSTMENT_IN','REVERSAL_IN')
                THEN sm.value_poisha ELSE -sm.value_poisha END) <> 0
      ORDER BY i.sku ASC, w.code ASC`,
    values,
  );
  const rows: StockValuationRowDto[] = result.rows.map((row) => {
    const quantity = parseStoredQuantity(row.quantity);
    const value = BigInt(row.value_poisha);
    return {
      itemId: row.item_id,
      sku: row.sku,
      itemNameEn: row.item_name_en,
      itemNameBn: row.item_name_bn,
      unit: row.unit,
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      warehouseNameEn: row.warehouse_name_en,
      quantity: formatQuantity(quantity),
      valuePoisha: value.toString(),
      weightedUnitCostPoisha: impliedUnitCostPoisha(quantity, value).toString(),
    };
  });
  const totalValue = rows.reduce((sum, row) => sum + BigInt(row.valuePoisha), 0n);
  const byWarehouse = new Map<string, { code: string; value: bigint; itemCount: number }>();
  for (const row of rows) {
    const current = byWarehouse.get(row.warehouseId) ?? { code: row.warehouseCode, value: 0n, itemCount: 0 };
    current.value += BigInt(row.valuePoisha);
    current.itemCount += 1;
    byWarehouse.set(row.warehouseId, current);
  }

  const inventoryAccounts = await database.query<{ id: string; code: string }>(
    `SELECT DISTINCT a.id, a.code
       FROM accounts a
      WHERE a.company_id = $1
        AND (a.control_subledger = 'INVENTORY'
          OR EXISTS (SELECT 1 FROM items i WHERE i.company_id = a.company_id AND i.inventory_account_id = a.id))
      ORDER BY a.code ASC`,
    [companyId],
  );
  const accountIds = inventoryAccounts.rows.map((row) => row.id);
  let inventoryGl = 0n;
  if (accountIds.length > 0) {
    const glValues: unknown[] = [companyId, asOf, accountIds];
    let glBranch = '';
    if (resolved.scope.branchScope === 'UNASSIGNED') {
      glBranch = 'AND j.branch_id IS NULL';
    } else if (resolved.scope.branchId) {
      glValues.push(resolved.scope.branchId);
      glBranch = `AND j.branch_id = $${glValues.length}`;
    }
    const gl = await database.query<{ balance: string }>(
      `SELECT COALESCE(SUM(l.debit_poisha - l.credit_poisha), 0)::text AS balance
         FROM journal_lines l
         JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id
        WHERE l.company_id = $1 AND j.posting_date <= $2::date
          AND l.account_id = ANY($3::uuid[])
          AND j.status IN ('POSTED', 'REVERSED') ${glBranch}`,
      glValues,
    );
    inventoryGl = BigInt(gl.rows[0]?.balance ?? '0');
  }
  const difference = totalValue - inventoryGl;
  const checks: ReportCheckDto[] = [
    checkDto({
      key: 'STOCK_GL_PROOF',
      labelEn: 'Stock value agrees to the inventory control accounts',
      labelBn: 'স্টক মূল্য ইনভেন্টরি নিয়ন্ত্রণ হিসাবের সাথে মেলে',
      passed: accountIds.length > 0 && difference === 0n,
      differencePoisha: difference,
      detailEn: accountIds.length
        ? `Stock ${formatPoishaAsBdt(totalValue)} BDT; inventory GL ${formatPoishaAsBdt(inventoryGl)} BDT.`
        : 'No inventory control account is configured. The stock schedule cannot be proved.',
      detailBn: accountIds.length
        ? `স্টক ${formatPoishaAsBdt(totalValue)} টাকা; ইনভেন্টরি জিএল ${formatPoishaAsBdt(inventoryGl)} টাকা।`
        : 'কোনো ইনভেন্টরি নিয়ন্ত্রণ হিসাব কনফিগার করা নেই। স্টক তফসিল প্রমাণ করা যাবে না।',
    }),
    checkDto({
      key: 'STOCK_AS_OF',
      labelEn: 'Valuation is as of the selected date',
      labelBn: 'মূল্যায়ন নির্বাচিত তারিখ অনুযায়ী',
      passed: true,
      detailEn: `All movements up to ${asOf} are included; later movements are excluded.`,
      detailBn: `${asOf} পর্যন্ত সব চলাচল অন্তর্ভুক্ত; পরবর্তী চলাচল বাদ।`,
      blocksExport: false,
    }),
  ];

  return {
    reportKey: 'STOCK_VALUATION',
    titleEn: `Stock valuation as at ${asOf}`,
    titleBn: `${asOf} তারিখে স্টক মূল্যায়ন`,
    scope: resolved.scope,
    basis: 'STOCK_MOVEMENTS',
    reviewStatus: REPORT_TEMPLATES.stock.reviewStatus,
    template: REPORT_TEMPLATES.stock,
    checks,
    canExport: canExportFrom(checks),
    generatedAt: reportGeneratedAt(),
    rows,
    lineCount: rows.length,
    totals: [...byWarehouse.entries()].map(([warehouseId, value]) => ({
      warehouseId,
      warehouseCode: value.code,
      valuePoisha: value.value.toString(),
      itemCount: value.itemCount,
    })),
    totalValuePoisha: totalValue.toString(),
    glProof: {
      inventoryAccountIds: accountIds,
      inventoryAccountCodes: inventoryAccounts.rows.map((row) => row.code),
      inventoryGlPoisha: inventoryGl.toString(),
      stockValuePoisha: totalValue.toString(),
      differencePoisha: difference.toString(),
    },
  };
}

export async function getArAgeingReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput & { partyId?: string; asOf?: string },
): Promise<AgeingReportDto> {
  const resolved = await resolveAsOfScope(database, companyId, input);
  const ageing = await getArAgeing(database, companyId, resolved.asOf!, input.partyId, resolved.scope.branchId);
  const check = checkDto({
    key: 'AR_CONTROL_PROOF',
    labelEn: 'Receivables subledger agrees to the control account',
    labelBn: 'প্রাপ্য সাবলেজার নিয়ন্ত্রণ হিসাবের সাথে মেলে',
    passed: ageing.proof.agrees,
    differencePoisha: BigInt(ageing.proof.differencePoisha),
    detailEn: `Subledger ${ageing.proof.subledgerBdt} BDT; GL ${ageing.proof.glBalanceBdt} BDT.`,
    detailBn: `সাবলেজার ${ageing.proof.subledgerBdt} টাকা; জিএল ${ageing.proof.glBalanceBdt} টাকা।`,
  });
  return {
    reportKey: 'AR_AGEING',
    titleEn: `Receivables ageing ${resolved.scope.labelEn}`,
    titleBn: `প্রাপ্য এজিং ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_DOCUMENTS_AND_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.arAgeing.reviewStatus,
    template: REPORT_TEMPLATES.arAgeing,
    checks: [check],
    canExport: check.passed,
    generatedAt: reportGeneratedAt(),
    ageing,
  };
}

export async function getApAgeingReport(
  database: Queryable,
  companyId: string,
  input: ReportScopeInput & { partyId?: string; asOf?: string },
): Promise<AgeingReportDto> {
  const resolved = await resolveAsOfScope(database, companyId, input);
  const ageing = await getApAgeing(database, companyId, resolved.asOf!, input.partyId, resolved.scope.branchId);
  const check = checkDto({
    key: 'AP_CONTROL_PROOF',
    labelEn: 'Payables subledger agrees to the control account',
    labelBn: 'প্রদেয় সাবলেজার নিয়ন্ত্রণ হিসাবের সাথে মেলে',
    passed: ageing.proof.agrees,
    differencePoisha: BigInt(ageing.proof.differencePoisha),
    detailEn: `Subledger ${ageing.proof.subledgerBdt} BDT; GL ${ageing.proof.glBalanceBdt} BDT.`,
    detailBn: `সাবলেজার ${ageing.proof.subledgerBdt} টাকা; জিএল ${ageing.proof.glBalanceBdt} টাকা।`,
  });
  return {
    reportKey: 'AP_AGEING',
    titleEn: `Payables ageing ${resolved.scope.labelEn}`,
    titleBn: `প্রদেয় এজিং ${resolved.scope.labelBn}`,
    scope: resolved.scope,
    basis: 'POSTED_DOCUMENTS_AND_JOURNALS',
    reviewStatus: REPORT_TEMPLATES.apAgeing.reviewStatus,
    template: REPORT_TEMPLATES.apAgeing,
    checks: [check],
    canExport: check.passed,
    generatedAt: reportGeneratedAt(),
    ageing,
  };
}
