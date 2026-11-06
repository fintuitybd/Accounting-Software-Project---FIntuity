import { apiRequest, ApiError, API_BASE } from '../auth/api';

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  sessionId: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  entityType?: string;
  actorUserId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function queryString(query: AuditQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const auditApi = {
  list: (companyId: string, query: AuditQuery) =>
    apiRequest<{ entries: AuditEvent[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/audit-events${queryString(query)}`,
    ),
  exportCsv: async (companyId: string, query: AuditQuery): Promise<{ text: string; filename: string | null }> => {
    const response = await fetch(`${API_BASE}/companies/${companyId}/audit-events/export.csv${queryString(query)}`, {
      credentials: 'include',
      headers: { accept: 'text/csv' },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        typeof payload?.code === 'string' ? payload.code : 'AUDIT_EXPORT_FAILED',
        typeof payload?.message === 'string' ? payload.message : 'The audit export could not be generated.',
        { details: payload?.details },
      );
    }
    return {
      text: await response.text(),
      filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? null,
    };
  },
};
