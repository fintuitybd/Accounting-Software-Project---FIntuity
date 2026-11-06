import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { generateToken, hashToken, readCookie, safeEqual, serializeCookie, clearCookie } from './tokens.ts';

export interface SessionUserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  activeOrganisationId: string | null;
  activeCompanyId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface ResolvedSession {
  session: SessionRecord & { csrfTokenHash: string };
  user: SessionUserRow;
}

export interface IssuedSession {
  session: SessionRecord & { csrfTokenHash: string };
  token: string;
  csrfToken: string;
}

interface SessionRow extends SessionRecord {
  token_hash: string;
  csrf_token_hash: string;
}

interface SessionWithUserRow extends SessionRow {
  email: string;
  name: string;
  user_status: string;
  email_verified_at: Date | null;
  user_last_login_at: Date | null;
  user_created_at: Date;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

function mapSession(row: SessionRow): SessionRecord & { csrfTokenHash: string } {
  return {
    id: row.id,
    userId: row.userId,
    ip: row.ip,
    userAgent: row.userAgent,
    activeOrganisationId: row.activeOrganisationId,
    activeCompanyId: row.activeCompanyId,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    csrfTokenHash: row.csrf_token_hash,
  };
}

export interface IssueSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  activeOrganisationId?: string | null;
  activeCompanyId?: string | null;
  now?: Date;
}

export function sessionLifetime(config: Pick<AppConfig, 'sessionIdleMinutes' | 'sessionAbsoluteHours'>): {
  idleMs: number;
  absoluteMs: number;
} {
  return {
    idleMs: config.sessionIdleMinutes * 60_000,
    absoluteMs: config.sessionAbsoluteHours * 3_600_000,
  };
}

export async function issueSession(
  database: Queryable,
  input: IssueSessionInput,
  config: Pick<AppConfig, 'sessionIdleMinutes' | 'sessionAbsoluteHours'>,
): Promise<IssuedSession> {
  const token = generateToken(32);
  const csrfToken = generateToken(32);
  const now = input.now ?? new Date();
  const { idleMs, absoluteMs } = sessionLifetime(config);
  const absoluteExpiresAt = new Date(now.getTime() + absoluteMs);
  const idleExpiresAt = new Date(Math.min(now.getTime() + idleMs, absoluteExpiresAt.getTime()));

  const inserted = await database.query<SessionRow>(
    `INSERT INTO sessions (
       user_id, token_hash, csrf_token_hash, ip, user_agent,
       active_organisation_id, active_company_id,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
     RETURNING id, token_hash, csrf_token_hash,
               user_id AS "userId", ip, user_agent AS "userAgent",
               active_organisation_id AS "activeOrganisationId",
               active_company_id AS "activeCompanyId",
               created_at AS "createdAt", last_seen_at AS "lastSeenAt",
               idle_expires_at AS "idleExpiresAt", absolute_expires_at AS "absoluteExpiresAt",
               revoked_at AS "revokedAt", revoked_reason AS "revokedReason"`,
    [
      input.userId,
      hashToken(token),
      hashToken(csrfToken),
      input.ip ?? null,
      input.userAgent ?? null,
      input.activeOrganisationId ?? null,
      input.activeCompanyId ?? null,
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    ],
  );

  const row = inserted.rows[0];
  if (!row) throw new AppError(500, 'SESSION_CREATE_FAILED', 'The session could not be created.');
  return { session: mapSession(row), token, csrfToken };
}

