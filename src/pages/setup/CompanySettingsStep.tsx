import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  DOCUMENT_TYPE_LABELS,
  REPORTING_FRAMEWORK_OPTIONS,
  setupApi,
  type CompanySettings,
  type FiscalYear,
} from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice, poishaToBdtString } from './setupUi';

const VAT_STATUS_OPTIONS = [
  { value: '', label: 'Not decided' },
  { value: 'VAT_REGISTERED_15', label: 'VAT registered' },
  { value: 'TURNOVER_TAX_ENLISTED', label: 'Turnover-tax enlisted' },
  { value: 'EXEMPT', label: 'Exempt' },
  { value: 'STARTUP_RELIEF', label: 'Startup relief' },
  { value: 'NOT_REGISTERED', label: 'Not registered yet' },
];

const FILING_FREQUENCY_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable / not decided' },
];

export default function CompanySettingsStep({
  companyId,
  settings,
  fiscalYears,
  canManage,
  onChanged,
}: {
  companyId: string;
  settings: CompanySettings;
  fiscalYears: FiscalYear[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const latestFiscalYear = fiscalYears[0] ?? null;
  const sequencesForYear = useMemo(
    () => settings.numberSequences.filter((sequence) => sequence.fiscalYearId === latestFiscalYear?.id),
    [settings.numberSequences, latestFiscalYear?.id],
  );

  const [form, setForm] = useState({
    language: settings.language,
    reportingFramework: settings.reportingFramework ?? 'IFRS_FOR_SMES_BFRS',
    highValue: poishaToBdtString(settings.approvalThresholds.highValuePoisha),
    payment: poishaToBdtString(settings.approvalThresholds.paymentPoisha),
    vatStatus: settings.tax.vatStatus ?? '',
    filingFrequency: settings.tax.filingFrequency,
    withholdingEntity: settings.tax.withholdingEntity,
    notes: settings.tax.notes,
  });
  const [sequences, setSequences] = useState(
    sequencesForYear.map((sequence) => ({
      docType: sequence.docType,
      prefix: sequence.prefix,
      nextValue: sequence.nextValue,
      pad: sequence.pad,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      language: settings.language,
      reportingFramework: settings.reportingFramework ?? 'IFRS_FOR_SMES_BFRS',
      highValue: poishaToBdtString(settings.approvalThresholds.highValuePoisha),
      payment: poishaToBdtString(settings.approvalThresholds.paymentPoisha),
      vatStatus: settings.tax.vatStatus ?? '',
      filingFrequency: settings.tax.filingFrequency,
      withholdingEntity: settings.tax.withholdingEntity,
      notes: settings.tax.notes,
    });
    setSequences(
      settings.numberSequences
        .filter((sequence) => sequence.fiscalYearId === latestFiscalYear?.id)
        .map((sequence) => ({
          docType: sequence.docType,
          prefix: sequence.prefix,
          nextValue: sequence.nextValue,
          pad: sequence.pad,
        })),
    );
  }, [settings, latestFiscalYear?.id]);

  const set = (key: keyof typeof form, value: string | boolean): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const setSequence = (docType: string, field: 'prefix' | 'nextValue' | 'pad', value: string): void => {
    setSequences((current) =>
      current.map((sequence) =>
        sequence.docType === docType
          ? {
              ...sequence,
              [field]: field === 'pad' ? Number(value) : value,
            }
          : sequence,
      ),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      await setupApi.updateSettings(companyId, {
        language: form.language as 'en-BD' | 'bn-BD',
        reportingFramework: form.reportingFramework,
        approvalThresholds: { highValue: form.highValue, payment: form.payment },
        tax: {
          vatStatus: form.vatStatus ? form.vatStatus : null,
          filingFrequency: form.filingFrequency,
          withholdingEntity: form.withholdingEntity,
          notes: form.notes,
        },
        ...(latestFiscalYear && sequences.length > 0
          ? { fiscalYearId: latestFiscalYear.id, numberSequences: sequences }
          : {}),
      });
      setNotice('Company settings saved. The change is recorded in the audit trail.');
      await onChanged();
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
          <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Company settings</h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Language, approval thresholds, tax configuration and document numbering. Tax settings are
            accounting configuration only; rates and statutory filing rules require adviser review.
          </p>
        </div>
        {!canManage ? <Notice message="Your role can view but not change company settings." tone="warning" /> : null}
      </div>

      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      <div className="grid gap-4 rounded-2xl border border-line bg-surface-2/40 p-4 md:grid-cols-3">
        <Field label="Default language">
          <select className={INPUT_CLASS} value={form.language} onChange={(event) => set('language', event.target.value)} disabled={!canManage || saving}>
            <option value="en-BD">English</option>
            <option value="bn-BD">বাংলা</option>
          </select>
        </Field>
        <Field label="Reporting framework">
          <select className={INPUT_CLASS} value={form.reportingFramework} onChange={(event) => set('reportingFramework', event.target.value)} disabled={!canManage || saving}>
            {REPORTING_FRAMEWORK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Time zone">
          <input className={INPUT_CLASS} value="Asia/Dhaka" readOnly disabled />
        </Field>
        <Field label="Base currency">
          <input className={INPUT_CLASS} value="BDT" readOnly disabled />
        </Field>
        <Field label="Document, journal and reversal approval threshold (BDT)" hint="At or above this amount, a different controller must approve before posting or reversal.">
          <input className={INPUT_CLASS} value={form.highValue} onChange={(event) => set('highValue', event.target.value)} inputMode="decimal" disabled={!canManage || saving} />
        </Field>
        <Field label="Payment approval threshold (BDT)" hint="At or above this amount, supplier payments require a different checker.">
          <input className={INPUT_CLASS} value={form.payment} onChange={(event) => set('payment', event.target.value)} inputMode="decimal" disabled={!canManage || saving} />
        </Field>
      </div>

      <div className="grid gap-4 rounded-2xl border border-line bg-surface-2/40 p-4 md:grid-cols-3">
        <Field label="VAT registration status" hint="Choose “Not registered yet” where legally acceptable; this is not a statutory validation.">
          <select className={INPUT_CLASS} value={form.vatStatus} onChange={(event) => set('vatStatus', event.target.value)} disabled={!canManage || saving}>
            {VAT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Filing frequency" hint="Configuration only. Confirm the legal frequency with a tax adviser.">
          <select className={INPUT_CLASS} value={form.filingFrequency} onChange={(event) => set('filingFrequency', event.target.value)} disabled={!canManage || saving}>
            {FILING_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-[13px] text-ink-700">
          <input type="checkbox" checked={form.withholdingEntity} onChange={(event) => set('withholdingEntity', event.target.checked)} disabled={!canManage || saving} />
          Withholding entity
        </label>
        <div className="md:col-span-3">
          <Field label="Tax notes">
            <textarea className={`${INPUT_CLASS} min-h-20 py-2`} value={form.notes} onChange={(event) => set('notes', event.target.value)} maxLength={1000} disabled={!canManage || saving} />
          </Field>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface-2/40 p-4">
        <h3 className="text-[15px] font-semibold text-ink-900">Document numbering</h3>
        <p className="mt-1 text-[12px] text-ink-500">
          Prefixes and next numbers are configuration. The posting service allocates numbers
          inside the posting transaction. A voided or reversed document will never reuse a number.
        </p>
        {!latestFiscalYear ? (
          <div className="mt-3"><Notice tone="warning" message="Create the fiscal year before configuring numbering sequences." /></div>
        ) : sequences.length === 0 ? (
          <div className="mt-3"><Notice message="No numbering sequences were found for the latest fiscal year." /></div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead className="text-ink-400">
                <tr>
                  <th scope="col" className="px-2 py-2 font-semibold">Document</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Prefix</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Next number</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Padding</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((sequence) => (
                  <tr key={sequence.docType}>
                    <td className="px-2 py-1.5 text-ink-700">{DOCUMENT_TYPE_LABELS[sequence.docType] ?? sequence.docType}</td>
                    <td className="px-2 py-1.5">
                      <input className={INPUT_CLASS} value={sequence.prefix} onChange={(event) => setSequence(sequence.docType, 'prefix', event.target.value)} maxLength={20} disabled={!canManage || saving} aria-label={`${sequence.docType} prefix`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className={INPUT_CLASS} value={sequence.nextValue} onChange={(event) => setSequence(sequence.docType, 'nextValue', event.target.value)} inputMode="numeric" disabled={!canManage || saving} aria-label={`${sequence.docType} next number`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className={INPUT_CLASS} value={String(sequence.pad)} onChange={(event) => setSequence(sequence.docType, 'pad', event.target.value)} inputMode="numeric" disabled={!canManage || saving} aria-label={`${sequence.docType} padding`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <button type="submit" disabled={saving} className="lv-btn lv-btn-primary min-h-11 text-[14px]">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save company settings
        </button>
      ) : null}
    </form>
  );
}
