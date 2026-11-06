import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { escapeCsvCell } from '../company/csv.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface AuditEventDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  sessionId: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditQueryInput {
  from?: string | null;
  to?: string | null;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorUserId?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  session_id: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: Date;
}

const AUDIT_SELECT = `
  SELECT ae.id, ae.action, ae.entity_type, ae.entity_id, ae.actor_user_id,
         u.name AS actor_name, u.email AS actor_email, ae.session_id, ae.reason, ae.ip,
         ae.user_agent, ae.request_id, ae.before_json, ae.after_json, ae.created_at
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.actor_user_id
`;

/**
 * Company audit view includes company-scoped events and organisation-level identity events for
 * users who have active access to this company. It never returns another company's events.
 */
const COMPANY_SCOPE = `
  (
    ae.company_id = $1
    OR (
      ae.company_id IS NULL
      AND ae.organisation_id = (SELECT organisation_id FROM companies WHERE id = $1)
      AND EXISTS (
        SELECT 1
          FROM company_memberships cm
          JOIN memberships m ON m.id = cm.membership_id
         WHERE cm.company_id = $1
           AND cm.status = 'ACTIVE'
           AND m.status = 'ACTIVE'
           AND m.user_id = ae.actor_user_id
      )
    )
  )
`;

function buildFilter(input: AuditQueryInput): { where: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length + 1}`));
  };
  if (input.from) add('ae.created_at >= ?::date', input.from);
  if (input.to) add("ae.created_at < (?::date + interval '1 day')", input.to);
  if (input.action) add('ae.action = ?', input.action);
  if (input.entityType) add('ae.entity_type = ?', input.entityType);
  if (input.entityId) add('ae.entity_id = ?', input.entityId);
  if (input.actorUserId) add('ae.actor_user_id = ?', input.actorUserId);
  if (input.q) {
    values.push(`%${input.q.trim()}%`);
    const placeholder = `$${values.length + 1}`;
    where.push(
      `(ae.action ILIKE ${placeholder} OR ae.entity_type ILIKE ${placeholder} OR ae.entity_id ILIKE ${placeholder} OR ae.reason ILIKE ${placeholder})`,
    );
  }
  return { where, values };
}

function mapRow(row: AuditRow): AuditEventDto {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    sessionId: row.session_id,
    reason: row.reason,
    ip: row.ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    before: row.before_json,
    after: row.after_json,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listAuditEvents(
  database: Queryable,
  companyId: string,
  input: AuditQueryInput,
): Promise<{ entries: AuditEventDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const filter = buildFilter(input);
  const scopeValues = [companyId, ...filter.values];
  const where = [COMPANY_SCOPE, ...filter.where];
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM audit_events ae WHERE ${where.join(' AND ')}`,
    scopeValues,
  );
  const values = [...scopeValues, limit, offset];
  const rows = await database.query<AuditRow>(
    `${AUDIT_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY ae.created_at DESC, ae.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { entries: rows.rows.map(mapRow), total: Number(count.rows[0]?.total ?? 0), limit, offset };
}

export async function exportAuditEventsCsv(
  database: Queryable,
  companyId: string,
  input: AuditQueryInput,
  audit: {
    organisationId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
  },
): Promise<{ csv: string; filename: string; rowCount: number }> {
  const filter = buildFilter(input);
  const scopeValues = [companyId, ...filter.values];
  const where = [COMPANY_SCOPE, ...filter.where];
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM audit_events ae WHERE ${where.join(' AND ')}`,
    scopeValues,
  );
  const total = Number(count.rows[0]?.total ?? 0);
  const maxRows = 20_000;
  if (total > maxRows) {
    throw new AppError(
      409,
      'AUDIT_EXPORT_TOO_LARGE',
      `This audit query has ${total.toLocaleString('en-US')} events. Narrow the date or action filter below ${maxRows.toLocaleString('en-US')} before exporting.`,
      { total, maxRows },
    );
  }
  const rows = await database.query<AuditRow>(
    `${AUDIT_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY ae.created_at ASC, ae.id ASC
      LIMIT ${maxRows}`,
    scopeValues,
  );
  const header = [
    'created_at',
    'action',
    'entity_type',
    'entity_id',
    'actor_name',
    'actor_email',
    'actor_user_id',
    'session_id',
    'reason',
    'ip',
    'user_agent',
    'request_id',
    'before_json',
    'after_json',
  ];
  const lines = [header.join(',')];
  for (const row of rows.rows) {
    lines.push(
      [
        row.created_at.toISOString(),
        row.action,
        row.entity_type,
        row.entity_id,
        row.actor_name,
        row.actor_email,
        row.actor_user_id,
        row.session_id,
        row.reason,
        row.ip,
        row.user_agent,
        row.request_id,
        row.before_json ? JSON.stringify(row.before_json) : '',
        row.after_json ? JSON.stringify(row.after_json) : '',
      ]
        .map((value) => escapeCsvCell(value ?? ''))
        .join(','),
    );
  }
  await writeAuditEvent(database, {
    organisationId: audit.organisationId,
    companyId,
    actorUserId: audit.actorUserId,
    sessionId: audit.sessionId,
    action: 'audit.exported',
    entityType: 'audit_log',
    entityId: companyId,
    after: {
      rowCount: rows.rows.length,
      filters: {
        from: input.from ?? null,
        to: input.to ?? null,
        action: input.action ?? null,
        entityType: input.entityType ?? null,
        actorUserId: input.actorUserId ?? null,
        q: input.q ?? null,
      },
    },
    reason: 'Audit log exported for review or external audit evidence.',
    ip: audit.ip,
    userAgent: audit.userAgent,
    requestId: audit.requestId,
  });
  return {
    csv: `\uFEFF${lines.join('\r\n')}\r\n`,
    filename: `audit-log-${companyId}-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: rows.rows.length,
  };
}
