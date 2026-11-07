import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, FilePlus2, FileText, Landmark, ReceiptText, ShieldCheck } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import { setupApi } from '../../setup/api';
import { masterApi } from '../../masters/api';
import type { PurchaseDocument, PurchaseDocumentType } from '../../purchases/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import type { PurchaseRefs } from './purchasesRefs';
import { PurchaseListPanel } from './PurchaseListPanel';
import { PurchaseFormPanel } from './PurchaseFormPanel';
import { PurchaseDetailPanel } from './PurchaseDetailPanel';
import { PaymentsPanel } from './PaymentsPanel';
import { AgeingAndStatementPanel, WithholdingPanel } from './PayablesPanel';
import { TaxPolicyPanel } from './TaxPolicyPanel';

type TabKey = 'BILLS' | 'NEW_BILL' | 'NEW_EXPENSE' | 'PAYMENTS' | 'AGEING' | 'WITHHOLDING' | 'TAX';

const TAB_KEYS: readonly TabKey[] = ['BILLS', 'NEW_BILL', 'NEW_EXPENSE', 'PAYMENTS', 'AGEING', 'WITHHOLDING', 'TAX'];

function tabFromQuery(value: string | null): TabKey | null {
  return value && (TAB_KEYS as readonly string[]).includes(value) ? (value as TabKey) : null;
}

const EMPTY_REFS: PurchaseRefs = {
  suppliers: [],
  items: [],
  branches: [],
  warehouses: [],
  accounts: [],
  bankAccounts: [],
};

