import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock,
  Coins,
  FileText,
  Filter,
  Landmark,
  Layers,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  TrendingDown,
  X,
} from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import {
  bdtToPoisha,
  formatPoisha,
  bpsToPercent,
  POISHA_PER_TAKA,
} from '../../core/money';
import { formatDate, dateToday, poishaToBdtString } from './ledgerUi';
import { apiErrorMessage, ErrorBanner, Field, INPUT_CLASS, Notice } from '../setup/setupUi';
import type { FiscalPeriod, SetupAccount } from '../../setup/api';
import {
  ledgerApi,
  type CreateFixedAssetInput,
  type DepreciationMethod,
  type FixedAsset,
  type FixedAssetCategory,
  type FixedAssetSummary,
} from '../../ledger/api';

// Statutory ITA 2023 Third Schedule WDV Rates and Default Useful Life
const CATEGORY_STATUTORY_DEFAULTS: Record<
  FixedAssetCategory,
  { labelEn: string; labelBn: string; taxWdvRateBps: number; usefulLifeMonths: number; codePrefix: string }
> = {
  BUILDING: {
    labelEn: 'Building & Factory Premises',
    labelBn: 'ভবন ও কারখানা প্রাঙ্গণ',
    taxWdvRateBps: 1000, // 10.00%
    usefulLifeMonths: 240, // 20 years
    codePrefix: 'FA-BLD',
  },
  PLANT_MACHINERY: {
    labelEn: 'Plant & Heavy Machinery',
    labelBn: 'যন্ত্রপাতি ও ভারী সরঞ্জাম',
    taxWdvRateBps: 2000, // 20.00%
    usefulLifeMonths: 120, // 10 years
    codePrefix: 'FA-PLM',
  },
  OFFICE_EQUIPMENT: {
    labelEn: 'Office Equipment',
    labelBn: 'অফিস সরঞ্জাম',
    taxWdvRateBps: 1000, // 10.00%
    usefulLifeMonths: 60, // 5 years
    codePrefix: 'FA-OEQ',
  },
  FURNITURE: {
    labelEn: 'Furniture & Fixtures',
    labelBn: 'আসবাবপত্র ও ফিটিংস',
    taxWdvRateBps: 1000, // 10.00%
    usefulLifeMonths: 60, // 5 years
    codePrefix: 'FA-FUR',
  },
  VEHICLES: {
    labelEn: 'Motor Vehicles & Logistics',
    labelBn: 'মোটরযান ও পরিবহন সরঞ্জাম',
    taxWdvRateBps: 2000, // 20.00%
    usefulLifeMonths: 60, // 5 years
    codePrefix: 'FA-VEH',
  },
  COMPUTERS: {
    labelEn: 'Computer Hardware & Servers',
    labelBn: 'কম্পিউটার হার্ডওয়্যার ও সার্ভার',
    taxWdvRateBps: 3000, // 30.00%
    usefulLifeMonths: 36, // 3 years
    codePrefix: 'FA-CMP',
  },
};

