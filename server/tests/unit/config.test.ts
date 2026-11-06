import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../../src/config.ts';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ledger_user:not-a-real-secret@127.0.0.1:5432/ledgervault_test',
};

describe('server configuration', () => {
  it('applies safe local defaults and parses typed values', () => {
    const config = loadConfig({ ...validEnvironment, PORT: '3100', DB_POOL_MAX: '4', TRUST_PROXY: 'true' });
    expect(config.nodeEnv).toBe('test');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3100);
    expect(config.logLevel).toBe('info');
    expect(config.trustProxy).toBe(true);
    expect(config.dbSsl).toBe('disable');
    expect(config.dbPoolMax).toBe(4);
    expect(config.serviceName).toBe('ledgervault-api');
    expect(config.serviceVersion).toBe('0.1.0');
    expect(config.sessionIdleMinutes).toBe(30);
    expect(config.sessionAbsoluteHours).toBe(12);
    expect(config.cookieSecure).toBe(false);
  });

  it('defaults to secure cookies in production and rejects a localhost public origin', () => {
    expect(() => loadConfig({ ...validEnvironment, NODE_ENV: 'production' })).toThrowError(ConfigurationError);
    const production = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://app.example.test',
    });
    expect(production.cookieSecure).toBe(true);
    const overridden = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://app.example.test',
      COOKIE_SECURE: 'false',
    });
    expect(overridden.cookieSecure).toBe(false);
  });

  it('refuses to start without DATABASE_URL and does not echo values in the error', () => {
    try {
      loadConfig({ NODE_ENV: 'test' });
      throw new Error('Configuration should have been rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const issues = (error as ConfigurationError).issues.join(' ');
      expect(issues).toContain('DATABASE_URL');
      expect(issues).not.toContain('not-a-real-secret');
    }
  });

  it('rejects a non-PostgreSQL connection URL', () => {
    expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: 'mysql://user:pass@localhost/db' })).toThrowError(
      ConfigurationError,
    );
  });

  it('rejects an invalid port and an invalid SSL mode', () => {
    expect(() => loadConfig({ ...validEnvironment, PORT: '70000' })).toThrowError(ConfigurationError);
    expect(() => loadConfig({ ...validEnvironment, DB_SSL: 'sometimes' })).toThrowError(ConfigurationError);
  });
});
