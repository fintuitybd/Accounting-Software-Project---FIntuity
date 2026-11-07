import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarClock, ChevronLeft, ChevronRight, FilePlus2, Landmark, Scale } from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import type { ServerPermission } from '../../auth/types';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type FiscalPeriod, type SetupAccount } from '../../setup/api';
import { masterApi } from '../../masters/api';
import { ledgerApi, type JournalDetail as JournalDetailType, type JournalSummary } from '../../ledger/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { JournalComposer } from './JournalComposer';
import { JournalDetail } from './JournalDetail';
import { TrialBalancePanel } from './TrialBalancePanel';
import { PeriodsPanel } from './PeriodsPanel';
import { OpeningBalancesPanel } from './OpeningBalancesPanel';
import { formatDate, PoishaText, StatusChip } from './ledgerUi';

type TabKey = 'JOURNALS' | 'NEW' | 'TRIAL_BALANCE' | 'PERIODS' | 'OPENING';
const TAB_KEYS: readonly TabKey[] = ['JOURNALS', 'NEW', 'TRIAL_BALANCE', 'PERIODS', 'OPENING'];

function tabFromQuery(value: string | null): TabKey | null {
  return value && (TAB_KEYS as readonly string[]).includes(value) ? (value as TabKey) : null;
}

const TAB_META: Array<{ key: TabKey; en: string; bn: string; icon: typeof BookOpen; permission?: ServerPermission }> = [
  { key: 'JOURNALS', en: 'Journals', bn: 'জার্নাল', icon: BookOpen, permission: 'VIEW_REPORTS' },
  { key: 'NEW', en: 'New journal', bn: 'নতুন জার্নাল', icon: FilePlus2, permission: 'POST_TO_GL' },
  { key: 'TRIAL_BALANCE', en: 'Trial balance', bn: 'রেওয়ামিল', icon: Scale, permission: 'VIEW_REPORTS' },
  { key: 'PERIODS', en: 'Periods', bn: 'হিসাবকাল', icon: CalendarClock },
  { key: 'OPENING', en: 'Opening balances', bn: 'উদ্বোধনী ব্যালেন্স', icon: Landmark },
];

