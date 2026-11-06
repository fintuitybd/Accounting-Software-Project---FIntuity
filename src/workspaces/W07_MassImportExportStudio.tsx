// Fintuity Accounting Suite — W07 Enterprise `.xlsx` / `.csv` import studio.
//
// Four production pipelines (bulk journals, sales & purchase, opening balances, bank/MFS) share one
// discipline: parse → simulate → show every row-level verdict → edit or exclude rows → commit as a
// hash-sealed journal batch → roll the whole batch back with linked reversal journals if needed.
// Nothing reaches the ledger until the simulation is balanced, and the pre-commit impact cards are
// computed from the exact same dry run that the committer consumes.

import { Fragment, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BadgeCheck,
  CheckCircle2,
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Layers,
  Pencil,
  Printer,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Undo2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

import { LedgerLensModal } from '../components/signature/LedgerLensModal';
import { StatutoryPrintModal } from '../components/signature/StatutoryPrintModal';
import {
  PIPELINE_COLUMNS,
  PIPELINE_LABEL,
  downloadSampleTemplateXlsx,
  exportFullAuditPackXlsx,
  exportSimulationCsv,
  generateDemoImportBatch,
  isPostableImportStatus,
  parseImportFile,
  type ImportSheetRow,
} from '../core/import-export/xlsxEngine';
import { formatDate } from '../core/money';
import { useVault } from '../context/VaultContext';
import type { ImportBatch, ImportPipeline, ImportRowStatus, ImportSimulation } from '../core/types';

const PIPELINES: ImportPipeline[] = ['BULK_JOURNAL', 'SALES_PURCHASE', 'OPENING_BALANCE', 'BANK_MFS'];
const ROW_PREVIEW_LIMIT = 60;

const STATUS_META: Record<ImportRowStatus, { en: string; bn: string; tone: string }> = {
  VALID: { en: 'VALID', bn: 'বৈধ', tone: 'lv-chip-emerald' },
  FIXED: { en: 'FIXED', bn: 'সংশোধিত', tone: 'lv-chip-emerald' },
  DUPLICATE_DOC_NO: { en: 'DUPLICATE_DOC', bn: 'নকল নথি', tone: 'lv-chip-rose' },
  DUPLICATE_DOC_WARNING: { en: 'DUPLICATE_DOC_WARNING', bn: 'নকল নথি সতর্কতা', tone: 'lv-chip-gold' },
  UNBALANCED_JOURNAL: { en: 'UNBALANCED_JOURNAL', bn: 'অসুষম জার্নাল', tone: 'lv-chip-rose' },
  INVALID_BIN_WARNING: { en: 'INVALID_BIN_WARNING', bn: 'বিআইএন সতর্কতা', tone: 'lv-chip-gold' },
  NO_TIN_PENALTY_UPSCALED: { en: 'NO_TIN_PENALTY_UPSCALED', bn: 'টিআইএন নেই — জরিমানা বৃদ্ধি', tone: 'lv-chip-gold' },
  CASH_OVER_100K_VAT_DISALLOWED: { en: 'CASH_OVER_100K_VAT_DISALLOWED', bn: '১ লাখের বেশি নগদ — ভ্যাট বাতিল', tone: 'lv-chip-gold' },
  INVALID_ACCOUNT: { en: 'INVALID_ACCOUNT', bn: 'অবৈধ হিসাব', tone: 'lv-chip-rose' },
  PERIOD_CLOSED: { en: 'PERIOD_CLOSED', bn: 'সময়কাল বন্ধ', tone: 'lv-chip-rose' },
  INVALID_DATE: { en: 'INVALID_DATE', bn: 'অবৈধ তারিখ', tone: 'lv-chip-rose' },
  TAX_ENGINE_REVIEW: { en: 'TAX_ENGINE_REVIEW', bn: 'কর পর্যালোচনা', tone: 'lv-chip-gold' },
};

interface EditField {
  key: string;
  label_en: string;
  label_bn: string;
  kind: 'text' | 'number' | 'date' | 'select';
  options?: string[];
}

const EDIT_FIELDS: Record<ImportPipeline, EditField[]> = {
  BULK_JOURNAL: [
    { key: 'journal_no', label_en: 'Journal no', label_bn: 'জার্নাল নম্বর', kind: 'text' },
    { key: 'date', label_en: 'Date', label_bn: 'তারিখ', kind: 'date' },
    { key: 'account_code', label_en: 'Account', label_bn: 'হিসাব', kind: 'text' },
    { key: 'debit', label_en: 'Debit', label_bn: 'ডেবিট', kind: 'number' },
    { key: 'credit', label_en: 'Credit', label_bn: 'ক্রেডিট', kind: 'number' },
  ],
  SALES_PURCHASE: [
    { key: 'doc_no', label_en: 'Document no', label_bn: 'নথি নম্বর', kind: 'text' },
    { key: 'date', label_en: 'Date', label_bn: 'তারিখ', kind: 'date' },
    { key: 'party_name', label_en: 'Party', label_bn: 'পক্ষ', kind: 'text' },
    { key: 'party_tin', label_en: 'e-TIN', label_bn: 'ই-টিআইএন', kind: 'text' },
    { key: 'base_amount', label_en: 'Base BDT', label_bn: 'বেস টাকা', kind: 'number' },
    { key: 'payment_method', label_en: 'Payment', label_bn: 'পরিশোধ', kind: 'select', options: ['BANK', 'MFS', 'CASH', 'CHEQUE'] },
  ],
  OPENING_BALANCE: [
    { key: 'account_code', label_en: 'Account', label_bn: 'হিসাব', kind: 'text' },
    { key: 'date', label_en: 'Date', label_bn: 'তারিখ', kind: 'date' },
    { key: 'debit', label_en: 'Debit', label_bn: 'ডেবিট', kind: 'number' },
    { key: 'credit', label_en: 'Credit', label_bn: 'ক্রেডিট', kind: 'number' },
  ],
  BANK_MFS: [
    { key: 'bank_account', label_en: 'Account', label_bn: 'হিসাব', kind: 'text' },
    { key: 'date', label_en: 'Date', label_bn: 'তারিখ', kind: 'date' },
    { key: 'description', label_en: 'Description', label_bn: 'বিবরণ', kind: 'text' },
    { key: 'receipt', label_en: 'Receipt', label_bn: 'প্রাপ্তি', kind: 'number' },
    { key: 'payment', label_en: 'Payment', label_bn: 'পরিশোধ', kind: 'number' },
  ],
};

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function bn(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);
}

