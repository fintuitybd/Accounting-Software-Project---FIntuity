import { useState, type FormEvent } from 'react';
import { CalendarDays, CheckCircle2, Loader2, Plus, Search } from 'lucide-react';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';
import { setupApi, type FiscalYear } from '../../setup/api';

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 0));
  return { startDate: iso(start), endDate: iso(end) };
}

export default function FiscalYearStep({
  companyId,
  fiscalYears,
  canManage,
  onChanged,
}: {
  companyId: string;
  fiscalYears: FiscalYear[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [range, setRange] = useState(defaultRange);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkDate, setCheckDate] = useState('');
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const nonJuly = range.startDate.slice(5, 7) !== '07';

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      const result = await setupApi.createFiscalYear(companyId, {
        startDate: range.startDate,
        endDate: range.endDate,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setNotice(
        `${result.fiscalYear.label} created with ${result.fiscalYear.periods.length} monthly OPEN periods.`,
      );
      setLabel('');
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (): Promise<void> => {
    if (!checkDate) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await setupApi.resolvePeriod(companyId, checkDate);
      setCheckResult(
        `Date ${checkDate} belongs to ${result.period.code} (${result.period.startDate} to ${result.period.endDate}), status ${result.period.status}.`,
      );
    } catch (caught) {
      setCheckResult(apiErrorMessage(caught));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Fiscal year and periods</h2>
        <p className="mt-1 text-[13px] text-ink-500">
          Periods are generated as explicit monthly records with OPEN status. Overlapping periods and dates
          outside a configured period are rejected by the server. No year or date is hard-coded.
        </p>
      </div>

      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {canManage ? (
        <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-surface-2/40 p-4 md:grid-cols-4 md:items-end">
          <Field label="Fiscal year start" required>
            <input className={INPUT_CLASS} type="date" value={range.startDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} required disabled={saving} />
          </Field>
          <Field label="Fiscal year end" required>
            <input className={INPUT_CLASS} type="date" value={range.endDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} required disabled={saving} />
          </Field>
          <Field label="Label" hint="Optional; generated from the dates when left blank.">
            <input className={INPUT_CLASS} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="Example: FY 2032-33" disabled={saving} />
          </Field>
          <button type="submit" disabled={saving} className="lv-btn lv-btn-primary min-h-11 text-[14px]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Generate fiscal year
          </button>
          {nonJuly ? (
            <div className="md:col-span-4">
              <Notice
                tone="warning"
                message="This fiscal year does not start in July. A non-July start is supported, but confirm that it matches the company's approved accounting year before posting."
              />
            </div>
          ) : null}
        </form>
      ) : (
        <Notice message="Your role can view the fiscal year but cannot create one." tone="warning" />
      )}

      {fiscalYears.length === 0 ? (
        <Notice message="No fiscal year exists yet. Generate one to create monthly OPEN periods." />
      ) : (
        <div className="space-y-3">
          {fiscalYears.map((year) => (
            <section key={year.id} className="overflow-hidden rounded-2xl border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-brand-bright" />
                  <span className="text-[14px] font-semibold text-ink-900">{year.label}</span>
                  <span className="lv-chip lv-chip-neutral text-[12px]">{year.status}</span>
                </div>
                <span className="text-[12px] text-ink-500">
                  {year.startDate} to {year.endDate} · {year.periods.length} periods
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[12px]">
                  <thead className="bg-surface-2/30 text-ink-400">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">Code</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Period</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Start</th>
                      <th scope="col" className="px-4 py-2 font-semibold">End</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {year.periods.map((period) => (
                      <tr key={period.id}>
                        <td className="px-4 py-2 font-mono text-ink-700">{period.code}</td>
                        <td className="px-4 py-2 text-ink-700">{period.label}</td>
                        <td className="px-4 py-2 text-ink-500">{period.startDate}</td>
                        <td className="px-4 py-2 text-ink-500">{period.endDate}</td>
                        <td className="px-4 py-2">
                          <span className={`lv-chip text-[12px] ${period.status === 'OPEN' ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>
                            {period.status === 'OPEN' ? <CheckCircle2 size={11} /> : null}
                            {period.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-surface-2/30 p-4">
        <h3 className="text-[14px] font-semibold text-ink-900">Posting-date check</h3>
        <p className="mt-1 text-[12px] text-ink-500">
          The server resolves a date against configured periods. A date outside every period is rejected; it
          never opens an implicit period.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-ink-700">Posting date</span>
            <input className={INPUT_CLASS} type="date" value={checkDate} onChange={(event) => setCheckDate(event.target.value)} />
          </label>
          <button type="button" onClick={() => void resolve()} disabled={checking || !checkDate} className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
            {checking ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Check date
          </button>
        </div>
        {checkResult ? <p role="status" className="mt-2 text-[12px] leading-relaxed text-ink-600">{checkResult}</p> : null}
      </section>
    </div>
  );
}
