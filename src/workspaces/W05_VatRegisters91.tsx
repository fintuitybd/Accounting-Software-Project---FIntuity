// Fintuity Accounting Suite — W05 internal VAT registers and draft VAT workbook.
//
// Four statutory views on one ledger:
//   • Mushak 6.1 — purchase register
//   • Mushak 6.2 — sales register
//   • VAT current account (Note 18) with the subledger proof
//   • Mushak 9.1 — monthly return assembly with zero-variance GL proof, .xlsx export and A4 print
//
// Customer Mushak 6.6 certificates marked received in W04 flow straight into Part 6 as a decreasing
// adjustment; the GL proof is computed from the immutable journals, never from a display KPI.

import { useMemo, useState } from 'react';
import { downloadSpreadsheetWorkbook } from '../core/import-export/xlsxEngine';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Calculator,
  CircleCheck,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Layers,
  Printer,
  Scale,
  Search,
  ShieldCheck,
  Sigma,
  Table2,
  TriangleAlert,
} from 'lucide-react';

import { WorkspaceHeader } from '../components/commercial/CommercialShared';
import { StatutoryPrintModal } from '../components/signature/StatutoryPrintModal';
import { accountBalance } from '../core/ledger/ledgerEngine';
import type { TaxAnnotatedDoc } from '../core/ledger/ledgerEngine';
import { formatDate, poishaToBdtNumber } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { Mushak91Part, Mushak91Return, MushakRegisterRow } from '../core/types';

type Tab = 'PURCHASE' | 'SALES' | 'NOTE18' | 'RETURN';