function rowSummary(row: ImportSheetRow, pipeline: ImportPipeline): { primary: string; secondary: string } {
  if (pipeline === 'SALES_PURCHASE') {
    return {
      primary: String(row.doc_no ?? '—'),
      secondary: `${String(row.party_name ?? '—')} · ${String(row.payment_method ?? 'BANK')}`,
    };
  }
  if (pipeline === 'BULK_JOURNAL') {
    return {
      primary: String(row.journal_no ?? '—'),
      secondary: `${String(row.account_code ?? '—')} · ${String(row.narration ?? '')}`,
    };
  }
  if (pipeline === 'OPENING_BALANCE') {
    return { primary: String(row.account_code ?? '—'), secondary: String(row.narration ?? '') };
  }
  return { primary: String(row.description ?? '—'), secondary: String(row.reference ?? '') };
}

export default function W07_MassImportExportStudio() {
  const vault = useVault();
  const { locale, money, publishToast } = vault;
  const isBn = locale === 'bn-BD';
  const L = (en: string, bnText: string): string => (isBn ? bnText : en);

  const [pipeline, setPipeline] = useState<ImportPipeline>('SALES_PURCHASE');
  const [rawRows, setRawRows] = useState<ImportSheetRow[] | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [sourceName, setSourceName] = useState<string>('');
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [lensJournalId, setLensJournalId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastBatch, setLastBatch] = useState<ImportBatch | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<ImportBatch | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const meta = PIPELINE_LABEL[pipeline];
  const columns = PIPELINE_COLUMNS[pipeline];
  const editFields = EDIT_FIELDS[pipeline];

  const lensJournal = useMemo(
    () => (lensJournalId ? vault.journals.find((journal) => journal.id === lensJournalId) ?? null : null),
    [lensJournalId, vault.journals],
  );

  const simulation = useMemo<ImportSimulation | null>(
    () => (rawRows ? vault.simulateRows(rawRows, pipeline) : null),
    [rawRows, pipeline, vault.simulateRows],
  );

  const blockedRows = useMemo(
    () => (simulation ? simulation.rows.filter((row) => !isPostableImportStatus(row.status)) : []),
    [simulation],
  );
  const blockedIndices = useMemo(
    () => new Set(blockedRows.map((row) => row.row_number - 1)),
    [blockedRows],
  );

  // Rows the user excluded AND rows the validator blocked never enter the commit dry run, so the
  // impact cards describe exactly what will post — no surprises, no partially balanced batch.
  const commitRows = useMemo(
    () => (rawRows ? rawRows.filter((_, index) => !excluded.has(index) && !blockedIndices.has(index)) : []),
    [rawRows, excluded, blockedIndices],
  );

  const commitSimulation = useMemo<ImportSimulation | null>(
    () => (rawRows && commitRows.length > 0 ? vault.simulateRows(commitRows, pipeline) : null),
    [rawRows, commitRows, pipeline, vault.simulateRows],
  );

  const resetBatch = (): void => {
    setRawRows(null);
    setExcluded(new Set());
    setEditingRow(null);
    setSourceName('');
  };

  const selectPipeline = (next: ImportPipeline): void => {
    if (next === pipeline) return;
    setPipeline(next);
    resetBatch();
  };

  const ingest = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const rows = await parseImportFile(file);
      setRawRows(rows);
      setExcluded(new Set());
      setEditingRow(null);
      setSourceName(file.name);
      publishToast({
        tone: 'info',
        title: `${file.name} ${L('loaded', 'লোড হয়েছে')}`,
        message: `${rows.length} ${L('rows parsed — dry run running', 'সারি পার্স — ড্রাই রান চলছে')}`,
      });
    } catch (error) {
      publishToast({
        tone: 'error',
        title: L('File rejected', 'ফাইল প্রত্যাখ্যাত'),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await ingest(file);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await ingest(file);
  };

  const loadDemo = (): void => {
    try {
      const rows = generateDemoImportBatch(pipeline);
      setRawRows(rows);
      setExcluded(new Set());
      setEditingRow(null);
      setSourceName(`Fintuity Accounting Suite-live-demo-${pipeline.toLowerCase()}-25-rows.xlsx`);
      publishToast({
        tone: 'success',
        title: L('25-row live demo batch loaded', '২৫ সারির লাইভ ডেমো ব্যাচ লোড'),
        message: L('Every row was dry-run through the tax engine. Edit, exclude or commit.', 'প্রতিটি সারি কর ইঞ্জিন দিয়ে ড্রাই-রান হয়েছে। সম্পাদনা, বাদ বা কমিট করুন।'),
      });
    } catch (error) {
      publishToast({ tone: 'error', title: L('Demo failed', 'ডেমো ব্যর্থ'), message: String(error) });
    }
  };

  const updateCell = (rowIndex: number, key: string, kind: EditField['kind'], value: string): void => {
    setRawRows((current) => {
      if (!current) return current;
      const next = [...current];
      let stored: string | number = value;
      if (kind === 'number') {
        const parsed = Number(value);
        stored = Number.isFinite(parsed) ? parsed : 0;
      }
      next[rowIndex] = { ...next[rowIndex], [key]: stored };
      return next;
    });
  };

  const toggleRow = (rowIndex: number): void => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const excludeBlocked = (): void => {
    if (!simulation) return;
    setExcluded(
      new Set(
        simulation.rows
          .filter((row) => !isPostableImportStatus(row.status))
          .map((row) => row.row_number - 1),
      ),
    );
  };

  const commit = (): void => {
    if (!commitSimulation || committing) return;
    setCommitting(true);
    const result = vault.commitImportBatch(commitSimulation);
    if (result.ok && result.data) {
      setLastBatch(result.data);
      setExpandedBatch(result.data.id);
      resetBatch();
    }
    setCommitting(false);
  };

  const rollback = (batch: ImportBatch): void => {
    const result = vault.rollbackImportBatch(batch.id);
    setConfirmBatch(null);
    if (result.ok && result.data) {
      setLastBatch(result.data);
      setExpandedBatch(result.data.id);
    }
  };

  const exportAuditPack = (): void => {
    exportFullAuditPackXlsx({
      tenant: vault.tenant,
      statements: vault.statements,
      journals: vault.journals,
      commercialDocs: vault.commercialDocs,
      challans: vault.challans,
      accounts: vault.accounts,
      subledger: vault.reconciliation,
      auditChain: vault.auditChain,
    });
  };

  const batches = vault.importBatches;
  const previewRows = simulation ? simulation.rows.slice(0, ROW_PREVIEW_LIMIT) : [];
  const warningRows = simulation
    ? simulation.rows.filter((row) => isPostableImportStatus(row.status) && row.status !== 'VALID')
    : [];
  const included = commitSimulation;
  const commitReady = Boolean(included && included.valid_rows > 0 && included.balanced);

  const impact = included
    ? [
        { label: L('Total debits', 'মোট ডেবিট'), value: money(included.total_debit_poisha), icon: Banknote, tone: 'text-ink-900' },
        { label: L('Total credits', 'মোট ক্রেডিট'), value: money(included.total_credit_poisha), icon: Banknote, tone: 'text-ink-900' },
        { label: L('Output VAT', 'আউটপুট ভ্যাট'), value: money(included.output_vat_poisha), icon: ReceiptText, tone: 'text-vault-800' },
        { label: L('Claimable rebate', 'দাবিযোগ্য রিবেট'), value: money(included.input_vat_claimable_poisha), icon: BadgeCheck, tone: 'text-vault-800' },
        { label: L('VAT disallowed', 'বাতিল ভ্যাট'), value: money(included.disallowed_vat_poisha), icon: AlertTriangle, tone: 'text-amber-700' },
        { label: L('VDS generated', 'উৎপন্ন ভিডিএস'), value: money(included.vds_poisha), icon: ShieldCheck, tone: 'text-ink-900' },
        { label: L('TDS generated', 'উৎপন্ন টিডিএস'), value: money(included.tds_poisha), icon: ShieldCheck, tone: 'text-ink-900' },
        {
          label: L('Postable rows', 'পোস্টযোগ্য সারি'),
          value: `${included.valid_rows} / ${included.rows.length}`,
          icon: CheckCircle2,
          tone: included.balanced ? 'text-vault-800' : 'text-rose-600',
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* 1 — Pipeline + dropzone */}
      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><Layers size={12} /> {L('Enterprise import', 'এন্টারপ্রাইজ আমদানি')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Drop a spreadsheet, see every verdict before one poisha is posted', 'স্প্রেডশিট ফেলে দিন — এক পয়সা পোস্টের আগেই প্রতিটি রায় দেখুন')}
            </h2>
            <p className="lv-hint mt-1">{L(meta.description_en, meta.description_bn)}</p>
          </div>
          <span className="lv-chip lv-chip-neutral">
            <FileSpreadsheet size={12} /> {columns.length} {L('expected columns', 'প্রত্যাশিত কলাম')}
          </span>
        </div>

        <div className="grid gap-2 px-5 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          {PIPELINES.map((key) => {
            const active = key === pipeline;
            const label = PIPELINE_LABEL[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectPipeline(key)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-vault-700 bg-vault-900 text-white shadow-lift'
                    : 'border-ink-200 bg-white text-ink-800 hover:border-vault-300'
                }`}
              >
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-gold-300' : 'text-ink-400'}`}>
                  {key.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 text-[13px] font-semibold">{L(label.en, label.bn)}</p>
              </button>
            );
          })}
        </div>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

        <div className="px-5 py-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-7 text-center transition ${
              dragging ? 'border-vault-600 bg-vault-50' : 'border-ink-300 bg-ink-50/40 hover:border-vault-400'
            }`}
          >
            <span className={`grid h-11 w-11 place-items-center rounded-full ${dragging ? 'bg-vault-700 text-white' : 'bg-white text-vault-700 shadow-sm'}`}>
              <CloudUpload size={20} />
            </span>
            <p className="text-sm font-semibold text-ink-900">
              {dragging
                ? L('Release to parse the workbook', 'পার্স করতে ছেড়ে দিন')
                : L('Drag & drop your .xlsx or .csv here', 'এখানে .xlsx বা .csv টেনে ফেলুন')}
            </p>
            <p className="lv-hint">
              {L('Excel, CSV and Tally / QuickBooks exports up to 25,000 rows — parsed in the browser.', 'এক্সেল, সিএসভি ও ট্যালি / কুইকবুকস রপ্তানি ২৫,০০০ সারি পর্যন্ত — ব্রাউজারেই পার্স।')}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="lv-btn lv-btn-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> {busy ? L('Parsing…', 'পার্স হচ্ছে…') : L('Choose file', 'ফাইল বাছুন')}
              </button>
              <button type="button" className="lv-btn lv-btn-saffron" onClick={loadDemo}>
                <Sparkles size={14} /> {L('Load 25-Row Live Demo Batch (Instant Preview)', '২৫ সারির লাইভ ডেমো ব্যাচ লোড (তাৎক্ষণিক প্রিভিউ)')}
              </button>
              <button type="button" className="lv-btn lv-btn-secondary" onClick={() => downloadSampleTemplateXlsx(pipeline)}>
                <Download size={14} /> {L('Download Sample .XLSX Template', 'নমুনা .এক্সএলএসএক্স টেমপ্লেট')}
              </button>
            </div>
            {sourceName && (
              <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-vault-700">
                <FileSpreadsheet size={12} /> {sourceName}
                <button type="button" className="ml-1 text-ink-400 hover:text-rose-600" onClick={resetBatch} aria-label={L('Clear batch', 'ব্যাচ মুছুন')}>
                  <X size={12} />
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-ink-100 bg-ink-50/50 px-5 py-2.5">
          <p className="text-[11px] text-ink-500">
            <span className="font-semibold text-ink-700">{L('Expected columns', 'প্রত্যাশিত কলাম')}: </span>
            {columns.join(' · ')}
          </p>
        </div>
      </section>

      {simulation && (
        <>
          {/* 2 — Pre-commit impact cards */}
          <section className="lv-card overflow-hidden">
            <div className="lv-card-header">
              <div>
                <p className="lv-kicker flex items-center gap-1.5"><TableProperties size={12} /> {L('Pre-commit financial & tax impact', 'কমিট-পূর্ব আর্থিক ও কর প্রভাব')}</p>
                <h2 className="mt-1 text-base font-semibold text-ink-900">
                  {L('What this batch does to the ledger, before it does it', 'এই ব্যাচ খতিয়ানে যা করবে — করার আগেই')}
                </h2>
                <p className="lv-hint mt-1">
                  {simulation.valid_rows} {L('postable', 'পোস্টযোগ্য')} · {warningRows.length} {L('warnings', 'সতর্কতা')} · {blockedRows.length}{' '}
                  {L('blocking', 'বাধা')} · {excluded.size} {L('excluded by you', 'আপনার বাদ দেওয়া')}
                </p>
              </div>
              <span className={`lv-chip ${commitReady ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                {commitReady ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {commitReady ? L('Debits = credits', 'ডেবিট = ক্রেডিট') : L('Not committable', 'কমিটযোগ্য নয়')}
              </span>
            </div>
            <div className="grid gap-3 border-t border-ink-100 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
              {impact.map((tile) => (
                <div key={tile.label} className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
                  <p className="lv-kicker flex items-center gap-1"><tile.icon size={11} /> {tile.label}</p>
                  <p className={`font-money mt-1 text-[13px] font-semibold ${tile.tone}`}>{tile.value}</p>
                </div>
              ))}
            </div>

            {blockedRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-rose-100 bg-rose-50 px-5 py-2.5">
                <AlertTriangle size={13} className="text-rose-600" />
                <p className="text-[11px] leading-relaxed text-rose-900">
                  {L(
                    `${blockedRows.length} row(s) cannot be posted and are skipped automatically. Fix them inline or exclude them — the other rows still commit atomically.`,
                    `${blockedRows.length}টি সারি পোস্ট করা যাবে না এবং স্বয়ংক্রিয়ভাবে বাদ যাবে। ইনলাইন সংশোধন বা বাদ দিন — বাকি সারি একসাথে কমিট হবে।`,
                  )}
                </p>
              </div>
            )}
          </section>

          {/* 3 — Validation & simulation grid */}
          <section className="lv-card overflow-hidden">
            <div className="lv-card-header">
              <div>
                <p className="lv-kicker flex items-center gap-1.5"><ShieldCheck size={12} /> {L('Interactive validation grid', 'ইন্টারঅ্যাকটিভ যাচাই গ্রিড')}</p>
                <h2 className="mt-1 text-base font-semibold text-ink-900">
                  {L('Row-by-row verdicts, inline editing and row toggles', 'সারি-ভিত্তিক রায়, ইনলাইন সম্পাদনা ও সারি চালু/বন্ধ')}
                </h2>
                <p className="lv-hint mt-1">
                  {L('Every edit re-runs the same tax-engine dry run the commit will use.', 'প্রতিটি সম্পাদনা কমিটে ব্যবহৃত একই কর-ইঞ্জিন ড্রাই রান পুনরায় চালায়।')}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => exportSimulationCsv(simulation)}>
                  <Download size={12} /> {L('Dry-run CSV', 'ড্রাই-রান সিএসভি')}
                </button>
                <button
                  type="button"
                  className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={excludeBlocked}
                >
                  <AlertTriangle size={12} /> {L('Exclude blockers', 'বাধাগুলো বাদ দিন')}
                </button>
                <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setExcluded(new Set())}>
                  <CheckCircle2 size={12} /> {L('Include all', 'সব অন্তর্ভুক্ত')}
                </button>
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="lv-table min-w-[1080px]">
                <thead>
                  <tr>
                    <th className="w-10">{L('In', 'সহ')}</th>
                    <th className="w-10">#</th>
                    <th>{L('Document / narrative', 'নথি / বিবরণ')}</th>
                    <th>{L('Date', 'তারিখ')}</th>
                    <th className="text-right">{L('Amount', 'পরিমাণ')}</th>
                    <th className="text-right">VAT</th>
                    <th className="text-right">VDS</th>
                    <th className="text-right">TDS</th>
                    <th>{L('Status', 'অবস্থা')}</th>
                    <th>{L('Verdict', 'রায়')}</th>
                    <th className="w-24 text-right">{L('Action', 'কার্যক্রম')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const rowIndex = row.row_number - 1;
                    const statusMeta = STATUS_META[row.status];
                    const summary = rowSummary(row.raw, pipeline);
                    const isExcluded = excluded.has(rowIndex);
                    const note = row.errors[0] ?? row.warnings[0] ?? '—';
                    const editing = editingRow === row.row_number;
                    return (
                      <Fragment key={`row-${row.row_number}`}>
                        <tr key={`row-${row.row_number}`} className={isExcluded ? 'opacity-45' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleRow(rowIndex)}
                              className="h-3.5 w-3.5 accent-vault-700"
                              aria-label={L('Include row', 'সারি অন্তর্ভুক্ত')}
                            />
                          </td>
                          <td className="font-mono text-[10px] text-ink-400">{row.row_number}</td>
                          <td>
                            <p className="font-mono text-[11px] font-semibold text-ink-900">{summary.primary}</p>
                            <p className="max-w-[240px] truncate text-[10px] text-ink-500" title={summary.secondary}>{summary.secondary}</p>
                          </td>
                          <td className="text-[11px] text-ink-600">{String(row.raw.date ?? '—')}</td>
                          <td className="font-money text-right text-[11px] font-semibold text-ink-900">{money(row.amount_poisha)}</td>
                          <td className="font-money text-right text-[11px] text-ink-600">{money(row.vat_poisha)}</td>
                          <td className="font-money text-right text-[11px] text-ink-600">{money(row.vds_poisha)}</td>
                          <td className="font-money text-right text-[11px] text-ink-600">{money(row.tds_poisha)}</td>
                          <td>
                            <span className={`lv-chip ${statusMeta.tone} !px-1.5 !py-0 text-[9px]`}>{L(statusMeta.en, statusMeta.bn)}</span>
                          </td>
                          <td className={`max-w-[260px] truncate text-[10px] ${row.errors.length ? 'text-rose-600' : 'text-amber-700'}`} title={note}>
                            {note}
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              className="lv-btn lv-btn-ghost !px-1.5 !py-0.5 text-[10px]"
                              onClick={() => setEditingRow(editing ? null : row.row_number)}
                            >
                              <Pencil size={10} /> {editing ? L('Close', 'বন্ধ') : L('Edit', 'সম্পাদনা')}
                            </button>
                          </td>
                        </tr>
                        {editing && (
                          <tr key={`edit-${row.row_number}`} className="bg-vault-50/70">
                            <td colSpan={11}>
                              <div className="grid gap-2 py-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                                {editFields.map((field) => (
                                  <label key={field.key} className="block">
                                    <span className="text-[9px] font-semibold uppercase tracking-wide text-vault-700">{L(field.label_en, field.label_bn)}</span>
                                    {field.kind === 'select' ? (
                                      <select
                                        value={String(row.raw[field.key] ?? field.options?.[0] ?? '')}
                                        onChange={(event) => updateCell(rowIndex, field.key, field.kind, event.target.value)}
                                        className="lv-input mt-0.5 w-full !py-1 text-[11px]"
                                      >
                                        {(field.options ?? []).map((option) => (
                                          <option key={option} value={option}>{option}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        value={String(row.raw[field.key] ?? '')}
                                        onChange={(event) => updateCell(rowIndex, field.key, field.kind, event.target.value)}
                                        inputMode={field.kind === 'number' ? 'decimal' : undefined}
                                        className="lv-input mt-0.5 w-full !py-1 font-mono text-[11px]"
                                      />
                                    )}
                                  </label>
                                ))}
                                <div className="flex items-end justify-end">
                                  <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[10px]" onClick={() => setEditingRow(null)}>
                                    <CheckCircle2 size={11} /> {L('Re-run dry run', 'ড্রাই রান পুনরায়')}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3">
              <p className="lv-hint">
                {simulation.rows.length > ROW_PREVIEW_LIMIT
                  ? L(`Showing ${ROW_PREVIEW_LIMIT} of ${simulation.rows.length} rows`, `${simulation.rows.length}-এর মধ্যে ${ROW_PREVIEW_LIMIT} সারি`)
                  : L(
                      `${simulation.rows.length} rows · ${excluded.size} excluded by you · ${blockedRows.length} blocked (auto-skipped) · ${included?.rows.length ?? 0} will post`,
                      `${simulation.rows.length} সারি · ${excluded.size} আপনার বাদ · ${blockedRows.length} অবরুদ্ধ (স্বয়ংক্রিয় বাদ) · ${included?.rows.length ?? 0} পোস্ট হবে`,
                    )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="lv-btn lv-btn-secondary" disabled={!commitReady || committing} onClick={commit}>
                  <ArrowUpRight size={14} />{' '}
                  {L(
                    `Commit ${included?.valid_rows ?? 0} rows to the live ledger`,
                    `${included?.valid_rows ?? 0} সারি লাইভ খতিয়ানে কমিট`,
                  )}
                </button>
              </div>
            </div>
            {!commitReady && (
              <p className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-[11px] text-amber-800">
                <Info size={11} className="mr-1 inline" />
                {L(
                  'Commit unlocks when at least one included row is postable and the batch balances to the poisha.',
                  'অন্তত একটি অন্তর্ভুক্ত সারি পোস্টযোগ্য এবং ব্যাচ পয়সা পর্যন্ত সুষম হলে কমিট সক্রিয় হয়।',
                )}
              </p>
            )}
          </section>
        </>
      )}

      {/* 4 — Most recent batch */}
      {lastBatch && (
        <section className={`lv-card lv-card-pad border-l-4 ${lastBatch.status === 'ROLLED_BACK' ? 'border-rose-400' : 'border-vault-600'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="lv-kicker">{L('Most recent batch', 'সর্বশেষ ব্যাচ')}</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {lastBatch.id} · {lastBatch.file_name}
              </p>
              <p className="lv-hint mt-0.5">
                {lastBatch.row_count} {L('rows', 'সারি')} · {money(lastBatch.total_debit_poisha)} {L('debit', 'ডেবিট')} ·{' '}
                {lastBatch.journal_ids.length} {L('journals created', 'জার্নাল তৈরি')} ·{' '}
                <span className={lastBatch.status === 'ROLLED_BACK' ? 'text-rose-600' : 'text-vault-700'}>{lastBatch.status}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {lastBatch.journal_ids.slice(0, 4).map((journalId) => {
                const journal = vault.journals.find((entry) => entry.id === journalId);
                if (!journal) return null;
                return (
                  <button key={journalId} type="button" className="lv-chip lv-chip-neutral hover:bg-vault-50" onClick={() => setLensJournalId(journalId)}>
                    {journal.journal_number} ↗
                  </button>
                );
              })}
              {lastBatch.status === 'COMMITTED' && (
                <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setConfirmBatch(lastBatch)}>
                  <Undo2 size={12} /> {L('Undo this batch', 'এই ব্যাচ আনডু')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 5 — Batch history */}
      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker flex items-center gap-1.5"><History size={12} /> {L('Batch history', 'ব্যাচ ইতিহাস')}</p>
            <h2 className="mt-1 text-base font-semibold text-ink-900">
              {L('Every commit, with a working rollback', 'প্রতিটি কমিট, কার্যকর রোলব্যাকসহ')}
            </h2>
            <p className="lv-hint mt-1">
              {L(
                'A rollback never deletes: it posts linked reversal journals, withdraws the imported documents and frees the registers.',
                'রোলব্যাক কিছু মুছে ফেলে না — সংযুক্ত রিভার্সাল জার্নাল পোস্ট করে, আমদানি নথি প্রত্যাহার করে ও রেজিস্টার মুক্ত করে।',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="lv-chip lv-chip-neutral">{batches.length} {L('batches', 'ব্যাচ')}</span>
            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={exportAuditPack}>
              <FileText size={12} /> {L('9-tab audit workbook', '৯-ট্যাব অডিট ওয়ার্কবুক')}
            </button>
            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setPrintOpen(true)}>
              <Printer size={12} /> {L('Statutory print', 'বিধিবদ্ধ প্রিন্ট')}
            </button>
          </div>
        </div>

        {batches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            {L('No batch committed yet. Load the 25-row demo and commit it — then roll it back.', 'এখনো কোনো ব্যাচ কমিট হয়নি। ২৫ সারির ডেমো লোড করে কমিট করুন — তারপর রোলব্যাক করুন।')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="lv-table min-w-[900px]">
              <thead>
                <tr>
                  <th>{L('Batch', 'ব্যাচ')}</th>
                  <th>{L('Pipeline', 'পাইপলাইন')}</th>
                  <th>{L('Committed', 'কমিট')}</th>
                  <th className="text-right">{L('Rows', 'সারি')}</th>
                  <th className="text-right">{L('Debit', 'ডেবিট')}</th>
                  <th className="text-right">{L('VAT', 'ভ্যাট')}</th>
                  <th>{L('Status', 'অবস্থা')}</th>
                  <th className="text-right">{L('Action', 'কার্যক্রম')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const expanded = expandedBatch === batch.id;
                  return (
                    <Fragment key={batch.id}>
                      <tr key={batch.id} className={expanded ? 'bg-vault-50/60' : ''}>
                        <td>
                          <button type="button" className="text-left" onClick={() => setExpandedBatch(expanded ? null : batch.id)}>
                            <p className="font-mono text-[11px] font-semibold text-ink-800">{batch.id} {expanded ? '▾' : '▸'}</p>
                            <p className="max-w-[220px] truncate text-[10px] text-ink-500">{batch.file_name}</p>
                          </button>
                        </td>
                        <td className="text-[11px] text-ink-700">{L(PIPELINE_LABEL[batch.pipeline].en, PIPELINE_LABEL[batch.pipeline].bn)}</td>
                        <td className="text-[11px] text-ink-600">{formatDate(batch.committed_at.slice(0, 10), locale)}</td>
                        <td className="font-money text-right text-[11px]">{batch.row_count}</td>
                        <td className="font-money text-right text-[11px]">{money(batch.total_debit_poisha)}</td>
                        <td className="font-money text-right text-[11px]">{money(batch.output_vat_poisha)}</td>
                        <td>
                          <span className={`lv-chip ${batch.status === 'COMMITTED' ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>{batch.status}</span>
                        </td>
                        <td className="text-right">
                          {batch.status === 'COMMITTED' ? (
                            <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setConfirmBatch(batch)}>
                              <RotateCcw size={12} /> {L('Rollback / Undo Entire Batch', 'সম্পূর্ণ ব্যাচ রোলব্যাক / আনডু')}
                            </button>
                          ) : (
                            <span className="text-[10px] text-ink-400">
                              {batch.rollback_journal_ids?.length ?? 0} {L('reversals', 'রিভার্সাল')}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${batch.id}-detail`} className="bg-vault-50/40">
                          <td colSpan={8}>
                            <div className="grid gap-3 py-1 sm:grid-cols-2 xl:grid-cols-4">
                              <div>
                                <p className="lv-kicker">{L('Credits', 'ক্রেডিট')}</p>
                                <p className="font-money mt-0.5 text-[12px]">{money(batch.total_credit_poisha)}</p>
                              </div>
                              <div>
                                <p className="lv-kicker">{L('Claimable rebate', 'দাবিযোগ্য রিবেট')}</p>
                                <p className="font-money mt-0.5 text-[12px]">{money(batch.input_vat_claimable_poisha)}</p>
                              </div>
                              <div>
                                <p className="lv-kicker">{L('VDS / TDS', 'ভিডিএস / টিডিএস')}</p>
                                <p className="font-money mt-0.5 text-[12px]">{money(batch.vds_poisha)} / {money(batch.tds_poisha)}</p>
                              </div>
                              <div>
                                <p className="lv-kicker">{L('Posted by', 'পোস্ট করেছেন')}</p>
                                <p className="mt-0.5 text-[12px]">{batch.committed_by}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-vault-100 pt-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-vault-700">
                                {L('Linked journals', 'সংযুক্ত জার্নাল')}
                              </span>
                              {batch.journal_ids.slice(0, 8).map((journalId) => {
                                const journal = vault.journals.find((entry) => entry.id === journalId);
                                if (!journal) return null;
                                return (
                                  <button key={journalId} type="button" className="lv-chip lv-chip-neutral hover:bg-white" onClick={() => setLensJournalId(journalId)}>
                                    {journal.journal_number} ↗
                                  </button>
                                );
                              })}
                              {batch.journal_ids.length > 8 && (
                                <span className="text-[10px] text-ink-400">+{batch.journal_ids.length - 8}</span>
                              )}
                              {batch.status === 'ROLLED_BACK' && (
                                <span className="ml-auto text-[10px] text-rose-600">
                                  {L('Rolled back', 'রোলব্যাক হয়েছে')} {batch.rolled_back_at ? formatDate(batch.rolled_back_at.slice(0, 10), locale) : ''}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Rollback confirmation */}
      {confirmBatch && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <p className="lv-kicker flex items-center gap-1.5 text-rose-600"><Undo2 size={12} /> {L('Reverse an entire batch', 'সম্পূর্ণ ব্যাচ রিভার্স')}</p>
            <h3 className="mt-1 text-sm font-semibold text-ink-900">
              {L('Roll back', 'রোলব্যাক')} {confirmBatch.id}?
            </h3>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
              {L(
                `${confirmBatch.journal_ids.length} journal(s) will be reversed with linked entries, the ${confirmBatch.row_count} imported rows will be withdrawn from the registers and the ledger returns to its pre-batch position. Nothing is deleted from the hash chain.`,
                `${confirmBatch.journal_ids.length}টি জার্নাল সংযুক্ত এন্ট্রি দিয়ে রিভার্স হবে, ${confirmBatch.row_count}টি আমদানি সারি রেজিস্টার থেকে প্রত্যাহার হবে এবং খতিয়ান ব্যাচ-পূর্ব অবস্থায় ফিরবে। হ্যাশ চেইন থেকে কিছু মুছে ফেলা হয় না।`,
              )}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" className="lv-btn lv-btn-ghost" onClick={() => setConfirmBatch(null)}>
                {L('Cancel', 'বাতিল')}
              </button>
              <button type="button" className="lv-btn lv-btn-primary" onClick={() => rollback(confirmBatch)}>
                <RotateCcw size={14} /> {L('Rollback / Undo Entire Batch', 'সম্পূর্ণ ব্যাচ রোলব্যাক / আনডু')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[10px] text-ink-400">
          {L(
            `Ledger now holds ${vault.journals.length} journals · every imported row carries the batch id for lineage.`,
            `খতিয়ানে এখন ${bn(vault.journals.length)}টি জার্নাল · প্রতিটি আমদানি সারি বংশতালিকার জন্য ব্যাচ আইডি বহন করে।`,
          )}
        </p>
        <button type="button" className="lv-btn lv-btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setPrintOpen(true)}>
          <ArrowRight size={12} /> {L('Open statutory print workspace', 'বিধিবদ্ধ প্রিন্ট ওয়ার্কস্পেস')}
        </button>
      </div>

      <LedgerLensModal journal={lensJournal} onClose={() => setLensJournalId(null)} open={lensJournal !== null} />
      <StatutoryPrintModal open={printOpen} onClose={() => setPrintOpen(false)} mode="MUSHAK_9_1" periodCode={vault.statements.period.code} />
    </div>
  );
}
