import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';

describe('structured logging', () => {
  it('redacts secrets and credentials before writing a log record', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/db',
      LOG_LEVEL: 'info',
    });
    const logger = createLogger(config, stream);

    logger.info(
      {
        password: 'hunter2',
        nested: { token: 'invitation-token', apiKey: 'key-123' },
        DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/db',
        req: { headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' } },
      },
      'redaction check',
    );

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('invitation-token');
    expect(output).not.toContain('key-123');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('session=abc');
    expect(output).not.toContain('user:secret');
  });
});
