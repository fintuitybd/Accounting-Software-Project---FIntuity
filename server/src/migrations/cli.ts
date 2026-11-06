import { parseArgs } from 'node:util';
import type { Logger } from 'pino';
import { ConfigurationError, loadConfig } from '../config.ts';
import { createPool } from '../db/pool.ts';
import { loadDotEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { MigrationError, migrateDown, migrateUp, migrationStatus, resetDevelopmentDatabase } from './runner.ts';

function usage(): string {
  return [
    'Usage: npm run migrate -- <command> [options]',
    '',
    'Commands:',
    '  up                     Apply every pending migration',
    '  down --steps <n>       Roll back development/test migrations (default 1)',
    '  status                 Show applied and pending migrations',
    '  reset-dev --yes        Drop and recreate the public schema of a *_dev/*_test database',
    '',
    'Options:',
    '  --to <migration-id>    Apply up to and including this migration',
    '  --steps <n>            Number of migrations to roll back',
    '  --yes                  Required confirmation for reset-dev',
  ].join('\n');
}

function errorMessage(error: unknown): string {
  if (error instanceof ConfigurationError) {
    return `Invalid server configuration:\n${error.issues.map((issue) => `  - ${issue}`).join('\n')}`;
  }
  if (error instanceof MigrationError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Unknown migration error.';
}

async function main(): Promise<void> {
  loadDotEnv();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      to: { type: 'string' },
      steps: { type: 'string' },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(`${usage()}\n`);
    if (!command) process.exitCode = 1;
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const logger: Logger = createLogger(config);
  const pool = createPool(config);
  pool.on('error', (error) => logger.error({ err: error }, 'idle database client error'));

  try {
    switch (command) {
      case 'up': {
        const result = await migrateUp({
          pool,
          logger,
          nodeEnv: config.nodeEnv,
          ...(values.to ? { to: values.to } : {}),
        });
        process.stdout.write(
          `Applied ${result.applied.length} migration(s); ${result.alreadyApplied} already recorded.\n`,
        );
        break;
      }
      case 'down': {
        const steps = values.steps === undefined ? 1 : Number(values.steps);
        const result = await migrateDown({ pool, logger, nodeEnv: config.nodeEnv, steps });
        process.stdout.write(`Rolled back ${result.rolledBack.length} migration(s).\n`);
        break;
      }
      case 'status': {
        const rows = await migrationStatus({ pool, logger, nodeEnv: config.nodeEnv });
        process.stdout.write('MIGRATION\tSTATUS\tAPPLIED AT\n');
        for (const row of rows) {
          process.stdout.write(
            `${row.id}\t${row.applied ? 'APPLIED' : 'PENDING'}\t${row.appliedAt?.toISOString() ?? '-'}\n`,
          );
        }
        break;
      }
      case 'reset-dev': {
        if (!values.yes) {
          process.stderr.write(
            'Refusing to reset: this deletes every table in the public schema. Re-run with --yes on a *_dev or *_test database.\n',
          );
          process.exitCode = 1;
          break;
        }
        const result = await resetDevelopmentDatabase({ pool, logger, nodeEnv: config.nodeEnv });
        process.stdout.write(`Development database reset; applied ${result.applied.length} migration(s).\n`);
        break;
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
        process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main();
