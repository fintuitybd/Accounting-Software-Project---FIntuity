// LedgerVault — W04 Treasury challans & Mushak 6.6.
//
// Batch the pending VDS/TDS queue into one treasury deposit: choose the bank and branch, accept the
// auto-generated challan reference and economic deposit code, post the single Dr VDS/TDS Payable /
// Cr Bank settlement journal, then unlock the A4 Mushak 6.6 certificate.
//
// The second tab chases customer-issued Mushak 6.6 certificates. Marking one as received immediately
// feeds the Mushak 9.1 Part 6 decreasing adjustment in W05 and the printed return.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CircleCheck,
  Clock,
  Coins,
  FileCheck2,
  Landmark,
  Layers,
  Printer,
  Send,
  ShieldCheck,
  Stamp,
  Users,
} from 'lucide-react';

import { WorkspaceHeader } from '../components/commercial/CommercialShared';
import { StatutoryPrintModal } from '../components/signature/StatutoryPrintModal';
import { daysBetween, formatDate } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { Challan, ChallanType, VdsCertificate } from '../core/types';

const TODAY = '2026-11-01';
const FILTERS: Array<{ id: ChallanType | 'ALL'; en: string; bn: string }> = [
  { id: 'ALL', en: 'All', bn: 'সব' },
  { id: 'VDS', en: 'VDS', bn: 'ভিডিএস' },
  { id: 'TDS', en: 'TDS', bn: 'টিডিএস' },
];

const ECONOMIC_CODE: Record<ChallanType, string> = {
  VDS: '1.1.04.01.02',
  TDS: '1.1.04.02.01',
  VAT: '1.1.04.01.01',
  AIT: '1.1.04.02.02',
};

type Tab = 'DEPOSIT' | 'RECEIVING';

