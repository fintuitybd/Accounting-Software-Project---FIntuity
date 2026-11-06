import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  FileCheck2,
  FileClock,
  Landmark,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/AppPreferences';
import { setupApi, type BankAccount } from '../../setup/api';
import { masterApi, type Party } from '../../masters/api';
import type {
  TreasuryCertificate,
  TreasuryCertificateStatus,
  TreasuryChallan,
  TreasuryLiability,
  TreasuryLiabilityStatus,
  TreasuryProof,
  TreasuryTaxType,
} from '../../treasury/api';
import { treasuryApi } from '../../treasury/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { EmptyState, ProofRow, SectionCard, formatDate, newKey, oneYearAgoIso, ratePercent, todayIso } from '../purchases/purchasesUi';

type TabKey = 'PENDING' | 'CHALLANS' | 'CERTIFICATES' | 'PROOF';

function statusChip(status: string) {
  if (status === 'PENDING' || status === 'DRAFT') return <span className="lv-chip lv-chip-gold">{status}</span>;
  if (status === 'DEPOSITED' || status === 'POSTED') return <span className="lv-chip lv-chip-emerald">{status}</span>;
  return <span className="lv-chip lv-chip-rose">{status}</span>;
}

function taxLabel(taxType: TreasuryTaxType | string): string {
  if (taxType === 'REVERSE_CHARGE') return 'Reverse-charge VAT';
  return taxType;
}

