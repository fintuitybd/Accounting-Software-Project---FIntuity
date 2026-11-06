import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { listAccessibleCompanies } from '../auth/access.ts';

const companyParamsSchema = z.object({ companyId: z.string().uuid() });

export const companyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies', { config: { auth: { mode: 'session' } } }, async (request) => {
    const auth = getAuth(request);
    return { companies: await listAccessibleCompanies(app.db, auth.user.id) };
  });

  app.get('/companies/:companyId', { config: { auth: { mode: 'company' } } }, async (request) => {
    parseInput(companyParamsSchema, request.params);
    const auth = getAuth(request);
    if (!auth.company) {
      throw new Error('Company authorization context is missing.');
    }
    return {
      company: auth.company,
      role: auth.role,
      permissions: auth.permissions,
    };
  });
};
