import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import {
  ENTITY_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  REPORTING_FRAMEWORK_OPTIONS,
  setupApi,
  type BankAccount,
  type CompanyProfile,
  type CompanySettings,
  type FiscalYear,
  type OnboardingStatus,
  type OpeningBatch,
  type SetupAccount,
} from '../../setup/api';
import CompanyProfileStep from './CompanyProfileStep';
import FiscalYearStep from './FiscalYearStep';
import ChartOfAccountsStep from './ChartOfAccountsStep';
import OpeningBalancesStep from './OpeningBalancesStep';
import BankAccountsStep from './BankAccountsStep';
import CompanySettingsStep from './CompanySettingsStep';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';

const EMPTY_CREATE_FORM = {
  legalName: '',
  tradeName: '',
  entityType: 'PRIVATE_LIMITED',
  industry: 'TRADING_DISTRIBUTION',
  reportingFramework: 'IFRS_FOR_SMES_BFRS',
  tin: '',
  bin: '',
  rjscNo: '',
  address: '',
  phone: '',
  email: '',
};

export default function CompanySetupPage() {
  const auth = useAuth();
  const vault = usePreferences();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const L = useCallback((en: string, bn: string): string => localized(vault.locale, en, bn), [vault.locale]);
  const company = auth.activeCompany;
  const activeCompanyIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [batches, setBatches] = useState<OpeningBatch[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [step, setStep] = useState<OnboardingStatus['currentStep']>('COMPANY');
  const [completing, setCompleting] = useState(false);

  const load = useCallback(
    async (initial: boolean): Promise<void> => {
      if (!company) {
        activeCompanyIdRef.current = null;
        setLoading(false);
        return;
      }
      const companyId = company.id;
      activeCompanyIdRef.current = companyId;
      setError(null);
      try {
        const [onboardingResponse, profileResponse, fiscalResponse, accountsResponse, batchResponse, bankResponse, settingsResponse] =
          await Promise.all([
            setupApi.onboarding(companyId),
            setupApi.profile(companyId),
            setupApi.fiscalYears(companyId),
            setupApi.accounts(companyId, { includeInactive: true }),
            setupApi.openingBatches(companyId),
            setupApi.bankAccounts(companyId),
            setupApi.settings(companyId),
          ]);
        // A company switch can complete a previous request after the newer one started. Never let
        // stale company data replace the currently selected company.
        if (activeCompanyIdRef.current !== companyId) return;
        setOnboarding(onboardingResponse.onboarding);
        setProfile(profileResponse.company);
        setFiscalYears(fiscalResponse.fiscalYears);
        setAccounts(accountsResponse.accounts);
        setBatches(batchResponse.batches);
        setBankAccounts(bankResponse.bankAccounts);
        setSettings(settingsResponse.settings);
        if (initial) {
          const requested = searchParams.get('step');
          const allowed: Array<OnboardingStatus['currentStep']> = [
            'COMPANY',
            'FISCAL_YEAR',
            'CHART_OF_ACCOUNTS',
            'OPENING_BALANCES',
            'BANK_ACCOUNTS',
            'SETTINGS',
          ];
          setStep(
            requested && (allowed as string[]).includes(requested)
              ? (requested as OnboardingStatus['currentStep'])
              : onboardingResponse.onboarding.currentStep,
          );
        }
      } catch (caught) {
        if (activeCompanyIdRef.current !== companyId) return;
        setError(apiErrorMessage(caught));
      } finally {
        if (activeCompanyIdRef.current === companyId) setLoading(false);
      }
    },
    [company, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOnboarding(null);
    setProfile(null);
    setFiscalYears([]);
    setAccounts([]);
    setBatches([]);
    setBankAccounts([]);
    setSettings(null);
    void (async () => {
      if (cancelled) return;
      await load(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    await load(false);
  }, [load]);

  const periods = useMemo(
    () =>
      fiscalYears
        .flatMap((year) => year.periods)
        .sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [fiscalYears],
  );

  const chooseStep = (next: OnboardingStatus['currentStep']): void => {
    setStep(next);
    if (!company) return;
    void setupApi.setOnboardingStep(company.id, next).catch((caught) => {
      vault.publishToast({
        tone: 'warning',
        title: L('Step not saved', 'ধাপ সংরক্ষিত হয়নি'),
        message: apiErrorMessage(caught),
      });
    });
  };

  const complete = async (): Promise<void> => {
    if (!company) return;
    setCompleting(true);
    setError(null);
    try {
      const result = await setupApi.completeOnboarding(company.id);
      setOnboarding(result.onboarding);
      vault.publishToast({
        tone: 'success',
        title: L('Company setup complete', 'কোম্পানি সেটআপ সম্পন্ন'),
        message: L(
          'The balanced opening batch remains SUBMITTED until a different approver approves and posts it from the ledger workspace. It is not marked POSTED here.',
          'সুষম উদ্বোধনী ব্যাচ ভিন্ন অনুমোদনকারী লেজার ওয়ার্কস্পেস থেকে অনুমোদন ও পোস্ট না করা পর্যন্ত SUBMITTED থাকে। এখানে এটি POSTED হিসেবে চিহ্নিত নয়।',
        ),
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setCompleting(false);
    }
  };

  if (auth.demoMode) {
    return (
      <section className="ql-card mx-auto mt-6 max-w-3xl p-6">
        <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Company setup', 'কোম্পানি সেটআপ')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L(
            'The synthetic demo is isolated. Real company onboarding requires the server-backed identity service.',
            'কৃত্রিম ডেমো আলাদা। বাস্তব কোম্পানি অনবোর্ডিংয়ের জন্য সার্ভার-ভিত্তিক পরিচয় সেবা প্রয়োজন।',
          )}
        </p>
      </section>
    );
  }

  if (!company) {
    return <CreateCompanyPage />;
  }

  if (searchParams.get('new') === '1' && auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG')) {
    return (
      <CreateCompanyPage
        onCreated={() => navigate('/app/setup', { replace: true })}
        onCancel={() => navigate('/app/setup', { replace: true })}
      />
    );
  }

  if (loading) {
    return (
      <div className="ql-card mx-auto mt-6 flex max-w-3xl items-center gap-2 p-6 text-[14px] text-ink-600">
        <Loader2 size={18} className="animate-spin text-brand-bright" />
        Loading company setup…
      </div>
    );
  }

  if (!onboarding || !profile || !settings) {
    return (
      <section className="ql-card mx-auto mt-6 max-w-3xl p-6">
        <h2 className="text-[20px] font-semibold text-ink-900">Company setup could not be loaded</h2>
        {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
        <button type="button" onClick={() => void refresh()} className="ql-btn ql-btn-secondary mt-4 min-h-11 text-[14px]">
          <RefreshCw size={15} /> Try again
        </button>
      </section>
    );
  }

  const canManageSettings = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');
  const canManageMasters = auth.hasCompanyPermission('MANAGE_MASTERS_AND_COA');
  const canPost = auth.hasCompanyPermission('POST_TO_GL');

  return (
    <div className="space-y-4">
      <section className="ql-card overflow-hidden">
        <div className="brand-gradient h-1.5 w-full" />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="brand-gradient grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lift ring-1 ring-white/20">
                <Building2 size={22} />
              </span>
              <div>
                <p className="ql-kicker flex items-center gap-1.5"><Sparkles size={12} /> {L('Server-backed onboarding', 'সার্ভার-ভিত্তিক অনবোর্ডিং')}</p>
                <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.04em] text-ink-900">{L('Company setup', 'কোম্পানি সেটআপ')}</h1>
                <p className="mt-1 text-[14px] text-ink-500">
                  {profile.legalName} · {profile.baseCurrency} · {profile.timezone}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onboarding.completedAt ? (
                <span className="ql-badge ql-badge-success text-[12px]"><CheckCircle2 size={12} /> {L('Setup complete', 'সেটআপ সম্পন্ন')}</span>
              ) : (
                <span className="ql-badge ql-badge-warn text-[12px]"><Circle size={11} /> {L('In progress', 'চলমান')}</span>
              )}
              <button type="button" onClick={() => navigate('/app')} className="ql-btn ql-btn-secondary min-h-10 text-[13px]">
                <LogOut size={15} /> {L('Save and exit', 'সংরক্ষণ করে বেরুন')}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 text-[12px] text-ink-500">
              <span>{L('Onboarding progress', 'অনবোর্ডিং অগ্রগতি')}</span>
              <span className="font-semibold text-ink-700">{onboarding.percent}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={onboarding.percent} aria-label={L('Onboarding progress', 'অনবোর্ডিং অগ্রগতি')}>
              <div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${onboarding.percent}%` }} />
            </div>
          </div>

          {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label={L('Setup steps', 'সেটআপ ধাপ')} className="ql-card h-fit p-2">
          <ol className="space-y-1">
            {onboarding.steps.map((item, index) => {
              const active = item.key === step;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => chooseStep(item.key)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
                      active
                        ? 'bg-vault-50/80 ring-1 ring-inset ring-vault-100 dark:bg-vault-500/[0.08] dark:ring-vault-500/15'
                        : 'hover:bg-ink-100/60 dark:hover:bg-white/[0.045]'
                    }`}
                  >
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${item.complete ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : active ? 'bg-vault-100 text-vault-700 dark:bg-vault-500/15 dark:text-vault-300' : 'bg-ink-100 text-ink-500 dark:bg-white/[0.06]'}`}>
                      {item.complete ? <CheckCircle2 size={14} /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                        {item.title}
                        {active ? <ChevronRight size={12} className="text-brand-bright" /> : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-500">{item.detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="ql-card min-w-0 p-5 sm:p-6">
          {step === 'COMPANY' ? (
            <CompanyProfileStep profile={profile} canManage={canManageSettings} onSaved={refresh} />
          ) : step === 'FISCAL_YEAR' ? (
            <FiscalYearStep companyId={profile.id} fiscalYears={fiscalYears} canManage={canManageSettings} onChanged={refresh} />
          ) : step === 'CHART_OF_ACCOUNTS' ? (
            <ChartOfAccountsStep
              companyId={profile.id}
              accounts={accounts}
              canManage={canManageMasters}
              onChanged={refresh}
              initialSearch={searchParams.get('account') ?? ''}
            />
          ) : step === 'OPENING_BALANCES' ? (
            <OpeningBalancesStep
              key={`${profile.id}-opening-${batches[0]?.id ?? 'new'}`}
              companyId={profile.id}
              accounts={accounts}
              periods={periods}
              batches={batches}
              canDraft={canManageMasters}
              canSubmit={canPost}
              onChanged={refresh}
            />
          ) : step === 'BANK_ACCOUNTS' ? (
            <BankAccountsStep companyId={profile.id} accounts={accounts} bankAccounts={bankAccounts} canManage={canManageSettings} onChanged={refresh} />
          ) : (
            <CompanySettingsStep companyId={profile.id} settings={settings} fiscalYears={fiscalYears} canManage={canManageSettings} onChanged={refresh} />
          )}
        </section>
      </div>

      <section className="ql-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
            <ShieldCheck size={16} className="text-emerald-500" />
            {onboarding.completedAt ? L('Onboarding completed', 'অনবোর্ডিং সম্পন্ন') : L('Complete the company setup', 'কোম্পানি সেটআপ সম্পূর্ণ করুন')}
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            {onboarding.completedAt
              ? L(
                  'The opening batch remains SUBMITTED until a different approver approves and posts it from the ledger workspace.',
                  'উদ্বোধনী ব্যাচ ভিন্ন অনুমোদনকারী লেজার ওয়ার্কস্পেস থেকে অনুমোদন ও পোস্ট না করা পর্যন্ত SUBMITTED থাকে।',
                )
              : L(
                  'Completion requires the company profile, periods, at least two active accounts, a submitted balanced opening batch, a principal bank/cash account and reviewed settings.',
                  'সম্পন্ন করতে কোম্পানি প্রোফাইল, সময়কাল, অন্তত দুটি সক্রিয় হিসাব, জমাকৃত সুষম উদ্বোধনী ব্যাচ, একটি প্রধান ব্যাংক/নগদ হিসাব এবং পর্যালোচিত সেটিংস প্রয়োজন।',
                )}
          </p>
        </div>
        {!onboarding.completedAt ? (
          <button
            type="button"
            onClick={() => void complete()}
            disabled={!onboarding.canComplete || completing}
            className="ql-btn ql-btn-primary min-h-11 text-[14px]"
            title={!onboarding.canComplete ? 'Finish all incomplete steps first.' : undefined}
          >
            {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {onboarding.canComplete ? 'Mark onboarding complete' : 'Complete the remaining steps first'}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function CreateCompanyPage({
  onCreated,
  onCancel,
}: {
  onCreated?: () => void;
  onCancel?: () => void;
} = {}) {
  const auth = useAuth();
  const vault = usePreferences();
  const L = (en: string, bn: string): string => localized(vault.locale, en, bn);
  const organisationId = auth.activeMembership?.organisationId ?? auth.memberships[0]?.organisationId;
  const canCreate =
    Boolean(organisationId) &&
    Boolean(auth.user?.emailVerified) &&
    auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') &&
    (auth.activeMembership?.role === 'OWNER' || auth.activeMembership?.role === 'ADMIN');
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);

  const set = (key: keyof typeof form, value: string): void => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!organisationId || !canCreate) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    try {
      const result = await setupApi.createCompany(organisationId, {
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
      await auth.refresh();
      await auth.selectCompany(result.company.id);
      onCreated?.();
      vault.publishToast({
        tone: 'success',
        title: L('Company created', 'কোম্পানি তৈরি হয়েছে'),
        message: L('Continue with the fiscal year, chart of accounts and opening balances.', 'চলমান থাকুন সময়কাল, হিসাবের চার্ট ও উদ্বোধনী ব্যালেন্স দিয়ে।'),
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-4xl space-y-4">
      <section className="ql-card p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="brand-gradient grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lift ring-1 ring-white/20">
            <Building2 size={22} />
          </span>
          <div>
            <p className="ql-kicker">{L('First company', 'প্রথম কোম্পানি')}</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.04em] text-ink-900">{L('Create a company', 'কোম্পানি তৈরি করুন')}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-500">
              {L(
                'Create the legal company record. The fiscal year, chart of accounts, opening balances and bank setup follow as resumable steps. Creating a second company never changes the first.',
                'আইনি কোম্পানি রেকর্ড তৈরি করুন। এরপর সময়কাল, হিসাবের চার্ট, উদ্বোধনী ব্যালেন্স ও ব্যাংক সেটআপ ধাপে ধাপে সম্পন্ন হবে। দ্বিতীয় কোম্পানি তৈরি করলে প্রথমটি পরিবর্তিত হয় না।',
              )}
            </p>
          </div>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="ql-btn ql-btn-secondary mt-5 min-h-10 text-[13px]">
            <ArrowLeft size={15} /> {L('Back to current company setup', 'বর্তমান কোম্পানি সেটআপে ফিরুন')}
          </button>
        ) : null}
      </section>

      {!canCreate ? (
        <section className="ql-card p-6">
          <Notice
            tone="warning"
            message="Only a verified organisation owner or administrator can create a company. Ask an owner to grant the required access."
          />
        </section>
      ) : (
        <form onSubmit={submit} className="ql-card space-y-4 p-6 sm:p-8">
          {error ? <ErrorBanner message={error} details={details} /> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Legal name" required>
              <input className={INPUT_CLASS} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} required maxLength={200} disabled={saving} />
            </Field>
            <Field label="Trade name">
              <input className={INPUT_CLASS} value={form.tradeName} onChange={(event) => set('tradeName', event.target.value)} maxLength={200} disabled={saving} />
            </Field>
            <Field label="Entity type" required>
              <select className={INPUT_CLASS} value={form.entityType} onChange={(event) => set('entityType', event.target.value)} disabled={saving}>
                {ENTITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Industry" required>
              <select className={INPUT_CLASS} value={form.industry} onChange={(event) => set('industry', event.target.value)} disabled={saving}>
                {INDUSTRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Reporting framework" required>
              <select className={INPUT_CLASS} value={form.reportingFramework} onChange={(event) => set('reportingFramework', event.target.value)} disabled={saving}>
                {REPORTING_FRAMEWORK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="RJSC number" hint="Optional if not registered yet.">
              <input className={INPUT_CLASS} value={form.rjscNo} onChange={(event) => set('rjscNo', event.target.value)} maxLength={64} disabled={saving} />
            </Field>
            <Field label="TIN" hint="Format check only, not statutory validation. Leave blank if not registered.">
              <input className={INPUT_CLASS} value={form.tin} onChange={(event) => set('tin', event.target.value)} maxLength={32} disabled={saving} inputMode="numeric" />
            </Field>
            <Field label="BIN" hint="Format check only, not statutory validation. Leave blank if not registered.">
              <input className={INPUT_CLASS} value={form.bin} onChange={(event) => set('bin', event.target.value)} maxLength={32} disabled={saving} />
            </Field>
            <Field label="Registered address" required>
              <textarea className={`${INPUT_CLASS} min-h-24 py-2`} value={form.address} onChange={(event) => set('address', event.target.value)} required maxLength={500} disabled={saving} />
            </Field>
            <div className="grid gap-4">
              <Field label="Contact phone" hint="At least one of phone or email is required.">
                <input className={INPUT_CLASS} value={form.phone} onChange={(event) => set('phone', event.target.value)} maxLength={32} disabled={saving} />
              </Field>
              <Field label="Contact email">
                <input className={INPUT_CLASS} type="email" value={form.email} onChange={(event) => set('email', event.target.value)} maxLength={320} disabled={saving} />
              </Field>
            </div>
          </div>
          <Notice message="Base currency is fixed to BDT and the company time zone to Asia/Dhaka in this release. TIN/BIN/RJSC format checks do not claim registry verification." />
          <button type="submit" disabled={saving} className="ql-btn ql-btn-primary min-h-11 text-[14px]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />}
            Create company and start onboarding
          </button>
        </form>
      )}
    </div>
  );
}