export default function PurchasesPage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedNew = searchParams.get('new');
  const requestedTab = tabFromQuery(searchParams.get('tab'));
  const requestedDocument = searchParams.get('document');
  const [tab, setTab] = useState<TabKey>(
    requestedTab ?? (requestedNew === 'expense' ? 'NEW_EXPENSE' : requestedNew === '1' ? 'NEW_BILL' : 'BILLS'),
  );
  const [refs, setRefs] = useState<PurchaseRefs>(EMPTY_REFS);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState<PurchaseDocument | null>(null);
  const [paymentSeed, setPaymentSeed] = useState<{ partyId: string; documentId: string; key: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedTab) return;
    setTab(requestedTab);
    setSelectedDocumentId(null);
    setEditingDocument(null);
  }, [requestedTab]);

  useEffect(() => {
    if (!companyId || !requestedDocument) return;
    setTab('BILLS');
    setSelectedDocumentId(requestedDocument);
    setEditingDocument(null);
  }, [companyId, requestedDocument]);

  const canCreateDraft = auth.hasCompanyPermission('CREATE_COMMERCIAL_DRAFT');
  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canReverse = auth.hasCompanyPermission('REVERSE_POSTED_JOURNAL');
  const canViewReports = auth.hasCompanyPermission('VIEW_REPORTS');
  const canManageSettings = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');

  const loadRefs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [parties, items, branches, warehouses, accounts, bankAccounts] = await Promise.all([
        masterApi.parties(companyId, { pageSize: 100 }),
        masterApi.items(companyId, { includeInactive: false, pageSize: 100 }),
        masterApi.branches(companyId, false),
        masterApi.warehouses(companyId, { includeInactive: false }),
        setupApi.accounts(companyId),
        setupApi.bankAccounts(companyId),
      ]);
      setRefs({
        suppliers: parties.parties,
        items: items.items,
        branches: branches.branches,
        warehouses: warehouses.warehouses,
        accounts: accounts.accounts,
        bankAccounts: bankAccounts.bankAccounts,
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    if (!requestedNew) return;
    setTab(requestedNew === 'expense' ? 'NEW_EXPENSE' : 'NEW_BILL');
    setSelectedDocumentId(null);
    setEditingDocument(null);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [requestedNew, searchParams, setSearchParams]);

  const selectTab = (key: TabKey) => {
    setTab(key);
    setSelectedDocumentId(null);
    setEditingDocument(null);
    setSearchParams({ tab: key });
  };

  const openDocument = (documentId: string) => {
    setSelectedDocumentId(documentId);
    setEditingDocument(null);
    setSearchParams({ document: documentId });
  };

  const closeDocument = () => {
    setSelectedDocumentId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('document');
    setSearchParams(next);
  };

  const onSaved = (document: PurchaseDocument) => {
    setSelectedDocumentId(document.id);
    setEditingDocument(null);
    setTab('BILLS');
    setSearchParams({ document: document.id });
    setRefreshKey((value) => value + 1);
  };

  const onChanged = () => {
    setRefreshKey((value) => value + 1);
  };

  const onPay = (document: PurchaseDocument) => {
    setPaymentSeed({ partyId: document.partyId, documentId: document.id, key: Date.now() });
    selectTab('PAYMENTS');
  };

  const tabs: Array<{ key: TabKey; en: string; bn: string; icon: typeof FileText; permission?: boolean }> = [
    { key: 'BILLS', en: 'Bills & AP', bn: 'বিল ও প্রদেয়', icon: FileText },
    { key: 'NEW_BILL', en: 'New bill', bn: 'নতুন সরবরাহকারী বিল', icon: FilePlus2, permission: canCreateDraft },
    { key: 'NEW_EXPENSE', en: 'Expense voucher', bn: 'ব্যয় ভাউচার', icon: ReceiptText, permission: canCreateDraft },
    { key: 'PAYMENTS', en: 'Payments', bn: 'সরবরাহকারী পরিশোধ', icon: Landmark },
    { key: 'AGEING', en: 'Ageing & statement', bn: 'প্রদেয় বয়স ও বিবরণী', icon: CalendarClock, permission: canViewReports },
    { key: 'WITHHOLDING', en: 'Withholding queue', bn: 'উৎসে কর দায়', icon: ShieldCheck, permission: canViewReports },
    { key: 'TAX', en: 'Tax policy', bn: 'ক্রয় কর নীতি', icon: ShieldCheck, permission: canManageSettings },
  ];

  if (!companyId) {
    return (
      <section className="ql-card mx-auto mt-6 max-w-3xl p-6">
        <h2 className="text-[22px] font-semibold text-ink-900">{L('No company selected', 'কোনো কোম্পানি নির্বাচিত নেই')}</h2>
        <p className="mt-2 text-[14px] text-ink-500">
          {L('Choose a company before recording purchases.', 'ক্রয় লিপিবদ্ধ করার আগে একটি কোম্পানি নির্বাচন করুন।')}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Procure to pay', 'ক্রয় থেকে পরিশোধ')}
        title={L('Purchases, bills & payables', 'ক্রয়, বিল ও প্রদেয়')}
        description={L(
          'Supplier bills and expense vouchers with line-level inventory/expense classification, input VAT, AP allocation and withholding. A stock line is a real receipt when the bill is posted. Purchase orders, a separate GRN and three-way matching are not implemented and are not shown.',
          'সরবরাহকারী বিল ও ব্যয় ভাউচার, লাইনভিত্তিক মজুদ/ব্যয় শ্রেণিবিন্যাস, ইনপুট ভ্যাট, প্রদেয় হিসাব ও উৎসে কর। বিল পোস্ট হলে স্টক লাইন প্রকৃত মালগ্রহণ হিসেবে গণ্য হয়। ক্রয় আদেশ, পৃথক জিআরএন ও থ্রি-ওয়ে মিলিং এই সংস্করণে নেই এবং দেখানো হয় না।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand">{company?.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{L('Currency', 'মুদ্রা')}: BDT</span>
            {canPost ? <span className="ql-badge ql-badge-success">{L('Posting enabled', 'পোস্টিং সক্রিয়')}</span> : <span className="ql-badge ql-badge-warning">{L('Read-only', 'শুধু পাঠযোগ্য')}</span>}
          </>
        }
        actions={
          <>
            {canCreateDraft ? (
              <button type="button" className="ql-btn ql-btn-primary" onClick={() => selectTab('NEW_BILL')}>
                <FilePlus2 size={16} aria-hidden /> {L('New bill', 'নতুন বিল')}
              </button>
            ) : null}
            {canCreateDraft ? (
              <button type="button" className="ql-btn ql-btn-secondary" onClick={() => selectTab('NEW_EXPENSE')}>
                <ReceiptText size={16} aria-hidden /> {L('Expense voucher', 'ব্যয় ভাউচার')}
              </button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      <Notice
        message={L(
          'No fake three-way match is displayed. Stock moves only when a bill with stock lines is posted, and the bill/GRN quantities are not defaulted from each other.',
          'কোনো কৃত্রিম থ্রি-ওয়ে মিলিং দেখানো হয় না। স্টক লাইনসহ বিল পোস্ট হলেই কেবল স্টক চলাচল করে, এবং বিল/জিআরএন পরিমাণ একে অপর থেকে অনুমান করা হয় না।',
        )}
      />

      <nav className="flex flex-wrap gap-1.5" aria-label={L('Purchases sections', 'ক্রয় বিভাগসমূহ')}>
        {tabs
          .filter((entry) => entry.permission !== false)
          .map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => selectTab(entry.key)}
                aria-current={tab === entry.key ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition ${
                  tab === entry.key
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-line bg-surface/70 text-ink-600 hover:border-brand/30 hover:text-ink-900'
                }`}
              >
                <Icon size={15} />
                {L(entry.en, entry.bn)}
              </button>
            );
          })}
      </nav>

      {loading ? <p className="py-6 text-center text-[13px] text-ink-500">{L('Loading purchase references…', 'ক্রয় তথ্য লোড হচ্ছে…')}</p> : null}

      {tab === 'BILLS' ? (
        selectedDocumentId ? (
          <PurchaseDetailPanel
            companyId={companyId}
            documentId={selectedDocumentId}
            canPost={canPost}
            canReverse={canReverse}
            canApprove={canApprove}
            canEdit={canCreateDraft}
            onEdit={(document) => {
              setEditingDocument(document);
              setTab(document.docType === 'EXPENSE_VOUCHER' ? 'NEW_EXPENSE' : 'NEW_BILL');
            }}
            onChanged={onChanged}
            onPay={onPay}
            onBack={closeDocument}
          />
        ) : (
          <PurchaseListPanel
            companyId={companyId}
            refreshKey={refreshKey}
            onSelect={openDocument}
            onCreate={(type: PurchaseDocumentType) => selectTab(type === 'EXPENSE_VOUCHER' ? 'NEW_EXPENSE' : 'NEW_BILL')}
          />
        )
      ) : null}

      {tab === 'NEW_BILL' || tab === 'NEW_EXPENSE' ? (
        <PurchaseFormPanel
          companyId={companyId}
          refs={refs}
          docType={tab === 'NEW_EXPENSE' ? 'EXPENSE_VOUCHER' : 'PURCHASE_BILL'}
          initialDocument={editingDocument}
          onSaved={onSaved}
          onCancel={() => {
            if (editingDocument) {
              setSelectedDocumentId(editingDocument.id);
              setEditingDocument(null);
              setTab('BILLS');
            } else {
              selectTab('BILLS');
            }
          }}
        />
      ) : null}

      {tab === 'PAYMENTS' ? (
        <PaymentsPanel
          companyId={companyId}
          refs={refs}
          seed={paymentSeed}
          canPost={canPost}
          canReverse={canReverse}
          canApprove={canApprove}
          canViewReports={canViewReports}
          onChanged={onChanged}
        />
      ) : null}

      {tab === 'AGEING' ? <AgeingAndStatementPanel companyId={companyId} refs={refs} /> : null}
      {tab === 'WITHHOLDING' ? <WithholdingPanel companyId={companyId} /> : null}
      {tab === 'TAX' ? <TaxPolicyPanel companyId={companyId} refs={refs} canManage={canManageSettings} /> : null}
    </div>
  );
}
