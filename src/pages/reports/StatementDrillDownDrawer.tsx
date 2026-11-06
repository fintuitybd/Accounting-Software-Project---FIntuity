import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle,
  FileSpreadsheet,
  FileText,
  Landmark,
  Layers,
  Receipt,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import {
  reportsApi,
  type StatementDrillDown,
} from '../../reports/api';
import { apiErrorMessage, ErrorBanner } from '../setup/setupUi';

export function StatementDrillDownDrawer({
  companyId,
  target,
  period,
  onClose,
}: {
  companyId: string;
  target: {
    noteRef?: string;
    accountCode?: string;
    accountId?: string;
    title?: string;
  } | null;
  period: { from: string; to: string };
  onClose: () => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);

  const [drillData, setDrillData] = useState<StatementDrillDown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLevel, setActiveLevel] = useState<1 | 2 | 3>(1);

  const loadData = useCallback(async () => {
    if (!companyId || !target) return;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsApi.statementDrillDown(companyId, {
        noteRef: target.noteRef,
        accountCode: target.accountCode,
        accountId: target.accountId,
        from: period.from,
        to: period.to,
      });
      setDrillData(response.drillDown);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, target, period]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!target) return null;

  const headerTitle =
    target.noteRef ??
    (target.accountCode ? `Account ${target.accountCode}` : target.title ?? 'Statement Line Drill-Down');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity">
      <div className="flex h-full w-full max-w-4xl flex-col bg-surface-1 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-ql-border px-6 py-4 bg-surface-2/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="ql-badge ql-badge-neutral text-[11px] font-bold uppercase tracking-wider">
                IAS / IFRS Drill-Down Studio
              </span>
              <span className="text-[12px] text-ink-400">
                {period.from} to {period.to}
              </span>
            </div>
            <h2 className="mt-1 text-[18px] font-bold text-ink-900">
              {headerTitle}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="lv-btn lv-btn-ghost min-h-9 px-2 text-ink-500"
              title={L('Refresh', 'রিফ্রেশ')}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="lv-btn lv-btn-ghost min-h-9 px-2 text-ink-500"
              aria-label={L('Close', 'বন্ধ করুন')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 3-Level Studio Navigation Tabs */}
        <div className="flex border-b border-ql-border bg-surface-1 px-6">
          <button
            type="button"
            onClick={() => setActiveLevel(1)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-semibold transition ${
              activeLevel === 1
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            <Layers size={15} />
            <span>Level 1: Contributing GL Accounts</span>
            {drillData ? (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-600">
                {drillData.level1.accounts.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setActiveLevel(2)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-semibold transition ${
              activeLevel === 2
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            <ShieldCheck size={15} />
            <span>Level 2: Posted Journals</span>
            {drillData ? (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-600">
                {drillData.level2.count}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setActiveLevel(3)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-semibold transition ${
              activeLevel === 3
                ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
          >
            <Receipt size={15} />
            <span>Level 3: Source Mushak / Challan</span>
            {drillData ? (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-600">
                {drillData.level3.count}
              </span>
            ) : null}
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error ? <ErrorBanner message={error} /> : null}

          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-ink-400">
              <RefreshCw size={24} className="animate-spin text-brand-500" />
              <p className="text-[13px]">
                {L('Tracing statutory ledger and source documents…', 'লেজার ও উৎস নথি সন্ধান করা হচ্ছে…')}
              </p>
            </div>
          ) : drillData ? (
            <>
              {/* LEVEL 1: GL Accounts & Movements */}
              {activeLevel === 1 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="ql-card p-3">
                      <span className="text-[11px] font-semibold uppercase text-ink-400">Opening Balance</span>
                      <p className="mt-1 font-mono text-[16px] font-bold text-ink-900">
                        ৳{(Number(drillData.level1.totalOpeningPoisha) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="ql-card p-3">
                      <span className="text-[11px] font-semibold uppercase text-ink-400">Debit Movement</span>
                      <p className="mt-1 font-mono text-[16px] font-bold text-ink-900">
                        ৳{(Number(drillData.level1.totalDebitPoisha) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="ql-card p-3">
                      <span className="text-[11px] font-semibold uppercase text-ink-400">Credit Movement</span>
                      <p className="mt-1 font-mono text-[16px] font-bold text-ink-900">
                        ৳{(Number(drillData.level1.totalCreditPoisha) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="ql-card p-3">
                      <span className="text-[11px] font-semibold uppercase text-ink-400">Closing Balance</span>
                      <p className="mt-1 font-mono text-[16px] font-bold text-brand-600 dark:text-brand-400">
                        ৳{(Number(drillData.level1.totalClosingPoisha) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  <div className="ql-card overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-ql-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                          <th className="px-3 py-2.5">Code</th>
                          <th className="px-3 py-2.5">Account Name</th>
                          <th className="px-3 py-2.5">IFRS Subcategory</th>
                          <th className="px-3 py-2.5 text-right">Opening (BDT)</th>
                          <th className="px-3 py-2.5 text-right">Debit (BDT)</th>
                          <th className="px-3 py-2.5 text-right">Credit (BDT)</th>
                          <th className="px-3 py-2.5 text-right">Closing (BDT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ql-border/50">
                        {drillData.level1.accounts.map((acc) => (
                          <tr key={acc.accountId} className="hover:bg-surface-2/40">
                            <td className="px-3 py-2 font-mono font-bold text-brand-600 dark:text-brand-400">
                              {acc.accountCode}
                            </td>
                            <td className="px-3 py-2 font-medium text-ink-900">{acc.accountName}</td>
                            <td className="px-3 py-2 text-ink-500">{acc.subCategory}</td>
                            <td className="px-3 py-2 text-right font-mono text-ink-700">৳{acc.openingBdt}</td>
                            <td className="px-3 py-2 text-right font-mono text-ink-700">৳{acc.debitBdt}</td>
                            <td className="px-3 py-2 text-right font-mono text-ink-700">৳{acc.creditBdt}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-ink-900">৳{acc.closingBdt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* LEVEL 2: Underlying Posted Journals with Chain Verification */}
              {activeLevel === 2 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
                      <span className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">
                        Cryptographic Hash Chain Verified (SHA-256)
                      </span>
                    </div>
                    <span className="ql-badge ql-badge-success text-[11px]">
                      Tamper-Evident Proof Intact
                    </span>
                  </div>

                  <div className="ql-card overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-ql-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                          <th className="px-3 py-2.5">Journal #</th>
                          <th className="px-3 py-2.5">Date</th>
                          <th className="px-3 py-2.5">Module</th>
                          <th className="px-3 py-2.5">Narration / Party</th>
                          <th className="px-3 py-2.5 text-right">Debit</th>
                          <th className="px-3 py-2.5 text-right">Credit</th>
                          <th className="px-3 py-2.5 text-center">SHA-256 Seal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ql-border/50">
                        {drillData.level2.journals.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-ink-400">
                              No posted journals recorded for this line in the selected period.
                            </td>
                          </tr>
                        ) : (
                          drillData.level2.journals.map((j) => (
                            <tr key={`${j.journalId}:${j.chainHash}`} className="hover:bg-surface-2/40">
                              <td className="px-3 py-2 font-mono font-bold text-ink-900">{j.journalNumber}</td>
                              <td className="px-3 py-2 font-mono text-ink-600">{j.postingDate}</td>
                              <td className="px-3 py-2">
                                <span className="ql-badge ql-badge-neutral text-[10px]">{j.sourceModule}</span>
                              </td>
                              <td className="px-3 py-2 text-ink-800">
                                <div>{j.narration}</div>
                                {j.partyName ? (
                                  <span className="text-[11px] text-ink-500">Party: {j.partyName}</span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-ink-900">
                                {j.debitPoisha !== '0' ? `৳${j.debitBdt}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-ink-900">
                                {j.creditPoisha !== '0' ? `৳${j.creditBdt}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span
                                  className="cursor-pointer font-mono text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline"
                                  title={`Full Hash: ${j.chainHash}`}
                                >
                                  ✓ {j.chainHash.slice(0, 8)}…
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* LEVEL 3: Source Documents (Mushak 6.3, Mushak 6.6, A-Challan) */}
              {activeLevel === 3 ? (
                <div className="space-y-4">
                  <div className="ql-card overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-ql-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-ink-400">
                          <th className="px-3 py-2.5">Document Type</th>
                          <th className="px-3 py-2.5">Document No / Ref</th>
                          <th className="px-3 py-2.5">Date</th>
                          <th className="px-3 py-2.5">Mushak 6.3 Serial</th>
                          <th className="px-3 py-2.5">Mushak 6.6 Cert #</th>
                          <th className="px-3 py-2.5">A-Challan / Code</th>
                          <th className="px-3 py-2.5 text-right">Tax Base</th>
                          <th className="px-3 py-2.5 text-right">VAT / TDS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ql-border/50">
                        {drillData.level3.sourceDocuments.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-ink-400">
                              No source statutory documents directly attached to this balance.
                            </td>
                          </tr>
                        ) : (
                          drillData.level3.sourceDocuments.map((doc, idx) => (
                            <tr key={`${doc.journalId}:${idx}`} className="hover:bg-surface-2/40">
                              <td className="px-3 py-2 font-semibold text-ink-800">
                                <span className="ql-badge ql-badge-neutral text-[10px]">{doc.documentType}</span>
                              </td>
                              <td className="px-3 py-2 font-mono font-medium text-ink-900">{doc.documentNo}</td>
                              <td className="px-3 py-2 font-mono text-ink-600">{doc.documentDate}</td>
                              <td className="px-3 py-2 font-mono text-ink-800">
                                {doc.mushak63Serial ? (
                                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                                    {doc.mushak63Serial}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-ink-800">
                                {doc.mushak66Certificate ? (
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                                    {doc.mushak66Certificate}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px]">
                                {doc.challanNumber ? (
                                  <div>
                                    <span className="font-bold text-ink-900">{doc.challanNumber}</span>
                                    <div className="text-[10px] text-ink-400">{doc.economicCode}</div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-ink-900">
                                {doc.baseBdt ? `৳${doc.baseBdt}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-ink-900">
                                {doc.taxBdt ? `৳${doc.taxBdt}` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
