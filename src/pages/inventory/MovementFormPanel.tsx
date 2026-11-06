import { useCallback, useMemo, useState } from 'react';
import { CircleCheck, PackagePlus } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import { dateToday, newIdempotencyKey, PoishaText } from '../ledger/ledgerUi';
import { inventoryApi, type StockCommandResult, type StockCommandType } from '../../inventory/api';
import { movementTypeLabel } from './inventoryUi';
import type { InventoryRefs } from './inventoryUi';

const COMMAND_LABELS: Record<StockCommandType, [string, string]> = {
  OPENING: ['Opening stock', 'উদ্বোধনী স্টক'],
  GRN: ['GRN receipt', 'জিআরএন গ্রহণ'],
  ISSUE: ['Issue / COGS', 'ইস্যু / সিওজিএস'],
  RETURN: ['Sales return', 'বিক্রয় ফেরত'],
  TRANSFER: ['Warehouse transfer', 'গুদাম স্থানান্তর'],
  ADJUSTMENT_IN: ['Adjustment increase', 'সমন্বয় বৃদ্ধি'],
  ADJUSTMENT_OUT: ['Adjustment decrease', 'সমন্বয় হ্রাস'],
};

const COMMAND_HINTS: Record<StockCommandType, [string, string]> = {
  OPENING: [
    'Records opening stock and posts Dr inventory / Cr the selected opening account.',
    'উদ্বোধনী স্টক রেকর্ড করে ডেবিট ইনভেন্টরি / ক্রেডিট নির্বাচিত উদ্বোধনী হিসাব পোস্ট করে।',
  ],
  GRN: [
    'Receives goods and posts Dr inventory / Cr the selected GRN clearing or payable account.',
    'পণ্য গ্রহণ করে ডেবিট ইনভেন্টরি / ক্রেডিট নির্বাচিত জিআরএন ক্লিয়ারিং বা পরিশোধযোগ্য হিসাব পোস্ট করে।',
  ],
  ISSUE: [
    'Issues stock and posts Dr the item expense/COGS account / Cr inventory at weighted-average cost.',
    'স্টক ইস্যু করে ভারিত গড় ব্যয়ে ডেবিট আইটেম ব্যয়/সিওজিএস / ক্রেডিট ইনভেন্টরি পোস্ট করে।',
  ],
  RETURN: [
    'Restores returned stock and posts Dr inventory / Cr the item expense/COGS account.',
    'ফেরত স্টক ফিরিয়ে আনে এবং ডেবিট ইনভেন্টরি / ক্রেডিট আইটেম ব্যয়/সিওজিএস পোস্ট করে।',
  ],
  TRANSFER: [
    'Moves quantity and value between warehouses at the source weighted-average cost. No GL journal is needed.',
    'উৎসের ভারিত গড় ব্যয়ে গুদামের মধ্যে পরিমাণ ও মূল্য স্থানান্তর করে। জিএল জার্নাল লাগে না।',
  ],
  ADJUSTMENT_IN: [
    'Increases counted stock and posts Dr inventory / Cr the selected adjustment account.',
    'গণনাকৃত স্টক বাড়ায় এবং ডেবিট ইনভেন্টরি / ক্রেডিট নির্বাচিত সমন্বয় হিসাব পোস্ট করে।',
  ],
  ADJUSTMENT_OUT: [
    'Reduces counted stock and posts Dr the selected adjustment account / Cr inventory.',
    'গণনাকৃত স্টক কমায় এবং ডেবিট নির্বাচিত সমন্বয় হিসাব / ক্রেডিট ইনভেন্টরি পোস্ট করে।',
  ],
};

interface MovementFormState {
  type: StockCommandType;
  itemId: string;
  warehouseId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  quantity: string;
  unitCost: string;
  offsetAccountId: string;
  sourceRef: string;
  reason: string;
  allowNegativeStock: boolean;
  overrideReason: string;
}

