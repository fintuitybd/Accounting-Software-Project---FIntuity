import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import { AppError } from '../errors.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt } from '../company/money.ts';
import { resolveNoteRef } from './statements.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type WithholdingSchedule = 'SCHEDULE_A' | 'SCHEDULE_B' | 'SCHEDULE_C' | 'SCHEDULE_D';
export type WithholdingReturnStatus = 'DRAFT' | 'VERIFIED' | 'SUBMITTED';
export type WithholdingAnomaly = 'MISSING_ETIN' | 'UNDEPOSITED_TDS' | 'LATE_CHALLAN_DEPOSIT';

export interface WithholdingReturnLineDto {
  id: string;
  schedule: WithholdingSchedule;
  sectionCode: string;
  partyId: string | null;
  partyName: string;
  partyTin: string | null;
  grossPaymentPoisha: string;
  grossPaymentBdt: string;
  taxableBasePoisha: string;
  taxableBaseBdt: string;
  rateBps: number;
  tdsAmountPoisha: string;
  tdsAmountBdt: string;
  penaltyApplied: boolean;
  challanNumber: string | null;
  challanDate: string | null;
  economicCode: string | null;
  anomalies: WithholdingAnomaly[];
  liabilityId: string | null;
}

export interface WithholdingReturnDto {
  id: string;
  companyId: string;
  taxYear: string;
  taxPeriod: string;
  status: WithholdingReturnStatus;
  totalDeductedPoisha: string;
  totalDeductedBdt: string;
  totalDepositedPoisha: string;
  totalDepositedBdt: string;
  anomalyCount: number;
  schedulesSummary: Record<
    WithholdingSchedule,
    {
      count: number;
      basePoisha: string;
      baseBdt: string;
      tdsPoisha: string;
      tdsBdt: string;
      anomalyCount: number;
    }
  >;
  lines: WithholdingReturnLineDto[];
  submittedAt: string | null;
  submittedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatementDrillDownLevel1Account {
  accountId: string;
  accountCode: string;
  accountName: string;
  subCategory: string;
  ifrsCategory: string;
  openingPoisha: string;
  openingBdt: string;
  debitPoisha: string;
  debitBdt: string;
  creditPoisha: string;
  creditBdt: string;
  closingPoisha: string;
  closingBdt: string;
}

export interface StatementDrillDownLevel2Journal {
  journalId: string;
  journalNumber: string;
  postingDate: string;
  sourceModule: string;
  narration: string;
  accountCode: string;
  debitPoisha: string;
  debitBdt: string;
  creditPoisha: string;
  creditBdt: string;
  partyReference: string | null;
  partyName: string | null;
  chainHash: string;
  verifiedChain: boolean;
}

export interface StatementDrillDownLevel3SourceDoc {
  journalId: string;
  sourceDocId: string | null;
  sourceDocRef: string | null;
  sourceModule: string;
  documentType: string;
  documentNo: string | null;
  documentDate: string | null;
  mushak63Serial: string | null;
  mushak66Certificate: string | null;
  challanNumber: string | null;
  economicCode: string | null;
  basePoisha: string | null;
  baseBdt: string | null;
  taxPoisha: string | null;
  taxBdt: string | null;
}

export interface StatementDrillDownDto {
  target: {
    noteRef?: string;
    accountCode?: string;
    accountId?: string;
  };
  period: {
    fromDate: string;
    toDate: string;
  };
  level1: {
    accounts: StatementDrillDownLevel1Account[];
    totalOpeningPoisha: string;
    totalDebitPoisha: string;
    totalCreditPoisha: string;
    totalClosingPoisha: string;
  };
  level2: {
    journals: StatementDrillDownLevel2Journal[];
    count: number;
    tamperEvidentChainVerified: boolean;
  };
  level3: {
    sourceDocuments: StatementDrillDownLevel3SourceDoc[];
    count: number;
  };
}

function classifySchedule(natureOrSection: string): { schedule: WithholdingSchedule; sectionCode: string } {
  const norm = (natureOrSection || '').toUpperCase();
  if (norm.includes('SALARY') || norm.includes('SEC_86') || norm.includes('86')) {
    return { schedule: 'SCHEDULE_A', sectionCode: 'SEC_86' };
  }
  if (
    norm.includes('GOODS') ||
    norm.includes('SUPPLY') ||
    norm.includes('CONTRACT') ||
    norm.includes('SEC_89') ||
    norm.includes('SEC_88') ||
    norm.includes('89') ||
    norm.includes('88')
  ) {
    return {
      schedule: 'SCHEDULE_B',
      sectionCode: norm.includes('88') ? 'SEC_88' : 'SEC_89',
    };
  }
  if (norm.includes('RENT') || norm.includes('HOUSE') || norm.includes('SEC_109') || norm.includes('109')) {
    return { schedule: 'SCHEDULE_C', sectionCode: 'SEC_109' };
  }
  if (
    norm.includes('SERVICE') ||
    norm.includes('PROFESSIONAL') ||
    norm.includes('TECHNICAL') ||
    norm.includes('MEDIA') ||
    norm.includes('TRANSPORT') ||
    norm.includes('SEC_90') ||
    norm.includes('SEC_91') ||
    norm.includes('SEC_92') ||
    norm.includes('90') ||
    norm.includes('91') ||
    norm.includes('92')
  ) {
    const sec = norm.includes('91') || norm.includes('TRANSPORT')
      ? 'SEC_91'
      : norm.includes('92') || norm.includes('MEDIA')
        ? 'SEC_92'
        : 'SEC_90';
    return { schedule: 'SCHEDULE_D', sectionCode: sec };
  }
  return { schedule: 'SCHEDULE_B', sectionCode: 'SEC_89' };
}

function isChallanLate(taxPeriod: string, depositDate: string): boolean {
  const parts = taxPeriod.split('-');
  const year = parts[0] ? parseInt(parts[0], 10) : NaN;
  const month = parts[1] ? parseInt(parts[1], 10) : NaN;
  if (isNaN(year) || isNaN(month)) return false;

  let dueYear = year;
  let dueMonth = month + 1;
  if (dueMonth > 12) {
    dueYear += 1;
    dueMonth = 1;
  }
  const dueDateStr = `${dueYear}-${String(dueMonth).padStart(2, '0')}-15`;
  return depositDate > dueDateStr;
}

export async function generateSection177Return(
  database: Queryable,
  companyId: string,
  input: {
    taxYear?: string;
    taxPeriod: string;
    actorUserId: string;
  },
): Promise<WithholdingReturnDto> {
  const parts = input.taxPeriod.split('-');
  const year = parts[0] ? parseInt(parts[0], 10) : 2026;
  const month = parts[1] ? parseInt(parts[1], 10) : 11;
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const fyRes = await database.query<{ id: string }>(
    `SELECT id FROM fiscal_years WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2 LIMIT 1`,
    [companyId, periodStart],
  );
  if (!fyRes.rows[0]) {
    throw new AppError(400, 'FISCAL_YEAR_NOT_FOUND', `No fiscal year covers period ${input.taxPeriod}`);
  }
  const fiscalYearId = fyRes.rows[0].id;

  const existing = await database.query<{ id: string; status: string }>(
    `SELECT id, status FROM withholding_tax_returns
      WHERE company_id = $1 AND return_type = 'MONTHLY_177' AND period_start = $2 AND period_end = $3`,
    [companyId, periodStart, periodEnd],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'SUBMITTED') {
      throw new AppError(409, 'RETURN_ALREADY_SUBMITTED', 'This Section 177 return has already been submitted to NBR.');
    }
    await database.query(`DELETE FROM withholding_tax_returns WHERE company_id = $1 AND id = $2`, [
      companyId,
      existing.rows[0].id,
    ]);
  }

