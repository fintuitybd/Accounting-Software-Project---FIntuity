// LedgerVault — Signature component #4: the statutory A4 print pack.
//
// Four pixel-faithful, print-ready documents, all derived from the live ledger rather than from
// hand-typed numbers:
//
//   (a) Mushak 6.3  — কর চালানপত্র / Tax Invoice: the 11 statutory columns, both BINs, vehicle no.,
//                     destination and the Taka-in-words line in English and Bangla.
//   (b) Mushak 6.6  — ভ্যাট উৎসে কর্তন সনদ / VDS Withholding Certificate with the treasury challan,
//                     economic code and the 4.5% withholding computation.
//   (c) Mushak 9.1  — Monthly VAT Return summary across all twelve parts plus the GL-vs-return
//                     reconciliation proof.
//   (d) IAS 1 / IFRS 18 — audited financial statements pack: audit opinion, Statement of Financial
//                     Position, Statement of Profit or Loss (IFRS 18 categories + MPM EBITDA),
//                     Statement of Changes in Equity, IAS 7 Cash Flows, Notes and the Trial Balance.
//
// The chrome (mode switcher, print button) carries `.lv-print-chrome` and disappears on paper; the
// sheet itself carries `.lv-print-sheet` and owns the A4 geometry. Pages are hard-broken with
// `page-break-after`, so the pack prints 1:1 with the statutory forms.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FileCheck2,
  Landmark,
  Printer,
  ReceiptText,
  ScrollText,
  Stamp,
  X,
} from 'lucide-react';
import { useVault } from '../../context/VaultContext';
import { addDays, takaInWords } from '../../core/money';
import { accountBalance } from '../../core/ledger/ledgerEngine';
import { JamdaniWatermarkSvg } from '../svg/VaultVisuals';
import type {
  BinUnit,
  Challan,
  CommercialDoc,
  FinancialStatements,
  Mushak91Part,
  Party,
  StatementSection,
  TaxCategory,
  TenantEntity,
  VdsCertificate,
} from '../../core/types';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type StatutoryDocMode = 'MUSHAK_6_3' | 'MUSHAK_6_6' | 'MUSHAK_9_1' | 'IFRS_PACK';

export interface StatutoryPrintModalProps {
  open?: boolean;
  onClose: () => void;
  mode?: StatutoryDocMode;
  initialMode?: StatutoryDocMode;
  doc?: CommercialDoc | null;
  certificate?: VdsCertificate | null;
  periodCode?: string;
  onModeChange?: (mode: StatutoryDocMode) => void;
  className?: string;
}

interface SheetContext {
  tenant: TenantEntity;
  binUnit: BinUnit | null;
  party: Party | null;
  money: (poisha: bigint, options?: { sign?: boolean; symbol?: boolean }) => string;
  label: (en: string, bn: string) => string;
  isBn: boolean;
  today: string;
}

interface CatalogRow {
  sku?: string;
  unit_en?: string;
  unit_bn?: string;
}

const MODES: Array<{ id: StatutoryDocMode; labelEn: string; labelBn: string; icon: ReactNode }> = [
  { id: 'MUSHAK_6_3', labelEn: 'Mushak 6.3', labelBn: 'মূসক ৬.৩', icon: <ReceiptText size={12} /> },
  { id: 'MUSHAK_6_6', labelEn: 'Mushak 6.6', labelBn: 'মূসক ৬.৬', icon: <Stamp size={12} /> },
  { id: 'MUSHAK_9_1', labelEn: 'Mushak 9.1', labelBn: 'মূসক ৯.১', icon: <ScrollText size={12} /> },
  { id: 'IFRS_PACK', labelEn: 'IFRS pack', labelBn: 'আইএফআরএস প্যাক', icon: <FileCheck2 size={12} /> },
];

const VAT_RATE_BPS: Record<TaxCategory, number> = {
  STANDARD_15: 1500,
  TRADING_5: 500,
  PROCUREMENT_7_5: 750,
  EXPORT_ZERO: 0,
  EXEMPT: 0,
  REVERSE_CHARGE: 1500,
  OUT_OF_SCOPE: 0,
};

const PAYMENT_LABEL: Record<string, { en: string; bn: string }> = {
  BANK: { en: 'Bank transfer', bn: 'ব্যাংক ট্রান্সফার' },
  MFS: { en: 'Mobile financial service', bn: 'মোবাইল আর্থিক সেবা' },
  CASH: { en: 'Cash', bn: 'নগদ' },
  CHEQUE: { en: 'Cheque', bn: 'চেক' },
  CREDIT_CARD: { en: 'Credit card', bn: 'ক্রেডিট কার্ড' },
};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function ratePercent(bps: number): string {
  if (bps === 0) return '0%';
  const value = bps / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

/** Half-up VAT on an integer poisha amount — never floating point. */
function vatOn(value: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  const scaled = value * BigInt(bps);
  return (scaled + 5000n) / 10000n;
}

function periodEndOf(period: string): string {
  const parts = period.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return new Date().toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month, 0));
  return end.toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  if (iso.length >= 16) return iso.slice(11, 16);
  return '—';
}

function sumPoisha<T>(rows: T[], pick: (row: T) => bigint): bigint {
  return rows.reduce((total, row) => total + pick(row), 0n);
}

// ---------------------------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------------------------

export function StatutoryPrintModal({
  open,
  onClose,
  mode: modeProp,
  initialMode = 'MUSHAK_6_3',
  doc,
  certificate,
  periodCode,
  onModeChange,
  className = '',
}: StatutoryPrintModalProps) {
  const vault = useVault();
  const { money, locale, tenant, parties, items, periods, challans, commercialDocs } = vault;
  const isBn = locale === 'bn-BD';
  const label = (en: string, bn: string): string => (isBn ? bn : en);

  const [activeMode, setActiveMode] = useState<StatutoryDocMode>(modeProp ?? initialMode);
  const isOpen = open ?? true;

  useEffect(() => {
    if (modeProp) setActiveMode(modeProp);
  }, [modeProp]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [isOpen, onClose]);

  const docs = commercialDocs as unknown as CommercialDoc[];

  const fallbackDoc = useMemo(() => {
    const invoices = docs.filter((entry) => entry.doc_type === 'SALES_INVOICE');
    if (invoices.length > 0) return invoices[invoices.length - 1];
    return docs.length > 0 ? docs[docs.length - 1] : null;
  }, [docs]);

  const activeDoc = doc ?? fallbackDoc;

  const party = useMemo(() => {
    if (!activeDoc) return null;
    return parties.find((entry) => entry.id === activeDoc.party_id) ?? null;
  }, [parties, activeDoc]);

  const binUnit = useMemo(() => {
    const id = activeDoc?.bin_unit_id;
    const matched = id ? tenant.bin_units.find((unit) => unit.id === id) : undefined;
    return matched ?? tenant.bin_units.find((unit) => unit.is_principal) ?? tenant.bin_units[0] ?? null;
  }, [tenant.bin_units, activeDoc]);

  const activeCertificate = useMemo(() => {
    if (certificate) return certificate;
    const issued = vault.vdsCertificates.filter((entry) => entry.direction === 'ISSUED');
    if (issued.length > 0) return issued[issued.length - 1];
    return vault.vdsCertificates.length > 0
      ? vault.vdsCertificates[vault.vdsCertificates.length - 1]
      : null;
  }, [certificate, vault.vdsCertificates]);

  const certificateParty = useMemo(() => {
    if (!activeCertificate) return party;
    return parties.find((entry) => entry.id === activeCertificate.party_id) ?? party;
  }, [parties, activeCertificate, party]);

  const activePeriod = useMemo(() => {
    if (periodCode) return periodCode;
    if (activeDoc) return activeDoc.doc_date.slice(0, 7);
    const latest = periods.slice().sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
    return latest ? latest.code : new Date().toISOString().slice(0, 7);
  }, [periodCode, activeDoc, periods]);

  const catalog = items as unknown as CatalogRow[];
  const statements = vault.statements as unknown as FinancialStatements;

  const sheetCtx: SheetContext = {
    tenant,
    binUnit,
    party,
    money,
    label,
    isBn,
    today: new Date().toISOString().slice(0, 10),
  };

  const handleMode = (next: StatutoryDocMode) => {
    setActiveMode(next);
    if (onModeChange) onModeChange(next);
  };

  if (!isOpen) return null;

  const content = (
    <div
      className="lv-print-overlay fixed inset-0 z-50 flex flex-col bg-ink-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label('Statutory documents', 'সংবিধিবদ্ধ ডকুমেন্ট')}
    >
      <style>{PRINT_CSS}</style>

      {/* ------------------------------------------------------------------------------ */}
      {/* Toolbar (never printed)                                                         */}
      {/* ------------------------------------------------------------------------------ */}
      <div className="lv-print-chrome flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-vault-950 px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
            aria-label={label('Back', 'ফিরে যান')}
          >
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold">
              {label('Statutory A4 print pack', 'সংবিধিবদ্ধ এ৪ প্রিন্ট প্যাক')}
            </p>
            <p className="text-[10px] text-vault-300">
              {label('210 × 297 mm · letter-exact replica', '২১০ × ২৯৭ মিমি · হুবহু প্রতিরূপ')}
            </p>
          </div>
        </div>

        <div className="lv-seg !border-white/15 !bg-white/5">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleMode(entry.id)}
              data-active={activeMode === entry.id ? 'true' : 'false'}
              className={`lv-seg-item ${
                activeMode === entry.id ? '!bg-gold-400 !text-vault-950' : '!text-vault-200 hover:!text-white'
              }`}
            >
              {entry.icon}
              <span className="hidden sm:inline">{isBn ? entry.labelBn : entry.labelEn}</span>
              <span className="sm:hidden">{entry.id.replace('MUSHAK_', 'M').replace('IFRS_PACK', 'IFRS')}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            title="window.print()"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gold-400 px-3 py-1.5 text-[12px] font-semibold text-vault-950 transition hover:bg-gold-300"
          >
            <Printer size={13} />
            {label('Print / Save as PDF', 'প্রিন্ট / পিডিএফ')}
            <span className="hidden font-mono text-[9px] font-normal opacity-70 lg:inline">window.print()</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 p-1.5 text-vault-100 ring-1 ring-white/15 transition hover:bg-white/20"
            aria-label={label('Close', 'বন্ধ করুন')}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------------------ */}
      {/* Sheet viewport                                                                  */}
      {/* ------------------------------------------------------------------------------ */}
      <div className="lv-print-scroll min-h-0 flex-1 overflow-auto bg-ink-200/70 px-3 py-6">
        <div className="lv-print-shell mx-auto w-fit max-w-full space-y-6">
          {activeMode === 'MUSHAK_6_3' ? (
            activeDoc ? (
              <Mushak63Sheet ctx={sheetCtx} doc={activeDoc} catalog={catalog} />
            ) : (
              <EmptySheet ctx={sheetCtx} title="Mushak 6.3" note={label('No sales invoice in the ledger yet.', 'লেজারে এখনো কোনো বিক্রয় চালান নেই।')} />
            )
          ) : null}

          {activeMode === 'MUSHAK_6_6' ? (
            activeCertificate ? (
              <Mushak66Sheet
                ctx={sheetCtx}
                certificate={activeCertificate}
                party={certificateParty}
                challan={challans.find((entry) => entry.id === activeCertificate.challan_id) ?? null}
                doc={docs.find((entry) => entry.doc_number === activeCertificate.related_doc_ref) ?? activeDoc}
              />
            ) : (
              <EmptySheet ctx={sheetCtx} title="Mushak 6.6" note={label('No VDS certificate issued yet.', 'এখনো কোনো ভিডিএস সনদ ইস্যু হয়নি।')} />
            )
          ) : null}

          {activeMode === 'MUSHAK_9_1' ? (
            <Mushak91Sheets
              ctx={sheetCtx}
              docs={docs}
              period={activePeriod}
              statements={statements}
              cashLimit={tenant.accounting_policies.cash_disallowance_limit_poisha}
              journals={vault.journals}
              certificates={vault.vdsCertificates}
            />
          ) : null}

          {activeMode === 'IFRS_PACK' ? <IfrsSheets ctx={sheetCtx} statements={statements} /> : null}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ---------------------------------------------------------------------------------------------