export function MovementFormPanel({
  companyId,
  refs,
  canDispatch,
  canOverride,
  onRecorded,
}: {
  companyId: string;
  refs: InventoryRefs;
  canDispatch: boolean;
  canOverride: boolean;
  onRecorded: () => void;
}) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [form, setForm] = useState<MovementFormState>({
    type: 'GRN',
    itemId: '',
    warehouseId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    date: dateToday(),
    quantity: '',
    unitCost: '',
    offsetAccountId: '',
    sourceRef: '',
    reason: '',
    allowNegativeStock: false,
    overrideReason: '',
  });
  const [key, setKey] = useState(newIdempotencyKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockCommandResult | null>(null);

  const stockItems = useMemo(() => refs.items.filter((item) => item.isStockItem && item.status === 'ACTIVE'), [refs.items]);
  const activeWarehouses = useMemo(() => refs.warehouses.filter((warehouse) => warehouse.status === 'ACTIVE'), [refs.warehouses]);
  const activeAccounts = useMemo(() => refs.accounts.filter((account) => account.isActive), [refs.accounts]);
  const isTransfer = form.type === 'TRANSFER';
  const isReceipt = form.type === 'OPENING' || form.type === 'GRN';
  const isAdjustment = form.type === 'ADJUSTMENT_IN' || form.type === 'ADJUSTMENT_OUT';
  const needsOffset = form.type === 'OPENING' || form.type === 'GRN' || isAdjustment;
  const needsUnitCost = isReceipt;
  const needsReason = isAdjustment;

  const submit = async () => {
    if (!canDispatch) {
      setError(L('DISPATCH_OR_RECEIVE_STOCK is required to record a stock movement.', 'স্টক মুভমেন্ট রেকর্ডে DISPATCH_OR_RECEIVE_STOCK প্রয়োজন।'));
      return;
    }
    if (
      form.allowNegativeStock &&
      !window.confirm(
        L(
          'Allow this specific command to take stock below zero? The exception and its reason will be stored on the movement and audited. The business default is to block negative stock.',
          'এই নির্দিষ্ট কমান্ডে স্টক শূন্যের নিচে নামতে দেবেন? ব্যতিক্রম ও কারণ মুভমেন্টে সংরক্ষিত ও অডিট হবে। ব্যবসার ডিফল্ট নিয়ম নেতিবাচক স্টক ব্লক করা।',
        ),
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type: form.type,
        itemId: form.itemId,
        date: form.date,
        quantity: form.quantity,
        sourceRef: form.sourceRef || null,
        ...(isTransfer
          ? { fromWarehouseId: form.fromWarehouseId, toWarehouseId: form.toWarehouseId }
          : { warehouseId: form.warehouseId }),
        unitCost: form.unitCost || null,
        offsetAccountId: needsOffset ? form.offsetAccountId : null,
        allowNegativeStock: canOverride ? form.allowNegativeStock : false,
        overrideReason: canOverride && form.allowNegativeStock ? form.overrideReason || null : null,
        reason: form.reason || null,
      };
      const response = await inventoryApi.postCommand(companyId, payload, key);
      setResult(response);
      setKey(newIdempotencyKey());
      setForm((current) => ({
        ...current,
        quantity: '',
        unitCost: '',
        sourceRef: '',
        allowNegativeStock: false,
        overrideReason: '',
      }));
      onRecorded();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-semibold text-ink-900">{L('Record a stock movement', 'স্টক মুভমেন্ট রেকর্ড করুন')}</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-500">
              {L(
                'Every command is atomic, idempotent and carries an actor, source and timestamp. Stock history is immutable; corrections use reversal or adjustment.',
                'প্রতিটি কমান্ড পারমাণবিক, ইডেম্পোটেন্ট এবং কর্তা, উৎস ও সময়সহ। স্টক ইতিহাস অপরিবর্তনীয়; সংশোধন রিভার্সাল বা সমন্বয়ে হয়।',
              )}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12px] text-ink-600">
            <p className="font-semibold text-ink-800">{L('Precision', 'নির্ভুলতা')}</p>
            <p>4 {L('decimal places', 'দশমিক স্থান')}</p>
            <p className="font-mono">{L('Money', 'টাকা')}: poisha</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label={L('Movement type', 'মুভমেন্টের ধরন')}>
            <select
              className={INPUT_CLASS}
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as StockCommandType })}
            >
              {(Object.keys(COMMAND_LABELS) as StockCommandType[]).map((type) => (
                <option key={type} value={type}>{L(...COMMAND_LABELS[type])}</option>
              ))}
            </select>
          </Field>
          <Field label={L('Item', 'আইটেম')} required>
            <select className={INPUT_CLASS} value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>
              <option value="">{L('Choose a stock item', 'স্টক আইটেম বেছে নিন')}</option>
              {stockItems.map((item) => (
                <option key={item.id} value={item.id}>{item.sku} · {item.nameEn}</option>
              ))}
            </select>
          </Field>
          <Field label={L('Movement date', 'মুভমেন্টের তারিখ')} required>
            <input className={INPUT_CLASS} type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>

          {isTransfer ? (
            <>
              <Field label={L('From warehouse', 'উৎস গুদাম')} required>
                <select className={INPUT_CLASS} value={form.fromWarehouseId} onChange={(event) => setForm({ ...form, fromWarehouseId: event.target.value })}>
                  <option value="">{L('Choose source', 'উৎস বেছে নিন')}</option>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.nameEn}</option>)}
                </select>
              </Field>
              <Field label={L('To warehouse', 'গন্তব্য গুদাম')} required>
                <select className={INPUT_CLASS} value={form.toWarehouseId} onChange={(event) => setForm({ ...form, toWarehouseId: event.target.value })}>
                  <option value="">{L('Choose destination', 'গন্তব্য বেছে নিন')}</option>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.nameEn}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <Field label={L('Warehouse', 'গুদাম')} required>
              <select className={INPUT_CLASS} value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
                <option value="">{L('Choose a warehouse', 'গুদাম বেছে নিন')}</option>
                {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.nameEn}</option>)}
              </select>
            </Field>
          )}

          <Field label={L('Quantity', 'পরিমাণ')} required hint={L('Up to four decimals, for example 12.3456 kg.', 'সর্বোচ্চ চার দশমিক, যেমন ১২.৩৪৫৬ কেজি।')}>
            <input className={INPUT_CLASS} inputMode="decimal" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </Field>

          <Field label={L('Unit cost (BDT)', 'একক ব্যয় (টাকা)')} required={needsUnitCost} hint={needsUnitCost ? L('Required for opening stock and GRN.', 'উদ্বোধনী স্টক ও জিআরএন-এর জন্য আবশ্যক।') : L('Optional where the current weighted average can value the movement.', 'বর্তমান ভারিত গড়ে মূল্য নির্ধারণ সম্ভব হলে ঐচ্ছিক।')}>
            <input className={INPUT_CLASS} inputMode="decimal" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} />
          </Field>

          {needsOffset ? (
            <Field label={L('Other side of the journal', 'জার্নালের অপর পক্ষ')} required>
              <select className={INPUT_CLASS} value={form.offsetAccountId} onChange={(event) => setForm({ ...form, offsetAccountId: event.target.value })}>
                <option value="">{L('Choose an account', 'হিসাব বেছে নিন')}</option>
                {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.nameEn}</option>)}
              </select>
            </Field>
          ) : null}

          <Field label={L('Source reference', 'উৎস রেফারেন্স')} hint={L('GRN, challan, count sheet or transfer note.', 'জিআরএন, চালান, গণনা শীট বা স্থানান্তর নোট।')}>
            <input className={INPUT_CLASS} value={form.sourceRef} onChange={(event) => setForm({ ...form, sourceRef: event.target.value })} maxLength={200} />
          </Field>

          <Field label={L('Reason', 'কারণ')} required={needsReason}>
            <input className={INPUT_CLASS} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} />
          </Field>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3">
          <p className="text-[12px] leading-relaxed text-ink-600">{L(...COMMAND_HINTS[form.type])}</p>
        </div>

        {canOverride ? (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <label className="flex items-start gap-2 text-[13px] font-medium text-amber-900 dark:text-amber-200">
              <input type="checkbox" className="mt-0.5" checked={form.allowNegativeStock} onChange={(event) => setForm({ ...form, allowNegativeStock: event.target.checked })} />
              <span>
                {L('Allow negative stock for this command', 'এই কমান্ডের জন্য নেতিবাচক স্টক অনুমোদন')}
                <span className="mt-1 block text-[12px] font-normal leading-relaxed">
                  {L('Only works with OVERRIDE_NEGATIVE_STOCK and a reason. The exception is recorded on the movement and audited.', 'শুধু OVERRIDE_NEGATIVE_STOCK ও কারণসহ কাজ করে। ব্যতিক্রমটি মুভমেন্টে ও অডিটে রেকর্ড হয়।')}
                </span>
              </span>
            </label>
            {form.allowNegativeStock ? (
              <input className={`${INPUT_CLASS} mt-2`} placeholder={L('Override reason (required)', 'ওভাররাইডের কারণ (আবশ্যক)')} value={form.overrideReason} onChange={(event) => setForm({ ...form, overrideReason: event.target.value })} maxLength={500} />
            ) : null}
          </div>
        ) : null}

        {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void submit()} disabled={saving || !canDispatch} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50">
            <PackagePlus size={16} />
            {saving ? L('Recording…', 'রেকর্ড হচ্ছে…') : L('Record movement', 'মুভমেন্ট রেকর্ড')}
          </button>
          <button type="button" onClick={() => setKey(newIdempotencyKey())} className="min-h-11 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink-700">
            {L('New idempotency key', 'নতুন ইডেম্পোটেন্সি কী')}
          </button>
          <span className="font-mono text-[12px] text-ink-400">Idempotency-Key: {key}</span>
        </div>
      </section>

      {result ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-2 text-[15px] font-semibold text-emerald-800 dark:text-emerald-200">
              <CircleCheck size={16} />
              {result.replayed ? L('Replayed original command', 'মূল কমান্ড পুনরায় দেখানো হয়েছে') : L('Movement recorded', 'মুভমেন্ট রেকর্ড হয়েছে')}
            </h3>
            <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] font-semibold text-ink-700">{L('Dismiss', 'বন্ধ')}</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead className="text-[12px] uppercase tracking-[0.06em] text-ink-500">
                <tr>
                  <th className="px-2 py-2">{L('Item', 'আইটেম')}</th>
                  <th className="px-2 py-2">{L('Type', 'ধরন')}</th>
                  <th className="px-2 py-2 text-right">{L('Quantity', 'পরিমাণ')}</th>
                  <th className="px-2 py-2 text-right">{L('Value', 'মূল্য')}</th>
                  <th className="px-2 py-2 text-right">{L('Balance after', 'পরবর্তী ব্যালেন্স')}</th>
                  <th className="px-2 py-2">{L('Journal', 'জার্নাল')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {result.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-2 py-2">{movement.itemSku} · {movement.warehouseCode}</td>
                    <td className="px-2 py-2">{movementTypeLabel(movement.movementType, L)}</td>
                    <td className="px-2 py-2 text-right font-mono">{movement.quantity} {movement.unit}</td>
                    <td className="px-2 py-2 text-right font-mono"><PoishaText value={movement.valuePoisha} /></td>
                    <td className="px-2 py-2 text-right font-mono">{movement.balanceAfterQuantity}</td>
                    <td className="px-2 py-2 font-mono text-[12px]">{movement.journalNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.movements.some((movement) => movement.negativeStockOverride) ? (
            <div className="mt-3"><Notice message={L('Negative stock was explicitly approved and audited.', 'নেতিবাচক স্টক স্পষ্টভাবে অনুমোদিত ও অডিট করা হয়েছে।')} tone="warning" /></div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
