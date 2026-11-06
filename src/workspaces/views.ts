import type { ComponentType } from 'react';
import type { WorkspaceKey } from './registry';
import W01_ExecutiveCockpit from './W01_ExecutiveCockpit';
import W02_SalesMushak63 from './W02_SalesMushak63';
import W03_PurchasesWithholding from './W03_PurchasesWithholding';
import W04_TreasuryChallans66 from './W04_TreasuryChallans66';
import W05_VatRegisters91 from './W05_VatRegisters91';
import W06_BankingMfsReconcile from './W06_BankingMfsReconcile';
import W07_MassImportExportStudio from './W07_MassImportExportStudio';
import W08_IfrsStatementsStudio from './W08_IfrsStatementsStudio';
import W09_CloseAndControl from './W09_CloseAndControl';
import W10_PayrollLabourSuite from './W10_PayrollLabourSuite';
import W11_SecretarialGovernance from './W11_SecretarialGovernance';
import W12_RulePackAndCoreLab from './W12_RulePackAndCoreLab';

/**
 * Static workspace registry used by the lazily loaded authenticated shell and render tests. Keeping
 * it separate from the route shell prevents the public/auth entries from importing any workspace.
 */
export const WORKSPACE_VIEWS: Record<WorkspaceKey, ComponentType> = {
  W01: W01_ExecutiveCockpit,
  W02: W02_SalesMushak63,
  W03: W03_PurchasesWithholding,
  W04: W04_TreasuryChallans66,
  W05: W05_VatRegisters91,
  W06: W06_BankingMfsReconcile,
  W07: W07_MassImportExportStudio,
  W08: W08_IfrsStatementsStudio,
  W09: W09_CloseAndControl,
  W10: W10_PayrollLabourSuite,
  W11: W11_SecretarialGovernance,
  W12: W12_RulePackAndCoreLab,
};
