import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Download,
  FileSpreadsheet,
  Filter,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { localized } from '../../core/i18n';
import { reportsApi, type WithholdingAnomaly, type WithholdingReturn, type WithholdingSchedule } from '../../reports/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';

export function WithholdingReturnPage() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);

  const [taxYear, setTaxYear] = useState('2026-2027');
  const [taxPeriod, setTaxPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [returnData, setReturnData] = useState<WithholdingReturn | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'ALL' | WithholdingSchedule>('ALL');
  const [selectedAnomaly, setSelectedAnomaly] = useState<WithholdingAnomaly | 'ALL'>('ALL');

  const canExport = auth.hasCompanyPermission('EXPORT_DATA');
  const canVerify = auth.hasCompanyPermission('VIEW_REPORTS');

  const loadReturn = useCallback(async () => {
    if (!companyId || !taxPeriod) return;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsApi.getSection177(companyId, { period: taxPeriod });
      setReturnData(response.return);
    } catch (caught: unknown) {
      // 404 is normal if return hasn't been generated yet
      setReturnData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, taxPeriod]);

  useEffect(() => {
    void loadReturn();
  }, [loadReturn]);

  const handleGenerate = async () => {
    if (!companyId || !taxPeriod) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await reportsApi.generateSection177(companyId, { taxYear, taxPeriod });
      setReturnData(response.return);
      setNotice(L('Section 177 Withholding Tax Return generated successfully.', 'সেকশন ১৭৭ উইথহোল্ডিং ট্যাক্স রিটার্ন সফলভাবে তৈরি হয়েছে।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  };

  const handleVerify = async () => {
    if (!companyId || !returnData) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await reportsApi.verifySection177(companyId, returnData.id);
      setReturnData(response.return);
      setNotice(L('Return status updated to VERIFIED.', 'রিটার্নের অবস্থা ভেরিফাইড হিসাবে সংরক্ষিত হয়েছে।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!companyId || !returnData) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await reportsApi.submitSection177(companyId, returnData.id);
      setReturnData(response.return);
      setNotice(L('Return marked as SUBMITTED.', 'রিটার্ন দাখিলকৃত (SUBMITTED) হিসাবে চিহ্নিত করা হয়েছে।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = () => {
    if (!companyId || !returnData) return;
    const url = reportsApi.exportSection177Url(companyId, returnData.id);
    window.open(url, '_blank');
  };

  const filteredLines = useMemo(() => {
    if (!returnData) return [];
    let list = returnData.lines;
    if (activeTab !== 'ALL') {
      list = list.filter((line) => line.schedule === activeTab);
    }
    if (selectedAnomaly !== 'ALL') {
      list = list.filter((line) => line.anomalies.includes(selectedAnomaly));
    }
    return list;
  }, [returnData, activeTab, selectedAnomaly]);

  const anomalyCounts = useMemo(() => {
    if (!returnData) return { missingTin: 0, undeposited: 0, late: 0 };
    let missingTin = 0;
    let undeposited = 0;
    let late = 0;
    for (const l of returnData.lines) {
      if (l.anomalies.includes('MISSING_ETIN')) missingTin += 1;
      if (l.anomalies.includes('UNDEPOSITED_TDS')) undeposited += 1;
      if (l.anomalies.includes('LATE_CHALLAN_DEPOSIT')) late += 1;
    }
    return { missingTin, undeposited, late };
  }, [returnData]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={L('Tax & Regulatory Filings', 'কর ও সংবিধিবদ্ধ রিটার্ন')}
        title={L('Section 177 Withholding Tax Return', 'সেকশন ১৭৭ উইথহোল্ডিং ট্যাক্স রিটার্ন')}
        description={L(
          'NBR Monthly Return of Tax Deducted at Source (TDS) under Income Tax Act 2023 §177. Auto-compiles Schedules A–D, verifies e-TINs, enforces Section 134 (+50%) penalties, and validates Treasury A-Challan deposit timeliness.',
          'আয়কর আইন ২০২৩ এর ধারা ১৭৭ অনুযায়ী উৎসে কর কর্তন (টিডিএস) মাসিক রিটার্ন। তফসিল ক–ঘ স্বয়ংক্রিয়ভাবে সংকলন করে, ই-টিন যাচাই করে, ধারা ১৩৪ (+৫০%) জরিমানা নিশ্চিত করে এবং ট্রেজারি চালানের সময়ানুবর্তিতা মিল করে।',
        )}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {/* Control Strip */}
      <div className="ql-card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
            {L('Tax Year', 'কর বর্ষ')}:
            <select
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className="ql-input w-36 text-[13px]"
            >
              <option value="2026-2027">2026-2027</option>
              <option value="2025-2026">2025-2026</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
            {L('Filing Period', 'ফাইলিং মাস')}:
            <input
              type="month"
              value={taxPeriod}
              onChange={(e) => setTaxPeriod(e.target.value)}
              className="ql-input w-40 text-[13px]"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="ql-btn ql-btn-primary min-h-10 text-[13px]"
          >
            <Play size={14} /> {generating ? L('Compiling Return…', 'সংকলন হচ্ছে…') : L('Generate Sec 177 Return', 'রিটার্ন তৈরি করুন')}
          </button>
          <button
            type="button"
            onClick={() => void loadReturn()}
            disabled={loading}
            className="ql-btn ql-btn-ghost min-h-10 text-[13px]"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {returnData ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`ql-badge ${
                returnData.status === 'SUBMITTED'
                  ? 'ql-badge-success'
                  : returnData.status === 'VERIFIED'
                    ? 'ql-badge-neutral'
                    : 'ql-badge-warn'
              }`}
            >
              {returnData.status}
            </span>
            {returnData.status === 'DRAFT' && canVerify ? (
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={submitting}
                className="ql-btn ql-btn-secondary min-h-10 text-[13px]"
              >
                <CheckCircle size={14} /> {L('Verify Return', 'যাচাই করুন')}
              </button>
            ) : null}
            {returnData.status === 'VERIFIED' ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="ql-btn ql-btn-primary min-h-10 text-[13px]"
              >
                <Send size={14} /> {L('Mark as Submitted', 'দাখিল সম্পন্ন')}
              </button>
            ) : null}
            {canExport ? (
              <button
                type="button"
                onClick={handleExport}
                className="ql-btn ql-btn-secondary min-h-10 text-[13px]"
              >
                <Download size={14} /> {L('Download NBR Excel', 'এনবিআর এক্সেল ডাউনলোড')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {returnData ? (
        <>
          {/* Key Metrics Summary Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="ql-card p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {L('Total TDS Deducted', 'মোট কর্তিত কর')}
              </span>
              <p className="mt-1 font-mono text-[20px] font-bold text-ink-900">
                ৳{returnData.totalDeductedBdt}
              </p>
              <span className="text-[12px] text-ink-500">
                {returnData.lines.length} {L('transactions', 'লেনদেন')}
              </span>
            </div>

            <div className="ql-card p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {L('Treasury Deposited', 'ট্রেজারিতে জমাকৃত')}
              </span>
              <p className="mt-1 font-mono text-[20px] font-bold text-emerald-700 dark:text-emerald-400">
                ৳{returnData.totalDepositedBdt}
              </p>
              <span className="text-[12px] text-ink-500">
                {L('A-Challan matched', 'এ-চালান সমন্বিত')}
              </span>
            </div>

            <div className="ql-card p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {L('Undeposited Obligation', 'বকেয়া ট্রেজারি দায়')}
              </span>
              <p className="mt-1 font-mono text-[20px] font-bold text-amber-700 dark:text-amber-400">
                ৳{(
                  Number(BigInt(returnData.totalDeductedPoisha) - BigInt(returnData.totalDepositedPoisha)) / 100
                ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <span className="text-[12px] text-ink-500">
                {anomalyCounts.undeposited} {L('unremitted items', 'অজমা আইটেম')}
              </span>
            </div>

            <div className="ql-card p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {L('Compliance Anomalies', 'সংবিধিবদ্ধ অসংগতি')}
              </span>
              <p className="mt-1 font-mono text-[20px] font-bold text-rose-700 dark:text-rose-400">
                {returnData.anomalyCount}
              </p>
              <span className="text-[12px] text-ink-500">
                {L('Audit Disallowance Risk', 'অডিট প্রত্যাখ্যান ঝুঁকি')}
              </span>
            </div>
          </div>

          {/* Anomaly Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ql-border pb-3">
            <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-500">
              <Filter size={13} /> {L('Audit Filter', 'অডিট ফিল্টার')}:
            </span>
            <button
              type="button"
              onClick={() => setSelectedAnomaly('ALL')}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                selectedAnomaly === 'ALL'
                  ? 'bg-ink-800 text-white dark:bg-ink-100 dark:text-ink-900'
                  : 'bg-surface-2 text-ink-600 hover:bg-surface-3'
              }`}
            >
              {L('All Lines', 'সকল লাইন')} ({returnData.lines.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedAnomaly('MISSING_ETIN')}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                selectedAnomaly === 'MISSING_ETIN'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <AlertTriangle size={12} className="inline mr-1" />
              {L('Missing e-TIN (+50% Penalty)', 'ই-টিন অনুপস্থিত (+৫০% জরিমানা)')} ({anomalyCounts.missingTin})
            </button>
            <button
              type="button"
              onClick={() => setSelectedAnomaly('UNDEPOSITED_TDS')}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                selectedAnomaly === 'UNDEPOSITED_TDS'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              }`}
            >
              <AlertCircle size={12} className="inline mr-1" />
              {L('Undeposited TDS', 'ট্রেজারিতে অজমা')} ({anomalyCounts.undeposited})
            </button>
            <button
              type="button"
              onClick={() => setSelectedAnomaly('LATE_CHALLAN_DEPOSIT')}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                selectedAnomaly === 'LATE_CHALLAN_DEPOSIT'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
              }`}
            >
              <ShieldAlert size={12} className="inline mr-1" />
              {L('Late Challan (>15th of next month)', 'বিলম্বিত জমা (>১৫ তারিখ)')} ({anomalyCounts.late})
            </button>
          </div>

          {/* Schedule Navigation Tabs */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'ALL', label: L('All Schedules', 'সকল তফসিল') },
              {
                key: 'SCHEDULE_A',
                label: `Schedule A — Sec 86 Salaries (${returnData.schedulesSummary.SCHEDULE_A.count})`,
              },
              {
                key: 'SCHEDULE_B',
                label: `Schedule B — Sec 88/89 Goods & Contracts (${returnData.schedulesSummary.SCHEDULE_B.count})`,
              },
              {
                key: 'SCHEDULE_C',
                label: `Schedule C — Sec 109 Rent (${returnData.schedulesSummary.SCHEDULE_C.count})`,
              },
              {
                key: 'SCHEDULE_D',
                label: `Schedule D — Sec 90/92 Professional & Media (${returnData.schedulesSummary.SCHEDULE_D.count})`,
              },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as 'ALL' | WithholdingSchedule)}
                className={`rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                  activeTab === tab.key
                    ? 'border-b-2 border-brand-500 bg-surface-2 font-semibold text-ink-900'
                    : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Main Return Lines Table */}
          <div className="ql-card overflow-x-auto">
            <table className="w-full min-w-[950px] text-[13px]">
              <thead>
                <tr className="border-b border-ql-border bg-surface-1 text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2.5">Schedule / Sec</th>
                  <th className="px-3 py-2.5">Party / Vendor</th>
                  <th className="px-3 py-2.5">12-Digit e-TIN</th>
                  <th className="px-3 py-2.5 text-right">Taxable Base</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">TDS Deducted</th>
                  <th className="px-3 py-2.5">A-Challan No / Date</th>
                  <th className="px-3 py-2.5">Economic Code</th>
                  <th className="px-3 py-2.5">Compliance Badges</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ql-border/50">
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-ink-400">
                      {L('No return lines found matching the active filter.', 'সক্রিয় ফিল্টারের সাথে মিলে এমন কোনো রিটার্ন লাইন পাওয়া যায়নি।')}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => (
                    <tr key={line.id} className="hover:bg-surface-2/40">
                      <td className="px-3 py-2.5 font-medium text-ink-700">
                        <span className="font-mono text-[11px] text-ink-500">{line.schedule}</span>
                        <div className="font-semibold">{line.sectionCode}</div>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-ink-900">
                        {line.partyName}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px]">
                        {line.partyTin ? (
                          line.partyTin
                        ) : (
                          <span className="ql-badge ql-badge-danger text-[11px]">MISSING</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-ink-900">
                        ৳{line.taxableBaseBdt}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-ink-600">
                        {(line.rateBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-ink-900">
                        ৳{line.tdsAmountBdt}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px]">
                        {line.challanNumber ? (
                          <div>
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{line.challanNumber}</span>
                            <div className="text-[11px] text-ink-400">{line.challanDate}</div>
                          </div>
                        ) : (
                          <span className="text-amber-600 font-semibold">NOT DEPOSITED</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-ink-500">
                        {line.economicCode || '1/1141/0010/0311'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {line.penaltyApplied ? (
                            <span className="ql-badge ql-badge-danger text-[10px]">
                              +50% Sec 134 Penalty
                            </span>
                          ) : null}
                          {line.anomalies.includes('MISSING_ETIN') ? (
                            <span className="ql-badge ql-badge-danger text-[10px]">
                              No e-TIN
                            </span>
                          ) : null}
                          {line.anomalies.includes('UNDEPOSITED_TDS') ? (
                            <span className="ql-badge ql-badge-warn text-[10px]">
                              Undeposited
                            </span>
                          ) : null}
                          {line.anomalies.includes('LATE_CHALLAN_DEPOSIT') ? (
                            <span className="ql-badge ql-badge-warn text-[10px]">
                              Late Challan &gt;15th
                            </span>
                          ) : null}
                          {line.anomalies.length === 0 ? (
                            <span className="ql-badge ql-badge-success text-[10px]">
                              Compliant
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="ql-card flex flex-col items-center justify-center p-12 text-center">
          <FileSpreadsheet size={48} className="text-ink-300" />
          <h3 className="mt-4 text-[16px] font-semibold text-ink-800">
            {L('No return generated for this period', 'এই কর মেয়াদের জন্য কোনো রিটার্ন তৈরি করা হয়নি')}
          </h3>
          <p className="mt-1 max-w-md text-[13px] text-ink-500">
            {L(
              'Click "Generate Sec 177 Return" to extract all posted TDS liabilities for this month, classify into Schedules A–D, and detect missing e-TINs or late challan deposits.',
              '"রিটার্ন তৈরি করুন" বোতামে ক্লিক করে এই মাসের সকল পোস্টকৃত টিডিএস দায় তফসিল ক–ঘ তে সংকলন করুন এবং অনুপস্থিত ই-টিন বা বিলম্বিত জমা চিহ্নিত করুন।',
            )}
          </p>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="ql-btn ql-btn-primary mt-4 min-h-11 text-[13px]"
          >
            <Play size={15} /> {generating ? L('Compiling…', 'সংকলন হচ্ছে…') : L('Generate Sec 177 Return', 'রিটার্ন তৈরি করুন')}
          </button>
        </div>
      )}
    </div>
  );
}
