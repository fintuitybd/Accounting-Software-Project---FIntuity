import type { Pool, PoolClient } from 'pg';

/**
 * Run a unit of work in a single PostgreSQL transaction. Every identity mutation that writes more
 * than one row (session + audit, invitation + audit, password + session revocation) must use this
 * helper so a failure cannot leave a half-applied security state.
 */
export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
