// LedgerVault — W11 Secretarial governance.
//
// The company-secretary desk: the RJSC corporate register and share-capital ledger (paid-up
// capital proved against account 3100), the Trade / Fire / Environment / DIFE licence renewal
// tracker and the NBR tax-notice and appeals manager. Notices and licences come from the seeded
// statutory register; the response workflow (respond, close, escalate) is a local workstation
// state so the demo never pretends a filing has been made with the authority.

import { useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Download,
  FileCheck2,
  FileDown,
  FileText,
  Flame,
  Gavel,
  Landmark,
  Leaf,
  Lock,
  MailWarning,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  Stamp,
  Users,
  X,
} from 'lucide-react';

import { addDays, applyRateBps, bdtToPoisha, daysBetween, formatDate } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { EntityType, Notice } from '../core/types';
import type { StatutoryNoticeAndLicence } from '../core/ledger/seedData';

const TODAY = '2026-11-01';
const FACE_VALUE_POISHA = 1000n; // BDT 10 ordinary share
const EXPIRING_WINDOW_DAYS = 45;

const ENTITY_LABEL: Record<EntityType, { en: string; bn: string }> = {
  PRIVATE_LIMITED: { en: 'Private limited company', bn: 'প্রাইভেট লিমিটেড কোম্পানি' },
  PUBLIC_LISTED: { en: 'Public listed company', bn: 'পাবলিক লিস্টেড কোম্পানি' },
  SOLE_PROPRIETORSHIP: { en: 'Sole proprietorship', bn: 'একক মালিকানা' },
  PARTNERSHIP: { en: 'Partnership firm', bn: 'অংশীদারি প্রতিষ্ঠান' },
  STARTUP_REGISTERED: { en: 'Registered startup', bn: 'নিবন্ধিত স্টার্টআপ' },
  BRANCH_FOREIGN: { en: 'Foreign branch', bn: 'বিদেশি শাখা' },
  EPZ_EZ_UNIT: { en: 'EPZ / EZ unit', bn: 'ইপিজেড / ইজেড ইউনিট' },
  NGO_NPO: { en: 'NGO / NPO', bn: 'এনজিও / এনপিও' },
};

const RISK_TONE: Record<Notice['risk'], string> = {
  HIGH: 'lv-chip-rose',
  MEDIUM: 'lv-chip-gold',
  LOW: 'lv-chip-neutral',
};

const LICENCE_ICON: Record<string, typeof Flame> = {
  fire: Flame,
  environment: Leaf,
  dife: Users,
  trade: Stamp,
};

interface FilingRow {
  id: string;
  form: string;
  description_en: string;
  description_bn: string;
  filed_on: string;
  due: string;
  fee_poisha: bigint;
}

const FILINGS: FilingRow[] = [
  { id: 'RJSC-AR-2026', form: 'Annual Return (Schedule X)', description_en: 'Annual return with audited accounts and shareholding schedule.', description_bn: 'নিরীক্ষিত হিসাব ও শেয়ারহোল্ডিং সূচিসহ বার্ষিক রিটার্ন।', filed_on: '', due: '2027-01-21', fee_poisha: 50_000n },
  { id: 'RJSC-AGM-2026', form: 'AGM within 6 months of FY end', description_en: 'Annual general meeting for FY 2025-26.', description_bn: '২০২৫-২৬ অর্থবছরের বার্ষিক সাধারণ সভা।', filed_on: '', due: '2026-12-31', fee_poisha: 0n },
  { id: 'RJSC-FIX-2026', form: 'Form IX — auditor appointment', description_en: 'Appointment of statutory auditor for the next AGM.', description_bn: 'পরবর্তী এজিএমের জন্য বিধিবদ্ধ নিরীক্ষকের নিয়োগ।', filed_on: '2026-09-18', due: '2026-10-15', fee_poisha: 25_000n },
  { id: 'RJSC-MGT14', form: 'Schedule X — share transfer register', description_en: 'Chronological register of every share transfer.', description_bn: 'প্রতিটি শেয়ার হস্তান্তরের কালানুক্রমিক রেজিস্টার।', filed_on: '2026-07-02', due: '2026-07-31', fee_poisha: 0n },
];

type NoticeStage = 0 | 1 | 2 | 3;
type NoticeLifecycle = 'OPEN' | 'RESPONDED' | 'CLOSED';
type StatutoryNoticeRow = ReturnType<typeof useVault>['statutoryRecords'][number];

interface NoticeWorkflow {
  status: NoticeLifecycle;
  stage: NoticeStage;
  draft: string;
}

function noticeLifecycle(status: string): NoticeLifecycle {
  if (status === 'RESPONDED') return 'RESPONDED';
  if (status === 'CLOSED') return 'CLOSED';
  return 'OPEN';
}

function workflowSeed(status: string): Pick<NoticeWorkflow, 'status' | 'stage'> {
  const lifecycle = noticeLifecycle(status);
  return { status: lifecycle, stage: lifecycle === 'CLOSED' ? 3 : lifecycle === 'RESPONDED' ? 1 : 0 };
}

