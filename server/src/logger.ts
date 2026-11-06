import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from './config.ts';

/**
 * Redact credentials and common personal-data fields. Request bodies are never logged by this
 * service, so this list covers headers, error context and explicit metadata.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
  'req.remoteAddress',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'password_hash',
  '*.password_hash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'databaseUrl',
  '*.databaseUrl',
  'DATABASE_URL',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'ip',
  '*.ip',
];

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: {
      service: config.serviceName,
      version: config.serviceVersion,
      env: config.nodeEnv,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: '[REDACTED]',
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