export default function TreasuryPage() {
  const auth = useAuth();
  const { locale } = usePreferences();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [tab, setTab] = useState<TabKey>('PENDING');
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canReverse = auth.hasCompanyPermission('REVERSE_POSTED_JOURNAL');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');
  const canView = auth.hasCompanyPermission('VIEW_REPORTS');

  const loadBanks = useCallback(async () => {
    if (!companyId) return;
    try {
      const response = await setupApi.bankAccounts(companyId);
      setBanks(response.bankAccounts.filter((bank) => bank.status === 'ACTIVE'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId]);

  useEffect(() => {
    void loadBanks();
  }, [loadBanks]);

  const tabs: Array<{ key: TabKey; en: string; bn: string; icon: typeof Landmark }> = [
    { key: 'PENDING', en: 'Pending liabilities', bn: 'অপেক্ষমাণ দায়', icon: FileClock },
    { key: 'CHALLANS', en: 'Deposit register', bn: 'জমা রেজিস্টার', icon: Landmark },
    { key: 'CERTIFICATES', en: 'Certificates', bn: 'প্রত্যয়নপত্র', icon: FileCheck2 },
    { key: 'PROOF', en: 'Reconciliation', bn: 'মিলকরণ', icon: ShieldCheck },
  ];

  if (!companyId) {
    return (
      <section className="lv-card mx-auto mt-6 max-w-3xl p-6">
        <h2 className="text-[22px] font-semibold text-ink-900">{L('No company selected', 'কোনো কোম্পানি নির্বাচিত নেই')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L('Choose a company before working with treasury challans.', 'ট্রেজারি চালানের কাজ করার আগে একটি কোম্পানি নির্বাচন করুন।')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Treasury and withholding', 'ট্রেজারি ও উৎসে কর')}
        title={L('Challans, deposits and certificates', 'চালান, জমা ও প্রত্যয়নপত্র')}
        description={L(
          'Deposit only real VDS/TDS/reverse-charge liabilities created by posted supplier payments or bills. A deposit is one atomic journal and is marked against the selected liabilities. Certificates are derived from the deposited liability and remain draft until the statutory format is professionally verified.',
          'পোস্টকৃত সরবরাহকারী পরিশোধ বা বিল থেকে সৃষ্ট বাস্তব ভিডিএস/টিডিএস/রিভার্স-চার্জ দায়ই জমা দিন। প্রতিটি জমা একটি অ্যাটমিক জার্নাল এবং নির্বাচিত দায়ের বিপরীতে চিহ্নিত হয়। সনদ জমাকৃত দায় থেকে তৈরি হয় এবং পরিসংখ্যানগত ফরম্যাট পেশাদারভাবে যাচাই না হওয়া পর্যন্ত খসড়া থাকে।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-warning"><AlertTriangle size={13} aria-hidden /> {L('Certificates are DRAFT', 'সনদ খসড়া')}</span>
            <span className="ql-badge ql-badge-neutral"><ShieldCheck size={13} aria-hidden /> {L('No filing claim', 'ফাইলিংয়ের দাবি নেই')}</span>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}
      <Notice
        message={L(
          'Treasury outputs are internal records. This screen does not file a return, does not print a government receipt and does not issue a final statutory certificate. The tax pack remains PENDING_TAX_COUNSEL until a named reviewer approves it.',
          'ট্রেজারি আউটপুট অভ্যন্তরীণ রেকর্ড। এই স্ক্রিন কোনো রিটার্ন দাখিল করে না, সরকারি রসিদ প্রিন্ট করে না এবং চূড়ান্ত statutory সনদ ইস্যু করে না। নামযুক্ত পর্যালোচক অনুমোদন না করা পর্যন্ত ট্যাক্স প্যাক PENDING_TAX_COUNSEL থাকে।',
        )}
        tone="warning"
      />

      {/* 3-Step Visual Statutory Pipeline */}
      <div className="ql-card p-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div
            onClick={() => setTab('PENDING')}
            className={`flex-1 flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
              tab === 'PENDING'
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                : 'border-ql-border bg-surface-1 hover:bg-surface-2'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${
              tab === 'PENDING' ? 'bg-brand-500 text-white' : 'bg-surface-3 text-ink-600'
            }`}>
              1
            </div>
            <div>
              <p className="text-[13px] font-bold text-ink-900">1. Unremitted VDS/TDS Queue</p>
              <p className="text-[11px] text-ink-500">Matured from bills &amp; partial payments</p>
            </div>
          </div>

          <span className="hidden sm:block text-ink-300 font-bold">→</span>

          <div
            onClick={() => setTab('PENDING')}
            className={`flex-1 flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
              tab === 'PENDING'
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                : 'border-ql-border bg-surface-1 hover:bg-surface-2'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${
              tab === 'PENDING' ? 'bg-brand-500 text-white' : 'bg-surface-3 text-ink-600'
            }`}>
              2
            </div>
            <div>
              <p className="text-[13px] font-bold text-ink-900">2. Batch A-Challan Assembly</p>
              <p className="text-[11px] text-ink-500">Code 1/1141/0010/0311 deposit</p>
            </div>
          </div>

          <span className="hidden sm:block text-ink-300 font-bold">→</span>

          <div
            onClick={() => setTab('CERTIFICATES')}
            className={`flex-1 flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
              tab === 'CERTIFICATES' || tab === 'CHALLANS'
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                : 'border-ql-border bg-surface-1 hover:bg-surface-2'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold ${
              tab === 'CERTIFICATES' || tab === 'CHALLANS' ? 'bg-brand-500 text-white' : 'bg-surface-3 text-ink-600'
            }`}>
              3
            </div>
            <div>
              <p className="text-[13px] font-bold text-ink-900">3. Issued Mushak 6.6 &amp; Register</p>
              <p className="text-[11px] text-ink-500">Gapless sequence (6.6/2026-27/xxxxx)</p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label={L('Treasury sections', 'ট্রেজারি বিভাগসমূহ')}>
        {tabs.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setTab(entry.key);
                setError(null);
                setNotice(null);
              }}
              aria-current={tab === entry.key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition ${
                tab === entry.key
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-line bg-surface/70 text-ink-600 hover:border-brand/30 hover:text-ink-900'
              }`}
            >
              <Icon size={15} />
              {L(entry.en, entry.bn)}
            </button>
          );
        })}
      </nav>

      {tab === 'PENDING' ? (
        <PendingChallansPanel
          companyId={companyId}
          banks={banks}
          canPost={canPost}
          canView={canView}
          onBusy={setBusy}
          busy={busy}
          onError={setError}
          onNotice={setNotice}
          onDeposited={(challan) => {
            setTab('CHALLANS');
            setNotice(`Treasury challan ${challan.challanNumber} posted. ${challan.items.length} liabilities marked DEPOSITED.`);
          }}
        />
      ) : null}
      {tab === 'CHALLANS' ? (
        <ChallansPanel
          companyId={companyId}
          canReverse={canReverse}
          onBusy={setBusy}
          busy={busy}
          onError={setError}
          onNotice={setNotice}
        />
      ) : null}
      {tab === 'CERTIFICATES' ? (
        <CertificatesPanel
          companyId={companyId}
          canApprove={canApprove}
          onBusy={setBusy}
          busy={busy}
          onError={setError}
          onNotice={setNotice}
        />
      ) : null}
      {tab === 'PROOF' ? (
        <ProofPanel companyId={companyId} canView={canView} onError={setError} />
      ) : null}
    </div>
  );
}

function PendingChallansPanel({
  companyId,
  banks,
  canPost,
  canView,
  busy,
  onBusy,
  onError,
  onNotice,
  onDeposited,
}: {
  companyId: string;
  banks: BankAccount[];
  canPost: boolean;
  canView: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string | null) => void;
  onNotice: (value: string | null) => void;
  onDeposited: (challan: TreasuryChallan) => void;
}) {
  const [entries, setEntries] = useState<TreasuryLiability[]>([]);
  const [status, setStatus] = useState<TreasuryLiabilityStatus | ''>('PENDING');
  const [taxType, setTaxType] = useState<TreasuryTaxType | ''>('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [depositDate, setDepositDate] = useState(todayIso());
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [depositReference, setDepositReference] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    onError(null);
    try {
      const response = await treasuryApi.liabilities(companyId, {
        ...(status ? { status } : {}),
        ...(taxType ? { taxType } : {}),
        limit: 500,
      });
      setEntries(response.entries);
      setCodes((current) => {
        const next = { ...current };
        for (const entry of response.entries) {
          if (!next[entry.id]) next[entry.id] = entry.economicCode ?? '';
        }
        return next;
      });
      setSelectedIds((current) => current.filter((id) => response.entries.some((entry) => entry.id === id)));
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, status, taxType, onError]);

  useEffect(() => {
    if (canView) void load();
  }, [load, canView]);

  useEffect(() => {
    if (!bankAccountId && banks[0]) setBankAccountId(banks[0].id);
  }, [banks, bankAccountId]);

  const selected = useMemo(
    () => entries.filter((entry) => selectedIds.includes(entry.id) && entry.status === 'PENDING'),
    [entries, selectedIds],
  );
  const total = selected.reduce((sum, entry) => sum + BigInt(entry.amountPoisha), 0n);

  const toggle = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const deposit = async () => {
    onError(null);
    onNotice(null);
    if (selected.length === 0) {
      onError('Select at least one pending liability.');
      return;
    }
    const missing = selected.find((entry) => !(codes[entry.id] ?? '').trim());
    if (missing) {
      onError(`Enter a Treasury economic code for ${missing.partyNameEn} (${taxLabel(missing.taxType)}).`);
      return;
    }
    if (!bankAccountId || !bankBranch.trim() || !depositReference.trim() || !evidenceReference.trim()) {
      onError('Choose a bank account and enter the branch, deposit reference and evidence reference.');
      return;
    }
    onBusy(true);
    try {
      const response = await treasuryApi.postChallan(
        companyId,
        {
          depositDate,
          bankAccountId,
          bankBranch: bankBranch.trim(),
          depositReference: depositReference.trim(),
          evidenceReference: evidenceReference.trim(),
          items: selected.map((entry) => ({
            liabilityId: entry.id,
            economicCode: (codes[entry.id] ?? '').trim(),
          })),
        },
        newKey('treasury-challan'),
      );
      setSelectedIds([]);
      setDepositReference('');
      setEvidenceReference('');
      await load();
      onDeposited(response.challan);
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      onBusy(false);
    }
  };

  if (!canView) {
    return <Notice message="You do not have permission to view the treasury liability register." tone="warning" />;
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Pending withholding liabilities"
        kicker="Created from posted supplier payments and reverse-charge bills"
        action={
          <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Status</span>
            <select className={INPUT_CLASS} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="DEPOSITED">Deposited</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Tax type</span>
            <select className={INPUT_CLASS} value={taxType} onChange={(event) => setTaxType(event.target.value as typeof taxType)}>
              <option value="">All</option>
              <option value="VDS">VDS</option>
              <option value="TDS">TDS</option>
              <option value="REVERSE_CHARGE">Reverse-charge VAT</option>
            </select>
          </label>
          <div className="flex items-end">
            <p className="text-[12px] text-ink-500">
              {loading ? 'Loading…' : `${entries.length} liabilities in this view.`}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {entries.length === 0 ? (
            <EmptyState
              title="No withholding liabilities"
              hint="Post a supplier payment with VDS/TDS or a reverse-charge bill. This queue never creates a liability from a preview."
            />
          ) : (
            <table className="w-full min-w-[1180px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Select</th>
                  <th className="px-2 py-2">Tax</th>
                  <th className="px-2 py-2">Period</th>
                  <th className="px-2 py-2">Party</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2 text-right">Base</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Economic code</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const selectable = entry.status === 'PENDING';
                  return (
                    <tr key={entry.id} className="border-t border-line/70">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-brand"
                          aria-label={`Select ${taxLabel(entry.taxType)} liability for ${entry.partyNameEn}`}
                          checked={selectedIds.includes(entry.id)}
                          disabled={!selectable || !canPost}
                          onChange={() => toggle(entry.id)}
                        />
                      </td>
                      <td className="px-2 py-2 font-semibold text-ink-900">{taxLabel(entry.taxType)}</td>
                      <td className="px-2 py-2 text-ink-600">{entry.taxPeriod}</td>
                      <td className="px-2 py-2 text-ink-700">
                        {entry.partyNameEn}
                        <span className="block text-[12px] text-ink-400">{entry.partyCode}</span>
                      </td>
                      <td className="px-2 py-2 text-ink-600">
                        {entry.paymentNumber ?? entry.billNo ?? '—'}
                        {entry.supplierInvoiceNo ? <span className="block text-[12px] text-ink-400">{entry.supplierInvoiceNo}</span> : null}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{entry.baseBdt}</td>
                      <td className="px-2 py-2 text-right font-mono">{ratePercent(entry.rateBps)}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold">{entry.amountBdt}</td>
                      <td className="px-2 py-2">
                        <input
                          className="lv-input min-h-9 w-[150px] text-[13px]"
                          value={codes[entry.id] ?? ''}
                          maxLength={32}
                          disabled={!selectable || !canPost}
                          onChange={(event) => setCodes((current) => ({ ...current, [entry.id]: event.target.value }))}
                          aria-label={`Economic code for ${taxLabel(entry.taxType)} liability ${entry.id}`}
                          placeholder="Required"
                        />
                      </td>
                      <td className="px-2 py-2">{statusChip(entry.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      {canPost ? (
        <SectionCard title="Create one treasury challan" kicker="Select liabilities, then deposit them in one balanced journal">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Deposit date</span>
              <input type="date" className={INPUT_CLASS} value={depositDate} onChange={(event) => setDepositDate(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Bank or cash account</span>
              <select className={INPUT_CLASS} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
                <option value="">Choose account</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.name} · {bank.kind}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Bank branch</span>
              <input className={INPUT_CLASS} value={bankBranch} maxLength={200} onChange={(event) => setBankBranch(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Deposit reference</span>
              <input className={INPUT_CLASS} value={depositReference} maxLength={200} onChange={(event) => setDepositReference(event.target.value)} placeholder="Bank slip / challan reference" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Evidence reference</span>
              <input className={INPUT_CLASS} value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Evidence file / acknowledgement reference" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-ink-600">
              {selected.length} selected · total <span className="font-mono font-semibold">{formatPoisha(total)} BDT</span>
            </p>
            <button type="button" className="lv-btn lv-btn-primary min-h-11 text-[13px]" disabled={busy || selected.length === 0} onClick={() => void deposit()}>
              <Banknote size={15} /> {busy ? 'Posting…' : 'Post treasury challan'}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
            The server locks the selected liabilities, posts Dr liability / Cr bank, marks them DEPOSITED and creates draft VDS/TDS certificates in the same transaction. A second deposit of the same liability is rejected.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

function ChallansPanel({
  companyId,
  canReverse,
  busy,
  onBusy,
  onError,
  onNotice,
}: {
  companyId: string;
  canReverse: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string | null) => void;
  onNotice: (value: string | null) => void;
}) {
  const [entries, setEntries] = useState<TreasuryChallan[]>([]);
  const [status, setStatus] = useState<'POSTED' | 'REVERSED' | ''>('');
  const [from, setFrom] = useState(oneYearAgoIso);
  const [to, setTo] = useState(todayIso());
  const [selected, setSelected] = useState<TreasuryChallan | null>(null);
  const [loading, setLoading] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseDate, setReverseDate] = useState(todayIso());
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const response = await treasuryApi.challans(companyId, {
        ...(status ? { status } : {}),
        from,
        to,
        limit: 100,
      });
      setEntries(response.entries);
      setSelected((current) => response.entries.find((entry) => entry.id === current?.id) ?? null);
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, status, from, to, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const reverse = async () => {
    if (!selected) return;
    onBusy(true);
    onError(null);
    onNotice(null);
    try {
      const response = await treasuryApi.reverseChallan(companyId, selected.id, reverseDate, reverseReason);
      setSelected(response.challan);
      setReverseOpen(false);
      setReverseReason('');
      await load();
      onNotice('Treasury challan reversed. Liabilities returned to PENDING and its draft certificates were cancelled.');
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Treasury deposit register"
        kicker="Persisted challans, bank evidence and linked liabilities"
        action={
          <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Status</span>
            <select className={INPUT_CLASS} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="">All</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">From</span>
            <input type="date" className={INPUT_CLASS} value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">To</span>
            <input type="date" className={INPUT_CLASS} value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <div className="flex items-end">
            <p className="text-[12px] text-ink-500">{loading ? 'Loading…' : `${entries.length} challans`}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {entries.length === 0 ? (
            <EmptyState title="No treasury challans" hint="A posted deposit appears here with its journal, bank evidence and linked liabilities." />
          ) : (
            <table className="w-full min-w-[1050px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Challan</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Bank</th>
                  <th className="px-2 py-2">Reference</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Items</th>
                  <th className="px-2 py-2">Journal</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-line/70">
                    <td className="px-2 py-2 font-mono font-semibold text-ink-900">{entry.challanNumber}</td>
                    <td className="px-2 py-2 text-ink-600">{formatDate(entry.depositDate)}</td>
                    <td className="px-2 py-2 text-ink-700">{entry.bankAccountName}<span className="block text-[12px] text-ink-400">{entry.bankBranch}</span></td>
                    <td className="px-2 py-2 text-ink-600">{entry.depositReference}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">{entry.totalBdt}</td>
                    <td className="px-2 py-2 text-right font-mono">{entry.items.length}</td>
                    <td className="px-2 py-2 text-ink-600">{entry.journalNumber ?? '—'}</td>
                    <td className="px-2 py-2">{statusChip(entry.status)}</td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="lv-btn lv-btn-ghost min-h-9 text-[12px]" onClick={() => setSelected(entry)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Challan ${selected.challanNumber}`}
          kicker={`${formatDate(selected.depositDate)} · ${selected.bankAccountName} · ${selected.bankBranch}`}
          action={statusChip(selected.status)}
        >
          <div className="grid gap-2 text-[13px] sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Deposit reference</p><p className="mt-1 font-mono text-ink-900">{selected.depositReference}</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Evidence</p><p className="mt-1 truncate text-ink-900" title={selected.evidenceReference}>{selected.evidenceReference}</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Journal</p><p className="mt-1 font-mono text-ink-900">{selected.journalNumber ?? '—'}</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Total</p><p className="mt-1 font-mono font-semibold text-ink-900">{selected.totalBdt} BDT</p></div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Tax</th>
                  <th className="px-2 py-2">Period</th>
                  <th className="px-2 py-2">Party</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Economic code</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Draft certificate</th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map((item) => (
                  <tr key={item.id} className="border-t border-line/70">
                    <td className="px-2 py-2 font-semibold text-ink-900">{taxLabel(item.taxType)}</td>
                    <td className="px-2 py-2 text-ink-600">{item.taxPeriod}</td>
                    <td className="px-2 py-2 text-ink-700">{item.partyNameEn}</td>
                    <td className="px-2 py-2 text-ink-600">{item.paymentNumber ?? item.billNo ?? '—'}</td>
                    <td className="px-2 py-2 font-mono text-ink-700">{item.economicCode}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">{item.amountBdt}</td>
                    <td className="px-2 py-2 text-ink-600">{item.certificateNumber ?? 'Cancelled / none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canReverse && selected.status === 'POSTED' ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-200">
                Reversing the deposit returns every selected liability to PENDING and cancels its draft certificates. The posted journal is reversed, never deleted.
              </p>
              {!reverseOpen ? (
                <button type="button" className="lv-btn lv-btn-secondary mt-3 min-h-11 text-[13px]" onClick={() => setReverseOpen(true)}>
                  <RotateCcw size={15} /> Reverse deposit
                </button>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-semibold text-ink-700">Reversal date</span>
                    <input type="date" className={INPUT_CLASS} value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-semibold text-ink-700">Reason</span>
                    <input className={INPUT_CLASS} value={reverseReason} maxLength={500} onChange={(event) => setReverseReason(event.target.value)} />
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" className="lv-btn lv-btn-danger min-h-11 text-[13px]" disabled={busy || reverseReason.trim().length < 3} onClick={() => void reverse()}>
                      <XCircle size={15} /> {busy ? 'Reversing…' : 'Confirm reversal'}
                    </button>
                    <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px]" onClick={() => setReverseOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}

function CertificatesPanel({
  companyId,
  canApprove,
  busy,
  onBusy,
  onError,
  onNotice,
}: {
  companyId: string;
  canApprove: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string | null) => void;
  onNotice: (value: string | null) => void;
}) {
  const [entries, setEntries] = useState<TreasuryCertificate[]>([]);
  const [status, setStatus] = useState<TreasuryCertificateStatus | ''>('DRAFT');
  const [type, setType] = useState<'VDS' | 'TDS' | ''>('');
  const [direction, setDirection] = useState<'ISSUED' | 'RECEIVED' | ''>('');
  const [selected, setSelected] = useState<TreasuryCertificate | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [loading, setLoading] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [customerPartyId, setCustomerPartyId] = useState('');
  const [customerCertNo, setCustomerCertNo] = useState('');
  const [customerCertDate, setCustomerCertDate] = useState(todayIso());
  const [customerBaseBdt, setCustomerBaseBdt] = useState('');
  const [customerTaxBdt, setCustomerTaxBdt] = useState('');
  const [customerEvidence, setCustomerEvidence] = useState('');

  useEffect(() => {
    if (!companyId) return;
    masterApi
      .parties(companyId, { type: 'CUSTOMER', pageSize: 100 })
      .then((res) => setCustomers(res.parties))
      .catch(() => {});
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const response = await treasuryApi.certificates(companyId, {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(direction ? { direction } : {}),
        limit: 200,
      });
      setEntries(response.entries);
      setSelected((current) => response.entries.find((entry) => entry.id === current?.id) ?? null);
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, status, type, direction, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async () => {
    if (!selected) return;
    onBusy(true);
    onError(null);
    onNotice(null);
    try {
      const response = await treasuryApi.cancelCertificate(companyId, selected.id, reason);
      setSelected(response.certificate);
      setReason('');
      await load();
      onNotice('Draft certificate cancelled with an audit reason. No certificate was marked filed.');
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      onBusy(false);
    }
  };

  const reissue = async () => {
    if (!selected) return;
    onBusy(true);
    onError(null);
    onNotice(null);
    try {
      const response = await treasuryApi.reissueCertificate(companyId, selected.id, reason, evidence || null);
      setSelected(response.certificate);
      setReason('');
      setEvidence('');
      await load();
      onNotice('Replacement draft certificate created from the same source liability. The cancelled original remains in the register.');
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      onBusy(false);
    }
  };

  const handleRecordCustomer = async () => {
    if (!customerPartyId || !customerCertNo.trim() || !customerTaxBdt) return;
    onBusy(true);
    onError(null);
    try {
      const basePoisha = Math.round((parseFloat(customerBaseBdt) || 0) * 100);
      const taxPoisha = Math.round((parseFloat(customerTaxBdt) || 0) * 100);
      await treasuryApi.recordCustomerCertificate(companyId, {
        partyId: customerPartyId,
        certificateNumber: customerCertNo.trim(),
        certificateDate: customerCertDate,
        basePoisha: basePoisha.toString(),
        taxPoisha: taxPoisha.toString(),
        evidenceReference: customerEvidence.trim() || null,
      });
      setCustomerModalOpen(false);
      setCustomerCertNo('');
      setCustomerBaseBdt('');
      setCustomerTaxBdt('');
      await load();
      onNotice('Customer Mushak 6.6 certificate recorded successfully. Linked to Mushak 9.1 Note 29 decreasing adjustment.');
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Withholding certificates"
        kicker="Derived from the deposited VDS/TDS liability, never from a multiplier"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="lv-btn lv-btn-primary min-h-11 text-[13px]"
              onClick={() => setCustomerModalOpen(true)}
            >
              <Plus size={15} /> Record Customer Mushak 6.6 (Note 29)
            </button>
            <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        }
      >
        <Notice
          message="Every certificate is DRAFT — statutory format not verified. This screen has no Issue, Print-as-final or Filed action. A cancellation or reissue keeps the original record and adds an audit event."
          tone="warning"
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Status</span>
            <select className={INPUT_CLASS} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Type</span>
            <select className={INPUT_CLASS} value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="">All</option>
              <option value="VDS">VDS</option>
              <option value="TDS">TDS</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Direction</span>
            <select className={INPUT_CLASS} value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}>
              <option value="">All</option>
              <option value="ISSUED">Issued</option>
              <option value="RECEIVED">Received</option>
            </select>
          </label>
          <div className="flex items-end">
            <p className="text-[12px] text-ink-500">{loading ? 'Loading…' : `${entries.length} certificates`}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {entries.length === 0 ? (
            <EmptyState
              title="No certificates in this view"
              hint="A certificate is created only when a VDS or TDS liability is deposited. Received certificates are not generated because customer withholding is not captured by the current receipt model."
            />
          ) : (
            <table className="w-full min-w-[1150px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Direction</th>
                  <th className="px-2 py-2">Party</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2 text-right">Base</th>
                  <th className="px-2 py-2 text-right">Tax</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-line/70">
                    <td className="px-2 py-2 font-mono font-semibold text-ink-900">{entry.certificateNumber}</td>
                    <td className="px-2 py-2 font-semibold text-ink-800">{entry.certificateType}</td>
                    <td className="px-2 py-2 text-ink-600">{entry.direction}</td>
                    <td className="px-2 py-2 text-ink-700">{entry.partyNameEn}<span className="block text-[12px] text-ink-400">{entry.partyCode}</span></td>
                    <td className="px-2 py-2 text-ink-600">
                      {entry.originalDocumentNo ?? entry.paymentNumber ?? '—'}
                      {entry.challanNumber ? <span className="block text-[12px] text-ink-400">{entry.challanNumber}</span> : null}
                    </td>
                    <td className="px-2 py-2 text-ink-600">{formatDate(entry.certificateDate)}</td>
                    <td className="px-2 py-2 text-right font-mono">{entry.baseBdt}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">{entry.taxBdt}</td>
                    <td className="px-2 py-2">
                      {statusChip(entry.status)}
                      {entry.status === 'DRAFT' ? <span className="ml-1 text-[12px] text-ink-400">Draft format</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="lv-btn lv-btn-ghost min-h-9 text-[12px]" onClick={() => { setSelected(entry); setReason(''); setEvidence(''); }}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Certificate ${selected.certificateNumber}`}
          kicker={`${selected.certificateType} · ${selected.direction} · ${selected.partyNameEn}`}
          action={
            <div className="flex items-center gap-2">
              {statusChip(selected.status)}
              <button
                type="button"
                className="lv-btn lv-btn-secondary min-h-9 px-2.5 text-[12px]"
                onClick={() => setPrintModalOpen(true)}
              >
                <Printer size={13} /> Mushak 6.6 Preview
              </button>
            </div>
          }
        >
          <div className="grid gap-2 text-[13px] sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Source bill</p><p className="mt-1 text-ink-900">{selected.originalDocumentNo ?? '—'}</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Payment</p><p className="mt-1 text-ink-900">{selected.paymentNumber ?? '—'}</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Base</p><p className="mt-1 font-mono text-ink-900">{selected.baseBdt} BDT</p></div>
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2"><p className="text-[12px] text-ink-400">Tax</p><p className="mt-1 font-mono font-semibold text-ink-900">{selected.taxBdt} BDT</p></div>
          </div>
          <Notice
            message="This certificate is a draft derived from the source liability. Cancellation or reissue is audited; the original row is never edited or deleted."
            tone="warning"
          />
          {canApprove && selected.status === 'DRAFT' ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-700">Cancellation / reissue reason</span>
                <input className={INPUT_CLASS} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-700">Replacement evidence reference (optional)</span>
                <input className={INPUT_CLASS} value={evidence} maxLength={500} onChange={(event) => setEvidence(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
                  <XCircle size={15} /> Cancel draft
                </button>
                <button type="button" className="lv-btn lv-btn-primary min-h-11 text-[13px]" disabled={busy || reason.trim().length < 3} onClick={() => void reissue()}>
                  <FileCheck2 size={15} /> Cancel and reissue draft
                </button>
              </div>
            </div>
          ) : null}
          {selected.status === 'CANCELLED' && canApprove && selected.challanId ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-700">Reissue reason</span>
                <input className={INPUT_CLASS} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="flex items-end">
                <button type="button" className="lv-btn lv-btn-primary min-h-11 text-[13px]" disabled={busy || reason.trim().length < 3} onClick={() => void reissue()}>
                  <FileCheck2 size={15} /> Reissue draft
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {/* Record Customer Mushak 6.6 Modal (Note 29) */}
      {customerModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="ql-card w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-ql-border pb-3">
              <div>
                <span className="ql-badge ql-badge-neutral text-[11px] font-bold uppercase">Mushak 9.1 Note 29</span>
                <h3 className="mt-1 text-[16px] font-bold text-ink-900">
                  Record Customer Mushak 6.6 Certificate
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCustomerModalOpen(false)}
                className="lv-btn lv-btn-ghost min-h-8 px-2 text-ink-500"
              >
                <XCircle size={18} />
              </button>
            </div>

            <p className="text-[12px] leading-relaxed text-ink-500">
              Record the VDS certificate issued by your customer upon making payment. This certificate backs your decreasing adjustment claim in Note 29 of the Mushak 9.1 VAT Return.
            </p>

            <div className="space-y-3 text-[13px]">
              <label className="block">
                <span className="mb-1 block font-semibold text-ink-700">Customer</span>
                <select
                  className={INPUT_CLASS}
                  value={customerPartyId}
                  onChange={(e) => setCustomerPartyId(e.target.value)}
                >
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.nameEn} {c.bin ? `(BIN: ${c.bin})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block font-semibold text-ink-700">Certificate #</span>
                  <input
                    className={INPUT_CLASS}
                    placeholder="e.g. 6.6/2026-27/00142"
                    value={customerCertNo}
                    onChange={(e) => setCustomerCertNo(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-ink-700">Issue Date</span>
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={customerCertDate}
                    onChange={(e) => setCustomerCertDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block font-semibold text-ink-700">Taxable Base (BDT)</span>
                  <input
                    className={INPUT_CLASS}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={customerBaseBdt}
                    onChange={(e) => setCustomerBaseBdt(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-ink-700">VDS Deducted (BDT)</span>
                  <input
                    className={INPUT_CLASS}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={customerTaxBdt}
                    onChange={(e) => setCustomerTaxBdt(e.target.value)}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block font-semibold text-ink-700">Scan / Evidence Reference</span>
                <input
                  className={INPUT_CLASS}
                  placeholder="e.g. evidence/customer-mushak66.pdf"
                  value={customerEvidence}
                  onChange={(e) => setCustomerEvidence(e.target.value)}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-ql-border pt-4">
              <button
                type="button"
                onClick={() => setCustomerModalOpen(false)}
                className="lv-btn lv-btn-ghost min-h-10 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!customerPartyId || !customerCertNo.trim() || !customerTaxBdt}
                onClick={() => void handleRecordCustomer()}
                className="lv-btn lv-btn-primary min-h-10 text-[13px]"
              >
                Save Certificate
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Bilingual Mushak 6.6 PDF / Print Preview Modal */}
      {printModalOpen && selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-3xl rounded-xl bg-white p-8 text-black shadow-2xl space-y-6 my-8">
            <div className="flex items-center justify-between border-b border-gray-300 pb-3">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-500">
                Statutory Certificate Preview · NBR Rule 40(1)(f)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="lv-btn lv-btn-primary min-h-9 px-3 text-[12px]"
                >
                  <Printer size={13} /> Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => setPrintModalOpen(false)}
                  className="lv-btn lv-btn-ghost min-h-9 px-2 text-gray-600"
                >
                  <XCircle size={18} />
                </button>
              </div>
            </div>

            {/* Official NBR Mushak 6.6 Header */}
            <div className="text-center space-y-1">
              <p className="text-[14px] font-semibold">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
              <p className="text-[12px]">জাতীয় রাজস্ব বোর্ড</p>
              <h2 className="text-[16px] font-bold mt-2">উৎসে কর কর্তন সনদপত্র</h2>
              <p className="text-[11px] text-gray-600">[ বিধি ৪০ এর উপ-বিধি (১) এর দফা (চ) দ্রষ্টব্য ]</p>
              <p className="text-[14px] font-mono font-bold text-gray-800 mt-1">মূসক-৬.৬</p>
            </div>

            <div className="flex justify-between text-[12px] border-b border-gray-200 pb-2">
              <div>
                <p>সনদপত্র নম্বর (Certificate No): <strong className="font-mono">{selected.certificateNumber}</strong></p>
              </div>
              <div>
                <p>ইস্যুর তারিখ (Issue Date): <strong>{selected.certificateDate}</strong></p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-[12px] bg-gray-50 p-4 rounded-lg">
              <div>
                <p className="font-bold text-gray-700">উৎসে কর কর্তনকারী কর্তৃপক্ষ (Deduction Authority):</p>
                <p className="mt-1 font-semibold">Fintuity Suite Demo Company Ltd.</p>
                <p className="text-gray-600">বিআইএন (BIN): 001234567-0101</p>
                <p className="text-gray-600">ঠিকানা: গুলশান-২, ঢাকা-১২১২</p>
              </div>
              <div>
                <p className="font-bold text-gray-700">সরবরাহকারী / পক্ষ (Supplier / Party):</p>
                <p className="mt-1 font-semibold">{selected.partyNameEn}</p>
                <p className="text-gray-600">কোড (Code): {selected.partyCode}</p>
                <p className="text-gray-600">দিক (Direction): {selected.direction}</p>
              </div>
            </div>

            {/* Table of Deduction Details */}
            <table className="w-full border border-gray-300 text-[11px] text-left">
              <thead className="bg-gray-100 border-b border-gray-300">
                <tr>
                  <th className="border-r border-gray-300 p-2 text-center">ক্রমিক</th>
                  <th className="border-r border-gray-300 p-2">চালানপত্র / বিল নং</th>
                  <th className="border-r border-gray-300 p-2">তারিখ</th>
                  <th className="border-r border-gray-300 p-2 text-right">মূল্য (কর ব্যতীত)</th>
                  <th className="border-r border-gray-300 p-2 text-right">কর্তিত মূসক</th>
                  <th className="p-2">ট্রেজারি চালান ও কোড</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-r border-gray-300 p-2 text-center font-mono">১</td>
                  <td className="border-r border-gray-300 p-2 font-mono">
                    {selected.originalDocumentNo ?? selected.paymentNumber ?? '—'}
                  </td>
                  <td className="border-r border-gray-300 p-2">{selected.certificateDate}</td>
                  <td className="border-r border-gray-300 p-2 text-right font-mono font-semibold">
                    ৳{selected.baseBdt}
                  </td>
                  <td className="border-r border-gray-300 p-2 text-right font-mono font-bold text-black">
                    ৳{selected.taxBdt}
                  </td>
                  <td className="p-2 font-mono text-[10px]">
                    {selected.challanNumber ? (
                      <div>
                        <strong>{selected.challanNumber}</strong>
                        <div className="text-gray-500">1/1141/0010/0311</div>
                      </div>
                    ) : (
                      'Pending Deposit'
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="text-[12px] space-y-1 text-gray-700 bg-gray-50 p-3 rounded">
              <p>
                প্রত্যয়ন করা যাইতেছে যে, উপরোল্লিখিত বিলের বিপরীতে প্রযোজ্য মূসক আইন, ২০১২ এর ধারা ৪৯ অনুযায়ী নির্ধারিত হারে উৎসে কর কর্তনপূর্বক সরকারি ট্রেজারিতে জমা প্রদান করা হইয়াছে।
              </p>
            </div>

            <div className="flex justify-between pt-12 text-[12px]">
              <div className="text-center">
                <div className="border-t border-gray-400 w-44 pt-1 font-semibold">প্রস্তুতকারী (Prepared By)</div>
                <div className="text-[10px] text-gray-500">{selected.createdByName}</div>
              </div>
              <div className="text-center">
                <div className="border-t border-gray-400 w-44 pt-1 font-semibold">দায়িত্বপ্রাপ্ত কর্মকর্তা (Officer)</div>
                <div className="text-[10px] text-gray-500">সিলমোহর ও স্বাক্ষর</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProofPanel({ companyId, canView, onError }: { companyId: string; canView: boolean; onError: (value: string | null) => void }) {
  const [asOf, setAsOf] = useState(todayIso());
  const [proof, setProof] = useState<TreasuryProof | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    onError(null);
    try {
      const response = await treasuryApi.proof(companyId, asOf);
      setProof(response.proof);
    } catch (caught) {
      onError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, asOf, canView, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return <Notice message="You do not have permission to view treasury reconciliation." tone="warning" />;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Treasury control proof"
        kicker="Pending liabilities agree to the VDS/TDS/reverse-charge control accounts"
        action={
          <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">As-of date</span>
            <input type="date" className={INPUT_CLASS} value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <div className="flex items-end">
            <p className="text-[12px] text-ink-500">{loading ? 'Loading…' : 'Current outstanding liabilities reconciled to the GL.'}</p>
          </div>
        </div>
        {proof ? (
          <>
            <div className="mt-4 space-y-2">
              <ProofRow
                label="VDS payable"
                gl={`${proof.taxes.VDS.glBdt} BDT`}
                subledger={`${proof.taxes.VDS.pendingBdt} BDT pending`}
                difference={`${proof.taxes.VDS.differenceBdt} BDT`}
                agrees={proof.taxes.VDS.agrees}
              />
              <ProofRow
                label="TDS payable"
                gl={`${proof.taxes.TDS.glBdt} BDT`}
                subledger={`${proof.taxes.TDS.pendingBdt} BDT pending`}
                difference={`${proof.taxes.TDS.differenceBdt} BDT`}
                agrees={proof.taxes.TDS.agrees}
              />
              <ProofRow
                label="Reverse-charge VAT payable"
                gl={`${proof.taxes.REVERSE_CHARGE.glBdt} BDT`}
                subledger={`${proof.taxes.REVERSE_CHARGE.pendingBdt} BDT pending`}
                difference={`${proof.taxes.REVERSE_CHARGE.differenceBdt} BDT`}
                agrees={proof.taxes.REVERSE_CHARGE.agrees}
              />
              <ProofRow
                label="Treasury deposit register"
                gl={`${proof.challans.postedBdt} BDT posted`}
                subledger={`${proof.challans.depositedLiabilityBdt} BDT liabilities in posted challans`}
                difference={`${proof.challans.differenceBdt} BDT`}
                agrees={proof.challans.agrees}
              />
            </div>
            <div className="mt-4 grid gap-2 text-[13px] sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                <p className="text-[12px] text-ink-400">Deposited liabilities</p>
                <p className="mt-1 font-mono font-semibold text-ink-900">{proof.taxes.VDS.depositedBdt} VDS / {proof.taxes.TDS.depositedBdt} TDS</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                <p className="text-[12px] text-ink-400">Draft certificates</p>
                <p className="mt-1 text-ink-900">{proof.certificates.draftCount} · <span className="font-mono">{proof.certificates.draftBdt} BDT tax</span></p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                <p className="text-[12px] text-ink-400">Certificates</p>
                <p className="mt-1 flex items-center gap-1 text-ink-900"><AlertTriangle size={13} /> {proof.certificates.label}</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
              The proof compares current PENDING liabilities with the GL balance as of the selected date. Deposited liabilities are cleared from the control account by the deposit journal. A difference is shown as an exception; it is never plugged.
            </p>
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}

function formatPoisha(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}
