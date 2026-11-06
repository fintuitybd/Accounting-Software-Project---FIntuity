import type { Pool } from 'pg';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { withTransaction } from '../db/transaction.ts';
import { resolveCompanyAccess } from './access.ts';
import { writeAuditEvent } from './audit.ts';
import type { EmailMessage } from './email.ts';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password.ts';
import type { SessionUserRow } from './session.ts';
import { generateToken, hashEmail, hashToken, normaliseEmail } from './tokens.ts';
import type { AuthContext } from './loginService.ts';

const NEUTRAL_RESET_RESPONSE = 'If an account exists, a password reset link has been sent.';

export interface PasswordResetRequestResult {
  message: string;
  email: EmailMessage | null;
}

export async function requestPasswordReset(
  pool: Pool,
  config: AppConfig,
  rawEmail: string,
  context: AuthContext,
): Promise<PasswordResetRequestResult> {
  const email = normaliseEmail(rawEmail);
  const result = await pool.query<{
    id: string;
    name: string;
    status: string;
    password_hash: string | null;
  }>('SELECT id, name, status, password_hash FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
  const user = result.rows[0];

  // Invited users must complete the invitation flow so the invitation's company scope is applied.
  if (!user || user.status !== 'ACTIVE' || !user.password_hash) {
    await writeAuditEvent(pool, {
      action: 'auth.password_reset.requested',
      entityType: 'user',
      after: { outcome: 'no_eligible_account', emailHash: hashEmail(email) },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
    return { message: NEUTRAL_RESET_RESPONSE, email: null };
  }

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + config.passwordResetExpiryMinutes * 60_000);

  await withTransaction(pool, async (client) => {
    // Serialise concurrent reset requests for the same account so only the last issued token
    // remains usable.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)`,
      [user.id, hashToken(token), expiresAt, context.ip ?? null],
    );
    await writeAuditEvent(client, {
      actorUserId: user.id,
      action: 'auth.password_reset.requested',
      entityType: 'user',
      entityId: user.id,
      after: { expiresAt: expiresAt.toISOString() },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });

  return {
    message: NEUTRAL_RESET_RESPONSE,
    email: {
      to: email,
      subject: 'Reset your Fintuity Accounting Suite password',
      text: [
        `Hello ${user.name},`,
        '',
        'A password reset was requested for your Fintuity Accounting Suite account.',
        `Open this single-use link within ${config.passwordResetExpiryMinutes} minutes:`,
        `${config.appOrigin}/reset-password?token=${encodeURIComponent(token)}`,
        '',
        'If you did not request this, you can ignore the message. Your password has not changed.',
        '',
        'Fintuity Accounting Suite security',
      ].join('\n'),
    },
  };
}

export async function resetPassword(
  pool: Pool,
  config: AppConfig,
  token: string,
  newPassword: string,
  context: AuthContext,
): Promise<void> {
  const tokenHash = hashToken(token);
  await withTransaction(pool, async (client) => {
    const result = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
      email: string;
      name: string;
      status: string;
    }>(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.email, u.name, u.status
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now() || row.status !== 'ACTIVE') {
      throw new AppError(400, 'PASSWORD_RESET_INVALID', 'This password reset link is invalid or has expired.');
    }
    assertPasswordPolicy(newPassword, config, { email: row.email, name: row.name });
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [row.user_id]);
    const passwordHash = await hashPassword(newPassword, config);

    await client.query(
      `UPDATE users
          SET password_hash = $2, password_changed_at = now(),
              email_verified_at = COALESCE(email_verified_at, now()),
              failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [row.user_id, passwordHash],
    );
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL AND id <> $2`,
      [row.user_id, row.id],
    );
    const revoked = await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id],
    );
    await writeAuditEvent(client, {
      actorUserId: row.user_id,
      action: 'auth.password_reset.completed',
      entityType: 'user',
      entityId: row.user_id,
      after: { sessionsRevoked: revoked.rowCount ?? 0 },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
}

export interface VerificationEmailResult {
  email: EmailMessage | null;
}

export async function requestEmailVerification(
  pool: Pool,
  config: AppConfig,
  user: SessionUserRow,
  context: AuthContext,
): Promise<VerificationEmailResult> {
  if (user.emailVerifiedAt) return { email: null };

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + config.emailVerificationExpiryHours * 3_600_000);
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE email_verification_tokens SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, hashToken(token), expiresAt],
    );
    await writeAuditEvent(client, {
      actorUserId: user.id,
      sessionId: context.sessionId ?? null,
      action: 'auth.email_verification.requested',
      entityType: 'user',
      entityId: user.id,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });

  return {
    email: {
      to: user.email,
      subject: 'Verify your Fintuity Accounting Suite email address',
      text: [
        `Hello ${user.name},`,
        '',
        'Confirm your email address for Fintuity Accounting Suite:',
        `${config.appOrigin}/verify-email?token=${encodeURIComponent(token)}`,
        '',
        `The link expires in ${config.emailVerificationExpiryHours} hours and can be used once.`,
        '',
        'Fintuity Accounting Suite security',
      ].join('\n'),
    },
  };
}

export async function verifyEmail(pool: Pool, config: AppConfig, token: string): Promise<{ userId: string }> {
  const tokenHash = hashToken(token);
  void config;
  return withTransaction(pool, async (client) => {
    const result = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
         FROM email_verification_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
      throw new AppError(400, 'VERIFICATION_INVALID', 'This verification link is invalid or has expired.');
    }
    await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [
      row.user_id,
    ]);
    await client.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await client.query(
      `UPDATE email_verification_tokens SET used_at = now()
        WHERE user_id = $1 AND used_at IS NULL AND id <> $2`,
      [row.user_id, row.id],
    );
    await writeAuditEvent(client, {
      actorUserId: row.user_id,
      action: 'auth.email.verified',
      entityType: 'user',
      entityId: row.user_id,
    });
    return { userId: row.user_id };
  });
}

export async function revokeOwnSession(
  pool: Pool,
  userId: string,
  sessionId: string,
  currentSessionId: string,
  context: AuthContext,
): Promise<{ revokedCurrent: boolean }> {
  const result = await pool.query<{ id: string }>('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ]);
  if (!result.rows[0]) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'USER_REVOKED'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    await writeAuditEvent(client, {
      actorUserId: userId,
      sessionId: currentSessionId,
      action: 'auth.session.revoked',
      entityType: 'session',
      entityId: sessionId,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
  return { revokedCurrent: sessionId === currentSessionId };
}

export async function selectActiveCompany(
  pool: Pool,
  userId: string,
  sessionId: string,
  companyId: string,
  context: AuthContext,
): Promise<{ companyId: string; organisationId: string }> {
  const company = await resolveCompanyAccess(pool, userId, companyId);
  if (!company) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  }
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE sessions
          SET active_organisation_id = $2, active_company_id = $3
        WHERE id = $1 AND user_id = $4 AND revoked_at IS NULL`,
      [sessionId, company.organisationId, company.id, userId],
    );
    await writeAuditEvent(client, {
      organisationId: company.organisationId,
      companyId: company.id,
      actorUserId: userId,
      sessionId,
      action: 'auth.company.selected',
      entityType: 'company',
      entityId: company.id,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
  return { companyId: company.id, organisationId: company.organisationId };
}

export async function verifyCurrentPassword(pool: Pool, userId: string, password: string): Promise<boolean> {
  const result = await pool.query<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [
    userId,
  ]);
  const hash = result.rows[0]?.password_hash;
  return hash ? verifyPassword(hash, password) : false;
}
