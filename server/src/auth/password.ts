import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { AppConfig } from '../config.ts';
import { AppError } from '../errors.ts';

export type PasswordPolicyConfig = Pick<AppConfig, 'passwordMinLength'>;

const MAX_PASSWORD_LENGTH = 256;

// A real Argon2id verifier for a value no account can use. Unknown-email logins still pay the
// hashing cost, which removes the most obvious account-enumeration timing signal.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$9JmCjUKbErh59opGdyZkvg$AU597DOiCJg+CrBHamqolnlRuw+NQ30NYYUehkCZ0EM';

// Deliberately small and non-authoritative: a breach-list service is a production integration
// decision, not a value we invent. This list only blocks the most common obvious choices.
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'welcome12345',
  'admin123456',
  'changeme123',
  'ledgervault',
  'fintuity',
  'fintuityaccounting',
]);

export function passwordRequirements(minLength: number): readonly string[] {
  return [
    `At least ${minLength} characters.`,
    'At most 256 characters.',
    'Must not be a common password or contain only one repeated character.',
  ];
}

/**
 * Password policy favours length, not arbitrary character-class rules. It never logs or returns the
 * supplied password. The error message explains the rule without echoing the secret.
 */
export function assertPasswordPolicy(
  password: string,
  config: PasswordPolicyConfig,
  identity?: { email?: string; name?: string },
): void {
  if (typeof password !== 'string' || password.length < config.passwordMinLength) {
    throw new AppError(400, 'WEAK_PASSWORD', `Password must be at least ${config.passwordMinLength} characters.`, {
      requirements: passwordRequirements(config.passwordMinLength),
    });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError(400, 'WEAK_PASSWORD', 'Password is too long.', {
      requirements: passwordRequirements(config.passwordMinLength),
    });
  }
  const normalised = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalised)) {
    throw new AppError(400, 'WEAK_PASSWORD', 'Choose a less common password.', {
      requirements: passwordRequirements(config.passwordMinLength),
    });
  }
  if (/^(.)\1+$/.test(password)) {
    throw new AppError(400, 'WEAK_PASSWORD', 'Password cannot be one repeated character.', {
      requirements: passwordRequirements(config.passwordMinLength),
    });
  }
  if (identity?.email) {
    const localPart = identity.email.split('@')[0]?.toLowerCase() ?? '';
    if (localPart.length >= 4 && normalised.includes(localPart)) {
      throw new AppError(400, 'WEAK_PASSWORD', 'Password must not contain the email address.', {
        requirements: passwordRequirements(config.passwordMinLength),
      });
    }
  }
  if (identity?.name) {
    const namePart = identity.name.trim().toLowerCase();
    if (namePart.length >= 4 && normalised === namePart) {
      throw new AppError(400, 'WEAK_PASSWORD', 'Password must not be the account name.', {
        requirements: passwordRequirements(config.passwordMinLength),
      });
    }
  }
}

export type Argon2Config = Pick<AppConfig, 'argon2MemoryKib' | 'argon2TimeCost' | 'argon2Parallelism'>;

export async function hashPassword(password: string, config: Argon2Config): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: config.argon2MemoryKib,
    timeCost: config.argon2TimeCost,
    parallelism: config.argon2Parallelism,
  });
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}

/** Constant-cost verification used when no account matches an email. */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}
