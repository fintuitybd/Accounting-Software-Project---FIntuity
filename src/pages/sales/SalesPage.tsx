import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, FilePlus2, FileText, Receipt, ScrollText, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { localized } from '../../core/i18n';
import { usePreferences } from '../../preferences/AppPreferences';
import { useAuth } from '../../auth/AuthContext';
import { setupApi } from '../../setup/api';
import { masterApi } from '../../masters/api';
import { salesApi, type SalesDocument, type SalesTaxPolicy } from '../../sales/api';
import { apiErrorMessage, ErrorBanner, Notice } from '../setup/setupUi';
import { PageHeader } from '../../shell/PageHeader';
import type { SalesRefs } from './salesRefs';
import { DocumentListPanel } from './DocumentListPanel';
import { DocumentDetailPanel } from './DocumentDetailPanel';
import { InvoiceFormPanel } from './InvoiceFormPanel';
import { ReceiptsPanel } from './ReceiptsPanel';
import { AgeingPanel } from './AgeingPanel';
import { VatRegisterPanel } from './VatRegisterPanel';
import { TaxPolicyPanel } from './TaxPolicyPanel';

type TabKey = 'INVOICES' | 'NEW' | 'CREDIT_NOTES' | 'RECEIPTS' | 'AGEING' | 'VAT' | 'TAX';

const TABS: Array<{ key: TabKey; en: string; bn: string; icon: typeof FileText; permission?: 'VIEW_REPORTS' | 'MANAGE_COMPANY_SETTINGS' }> = [
  { key: 'INVOICES', en: 'Invoices & AR', bn: 'চালান ও এআর', icon: FileText },
  { key: 'NEW', en: 'New invoice', bn: 'নতুন চালান', icon: FilePlus2 },
  { key: 'CREDIT_NOTES', en: 'Credit notes', bn: 'ক্রেডিট নোট', icon: ScrollText },
  { key: 'RECEIPTS', en: 'Receipts', bn: 'রিসিট', icon: Receipt },
  { key: 'AGEING', en: 'Ageing & statement', bn: 'এজিং ও বিবরণী', icon: CalendarClock, permission: 'VIEW_REPORTS' },
  { key: 'VAT', en: 'VAT register', bn: 'ভ্যাট রেজিস্টার', icon: TrendingUp, permission: 'VIEW_REPORTS' },
  { key: 'TAX', en: 'Tax policy', bn: 'কর নীতি', icon: ShieldCheck },
];

const EMPTY_REFS: SalesRefs = { parties: [], items: [], branches: [], warehouses: [], accounts: [], bankAccounts: [] };
const TAB_KEYS: readonly TabKey[] = ['INVOICES', 'NEW', 'CREDIT_NOTES', 'RECEIPTS', 'AGEING', 'VAT', 'TAX'];

function tabFromQuery(value: string | null): TabKey | null {
  return value && (TAB_KEYS as readonly string[]).includes(value) ? (value as TabKey) : null;
}

