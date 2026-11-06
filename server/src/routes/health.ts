import type { FastifyPluginAsync } from 'fastify';

export interface HealthRoutesOptions {
  serviceName: string;
  serviceVersion: string;
}

interface LiveHealthBody {
  status: 'ok';
  service: string;
  version: string;
  uptime_seconds: number;
  timestamp: string;
  traceId: string;
}

interface DatabaseCheck {
  status: 'up' | 'down';
  latency_ms?: number;
  message?: string;
}

interface ReadyHealthBody {
  status: 'ok' | 'unavailable';
  service: string;
  version: string;
  timestamp: string;
  checks: {
    database: DatabaseCheck;
  };
  traceId: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health/live', { config: { auth: { mode: 'public' } } }, async (request): Promise<LiveHealthBody> => {
    return {
      status: 'ok',
      service: options.serviceName,
      version: options.serviceVersion,
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      traceId: request.id,
    };
  });

  app.get('/health', { config: { auth: { mode: 'public' } } }, async (request, reply): Promise<ReadyHealthBody> => {
    const startedAt = process.hrtime.bigint();
    try {
      await app.db.query('SELECT 1');
      const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
      return {
        status: 'ok',
        service: options.serviceName,
        version: options.serviceVersion,
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: 'up',
            latency_ms: Number(elapsedNanoseconds / 1_000_000n),
          },
        },
        traceId: request.id,
      };
    } catch (error) {
      request.log.error({ err: error }, 'database health check failed');
      reply.code(503);
      return {
        status: 'unavailable',
        service: options.serviceName,
        version: options.serviceVersion,
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: 'down',
            message: 'Database connectivity check failed.',
          },
        },
        traceId: request.id,
      };
    }
  });
};
