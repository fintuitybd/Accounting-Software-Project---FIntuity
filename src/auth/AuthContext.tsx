import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, authApi, ALL_SERVER_PERMISSIONS } from './api';
import type { AuthCompany, AuthMembership, AuthUser, MeResponse, ServerPermission } from './types';

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'expired' | 'error';

const DEMO_USER: AuthUser = {
  id: 'DEMO-OWNER',
  email: 'demo.owner@example.invalid',
  name: 'Demo Owner',
  status: 'ACTIVE',
  emailVerified: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-11-02T00:00:00.000Z',
};

const DEMO_ORGANISATION_ID = 'DEMO-ORG';
const DEMO_COMPANY_ID = 'DEMO-COMPANY';

const DEMO_MEMBERSHIP: AuthMembership = {
  membershipId: 'DEMO-MEMBERSHIP',
  organisationId: DEMO_ORGANISATION_ID,
  organisationName: 'Apex Group (synthetic demo)',
  role: 'OWNER',
  permissions: [...ALL_SERVER_PERMISSIONS],
};

const DEMO_COMPANY: AuthCompany = {
  id: DEMO_COMPANY_ID,
  organisationId: DEMO_ORGANISATION_ID,
  organisationName: 'Apex Group (synthetic demo)',
  legalName: 'Apex Group (synthetic demo)',
  tradeName: 'Apex Demo',
  entityType: 'PRIVATE_LIMITED',
  tin: 'DEMO-TIN',
  bin: 'DEMO-BIN',
  status: 'ACTIVE',
  role: 'OWNER',
  permissions: [...ALL_SERVER_PERMISSIONS],
  explicitScope: false,
};

export function createDemoMe(): MeResponse {
  return {
    user: DEMO_USER,
    memberships: [DEMO_MEMBERSHIP],
    companies: [DEMO_COMPANY],
    activeCompanyId: DEMO_COMPANY_ID,
    session: {
      id: 'DEMO-SESSION',
      idleExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    },
  };
}

interface AuthContextValue {
  status: AuthStatus;
  error: string | null;
  me: MeResponse | null;
  user: AuthUser | null;
  memberships: AuthMembership[];
  companies: AuthCompany[];
  activeCompany: AuthCompany | null;
  activeMembership: AuthMembership | null;
  hasCompany: boolean;
  demoMode: boolean;
  login: (email: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  selectCompany: (companyId: string) => Promise<void>;
  hasCompanyPermission: (permission: ServerPermission) => boolean;
  hasOrganisationPermission: (permission: ServerPermission) => boolean;
  markExpired: () => void;
  markSignedOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  demoModeOverride,
  initialMe,
}: {
  children: ReactNode;
  /** Test harness override. Production uses the VITE_DEMO_MODE build flag. */
  demoModeOverride?: boolean;
  initialMe?: MeResponse | null;
}) {
  const demoMode = demoModeOverride ?? DEMO_MODE;
  const [status, setStatus] = useState<AuthStatus>(demoMode ? 'authenticated' : 'loading');
  const [me, setMe] = useState<MeResponse | null>(demoMode ? (initialMe ?? createDemoMe()) : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await authApi.me();
        if (cancelled) return;
        setMe(response);
        setStatus('authenticated');
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          setMe(null);
          setStatus('unauthenticated');
        } else {
          setError(caught instanceof Error ? caught.message : 'Unable to reach the identity service.');
          setStatus('error');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onExpired = (): void => setStatus((current) => (current === 'authenticated' ? 'expired' : current));
    window.addEventListener('ledgervault:session-expired', onExpired);
    return () => window.removeEventListener('ledgervault:session-expired', onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<MeResponse> => {
    const response = demoMode ? createDemoMe() : await authApi.login(email, password);
    setMe(response);
    setStatus('authenticated');
    setError(null);
    return response;
  }, [demoMode]);

  const logout = useCallback(async (): Promise<void> => {
    if (!demoMode) {
      try {
        await authApi.logout();
      } catch (caught) {
        // If the CSRF cookie was lost, rotate it once and retry. Any other failure means the
        // server session may still be active; do not pretend the user is signed out.
        if (caught instanceof ApiError && caught.code === 'CSRF_FAILED') {
          try {
            await authApi.rotateCsrf();
            await authApi.logout();
          } catch (retry) {
            if (!(retry instanceof ApiError) || (retry.status !== 401 && retry.code !== 'SESSION_EXPIRED')) {
              throw retry;
            }
          }
        } else if (caught instanceof ApiError && (caught.status === 401 || caught.code === 'SESSION_EXPIRED')) {
          // Already revoked or expired server-side.
        } else {
          throw caught;
        }
      }
    }
    setMe(null);
    setStatus('unauthenticated');
  }, [demoMode]);

  const refresh = useCallback(async (): Promise<void> => {
    if (demoMode) {
      setMe(createDemoMe());
      setStatus('authenticated');
      return;
    }
    try {
      const response = await authApi.me();
      setMe(response);
      setStatus('authenticated');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setMe(null);
        setStatus('unauthenticated');
      } else {
        throw caught;
      }
    }
  }, [demoMode]);

  const selectCompany = useCallback(
    async (companyId: string): Promise<void> => {
      if (demoMode) {
        setMe((current) => (current ? { ...current, activeCompanyId: companyId } : current));
        return;
      }
      await authApi.setActiveCompany(companyId);
      setMe((current) => (current ? { ...current, activeCompanyId: companyId } : current));
    },
    [demoMode],
  );

  const memberships = useMemo(() => me?.memberships ?? [], [me?.memberships]);
  const companies = useMemo(() => me?.companies ?? [], [me?.companies]);
  const activeCompany = useMemo(
    () => companies.find((company) => company.id === me?.activeCompanyId) ?? companies[0] ?? null,
    [companies, me?.activeCompanyId],
  );
  const activeMembership = useMemo(
    () =>
      memberships.find((membership) => membership.organisationId === activeCompany?.organisationId) ??
      memberships[0] ??
      null,
    [memberships, activeCompany?.organisationId],
  );

  const hasCompanyPermission = useCallback(
    (permission: ServerPermission): boolean => Boolean(activeCompany?.permissions.includes(permission)),
    [activeCompany],
  );

  const hasOrganisationPermission = useCallback(
    (permission: ServerPermission): boolean => Boolean(activeMembership?.permissions.includes(permission)),
    [activeMembership],
  );

  const markExpired = useCallback(() => setStatus('expired'), []);
  const markSignedOut = useCallback(() => {
    setMe(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      error,
      me,
      user: me?.user ?? null,
      memberships,
      companies,
      activeCompany,
      activeMembership,
      hasCompany: Boolean(activeCompany),
      demoMode,
      login,
      logout,
      refresh,
      selectCompany,
      hasCompanyPermission,
      hasOrganisationPermission,
      markExpired,
      markSignedOut,
    }),
    [
      status,
      error,
      me,
      memberships,
      companies,
      activeCompany,
      activeMembership,
      demoMode,
      login,
      logout,
      refresh,
      selectCompany,
      hasCompanyPermission,
      hasOrganisationPermission,
      markExpired,
      markSignedOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

