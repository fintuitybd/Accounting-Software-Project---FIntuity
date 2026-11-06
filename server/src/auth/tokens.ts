import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Only verifier hashes are stored. A raw invitation/reset/session token never reaches the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict';
  path?: string;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined) segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  segments.push(`SameSite=${options.sameSite}`);
  return segments.join('; ');
}

export function clearCookie(name: string, options: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${local.length > 1 ? '***' : ''}@${domain}`;
}

export function truncateUserAgent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 512);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
