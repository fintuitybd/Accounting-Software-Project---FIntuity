import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { withTransaction } from '../db/transaction.ts';
import { buildMeResponse, listAccessibleCompanies, loadMemberships } from './access.ts';
import { writeAuditEvent } from './audit.ts';
import type { EmailMessage } from './email.ts';
import type { AuthContext } from './loginService.ts';
import { assertPasswordPolicy, hashPassword } from './password.ts';
import { canAssignRole, isRole, type Role } from './permissions.ts';
import { issueSession, setSessionActiveCompany, type IssuedSession, type SessionUserRow } from './session.ts';
import { generateToken, hashToken, maskEmail, normaliseEmail } from './tokens.ts';
import type { MembershipContext, MeResponse } from './types.ts';

interface InvitationRow {
  id: string;
  organisation_id: string;
  organisation_name: string;
  email: string;
  role: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  invited_by: string;
  resend_count: number;
}

export interface CreateInvitationInput {
  actor: MembershipContext;
  actorUserId: string;
  actorEmail: string;
  email: string;
  role: Role;
  companyIds: string[];
}

export interface InvitationEmailResult {
  email: EmailMessage;
  invitation: { id: string; email: string; role: Role; expiresAt: Date };
  reused: boolean;
}

export interface AcceptInvitationInput {
  token: string;
  name?: string;
  password?: string;
  currentUser?: SessionUserRow;
  currentSessionId?: string;
  currentSession?: { id: string; idleExpiresAt: Date; absoluteExpiresAt: Date };
}

export interface AcceptInvitationResult {
  response: MeResponse;
  issued: IssuedSession | null;
}

async function companyScope(
  database: Pool | PoolClient,
  organisationId: string,
  companyIds: string[],
): Promise<Array<{ id: string; legal_name: string }>> {
  if (companyIds.length === 0) return [];
  const result = await database.query<{ id: string; legal_name: string }>(
    `SELECT id, legal_name
       FROM companies
      WHERE organisation_id = $1
        AND id = ANY($2::uuid[])
        AND status = 'ACTIVE'`,
    [organisationId, companyIds],
  );
  if (result.rows.length !== companyIds.length) {
    throw new AppError(400, 'INVALID_COMPANY_SCOPE', 'One or more selected companies are not available.');
  }
  return result.rows;
}

function invitationEmail(
  config: AppConfig,
  input: {
    organisationName: string;
    inviterName: string;
    email: string;
    role: Role;
    token: string;
    expiresAt: Date;
  },
): EmailMessage {
  return {
    to: input.email,
    subject: `${input.organisationName} invited you to Fintuity Accounting Suite`,
    text: [
      `Hello,`,
      '',
      `${input.inviterName} invited you to join ${input.organisationName} on Fintuity Accounting Suite as ${input.role}.`,
      'Accept the invitation and set your password here:',
      `${config.appOrigin}/accept-invitation/${encodeURIComponent(input.token)}`,
      '',
      `This single-use link expires at ${input.expiresAt.toISOString()}.`,
      'If you were not expecting this invitation, you can ignore the message.',
      '',
      'Fintuity Accounting Suite security',
    ].join('\n'),
  };
}