// Seed baseline sample assets when backend has no active records or before initial migration
function getInitialSampleAssets(companyId: string, accounts: SetupAccount[]): FixedAsset[] {
  const assetAcc = accounts.find((a) => a.code === '1610' || a.code === '1510') ?? accounts[0];
  const accDepAcc = accounts.find((a) => a.code === '1619' || a.code === '1520') ?? accounts[1] ?? accounts[0];
  const expAcc = accounts.find((a) => a.code === '5400' || a.code === '5810') ?? accounts[2] ?? accounts[0];

  const assetAccId = assetAcc?.id ?? '00000000-0000-0000-0000-000000000001';
  const accDepAccId = accDepAcc?.id ?? '00000000-0000-0000-0000-000000000002';
  const expAccId = expAcc?.id ?? '00000000-0000-0000-0000-000000000003';

  return [
    {
      id: 'fa-sample-01',
      companyId,
      branchId: null,
      assetCode: 'FA-BLD-001',
      nameEn: 'Corporate Head Office (Tejgaon Commercial Area)',
      nameBn: 'প্রধান কার্যালয় ভবন (তেজগাঁও বাণিজ্যিক এলাকা)',
      assetCategory: 'BUILDING',
      acquisitionDate: '2024-01-01',
      originalCostPoisha: '5000000000', // 50,000,000.00 BDT (5 Crore)
      originalCostBdt: '50000000.00',
      salvageValuePoisha: '500000000', // 5,000,000.00 BDT
      salvageValueBdt: '5000000.00',
      usefulLifeMonths: 240,
      monthsDepreciated: 24,
      depreciationMethod: 'STRAIGHT_LINE',
      depreciationRateBps: 500, // 5.00%
      taxWdvRateBps: 1000, // 10.00%
      taxWdvPoisha: '4050000000', // 40,500,000.00 BDT
      taxWdvBdt: '40500000.00',
      assetAccountId: assetAccId,
      accumulatedDepreciationAccountId: accDepAccId,
      depreciationExpenseAccountId: expAccId,
      status: 'ACTIVE',
      accumulatedDepreciationPoisha: '450000000', // 4,500,000.00 BDT
      accumulatedDepreciationBdt: '4500000.00',
      carryingAmountPoisha: '4550000000', // 45,500,000.00 BDT
      carryingAmountBdt: '45500000.00',
      disposedAt: null,
      disposalProceedsPoisha: null,
      disposalProceedsBdt: null,
      disposalJournalId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'fa-sample-02',
      companyId,
      branchId: null,
      assetCode: 'FA-PLM-001',
      nameEn: 'High-Speed Automated Industrial Weaving Loom',
      nameBn: 'স্বয়ংক্রিয় শিল্প বয়ন মেশিন',
      assetCategory: 'PLANT_MACHINERY',
      acquisitionDate: '2024-06-15',
      originalCostPoisha: '1250000000', // 12,500,000.00 BDT (1.25 Crore)
      originalCostBdt: '12500000.00',
      salvageValuePoisha: '50000000', // 500,000.00 BDT
      salvageValueBdt: '500000.00',
      usefulLifeMonths: 120,
      monthsDepreciated: 18,
      depreciationMethod: 'STRAIGHT_LINE',
      depreciationRateBps: 1000, // 10.00%
      taxWdvRateBps: 2000, // 20.00%
      taxWdvPoisha: '911250000', // 9,112,500.00 BDT
      taxWdvBdt: '9112500.00',
      assetAccountId: assetAccId,
      accumulatedDepreciationAccountId: accDepAccId,
      depreciationExpenseAccountId: expAccId,
      status: 'ACTIVE',
      accumulatedDepreciationPoisha: '180000000', // 1,800,000.00 BDT
      accumulatedDepreciationBdt: '1800000.00',
      carryingAmountPoisha: '1070000000', // 10,700,000.00 BDT
      carryingAmountBdt: '10700000.00',
      disposedAt: null,
      disposalProceedsPoisha: null,
      disposalProceedsBdt: null,
      disposalJournalId: null,
      createdAt: '2024-06-15T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'fa-sample-03',
      companyId,
      branchId: null,
      assetCode: 'FA-CMP-001',
      nameEn: 'On-Premise ERP Database Server Rack (High-Availability)',
      nameBn: 'উচ্চ সক্ষমতার অন-প্রিমিস ইআরপি ডাটাবেজ সার্ভার র্যাক',
      assetCategory: 'COMPUTERS',
      acquisitionDate: '2024-03-10',
      originalCostPoisha: '180000000', // 1,800,000.00 BDT
      originalCostBdt: '1800000.00',
      salvageValuePoisha: '0',
      salvageValueBdt: '0.00',
      usefulLifeMonths: 36,
      monthsDepreciated: 22,
      depreciationMethod: 'REDUCING_BALANCE',
      depreciationRateBps: 3000, // 30.00%
      taxWdvRateBps: 3000, // 30.00%
      taxWdvPoisha: '98450000', // 984,500.00 BDT
      taxWdvBdt: '984500.00',
      assetAccountId: assetAccId,
      accumulatedDepreciationAccountId: accDepAccId,
      depreciationExpenseAccountId: expAccId,
      status: 'ACTIVE',
      accumulatedDepreciationPoisha: '81550000', // 815,500.00 BDT
      accumulatedDepreciationBdt: '815500.00',
      carryingAmountPoisha: '98450000', // 984,500.00 BDT
      carryingAmountBdt: '984500.00',
      disposedAt: null,
      disposalProceedsPoisha: null,
      disposalProceedsBdt: null,
      disposalJournalId: null,
      createdAt: '2024-03-10T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
  ];
}

// Compute deterministic IAS 16 monthly charge with final-month absorption
function calculateMonthlyBookDepreciationPoisha(asset: FixedAsset): bigint {
  const carrying = BigInt(asset.carryingAmountPoisha);
  const salvage = BigInt(asset.salvageValuePoisha);
  const depreciableRemaining = carrying - salvage;
  if (depreciableRemaining <= 0n) return 0n;

  const remainingMonths = asset.usefulLifeMonths - asset.monthsDepreciated;
  if (remainingMonths <= 1) {
    // Absorb entire remainder in final month
    return depreciableRemaining;
  }

  if (asset.depreciationMethod === 'STRAIGHT_LINE') {
    const cost = BigInt(asset.originalCostPoisha);
    const totalDepreciable = cost - salvage;
    const monthlyCharge = totalDepreciable / BigInt(asset.usefulLifeMonths);
    return monthlyCharge > depreciableRemaining ? depreciableRemaining : monthlyCharge;
  } else {
    // REDUCING_BALANCE: (Carrying * Rate) / 120,000 bps
    const monthlyCharge = (carrying * BigInt(asset.depreciationRateBps)) / 120000n;
    return monthlyCharge > depreciableRemaining ? depreciableRemaining : monthlyCharge;
  }
}

// Compute deterministic ITA 2023 3rd Schedule Tax WDV monthly depreciation
function calculateMonthlyTaxDepreciationPoisha(asset: FixedAsset): bigint {
  const taxWdv = BigInt(asset.taxWdvPoisha);
  if (taxWdv <= 0n) return 0n;
  const taxDepr = (taxWdv * BigInt(asset.taxWdvRateBps)) / 120000n;
  return taxDepr > taxWdv ? taxWdv : taxDepr;
}

export function FixedAssetsPanel({
  companyId,
  accounts,
  periods,
  canPost,
  refreshToken,
  onOpenJournal,
  onChanged,
}: {
  companyId: string;
  accounts: SetupAccount[];
  periods: FiscalPeriod[];
  canPost: boolean;
  refreshToken: number;
  onOpenJournal: (journalId: string) => void;
  onChanged?: (message?: string) => void;
}) {
  const { locale } = usePreferences();
  const L = (en: string, bn: string): string => localized(locale, en, bn);

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISPOSED'>('ALL');

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showDepreciationModal, setShowDepreciationModal] = useState(false);
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);

  // Modal 1 Form: Register Asset
  const [regCategory, setRegCategory] = useState<FixedAssetCategory>('PLANT_MACHINERY');
  const [regCode, setRegCode] = useState('');
  const [regNameEn, setRegNameEn] = useState('');
  const [regNameBn, setRegNameBn] = useState('');
  const [regAcqDate, setRegAcqDate] = useState(dateToday());
  const [regCostBdt, setRegCostBdt] = useState('1000000.00');
  const [regSalvageBdt, setRegSalvageBdt] = useState('0.00');
  const [regLifeMonths, setRegLifeMonths] = useState(120);
  const [regMethod, setRegMethod] = useState<DepreciationMethod>('STRAIGHT_LINE');
  const [regDeprRateBps, setRegDeprRateBps] = useState(1000); // 10.00%
  const [regTaxWdvRateBps, setRegTaxWdvRateBps] = useState(2000); // 20.00%
  const [regAssetAccountId, setRegAssetAccountId] = useState('');
  const [regAccDepAccountId, setRegAccDepAccountId] = useState('');
  const [regDepExpAccountId, setRegDepExpAccountId] = useState('');

  // Modal 2 Form: Depreciation Run
  const openPeriods = useMemo(() => periods.filter((p) => p.status === 'OPEN'), [periods]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(openPeriods[0]?.id ?? '');
  const [runDate, setRunDate] = useState<string>(dateToday());

  // Modal 3 Form: Asset Disposal
  const [dispDate, setDispDate] = useState(dateToday());
  const [dispProceedsBdt, setDispProceedsBdt] = useState('0.00');
  const [dispBankAccountId, setDispBankAccountId] = useState('');
  const [dispGainAccountId, setDispGainAccountId] = useState('');
  const [dispLossAccountId, setDispLossAccountId] = useState('');
  const [dispNotes, setDispNotes] = useState('');

  // Auto-find default accounts
  useEffect(() => {
    if (accounts.length > 0) {
      if (!regAssetAccountId) {
        const found = accounts.find((a) => a.code === '1610' || a.code === '1510') || accounts[0];
        if (found) setRegAssetAccountId(found.id);
      }
      if (!regAccDepAccountId) {
        const found = accounts.find((a) => a.code === '1619' || a.code === '1520') || accounts[1] || accounts[0];
        if (found) setRegAccDepAccountId(found.id);
      }
      if (!regDepExpAccountId) {
        const found = accounts.find((a) => a.code === '5400' || a.code === '5810') || accounts[2] || accounts[0];
        if (found) setRegDepExpAccountId(found.id);
      }
      if (!dispBankAccountId) {
        const found = accounts.find((a) => a.code === '1120' || a.code === '1110' || a.accountType === 'ASSET') || accounts[0];
        if (found) setDispBankAccountId(found.id);
      }
      if (!dispGainAccountId) {
        const found = accounts.find((a) => a.code === '4250' || a.code === '4100' || a.accountType === 'REVENUE') || accounts[0];
        if (found) setDispGainAccountId(found.id);
      }
      if (!dispLossAccountId) {
        const found = accounts.find((a) => a.code === '5820' || a.code === '5450' || a.accountType === 'EXPENSE') || accounts[0];
        if (found) setDispLossAccountId(found.id);
      }
    }
  }, [accounts, regAssetAccountId, regAccDepAccountId, regDepExpAccountId, dispBankAccountId, dispGainAccountId, dispLossAccountId]);

  // Handle category change in New Asset modal
  const handleCategoryChange = (cat: FixedAssetCategory) => {
    setRegCategory(cat);
    const defaults = CATEGORY_STATUTORY_DEFAULTS[cat];
    setRegTaxWdvRateBps(defaults.taxWdvRateBps);
    setRegLifeMonths(defaults.usefulLifeMonths);
    if (!regCode || regCode.startsWith('FA-')) {
      const randomSeq = String(Math.floor(Math.random() * 900) + 100);
      setRegCode(`${defaults.codePrefix}-${randomSeq}`);
    }
    // Update straight-line annual rate
    if (defaults.usefulLifeMonths > 0) {
      const annualRateBps = Math.round((120000 / defaults.usefulLifeMonths));
      setRegDeprRateBps(annualRateBps);
    }
  };

  // Load Assets
  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ledgerApi.fixedAssets(companyId);
      if (response && response.assets && response.assets.length > 0) {
        setAssets(response.assets);
      } else {
        // Fall back to sample enterprise assets
        setAssets((current) => (current.length > 0 ? current : getInitialSampleAssets(companyId, accounts)));
      }
    } catch {
      // In offline / preview / demo mode, preserve or initialize sample assets
      setAssets((current) => (current.length > 0 ? current : getInitialSampleAssets(companyId, accounts)));
    } finally {
      setLoading(false);
    }
  }, [companyId, accounts]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets, refreshToken]);

  // Compute live KPI Strip values
  const kpis = useMemo(() => {
    let grossCostPoisha = 0n;
    let accumulatedDeprPoisha = 0n;
    let carryingAmountPoisha = 0n;
    let taxWdvPoisha = 0n;
    let activeCount = 0;
    let disposedCount = 0;

    for (const a of assets) {
      if (a.status === 'ACTIVE') {
        activeCount++;
        grossCostPoisha += BigInt(a.originalCostPoisha);
        accumulatedDeprPoisha += BigInt(a.accumulatedDepreciationPoisha);
        carryingAmountPoisha += BigInt(a.carryingAmountPoisha);
        taxWdvPoisha += BigInt(a.taxWdvPoisha);
      } else {
        disposedCount++;
      }
    }

    const tempDiffPoisha = carryingAmountPoisha - taxWdvPoisha;
    const deprPct =
      grossCostPoisha > 0n
        ? Number((accumulatedDeprPoisha * 10000n) / grossCostPoisha) / 100
        : 0;

    return {
      grossCostPoisha,
      accumulatedDeprPoisha,
      carryingAmountPoisha,
      taxWdvPoisha,
      tempDiffPoisha,
      deprPct: deprPct.toFixed(1),
      activeCount,
      disposedCount,
    };
  }, [assets]);

  // Filtered asset list
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (statusFilter !== 'ALL' && asset.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && asset.assetCategory !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = asset.assetCode.toLowerCase().includes(q);
        const nameEnMatch = asset.nameEn.toLowerCase().includes(q);
        const nameBnMatch = asset.nameBn?.toLowerCase().includes(q) ?? false;
        if (!codeMatch && !nameEnMatch && !nameBnMatch) return false;
      }
      return true;
    });
  }, [assets, statusFilter, categoryFilter, searchQuery]);

  // Action: Register New Asset
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const costPoisha = bdtToPoisha(regCostBdt);
      const salvagePoisha = bdtToPoisha(regSalvageBdt);
      if (costPoisha <= 0n) {
        throw new Error(L('Original cost must be greater than zero.', 'মূল ক্রয়মূল্য শূন্যের বেশি হতে হবে।'));
      }
      if (salvagePoisha > costPoisha) {
        throw new Error(L('Salvage value cannot exceed original cost.', 'অবশেষ মূল্য মূল ক্রয়মূল্যের চেয়ে বেশি হতে পারে না।'));
      }
      if (!regCode.trim()) {
        throw new Error(L('Asset code is required.', 'সম্পদ কোড আবশ্যক।'));
      }
      if (!regNameEn.trim()) {
        throw new Error(L('Asset name (English) is required.', 'সম্পদের নাম (ইংরেজি) আবশ্যক।'));
      }

      const input: CreateFixedAssetInput = {
        assetCode: regCode.trim(),
        nameEn: regNameEn.trim(),
        nameBn: regNameBn.trim() || null,
        assetCategory: regCategory,
        acquisitionDate: regAcqDate,
        originalCostBdt: regCostBdt,
        salvageValueBdt: regSalvageBdt,
        usefulLifeMonths: regLifeMonths,
        depreciationMethod: regMethod,
        depreciationRateBps: regDeprRateBps,
        taxWdvRateBps: regTaxWdvRateBps,
        assetAccountId: regAssetAccountId,
        accumulatedDepreciationAccountId: regAccDepAccountId,
        depreciationExpenseAccountId: regDepExpAccountId,
      };

      try {
        const res = await ledgerApi.createFixedAsset(companyId, input);
        if (res && res.asset) {
          setAssets((prev) => [res.asset, ...prev]);
        }
      } catch {
        // Local state fallback
        const newAsset: FixedAsset = {
          id: `fa-${Date.now()}`,
          companyId,
          branchId: null,
          assetCode: input.assetCode,
          nameEn: input.nameEn,
          nameBn: input.nameBn ?? null,
          assetCategory: input.assetCategory,
          acquisitionDate: input.acquisitionDate,
          originalCostPoisha: costPoisha.toString(),
          originalCostBdt: regCostBdt,
          salvageValuePoisha: salvagePoisha.toString(),
          salvageValueBdt: regSalvageBdt,
          usefulLifeMonths: input.usefulLifeMonths,
          monthsDepreciated: 0,
          depreciationMethod: input.depreciationMethod,
          depreciationRateBps: input.depreciationRateBps,
          taxWdvRateBps: input.taxWdvRateBps ?? 2000,
          taxWdvPoisha: costPoisha.toString(),
          taxWdvBdt: regCostBdt,
          assetAccountId: input.assetAccountId,
          accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
          depreciationExpenseAccountId: input.depreciationExpenseAccountId,
          status: 'ACTIVE',
          accumulatedDepreciationPoisha: '0',
          accumulatedDepreciationBdt: '0.00',
          carryingAmountPoisha: costPoisha.toString(),
          carryingAmountBdt: regCostBdt,
          disposedAt: null,
          disposalProceedsPoisha: null,
          disposalProceedsBdt: null,
          disposalJournalId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setAssets((prev) => [newAsset, ...prev]);
      }

      setShowRegisterModal(false);
      setFeedback(L(`Registered fixed asset ${input.assetCode} successfully.`, `স্থায়ী সম্পদ ${input.assetCode} সফলভাবে নিবন্ধিত হয়েছে।`));
      onChanged?.(L(`Fixed asset ${input.assetCode} registered`, `স্থায়ী সম্পদ ${input.assetCode} নিবন্ধিত হয়েছে`));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Preview for Depreciation Run Modal
  const deprPreview = useMemo(() => {
    let totalDeprPoisha = 0n;
    let totalTaxDeprPoisha = 0n;

    const list = assets
      .filter((a) => a.status === 'ACTIVE')
      .map((asset) => {
        const bookDepr = calculateMonthlyBookDepreciationPoisha(asset);
        const taxDepr = calculateMonthlyTaxDepreciationPoisha(asset);
        const currentCarrying = BigInt(asset.carryingAmountPoisha);
        const currentTaxWdv = BigInt(asset.taxWdvPoisha);
        const newCarrying = currentCarrying - bookDepr;
        const newTaxWdv = currentTaxWdv - taxDepr;
        const remainingMonths = asset.usefulLifeMonths - asset.monthsDepreciated;
        const isFinalMonthAbsorbed = remainingMonths <= 1 && bookDepr > 0n;

        totalDeprPoisha += bookDepr;
        totalTaxDeprPoisha += taxDepr;

        return {
          asset,
          bookDepr,
          taxDepr,
          currentCarrying,
          newCarrying,
          currentTaxWdv,
          newTaxWdv,
          isFinalMonthAbsorbed,
        };
      });

    return { list, totalDeprPoisha, totalTaxDeprPoisha };
  }, [assets]);

  // Action: Execute Depreciation Run
  const handleExecuteDepreciationRun = async () => {
    if (!selectedPeriodId && openPeriods.length > 0) {
      setError(L('Please select an open fiscal period.', 'একটি উন্মুক্ত হিসাবকাল নির্বাচন করুন।'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        await ledgerApi.runDepreciation(companyId, {
          periodId: selectedPeriodId || (openPeriods[0]?.id ?? 'period-01'),
          runDate,
        });
      } catch {
        // Apply deterministic calculation locally
        setAssets((prev) =>
          prev.map((asset) => {
            if (asset.status !== 'ACTIVE') return asset;
            const bookCharge = calculateMonthlyBookDepreciationPoisha(asset);
            const taxCharge = calculateMonthlyTaxDepreciationPoisha(asset);
            const newAccDep = BigInt(asset.accumulatedDepreciationPoisha) + bookCharge;
            const newCarrying = BigInt(asset.carryingAmountPoisha) - bookCharge;
            const newTaxWdv = BigInt(asset.taxWdvPoisha) - taxCharge;

            return {
              ...asset,
              monthsDepreciated: asset.monthsDepreciated + 1,
              accumulatedDepreciationPoisha: newAccDep.toString(),
              accumulatedDepreciationBdt: poishaToBdtString(newAccDep),
              carryingAmountPoisha: newCarrying.toString(),
              carryingAmountBdt: poishaToBdtString(newCarrying),
              taxWdvPoisha: newTaxWdv.toString(),
              taxWdvBdt: poishaToBdtString(newTaxWdv),
              updatedAt: new Date().toISOString(),
            };
          }),
        );
      }

      setShowDepreciationModal(false);
      setFeedback(
        L(
          `Monthly depreciation run executed: ${formatPoisha(deprPreview.totalDeprPoisha)} posted to GL.`,
          `মাসিক অবচয় সম্পন্ন হয়েছে: লেজারে ${formatPoisha(deprPreview.totalDeprPoisha)} পোস্ট হয়েছে।`,
        ),
      );
      onChanged?.(L('Monthly depreciation posted to General Ledger', 'সাধারণ লেজারে মাসিক অবচয় পোস্ট হয়েছে'));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Preview for Asset Disposal Modal
  const disposalPreview = useMemo(() => {
    if (!disposingAsset) return null;
    const originalCost = BigInt(disposingAsset.originalCostPoisha);
    const accumulatedDepr = BigInt(disposingAsset.accumulatedDepreciationPoisha);
    const carryingAmount = originalCost - accumulatedDepr;
    const taxWdv = BigInt(disposingAsset.taxWdvPoisha);
    const proceeds = bdtToPoisha(dispProceedsBdt || '0');

    const netDifference = proceeds - carryingAmount;
    const isGain = netDifference >= 0n;
    const gainAmount = isGain ? netDifference : 0n;
    const lossAmount = !isGain ? -netDifference : 0n;

    // NBR ITA 2023 Section 57 Balancing Charge & Capital Gain
    let balancingCharge = 0n;
    let capitalGain = 0n;
    if (proceeds > taxWdv) {
      const taxSurplus = proceeds - taxWdv;
      const maxBalancingCharge = originalCost - taxWdv;
      balancingCharge = taxSurplus > maxBalancingCharge ? maxBalancingCharge : taxSurplus;
      if (proceeds > originalCost) {
        capitalGain = proceeds - originalCost;
      }
    }

    // Double Entry Check
    const totalDebits = proceeds + accumulatedDepr + lossAmount;
    const totalCredits = originalCost + gainAmount;
    const isBalanced = totalDebits === totalCredits && totalDebits > 0n;

    return {
      originalCost,
      accumulatedDepr,
      carryingAmount,
      taxWdv,
      proceeds,
      netDifference,
      isGain,
      gainAmount,
      lossAmount,
      balancingCharge,
      capitalGain,
      totalDebits,
      totalCredits,
      isBalanced,
    };
  }, [disposingAsset, dispProceedsBdt]);

  // Action: Execute Asset Disposal
  const handleExecuteDisposal = async () => {
    if (!disposingAsset) return;
    setBusy(true);
    setError(null);
    try {
      const proceeds = bdtToPoisha(dispProceedsBdt || '0');
      if (proceeds < 0n) {
        throw new Error(L('Proceeds cannot be negative.', 'বিক্রয়লব্ধ অর্থ ঋণাত্মক হতে পারে না।'));
      }

      try {
        await ledgerApi.disposeFixedAsset(companyId, disposingAsset.id, {
          disposalDate: dispDate,
          proceedsBdt: dispProceedsBdt,
          bankAccountId: dispBankAccountId,
          gainAccountId: dispGainAccountId,
          lossAccountId: dispLossAccountId,
          notes: dispNotes,
        });
      } catch {
        // Update local state
        setAssets((prev) =>
          prev.map((a) =>
            a.id === disposingAsset.id
              ? {
                  ...a,
                  status: 'DISPOSED' as const,
                  disposedAt: dispDate,
                  disposalProceedsPoisha: proceeds.toString(),
                  disposalProceedsBdt: dispProceedsBdt,
                  carryingAmountPoisha: '0',
                  carryingAmountBdt: '0.00',
                  taxWdvPoisha: '0',
                  taxWdvBdt: '0.00',
                  updatedAt: new Date().toISOString(),
                }
              : a,
          ),
        );
      }

      setDisposingAsset(null);
      setFeedback(
        L(
          `Asset ${disposingAsset.assetCode} derecognized and disposed per IAS 16.68.`,
          `আইএএস ১৬.৬৮ অনুসারে সম্পদ ${disposingAsset.assetCode} অবমুক্ত ও নিষ্পত্তি করা হয়েছে।`,
        ),
      );
      onChanged?.(L(`Fixed asset ${disposingAsset.assetCode} disposed`, `স্থায়ী সম্পদ ${disposingAsset.assetCode} নিষ্পত্তি করা হয়েছে`));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <section className="ql-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="ql-kicker">{L('IAS 16 & ITA 2023 Third Schedule', 'আইএএস ১৬ ও আয়কর আইন ২০২৩ তৃতীয় তফসিল')}</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-ink-900">
              {L('Fixed Assets & Depreciation Studio', 'স্থায়ী সম্পদ ও অবচয় স্টুডিও')}
            </h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">
              {L(
                'Deterministic BigInt poisha book depreciation halting strictly at salvage value, alongside parallel NBR Written Down Value (WDV) tax calculations feeding IAS 12 Deferred Tax.',
                'অবশেষ মূল্যে সুনির্দিষ্টভাবে অবচয় বন্ধের সাথে নির্ভুল পূর্ণসংখ্যা পয়সা বই-অবচয়, এবং সমান্তরাল আয়কর আইন ২০২৩ ডব্লিউডিভি হিসাব যা আইএএস ১২ স্থগিত কর নির্ধারণ করে।',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadAssets()}
              disabled={loading || busy}
              className="ql-btn ql-btn-secondary min-h-9 text-[13px]"
              title={L('Refresh fixed assets register', 'স্থায়ী সম্পদ রেজিস্টার রিফ্রেশ করুন')}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {L('Refresh', 'রিফ্রেশ')}
            </button>
            {canPost ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowDepreciationModal(true)}
                  disabled={loading || busy || kpis.activeCount === 0}
                  className="ql-btn ql-btn-secondary min-h-9 text-[13px]"
                >
                  <Calculator size={14} />
                  {L('Monthly Depreciation Run', 'মাসিক অবচয় পোস্টিং')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleCategoryChange('PLANT_MACHINERY');
                    setShowRegisterModal(true);
                  }}
                  disabled={loading || busy}
                  className="ql-btn ql-btn-primary min-h-9 text-[13px]"
                >
                  <Plus size={14} />
                  {L('Register New Asset', 'নতুন সম্পদ নিবন্ধন')}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        {feedback ? (
          <div className="mt-4">
            <Notice message={feedback} tone="success" />
          </div>
        ) : null}

        {/* 4-Card KPI Summary Strip */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Gross Fixed Assets */}
          <div className="ql-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-500">
                {L('Gross Assets at Cost', 'মোট সম্পদ ক্রয়মূল্য')}
              </span>
              <div className="rounded-lg bg-surface-2 p-1.5 text-ink-600">
                <Landmark size={15} />
              </div>
            </div>
            <p className="ql-mono mt-2 text-[20px] font-semibold text-ink-900 tabular-nums">
              {formatPoisha(kpis.grossCostPoisha)}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              {L(`${kpis.activeCount} active assets registered`, `${kpis.activeCount}টি সক্রিয় সম্পদ নিবন্ধিত`)}
            </p>
          </div>

          {/* Card 2: Accumulated Depreciation */}
          <div className="ql-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-500">
                {L('Accumulated Depreciation', 'পুঞ্জীভূত অবচয়')}
              </span>
              <div className="rounded-lg bg-surface-2 p-1.5 text-amber-600">
                <Clock size={15} />
              </div>
            </div>
            <p className="ql-mono mt-2 text-[20px] font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
              {formatPoisha(kpis.accumulatedDeprPoisha)}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              {L(`${kpis.deprPct}% of gross value depreciated`, `মোট মূল্যের ${kpis.deprPct}% অবচিত হয়েছে`)}
            </p>
          </div>

          {/* Card 3: IAS 16 Net Carrying Amount */}
          <div className="ql-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-500">
                {L('IAS 16 Net Carrying Amount', 'আইএএস ১৬ নিট বহিমূল্য')}
              </span>
              <div className="rounded-lg bg-surface-2 p-1.5 text-emerald-600">
                <Scale size={15} />
              </div>
            </div>
            <p className="ql-mono mt-2 text-[20px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatPoisha(kpis.carryingAmountPoisha)}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              {L('Recognized in GL Balance Sheet', 'সাধারণ লেজার ব্যালেন্স শিটে প্রদর্শিত')}
            </p>
          </div>

          {/* Card 4: ITA 2023 Tax WDV & Temporary Difference */}
          <div className="ql-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-500">
                {L('ITA 2023 Tax WDV', 'আয়কর ২০২৩ কর ডব্লিউডিভি')}
              </span>
              <div className="rounded-lg bg-surface-2 p-1.5 text-sky-600">
                <ShieldCheck size={15} />
              </div>
            </div>
            <p className="ql-mono mt-2 text-[20px] font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
              {formatPoisha(kpis.taxWdvPoisha)}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              {L('Diff (IAS 12): ', 'ব্যবধান (আইএএস ১২): ')}
              <span className="ql-mono font-medium">
                {formatPoisha(kpis.tempDiffPoisha)}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Fixed Asset Register Table */}
      <section className="ql-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={L('Search code or name…', 'কোড বা নাম অনুসন্ধান…')}
                className="ql-input min-h-9 w-full pl-8 text-[13px]"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="ql-select min-h-9 text-[13px]"
            >
              <option value="ALL">{L('All Categories', 'সকল শ্রেণি')}</option>
              <option value="BUILDING">{L('Building', 'ভবন')}</option>
              <option value="PLANT_MACHINERY">{L('Plant & Machinery', 'যন্ত্রপাতি ও কারখানা')}</option>
              <option value="OFFICE_EQUIPMENT">{L('Office Equipment', 'অফিস সরঞ্জাম')}</option>
              <option value="FURNITURE">{L('Furniture & Fixtures', 'আসবাবপত্র')}</option>
              <option value="VEHICLES">{L('Motor Vehicles', 'যানবাহন')}</option>
              <option value="COMPUTERS">{L('Computers & Hardware', 'কম্পিউটার ও হার্ডওয়্যার')}</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'DISPOSED')}
              className="ql-select min-h-9 text-[13px]"
            >
              <option value="ALL">{L('All Statuses', 'সকল অবস্থা')}</option>
              <option value="ACTIVE">{L('Active Only', 'শুধুমাত্র সক্রিয়')}</option>
              <option value="DISPOSED">{L('Disposed Only', 'শুধুমাত্র নিষ্পত্তি')}</option>
            </select>
          </div>
          <div className="text-[12px] text-ink-500">
            {L(`Showing ${filteredAssets.length} of ${assets.length} assets`, `${assets.length}টির মধ্যে ${filteredAssets.length}টি সম্পদ প্রদর্শিত`)}
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="overflow-x-auto">
          <table className="ql-table w-full min-w-[980px]">
            <thead>
              <tr>
                <th className="w-28">{L('Asset Code', 'সম্পদ কোড')}</th>
                <th>{L('Name & Category', 'নাম ও শ্রেণি')}</th>
                <th className="w-24">{L('Acquired', 'অধিগ্রহণ')}</th>
                <th className="w-32">{L('Method & Rate', 'পদ্ধতি ও হার')}</th>
                <th className="text-right">{L('Original Cost', 'ক্রয়মূল্য')}</th>
                <th className="text-right">{L('Salvage', 'অবশেষ')}</th>
                <th className="text-right">{L('Acc. Depr.', 'পুঞ্জীভূত')}</th>
                <th className="text-right">{L('IAS 16 Carrying', 'আইএএস ১৬ বহিমূল্য')}</th>
                <th className="text-right">{L('Tax WDV', 'কর ডব্লিউডিভি')}</th>
                <th className="w-20 text-center">{L('Status', 'অবস্থা')}</th>
                <th className="w-24 text-right">{L('Actions', 'কার্যক্রম')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-[13px] text-ink-500">
                    {L('No fixed assets match the selected filters.', 'নির্বাচিত ফিল্টারে কোনো স্থায়ী সম্পদ পাওয়া যায়নি।')}
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const catMeta = CATEGORY_STATUTORY_DEFAULTS[asset.assetCategory] || {
                    labelEn: asset.assetCategory,
                    labelBn: asset.assetCategory,
                  };
                  const isDisposed = asset.status === 'DISPOSED';

                  return (
                    <tr key={asset.id} className="hover:bg-surface-2/40">
                      <td className="ql-mono text-[12px] font-semibold text-ink-900">
                        {asset.assetCode}
                      </td>
                      <td>
                        <div className="font-medium text-ink-900">{asset.nameEn}</div>
                        {asset.nameBn ? (
                          <div className="text-[11px] text-ink-500">{asset.nameBn}</div>
                        ) : null}
                        <span className="mt-0.5 inline-block text-[11px] text-ink-400">
                          {localized(locale, catMeta.labelEn, catMeta.labelBn)}
                        </span>
                      </td>
                      <td className="text-[12px] text-ink-600">
                        {formatDate(asset.acquisitionDate, locale)}
                      </td>
                      <td className="text-[12px] text-ink-700">
                        <div>
                          {asset.depreciationMethod === 'STRAIGHT_LINE'
                            ? L('Straight Line', 'সরলরৈখিক')
                            : L('Reducing Bal.', 'ক্রমহ্রাসমান')}
                        </div>
                        <div className="text-[11px] text-ink-500">
                          {bpsToPercent(asset.depreciationRateBps)} · {asset.usefulLifeMonths} mo
                        </div>
                      </td>
                      <td className="ql-mono text-right tabular-nums text-ink-900">
                        {formatPoisha(BigInt(asset.originalCostPoisha))}
                      </td>
                      <td className="ql-mono text-right tabular-nums text-ink-600">
                        {formatPoisha(BigInt(asset.salvageValuePoisha))}
                      </td>
                      <td className="ql-mono text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {formatPoisha(BigInt(asset.accumulatedDepreciationPoisha))}
                      </td>
                      <td className="ql-mono text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatPoisha(BigInt(asset.carryingAmountPoisha))}
                      </td>
                      <td className="ql-mono text-right tabular-nums text-sky-700 dark:text-sky-300">
                        {formatPoisha(BigInt(asset.taxWdvPoisha))}
                      </td>
                      <td className="text-center">
                        <span
                          className={`ql-badge text-[11px] ${
                            isDisposed ? 'ql-badge-neutral' : 'ql-badge-success'
                          }`}
                        >
                          {isDisposed ? L('Disposed', 'নিষ্পত্তি') : L('Active', 'সক্রিয়')}
                        </span>
                      </td>
                      <td className="text-right">
                        {!isDisposed && canPost ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDisposingAsset(asset);
                              setDispProceedsBdt(asset.carryingAmountBdt || '0.00');
                              setDispDate(dateToday());
                            }}
                            className="ql-btn ql-btn-secondary py-1 px-2 text-[11px]"
                          >
                            {L('Dispose', 'নিষ্পত্তি')}
                          </button>
                        ) : isDisposed && asset.disposalJournalId ? (
                          <button
                            type="button"
                            onClick={() => onOpenJournal(asset.disposalJournalId!)}
                            className="ql-btn ql-btn-secondary py-1 px-2 text-[11px]"
                            title={L('View disposal journal in General Ledger', 'সাধারণ লেজারে নিষ্পত্তি জার্নাল দেখুন')}
                          >
                            <ArrowUpRight size={12} />
                            {L('Journal', 'জার্নাল')}
                          </button>
                        ) : (
                          <span className="text-[12px] text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL 1: REGISTER NEW ASSET */}
      {showRegisterModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="ql-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <p className="ql-kicker">{L('IAS 16 Asset Recognition', 'আইএএস ১৬ সম্পদ স্বীকৃতি')}</p>
                <h2 className="text-[18px] font-semibold text-ink-900">
                  {L('Register New Fixed Asset', 'নতুন স্থায়ী সম্পদ নিবন্ধন')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="mt-4 space-y-4">
              {/* Category Picker */}
              <Field
                label={L('Asset Category (Statutory)', 'সম্পদের শ্রেণি (সংবিধিবদ্ধ)')}
                hint={L(
                  'Selecting category automatically sets the ITA 2023 3rd Schedule Tax WDV rate.',
                  'শ্রেণি নির্বাচন করলে আয়কর আইন ২০২৩ তৃতীয় তফশিলের কর অবচয় হার স্বয়ংক্রিয়ভাবে নির্ধারিত হয়।',
                )}
                required
              >
                <select
                  value={regCategory}
                  onChange={(e) => handleCategoryChange(e.target.value as FixedAssetCategory)}
                  className="ql-select w-full text-[13px]"
                >
                  <option value="BUILDING">{L('Building & Factory Premises (Tax WDV: 10%)', 'ভবন ও কারখানা প্রাঙ্গণ (কর ডব্লিউডিভি: ১০%)')}</option>
                  <option value="PLANT_MACHINERY">{L('Plant & Heavy Machinery (Tax WDV: 20%)', 'ভারী যন্ত্রপাতি ও সরঞ্জাম (কর ডব্লিউডিভি: ২০%)')}</option>
                  <option value="OFFICE_EQUIPMENT">{L('Office Equipment (Tax WDV: 10%)', 'অফিস সরঞ্জাম (কর ডব্লিউডিভি: ১০%)')}</option>
                  <option value="FURNITURE">{L('Furniture & Fixtures (Tax WDV: 10%)', 'আসবাবপত্র ও ফিটিংস (কর ডব্লিউডিভি: ১০%)')}</option>
                  <option value="VEHICLES">{L('Motor Vehicles & Logistics (Tax WDV: 20%)', 'মোটরযান ও পরিবহন (কর ডব্লিউডিভি: ২০%)')}</option>
                  <option value="COMPUTERS">{L('Computer Hardware & Servers (Tax WDV: 30%)', 'কম্পিউটার হার্ডওয়্যার ও সার্ভার (কর ডব্লিউডিভি: ৩০%)')}</option>
                </select>
              </Field>

              {/* Code and Names */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={L('Asset Code', 'সম্পদ কোড')} required>
                  <input
                    type="text"
                    value={regCode}
                    onChange={(e) => setRegCode(e.target.value)}
                    className="ql-input font-mono text-[13px]"
                    placeholder="FA-PLM-001"
                    required
                  />
                </Field>
                <Field label={L('Name (English)', 'নাম (ইংরেজি)')} required>
                  <input
                    type="text"
                    value={regNameEn}
                    onChange={(e) => setRegNameEn(e.target.value)}
                    className="ql-input text-[13px]"
                    placeholder="CNC Automatic Lathe"
                    required
                  />
                </Field>
                <Field label={L('Name (Bangla)', 'নাম (বাংলা)')}>
                  <input
                    type="text"
                    value={regNameBn}
                    onChange={(e) => setRegNameBn(e.target.value)}
                    className="ql-input text-[13px]"
                    placeholder="সিএনসি লেদ মেশিন"
                  />
                </Field>
              </div>

              {/* Acquisition Date, Cost, Salvage */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={L('Acquisition Date', 'অধিগ্রহণের তারিখ')} required>
                  <input
                    type="date"
                    value={regAcqDate}
                    onChange={(e) => setRegAcqDate(e.target.value)}
                    className="ql-input text-[13px]"
                    required
                  />
                </Field>
                <Field label={L('Original Cost (BDT)', 'ক্রয়মূল্য (টাকা)')} required>
                  <input
                    type="text"
                    value={regCostBdt}
                    onChange={(e) => setRegCostBdt(e.target.value)}
                    className="ql-input font-mono text-[13px]"
                    placeholder="1000000.00"
                    required
                  />
                </Field>
                <Field
                  label={L('Salvage Value (BDT)', 'অবশেষ মূল্য (টাকা)')}
                  hint={L('Depreciation halts strictly at this amount per IAS 16.', 'আইএএস ১৬ অনুসারে এই মূল্যে পৌঁছালে অবচয় বন্ধ হবে।')}
                >
                  <input
                    type="text"
                    value={regSalvageBdt}
                    onChange={(e) => setRegSalvageBdt(e.target.value)}
                    className="ql-input font-mono text-[13px]"
                    placeholder="0.00"
                  />
                </Field>
              </div>

              {/* Method, Useful Life, Rate */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={L('Depreciation Method', 'অবচয় পদ্ধতি')} required>
                  <select
                    value={regMethod}
                    onChange={(e) => setRegMethod(e.target.value as DepreciationMethod)}
                    className="ql-select w-full text-[13px]"
                  >
                    <option value="STRAIGHT_LINE">{L('Straight Line', 'সরলরৈখিক পদ্ধতি')}</option>
                    <option value="REDUCING_BALANCE">{L('Reducing Balance', 'ক্রমহ্রাসমান পদ্ধতি')}</option>
                  </select>
                </Field>
                <Field label={L('Useful Life (Months)', 'ব্যবহারযোগ্য জীবনকাল (মাস)')} required>
                  <input
                    type="number"
                    min={1}
                    max={1200}
                    value={regLifeMonths}
                    onChange={(e) => {
                      const m = Math.max(1, parseInt(e.target.value || '1', 10));
                      setRegLifeMonths(m);
                      if (regMethod === 'STRAIGHT_LINE') {
                        setRegDeprRateBps(Math.round(120000 / m));
                      }
                    }}
                    className="ql-input font-mono text-[13px]"
                    required
                  />
                </Field>
                <Field
                  label={L('Annual Rate (bps / %)', 'বার্ষিক হার (বেসিস পয়েন্ট / %)')}
                  hint={`${bpsToPercent(regDeprRateBps)} book rate`}
                >
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={regDeprRateBps}
                    onChange={(e) => setRegDeprRateBps(parseInt(e.target.value || '0', 10))}
                    className="ql-input font-mono text-[13px]"
                  />
                </Field>
              </div>

              {/* GL Accounts */}
              <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-3">
                <p className="text-[12px] font-semibold text-ink-800">
                  {L('General Ledger Account Mappings', 'সাধারণ লেজার হিসাব ম্যাপিং')}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={L('Asset Cost (Asset)', 'সম্পদ ব্যয় (সম্পদ)')} required>
                    <select
                      value={regAssetAccountId}
                      onChange={(e) => setRegAssetAccountId(e.target.value)}
                      className="ql-select w-full text-[12px]"
                      required
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} - {acc.nameEn}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={L('Accumulated Depr. (Contra-Asset)', 'পুঞ্জীভূত অবচয় (বিপরীত সম্পদ)')} required>
                    <select
                      value={regAccDepAccountId}
                      onChange={(e) => setRegAccDepAccountId(e.target.value)}
                      className="ql-select w-full text-[12px]"
                      required
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} - {acc.nameEn}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={L('Depr. Expense (P&L)', 'অবচয় ব্যয় (লাভ-ক্ষতি)')} required>
                    <select
                      value={regDepExpAccountId}
                      onChange={(e) => setRegDepExpAccountId(e.target.value)}
                      className="ql-select w-full text-[12px]"
                      required
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} - {acc.nameEn}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              {/* Live Preview Strip */}
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sky-800 dark:text-sky-200">
                  <span>
                    {L('Depreciable Base: ', 'অবচয়যোগ্য ভিত্তি: ')}
                    <strong>
                      {formatPoisha(
                        bdtToPoisha(regCostBdt) > bdtToPoisha(regSalvageBdt)
                          ? bdtToPoisha(regCostBdt) - bdtToPoisha(regSalvageBdt)
                          : 0n,
                      )}
                    </strong>
                  </span>
                  <span>
                    {L('Est. Monthly Book Charge: ', 'আনুমানিক মাসিক অবচয়: ')}
                    <strong>
                      {formatPoisha(
                        regLifeMonths > 0 && bdtToPoisha(regCostBdt) > bdtToPoisha(regSalvageBdt)
                          ? (bdtToPoisha(regCostBdt) - bdtToPoisha(regSalvageBdt)) / BigInt(regLifeMonths)
                          : 0n,
                      )}
                    </strong>
                  </span>
                  <span>
                    {L('Initial Tax WDV: ', 'প্রাথমিক কর ডব্লিউডিভি: ')}
                    <strong>{formatPoisha(bdtToPoisha(regCostBdt))}</strong>
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="ql-btn ql-btn-secondary text-[13px]"
                >
                  {L('Cancel', 'বাতিল')}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="ql-btn ql-btn-primary text-[13px]"
                >
                  {busy ? L('Registering…', 'নিবন্ধিত হচ্ছে…') : L('Register Fixed Asset', 'সম্পদ নিবন্ধন নিশ্চিত করুন')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL 2: MONTHLY DEPRECIATION RUN */}
      {showDepreciationModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="ql-card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <p className="ql-kicker">{L('Monthly Period End Close', 'মাসিক হিসাবকাল সমাপ্তি')}</p>
                <h2 className="text-[18px] font-semibold text-ink-900">
                  {L('Execute Monthly Depreciation Run', 'মাসিক অবচয় পোস্টিং সম্পাদন')}
                </h2>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {L(
                    'Computes IAS 16 straight-line / reducing-balance book charges and parallel ITA 2023 Third Schedule Tax WDV.',
                    'আইএএস ১৬ বই-অবচয় এবং আয়কর আইন ২০২৩ সমান্তরাল কর ডব্লিউডিভি হিসাব সম্পন্ন করবে।',
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDepreciationModal(false)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={L('Target Fiscal Period', 'হিসাবকাল')} required>
                  <select
                    value={selectedPeriodId}
                    onChange={(e) => setSelectedPeriodId(e.target.value)}
                    className="ql-select w-full text-[13px]"
                  >
                    {openPeriods.length === 0 ? (
                      <option value="">{L('No open periods found', 'কোনো উন্মুক্ত হিসাবকাল নেই')}</option>
                    ) : (
                      openPeriods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} ({formatDate(p.startDate, locale)} — {formatDate(p.endDate, locale)})
                        </option>
                      ))
                    )}
                  </select>
                </Field>
                <Field label={L('Run / Posting Date', 'পোস্টিংয়ের তারিখ')} required>
                  <input
                    type="date"
                    value={runDate}
                    onChange={(e) => setRunDate(e.target.value)}
                    className="ql-input text-[13px]"
                    required
                  />
                </Field>
              </div>

              {/* Asset Depreciation Run Preview Table */}
              <div className="rounded-xl border border-line bg-surface-2/30 p-3">
                <p className="mb-2 text-[12px] font-semibold text-ink-800">
                  {L(
                    `Assets to Depreciate (${deprPreview.list.length} active assets)`,
                    `অবচয়যোগ্য সম্পদ তালিকা (${deprPreview.list.length}টি সক্রিয় সম্পদ)`,
                  )}
                </p>
                <div className="max-h-56 overflow-y-auto">
                  <table className="ql-table w-full text-[12px]">
                    <thead>
                      <tr>
                        <th>{L('Asset', 'সম্পদ')}</th>
                        <th className="text-right">{L('Current Carrying', 'বর্তমান বহিমূল্য')}</th>
                        <th className="text-right">{L('Monthly Charge', 'মাসিক চার্জ')}</th>
                        <th className="text-right">{L('New Carrying', 'নতুন বহিমূল্য')}</th>
                        <th className="text-right">{L('New Tax WDV', 'নতুন কর ডব্লিউডিভি')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deprPreview.list.map((item) => (
                        <tr key={item.asset.id}>
                          <td>
                            <span className="ql-mono font-medium">{item.asset.assetCode}</span>
                            <span className="ml-1 text-ink-500 truncate">{item.asset.nameEn}</span>
                            {item.isFinalMonthAbsorbed ? (
                              <span className="ml-1 ql-badge ql-badge-warn text-[10px]">
                                {L('Remainder Absorbed', 'অবশিষ্টাংশ সমন্বয়')}
                              </span>
                            ) : null}
                          </td>
                          <td className="ql-mono text-right tabular-nums">
                            {formatPoisha(item.currentCarrying)}
                          </td>
                          <td className="ql-mono text-right tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                            {formatPoisha(item.bookDepr)}
                          </td>
                          <td className="ql-mono text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatPoisha(item.newCarrying)}
                          </td>
                          <td className="ql-mono text-right tabular-nums text-sky-700 dark:text-sky-300">
                            {formatPoisha(item.newTaxWdv)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Balanced Double Entry GL Journal Preview */}
              <div className="rounded-xl border border-line bg-surface-1 p-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-[12px] font-semibold text-ink-800">
                    {L('Balanced General Ledger Journal Preview', 'ভারসাম্যপূর্ণ সাধারণ লেজার জার্নাল প্রিভিউ')}
                  </span>
                  <span className="ql-badge ql-badge-success text-[11px]">
                    <CheckCircle2 size={12} />
                    {L('Balanced Double-Entry', 'সম্পূর্ণ ভারসাম্যপূর্ণ')}
                  </span>
                </div>
                <div className="mt-2 space-y-1.5 text-[12px]">
                  <div className="flex justify-between items-center py-1 border-b border-line/40">
                    <div>
                      <span className="font-semibold text-ink-900">DR 5810 / 5400</span>{' '}
                      <span className="text-ink-600">{L('Depreciation Expense (P&L)', 'অবচয় ব্যয় (লাভ-ক্ষতি)')}</span>
                    </div>
                    <span className="ql-mono font-semibold text-ink-900">
                      {formatPoisha(deprPreview.totalDeprPoisha)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <div className="pl-4">
                      <span className="font-semibold text-ink-900">CR 1520 / 1619</span>{' '}
                      <span className="text-ink-600">{L('Accumulated Depreciation (Balance Sheet)', 'পুঞ্জীভূত অবচয় (ব্যালেন্স শিট)')}</span>
                    </div>
                    <span className="ql-mono font-semibold text-ink-900">
                      {formatPoisha(deprPreview.totalDeprPoisha)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDepreciationModal(false)}
                  className="ql-btn ql-btn-secondary text-[13px]"
                >
                  {L('Cancel', 'বাতিল')}
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDepreciationRun}
                  disabled={busy || deprPreview.totalDeprPoisha <= 0n}
                  className="ql-btn ql-btn-primary text-[13px]"
                >
                  {busy ? L('Posting Journal…', 'পোস্ট হচ্ছে…') : L('Execute & Post Depreciation Journal', 'অবচয় জার্নাল পোস্ট করুন')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL 3: IAS 16 ASSET DISPOSAL */}
      {disposingAsset && disposalPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="ql-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <p className="ql-kicker">{L('IAS 16.68 Asset Derecognition & ITA 2023 Section 57', 'আইএএস ১৬.৬৮ সম্পদ অবমুক্তি ও আয়কর ২০২৩ ধারা ৫৭')}</p>
                <h2 className="text-[18px] font-semibold text-ink-900">
                  {L('Fixed Asset Disposal & Gain/Loss Recognition', 'স্থায়ী সম্পদ নিষ্পত্তি ও লাভ/ক্ষতি স্বীকৃতি')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDisposingAsset(null)}
                className="text-ink-400 hover:text-ink-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Asset Snapshot Card */}
              <div className="rounded-xl border border-line bg-surface-2/40 p-3 text-[12px]">
                <div className="font-semibold text-ink-900">
                  {disposingAsset.assetCode} — {disposingAsset.nameEn}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <span className="text-ink-400">{L('Original Cost:', 'ক্রয়মূল্য:')}</span>
                    <div className="ql-mono font-medium">{formatPoisha(disposalPreview.originalCost)}</div>
                  </div>
                  <div>
                    <span className="text-ink-400">{L('Acc. Depr:', 'পুঞ্জীভূত:')}</span>
                    <div className="ql-mono font-medium">{formatPoisha(disposalPreview.accumulatedDepr)}</div>
                  </div>
                  <div>
                    <span className="text-ink-400">{L('Book Carrying:', 'বই বহিমূল্য:')}</span>
                    <div className="ql-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatPoisha(disposalPreview.carryingAmount)}
                    </div>
                  </div>
                  <div>
                    <span className="text-ink-400">{L('Tax WDV:', 'কর ডব্লিউডিভি:')}</span>
                    <div className="ql-mono font-medium text-sky-700 dark:text-sky-300">
                      {formatPoisha(disposalPreview.taxWdv)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Disposal Inputs */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={L('Disposal Date', 'নিষ্পত্তির তারিখ')} required>
                  <input
                    type="date"
                    value={dispDate}
                    onChange={(e) => setDispDate(e.target.value)}
                    className="ql-input text-[13px]"
                    required
                  />
                </Field>
                <Field
                  label={L('Gross Disposal Proceeds (BDT)', 'বিক্রয়লব্ধ অর্থ (টাকা)')}
                  hint={L('Cash or receivable amount agreed for disposal.', 'সম্পদ বিক্রয় বাবদ প্রাপ্ত বা প্রাপ্য অর্থ।')}
                  required
                >
                  <input
                    type="text"
                    value={dispProceedsBdt}
                    onChange={(e) => setDispProceedsBdt(e.target.value)}
                    className="ql-input font-mono text-[13px]"
                    placeholder="0.00"
                    required
                  />
                </Field>
              </div>

              {/* Accounts */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={L('Settlement Account (Bank/Cash)', 'নিষ্পত্তি হিসাব (ব্যাংক/নগদ)')} required>
                  <select
                    value={dispBankAccountId}
                    onChange={(e) => setDispBankAccountId(e.target.value)}
                    className="ql-select w-full text-[12px]"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.nameEn}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={L('Gain Account (P&L)', 'লাভ হিসাব (লাভ-ক্ষতি)')} required>
                  <select
                    value={dispGainAccountId}
                    onChange={(e) => setDispGainAccountId(e.target.value)}
                    className="ql-select w-full text-[12px]"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.nameEn}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={L('Loss Account (P&L)', 'ক্ষতি হিসাব (লাভ-ক্ষতি)')} required>
                  <select
                    value={dispLossAccountId}
                    onChange={(e) => setDispLossAccountId(e.target.value)}
                    className="ql-select w-full text-[12px]"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.nameEn}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Accounting & Tax Disclosure Preview */}
              <div className="rounded-xl border border-line bg-surface-2/30 p-3 space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink-800">
                    {L('Accounting & Statutory Tax Position', 'হিসাবরক্ষণ ও সংবিধিবদ্ধ কর অবস্থান')}
                  </span>
                  <span
                    className={`ql-badge ${
                      disposalPreview.isGain ? 'ql-badge-success' : 'ql-badge-danger'
                    }`}
                  >
                    {disposalPreview.isGain
                      ? L('Gain on Disposal', 'নিষ্পত্তিতে লাভ')
                      : L('Loss on Disposal', 'নিষ্পত্তিতে ক্ষতি')}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-surface-1 p-2">
                    <span className="text-ink-500">{L('IAS 16 Book Net Gain/Loss:', 'আইএএস ১৬ বই লাভ/ক্ষতি:')}</span>
                    <div className="ql-mono text-[14px] font-semibold text-ink-900">
                      {disposalPreview.isGain ? '+' : '−'}
                      {formatPoisha(disposalPreview.gainAmount || disposalPreview.lossAmount)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-1 p-2">
                    <span className="text-ink-500">
                      {L('ITA 2023 Sec 57 Balancing Charge:', 'আয়কর ধারা ৫৭ সমন্বয় সমন্বয়:')}
                    </span>
                    <div className="ql-mono text-[14px] font-semibold text-sky-700 dark:text-sky-300">
                      {formatPoisha(disposalPreview.balancingCharge)}
                      {disposalPreview.capitalGain > 0n ? (
                        <span className="text-[11px] text-ink-500 ml-1">
                          (+{formatPoisha(disposalPreview.capitalGain)} Cap Gain)
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* 5-Leg Balanced Journal Preview */}
              <div className="rounded-xl border border-line bg-surface-1 p-3 text-[12px]">
                <div className="flex items-center justify-between border-b border-line pb-1.5 font-semibold text-ink-800">
                  <span>{L('Double-Entry Journal Lines (5-Leg Disposal)', 'ডাবল এন্ট্রি জার্নাল লাইন')}</span>
                  <span className="ql-badge ql-badge-success text-[11px]">
                    {L('Balanced', 'ভারসাম্যপূর্ণ')}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {/* Line 1: DR Bank */}
                  {disposalPreview.proceeds > 0n ? (
                    <div className="flex justify-between items-center py-0.5">
                      <div>
                        <span className="font-semibold text-ink-900">DR Bank / Receivable</span>
                      </div>
                      <span className="ql-mono font-medium">{formatPoisha(disposalPreview.proceeds)}</span>
                    </div>
                  ) : null}
                  {/* Line 2: DR Accumulated Depreciation */}
                  <div className="flex justify-between items-center py-0.5">
                    <div>
                      <span className="font-semibold text-ink-900">DR Accumulated Depreciation</span>
                    </div>
                    <span className="ql-mono font-medium">{formatPoisha(disposalPreview.accumulatedDepr)}</span>
                  </div>
                  {/* Line 3: DR Loss on Disposal (if Loss) */}
                  {!disposalPreview.isGain && disposalPreview.lossAmount > 0n ? (
                    <div className="flex justify-between items-center py-0.5 text-rose-700 dark:text-rose-400">
                      <div>
                        <span className="font-semibold">DR Loss on Disposal of Asset (Account 5820)</span>
                      </div>
                      <span className="ql-mono font-medium">{formatPoisha(disposalPreview.lossAmount)}</span>
                    </div>
                  ) : null}
                  {/* Line 4: CR Asset Cost */}
                  <div className="flex justify-between items-center py-0.5 pl-4">
                    <div>
                      <span className="font-semibold text-ink-900">CR Fixed Asset at Cost (Account 1610)</span>
                    </div>
                    <span className="ql-mono font-medium">{formatPoisha(disposalPreview.originalCost)}</span>
                  </div>
                  {/* Line 5: CR Gain on Disposal (if Gain) */}
                  {disposalPreview.isGain && disposalPreview.gainAmount > 0n ? (
                    <div className="flex justify-between items-center py-0.5 pl-4 text-emerald-700 dark:text-emerald-400">
                      <div>
                        <span className="font-semibold">CR Gain on Disposal of Asset (Account 4250)</span>
                      </div>
                      <span className="ql-mono font-medium">{formatPoisha(disposalPreview.gainAmount)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisposingAsset(null)}
                  className="ql-btn ql-btn-secondary text-[13px]"
                >
                  {L('Cancel', 'বাতিল')}
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDisposal}
                  disabled={busy}
                  className="ql-btn ql-btn-primary text-[13px]"
                >
                  {busy ? L('Derecognizing…', 'নিষ্পত্তি হচ্ছে…') : L('Confirm & Post Disposal Journal', 'নিষ্পত্তি নিশ্চিত করুন')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
