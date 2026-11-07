// Bangladesh Statutory Compliance Calendar Engine & Holiday-Aware Deadline Advancement.
//
// Governed by:
// - Ordinance No. 38 of 2026 Section 64 (15-day VAT Mushak 9.1 filing rule)
// - Income Tax Act 2023 Section 177 (Monthly TDS Withholding Statement)
// - Income Tax Act 2023 Section 154 (Quarterly Advance Income Tax - AIT)
// - Companies Act 1994 / RJSC Section 36 (Annual Return of Shareholders & Financials)
//
// Core Mathematical Invariant:
// 1 BDT = 100 poisha (bigint). Zero IEEE-754 floats.
// Bangladesh Weekend: Friday (day === 5) and Saturday (day === 6).

import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type StatutoryBody = 'NBR_VAT' | 'NBR_TAX' | 'RJSC' | 'MOLE';
export type ComplianceCategory =
  | 'VAT_91'
  | 'VDS_DEPOSIT'
  | 'TDS_MONTHLY'
  | 'TDS_177'
  | 'AIT_Q'
  | 'ANNUAL_TAX'
  | 'RJSC_ANNUAL';
export type ComplianceStatus = 'PENDING' | 'PREPARED' | 'FILED' | 'OVERDUE';

export interface ComplianceCalendarEventDto {
  id: string;
  companyId: string;
  branchId: string | null;
  periodId: string | null;
  fiscalYearId: string;
  titleEn: string;
  titleBn: string;
  statutoryBody: StatutoryBody;
  category: ComplianceCategory;
  statutoryDeadline: string; // YYYY-MM-DD
  adjustedDeadline: string; // YYYY-MM-DD
  estimatedLiabilityPoisha: string;
  status: ComplianceStatus;
  autoLockPeriodOnExpiry: boolean;
  filedAt: string | null;
  filingReference: string | null;
  challanId: string | null;
  assignedUserId: string | null;
  notes: string | null;
  isShifted: boolean;
  shiftDays: number;
  daysRemaining: number;
  shiftCallout: string | null; // e.g. "Statutory: 15 Nov (Fri) → Adjusted: 17 Nov (Sun)"
  periodLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GazettedHolidayDto {
  id: string;
  companyId: string | null;
  holidayDate: string; // YYYY-MM-DD
  nameEn: string;
  nameBn: string;
  holidayType: string;
  isConfirmed: boolean;
}

export interface ComplianceSummaryDto {
  nextDeadline: ComplianceCalendarEventDto | null;
  totalWithheldPendingDepositPoisha: string;
  holidayShiftedCount: number;
  filedOnTimeRate: number; // 0 to 100
  counts: {
    total: number;
    pending: number;
    prepared: number;
    filed: number;
    overdue: number;
  };
}

export interface FilingRecordInput {
  filingReference: string;
  notes?: string | null;
  lockPeriod?: boolean;
  actorUserId?: string | null;
  organisationId?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const WEEKDAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Parse an ISO date string (YYYY-MM-DD) into a UTC Date object.
 */
export function parseIsoDate(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const year = parts[0] ?? 2026;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Format a Date object into YYYY-MM-DD in UTC.
 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Check if a date falls on the Bangladesh statutory weekend:
 * Friday (UTC day 5) and Saturday (UTC day 6).
 */
export function isBangladeshWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 5 || day === 6;
}

/**
 * Advance statutory due date D_0:
 * While UTC_Day(D) in {5, 6} or D in GazettedHolidays:
 *   D <- D + 1 day
 */
export function advanceDeadline(
  statutoryDate: string,
  holidays: Set<string>,
): { adjustedDate: string; shiftDays: number; shiftCallout: string | null } {
  const current = parseIsoDate(statutoryDate);
  let shiftDays = 0;

  while (isBangladeshWeekend(current) || holidays.has(toIsoDate(current))) {
    current.setUTCDate(current.getUTCDate() + 1);
    shiftDays++;
  }

  const adjustedDate = toIsoDate(current);

  let shiftCallout: string | null = null;
  if (shiftDays > 0) {
    const origDate = parseIsoDate(statutoryDate);
    const origDay = origDate.getUTCDate();
    const origMonth = MONTH_NAMES_EN[origDate.getUTCMonth()];
    const origWk = WEEKDAY_NAMES_EN[origDate.getUTCDay()];

    const adjDay = current.getUTCDate();
    const adjMonth = MONTH_NAMES_EN[current.getUTCMonth()];
    const adjWk = WEEKDAY_NAMES_EN[current.getUTCDay()];

    shiftCallout = `Statutory: ${origDay} ${origMonth} (${origWk}) → Adjusted: ${adjDay} ${adjMonth} (${adjWk})`;
  }

  return { adjustedDate, shiftDays, shiftCallout };
}

/**
 * Compute the day difference between today and a target date in UTC.
 */
export function daysFromToday(targetIso: string, todayIso?: string): number {
  const today = todayIso ? parseIsoDate(todayIso) : parseIsoDate(new Date().toISOString().slice(0, 10));
  const target = parseIsoDate(targetIso);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Load all active gazetted holidays for a company (company-specific + national).
 */
export async function getGazettedHolidays(database: Queryable, companyId?: string | null): Promise<Set<string>> {
  const result = await database.query<{ holiday_date: string }>(
    `SELECT holiday_date::text AS holiday_date
       FROM bd_gazetted_holidays
      WHERE (company_id IS NULL OR company_id = $1)
        AND is_confirmed = true
      ORDER BY holiday_date ASC`,
    [companyId ?? null],
  );

  const holidaySet = new Set<string>();
  for (const row of result.rows) {
    holidaySet.add(row.holiday_date.slice(0, 10));
  }
  return holidaySet;
}

/**
 * Compute live estimatedLiabilityPoisha for each obligation directly from the GL:
 * - VAT_91: 2120 (Output VAT) - 1140 (Input Rebate) + 2130 (Withholding VAT)
 * - TDS_MONTHLY: 2140 (Vendor TDS) + 2141 (Salary TDS)
 * - VDS_DEPOSIT: 2130 (Withholding VAT)
 * - AIT_Q: 1/4 of Corporate Tax Provision (2170)
 */
export async function computeLiveLiabilities(
  database: Queryable,
  companyId: string,
): Promise<{
  vat91: bigint;
  tdsMonthly: bigint;
  vdsDeposit: bigint;
  aitQuarterly: bigint;
  totalWithheldPending: bigint;
}> {
  const result = await database.query<{
    code: string;
    total_debit: string;
    total_credit: string;
  }>(
    `SELECT a.code,
            COALESCE(SUM(l.debit_poisha), 0)::text AS total_debit,
            COALESCE(SUM(l.credit_poisha), 0)::text AS total_credit
       FROM accounts a
       LEFT JOIN journal_lines l ON l.company_id = a.company_id AND l.account_id = a.id
       LEFT JOIN journals j ON j.company_id = l.company_id AND j.id = l.journal_id AND j.status IN ('POSTED', 'REVERSED')
      WHERE a.company_id = $1
        AND a.code IN ('1140', '2120', '2130', '2140', '2141', '2170')
      GROUP BY a.code`,
    [companyId],
  );

  const balances = new Map<string, bigint>();
  for (const row of result.rows) {
    const debit = BigInt(row.total_debit);
    const credit = BigInt(row.total_credit);
    if (row.code === '1140') {
      // Asset normal balance = Debit - Credit
      balances.set(row.code, debit - credit);
    } else {
      // Liability normal balance = Credit - Debit
      balances.set(row.code, credit - debit);
    }
  }

  const b1140 = balances.get('1140') ?? 0n;
  const b2120 = balances.get('2120') ?? 0n;
  const b2130 = balances.get('2130') ?? 0n;
  const b2140 = balances.get('2140') ?? 0n;
  const b2141 = balances.get('2141') ?? 0n;
  const b2170 = balances.get('2170') ?? 0n;

  // VAT_91 = 2120 - 1140 + 2130
  const rawVat = b2120 - b1140 + b2130;
  const vat91 = rawVat > 0n ? rawVat : 0n;

  // TDS_MONTHLY = 2140 + 2141
  const rawTds = b2140 + b2141;
  const tdsMonthly = rawTds > 0n ? rawTds : 0n;

  // VDS_DEPOSIT = 2130
  const vdsDeposit = b2130 > 0n ? b2130 : 0n;

  // AIT_Q = 1/4 of Corporate Tax Provision (2170)
  const aitQuarterly = b2170 > 0n ? b2170 / 4n : 0n;

  // Total Withheld Pending Deposit = VDS (2130) + Vendor TDS (2140) + Salary TDS (2141)
  const totalWithheldPending = (b2130 > 0n ? b2130 : 0n) + (b2140 > 0n ? b2140 : 0n) + (b2141 > 0n ? b2141 : 0n);

  return { vat91, tdsMonthly, vdsDeposit, aitQuarterly, totalWithheldPending };
}

/**
 * Generate or refresh compliance calendar events for a company's fiscal year.
 */
export async function generateComplianceEventsForFiscalYear(
  database: Queryable,
  companyId: string,
  fiscalYearId?: string | null,
): Promise<{ generatedCount: number; events: ComplianceCalendarEventDto[] }> {
  // If fiscalYearId is omitted, pick the active or latest fiscal year
  let fyId = fiscalYearId;
  if (!fyId) {
    const fyResult = await database.query<{ id: string }>(
      `SELECT id FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1`,
      [companyId],
    );
    if (fyResult.rows.length === 0) {
      throw new AppError(404, 'FISCAL_YEAR_NOT_FOUND', 'No fiscal year found for company.');
    }
    fyId = fyResult.rows[0]!.id;
  }

  // Load periods
  const periodsResult = await database.query<{
    id: string;
    code: string;
    label: string;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id, code, label, start_date::text AS start_date, end_date::text AS end_date
       FROM periods
      WHERE company_id = $1 AND fiscal_year_id = $2
      ORDER BY start_date ASC`,
    [companyId, fyId],
  );

  const holidays = await getGazettedHolidays(database, companyId);
  const liabilities = await computeLiveLiabilities(database, companyId);

  let generatedCount = 0;

  for (let idx = 0; idx < periodsResult.rows.length; idx++) {
    const period = periodsResult.rows[idx]!;
    const endIso = period.end_date.slice(0, 10);
    const endDate = parseIsoDate(endIso);

    // Statutory Deadline for 15-day rule (Ordinance No. 38 of 2026 Section 64):
    // 15th day of the month immediately following the period end date.
    const nextMonthYear = endDate.getUTCMonth() === 11 ? endDate.getUTCFullYear() + 1 : endDate.getUTCFullYear();
    const nextMonth = (endDate.getUTCMonth() + 1) % 12;
    const statutoryDate15 = toIsoDate(new Date(Date.UTC(nextMonthYear, nextMonth, 15)));

    // 1. VAT_91 (Mushak 9.1 Return)
    const vatAdv = advanceDeadline(statutoryDate15, holidays);
    await database.query(
      `INSERT INTO compliance_calendar_events (
         company_id, fiscal_year_id, period_id, title_en, title_bn, statutory_body,
         category, statutory_deadline, adjusted_deadline, estimated_liability_poisha,
         status, auto_lock_period_on_expiry
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', true)
       ON CONFLICT (company_id, period_id, category)
       DO UPDATE SET
         statutory_deadline = EXCLUDED.statutory_deadline,
         adjusted_deadline = EXCLUDED.adjusted_deadline,
         estimated_liability_poisha = EXCLUDED.estimated_liability_poisha,
         updated_at = now()`,
      [
        companyId,
        fyId,
        period.id,
        `Mushak 9.1 VAT Return (${period.label})`,
        `মূসক ৯.১ ভ্যাট দাখিলপত্র (${period.label})`,
        'NBR_VAT',
        'VAT_91',
        statutoryDate15,
        vatAdv.adjustedDate,
        liabilities.vat91.toString(),
      ],
    );
    generatedCount++;

    // 2. VDS_DEPOSIT (A-Challan Deposit)
    const vdsAdv = advanceDeadline(statutoryDate15, holidays);
    await database.query(
      `INSERT INTO compliance_calendar_events (
         company_id, fiscal_year_id, period_id, title_en, title_bn, statutory_body,
         category, statutory_deadline, adjusted_deadline, estimated_liability_poisha,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
       ON CONFLICT (company_id, period_id, category)
       DO UPDATE SET
         statutory_deadline = EXCLUDED.statutory_deadline,
         adjusted_deadline = EXCLUDED.adjusted_deadline,
         estimated_liability_poisha = EXCLUDED.estimated_liability_poisha,
         updated_at = now()`,
      [
        companyId,
        fyId,
        period.id,
        `VDS Treasury Deposit (${period.label})`,
        `উৎস কর্তনকৃত ভ্যাট ট্রেজারি জমা (${period.label})`,
        'NBR_VAT',
        'VDS_DEPOSIT',
        statutoryDate15,
        vdsAdv.adjustedDate,
        liabilities.vdsDeposit.toString(),
      ],
    );
    generatedCount++;

    // 3. TDS_MONTHLY (ITA 2023 Withholding Tax Deposit)
    const tdsAdv = advanceDeadline(statutoryDate15, holidays);
    await database.query(
      `INSERT INTO compliance_calendar_events (
         company_id, fiscal_year_id, period_id, title_en, title_bn, statutory_body,
         category, statutory_deadline, adjusted_deadline, estimated_liability_poisha,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
       ON CONFLICT (company_id, period_id, category)
       DO UPDATE SET
         statutory_deadline = EXCLUDED.statutory_deadline,
         adjusted_deadline = EXCLUDED.adjusted_deadline,
         estimated_liability_poisha = EXCLUDED.estimated_liability_poisha,
         updated_at = now()`,
      [
        companyId,
        fyId,
        period.id,
        `Monthly TDS Withholding Statement & Deposit (${period.label})`,
        `মাসিক উৎসে কর বিবরণী ও জমা (${period.label})`,
        'NBR_TAX',
        'TDS_MONTHLY',
        statutoryDate15,
        tdsAdv.adjustedDate,
        liabilities.tdsMonthly.toString(),
      ],
    );
    generatedCount++;

    // 4. Quarterly AIT (Section 154) - Every 3rd period
    if ((idx + 1) % 3 === 0) {
      const qNum = (idx + 1) / 3;
      const aitAdv = advanceDeadline(statutoryDate15, holidays);
      await database.query(
        `INSERT INTO compliance_calendar_events (
           company_id, fiscal_year_id, period_id, title_en, title_bn, statutory_body,
           category, statutory_deadline, adjusted_deadline, estimated_liability_poisha,
           status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
         ON CONFLICT (company_id, period_id, category)
         DO UPDATE SET
           statutory_deadline = EXCLUDED.statutory_deadline,
           adjusted_deadline = EXCLUDED.adjusted_deadline,
           estimated_liability_poisha = EXCLUDED.estimated_liability_poisha,
           updated_at = now()`,
        [
          companyId,
          fyId,
          period.id,
          `Advance Income Tax (AIT Section 154) - Q${qNum}`,
          `অগ্রিম আয়কর (এআইটি ধারা ১৫৪) - কিস্তি ${qNum}`,
          'NBR_TAX',
          'AIT_Q',
          statutoryDate15,
          aitAdv.adjustedDate,
          liabilities.aitQuarterly.toString(),
        ],
      );
      generatedCount++;

      // Section 177 Statement (Half-yearly / quarterly)
      const sec177Adv = advanceDeadline(statutoryDate15, holidays);
      await database.query(
        `INSERT INTO compliance_calendar_events (
           company_id, fiscal_year_id, period_id, title_en, title_bn, statutory_body,
           category, statutory_deadline, adjusted_deadline, estimated_liability_poisha,
           status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
         ON CONFLICT (company_id, period_id, category)
         DO UPDATE SET
           statutory_deadline = EXCLUDED.statutory_deadline,
           adjusted_deadline = EXCLUDED.adjusted_deadline,
           updated_at = now()`,
        [
          companyId,
          fyId,
          period.id,
          `Section 177 Withholding Tax Return (${period.label})`,
          `ধারা ১৭৭ উৎসে কর রিটার্ন (${period.label})`,
          'NBR_TAX',
          'TDS_177',
          statutoryDate15,
          sec177Adv.adjustedDate,
          liabilities.tdsMonthly.toString(),
        ],
      );
      generatedCount++;
    }
  }

  const events = await listComplianceEvents(database, companyId, { fiscalYearId: fyId });
  return { generatedCount, events };
}

/**
 * List compliance events for a company with optional filters.
 */
export async function listComplianceEvents(
  database: Queryable,
  companyId: string,
  filters?: {
    fiscalYearId?: string | null;
    periodId?: string | null;
    category?: ComplianceCategory | null;
    status?: ComplianceStatus | null;
    statutoryBody?: StatutoryBody | null;
    from?: string | null;
    to?: string | null;
  },
): Promise<ComplianceCalendarEventDto[]> {
  const conditions: string[] = ['e.company_id = $1'];
  const values: unknown[] = [companyId];

  if (filters?.fiscalYearId) {
    values.push(filters.fiscalYearId);
    conditions.push(`e.fiscal_year_id = $${values.length}`);
  }
  if (filters?.periodId) {
    values.push(filters.periodId);
    conditions.push(`e.period_id = $${values.length}`);
  }
  if (filters?.category) {
    values.push(filters.category);
    conditions.push(`e.category = $${values.length}`);
  }
  if (filters?.status) {
    values.push(filters.status);
    conditions.push(`e.status = $${values.length}`);
  }
  if (filters?.statutoryBody) {
    values.push(filters.statutoryBody);
    conditions.push(`e.statutory_body = $${values.length}`);
  }
  if (filters?.from) {
    values.push(filters.from);
    conditions.push(`e.adjusted_deadline >= $${values.length}::date`);
  }
  if (filters?.to) {
    values.push(filters.to);
    conditions.push(`e.adjusted_deadline <= $${values.length}::date`);
  }

  const result = await database.query<{
    id: string;
    company_id: string;
    branch_id: string | null;
    period_id: string | null;
    fiscal_year_id: string;
    title_en: string;
    title_bn: string;
    statutory_body: string;
    category: string;
    statutory_deadline: string;
    adjusted_deadline: string;
    estimated_liability_poisha: string;
    status: string;
    auto_lock_period_on_expiry: boolean;
    filed_at: Date | string | null;
    filing_reference: string | null;
    challan_id: string | null;
    assigned_user_id: string | null;
    notes: string | null;
    period_label: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT e.id, e.company_id, e.branch_id, e.period_id, e.fiscal_year_id,
            e.title_en, e.title_bn, e.statutory_body, e.category,
            e.statutory_deadline::text AS statutory_deadline,
            e.adjusted_deadline::text AS adjusted_deadline,
            e.estimated_liability_poisha,
            e.status, e.auto_lock_period_on_expiry, e.filed_at, e.filing_reference,
            e.challan_id, e.assigned_user_id, e.notes, e.created_at, e.updated_at,
            p.label AS period_label
       FROM compliance_calendar_events e
       LEFT JOIN periods p ON p.company_id = e.company_id AND p.id = e.period_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.adjusted_deadline ASC, e.title_en ASC`,
    values,
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const liabilities = await computeLiveLiabilities(database, companyId);

  return result.rows.map((row) => {
    const statutoryIso = row.statutory_deadline.slice(0, 10);
    const adjustedIso = row.adjusted_deadline.slice(0, 10);

    const isShifted = statutoryIso !== adjustedIso;
    const origDate = parseIsoDate(statutoryIso);
    const adjDate = parseIsoDate(adjustedIso);
    const shiftDays = Math.round((adjDate.getTime() - origDate.getTime()) / (1000 * 60 * 60 * 24));

    let shiftCallout: string | null = null;
    if (isShifted) {
      const origDay = origDate.getUTCDate();
      const origMonth = MONTH_NAMES_EN[origDate.getUTCMonth()];
      const origWk = WEEKDAY_NAMES_EN[origDate.getUTCDay()];

      const adjDay = adjDate.getUTCDate();
      const adjMonth = MONTH_NAMES_EN[adjDate.getUTCMonth()];
      const adjWk = WEEKDAY_NAMES_EN[adjDate.getUTCDay()];

      shiftCallout = `Statutory: ${origDay} ${origMonth} (${origWk}) → Adjusted: ${adjDay} ${adjMonth} (${adjWk})`;
    }

    const daysRemaining = daysFromToday(adjustedIso, todayIso);

    // Dynamic overdue status: if still PENDING and adjusted deadline has passed
    let effectiveStatus = row.status as ComplianceStatus;
    if (effectiveStatus === 'PENDING' && daysRemaining < 0) {
      effectiveStatus = 'OVERDUE';
    }

    // Dynamic live liability directly from GL
    let liveLiability = BigInt(row.estimated_liability_poisha);
    if (row.category === 'VAT_91') {
      liveLiability = liabilities.vat91;
    } else if (row.category === 'TDS_MONTHLY' || row.category === 'TDS_177') {
      liveLiability = liabilities.tdsMonthly;
    } else if (row.category === 'VDS_DEPOSIT') {
      liveLiability = liabilities.vdsDeposit;
    } else if (row.category === 'AIT_Q') {
      liveLiability = liabilities.aitQuarterly;
    }

    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      periodId: row.period_id,
      fiscalYearId: row.fiscal_year_id,
      titleEn: row.title_en,
      titleBn: row.title_bn,
      statutoryBody: row.statutory_body as StatutoryBody,
      category: row.category as ComplianceCategory,
      statutoryDeadline: statutoryIso,
      adjustedDeadline: adjustedIso,
      estimatedLiabilityPoisha: liveLiability.toString(),
      status: effectiveStatus,
      autoLockPeriodOnExpiry: row.auto_lock_period_on_expiry,
      filedAt: row.filed_at ? new Date(row.filed_at).toISOString() : null,
      filingReference: row.filing_reference,
      challanId: row.challan_id,
      assignedUserId: row.assigned_user_id,
      notes: row.notes,
      isShifted,
      shiftDays,
      daysRemaining,
      shiftCallout,
      periodLabel: row.period_label,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

/**
 * Get 4-card executive KPI summary for the compliance workspace.
 */
export async function getComplianceSummary(database: Queryable, companyId: string): Promise<ComplianceSummaryDto> {
  const events = await listComplianceEvents(database, companyId);
  const liabilities = await computeLiveLiabilities(database, companyId);

  let holidayShiftedCount = 0;
  let filedCount = 0;
  let filedOnTimeCount = 0;
  let pendingCount = 0;
  let preparedCount = 0;
  let overdueCount = 0;

  for (const event of events) {
    if (event.isShifted) holidayShiftedCount++;
    if (event.status === 'FILED') {
      filedCount++;
      if (event.filedAt) {
        const filedIso = event.filedAt.slice(0, 10);
        if (filedIso <= event.adjustedDeadline) {
          filedOnTimeCount++;
        }
      } else {
        filedOnTimeCount++;
      }
    } else if (event.status === 'PREPARED') {
      preparedCount++;
    } else if (event.status === 'OVERDUE') {
      overdueCount++;
    } else {
      pendingCount++;
    }
  }

  // Next statutory deadline is the closest upcoming event with PENDING or PREPARED status
  const upcoming = events
    .filter((e) => (e.status === 'PENDING' || e.status === 'PREPARED') && e.daysRemaining >= 0)
    .sort((a, b) => a.adjustedDeadline.localeCompare(b.adjustedDeadline));

  const nextDeadline = upcoming[0] ?? (events.find((e) => e.daysRemaining >= 0) || null);

  const filedOnTimeRate = filedCount > 0 ? Math.round((filedOnTimeCount / filedCount) * 1000) / 10 : 100.0;

  return {
    nextDeadline,
    totalWithheldPendingDepositPoisha: liabilities.totalWithheldPending.toString(),
    holidayShiftedCount,
    filedOnTimeRate,
    counts: {
      total: events.length,
      pending: pendingCount,
      prepared: preparedCount,
      filed: filedCount,
      overdue: overdueCount,
    },
  };
}

/**
 * Record NBR filing acknowledgement, reference number, and optionally lock the accounting period.
 */
export async function recordFilingAndAck(
  database: Queryable,
  companyId: string,
  eventId: string,
  input: FilingRecordInput,
): Promise<ComplianceCalendarEventDto> {
  const eventResult = await database.query<{
    id: string;
    company_id: string;
    period_id: string | null;
    category: string;
    status: string;
  }>(
    `SELECT id, company_id, period_id, category, status
       FROM compliance_calendar_events
      WHERE company_id = $1 AND id = $2`,
    [companyId, eventId],
  );

  const event = eventResult.rows[0];
  if (!event) {
    throw new AppError(404, 'COMPLIANCE_EVENT_NOT_FOUND', 'Compliance calendar event not found.');
  }

  const now = new Date();

  // Update compliance event to FILED
  await database.query(
    `UPDATE compliance_calendar_events
        SET status = 'FILED',
            filed_at = $3,
            filing_reference = $4,
            notes = COALESCE($5, notes),
            updated_at = now()
      WHERE company_id = $1 AND id = $2`,
    [companyId, eventId, now, input.filingReference, input.notes ?? null],
  );

  // Lock period if requested and linked
  if (input.lockPeriod && event.period_id) {
    await database.query(
      `UPDATE periods
          SET status = 'LOCKED',
              locked_at = COALESCE(locked_at, now()),
              locked_by = COALESCE(locked_by, $3),
              closed_at = COALESCE(closed_at, now()),
              closed_by = COALESCE(closed_by, $3),
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [companyId, event.period_id, input.actorUserId ?? null],
    );
  }

  // Record audit log
  await writeAuditEvent(database, {
    organisationId: input.organisationId ?? null,
    companyId,
    actorUserId: input.actorUserId ?? null,
    sessionId: input.sessionId ?? null,
    action: 'compliance.filed',
    entityType: 'compliance_calendar_event',
    entityId: eventId,
    before: { status: event.status },
    after: {
      status: 'FILED',
      filingReference: input.filingReference,
      lockPeriod: Boolean(input.lockPeriod && event.period_id),
    },
    reason: input.notes ?? 'Statutory return filed with NBR acknowledgement reference.',
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId ?? null,
  });

  const updatedEvents = await listComplianceEvents(database, companyId);
  const updated = updatedEvents.find((e) => e.id === eventId);
  if (!updated) {
    throw new AppError(500, 'EVENT_LOAD_FAILED', 'Failed to retrieve updated event.');
  }
  return updated;
}

/**
 * List all gazetted holidays.
 */
export async function listGazettedHolidays(
  database: Queryable,
  companyId?: string | null,
): Promise<GazettedHolidayDto[]> {
  const result = await database.query<{
    id: string;
    company_id: string | null;
    holiday_date: string;
    name_en: string;
    name_bn: string;
    holiday_type: string;
    is_confirmed: boolean;
  }>(
    `SELECT id, company_id, holiday_date::text AS holiday_date, name_en, name_bn, holiday_type, is_confirmed
       FROM bd_gazetted_holidays
      WHERE company_id IS NULL OR company_id = $1
      ORDER BY holiday_date ASC`,
    [companyId ?? null],
  );

  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    holidayDate: row.holiday_date.slice(0, 10),
    nameEn: row.name_en,
    nameBn: row.name_bn,
    holidayType: row.holiday_type,
    isConfirmed: row.is_confirmed,
  }));
}