export async function createOrResendInvitation(
  pool: Pool,
  config: AppConfig,
  input: CreateInvitationInput,
): Promise<InvitationEmailResult> {
  const email = normaliseEmail(input.email);
  if (email === normaliseEmail(input.actorEmail)) {
    throw new AppError(400, 'CANNOT_INVITE_SELF', 'You cannot invite your own email address.');
  }
  if (!canAssignRole(input.actor.role, input.role)) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot assign that role.');
  }
  if (input.companyIds.length === 0 && input.role !== 'OWNER' && input.role !== 'ADMIN') {
    throw new AppError(400, 'COMPANY_SCOPE_REQUIRED', 'Select at least one company for this role.');
  }

  const uniqueCompanyIds = Array.from(new Set(input.companyIds));
  const scope = await companyScope(pool, input.actor.organisationId, uniqueCompanyIds);

  const existingMember = await pool.query<{ id: string }>(
    `SELECT m.id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.organisation_id = $1
        AND lower(u.email) = $2
        AND m.status <> 'REMOVED'
      LIMIT 1`,
    [input.actor.organisationId, email],
  );
  if (existingMember.rows[0]) {
    throw new AppError(409, 'ALREADY_MEMBER', 'That email already belongs to a member of this organisation.');
  }

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + config.invitationExpiryHours * 3_600_000);

  let result: { invitationId: string; reused: boolean; inviterName: string };
  try {
    result = await withTransaction(pool, async (client) => {
      const current = await client.query<{ id: string; resend_count: number }>(
        `SELECT id, resend_count
         FROM invitations
        WHERE organisation_id = $1
          AND lower(email) = $2
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        FOR UPDATE`,
        [input.actor.organisationId, email],
      );
      const pending = current.rows[0];
      let invitationId: string;
      let reused = false;

      if (pending) {
        invitationId = pending.id;
        reused = true;
        await client.query(
          `UPDATE invitations
            SET token_hash = $2, role = $3, expires_at = $4,
                resend_count = resend_count + 1, last_sent_at = now()
          WHERE id = $1`,
          [invitationId, hashToken(token), input.role, expiresAt],
        );
        await client.query('DELETE FROM invitation_companies WHERE invitation_id = $1', [invitationId]);
        await writeAuditEvent(client, {
          organisationId: input.actor.organisationId,
          actorUserId: input.actorUserId,
          action: 'invitation.resent',
          entityType: 'invitation',
          entityId: invitationId,
          after: { email, role: input.role, companyIds: uniqueCompanyIds, expiresAt: expiresAt.toISOString() },
        });
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO invitations (
           organisation_id, email, role, token_hash, expires_at, invited_by, last_sent_at
         ) VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id`,
          [input.actor.organisationId, email, input.role, hashToken(token), expiresAt, input.actorUserId],
        );
        invitationId = inserted.rows[0]?.id ?? '';
        if (!invitationId) {
          throw new AppError(500, 'INVITATION_CREATE_FAILED', 'The invitation could not be created.');
        }
        await writeAuditEvent(client, {
          organisationId: input.actor.organisationId,
          actorUserId: input.actorUserId,
          action: 'invitation.created',
          entityType: 'invitation',
          entityId: invitationId,
          after: { email, role: input.role, companyIds: uniqueCompanyIds, expiresAt: expiresAt.toISOString() },
        });
      }

      for (const company of scope) {
        await client.query(
          `INSERT INTO invitation_companies (invitation_id, organisation_id, company_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (invitation_id, company_id) DO NOTHING`,
          [invitationId, input.actor.organisationId, company.id],
        );
      }

      const inviter = await client.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [input.actorUserId]);
      return {
        invitationId,
        reused,
        inviterName: inviter.rows[0]?.name ?? 'An administrator',
      };
    });
  } catch (error) {
    // Two administrators may race to invite the same email. The partial unique index is the
    // authority; translate it into a stable conflict instead of a 500.
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'INVITATION_CONFLICT', 'An invitation for this email is already pending.');
    }
    throw error;
  }

  return {
    invitation: { id: result.invitationId, email, role: input.role, expiresAt },
    reused: result.reused,
    email: invitationEmail(config, {
      organisationName: input.actor.organisationName,
      inviterName: result.inviterName,
      email,
      role: input.role,
      token,
      expiresAt,
    }),
  };
}

export interface ResendInvitationResult {
  email: EmailMessage;
  expiresAt: Date;
}

export async function resendInvitation(
  pool: Pool,
  config: AppConfig,
  input: { invitationId: string; organisationId: string; actorUserId: string; actorName: string },
): Promise<ResendInvitationResult> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + config.invitationExpiryHours * 3_600_000);

  const email = await withTransaction(pool, async (client) => {
    const result = await client.query<{
      id: string;
      email: string;
      role: string;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
      organisation_name: string;
    }>(
      `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, o.name AS organisation_name
         FROM invitations i
         JOIN organisations o ON o.id = i.organisation_id
        WHERE i.id = $1 AND i.organisation_id = $2
        FOR UPDATE`,
      [input.invitationId, input.organisationId],
    );
    const row = result.rows[0];
    if (!row || row.accepted_at || row.revoked_at || row.expires_at.getTime() <= Date.now()) {
      throw new AppError(409, 'INVITATION_NOT_PENDING', 'This invitation is no longer pending.');
    }
    if (!isRole(row.role)) {
      throw new AppError(409, 'INVITATION_INVALID', 'This invitation is invalid.');
    }
    await client.query(
      `UPDATE invitations
          SET token_hash = $2, expires_at = $3,
              resend_count = resend_count + 1, last_sent_at = now()
        WHERE id = $1`,
      [row.id, hashToken(token), expiresAt],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      action: 'invitation.resent',
      entityType: 'invitation',
      entityId: row.id,
      after: { expiresAt: expiresAt.toISOString() },
    });
    return {
      to: row.email,
      organisationName: row.organisation_name,
      role: row.role,
    };
  });

  return {
    expiresAt,
    email: invitationEmail(config, {
      organisationName: email.organisationName,
      inviterName: input.actorName,
      email: email.to,
      role: email.role,
      token,
      expiresAt,
    }),
  };
}

export async function revokeInvitation(
  pool: Pool,
  input: { invitationId: string; organisationId: string; actorUserId: string },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; accepted_at: Date | null; revoked_at: Date | null }>(
      `SELECT id, accepted_at, revoked_at
         FROM invitations
        WHERE id = $1 AND organisation_id = $2
        FOR UPDATE`,
      [input.invitationId, input.organisationId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
    if (row.accepted_at || row.revoked_at) {
      throw new AppError(409, 'INVITATION_NOT_PENDING', 'This invitation is no longer pending.');
    }
    await client.query('UPDATE invitations SET revoked_at = now() WHERE id = $1', [row.id]);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      action: 'invitation.revoked',
      entityType: 'invitation',
      entityId: row.id,
    });
  });
}

export async function getInvitationByToken(
  pool: Pool,
  token: string,
): Promise<{
  organisationName: string;
  emailMasked: string;
  role: Role;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}> {
  const result = await pool.query<{
    email: string;
    role: string;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    organisation_name: string;
  }>(
    `SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, o.name AS organisation_name
       FROM invitations i
       JOIN organisations o ON o.id = i.organisation_id
      WHERE i.token_hash = $1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row || !isRole(row.role)) {
    throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
  }
  const status = row.accepted_at
    ? 'ACCEPTED'
    : row.revoked_at
      ? 'REVOKED'
      : row.expires_at.getTime() <= Date.now()
        ? 'EXPIRED'
        : 'PENDING';
  return {
    organisationName: row.organisation_name,
    emailMasked: maskEmail(row.email),
    role: row.role,
    expiresAt: row.expires_at.toISOString(),
    status,
  };
}

export async function acceptInvitation(
  pool: Pool,
  config: AppConfig,
  input: AcceptInvitationInput,
  context: AuthContext,
): Promise<AcceptInvitationResult> {
  const result = await withTransaction(pool, async (client) => {
    const invitationResult = await client.query<InvitationRow>(
      `SELECT i.id, i.organisation_id, o.name AS organisation_name, i.email, i.role,
              i.expires_at, i.accepted_at, i.revoked_at, i.invited_by, i.resend_count
         FROM invitations i
         JOIN organisations o ON o.id = i.organisation_id
        WHERE i.token_hash = $1
        FOR UPDATE`,
      [hashToken(input.token)],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation || !isRole(invitation.role)) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
    }
    if (invitation.accepted_at) {
      throw new AppError(410, 'INVITATION_USED', 'This invitation has already been accepted.');
    }
    if (invitation.revoked_at) {
      throw new AppError(410, 'INVITATION_REVOKED', 'This invitation has been revoked.');
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw new AppError(410, 'INVITATION_EXPIRED', 'This invitation has expired. Ask an administrator to resend it.');
    }

    if (input.currentUser && input.currentUser.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      throw new AppError(
        409,
        'ACCOUNT_MISMATCH',
        'Sign out and sign in with the invited email address before accepting this invitation.',
      );
    }

    const companies = await client.query<{ id: string; legal_name: string }>(
      `SELECT c.id, c.legal_name
         FROM invitation_companies ic
         JOIN companies c ON c.id = ic.company_id
        WHERE ic.invitation_id = $1`,
      [invitation.id],
    );

    const existingUser = await client.query<{
      id: string;
      name: string;
      password_hash: string | null;
      status: string;
      email_verified_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, name, password_hash, status, email_verified_at, last_login_at, created_at
         FROM users
        WHERE lower(email) = $1
        FOR UPDATE`,
      [invitation.email],
    );
    const user = existingUser.rows[0] ?? null;

    if (user && (user.status === 'SUSPENDED' || user.status === 'DISABLED')) {
      throw new AppError(409, 'ACCOUNT_UNAVAILABLE', 'This account is not active.');
    }

    let userId: string;
    let userForResponse: {
      id: string;
      email: string;
      name: string;
      status: string;
      emailVerifiedAt: Date | null;
      lastLoginAt: Date | null;
    };

    if (user?.password_hash) {
      if (input.currentUser?.id !== user.id) {
        throw new AppError(
          409,
          'ACCOUNT_EXISTS',
          'An account with this email already exists. Sign in first, then open the invitation link again.',
        );
      }
      if (user.status !== 'ACTIVE') {
        throw new AppError(409, 'ACCOUNT_UNAVAILABLE', 'This account is not active.');
      }
      userId = user.id;
      userForResponse = {
        id: user.id,
        email: invitation.email,
        name: user.name,
        status: user.status,
        emailVerifiedAt: user.email_verified_at,
        lastLoginAt: user.last_login_at,
      };
    } else {
      if (!input.password) {
        throw new AppError(400, 'PASSWORD_REQUIRED', 'Set a password to accept the invitation.');
      }
      assertPasswordPolicy(input.password, config, { email: invitation.email, name: input.name });
      const passwordHash = await hashPassword(input.password, config);
      if (user) {
        await client.query(
          `UPDATE users
              SET name = $2, password_hash = $3, status = 'ACTIVE',
                  email_verified_at = COALESCE(email_verified_at, now()),
                  password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL
            WHERE id = $1`,
          [user.id, input.name?.trim() || user.name, passwordHash],
        );
        userId = user.id;
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (
             email, name, password_hash, status, email_verified_at, password_changed_at
           ) VALUES ($1, $2, $3, 'ACTIVE', now(), now())
           RETURNING id`,
          [invitation.email, input.name?.trim() || invitation.email, passwordHash],
        );
        userId = inserted.rows[0]?.id ?? '';
        if (!userId) throw new AppError(500, 'INVITATION_ACCEPT_FAILED', 'The account could not be created.');
      }
      userForResponse = {
        id: userId,
        email: invitation.email,
        name: input.name?.trim() || user?.name || invitation.email,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        lastLoginAt: null,
      };
    }

    const existingMembership = await client.query<{ id: string; role: string; status: string }>(
      `SELECT id, role, status
         FROM memberships
        WHERE organisation_id = $1 AND user_id = $2
        FOR UPDATE`,
      [invitation.organisation_id, userId],
    );
    const membership = existingMembership.rows[0];
    let membershipId: string;
    if (membership) {
      if (membership.status === 'SUSPENDED') {
        throw new AppError(409, 'MEMBERSHIP_SUSPENDED', 'This membership is suspended. Contact an administrator.');
      }
      if (membership.status === 'ACTIVE' && membership.role !== invitation.role) {
        throw new AppError(409, 'ALREADY_MEMBER', 'You already belong to this organisation.');
      }
      membershipId = membership.id;
      await client.query(`UPDATE memberships SET role = $2, status = 'ACTIVE' WHERE id = $1`, [
        membershipId,
        invitation.role,
      ]);
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO memberships (organisation_id, user_id, role, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id`,
        [invitation.organisation_id, userId, invitation.role],
      );
      membershipId = inserted.rows[0]?.id ?? '';
      if (!membershipId) {
        throw new AppError(500, 'INVITATION_ACCEPT_FAILED', 'The membership could not be created.');
      }
    }

    for (const company of companies.rows) {
      await client.query(
        `INSERT INTO company_memberships (organisation_id, company_id, membership_id, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         ON CONFLICT (membership_id, company_id)
         DO UPDATE SET status = 'ACTIVE', role_override = NULL`,
        [invitation.organisation_id, company.id, membershipId],
      );
    }

    await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);
    await writeAuditEvent(client, {
      organisationId: invitation.organisation_id,
      actorUserId: userId,
      sessionId: input.currentSessionId ?? null,
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      after: {
        role: invitation.role,
        companyIds: companies.rows.map((company) => company.id),
        existingAccount: Boolean(user?.password_hash),
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });

    const memberships = await loadMemberships(client, userId);
    const accessible = await listAccessibleCompanies(client, userId);
    const activeCompany = accessible[0] ?? null;

    if (input.currentUser?.id === userId && input.currentSessionId) {
      if (activeCompany) {
        await setSessionActiveCompany(client, input.currentSessionId, activeCompany.organisationId, activeCompany.id);
      }
      return {
        userId,
        userForResponse,
        memberships,
        accessible,
        activeCompanyId: activeCompany?.id ?? null,
        issued: null,
        session: input.currentSession ?? {
          id: input.currentSessionId ?? '',
          idleExpiresAt: new Date(Date.now() + config.sessionIdleMinutes * 60_000),
          absoluteExpiresAt: new Date(Date.now() + config.sessionAbsoluteHours * 3_600_000),
        },
      };
    }

    const issued = await issueSession(
      client,
      {
        userId,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        activeOrganisationId: activeCompany?.organisationId ?? null,
        activeCompanyId: activeCompany?.id ?? null,
      },
      config,
    );
    await writeAuditEvent(client, {
      organisationId: activeCompany?.organisationId ?? null,
      companyId: activeCompany?.id ?? null,
      actorUserId: userId,
      sessionId: issued.session.id,
      action: 'auth.login.succeeded',
      entityType: 'session',
      entityId: issued.session.id,
      after: { viaInvitation: true },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
    return {
      userId,
      userForResponse,
      memberships,
      accessible,
      activeCompanyId: activeCompany?.id ?? null,
      issued,
      session: {
        id: issued.session.id,
        idleExpiresAt: issued.session.idleExpiresAt,
        absoluteExpiresAt: issued.session.absoluteExpiresAt,
      },
    };
  });

  return {
    response: buildMeResponse(
      result.userForResponse,
      result.memberships,
      result.accessible,
      result.session,
      result.activeCompanyId,
    ),
    issued: result.issued,
  };
}
