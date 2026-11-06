// Pure, deterministic sequence allocation for journal, document and statutory serials.
//
// The domain never derives a number from an array length. Callers pass the numbers already in use
// for one series/scope/period; the allocator returns the next unused value and an audit of gaps and
// duplicates. A server implementation can later replace this pure allocator with a transactional
// sequence table without changing the callers or the domain tests.

export interface SequenceRequest {
  /** Stable logical series, e.g. SALES_INVOICE, CREDIT_NOTE, JOURNAL, MUSHAK_63. */
  series: string;
  /** Tenant/company/branch scope. The caller filters the used numbers to this scope. */
  scope: string;
  /** Period bucket, e.g. 2026-10 for a monthly document series or 2026 for a statutory year. */
  period: string;
  /** Prefix used in the human-readable number, e.g. INV, CN, JE, M63. */
  prefix: string;
  /** Already-issued formatted numbers (any value that does not match the prefix/period is ignored). */
  used_numbers: readonly string[];
  /** Zero-padding of the numeric suffix. */
  width?: number;
}

export interface SequenceAllocation {
  series: string;
  scope: string;
  period: string;
  prefix: string;
  value: number;
  /** Full formatted number, e.g. INV-2026-10-0003. */
  number: string;
}

export interface SequenceAudit {
  series: string;
  scope: string;
  period: string;
  prefix: string;
  used_values: number[];
  missing_values: number[];
  duplicate_values: number[];
  last_value: number;
  next_value: number;
  gap_free: boolean;
}

export interface SequenceAllocator {
  allocate(request: SequenceRequest): SequenceAllocation;
  inspect(request: SequenceRequest): SequenceAudit;
}

const DEFAULT_WIDTH = 4;

function stemOf(request: Pick<SequenceRequest, 'prefix' | 'period'>): string {
  return `${request.prefix}-${request.period}-`;
}

function parsedValues(request: SequenceRequest): number[] {
  const stem = stemOf(request);
  const values: number[] = [];
  for (const number of request.used_numbers) {
    if (!number.startsWith(stem)) continue;
    const suffix = number.slice(stem.length);
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number(suffix);
    if (!Number.isSafeInteger(value) || value < 1) continue;
    values.push(value);
  }
  return values;
}

function format(request: SequenceRequest, value: number): string {
  const width = request.width ?? DEFAULT_WIDTH;
  return `${stemOf(request)}${String(value).padStart(width, '0')}`;
}

/** Highest issued value + 1; never uses the number of rows. */
export function allocateSequence(request: SequenceRequest): SequenceAllocation {
  const values = parsedValues(request);
  const last = values.length === 0 ? 0 : Math.max(...values);
  const next = last + 1;
  return {
    series: request.series,
    scope: request.scope,
    period: request.period,
    prefix: request.prefix,
    value: next,
    number: format(request, next),
  };
}

/** Surface gaps and duplicates for an administrator/gap report; never silently repair them. */
export function inspectSequence(request: SequenceRequest): SequenceAudit {
  const values = parsedValues(request);
  const sorted = [...values].sort((left, right) => left - right);
  const last = sorted.length === 0 ? 0 : sorted[sorted.length - 1];
  const seen = new Set<number>();
  const duplicateValues: number[] = [];
  for (const value of sorted) {
    if (seen.has(value)) duplicateValues.push(value);
    seen.add(value);
  }
  const missingValues: number[] = [];
  for (let value = 1; value <= last; value += 1) {
    if (!seen.has(value)) missingValues.push(value);
  }
  return {
    series: request.series,
    scope: request.scope,
    period: request.period,
    prefix: request.prefix,
    used_values: sorted,
    missing_values: missingValues,
    duplicate_values: Array.from(new Set(duplicateValues)),
    last_value: last,
    next_value: last + 1,
    gap_free: missingValues.length === 0 && duplicateValues.length === 0,
  };
}

export const PURE_SEQUENCE_ALLOCATOR: SequenceAllocator = {
  allocate: allocateSequence,
  inspect: inspectSequence,
};
