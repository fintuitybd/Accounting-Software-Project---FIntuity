import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { resolveCompanyAccess, resolveOrganisationMembership } from './access.ts';
import { writeAuditEvent } from './audit.ts';
import { safeRequestPath } from '../redact.ts';
import { isPermission } from './permissions.ts';
import type { AuthRequestContext, AuthRouteConfig } from './routeConfig.ts';
import { resolveSession, verifyCsrf } from './session.ts';
import { readCookie, truncateUserAgent } from './tokens.ts';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isMutating(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

function allowedOrigins(appOrigin: string): Set<string> {
  const origins = new Set<string>([appOrigin]);
  try {
    const parsed = new URL(appOrigin);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        const candidate = new URL(appOrigin);
        candidate.hostname = host;
        origins.add(candidate.origin);
      }
    }
  } catch {
    // appOrigin is validated at configuration load.
  }
  return origins;
}

function assertSameOrigin(request: FastifyRequest, origins: Set<string>): void {
  const origin = request.headers.origin;
  if (!origin) return;
  if (!origins.has(origin)) {
    throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.');
  }
}

async function auditDenied(
  database: Pick<Pool, 'query'>,
  request: FastifyRequest,
  auth: AuthRequestContext | undefined,
  reason: string,
): Promise<void> {
  try {
    await writeAuditEvent(database, {
      organisationId: auth?.membership?.organisationId ?? auth?.company?.organisationId ?? null,
      companyId: auth?.company?.id ?? null,
      actorUserId: auth?.user.id ?? null,
      sessionId: auth?.session.id ?? null,
      action: 'auth.access.denied',
      entityType: 'route',
      entityId: `${request.method} ${safeRequestPath(request.url)}`,
      reason,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
      requestId: request.id,
    });
  } catch (error) {
    request.log.error({ err: error }, 'failed to append access-denied audit event');
  }
}

export interface RouteWithAuthConfig {
  method: string | string[];
  url: string;
  config?: { auth?: AuthRouteConfig };
}

/** Fail startup when a route forgets to declare how it is authorized. */
export function validateAuthRouteOptions(route: RouteWithAuthConfig): void {
  const config = route.config?.auth;
  if (!config) {
    throw new Error(
      `Route ${route.method} ${route.url} must declare config.auth (public, optional, session, organisation or company).`,
    );
  }
  if (config.mode === 'organisation' || config.mode === 'company') {
    if (config.permission !== undefined && !isPermission(config.permission)) {
      throw new Error(`Route ${route.method} ${route.url} declares an unknown permission.`);
    }
  }
}

export function createAuthGuard(config: AppConfig, database: Pool) {
  const origins = allowedOrigins(config.appOrigin);

  return async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    // Fastify still runs hooks for the not-found handler. There is no route to authorize there;
    // the dedicated 404 handler returns a stable envelope without touching tenant data.
    if (!request.routeOptions?.url) return;
    const routeConfig = request.routeOptions.config.auth as AuthRouteConfig | undefined;
    if (!routeConfig) {
      throw new AppError(500, 'ROUTE_AUTH_CONFIG_MISSING', 'Route authorization is not configured.');
    }

    const mutating = isMutating(request.method);
    if (mutating) assertSameOrigin(request, origins);
    if (routeConfig.mode === 'public') return;

    const params = request.params as Record<string, string | undefined>;
    const token = readCookie(request.headers.cookie, config.sessionCookieName);
    if (!token) {
      if (routeConfig.mode === 'optional') return;
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required.');
    }

    let resolved;
    try {
      resolved = await resolveSession(database, token, config);
    } catch (error) {
      // Public invitation acceptance may carry a stale cookie from an earlier session. Treat it
      // as anonymous rather than blocking the invitation; the service still requires a password
      // or an explicit, valid signed-in account.
      if (routeConfig.mode === 'optional' && error instanceof AppError && error.statusCode === 401) {
        return;
      }
      throw error;
    }
    const auth: AuthRequestContext = {
      user: resolved.user,
      session: resolved.session,
      permissions: [],
    };
    request.auth = auth;

    if (mutating && routeConfig.csrf !== false) {
      try {
        verifyCsrf(request.headers.cookie, request.headers['x-csrf-token'], resolved.session, config);
      } catch (error) {
        await auditDenied(database, request, auth, 'csrf_failed');
        throw error;
      }
    }

    if (routeConfig.mode === 'session' || routeConfig.mode === 'optional') {
      return;
    }

    if (routeConfig.mode === 'organisation') {
      const organisationId = params[routeConfig.organisationParam ?? 'organisationId'];
      const membership = isUuid(organisationId)
        ? await resolveOrganisationMembership(database, resolved.user.id, organisationId)
        : null;
      if (!membership) {
        await auditDenied(database, request, auth, 'organisation_membership_missing');
        throw new AppError(404, 'ORGANISATION_NOT_FOUND', 'Organisation not found.');
      }
      auth.membership = membership;
      auth.role = membership.role;
      auth.permissions = membership.permissions;
      if (routeConfig.permission && !auth.permissions.includes(routeConfig.permission)) {
        await auditDenied(database, request, auth, `permission:${routeConfig.permission}`);
        throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      return;
    }

    const companyId = params[routeConfig.companyParam ?? 'companyId'];
    const company = isUuid(companyId) ? await resolveCompanyAccess(database, resolved.user.id, companyId) : null;
    if (!company) {
      await auditDenied(database, request, auth, 'company_membership_missing');
      throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
    }
    auth.company = company;
    auth.role = company.role;
    auth.permissions = company.permissions;
    if (routeConfig.permission && !company.permissions.includes(routeConfig.permission)) {
      await auditDenied(database, request, auth, `permission:${routeConfig.permission}`);
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
  };
}

export function getAuth(request: FastifyRequest): AuthRequestContext {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required.');
  }
  return request.auth;
}
