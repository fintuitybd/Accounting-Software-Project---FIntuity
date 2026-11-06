import type { Permission, Role } from './permissions.ts';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface MembershipContext {
  membershipId: string;
  organisationId: string;
  organisationName: string;
  role: Role;
  permissions: readonly Permission[];
}

export interface CompanyAccess {
  id: string;
  organisationId: string;
  organisationName: string;
  legalName: string;
  tradeName: string | null;
  entityType: string | null;
  tin: string | null;
  bin: string | null;
  status: string;
  role: Role;
  permissions: readonly Permission[];
  explicitScope: boolean;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    lastLoginAt: string | null;
  };
  memberships: MembershipContext[];
  companies: CompanyAccess[];
  activeCompanyId: string | null;
  session: {
    id: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export interface CompanyMemberSummary {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  companyScope: Array<{ companyId: string; legalName: string; role: Role; status: string }>;
  explicitScope: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  companyScope: Array<{ companyId: string; legalName: string }>;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: string;
  resendCount: number;
}
