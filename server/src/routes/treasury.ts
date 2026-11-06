import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import {
  cancelTreasuryCertificate,
  getTreasuryCertificate,
  getTreasuryChallan,
  getTreasuryProof,
  listTreasuryCertificates,
  listTreasuryChallans,
  listTreasuryLiabilities,
  postTreasuryChallan,
  recordCustomerMushak66,
  reissueTreasuryCertificate,
  reverseTreasuryChallan,
  setTreasuryLiabilityEconomicCode,
} from '../treasury/treasuryService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const liabilityParams = z.object({ companyId: z.string().uuid(), liabilityId: z.string().uuid() });
const challanParams = z.object({ companyId: z.string().uuid(), challanId: z.string().uuid() });
const certificateParams = z.object({ companyId: z.string().uuid(), certificateId: z.string().uuid() });

const liabilityQuery = z.object({
  status: z.enum(['PENDING', 'DEPOSITED', 'REVERSED']).optional(),
  taxType: z.enum(['VDS', 'TDS', 'REVERSE_CHARGE']).optional(),
  partyId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const economicCodeSchema = z.object({ economicCode: z.string().trim().min(1).max(32) });

const depositSchema = z.object({
  depositDate: z.string().min(10).max(10),
  bankAccountId: z.string().uuid(),
  bankBranch: z.string().trim().min(1).max(200),
  depositReference: z.string().trim().min(1).max(200),
  evidenceReference: z.string().trim().min(1).max(500),
  items: z
    .array(
      z.object({
        liabilityId: z.string().uuid(),
        economicCode: z.string().trim().min(1).max(32),
      }),
    )
    .min(1)
    .max(500),
});

const challanListQuery = z.object({
  status: z.enum(['POSTED', 'REVERSED']).optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const reverseSchema = z.object({
  date: z.string().min(10).max(10),
  reason: z.string().trim().min(3).max(500),
});

const certificateListQuery = z.object({
  type: z.enum(['VDS', 'TDS']).optional(),
  status: z.enum(['DRAFT', 'CANCELLED']).optional(),
  direction: z.enum(['ISSUED', 'RECEIVED']).optional(),
  partyId: z.string().uuid().optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const certificateReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const reissueSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  evidenceReference: z.string().trim().max(500).optional().nullable(),
});
const recordCustomerMushak66Schema = z.object({
  partyId: z.string().uuid(),
  certificateNumber: z.string().trim().min(1).max(100),
  certificateDate: z.string().min(10).max(10),
  basePoisha: z.string().regex(/^[0-9]+$/),
  taxPoisha: z.string().regex(/^[0-9]+$/),
  evidenceReference: z.string().trim().max(500).optional().nullable(),
});

const proofQuery = z.object({ asOf: z.string().min(10).max(10).optional() });

function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = readIdempotencyKey(header);
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Posting a treasury challan requires an Idempotency-Key header so a retry cannot duplicate the deposit or certificate.',
    );
  }
  return key;
}

function context(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    audit: {
      organisationId: auth.company.organisationId,
      actorUserId: auth.user.id,
      sessionId: auth.session.id,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
      requestId: request.id,
    },
  };
}

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before changing treasury records.',
    );
  }
}

export const treasuryRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/treasury/liabilities',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(liabilityQuery, request.query);
      return listTreasuryLiabilities(app.db, companyId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.taxType ? { taxType: query.taxType } : {}),
        ...(query.partyId ? { partyId: query.partyId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.patch(
    '/companies/:companyId/treasury/liabilities/:liabilityId/economic-code',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(liabilityParams, request.params);
      const body = parseInput(economicCodeSchema, request.body);
      return {
        liability: await setTreasuryLiabilityEconomicCode(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          liabilityId: params.liabilityId,
          economicCode: body.economicCode,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/treasury/challans',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(challanListQuery, request.query);
      return listTreasuryChallans(app.db, companyId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.post(
    '/companies/:companyId/treasury/challans',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(depositSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await postTreasuryChallan(app.db, {
        ...ctx.audit,
        companyId,
        idempotencyKey,
        deposit: body,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/treasury/challans/:challanId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(challanParams, request.params);
      return { challan: await getTreasuryChallan(app.db, params.companyId, params.challanId) };
    },
  );

  app.post(
    '/companies/:companyId/treasury/challans/:challanId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(challanParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return {
        challan: await reverseTreasuryChallan(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          challanId: params.challanId,
          date: body.date,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/treasury/certificates',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(certificateListQuery, request.query);
      return listTreasuryCertificates(app.db, companyId, {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.partyId ? { partyId: query.partyId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/treasury/certificates/:certificateId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(certificateParams, request.params);
      return { certificate: await getTreasuryCertificate(app.db, params.companyId, params.certificateId) };
    },
  );

  app.post(
    '/companies/:companyId/treasury/certificates/customer',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(companyParams, request.params);
      const body = parseInput(recordCustomerMushak66Schema, request.body);
      const certificate = await recordCustomerMushak66(app.db, {
        companyId: params.companyId,
        actorUserId: ctx.auth.user.id,
        partyId: body.partyId,
        certificateNumber: body.certificateNumber,
        certificateDate: body.certificateDate,
        basePoisha: BigInt(body.basePoisha),
        taxPoisha: BigInt(body.taxPoisha),
        evidenceReference: body.evidenceReference,
      });
      reply.status(201);
      return { certificate };
    },
  );

  app.post(
    '/companies/:companyId/treasury/certificates/:certificateId/cancel',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(certificateParams, request.params);
      const body = parseInput(certificateReasonSchema, request.body);
      return {
        certificate: await cancelTreasuryCertificate(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          certificateId: params.certificateId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/treasury/certificates/:certificateId/reissue',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(certificateParams, request.params);
      const body = parseInput(reissueSchema, request.body);
      return {
        certificate: await reissueTreasuryCertificate(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          certificateId: params.certificateId,
          reason: body.reason,
          evidenceReference: body.evidenceReference ?? null,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/treasury/proof',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(proofQuery, request.query);
      const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);
      return { proof: await getTreasuryProof(app.db, companyId, asOf) };
    },
  );
};
