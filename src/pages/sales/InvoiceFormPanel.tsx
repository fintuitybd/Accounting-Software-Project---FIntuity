import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import type { SalesDocument, SalesDocumentType, SalesDraftInput } from '../../sales/api';
import { salesApi } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { DraftSaveIndicator, ValidationSummary, useUnsavedChangesGuard, type DraftSaveState } from '../forms/draftSupport';
import { SALES_INPUT, SALES_SELECT, addDaysIso, newIdempotencyKey, todayIso } from './salesUi';
import type { SalesRefs } from './salesRefs';

interface FormLine {
  key: string;
  itemId: string;
  descriptionEn: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  taxCategory: string;
  revenueAccountId: string;
  warehouseId: string;
  originalLineId: string | null;
  originalLabel: string | null;
}

function blankLine(): FormLine {
  return {
    key: newIdempotencyKey('line'),
    itemId: '',
    descriptionEn: '',
    quantity: '1.0000',
    unit: '',
    unitPrice: '',
    discount: '0.00',
    taxCategory: 'STANDARD_15',
    revenueAccountId: '',
    warehouseId: '',
    originalLineId: null,
    originalLabel: null,
  };
}

function fromDocument(document: SalesDocument): FormLine[] {
  return document.lines.map((line) => ({
    key: line.id,
    itemId: line.itemId ?? '',
    descriptionEn: line.descriptionEn,
    quantity: document.docType === 'CREDIT_NOTE' ? '0.0000' : line.quantity,
    unit: line.unit,
    unitPrice: line.unitPriceBdt,
    discount: line.discountBdt,
    taxCategory: line.taxCategory,
    revenueAccountId: line.revenueAccountId,
    warehouseId: line.warehouseId ?? '',
    originalLineId: document.docType === 'CREDIT_NOTE' ? line.originalLineId ?? line.id : null,
    originalLabel: document.docType === 'CREDIT_NOTE' ? `${line.quantity} ${line.unit} originally invoiced` : null,
  }));
}

