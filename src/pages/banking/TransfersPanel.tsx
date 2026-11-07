import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import type { BankAccount } from '../../setup/api';
import type { BankTransfer } from '../../banking/api';
import { bankingApi } from '../../banking/api';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { formatDate, newKey, statusChip, todayIso } from './bankingUi';

export function TransfersPanel({
  companyId,
  banks,
  canPost,
  canReverse,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  banks: BankAccount[];
  canPost: boolean;
  canReverse: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { money } = usePreferences();
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [fromBankAccountId, setFromBankAccountId] = useState('');
  const [toBankAccountId, setToBankAccountId] = useState('');
  const [transferDate, setTransferDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [reversalDate, setReversalDate] = useState(todayIso());
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeBanks = useMemo(() => banks.filter((bank) => bank.status === 'ACTIVE'), [banks]);

  useEffect(() => {
    if (!fromBankAccountId && activeBanks[0]) setFromBankAccountId(activeBanks[0].id);
    if (!toBankAccountId && activeBanks[1]) setToBankAccountId(activeBanks[1].id);
  }, [activeBanks, fromBankAccountId, toBankAccountId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await bankingApi.transfers(companyId, { limit: 100 });
      setTransfers(response.entries);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const create = async (): Promise<void> => {
    if (!fromBankAccountId || !toBankAccountId || fromBankAccountId === toBankAccountId) {
      setError('Choose two different bank, MFS or cash accounts.');
      return;
    }
    if (!amount || !reference.trim()) {
      setError('Enter the amount and a transfer reference.');
      return;
    }
    if (
      !window.confirm(
        `Post the bank transfer of ${amount} BDT?\n\nOne balanced journal will move the funds between the two GL accounts. The transfer is audited and can only be corrected by a linked reversal.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.createTransfer(
        companyId,
        {
          fromBankAccountId,
          toBankAccountId,
          transferDate,
          amount,
          reference: reference.trim(),
          narration: narration.trim() || null,
        },
        newKey('bank-transfer'),
      );
      setNotice(`Transfer ${response.transfer.transferNumber} posted as journal ${response.transfer.journalNumber ?? ''}.`);
      setAmount('');
      setReference('');
      setNarration('');
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (transfer: BankTransfer): Promise<void> => {
    if (reversalReason.trim().length < 3) {
      setError('Enter a reversal reason of at least 3 characters.');
      return;
    }
    if (
      !window.confirm(
        `Reverse transfer ${transfer.transferNumber}?\n\nA linked reversing journal is posted. The original transfer and journal remain immutable, and a second reversal is blocked.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.reverseTransfer(
        companyId,
        transfer.id,
        reversalDate,
        reversalReason.trim(),
      );
      setNotice(`Transfer ${response.transfer.transferNumber} reversed by journal ${response.transfer.reversalJournalNumber ?? ''}.`);
      setReversingId(null);
      setReversalReason('');
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="ql-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ql-kicker">Internal treasury movement</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">Transfer between accounts</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              A transfer posts one balanced journal: debit the destination GL account, credit the source GL account. It has its own
              number, idempotency key and audit trail. Corrections use a linked reversal.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>
        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="From account" required>
            <select className={INPUT_CLASS} value={fromBankAccountId} onChange={(event) => setFromBankAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {activeBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>{bank.name} · {bank.kind}</option>
              ))}
            </select>
          </Field>
          <Field label="To account" required>
            <select className={INPUT_CLASS} value={toBankAccountId} onChange={(event) => setToBankAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {activeBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>{bank.name} · {bank.kind}</option>
              ))}
            </select>
          </Field>
          <Field label="Date" required>
            <input className={INPUT_CLASS} type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} />
          </Field>
          <Field label="Amount (BDT)" required>
            <input className={INPUT_CLASS} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Reference" required>
            <input className={INPUT_CLASS} value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} />
          </Field>
          <Field label="Narration">
            <input className={INPUT_CLASS} value={narration} onChange={(event) => setNarration(event.target.value)} maxLength={500} />
          </Field>
          <div className="self-end xl:col-span-2">
            <button type="button" onClick={() => void create()} disabled={busy || !canPost} className="ql-btn ql-btn-primary min-h-11 w-full text-[13px]">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Post transfer
            </button>
          </div>
        </div>
        {!canPost ? <p className="mt-2 text-[12px] text-ink-400">Your role cannot post transfers.</p> : null}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><ArrowRightLeft size={13} /> Transfer register</p>
            <h2 className="mt-1 text-[18px] font-semibold text-ink-900">Posted and reversed transfers</h2>
          </div>
          <span className="ql-badge ql-badge-neutral">{transfers.length} transfer(s)</span>
        </div>
        {transfers.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-500">No bank transfer has been posted.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12px]">
              <caption className="sr-only">Bank transfer register</caption>
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Transfer</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">From → to</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Journal</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className={transfer.status === 'REVERSED' ? 'bg-surface-2/30 text-ink-500' : ''}>
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold text-ink-900">{transfer.transferNumber}</span>
                      <span className="mt-0.5 block text-ink-500">{transfer.reference}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {transfer.fromBankAccountName} → {transfer.toBankAccountName}
                    </td>
                    <td className="px-3 py-2.5">{formatDate(transfer.transferDate)}</td>
                    <td className="font-money px-3 py-2.5 text-right font-semibold text-ink-900">{money(BigInt(transfer.amountPoisha))}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono">{transfer.journalNumber ?? transfer.journalId.slice(0, 8)}</span>
                      {transfer.reversalJournalNumber ? (
                        <span className="mt-0.5 block text-rose-700">reversed by {transfer.reversalJournalNumber}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{statusChip(transfer.status)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {transfer.status === 'POSTED' && canReverse ? (
                        reversingId === transfer.id ? (
                          <div className="ml-auto grid max-w-[260px] gap-2 text-left">
                            <input className={INPUT_CLASS} type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} />
                            <input className={INPUT_CLASS} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Reversal reason" maxLength={500} />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => void reverse(transfer)} disabled={busy} className="ql-btn ql-btn-primary min-h-9 flex-1 text-[12px]">
                                <RotateCcw size={13} /> Reverse
                              </button>
                              <button type="button" onClick={() => setReversingId(null)} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setReversingId(transfer.id)} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                            <RotateCcw size={13} /> Reverse
                          </button>
                        )
                      ) : (
                        <span className="text-ink-400">{transfer.status === 'REVERSED' ? 'Reversed' : 'Read-only'}</span>
                      )}
                    </td>
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
