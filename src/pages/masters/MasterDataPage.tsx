import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Package, Users, Warehouse } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import { PartyPanel } from './PartyPanel';
import { ItemPanel } from './ItemPanel';
import { BranchPanel, WarehousePanel } from './LocationPanels';

type TabKey = 'PARTIES' | 'ITEMS' | 'WAREHOUSES' | 'BRANCHES';
const TAB_KEYS: readonly TabKey[] = ['PARTIES', 'ITEMS', 'WAREHOUSES', 'BRANCHES'];

function tabFromQuery(value: string | null): TabKey | null {
  return value && (TAB_KEYS as readonly string[]).includes(value) ? (value as TabKey) : null;
}

const TABS: Array<{ key: TabKey; en: string; bn: string; icon: typeof Users }> = [
  { key: 'PARTIES', en: 'Parties', bn: 'পক্ষ', icon: Users },
  { key: 'ITEMS', en: 'Items', bn: 'আইটেম', icon: Package },
  { key: 'WAREHOUSES', en: 'Warehouses', bn: 'গুদাম', icon: Warehouse },
  { key: 'BRANCHES', en: 'Branches', bn: 'শাখা', icon: Building2 },
];

export default function MasterDataPage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = tabFromQuery(searchParams.get('tab'));
  const requestedSearch = searchParams.get('search') ?? '';
  const [tab, setTab] = useState<TabKey>(requestedTab ?? 'PARTIES');
  const company = auth.activeCompany;

  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (key: TabKey) => {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    next.delete('search');
    setSearchParams(next, { replace: true });
  };

  if (!company) {
    return <Notice message={L('Select an active company to manage master data.', 'মাস্টার ডেটা পরিচালনা করতে একটি সক্রিয় কোম্পানি নির্বাচন করুন।')} tone="warning" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Server master data', 'সার্ভার মাস্টার ডেটা')}
        title={L('Parties, items and stock locations', 'পক্ষ, আইটেম ও স্টক অবস্থান')}
        description={L(
          'Every change is company-scoped, permission-checked and audited with before/after values. Referenced masters are deactivated, never deleted.',
          'প্রতিটি পরিবর্তন কোম্পানি-সীমাবদ্ধ, অনুমতি-যাচাইকৃত এবং আগের/পরের মানসহ অডিট করা হয়। ব্যবহৃত মাস্টার নিষ্ক্রিয় করা হয়, মুছে ফেলা হয় না।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand">{company.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{company.role}</span>
          </>
        }
      />
      <nav className="flex flex-wrap gap-1.5" aria-label={L('Master data sections', 'মাস্টার ডেটা বিভাগ')}>
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => selectTab(entry.key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-ql-control border px-3 text-[13px] font-semibold transition-colors ${
                active ? 'border-ql-brand bg-ql-brand text-ql-brand-ink' : 'border-ql-border bg-ql-surface text-ql-ink hover:border-ql-border-strong hover:bg-ql-surface-muted'
              }`}
            >
              <Icon size={15} aria-hidden />
              {L(entry.en, entry.bn)}
            </button>
          );
        })}
      </nav>

      {tab === 'PARTIES' ? <PartyPanel initialSearch={requestedSearch} /> : null}
      {tab === 'ITEMS' ? <ItemPanel initialSearch={requestedSearch} /> : null}
      {tab === 'WAREHOUSES' ? <WarehousePanel /> : null}
      {tab === 'BRANCHES' ? <BranchPanel /> : null}
    </div>
  );
}