export function InvoiceFormPanel({
  companyId,
  refs,
  docType,
  initialDocument,
  onSaved,
  onCancel,
}: {
  companyId: string;
  refs: SalesRefs;
  docType: SalesDocumentType;
  initialDocument?: SalesDocument | null;
  onSaved: (document: SalesDocument) => void;
  onCancel: () => void;
}) {
  const { locale, defaultBranchId } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const customers = useMemo(
    () => refs.parties.filter((party) => party.type === 'CUSTOMER' || party.type === 'BOTH'),
    [refs.parties],
  );
  const revenueAccounts = useMemo(
    () => refs.accounts.filter((account) => account.isActive && account.accountType === 'REVENUE'),
    [refs.accounts],
  );
  const isCredit = docType === 'CREDIT_NOTE';
  const [partyId, setPartyId] = useState(initialDocument?.partyId ?? '');
  const [branchId, setBranchId] = useState(initialDocument?.branchId ?? defaultBranchId ?? '');
  const [docDate, setDocDate] = useState(initialDocument?.docDate ?? todayIso());
  const [dueDate, setDueDate] = useState(initialDocument?.dueDate ?? addDaysIso(todayIso(), 30));
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(initialDocument?.paymentTermsDays ?? 30));
  const [narrationEn, setNarrationEn] = useState(initialDocument?.narrationEn ?? '');
  const [attachmentReference, setAttachmentReference] = useState(initialDocument?.attachmentReference ?? '');
  const [creditReason, setCreditReason] = useState(initialDocument?.creditReason ?? '');
  const [originalDocumentId, setOriginalDocumentId] = useState(initialDocument?.originalDocumentId ?? '');
  const [originalInvoices, setOriginalInvoices] = useState<Array<{ id: string; label: string }>>([]);
  const [lines, setLines] = useState<FormLine[]>(initialDocument ? fromDocument(initialDocument) : [blankLine()]);
  const [loading, setLoading] = useState(false);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedDocumentId, setSavedDocumentId] = useState<string | null>(initialDocument?.id ?? null);
  const [saveState, setSaveState] = useState<DraftSaveState>('IDLE');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string>('');
  const [summaryErrors, setSummaryErrors] = useState<Array<{ message: string; href?: string }>>([]);
  const [showErrors, setShowErrors] = useState(false);
  const draftKeyRef = useRef(newIdempotencyKey('sales-draft'));
  const savingRef = useRef(false);

  useEffect(() => {
    if (!isCredit || initialDocument) return;
    let cancelled = false;
    void salesApi
      .documents(companyId, { type: 'SALES_INVOICE', status: 'POSTED', limit: 100 })
      .then((response) => {
        if (cancelled) return;
        setOriginalInvoices(
          response.entries.map((entry) => ({
            id: entry.id,
            label: `${entry.documentNo ?? entry.id} Â· ${entry.partyNameEn} Â· ${entry.grossBdt} BDT`,
          })),
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, initialDocument, isCredit]);

  const loadOriginal = useCallback(
    async (id: string) => {
      setLoadingOriginal(true);
      setError(null);
      try {
        const response = await salesApi.document(companyId, id);
        const document = response.document;
        setOriginalDocumentId(id);
        setPartyId(document.partyId);
        setBranchId(document.branchId ?? '');
        setNarrationEn(`Credit note for ${document.documentNo ?? 'original invoice'}`);
        setLines(fromDocument(document));
        setNotice(
          L(
            `Loaded ${document.lines.length} line(s) from ${document.documentNo ?? 'the original invoice'}. Enter the returned quantity for each line.`,
            `${document.documentNo ?? 'মূল চালান'} থেকে ${document.lines.length}টি লাইন লোড হয়েছে। প্রতিটি লাইনে ফেরতের পরিমাণ লিখুন।`,
          ),
        );
      } catch (caught) {
        setError(apiErrorMessage(caught));
      } finally {
        setLoadingOriginal(false);
      }
    },
    [L, companyId],
  );

  const updateLine = (index: number, patch: Partial<FormLine>) => {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  };

  const chooseItem = (index: number, itemId: string) => {
    const item = refs.items.find((entry) => entry.id === itemId);
    updateLine(index, {
      itemId,
      descriptionEn: item?.nameEn ?? '',
      unit: item?.unit ?? '',
      taxCategory: item?.defaultTaxCategory ?? 'STANDARD_15',
      warehouseId: item?.isStockItem ? lines[index]?.warehouseId ?? '' : '',
    });
  };

  const payload = useMemo<SalesDraftInput>(
    () => ({
      docType,
      partyId,
      branchId: branchId || null,
      docDate,
      dueDate: isCredit ? docDate : dueDate,
      paymentTermsDays: isCredit ? 0 : Number(paymentTermsDays) || 0,
      narrationEn: narrationEn.trim(),
      attachmentReference: attachmentReference.trim() || null,
      creditReason: isCredit ? creditReason.trim() : null,
      originalDocumentId: isCredit ? originalDocumentId : null,
      lines: lines.map((line) =>
        isCredit
          ? { originalLineId: line.originalLineId, quantity: line.quantity }
          : {
              itemId: line.itemId || null,
              descriptionEn: line.descriptionEn.trim() || null,
              quantity: line.quantity,
              unit: line.unit.trim() || null,
              unitPrice: line.unitPrice,
              discount: line.discount || '0.00',
              taxCategory: line.taxCategory,
              revenueAccountId: line.revenueAccountId,
              warehouseId: line.warehouseId || null,
            },
      ),
    }),
    [
      attachmentReference,
      branchId,
      creditReason,
      docDate,
      docType,
      dueDate,
      isCredit,
      lines,
      narrationEn,
      originalDocumentId,
      partyId,
      paymentTermsDays,
    ],
  );

  const fingerprint = useMemo(() => JSON.stringify(payload), [payload]);
  const validationErrors = useMemo(() => {
    const next: Array<{ field: string; message: string }> = [];
    if (!partyId) {
      next.push({ field: 'party', message: L('Choose a customer.', 'একজন গ্রাহক নির্বাচন করুন।') });
    }
    if (!narrationEn.trim()) {
      next.push({ field: 'narration', message: L('Enter a narration.', 'একটি বিবরণ লিখুন।') });
    }
    if (isCredit && !originalDocumentId) {
      next.push({ field: 'original', message: L('Choose the original posted invoice.', 'মূল পোস্টকৃত চালান নির্বাচন করুন।') });
    }
    if (isCredit && creditReason.trim().length < 3) {
      next.push({
        field: 'creditReason',
        message: L('Enter a credit-note reason of at least 3 characters.', 'অন্তত ৩ অক্ষরের ক্রেডিট নোটের কারণ লিখুন।'),
      });
    }
    if (!isCredit && !lines.some((line) => line.revenueAccountId && Number(line.unitPrice) > 0)) {
      next.push({
        field: 'lines',
        message: L(
          'Add at least one line with a revenue account and a unit price above zero.',
          'রাজস্ব হিসাব ও শূন্যের বেশি একক মূল্যসহ কমপক্ষে একটি লাইন যোগ করুন।',
        ),
      });
    }
    if (isCredit && !lines.some((line) => Number(line.quantity) > 0)) {
      next.push({
        field: 'lines',
        message: L('Enter a returned quantity above zero on at least one line.', 'কমপক্ষে একটি লাইনে শূন্যের বেশি ফেরত পরিমাণ লিখুন।'),
      });
    }
    return next;
  }, [L, creditReason, isCredit, lines, narrationEn, originalDocumentId, partyId]);
  const canAutosave = validationErrors.length === 0;
  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of validationErrors) if (!map.has(error.field)) map.set(error.field, error.message);
    return map;
  }, [validationErrors]);

  const initialisedRef = useRef(false);
  const autosaveRef = useRef<() => Promise<void>>(async () => undefined);

  const autosave = useCallback(async () => {
    if (savingRef.current || !canAutosave) return;
    savingRef.current = true;
    setSaveState('SAVING');
    setSaveError(null);
    try {
      const response = savedDocumentId
        ? await salesApi.updateDraft(companyId, savedDocumentId, payload)
        : await salesApi.createDraft(companyId, payload, draftKeyRef.current);
      setSavedDocumentId(response.document.id);
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
    if (!initialisedRef.current || loading) return undefined;
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
  }, [canAutosave, fingerprint, loading, savedFingerprint]);

  useUnsavedChangesGuard(
    fingerprint !== savedFingerprint,
    L(
      'This draft has unsaved changes. Leave without saving them?',
      'এই খসড়ায় অসংরক্ষিত পরিবর্তন আছে। সংরক্ষণ না করে চলে যাবেন?',
    ),
  );

  useEffect(() => {
    if (validationErrors.length === 0) setSummaryErrors([]);
  }, [validationErrors.length]);

  const save = async () => {
    setError(null);
    setNotice(null);
    setShowErrors(true);
    setSummaryErrors(
      validationErrors.map((entry) => ({
        message: entry.message,
        href:
          entry.field === 'party'
            ? '#invoice-party'
            : entry.field === 'narration'
              ? '#invoice-narration'
              : entry.field === 'original'
                ? '#invoice-original'
                : entry.field === 'creditReason'
                  ? '#invoice-credit-reason'
                  : undefined,
      })),
    );
    if (validationErrors.length > 0) return;
    setLoading(true);
    try {
      const response = savedDocumentId
        ? await salesApi.updateDraft(companyId, savedDocumentId, payload)
        : await salesApi.createDraft(companyId, payload, draftKeyRef.current);
      setSavedFingerprint(fingerprint);
      setSavedAt(new Date());
      onSaved(response.document);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="lv-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="lv-kicker">{isCredit ? L('Mushak 6.7 concept', 'মূসক ৬.৭ ধারণা') : L('Order-to-cash', 'অর্ডার-টু-ক্যাশ')}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
            {initialDocument
              ? L('Edit draft', 'খসড়া সম্পাদনা')
              : isCredit
                ? L('New credit note', 'নতুন ক্রেডিট নোট')
                : L('New sales invoice', 'নতুন বিক্রয় চালান')}
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
            {isCredit
              ? L(
                  'A credit note is a separate document linked to the original invoice. Only the returned quantity is entered; the server derives value and tax from the original line.',
                  'ক্রেডিট নোট মূল চালানের সাথে যুক্ত একটি আলাদা ডকুমেন্ট। শুধু ফেরতের পরিমাণ লিখুন; সার্ভার মূল লাইন থেকে মূল্য ও কর নির্ধারণ করবে।',
                )
              : L(
                  'Drafts are stored on the server. The server recalculates line tax, totals and stock before posting; the browser never submits an authoritative total.',
                  'খসড়া সার্ভারে সংরক্ষিত হয়। পোস্টের আগে সার্ভার লাইন কর, মোট ও স্টক পুনরায় গণনা করে; ব্রাউজার কোনো চূড়ান্ত মোট জমা দেয় না।',
                )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <DraftSaveIndicator
            state={saveState}
            savedAt={savedAt}
            error={saveError}
            onRetry={() => void autosaveRef.current()}
            labels={{
              idle: L('No changes', 'কোনো পরিবর্তন নেই'),
              dirty: L('Unsaved changes', 'অসংরক্ষিত পরিবর্তন'),
              saving: L('Saving draftâ€¦', 'খসড়া সংরক্ষণ হচ্ছে…'),
              saved: L('Draft saved', 'খসড়া সংরক্ষিত'),
              error: L('Draft not saved', 'খসড়া সংরক্ষিত হয়নি'),
              incomplete: L('Complete the required fields to autosave', 'স্বয়ংক্রিয় সংরক্ষণের জন্য আবশ্যক ঘরগুলো পূরণ করুন'),
              retry: L('Retry', 'আবার চেষ্টা'),
            }}
          />
          <button type="button" onClick={onCancel} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <X size={15} /> {L('Cancel', 'বাতিল')}
          </button>
        </div>
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}
      {notice ? <div className="mt-4"><Notice message={notice} tone="info" /></div> : null}
      <div className="mt-4">
        <ValidationSummary
          errors={summaryErrors}
          title={L('Fix the following before saving', 'সংরক্ষণের আগে নিচের বিষয়গুলো ঠিক করুন')}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isCredit ? (
          <label className="block xl:col-span-2">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Original posted invoice', 'মূল পোস্টকৃত চালান')} <span className="text-rose-500">*</span></span>
            <select
              id="invoice-original"
              value={originalDocumentId}
              onChange={(event) => void loadOriginal(event.target.value)}
              disabled={Boolean(initialDocument) || loadingOriginal}
              className={SALES_SELECT}
              aria-invalid={showErrors && fieldErrors.has('original') || undefined}
              aria-describedby={showErrors && fieldErrors.has('original') ? 'invoice-original-error' : undefined}
            >
              <option value="">{L('Choose an invoice', 'চালান নির্বাচন করুন')}</option>
              {initialDocument?.originalDocumentId ? (
                <option value={initialDocument.originalDocumentId}>
                  {initialDocument.originalDocumentNo ?? initialDocument.originalDocumentId}
                </option>
              ) : null}
              {originalInvoices.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
            {showErrors && fieldErrors.has('original') ? (
              <span id="invoice-original-error" className="ql-field-error">{fieldErrors.get('original')}</span>
            ) : null}
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Customer', 'গ্রাহক')} <span className="text-rose-500">*</span></span>
          <select
            id="invoice-party"
            value={partyId}
            onChange={(event) => setPartyId(event.target.value)}
            disabled={isCredit}
            className={SALES_SELECT}
            aria-invalid={showErrors && fieldErrors.has('party') || undefined}
            aria-describedby={showErrors && fieldErrors.has('party') ? 'invoice-party-error' : undefined}
          >
            <option value="">{L('Choose a customer', 'গ্রাহক নির্বাচন করুন')}</option>
            {customers.map((party) => (
              <option key={party.id} value={party.id}>{party.code} Â· {party.nameEn}</option>
            ))}
          </select>
          {showErrors && fieldErrors.has('party') ? (
            <span id="invoice-party-error" className="ql-field-error">{fieldErrors.get('party')}</span>
          ) : null}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Branch', 'শাখা')}</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={SALES_SELECT}>
            <option value="">{L('No branch', 'শাখা নেই')}</option>
            {refs.branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.code} Â· {branch.nameEn}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Document date', 'ডকুমেন্ট তারিখ')} <span className="text-rose-500">*</span></span>
          <input type="date" value={docDate} onChange={(event) => setDocDate(event.target.value)} className={SALES_INPUT} />
        </label>
        {!isCredit ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Due date', 'পরিশোধের তারিখ')}</span>
              <input type="date" value={dueDate} min={docDate} onChange={(event) => setDueDate(event.target.value)} className={SALES_INPUT} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Payment terms (days)', 'পরিশোধের শর্ত (দিন)')}</span>
              <input type="number" min={0} max={3650} value={paymentTermsDays} onChange={(event) => {
                const days = Math.max(0, Math.min(3650, Number(event.target.value) || 0));
                setPaymentTermsDays(String(days));
                setDueDate(addDaysIso(docDate, days));
              }} className={SALES_INPUT} />
            </label>
          </>
        ) : (
          <label className="block xl:col-span-2">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Credit reason', 'ক্রেডিটের কারণ')} <span className="text-rose-500">*</span></span>
            <input
              id="invoice-credit-reason"
              value={creditReason}
              onChange={(event) => setCreditReason(event.target.value)}
              maxLength={500}
              className={SALES_INPUT}
              placeholder={L('Damaged goods, price adjustment, returnâ€¦', 'নষ্ট পণ্য, মূল্য সমন্বয়, ফেরত…')}
              aria-invalid={showErrors && fieldErrors.has('creditReason') || undefined}
              aria-describedby={showErrors && fieldErrors.has('creditReason') ? 'invoice-credit-reason-error' : undefined}
            />
            {showErrors && fieldErrors.has('creditReason') ? (
              <span id="invoice-credit-reason-error" className="ql-field-error">{fieldErrors.get('creditReason')}</span>
            ) : null}
          </label>
        )}
        <label className="block xl:col-span-2">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Narration', 'বিবরণ')} <span className="text-rose-500">*</span></span>
          <input
            id="invoice-narration"
            value={narrationEn}
            onChange={(event) => setNarrationEn(event.target.value)}
            maxLength={500}
            className={SALES_INPUT}
            aria-invalid={showErrors && fieldErrors.has('narration') || undefined}
            aria-describedby={showErrors && fieldErrors.has('narration') ? 'invoice-narration-error' : undefined}
          />
          {showErrors && fieldErrors.has('narration') ? (
            <span id="invoice-narration-error" className="ql-field-error">{fieldErrors.get('narration')}</span>
          ) : null}
        </label>
        <label className="block xl:col-span-2">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{L('Attachment / evidence reference', 'সংযুক্তি / প্রমাণের রেফারেন্স')}</span>
          <input value={attachmentReference} onChange={(event) => setAttachmentReference(event.target.value)} maxLength={500} className={SALES_INPUT} placeholder={L('Delivery note, return slip or file reference', 'ডেলিভারি নোট, ফেরত স্লিপ বা ফাইলের রেফারেন্স')} />
        </label>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="lv-table w-full min-w-[1100px] text-[13px]">
          <caption className="sr-only">{L('Sales document lines', 'বিক্রয় ডকুমেন্ট লাইন')}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">{L('Item / description', 'আইটেম / বিবরণ')}</th>
              <th scope="col" className="text-left">{L('Quantity', 'পরিমাণ')}</th>
              <th scope="col" className="text-left">{L('Unit', 'একক')}</th>
              <th scope="col" className="text-right">{L('Unit price', 'একক মূল্য')}</th>
              <th scope="col" className="text-right">{L('Discount', 'ছাড়')}</th>
              <th scope="col" className="text-left">{L('Tax', 'কর')}</th>
              <th scope="col" className="text-left">{L('Revenue account', 'রাজস্ব হিসাব')}</th>
              <th scope="col" className="text-left">{L('Warehouse', 'গুদাম')}</th>
              <th scope="col" className="text-right">{L('Action', 'কার্য')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = refs.items.find((entry) => entry.id === line.itemId);
              return (
                <tr key={line.key}>
                  <td className="min-w-[260px]">
                    {isCredit ? (
                      <div>
                        <p className="font-semibold text-ink-900">{line.descriptionEn}</p>
                        <p className="mt-0.5 text-[12px] text-ink-500">{line.originalLabel}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <select value={line.itemId} onChange={(event) => chooseItem(index, event.target.value)} className={SALES_SELECT} aria-label={L('Item', 'আইটেম')}>
                          <option value="">{L('No item / service line', 'আইটেম নেই / সার্ভিস লাইন')}</option>
                          {refs.items.filter((entry) => entry.status === 'ACTIVE').map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.sku} Â· {entry.nameEn}</option>
                          ))}
                        </select>
                        <input value={line.descriptionEn} onChange={(event) => updateLine(index, { descriptionEn: event.target.value })} className={SALES_INPUT} placeholder={L('Line description', 'লাইনের বিবরণ')} maxLength={500} />
                      </div>
                    )}
                  </td>
                  <td className="w-[130px]">
                    <input value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} inputMode="decimal" className={SALES_INPUT} aria-label={L('Quantity', 'পরিমাণ')} />
                    {isCredit ? <p className="mt-1 text-[12px] text-ink-400">{L('Remaining is validated on save', 'বাকি পরিমাণ সংরক্ষণে যাচাই হবে')}</p> : null}
                  </td>
                  <td className="w-[100px]">
                    {isCredit ? <span className="text-[13px] text-ink-700">{line.unit}</span> : <input value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} className={SALES_INPUT} maxLength={20} aria-label={L('Unit', 'একক')} />}
                  </td>
                  <td className="w-[140px]">
                    {isCredit ? <span className="font-money text-[13px] text-ink-700">{line.unitPrice}</span> : <input value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} inputMode="decimal" className={SALES_INPUT} aria-label={L('Unit price', 'একক মূল্য')} />}
                  </td>
                  <td className="w-[120px]">
                    {isCredit ? <span className="text-[13px] text-ink-400">â€”</span> : <input value={line.discount} onChange={(event) => updateLine(index, { discount: event.target.value })} inputMode="decimal" className={SALES_INPUT} aria-label={L('Discount', 'ছাড়')} />}
                  </td>
                  <td className="w-[150px]">
                    {isCredit ? <span className="text-[13px] text-ink-700">{line.taxCategory}</span> : (
                      <select value={line.taxCategory} onChange={(event) => updateLine(index, { taxCategory: event.target.value })} className={SALES_SELECT} aria-label={L('Tax category', 'কর শ্রেণি')}>
                        {['STANDARD_15', 'TRADING_5', 'PROCUREMENT_7_5', 'EXPORT_ZERO', 'EXEMPT', 'OUT_OF_SCOPE'].map((category) => (
                          <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="min-w-[190px]">
                    {isCredit ? <span className="text-[13px] text-ink-700">{line.revenueAccountId ? revenueAccounts.find((account) => account.id === line.revenueAccountId)?.nameEn ?? 'Original account' : 'Original account'}</span> : (
                      <select value={line.revenueAccountId} onChange={(event) => updateLine(index, { revenueAccountId: event.target.value })} className={SALES_SELECT} aria-label={L('Revenue account', 'রাজস্ব হিসাব')}>
                        <option value="">{L('Choose revenue account', 'রাজস্ব হিসাব নির্বাচন করুন')}</option>
                        {revenueAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.code} Â· {account.nameEn}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="min-w-[150px]">
                    {item?.isStockItem && !isCredit ? (
                      <select value={line.warehouseId} onChange={(event) => updateLine(index, { warehouseId: event.target.value })} className={SALES_SELECT} aria-label={L('Warehouse', 'গুদাম')}>
                        <option value="">{L('Choose warehouse', 'গুদাম নির্বাচন করুন')}</option>
                        {refs.warehouses.filter((warehouse) => warehouse.status === 'ACTIVE').map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.code} Â· {warehouse.nameEn}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[13px] text-ink-400">{isCredit ? line.originalLabel ?? 'â€”' : L('No stock movement', 'স্টক মুভমেন্ট নেই')}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} disabled={lines.length <= 1 || isCredit} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-ink-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label={L('Remove line', 'লাইন সরান')}>
                      <Trash2 size={13} /> {L('Remove', 'সরান')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showErrors && fieldErrors.has('lines') ? (
        <p role="alert" className="ql-field-error mt-3">
          {fieldErrors.get('lines')}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ql-border bg-ql-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {!isCredit ? (
          <button type="button" onClick={() => setLines((current) => [...current, blankLine()])} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            <Plus size={15} /> {L('Add line', 'লাইন যোগ')}
          </button>
        ) : <span />}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCancel} className="lv-btn lv-btn-secondary min-h-11 text-[13px]">
            {L('Cancel', 'বাতিল')}
          </button>
          <button type="button" onClick={() => void save()} disabled={loading || loadingOriginal} className="lv-btn lv-btn-primary min-h-11 text-[13px]">
            <Save size={15} /> {loading ? L('Savingâ€¦', 'সংরক্ষণ হচ্ছে…') : L('Save draft and review', 'খসড়া সংরক্ষণ ও পর্যালোচনা')}
          </button>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
        {L(
          'The draft autosaves to the server after required fields are complete. Tax and document totals are calculated by the server; the review screen shows the authoritative amounts before posting.',
          'আবশ্যক ঘর পূরণ হলে খসড়া স্বয়ংক্রিয়ভাবে সার্ভারে সংরক্ষিত হয়। কর ও ডকুমেন্টের মোট সার্ভার গণনা করে; পোস্টের আগে পর্যালোচনা স্ক্রিনে চূড়ান্ত পরিমাণ দেখানো হয়।',
        )}
      </p>
    </section>
  );
}

