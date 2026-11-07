import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import {
  getBankStatement,
  importBankStatement,
  listBankStatementLines,
  listBankStatements,
  previewBankStatement,
} from '../banking/statementService.ts';
import {
  approveBankGlRequest,
  assignBankLineException,
  cancelBankGlRequest,
  createBankGlRequest,
  excludeBankLine,
  getBankGlRequest,
  getBankLineDetail,
  listBankGlRequests,
  listMatchCandidates,
  matchStatementLine,
  rejectBankGlRequest,
  submitBankGlRequest,
  unmatchStatementLine,
} from '../banking/matchingService.ts';
import {
  createBankFeeRule,
  getBankFeePosting,
  listBankFeePostings,
  listBankFeeRules,
  postBankFee,
  setBankFeeRuleStatus,
} from '../banking/feeService.ts';
import {
  createBankTransfer,
  getBankTransfer,
  listBankTransfers,
  reverseBankTransfer,
} from '../banking/transferService.ts';
import {
  exportReconciliationReport,
  getCurrentReconciliation,
  listReconciliations,
  prepareReconciliation,
  reviewReconciliation,
} from '../banking/reconciliationService.ts';
import {
  listMfsWebhookEvents,
  processMfsWebhook,
  reconcilePgwBatch,
} from '../banking/mfsWebhookService.ts';

const mfsWebhookParams = z.object({
  companyId: z.string().uuid(),
  provider: z.string().trim(),
});