export default function W11_SecretarialGovernance() {
  const vault = useVault();
  const { locale, money, tenant, statements, statutoryRecords, publishToast } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bn: string): string => (isBn ? bn : en);

  const [renewals, setRenewals] = useState<ReadonlySet<string>>(new Set());
  const [licenceFilter, setLicenceFilter] = useState<'ALL' | 'EXPIRING' | 'EXPIRED'>('ALL');
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null);
  const [noticeWorkflow, setNoticeWorkflow] = useState<Record<string, NoticeWorkflow>>({});
  const [extraNotices, setExtraNotices] = useState<StatutoryNoticeAndLicence[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [logForm, setLogForm] = useState({
    reference: 'NBR/VAT/DHK/2026/',
    authority: 'NBR VAT Commissionerate, Dhaka',
    title_en: '',
    title_bn: '',
    risk: 'MEDIUM' as Notice['risk'],
    received: TODAY,
    due: addDays(TODAY, 15),
    amount: '0.00',
    notes: '',
  });

  const shareRow = statements.trial_balance.find((row) => row.account_code === '3100');
  const reserveRow = statements.trial_balance.find((row) => row.account_code === '3200');
  const paidUpCapital = shareRow ? shareRow.closing_credit_poisha - shareRow.closing_debit_poisha : 0n;
  const authorisedCapital = paidUpCapital * 10n;
  const totalShares = FACE_VALUE_POISHA > 0n ? paidUpCapital / FACE_VALUE_POISHA : 0n;

  const shareholders = useMemo(
    () => [
      {
        id: 'SH-01',
        name_en: 'Founder sponsor group',
        name_bn: 'প্রতিষ্ঠাতা স্পনসর গ্রুপ',
        role_en: 'Sponsor director',
        role_bn: 'স্পনসর পরিচালক',
        bps: 6000,
      },
      {
        id: 'SH-02',
        name_en: 'Institutional investor (private equity)',
        name_bn: 'প্রাতিষ্ঠানিক বিনিয়োগকারী (প্রাইভেট ইকুইটি)',
        role_en: 'Non-resident investor',
        role_bn: 'অনাবাসী বিনিয়োগকারী',
        bps: 2500,
      },
      {
        id: 'SH-03',
        name_en: 'Employee share participation trust',
        name_bn: 'কর্মী শেয়ার অংশগ্রহণ ট্রাস্ট',
        role_en: 'ESOP trustee',
        role_bn: 'ইএসওপি ট্রাস্টি',
        bps: 1500,
      },
    ].map((holder) => ({
      ...holder,
      amount_poisha: applyRateBps(paidUpCapital, holder.bps),
      shares: FACE_VALUE_POISHA > 0n ? applyRateBps(paidUpCapital, holder.bps) / FACE_VALUE_POISHA : 0n,
    })),
    [paidUpCapital],
  );

  const licences = useMemo(
    () =>
      statutoryRecords
        .filter((record) => record.kind === 'LICENCE')
        .map((record) => {
          const days = daysBetween(TODAY, record.due_or_expiry);
          const status = days < 0 ? 'EXPIRED' : days <= EXPIRING_WINDOW_DAYS ? 'EXPIRING' : 'VALID';
          const key = `${record.title_en} ${record.authority}`.toLowerCase();
          const iconKey = key.includes('fire')
            ? 'fire'
            : key.includes('environment') || key.includes('doe')
              ? 'environment'
              : key.includes('dife') || key.includes('labour')
                ? 'dife'
                : 'trade';
          return { record, days, status, icon: LICENCE_ICON[iconKey] ?? Stamp };
        })
        .sort((left, right) => left.days - right.days),
    [statutoryRecords],
  );

  const notices = useMemo(
    () => [...extraNotices, ...statutoryRecords.filter((record) => record.kind === 'NOTICE')],
    [statutoryRecords, extraNotices],
  );

  const openNotices = notices.filter((notice) => (noticeWorkflow[notice.id]?.status ?? noticeLifecycle(notice.status)) === 'OPEN');
  const highRiskOpen = openNotices.filter((notice) => notice.risk === 'HIGH');
  const selectedNotice = notices.find((notice) => notice.id === selectedNoticeId) ?? notices[0] ?? null;
  const selectedWorkflow = selectedNotice
    ? noticeWorkflow[selectedNotice.id] ?? { ...workflowSeed(selectedNotice.status), draft: '' }
    : null;

  const licenceSummary = useMemo(() => {
    const expiring = licences.filter((entry) => entry.status === 'EXPIRING');
    const expired = licences.filter((entry) => entry.status === 'EXPIRED');
    const fees = licences.reduce((total, entry) => total + entry.record.amount_poisha, 0n);
    return { expiring, expired, fees, valid: licences.length - expiring.length - expired.length };
  }, [licences]);

  const visibleLicences = licences.filter((entry) =>
    licenceFilter === 'ALL' ? true : licenceFilter === 'EXPIRED' ? entry.status === 'EXPIRED' : entry.status === 'EXPIRING',
  );

  const requestRenewal = (licenceId: string, title: string): void => {
    setRenewals((current) => new Set(current).add(licenceId));
    publishToast({
      tone: 'success',
      title: L('Renewal request logged', 'নবায়ন অনুরোধ নথিভুক্ত'),
      message: `${title} · ${L('session workflow only', 'শুধু সেশন কার্যপ্রবাহ')}`,
    });
  };

  const updateNotice = (
    notice: Pick<StatutoryNoticeRow, 'id' | 'status' | 'reference'>,
    patch: Partial<NoticeWorkflow>,
    message: string,
  ): void => {
    setNoticeWorkflow((current) => {
      const previous = current[notice.id] ?? { ...workflowSeed(notice.status), draft: '' };
      return { ...current, [notice.id]: { ...previous, ...patch } };
    });
    if (message) publishToast({ tone: 'info', title: message, message: notice.reference });
  };

  const setDraft = (notice: Pick<StatutoryNoticeRow, 'id' | 'status'>, value: string): void => {
    setNoticeWorkflow((current) => {
      const previous = current[notice.id] ?? { ...workflowSeed(notice.status), draft: '' };
      return { ...current, [notice.id]: { ...previous, draft: value } };
    });
  };

  const appealStages = [
    { en: 'Assessment / notice received', bn: 'প্রাথমিক / নোটিশ প্রাপ্তি' },
    { en: 'Response filed with authority', bn: 'কর্তৃপক্ষের কাছে জবাব দাখিল' },
    { en: 'Commissioner (Appeals)', bn: 'কমিশনার (আপিল)' },
    { en: 'Tax Appellate Tribunal', bn: 'কর আপিল ট্রাইব্যুনাল' },
  ];

  const logNotice = (): void => {
    if (!logForm.reference.trim() || !logForm.title_en.trim()) {
      publishToast({
        tone: 'warning',
        title: L('Reference and subject are required', 'নোটিশ নম্বর ও বিষয় আবশ্যক'),
        message: L('Complete the log form before saving.', 'সংরক্ষণের আগে ফর্মটি সম্পূর্ণ করুন।'),
      });
      return;
    }
    const id = `NOT-${Date.now().toString(36).toUpperCase()}`;
    const record: StatutoryNoticeAndLicence = {
      id,
      kind: 'NOTICE',
      reference: logForm.reference.trim(),
      title_en: logForm.title_en.trim(),
      title_bn: logForm.title_bn.trim() || logForm.title_en.trim(),
      authority: logForm.authority,
      issued_date: logForm.received,
      due_or_expiry: logForm.due,
      risk: logForm.risk,
      status: 'OPEN',
      amount_poisha: (() => {
        try {
          return bdtToPoisha(logForm.amount || '0');
        } catch {
          return 0n;
        }
      })(),
      notes_en: logForm.notes,
      notes_bn: logForm.notes,
    };
    setExtraNotices((current) => [record, ...current]);
    setSelectedNoticeId(id);
    setLogOpen(false);
    setLogForm((current) => ({ ...current, reference: 'NBR/VAT/DHK/2026/', title_en: '', title_bn: '', amount: '0.00', notes: '' }));
    publishToast({
      tone: 'success',
      title: L('Notice logged on the statutory register', 'নোটিশ বিধিবদ্ধ নিবন্ধনে নথিভুক্ত'),
      message: `${record.reference} · ${L('response due', 'জবাবের তারিখ')} ${formatDate(record.due_or_expiry, locale)}`,
    });
  };

  const packSections = useMemo(() => {
    const openNotice = selectedNotice;
    if (!openNotice) return [];
    const salesDocs = vault.commercialDocs.filter((doc) => doc.doc_type === 'SALES_INVOICE');
    const purchaseDocs = vault.commercialDocs.filter((doc) => doc.doc_type === 'PURCHASE_BILL' || doc.doc_type === 'EXPENSE_VOUCHER');
    const challanTotal = vault.challans.reduce((total, challan) => total + challan.amount_poisha, 0n);
    return [
      {
        title_en: '1 · Notice and response clock',
        title_bn: '১ · নোটিশ ও জবাবের সময়সীমা',
        body_en: `${openNotice.reference} issued by ${openNotice.authority} on ${formatDate(openNotice.issued_date, locale)}; statutory response due ${formatDate(openNotice.due_or_expiry, locale)} (${daysBetween(TODAY, openNotice.due_or_expiry)} days remaining).`,
        body_bn: `${openNotice.reference} — ${openNotice.authority} কর্তৃক ${formatDate(openNotice.issued_date, locale)} তারিখে জারি; বিধিবদ্ধ জবাবের তারিখ ${formatDate(openNotice.due_or_expiry, locale)} (${daysBetween(TODAY, openNotice.due_or_expiry)} দিন বাকি)।`,
      },
      {
        title_en: '2 · Mushak 6.2 sales register extract',
        title_bn: '২ · মূসক ৬.২ বিক্রয় রেজিস্টার নির্যাস',
        body_en: `${salesDocs.length} posted sales invoices, gross value ${money(salesDocs.reduce((total, doc) => total + doc.gross_poisha, 0n))}, output VAT ${money(salesDocs.reduce((total, doc) => total + doc.vat_poisha, 0n))}.`,
        body_bn: `${salesDocs.length}টি পোস্টেড বিক্রয় চালান, মোট মূল্য ${money(salesDocs.reduce((total, doc) => total + doc.gross_poisha, 0n))}, আউটপুট ভ্যাট ${money(salesDocs.reduce((total, doc) => total + doc.vat_poisha, 0n))}।`,
      },
      {
        title_en: '3 · Mushak 6.1 purchase register extract',
        title_bn: '৩ · মূসক ৬.১ ক্রয় রেজিস্টার নির্যাস',
        body_en: `${purchaseDocs.length} posted purchase documents with input rebate claimed ${money(purchaseDocs.reduce((total, doc) => total + (doc.tax_claimable_poisha ?? 0n), 0n))}.`,
        body_bn: `${purchaseDocs.length}টি পোস্টেড ক্রয় নথি, দাবিকৃত ইনপুট রিবেট ${money(purchaseDocs.reduce((total, doc) => total + (doc.tax_claimable_poisha ?? 0n), 0n))}।`,
      },
      {
        title_en: '4 · Treasury challan schedule',
        title_bn: '৪ · কোষাগার চালান সূচি',
        body_en: `${vault.challans.length} challans on file, deposited value ${money(challanTotal)}; every certificate number is traceable to a GL journal.`,
        body_bn: `${vault.challans.length}টি চালান নথিতে, জমাকৃত মূল্য ${money(challanTotal)}; প্রতিটি সনদ নম্বর জিএল জার্নালে অনুসরণযোগ্য।`,
      },
      {
        title_en: '5 · General ledger and trial-balance proof',
        title_bn: '৫ · খতিয়ান ও রেওয়ামিল প্রমাণ',
        body_en: `${vault.journals.length} posted journals; trial balance ${money(statements.trial_balance.reduce((total, row) => total + row.closing_debit_poisha, 0n))} debit vs ${money(statements.trial_balance.reduce((total, row) => total + row.closing_credit_poisha, 0n))} credit; SHA-256 audit chain ${vault.auditChain.valid ? 'intact' : 'broken'}.`,
        body_bn: `${vault.journals.length}টি পোস্টেড জার্নাল; রেওয়ামিল ${money(statements.trial_balance.reduce((total, row) => total + row.closing_debit_poisha, 0n))} ডেবিট বনাম ${money(statements.trial_balance.reduce((total, row) => total + row.closing_credit_poisha, 0n))} ক্রেডিট; শা-২৫৬ অডিট চেইন ${vault.auditChain.valid ? 'অটুট' : 'ভাঙা'}।`,
      },
      {
        title_en: '6 · Appeal route and reservation of rights',
        title_bn: '৬ · আপিল পথ ও অধিকার সংরক্ষণ',
        body_en: 'The company reserves all rights of appeal to the Commissioner (Appeals) and the Tax Appellate Tribunal, and does not waive any limitation period by filing this response.',
        body_bn: 'কোম্পানি কমিশনার (আপিল) ও কর আপিল ট্রাইব্যুনালে আপিলের সমস্ত অধিকার সংরক্ষণ করে এবং এই জবাব দাখিলে কোনো সময়সীমা মওকুফ করে না।',
      },
    ];
  }, [selectedNotice, vault.commercialDocs, vault.challans, vault.journals.length, vault.auditChain.valid, statements.trial_balance, money, locale]);

  const downloadResponsePack = (): void => {
    if (!selectedNotice) return;
    const rows = packSections
      .map(
        (section) =>
          `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${section.title_en}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${section.body_en}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Response pack ${selectedNotice.reference}</title></head>
<body style="font-family:Georgia,serif;color:#111827;padding:32px">
<h1 style="font-size:18px">${tenant.name_en} — NBR response pack</h1>
<p style="font-size:12px;color:#4b5563">Notice ${selectedNotice.reference} · ${selectedNotice.authority} · prepared ${TODAY}</p>
<table style="border-collapse:collapse;width:100%;font-size:12px">${rows}</table>
<p style="margin-top:18px;font-size:10px;color:#6b7280">Generated by LedgerVault from the immutable ledger. Filing with NBR happens outside the product.</p>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NBR-response-pack-${selectedNotice.reference.replace(/[^A-Za-z0-9]+/g, '-')}.html`;
    link.click();
    URL.revokeObjectURL(url);
    publishToast({
      tone: 'success',
      title: L('Response pack generated', 'জবাব প্যাক তৈরি'),
      message: `${selectedNotice.reference} · ${packSections.length} ${L('sections', 'অংশ')}`,
    });
  };

  return (
    <div className="space-y-5">
      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Building2 size={12} /> {L('RJSC corporate register', 'আরজেএসসি কর্পোরেট রেজিস্টার')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{isBn ? tenant.name_bn : tenant.name_en}</h2>
            <p className="lv-hint mt-1">
              {L(ENTITY_LABEL[tenant.entity_type].en, ENTITY_LABEL[tenant.entity_type].bn)} · RJSC {tenant.rjsc_reg_no} · TIN {tenant.tin_number}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="lv-chip lv-chip-neutral">
              <Landmark size={12} /> {isBn ? tenant.address_bn : tenant.address_en}
            </span>
            <span className="lv-chip lv-chip-emerald">
              <ShieldCheck size={12} /> {L('Incorporated', 'নিবন্ধিত')} {formatDate('2019-04-18', locale)}
            </span>
          </div>
        </div>

        <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: L('Paid-up capital', 'পরিশোধিত মূলধন'), value: money(paidUpCapital), note: 'A/C 3100' },
            { label: L('Authorised capital (MoA)', 'অনুমোদিত মূলধন (এমওএ)'), value: money(authorisedCapital), note: '10× paid-up' },
            { label: L('Ordinary shares of BDT 10', '১০ টাকার সাধারণ শেয়ার'), value: totalShares.toLocaleString(isBn ? 'bn-BD' : 'en-US'), note: L('face value', 'অভিহিত মূল্য') },
            { label: L('Retained earnings', 'সঞ্চিত মুনাফা'), value: reserveRow ? money(reserveRow.closing_credit_poisha - reserveRow.closing_debit_poisha) : '—', note: 'A/C 3200' },
            { label: L('Statutory filings', 'বিধিবদ্ধ দাখিল'), value: `${FILINGS.filter((filing) => filing.filed_on).length} / ${FILINGS.length}`, note: L('filed for FY 2025-26', '২০২৫-২৬ অর্থবছরে দাখিল') },
          ].map((card) => (
            <div key={card.label} className="rounded-xl bg-ink-50/70 px-3 py-2.5">
              <p className="lv-kicker">{card.label}</p>
              <p className="font-money mt-1 text-[13px] font-semibold text-ink-900">{card.value}</p>
              <p className="text-[10px] text-ink-400">{card.note}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker flex items-center gap-1.5"><Users size={12} /> {L('Share capital ledger', 'শেয়ার মূলধন খতিয়ান')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Members and shareholding schedule', 'সদস্য ও শেয়ারহোল্ডিং সূচি')}</h2>
            </div>
            <span className="lv-chip lv-chip-neutral">{shareholders.length} {L('members', 'সদস্য')}</span>
          </div>
          <table className="lv-table">
            <thead>
              <tr>
                <th>{L('Member', 'সদস্য')}</th>
                <th className="text-right">{L('Shares', 'শেয়ার')}</th>
                <th className="text-right">{L('Holding', 'অংশ')}</th>
                <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.map((holder) => (
                <tr key={holder.id}>
                  <td>
                    <p className="text-[12px] font-semibold text-ink-900">{isBn ? holder.name_bn : holder.name_en}</p>
                    <p className="text-[10px] text-ink-400">{isBn ? holder.role_bn : holder.role_en}</p>
                  </td>
                  <td className="font-money text-right text-[12px]">{holder.shares.toLocaleString(isBn ? 'bn-BD' : 'en-US')}</td>
                  <td className="font-money text-right text-[12px]">{(holder.bps / 100).toFixed(2)}%</td>
                  <td className="font-money text-right text-[12px] font-semibold text-ink-900">{money(holder.amount_poisha)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-200 bg-ink-50">
                <td className="text-[11px] font-semibold">{L('Total paid-up', 'মোট পরিশোধিত')}</td>
                <td className="font-money text-right text-[12px] font-semibold">{totalShares.toLocaleString(isBn ? 'bn-BD' : 'en-US')}</td>
                <td className="font-money text-right text-[12px] font-semibold">100.00%</td>
                <td className="font-money text-right text-[12px] font-semibold">{money(paidUpCapital)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="border-t border-ink-100 px-5 py-3">
            <p className="lv-kicker flex items-center gap-1.5"><ClipboardList size={12} /> {L('Capital movement', 'মূলধন চলাচল')}</p>
            <div className="mt-2 space-y-1.5">
              {[
                { label: L('Opening paid-up capital', 'প্রারম্ভিক পরিশোধিত মূলধন'), value: shareRow ? shareRow.opening_credit_poisha - shareRow.opening_debit_poisha : 0n },
                { label: L('Issue / rights in period', 'কালীন ইস্যু / রাইটস'), value: shareRow ? shareRow.period_credit_poisha : 0n },
                { label: L('Buy-back / cancellation', 'বাইব্যাক / বাতিল'), value: shareRow ? -shareRow.period_debit_poisha : 0n },
                { label: L('Closing paid-up capital', 'সমাপনী পরিশোধিত মূলধন'), value: paidUpCapital },
              ].map((line, index, all) => (
                <div key={line.label} className={`flex items-baseline justify-between gap-2 ${index === all.length - 1 ? 'border-t border-ink-200 pt-1.5' : ''}`}>
                  <span className={`text-[11px] ${index === all.length - 1 ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>{line.label}</span>
                  <span className={`font-money text-[12px] ${index === all.length - 1 ? 'font-semibold text-vault-800' : 'text-ink-700'}`}>{money(line.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lv-card overflow-hidden">
          <div className="lv-card-header">
            <div>
              <p className="lv-kicker flex items-center gap-1.5"><FileCheck2 size={12} /> {L('RJSC filings', 'আরজেএসসি দাখিল')}</p>
              <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Annual compliance calendar', 'বার্ষিক কমপ্লায়েন্স ক্যালেন্ডার')}</h2>
            </div>
            <span className="lv-chip lv-chip-gold">
              <CalendarClock size={12} /> {L('AGM by', 'এজিএমের সময়')} {formatDate('2026-12-31', locale)}
            </span>
          </div>
          <div className="divide-y divide-ink-100">
            {FILINGS.map((filing) => {
              const days = daysBetween(TODAY, filing.due);
              const filed = Boolean(filing.filed_on);
              return (
                <div key={filing.id} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${filed ? 'bg-vault-50 text-vault-700' : days < 0 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'}`}>
                    {filed ? <CheckCircle2 size={14} /> : days < 0 ? <CircleAlert size={14} /> : <CalendarClock size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-ink-900">{filing.form}</p>
                    <p className="lv-hint mt-0.5 leading-relaxed">{isBn ? filing.description_bn : filing.description_en}</p>
                    <p className="mt-1 text-[10px] text-ink-400">
                      {filed
                        ? `${L('Filed', 'দাখিল')} ${formatDate(filing.filed_on, locale)}`
                        : days < 0
                          ? `${L('Overdue by', 'বিলম্ব')} ${Math.abs(days)} ${L('days', 'দিন')}`
                          : `${L('Due in', 'বাকি')} ${days} ${L('days', 'দিন')}`}
                      {filing.fee_poisha > 0n ? ` · ${L('fee', 'ফি')} ${money(filing.fee_poisha)}` : ''}
                    </p>
                  </div>
                  <span className={`lv-chip ${filed ? 'lv-chip-emerald' : days < 0 ? 'lv-chip-rose' : 'lv-chip-gold'}`}>
                    {filed ? L('Filed', 'দাখিল') : days < 0 ? L('Overdue', 'বিলম্বিত') : L('Upcoming', 'আসন্ন')}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Stamp size={12} /> {L('Licence renewal tracker', 'লাইসেন্স নবায়ন ট্র্যাকার')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Trade · Fire · Environment · DIFE', 'ট্রেড · ফায়ার · পরিবেশ · ডিআইএফই')}</h2>
            <p className="lv-hint mt-1">
              {licenceSummary.valid} {L('valid', 'বৈধ')} · {licenceSummary.expiring.length} {L('expiring', 'মেয়াদোন্নত')} · {licenceSummary.expired.length} {L('expired', 'মেয়াদোত্তীর্ণ')} ·{' '}
              {L('renewal fees', 'নবায়ন ফি')} {money(licenceSummary.fees)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'EXPIRING', 'EXPIRED'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setLicenceFilter(filter)}
                className={`lv-chip ${licenceFilter === filter ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}
              >
                {filter === 'ALL' ? L('All', 'সব') : filter === 'EXPIRING' ? L('Expiring', 'মেয়াদোন্নত') : L('Expired', 'মেয়াদোত্তীর্ণ')}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="lv-table min-w-[860px]">
            <thead>
              <tr>
                <th>{L('Licence', 'লাইসেন্স')}</th>
                <th>{L('Authority', 'কর্তৃপক্ষ')}</th>
                <th>{L('Number', 'নম্বর')}</th>
                <th>{L('Expiry', 'মেয়াদ')}</th>
                <th className="text-right">{L('Fee', 'ফি')}</th>
                <th>{L('Status', 'অবস্থা')}</th>
                <th className="text-right">{L('Action', 'কার্যক্রম')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleLicences.map(({ record, days, status, icon: Icon }) => {
                const renewed = renewals.has(record.id);
                return (
                  <tr key={record.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Icon size={13} className="text-vault-600" />
                        <span className="text-[12px] font-medium text-ink-900">{isBn ? record.title_bn : record.title_en}</span>
                      </div>
                    </td>
                    <td className="text-[11px] text-ink-600">{record.authority}</td>
                    <td className="font-mono text-[10px] text-ink-500">{record.reference}</td>
                    <td>
                      <p className="text-[11px] text-ink-800">{formatDate(record.due_or_expiry, locale)}</p>
                      <p className={`text-[10px] ${days < 0 ? 'text-rose-600' : days <= EXPIRING_WINDOW_DAYS ? 'text-amber-700' : 'text-ink-400'}`}>
                        {days < 0 ? `${Math.abs(days)} ${L('days late', 'দিন বিলম্ব')}` : `${days} ${L('days left', 'দিন বাকি')}`}
                      </p>
                    </td>
                    <td className="font-money text-right text-[12px]">{money(record.amount_poisha)}</td>
                    <td>
                      <span className={`lv-chip ${renewed ? 'lv-chip-emerald' : status === 'EXPIRED' ? 'lv-chip-rose' : status === 'EXPIRING' ? 'lv-chip-gold' : 'lv-chip-emerald'}`}>
                        {renewed ? L('Renewal filed', 'নবায়ন দাখিল') : status}
                      </span>
                    </td>
                    <td className="text-right">
                      {renewed ? (
                        <span className="text-[10px] text-vault-700">{L('Awaiting certificate', 'সনদের অপেক্ষায়')}</span>
                      ) : (
                        <button
                          type="button"
                          className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]"
                          onClick={() => requestRenewal(record.id, isBn ? record.title_bn : record.title_en)}
                        >
                          <RefreshCcw size={12} /> {L('Renew', 'নবায়ন')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleLicences.length === 0 && (
          <p className="px-5 py-6 text-center text-sm text-ink-500">
            {L('No licence matches this filter.', 'এই ফিল্টারে কোনো লাইসেন্স নেই।')}
          </p>
        )}

        <div className="grid gap-2 border-t border-ink-100 px-5 py-3 sm:grid-cols-3">
          {[
            { label: L('Trade licence', 'ট্রেড লাইসেন্স'), icon: Stamp },
            { label: L('Fire & civil defence', 'ফায়ার ও সিভিল ডিফেন্স'), icon: Flame },
            { label: L('Environment clearance', 'পরিবেশ ছাড়পত্র'), icon: Leaf },
          ].map((entry) => (
            <p key={entry.label} className="flex items-center gap-1.5 text-[10px] text-ink-500">
              <entry.icon size={11} className="text-vault-600" /> {entry.label} · {L('renew before expiry to avoid trade suspension', 'কার্যক্রম স্থগিত এড়াতে মেয়াদের আগে নবায়ন করুন')}
            </p>
          ))}
        </div>
      </section>

      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><MailWarning size={12} /> {L('NBR notices & appeals', 'এনবিআর নোটিশ ও আপিল')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">{L('Tax notice and appeals manager', 'কর নোটিশ ও আপিল ব্যবস্থাপক')}</h2>
            <p className="lv-hint mt-1">
              {openNotices.length} {L('open', 'খোলা')} · {highRiskOpen.length} {L('high risk', 'উচ্চ ঝুঁকি')} · {L('response dates tracked against the statutory clock', 'জবাবের তারিখ বিধিবদ্ধ সময় অনুযায়ী')}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={`lv-chip ${highRiskOpen.length ? 'lv-chip-rose' : 'lv-chip-emerald'}`}>
              <Gavel size={12} /> {notices.length} {L('notices on file', 'নোটিশ নথিতে')}
            </span>
            <button type="button" className="lv-btn lv-btn-primary !px-2.5 !py-1.5 text-[11px]" onClick={() => setLogOpen(true)}>
              <Plus size={13} /> {L('Log notice', 'নোটিশ নথিভুক্ত')}
            </button>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="divide-y divide-ink-100 border-b border-ink-100 lg:border-b-0 lg:border-r">
            {notices.map((notice) => {
              const workflow = noticeWorkflow[notice.id];
              const status = workflow?.status ?? noticeLifecycle(notice.status);
              const days = daysBetween(TODAY, notice.due_or_expiry);
              const selected = selectedNotice?.id === notice.id;
              return (
                <button
                  key={notice.id}
                  type="button"
                  onClick={() => setSelectedNoticeId(notice.id)}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left transition ${selected ? 'bg-vault-50' : 'hover:bg-ink-50'}`}
                >
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${notice.risk === 'HIGH' ? 'bg-rose-50 text-rose-600' : notice.risk === 'MEDIUM' ? 'bg-amber-50 text-amber-700' : 'bg-ink-100 text-ink-500'}`}>
                    <MailWarning size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-ink-900">{isBn ? notice.title_bn : notice.title_en}</span>
                      <span className={`lv-chip ${RISK_TONE[notice.risk]} shrink-0 !px-1.5 !py-0 text-[9px]`}>{notice.risk}</span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-400">{notice.reference} · {notice.authority}</span>
                    <span className={`mt-0.5 block text-[10px] ${days < 0 ? 'text-rose-600' : 'text-ink-500'}`}>
                      {days < 0
                        ? `${L('Overdue by', 'বিলম্ব')} ${Math.abs(days)} ${L('days', 'দিন')}`
                        : `${L('Respond in', 'জবাব')} ${days} ${L('days', 'দিন')}`}
                    </span>
                  </span>
                  <span className={`lv-chip shrink-0 ${status === 'CLOSED' ? 'lv-chip-neutral' : status === 'RESPONDED' ? 'lv-chip-emerald' : 'lv-chip-gold'}`}>{status}</span>
                </button>
              );
            })}
          </div>

          <div className="px-5 py-4">
            {selectedNotice && selectedWorkflow ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-vault-600">{selectedNotice.reference}</p>
                  <span className={`lv-chip ${RISK_TONE[selectedNotice.risk]}`}>{selectedNotice.risk} {L('risk', 'ঝুঁকি')}</span>
                </div>
                <h3 className="mt-1 text-sm font-semibold text-ink-900">{isBn ? selectedNotice.title_bn : selectedNotice.title_en}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{isBn ? selectedNotice.notes_bn : selectedNotice.notes_en}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="lv-kicker">{L('Received', 'প্রাপ্তি')}</p>
                    <p className="text-[11px] text-ink-800">{formatDate(selectedNotice.issued_date, locale)}</p>
                  </div>
                  <div>
                    <p className="lv-kicker">{L('Response due', 'জবাবের তারিখ')}</p>
                    <p className="text-[11px] text-ink-800">{formatDate(selectedNotice.due_or_expiry, locale)}</p>
                  </div>
                  <div>
                    <p className="lv-kicker">{L('Amount at stake', 'বিতর্কিত পরিমাণ')}</p>
                    <p className="font-money text-[11px] text-ink-800">{money(selectedNotice.amount_poisha)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="lv-kicker flex items-center gap-1.5"><Gavel size={11} /> {L('Appeal route', 'আপিল পথ')}</p>
                  <ol className="mt-2 space-y-1.5">
                    {appealStages.map((stage, index) => {
                      const done = index <= selectedWorkflow.stage;
                      const current = index === selectedWorkflow.stage;
                      return (
                        <li key={stage.en} className="flex items-start gap-2">
                          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold ${done ? 'bg-vault-700 text-white' : 'bg-ink-100 text-ink-400'}`}>
                            {done ? <CheckCircle2 size={11} /> : index + 1}
                          </span>
                          <span className={`text-[11px] ${current ? 'font-semibold text-ink-900' : done ? 'text-ink-700' : 'text-ink-400'}`}>
                            {isBn ? stage.bn : stage.en}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <label className="mt-4 block">
                  <span className="lv-kicker">{L('Response draft', 'জবাবের খসড়া')}</span>
                  <textarea
                    value={selectedWorkflow.draft}
                    onChange={(event) => setDraft(selectedNotice, event.target.value)}
                    rows={3}
                    placeholder={L(
                      'Reference the register extracts, challans and evidence attached to the reply…',
                      'জবাবে সংযুক্ত রেজিস্টার নির্যাস, চালান ও প্রমাণ উল্লেখ করুন…',
                    )}
                    className="lv-input mt-1 w-full text-[11px]"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="lv-btn lv-btn-primary !px-2 !py-1 text-[11px]"
                    onClick={() => updateNotice(selectedNotice, { status: 'RESPONDED', stage: 1 }, L('Response marked filed', 'জবাব দাখিল চিহ্নিত'))}
                  >
                    <Send size={12} /> {L('Mark responded', 'জবাব দাখিল')}
                  </button>
                  <button
                    type="button"
                    className="lv-btn lv-btn-secondary !px-2 !py-1 text-[11px]"
                    onClick={() => updateNotice(selectedNotice, { stage: 2 }, L('Escalated to Commissioner (Appeals)', 'কমিশনার (আপিল)-এ উত্তোলিত'))}
                  >
                    <Gavel size={12} /> {L('Escalate appeal', 'আপিল উত্তোলন')}
                  </button>
                  <button
                    type="button"
                    className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]"
                    onClick={() => updateNotice(selectedNotice, { status: 'CLOSED', stage: 3 }, L('Notice closed', 'নোটিশ নিষ্পত্তি'))}
                  >
                    <Lock size={12} /> {L('Close notice', 'নোটিশ বন্ধ')}
                  </button>
                  <button
                    type="button"
                    className="lv-btn lv-btn-secondary !px-2 !py-1 text-[11px]"
                    onClick={() => setPackOpen(true)}
                  >
                    <FileDown size={12} /> {L('Generate response pack', 'জবাব প্যাক তৈরি')}
                  </button>
                </div>

                <p className="mt-3 border-t border-ink-100 pt-2 text-[10px] leading-relaxed text-ink-400">
                  {L(
                    'Workflow state is held in this session only. Filing with NBR, RJSC or the appellate tribunal happens outside LedgerVault.',
                    'কার্যপ্রবাহ অবস্থা শুধু এই সেশনে থাকে। এনবিআর, আরজেএসসি বা আপিল ট্রাইব্যুনালে দাখিল লেজারভল্টের বাইরে সম্পন্ন হয়।',
                  )}
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-ink-500">{L('No notice on file.', 'নথিতে কোনো নোটিশ নেই।')}</p>
            )}
          </div>
        </div>
      </section>

      {logOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-950/50 p-4" role="dialog" aria-modal="true">
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="lv-kicker flex items-center gap-1.5 text-vault-700"><Plus size={12} /> {L('Statutory notice log', 'বিধিবদ্ধ নোটিশ নিবন্ধন')}</p>
                <h3 className="mt-1 text-sm font-semibold text-ink-900">{L('Log an NBR notice or appeal', 'এনবিআর নোটিশ বা আপিল নথিভুক্ত করুন')}</h3>
              </div>
              <button type="button" className="rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700" onClick={() => setLogOpen(false)} aria-label={L('Close', 'বন্ধ')}>
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="lv-kicker">{L('Notice reference', 'নোটিশ নম্বর')}</span>
                <input value={logForm.reference} onChange={(event) => setLogForm((current) => ({ ...current, reference: event.target.value }))} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
              <label className="block">
                <span className="lv-kicker">{L('Authority', 'কর্তৃপক্ষ')}</span>
                <input value={logForm.authority} onChange={(event) => setLogForm((current) => ({ ...current, authority: event.target.value }))} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
              <label className="block sm:col-span-2">
                <span className="lv-kicker">{L('Subject', 'বিষয়')}</span>
                <input value={logForm.title_en} onChange={(event) => setLogForm((current) => ({ ...current, title_en: event.target.value }))} placeholder={L('e.g. Mushak 9.1 reconciliation query for October 2026', 'যেমন: অক্টোবর ২০২৬-এর মূসক ৯.১ মিলন জিজ্ঞাসা')} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
              <label className="block sm:col-span-2">
                <span className="lv-kicker">{L('Subject (Bangla)', 'বিষয় (বাংলা)')}</span>
                <input value={logForm.title_bn} onChange={(event) => setLogForm((current) => ({ ...current, title_bn: event.target.value }))} className="lv-input mt-0.5 w-full font-bangla text-[11px]" />
              </label>
              <label className="block">
                <span className="lv-kicker">{L('Received', 'প্রাপ্তি')}</span>
                <input type="date" value={logForm.received} onChange={(event) => setLogForm((current) => ({ ...current, received: event.target.value }))} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
              <label className="block">
                <span className="lv-kicker">{L('Response due', 'জবাবের তারিখ')}</span>
                <input type="date" value={logForm.due} onChange={(event) => setLogForm((current) => ({ ...current, due: event.target.value }))} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
              <label className="block">
                <span className="lv-kicker">{L('Risk', 'ঝুঁকি')}</span>
                <select value={logForm.risk} onChange={(event) => setLogForm((current) => ({ ...current, risk: event.target.value as Notice['risk'] }))} className="lv-input mt-0.5 w-full text-[11px]">
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </label>
              <label className="block">
                <span className="lv-kicker">{L('Amount at stake (BDT)', 'বিতর্কিত পরিমাণ (টাকা)')}</span>
                <input value={logForm.amount} onChange={(event) => setLogForm((current) => ({ ...current, amount: event.target.value }))} inputMode="decimal" className="lv-input mt-0.5 w-full font-mono text-[11px]" />
              </label>
              <label className="block sm:col-span-2">
                <span className="lv-kicker">{L('Notes', 'মন্তব্য')}</span>
                <textarea value={logForm.notes} onChange={(event) => setLogForm((current) => ({ ...current, notes: event.target.value }))} rows={2} className="lv-input mt-0.5 w-full text-[11px]" />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" className="lv-btn lv-btn-ghost" onClick={() => setLogOpen(false)}>{L('Cancel', 'বাতিল')}</button>
              <button type="button" className="lv-btn lv-btn-primary" onClick={logNotice}>
                <Plus size={14} /> {L('Save to statutory register', 'বিধিবদ্ধ নিবন্ধনে সংরক্ষণ')}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
              {L(
                'The register entry is held in this session. It feeds the response-clock badges and the response-pack generator immediately.',
                'নিবন্ধন এন্ট্রি এই সেশনে থাকে। এটি তাৎক্ষণিকভাবে জবাব-সময়সীমা ব্যাজ ও জবাব-প্যাক জেনারেটরে যুক্ত হয়।',
              )}
            </p>
          </div>
        </div>
      )}

      {packOpen && selectedNotice && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-950/50 p-4" role="dialog" aria-modal="true">
          <div className="my-8 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="lv-kicker flex items-center gap-1.5 text-vault-700"><FileDown size={12} /> {L('Response pack generator', 'জবাব প্যাক জেনারেটর')}</p>
                <h3 className="mt-1 text-sm font-semibold text-ink-900">{selectedNotice.reference}</h3>
                <p className="mt-0.5 text-[10px] text-ink-500">
                  {isBn ? selectedNotice.title_bn : selectedNotice.title_en} · {L('due', 'জবাবের তারিখ')} {formatDate(selectedNotice.due_or_expiry, locale)}
                </p>
              </div>
              <button type="button" className="rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700" onClick={() => setPackOpen(false)} aria-label={L('Close', 'বন্ধ')}>
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 max-h-[52vh] overflow-y-auto rounded-xl border border-ink-100">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th className="w-64">{L('Section', 'অংশ')}</th>
                    <th>{L('Evidence assembled from the live ledger', 'লাইভ খতিয়ান থেকে সংকলিত প্রমাণ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {packSections.map((section) => (
                    <tr key={section.title_en}>
                      <td className="align-top text-[11px] font-semibold text-ink-800">
                        <span className="flex items-start gap-1.5"><FileText size={11} className="mt-0.5 shrink-0 text-vault-600" />{isBn ? section.title_bn : section.title_en}</span>
                      </td>
                      <td className="text-[11px] leading-relaxed text-ink-600">{isBn ? section.body_bn : section.body_en}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] leading-relaxed text-ink-400">
                {L(
                  'Downloads a print-ready HTML pack. Filing with NBR, RJSC or the appellate tribunal happens outside LedgerVault.',
                  'প্রিন্ট-উপযোগী এইচটিএমএল প্যাক ডাউনলোড করে। এনবিআর, আরজেএসসি বা আপিল ট্রাইব্যুনালে দাখিল লেজারভল্টের বাইরে সম্পন্ন হয়।',
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" className="lv-btn lv-btn-ghost" onClick={() => setPackOpen(false)}>{L('Close', 'বন্ধ')}</button>
                <button type="button" className="lv-btn lv-btn-primary" onClick={downloadResponsePack}>
                  <Download size={14} /> {L('Download response pack', 'জবাব প্যাক ডাউনলোড')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="px-1 text-[10px] text-ink-400">
        {L('Next RJSC window', 'পরবর্তী আরজেএসসি সময়সীমা')}: {formatDate(addDays('2026-11-01', 60), locale)} ·{' '}
        {L('secretarial documents are decision support, not a substitute for professional sign-off.', 'সচিবালয় নথি সিদ্ধান্ত সহায়তা, পেশাদার সম্মতির বিকল্প নয়।')}
      </p>
    </div>
  );
}
