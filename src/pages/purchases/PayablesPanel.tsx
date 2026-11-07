import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileClock, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  ApAgeing,
  SupplierStatement,
  WithholdingLiability,
  WithholdingProof,
} from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, INPUT_CLASS, Notice, poishaToBdtString } from '../setup/setupUi';
import type { PurchaseRefs } from './purchasesRefs';
import { EmptyState, ProofRow, SectionCard, formatDate, oneYearAgoIso, ratePercent, todayIso } from './purchasesUi';

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function AgeingAndStatementPanel({ companyId, refs }: { companyId: string; refs: PurchaseRefs }) {
  const suppliers = useMemo(
    () => refs.suppliers.filter((party) => party.type === 'SUPPLIER' || party.type === 'BOTH'),
    [refs.suppliers],
  );
  const [asOf, setAsOf] = useState(todayIso());
  const [partyId, setPartyId] = useState('');
  const [ageing, setAgeing] = useState<ApAgeing | null>(null);
  const [statementPartyId, setStatementPartyId] = useState('');
  const [from, setFrom] = useState(oneYearAgoIso);
  const [to, setTo] = useState(todayIso());
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgeing = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await purchaseApi.apAgeing(companyId, asOf, partyId || undefined);
      setAgeing(response.ageing);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, asOf, partyId]);

  useEffect(() => {
    void loadAgeing();
  }, [loadAgeing]);

  const loadStatement = async () => {
    if (!statementPartyId) {
      setError('Choose a supplier for the statement.');
      return;
    }
    setLoadingStatement(true);
    setError(null);
    try {
      const response = await purchaseApi.supplierStatement(companyId, statementPartyId, from, to);
      setStatement(response.statement);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoadingStatement(false);
    }
  };

  const exportAgeing = () => {
    if (!ageing) return;
    const header = [
      'Supplier code',
      'Supplier',
      'Document',
      'Supplier invoice',
      'Doc date',
      'Due date',
      'Gross poisha',
      'Allocated poisha',
      'Outstanding poisha',
      'Expected withholding poisha',
      'Bucket',
    ];
    const rows = ageing.rows.map((row) => [
      row.partyCode,
      row.partyNameEn,
      row.documentNo ?? '',
      row.supplierInvoiceNo,
      row.docDate,
      row.dueDate,
      row.grossPoisha,
      row.allocatedPoisha,
      row.outstandingPoisha,
      row.expectedWithholdingPoisha,
      row.bucket,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ap-ageing-${ageing.asOf}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="AP ageing & control proof"
        kicker="Open supplier items derive from posted bills and payment allocations"
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => void loadAgeing()}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" className="ql-btn ql-btn-ghost min-h-11 text-[13px]" disabled={!ageing} onClick={exportAgeing}>
              <Download size={15} /> CSV
            </button>
          </div>
        }
      >
        {error ? <ErrorBanner message={error} /> : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">As-of date</span>
            <input type="date" className={INPUT_CLASS} value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Supplier filter</span>
            <select className={INPUT_CLASS} value={partyId} onChange={(event) => setPartyId(event.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((party) => (
                <option key={party.id} value={party.id}>{party.code} — {party.nameEn}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" className="ql-btn ql-btn-primary min-h-11 w-full text-[13px]" onClick={() => void loadAgeing()}>
              <FileClock size={15} /> {loading ? 'Loading…' : 'Load ageing'}
            </button>
          </div>
        </div>

        {ageing ? (
          <>
            <div className="mt-4">
              <ProofRow
                label={`AP control ${ageing.proof.controlAccountCode} ${ageing.proof.controlAccountName}`}
                gl={`${ageing.proof.glBalanceBdt} BDT`}
                subledger={`${ageing.proof.subledgerBdt} BDT`}
                difference={`${ageing.proof.differenceBdt} BDT`}
                agrees={ageing.proof.agrees}
              />
            </div>
            <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-6">
              {(['CURRENT', '1_30', '31_60', '61_90', '91_180', 'OVER_180'] as const).map((bucket) => (
                <div key={bucket} className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
                  <p className="text-ink-400">{bucket.replace('_', '–')} days</p>
                  <p className="mt-1 font-mono font-semibold text-ink-900">
                    {poishaToBdtString(ageing.totals[bucket])}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink-500">
              Net AP subledger: {poishaToBdtString(ageing.totals.NET)} BDT as of {formatDate(ageing.asOf)}.
            </p>
            <div className="mt-4 overflow-x-auto">
              {ageing.rows.length === 0 ? (
                <EmptyState title="No open payables" hint="Posted bills with an outstanding balance appear here." />
              ) : (
                <table className="w-full min-w-[1050px] text-left text-[13px]">
                  <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                    <tr>
                      <th className="px-2 py-2">Supplier</th>
                      <th className="px-2 py-2">Bill</th>
                      <th className="px-2 py-2">Supplier invoice</th>
                      <th className="px-2 py-2">Due</th>
                      <th className="px-2 py-2 text-right">Gross</th>
                      <th className="px-2 py-2 text-right">Allocated</th>
                      <th className="px-2 py-2 text-right">Outstanding</th>
                      <th className="px-2 py-2 text-right">Est. withholding</th>
                      <th className="px-2 py-2">Bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageing.rows.map((row) => (
                      <tr key={row.documentId} className="border-t border-line/70">
                        <td className="px-2 py-2"><p className="font-medium text-ink-900">{row.partyNameEn}</p><p className="text-[12px] text-ink-400">{row.partyCode}</p></td>
                        <td className="px-2 py-2 text-ink-700">{row.documentNo ?? '—'}</td>
                        <td className="px-2 py-2 text-ink-600">{row.supplierInvoiceNo}</td>
                        <td className="px-2 py-2 text-ink-600">{formatDate(row.dueDate)}</td>
                        <td className="px-2 py-2 text-right font-mono">{row.grossBdt}</td>
                        <td className="px-2 py-2 text-right font-mono">{row.allocatedBdt}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold">{row.outstandingBdt}</td>
                        <td className="px-2 py-2 text-right font-mono text-ink-500">{row.expectedWithholdingBdt}</td>
                        <td className="px-2 py-2"><span className="ql-badge ql-badge-neutral">{row.bucket.replace('_', '–')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Supplier statement" kicker="Bills, payments and withholding memo">
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Supplier</span>
            <select className={INPUT_CLASS} value={statementPartyId} onChange={(event) => setStatementPartyId(event.target.value)}>
              <option value="">Choose supplier</option>
              {suppliers.map((party) => (
                <option key={party.id} value={party.id}>{party.code} — {party.nameEn}</option>
              ))}
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
        </div>
        <button type="button" className="ql-btn ql-btn-secondary mt-3 min-h-11 text-[13px]" disabled={loadingStatement} onClick={() => void loadStatement()}>
          {loadingStatement ? 'Loading…' : 'Load statement'}
        </button>
        {statement ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <p className="font-semibold text-ink-900">{statement.partyNameEn} · {formatDate(statement.from)} to {formatDate(statement.to)}</p>
              <p className="font-mono text-ink-700">Opening {statement.openingBdt} · Closing {statement.closingBdt} BDT</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              {statement.lines.length === 0 ? (
                <EmptyState title="No statement activity" hint="Posted bills and payments in the selected range appear here." />
              ) : (
                <table className="w-full min-w-[850px] text-left text-[13px]">
                  <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                    <tr>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Reference</th>
                      <th className="px-2 py-2">Memo</th>
                      <th className="px-2 py-2 text-right">Debit</th>
                      <th className="px-2 py-2 text-right">Credit</th>
                      <th className="px-2 py-2 text-right">Running</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr key={`${line.kind}-${line.id}`} className="border-t border-line/70">
                        <td className="px-2 py-2 text-ink-600">{formatDate(line.entryDate)}</td>
                        <td className="px-2 py-2 font-medium text-ink-900">{line.reference}</td>
                        <td className="px-2 py-2 text-ink-500">{line.memo}</td>
                        <td className="px-2 py-2 text-right font-mono">{line.debitBdt}</td>
                        <td className="px-2 py-2 text-right font-mono">{line.creditBdt}</td>
                        <td className="px-2 py-2 text-right font-mono">{line.runningBalanceBdt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

export function WithholdingPanel({ companyId }: { companyId: string }) {
  const [asOf, setAsOf] = useState(todayIso());
  const [status, setStatus] = useState<'PENDING' | 'DEPOSITED' | 'REVERSED' | ''>('PENDING');
  const [taxType, setTaxType] = useState<'VDS' | 'TDS' | 'REVERSE_CHARGE' | ''>('');
  const [entries, setEntries] = useState<WithholdingLiability[]>([]);
  const [proof, setProof] = useState<WithholdingProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [queue, proofResponse] = await Promise.all([
        purchaseApi.withholdingLiabilities(companyId, {
          ...(status ? { status } : {}),
          ...(taxType ? { taxType } : {}),
          limit: 500,
        }),
        purchaseApi.withholdingProof(companyId, asOf),
      ]);
      setEntries(queue.entries);
      setProof(proofResponse.proof);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, status, taxType, asOf]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      title="VDS / TDS / reverse-charge liability queue"
      kicker="Created from actual payments and reverse-charge bills"
      action={
        <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={() => void load()}>
          <RefreshCw size={15} /> Refresh
        </button>
      }
    >
      <Notice
        message="This is the pending withholding liability queue. Treasury deposit, bank evidence and draft withholding certificates are recorded in Treasury & certificates. No certificate is marked final or filed."
        tone="info"
      />
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-700">Proof date</span>
          <input type="date" className={INPUT_CLASS} value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </label>
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
            <option value="REVERSE_CHARGE">Reverse charge VAT</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="ql-btn ql-btn-primary min-h-11 w-full text-[13px]" onClick={() => void load()}>
            <ShieldCheck size={15} /> {loading ? 'Loading…' : 'Load queue'}
          </button>
        </div>
      </div>

      {proof ? (
        <div className="mt-4 space-y-2">
          <ProofRow label="VDS payable" gl={`${poishaToBdtString(proof.vds.glPoisha)} BDT`} subledger={`${poishaToBdtString(proof.vds.liabilityPoisha)} BDT`} difference={`${poishaToBdtString(proof.vds.differencePoisha)} BDT`} agrees={proof.vds.agrees} />
          <ProofRow label="TDS payable" gl={`${poishaToBdtString(proof.tds.glPoisha)} BDT`} subledger={`${poishaToBdtString(proof.tds.liabilityPoisha)} BDT`} difference={`${poishaToBdtString(proof.tds.differencePoisha)} BDT`} agrees={proof.tds.agrees} />
          <ProofRow label="Reverse-charge VAT payable" gl={`${poishaToBdtString(proof.reverseCharge.glPoisha)} BDT`} subledger={`${poishaToBdtString(proof.reverseCharge.liabilityPoisha)} BDT`} difference={`${poishaToBdtString(proof.reverseCharge.differencePoisha)} BDT`} agrees={proof.reverseCharge.agrees} />
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        {entries.length === 0 ? (
          <EmptyState title="No withholding liabilities in this view" hint="Post a supplier payment or a reverse-charge bill to create a real liability." />
        ) : (
          <table className="w-full min-w-[1000px] text-left text-[13px]">
            <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
              <tr>
                <th className="px-2 py-2">Tax</th>
                <th className="px-2 py-2">Period</th>
                <th className="px-2 py-2">Party</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2 text-right">Base</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-line/70">
                  <td className="px-2 py-2 font-semibold text-ink-900">{entry.taxType.replaceAll('_', ' ')}</td>
                  <td className="px-2 py-2 text-ink-600">{entry.taxPeriod}</td>
                  <td className="px-2 py-2 text-ink-700">{entry.partyNameEn}</td>
                  <td className="px-2 py-2 text-ink-600">
                    {entry.sourceType === 'PAYMENT' ? entry.paymentNumber : entry.billNo}
                    {entry.supplierInvoiceNo ? <span className="block text-[12px] text-ink-400">{entry.supplierInvoiceNo}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{entry.baseBdt}</td>
                  <td className="px-2 py-2 text-right font-mono">{ratePercent(entry.rateBps)}</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold">{entry.amountBdt}</td>
                  <td className="px-2 py-2"><span className={`ql-badge ${entry.status === 'PENDING' ? 'ql-badge-warn' : entry.status === 'DEPOSITED' ? 'ql-badge-success' : 'ql-badge-danger'}`}>{entry.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  );
}
