import type { Pool } from 'pg';
import type { Database } from '../db/client.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    orm: Database;
  }
}

export {};
