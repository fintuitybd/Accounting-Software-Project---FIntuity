export type ServerRole = 'OWNER' | 'ADMIN' | 'CONTROLLER' | 'ACCOUNTANT' | 'OPERATOR' | 'AUDITOR';

export type ServerPermission =
  | 'MANAGE_COMPANY_SETTINGS'
  | 'MANAGE_MASTERS_AND_COA'
  | 'CREATE_COMMERCIAL_DRAFT'
  | 'DISPATCH_OR_RECEIVE_STOCK'
  | 'POST_TO_GL'
  | 'APPROVE_HIGH_VALUE'
  | 'OVERRIDE_3WAY_VARIANCE'
  | 'REVERSE_POSTED_JOURNAL'
  | 'SUBMIT_CLOSE_MAKER'
  | 'APPROVE_CLOSE_CHECKER'
  | 'REOPEN_PERIOD'
  | 'MANAGE_USERS_AND_ORG'
  | 'VIEW_REPORTS'
  | 'VIEW_LIMITED_REPORTS'
  | 'EXPORT_DATA'
  | 'OVERRIDE_NEGATIVE_STOCK';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

export interface AuthMembership {
  membershipId: string;
  organisationId: string;
  organisationName: string;
  role: ServerRole;
  permissions: ServerPermission[];
}

export interface AuthCompany {
  id: string;
  organisationId: string;
  organisationName: string;
  legalName: string;
  tradeName: string | null;
  entityType: string | null;
  tin: string | null;
  bin: string | null;
  status: string;
  role: ServerRole;
  permissions: ServerPermission[];
  explicitScope: boolean;
}

export interface MeResponse {
  user: AuthUser;
  memberships: AuthMembership[];
  companies: AuthCompany[];
  activeCompanyId: string | null;
  session: {
    id: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export interface InvitationDetails {
  organisationName: string;
  emailMasked: string;
  role: ServerRole;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: ServerRole;
  status: string;
  companyScope: Array<{ companyId: string; legalName: string; role: ServerRole; status: string }>;
  explicitScope: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: ServerRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  companyScope: Array<{ companyId: string; legalName: string }>;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: string;
  resendCount: number;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}