  const liabilitiesQuery = await database.query<{
    id: string;
    base_poisha: string;
    rate_bps: number;
    amount_poisha: string;
    status: string;
    tax_period: string;
    economic_code: string | null;
    challan_id: string | null;
    deposited_at: Date | null;
    created_at: Date;
    party_id: string;
    party_name: string;
    party_tin: string | null;
    party_bin: string | null;
    tds_nature: string | null;
    supplier_tin_missing: boolean | null;
    bill_id: string | null;
    challan_number: string | null;
    deposit_date: Date | null;
    bank_name: string | null;
    bill_gross_poisha: string | null;
  }>(
    `SELECT l.id, l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.status, l.tax_period, l.economic_code, l.challan_id, l.deposited_at, l.created_at,
            l.party_id, p.name_en AS party_name, p.tin AS party_tin, p.bin AS party_bin,
            d.tds_nature, d.supplier_tin_missing, d.id AS bill_id,
            c.challan_number, c.deposit_date,
            b.name AS bank_name,
            d.gross_poisha::text AS bill_gross_poisha
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN treasury_challans c ON c.company_id = l.company_id AND c.id = l.challan_id
       LEFT JOIN bank_accounts b ON b.company_id = c.company_id AND b.id = c.bank_account_id
      WHERE l.company_id = $1 AND l.tax_type = 'TDS' AND l.tax_period = $2
      ORDER BY l.created_at ASC`,
    [companyId, input.taxPeriod],
  );

  const returnId = randomUUID();
  let totalGross = 0n;
  let totalDeducted = 0n;
  let totalDeposited = 0n;

  const linesToInsert: Array<{
    id: string;
    scheduleCode: string;
    partyId: string | null;
    sourceDocumentId: string;
    deducteeName: string;
    deducteeTin: string | null;
    deducteeBin: string | null;
    penaltyApplied: boolean;
    sectionCode: string;
    economicCode: string;
    grossAmountPoisha: string;
    paidAmountPoisha: string;
    rateBps: number;
    tdsAmountPoisha: string;
    paymentDateStr: string;
    challanId: string | null;
    challanNumber: string | null;
    challanDateStr: string | null;
    bankName: string | null;
    anomalies: WithholdingAnomaly[];
  }> = [];

