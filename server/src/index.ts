import { buildApp } from './app.ts';
import { ConfigurationError, loadConfig, type AppConfig } from './config.ts';
import { createPool } from './db/pool.ts';
import { loadDotEnv } from './env.ts';
import { createLogger } from './logger.ts';

async function main(): Promise<void> {
  loadDotEnv();

  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(
        `Invalid server configuration:\n${error.issues.map((issue) => `  - ${issue}`).join('\n')}\n`,
      );
    } else {
      process.stderr.write('Unable to load server configuration.\n');
    }
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config);
  const pool = createPool(config);
  pool.on('error', (error) => {
    logger.error({ err: error }, 'idle database client error');
  });

  const app = await buildApp({ config, pool, logger });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    try {
      await app.close();
      await pool.end();
      clearTimeout(forceExit);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ host: config.host, port: config.port }, 'api listening');
  } catch (error) {
    logger.error({ err: error }, 'failed to start api');
    await pool.end();
    process.exitCode = 1;
  }
}

void main();