export async function resolveSession(
  pool: Pool,
  token: string,
  config: Pick<AppConfig, 'sessionIdleMinutes' | 'sessionAbsoluteHours' | 'sessionTouchIntervalSeconds'>,
  options: { touch?: boolean } = {},
): Promise<ResolvedSession> {
  const result = await pool.query<SessionWithUserRow>(
    `SELECT s.id,
            s.user_id AS "userId", s.ip, s.user_agent AS "userAgent",
            s.active_organisation_id AS "activeOrganisationId",
            s.active_company_id AS "activeCompanyId",
            s.created_at AS "createdAt", s.last_seen_at AS "lastSeenAt",
            s.idle_expires_at AS "idleExpiresAt", s.absolute_expires_at AS "absoluteExpiresAt",
            s.revoked_at AS "revokedAt", s.revoked_reason AS "revokedReason",
            s.token_hash, s.csrf_token_hash,
            u.email, u.name, u.status AS user_status, u.email_verified_at,
            u.last_login_at AS user_last_login_at, u.created_at AS user_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required.');
  }

  const now = new Date();
  if (row.revokedAt) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has ended. Sign in again.');
  }
  if (row.absoluteExpiresAt.getTime() <= now.getTime() || row.idleExpiresAt.getTime() <= now.getTime()) {
    await revokeSession(pool, row.id, 'EXPIRED');
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
  }
  if (row.user_status !== 'ACTIVE') {
    await revokeSession(pool, row.id, 'USER_INACTIVE');
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required.');
  }

  if (options.touch !== false) {
    const touchIntervalMs = config.sessionTouchIntervalSeconds * 1000;
    if (now.getTime() - row.lastSeenAt.getTime() >= touchIntervalMs) {
      const { idleMs } = sessionLifetime(config);
      const nextIdle = new Date(Math.min(now.getTime() + idleMs, row.absoluteExpiresAt.getTime()));
      await pool.query(
        `UPDATE sessions
            SET last_seen_at = $2, idle_expires_at = $3
          WHERE id = $1 AND revoked_at IS NULL`,
        [row.id, now, nextIdle],
      );
      row.lastSeenAt = now;
      row.idleExpiresAt = nextIdle;
    }
  }

  return {
    session: mapSession(row),
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      status: row.user_status,
      emailVerifiedAt: row.email_verified_at,
      lastLoginAt: row.user_last_login_at,
      createdAt: row.user_created_at,
    },
  };
}

export async function revokeSession(database: Queryable, sessionId: string, reason: string): Promise<void> {
  await database.query(
    `UPDATE sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}

export async function revokeAllUserSessions(
  database: Queryable,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await database.query(
    `UPDATE sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1
        AND revoked_at IS NULL
        ${exceptSessionId ? 'AND id <> $3' : ''}`,
    exceptSessionId ? [userId, reason, exceptSessionId] : [userId, reason],
  );
  return result.rowCount ?? 0;
}

export async function rotateCsrfToken(
  database: Queryable,
  sessionId: string,
): Promise<{ csrfToken: string; expiresAt: Date }> {
  const csrfToken = generateToken(32);
  const result = await database.query<{ absolute_expires_at: Date }>(
    `UPDATE sessions
        SET csrf_token_hash = $2
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING absolute_expires_at`,
    [sessionId, hashToken(csrfToken)],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(401, 'SESSION_EXPIRED', 'Your session has ended. Sign in again.');
  return { csrfToken, expiresAt: row.absolute_expires_at };
}

export async function setSessionActiveCompany(
  database: Queryable,
  sessionId: string,
  organisationId: string | null,
  companyId: string | null,
): Promise<void> {
  await database.query(
    `UPDATE sessions
        SET active_organisation_id = $2, active_company_id = $3
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, organisationId, companyId],
  );
}

export async function listUserSessions(pool: Pool, userId: string): Promise<SessionRecord[]> {
  const result = await pool.query<SessionRow>(
    `SELECT id, user_id AS "userId", ip, user_agent AS "userAgent",
            active_organisation_id AS "activeOrganisationId",
            active_company_id AS "activeCompanyId",
            created_at AS "createdAt", last_seen_at AS "lastSeenAt",
            idle_expires_at AS "idleExpiresAt", absolute_expires_at AS "absoluteExpiresAt",
            revoked_at AS "revokedAt", revoked_reason AS "revokedReason",
            token_hash, csrf_token_hash
       FROM sessions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId],
  );
  return result.rows.map(mapSession);
}

export function verifyCsrf(
  cookieHeader: string | undefined,
  headerValue: string | string[] | undefined,
  session: { csrfTokenHash: string },
  config: Pick<AppConfig, 'csrfCookieName'>,
): void {
  const cookieToken = readCookie(cookieHeader, config.csrfCookieName);
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new AppError(403, 'CSRF_FAILED', 'The request could not be verified. Refresh the page and try again.');
  }
  if (!safeEqual(hashToken(headerToken), session.csrfTokenHash)) {
    throw new AppError(403, 'CSRF_FAILED', 'The request could not be verified. Refresh the page and try again.');
  }
}

export function sessionCookieHeader(
  config: Pick<AppConfig, 'sessionCookieName' | 'cookieSecure'>,
  token: string,
  expiresAt: Date,
  now = new Date(),
): string {
  return serializeCookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  });
}

export function csrfCookieHeader(
  config: Pick<AppConfig, 'csrfCookieName' | 'cookieSecure'>,
  csrfToken: string,
  expiresAt: Date,
  now = new Date(),
): string {
  return serializeCookie(config.csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  });
}

export function clearedSessionCookies(
  config: Pick<AppConfig, 'sessionCookieName' | 'csrfCookieName' | 'cookieSecure'>,
): string[] {
  const base = { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax' as const };
  return [
    clearCookie(config.sessionCookieName, base),
    clearCookie(config.csrfCookieName, { ...base, httpOnly: false }),
  ];
}
