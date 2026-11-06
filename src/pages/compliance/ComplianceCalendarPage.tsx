import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCheck2,
  Filter,
  Lock,
  RefreshCw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { Dialog } from '../../components/ui/Dialog';
import { formatPoisha } from '../../core/money';
import {
  complianceApi,
  type ComplianceCalendarEvent,
  type ComplianceCategory,
  type ComplianceStatus,
  type ComplianceSummary,
  type GazettedHoliday,
  type StatutoryBody,
} from '../../compliance/api';

type CalendarViewMode = 'TIMELINE' | 'MATRIX';

export default function ComplianceCalendarPage() {
  const auth = useAuth();
  const { locale, publishToast } = usePreferences();
  const L = useCallback((en: string, bn: string) => (locale === 'bn-BD' ? bn : en), [locale]);

  const [viewMode, setViewMode] = useState<CalendarViewMode>('TIMELINE');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [events, setEvents] = useState<ComplianceCalendarEvent[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [holidays, setHolidays] = useState<GazettedHoliday[]>([]);

  // Filters
  const [filterBody, setFilterBody] = useState<StatutoryBody | 'ALL'>('ALL');
  const [filterStatus, setFilterStatus] = useState<ComplianceStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Calendar Matrix Month Navigation (defaults to current date: November 2026)
  const [matrixDate, setMatrixDate] = useState(() => new Date('2026-11-01T00:00:00Z'));

  // Filing Modal State
  const [filingModalEvent, setFilingModalEvent] = useState<ComplianceCalendarEvent | null>(null);
  const [filingAckRef, setFilingAckRef] = useState('');
  const [filingNotes, setFilingNotes] = useState('');
  const [filingLockPeriod, setFilingLockPeriod] = useState(true);
  const [filingSubmitting, setFilingSubmitting] = useState(false);

  const companyId = auth.activeCompany?.id;

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [sumRes, evtsRes, holsRes] = await Promise.all([
        complianceApi.getSummary(companyId).catch(() => ({ summary: null })),
        complianceApi.listEvents(companyId).catch(() => ({ events: [] })),
        complianceApi.listHolidays(companyId).catch(() => ({ holidays: [] })),
      ]);

      setSummary(sumRes.summary);
      setEvents(evtsRes.events);
      setHolidays(holsRes.holidays);

      // If no events generated yet, auto-trigger generation
      if (evtsRes.events.length === 0) {
        const genRes = await complianceApi.generateSchedule(companyId).catch(() => null);
        if (genRes?.events) {
          setEvents(genRes.events);
          const freshSum = await complianceApi.getSummary(companyId).catch(() => ({ summary: null }));
          setSummary(freshSum.summary);
        }
      }
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('Failed to load compliance calendar', 'সম্মতি ক্যালেন্ডার লোড করা যায়নি'),
        message: error instanceof Error ? error.message : L('Check network or permissions.', 'নেটওয়ার্ক বা অনুমতি পরীক্ষা করুন।'),
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, publishToast, L]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    if (!companyId) return;
    setGenerating(true);
    try {
      const res = await complianceApi.generateSchedule(companyId);
      setEvents(res.events);
      const sumRes = await complianceApi.getSummary(companyId);
      setSummary(sumRes.summary);
      publishToast({
        tone: 'success',
        title: L('Statutory schedule refreshed', 'সংবিধিবদ্ধ সময়সূচি রিফ্রেশ করা হয়েছে'),
        message: L(
          `Generated / updated ${res.generatedCount} statutory compliance deadlines with holiday advancement.`,
          `ছুটির সমন্বয়সহ ${res.generatedCount}টি সংবিধিবদ্ধ সম্মতি সময়সীমা হালনাগাদ করা হয়েছে।`,
        ),
      });
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('Failed to refresh schedule', 'সময়সূচি রিফ্রেশ ব্যর্থ'),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setGenerating(false);
    }
  };

  const openFilingModal = (event: ComplianceCalendarEvent) => {
    setFilingModalEvent(event);
    setFilingAckRef(event.filingReference || '');
    setFilingNotes(event.notes || '');
    setFilingLockPeriod(event.autoLockPeriodOnExpiry);
  };

  const handleConfirmFiling = async () => {
    if (!companyId || !filingModalEvent) return;
    if (!filingAckRef.trim()) {
      publishToast({
        tone: 'warning',
        title: L('Filing reference required', 'দাখিল রেফারেন্স আবশ্যক'),
        message: L('Enter the official NBR acknowledgement / challan reference number.', 'অফিসিয়াল এনবিআর প্রাপ্তি স্বীকার / চালান নম্বর লিখুন।'),
      });
      return;
    }

    setFilingSubmitting(true);
    try {
      const res = await complianceApi.fileEvent(companyId, filingModalEvent.id, {
        filingReference: filingAckRef.trim(),
        notes: filingNotes.trim() || null,
        lockPeriod: filingLockPeriod,
      });

      setEvents((prev) => prev.map((e) => (e.id === res.event.id ? res.event : e)));
      const sumRes = await complianceApi.getSummary(companyId).catch(() => null);
      if (sumRes?.summary) setSummary(sumRes.summary);

      publishToast({
        tone: 'success',
        title: L('Filing confirmed & recorded', 'দাখিল নিশ্চিত ও নথিভুক্ত হয়েছে'),
        message: filingLockPeriod && filingModalEvent.periodId
          ? L(`Filing ACK #${filingAckRef} recorded and accounting period locked.`, `প্রাপ্তি নম্বর #${filingAckRef} নথিভুক্ত এবং হিসাবকাল লক করা হয়েছে।`)
          : L(`Filing ACK #${filingAckRef} recorded successfully.`, `প্রাপ্তি নম্বর #${filingAckRef} সফলভাবে নথিভুক্ত হয়েছে।`),
      });
      setFilingModalEvent(null);
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('Filing recording failed', 'দাখিল নথিভুক্তকরণ ব্যর্থ'),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFilingSubmitting(false);
    }
  };

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterBody !== 'ALL' && e.statutoryBody !== filterBody) return false;
      if (filterStatus !== 'ALL' && e.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = e.titleEn.toLowerCase().includes(q) || e.titleBn.toLowerCase().includes(q);
        const matchesCategory = e.category.toLowerCase().includes(q);
        const matchesPeriod = e.periodLabel?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesCategory && !matchesPeriod) return false;
      }
      return true;
    });
  }, [events, filterBody, filterStatus, searchQuery]);

  // Group events by Month for Timeline Grid
  const timelineGroups = useMemo(() => {
    const groups: Record<string, { labelEn: string; labelBn: string; events: ComplianceCalendarEvent[] }> = {};
    for (const evt of filteredEvents) {
      const [yearStr, monthStr] = evt.adjustedDeadline.split('-');
      const y = parseInt(yearStr || '2026', 10);
      const m = parseInt(monthStr || '1', 10) - 1;
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      if (!groups[key]) {
        const d = new Date(Date.UTC(y, m, 1));
        const en = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const bn = d.toLocaleDateString('bn-BD', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        groups[key] = { labelEn: en, labelBn: bn, events: [] };
      }
      groups[key]!.events.push(evt);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEvents]);

  // Calendar Matrix Month Grid Computations
  const matrixYear = matrixDate.getUTCFullYear();
  const matrixMonth = matrixDate.getUTCMonth(); // 0-indexed
  const matrixMonthLabelEn = matrixDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const matrixMonthLabelBn = matrixDate.toLocaleDateString('bn-BD', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const holidayDateMap = useMemo(() => {
    const map = new Map<string, GazettedHoliday>();
    for (const h of holidays) {
      map.set(h.holidayDate, h);
    }
    return map;
  }, [holidays]);

  const eventDateMap = useMemo(() => {
    const map = new Map<string, ComplianceCalendarEvent[]>();
    for (const e of events) {
      const existing = map.get(e.adjustedDeadline) ?? [];
      existing.push(e);
      map.set(e.adjustedDeadline, existing);
    }
    return map;
  }, [events]);

  const daysInMatrixMonth = useMemo(() => {
    const firstDay = new Date(Date.UTC(matrixYear, matrixMonth, 1));
    const startingDayOfWeek = firstDay.getUTCDay(); // 0 (Sun) to 6 (Sat)
    const daysInCurrent = new Date(Date.UTC(matrixYear, matrixMonth + 1, 0)).getUTCDate();

    const cells: Array<{
      dateIso: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isWeekend: boolean; // Friday (5) or Saturday (6)
      holiday: GazettedHoliday | null;
      events: ComplianceCalendarEvent[];
    }> = [];

    // Leading padding from prior month
    const prevMonthDays = new Date(Date.UTC(matrixYear, matrixMonth, 0)).getUTCDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      const d = new Date(Date.UTC(matrixYear, matrixMonth - 1, dNum));
      const iso = d.toISOString().slice(0, 10);
      const isWeekend = d.getUTCDay() === 5 || d.getUTCDay() === 6;
      cells.push({
        dateIso: iso,
        dayNumber: dNum,
        isCurrentMonth: false,
        isWeekend,
        holiday: holidayDateMap.get(iso) ?? null,
        events: eventDateMap.get(iso) ?? [],
      });
    }

    // Days in current month
    for (let dNum = 1; dNum <= daysInCurrent; dNum++) {
      const d = new Date(Date.UTC(matrixYear, matrixMonth, dNum));
      const iso = d.toISOString().slice(0, 10);
      const isWeekend = d.getUTCDay() === 5 || d.getUTCDay() === 6;
      cells.push({
        dateIso: iso,
        dayNumber: dNum,
        isCurrentMonth: true,
        isWeekend,
        holiday: holidayDateMap.get(iso) ?? null,
        events: eventDateMap.get(iso) ?? [],
      });
    }

    // Trailing padding to fill 35 or 42 cells (7 columns)
    const totalNeeded = cells.length <= 35 ? 35 : 42;
    const remaining = totalNeeded - cells.length;
    for (let dNum = 1; dNum <= remaining; dNum++) {
      const d = new Date(Date.UTC(matrixYear, matrixMonth + 1, dNum));
      const iso = d.toISOString().slice(0, 10);
      const isWeekend = d.getUTCDay() === 5 || d.getUTCDay() === 6;
      cells.push({
        dateIso: iso,
        dayNumber: dNum,
        isCurrentMonth: false,
        isWeekend,
        holiday: holidayDateMap.get(iso) ?? null,
        events: eventDateMap.get(iso) ?? [],
      });
    }

    return cells;
  }, [matrixYear, matrixMonth, holidayDateMap, eventDateMap]);

  const bodyBadgeClass = (body: StatutoryBody) => {
    switch (body) {
      case 'NBR_VAT':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
      case 'NBR_TAX':
        return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800';
      case 'RJSC':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800';
    }
  };

  const statusBadge = (status: ComplianceStatus, daysRemaining: number) => {
    if (status === 'FILED') {
      return (
        <span className="ql-badge ql-badge-success flex items-center gap-1">
          <CheckCircle2 size={12} /> {L('FILED', 'দাখিলকৃত')}
        </span>
      );
    }
    if (status === 'PREPARED') {
      return (
        <span className="ql-badge ql-badge-info flex items-center gap-1">
          <Clock size={12} /> {L('PREPARED', 'প্রস্তুত')}
        </span>
      );
    }
    if (status === 'OVERDUE' || daysRemaining < 0) {
      return (
        <span className="ql-badge ql-badge-danger flex items-center gap-1 animate-pulse">
          <AlertTriangle size={12} /> {L('OVERDUE', 'বিলম্বিত')}
        </span>
      );
    }
    if (daysRemaining <= 7) {
      return (
        <span className="ql-badge ql-badge-warn flex items-center gap-1">
          <Clock size={12} /> {L('DUE SOON', 'শীঘ্রই প্রদেয়')}
        </span>
      );
    }
    return (
      <span className="ql-badge ql-badge-neutral flex items-center gap-1">
        <Clock size={12} /> {L('PENDING', 'অপেক্ষমান')}
      </span>
    );
  };

  const countdownBadge = (daysRemaining: number) => {
    if (daysRemaining > 7) {
      return (
        <span className="ql-badge ql-badge-success text-[11px]">
          {L(`Due in ${daysRemaining}d`, `${daysRemaining} দিনে বাকি`)}
        </span>
      );
    }
    if (daysRemaining > 0) {
      return (
        <span className="ql-badge ql-badge-warn text-[11px] animate-pulse">
          {L(`Due in ${daysRemaining}d`, `${daysRemaining} দিনে বাকি`)}
        </span>
      );
    }
    if (daysRemaining === 0) {
      return (
        <span className="ql-badge ql-badge-warn text-[11px] font-bold animate-pulse">
          {L('Due Today', 'আজকেই প্রদেয়')}
        </span>
      );
    }
    return (
      <span className="ql-badge ql-badge-danger text-[11px] font-bold animate-pulse">
        {L(`${Math.abs(daysRemaining)}d overdue`, `${Math.abs(daysRemaining)} দিন বিলম্বিত`)}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* 1. Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-ql-control bg-ql-brand-soft text-ql-brand">
              <CalendarClock size={20} aria-hidden />
            </span>
            <h1 className="text-xl font-bold tracking-tight text-ql-ink sm:text-2xl">
              {L('Statutory Compliance Calendar', 'সংবিধিবদ্ধ সম্মতি ক্যালেন্ডার')}
            </h1>
            <span className="ql-badge ql-badge-brand text-[11px]">Ordinance 38/2026</span>
          </div>
          <p className="mt-1 text-[13px] text-ql-ink-muted">
            {L(
              'Holiday-aware deadline advancement engine (BD Friday-Saturday weekend, Section 64 VAT rule & ITA 2023).',
              'ছুটি সচেতন সময়সীমা সমন্বয় ইঞ্জিন (বাংলাদেশ শুক্র-শনি সাপ্তাহিক ছুটি, মূসক ধারা ৬৪ ও আয়কর আইন ২০২৩)।',
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Dual View Mode Switcher */}
          <div className="flex rounded-ql-control border border-ql-border bg-ql-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('TIMELINE')}
              className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-medium transition-all ${
                viewMode === 'TIMELINE'
                  ? 'bg-ql-brand text-white shadow-sm'
                  : 'text-ql-ink-muted hover:text-ql-ink'
              }`}
            >
              <CalendarDays size={15} />
              <span>{L('Timeline Grid', 'টাইমলাইন গ্রিড')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MATRIX')}
              className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-medium transition-all ${
                viewMode === 'MATRIX'
                  ? 'bg-ql-brand text-white shadow-sm'
                  : 'text-ql-ink-muted hover:text-ql-ink'
              }`}
            >
              <CalendarCheck2 size={15} />
              <span>{L('Calendar Matrix', 'ক্যালেন্ডার ম্যাট্রিক্স')}</span>
            </button>
          </div>

          {/* Refresh / Generate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex h-9 items-center gap-1.5 rounded-ql-control border border-ql-border bg-ql-surface px-3 text-[13px] font-medium text-ql-ink hover:border-ql-border-strong hover:bg-ql-surface-muted disabled:opacity-50"
            title={L('Recalculate statutory deadlines and holiday shifts', 'সংবিধিবদ্ধ সময়সীমা ও ছুটির সমন্বয় পুনঃগণনা')}
          >
            <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{L('Refresh Schedule', 'তফসিল রিফ্রেশ')}</span>
          </button>
        </div>
      </div>

      {/* 2. 4-Card Executive KPI Header */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI Card 1: Next Statutory Deadline */}
        <div className="ql-card flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ql-ink-muted">
              {L('Next Statutory Deadline', 'পরবর্তী সংবিধিবদ্ধ সময়সীমা')}
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <CalendarClock size={15} />
            </span>
          </div>
          <div className="mt-3">
            {summary?.nextDeadline ? (
              <>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-base font-bold text-ql-ink">
                    {summary.nextDeadline.titleEn.split('(')[0]?.trim()}
                  </span>
                  {countdownBadge(summary.nextDeadline.daysRemaining)}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="ql-mono text-sm font-semibold text-ql-brand">
                    {summary.nextDeadline.adjustedDeadline}
                  </span>
                  {summary.nextDeadline.isShifted ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      +{summary.nextDeadline.shiftDays}d Shift
                    </span>
                  ) : null}
                </div>
                {summary.nextDeadline.shiftCallout ? (
                  <p className="mt-1 truncate text-[11px] text-amber-700 dark:text-amber-400">
                    {summary.nextDeadline.shiftCallout}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-ql-ink-subtle">
                    {summary.nextDeadline.periodLabel ?? L('Current tax period', 'বর্তমান কর মেয়াদ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-ql-ink-muted">{L('All obligations up to date', 'সকল দায় হালনাগাদ রয়েছে')}</p>
            )}
          </div>
        </div>

        {/* KPI Card 2: Total Withheld TDS/VDS Pending Deposit (BDT) */}
        <div className="ql-card flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ql-ink-muted">
              {L('Pending Withheld TDS/VDS (BDT)', 'জমা বাকি মোট উৎসে ভ্যাট ও কর')}
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <Scale size={15} />
            </span>
          </div>
          <div className="mt-3">
            <p className="ql-mono text-xl font-bold tracking-tight text-ql-ink">
              {formatPoisha(BigInt(summary?.totalWithheldPendingDepositPoisha ?? '0'), {
                locale,
                showSymbol: true,
                grouping: 'LAKH_CRORE',
              })}
            </p>
            <p className="mt-1 text-[11px] text-ql-ink-muted">
              {L('Pending A-Challan deposit (GL 2130, 2140, 2141)', 'এ-চালান জমাকৃত ব্যতিরেকে (খতিয়ান ২১৩০, ২১৪০, ২১৪১)')}
            </p>
          </div>
        </div>

        {/* KPI Card 3: Holiday-Shifted Deadlines */}
        <div className="ql-card flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ql-ink-muted">
              {L('Holiday-Shifted Deadlines', 'ছুটির কারণে স্থানান্তরিত সময়সীমা')}
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="ql-mono text-xl font-bold text-ql-ink">
                {summary?.holidayShiftedCount ?? 0}
              </span>
              <span className="text-[12px] text-ql-ink-muted">
                {L('obligations advanced', 'সময়সীমা সমন্বিত')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              {L('Friday-Saturday weekend & gazetted holiday immunity applied.', 'শুক্র-শনিবার ও সরকারি ছুটির দায়মুক্তি কার্যকর।')}
            </p>
          </div>
        </div>

        {/* KPI Card 4: Filed On-Time Rate */}
        <div className="ql-card flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ql-ink-muted">
              {L('Filed On-Time Rate', 'যথাসময়ে দাখিলের হার')}
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 size={15} />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="ql-mono text-xl font-bold text-ql-ink">
                {summary?.filedOnTimeRate ?? 100}%
              </span>
              <span className="ql-badge ql-badge-success text-[10px]">
                {L('100% Compliant', 'শতভাগ সম্মত')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ql-ink-muted">
              {L(
                `${summary?.counts.filed ?? 0} of ${summary?.counts.total ?? 0} filed within adjusted deadlines.`,
                `${summary?.counts.total ?? 0}টির মধ্যে ${summary?.counts.filed ?? 0}টি যথাসময়ে দাখিল করা হয়েছে।`,
              )}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Filter Bar */}
      <div className="flex flex-col gap-3 rounded-ql border border-ql-border bg-ql-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-[12px] font-semibold text-ql-ink-muted">
            <Filter size={14} /> {L('Filters:', 'ফিল্টার:')}
          </span>

          {/* Authority Filter */}
          <select
            value={filterBody}
            onChange={(e) => setFilterBody(e.target.value as StatutoryBody | 'ALL')}
            className="h-8 rounded-ql-control border border-ql-border bg-ql-surface px-2 text-[12px] text-ql-ink hover:border-ql-border-strong focus:outline-none"
          >
            <option value="ALL">{L('All Authorities', 'সকল কর্তৃপক্ষ')}</option>
            <option value="NBR_VAT">NBR VAT (মূসক)</option>
            <option value="NBR_TAX">NBR Tax (আয়কর)</option>
            <option value="RJSC">RJSC (আরজেএসসি)</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as ComplianceStatus | 'ALL')}
            className="h-8 rounded-ql-control border border-ql-border bg-ql-surface px-2 text-[12px] text-ql-ink hover:border-ql-border-strong focus:outline-none"
          >
            <option value="ALL">{L('All Statuses', 'সকল অবস্থা')}</option>
            <option value="PENDING">{L('Pending', 'অপেক্ষমান')}</option>
            <option value="PREPARED">{L('Prepared', 'প্রস্তুত')}</option>
            <option value="FILED">{L('Filed', 'দাখিলকৃত')}</option>
            <option value="OVERDUE">{L('Overdue', 'বিলম্বিত')}</option>
          </select>
        </div>

        {/* Search Input */}
        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={L('Search obligations, forms…', 'দায় বা ফরম খুঁজুন…')}
            className="h-8 w-full rounded-ql-control border border-ql-border bg-ql-surface px-3 text-[12px] text-ql-ink placeholder:text-ql-ink-subtle focus:border-ql-brand focus:outline-none"
          />
        </div>
      </div>

      {/* 4. Main Body: Timeline Grid or Calendar Matrix */}
      {loading ? (
        <div className="grid h-64 place-items-center rounded-ql border border-ql-border bg-ql-surface">
          <p className="flex items-center gap-2 text-[13px] text-ql-ink-muted">
            <RefreshCw size={16} className="animate-spin text-ql-brand" />
            {L('Loading statutory compliance calendar…', 'সংবিধিবদ্ধ সম্মতি ক্যালেন্ডার লোড হচ্ছে…')}
          </p>
        </div>
      ) : viewMode === 'TIMELINE' ? (
        /* ======================== VIEW 1: STATUTORY TIMELINE GRID ======================== */
        <div className="space-y-6">
          {timelineGroups.length === 0 ? (
            <div className="grid h-48 place-items-center rounded-ql border border-dashed border-ql-border bg-ql-surface p-6 text-center">
              <p className="text-[13px] text-ql-ink-muted">
                {L('No compliance deadlines match the selected filter criteria.', 'নির্বাচিত ফিল্টারের সাথে কোনো সংবিধিবদ্ধ সময়সীমা মেলেনি।')}
              </p>
            </div>
          ) : (
            timelineGroups.map(([monthKey, group]) => (
              <div key={monthKey} className="overflow-hidden rounded-ql border border-ql-border bg-ql-surface shadow-sm">
                <div className="flex items-center justify-between border-b border-ql-border bg-ql-surface-muted/60 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={16} className="text-ql-brand" />
                    <h2 className="text-sm font-bold text-ql-ink">{L(group.labelEn, group.labelBn)}</h2>
                  </div>
                  <span className="text-[12px] font-medium text-ql-ink-muted">
                    {group.events.length} {L('obligations', 'দায়')}
                  </span>
                </div>

                <div className="divide-y divide-ql-border">
                  {group.events.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex flex-col gap-3 p-4 transition-colors hover:bg-ql-surface-muted/30 lg:flex-row lg:items-center lg:justify-between"
                    >
                      {/* Left: Authority & Title */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${bodyBadgeClass(
                              evt.statutoryBody,
                            )}`}
                          >
                            {evt.statutoryBody === 'NBR_VAT'
                              ? 'NBR VAT'
                              : evt.statutoryBody === 'NBR_TAX'
                                ? 'NBR Tax'
                                : 'RJSC'}
                          </span>
                          <span className="text-[13px] font-bold text-ql-ink">
                            {L(evt.titleEn, evt.titleBn)}
                          </span>
                          {evt.periodLabel ? (
                            <span className="rounded bg-ql-surface-muted px-1.5 py-0.5 text-[11px] text-ql-ink-muted">
                              {evt.periodLabel}
                            </span>
                          ) : null}
                          {statusBadge(evt.status, evt.daysRemaining)}
                        </div>

                        {/* Statutory vs Adjusted Dates & Holiday Shift Callout */}
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                          {evt.isShifted ? (
                            <div className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 border border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300">
                              <ShieldCheck size={13} className="text-amber-600 dark:text-amber-400" />
                              <span className="font-semibold">{evt.shiftCallout}</span>
                              <span className="rounded bg-amber-200/80 px-1 py-0.2 font-mono text-[10px] font-bold dark:bg-amber-900">
                                +{evt.shiftDays}d Shift
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-ql-ink-muted">
                              <span>
                                {L('Statutory Deadline:', 'সংবিধিবদ্ধ সময়সীমা:')}{' '}
                                <strong className="text-ql-ink">{evt.adjustedDeadline}</strong>
                              </span>
                            </div>
                          )}

                          {countdownBadge(evt.daysRemaining)}
                        </div>
                      </div>

                      {/* Middle: Live GL Estimated Liability */}
                      <div className="shrink-0 text-left lg:text-right">
                        <p className="text-[11px] font-medium text-ql-ink-muted">
                          {L('Estimated Liability', 'আনুমানিক প্রদেয় দায়')}
                        </p>
                        <p className="ql-mono text-sm font-bold text-ql-ink">
                          {formatPoisha(BigInt(evt.estimatedLiabilityPoisha), {
                            locale,
                            showSymbol: true,
                            grouping: 'LAKH_CRORE',
                          })}
                        </p>
                      </div>

                      {/* Right: Contextual One-Click Actions */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {evt.category === 'VAT_91' ? (
                          <Link
                            to="/app/reports?report=VAT_RETURN_DRAFT"
                            className="flex h-8 items-center gap-1.5 rounded-ql-control border border-ql-border px-2.5 text-[12px] font-medium text-ql-ink hover:bg-ql-surface-muted"
                          >
                            <FileCheck2 size={13} />
                            <span>{L('Open Mushak 9.1 Studio', 'মূসক ৯.১ স্টুডিও খুলুন')}</span>
                          </Link>
                        ) : null}

                        {evt.category === 'VDS_DEPOSIT' || evt.category === 'TDS_MONTHLY' ? (
                          <Link
                            to="/app/treasury"
                            className="flex h-8 items-center gap-1.5 rounded-ql-control border border-ql-border px-2.5 text-[12px] font-medium text-ql-ink hover:bg-ql-surface-muted"
                          >
                            <Building2 size={13} />
                            <span>{L('Assemble A-Challan', 'এ-চালান তৈরি করুন')}</span>
                          </Link>
                        ) : null}

                        {evt.category === 'TDS_177' ? (
                          <Link
                            to="/app/treasury"
                            className="flex h-8 items-center gap-1.5 rounded-ql-control border border-ql-border px-2.5 text-[12px] font-medium text-ql-ink hover:bg-ql-surface-muted"
                          >
                            <Scale size={13} />
                            <span>{L('Open Sec 177 Return', 'ধারা ১৭৭ রিটার্ন খুলুন')}</span>
                          </Link>
                        ) : null}

                        {evt.status === 'FILED' ? (
                          <div className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <CheckCircle2 size={12} />
                            <span className="font-semibold">ACK #{evt.filingReference}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openFilingModal(evt)}
                            className="flex h-8 items-center gap-1.5 rounded-ql-control bg-ql-brand px-3 text-[12px] font-medium text-white shadow-sm hover:opacity-90"
                          >
                            <Lock size={13} />
                            <span>{L('Record NBR ACK # & Lock Period', 'এনবিআর রিসিট নথিভুক্ত ও লক')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* ======================== VIEW 2: INTERACTIVE CALENDAR MATRIX ======================== */
        <div className="overflow-hidden rounded-ql border border-ql-border bg-ql-surface shadow-sm">
          {/* Matrix Header Navigation */}
          <div className="flex items-center justify-between border-b border-ql-border bg-ql-surface-muted/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-ql-ink">
                {L(matrixMonthLabelEn, matrixMonthLabelBn)}
              </h2>
              <span className="ql-badge ql-badge-neutral text-[11px]">
                {L('Friday & Saturday: Bangladesh Statutory Weekend', 'শুক্রবার ও শনিবার: সাপ্তাহিক সংবিধিবদ্ধ ছুটি')}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMatrixDate(new Date(Date.UTC(matrixYear, matrixMonth - 1, 1)))}
                className="grid h-8 w-8 place-items-center rounded-ql-control border border-ql-border bg-ql-surface text-ql-ink hover:bg-ql-surface-muted"
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setMatrixDate(new Date('2026-11-01T00:00:00Z'))}
                className="rounded-ql-control border border-ql-border bg-ql-surface px-2.5 py-1 text-[12px] font-medium text-ql-ink hover:bg-ql-surface-muted"
              >
                {L('Today', 'আজ')}
              </button>
              <button
                type="button"
                onClick={() => setMatrixDate(new Date(Date.UTC(matrixYear, matrixMonth + 1, 1)))}
                className="grid h-8 w-8 place-items-center rounded-ql-control border border-ql-border bg-ql-surface text-ql-ink hover:bg-ql-surface-muted"
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 border-b border-ql-border bg-ql-surface-muted/40 text-center text-[12px] font-bold text-ql-ink-muted">
            <div className="py-2">{L('Sun', 'রবি')}</div>
            <div className="py-2">{L('Mon', 'সোম')}</div>
            <div className="py-2">{L('Tue', 'মঙ্গল')}</div>
            <div className="py-2">{L('Wed', 'বুধ')}</div>
            <div className="py-2">{L('Thu', 'বৃহ')}</div>
            <div className="py-2 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              {L('Fri (Weekend)', 'শুক্র (সাপ্তাহিক ছুটি)')}
            </div>
            <div className="py-2 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              {L('Sat (Weekend)', 'শনি (সাপ্তাহিক ছুটি)')}
            </div>
          </div>

          {/* Matrix Cells */}
          <div className="grid grid-cols-7 divide-x divide-y divide-ql-border bg-ql-surface">
            {daysInMatrixMonth.map((cell) => {
              const isToday = cell.dateIso === new Date().toISOString().slice(0, 10);
              return (
                <div
                  key={cell.dateIso}
                  className={`min-h-[105px] p-1.5 transition-colors ${
                    cell.isCurrentMonth ? 'bg-ql-surface' : 'bg-ql-surface-muted/20 text-ql-ink-subtle'
                  } ${cell.isWeekend ? 'bg-amber-50/15 dark:bg-amber-950/10' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold ${
                        isToday
                          ? 'bg-ql-brand text-white font-bold'
                          : cell.isCurrentMonth
                            ? 'text-ql-ink'
                            : 'text-ql-ink-subtle'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {cell.holiday ? (
                      <span
                        className="truncate rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-800 dark:bg-rose-950/80 dark:text-rose-300"
                        title={L(cell.holiday.nameEn, cell.holiday.nameBn)}
                      >
                        {L(cell.holiday.nameEn, cell.holiday.nameBn).slice(0, 14)}…
                      </span>
                    ) : null}
                  </div>

                  {/* Obligations on this day */}
                  <div className="mt-1 space-y-1">
                    {cell.events.map((evt) => (
                      <button
                        key={evt.id}
                        type="button"
                        onClick={() => openFilingModal(evt)}
                        className={`w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium transition-all hover:scale-[1.02] ${
                          evt.status === 'FILED'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : evt.daysRemaining < 0
                              ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 font-bold'
                              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                        }`}
                        title={`${evt.titleEn} - Due ${evt.adjustedDeadline}`}
                      >
                        <span className="mr-1 font-bold">
                          {evt.category === 'VAT_91' ? '9.1' : evt.category === 'VDS_DEPOSIT' ? 'VDS' : 'TDS'}
                        </span>
                        <span>{evt.titleEn.split('(')[0]?.trim()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. NBR Acknowledgement & Period Lock Modal */}
      {filingModalEvent ? (
        <Dialog
          open={Boolean(filingModalEvent)}
          onClose={() => setFilingModalEvent(null)}
          title={L('Record Statutory Filing & Acknowledgement', 'সংবিধিবদ্ধ দাখিল ও প্রাপ্তি স্বীকার নথিভুক্ত করুন')}
          description={L(
            'Record the NBR / RJSC receipt ACK number and optionally lock the accounting period to preserve audit integrity.',
            'এনবিআর বা আরজেএসসি প্রাপ্তি স্বীকার নম্বর লিখুন এবং অডিট সুরক্ষায় হিসাবকাল লক করুন।',
          )}
        >
          <div className="space-y-4 pt-2">
            {/* Obligation Summary Banner */}
            <div className="rounded-ql border border-ql-border bg-ql-surface-muted/50 p-3 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ql-ink">{filingModalEvent.titleEn}</span>
                <span className="ql-badge ql-badge-brand text-[10px]">{filingModalEvent.category}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-ql-ink-muted">
                <div>
                  <span>{L('Adjusted Deadline:', 'সমন্বিত সময়সীমা:')}</span>{' '}
                  <strong className="text-ql-ink">{filingModalEvent.adjustedDeadline}</strong>
                </div>
                <div>
                  <span>{L('Estimated Liability:', 'আনুমানিক দায়:')}</span>{' '}
                  <strong className="ql-mono text-ql-ink">
                    {formatPoisha(BigInt(filingModalEvent.estimatedLiabilityPoisha), {
                      locale,
                      showSymbol: true,
                      grouping: 'LAKH_CRORE',
                    })}
                  </strong>
                </div>
              </div>
              {filingModalEvent.shiftCallout ? (
                <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  {filingModalEvent.shiftCallout}
                </p>
              ) : null}
            </div>

            {/* Input: NBR ACK Number */}
            <div className="space-y-1">
              <label className="block text-[12px] font-semibold text-ql-ink">
                {L('NBR Acknowledgement / Filing Reference *', 'এনবিআর প্রাপ্তি স্বীকার / দাখিল রেফারেন্স নম্বর *')}
              </label>
              <input
                type="text"
                value={filingAckRef}
                onChange={(e) => setFilingAckRef(e.target.value)}
                placeholder="e.g. NBR-ACK-2026-11-0984"
                className="h-9 w-full rounded-ql-control border border-ql-border bg-ql-surface px-3 text-[13px] text-ql-ink focus:border-ql-brand focus:outline-none"
                autoFocus
              />
            </div>

            {/* Checkbox: Lock Accounting Period */}
            {filingModalEvent.periodId ? (
              <label className="flex items-start gap-2.5 rounded border border-ql-border p-3 text-[12px] text-ql-ink hover:bg-ql-surface-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filingLockPeriod}
                  onChange={(e) => setFilingLockPeriod(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ql-border text-ql-brand focus:ring-ql-brand"
                />
                <div>
                  <span className="font-semibold text-ql-ink">
                    {L('Lock accounting period upon filing confirmation', 'দাখিল সাপেক্ষে হিসাবকাল লক করুন')}
                  </span>
                  <p className="text-[11px] text-ql-ink-muted">
                    {L(
                      'Enforces immutability: closes the period to prevent retroactive changes under VAT Act Section 64.',
                      'ভ্যাট আইনের ৬৪ ধারা অনুযায়ী পূর্ববর্তী পরিবর্তন রোধে হিসাবকাল লক করা হবে।',
                    )}
                  </p>
                </div>
              </label>
            ) : null}

            {/* Input: Remarks / Notes */}
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-ql-ink-muted">
                {L('Notes / Remarks (Optional)', 'মন্তব্য (ঐচ্ছিক)')}
              </label>
              <textarea
                value={filingNotes}
                onChange={(e) => setFilingNotes(e.target.value)}
                placeholder={L('Any filing notes or treasury deposit details…', 'দাখিল বা ট্রেজারি চালান সংক্রান্ত বিবরণ…')}
                rows={2}
                className="w-full rounded-ql-control border border-ql-border bg-ql-surface p-2.5 text-[12px] text-ql-ink focus:border-ql-brand focus:outline-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-ql-border pt-3">
              <button
                type="button"
                onClick={() => setFilingModalEvent(null)}
                className="h-9 rounded-ql-control border border-ql-border px-3 text-[13px] font-medium text-ql-ink hover:bg-ql-surface-muted"
              >
                {L('Cancel', 'বাতিল')}
              </button>
              <button
                type="button"
                onClick={handleConfirmFiling}
                disabled={filingSubmitting || !filingAckRef.trim()}
                className="flex h-9 items-center gap-1.5 rounded-ql-control bg-ql-brand px-4 text-[13px] font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {filingSubmitting ? <RefreshCw size={13} className="animate-spin" /> : <Lock size={13} />}
                <span>{L('Confirm & Lock', 'নিশ্চিত ও লক করুন')}</span>
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