type MoneyFn = (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;

const TABS: Array<{ id: Tab; en: string; bn: string; icon: JSX.Element }> = [
  { id: 'PURCHASE', en: 'Mushak 6.1 · Purchases', bn: 'মূসক ৬.১ · ক্রয়', icon: <Table2 size={12} /> },
  { id: 'SALES', en: 'Mushak 6.2 · Sales', bn: 'মূসক ৬.২ · বিক্রয়', icon: <FileText size={12} /> },
  { id: 'NOTE18', en: 'Note 18 · VAT current A/C', bn: 'নোট ১৮ · ভ্যাট চলতি হিসাব', icon: <Layers size={12} /> },
  { id: 'RETURN', en: 'Mushak 9.1 · Return', bn: 'মূসক ৯.১ · রিটার্ন', icon: <BookOpen size={12} /> },
];

function sumRows(rows: MushakRegisterRow[], pick: (row: MushakRegisterRow) => bigint): bigint {
  return rows.reduce((total, row) => total + pick(row), 0n);
}

function RegisterTable({
  rows,
  money,
  locale,
  isBn,
  query,
  onQuery,
  emptyEn,
  emptyBn,
}: {
  rows: MushakRegisterRow[];
  money: MoneyFn;
  locale: 'en-BD' | 'bn-BD';
  isBn: boolean;
  query: string;
  onQuery: (value: string) => void;
  emptyEn: string;
  emptyBn: string;
}) {
  const L = (en: string, bn: string): string => (isBn ? bn : en);
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      !needle ||
      row.doc_number.toLowerCase().includes(needle) ||
      row.party_name.toLowerCase().includes(needle) ||
      row.party_bin.includes(needle) ||
      row.description.toLowerCase().includes(needle),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3">
        <label className="relative min-w-[240px] flex-1 sm:max-w-[360px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="ql-input !py-1.5 pl-8 text-[12px]"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={isBn ? 'দলিল / পক্ষ / বিআইএন খুঁজুন…' : 'Search document, party or BIN…'}
          />
        </label>
        <span className="text-[10px] text-ink-400">{filtered.length} / {rows.length} {L('lines', 'লাইন')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ql-table min-w-[1060px]">
          <thead>
            <tr>
              <th>#</th>
              <th>{L('Date', 'তারিখ')}</th>
              <th>{L('Document', 'দলিল')}</th>
              <th>{L('Party / BIN', 'পক্ষ / বিআইএন')}</th>
              <th>{L('Description', 'বিবরণ')}</th>
              <th className="text-right">{L('Value', 'মূল্য')}</th>
              <th className="text-right">SD</th>
              <th className="text-right">{L('VAT', 'ভ্যাট')}</th>
              <th className="text-right">{L('VDS', 'ভিডিএস')}</th>
              <th className="text-right">{L('Total', 'মোট')}</th>
              <th>{L('Rebate', 'রিবেট')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.serial}-${row.doc_number}`}>
                <td className="font-mono text-[9.5px] text-ink-400">{row.serial}</td>
                <td className="whitespace-nowrap text-[10.5px]">{formatDate(row.date, locale)}</td>
                <td className="font-mono text-[10px] font-semibold text-ink-900">{row.doc_number}</td>
                <td>
                  <p className="max-w-[190px] truncate text-[10.5px] font-medium text-ink-800">{row.party_name}</p>
                  <p className="font-mono text-[9px] text-ink-400">{row.party_bin || '—'}</p>
                </td>
                <td className="max-w-[220px] truncate text-[10px] text-ink-500" title={row.description}>{row.description}</td>
                <td className="font-money text-right text-[10.5px]">{money(row.value_poisha)}</td>
                <td className="font-money text-right text-[10.5px]">{row.sd_poisha > 0n ? money(row.sd_poisha) : '—'}</td>
                <td className="font-money text-right text-[10.5px] text-indigo-700">{money(row.vat_poisha)}</td>
                <td className="font-money text-right text-[10.5px] text-violet-700">{row.vds_poisha > 0n ? money(row.vds_poisha) : '—'}</td>
                <td className="font-money text-right text-[10.5px] font-semibold text-ink-900">{money(row.total_poisha)}</td>
                <td>
                  {row.eligible_rebate ? (
                    <span className="ql-badge ql-badge-success">{L('Eligible', 'যোগ্য')}</span>
                  ) : (
                    <span className="ql-badge ql-badge-danger" title={row.disallowance_reason ?? ''}>{L('Disallowed', 'বাতিল')}</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="py-10 text-center text-xs text-ink-400">{isBn ? emptyBn : emptyEn}</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50/80 font-semibold">
              <td colSpan={5} className="px-3 py-2 text-right text-[9.5px] uppercase tracking-[0.12em] text-ink-500">{L('Register totals', 'রেজিস্টার মোট')}</td>
              <td className="font-money px-3 py-2 text-right text-[10.5px] text-ink-900">{money(sumRows(filtered, (row) => row.value_poisha), { symbol: false })}</td>
              <td className="font-money px-3 py-2 text-right text-[10.5px]">{money(sumRows(filtered, (row) => row.sd_poisha), { symbol: false })}</td>
              <td className="font-money px-3 py-2 text-right text-[10.5px] text-indigo-700">{money(sumRows(filtered, (row) => row.vat_poisha), { symbol: false })}</td>
              <td className="font-money px-3 py-2 text-right text-[10.5px] text-violet-700">{money(sumRows(filtered, (row) => row.vds_poisha), { symbol: false })}</td>
              <td className="font-money px-3 py-2 text-right text-[10.5px] text-ink-900">{money(sumRows(filtered, (row) => row.total_poisha), { symbol: false })}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export default function W05_VatRegisters91() {
  const { locale, money, tenant, commercialDocs, journals, reconciliation, vdsCertificates, challans, periods, statementPeriodCode, setStatementPeriodCode } = useVault();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [tab, setTab] = useState<Tab>('PURCHASE');
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const [salesQuery, setSalesQuery] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [exportedAt, setExportedAt] = useState<string | null>(null);

  const periodCode = statementPeriodCode;
  const periodRecord = periods.find((period) => period.code === periodCode) ?? periods[0];
  const periodEnd = periodRecord?.end_date ?? '';
  const filing = {
    due_date: '—',
    days_after_period: 0,
    period_label: periodCode,
    rule_id: 'NOT_VERIFIED',
    citation: L('Filing deadline and statutory template not verified', 'দাখিলের সময়সীমা ও সংবিধিবদ্ধ টেমপ্লেট যাচাইকৃত নয়'),
    holiday_adjusted: false,
    explanation_en: 'No verified filing deadline is configured. This is an internal draft for professional review, not a filing.',
    explanation_bn: 'কোনো যাচাইকৃত দাখিলের সময়সীমা কনফিগার করা নেই। এটি পেশাদার পর্যালোচনার জন্য অভ্যন্তরীণ খসড়া, দাখিল নয়।',
  };

  const books = useMemo(() => {
    const periodDocs = commercialDocs.filter((doc) => doc.doc_date.slice(0, 7) === periodCode && doc.status === 'POSTED');
    const salesDocs = periodDocs.filter((doc) => doc.doc_type === 'SALES_INVOICE' || doc.doc_type === 'CREDIT_NOTE');
    const purchaseDocs = periodDocs.filter(
      (doc) => doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER' || doc.doc_type === 'IMPORTED_SERVICE',
    );

    const toRow = (doc: TaxAnnotatedDoc, index: number): MushakRegisterRow => {
      // Mushak 6.7 credit notes reduce both the taxable value and the output tax in the register.
      const sign = doc.doc_type === 'CREDIT_NOTE' ? -1n : 1n;
      return {
        serial: String(index + 1).padStart(3, '0'),
        doc_number: doc.doc_number,
        date: doc.doc_date,
        party_name: isBn ? doc.party_name_bn : doc.party_name_en,
        party_bin: doc.party_bin ?? '',
        description: isBn ? doc.narration_bn : doc.narration_en,
        value_poisha: sign * doc.base_poisha,
        sd_poisha: sign * doc.sd_poisha,
        vat_poisha: sign * doc.vat_poisha,
        vds_poisha: sign * doc.vds_poisha,
        total_poisha: sign * doc.gross_poisha,
        eligible_rebate: doc.doc_type !== 'CREDIT_NOTE' && doc.tax_claimable_poisha > 0n,
        disallowance_reason:
          doc.tax_disallowed_poisha > 0n
            ? doc.tax_conditions.find((condition) => condition.severity === 'BLOCKER' || condition.code.includes('CASH'))?.message_en ?? 'Input credit disallowed'
            : undefined,
      };
    };

    const salesRows = salesDocs.map(toRow);
    const purchaseRows = purchaseDocs.map(toRow);
    const outputTax = sumRows(salesRows, (row) => row.vat_poisha);
    const purchaseVat = sumRows(purchaseRows, (row) => row.vat_poisha);
    const rebate = purchaseDocs.reduce((total, doc) => total + doc.tax_claimable_poisha, 0n);
    const disallowed = purchaseDocs.reduce((total, doc) => total + doc.tax_disallowed_poisha, 0n);

    const receivedCertificates = vdsCertificates.filter(
      (certificate) => certificate.direction === 'RECEIVED' && (certificate.status === 'RECEIVED' || certificate.status === 'VERIFIED'),
    );
    const decreasing = receivedCertificates.reduce((total, certificate) => total + certificate.vds_poisha, 0n);

    const net = outputTax - rebate - decreasing;
    const closing = net < 0n ? -net : 0n;

    const periodJournals = journals.filter(
      (journal) =>
        journal.period_code === periodCode &&
        journal.source_module !== 'OPENING_BALANCE' &&
        !(journal.source_doc_ref ?? '').startsWith('MUSHAK-9.1'),
    );
    const glOutput = -accountBalance(periodJournals, '2120');
    const glInput = accountBalance(periodJournals, '1140');
    const coreVariance = (outputTax - glOutput) - (rebate - glInput);
    const reconciled = coreVariance === 0n;

    const signed = (doc: TaxAnnotatedDoc, amount: bigint): bigint =>
      doc.doc_type === 'CREDIT_NOTE' ? -amount : amount;
    const salesBase = salesDocs
      .filter((doc) => doc.tax_category !== 'EXPORT_ZERO' && doc.tax_category !== 'EXEMPT')
      .reduce((total, doc) => total + signed(doc, doc.base_poisha), 0n);
    const zeroBase = salesDocs.filter((doc) => doc.tax_category === 'EXPORT_ZERO').reduce((total, doc) => total + signed(doc, doc.base_poisha), 0n);
    const exemptBase = salesDocs.filter((doc) => doc.tax_category === 'EXEMPT').reduce((total, doc) => total + signed(doc, doc.base_poisha), 0n);
    const sdTotal = salesDocs.reduce((total, doc) => total + signed(doc, doc.sd_poisha), 0n);
    const purchaseBase = purchaseDocs.reduce((total, doc) => total + doc.base_poisha, 0n);
    const vdsTotal = purchaseDocs.reduce((total, doc) => total + doc.vds_poisha, 0n);
    const tdsTotal = purchaseDocs.reduce((total, doc) => total + doc.tds_poisha, 0n);
    const creditNoteVat = salesDocs
      .filter((doc) => doc.doc_type === 'CREDIT_NOTE')
      .reduce((total, doc) => total - doc.vat_poisha, 0n);
    const reverseChargeVat = purchaseDocs
      .filter((doc) => doc.reverse_charge)
      .reduce((total, doc) => total + doc.vat_poisha, 0n);
    const depositedVat = challans
      .filter((challan) => challan.period_code === periodCode && challan.status === 'DEPOSITED' && challan.type === 'VAT')
      .reduce((total, challan) => total + challan.amount_poisha, 0n);
    const depositedVds = challans
      .filter((challan) => challan.period_code === periodCode && challan.status === 'DEPOSITED' && challan.type === 'VDS')
      .reduce((total, challan) => total + challan.amount_poisha, 0n);

    const parts: Mushak91Part[] = [
      {
        part: 1,
        title_en: 'Taxpayer identity & return period',
        title_bn: 'করদাতার পরিচয় ও রিটার্ন সময়কাল',
        total_poisha: 0n,
        rows: [
          { label_en: 'BIN', label_bn: 'বিআইএন', amount_poisha: 0n, note: tenant.bin_units[0]?.bin_number ?? tenant.tin_number },
          { label_en: 'Legal name', label_bn: 'নিবন্ধিত নাম', amount_poisha: 0n, note: tenant.name_en },
          { label_en: 'Return period', label_bn: 'রিটার্ন সময়কাল', amount_poisha: 0n, note: periodCode },
          { label_en: 'Filing status', label_bn: 'দাখিলের অবস্থা', amount_poisha: 0n, note: L('Draft — not filed; deadline unverified', 'খসড়া — দাখিল হয়নি; সময়সীমা যাচাইকৃত নয়') },
        ],
      },
      {
        part: 2,
        title_en: 'Taxable supplies (output)',
        title_bn: 'করযোগ্য সরবরাহ (আউটপুট)',
        total_poisha: outputTax,
        rows: [
          { label_en: 'Standard-rated taxable value', label_bn: 'আদর্শ হারে করযোগ্য মূল্য', amount_poisha: salesBase },
          { label_en: 'Supplementary duty', label_bn: 'সম্পূরক শুল্ক', amount_poisha: sdTotal },
          { label_en: 'Output VAT', label_bn: 'আউটপুট ভ্যাট', amount_poisha: outputTax },
        ],
      },
      {
        part: 3,
        title_en: 'Zero-rated & exempt supplies',
        title_bn: 'শূন্য হার ও অব্যাহতিপ্রাপ্ত সরবরাহ',
        total_poisha: zeroBase + exemptBase,
        rows: [
          { label_en: 'Export / zero-rated value', label_bn: 'রপ্তানি / শূন্য হার মূল্য', amount_poisha: zeroBase },
          { label_en: 'Exempt supplies', label_bn: 'অব্যাহতিপ্রাপ্ত সরবরাহ', amount_poisha: exemptBase },
        ],
      },
      {
        part: 4,
        title_en: 'Purchases & input tax',
        title_bn: 'ক্রয় ও ইনপুট কর',
        total_poisha: purchaseVat,
        rows: [
          { label_en: 'Local taxable purchases', label_bn: 'স্থানীয় করযোগ্য ক্রয়', amount_poisha: purchaseBase },
          { label_en: 'Input VAT on purchases', label_bn: 'ক্রয়ের ইনপুট মূসক', amount_poisha: purchaseVat },
          { label_en: 'Imported services (reverse charge)', label_bn: 'আমদানি সেবা (রিভার্স চার্জ)', amount_poisha: reverseChargeVat },
        ],
      },
      {
        part: 5,
        title_en: 'VAT withheld at source',
        title_bn: 'উৎসে কর্তিত মূসক',
        total_poisha: vdsTotal,
        rows: [
          { label_en: 'VDS withheld from suppliers', label_bn: 'সরবরাহকারীদের নিকট হতে কর্তিত ভিডিএস', amount_poisha: vdsTotal },
          { label_en: 'VDS deposited with treasury challan', label_bn: 'ট্রেজারি চালানে জমাকৃত ভিডিএস', amount_poisha: depositedVds, note: `${challans.filter((challan) => challan.period_code === periodCode && challan.status === 'DEPOSITED' && challan.type === 'VDS').length} challans` },
        ],
      },
      {
        part: 6,
        title_en: 'Decreasing adjustment — customer Mushak 6.6 received',
        title_bn: 'হ্রাস সমন্বয় — প্রাপ্ত গ্রাহক মূসক ৬.৬',
        total_poisha: decreasing + creditNoteVat,
        rows: [
          {
            label_en: `Customer Mushak 6.6 certificates received (${receivedCertificates.length})`,
            label_bn: `প্রাপ্ত গ্রাহক মূসক ৬.৬ সনদ (${receivedCertificates.length}টি)`,
            amount_poisha: decreasing,
            note: receivedCertificates.length ? undefined : 'None received',
          },
          {
            label_en: 'Credit notes included as negative output lines',
            label_bn: 'ঋণাত্মক আউটপুট লাইন হিসেবে অন্তর্ভুক্ত ক্রেডিট নোট',
            amount_poisha: creditNoteVat,
            note: 'No separate bad-debt relief is claimed.',
          },
        ],
      },
      {
        part: 7,
        title_en: 'Increasing adjustment — disallowed input',
        title_bn: 'বৃদ্ধি সমন্বয় — অগ্রহণযোগ্য ইনপুট',
        total_poisha: disallowed,
        rows: [
          { label_en: 'Input VAT disallowed by the purchase decision', label_bn: 'ক্রয় সিদ্ধান্ত দ্বারা বাতিল ইনপুট ভ্যাট', amount_poisha: disallowed },
        ],
      },
      {
        part: 8,
        title_en: 'Input rebate claimed',
        title_bn: 'দাবিকৃত ইনপুট রিবেট',
        total_poisha: rebate,
        rows: [
          { label_en: 'Input VAT on eligible local purchases', label_bn: 'যোগ্য স্থানীয় ক্রয়ের ইনপুট ভ্যাট', amount_poisha: rebate },
          { label_en: 'Imported services under reverse charge', label_bn: 'রিভার্স চার্জে আমদানি সেবা', amount_poisha: reverseChargeVat },
        ],
      },
      {
        part: 9,
        title_en: 'Net VAT payable',
        title_bn: 'নিট প্রদেয় মূসক',
        total_poisha: net,
        rows: [
          { label_en: 'Output VAT', label_bn: 'আউটপুট মূসক', amount_poisha: outputTax },
          { label_en: 'Less: input rebate', label_bn: 'বিয়োগ: ইনপুট রিবেট', amount_poisha: -rebate },
          { label_en: 'Less: customer 6.6 decreasing adjustment', label_bn: 'বিয়োগ: গ্রাহক ৬.৬ হ্রাস সমন্বয়', amount_poisha: -decreasing },
        ],
      },
      {
        part: 10,
        title_en: 'Closing balance carried forward',
        title_bn: 'পরবর্তী সময়ে বহনযোগ্য উদ্বৃত্ত',
        total_poisha: closing,
        rows: [{ label_en: 'Excess input rebate c/f', label_bn: 'অতিরিক্ত ইনপুট রিবেট বহন', amount_poisha: closing }],
      },
      {
        part: 11,
        title_en: 'TDS & deposit reconciliation',
        title_bn: 'টিডিএস ও জমা মিলকরণ',
        total_poisha: tdsTotal + depositedVat,
        rows: [
          { label_en: 'TDS withheld (internal register)', label_bn: 'কর্তিত টিডিএস (অভ্যন্তরীণ রেজিস্টার)', amount_poisha: tdsTotal },
          { label_en: 'VAT deposited by challan in the period', label_bn: 'সময়কালে চালানে জমাকৃত মূসক', amount_poisha: depositedVat, note: `${challans.filter((challan) => challan.period_code === periodCode && challan.status === 'DEPOSITED' && challan.type === 'VAT').length} challans` },
        ],
      },
      {
        part: 12,
        title_en: 'GL tie-out proof',
        title_bn: 'জিএল মিলকরণ প্রমাণ',
        total_poisha: coreVariance,
        rows: [
          { label_en: 'Output VAT per 2120 control account', label_bn: '২১২০ নিয়ন্ত্রণ হিসাবে আউটপুট মূসক', amount_poisha: glOutput },
          { label_en: 'Input VAT per 1140 control account', label_bn: '১১৪০ নিয়ন্ত্রণ হিসাবে ইনপুট মূসক', amount_poisha: glInput },
          { label_en: 'Variance (must be 0.00 BDT)', label_bn: 'পার্থক্য (০.০০ টাকা হতে হবে)', amount_poisha: coreVariance },
        ],
      },
    ];

    const return91: Mushak91Return = {
      period_code: periodCode,
      period_label: filing.period_label,
      bin: tenant.bin_units[0]?.bin_number ?? tenant.tin_number,
      legal_name: tenant.name_en,
      parts,
      output_tax_poisha: outputTax,
      input_rebate_poisha: rebate,
      increasing_adjustment_poisha: disallowed,
      decreasing_adjustment_poisha: decreasing,
      net_payable_poisha: net,
      closing_balance_poisha: closing,
      due_date: filing.due_date,
      filing_rule: filing,
      gl_output_vat_poisha: glOutput,
      gl_input_vat_poisha: glInput,
      gl_difference_poisha: coreVariance,
      reconciled,
      sales_register: salesRows,
      purchase_register: purchaseRows,
    };

    return { salesRows, purchaseRows, return91, coreVariance, reconciled, glOutput, glInput, decreasing, receivedCertificates };
  }, [commercialDocs, journals, vdsCertificates, filing, tenant, isBn, challans, periodCode]);

  const return91 = books.return91;
  const vatRow = reconciliation.rows.find((row) => row.key === 'VAT_CURRENT_ACCOUNT');
  const noteOpening = vatRow?.opening_control_poisha ?? 0n;
  const noteClosing = noteOpening + return91.input_rebate_poisha - return91.output_tax_poisha + books.decreasing;

  const exportWorkbook = (): void => {
    const summaryRows: Array<Array<unknown>> = [
      ['Fintuity Accounting Suite — internal VAT workbook (DRAFT — NOT FILED)'],
      ['Legal name', tenant.name_en],
      ['BIN', return91.bin],
      ['Report period', periodCode],
      ['Filing status', 'DRAFT — NOT FILED; deadline unverified'],
      ['Filing due date', 'Not verified'],
      ['Rule pack', 'bd-2026-v1'],
      [],
      ['Part', 'Title', 'Amount (BDT)'],
      ...return91.parts.map((part) => [part.part, part.title_en, poishaToBdtNumber(part.total_poisha)]),
      [],
      ['Output VAT', poishaToBdtNumber(return91.output_tax_poisha)],
      ['Input rebate', poishaToBdtNumber(return91.input_rebate_poisha)],
      ['Customer 6.6 decreasing adjustment', poishaToBdtNumber(return91.decreasing_adjustment_poisha)],
      ['Net payable', poishaToBdtNumber(return91.net_payable_poisha)],
      ['GL output VAT', poishaToBdtNumber(return91.gl_output_vat_poisha)],
      ['GL input VAT', poishaToBdtNumber(return91.gl_input_vat_poisha)],
      ['GL vs return variance (BDT)', poishaToBdtNumber(return91.gl_difference_poisha)],
      ['Reconciled', return91.reconciled ? 'YES' : 'NO'],
    ];

    const mapRegister = (rows: MushakRegisterRow[]): Array<Array<unknown>> => [
      ['Serial', 'Date', 'Document', 'Party', 'BIN', 'Description', 'Value (BDT)', 'SD (BDT)', 'VAT (BDT)', 'VDS (BDT)', 'Total (BDT)', 'Rebate eligible', 'Reason'],
      ...rows.map((row) => [
        row.serial,
        row.date,
        row.doc_number,
        row.party_name,
        row.party_bin,
        row.description,
        poishaToBdtNumber(row.value_poisha),
        poishaToBdtNumber(row.sd_poisha),
        poishaToBdtNumber(row.vat_poisha),
        poishaToBdtNumber(row.vds_poisha),
        poishaToBdtNumber(row.total_poisha),
        row.eligible_rebate ? 'YES' : 'NO',
        row.disallowance_reason ?? '',
      ]),
    ];

    const noteRows: Array<Array<unknown>> = [
      ['VAT current account — Note 18'],
      ['Opening balance', poishaToBdtNumber(noteOpening)],
      ['Add: input rebate', poishaToBdtNumber(return91.input_rebate_poisha)],
      ['Add: customer 6.6 decreasing adjustment', poishaToBdtNumber(books.decreasing)],
      ['Less: output tax', poishaToBdtNumber(return91.output_tax_poisha)],
      ['Closing balance', poishaToBdtNumber(noteClosing)],
      [],
      ['GL balance', poishaToBdtNumber(vatRow?.gl_balance_poisha ?? 0n)],
      ['Subledger balance', poishaToBdtNumber(vatRow?.subledger_balance_poisha ?? 0n)],
      ['Difference', poishaToBdtNumber(vatRow?.difference_poisha ?? 0n)],
    ];

    downloadSpreadsheetWorkbook(`Fintuity Accounting Suite-VAT-internal-draft-${periodCode}.xlsx`, [
      { name: 'Mushak 9.1', rows: summaryRows },
      { name: 'Mushak 6.1 purchases', rows: mapRegister(books.purchaseRows) },
      { name: 'Mushak 6.2 sales', rows: mapRegister(books.salesRows) },
      { name: 'Note 18', rows: noteRows },
    ]);
    setExportedAt(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  };

  return (
    <>
      <WorkspaceHeader
        icon={<BookOpen size={19} />}
        kickerEn="Workspace 05 · VAT registers"
        kickerBn="ওয়ার্কস্পেস ০৫ · ভ্যাট রেজিস্টার"
        titleEn="Mushak 6.1 / 6.2 registers & Mushak 9.1 return"
        titleBn="মূসক ৬.১ / ৬.২ রেজিস্টার ও মূসক ৯.১ রিটার্ন"
        isBn={isBn}
        chips={
          <>
            <span className="ql-badge ql-badge-neutral"><Clock size={12} /> {return91.period_code} · {return91.period_label}</span>
            <span className="ql-badge ql-badge-success"><ShieldCheck size={12} /> BIN {return91.bin}</span>
          </>
        }
        actions={
          <>
            <label className="text-[12px] font-semibold text-ink-600">
              <span className="sr-only">{L('VAT period', 'ভ্যাট সময়কাল')}</span>
              <select
                value={periodCode}
                onChange={(event) => setStatementPeriodCode(event.target.value)}
                className="ql-select min-h-9 text-[12px]"
              >
                {periods.map((period) => (
                  <option key={period.code} value={period.code}>{period.code} — {period.status}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ql-btn ql-btn-secondary !py-1.5" onClick={exportWorkbook}><Download size={14} /> {L('Export .xlsx', 'এক্সপোর্ট .xlsx')}</button>
            <button type="button" className="ql-btn ql-btn-primary !py-1.5" onClick={() => setPrintOpen(true)}><Printer size={14} /> {L('Print internal draft', 'অভ্যন্তরীণ খসড়া প্রিন্ট')}</button>
          </>
        }
      />

      <main className="space-y-5">
        <section className="rounded-2xl border-2 border-dashed border-rose-300 bg-rose-50/60 p-4 text-rose-900">
          <p className="text-[13px] font-bold uppercase tracking-[0.12em]">{L('DRAFT — NOT FILED', 'খসড়া — দাখিল হয়নি')}</p>
          <p className="mt-1 text-[12px] leading-relaxed">
            {L(
              'This is an internal VAT workbook, not a filed return or a government receipt. The statutory template, line labels and filing deadline are pending tax-counsel review. Do not rely on it for filing until that review is recorded.',
              'এটি অভ্যন্তরীণ ভ্যাট ওয়ার্কবুক, দাখিলকৃত রিটার্ন বা সরকারি রসিদ নয়। সংবিধিবদ্ধ টেমপ্লেট, লাইন লেবেল ও দাখিলের সময়সীমা কর পরামর্শকের পর্যালোচনার অপেক্ষায়। সেই পর্যালোচনা নথিভুক্ত না হওয়া পর্যন্ত দাখিলের জন্য এর উপর নির্ভর করবেন না।',
            )}
          </p>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: L('Output VAT', 'আউটপুট ভ্যাট'), value: return91.output_tax_poisha, hint: L('Mushak 6.2 register', 'মূসক ৬.২ রেজিস্টার'), tone: 'text-indigo-700', iconTone: 'bg-indigo-50 text-indigo-700 ring-indigo-500/15', bar: 'from-indigo-500 via-indigo-400/40', icon: <Landmark size={14} /> },
            { label: L('Input rebate', 'ইনপুট রিবেট'), value: return91.input_rebate_poisha, hint: L('Mushak 6.1 register', 'মূসক ৬.১ রেজিস্টার'), tone: 'text-vault-800', iconTone: 'bg-vault-50 text-vault-700 ring-vault-500/15', bar: 'from-vault-500 via-vault-400/40', icon: <BadgeCheck size={14} /> },
            { label: L('Customer 6.6 received', 'গ্রাহক ৬.৬ প্রাপ্ত'), value: books.decreasing, hint: L('9.1 Part 6 decreasing adjustment', '৯.১ অংশ ৬ হ্রাস সমন্বয়'), tone: 'text-violet-700', iconTone: 'bg-violet-50 text-violet-700 ring-violet-500/15', bar: 'from-violet-500 via-violet-400/40', icon: <FileSpreadsheet size={14} /> },
            { label: L('Net VAT payable', 'নিট ভ্যাট প্রদেয়'), value: return91.net_payable_poisha, hint: L('Deadline not verified', 'সময়সীমা যাচাইকৃত নয়'), tone: 'text-gold-700', iconTone: 'bg-gold-50 text-gold-600 ring-gold-500/15', bar: 'from-gold-500 via-gold-400/40', icon: <Calculator size={14} /> },
          ].map((card) => (
            <article key={card.label} className="ql-card ql-card-interactive relative overflow-hidden p-4">
              <span aria-hidden className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r to-transparent ${card.bar}`} />
              <span aria-hidden className="pointer-events-none absolute -right-8 -top-12 h-24 w-24 rounded-full bg-vault-500/10 blur-2xl" />
              <div className="relative flex items-start justify-between gap-2">
                <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-ink-400">{card.label}</p>
                <span className={`grid h-8 w-8 place-items-center rounded-[10px] ring-1 ring-inset ${card.iconTone}`}>{card.icon}</span>
              </div>
              <p className={`font-money relative mt-3 text-[25px] font-semibold leading-none tracking-[-0.045em] ${card.tone}`}>{money(card.value)}</p>
              <p className="relative mt-2 text-[9.5px] leading-relaxed text-ink-500">{card.hint}</p>
            </article>
          ))}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ql-seg flex-wrap">
            {TABS.map((entry) => (
              <button key={entry.id} type="button" className="ql-seg-item" data-active={tab === entry.id} onClick={() => setTab(entry.id)}>
                {entry.icon} {isBn ? entry.bn : entry.en}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`ql-badge ${books.reconciled ? 'ql-badge-success' : 'ql-badge-danger'}`}>
              {books.reconciled ? <CircleCheck size={12} /> : <TriangleAlert size={12} />}
              {books.reconciled ? L('GL ↔ return 0.00 variance', 'জিএল ↔ রিটার্ন ০.০০ পার্থক্য') : L('GL ↔ return variance', 'জিএল ↔ রিটার্ন পার্থক্য')}
            </span>
            {exportedAt ? <span className="text-[10px] text-ink-400">{L('Exported', 'এক্সপোর্ট')} {exportedAt}</span> : null}
          </div>
        </div>

        {tab === 'PURCHASE' || tab === 'SALES' ? (
          <section className="ql-card overflow-hidden">
            <div className="ql-card-header">
              <div>
                <p className="ql-kicker flex items-center gap-1.5"><Table2 size={12} /> {L('Real-time statutory register', 'রিয়েল-টাইম সংবিধিবদ্ধ রেজিস্টার')}</p>
                <h2 className="mt-1 text-base font-semibold text-ink-900">
                  {tab === 'PURCHASE' ? L('Mushak 6.1 — purchase register', 'মূসক ৬.১ — ক্রয় রেজিস্টার') : L('Mushak 6.2 — sales register', 'মূসক ৬.২ — বিক্রয় রেজিস্টার')}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="ql-badge ql-badge-neutral">{(tab === 'PURCHASE' ? books.purchaseRows : books.salesRows).length} {L('lines', 'লাইন')}</span>
                <span className="ql-badge ql-badge-warn">{tab === 'PURCHASE' ? L('Input rebate', 'ইনপুট রিবেট') : L('Output tax', 'আউটপুট কর')} {money(tab === 'PURCHASE' ? return91.input_rebate_poisha : return91.output_tax_poisha)}</span>
              </div>
            </div>
            <RegisterTable
              rows={tab === 'PURCHASE' ? books.purchaseRows : books.salesRows}
              money={money}
              locale={locale}
              isBn={isBn}
              query={tab === 'PURCHASE' ? purchaseQuery : salesQuery}
              onQuery={tab === 'PURCHASE' ? setPurchaseQuery : setSalesQuery}
              emptyEn="No register lines for this period."
              emptyBn="এই সময়কালে কোনো রেজিস্টার লাইন নেই।"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 text-[10px] text-ink-500">
              <span>{L('Value is VAT-exclusive; total includes SD, VAT and VDS treatment.', 'মূল্য ভ্যাট-বহির্ভূত; মোট এসডি, ভ্যাট ও ভিডিএস সহ।')}</span>
              <button type="button" className="ql-btn ql-btn-ghost !py-1 text-[10px]" onClick={exportWorkbook}><Download size={12} /> {L('Download register', 'রেজিস্টার ডাউনলোড')}</button>
            </div>
          </section>
        ) : null}

        {tab === 'NOTE18' ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="ql-card overflow-hidden">
              <div className="ql-card-header">
                <div>
                  <p className="ql-kicker flex items-center gap-1.5"><Layers size={12} /> {L('Note 18', 'নোট ১৮')}</p>
                  <h2 className="mt-1 text-base font-semibold text-ink-900">{L('VAT current account movement', 'ভ্যাট চলতি হিসাব পরিবর্তন')}</h2>
                </div>
                <span className="ql-badge ql-badge-warn">{return91.period_code}</span>
              </div>
              <div className="grid gap-3 border-b border-ink-100 px-5 py-4 sm:grid-cols-3">
                <div className="rounded-xl bg-vault-50 p-3 ring-1 ring-inset ring-vault-200">
                  <p className="ql-kicker">{L('Opening control balance', 'প্রারম্ভিক নিয়ন্ত্রণ ব্যালেন্স')}</p>
                  <p className="font-money mt-1 text-sm font-semibold text-vault-900">{money(noteOpening)}</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-3 ring-1 ring-inset ring-indigo-200">
                  <p className="ql-kicker">{L('Movement in the period', 'সময়কালের পরিবর্তন')}</p>
                  <p className={`font-money mt-1 text-sm font-semibold ${noteClosing - noteOpening < 0n ? 'text-indigo-700' : 'text-emerald-700'}`}>
                    {money(noteClosing - noteOpening, { sign: true })}
                  </p>
                </div>
                <div className="rounded-xl bg-ink-900 p-3 text-white">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-vault-300">{L('Closing control balance', 'সমাপনী নিয়ন্ত্রণ ব্যালেন্স')}</p>
                  <p className="font-money mt-1 text-sm font-semibold text-gold-200">{money(noteClosing)}</p>
                </div>
              </div>
              <table className="ql-table">
                <thead>
                  <tr><th>{L('Movement', 'পরিবর্তন')}</th><th>{L('Control account', 'নিয়ন্ত্রণ হিসাব')}</th><th className="text-right">{L('Debit', 'ডেবিট')}</th><th className="text-right">{L('Credit', 'ক্রেডিট')}</th><th className="text-right">{L('Balance', 'ব্যালেন্স')}</th></tr>
                </thead>
                <tbody>
                  {[
                    { label: L('Opening balance', 'প্রারম্ভিক ব্যালেন্স'), code: '1140', debit: noteOpening, credit: 0n, balance: noteOpening },
                    { label: L('Input rebate for the period', 'সময়কালের ইনপুট রিবেট'), code: '1140', debit: return91.input_rebate_poisha, credit: 0n, balance: noteOpening + return91.input_rebate_poisha },
                    { label: L('Customer Mushak 6.6 decreasing adjustment', 'গ্রাহক মূসক ৬.৬ হ্রাস সমন্বয়'), code: '1140', debit: books.decreasing, credit: 0n, balance: noteOpening + return91.input_rebate_poisha + books.decreasing },
                    { label: L('Output tax for the period', 'সময়কালের আউটপুট কর'), code: '2120', debit: 0n, credit: return91.output_tax_poisha, balance: noteClosing },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td className="text-[10.5px]">{row.label}</td>
                      <td className="font-mono text-[10px] text-ink-500">{row.code}</td>
                      <td className="font-money text-right text-[10.5px] text-vault-700">{row.debit > 0n ? money(row.debit, { symbol: false }) : '—'}</td>
                      <td className="font-money text-right text-[10.5px] text-indigo-700">{row.credit > 0n ? money(row.credit, { symbol: false }) : '—'}</td>
                      <td className="font-money text-right text-[10.5px] font-semibold text-ink-900">{money(row.balance, { symbol: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-ink-100 px-5 py-3">
                <p className="ql-hint">{L('Every purchase rebate, sales output tax and customer 6.6 adjustment must reconcile to the current account before filing.', 'ফাইলিংয়ের আগে প্রতিটি ক্রয় রিবেট, বিক্রয় আউটপুট কর ও গ্রাহক ৬.৬ সমন্বয় চলতি হিসাবের সাথে মিলতে হবে।')}</p>
              </div>
            </section>

            <div className="space-y-5">
              <section className="ql-card ql-card-pad">
                <div className="flex items-center justify-between gap-2">
                  <p className="ql-kicker flex items-center gap-1.5"><Scale size={12} /> {L('Subledger proof', 'সাবলেজার প্রমাণ')}</p>
                  <span className={`ql-badge ${vatRow?.reconciled ? 'ql-badge-success' : 'ql-badge-danger'}`}>{vatRow?.reconciled ? L('Reconciled', 'মিলিত') : L('Review', 'পর্যালোচনা')}</span>
                </div>
                <dl className="mt-3 space-y-2 text-[11px]">
                  {[
                    [L('GL balance', 'জিএল ব্যালেন্স'), money(vatRow?.gl_balance_poisha ?? 0n)],
                    [L('Subledger balance', 'সাবলেজার ব্যালেন্স'), money(vatRow?.subledger_balance_poisha ?? 0n)],
                    [L('Difference', 'পার্থক্য'), money(vatRow?.difference_poisha ?? 0n)],
                    [L('Open items', 'খোলা আইটেম'), String(vatRow?.open_items ?? 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <dt className="text-ink-500">{label}</dt>
                      <dd className="font-money font-semibold text-ink-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="ql-hint mt-3">{L('Control codes', 'নিয়ন্ত্রণ কোড')}: {vatRow?.account_codes.join(' · ') || '1140 · 2120'}</p>
              </section>

              <section className="ql-card ql-card-pad">
                <p className="ql-kicker">{L('Movement visual', 'পরিবর্তনের ভিজ্যুয়াল')}</p>
                <div className="mt-3 space-y-2">
                  {[
                    { label: L('Input rebate', 'ইনপুট রিবেট'), value: return91.input_rebate_poisha, tone: 'bg-vault-500' },
                    { label: L('Customer 6.6', 'গ্রাহক ৬.৬'), value: books.decreasing, tone: 'bg-violet-500' },
                    { label: L('Output tax', 'আউটপুট কর'), value: return91.output_tax_poisha, tone: 'bg-indigo-500' },
                  ].map((row) => {
                    const max = [return91.input_rebate_poisha, books.decreasing, return91.output_tax_poisha].reduce((a, b) => (b > a ? b : a), 1n);
                    const width = max > 0n ? Number((row.value * 100n) / max) : 0;
                    return (
                      <div key={row.label}>
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-ink-500">{row.label}</span>
                          <span className="font-money font-semibold text-ink-900">{money(row.value)}</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-100">
                          <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${Math.max(2, width)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="ql-card ql-card-pad">
                <p className="ql-kicker flex items-center gap-1.5"><Calculator size={12} /> {L('Filing rule', 'ফাইলিং বিধি')}</p>
                <p className="mt-2 text-[10.5px] font-semibold text-ink-900">{L(filing.explanation_en, filing.explanation_bn)}</p>
                <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-vault-700">{filing.citation}</p>
                <button type="button" className="ql-btn ql-btn-primary mt-3 w-full" onClick={() => setPrintOpen(true)}><Printer size={14} /> {L('Print A4 Mushak 9.1', 'এ৪ মূসক ৯.১ প্রিন্ট')}</button>
              </section>
            </div>
          </div>
        ) : null}

        {tab === 'RETURN' ? (
          <div className="space-y-5">
            <section className={`overflow-hidden rounded-2xl border shadow-card ${books.reconciled ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-white' : 'border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className={`grid h-12 w-12 place-items-center rounded-2xl ${books.reconciled ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
                    {books.reconciled ? <CircleCheck size={22} /> : <TriangleAlert size={22} />}
                  </span>
                  <div>
                    <p className="ql-kicker">{L('GL-vs-return reconciliation proof', 'জিএল ও রিটার্ন মিলকরণ প্রমাণ')}</p>
                    <h2 className="text-lg font-semibold tracking-tight text-ink-900">
                      {L('Variance', 'পার্থক্য')} <span className={`font-money ${books.reconciled ? 'text-emerald-700' : 'text-rose-700'}`}>{money(books.coreVariance)}</span> BDT
                    </h2>
                    <p className="text-[10.5px] text-ink-500">
                      {books.reconciled
                        ? L('The 2120 output VAT and 1140 input VAT control accounts tie exactly to the internal draft. This is not a filing approval.', '২১২০ আউটপুট ভ্যাট ও ১১৪০ ইনপুট ভ্যাট নিয়ন্ত্রণ হিসাব অভ্যন্তরীণ খসড়ার সাথে হুবহু মিলেছে। এটি দাখিলের অনুমোদন নয়।')
                        : L('Investigate the variance before filing — the ledger and the return disagree.', 'ফাইলিংয়ের আগে পার্থক্য তদন্ত করুন — খতিয়ান ও রিটার্ন মিলছে না।')}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-ink-200">
                    <p className="text-ink-400">{L('Return output', 'রিটার্ন আউটপুট')}</p>
                    <p className="font-money font-semibold text-ink-900">{money(return91.output_tax_poisha)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-ink-200">
                    <p className="text-ink-400">{L('GL output', 'জিএল আউটপুট')}</p>
                    <p className="font-money font-semibold text-ink-900">{money(return91.gl_output_vat_poisha)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-ink-200">
                    <p className="text-ink-400">{L('Return input', 'রিটার্ন ইনপুট')}</p>
                    <p className="font-money font-semibold text-ink-900">{money(return91.input_rebate_poisha)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-ink-200">
                    <p className="text-ink-400">{L('GL input', 'জিএল ইনপুট')}</p>
                    <p className="font-money font-semibold text-ink-900">{money(return91.gl_input_vat_poisha)}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200/60 px-5 py-2.5">
                <span className="flex items-center gap-1.5 text-[10px] text-ink-500"><ShieldCheck size={12} /> {L('Rule pack bd-2026-v1 · pending tax-counsel review · no filing deadline asserted', 'রুল প্যাক bd-2026-v1 · কর পরামর্শকের পর্যালোচনার অপেক্ষায় · কোনো দাখিলের সময়সীমা দাবি করা হয় না')}</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="ql-btn ql-btn-secondary !py-1.5" onClick={exportWorkbook}><Download size={13} /> {L('Export .xlsx', 'এক্সপোর্ট .xlsx')}</button>
                  <button type="button" className="ql-btn ql-btn-primary !py-1.5" onClick={() => setPrintOpen(true)}><Printer size={13} /> {L('Print A4', 'এ৪ প্রিন্ট')}</button>
                </div>
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <section className="ql-card overflow-hidden">
                <div className="ql-card-header">
                  <div>
                    <p className="ql-kicker flex items-center gap-1.5"><FileText size={12} /> {L('Return assembly', 'রিটার্ন সংকলন')}</p>
                    <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Mushak 9.1 — 12-part computation', 'মূসক ৯.১ — ১২ অংশের হিসাব')}</h2>
                  </div>
                  <span className="ql-badge ql-badge-warn">{L('Draft — deadline not verified', 'খসড়া — সময়সীমা যাচাইকৃত নয়')}</span>
                </div>
                <div className="grid gap-px bg-ink-100 sm:grid-cols-2">
                  {return91.parts.map((part) => (
                    <div key={part.part} className="bg-white px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10.5px] font-semibold text-ink-900">
                          <span className="mr-1 inline-grid h-4 w-4 place-items-center rounded bg-vault-100 text-[8px] text-vault-800">{part.part}</span>
                          {isBn ? part.title_bn : part.title_en}
                        </p>
                        <p className="font-money shrink-0 text-[10.5px] font-semibold text-ink-900">{money(part.total_poisha)}</p>
                      </div>
                      <ul className="mt-1 space-y-0.5 pl-5">
                        {part.rows.map((row) => (
                          <li key={row.label_en} className="flex items-center justify-between gap-2 text-[9.5px] text-ink-500">
                            <span className="truncate">{isBn ? row.label_bn : row.label_en}</span>
                            <span className="font-money shrink-0 text-ink-700">{row.amount_poisha !== 0n ? money(row.amount_poisha, { symbol: false }) : row.note ?? '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <div className="space-y-5">
                <section className="ql-card ql-card-pad">
                  <p className="ql-kicker flex items-center gap-1.5"><Sigma size={12} /> {L('Return totals', 'রিটার্ন মোট')}</p>
                  <dl className="mt-3 space-y-2 text-[11px]">
                    {[
                      [L('Output tax', 'আউটপুট কর'), money(return91.output_tax_poisha)],
                      [L('Input rebate', 'ইনপুট রিবেট'), money(return91.input_rebate_poisha)],
                      [L('Decreasing adjustment', 'হ্রাস সমন্বয়'), `−${money(books.decreasing, { symbol: false })}`],
                      [L('Net payable', 'নিট প্রদেয়'), money(return91.net_payable_poisha)],
                      [L('Closing balance c/f', 'সমাপনী ব্যালেন্স বহন'), money(return91.closing_balance_poisha)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-2 border-b border-dashed border-ink-100 pb-1.5 last:border-0">
                        <dt className="text-ink-500">{label}</dt>
                        <dd className="font-money font-semibold text-ink-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 rounded-xl bg-vault-50 p-3 text-[10px] text-vault-800 ring-1 ring-inset ring-vault-200">
                    <p className="flex items-center gap-1.5 font-semibold"><BadgeCheck size={12} /> {L('Register tie-out', 'রেজিস্টার মিল')}</p>
                    <p className="mt-0.5">{books.salesRows.length} {L('sales lines', 'বিক্রয় লাইন')} · {books.purchaseRows.length} {L('purchase lines', 'ক্রয় লাইন')} · {books.receivedCertificates.length} {L('customer 6.6 certificates received', 'গ্রাহক ৬.৬ সনদ প্রাপ্ত')}</p>
                  </div>
                </section>

                <section className="ql-card ql-card-pad">
                  <p className="ql-kicker flex items-center gap-1.5"><Scale size={12} /> {L('Template review status', 'টেমপ্লেট পর্যালোচনা অবস্থা')}</p>
                  <p className="mt-2 text-[10.5px] font-semibold text-ink-900">{L(filing.explanation_en, filing.explanation_bn)}</p>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-vault-700">{filing.citation}</p>
                  <dl className="mt-3 space-y-1.5 text-[10.5px]">
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Period end', 'সময়কাল শেষ')}</dt><dd className="font-semibold">{formatDate(periodEnd, locale)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Deadline', 'সময়সীমা')}</dt><dd className="font-semibold">{L('Not verified', 'যাচাইকৃত নয়')}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Filing status', 'দাখিলের অবস্থা')}</dt><dd className="font-semibold">{L('Draft — not filed', 'খসড়া — দাখিল হয়নি')}</dd></div>
                  </dl>
                  <button type="button" className="ql-btn ql-btn-secondary mt-3 w-full" onClick={exportWorkbook}><FileSpreadsheet size={14} /> {L('Download internal workbook', 'অভ্যন্তরীণ ওয়ার্কবুক ডাউনলোড')}</button>
                </section>

                <section className="ql-card ql-card-pad">
                  <p className="ql-kicker flex items-center gap-1.5"><ArrowRight size={12} /> {L('Next step', 'পরবর্তী ধাপ')}</p>
                  <p className="mt-2 text-[10.5px] leading-relaxed text-ink-600">
                    {L('Do not file from this screen. Have tax counsel review the register mapping, GL proof and exceptions, then file through the approved external process. This workbook is not a filing acknowledgement or a government receipt.', 'এই স্ক্রিন থেকে দাখিল করবেন না। কর পরামর্শককে রেজিস্টার ম্যাপিং, জিএল প্রমাণ ও ব্যতিক্রম পর্যালোচনা করতে দিন, তারপর অনুমোদিত বাহ্যিক প্রক্রিয়ায় দাখিল করুন। এই ওয়ার্কবুক দাখিল স্বীকৃতি বা সরকারি রসিদ নয়।')}
                  </p>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      <StatutoryPrintModal open={printOpen} onClose={() => setPrintOpen(false)} mode="MUSHAK_9_1" periodCode={periodCode} />
    </>
  );
}
