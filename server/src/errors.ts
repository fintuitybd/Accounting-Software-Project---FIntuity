import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { safeRequestPath } from './redact.ts';

export interface ErrorEnvelope {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: unknown;
  traceId: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class RequestValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(error: ZodError) {
    const fieldErrors = zodFieldErrors(error);
    super(400, 'VALIDATION_FAILED', 'Request validation failed.');
    this.name = 'RequestValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    const values = fieldErrors[key] ?? [];
    values.push(issue.message);
    fieldErrors[key] = values;
  }
  return fieldErrors;
}

function isProductionError(error: unknown): boolean {
  return error instanceof Error && !(error instanceof AppError);
}

/**
 * Build the stable API error envelope. Internal messages and stack traces are never returned to a
 * client; the trace id is the bridge to the server-side log entry.
 */
export function toErrorEnvelope(
  error: unknown,
  traceId: string,
  nodeEnv: 'development' | 'test' | 'production',
): { statusCode: number; body: ErrorEnvelope } {
  if (error instanceof RequestValidationError) {
    return {
      statusCode: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        traceId,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
        fieldErrors: zodFieldErrors(error),
        traceId,
      },
    };
  }

  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        traceId,
      },
    };
  }

  const fastifyError = error as Partial<FastifyError>;
  const suppliedStatus = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
  const statusCode = suppliedStatus >= 400 && suppliedStatus < 500 ? suppliedStatus : 500;

  if (statusCode < 500) {
    const isInvalidJson = fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY';
    return {
      statusCode,
      body: {
        code: isInvalidJson ? 'INVALID_JSON' : 'BAD_REQUEST',
        message: isInvalidJson ? 'The request body is not valid JSON.' : 'The request could not be processed.',
        traceId,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message:
        nodeEnv === 'production'
          ? 'An unexpected error occurred.'
          : error instanceof Error
            ? error.message
            : 'An unexpected error occurred.',
      traceId,
    },
  };
}

export function createErrorHandler(nodeEnv: 'development' | 'test' | 'production') {
  return function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
    const { statusCode, body } = toErrorEnvelope(error, request.id, nodeEnv);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else if (statusCode >= 400 && isProductionError(error)) {
      request.log.warn(
        { code: body.code, method: request.method, path: safeRequestPath(request.url) },
        'request rejected',
      );
    }

    reply.code(statusCode).send(body);
  };
}
