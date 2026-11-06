import type { Pool, PoolClient } from 'pg';
import type { Permission, Role } from './permissions.ts';
import { effectiveRole, isRole, permissionsForRole } from './permissions.ts';
import type { CompanyAccess, CompanyMemberSummary, InvitationSummary, MembershipContext, UserRow } from './types.ts';

interface CompanyRow {
  membership_id: string;
  organisation_id: string;
  organisation_name: string;
  membership_role: string;
  company_id: string;
  legal_name: string;
  trade_name: string | null;
  entity_type: string | null;
  tin: string | null;
  bin: string | null;
  company_status: string;
  effective_role: string | null;
  explicit_scope: boolean;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

const COMPANY_SELECT = `
  SELECT m.id AS membership_id, m.organisation_id, o.name AS organisation_name,
         m.role AS membership_role,
         c.id AS company_id, c.legal_name, c.trade_name, c.entity_type, c.tin, c.bin,
         c.status AS company_status,
         COALESCE(cm.role_override, m.role) AS effective_role,
         (cm.id IS NOT NULL) AS explicit_scope
    FROM memberships m
    JOIN organisations o ON o.id = m.organisation_id
    JOIN companies c ON c.organisation_id = m.organisation_id
    LEFT JOIN company_memberships cm
      ON cm.membership_id = m.id AND cm.company_id = c.id
`;

function mapCompany(row: CompanyRow): CompanyAccess {
  const role: Role = isRole(row.effective_role) ? row.effective_role : 'AUDITOR';
  return {
    id: row.company_id,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    entityType: row.entity_type,
    tin: row.tin,
    bin: row.bin,
    status: row.company_status,
    role,
    permissions: permissionsForRole(role),
    explicitScope: row.explicit_scope,
  };
}

export async function loadUserById(database: Queryable, userId: string): Promise<UserRow | null> {
  const result = await database.query<{
    id: string;
    email: string;
    name: string;
    status: string;
    email_verified_at: Date | null;
    last_login_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, email, name, status, email_verified_at, last_login_at, created_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export async function loadMemberships(database: Queryable, userId: string): Promise<MembershipContext[]> {
  const result = await database.query<{
    id: string;
    organisation_id: string;
    organisation_name: string;
    role: string;
  }>(
    `SELECT m.id, m.organisation_id, o.name AS organisation_name, m.role
       FROM memberships m
       JOIN organisations o ON o.id = m.organisation_id
      WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
      ORDER BY o.name ASC`,
    [userId],
  );
  return result.rows
    .filter((row) => isRole(row.role))
    .map((row) => ({
      membershipId: row.id,
      organisationId: row.organisation_id,
      organisationName: row.organisation_name,
      role: row.role as Role,
      permissions: permissionsForRole(row.role as Role),
    }));
}

export async function listAccessibleCompanies(database: Queryable, userId: string): Promise<CompanyAccess[]> {
  const result = await database.query<CompanyRow>(
    `${COMPANY_SELECT}
      WHERE m.user_id = $1
        AND m.status = 'ACTIVE'
        AND o.status = 'ACTIVE'
        AND c.status = 'ACTIVE'
        AND (
          (
            EXISTS (SELECT 1 FROM company_memberships any_scope WHERE any_scope.membership_id = m.id)
            AND cm.id IS NOT NULL
            AND cm.status = 'ACTIVE'
          )
          OR (
            m.role IN ('OWNER', 'ADMIN')
            AND NOT EXISTS (SELECT 1 FROM company_memberships any_scope WHERE any_scope.membership_id = m.id)
          )
        )
      ORDER BY o.name ASC, c.legal_name ASC`,
    [userId],
  );
  return result.rows.map(mapCompany);
}

export async function resolveOrganisationMembership(
  database: Queryable,
  userId: string,
  organisationId: string,
): Promise<MembershipContext | null> {
  const result = await database.query<{
    id: string;
    organisation_id: string;
    organisation_name: string;
    role: string;
  }>(
    `SELECT m.id, m.organisation_id, o.name AS organisation_name, m.role
       FROM memberships m
       JOIN organisations o ON o.id = m.organisation_id
      WHERE m.user_id = $1
        AND m.organisation_id = $2
        AND m.status = 'ACTIVE'
        AND o.status = 'ACTIVE'`,
    [userId, organisationId],
  );
  const row = result.rows[0];
  if (!row || !isRole(row.role)) return null;
  return {
    membershipId: row.id,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    role: row.role,
    permissions: permissionsForRole(row.role),
  };
}

export async function resolveCompanyAccess(
  database: Queryable,
  userId: string,
  companyId: string,
): Promise<CompanyAccess | null> {
  const result = await database.query<CompanyRow>(
    `${COMPANY_SELECT}
      WHERE m.user_id = $1
        AND c.id = $2
        AND m.status = 'ACTIVE'
        AND o.status = 'ACTIVE'
        AND c.status = 'ACTIVE'
        AND (
          (
            EXISTS (SELECT 1 FROM company_memberships any_scope WHERE any_scope.membership_id = m.id)
            AND cm.id IS NOT NULL
            AND cm.status = 'ACTIVE'
          )
          OR (
            m.role IN ('OWNER', 'ADMIN')
            AND NOT EXISTS (SELECT 1 FROM company_memberships any_scope WHERE any_scope.membership_id = m.id)
          )
        )
      LIMIT 1`,
    [userId, companyId],
  );
  const row = result.rows[0];
  return row ? mapCompany(row) : null;
}

export function permissionsForCompany(company: CompanyAccess | null): readonly Permission[] {
  return company ? company.permissions : [];
}

export function companyHasPermission(company: CompanyAccess, permission: Permission): boolean {
  return company.permissions.includes(permission);
}

export async function loadOrganisationMembers(
  database: Queryable,
  organisationId: string,
): Promise<CompanyMemberSummary[]> {
  const result = await database.query<{
    user_id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    created_at: Date;
    last_login_at: Date | null;
    company_id: string | null;
    legal_name: string | null;
    company_role: string | null;
    company_status: string | null;
    explicit_scope: boolean;
  }>(
    `SELECT u.id AS user_id, u.email, u.name, m.role, m.status, m.created_at, u.last_login_at,
            c.id AS company_id, c.legal_name,
            COALESCE(cm.role_override, m.role) AS company_role,
            cm.status AS company_status,
            EXISTS (SELECT 1 FROM company_memberships scope WHERE scope.membership_id = m.id) AS explicit_scope
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN company_memberships cm ON cm.membership_id = m.id
       LEFT JOIN companies c ON c.id = cm.company_id
      WHERE m.organisation_id = $1
        AND m.status <> 'REMOVED'
      ORDER BY u.name ASC, c.legal_name ASC`,
    [organisationId],
  );

  const byUser = new Map<string, CompanyMemberSummary>();
  for (const row of result.rows) {
    if (!isRole(row.role)) continue;
    let member = byUser.get(row.user_id);
    if (!member) {
      member = {
        userId: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
        companyScope: [],
        explicitScope: row.explicit_scope,
        createdAt: row.created_at.toISOString(),
        lastLoginAt: row.last_login_at?.toISOString() ?? null,
      };
      byUser.set(row.user_id, member);
    }
    if (row.company_id && row.legal_name && isRole(row.company_role) && row.company_status) {
      member.companyScope.push({
        companyId: row.company_id,
        legalName: row.legal_name,
        role: row.company_role,
        status: row.company_status,
      });
    }
  }
  return Array.from(byUser.values());
}

export async function loadOrganisationInvitations(
  database: Queryable,
  organisationId: string,
): Promise<InvitationSummary[]> {
  const result = await database.query<{
    id: string;
    email: string;
    role: string;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
    invited_by_name: string;
    resend_count: number;
    company_id: string | null;
    legal_name: string | null;
  }>(
    `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
            inviter.name AS invited_by_name, i.resend_count,
            c.id AS company_id, c.legal_name
       FROM invitations i
       JOIN users inviter ON inviter.id = i.invited_by
       LEFT JOIN invitation_companies ic ON ic.invitation_id = i.id
       LEFT JOIN companies c ON c.id = ic.company_id
      WHERE i.organisation_id = $1
      ORDER BY i.created_at DESC, c.legal_name ASC`,
    [organisationId],
  );

  const byInvitation = new Map<string, InvitationSummary>();
  const now = Date.now();
  for (const row of result.rows) {
    if (!isRole(row.role)) continue;
    let invitation = byInvitation.get(row.id);
    if (!invitation) {
      const status: InvitationSummary['status'] = row.accepted_at
        ? 'ACCEPTED'
        : row.revoked_at
          ? 'REVOKED'
          : row.expires_at.getTime() <= now
            ? 'EXPIRED'
            : 'PENDING';
      invitation = {
        id: row.id,
        email: row.email,
        role: row.role,
        status,
        companyScope: [],
        expiresAt: row.expires_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        acceptedAt: row.accepted_at?.toISOString() ?? null,
        invitedBy: row.invited_by_name,
        resendCount: row.resend_count,
      };
      byInvitation.set(row.id, invitation);
    }
    if (row.company_id && row.legal_name) {
      invitation.companyScope.push({ companyId: row.company_id, legalName: row.legal_name });
    }
  }
  return Array.from(byInvitation.values());
}

export function roleForMembership(membership: MembershipContext, override: Role | null = null): Role {
  return effectiveRole(membership.role, override);
}

export function buildMeResponse(
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
  },
  memberships: MembershipContext[],
  companies: CompanyAccess[],
  session: { id: string; idleExpiresAt: Date; absoluteExpiresAt: Date },
  preferredCompanyId?: string | null,
): import('./types.ts').MeResponse {
  const accessibleIds = new Set(companies.map((company) => company.id));
  const activeCompanyId =
    preferredCompanyId && accessibleIds.has(preferredCompanyId) ? preferredCompanyId : (companies[0]?.id ?? null);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    memberships,
    companies,
    activeCompanyId,
    session: {
      id: session.id,
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    },
  };
}
