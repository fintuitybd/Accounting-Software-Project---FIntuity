import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { ACCOUNT_SUB_CATEGORIES, ACCOUNT_TYPES, CONTROL_SUBLEDGERS, IFRS_CATEGORIES } from '../company/constants.ts';
import { createAccount, csvTemplate, importAccounts, listAccounts, updateAccount } from '../company/accountService.ts';
import { computeOnboarding } from '../company/onboardingService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const accountParams = z.object({ companyId: z.string().uuid(), accountId: z.string().uuid() });

const accountSchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  accountType: z.enum(ACCOUNT_TYPES),
  subCategory: z.enum(ACCOUNT_SUB_CATEGORIES),
  ifrsCategory: z.enum(IFRS_CATEGORIES).default('NA_BALANCE_SHEET'),
  parentId: z.string().uuid().optional().nullable(),
  controlSubledger: z.enum(CONTROL_SUBLEDGERS).default('NONE'),
  taxMapping: z.record(z.string(), z.string()).default({}),
  isActive: z.boolean().default(true),
});

const listQuery = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
});

const importSchema = z
  .object({
    format: z.enum(['CSV', 'XLSX']),
    content: z.string().max(1_000_000).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
  })
  .superRefine((value, context) => {
    if (value.format === 'CSV' && !value.content) {
      context.addIssue({ code: 'custom', path: ['content'], message: 'CSV content is required.' });
    }
    if (value.format === 'XLSX' && (!value.rows || value.rows.length === 0)) {
      context.addIssue({ code: 'custom', path: ['rows'], message: 'XLSX rows are required.' });
    }
  });

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before changing the chart of accounts.',
    );
  }
}

function context(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    organisationId: auth.company.organisationId,
    companyId: auth.company.id,
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

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/accounts', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(listQuery, request.query);
    const accounts = await listAccounts(app.db, companyId, {
      includeInactive: query.includeInactive === 'true',
      ...(query.search ? { search: query.search } : {}),
      ...(query.type ? { type: query.type } : {}),
    });
    return { accounts };
  });

  app.get('/companies/:companyId/accounts/import-template', { config: { auth: { mode: 'company' } } }, async () => ({
    filename: 'chart-of-accounts-template.csv',
    content: csvTemplate(),
    columns: [
      'code',
      'name_en',
      'name_bn',
      'account_type',
      'sub_category',
      'ifrs_category',
      'control_subledger',
      'parent_code',
      'tax_mapping',
      'is_active',
    ],
  }));

  app.post(
    '/companies/:companyId/accounts/import',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(importSchema, request.body);
      const result = await importAccounts(app.db, {
        ...ctx.audit,
        companyId,
        format: body.format,
        ...(body.content === undefined ? {} : { content: body.content }),
        ...(body.rows === undefined ? {} : { rows: body.rows }),
      });
      return { ...result, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.post(
    '/companies/:companyId/accounts',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const account = parseInput(accountSchema, request.body);
      const created = await createAccount(app.db, {
        ...ctx.audit,
        companyId,
        account,
      });
      reply.code(201);
      return { account: created, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.patch(
    '/companies/:companyId/accounts/:accountId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(accountParams, request.params);
      const account = parseInput(accountSchema, request.body);
      const updated = await updateAccount(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        accountId: params.accountId,
        account,
      });
      return { account: updated, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );
};
