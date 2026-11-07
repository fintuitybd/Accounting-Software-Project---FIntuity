import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileCheck2,
  Lock,
  LockOpen,
  RefreshCcw,
  Send,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type FiscalPeriod, type SetupAccount } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { closeApi, type CloseCheck, type CloseRun, type SuspenseItem, type SuspenseResolution } from '../../close/api';

function formatInstant(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function downloadText(text: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function checkTone(check: CloseCheck): string {
  if (!check.applicable) return 'border-ink-200 bg-ink-50 text-ink-600';
  return check.passed ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900' : 'border-rose-300 bg-rose-50/70 text-rose-900';
}

function checkLabel(check: CloseCheck, isBn: boolean): string {
  if (!check.applicable) return isBn ? 'প্রযোজ্য নয়' : 'Not applicable';
  return check.passed ? (isBn ? 'উত্তীর্ণ' : 'Passed') : isBn ? 'ব্যর্থ' : 'Failed';
}

function statusChip(status: CloseRun['status']): string {
  switch (status) {
    case 'APPROVED':
      return 'ql-badge ql-badge-success';
    case 'SUBMITTED':
      return 'ql-badge ql-badge-warn';
    case 'REJECTED':
      return 'ql-badge ql-badge-danger';
    case 'REOPENED':
      return 'ql-badge ql-badge-neutral';
    default:
      return 'ql-badge ql-badge-neutral';
  }
}

export default function ClosePage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const isBn = locale === 'bn-BD';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);

  const canPrepare = auth.hasCompanyPermission('SUBMIT_CLOSE_MAKER');
  const canApprove = auth.hasCompanyPermission('APPROVE_CLOSE_CHECKER');
  const canReopen = auth.hasCompanyPermission('REOPEN_PERIOD');
  const canExport = auth.hasCompanyPermission('EXPORT_DATA');

  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [runs, setRuns] = useState<CloseRun[]>([]);
  const [suspenseItems, setSuspenseItems] = useState<SuspenseItem[]>([]);
  const [suspenseRequests, setSuspenseRequests] = useState<SuspenseResolution[]>([]);
  const [suspenseAccounts, setSuspenseAccounts] = useState<Array<{ id: string; code: string; nameEn: string }>>([]);
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [decisionOpen, setDecisionOpen] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [resolveItem, setResolveItem] = useState<SuspenseItem | null>(null);
  const [resolveTarget, setResolveTarget] = useState('');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveAttachment, setResolveAttachment] = useState('');
  const [suspenseDecision, setSuspenseDecision] = useState<{ id: string; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [suspenseDecisionReason, setSuspenseDecisionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPeriod = periods.find((period) => period.id === periodId) ?? null;
  const selectedRun = runs[0] ?? null;
  const activeChecks = selectedRun?.checks ?? [];
  const failedChecks = activeChecks.filter((check) => check.applicable && !check.passed);
  const passedCount = activeChecks.filter((check) => check.applicable && check.passed).length;

  const loadBase = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [periodResponse, accountResponse, suspenseResponse] = await Promise.all([
        setupApi.periods(companyId),
        setupApi.accounts(companyId),
        closeApi.suspense(companyId),
      ]);
      setPeriods(periodResponse.periods);
      setAccounts(accountResponse.accounts.filter((account) => account.isActive));
      setSuspenseItems(suspenseResponse.suspense.items);
      setSuspenseRequests(suspenseResponse.suspense.requests);
      setSuspenseAccounts(suspenseResponse.suspense.accounts);
      setPeriodId((current) => {
        if (current && periodResponse.periods.some((period) => period.id === current)) return current;
        const open = periodResponse.periods.find((period) => period.status === 'OPEN');
        return open?.id ?? periodResponse.periods[0]?.id ?? '';
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadRuns = useCallback(async () => {
    if (!companyId || !periodId) {
      setRuns([]);
      return;
    }
    try {
      const response = await closeApi.list(companyId, periodId);
      setRuns(response.closeRuns);
      const latest = response.closeRuns[0];
      setEvidenceReference(latest?.evidenceReference ?? '');
      setEvidenceNote(latest?.evidenceNote ?? '');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId, periodId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const reload = async (message: string): Promise<void> => {
    await loadRuns();
    const response = await closeApi.suspense(companyId);
    setSuspenseItems(response.suspense.items);
    setSuspenseRequests(response.suspense.requests);
    setSuspenseAccounts(response.suspense.accounts);
    setNotice(message);
  };

  const runAction = async (action: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createRun = () =>
    runAction(async () => {
      if (!periodId) return;
      const response = await closeApi.create(companyId, periodId);
      setRuns([response.closeRun, ...runs]);
      await reload(L('Close run prepared from the current control results.', 'বর্তমান নিয়ন্ত্রণ ফলাফল থেকে সমাপনী রান প্রস্তুত হয়েছে।'));
    }, L('Close run prepared.', 'সমাপনী রান প্রস্তুত হয়েছে।'));

  const refreshRun = () =>
    runAction(async () => {
      if (!selectedRun) return;
      const response = await closeApi.refresh(companyId, selectedRun.id);
      setRuns([response.closeRun, ...runs.slice(1)]);
      setNotice(L('Control results recalculated.', 'নিয়ন্ত্রণ ফলাফল পুনঃগণনা হয়েছে।'));
    }, L('Control results recalculated.', 'নিয়ন্ত্রণ ফলাফল পুনঃগণনা হয়েছে।'));

  const submitRun = () =>
    runAction(async () => {
      if (!selectedRun) return;
      const response = await closeApi.submit(
        companyId,
        selectedRun.id,
        evidenceReference.trim(),
        evidenceNote.trim() || undefined,
      );
      setRuns([response.closeRun, ...runs.slice(1)]);
      setNotice(L('Close submitted for checker approval.', 'সমাপনী চেকার অনুমোদনের জন্য জমা হয়েছে।'));
    }, L('Close submitted.', 'সমাপনী জমা হয়েছে।'));

  const decide = (action: 'APPROVE' | 'REJECT') => {
    if (!selectedRun) return;
    void runAction(async () => {
      const response = await closeApi.decide(companyId, selectedRun.id, action, decisionReason.trim());
      setRuns([response.closeRun, ...runs.slice(1)]);
      if (action === 'APPROVE') await loadBase();
      setDecisionOpen(null);
      setDecisionReason('');
      setNotice(
        action === 'APPROVE'
          ? L('Close approved and the period is locked.', 'সমাপনী অনুমোদিত এবং হিসাবকাল লক হয়েছে।')
          : L('Close rejected. The period remains open.', 'সমাপনী প্রত্যাখ্যাত। হিসাবকাল খোলা আছে।'),
      );
    }, action === 'APPROVE' ? L('Close approved.', 'সমাপনী অনুমোদিত।') : L('Close rejected.', 'সমাপনী প্রত্যাখ্যাত।'));
  };

  const reopen = () => {
    if (!selectedPeriod) return;
    void runAction(async () => {
      await closeApi.reopen(companyId, selectedPeriod.id, reopenReason.trim());
      setReopenOpen(false);
      setReopenReason('');
      await loadBase();
      await loadRuns();
      setNotice(L('Period reopened with an audit reason.', 'কারণসহ হিসাবকাল পুনরায় খোলা হয়েছে এবং অডিটে আছে।'));
    }, L('Period reopened.', 'হিসাবকাল পুনরায় খোলা হয়েছে।'));
  };

  const exportPack = () => {
    if (!selectedRun) return;
    void runAction(async () => {
      const exported = await closeApi.exportPack(companyId, selectedRun.id);
      downloadText(exported.text, exported.filename ?? `close-pack-${selectedRun.periodCode}.csv`);
      setNotice(L('Close pack downloaded.', 'সমাপনী প্যাক ডাউনলোড হয়েছে।'));
    }, L('Close pack downloaded.', 'সমাপনী প্যাক ডাউনলোড হয়েছে।'));
  };

  const requestSuspense = () => {
    if (!resolveItem) return;
    void runAction(async () => {
      await closeApi.requestSuspense(companyId, {
        sourceLineId: resolveItem.lineId,
        targetAccountId: resolveTarget,
        reason: resolveReason.trim(),
        attachmentReference: resolveAttachment.trim(),
      });
      setResolveItem(null);
      setResolveTarget('');
      setResolveReason('');
      setResolveAttachment('');
      await reload(L('Suspense resolution submitted for a different checker.', 'সাসপেন্স নিষ্পত্তি অন্য চেকারের জন্য জমা হয়েছে।'));
    }, L('Suspense resolution requested.', 'সাসপেন্স নিষ্পত্তি অনুরোধ করা হয়েছে।'));
  };

  const decideSuspense = () => {
    if (!suspenseDecision) return;
    void runAction(async () => {
      await closeApi.decideSuspense(
        companyId,
        suspenseDecision.id,
        suspenseDecision.action,
        suspenseDecisionReason.trim(),
      );
      setSuspenseDecision(null);
      setSuspenseDecisionReason('');
      await reload(
        suspenseDecision.action === 'APPROVE'
          ? L('Suspense resolution approved and posted.', 'সাসপেন্স নিষ্পত্তি অনুমোদিত ও পোস্ট হয়েছে।')
          : L('Suspense resolution rejected.', 'সাসপেন্স নিষ্পত্তি প্রত্যাখ্যাত।'),
      );
    }, L('Suspense decision recorded.', 'সাসপেন্স সিদ্ধান্ত নথিভুক্ত হয়েছে।'));
  };

  const targetAccounts = useMemo(
    () => accounts.filter((account) => account.id !== resolveItem?.suspenseAccountId),
    [accounts, resolveItem?.suspenseAccountId],
  );

  if (!auth.hasCompanyPermission('VIEW_REPORTS')) {
    return (
      <Notice
        tone="warning"
        message={L(
          'Your role cannot view the close controls. Ask a controller, owner or administrator for access.',
          'আপনার ভূমিকা সমাপনী নিয়ন্ত্রণ দেখতে পারে না। প্রবেশাধিকারের জন্য নিয়ন্ত্রক, মালিক বা প্রশাসকের কাছে জিজ্ঞাসা করুন।',
        )}
      />
    );
  }

  if (loading) {
    return <p className="py-8 text-center text-[13px] text-ink-500">{L('Loading close controls…', 'সমাপনী নিয়ন্ত্রণ লোড হচ্ছে…')}</p>;
  }

  return (
    <div className="space-y-5">
      <section className="ql-card p-4 sm:p-6">
        <PageHeader
          eyebrow={L('Close & controls', 'সমাপনী ও নিয়ন্ত্রণ')}
          title={L('Controlled month-end close', 'নিয়ন্ত্রিত মাস-শেষ সমাপনী')}
          description={L(
            'Control results are recalculated by the server. The maker submits evidence; a different checker approves and locks the period. Reopening needs a separate permission and a reason.',
            'নিয়ন্ত্রণ ফলাফল সার্ভার পুনঃগণনা করে। মেকার প্রমাণসহ জমা দেন; ভিন্ন চেকার অনুমোদন করে হিসাবকাল লক করেন। পুনরায় খুলতে আলাদা অনুমতি ও কারণ প্রয়োজন।',
          )}
          meta={
            <>
              {selectedPeriod ? (
                <span className={`ql-badge ${selectedPeriod.status === 'LOCKED' ? 'ql-badge-danger' : selectedPeriod.status === 'CLOSED' ? 'ql-badge-warning' : 'ql-badge-success'}`}>
                  {selectedPeriod.status === 'LOCKED' ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
                  {selectedPeriod.code} · {selectedPeriod.status}
                </span>
              ) : null}
              {selectedRun ? <span className={statusChip(selectedRun.status)}>{selectedRun.status}</span> : null}
            </>
          }
        />

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Accounting period', 'হিসাবকাল')}
            <select className={`${INPUT_CLASS} mt-1`} value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>{period.code} — {period.label} ({period.status})</option>
              ))}
            </select>
          </label>
          <div className="rounded-xl bg-ink-50/70 px-3 py-2.5">
            <p className="ql-kicker">{L('Checks passed', 'উত্তীর্ণ নিয়ন্ত্রণ')}</p>
            <p className="font-money mt-1 text-[14px] font-semibold text-ink-900">{passedCount} / {activeChecks.filter((check) => check.applicable).length}</p>
          </div>
          <div className="rounded-xl bg-ink-50/70 px-3 py-2.5">
            <p className="ql-kicker">{L('Failed checks', 'ব্যর্থ নিয়ন্ত্রণ')}</p>
            <p className={`font-money mt-1 text-[14px] font-semibold ${failedChecks.length ? 'text-rose-600' : 'text-vault-800'}`}>{failedChecks.length}</p>
          </div>
          <div className="rounded-xl bg-ink-50/70 px-3 py-2.5">
            <p className="ql-kicker">{L('Open suspense items', 'খোলা সাসপেন্স আইটেম')}</p>
            <p className={`font-money mt-1 text-[14px] font-semibold ${suspenseItems.length ? 'text-rose-600' : 'text-vault-800'}`}>{suspenseItems.length}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canPrepare && !selectedRun ? (
            <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || !periodId} onClick={() => void createRun()}>
              <FileCheck2 size={15} /> {L('Prepare close run', 'সমাপনী রান প্রস্তুত')}
            </button>
          ) : null}
          {canPrepare && selectedRun?.status === 'DRAFT' ? (
            <>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" disabled={busy} onClick={() => void refreshRun()}>
                <RefreshCcw size={15} /> {L('Recalculate controls', 'নিয়ন্ত্রণ পুনঃগণনা')}
              </button>
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || failedChecks.length > 0 || evidenceReference.trim().length < 3} onClick={() => void submitRun()}>
                <Send size={15} /> {L('Submit for checker', 'চেকারের জন্য জমা')}
              </button>
            </>
          ) : null}
          {canApprove && selectedRun?.status === 'SUBMITTED' ? (
            <>
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy} onClick={() => setDecisionOpen('APPROVE')}>
                <CheckCircle2 size={15} /> {L('Approve and lock', 'অনুমোদন ও লক')}
              </button>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 border-rose-500/30 text-[13px] text-rose-700" disabled={busy} onClick={() => setDecisionOpen('REJECT')}>
                <XCircle size={15} /> {L('Reject', 'প্রত্যাখ্যান')}
              </button>
            </>
          ) : null}
          {canReopen && selectedPeriod && (selectedPeriod.status === 'CLOSED' || selectedPeriod.status === 'LOCKED') ? (
            <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" disabled={busy} onClick={() => setReopenOpen(true)}>
              <LockOpen size={15} /> {L('Reopen period', 'হিসাবকাল পুনরায় খুলুন')}
            </button>
          ) : null}
          {canExport && selectedRun ? (
            <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" disabled={busy} onClick={exportPack}>
              <Download size={15} /> {L('Export close pack', 'সমাপনী প্যাক রপ্তানি')}
            </button>
          ) : null}
        </div>

        {selectedRun?.status === 'DRAFT' ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-line bg-surface-2/40 p-3 md:grid-cols-2">
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Evidence reference (required)', 'প্রমাণের রেফারেন্স (আবশ্যক)')}
              <input className={`${INPUT_CLASS} mt-1`} value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} placeholder={L('Signed close file or board pack reference', 'স্বাক্ষরিত সমাপনী ফাইল বা বোর্ড প্যাক রেফারেন্স')} />
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Evidence note', 'প্রমাণের নোট')}
              <input className={`${INPUT_CLASS} mt-1`} value={evidenceNote} maxLength={2000} onChange={(event) => setEvidenceNote(event.target.value)} />
            </label>
          </div>
        ) : null}

        {decisionOpen ? (
          <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-3">
            <p className="text-[13px] font-semibold text-ink-900">
              {decisionOpen === 'APPROVE' ? L('Approve this close and lock the period', 'এই সমাপনী অনুমোদন করে হিসাবকাল লক করুন') : L('Reject this close', 'এই সমাপনী প্রত্যাখ্যান করুন')}
            </p>
            <p className="mt-1 text-[12px] text-ink-600">
              {L('The checker must be different from the maker and submitter. The reason is stored in the audit log.', 'চেকার মেকার ও জমাদানকারীর থেকে ভিন্ন হতে হবে। কারণ অডিট লগে সংরক্ষিত হবে।')}
            </p>
            <label className="mt-2 block text-[12px] font-semibold text-ink-600">
              {L('Decision reason', 'সিদ্ধান্তের কারণ')}
              <textarea className={`${INPUT_CLASS} mt-1 min-h-20`} value={decisionReason} maxLength={500} onChange={(event) => setDecisionReason(event.target.value)} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || decisionReason.trim().length < 3} onClick={() => decide(decisionOpen)}>
                {decisionOpen === 'APPROVE' ? L('Confirm approval', 'অনুমোদন নিশ্চিত') : L('Confirm rejection', 'প্রত্যাখ্যান নিশ্চিত')}
              </button>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => setDecisionOpen(null)}>{L('Cancel', 'বাতিল')}</button>
            </div>
          </div>
        ) : null}

        {reopenOpen ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-[13px] font-semibold text-amber-900">{L('Reopen a closed or locked period', 'বন্ধ বা লক করা হিসাবকাল পুনরায় খুলুন')}</p>
            <p className="mt-1 text-[12px] text-amber-900/80">
              {L('New postings will be accepted again. The approved close run stays in history as REOPENED and the reason is audited.', 'নতুন পোস্টিং আবার গ্রহণ করা হবে। অনুমোদিত সমাপনী রান ইতিহাসে REOPENED হিসেবে থাকবে এবং কারণ অডিট হবে।')}
            </p>
            <label className="mt-2 block text-[12px] font-semibold text-amber-900">
              {L('Reopen reason', 'পুনরায় খোলার কারণ')}
              <textarea className={`${INPUT_CLASS} mt-1 min-h-20`} value={reopenReason} maxLength={500} onChange={(event) => setReopenReason(event.target.value)} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || reopenReason.trim().length < 3} onClick={reopen}>{L('Confirm reopen', 'পুনরায় খোলা নিশ্চিত')}</button>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => setReopenOpen(false)}>{L('Cancel', 'বাতিল')}</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker">{L('Persisted checklist', 'সংরক্ষিত চেকলিস্ট')}</p>
            <h2 className="mt-1 text-[18px] font-semibold text-ink-900">{L('Control results', 'নিয়ন্ত্রণ ফলাফল')}</h2>
          </div>
          {selectedRun ? (
            <span className="text-[12px] text-ink-500">
              {L('Prepared', 'প্রস্তুত')} {selectedRun.preparedByName} · {formatInstant(selectedRun.preparedAt)}
            </span>
          ) : null}
        </div>
        {!selectedRun ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-500">{L('No close run exists for this period. Prepare one to evaluate the controls.', 'এই হিসাবকালের কোনো সমাপনী রান নেই। নিয়ন্ত্রণ মূল্যায়নের জন্য একটি প্রস্তুত করুন।')}</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {selectedRun.checks.map((check) => (
              <div key={check.key} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${checkTone(check)}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{isBn ? check.labelBn : check.labelEn}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed opacity-80">{isBn ? check.detailBn : check.detailEn}</p>
                  {check.differencePoisha && check.differencePoisha !== '0' ? (
                    <p className="font-money mt-1 text-[12px] font-semibold">{L('Difference', 'পার্থক্য')}: {check.differencePoisha} poisha</p>
                  ) : null}
                </div>
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold">
                  {check.applicable ? check.passed ? <CheckCircle2 size={14} /> : <CircleAlert size={14} /> : <CircleAlert size={14} />}
                  {checkLabel(check, isBn)}
                </span>
              </div>
            ))}
          </div>
        )}
        {selectedRun && selectedRun.exceptions.length > 0 ? (
          <div className="border-t border-ink-100 bg-amber-50/50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-900"><TriangleAlert size={13} /> {L('Exceptions', 'ব্যতিক্রম')}</p>
            <ul className="mt-1 space-y-1">
              {selectedRun.exceptions.map((exception) => (
                <li key={exception.code} className="text-[12px] leading-relaxed text-amber-900/85">
                  <span className="font-mono font-semibold">{exception.code}</span> · {isBn ? exception.messageBn : exception.messageEn}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker">{L('Suspense control', 'সাসপেন্স নিয়ন্ত্রণ')}</p>
            <h2 className="mt-1 text-[18px] font-semibold text-ink-900">{L('Open suspense items', 'খোলা সাসপেন্স আইটেম')}</h2>
            <p className="ql-hint mt-1">
              {L('A target account, reason, attachment and a different checker are required. There is no one-click write-off.', 'লক্ষ্য হিসাব, কারণ, সংযুক্তি এবং ভিন্ন চেকার আবশ্যক। এক ক্লিকে অবলোপন নেই।')}
            </p>
          </div>
          <span className={`ql-badge ${suspenseItems.length ? 'ql-badge-warn' : 'ql-badge-success'}`}>{suspenseItems.length} {L('items', 'আইটেম')}</span>
        </div>
        {suspenseAccounts.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-ink-500">
            {L('No active suspense control account is configured. Mark the suspense account with the SUSPENSE control subledger in the chart of accounts.', 'কোনো সক্রিয় সাসপেন্স নিয়ন্ত্রণ হিসাব কনফিগার করা নেই। হিসাবের চার্টে সাসপেন্স হিসাবকে SUSPENSE নিয়ন্ত্রণ সাবলেজার হিসেবে চিহ্নিত করুন।')}
          </p>
        ) : suspenseItems.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-emerald-800">{L('Suspense account is clear.', 'সাসপেন্স হিসাব পরিষ্কার।')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ql-table min-w-[900px]">
              <thead>
                <tr>
                  <th>{L('Journal', 'জার্নাল')}</th>
                  <th>{L('Date', 'তারিখ')}</th>
                  <th>{L('Narration', 'বিবরণ')}</th>
                  <th>{L('Owner', 'দায়িত্বপ্রাপ্ত')}</th>
                  <th className="text-right">{L('Age', 'বয়স')}</th>
                  <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                  <th className="text-right">{L('Action', 'কার্যক্রম')}</th>
                </tr>
              </thead>
              <tbody>
                {suspenseItems.map((item) => (
                  <tr key={item.lineId}>
                    <td className="font-mono text-[12px] font-semibold text-vault-700">{item.journalNumber ?? item.journalId.slice(0, 8)}</td>
                    <td className="text-[12px] text-ink-600">{item.postingDate}</td>
                    <td className="max-w-[280px] text-[12px] text-ink-800">{item.narration}</td>
                    <td className="text-[12px] text-ink-600">{item.createdByName ?? '—'}</td>
                    <td className="text-right text-[12px]">{item.ageDays}d</td>
                    <td className="font-money text-right text-[12px] font-semibold text-ink-900">{item.amountBdt} BDT</td>
                    <td className="text-right">
                      {canPrepare ? (
                        <button type="button" className="text-[12px] font-semibold text-vault-700" onClick={() => { setResolveItem(item); setResolveTarget(''); setResolveReason(''); setResolveAttachment(''); }}>
                          {L('Resolve', 'নিষ্পত্তি')}
                        </button>
                      ) : <span className="text-[12px] text-ink-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {resolveItem ? (
          <div className="border-t border-ink-100 bg-surface-2/40 px-4 py-4">
            <p className="text-[13px] font-semibold text-ink-900">
              {L('Resolve suspense line', 'সাসপেন্স লাইন নিষ্পত্তি')} · {resolveItem.amountBdt} BDT · {resolveItem.journalNumber ?? resolveItem.journalId.slice(0, 8)}
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <label className="block text-[12px] font-semibold text-ink-600">
                {L('Target account', 'লক্ষ্য হিসাব')}
                <select className={`${INPUT_CLASS} mt-1`} value={resolveTarget} onChange={(event) => setResolveTarget(event.target.value)}>
                  <option value="">{L('Choose an account', 'হিসাব নির্বাচন করুন')}</option>
                  {targetAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} — {isBn && account.nameBn ? account.nameBn : account.nameEn}</option>
                  ))}
                </select>
              </label>
              <label className="block text-[12px] font-semibold text-ink-600">
                {L('Reason', 'কারণ')}
                <input className={`${INPUT_CLASS} mt-1`} value={resolveReason} maxLength={500} onChange={(event) => setResolveReason(event.target.value)} />
              </label>
              <label className="block text-[12px] font-semibold text-ink-600">
                {L('Attachment reference', 'সংযুক্তির রেফারেন্স')}
                <input className={`${INPUT_CLASS} mt-1`} value={resolveAttachment} maxLength={500} onChange={(event) => setResolveAttachment(event.target.value)} />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || !resolveTarget || resolveReason.trim().length < 3 || resolveAttachment.trim().length < 3} onClick={requestSuspense}>
                {L('Submit for approval', 'অনুমোদনের জন্য জমা')}
              </button>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => setResolveItem(null)}>{L('Cancel', 'বাতিল')}</button>
            </div>
          </div>
        ) : null}

        {suspenseRequests.length > 0 ? (
          <div className="border-t border-ink-100 px-4 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">{L('Resolution history', 'নিষ্পত্তির ইতিহাস')}</p>
            <div className="mt-2 overflow-x-auto">
              <table className="ql-table min-w-[920px]">
                <thead>
                  <tr>
                    <th>{L('Journal', 'জার্নাল')}</th>
                    <th>{L('Target', 'লক্ষ্য')}</th>
                    <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                    <th>{L('Requested by', 'অনুরোধকারী')}</th>
                    <th>{L('Status', 'অবস্থা')}</th>
                    <th>{L('Decision', 'সিদ্ধান্ত')}</th>
                    <th className="text-right">{L('Action', 'কার্যক্রম')}</th>
                  </tr>
                </thead>
                <tbody>
                  {suspenseRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="font-mono text-[12px]">{request.sourceJournalNumber ?? request.sourceJournalId.slice(0, 8)}</td>
                      <td className="text-[12px]">{request.targetAccountCode} — {request.targetAccountName}</td>
                      <td className="font-money text-right text-[12px]">{request.amountBdt} BDT</td>
                      <td className="text-[12px]">{request.requestedByName}</td>
                      <td className="text-[12px] font-semibold">{request.status}</td>
                      <td className="text-[12px] text-ink-600">{request.decisionReason ?? '—'}</td>
                      <td className="text-right">
                        {canApprove && request.status === 'PENDING' ? (
                          <div className="flex justify-end gap-1.5">
                            <button type="button" className="text-[12px] font-semibold text-emerald-700" onClick={() => { setSuspenseDecision({ id: request.id, action: 'APPROVE' }); setSuspenseDecisionReason(''); }}>{L('Approve', 'অনুমোদন')}</button>
                            <button type="button" className="text-[12px] font-semibold text-rose-700" onClick={() => { setSuspenseDecision({ id: request.id, action: 'REJECT' }); setSuspenseDecisionReason(''); }}>{L('Reject', 'প্রত্যাখ্যান')}</button>
                          </div>
                        ) : <span className="text-[12px] text-ink-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {suspenseDecision ? (
          <div className="border-t border-ink-100 bg-surface-2/40 px-4 py-4">
            <p className="text-[13px] font-semibold text-ink-900">
              {suspenseDecision.action === 'APPROVE' ? L('Approve and post suspense resolution', 'সাসপেন্স নিষ্পত্তি অনুমোদন ও পোস্ট') : L('Reject suspense resolution', 'সাসপেন্স নিষ্পত্তি প্রত্যাখ্যান')}
            </p>
            <label className="mt-2 block text-[12px] font-semibold text-ink-600">
              {L('Decision reason', 'সিদ্ধান্তের কারণ')}
              <textarea className={`${INPUT_CLASS} mt-1 min-h-20`} value={suspenseDecisionReason} maxLength={500} onChange={(event) => setSuspenseDecisionReason(event.target.value)} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={busy || suspenseDecisionReason.trim().length < 3} onClick={decideSuspense}>{L('Confirm decision', 'সিদ্ধান্ত নিশ্চিত')}</button>
              <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => setSuspenseDecision(null)}>{L('Cancel', 'বাতিল')}</button>
            </div>
          </div>
        ) : null}
      </section>

      {selectedRun ? (
        <section className="ql-card overflow-hidden">
          <div className="ql-card-header">
            <div>
              <p className="ql-kicker">{L('Close evidence', 'সমাপনী প্রমাণ')}</p>
              <h2 className="mt-1 text-[18px] font-semibold text-ink-900">{L('Maker, checker and history', 'মেকার, চেকার ও ইতিহাস')}</h2>
            </div>
            <span className="text-[12px] text-ink-500">{L('Snapshot', 'স্ন্যাপশট')} {selectedRun.snapshotHash?.slice(0, 12) ?? '—'}</span>
          </div>
          <div className="grid gap-3 border-t border-ink-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="ql-kicker">{L('Maker', 'মেকার')}</p><p className="mt-0.5 text-[13px] font-semibold">{selectedRun.preparedByName}</p><p className="text-[12px] text-ink-500">{formatInstant(selectedRun.preparedAt)}</p></div>
            <div><p className="ql-kicker">{L('Submitter', 'জমাদানকারী')}</p><p className="mt-0.5 text-[13px] font-semibold">{selectedRun.submittedByName ?? '—'}</p><p className="text-[12px] text-ink-500">{formatInstant(selectedRun.submittedAt)}</p></div>
            <div><p className="ql-kicker">{L('Checker', 'চেকার')}</p><p className="mt-0.5 text-[13px] font-semibold">{selectedRun.decidedByName ?? '—'}</p><p className="text-[12px] text-ink-500">{formatInstant(selectedRun.decidedAt)}</p></div>
            <div><p className="ql-kicker">{L('Evidence', 'প্রমাণ')}</p><p className="mt-0.5 text-[13px] font-semibold">{selectedRun.evidenceReference || '—'}</p><p className="text-[12px] text-ink-500">{selectedRun.evidenceNote ?? ''}</p></div>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <ol className="space-y-2">
              {selectedRun.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-semibold text-ink-800">{event.action} {event.fromStatus ? `· ${event.fromStatus} → ${event.toStatus}` : ''}</span>
                  <span className="text-ink-500">{event.actorName ?? '—'} · {formatInstant(event.createdAt)} · {event.reason ?? ''}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}
    </div>
  );
}