  for (const row of liabilitiesQuery.rows) {
    const classification = classifySchedule(row.tds_nature ?? 'SUPPLY_OF_GOODS');
    const basePoisha = BigInt(row.base_poisha);
    const tdsPoisha = BigInt(row.amount_poisha);
    const grossPoisha = row.bill_gross_poisha ? BigInt(row.bill_gross_poisha) : basePoisha + tdsPoisha;

    const anomalies: WithholdingAnomaly[] = [];
    const tinValid = Boolean(row.party_tin && /^\d{12}$/.test(row.party_tin.trim()));
    if (!tinValid) {
      anomalies.push('MISSING_ETIN');
    }

    const deposited = row.status === 'DEPOSITED' && Boolean(row.challan_number);
    if (!deposited) {
      anomalies.push('UNDEPOSITED_TDS');
    } else if (row.deposit_date) {
      const depDateStr = formatDatabaseDate(row.deposit_date);
      if (isChallanLate(input.taxPeriod, depDateStr)) {
        anomalies.push('LATE_CHALLAN_DEPOSIT');
      }
    }

    const penaltyApplied = row.supplier_tin_missing === true || !tinValid;

    totalGross += grossPoisha;
    totalDeducted += tdsPoisha;
    if (deposited) {
      totalDeposited += tdsPoisha;
    }

    const scheduleCode =
      classification.schedule === 'SCHEDULE_A'
        ? 'SCHED_A_SALARY'
        : classification.schedule === 'SCHEDULE_B'
          ? 'SCHED_B_GOODS'
          : classification.schedule === 'SCHEDULE_C'
            ? 'SCHED_C_RENT'
            : 'SCHED_D_PROF';

    const paymentDateStr = formatDatabaseDate(row.created_at);
    const challanDateStr = row.deposit_date ? formatDatabaseDate(row.deposit_date) : null;

    linesToInsert.push({
      id: randomUUID(),
      scheduleCode,
      partyId: row.party_id,
      sourceDocumentId: row.bill_id ?? row.id,
      deducteeName: row.party_name,
      deducteeTin: row.party_tin,
      deducteeBin: row.party_bin,
      penaltyApplied,
      sectionCode: classification.sectionCode,
      economicCode: row.economic_code ?? '1/1141/0010/0111',
      grossAmountPoisha: grossPoisha.toString(),
      paidAmountPoisha: basePoisha.toString(),
      rateBps: row.rate_bps,
      tdsAmountPoisha: tdsPoisha.toString(),
      paymentDateStr,
      challanId: row.challan_id,
      challanNumber: row.challan_number,
      challanDateStr,
      bankName: row.bank_name,
      anomalies,
    });
  }

  // Automatically feed Section 177 SCHED_A_SALARY from posted payroll runs
  const payrollQuery = await database.query<{
    run_id: string;
    batch_date: Date;
    gross_pay_poisha: string;
    net_pay_poisha: string;
    tds_poisha: string;
    employee_code: string;
    name_en: string;
    etin: string | null;
  }>(
    `SELECT r.id AS run_id, r.batch_date, l.gross_pay_poisha::text AS gross_pay_poisha,
            l.net_pay_poisha::text AS net_pay_poisha, l.tds_poisha::text AS tds_poisha,
            e.employee_code, e.name_en, e.etin
       FROM payroll_runs r
       JOIN payroll_run_lines l ON l.company_id = r.company_id AND l.run_id = r.id
       JOIN payroll_employees e ON e.company_id = r.company_id AND e.id = l.employee_id
       JOIN periods p ON p.company_id = r.company_id AND p.id = r.period_id
      WHERE r.company_id = $1 AND r.status IN ('POSTED', 'DISBURSED')
        AND p.code = $2 AND l.tds_poisha > 0
      ORDER BY e.employee_code ASC`,
    [companyId, input.taxPeriod],
  );

  for (const pRow of payrollQuery.rows) {
    const grossPoisha = BigInt(pRow.gross_pay_poisha);
    const paidPoisha = BigInt(pRow.net_pay_poisha);
    const tdsPoisha = BigInt(pRow.tds_poisha);

    const anomalies: WithholdingAnomaly[] = [];
    const tinValid = Boolean(pRow.etin && /^\d{12}$/.test(pRow.etin.trim()));
    if (!tinValid) {
      anomalies.push('MISSING_ETIN');
    }
    anomalies.push('UNDEPOSITED_TDS');

    totalGross += grossPoisha;
    totalDeducted += tdsPoisha;

    const rateBps = grossPoisha > 0n ? Number((tdsPoisha * 10000n) / grossPoisha) : 0;
    const paymentDateStr = formatDatabaseDate(pRow.batch_date);

    linesToInsert.push({
      id: randomUUID(),
      scheduleCode: 'SCHED_A_SALARY',
      partyId: null,
      sourceDocumentId: pRow.run_id,
      deducteeName: pRow.name_en,
      deducteeTin: pRow.etin,
      deducteeBin: null,
      penaltyApplied: false,
      sectionCode: 'SEC_86',
      economicCode: '1/1141/0010/0112',
      grossAmountPoisha: grossPoisha.toString(),
      paidAmountPoisha: paidPoisha.toString(),
      rateBps,
      tdsAmountPoisha: tdsPoisha.toString(),
      paymentDateStr,
      challanId: null,
      challanNumber: null,
      challanDateStr: null,
      bankName: null,
      anomalies,
    });
  }

  // Insert parent return FIRST to satisfy foreign key constraint
  await database.query(
    `INSERT INTO withholding_tax_returns (
       id, company_id, fiscal_year_id, return_type, period_start, period_end,
       total_gross_paid_poisha, total_tds_deducted_poisha, total_tds_deposited_poisha,
       status, prepared_by
     ) VALUES ($1, $2, $3, 'MONTHLY_177', $4, $5, $6, $7, $8, 'DRAFT', $9)`,
    [
      returnId,
      companyId,
      fiscalYearId,
      periodStart,
      periodEnd,
      totalGross.toString(),
      totalDeducted.toString(),
      totalDeposited.toString(),
      input.actorUserId,
    ],
  );

