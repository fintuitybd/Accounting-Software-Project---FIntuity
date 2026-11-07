import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { usePreferences } from '../../preferences/AppPreferences';
import { DraftSaveIndicator, ValidationSummary, useUnsavedChangesGuard, type DraftSaveState } from '../forms/draftSupport';
import type {
  PurchaseDocument,
  PurchaseDocumentType,
  PurchaseDraftInput,
  PurchasePaymentMethod,
  PurchaseTdsNature,
} from '../../purchases/api';
import { purchaseApi } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import type { PurchaseRefs } from './purchasesRefs';
import { addDaysIso, newKey, todayIso } from './purchasesUi';

const TAX_CATEGORY_OPTIONS = [
  ['STANDARD_15', 'Standard 15% VAT'],
  ['TRADING_5', 'Truncated trading 5%'],
  ['PROCUREMENT_7_5', 'Procurement provider 7.5%'],
  ['EXPORT_ZERO', 'Export / zero-rated'],
  ['EXEMPT', 'Exempt'],
  ['REVERSE_CHARGE', 'Reverse charge (imported service)'],
  ['OUT_OF_SCOPE', 'Out of scope (blocked)'],
] as const;

const TDS_OPTIONS: Array<[PurchaseTdsNature, string]> = [
  ['NONE', 'No TDS'],
  ['SUPPLY_OF_GOODS', 'Supply of goods'],
  ['PROFESSIONAL_OR_TECHNICAL_SERVICES', 'Professional / technical services'],
  ['COMMERCIAL_RENT', 'Commercial rent'],
  ['ADVERTISING_OR_MEDIA', 'Advertising / media'],
  ['TRANSPORT_OR_LOGISTICS', 'Transport / logistics'],
  ['CONTRACTOR_OR_SUBCONTRACTOR', 'Contractor / subcontractor'],
];

const PAYMENT_METHODS: Array<[PurchasePaymentMethod, string]> = [
  ['BANK', 'Bank'],
  ['MFS', 'MFS'],
  ['CASH', 'Cash'],
  ['CHEQUE', 'Cheque'],
  ['CREDIT_CARD', 'Credit card'],
];

interface FormLine {
  key: string;
  itemId: string;
  descriptionEn: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  taxCategory: string;
  accountId: string;
  warehouseId: string;
}

function blankLine(): FormLine {
  return {
    key: newKey('line'),
    itemId: '',
    descriptionEn: '',
    quantity: '1.0000',
    unit: '',
    unitPrice: '',
    discount: '0.00',
    taxCategory: 'STANDARD_15',
    accountId: '',
    warehouseId: '',
  };
}

function fromDocument(document: PurchaseDocument): FormLine[] {
  return document.lines.map((line) => ({
    key: line.id,
    itemId: line.itemId ?? '',
    descriptionEn: line.descriptionEn,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPriceBdt,
    discount: line.discountBdt,
    taxCategory: line.taxCategory,
    accountId: line.accountId,
    warehouseId: line.warehouseId ?? '',
  }));
}

