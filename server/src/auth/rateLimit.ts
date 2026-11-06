import type { Pool } from 'pg';
import { withTransaction } from '../db/transaction.ts';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Database-backed fixed-window limiter. Keeping the counter in PostgreSQL means the limit is
 * shared by every API instance instead of being bypassable by hitting a different process.
 */
export async function consumeRateLimit(
  pool: Pool,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  lockSeconds = windowSeconds,
): Promise<RateLimitResult> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      counter: number;
      window_started_at: Date;
      locked_until: Date | null;
    }>(
      `SELECT counter, window_started_at, locked_until
         FROM rate_limit_counters
        WHERE bucket_key = $1
        FOR UPDATE`,
      [bucketKey],
    );

    const now = new Date();
    const row = existing.rows[0];
    if (!row) {
      await client.query(
        `INSERT INTO rate_limit_counters (bucket_key, window_started_at, counter, locked_until, updated_at)
         VALUES ($1, $2, 1, NULL, $2)`,
        [bucketKey, now],
      );
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    if (row.locked_until && row.locked_until.getTime() > now.getTime()) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000)),
      };
    }

    const windowStart = row.window_started_at.getTime();
    const elapsedSeconds = (now.getTime() - windowStart) / 1000;
    if (elapsedSeconds >= windowSeconds) {
      await client.query(
        `UPDATE rate_limit_counters
            SET window_started_at = $2, counter = 1, locked_until = NULL, updated_at = $2
          WHERE bucket_key = $1`,
        [bucketKey, now],
      );
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    const nextCount = row.counter + 1;
    if (nextCount > limit) {
      const lockedUntil = new Date(now.getTime() + lockSeconds * 1000);
      await client.query(
        `UPDATE rate_limit_counters
            SET counter = $2, locked_until = $3, updated_at = $4
          WHERE bucket_key = $1`,
        [bucketKey, nextCount, lockedUntil, now],
      );
      return { allowed: false, remaining: 0, retryAfterSeconds: lockSeconds };
    }

    await client.query(
      `UPDATE rate_limit_counters
          SET counter = $2, updated_at = $3
        WHERE bucket_key = $1`,
      [bucketKey, nextCount, now],
    );
    return { allowed: true, remaining: Math.max(0, limit - nextCount), retryAfterSeconds: 0 };
  });
}

export async function clearRateLimit(pool: Pool, bucketKey: string): Promise<void> {
  await pool.query('DELETE FROM rate_limit_counters WHERE bucket_key = $1', [bucketKey]);
}
