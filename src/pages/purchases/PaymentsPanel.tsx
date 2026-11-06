import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Calculator, CreditCard, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  OpenBill,
  PaymentPreview,
  PurchasePayment,
  PurchasePaymentApproval,
  PurchasePaymentSummary,
} from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import type { PurchaseRefs } from './purchasesRefs';
import { EmptyState, SectionCard, formatDate, newKey } from './purchasesUi';

export function PaymentsPanel({
  companyId,
  refs,
  seed,
  canPost,
  canReverse,
  canApprove,
  canViewReports,
  onChanged,
}: {
  companyId: string;
  refs: PurchaseRefs;
  seed: { partyId: string; documentId: string; key: number } | null;
  canPost: boolean;
  canReverse: boolean;
  canApprove: boolean;
  canViewReports: boolean;
  onChanged: () => void;
}) {
  const suppliers = useMemo(
    () => refs.suppliers.filter((party) => party.type === 'SUPPLIER' || party.type === 'BOTH'),
    [refs.suppliers],
  );
  const [entries, setEntries] = useState<PurchasePaymentSummary[]>([]);
  const [selected, setSelected] = useState<PurchasePayment | null>(null);
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [partyId, setPartyId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [attachmentReference, setAttachmentReference] = useState('');
  const [narrationEn, setNarrationEn] = useState('');
  const [approvals, setApprovals] = useState<PurchasePaymentApproval[]>([]);
  const [approvalReason, setApprovalReason] = useState('');
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingBills, setLoadingBills] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reversalReason, setReversalReason] = useState('');

  const loadPayments = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await purchaseApi.payments(companyId, { limit: 100 });
      setEntries(response.entries);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const loadApprovals = useCallback(async () => {
    if (!companyId || !canViewReports) return;
    try {
      const response = await purchaseApi.paymentApprovals(companyId, { status: 'PENDING', limit: 100 });
      setApprovals(response.entries);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId, canViewReports]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const loadOpenBills = useCallback(
    async (supplierId: string) => {
      if (!companyId || !supplierId) {
        setOpenBills([]);
        return;
      }
      setLoadingBills(true);
      setError(null);
      try {
        const response = await purchaseApi.openBills(companyId, supplierId, paymentDate);
        setOpenBills(response.bills);
        // Never pre-fill every open bill: the user must choose the amount to allocate to each bill.
        setAllocationAmounts({});
      } catch (caught) {
        setError(apiErrorMessage(caught));
      } finally {
        setLoadingBills(false);
      }
    },
    [companyId, paymentDate],
  );

  useEffect(() => {
    if (!seed) return;
    setPartyId(seed.partyId);
    setSelected(null);
    setPreview(null);
  }, [seed]);

  useEffect(() => {
    if (!partyId) {
      setOpenBills([]);
      return;
    }
    void loadOpenBills(partyId);
  }, [partyId, loadOpenBills]);

  useEffect(() => {
    setPreview(null);
    setCashAmount('');
  }, [partyId, paymentDate, allocationAmounts]);

  const selectedAllocations = () =>
    Object.entries(allocationAmounts)
      .filter(([, amount]) => amount.trim() !== '' && Number(amount) > 0)
      .map(([documentId, amount]) => ({ documentId, amount }));

  const calculate = async () => {
    setError(null);
    setNotice(null);
    setPreview(null);
    const allocations = selectedAllocations();
    if (!partyId || allocations.length === 0) {
      setError('Choose a supplier and at least one open bill with a positive allocation.');
      return;
    }
    setBusy(true);
    try {
      const response = await purchaseApi.previewPayment(companyId, {
        paymentDate,
        partyId,
        allocations,
      });
      setPreview(response.preview);
      setCashAmount(response.preview.totalCashBdt);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!preview) {
      setError('Calculate the withholding and cash amount before posting.');
      return;
    }
    if (!bankAccountId) {
      setError('Choose the bank or cash account.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await purchaseApi.postPayment(
        companyId,
        {
          paymentDate,
          partyId,
          bankAccountId,
          amount: cashAmount,
          reference: reference.trim() || null,
          attachmentReference: attachmentReference.trim() || null,
          narrationEn: narrationEn.trim() || null,
          allocations: selectedAllocations(),
        },
        newKey('purchase-payment'),
      );
      if (result.approvalRequest) {
        setNotice(
          `This payment is at or above the company payment approval threshold. Request ${result.approvalRequest.id.slice(0, 8)} is pending; a different controller must approve it before it is posted.`,
        );
        setPreview(null);
        setCashAmount('');
        setReference('');
        setAttachmentReference('');
        setNarrationEn('');
        await loadApprovals();
        onChanged();
        return;
      }
      setSelected(result.payment ?? null);
      setNotice('Supplier payment posted. AP allocations and withholding liabilities were created together.');
      setPreview(null);
      setCashAmount('');
      setReference('');
      setAttachmentReference('');
      setNarrationEn('');
      await loadPayments();
      await loadOpenBills(partyId);
      await loadApprovals();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openPayment = async (paymentId: string) => {
    setError(null);
    setNotice(null);
    try {
      const response = await purchaseApi.payment(companyId, paymentId);
      setSelected(response.payment);
      setReversalOpen(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const reverse = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await purchaseApi.reversePayment(companyId, selected.id, reversalDate, reversalReason);
      setSelected(response.payment);
      setReversalOpen(false);
      setReversalReason('');
      setNotice('Payment reversed. The AP open item is restored and the withholding liabilities are reversed.');
      await loadPayments();
      if (partyId) await loadOpenBills(partyId);
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (request: PurchasePaymentApproval) => {
    if (approvalReason.trim().length < 3) {
      setError('Enter an approval reason of at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await purchaseApi.approvePayment(companyId, request.id, approvalReason.trim());
      setSelected(response.payment);
      setApprovalReason('');
      setNotice(`Payment ${response.payment.paymentNumber} approved and posted. AP and withholding were updated together.`);
      await Promise.all([loadPayments(), loadApprovals(), loadOpenBills(partyId)]);
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (request: PurchasePaymentApproval) => {
    if (approvalReason.trim().length < 3) {
      setError('Enter a rejection reason of at least 3 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await purchaseApi.rejectPayment(companyId, request.id, approvalReason.trim());
      setApprovalReason('');
      setNotice('Payment approval request rejected. No payment or withholding was posted.');
      await loadApprovals();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const bankRequired = ['BANK', 'MFS', 'CHEQUE'].includes(
    refs.bankAccounts.find((account) => account.id === bankAccountId)?.kind ?? '',
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Supplier payments"
        kicker="Cash paid plus actual VDS/TDS equals the AP allocation"
        action={
          <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void loadPayments()}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      >
        {error ? <ErrorBanner message={error} /> : null}
        {notice ? <div className="mt-3"><Notice message={notice} tone="success" /></div> : null}
        <div className="mt-4 overflow-x-auto">
          {loading ? (
            <p className="py-8 text-center text-[13px] text-ink-500">Loading payments…</p>
          ) : entries.length === 0 ? (
            <EmptyState title="No supplier payments" hint="Allocate a payment to one or more posted supplier bills below." />
          ) : (
            <table className="w-full min-w-[850px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Payment</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Bank / cash</th>
                  <th className="px-2 py-2 text-right">Cash BDT</th>
                  <th className="px-2 py-2 text-right">AP allocation</th>
                  <th className="px-2 py-2">Reference</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="cursor-pointer border-t border-line/70 hover:bg-surface-2/50" onClick={() => void openPayment(entry.id)}>
                    <td className="px-2 py-3 font-semibold text-ink-900">{entry.paymentNumber}</td>
                    <td className="px-2 py-3 text-ink-700">{entry.partyNameEn}</td>
                    <td className="px-2 py-3 text-ink-600">{formatDate(entry.paymentDate)}</td>
                    <td className="px-2 py-3 text-ink-600">{entry.bankName}</td>
                    <td className="px-2 py-3 text-right font-mono">{entry.amountBdt}</td>
                    <td className="px-2 py-3 text-right font-mono">{entry.allocatedBdt}</td>
                    <td className="px-2 py-3 text-ink-500">{entry.reference ?? '—'}</td>
                    <td className="px-2 py-3">
                      <span className={`lv-chip ${entry.status === 'POSTED' ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>
                        {entry.status === 'POSTED' ? 'Posted' : 'Reversed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>

      {selected ? (
        <SectionCard title={`Payment ${selected.paymentNumber}`} kicker="Posted payment detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <dl className="grid gap-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-ink-400">Supplier</dt><dd className="mt-1 font-semibold text-ink-900">{selected.partyNameEn}</dd></div>
              <div><dt className="text-ink-400">Date</dt><dd className="mt-1 text-ink-800">{formatDate(selected.paymentDate)}</dd></div>
              <div><dt className="text-ink-400">Cash paid</dt><dd className="mt-1 font-mono text-ink-900">{selected.amountBdt}</dd></div>
              <div><dt className="text-ink-400">AP allocation</dt><dd className="mt-1 font-mono text-ink-900">{selected.allocatedBdt}</dd></div>
              <div><dt className="text-ink-400">VDS</dt><dd className="mt-1 font-mono text-ink-900">{selected.vdsBdt}</dd></div>
              <div><dt className="text-ink-400">TDS</dt><dd className="mt-1 font-mono text-ink-900">{selected.tdsBdt}</dd></div>
              <div><dt className="text-ink-400">Journal</dt><dd className="mt-1 text-ink-800">{selected.journalNumber ?? '—'}</dd></div>
              <div><dt className="text-ink-400">Approved by</dt><dd className="mt-1 text-ink-800">{selected.approvedByName ?? 'Direct posting'}</dd></div>
              <div><dt className="text-ink-400">Attachment</dt><dd className="mt-1 break-all text-ink-800">{selected.attachmentReference ?? '—'}</dd></div>
              <div><dt className="text-ink-400">Status</dt><dd className="mt-1"><span className={`lv-chip ${selected.status === 'POSTED' ? 'lv-chip-emerald' : 'lv-chip-rose'}`}>{selected.status}</span></dd></div>
            </dl>
            <div className="flex gap-2">
              <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px]" onClick={() => setSelected(null)}>
                Close detail
              </button>
              {canReverse && selected.status === 'POSTED' ? (
                <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px] text-rose-700 dark:text-rose-300" onClick={() => setReversalOpen(true)}>
                  <RotateCcw size={15} /> Reverse
                </button>
              ) : null}
            </div>
          </div>

          {reversalOpen ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[13px] text-rose-800 dark:text-rose-200">
              <p className="font-semibold">Reverse this payment?</p>
              <p className="mt-1">The AP open item reopens and the linked VDS/TDS liabilities are reversed. A second reversal is rejected.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="date" className={INPUT_CLASS} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} />
                <input className={INPUT_CLASS} placeholder="Reason (required)" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" className="lv-btn lv-btn-danger min-h-11 text-[13px]" disabled={busy || reversalReason.trim().length < 3} onClick={() => void reverse()}>
                  <Ban size={15} /> Post linked reversal
                </button>
                <button type="button" className="lv-btn lv-btn-ghost min-h-11 text-[13px]" onClick={() => setReversalOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[750px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Bill</th>
                  <th className="px-2 py-2">Supplier invoice</th>
                  <th className="px-2 py-2 text-right">Allocated</th>
                  <th className="px-2 py-2 text-right">Taxable base</th>
                  <th className="px-2 py-2 text-right">VDS</th>
                  <th className="px-2 py-2 text-right">TDS</th>
                </tr>
              </thead>
              <tbody>
                {selected.allocations.map((allocation) => (
                  <tr key={allocation.id} className="border-t border-line/70">
                    <td className="px-2 py-2 font-medium text-ink-900">{allocation.documentNo ?? '—'}</td>
                    <td className="px-2 py-2 text-ink-600">{allocation.supplierInvoiceNo}</td>
                    <td className="px-2 py-2 text-right font-mono">{allocation.amountBdt}</td>
                    <td className="px-2 py-2 text-right font-mono">{allocation.baseBdt}</td>
                    <td className="px-2 py-2 text-right font-mono">{allocation.vdsBdt}</td>
                    <td className="px-2 py-2 text-right font-mono">{allocation.tdsBdt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {canViewReports ? (
        <SectionCard
          title="Payment approvals"
          kicker="Maker-checker above the company payment threshold"
          action={
            <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" onClick={() => void loadApprovals()}>
              <RefreshCw size={15} /> Refresh
            </button>
          }
        >
          <Notice
            message="A payment at or above the configured payment threshold creates a persisted approval request and does not post. The maker cannot approve their own payment; a different controller or administrator must approve it. Rejection is terminal and posts nothing."
            tone="info"
          />
          <label className="mt-3 block max-w-xl">
            <span className="mb-1 block text-[12px] font-semibold text-ink-700">Approval or rejection reason</span>
            <input
              className={INPUT_CLASS}
              value={approvalReason}
              maxLength={500}
              onChange={(event) => setApprovalReason(event.target.value)}
              placeholder="At least 3 characters"
            />
          </label>
          <div className="mt-4 overflow-x-auto">
            {approvals.length === 0 ? (
              <EmptyState title="No pending payment approvals" hint="High-value payments waiting for a different controller appear here." />
            ) : (
              <table className="w-full min-w-[1000px] text-left text-[13px]">
                <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                  <tr>
                    <th className="px-2 py-2">Requested by</th>
                    <th className="px-2 py-2">Supplier</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Cash</th>
                    <th className="px-2 py-2 text-right">VDS</th>
                    <th className="px-2 py-2 text-right">TDS</th>
                    <th className="px-2 py-2 text-right">AP allocation</th>
                    <th className="px-2 py-2">Reference</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => (
                    <tr key={approval.id} className="border-t border-line/70">
                      <td className="px-2 py-3 text-ink-700">
                        {approval.requestedByName}
                        <span className="block text-[12px] text-ink-400">{formatDate(approval.requestedAt.slice(0, 10))}</span>
                      </td>
                      <td className="px-2 py-3 text-ink-800">{approval.partyNameEn}</td>
                      <td className="px-2 py-3 text-ink-600">{formatDate(approval.paymentDate)}</td>
                      <td className="px-2 py-3 text-right font-mono">{approval.amountBdt}</td>
                      <td className="px-2 py-3 text-right font-mono">{approval.vdsBdt}</td>
                      <td className="px-2 py-3 text-right font-mono">{approval.tdsBdt}</td>
                      <td className="px-2 py-3 text-right font-mono">{approval.allocatedBdt}</td>
                      <td className="px-2 py-3 text-ink-500">{approval.reference ?? '—'}</td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            className="lv-btn lv-btn-primary min-h-9 text-[12px]"
                            disabled={!canApprove || busy || approvalReason.trim().length < 3}
                            onClick={() => void approve(approval)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="lv-btn lv-btn-ghost min-h-9 text-[12px] text-rose-700 dark:text-rose-300"
                            disabled={!canApprove || busy || approvalReason.trim().length < 3}
                            onClick={() => void reject(approval)}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="New supplier payment" kicker="Preview first; the server calculates authoritative withholding">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Supplier" required>
            <select
              className={INPUT_CLASS}
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
            >
              <option value="">Choose supplier</option>
              {suppliers.map((party) => (
                <option key={party.id} value={party.id}>{party.code} — {party.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment date" required>
            <input type="date" className={INPUT_CLASS} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </Field>
          <Field label="Bank / cash account" required>
            <select className={INPUT_CLASS} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {refs.bankAccounts.filter((account) => account.status === 'ACTIVE').map((account) => (
                <option key={account.id} value={account.id}>{account.name} — {account.kind} — {account.glAccountCode}</option>
              ))}
            </select>
          </Field>
          <Field label={`Bank reference${bankRequired ? ' (required)' : ''}`} hint="A duplicate posted bank reference is blocked.">
            <input className={INPUT_CLASS} value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label="Attachment reference" hint="Evidence reference only; file storage is not implemented.">
            <input
              className={INPUT_CLASS}
              value={attachmentReference}
              maxLength={500}
              onChange={(event) => setAttachmentReference(event.target.value)}
            />
          </Field>
          <Field label="Narration">
            <input className={INPUT_CLASS} value={narrationEn} onChange={(event) => setNarrationEn(event.target.value)} />
          </Field>
        </div>

        {loadingBills ? <p className="mt-4 text-[13px] text-ink-500">Loading open bills…</p> : null}
        {partyId && !loadingBills && openBills.length === 0 ? (
          <p className="mt-4 text-[13px] text-ink-500">This supplier has no open posted bills.</p>
        ) : null}

        {openBills.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-ink-400">
                <tr>
                  <th className="px-2 py-2">Bill</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2 text-right">Outstanding</th>
                  <th className="px-2 py-2 text-right">Est. withholding</th>
                  <th className="px-2 py-2">Allocate BDT</th>
                </tr>
              </thead>
              <tbody>
                {openBills.map((bill) => (
                  <tr key={bill.documentId} className="border-t border-line/70">
                    <td className="px-2 py-2">
                      <p className="font-medium text-ink-900">{bill.documentNo ?? '—'}</p>
                      <p className="text-[12px] text-ink-400">{bill.supplierInvoiceNo} · {bill.docType.replaceAll('_', ' ')}</p>
                    </td>
                    <td className="px-2 py-2 text-ink-600">{formatDate(bill.dueDate)}</td>
                    <td className="px-2 py-2 text-right font-mono">{bill.outstandingBdt}</td>
                    <td className="px-2 py-2 text-right font-mono text-ink-500">{bill.expectedWithholdingBdt}</td>
                    <td className="w-[180px] px-2 py-2">
                      <input
                        className={INPUT_CLASS}
                        inputMode="decimal"
                        value={allocationAmounts[bill.documentId] ?? ''}
                        onChange={(event) =>
                          setAllocationAmounts((current) => ({ ...current, [bill.documentId]: event.target.value }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="lv-btn lv-btn-secondary min-h-11 text-[13px]" disabled={busy} onClick={() => void calculate()}>
            <Calculator size={15} /> {busy ? 'Calculating…' : 'Calculate withholding & cash'}
          </button>
          {preview ? (
            <span className="text-[13px] text-ink-600">
              Allocated {preview.totalAllocationBdt} · VDS {preview.totalVdsBdt} · TDS {preview.totalTdsBdt} · cash {preview.totalCashBdt}
            </span>
          ) : null}
        </div>

        {preview ? (
          <div className="mt-4 rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="grid gap-2 text-[13px] sm:grid-cols-4">
              <div><p className="text-ink-400">Gross allocated</p><p className="mt-1 font-mono font-semibold">{preview.totalAllocationBdt}</p></div>
              <div><p className="text-ink-400">VDS withheld</p><p className="mt-1 font-mono font-semibold">{preview.totalVdsBdt}</p></div>
              <div><p className="text-ink-400">TDS withheld</p><p className="mt-1 font-mono font-semibold">{preview.totalTdsBdt}</p></div>
              <div><p className="text-ink-400">Cash to pay</p><p className="mt-1 font-mono font-semibold">{preview.totalCashBdt}</p></div>
            </div>
            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-[12px] font-semibold text-ink-700">Cash amount (server preview)</span>
              <input className={INPUT_CLASS} value={cashAmount} readOnly />
            </label>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
              The server recalculates this amount when posted. If the allocation or bill changes, the payment is rejected and the preview must be refreshed.
            </p>
            {!canPost ? <p className="mt-2 text-[12px] font-semibold text-amber-700 dark:text-amber-300">You do not have permission to post payments.</p> : null}
            <button
              type="button"
              className="lv-btn lv-btn-primary mt-3 min-h-11 text-[13px]"
              disabled={busy || !canPost}
              onClick={() => void post()}
            >
              <CreditCard size={15} /> {busy ? 'Posting…' : 'Post supplier payment'}
            </button>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
