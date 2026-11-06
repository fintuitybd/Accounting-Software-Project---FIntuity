import { describe, expect, it } from 'vitest';
import {
  ROLES,
  canAssignRole,
  hasPermission,
  isPermission,
  isRole,
  permissionsForRole,
} from '../../src/auth/permissions.ts';
import { assertPasswordPolicy, hashPassword, verifyDummyPassword, verifyPassword } from '../../src/auth/password.ts';
import { hashToken, maskEmail, readCookie, serializeCookie } from '../../src/auth/tokens.ts';
import { safeRequestPath } from '../../src/redact.ts';

const lowCost = { argon2MemoryKib: 8192, argon2TimeCost: 1, argon2Parallelism: 1 };
const policy = { passwordMinLength: 12 };

describe('authorization matrix', () => {
  it('grants the documented permissions by role', () => {
    for (const role of ROLES) {
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }
    expect(hasPermission('OWNER', 'MANAGE_USERS_AND_ORG')).toBe(true);
    expect(hasPermission('ADMIN', 'MANAGE_USERS_AND_ORG')).toBe(true);
    expect(hasPermission('CONTROLLER', 'MANAGE_USERS_AND_ORG')).toBe(false);
    expect(hasPermission('CONTROLLER', 'APPROVE_HIGH_VALUE')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'POST_TO_GL')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'APPROVE_HIGH_VALUE')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'REVERSE_POSTED_JOURNAL')).toBe(false);
    expect(hasPermission('OPERATOR', 'CREATE_COMMERCIAL_DRAFT')).toBe(true);
    expect(hasPermission('OPERATOR', 'POST_TO_GL')).toBe(false);
    expect(hasPermission('OPERATOR', 'VIEW_REPORTS')).toBe(false);
    expect(hasPermission('OPERATOR', 'VIEW_LIMITED_REPORTS')).toBe(true);
    expect(hasPermission('AUDITOR', 'VIEW_REPORTS')).toBe(true);
    expect(hasPermission('AUDITOR', 'EXPORT_DATA')).toBe(true);
    for (const permission of [
      'POST_TO_GL',
      'CREATE_COMMERCIAL_DRAFT',
      'MANAGE_MASTERS_AND_COA',
      'REVERSE_POSTED_JOURNAL',
      'APPROVE_CLOSE_CHECKER',
      'MANAGE_COMPANY_SETTINGS',
    ] as const) {
      expect(hasPermission('AUDITOR', permission)).toBe(false);
    }
  });

  it('prevents admins from granting ownership but allows owners', () => {
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false);
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canAssignRole('CONTROLLER', 'ACCOUNTANT')).toBe(false);
    expect(isRole('OWNER')).toBe(true);
    expect(isRole('SUPERUSER')).toBe(false);
    expect(isPermission('POST_TO_GL')).toBe(true);
    expect(isPermission('post_to_gl')).toBe(false);
  });
});

describe('password handling', () => {
  it('hashes with Argon2id and verifies only the correct secret', async () => {
    const encoded = await hashPassword('A-long-correct-horse-42', lowCost);
    expect(encoded.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(encoded, 'A-long-correct-horse-42')).resolves.toBe(true);
    await expect(verifyPassword(encoded, 'A-long-correct-horse-43')).resolves.toBe(false);
    await expect(verifyDummyPassword('not-a-real-password')).resolves.toBeUndefined();
  });

  it('rejects weak, short, repeated and identity-derived passwords without echoing them', () => {
    expect(() => assertPasswordPolicy('short', policy)).toThrowError(/at least 12/);
    expect(() => assertPasswordPolicy('qwertyuiop12', policy)).toThrowError(/common/);
    expect(() => assertPasswordPolicy('aaaaaaaaaaaa', policy)).toThrowError(/repeated/);
    expect(() => assertPasswordPolicy('alice-long-password', policy, { email: 'alice@example.test' })).toThrowError(
      /email/,
    );
    expect(() => assertPasswordPolicy('Owner Person', policy, { name: 'Owner Person' })).toThrowError(/account name/);
    expect(() => assertPasswordPolicy('A-perfectly-fine-password-42', policy)).not.toThrow();
  });
});

describe('token and cookie primitives', () => {
  it('stores token hashes rather than raw values', () => {
    const token = 'raw-token-value';
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toBe(token);
    expect(maskEmail('owner@example.test')).toBe('o***@example.test');
  });

  it('serialises secure HTTP-only session cookies and readable CSRF cookies', () => {
    const sessionCookie = serializeCookie('lv_session', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAgeSeconds: 300,
    });
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Max-Age=300');

    const csrfCookie = serializeCookie('lv_csrf', 'xyz', {
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    });
    expect(csrfCookie).not.toContain('HttpOnly');

    expect(readCookie(`other=1; lv_session=abc%20123; lv_csrf=xyz`, 'lv_session')).toBe('abc 123');
    expect(readCookie(undefined, 'lv_session')).toBeUndefined();
  });

  it('redacts one-time invitation tokens from request paths before logging or auditing', () => {
    expect(safeRequestPath('/api/v1/auth/invitations/abc_DEF-123?source=email')).toBe(
      '/api/v1/auth/invitations/[redacted]',
    );
    expect(safeRequestPath('/api/v1/auth/reset-password?token=secret')).toBe('/api/v1/auth/reset-password');
    expect(safeRequestPath('/api/v1/companies/abc')).toBe('/api/v1/companies/abc');
  });
});
