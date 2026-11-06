import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { SCHEDULE_TYPES } from '../company/openingBalanceService.ts';
import {
  approveOpeningBalanceBatch,
  createOpeningBalanceBatch,
  getOpeningBalanceBatch,
  listOpeningBalanceBatches,
  postOpeningBalanceBatch,
  submitOpeningBalanceBatch,
  updateOpeningBalanceBatch,
} from '../company/openingBalanceService.ts';
import { computeOnboarding } from '../company/onboardingService.ts';
import { readIdempotencyKey } from '../idempotency.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const batchParams = z.object({ companyId: z.string().uuid(), batchId: z.string().uuid() });

const scheduleSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    reference: z.string().trim().max(200).optional(),
    dueDate: z.string().max(10).optional(),
    quantity: z.string().trim().max(30).optional(),
    unitCost: z.string().trim().max(30).optional(),
    assetClass: z.string().trim().max(200).optional(),
    usefulLifeMonths: z.number().int().min(1).max(1200).optional(),
    accumulatedDepreciation: z.string().trim().max(30).optional(),
  })
  .strict();

const lineSchema = z.object({
  accountId: z.string().uuid(),
  scheduleType: z.enum(SCHEDULE_TYPES).default('ACCOUNT'),
  schedule: scheduleSchema.default({}),
  debit: z.string().trim().max(30),
  credit: z.string().trim().max(30),
  memo: z.string().trim().max(500).optional().nullable(),
});

const batchSchema = z.object({
  batchDate: z.string().min(10).max(10),
  evidenceReference: z.string().trim().max(200).optional().nullable(),
  evidenceNote: z.string().trim().max(1000).optional().nullable(),
  evidenceChecksum: z.string().trim().max(64).optional().nullable(),
  lines: z.array(lineSchema).max(2000).default([]),
});

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before preparing opening balances.',
    );
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

export const openingBalanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/opening-balances', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { batches: await listOpeningBalanceBatches(app.db, companyId) };
  });

  app.get(
    '/companies/:companyId/opening-balances/:batchId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(batchParams, request.params);
      return { batch: await getOpeningBalanceBatch(app.db, params.companyId, params.batchId) };
    },
  );

  app.post(
    '/companies/:companyId/opening-balances',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(batchSchema, request.body);
      const batch = await createOpeningBalanceBatch(app.db, {
        ...ctx.audit,
        companyId,
        batchDate: body.batchDate,
        evidenceReference: body.evidenceReference,
        evidenceNote: body.evidenceNote,
        evidenceChecksum: body.evidenceChecksum,
        lines: body.lines,
      });
      reply.code(201);
      return { batch, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.patch(
    '/companies/:companyId/opening-balances/:batchId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(batchParams, request.params);
      const body = parseInput(batchSchema, request.body);
      const batch = await updateOpeningBalanceBatch(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        batchId: params.batchId,
        batchDate: body.batchDate,
        evidenceReference: body.evidenceReference,
        evidenceNote: body.evidenceNote,
        evidenceChecksum: body.evidenceChecksum,
        lines: body.lines,
      });
      return { batch, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );

  app.post(
    '/companies/:companyId/opening-balances/:batchId/submit',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(batchParams, request.params);
      const batch = await submitOpeningBalanceBatch(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        batchId: params.batchId,
      });
      return { batch, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );

  app.post(
    '/companies/:companyId/opening-balances/:batchId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(batchParams, request.params);
      const batch = await approveOpeningBalanceBatch(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        batchId: params.batchId,
      });
      return { batch, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );

  app.post(
    '/companies/:companyId/opening-balances/:batchId/post',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(batchParams, request.params);
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      const result = await postOpeningBalanceBatch(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        batchId: params.batchId,
        idempotencyKey,
      });
      return { ...result, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );
};
