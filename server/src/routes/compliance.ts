import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import {
  generateComplianceEventsForFiscalYear,
  getComplianceSummary,
  listComplianceEvents,
  listGazettedHolidays,
  recordFilingAndAck,
  type ComplianceCategory,
  type ComplianceStatus,
  type StatutoryBody,
} from '../compliance/calendarService.ts';

const companyParams = z.object({
  companyId: z.string().uuid(),
});

const eventParams = z.object({
  companyId: z.string().uuid(),
  eventId: z.string().uuid(),
});

const eventsQuerySchema = z.object({
  fiscalYearId: z.string().uuid().optional().nullable(),
  periodId: z.string().uuid().optional().nullable(),
  category: z
    .enum(['VAT_91', 'VDS_DEPOSIT', 'TDS_MONTHLY', 'TDS_177', 'AIT_Q', 'ANNUAL_TAX', 'RJSC_ANNUAL'])
    .optional()
    .nullable(),
  status: z.enum(['PENDING', 'PREPARED', 'FILED', 'OVERDUE']).optional().nullable(),
  statutoryBody: z.enum(['NBR_VAT', 'NBR_TAX', 'RJSC', 'MOLE']).optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const generateSchema = z.object({
  fiscalYearId: z.string().uuid().optional().nullable(),
});

const fileEventSchema = z.object({
  filingReference: z.string().trim().min(2).max(255),
  notes: z.string().trim().max(1000).optional().nullable(),
  lockPeriod: z.boolean().optional(),
});

function context(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  const company = auth.company;
  if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    company,
    audit: {
      organisationId: company.organisationId,
      companyId: company.id,
      actorUserId: auth.user.id,
      sessionId: auth.session.id,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
      requestId: request.id,
    },
  };
}

export const complianceRoutes: FastifyPluginAsync = async (app) => {
  // 1. Executive Summary & Pulse KPIs
  app.get(
    '/companies/:companyId/compliance/summary',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const summary = await getComplianceSummary(app.db, companyId);
      return { summary };
    },
  );

  // 2. Timeline Grid & Calendar Matrix Events
  app.get(
    '/companies/:companyId/compliance/events',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(eventsQuerySchema, request.query);
      const events = await listComplianceEvents(app.db, companyId, {
        fiscalYearId: query.fiscalYearId ?? null,
        periodId: query.periodId ?? null,
        category: (query.category as ComplianceCategory) ?? null,
        status: (query.status as ComplianceStatus) ?? null,
        statutoryBody: (query.statutoryBody as StatutoryBody) ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      });
      return { events };
    },
  );

  // 3. Generate / Refresh Statutory Schedule
  app.post(
    '/companies/:companyId/compliance/generate',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(generateSchema, request.body ?? {});
      const result = await generateComplianceEventsForFiscalYear(app.db, companyId, body.fiscalYearId ?? null);
      reply.code(201);
      return result;
    },
  );

  // 4. Record NBR ACK / Filing Reference & Optional Period Lock
  app.post(
    '/companies/:companyId/compliance/events/:eventId/file',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const { companyId, eventId } = parseInput(eventParams, request.params);
      const body = parseInput(fileEventSchema, request.body);
      const ctx = context(request);

      const event = await recordFilingAndAck(app.db, companyId, eventId, {
        filingReference: body.filingReference,
        notes: body.notes ?? null,
        lockPeriod: body.lockPeriod ?? false,
        actorUserId: ctx.auth.user.id,
        organisationId: ctx.company.organisationId,
        sessionId: ctx.auth.session.id,
        ip: ctx.audit.ip,
        userAgent: ctx.audit.userAgent,
        requestId: ctx.audit.requestId,
      });

      return { event };
    },
  );

  // 5. Gazetted Holidays List
  app.get(
    '/companies/:companyId/compliance/holidays',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const holidays = await listGazettedHolidays(app.db, companyId);
      return { holidays };
    },
  );
};