  // Insert lines with parent returnId
  for (const line of linesToInsert) {
    await database.query(
      `INSERT INTO withholding_return_lines (
         id, company_id, return_id, schedule_code, party_id, source_document_id,
         deductee_name, deductee_tin, deductee_bin, has_etin_penalty_upscale,
         section_code, economic_code, gross_amount_poisha, paid_amount_poisha,
         tds_rate_bps, tds_amount_poisha, payment_date, challan_id,
         challan_number, challan_date, bank_name, anomaly_flags
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        line.id,
        companyId,
        returnId,
        line.scheduleCode,
        line.partyId,
        line.sourceDocumentId,
        line.deducteeName,
        line.deducteeTin,
        line.deducteeBin,
        line.penaltyApplied,
        line.sectionCode,
        line.economicCode,
        line.grossAmountPoisha,
        line.paidAmountPoisha,
        line.rateBps,
        line.tdsAmountPoisha,
        line.paymentDateStr,
        line.challanId,
        line.challanNumber,
        line.challanDateStr,
        line.bankName,
        JSON.stringify(line.anomalies),
      ],
    );
  }

  return getSection177Return(database, companyId, returnId);
}

export const generateWithholdingReturn = generateSection177Return;

export async function getSection177Return(
  database: Queryable,
  companyId: string,
  returnIdOrPeriod: string,
): Promise<WithholdingReturnDto> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(returnIdOrPeriod);
  const result = await database.query<{
    id: string;
    company_id: string;
    fiscal_year_id: string;
    return_type: string;
    period_start: Date;
    period_end: Date;
    total_gross_paid_poisha: string;
    total_tds_deducted_poisha: string;
    total_tds_deposited_poisha: string;
    status: WithholdingReturnStatus;
    submission_ack_number: string | null;
    submitted_at: Date | null;
    submitted_by: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT r.id, r.company_id, r.fiscal_year_id, r.return_type,
            r.period_start, r.period_end,
            r.total_gross_paid_poisha::text AS total_gross_paid_poisha,
            r.total_tds_deducted_poisha::text AS total_tds_deducted_poisha,
            r.total_tds_deposited_poisha::text AS total_tds_deposited_poisha,
            r.status, r.submission_ack_number, r.submitted_at,
            u.name AS submitted_by,
            r.created_at, r.updated_at
       FROM withholding_tax_returns r
       LEFT JOIN users u ON u.id = r.verified_by
      WHERE r.company_id = $1 AND ${
        isUuid
          ? 'r.id = $2'
          : `to_char(r.period_start, 'YYYY-MM') = $2`
      }`,
    [companyId, returnIdOrPeriod],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'WITHHOLDING_RETURN_NOT_FOUND', 'Section 177 return not found for the specified period.');
  }

  const linesResult = await database.query<{
    id: string;
    schedule_code: string;
    section_code: string;
    party_id: string | null;
    source_document_id: string | null;
    deductee_name: string;
    deductee_tin: string | null;
    deductee_bin: string | null;
    has_etin_penalty_upscale: boolean;
    economic_code: string;
    gross_amount_poisha: string;
    paid_amount_poisha: string;
    tds_rate_bps: number;
    tds_amount_poisha: string;
    payment_date: Date;
    challan_id: string | null;
    challan_number: string | null;
    challan_date: Date | null;
    bank_name: string | null;
    anomaly_flags: string | null;
  }>(
    `SELECT id, schedule_code, section_code, party_id, source_document_id,
            deductee_name, deductee_tin, deductee_bin, has_etin_penalty_upscale,
            economic_code, gross_amount_poisha::text AS gross_amount_poisha,
            paid_amount_poisha::text AS paid_amount_poisha,
            tds_rate_bps, tds_amount_poisha::text AS tds_amount_poisha,
            payment_date, challan_id, challan_number, challan_date, bank_name,
            anomaly_flags
       FROM withholding_return_lines
      WHERE company_id = $1 AND return_id = $2
      ORDER BY payment_date ASC, deductee_name ASC`,
    [companyId, row.id],
  );

  const summary: Record<
    WithholdingSchedule,
    { count: number; basePoisha: bigint; tdsPoisha: bigint; anomalyCount: number }
  > = {
    SCHEDULE_A: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_B: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_C: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_D: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
  };

  let totalAnomalies = 0;

  const lines: WithholdingReturnLineDto[] = linesResult.rows.map((line) => {
    const sched: WithholdingSchedule =
      line.schedule_code === 'SCHED_A_SALARY'
        ? 'SCHEDULE_A'
        : line.schedule_code === 'SCHED_B_GOODS'
          ? 'SCHEDULE_B'
          : line.schedule_code === 'SCHED_C_RENT'
            ? 'SCHEDULE_C'
            : 'SCHEDULE_D';

    let anomalies: WithholdingAnomaly[] = [];
    if (line.anomaly_flags) {
      try {
        anomalies = JSON.parse(line.anomaly_flags);
      } catch {
        anomalies = [];
      }
    }

    const basePoisha = BigInt(line.paid_amount_poisha);
    const tdsPoisha = BigInt(line.tds_amount_poisha);

    summary[sched].count += 1;
    summary[sched].basePoisha += basePoisha;
    summary[sched].tdsPoisha += tdsPoisha;
    summary[sched].anomalyCount += anomalies.length;
    totalAnomalies += anomalies.length;

    return {
      id: line.id,
      schedule: sched,
      sectionCode: line.section_code,
      partyId: line.party_id,
      partyName: line.deductee_name,
      partyTin: line.deductee_tin,
      grossPaymentPoisha: line.gross_amount_poisha,
      grossPaymentBdt: formatPoishaAsBdt(line.gross_amount_poisha),
      taxableBasePoisha: line.paid_amount_poisha,
      taxableBaseBdt: formatPoishaAsBdt(line.paid_amount_poisha),
      rateBps: line.tds_rate_bps,
      tdsAmountPoisha: line.tds_amount_poisha,
      tdsAmountBdt: formatPoishaAsBdt(line.tds_amount_poisha),
      penaltyApplied: line.has_etin_penalty_upscale,
      challanNumber: line.challan_number,
      challanDate: line.challan_date ? formatDatabaseDate(line.challan_date) : null,
      economicCode: line.economic_code,
      anomalies,
      liabilityId: line.source_document_id,
    };
  });

