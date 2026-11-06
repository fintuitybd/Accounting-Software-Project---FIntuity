import { useCallback, useState } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { salesApi, type SalesTaxPolicy } from '../../sales/api';
import type { SetupAccount } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { SALES_INPUT, SALES_SELECT, todayIso } from './salesUi';

export function TaxPolicyPanel({
  companyId,
  policy,
  accounts,
  canManage,
  onApproved,
}: {
  companyId: string;
  policy: SalesTaxPolicy;
  accounts: SetupAccount[];
  canManage: boolean;
  onApproved: (policy: SalesTaxPolicy) => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const liabilityAccounts = accounts.filter((account) => account.isActive && account.accountType === 'LIABILITY');
  const [reviewerName, setReviewerName] = useState(policy.approval?.reviewerName ?? '');
  const [reviewerQualification, setReviewerQualification] = useState(policy.approval?.reviewerQualification ?? '');
  const [sourceReference, setSourceReference] = useState(policy.approval?.sourceReference ?? '');
  const [reviewedAt, setReviewedAt] = useState(policy.approval?.reviewedAt ?? todayIso());
  const [outputVatAccountId, setOutputVatAccountId] = useState(policy.approval?.outputVatAccountId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await salesApi.approveTaxPolicy(companyId, {
        reviewerName,
        reviewerQualification,
        sourceReference,
        reviewedAt,
        outputVatAccountId,
        rulePackVersion: policy.pack.version,
      });
      onApproved(response.policy);
      setNotice(L('Reviewer approval recorded for the exact rule-pack version.', 'সঠিক রুল-প্যাক সংস্করণের জন্য পর্যালোচকের অনুমোদন সংরক্ষিত হয়েছে।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    canManage &&
    reviewerName.trim().length >= 3 &&
    reviewerQualification.trim().length >= 3 &&
    sourceReference.trim().length >= 3 &&
    outputVatAccountId &&
    reviewedAt;

  return (
    <div className="space-y-4">
      <section className="lv-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="lv-kicker">{L('Tax configuration placeholder', 'কর কনফিগারেশন প্লেসহোল্ডার')}</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Sales tax policy approval', 'বিক্রয় কর নীতি অনুমোদন')}</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              {L(
                'The application does not perform tax-counsel review. It stores who approved this exact rule-pack version, their qualification, the source document and the output VAT account. Posting is blocked until this record exists and matches the server pack.',
                'অ্যাপ্লিকেশন ট্যাক্স-কাউন্সেল পর্যালোচনা করে না। এটি সংরক্ষণ করে কে এই সঠিক রুল-প্যাক সংস্করণ অনুমোদন করেছে, তাদের যোগ্যতা, উৎস নথি ও আউটপুট ভ্যাট হিসাব। এই রেকর্ড না থাকা বা সার্ভার প্যাকে না মেলা পর্যন্ত পোস্টিং বন্ধ থাকে।',
              )}
            </p>
          </div>
          <span className={`lv-chip ${policy.canPost ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
            {policy.canPost ? <ShieldCheck size={13} /> : <TriangleAlert size={13} />}
            {policy.canPost ? L('Posting enabled', 'পোস্টিং সক্রিয়') : L('Posting blocked', 'পোস্টিং বন্ধ')}
          </span>
        </div>
        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}
        {!policy.canPost && policy.blockingReason ? (
          <div className="mt-4"><Notice message={policy.blockingReason} tone="warning" /></div>
        ) : null}
        <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-ink-400">{L('Rule pack version', 'রুল প্যাক সংস্করণ')}</dt><dd className="mt-1 font-mono font-semibold text-ink-900">{policy.pack.version}</dd></div>
          <div><dt className="text-ink-400">{L('Pack status', 'প্যাক স্ট্যাটাস')}</dt><dd className="mt-1 font-semibold text-ink-900">{policy.pack.reviewerStatus.replaceAll('_', ' ')}</dd></div>
          <div><dt className="text-ink-400">{L('Effective from', 'কার্যকর থেকে')}</dt><dd className="mt-1 font-semibold text-ink-900">{policy.pack.effectiveFrom}</dd></div>
          <div><dt className="text-ink-400">{L('Pack owner', 'প্যাক মালিক')}</dt><dd className="mt-1 text-ink-700">{policy.pack.reviewer}</dd></div>
          {policy.approval ? (
            <>
              <div><dt className="text-ink-400">{L('Reviewer', 'পর্যালোচক')}</dt><dd className="mt-1 font-semibold text-ink-900">{policy.approval.reviewerName}</dd></div>
              <div><dt className="text-ink-400">{L('Qualification', 'যোগ্যতা')}</dt><dd className="mt-1 text-ink-700">{policy.approval.reviewerQualification}</dd></div>
              <div><dt className="text-ink-400">{L('Reviewed on', 'পর্যালোচনার তারিখ')}</dt><dd className="mt-1 text-ink-700">{policy.approval.reviewedAt}</dd></div>
              <div><dt className="text-ink-400">{L('Output VAT account', 'আউটপুট ভ্যাট হিসাব')}</dt><dd className="mt-1 text-ink-700">{policy.approval.outputVatAccountCode} · {policy.approval.outputVatAccountName}</dd></div>
              <div className="sm:col-span-2 lg:col-span-4"><dt className="text-ink-400">{L('Source reference', 'উৎস রেফারেন্স')}</dt><dd className="mt-1 text-ink-700">{policy.approval.sourceReference}</dd></div>
            </>
          ) : null}
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="lv-table w-full min-w-[800px] text-[13px]">
            <caption className="sr-only">{L('Sales VAT categories in the rule pack', 'রুল প্যাকে বিক্রয় ভ্যাট শ্রেণি')}</caption>
            <thead><tr><th scope="col" className="text-left">{L('Category', 'শ্রেণি')}</th><th scope="col" className="text-right">{L('Rate', 'হার')}</th><th scope="col" className="text-left">{L('Rule', 'রুল')}</th><th scope="col" className="text-left">{L('Citation', 'উদ্ধৃতি')}</th><th scope="col" className="text-left">{L('Verification', 'যাচাই')}</th></tr></thead>
            <tbody>
              {Object.values(policy.pack.categories).map((category) => (
                <tr key={category.category}>
                  <td className="font-semibold text-ink-800">{category.category.replaceAll('_', ' ')}</td>
                  <td className="text-right font-money tabular-nums">{(category.rateBps / 100).toFixed(2)}%</td>
                  <td className="font-mono text-[12px]">{category.ruleId ?? '—'}</td>
                  <td className="max-w-[420px] text-[12px] text-ink-600">{category.citation ?? '—'}</td>
                  <td>{category.verifyFlag === true ? <span className="lv-chip lv-chip-gold">{L('Requires verification', 'যাচাই প্রয়োজন')}</span> : category.verifyFlag === false ? <span className="lv-chip lv-chip-emerald">{L('Reviewed', 'পর্যালোচিত')}</span> : <span className="lv-chip lv-chip-neutral">{L('Not configured', 'কনফিগার করা হয়নি')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lv-card p-4 sm:p-6">
        <h3 className="text-[18px] font-semibold text-ink-900">{L('Record reviewer approval', 'পর্যালোচকের অনুমোদন সংরক্ষণ')}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          {L(
            'Only record approval after an external qualified reviewer has checked the pack against the official sources. This is a configuration record, not a substitute for professional advice.',
            'শুধুমাত্র বাহ্যিক যোগ্য পর্যালোচক সরকারি উৎসের সাথে প্যাক যাচাই করার পর অনুমোদন সংরক্ষণ করুন। এটি একটি কনফিগারেশন রেকর্ড, পেশাদার পরামর্শের বিকল্প নয়।',
          )}
        </p>
        {!canManage ? (
          <div className="mt-3"><Notice message={L('You need MANAGE_COMPANY_SETTINGS to record this approval.', 'এই অনুমোদন সংরক্ষণ করতে MANAGE_COMPANY_SETTINGS প্রয়োজন।')} tone="warning" /></div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px] font-semibold text-ink-600">{L('Reviewer name', 'পর্যালোচকের নাম')}<input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} maxLength={200} className={`${SALES_INPUT} mt-1`} /></label>
              <label className="block text-[12px] font-semibold text-ink-600">{L('Qualification', 'যোগ্যতা')}<input value={reviewerQualification} onChange={(event) => setReviewerQualification(event.target.value)} maxLength={200} className={`${SALES_INPUT} mt-1`} placeholder={L('FCA, tax counsel, etc.', 'এফসিএ, ট্যাক্স কাউন্সেল ইত্যাদি')} /></label>
              <label className="block text-[12px] font-semibold text-ink-600 sm:col-span-2">{L('Source / engagement reference', 'উৎস / এনগেজমেন্ট রেফারেন্স')}<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={500} className={`${SALES_INPUT} mt-1`} /></label>
              <label className="block text-[12px] font-semibold text-ink-600">{L('Reviewed on', 'পর্যালোচনার তারিখ')}<input type="date" value={reviewedAt} onChange={(event) => setReviewedAt(event.target.value)} className={`${SALES_INPUT} mt-1`} /></label>
              <label className="block text-[12px] font-semibold text-ink-600">{L('Output VAT account', 'আউটপুট ভ্যাট হিসাব')}<select value={outputVatAccountId} onChange={(event) => setOutputVatAccountId(event.target.value)} className={`${SALES_SELECT} mt-1`}><option value="">{L('Choose a liability account', 'দায় হিসাব নির্বাচন করুন')}</option>{liabilityAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.nameEn}</option>)}</select></label>
            </div>
            <button type="button" onClick={() => void submit()} disabled={busy || !canSubmit} className="lv-btn lv-btn-primary mt-4 min-h-11 text-[13px]">
              <ShieldCheck size={15} /> {busy ? L('Saving…', 'সংরক্ষণ হচ্ছে…') : L('Record approval', 'অনুমোদন সংরক্ষণ')}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
