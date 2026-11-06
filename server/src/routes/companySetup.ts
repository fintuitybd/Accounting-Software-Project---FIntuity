import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import type { Permission } from '../auth/permissions.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import {
  BANK_ACCOUNT_KINDS,
  ENTITY_TYPES,
  FILING_FREQUENCIES,
  INDUSTRY_PACKS,
  ONBOARDING_STEPS,
  REPORTING_FRAMEWORKS,
  VAT_REGISTRATION_STATUSES,
} from '../company/constants.ts';
import { createCompany, getCompanyProfile, updateCompanyProfile } from '../company/companyService.ts';
import { createFiscalYear, findPeriodForDate, listFiscalYears, listPeriods } from '../company/periodService.ts';
import { createBankAccount, listBankAccounts, updateBankAccount } from '../company/bankAccountService.ts';
import { getCompanySettings, updateCompanySettings } from '../company/settingsService.ts';
import { completeOnboarding, computeOnboarding, setOnboardingStep } from '../company/onboardingService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const organisationParams = z.object({ organisationId: z.string().uuid() });
const bankParams = z.object({ companyId: z.string().uuid(), bankAccountId: z.string().uuid() });
const profileSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().max(200).optional().nullable(),
  entityType: z.enum(ENTITY_TYPES),
  industry: z.enum(INDUSTRY_PACKS),
  tin: z.string().trim().max(32).optional().nullable(),
  bin: z.string().trim().max(32).optional().nullable(),
  rjscNo: z.string().trim().max(64).optional().nullable(),
  address: z.string().trim().min(1).max(500),
  phone: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().max(320).optional().nullable(),
  reportingFramework: z.enum(REPORTING_FRAMEWORKS),
  baseCurrency: z.literal('BDT').optional(),
  timezone: z.literal('Asia/Dhaka').optional(),
});

const profilePatchSchema = profileSchema.partial();

const fiscalYearSchema = z.object({
  startDate: z.string().min(10).max(10),
  endDate: z.string().min(10).max(10),
  label: z.string().trim().min(1).max(60).optional(),
});

const periodQuerySchema = z.object({ date: z.string().min(1).max(10) });

const bankSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(BANK_ACCOUNT_KINDS),
  provider: z.string().trim().max(120).optional().nullable(),
  maskedNumber: z.string().trim().max(40).optional().nullable(),
  branch: z.string().trim().max(120).optional().nullable(),
  glAccountId: z.string().uuid(),
  openingBalance: z.string().max(30),
  isPrincipal: z.boolean().optional(),
});

const bankPatchSchema = bankSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const settingsSchema = z.object({
  language: z.enum(['en-BD', 'bn-BD']).optional(),
  reportingFramework: z.enum(REPORTING_FRAMEWORKS).optional(),
  timezone: z.literal('Asia/Dhaka').optional(),
  approvalThresholds: z
    .object({
      highValue: z.string().max(30).optional(),
      payment: z.string().max(30).optional(),
    })
    .optional(),
  tax: z
    .object({
      vatStatus: z.enum(VAT_REGISTRATION_STATUSES).nullable().optional(),
      filingFrequency: z.enum(FILING_FREQUENCIES).optional(),
      withholdingEntity: z.boolean().optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
  fiscalYearId: z.string().uuid().optional(),
  numberSequences: z
    .array(
      z.object({
        docType: z.string().min(1).max(40),
        prefix: z.string().trim().min(1).max(20),
        nextValue: z.string().regex(/^[1-9][0-9]{0,17}$/),
        pad: z.number().int().min(1).max(12),
      }),
    )
    .max(50)
    .optional(),
});

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before creating or configuring a company.',
    );
  }
}

function companyContext(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    companyId: auth.company.id,
    organisationId: auth.company.organisationId,
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

function requireAnyPermission(auth: ReturnType<typeof getAuth>, permissions: readonly Permission[]): void {
  if (!permissions.some((permission) => auth.permissions.includes(permission))) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  }
}

