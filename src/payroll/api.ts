import { apiRequest } from '../auth/api';

export type WorkerClassification =
  | 'PERMANENT'
  | 'PROBATIONARY'
  | 'CONTRACTUAL'
  | 'PIECE_RATE'
  | 'APPRENTICE';

export type PaymentChannel = 'BANK' | 'BKASH' | 'NAGAD' | 'CASH';

export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'DISBURSED';

export interface PayrollEmployee {
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

export interface PayrollRunLine {
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

export interface PayrollRun {
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
  lines?: PayrollRunLine[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeePayload {
  branchId?: string | null;
  employeeCode: string;
  nameEn: string;
  nameBn?: string | null;
  workerClassification: WorkerClassification;
  nidNumber?: string | null;
  etin?: string | null;
  joiningDate: string;
  basicSalaryPoisha: string;
  hraPoisha: string;
  medicalPoisha: string;
  conveyancePoisha: string;
  pfEnrolled?: boolean;
  pfRateBps?: number;
  paymentChannel?: PaymentChannel;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankRoutingNumber?: string | null;
  mfsNumber?: string | null;
}

export interface UpdateEmployeePayload extends Partial<CreateEmployeePayload> {
  status?: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
}

export interface ComputePayrollPayload {
  periodId: string;
  batchDate: string;
  includeFestivalBonus?: boolean;
  adjustments?: Array<{
    employeeId: string;
    otHoursScaled?: number;
    festivalBonusPoisha?: string;
    tdsPoisha?: string;
  }>;
}

function queryString(query: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const payrollApi = {
  listEmployees: (companyId: string, query: { status?: string; branchId?: string } = {}) =>
    apiRequest<{ employees: PayrollEmployee[] }>(
      `/companies/${companyId}/payroll/employees${queryString(query)}`,
    ),

  getEmployee: (companyId: string, employeeId: string) =>
    apiRequest<{ employee: PayrollEmployee }>(
      `/companies/${companyId}/payroll/employees/${employeeId}`,
    ),

  createEmployee: (companyId: string, payload: CreateEmployeePayload) =>
    apiRequest<{ employee: PayrollEmployee }>(`/companies/${companyId}/payroll/employees`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateEmployee: (companyId: string, employeeId: string, payload: UpdateEmployeePayload) =>
    apiRequest<{ employee: PayrollEmployee }>(
      `/companies/${companyId}/payroll/employees/${employeeId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    ),

  listRuns: (companyId: string) =>
    apiRequest<{ runs: PayrollRun[] }>(`/companies/${companyId}/payroll/runs`),

  getRun: (companyId: string, runId: string) =>
    apiRequest<{ run: PayrollRun }>(`/companies/${companyId}/payroll/runs/${runId}`),

  computeOrSaveDraft: (companyId: string, payload: ComputePayrollPayload) =>
    apiRequest<{ run: PayrollRun }>(`/companies/${companyId}/payroll/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  approveRun: (companyId: string, runId: string) =>
    apiRequest<{ run: PayrollRun }>(`/companies/${companyId}/payroll/runs/${runId}/approve`, {
      method: 'POST',
    }),

  postRun: (companyId: string, runId: string) =>
    apiRequest<{ run: PayrollRun; journalId: string }>(
      `/companies/${companyId}/payroll/runs/${runId}/post`,
      {
        method: 'POST',
      },
    ),

  disburseRun: (companyId: string, runId: string) =>
    apiRequest<{ run: PayrollRun }>(`/companies/${companyId}/payroll/runs/${runId}/disburse`, {
      method: 'POST',
    }),

  getBeftn128Url: (companyId: string, runId: string) =>
    `/api/v1/companies/${companyId}/payroll/runs/${runId}/export/beftn-128`,

  getBeftnCsvUrl: (companyId: string, runId: string) =>
    `/api/v1/companies/${companyId}/payroll/runs/${runId}/export/beftn-csv`,

  getMfsCsvUrl: (companyId: string, runId: string, provider: 'BKASH' | 'NAGAD' = 'BKASH') =>
    `/api/v1/companies/${companyId}/payroll/runs/${runId}/export/mfs-csv?provider=${provider}`,
};
