import { apiRequest } from '../auth/api';

export type StatutoryBody = 'NBR_VAT' | 'NBR_TAX' | 'RJSC' | 'MOLE';
export type ComplianceCategory =
  | 'VAT_91'
  | 'VDS_DEPOSIT'
  | 'TDS_MONTHLY'
  | 'TDS_177'
  | 'AIT_Q'
  | 'ANNUAL_TAX'
  | 'RJSC_ANNUAL';
export type ComplianceStatus = 'PENDING' | 'PREPARED' | 'FILED' | 'OVERDUE';

export interface ComplianceCalendarEvent {
  id: string;
  companyId: string;
  branchId: string | null;
  periodId: string | null;
  fiscalYearId: string;
  titleEn: string;
  titleBn: string;
  statutoryBody: StatutoryBody;
  category: ComplianceCategory;
  statutoryDeadline: string; // YYYY-MM-DD
  adjustedDeadline: string; // YYYY-MM-DD
  estimatedLiabilityPoisha: string;
  status: ComplianceStatus;
  autoLockPeriodOnExpiry: boolean;
  filedAt: string | null;
  filingReference: string | null;
  challanId: string | null;
  assignedUserId: string | null;
  notes: string | null;
  isShifted: boolean;
  shiftDays: number;
  daysRemaining: number;
  shiftCallout: string | null;
  periodLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GazettedHoliday {
  id: string;
  companyId: string | null;
  holidayDate: string; // YYYY-MM-DD
  nameEn: string;
  nameBn: string;
  holidayType: string;
  isConfirmed: boolean;
}

export interface ComplianceSummary {
  nextDeadline: ComplianceCalendarEvent | null;
  totalWithheldPendingDepositPoisha: string;
  holidayShiftedCount: number;
  filedOnTimeRate: number;
  counts: {
    total: number;
    pending: number;
    prepared: number;
    filed: number;
    overdue: number;
  };
}

export interface ComplianceEventsQuery {
  fiscalYearId?: string;
  periodId?: string;
  category?: ComplianceCategory;
  status?: ComplianceStatus;
  statutoryBody?: StatutoryBody;
  from?: string;
  to?: string;
}

export interface FileComplianceEventPayload {
  filingReference: string;
  notes?: string | null;
  lockPeriod?: boolean;
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

export const complianceApi = {
  getSummary: (companyId: string) =>
    apiRequest<{ summary: ComplianceSummary }>(`/companies/${companyId}/compliance/summary`),

  listEvents: (companyId: string, query: ComplianceEventsQuery = {}) =>
    apiRequest<{ events: ComplianceCalendarEvent[] }>(
      `/companies/${companyId}/compliance/events${queryString(query as Record<string, string | number | undefined>)}`,
    ),

  generateSchedule: (companyId: string, fiscalYearId?: string) =>
    apiRequest<{ generatedCount: number; events: ComplianceCalendarEvent[] }>(
      `/companies/${companyId}/compliance/generate`,
      {
        method: 'POST',
        body: fiscalYearId ? { fiscalYearId } : {},
      },
    ),

  fileEvent: (companyId: string, eventId: string, payload: FileComplianceEventPayload) =>
    apiRequest<{ event: ComplianceCalendarEvent }>(`/companies/${companyId}/compliance/events/${eventId}/file`, {
      method: 'POST',
      body: payload,
    }),

  listHolidays: (companyId: string) =>
    apiRequest<{ holidays: GazettedHoliday[] }>(`/companies/${companyId}/compliance/holidays`),
};
