import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { buildMeResponse, listAccessibleCompanies, loadMemberships } from '../auth/access.ts';
import {
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  revokeOwnSession,
  selectActiveCompany,
  verifyEmail,
} from '../auth/accountService.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { getAuth } from '../auth/context.ts';
import { createEmailSender, type EmailSender } from '../auth/email.ts';
import { acceptInvitation, getInvitationByToken, type AcceptInvitationResult } from '../auth/invitationService.ts';
import { changePassword, loginWithPassword, logoutSession } from '../auth/loginService.ts';
import { consumeRateLimit, clearRateLimit } from '../auth/rateLimit.ts';
import {
  clearedSessionCookies,
  csrfCookieHeader,
  listUserSessions,
  rotateCsrfToken,
  sessionCookieHeader,
  setSessionActiveCompany,
} from '../auth/session.ts';
import { hashEmail, normaliseEmail, truncateUserAgent } from '../auth/tokens.ts';

const emailSchema = z.string().trim().min(3).max(320).email();
const passwordSchema = z.string().min(1).max(256);

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const forgotPasswordSchema = z.object({ email: emailSchema });
const resetPasswordSchema = z.object({
  token: z.string().min(20).max(512),
  password: passwordSchema,
});
const verifyEmailSchema = z.object({ token: z.string().min(20).max(512) });
const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});
const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(512),
  name: z.string().trim().min(1).max(200).optional(),
  password: passwordSchema.optional(),
});
const activeCompanySchema = z.object({ companyId: z.string().uuid() });
const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });

export interface AuthRoutesOptions {
  config: AppConfig;
  emailSender?: EmailSender;
}

function setSessionCookies(reply: FastifyReply, config: AppConfig, issued: AcceptInvitationResult['issued']): void {
  if (!issued) return;
  reply.header('set-cookie', [
    sessionCookieHeader(config, issued.token, issued.session.absoluteExpiresAt),
    csrfCookieHeader(config, issued.csrfToken, issued.session.absoluteExpiresAt),
  ]);
}

