import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { consumeRateLimit } from '../auth/rateLimit.ts';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';

const demoRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().min(3).max(320).email(),
    company: z.string().trim().min(1).max(200),
    message: z.string().trim().max(2000).optional(),
    source: z.enum(['landing', 'contact']).optional().default('landing'),
  })
  .strict();

function publicReference(id: string): string {
  return `DR-${id.slice(0, 8).toUpperCase()}`;
}

/**
 * Public, unauthenticated marketing endpoints. The only write is a demo request; there is no public
 * read and no company/financial data on this surface. Rate limiting is PostgreSQL-backed so it
 * cannot be bypassed by hitting a different API process.
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.post('/public/demo-requests', { config: { auth: { mode: 'public' } } }, async (request, reply) => {
    const body = parseInput(demoRequestSchema, request.body);

    const limit = await consumeRateLimit(app.db, `public:demo-request:ip:${request.ip}`, 5, 60 * 60, 60 * 60);
    if (!limit.allowed) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait and try again.');
    }

    const result = await app.db.query<{ id: string }>(
      `INSERT INTO demo_requests (name, email, company, message, source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
      [body.name, body.email.toLowerCase(), body.company, body.message || null, body.source],
    );
    const id = result.rows[0]!.id;

    // Never log the visitor's name, email, company or message. The id is enough for operations.
    request.log.info({ demoRequestId: id, source: body.source }, 'public demo request recorded');

    reply.code(201);
    return {
      id,
      reference: publicReference(id),
      message: 'Request received.',
    };
  });
};
