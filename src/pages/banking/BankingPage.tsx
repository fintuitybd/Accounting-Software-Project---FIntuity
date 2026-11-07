import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Landmark, Loader2, Settings2, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { masterApi, type Party } from '../../masters/api';
import { setupApi, type BankAccount, type FiscalPeriod, type SetupAccount } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { ImportPanel } from './ImportPanel';
import { LineWorkbenchPanel } from './LineWorkbenchPanel';
import { ReconciliationPanel } from './ReconciliationPanel';
import { FeeRulesPanel } from './FeeRulesPanel';
import { TransfersPanel } from './TransfersPanel';
import { formatDate, statusChip } from './bankingUi';

type TabKey = 'QUEUE' | 'IMPORT' | 'RECONCILIATION' | 'FEES' | 'TRANSFERS' | 'ACCOUNTS';

function iconFor(kind: string) {
  if (kind === 'MFS') return <Smartphone size={15} />;
  if (kind === 'CASH') return <Banknote size={15} />;
  return <Landmark size={15} />;
}

export default function BankingPage() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [tab, setTab] = useState<TabKey>('QUEUE');
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');
  const canReverse = auth.hasCompanyPermission('REVERSE_POSTED_JOURNAL');
  const canViewReports = auth.hasCompanyPermission('VIEW_REPORTS');
  const canExport = auth.hasCompanyPermission('EXPORT_DATA');
  const canManageSettings = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');

  const loadRefs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [bankResponse, accountResponse, periodResponse, partyResponse] = await Promise.all([
        setupApi.bankAccounts(companyId),
        setupApi.accounts(companyId),
        setupApi.periods(companyId),
        masterApi.parties(companyId, { pageSize: 100 }),
      ]);
      setBanks(bankResponse.bankAccounts);
      setAccounts(accountResponse.accounts);
      setPeriods(periodResponse.periods);
      setParties(partyResponse.parties);
      setSelectedBankId((current) => {
        if (current && bankResponse.bankAccounts.some((bank) => bank.id === current)) return current;
        return (
          bankResponse.bankAccounts.find((bank) => bank.isPrincipal && bank.status === 'ACTIVE')?.id ??
          bankResponse.bankAccounts.find((bank) => bank.status === 'ACTIVE')?.id ??
          bankResponse.bankAccounts[0]?.id ??
          ''
        );
      });
      setPeriodId((current) => {
        if (current && periodResponse.periods.some((period) => period.id === current)) return current;
        const today = new Date().toISOString().slice(0, 10);
        return (
          periodResponse.periods.find((period) => period.startDate <= today && period.endDate >= today)?.id ??
          periodResponse.periods.find((period) => period.status === 'OPEN')?.id ??
          periodResponse.periods[periodResponse.periods.length - 1]?.id ??
          ''
        );
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  const selectedBank = banks.find((bank) => bank.id === selectedBankId) ?? null;
  const selectedPeriod = periods.find((period) => period.id === periodId) ?? null;
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  const tabs: Array<{ key: TabKey; en: string; bn: string; icon: typeof Landmark; visible?: boolean }> = useMemo(
    () => [
      { key: 'QUEUE', en: 'Statement queue', bn: 'স্টেটমেন্ট সারি', icon: Landmark },
      { key: 'IMPORT', en: 'Import statement', bn: 'স্টেটমেন্ট আমদানি', icon: Banknote, visible: canPost },
      { key: 'RECONCILIATION', en: 'Reconciliation', bn: 'মিলকরণ', icon: ShieldCheck, visible: canViewReports },
      { key: 'FEES', en: 'Fee rules', bn: 'ফি নিয়ম', icon: Settings2, visible: canViewReports },
      { key: 'TRANSFERS', en: 'Transfers', bn: 'স্থানান্তর', icon: Banknote },
      { key: 'ACCOUNTS', en: 'Bank accounts', bn: 'ব্যাংক হিসাব', icon: Landmark },
    ],
    [canPost, canViewReports],
  );

  if (!companyId) {
    return (
      <section className="ql-card mx-auto mt-6 max-w-3xl p-6">
        <h2 className="text-[22px] font-semibold text-ink-900">{L('No company selected', 'কোনো কোম্পানি নির্বাচিত নেই')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L('Choose a company before working with bank statements.', 'ব্যাংক স্টেটমেন্টের কাজ করার আগে একটি কোম্পানি নির্বাচন করুন।')}
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-[14px] text-ink-500">
        <Loader2 size={18} className="animate-spin" /> {L('Loading bank accounts and periods…', 'ব্যাংক হিসাব ও সময়কাল লোড হচ্ছে…')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Banking, MFS and reconciliation', 'ব্যাংকিং, এমএফএস ও মিলকরণ')}
        title={L('Imported statements, matching and sign-off', 'আমদানি করা স্টেটমেন্ট, মিলকরণ ও স্বাক্ষর')}
        description={L(
          'The import is evidence only and never posts or auto-matches. Each statement line is matched explicitly to an available posted journal line; a journal line cannot be reused without an explicit split. Unexplained activity needs an approved GL journal, a configured fee rule or a reasoned exclusion. Reconciliation is prepared and reviewed by different users.',
          'আমদানি কেবল প্রমাণ, এটি কখনো পোস্ট বা স্বয়ংক্রিয় মিলকরণ করে না। প্রতিটি স্টেটমেন্ট লাইন স্পষ্টভাবে একটি উপলব্ধ পোস্টকৃত জার্নাল লাইনের সাথে মেলানো হয়; স্পষ্ট বিভাজন ছাড়া জার্নাল লাইন পুনরায় ব্যবহার করা যায় না। অস্পষ্ট লেনদেনের জন্য অনুমোদিত জিএল জার্নাল, কনফিগার করা ফি নিয়ম বা কারণসহ বাদ দেওয়া প্রয়োজন। মিলকরণ ভিন্ন ব্যবহারকারী প্রস্তুত ও পর্যালোচনা করেন।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-neutral"><ShieldCheck size={13} aria-hidden /> {L('No auto-matching', 'স্বয়ংক্রিয় মিলকরণ নেই')}</span>
            <span className="ql-badge ql-badge-warning"><TriangleAlert size={13} aria-hidden /> {L('Reviewed sign-off required', 'পর্যালোচিত স্বাক্ষর আবশ্যক')}</span>
            {selectedBank ? <span className="ql-badge ql-badge-brand">{selectedBank.name}</span> : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {banks.length === 0 ? (
        <Notice
          message={L(
            'No bank, cash or MFS account exists. Create one in company setup with an active ASSET account that uses the BANK_MFS control subledger.',
            'কোনো ব্যাংক, নগদ বা এমএফএস হিসাব নেই। কোম্পানি সেটআপে BANK_MFS নিয়ন্ত্রণ উপখতিয়াসহ একটি সক্রিয় ASSET হিসাব দিয়ে তৈরি করুন।',
          )}
          tone="warning"
        />
      ) : null}

      <section className="ql-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[280px] flex-1 text-[12px] font-semibold text-ink-600">
            {L('Bank / cash / MFS account', 'ব্যাংক / নগদ / এমএফএস হিসাব')}
            <select className="ql-select mt-1 min-h-11 w-full text-[14px]" value={selectedBankId} onChange={(event) => setSelectedBankId(event.target.value)}>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name} · {bank.kind} · {bank.glAccountCode} · {bank.status}
                </option>
              ))}
            </select>
          </label>
          {selectedBank ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-600">
              <span className="ql-badge ql-badge-neutral">{iconFor(selectedBank.kind)} {selectedBank.kind}</span>
              <span className="ql-badge ql-badge-neutral">{selectedBank.glAccountCode} · {selectedBank.glAccountName}</span>
              <span className="ql-badge ql-badge-neutral">{selectedBank.provider ?? '—'} · {selectedBank.maskedNumber ?? '—'}</span>
              {statusChip(selectedBank.status)}
              {selectedBank.status !== 'ACTIVE' ? (
                <span className="ql-badge ql-badge-danger">
                  <TriangleAlert size={12} /> {L('Inactive — history is read-only for new postings', 'নিষ্ক্রিয় — নতুন পোস্টিংয়ের জন্য ইতিহাস কেবল পঠনযোগ্য')}
                </span>
              ) : null}
            </div>
          ) : null}
          <Link to="/app/setup" className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
            <Settings2 size={15} /> {L('Manage accounts in setup', 'সেটআপে হিসাব পরিচালনা')}
          </Link>
        </div>
      </section>

      <nav className="flex flex-wrap gap-1.5" aria-label={L('Banking sections', 'ব্যাংকিং বিভাগসমূহ')}>
        {tabs
          .filter((entry) => entry.visible !== false)
          .map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setTab(entry.key);
                  setError(null);
                }}
                aria-current={tab === entry.key ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition ${
                  tab === entry.key
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-line bg-surface/70 text-ink-600 hover:border-brand/30 hover:text-ink-900'
                }`}
              >
                <Icon size={15} />
                {L(entry.en, entry.bn)}
              </button>
            );
          })}
      </nav>

      {!selectedBank || !selectedBankId ? (
        <Notice message={L('Select a bank account to continue.', 'চালিয়ে যেতে একটি ব্যাংক হিসাব নির্বাচন করুন।')} tone="warning" />
      ) : tab === 'QUEUE' ? (
        <LineWorkbenchPanel
          companyId={companyId}
          bank={selectedBank}
          accounts={accounts}
          parties={parties}
          canPost={canPost}
          canApprove={canApprove}
          canView={canViewReports}
          refreshKey={refreshKey}
          onChanged={refresh}
        />
      ) : tab === 'IMPORT' ? (
        <ImportPanel
          companyId={companyId}
          bankAccountId={selectedBank.id}
          bankName={selectedBank.name}
          canPost={canPost}
          onImported={refresh}
        />
      ) : tab === 'RECONCILIATION' ? (
        <ReconciliationPanel
          companyId={companyId}
          bankAccountId={selectedBank.id}
          bankName={selectedBank.name}
          periods={periods}
          periodId={periodId}
          onPeriodChange={setPeriodId}
          canPrepare={canPost}
          canReview={canApprove}
          canExport={canExport}
          refreshKey={refreshKey}
          onChanged={refresh}
        />
      ) : tab === 'FEES' ? (
        <FeeRulesPanel
          companyId={companyId}
          banks={banks}
          accounts={accounts}
          selectedBankId={selectedBank.id}
          canManage={canManageSettings}
          refreshKey={refreshKey}
          onChanged={refresh}
        />
      ) : tab === 'TRANSFERS' ? (
        <TransfersPanel
          companyId={companyId}
          banks={banks}
          canPost={canPost}
          canReverse={canReverse}
          refreshKey={refreshKey}
          onChanged={refresh}
        />
      ) : (
        <section className="ql-card overflow-hidden">
          <div className="ql-card-header">
            <div>
              <p className="ql-kicker">{L('Account master', 'হিসাব মাস্টার')}</p>
              <h2 className="mt-1 text-[20px] font-semibold text-ink-900">{L('Bank, cash and MFS accounts', 'ব্যাংক, নগদ ও এমএফএস হিসাব')}</h2>
            </div>
            <Link to="/app/setup" className="ql-btn ql-btn-primary min-h-11 text-[13px]">
              <Settings2 size={15} /> {L('Create or edit accounts', 'হিসাব তৈরি বা সম্পাদনা')}
            </Link>
          </div>
          <div className="border-b border-line bg-surface-2/40 px-4 py-3 text-[12px] leading-relaxed text-ink-500">
            {L(
              'Account creation, GL mapping, principal selection and deactivation live in company setup. Deactivation is refused while an account is referenced by a receipt, payment, treasury challan, imported statement, transfer or reconciliation.',
              'হিসাব তৈরি, জিএল ম্যাপিং, প্রধান হিসাব নির্বাচন ও নিষ্ক্রিয়করণ কোম্পানি সেটআপে রয়েছে। কোনো রসিদ, পরিশোধ, ট্রেজারি চালান, আমদানি করা স্টেটমেন্ট, স্থানান্তর বা মিলকরণ দ্বারা হিসাব উল্লেখ থাকলে নিষ্ক্রিয়করণ প্রত্যাখ্যান করা হয়।',
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[12px]">
              <caption className="sr-only">Bank cash and MFS accounts</caption>
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Kind / provider</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Masked number</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">GL mapping</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Opening metadata</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {banks.map((bank) => (
                  <tr key={bank.id} className={bank.status === 'ACTIVE' ? '' : 'bg-surface-2/30 text-ink-500'}>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 font-semibold text-ink-900">{iconFor(bank.kind)} {bank.name}</span>
                      {bank.isPrincipal ? <span className="mt-1 inline-block text-[12px] font-semibold text-amber-700">Principal</span> : null}
                    </td>
                    <td className="px-3 py-2.5">{bank.kind} · {bank.provider ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono">{bank.maskedNumber ?? '—'}</td>
                    <td className="px-3 py-2.5">{bank.glAccountCode} · {bank.glAccountName}</td>
                    <td className="font-money px-3 py-2.5 text-right">{bank.openingBdt}</td>
                    <td className="px-3 py-2.5">{statusChip(bank.status)}</td>
                    <td className="px-3 py-2.5">{formatDate(bank.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedPeriod && tab === 'RECONCILIATION' ? (
        <p className="text-[12px] text-ink-400">
          {L('Selected period', 'নির্বাচিত সময়কাল')}: {selectedPeriod.code} · {selectedPeriod.status}
        </p>
      ) : null}
    </div>
  );
}
