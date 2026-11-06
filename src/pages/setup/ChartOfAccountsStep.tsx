import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, Loader2, Lock, Pencil, Plus, RotateCcw, Upload, X } from 'lucide-react';
import { parseBufferToObjects } from '../../core/import-export/xlsxEngine';
import {
  ACCOUNT_TYPE_OPTIONS,
  CONTROL_SUBLEDGER_OPTIONS,
  IFRS_CATEGORY_OPTIONS,
  SUB_CATEGORY_BY_TYPE,
  setupApi,
  type SetupAccount,
  type SetupAccountInput,
} from '../../setup/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from './setupUi';

const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ROWS = 5_000;

interface AccountFormState {
  id?: string;
  code: string;
  nameEn: string;
  nameBn: string;
  accountType: string;
  subCategory: string;
  ifrsCategory: string;
  controlSubledger: string;
  parentId: string;
  taxMapping: string;
  isActive: boolean;
  isControl: boolean;
}

function blankForm(): AccountFormState {
  return {
    code: '',
    nameEn: '',
    nameBn: '',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    ifrsCategory: 'NA_BALANCE_SHEET',
    controlSubledger: 'NONE',
    parentId: '',
    taxMapping: '',
    isActive: true,
    isControl: false,
  };
}

function formFromAccount(account: SetupAccount): AccountFormState {
  return {
    id: account.id,
    code: account.code,
    nameEn: account.nameEn,
    nameBn: account.nameBn ?? '',
    accountType: account.accountType,
    subCategory: account.subCategory,
    ifrsCategory: account.ifrsCategory,
    controlSubledger: account.controlSubledger,
    parentId: account.parentId ?? '',
    taxMapping: Object.entries(account.taxMapping)
      .map(([key, value]) => `${key}=${value}`)
      .join('|'),
    isActive: account.isActive,
    isControl: account.isControl,
  };
}

function toInput(form: AccountFormState): SetupAccountInput {
  const taxMapping: Record<string, string> = {};
  for (const part of form.taxMapping.split('|')) {
    const text = part.trim();
    if (!text) continue;
    const separator = text.indexOf('=');
    if (separator <= 0) throw new Error('Tax mapping must use key=value pairs separated by |.');
    taxMapping[text.slice(0, separator).trim()] = text.slice(separator + 1).trim();
  }
  return {
    code: form.code,
    nameEn: form.nameEn,
    nameBn: form.nameBn || null,
    accountType: form.accountType,
    subCategory: form.subCategory,
    ifrsCategory: form.ifrsCategory,
    parentId: form.parentId || null,
    controlSubledger: form.controlSubledger,
    taxMapping,
    isActive: form.isActive,
  };
}