export function PurchaseFormPanel({
  companyId,
  refs,
  docType,
  initialDocument,
  onSaved,
  onCancel,
}: {
  companyId: string;
  refs: PurchaseRefs;
  docType: PurchaseDocumentType;
  initialDocument?: PurchaseDocument | null;
  onSaved: (document: PurchaseDocument) => void;
  onCancel: () => void;
}) {
  const { defaultBranchId } = usePreferences();
  const suppliers = useMemo(
    () => refs.suppliers.filter((party) => party.type === 'SUPPLIER' || party.type === 'BOTH'),
    [refs.suppliers],
  );
  const lineAccounts = useMemo(
    () =>
      refs.accounts.filter(
        (account) =>
          account.isActive &&
          (account.accountType === 'EXPENSE' || account.accountType === 'ASSET') &&
          account.controlSubledger === 'NONE',
      ),
    [refs.accounts],
  );
  const isExpense = docType === 'EXPENSE_VOUCHER';
  const [partyId, setPartyId] = useState(initialDocument?.partyId ?? '');
  const [branchId, setBranchId] = useState(initialDocument?.branchId ?? defaultBranchId ?? '');
  const [docDate, setDocDate] = useState(initialDocument?.docDate ?? todayIso());
  const [dueDate, setDueDate] = useState(initialDocument?.dueDate ?? addDaysIso(todayIso(), 30));
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(initialDocument?.paymentTermsDays ?? 30));
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(initialDocument?.supplierInvoiceNo ?? '');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(
    initialDocument?.supplierInvoiceDate ?? todayIso(),
  );
  const [supplierMushak63Serial, setSupplierMushak63Serial] = useState(
    initialDocument?.supplierMushak63Serial ?? '',
  );
  const [supplierMushak63Date, setSupplierMushak63Date] = useState(
    initialDocument?.supplierMushak63Date ?? '',
  );
  const [reverseChargeChallanReference, setReverseChargeChallanReference] = useState(
    initialDocument?.reverseChargeChallanReference ?? '',
  );
  const [attachmentReference, setAttachmentReference] = useState(initialDocument?.attachmentReference ?? '');
  const [narrationEn, setNarrationEn] = useState(initialDocument?.narrationEn ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>(
    (initialDocument?.paymentMethod as PurchasePaymentMethod) ?? 'BANK',
  );
  const [supplierTinMissing, setSupplierTinMissing] = useState(initialDocument?.supplierTinMissing ?? false);
  const [vdsApplicable, setVdsApplicable] = useState(initialDocument?.vdsApplicable ?? true);
  const [tdsNature, setTdsNature] = useState<PurchaseTdsNature>(
    (initialDocument?.tdsNature as PurchaseTdsNature) ?? 'NONE',
  );
  const [lines, setLines] = useState<FormLine[]>(initialDocument ? fromDocument(initialDocument) : [blankLine()]);
  const addLine = () => setLines((current) => [...current, blankLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(initialDocument?.id ?? null);
  const [saveState, setSaveState] = useState<DraftSaveState>('IDLE');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState('');
  const [summaryErrors, setSummaryErrors] = useState<Array<{ message: string; href?: string }>>([]);
  const draftKeyRef = useRef(newKey('purchase-draft'));
  const savingRef = useRef(false);

  const updateLine = (key: string, patch: Partial<FormLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const onItemChange = (key: string, itemId: string) => {
    const item = refs.items.find((entry) => entry.id === itemId);
    if (!item) {
      updateLine(key, { itemId, descriptionEn: '', unit: '', accountId: '', warehouseId: '' });
      return;
    }
    updateLine(key, {
      itemId,
      descriptionEn: item.nameEn,
      unit: item.unit,
      taxCategory: item.defaultTaxCategory,
      accountId: item.isStockItem
        ? item.inventoryAccountId ?? ''
        : item.expenseAccountId ?? '',
      warehouseId: item.isStockItem ? '' : '',
    });
  };

  const onSupplierChange = (value: string) => {
    setPartyId(value);
    if (initialDocument) return;
    const supplier = suppliers.find((entry) => entry.id === value);
    if (supplier) {
      setPaymentTermsDays(String(supplier.creditDays));
      setDueDate(addDaysIso(docDate, supplier.creditDays));
    }
  };

  const payload = useMemo<PurchaseDraftInput>(
    () => ({
      docType,
      partyId,
      branchId: branchId || null,
      docDate,
      dueDate,
      paymentTermsDays: Number(paymentTermsDays),
      supplierInvoiceNo,
      supplierInvoiceDate,
      supplierMushak63Serial: supplierMushak63Serial.trim() || null,
      supplierMushak63Date: supplierMushak63Date || null,
      reverseChargeChallanReference: reverseChargeChallanReference.trim() || null,
      attachmentReference: attachmentReference.trim() || null,
      narrationEn,
      paymentMethod,
      supplierTinMissing,
      vdsApplicable,
      tdsNature,
      lines: lines.map((line) => ({
        itemId: line.itemId || null,
        descriptionEn: line.descriptionEn || null,
        quantity: line.quantity,
        unit: line.unit || null,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxCategory: line.taxCategory,
        accountId: line.accountId || null,
        warehouseId: line.warehouseId || null,
      })),
    }),
    [
      attachmentReference,
      branchId,
      docDate,
      docType,
      dueDate,
      lines,
      narrationEn,
      partyId,
      paymentMethod,
      paymentTermsDays,
      reverseChargeChallanReference,
      supplierInvoiceDate,
      supplierInvoiceNo,
      supplierMushak63Date,
      supplierMushak63Serial,
      supplierTinMissing,
      tdsNature,
      vdsApplicable,
    ],
  );
  const selectedSupplier = useMemo(
    () => refs.suppliers.find((p) => p.id === partyId),
    [refs.suppliers, partyId],
  );

  const statutorySplit = useMemo(() => {
    let baseTotal = 0;
    let vatTotal = 0;

    for (const line of lines) {
      const q = parseFloat(line.quantity) || 0;
      const p = parseFloat(line.unitPrice) || 0;
      const d = parseFloat(line.discount) || 0;
      const lineBase = Math.max(0, q * p - d);
      baseTotal += lineBase;

      let vatRate = 0;
      if (line.taxCategory === 'STANDARD_15') vatRate = 0.15;
      else if (line.taxCategory === 'TRADING_5') vatRate = 0.05;
      else if (line.taxCategory === 'PROCUREMENT_7_5') vatRate = 0.075;
      vatTotal += lineBase * vatRate;
    }

    const hasValidBin = Boolean(selectedSupplier?.bin && /^\d{13}$/.test(selectedSupplier.bin.trim()));
    const hasMushak63 = Boolean(supplierMushak63Serial?.trim() && supplierMushak63Date);
    const isSec46Eligible = hasValidBin && hasMushak63 && (baseTotal <= 100000 || paymentMethod !== 'CASH');

    const vdsAmount = vdsApplicable ? vatTotal : 0;

    const hasTin = Boolean(selectedSupplier?.tin && /^\d{12}$/.test(selectedSupplier.tin.trim()));
    const penaltyApplied = supplierTinMissing || !hasTin;

    let tdsRateBps = 0;
    let sectionLabel = 'None';
    if (tdsNature === 'SUPPLY_OF_GOODS') {
      tdsRateBps = penaltyApplied ? 450 : 300;
      sectionLabel = 'Sec 89 Goods';
    } else if (tdsNature === 'PROFESSIONAL_OR_TECHNICAL_SERVICES') {
      tdsRateBps = penaltyApplied ? 1500 : 1000;
      sectionLabel = 'Sec 90 Service';
    } else if (tdsNature === 'TRANSPORT_OR_LOGISTICS') {
      tdsRateBps = penaltyApplied ? 450 : 300;
      sectionLabel = 'Sec 91 Transport';
    } else if (tdsNature === 'ADVERTISING_OR_MEDIA') {
      tdsRateBps = penaltyApplied ? 750 : 500;
      sectionLabel = 'Sec 92 Media';
    } else if (tdsNature === 'COMMERCIAL_RENT') {
      tdsRateBps = penaltyApplied ? 750 : 500;
      sectionLabel = 'Sec 109 Rent';
    } else if (tdsNature === 'CONTRACTOR_OR_SUBCONTRACTOR') {
      tdsRateBps = penaltyApplied ? 450 : 300;
      sectionLabel = 'Sec 88 Contract';
    }

    const tdsAmount = (baseTotal * tdsRateBps) / 10000;
    const netPayable = baseTotal + vatTotal - vdsAmount - tdsAmount;
    const treasuryObligation = vdsAmount + tdsAmount;

    return {
      baseTotal,
      vatTotal,
      isSec46Eligible,
      vdsAmount,
      tdsAmount,
      tdsRateBps,
      sectionLabel,
      penaltyApplied,
      netPayable,
      treasuryObligation,
    };
  }, [
    lines,
    selectedSupplier,
    supplierMushak63Serial,
    supplierMushak63Date,
    paymentMethod,
    vdsApplicable,
    tdsNature,
    supplierTinMissing,
  ]);

  const fingerprint = useMemo(() => JSON.stringify(payload), [payload]);
  const validationErrors = useMemo(() => {
    const next: Array<{ field: string; message: string }> = [];
    if (!partyId) next.push({ field: 'party', message: 'Choose a supplier.' });
    if (!supplierInvoiceNo.trim()) next.push({ field: 'supplierInvoice', message: 'Enter the supplier invoice or receipt number.' });
    if (lines.length === 0) next.push({ field: 'lines', message: 'Add at least one line.' });
    if (!lines.some((line) => line.accountId && Number(line.quantity) > 0)) {
      next.push({ field: 'lines', message: 'Each saved line needs a positive quantity and an inventory or expense account.' });
    }
    return next;
  }, [lines, partyId, supplierInvoiceNo]);
  const canAutosave = validationErrors.length === 0;
  const initialisedRef = useRef(false);
  const autosaveRef = useRef<() => Promise<void>>(async () => undefined);

  const autosave = useCallback(async () => {
    if (savingRef.current || !canAutosave) return;
    savingRef.current = true;
    setSaveState('SAVING');
    setSaveError(null);
    try {
      const result = savedDocumentId
        ? await purchaseApi.updateDocument(companyId, savedDocumentId, payload)
        : await purchaseApi.createDocument(companyId, payload, draftKeyRef.current);
      setSavedDocumentId(result.document.id);
      setSavedFingerprint(fingerprint);
      setSavedAt(new Date());
      setSaveState('SAVED');
    } catch (caught) {
      setSaveState('ERROR');
      setSaveError(apiErrorMessage(caught));
    } finally {
      savingRef.current = false;
    }
  }, [canAutosave, companyId, fingerprint, payload, savedDocumentId]);
  autosaveRef.current = autosave;

  useEffect(() => {
    if (initialisedRef.current) return;
    initialisedRef.current = true;
    setSavedFingerprint(fingerprint);
    if (initialDocument) {
      setSaveState('SAVED');
      setSavedAt(new Date(initialDocument.updatedAt));
    }
  }, [fingerprint, initialDocument]);

  useEffect(() => {
    if (!initialisedRef.current || saving) return undefined;
    if (fingerprint === savedFingerprint) {
      setSaveState((current) => (current === 'ERROR' ? current : current === 'SAVED' ? 'SAVED' : 'IDLE'));
      return undefined;
    }
    if (!canAutosave) {
      setSaveState('INCOMPLETE');
      return undefined;
    }
    setSaveState('DIRTY');
    const timer = window.setTimeout(() => {
      void autosaveRef.current();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [canAutosave, fingerprint, saving, savedFingerprint]);

  useEffect(() => {
    if (validationErrors.length === 0) setSummaryErrors([]);
  }, [validationErrors.length]);

  useUnsavedChangesGuard(
    fingerprint !== savedFingerprint,
    'This draft has unsaved changes. Leave without saving them?',
  );

  const save = async () => {
    setError(null);
    setNotice(null);
    setSummaryErrors(validationErrors.map((entry) => ({ message: entry.message })));
    if (validationErrors.length > 0) return;
    setSaving(true);
    try {
      const result = savedDocumentId
        ? await purchaseApi.updateDocument(companyId, savedDocumentId, payload)
        : await purchaseApi.createDocument(companyId, payload, draftKeyRef.current);
      setSavedFingerprint(fingerprint);
      setSavedAt(new Date());
      setNotice(
        initialDocument
          ? 'Draft updated. The server recalculated the tax and totals.'
          : 'Draft saved. Review the server-calculated tax, allocation and AP totals below.',
      );
      onSaved(result.document);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ql-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ql-kicker">{isExpense ? 'Expense control' : 'Procure to pay'}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {initialDocument ? 'Edit purchase draft' : isExpense ? 'New expense voucher' : 'New supplier bill'}
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
            Drafts are saved on the server. Totals, input VAT and withholding are calculated by the server.
            A stock line is a real goods receipt at posting; this release does not implement purchase orders,
            a separate GRN or a three-way match, and none is shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <DraftSaveIndicator
            state={saveState}
            savedAt={savedAt}
            error={saveError}
            onRetry={() => void autosaveRef.current()}
            labels={{
              idle: 'No changes',
              dirty: 'Unsaved changes',
              saving: 'Saving draft…',
              saved: 'Draft saved',
              error: 'Draft not saved',
              incomplete: 'Complete the required fields to autosave',
              retry: 'Retry',
            }}
          />
          <button type="button" className="ql-btn ql-btn-ghost min-h-11 text-[13px]" onClick={onCancel}>
            <X size={15} /> Close
          </button>
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {notice ? <div className="mt-4"><Notice message={notice} tone="success" /></div> : null}
      <div className="mt-4">
        <ValidationSummary errors={summaryErrors} title="Fix the following before saving" />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Supplier" required>
          <select className={INPUT_CLASS} value={partyId} onChange={(event) => onSupplierChange(event.target.value)}>
            <option value="">Choose supplier</option>
            {suppliers.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} — {party.nameEn}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select className={INPUT_CLASS} value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">No branch</option>
            {refs.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.nameEn}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Accounting date" required>
          <input type="date" className={INPUT_CLASS} value={docDate} onChange={(event) => setDocDate(event.target.value)} />
        </Field>
        <Field label="Due date">
          <input type="date" className={INPUT_CLASS} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field label="Supplier invoice / receipt no." required>
          <input className={INPUT_CLASS} value={supplierInvoiceNo} onChange={(event) => setSupplierInvoiceNo(event.target.value)} />
        </Field>
        <Field label="Supplier invoice date" required>
          <input
            type="date"
            className={INPUT_CLASS}
            value={supplierInvoiceDate}
            onChange={(event) => setSupplierInvoiceDate(event.target.value)}
          />
        </Field>
        <Field label="Payment terms (days)">
          <input
            type="number"
            min={0}
            max={3650}
            className={INPUT_CLASS}
            value={paymentTermsDays}
            onChange={(event) => setPaymentTermsDays(event.target.value)}
          />
        </Field>
        <Field label="Declared payment method" hint="Cash above BDT 1,00,000 disallows input VAT under the s.46 guard.">
          <select
            className={INPUT_CLASS}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as PurchasePaymentMethod)}
          >
            {PAYMENT_METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier Mushak 6.3 serial" hint="Never generated by the system. Leave blank if the supplier did not provide it.">
          <input
            className={INPUT_CLASS}
            value={supplierMushak63Serial}
            onChange={(event) => setSupplierMushak63Serial(event.target.value)}
          />
        </Field>
        <Field label="Mushak 6.3 issue date">
          <input
            type="date"
            className={INPUT_CLASS}
            value={supplierMushak63Date}
            onChange={(event) => setSupplierMushak63Date(event.target.value)}
          />
        </Field>
        <Field label="Reverse-charge challan reference" hint="Only for imported services. Without it, the self-assessed VAT is not claimable.">
          <input
            className={INPUT_CLASS}
            value={reverseChargeChallanReference}
            onChange={(event) => setReverseChargeChallanReference(event.target.value)}
          />
        </Field>
        <Field label="Attachment reference" hint="Evidence reference only; this release does not upload files.">
          <input
            className={INPUT_CLASS}
            value={attachmentReference}
            onChange={(event) => setAttachmentReference(event.target.value)}
          />
        </Field>
        <Field label="TDS nature">
          <select
            className={INPUT_CLASS}
            value={tdsNature}
            onChange={(event) => setTdsNature(event.target.value as PurchaseTdsNature)}
          >
            {TDS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Narration" required>
          <input className={INPUT_CLASS} value={narrationEn} onChange={(event) => setNarrationEn(event.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={supplierTinMissing}
            onChange={(event) => setSupplierTinMissing(event.target.checked)}
          />
          Treat supplier e-TIN as missing (upscales TDS by 50%)
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
          <input type="checkbox" checked={vdsApplicable} onChange={(event) => setVdsApplicable(event.target.checked)} />
          Apply VDS on payment
        </label>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-[1100px] w-full border-separate border-spacing-y-2 text-[13px]">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-[0.08em] text-ink-400">
              <th className="px-2">Item / description</th>
              <th className="px-2">Qty</th>
              <th className="px-2">Unit</th>
              <th className="px-2">Unit price</th>
              <th className="px-2">Discount</th>
              <th className="px-2">Tax category</th>
              <th className="px-2">Inventory / expense account</th>
              <th className="px-2">Warehouse</th>
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = refs.items.find((entry) => entry.id === line.itemId);
              const stock = Boolean(item?.isStockItem);
              return (
                <tr key={line.key} className="rounded-xl bg-surface-2/40 align-top">
                  <td className="min-w-[280px] px-2 py-2">
                    <select id={`purchase-line-item-${index}`} className={INPUT_CLASS} value={line.itemId} onChange={(event) => onItemChange(line.key, event.target.value)} aria-label="Item">
                      <option value="">No master item</option>
                      {refs.items
                        .filter((entry) => entry.status === 'ACTIVE')
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.sku} — {entry.nameEn}
                          </option>
                        ))}
                    </select>
                    <input
                      className={`${INPUT_CLASS} mt-2`}
                      placeholder={`Line ${index + 1} description`}
                      value={line.descriptionEn}
                      onChange={(event) => updateLine(line.key, { descriptionEn: event.target.value })}
                    />
                  </td>
                  <td className="w-[110px] px-2 py-2">
                    <input
                      className={INPUT_CLASS}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      aria-label="Quantity"
                    />
                  </td>
                  <td className="w-[90px] px-2 py-2">
                    <input className={INPUT_CLASS} value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} aria-label="Unit" />
                  </td>
                  <td className="w-[130px] px-2 py-2">
                    <input
                      className={INPUT_CLASS}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                      aria-label="Unit price"
                    />
                  </td>
                  <td className="w-[110px] px-2 py-2">
                    <input
                      className={INPUT_CLASS}
                      inputMode="decimal"
                      value={line.discount}
                      onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                      aria-label="Discount"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && index === lines.length - 1) {
                          e.preventDefault();
                          addLine();
                          requestAnimationFrame(() => {
                            document.getElementById(`purchase-line-item-${index + 1}`)?.focus();
                          });
                        }
                      }}
                    />
                  </td>
                  <td className="w-[190px] px-2 py-2">
                    <select
                      className={INPUT_CLASS}
                      value={line.taxCategory}
                      onChange={(event) => updateLine(line.key, { taxCategory: event.target.value })}
                      aria-label="Tax category"
                    >
                      {TAX_CATEGORY_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[220px] px-2 py-2">
                    {stock ? (
                      <div className="ql-input flex min-h-11 items-center text-[13px] text-ink-600">
                        {item?.inventoryAccountCode ?? 'Missing inventory account'} — {item?.inventoryAccountName ?? 'Configure the item'}
                      </div>
                    ) : (
                      <select
                        className={INPUT_CLASS}
                        value={line.accountId}
                        onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                        aria-label="Inventory or expense account"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && index === lines.length - 1) {
                            e.preventDefault();
                            addLine();
                            requestAnimationFrame(() => {
                              document.getElementById(`purchase-line-item-${index + 1}`)?.focus();
                            });
                          }
                        }}
                      >
                        <option value="">Choose expense / asset account</option>
                        {lineAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} — {account.nameEn}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="w-[150px] px-2 py-2">
                    {stock ? (
                      <select
                        className={INPUT_CLASS}
                        value={line.warehouseId}
                        onChange={(event) => updateLine(line.key, { warehouseId: event.target.value })}
                        aria-label="Warehouse"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && index === lines.length - 1) {
                            e.preventDefault();
                            addLine();
                            requestAnimationFrame(() => {
                              document.getElementById(`purchase-line-item-${index + 1}`)?.focus();
                            });
                          }
                        }}
                      >
                        <option value="">Choose warehouse</option>
                        {refs.warehouses
                          .filter((warehouse) => warehouse.status === 'ACTIVE')
                          .map((warehouse) => (
                            <option key={warehouse.id} value={warehouse.id}>
                              {warehouse.code} — {warehouse.nameEn}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="block px-1 py-3 text-[12px] text-ink-400">No stock movement</span>
                    )}
                  </td>
                  <td className="w-[48px] px-2 py-2">
                    <button
                      type="button"
                      className="ql-btn ql-btn-ghost min-h-10 px-2 text-ink-500"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => setLines((current) => (current.length === 1 ? current : current.filter((entry) => entry.key !== line.key)))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ql-card mt-4 border border-ql-border bg-ql-surface/95 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ql-border pb-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-ink-500">
              Live Statutory Split Waterfall (VAT Act 2012 &amp; ITA 2023)
            </span>
            {statutorySplit.isSec46Eligible ? (
              <span className="ql-badge ql-badge-success text-[11px]">
                ✓ Sec 46 Eligible (Acct 1140)
              </span>
            ) : (
              <span className="ql-badge ql-badge-warn text-[11px]">
                Capitalized to Cost - Sec 46(2) Non-Rebatable
              </span>
            )}
            {statutorySplit.penaltyApplied && statutorySplit.tdsRateBps > 0 ? (
              <span className="ql-badge ql-badge-danger text-[11px]">
                +50% Sec 134 No e-TIN Penalty
              </span>
            ) : null}
          </div>
          <span className="font-mono text-[11px] text-ink-400">Economic Code: 1/1141/0010/0311</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5 text-[12px]">
          <div>
            <span className="text-ink-400">Taxable Base</span>
            <p className="mt-0.5 font-mono text-[14px] font-bold text-ink-900">
              ৳{statutorySplit.baseTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div>
            <span className="text-ink-400">+ Input VAT (15%)</span>
            <p className="mt-0.5 font-mono text-[14px] font-bold text-ink-900">
              ৳{statutorySplit.vatTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div>
            <span className="text-ink-400">- VDS at Source</span>
            <p className="mt-0.5 font-mono text-[14px] font-bold text-amber-700 dark:text-amber-400">
              ৳{statutorySplit.vdsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div>
            <span className="text-ink-400">- TDS ({statutorySplit.sectionLabel})</span>
            <p className="mt-0.5 font-mono text-[14px] font-bold text-purple-700 dark:text-purple-400">
              ৳{statutorySplit.tdsAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-1 rounded-lg bg-surface-2 p-2">
            <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">= Net Payable</span>
            <p className="font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-400">
              ৳{statutorySplit.netPayable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[10px] text-ink-400">
              Treasury: ৳{statutorySplit.treasuryObligation.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ql-border bg-ql-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button type="button" className="ql-btn ql-btn-secondary min-h-11 text-[13px]" onClick={addLine}>
          <Plus size={15} /> Add line
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ql-btn ql-btn-ghost min-h-11 text-[13px]" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ql-btn ql-btn-primary min-h-11 text-[13px]" disabled={saving} onClick={() => void save()}>
            <Save size={15} /> {saving ? 'Saving…' : initialDocument ? 'Save draft and review' : 'Save draft and review'}
          </button>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
        The draft autosaves to the server after the supplier, invoice number and a valid line are present. Totals,
        input VAT and withholding are recalculated by the server before posting.
      </p>
    </section>
  );
}