export const companySetupRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/organisations/:organisationId/companies',
    { config: { auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' } } },
    async (request, reply) => {
      const auth = getAuth(request);
      requireVerifiedEmail(auth);
      if (!auth.membership) throw new AppError(403, 'FORBIDDEN', 'Organisation access is required.');
      if (!['OWNER', 'ADMIN'].includes(auth.membership.role)) {
        throw new AppError(403, 'FORBIDDEN', 'Only an owner or administrator can create a company.');
      }
      const params = parseInput(organisationParams, request.params);
      if (params.organisationId !== auth.membership.organisationId) {
        throw new AppError(404, 'ORGANISATION_NOT_FOUND', 'Organisation not found.');
      }
      const profile = parseInput(profileSchema, request.body);
      const company = await createCompany(app.db, {
        organisationId: params.organisationId,
        membershipId: auth.membership.membershipId,
        actorUserId: auth.user.id,
        sessionId: auth.session.id,
        ip: request.ip,
        userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
        requestId: request.id,
        profile,
      });
      reply.code(201);
      return { company, onboarding: await computeOnboarding(app.db, company.id) };
    },
  );

  app.get('/companies/:companyId/profile', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { company: await getCompanyProfile(app.db, companyId) };
  });

  app.patch(
    '/companies/:companyId/profile',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const patch = parseInput(profilePatchSchema, request.body);
      const company = await updateCompanyProfile(app.db, {
        ...context.audit,
        companyId,
        patch,
      });
      return { company, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.get('/companies/:companyId/onboarding', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { onboarding: await computeOnboarding(app.db, companyId) };
  });

  app.patch('/companies/:companyId/onboarding', { config: { auth: { mode: 'company' } } }, async (request) => {
    const context = companyContext(request);
    requireAnyPermission(context.auth, ['MANAGE_COMPANY_SETTINGS', 'MANAGE_MASTERS_AND_COA']);
    const { companyId } = parseInput(companyParams, request.params);
    const body = parseInput(z.object({ currentStep: z.enum(ONBOARDING_STEPS) }), request.body);
    return {
      onboarding: await setOnboardingStep(app.db, {
        ...context.audit,
        companyId,
        currentStep: body.currentStep,
      }),
    };
  });

  app.post(
    '/companies/:companyId/onboarding/complete',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const { companyId } = parseInput(companyParams, request.params);
      return {
        onboarding: await completeOnboarding(app.db, {
          ...context.audit,
          companyId,
        }),
      };
    },
  );

  app.get('/companies/:companyId/fiscal-years', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { fiscalYears: await listFiscalYears(app.db, companyId) };
  });

  app.post(
    '/companies/:companyId/fiscal-years',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request, reply) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(fiscalYearSchema, request.body);
      const fiscalYear = await createFiscalYear(app.db, {
        ...context.audit,
        companyId,
        startDate: body.startDate,
        endDate: body.endDate,
        ...(body.label ? { label: body.label } : {}),
      });
      reply.code(201);
      return { fiscalYear, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.get('/companies/:companyId/periods', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { periods: await listPeriods(app.db, companyId) };
  });

  app.get('/companies/:companyId/periods/resolve', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const { date } = parseInput(periodQuerySchema, request.query);
    const period = await findPeriodForDate(app.db, companyId, date);
    if (!period) {
      throw new AppError(404, 'PERIOD_NOT_FOUND', `No accounting period is configured for ${date}.`);
    }
    return { date, period };
  });

  app.get('/companies/:companyId/bank-accounts', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { bankAccounts: await listBankAccounts(app.db, companyId) };
  });

  app.post(
    '/companies/:companyId/bank-accounts',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request, reply) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(bankSchema, request.body);
      const bankAccount = await createBankAccount(app.db, {
        ...context.audit,
        companyId,
        account: body,
      });
      reply.code(201);
      return { bankAccount, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );

  app.patch(
    '/companies/:companyId/bank-accounts/:bankAccountId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const params = parseInput(bankParams, request.params);
      const patch = parseInput(bankPatchSchema, request.body);
      const bankAccount = await updateBankAccount(app.db, {
        ...context.audit,
        companyId: params.companyId,
        bankAccountId: params.bankAccountId,
        patch,
      });
      return { bankAccount, onboarding: await computeOnboarding(app.db, params.companyId) };
    },
  );

  app.get('/companies/:companyId/settings', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { settings: await getCompanySettings(app.db, companyId) };
  });

  app.patch(
    '/companies/:companyId/settings',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const context = companyContext(request);
      requireVerifiedEmail(context.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const patch = parseInput(settingsSchema, request.body);
      const settings = await updateCompanySettings(app.db, {
        ...context.audit,
        companyId,
        patch,
      });
      return { settings, onboarding: await computeOnboarding(app.db, companyId) };
    },
  );
};
