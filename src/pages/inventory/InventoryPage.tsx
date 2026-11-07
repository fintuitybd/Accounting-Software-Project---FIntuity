import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Factory, History, PackageSearch, Warehouse } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import { setupApi } from '../../setup/api';
import { masterApi } from '../../masters/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { RouteLoading } from '../../shell/RouteStates';
import { MovementFormPanel } from './MovementFormPanel';
import { StockLedgerPanel } from './StockLedgerPanel';
import { ValuationPanel } from './ValuationPanel';
import { ControlProofPanel } from './ControlProofPanel';
import type { InventoryRefs } from './inventoryUi';

const Mushak43Page = lazy(() =>
  import('./Mushak43Page').then((m) => ({ default: m.Mushak43Page }))
);

type TabKey = 'LEDGER' | 'VALUATION' | 'PROOF' | 'RECORD' | 'MUSHAK43';

const TABS: Array<{ key: TabKey; en: string; bn: string; icon: typeof History }> = [
  { key: 'LEDGER', en: 'Stock ledger', bn: 'স্টক লেজার', icon: History },
  { key: 'VALUATION', en: 'Valuation', bn: 'মূল্যায়ন', icon: PackageSearch },
  { key: 'MUSHAK43', en: 'Mushak 4.3 & BOM', bn: 'মূসক ৪.৩ ও বিওএম', icon: Factory },
  { key: 'PROOF', en: 'Control proof', bn: 'নিয়ন্ত্রণ প্রমাণ', icon: ClipboardCheck },
  { key: 'RECORD', en: 'Record movement', bn: 'মুভমেন্ট রেকর্ড', icon: Warehouse },
];

export default function InventoryPage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const canDispatch = auth.hasCompanyPermission('DISPATCH_OR_RECEIVE_STOCK');
  const canOverride = auth.hasCompanyPermission('OVERRIDE_NEGATIVE_STOCK');
  const canViewProof = auth.hasCompanyPermission('VIEW_REPORTS');

  const [tab, setTab] = useState<TabKey>('LEDGER');
  const [refs, setRefs] = useState<InventoryRefs>({ accounts: [], items: [], warehouses: [] });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    if (!companyId) return;
    setLoadingRefs(true);
    setError(null);
    try {
      const [accounts, items, warehouses] = await Promise.all([
        setupApi.accounts(companyId),
        masterApi.items(companyId, { includeInactive: true, pageSize: 100 }),
        masterApi.warehouses(companyId, { includeInactive: true }),
      ]);
      setRefs({
        accounts: accounts.accounts,
        items: items.items,
        warehouses: warehouses.warehouses,
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoadingRefs(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  const onChanged = useCallback(() => {
    setRefreshKey((value) => value + 1);
    void loadRefs();
  }, [loadRefs]);

  if (!company) {
    return <Notice message={L('Select an active company to use inventory.', 'ইনভেন্টরি ব্যবহার করতে একটি সক্রিয় কোম্পানি নির্বাচন করুন।')} tone="warning" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Server inventory subledger', 'সার্ভার ইনভেন্টরি সাবলেজার')}
        title={L('Stock, valuation and GL proof', 'স্টক, মূল্যায়ন ও জিএল প্রমাণ')}
        description={L(
          'Stock movements are immutable, company-scoped and posted with the inventory journal in one transaction. Negative stock is blocked by default; a controller may approve an explicit exception with a reason.',
          'স্টক মুভমেন্ট অপরিবর্তনীয়, কোম্পানি-সীমাবদ্ধ এবং একই লেনদেনে ইনভেন্টরি জার্নালসহ পোস্ট হয়। নেতিবাচক স্টক ডিফল্টে বন্ধ; নিয়ন্ত্রক কারণসহ স্পষ্ট ব্যতিক্রম অনুমোদন করতে পারেন।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand">{company.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{L('Precision', 'নির্ভুলতা')}: 4 dp</span>
          </>
        }
      />
      <nav className="flex flex-wrap gap-1.5" aria-label={L('Inventory sections', 'ইনভেন্টরি বিভাগ')}>
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const disabled = entry.key === 'PROOF' && !canViewProof;
          const active = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              disabled={disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => setTab(entry.key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-ql-control border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? 'border-ql-brand bg-ql-brand text-ql-brand-ink' : 'border-ql-border bg-ql-surface text-ql-ink hover:border-ql-border-strong hover:bg-ql-surface-muted'
              }`}
            >
              <Icon size={15} aria-hidden />
              {L(entry.en, entry.bn)}
            </button>
          );
        })}
      </nav>

      {error ? <ErrorBanner message={error} /> : null}
      {loadingRefs && refs.items.length === 0 ? <Notice message={L('Loading master data…', 'মাস্টার ডেটা লোড হচ্ছে…')} tone="info" /> : null}

      {tab === 'LEDGER' ? (
        <StockLedgerPanel companyId={companyId} refs={refs} canDispatch={canDispatch} canOverride={canOverride} refreshKey={refreshKey} onChanged={onChanged} />
      ) : null}
      {tab === 'VALUATION' ? <ValuationPanel companyId={companyId} refs={refs} refreshKey={refreshKey} /> : null}
      {tab === 'MUSHAK43' ? (
        <Suspense fallback={<RouteLoading label="Loading Mushak 4.3 Studio..." />}>
          <Mushak43Page
            companyId={companyId}
            refs={refs}
            canDispatch={canDispatch}
            canOverride={canOverride}
            refreshKey={refreshKey}
            onChanged={onChanged}
          />
        </Suspense>
      ) : null}
      {tab === 'PROOF' && canViewProof ? <ControlProofPanel companyId={companyId} refreshKey={refreshKey} /> : null}
      {tab === 'RECORD' ? (
        <MovementFormPanel companyId={companyId} refs={refs} canDispatch={canDispatch} canOverride={canOverride} onRecorded={onChanged} />
      ) : null}
    </div>
  );
}
