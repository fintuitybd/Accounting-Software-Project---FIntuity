import type {
  InvitationDetails,
  MeResponse,
  SessionSummary,
  ServerPermission,
  ServerRole,
  TeamInvitation,
  TeamMember,
} from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { traceId?: string; fieldErrors?: Record<string, string[]>; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.traceId = options.traceId;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function dispatchAuthFailure(code: string): void {
  if (typeof window === 'undefined') return;
  if (code !== 'SESSION_EXPIRED' && code !== 'UNAUTHENTICATED') return;
  window.dispatchEvent(new CustomEvent('ledgervault:session-expired', { detail: { code } }));
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Extra request headers, e.g. Idempotency-Key for posting commands. */
  headers?: Record<string, string>;
  /** Set false for the login endpoint, where 401 means bad credentials, not an expired session. */
  authFailureEvent?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('lv_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = new ApiError(
      response.status,
      typeof payload?.code === 'string' ? payload.code : 'REQUEST_FAILED',
      typeof payload?.message === 'string' ? payload.message : 'The request could not be completed.',
      {
        ...(typeof payload?.traceId === 'string' ? { traceId: payload.traceId } : {}),
        ...(payload?.fieldErrors ? { fieldErrors: payload.fieldErrors as Record<string, string[]> } : {}),
        ...(payload?.details !== undefined ? { details: payload.details } : {}),
      },
    );
    if (options.authFailureEvent !== false) dispatchAuthFailure(error.code);
    throw error;
  }

  return payload as T;
}

export interface CreateInvitationPayload {
  email: string;
  role: ServerRole;
  companyIds: string[];
}

export const authApi = {
  me: () => apiRequest<MeResponse>('/auth/me', { authFailureEvent: false }),
  login: (email: string, password: string) =>
    apiRequest<MeResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      authFailureEvent: false,
    }),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      authFailureEvent: false,
    }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
      authFailureEvent: false,
    }),
  verifyEmail: (token: string) =>
    apiRequest<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: { token },
      authFailureEvent: false,
    }),
  resendVerification: () =>
    apiRequest<{ message: string }>('/auth/resend-verification', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  invitationDetails: (token: string) =>
    apiRequest<InvitationDetails>(`/auth/invitations/${encodeURIComponent(token)}`, {
      authFailureEvent: false,
    }),
  acceptInvitation: (token: string, input: { name?: string; password?: string }) =>
    apiRequest<MeResponse & { accepted: true }>('/auth/invitations/accept', {
      method: 'POST',
      body: { token, ...input },
      authFailureEvent: false,
    }),
  sessions: () => apiRequest<{ sessions: SessionSummary[] }>('/auth/sessions'),
  revokeSession: (sessionId: string) =>
    apiRequest<{ revoked: boolean; current: boolean }>(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  rotateCsrf: () => apiRequest<{ csrfToken: string }>('/auth/csrf', { method: 'POST', authFailureEvent: false }),
  setActiveCompany: (companyId: string) =>
    apiRequest<{ companyId: string; organisationId: string }>('/auth/active-company', {
      method: 'POST',
      body: { companyId },
    }),
  members: (organisationId: string) =>
    apiRequest<{ members: TeamMember[] }>(`/organisations/${organisationId}/members`),
  updateMember: (organisationId: string, userId: string, input: { role?: ServerRole; status?: string }) =>
    apiRequest<{ updated: boolean }>(`/organisations/${organisationId}/members/${userId}`, {
      method: 'PATCH',
      body: input,
    }),
  invitations: (organisationId: string) =>
    apiRequest<{ invitations: TeamInvitation[] }>(`/organisations/${organisationId}/invitations`),
  createInvitation: (organisationId: string, input: CreateInvitationPayload) =>
    apiRequest<{
      invitation: { id: string; email: string; role: ServerRole; expiresAt: string };
      reused: boolean;
      emailDelivered: boolean;
      message: string;
    }>(`/organisations/${organisationId}/invitations`, { method: 'POST', body: input }),
  resendInvitation: (organisationId: string, invitationId: string) =>
    apiRequest<{ resend: boolean; expiresAt: string; emailDelivered: boolean; message: string }>(
      `/organisations/${organisationId}/invitations/${invitationId}/resend`,
      { method: 'POST' },
    ),
  revokeInvitation: (organisationId: string, invitationId: string) =>
    apiRequest<{ revoked: boolean }>(`/organisations/${organisationId}/invitations/${invitationId}`, {
      method: 'DELETE',
    }),
};

export const ALL_SERVER_PERMISSIONS: readonly ServerPermission[] = [
  'MANAGE_COMPANY_SETTINGS',
  'MANAGE_MASTERS_AND_COA',
  'CREATE_COMMERCIAL_DRAFT',
  'DISPATCH_OR_RECEIVE_STOCK',
  'POST_TO_GL',
  'APPROVE_HIGH_VALUE',
  'OVERRIDE_3WAY_VARIANCE',
  'REVERSE_POSTED_JOURNAL',
  'SUBMIT_CLOSE_MAKER',
  'APPROVE_CLOSE_CHECKER',
  'MANAGE_USERS_AND_ORG',
  'VIEW_REPORTS',
  'VIEW_LIMITED_REPORTS',
  'EXPORT_DATA',
  'OVERRIDE_NEGATIVE_STOCK',
];
