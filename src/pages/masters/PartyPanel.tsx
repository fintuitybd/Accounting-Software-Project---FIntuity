import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Search, UserMinus, UserPlus } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../auth/api';
import {
  masterApi,
  type Party,
  type PartyOpeningDocumentType,
  type PartyOpeningItem,
  type PartyType,
  type PartyWriteInput,
} from '../../masters/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';

const PARTY_TYPE_LABELS: Record<PartyType, [string, string]> = {
  CUSTOMER: ['Customer', 'গ্রাহক'],
  SUPPLIER: ['Supplier', 'সরবরাহকারী'],
  BOTH: ['Customer & supplier', 'গ্রাহক ও সরবরাহকারী'],
};

const OPENING_TYPE_LABELS: Record<PartyOpeningDocumentType, [string, string]> = {
  SALES_INVOICE: ['Sales invoice', 'বিক্রয় চালান'],
  CREDIT_NOTE: ['Credit note', 'ক্রেডিট নোট'],
  PURCHASE_BILL: ['Purchase bill', 'ক্রয় বিল'],
  EXPENSE_VOUCHER: ['Expense voucher', 'ব্যয় ভাউচার'],
};

interface PartyFormState {
  code: string;
  nameEn: string;
  nameBn: string;
  type: PartyType;
  bin: string;
  tin: string;
  addressEn: string;
  addressBn: string;
  phone: string;
  email: string;
  creditDays: string;
  creditLimit: string;
  isWithholdingBuyer: boolean;
  isGovernment: boolean;
}

function emptyPartyForm(): PartyFormState {
  return {
    code: '',
    nameEn: '',
    nameBn: '',
    type: 'CUSTOMER',
    bin: '',
    tin: '',
    addressEn: '',
    addressBn: '',
    phone: '',
    email: '',
    creditDays: '0',
    creditLimit: '0',
    isWithholdingBuyer: false,
    isGovernment: false,
  };
}

function formFromParty(party: Party): PartyFormState {
  return {
    code: party.code,
    nameEn: party.nameEn,
    nameBn: party.nameBn ?? '',
    type: party.type,
    bin: party.bin ?? '',
    tin: party.tin ?? '',
    addressEn: party.addressEn ?? '',
    addressBn: party.addressBn ?? '',
    phone: party.phone ?? '',
    email: party.email ?? '',
    creditDays: String(party.creditDays),
    creditLimit: party.creditLimitBdt,
    isWithholdingBuyer: party.isWithholdingBuyer,
    isGovernment: party.isGovernment,
  };
}

