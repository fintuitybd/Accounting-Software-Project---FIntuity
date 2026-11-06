import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { DEFAULT_NUMBER_PREFIXES, DOCUMENT_TYPES } from './constants.ts';
import { fiscalYearLabel, formatDatabaseDate, generateMonthlyPeriods, isValidIsoDate } from './dates.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface PeriodDto {
  id: string;
  companyId: string;
  fiscalYearId: string;
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
  lockedAt: string | null;
  reopenedReason: string | null;
}

export interface FiscalYearDto {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
  periods: PeriodDto[];
}

interface FiscalYearRow {
  id: string;
  company_id: string;
  label: string;
  start_date: Date;
  end_date: Date;
  status: string;
  created_at: Date;
}

interface PeriodRow {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  code: string;
  label: string;
  start_date: Date;
  end_date: Date;
  status: string;
  closed_at: Date | null;
  locked_at: Date | null;
  reopened_reason: string | null;
}

function isoDate(value: Date): string {
  return formatDatabaseDate(value);
}

function mapPeriod(row: PeriodRow): PeriodDto {
  return {
    id: row.id,
    companyId: row.company_id,
    fiscalYearId: row.fiscal_year_id,
    code: row.code,
    label: row.label,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    status: row.status as PeriodDto['status'],
    closedAt: row.closed_at?.toISOString() ?? null,
    lockedAt: row.locked_at?.toISOString() ?? null,
    reopenedReason: row.reopened_reason,
  };
}

