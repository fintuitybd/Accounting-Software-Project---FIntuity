import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { bankingApi, type MfsWebhookEvent, type PgwBatchReconciliationResult } from '../../banking/api';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { formatDate, todayIso } from './bankingUi';

export function MfsSettlementStudioPanel({
  companyId,
  canPost,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  canPost: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { money } = usePreferences();
  const [events, setEvents] = useState<MfsWebhookEvent[]>([]);
  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal states
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchResult, setBatchResult] = useState<PgwBatchReconciliationResult | null>(null);

  // Simulation form
  const [simProvider, setSimProvider] = useState<'BKASH' | 'NAGAD' | 'SSLCOMMERZ' | 'AAMARPAY'>('BKASH');
  const [simTrxId, setSimTrxId] = useState(`TRX${Date.now().toString().slice(-8)}`);
  const [simInvoiceId, setSimInvoiceId] = useState('');
  const [simAmount, setSimAmount] = useState('1000.00');
  const [simMdrBps, setSimMdrBps] = useState('150');

  // PGW Batch form
  const [batchProvider, setBatchProvider] = useState<'SSLCOMMERZ' | 'AAMARPAY'>('SSLCOMMERZ');
  const [batchRef, setBatchRef] = useState(`BATCH-${Date.now().toString().slice(-6)}`);
  const [batchDate, setBatchDate] = useState(todayIso());
  const [batchTransactionsText, setBatchTransactionsText] = useState(
    JSON.stringify(
      [
        { externalTrxId: `SSL-${Date.now()}-01`, amount: '2500.00', mdrFeeBps: 250 },
        { externalTrxId: `SSL-${Date.now()}-02`, amount: '5000.00', mdrFeeBps: 250 },
      ],
      null,
      2,
    ),
  );

  const loadEvents = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await bankingApi.mfsWebhooks(companyId, {
        provider: providerFilter !== 'ALL' ? providerFilter : undefined,
        limit: 100,
      });
      setEvents(response.events);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, providerFilter]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, refreshKey]);

  // Aggregate stats
  const totals = useMemo(() => {
    let totalGross = 0n;
    let totalMdr = 0n;
    let totalNet = 0n;
    for (const event of events) {
      totalGross += BigInt(event.grossAmountPoisha);
      totalMdr += BigInt(event.mdrFeePoisha);
      totalNet += BigInt(event.netSettledPoisha);
    }
    return {
      grossBdt: money(totalGross),
      mdrBdt: money(totalMdr),
      netBdt: money(totalNet),
      count: events.length,
    };
  }, [events, money]);

  // Live simulation split preview
  const simPreview = useMemo(() => {
    const grossNum = parseFloat(simAmount) || 0;
    const bps = parseInt(simMdrBps, 10) || 0;
    const mdrNum = (grossNum * bps) / 10000;
    const netNum = grossNum - mdrNum;
    return {
      gross: grossNum.toFixed(2),
      mdr: mdrNum.toFixed(2),
      net: netNum.toFixed(2),
      bps,
    };
  }, [simAmount, simMdrBps]);

  const handleSimulateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simTrxId.trim() || !simAmount.trim()) {
      setError('Please provide transaction ID and amount.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        externalTrxId: simTrxId.trim(),
        amount: simAmount.trim(),
        mdrFeeBps: parseInt(simMdrBps, 10) || 150,
        valueDate: todayIso(),
      };
      if (simInvoiceId.trim()) {
        payload.invoiceId = simInvoiceId.trim();
      }

      const res = await bankingApi.simulateMfsWebhook(companyId, simProvider.toLowerCase(), payload);
      setNotice(
        `Webhook processed! ${simProvider} ${res.event.externalTrxId} settled. Net BDT ${res.event.netSettledBdt} into Account 1120, MDR BDT ${res.event.mdrFeeBdt} into Account 5190.`,
      );
      setShowSimulateModal(false);
      setSimTrxId(`TRX${Date.now().toString().slice(-8)}`);
      await loadEvents();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRunBatchReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setBatchResult(null);
    try {
      let parsedTransactions: Array<{ externalTrxId: string; amount?: string; mdrFeeBps?: number; invoiceId?: string }>;
      try {
        parsedTransactions = JSON.parse(batchTransactionsText);
        if (!Array.isArray(parsedTransactions) || parsedTransactions.length === 0) {
          throw new Error('Transactions must be a non-empty JSON array.');
        }
      } catch (err) {
        throw new Error(`Invalid JSON in transactions list: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }

      const res = await bankingApi.reconcilePgwBatch(companyId, {
        provider: batchProvider,
        batchReference: batchRef.trim(),
        settlementDate: batchDate,
        transactions: parsedTransactions,
      });

      setBatchResult(res.result);
      setNotice(
        `PGW Batch reconciled! ${res.result.reconciledCount} transactions posted with MDR fee split, ${res.result.replayedCount} replayed.`,
      );
      await loadEvents();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const providerBadge = (provider: string) => {
    switch (provider) {
      case 'BKASH':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-pink-100 px-2 py-0.5 text-[11px] font-bold text-pink-700">
            bKash
          </span>
        );
      case 'NAGAD':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            Nagad
          </span>
        );
      case 'SSLCOMMERZ':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
            SSLCommerz
          </span>
        );
      case 'AAMARPAY':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            AamarPay
          </span>
        );
      default:
        return <span className="ql-badge ql-badge-neutral">{provider}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ql-card p-4">
          <p className="text-[12px] font-semibold text-ink-500">Gross Collections</p>
          <p className="mt-1 font-mono text-[22px] font-bold text-ink-900">{totals.grossBdt}</p>
          <p className="mt-1 text-[11px] text-ink-400">Total customer collections processed</p>
        </div>
        <div className="ql-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-amber-700">MDR Fee Expense (5190)</p>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              IFRS 18 Opex
            </span>
          </div>
          <p className="mt-1 font-mono text-[22px] font-bold text-amber-700">{totals.mdrBdt}</p>
          <p className="mt-1 text-[11px] text-ink-400">Merchant gateway deduction</p>
        </div>
        <div className="ql-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-emerald-700">Net Settled (1120)</p>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              MFS Wallet
            </span>
          </div>
          <p className="mt-1 font-mono text-[22px] font-bold text-emerald-700">{totals.netBdt}</p>
          <p className="mt-1 text-[11px] text-ink-400">Deposited to merchant wallets</p>
        </div>
        <div className="ql-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-brand">HMAC-SHA256 Authenticated</p>
            <ShieldCheck size={16} className="text-brand" />
          </div>
          <p className="mt-1 font-mono text-[22px] font-bold text-brand">{totals.count}</p>
          <p className="mt-1 text-[11px] text-ink-400">Verified webhook transactions</p>
        </div>
      </div>

      {/* Studio Workbench Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-ink-600" />
          <span className="text-[13px] font-semibold text-ink-900">Provider Filter:</span>
          <select
            className="ql-select text-[13px]"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
          >
            <option value="ALL">All Providers</option>
            <option value="BKASH">bKash Merchant</option>
            <option value="NAGAD">Nagad Merchant</option>
            <option value="SSLCOMMERZ">SSLCommerz PGW</option>
            <option value="AAMARPAY">AamarPay PGW</option>
          </select>
          <button
            type="button"
            className="ql-btn ql-btn-secondary text-[12px]"
            onClick={loadEvents}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="flex items-center gap-2">
          {canPost ? (
            <>
              <button
                type="button"
                className="ql-btn ql-btn-secondary text-[13px]"
                onClick={() => setShowBatchModal(true)}
              >
                <Layers size={14} /> PGW Batch Settlement
              </button>
              <button
                type="button"
                className="ql-btn ql-btn-primary text-[13px]"
                onClick={() => setShowSimulateModal(true)}
              >
                <Plus size={14} /> Ingest / Test Webhook
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Events Table */}
      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker">Settlement Evidence Ledger</p>
            <h2 className="mt-0.5 text-[18px] font-semibold text-ink-900">MFS & Payment Gateway Collections</h2>
          </div>
          <span className="text-[12px] text-ink-500">{events.length} transactions recorded</span>
        </div>

        {events.length === 0 ? (
          <div className="p-8 text-center text-ink-400">
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading transactions…
              </div>
            ) : (
              <p>No webhook collections recorded yet. Webhooks from bKash & Nagad will automatically post here.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[12px]">
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Provider</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">External Trx ID</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Invoice / Reference</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Gross (BDT)</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">MDR Fee (5190)</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Net Settled (1120)</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">HMAC Auth</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">GL Posting</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Processed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-surface-2/30">
                    <td className="px-3 py-2.5">{providerBadge(event.provider)}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-900">{event.externalTrxId}</td>
                    <td className="px-3 py-2.5">
                      {event.invoiceNumber ? (
                        <div>
                          <span className="font-semibold text-ink-900">{event.invoiceNumber}</span>
                          {event.customerName ? (
                            <span className="block text-[11px] text-ink-500">{event.customerName}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-ink-400">Direct wallet deposit</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium text-ink-900">
                      {event.grossAmountBdt}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-700">
                      <span className="font-semibold">{event.mdrFeeBdt}</span>
                      <span className="ml-1 text-[10px] text-ink-400">({event.mdrFeeBps} bps)</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">
                      {event.netSettledBdt}
                    </td>
                    <td className="px-3 py-2.5">
                      {event.signatureVerified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 size={13} /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                          Unverified
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {event.journalId ? (
                        <span className="ql-badge ql-badge-neutral font-mono text-[11px]">3-Line Journal</span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-500">
                      {formatDate(event.processedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: Simulate / Test Ingest MFS Webhook */}
      {showSimulateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="ql-card w-full max-w-lg p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-[18px] font-semibold text-ink-900">Test / Ingest MFS Webhook</h3>
                <p className="text-[12px] text-ink-500">Simulate incoming webhook with HMAC-SHA256 signature</p>
              </div>
              <button
                type="button"
                className="text-ink-400 hover:text-ink-700"
                onClick={() => setShowSimulateModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateWebhook} className="mt-4 space-y-4">
              <Field label="MFS Provider">
                <select
                  className={INPUT_CLASS}
                  value={simProvider}
                  onChange={(e) => setSimProvider(e.target.value as any)}
                >
                  <option value="BKASH">bKash Merchant</option>
                  <option value="NAGAD">Nagad Merchant</option>
                  <option value="SSLCOMMERZ">SSLCommerz Gateway</option>
                  <option value="AAMARPAY">AamarPay Gateway</option>
                </select>
              </Field>

              <Field label="External Transaction ID (TrxID)">
                <input
                  type="text"
                  className={INPUT_CLASS}
                  value={simTrxId}
                  onChange={(e) => setSimTrxId(e.target.value)}
                  placeholder="e.g. 9M248SDF8"
                  required
                />
              </Field>

              <Field label="Target Sales Invoice ID (Optional)">
                <input
                  type="text"
                  className={INPUT_CLASS}
                  value={simInvoiceId}
                  onChange={(e) => setSimInvoiceId(e.target.value)}
                  placeholder="UUID of posted sales invoice to settle"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Gross Amount (BDT)">
                  <input
                    type="number"
                    step="0.01"
                    className={INPUT_CLASS}
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    required
                  />
                </Field>
                <Field label="MDR Fee (Basis Points)">
                  <input
                    type="number"
                    className={INPUT_CLASS}
                    value={simMdrBps}
                    onChange={(e) => setSimMdrBps(e.target.value)}
                    placeholder="150 for 1.5%"
                    required
                  />
                </Field>
              </div>

              {/* Waterfall Calculation Preview Card */}
              <div className="rounded-xl border border-line bg-surface-2/40 p-3 text-[12px]">
                <p className="font-semibold text-ink-700">Live Mathematical Invariant Split:</p>
                <div className="mt-2 space-y-1 font-mono">
                  <div className="flex justify-between">
                    <span className="text-ink-600">Gross AR Settled (1210):</span>
                    <span className="font-semibold text-ink-900">BDT {simPreview.gross}</span>
                  </div>
                  <div className="flex justify-between text-amber-700">
                    <span>- MDR Charge (5190 @ {simPreview.bps} bps):</span>
                    <span className="font-semibold">BDT {simPreview.mdr}</span>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1 text-emerald-700">
                    <span className="font-bold">= Net Wallet Settled (1120):</span>
                    <span className="font-bold">BDT {simPreview.net}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  className="ql-btn ql-btn-secondary"
                  onClick={() => setShowSimulateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ql-btn ql-btn-primary"
                  disabled={busy}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Post Webhook
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: PGW Batch Settlement Reconciliation */}
      {showBatchModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="ql-card w-full max-w-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-[18px] font-semibold text-ink-900">SSLCommerz / AamarPay Batch Reconciliation</h3>
                <p className="text-[12px] text-ink-500">Reconcile gateway settlement batch with automatic MDR fee split</p>
              </div>
              <button
                type="button"
                className="text-ink-400 hover:text-ink-700"
                onClick={() => {
                  setShowBatchModal(false);
                  setBatchResult(null);
                }}
              >
                ✕
              </button>
            </div>

            {batchResult ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 size={18} />
                    <span className="font-bold">Batch Reconciled Successfully!</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                    <div>
                      <p className="text-ink-500">Batch Reference</p>
                      <p className="font-mono font-bold text-ink-900">{batchResult.batchReference}</p>
                    </div>
                    <div>
                      <p className="text-ink-500">Gross Total</p>
                      <p className="font-mono font-bold text-ink-900">BDT {batchResult.totalGrossBdt}</p>
                    </div>
                    <div>
                      <p className="text-ink-500">MDR Fees (5190)</p>
                      <p className="font-mono font-bold text-amber-700">BDT {batchResult.totalMdrFeeBdt}</p>
                    </div>
                    <div>
                      <p className="text-ink-500">Net Settled (1120)</p>
                      <p className="font-mono font-bold text-emerald-700">BDT {batchResult.totalNetSettledBdt}</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    className="ql-btn ql-btn-primary"
                    onClick={() => {
                      setShowBatchModal(false);
                      setBatchResult(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRunBatchReconcile} className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Gateway Provider">
                    <select
                      className={INPUT_CLASS}
                      value={batchProvider}
                      onChange={(e) => setBatchProvider(e.target.value as any)}
                    >
                      <option value="SSLCOMMERZ">SSLCommerz</option>
                      <option value="AAMARPAY">AamarPay</option>
                    </select>
                  </Field>
                  <Field label="Batch Reference">
                    <input
                      type="text"
                      className={INPUT_CLASS}
                      value={batchRef}
                      onChange={(e) => setBatchRef(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Settlement Date">
                    <input
                      type="date"
                      className={INPUT_CLASS}
                      value={batchDate}
                      onChange={(e) => setBatchDate(e.target.value)}
                      required
                    />
                  </Field>
                </div>

                <Field label="Transactions JSON Array (externalTrxId, amount, mdrFeeBps, invoiceId)">
                  <textarea
                    rows={8}
                    className={`${INPUT_CLASS} font-mono text-[12px]`}
                    value={batchTransactionsText}
                    onChange={(e) => setBatchTransactionsText(e.target.value)}
                    required
                  />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className="ql-btn ql-btn-secondary"
                    onClick={() => setShowBatchModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ql-btn ql-btn-primary"
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Run Batch Reconciliation
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
