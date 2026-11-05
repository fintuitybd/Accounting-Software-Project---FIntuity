// LedgerVault — W10 Payroll & labour suite.
//
// Bangladesh Labour (Amendment) Act 2026 payroll under SRO 53-Law/2026: worker classification, the
// monthly salary register (basic, HRA, medical, transport, a live double-rate overtime calculator,
// Eid festival bonus), 10% provident fund, IAS 19 gratuity service cost, 5% WPPF and salary TDS.
// Every figure is BigInt poisha; the employer-cost bridge proves the accrual before it is posted as
// one balanced journal, and the payment file leaves as BEFTN or bKash bulk `.xlsx`.

import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Banknote,
  CalendarHeart,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Clock,
  Download,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  Layers,
  ReceiptText,
  Send,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { LedgerLensModal } from '../components/signature/LedgerLensModal';
import { useWorkspaceNav } from '../components/layout/WorkspaceNav';
import { monthYearLabel } from '../core/i18n';
import { applyRateBps, formatDate } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { JournalEntry } from '../core/types';
import type { PayrollEmployeeRow } from '../core/ledger/seedData';

const PF_RATE_BPS = 1000; // 10% — Labour Act 2026, recognised provident fund
const FESTIVAL_RATE_BPS = 1000; // 10% of basic — Eid festival bonus
const WPPF_RATE_BPS = 500; // 5% of profit before WPPF
const STANDARD_HOURS = 208; // monthly statutory hours for the basic hourly rate
const SRO_REFERENCE = 'SRO 53-Law/2026 · Bangladesh Labour (Amendment) Act 2026';

const CLASS_LABEL: Record<string, { en: string; bn: string; tone: string }> = {
  PERMANENT: { en: 'Permanent', bn: 'স্থায়ী', tone: 'lv-chip-emerald' },
  PROBATIONARY: { en: 'Probationary', bn: 'প্রেষণকালীন', tone: 'lv-chip-gold' },
  CONTRACTUAL: { en: 'Contractual', bn: 'চুক্তিভিত্তিক', tone: 'lv-chip-neutral' },
  PIECE_RATE: { en: 'Piece rate', bn: 'পিস রেট', tone: 'lv-chip-neutral' },
  APPRENTICE: { en: 'Apprentice', bn: 'শিক্ষানবিশ', tone: 'lv-chip-rose' },
};

function bdtNumber(poisha: bigint): number {
  return Number(poisha) / 100;
}

function defaultOvertimeHours(row: PayrollEmployeeRow): string {
  if (row.overtime_poisha <= 0n || row.basic_poisha <= 0n) return '0';
  const hundredths = (row.overtime_poisha * BigInt(STANDARD_HOURS) * 100n) / (row.basic_poisha * 2n);
  return (Number(hundredths) / 100).toFixed(2).replace(/\.00$/, '');
}

function downloadWorkbook(fileName: string, sheets: Array<{ name: string; rows: Array<Array<string | number>>; widths?: number[] }>): void {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.widths) worksheet['!cols'] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, fileName);
}

