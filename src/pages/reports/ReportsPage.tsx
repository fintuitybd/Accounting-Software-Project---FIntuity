import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { downloadSpreadsheetFromCsv } from '../../core/import-export/xlsxEngine';
import {
  Banknote,
  BookOpen,
  CalendarRange,
  FileSpreadsheet,
  FileText,
  Landmark,
  Printer,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldCheck,
  Table2,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { formatDate } from '../../core/money';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type SetupAccount } from '../../setup/api';
import {
  reportsApi,
  type AgeingReport,
  type BalanceSheetReport,
  type CashFlowReport,
  type ChangesInEquityReport,
  type GeneralLedgerReport,
  type JournalListingReport,
  type ProfitAndLossReport,
  type ReportCatalog,
  type ReportEnvelope,
  type ReportKey,
  type ReportQuery,
  type StockValuation,
  type TrialBalanceReport,
  type VatRegisterReport,
  type VatReturnDraft,
  type WithholdingRegister,
} from '../../reports/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { ReportAmount, CheckList, ExceptionList, SectionTable, TemplateBadge, ReportEmpty } from './reportUi';
import { ReportPrintModal } from './ReportPrintModal';
import { JournalEvidenceModal } from './JournalEvidenceModal';
import { WithholdingReturnPage } from './WithholdingReturnPage';
import { StatementDrillDownDrawer } from './StatementDrillDownDrawer';
import { formatDate as formatLedgerDate } from '../ledger/ledgerUi';

type TabKey =
  | 'PROFIT_AND_LOSS'
  | 'BALANCE_SHEET'
  | 'CASH_FLOW'
  | 'CHANGES_IN_EQUITY'
  | 'TRIAL_BALANCE'
  | 'GENERAL_LEDGER'
  | 'AR_AGEING'
  | 'AP_AGEING'
  | 'STOCK_VALUATION'
  | 'VAT_SALES_REGISTER'
  | 'VAT_PURCHASE_REGISTER'
  | 'VAT_RETURN_DRAFT'
  | 'WITHHOLDING_REGISTER'
  | 'SECTION_177_RETURN'
  | 'JOURNAL_LISTING';

type Preset = 'MONTH' | 'QUARTER' | 'YTD' | 'YEAR' | 'CUSTOM';

const TABS: Array<{ key: TabKey; en: string; bn: string; icon: typeof FileText; group: 'Statements' | 'Registers' | 'Audit' }> = [
  { key: 'PROFIT_AND_LOSS', en: 'Profit or loss', bn: 'মুনাফা বা ক্ষতি', icon: TrendingUp, group: 'Statements' },
  { key: 'BALANCE_SHEET', en: 'Financial position', bn: 'আর্থিক অবস্থান', icon: Landmark, group: 'Statements' },
  { key: 'CASH_FLOW', en: 'Cash flows', bn: 'নগদ প্রবাহ', icon: Banknote, group: 'Statements' },
  { key: 'CHANGES_IN_EQUITY', en: 'Changes in equity', bn: 'ইকুইটির পরিবর্তন', icon: Scale, group: 'Statements' },
  { key: 'TRIAL_BALANCE', en: 'Trial balance', bn: 'রেওয়ামিল', icon: Table2, group: 'Statements' },
  { key: 'GENERAL_LEDGER', en: 'GL detail', bn: 'জিএল বিবরণ', icon: BookOpen, group: 'Statements' },
  { key: 'AR_AGEING', en: 'Receivables ageing', bn: 'প্রাপ্য এজিং', icon: CalendarRange, group: 'Registers' },
  { key: 'AP_AGEING', en: 'Payables ageing', bn: 'প্রদেয় এজিং', icon: CalendarRange, group: 'Registers' },
  { key: 'STOCK_VALUATION', en: 'Stock valuation', bn: 'স্টক মূল্যায়ন', icon: FileSpreadsheet, group: 'Registers' },
  { key: 'VAT_SALES_REGISTER', en: 'VAT sales register', bn: 'ভ্যাট বিক্রয় রেজিস্টার', icon: FileText, group: 'Registers' },
  { key: 'VAT_PURCHASE_REGISTER', en: 'VAT purchase register', bn: 'ভ্যাট ক্রয় রেজিস্টার', icon: FileText, group: 'Registers' },
  { key: 'VAT_RETURN_DRAFT', en: 'VAT 9.1 draft', bn: 'ভ্যাট ৯.১ খসড়া', icon: ShieldCheck, group: 'Registers' },
  { key: 'WITHHOLDING_REGISTER', en: 'VDS/TDS register', bn: 'ভিডিএস/টিডিএস রেজিস্টার', icon: ScrollText, group: 'Registers' },
  { key: 'SECTION_177_RETURN', en: 'Sec 177 TDS Return', bn: 'সেকশন ১৭৭ রিটার্ন', icon: ShieldCheck, group: 'Registers' },
  { key: 'JOURNAL_LISTING', en: 'Journal listing', bn: 'জার্নাল তালিকা', icon: BookOpen, group: 'Audit' },
];

const AS_OF_TABS = new Set<TabKey>(['BALANCE_SHEET', 'AR_AGEING', 'AP_AGEING', 'STOCK_VALUATION']);
const TAB_KEYS = new Set<TabKey>(TABS.map((entry) => entry.key));

function tabFromQuery(value: string | null): TabKey | null {
  return value && TAB_KEYS.has(value as TabKey) ? (value as TabKey) : null;
}

function reportKey(tab: TabKey): ReportKey {
  if (tab === 'SECTION_177_RETURN') return 'WITHHOLDING_REGISTER';
  return tab as ReportKey;
}

function presetLabel(preset: Preset, locale: 'en-BD' | 'bn-BD'): string {
  const labels: Record<Preset, [string, string]> = {
    MONTH: ['Month', 'মাস'],
    QUARTER: ['Quarter', 'ত্রৈমাসিক'],
    YTD: ['Year to date', 'বছরের শুরু থেকে'],
    YEAR: ['Fiscal year', 'অর্থবছর'],
    CUSTOM: ['Custom range', 'কাস্টম পরিসর'],
  };
  return localized(locale, labels[preset][0], labels[preset][1]);
}

