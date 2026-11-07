import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { BankReconciliation } from '../../banking/api';
import { bankingApi } from '../../banking/api';
import type { FiscalPeriod } from '../../setup/api';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { formatDate, statusChip } from './bankingUi';

export function ReconciliationPanel({
  companyId,
  bankAccountId,
  bankName,
  periods,
  periodId,
  onPeriodChange,
  canPrepare,
  canReview,
  canExport,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  bankAccountId: string;
  bankName: string;
  periods: FiscalPeriod[];
  periodId: string;
  onPeriodChange: (value: string) => void;
  canPrepare: boolean;
  canReview: boolean;
  canExport: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const { money } = usePreferences();
  const [reconciliation, setReconciliation] = useState<BankReconciliation | null>(null);
  const [history, setHistory] = useState<BankReconciliation[]>([]);
  const [note, setNote] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId || !bankAccountId || !periodId) {
      setReconciliation(null);
      return;
    }
    setError(null);
    try {
      const [current, historyResponse] = await Promise.all([
        bankingApi.reconciliation(companyId, bankAccountId, periodId),
        bankingApi.reconciliations(companyId, bankAccountId),
      ]);
      setReconciliation(current.reconciliation);
      setHistory(historyResponse.reconciliations);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId, bankAccountId, periodId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const selectedPeriod = periods.find((period) => period.id === periodId) ?? null;
  const canSelfReview = Boolean(
    reconciliation?.id &&
      reconciliation.preparedBy !== auth.user?.id &&
      reconciliation.canReview &&
      canReview,
  );
  const blockers = reconciliation?.proof.blockers ?? [];
  const warnings = reconciliation?.proof.warnings ?? [];

  const prepare = async (): Promise<void> => {
    if (!companyId || !bankAccountId || !periodId) return;
    if (
      !window.confirm(
        `Prepare the ${selectedPeriod?.code ?? ''} reconciliation for ${bankName}?\n\nThe snapshot records the statement and GL counts, movement and difference. It is not a sign-off.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.prepareReconciliation(companyId, bankAccountId, periodId);
      setReconciliation(response.reconciliation);
      setNotice(
        response.reconciliation.status === 'PREPARED'
          ? 'Reconciliation prepared with no blockers. It now needs a different user to review and sign off.'
          : 'Draft reconciliation saved. Resolve the listed blockers, then prepare again.',
      );
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const review = async (): Promise<void> => {
    if (!reconciliation?.id) return;
    if (
      !window.confirm(
        `Sign off the ${selectedPeriod?.code ?? ''} reconciliation for ${bankName}?\n\nThis is an audited reviewer sign-off. It is locked when the accounting period is closed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.reviewReconciliation(companyId, reconciliation.id, {
        note: note.trim() || null,
        evidenceReference: evidenceReference.trim() || null,
      });
      setReconciliation(response.reconciliation);
      setNotice(
        response.reconciliation.status === 'LOCKED'
          ? 'Reconciliation reviewed and immediately locked because the period is already closed.'
          : 'Reconciliation reviewed and signed off. The preparation and review are separately audited.',
      );
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const download = async (): Promise<void> => {
    if (!reconciliation?.id) return;
    setBusy(true);
    setError(null);
    try {
      const response = await bankingApi.report(companyId, reconciliation.id);
      const blob = new Blob([response.content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.filename;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Reconciliation report exported and audited.');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const periodOptions = useMemo(
    () => periods.map((period) => ({ value: period.id, label: `${period.code} — ${period.label} (${period.status})` })),
    [periods],
  );

  if (!companyId) return null;

  return (
    <div className="space-y-4">
      <section className="ql-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ql-kicker">Account and period control</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">{bankName}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
              A reconciliation is prepared from imported statement lines and posted GL movement. The preparer and reviewer must be
              different users. Closing the accounting period locks the signed-off reconciliation.
            </p>
          </div>
          <label className="min-w-[260px] text-[12px] font-semibold text-ink-600">
            Accounting period
            <select className="ql-select mt-1 min-h-11 w-full text-[13px]" value={periodId} onChange={(event) => onPeriodChange(event.target.value)}>
              <option value="">Choose period</option>
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}
        {periods.length === 0 ? (
          <div className="mt-4"><Notice message="No accounting period exists. Generate the fiscal year before reconciling." tone="warning" /></div>
        ) : null}

        {reconciliation ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-xl border border-line bg-surface-2/50 p-3">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">Reconciliation</p>
                <div className="mt-1">{statusChip(reconciliation.status)}</div>
                <p className="mt-2 text-[12px] text-ink-500">
                  {reconciliation.periodCode} · {reconciliation.periodStatus}
                </p>
              </article>
              <article className="rounded-xl border border-line bg-surface-2/50 p-3">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">Statement closing</p>
                <p className="font-money mt-1 text-[16px] font-semibold text-ink-900">
                  {reconciliation.proof.statement.closingBalanceBdt ?? 'not supplied'}
                </p>
                <p className="mt-1 text-[12px] text-ink-400">
                  Movement {money(BigInt(reconciliation.proof.statement.movementPoisha))}
                </p>
              </article>
              <article className="rounded-xl border border-line bg-surface-2/50 p-3">
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">GL closing</p>
                <p className="font-money mt-1 text-[16px] font-semibold text-ink-900">{reconciliation.proof.gl.closingBalanceBdt}</p>
                <p className="mt-1 text-[12px] text-ink-400">Movement {money(BigInt(reconciliation.proof.gl.movementPoisha))}</p>
              </article>
              <article className={`rounded-xl border p-3 ${BigInt(reconciliation.proof.differencePoisha) === 0n ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                <p className="text-[12px] uppercase tracking-[0.08em] text-ink-500">Difference</p>
                <p className={`font-money mt-1 text-[16px] font-semibold ${BigInt(reconciliation.proof.differencePoisha) === 0n ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {reconciliation.proof.differenceBdt}
                </p>
                <p className="mt-1 text-[12px] text-ink-500">{reconciliation.proof.differenceBasis.replaceAll('_', ' ').toLowerCase()}</p>
              </article>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Lines', value: reconciliation.proof.statement.lineCount },
                { label: 'Matched', value: reconciliation.proof.statement.matchedCount },
                { label: 'Partial', value: reconciliation.proof.statement.partialCount },
                { label: 'Unmatched', value: reconciliation.proof.statement.unmatchedCount },
                { label: 'Categorised', value: reconciliation.proof.statement.categorizedCount },
                { label: 'Excluded', value: reconciliation.proof.statement.excludedCount },
              ].map((entry) => (
                <div key={entry.label} className="rounded-lg border border-line bg-white px-3 py-2">
                  <p className="text-[12px] text-ink-400">{entry.label}</p>
                  <p className="font-money mt-1 text-[16px] font-semibold text-ink-900">{entry.value}</p>
                </div>
              ))}
            </div>

            {blockers.length > 0 ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={15} /> Sign-off blockers</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px]">
                  {blockers.map((blocker) => (
                    <li key={blocker.code}><strong>{blocker.code}</strong>: {blocker.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
                <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={15} /> No blockers</p>
                <p className="mt-1 text-[12px]">
                  All lines in the period are matched or explicitly excluded and the GL/statement difference is zero.
                </p>
              </div>
            )}

            {warnings.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                {warnings.map((warning) => (
                  <p key={warning} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {warning}</p>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <p className="ql-kicker flex items-center gap-1.5"><ShieldCheck size={13} /> Preparer</p>
                <p className="mt-1 text-[13px] font-semibold text-ink-900">{reconciliation.preparedByName ?? 'Not prepared'}</p>
                <p className="mt-1 text-[12px] text-ink-500">{reconciliation.preparedAt ? formatDate(reconciliation.preparedAt) : 'Prepare the reconciliation to record the maker.'}</p>
                <button
                  type="button"
                  onClick={() => void prepare()}
                  disabled={busy || !canPrepare || reconciliation.status === 'REVIEWED' || reconciliation.status === 'LOCKED'}
                  className="ql-btn ql-btn-secondary mt-3 min-h-11 w-full text-[13px]"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {reconciliation.status === 'DRAFT' ? 'Prepare reconciliation' : 'Re-prepare reconciliation'}
                </button>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                <p className="ql-kicker flex items-center gap-1.5"><LockKeyhole size={13} /> Reviewer sign-off</p>
                <p className="mt-1 text-[13px] font-semibold text-ink-900">{reconciliation.reviewedByName ?? 'Awaiting review'}</p>
                <p className="mt-1 text-[12px] text-ink-500">{reconciliation.reviewedAt ? formatDate(reconciliation.reviewedAt) : 'A different controller or administrator must review.'}</p>
                {reconciliation.status === 'PREPARED' ? (
                  <div className="mt-3 space-y-2">
                    <Field label="Review note">
                      <input className={INPUT_CLASS} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
                    </Field>
                    <Field label="Evidence reference">
                      <input className={INPUT_CLASS} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} />
                    </Field>
                    <button type="button" onClick={() => void review()} disabled={busy || !canSelfReview} className="ql-btn ql-btn-primary min-h-11 w-full text-[13px]">
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Review and sign off
                    </button>
                    {!canSelfReview ? (
                      <p className="text-[12px] text-ink-400">
                        {reconciliation.preparedBy === auth.user?.id
                          ? 'You prepared this reconciliation. A different reviewer must sign it off.'
                          : 'A controller or administrator with approval permission must review it.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {reconciliation.status === 'REVIEWED' || reconciliation.status === 'LOCKED' ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
                    <CheckCircle2 size={13} /> Signed off
                    {reconciliation.status === 'LOCKED' ? ' · locked by the closed period' : ''}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void download()} disabled={busy || !canExport || !reconciliation.id} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
                <Download size={15} /> Export reconciliation report (CSV)
              </button>
              {!canExport ? <span className="self-center text-[12px] text-ink-400">Export permission is required.</span> : null}
            </div>
          </>
        ) : (
          <div className="mt-4"><Notice message="Choose an accounting period to load its reconciliation." /></div>
        )}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker">Sign-off history</p>
            <h2 className="mt-1 text-[18px] font-semibold text-ink-900">{bankName}</h2>
          </div>
          <span className="ql-badge ql-badge-neutral">{history.length} reconciliation(s)</span>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-500">No reconciliation has been prepared for this account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <caption className="sr-only">Reconciliation history</caption>
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Period</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Prepared by</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Reviewed by</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Difference</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Locked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {history.map((entry) => (
                  <tr key={entry.id ?? entry.periodId}>
                    <td className="px-3 py-2.5 font-semibold text-ink-900">{entry.periodCode}</td>
                    <td className="px-3 py-2.5">{statusChip(entry.status)}</td>
                    <td className="px-3 py-2.5">{entry.preparedByName ?? '—'}</td>
                    <td className="px-3 py-2.5">{entry.reviewedByName ?? '—'}</td>
                    <td className={`font-money px-3 py-2.5 text-right ${BigInt(entry.differencePoisha) === 0n ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {entry.differenceBdt}
                    </td>
                    <td className="px-3 py-2.5">{entry.lockedAt ? formatDate(entry.lockedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
