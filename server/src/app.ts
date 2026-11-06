import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { AppConfig } from './config.ts';
import { createDatabase } from './db/client.ts';
import { createErrorHandler, type ErrorEnvelope } from './errors.ts';
import { createAuthGuard, validateAuthRouteOptions } from './auth/context.ts';
import type { EmailSender } from './auth/email.ts';
import { safeRequestPath } from './redact.ts';
import { authRoutes } from './routes/auth.ts';
import { companyRoutes } from './routes/companies.ts';
import { companySetupRoutes } from './routes/companySetup.ts';
import { accountRoutes } from './routes/accounts.ts';
import { openingBalanceRoutes } from './routes/openingBalances.ts';
import { journalRoutes } from './routes/journals.ts';
import { masterDataRoutes } from './routes/masters.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { salesRoutes } from './routes/sales.ts';
import { purchaseRoutes } from './routes/purchases.ts';
import { treasuryRoutes } from './routes/treasury.ts';
import { bankingRoutes } from './routes/banking.ts';
import { reportRoutes } from './routes/reports.ts';
import { closeRoutes } from './routes/close.ts';
import { auditRoutes } from './routes/audit.ts';
import { organisationRoutes } from './routes/organisations.ts';
import { healthRoutes } from './routes/health.ts';
import { metaRoutes } from './routes/meta.ts';
import { publicRoutes } from './routes/public.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_BODY_BYTES = 1_048_576;

function acceptRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export interface BuildAppOptions {
  config: AppConfig;
  pool: Pool;
  logger: Logger;
  /** Tests inject a memory sender; production wiring decides the delivery provider. */
  emailSender?: EmailSender;
}

/**
 * Build the HTTP application without listening on a port. Tests inject requests directly and the
 * production entrypoint owns listening, process signals and pool shutdown.
 */
export async function buildApp(options: BuildAppOptions) {
  const { config, pool, logger } = options;

  const app = Fastify({
    loggerInstance: logger,
    ...(config.trustProxy ? { trustProxy: true } : {}),
    genReqId: (request) => acceptRequestId(request.headers['x-request-id']),
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_BODY_BYTES,
  });

  app.decorate('db', pool);
  app.decorate('orm', createDatabase(pool));

  app.addHook('onRequest', async (request) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        path: safeRequestPath(request.url),
      },
      'request received',
    );
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (config.nodeEnv === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        path: safeRequestPath(request.url),
        statusCode: reply.statusCode,
        elapsedMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  app.setErrorHandler(createErrorHandler(config.nodeEnv));

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorEnvelope = {
      code: 'NOT_FOUND',
      message: 'Route not found.',
      traceId: request.id,
    };
    reply.code(404).send(body);
  });

  // Every route must declare its auth mode; the startup hook fails closed if one does not.
  app.addHook('onRoute', (route) => validateAuthRouteOptions(route));
  app.addHook('preHandler', createAuthGuard(config, pool));

  await app.register(healthRoutes, {
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
  });
  await app.register(metaRoutes, { prefix: '/api/v1' });
  await app.register(publicRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, {
    prefix: '/api/v1',
    config,
    ...(options.emailSender ? { emailSender: options.emailSender } : {}),
  });
  await app.register(organisationRoutes, {
    prefix: '/api/v1',
    config,
    ...(options.emailSender ? { emailSender: options.emailSender } : {}),
  });
  await app.register(companyRoutes, { prefix: '/api/v1' });
  await app.register(companySetupRoutes, { prefix: '/api/v1' });
  await app.register(accountRoutes, { prefix: '/api/v1' });
  await app.register(openingBalanceRoutes, { prefix: '/api/v1' });
  await app.register(journalRoutes, { prefix: '/api/v1' });
  await app.register(masterDataRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(salesRoutes, { prefix: '/api/v1' });
  await app.register(purchaseRoutes, { prefix: '/api/v1' });
  await app.register(treasuryRoutes, { prefix: '/api/v1' });
  await app.register(bankingRoutes, { prefix: '/api/v1' });
  await app.register(reportRoutes, { prefix: '/api/v1' });
  await app.register(closeRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });

  if (config.nodeEnv === 'production' && config.emailTransport === 'file') {
    logger.warn(
      'EMAIL_TRANSPORT=file is active in production. Invitation, verification and reset messages are written to the local outbox, not delivered. Configure a real provider before go-live.',
    );
  }

  return app;
}
