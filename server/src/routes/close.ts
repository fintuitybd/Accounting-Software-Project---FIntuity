import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import {
  createCloseRun,
  decideCloseRun,
  exportClosePackCsv,
  getCloseRun,
  listCloseRuns,
  refreshCloseRun,
  reopenPeriod,
  submitCloseRun,
} from '../close/closeService.ts';
import {
  decideSuspenseResolution,
  getSuspenseOverview,
  requestSuspenseResolution,
} from '../suspense/suspenseService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const runParams = z.object({ companyId: z.string().uuid(), runId: z.string().uuid() });
const periodParams = z.object({ companyId: z.string().uuid(), periodId: z.string().uuid() });
const resolutionParams = z.object({
  companyId: z.string().uuid(),
  resolutionId: z.string().uuid(),
});

const listQuery = z.object({ periodId: z.string().uuid().optional() });
const createSchema = z.object({ periodId: z.string().uuid() });
const submitSchema = z.object({
  evidenceReference: z.string().trim().min(3).max(500),
  evidenceNote: z.string().trim().max(2000).optional().nullable(),
});
const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(3).max(500),
});
const reopenSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const suspenseRequestSchema = z.object({
  sourceLineId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  attachmentReference: z.string().trim().min(3).max(500),
});
const suspenseDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(3).max(500),
});

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address before changing a close.');
  }
}

function context(request: Parameters<typeof getAuth>[0]) {
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

export const closeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/close-runs',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(listQuery, request.query);
      return { closeRuns: await listCloseRuns(app.db, companyId, query.periodId ?? null) };
    },
  );

  app.get(
    '/companies/:companyId/close-runs/:runId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(runParams, request.params);
      return { closeRun: await getCloseRun(app.db, params.companyId, params.runId) };
    },
  );

  app.post(
    '/companies/:companyId/close-runs',
    { config: { auth: { mode: 'company', permission: 'SUBMIT_CLOSE_MAKER' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(createSchema, request.body);
      const closeRun = await createCloseRun(app.db, {
        ...ctx.audit,
        companyId,
        periodId: body.periodId,
      });
      reply.code(201);
      return { closeRun };
    },
  );

  app.post(
    '/companies/:companyId/close-runs/:runId/refresh',
    { config: { auth: { mode: 'company', permission: 'SUBMIT_CLOSE_MAKER' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(runParams, request.params);
      return {
        closeRun: await refreshCloseRun(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          runId: params.runId,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/close-runs/:runId/submit',
    { config: { auth: { mode: 'company', permission: 'SUBMIT_CLOSE_MAKER' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(runParams, request.params);
      const body = parseInput(submitSchema, request.body);
      return {
        closeRun: await submitCloseRun(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          runId: params.runId,
          evidenceReference: body.evidenceReference,
          evidenceNote: body.evidenceNote ?? null,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/close-runs/:runId/decide',
    { config: { auth: { mode: 'company', permission: 'APPROVE_CLOSE_CHECKER' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(runParams, request.params);
      const body = parseInput(decisionSchema, request.body);
      return {
        closeRun: await decideCloseRun(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          runId: params.runId,
          decision: body.decision,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/close-runs/:runId/pack.csv',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request, reply) => {
      const ctx = context(request);
      const params = parseInput(runParams, request.params);
      const exported = await exportClosePackCsv(app.db, params.companyId, params.runId, ctx.audit);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${exported.filename}"`);
      return exported.csv;
    },
  );

  app.post(
    '/companies/:companyId/periods/:periodId/reopen',
    { config: { auth: { mode: 'company', permission: 'REOPEN_PERIOD' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(periodParams, request.params);
      const body = parseInput(reopenSchema, request.body);
      return reopenPeriod(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        periodId: params.periodId,
        reason: body.reason,
      });
    },
  );

  app.get(
    '/companies/:companyId/suspense',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      return { suspense: await getSuspenseOverview(app.db, companyId) };
    },
  );

  app.post(
    '/companies/:companyId/suspense/resolutions',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(suspenseRequestSchema, request.body);
      const resolution = await requestSuspenseResolution(app.db, {
        ...ctx.audit,
        companyId,
        sourceLineId: body.sourceLineId,
        targetAccountId: body.targetAccountId,
        reason: body.reason,
        attachmentReference: body.attachmentReference,
      });
      reply.code(201);
      return { resolution };
    },
  );

  app.post(
    '/companies/:companyId/suspense/resolutions/:resolutionId/decide',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(resolutionParams, request.params);
      const body = parseInput(suspenseDecisionSchema, request.body);
      return {
        resolution: await decideSuspenseResolution(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          resolutionId: params.resolutionId,
          decision: body.decision,
          reason: body.reason,
        }),
      };
    },
  );
};
