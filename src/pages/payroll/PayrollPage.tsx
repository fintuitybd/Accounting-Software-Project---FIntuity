import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Building2,
  Calendar,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Lock,
  Plus,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  Smartphone,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type FiscalPeriod } from '../../setup/api';
import {
  payrollApi,
  type PayrollEmployee,
  type PayrollRun,
  type PayrollRunLine,
  type WorkerClassification,
  type PaymentChannel,
} from '../../payroll/api';
import { formatPoisha } from '../../core/money';
import { Dialog } from '../../components/ui/Dialog';

const SRO_REFERENCE = 'SRO 53-Law/2026 · Bangladesh Labour (Amendment) Act 2026';
const STANDARD_HOURS = 208; // Monthly statutory divisor hours under Section 108

const WORKER_CLASS_LABELS: Record<WorkerClassification, { en: string; bn: string; badge: string }> = {
  PERMANENT: { en: 'Permanent', bn: 'স্থায়ী', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PROBATIONARY: { en: 'Probationary', bn: 'প্রেষণকালীন', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  CONTRACTUAL: { en: 'Contractual', bn: 'চুক্তিভিত্তিক', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
  PIECE_RATE: { en: 'Piece Rate', bn: 'পিস রেট', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  APPRENTICE: { en: 'Apprentice', bn: 'শিক্ষানবিশ', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
};

const CHANNEL_ICONS: Record<PaymentChannel, typeof Banknote> = {
  BANK: Building2,
  BKASH: Smartphone,
  NAGAD: Smartphone,
  CASH: Wallet,
};

export default function PayrollPage() {
  const auth = useAuth();
  const { locale, publishToast } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);

  const companyId = auth.activeCompany?.id;

  const [activeTab, setActiveTab] = useState<'RUNS' | 'EMPLOYEES'>('RUNS');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Data
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);

  // Composer state
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [includeFestivalBonus, setIncludeFestivalBonus] = useState(false);
  const [otHoursMap, setOtHoursMap] = useState<Record<string, number>>({}); // employeeId -> scaled hundredths (150 = 1.50)
  const [tdsAdjMap, setTdsAdjMap] = useState<Record<string, string>>({}); // employeeId -> poisha string

  // Employee modal
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<PayrollEmployee | null>(null);
  const [empFormCode, setEmpFormCode] = useState('');
  const [empFormNameEn, setEmpFormNameEn] = useState('');
  const [empFormNameBn, setEmpFormNameBn] = useState('');
  const [empFormClass, setEmpFormClass] = useState<WorkerClassification>('PERMANENT');
  const [empFormNid, setEmpFormNid] = useState('');
  const [empFormTin, setEmpFormTin] = useState('');
  const [empFormJoiningDate, setEmpFormJoiningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [empFormBasic, setEmpFormBasic] = useState('50000');
  const [empFormHra, setEmpFormHra] = useState('25000');
  const [empFormMedical, setEmpFormMedical] = useState('5000');
  const [empFormConveyance, setEmpFormConveyance] = useState('5000');
  const [empFormPfEnrolled, setEmpFormPfEnrolled] = useState(true);
  const [empFormPfRateBps, setEmpFormPfRateBps] = useState('1000');
  const [empFormChannel, setEmpFormChannel] = useState<PaymentChannel>('BANK');
  const [empFormBankName, setEmpFormBankName] = useState('BRAC Bank Ltd.');
  const [empFormAccountNo, setEmpFormAccountNo] = useState('');
  const [empFormRoutingNo, setEmpFormRoutingNo] = useState('');
  const [empFormMfsNo, setEmpFormMfsNo] = useState('');

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [periodRes, empRes, runRes] = await Promise.all([
        setupApi.periods(companyId).catch(() => ({ periods: [] })),
        payrollApi.listEmployees(companyId).catch(() => ({ employees: [] })),
        payrollApi.listRuns(companyId).catch(() => ({ runs: [] })),
      ]);

      setPeriods(periodRes.periods);
      setEmployees(empRes.employees);
      setRuns(runRes.runs);

      if (periodRes.periods.length > 0 && !selectedPeriodId) {
        const openPeriod = periodRes.periods.find((p) => p.status === 'OPEN') ?? periodRes.periods[periodRes.periods.length - 1];
        if (openPeriod) {
          setSelectedPeriodId(openPeriod.id);
          setBatchDate(openPeriod.endDate);
        }
      }

      if (runRes.runs.length > 0) {
        // Load the full details of the latest run
        const latest = runRes.runs[0]!;
        const detailed = await payrollApi.getRun(companyId, latest.id);
        setSelectedRun(detailed.run);
      }
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Failed to load payroll data', message: err?.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, publishToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // When period changes, find if there's an existing run for it
  const handlePeriodChange = useCallback(
    async (pId: string) => {
      setSelectedPeriodId(pId);
      const targetPeriod = periods.find((p) => p.id === pId);
      if (targetPeriod) setBatchDate(targetPeriod.endDate);

      const existing = runs.find((r) => r.periodId === pId);
      if (existing && companyId) {
        const full = await payrollApi.getRun(companyId, existing.id);
        setSelectedRun(full.run);
        // hydrate adjustments from existing lines
        if (full.run.lines) {
          const otMap: Record<string, number> = {};
          const tdsMap: Record<string, string> = {};
          for (const line of full.run.lines) {
            otMap[line.employeeId] = line.otHoursScaled;
            tdsMap[line.employeeId] = line.tdsPoisha;
          }
          setOtHoursMap(otMap);
          setTdsAdjMap(tdsMap);
        }
      } else {
        setSelectedRun(null);
        setOtHoursMap({});
        setTdsAdjMap({});
      }
    },
    [periods, runs, companyId],
  );

  // Live client-side calculation for composer preview before saving
  const composerLines = useMemo(() => {
    return employees
      .filter((e) => e.status === 'ACTIVE')
      .map((emp) => {
        const basic = BigInt(emp.basicSalaryPoisha);
        const hra = BigInt(emp.hraPoisha);
        const med = BigInt(emp.medicalPoisha);
        const conv = BigInt(emp.conveyancePoisha);

        const otHoursScaled = otHoursMap[emp.id] ?? 0;
        // Section 108 Overtime formula: (basic * otHoursScaled) / 10400n
        const otPoisha = basic > 0n && otHoursScaled > 0 ? (basic * BigInt(otHoursScaled)) / 10400n : 0n;

        // Section 264 PF: (basic * pfRateBps) / 10000n
        const pfRate = emp.pfRateBps ?? 1000;
        const pfPoisha = emp.pfEnrolled && basic > 0n ? (basic * BigInt(pfRate)) / 10000n : 0n;

        const bonusPoisha = includeFestivalBonus && basic > 0n ? (basic * 1000n) / 10000n : 0n;
        const grossPoisha = basic + hra + med + conv + otPoisha + bonusPoisha;

        const customTds = tdsAdjMap[emp.id];
        const tdsPoisha = customTds ? BigInt(customTds) : 0n;
        const netPoisha = grossPoisha - pfPoisha - tdsPoisha > 0n ? grossPoisha - pfPoisha - tdsPoisha : 0n;

        return {
          employee: emp,
          basic,
          hra,
          med,
          conv,
          otHoursScaled,
          otPoisha,
          bonusPoisha,
          grossPoisha,
          pfEmployeePoisha: pfPoisha,
          pfEmployerPoisha: pfPoisha,
          tdsPoisha,
          netPoisha,
        };
      });
  }, [employees, otHoursMap, tdsAdjMap, includeFestivalBonus]);

  // Aggregate totals
  const composerTotals = useMemo(() => {
    let basic = 0n;
    let ot = 0n;
    let bonus = 0n;
    let gross = 0n;
    let pfEmp = 0n;
    let pfEmpr = 0n;
    let tds = 0n;
    let net = 0n;

    for (const l of composerLines) {
      basic += l.basic;
      ot += l.otPoisha;
      bonus += l.bonusPoisha;
      gross += l.grossPoisha;
      pfEmp += l.pfEmployeePoisha;
      pfEmpr += l.pfEmployerPoisha;
      tds += l.tdsPoisha;
      net += l.netPoisha;
    }

    const standardSalary = gross - ot - bonus;
    const totalDebits = standardSalary + ot + bonus + pfEmpr;
    const totalCredits = tds + pfEmp + pfEmpr + net;
    const isBalanced = totalDebits === totalCredits && totalDebits > 0n;

    return {
      basic,
      ot,
      bonus,
      gross,
      pfEmp,
      pfEmpr,
      tds,
      net,
      standardSalary,
      totalDebits,
      totalCredits,
      isBalanced,
    };
  }, [composerLines]);

  // Handlers
  const handleSaveDraft = async () => {
    if (!companyId || !selectedPeriodId) return;
    setSubmitting(true);
    try {
      const adjustments = Object.keys(otHoursMap).map((empId) => ({
        employeeId: empId,
        otHoursScaled: otHoursMap[empId],
        tdsPoisha: tdsAdjMap[empId] ?? '0',
      }));

      const res = await payrollApi.computeOrSaveDraft(companyId, {
        periodId: selectedPeriodId,
        batchDate,
        includeFestivalBonus,
        adjustments,
      });

      setSelectedRun(res.run);
      publishToast({
        tone: 'success',
        title: L('Payroll draft saved', 'পে-রোল খসড়া সংরক্ষিত'),
        message: `${res.run.linesCount} ${L('employees calculated', 'জন কর্মীর বেতন গণনা সম্পন্ন')}`,
      });
      void loadData();
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Failed to save draft', message: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!companyId || !selectedRun) return;
    setSubmitting(true);
    try {
      const res = await payrollApi.approveRun(companyId, selectedRun.id);
      setSelectedRun(res.run);
      publishToast({
        tone: 'success',
        title: L('Payroll approved', 'পে-রোল অনুমোদিত'),
        message: L('Ready for atomic General Ledger posting.', 'সাধারণ খতিয়ানে পোস্ট করার জন্য প্রস্তুত।'),
      });
      void loadData();
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Approval failed', message: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostGL = async () => {
    if (!companyId || !selectedRun) return;
    setSubmitting(true);
    try {
      const res = await payrollApi.postRun(companyId, selectedRun.id);
      setSelectedRun(res.run);
      publishToast({
        tone: 'success',
        title: L('Posted to General Ledger', 'সাধারণ খতিয়ানে পোস্ট সম্পন্ন'),
        message: `${L('Balanced journal posted with ID', 'সুষম জার্নাল পোস্ট হয়েছে')}: ${res.journalId.slice(0, 8)}`,
      });
      void loadData();
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Posting failed', message: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisburse = async () => {
    if (!companyId || !selectedRun) return;
    setSubmitting(true);
    try {
      const res = await payrollApi.disburseRun(companyId, selectedRun.id);
      setSelectedRun(res.run);
      publishToast({
        tone: 'success',
        title: L('Marked as Disbursed', 'বিতরণ সম্পন্ন হিসেবে চিহ্নিত'),
        message: L('Payouts sent via BEFTN & MFS channels.', 'বিইএফটিএন ও এমএফএস মাধ্যমে বেতন প্রদান সম্পন্ন।'),
      });
      void loadData();
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Disbursement update failed', message: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadBeftn128 = () => {
    if (!companyId || !selectedRun) return;
    const url = payrollApi.getBeftn128Url(companyId, selectedRun.id);
    window.open(url, '_blank');
  };

  const handleDownloadBeftnCsv = () => {
    if (!companyId || !selectedRun) return;
    const url = payrollApi.getBeftnCsvUrl(companyId, selectedRun.id);
    window.open(url, '_blank');
  };

  const handleDownloadMfsCsv = (provider: 'BKASH' | 'NAGAD') => {
    if (!companyId || !selectedRun) return;
    const url = payrollApi.getMfsCsvUrl(companyId, selectedRun.id, provider);
    window.open(url, '_blank');
  };

  const openAddEmployeeModal = () => {
    setEditingEmployee(null);
    setEmpFormCode(`EMP-${String(employees.length + 1).padStart(3, '0')}`);
    setEmpFormNameEn('');
    setEmpFormNameBn('');
    setEmpFormClass('PERMANENT');
    setEmpFormNid('');
    setEmpFormTin('');
    setEmpFormBasic('50000');
    setEmpFormHra('25000');
    setEmpFormMedical('5000');
    setEmpFormConveyance('5000');
    setEmpFormPfEnrolled(true);
    setEmpFormPfRateBps('1000');
    setEmpFormChannel('BANK');
    setEmpFormBankName('BRAC Bank Ltd.');
    setEmpFormAccountNo('');
    setEmpFormRoutingNo('060261726');
    setEmpFormMfsNo('');
    setEmployeeModalOpen(true);
  };

  const openEditEmployeeModal = (emp: PayrollEmployee) => {
    setEditingEmployee(emp);
    setEmpFormCode(emp.employeeCode);
    setEmpFormNameEn(emp.nameEn);
    setEmpFormNameBn(emp.nameBn ?? '');
    setEmpFormClass(emp.workerClassification);
    setEmpFormNid(emp.nidNumber ?? '');
    setEmpFormTin(emp.etin ?? '');
    setEmpFormJoiningDate(emp.joiningDate);
    setEmpFormBasic((Number(emp.basicSalaryPoisha) / 100).toString());
    setEmpFormHra((Number(emp.hraPoisha) / 100).toString());
    setEmpFormMedical((Number(emp.medicalPoisha) / 100).toString());
    setEmpFormConveyance((Number(emp.conveyancePoisha) / 100).toString());
    setEmpFormPfEnrolled(emp.pfEnrolled);
    setEmpFormPfRateBps(emp.pfRateBps.toString());
    setEmpFormChannel(emp.paymentChannel);
    setEmpFormBankName(emp.bankName ?? '');
    setEmpFormAccountNo(emp.bankAccountNumber ?? '');
    setEmpFormRoutingNo(emp.bankRoutingNumber ?? '');
    setEmpFormMfsNo(emp.mfsNumber ?? '');
    setEmployeeModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    try {
      const basicSalaryPoisha = (BigInt(Math.round(Number(empFormBasic) * 100))).toString();
      const hraPoisha = (BigInt(Math.round(Number(empFormHra) * 100))).toString();
      const medicalPoisha = (BigInt(Math.round(Number(empFormMedical) * 100))).toString();
      const conveyancePoisha = (BigInt(Math.round(Number(empFormConveyance) * 100))).toString();

      if (editingEmployee) {
        await payrollApi.updateEmployee(companyId, editingEmployee.id, {
          employeeCode: empFormCode,
          nameEn: empFormNameEn,
          nameBn: empFormNameBn || null,
          workerClassification: empFormClass,
          nidNumber: empFormNid || null,
          etin: empFormTin || null,
          joiningDate: empFormJoiningDate,
          basicSalaryPoisha,
          hraPoisha,
          medicalPoisha,
          conveyancePoisha,
          pfEnrolled: empFormPfEnrolled,
          pfRateBps: parseInt(empFormPfRateBps, 10) || 1000,
          paymentChannel: empFormChannel,
          bankName: empFormBankName || null,
          bankAccountNumber: empFormAccountNo || null,
          bankRoutingNumber: empFormRoutingNo || null,
          mfsNumber: empFormMfsNo || null,
        });
        publishToast({ tone: 'success', title: L('Employee updated', 'কর্মী তথ্য হালনাগাদ হয়েছে') });
      } else {
        await payrollApi.createEmployee(companyId, {
          employeeCode: empFormCode,
          nameEn: empFormNameEn,
          nameBn: empFormNameBn || null,
          workerClassification: empFormClass,
          nidNumber: empFormNid || null,
          etin: empFormTin || null,
          joiningDate: empFormJoiningDate,
          basicSalaryPoisha,
          hraPoisha,
          medicalPoisha,
          conveyancePoisha,
          pfEnrolled: empFormPfEnrolled,
          pfRateBps: parseInt(empFormPfRateBps, 10) || 1000,
          paymentChannel: empFormChannel,
          bankName: empFormBankName || null,
          bankAccountNumber: empFormAccountNo || null,
          bankRoutingNumber: empFormRoutingNo || null,
          mfsNumber: empFormMfsNo || null,
        });
        publishToast({ tone: 'success', title: L('Employee added', 'নতুন কর্মী যুক্ত হয়েছে') });
      }
      setEmployeeModalOpen(false);
      void loadData();
    } catch (err: any) {
      publishToast({ tone: 'error', title: 'Error saving employee', message: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  const periodOptions = useMemo(() => {
    return periods.map((p) => ({
      id: p.id,
      label: `${p.code} (${p.startDate} - ${p.endDate}) · ${p.status}`,
    }));
  }, [periods]);

  return (
    <div className="space-y-6">
      {/* 1. Header & Statutory Authority Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {L('Labour Act 2026 Payroll & Payouts', 'শ্রম আইন ২০২৬ পে-রোল ও বিতরণ')}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              <ShieldCheck size={12} /> {SRO_REFERENCE}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {L(
              'Server-authoritative payroll engine enforcing Section 108 overtime, Section 264 PF match, Section 86 salary TDS withholding, and Bangladesh Bank BEFTN/MFS payouts.',
              'ধারা ১০৮ দ্বিগুণ ওভারটাইম, ধারা ২৬৪ ভবিষ্য তহবিল ১০%+১০%, ধারা ৮৬ বেতন টিডিএস ও বিইএফটিএন/বিকাশ পে-আউট সহ সুষম পে-রোল ইঞ্জিন।',
            )}
          </p>
        </div>

        {/* Action Controls & Navigation Tabs */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('RUNS')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'RUNS'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calculator size={14} /> {L('Payroll Studio', 'পে-রোল স্টুডিও')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('EMPLOYEES')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === 'EMPLOYEES'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users size={14} /> {L('Employee Roster', 'কর্মী রেজিস্টার')} ({employees.length})
            </button>
          </div>

          <button
            type="button"
            onClick={openAddEmployeeModal}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
          >
            <UserPlus size={14} /> {L('Add Employee', 'কর্মী যুক্ত করুন')}
          </button>
        </div>
      </div>

      {/* 2. TAB: PAYROLL STUDIO */}
      {activeTab === 'RUNS' && (
        <div className="space-y-6">
          {/* Controls Bar: Period Selector, Date, Eid Bonus toggle, and Run Status */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {L('Accounting Period', 'হিসাবকাল')}
                  </label>
                  <select
                    value={selectedPeriodId}
                    onChange={(e) => void handlePeriodChange(e.target.value)}
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none"
                  >
                    {periodOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {L('Payout Date', 'প্রদানের তারিখ')}
                  </label>
                  <input
                    type="date"
                    value={batchDate}
                    onChange={(e) => setBatchDate(e.target.value)}
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 pt-5">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={includeFestivalBonus}
                      onChange={(e) => setIncludeFestivalBonus(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>{L('Include Eid Festival Bonus (10% Basic)', 'ঈদ উৎসব ভাতা (১০% মূল বেতন) অন্তর্ভুক্ত')}</span>
                  </label>
                </div>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedRun ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      selectedRun.status === 'POSTED' || selectedRun.status === 'DISBURSED'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : selectedRun.status === 'APPROVED'
                          ? 'border-blue-200 bg-blue-50 text-blue-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {selectedRun.status === 'POSTED' && <CheckCircle2 size={12} />}
                    {selectedRun.status === 'APPROVED' && <UserCheck size={12} />}
                    {selectedRun.status === 'DRAFT' && <Clock size={12} />}
                    {selectedRun.status}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {L('Unsaved Draft', 'অসংরক্ষিত খসড়া')}
                  </span>
                )}

                {/* Maker-Checker Workflow Buttons */}
                <button
                  type="button"
                  disabled={submitting || (selectedRun?.status === 'POSTED' || selectedRun?.status === 'DISBURSED')}
                  onClick={handleSaveDraft}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={submitting ? 'animate-spin' : ''} />
                  {L('Save / Recalculate Draft', 'খসড়া সংরক্ষণ / পুনঃগণনা')}
                </button>

                {selectedRun?.status === 'DRAFT' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleApprove}
                    className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    <UserCheck size={13} /> {L('Approve Run', 'অনুমোদন করুন')}
                  </button>
                )}

                {(selectedRun?.status === 'APPROVED' || selectedRun?.status === 'DRAFT') && (
                  <button
                    type="button"
                    disabled={submitting || !composerTotals.isBalanced}
                    onClick={handlePostGL}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Scale size={13} /> {L('Post Balanced GL Journal', 'সুষম খতিয়ান জার্নাল পোস্ট')}
                  </button>
                )}

                {selectedRun?.status === 'POSTED' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleDisburse}
                    className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Send size={13} /> {L('Mark Disbursed', 'বিতরণ সম্পন্ন চিহ্নিত')}
                  </button>
                )}
              </div>
            </div>

            {/* Statutory Key Indicators */}
            <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4 lg:grid-cols-6">
              <div className="rounded-lg bg-slate-50 p-3">
                <span className="text-[11px] font-medium text-slate-500 uppercase">{L('Gross Payroll', 'মোট বেতন')}</span>
                <p className="mt-1 font-mono text-base font-semibold text-slate-900">
                  {formatPoisha(composerTotals.gross)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <span className="text-[11px] font-medium text-slate-500 uppercase">{L('Overtime (Sec 108)', 'ওভারটাইম (ধারা ১০৮)')}</span>
                <p className="mt-1 font-mono text-base font-semibold text-amber-700">
                  {formatPoisha(composerTotals.ot)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <span className="text-[11px] font-medium text-slate-500 uppercase">{L('Employee PF (10%)', 'কর্মী ভবিষ্য তহবিল (১০%)')}</span>
                <p className="mt-1 font-mono text-base font-semibold text-blue-700">
                  {formatPoisha(composerTotals.pfEmp)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <span className="text-[11px] font-medium text-slate-500 uppercase">{L('Employer PF Match', 'নিয়োগকর্তার সমান অনুদান')}</span>
                <p className="mt-1 font-mono text-base font-semibold text-blue-700">
                  {formatPoisha(composerTotals.pfEmpr)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <span className="text-[11px] font-medium text-slate-500 uppercase">{L('Salary TDS (Sec 86)', 'বেতন টিডিএস (ধারা ৮৬)')}</span>
                <p className="mt-1 font-mono text-base font-semibold text-rose-700">
                  {formatPoisha(composerTotals.tds)}
                </p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <span className="text-[11px] font-medium text-emerald-800 uppercase">{L('Net Disbursement', 'নিট প্রদেয়')}</span>
                <p className="mt-1 font-mono text-base font-bold text-emerald-900">
                  {formatPoisha(composerTotals.net)}
                </p>
              </div>
            </div>
          </div>

          {/* 3. High-Density Monthly Payroll Register Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-slate-50/50">
              <h2 className="text-sm font-semibold text-slate-800">
                {L('Monthly Salary Register & Adjustments', 'মাসিক বেতন রেজিস্টার ও সমন্বয়')}
              </h2>
              <span className="text-xs text-slate-500 font-mono">
                {composerLines.length} {L('Workers Registered', 'জন কর্মী')} · {STANDARD_HOURS} {L('Monthly Statutory Hours', 'বিধিবদ্ধ ঘণ্টা')}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{L('Employee', 'কর্মী')}</th>
                    <th className="px-3 py-3">{L('Class', 'শ্রেণি')}</th>
                    <th className="px-3 py-3 text-right">{L('Basic (BDT)', 'মূল বেতন')}</th>
                    <th className="px-3 py-3 text-right">{L('Allowances', 'ভাতা')}</th>
                    <th className="px-3 py-3 text-right">{L('OT Hours (2x)', 'ওভারটাইম')}</th>
                    <th className="px-3 py-3 text-right">{L('OT Poisha', 'ওটি টাকা')}</th>
                    {includeFestivalBonus && <th className="px-3 py-3 text-right">{L('Bonus', 'বোনাস')}</th>}
                    <th className="px-3 py-3 text-right">{L('Gross Pay', 'মোট বেতন')}</th>
                    <th className="px-3 py-3 text-right">{L('PF (10%)', 'পিএফ')}</th>
                    <th className="px-3 py-3 text-right">{L('TDS (Sec 86)', 'টিডিএস')}</th>
                    <th className="px-4 py-3 text-right">{L('Net Pay (BDT)', 'নিট প্রদেয়')}</th>
                    <th className="px-3 py-3 text-center">{L('Channel', 'মাধ্যম')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {composerLines.map((line) => {
                    const emp = line.employee;
                    const classInfo = WORKER_CLASS_LABELS[emp.workerClassification];
                    const ChannelIcon = CHANNEL_ICONS[emp.paymentChannel];

                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">{emp.nameEn}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {emp.employeeCode} {emp.etin ? `· TIN: ${emp.etin}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${classInfo.badge}`}>
                            {classInfo.en}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-700">
                          {formatPoisha(line.basic)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600">
                          {formatPoisha(line.hra + line.med + line.conv)}
                        </td>

                        {/* Inline Overtime Hours Input */}
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            disabled={selectedRun?.status === 'POSTED' || selectedRun?.status === 'DISBURSED'}
                            value={(line.otHoursScaled / 100).toString()}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const scaled = Math.round(val * 100);
                              setOtHoursMap((prev) => ({ ...prev, [emp.id]: scaled }));
                            }}
                            className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-right font-mono text-xs focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
                          />
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono text-amber-800">
                          {formatPoisha(line.otPoisha)}
                        </td>

                        {includeFestivalBonus && (
                          <td className="px-3 py-2.5 text-right font-mono text-purple-700">
                            {formatPoisha(line.bonusPoisha)}
                          </td>
                        )}

                        <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-900">
                          {formatPoisha(line.grossPoisha)}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono text-blue-700">
                          {formatPoisha(line.pfEmployeePoisha)}
                        </td>

                        {/* Inline TDS Adjustment */}
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="100"
                            min="0"
                            disabled={selectedRun?.status === 'POSTED' || selectedRun?.status === 'DISBURSED'}
                            value={(Number(line.tdsPoisha) / 100).toString()}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const poisha = (BigInt(Math.round(val * 100))).toString();
                              setTdsAdjMap((prev) => ({ ...prev, [emp.id]: poisha }));
                            }}
                            className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-right font-mono text-xs text-rose-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
                          />
                        </td>

                        <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-800">
                          {formatPoisha(line.netPoisha)}
                        </td>

                        <td className="px-3 py-2.5 text-center">
                          <span
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
                            title={emp.paymentChannel === 'BANK' ? `${emp.bankName} · ${emp.bankAccountNumber}` : emp.mfsNumber ?? ''}
                          >
                            <ChannelIcon size={11} /> {emp.paymentChannel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-mono font-bold text-slate-900">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-sans uppercase text-xs">
                      {L('Register Totals', 'রেজিস্টার মোট')}
                    </td>
                    <td className="px-3 py-3 text-right">{formatPoisha(composerTotals.basic)}</td>
                    <td className="px-3 py-3 text-right">
                      {formatPoisha(
                        composerLines.reduce((acc, l) => acc + l.hra + l.med + l.conv, 0n),
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {(composerLines.reduce((acc, l) => acc + l.otHoursScaled, 0) / 100).toFixed(1)} hrs
                    </td>
                    <td className="px-3 py-3 text-right text-amber-800">{formatPoisha(composerTotals.ot)}</td>
                    {includeFestivalBonus && (
                      <td className="px-3 py-3 text-right text-purple-700">{formatPoisha(composerTotals.bonus)}</td>
                    )}
                    <td className="px-3 py-3 text-right">{formatPoisha(composerTotals.gross)}</td>
                    <td className="px-3 py-3 text-right text-blue-700">{formatPoisha(composerTotals.pfEmp)}</td>
                    <td className="px-3 py-3 text-right text-rose-700">{formatPoisha(composerTotals.tds)}</td>
                    <td className="px-4 py-3 text-right text-emerald-900 font-extrabold">{formatPoisha(composerTotals.net)}</td>
                    <td className="px-3 py-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* 4. Live GL Posting Preview & 1-Click Payout Exports Workbench */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Live GL Journal Waterfall Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Scale size={16} className="text-slate-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {L('Live Atomic GL Posting Waterfall', 'সরাসরি সুষম খতিয়ান জার্নাল প্রিভিউ')}
                  </h3>
                </div>
                {composerTotals.isBalanced ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 size={12} /> {L('Balanced Down to Poisha', 'পয়সা পর্যন্ত সুষম')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800">
                    <AlertCircle size={12} /> {L('Unbalanced Legs', 'জার্নাল অসামঞ্জস্য')}
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2.5 font-mono text-xs">
                {/* Debits */}
                <div className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-slate-800">
                  <span>
                    <strong className="text-slate-900">DR 5310</strong> Salaries & Wages Expense
                  </span>
                  <span className="font-semibold">{formatPoisha(composerTotals.standardSalary)}</span>
                </div>
                {composerTotals.ot > 0n && (
                  <div className="flex items-center justify-between rounded bg-amber-50/50 px-3 py-1.5 text-amber-900">
                    <span>
                      <strong className="text-amber-950">DR 5320</strong> Overtime Allowance (Sec 108)
                    </span>
                    <span className="font-semibold">{formatPoisha(composerTotals.ot)}</span>
                  </div>
                )}
                {composerTotals.bonus > 0n && (
                  <div className="flex items-center justify-between rounded bg-purple-50/50 px-3 py-1.5 text-purple-900">
                    <span>
                      <strong className="text-purple-950">DR 5330</strong> Festival Bonus Expense
                    </span>
                    <span className="font-semibold">{formatPoisha(composerTotals.bonus)}</span>
                  </div>
                )}
                {composerTotals.pfEmpr > 0n && (
                  <div className="flex items-center justify-between rounded bg-blue-50/50 px-3 py-1.5 text-blue-900">
                    <span>
                      <strong className="text-blue-950">DR 5340</strong> Employer PF Contribution (Sec 264)
                    </span>
                    <span className="font-semibold">{formatPoisha(composerTotals.pfEmpr)}</span>
                  </div>
                )}

                {/* Credits */}
                <div className="border-t border-slate-200 pt-2.5"></div>

                {composerTotals.tds > 0n && (
                  <div className="flex items-center justify-between rounded bg-rose-50/50 px-3 py-1.5 text-rose-900">
                    <span>
                      <strong className="text-rose-950">CR 2141</strong> Salary TDS Payable (Code 1/1141/0010/0112)
                    </span>
                    <span className="font-semibold">{formatPoisha(composerTotals.tds)}</span>
                  </div>
                )}
                {(composerTotals.pfEmp + composerTotals.pfEmpr) > 0n && (
                  <div className="flex items-center justify-between rounded bg-blue-50/50 px-3 py-1.5 text-blue-900">
                    <span>
                      <strong className="text-blue-950">CR 2150</strong> Provident Fund Payable (10% + 10%)
                    </span>
                    <span className="font-semibold">{formatPoisha(composerTotals.pfEmp + composerTotals.pfEmpr)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between rounded bg-emerald-50/50 px-3 py-1.5 text-emerald-900">
                  <span>
                    <strong className="text-emerald-950">CR 2160</strong> Net Salaries Payable
                  </span>
                  <span className="font-semibold">{formatPoisha(composerTotals.net)}</span>
                </div>

                {/* Proof Sums */}
                <div className="mt-3 flex items-center justify-between border-t-2 border-slate-200 pt-2 font-bold text-slate-900">
                  <span>{L('Total Debits == Credits Proof', 'মোট ডেবিট == ক্রেডিট প্রমাণ')}</span>
                  <span>
                    {formatPoisha(composerTotals.totalDebits)} == {formatPoisha(composerTotals.totalCredits)}
                  </span>
                </div>
              </div>
            </div>

            {/* 1-Click Payout Downloads Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Download size={16} className="text-slate-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {L('1-Click Statutory Payout Exports', '১-ক্লিকে সংবিধিবদ্ধ পে-আউট ফাইল')}
                  </h3>
                </div>
                <span className="text-xs text-slate-500">
                  {selectedRun ? `${selectedRun.periodCode ?? selectedRun.batchDate}` : 'Draft'}
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {L(
                  'Automated export of Bangladesh Bank BEFTN clearing files and Mobile Financial Services bulk salary disbursement sheets.',
                  'বাংলাদেশ ব্যাংক বিইএফটিএন ক্লিয়ারিং ফাইল ও এমএফএস (বিকাশ/নগদ) বাল্ক স্যালারি শিট সরাসরি ডাউনলোড।',
                )}
              </p>

              <div className="mt-4 space-y-3">
                {/* BEFTN 128-column */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <FileText size={14} className="text-blue-600" /> Bangladesh Bank BEFTN 128-Column Text File
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Standard fixed-width NACHA/BEFTN layout for direct corporate internet banking upload.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={handleDownloadBeftn128}
                    className="flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
                  >
                    <Download size={12} /> .txt
                  </button>
                </div>

                {/* BEFTN CSV */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <FileSpreadsheet size={14} className="text-emerald-600" /> BEFTN Salary Payout CSV
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Bank routing code, employee account, BDT net salary and batch payment reference.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={handleDownloadBeftnCsv}
                    className="flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
                  >
                    <Download size={12} /> .csv
                  </button>
                </div>

                {/* bKash MFS */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Smartphone size={14} className="text-rose-600" /> bKash Bulk Payroll Disbursement Sheet
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Corporate bKash MSISDN, encrypted salary reference and disbursement purpose.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={() => handleDownloadMfsCsv('BKASH')}
                    className="flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-40"
                  >
                    <Download size={12} /> bKash
                  </button>
                </div>

                {/* Nagad MFS */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Smartphone size={14} className="text-amber-600" /> Nagad Corporate Disbursement Sheet
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Nagad MSISDN wallet batch payout sheet for non-banked personnel.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedRun}
                    onClick={() => handleDownloadMfsCsv('NAGAD')}
                    className="flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-amber-700 disabled:opacity-40"
                  >
                    <Download size={12} /> Nagad
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. TAB: EMPLOYEE ROSTER */}
      {activeTab === 'EMPLOYEES' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50/50">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                {L('Employee Roster & Statutory Classifications', 'কর্মী রেজিস্টার ও সংবিধিবদ্ধ শ্রেণিবিন্যাস')}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {L(
                  'Permanent, probationary, contractual and apprentice worker profiles with Labour Act 2026 provident fund and salary compensation.',
                  'শ্রম আইন ২০২৬ অনুযায়ী শ্রমিক শ্রেণিবিন্যাস, পিএফ অংশগ্রহণ ও বেতন কাঠামো।',
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={openAddEmployeeModal}
              className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
            >
              <UserPlus size={14} /> {L('Add Employee', 'কর্মী যুক্ত করুন')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">{L('Code', 'কোড')}</th>
                  <th className="px-4 py-3">{L('Name & Identifiers', 'নাম ও পরিচিতি')}</th>
                  <th className="px-3 py-3">{L('Classification', 'শ্রেণি')}</th>
                  <th className="px-3 py-3 text-right">{L('Basic Salary', 'মূল বেতন')}</th>
                  <th className="px-3 py-3 text-right">{L('HRA', 'বাড়ি ভাড়া')}</th>
                  <th className="px-3 py-3 text-right">{L('Medical', 'চিকিৎসা')}</th>
                  <th className="px-3 py-3 text-right">{L('Conveyance', 'যাতায়াত')}</th>
                  <th className="px-3 py-3 text-center">{L('PF Enrolled', 'পিএফ')}</th>
                  <th className="px-3 py-3">{L('Payout Channel', 'বিতরণ মাধ্যম')}</th>
                  <th className="px-3 py-3 text-center">{L('Status', 'অবস্থা')}</th>
                  <th className="px-4 py-3 text-right">{L('Actions', 'পদক্ষেপ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => {
                  const classInfo = WORKER_CLASS_LABELS[emp.workerClassification];
                  const ChannelIcon = CHANNEL_ICONS[emp.paymentChannel];

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">{emp.employeeCode}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{emp.nameEn}</div>
                        <div className="text-[11px] text-slate-500">
                          {emp.nameBn ? `${emp.nameBn} · ` : ''}
                          {emp.etin ? `TIN: ${emp.etin}` : 'No e-TIN'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${classInfo.badge}`}>
                          {classInfo.en}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium text-slate-800">
                        {emp.basicSalaryBdt}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">{emp.hraBdt}</td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">{emp.medicalBdt}</td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">{emp.conveyanceBdt}</td>
                      <td className="px-3 py-3 text-center">
                        {emp.pfEnrolled ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                            <CheckCircle2 size={12} /> {(emp.pfRateBps / 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <ChannelIcon size={13} className="text-slate-500" />
                          <span className="font-medium">{emp.paymentChannel}</span>
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {emp.paymentChannel === 'BANK' ? `${emp.bankName} · ${emp.bankAccountNumber}` : emp.mfsNumber}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            emp.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {emp.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditEmployeeModal(emp)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {L('Edit', 'সম্পাদনা')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Employee Modal (Add / Edit) */}
      <Dialog
        open={employeeModalOpen}
        onClose={() => setEmployeeModalOpen(false)}
        title={editingEmployee ? L('Edit Employee Profile', 'কর্মী তথ্য সম্পাদন') : L('Add New Employee', 'নতুন কর্মী নিবন্ধন')}
      >
        <form onSubmit={handleSaveEmployee} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('Employee Code', 'কর্মী কোড')} *</label>
              <input
                type="text"
                required
                value={empFormCode}
                onChange={(e) => setEmpFormCode(e.target.value.toUpperCase())}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                {L('Worker Classification', 'শ্রমিক শ্রেণিবিন্যাস')} *
              </label>
              <select
                value={empFormClass}
                onChange={(e) => setEmpFormClass(e.target.value as WorkerClassification)}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 focus:border-slate-400 focus:outline-none"
              >
                {Object.entries(WORKER_CLASS_LABELS).map(([key, val]) => (
                  <option key={key} value={key}>
                    {val.en} ({val.bn})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('Name (English)', 'নাম (ইংরেজি)')} *</label>
              <input
                type="text"
                required
                value={empFormNameEn}
                onChange={(e) => setEmpFormNameEn(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('Name (Bengali)', 'নাম (বাংলা)')}</label>
              <input
                type="text"
                value={empFormNameBn}
                onChange={(e) => setEmpFormNameBn(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none font-bengali"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('National ID (NID)', 'এনআইডি')}</label>
              <input
                type="text"
                value={empFormNid}
                onChange={(e) => setEmpFormNid(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('12-Digit e-TIN', '১২ সংখ্যার ই-টিআইএন')}</label>
              <input
                type="text"
                value={empFormTin}
                onChange={(e) => setEmpFormTin(e.target.value)}
                placeholder="123456789012"
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{L('Joining Date', 'যোগদানের তারিখ')} *</label>
              <input
                type="date"
                required
                value={empFormJoiningDate}
                onChange={(e) => setEmpFormJoiningDate(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Salary Breakdown */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="font-semibold text-slate-800 mb-2">{L('Monthly Compensation Structure (BDT)', 'মাসিক বেতন কাঠামো (টাকা)')}</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block font-medium text-slate-600 mb-1">{L('Basic', 'মূল')} *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={empFormBasic}
                  onChange={(e) => setEmpFormBasic(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">{L('HRA (50% max)', 'বাড়ি ভাড়া')} *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={empFormHra}
                  onChange={(e) => setEmpFormHra(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">{L('Medical', 'চিকিৎসা')} *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={empFormMedical}
                  onChange={(e) => setEmpFormMedical(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">{L('Conveyance', 'যাতায়াত')} *</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={empFormConveyance}
                  onChange={(e) => setEmpFormConveyance(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={empFormPfEnrolled}
                  onChange={(e) => setEmpFormPfEnrolled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>{L('Enrolled in Recognised Provident Fund (Sec 264)', 'ভবিষ্য তহবিল অংশগ্রহণ (ধারা ২৬৪)')}</span>
              </label>
              {empFormPfEnrolled && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span>{L('Rate:', 'হার:')}</span>
                  <input
                    type="number"
                    value={(parseInt(empFormPfRateBps, 10) / 100).toString()}
                    onChange={(e) => setEmpFormPfRateBps((parseFloat(e.target.value) * 100).toString())}
                    className="w-12 rounded border border-slate-200 bg-white px-1 text-center font-mono"
                  />
                  <span>%</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Routing */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h4 className="font-semibold text-slate-800 mb-2">{L('Disbursement & Payout Routing', 'পরিশোধ ও ব্যাংকিং মাধ্যম')}</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block font-medium text-slate-600 mb-1">{L('Channel', 'মাধ্যম')} *</label>
                <select
                  value={empFormChannel}
                  onChange={(e) => setEmpFormChannel(e.target.value as PaymentChannel)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1"
                >
                  <option value="BANK">Bank Account (BEFTN)</option>
                  <option value="BKASH">bKash MFS</option>
                  <option value="NAGAD">Nagad MFS</option>
                  <option value="CASH">Cash in Hand</option>
                </select>
              </div>

              {empFormChannel === 'BANK' ? (
                <>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">{L('Bank Name', 'ব্যাংকের নাম')}</label>
                    <input
                      type="text"
                      value={empFormBankName}
                      onChange={(e) => setEmpFormBankName(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">{L('Account Number', 'হিসাব নম্বর')}</label>
                    <input
                      type="text"
                      value={empFormAccountNo}
                      onChange={(e) => setEmpFormAccountNo(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">{L('9-Digit Routing No.', 'রাউটিং নম্বর')}</label>
                    <input
                      type="text"
                      value={empFormRoutingNo}
                      onChange={(e) => setEmpFormRoutingNo(e.target.value)}
                      placeholder="060261726"
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 font-mono"
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-3">
                  <label className="block font-medium text-slate-600 mb-1">{L('Mobile Wallet Number (MSISDN)', 'মোবাইল ওয়ালেট নম্বর')}</label>
                  <input
                    type="text"
                    value={empFormMfsNo}
                    onChange={(e) => setEmpFormMfsNo(e.target.value)}
                    placeholder="01700000000"
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEmployeeModalOpen(false)}
              className="rounded border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              {L('Cancel', 'বাতিল')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? L('Saving…', 'সংরক্ষণ হচ্ছে…') : L('Save Employee', 'কর্মী সংরক্ষণ')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
