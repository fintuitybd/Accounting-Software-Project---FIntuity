import { Pool } from 'pg';
import type { AppConfig } from '../config.ts';

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    application_name: 'ledgervault-api',
    ...(config.dbSsl === 'require' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