export function PartyPanel({ initialSearch = '' }: { initialSearch?: string }) {
  const { locale } = usePreferences();
  const auth = useAuth();
  const companyId = auth.activeCompany?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canManage = auth.hasCompanyPermission('MANAGE_MASTERS_AND_COA');

  const [search, setSearch] = useState(initialSearch);
  const [type, setType] = useState<PartyType | 'ALL'>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [parties, setParties] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PartyFormState>(emptyPartyForm);
  const [saving, setSaving] = useState(false);

  const [openingParty, setOpeningParty] = useState<Party | null>(null);
  const [openingItems, setOpeningItems] = useState<PartyOpeningItem[]>([]);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [openingForm, setOpeningForm] = useState({
    documentType: 'SALES_INVOICE' as PartyOpeningDocumentType,
    documentNo: '',
    dueDate: '',
    amount: '',
    base: '',
    memo: '',
  });

  const pageSize = 25;

  useEffect(() => {
    setSearch(initialSearch);
    setPage(1);
  }, [initialSearch]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await masterApi.parties(companyId, {
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(type === 'ALL' ? {} : { type }),
        includeInactive,
        page,
        pageSize,
      });
      setParties(result.parties);
      setTotal(result.total);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId, search, type, includeInactive, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openOpeningItems = async (party: Party) => {
    setOpeningParty(party);
    setOpeningItems([]);
    setOpeningLoading(true);
    try {
      const result = await masterApi.openingItems(companyId, party.id, true);
      setOpeningItems(result.items);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setOpeningLoading(false);
    }
  };

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input: PartyWriteInput = {
        code: form.code,
        nameEn: form.nameEn,
        nameBn: form.nameBn || null,
        type: form.type,
        bin: form.bin || null,
        tin: form.tin || null,
        addressEn: form.addressEn || null,
        addressBn: form.addressBn || null,
        phone: form.phone || null,
        email: form.email || null,
        creditDays: Number(form.creditDays || 0),
        creditLimit: form.creditLimit || '0',
        isWithholdingBuyer: form.isWithholdingBuyer,
        isGovernment: form.isGovernment,
      };
      if (editingId) {
        await masterApi.updateParty(companyId, editingId, input);
        setNotice(L('Party updated.', 'পক্ষ হালনাগাদ হয়েছে।'));
      } else {
        await masterApi.createParty(companyId, input);
        setNotice(L('Party created.', 'পক্ষ তৈরি হয়েছে।'));
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyPartyForm());
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.fieldErrors ? apiErrorMessage(caught) : apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (party: Party) => {
    const deactivating = party.status === 'ACTIVE';
    const consequence = deactivating
      ? L(
          `Deactivate ${party.code} — ${party.nameEn}? It stays in history and on existing documents but cannot be used for new entries.`,
          `${party.code} — ${party.nameEn} নিষ্ক্রিয় করবেন? এটি ইতিহাসে থাকবে কিন্তু নতুন এন্ট্রিতে ব্যবহার করা যাবে না।`,
        )
      : L(`Reactivate ${party.code} — ${party.nameEn}?`, `${party.code} — ${party.nameEn} পুনরায় সক্রিয় করবেন?`);
    if (!window.confirm(consequence)) return;
    const reason = window.prompt(L('Reason (3–500 characters)', 'কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    setError(null);
    try {
      if (deactivating) await masterApi.deactivateParty(companyId, party.id, reason.trim());
      else await masterApi.reactivateParty(companyId, party.id, reason.trim());
      setNotice(deactivating ? L('Party deactivated.', 'পক্ষ নিষ্ক্রিয় হয়েছে।') : L('Party reactivated.', 'পক্ষ পুনরায় সক্রিয় হয়েছে।'));
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const createOpeningItem = async () => {
    if (!openingParty) return;
    setError(null);
    try {
      await masterApi.createOpeningItem(companyId, openingParty.id, {
        documentType: openingForm.documentType,
        documentNo: openingForm.documentNo,
        dueDate: openingForm.dueDate,
        amount: openingForm.amount,
        base: openingForm.base || null,
        memo: openingForm.memo || null,
      });
      setOpeningForm({
        documentType: 'SALES_INVOICE',
        documentNo: '',
        dueDate: '',
        amount: '',
        base: '',
        memo: '',
      });
      await openOpeningItems(openingParty);
      setNotice(L('Opening item recorded. It is an AR/AP schedule until the GL opening batch is posted.', 'উদ্বোধনী আইটেম রেকর্ড হয়েছে। জিএল উদ্বোধনী ব্যাচ পোস্ট না হওয়া পর্যন্ত এটি এআর/এপি সিডিউল।'));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const cancelOpeningItem = async (item: PartyOpeningItem) => {
    if (!openingParty) return;
    if (!window.confirm(L('Cancel this opening item? It remains in history and cannot be reused for new allocations.', 'এই উদ্বোধনী আইটেম বাতিল করবেন? এটি ইতিহাসে থাকবে এবং নতুন বরাদ্দে ব্যবহার করা যাবে না।'))) return;
    const reason = window.prompt(L('Cancellation reason (3–500 characters)', 'বাতিলের কারণ (৩–৫০০ অক্ষর)'));
    if (!reason || reason.trim().length < 3) return;
    try {
      await masterApi.cancelOpeningItem(companyId, openingParty.id, item.id, reason.trim());
      await openOpeningItems(openingParty);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold text-ink-900">{L('Parties', 'পক্ষ')}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
            {L(
              'Customers and suppliers are deactivated, never deleted. BIN/TIN are format-checked only; the product does not claim NBR verification.',
              'গ্রাহক ও সরবরাহকারীদের নিষ্ক্রিয় করা হয়, মুছে ফেলা হয় না। বিআইএন/টিআইএন শুধু ফরম্যাট যাচাই; এনবিআর যাচাইয়ের দাবি নয়।',
            )}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyPartyForm());
              setFormOpen((open) => !open);
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white"
          >
            <Plus size={15} />
            {L('New party', 'নতুন পক্ষ')}
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice message={notice} tone="success" /> : null}

      {formOpen ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h3 className="text-[15px] font-semibold text-ink-900">
            {editingId ? L('Edit party', 'পক্ষ সম্পাদনা') : L('New party', 'নতুন পক্ষ')}
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label={L('Code', 'কোড')} required>
              <input className={INPUT_CLASS} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={32} />
            </Field>
            <Field label={L('English name', 'ইংরেজি নাম')} required>
              <input className={INPUT_CLASS} value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} maxLength={200} />
            </Field>
            <Field label={L('Bangla name', 'বাংলা নাম')}>
              <input className={INPUT_CLASS} value={form.nameBn} onChange={(event) => setForm({ ...form, nameBn: event.target.value })} maxLength={200} />
            </Field>
            <Field label={L('Type', 'ধরন')}>
              <select className={INPUT_CLASS} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as PartyType })}>
                {(Object.keys(PARTY_TYPE_LABELS) as PartyType[]).map((key) => (
                  <option key={key} value={key}>{L(...PARTY_TYPE_LABELS[key])}</option>
                ))}
              </select>
            </Field>
            <Field label={L('BIN', 'বিআইএন')} hint={L('13 digits; formatting is removed on save.', '১৩ সংখ্যা; সংরক্ষণে ফরম্যাটিং সরানো হয়।')}>
              <input className={INPUT_CLASS} value={form.bin} onChange={(event) => setForm({ ...form, bin: event.target.value })} maxLength={32} />
            </Field>
            <Field label={L('TIN', 'টিআইএন')} hint={L('12 digits; formatting is removed on save.', '১২ সংখ্যা; সংরক্ষণে ফরম্যাটিং সরানো হয়।')}>
              <input className={INPUT_CLASS} value={form.tin} onChange={(event) => setForm({ ...form, tin: event.target.value })} maxLength={32} />
            </Field>
            <Field label={L('Credit days', 'ক্রেডিট দিন')}>
              <input className={INPUT_CLASS} type="number" min={0} max={3650} value={form.creditDays} onChange={(event) => setForm({ ...form, creditDays: event.target.value })} />
            </Field>
            <Field label={L('Credit limit (BDT)', 'ক্রেডিট সীমা (টাকা)')}>
              <input className={INPUT_CLASS} inputMode="decimal" value={form.creditLimit} onChange={(event) => setForm({ ...form, creditLimit: event.target.value })} />
            </Field>
            <Field label={L('Phone', 'ফোন')}>
              <input className={INPUT_CLASS} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={32} />
            </Field>
            <Field label={L('Email', 'ইমেইল')}>
              <input className={INPUT_CLASS} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={320} />
            </Field>
            <Field label={L('English address', 'ইংরেজি ঠিকানা')}>
              <input className={INPUT_CLASS} value={form.addressEn} onChange={(event) => setForm({ ...form, addressEn: event.target.value })} maxLength={500} />
            </Field>
            <Field label={L('Bangla address', 'বাংলা ঠিকানা')}>
              <input className={INPUT_CLASS} value={form.addressBn} onChange={(event) => setForm({ ...form, addressBn: event.target.value })} maxLength={500} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
              <input type="checkbox" checked={form.isWithholdingBuyer} onChange={(event) => setForm({ ...form, isWithholdingBuyer: event.target.checked })} />
              {L('Withholding buyer', 'উৎসে কর কাটার ক্রেতা')}
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
              <input type="checkbox" checked={form.isGovernment} onChange={(event) => setForm({ ...form, isGovernment: event.target.checked })} />
              {L('Government entity', 'সরকারি প্রতিষ্ঠান')}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="min-h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50">
              {saving ? L('Saving…', 'সংরক্ষণ হচ্ছে…') : L('Save party', 'পক্ষ সংরক্ষণ')}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="min-h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink-700">
              {L('Cancel', 'বাতিল')}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className={`${INPUT_CLASS} pl-9`}
              placeholder={L('Search code, name, BIN or TIN', 'কোড, নাম, বিআইএন বা টিআইএন খুঁজুন')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className={`${INPUT_CLASS} w-auto`}
            value={type}
            onChange={(event) => {
              setType(event.target.value as PartyType | 'ALL');
              setPage(1);
            }}
          >
            <option value="ALL">{L('All types', 'সব ধরন')}</option>
            {(Object.keys(PARTY_TYPE_LABELS) as PartyType[]).map((key) => (
              <option key={key} value={key}>{L(...PARTY_TYPE_LABELS[key])}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(1);
              }}
            />
            {L('Include inactive', 'নিষ্ক্রিয় সহ')}
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {L('Refresh', 'রিফ্রেশ')}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-surface-2/60 text-[12px] uppercase tracking-[0.06em] text-ink-500">
              <tr>
                <th className="px-3 py-2">{L('Code', 'কোড')}</th>
                <th className="px-3 py-2">{L('Name', 'নাম')}</th>
                <th className="px-3 py-2">{L('Type', 'ধরন')}</th>
                <th className="px-3 py-2">{L('BIN / TIN', 'বিআইএন / টিআইএন')}</th>
                <th className="px-3 py-2 text-right">{L('Credit', 'ক্রেডিট')}</th>
                <th className="px-3 py-2">{L('Status', 'অবস্থা')}</th>
                <th className="px-3 py-2 text-right">{L('Actions', 'কার্যক্রম')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 text-[13px] text-ink-800">
              {parties.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[13px] text-ink-400">{loading ? L('Loading…', 'লোড হচ্ছে…') : L('No parties found.', 'কোনো পক্ষ পাওয়া যায়নি।')}</td></tr>
              ) : parties.map((party) => (
                <tr key={party.id} className="align-top">
                  <td className="px-3 py-2 font-mono text-[12px]">{party.code}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{party.nameEn}</p>
                    {party.nameBn ? <p className="text-[12px] text-ink-500">{party.nameBn}</p> : null}
                  </td>
                  <td className="px-3 py-2">{L(...PARTY_TYPE_LABELS[party.type])}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{party.bin || '—'}<br />{party.tin || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">{party.creditDays}d · {party.creditLimitBdt}</td>
                  <td className="px-3 py-2">
                    <span className={party.status === 'ACTIVE' ? 'lv-chip lv-chip-emerald' : 'lv-chip lv-chip-neutral'}>{party.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" onClick={() => void openOpeningItems(party)} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">
                        {L('Opening items', 'উদ্বোধনী আইটেম')}
                      </button>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(party.id);
                            setForm(formFromParty(party));
                            setFormOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700"
                        >
                          <Pencil size={12} /> {L('Edit', 'সম্পাদনা')}
                        </button>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => void changeStatus(party)}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700"
                        >
                          {party.status === 'ACTIVE' ? <UserMinus size={12} /> : <UserPlus size={12} />}
                          {party.status === 'ACTIVE' ? L('Deactivate', 'নিষ্ক্রিয়') : L('Reactivate', 'সক্রিয়')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-ink-500">
          <span>{L(`${total} parties`, `${total} পক্ষ`)}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-line px-2 py-1 font-semibold disabled:opacity-40">{L('Previous', 'পূর্ববর্তী')}</button>
            <span>{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-line px-2 py-1 font-semibold disabled:opacity-40">{L('Next', 'পরবর্তী')}</button>
          </div>
        </div>
      </section>

      {openingParty ? (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[15px] font-semibold text-ink-900">{L('Opening items', 'উদ্বোধনী আইটেম')} · {openingParty.code}</h3>
              <p className="mt-1 text-[12px] text-ink-500">
                {L('These are AR/AP schedules. They do not post to the GL; include them in the approved opening-balance batch.', 'এগুলো এআর/এপি সিডিউল। এগুলো জিএল-এ পোস্ট হয় না; অনুমোদিত উদ্বোধনী ব্যালেন্স ব্যাচে অন্তর্ভুক্ত করুন।')}
              </p>
            </div>
            <button type="button" onClick={() => setOpeningParty(null)} className="min-h-9 rounded-lg border border-line px-3 text-[12px] font-semibold text-ink-700">{L('Close', 'বন্ধ')}</button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-6">
            <select className={INPUT_CLASS} value={openingForm.documentType} onChange={(event) => setOpeningForm({ ...openingForm, documentType: event.target.value as PartyOpeningDocumentType })}>
              {(Object.keys(OPENING_TYPE_LABELS) as PartyOpeningDocumentType[]).map((key) => (
                <option key={key} value={key}>{L(...OPENING_TYPE_LABELS[key])}</option>
              ))}
            </select>
            <input className={INPUT_CLASS} placeholder={L('Document no.', 'নথি নং')} value={openingForm.documentNo} onChange={(event) => setOpeningForm({ ...openingForm, documentNo: event.target.value })} />
            <input className={INPUT_CLASS} type="date" value={openingForm.dueDate} onChange={(event) => setOpeningForm({ ...openingForm, dueDate: event.target.value })} />
            <input className={INPUT_CLASS} inputMode="decimal" placeholder={L('Amount BDT', 'টাকা')} value={openingForm.amount} onChange={(event) => setOpeningForm({ ...openingForm, amount: event.target.value })} />
            <input className={INPUT_CLASS} inputMode="decimal" placeholder={L('Base BDT', 'ভিত্তি টাকা')} value={openingForm.base} onChange={(event) => setOpeningForm({ ...openingForm, base: event.target.value })} />
            <button type="button" onClick={() => void createOpeningItem()} disabled={!canManage || openingLoading} className="min-h-11 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-white disabled:opacity-50">{L('Add', 'যোগ')}</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.06em] text-ink-500">
                <tr>
                  <th className="px-2 py-2">{L('Document', 'নথি')}</th>
                  <th className="px-2 py-2">{L('Due', 'মেয়াদ')}</th>
                  <th className="px-2 py-2 text-right">{L('Amount', 'পরিমাণ')}</th>
                  <th className="px-2 py-2">{L('Status', 'অবস্থা')}</th>
                  <th className="px-2 py-2 text-right">{L('Action', 'কার্যক্রম')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {openingItems.length === 0 ? (
                  <tr><td colSpan={5} className="px-2 py-4 text-center text-[12px] text-ink-400">{openingLoading ? L('Loading…', 'লোড হচ্ছে…') : L('No opening items.', 'কোনো উদ্বোধনী আইটেম নেই।')}</td></tr>
                ) : openingItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-2 py-2"><span className="font-mono text-[12px]">{item.documentNo}</span><br /><span className="text-[12px] text-ink-500">{L(...OPENING_TYPE_LABELS[item.documentType])}</span></td>
                    <td className="px-2 py-2 font-mono text-[12px]">{item.dueDate}</td>
                    <td className="px-2 py-2 text-right font-mono text-[12px]">{item.amountBdt}</td>
                    <td className="px-2 py-2">{item.status}</td>
                    <td className="px-2 py-2 text-right">
                      {item.status === 'OPEN' && canManage ? (
                        <button type="button" onClick={() => void cancelOpeningItem(item)} className="rounded-lg border border-line px-2 py-1 text-[12px] font-semibold text-ink-700">{L('Cancel', 'বাতিল')}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
