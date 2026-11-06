import { AppError } from './errors.ts';

/**
 * Read and validate an optional Idempotency-Key header. The value is intentionally opaque; the
 * posting service stores it per company and replays the original result for a retry with the same
 * key, while a different key against an already-posted document is rejected.
 */
export function readIdempotencyKey(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(trimmed)) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key must be 1–200 characters using letters, digits, dot, underscore, colon or hyphen.',
    );
  }
  return trimmed;
}