const mfsWebhookQuery = z.object({
  provider: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const pgwBatchReconcileSchema = z.object({
  provider: z.enum(['SSLCOMMERZ', 'AAMARPAY']),
  batchReference: z.string().trim().min(1).max(100),
  settlementDate: z.string().min(10).max(10),
  transactions: z
    .array(
      z.object({
        externalTrxId: z.string().trim().min(1),
        invoiceId: z.string().uuid().optional().nullable(),
        grossAmountPoisha: z.union([z.string(), z.number()]).optional(),
        amount: z.union([z.string(), z.number()]).optional(),
        mdrFeeBps: z.coerce.number().int().min(0).max(10000).optional(),
        valueDate: z.string().optional(),
      }),
    )
    .min(1),
});


const companyParams = z.object({ companyId: z.string().uuid() });
const bankAccountParams = z.object({ companyId: z.string().uuid(), bankAccountId: z.string().uuid() });
const statementParams = z.object({
  companyId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  statementId: z.string().uuid(),
});
const lineParams = z.object({ companyId: z.string().uuid(), lineId: z.string().uuid() });
const requestParams = z.object({ companyId: z.string().uuid(), requestId: z.string().uuid() });
const ruleParams = z.object({ companyId: z.string().uuid(), ruleId: z.string().uuid() });
const transferParams = z.object({ companyId: z.string().uuid(), transferId: z.string().uuid() });
const reconciliationParams = z.object({
  companyId: z.string().uuid(),
  reconciliationId: z.string().uuid(),
});

const mappingSchema = z.object({
  date: z.string().trim().max(120).optional(),
  description: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(120).optional().nullable(),
  debit: z.string().trim().max(120).optional(),
  credit: z.string().trim().max(120).optional(),
  balance: z.string().trim().max(120).optional().nullable(),
});

const previewSchema = z.object({
  content: z.string().min(1).max(5_000_000),
  mapping: mappingSchema.optional(),
});

const importSchema = previewSchema.extend({
  sourceFileName: z.string().trim().min(1).max(255),
  sourceMimeType: z.enum([
    'text/csv',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
});

const lineListQuery = z.object({
  status: z.enum(['UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'CATEGORIZED', 'EXCLUDED']).optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const statementListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const candidateQuery = z.object({
  windowDays: z.coerce.number().int().min(0).max(31).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const matchSchema = z.object({
  allocations: z
    .array(
      z.object({
        journalId: z.string().uuid(),
        journalLineId: z.string().uuid(),
        amount: z.string().trim().min(1).max(30),
      }),
    )
    .min(1)
    .max(100),
  matchType: z.enum(['EXACT', 'PARTIAL', 'MANUAL', 'SPLIT']).optional(),
  reason: z.string().trim().min(3).max(500),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const assignSchema = z.object({
  ownerUserId: z.string().uuid(),
  note: z.string().trim().min(3).max(500),
});

const glRequestSchema = z.object({
  amount: z.string().trim().min(1).max(30),
  primaryAccountId: z.string().uuid(),
  taxPoisha: z.string().trim().max(30).optional(),
  taxAccountId: z.string().uuid().optional().nullable(),
  partyId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().min(3).max(500),
  evidenceReference: z.string().trim().max(500).optional().nullable(),
});

const glListQuery = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'REVERSED']).optional(),
  bankAccountId: z.string().uuid().optional(),
  statementLineId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const feeRuleListQuery = z.object({
  bankAccountId: z.string().uuid().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

const feeRuleSchema = z.object({
  bankAccountId: z.string().uuid(),
  rateBps: z.number().int().min(0).max(10_000),
  fixedPoisha: z.string().trim().min(1).max(30),
  feeAccountId: z.string().uuid(),
  policyReference: z.string().trim().min(3).max(500),
  effectiveFrom: z.string().min(10).max(10),
  effectiveTo: z.string().min(10).max(10).optional().nullable(),
});

const feeRuleStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

const feePostSchema = z.object({
  overrideAmount: z.string().trim().max(30).optional(),
  overrideReason: z.string().trim().max(500).optional().nullable(),
  evidenceReference: z.string().trim().max(500).optional().nullable(),
  feeAccountId: z.string().uuid().optional().nullable(),
});

const transferSchema = z.object({
  fromBankAccountId: z.string().uuid(),
  toBankAccountId: z.string().uuid(),
  transferDate: z.string().min(10).max(10),
  amount: z.string().trim().min(1).max(30),
  reference: z.string().trim().min(1).max(200),
  narration: z.string().trim().max(500).optional().nullable(),
});

const transferListQuery = z.object({
  bankAccountId: z.string().uuid().optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const reverseSchema = z.object({
  date: z.string().min(10).max(10),
  reason: z.string().trim().min(3).max(500),
});

const reconciliationQuery = z.object({ periodId: z.string().uuid() });
const prepareReconciliationSchema = z.object({
  bankAccountId: z.string().uuid(),
  periodId: z.string().uuid(),
});
const reviewReconciliationSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  evidenceReference: z.string().trim().max(500).optional().nullable(),
});

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before changing banking or reconciliation records.',
    );
  }
}

function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = readIdempotencyKey(header);
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'This action requires an Idempotency-Key header so a retry cannot duplicate a journal, fee or import.',
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

export const bankingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/bank-accounts/:bankAccountId/statements',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(bankAccountParams, request.params);
      const query = parseInput(statementListQuery, request.query);
      return listBankStatements(app.db, params.companyId, params.bankAccountId, {
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/bank-accounts/:bankAccountId/statements/:statementId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(statementParams, request.params);
      return {
        statement: await getBankStatement(app.db, params.companyId, params.bankAccountId, params.statementId),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-accounts/:bankAccountId/statements/preview',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } }, bodyLimit: 12_000_000 },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(bankAccountParams, request.params);
      const body = parseInput(previewSchema, request.body);
      return {
        preview: await previewBankStatement(app.db, params.companyId, params.bankAccountId, {
          content: body.content,
          ...(body.mapping ? { mapping: body.mapping } : {}),
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-accounts/:bankAccountId/statements/import',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } }, bodyLimit: 12_000_000 },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(bankAccountParams, request.params);
      const body = parseInput(importSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await importBankStatement(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        bankAccountId: params.bankAccountId,
        sourceFileName: body.sourceFileName,
        sourceMimeType: body.sourceMimeType,
        content: body.content,
        ...(body.mapping ? { mapping: body.mapping } : {}),
        idempotencyKey,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/bank-accounts/:bankAccountId/bank-lines',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(bankAccountParams, request.params);
      const query = parseInput(lineListQuery, request.query);
      return listBankStatementLines(app.db, params.companyId, params.bankAccountId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/bank-lines/:lineId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(lineParams, request.params);
      return getBankLineDetail(app.db, params.companyId, params.lineId);
    },
  );

  app.get(
    '/companies/:companyId/bank-lines/:lineId/candidates',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(lineParams, request.params);
      const query = parseInput(candidateQuery, request.query);
      return listMatchCandidates(app.db, params.companyId, params.lineId, {
        ...(query.windowDays !== undefined ? { windowDays: query.windowDays } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/match',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(matchSchema, request.body);
      return matchStatementLine(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        lineId: params.lineId,
        allocations: body.allocations,
        ...(body.matchType ? { matchType: body.matchType } : {}),
        reason: body.reason,
      });
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/unmatch',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return unmatchStatementLine(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        lineId: params.lineId,
        reason: body.reason,
      });
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/exclude',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        line: await excludeBankLine(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          lineId: params.lineId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/assign-exception',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(assignSchema, request.body);
      return {
        line: await assignBankLineException(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          lineId: params.lineId,
          ownerUserId: body.ownerUserId,
          note: body.note,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/create-gl',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(glRequestSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await createBankGlRequest(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        lineId: params.lineId,
        amount: body.amount,
        primaryAccountId: body.primaryAccountId,
        ...(body.taxPoisha ? { taxPoisha: body.taxPoisha } : {}),
        taxAccountId: body.taxAccountId ?? null,
        partyId: body.partyId ?? null,
        reason: body.reason,
        evidenceReference: body.evidenceReference ?? null,
        idempotencyKey,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/bank-gl-requests',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(companyParams, request.params);
      const query = parseInput(glListQuery, request.query);
      return listBankGlRequests(app.db, params.companyId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
        ...(query.statementLineId ? { statementLineId: query.statementLineId } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/bank-gl-requests/:requestId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(requestParams, request.params);
      return { request: await getBankGlRequest(app.db, params.companyId, params.requestId) };
    },
  );

  app.post(
    '/companies/:companyId/bank-gl-requests/:requestId/submit',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(requestParams, request.params);
      return {
        request: await submitBankGlRequest(app.db, { ...ctx.audit, ...params }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-gl-requests/:requestId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(requestParams, request.params);
      return approveBankGlRequest(app.db, { ...ctx.audit, ...params });
    },
  );

  app.post(
    '/companies/:companyId/bank-gl-requests/:requestId/cancel',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(requestParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        request: await cancelBankGlRequest(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          requestId: params.requestId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-gl-requests/:requestId/reject',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(requestParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        request: await rejectBankGlRequest(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          requestId: params.requestId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-fee-rules',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(companyParams, request.params);
      const query = parseInput(feeRuleListQuery, request.query);
      return {
        rules: await listBankFeeRules(app.db, params.companyId, {
          ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
          includeInactive: query.includeInactive === 'true',
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-fee-rules',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(feeRuleSchema, request.body);
      const rule = await createBankFeeRule(app.db, {
        ...ctx.audit,
        companyId,
        bankAccountId: body.bankAccountId,
        rateBps: body.rateBps,
        fixedPoisha: body.fixedPoisha,
        feeAccountId: body.feeAccountId,
        policyReference: body.policyReference,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
      });
      reply.code(201);
      return { rule };
    },
  );

  app.patch(
    '/companies/:companyId/bank-fee-rules/:ruleId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(ruleParams, request.params);
      const body = parseInput(feeRuleStatusSchema, request.body);
      return {
        rule: await setBankFeeRuleStatus(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          ruleId: params.ruleId,
          status: body.status,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-fee-postings',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(companyParams, request.params);
      const query = z
        .object({
          bankAccountId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        })
        .parse(request.query);
      return {
        postings: await listBankFeePostings(app.db, params.companyId, {
          ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-lines/:lineId/fee',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(lineParams, request.params);
      return { posting: await getBankFeePosting(app.db, params.companyId, params.lineId) };
    },
  );

  app.post(
    '/companies/:companyId/bank-lines/:lineId/fee',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(lineParams, request.params);
      const body = parseInput(feePostSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await postBankFee(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        lineId: params.lineId,
        idempotencyKey,
        ...(body.overrideAmount ? { overrideAmount: body.overrideAmount } : {}),
        overrideReason: body.overrideReason ?? null,
        evidenceReference: body.evidenceReference ?? null,
        feeAccountId: body.feeAccountId ?? null,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/bank-transfers',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(companyParams, request.params);
      const query = parseInput(transferListQuery, request.query);
      return listBankTransfers(app.db, params.companyId, {
        ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/bank-transfers/:transferId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(transferParams, request.params);
      return { transfer: await getBankTransfer(app.db, params.companyId, params.transferId) };
    },
  );

  app.post(
    '/companies/:companyId/bank-transfers',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(transferSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await createBankTransfer(app.db, {
        ...ctx.audit,
        companyId,
        fromBankAccountId: body.fromBankAccountId,
        toBankAccountId: body.toBankAccountId,
        transferDate: body.transferDate,
        amount: body.amount,
        reference: body.reference,
        narration: body.narration ?? null,
        idempotencyKey,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.post(
    '/companies/:companyId/bank-transfers/:transferId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(transferParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return {
        transfer: await reverseBankTransfer(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          transferId: params.transferId,
          date: body.date,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-accounts/:bankAccountId/reconciliation',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(bankAccountParams, request.params);
      const query = parseInput(reconciliationQuery, request.query);
      return {
        reconciliation: await getCurrentReconciliation(app.db, params.companyId, params.bankAccountId, query.periodId),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-accounts/:bankAccountId/reconciliations',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(bankAccountParams, request.params);
      return {
        reconciliations: await listReconciliations(app.db, params.companyId, params.bankAccountId),
      };
    },
  );

  app.post(
    '/companies/:companyId/bank-reconciliations/prepare',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(prepareReconciliationSchema, request.body);
      const reconciliation = await prepareReconciliation(app.db, {
        ...ctx.audit,
        companyId,
        bankAccountId: body.bankAccountId,
        periodId: body.periodId,
      });
      reply.code(reconciliation.id ? 200 : 201);
      return { reconciliation };
    },
  );

  app.post(
    '/companies/:companyId/bank-reconciliations/:reconciliationId/review',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(reconciliationParams, request.params);
      const body = parseInput(reviewReconciliationSchema, request.body);
      return {
        reconciliation: await reviewReconciliation(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          reconciliationId: params.reconciliationId,
          note: body.note ?? null,
          evidenceReference: body.evidenceReference ?? null,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/bank-reconciliations/:reconciliationId/report',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(reconciliationParams, request.params);
      return exportReconciliationReport(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        reconciliationId: params.reconciliationId,
      });
    },
  );

  // MFS & PGW Webhooks (bKash, Nagad, SSLCommerz, AamarPay)
  const webhookHandler = async (request: any, reply: any) => {
    const params = parseInput(mfsWebhookParams, request.params);
    const providerUpper = params.provider.toUpperCase();

    const signature =
      (request.headers['x-bkash-signature'] as string) ||
      (request.headers['x-nagad-signature'] as string) ||
      (request.headers['x-sslcommerz-signature'] as string) ||
      (request.headers['x-aamarpay-signature'] as string) ||
      (request.headers['x-signature'] as string) ||
      (typeof request.headers.signature === 'string' ? request.headers.signature : undefined);

    const rawPayload =
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body ?? {});
    const bodyObj =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const result = await processMfsWebhook(app.db, {
      companyId: params.companyId,
      provider: providerUpper,
      signature,
      rawPayload,
      payload: bodyObj,
      audit: {
        ip: request.ip,
        userAgent: truncateUserAgent(request.headers['user-agent']),
        requestId: request.id,
      },
    });

    reply.code(result.replayed ? 200 : 201);
    return {
      success: true,
      event: result.event,
      replayed: result.replayed,
      journalId: result.journalId,
      statementLineId: result.statementLineId,
    };
  };

  app.post(
    '/companies/:companyId/banking/mfs/webhooks/:provider',
    { config: { auth: { mode: 'public' } } },
    webhookHandler,
  );
  app.post(
    '/companies/:companyId/mfs/webhooks/:provider',
    { config: { auth: { mode: 'public' } } },
    webhookHandler,
  );

  // List MFS & PGW Webhook Events
  const listWebhooksHandler = async (request: any) => {
    const params = parseInput(companyParams, request.params);
    const query = parseInput(mfsWebhookQuery, request.query);
    return listMfsWebhookEvents(app.db, params.companyId, query);
  };

  app.get(
    '/companies/:companyId/banking/mfs/webhooks',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    listWebhooksHandler,
  );
  app.get(
    '/companies/:companyId/mfs/webhooks',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    listWebhooksHandler,
  );

  // PGW Batch Settlement Reconciliation
  const pgwBatchHandler = async (request: any) => {
    const ctx = context(request);
    requireVerifiedEmail(ctx.auth);
    const params = parseInput(companyParams, request.params);
    const body = parseInput(pgwBatchReconcileSchema, request.body);
    const result = await reconcilePgwBatch(app.db, {
      ...ctx.audit,
      companyId: params.companyId,
      provider: body.provider,
      batchReference: body.batchReference,
      settlementDate: body.settlementDate,
      transactions: body.transactions,
    });
    return { success: true, result };
  };

  app.post(
    '/companies/:companyId/banking/mfs/settlements/reconcile',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    pgwBatchHandler,
  );
  app.post(
    '/companies/:companyId/mfs/settlements/reconcile',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    pgwBatchHandler,
  );
};