function sourceText(source: string): string {
  return source
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function JournalListPanel({
  companyId,
  refreshToken,
  canCreate,
  onOpen,
  onNew,
}: {
  companyId: string;
  refreshToken: number;
  canCreate: boolean;
  onOpen: (journalId: string) => void;
  onNew: () => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [entries, setEntries] = useState<JournalSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ledgerApi.journals(companyId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(status ? { status: status as JournalSummary['status'] } : {}),
        limit,
        offset,
      });
      setEntries(response.entries);
      setTotal(response.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, from, offset, status, to]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <section className="ql-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{L('General journal', 'সাধারণ জার্নাল')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {L('Journal listing', 'জার্নাল তালিকা')}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Every journal is shown with its source, actor, status and reversal link. Posted journals are read-only.',
              'প্রতিটি জার্নাল তার উৎস, সম্পাদক, স্ট্যাটাস ও রিভার্সাল লিংকসহ দেখানো হয়। পোস্ট করা জার্নাল শুধু পাঠযোগ্য।',
            )}
          </p>
        </div>
        {canCreate ? (
          <button type="button" onClick={onNew} className="ql-btn ql-btn-primary min-h-11 text-[13px]">
            <FilePlus2 size={15} /> {L('New journal', 'নতুন জার্নাল')}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('Status', 'স্ট্যাটাস')}
          <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="ql-select mt-1 min-h-11 w-full text-[13px]">
            <option value="">{L('All statuses', 'সব স্ট্যাটাস')}</option>
            <option value="DRAFT">{L('Draft', 'খসড়া')}</option>
            <option value="SUBMITTED">{L('Submitted', 'জমা দেওয়া')}</option>
            <option value="APPROVED">{L('Approved', 'অনুমোদিত')}</option>
            <option value="POSTED">{L('Posted', 'পোস্টেড')}</option>
            <option value="REVERSED">{L('Reversed', 'বাতিল')}</option>
          </select>
        </label>
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('From', 'থেকে')}
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} className={`${INPUT_CLASS} mt-1`} />
        </label>
        <label className="block text-[12px] font-semibold text-ink-600">
          {L('To', 'পর্যন্ত')}
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setOffset(0); }} className={`${INPUT_CLASS} mt-1`} />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => void load()} disabled={loading} className="ql-btn ql-btn-secondary min-h-11 w-full text-[13px]">
            {loading ? L('Loading…', 'লোড হচ্ছে…') : L('Apply filters', 'ফিল্টার প্রয়োগ')}
          </button>
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="ql-table w-full min-w-[900px] text-[13px]">
          <caption className="sr-only">{L('Journal entries', 'জার্নাল এন্ট্রি')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{L('Number', 'নম্বর')}</th>
              <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
              <th scope="col" className="text-left">{L('Narration', 'বিবরণ')}</th>
              <th scope="col" className="text-left">{L('Source', 'উৎস')}</th>
              <th scope="col" className="text-left">{L('Status', 'স্ট্যাটাস')}</th>
              <th scope="col" className="text-right">{L('Debit', 'ডেবিট')}</th>
              <th scope="col" className="text-right">{L('Credit', 'ক্রেডিট')}</th>
              <th scope="col" className="text-left">{L('Created by', 'তৈরি করেছেন')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-ink-500">
                  {loading ? L('Loading journals…', 'জার্নাল লোড হচ্ছে…') : L('No journals match these filters.', 'এই ফিল্টারে কোনো জার্নাল নেই।')}
                </td>
              </tr>
            ) : (
              entries.map((journal) => (
                <tr key={journal.id}>
                  <td>
                    <button type="button" onClick={() => onOpen(journal.id)} className="font-mono font-semibold text-brand-bright hover:underline">
                      {journal.journalNumber ?? L('Draft', 'খসড়া')}
                    </button>
                    {journal.reversalJournalNumber ? <span className="ml-1 text-[12px] text-rose-600">→ {journal.reversalJournalNumber}</span> : null}
                  </td>
                  <td>{formatDate(journal.postingDate, locale)}</td>
                  <td className="max-w-[280px]">
                    <button type="button" onClick={() => onOpen(journal.id)} className="truncate text-left text-ink-900 hover:text-brand-bright hover:underline">
                      {journal.narrationEn}
                    </button>
                    {journal.sourceDocRef ? <span className="ml-1 text-[12px] text-ink-400">{journal.sourceDocRef}</span> : null}
                  </td>
                  <td className="text-ink-500">{sourceText(journal.sourceModule)}</td>
                  <td><StatusChip status={journal.status} /></td>
                  <td className="text-right"><PoishaText value={journal.totalDebitPoisha} /></td>
                  <td className="text-right"><PoishaText value={journal.totalCreditPoisha} /></td>
                  <td className="text-ink-500">{journal.createdByName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-500">
        <span>
          {L('Showing', 'দেখানো হচ্ছে')} {entries.length === 0 ? 0 : offset + 1}–{offset + entries.length} {L('of', 'এর মধ্যে')} {total}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOffset((value) => Math.max(0, value - limit))} disabled={offset === 0 || loading} className="ql-btn ql-btn-ghost min-h-9 text-[12px]">
            <ChevronLeft size={13} /> {L('Previous', 'পূর্ববর্তী')}
          </button>
          <button type="button" onClick={() => setOffset((value) => value + limit)} disabled={offset + entries.length >= total || loading} className="ql-btn ql-btn-ghost min-h-9 text-[12px]">
            {L('Next', 'পরবর্তী')} <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

export default function LedgerPage() {
  const auth = useAuth();
  const vault = usePreferences();
  const { locale } = vault;
  const L = useCallback((en: string, bn: string): string => localized(locale, en, bn), [locale]);
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const [searchParams] = useSearchParams();
  const requestedTab = tabFromQuery(searchParams.get('tab'));
  const requestedJournal = searchParams.get('journal');
  const [tab, setTab] = useState<TabKey>(requestedTab ?? 'JOURNALS');
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; code: string; nameEn: string }>>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedJournal, setSelectedJournal] = useState<JournalDetailType | null>(null);
  const [editingJournal, setEditingJournal] = useState<JournalDetailType | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedTab) return;
    setTab(requestedTab);
    setSelectedJournalId(null);
    setEditingJournal(null);
  }, [requestedTab]);

  useEffect(() => {
    if (!requestedJournal) return;
    setSelectedJournalId(requestedJournal);
    setTab('JOURNALS');
  }, [requestedJournal]);

  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');
  const canReverse = auth.hasCompanyPermission('REVERSE_POSTED_JOURNAL');
  const canManagePeriods = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');

  const loadReferences = useCallback(async () => {
    if (!companyId) return;
    setReferenceError(null);
    try {
      const [accountResponse, periodResponse, branchResponse] = await Promise.all([
        setupApi.accounts(companyId),
        setupApi.periods(companyId),
        masterApi.branches(companyId, false),
      ]);
      setAccounts(accountResponse.accounts);
      setPeriods(periodResponse.periods);
      setBranches(branchResponse.branches.map((branch) => ({ id: branch.id, code: branch.code, nameEn: branch.nameEn })));
    } catch (caught) {
      setReferenceError(apiErrorMessage(caught));
    }
  }, [companyId]);

  useEffect(() => {
    void loadReferences();
  }, [loadReferences]);

  useEffect(() => {
    if (!companyId || !selectedJournalId) {
      setSelectedJournal(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    ledgerApi
      .journal(companyId, selectedJournalId)
      .then((response) => {
        if (!cancelled) setSelectedJournal(response.journal);
      })
      .catch((caught) => {
        if (!cancelled) setDetailError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, selectedJournalId, refreshToken]);

  const notify = useCallback(
    (message: string, tone: 'success' | 'warning' | 'error' = 'success') => {
      vault.publishToast({
        tone,
        title: tone === 'success' ? L('Ledger updated', 'লেজার হালনাগাদ') : L('Ledger action', 'লেজার কার্যক্রম'),
        message,
      });
    },
    [L, vault],
  );

  const refresh = useCallback(
    async (message?: string) => {
      setRefreshToken((value) => value + 1);
      if (message) notify(message);
    },
    [notify],
  );

  const openJournal = useCallback((journalId: string) => {
    setSelectedJournalId(journalId);
    setTab('JOURNALS');
  }, []);

  const visibleTabs = useMemo(
    () => TAB_META.filter((meta) => !meta.permission || auth.hasCompanyPermission(meta.permission)),
    [auth],
  );

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((meta) => meta.key === tab)) {
      setTab(visibleTabs[0]!.key);
      setSelectedJournalId(null);
      setEditingJournal(null);
    }
  }, [tab, visibleTabs]);

  if (!company) {
    return (
      <section className="ql-card p-6">
        <h1 className="text-[22px] font-semibold text-ink-900">{L('No company selected', 'কোনো কোম্পানি নির্বাচিত নয়')}</h1>
        <p className="mt-2 text-[14px] text-ink-500">
          {L('Choose a company before opening the ledger.', 'লেজার খোলার আগে একটি কোম্পানি নির্বাচন করুন।')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Server-authoritative ledger', 'সার্ভার-ভিত্তিক লেজার')}
        title={L('General ledger', 'সাধারণ লেজার')}
        description={L(
          'Journals, reversals, opening balances and the trial balance are stored in PostgreSQL. Posted records are immutable and every action is audited.',
          'জার্নাল, রিভার্সাল, উদ্বোধনী ব্যালেন্স ও রেওয়ামিল PostgreSQL-এ সংরক্ষিত। পোস্ট করা রেকর্ড অপরিবর্তনীয় এবং প্রতিটি কার্যক্রম অডিট করা হয়।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand">{company.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{company.role}</span>
            {!canPost ? <span className="ql-badge ql-badge-warning">{L('Read-only', 'শুধু পাঠযোগ্য')}</span> : null}
          </>
        }
      />

      {referenceError ? <ErrorBanner message={referenceError} /> : null}
      {periods.length === 0 ? (
        <Notice
          message={L(
            'No accounting periods are configured. Create a fiscal year in company setup before posting.',
            'কোনো হিসাবকাল নির্ধারিত নেই। পোস্ট করার আগে কোম্পানি সেটআপে অর্থবছর তৈরি করুন।',
          )}
          tone="warning"
        />
      ) : null}

      <div role="tablist" aria-label={L('Ledger sections', 'লেজার বিভাগ')} className="flex flex-wrap gap-1.5">
        {visibleTabs.map((meta) => {
          const Icon = meta.icon;
          const active = tab === meta.key;
          return (
            <button
              key={meta.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(meta.key);
                if (meta.key !== 'NEW') setEditingJournal(null);
                if (meta.key === 'JOURNALS') setSelectedJournalId(null);
              }}
              className={`ql-btn min-h-10 text-[13px] ${active ? 'ql-btn-primary' : 'ql-btn-secondary'}`}
            >
              <Icon size={14} /> {L(meta.en, meta.bn)}
            </button>
          );
        })}
      </div>

      {tab === 'JOURNALS' ? (
        selectedJournalId ? (
          detailLoading ? (
            <Notice message={L('Loading journal…', 'জার্নাল লোড হচ্ছে…')} />
          ) : detailError ? (
            <ErrorBanner message={detailError} />
          ) : selectedJournal ? (
            <JournalDetail
              companyId={companyId}
              journal={selectedJournal}
              periods={periods}
              canPost={canPost}
              canApprove={canApprove}
              canReverse={canReverse}
              onUpdated={(message) => refresh(message)}
              onEdit={() => {
                setEditingJournal(selectedJournal);
                setSelectedJournalId(null);
                setTab('NEW');
              }}
              onBack={() => setSelectedJournalId(null)}
              onOpenJournal={openJournal}
            />
          ) : null
        ) : (
          <JournalListPanel
            companyId={companyId}
            refreshToken={refreshToken}
            canCreate={canPost}
            onOpen={openJournal}
            onNew={() => {
              setEditingJournal(null);
              setTab('NEW');
            }}
          />
        )
      ) : null}

      {tab === 'NEW' ? (
        <JournalComposer
          key={editingJournal?.id ?? 'new'}
          companyId={companyId}
          accounts={accounts}
          periods={periods}
          branches={branches}
          initial={editingJournal}
          canPost={canPost}
          onSaved={(journal, message) => {
            setEditingJournal(null);
            setSelectedJournalId(journal.id);
            setTab('JOURNALS');
            notify(message);
          }}
          onCancel={() => {
            setEditingJournal(null);
            setTab('JOURNALS');
          }}
        />
      ) : null}

      {tab === 'TRIAL_BALANCE' ? (
        <TrialBalancePanel
          companyId={companyId}
          periods={periods}
          refreshToken={refreshToken}
          onOpenJournal={openJournal}
        />
      ) : null}

      {tab === 'PERIODS' ? (
        <PeriodsPanel
          companyId={companyId}
          periods={periods}
          canManage={canManagePeriods}
          onChanged={async (message) => {
            await loadReferences();
            await refresh(message);
          }}
        />
      ) : null}

      {tab === 'OPENING' ? (
        <OpeningBalancesPanel
          companyId={companyId}
          canSubmit={canPost}
          canApprove={canApprove}
          canPost={canPost}
          refreshToken={refreshToken}
          onChanged={(message) => refresh(message)}
          onOpenJournal={openJournal}
        />
      ) : null}
    </div>
  );
}