export default function W04_TreasuryChallans66() {
  const {
    locale,
    money,
    tenant,
    challans,
    vdsCertificates,
    parties,
    bankAccounts,
    depositTreasuryChallan,
    depositChallanBatch,
    receiveVdsCertificate,
    publishToast,
  } = useVault();
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [tab, setTab] = useState<Tab>('DEPOSIT');
  const [filter, setFilter] = useState<ChallanType | 'ALL'>('ALL');
  const [selected, setSelected] = useState<string[]>([]);
  const [printCert, setPrintCert] = useState<VdsCertificate | null>(null);
  const [depositDate, setDepositDate] = useState(TODAY);
  const [bankCode, setBankCode] = useState(() => bankAccounts[0]?.account_code ?? '1110');
  const [branch, setBranch] = useState(() => bankAccounts[0]?.branch ?? 'Banani Branch');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [lastBatch, setLastBatch] = useState<{ ref: string; journal: string; total: bigint; ids: string[] } | null>(null);
  const [chaseNote, setChaseNote] = useState('');

  const pending = useMemo(
    () => challans.filter((challan) => challan.status === 'PENDING' || challan.status === 'BATCHED'),
    [challans],
  );
  const deposited = useMemo(
    () => challans.filter((challan) => challan.status === 'DEPOSITED' || challan.status === 'CERTIFIED'),
    [challans],
  );
  const receivedCertificates = useMemo(
    () => vdsCertificates.filter((certificate) => certificate.direction === 'RECEIVED'),
    [vdsCertificates],
  );
  const pendingCertificates = useMemo(
    () => receivedCertificates.filter((certificate) => certificate.status !== 'RECEIVED' && certificate.status !== 'VERIFIED'),
    [receivedCertificates],
  );
  const visible = useMemo(
    () => pending.filter((challan) => filter === 'ALL' || challan.type === filter),
    [pending, filter],
  );

  const sum = (rows: Challan[]): bigint => rows.reduce((total, challan) => total + challan.amount_poisha, 0n);
  const pendingVds = sum(pending.filter((challan) => challan.type === 'VDS'));
  const pendingTds = sum(pending.filter((challan) => challan.type === 'TDS'));
  const selectedRows = pending.filter((challan) => selected.includes(challan.id));
  const selectedTotal = sum(selectedRows);
  const selectedVds = sum(selectedRows.filter((challan) => challan.type === 'VDS'));
  const selectedTds = sum(selectedRows.filter((challan) => challan.type === 'TDS'));
  const outstandingValue = pendingCertificates.reduce((total, certificate) => total + certificate.vds_poisha, 0n);
  const receivedValue = receivedCertificates
    .filter((certificate) => certificate.status === 'RECEIVED' || certificate.status === 'VERIFIED')
    .reduce((total, certificate) => total + certificate.vds_poisha, 0n);

  const bank = bankAccounts.find((account) => account.account_code === bankCode) ?? bankAccounts[0] ?? null;
  const batchReference = `TCH-${depositDate.replace(/-/g, '')}-${String(deposited.length + 1).padStart(3, '0')}`;
  const selectedCodes = Array.from(new Set(selectedRows.map((challan) => ECONOMIC_CODE[challan.type])));

  const economicCodes = useMemo(() => {
    const map = new Map<string, { code: string; count: number; total: bigint; types: Set<ChallanType> }>();
    for (const challan of pending) {
      const entry = map.get(challan.economic_code) ?? { code: challan.economic_code, count: 0, total: 0n, types: new Set<ChallanType>() };
      entry.count += 1;
      entry.total += challan.amount_poisha;
      entry.types.add(challan.type);
      map.set(challan.economic_code, entry);
    }
    return Array.from(map.values()).sort((a, b) => (b.total > a.total ? 1 : -1));
  }, [pending]);

  const certificateFor = (challan: Challan): VdsCertificate => {
    const existing =
      vdsCertificates.find((certificate) => certificate.challan_id === challan.id) ??
      vdsCertificates.find((certificate) => certificate.related_doc_ref === challan.challan_number);
    if (existing) return existing;
    const party = parties.find((entry) => entry.id === challan.party_id);
    return {
      id: `CERT-${challan.id}`,
      certificate_number: challan.certificate_numbers[0] ?? `6.6/2026/${challan.challan_number.split('/').pop() ?? '0001'}`,
      direction: 'ISSUED',
      party_id: challan.party_id ?? '',
      party_name_en: party?.name_en ?? 'Counterparty',
      party_name_bn: party?.name_bn ?? 'প্রতিপক্ষ',
      party_bin: party?.bin,
      amount_poisha: challan.amount_poisha * 20n,
      vds_poisha: challan.amount_poisha,
      certificate_date: challan.deposit_date ?? TODAY,
      status: challan.status === 'DEPOSITED' ? 'VERIFIED' : 'PENDING',
      related_doc_ref: challan.challan_number,
      challan_id: challan.id,
    };
  };

  const toggle = (id: string): void => {
    setSelected((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));
  };
  const toggleAll = (): void => {
    const ids = visible.map((challan) => challan.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((previous) => (allSelected ? previous.filter((id) => !ids.includes(id)) : Array.from(new Set([...previous, ...ids]))));
  };

  const depositBatch = (): void => {
    setFeedback(null);
    if (selected.length === 0) {
      setFeedback({ tone: 'error', text: L('Select at least one pending challan to deposit.', 'জমা দিতে অন্তত একটি অপেক্ষমাণ চালান নির্বাচন করুন।') });
      return;
    }
    const result = depositChallanBatch({
      challan_ids: selected,
      bank_account_code: bank?.account_code ?? '1110',
      bank_branch: branch || bank?.branch || 'Banani Branch',
      deposit_date: depositDate,
      batch_reference: batchReference,
    });
    if (!result.ok || !result.data) {
      setFeedback({ tone: 'error', text: result.error ?? L('Batch deposit rejected.', 'ব্যাচ জমা বাতিল হয়েছে।') });
      return;
    }
    setLastBatch({ ref: batchReference, journal: result.data.journal_number, total: selectedTotal, ids: selected });
    setFeedback({
      tone: 'success',
      text: L(
        `${selected.length} liabilities deposited · ${result.data.journal_number} · ${money(selectedTotal)}. Mushak 6.6 certificates are unlocked below.`,
        `${selected.length}টি দায় জমা · ${result.data.journal_number} · ${money(selectedTotal)}। নিচে মূসক ৬.৬ সনদ খোলা হয়েছে।`,
      ),
    });
    setSelected([]);
  };

  const markReceived = (certificate: VdsCertificate): void => {
    const result = receiveVdsCertificate(certificate.id);
    if (!result.ok) {
      setFeedback({ tone: 'error', text: result.error ?? L('Could not mark the certificate as received.', 'সনদ প্রাপ্ত হিসেবে চিহ্নিত করা যায়নি।') });
      return;
    }
    setChaseNote(
      L(
        `${certificate.certificate_number} received · ${money(certificate.vds_poisha)} added to Mushak 9.1 Part 6 decreasing adjustment.`,
        `${certificate.certificate_number} প্রাপ্ত · ${money(certificate.vds_poisha)} মূসক ৯.১ অংশ ৬ হ্রাস সমন্বয়ে যোগ হয়েছে।`,
      ),
    );
  };

  const chase = (certificate: VdsCertificate): void => {
    publishToast({
      tone: 'info',
      title: L('Mushak 6.6 reminder sent', 'মূসক ৬.৬ অনুস্মারক পাঠানো হয়েছে'),
      message: `${certificate.certificate_number} · ${certificate.party_name_en}`,
    });
    setChaseNote(L(`Reminder sent to ${certificate.party_name_en} for ${certificate.certificate_number}.`, `${certificate.party_name_en}-কে ${certificate.certificate_number}-এর অনুস্মারক পাঠানো হয়েছে।`));
  };

  const batchCertificates = lastBatch
    ? challans
        .filter((challan) => lastBatch.ids.includes(challan.id) && challan.type === 'VDS')
        .map((challan) => certificateFor(challan))
    : [];

  return (
    <>
      <WorkspaceHeader
        icon={<Layers size={19} />}
        kickerEn="Workspace 04 · Treasury"
        kickerBn="ওয়ার্কস্পেস ০৪ · কোষাগার"
        titleEn="VDS & TDS treasury challans · Mushak 6.6"
        titleBn="ভিডিএস ও টিডিএস কোষাগার চালান · মূসক ৬.৬"
        isBn={isBn}
        chips={
          <>
            <span className="lv-chip lv-chip-gold"><Clock size={12} /> {pending.length} {L('pending', 'অপেক্ষমাণ')}</span>
            <span className="lv-chip lv-chip-emerald"><ShieldCheck size={12} /> {tenant.tin_number}</span>
            <span className="lv-chip lv-chip-neutral"><Landmark size={12} /> {bank?.name_en ?? 'City Bank'}</span>
          </>
        }
      />

      <main className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: L('Pending VDS', 'অপেক্ষমাণ ভিডিএস'), value: pendingVds, icon: <Banknote size={15} />, tone: 'text-gold-700', iconTone: 'bg-gold-50 text-gold-600 ring-gold-500/15', bar: 'from-gold-500 via-gold-400/40', hint: L('Mushak 6.6 withholding', 'মূসক ৬.৬ কর্তন') },
            { label: L('Pending TDS', 'অপেক্ষমাণ টিডিএস'), value: pendingTds, icon: <Coins size={15} />, tone: 'text-amber-700', iconTone: 'bg-amber-50 text-amber-700 ring-amber-500/15', bar: 'from-amber-500 via-amber-400/40', hint: L('Income Tax Act 2023', 'আয়কর আইন ২০২৩') },
            { label: L('Deposited to treasury', 'কোষাগারে জমাকৃত'), value: sum(deposited), icon: <CircleCheck size={15} />, tone: 'text-vault-800', iconTone: 'bg-vault-50 text-vault-700 ring-vault-500/15', bar: 'from-vault-500 via-vault-400/40', hint: `${deposited.length} ${L('receipts', 'রসিদ')}` },
            { label: L('Customer 6.6 received', 'গ্রাহক ৬.৬ প্রাপ্ত'), value: receivedValue, icon: <FileCheck2 size={15} />, tone: 'text-emerald-700', iconTone: 'bg-emerald-50 text-emerald-700 ring-emerald-500/15', bar: 'from-emerald-500 via-emerald-400/40', hint: L('Feeds 9.1 Part 6 decreasing adjustment', '৯.১ অংশ ৬ হ্রাস সমন্বয়ে যায়') },
          ].map((card) => (
            <article key={card.label} className="lv-card lv-card-interactive relative overflow-hidden p-4">
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

        <div className="lv-seg">
          <button type="button" className="lv-seg-item" data-active={tab === 'DEPOSIT'} onClick={() => setTab('DEPOSIT')}>
            <Layers size={12} /> {L('Treasury deposit queue', 'কোষাগার জমা সারি')}
          </button>
          <button type="button" className="lv-seg-item" data-active={tab === 'RECEIVING'} onClick={() => setTab('RECEIVING')}>
            <Users size={12} /> {L('Customer 6.6 receivable chasing', 'গ্রাহক ৬.৬ প্রাপ্য তাগাদা')}
          </button>
        </div>

        {tab === 'DEPOSIT' ? (
          <>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
              <section className="lv-card overflow-hidden">
                <div className="lv-card-header">
                  <div>
                    <p className="lv-kicker flex items-center gap-1.5"><Layers size={12} /> {L('Deposit queue', 'জমা সারি')}</p>
                    <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Pending VDS / TDS deductions', 'অপেক্ষমাণ ভিডিএস / টিডিএস কর্তন')}</h2>
                  </div>
                  <div className="lv-seg">
                    {FILTERS.map((entry) => (
                      <button key={entry.id} type="button" className="lv-seg-item" data-active={filter === entry.id} onClick={() => setFilter(entry.id)}>
                        {isBn ? entry.bn : entry.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="lv-table min-w-[840px]">
                    <thead>
                      <tr>
                        <th className="w-9">
                          <button
                            type="button"
                            onClick={toggleAll}
                            className="grid h-5 w-5 place-items-center rounded border border-ink-300 text-vault-700"
                            title={L('Select all visible', 'সব দৃশ্যমান নির্বাচন')}
                          >
                            {visible.length > 0 && visible.every((challan) => selected.includes(challan.id)) ? <Check size={12} /> : null}
                          </button>
                        </th>
                        <th>{L('Challan', 'চালান')}</th>
                        <th>{L('Type', 'ধরন')}</th>
                        <th>{L('Period', 'সময়কাল')}</th>
                        <th>{L('Economic code', 'অর্থনৈতিক কোড')}</th>
                        <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                        <th>{L('Status', 'অবস্থা')}</th>
                        <th className="text-right">{L('Mushak 6.6', 'মূসক ৬.৬')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((challan) => (
                        <tr key={challan.id} className={selected.includes(challan.id) ? 'bg-vault-50/70' : ''}>
                          <td>
                            <button
                              type="button"
                              onClick={() => toggle(challan.id)}
                              aria-pressed={selected.includes(challan.id)}
                              className={`grid h-5 w-5 place-items-center rounded border transition ${selected.includes(challan.id) ? 'border-vault-700 bg-vault-700 text-white' : 'border-ink-300 bg-white text-transparent hover:border-vault-400'}`}
                            >
                              <Check size={12} />
                            </button>
                          </td>
                          <td>
                            <p className="font-mono text-[10px] font-semibold text-ink-900">{challan.challan_number}</p>
                            <p className="max-w-[240px] truncate text-[9.5px] text-ink-400">{challan.narration}</p>
                          </td>
                          <td><span className={`lv-chip ${challan.type === 'VDS' ? 'lv-chip-gold' : 'lv-chip-neutral'}`}>{challan.type}</span></td>
                          <td className="font-mono text-[10px]">{challan.period_code}</td>
                          <td className="font-mono text-[10px] text-ink-700">{ECONOMIC_CODE[challan.type]}</td>
                          <td className="font-money text-right text-[11px] font-semibold text-ink-900">{money(challan.amount_poisha)}</td>
                          <td><span className="lv-chip lv-chip-neutral">{challan.status}</span></td>
                          <td>
                            <div className="flex justify-end">
                              {challan.type === 'VDS' ? (
                                <button type="button" className="lv-btn lv-btn-secondary !px-2 !py-1" title={L('Print A4 Mushak 6.6 certificate', 'এ৪ মূসক ৬.৬ সনদ')} onClick={() => setPrintCert(certificateFor(challan))}>
                                  <Printer size={13} />
                                </button>
                              ) : <span className="text-[10px] text-ink-300">—</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {visible.length === 0 ? (
                        <tr><td colSpan={8} className="py-10 text-center text-xs text-ink-400">{L('No pending challans in this filter.', 'এই ফিল্টারে অপেক্ষমাণ চালান নেই।')}</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3 text-[10px] text-ink-500">
                  <span>{L('Deposits post one linked journal per batch, so the SHA-256 chain advances once.', 'প্রতি ব্যাচে একটি লিংকড খতিয়ান পোস্ট হয়, ফলে SHA-256 চেইন একবার এগোয়।')}</span>
                  <span>{selectedRows.length} {L('selected', 'নির্বাচিত')} · <span className="font-money font-semibold text-ink-800">{money(selectedTotal)}</span></span>
                </div>
              </section>

              <section className="lv-card overflow-hidden xl:sticky xl:top-24 xl:self-start">
                <div className="border-b border-ink-100 bg-gradient-to-br from-vault-950 via-vault-900 to-vault-800 px-4 py-3 text-white">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-vault-200">{L('One-click batch treasury challan', 'এক-ক্লিক ব্যাচ কোষাগার চালান')}</p>
                  <h2 className="mt-0.5 text-sm font-semibold">{L('Deposit slip', 'জমা স্লিপ')}</h2>
                </div>
                <div className="space-y-3 p-4">
                  <label className="block">
                    <span className="lv-label">{L('Bank account', 'ব্যাংক হিসাব')}</span>
                    <select
                      className="lv-input"
                      value={bankCode}
                      onChange={(event) => {
                        const next = bankAccounts.find((account) => account.account_code === event.target.value);
                        setBankCode(event.target.value);
                        if (next) setBranch(next.branch);
                      }}
                    >
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={account.account_code}>{account.name_en} · {account.masked_number}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="lv-label">{L('Bank branch', 'ব্যাংক শাখা')}</span>
                    <input className="lv-input" value={branch} onChange={(event) => setBranch(event.target.value)} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="lv-label">{L('Deposit date', 'জমার তারিখ')}</span>
                      <input type="date" className="lv-input" value={depositDate} onChange={(event) => setDepositDate(event.target.value)} />
                    </label>
                    <label className="block">
                      <span className="lv-label">{L('Challan no.', 'চালান নং')}</span>
                      <input className="lv-input font-mono" value={batchReference} readOnly />
                    </label>
                  </div>
                  <div>
                    <span className="lv-label">{L('Auto-filled economic deposit code', 'স্বয়ংক্রিয় অর্থনৈতিক জমা কোড')}</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedCodes.length > 0 ? selectedCodes.map((code) => (
                        <span key={code} className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[9.5px] text-vault-200">{code}</span>
                      )) : (
                        <span className="text-[10px] text-ink-400">{L('Select challans to resolve the code', 'কোড পেতে চালান নির্বাচন করুন')}</span>
                      )}
                    </div>
                  </div>
                  <dl className="space-y-1.5 rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-[11px]">
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Selected challans', 'নির্বাচিত চালান')}</dt><dd className="font-semibold">{selectedRows.length}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">VDS</dt><dd className="font-money font-semibold text-violet-700">{money(selectedVds)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-500">TDS</dt><dd className="font-money font-semibold text-amber-700">{money(selectedTds)}</dd></div>
                    <div className="flex justify-between gap-2 border-t border-ink-200 pt-1.5"><dt className="font-semibold text-ink-700">{L('Total deposit', 'মোট জমা')}</dt><dd className="font-money font-semibold text-ink-900">{money(selectedTotal)}</dd></div>
                  </dl>
                  <button type="button" onClick={depositBatch} disabled={selected.length === 0} className="lv-btn lv-btn-primary w-full">
                    <BadgeCheck size={15} /> {L('Deposit batch treasury challan', 'ব্যাচ কোষাগার চালান জমা')}
                  </button>
                  <p className="text-[9.5px] leading-relaxed text-ink-400">
                    {L(
                      'Posts Dr 2130 VDS Payable / Dr 2140 TDS Payable / Cr Bank, marks every selected challan DEPOSITED and unlocks the 6.6 certificate.',
                      'ডেবিট ২১৩০ ভিডিএস প্রদেয় / ডেবিট ২১৪০ টিডিএস প্রদেয় / ক্রেডিট ব্যাংক পোস্ট করে, সব নির্বাচিত চালান জমাকৃত করে ও ৬.৬ সনদ খোলে।',
                    )}
                  </p>
                  {feedback ? (
                    <div className={`rounded-xl border p-2.5 text-[10px] ${feedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                      {feedback.text}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>

            {lastBatch ? (
              <section className="lv-card overflow-hidden border-emerald-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                    <CircleCheck size={14} /> {L('Batch posted', 'ব্যাচ পোস্ট হয়েছে')} · {lastBatch.ref} · {lastBatch.journal} · {money(lastBatch.total)}
                  </p>
                  <span className="lv-chip lv-chip-emerald">{L('Mushak 6.6 unlocked', 'মূসক ৬.৬ খোলা')}</span>
                </div>
                <div className="flex flex-wrap gap-2 p-4">
                  {batchCertificates.length > 0 ? batchCertificates.map((certificate) => (
                    <button key={certificate.id} type="button" onClick={() => setPrintCert(certificate)} className="lv-btn lv-btn-secondary !py-1.5">
                      <Stamp size={13} /> {certificate.certificate_number}
                    </button>
                  )) : (
                    <p className="text-[11px] text-ink-500">{L('No VDS challan was in this batch — TDS-only deposits do not produce a 6.6 certificate.', 'এই ব্যাচে কোনো ভিডিএস চালান ছিল না — শুধু টিডিএস জমায় ৬.৬ সনদ হয় না।')}</p>
                  )}
                  <button type="button" className="lv-btn lv-btn-ghost !py-1.5" onClick={() => setLastBatch(null)}>{L('Dismiss', 'বন্ধ')}</button>
                </div>
              </section>
            ) : null}

            <section className="lv-card overflow-hidden">
              <div className="lv-card-header">
                <div>
                  <p className="lv-kicker flex items-center gap-1.5"><CircleCheck size={12} /> {L('Deposited history', 'জমাকৃত ইতিহাস')}</p>
                  <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Treasury receipts & 6.6 certificates', 'কোষাগার রসিদ ও ৬.৬ সনদ')}</h2>
                </div>
                <span className="lv-chip lv-chip-emerald">{deposited.length} {L('receipts', 'রসিদ')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="lv-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>{L('Challan', 'চালান')}</th>
                      <th>{L('Type', 'ধরন')}</th>
                      <th>{L('Period', 'সময়কাল')}</th>
                      <th>{L('Economic code', 'অর্থনৈতিক কোড')}</th>
                      <th>{L('Bank / branch', 'ব্যাংক / শাখা')}</th>
                      <th>{L('Deposit date', 'জমার তারিখ')}</th>
                      <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                      <th>{L('Status', 'অবস্থা')}</th>
                      <th className="text-right">{L('Print', 'প্রিন্ট')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposited.slice().reverse().map((challan) => (
                      <tr key={challan.id}>
                        <td>
                          <p className="font-mono text-[10px] font-semibold text-ink-900">{challan.challan_number}</p>
                          <p className="font-mono text-[9px] text-ink-400">{challan.batch_reference ?? '—'}</p>
                        </td>
                        <td><span className={`lv-chip ${challan.type === 'VDS' ? 'lv-chip-gold' : 'lv-chip-neutral'}`}>{challan.type}</span></td>
                        <td className="font-mono text-[10px]">{challan.period_code}</td>
                        <td className="font-mono text-[10px]">{ECONOMIC_CODE[challan.type]}</td>
                        <td className="text-[10px] text-ink-600">{challan.bank_branch ?? 'City Bank · Banani'}</td>
                        <td className="whitespace-nowrap text-[10px]">{challan.deposit_date ? formatDate(challan.deposit_date, locale) : '—'}</td>
                        <td className="font-money text-right text-[11px] font-semibold text-ink-900">{money(challan.amount_poisha)}</td>
                        <td><span className="lv-chip lv-chip-emerald">{challan.status}</span></td>
                        <td>
                          <div className="flex justify-end">
                            {challan.type === 'VDS' ? (
                              <button type="button" className="lv-btn lv-btn-secondary !px-2 !py-1" onClick={() => setPrintCert(certificateFor(challan))}>
                                <Printer size={13} />
                              </button>
                            ) : <span className="text-[10px] text-ink-300">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {deposited.length === 0 ? (
                      <tr><td colSpan={9} className="py-8 text-center text-xs text-ink-400">{L('No deposits recorded yet.', 'এখনও কোনো জমা নেই।')}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <section className="lv-card overflow-hidden">
              <div className="lv-card-header">
                <div>
                  <p className="lv-kicker flex items-center gap-1.5"><Users size={12} /> {L('Customer Mushak 6.6 receivable', 'গ্রাহক মূসক ৬.৬ প্রাপ্য')}</p>
                  <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Chase customers for the withholding certificate', 'কর্তন সনদের জন্য গ্রাহকদের তাগাদা')}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="lv-chip lv-chip-rose">{pendingCertificates.length} {L('outstanding', 'বাকি')}</span>
                  <span className="lv-chip lv-chip-emerald">{money(receivedValue)} {L('received', 'প্রাপ্ত')}</span>
                </div>
              </div>

              {chaseNote ? (
                <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[10px] font-semibold text-emerald-800">{chaseNote}</div>
              ) : null}

              <div className="divide-y divide-ink-100">
                {receivedCertificates.map((certificate) => {
                  const age = daysBetween(certificate.certificate_date, TODAY);
                  const received = certificate.status === 'RECEIVED' || certificate.status === 'VERIFIED';
                  return (
                    <div key={certificate.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${received ? 'bg-emerald-50/40' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-ink-900">{certificate.party_name_en}</p>
                        <p className="font-mono text-[9.5px] text-ink-400">{certificate.certificate_number} · {certificate.related_doc_ref}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[9px] text-ink-400">
                          <Clock size={9} /> {formatDate(certificate.certificate_date, locale)} · {age}d
                          {certificate.party_bin ? <span className="font-mono">BIN {certificate.party_bin}</span> : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-money text-[12px] font-semibold text-violet-700">{money(certificate.vds_poisha)}</span>
                        <span className={`lv-chip ${received ? 'lv-chip-emerald' : age > 30 ? 'lv-chip-rose' : 'lv-chip-gold'}`}>
                          {received ? L('Received · 9.1 Part 6', 'প্রাপ্ত · ৯.১ অংশ ৬') : L('Outstanding', 'বাকি')}
                        </span>
                        {!received ? (
                          <>
                            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1" onClick={() => chase(certificate)} title={L('Send reminder', 'অনুস্মারক পাঠান')}>
                              <Send size={12} />
                            </button>
                            <button type="button" className="lv-btn lv-btn-primary !px-2 !py-1 text-[10px]" onClick={() => markReceived(certificate)}>
                              <Check size={12} /> {L('Mark received', 'প্রাপ্ত চিহ্নিত')}
                            </button>
                          </>
                        ) : null}
                        <button type="button" className="lv-btn lv-btn-secondary !px-2 !py-1" onClick={() => setPrintCert(certificate)} title={L('Print certificate', 'সনদ প্রিন্ট')}>
                          <Printer size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {receivedCertificates.length === 0 ? (
                  <p className="px-4 py-10 text-center text-xs text-ink-400">{L('No customer withholding certificates yet.', 'এখনও কোনো গ্রাহক কর্তন সনদ নেই।')}</p>
                ) : null}
              </div>
            </section>

            <div className="space-y-5">
              <section className="lv-card lv-card-pad">
                <p className="lv-kicker flex items-center gap-1.5"><FileCheck2 size={12} /> {L('Mushak 9.1 Part 6 linkage', 'মূসক ৯.১ অংশ ৬ সংযোগ')}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
                  {L(
                    'A customer-issued Mushak 6.6 proves VDS was withheld from your sale and deposited by the buyer. Marking it received immediately adds its VDS amount to the Part 6 decreasing adjustment, reducing the net payable in W05 and on the printed return.',
                    'গ্রাহক ইস্যু করা মূসক ৬.৬ প্রমাণ করে আপনার বিক্রয় থেকে ভিডিএস কর্তন করে ক্রেতা জমা দিয়েছে। প্রাপ্ত চিহ্নিত করলে তার ভিডিএস অঙ্ক অংশ ৬ হ্রাস সমন্বয়ে যোগ হয়, ফলে W05 ও প্রিন্টেড রিটার্নে নিট প্রদেয় কমে।',
                  )}
                </p>
                <dl className="mt-3 space-y-1.5 text-[11px]">
                  <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Certificates outstanding', 'বাকি সনদ')}</dt><dd className="font-semibold">{pendingCertificates.length}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Outstanding VDS', 'বাকি ভিডিএস')}</dt><dd className="font-money font-semibold text-rose-600">{money(outstandingValue)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-500">{L('Received decreasing adjustment', 'প্রাপ্ত হ্রাস সমন্বয়')}</dt><dd className="font-money font-semibold text-emerald-700">{money(receivedValue)}</dd></div>
                </dl>
                <div className="mt-3 rounded-xl bg-vault-50 p-2.5 text-[10px] text-vault-800 ring-1 ring-inset ring-vault-200">
                  <p className="flex items-center gap-1.5 font-semibold"><ArrowRight size={11} /> {L('Live hand-off', 'লাইভ হ্যান্ড-অফ')}</p>
                  <p className="mt-0.5">{L('Open W05 → Mushak 9.1 to see the decreasing adjustment and the zero-variance GL proof.', 'হ্রাস সমন্বয় ও শূন্য-ব্যবধান জিএল প্রমাণ দেখতে W05 → মূসক ৯.১ খুলুন।')}</p>
                </div>
              </section>

              <section className="lv-card lv-card-pad">
                <p className="lv-kicker">{L('Economic deposit codes', 'অর্থনৈতিক জমা কোড')}</p>
                <ul className="mt-2 space-y-1.5">
                  {economicCodes.map((entry) => (
                    <li key={entry.code} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2.5 py-2">
                      <div>
                        <p className="font-mono text-[10px] font-semibold text-vault-800">{entry.code}</p>
                        <p className="text-[9px] text-ink-500">{entry.count} {L('challans', 'চালান')} · {Array.from(entry.types).join(' / ')}</p>
                      </div>
                      <p className="font-money text-[11px] font-semibold text-ink-900">{money(entry.total)}</p>
                    </li>
                  ))}
                  {economicCodes.length === 0 ? <li className="text-[10px] text-ink-400">{L('Queue is clear.', 'সারি খালি।')}</li> : null}
                </ul>
              </section>
            </div>
          </div>
        )}
      </main>

      <StatutoryPrintModal open={printCert !== null} onClose={() => setPrintCert(null)} mode="MUSHAK_6_6" certificate={printCert} />
    </>
  );
}
