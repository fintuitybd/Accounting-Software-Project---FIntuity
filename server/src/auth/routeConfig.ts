import type { Permission, Role } from './permissions.ts';
import type { CompanyAccess, MembershipContext } from './types.ts';
import type { SessionRecord, SessionUserRow } from './session.ts';

export type AuthRouteConfig =
  | { mode: 'public' }
  | { mode: 'optional'; csrf?: boolean }
  | { mode: 'session'; csrf?: boolean }
  | {
      mode: 'organisation';
      organisationParam?: string;
      permission?: Permission;
      csrf?: boolean;
    }
  | {
      mode: 'company';
      companyParam?: string;
      permission?: Permission;
      csrf?: boolean;
    };

export interface AuthRequestContext {
  user: SessionUserRow;
  session: SessionRecord & { csrfTokenHash: string };
  membership?: MembershipContext;
  company?: CompanyAccess;
  role?: Role;
  permissions: readonly Permission[];
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthRouteConfig;
  }

  interface FastifyRequest {
    auth?: AuthRequestContext;
  }
}
