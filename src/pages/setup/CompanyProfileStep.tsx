import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Save } from 'lucide-react';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';
import {
  ENTITY_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  REPORTING_FRAMEWORK_OPTIONS,
  setupApi,
  type CompanyProfile,
} from '../../setup/api';

export default function CompanyProfileStep({
  profile,
  canManage,
  onSaved,
}: {
  profile: CompanyProfile;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    legalName: profile.legalName,
    tradeName: profile.tradeName ?? '',
    entityType: profile.entityType ?? 'PRIVATE_LIMITED',
    industry: profile.industry ?? 'TRADING_DISTRIBUTION',
    reportingFramework: profile.reportingFramework ?? 'IFRS_FOR_SMES_BFRS',
    tin: profile.tin ?? '',
    bin: profile.bin ?? '',
    rjscNo: profile.rjscNo ?? '',
    address: profile.address ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      legalName: profile.legalName,
      tradeName: profile.tradeName ?? '',
      entityType: profile.entityType ?? 'PRIVATE_LIMITED',
      industry: profile.industry ?? 'TRADING_DISTRIBUTION',
      reportingFramework: profile.reportingFramework ?? 'IFRS_FOR_SMES_BFRS',
      tin: profile.tin ?? '',
      bin: profile.bin ?? '',
      rjscNo: profile.rjscNo ?? '',
      address: profile.address ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
    });
  }, [profile]);

  const set = (key: keyof typeof form, value: string): void => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      await setupApi.updateProfile(profile.id, {
        legalName: form.legalName,
        tradeName: form.tradeName || null,
        entityType: form.entityType,
        industry: form.industry,
        reportingFramework: form.reportingFramework,
        tin: form.tin || null,
        bin: form.bin || null,
        rjscNo: form.rjscNo || null,
        address: form.address,
        phone: form.phone || null,
        email: form.email || null,
      });
      setNotice('Company identity saved. The change is recorded in the audit trail.');
      await onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Company identity</h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Legal identity, registration references and the reporting framework. TIN/BIN checks are format
            checks only; this application does not claim statutory verification.
          </p>
        </div>
        {!canManage ? <Notice message="Your role can view but not change company settings." tone="warning" /> : null}
      </div>

      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Legal name" required>
          <input className={INPUT_CLASS} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} required disabled={!canManage || saving} maxLength={200} />
        </Field>
        <Field label="Trade name">
          <input className={INPUT_CLASS} value={form.tradeName} onChange={(event) => set('tradeName', event.target.value)} disabled={!canManage || saving} maxLength={200} />
        </Field>
        <Field label="Entity type" required>
          <select className={INPUT_CLASS} value={form.entityType} onChange={(event) => set('entityType', event.target.value)} disabled={!canManage || saving}>
            {ENTITY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Industry" required>
          <select className={INPUT_CLASS} value={form.industry} onChange={(event) => set('industry', event.target.value)} disabled={!canManage || saving}>
            {INDUSTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Reporting framework" required>
          <select className={INPUT_CLASS} value={form.reportingFramework} onChange={(event) => set('reportingFramework', event.target.value)} disabled={!canManage || saving}>
            {REPORTING_FRAMEWORK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="RJSC registration number" hint="Optional. Leave blank if the company is not registered yet.">
          <input className={INPUT_CLASS} value={form.rjscNo} onChange={(event) => set('rjscNo', event.target.value)} disabled={!canManage || saving} maxLength={64} />
        </Field>
        <Field label="TIN" hint="Format check only (9–12 digits), not statutory validation. Leave blank if not registered.">
          <input className={INPUT_CLASS} value={form.tin} onChange={(event) => set('tin', event.target.value)} disabled={!canManage || saving} maxLength={32} inputMode="numeric" />
        </Field>
        <Field label="BIN" hint="Format check only (9 digits plus optional 4-digit unit). Leave blank if not registered.">
          <input className={INPUT_CLASS} value={form.bin} onChange={(event) => set('bin', event.target.value)} disabled={!canManage || saving} maxLength={32} />
        </Field>
        <Field label="Registered address" required>
          <textarea className={`${INPUT_CLASS} min-h-24 py-2`} value={form.address} onChange={(event) => set('address', event.target.value)} required disabled={!canManage || saving} maxLength={500} />
        </Field>
        <div className="grid gap-4">
          <Field label="Contact phone" hint="At least one of phone or email is required.">
            <input className={INPUT_CLASS} value={form.phone} onChange={(event) => set('phone', event.target.value)} disabled={!canManage || saving} maxLength={32} />
          </Field>
          <Field label="Contact email">
            <input className={INPUT_CLASS} type="email" value={form.email} onChange={(event) => set('email', event.target.value)} disabled={!canManage || saving} maxLength={320} />
          </Field>
        </div>
      </div>

      <dl className="grid gap-3 rounded-2xl border border-line bg-surface-2/40 p-4 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-ink-400">Base currency</dt>
          <dd className="mt-1 font-semibold text-ink-900">{profile.baseCurrency}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Time zone</dt>
          <dd className="mt-1 font-semibold text-ink-900">{profile.timezone}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Status</dt>
          <dd className="mt-1 font-semibold text-ink-900">{profile.status}</dd>
        </div>
      </dl>

      {canManage ? (
        <button type="submit" disabled={saving} className="lv-btn lv-btn-primary min-h-11 text-[14px]">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save company identity
        </button>
      ) : null}
    </form>
  );
}
