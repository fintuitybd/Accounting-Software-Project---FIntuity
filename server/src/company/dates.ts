/** Date helpers for fiscal-year generation. All dates are ISO calendar dates (YYYY-MM-DD). */

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseIsoDate(value: string): Date {
  if (!isValidIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * PostgreSQL `date` values arrive as a Date at local midnight. Extract the calendar date using local
 * getters so a positive time-zone offset cannot shift the date back one day.
 */
export function formatDatabaseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function isFirstOfMonth(value: string): boolean {
  return isValidIsoDate(value) && value.endsWith('-01');
}

export function isLastOfMonth(value: string): boolean {
  if (!isValidIsoDate(value)) return false;
  const date = parseIsoDate(value);
  return date.getUTCDate() === endOfUtcMonth(date).getUTCDate();
}

export function periodCodeForDate(value: string): string {
  if (!isValidIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return value.slice(0, 7);
}

export function fiscalYearLabel(startDate: string, endDate: string): string {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  return startYear === endYear ? `FY ${startYear}` : `FY ${startYear}-${String(endYear).slice(-2)}`;
}

export interface GeneratedMonth {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
}

/** Generate consecutive calendar months from the first of `startDate` to the last of `endDate`. */
export function generateMonthlyPeriods(startDate: string, endDate: string): GeneratedMonth[] {
  if (!isFirstOfMonth(startDate)) throw new Error('The fiscal year must start on the first day of a month.');
  if (!isLastOfMonth(endDate)) throw new Error('The fiscal year must end on the last day of a month.');
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) throw new Error('The fiscal year end must not precede its start.');

  const periods: GeneratedMonth[] = [];
  let cursor = start;
  while (cursor <= end) {
    const monthEnd = endOfUtcMonth(cursor);
    if (monthEnd > end) throw new Error('The fiscal year range must contain whole calendar months.');
    periods.push({
      code: formatIsoDate(cursor).slice(0, 7),
      label: new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(cursor),
      startDate: formatIsoDate(cursor),
      endDate: formatIsoDate(monthEnd),
    });
    cursor = addUtcMonths(cursor, 1);
  }
  if (periods.length === 0) throw new Error('At least one monthly period is required.');
  if (periods.length > 24) throw new Error('A fiscal year may not exceed 24 monthly periods.');
  return periods;
}
