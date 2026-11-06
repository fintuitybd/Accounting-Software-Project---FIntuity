import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import {
  masterApi,
  type Branch,
  type BranchWriteInput,
  type Warehouse,
  type WarehouseWriteInput,
} from '../../masters/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';

export function BranchPanel() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canManage = auth.hasCompanyPermission('MANAGE_MASTERS_AND_COA');

  const [branches, setBranches] = useState<Branch[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    nameEn: '',
    nameBn: '',
    address: '',
    bin: '',
    isPrincipal: false,
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await masterApi.branches(companyId, includeInactive);
      setBranches(result.branches);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError(null);
    try {
      const input: BranchWriteInput = {
        code: form.code,
        nameEn: form.nameEn,
        nameBn: form.nameBn || null,
        address: form.address || null,
        bin: form.bin || null,
        isPrincipal: form.isPrincipal,
      };
      if (editingId) await masterApi.updateBranch(companyId, editingId, input);
      else await masterApi.createBranch(companyId, input);
      setNotice(L('Branch saved.', 'শাখা সংরক্ষিত হয়েছে।'));
      setFormOpen(false);
      setEditingId(null);
      setForm({ code: '', nameEn: '', nameBn: '', address: '', bin: '', isPrincipal: false });
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const changeStatus = async (branch: Branch) => {
    const deactivating = branch.status === 'ACTIVE';
    if (
      !window.confirm(
        deactivating
          ? L(`Deactivate branch ${branch.code}? Reassign its warehouses first.`, `শাখা ${branch.code} নিষ্ক্রিয় করবেন? আগে এর গুদামগুলো পুনর্বিন্যাস করুন।`)
          : L(`Reactivate branch ${branch.code}?`, `শাখা ${branch.code} পুনরায় সক্রিয় করবেন?`),
      )
    ) {
      return;
    }
    const reason = window.prompt(L('Reason (3–500 characters)', 'কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    try {
      if (deactivating) await masterApi.deactivateBranch(companyId, branch.id, reason.trim());
      else await masterApi.reactivateBranch(companyId, branch.id, reason.trim());
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold text-ink-900">{L('Branches', 'শাখা')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L('Branches map warehouses to a location. A principal branch is optional but only one can be active.', 'শাখা গুদামকে অবস্থানের সঙ্গে যুক্ত করে। প্রধান শাখা ঐচ্ছিক, তবে একটির বেশি সক্রিয় থাকতে পারে না।')}
          </p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => { setEditingId(null); setForm({ code: '', nameEn: '', nameBn: '', address: '', bin: '', isPrincipal: false }); setFormOpen((open) => !open); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white">
            <Plus size={15} /> {L('New branch', 'নতুন শাখা')}
          </button>
        ) : null}
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}
      {formOpen ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label={L('Code', 'কোড')} required><input className={INPUT_CLASS} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={32} /></Field>
            <Field label={L('English name', 'ইংরেজি নাম')} required><input className={INPUT_CLASS} value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} maxLength={200} /></Field>
            <Field label={L('Bangla name', 'বাংলা নাম')}><input className={INPUT_CLASS} value={form.nameBn} onChange={(event) => setForm({ ...form, nameBn: event.target.value })} maxLength={200} /></Field>
            <Field label={L('BIN', 'বিআইএন')} hint={L('Format check only.', 'শুধু ফরম্যাট যাচাই।')}><input className={INPUT_CLASS} value={form.bin} onChange={(event) => setForm({ ...form, bin: event.target.value })} maxLength={32} /></Field>
            <Field label={L('Address', 'ঠিকানা')}><input className={INPUT_CLASS} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={500} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13px] font-medium text-ink-700">
              <input type="checkbox" checked={form.isPrincipal} onChange={(event) => setForm({ ...form, isPrincipal: event.target.checked })} />
              {L('Principal branch', 'প্রধান শাখা')}
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void save()} className="min-h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white">{L('Save branch', 'শাখা সংরক্ষণ')}</button>
            <button type="button" onClick={() => setFormOpen(false)} className="min-h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink-700">{L('Cancel', 'বাতিল')}</button>
          </div>
        </section>
      ) : null}
      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
            {L('Include inactive', 'নিষ্ক্রিয় সহ')}
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{L('Refresh', 'রিফ্রেশ')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr><th className="px-3 py-2">{L('Code', 'কোড')}</th><th className="px-3 py-2">{L('Name', 'নাম')}</th><th className="px-3 py-2">{L('BIN', 'বিআইএন')}</th><th className="px-3 py-2">{L('Principal', 'প্রধান')}</th><th className="px-3 py-2">{L('Status', 'অবস্থা')}</th><th className="px-3 py-2 text-right">{L('Actions', 'কার্যক্রম')}</th></tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {branches.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No branches found.', 'কোনো শাখা পাওয়া যায়নি।')}</td></tr> : branches.map((branch) => (
                <tr key={branch.id}>
                  <td className="px-3 py-2 font-mono text-[12px]">{branch.code}</td>
                  <td className="px-3 py-2"><p className="font-semibold">{branch.nameEn}</p>{branch.nameBn ? <p className="text-[12px] text-ink-500">{branch.nameBn}</p> : null}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{branch.bin || '—'}</td>
                  <td className="px-3 py-2">{branch.isPrincipal ? L('Yes', 'হ্যাঁ') : '—'}</td>
                  <td className="px-3 py-2"><span className={branch.status === 'ACTIVE' ? 'lv-chip lv-chip-emerald' : 'lv-chip lv-chip-neutral'}>{branch.status}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {canManage ? <button type="button" onClick={() => { setEditingId(branch.id); setForm({ code: branch.code, nameEn: branch.nameEn, nameBn: branch.nameBn ?? '', address: branch.address ?? '', bin: branch.bin ?? '', isPrincipal: branch.isPrincipal }); setFormOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700"><Pencil size={12} />{L('Edit', 'সম্পাদনা')}</button> : null}
                      {canManage ? <button type="button" onClick={() => void changeStatus(branch)} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">{branch.status === 'ACTIVE' ? L('Deactivate', 'নিষ্ক্রিয়') : L('Reactivate', 'সক্রিয়')}</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function WarehousePanel() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canManage = auth.hasCompanyPermission('MANAGE_MASTERS_AND_COA');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ branchId: '', code: '', nameEn: '', nameBn: '', address: '' });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [warehouseResult, branchResult] = await Promise.all([
        masterApi.warehouses(companyId, { includeInactive }),
        masterApi.branches(companyId, false),
      ]);
      setWarehouses(warehouseResult.warehouses);
      setBranches(branchResult.branches);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setError(null);
    try {
      const input: WarehouseWriteInput = {
        branchId: form.branchId || null,
        code: form.code,
        nameEn: form.nameEn,
        nameBn: form.nameBn || null,
        address: form.address || null,
      };
      if (editingId) await masterApi.updateWarehouse(companyId, editingId, input);
      else await masterApi.createWarehouse(companyId, input);
      setNotice(L('Warehouse saved.', 'গুদাম সংরক্ষিত হয়েছে।'));
      setFormOpen(false);
      setEditingId(null);
      setForm({ branchId: '', code: '', nameEn: '', nameBn: '', address: '' });
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const changeStatus = async (warehouse: Warehouse) => {
    const deactivating = warehouse.status === 'ACTIVE';
    if (
      !window.confirm(
        deactivating
          ? L(`Deactivate ${warehouse.code}? Warehouses holding stock must be emptied first.`, `${warehouse.code} নিষ্ক্রিয় করবেন? স্টক থাকা গুদাম আগে খালি করতে হবে।`)
          : L(`Reactivate ${warehouse.code}?`, `${warehouse.code} পুনরায় সক্রিয় করবেন?`),
      )
    ) {
      return;
    }
    const reason = window.prompt(L('Reason (3–500 characters)', 'কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    try {
      if (deactivating) await masterApi.deactivateWarehouse(companyId, warehouse.id, reason.trim());
      else await masterApi.reactivateWarehouse(companyId, warehouse.id, reason.trim());
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold text-ink-900">{L('Warehouses', 'গুদাম')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L('Stock is held by warehouse. Every movement names its warehouse; transfers move value at the source weighted-average cost.', 'স্টক গুদামভিত্তিক। প্রতিটি মুভমেন্টে গুদাম উল্লেখ থাকে; স্থানান্তরে উৎসের ভারিত গড় ব্যয়ে মূল্য যায়।')}
          </p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => { setEditingId(null); setForm({ branchId: '', code: '', nameEn: '', nameBn: '', address: '' }); setFormOpen((open) => !open); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white"><Plus size={15} />{L('New warehouse', 'নতুন গুদাম')}</button>
        ) : null}
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}
      {formOpen ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label={L('Branch', 'শাখা')}>
              <select className={INPUT_CLASS} value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
                <option value="">{L('Unmapped (optional)', 'শাখা ছাড়া (ঐচ্ছিক)')}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.nameEn}</option>)}
              </select>
            </Field>
            <Field label={L('Code', 'কোড')} required><input className={INPUT_CLASS} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={32} /></Field>
            <Field label={L('English name', 'ইংরেজি নাম')} required><input className={INPUT_CLASS} value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} maxLength={200} /></Field>
            <Field label={L('Bangla name', 'বাংলা নাম')}><input className={INPUT_CLASS} value={form.nameBn} onChange={(event) => setForm({ ...form, nameBn: event.target.value })} maxLength={200} /></Field>
            <Field label={L('Address', 'ঠিকানা')}><input className={INPUT_CLASS} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={500} /></Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void save()} className="min-h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white">{L('Save warehouse', 'গুদাম সংরক্ষণ')}</button>
            <button type="button" onClick={() => setFormOpen(false)} className="min-h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink-700">{L('Cancel', 'বাতিল')}</button>
          </div>
        </section>
      ) : null}
      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />{L('Include inactive', 'নিষ্ক্রিয় সহ')}</label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{L('Refresh', 'রিফ্রেশ')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr><th className="px-3 py-2">{L('Code', 'কোড')}</th><th className="px-3 py-2">{L('Name', 'নাম')}</th><th className="px-3 py-2">{L('Branch', 'শাখা')}</th><th className="px-3 py-2">{L('Status', 'অবস্থা')}</th><th className="px-3 py-2 text-right">{L('Actions', 'কার্যক্রম')}</th></tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {warehouses.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No warehouses found.', 'কোনো গুদাম পাওয়া যায়নি।')}</td></tr> : warehouses.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td className="px-3 py-2 font-mono text-[12px]">{warehouse.code}</td>
                  <td className="px-3 py-2"><p className="font-semibold">{warehouse.nameEn}</p>{warehouse.nameBn ? <p className="text-[12px] text-ink-500">{warehouse.nameBn}</p> : null}</td>
                  <td className="px-3 py-2">{warehouse.branchCode ? `${warehouse.branchCode} · ${warehouse.branchName}` : '—'}</td>
                  <td className="px-3 py-2"><span className={warehouse.status === 'ACTIVE' ? 'lv-chip lv-chip-emerald' : 'lv-chip lv-chip-neutral'}>{warehouse.status}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {canManage ? <button type="button" onClick={() => { setEditingId(warehouse.id); setForm({ branchId: warehouse.branchId ?? '', code: warehouse.code, nameEn: warehouse.nameEn, nameBn: warehouse.nameBn ?? '', address: warehouse.address ?? '' }); setFormOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700"><Pencil size={12} />{L('Edit', 'সম্পাদনা')}</button> : null}
                      {canManage ? <button type="button" onClick={() => void changeStatus(warehouse)} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">{warehouse.status === 'ACTIVE' ? L('Deactivate', 'নিষ্ক্রিয়') : L('Reactivate', 'সক্রিয়')}</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
