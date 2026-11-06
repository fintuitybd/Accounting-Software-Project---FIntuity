import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import { bdtToPoisha, formatPoisha } from '../../core/money';
import { setupApi, type FiscalPeriod, type OpeningBatch, type SetupAccount } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';

interface EditorLine {
  key: string;
  accountId: string;
  scheduleType: string;
  name: string;
  reference: string;
  dueDate: string;
  quantity: string;
  unitCost: string;
  assetClass: string;
  usefulLifeMonths: string;
  accumulatedDepreciation: string;
  debit: string;
  credit: string;
  memo: string;
}

function lineKey(): string {
  return `line-${Math.random().toString(36).slice(2, 10)}`;
}

function blankLine(): EditorLine {
  return {
    key: lineKey(),
    accountId: '',
    scheduleType: 'ACCOUNT',
    name: '',
    reference: '',
    dueDate: '',
    quantity: '',
    unitCost: '',
    assetClass: '',
    usefulLifeMonths: '',
    accumulatedDepreciation: '',
    debit: '',
    credit: '',
    memo: '',
  };
}

function fromBatch(batch: OpeningBatch): EditorLine[] {
  return batch.lines.map((line) => ({
    key: line.id,
    accountId: line.accountId,
    scheduleType: line.scheduleType,
    name: line.schedule.name ?? '',
    reference: line.schedule.reference ?? '',
    dueDate: line.schedule.dueDate ?? '',
    quantity: line.schedule.quantity ?? '',
    unitCost: line.schedule.unitCost ?? '',
    assetClass: line.schedule.assetClass ?? '',
    usefulLifeMonths: line.schedule.usefulLifeMonths?.toString() ?? '',
    accumulatedDepreciation: line.schedule.accumulatedDepreciation ?? '',
    debit: line.debitBdt,
    credit: line.creditBdt,
    memo: line.memo ?? '',
  }));
}

function parseAmount(value: string): bigint | null {
  if (!value.trim()) return 0n;
  try {
    const parsed = bdtToPoisha(value);
    return parsed < 0n ? null : parsed;
  } catch {
    return null;
  }
}

function schedulePayload(line: EditorLine): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (line.name.trim()) payload.name = line.name.trim();
  if (line.reference.trim()) payload.reference = line.reference.trim();
  if (line.dueDate) payload.dueDate = line.dueDate;
  if (line.quantity.trim()) payload.quantity = line.quantity.trim();
  if (line.unitCost.trim()) payload.unitCost = line.unitCost.trim();
  if (line.assetClass.trim()) payload.assetClass = line.assetClass.trim();
  if (line.usefulLifeMonths.trim()) payload.usefulLifeMonths = Number(line.usefulLifeMonths);
  if (line.accumulatedDepreciation.trim()) payload.accumulatedDepreciation = line.accumulatedDepreciation.trim();
  return payload;
}