export default function W10_PayrollLabourSuite() {
  const vault = useVault();
  const { locale, money, statements, publishToast } = vault;
  const { navigate } = useWorkspaceNav();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bnText: string): string => (isBn ? bnText : en);

  const periodOptions = useMemo(() => {
    const codes = Array.from(new Set(vault.payrollRows.map((row) => row.period_code)));
    return codes.sort();
  }, [vault.payrollRows]);

  const [periodCode, setPeriodCode] = useState<string>(
    () => periodOptions[periodOptions.length - 1] ?? statements.period.code,
  );
  const [includeFestival, setIncludeFestival] = useState<boolean>(true);
  const [otHours, setOtHours] = useState<Record<string, string>>({});
  const [postedJournal, setPostedJournal] = useState<JournalEntry | null>(null);
  const [posting, setPosting] = useState(false);
  const [lensJournalId, setLensJournalId] = useState<string | null>(null);

  const rows = useMemo(
    () => vault.payrollRows.filter((row) => row.period_code === periodCode),
    [vault.payrollRows, periodCode],
  );

  const period = vault.periods.find((entry) => entry.code === periodCode);
  const periodEnd = period?.end_date ?? statements.period.end;
  const periodLabel = monthYearLabel(`${periodCode}-01`, locale);
  const postingOpen = !period || period.status === 'OPEN';

  const hoursKey = (row: PayrollEmployeeRow): string => `${periodCode}:${row.employee_id}`;

  const computedRows = useMemo<PayrollEmployeeRow[]>(() => {
    return rows.map((row) => {
      const raw = otHours[hoursKey(row)] ?? defaultOvertimeHours(row);
      const hours = Number(raw);
      const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
      const scaledHundredths = BigInt(Math.round(safeHours * 100));
      const overtime =
        row.basic_poisha > 0n ? (row.basic_poisha * scaledHundredths * 2n) / (BigInt(STANDARD_HOURS) * 100n) : 0n;
      const festival = includeFestival ? applyRateBps(row.basic_poisha, FESTIVAL_RATE_BPS) : 0n;
      const gross =
        row.basic_poisha + row.house_rent_poisha + row.medical_poisha + row.transport_poisha + overtime + festival;
      const pfEmployee = applyRateBps(row.basic_poisha, PF_RATE_BPS);
      const pfEmployer = applyRateBps(row.basic_poisha, PF_RATE_BPS);
      const net = gross - pfEmployee - row.tds_poisha;
      return {
        ...row,
        overtime_poisha: overtime,
        festival_bonus_poisha: festival,
        gross_poisha: gross,
        pf_employee_poisha: pfEmployee,
        pf_employer_poisha: pfEmployer,
        net_poisha: net,
      };
    });
  }, [rows, otHours, includeFestival, periodCode]);

  const totals = useMemo(() => {
    const sum = (pick: (row: PayrollEmployeeRow) => bigint): bigint =>
      computedRows.reduce((total, row) => total + pick(row), 0n);
    const basic = sum((row) => row.basic_poisha);
    const houseRent = sum((row) => row.house_rent_poisha);
    const medical = sum((row) => row.medical_poisha);
    const transport = sum((row) => row.transport_poisha);
    const overtime = sum((row) => row.overtime_poisha);
    const festival = sum((row) => row.festival_bonus_poisha);
    const gross = sum((row) => row.gross_poisha);
    const pfEmployee = sum((row) => row.pf_employee_poisha);
    const pfEmployer = sum((row) => row.pf_employer_poisha);
    const gratuity = sum((row) => row.gratuity_poisha);
    const tds = sum((row) => row.tds_poisha);
    const net = sum((row) => row.net_poisha);
    const overtimeHours = computedRows.reduce((total, row) => {
      const raw = otHours[hoursKey(row)] ?? defaultOvertimeHours(row);
      const hours = Number(raw);
      return total + (Number.isFinite(hours) && hours > 0 ? hours : 0);
    }, 0);
    return {
      basic,
      houseRent,
      medical,
      transport,
      overtime,
      festival,
      gross,
      pfEmployee,
      pfEmployer,
      gratuity,
      tds,
      net,
      overtimeHours,
    };
  }, [computedRows, otHours, periodCode]);

  const profitBeforeTax = statements.profit_or_loss.profit_before_tax_poisha;
  const wppfAnnual = profitBeforeTax > 0n ? applyRateBps(profitBeforeTax, WPPF_RATE_BPS) : 0n;
  const wppfMonthly = wppfAnnual / 12n;

  const classBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of computedRows) counts.set(row.worker_class, (counts.get(row.worker_class) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [computedRows]);

  // One balanced accrual: salary expense + employer on-costs debited; net pay, PF, TDS, gratuity
  // and WPPF credited. The 2160 credit is the residual so the journal balances by construction.
  const journalLines = useMemo(() => {
    const netPayable2160 = totals.gross + totals.pfEmployer - totals.tds;
    const lines: Array<{ code: string; debit: bigint; credit: bigint; memo_en: string; memo_bn: string }> = [
      { code: '5200', debit: totals.gross + wppfMonthly, credit: 0n, memo_en: 'Salaries, overtime, Eid bonus & WPPF provision', memo_bn: 'বেতন, ওভারটাইম, ঈদ বোনাস ও ডব্লিউপিপিএফ' },
      { code: '5210', debit: totals.pfEmployer + totals.gratuity, credit: 0n, memo_en: 'Employer PF & IAS 19 gratuity service cost', memo_bn: 'নিয়োগকর্তার পিএফ ও আইএএস ১৯ গ্র্যাচুইটি' },
      { code: '2160', debit: 0n, credit: netPayable2160, memo_en: 'Accrued net salaries & PF payable', memo_bn: 'সঞ্চিত নিট বেতন ও পিএফ প্রদেয়' },
      { code: '2140', debit: 0n, credit: totals.tds, memo_en: 'Salary TDS withheld', memo_bn: 'বেতন টিডিএস কর্তন' },
      { code: '2610', debit: 0n, credit: totals.gratuity, memo_en: 'IAS 19 gratuity obligation', memo_bn: 'আইএএস ১৯ গ্র্যাচুইটি দায়' },
      { code: '2170', debit: 0n, credit: wppfMonthly, memo_en: 'WPPF 5% monthly provision', memo_bn: 'ডব্লিউপিপিএফ ৫% মাসিক সঞ্চিতি' },
    ];
    const live = lines.filter((line) => line.debit !== 0n || line.credit !== 0n);
    const debitTotal = live.reduce((total, line) => total + line.debit, 0n);
    const creditTotal = live.reduce((total, line) => total + line.credit, 0n);
    return { lines: live, debitTotal, creditTotal, balanced: debitTotal === creditTotal && debitTotal > 0n };
  }, [totals, wppfMonthly]);

  const employerCost = totals.gross + totals.pfEmployer + totals.gratuity + wppfMonthly;
  const lensJournal = lensJournalId ? vault.journals.find((journal) => journal.id === lensJournalId) ?? null : null;

  const changePeriod = (next: string): void => {
    setPeriodCode(next);
    setPostedJournal(null);
    const nextRows = vault.payrollRows.filter((row) => row.period_code === next);
    setIncludeFestival(nextRows.some((row) => row.festival_bonus_poisha > 0n));
  };

  const setHours = (row: PayrollEmployeeRow, value: string): void => {
    setOtHours((current) => ({ ...current, [hoursKey(row)]: value }));
  };

  const resetOvertime = (): void => {
    setOtHours({});
    publishToast({
      tone: 'info',
      title: L('Overtime reset', 'ওভারটাইম রিসেট'),
      message: L('The calculator is back to the approved register hours.', 'ক্যালকুলেটর অনুমোদিত রেজিস্টার ঘণ্টায় ফিরেছে।'),
    });
  };

  const postPayroll = (): void => {
    if (!journalLines.balanced || posting) return;
    setPosting(true);
    const result = vault.postManualJournal({
      date: periodEnd,
      book_type: 'STATUTORY_BD',
      narration_en: `Payroll accrual ${periodCode} — ${computedRows.length} workers, PF 10%, IAS 19 gratuity, WPPF 5%, salary TDS (${SRO_REFERENCE}).`,
      narration_bn: `${periodCode} পে-রোল সঞ্চিতি — ${computedRows.length} জন কর্মী, পিএফ ১০%, গ্র্যাচুইটি, ডব্লিউপিপিএফ ৫%, বেতন টিডিএস (এসআরও ৫৩-আইন/২০২৬)।`,
      source_module: 'PAYROLL_LITE',
      lines: journalLines.lines.map((line) => ({
        account_code: line.code,
        debit_poisha: line.debit,
        credit_poisha: line.credit,
        memo: isBn ? line.memo_bn : line.memo_en,
      })),
    });
    if (result.ok && result.data) {
      setPostedJournal(result.data);
      setLensJournalId(result.data.id);
      publishToast({
        tone: 'success',
        title: L('Payroll journal posted to the GL', 'পে-রোল জার্নাল খতিয়ানে পোস্ট'),
        message: L(
          `Operating expenses in the IFRS P&L rose by ${money(totals.gross + wppfMonthly + totals.pfEmployer + totals.gratuity)}.`,
          `আইএফআরএস পিএলে পরিচালন ব্যয় ${money(totals.gross + wppfMonthly + totals.pfEmployer + totals.gratuity)} বেড়েছে।`,
        ),
      });
    }
    setPosting(false);
  };

  const statutorySummarySheet = (): Array<Array<string | number>> => [
    ['LedgerVault payroll statutory summary'],
    ['Period', periodCode],
    ['Legal reference', SRO_REFERENCE],
    ['Employees on register', computedRows.length],
    ['Basic (BDT)', bdtNumber(totals.basic)],
    ['House rent allowance (BDT)', bdtNumber(totals.houseRent)],
    ['Medical allowance (BDT)', bdtNumber(totals.medical)],
    ['Transport allowance (BDT)', bdtNumber(totals.transport)],
    ['Double-rate overtime (BDT)', bdtNumber(totals.overtime)],
    ['Overtime hours', totals.overtimeHours],
    ['Eid festival bonus 10% (BDT)', bdtNumber(totals.festival)],
    ['Gross payroll (BDT)', bdtNumber(totals.gross)],
    ['Employee PF 10% (BDT)', bdtNumber(totals.pfEmployee)],
    ['Employer PF 10% (BDT)', bdtNumber(totals.pfEmployer)],
    ['IAS 19 gratuity accrual (BDT)', bdtNumber(totals.gratuity)],
    ['WPPF 5% monthly provision (BDT)', bdtNumber(wppfMonthly)],
    ['Salary TDS withheld (BDT)', bdtNumber(totals.tds)],
    ['Net disbursement (BDT)', bdtNumber(totals.net)],
    ['Total employer cost (BDT)', bdtNumber(employerCost)],
    ['Journal total (BDT)', bdtNumber(journalLines.debitTotal)],
    ['Posted journal', postedJournal?.journal_number ?? 'NOT POSTED'],
  ];

  const exportBeftn = (): void => {
    const rowsOut: Array<Array<string | number>> = [
      ['Employee Code', 'Beneficiary Name', 'Bank', 'Branch', 'Routing Number', 'Account Number', 'Amount (BDT)', 'Narration'],
      ...computedRows.map((row, index) => [
        row.employee_code,
        isBn ? row.name_bn : row.name_en,
        'BRAC Bank Ltd.',
        'Gulshan Branch',
        '060261726',
        `0117${String(2045000 + index * 739).padStart(10, '0')}`,
        bdtNumber(row.net_poisha),
        `Salary ${periodCode}`,
      ]),
      ['', 'TOTAL', '', '', '', '', bdtNumber(totals.net), ''],
    ];
    downloadWorkbook(`BEFTN_payroll_${periodCode}.xlsx`, [
      { name: 'BEFTN', rows: rowsOut, widths: [14, 28, 20, 16, 15, 18, 16, 22] },
      { name: 'Statutory summary', rows: statutorySummarySheet(), widths: [40, 30] },
    ]);
    publishToast({
      tone: 'success',
      title: L('BEFTN .xlsx generated', 'বিইএফটিএন .এক্সএলএসএক্স তৈরি'),
      message: `${computedRows.length} ${L('beneficiaries', 'সুবিধাভোগী')} · ${money(totals.net)}`,
    });
  };

  const exportBkash = (): void => {
    const rowsOut: Array<Array<string | number>> = [
      ['MSISDN', 'Beneficiary Name', 'Amount (BDT)', 'Reference', 'Purpose'],
      ...computedRows.map((row, index) => [
        `017${String(11223344 + index * 137).slice(0, 8)}`,
        isBn ? row.name_bn : row.name_en,
        bdtNumber(row.net_poisha),
        `PAY-${periodCode}-${row.employee_code}`,
        'Salary disbursement',
      ]),
      ['', 'TOTAL', bdtNumber(totals.net), '', ''],
    ];
    downloadWorkbook(`bKash_payroll_${periodCode}.xlsx`, [
      { name: 'bKash disbursement', rows: rowsOut, widths: [16, 28, 16, 28, 22] },
      { name: 'Statutory summary', rows: statutorySummarySheet(), widths: [40, 30] },
    ]);
    publishToast({
      tone: 'success',
      title: L('bKash .xlsx generated', 'বিকাশ .এক্সএলএসএক্স তৈরি'),
      message: `${computedRows.length} ${L('wallets', 'ওয়ালেট')} · ${money(totals.net)}`,
    });
  };

  return (
    <div className="space-y-5">
      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Users size={12} /> {SRO_REFERENCE}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Monthly payroll register', 'মাসিক বেতন রেজিস্টার')} · {periodLabel}
            </h2>
            <p className="lv-hint mt-1">
              {L('Pay period ends', 'বেতন সময়কাল শেষ')} {formatDate(periodEnd, locale)} · {computedRows.length}{' '}
              {L('workers on the register', 'কর্মী রেজিস্টারে')} · {L('statutory hours', 'বিধিবদ্ধ ঘণ্টা')} {STANDARD_HOURS}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={periodCode}
              onChange={(event) => changePeriod(event.target.value)}
              className="lv-input !w-auto !py-1.5 text-[12px]"
              aria-label={L('Payroll period', 'পে-রোল সময়কাল')}
            >
              {periodOptions.length === 0 && <option value={periodCode}>{periodCode}</option>}
              {periodOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <span className={`lv-chip ${postingOpen ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              <ShieldCheck size={11} /> {period?.status ?? 'OPEN'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 px-5 py-3">
          {classBreakdown.map(([workerClass, count]) => {
            const meta = CLASS_LABEL[workerClass] ?? { en: workerClass, bn: workerClass, tone: 'lv-chip-neutral' };
            return (
              <span key={workerClass} className={`lv-chip ${meta.tone}`}>
                {L(meta.en, meta.bn)} · {count}
              </span>
            );
          })}
          <span className="mx-1 h-4 w-px bg-ink-200" />
          <button
            type="button"
            onClick={() => setIncludeFestival((current) => !current)}
            className={`lv-chip transition ${includeFestival ? 'lv-chip-gold' : 'lv-chip-neutral'}`}
            aria-pressed={includeFestival}
          >
            <CalendarHeart size={11} /> {L('Eid Festival Bonus 10%', 'ঈদ উৎসব ভাতা ১০%')} · {includeFestival ? 'ON' : 'OFF'}
          </button>
          <span className={`lv-chip ${totals.festival > 0n ? 'lv-chip-gold' : 'lv-chip-neutral'}`}>
            {money(totals.festival)}
          </span>
          <span className="lv-chip lv-chip-emerald">
            <BadgeCheck size={11} /> PF 10% {computedRows.length}/{computedRows.length}
          </span>
          <span className="lv-chip lv-chip-neutral">
            <Clock size={11} /> OT {totals.overtimeHours.toFixed(1)}h @ 2×
          </span>
        </div>

        <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-6">
          {[
            { label: L('Gross payroll', 'মোট বেতন'), value: totals.gross },
            { label: L('Net payable', 'নিট প্রদেয়'), value: totals.net },
            { label: L('Double-rate overtime', 'দ্বিগুণ ওভারটাইম'), value: totals.overtime },
            { label: L('Eid bonus', 'ঈদ বোনাস'), value: totals.festival },
            { label: L('IAS 19 gratuity', 'আইএএস ১৯ গ্র্যাচুইটি'), value: totals.gratuity },
            { label: L('Salary TDS', 'বেতন টিডিএস'), value: totals.tds },
          ].map((card) => (
            <div key={card.label} className="rounded-xl bg-ink-50/70 px-3 py-2.5">
              <p className="lv-kicker">{card.label}</p>
              <p className="font-money mt-1 text-sm font-semibold text-ink-900">{money(card.value)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><FileSpreadsheet size={12} /> {L('Salary & statutory sheet', 'বেতন ও বিধিবদ্ধ শীট')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Basic · HRA · medical · transport · OT · Eid · PF · gratuity · TDS · net', 'বেসিক · এইচআরএ · চিকিৎসা · পরিবহন · ওটি · ঈদ · পিএফ · গ্র্যাচুইটি · টিডিএস · নিট')}
            </h2>
            <p className="lv-hint mt-1">
              {L('Edit the OT hours cell and the double-rate calculator re-prices the row instantly.', 'ওটি ঘণ্টা সম্পাদনা করুন — দ্বিগুণ হার ক্যালকুলেটর তাৎক্ষণিকভাবে সারিটি পুনর্মূল্যায়ন করবে।')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="lv-chip lv-chip-neutral">{computedRows.length} {L('lines', 'লাইন')}</span>
            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={resetOvertime}>
              <Clock size={12} /> {L('Reset OT', 'ওটি রিসেট')}
            </button>
          </div>
        </div>

        {computedRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            {L('No payroll rows exist for this period.', 'এই সময়কালে কোনো পে-রোল সারি নেই।')}
          </p>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="lv-table min-w-[1240px]">
              <thead>
                <tr>
                  <th>{L('Employee', 'কর্মী')}</th>
                  <th>{L('Class', 'শ্রেণি')}</th>
                  <th className="text-right">{L('Basic', 'বেসিক')}</th>
                  <th className="text-right">{L('HRA', 'এইচআরএ')}</th>
                  <th className="text-right">{L('Medical', 'চিকিৎসা')}</th>
                  <th className="text-right">{L('Transport', 'পরিবহন')}</th>
                  <th className="text-right">{L('OT (2×)', 'ওটি (২গুণ)')}</th>
                  <th className="text-right">{L('Eid bonus', 'ঈদ বোনাস')}</th>
                  <th className="text-right">{L('Gross', 'মোট')}</th>
                  <th className="text-right">{L('PF 10%', 'পিএফ ১০%')}</th>
                  <th className="text-right">{L('Employer PF', 'নিয়োগকর্তা পিএফ')}</th>
                  <th className="text-right">{L('Gratuity', 'গ্র্যাচুইটি')}</th>
                  <th className="text-right">{L('TDS', 'টিডিএস')}</th>
                  <th className="text-right">{L('Net', 'নিট')}</th>
                </tr>
              </thead>
              <tbody>
                {computedRows.map((row) => {
                  const meta = CLASS_LABEL[row.worker_class] ?? { en: row.worker_class, bn: row.worker_class, tone: 'lv-chip-neutral' };
                  const hourly = row.basic_poisha / BigInt(STANDARD_HOURS);
                  return (
                    <tr key={`${row.employee_id}-${row.period_code}`}>
                      <td>
                        <p className="text-[12px] font-semibold text-ink-900">{isBn ? row.name_bn : row.name_en}</p>
                        <p className="text-[10px] text-ink-400">
                          {row.employee_code} · {row.designation} · {row.department}
                        </p>
                      </td>
                      <td>
                        <span className={`lv-chip ${meta.tone} !px-1.5 !py-0 text-[9px]`}>{L(meta.en, meta.bn)}</span>
                      </td>
                      <td className="font-money text-right text-[11px]">{money(row.basic_poisha)}</td>
                      <td className="font-money text-right text-[11px]">{money(row.house_rent_poisha)}</td>
                      <td className="font-money text-right text-[11px]">{money(row.medical_poisha)}</td>
                      <td className="font-money text-right text-[11px]">{money(row.transport_poisha)}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={otHours[hoursKey(row)] ?? defaultOvertimeHours(row)}
                            onChange={(event) => setHours(row, event.target.value)}
                            className="w-16 rounded-md border border-ink-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-ink-800 focus:border-vault-500 focus:outline-none"
                            aria-label={L('Overtime hours', 'ওভারটাইম ঘণ্টা')}
                          />
                          <span className="text-[9px] text-ink-400">h</span>
                        </div>
                        <p className="font-money mt-0.5 text-[10px] text-ink-600">
                          {money(row.overtime_poisha)}
                          <span className="ml-1 text-[8px] text-ink-400">
                            {L('rate', 'হার')} {money(hourly * 2n)}/h
                          </span>
                        </p>
                      </td>
                      <td className="font-money text-right text-[11px]">{money(row.festival_bonus_poisha)}</td>
                      <td className="font-money text-right text-[11px] font-semibold text-ink-900">{money(row.gross_poisha)}</td>
                      <td className="font-money text-right text-[11px] text-ink-600">{money(row.pf_employee_poisha)}</td>
                      <td className="font-money text-right text-[11px] text-ink-600">{money(row.pf_employer_poisha)}</td>
                      <td className="font-money text-right text-[11px] text-ink-600">{money(row.gratuity_poisha)}</td>
                      <td className="font-money text-right text-[11px] text-ink-600">{money(row.tds_poisha)}</td>
                      <td className="font-money text-right text-[12px] font-semibold text-vault-800">{money(row.net_poisha)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold">
                  <td colSpan={2} className="text-[12px]">{L('Totals', 'মোট')}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.basic)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.houseRent)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.medical)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.transport)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.overtime)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.festival)}</td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[11px]">{money(totals.gross)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.pfEmployee)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.pfEmployer)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.gratuity)}</td>
                  <td className="font-money text-right text-[11px]">{money(totals.tds)}</td>
                  <td className="font-money border-b-4 border-double border-ink-900 text-right text-[12px]">{money(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker flex items-center gap-1.5"><ReceiptText size={12} /> {L('Accrual journal', 'সঞ্চিতি জার্নাল')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Balanced payroll journal preview', 'সুষম পে-রোল জার্নাল প্রিভিউ')}</h2>
              <p className="lv-hint mt-1">
                {L('Debits', 'ডেবিট')} {money(journalLines.debitTotal)} = {L('credits', 'ক্রেডিট')} {money(journalLines.creditTotal)}
              </p>
            </div>
            <span className={`lv-chip ${journalLines.balanced ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
              {journalLines.balanced ? <CheckCircle2 size={11} /> : <CircleAlert size={11} />}
              {journalLines.balanced ? L('Balanced', 'সুষম') : L('Unbalanced', 'অসুষম')}
            </span>
          </div>

          <table className="lv-table">
            <thead>
              <tr>
                <th>{L('Account', 'হিসাব')}</th>
                <th className="text-right">{L('Debit', 'ডেবিট')}</th>
                <th className="text-right">{L('Credit', 'ক্রেডিট')}</th>
              </tr>
            </thead>
            <tbody>
              {journalLines.lines.map((line) => {
                const account = vault.accounts.find((entry) => entry.code === line.code);
                return (
                  <tr key={line.code}>
                    <td>
                      <p className="font-mono text-[10px] font-semibold text-vault-700">{line.code}</p>
                      <p className="text-[11px] text-ink-800">{account ? (isBn ? account.name_bn : account.name_en) : line.memo_en}</p>
                      <p className="text-[10px] text-ink-400">{isBn ? line.memo_bn : line.memo_en}</p>
                    </td>
                    <td className="font-money text-right text-[12px]">{line.debit ? money(line.debit) : '—'}</td>
                    <td className="font-money text-right text-[12px]">{line.credit ? money(line.credit) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-200 bg-ink-50">
                <td className="text-[11px] font-semibold">{L('Journal total', 'জার্নাল মোট')}</td>
                <td className="font-money border-b-4 border-double border-ink-900 text-right text-[12px] font-semibold">{money(journalLines.debitTotal)}</td>
                <td className="font-money border-b-4 border-double border-ink-900 text-right text-[12px] font-semibold">{money(journalLines.creditTotal)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3">
            <button type="button" className="lv-btn lv-btn-primary" disabled={!journalLines.balanced || !postingOpen || posting || postedJournal !== null} onClick={postPayroll}>
              <Landmark size={14} />{' '}
              {postedJournal
                ? L('Payroll journal already posted', 'পে-রোল জার্নাল ইতিমধ্যে পোস্টেড')
                : posting
                  ? L('Posting…', 'পোস্ট হচ্ছে…')
                  : L('1-Click Post Balanced Payroll Journal to GL', '১ ক্লিকে সুষম পে-রোল জার্নাল খতিয়ানে পোস্ট')}
            </button>
            {!postingOpen && (
              <span className="lv-hint text-rose-600">{L('Period is not open for posting.', 'সময়কাল পোস্টের জন্য খোলা নয়।')}</span>
            )}
          </div>

          {postedJournal && (
            <div className="border-t border-vault-100 bg-vault-50 px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-vault-900">
                  <CheckCircle2 size={12} className="mr-1 inline" />
                  {postedJournal.journal_number} {L('posted', 'পোস্টেড')} ·{' '}
                  {money(postedJournal.lines.reduce((total, line) => total + line.debit_poisha, 0n))}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setLensJournalId(postedJournal.id)}>
                    <ShieldCheck size={12} /> {L('Audit hash & GL lens', 'অডিট হ্যাশ ও জিএল লেন্স')}
                  </button>
                  <button type="button" className="lv-btn lv-btn-secondary !px-2 !py-1 text-[11px]" onClick={() => navigate('W08')}>
                    <ReceiptText size={12} /> {L('Open IFRS P&L now', 'এখনই আইএফআরএস পিএল খুলুন')}
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[10px] text-vault-700">
                {L(
                  'The posted accrual is already included in the general ledger and in the IFRS P&L operating expenses (accounts 5200 / 5210).',
                  'পোস্টেড সঞ্চিতি ইতিমধ্যে খতিয়ানে এবং আইএফআরএস পিএলের পরিচালন ব্যয়ে (হিসাব ৫২০০ / ৫২১০) অন্তর্ভুক্ত।',
                )}
              </p>
              <p className="mt-1 font-mono text-[10px] text-vault-600">{postedJournal.audit_hash.slice(0, 32)}…</p>
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="lv-card lv-card-pad">
            <p className="lv-kicker flex items-center gap-1.5"><HandCoins size={12} /> {L('Employer cost bridge', 'নিয়োগকর্তা ব্যয় সেতু')}</p>
            <div className="mt-3 space-y-1.5">
              {[
                { label: L('Gross salaries & allowances', 'মোট বেতন ও ভাতা'), value: totals.gross },
                { label: L('Employer PF contribution', 'নিয়োগকর্তার পিএফ'), value: totals.pfEmployer },
                { label: L('IAS 19 gratuity service cost', 'আইএএস ১৯ গ্র্যাচুইটি'), value: totals.gratuity },
                { label: L('WPPF 5% monthly provision', 'ডব্লিউপিপিএফ ৫% মাসিক'), value: wppfMonthly },
              ].map((line) => (
                <div key={line.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-ink-600">{line.label}</span>
                  <span className="font-money text-[12px] font-semibold text-ink-800">{money(line.value)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-2 border-t border-ink-200 pt-1.5">
                <span className="text-[12px] font-semibold text-ink-900">{L('Total employer cost', 'মোট নিয়োগকর্তা ব্যয়')}</span>
                <span className="font-money text-sm font-semibold text-vault-800">{money(employerCost)}</span>
              </div>
            </div>
            <p className="lv-hint mt-2 leading-relaxed">
              {L(
                `WPPF = 5% of profit before WPPF (${money(wppfAnnual)} annual ÷ 12). Profit before tax this period: ${money(profitBeforeTax)}.`,
                `ডব্লিউপিপিএফ = ডব্লিউপিপিএফ-পূর্ব মুনাফার ৫% (বার্ষিক ${money(wppfAnnual)} ÷ ১২)। এই সময়কালের করপূর্ব মুনাফা: ${money(profitBeforeTax)}।`,
              )}
            </p>
          </section>

          <section className="lv-card lv-card-pad">
            <p className="lv-kicker flex items-center gap-1.5"><Calculator size={12} /> {L('Double-rate overtime calculator', 'দ্বিগুণ হার ওভারটাইম ক্যালকুলেটর')}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-ink-50 px-2.5 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Overtime hours', 'ওভারটাইম ঘণ্টা')}</p>
                <p className="font-money mt-0.5 text-[13px] font-semibold text-ink-900">{totals.overtimeHours.toFixed(1)} h</p>
              </div>
              <div className="rounded-lg bg-ink-50 px-2.5 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-400">{L('Overtime pay', 'ওভারটাইম বেতন')}</p>
                <p className="font-money mt-0.5 text-[13px] font-semibold text-vault-800">{money(totals.overtime)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
              {L(
                'Basic hourly rate = basic ÷ 208 statutory hours. Overtime is paid at exactly 2× that rate (Labour Act 2026, s.108). Editing any hours cell re-prices the row, the gross, the PF and the journal.',
                'বেসিক ঘণ্টাপ্রতি হার = বেসিক ÷ ২০৮ বিধিবদ্ধ ঘণ্টা। ওভারটাইম ঠিক দ্বিগুণ হারে প্রদেয় (শ্রম আইন ২০২৬, ধারা ১০৮)। যেকোনো ঘণ্টা সম্পাদনা সারি, মোট, পিএফ ও জার্নাল পুনর্মূল্যায়ন করে।',
              )}
            </p>
          </section>

          <section className="lv-card lv-card-pad">
            <p className="lv-kicker flex items-center gap-1.5"><Wallet size={12} /> {L('Bulk disbursement', 'বাল্ক বিতরণ')}</p>
            <p className="mt-1 text-sm font-semibold text-ink-900">{L('BEFTN & bKash .xlsx files', 'বিইএফটিএন ও বিকাশ .এক্সএলএসএক্স ফাইল')}</p>
            <p className="lv-hint mt-1">
              {L(
                'Each workbook carries the payment sheet plus a statutory summary tab for the auditor and the bank mandate file.',
                'প্রতিটি ওয়ার্কবুকে পেমেন্ট শীটের সাথে নিরীক্ষক ও ব্যাংক ম্যান্ডেটের জন্য বিধিবদ্ধ সারসংক্ষেপ ট্যাব থাকে।',
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="lv-btn lv-btn-secondary" disabled={computedRows.length === 0} onClick={exportBeftn}>
                <Download size={14} /> {L('BEFTN .xlsx', 'বিইএফটিএন .এক্সএলএসএক্স')}
              </button>
              <button type="button" className="lv-btn lv-btn-secondary" disabled={computedRows.length === 0} onClick={exportBkash}>
                <Send size={14} /> {L('bKash .xlsx', 'বিকাশ .এক্সএলএসএক্স')}
              </button>
            </div>
            <div className="mt-3 grid gap-1.5 rounded-xl bg-ink-50 px-3 py-2">
              <p className="flex items-center justify-between text-[11px] text-ink-600">
                <span className="flex items-center gap-1"><Banknote size={11} /> {L('Net disbursement', 'নিট বিতরণ')}</span>
                <span className="font-money font-semibold text-ink-900">{money(totals.net)}</span>
              </p>
              <p className="flex items-center justify-between text-[11px] text-ink-600">
                <span className="flex items-center gap-1"><Layers size={11} /> {L('Register lines', 'রেজিস্টার লাইন')}</span>
                <span className="font-money font-semibold text-ink-900">{computedRows.length}</span>
              </p>
              <p className="flex items-center justify-between text-[11px] text-ink-600">
                <span className="flex items-center gap-1"><ShieldCheck size={11} /> {L('Legal basis', 'আইনি ভিত্তি')}</span>
                <span className="font-semibold text-vault-700">SRO 53-Law/2026</span>
              </p>
            </div>
          </section>
        </div>
      </div>

      <LedgerLensModal journal={lensJournal} onClose={() => setLensJournalId(null)} open={lensJournal !== null} contextLabel={L('Payroll accrual', 'পে-রোল সঞ্চিতি')} />
    </div>
  );
}
