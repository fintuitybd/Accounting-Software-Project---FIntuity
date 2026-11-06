import { parseArgs } from 'node:util';
import type { PoolClient } from 'pg';
import { loadConfig, type AppConfig } from '../config.ts';
import { createPool } from '../db/pool.ts';
import { withTransaction } from '../db/transaction.ts';
import { loadDotEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { createEmailSender } from '../auth/email.ts';
import { assertPasswordPolicy, hashPassword } from '../auth/password.ts';
import { generateToken, hashToken, normaliseEmail } from '../auth/tokens.ts';

function usage(): string {
  return [
    'Create the first organisation owner. Run once against a new database.',
    '',
    'Usage: npm run auth:bootstrap -- --email owner@example.com --name "Owner Name" --organisation "Organisation Name" [--company "Company Name"] [--password "..."]',
    '',
    'Omit --password to create a single-use password-setup link through the configured email',
    'adapter. Supplying a password on the command line leaves it in shell history; prefer the link.',
  ].join('\n');
}

async function findOrCreateUser(
  client: PoolClient,
  config: AppConfig,
  email: string,
  name: string,
  password: string | undefined,
): Promise<{ userId: string; needsPasswordSetup: boolean }> {
  const existing = await client.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE lower(email) = $1 FOR UPDATE',
    [email],
  );
  if (existing.rows[0]) {
    const user = existing.rows[0];
    if (password && !user.password_hash) {
      assertPasswordPolicy(password, config, { email, name });
      const passwordHash = await hashPassword(password, config);
      await client.query(
        `UPDATE users SET name = $2, password_hash = $3, status = 'ACTIVE',
                          email_verified_at = COALESCE(email_verified_at, now()), password_changed_at = now()
          WHERE id = $1`,
        [user.id, name, passwordHash],
      );
      return { userId: user.id, needsPasswordSetup: false };
    }
    if (user.password_hash) return { userId: user.id, needsPasswordSetup: false };
    if (password) {
      assertPasswordPolicy(password, config, { email, name });
      const passwordHash = await hashPassword(password, config);
      await client.query(
        `UPDATE users SET name = $2, password_hash = $3, status = 'ACTIVE',
                          email_verified_at = COALESCE(email_verified_at, now()), password_changed_at = now()
          WHERE id = $1`,
        [user.id, name, passwordHash],
      );
      return { userId: user.id, needsPasswordSetup: false };
    }
    return { userId: user.id, needsPasswordSetup: true };
  }

  if (!password) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, status)
       VALUES ($1, $2, NULL, 'ACTIVE')
       RETURNING id`,
      [email, name],
    );
    const userId = inserted.rows[0]?.id;
    if (!userId) throw new Error('The owner account could not be created.');
    return { userId, needsPasswordSetup: true };
  }
  assertPasswordPolicy(password, config, { email, name });
  const passwordHash = await hashPassword(password, config);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, status, email_verified_at, password_changed_at)
     VALUES ($1, $2, $3, 'ACTIVE', now(), now())
     RETURNING id`,
    [email, name, passwordHash],
  );
  const userId = inserted.rows[0]?.id;
  if (!userId) throw new Error('The owner account could not be created.');
  return { userId, needsPasswordSetup: false };
}

async function main(): Promise<void> {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      organisation: { type: 'string' },
      company: { type: 'string' },
      password: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const email = values.email ? normaliseEmail(values.email) : '';
  const name = values.name?.trim() ?? '';
  const organisationName = values.organisation?.trim() ?? '';
  if (!email || !name || !organisationName) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config);
  const emailSender = createEmailSender(config);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.passwordResetExpiryMinutes * 60_000);
  const token = generateToken(32);

  try {
    const result = await withTransaction(pool, async (client) => {
      const organisation = await client.query<{ id: string }>(
        `INSERT INTO organisations (name, country, timezone, status)
         VALUES ($1, 'BD', 'Asia/Dhaka', 'ACTIVE')
         RETURNING id`,
        [organisationName],
      );
      const organisationId = organisation.rows[0]?.id;
      if (!organisationId) throw new Error('The organisation could not be created.');

      const owner = await findOrCreateUser(client, config, email, name, values.password);
      const membership = await client.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM memberships
          WHERE organisation_id = $1 AND user_id = $2 FOR UPDATE`,
        [organisationId, owner.userId],
      );
      let membershipId = membership.rows[0]?.id;
      if (membership.rows[0]) {
        if (membership.rows[0].role !== 'OWNER' || membership.rows[0].status !== 'ACTIVE') {
          await client.query(`UPDATE memberships SET role = 'OWNER', status = 'ACTIVE' WHERE id = $1`, [membershipId]);
        }
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO memberships (organisation_id, user_id, role, status)
           VALUES ($1, $2, 'OWNER', 'ACTIVE')
           RETURNING id`,
          [organisationId, owner.userId],
        );
        membershipId = inserted.rows[0]?.id;
      }
      if (!membershipId) throw new Error('The owner membership could not be created.');

      let companyId: string | null = null;
      if (values.company?.trim()) {
        const company = await client.query<{ id: string }>(
          `INSERT INTO companies (organisation_id, legal_name, status)
           VALUES ($1, $2, 'ACTIVE')
           RETURNING id`,
          [organisationId, values.company.trim()],
        );
        companyId = company.rows[0]?.id ?? null;
        if (!companyId) throw new Error('The company could not be created.');
        await client.query(
          `INSERT INTO company_memberships (organisation_id, company_id, membership_id, status)
           VALUES ($1, $2, $3, 'ACTIVE')`,
          [organisationId, companyId, membershipId],
        );
      }

      if (owner.needsPasswordSetup) {
        await client.query(
          `UPDATE password_reset_tokens SET used_at = now()
            WHERE user_id = $1 AND used_at IS NULL`,
          [owner.userId],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [owner.userId, hashToken(token), expiresAt],
        );
      }

      await writeAuditEvent(client, {
        organisationId,
        companyId,
        actorUserId: owner.userId,
        action: 'bootstrap.owner.created',
        entityType: 'organisation',
        entityId: organisationId,
        after: { email, companyId },
      });

      return { organisationId, userId: owner.userId, companyId, needsPasswordSetup: owner.needsPasswordSetup };
    });

    if (result.needsPasswordSetup) {
      await emailSender.send({
        to: email,
        subject: 'Set your Fintuity Accounting Suite owner password',
        text: [
          `Hello ${name},`,
          '',
          `The owner account for ${organisationName} has been created.`,
          'Set your password with this single-use link:',
          `${config.appOrigin}/reset-password?token=${encodeURIComponent(token)}`,
          '',
          `The link expires at ${expiresAt.toISOString()}.`,
        ].join('\n'),
      });
    }

    process.stdout.write(
      [
        'Bootstrap complete.',
        `Organisation: ${result.organisationId}`,
        `Owner user:   ${result.userId}`,
        `Company:      ${result.companyId ?? '(none; create one in Phase 4)'}`,
        result.needsPasswordSetup
          ? `Password setup email queued via ${emailSender.transport}.`
          : 'Owner has a password and can sign in.',
      ].join('\n') + '\n',
    );
  } catch (error) {
    logger.error({ err: error }, 'bootstrap failed');
    process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap failed.'}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main();