export default function SalesPage() {
  const { locale } = usePreferences();
  const auth = useAuth();
  const company = auth.activeCompany;
  const companyId = company?.id ?? '';
  const L = useCallback((en: string, bn: string) => localized(locale, en, bn), [locale]);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = tabFromQuery(searchParams.get('tab')) ?? (searchParams.get('new') === '1' ? 'NEW' : 'INVOICES');
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [refs, setRefs] = useState<SalesRefs>(EMPTY_REFS);
  const [policy, setPolicy] = useState<SalesTaxPolicy | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<SalesDocument | null>(null);
  const [editingDocument, setEditingDocument] = useState<SalesDocument | null>(null);
  const [creditFormOpen, setCreditFormOpen] = useState(false);
  const [receiptSeed, setReceiptSeed] = useState<{ partyId: string; invoiceId: string; key: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedDocumentId = selectedDocument?.id ?? null;

  // Deep links: the palette and dashboard use `?document=...` and `?tab=...`. The tab is derived
  // from the URL only on arrival/query change; manual tab clicks stay in-page and clear stale params.
  const requestedTab = tabFromQuery(searchParams.get('tab'));
  const requestedDocument = searchParams.get('document');
  useEffect(() => {
    if (!requestedTab) return;
    setTab(requestedTab);
    setSelectedDocument(null);
    setEditingDocument(null);
    setCreditFormOpen(false);
  }, [requestedTab]);

  useEffect(() => {
    if (!companyId || !requestedDocument) return undefined;
    let cancelled = false;
    setError(null);
    void salesApi
      .document(companyId, requestedDocument)
      .then((response) => {
        if (cancelled) return;
        setSelectedDocument(response.document);
        setTab(response.document.docType === 'CREDIT_NOTE' ? 'CREDIT_NOTES' : 'INVOICES');
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, requestedDocument]);

  useEffect(() => {
    if (searchParams.get('new') !== 'credit') return;
    setTab('CREDIT_NOTES');
    setCreditFormOpen(true);
    setSelectedDocument(null);
  }, [searchParams]);

  const canCreateDraft = auth.hasCompanyPermission('CREATE_COMMERCIAL_DRAFT');
  const canPost = auth.hasCompanyPermission('POST_TO_GL');
  const canApprove = auth.hasCompanyPermission('APPROVE_HIGH_VALUE');
  const canReverse = auth.hasCompanyPermission('REVERSE_POSTED_JOURNAL');
  const canViewReports = auth.hasCompanyPermission('VIEW_REPORTS');
  const canManageSettings = auth.hasCompanyPermission('MANAGE_COMPANY_SETTINGS');

  const loadRefs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [parties, items, branches, warehouses, accounts, bankAccounts, policyResponse] = await Promise.all([
        masterApi.parties(companyId, { type: 'CUSTOMER', pageSize: 100 }),
        masterApi.items(companyId, { includeInactive: false, pageSize: 100 }),
        masterApi.branches(companyId, false),
        masterApi.warehouses(companyId, { includeInactive: false }),
        setupApi.accounts(companyId),
        setupApi.bankAccounts(companyId),
        salesApi.taxPolicy(companyId),
      ]);
      setRefs({
        parties: parties.parties,
        items: items.items,
        branches: branches.branches,
        warehouses: warehouses.warehouses,
        accounts: accounts.accounts,
        bankAccounts: bankAccounts.bankAccounts,
      });
      setPolicy(policyResponse.policy);
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
    if (!companyId || !selectedDocumentId) return;
    let cancelled = false;
    void salesApi
      .document(companyId, selectedDocumentId)
      .then((response) => {
        if (!cancelled) setSelectedDocument(response.document);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, selectedDocumentId]);

  const openDocument = (documentId: string) => {
    setError(null);
    setSearchParams({ document: documentId });
  };


  const selectTab = (key: TabKey) => {
    setTab(key);
    setSelectedDocument(null);
    setEditingDocument(null);
    setCreditFormOpen(false);
    setSearchParams({ tab: key });
  };

  const onDocumentChanged = (document: SalesDocument) => {
    setSelectedDocument(document);
    setEditingDocument(null);
    setRefreshKey((value) => value + 1);
    void salesApi
      .taxPolicy(companyId)
      .then((response) => setPolicy(response.policy))
      .catch(() => undefined);
  };

  const openNewInvoice = () => {
    setEditingDocument(null);
    selectTab('NEW');
  };

  const openNewCredit = () => {
    setEditingDocument(null);
    setCreditFormOpen(true);
    setSelectedDocument(null);
    setTab('CREDIT_NOTES');
    setSearchParams({ tab: 'CREDIT_NOTES', new: 'credit' });
  };

  const closeDocument = () => {
    setSelectedDocument(null);
    const next = new URLSearchParams(searchParams);
    next.delete('document');
    setSearchParams(next);
  };

  const onRecordReceipt = (document: SalesDocument) => {
    setReceiptSeed({ partyId: document.partyId, invoiceId: document.id, key: Date.now() });
    setSelectedDocument(null);
    selectTab('RECEIPTS');
  };

  if (!company) {
    return <Notice message={L('Select an active company to use sales and receivables.', 'বিক্রয় ও প্রাপ্য ব্যবহার করতে একটি সক্রিয় কোম্পানি নির্বাচন করুন।')} tone="warning" />;
  }

  const visibleTabs = TABS.filter((entry) => {
    if (entry.permission === 'VIEW_REPORTS' && !canViewReports) return false;
    if (entry.permission === 'MANAGE_COMPANY_SETTINGS' && !canManageSettings) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={L('Server order-to-cash', 'সার্ভার অর্ডার-টু-ক্যাশ')}
        title={L('Sales, credit notes and receivables', 'বিক্রয়, ক্রেডিট নোট ও প্রাপ্য')}
        description={L(
          'Drafts persist on the server. Posting is one transaction: document number, statutory serial, AR open item, line-level tax evidence, stock/COGS and the journal. Credit notes are separate 6.7-style documents and receipts are separate allocations.',
          'খসড়া সার্ভারে সংরক্ষিত থাকে। পোস্টিং এক লেনদেন: ডকুমেন্ট নম্বর, স্ট্যাটিউটরি সিরিয়াল, এআর ওপেন আইটেম, লাইন-স্তরের কর প্রমাণ, স্টক/সিওজিএস ও জার্নাল। ক্রেডিট নোট আলাদা ৬.৭-ধাঁচের ডকুমেন্ট এবং রিসিট আলাদা বরাদ্দ।',
        )}
        meta={
          <>
            <span className="ql-badge ql-badge-brand">{company.legalName}</span>
            <span className="ql-badge ql-badge-neutral">{L('Currency', 'মুদ্রা')}: BDT Â· {L('poisha precision', 'পয়সা নির্ভুলতা')}</span>
            {canPost ? <span className="ql-badge ql-badge-success">{L('Posting enabled', 'পোস্টিং সক্রিয়')}</span> : <span className="ql-badge ql-badge-warning">{L('Read-only', 'শুধু পাঠযোগ্য')}</span>}
          </>
        }
        actions={
          canCreateDraft ? (
            <button type="button" className="ql-btn ql-btn-primary" onClick={openNewInvoice}>
              <FilePlus2 size={16} aria-hidden /> {L('New invoice', 'নতুন চালান')}
            </button>
          ) : null
        }
      />

      {policy && !policy.canPost ? (
        <div role="alert" className="flex items-start gap-2 rounded-ql border border-ql-warning/35 bg-ql-warning-soft px-3 py-2.5 text-[13px] text-ql-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-ql-warning" aria-hidden />
          <div>
            <p className="font-semibold">{L('Sales posting is blocked pending tax-policy approval', 'কর-নীতি অনুমোদনের আগে বিক্রয় পোস্টিং বন্ধ')}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ql-ink-muted">{policy.blockingReason ?? L('Record reviewer approval for the exact rule-pack version.', 'সঠিক রুল-প্যাক সংস্করণের জন্য পর্যালোচকের অনুমোদন সংরক্ষণ করুন।')}</p>
          </div>
        </div>
      ) : policy ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="ql-badge ql-badge-success"><ShieldCheck size={13} aria-hidden /> {L('Posting enabled', 'পোস্টিং সক্রিয়')}</span>
          <span className="text-[12px] text-ql-ink-muted">{L('Rule pack', 'রুল প্যাক')} {policy.pack.version} Â· {policy.approval?.reviewerName ?? policy.pack.reviewer}</span>
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-1.5" aria-label={L('Sales sections', 'বিক্রয় বিভাগ')}>
        {visibleTabs.map((entry) => {
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

      {error ? <ErrorBanner message={error} /> : null}
      {loading && refs.parties.length === 0 ? <Notice message={L('Loading sales master data and tax policyâ€¦', 'বিক্রয় মাস্টার ডেটা ও কর নীতি লোড হচ্ছে…')} tone="info" /> : null}

      {tab === 'INVOICES' ? (
        selectedDocument ? (
          <DocumentDetailPanel
            companyId={companyId}
            document={selectedDocument}
            canCreateDraft={canCreateDraft}
            canPost={canPost}
            canApprove={canApprove}
            canReverse={canReverse}
            onBack={closeDocument}
            onEdit={() => {
              setEditingDocument(selectedDocument);
              setTab('NEW');
            }}
            onChanged={onDocumentChanged}
            onNewReceipt={onRecordReceipt}
          />
        ) : (
          <DocumentListPanel
            companyId={companyId}
            docType="SALES_INVOICE"
            canCreate={canCreateDraft}
            onOpen={openDocument}
            onNew={openNewInvoice}
            refreshKey={refreshKey}
          />
        )
      ) : null}

      {tab === 'NEW' ? (
        <InvoiceFormPanel
          key={editingDocument?.id ?? 'new-invoice'}
          companyId={companyId}
          refs={refs}
          docType="SALES_INVOICE"
          initialDocument={editingDocument}
          onSaved={(document) => {
            setSelectedDocument(document);
            setTab('INVOICES');
            setSearchParams({ document: document.id });
            setRefreshKey((value) => value + 1);
          }}
          onCancel={() => selectTab('INVOICES')}
        />
      ) : null}

      {tab === 'CREDIT_NOTES' ? (
        selectedDocument ? (
          <DocumentDetailPanel
            companyId={companyId}
            document={selectedDocument}
            canCreateDraft={canCreateDraft}
            canPost={canPost}
            canApprove={canApprove}
            canReverse={canReverse}
            onBack={closeDocument}
            onEdit={() => {
              setEditingDocument(selectedDocument);
              setCreditFormOpen(true);
            }}
            onChanged={onDocumentChanged}
            onNewReceipt={onRecordReceipt}
          />
        ) : creditFormOpen ? (
          <InvoiceFormPanel
            key={editingDocument?.id ?? 'new-credit'}
            companyId={companyId}
            refs={refs}
            docType="CREDIT_NOTE"
            initialDocument={editingDocument}
            onSaved={(document) => {
              setCreditFormOpen(false);
              setSelectedDocument(document);
              setTab('CREDIT_NOTES');
              setSearchParams({ document: document.id });
              setRefreshKey((value) => value + 1);
            }}
            onCancel={() => {
              setCreditFormOpen(false);
              setEditingDocument(null);
            }}
          />
        ) : (
          <DocumentListPanel
            companyId={companyId}
            docType="CREDIT_NOTE"
            canCreate={canCreateDraft}
            onOpen={openDocument}
            onNew={openNewCredit}
            refreshKey={refreshKey}
          />
        )
      ) : null}

      {tab === 'RECEIPTS' ? (
        <ReceiptsPanel
          key={receiptSeed?.key ?? 'receipts'}
          companyId={companyId}
          refs={refs}
          canPost={canPost}
          canReverse={canReverse}
          initialPartyId={receiptSeed?.partyId ?? null}
          initialInvoiceId={receiptSeed?.invoiceId ?? null}
          onChanged={() => setRefreshKey((value) => value + 1)}
        />
      ) : null}

      {tab === 'AGEING' && canViewReports ? <AgeingPanel companyId={companyId} refs={refs} /> : null}
      {tab === 'VAT' && canViewReports ? <VatRegisterPanel companyId={companyId} /> : null}
      {tab === 'TAX' && policy ? (
        <TaxPolicyPanel
          companyId={companyId}
          policy={policy}
          accounts={refs.accounts}
          canManage={canManageSettings}
          onApproved={(next) => setPolicy(next)}
        />
      ) : null}

      <footer className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5 text-[12px] leading-relaxed text-ink-500">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink-700"><Sparkles size={13} /> {L('What this phase does not do', 'এই ফেজ যা করে না')}</span>{' '}
        {L(
          'Quotation, sales-order and delivery-challan stages are intentionally not shown because they are not persisted server documents in this release. Receipts do not claim bank reconciliation.',
          'কোটেশন, বিক্রয় আদেশ ও ডেলিভারি চালান ধাপ ইচ্ছাকৃতভাবে দেখানো হয় না কারণ এগুলো এই সংস্করণে সার্ভারে সংরক্ষিত নয়। রিসিট ব্যাংক পুনর্মিলন দাবি করে না।',
        )}
      </footer>
    </div>
  );
}

