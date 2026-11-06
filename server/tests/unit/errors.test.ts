import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, RequestValidationError, toErrorEnvelope } from '../../src/errors.ts';

describe('error envelope', () => {
  it('returns stable fields for a deliberate application error', () => {
    const result = toErrorEnvelope(
      new AppError(409, 'CONFLICT', 'The record already exists.'),
      'trace-123',
      'production',
    );
    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      code: 'CONFLICT',
      message: 'The record already exists.',
      traceId: 'trace-123',
    });
  });

  it('maps Zod issues to field errors', () => {
    const schema = z.object({ email: z.string().email(), amount: z.number().int().positive() });
    const parsed = schema.safeParse({ email: 'not-an-email', amount: -1 });
    expect(parsed.success).toBe(false);
    const result = toErrorEnvelope(new RequestValidationError(parsed.error!), 'trace-456', 'test');
    expect(result.statusCode).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.fieldErrors?.email).toBeDefined();
    expect(result.body.fieldErrors?.amount).toBeDefined();
  });

  it('never leaks an internal message or stack trace in production', () => {
    const error = new Error('database password was rejected');
    error.stack = 'Error: database password was rejected\n    at secret.ts:1:1';
    const result = toErrorEnvelope(error, 'trace-789', 'production');
    expect(result.statusCode).toBe(500);
    expect(result.body.code).toBe('INTERNAL_ERROR');
    expect(result.body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(result.body)).not.toContain('database password');
    expect(JSON.stringify(result.body)).not.toContain('secret.ts');
  });

  it('returns a stable code for malformed JSON without exposing parser details', () => {
    const result = toErrorEnvelope(
      { statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY', message: 'Unexpected token at position 12' },
      'trace-999',
      'production',
    );
    expect(result.statusCode).toBe(400);
    expect(result.body.code).toBe('INVALID_JSON');
    expect(result.body.message).not.toContain('position');
  });
});
