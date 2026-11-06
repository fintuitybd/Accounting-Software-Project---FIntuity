import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { hashToken } from '../../src/auth/tokens.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  TEST_PASSWORD,
  authHeaders,
  cookiesFromResponse,
  login,
  seedAccount,
  seedCompany,
  seedCompanyMembership,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  tokenFromEmail,
  type AppInstance,
} from '../helpers/identity.ts';
import { MemoryEmailSender } from '../../src/auth/email.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

describe.skipIf(!databaseAvailable)('identity, sessions, invitations and authorization', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let sender: MemoryEmailSender;
  let config: ReturnType<typeof testConfig>;
  let suffix = 0;

  const email = (prefix: string): string => `${prefix}.${++suffix}@example.test`;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    config = testConfig(database.url);
    sender = new MemoryEmailSender();
    app = await buildApp({
      config,
      pool: database.pool,
      logger: createLogger(config),
      emailSender: sender,
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  it('returns only companies the signed-in user belongs to and rejects cross-company access', async () => {
    const org = await seedOrganisation(database.pool, 'Tenant A');
    const companyA = await seedCompany(database.pool, org, 'Tenant A One');
    const companyB = await seedCompany(database.pool, org, 'Tenant A Two');
    const otherOrg = await seedOrganisation(database.pool, 'Tenant B');
    const otherCompany = await seedCompany(database.pool, otherOrg, 'Tenant B One');

    const userEmail = email('tenant-a');
    const userId = await seedUser(database.pool, { email: userEmail, name: 'Tenant A User' });
    const membership = await seedMembership(database.pool, org, userId, 'ACCOUNTANT');
    await seedCompanyMembership(database.pool, org, companyA, membership);

    const otherEmail = email('tenant-b');
    const otherUser = await seedUser(database.pool, { email: otherEmail, name: 'Tenant B User' });
    const otherMembership = await seedMembership(database.pool, otherOrg, otherUser, 'OWNER');
    await seedCompanyMembership(database.pool, otherOrg, otherCompany, otherMembership);

    const session = await login(app, userEmail);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(session.cookies),
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.companies.map((company: { id: string }) => company.id)).toEqual([companyA]);
    expect(body.memberships).toHaveLength(1);
    expect(body.user.email).toBe(userEmail);

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${companyA}`,
      headers: authHeaders(session.cookies),
    });
    expect(allowed.statusCode).toBe(200);

    for (const id of [companyB, otherCompany]) {
      const denied = await app.inject({
        method: 'GET',
        url: `/api/v1/companies/${id}`,
        headers: authHeaders(session.cookies),
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    }

    const prohibitedSwitch = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/active-company',
      headers: authHeaders(session.cookies),
      payload: { companyId: companyB },
    });
    expect(prohibitedSwitch.statusCode).toBe(404);

    const allowedSwitch = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/active-company',
      headers: authHeaders(session.cookies),
      payload: { companyId: companyA },
    });
    expect(allowedSwitch.statusCode).toBe(200);

    // Malformed identifiers fail closed rather than reaching PostgreSQL as an invalid uuid.
    for (const url of ['/api/v1/companies/not-a-uuid', `/api/v1/companies/${'0'.repeat(36)}`]) {
      const malformed = await app.inject({
        method: 'GET',
        url,
        headers: authHeaders(session.cookies),
      });
      expect(malformed.statusCode).toBe(404);
    }
    const malformedOrganisation = await app.inject({
      method: 'GET',
      url: '/api/v1/organisations/not-a-uuid/members',
      headers: authHeaders(session.cookies),
    });
    // The route-level permission guard resolves the organisation first; an invalid id is not found.
    expect(malformedOrganisation.statusCode).toBe(404);

    // The other tenant cannot see or mutate this organisation.
    const otherSession = await login(app, otherEmail);
    for (const url of [
      `/api/v1/organisations/${org}/members`,
      `/api/v1/organisations/${org}/invitations`,
      `/api/v1/organisations/${org}/companies`,
    ]) {
      const denied = await app.inject({
        method: 'GET',
        url,
        headers: authHeaders(otherSession.cookies),
      });
      expect(denied.statusCode).toBe(404);
    }
  });

  it('enforces auditor read-only access at the API', async () => {
    const account = await seedAccount(database.pool, {
      organisationName: 'Auditor Organisation',
      companyNames: ['Auditor Company'],
      email: email('auditor'),
      name: 'Auditor User',
      role: 'AUDITOR',
      scope: [0],
    });
    const auditorEmail = (
      await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [account.userId])
    ).rows[0]!.email;
    const auditorSession = await login(app, auditorEmail);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${account.companyIds[0]}`,
      headers: authHeaders(auditorSession.cookies),
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(auditorSession.cookies),
      payload: {
        email: email('auditor-invite'),
        role: 'ACCOUNTANT',
        companyIds: [account.companyIds[0]],
      },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ code: 'FORBIDDEN' });

    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/organisations/${account.organisationId}/members`,
      headers: authHeaders(auditorSession.cookies),
    });
    expect(members.statusCode).toBe(403);

    const deniedAudit = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events
        WHERE action = 'auth.access.denied' AND actor_user_id = $1`,
      [account.userId],
    );
    expect(Number(deniedAudit.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  });

  it('creates, accepts, expires and rotates single-use invitations', async () => {
    const account = await seedAccount(database.pool, {
      organisationName: 'Invitation Organisation',
      companyNames: ['Invitation Company'],
      email: email('invite-owner'),
      name: 'Invitation Owner',
      role: 'OWNER',
      scope: 'all',
    });
    const ownerEmail = (
      await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [account.userId])
    ).rows[0]!.email;
    const ownerSession = await login(app, ownerEmail);

    const inviteeEmail = email('invitee');
    const before = sender.messages.length;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: inviteeEmail, role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ reused: false, emailDelivered: true });
    expect(sender.messages.length).toBe(before + 1);
    const token = tokenFromEmail(sender.messages.at(-1)!.text, 'accept-invitation');

    const stored = await database.pool.query<{ token_hash: string; email: string }>(
      `SELECT token_hash, email FROM invitations WHERE email = $1`,
      [inviteeEmail],
    );
    expect(stored.rows[0]!.token_hash).toBe(hashToken(token));
    expect(stored.rows[0]!.token_hash).not.toBe(token);

    const publicDetails = await app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` });
    expect(publicDetails.statusCode).toBe(200);
    expect(publicDetails.json()).toMatchObject({
      role: 'ACCOUNTANT',
      status: 'PENDING',
      organisationName: 'Invitation Organisation',
    });
    expect(publicDetails.json().emailMasked).not.toBe(inviteeEmail);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: { token, name: 'Invited Accountant', password: TEST_PASSWORD },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ accepted: true });
    expect(accepted.json().companies).toHaveLength(1);
    const invitedCookies = cookiesFromResponse(accepted.headers);

    const invitedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(invitedCookies),
    });
    expect(invitedMe.statusCode).toBe(200);
    expect(invitedMe.json().user.email).toBe(inviteeEmail);
    expect(invitedMe.json().companies[0].role).toBe('ACCOUNTANT');

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: { token, name: 'Again', password: TEST_PASSWORD },
    });
    expect(reused.statusCode).toBe(410);
    expect(reused.json()).toMatchObject({ code: 'INVITATION_USED' });

    // Expired invitation.
    const expiredEmail = email('expired');
    const expiredCreated = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: expiredEmail, role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(expiredCreated.statusCode).toBe(201);
    const expiredToken = tokenFromEmail(sender.messages.at(-1)!.text, 'accept-invitation');
    await database.pool.query(`UPDATE invitations SET expires_at = now() - interval '1 day' WHERE token_hash = $1`, [
      hashToken(expiredToken),
    ]);
    const expiredAccept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: { token: expiredToken, name: 'Expired User', password: TEST_PASSWORD },
    });
    expect(expiredAccept.statusCode).toBe(410);
    expect(expiredAccept.json()).toMatchObject({ code: 'INVITATION_EXPIRED' });

    // Resend rotates the token: the old link stops working.
    const resendEmail = email('resend');
    const resendCreated = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: resendEmail, role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(resendCreated.statusCode).toBe(201);
    const firstToken = tokenFromEmail(sender.messages.at(-1)!.text, 'accept-invitation');
    const invitationId = resendCreated.json().invitation.id as string;
    const resent = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations/${invitationId}/resend`,
      headers: authHeaders(ownerSession.cookies),
    });
    expect(resent.statusCode).toBe(200);
    const secondToken = tokenFromEmail(sender.messages.at(-1)!.text, 'accept-invitation');
    expect(secondToken).not.toBe(firstToken);

    const stale = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/invitations/${firstToken}`,
    });
    expect(stale.statusCode).toBe(404);
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      payload: { token: secondToken, name: 'Resent User', password: TEST_PASSWORD },
    });
    expect(fresh.statusCode).toBe(200);

    // A signed-in user cannot accept an invitation addressed to another email.
    const mismatchEmail = email('mismatch');
    const mismatchCreated = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: mismatchEmail, role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(mismatchCreated.statusCode).toBe(201);
    const mismatchToken = tokenFromEmail(sender.messages.at(-1)!.text, 'accept-invitation');
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invitations/accept',
      headers: authHeaders(ownerSession.cookies),
      payload: { token: mismatchToken },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: 'ACCOUNT_MISMATCH' });

    const selfInvite = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: ownerEmail, role: 'ADMIN', companyIds: [] },
    });
    expect(selfInvite.statusCode).toBe(400);
    expect(selfInvite.json()).toMatchObject({ code: 'CANNOT_INVITE_SELF' });

    const noScope = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: email('no-scope'), role: 'ACCOUNTANT', companyIds: [] },
    });
    expect(noScope.statusCode).toBe(400);
    expect(noScope.json()).toMatchObject({ code: 'COMPANY_SCOPE_REQUIRED' });
  });

  it('prevents self-role changes and protects the last owner', async () => {
    const account = await seedAccount(database.pool, {
      organisationName: 'Owner Protection Organisation',
      companyNames: ['Owner Protection Company'],
      email: email('owner-protect'),
      name: 'Protected Owner',
      role: 'OWNER',
      scope: 'all',
    });
    const ownerEmail = (
      await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [account.userId])
    ).rows[0]!.email;
    const ownerSession = await login(app, ownerEmail);

    const selfChange = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organisations/${account.organisationId}/members/${account.userId}`,
      headers: authHeaders(ownerSession.cookies),
      payload: { role: 'ADMIN' },
    });
    expect(selfChange.statusCode).toBe(403);
    expect(selfChange.json()).toMatchObject({ code: 'CANNOT_CHANGE_OWN_ROLE' });

    const adminEmail = email('admin-protect');
    const adminId = await seedUser(database.pool, { email: adminEmail, name: 'Protected Admin' });
    await seedMembership(database.pool, account.organisationId, adminId, 'ADMIN');
    const adminSession = await login(app, adminEmail);

    const demoteLastOwner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organisations/${account.organisationId}/members/${account.userId}`,
      headers: authHeaders(adminSession.cookies),
      payload: { role: 'ADMIN' },
    });
    expect(demoteLastOwner.statusCode).toBe(409);
    expect(demoteLastOwner.json()).toMatchObject({ code: 'LAST_OWNER_PROTECTED' });

    const adminCannotGrantOwner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organisations/${account.organisationId}/members/${adminId}`,
      headers: authHeaders(ownerSession.cookies),
      payload: { role: 'OWNER' },
    });
    // The owner can grant owner. The admin identity is not the actor here; this checks the owner
    // path while the separate check below proves an admin cannot do the same.
    expect(adminCannotGrantOwner.statusCode).toBe(200);

    const secondAdminEmail = email('admin-two');
    const secondAdminId = await seedUser(database.pool, { email: secondAdminEmail, name: 'Second Admin' });
    await seedMembership(database.pool, account.organisationId, secondAdminId, 'ADMIN');
    const secondAdminSession = await login(app, secondAdminEmail);
    const forbiddenGrant = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organisations/${account.organisationId}/members/${secondAdminId}`,
      headers: authHeaders(secondAdminSession.cookies),
      payload: { role: 'OWNER' },
    });
    expect(forbiddenGrant.statusCode).toBe(403);
  });

  it('revokes sessions on password reset and rejects reused or expired reset tokens', async () => {
    const userEmail = email('reset-user');
    const userId = await seedUser(database.pool, { email: userEmail, name: 'Reset User' });
    const session = await login(app, userEmail);
    const before = sender.messages.length;

    const forgot = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    expect(forgot.statusCode).toBe(202);
    expect(sender.messages.length).toBe(before + 1);
    const resetToken = tokenFromEmail(sender.messages.at(-1)!.text, 'reset-password');

    const neutral = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'missing@example.test' },
    });
    expect(neutral.statusCode).toBe(202);
    expect(sender.messages.length).toBe(before + 1);

    const newPassword = 'New-Correct-Horse-77';
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: resetToken, password: newPassword },
    });
    expect(reset.statusCode).toBe(200);

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(session.cookies),
    });
    expect(oldSession.statusCode).toBe(401);
    expect(oldSession.json()).toMatchObject({ code: 'SESSION_EXPIRED' });

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userEmail, password: TEST_PASSWORD },
      remoteAddress: '127.0.0.10',
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await login(app, userEmail, newPassword, '127.0.0.11');
    expect(newLogin.body.user.email).toBe(userEmail);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: resetToken, password: 'Another-Correct-Horse-88' },
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({ code: 'PASSWORD_RESET_INVALID' });

    // Expired token.
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    const expiredToken = tokenFromEmail(sender.messages.at(-1)!.text, 'reset-password');
    await database.pool.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
      [hashToken(expiredToken)],
    );
    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: expiredToken, password: 'Another-Correct-Horse-99' },
    });
    expect(expired.statusCode).toBe(400);

    const stored = await database.pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    expect(stored.rows[0]!.password_hash).toContain('$argon2id$');
    expect(stored.rows[0]!.password_hash).not.toContain(newPassword);
  });

  it('requires CSRF for authenticated mutations and rejects a mismatched token', async () => {
    const userEmail = email('csrf-user');
    await seedUser(database.pool, { email: userEmail, name: 'CSRF User' });
    const session = await login(app, userEmail);

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/active-company',
      headers: { cookie: `lv_session=${encodeURIComponent(session.cookies.session)}` },
      payload: { companyId: '00000000-0000-4000-8000-000000000000' },
    });
    // CSRF is checked before the company lookup, so the response is a CSRF failure.
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'CSRF_FAILED' });

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/active-company',
      headers: {
        cookie: `lv_session=${encodeURIComponent(session.cookies.session)}; lv_csrf=${encodeURIComponent(session.cookies.csrf)}`,
        'x-csrf-token': 'not-the-right-token',
      },
      payload: { companyId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(wrong.statusCode).toBe(403);

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `lv_session=${encodeURIComponent(session.cookies.session)}` },
    });
    expect(read.statusCode).toBe(200);
  });

  it('lists and revokes sessions and enforces idle expiry', async () => {
    const userEmail = email('session-user');
    await seedUser(database.pool, { email: userEmail, name: 'Session User' });
    const first = await login(app, userEmail, TEST_PASSWORD, '127.0.0.20');
    const second = await login(app, userEmail, TEST_PASSWORD, '127.0.0.21');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: authHeaders(first.cookies),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(2);
    expect(list.json().sessions.filter((entry: { current: boolean }) => entry.current)).toHaveLength(1);

    const other = list.json().sessions.find((entry: { id: string; current: boolean }) => !entry.current);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other.id}`,
      headers: authHeaders(first.cookies),
    });
    expect(revoke.statusCode).toBe(200);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(second.cookies),
    });
    expect(revoked.statusCode).toBe(401);

    const stillValid = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(first.cookies),
    });
    expect(stillValid.statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authHeaders(first.cookies),
    });
    expect(logout.statusCode).toBe(204);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(first.cookies),
    });
    expect(afterLogout.statusCode).toBe(401);

    const third = await login(app, userEmail, TEST_PASSWORD, '127.0.0.22');
    await database.pool.query(
      `UPDATE sessions SET idle_expires_at = now() - interval '1 minute' WHERE token_hash = $1`,
      [hashToken(third.cookies.session)],
    );
    const idle = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(third.cookies),
    });
    expect(idle.statusCode).toBe(401);
    expect(idle.json()).toMatchObject({ code: 'SESSION_EXPIRED' });

    const fourth = await login(app, userEmail, TEST_PASSWORD, '127.0.0.23');
    await database.pool.query(
      `UPDATE sessions
          SET absolute_expires_at = created_at + interval '1 millisecond',
              idle_expires_at = created_at + interval '1 millisecond'
        WHERE token_hash = $1`,
      [hashToken(fourth.cookies.session)],
    );
    const absolute = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(fourth.cookies),
    });
    expect(absolute.statusCode).toBe(401);
    expect(absolute.json()).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('rate-limits repeated login attempts and locks an account after repeated failures', async () => {
    const rateConfig = testConfig(database.url, {
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '3',
      LOGIN_MAX_ATTEMPTS: '100',
    });
    const rateSender = new MemoryEmailSender();
    const rateApp = await buildApp({
      config: rateConfig,
      pool: database.pool,
      logger: createLogger(rateConfig),
      emailSender: rateSender,
    });
    try {
      const targetEmail = email('rate-user');
      await seedUser(database.pool, { email: targetEmail, name: 'Rate User' });
      let lastStatus = 0;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await rateApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: targetEmail, password: 'wrong-password-value' },
          remoteAddress: '127.0.0.30',
        });
        lastStatus = response.statusCode;
      }
      expect(lastStatus).toBe(429);
    } finally {
      await rateApp.close();
    }

    const lockConfig = testConfig(database.url, {
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: '100',
      LOGIN_MAX_ATTEMPTS: '2',
    });
    const lockSender = new MemoryEmailSender();
    const lockApp = await buildApp({
      config: lockConfig,
      pool: database.pool,
      logger: createLogger(lockConfig),
      emailSender: lockSender,
    });
    try {
      const lockEmail = email('lock-user');
      await seedUser(database.pool, { email: lockEmail, name: 'Lock User' });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await lockApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: lockEmail, password: 'wrong-password-value' },
          remoteAddress: `127.0.1.${attempt + 1}`,
        });
        expect(response.statusCode).toBe(401);
      }
      // Simulate the rate-limit window elapsing so this request reaches the account-lock check.
      await database.pool.query(`DELETE FROM rate_limit_counters WHERE bucket_key LIKE 'auth:login:email:%'`);
      const locked = await lockApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: lockEmail, password: TEST_PASSWORD },
        remoteAddress: '127.0.1.9',
      });
      expect(locked.statusCode).toBe(401);
      expect(locked.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    } finally {
      await lockApp.close();
    }
  });

  it('verifies an email once and audits identity events without secrets', async () => {
    const userEmail = email('verify-user');
    await seedUser(database.pool, { email: userEmail, name: 'Verify User', verified: false });
    const session = await login(app, userEmail);
    const meBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(session.cookies),
    });
    expect(meBefore.json().user.emailVerified).toBe(false);

    const before = sender.messages.length;
    const resend = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: authHeaders(session.cookies),
    });
    expect(resend.statusCode).toBe(202);
    expect(sender.messages.length).toBe(before + 1);
    const token = tokenFromEmail(sender.messages.at(-1)!.text, 'verify-email');

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(session.cookies),
    });
    expect(meAfter.json().user.emailVerified).toBe(true);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(reuse.statusCode).toBe(400);

    const audit = await database.pool.query<{ action: string; after_json: unknown }>(
      `SELECT action, after_json FROM audit_events
        WHERE action IN ('auth.login.succeeded', 'invitation.created', 'invitation.accepted',
                         'membership.updated', 'auth.password_reset.completed')
        ORDER BY created_at ASC`,
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    for (const expected of [
      'auth.login.succeeded',
      'invitation.created',
      'invitation.accepted',
      'membership.updated',
      'auth.password_reset.completed',
    ]) {
      expect(actions.has(expected)).toBe(true);
    }
    const serialised = JSON.stringify(audit.rows);
    expect(serialised).not.toContain(TEST_PASSWORD);
    expect(serialised).not.toContain('Correct-Horse');
  });

  it('requires a verified actor, rejects duplicate members and gives unscoped non-admins no companies', async () => {
    const account = await seedAccount(database.pool, {
      organisationName: 'Verification Organisation',
      companyNames: ['Verification Company'],
      email: email('verified-owner'),
      name: 'Verified Owner',
      role: 'OWNER',
      scope: 'all',
    });
    const ownerEmail = (
      await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [account.userId])
    ).rows[0]!.email;
    const ownerSession = await login(app, ownerEmail);

    // Existing member in the organisation.
    const memberEmail = email('existing-member');
    const memberId = await seedUser(database.pool, { email: memberEmail, name: 'Existing Member' });
    await seedMembership(database.pool, account.organisationId, memberId, 'ACCOUNTANT');
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: memberEmail, role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'ALREADY_MEMBER' });

    // Unverified administrator cannot invite.
    const unverifiedEmail = email('unverified-admin');
    const unverifiedId = await seedUser(database.pool, {
      email: unverifiedEmail,
      name: 'Unverified Admin',
      verified: false,
    });
    await seedMembership(database.pool, account.organisationId, unverifiedId, 'ADMIN');
    const unverifiedSession = await login(app, unverifiedEmail);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(unverifiedSession.cookies),
      payload: { email: email('blocked-invite'), role: 'ACCOUNTANT', companyIds: [account.companyIds[0]] },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });

    // An accountant with no explicit company scope gets no company access. Only owner/admin are
    // organisation-wide by default.
    const unscopedEmail = email('unscoped-accountant');
    const unscopedId = await seedUser(database.pool, { email: unscopedEmail, name: 'Unscoped Accountant' });
    await seedMembership(database.pool, account.organisationId, unscopedId, 'ACCOUNTANT');
    const unscopedSession = await login(app, unscopedEmail);
    const unscopedMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(unscopedSession.cookies),
    });
    expect(unscopedMe.statusCode).toBe(200);
    expect(unscopedMe.json().companies).toEqual([]);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${account.companyIds[0]}`,
      headers: authHeaders(unscopedSession.cookies),
    });
    expect(denied.statusCode).toBe(404);
  });

  it('refuses duplicate membership invitations and unknown-email login with generic errors', async () => {
    const account = await seedAccount(database.pool, {
      organisationName: 'Duplicate Organisation',
      companyNames: ['Duplicate Company'],
      email: email('duplicate-owner'),
      name: 'Duplicate Owner',
      role: 'OWNER',
      scope: 'all',
    });
    const ownerEmail = (
      await database.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [account.userId])
    ).rows[0]!.email;
    const ownerSession = await login(app, ownerEmail);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/organisations/${account.organisationId}/invitations`,
      headers: authHeaders(ownerSession.cookies),
      payload: { email: ownerEmail, role: 'ADMIN', companyIds: [] },
    });
    // Self-invitation is rejected before the existing-member check.
    expect(duplicate.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: email('unknown'), password: 'some-password-value' },
      remoteAddress: '127.0.2.1',
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ownerEmail, password: 'some-password-value' },
      remoteAddress: '127.0.2.2',
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });
});
