import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Landmark,
  Package,
  Receipt,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Users,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { formatCount, formatDate } from '../../core/money';
import { setupApi, type BankAccount, type FiscalPeriod, type FiscalYear } from '../../setup/api';
import { salesApi } from '../../sales/api';
import { purchaseApi } from '../../purchases/api';
import { reportsApi, type VatReturnDraft } from '../../reports/api';
import { closeApi, type CloseRun } from '../../close/api';
import { bankingApi } from '../../banking/api';
import { ledgerApi } from '../../ledger/api';
import { PageHeader } from '../../shell/PageHeader';
import {
  computeCashPosition,
  computeOverdue,
  fiscalYearStartFor,
  pickCurrentPeriod,
  type CashPosition,
  type OverdueSummary,
} from './dashboardData';

interface DashboardSnapshot {
  period: FiscalPeriod | null;
  fiscalYears: FiscalYear[];
  salesDrafts: number | null;
  purchaseDrafts: number | null;
  cash: CashPosition | null;
  bankAccountCount: number | null;
  receivables: OverdueSummary | null;
  payables: OverdueSummary | null;
  arProofAgrees: boolean | null;
  apProofAgrees: boolean | null;
  vat: {
    netPayablePoisha: bigint;
    exceptions: number;
    zeroVariance: boolean;
    reviewStatus: string;
  } | null;
  closeRun: CloseRun | null;
  closeBlockers: number;
  approvals: {
    payments: number;
    journals: number;
    closeRuns: number;
    total: number;
  } | null;
  unmatchedBankLines: number | null;
  suspenseItems: number | null;
  warnings: string[];
}