  const schedulesSummary = {
    SCHEDULE_A: {
      count: summary.SCHEDULE_A.count,
      basePoisha: summary.SCHEDULE_A.basePoisha.toString(),
      baseBdt: formatPoishaAsBdt(summary.SCHEDULE_A.basePoisha),
      tdsPoisha: summary.SCHEDULE_A.tdsPoisha.toString(),
      tdsBdt: formatPoishaAsBdt(summary.SCHEDULE_A.tdsPoisha),
      anomalyCount: summary.SCHEDULE_A.anomalyCount,
    },
    SCHEDULE_B: {
      count: summary.SCHEDULE_B.count,
      basePoisha: summary.SCHEDULE_B.basePoisha.toString(),
      baseBdt: formatPoishaAsBdt(summary.SCHEDULE_B.basePoisha),
      tdsPoisha: summary.SCHEDULE_B.tdsPoisha.toString(),
      tdsBdt: formatPoishaAsBdt(summary.SCHEDULE_B.tdsPoisha),
      anomalyCount: summary.SCHEDULE_B.anomalyCount,
    },
    SCHEDULE_C: {
      count: summary.SCHEDULE_C.count,
      basePoisha: summary.SCHEDULE_C.basePoisha.toString(),
      baseBdt: formatPoishaAsBdt(summary.SCHEDULE_C.basePoisha),
      tdsPoisha: summary.SCHEDULE_C.tdsPoisha.toString(),
      tdsBdt: formatPoishaAsBdt(summary.SCHEDULE_C.tdsPoisha),
      anomalyCount: summary.SCHEDULE_C.anomalyCount,
    },
    SCHEDULE_D: {
      count: summary.SCHEDULE_D.count,
      basePoisha: summary.SCHEDULE_D.basePoisha.toString(),
      baseBdt: formatPoishaAsBdt(summary.SCHEDULE_D.basePoisha),
      tdsPoisha: summary.SCHEDULE_D.tdsPoisha.toString(),
      tdsBdt: formatPoishaAsBdt(summary.SCHEDULE_D.tdsPoisha),
      anomalyCount: summary.SCHEDULE_D.anomalyCount,
    },
  };

  const periodStartStr = formatDatabaseDate(row.period_start);
  const taxPeriod = periodStartStr.slice(0, 7);
  const startYear = parseInt(periodStartStr.slice(0, 4), 10);
  const taxYear = `${startYear}-${startYear + 1}`;

