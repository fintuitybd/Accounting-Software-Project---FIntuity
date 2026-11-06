import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Download, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { buildCsv, parseBufferToRows } from '../../core/import-export/xlsxEngine';
import type { BankStatement, BankStatementPreview, BankStatementPreviewRow } from '../../banking/api';
import { bankingApi } from '../../banking/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice, poishaToBdtString } from '../setup/setupUi';
import { formatDate, newKey } from './bankingUi';

const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ROWS = 5_000;

function templateCsv(): string {
  const today = new Date();
  const previous = new Date(today.getTime() - 86_400_000);
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  return [
    'date,description,reference,debit,credit,balance',
    `${iso(previous)},Customer receipt via bank,RCPT-001,1250.00,,11250.00`,
    `${iso(today)},Bank charge,CHG-001,,50.00,11200.00`,
  ].join('\n');
}

const TEMPLATE = templateCsv();

const MAPPING_FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'reference', label: 'Reference', required: false },
  { key: 'debit', label: 'Debit / deposit (money in)', required: true },
  { key: 'credit', label: 'Credit / withdrawal (money out)', required: true },
  { key: 'balance', label: 'Running balance', required: false },
] as const;

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function workbookSheetToCsv(buffer: ArrayBuffer): Promise<string> {
  const rows = await parseBufferToRows(buffer);
  if (rows.length === 0) throw new Error('The workbook has no worksheet or is empty.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`The worksheet has more than ${MAX_IMPORT_ROWS} rows. Split the statement before importing.`);
  }
  return buildCsv(rows);
}