async function loadPeriods(database: Queryable, companyId: string, fiscalYearId?: string): Promise<PeriodDto[]> {
  const values: unknown[] = [companyId];
  const filter = fiscalYearId ? `AND fiscal_year_id = $2` : '';
  if (fiscalYearId) values.push(fiscalYearId);
  const result = await database.query<PeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status,
            closed_at, locked_at, reopened_reason
       FROM periods
      WHERE company_id = $1 ${filter}
      ORDER BY start_date ASC`,
    values,
  );
  return result.rows.map(mapPeriod);
}

export async function listFiscalYears(database: Queryable, companyId: string): Promise<FiscalYearDto[]> {
  const result = await database.query<FiscalYearRow>(
    `SELECT id, company_id, label, start_date, end_date, status, created_at
       FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC`,
    [companyId],
  );
  const periods = await loadPeriods(database, companyId);
  const byYear = new Map<string, PeriodDto[]>();
  for (const period of periods) {
    const list = byYear.get(period.fiscalYearId) ?? [];
    list.push(period);
    byYear.set(period.fiscalYearId, list);
  }
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    label: row.label,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    periods: byYear.get(row.id) ?? [],
  }));
}

export async function listPeriods(database: Queryable, companyId: string): Promise<PeriodDto[]> {
  return loadPeriods(database, companyId);
}

export async function findPeriodForDate(
  database: Queryable,
  companyId: string,
  date: string,
): Promise<PeriodDto | null> {
  if (!isValidIsoDate(date)) {
    throw new AppError(400, 'INVALID_DATE', 'Use a real calendar date in YYYY-MM-DD format.');
  }
  const result = await database.query<PeriodRow>(
    `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status,
            closed_at, locked_at, reopened_reason
       FROM periods
      WHERE company_id = $1 AND start_date <= $2::date AND end_date >= $2::date
      LIMIT 1`,
    [companyId, date],
  );
  const row = result.rows[0];
  return row ? mapPeriod(row) : null;
}

export async function requirePeriodForDate(database: Queryable, companyId: string, date: string): Promise<PeriodDto> {
  const period = await findPeriodForDate(database, companyId, date);
  if (!period) {
    throw new AppError(
      400,
      'PERIOD_NOT_FOUND',
      `No accounting period is configured for ${date}. Generate the fiscal year before posting or preparing opening balances.`,
    );
  }
  return period;
}

export type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED';

/**
 * Change a period's posting status. Phase 5 deliberately does not implement the close checklist or
 * sign-off; it enforces the explicit status and records who changed it, why, and the before/after
 * state. A posting service locks the period row FOR SHARE, so a close waits for in-flight postings.
 */
export async function updatePeriodStatus(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    periodId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    status: PeriodStatus;
    reason: string;
  },
): Promise<PeriodDto> {
  if (!['OPEN', 'CLOSED', 'LOCKED'].includes(input.status)) {
    throw new AppError(400, 'PERIOD_STATUS_INVALID', 'Choose OPEN, CLOSED or LOCKED.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new AppError(
      400,
      'PERIOD_REASON_REQUIRED',
      'A period status reason between 3 and 500 characters is required.',
    );
  }

  return withTransaction(pool, async (client) => {
    const result = await client.query<PeriodRow>(
      `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status,
              closed_at, locked_at, reopened_reason
         FROM periods
        WHERE company_id = $1 AND id = $2
        FOR UPDATE`,
      [input.companyId, input.periodId],
    );
    const period = result.rows[0];
    if (!period) throw new AppError(404, 'PERIOD_NOT_FOUND', 'Accounting period not found.');
    if (period.status === input.status) {
      throw new AppError(409, 'PERIOD_STATUS_UNCHANGED', `Period ${period.code} is already ${input.status}.`);
    }
    if (!['OPEN', 'CLOSED', 'LOCKED'].includes(period.status)) {
      throw new AppError(409, 'PERIOD_STATUS_UNKNOWN', 'The period has an unknown status and cannot be changed.');
    }

    const now = new Date();
    const closedAt = input.status === 'CLOSED' ? now : input.status === 'LOCKED' ? period.closed_at : null;
    const closedBy = input.status === 'CLOSED' ? input.actorUserId : null;
    const lockedAt = input.status === 'LOCKED' ? now : null;
    const lockedBy = input.status === 'LOCKED' ? input.actorUserId : null;
    const reopenedReason = input.status === 'OPEN' ? reason : period.reopened_reason;

    // closed_by is only preserved when moving CLOSED -> LOCKED; the select above does not return it,
    // so use a CASE on the current row to keep the original closer's identity.
    await client.query(
      `UPDATE periods
          SET status = $3,
              closed_at = $4,
              closed_by = CASE
                WHEN $3 = 'CLOSED' THEN $5
                WHEN $3 = 'LOCKED' THEN closed_by
                ELSE NULL
              END,
              locked_at = $6,
              locked_by = $7,
              reopened_reason = $8,
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.periodId, input.status, closedAt, closedBy, lockedAt, lockedBy, reopenedReason],
    );

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'period.status_changed',
      entityType: 'period',
      entityId: input.periodId,
      before: {
        status: period.status,
        closedAt: period.closed_at?.toISOString() ?? null,
        lockedAt: period.locked_at?.toISOString() ?? null,
      },
      after: {
        status: input.status,
        closedAt: closedAt?.toISOString() ?? null,
        lockedAt: lockedAt?.toISOString() ?? null,
      },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    const saved = await client.query<PeriodRow>(
      `SELECT id, company_id, fiscal_year_id, code, label, start_date, end_date, status,
              closed_at, locked_at, reopened_reason
         FROM periods
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.periodId],
    );
    const row = saved.rows[0];
    if (!row) throw new AppError(404, 'PERIOD_NOT_FOUND', 'Accounting period not found.');
    return mapPeriod(row);
  });
}

export async function createFiscalYear(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    startDate: string;
    endDate: string;
    label?: string;
  },
): Promise<FiscalYearDto> {
  if (!isValidIsoDate(input.startDate) || !isValidIsoDate(input.endDate)) {
    throw new AppError(400, 'FISCAL_YEAR_INVALID_RANGE', 'Use real calendar dates in YYYY-MM-DD format.');
  }
  let months;
  try {
    months = generateMonthlyPeriods(input.startDate, input.endDate);
  } catch (error) {
    throw new AppError(
      400,
      'FISCAL_YEAR_INVALID_RANGE',
      error instanceof Error ? error.message : 'The fiscal year range is invalid.',
    );
  }
  // The generator permits a transition year of up to 24 whole months. No statutory fiscal-year
  // length is assumed; the administrator supplies the range and the label is stored explicitly.
  const label = input.label?.trim() || fiscalYearLabel(input.startDate, input.endDate);
  if (label.length < 1 || label.length > 60) {
    throw new AppError(400, 'FISCAL_YEAR_LABEL_INVALID', 'The fiscal year label must be 1–60 characters.');
  }

  return withTransaction(pool, async (client) => {
    // Serialise setup for this company so two concurrent requests cannot both pass the overlap check.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fiscal-year:${input.companyId}`]);
    const overlap = await client.query(
      `SELECT 1 FROM fiscal_years
        WHERE company_id = $1
          AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
        LIMIT 1`,
      [input.companyId, input.startDate, input.endDate],
    );
    if (overlap.rowCount && overlap.rowCount > 0) {
      throw new AppError(
        409,
        'FISCAL_YEAR_OVERLAP',
        'That fiscal year overlaps an existing fiscal year for this company. Choose a non-overlapping range.',
      );
    }
    const periodOverlap = await client.query(
      `SELECT 1 FROM periods
        WHERE company_id = $1
          AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
        LIMIT 1`,
      [input.companyId, input.startDate, input.endDate],
    );
    if (periodOverlap.rowCount && periodOverlap.rowCount > 0) {
      throw new AppError(
        409,
        'PERIOD_OVERLAP',
        'The requested fiscal year overlaps periods that already exist for this company.',
      );
    }

    let fiscalYear;
    try {
      fiscalYear = await client.query<{ id: string }>(
        `INSERT INTO fiscal_years (company_id, label, start_date, end_date, status, created_by)
         VALUES ($1, $2, $3, $4, 'OPEN', $5)
         RETURNING id`,
        [input.companyId, label, input.startDate, input.endDate, input.actorUserId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'FISCAL_YEAR_OVERLAP', 'That fiscal year overlaps an existing fiscal year.');
      }
      throw error;
    }
    const fiscalYearId = fiscalYear.rows[0]?.id;
    if (!fiscalYearId) throw new AppError(500, 'FISCAL_YEAR_CREATE_FAILED', 'The fiscal year could not be created.');

    for (const month of months) {
      try {
        await client.query(
          `INSERT INTO periods (company_id, fiscal_year_id, code, label, start_date, end_date, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')`,
          [input.companyId, fiscalYearId, month.code, month.label, month.startDate, month.endDate],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new AppError(
            409,
            'PERIOD_OVERLAP',
            `Period ${month.code} overlaps an existing period for this company.`,
          );
        }
        throw error;
      }
    }

    for (const docType of DOCUMENT_TYPES) {
      await client.query(
        `INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
         VALUES ($1, $2, $3, $4, 1, 4)`,
        [input.companyId, fiscalYearId, docType, DEFAULT_NUMBER_PREFIXES[docType]],
      );
    }

    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'fiscal_year.created',
      entityType: 'fiscal_year',
      entityId: fiscalYearId,
      after: {
        label,
        startDate: input.startDate,
        endDate: input.endDate,
        periods: months.map((month) => month.code),
        status: 'OPEN',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    const saved = await listFiscalYears(client, input.companyId);
    const created = saved.find((year) => year.id === fiscalYearId);
    if (!created) throw new AppError(500, 'FISCAL_YEAR_CREATE_FAILED', 'The fiscal year could not be loaded.');
    return created;
  });
}
