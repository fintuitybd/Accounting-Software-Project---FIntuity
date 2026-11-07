import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Loader2, Plus, RefreshCw } from 'lucide-react';
import type { BankAccount, SetupAccount } from '../../setup/api';
import type { BankFeeRule } from '../../banking/api';
import { bankingApi } from '../../banking/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { formatDate, statusChip, todayIso } from './bankingUi';

function percentToBps(value: string): number | null {
  const text = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

export function FeeRulesPanel({
  companyId,
  banks,
  accounts,
  selectedBankId,
  canManage,
  refreshKey,
  onChanged,
}: {
  companyId: string;
  banks: BankAccount[];
  accounts: SetupAccount[];
  selectedBankId: string;
  canManage: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<BankFeeRule[]>([]);
  const [bankAccountId, setBankAccountId] = useState(selectedBankId);
  const [ratePercent, setRatePercent] = useState('');
  const [fixedPoisha, setFixedPoisha] = useState('0.00');
  const [feeAccountId, setFeeAccountId] = useState('');
  const [policyReference, setPolicyReference] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.isActive && account.accountType === 'EXPENSE'),
    [accounts],
  );
  const activeBanks = useMemo(() => banks.filter((bank) => bank.status === 'ACTIVE'), [banks]);

  useEffect(() => {
    setBankAccountId(selectedBankId);
  }, [selectedBankId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const response = await bankingApi.feeRules(companyId, { includeInactive: true });
      setRules(response.rules);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const create = async (): Promise<void> => {
    const rateBps = ratePercent.trim() ? percentToBps(ratePercent) : 0;
    if (rateBps === null) {
      setError('Enter the percentage rate with up to 2 decimals, for example 1.50.');
      return;
    }
    if (!bankAccountId || !feeAccountId) {
      setError('Choose the bank/MFS account and the fee expense account.');
      return;
    }
    if (policyReference.trim().length < 3) {
      setError('Enter the provider contract, tariff or approval reference for this fee rule.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await bankingApi.createFeeRule(companyId, {
        bankAccountId,
        rateBps,
        fixedPoisha: fixedPoisha || '0.00',
        feeAccountId,
        policyReference: policyReference.trim(),
        effectiveFrom,
        effectiveTo: effectiveTo || null,
      });
      setNotice(`Fee rule created for ${response.rule.bankAccountName}. The rate is configuration, not a universal default.`);
      setRatePercent('');
      setFixedPoisha('0.00');
      setPolicyReference('');
      setEffectiveFrom(todayIso());
      setEffectiveTo('');
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (rule: BankFeeRule): Promise<void> => {
    const next = rule.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (
      !window.confirm(
        next === 'INACTIVE'
          ? `Deactivate the ${rule.rateBps / 100}% fee rule for ${rule.bankAccountName}? Existing fee postings keep their recorded basis.`
          : `Reactivate the ${rule.rateBps / 100}% fee rule for ${rule.bankAccountName}? Overlapping active rules are rejected.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bankingApi.setFeeRuleStatus(companyId, rule.id, next);
      await load();
      onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return <Notice message="Only a controller or administrator can configure fee rules. You can still view the effective configuration." tone="warning" />;
  }

  return (
    <div className="space-y-4">
      <section className="ql-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ql-kicker">Configurable policy</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink-900">Bank and MFS fee rules</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              No 1.5% default is seeded or assumed. Each rule names its account, rate, fixed fee, expense account, effective period
              and evidence reference. A manual fee override must also carry a reason and evidence.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy} className="ql-btn ql-btn-secondary min-h-11 text-[13px]">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </button>
        </div>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
        {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Bank / MFS account" required>
            <select className={INPUT_CLASS} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
              <option value="">Choose account</option>
              {activeBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>{bank.name} · {bank.kind}</option>
              ))}
            </select>
          </Field>
          <Field label="Rate (%)" hint="Use 0 if the fee is fixed only.">
            <input className={INPUT_CLASS} value={ratePercent} onChange={(event) => setRatePercent(event.target.value)} inputMode="decimal" placeholder="1.50" />
          </Field>
          <Field label="Fixed fee (BDT)">
            <input className={INPUT_CLASS} value={fixedPoisha} onChange={(event) => setFixedPoisha(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Fee expense account" required>
            <select className={INPUT_CLASS} value={feeAccountId} onChange={(event) => setFeeAccountId(event.target.value)}>
              <option value="">Choose expense account</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label="Policy / contract reference" required>
            <input className={INPUT_CLASS} value={policyReference} onChange={(event) => setPolicyReference(event.target.value)} maxLength={500} />
          </Field>
          <Field label="Effective from" required>
            <input className={INPUT_CLASS} type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </Field>
          <Field label="Effective to">
            <input className={INPUT_CLASS} type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
          </Field>
          <div className="self-end">
            <button type="button" onClick={() => void create()} disabled={busy} className="ql-btn ql-btn-primary min-h-11 w-full text-[13px]">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create fee rule
            </button>
          </div>
        </div>
        {expenseAccounts.length === 0 ? (
          <div className="mt-3"><Notice message="The chart of accounts has no active EXPENSE account. Create a bank/MFS fee expense account before configuring a rule." tone="warning" /></div>
        ) : null}
      </section>

      <section className="ql-card overflow-hidden">
        <div className="ql-card-header">
          <div>
            <p className="ql-kicker flex items-center gap-1.5"><Landmark size={13} /> Fee rule register</p>
            <h2 className="mt-1 text-[18px] font-semibold text-ink-900">No universal rate</h2>
          </div>
          <span className="ql-badge ql-badge-neutral">{rules.length} rule(s)</span>
        </div>
        {rules.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ink-500">No fee rule is configured. Fee posting will be rejected until a rule exists or an evidence-backed override is entered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[12px]">
              <caption className="sr-only">Configured bank and MFS fee rules</caption>
              <thead className="bg-surface-2/60 text-ink-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Rate</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Fixed</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Fee account</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Effective</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Policy evidence</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rules.map((rule) => (
                  <tr key={rule.id} className={rule.status === 'ACTIVE' ? '' : 'bg-surface-2/30 text-ink-500'}>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-ink-900">{rule.bankAccountName}</span>
                      <span className="mt-0.5 block text-ink-500">{rule.provider ?? '—'}</span>
                    </td>
                    <td className="font-money px-3 py-2.5 text-right">{(rule.rateBps / 100).toFixed(2)}%</td>
                    <td className="font-money px-3 py-2.5 text-right">{rule.fixedBdt}</td>
                    <td className="px-3 py-2.5">{rule.feeAccountCode} — {rule.feeAccountName}</td>
                    <td className="px-3 py-2.5">{formatDate(rule.effectiveFrom)}{rule.effectiveTo ? ` → ${formatDate(rule.effectiveTo)}` : ' → open'}</td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      <span className="line-clamp-2">{rule.policyReference}</span>
                    </td>
                    <td className="px-3 py-2.5">{statusChip(rule.status)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => void setStatus(rule)} disabled={busy} className="ql-btn ql-btn-secondary min-h-9 text-[12px]">
                        {rule.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                      </button>
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