function downloadTemplate(): void {
  const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bank-statement-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportPanel({
  companyId,
  bankAccountId,
  bankName,
  canPost,
  onImported,
}: {
  companyId: string;
  bankAccountId: string;
  bankName: string;
  canPost: boolean;
  onImported: () => void;
}) {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('text/csv');
  const [preview, setPreview] = useState<BankStatementPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!companyId || !bankAccountId) return;
    setLoadingHistory(true);
    try {
      const response = await bankingApi.statements(companyId, bankAccountId, { limit: 25 });
      setStatements(response.entries);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoadingHistory(false);
    }
  }, [companyId, bankAccountId]);

  useEffect(() => {
    setPreview(null);
    setContent('');
    setFileName('');
    setNotice(null);
    setError(null);
    void loadHistory();
  }, [bankAccountId, loadHistory]);

  const parseFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError(
        `The statement file is larger than ${Math.round(MAX_IMPORT_BYTES / 1000)} KB. Split it into smaller files; nothing was imported.`,
      );
      event.target.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      let text = '';
      let mime = 'text/csv';
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        text = await workbookSheetToCsv(await file.arrayBuffer());
        mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        text = await file.text();
      }
      setContent(text);
      setFileName(file.name);
      setMimeType(mime);
      const response = await bankingApi.preview(companyId, bankAccountId, { content: text });
      setPreview(response.preview);
      setMapping(response.preview.mapping);
      setNotice(
        `Parsed ${response.preview.summary.rowCount} row(s): ${response.preview.summary.validCount} valid, ${response.preview.summary.errorCount} error row(s), ${response.preview.summary.duplicateCount} duplicate(s).`,
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setContent('');
      setFileName('');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const rerunPreview = async (): Promise<void> => {
    if (!content) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.preview(companyId, bankAccountId, {
        content,
        mapping,
      });
      setPreview(response.preview);
      setMapping(response.preview.mapping);
      setNotice(
        `Preview refreshed: ${response.preview.summary.validCount} valid row(s), ${response.preview.summary.errorCount} error row(s).`,
      );
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const commit = async (): Promise<void> => {
    if (!content || !preview) return;
    if (
      !window.confirm(
        `Import ${preview.summary.validCount} valid row(s) from ${fileName}?\n\nThe source file is retained as evidence. No journal will be posted. Duplicate and invalid rows remain in the import error record.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.import(
        companyId,
        bankAccountId,
        {
          content,
          sourceFileName: fileName || 'statement.csv',
          sourceMimeType: mimeType,
          mapping,
        },
        newKey('bank-statement-import'),
      );
      setNotice(
        `Statement imported as ${response.statement.status}: ${response.statement.validCount} line(s) stored, ${response.statement.errorCount} error row(s), ${response.statement.duplicateCount} duplicate(s). No journal was posted.`,
      );
      setPreview(null);
      setContent('');
      setFileName('');
      await loadHistory();
      onImported();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const errorRows = useMemo(
    () => preview?.rows.filter((row) => row.errors.length > 0) ?? [],
    [preview],
  );
  const validRows = useMemo(
    () => preview?.rows.filter((row) => row.errors.length === 0) ?? [],
    [preview],
  );

  if (!canPost) {
    return (
      <Notice
        message="Your role can view imported statements but cannot import or preview a new file. Ask an accountant, controller or administrator."
        tone="warning"
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="lv-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="lv-kicker">Statement evidence</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">Import a bank or MFS statement</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              The template is the documented CSV/XLSX mapping. Money in is <strong>debit/deposit</strong>; money out is{' '}
              <strong>credit/withdrawal</strong>. The imported source is retained and never edited. Import does not post,
              auto-match or create a fee.
            </p>
          </div>
          <button type="button" onClick={downloadTemplate} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <Download size={15} /> CSV template
          </button>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

        <div className="mt-4 rounded-2xl border border-dashed border-line bg-surface-2/40 p-4">
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 text-center">
            <UploadCloud size={24} className="text-brand-bright" />
            <span className="text-[14px] font-semibold text-ink-800">
              {busy ? 'Reading and validating…' : 'Choose a CSV or XLSX statement'}
            </span>
            <span className="text-[12px] text-ink-500">
              {fileName ? `${fileName} · ${mimeType.includes('sheet') ? 'XLSX converted to CSV in the browser' : 'CSV'}` : 'Maximum 5 MB and 5,000 rows. XLSX is converted to CSV in the browser before upload.'}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => void parseFile(event)}
              disabled={busy}
            />
          </label>
        </div>

        {preview ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="lv-kicker">Column mapping</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {MAPPING_FIELDS.map((entry) => (
                  <Field key={entry.key} label={entry.label} required={entry.required}>
                    <select
                      className={INPUT_CLASS}
                      value={mapping[entry.key] ?? ''}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [entry.key]: event.target.value }))
                      }
                    >
                      <option value="">{entry.required ? 'Choose a column' : 'Not supplied'}</option>
                      {preview.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void rerunPreview()} disabled={busy} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Refresh preview
                </button>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={busy || preview.summary.validCount === 0}
                  className="lv-btn lv-btn-primary min-h-11 text-[13px]"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />} Import {preview.summary.validCount} line(s)
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { label: 'Rows', value: preview.summary.rowCount },
                { label: 'Valid', value: preview.summary.validCount },
                { label: 'Errors', value: preview.summary.errorCount },
                { label: 'Duplicates', value: preview.summary.duplicateCount },
              ].map((entry) => (
                <div key={entry.label} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2">
                  <p className="text-[12px] uppercase tracking-[0.08em] text-ink-400">{entry.label}</p>
                  <p className="font-money mt-1 text-[18px] font-semibold text-ink-900">{entry.value}</p>
                </div>
              ))}
            </div>

            {errorRows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-rose-200">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <caption className="sr-only">Rows rejected from the statement import</caption>
                  <thead className="bg-rose-50 text-rose-800">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Row</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100">
                    {errorRows.slice(0, 50).map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.date ?? '—'}</td>
                        <td className="max-w-[260px] truncate px-3 py-2">{row.description ?? '—'}</td>
                        <td className="px-3 py-2 text-rose-700">
                          {row.errors.map((entry) => `${entry.field}: ${entry.message}`).join(' ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {validRows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <caption className="sr-only">Valid statement rows ready to import</caption>
                  <thead className="bg-surface-2/60 text-ink-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Row</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Reference</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Debit</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {validRows.slice(0, 50).map((row: BankStatementPreviewRow) => (
                      <tr key={row.rowNumber}>
                        <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.date ?? '—'}</td>
                        <td className="max-w-[260px] truncate px-3 py-2">{row.description ?? '—'}</td>
                        <td className="px-3 py-2 font-mono">{row.reference ?? '—'}</td>
                        <td className="font-money px-3 py-2 text-right text-emerald-700">{row.debitPoisha && row.debitPoisha !== '0' ? poishaToBdtString(row.debitPoisha) : '—'}</td>
                        <td className="font-money px-3 py-2 text-right text-rose-700">{row.creditPoisha && row.creditPoisha !== '0' ? poishaToBdtString(row.creditPoisha) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.truncated ? (
                  <p className="border-t border-line px-3 py-2 text-[12px] text-ink-400">
                    The preview stops at {preview.limits.previewRows} rows. Import still validates the full file up to {preview.limits.maxRows} rows.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="lv-card overflow-hidden">
        <div className="lv-card-header">
          <div>
            <p className="lv-kicker">Import batches</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">{bankName}</h2>
          </div>
          <span className="lv-chip lv-chip-neutral">{statements.length} batch(es)</span>
        </div>
        {loadingHistory ? (
          <p className="px-4 py-6 text-[13px] text-ink-500">Loading import history…</p>
        ) : statements.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-500">No statement has been imported for this account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12px]">
              <caption className="sr-only">Statement import history</caption>
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">File</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Imported</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Rows</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Valid</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Errors</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Duplicates</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {statements.map((statement) => (
                  <tr key={statement.id}>
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-semibold text-ink-900">{statement.sourceFileName}</td>
                    <td className="px-3 py-2.5">
                      {formatDate(statement.importedAt)} · {statement.importedByName}
                    </td>
                    <td className="px-3 py-2.5">{statement.status}</td>
                    <td className="font-money px-3 py-2.5 text-right">{statement.rowCount}</td>
                    <td className="font-money px-3 py-2.5 text-right text-emerald-700">{statement.validCount}</td>
                    <td className="font-money px-3 py-2.5 text-right text-rose-700">{statement.errorCount}</td>
                    <td className="font-money px-3 py-2.5 text-right text-amber-700">{statement.duplicateCount}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-400">{statement.sourceFileHash.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
