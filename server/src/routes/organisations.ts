import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { listAccessibleCompanies, loadOrganisationInvitations, loadOrganisationMembers } from '../auth/access.ts';
import { getAuth } from '../auth/context.ts';
import { createEmailSender, type EmailSender } from '../auth/email.ts';
import { createOrResendInvitation, resendInvitation, revokeInvitation } from '../auth/invitationService.ts';
import { updateMembership } from '../auth/memberService.ts';
import { isRole, ROLES } from '../auth/permissions.ts';
import { consumeRateLimit } from '../auth/rateLimit.ts';
import { truncateUserAgent } from '../auth/tokens.ts';

const roleSchema = z.enum(ROLES);
const organisationParamsSchema = z.object({ organisationId: z.string().uuid() });
const memberParamsSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
});
const invitationParamsSchema = z.object({
  organisationId: z.string().uuid(),
  invitationId: z.string().uuid(),
});
const createInvitationSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  role: roleSchema,
  companyIds: z.array(z.string().uuid()).max(100).default([]),
});
const updateMemberSchema = z
  .object({
    role: roleSchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Provide a role or status change.',
  });

export interface OrganisationRoutesOptions {
  config: AppConfig;
  emailSender?: EmailSender;
}

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before changing users or sending invitations.',
    );
  }
}

async function limit(app: FastifyInstance, key: string, max: number, windowMinutes: number): Promise<void> {
  const result = await consumeRateLimit(app.db, key, max, windowMinutes * 60, windowMinutes * 60);
  if (!result.allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Wait and try again.');
  }
}

export const organisationRoutes: FastifyPluginAsync<OrganisationRoutesOptions> = async (app, options) => {
  const { config } = options;
  const emailSender = options.emailSender ?? createEmailSender(config);

  app.get(
    '/organisations/:organisationId/members',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request) => {
      const params = parseInput(organisationParamsSchema, request.params);
      return { members: await loadOrganisationMembers(app.db, params.organisationId) };
    },
  );

  app.patch(
    '/organisations/:organisationId/members/:userId',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request) => {
      const auth = getAuth(request);
      requireVerifiedEmail(auth);
      const params = parseInput(memberParamsSchema, request.params);
      const body = parseInput(updateMemberSchema, request.body);
      if (!auth.membership) throw new AppError(403, 'FORBIDDEN', 'Organisation access is required.');
      if (body.role !== undefined && !isRole(body.role)) {
        throw new AppError(400, 'INVALID_ROLE', 'Invalid role.');
      }
      await updateMembership(
        app.db,
        {
          actor: auth.membership,
          actorUserId: auth.user.id,
          targetUserId: params.userId,
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.status === undefined ? {} : { status: body.status }),
        },
        {
          ip: request.ip,
          userAgent: truncateUserAgent(request.headers['user-agent']),
          requestId: request.id,
          sessionId: auth.session.id,
        },
      );
      return { updated: true };
    },
  );

  app.get(
    '/organisations/:organisationId/invitations',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request) => {
      const params = parseInput(organisationParamsSchema, request.params);
      return { invitations: await loadOrganisationInvitations(app.db, params.organisationId) };
    },
  );

  app.post(
    '/organisations/:organisationId/invitations',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      requireVerifiedEmail(auth);
      const params = parseInput(organisationParamsSchema, request.params);
      const body = parseInput(createInvitationSchema, request.body);
      if (!auth.membership || params.organisationId !== auth.membership.organisationId) {
        throw new AppError(404, 'ORGANISATION_NOT_FOUND', 'Organisation not found.');
      }
      await limit(app, `invitation:create:${auth.user.id}`, 20, config.authRateLimitWindowMinutes);

      const result = await createOrResendInvitation(app.db, config, {
        actor: auth.membership,
        actorUserId: auth.user.id,
        actorEmail: auth.user.email,
        email: body.email,
        role: body.role,
        companyIds: body.companyIds,
      });

      let emailDelivered = true;
      try {
        await emailSender.send(result.email);
      } catch (error) {
        emailDelivered = false;
        request.log.error({ err: error, invitationId: result.invitation.id }, 'invitation email delivery failed');
      }
      reply.code(result.reused ? 200 : 201);
      return {
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          role: result.invitation.role,
          expiresAt: result.invitation.expiresAt.toISOString(),
        },
        reused: result.reused,
        emailDelivered,
        message: emailDelivered
          ? 'Invitation sent.'
          : 'Invitation saved, but email delivery failed. Use Resend after checking the mail configuration.',
      };
    },
  );

  app.post(
    '/organisations/:organisationId/invitations/:invitationId/resend',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request) => {
      const auth = getAuth(request);
      requireVerifiedEmail(auth);
      const params = parseInput(invitationParamsSchema, request.params);
      await limit(app, `invitation:resend:${auth.user.id}`, 10, config.authRateLimitWindowMinutes);
      const result = await resendInvitation(app.db, config, {
        invitationId: params.invitationId,
        organisationId: params.organisationId,
        actorUserId: auth.user.id,
        actorName: auth.user.name,
      });
      let emailDelivered = true;
      try {
        await emailSender.send(result.email);
      } catch (error) {
        emailDelivered = false;
        request.log.error({ err: error, invitationId: params.invitationId }, 'invitation resend failed');
      }
      return {
        resend: true,
        expiresAt: result.expiresAt.toISOString(),
        emailDelivered,
        message: emailDelivered ? 'Invitation resent.' : 'Invitation rotated, but email delivery failed.',
      };
    },
  );

  app.delete(
    '/organisations/:organisationId/invitations/:invitationId',
    {
      config: {
        auth: { mode: 'organisation', permission: 'MANAGE_USERS_AND_ORG' },
      },
    },
    async (request) => {
      const auth = getAuth(request);
      requireVerifiedEmail(auth);
      const params = parseInput(invitationParamsSchema, request.params);
      await revokeInvitation(app.db, {
        invitationId: params.invitationId,
        organisationId: params.organisationId,
        actorUserId: auth.user.id,
      });
      return { revoked: true };
    },
  );

  app.get(
    '/organisations/:organisationId/companies',
    { config: { auth: { mode: 'organisation' } } },
    async (request) => {
      const params = parseInput(organisationParamsSchema, request.params);
      const companies = (await listAccessibleCompanies(app.db, getAuth(request).user.id)).filter(
        (company) => company.organisationId === params.organisationId,
      );
      return { companies };
    },
  );
};
