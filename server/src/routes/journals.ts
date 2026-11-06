import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import {
  approveJournal,
  createJournalDraft,
  getTrialBalance,
  getTrialBalanceAccount,
  listJournals,
  loadJournal,
  postJournal,
  reverseJournal,
  submitJournal,
  updateJournalDraft,
} from '../ledger/ledgerService.ts';
import { JOURNAL_BOOK_TYPES, JOURNAL_SOURCE_MODULES, JOURNAL_STATUSES } from '../ledger/constants.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const journalParams = z.object({ companyId: z.string().uuid(), journalId: z.string().uuid() });
const trialBalanceAccountParams = z.object({
  companyId: z.string().uuid(),
  accountId: z.string().uuid(),
});

const lineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.string().max(30),
  credit: z.string().max(30),
  partyReference: z.string().trim().max(200).optional().nullable(),
  partyName: z.string().trim().max(200).optional().nullable(),
  costCenter: z.string().trim().max(120).optional().nullable(),
  projectCode: z.string().trim().max(120).optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
});

const journalSchema = z.object({
  date: z.string().min(10).max(10),
  narration: z.string().trim().min(1).max(500),
  narrationBn: z.string().trim().max(500).optional().nullable(),
  bookType: z.enum(JOURNAL_BOOK_TYPES).optional(),
  branchId: z.string().uuid().optional().nullable(),
  attachmentReference: z.string().trim().max(500).optional().nullable(),
  lines: z.array(lineSchema).min(2).max(2000),
});

const listQuerySchema = z.object({
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  status: z.enum(JOURNAL_STATUSES).optional(),
  sourceModule: z.enum(JOURNAL_SOURCE_MODULES).optional(),
  branchId: z.string().uuid().optional(),
  branchScope: z.enum(['ALL', 'UNASSIGNED']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const trialBalanceQuerySchema = z
  .object({
    periodId: z.string().uuid().optional(),
    from: z.string().min(10).max(10).optional(),
    to: z.string().min(10).max(10).optional(),
    branchId: z.string().uuid().optional(),
    branchScope: z.enum(['ALL', 'UNASSIGNED']).optional(),
  })
  .superRefine((value, context) => {
    if (value.periodId) {
      if (value.from || value.to) {
        context.addIssue({
          code: 'custom',
          path: ['periodId'],
          message: 'Choose either an accounting period or a from/to range, not both.',
        });
      }
      return;
    }
    if (!value.from || !value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Choose an accounting period or provide both from and to dates.',
      });
    }
  });

const reverseSchema = z.object({
  date: z.string().min(10).max(10),
  reason: z.string().trim().min(3).max(500),
});

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address before posting to the ledger.');
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

export const journalRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/journals',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(listQuerySchema, request.query);
      return listJournals(app.db, companyId, {
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.sourceModule ? { sourceModule: query.sourceModule } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.branchScope ? { branchScope: query.branchScope } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/journals/:journalId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(journalParams, request.params);
      return { journal: await loadJournal(app.db, params.companyId, params.journalId) };
    },
  );

  app.post(
    '/companies/:companyId/journals',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(journalSchema, request.body);
      const journal = await createJournalDraft(app.db, {
        ...ctx.audit,
        companyId,
        ...body,
      });
      reply.code(201);
      return { journal };
    },
  );

  app.patch(
    '/companies/:companyId/journals/:journalId',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(journalParams, request.params);
      const body = parseInput(journalSchema, request.body);
      const journal = await updateJournalDraft(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        journalId: params.journalId,
        ...body,
      });
      return { journal };
    },
  );

  app.post(
    '/companies/:companyId/journals/:journalId/submit',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(journalParams, request.params);
      return { journal: await submitJournal(app.db, { ...ctx.audit, ...params }) };
    },
  );

  app.post(
    '/companies/:companyId/journals/:journalId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(journalParams, request.params);
      return { journal: await approveJournal(app.db, { ...ctx.audit, ...params }) };
    },
  );

  app.post(
    '/companies/:companyId/journals/:journalId/post',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(journalParams, request.params);
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      const result = await postJournal(app.db, {
        ...ctx.audit,
        ...params,
        idempotencyKey,
      });
      return result;
    },
  );

  app.post(
    '/companies/:companyId/journals/:journalId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(journalParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return reverseJournal(app.db, { ...ctx.audit, ...params, date: body.date, reason: body.reason });
    },
  );

  app.get(
    '/companies/:companyId/trial-balance',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(trialBalanceQuerySchema, request.query);
      return {
        trialBalance: await getTrialBalance(app.db, companyId, {
          ...(query.periodId ? { periodId: query.periodId } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(query.branchScope ? { branchScope: query.branchScope } : {}),
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/trial-balance/:accountId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(trialBalanceAccountParams, request.params);
      const query = parseInput(trialBalanceQuerySchema, request.query);
      return getTrialBalanceAccount(app.db, params.companyId, params.accountId, {
        ...(query.periodId ? { periodId: query.periodId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.branchScope ? { branchScope: query.branchScope } : {}),
      });
    },
  );
};