async function rateLimitOrThrow(
  reply: FastifyReply,
  pool: import('pg').Pool,
  key: string,
  limit: number,
  windowMinutes: number,
): Promise<void> {
  const result = await consumeRateLimit(pool, key, limit, windowMinutes * 60, windowMinutes * 60);
  if (!result.allowed) {
    reply.header('retry-after', String(result.retryAfterSeconds));
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Wait and try again.');
  }
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const { config } = options;
  const emailSender = options.emailSender ?? createEmailSender(config);

  app.post('/auth/login', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const body = parseInput(loginSchema, request.body);
    const email = normaliseEmail(body.email);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:login:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:login:email:${hashEmail(email)}`,
      config.loginMaxAttempts,
      config.authRateLimitWindowMinutes,
    );

    const result = await loginWithPassword(
      app.db,
      config,
      { email, password: body.password },
      {
        ip: request.ip,
        userAgent: truncateUserAgent(request.headers['user-agent']),
        requestId: request.id,
      },
    );
    await clearRateLimit(app.db, `auth:login:email:${hashEmail(email)}`);
    setSessionCookies(reply, config, result.issued);
    return buildMeResponse(
      result.user,
      result.memberships,
      result.companies,
      result.issued.session,
      result.activeCompanyId,
    );
  });

  app.post('/auth/logout', { config: { auth: { mode: 'session' } } }, async (request, reply) => {
    const auth = getAuth(request);
    await logoutSession(app.db, auth.session.id, auth.user, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
      sessionId: auth.session.id,
    });
    reply.header('set-cookie', clearedSessionCookies(config));
    reply.code(204);
    return null;
  });

  app.get('/auth/me', { config: { auth: { mode: 'session' } } }, async (request) => {
    const auth = getAuth(request);
    const memberships = await loadMemberships(app.db, auth.user.id);
    const companies = await listAccessibleCompanies(app.db, auth.user.id);
    const response = buildMeResponse(auth.user, memberships, companies, auth.session, auth.session.activeCompanyId);
    const active = companies.find((company) => company.id === response.activeCompanyId);
    if (active && active.id !== auth.session.activeCompanyId) {
      await setSessionActiveCompany(app.db, auth.session.id, active.organisationId, active.id);
    }
    return response;
  });

  app.post('/auth/forgot-password', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const body = parseInput(forgotPasswordSchema, request.body);
    const email = normaliseEmail(body.email);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:forgot:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:forgot:email:${hashEmail(email)}`,
      config.loginMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    const result = await requestPasswordReset(app.db, config, email, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
    });
    if (result.email) {
      try {
        await emailSender.send(result.email);
      } catch (error) {
        request.log.error({ err: error }, 'password reset email delivery failed');
      }
    }
    reply.code(202);
    return { message: result.message };
  });

  app.post('/auth/reset-password', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const body = parseInput(resetPasswordSchema, request.body);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:reset:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    await resetPassword(app.db, config, body.token, body.password, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
    });
    return { message: 'Password updated. Sign in with the new password.' };
  });

  app.post('/auth/verify-email', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const body = parseInput(verifyEmailSchema, request.body);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:verify:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    await verifyEmail(app.db, config, body.token);
    return { message: 'Email verified.' };
  });

  app.post('/auth/resend-verification', { config: { auth: { mode: 'session' } } }, async (request, reply) => {
    const auth = getAuth(request);
    await rateLimitOrThrow(reply, app.db, `auth:verify:resend:${auth.user.id}`, 3, config.authRateLimitWindowMinutes);
    const result = await requestEmailVerification(app.db, config, auth.user, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
      sessionId: auth.session.id,
    });
    if (result.email) {
      try {
        await emailSender.send(result.email);
      } catch (error) {
        request.log.error({ err: error }, 'verification email delivery failed');
      }
    }
    reply.code(202);
    return { message: 'If verification is still required, a message has been sent.' };
  });

  app.get('/auth/invitations/:token', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const params = parseInput(z.object({ token: z.string().min(20).max(512) }), request.params);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:invitation:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    return getInvitationByToken(app.db, params.token);
  });

  app.post('/auth/invitations/accept', { config: { auth: { mode: 'optional' } } }, async (request, reply) => {
    const body = parseInput(acceptInvitationSchema, request.body);
    await rateLimitOrThrow(
      reply,
      app.db,
      `auth:invitation:accept:ip:${request.ip}`,
      config.authRateLimitMaxAttempts,
      config.authRateLimitWindowMinutes,
    );
    const auth = request.auth;
    const result = await acceptInvitation(
      app.db,
      config,
      {
        token: body.token,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.password === undefined ? {} : { password: body.password }),
        ...(auth
          ? {
              currentUser: auth.user,
              currentSessionId: auth.session.id,
              currentSession: {
                id: auth.session.id,
                idleExpiresAt: auth.session.idleExpiresAt,
                absoluteExpiresAt: auth.session.absoluteExpiresAt,
              },
            }
          : {}),
      },
      {
        ip: request.ip,
        userAgent: truncateUserAgent(request.headers['user-agent']),
        requestId: request.id,
      },
    );
    setSessionCookies(reply, config, result.issued);
    return { accepted: true, ...result.response };
  });

  app.post('/auth/change-password', { config: { auth: { mode: 'session' } } }, async (request) => {
    const auth = getAuth(request);
    const body = parseInput(changePasswordSchema, request.body);
    await changePassword(
      app.db,
      config,
      {
        userId: auth.user.id,
        sessionId: auth.session.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      },
      {
        ip: request.ip,
        userAgent: truncateUserAgent(request.headers['user-agent']),
        requestId: request.id,
        sessionId: auth.session.id,
      },
    );
    return { message: 'Password changed. Other sessions have been signed out.' };
  });

  app.get('/auth/sessions', { config: { auth: { mode: 'session' } } }, async (request) => {
    const auth = getAuth(request);
    const sessions = await listUserSessions(app.db, auth.user.id);
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        current: session.id === auth.session.id,
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
        revokedReason: session.revokedReason,
      })),
    };
  });

  app.delete('/auth/sessions/:sessionId', { config: { auth: { mode: 'session' } } }, async (request, reply) => {
    const auth = getAuth(request);
    const params = parseInput(sessionParamsSchema, request.params);
    const result = await revokeOwnSession(app.db, auth.user.id, params.sessionId, auth.session.id, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
      sessionId: auth.session.id,
    });
    if (result.revokedCurrent) {
      reply.header('set-cookie', clearedSessionCookies(config));
    }
    return { revoked: true, current: result.revokedCurrent };
  });

  app.post('/auth/csrf', { config: { auth: { mode: 'session', csrf: false } } }, async (request, reply) => {
    const auth = getAuth(request);
    const rotated = await rotateCsrfToken(app.db, auth.session.id);
    await writeAuditEvent(app.db, {
      actorUserId: auth.user.id,
      sessionId: auth.session.id,
      action: 'auth.csrf.rotated',
      entityType: 'session',
      entityId: auth.session.id,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
    });
    reply.header('set-cookie', csrfCookieHeader(config, rotated.csrfToken, rotated.expiresAt));
    return { csrfToken: rotated.csrfToken };
  });

  app.post('/auth/active-company', { config: { auth: { mode: 'session' } } }, async (request) => {
    const auth = getAuth(request);
    const body = parseInput(activeCompanySchema, request.body);
    return selectActiveCompany(app.db, auth.user.id, auth.session.id, body.companyId, {
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
      sessionId: auth.session.id,
    });
  });
};