function BatchEditor({
  companyId,
  accounts,
  periods,
  batch,
  canDraft,
  canSubmit,
  onChanged,
}: {
  companyId: string;
  accounts: SetupAccount[];
  periods: FiscalPeriod[];
  batch: OpeningBatch | null;
  canDraft: boolean;
  canSubmit: boolean;
  onChanged: () => Promise<void>;
}) {
  const activeAccounts = accounts.filter((account) => account.isActive);
  const [batchDate, setBatchDate] = useState(batch?.batchDate ?? periods[0]?.startDate ?? '');
  const [evidenceReference, setEvidenceReference] = useState(batch?.evidenceReference ?? '');
  const [evidenceNote, setEvidenceNote] = useState(batch?.evidenceNote ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => (batch ? fromBatch(batch) : [blankLine(), blankLine()]));
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const totals = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    let invalid = false;
    for (const line of lines) {
      const d = parseAmount(line.debit);
      const c = parseAmount(line.credit);
      if (d === null || c === null) invalid = true;
      else {
        debit += d;
        credit += c;
      }
    }
    return { debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0n, invalid };
  }, [lines]);

  const setLine = <K extends keyof EditorLine>(key: string, field: K, value: EditorLine[K]): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  };

  const payload = () => ({
    batchDate,
    evidenceReference: evidenceReference.trim() || null,
    evidenceNote: evidenceNote.trim() || null,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      scheduleType: line.scheduleType,
      schedule: schedulePayload(line),
      debit: line.debit.trim() || '0',
      credit: line.credit.trim() || '0',
      memo: line.memo.trim() || null,
    })),
  });

  const persist = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      const input = payload();
      const result = batch
        ? await setupApi.updateOpeningBatch(companyId, batch.id, input)
        : await setupApi.createOpeningBatch(companyId, input);
      setNotice(
        batch
          ? 'Opening-balance draft saved. Totals were recomputed by the server.'
          : 'Opening-balance draft created. It remains DRAFT until you submit it for posting.',
      );
      await onChanged();
      return result.batch.id;
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    if (!totals.balanced) {
      setError('Fix the debit and credit totals before submitting. The server will reject an unbalanced batch.');
      return;
    }
    if (!evidenceReference.trim()) {
      setError('Record the evidence reference before submitting.');
      return;
    }
    if (!window.confirm('Submit these opening balances for approval? The batch will be locked and can only be approved and posted from the ledger workspace.')) {
      return;
    }
    setSubmitting(true);
    try {
      const batchId = await persist();
      if (!batchId) return;
      const result = await setupApi.submitOpeningBatch(companyId, batchId);
      setNotice(
        `Batch submitted (${result.batch.status}). It is locked for review; approve and post it from the ledger workspace.`,
      );
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSubmitting(false);
    }
  };

  const readOnly = !canDraft;

  return (
    <div className="space-y-4">
      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      <div className="grid gap-3 rounded-2xl border border-line bg-surface-2/40 p-4 md:grid-cols-3">
        <Field label="Opening-balance date" required hint="The date must fall inside a configured OPEN period.">
          <input className={INPUT_CLASS} type="date" value={batchDate} onChange={(event) => setBatchDate(event.target.value)} disabled={readOnly || saving || submitting} />
        </Field>
        <Field label="Evidence reference" required hint="Board resolution, signed schedule, bank confirmation or audit reference.">
          <input className={INPUT_CLASS} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={200} disabled={readOnly || saving || submitting} placeholder="Example: Board resolution 2025-01" />
        </Field>
        <Field label="Evidence note">
          <input className={INPUT_CLASS} value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} maxLength={1000} disabled={readOnly || saving || submitting} />
        </Field>
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => (
          <fieldset key={line.key} className="rounded-2xl border border-line p-4">
            <legend className="px-1 text-[13px] font-semibold text-ink-700">Line {index + 1}</legend>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Account" required>
                <select className={INPUT_CLASS} value={line.accountId} onChange={(event) => setLine(line.key, 'accountId', event.target.value)} disabled={readOnly || saving || submitting}>
                  <option value="">Choose account</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} — {account.nameEn}{account.isControl ? ` (${account.controlSubledger})` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Schedule type">
                <select className={INPUT_CLASS} value={line.scheduleType} onChange={(event) => setLine(line.key, 'scheduleType', event.target.value)} disabled={readOnly || saving || submitting}>
                  <option value="ACCOUNT">Account balance</option>
                  <option value="PARTY">Customer / supplier</option>
                  <option value="ITEM">Inventory item</option>
                  <option value="FIXED_ASSET">Fixed asset</option>
                </select>
              </Field>
              <Field label="Debit (BDT)">
                <input className={INPUT_CLASS} value={line.debit} onChange={(event) => setLine(line.key, 'debit', event.target.value)} inputMode="decimal" placeholder="0.00" disabled={readOnly || saving || submitting} />
              </Field>
              <Field label="Credit (BDT)">
                <input className={INPUT_CLASS} value={line.credit} onChange={(event) => setLine(line.key, 'credit', event.target.value)} inputMode="decimal" placeholder="0.00" disabled={readOnly || saving || submitting} />
              </Field>
            </div>

            {line.scheduleType !== 'ACCOUNT' ? (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label={line.scheduleType === 'FIXED_ASSET' ? 'Asset class' : line.scheduleType === 'ITEM' ? 'Item name' : 'Party name'} required>
                  <input className={INPUT_CLASS} value={line.name} onChange={(event) => setLine(line.key, 'name', event.target.value)} disabled={readOnly || saving || submitting} maxLength={200} />
                </Field>
                <Field label="Reference / document">
                  <input className={INPUT_CLASS} value={line.reference} onChange={(event) => setLine(line.key, 'reference', event.target.value)} disabled={readOnly || saving || submitting} maxLength={200} />
                </Field>
                {line.scheduleType === 'PARTY' ? (
                  <Field label="Due date">
                    <input className={INPUT_CLASS} type="date" value={line.dueDate} onChange={(event) => setLine(line.key, 'dueDate', event.target.value)} disabled={readOnly || saving || submitting} />
                  </Field>
                ) : null}
                {line.scheduleType === 'ITEM' ? (
                  <>
                    <Field label="Quantity">
                      <input className={INPUT_CLASS} value={line.quantity} onChange={(event) => setLine(line.key, 'quantity', event.target.value)} inputMode="decimal" disabled={readOnly || saving || submitting} />
                    </Field>
                    <Field label="Unit cost (BDT)">
                      <input className={INPUT_CLASS} value={line.unitCost} onChange={(event) => setLine(line.key, 'unitCost', event.target.value)} inputMode="decimal" disabled={readOnly || saving || submitting} />
                    </Field>
                  </>
                ) : null}
                {line.scheduleType === 'FIXED_ASSET' ? (
                  <>
                    <Field label="Useful life (months)">
                      <input className={INPUT_CLASS} value={line.usefulLifeMonths} onChange={(event) => setLine(line.key, 'usefulLifeMonths', event.target.value)} inputMode="numeric" disabled={readOnly || saving || submitting} />
                    </Field>
                    <Field label="Accumulated depreciation (BDT)">
                      <input className={INPUT_CLASS} value={line.accumulatedDepreciation} onChange={(event) => setLine(line.key, 'accumulatedDepreciation', event.target.value)} inputMode="decimal" disabled={readOnly || saving || submitting} />
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Field label="Memo">
                  <input className={INPUT_CLASS} value={line.memo} onChange={(event) => setLine(line.key, 'memo', event.target.value)} maxLength={500} disabled={readOnly || saving || submitting} />
                </Field>
              </div>
              {!readOnly && lines.length > 1 ? (
                <button type="button" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} className="mb-0.5 rounded-lg border border-line p-2 text-ink-500 hover:border-rose-400 hover:text-rose-600" aria-label={`Remove line ${index + 1}`}>
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          </fieldset>
        ))}
      </div>

      {!readOnly ? (
        <button type="button" onClick={() => setLines((current) => [...current, blankLine()])} className="lv-btn lv-btn-secondary min-h-10 text-[13px]">
          <Plus size={15} /> Add line
        </button>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2/40 px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
          <div>
            <dt className="text-ink-400">Debit</dt>
            <dd className="font-money font-semibold text-ink-900">{formatPoisha(totals.debit)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Credit</dt>
            <dd className="font-money font-semibold text-ink-900">{formatPoisha(totals.credit)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Difference</dt>
            <dd className={`font-money font-semibold ${totals.balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
              {formatPoisha(totals.difference)}
            </dd>
          </div>
        </dl>
        <span className={`lv-chip text-[12px] ${totals.balanced ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>
          {totals.balanced ? <CheckCircle2 size={12} /> : null}
          {totals.balanced ? 'Balanced' : totals.invalid ? 'Invalid amount' : 'Not balanced'}
        </span>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void persist()} disabled={saving || submitting} className="lv-btn lv-btn-secondary min-h-11 text-[14px]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save draft
          </button>
          {canSubmit ? (
            <button type="button" onClick={() => void submit()} disabled={saving || submitting || !batchDate} className="lv-btn lv-btn-primary min-h-11 text-[14px]">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Save and submit for approval
            </button>
          ) : (
            <span className="self-center text-[12px] text-ink-500">Your role can prepare the draft but cannot submit it for posting.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReadOnlyBatch({ batch }: { batch: OpeningBatch }) {
  const statusTone =
    batch.status === 'POSTED'
      ? 'lv-chip-emerald'
      : batch.status === 'REVERSED'
        ? 'lv-chip-rose'
        : 'lv-chip-gold';
  return (
    <div className="space-y-4">
      <Notice
        tone={batch.status === 'POSTED' ? 'success' : 'info'}
        message={
          batch.status === 'POSTED'
            ? `This opening-balance batch is POSTED as journal ${batch.journalNumber ?? ''}. The batch and journal are permanently linked and cannot be posted again.`
            : batch.status === 'REVERSED'
              ? `This batch was reversed by journal ${batch.reversalJournalNumber ?? ''}. Opening balances cannot be posted again.`
              : `This batch is ${batch.status} and locked for editing. Continue approval and posting in the ledger workspace.`
        }
      />
      <dl className="grid gap-3 rounded-2xl border border-line bg-surface-2/40 p-4 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-400">Date / period</dt>
          <dd className="mt-1 font-semibold text-ink-900">{batch.batchDate} · {batch.periodCode}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Debit total</dt>
          <dd className="mt-1 font-money font-semibold text-ink-900">{formatPoisha(BigInt(batch.totalDebitPoisha))}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Credit total</dt>
          <dd className="mt-1 font-money font-semibold text-ink-900">{formatPoisha(BigInt(batch.totalCreditPoisha))}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Status</dt>
          <dd className="mt-1">
            <span className={`lv-chip ${statusTone} text-[12px]`}>{batch.status}</span>
          </dd>
        </div>
      </dl>
      <div className="rounded-2xl border border-line p-4 text-[13px]">
        <p className="font-semibold text-ink-900">Evidence</p>
        <p className="mt-1 text-ink-600">{batch.evidenceReference ?? 'Not recorded'}</p>
        {batch.evidenceNote ? <p className="mt-1 text-[12px] text-ink-500">{batch.evidenceNote}</p> : null}
        {batch.journalNumber ? (
          <p className="mt-2 text-[12px] text-ink-500">Posted journal: <span className="font-mono text-ink-800">{batch.journalNumber}</span></p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead className="bg-surface-2/40 text-ink-400">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Schedule</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Debit</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Credit</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Memo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {batch.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2.5"><span className="font-mono text-ink-700">{line.accountCode}</span><span className="ml-2 text-ink-600">{line.accountName}</span></td>
                <td className="px-3 py-2.5 text-ink-600">{line.scheduleType}{line.schedule.name ? ` · ${line.schedule.name}` : ''}</td>
                <td className="px-3 py-2.5 text-right font-money text-ink-900">{line.debitBdt}</td>
                <td className="px-3 py-2.5 text-right font-money text-ink-900">{line.creditBdt}</td>
                <td className="px-3 py-2.5 text-ink-500">{line.memo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link to="/app/ledger" className="lv-btn lv-btn-primary min-h-11 text-[14px]">
        Open ledger to approve or post
      </Link>
    </div>
  );
}

export default function OpeningBalancesStep({
  companyId,
  accounts,
  periods,
  batches,
  canDraft,
  canSubmit,
  onChanged,
}: {
  companyId: string;
  accounts: SetupAccount[];
  periods: FiscalPeriod[];
  batches: OpeningBatch[];
  canDraft: boolean;
  canSubmit: boolean;
  onChanged: () => Promise<void>;
}) {
  const batch = batches[0] ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Opening balances</h2>
        <p className="mt-1 text-[13px] text-ink-500">
          Prepare one opening-balance batch with account, party, item or fixed-asset schedules. The server
          recomputes debit and credit totals from the lines and rejects an unbalanced submission. A submitted
          batch is locked; approve and post it once from the ledger workspace. Posted batches are immutable.
        </p>
      </div>

      {periods.length === 0 ? (
        <Notice tone="warning" message="Create the fiscal year and periods before preparing opening balances." />
      ) : null}

      {batch && batch.status !== 'DRAFT' ? (
        <ReadOnlyBatch batch={batch} />
      ) : (
        <BatchEditor
          companyId={companyId}
          accounts={accounts}
          periods={periods}
          batch={batch}
          canDraft={canDraft}
          canSubmit={canSubmit}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