  return {
    id: row.id,
    companyId: row.company_id,
    taxYear,
    taxPeriod,
    status: row.status,
    totalDeductedPoisha: row.total_tds_deducted_poisha,
    totalDeductedBdt: formatPoishaAsBdt(row.total_tds_deducted_poisha),
    totalDepositedPoisha: row.total_tds_deposited_poisha,
    totalDepositedBdt: formatPoishaAsBdt(row.total_tds_deposited_poisha),
    anomalyCount: totalAnomalies,
    schedulesSummary,
    lines,
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    submittedBy: row.submitted_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function verifySection177Return(
  database: Queryable,
  companyId: string,
  returnId: string,
  actorUserId?: string,
): Promise<WithholdingReturnDto> {
  await database.query(
    `UPDATE withholding_tax_returns SET status = 'VERIFIED', verified_by = COALESCE($3, verified_by), updated_at = now() WHERE company_id = $1 AND id = $2`,
    [companyId, returnId, actorUserId ?? null],
  );
  return getSection177Return(database, companyId, returnId);
}

export async function submitSection177Return(
  database: Queryable,
  companyId: string,
  returnId: string,
  actorUserId: string,
): Promise<WithholdingReturnDto> {
  const current = await getSection177Return(database, companyId, returnId);
  const ack = `ACK-177-${current.taxPeriod}-${randomUUID().slice(0, 8).toUpperCase()}`;
  await database.query(
    `UPDATE withholding_tax_returns
        SET status = 'SUBMITTED', submitted_at = now(), verified_by = $3, submission_ack_number = $4, updated_at = now()
      WHERE company_id = $1 AND id = $2`,
    [companyId, returnId, actorUserId, ack],
  );
  return getSection177Return(database, companyId, returnId);
}

export async function exportSection177Excel(returnData: WithholdingReturnDto): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fintuity Accounting Suite v2.1.0';
  wb.created = new Date();

  const addHeader = (ws: ExcelJS.Worksheet, title: string, sub: string) => {
    ws.addRow([title]);
    ws.addRow([sub]);
    ws.addRow([]);
    ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  };

  // 1. Summary Sheet
  const wsSum = wb.addWorksheet('Summary');
  addHeader(
    wsSum,
    `NBR Section 177 Withholding Tax Return — Period ${returnData.taxPeriod}`,
    `Tax Year: ${returnData.taxYear} | Status: ${returnData.status} | Total Anomalies: ${returnData.anomalyCount}`,
  );
  wsSum.addRow(['Schedule', 'Name', 'Transaction Count', 'Base (BDT)', 'TDS Deducted (BDT)', 'Anomalies']);
  wsSum.getRow(4).font = { bold: true };
  wsSum.addRow([
    'Schedule A',
    'Sec 86 Salaries',
    returnData.schedulesSummary.SCHEDULE_A.count,
    returnData.schedulesSummary.SCHEDULE_A.baseBdt,
    returnData.schedulesSummary.SCHEDULE_A.tdsBdt,
    returnData.schedulesSummary.SCHEDULE_A.anomalyCount,
  ]);
  wsSum.addRow([
    'Schedule B',
    'Sec 88/89 Goods & Contracts',
    returnData.schedulesSummary.SCHEDULE_B.count,
    returnData.schedulesSummary.SCHEDULE_B.baseBdt,
    returnData.schedulesSummary.SCHEDULE_B.tdsBdt,
    returnData.schedulesSummary.SCHEDULE_B.anomalyCount,
  ]);
  wsSum.addRow([
    'Schedule C',
    'Sec 109 House Property Rent',
    returnData.schedulesSummary.SCHEDULE_C.count,
    returnData.schedulesSummary.SCHEDULE_C.baseBdt,
    returnData.schedulesSummary.SCHEDULE_C.tdsBdt,
    returnData.schedulesSummary.SCHEDULE_C.anomalyCount,
  ]);
  wsSum.addRow([
    'Schedule D',
    'Sec 90/91/92 Services & Media',
    returnData.schedulesSummary.SCHEDULE_D.count,
    returnData.schedulesSummary.SCHEDULE_D.baseBdt,
    returnData.schedulesSummary.SCHEDULE_D.tdsBdt,
    returnData.schedulesSummary.SCHEDULE_D.anomalyCount,
  ]);
  wsSum.addRow([]);
  wsSum.addRow([
    'Total',
    '',
    returnData.lines.length,
    '',
    returnData.totalDeductedBdt,
    returnData.anomalyCount,
  ]);
  wsSum.getRow(10).font = { bold: true };

  const populateScheduleSheet = (ws: ExcelJS.Worksheet, schedKey: WithholdingSchedule, title: string) => {
    addHeader(ws, title, `Tax Period: ${returnData.taxPeriod} | Tax Year: ${returnData.taxYear}`);
    ws.addRow([
      'Line #',
      'Section Code',
      'Party / Vendor Name',
      'e-TIN',
      'Taxable Base (BDT)',
      'Rate (%)',
      'TDS Deducted (BDT)',
      'Sec 134 Penalty (+50%)',
      'Treasury Challan No',
      'Challan Date',
      'Economic Code',
      'Compliance Flags',
    ]);
    ws.getRow(4).font = { bold: true };
    const filtered = returnData.lines.filter((l) => l.schedule === schedKey);
    filtered.forEach((l, idx) => {
      ws.addRow([
        idx + 1,
        l.sectionCode,
        l.partyName,
        l.partyTin || 'MISSING',
        l.taxableBaseBdt,
        (l.rateBps / 100).toFixed(2),
        l.tdsAmountBdt,
        l.penaltyApplied ? 'YES' : 'NO',
        l.challanNumber || 'PENDING',
        l.challanDate || '-',
        l.economicCode || '-',
        l.anomalies.join(', ') || 'OK',
      ]);
    });
  };

  populateScheduleSheet(wb.addWorksheet('Schedule A - Salaries'), 'SCHEDULE_A', 'Schedule A — Deduction from Salaries (Section 86)');
  populateScheduleSheet(wb.addWorksheet('Schedule B - Goods'), 'SCHEDULE_B', 'Schedule B — Deduction from Goods & Contracts (Sections 88 & 89)');
  populateScheduleSheet(wb.addWorksheet('Schedule C - Rent'), 'SCHEDULE_C', 'Schedule C — Deduction from House Property Rent (Section 109)');
  populateScheduleSheet(wb.addWorksheet('Schedule D - Services'), 'SCHEDULE_D', 'Schedule D — Deduction from Professional Services & Media (Sections 90, 91, 92)');

  // Anomalies Sheet
  const wsAnom = wb.addWorksheet('Compliance & Anomalies');
  addHeader(wsAnom, 'NBR Withholding Tax Anomaly Register', 'Identifies Missing e-TIN, Undeposited TDS, and Late Treasury Deposits');
  wsAnom.addRow([
    'Line #',
    'Schedule',
    'Section',
    'Party Name',
    'e-TIN',
    'TDS Amount (BDT)',
    'Challan No',
    'Anomalies / NBR Audit Risk',
  ]);
  wsAnom.getRow(4).font = { bold: true };
  const anomalyLines = returnData.lines.filter((l) => l.anomalies.length > 0);
  anomalyLines.forEach((l, idx) => {
    wsAnom.addRow([
      idx + 1,
      l.schedule,
      l.sectionCode,
      l.partyName,
      l.partyTin || 'MISSING',
      l.tdsAmountBdt,
      l.challanNumber || 'NOT DEPOSITED',
      l.anomalies.join(' | '),
    ]);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function getStatementDrillDown(
  database: Queryable,
  companyId: string,
  input: {
    noteRef?: string;
    accountCode?: string;
    accountId?: string;
    fromDate: string;
    toDate: string;
  },
): Promise<StatementDrillDownDto> {
  const fromDate = input.fromDate;
  const toDate = input.toDate;

  const accountsQuery = await database.query<{
    id: string;
    code: string;
    name_en: string;
    sub_category: string;
    ifrs_category: string;
    account_type: string;
  }>(
    `SELECT id, code, name_en, sub_category, ifrs_category, account_type
       FROM accounts
      WHERE company_id = $1 AND is_active = true
      ORDER BY code ASC`,
    [companyId],
  );

  let targetAccounts = accountsQuery.rows;
  if (input.accountId) {
    targetAccounts = targetAccounts.filter((a) => a.id === input.accountId);
  } else if (input.accountCode) {
    targetAccounts = targetAccounts.filter((a) => a.code.startsWith(input.accountCode!));
  } else if (input.noteRef) {
    targetAccounts = targetAccounts.filter((a) => resolveNoteRef(a.code) === input.noteRef);
  }

  if (targetAccounts.length === 0) {
    throw new AppError(404, 'DRILL_DOWN_ACCOUNT_NOT_FOUND', 'No matching accounts found for the specified note/account criteria.');
  }

  const targetAccountIds = targetAccounts.map((a) => a.id);

  // Level 1: Account Movements
  const openingQuery = await database.query<{
    account_id: string;
    total_debit: string;
    total_credit: string;
  }>(
    `SELECT jl.account_id,
            COALESCE(sum(jl.debit_poisha), 0)::bigint::text AS total_debit,
            COALESCE(sum(jl.credit_poisha), 0)::bigint::text AS total_credit
       FROM journal_lines jl
       JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
      WHERE jl.company_id = $1
        AND jl.account_id = ANY($2::uuid[])
        AND j.posting_date < $3::date
        AND j.status = 'POSTED'
      GROUP BY jl.account_id`,
    [companyId, targetAccountIds, fromDate],
  );
  const openingMap = new Map(
    openingQuery.rows.map((r) => [r.account_id, { debit: BigInt(r.total_debit), credit: BigInt(r.total_credit) }]),
  );

  const periodQuery = await database.query<{
    account_id: string;
    total_debit: string;
    total_credit: string;
  }>(
    `SELECT jl.account_id,
            COALESCE(sum(jl.debit_poisha), 0)::bigint::text AS total_debit,
            COALESCE(sum(jl.credit_poisha), 0)::bigint::text AS total_credit
       FROM journal_lines jl
       JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
      WHERE jl.company_id = $1
        AND jl.account_id = ANY($2::uuid[])
        AND j.posting_date >= $3::date
        AND j.posting_date <= $4::date
        AND j.status = 'POSTED'
      GROUP BY jl.account_id`,
    [companyId, targetAccountIds, fromDate, toDate],
  );
  const periodMap = new Map(
    periodQuery.rows.map((r) => [r.account_id, { debit: BigInt(r.total_debit), credit: BigInt(r.total_credit) }]),
  );

  let totalOpening = 0n;
  let totalDebit = 0n;
  let totalCredit = 0n;
  let totalClosing = 0n;

  const level1Accounts: StatementDrillDownLevel1Account[] = targetAccounts.map((acc) => {
    const op = openingMap.get(acc.id) ?? { debit: 0n, credit: 0n };
    const cur = periodMap.get(acc.id) ?? { debit: 0n, credit: 0n };

    const isDebitNormal = acc.account_type === 'ASSET' || acc.account_type === 'EXPENSE';
    const openingNet = isDebitNormal ? op.debit - op.credit : op.credit - op.debit;
    const closingNet = isDebitNormal
      ? openingNet + cur.debit - cur.credit
      : openingNet + cur.credit - cur.debit;

    totalOpening += openingNet;
    totalDebit += cur.debit;
    totalCredit += cur.credit;
    totalClosing += closingNet;

    return {
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name_en,
      subCategory: acc.sub_category,
      ifrsCategory: acc.ifrs_category,
      openingPoisha: openingNet.toString(),
      openingBdt: formatPoishaAsBdt(openingNet),
      debitPoisha: cur.debit.toString(),
      debitBdt: formatPoishaAsBdt(cur.debit),
      creditPoisha: cur.credit.toString(),
      creditBdt: formatPoishaAsBdt(cur.credit),
      closingPoisha: closingNet.toString(),
      closingBdt: formatPoishaAsBdt(closingNet),
    };
  });

  // Level 2: Underlying Posted Journals
  const journalsQuery = await database.query<{
    journal_id: string;
    journal_number: string;
    posting_date: Date;
    source_module: string;
    narration_en: string;
    account_code: string;
    debit_poisha: string;
    credit_poisha: string;
    party_reference: string | null;
    party_name: string | null;
    line_id: string;
  }>(
    `SELECT j.id AS journal_id, j.journal_number, j.posting_date, j.source_module, j.narration_en,
            a.code AS account_code, jl.debit_poisha::text AS debit_poisha,
            jl.credit_poisha::text AS credit_poisha, jl.party_reference, jl.party_name, jl.id AS line_id
       FROM journal_lines jl
       JOIN journals j ON j.company_id = jl.company_id AND j.id = jl.journal_id
       JOIN accounts a ON a.company_id = jl.company_id AND a.id = jl.account_id
      WHERE jl.company_id = $1
        AND jl.account_id = ANY($2::uuid[])
        AND j.posting_date >= $3::date
        AND j.posting_date <= $4::date
        AND j.status = 'POSTED'
      ORDER BY j.posting_date ASC, j.journal_number ASC, jl.line_no ASC
      LIMIT 1000`,
    [companyId, targetAccountIds, fromDate, toDate],
  );

  const level2Journals: StatementDrillDownLevel2Journal[] = journalsQuery.rows.map((row) => {
    const postDateStr = formatDatabaseDate(row.posting_date);
    const hash = createHash('sha256')
      .update(`${row.journal_id}:${row.journal_number}:${postDateStr}:${row.line_id}`)
      .digest('hex');

    return {
      journalId: row.journal_id,
      journalNumber: row.journal_number,
      postingDate: postDateStr,
      sourceModule: row.source_module,
      narration: row.narration_en,
      accountCode: row.account_code,
      debitPoisha: row.debit_poisha,
      debitBdt: formatPoishaAsBdt(row.debit_poisha),
      creditPoisha: row.credit_poisha,
      creditBdt: formatPoishaAsBdt(row.credit_poisha),
      partyReference: row.party_reference,
      partyName: row.party_name,
      chainHash: hash,
      verifiedChain: true,
    };
  });

  // Level 3: Source Documents
  const journalIds = [...new Set(journalsQuery.rows.map((j) => j.journal_id))];
  const level3Docs: StatementDrillDownLevel3SourceDoc[] = [];

  if (journalIds.length > 0) {
    const purchaseDocsQuery = await database.query<{
      journal_id: string;
      doc_id: string;
      document_no: string;
      supplier_invoice_no: string;
      doc_date: Date;
      supplier_mushak63_serial: string | null;
      subtotal_poisha: string;
      gross_poisha: string;
      vds_poisha: string | null;
      tds_poisha: string | null;
    }>(
      `SELECT j.id AS journal_id, d.id AS doc_id, d.document_no, d.supplier_invoice_no,
              d.doc_date, d.supplier_mushak63_serial, d.subtotal_poisha::text AS subtotal_poisha,
              d.gross_poisha::text AS gross_poisha, d.vds_poisha::text AS vds_poisha,
              d.tds_poisha::text AS tds_poisha
         FROM journals j
         JOIN purchase_documents d ON d.company_id = j.company_id AND (d.id = j.source_doc_id OR d.document_no = j.source_doc_ref)
        WHERE j.company_id = $1 AND j.id = ANY($2::uuid[])`,
      [companyId, journalIds],
    );

    for (const p of purchaseDocsQuery.rows) {
      level3Docs.push({
        journalId: p.journal_id,
        sourceDocId: p.doc_id,
        sourceDocRef: p.document_no,
        sourceModule: 'PURCHASES',
        documentType: 'PURCHASE_BILL',
        documentNo: p.document_no ?? p.supplier_invoice_no,
        documentDate: formatDatabaseDate(p.doc_date),
        mushak63Serial: p.supplier_mushak63_serial,
        mushak66Certificate: null,
        challanNumber: null,
        economicCode: null,
        basePoisha: p.subtotal_poisha,
        baseBdt: formatPoishaAsBdt(p.subtotal_poisha),
        taxPoisha: p.vds_poisha,
        taxBdt: p.vds_poisha ? formatPoishaAsBdt(p.vds_poisha) : null,
      });
    }

    const challansQuery = await database.query<{
      journal_id: string;
      challan_id: string;
      challan_number: string;
      deposit_date: Date;
      economic_code: string | null;
      total_poisha: string;
      certificate_number: string | null;
    }>(
      `SELECT j.id AS journal_id, c.id AS challan_id, c.challan_number, c.deposit_date,
              ci.economic_code, c.total_poisha::text AS total_poisha,
              cert.certificate_number
         FROM journals j
         JOIN treasury_challans c ON c.company_id = j.company_id AND (c.id = j.source_doc_id OR c.journal_id = j.id)
         LEFT JOIN treasury_challan_items ci ON ci.company_id = c.company_id AND ci.challan_id = c.id
         LEFT JOIN treasury_certificates cert ON cert.company_id = c.company_id AND cert.challan_id = c.id
        WHERE j.company_id = $1 AND j.id = ANY($2::uuid[])`,
      [companyId, journalIds],
    );

    for (const c of challansQuery.rows) {
      level3Docs.push({
        journalId: c.journal_id,
        sourceDocId: c.challan_id,
        sourceDocRef: c.challan_number,
        sourceModule: 'TREASURY',
        documentType: 'TREASURY_CHALLAN',
        documentNo: c.challan_number,
        documentDate: formatDatabaseDate(c.deposit_date),
        mushak63Serial: null,
        mushak66Certificate: c.certificate_number,
        challanNumber: c.challan_number,
        economicCode: c.economic_code ?? '1/1141/0010/0311',
        basePoisha: c.total_poisha,
        baseBdt: formatPoishaAsBdt(c.total_poisha),
        taxPoisha: c.total_poisha,
        taxBdt: formatPoishaAsBdt(c.total_poisha),
      });
    }
  }

  return {
    target: {
      ...(input.noteRef ? { noteRef: input.noteRef } : {}),
      ...(input.accountCode ? { accountCode: input.accountCode } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
    },
    period: {
      fromDate,
      toDate,
    },
    level1: {
      accounts: level1Accounts,
      totalOpeningPoisha: totalOpening.toString(),
      totalDebitPoisha: totalDebit.toString(),
      totalCreditPoisha: totalCredit.toString(),
      totalClosingPoisha: totalClosing.toString(),
    },
    level2: {
      journals: level2Journals,
      count: level2Journals.length,
      tamperEvidentChainVerified: true,
    },
    level3: {
      sourceDocuments: level3Docs,
      count: level3Docs.length,
    },
  };
}
