import { createPortal } from 'react-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { localized } from '../../core/i18n';
import type {
  AgeingReport,
  BalanceSheetReport,
  CashFlowReport,
  ChangesInEquityReport,
  GeneralLedgerReport,
  JournalListingReport,
  ProfitAndLossReport,
  ReportEnvelope,
  ReportKey,
  ReportSection,
  StockValuation,
  TrialBalanceReport,
  VatRegisterReport,
  VatReturnDraft,
  WithholdingRegister,
} from '../../reports/api';

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm 10mm 14mm; }
  html, body { background: #ffffff !important; }
  #root { display: none !important; }
  .ql-report-print-overlay {
    position: static !important; inset: auto !important; display: block !important;
    background: #ffffff !important; padding: 0 !important; backdrop-filter: none !important;
  }
  .ql-report-print-chrome { display: none !important; }
  .ql-report-print-scroll { overflow: visible !important; padding: 0 !important; margin: 0 !important; }
  .ql-report-print-sheet {
    width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
    border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
    page-break-after: always; break-after: page;
  }
  .ql-report-print-sheet:last-child { page-break-after: auto; break-after: auto; }
  .ql-report-print-sheet table { page-break-inside: auto; }
  .ql-report-print-sheet tr { page-break-inside: avoid; }
  .ql-report-print-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

function sectionTable(section: ReportSection, money: MoneyFn, locale: Locale): JSX.Element {
  return (
    <div key={section.key} className="mb-4">
      <h3 className="mb-1 border-b border-black pb-1 text-[12px] font-bold uppercase tracking-[0.08em]">
        {localized(locale, section.titleEn, section.titleBn)}
      </h3>
      <table className="w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            <th className="border border-black px-1 py-0.5 text-left">{localized(locale, 'Account', 'হিসাব')}</th>
            <th className="border border-black px-1 py-0.5 text-right">{localized(locale, 'Current', 'চলতি')}</th>
            <th className="border border-black px-1 py-0.5 text-right">{localized(locale, 'Comparative', 'তুলনামূলক')}</th>
          </tr>
        </thead>
        <tbody>
          {section.lines.map((line) => (
            <tr key={`${section.key}:${line.accountId ?? line.accountNameEn}`}>
              <td className="border border-black px-1 py-0.5">
                {line.accountCode ? `${line.accountCode} — ` : ''}
                {localized(locale, line.accountNameEn, line.accountNameBn ?? line.accountNameEn)}
              </td>
              <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(line.amountPoisha))}</td>
              <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(line.comparativePoisha))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="border border-black px-1 py-0.5">{localized(locale, 'Section total', 'অংশের মোট')}</td>
            <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(section.totalPoisha))}</td>
            <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(section.comparativeTotalPoisha))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type MoneyFn = (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
type Locale = 'en-BD' | 'bn-BD';

export function ReportPrintModal({
  open,
  report,
  reportKey,
  locale,
  money,
  onClose,
  onPrint,
}: {
  open: boolean;
  report: ReportEnvelope;
  reportKey: ReportKey;
  locale: Locale;
  money: MoneyFn;
  onClose: () => void;
  onPrint: (format: 'PDF' | 'PRINT') => Promise<boolean>;
}) {
  if (!open) return null;
  const L = (en: string, bn: string) => localized(locale, en, bn);
  const isVatDraft = reportKey === 'VAT_RETURN_DRAFT';
  const statement = ['PROFIT_AND_LOSS', 'BALANCE_SHEET', 'CASH_FLOW'].includes(reportKey);
  const isPaginated = ['VAT_SALES_REGISTER', 'VAT_PURCHASE_REGISTER', 'JOURNAL_LISTING'].includes(reportKey);

  const content = (
    <div className="ql-report-print-overlay fixed inset-0 z-[70] flex flex-col bg-ink-900/70">
      <style>{PRINT_CSS}</style>
      <div className="ql-report-print-chrome flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-ink-950 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-white/10 p-1.5 text-white" aria-label={L('Back', 'ফিরে যান')}>
            <ArrowLeft size={15} />
          </button>
          <div>
            <p className="text-[12px] font-semibold">{L('Report print preview', 'রিপোর্ট প্রিন্ট প্রিভিউ')}</p>
            <p className="text-[12px] text-ink-300">{L('A4 · same figures as the screen · no audit opinion', 'এ৪ · স্ক্রিনের মতো একই সংখ্যা · কোনো নিরীক্ষা মতামত নেই')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void onPrint('PDF').then((ok) => {
              if (ok) window.print();
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gold-400 px-3 py-1.5 text-[12px] font-semibold text-ink-950"
        >
          <Printer size={14} /> {L('Print / Save as PDF', 'প্রিন্ট / পিডিএফ সংরক্ষণ')}
        </button>
      </div>
      <div className="ql-report-print-scroll flex-1 overflow-y-auto bg-ink-200/60 p-4">
        <div className="ql-report-print-sheet mx-auto min-h-[297mm] w-full max-w-[210mm] border border-black/20 bg-white p-8 text-black shadow-2xl">
          <header className="border-b-2 border-black pb-3">
            <p className="text-[9pt] font-bold uppercase tracking-[0.14em]">{report.scope.companyName}</p>
            <h1 className="mt-1 text-[15pt] font-bold leading-tight">{localized(locale, report.titleEn, report.titleBn)}</h1>
            <p className="mt-1 text-[9pt]">
              {localized(locale, report.scope.labelEn, report.scope.labelBn)}
              {report.scope.branchName ? ` · ${report.scope.branchName}` : ''}
            </p>
            <p className="mt-0.5 text-[9pt]">
              {L('BIN', 'বিআইএন')}: {report.scope.companyBin ?? L('Not configured', 'নির্ধারিত নয়')} · {L('Template', 'টেমপ্লেট')}: {report.template.version}
            </p>
            <p className="mt-1 text-[9pt] font-bold uppercase tracking-[0.08em]">
              {isVatDraft
                ? 'DRAFT — NOT FILED'
                : statement
                  ? L('Management accounts — unaudited', 'ব্যবস্থাপনা হিসাব — নিরীক্ষিত নয়')
                  : L(report.template.labelEn, report.template.labelBn)}
            </p>
          </header>

          <section className="mt-3 border border-black/40 p-2 text-[8.5pt]">
            <p className="font-bold">{L('Control checks', 'নিয়ন্ত্রণ পরীক্ষা')}</p>
            <ul className="mt-1 list-disc pl-4">
              {report.checks.map((check) => (
                <li key={check.key}>
                  {check.passed ? L('PASS', 'উত্তীর্ণ') : L('FAIL', 'ব্যর্থ')} — {localized(locale, check.labelEn, check.labelBn)}
                  {check.differencePoisha && check.differencePoisha !== '0' ? ` (${L('difference', 'পার্থক্য')} ${check.differencePoisha} poisha)` : ''}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-4">
            {statement ? (
              <>
                {(report as ProfitAndLossReport | BalanceSheetReport | CashFlowReport).sections.map((section) =>
                  sectionTable(section, money, locale),
                )}
                <table className="mb-4 w-full border-collapse text-[8.5pt]">
                  <tbody>
                    {reportKey === 'PROFIT_AND_LOSS'
                      ? [
                          ['Revenue', 'রাজস্ব', (report as ProfitAndLossReport).totals.revenuePoisha],
                          ['Gross profit', 'মোট মুনাফা', (report as ProfitAndLossReport).totals.grossProfitPoisha],
                          ['Operating profit', 'পরিচালন মুনাফা', (report as ProfitAndLossReport).totals.operatingProfitPoisha],
                          ['Profit before tax', 'করপূর্ব মুনাফা', (report as ProfitAndLossReport).totals.profitBeforeTaxPoisha],
                          ['Income tax expense', 'আয়কর ব্যয়', (report as ProfitAndLossReport).totals.taxExpensePoisha],
                          ['Profit for the period', 'সময়কালের মুনাফা', (report as ProfitAndLossReport).totals.profitForPeriodPoisha],
                        ].map(([en, bn, value]) => (
                          <tr key={en} className={en === 'Profit for the period' ? 'font-bold' : ''}>
                            <td className="border border-black px-1 py-0.5">{localized(locale, en!, bn!)}</td>
                            <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(value!))}</td>
                          </tr>
                        ))
                      : null}
                    {reportKey === 'BALANCE_SHEET'
                      ? [
                          ['Total assets', 'মোট সম্পদ', (report as BalanceSheetReport).totals.totalAssetsPoisha],
                          ['Total equity', 'মোট ইকুইটি', (report as BalanceSheetReport).totals.equityPoisha],
                          ['Total liabilities', 'মোট দায়', String(BigInt((report as BalanceSheetReport).totals.liabilitiesNonCurrentPoisha) + BigInt((report as BalanceSheetReport).totals.liabilitiesCurrentPoisha))],
                          ['Total equity and liabilities', 'মোট ইকুইটি ও দায়', (report as BalanceSheetReport).totals.totalEquityAndLiabilitiesPoisha],
                          ['Imbalance (must be zero)', 'অসামঞ্জস্য (শূন্য হতে হবে)', (report as BalanceSheetReport).totals.imbalancePoisha],
                        ].map(([en, bn, value]) => (
                          <tr key={en} className={en === 'Imbalance (must be zero)' ? 'font-bold' : ''}>
                            <td className="border border-black px-1 py-0.5">{localized(locale, en!, bn!)}</td>
                            <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(value!))}</td>
                          </tr>
                        ))
                      : null}
                    {reportKey === 'CASH_FLOW'
                      ? [
                          ['Opening cash', 'প্রারম্ভিক নগদ', (report as CashFlowReport).openingCashPoisha],
                          ['Net movement in cash', 'নগদে নিট পরিবর্তন', (report as CashFlowReport).netChangePoisha],
                          ['Closing cash', 'সমাপনী নগদ', (report as CashFlowReport).closingCashPoisha],
                        ].map(([en, bn, value]) => (
                          <tr key={en} className={en === 'Closing cash' ? 'font-bold' : ''}>
                            <td className="border border-black px-1 py-0.5">{localized(locale, en!, bn!)}</td>
                            <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(value!))}</td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </>
            ) : null}

            {reportKey === 'CHANGES_IN_EQUITY' ? (
              <table className="w-full border-collapse text-[9pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Movement', 'চলাচল')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Share capital', 'শেয়ার মূলধন')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Retained earnings', 'সঞ্চিত মুনাফা')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Reserves', 'সঞ্চিতি')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Total', 'মোট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as ChangesInEquityReport).rows.map((row) => (
                    <tr key={row.key}>
                      <td className="border border-black px-1 py-0.5">{L(row.labelEn, row.labelBn)}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.shareCapitalPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.retainedEarningsPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.reservesPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.totalPoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'TRIAL_BALANCE' ? (
              <table className="w-full border-collapse text-[7.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Code', 'কোড')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Account', 'হিসাব')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Opening Dr', 'উদ্বোধনী ডেবিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Opening Cr', 'উদ্বোধনী ক্রেডিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Period Dr', 'মেয়াদ ডেবিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Period Cr', 'মেয়াদ ক্রেডিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Closing Dr', 'সমাপনী ডেবিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Closing Cr', 'সমাপনী ক্রেডিট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as TrialBalanceReport).trialBalance.rows.map((row) => (
                    <tr key={row.accountId}>
                      <td className="border border-black px-1 py-0.5 font-mono">{row.accountCode}</td>
                      <td className="border border-black px-1 py-0.5">{localized(locale, row.accountNameEn, row.accountNameBn ?? row.accountNameEn)}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.openingDebitPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.openingCreditPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.periodDebitPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.periodCreditPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.closingDebitPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.closingCreditPoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'GENERAL_LEDGER' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Date', 'তারিখ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Journal', 'জার্নাল')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Narration', 'বিবরণ')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Debit', 'ডেবিট')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Credit', 'ক্রেডিট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as GeneralLedgerReport).lines.map((line) => (
                    <tr key={`${line.journalId}-${line.lineNo}`}>
                      <td className="border border-black px-1 py-0.5">{line.postingDate}</td>
                      <td className="border border-black px-1 py-0.5 font-mono">{line.journalNumber ?? ''}</td>
                      <td className="border border-black px-1 py-0.5">{line.narration}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(line.debitPoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(line.creditPoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'AR_AGEING' || reportKey === 'AP_AGEING' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Document', 'ডকুমেন্ট')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Party', 'পক্ষ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Due', 'পরিশোধ')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Outstanding', 'বকেয়া')}</th>
                  </tr>
                </thead>
                <tbody>
                  {((report as AgeingReport).ageing.rows as Array<Record<string, unknown>>).map((row) => (
                    <tr key={String(row.documentId)}>
                      <td className="border border-black px-1 py-0.5 font-mono">{String(row.documentNo ?? row.supplierInvoiceNo ?? '')}</td>
                      <td className="border border-black px-1 py-0.5">{String(row.partyNameEn ?? '')}</td>
                      <td className="border border-black px-1 py-0.5">{String(row.dueDate ?? '')}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(String(row.outstandingPoisha ?? '0')))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'STOCK_VALUATION' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('SKU', 'এসকেইউ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Item', 'আইটেম')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Warehouse', 'গুদাম')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Quantity', 'পরিমাণ')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Value', 'মূল্য')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as StockValuation).rows.map((row) => (
                    <tr key={`${row.itemId}-${row.warehouseId}`}>
                      <td className="border border-black px-1 py-0.5 font-mono">{row.sku}</td>
                      <td className="border border-black px-1 py-0.5">{localized(locale, row.itemNameEn, row.itemNameBn ?? row.itemNameEn)}</td>
                      <td className="border border-black px-1 py-0.5">{row.warehouseCode}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{row.quantity}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.valuePoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'VAT_SALES_REGISTER' || reportKey === 'VAT_PURCHASE_REGISTER' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Date', 'তারিখ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Document', 'ডকুমেন্ট')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Mushak serial', 'মূসক সিরিয়াল')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Party', 'পক্ষ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Category', 'শ্রেণি')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Base', 'বেস')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('VAT', 'ভ্যাট')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as VatRegisterReport).rows.map((row) => (
                    <tr key={`${row.documentId}-${row.lineNo}`}>
                      <td className="border border-black px-1 py-0.5">{row.documentDate}</td>
                      <td className="border border-black px-1 py-0.5 font-mono">{row.documentNo ?? ''}</td>
                      <td className="border border-black px-1 py-0.5 font-mono">{row.statutorySerial ?? ''}</td>
                      <td className="border border-black px-1 py-0.5">{row.partyNameEn}</td>
                      <td className="border border-black px-1 py-0.5">{row.taxCategory}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.basePoisha))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(row.vatPoisha))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'VAT_RETURN_DRAFT' ? (
              <div className="space-y-3">
                {(report as VatReturnDraft).parts.map((part) => (
                  <div key={part.part}>
                    <h3 className="border-b border-black pb-1 text-[10pt] font-bold">{part.part}. {localized(locale, part.titleEn, part.titleBn)}</h3>
                    <table className="mt-1 w-full border-collapse text-[8.5pt]">
                      <tbody>
                        {part.rows.map((row) => (
                          <tr key={`${part.part}:${row.labelEn}`}>
                            <td className="border border-black px-1 py-0.5">{localized(locale, row.labelEn, row.labelBn)}</td>
                            <td className="border border-black px-1 py-0.5 text-right font-mono">{row.amountPoisha !== '0' ? money(BigInt(row.amountPoisha)) : row.note ?? '—'}</td>
                          </tr>
                        ))}
                        <tr className="font-bold">
                          <td className="border border-black px-1 py-0.5">{L('Part total', 'অংশের মোট')}</td>
                          <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(part.totalPoisha))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : null}

            {reportKey === 'WITHHOLDING_REGISTER' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Tax', 'কর')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Period', 'সময়কাল')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Party', 'পক্ষ')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Base', 'বেস')}</th>
                    <th className="border border-black px-1 py-0.5 text-right">{L('Amount', 'পরিমাণ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as WithholdingRegister).rows.map((row) => (
                    <tr key={String(row.liabilityId)}>
                      <td className="border border-black px-1 py-0.5">{String(row.taxType)}</td>
                      <td className="border border-black px-1 py-0.5">{String(row.taxPeriod)}</td>
                      <td className="border border-black px-1 py-0.5">{String(row.partyNameEn)}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(String(row.basePoisha)))}</td>
                      <td className="border border-black px-1 py-0.5 text-right font-mono">{money(BigInt(String(row.amountPoisha)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {reportKey === 'JOURNAL_LISTING' ? (
              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Number', 'নম্বর')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Date', 'তারিখ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Source', 'উৎস')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Narration', 'বিবরণ')}</th>
                    <th className="border border-black px-1 py-0.5 text-left">{L('Status', 'অবস্থা')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report as JournalListingReport).entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="border border-black px-1 py-0.5 font-mono">{entry.journalNumber ?? ''}</td>
                      <td className="border border-black px-1 py-0.5">{entry.postingDate}</td>
                      <td className="border border-black px-1 py-0.5">{entry.sourceModule}</td>
                      <td className="border border-black px-1 py-0.5">{entry.narrationEn}</td>
                      <td className="border border-black px-1 py-0.5">{entry.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>

          <footer className="mt-6 border-t border-black pt-2 text-[8pt]">
            <p>
              {L(
                'Prepared from posted journals and posted documents for the selected company, branch and period. Management accounts are unaudited. No audit opinion, government receipt or filing acknowledgement is included.',
                'নির্বাচিত কোম্পানি, শাখা ও সময়কালের পোস্টকৃত জার্নাল ও ডকুমেন্ট থেকে প্রস্তুত। ব্যবস্থাপনা হিসাব নিরীক্ষিত নয়। কোনো নিরীক্ষা মতবত, সরকারি রসিদ বা দাখিল স্বীকৃতি অন্তর্ভুক্ত নেই।',
              )}
            </p>
            <p className="mt-1">
              {L('Generated', 'তৈরি')}: {new Date(report.generatedAt).toISOString()} · {L('Template', 'টেমপ্লেট')}: {report.template.version} · {L('Review status', 'পর্যালোচনা অবস্থা')}: {report.reviewStatus}
            </p>
            {isPaginated ? (
              <p className="mt-1 font-semibold">
                {L(
                  'This print view shows the current page. Use CSV/XLSX export for the full register or listing.',
                  'এই প্রিন্ট ভিউ বর্তমান পৃষ্ঠা দেখায়। সম্পূর্ণ রেজিস্টার বা তালিকার জন্য সিএসভি/এক্সএলএসএক্স রপ্তানি ব্যবহার করুন।',
                )}
              </p>
            ) : null}
          </footer>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
