import { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, RefreshCw, RotateCcw, Save, X } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { OpenInvoice, SalesReceipt, SalesReceiptSummary } from '../../sales/api';
import { salesApi } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import type { SalesRefs } from './salesRefs';
import { EmptyState, SALES_INPUT, SALES_SELECT, StatusChip, formatDate, newIdempotencyKey, todayIso } from './salesUi';

interface AllocationDraft {
  amount: string;
  writeOff: string;
}

function moneyToNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatBdtForInput(value: string): string {
  try {
    const poisha = BigInt(value);
    const whole = poisha / 100n;
    const fraction = poisha % 100n;
    return `${whole}.${fraction.toString().padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

export function ReceiptsPanel({
  companyId,
  refs,
  canPost,
  canReverse,
  initialPartyId,
  initialInvoiceId,
  onChanged,
}: {
  companyId: string;
  refs: SalesRefs;
  canPost: boolean;
  canReverse: boolean;
  initialPartyId?: string | null;
  initialInvoiceId?: string | null;
  onChanged: () => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const customers = useMemo(() => refs.parties.filter((party) => party.type === 'CUSTOMER' || party.type === 'BOTH'), [refs.parties]);
  const bankAccounts = useMemo(() => refs.bankAccounts.filter((account) => account.status === 'ACTIVE'), [refs.bankAccounts]);
  const expenseAccounts = useMemo(() => refs.accounts.filter((account) => account.isActive && account.accountType === 'EXPENSE'), [refs.accounts]);
  const [formOpen, setFormOpen] = useState(Boolean(initialInvoiceId));
  const [partyId, setPartyId] = useState(initialPartyId ?? '');
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '');
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [attachmentReference, setAttachmentReference] = useState('');
  const [narration, setNarration] = useState('');
  const [writeOffAccountId, setWriteOffAccountId] = useState('');
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, AllocationDraft>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [receipts, setReceipts] = useState<SalesReceiptSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<SalesReceipt | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseDate, setReverseDate] = useState(todayIso());
  const [reversing, setReversing] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const response = await salesApi.receipts(companyId, { limit: 50 });
      setReceipts(response.entries);
      setTotal(response.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoadingList(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  const loadOpen = useCallback(
    async (selectedParty: string) => {
      if (!selectedParty) {
        setOpenInvoices([]);
        setAllocations({});
        return;
      }
      setLoadingInvoices(true);
      setError(null);
      try {
        const response = await salesApi.openInvoices(companyId, { partyId: selectedParty });
        setOpenInvoices(response.invoices);
        setAllocations((current) => {
          const next: Record<string, AllocationDraft> = {};
          for (const invoice of response.invoices) {
            next[invoice.documentId] = current[invoice.documentId] ?? { amount: '', writeOff: '' };
          }
          if (initialInvoiceId && response.invoices.some((invoice) => invoice.documentId === initialInvoiceId)) {
            const invoice = response.invoices.find((entry) => entry.documentId === initialInvoiceId)!;
            next[initialInvoiceId] = { amount: formatBdtForInput(invoice.outstandingPoisha), writeOff: '' };
          }
          return next;
        });
      } catch (caught) {
        setError(apiErrorMessage(caught));
      } finally {
        setLoadingInvoices(false);
      }
    },
    [companyId, initialInvoiceId],
  );

  useEffect(() => {
    if (partyId) void loadOpen(partyId);
  }, [loadOpen, partyId]);

  useEffect(() => {
    if (formOpen && initialPartyId) {
      setPartyId(initialPartyId);
      setFormOpen(true);
    }
  }, [formOpen, initialPartyId]);

  const selectedParty = customers.find((party) => party.id === partyId);
  const totalCash = Object.values(allocations).reduce((sum, entry) => sum + moneyToNumber(entry.amount), 0);
  const totalWriteOff = Object.values(allocations).reduce((sum, entry) => sum + moneyToNumber(entry.writeOff), 0);
  const receiptAmount = moneyToNumber(amount);
  const unapplied = Math.max(0, receiptAmount - totalCash);

  const autoAllocate = () => {
    let remaining = receiptAmount;
    setAllocations((current) => {
      const next = { ...current };
      for (const invoice of openInvoices) {
        const open = moneyToNumber(invoice.outstandingBdt);
        const allocate = Math.min(open, remaining);
        next[invoice.documentId] = { amount: allocate > 0 ? allocate.toFixed(2) : '', writeOff: next[invoice.documentId]?.writeOff ?? '' };
        remaining -= allocate;
        if (remaining <= 0) break;
      }
      return next;
    });
  };

  const resetForm = () => {
    setAmount('');
    setReference('');
    setAttachmentReference('');
    setNarration('');
    setWriteOffAccountId('');
    setAllocations({});
    setError(null);
    setNotice(null);
  };

  const postReceipt = async () => {
    setError(null);
    setNotice(null);
    if (!partyId) {
      setError(L('Choose a customer.', 'একজন গ্রাহক নির্বাচন করুন।'));
      return;
    }
    if (!bankAccountId) {
      setError(L('Choose a bank, cash or MFS account.', 'ব্যাংক, নগদ বা এমএফএস হিসাব নির্বাচন করুন।'));
      return;
    }
    if (receiptAmount <= 0) {
      setError(L('Enter a positive receipt amount.', 'ধনাত্মক রিসিট পরিমাণ লিখুন।'));
      return;
    }
    if (totalWriteOff > 0 && !writeOffAccountId) {
      setError(L('Choose the expense account for the write-off.', 'রাইট-অফের জন্য খরচ হিসাব নির্বাচন করুন।'));
      return;
    }
    const payloadAllocations = Object.entries(allocations)
      .map(([documentId, entry]) => ({ documentId, amount: entry.amount || '0.00', writeOff: entry.writeOff || '0.00' }))
      .filter((entry) => moneyToNumber(entry.amount) > 0 || moneyToNumber(entry.writeOff) > 0);
    setBusy(true);
    try {
      const response = await salesApi.postReceipt(
        companyId,
        {
          receiptDate,
          partyId,
          bankAccountId,
          amount,
          writeOffAccountId: totalWriteOff > 0 ? writeOffAccountId : null,
          reference: reference.trim() || null,
          attachmentReference: attachmentReference.trim() || null,
          narrationEn: narration.trim() || null,
          allocations: payloadAllocations,
        },
        newIdempotencyKey('sales-receipt'),
      );
      setSelectedReceipt(response.receipt);
      setNotice(L('Receipt posted and allocated to the selected invoices.', 'রিসিট পোস্ট হয়েছে এবং নির্বাচিত চালানে বরাদ্দ হয়েছে।'));
      resetForm();
      setRefreshKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async (receiptId: string) => {
    setError(null);
    try {
      const response = await salesApi.receipt(companyId, receiptId);
      setSelectedReceipt(response.receipt);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const reverseReceipt = async () => {
    if (!selectedReceipt) return;
    setReversing(true);
    setError(null);
    try {
      const response = await salesApi.reverseReceipt(companyId, selectedReceipt.id, reverseDate, reverseReason.trim());
      setSelectedReceipt(response.receipt);
      setReverseReason('');
      setRefreshKey((value) => value + 1);
      onChanged();
      setNotice(L('Receipt reversed. Its allocations no longer reduce the invoice balances.', 'রিসিট বাতিল হয়েছে। এর বরাদ্দ আর চালানের ব্যালেন্স কমাবে না।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setReversing(false);
    }
  };

  return (
    <section className="ql-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{L('Receivables', 'প্রাপ্য')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">{L('Customer receipts', 'গ্রাহক রিসিট')}</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'A receipt is a separate document. Cash, write-off and AR are posted once; allocations then determine which invoices are cleared. Partial and multiple allocations are supported.',
              'রিসিট একটি আলাদা ডকুমেন্ট। নগদ, রাইট-অফ ও এআর একবার পোস্ট হয়; বরাদ্দ নির্ধারণ করে কোন চালান পরিশোধিত হবে। আংশিক ও একাধিক বরাদ্দ সমর্থিত।',
            )}
          </p>
        </div>
        {canPost ? (
          <button type="button" onClick={() => { setFormOpen(true); resetForm(); }} className="ql-btn ql-btn-primary min-h-11 text-[13px]">
            <Receipt size={15} /> {L('New receipt', 'নতুন রিসিট')}
          </button>
        ) : null}
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

      {formOpen && canPost ? (
        <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[17px] font-semibold text-ink-900">{L('Post a receipt', 'রিসিট পোস্ট করুন')}</h3>
              <p className="mt-1 text-[12px] text-ink-500">{L('Cash is credited to AR in full. Unapplied cash remains a customer credit.', 'নগদ সম্পূর্ণভাবে এআর-এ ক্রেডিট হয়। অব্যবহৃত নগদ গ্রাহক ক্রেডিট হিসেবে থাকে।')}</p>
            </div>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg p-1.5 text-ink-500 hover:bg-surface-2" aria-label={L('Close receipt form', 'রিসিট ফর্ম বন্ধ')}>
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Customer', 'গ্রাহক')} <span className="text-rose-500">*</span>
              <select value={partyId} onChange={(event) => setPartyId(event.target.value)} className={`${SALES_SELECT} mt-1`}>
                <option value="">{L('Choose a customer', 'গ্রাহক নির্বাচন করুন')}</option>
                {customers.map((party) => <option key={party.id} value={party.id}>{party.code} · {party.nameEn}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Bank / cash / MFS', 'ব্যাংক / নগদ / এমএফএস')} <span className="text-rose-500">*</span>
              <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} className={`${SALES_SELECT} mt-1`}>
                <option value="">{L('Choose an account', 'হিসাব নির্বাচন করুন')}</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.glAccountCode}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Receipt date', 'রিসিট তারিখ')} <span className="text-rose-500">*</span>
              <input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} className={`${SALES_INPUT} mt-1`} />
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Amount received', 'প্রাপ্ত পরিমাণ')} <span className="text-rose-500">*</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={`${SALES_INPUT} mt-1`} placeholder="0.00" />
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Bank reference', 'ব্যাংক রেফারেন্স')}
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} className={`${SALES_INPUT} mt-1`} placeholder={L('Deposit slip, MFS transaction ID', 'ডিপোজিট স্লিপ, এমএফএস ট্রানজেকশন আইডি')} />
            </label>
            <label className="block text-[12px] font-semibold text-ink-600">
              {L('Attachment reference', 'সংযুক্তির রেফারেন্স')}
              <input value={attachmentReference} onChange={(event) => setAttachmentReference(event.target.value)} maxLength={500} className={`${SALES_INPUT} mt-1`} placeholder={L('Evidence file reference', 'প্রমাণ ফাইলের রেফারেন্স')} />
            </label>
            <label className="block text-[12px] font-semibold text-ink-600 sm:col-span-2">
              {L('Narration', 'বিবরণ')}
              <input value={narration} onChange={(event) => setNarration(event.target.value)} maxLength={500} className={`${SALES_INPUT} mt-1`} />
            </label>
            {totalWriteOff > 0 ? (
              <label className="block text-[12px] font-semibold text-ink-600">
                {L('Write-off expense account', 'রাইট-অফ খরচ হিসাব')} <span className="text-rose-500">*</span>
                <select value={writeOffAccountId} onChange={(event) => setWriteOffAccountId(event.target.value)} className={`${SALES_SELECT} mt-1`}>
                  <option value="">{L('Choose an expense account', 'খরচ হিসাব নির্বাচন করুন')}</option>
                  {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.nameEn}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[15px] font-semibold text-ink-900">{L('Allocate to open invoices', 'খোলা চালানে বরাদ্দ')}</h4>
              <button type="button" onClick={autoAllocate} disabled={!receiptAmount || openInvoices.length === 0} className="ql-btn ql-btn-secondary min-h-10 text-[12px]">
                {L('Auto-allocate oldest first', 'প্রাচীনতম আগে স্বয়ংক্রিয় বরাদ্দ')}
              </button>
            </div>
            {!partyId ? (
              <p className="mt-2 text-[13px] text-ink-500">{L('Choose a customer to load open invoices.', 'খোলা চালান লোড করতে গ্রাহক নির্বাচন করুন।')}</p>
            ) : loadingInvoices ? (
              <p className="mt-2 text-[13px] text-ink-500">{L('Loading open invoices…', 'খোলা চালান লোড হচ্ছে…')}</p>
            ) : openInvoices.length === 0 ? (
              <div className="mt-2"><EmptyState title={L('No open invoices', 'কোনো খোলা চালান নেই')} hint={L('This receipt will remain entirely unapplied customer cash.', 'এই রিসিট সম্পূর্ণভাবে অব্যবহৃত গ্রাহক নগদ হিসেবে থাকবে।')} /></div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="ql-table w-full min-w-[760px] text-[13px]">
                  <caption className="sr-only">{L('Open invoices for allocation', 'বরাদ্দের জন্য খোলা চালান')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="text-left">{L('Invoice', 'চালান')}</th>
                      <th scope="col" className="text-left">{L('Due', 'পরিশোধ')}</th>
                      <th scope="col" className="text-right">{L('Open', 'খোলা')}</th>
                      <th scope="col" className="text-right">{L('Cash allocation', 'নগদ বরাদ্দ')}</th>
                      <th scope="col" className="text-right">{L('Write-off', 'রাইট-অফ')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((invoice) => (
                      <tr key={invoice.documentId}>
                        <td>
                          <p className="font-semibold text-ink-800">{invoice.documentNo ?? L('Draft', 'খসড়া')}</p>
                          <p className="mt-0.5 text-[12px] text-ink-400">{formatDate(invoice.docDate)} · {invoice.statutorySerial ?? '—'}</p>
                        </td>
                        <td>{formatDate(invoice.dueDate)}</td>
                        <td className="text-right font-money tabular-nums">{invoice.outstandingBdt}</td>
                        <td className="w-[150px]">
                          <input
                            value={allocations[invoice.documentId]?.amount ?? ''}
                            onChange={(event) => setAllocations((current) => ({ ...current, [invoice.documentId]: { amount: event.target.value, writeOff: current[invoice.documentId]?.writeOff ?? '' } }))}
                            inputMode="decimal"
                            className={SALES_INPUT}
                            aria-label={`${L('Cash allocation for', 'নগদ বরাদ্দ')} ${invoice.documentNo ?? invoice.documentId}`}
                          />
                        </td>
                        <td className="w-[150px]">
                          <input
                            value={allocations[invoice.documentId]?.writeOff ?? ''}
                            onChange={(event) => setAllocations((current) => ({ ...current, [invoice.documentId]: { amount: current[invoice.documentId]?.amount ?? '', writeOff: event.target.value } }))}
                            inputMode="decimal"
                            className={SALES_INPUT}
                            aria-label={`${L('Write-off for', 'রাইট-অফ')} ${invoice.documentNo ?? invoice.documentId}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-2 text-[13px] sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-[12px] text-ink-400">{L('Receipt', 'রিসিট')}</p>
              <p className="mt-0.5 font-money font-semibold text-ink-900">{receiptAmount.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-[12px] text-ink-400">{L('Allocated cash', 'বরাদ্দ নগদ')}</p>
              <p className="mt-0.5 font-money font-semibold text-ink-900">{totalCash.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-[12px] text-ink-400">{L('Unapplied cash', 'অব্যবহৃত নগদ')}</p>
              <p className="mt-0.5 font-money font-semibold text-ink-900">{unapplied.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={resetForm} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
              <RefreshCw size={14} /> {L('Clear', 'মুছুন')}
            </button>
            <button type="button" onClick={() => void postReceipt()} disabled={busy || !selectedParty} className="ql-btn ql-btn-primary min-h-11 text-[13px]">
              <Save size={15} /> {busy ? L('Posting…', 'পোস্ট হচ্ছে…') : L('Post receipt', 'রিসিট পোস্ট')}
            </button>
          </div>
          {totalWriteOff > 0 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
              {L('A write-off is permissioned: only a controller, owner or admin with APPROVE_HIGH_VALUE can post it.', 'রাইট-অফ অনুমতিসাপেক্ষ: শুধু APPROVE_HIGH_VALUE সহ নিয়ন্ত্রক, মালিক বা প্রশাসক এটি পোস্ট করতে পারেন।')}
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedReceipt ? (
        <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="ql-kicker">{L('Receipt detail', 'রিসিট বিস্তারিত')}</p>
              <h3 className="mt-1 flex flex-wrap items-center gap-2 text-[18px] font-semibold text-ink-900">
                {selectedReceipt.receiptNumber}
                <StatusChip status={selectedReceipt.status === 'POSTED' ? 'POSTED_RECEIPT' : 'REVERSED_RECEIPT'} />
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">{selectedReceipt.partyNameEn} · {formatDate(selectedReceipt.receiptDate)} · {selectedReceipt.bankAccountName}</p>
            </div>
            <button type="button" onClick={() => setSelectedReceipt(null)} className="rounded-lg p-1.5 text-ink-500 hover:bg-surface-2" aria-label={L('Close receipt detail', 'রিসিট বিস্তারিত বন্ধ')}>
              <X size={16} />
            </button>
          </div>
          <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-4">
            <div><dt className="text-ink-400">{L('Amount', 'পরিমাণ')}</dt><dd className="mt-0.5 font-money font-semibold text-ink-900">{selectedReceipt.amountBdt}</dd></div>
            <div><dt className="text-ink-400">{L('Allocated', 'বরাদ্দ')}</dt><dd className="mt-0.5 font-money font-semibold text-ink-900">{selectedReceipt.allocatedBdt}</dd></div>
            <div><dt className="text-ink-400">{L('Write-off', 'রাইট-অফ')}</dt><dd className="mt-0.5 font-money font-semibold text-ink-900">{selectedReceipt.writeOffBdt}</dd></div>
            <div><dt className="text-ink-400">{L('Unapplied', 'অব্যবহৃত')}</dt><dd className="mt-0.5 font-money font-semibold text-ink-900">{selectedReceipt.unappliedBdt}</dd></div>
          </dl>
          <p className="mt-2 break-all text-[12px] text-ink-500">
            {L('Attachment', 'সংযুক্তি')}: {selectedReceipt.attachmentReference ?? '—'}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="ql-table w-full min-w-[620px] text-[13px]">
              <caption className="sr-only">{L('Receipt allocations', 'রিসিট বরাদ্দ')}</caption>
              <thead><tr><th scope="col" className="text-left">{L('Invoice', 'চালান')}</th><th scope="col" className="text-left">{L('Due', 'পরিশোধ')}</th><th scope="col" className="text-right">{L('Cash', 'নগদ')}</th><th scope="col" className="text-right">{L('Write-off', 'রাইট-অফ')}</th></tr></thead>
              <tbody>
                {selectedReceipt.allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td className="font-semibold text-ink-800">{allocation.documentNo}</td>
                    <td>{formatDate(allocation.dueDate)}</td>
                    <td className="text-right font-money tabular-nums">{allocation.amountBdt}</td>
                    <td className="text-right font-money tabular-nums">{allocation.writeOffBdt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedReceipt.status === 'POSTED' && canReverse ? (
            <div className="mt-4 rounded-lg border border-line bg-surface p-3">
              <p className="text-[13px] font-semibold text-ink-800">{L('Reverse this receipt', 'এই রিসিট বাতিল করুন')}</p>
              <p className="mt-1 text-[12px] text-ink-500">{L('Reversing reopens the allocated invoices and removes the cash credit. The original receipt remains in history.', 'বাতিল করলে বরাদ্দকৃত চালান পুনরায় খুলবে এবং নগদ ক্রেডিট সরবে। মূল রিসিট ইতিহাসে থাকবে।')}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} className={SALES_INPUT} aria-label={L('Reversal date', 'রিভার্সাল তারিখ')} />
                <input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} maxLength={500} className={SALES_INPUT} placeholder={L('Reason (3–500 characters)', 'কারণ (৩–৫০০ অক্ষর)')} aria-label={L('Reversal reason', 'রিভার্সাল কারণ')} />
              </div>
              <button type="button" onClick={() => void reverseReceipt()} disabled={reversing || reverseReason.trim().length < 3} className="ql-btn ql-btn-secondary mt-2 min-h-10 text-[12px] text-rose-700 dark:text-rose-300">
                <RotateCcw size={14} /> {reversing ? L('Reversing…', 'বাতিল হচ্ছে…') : L('Confirm receipt reversal', 'রিসিট রিভার্সাল নিশ্চিত')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-500">{total} {L('receipt(s)', 'রিসিট')}</p>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loadingList} className="ql-btn ql-btn-secondary min-h-10 text-[12px]">
          <RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} /> {L('Refresh', 'রিফ্রেশ')}
        </button>
      </div>
      {receipts.length === 0 && !loadingList ? (
        <div className="mt-3"><EmptyState title={L('No customer receipts yet', 'এখনও কোনো গ্রাহক রিসিট নেই')} hint={L('Post a receipt to clear invoices and track unapplied cash.', 'চালান পরিশোধ ও অব্যবহৃত নগদ ট্র্যাক করতে একটি রিসিট পোস্ট করুন।')} /></div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="ql-table w-full min-w-[900px] text-[13px]">
            <caption className="sr-only">{L('Customer receipts', 'গ্রাহক রিসিট')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{L('Receipt', 'রিসিট')}</th>
                <th scope="col" className="text-left">{L('Customer', 'গ্রাহক')}</th>
                <th scope="col" className="text-left">{L('Date', 'তারিখ')}</th>
                <th scope="col" className="text-right">{L('Amount', 'পরিমাণ')}</th>
                <th scope="col" className="text-right">{L('Allocated', 'বরাদ্দ')}</th>
                <th scope="col" className="text-right">{L('Unapplied', 'অব্যবহৃত')}</th>
                <th scope="col" className="text-left">{L('Status', 'স্ট্যাটাস')}</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={receipt.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => void openReceipt(receipt.id)}>
                  <td><button type="button" onClick={() => void openReceipt(receipt.id)} className="font-semibold text-brand-bright underline-offset-2 hover:underline">{receipt.receiptNumber}</button></td>
                  <td>{receipt.partyNameEn}<p className="mt-0.5 text-[12px] text-ink-400">{receipt.bankAccountName}</p></td>
                  <td>{formatDate(receipt.receiptDate)}</td>
                  <td className="text-right font-money tabular-nums">{receipt.amountBdt}</td>
                  <td className="text-right font-money tabular-nums">{receipt.allocatedBdt}</td>
                  <td className="text-right font-money tabular-nums">{receipt.unappliedBdt}</td>
                  <td><StatusChip status={receipt.status === 'POSTED' ? 'POSTED_RECEIPT' : 'REVERSED_RECEIPT'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
