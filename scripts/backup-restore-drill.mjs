// Backup and restore drill for PostgreSQL.
//
// This creates two disposable databases on the configured PostgreSQL server, applies every
// migration to the source, inserts a sentinel row, takes a custom-format pg_dump, restores it into
// the second database, and verifies the schema, migration ledger and data arrived intact. It never
// touches the application database named in DATABASE_URL; only a maintenance connection is used to
// create/drop the drill databases. Dumps are written under .tmp/ and deleted afterwards.
//
// Usage: npm run drill:backup-restore
// Optional: PG_DUMP=/path/to/pg_dump PG_RESTORE=/path/to/pg_restore

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const drillDirectory = path.join(root, '.tmp', 'backup-restore-drill');

function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!key || process.env[key] !== undefined) continue;
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sanitizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<unparseable database URL>';
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(
      `${path.basename(command)} exited with ${result.status ?? 'no status'}${output ? `: ${output.slice(0, 2000)}` : ''}`,
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function binaryMajor(candidate) {
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return 0;
  const match = /(\d+)(?:\.\d+)?/.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return match ? Number(match[1]) : 0;
}

function findPostgresBinary(name, preferredMajor) {
  const override = process.env[name.toUpperCase()]?.trim();
  if (override) {
    if (!existsSync(override)) throw new Error(`${name} override does not exist.`);
    return override;
  }
  const candidates = [];
  const locator = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (locator.status === 0) {
    for (const line of (locator.stdout ?? '').split(/\r?\n/)) {
      if (line.trim()) candidates.push(line.trim());
    }
  }
  if (process.platform === 'win32') {
    const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
    for (const rootPath of roots) {
      if (!existsSync(rootPath)) continue;
      const versions = readdirSync(rootPath).filter((entry) => /^\d+$/.test(entry));
      for (const version of versions) {
        candidates.push(path.join(rootPath, version, 'bin', `${name}.exe`));
      }
    }
  }
  const existing = Array.from(new Set(candidates)).filter((candidate) => existsSync(candidate));
  const exact = existing.find((candidate) => binaryMajor(candidate) === preferredMajor);
  if (exact) return exact;
  const best = existing.sort((a, b) => binaryMajor(b) - binaryMajor(a))[0];
  if (best) {
    process.stdout.write(
      `WARN no ${name} client matching server major ${preferredMajor}; using ${binaryMajor(best)} at ${best}\n`,
    );
    return best;
  }
  throw new Error(
    `${name} was not found. Install PostgreSQL client tools or set ${name.toUpperCase()} to the executable path.`,
  );
}

async function withClient(connectionString, action) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createDatabase(maintenanceUrl, name) {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function dropDatabase(maintenanceUrl, name) {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function urlFor(maintenanceUrl, name) {
  const parsed = new URL(maintenanceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function tableCounts(connectionString) {
  return withClient(connectionString, async (client) => {
    const tables = await client.query(
      `SELECT c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );
    const counts = {};
    for (const row of tables.rows) {
      const quoted = `"${String(row.name).replaceAll('"', '""')}"`;
      const result = await client.query(`SELECT count(*)::int AS count FROM ${quoted}`);
      counts[row.name] = result.rows[0].count;
    }
    return counts;
  });
}

async function main() {
  loadDotEnv();
  const maintenanceUrl = process.env.DATABASE_URL?.trim();
  if (!maintenanceUrl) throw new Error('DATABASE_URL is not configured.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a restore drill with NODE_ENV=production. Use a staging database.');
  }

  const serverVersionNumber = await withClient(maintenanceUrl, async (client) => {
    const result = await client.query('SHOW server_version_num');
    return Number(result.rows[0]?.server_version_num ?? 0);
  });
  const serverMajor = Math.floor(serverVersionNumber / 10_000);
  const pgDump = findPostgresBinary('pg_dump', serverMajor);
  const pgRestore = findPostgresBinary('pg_restore', serverMajor);
  const dumpMajor = binaryMajor(pgDump);
  const restoreMajor = binaryMajor(pgRestore);
  process.stdout.write(
    `PostgreSQL server major ${serverMajor}; pg_dump major ${dumpMajor}; pg_restore major ${restoreMajor}\n`,
  );
  if (dumpMajor !== serverMajor || restoreMajor !== serverMajor) {
    throw new Error(
      `pg_dump/pg_restore major versions must match the PostgreSQL server (${serverMajor}). ` +
        'Set PG_DUMP and PG_RESTORE to matching client binaries; a mismatched client can emit settings the server rejects.',
    );
  }
  const suffix = `${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const sourceName = `ledgervault_drill_src_${suffix}`;
  const targetName = `ledgervault_drill_dst_${suffix}`;
  const sourceUrl = urlFor(maintenanceUrl, sourceName);
  const targetUrl = urlFor(maintenanceUrl, targetName);
  const dumpPath = path.join(drillDirectory, `${suffix}.dump`);
  const sentinelId = randomUUID();
  let createdSource = false;
  let createdTarget = false;

  mkdirSync(drillDirectory, { recursive: true });
  process.stdout.write(`Restore drill target server: ${sanitizeUrl(maintenanceUrl)}\n`);

  try {
    await createDatabase(maintenanceUrl, sourceName);
    createdSource = true;
    process.stdout.write(`PASS created disposable source database ${sourceName}\n`);

    const migrationOutput = run(process.execPath, ['server/src/migrations/cli.ts', 'up'], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: sourceUrl },
    });
    process.stdout.write(`PASS ${migrationOutput.replaceAll(/\s+/g, ' ').trim()}\n`);

    const sourceCounts = await withClient(sourceUrl, async (client) => {
      await client.query(
        `INSERT INTO demo_requests (id, name, email, company, message, source)
         VALUES ($1, $2, $3, $4, $5, 'landing')`,
        [
          sentinelId,
          'Restore drill sentinel',
          `restore-drill-${suffix}@example.test`,
          'LedgerVault restore drill',
          'This row proves data survived pg_dump and pg_restore.',
        ],
      );
      const migrations = await client.query('SELECT count(*)::int AS count FROM schema_migrations');
      return { migrations: migrations.rows[0].count };
    });
    const sourceTables = await tableCounts(sourceUrl);
    process.stdout.write(
      `PASS prepared source: ${sourceCounts.migrations} migration(s), ${Object.keys(sourceTables).length} table(s)\n`,
    );

    run(pgDump, ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpPath}`, sourceUrl]);
    const dumpBytes = statSync(dumpPath).size;
    process.stdout.write(`PASS pg_dump completed (${dumpBytes} bytes, custom format)\n`);

    await createDatabase(maintenanceUrl, targetName);
    createdTarget = true;
    process.stdout.write(`PASS created disposable target database ${targetName}\n`);

    run(pgRestore, ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${targetUrl}`, dumpPath]);
    process.stdout.write('PASS pg_restore completed into the isolated target database\n');

    const targetResult = await withClient(targetUrl, async (client) => {
      const sentinel = await client.query('SELECT name, company FROM demo_requests WHERE id = $1', [sentinelId]);
      const migrations = await client.query('SELECT count(*)::int AS count FROM schema_migrations');
      return { sentinel: sentinel.rows, migrations: migrations.rows[0].count };
    });
    const targetTables = await tableCounts(targetUrl);

    if (targetResult.sentinel.length !== 1) throw new Error('Sentinel row did not survive the restore.');
    if (targetResult.migrations !== sourceCounts.migrations) {
      throw new Error('Migration ledger counts differ after restore.');
    }
    const sourceNames = Object.keys(sourceTables).sort();
    const targetNames = Object.keys(targetTables).sort();
    if (JSON.stringify(sourceNames) !== JSON.stringify(targetNames)) {
      throw new Error('Restored table list differs from the source database.');
    }
    for (const table of sourceNames) {
      if (sourceTables[table] !== targetTables[table]) {
        throw new Error(`Row count differs for table ${table}.`);
      }
    }

    process.stdout.write(
      `PASS restored sentinel row and ${targetResult.migrations} migration(s) across ${targetNames.length} table(s)\n`,
    );
    process.stdout.write('PASS backup restore drill completed; dropped both disposable databases\n');
  } finally {
    if (existsSync(dumpPath)) rmSync(dumpPath, { force: true });
    if (createdTarget) await dropDatabase(maintenanceUrl, targetName).catch(() => undefined);
    if (createdSource) await dropDatabase(maintenanceUrl, sourceName).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`FAIL backup restore drill: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
