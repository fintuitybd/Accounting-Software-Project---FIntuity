import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Landmark, Loader2, Plus, Star } from 'lucide-react';
import { setupApi, type BankAccount, type SetupAccount } from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';

const KIND_LABEL: Record<string, string> = {
  BANK: 'Bank',
  MFS: 'Mobile financial service',
  CASH: 'Cash',
};

export default function BankAccountsStep({
  companyId,
  accounts,
  bankAccounts,
  canManage,
  onChanged,
}: {
  companyId: string;
  accounts: SetupAccount[];
  bankAccounts: BankAccount[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const glOptions = useMemo(
    () =>
      accounts.filter(
        (account) => account.isActive && account.accountType === 'ASSET' && account.controlSubledger === 'BANK_MFS',
      ),
    [accounts],
  );
  const [form, setForm] = useState({
    name: '',
    kind: 'BANK' as 'BANK' | 'MFS' | 'CASH',
    provider: '',
    maskedNumber: '',
    branch: '',
    glAccountId: '',
    openingBalance: '0.00',
    isPrincipal: false,
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string | boolean): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      await setupApi.createBankAccount(companyId, {
        name: form.name,
        kind: form.kind,
        provider: form.provider || null,
        maskedNumber: form.maskedNumber || null,
        branch: form.branch || null,
        glAccountId: form.glAccountId,
        openingBalance: form.openingBalance || '0.00',
        isPrincipal: form.isPrincipal,
      });
      setNotice('Bank/cash/MFS account created with its GL mapping. The change is audited.');
      setForm({ name: '', kind: 'BANK', provider: '', maskedNumber: '', branch: '', glAccountId: '', openingBalance: '0.00', isPrincipal: false });
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSaving(false);
    }
  };

  const setPrincipal = async (account: BankAccount): Promise<void> => {
    if (!canManage || account.isPrincipal) return;
    if (!window.confirm(`Make ${account.name} the principal bank/cash account? The current principal will be replaced.`)) return;
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      await setupApi.updateBankAccount(companyId, account.id, { isPrincipal: true });
      setNotice(`${account.name} is now the principal account.`);
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (account: BankAccount, status: 'ACTIVE' | 'INACTIVE'): Promise<void> => {
    if (!canManage) return;
    if (account.isPrincipal && status === 'INACTIVE') {
      setError('Assign another principal account before deactivating the current principal account.');
      return;
    }
    const consequence =
      status === 'ACTIVE'
        ? `Reactivate ${account.name}? It will be selectable for new transactions.`
        : `Deactivate ${account.name}? Existing history remains, but it cannot be selected for new transactions.`;
    if (!window.confirm(consequence)) return;
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      await setupApi.updateBankAccount(companyId, account.id, { status });
      setNotice(`${account.name} is now ${status.toLowerCase()}.`);
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Banks, cash and MFS</h2>
        <p className="mt-1 text-[13px] text-ink-500">
          Map each account to a BANK_MFS control account. Store only a masked number. At least one active
          principal account is required to complete onboarding.
        </p>
      </div>

      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      <Notice
        message="The opening-balance value here is schedule metadata for setup. Once an opening batch is submitted, that batch is the authoritative opening position and this metadata cannot be edited."
      />

      {canManage ? (
        <form onSubmit={create} className="grid gap-3 rounded-2xl border border-line bg-surface-2/40 p-4 md:grid-cols-3">
          <Field label="Account name" required>
            <input className={INPUT_CLASS} value={form.name} onChange={(event) => set('name', event.target.value)} required maxLength={120} disabled={saving} />
          </Field>
          <Field label="Kind" required>
            <select className={INPUT_CLASS} value={form.kind} onChange={(event) => set('kind', event.target.value)} disabled={saving}>
              <option value="BANK">Bank</option>
              <option value="MFS">Mobile financial service</option>
              <option value="CASH">Cash</option>
            </select>
          </Field>
          <Field label="Provider" hint="Required for bank and MFS accounts.">
            <input className={INPUT_CLASS} value={form.provider} onChange={(event) => set('provider', event.target.value)} maxLength={120} disabled={saving} />
          </Field>
          <Field label="Masked number" required hint="Example: •••• 4471. A full account number is rejected.">
            <input className={INPUT_CLASS} value={form.maskedNumber} onChange={(event) => set('maskedNumber', event.target.value)} maxLength={40} disabled={saving} />
          </Field>
          <Field label="Branch">
            <input className={INPUT_CLASS} value={form.branch} onChange={(event) => set('branch', event.target.value)} maxLength={120} disabled={saving} />
          </Field>
          <Field label="GL account" required hint={glOptions.length === 0 ? 'Create an ASSET account with BANK_MFS control subledger first.' : 'Only active ASSET accounts with BANK_MFS control are shown.'}>
            <select className={INPUT_CLASS} value={form.glAccountId} onChange={(event) => set('glAccountId', event.target.value)} required disabled={saving || glOptions.length === 0}>
              <option value="">Choose GL account</option>
              {glOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="Opening balance (BDT)" hint="Schedule metadata only; not an authoritative ledger balance.">
            <input className={INPUT_CLASS} value={form.openingBalance} onChange={(event) => set('openingBalance', event.target.value)} inputMode="decimal" disabled={saving} />
          </Field>
          <label className="flex min-h-11 items-center gap-2 self-end text-[13px] text-ink-700">
            <input type="checkbox" checked={form.isPrincipal} onChange={(event) => set('isPrincipal', event.target.checked)} disabled={saving} />
            Principal account
          </label>
          <div className="self-end">
            <button type="submit" disabled={saving || glOptions.length === 0} className="lv-btn lv-btn-primary min-h-11 w-full text-[14px]">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add account
            </button>
          </div>
        </form>
      ) : (
        <Notice message="Your role can view bank/cash/MFS accounts but cannot change them." tone="warning" />
      )}

      {bankAccounts.length === 0 ? (
        <Notice message="No bank, cash or MFS account exists yet. Add at least one and mark it principal." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[860px] text-left text-[12px]">
            <thead className="bg-surface-2/40 text-ink-400">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Masked number</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">GL mapping</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Opening metadata</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {bankAccounts.map((account) => (
                <tr key={account.id} className={account.status === 'ACTIVE' ? '' : 'bg-surface-2/20 text-ink-400'}>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2 font-semibold text-ink-900">
                      <Landmark size={14} className="text-brand-bright" />
                      {account.name}
                    </span>
                    <span className="mt-0.5 block text-ink-500">{KIND_LABEL[account.kind]}{account.provider ? ` · ${account.provider}` : ''}{account.branch ? ` · ${account.branch}` : ''}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-700">{account.maskedNumber ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-ink-700">{account.glAccountCode}</span>
                    <span className="ml-2 text-ink-500">{account.glAccountName}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-money text-ink-900">{account.openingBdt}</td>
                  <td className="px-3 py-2.5">
                    <span className={`lv-chip text-[12px] ${account.status === 'ACTIVE' ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>{account.status}</span>
                    {account.isPrincipal ? (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[12px] font-semibold text-amber-800 dark:text-amber-200">
                        <Star size={11} /> Principal
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {canManage ? (
                        <>
                          {!account.isPrincipal && account.status === 'ACTIVE' ? (
                            <button type="button" onClick={() => void setPrincipal(account)} disabled={busyId === account.id} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-600 hover:border-line-strong hover:text-ink-900 disabled:opacity-50">
                              {busyId === account.id ? <Loader2 size={13} className="animate-spin" /> : 'Set principal'}
                            </button>
                          ) : null}
                          {account.status === 'ACTIVE' && !account.isPrincipal ? (
                            <button type="button" onClick={() => void setStatus(account, 'INACTIVE')} disabled={busyId === account.id} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50">
                              Deactivate
                            </button>
                          ) : null}
                          {account.status === 'INACTIVE' ? (
                            <button type="button" onClick={() => void setStatus(account, 'ACTIVE')} disabled={busyId === account.id} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-600 hover:border-line-strong hover:text-ink-900 disabled:opacity-50">
                              Reactivate
                            </button>
                          ) : null}
                          {account.isPrincipal ? <span className="inline-flex items-center gap-1 px-1 text-[12px] text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={12} /> Required principal</span> : null}
                        </>
                      ) : (
                        <span className="text-ink-400">Read-only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
