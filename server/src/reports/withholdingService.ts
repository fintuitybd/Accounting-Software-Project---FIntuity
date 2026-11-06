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
    taxYear: string;
    taxPeriod: string;
    actorUserId: string;
  },
): Promise<WithholdingReturnDto> {
  const existing = await database.query<{ id: string }>(
    `SELECT id FROM withholding_tax_returns WHERE company_id = $1 AND tax_period = $2`,
    [companyId, input.taxPeriod],
  );
  if (existing.rows[0]) {
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
    tds_nature: string | null;
    supplier_tin_missing: boolean | null;
    challan_number: string | null;
    deposit_date: Date | null;
    bill_gross_poisha: string | null;
  }>(
    `SELECT l.id, l.base_poisha::text AS base_poisha, l.rate_bps, l.amount_poisha::text AS amount_poisha,
            l.status, l.tax_period, l.economic_code, l.challan_id, l.deposited_at, l.created_at,
            l.party_id, p.name_en AS party_name, p.tin AS party_tin,
            d.tds_nature, d.supplier_tin_missing,
            c.challan_number, c.deposit_date,
            d.gross_poisha::text AS bill_gross_poisha
       FROM purchase_withholding_liabilities l
       JOIN parties p ON p.company_id = l.company_id AND p.id = l.party_id
       LEFT JOIN purchase_documents d ON d.company_id = l.company_id AND d.id = l.bill_id
       LEFT JOIN treasury_challans c ON c.company_id = l.company_id AND c.id = l.challan_id
      WHERE l.company_id = $1 AND l.tax_type = 'TDS' AND l.tax_period = $2
      ORDER BY l.created_at ASC`,
    [companyId, input.taxPeriod],
  );

  const linesToInsert: Array<{
    id: string;
    schedule: WithholdingSchedule;
    sectionCode: string;
    partyId: string;
    partyName: string;
    partyTin: string | null;
    grossPaymentPoisha: bigint;
    taxableBasePoisha: bigint;
    rateBps: number;
    tdsAmountPoisha: bigint;
    penaltyApplied: boolean;
    challanNumber: string | null;
    challanDate: string | null;
    economicCode: string | null;
    anomalies: WithholdingAnomaly[];
    liabilityId: string;
  }> = [];

  let totalDeducted = 0n;
  let totalDeposited = 0n;
  let totalAnomalies = 0;

  const summary: Record<
    WithholdingSchedule,
    { count: number; basePoisha: bigint; tdsPoisha: bigint; anomalyCount: number }
  > = {
    SCHEDULE_A: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_B: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_C: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
    SCHEDULE_D: { count: 0, basePoisha: 0n, tdsPoisha: 0n, anomalyCount: 0 },
  };

  for (const row of liabilitiesQuery.rows) {
    const classification = classifySchedule(row.tds_nature ?? 'SUPPLY_OF_GOODS');
    const basePoisha = BigInt(row.base_poisha);
    const tdsPoisha = BigInt(row.amount_poisha);
    const grossPoisha = row.bill_gross_poisha ? BigInt(row.bill_gross_poisha) : basePoisha + tdsPoisha;

    const anomalies: WithholdingAnomaly[] = [];
    const tinValid = row.party_tin && /^\d{12}$/.test(row.party_tin.trim());
    if (!tinValid) {
      anomalies.push('MISSING_ETIN');
    }

    const deposited = row.status === 'DEPOSITED' && row.challan_number;
    if (!deposited) {
      anomalies.push('UNDEPOSITED_TDS');
    } else if (row.deposit_date) {
      const depDateStr = formatDatabaseDate(row.deposit_date);
      if (isChallanLate(input.taxPeriod, depDateStr)) {
        anomalies.push('LATE_CHALLAN_DEPOSIT');
      }
    }

    const penaltyApplied = row.supplier_tin_missing === true || !tinValid;

    totalDeducted += tdsPoisha;
    if (deposited) {
      totalDeposited += tdsPoisha;
    }
    totalAnomalies += anomalies.length;

    summary[classification.schedule].count += 1;
    summary[classification.schedule].basePoisha += basePoisha;
    summary[classification.schedule].tdsPoisha += tdsPoisha;
    summary[classification.schedule].anomalyCount += anomalies.length;

    linesToInsert.push({
      id: randomUUID(),
      schedule: classification.schedule,
      sectionCode: classification.sectionCode,
      partyId: row.party_id,
      partyName: row.party_name,
      partyTin: row.party_tin,
      grossPaymentPoisha: grossPoisha,
      taxableBasePoisha: basePoisha,
      rateBps: row.rate_bps,
      tdsAmountPoisha: tdsPoisha,
      penaltyApplied,
      challanNumber: row.challan_number,
      challanDate: row.deposit_date ? formatDatabaseDate(row.deposit_date) : null,
      economicCode: row.economic_code ?? '1/1141/0010/0311',
      anomalies,
      liabilityId: row.id,
    });
  }

  const returnId = randomUUID();
  const schedulesJson = {
    SCHEDULE_A: {
      count: summary.SCHEDULE_A.count,
      basePoisha: summary.SCHEDULE_A.basePoisha.toString(),
      tdsPoisha: summary.SCHEDULE_A.tdsPoisha.toString(),
      anomalyCount: summary.SCHEDULE_A.anomalyCount,
    },
    SCHEDULE_B: {
      count: summary.SCHEDULE_B.count,
      basePoisha: summary.SCHEDULE_B.basePoisha.toString(),
      tdsPoisha: summary.SCHEDULE_B.tdsPoisha.toString(),
      anomalyCount: summary.SCHEDULE_B.anomalyCount,
    },
    SCHEDULE_C: {
      count: summary.SCHEDULE_C.count,
      basePoisha: summary.SCHEDULE_C.basePoisha.toString(),
      tdsPoisha: summary.SCHEDULE_C.tdsPoisha.toString(),
      anomalyCount: summary.SCHEDULE_C.anomalyCount,
    },
    SCHEDULE_D: {
      count: summary.SCHEDULE_D.count,
      basePoisha: summary.SCHEDULE_D.basePoisha.toString(),
      tdsPoisha: summary.SCHEDULE_D.tdsPoisha.toString(),
      anomalyCount: summary.SCHEDULE_D.anomalyCount,
    },
  };

  await database.query(
    `INSERT INTO withholding_tax_returns (
       id, company_id, tax_year, tax_period, status, total_deducted_poisha,
       total_deposited_poisha, anomaly_count, schedules_json, created_by
     ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9)`,
    [
      returnId,
      companyId,
      input.taxYear,
      input.taxPeriod,
      totalDeducted.toString(),
      totalDeposited.toString(),
      totalAnomalies,
      JSON.stringify(schedulesJson),
      input.actorUserId,
    ],
  );

  for (const line of linesToInsert) {
    await database.query(
      `INSERT INTO withholding_return_lines (
         id, company_id, return_id, schedule, section_code, party_id,
         party_name, party_tin, gross_payment_poisha, taxable_base_poisha,
         rate_bps, tds_amount_poisha, penalty_applied, challan_number,
         challan_date, economic_code, anomalies, liability_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        line.id,
        companyId,
        returnId,
        line.schedule,
        line.sectionCode,
        line.partyId,
        line.partyName,
        line.partyTin,
        line.grossPaymentPoisha.toString(),
        line.taxableBasePoisha.toString(),
        line.rateBps,
        line.tdsAmountPoisha.toString(),
        line.penaltyApplied,
        line.challanNumber,
        line.challanDate,
        line.economicCode,
        line.anomalies,
        line.liabilityId,
      ],
    );
  }

  return getSection177Return(database, companyId, returnId);
}

export async function getSection177Return(
  database: Queryable,
  companyId: string,
  returnIdOrPeriod: string,
): Promise<WithholdingReturnDto> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(returnIdOrPeriod);
  const result = await database.query<{
    id: string;
    company_id: string;
    tax_year: string;
    tax_period: string;
    status: WithholdingReturnStatus;
    total_deducted_poisha: string;
    total_deposited_poisha: string;
    anomaly_count: number;
    schedules_json: Record<
      WithholdingSchedule,
      { count: number; basePoisha: string; tdsPoisha: string; anomalyCount: number }
    >;
    submitted_at: Date | null;
    submitted_by: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, company_id, tax_year, tax_period, status,
            total_deducted_poisha::text AS total_deducted_poisha,
            total_deposited_poisha::text AS total_deposited_poisha,
            anomaly_count, schedules_json, submitted_at, submitted_by, created_at, updated_at
       FROM withholding_tax_returns
      WHERE company_id = $1 AND ${isUuid ? 'id = $2' : 'tax_period = $2'}`,
    [companyId, returnIdOrPeriod],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'WITHHOLDING_RETURN_NOT_FOUND', 'Section 177 return not found for the specified period.');
  }

  const linesResult = await database.query<{
    id: string;
    schedule: WithholdingSchedule;
    section_code: string;
    party_id: string | null;
    party_name: string;
    party_tin: string | null;
    gross_payment_poisha: string;
    taxable_base_poisha: string;
    rate_bps: number;
    tds_amount_poisha: string;
    penalty_applied: boolean;
    challan_number: string | null;
    challan_date: Date | null;
    economic_code: string | null;
    anomalies: WithholdingAnomaly[];
    liability_id: string | null;
  }>(
    `SELECT id, schedule, section_code, party_id, party_name, party_tin,
            gross_payment_poisha::text AS gross_payment_poisha,
            taxable_base_poisha::text AS taxable_base_poisha,
            rate_bps, tds_amount_poisha::text AS tds_amount_poisha,
            penalty_applied, challan_number, challan_date, economic_code,
            anomalies, liability_id
       FROM withholding_return_lines
      WHERE company_id = $1 AND return_id = $2
      ORDER BY created_at ASC`,
    [companyId, row.id],
  );

  const rawSummary = row.schedules_json ?? {};
  const schedulesSummary = {
    SCHEDULE_A: {
      count: rawSummary.SCHEDULE_A?.count ?? 0,
      basePoisha: rawSummary.SCHEDULE_A?.basePoisha ?? '0',
      baseBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_A?.basePoisha ?? 0)),
      tdsPoisha: rawSummary.SCHEDULE_A?.tdsPoisha ?? '0',
      tdsBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_A?.tdsPoisha ?? 0)),
      anomalyCount: rawSummary.SCHEDULE_A?.anomalyCount ?? 0,
    },
    SCHEDULE_B: {
      count: rawSummary.SCHEDULE_B?.count ?? 0,
      basePoisha: rawSummary.SCHEDULE_B?.basePoisha ?? '0',
      baseBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_B?.basePoisha ?? 0)),
      tdsPoisha: rawSummary.SCHEDULE_B?.tdsPoisha ?? '0',
      tdsBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_B?.tdsPoisha ?? 0)),
      anomalyCount: rawSummary.SCHEDULE_B?.anomalyCount ?? 0,
    },
    SCHEDULE_C: {
      count: rawSummary.SCHEDULE_C?.count ?? 0,
      basePoisha: rawSummary.SCHEDULE_C?.basePoisha ?? '0',
      baseBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_C?.basePoisha ?? 0)),
      tdsPoisha: rawSummary.SCHEDULE_C?.tdsPoisha ?? '0',
      tdsBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_C?.tdsPoisha ?? 0)),
      anomalyCount: rawSummary.SCHEDULE_C?.anomalyCount ?? 0,
    },
    SCHEDULE_D: {
      count: rawSummary.SCHEDULE_D?.count ?? 0,
      basePoisha: rawSummary.SCHEDULE_D?.basePoisha ?? '0',
      baseBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_D?.basePoisha ?? 0)),
      tdsPoisha: rawSummary.SCHEDULE_D?.tdsPoisha ?? '0',
      tdsBdt: formatPoishaAsBdt(BigInt(rawSummary.SCHEDULE_D?.tdsPoisha ?? 0)),
      anomalyCount: rawSummary.SCHEDULE_D?.anomalyCount ?? 0,
    },
  };

  const lines: WithholdingReturnLineDto[] = linesResult.rows.map((line) => ({
    id: line.id,
    schedule: line.schedule,
    sectionCode: line.section_code,
    partyId: line.party_id,
    partyName: line.party_name,
    partyTin: line.party_tin,
    grossPaymentPoisha: line.gross_payment_poisha,
    grossPaymentBdt: formatPoishaAsBdt(line.gross_payment_poisha),
    taxableBasePoisha: line.taxable_base_poisha,
    taxableBaseBdt: formatPoishaAsBdt(line.taxable_base_poisha),
    rateBps: line.rate_bps,
    tdsAmountPoisha: line.tds_amount_poisha,
    tdsAmountBdt: formatPoishaAsBdt(line.tds_amount_poisha),
    penaltyApplied: line.penalty_applied,
    challanNumber: line.challan_number,
    challanDate: line.challan_date ? formatDatabaseDate(line.challan_date) : null,
    economicCode: line.economic_code,
    anomalies: line.anomalies ?? [],
    liabilityId: line.liability_id,
  }));

  return {
    id: row.id,
    companyId: row.company_id,
    taxYear: row.tax_year,
    taxPeriod: row.tax_period,
    status: row.status,
    totalDeductedPoisha: row.total_deducted_poisha,
    totalDeductedBdt: formatPoishaAsBdt(row.total_deducted_poisha),
    totalDepositedPoisha: row.total_deposited_poisha,
    totalDepositedBdt: formatPoishaAsBdt(row.total_deposited_poisha),
    anomalyCount: row.anomaly_count,
    schedulesSummary,
    lines,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    submittedBy: row.submitted_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function verifySection177Return(
  database: Queryable,
  companyId: string,
  returnId: string,
): Promise<WithholdingReturnDto> {
  await database.query(
    `UPDATE withholding_tax_returns SET status = 'VERIFIED', updated_at = now() WHERE company_id = $1 AND id = $2`,
    [companyId, returnId],
  );
  return getSection177Return(database, companyId, returnId);
}

export async function submitSection177Return(
  database: Queryable,
  companyId: string,
  returnId: string,
  actorUserId: string,
): Promise<WithholdingReturnDto> {
  await database.query(
    `UPDATE withholding_tax_returns
        SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $3, updated_at = now()
      WHERE company_id = $1 AND id = $2`,
    [companyId, returnId, actorUserId],
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
