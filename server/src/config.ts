import { z } from 'zod';

const postgresUrl = z
  .string({ error: 'DATABASE_URL is required' })
  .min(1, 'DATABASE_URL is required')
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'must be a valid PostgreSQL connection URL',
      });
      return;
    }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      context.addIssue({
        code: 'custom',
        message: 'must use the postgres:// or postgresql:// scheme',
      });
    }
    if (!parsed.hostname) {
      context.addIssue({
        code: 'custom',
        message: 'must include a database host',
      });
    }
    if (!parsed.pathname || parsed.pathname === '/') {
      context.addIssue({
        code: 'custom',
        message: 'must include a database name',
      });
    }
  });

const appOrigin = z
  .string({ error: 'APP_ORIGIN must be an absolute http(s) URL' })
  .url('APP_ORIGIN must be an absolute http(s) URL')
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'APP_ORIGIN must use http:// or https://' });
    }
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  DB_SSL: z.enum(['disable', 'require']).default('disable'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(5_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),

  // Browser/integration origin. Used for same-origin mutation checks and invitation links.
  APP_ORIGIN: appOrigin.default('http://localhost:5173'),

  // Sessions are opaque, server-side records. The idle window slides on authenticated activity;
  // the absolute window can never be extended.
  SESSION_COOKIE_NAME: z.string().min(1).max(64).default('lv_session'),
  CSRF_COOKIE_NAME: z.string().min(1).max(64).default('lv_csrf'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1_440).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_TOUCH_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3_600).default(60),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  // Authentication controls.
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10_000).default(20),
  INVITATION_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
  EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  // Argon2id parameters. Values follow the OWASP password-storage guidance for a 19 MiB memory
  // cost; tune only with a measured security/performance review.
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8_192).max(1_048_576).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

  // Email delivery configuration (file, memory, or production SMTP / AWS SES)
  EMAIL_MODE: z.enum(['file', 'memory', 'smtp']).optional(),
  EMAIL_TRANSPORT: z.enum(['file', 'memory', 'smtp']).default('file'),
  EMAIL_OUTBOX_DIR: z.string().min(1).default('.tmp/mail'),
  EMAIL_FROM: z.string().min(1).max(320).default('Fintuity Accounting Suite <no-reply@ledgervault.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export type NodeEnvironment = z.infer<typeof environmentSchema>['NODE_ENV'];
export type LogLevel = z.infer<typeof environmentSchema>['LOG_LEVEL'];

export type EmailTransportName = 'file' | 'memory' | 'smtp';

export interface EmailConfig {
  mode: EmailTransportName;
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
  outboxDir: string;
}

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
  trustProxy: boolean;
  dbSsl: 'disable' | 'require';
  dbPoolMax: number;
  dbIdleTimeoutMs: number;
  dbConnectionTimeoutMs: number;
  shutdownTimeoutMs: number;
  serviceName: string;
  serviceVersion: string;
  appOrigin: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  sessionTouchIntervalSeconds: number;
  cookieSecure: boolean;
  passwordMinLength: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  authRateLimitWindowMinutes: number;
  authRateLimitMaxAttempts: number;
  invitationExpiryHours: number;
  passwordResetExpiryMinutes: number;
  emailVerificationExpiryHours: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  emailTransport: EmailTransportName;
  emailOutboxDir: string;
  emailFrom: string;
  email: EmailConfig;
}

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super('Invalid server configuration.');
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/**
 * Validate the process environment. The error reports variable names and validation messages only;
 * it must never echo a connection string or another secret value.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigurationError(issues);
  }

  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1' || origin.hostname === '[::1]') {
      throw new ConfigurationError([
        'APP_ORIGIN must be the public application origin in production, not a localhost address.',
      ]);
    }
  }

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    dbSsl: env.DB_SSL,
    dbPoolMax: env.DB_POOL_MAX,
    dbIdleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
    dbConnectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    serviceName: 'ledgervault-api',
    serviceVersion: '0.1.0',
    appOrigin: env.APP_ORIGIN.replace(/\/+$/, ''),
    sessionCookieName: env.SESSION_COOKIE_NAME,
    csrfCookieName: env.CSRF_COOKIE_NAME,
    sessionIdleMinutes: env.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: env.SESSION_ABSOLUTE_HOURS,
    sessionTouchIntervalSeconds: env.SESSION_TOUCH_INTERVAL_SECONDS,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    passwordMinLength: env.PASSWORD_MIN_LENGTH,
    loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
    loginLockMinutes: env.LOGIN_LOCK_MINUTES,
    authRateLimitWindowMinutes: env.AUTH_RATE_LIMIT_WINDOW_MINUTES,
    authRateLimitMaxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    invitationExpiryHours: env.INVITATION_EXPIRY_HOURS,
    passwordResetExpiryMinutes: env.PASSWORD_RESET_EXPIRY_MINUTES,
    emailVerificationExpiryHours: env.EMAIL_VERIFICATION_EXPIRY_HOURS,
    argon2MemoryKib: env.ARGON2_MEMORY_KIB,
    argon2TimeCost: env.ARGON2_TIME_COST,
    argon2Parallelism: env.ARGON2_PARALLELISM,
    emailTransport: (env.EMAIL_MODE ?? env.EMAIL_TRANSPORT) as EmailTransportName,
    emailOutboxDir: env.EMAIL_OUTBOX_DIR,
    emailFrom: env.EMAIL_FROM,
    email: {
      mode: (env.EMAIL_MODE ?? env.EMAIL_TRANSPORT) as EmailTransportName,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      from: env.EMAIL_FROM,
      outboxDir: env.EMAIL_OUTBOX_DIR,
    },
  };
}