type AttentionTone = 'danger' | 'warning' | 'info' | 'success';

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: AttentionTone;
  count?: number;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function DashboardPage() {
  const auth = useAuth();
  const { locale, money, numeralScript } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const role = company?.role ?? null;
  const canViewReports = auth.hasCompanyPermission('VIEW_REPORTS');
  const canReadDocs =
    auth.hasCompanyPermission('CREATE_COMMERCIAL_DRAFT') ||
    canViewReports ||
    auth.hasCompanyPermission('VIEW_LIMITED_REPORTS');
  const canCreate = auth.hasCompanyPermission('CREATE_COMMERCIAL_DRAFT');
  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');
  const canManageSettings = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');
  const canSubmitClose = auth.hasCompanyPermission('SUBMIT_CLOSE_MAKER');

  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFatalError(null);
    const warnings: string[] = [];
    const optional = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
      try {
        return await promise;
      } catch (error) {
        warnings.push(`${label}: ${errorText(error, L('request failed', 'অনুরোধ ব্যর্থ'))}`);
        return null;
      }
    };

    try {
      const [periodsResponse, fiscalYearsResponse] = await Promise.all([
        optional(L('periods', 'হিসাবকাল'), setupApi.periods(companyId)),
        optional(L('fiscal years', 'অর্থবছর'), setupApi.fiscalYears(companyId)),
      ]);
      const periods = periodsResponse?.periods ?? [];
      const fiscalYears = fiscalYearsResponse?.fiscalYears ?? [];
      const period = pickCurrentPeriod(periods, todayIso());
      const fiscalYearStart = fiscalYearStartFor(fiscalYears, period, todayIso());

      const [
        draftsResponse,
        purchasesResponse,
        arResponse,
        apResponse,
        vatResponse,
        closeResponse,
        suspenseResponse,
        bankResponse,
        trialResponse,
        paymentApprovalsResponse,
        submittedJournalsResponse,
      ] = await Promise.all([
        canReadDocs
          ? optional(L('sales drafts', 'বিক্রয় খসড়া'), salesApi.documents(companyId, { status: 'DRAFT', limit: 1 }))
          : Promise.resolve(null),
        canReadDocs
          ? optional(L('purchase drafts', 'ক্রয় খসড়া'), purchaseApi.documents(companyId, { status: 'DRAFT', limit: 1 }))
          : Promise.resolve(null),
        canViewReports
          ? optional(L('receivables ageing', 'প্রাপ্য এজিং'), salesApi.ageing(companyId, todayIso()))
          : Promise.resolve(null),
        canViewReports
          ? optional(L('payables ageing', 'প্রদেয় এজিং'), purchaseApi.apAgeing(companyId, todayIso()))
          : Promise.resolve(null),
        canViewReports && period
          ? optional(L('VAT draft', 'ভ্যাট খসড়া'), reportsApi.run<VatReturnDraft>(companyId, 'VAT_RETURN_DRAFT', { periodId: period.id }))
          : Promise.resolve(null),
        canViewReports && period
          ? optional(L('close status', 'সমাপনী অবস্থা'), closeApi.list(companyId, period.id))
          : Promise.resolve(null),
        canViewReports
          ? optional(L('suspense', 'সাসপেন্স'), closeApi.suspense(companyId))
          : Promise.resolve(null),
        canViewReports
          ? optional(L('bank accounts', 'ব্যাংক হিসাব'), setupApi.bankAccounts(companyId))
          : Promise.resolve(null),
        canViewReports && fiscalYearStart
          ? optional(L('trial balance', 'রেওয়ামিল'), ledgerApi.trialBalance(companyId, { from: fiscalYearStart, to: todayIso() }))
          : Promise.resolve(null),
        canApprove
          ? optional(
              L('payment approvals', 'পরিশোধ অনুমোদন'),
              purchaseApi.paymentApprovals(companyId, { status: 'PENDING', limit: 1 }),
            )
          : Promise.resolve(null),
        canViewReports
          ? optional(
              L('submitted journals', 'জমাকৃত জার্নাল'),
              ledgerApi.journals(companyId, { status: 'SUBMITTED', limit: 1 }),
            )
          : Promise.resolve(null),
      ]);

      const bankAccounts: BankAccount[] = bankResponse?.bankAccounts ?? [];
      let unmatchedBankLines: number | null = null;
      if (canViewReports && bankAccounts.length > 0) {
        const active = bankAccounts.filter((account) => account.status === 'ACTIVE');
        const lineResults = await Promise.all(
          active.map((account) =>
            optional(
              `${L('bank lines', 'ব্যাংক লাইন')} · ${account.name}`,
              bankingApi.lines(companyId, account.id, { status: 'UNMATCHED', limit: 1 }),
            ),
          ),
        );
        if (lineResults.every((result) => result !== null)) {
          unmatchedBankLines = lineResults.reduce((total, result) => total + (result?.total ?? 0), 0);
        }
      }

      const closeRuns = closeResponse?.closeRuns ?? [];
      const closeRun = [...closeRuns].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
      const closeBlockers = closeRun
        ? closeRun.checks.filter((check) => check.applicable && check.blocking && !check.passed).length
        : 0;
      const closeSubmitted = closeRuns.filter((run) => run.status === 'SUBMITTED').length;
      const paymentsPending = paymentApprovalsResponse?.total ?? 0;
      const journalsSubmitted = submittedJournalsResponse?.total ?? 0;
      const approvals =
        canApprove || canViewReports
          ? {
              payments: canApprove ? paymentsPending : 0,
              journals: journalsSubmitted,
              closeRuns: closeSubmitted,
              total: (canApprove ? paymentsPending : 0) + journalsSubmitted + closeSubmitted,
            }
          : null;

      // A cash total is only meaningful when the trial balance loaded. Showing zero because the
      // balance request failed would be a false financial statement.
      const cash =
        bankResponse && bankAccounts.length > 0
          ? trialResponse
            ? computeCashPosition(bankAccounts, trialResponse.trialBalance)
            : null
          : null;

      setData({
        period,
        fiscalYears,
        salesDrafts: draftsResponse?.total ?? null,
        purchaseDrafts: purchasesResponse?.total ?? null,
        cash,
        bankAccountCount: bankResponse ? bankAccounts.length : null,
        receivables: arResponse ? computeOverdue(arResponse.ageing.rows) : null,
        payables: apResponse ? computeOverdue(apResponse.ageing.rows) : null,
        arProofAgrees: arResponse ? arResponse.ageing.proof.agrees : null,
        apProofAgrees: apResponse ? apResponse.ageing.proof.agrees : null,
        vat: vatResponse
          ? {
              netPayablePoisha: BigInt(vatResponse.report.totals.netPayablePoisha),
              exceptions: vatResponse.report.exceptions.length,
              zeroVariance: vatResponse.report.zeroVariance,
              reviewStatus: vatResponse.report.reviewStatus,
            }
          : null,
        closeRun,
        closeBlockers,
        approvals,
        unmatchedBankLines,
        suspenseItems: suspenseResponse ? suspenseResponse.suspense.items.length : null,
        warnings,
      });
    } catch (error) {
      setFatalError(errorText(error, L('The dashboard could not be loaded.', 'ড্যাশবোর্ড লোড করা যায়নি।')));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [L, canApprove, canReadDocs, canViewReports, companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    if (!data) return [];
    const items: AttentionItem[] = [];
    if (data.salesDrafts !== null && data.salesDrafts > 0) {
      items.push({
        key: 'sales-drafts',
        title: L('Sales drafts to finish', 'সম্পন্ন করার জন্য বিক্রয় খসড়া'),
        detail: L(
          `${formatCount(data.salesDrafts, numeralScript)} draft invoice or credit note is not posted.`,
          `${formatCount(data.salesDrafts, numeralScript)}টি খসড়া চালান বা ক্রেডিট নোট পোস্ট হয়নি।`,
        ),
        href: '/app/sales?tab=INVOICES',
        tone: 'info',
        count: data.salesDrafts,
      });
    }
    if (data.purchaseDrafts !== null && data.purchaseDrafts > 0) {
      items.push({
        key: 'purchase-drafts',
        title: L('Purchase drafts to finish', 'সম্পন্ন করার জন্য ক্রয় খসড়া'),
        detail: L(
          `${formatCount(data.purchaseDrafts, numeralScript)} bill or expense voucher is not posted.`,
          `${formatCount(data.purchaseDrafts, numeralScript)}টি বিল বা ব্যয় ভাউচার পোস্ট হয়নি।`,
        ),
        href: '/app/purchases?tab=BILLS',
        tone: 'info',
        count: data.purchaseDrafts,
      });
    }
    if (data.approvals && data.approvals.total > 0) {
      items.push({
        key: 'approvals',
        title: canApprove ? L('Waiting for your approval', 'আপনার অনুমোদনের অপেক্ষায়') : L('Waiting for approval', 'অনুমোদনের অপেক্ষায়'),
        detail: L(
          `${formatCount(data.approvals.total, numeralScript)} item(s): ${formatCount(data.approvals.payments, numeralScript)} payment(s), ${formatCount(data.approvals.journals, numeralScript)} journal(s), ${formatCount(data.approvals.closeRuns, numeralScript)} close run(s).`,
          `${formatCount(data.approvals.total, numeralScript)}টি আইটেম: ${formatCount(data.approvals.payments, numeralScript)}টি পরিশোধ, ${formatCount(data.approvals.journals, numeralScript)}টি জার্নাল, ${formatCount(data.approvals.closeRuns, numeralScript)}টি সমাপনী রান।`,
        ),
        href: data.approvals.payments > 0 ? '/app/purchases?tab=PAYMENTS' : data.approvals.closeRuns > 0 ? '/app/close' : '/app/ledger',
        tone: 'warning',
        count: data.approvals.total,
      });
    }
    if (data.closeBlockers > 0) {
      items.push({
        key: 'close-blockers',
        title: L('Period close is blocked', 'হিসাবকাল সমাপনী বন্ধ আছে'),
        detail: L(
          `${formatCount(data.closeBlockers, numeralScript)} blocking control(s) must be resolved before the period can lock.`,
          `হিসাবকাল লক করার আগে ${formatCount(data.closeBlockers, numeralScript)}টি বাধাদানকারী নিয়ন্ত্রণ সমাধান করতে হবে।`,
        ),
        href: '/app/close',
        tone: 'danger',
        count: data.closeBlockers,
      });
    }
    if (data.unmatchedBankLines !== null && data.unmatchedBankLines > 0) {
      items.push({
        key: 'bank-lines',
        title: L('Bank statement lines unmatched', 'ব্যাংক স্টেটমেন্ট লাইন অমিল'),
        detail: L(
          `${formatCount(data.unmatchedBankLines, numeralScript)} imported line(s) have no reviewed match or exclusion.`,
          `${formatCount(data.unmatchedBankLines, numeralScript)}টি আমদানি করা লাইনে পর্যালোচিত মিল বা বাদ নেই।`,
        ),
        href: '/app/banking',
        tone: 'warning',
        count: data.unmatchedBankLines,
      });
    }
    if (data.suspenseItems !== null && data.suspenseItems > 0) {
      items.push({
        key: 'suspense',
        title: L('Suspense items need an owner', 'সাসপেন্স আইটেমের দায়িত্বপ্রাপ্ত ব্যক্তি প্রয়োজন'),
        detail: L(
          `${formatCount(data.suspenseItems, numeralScript)} unresolved suspense line(s). Only an approved linked journal can clear them.`,
          `${formatCount(data.suspenseItems, numeralScript)}টি অমীমাংসিত সাসপেন্স লাইন। শুধুমাত্র অনুমোদিত সংযুক্ত জার্নাল দিয়ে সমাধান করা যায়।`,
        ),
        href: '/app/close',
        tone: 'danger',
        count: data.suspenseItems,
      });
    }
    if (data.arProofAgrees === false) {
      items.push({
        key: 'ar-proof',
        title: L('Receivables control does not agree', 'প্রাপ্য নিয়ন্ত্রণ মিলছে না'),
        detail: L('The AR subledger and the control account differ. Do not close the period until resolved.', 'এআর উপখতিয়ান ও নিয়ন্ত্রণ হিসাবের মধ্যে পার্থক্য আছে। সমাধান না হওয়া পর্যন্ত হিসাবকাল বন্ধ করবেন না।'),
        href: '/app/sales?tab=AGEING',
        tone: 'danger',
      });
    }
    if (data.apProofAgrees === false) {
      items.push({
        key: 'ap-proof',
        title: L('Payables control does not agree', 'প্রদেয় নিয়ন্ত্রণ মিলছে না'),
        detail: L('The AP subledger and the control account differ. Do not close the period until resolved.', 'এপি উপখতিয়ান ও নিয়ন্ত্রণ হিসাবের মধ্যে পার্থক্য আছে। সমাধান না হওয়া পর্যন্ত হিসাবকাল বন্ধ করবেন না।'),
        href: '/app/purchases?tab=AGEING',
        tone: 'danger',
      });
    }
    if (data.vat && (data.vat.exceptions > 0 || !data.vat.zeroVariance)) {
      items.push({
        key: 'vat-exceptions',
        title: L('VAT draft has exceptions', 'ভ্যাট খসড়ায় ব্যতিক্রম আছে'),
        detail: L(
          `${formatCount(data.vat.exceptions, numeralScript)} exception(s); the draft and GL ${data.vat.zeroVariance ? 'agree' : 'do not agree'}.`,
          `${formatCount(data.vat.exceptions, numeralScript)}টি ব্যতিক্রম; খসড়া ও জিএল ${data.vat.zeroVariance ? 'মিলেছে' : 'মেলেনি'}।`,
        ),
        href: '/app/reports?report=VAT_RETURN_DRAFT',
        tone: 'warning',
        count: data.vat.exceptions,
      });
    }
    return items;
  }, [L, canApprove, data, numeralScript]);

  const todayFormatted = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale === 'bn-BD' ? 'bn-BD' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
        .format(new Date())
        .toUpperCase();
    } catch {
      return todayIso();
    }
  }, [locale]);

  const periodLabel = data?.period
    ? `${data.period.label || data.period.code} · ${formatDate(data.period.startDate, locale)} – ${formatDate(data.period.endDate, locale)}`
    : L('No accounting period configured', 'কোনো হিসাবকাল নির্ধারিত নেই');

  if (!company) {
    return (
      <>
        <PageHeader
          title={L('Home', 'হোম')}
          description={L(
            'Your account is signed in, but no company is assigned to this membership.',
            'আপনার অ্যাকাউন্ট সাইন ইন করা, তবে এই সদস্যপদে কোনো কোম্পানি নির্ধারিত নেই।',
          )}
        />
        <section className="rounded-ql border border-ql-border bg-ql-surface p-5">
          <h2 className="text-[18px] font-semibold text-ql-ink">{L('No company access yet', 'এখনও কোম্পানি প্রবেশাধিকার নেই')}</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-ql-ink-muted">
            {L(
              'Ask an organisation owner or administrator to grant company access, or create/configure a company if you have the permission.',
              'প্রতিষ্ঠানের মালিক বা প্রশাসককে কোম্পানি প্রবেশাধিকার দিতে বলুন, অথবা অনুমতি থাকলে কোম্পানি তৈরি/কনফিগার করুন।',
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') ? (
              <Link to="/app/team" className="ql-btn ql-btn-primary">
                <Users size={16} aria-hidden /> {L('Manage team access', 'টিম প্রবেশাধিকার পরিচালনা')}
              </Link>
            ) : null}
            {auth.hasOrganisationPermission('MANAGE_USERS_AND_ORG') || auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS') ? (
              <Link to="/app/setup?new=1" className="ql-btn ql-btn-secondary">
                <FileText size={16} aria-hidden /> {L('Create or configure a company', 'কোম্পানি তৈরি বা কনফিগার করুন')}
              </Link>
            ) : null}
          </div>
        </section>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title={L('Home', 'হোম')}
          description={L('Checking the company position and the work waiting for you.', 'কোম্পানির অবস্থা ও আপনার অপেক্ষমাণ কাজ দেখা হচ্ছে।')}
          meta={<span className="ql-badge ql-badge-neutral">{company.legalName}</span>}
        />
        <div role="status" aria-live="polite" className="space-y-4">
          <span className="sr-only">{L('Loading dashboard', 'ড্যাশবোর্ড লোড হচ্ছে')}</span>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="rounded-ql border border-ql-border bg-ql-surface p-4">
                <div className="ql-skeleton h-3 w-24" />
                <div className="ql-skeleton mt-3 h-7 w-32" />
                <div className="ql-skeleton mt-3 h-3 w-full" />
              </div>
            ))}
          </div>
          <div className="ql-skeleton h-64 w-full rounded-ql" />
        </div>
      </>
    );
  }

  const vatDue = data?.vat ? data.vat.netPayablePoisha : null;
  const cashValue = data?.cash ? money(data.cash.totalPoisha) : null;
  const arValue = data?.receivables ? money(data.receivables.overduePoisha) : null;
  const apValue = data?.payables ? money(data.payables.overduePoisha) : null;

  const firstName = auth.user?.name ? auth.user.name.split(' ')[0] : null;
  const greeting = (
    <span className="inline-flex items-center gap-2">
      <span>{firstName ? L(`Good day, ${firstName}`, `সুপ্রভাত, ${firstName}`) : L('Home', 'হোম')}</span>
      <Sun className="shrink-0 text-amber-500" size={24} aria-hidden />
    </span>
  );

  return (
    <>
      <PageHeader
        eyebrow={todayFormatted}
        title={greeting}
        description={L(
          'A server-derived view of cash, open items, tax, approvals and close readiness for the selected company and period.',
          'নির্বাচিত কোম্পানি ও হিসাবকালের নগদ, খোলা আইটেম, কর, অনুমোদন ও সমাপনী প্রস্তুতির সার্ভার-ভিত্তিক সারসংক্ষেপ।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand font-semibold">{company.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{periodLabel}</span>
            {data?.period ? (
              <span
                className={`ql-badge ${
                  data.period.status === 'OPEN'
                    ? 'ql-badge-success'
                    : data.period.status === 'CLOSED'
                      ? 'ql-badge-warning'
                      : 'ql-badge-danger'
                }`}
              >
                {L(
                  data.period.status === 'OPEN' ? 'Period open' : data.period.status === 'CLOSED' ? 'Period closed' : 'Period locked',
                  data.period.status === 'OPEN' ? 'হিসাবকাল খোলা' : data.period.status === 'CLOSED' ? 'হিসাবকাল বন্ধ' : 'হিসাবকাল লক',
                )}
              </span>
            ) : null}
            {role ? (
              <span className="text-[13px]">
                {L('Role', 'ভূমিকা')}: {role}
              </span>
            ) : null}
            {role === 'AUDITOR' ? (
              <span className="ql-badge ql-badge-info">
                <ShieldCheck size={13} aria-hidden /> {L('Read-only evidence view', 'শুধু পাঠযোগ্য প্রমাণ দৃশ্য')}
              </span>
            ) : null}
          </>
        }
        actions={
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="ql-btn ql-btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden /> {L('Refresh', 'রিফ্রেশ')}
          </button>
        }
      />

      {fatalError ? (
        <div role="alert" className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-ql border border-ql-danger/30 bg-ql-danger-soft px-4 py-3 text-[13px] text-ql-ink">
          <span className="flex items-start gap-2">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-ql-danger" aria-hidden />
            <span>{fatalError}</span>
          </span>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="ql-btn ql-btn-sm ql-btn-secondary">
            {L('Try again', 'আবার চেষ্টা করুন')}
          </button>
        </div>
      ) : null}

      {data && data.warnings.length > 0 ? (
        <div role="status" className="mb-4 rounded-ql border border-ql-warning/35 bg-ql-warning-soft px-4 py-3 text-[13px] text-ql-ink">
          <p className="flex items-center gap-2 font-semibold text-ql-warning">
            <AlertTriangle size={16} aria-hidden /> {L('Some figures could not be loaded', 'কিছু সংখ্যা লোড করা যায়নি')}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-ql-ink-muted">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!data?.period ? (
        <div role="status" className="mb-4 rounded-ql border border-ql-warning/35 bg-ql-warning-soft px-4 py-3 text-[13px]">
          <p className="flex items-center gap-2 font-semibold text-ql-warning">
            <CalendarDays size={16} aria-hidden /> {L('No accounting period is configured for today', 'আজকের জন্য কোনো হিসাবকাল নির্ধারিত নেই')}
          </p>
          <p className="mt-1 text-ql-ink-muted">
            {L(
              'Posting is blocked until a fiscal year and periods exist. Complete company setup before entering transactions.',
              'অর্থবছর ও হিসাবকাল তৈরি না হওয়া পর্যন্ত পোস্টিং বন্ধ থাকবে। লেনদেন শুরুর আগে কোম্পানি সেটআপ সম্পন্ন করুন।',
            )}
          </p>
          {canManageSettings ? (
            <Link to="/app/setup" className="ql-btn ql-btn-sm ql-btn-secondary mt-2">
              {L('Open company setup', 'কোম্পানি সেটআপ খুলুন')} <ArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="dashboard-kpis" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <h2 id="dashboard-kpis" className="sr-only">
          {L('Key figures', 'প্রধান সংখ্যা')}
        </h2>
        <KpiCard
          label={L('Cash and bank', 'নগদ ও ব্যাংক')}
          value={cashValue}
          hint={
            data?.cash
              ? L(
                  `${formatCount(data.cash.entries.length, numeralScript)} account(s), closing GL balance.`,
                  `${formatCount(data.cash.entries.length, numeralScript)}টি হিসাব, সমাপনী জিএল ব্যালেন্স।`,
                )
              : L('Add a bank, cash or MFS account and post activity to see the balance.', 'ব্যালেন্স দেখতে ব্যাংক, নগদ বা এমএফএস হিসাব যোগ করে লেনদেন পোস্ট করুন।')
          }
          href="/app/banking"
          linkLabel={L('Open banking', 'ব্যাংকিং খুলুন')}
          icon={Banknote}
          tone="success"
          notAvailable={L('Not available', 'উপলব্ধ নয়')}
        />
        <KpiCard
          label={L('Overdue receivables', 'মেয়াদোত্তীর্ণ প্রাপ্য')}
          value={arValue}
          hint={
            data?.receivables
              ? L(
                  `${formatCount(data.receivables.overdueCount, numeralScript)} overdue of ${formatCount(data.receivables.openCount, numeralScript)} open invoice(s).`,
                  `${formatCount(data.receivables.openCount, numeralScript)}টি খোলা চালানের মধ্যে ${formatCount(data.receivables.overdueCount, numeralScript)}টি মেয়াদোত্তীর্ণ।`,
                )
              : L('Receivables ageing is not available for your role or could not be loaded.', 'আপনার ভূমিকার জন্য প্রাপ্য এজিং উপলব্ধ নয় বা লোড করা যায়নি।')
          }
          href="/app/sales?tab=AGEING"
          linkLabel={L('Review receivables', 'প্রাপ্য পর্যালোচনা')}
          icon={Receipt}
          tone={data?.receivables && data.receivables.overduePoisha > 0n ? 'warning' : 'neutral'}
          notAvailable={L('Not available', 'উপলব্ধ নয়')}
        />
        <KpiCard
          label={L('Overdue payables', 'মেয়াদোত্তীর্ণ প্রদেয়')}
          value={apValue}
          hint={
            data?.payables
              ? L(
                  `${formatCount(data.payables.overdueCount, numeralScript)} overdue of ${formatCount(data.payables.openCount, numeralScript)} open bill(s).`,
                  `${formatCount(data.payables.openCount, numeralScript)}টি খোলা বিলের মধ্যে ${formatCount(data.payables.overdueCount, numeralScript)}টি মেয়াদোত্তীর্ণ।`,
                )
              : L('Payables ageing is not available for your role or could not be loaded.', 'আপনার ভূমিকার জন্য প্রদেয় এজিং উপলব্ধ নয় বা লোড করা যায়নি।')
          }
          href="/app/purchases?tab=AGEING"
          linkLabel={L('Review payables', 'প্রদেয় পর্যালোচনা')}
          icon={ShoppingCart}
          tone={data?.payables && data.payables.overduePoisha > 0n ? 'warning' : 'neutral'}
          notAvailable={L('Not available', 'উপলব্ধ নয়')}
        />
        <KpiCard
          label={L('Net VAT payable', 'নিট প্রদেয় ভ্যাট')}
          value={vatDue === null ? null : vatDue === 0n ? money(0n) : money(vatDue, { sign: true })}
          hint={
            data?.vat
              ? L(
                  `Internal draft · ${data.vat.zeroVariance ? 'GL agrees' : 'GL does not agree'} · ${formatCount(data.vat.exceptions, numeralScript)} exception(s).`,
                  `অভ্যন্তরীণ খসড়া · ${data.vat.zeroVariance ? 'জিএল মিলেছে' : 'জিএল মেলেনি'} · ${formatCount(data.vat.exceptions, numeralScript)}টি ব্যতিক্রম।`,
                )
              : L('Select a period with VAT activity. Outputs remain drafts for professional review.', 'ভ্যাট কার্যক্রমসহ হিসাবকাল নির্বাচন করুন। আউটপুট পেশাদার পর্যালোচনার জন্য খসড়া থাকে।')
          }
          href="/app/reports?report=VAT_RETURN_DRAFT"
          linkLabel={L('Open VAT draft', 'ভ্যাট খসড়া খুলুন')}
          icon={FileText}
          tone={data?.vat && !data.vat.zeroVariance ? 'warning' : 'neutral'}
          notAvailable={L('Not available', 'উপলব্ধ নয়')}
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section aria-labelledby="needs-attention" className="overflow-hidden rounded-2xl border border-ql-border bg-ql-surface shadow-[0_2px_12px_rgba(8,45,88,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ql-border px-4 py-3">
            <div>
              <h2 id="needs-attention" className="text-[16px] font-bold text-ql-ink">
                {L('Needs attention', 'মনোযোগ প্রয়োজন')}
              </h2>
              <p className="text-[12px] text-ql-ink-muted">
                {L('Exceptions and unfinished work from the server records.', 'সার্ভার রেকর্ড থেকে ব্যতিক্রম ও অসম্পূর্ণ কাজ।')}
              </p>
            </div>
            <span className="ql-badge ql-badge-neutral">
              {formatCount(attentionItems.length, numeralScript)} {L('item(s)', 'আইটেম')}
            </span>
          </div>
          {attentionItems.length === 0 ? (
            <div className="flex items-start gap-3 px-4 py-6">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ql-success" aria-hidden />
              <div>
                <p className="text-[14px] font-semibold text-ql-ink">{L('Nothing outstanding in the loaded checks', 'লোড করা যাচাইয়ে কিছু বাকি নেই')}</p>
                <p className="mt-1 text-[13px] leading-6 text-ql-ink-muted">
                  {L(
                    'Control proofs agree and no draft, unmatched bank line, suspense item or blocking close check was found. Continue with the next action below.',
                    'নিয়ন্ত্রণ প্রমাণ মিলেছে এবং কোনো খসড়া, অমিল ব্যাংক লাইন, সাসপেন্স আইটেম বা বাধাদানকারী সমাপনী যাচাই পাওয়া যায়নি। নিচের পরবর্তী কাজ চালিয়ে যান।',
                  )}
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-ql-border">
              {attentionItems.map((item) => (
                <li key={item.key}>
                  <Link
                    to={item.href}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ql-surface-muted/60 focus-visible:bg-ql-surface-muted"
                  >
                    <AttentionIcon tone={item.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-ql-ink">{item.title}</span>
                        {item.count !== undefined ? (
                          <span className={`ql-badge ${item.tone === 'danger' ? 'ql-badge-danger' : item.tone === 'warning' ? 'ql-badge-warning' : 'ql-badge-neutral'}`}>
                            {formatCount(item.count, numeralScript)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-5 text-ql-ink-muted">{item.detail}</span>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-ql-ink-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <section aria-labelledby="quick-actions" className="rounded-2xl border border-ql-border bg-ql-surface p-4 shadow-[0_2px_12px_rgba(8,45,88,0.03)]">
            <h2 id="quick-actions" className="text-[16px] font-bold text-ql-ink">
              {L('Quick actions', 'দ্রুত কাজ')}
            </h2>
            <p className="mt-0.5 text-[12px] text-ql-ink-muted">
              {role === 'AUDITOR'
                ? L('Read-only shortcuts to evidence and reports.', 'প্রমাণ ও রিপোর্টের শুধু পাঠযোগ্য শর্টকাট।')
                : L('Only actions your company role can perform on the server are shown.', 'শুধুমাত্র আপনার কোম্পানি ভূমিকা সার্ভারে যে কাজ করতে পারে তা দেখানো হয়।')}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {canCreate ? (
                <QuickAction to="/app/sales?new=1" icon={FilePlus2} label={L('New sales invoice', 'নতুন বিক্রয় চালান')} />
              ) : null}
              {canCreate ? (
                <QuickAction to="/app/purchases?new=1" icon={ShoppingCart} label={L('Record a purchase bill', 'ক্রয় বিল লিপিবদ্ধ করুন')} />
              ) : null}
              {canPost ? (
                <QuickAction to="/app/sales?tab=RECEIPTS" icon={Receipt} label={L('Record a customer receipt', 'গ্রাহকের প্রাপ্তি লিপিবদ্ধ করুন')} />
              ) : null}
              {canPost ? (
                <QuickAction to="/app/purchases?tab=PAYMENTS" icon={Landmark} label={L('Pay a supplier', 'সরবরাহকারীকে পরিশোধ করুন')} />
              ) : null}
              {canPost ? (
                <QuickAction to="/app/ledger?tab=NEW" icon={BookOpen} label={L('Post a general journal', 'সাধারণ জার্নাল পোস্ট করুন')} />
              ) : null}
              {canSubmitClose ? (
                <QuickAction to="/app/close" icon={ClipboardCheck} label={L('Prepare the period close', 'হিসাবকাল সমাপনী প্রস্তুত করুন')} />
              ) : null}
              {canViewReports ? (
                <QuickAction to="/app/reports" icon={FileText} label={L('Open management reports', 'ব্যবস্থাপনা রিপোর্ট খুলুন')} />
              ) : null}
              <QuickAction to="/app/audit" icon={ShieldCheck} label={L('Open the audit log', 'অডিট লগ খুলুন')} />
              <QuickAction to="/app/inventory" icon={Package} label={L('Check stock and valuation', 'স্টক ও মূল্যায়ন দেখুন')} />
            </div>
          </section>

          <section aria-labelledby="close-status" className="rounded-2xl border border-ql-border bg-ql-surface p-4 shadow-[0_2px_12px_rgba(8,45,88,0.03)]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="close-status" className="text-[16px] font-bold text-ql-ink">
                  {L('Close readiness', 'সমাপনী প্রস্তুতি')}
                </h2>
                <p className="mt-0.5 text-[12px] text-ql-ink-muted">{periodLabel}</p>
              </div>
              {data?.closeRun ? (
                <span
                  className={`ql-badge ${
                    data.closeRun.status === 'APPROVED'
                      ? 'ql-badge-success'
                      : data.closeRun.status === 'REJECTED'
                        ? 'ql-badge-danger'
                        : data.closeRun.status === 'SUBMITTED'
                          ? 'ql-badge-warning'
                          : 'ql-badge-neutral'
                  }`}
                >
                  {data.closeRun.status}
                </span>
              ) : (
                <span className="ql-badge ql-badge-neutral">{L('No close run', 'কোনো সমাপনী রান নেই')}</span>
              )}
            </div>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ql-ink-muted">{L('Blocking checks', 'বাধাদানকারী যাচাই')}</dt>
                <dd className="font-semibold text-ql-ink">{data?.closeBlockers ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ql-ink-muted">{L('Latest run', 'সর্বশেষ রান')}</dt>
                <dd className="font-semibold text-ql-ink">
                  {data?.closeRun ? formatDate(data.closeRun.createdAt.slice(0, 10), locale) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ql-ink-muted">{L('Period status', 'হিসাবকাল অবস্থা')}</dt>
                <dd className="font-semibold text-ql-ink">{data?.period?.status ?? '—'}</dd>
              </div>
            </dl>
            <Link to="/app/close" className="ql-btn ql-btn-secondary mt-3 w-full text-[13px]">
              {canSubmitClose || canApprove ? L('Open close & controls', 'সমাপনী ও নিয়ন্ত্রণ খুলুন') : L('View close evidence', 'সমাপনী প্রমাণ দেখুন')}
              <ArrowRight size={14} aria-hidden />
            </Link>
          </section>
        </div>
      </div>

      {data?.cash && data.cash.entries.length > 0 ? (
        <section aria-labelledby="cash-breakdown" className="mt-4 overflow-hidden rounded-2xl border border-ql-border bg-ql-surface shadow-[0_2px_12px_rgba(8,45,88,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ql-border px-4 py-3">
            <h2 id="cash-breakdown" className="text-[16px] font-bold text-ql-ink">
              {L('Cash and bank accounts', 'নগদ ও ব্যাংক হিসাব')}
            </h2>
            <Link to="/app/banking" className="text-[13px] font-semibold text-ql-accent hover:underline">
              {L('Reconcile accounts', 'হিসাব মিলান')}
            </Link>
          </div>
          <ul className="divide-y divide-ql-border">
            {data.cash.entries.slice(0, 8).map((entry) => (
              <li key={entry.glAccountId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] transition-colors hover:bg-ql-surface-muted/40">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="ql-badge ql-badge-neutral">{entry.kind}</span>
                  <span className="truncate font-semibold text-ql-ink">{entry.name}</span>
                </span>
                <span className="ql-money font-bold text-ql-ink">{money(entry.balancePoisha)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-4 text-[12px] leading-5 text-ql-ink-muted">
        {L(
          'Figures are derived from posted journals and open items for the selected company. Management accounts and VAT schedules remain unaudited drafts until professional review.',
          'সংখ্যাগুলো নির্বাচিত কোম্পানির পোস্টকৃত জার্নাল ও খোলা আইটেম থেকে তৈরি। পেশাদার পর্যালোচনা পর্যন্ত ব্যবস্থাপনা হিসাব ও ভ্যাট সূচি নিরীক্ষিত খসড়া থাকে।',
        )}
      </p>
    </>
  );
}

function KpiCard({
  label,
  value,
  hint,
  href,
  linkLabel,
  icon: Icon,
  tone,
  notAvailable,
}: {
  label: string;
  value: string | null;
  hint: string;
  href: string;
  linkLabel: string;
  icon: typeof Banknote;
  tone: 'neutral' | 'warning' | 'success';
  notAvailable: string;
}) {
  const valueTone = tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-ql-ink';
  const iconTone =
    tone === 'warning'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : tone === 'success'
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'bg-ql-accent/10 text-ql-accent';

  return (
    <article className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-ql-border bg-ql-surface p-5 shadow-[0_2px_10px_rgba(8,45,88,0.03)] transition-all duration-300 hover:-translate-y-1 hover:border-ql-accent/40 hover:shadow-[0_12px_28px_rgba(8,45,88,0.08)]">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-ql-accent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ql-ink-muted">{label}</h3>
          <span className={`grid h-8 w-8 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${iconTone}`}>
            <Icon size={16} aria-hidden />
          </span>
        </div>
        <p className={`mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.03em] ${valueTone}`}>
          {value ?? <span className="text-[17px] font-normal text-ql-ink-subtle">{notAvailable}</span>}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-ql-ink-muted">{hint}</p>
      </div>
      <Link to={href} className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-bold text-ql-accent transition-colors hover:text-ql-brand hover:underline">
        <span>{linkLabel}</span>
        <ArrowRight size={13} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </article>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: typeof FilePlus2; label: string }) {
  return (
    <Link
      to={to}
      className="group flex min-h-11 items-center gap-2.5 rounded-xl border border-ql-border bg-ql-surface px-3.5 py-2 text-[13px] font-medium text-ql-ink transition-all hover:-translate-y-0.5 hover:border-ql-accent/40 hover:bg-ql-surface-muted/50 hover:shadow-sm"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ql-accent/10 text-ql-accent transition-colors group-hover:bg-ql-accent group-hover:text-white">
        <Icon size={14} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ArrowRight size={13} className="shrink-0 text-ql-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ql-accent" aria-hidden />
    </Link>
  );
}

function AttentionIcon({ tone }: { tone: AttentionTone }) {
  if (tone === 'danger') {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
        <AlertTriangle size={16} aria-hidden />
      </span>
    );
  }
  if (tone === 'warning') {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
        <AlertTriangle size={16} aria-hidden />
      </span>
    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400">
      <FileText size={16} aria-hidden />
    </span>
  );
}