export default function ReportsPage() {
  const auth = useAuth();
  const { locale, money } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const companyId = auth.activeCompany?.id ?? '';

  const [searchParams] = useSearchParams();
  const requestedTab = tabFromQuery(searchParams.get('report'));
  const [catalog, setCatalog] = useState<ReportCatalog | null>(null);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(requestedTab ?? 'PROFIT_AND_LOSS');
  const [preset, setPreset] = useState<Preset>('MONTH');
  const [branchId, setBranchId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState('');
  const [comparativePeriodId, setComparativePeriodId] = useState('');
  const [glAccountId, setGlAccountId] = useState('');
  const [report, setReport] = useState<ReportEnvelope | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printReport, setPrintReport] = useState<ReportEnvelope | null>(null);
  const [evidenceJournalId, setEvidenceJournalId] = useState<string | null>(null);
  const [drillDownTarget, setDrillDownTarget] = useState<{
    noteRef?: string;
    accountCode?: string;
    accountId?: string;
    title?: string;
  } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab]);

  const selectedPeriod = useMemo(
    () => catalog?.periods.find((period) => period.id === periodId) ?? null,
    [catalog, periodId],
  );
  const selectedFiscalYear = useMemo(
    () => catalog?.fiscalYears.find((year) => year.id === selectedPeriod?.fiscalYearId) ?? null,
    [catalog, selectedPeriod],
  );

  useEffect(() => {
    if (!companyId) return;
    if (auth.demoMode) {
      setLoadingCatalog(false);
      return;
    }
    let cancelled = false;
    setLoadingCatalog(true);
    setError(null);
    void Promise.all([reportsApi.catalog(companyId), setupApi.accounts(companyId)])
      .then(([catalogResponse, accountResponse]) => {
        if (cancelled) return;
        setCatalog(catalogResponse.catalog);
        setAccounts(accountResponse.accounts);
        const periods = [...catalogResponse.catalog.periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
        const latest = periods[periods.length - 1];
        if (latest) {
          setPeriodId(latest.id);
          setFrom(latest.startDate);
          setTo(latest.endDate);
          setAsOf(latest.endDate);
          const previous = periods[periods.length - 2];
          setComparativePeriodId(previous?.id ?? '');
        }
        const firstAccount = accountResponse.accounts.find((account) => account.isActive);
        if (firstAccount) setGlAccountId(firstAccount.id);
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.demoMode, companyId]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setAsOf(selectedPeriod.endDate);
    if (preset === 'CUSTOM') return;
    const periodsInYear = catalog?.periods.filter(
      (period) =>
        period.fiscalYearId === selectedPeriod.fiscalYearId &&
        period.endDate <= selectedPeriod.endDate,
    ) ?? [];
    if (preset === 'MONTH') {
      setFrom(selectedPeriod.startDate);
      setTo(selectedPeriod.endDate);
    } else if (preset === 'QUARTER') {
      const start = periodsInYear.length >= 3 ? periodsInYear[periodsInYear.length - 3] : periodsInYear[0];
      setFrom(start?.startDate ?? selectedPeriod.startDate);
      setTo(selectedPeriod.endDate);
    } else if (preset === 'YTD') {
      setFrom(selectedFiscalYear?.startDate ?? selectedPeriod.startDate);
      setTo(selectedPeriod.endDate);
    } else if (preset === 'YEAR') {
      setFrom(selectedFiscalYear?.startDate ?? selectedPeriod.startDate);
      setTo(selectedFiscalYear?.endDate ?? selectedPeriod.endDate);
    }
    const periodsSorted = [...(catalog?.periods ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const index = periodsSorted.findIndex((period) => period.id === selectedPeriod.id);
    setComparativePeriodId(index > 0 ? periodsSorted[index - 1]!.id : '');
  }, [catalog, preset, selectedFiscalYear, selectedPeriod]);

  const buildQuery = useCallback((): ReportQuery => {
    const query: ReportQuery = {};
    if (branchId) query.branchId = branchId;
    if (AS_OF_TABS.has(tab)) {
      if (periodId) query.periodId = periodId;
      if (asOf) query.asOf = asOf;
      if (comparativePeriodId) query.comparativePeriodId = comparativePeriodId;
    } else if (preset === 'CUSTOM') {
      if (from) query.from = from;
      if (to) query.to = to;
      if (comparativePeriodId) query.comparativePeriodId = comparativePeriodId;
    } else {
      if (periodId) query.periodId = periodId;
      if (comparativePeriodId && ['PROFIT_AND_LOSS', 'CASH_FLOW', 'CHANGES_IN_EQUITY'].includes(tab)) {
        query.comparativePeriodId = comparativePeriodId;
      }
    }
    if (tab === 'VAT_SALES_REGISTER' || tab === 'VAT_PURCHASE_REGISTER') {
      query.page = page;
      query.pageSize = 100;
    }
    if (tab === 'JOURNAL_LISTING') {
      query.limit = 100;
      query.offset = (page - 1) * 100;
    }
    return query;
  }, [asOf, branchId, comparativePeriodId, from, page, periodId, preset, tab, to]);

  const loadReport = useCallback(async () => {
    if (!companyId) return;
    if (tab === 'SECTION_177_RETURN') return;
    if (!periodId && !from && !to && !asOf) return;
    if (tab === 'GENERAL_LEDGER' && !glAccountId) {
      setReportError(L('Choose an account before loading the general-ledger detail.', 'জিএল বিবরণ লোড করার আগে একটি হিসাব নির্বাচন করুন।'));
      return;
    }
    setLoadingReport(true);
    setReportError(null);
    setStatusMessage(null);
    try {
      const response = await reportsApi.run<ReportEnvelope>(companyId, reportKey(tab), buildQuery(), tab === 'GENERAL_LEDGER' ? glAccountId : undefined);
      setReport(response.report);
    } catch (caught) {
      setReport(null);
      setReportError(apiErrorMessage(caught));
    } finally {
      setLoadingReport(false);
    }
  }, [buildQuery, companyId, glAccountId, L, tab]);

  useEffect(() => {
    void loadReport();
    // The report is intentionally reloaded when the tab or scope changes; the query is derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, periodId, branchId, preset, glAccountId, page]);

  const canExport = report?.canExport === true;
  const failedChecks = report?.checks.filter((check) => check.blocksExport && !check.passed) ?? [];

  const reportExportQuery = (current: ReportEnvelope): ReportQuery => {
    const query: ReportQuery = {};
    if (current.scope.branchScope === 'UNASSIGNED') query.branchId = 'UNASSIGNED';
    else if (current.scope.branchId) query.branchId = current.scope.branchId;
    if (current.scope.periodId) query.periodId = current.scope.periodId;
    else if (current.scope.from && current.scope.to) {
      query.from = current.scope.from;
      query.to = current.scope.to;
    }
    if (current.scope.asOf) query.asOf = current.scope.asOf;
    if (current.scope.comparativeFrom && current.scope.comparativeTo) {
      query.comparativeFrom = current.scope.comparativeFrom;
      query.comparativeTo = current.scope.comparativeTo;
    }
    if (current.scope.comparativeAsOf) query.comparativeAsOf = current.scope.comparativeAsOf;
    if (tab === 'GENERAL_LEDGER') query.accountId = (current as GeneralLedgerReport).accountId;
    return query;
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = async () => {
    if (!report) return;
    try {
      const response = await reportsApi.exportCsv(companyId, reportKey(tab), reportExportQuery(report));
      download(new Blob([response.text], { type: 'text/csv;charset=utf-8' }), response.filename ?? `${tab.toLowerCase()}.csv`);
      setStatusMessage(L('CSV exported from the same server report used on screen.', 'স্ক্রিনে ব্যবহৃত একই সার্ভার রিপোর্ট থেকে সিএসভি রপ্তানি হয়েছে।'));
    } catch (caught) {
      setReportError(apiErrorMessage(caught));
    }
  };

  const exportXlsx = async () => {
    if (!report) return;
    try {
      // Audit-gate first: the server re-runs the report and refuses if a blocking check fails.
      await reportsApi.auditExport(companyId, {
        reportKey: reportKey(tab),
        format: 'XLSX',
        periodId: report.scope.periodId ?? undefined,
        from: report.scope.from ?? undefined,
        to: report.scope.to ?? undefined,
        asOf: report.scope.asOf ?? undefined,
        comparativeFrom: report.scope.comparativeFrom ?? undefined,
        comparativeTo: report.scope.comparativeTo ?? undefined,
        comparativeAsOf: report.scope.comparativeAsOf ?? undefined,
        branchId:
          report.scope.branchScope === 'UNASSIGNED'
            ? 'UNASSIGNED'
            : report.scope.branchId ?? undefined,
        accountId: tab === 'GENERAL_LEDGER' ? (report as GeneralLedgerReport).accountId : undefined,
        rowCount: 0,
      });
      const response = await reportsApi.exportCsv(companyId, reportKey(tab), reportExportQuery(report));
      const base = (response.filename ?? `${tab.toLowerCase()}.csv`).replace(/\.csv$/i, '');
      downloadSpreadsheetFromCsv(`${base}.xlsx`, response.text);
      setStatusMessage(L('XLSX exported from the same server report and audited.', 'একই সার্ভার রিপোর্ট থেকে এক্সএলএসএক্স রপ্তানি ও অডিট হয়েছে।'));
    } catch (caught) {
      setReportError(apiErrorMessage(caught));
    }
  };

  const openPrint = () => {
    if (!report) return;
    setPrintReport(report);
    setPrintOpen(true);
  };

  const auditPrint = async (format: 'PRINT' | 'PDF'): Promise<boolean> => {
    if (!report) return false;
    try {
      await reportsApi.auditExport(companyId, {
        reportKey: reportKey(tab),
        format,
        periodId: report.scope.periodId ?? undefined,
        from: report.scope.from ?? undefined,
        to: report.scope.to ?? undefined,
        asOf: report.scope.asOf ?? undefined,
        comparativeFrom: report.scope.comparativeFrom ?? undefined,
        comparativeTo: report.scope.comparativeTo ?? undefined,
        comparativeAsOf: report.scope.comparativeAsOf ?? undefined,
        branchId:
          report.scope.branchScope === 'UNASSIGNED'
            ? 'UNASSIGNED'
            : report.scope.branchId ?? undefined,
        accountId: tab === 'GENERAL_LEDGER' ? (report as GeneralLedgerReport).accountId : undefined,
      });
      return true;
    } catch (caught) {
      setReportError(apiErrorMessage(caught));
      return false;
    }
  };

  if (!auth.activeCompany) {
    return <Notice message={L('Select an active company to use reports.', 'রিপোর্ট ব্যবহার করতে একটি সক্রিয় কোম্পানি নির্বাচন করুন।')} tone="warning" />;
  }

  if (auth.demoMode) {
    return (
      <div className="space-y-4">
        <header className="lv-card p-4 sm:p-6">
          <p className="lv-kicker">{L('Management reporting', 'ব্যবস্থাপনা প্রতিবেদন')}</p>
          <h1 className="mt-1 text-[27px] font-semibold leading-tight tracking-[-0.03em] text-ink-900">
            {L('Reports, VAT registers and financial statements', 'রিপোর্ট, ভ্যাট রেজিস্টার ও আর্থিক বিবরণী')}
          </h1>
          <span className="lv-chip lv-chip-gold mt-3 inline-flex">{L('Management accounts — unaudited', 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়')}</span>
        </header>
        <Notice
          message={L(
            'The reports workspace is server-backed. This isolated synthetic demo does not call the real report API; use the demo workspaces for synthetic statement and register previews.',
            'রিপোর্ট ওয়ার্কস্পেস সার্ভার-ভিত্তিক। এই বিচ্ছিন্ন সিন্থেটিক ডেমো প্রকৃত রিপোর্ট এপিআই কল করে না; সিন্থেটিক বিবরণী ও রেজিস্টার প্রিভিউয়ের জন্য ডেমো ওয়ার্কস্পেস ব্যবহার করুন।',
          )}
          tone="warning"
        />
      </div>
    );
  }

  if (loadingCatalog) {
    return (
      <div className="space-y-4">
        <header className="lv-card p-4 sm:p-6">
          <p className="lv-kicker">{L('Management reporting', 'ব্যবস্থাপনা প্রতিবেদন')}</p>
          <h1 className="mt-1 text-[27px] font-semibold leading-tight tracking-[-0.03em] text-ink-900">
            {L('Reports, VAT registers and financial statements', 'রিপোর্ট, ভ্যাট রেজিস্টার ও আর্থিক বিবরণী')}
          </h1>
          <p className="mt-2 max-w-4xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Every figure is derived from posted journals and posted documents. Management accounts are unaudited; the VAT return is an internal draft and is never filed from this screen.',
              'প্রতিটি সংখ্যা পোস্টকৃত জার্নাল ও ডকুমেন্ট থেকে তৈরি। ব্যবস্থাপনা হিসাব নিরীক্ষিত নয়; ভ্যাট রিটার্ন অভ্যন্তরীণ খসড়া এবং এই স্ক্রিন থেকে কখনো দাখিল হয় না।',
            )}
          </p>
          <span className="lv-chip lv-chip-gold mt-3 inline-flex">{L('Management accounts — unaudited', 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়')}</span>
        </header>
        <Notice message={L('Loading report definitions and periods…', 'রিপোর্ট সংজ্ঞা ও সময়কাল লোড হচ্ছে…')} tone="info" />
      </div>
    );
  }

  if (error || !catalog) {
    return <ErrorBanner message={error ?? L('The report catalog could not be loaded.', 'রিপোর্ট ক্যাটালগ লোড করা যায়নি।')} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Management reporting', 'ব্যবস্থাপনা প্রতিবেদন')}
        title={L('Reports, VAT registers and financial statements', 'রিপোর্ট, ভ্যাট রেজিস্টার ও আর্থিক বিবরণী')}
        description={L(
          'Every figure is derived from posted journals and posted documents for the selected company, branch and period. Management accounts are unaudited; the VAT return is an internal draft and is never filed from this screen.',
          'প্রতিটি সংখ্যা নির্বাচিত কোম্পানি, শাখা ও সময়কালের পোস্টকৃত জার্নাল ও ডকুমেন্ট থেকে তৈরি। ব্যবস্থাপনা হিসাব নিরীক্ষিত নয়; ভ্যাট রিটার্ন অভ্যন্তরীণ খসড়া এবং এই স্ক্রিন থেকে কখনো দাখিল হয় না।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-warning">{L('Management accounts — unaudited', 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়')}</span>
            <span className="ql-badge ql-badge-brand">{catalog.company.legalName}</span>
          </>
        }
      />

      <section className="lv-card p-4 sm:p-6">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Branch scope', 'শাখার পরিসর')}
            <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }} className="lv-select mt-1 min-h-11 w-full text-[13px]">
              <option value="">{L('All branches', 'সব শাখা')}</option>
              <option value="UNASSIGNED">{L('Unassigned journals/documents', 'অনির্ধারিত জার্নাল/ডকুমেন্ট')}</option>
              {catalog.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Accounting period', 'হিসাবকাল')}
            <select value={periodId} onChange={(event) => { setPeriodId(event.target.value); setPage(1); }} className="lv-select mt-1 min-h-11 w-full text-[13px]">
              {catalog.periods.map((period) => (
                <option key={period.id} value={period.id}>{period.code} — {period.status}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Range preset', 'পরিসরের ধরন')}
            <select value={preset} onChange={(event) => { setPreset(event.target.value as Preset); setPage(1); }} className="lv-select mt-1 min-h-11 w-full text-[13px]">
              {(['MONTH', 'QUARTER', 'YTD', 'YEAR', 'CUSTOM'] as Preset[]).map((entry) => (
                <option key={entry} value={entry}>{presetLabel(entry, locale)}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('Comparative', 'তুলনামূলক')}
            <select value={comparativePeriodId} onChange={(event) => setComparativePeriodId(event.target.value)} className="lv-select mt-1 min-h-11 w-full text-[13px]">
              <option value="">{L('No comparative', 'তুলনামূলক নয়')}</option>
              {catalog.periods.map((period) => (
                <option key={period.id} value={period.id}>{period.code}</option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('From', 'থেকে')}
            <input type="date" value={from} onChange={(event) => { setPreset('CUSTOM'); setFrom(event.target.value); setPage(1); }} className={`${INPUT_CLASS} mt-1`} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-600">
            {L('To', 'পর্যন্ত')}
            <input type="date" value={to} onChange={(event) => { setPreset('CUSTOM'); setTo(event.target.value); setPage(1); }} className={`${INPUT_CLASS} mt-1`} />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void loadReport()} disabled={loadingReport} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <RefreshCw size={14} className={loadingReport ? 'animate-spin' : ''} /> {L('Apply scope', 'পরিসর প্রয়োগ')}
          </button>
          <span className="text-[12px] text-ink-500">
            {L('The report uses the selected period, comparative and branch scope. No fixed date is applied.', 'রিপোর্ট নির্বাচিত সময়কাল, তুলনামূলক ও শাখার পরিসর ব্যবহার করে। কোনো নির্দিষ্ট তারিখ প্রয়োগ হয় না।')}
          </span>
        </div>

        {AS_OF_TABS.has(tab) ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('As-of date', 'তারিখ অনুযায়ী')}
              <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className={`${INPUT_CLASS} mt-1`} />
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => void loadReport()} disabled={loadingReport} className="lv-btn lv-btn-secondary min-h-11 w-full text-[13px]">
                <RefreshCw size={14} className={loadingReport ? 'animate-spin' : ''} /> {L('Apply scope', 'পরিসর প্রয়োগ')}
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'GENERAL_LEDGER' ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Account', 'হিসাব')}
              <select value={glAccountId} onChange={(event) => setGlAccountId(event.target.value)} className="lv-select mt-1 min-h-11 w-full text-[13px]">
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => void loadReport()} disabled={loadingReport} className="lv-btn lv-btn-secondary min-h-11 w-full text-[13px]">
                <RefreshCw size={14} className={loadingReport ? 'animate-spin' : ''} /> {L('Load ledger detail', 'খাতা বিবরণ লোড')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-1.5">
        {(['Statements', 'Registers', 'Audit'] as const).map((group) => (
          <div key={group} className="flex flex-wrap gap-1.5">
            {TABS.filter((entry) => entry.group === group).map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => { setReport(null); setTab(entry.key); setPage(1); }}
                  className={`lv-btn min-h-11 text-[13px] ${tab === entry.key ? 'lv-btn-primary' : 'lv-btn-secondary'}`}
                  aria-pressed={tab === entry.key}
                >
                  <Icon size={14} /> {localized(locale, entry.en, entry.bn)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {reportError ? <ErrorBanner message={reportError} /> : null}
      {statusMessage ? <Notice message={statusMessage} tone="info" /> : null}
      {loadingReport ? <Notice message={L('Loading the report from posted journals…', 'পোস্টকৃত জার্নাল থেকে রিপোর্ট লোড হচ্ছে…')} tone="info" /> : null}

      {tab === 'SECTION_177_RETURN' ? (
        <WithholdingReturnPage />
      ) : report ? (
        <section className="lv-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <TemplateBadge template={report.template} locale={locale} />
                <span className={`lv-chip ${report.canExport ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                  {report.canExport ? <ShieldCheck size={12} /> : <TriangleAlert size={12} />}
                  {report.canExport ? L('Export checks passed', 'রপ্তানি পরীক্ষা উত্তীর্ণ') : L('Export blocked', 'রপ্তানি বন্ধ')}
                </span>
              </div>
              <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.025em] text-ink-900">
                {localized(locale, report.titleEn, report.titleBn)}
              </h2>
              <p className="mt-1 text-[12px] text-ink-500">
                {report.scope.companyName}
                {report.scope.branchName ? ` · ${report.scope.branchName}` : report.scope.branchScope === 'UNASSIGNED' ? ` · ${L('Unassigned', 'অনির্ধারিত')}` : ` · ${L('All branches', 'সব শাখা')}`}
                {' · '}{localized(locale, report.scope.labelEn, report.scope.labelBn)}
                {report.scope.comparativeLabelEn ? ` · ${L('Comparative', 'তুলনামূলক')}: ${localized(locale, report.scope.comparativeLabelEn, report.scope.comparativeLabelBn ?? report.scope.comparativeLabelEn)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => void exportCsv()} disabled={!canExport || loadingReport} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                <FileText size={14} /> {L('CSV', 'সিএসভি')}
              </button>
              <button type="button" onClick={() => void exportXlsx()} disabled={!canExport || loadingReport} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                <FileSpreadsheet size={14} /> {L('XLSX', 'এক্সএলএসএক্স')}
              </button>
              <button type="button" onClick={openPrint} disabled={!canExport || loadingReport} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
                <Printer size={14} /> {L('Print / PDF', 'প্রিন্ট / পিডিএফ')}
              </button>
            </div>
          </div>

          {!canExport ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-[12px] text-rose-900">
              <p className="flex items-start gap-1.5 font-semibold">
                <TriangleAlert size={13} className="mt-0.5" />
                {L('Export is blocked until every blocking control check passes.', 'প্রতিটি বাধ্যতামূলক নিয়ন্ত্রণ পরীক্ষা উত্তীর্ণ না হওয়া পর্যন্ত রপ্তানি বন্ধ থাকে।')}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {failedChecks.map((check) => (
                  <li key={check.key}>{localized(locale, check.labelEn, check.labelBn)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4">
            <CheckList checks={report.checks} locale={locale} />
          </div>

          <div className="mt-5">
            <ReportBody
              tab={tab}
              report={report}
              locale={locale}
              money={money}
              page={page}
              onPage={setPage}
              accounts={accounts}
              onDrillAccount={(accountId) => {
                setGlAccountId(accountId);
                setTab('GENERAL_LEDGER');
              }}
              onOpenJournal={(journalId) => setEvidenceJournalId(journalId)}
              onDrillDown={(target) => setDrillDownTarget(target)}
            />
          </div>

          <p className="mt-5 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-500">
            {report.template.labelEn === 'Management accounts — unaudited'
              ? L('Management accounts — unaudited. No audit opinion is expressed or implied. Report definitions are pending accountant sign-off.', 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়। কোনো নিরীক্ষা মতামত প্রকাশ বা ইঙ্গিত করা হয় না। রিপোর্টের সংজ্ঞা হিসাবরক্ষকের অনুমোদনের অপেক্ষায়।')
              : L(report.template.labelEn, report.template.labelBn)}
            {' '}{L('Template', 'টেমপ্লেট')}: {report.template.version} · {L('Generated', 'তৈরি')}: {new Date(report.generatedAt).toLocaleString(locale === 'bn-BD' ? 'bn-BD' : 'en-GB')}
          </p>
        </section>
      ) : null}

      {printOpen && printReport ? (
        <ReportPrintModal
          open={printOpen}
          report={printReport}
          reportKey={reportKey(tab)}
          locale={locale}
          money={money}
          onClose={() => setPrintOpen(false)}
          onPrint={(format) => auditPrint(format)}
        />
      ) : null}

      <JournalEvidenceModal
        companyId={companyId}
        journalId={evidenceJournalId}
        locale={locale}
        money={money}
        onClose={() => setEvidenceJournalId(null)}
      />

      {drillDownTarget ? (
        <StatementDrillDownDrawer
          companyId={companyId}
          target={drillDownTarget}
          period={{
            from: from || (periodId ? (selectedPeriod?.startDate ?? '2026-01-01') : '2026-01-01'),
            to: to || (periodId ? (selectedPeriod?.endDate ?? '2026-12-31') : '2026-12-31'),
          }}
          onClose={() => setDrillDownTarget(null)}
        />
      ) : null}
    </div>
  );
}

function ReportBody({
  tab,
  report,
  locale,
  money,
  page,
  onPage,
  accounts,
  onDrillAccount,
  onOpenJournal,
  onDrillDown,
}: {
  tab: TabKey;
  report: ReportEnvelope;
  locale: 'en-BD' | 'bn-BD';
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  page: number;
  onPage: (page: number) => void;
  accounts: SetupAccount[];
  onDrillAccount: (accountId: string) => void;
  onOpenJournal: (journalId: string) => void;
  onDrillDown?: (target: { noteRef?: string; accountCode?: string; accountId?: string; title?: string }) => void;
}) {
  const L = (en: string, bn: string) => localized(locale, en, bn);
  if (tab === 'PROFIT_AND_LOSS' || tab === 'BALANCE_SHEET' || tab === 'CASH_FLOW') {
    const statement = report as ProfitAndLossReport | BalanceSheetReport | CashFlowReport;
    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {statementTotals(tab, statement, locale).map((entry) => (
            <div key={entry.labelEn} className="rounded-xl border border-line bg-surface-2/30 p-3">
              <p className="text-[12px] text-ink-400">{L(entry.labelEn, entry.labelBn)}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{money(BigInt(entry.value))}</p>
            </div>
          ))}
        </div>
        {statement.sections.map((section) => (
          <SectionTable
            key={section.key}
            section={section}
            locale={locale}
            money={money}
            currentLabel={L('Current', 'চলতি')}
            comparativeLabel={L('Comparative', 'তুলনামূলক')}
            onDrillAccount={onDrillAccount}
            onDrillDown={onDrillDown}
          />
        ))}
        {tab === 'CASH_FLOW' ? (
          <div className="rounded-xl border border-line bg-surface-2/30 p-3 text-[12px] text-ink-600">
            {L('Opening cash', 'প্রারম্ভিক নগদ')}: {money(BigInt((statement as CashFlowReport).openingCashPoisha))} ·{' '}
            {L('Net change', 'নিট পরিবর্তন')}: {money(BigInt((statement as CashFlowReport).netChangePoisha))} ·{' '}
            {L('Closing cash', 'সমাপনী নগদ')}: {money(BigInt((statement as CashFlowReport).closingCashPoisha))}
            <span className="ml-2 text-ink-400">{L('Cash accounts', 'নগদ হিসাব')}: {(statement as CashFlowReport).cashAccountCodes.join(', ') || L('none configured', 'কনফিগার করা নেই')}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (tab === 'CHANGES_IN_EQUITY') {
    const equity = report as ChangesInEquityReport;
    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[900px] text-[12px]">
            <caption className="sr-only">{L('Statement of changes in equity', 'ইকুইটির পরিবর্তনের বিবরণী')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Movement', 'চলাচল')}</th>
                <th scope="col" className="text-right">{L('Share capital', 'শেয়ার মূলধন')}</th>
                <th scope="col" className="text-right">{L('Retained earnings', 'সঞ্চিত মুনাফা')}</th>
                <th scope="col" className="text-right">{L('Reserves', 'সঞ্চিতি')}</th>
                <th scope="col" className="text-right">{L('Total', 'মোট')}</th>
                <th scope="col" className="text-right">{L('Comparative', 'তুলনামূলক')}</th>
              </tr>
            </thead>
            <tbody>
              {equity.rows.map((row) => (
                <tr key={row.key} className={row.kind === 'CLOSING' ? 'font-semibold' : ''}>
                  <td>{L(row.labelEn, row.labelBn)}</td>
                  <td className="text-right"><ReportAmount value={row.shareCapitalPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={row.retainedEarningsPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={row.reservesPoisha} money={money} /></td>
                  <td className="text-right font-semibold"><ReportAmount value={row.totalPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={row.comparativeTotalPoisha} money={money} muted /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [L('Opening equity', 'প্রারম্ভিক ইকুইটি'), equity.openingEquityPoisha],
            [L('Profit for period', 'সময়কালের মুনাফা'), equity.profitForPeriodPoisha],
            [L('Owner/other movements', 'মালিক/অন্যান্য চলাচল'), equity.ownerMovementsPoisha],
            [L('Closing equity', 'সমাপনী ইকুইটি'), equity.closingEquityPoisha],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-surface-2/30 p-3">
              <p className="text-[12px] text-ink-400">{label}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{money(BigInt(value))}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'TRIAL_BALANCE') {
    const trial = report as TrialBalanceReport;
    return (
      <div className="overflow-x-auto">
        <table className="lv-table w-full min-w-[1000px] text-[12px]">
          <caption className="sr-only">{L('Trial balance by account', 'হিসাব অনুযায়ী রেওয়ামিল')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{L('Code', 'কোড')}</th>
              <th scope="col" className="text-left">{L('Account', 'হিসাব')}</th>
              <th scope="col" className="text-right">{L('Opening Dr', 'উদ্বোধনী ডেবিট')}</th>
              <th scope="col" className="text-right">{L('Opening Cr', 'উদ্বোধনী ক্রেডিট')}</th>
              <th scope="col" className="text-right">{L('Period Dr', 'মেয়াদ ডেবিট')}</th>
              <th scope="col" className="text-right">{L('Period Cr', 'মেয়াদ ক্রেডিট')}</th>
              <th scope="col" className="text-right">{L('Closing Dr', 'সমাপনী ডেবিট')}</th>
              <th scope="col" className="text-right">{L('Closing Cr', 'সমাপনী ক্রেডিট')}</th>
            </tr>
          </thead>
          <tbody>
            {trial.trialBalance.rows.map((row) => (
              <tr key={row.accountId}>
                <td className="font-mono text-ink-500">{row.accountCode}</td>
                <td>
                  <button type="button" onClick={() => onDrillAccount(row.accountId)} className="text-left font-medium text-ink-900 hover:text-brand-bright hover:underline">
                    {localized(locale, row.accountNameEn, row.accountNameBn ?? row.accountNameEn)}
                  </button>
                </td>
                <td className="text-right"><ReportAmount value={row.openingDebitPoisha} money={money} /></td>
                <td className="text-right"><ReportAmount value={row.openingCreditPoisha} money={money} /></td>
                <td className="text-right"><ReportAmount value={row.periodDebitPoisha} money={money} /></td>
                <td className="text-right"><ReportAmount value={row.periodCreditPoisha} money={money} /></td>
                <td className="text-right"><ReportAmount value={row.closingDebitPoisha} money={money} /></td>
                <td className="text-right"><ReportAmount value={row.closingCreditPoisha} money={money} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={2} className="text-right text-[12px] uppercase tracking-[0.04em] text-ink-500">{L('Totals', 'মোট')}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.openingDebitPoisha))}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.openingCreditPoisha))}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.periodDebitPoisha))}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.periodCreditPoisha))}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.closingDebitPoisha))}</td>
              <td className="text-right">{money(BigInt(trial.trialBalance.totals.closingCreditPoisha))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (tab === 'GENERAL_LEDGER') {
    const ledger = report as GeneralLedgerReport;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/30 p-3 text-[12px]">
          <span>{ledger.accountCode} — {localized(locale, ledger.accountNameEn, ledger.accountNameBn ?? ledger.accountNameEn)}</span>
          <span>{L('Opening', 'উদ্বোধনী')}: {money(BigInt(ledger.openingNetPoisha))} · {L('Closing', 'সমাপনী')}: {money(BigInt(ledger.closingNetPoisha))}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[900px] text-[12px]">
            <caption className="sr-only">{L('General ledger detail', 'সাধারণ খাতা বিবরণ')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                <th scope="col" className="text-left">{L('Journal', 'জার্নাল')}</th>
                <th scope="col" className="text-left">{L('Narration', 'বিবরণ')}</th>
                <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
                <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
                <th scope="col" className="text-right">{L('Running', 'চলমান')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-ink-500">{L('No posted lines in this range.', 'এই পরিসরে কোনো পোস্টকৃত লাইন নেই।')}</td></tr>
              ) : ledger.lines.map((line) => (
                <tr key={`${line.journalId}-${line.lineNo}`}>
                  <td>{formatLedgerDate(line.postingDate, locale)}</td>
                  <td>
                    <button type="button" onClick={() => onOpenJournal(line.journalId)} className="font-mono text-brand-bright hover:underline">
                      {line.journalNumber ?? line.journalId.slice(0, 8)}
                    </button>
                    {line.reversalJournalNumber ? <span className="ml-1 text-[12px] text-rose-600">→ {line.reversalJournalNumber}</span> : null}
                    <p className="mt-0.5 text-[12px] text-ink-400">{line.status} · {line.sourceModule}</p>
                  </td>
                  <td>{line.narration}</td>
                  <td className="text-right"><ReportAmount value={line.debitPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={line.creditPoisha} money={money} /></td>
                  <td className="text-right font-money tabular-nums">{money(BigInt(line.runningNetPoisha))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-ink-500">{L('Open the journal from the ledger workspace to see its audit trail and source document.', 'অডিট ট্রেইল ও উৎস ডকুমেন্ট দেখতে লেজার ওয়ার্কস্পেস থেকে জার্নাল খুলুন।')}</p>
        <p className="text-[12px] text-ink-400">{accounts.length} {L('accounts available for drill-down', 'হিসাব ড্রিল-ডাউনের জন্য উপলব্ধ')}</p>
      </div>
    );
  }

  if (tab === 'AR_AGEING' || tab === 'AP_AGEING') {
    const ageing = report as AgeingReport;
    const rows = ageing.ageing.rows as Array<Record<string, unknown>>;
    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(ageing.ageing.totals).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-line bg-surface-2/30 p-3">
              <p className="text-[12px] text-ink-400">{key.replaceAll('_', ' ')}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{money(BigInt(value))}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-line bg-surface-2/30 p-3 text-[12px] text-ink-600">
          {L('Control proof', 'নিয়ন্ত্রণ প্রমাণ')}: {ageing.ageing.proof.controlAccountCode} {ageing.ageing.proof.controlAccountName} · {L('GL', 'জিএল')} {money(BigInt(ageing.ageing.proof.glBalancePoisha))} · {L('Subledger', 'সাবলেজার')} {money(BigInt(ageing.ageing.proof.subledgerPoisha))} · {L('Difference', 'পার্থক্য')} {money(BigInt(ageing.ageing.proof.differencePoisha))}
        </div>
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[1000px] text-[12px]">
            <caption className="sr-only">{L('Ageing open items', 'এজিং খোলা আইটেম')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Document', 'ডকুমেন্ট')}</th>
                <th scope="col" className="text-left">{L('Party', 'পক্ষ')}</th>
                <th scope="col" className="text-left">{L('Due date', 'পরিশোধের তারিখ')}</th>
                <th scope="col" className="text-right">{L('Outstanding', 'বকেয়া')}</th>
                <th scope="col" className="text-left">{L('Bucket', 'বাকেট')}</th>
                <th scope="col" className="text-right">{L('Days overdue', 'বিলম্বিত দিন')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-ink-500">{L('No open items at this date.', 'এই তারিখে কোনো খোলা আইটেম নেই।')}</td></tr>
              ) : rows.map((row) => (
                <tr key={String(row.documentId)}>
                  <td className="font-mono">{String(row.documentNo ?? row.supplierInvoiceNo ?? '—')}</td>
                  <td>{String(row.partyNameEn ?? '')}</td>
                  <td>{String(row.dueDate ?? '')}</td>
                  <td className="text-right"><ReportAmount value={String(row.outstandingPoisha ?? '0')} money={money} /></td>
                  <td>{String(row.bucket ?? '')}</td>
                  <td className="text-right">{String(row.daysOverdue ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === 'STOCK_VALUATION') {
    const stock = report as StockValuation;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface-2/30 p-3 text-[12px] text-ink-600">
          {L('Total stock value', 'মোট স্টক মূল্য')}: <span className="font-money font-semibold text-ink-900">{money(BigInt(stock.totalValuePoisha))}</span>
          {' · '}{L('Inventory GL', 'ইনভেন্টরি জিএল')}: {money(BigInt(String(stock.glProof.inventoryGlPoisha ?? '0')))}
          {' · '}{L('Difference', 'পার্থক্য')}: {money(BigInt(String(stock.glProof.differencePoisha ?? '0')))}
        </div>
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[950px] text-[12px]">
            <caption className="sr-only">{L('Stock valuation by item and warehouse', 'আইটেম ও গুদাম অনুযায়ী স্টক মূল্যায়ন')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('SKU', 'এসকেইউ')}</th>
                <th scope="col" className="text-left">{L('Item', 'আইটেম')}</th>
                <th scope="col" className="text-left">{L('Warehouse', 'গুদাম')}</th>
                <th scope="col" className="text-right">{L('Quantity', 'পরিমাণ')}</th>
                <th scope="col" className="text-right">{L('Value', 'মূল্য')}</th>
                <th scope="col" className="text-right">{L('Unit cost', 'একক ব্যয়')}</th>
              </tr>
            </thead>
            <tbody>
              {stock.rows.map((row) => (
                <tr key={`${row.itemId}-${row.warehouseId}`}>
                  <td className="font-mono">{row.sku}</td>
                  <td>{localized(locale, row.itemNameEn, row.itemNameBn ?? row.itemNameEn)}</td>
                  <td>{row.warehouseCode}</td>
                  <td className="text-right font-mono">{row.quantity}</td>
                  <td className="text-right"><ReportAmount value={row.valuePoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={row.weightedUnitCostPoisha} money={money} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (tab === 'VAT_SALES_REGISTER' || tab === 'VAT_PURCHASE_REGISTER') {
    const register = report as VatRegisterReport;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="lv-chip lv-chip-neutral">{register.lineCount} {L('lines', 'লাইন')}</span>
          <span className="lv-chip lv-chip-gold">{L('Base', 'বেস')} {money(BigInt(register.totals.basePoisha ?? '0'))}</span>
          <span className="lv-chip lv-chip-gold">{L('VAT', 'ভ্যাট')} {money(BigInt(register.totals.vatPoisha ?? '0'))}</span>
          {register.direction === 'PURCHASES' ? (
            <>
              <span className="lv-chip lv-chip-emerald">{L('Claimable', 'দাবিযোগ্য')} {money(BigInt(register.totals.claimablePoisha ?? '0'))}</span>
              <span className="lv-chip lv-chip-rose">{L('Disallowed', 'বাতিল')} {money(BigInt(register.totals.disallowedPoisha ?? '0'))}</span>
            </>
          ) : (
            <span className="lv-chip lv-chip-neutral">{L('Credit notes', 'ক্রেডিট নোট')} {money(BigInt(register.totals.creditNoteVatPoisha ?? '0'))}</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[1150px] text-[12px]">
            <caption className="sr-only">{L('VAT register lines', 'ভ্যাট রেজিস্টার লাইন')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                <th scope="col" className="text-left">{L('Document', 'ডকুমেন্ট')}</th>
                <th scope="col" className="text-left">{L('Mushak serial', 'মূসক সিরিয়াল')}</th>
                <th scope="col" className="text-left">{L('Party', 'পক্ষ')}</th>
                <th scope="col" className="text-left">{L('Description', 'বিবরণ')}</th>
                <th scope="col" className="text-left">{L('Category', 'শ্রেণি')}</th>
                <th scope="col" className="text-right">{L('Rate', 'হার')}</th>
                <th scope="col" className="text-right">{L('Base', 'বেস')}</th>
                <th scope="col" className="text-right">{L('VAT', 'ভ্যাট')}</th>
              </tr>
            </thead>
            <tbody>
              {register.rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-ink-500">{L('No posted register lines in this period.', 'এই সময়কালে কোনো পোস্টকৃত রেজিস্টার লাইন নেই।')}</td></tr>
              ) : register.rows.map((row) => (
                <tr key={`${row.documentId}-${row.lineNo}`}>
                  <td>{formatDate(row.documentDate, locale)}</td>
                  <td>
                    <p className="font-mono font-semibold">{row.documentNo ?? '—'}</p>
                    <p className="text-[12px] text-ink-400">{row.documentType.replaceAll('_', ' ')}</p>
                  </td>
                  <td className="font-mono text-[12px]">{row.statutorySerial ?? '—'}</td>
                  <td>
                    {row.partyNameEn}
                    <p className="font-mono text-[12px] text-ink-400">{row.partyBin ?? L('No BIN', 'বিআইএন নেই')}</p>
                  </td>
                  <td>{row.description}</td>
                  <td>{row.taxCategory.replaceAll('_', ' ')}</td>
                  <td className="text-right font-mono">{(row.rateBps / 100).toFixed(2)}%</td>
                  <td className="text-right"><ReportAmount value={row.basePoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={row.vatPoisha} money={money} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {register.summaryByCategory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="lv-table w-full min-w-[700px] text-[12px]">
              <caption className="sr-only">{L('VAT category summary', 'ভ্যাট শ্রেণি সারসংক্ষেপ')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">{L('Category', 'শ্রেণি')}</th>
                  <th scope="col" className="text-right">{L('Rate', 'হার')}</th>
                  <th scope="col" className="text-right">{L('Lines', 'লাইন')}</th>
                  <th scope="col" className="text-right">{L('Base', 'বেস')}</th>
                  <th scope="col" className="text-right">{L('VAT', 'ভ্যাট')}</th>
                  <th scope="col" className="text-right">{L('Claimable', 'দাবিযোগ্য')}</th>
                  <th scope="col" className="text-right">{L('Disallowed', 'বাতিল')}</th>
                </tr>
              </thead>
              <tbody>
                {register.summaryByCategory.map((row) => (
                  <tr key={`${row.taxCategory}-${row.rateBps}`}>
                    <td>{String(row.taxCategory).replaceAll('_', ' ')}</td>
                    <td className="text-right font-mono">{(Number(row.rateBps) / 100).toFixed(2)}%</td>
                    <td className="text-right">{String(row.lineCount)}</td>
                    <td className="text-right"><ReportAmount value={String(row.basePoisha)} money={money} /></td>
                    <td className="text-right"><ReportAmount value={String(row.vatPoisha)} money={money} /></td>
                    <td className="text-right"><ReportAmount value={String(row.claimablePoisha)} money={money} /></td>
                    <td className="text-right"><ReportAmount value={String(row.disallowedPoisha)} money={money} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-500">
          <span>{L('Page', 'পৃষ্ঠা')} {register.page}</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="lv-btn lv-btn-secondary min-h-11 text-[12px]">{L('Previous', 'পূর্ববর্তী')}</button>
            <button type="button" onClick={() => onPage(page + 1)} disabled={register.rows.length < register.pageSize} className="lv-btn lv-btn-secondary min-h-11 text-[12px]">{L('Next', 'পরবর্তী')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'VAT_RETURN_DRAFT') {
    const vat = report as VatReturnDraft;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/50 p-4">
          <p className="text-[14px] font-bold uppercase tracking-[0.12em] text-rose-800">{vat.filing.watermark}</p>
          <p className="mt-1 text-[12px] text-rose-700">{L('This is an internal draft for professional review. It is not a filed return, a government receipt or a filing acknowledgement.', 'এটি পেশাদার পর্যালোচনার জন্য অভ্যন্তরীণ খসড়া। এটি দাখিলকৃত রিটার্ন, সরকারি রসিদ বা দাখিল স্বীকৃতি নয়।')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [L('Output VAT', 'আউটপুট ভ্যাট'), vat.totals.outputVatPoisha],
            [L('Input VAT claimable', 'দাবিযোগ্য ইনপুট ভ্যাট'), vat.totals.inputVatClaimablePoisha],
            [L('Net payable', 'নিট প্রদেয়'), vat.totals.netPayablePoisha],
            [L('Excess input c/f', 'অতিরিক্ত ইনপুট বহন'), vat.totals.excessInputCarriedForwardPoisha],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-surface-2/30 p-3">
              <p className="text-[12px] text-ink-400">{label}</p>
              <p className="mt-1 font-money text-[16px] font-semibold text-ink-900">{money(BigInt(value))}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {vat.parts.map((part) => (
            <div key={part.part} className="rounded-xl border border-line bg-surface-2/20 p-3">
              <p className="text-[12px] font-semibold text-ink-900">{part.part}. {localized(locale, part.titleEn, part.titleBn)}</p>
              <dl className="mt-1 space-y-1">
                {part.rows.map((row) => (
                  <div key={`${part.part}:${row.labelEn}`} className="flex items-start justify-between gap-2 text-[12px]">
                    <dt className="text-ink-500">{localized(locale, row.labelEn, row.labelBn)}</dt>
                    <dd className="font-money shrink-0 text-ink-800">{row.amountPoisha !== '0' ? money(BigInt(row.amountPoisha)) : row.note ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-right font-money text-[12px] font-semibold text-ink-900">{money(BigInt(part.totalPoisha))}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-2/30 p-3 text-[12px]">
            <p className="font-semibold text-ink-900">{L('GL proof', 'জিএল প্রমাণ')}</p>
            <p className="mt-1">{L('Output register', 'আউটপুট রেজিস্টার')}: {money(BigInt(String(vat.glProof.outputVatRegisterPoisha ?? '0')))} · {L('GL', 'জিএল')}: {money(BigInt(String(vat.glProof.outputVatGlPoisha ?? '0')))} · {L('Variance', 'পার্থক্য')}: {money(BigInt(String(vat.glProof.outputVatDifferencePoisha ?? '0')))}</p>
            <p className="mt-1">{L('Input register', 'ইনপুট রেজিস্টার')}: {money(BigInt(String(vat.glProof.inputVatRegisterPoisha ?? '0')))} · {L('GL', 'জিএল')}: {money(BigInt(String(vat.glProof.inputVatGlPoisha ?? '0')))} · {L('Variance', 'পার্থক্য')}: {money(BigInt(String(vat.glProof.inputVatDifferencePoisha ?? '0')))}</p>
            <p className="mt-1 text-ink-400">{L('Mapping source', 'ম্যাপিং উৎস')}: {String(vat.glProof.mappingSource ?? 'UNMAPPED')}</p>
          </div>
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-ink-900">{L('Exceptions', 'ব্যতিক্রম')}</p>
            <ExceptionList exceptions={vat.exceptions} locale={locale} />
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'WITHHOLDING_REGISTER') {
    const withholding = report as WithholdingRegister;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {withholding.totals.map((entry) => (
            <span key={`${entry.taxType}-${entry.status}`} className="lv-chip lv-chip-neutral">
              {entry.taxType} · {entry.status} · {entry.count} · {money(BigInt(entry.amountPoisha))}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[1050px] text-[12px]">
            <caption className="sr-only">{L('Withholding liabilities and challans', 'উৎসে কর দায় ও চালান')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Tax', 'কর')}</th>
                <th scope="col" className="text-left">{L('Status', 'অবস্থা')}</th>
                <th scope="col" className="text-left">{L('Period', 'সময়কাল')}</th>
                <th scope="col" className="text-left">{L('Party', 'পক্ষ')}</th>
                <th scope="col" className="text-left">{L('Bill / payment', 'বিল / পরিশোধ')}</th>
                <th scope="col" className="text-right">{L('Base', 'বেস')}</th>
                <th scope="col" className="text-right">{L('Rate', 'হার')}</th>
                <th scope="col" className="text-right">{L('Amount', 'পরিমাণ')}</th>
                <th scope="col" className="text-left">{L('Challan', 'চালান')}</th>
              </tr>
            </thead>
            <tbody>
              {withholding.rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-ink-500">{L('No withholding liabilities in this period.', 'এই সময়কালে কোনো উৎসে কর দায় নেই।')}</td></tr>
              ) : withholding.rows.map((row) => (
                <tr key={String(row.liabilityId)}>
                  <td>{String(row.taxType)}</td>
                  <td>{String(row.status)}</td>
                  <td>{String(row.taxPeriod)}</td>
                  <td>{String(row.partyNameEn)}</td>
                  <td className="font-mono">{String(row.billNo ?? row.paymentNumber ?? '—')}</td>
                  <td className="text-right"><ReportAmount value={String(row.basePoisha)} money={money} /></td>
                  <td className="text-right font-mono">{(Number(row.rateBps) / 100).toFixed(2)}%</td>
                  <td className="text-right"><ReportAmount value={String(row.amountPoisha)} money={money} /></td>
                  <td>{String(row.challanNumber ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {withholding.deposits.length > 0 ? (
          <div className="rounded-xl border border-line bg-surface-2/30 p-3 text-[12px] text-ink-600">
            {L('Treasury challans in the period', 'সময়কালের কোষাগার চালান')}: {withholding.deposits.map((entry) => `${entry.challanNumber} (${entry.depositDate}) ${money(BigInt(entry.totalPoisha))}`).join(' · ')}
          </div>
        ) : null}
      </div>
    );
  }

  if (tab === 'JOURNAL_LISTING') {
    const listing = report as JournalListingReport;
    return (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="lv-table w-full min-w-[1150px] text-[12px]">
            <caption className="sr-only">{L('Journal listing', 'জার্নাল তালিকা')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Number', 'নম্বর')}</th>
                <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                <th scope="col" className="text-left">{L('Branch', 'শাখা')}</th>
                <th scope="col" className="text-left">{L('Source', 'উৎস')}</th>
                <th scope="col" className="text-left">{L('Narration', 'বিবরণ')}</th>
                <th scope="col" className="text-left">{L('Status', 'অবস্থা')}</th>
                <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
                <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
              </tr>
            </thead>
            <tbody>
              {listing.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-mono">
                    {entry.journalNumber ?? '—'}
                    {entry.reversalJournalNumber ? <span className="ml-1 text-rose-600">→ {entry.reversalJournalNumber}</span> : null}
                  </td>
                  <td>{formatDate(entry.postingDate, locale)}</td>
                  <td>{entry.branchCode ?? L('Unassigned', 'অনির্ধারিত')}</td>
                  <td>{entry.sourceModule}{entry.sourceDocRef ? ` · ${entry.sourceDocRef}` : ''}</td>
                  <td>{entry.narrationEn}</td>
                  <td>{entry.status}</td>
                  <td className="text-right"><ReportAmount value={entry.totalDebitPoisha} money={money} /></td>
                  <td className="text-right"><ReportAmount value={entry.totalCreditPoisha} money={money} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-500">
          <span>{L('Showing', 'দেখানো হচ্ছে')} {listing.entries.length} / {listing.total}</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="lv-btn lv-btn-secondary min-h-11 text-[12px]">{L('Previous', 'পূর্ববর্তী')}</button>
            <button type="button" onClick={() => onPage(page + 1)} disabled={listing.entries.length < listing.limit} className="lv-btn lv-btn-secondary min-h-11 text-[12px]">{L('Next', 'পরবর্তী')}</button>
          </div>
        </div>
      </div>
    );
  }

  return <ReportEmpty messageEn="Choose a report." messageBn="একটি রিপোর্ট নির্বাচন করুন।" locale={locale} />;
}

function statementTotals(
  tab: TabKey,
  statement: ProfitAndLossReport | BalanceSheetReport | CashFlowReport,
  locale: 'en-BD' | 'bn-BD',
): Array<{ labelEn: string; labelBn: string; value: string }> {
  const L = (en: string, bn: string) => localized(locale, en, bn);
  if (tab === 'PROFIT_AND_LOSS') {
    const totals = (statement as ProfitAndLossReport).totals;
    return [
      { labelEn: L('Revenue', 'রাজস্ব'), labelBn: 'রাজস্ব', value: totals.revenuePoisha ?? '0' },
      { labelEn: L('Gross profit', 'মোট মুনাফা'), labelBn: 'মোট মুনাফা', value: totals.grossProfitPoisha ?? '0' },
      { labelEn: L('Operating profit', 'পরিচালন মুনাফা'), labelBn: 'পরিচালন মুনাফা', value: totals.operatingProfitPoisha ?? '0' },
      { labelEn: L('Profit for period', 'সময়কালের মুনাফা'), labelBn: 'সময়কালের মুনাফা', value: totals.profitForPeriodPoisha ?? '0' },
    ];
  }
  if (tab === 'BALANCE_SHEET') {
    const totals = (statement as BalanceSheetReport).totals;
    return [
      { labelEn: L('Total assets', 'মোট সম্পদ'), labelBn: 'মোট সম্পদ', value: totals.totalAssetsPoisha ?? '0' },
      { labelEn: L('Total equity', 'মোট ইকুইটি'), labelBn: 'মোট ইকুইটি', value: totals.equityPoisha ?? '0' },
      { labelEn: L('Total liabilities', 'মোট দায়'), labelBn: 'মোট দায়', value: String(BigInt(totals.liabilitiesNonCurrentPoisha ?? '0') + BigInt(totals.liabilitiesCurrentPoisha ?? '0')) },
      { labelEn: L('Imbalance', 'অসামঞ্জস্য'), labelBn: 'অসামঞ্জস্য', value: totals.imbalancePoisha ?? '0' },
    ];
  }
  const cash = statement as CashFlowReport;
  return [
    { labelEn: L('Opening cash', 'প্রারম্ভিক নগদ'), labelBn: 'প্রারম্ভিক নগদ', value: cash.openingCashPoisha },
    { labelEn: L('Net change', 'নিট পরিবর্তন'), labelBn: 'নিট পরিবর্তন', value: cash.netChangePoisha },
    { labelEn: L('Closing cash', 'সমাপনী নগদ'), labelBn: 'সমাপনী নগদ', value: cash.closingCashPoisha },
  ];
}
