import type { Pool } from 'pg';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { withTransaction } from '../db/transaction.ts';
import { listAccessibleCompanies, loadMemberships } from './access.ts';
import { writeAuditEvent } from './audit.ts';
import { assertPasswordPolicy, hashPassword, verifyDummyPassword, verifyPassword } from './password.ts';
import { issueSession, revokeSession, type IssuedSession, type SessionUserRow } from './session.ts';
import { hashEmail, normaliseEmail } from './tokens.ts';
import type { MembershipContext, CompanyAccess } from './types.ts';

export interface AuthContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
}

interface LoginUserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  email_verified_at: Date | null;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface LoginResult {
  issued: IssuedSession;
  user: SessionUserRow;
  memberships: MembershipContext[];
  companies: CompanyAccess[];
  activeCompanyId: string | null;
}

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

function genericLoginError(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
}

function toSessionUser(row: LoginUserRow): SessionUserRow {
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

async function findLoginUser(pool: Pool, email: string): Promise<LoginUserRow | null> {
  const result = await pool.query<LoginUserRow>(
    `SELECT id, email, name, status, email_verified_at, password_hash,
            failed_login_attempts, locked_until, last_login_at, created_at
       FROM users
      WHERE lower(email) = $1
      LIMIT 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function loginWithPassword(
  pool: Pool,
  config: AppConfig,
  input: { email: string; password: string },
  context: AuthContext,
): Promise<LoginResult> {
  const email = normaliseEmail(input.email);
  const user = await findLoginUser(pool, email);
  const emailHash = hashEmail(email);

  if (!user || user.status !== 'ACTIVE') {
    await verifyDummyPassword(input.password);
    await writeAuditEvent(pool, {
      action: 'auth.login.failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      actorUserId: user?.id ?? null,
      after: { reason: user ? 'inactive_account' : 'unknown_email', emailHash },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
    throw genericLoginError();
  }

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    await verifyDummyPassword(input.password);
    await writeAuditEvent(pool, {
      action: 'auth.login.failed',
      entityType: 'user',
      entityId: user.id,
      actorUserId: user.id,
      after: { reason: 'account_locked' },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
    throw genericLoginError();
  }

  const passwordMatches = user.password_hash ? await verifyPassword(user.password_hash, input.password) : false;

  if (!passwordMatches) {
    await withTransaction(pool, async (client) => {
      const current = await client.query<{ failed_login_attempts: number }>(
        'SELECT failed_login_attempts FROM users WHERE id = $1 FOR UPDATE',
        [user.id],
      );
      const nextAttempts = (current.rows[0]?.failed_login_attempts ?? user.failed_login_attempts) + 1;
      const lockedUntil =
        nextAttempts >= config.loginMaxAttempts ? new Date(Date.now() + config.loginLockMinutes * 60_000) : null;
      await client.query(
        `UPDATE users
            SET failed_login_attempts = $2,
                locked_until = $3
          WHERE id = $1`,
        [user.id, nextAttempts, lockedUntil],
      );
      await writeAuditEvent(client, {
        action: 'auth.login.failed',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
        after: { reason: 'wrong_password', failedAttempts: nextAttempts, locked: Boolean(lockedUntil) },
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      });
    });
    throw genericLoginError();
  }

  const memberships = await loadMemberships(pool, user.id);
  const companies = await listAccessibleCompanies(pool, user.id);
  const activeCompany = companies[0] ?? null;

  const result = await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE users
          SET last_login_at = now(), failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [user.id],
    );
    const issued = await issueSession(
      client,
      {
        userId: user.id,
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
      actorUserId: user.id,
      sessionId: issued.session.id,
      action: 'auth.login.succeeded',
      entityType: 'session',
      entityId: issued.session.id,
      after: { emailVerified: Boolean(user.email_verified_at) },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
    return issued;
  });

  return {
    issued: result,
    user: { ...toSessionUser(user), lastLoginAt: new Date() },
    memberships,
    companies,
    activeCompanyId: activeCompany?.id ?? null,
  };
}

export async function logoutSession(
  pool: Pool,
  sessionId: string,
  user: SessionUserRow,
  context: AuthContext,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await revokeSession(client, sessionId, 'LOGOUT');
    await writeAuditEvent(client, {
      actorUserId: user.id,
      sessionId,
      action: 'auth.logout',
      entityType: 'session',
      entityId: sessionId,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
}

export interface SetPasswordInput {
  userId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(
  pool: Pool,
  config: AppConfig,
  input: SetPasswordInput,
  context: AuthContext,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const userResult = await client.query<{ password_hash: string | null; email: string; name: string }>(
      'SELECT password_hash, email, name FROM users WHERE id = $1 AND status = $2 FOR UPDATE',
      [input.userId, 'ACTIVE'],
    );
    const user = userResult.rows[0];
    if (!user?.password_hash) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required.');
    }
    const matches = await verifyPassword(user.password_hash, input.currentPassword);
    if (!matches) {
      throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', 'The current password is incorrect.');
    }
    assertPasswordPolicy(input.newPassword, config, { email: user.email, name: user.name });
    const nextHash = await hashPassword(input.newPassword, config);

    await client.query(
      `UPDATE users
          SET password_hash = $2, password_changed_at = now(),
              failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [input.userId, nextHash],
    );
    const revoked = await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGED'
        WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`,
      [input.userId, input.sessionId],
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL`,
      [input.userId],
    );
    await writeAuditEvent(client, {
      actorUserId: input.userId,
      sessionId: input.sessionId,
      action: 'auth.password.changed',
      entityType: 'user',
      entityId: input.userId,
      after: { otherSessionsRevoked: revoked.rowCount ?? 0 },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
}