export default function ChartOfAccountsStep({
  companyId,
  accounts,
  canManage,
  onChanged,
  initialSearch = '',
}: {
  companyId: string;
  accounts: SetupAccount[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  initialSearch?: string;
}) {
  const [form, setForm] = useState<AccountFormState | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter(
      (account) =>
        account.code.toLowerCase().includes(term) ||
        account.nameEn.toLowerCase().includes(term) ||
        (account.nameBn ?? '').toLowerCase().includes(term),
    );
  }, [accounts, search]);

  const parentOptions = accounts.filter((account) => account.id !== form?.id);

  const set = <K extends keyof AccountFormState>(key: K, value: AccountFormState[K]): void => {
    setForm((current) => {
      if (!current) return current;
      if (key === 'accountType') {
        const nextType = value as string;
        const nextSubCategory = SUB_CATEGORY_BY_TYPE[nextType]?.[0] ?? current.subCategory;
        return { ...current, accountType: nextType, subCategory: nextSubCategory };
      }
      return { ...current, [key]: value };
    });
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!form || !canManage) return;
    setSaving(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      const input = toInput(form);
      if (form.id) {
        await setupApi.updateAccount(companyId, form.id, input);
        setNotice(`Account ${input.code} updated. The change is audited.`);
      } else {
        await setupApi.createAccount(companyId, input);
        setNotice(`Account ${input.code} created.`);
      }
      setForm(null);
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (account: SetupAccount, isActive: boolean): Promise<void> => {
    if (!canManage) return;
    if (account.isControl && !isActive) return;
    const consequence = isActive
      ? `Reactivate account ${account.code} — ${account.nameEn}? It will become selectable for new entries.`
      : `Deactivate account ${account.code} — ${account.nameEn}? Existing references remain, but it cannot be selected for new entries.`;
    if (!window.confirm(consequence)) return;
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      await setupApi.updateAccount(companyId, account.id, {
        ...toInput(formFromAccount(account)),
        isActive,
      });
      setNotice(isActive ? `Account ${account.code} reactivated.` : `Account ${account.code} deactivated.`);
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setBusyId(null);
    }
  };

  const downloadTemplate = async (): Promise<void> => {
    setError(null);
    try {
      const template = await setupApi.importTemplate(companyId);
      const blob = new Blob([template.content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = template.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManage) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError(`The import file is larger than ${Math.round(MAX_IMPORT_BYTES / 1000)} KB. Nothing was imported.`);
      return;
    }
    setImporting(true);
    setError(null);
    setDetails(undefined);
    setNotice(null);
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        const content = await file.text();
        const result = await setupApi.importAccounts(companyId, { format: 'CSV', content });
        setNotice(`${result.imported} account${result.imported === 1 ? '' : 's'} imported from ${file.name}.`);
      } else if (/\.xlsx?$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        const rows = await parseBufferToObjects(buffer);
        if (rows.length === 0) throw new Error('The workbook has no worksheet or is empty.');
        if (rows.length > MAX_IMPORT_ROWS) {
          throw new Error(`The worksheet has more than ${MAX_IMPORT_ROWS} rows. Split it before importing.`);
        }
        const result = await setupApi.importAccounts(companyId, { format: 'XLSX', rows });
        setNotice(`${result.imported} account${result.imported === 1 ? '' : 's'} imported from ${file.name}.`);
      } else {
        throw new Error('Choose a .csv, .xlsx or .xls file.');
      }
      await onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setDetails((caught as { details?: unknown }).details);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-ink-900">Chart of accounts</h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Account codes are unique per company. Accounts with a control subledger are protected from recoding,
            repurposing and deactivation because reports and subledgers depend on them.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void downloadTemplate()} className="lv-btn lv-btn-secondary min-h-10 text-[13px]">
              <Download size={15} /> CSV template
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="lv-btn lv-btn-secondary min-h-10 text-[13px]">
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Import CSV/XLSX
            </button>
            <button type="button" onClick={() => setForm(blankForm())} className="lv-btn lv-btn-primary min-h-10 text-[13px]">
              <Plus size={15} /> Add account
            </button>
          </div>
        ) : null}
      </div>

      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void importFile(event)} className="hidden" aria-label="Import chart of accounts" />

      {error ? <ErrorBanner message={error} details={details} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {form ? (
        <form onSubmit={save} className="rounded-2xl border border-brand/30 bg-vault-50/40 p-4 dark:bg-vault-500/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-ink-900">
              {form.id ? `Edit ${form.code}` : 'Add account'}
              {form.isControl ? <span className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700"><Lock size={12} /> Protected control account</span> : null}
            </h3>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg p-1 text-ink-400 hover:text-ink-800" aria-label="Close account form">
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Code" required hint="Letters, digits, dot, underscore or hyphen.">
              <input className={INPUT_CLASS} value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} required maxLength={32} disabled={saving || form.isControl} />
            </Field>
            <Field label="English name" required>
              <input className={INPUT_CLASS} value={form.nameEn} onChange={(event) => set('nameEn', event.target.value)} required maxLength={200} disabled={saving} />
            </Field>
            <Field label="Bangla name">
              <input className={INPUT_CLASS} value={form.nameBn} onChange={(event) => set('nameBn', event.target.value)} maxLength={200} disabled={saving} />
            </Field>
            <Field label="Account type" required>
              <select className={INPUT_CLASS} value={form.accountType} onChange={(event) => set('accountType', event.target.value)} disabled={saving || form.isControl}>
                {ACCOUNT_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Subcategory" required>
              <select className={INPUT_CLASS} value={form.subCategory} onChange={(event) => set('subCategory', event.target.value)} disabled={saving || form.isControl}>
                {(SUB_CATEGORY_BY_TYPE[form.accountType] ?? []).map((subCategory) => <option key={subCategory} value={subCategory}>{subCategory}</option>)}
              </select>
            </Field>
            <Field label="IFRS category" required>
              <select className={INPUT_CLASS} value={form.ifrsCategory} onChange={(event) => set('ifrsCategory', event.target.value)} disabled={saving}>
                {IFRS_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </Field>
            <Field label="Control subledger" hint="Control accounts are locked after creation.">
              <select className={INPUT_CLASS} value={form.controlSubledger} onChange={(event) => set('controlSubledger', event.target.value)} disabled={saving || form.isControl}>
                {CONTROL_SUBLEDGER_OPTIONS.map((control) => <option key={control} value={control}>{control}</option>)}
              </select>
            </Field>
            <Field label="Parent account">
              <select className={INPUT_CLASS} value={form.parentId} onChange={(event) => set('parentId', event.target.value)} disabled={saving}>
                <option value="">No parent (top level)</option>
                {parentOptions.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.nameEn}{account.isActive ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </Field>
            <Field label="Tax mapping" hint="Configuration only, e.g. vat=STANDARD_15|tds=NONE. Not a statutory validation.">
              <input className={INPUT_CLASS} value={form.taxMapping} onChange={(event) => set('taxMapping', event.target.value)} placeholder="vat=STANDARD_15|tds=NONE" disabled={saving} />
            </Field>
          </div>
          {!form.id ? (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} disabled={saving} />
              Active account
            </label>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="lv-btn lv-btn-primary min-h-11 text-[14px]">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {form.id ? 'Save account' : 'Create account'}
            </button>
            <button type="button" onClick={() => setForm(null)} disabled={saving} className="lv-btn lv-btn-secondary min-h-11 text-[14px]">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Search accounts</span>
          <input className={INPUT_CLASS} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code or account name" />
        </label>
        <span className="lv-chip lv-chip-neutral text-[12px]">{filtered.length} shown</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[860px] text-left text-[12px]">
          <thead className="bg-surface-2/40 text-ink-400">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">Code</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Type / subcategory</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Control</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[13px] text-ink-500">
                  No accounts match. Add an account or import the CSV template.
                </td>
              </tr>
            ) : (
              filtered.map((account) => (
                <tr key={account.id} className={account.isActive ? '' : 'bg-surface-2/20 text-ink-400'}>
                  <td className="px-3 py-2.5 font-mono text-ink-700">{account.code}</td>
                  <td className="px-3 py-2.5">
                    <span className="block font-semibold text-ink-900">{account.nameEn}</span>
                    {account.nameBn ? <span className="block text-ink-500">{account.nameBn}</span> : null}
                    {account.parentCode ? <span className="block text-[12px] text-ink-400">Parent {account.parentCode}</span> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block">{account.accountType}</span>
                    <span className="block text-ink-400">{account.subCategory}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {account.isControl ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[12px] font-semibold text-amber-800 dark:text-amber-200">
                        <Lock size={11} /> {account.controlSubledger}
                      </span>
                    ) : (
                      <span className="text-ink-400">None</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`lv-chip text-[12px] ${account.isActive ? 'lv-chip-emerald' : 'lv-chip-neutral'}`}>
                      {account.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {canManage ? (
                        <>
                          <button type="button" onClick={() => setForm(formFromAccount(account))} className="rounded-lg border border-line p-1.5 text-ink-600 hover:border-line-strong hover:text-ink-900" aria-label={`Edit ${account.code}`} title="Edit">
                            <Pencil size={14} />
                          </button>
                          {!account.isControl ? (
                            <button
                              type="button"
                              onClick={() => void setActive(account, !account.isActive)}
                              disabled={busyId === account.id}
                              className="rounded-lg border border-line p-1.5 text-ink-600 hover:border-line-strong hover:text-ink-900 disabled:opacity-50"
                              aria-label={account.isActive ? `Deactivate ${account.code}` : `Reactivate ${account.code}`}
                              title={account.isActive ? 'Deactivate' : 'Reactivate'}
                            >
                              {busyId === account.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-ink-400">Read-only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
