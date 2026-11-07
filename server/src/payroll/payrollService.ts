import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { formatDatabaseDate, isValidIsoDate } from '../company/dates.ts';
import { formatPoishaAsBdt, parseBdtToPoisha } from '../company/money.ts';
import { postSystemJournalWithinTransaction } from '../ledger/ledgerService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const WORKER_CLASSIFICATIONS = [
  'PERMANENT',
  'PROBATIONARY',
  'CONTRACTUAL',
  'PIECE_RATE',
  'APPRENTICE',
] as const;
export type WorkerClassification = (typeof WORKER_CLASSIFICATIONS)[number];

export const PAYMENT_CHANNELS = ['BANK', 'BKASH', 'NAGAD', 'CASH'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYROLL_RUN_STATUSES = ['DRAFT', 'APPROVED', 'POSTED', 'DISBURSED'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const STATUTORY_DIVISOR_HOURS = 208; // Monthly statutory hours under Bangladesh Labour Act 2026 Section 108
export const DEFAULT_PF_RATE_BPS = 1000; // 10.00% Provident Fund rate under Section 264
export const DEFAULT_FESTIVAL_BONUS_BPS = 1000; // 10.00% of basic under SRO 53-Law/2026

export interface PayrollEmployeeDto {
  id: string;
  companyId: string;
  branchId: string | null;
  employeeCode: string;
  nameEn: string;
  nameBn: string | null;
  workerClassification: WorkerClassification;
  nidNumber: string | null;
  etin: string | null;
  joiningDate: string;
  basicSalaryPoisha: string;
  basicSalaryBdt: string;
  hraPoisha: string;
  hraBdt: string;
  medicalPoisha: string;
  medicalBdt: string;
  conveyancePoisha: string;
  conveyanceBdt: string;
  pfEnrolled: boolean;
  pfRateBps: number;
  paymentChannel: PaymentChannel;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  mfsNumber: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunLineDto {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string;
  employeeNameEn: string;
  employeeNameBn: string | null;
  workerClassification: WorkerClassification;
  paymentChannel: PaymentChannel;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  mfsNumber: string | null;
  etin: string | null;
  basicPoisha: string;
  basicBdt: string;
  hraPoisha: string;
  hraBdt: string;
  medicalPoisha: string;
  medicalBdt: string;
  conveyancePoisha: string;
  conveyanceBdt: string;
  otHoursScaled: number; // e.g. 150 = 1.50 hrs
  otHoursFormatted: string;
  otAmountPoisha: string;
  otAmountBdt: string;
  festivalBonusPoisha: string;
  festivalBonusBdt: string;
  grossPayPoisha: string;
  grossPayBdt: string;
  pfEmployeePoisha: string;
  pfEmployeeBdt: string;
  pfEmployerPoisha: string;
  pfEmployerBdt: string;
  tdsPoisha: string;
  tdsBdt: string;
  netPayPoisha: string;
  netPayBdt: string;
}

export interface PayrollRunDto {
  id: string;
  companyId: string;
  periodId: string;
  periodCode?: string;
  batchDate: string;
  totalBasicPoisha: string;
  totalBasicBdt: string;
  totalGrossPoisha: string;
  totalGrossBdt: string;
  totalOtPoisha: string;
  totalOtBdt: string;
  totalBonusPoisha: string;
  totalBonusBdt: string;
  totalTdsPoisha: string;
  totalTdsBdt: string;
  totalPfEmployeePoisha: string;
  totalPfEmployeeBdt: string;
  totalPfEmployerPoisha: string;
  totalPfEmployerBdt: string;
  netPayablePoisha: string;
  netPayableBdt: string;
  status: PayrollRunStatus;
  journalId: string | null;
  journalNumber?: string | null;
  approvedBy: string | null;
  approvedByName?: string | null;
  approvedAt: string | null;
  postedBy: string | null;
  postedByName?: string | null;
  postedAt: string | null;
  linesCount: number;
  lines?: PayrollRunLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  companyId: string;
  userId: string;
  branchId?: string | null;
  employeeCode: string;
  nameEn: string;
  nameBn?: string | null;
  workerClassification: WorkerClassification;
  nidNumber?: string | null;
  etin?: string | null;
  joiningDate: string;
  basicSalaryPoisha: bigint;
  hraPoisha: bigint;
  medicalPoisha: bigint;
  conveyancePoisha: bigint;
  pfEnrolled?: boolean;
  pfRateBps?: number;
  paymentChannel?: PaymentChannel;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankRoutingNumber?: string | null;
  mfsNumber?: string | null;
}

export interface UpdateEmployeeInput extends Partial<CreateEmployeeInput> {
  id: string;
  companyId: string;
  userId: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
}

export interface ComputePayrollInput {
  companyId: string;
  userId: string;
  periodId: string;
  batchDate: string;
  includeFestivalBonus?: boolean;
  adjustments?: Array<{
    employeeId: string;
    otHoursScaled?: number;
    festivalBonusPoisha?: bigint;
    tdsPoisha?: bigint;
  }>;
}

/**
 * Section 108 Overtime Formula (208 Statutory Hours Divisor, 2x Basic Rate):
 * For basicSalaryPoisha (B) and otHoursScaled (H_scaled, where 100 = 1.00 hr):
 * otAmountPoisha = floor((B * H_scaled) / 10400n)
 */
export function calculateOvertimePoisha(basicSalaryPoisha: bigint, otHoursScaled: number): bigint {
  if (basicSalaryPoisha <= 0n || otHoursScaled <= 0) return 0n;
  const hScaled = BigInt(Math.max(0, Math.floor(otHoursScaled)));
  return (basicSalaryPoisha * hScaled) / 10400n;
}

/**
 * Section 264 Provident Fund (10% Employee + 10% Employer Match):
 * pfEmployeePoisha = floor((B * pfRateBps) / 10000n)
 * pfEmployerPoisha = pfEmployeePoisha
 */
export function calculatePfPoisha(
  basicSalaryPoisha: bigint,
  pfRateBps: number = DEFAULT_PF_RATE_BPS,
  pfEnrolled: boolean = true,
): { pfEmployeePoisha: bigint; pfEmployerPoisha: bigint } {
  if (!pfEnrolled || basicSalaryPoisha <= 0n || pfRateBps <= 0) {
    return { pfEmployeePoisha: 0n, pfEmployerPoisha: 0n };
  }
  const match = (basicSalaryPoisha * BigInt(pfRateBps)) / 10000n;
  return { pfEmployeePoisha: match, pfEmployerPoisha: match };
}

export function formatBeftn128Record(line: {
  employeeCode: string;
  beneficiaryName: string;
  routingNumber: string;
  accountNumber: string;
  amountPoisha: bigint;
  traceNumber: number;
}): string {
  const recordType = '6';
  const txCode = '22'; // Demand Credit
  const cleanRouting = (line.routingNumber || '').replace(/\D/g, '').padEnd(9, '0').slice(0, 9);
  const cleanAccount = (line.accountNumber || '').trim().slice(0, 17).padEnd(17, ' ');
  const amountStr = line.amountPoisha.toString().padStart(10, '0').slice(0, 10);
  const empId = (line.employeeCode || '').trim().slice(0, 15).padEnd(15, ' ');
  const cleanName = (line.beneficiaryName || '').trim().slice(0, 22).padEnd(22, ' ');
  const discData = '01';
  const addendaInd = '0';
  const trace = String(line.traceNumber).padStart(15, '0').slice(0, 15);

  const baseRecord = `${recordType}${txCode}${cleanRouting}${cleanAccount}${amountStr}${empId}${cleanName}${discData}${addendaInd}${trace}`;
  return baseRecord.padEnd(128, ' ');
}

// -----------------------------------------------------------------------------
// Database Mapping Helpers
// -----------------------------------------------------------------------------

function mapEmployee(row: any): PayrollEmployeeDto {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    employeeCode: row.employee_code,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    workerClassification: row.worker_classification as WorkerClassification,
    nidNumber: row.nid_number,
    etin: row.etin,
    joiningDate: formatDatabaseDate(row.joining_date),
    basicSalaryPoisha: row.basic_salary_poisha.toString(),
    basicSalaryBdt: formatPoishaAsBdt(row.basic_salary_poisha),
    hraPoisha: row.hra_poisha.toString(),
    hraBdt: formatPoishaAsBdt(row.hra_poisha),
    medicalPoisha: row.medical_poisha.toString(),
    medicalBdt: formatPoishaAsBdt(row.medical_poisha),
    conveyancePoisha: row.conveyance_poisha.toString(),
    conveyanceBdt: formatPoishaAsBdt(row.conveyance_poisha),
    pfEnrolled: Boolean(row.pf_enrolled),
    pfRateBps: row.pf_rate_bps,
    paymentChannel: row.payment_channel as PaymentChannel,
    bankName: row.bank_name,
    bankAccountNumber: row.bank_account_number,
    bankRoutingNumber: row.bank_routing_number,
    mfsNumber: row.mfs_number,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRunLine(row: any): PayrollRunLineDto {
  const otScaled = row.ot_hours_scaled ?? 0;
  return {
    id: row.id,
    runId: row.run_id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    employeeNameEn: row.employee_name_en ?? row.name_en,
    employeeNameBn: row.employee_name_bn ?? row.name_bn,
    workerClassification: (row.worker_classification ?? 'PERMANENT') as WorkerClassification,
    paymentChannel: (row.payment_channel ?? 'BANK') as PaymentChannel,
    bankName: row.bank_name,
    bankAccountNumber: row.bank_account_number,
    bankRoutingNumber: row.bank_routing_number,
    mfsNumber: row.mfs_number,
    etin: row.etin,
    basicPoisha: row.basic_poisha.toString(),
    basicBdt: formatPoishaAsBdt(row.basic_poisha),
    hraPoisha: row.hra_poisha.toString(),
    hraBdt: formatPoishaAsBdt(row.hra_poisha),
    medicalPoisha: row.medical_poisha.toString(),
    medicalBdt: formatPoishaAsBdt(row.medical_poisha),
    conveyancePoisha: row.conveyance_poisha.toString(),
    conveyanceBdt: formatPoishaAsBdt(row.conveyance_poisha),
    otHoursScaled: otScaled,
    otHoursFormatted: (otScaled / 100).toFixed(2),
    otAmountPoisha: row.ot_amount_poisha.toString(),
    otAmountBdt: formatPoishaAsBdt(row.ot_amount_poisha),
    festivalBonusPoisha: row.festival_bonus_poisha.toString(),
    festivalBonusBdt: formatPoishaAsBdt(row.festival_bonus_poisha),
    grossPayPoisha: row.gross_pay_poisha.toString(),
    grossPayBdt: formatPoishaAsBdt(row.gross_pay_poisha),
    pfEmployeePoisha: row.pf_employee_poisha.toString(),
    pfEmployeeBdt: formatPoishaAsBdt(row.pf_employee_poisha),
    pfEmployerPoisha: row.pf_employer_poisha.toString(),
    pfEmployerBdt: formatPoishaAsBdt(row.pf_employer_poisha),
    tdsPoisha: row.tds_poisha.toString(),
    tdsBdt: formatPoishaAsBdt(row.tds_poisha),
    netPayPoisha: row.net_pay_poisha.toString(),
    netPayBdt: formatPoishaAsBdt(row.net_pay_poisha),
  };
}

function mapRun(row: any, lines?: PayrollRunLineDto[]): PayrollRunDto {
  return {
    id: row.id,
    companyId: row.company_id,
    periodId: row.period_id,
    periodCode: row.period_code,
    batchDate: formatDatabaseDate(row.batch_date),
    totalBasicPoisha: row.total_basic_poisha.toString(),
    totalBasicBdt: formatPoishaAsBdt(row.total_basic_poisha),
    totalGrossPoisha: row.total_gross_poisha.toString(),
    totalGrossBdt: formatPoishaAsBdt(row.total_gross_poisha),
    totalOtPoisha: row.total_ot_poisha.toString(),
    totalOtBdt: formatPoishaAsBdt(row.total_ot_poisha),
    totalBonusPoisha: row.total_bonus_poisha.toString(),
    totalBonusBdt: formatPoishaAsBdt(row.total_bonus_poisha),
    totalTdsPoisha: row.total_tds_poisha.toString(),
    totalTdsBdt: formatPoishaAsBdt(row.total_tds_poisha),
    totalPfEmployeePoisha: row.total_pf_employee_poisha.toString(),
    totalPfEmployeeBdt: formatPoishaAsBdt(row.total_pf_employee_poisha),
    totalPfEmployerPoisha: row.total_pf_employer_poisha.toString(),
    totalPfEmployerBdt: formatPoishaAsBdt(row.total_pf_employer_poisha),
    netPayablePoisha: row.net_payable_poisha.toString(),
    netPayableBdt: formatPoishaAsBdt(row.net_payable_poisha),
    status: row.status as PayrollRunStatus,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    postedBy: row.posted_by,
    postedByName: row.posted_by_name,
    postedAt: row.posted_at ? row.posted_at.toISOString() : null,
    linesCount: Number(row.lines_count ?? lines?.length ?? 0),
    lines,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Chart of Accounts Payroll Auto-Resolution & Helpers
// -----------------------------------------------------------------------------

async function getCompanyOrgId(client: Queryable, companyId: string): Promise<string> {
  const res = await client.query<{ organisation_id: string }>(
    `SELECT organisation_id FROM companies WHERE id = $1`,
    [companyId],
  );
  if (!res.rows[0]) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return res.rows[0].organisation_id;
}

async function ensurePayrollAccounts(client: PoolClient, companyId: string): Promise<Record<string, string>> {
  const accountDefs = [
    { code: '5310', nameEn: 'Salaries & Wages Expense', nameBn: 'বেতন ও মজুরি ব্যয়', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', ifrsCategory: 'OPERATING', controlSubledger: 'NONE' },
    { code: '5320', nameEn: 'Overtime Allowance Expense', nameBn: 'ওভারটাইম ভাতা ব্যয়', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', ifrsCategory: 'OPERATING', controlSubledger: 'NONE' },
    { code: '5330', nameEn: 'Festival Bonus Expense', nameBn: 'উৎসব ভাতা ব্যয়', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', ifrsCategory: 'OPERATING', controlSubledger: 'NONE' },
    { code: '5340', nameEn: 'Employer PF Contribution Expense', nameBn: 'নিয়োগকর্তার পিএফ অনুদান ব্যয়', accountType: 'EXPENSE', subCategory: 'OPERATING_EXPENSE', ifrsCategory: 'OPERATING', controlSubledger: 'NONE' },
    { code: '2141', nameEn: 'Salary TDS Payable', nameBn: 'বেতন টিডিএস প্রদেয়', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', ifrsCategory: 'NA_BALANCE_SHEET', controlSubledger: 'TDS_PAYABLE' },
    { code: '2150', nameEn: 'Provident Fund Payable', nameBn: 'ভবিষ্য তহবিল প্রদেয়', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', ifrsCategory: 'NA_BALANCE_SHEET', controlSubledger: 'NONE' },
    { code: '2160', nameEn: 'Net Salaries Payable', nameBn: 'নিট প্রদেয় বেতন', accountType: 'LIABILITY', subCategory: 'CURRENT_LIABILITY', ifrsCategory: 'NA_BALANCE_SHEET', controlSubledger: 'NONE' },
  ];

  const existing = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM accounts WHERE company_id = $1 AND code = ANY($2)`,
    [companyId, accountDefs.map((a) => a.code)],
  );

  const accountMap: Record<string, string> = {};
  for (const row of existing.rows) {
    accountMap[row.code] = row.id;
  }

  for (const def of accountDefs) {
    if (!accountMap[def.code]) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO accounts (
           company_id, code, name_en, name_bn, account_type, sub_category,
           ifrs_category, control_subledger, currency, tax_mapping_json, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BDT', '{}', true)
         ON CONFLICT (company_id, code) DO UPDATE SET is_active = true
         RETURNING id`,
        [companyId, def.code, def.nameEn, def.nameBn, def.accountType, def.subCategory, def.ifrsCategory, def.controlSubledger],
      );
      accountMap[def.code] = ins.rows[0]!.id;
    }
  }

  return accountMap;
}

// -----------------------------------------------------------------------------
// Employee CRUD Service
// -----------------------------------------------------------------------------

export async function listEmployees(
  database: Queryable,
  companyId: string,
  options: { status?: string; branchId?: string } = {},
): Promise<PayrollEmployeeDto[]> {
  const conditions = ['company_id = $1'];
  const values: any[] = [companyId];

  if (options.status) {
    values.push(options.status);
    conditions.push(`status = $${values.length}`);
  }
  if (options.branchId) {
    values.push(options.branchId);
    conditions.push(`branch_id = $${values.length}`);
  }

  const query = `
    SELECT id, company_id, branch_id, employee_code, name_en, name_bn,
           worker_classification, nid_number, etin, joining_date,
           basic_salary_poisha, hra_poisha, medical_poisha, conveyance_poisha,
           pf_enrolled, pf_rate_bps, payment_channel, bank_name,
           bank_account_number, bank_routing_number, mfs_number, status,
           created_at, updated_at
      FROM payroll_employees
     WHERE ${conditions.join(' AND ')}
     ORDER BY employee_code ASC
  `;

  const result = await database.query(query, values);
  return result.rows.map(mapEmployee);
}

export async function getEmployee(
  database: Queryable,
  companyId: string,
  employeeId: string,
): Promise<PayrollEmployeeDto | null> {
  const result = await database.query(
    `SELECT * FROM payroll_employees WHERE company_id = $1 AND id = $2`,
    [companyId, employeeId],
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

export async function createEmployee(
  pool: Pool,
  input: CreateEmployeeInput,
): Promise<PayrollEmployeeDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query(
      `SELECT id FROM payroll_employees WHERE company_id = $1 AND employee_code = $2`,
      [input.companyId, input.employeeCode],
    );
    if (existing.rows[0]) {
      throw new AppError(409, 'EMPLOYEE_CODE_EXISTS', `Employee code ${input.employeeCode} already exists.`);
    }

    const res = await client.query(
      `INSERT INTO payroll_employees (
         company_id, branch_id, employee_code, name_en, name_bn,
         worker_classification, nid_number, etin, joining_date,
         basic_salary_poisha, hra_poisha, medical_poisha, conveyance_poisha,
         pf_enrolled, pf_rate_bps, payment_channel, bank_name,
         bank_account_number, bank_routing_number, mfs_number, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'ACTIVE')
       RETURNING *`,
      [
        input.companyId,
        input.branchId ?? null,
        input.employeeCode.trim().toUpperCase(),
        input.nameEn.trim(),
        input.nameBn?.trim() ?? null,
        input.workerClassification,
        input.nidNumber?.trim() ?? null,
        input.etin?.trim() ?? null,
        input.joiningDate,
        input.basicSalaryPoisha.toString(),
        input.hraPoisha.toString(),
        input.medicalPoisha.toString(),
        input.conveyancePoisha.toString(),
        input.pfEnrolled ?? true,
        input.pfRateBps ?? DEFAULT_PF_RATE_BPS,
        input.paymentChannel ?? 'BANK',
        input.bankName?.trim() ?? null,
        input.bankAccountNumber?.trim() ?? null,
        input.bankRoutingNumber?.trim() ?? null,
        input.mfsNumber?.trim() ?? null,
      ],
    );

    const emp = mapEmployee(res.rows[0]);
    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.employee_created',
      entityType: 'payroll_employees',
      entityId: emp.id,
      after: { employeeCode: emp.employeeCode, nameEn: emp.nameEn },
    });
    return emp;
  });
}

export async function updateEmployee(
  pool: Pool,
  input: UpdateEmployeeInput,
): Promise<PayrollEmployeeDto> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query(
      `SELECT * FROM payroll_employees WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.id],
    );
    if (!existing.rows[0]) {
      throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee was not found.');
    }
    const current = existing.rows[0];

    const updated = await client.query(
      `UPDATE payroll_employees
          SET branch_id = $3,
              employee_code = $4,
              name_en = $5,
              name_bn = $6,
              worker_classification = $7,
              nid_number = $8,
              etin = $9,
              joining_date = $10,
              basic_salary_poisha = $11,
              hra_poisha = $12,
              medical_poisha = $13,
              conveyance_poisha = $14,
              pf_enrolled = $15,
              pf_rate_bps = $16,
              payment_channel = $17,
              bank_name = $18,
              bank_account_number = $19,
              bank_routing_number = $20,
              mfs_number = $21,
              status = $22,
              updated_at = now()
        WHERE company_id = $1 AND id = $2
        RETURNING *`,
      [
        input.companyId,
        input.id,
        input.branchId !== undefined ? input.branchId : current.branch_id,
        input.employeeCode !== undefined ? input.employeeCode.trim().toUpperCase() : current.employee_code,
        input.nameEn !== undefined ? input.nameEn.trim() : current.name_en,
        input.nameBn !== undefined ? input.nameBn?.trim() ?? null : current.name_bn,
        input.workerClassification !== undefined ? input.workerClassification : current.worker_classification,
        input.nidNumber !== undefined ? input.nidNumber?.trim() ?? null : current.nid_number,
        input.etin !== undefined ? input.etin?.trim() ?? null : current.etin,
        input.joiningDate !== undefined ? input.joiningDate : current.joining_date,
        input.basicSalaryPoisha !== undefined ? input.basicSalaryPoisha.toString() : current.basic_salary_poisha,
        input.hraPoisha !== undefined ? input.hraPoisha.toString() : current.hra_poisha,
        input.medicalPoisha !== undefined ? input.medicalPoisha.toString() : current.medical_poisha,
        input.conveyancePoisha !== undefined ? input.conveyancePoisha.toString() : current.conveyance_poisha,
        input.pfEnrolled !== undefined ? input.pfEnrolled : current.pf_enrolled,
        input.pfRateBps !== undefined ? input.pfRateBps : current.pf_rate_bps,
        input.paymentChannel !== undefined ? input.paymentChannel : current.payment_channel,
        input.bankName !== undefined ? input.bankName?.trim() ?? null : current.bank_name,
        input.bankAccountNumber !== undefined ? input.bankAccountNumber?.trim() ?? null : current.bank_account_number,
        input.bankRoutingNumber !== undefined ? input.bankRoutingNumber?.trim() ?? null : current.bank_routing_number,
        input.mfsNumber !== undefined ? input.mfsNumber?.trim() ?? null : current.mfs_number,
        input.status !== undefined ? input.status : current.status,
      ],
    );

    const emp = mapEmployee(updated.rows[0]);
    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.employee_updated',
      entityType: 'payroll_employees',
      entityId: emp.id,
      after: { employeeCode: emp.employeeCode },
    });
    return emp;
  });
}

// -----------------------------------------------------------------------------
// Payroll Runs & Calculations
// -----------------------------------------------------------------------------

export async function listPayrollRuns(
  database: Queryable,
  companyId: string,
): Promise<PayrollRunDto[]> {
  const query = `
    SELECT r.*, p.code AS period_code, j.journal_number,
           u_app.name AS approved_by_name, u_pos.name AS posted_by_name,
           (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.company_id = r.company_id AND l.run_id = r.id) AS lines_count
      FROM payroll_runs r
      JOIN periods p ON p.company_id = r.company_id AND p.id = r.period_id
      LEFT JOIN journals j ON j.company_id = r.company_id AND j.id = r.journal_id
      LEFT JOIN users u_app ON u_app.id = r.approved_by
      LEFT JOIN users u_pos ON u_pos.id = r.posted_by
     WHERE r.company_id = $1
     ORDER BY r.batch_date DESC, r.created_at DESC
  `;
  const result = await database.query(query, [companyId]);
  return result.rows.map((row) => mapRun(row));
}

export async function getPayrollRun(
  database: Queryable,
  companyId: string,
  runId: string,
): Promise<PayrollRunDto | null> {
  const runRes = await database.query(
    `SELECT r.*, p.code AS period_code, j.journal_number,
            u_app.name AS approved_by_name, u_pos.name AS posted_by_name
       FROM payroll_runs r
       JOIN periods p ON p.company_id = r.company_id AND p.id = r.period_id
       LEFT JOIN journals j ON j.company_id = r.company_id AND j.id = r.journal_id
       LEFT JOIN users u_app ON u_app.id = r.approved_by
       LEFT JOIN users u_pos ON u_pos.id = r.posted_by
      WHERE r.company_id = $1 AND r.id = $2`,
    [companyId, runId],
  );
  if (!runRes.rows[0]) return null;

  const linesRes = await database.query(
    `SELECT l.*, e.employee_code, e.name_en AS employee_name_en, e.name_bn AS employee_name_bn,
            e.worker_classification, e.payment_channel, e.bank_name, e.bank_account_number,
            e.bank_routing_number, e.mfs_number, e.etin
       FROM payroll_run_lines l
       JOIN payroll_employees e ON e.company_id = l.company_id AND e.id = l.employee_id
      WHERE l.company_id = $1 AND l.run_id = $2
      ORDER BY e.employee_code ASC`,
    [companyId, runId],
  );

  const lines = linesRes.rows.map(mapRunLine);
  return mapRun(runRes.rows[0], lines);
}

export async function computeOrSavePayrollDraft(
  pool: Pool,
  input: ComputePayrollInput,
): Promise<PayrollRunDto> {
  return withTransaction(pool, async (client) => {
    // 1. Period verification
    const periodRes = await client.query(
      `SELECT id, code AS period_code, status, start_date, end_date FROM periods WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.periodId],
    );
    if (!periodRes.rows[0]) {
      throw new AppError(404, 'PERIOD_NOT_FOUND', 'Fiscal period was not found.');
    }
    const period = periodRes.rows[0];
    if (period.status !== 'OPEN') {
      throw new AppError(409, 'PERIOD_LOCKED', `Cannot create or edit payroll for locked period ${period.period_code}.`);
    }

    // 2. Existing run check
    const existingRunRes = await client.query(
      `SELECT id, status FROM payroll_runs WHERE company_id = $1 AND period_id = $2 FOR UPDATE`,
      [input.companyId, input.periodId],
    );
    const existingRun = existingRunRes.rows[0];
    if (existingRun && (existingRun.status === 'POSTED' || existingRun.status === 'DISBURSED')) {
      throw new AppError(409, 'PAYROLL_ALREADY_POSTED', 'Payroll for this period has already been posted to the General Ledger.');
    }

    // 3. Load active employees
    const employeesRes = await client.query(
      `SELECT * FROM payroll_employees WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY employee_code ASC`,
      [input.companyId],
    );
    if (employeesRes.rows.length === 0) {
      throw new AppError(400, 'NO_ACTIVE_EMPLOYEES', 'There are no active employees on the register.');
    }

    // 4. Index adjustments by employeeId
    const adjustmentsMap = new Map<string, { otHoursScaled?: number; festivalBonusPoisha?: bigint; tdsPoisha?: bigint }>();
    if (input.adjustments) {
      for (const adj of input.adjustments) {
        adjustmentsMap.set(adj.employeeId, adj);
      }
    }

    // 5. Compute each employee line
    let totalBasic = 0n;
    let totalGross = 0n;
    let totalOt = 0n;
    let totalBonus = 0n;
    let totalTds = 0n;
    let totalPfEmployee = 0n;
    let totalPfEmployer = 0n;
    let netPayable = 0n;

    const computedLines = employeesRes.rows.map((emp) => {
      const basic = BigInt(emp.basic_salary_poisha);
      const hra = BigInt(emp.hra_poisha);
      const medical = BigInt(emp.medical_poisha);
      const conveyance = BigInt(emp.conveyance_poisha);

      const adj = adjustmentsMap.get(emp.id);
      const otHoursScaled = adj?.otHoursScaled ?? 0;
      const otAmount = calculateOvertimePoisha(basic, otHoursScaled);

      let festivalBonus = 0n;
      if (adj?.festivalBonusPoisha !== undefined) {
        festivalBonus = adj.festivalBonusPoisha;
      } else if (input.includeFestivalBonus) {
        festivalBonus = (basic * BigInt(DEFAULT_FESTIVAL_BONUS_BPS)) / 10000n;
      }

      const gross = basic + hra + medical + conveyance + otAmount + festivalBonus;

      const { pfEmployeePoisha, pfEmployerPoisha } = calculatePfPoisha(
        basic,
        emp.pf_rate_bps ?? DEFAULT_PF_RATE_BPS,
        Boolean(emp.pf_enrolled),
      );

      const tds = adj?.tdsPoisha !== undefined ? adj.tdsPoisha : 0n;
      const net = gross - pfEmployeePoisha - tds;
      if (net < 0n) {
        throw new AppError(400, 'NEGATIVE_NET_PAY', `Net pay for employee ${emp.employee_code} cannot be negative.`);
      }

      totalBasic += basic;
      totalGross += gross;
      totalOt += otAmount;
      totalBonus += festivalBonus;
      totalPfEmployee += pfEmployeePoisha;
      totalPfEmployer += pfEmployerPoisha;
      totalTds += tds;
      netPayable += net;

      return {
        employeeId: emp.id,
        basic,
        hra,
        medical,
        conveyance,
        otHoursScaled,
        otAmount,
        festivalBonus,
        gross,
        pfEmployeePoisha,
        pfEmployerPoisha,
        tds,
        net,
      };
    });

    const runId = existingRun ? existingRun.id : randomUUID();

    if (existingRun) {
      await client.query(
        `UPDATE payroll_runs
            SET batch_date = $3,
                total_basic_poisha = $4,
                total_gross_poisha = $5,
                total_ot_poisha = $6,
                total_bonus_poisha = $7,
                total_tds_poisha = $8,
                total_pf_employee_poisha = $9,
                total_pf_employer_poisha = $10,
                net_payable_poisha = $11,
                status = 'DRAFT',
                updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          runId,
          input.batchDate,
          totalBasic.toString(),
          totalGross.toString(),
          totalOt.toString(),
          totalBonus.toString(),
          totalTds.toString(),
          totalPfEmployee.toString(),
          totalPfEmployer.toString(),
          netPayable.toString(),
        ],
      );
      await client.query(`DELETE FROM payroll_run_lines WHERE company_id = $1 AND run_id = $2`, [input.companyId, runId]);
    } else {
      await client.query(
        `INSERT INTO payroll_runs (
           id, company_id, period_id, batch_date, total_basic_poisha, total_gross_poisha,
           total_ot_poisha, total_bonus_poisha, total_tds_poisha, total_pf_employee_poisha,
           total_pf_employer_poisha, net_payable_poisha, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT')`,
        [
          runId,
          input.companyId,
          input.periodId,
          input.batchDate,
          totalBasic.toString(),
          totalGross.toString(),
          totalOt.toString(),
          totalBonus.toString(),
          totalTds.toString(),
          totalPfEmployee.toString(),
          totalPfEmployer.toString(),
          netPayable.toString(),
        ],
      );
    }

    for (const line of computedLines) {
      await client.query(
        `INSERT INTO payroll_run_lines (
           id, company_id, run_id, employee_id, basic_poisha, hra_poisha, medical_poisha,
           conveyance_poisha, ot_hours_scaled, ot_amount_poisha, festival_bonus_poisha,
           gross_pay_poisha, pf_employee_poisha, pf_employer_poisha, tds_poisha, net_pay_poisha
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          randomUUID(),
          input.companyId,
          runId,
          line.employeeId,
          line.basic.toString(),
          line.hra.toString(),
          line.medical.toString(),
          line.conveyance.toString(),
          line.otHoursScaled,
          line.otAmount.toString(),
          line.festivalBonus.toString(),
          line.gross.toString(),
          line.pfEmployeePoisha.toString(),
          line.pfEmployerPoisha.toString(),
          line.tds.toString(),
          line.net.toString(),
        ],
      );
    }

    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.draft_saved',
      entityType: 'payroll_runs',
      entityId: runId,
      after: {
        periodCode: period.period_code,
        employeesCount: computedLines.length,
        netPayablePoisha: netPayable.toString(),
      },
    });

    const fullRun = await getPayrollRun(client, input.companyId, runId);
    return fullRun!;
  });
}

export async function approvePayrollRun(
  pool: Pool,
  input: { companyId: string; runId: string; userId: string },
): Promise<PayrollRunDto> {
  return withTransaction(pool, async (client) => {
    const runRes = await client.query(
      `SELECT id, status FROM payroll_runs WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    if (!runRes.rows[0]) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');
    if (runRes.rows[0].status !== 'DRAFT') {
      throw new AppError(409, 'INVALID_PAYROLL_STATUS', `Cannot approve payroll in ${runRes.rows[0].status} status.`);
    }

    await client.query(
      `UPDATE payroll_runs
          SET status = 'APPROVED',
              approved_by = $3,
              approved_at = now(),
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.runId, input.userId],
    );

    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.run_approved',
      entityType: 'payroll_runs',
      entityId: input.runId,
      after: { approvedBy: input.userId },
    });

    const updated = await getPayrollRun(client, input.companyId, input.runId);
    return updated!;
  });
}

/**
 * Atomic Payroll GL Journal Posting:
 * DR 5310 Salaries & Wages Expense: sum(grossPayPoisha - otAmountPoisha - festivalBonusPoisha)
 * DR 5320 Overtime Allowance Expense: sum(otAmountPoisha)
 * DR 5330 Festival Bonus Expense: sum(festivalBonusPoisha)
 * DR 5340 Employer PF Contribution Expense: sum(pfEmployerPoisha)
 * CR 2141 Salary TDS Payable (Economic Code 1/1141/0010/0112): sum(tdsPoisha)
 * CR 2150 Provident Fund Payable: sum(pfEmployeePoisha + pfEmployerPoisha)
 * CR 2160 Net Salaries Payable: sum(netPayPoisha)
 */
export async function postPayrollRun(
  pool: Pool,
  input: {
    companyId: string;
    runId: string;
    userId: string;
    sessionId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  },
): Promise<{ run: PayrollRunDto; journalId: string }> {
  return withTransaction(pool, async (client) => {
    // 1. Lock and load run
    const runRes = await client.query(
      `SELECT r.*, p.code AS period_code, p.end_date AS period_end_date
         FROM payroll_runs r
         JOIN periods p ON p.company_id = r.company_id AND p.id = r.period_id
        WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    if (!runRes.rows[0]) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');
    const run = runRes.rows[0];

    if (run.status === 'POSTED' || run.status === 'DISBURSED') {
      throw new AppError(409, 'PAYROLL_ALREADY_POSTED', 'This payroll run is already posted to the General Ledger.');
    }

    // 2. Load lines
    const linesRes = await client.query(
      `SELECT * FROM payroll_run_lines WHERE company_id = $1 AND run_id = $2`,
      [input.companyId, input.runId],
    );
    if (linesRes.rows.length === 0) {
      throw new AppError(400, 'PAYROLL_EMPTY', 'Payroll run contains no lines to post.');
    }

    // 3. Resolve accounts
    const accountMap = await ensurePayrollAccounts(client, input.companyId);

    // 4. Calculate journal legs
    let dr5310 = 0n; // Basic + HRA + Medical + Conveyance
    let dr5320 = 0n; // Overtime
    let dr5330 = 0n; // Festival bonus
    let dr5340 = 0n; // Employer PF
    let cr2141 = 0n; // Salary TDS
    let cr2150 = 0n; // Employee PF + Employer PF
    let cr2160 = 0n; // Net Payable

    for (const line of linesRes.rows) {
      const basic = BigInt(line.basic_poisha);
      const hra = BigInt(line.hra_poisha);
      const medical = BigInt(line.medical_poisha);
      const conveyance = BigInt(line.conveyance_poisha);
      const ot = BigInt(line.ot_amount_poisha);
      const bonus = BigInt(line.festival_bonus_poisha);
      const pfEmp = BigInt(line.pf_employee_poisha);
      const pfEmpr = BigInt(line.pf_employer_poisha);
      const tds = BigInt(line.tds_poisha);
      const net = BigInt(line.net_pay_poisha);

      dr5310 += basic + hra + medical + conveyance;
      dr5320 += ot;
      dr5330 += bonus;
      dr5340 += pfEmpr;

      cr2141 += tds;
      cr2150 += pfEmp + pfEmpr;
      cr2160 += net;
    }

    const totalDebits = dr5310 + dr5320 + dr5330 + dr5340;
    const totalCredits = cr2141 + cr2150 + cr2160;

    if (totalDebits !== totalCredits) {
      throw new AppError(
        500,
        'PAYROLL_JOURNAL_UNBALANCED',
        `Payroll journal debits (${totalDebits}) do not equal credits (${totalCredits}).`,
      );
    }

    const journalLines: Array<{ accountId: string; debit: string; credit: string; memo?: string }> = [];

    if (dr5310 > 0n) {
      journalLines.push({
        accountId: accountMap['5310']!,
        debit: dr5310.toString(),
        credit: '0',
        memo: 'Salaries & Wages Expense (Basic & Standard Allowances)',
      });
    }
    if (dr5320 > 0n) {
      journalLines.push({
        accountId: accountMap['5320']!,
        debit: dr5320.toString(),
        credit: '0',
        memo: 'Overtime Allowance Expense (Section 108 double-rate)',
      });
    }
    if (dr5330 > 0n) {
      journalLines.push({
        accountId: accountMap['5330']!,
        debit: dr5330.toString(),
        credit: '0',
        memo: 'Festival Bonus Expense (SRO 53-Law/2026)',
      });
    }
    if (dr5340 > 0n) {
      journalLines.push({
        accountId: accountMap['5340']!,
        debit: dr5340.toString(),
        credit: '0',
        memo: 'Employer PF Contribution Expense (Section 264)',
      });
    }
    if (cr2141 > 0n) {
      journalLines.push({
        accountId: accountMap['2141']!,
        debit: '0',
        credit: cr2141.toString(),
        memo: 'Salary TDS Payable (Section 86 / 1/1141/0010/0112)',
      });
    }
    if (cr2150 > 0n) {
      journalLines.push({
        accountId: accountMap['2150']!,
        debit: '0',
        credit: cr2150.toString(),
        memo: 'Provident Fund Payable (Employee 10% + Employer 10%)',
      });
    }
    if (cr2160 > 0n) {
      journalLines.push({
        accountId: accountMap['2160']!,
        debit: '0',
        credit: cr2160.toString(),
        memo: 'Net Salaries Payable (Bank & MFS Disbursement Queue)',
      });
    }

    const postingDate = formatDatabaseDate(run.batch_date);
    const orgId = await getCompanyOrgId(client, input.companyId);

    let resolvedSessionId = input.sessionId ?? null;
    if (!resolvedSessionId) {
      const sessRes = await client.query<{ id: string }>(
        `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [input.userId],
      );
      if (sessRes.rows[0]) {
        resolvedSessionId = sessRes.rows[0].id;
      }
    }

    const journal = await postSystemJournalWithinTransaction(client, {
      organisationId: orgId,
      actorUserId: input.userId,
      sessionId: (resolvedSessionId ?? null) as unknown as string,
      ip: input.ip ?? '127.0.0.1',
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? `req-payroll-${randomUUID()}`,
      companyId: input.companyId,
      date: postingDate,
      narration: `Payroll accrual for period ${run.period_code} — ${linesRes.rows.length} employees (Labour Act 2026 & SRO 53-Law/2026)`,
      sourceModule: 'PAYROLL',
      sourceDocId: run.id,
      sourceDocRef: `PAYROLL-${run.period_code}`,
      lines: journalLines,
    });

    await client.query(
      `UPDATE payroll_runs
          SET status = 'POSTED',
              journal_id = $3,
              posted_by = $4,
              posted_at = now(),
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.runId, journal.id, input.userId],
    );

    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.run_posted',
      entityType: 'payroll_runs',
      entityId: input.runId,
      after: {
        periodCode: run.period_code,
        journalId: journal.id,
        journalNumber: journal.journalNumber,
        totalDebitsPoisha: totalDebits.toString(),
      },
    });

    const updatedRun = await getPayrollRun(client, input.companyId, input.runId);
    return { run: updatedRun!, journalId: journal.id };
  });
}

export async function disbursePayrollRun(
  pool: Pool,
  input: { companyId: string; runId: string; userId: string },
): Promise<PayrollRunDto> {
  return withTransaction(pool, async (client) => {
    const runRes = await client.query(
      `SELECT id, status FROM payroll_runs WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [input.companyId, input.runId],
    );
    if (!runRes.rows[0]) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');
    if (runRes.rows[0].status !== 'POSTED') {
      throw new AppError(409, 'INVALID_PAYROLL_STATUS', 'Only posted payroll runs can be marked as disbursed.');
    }

    await client.query(
      `UPDATE payroll_runs
          SET status = 'DISBURSED',
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.runId],
    );

    const orgId = await getCompanyOrgId(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: orgId,
      companyId: input.companyId,
      actorUserId: input.userId,
      action: 'payroll.run_disbursed',
      entityType: 'payroll_runs',
      entityId: input.runId,
    });

    const updated = await getPayrollRun(client, input.companyId, input.runId);
    return updated!;
  });
}

// -----------------------------------------------------------------------------
// Payout File Exports (BEFTN 128, BEFTN CSV, MFS CSV)
// -----------------------------------------------------------------------------

export async function exportBeftn128(
  database: Queryable,
  companyId: string,
  runId: string,
): Promise<{ filename: string; content: string }> {
  const run = await getPayrollRun(database, companyId, runId);
  if (!run || !run.lines) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');

  const bankLines = run.lines.filter((l) => l.paymentChannel === 'BANK' && BigInt(l.netPayPoisha) > 0n);
  const rows: string[] = [];

  let traceNumber = 1;
  for (const line of bankLines) {
    const record = formatBeftn128Record({
      employeeCode: line.employeeCode,
      beneficiaryName: line.employeeNameEn,
      routingNumber: line.bankRoutingNumber ?? '000000000',
      accountNumber: line.bankAccountNumber ?? '',
      amountPoisha: BigInt(line.netPayPoisha),
      traceNumber,
    });
    rows.push(record);
    traceNumber++;
  }

  const content = rows.join('\r\n') + (rows.length > 0 ? '\r\n' : '');
  const filename = `BEFTN_128_${run.periodCode ?? run.batchDate}.txt`;
  return { filename, content };
}

export async function exportBeftnCsv(
  database: Queryable,
  companyId: string,
  runId: string,
): Promise<{ filename: string; content: string }> {
  const run = await getPayrollRun(database, companyId, runId);
  if (!run || !run.lines) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');

  const bankLines = run.lines.filter((l) => l.paymentChannel === 'BANK' && BigInt(l.netPayPoisha) > 0n);
  const header = 'Sl No,Employee Code,Beneficiary Name,Bank Name,Branch Name,Routing Number,Account Number,Amount (BDT),Payment Reference';
  const csvRows: string[] = [header];

  let sl = 1;
  for (const line of bankLines) {
    const nameEscaped = `"${(line.employeeNameEn || '').replace(/"/g, '""')}"`;
    const bankEscaped = `"${(line.bankName || 'BRAC Bank Ltd.').replace(/"/g, '""')}"`;
    const bdtAmount = (Number(line.netPayPoisha) / 100).toFixed(2);
    const ref = `"Salary ${run.periodCode ?? run.batchDate}"`;
    csvRows.push(
      `${sl},${line.employeeCode},${nameEscaped},${bankEscaped},"Main Branch",${line.bankRoutingNumber ?? ''},${line.bankAccountNumber ?? ''},${bdtAmount},${ref}`,
    );
    sl++;
  }

  const content = csvRows.join('\r\n');
  const filename = `BEFTN_PAYROLL_${run.periodCode ?? run.batchDate}.csv`;
  return { filename, content };
}

export async function exportMfsCsv(
  database: Queryable,
  companyId: string,
  runId: string,
  provider: 'BKASH' | 'NAGAD' = 'BKASH',
): Promise<{ filename: string; content: string }> {
  const run = await getPayrollRun(database, companyId, runId);
  if (!run || !run.lines) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');

  const mfsLines = run.lines.filter(
    (l) => l.paymentChannel === provider && BigInt(l.netPayPoisha) > 0n,
  );

  const header = 'MSISDN,Beneficiary Name,Amount (BDT),Reference,Purpose,Wallet Type';
  const csvRows: string[] = [header];

  for (const line of mfsLines) {
    const nameEscaped = `"${(line.employeeNameEn || '').replace(/"/g, '""')}"`;
    const bdtAmount = (Number(line.netPayPoisha) / 100).toFixed(2);
    const ref = `"PAY-${run.periodCode ?? run.batchDate}-${line.employeeCode}"`;
    const msisdn = (line.mfsNumber || '').replace(/\D/g, '');
    csvRows.push(`${msisdn},${nameEscaped},${bdtAmount},${ref},"Salary disbursement",${provider}`);
  }

  const content = csvRows.join('\r\n');
  const filename = `${provider}_PAYROLL_${run.periodCode ?? run.batchDate}.csv`;
  return { filename, content };
}
