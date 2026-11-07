import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Factory,
  FileCheck2,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { inventoryApi, type Mushak43Declaration, type ProductionBatch } from '../../inventory/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { Mushak43PrintModal } from './Mushak43PrintModal';
import type { InventoryRefs } from './inventoryUi';

interface Mushak43PageProps {
  companyId: string;
  refs: InventoryRefs;
  canDispatch?: boolean;
  canOverride?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}

interface NewIngredientState {
  rawItemId: string;
  netQuantity: string;
  wastageBps: number;
  unit: string;
  ratePerUnitBdt: string;
  rebatableInputVat: boolean;
}

export function Mushak43Page({
  companyId,
  refs,
  canDispatch = true,
  canOverride = false,
  refreshKey = 0,
  onChanged,
}: Mushak43PageProps) {
  const { locale } = usePreferences();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);

  const [activeSubTab, setActiveSubTab] = useState<'DECLARATIONS' | 'BATCHES'>('DECLARATIONS');
  const [declarations, setDeclarations] = useState<Mushak43Declaration[]>([]);
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selectedDeclarationForPrint, setSelectedDeclarationForPrint] = useState<Mushak43Declaration | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // New Declaration Form State
  const [selectedFinishedItemId, setSelectedFinishedItemId] = useState('');
  const [outputQuantity, setOutputQuantity] = useState('1.0000');
  const [outputUnit, setOutputUnit] = useState('Pcs');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [nbrDivisionOffice, setNbrDivisionOffice] = useState('');
  const [directLaborBdt, setDirectLaborBdt] = useState('0.00');
  const [overheadBdt, setOverheadBdt] = useState('0.00');
  const [packagingBdt, setPackagingBdt] = useState('0.00');
  const [profitMarginBps, setProfitMarginBps] = useState(1500); // 15%
  const [customRetailPriceBdt, setCustomRetailPriceBdt] = useState('');
  const [ingredients, setIngredients] = useState<NewIngredientState[]>([]);

  // Production Batch Form State
  const [batchDeclarationId, setBatchDeclarationId] = useState('');
  const [batchWarehouseId, setBatchWarehouseId] = useState('');
  const [batchQuantity, setBatchQuantity] = useState('100.0000');
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchNotes, setBatchNotes] = useState('');
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [submittingDecl, setSubmittingDecl] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [declRes, batchRes] = await Promise.all([
        inventoryApi.mushak43List(companyId, { pageSize: 50 }),
        inventoryApi.productionBatches(companyId, { pageSize: 50 }),
      ]);
      setDeclarations(declRes.declarations);
      setBatches(batchRes.batches);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey]);

  // Ingredient Helpers
  const addIngredientRow = () => {
    const defaultRaw = refs.items.find((i) => i.id !== selectedFinishedItemId);
    setIngredients((prev) => [
      ...prev,
      {
        rawItemId: defaultRaw?.id ?? '',
        netQuantity: '1.0000',
        wastageBps: 500, // 5%
        unit: defaultRaw?.unit ?? 'Kg',
        ratePerUnitBdt: '100.00',
        rebatableInputVat: true,
      },
    ]);
  };

  const removeIngredientRow = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const updateIngredientRow = (index: number, patch: Partial<NewIngredientState>) => {
    setIngredients((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const updated = { ...row, ...patch };
        if (patch.rawItemId) {
          const item = refs.items.find((item) => item.id === patch.rawItemId);
          if (item) updated.unit = item.unit;
        }
        return updated;
      }),
    );
  };

  // Calculations for preview in declaration modal
  const computedIngredients = ingredients.map((ing) => {
    const net = parseFloat(ing.netQuantity) || 0;
    const wastage = ing.wastageBps / 10000;
    const gross = net + net * wastage;
    const rate = parseFloat(ing.ratePerUnitBdt) || 0;
    const cost = gross * rate;
    const isAbnormal = ing.wastageBps > 1000; // >10%
    return { gross, cost, isAbnormal };
  });

  const totalRmCostBdt = computedIngredients.reduce((sum, ing) => sum + ing.cost, 0);
  const totalLaborBdt = parseFloat(directLaborBdt) || 0;
  const totalOverheadBdt = parseFloat(overheadBdt) || 0;
  const totalPackagingBdt = parseFloat(packagingBdt) || 0;
  const totalProductionCostBdt = totalRmCostBdt + totalLaborBdt + totalOverheadBdt + totalPackagingBdt;
  const profitBdt = (totalProductionCostBdt * profitMarginBps) / 10000;
  const computedRetailPriceBdt = customRetailPriceBdt ? parseFloat(customRetailPriceBdt) || 0 : totalProductionCostBdt + profitBdt;
  const hasAbnormalWastageAny = computedIngredients.some((i) => i.isAbnormal);

  // Submit Declaration Handler
  const handleCreateDeclaration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFinishedItemId) {
      setError(L('Please select a finished item.', 'দয়া করে একটি উৎপাদিত পণ্য নির্বাচন করুন।'));
      return;
    }
    if (ingredients.length === 0) {
      setError(L('Please add at least one raw material ingredient.', 'অন্তত একটি কাঁচামাল উপকরণ যোগ করুন।'));
      return;
    }

    setSubmittingDecl(true);
    setError(null);
    try {
      await inventoryApi.mushak43Create(companyId, {
        finishedItemId: selectedFinishedItemId,
        outputQuantity,
        outputUnit,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        nbrDivisionOffice: nbrDivisionOffice || null,
        directLaborCostPoisha: Math.round(totalLaborBdt * 100),
        manufacturingOverheadPoisha: Math.round(totalOverheadBdt * 100),
        packagingCostPoisha: Math.round(totalPackagingBdt * 100),
        targetProfitMarginBps: profitMarginBps,
        declaredRetailPricePoisha: Math.round(computedRetailPriceBdt * 100),
        ingredients: ingredients.map((ing) => ({
          rawItemId: ing.rawItemId,
          netQuantity: ing.netQuantity,
          wastageBps: ing.wastageBps,
          unit: ing.unit,
          ratePerUnitPoisha: Math.round((parseFloat(ing.ratePerUnitBdt) || 0) * 100),
          rebatableInputVat: ing.rebatableInputVat,
        })),
      });

      setShowCreateModal(false);
      setSuccessMsg(L('Mushak 4.3 Declaration created successfully.', 'মূসক ৪.৩ সহগ ঘোষণা সফলভাবে তৈরি হয়েছে।'));
      void loadData();
      if (onChanged) onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmittingDecl(false);
    }
  };

  // Submit NBR Handler
  const handleSubmitNbr = async (declarationId: string, approveImmediately: boolean) => {
    setError(null);
    try {
      await inventoryApi.mushak43SubmitNbr(companyId, declarationId, {
        approveImmediately,
      });
      setSuccessMsg(
        approveImmediately
          ? L('Declaration approved by NBR.', 'ঘোষণা এনবিআর কর্তৃক অনুমোদিত হয়েছে।')
          : L('Declaration submitted to NBR Divisional Office.', 'ঘোষণা এনবিআর দপ্তরে দাখিল করা হয়েছে।'),
      );
      void loadData();
      if (onChanged) onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  // Execute Production Batch Handler
  const handleExecuteBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchDeclarationId || !batchWarehouseId) {
      setError(L('Select declaration and warehouse.', 'ঘোষণা এবং ওয়্যারহাউস নির্বাচন করুন।'));
      return;
    }

    setSubmittingBatch(true);
    setError(null);
    try {
      const idempotencyKey = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await inventoryApi.executeBatch(
        companyId,
        {
          declarationId: batchDeclarationId,
          warehouseId: batchWarehouseId,
          batchQuantity,
          batchDate,
          notes: batchNotes || null,
          allowNegativeStock,
          overrideReason: overrideReason || null,
        },
        idempotencyKey,
      );

      setShowBatchModal(false);
      setSuccessMsg(
        L(
          `Production batch ${result.batch.batchNumber} executed. Balanced GL Journal #${result.journalNumber} posted (DR 1320, CR 1310, CR 5210).`,
          `উৎপাদন ব্যাচ ${result.batch.batchNumber} সম্পন্ন হয়েছে। ব্যালেন্সড জিএল জার্নাল #${result.journalNumber} পোস্ট করা হয়েছে (DR ১৩২০, CR ১৩১০, CR ৫২১০)।`,
        ),
      );
      void loadData();
      if (onChanged) onChanged();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSubmittingBatch(false);
    }
  };

  const openPrint = (decl: Mushak43Declaration) => {
    setSelectedDeclarationForPrint(decl);
    setShowPrintModal(true);
  };

  const selectedDeclForBatch = declarations.find((d) => d.id === batchDeclarationId);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {error ? <ErrorBanner message={error} /> : null}
      {successMsg ? (
        <div className="flex items-center justify-between rounded-ql-card border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-[13px] text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {/* Control Banner & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-ql-card border border-ql-border bg-ql-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-ql-control bg-ql-brand/10 text-ql-brand">
            <Factory size={20} />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-ql-ink">
              {L('Manufacturing BOM & Mushak 4.3 Engine', 'ম্যানুফ্যাকচারিং বিওএম ও মূসক ৪.৩ ইঞ্জিন')}
            </h2>
            <p className="text-[12px] text-ql-ink-muted">
              {L(
                'Rule 21 (VAT Rules 2016) Input-Output Coefficients & Section 46(3) Wastage Guardrail with IAS 2 Finished Goods Costing.',
                'বিধি ২১ (মূসক বিধিমালা ২০১৬) ইনপুট-আউটপুট সহগ ও ধারা ৪৬(৩) অপচয় গার্ডরেলসহ আইএএস ২ সমাপ্ত পণ্য খরচায়ন।',
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="ql-btn ql-btn-secondary inline-flex items-center gap-1.5"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {L('Refresh', 'রিফ্রেশ')}
          </button>

          {canDispatch ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSelectedFinishedItemId(refs.items[0]?.id ?? '');
                  setOutputQuantity('1.0000');
                  setOutputUnit(refs.items[0]?.unit ?? 'Pcs');
                  setIngredients([
                    {
                      rawItemId: refs.items[1]?.id ?? refs.items[0]?.id ?? '',
                      netQuantity: '1.0000',
                      wastageBps: 500,
                      unit: refs.items[1]?.unit ?? 'Kg',
                      ratePerUnitBdt: '100.00',
                      rebatableInputVat: true,
                    },
                  ]);
                  setShowCreateModal(true);
                }}
                className="ql-btn ql-btn-secondary inline-flex items-center gap-1.5"
              >
                <Plus size={14} />
                {L('New Mushak 4.3', 'নতুন মূসক ৪.৩')}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (declarations.length === 0) {
                    setError(L('Create a Mushak 4.3 declaration first.', 'প্রথমে একটি মূসক ৪.৩ ঘোষণা তৈরি করুন।'));
                    return;
                  }
                  setBatchDeclarationId(declarations[0]?.id ?? '');
                  setBatchWarehouseId(refs.warehouses[0]?.id ?? '');
                  setShowBatchModal(true);
                }}
                className="ql-btn ql-btn-primary inline-flex items-center gap-1.5"
              >
                <Layers size={14} />
                {L('Execute Production Batch', 'উৎপাদন ব্যাচ সম্পাদন')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ql-card p-4">
          <p className="text-[12px] font-semibold text-ql-ink-muted">
            {L('Active BOM Declarations', 'সক্রিয় বিওএম ঘোষণাসমূহ')}
          </p>
          <p className="mt-1 font-mono text-[22px] font-bold text-ql-ink">
            {declarations.filter((d) => d.status !== 'SUPERSEDED').length}
          </p>
          <p className="mt-1 text-[11px] text-ql-ink-muted">
            {declarations.filter((d) => d.status === 'APPROVED').length} {L('Approved by NBR', 'এনবিআর অনুমোদিত')}
          </p>
        </div>

        <div className="ql-card p-4">
          <p className="text-[12px] font-semibold text-ql-ink-muted">
            {L('Production Batches Run', 'সম্পন্ন উৎপাদন ব্যাচ')}
          </p>
          <p className="mt-1 font-mono text-[22px] font-bold text-ql-brand">
            {batches.filter((b) => b.status === 'COMPLETED').length}
          </p>
          <p className="mt-1 text-[11px] text-ql-ink-muted">
            {L('Balanced IAS 2 GL Journals Posted', 'ব্যালেন্সড আইএএস ২ জার্নাল পোস্ট')}
          </p>
        </div>

        <div className="ql-card p-4">
          <p className="text-[12px] font-semibold text-ql-ink-muted">
            {L('Total Manufactured Value', 'মোট উৎপাদিত পণ্যের মূল্য')}
          </p>
          <p className="mt-1 font-mono text-[20px] font-bold text-emerald-700 dark:text-emerald-400">
            {batches
              .reduce((acc, b) => acc + parseFloat(b.totalCostBdt || '0'), 0)
              .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            BDT
          </p>
          <p className="mt-1 text-[11px] text-ql-ink-muted">
            {L('Debited to Finished Goods 1320', 'ফিনিশড গুডস ১৩২০ এ ডেবিট')}
          </p>
        </div>

        <div className="ql-card p-4">
          <p className="text-[12px] font-semibold text-ql-ink-muted">
            {L('Wastage Clawback (Note 27)', 'অপচয় ভ্যাট বাতিল (নোট ২৭)')}
          </p>
          <p className="mt-1 font-mono text-[20px] font-bold text-amber-700 dark:text-amber-400">
            {batches
              .reduce((acc, b) => acc + parseFloat(b.vatRebateClawbackBdt || '0'), 0)
              .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            BDT
          </p>
          <p className="mt-1 text-[11px] text-ql-ink-muted">
            {L('Section 46(3) >10% Abnormal Wastage', 'ধারা ৪৬(৩) ১০% ঊর্ধ্ব অস্বাভাবিক অপচয়')}
          </p>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-ql-border">
        <button
          type="button"
          onClick={() => setActiveSubTab('DECLARATIONS')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
            activeSubTab === 'DECLARATIONS'
              ? 'border-ql-brand text-ql-brand'
              : 'border-transparent text-ql-ink-muted hover:text-ql-ink'
          }`}
        >
          <Boxes size={15} />
          {L('Mushak 4.3 Declarations', 'মূসক ৪.৩ ঘোষণাসমূহ')} ({declarations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('BATCHES')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
            activeSubTab === 'BATCHES'
              ? 'border-ql-brand text-ql-brand'
              : 'border-transparent text-ql-ink-muted hover:text-ql-ink'
          }`}
        >
          <Layers size={15} />
          {L('Production Batches & WIP', 'উৎপাদন ব্যাচ ও মজুদ')} ({batches.length})
        </button>
      </div>

      {/* Declarations Tab */}
      {activeSubTab === 'DECLARATIONS' ? (
        <div className="ql-card overflow-hidden">
          {declarations.length === 0 ? (
            <div className="p-8 text-center text-ql-ink-muted">
              <Boxes size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-[14px] font-medium">
                {L('No Mushak 4.3 Declarations created yet.', 'এখনো কোনো মূসক ৪.৩ ঘোষণা তৈরি হয়নি।')}
              </p>
              <p className="mt-1 text-[12px]">
                {L(
                  'Declare input-output coefficients and BOM formulas at least 15 days before supply under Rule 21.',
                  'বিধি ২১ অনুযায়ী পণ্য সরবরাহের অন্তত ১৫ দিন আগে ইনপুট-আউটপুট সহগ ঘোষণা দাখিল করুন।',
                )}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="ql-table">
                <thead>
                  <tr>
                    <th>{L('Declaration No.', 'ঘোষণা নং')}</th>
                    <th>{L('Finished Item', 'উৎপাদিত পণ্য')}</th>
                    <th>{L('Output Unit', 'সরবরাহ একক')}</th>
                    <th>{L('RM Cost (BDT)', 'কাঁচামাল ব্যয়')}</th>
                    <th>{L('Labor + Overhead', 'শ্রম ও উপরি ব্যয়')}</th>
                    <th>{L('Total Cost', 'মোট উৎপাদন ব্যয়')}</th>
                    <th>{L('Declared Price', 'ঘোষিত মূল্য')}</th>
                    <th>{L('Status', 'অবস্থা')}</th>
                    <th>{L('Effective From', 'কার্যকর তারিখ')}</th>
                    <th className="text-right">{L('Actions', 'পদক্ষেপ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.map((decl) => {
                    const laborAndOverhead = (
                      parseFloat(decl.directLaborCostBdt) +
                      parseFloat(decl.manufacturingOverheadBdt) +
                      parseFloat(decl.packagingCostBdt)
                    ).toFixed(2);

                    return (
                      <tr key={decl.id}>
                        <td className="font-mono font-bold text-ql-brand">{decl.declarationNumber}</td>
                        <td>
                          <div className="font-semibold text-ql-ink">{decl.finishedItemName}</div>
                          <div className="font-mono text-[11px] text-ql-ink-muted">{decl.finishedItemSku}</div>
                        </td>
                        <td>
                          {decl.outputQuantity} {decl.outputUnit}
                        </td>
                        <td className="font-mono font-medium">{decl.totalRawMaterialCostBdt}</td>
                        <td className="font-mono">{laborAndOverhead}</td>
                        <td className="font-mono font-bold text-ql-ink">{decl.totalCostOfProductionBdt}</td>
                        <td className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {decl.declaredRetailPriceBdt}
                        </td>
                        <td>
                          <span
                            className={`ql-badge ${
                              decl.status === 'APPROVED'
                                ? 'ql-badge-success'
                                : decl.status === 'SUBMITTED_TO_NBR'
                                  ? 'ql-badge-brand'
                                  : 'ql-badge-neutral'
                            }`}
                          >
                            {decl.status}
                          </span>
                          {decl.hasAbnormalWastage ? (
                            <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                              <AlertTriangle size={10} /> &gt;10%
                            </span>
                          ) : null}
                        </td>
                        <td className="font-mono text-[12px]">{decl.effectiveFrom}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openPrint(decl)}
                              className="ql-btn ql-btn-secondary !p-1.5 text-[11px]"
                              title={L('Print Mushak 4.3 Form', 'মূসক ৪.৩ ফর্ম প্রিন্ট করুন')}
                            >
                              <Printer size={13} />
                            </button>

                            {decl.status === 'DRAFT' && canDispatch ? (
                              <button
                                type="button"
                                onClick={() => void handleSubmitNbr(decl.id, true)}
                                className="ql-btn ql-btn-primary !px-2 !py-1 text-[11px]"
                                title={L('Submit and Approve', 'দাখিল ও অনুমোদন করুন')}
                              >
                                <Send size={12} className="mr-1" />
                                {L('Approve', 'অনুমোদন')}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* Production Batches Tab */}
      {activeSubTab === 'BATCHES' ? (
        <div className="ql-card overflow-hidden">
          {batches.length === 0 ? (
            <div className="p-8 text-center text-ql-ink-muted">
              <Layers size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-[14px] font-medium">
                {L('No Production Batches executed yet.', 'এখনো কোনো উৎপাদন ব্যাচ সম্পন্ন হয়নি।')}
              </p>
              <p className="mt-1 text-[12px]">
                {L(
                  'Executing a batch deducts raw materials (1310), adds finished goods (1320), and posts balanced GL journals.',
                  'ব্যাচ সম্পাদন করলে কাঁচামাল (১৩১০) হ্রাস পায়, ফিনিশড গুডস (১৩২০) বৃদ্ধি পায় এবং স্বয়ংক্রিয় জিএল জার্নাল পোস্ট হয়।',
                )}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="ql-table">
                <thead>
                  <tr>
                    <th>{L('Batch No.', 'ব্যাচ নং')}</th>
                    <th>{L('Date', 'তারিখ')}</th>
                    <th>{L('Finished Item', 'উৎপাদিত পণ্য')}</th>
                    <th>{L('Warehouse', 'ওয়্যারহাউস')}</th>
                    <th>{L('Quantity', 'পরিমাণ')}</th>
                    <th>{L('Total Cost (BDT)', 'মোট খরচ')}</th>
                    <th>{L('Unit Cost (BDT)', 'একক খরচ')}</th>
                    <th>{L('Wastage Clawback', 'অপচয় সমন্বয়')}</th>
                    <th>{L('GL Journal', 'জিএল জার্নাল')}</th>
                    <th>{L('Status', 'অবস্থা')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td className="font-mono font-bold text-ql-brand">{batch.batchNumber}</td>
                      <td className="font-mono text-[12px]">{batch.batchDate}</td>
                      <td>
                        <div className="font-semibold text-ql-ink">{batch.finishedItemName}</div>
                        <div className="font-mono text-[11px] text-ql-ink-muted">{batch.finishedItemSku}</div>
                      </td>
                      <td>
                        <span className="font-mono">{batch.warehouseCode}</span>
                      </td>
                      <td className="font-mono font-bold">{batch.batchQuantity}</td>
                      <td className="font-mono font-bold text-ql-ink">{batch.totalCostBdt}</td>
                      <td className="font-mono text-ql-ink-muted">{batch.unitCostBdt}</td>
                      <td>
                        {batch.hasAbnormalWastage ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                            <AlertTriangle size={12} />
                            {batch.vatRebateClawbackBdt} BDT
                          </span>
                        ) : (
                          <span className="text-[11px] text-ql-ink-muted">{L('Normal (≤10%)', 'স্বাভাবিক (≤১০%)')}</span>
                        )}
                      </td>
                      <td>
                        {batch.journalNumber ? (
                          <span className="font-mono text-[12px] font-semibold text-ql-brand">
                            #{batch.journalNumber}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="ql-badge ql-badge-success">{batch.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* Modal 1: Create Mushak 4.3 Declaration */}
      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-ql-card border border-ql-border bg-ql-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-ql-border pb-3">
              <div>
                <h3 className="text-[16px] font-bold text-ql-ink">
                  {L('Compose Mushak 4.3 BOM Declaration', 'মূসক ৪.৩ সহগ ঘোষণা প্রণয়ন')}
                </h3>
                <p className="text-[12px] text-ql-ink-muted">
                  {L('NBR Rule 21, VAT Rules 2016 Specification', 'জাতীয় রাজস্ব বোর্ড বিধি ২১, মূসক বিধিমালা ২০১৬')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-ql-ink-muted hover:text-ql-ink"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateDeclaration} className="mt-4 space-y-4">
              {/* Finished Good Fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Finished Item', 'উৎপাদিত পণ্য')}
                  </label>
                  <select
                    value={selectedFinishedItemId}
                    onChange={(e) => {
                      setSelectedFinishedItemId(e.target.value);
                      const itm = refs.items.find((i) => i.id === e.target.value);
                      if (itm) setOutputUnit(itm.unit);
                    }}
                    required
                    className="ql-input mt-1 w-full"
                  >
                    {refs.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nameEn} ({i.sku})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Output Quantity', 'ঘোষিত উৎপাদন পরিমাণ')}
                  </label>
                  <input
                    type="text"
                    value={outputQuantity}
                    onChange={(e) => setOutputQuantity(e.target.value)}
                    required
                    className="ql-input mt-1 w-full font-mono"
                    placeholder="1.0000"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Output Unit', 'পরিমাপের একক')}
                  </label>
                  <input
                    type="text"
                    value={outputUnit}
                    onChange={(e) => setOutputUnit(e.target.value)}
                    required
                    className="ql-input mt-1 w-full"
                    placeholder="Pcs / Kg / Mtr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Effective From', 'কার্যকর তারিখ')}
                  </label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    required
                    className="ql-input mt-1 w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Effective To (Optional)', 'মেয়াদ উত্তীর্ণের তারিখ (ঐচ্ছিক)')}
                  </label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="ql-input mt-1 w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('NBR Division Office', 'এনবিআর বিভাগীয় দপ্তর')}
                  </label>
                  <input
                    type="text"
                    value={nbrDivisionOffice}
                    onChange={(e) => setNbrDivisionOffice(e.target.value)}
                    className="ql-input mt-1 w-full"
                    placeholder="e.g. Customs, Excise & VAT Commissionerate, Dhaka"
                  />
                </div>
              </div>

              {/* Dynamic BOM Table */}
              <div className="space-y-2 rounded-ql-card border border-ql-border bg-ql-surface-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-bold text-ql-ink">
                    {L('Raw Material Ingredients (BOM Lines)', 'কাঁচামাল ও উপকরণের তালিকা (বিওএম)')}
                  </h4>
                  <button
                    type="button"
                    onClick={addIngredientRow}
                    className="ql-btn ql-btn-secondary !py-1 !text-[11px]"
                  >
                    <Plus size={12} className="mr-1" />
                    {L('Add Raw Material', 'উপকরণ যোগ করুন')}
                  </button>
                </div>

                {hasAbnormalWastageAny ? (
                  <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                    <AlertTriangle size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      {L(
                        'Section 46(3) Guardrail: One or more raw materials have wastage >10.00%. Abnormal wastage triggers Input VAT rebate clawback in Mushak 9.1 Part 5 Note 27.',
                        'ধারা ৪৬(৩) গার্ডরেল: এক বা একাধিক কাঁচামালে অপচয় ১০% এর বেশি। অস্বাভাবিক অপচয়ের ক্ষেত্রে মূসক ৯.১ এর অংশ ৫ নোট ২৭ অনুযায়ী ভ্যাট রিবেট বাতিল প্রযোজ্য হবে।',
                      )}
                    </span>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-ql-border text-[11px] font-bold text-ql-ink-muted">
                        <th className="py-1.5">{L('Raw Material', 'কাঁচামাল')}</th>
                        <th className="py-1.5">{L('Net Qty', 'নিট পরিমাণ')}</th>
                        <th className="py-1.5">{L('Wastage %', 'অপচয় %')}</th>
                        <th className="py-1.5">{L('Gross Qty', 'মোট পরিমাণ')}</th>
                        <th className="py-1.5">{L('Rate (BDT)', 'দর')}</th>
                        <th className="py-1.5">{L('Cost (BDT)', 'মোট ব্যয়')}</th>
                        <th className="py-1.5 text-center">{L('Rebate', 'রিবেট')}</th>
                        <th className="py-1.5 text-right">{L('Remove', 'মুছুন')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ql-border">
                      {ingredients.map((ing, idx) => {
                        const comp = computedIngredients[idx];
                        return (
                          <tr key={idx} className={comp?.isAbnormal ? 'bg-amber-500/5' : ''}>
                            <td className="py-1.5">
                              <select
                                value={ing.rawItemId}
                                onChange={(e) => updateIngredientRow(idx, { rawItemId: e.target.value })}
                                className="ql-input !py-1 text-[12px]"
                              >
                                {refs.items.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.nameEn} ({item.sku})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1.5">
                              <input
                                type="text"
                                value={ing.netQuantity}
                                onChange={(e) => updateIngredientRow(idx, { netQuantity: e.target.value })}
                                className="ql-input !w-20 !py-1 font-mono text-[12px]"
                              />
                            </td>
                            <td className="py-1.5">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                value={(ing.wastageBps / 100).toString()}
                                onChange={(e) =>
                                  updateIngredientRow(idx, { wastageBps: Math.round(parseFloat(e.target.value || '0') * 100) })
                                }
                                className={`ql-input !w-16 !py-1 font-mono text-[12px] ${
                                  comp?.isAbnormal ? 'border-amber-500 text-amber-700' : ''
                                }`}
                              />
                            </td>
                            <td className="py-1.5 font-mono text-[12px] font-semibold">
                              {comp?.gross.toFixed(4)} {ing.unit}
                            </td>
                            <td className="py-1.5">
                              <input
                                type="text"
                                value={ing.ratePerUnitBdt}
                                onChange={(e) => updateIngredientRow(idx, { ratePerUnitBdt: e.target.value })}
                                className="ql-input !w-20 !py-1 font-mono text-[12px]"
                              />
                            </td>
                            <td className="py-1.5 font-mono font-bold text-ql-ink">
                              {comp?.cost.toFixed(2)}
                            </td>
                            <td className="py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={ing.rebatableInputVat}
                                onChange={(e) => updateIngredientRow(idx, { rebatableInputVat: e.target.checked })}
                                className="rounded border-ql-border"
                              />
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => removeIngredientRow(idx)}
                                className="text-rose-600 hover:text-rose-800"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Overheads & Profit Margin */}
              <div className="grid grid-cols-2 gap-4 rounded-ql-card border border-ql-border p-3 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-semibold text-ql-ink-muted">
                    {L('Direct Labor (BDT)', 'প্রত্যক্ষ শ্রম (টাকা)')}
                  </label>
                  <input
                    type="text"
                    value={directLaborBdt}
                    onChange={(e) => setDirectLaborBdt(e.target.value)}
                    className="ql-input mt-1 w-full font-mono text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-ql-ink-muted">
                    {L('Mfg Overhead (BDT)', 'কারখানা উপরি ব্যয়')}
                  </label>
                  <input
                    type="text"
                    value={overheadBdt}
                    onChange={(e) => setOverheadBdt(e.target.value)}
                    className="ql-input mt-1 w-full font-mono text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-ql-ink-muted">
                    {L('Packaging Cost (BDT)', 'প্যাকিং খরচ')}
                  </label>
                  <input
                    type="text"
                    value={packagingBdt}
                    onChange={(e) => setPackagingBdt(e.target.value)}
                    className="ql-input mt-1 w-full font-mono text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-ql-ink-muted">
                    {L('Target Profit %', 'প্রত্যাশিত মুনাফা %')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={(profitMarginBps / 100).toString()}
                    onChange={(e) => setProfitMarginBps(Math.round(parseFloat(e.target.value || '0') * 100))}
                    className="ql-input mt-1 w-full font-mono text-[13px]"
                  />
                </div>
              </div>

              {/* Cost Summary Preview */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-ql-card border border-ql-border bg-ql-brand/5 p-4">
                <div>
                  <span className="text-[12px] text-ql-ink-muted">{L('Total Production Cost: ', 'মোট উৎপাদন ব্যয়: ')}</span>
                  <span className="font-mono text-[16px] font-bold text-ql-ink">
                    {totalProductionCostBdt.toFixed(2)} BDT
                  </span>
                </div>
                <div>
                  <span className="text-[12px] text-ql-ink-muted">{L('Target Retail Price: ', 'প্রত্যাশিত সরবরাহ মূল্য: ')}</span>
                  <span className="font-mono text-[18px] font-bold text-emerald-700 dark:text-emerald-400">
                    {computedRetailPriceBdt.toFixed(2)} BDT
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-ql-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="ql-btn ql-btn-secondary"
                  disabled={submittingDecl}
                >
                  {L('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  className="ql-btn ql-btn-primary"
                  disabled={submittingDecl}
                >
                  {submittingDecl ? L('Creating BOM…', 'বিওএম তৈরি হচ্ছে…') : L('Create Mushak 4.3 Declaration', 'ঘোষণা সংরক্ষণ করুন')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal 2: Execute Production Batch */}
      {showBatchModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-ql-card border border-ql-border bg-ql-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-ql-border pb-3">
              <div>
                <h3 className="text-[16px] font-bold text-ql-ink">
                  {L('Execute Production Batch (IAS 2 Costing)', 'উৎপাদন ব্যাচ সম্পাদন (আইএএস ২)')}
                </h3>
                <p className="text-[12px] text-ql-ink-muted">
                  {L(
                    'Deducts raw materials (1310), increases finished goods (1320), posts balanced journal.',
                    'কাঁচামাল হ্রাস (১৩১০), সমাপ্ত পণ্য বৃদ্ধি (১৩২০) ও স্বয়ংক্রিয় সুষম জার্নাল পোস্ট।',
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="text-ql-ink-muted hover:text-ql-ink"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleExecuteBatch} className="mt-4 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-ql-ink">
                  {L('Mushak 4.3 Declaration (BOM)', 'মূসক ৪.৩ সহগ ঘোষণা (বিওএম)')}
                </label>
                <select
                  value={batchDeclarationId}
                  onChange={(e) => setBatchDeclarationId(e.target.value)}
                  required
                  className="ql-input mt-1 w-full"
                >
                  {declarations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.declarationNumber} — {d.finishedItemName} ({d.finishedItemSku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Production Warehouse', 'উৎপাদন ওয়্যারহাউস')}
                  </label>
                  <select
                    value={batchWarehouseId}
                    onChange={(e) => setBatchWarehouseId(e.target.value)}
                    required
                    className="ql-input mt-1 w-full"
                  >
                    {refs.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameEn} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-ql-ink">
                    {L('Batch Production Date', 'ব্যাচ উৎপাদনের তারিখ')}
                  </label>
                  <input
                    type="date"
                    value={batchDate}
                    onChange={(e) => setBatchDate(e.target.value)}
                    required
                    className="ql-input mt-1 w-full font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ql-ink">
                  {L('Batch Output Quantity', 'উৎপাদন পরিমাণ')} ({selectedDeclForBatch?.outputUnit ?? 'Units'})
                </label>
                <input
                  type="text"
                  value={batchQuantity}
                  onChange={(e) => setBatchQuantity(e.target.value)}
                  required
                  className="ql-input mt-1 w-full font-mono text-[14px]"
                  placeholder="100.0000"
                />
              </div>

              {selectedDeclForBatch?.hasAbnormalWastage ? (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-900 dark:text-amber-200">
                  <p className="font-bold">
                    {L(
                      '⚠️ Section 46(3) Statutory Notice: Abnormal Wastage Active',
                      '⚠️ ধারা ৪৬(৩) সংবিধিবদ্ধ বিজ্ঞপ্তি: অস্বাভাবিক অপচয় সক্রিয়',
                    )}
                  </p>
                  <p className="mt-0.5">
                    {L(
                      'This BOM contains >10.00% wastage. Executing this batch will calculate and report the required Input VAT rebate clawback under Mushak 9.1 Part 5 Note 27.',
                      'এই বিওএম-এ ১০.০০% এর অধিক অপচয় রয়েছে। ব্যাচ সম্পন্ন হলে মূসক ৯.১ এর অংশ-৫ নোট ২৭ অনুযায়ী রিবেট বাতিল রেকর্ড হবে।',
                    )}
                  </p>
                </div>
              ) : null}

              {canOverride ? (
                <div className="space-y-2 rounded border border-ql-border p-3 text-[12px]">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allowNegativeStock}
                      onChange={(e) => setAllowNegativeStock(e.target.checked)}
                      className="rounded border-ql-border"
                    />
                    <span className="font-semibold text-ql-ink">
                      {L('Allow Negative Stock (Controller Override)', 'নেগেটিভ স্টক অনুমোদন (নিয়ন্ত্রক ব্যতিক্রম)')}
                    </span>
                  </label>
                  {allowNegativeStock ? (
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      required
                      className="ql-input w-full text-[12px]"
                      placeholder={L('Reason for negative stock override', 'নেগেটিভ স্টক অনুমোদনের কারণ লিখুন')}
                    />
                  ) : null}
                </div>
              ) : null}

              <div>
                <label className="block text-[12px] font-semibold text-ql-ink-muted">
                  {L('Notes / Batch Ref (Optional)', 'মন্তব্য / ব্যাচ নোট (ঐচ্ছিক)')}
                </label>
                <input
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  className="ql-input mt-1 w-full"
                  placeholder="e.g. Morning Shift Run #4"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-ql-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="ql-btn ql-btn-secondary"
                  disabled={submittingBatch}
                >
                  {L('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  className="ql-btn ql-btn-primary"
                  disabled={submittingBatch}
                >
                  {submittingBatch ? L('Executing Batch…', 'ব্যাচ সম্পন্ন হচ্ছে…') : L('Execute Batch & Post GL', 'ব্যাচ সম্পাদন ও জিএল পোস্ট')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Statutory Print Modal */}
      {showPrintModal && selectedDeclarationForPrint ? (
        <Mushak43PrintModal
          open={showPrintModal}
          onClose={() => {
            setShowPrintModal(false);
            setSelectedDeclarationForPrint(null);
          }}
          mushak43={selectedDeclarationForPrint}
        />
      ) : null}
    </div>
  );
}

export default Mushak43Page;
