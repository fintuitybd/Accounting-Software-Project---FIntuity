import type { z } from 'zod';
import { RequestValidationError } from './errors.ts';

/**
 * Parse untrusted input at the API boundary. Callers must use the returned value, never the raw
 * request body, so defaults and coercions are applied exactly once.
 */
export function parseInput<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestValidationError(result.error);
  }
  return result.data;
}
