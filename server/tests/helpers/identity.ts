import type { Pool } from 'pg';
import { hashPassword } from '../../src/auth/password.ts';
import { loadConfig } from '../../src/config.ts';
import type { buildApp } from '../../src/app.ts';

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

export function testConfig(databaseUrl: string, overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: 'silent',
    EMAIL_TRANSPORT: 'memory',
    APP_ORIGIN: 'http://localhost:5173',
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '1',
    PASSWORD_MIN_LENGTH: '12',
    ...overrides,
  });
}

export async function seedOrganisation(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [name]);
  return result.rows[0]!.id;
}

export async function seedCompany(pool: Pool, organisationId: string, legalName: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO companies (organisation_id, legal_name, status)
     VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [organisationId, legalName],
  );
  return result.rows[0]!.id;
}

export async function seedUser(
  pool: Pool,
  input: {
    email: string;
    name: string;
    password?: string | null;
    status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
    verified?: boolean;
  },
): Promise<string> {
  const password = input.password === null ? null : (input.password ?? TEST_PASSWORD);
  const passwordHash = password
    ? await hashPassword(password, { argon2MemoryKib: 8192, argon2TimeCost: 1, argon2Parallelism: 1 })
    : null;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, status, email_verified_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.email.toLowerCase(),
      input.name,
      passwordHash,
      input.status ?? 'ACTIVE',
      input.verified === false ? null : new Date(),
    ],
  );
  return result.rows[0]!.id;
}

export async function seedMembership(
  pool: Pool,
  organisationId: string,
  userId: string,
  role: string,
  status = 'ACTIVE',
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO memberships (organisation_id, user_id, role, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [organisationId, userId, role, status],
  );
  return result.rows[0]!.id;
}

export async function seedCompanyMembership(
  pool: Pool,
  organisationId: string,
  companyId: string,
  membershipId: string,
  roleOverride?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO company_memberships (organisation_id, company_id, membership_id, role_override, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')`,
    [organisationId, companyId, membershipId, roleOverride ?? null],
  );
}

export interface AuthCookies {
  session: string;
  csrf: string;
}

export function cookiesFromResponse(headers: Record<string, unknown>): AuthCookies {
  const raw = headers['set-cookie'];
  const entries = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  const read = (name: string): string => {
    const entry = entries.find((value) => value.startsWith(`${name}=`));
    if (!entry) throw new Error(`Cookie ${name} was not set. Headers: ${entries.join(' | ')}`);
    const value = entry.slice(name.length + 1).split(';')[0] ?? '';
    return decodeURIComponent(value);
  };
  return { session: read('lv_session'), csrf: read('lv_csrf') };
}

export function authHeaders(cookies: AuthCookies): Record<string, string> {
  return {
    cookie: `lv_session=${encodeURIComponent(cookies.session)}; lv_csrf=${encodeURIComponent(cookies.csrf)}`,
    'x-csrf-token': cookies.csrf,
  };
}

export interface LoginResult {
  cookies: AuthCookies;
  body: any;
}

export async function login(
  app: AppInstance,
  email: string,
  password = TEST_PASSWORD,
  remoteAddress = '127.0.0.1',
): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    remoteAddress,
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login failed (${response.statusCode}): ${response.body}`);
  }
  return { cookies: cookiesFromResponse(response.headers), body: response.json() };
}

export async function authed(
  app: AppInstance,
  cookies: AuthCookies,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: string | Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: authHeaders(cookies),
    ...(payload === undefined ? {} : { payload }),
  });
}

export async function seedAccount(
  pool: Pool,
  input: {
    organisationName: string;
    companyNames: string[];
    email: string;
    name: string;
    role: string;
    scope?: 'all' | number[];
  },
): Promise<{
  organisationId: string;
  companyIds: string[];
  userId: string;
  membershipId: string;
}> {
  const organisationId = await seedOrganisation(pool, input.organisationName);
  const companyIds: string[] = [];
  for (const companyName of input.companyNames) {
    companyIds.push(await seedCompany(pool, organisationId, companyName));
  }
  const userId = await seedUser(pool, {
    email: input.email,
    name: input.name,
    password: TEST_PASSWORD,
  });
  const membershipId = await seedMembership(pool, organisationId, userId, input.role);
  if (input.scope !== 'all') {
    const indexes = input.scope ?? companyIds.map((_, index) => index);
    for (const index of indexes) {
      const companyId = companyIds[index];
      if (companyId) await seedCompanyMembership(pool, organisationId, companyId, membershipId);
    }
  }
  return { organisationId, companyIds, userId, membershipId };
}

export function tokenFromEmail(text: string, route: 'accept-invitation' | 'reset-password' | 'verify-email'): string {
  const pattern =
    route === 'accept-invitation'
      ? /\/accept-invitation\/([A-Za-z0-9_-]+)/
      : new RegExp(`/${route}\\?token=([A-Za-z0-9_%.-]+)`);
  const match = text.match(pattern);
  if (!match?.[1]) throw new Error(`No ${route} token found in email: ${text}`);
  return decodeURIComponent(match[1]);
}
