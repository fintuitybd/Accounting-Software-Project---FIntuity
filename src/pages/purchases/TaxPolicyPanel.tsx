import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { PurchaseTaxPolicy } from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import type { PurchaseRefs } from './purchasesRefs';
import { SectionCard, todayIso } from './purchasesUi';

export function TaxPolicyPanel({
  companyId,
  refs,
  canManage,
}: {
  companyId: string;
  refs: PurchaseRefs;
  canManage: boolean;
}) {
  const [policy, setPolicy] = useState<PurchaseTaxPolicy | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerQualification, setReviewerQualification] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [reviewedAt, setReviewedAt] = useState(todayIso());
  const [inputVatAccountId, setInputVatAccountId] = useState('');
  const [vdsPayableAccountId, setVdsPayableAccountId] = useState('');
  const [tdsPayableAccountId, setTdsPayableAccountId] = useState('');
  const [reverseChargePayableAccountId, setReverseChargePayableAccountId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inputVatAccounts = useMemo(
    () =>
      refs.accounts.filter(
        (account) => account.isActive && account.accountType === 'ASSET' && account.controlSubledger === 'VAT_CURRENT_ACCOUNT',
      ),
    [refs.accounts],
  );
  const vdsAccounts = useMemo(
    () =>
      refs.accounts.filter(
        (account) => account.isActive && account.accountType === 'LIABILITY' && account.controlSubledger === 'VDS_PAYABLE',
      ),
    [refs.accounts],
  );
  const tdsAccounts = useMemo(
    () =>
      refs.accounts.filter(
        (account) => account.isActive && account.accountType === 'LIABILITY' && account.controlSubledger === 'TDS_PAYABLE',
      ),
    [refs.accounts],
  );
  const liabilityAccounts = useMemo(
    () =>
      refs.accounts.filter(
        (account) =>
          account.isActive &&
          account.accountType === 'LIABILITY' &&
          account.controlSubledger === 'NONE',
      ),
    [refs.accounts],
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await purchaseApi.taxPolicy(companyId);
      setPolicy(response.policy);
      if (response.policy.approval) {
        setReviewerName(response.policy.approval.reviewerName);
        setReviewerQualification(response.policy.approval.reviewerQualification);
        setSourceReference(response.policy.approval.sourceReference);
        setReviewedAt(response.policy.approval.reviewedAt);
        setInputVatAccountId(response.policy.approval.inputVatAccountId);
        setVdsPayableAccountId(response.policy.approval.vdsPayableAccountId);
        setTdsPayableAccountId(response.policy.approval.tdsPayableAccountId);
        setReverseChargePayableAccountId(response.policy.approval.reverseChargePayableAccountId);
      } else {
        setInputVatAccountId(inputVatAccounts[0]?.id ?? '');
        setVdsPayableAccountId(vdsAccounts[0]?.id ?? '');
        setTdsPayableAccountId(tdsAccounts[0]?.id ?? '');
        setReverseChargePayableAccountId(
          liabilityAccounts.find((account) => account.code === '2150')?.id ??
            liabilityAccounts[0]?.id ??
            '',
        );
      }
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, inputVatAccounts, liabilityAccounts, tdsAccounts, vdsAccounts]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await purchaseApi.approveTaxPolicy(companyId, {
        reviewerName,
        reviewerQualification,
        sourceReference,
        reviewedAt,
        inputVatAccountId,
        vdsPayableAccountId,
        tdsPayableAccountId,
        reverseChargePayableAccountId,
        rulePackVersion: policy.pack.version,
      });
      setPolicy(response.policy);
      setNotice('Reviewer approval recorded for this exact pack version and account mapping.');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SectionCard title="Purchase tax policy"><p className="py-8 text-center text-[13px] text-ink-500">Loading tax policy…</p></SectionCard>;
  }
  if (!policy) {
    return <SectionCard title="Purchase tax policy"><ErrorBanner message={error ?? 'Tax policy could not be loaded.'} /></SectionCard>;
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Purchase tax policy" kicker="Posting is blocked until an external reviewer approves the exact pack">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-ink-500">Rule pack</p>
            <p className="mt-1 font-mono text-[15px] font-semibold text-ink-900">{policy.pack.version}</p>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">{policy.pack.titleEn}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="lv-chip lv-chip-gold">{policy.pack.reviewerStatus}</span>
            <span className={`lv-chip ${policy.canPost ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              {policy.canPost ? 'Posting allowed' : 'Posting blocked'}
            </span>
          </div>
        </div>
        {policy.blockingReason ? (
          <div className="mt-4"><Notice message={policy.blockingReason} tone="warning" /></div>
        ) : null}
        <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
          This screen records a named external reviewer's decision. It does not perform tax-counsel review and does not
          make the rule pack final. The pack remains labelled pending professional verification.
        </p>
      </SectionCard>

      <SectionCard title="Record reviewer approval" kicker="The exact pack version and control accounts are stored">
        {error ? <ErrorBanner message={error} /> : null}
        {notice ? <div className="mt-3"><Notice message={notice} tone="success" /></div> : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Reviewer name" required>
            <input className={INPUT_CLASS} value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
          </Field>
          <Field label="Reviewer qualification" required>
            <input className={INPUT_CLASS} value={reviewerQualification} onChange={(event) => setReviewerQualification(event.target.value)} />
          </Field>
          <Field label="Source / engagement reference" required>
            <input className={INPUT_CLASS} value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} />
          </Field>
          <Field label="Review date" required>
            <input type="date" className={INPUT_CLASS} value={reviewedAt} onChange={(event) => setReviewedAt(event.target.value)} />
          </Field>
          <Field label="Input VAT account" hint="Active ASSET with VAT_CURRENT_ACCOUNT control." required>
            <select className={INPUT_CLASS} value={inputVatAccountId} onChange={(event) => setInputVatAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {inputVatAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="VDS payable account" hint="Active LIABILITY with VDS_PAYABLE control." required>
            <select className={INPUT_CLASS} value={vdsPayableAccountId} onChange={(event) => setVdsPayableAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {vdsAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="TDS payable account" hint="Active LIABILITY with TDS_PAYABLE control." required>
            <select className={INPUT_CLASS} value={tdsPayableAccountId} onChange={(event) => setTdsPayableAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {tdsAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="Reverse-charge VAT payable account" hint="Active LIABILITY account." required>
            <select className={INPUT_CLASS} value={reverseChargePayableAccountId} onChange={(event) => setReverseChargePayableAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {liabilityAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
        </div>
        {inputVatAccounts.length === 0 || vdsAccounts.length === 0 || tdsAccounts.length === 0 ? (
          <div className="mt-3">
            <Notice
              message="One or more required control accounts are missing. Add an active VAT current account, VDS payable and TDS payable in the chart of accounts before approving the policy."
              tone="warning"
            />
          </div>
        ) : null}
        <button
          type="button"
          className="lv-btn lv-btn-primary mt-4 min-h-11 text-[13px]"
          disabled={!canManage || saving || !reviewerName || !reviewerQualification || !sourceReference || !inputVatAccountId || !vdsPayableAccountId || !tdsPayableAccountId || !reverseChargePayableAccountId}
          onClick={() => void approve()}
        >
          <ShieldCheck size={15} /> {saving ? 'Recording…' : 'Record approval'}
        </button>
        {!canManage ? <p className="mt-2 text-[12px] font-semibold text-amber-700 dark:text-amber-300">You do not have permission to manage company settings.</p> : null}

        {policy.approval ? (
          <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-4 text-[13px]">
            <p className="font-semibold text-ink-900">Recorded approval</p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div><dt className="text-ink-400">Reviewer</dt><dd className="mt-1 text-ink-800">{policy.approval.reviewerName} · {policy.approval.reviewerQualification}</dd></div>
              <div><dt className="text-ink-400">Reviewed</dt><dd className="mt-1 text-ink-800">{policy.approval.reviewedAt}</dd></div>
              <div><dt className="text-ink-400">Source</dt><dd className="mt-1 text-ink-800">{policy.approval.sourceReference}</dd></div>
              <div><dt className="text-ink-400">Pack</dt><dd className="mt-1 font-mono text-ink-800">{policy.approval.packVersion}</dd></div>
              <div><dt className="text-ink-400">Input VAT</dt><dd className="mt-1 text-ink-800">{policy.approval.inputVatAccountCode} — {policy.approval.inputVatAccountName}</dd></div>
              <div><dt className="text-ink-400">VDS payable</dt><dd className="mt-1 text-ink-800">{policy.approval.vdsPayableAccountCode} — {policy.approval.vdsPayableAccountName}</dd></div>
              <div><dt className="text-ink-400">TDS payable</dt><dd className="mt-1 text-ink-800">{policy.approval.tdsPayableAccountCode} — {policy.approval.tdsPayableAccountName}</dd></div>
              <div><dt className="text-ink-400">Reverse charge payable</dt><dd className="mt-1 text-ink-800">{policy.approval.reverseChargePayableAccountCode} — {policy.approval.reverseChargePayableAccountName}</dd></div>
            </dl>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
