import type { Pool, PoolClient } from 'pg';

export interface AuditEventInput {
  organisationId?: string | null;
  companyId?: string | null;
  actorUserId?: string | null;
  sessionId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * Append an identity/access event. Callers pass either the transaction client (so the audit row and
 * the mutation commit together) or the pool for a best-effort denial event. Secrets, passwords and
 * raw tokens must never be placed in before/after.
 */
export async function writeAuditEvent(database: Queryable, event: AuditEventInput): Promise<void> {
  await database.query(
    `INSERT INTO audit_events (
       organisation_id, company_id, actor_user_id, session_id, action, entity_type, entity_id,
       before_json, after_json, reason, ip, user_agent, request_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      event.organisationId ?? null,
      event.companyId ?? null,
      event.actorUserId ?? null,
      event.sessionId ?? null,
      event.action,
      event.entityType,
      event.entityId ?? null,
      event.before ?? null,
      event.after ?? null,
      event.reason ?? null,
      event.ip ?? null,
      event.userAgent ?? null,
      event.requestId ?? null,
    ],
  );
}

/** Audit helper for denied requests. It must never make a denial succeed if audit storage fails. */
export async function writeDeniedAudit(
  database: Queryable,
  event: Omit<AuditEventInput, 'action'> & { action?: string },
): Promise<void> {
  await writeAuditEvent(database, { ...event, action: event.action ?? 'auth.access.denied' });
}
