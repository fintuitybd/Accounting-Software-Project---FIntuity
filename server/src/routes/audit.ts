import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { exportAuditEventsCsv, listAuditEvents } from '../audit/auditQueryService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });

const auditQuerySchema = z.object({
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(200).optional(),
  actorUserId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

function companyContext(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    audit: {
      organisationId: auth.company.organisationId,
      companyId: auth.company.id,
      actorUserId: auth.user.id,
      sessionId: auth.session.id,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
      requestId: request.id,
    },
  };
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/audit-events',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(auditQuerySchema, request.query);
      return listAuditEvents(app.db, companyId, {
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/audit-events/export.csv',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request, reply) => {
      const context = companyContext(request);
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(auditQuerySchema, request.query);
      const exported = await exportAuditEventsCsv(
        app.db,
        companyId,
        {
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.entityType ? { entityType: query.entityType } : {}),
          ...(query.entityId ? { entityId: query.entityId } : {}),
          ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
          ...(query.q ? { q: query.q } : {}),
        },
        context.audit,
      );
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${exported.filename}"`);
      return exported.csv;
    },
  );
};
