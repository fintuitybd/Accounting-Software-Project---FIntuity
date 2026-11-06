import { apiRequest, ApiError, API_BASE } from '../auth/api';

export type CloseRunStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED';

export interface CloseCheck {
  key: string;
  labelEn: string;
  labelBn: string;
  passed: boolean;
  applicable: boolean;
  blocking: boolean;
  differencePoisha: string | null;
  detailEn: string;
  detailBn: string;
  evidence: Record<string, unknown>;
}

export interface CloseException {
  code: string;
  severity: 'WARNING' | 'BLOCKER';
  messageEn: string;
  messageBn: string;
  amountPoisha: string | null;
  documentCount: number | null;
}

export interface CloseRunEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CloseRun {
  id: string;
  companyId: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  periodStatus: 'OPEN' | 'CLOSED' | 'LOCKED';
  status: CloseRunStatus;
  preparedBy: string;
  preparedByName: string;
  preparedAt: string;
  submittedBy: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  evidenceReference: string;
  evidenceNote: string | null;
  snapshotHash: string | null;
  reopenedBy: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  checks: CloseCheck[];
  exceptions: CloseException[];
  createdAt: string;
  updatedAt: string;
  events: CloseRunEvent[];
}

export interface SuspenseAccount {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountType: string;
}

export interface SuspenseItem {
  lineId: string;
  journalId: string;
  journalNumber: string | null;
  postingDate: string;
  ageDays: number;
  narration: string;
  suspenseAccountId: string;
  suspenseAccountCode: string;
  suspenseAccountName: string;
  direction: 'DEBIT' | 'CREDIT';
  amountPoisha: string;
  amountBdt: string;
  createdBy: string | null;
  createdByName: string | null;
}

export interface SuspenseResolution {
  id: string;
  companyId: string;
  periodId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'POSTED';
  sourceJournalId: string;
  sourceJournalNumber: string | null;
  sourceLineId: string;
  suspenseAccountId: string;
  suspenseAccountCode: string;
  amountPoisha: string;
  amountBdt: string;
  targetAccountId: string;
  targetAccountCode: string;
  targetAccountName: string;
  reason: string;
  attachmentReference: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  journalId: string | null;
  journalNumber: string | null;
}

export interface SuspenseOverview {
  accounts: SuspenseAccount[];
  items: SuspenseItem[];
  requests: SuspenseResolution[];
}

async function downloadCsv(path: string): Promise<{ text: string; filename: string | null }> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'text/csv' },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      typeof payload?.code === 'string' ? payload.code : 'EXPORT_FAILED',
      typeof payload?.message === 'string' ? payload.message : 'The export could not be generated.',
      { details: payload?.details },
    );
  }
  return {
    text: await response.text(),
    filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? null,
  };
}

export const closeApi = {
  list: (companyId: string, periodId?: string) =>
    apiRequest<{ closeRuns: CloseRun[] }>(
      `/companies/${companyId}/close-runs${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ''}`,
    ),
  get: (companyId: string, runId: string) =>
    apiRequest<{ closeRun: CloseRun }>(`/companies/${companyId}/close-runs/${runId}`),
  create: (companyId: string, periodId: string) =>
    apiRequest<{ closeRun: CloseRun }>(`/companies/${companyId}/close-runs`, {
      method: 'POST',
      body: { periodId },
    }),
  refresh: (companyId: string, runId: string) =>
    apiRequest<{ closeRun: CloseRun }>(`/companies/${companyId}/close-runs/${runId}/refresh`, {
      method: 'POST',
    }),
  submit: (companyId: string, runId: string, evidenceReference: string, evidenceNote?: string) =>
    apiRequest<{ closeRun: CloseRun }>(`/companies/${companyId}/close-runs/${runId}/submit`, {
      method: 'POST',
      body: { evidenceReference, evidenceNote: evidenceNote || null },
    }),
  decide: (companyId: string, runId: string, decision: 'APPROVE' | 'REJECT', reason: string) =>
    apiRequest<{ closeRun: CloseRun }>(`/companies/${companyId}/close-runs/${runId}/decide`, {
      method: 'POST',
      body: { decision, reason },
    }),
  reopen: (companyId: string, periodId: string, reason: string) =>
    apiRequest<{ periodId: string; status: 'OPEN' }>(`/companies/${companyId}/periods/${periodId}/reopen`, {
      method: 'POST',
      body: { reason },
    }),
  exportPack: (companyId: string, runId: string) =>
    downloadCsv(`/companies/${companyId}/close-runs/${runId}/pack.csv`),
  suspense: (companyId: string) =>
    apiRequest<{ suspense: SuspenseOverview }>(`/companies/${companyId}/suspense`),
  requestSuspense: (
    companyId: string,
    input: { sourceLineId: string; targetAccountId: string; reason: string; attachmentReference: string },
  ) =>
    apiRequest<{ resolution: SuspenseResolution }>(`/companies/${companyId}/suspense/resolutions`, {
      method: 'POST',
      body: input,
    }),
  decideSuspense: (
    companyId: string,
    resolutionId: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
  ) =>
    apiRequest<{ resolution: SuspenseResolution }>(
      `/companies/${companyId}/suspense/resolutions/${resolutionId}/decide`,
      { method: 'POST', body: { decision, reason } },
    ),
};
