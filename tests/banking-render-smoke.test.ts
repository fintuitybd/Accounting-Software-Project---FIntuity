import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider, createDemoMe } from '../src/auth/AuthContext';
import { VaultProvider } from '../src/context/VaultContext';
import { AppPreferencesProvider } from '../src/preferences/AppPreferences';
import type { BankAccount, FiscalPeriod, SetupAccount } from '../src/setup/api';
import type { Party } from '../src/masters/api';
import BankingPage from '../src/pages/banking/BankingPage';
import { ImportPanel } from '../src/pages/banking/ImportPanel';
import { LineWorkbenchPanel } from '../src/pages/banking/LineWorkbenchPanel';
import { ReconciliationPanel } from '../src/pages/banking/ReconciliationPanel';
import { FeeRulesPanel } from '../src/pages/banking/FeeRulesPanel';
import { TransfersPanel } from '../src/pages/banking/TransfersPanel';

const DemoAuthProvider = AuthProvider as ComponentType<{
  demoModeOverride?: boolean;
  initialMe?: ReturnType<typeof createDemoMe>;
  children?: ReactNode;
}>;
const DemoVaultProvider = VaultProvider as ComponentType<{ demoMode: boolean; children?: ReactNode }>;

const BANK: BankAccount = {
  id: '00000000-0000-4000-8000-000000000101',
  companyId: '00000000-0000-4000-8000-000000000001',
  name: 'Test Bank',
  kind: 'BANK',
  provider: 'Test Provider',
  maskedNumber: '•••• 1001',
  branch: 'Dhaka',
  currency: 'BDT',
  glAccountId: '00000000-0000-4000-8000-000000000201',
  glAccountCode: '1010',
  glAccountName: 'Test bank GL',
  openingPoisha: '0',
  openingBdt: '0.00',
  status: 'ACTIVE',
  isPrincipal: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ACCOUNTS: SetupAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    companyId: BANK.companyId,
    code: '1010',
    nameEn: 'Test bank GL',
    nameBn: null,
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    ifrsCategory: 'NA_BALANCE_SHEET',
    parentId: null,
    parentCode: null,
    controlSubledger: 'BANK_MFS',
    currency: 'BDT',
    taxMapping: {},
    isActive: true,
    isControl: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    companyId: BANK.companyId,
    code: '5820',
    nameEn: 'Bank charges',
    nameBn: null,
    accountType: 'EXPENSE',
    subCategory: 'FINANCE_COST',
    ifrsCategory: 'NA_BALANCE_SHEET',
    parentId: null,
    parentCode: null,
    controlSubledger: 'NONE',
    currency: 'BDT',
    taxMapping: {},
    isActive: true,
    isControl: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const PERIODS: FiscalPeriod[] = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    companyId: BANK.companyId,
    fiscalYearId: '00000000-0000-4000-8000-000000000302',
    code: '2026-01',
    label: 'January 2026',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    status: 'OPEN',
    closedAt: null,
    lockedAt: null,
    reopenedReason: null,
  },
];

const PARTIES: Party[] = [
  {
    id: '00000000-0000-4000-8000-000000000401',
    companyId: BANK.companyId,
    code: 'CUS-001',
    nameEn: 'Test Customer',
    nameBn: null,
    type: 'CUSTOMER',
    bin: null,
    tin: null,
    addressEn: null,
    addressBn: null,
    phone: null,
    email: null,
    creditDays: 0,
    creditLimitPoisha: '0',
    creditLimitBdt: '0.00',
    isWithholdingBuyer: false,
    isGovernment: false,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function Providers({ children }: { children: ReactNode }) {
  return createElement(
    DemoAuthProvider,
    { demoModeOverride: true, initialMe: createDemoMe() },
    createElement(
      DemoVaultProvider,
      { demoMode: true },
      createElement(AppPreferencesProvider, { applyDocument: false, children }),
    ),
  );
}

function RouterProviders({ children }: { children: ReactNode }) {
  return createElement(Providers, null, createElement(MemoryRouter, null, children));
}

describe('banking screen render smoke', () => {
  it('renders the server-backed banking shell', () => {
    const html = renderToString(createElement(RouterProviders, null, createElement(BankingPage)));
    expect(html.length).toBeGreaterThan(200);
    expect(html).not.toContain('undefined');
  });

  it('renders the import, workbench, reconciliation, fee and transfer panels without throwing', () => {
    const panels = [
      createElement(ImportPanel, {
        companyId: BANK.companyId,
        bankAccountId: BANK.id,
        bankName: BANK.name,
        canPost: true,
        onImported: () => undefined,
      }),
      createElement(LineWorkbenchPanel, {
        companyId: BANK.companyId,
        bank: BANK,
        accounts: ACCOUNTS,
        parties: PARTIES,
        canPost: true,
        canApprove: true,
        canView: true,
        refreshKey: 0,
        onChanged: () => undefined,
      }),
      createElement(ReconciliationPanel, {
        companyId: BANK.companyId,
        bankAccountId: BANK.id,
        bankName: BANK.name,
        periods: PERIODS,
        periodId: PERIODS[0]!.id,
        onPeriodChange: () => undefined,
        canPrepare: true,
        canReview: true,
        canExport: true,
        refreshKey: 0,
        onChanged: () => undefined,
      }),
      createElement(FeeRulesPanel, {
        companyId: BANK.companyId,
        banks: [BANK],
        accounts: ACCOUNTS,
        selectedBankId: BANK.id,
        canManage: true,
        refreshKey: 0,
        onChanged: () => undefined,
      }),
      createElement(TransfersPanel, {
        companyId: BANK.companyId,
        banks: [BANK, { ...BANK, id: '00000000-0000-4000-8000-000000000102', name: 'Target Bank' }],
        canPost: true,
        canReverse: true,
        refreshKey: 0,
        onChanged: () => undefined,
      }),
    ];
    for (const panel of panels) {
      const html = renderToString(createElement(Providers, null, panel));
      expect(html.length).toBeGreaterThan(500);
      expect(html).not.toContain('undefined');
    }
  });
});