// Print CSS — scoped to this modal, so the app shell never leaks onto paper.
// ---------------------------------------------------------------------------------------------

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body { background: #ffffff !important; }
  #root { display: none !important; }
  .lv-print-overlay {
    position: static !important; inset: auto !important; display: block !important;
    background: #ffffff !important; padding: 0 !important; backdrop-filter: none !important;
  }
  .lv-print-shell { width: auto !important; max-width: none !important; display: block !important; }
  .lv-print-chrome { display: none !important; }
  .lv-print-scroll {
    overflow: visible !important; padding: 0 !important; margin: 0 !important;
    background: #ffffff !important;
  }
  .lv-print-sheet {
    width: auto !important; min-height: 0 !important; margin: 0 !important;
    padding: 0 !important; border: 0 !important; border-radius: 0 !important;
    box-shadow: none !important; page-break-after: always; break-after: page;
  }
  .lv-print-sheet:last-child { page-break-after: auto; break-after: auto; }
  .lv-print-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lv-print-sheet table { page-break-inside: auto; }
  .lv-print-sheet tr { page-break-inside: avoid; }
}
`;

// ---------------------------------------------------------------------------------------------
// Sheet chrome
// ---------------------------------------------------------------------------------------------

function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <div className="lv-print-sheet relative mx-auto min-h-[297mm] w-full max-w-[210mm] border border-black/15 bg-white p-8 text-black shadow-2xl">
      <JamdaniWatermarkSvg
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
        opacity={0.05}
        tone="ink"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

function NationalHeader({ sub }: { sub: string }) {
  return (
    <div className="border-b-[3px] border-double border-black pb-2 text-center">
      <p className="font-bangla text-[10pt] font-bold leading-tight">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
      <p className="text-[8pt] font-semibold leading-tight">Government of the People&apos;s Republic of Bangladesh</p>
      <div className="mt-0.5 flex items-center justify-center gap-1.5">
        <Landmark size={11} />
        <p className="font-bangla text-[8.5pt] font-bold leading-tight">জাতীয় রাজস্ব বোর্ড, ঢাকা</p>
      </div>
      <p className="text-[6.5pt] uppercase tracking-[0.22em] leading-tight">National Board of Revenue, Dhaka</p>
      <p className="mt-1 border-t border-black/30 pt-1 font-bangla text-[7pt] uppercase tracking-[0.1em] text-black/70">
        {sub}
      </p>
    </div>
  );
}

function FormCodeBadge({ bn, en }: { bn: string; en: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-black font-bangla text-[11pt] font-bold leading-none">
        {bn}
      </span>
      <div>
        <p className="text-[8pt] font-bold uppercase tracking-[0.12em]"> {en}</p>
        <p className="text-[6.5pt] text-black/55">National Board of Revenue · prescribed form</p>
      </div>
    </div>
  );
}

function EmptySheet({ ctx, title, note }: { ctx: SheetContext; title: string; note: string }) {
  return (
    <PrintSheet>
      <NationalHeader sub={title} />
      <div className="mt-16 flex flex-col items-center gap-2 text-center">
        <Building2 size={26} className="text-black/30" />
        <p className="text-[11pt] font-semibold">{title}</p>
        <p className="max-w-[110mm] text-[9pt] text-black/60">{note}</p>
        <p className="mt-4 text-[8pt] text-black/40">{ctx.tenant.name_en}</p>
      </div>
    </PrintSheet>
  );
}

function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 border-b border-dotted border-black/40 py-[1.5px]">
      <span className="shrink-0 text-[7.5pt] text-black/60">{label}</span>
      <span className={`ml-auto text-right text-[8pt] ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function SignBlocks({ ctx }: { ctx: SheetContext }) {
  const blocks = [
    { bn: 'চালান ইস্যুকারীর স্বাক্ষর ও সিল', en: 'Signature & seal of issuer' },
    { bn: 'পণ্য/সেবা গ্রহণকারীর স্বাক্ষর ও সিল', en: 'Signature & seal of recipient' },
    { bn: 'অনুমোদিত কর্মকর্তা / হিসাবরক্ষক', en: 'Authorised officer / accountant' },
  ];
  return (
    <div className="mt-6 grid grid-cols-3 gap-5 text-[7pt]">
      {blocks.map((block) => (
        <div key={block.en}>
          <div className="h-9 border-b border-dotted border-black" />
          <p className="mt-1 font-bangla leading-tight">{block.bn}</p>
          <p className="leading-tight text-black/60">{block.en}</p>
          <p className="mt-1 text-[7pt] text-black/50">
            {ctx.label('Date', 'তারিখ')}: {ctx.today}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (a) Mushak 6.3 — Tax Invoice
// ---------------------------------------------------------------------------------------------

function Mushak63Sheet({
  ctx,
  doc,
  catalog,
}: {
  ctx: SheetContext;
  doc: CommercialDoc;
  catalog: CatalogRow[];
}) {
  const { money, label, isBn, tenant, binUnit, party } = ctx;
  const rateBps = VAT_RATE_BPS[doc.tax_category] ?? 0;

  const lines = doc.lines.map((line, index) => {
    const value = BigInt(Math.round(line.quantity * Number(line.unit_price_poisha)));
    return { line, index, value };
  });

  const baseSum = lines.reduce((total, entry) => total + entry.value, 0n);

  // Distribute the document-level VAT across lines so the column totals tie exactly to the
  // posted journal, with the rounding difference absorbed by the last row.
  const vatRows: bigint[] = [];
  let allocated = 0n;
  lines.forEach((entry, index) => {
    if (index === lines.length - 1) {
      vatRows.push(doc.vat_poisha - allocated);
    } else {
      const share = vatOn(entry.value, rateBps);
      allocated += share;
      vatRows.push(share);
    }
  });

  const unitOf = (sku: string): string => {
    const row = catalog.find((entry) => entry.sku === sku);
    if (!row) return '—';
    return isBn ? row.unit_bn ?? row.unit_en ?? '—' : row.unit_en ?? row.unit_bn ?? '—';
  };

  const sellerBin = binUnit ? binUnit.bin_number : tenant.tin_number;
  const buyerBin = party?.bin ?? doc.party_bin ?? '';

  return (
    <PrintSheet>
      <NationalHeader sub="মূসক আইন, ২০১২ · Value Added Tax and Supplementary Duty Act, 2012" />

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <FormCodeBadge bn="৬.৩" en="Mushak 6.3 — Tax Invoice" />
          <p className="mt-1.5 font-bangla text-[10pt] font-bold leading-tight">কর চালানপত্র / Tax Invoice</p>
          <p className="text-[7pt] text-black/60">
            Issued under Rule 40 of the VAT and Supplementary Duty Rules, 2016 · Section 66, VAT &amp; SD Act 2012
          </p>
        </div>
        <div className="border border-black px-2.5 py-1.5 text-right">
          <p className="text-[6.5pt] uppercase tracking-[0.12em] text-black/60">Business Identification No.</p>
          <p className="font-mono text-[10pt] font-bold leading-tight">{sellerBin}</p>
          <p className="text-[6.5pt] text-black/60">{binUnit?.unit_name_en ?? tenant.trade_name}</p>
        </div>
      </div>

      {/* Seller / Buyer */}
      <div className="mt-2 grid grid-cols-2 gap-0 border border-black">
        <div className="border-r border-black p-2">
          <p className="mb-1 text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Issuer — name, address & BIN', 'ইস্যুকারী — নাম, ঠিকানা ও বিআইএন')}
          </p>
          <p className="text-[9pt] font-semibold leading-tight">{tenant.name_en}</p>
          <p className="font-bangla text-[7.5pt] leading-tight">{tenant.name_bn}</p>
          <p className="mt-0.5 text-[7pt] leading-tight">{binUnit?.address ?? tenant.address_en}</p>
          <p className="mt-0.5 font-mono text-[7.5pt]">
            BIN {sellerBin} · TIN {tenant.tin_number}
          </p>
          <p className="text-[7pt] text-black/60">RJSC {tenant.rjsc_reg_no}</p>
        </div>
        <div className="p-2">
          <p className="mb-1 text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Recipient — name, address & BIN', 'গ্রহণকারী — নাম, ঠিকানা ও বিআইএন')}
          </p>
          <p className="text-[9pt] font-semibold leading-tight">{party?.name_en ?? doc.party_name_en}</p>
          <p className="font-bangla text-[7.5pt] leading-tight">{party?.name_bn ?? doc.party_name_bn}</p>
          <p className="mt-0.5 text-[7pt] leading-tight">{party?.address_en ?? '—'}</p>
          <p className="mt-0.5 font-mono text-[7.5pt]">
            BIN {buyerBin || '—'} · TIN {party?.tin ?? doc.party_tin ?? '—'}
          </p>
          <p className="text-[7pt] text-black/60">
            {label('Mobile', 'মোবাইল')} {party?.mobile ?? '—'}
          </p>
        </div>
      </div>

      {/* Invoice meta */}
      <div className="mt-0 grid grid-cols-4 gap-0 border border-t-0 border-black">
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Invoice / challan no.', 'চালান নং')}</p>
          <p className="font-mono text-[8pt] font-semibold">{doc.mushak_serial ?? doc.doc_number}</p>
        </div>
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Date of issue', 'ইস্যুর তারিখ')}</p>
          <p className="font-mono text-[8pt] font-semibold">{doc.doc_date}</p>
        </div>
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Time of issue', 'ইস্যুর সময়')}</p>
          <p className="font-mono text-[8pt]">{timeOf(doc.created_at)}</p>
        </div>
        <div className="p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Vehicle no.', 'যানবাহন নং')}</p>
          <p className="font-mono text-[8pt]">{doc.vehicle_no ?? doc.reference_no ?? '—'}</p>
        </div>
        <div className="border-r border-t border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Destination of supply', 'সরবরাহের গন্তব্য')}</p>
          <p className="truncate text-[7.5pt]">{doc.destination ?? party?.address_en ?? '—'}</p>
        </div>
        <div className="border-r border-t border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Delivery date', 'সরবরাহের তারিখ')}</p>
          <p className="font-mono text-[8pt]">{doc.doc_date}</p>
        </div>
        <div className="border-r border-t border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Mode of payment', 'পরিশোধ পদ্ধতি')}</p>
          <p className="text-[7.5pt]">
            {PAYMENT_LABEL[doc.payment_method]?.[isBn ? 'bn' : 'en'] ?? doc.payment_method}
            {doc.payment_channel ? ` · ${doc.payment_channel}` : ''}
          </p>
        </div>
        <div className="border-t border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Mushak 6.3 serial', 'মূসক ৬.৩ ক্রমিক')}</p>
          <p className="font-mono text-[8pt]">{doc.mushak_serial ?? '—'}</p>
        </div>
      </div>

      {/* 11 statutory columns */}
      <table className="mt-2 w-full table-fixed border-collapse text-[7pt]">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className="bg-black/[0.06]">
            {[
              ['ক্রমিক', 'Sl.'],
              ['পণ্য/সেবার বর্ণনা', 'Description of goods / services'],
              ['পরিমাণ', 'Qty'],
              ['একক', 'Unit'],
              ['একক মূল্য', 'Unit price'],
              ['মূল্য', 'Value'],
              ['সম্পূরক শুল্ক', 'SD'],
              ['মূল্য + এসডি', 'Value + SD'],
              ['মূসক হার', 'VAT rate'],
              ['মূসক', 'VAT'],
              ['মূল্য + মূসক', 'Total'],
            ].map(([bn, en]) => (
              <th key={en} className="border border-black px-1 py-1 text-center align-middle">
                <span className="block font-bangla text-[6.5pt] leading-tight">{bn}</span>
                <span className="block text-[6pt] font-normal leading-tight text-black/60">{en}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((entry, index) => {
            const vat = vatRows[index] ?? 0n;
            const total = entry.value + vat;
            return (
              <tr key={entry.line.id}>
                <td className="border border-black px-1 py-1 text-center">{index + 1}</td>
                <td className="border border-black px-1 py-1">
                  <span className="font-bangla text-[7pt] leading-tight">{entry.line.description_bn}</span>
                  <span className="block text-[6.5pt] text-black/60">{entry.line.description_en}</span>
                </td>
                <td className="border border-black px-1 py-1 text-right font-mono">{entry.line.quantity}</td>
                <td className="border border-black px-1 py-1 text-center">{unitOf(entry.line.sku)}</td>
                <td className="border border-black px-1 py-1 text-right font-mono">
                  {money(entry.line.unit_price_poisha, { symbol: false })}
                </td>
                <td className="border border-black px-1 py-1 text-right font-mono">
                  {money(entry.value, { symbol: false })}
                </td>
                <td className="border border-black px-1 py-1 text-right font-mono">—</td>
                <td className="border border-black px-1 py-1 text-right font-mono">
                  {money(entry.value, { symbol: false })}
                </td>
                <td className="border border-black px-1 py-1 text-center font-mono">{ratePercent(rateBps)}</td>
                <td className="border border-black px-1 py-1 text-right font-mono">
                  {money(vat, { symbol: false })}
                </td>
                <td className="border border-black px-1 py-1 text-right font-mono font-semibold">
                  {money(total, { symbol: false })}
                </td>
              </tr>
            );
          })}
          <tr className="bg-black/[0.06] font-semibold">
            <td className="border border-black px-1 py-1 text-center" colSpan={2}>
              <span className="font-bangla">মোট / Total</span>
            </td>
            <td className="border border-black px-1 py-1 text-right font-mono">
              {lines.reduce((total, entry) => total + entry.line.quantity, 0)}
            </td>
            <td className="border border-black px-1 py-1" />
            <td className="border border-black px-1 py-1" />
            <td className="border border-black px-1 py-1 text-right font-mono">
              {money(baseSum + doc.sd_poisha, { symbol: false })}
            </td>
            <td className="border border-black px-1 py-1 text-right font-mono">
              {money(doc.sd_poisha, { symbol: false })}
            </td>
            <td className="border border-black px-1 py-1 text-right font-mono">
              {money(baseSum + doc.sd_poisha, { symbol: false })}
            </td>
            <td className="border border-black px-1 py-1" />
            <td className="border border-black px-1 py-1 text-right font-mono">
              {money(doc.vat_poisha, { symbol: false })}
            </td>
            <td className="border border-black px-1 py-1 text-right font-mono">
              {money(doc.gross_poisha, { symbol: false })}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Words + totals */}
      <div className="mt-2 grid grid-cols-3 gap-0 border border-black">
        <div className="col-span-2 border-r border-black p-2">
          <p className="text-[6.5pt] uppercase tracking-[0.1em] text-black/60">
            {label('Amount in words', 'কথায় পরিমাণ')}
          </p>
          <p className="text-[8pt] font-semibold leading-snug">{takaInWords(doc.gross_poisha, 'en-BD')}</p>
          <p className="font-bangla text-[8pt] font-semibold leading-snug">
            {takaInWords(doc.gross_poisha, 'bn-BD')}
          </p>
          <p className="mt-1 text-[6.5pt] leading-snug text-black/60">
            {label(
              'VAT is included in the total. This invoice must be issued at the time of supply; retain a copy for six years.',
              'মোট মূল্যের মধ্যে ভ্যাট অন্তর্ভুক্ত। সরবরাহের সময়ই এই চালান ইস্যু করতে হবে; ছয় বছর কপি সংরক্ষণ করুন।',
            )}
          </p>
        </div>
        <div className="p-2 text-[7.5pt]">
          <FieldRow label={label('Taxable value', 'করযোগ্য মূল্য')} value={money(doc.base_poisha, { symbol: false })} />
          <FieldRow label={label('SD', 'সম্পূরক শুল্ক')} value={money(doc.sd_poisha, { symbol: false })} />
          <FieldRow label={label('VAT', 'মূসক')} value={money(doc.vat_poisha, { symbol: false })} />
          <FieldRow
            label={label('VDS withheld', 'আটকানো ভিডিএস')}
            value={money(doc.vds_poisha, { symbol: false })}
          />
          <FieldRow
            label={label('TDS withheld', 'আটকানো টিডিএস')}
            value={money(doc.tds_poisha, { symbol: false })}
          />
          <div className="mt-1 flex items-baseline justify-between border-t border-black pt-1 text-[9pt] font-bold">
            <span className="font-bangla">{label('সর্বমোট', 'Grand total')}</span>
            <span className="font-mono">{money(doc.gross_poisha, { symbol: false })}</span>
          </div>
        </div>
      </div>

      <SignBlocks ctx={ctx} />

      <div className="mt-3 flex items-end justify-between border-t border-black/30 pt-1 text-[6.5pt] text-black/50">
        <span>
          {label('Document ref', 'ডকুমেন্ট রেফ')} {doc.doc_number} · {label('Book', 'বই')} {doc.book_type}
        </span>
        <span className="font-mono">Mushak 6.3 · {tenant.fiscal_year_label}</span>
      </div>
    </PrintSheet>
  );
}

// ---------------------------------------------------------------------------------------------
// (b) Mushak 6.6 — VDS Withholding Certificate
// ---------------------------------------------------------------------------------------------

function Mushak66Sheet({
  ctx,
  certificate,
  party,
  challan,
  doc,
}: {
  ctx: SheetContext;
  certificate: VdsCertificate;
  party: Party | null;
  challan: Challan | null;
  doc: CommercialDoc | null;
}) {
  const { money, label, isBn, tenant, binUnit } = ctx;
  const valuePoisha = doc?.base_poisha ?? certificate.amount_poisha;
  const vatPoisha = doc?.vat_poisha ?? 0n;
  const vdsPoisha = certificate.vds_poisha;
  const vdsBps = valuePoisha > 0n ? Number((vdsPoisha * 10000n) / valuePoisha) : 450;
  const sellerBin = binUnit ? binUnit.bin_number : tenant.tin_number;

  return (
    <PrintSheet>
      <NationalHeader sub="উৎসে ভ্যাট কর্তন · Value Added Tax (Withholding) — Rule 47(6)" />

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <FormCodeBadge bn="৬.৬" en="Mushak 6.6 — VAT Withholding Certificate" />
          <p className="mt-1.5 font-bangla text-[10pt] font-bold leading-tight">ভ্যাট উৎসে কর্তনের সনদ</p>
          <p className="text-[7pt] text-black/60">VDS Certificate · Rule 47(6), VAT &amp; SD Rules 2016 read with s.49</p>
        </div>
        <div className="border border-black px-2.5 py-1.5 text-right">
          <p className="text-[6.5pt] uppercase tracking-[0.12em] text-black/60">Certificate no.</p>
          <p className="font-mono text-[9.5pt] font-bold leading-tight">{certificate.certificate_number}</p>
          <p className="font-mono text-[7pt] text-black/60">{certificate.certificate_date}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-0 border border-black">
        <div className="border-r border-black p-2">
          <p className="mb-1 text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Withholding entity', 'উৎসে কর্তনকারী প্রতিষ্ঠান')}
          </p>
          <p className="text-[9pt] font-semibold leading-tight">{tenant.name_en}</p>
          <p className="font-bangla text-[7.5pt] leading-tight">{tenant.name_bn}</p>
          <p className="mt-0.5 text-[7pt] leading-tight">{binUnit?.address ?? tenant.address_en}</p>
          <p className="mt-0.5 font-mono text-[7.5pt]">
            BIN {sellerBin} · TIN {tenant.tin_number}
          </p>
        </div>
        <div className="p-2">
          <p className="mb-1 text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Supplier / deductee', 'সরবরাহকারী / কর্তিতব্য ব্যক্তি')}
          </p>
          <p className="text-[9pt] font-semibold leading-tight">{party?.name_en ?? certificate.party_name_en}</p>
          <p className="font-bangla text-[7.5pt] leading-tight">{party?.name_bn ?? certificate.party_name_bn}</p>
          <p className="mt-0.5 text-[7pt] leading-tight">{party?.address_en ?? '—'}</p>
          <p className="mt-0.5 font-mono text-[7.5pt]">
            BIN {party?.bin ?? certificate.party_bin ?? '—'} · TIN {party?.tin ?? '—'}
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-0 border border-black">
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Invoice / bill reference', 'চালান / বিল রেফ')}</p>
          <p className="font-mono text-[8pt] font-semibold">
            {certificate.related_doc_ref || doc?.doc_number || '—'}
          </p>
        </div>
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Invoice date', 'চালানের তারিখ')}</p>
          <p className="font-mono text-[8pt]">{doc?.doc_date ?? certificate.certificate_date}</p>
        </div>
        <div className="p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Place of supply', 'সরবরাহের স্থান')}</p>
          <p className="truncate text-[7.5pt]">{party?.address_en ?? '—'}</p>
        </div>
      </div>

      <table className="mt-2 w-full border-collapse text-[8pt]">
        <tbody>
          <tr>
            <td className="w-[6%] border border-black px-1 py-1.5 text-center">১</td>
            <td className="border border-black px-2 py-1.5">
              <span className="font-bangla">{label('করযোগ্য সরবরাহের মূল্য', 'Value of taxable supply')}</span>
              <span className="block text-[6.5pt] text-black/60">
                {label('Value of taxable supply on which VAT was charged', 'যে মূল্যের উপর ভ্যাট ধার্য হয়েছে')}
              </span>
            </td>
            <td className="w-[22%] border border-black px-2 py-1.5 text-right font-mono text-[9pt]">
              {money(valuePoisha, { symbol: false })}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1.5 text-center">২</td>
            <td className="border border-black px-2 py-1.5">
              <span className="font-bangla">{label('প্রদেয় মূসক', 'VAT charged on the supply')}</span>
              <span className="block text-[6.5pt] text-black/60">
                {label('Output tax shown on the tax invoice', 'কর চালানে প্রদর্শিত আউটপুট কর')}
              </span>
            </td>
            <td className="border border-black px-2 py-1.5 text-right font-mono text-[9pt]">
              {money(vatPoisha, { symbol: false })}
            </td>
          </tr>
          <tr className="bg-black/[0.06]">
            <td className="border border-black px-1 py-1.5 text-center">৩</td>
            <td className="border border-black px-2 py-1.5">
              <span className="font-bangla">{label('উৎসে কর্তিত মূসক (ভিডিএস)', 'VAT withheld at source (VDS)')}</span>
              <span className="block text-[6.5pt] text-black/60">
                {label('Rate applied', 'প্রযোজ্য হার')}{' '}
                <span className="font-mono">{ratePercent(vdsBps)}</span> ·{' '}
                {label('Rule 47(6), VAT & SD Rules 2016', 'বিধি ৪৭(৬), ভ্যাট ও এসডি বিধিমালা ২০১৬')}
              </span>
            </td>
            <td className="border border-black px-2 py-1.5 text-right font-mono text-[9pt] font-bold">
              {money(vdsPoisha, { symbol: false })}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1.5 text-center">৪</td>
            <td className="border border-black px-2 py-1.5">
              <span className="font-bangla">{label('নিট পরিশোধযোগ্য', 'Net payable to the supplier')}</span>
              <span className="block text-[6.5pt] text-black/60">
                {label('Invoice value + VAT − VDS − TDS', 'চালান মূল্য + ভ্যাট − ভিডিএস − টিডিএস')}
              </span>
            </td>
            <td className="border border-black px-2 py-1.5 text-right font-mono text-[9pt]">
              {money(
                (doc?.gross_poisha ?? certificate.amount_poisha) -
                  vdsPoisha -
                  (doc?.tds_poisha ?? 0n),
                { symbol: false },
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-2 gap-0 border border-black">
        <div className="border-r border-black p-2">
          <p className="text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Treasury deposit (challan)', 'ট্রেজারি জমা (চালান)')}
          </p>
          <FieldRow label={label('Challan no.', 'চালান নং')} value={challan?.challan_number ?? '—'} mono />
          <FieldRow
            label={label('Economic code', 'অর্থনৈতিক কোড')}
            value={challan?.economic_code ?? '—'}
            mono
          />
          <FieldRow
            label={label('Bank / branch', 'ব্যাংক / শাখা')}
            value={challan?.bank_branch ?? 'City Bank · Banani Branch'}
          />
          <FieldRow
            label={label('Deposit date', 'জমার তারিখ')}
            value={challan?.deposit_date ?? challan?.period_code ?? '—'}
            mono
          />
          <FieldRow label={label('Amount deposited', 'জমাকৃত অর্থ')} value={money(challan?.amount_poisha ?? vdsPoisha)} />
          <FieldRow label={label('Status', 'অবস্থা')} value={challan?.status ?? 'PENDING'} />
        </div>
        <div className="p-2">
          <p className="text-[6.5pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Amount in words', 'কথায় পরিমাণ')}
          </p>
          <p className="mt-1 text-[8pt] font-semibold leading-snug">{takaInWords(vdsPoisha, 'en-BD')}</p>
          <p className="font-bangla text-[8pt] font-semibold leading-snug">{takaInWords(vdsPoisha, 'bn-BD')}</p>
          <p className="mt-1.5 text-[6.5pt] leading-snug text-black/60">
            {label(
              'I certify that VAT shown above has been withheld from the supplier and deposited to the government treasury, and that this certificate has been issued to the supplier for their input credit claim.',
              'আমি প্রত্যয়ন করছি যে উপরোক্ত ভ্যাট সরবরাহকারীর নিকট হতে উৎসে কর্তন করে সরকারি কোষাগারে জমা দেওয়া হয়েছে এবং ইনপুট রিবেট দাবির জন্য সরবরাহকারীকে এই সনদ ইস্যু করা হয়েছে।',
            )}
          </p>
        </div>
      </div>

      <SignBlocks ctx={ctx} />

      <div className="mt-3 flex items-end justify-between border-t border-black/30 pt-1 text-[6.5pt] text-black/50">
        <span>
          {label('Certificate', 'সনদ')} {certificate.certificate_number} · {certificate.status}
        </span>
        <span className="font-mono">{isBn ? 'মূসক ৬.৬' : 'Mushak 6.6'} · {tenant.fiscal_year_label}</span>
      </div>
    </PrintSheet>
  );
}

// ---------------------------------------------------------------------------------------------
// (c) Mushak 9.1 — Monthly VAT Return
// ---------------------------------------------------------------------------------------------

function Mushak91Sheets({
  ctx,
  docs,
  period,
  statements,
  cashLimit,
  journals,
  certificates,
}: {
  ctx: SheetContext;
  docs: CommercialDoc[];
  period: string;
  statements: FinancialStatements;
  cashLimit: bigint;
  journals: ReturnType<typeof useVault>['journals'];
  certificates: ReturnType<typeof useVault>['vdsCertificates'];
}) {
  const { money, label, isBn, tenant, binUnit } = ctx;

  const inPeriod = docs.filter((entry) => entry.doc_date.startsWith(period));
  const sales = inPeriod.filter(
    (entry) => entry.doc_type === 'SALES_INVOICE' || entry.doc_type === 'CREDIT_NOTE',
  );
  const purchases = inPeriod.filter(
    (entry) =>
      entry.doc_type === 'PURCHASE_BILL' ||
      entry.doc_type === 'EXPENSE_VOUCHER' ||
      entry.doc_type === 'IMPORTED_SERVICE',
  );

  const standardSales = sales.filter((entry) => entry.tax_category !== 'EXPORT_ZERO' && entry.tax_category !== 'EXEMPT');
  const zeroRated = sales.filter((entry) => entry.tax_category === 'EXPORT_ZERO');
  const exempt = sales.filter((entry) => entry.tax_category === 'EXEMPT');
  const signed = (entry: CommercialDoc, amount: bigint): bigint =>
    entry.doc_type === 'CREDIT_NOTE' ? -amount : amount;

  const salesBase = sumPoisha(standardSales, (entry) => signed(entry, entry.base_poisha));
  const salesSd = sumPoisha(sales, (entry) => signed(entry, entry.sd_poisha));
  const outputVat = sumPoisha(sales, (entry) => signed(entry, entry.vat_poisha));
  const zeroBase = sumPoisha(zeroRated, (entry) => signed(entry, entry.base_poisha));
  const exemptBase = sumPoisha(exempt, (entry) => signed(entry, entry.base_poisha));

  const purchaseVat = sumPoisha(purchases, (entry) => entry.vat_poisha);
  const purchaseBase = sumPoisha(purchases, (entry) => entry.base_poisha);
  const annotatedPurchases = purchases as Array<
    CommercialDoc & { tax_claimable_poisha?: bigint; tax_disallowed_poisha?: bigint }
  >;
  const claimable = annotatedPurchases.reduce(
    (total, entry) => total + (entry.tax_claimable_poisha ?? entry.vat_poisha),
    0n,
  );
  const disallowed = annotatedPurchases.reduce(
    (total, entry) => total + (entry.tax_disallowed_poisha ?? 0n),
    0n,
  );
  const vdsTotal = sumPoisha(purchases, (entry) => entry.vds_poisha);
  const tdsTotal = sumPoisha(purchases, (entry) => entry.tds_poisha);

  const receivedCertificates = certificates.filter(
    (certificate) => certificate.direction === 'RECEIVED' && (certificate.status === 'RECEIVED' || certificate.status === 'VERIFIED'),
  );
  const decreasing = receivedCertificates.reduce((total, certificate) => total + certificate.vds_poisha, 0n);
  const increasing = 0n;
  const netPayable = outputVat - claimable + increasing - decreasing;
  const closingBalance = netPayable < 0n ? -netPayable : 0n;

  // GL proof comes from the immutable journals for this period, not from a display KPI. The
  // decreasing adjustment is supported by customer Mushak 6.6 certificates and sits outside the
  // VAT current account, so it is proved on its own line.
  const periodJournals = journals.filter(
    (journal) =>
      journal.period_code === period &&
      journal.source_module !== 'OPENING_BALANCE' &&
      !(journal.source_doc_ref ?? '').startsWith('MUSHAK-9.1'),
  );
  const glOutput = -accountBalance(periodJournals, '2120');
  const glInput = accountBalance(periodJournals, '1140');
  const glDifference = (outputVat - glOutput) - (claimable - glInput);

  const periodEnd = periodEndOf(period);
  const dueDate = addDays(periodEnd, 15);
  const periodRecord = tenant.fiscal_year_label;

  const parts: Mushak91Part[] = [
    {
      part: 1,
      title_en: 'Taxpayer identity & return period',
      title_bn: 'করদাতার পরিচয় ও রিটার্ন সময়কাল',
      total_poisha: 0n,
      rows: [
        { label_en: 'BIN', label_bn: 'বিআইএন', amount_poisha: 0n, note: binUnit?.bin_number ?? tenant.tin_number },
        { label_en: 'Legal name', label_bn: 'নিবন্ধিত নাম', amount_poisha: 0n, note: tenant.name_en },
        { label_en: 'Return period', label_bn: 'রিটার্ন সময়কাল', amount_poisha: 0n, note: period },
        { label_en: 'Filing due date', label_bn: 'জমার শেষ তারিখ', amount_poisha: 0n, note: dueDate },
        { label_en: 'Framework year', label_bn: 'হিসাব বছর', amount_poisha: 0n, note: periodRecord },
      ],
    },
    {
      part: 2,
      title_en: 'Taxable supplies (output)',
      title_bn: 'করযোগ্য সরবরাহ (আউটপুট)',
      total_poisha: outputVat,
      rows: [
        { label_en: 'Standard-rated taxable value', label_bn: 'আদর্শ হারে করযোগ্য মূল্য', amount_poisha: salesBase },
        { label_en: 'Supplementary duty', label_bn: 'সম্পূরক শুল্ক', amount_poisha: salesSd },
        { label_en: 'Output VAT at applicable rates', label_bn: 'প্রযোজ্য হারে আউটপুট মূসক', amount_poisha: outputVat },
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
        {
          label_en: 'Imported services (reverse charge)',
          label_bn: 'আমদানি সেবা (রিভার্স চার্জ)',
          amount_poisha: sumPoisha(
            purchases.filter((entry) => entry.reverse_charge),
            (entry) => entry.vat_poisha,
          ),
        },
      ],
    },
    {
      part: 5,
      title_en: 'VAT withheld at source',
      title_bn: 'উৎসে কর্তিত মূসক',
      total_poisha: vdsTotal,
      rows: [
        { label_en: 'VDS withheld from suppliers', label_bn: 'সরবরাহকারীদের নিকট হতে কর্তিত ভিডিএস', amount_poisha: vdsTotal },
        { label_en: 'Deposited with treasury challan', label_bn: 'ট্রেজারি চালানে জমাকৃত', amount_poisha: vdsTotal },
      ],
    },
    {
      part: 6,
      title_en: 'Part 6 — Decreasing adjustment (customer Mushak 6.6 received)',
      title_bn: 'অংশ ৬ — হ্রাস সমন্বয় (প্রাপ্ত গ্রাহক মূসক ৬.৬)',
      total_poisha: decreasing,
      rows: [
        {
          label_en: `Customer Mushak 6.6 certificates received (${receivedCertificates.length})`,
          label_bn: `প্রাপ্ত গ্রাহক মূসক ৬.৬ সনদ (${receivedCertificates.length}টি)`,
          amount_poisha: decreasing,
          note: receivedCertificates.length ? undefined : label('No certificates received yet', 'এখনো কোনো সনদ প্রাপ্ত হয়নি'),
        },
        { label_en: 'Credit notes & bad debt relief', label_bn: 'ক্রেডিট নোট ও কু-ঋণ রিলিফ', amount_poisha: 0n },
      ],
    },
    {
      part: 7,
      title_en: 'Increasing adjustment — disallowed input',
      title_bn: 'বৃদ্ধি সমন্বয় — অগ্রহণযোগ্য ইনপুট',
      total_poisha: disallowed,
      rows: [
        {
          label_en: 'Cash payment above the s.46 threshold',
          label_bn: 'ধারা ৪৬ সীমার উপরে নগদ প্রদান',
          amount_poisha: disallowed,
          note: disallowed > 0n ? label('Excluded from Part 8', 'অংশ ৮ থেকে বাদ') : undefined,
        },
        { label_en: 'Debit notes & late purchases', label_bn: 'ডেবিট নোট ও বিলম্বিত ক্রয়', amount_poisha: increasing },
      ],
    },
    {
      part: 8,
      title_en: 'Input rebate claimed',
      title_bn: 'দাবিকৃত ইনপুট রিবেট',
      total_poisha: claimable,
      rows: [
        { label_en: 'Input VAT on eligible local purchases', label_bn: 'যোগ্য স্থানীয় ক্রয়ের ইনপুট ভ্যাট', amount_poisha: claimable },
        { label_en: 'Imported services under reverse charge', label_bn: 'রিভার্স চার্জে আমদানি সেবা', amount_poisha: 0n },
      ],
    },
    {
      part: 9,
      title_en: 'Net VAT payable',
      title_bn: 'নিট প্রদেয় মূসক',
      total_poisha: netPayable,
      rows: [
        { label_en: 'Output VAT', label_bn: 'আউটপুট মূসক', amount_poisha: outputVat },
        { label_en: 'Less: input rebate', label_bn: 'বিয়োগ: ইনপুট রিবেট', amount_poisha: -claimable },
        { label_en: 'Less: customer 6.6 decreasing adjustment', label_bn: 'বিয়োগ: গ্রাহক ৬.৬ হ্রাস সমন্বয়', amount_poisha: -decreasing },
      ],
    },
    {
      part: 10,
      title_en: 'Closing balance carried forward',
      title_bn: 'পরবর্তী সময়ে বহনযোগ্য উদ্বৃত্ত',
      total_poisha: closingBalance,
      rows: [
        { label_en: 'Excess input rebate c/f', label_bn: 'অতিরিক্ত ইনপুট রিবেট বহন', amount_poisha: closingBalance },
      ],
    },
    {
      part: 11,
      title_en: 'TDS & deposit reconciliation',
      title_bn: 'টিডিএস ও জমা মিলকরণ',
      total_poisha: tdsTotal,
      rows: [
        { label_en: 'TDS withheld under s.89–109', label_bn: 'ধারা ৮৯–১০৯ অনুযায়ী কর্তিত টিডিএস', amount_poisha: tdsTotal },
        {
          label_en: 'VAT deposited by challan',
          label_bn: 'চালানে জমাকৃত মূসক',
          amount_poisha: netPayable > 0n ? netPayable : 0n,
          note: netPayable > 0n ? undefined : label('Refund / credit carried forward', 'ফেরত / ক্রেডিট বহন'),
        },
      ],
    },
    {
      part: 12,
      title_en: 'GL tie-out proof',
      title_bn: 'জিএল মিলকরণ প্রমাণ',
      total_poisha: glDifference,
      rows: [
        { label_en: 'Output VAT per 2120 control account', label_bn: '২১২০ নিয়ন্ত্রণ হিসাবে আউটপুট মূসক', amount_poisha: glOutput },
        { label_en: 'Input VAT per 1140 control account', label_bn: '১১৪০ নিয়ন্ত্রণ হিসাবে ইনপুট মূসক', amount_poisha: glInput },
        {
          label_en: 'Variance (must be 0.00 BDT)',
          label_bn: 'পার্থক্য (০.০০ টাকা হতে হবে)',
          amount_poisha: glDifference,
          note: glDifference === 0n ? label('Reconciled', 'মিলিত') : label('Investigate', 'তদন্ত করুন'),
        },
      ],
    },
  ];

  return (
    <PrintSheet>
      <NationalHeader sub="মাসিক মূসক রিটার্ন · Monthly VAT Return under the VAT & SD Act, 2012" />

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <FormCodeBadge bn="৯.১" en="Mushak 9.1 — Monthly VAT Return" />
          <p className="mt-1.5 font-bangla text-[10pt] font-bold leading-tight">মাসিক মূসক রিটার্ন</p>
          <p className="text-[7pt] text-black/60">
            {label('Ordinance No. 38 of 2026 filing window · 15 days after period end', 'অধ্যাদেশ নং ৩৮/২০২৬ ফাইলিং সময়সীমা · সময়কাল শেষের ১৫ দিন পর')}
          </p>
        </div>
        <div className="border border-black px-2.5 py-1.5 text-right">
          <p className="text-[6.5pt] uppercase tracking-[0.12em] text-black/60">Return period</p>
          <p className="font-mono text-[10pt] font-bold leading-tight">{period}</p>
          <p className="font-mono text-[7pt] text-black/60">{label('due', 'জমা')} {dueDate}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-0 border border-black text-[7.5pt]">
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Registered person', 'নিবন্ধিত ব্যক্তি')}</p>
          <p className="truncate font-semibold">{tenant.name_en}</p>
        </div>
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">BIN</p>
          <p className="truncate font-mono font-semibold">{binUnit?.bin_number ?? tenant.tin_number}</p>
        </div>
        <div className="border-r border-black p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Fiscal year', 'হিসাব বছর')}</p>
          <p className="truncate font-mono">{tenant.fiscal_year_label}</p>
        </div>
        <div className="p-1.5">
          <p className="text-[6.5pt] text-black/60">{label('Supplies / purchases', 'সরবরাহ / ক্রয়')}</p>
          <p className="font-mono">
            {sales.length} / {purchases.length}
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {parts.map((part) => (
          <div key={part.part} className="border border-black">
            <div className="flex items-baseline justify-between border-b border-black bg-black/[0.06] px-1.5 py-1">
              <p className="text-[7pt] font-semibold">
                <span className="mr-1 font-mono">{String(part.part).padStart(2, '0')}</span>
                <span className="font-bangla">{part.title_bn}</span>
                <span className="block text-[6pt] font-normal leading-tight text-black/55">{part.title_en}</span>
              </p>
              <span className="font-mono text-[6.5pt] text-black/50">{part.part}/12</span>
            </div>
            <table className="w-full border-collapse text-[7pt]">
              <tbody>
                {part.rows.map((row) => (
                  <tr key={`${part.part}-${row.label_en}`} className="border-b border-black/15 last:border-b-0">
                    <td className="px-1.5 py-[3px] align-top">
                      <span className="block leading-tight">{row.label_en}</span>
                      <span className="block font-bangla text-[6.5pt] leading-tight text-black/55">
                        {row.label_bn}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-[3px] text-right align-top font-mono">
                      {row.amount_poisha !== 0n
                        ? money(row.amount_poisha, { symbol: false })
                        : row.note ?? '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-black/[0.04] font-semibold">
                  <td className="px-1.5 py-[3px] text-[6.5pt] uppercase tracking-[0.08em]">
                    {label('Part total', 'অংশ মোট')}
                  </td>
                  <td className="px-1.5 py-[3px] text-right font-mono">
                    {money(part.total_poisha, { symbol: false })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-0 border-2 border-black">
        <div className="border-r border-black p-2">
          <p className="text-[6.5pt] uppercase tracking-[0.1em] text-black/60">{label('Output tax', 'আউটপুট কর')}</p>
          <p className="font-mono text-[10pt] font-bold">{money(outputVat, { symbol: false })}</p>
        </div>
        <div className="border-r border-black p-2">
          <p className="text-[6.5pt] uppercase tracking-[0.1em] text-black/60">{label('Input rebate', 'ইনপুট রিবেট')}</p>
          <p className="font-mono text-[10pt] font-bold">{money(claimable, { symbol: false })}</p>
        </div>
        <div className="p-2">
          <p className="text-[6.5pt] uppercase tracking-[0.1em] text-black/60">{label('Net payable', 'নিট প্রদেয়')}</p>
          <p className="font-mono text-[10pt] font-bold">{money(netPayable, { symbol: false })}</p>
        </div>
      </div>

      <div className="mt-2 border-2 border-black">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black bg-black/[0.06] px-2 py-1">
          <p className="text-[7pt] font-semibold uppercase tracking-[0.1em]">
            {label('GL vs return reconciliation proof', 'জিএল ও রিটার্ন মিলকরণ প্রমাণ')}
          </p>
          <span className={`border border-black px-2 py-0.5 font-mono text-[7.5pt] font-bold ${glDifference === 0n ? 'bg-white' : 'bg-black text-white'}`}>
            {money(glDifference, { symbol: false })} BDT variance
          </span>
        </div>
        <table className="w-full border-collapse text-[7.5pt]">
          <thead>
            <tr className="border-b border-black/40 text-[6.5pt] uppercase tracking-[0.08em] text-black/60">
              <th className="py-[3px] pl-2 text-left font-semibold">{label('Line', 'লাইন')}</th>
              <th className="py-[3px] text-right font-semibold">{label('Return', 'রিটার্ন')}</th>
              <th className="py-[3px] text-right font-semibold">{label('GL', 'জিএল')}</th>
              <th className="py-[3px] pr-2 text-right font-semibold">{label('Variance', 'পার্থক্য')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/20">
              <td className="py-[3px] pl-2">{label('Output VAT (2120)', 'আউটপুট ভ্যাট (২১২০)')}</td>
              <td className="py-[3px] text-right font-mono">{money(outputVat, { symbol: false })}</td>
              <td className="py-[3px] text-right font-mono text-black/60">{money(glOutput, { symbol: false })}</td>
              <td className="py-[3px] pr-2 text-right font-mono">{money(outputVat - glOutput, { symbol: false })}</td>
            </tr>
            <tr className="border-b border-black/20">
              <td className="py-[3px] pl-2">{label('Input rebate (1140, Part 8)', 'ইনপুট রিবেট (১১৪০, অংশ ৮)')}</td>
              <td className="py-[3px] text-right font-mono">{money(claimable, { symbol: false })}</td>
              <td className="py-[3px] text-right font-mono text-black/60">{money(glInput, { symbol: false })}</td>
              <td className="py-[3px] pr-2 text-right font-mono">{money(claimable - glInput, { symbol: false })}</td>
            </tr>
            <tr className="border-b border-black/20">
              <td className="py-[3px] pl-2">
                {label('Customer Mushak 6.6 decreasing adjustment (Part 6)', 'গ্রাহক মূসক ৬.৬ হ্রাস সমন্বয় (অংশ ৬)')}
              </td>
              <td className="py-[3px] text-right font-mono">{money(-decreasing, { symbol: false })}</td>
              <td className="py-[3px] text-right font-mono text-black/60">
                {receivedCertificates.length} {label('cert.', 'সনদ')}
              </td>
              <td className="py-[3px] pr-2 text-right font-mono">{label('memo', 'মেমো')}</td>
            </tr>
            <tr className="bg-black/[0.04]">
              <td className="py-[4px] pl-2 font-semibold">
                {label('Core difference (must be zero to file)', 'মূল পার্থক্য (ফাইলিংয়ে শূন্য হতে হবে)')}
              </td>
              <td className="py-[4px] text-right font-mono font-semibold" colSpan={2}>
                {money(netPayable, { symbol: false })} {label('net payable', 'নিট প্রদেয়')}
              </td>
              <td className="py-[4px] pr-2 text-right font-mono font-bold">
                {money(glDifference, { symbol: false })}{' '}
                <span className={glDifference === 0n ? 'text-black/60' : ''}>
                  {glDifference === 0n ? label('· reconciled', '· মিলিত') : label('· investigate', '· তদন্ত')}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="max-w-[112mm] text-[6.5pt] leading-snug text-black/60">
          <p>
            {label(
              'Declaration: I declare that the information in this return is true and complete to the best of my knowledge, and that the tax payable has been computed under the VAT and Supplementary Duty Act, 2012 and the rules made thereunder.',
              'ঘোষণা: আমি ঘোষণা করছি যে এই রিটার্নের তথ্য আমার জ্ঞানমতে সত্য ও সম্পূর্ণ এবং প্রদেয় কর মূল্য সংযোজন কর ও সম্পূরক শুল্ক আইন, ২০১২ ও তৎসহ প্রণীত বিধিমালা অনুযায়ী গণনা করা হয়েছে।',
            )}
          </p>
          <p className="mt-1 font-mono">
            {label('Net payable in words', 'কথায় নিট প্রদেয়')}: {takaInWords(netPayable < 0n ? -netPayable : netPayable, 'en-BD')}
          </p>
          <p className="font-bangla text-[7pt] leading-snug">
            {takaInWords(netPayable < 0n ? -netPayable : netPayable, 'bn-BD')}
          </p>
        </div>
        <div className="w-[52mm] text-center text-[7pt]">
          <div className="h-10 border-b border-dotted border-black" />
          <p className="mt-1 font-bangla">{label('স্বাক্ষর ও সিল', 'Signature & seal')}</p>
          <p className="text-black/60">{label('Authorised representative', 'অনুমোদিত প্রতিনিধি')}</p>
          <p className="mt-0.5 font-mono text-[6.5pt]">{ctx.today}</p>
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between border-t border-black/30 pt-1 text-[6.5pt] text-black/50">
        <span>
          {label('Filing window', 'ফাইলিং সময়সীমা')} {dueDate} ·{' '}
          {label('15 days after period end (Ordinance 38/2026)', 'সময়কাল শেষের ১৫ দিন পর (অধ্যাদেশ ৩৮/২০২৬)')}
        </span>
        <span className="font-mono">{isBn ? 'মূসক ৯.১' : 'Mushak 9.1'}</span>
      </div>
    </PrintSheet>
  );
}

// ---------------------------------------------------------------------------------------------
// (d) IAS 1 / IFRS 18 audited pack
// ---------------------------------------------------------------------------------------------

function IfrsSheets({ ctx, statements }: { ctx: SheetContext; statements: FinancialStatements }) {
  const { money, label, isBn, tenant } = ctx;
  const fs = statements;
  const currentLabel = fs.period.label_en;
  const comparativeLabel = fs.comparative.label_en;
  const fmt = (value: bigint): string => money(value, { symbol: false });

  return (
    <>
      {/* Cover + audit opinion */}
      <PrintSheet>
        <NationalHeader sub="FRC Bangladesh · Financial Reporting Act, 2015" />
        <div className="mt-10 text-center">
          <p className="text-[7pt] uppercase tracking-[0.24em] text-black/50">
            {label('Audited financial statements', 'নিরীক্ষিত আর্থিক বিবরণী')}
          </p>
          <h1 className="mt-2 text-[17pt] font-bold leading-tight">{tenant.name_en}</h1>
          <p className="font-bangla text-[11pt]">{tenant.name_bn}</p>
          <p className="mt-1 text-[8pt] text-black/60">{tenant.address_en}</p>
          <p className="mt-4 inline-block border border-black px-4 py-1.5 font-mono text-[8pt]">
            {label('For the year ended', 'সমাপ্ত বছরের জন্য')} {fs.period.end}
          </p>
          <p className="mt-3 text-[8pt]">
            {label('Reporting framework', 'প্রতিবেদন কাঠামো')}:{' '}
            <span className="font-semibold">{fs.framework.replaceAll('_', ' ')}</span>
          </p>
          <p className="text-[8pt] text-black/60">
            {label('Book filter', 'বই ফিল্টার')}: {fs.book_filter.replaceAll('_', ' ')} ·{' '}
            {label('Comparatives', 'তুলনামূলক')}: {comparativeLabel}
          </p>
        </div>

        <div className="mt-10 border-t border-black/40 pt-3">
          <p className="text-[9pt] font-bold">
            {label("Independent Auditor's Report", 'স্বাধীন নিরীক্ষকের প্রতিবেদন')}
          </p>
          <p className="mt-1 text-[7.5pt] leading-relaxed">
            <span className="font-semibold">{label('Opinion.', 'মতামত।')}</span>{' '}
            {label(
              `In our opinion, the accompanying financial statements give a true and fair view of the financial position of ${tenant.name_en} as at ${fs.period.end}, and of its financial performance and its cash flows for the year then ended in accordance with International Financial Reporting Standards as adopted by the Financial Reporting Council of Bangladesh.`,
              `আমাদের মতামতে, সংযুক্ত আর্থিক বিবরণীসমূহ ${fs.period.end} তারিখে প্রতিষ্ঠানের আর্থিক অবস্থান এবং ঐ বছর সমাপ্তকালের আর্থিক ফলাফল ও নগদ প্রবাহের যথাযথ ও ন্যায্য চিত্র উপস্থাপন করে, যা ফাইন্যান্সিয়াল রিপোর্টিং কাউন্সিল বাংলাদেশ কর্তৃক গৃহীত আন্তর্জাতিক আর্থিক প্রতিবেদন মান অনুসারে প্রস্তুত।`,
            )}
          </p>
          <p className="mt-1.5 text-[7.5pt] leading-relaxed">
            <span className="font-semibold">{label('Basis for opinion.', 'মতামতের ভিত্তি।')}</span>{' '}
            {label(
              'We conducted our audit in accordance with International Standards on Auditing. We are independent of the entity in accordance with the Code of Ethics for Professional Accountants issued by ICAB, and we have fulfilled our other ethical responsibilities.',
              'আমরা আন্তর্জাতিক নিরীক্ষা মান অনুযায়ী নিরীক্ষা পরিচালনা করেছি এবং আইসিএবি কর্তৃক জারিকৃত নৈতিক আচরণবিধি অনুযায়ী প্রতিষ্ঠান থেকে স্বাধীন।',
            )}
          </p>
          <p className="mt-1.5 text-[7.5pt] leading-relaxed">
            <span className="font-semibold">{label('Key audit matters.', 'মূল নিরীক্ষা বিষয়।')}</span>{' '}
            {label(
              'Revenue cut-off around the VAT tax-point dates, the completeness of output tax against Mushak 9.1, and the recoverability of trade receivables under the expected credit loss matrix.',
              'ভ্যাট কর-পয়েন্ট তারিখের আশপাশে রাজস্ব কাট-অফ, মুশক ৯.১-এর বিপরীতে আউটপুট করের সম্পূর্ণতা এবং প্রত্যাশিত ঋণক্ষতি ম্যাট্রিক্স অনুযায়ী প্রাপ্য হিসাবের আদায়যোগ্যতা।',
            )}
          </p>
          <div className="mt-5 flex items-end justify-between">
            <div className="text-[7.5pt]">
              <div className="h-9 w-[55mm] border-b border-black" />
              <p className="mt-1 font-semibold">Rafiq &amp; Associates</p>
              <p className="text-black/60">{label('Chartered Accountants, Dhaka', 'চার্টার্ড অ্যাকাউন্ট্যান্টস, ঢাকা')}</p>
            </div>
            <p className="font-mono text-[7pt] text-black/60">{ctx.today}</p>
          </div>
        </div>

        <div className="mt-4 border-t border-black/20 pt-1 text-[6pt] text-black/40">
          {label(
            'Demonstration pack generated from the live ledger — not a signed statutory filing.',
            'লাইভ লেজার থেকে তৈরি ডেমো প্যাক — স্বাক্ষরিত সংবিধিবদ্ধ দাখিল নয়।',
          )}
        </div>
      </PrintSheet>

      {/* Statement of financial position */}
      <PrintSheet>
        <StatementHeading
          title="Statement of Financial Position"
          titleBn="আর্থিক অবস্থানের বিবরণী"
          line={`${isBn ? 'IAS 1 ·' : 'IAS 1 ·'} ${label('as at', 'তারিখে')} ${fs.period.end}`}
          ctx={ctx}
        />
        <div className="mt-2 grid grid-cols-[1fr_28mm_28mm] items-baseline gap-x-2 border-b border-black pb-1 text-[7pt] font-semibold">
          <span />
          <span className="text-right font-mono">{currentLabel.slice(0, 9)}</span>
          <span className="text-right font-mono">{comparativeLabel.slice(0, 9)}</span>
        </div>
        <StatementSectionBlock
          section={fs.balance_sheet.assets_non_current}
          totalLabel={label('Total non-current assets', 'মোট অচলিত সম্পদ')}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.balance_sheet.assets_current}
          totalLabel={label('Total current assets', 'মোট চলতি সম্পদ')}
          ctx={ctx}
        />
        <div className="mt-1 flex justify-between border-y-2 border-black py-1 text-[8.5pt] font-bold">
          <span>{label('TOTAL ASSETS', 'মোট সম্পদ')}</span>
          <span className="flex gap-6">
            <span className="font-mono">{fmt(fs.balance_sheet.total_assets_poisha)}</span>
            <span className="font-mono text-black/50">
              {fmt(fs.balance_sheet.total_assets_comparative_poisha)}
            </span>
          </span>
        </div>

        <StatementSectionBlock
          section={fs.balance_sheet.equity}
          totalLabel={label('Total equity', 'মোট ইক্যুইটি')}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.balance_sheet.liabilities_non_current}
          totalLabel={label('Total non-current liabilities', 'মোট অচলিত দায়')}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.balance_sheet.liabilities_current}
          totalLabel={label('Total current liabilities', 'মোট চলতি দায়')}
          ctx={ctx}
        />
        <div className="mt-1 flex justify-between border-y-2 border-black py-1 text-[8.5pt] font-bold">
          <span>{label('TOTAL EQUITY & LIABILITIES', 'মোট ইক্যুইটি ও দায়')}</span>
          <span className="flex gap-6">
            <span className="font-mono">{fmt(fs.balance_sheet.total_equity_and_liabilities_poisha)}</span>
            <span className="font-mono text-black/50">
              {fmt(fs.balance_sheet.total_equity_and_liabilities_comparative_poisha)}
            </span>
          </span>
        </div>

        <p className="mt-2 text-[7pt]">
          {label('Balance check', 'ভারসাম্য যাচাই')}:{' '}
          <span className="font-mono">
            {fs.balance_sheet.balanced
              ? label('assets = equity + liabilities (0 difference)', 'সম্পদ = ইক্যুইটি + দায় (পার্থক্য ০)')
              : `${label('imbalance of', 'অসমতা')} ${fmt(fs.balance_sheet.imbalance_poisha)}`}
          </span>
        </p>
        <p className="mt-1 text-[6.5pt] leading-snug text-black/50">
          {label(
            'The financial statements are presented in Bangladesh Taka and have been prepared on the historical cost basis, except where otherwise stated in the notes.',
            'আর্থিক বিবরণী বাংলাদেশি টাকায় উপস্থাপিত এবং নোটে ভিন্নরূপ উল্লেখ না থাকলে ঐতিহাসিক ব্যয় ভিত্তিতে প্রস্তুত।',
          )}
        </p>
        <SignBlocks ctx={ctx} />
      </PrintSheet>

      {/* Statement of profit or loss (IFRS 18) */}
      <PrintSheet>
        <StatementHeading
          title="Statement of Profit or Loss"
          titleBn="লাভ-ক্ষতির বিবরণী"
          line={`IFRS 18 · ${label('for the year ended', 'সমাপ্ত বছরের জন্য')} ${fs.period.end}`}
          ctx={ctx}
        />
        <div className="mt-2 grid grid-cols-[1fr_28mm_28mm] items-baseline gap-x-2 border-b border-black pb-1 text-[7pt] font-semibold">
          <span />
          <span className="text-right font-mono">{currentLabel.slice(0, 9)}</span>
          <span className="text-right font-mono">{comparativeLabel.slice(0, 9)}</span>
        </div>
        <StatementSectionBlock
          section={fs.profit_or_loss.operating}
          totalLabel={label('Operating profit', 'পরিচালন মুনাফা')}
          totalOverride={fs.profit_or_loss.operating_profit_poisha}
          comparativeOverride={fs.profit_or_loss.operating_profit_comparative_poisha}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.profit_or_loss.investing}
          totalLabel={label('Net investing income', 'নিট বিনিয়োগ আয়')}
          ctx={ctx}
        />
        <div className="mt-1 flex justify-between border-y border-black py-1 text-[8pt] font-bold">
          <span>
            {label('Profit before financing & income taxes', 'অর্থায়ন ও আয়কর পূর্ব মুনাফা')}
          </span>
          <span className="flex gap-6">
            <span className="font-mono">{fmt(fs.profit_or_loss.profit_before_financing_tax_poisha)}</span>
            <span className="font-mono text-black/50">
              {fmt(fs.profit_or_loss.profit_before_financing_tax_comparative_poisha)}
            </span>
          </span>
        </div>
        <StatementSectionBlock
          section={fs.profit_or_loss.financing}
          totalLabel={label('Net financing costs', 'নিট অর্থায়ন ব্যয়')}
          ctx={ctx}
        />
        <div className="mt-1 flex justify-between border-y border-black py-1 text-[8pt] font-bold">
          <span>{label('Profit before tax', 'কর পূর্ব মুনাফা')}</span>
          <span className="flex gap-6">
            <span className="font-mono">{fmt(fs.profit_or_loss.profit_before_tax_poisha)}</span>
            <span className="font-mono text-black/50">
              {fmt(fs.profit_or_loss.profit_before_tax_comparative_poisha)}
            </span>
          </span>
        </div>
        <StatementSectionBlock
          section={fs.profit_or_loss.income_tax}
          totalLabel={label('Income tax expense', 'আয়কর ব্যয়')}
          ctx={ctx}
        />
        <div className="mt-1 flex justify-between border-y-2 border-black py-1.5 text-[9pt] font-bold">
          <span>{label('PROFIT FOR THE PERIOD', 'সময়কালের মুনাফা')}</span>
          <span className="flex gap-6">
            <span className="font-mono">{fmt(fs.profit_or_loss.profit_for_period_poisha)}</span>
            <span className="font-mono text-black/50">
              {fmt(fs.profit_or_loss.profit_for_period_comparative_poisha)}
            </span>
          </span>
        </div>

        <div className="mt-3 border border-black p-2">
          <p className="text-[7pt] font-semibold uppercase tracking-[0.1em] text-black/60">
            {label('Management performance measure — adjusted EBITDA reconciliation', 'ব্যবস্থাপনা কর্মক্ষমতা পরিমাপ — সমন্বিত ইবিআইটিডিএ')}
          </p>
          <table className="mt-1 w-full border-collapse text-[7.5pt]">
            <tbody>
              <tr className="border-b border-black/15">
                <td className="py-[2.5px]">{label('Operating profit (IFRS 18)', 'পরিচালন মুনাফা (আইএফআরএস ১৮)')}</td>
                <td className="py-[2.5px] text-right font-mono">
                  {fmt(fs.profit_or_loss.mpm.operating_profit_poisha)}
                </td>
              </tr>
              <tr className="border-b border-black/15">
                <td className="py-[2.5px]">{label('Add: depreciation & amortisation', 'যোগ: অবচয় ও ক্ষয়')}</td>
                <td className="py-[2.5px] text-right font-mono">{fmt(fs.profit_or_loss.mpm.depreciation_poisha)}</td>
              </tr>
              <tr className="border-b border-black/15">
                <td className="py-[2.5px]">{label('Add: expected credit loss charge', 'যোগ: প্রত্যাশিত ঋণক্ষতি')}</td>
                <td className="py-[2.5px] text-right font-mono">{fmt(fs.profit_or_loss.mpm.ecl_poisha)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-[2.5px]">{label('Adjusted EBITDA', 'সমন্বিত ইবিআইটিডিএ')}</td>
                <td className="py-[2.5px] text-right font-mono">
                  {fmt(fs.profit_or_loss.mpm.adjusted_ebitda_poisha)}
                </td>
              </tr>
              <tr>
                <td className="py-[2.5px]">{label('Operating margin', 'পরিচালন মার্জিন')}</td>
                <td className="py-[2.5px] text-right font-mono">
                  {(fs.profit_or_loss.mpm.operating_margin_bps / 100).toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <SignBlocks ctx={ctx} />
      </PrintSheet>

      {/* Changes in equity */}
      <PrintSheet>
        <StatementHeading
          title="Statement of Changes in Equity"
          titleBn="ইক্যুইটির পরিবর্তনের বিবরণী"
          line={`IAS 1 · ${label('for the year ended', 'সমাপ্ত বছরের জন্য')} ${fs.period.end}`}
          ctx={ctx}
        />
        <table className="mt-3 w-full border-collapse text-[7pt]">
          <thead>
            <tr className="border-y border-black bg-black/[0.06]">
              <th className="px-1 py-1 text-left">{label('Particulars', 'বিবরণ')}</th>
              <th className="px-1 py-1 text-right">{label('Share capital', 'শেয়ার মূলধন')}</th>
              <th className="px-1 py-1 text-right">{label('Retained earnings', 'সঞ্চিত মুনাফা')}</th>
              <th className="px-1 py-1 text-right">{label('Revaluation reserve', 'পুনর্মূল্যায়ন রিজার্ভ')}</th>
              <th className="px-1 py-1 text-right">{label('Total', 'মোট')}</th>
            </tr>
          </thead>
          <tbody>
            {fs.changes_in_equity.map((row) => (
              <tr key={row.row_id} className={`border-b border-black/15 ${row.is_total ? 'font-semibold' : ''}`}>
                <td className="px-1 py-[3px]">
                  {isBn ? row.label_bn : row.label_en}
                </td>
                <td className="px-1 py-[3px] text-right font-mono">{fmt(row.share_capital_poisha)}</td>
                <td className="px-1 py-[3px] text-right font-mono">{fmt(row.retained_earnings_poisha)}</td>
                <td className="px-1 py-[3px] text-right font-mono">{fmt(row.revaluation_poisha)}</td>
                <td className="px-1 py-[3px] text-right font-mono">{fmt(row.total_poisha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <SignBlocks ctx={ctx} />
      </PrintSheet>

      {/* Cash flows */}
      <PrintSheet>
        <StatementHeading
          title="Statement of Cash Flows"
          titleBn="নগদ প্রবাহের বিবরণী"
          line={`IAS 7 · ${label('indirect method · for the year ended', 'পরোক্ষ পদ্ধতি · সমাপ্ত বছরের জন্য')} ${fs.period.end}`}
          ctx={ctx}
        />
        <div className="mt-2 grid grid-cols-[1fr_28mm_28mm] items-baseline gap-x-2 border-b border-black pb-1 text-[7pt] font-semibold">
          <span />
          <span className="text-right font-mono">{currentLabel.slice(0, 9)}</span>
          <span className="text-right font-mono">{comparativeLabel.slice(0, 9)}</span>
        </div>
        <StatementSectionBlock
          section={fs.cash_flow.operating}
          totalLabel={label('Net cash from operating activities', 'পরিচালন কার্যক্রম থেকে নিট নগদ')}
          totalOverride={fs.cash_flow.operating_total_poisha}
          comparativeOverride={fs.cash_flow.operating_total_comparative_poisha}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.cash_flow.investing}
          totalLabel={label('Net cash used in investing activities', 'বিনিয়োগ কার্যক্রমে নিট নগদ')}
          totalOverride={fs.cash_flow.investing_total_poisha}
          comparativeOverride={fs.cash_flow.investing_total_comparative_poisha}
          ctx={ctx}
        />
        <StatementSectionBlock
          section={fs.cash_flow.financing}
          totalLabel={label('Net cash from financing activities', 'অর্থায়ন কার্যক্রম থেকে নিট নগদ')}
          totalOverride={fs.cash_flow.financing_total_poisha}
          comparativeOverride={fs.cash_flow.financing_total_comparative_poisha}
          ctx={ctx}
        />
        <div className="mt-1 space-y-[3px] border-t-2 border-black pt-1 text-[8pt]">
          <div className="flex justify-between">
            <span className="font-semibold">{label('Net increase / (decrease) in cash', 'নগদের নিট বৃদ্ধি / (হ্রাস)')}</span>
            <span className="flex gap-6 font-mono">
              <span>{fmt(fs.cash_flow.net_change_poisha)}</span>
              <span className="text-black/50">{fmt(fs.cash_flow.net_change_comparative_poisha)}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span>{label('Cash & cash equivalents at the beginning', 'প্রারম্ভিক নগদ ও নগদ সমতুল্য')}</span>
            <span className="flex gap-6 font-mono">
              <span>{fmt(fs.cash_flow.opening_cash_poisha)}</span>
              <span className="text-black/50">{fmt(fs.cash_flow.opening_cash_comparative_poisha)}</span>
            </span>
          </div>
          <div className="flex justify-between border-t border-black pt-1 font-bold">
            <span>{label('Cash & cash equivalents at the end', 'সমাপ্তিকালীন নগদ ও নগদ সমতুল্য')}</span>
            <span className="flex gap-6 font-mono">
              <span>{fmt(fs.cash_flow.closing_cash_poisha)}</span>
              <span className="text-black/50">{fmt(fs.cash_flow.closing_cash_comparative_poisha)}</span>
            </span>
          </div>
        </div>
        <p className="mt-2 text-[7pt]">
          {label('Reconciliation to the balance sheet', 'ব্যালেন্স শিটের সঙ্গে মিলকরণ')}:{' '}
          <span className="font-mono">
            {fs.cash_flow.reconciles
              ? label('reconciles (0 difference)', 'মিলিত (পার্থক্য ০)')
              : `${label('difference', 'পার্থক্য')} ${fmt(fs.cash_flow.difference_poisha)}`}
          </span>
        </p>
        <SignBlocks ctx={ctx} />
      </PrintSheet>

      {/* Notes */}
      <PrintSheet>
        <StatementHeading
          title="Notes to the Financial Statements"
          titleBn="আর্থিক বিবরণীর নোট"
          line={`${label('for the year ended', 'সমাপ্ত বছরের জন্য')} ${fs.period.end}`}
          ctx={ctx}
        />
        <div className="mt-3 space-y-2">
          {fs.notes.slice(0, 6).map((note) => (
            <div key={note.id} className="border-b border-black/15 pb-1.5">
              <p className="text-[8pt] font-semibold">
                {note.number}. {isBn ? note.title_bn : note.title_en}
              </p>
              <p className="mt-0.5 text-[7pt] leading-snug text-black/70">
                {isBn ? note.body_bn : note.body_en}
              </p>
              {note.rows.length > 0 ? (
                <table className="mt-1 w-full border-collapse text-[7pt]">
                  <tbody>
                    {note.rows.map((row) => (
                      <tr key={`${note.id}-${row.label_en}`} className="border-t border-black/10">
                        <td className="py-[2px]">{isBn ? row.label_bn : row.label_en}</td>
                        <td className="py-[2px] text-right font-mono">{fmt(row.amount_poisha)}</td>
                        <td className="w-[26mm] py-[2px] text-right font-mono text-black/50">
                          {fmt(row.comparative_poisha)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-black/30 pt-1 text-[6.5pt] text-black/50">
          {label(
            'The notes form an integral part of these financial statements and are auto-derived from the live journal array.',
            'নোটসমূহ এই আর্থিক বিবরণীর অবিচ্ছেদ্য অংশ এবং লাইভ জার্নাল অ্যারে থেকে স্বয়ংক্রিয়ভাবে তৈরি।',
          )}
        </div>
        <SignBlocks ctx={ctx} />
      </PrintSheet>

      {/* Trial balance */}
      <PrintSheet>
        <StatementHeading
          title="Annexure — Trial Balance"
          titleBn="সংযুক্তি — রেওয়ামিল"
          line={`${label('as at', 'তারিখে')} ${fs.period.end}`}
          ctx={ctx}
        />
        <table className="mt-2 w-full border-collapse text-[6.5pt]">
          <thead>
            <tr className="border-y border-black bg-black/[0.06]">
              <th className="px-1 py-[3px] text-left">{label('Code', 'কোড')}</th>
              <th className="px-1 py-[3px] text-left">{label('Account', 'হিসাব')}</th>
              <th className="px-1 py-[3px] text-right">{label('Opening Dr', 'প্রারম্ভিক ডেবিট')}</th>
              <th className="px-1 py-[3px] text-right">{label('Opening Cr', 'প্রারম্ভিক ক্রেডিট')}</th>
              <th className="px-1 py-[3px] text-right">{label('Closing Dr', 'সমাপনী ডেবিট')}</th>
              <th className="px-1 py-[3px] text-right">{label('Closing Cr', 'সমাপনী ক্রেডিট')}</th>
            </tr>
          </thead>
          <tbody>
            {fs.trial_balance
              .filter((row) => row.period_debit_poisha !== 0n || row.period_credit_poisha !== 0n)
              .map((row) => (
                <tr key={row.account_code} className="border-b border-black/10">
                  <td className="whitespace-nowrap px-1 py-[2px] font-mono">{row.account_code}</td>
                  <td className="px-1 py-[2px]">{isBn ? row.name_bn : row.name_en}</td>
                  <td className="px-1 py-[2px] text-right font-mono">
                    {row.opening_debit_poisha !== 0n ? fmt(row.opening_debit_poisha) : '—'}
                  </td>
                  <td className="px-1 py-[2px] text-right font-mono">
                    {row.opening_credit_poisha !== 0n ? fmt(row.opening_credit_poisha) : '—'}
                  </td>
                  <td className="px-1 py-[2px] text-right font-mono">
                    {row.closing_debit_poisha !== 0n ? fmt(row.closing_debit_poisha) : '—'}
                  </td>
                  <td className="px-1 py-[2px] text-right font-mono">
                    {row.closing_credit_poisha !== 0n ? fmt(row.closing_credit_poisha) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <SignBlocks ctx={ctx} />
      </PrintSheet>
    </>
  );
}

function StatementHeading({
  title,
  titleBn,
  line,
  ctx,
}: {
  title: string;
  titleBn: string;
  line: string;
  ctx: SheetContext;
}) {
  return (
    <>
      <div className="flex items-start justify-between border-b border-black pb-1">
        <div>
          <p className="text-[9pt] font-semibold leading-tight">{ctx.tenant.name_en}</p>
          <p className="font-bangla text-[7.5pt] leading-tight">{ctx.tenant.name_bn}</p>
          <p className="text-[6.5pt] text-black/60">{ctx.tenant.address_en}</p>
        </div>
        <div className="text-right text-[6.5pt] text-black/60">
          <p className="font-mono">BIN {ctx.binUnit?.bin_number ?? ctx.tenant.tin_number}</p>
          <p>{ctx.label('Figures in BDT', 'পরিসংখ্যান বিডিটি')}</p>
        </div>
      </div>
      <h2 className="mt-2 text-center text-[11pt] font-bold leading-tight">{title}</h2>
      <p className="text-center font-bangla text-[8.5pt]">{titleBn}</p>
      <p className="text-center text-[7pt] text-black/60">{line}</p>
    </>
  );
}

function StatementSectionBlock({
  section,
  totalLabel,
  totalOverride,
  comparativeOverride,
  ctx,
}: {
  section: StatementSection;
  totalLabel: string;
  totalOverride?: bigint;
  comparativeOverride?: bigint;
  ctx: SheetContext;
}) {
  const { money, isBn } = ctx;
  const fmt = (value: bigint): string => money(value, { symbol: false });
  const total = totalOverride ?? section.total_poisha;
  const comparative = comparativeOverride ?? section.comparative_total_poisha;
  return (
    <div className="mt-1.5">
      <p className="text-[7.5pt] font-semibold">
        {isBn ? section.title_bn : section.title_en}
      </p>
      <table className="w-full border-collapse text-[7pt]">
        <tbody>
          {section.lines.map((line) => (
            <tr key={line.id} className={line.is_subtotal ? 'font-semibold' : ''}>
              <td
                className="py-[1.5px] pr-2"
                style={{ paddingLeft: `${(line.indent ?? 0) * 3}mm` }}
              >
                {isBn ? line.label_bn : line.label_en}
                {line.note ? <span className="ml-1 text-[6pt] text-black/50">({line.note})</span> : null}
              </td>
              <td className="w-[28mm] py-[1.5px] text-right font-mono">{fmt(line.amount_poisha)}</td>
              <td className="w-[28mm] py-[1.5px] text-right font-mono text-black/50">
                {fmt(line.comparative_poisha)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-black/60 font-semibold">
            <td className="py-[2px] text-[7pt]">{totalLabel}</td>
            <td className="py-[2px] text-right font-mono">{fmt(total)}</td>
            <td className="py-[2px] text-right font-mono text-black/50">{fmt(comparative)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default StatutoryPrintModal;
