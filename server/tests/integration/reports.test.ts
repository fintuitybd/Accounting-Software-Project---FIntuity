import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authHeaders,
  login,
  seedCompanyMembership,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';

const databaseAvailable = Boolean(testDatabaseUrl());
const TAX_PACK = 'bd-2026-v1';

type PeriodKey = 'october' | 'november' | 'december';
type AccountKey =
  | 'bank'
  | 'ar'
  | 'inventory'
  | 'inputVat'
  | 'ap'
  | 'outputVat'
  | 'vdsPayable'
  | 'tdsPayable'
  | 'reverseCharge'
  | 'capital'
  | 'reserves'
  | 'revenue'
  | 'revenueTrading'
  | 'cogs'
  | 'opex'
  | 'finance'
  | 'tax';

interface Fixture {
  organisationId: string;
  companyId: string;
  otherCompanyId: string;
  ownerCookies: AuthCookies;
  accountantCookies: AuthCookies;
  auditorCookies: AuthCookies;
  operatorCookies: AuthCookies;
  ownerId: string;
  branchId: string;
  partyId: string;
  supplierId: string;
  itemId: string;
  warehouseId: string;
  bankAccountId: string;
  accounts: Record<AccountKey, string>;
  periods: Record<PeriodKey, string>;
  journals: Record<string, string>;
  documents: Record<string, string>;
}

describe.skipIf(!databaseAvailable)('Phase 11 reports, VAT registers and statements', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let fixture: Fixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
    fixture = await createFixture(database, app);
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  async function get(cookies: AuthCookies, path: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/companies/${fixture.companyId}${path}`,
      headers: authHeaders(cookies),
    });
  }

  it('serves the report catalog with explicit period, branch and template review status', async () => {
    const response = await get(fixture.ownerCookies, '/reports/catalog');
    expect(response.statusCode, response.body).toBe(200);
    const catalog = response.json().catalog;
    expect(catalog.periods).toHaveLength(3);
    expect(catalog.branches[0].code).toBe('HQ');
    expect(catalog.definitions.find((entry: { key: string }) => entry.key === 'PROFIT_AND_LOSS').periodSemantics).toBe(
      'RANGE',
    );
    expect(catalog.definitions.find((entry: { key: string }) => entry.key === 'BALANCE_SHEET').periodSemantics).toBe(
      'AS_OF',
    );
    expect(catalog.templates.find((entry: { key: string }) => entry.key === 'VAT_9_1_DRAFT').reviewStatus).toBe(
      'PENDING_TAX_COUNSEL',
    );
    expect(catalog.templates.find((entry: { key: string }) => entry.key === 'MANAGEMENT_ACCOUNTS').labelEn).toContain(
      'unaudited',
    );
  });

  it('applies company and branch scope to the same report', async () => {
    const all = await get(fixture.ownerCookies, `/reports/profit-and-loss?periodId=${fixture.periods.november}`);
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().report.totals.revenuePoisha).toBe('13000000');

    const branch = await get(
      fixture.ownerCookies,
      `/reports/profit-and-loss?periodId=${fixture.periods.november}&branchId=${fixture.branchId}`,
    );
    expect(branch.statusCode, branch.body).toBe(200);
    expect(branch.json().report.totals.revenuePoisha).toBe('13000000');
    expect(branch.json().report.scope.branchCode).toBe('HQ');

    const unassigned = await get(
      fixture.ownerCookies,
      `/reports/profit-and-loss?periodId=${fixture.periods.november}&branchId=UNASSIGNED`,
    );
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    expect(unassigned.json().report.totals.revenuePoisha).toBe('0');
    expect(unassigned.json().report.scope.branchScope).toBe('UNASSIGNED');
  });

  it('uses the selected month and never labels a monthly P&L as a year', async () => {
    const october = await get(fixture.ownerCookies, `/reports/profit-and-loss?periodId=${fixture.periods.october}`);
    expect(october.statusCode, october.body).toBe(200);
    expect(october.json().report.titleEn).toContain('for the month ended 31 October 2026');
    expect(october.json().report.titleEn).not.toContain('year ended');
    expect(october.json().report.totals.revenuePoisha).toBe('0');
    expect(october.json().report.template.labelEn).toContain('unaudited');

    const november = await get(fixture.ownerCookies, `/reports/profit-and-loss?periodId=${fixture.periods.november}`);
    expect(november.statusCode, november.body).toBe(200);
    expect(november.json().report.titleEn).toContain('for the month ended 30 November 2026');
    expect(november.json().report.totals.revenuePoisha).toBe('13000000');
    expect(november.json().report.totals.operatingExpensesPoisha).toBe('1000000');
    expect(november.json().report.totals.profitForPeriodPoisha).toBe('12000000');
    expect(november.json().report.scope.comparativeFrom).toBe('2026-10-01');
    expect(november.json().report.scope.comparativeTo).toBe('2026-10-31');
    expect(november.json().report.canExport).toBe(true);

    const december = await get(fixture.ownerCookies, `/reports/profit-and-loss?periodId=${fixture.periods.december}`);
    expect(december.statusCode, december.body).toBe(200);
    expect(december.json().report.totals.revenuePoisha).toBe('0');
  });

  it('produces a balanced balance sheet and a cash-flow statement that reconciles without a plug', async () => {
    const balanceSheet = await get(fixture.ownerCookies, `/reports/balance-sheet?periodId=${fixture.periods.november}`);
    expect(balanceSheet.statusCode, balanceSheet.body).toBe(200);
    const bs = balanceSheet.json().report;
    expect(bs.totals.totalAssetsPoisha).toBe('122050000');
    expect(bs.totals.totalEquityAndLiabilitiesPoisha).toBe('122050000');
    expect(bs.totals.imbalancePoisha).toBe('0');
    expect(bs.checks.find((entry: { key: string }) => entry.key === 'BALANCE_SHEET_BALANCES').passed).toBe(true);
    expect(bs.canExport).toBe(true);

    const cashFlow = await get(fixture.ownerCookies, `/reports/cash-flow?periodId=${fixture.periods.november}`);
    expect(cashFlow.statusCode, cashFlow.body).toBe(200);
    const cf = cashFlow.json().report;
    expect(cf.method).toBe('DIRECT');
    expect(cf.openingCashPoisha).toBe('100000000');
    expect(cf.closingCashPoisha).toBe('104000000');
    expect(cf.netChangePoisha).toBe('4000000');
    expect(cf.checks.find((entry: { key: string }) => entry.key === 'CASH_FLOW_RECONCILES').passed).toBe(true);
    expect(
      cf.sections
        .flatMap((section: { lines: Array<{ accountNameEn: string }> }) => section.lines)
        .some((line: { accountNameEn: string }) => line.accountNameEn.includes('other working capital')),
    ).toBe(false);
    expect(cf.canExport).toBe(true);

    const equity = await get(fixture.ownerCookies, `/reports/changes-in-equity?periodId=${fixture.periods.november}`);
    expect(equity.statusCode, equity.body).toBe(200);
    expect(equity.json().report.closingEquityPoisha).toBe('116000000');
    expect(
      equity.json().report.checks.find((entry: { key: string }) => entry.key === 'EQUITY_TIES_TO_BALANCE_SHEET').passed,
    ).toBe(true);
  });

  it('proves the trial balance and drills a report line to journals and the reversed source', async () => {
    const trial = await get(fixture.ownerCookies, `/reports/trial-balance?periodId=${fixture.periods.november}`);
    expect(trial.statusCode, trial.body).toBe(200);
    expect(trial.json().report.trialBalance.balanced).toBe(true);
    expect(trial.json().report.trialBalance.totals.differencePoisha).toBe('0');

    const ledger = await get(
      fixture.ownerCookies,
      `/reports/general-ledger/${fixture.accounts.revenue}?from=2026-10-01&to=2026-10-31`,
    );
    expect(ledger.statusCode, ledger.body).toBe(200);
    const lines = ledger.json().report.lines;
    expect(lines.length).toBe(2);
    const original = lines.find((line: { status: string }) => line.status === 'REVERSED');
    const reversal = lines.find(
      (line: { status: string; journalId: string }) =>
        line.status === 'POSTED' && line.journalId !== original?.journalId,
    );
    expect(original).toBeTruthy();
    expect(reversal).toBeTruthy();
    expect(original.journalId).not.toBe(reversal.journalId);

    const journal = await get(fixture.ownerCookies, `/journals/${original.journalId}`);
    expect(journal.statusCode, journal.body).toBe(200);
    expect(journal.json().journal.status).toBe('REVERSED');
    expect(journal.json().journal.reversalReason).toContain('Reversed for period-boundary test');
    expect(journal.json().journal.sourceModule).toBe('SALES');
    expect(journal.json().journal.sourceDocId).toBe(fixture.documents.reversedInvoice);
    expect(journal.json().journal.branchCode).toBe('HQ');
    expect(journal.json().journal.sourceEvidence.kind).toBe('SALES_DOCUMENT');
    expect(journal.json().journal.sourceEvidence.reference).toBe('INV-2026-0001');
    expect(journal.json().journal.sourceEvidence.taxDecisionState).toBe('SUPPORTED');
    expect(journal.json().journal.sourceEvidence.rulePackVersion).toBe(TAX_PACK);

    const manual = await get(fixture.ownerCookies, `/journals/${fixture.journals.capital}`);
    expect(manual.statusCode, manual.body).toBe(200);
    expect(manual.json().journal.sourceEvidence.kind).toBe('MANUAL');
    expect(Array.isArray(manual.json().journal.auditTrail)).toBe(true);
  });

  it('excludes a reversed invoice from the VAT register while keeping the linked reversal in the GL', async () => {
    const october = await get(fixture.ownerCookies, `/reports/vat-sales-register?periodId=${fixture.periods.october}`);
    expect(october.statusCode, october.body).toBe(200);
    expect(october.json().report.rows).toHaveLength(0);
    expect(october.json().report.totals.vatPoisha).toBe('0');
    expect(october.json().report.totals.reversedDocumentCount).toBe(1);

    const november = await get(
      fixture.ownerCookies,
      `/reports/vat-sales-register?periodId=${fixture.periods.november}`,
    );
    expect(november.statusCode, november.body).toBe(200);
    const rows = november.json().report.rows as Array<{
      documentType: string;
      statutorySerial: string | null;
      vatPoisha: string;
      taxCategory: string;
    }>;
    expect(rows.some((row) => row.documentType === 'CREDIT_NOTE' && row.vatPoisha.startsWith('-'))).toBe(true);
    expect(rows.some((row) => row.taxCategory === 'TRADING_5')).toBe(true);
    expect(rows.some((row) => row.statutorySerial === 'M63-2026-0002')).toBe(true);
    expect(november.json().report.totals.vatPoisha).toBe('1450000');
    expect(november.json().report.totals.basePoisha).toBe('13000000');
    expect(november.json().report.totals.creditNoteVatPoisha).toBe('300000');
  });

  it('produces draft VAT 9.1 with zero variance, a DRAFT watermark and no filing claim', async () => {
    const response = await get(fixture.ownerCookies, `/reports/vat-return?periodId=${fixture.periods.november}`);
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json().report;
    expect(report.filing.status).toBe('DRAFT');
    expect(report.filing.canFile).toBe(false);
    expect(report.filing.watermark).toBe('DRAFT — NOT FILED');
    expect(report.filing.filingClaim).toBe('NONE');
    expect(report.template.reviewStatus).toBe('PENDING_TAX_COUNSEL');
    expect(report.zeroVariance).toBe(true);
    expect(report.canExport).toBe(true);
    expect(report.glProof.outputVatGlPoisha).toBe('1450000');
    expect(report.glProof.inputVatGlPoisha).toBe('600000');
    expect(report.totals.netPayablePoisha).toBe('850000');
    expect(report.exceptions.some((entry: { code: string }) => entry.code === 'OUTPUT_VAT_GL_VARIANCE')).toBe(false);
    expect(JSON.stringify(report)).not.toContain('auditor');
    expect(JSON.stringify(report)).not.toContain('filed successfully');
  });

  it('produces AR/AP ageing, stock valuation and a withholding register with control proofs', async () => {
    const ar = await get(fixture.ownerCookies, `/reports/ar-ageing?periodId=${fixture.periods.november}`);
    expect(ar.statusCode, ar.body).toBe(200);
    expect(ar.json().report.ageing.totals.NET).toBe('9450000');
    expect(ar.json().report.ageing.proof.agrees).toBe(true);
    expect(ar.json().report.canExport).toBe(true);

    const ap = await get(fixture.ownerCookies, `/reports/ap-ageing?periodId=${fixture.periods.november}`);
    expect(ap.statusCode, ap.body).toBe(200);
    expect(ap.json().report.ageing.totals.NET).toBe('3600000');
    expect(ap.json().report.ageing.proof.agrees).toBe(true);

    const stock = await get(fixture.ownerCookies, `/reports/stock-valuation?periodId=${fixture.periods.november}`);
    expect(stock.statusCode, stock.body).toBe(200);
    expect(stock.json().report.totalValuePoisha).toBe('8000000');
    expect(stock.json().report.glProof.differencePoisha).toBe('0');
    expect(stock.json().report.canExport).toBe(true);

    const withholding = await get(
      fixture.ownerCookies,
      `/reports/withholding-register?periodId=${fixture.periods.november}`,
    );
    expect(withholding.statusCode, withholding.body).toBe(200);
    const withholdingReport = withholding.json().report;
    expect(withholdingReport.rows.length).toBeGreaterThan(0);
    expect(withholdingReport.totals.some((entry: { taxType: string }) => entry.taxType === 'VDS')).toBe(true);
    expect(withholdingReport.totals.some((entry: { taxType: string }) => entry.taxType === 'TDS')).toBe(true);
  });

  it('returns CSV from the same server report and blocks a failed export', async () => {
    const response = await get(
      fixture.ownerCookies,
      `/reports/export/PROFIT_AND_LOSS?periodId=${fixture.periods.november}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const csv = response.body;
    expect(csv).toContain('# report_key,PROFIT_AND_LOSS');
    expect(csv).toContain('Revenue — total');
    expect(csv).toContain('SUMMARY,,Profit for the period');
    expect(csv).toContain('13000000');
    expect(csv).toContain('12000000');

    const exportAudit = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/reports/export-audit`,
      headers: authHeaders(fixture.ownerCookies),
      payload: {
        reportKey: 'PROFIT_AND_LOSS',
        format: 'XLSX',
        periodId: fixture.periods.november,
        rowCount: 4,
      },
    });
    expect(exportAudit.statusCode, exportAudit.body).toBe(200);
    expect(exportAudit.json().audited).toBe(true);

    const auditEvents = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE company_id = $1 AND entity_type = 'report' ORDER BY created_at ASC`,
      [fixture.companyId],
    );
    expect(auditEvents.rows.filter((row) => row.action === 'report.exported').length).toBeGreaterThanOrEqual(2);

    const ledgerExport = await get(
      fixture.ownerCookies,
      `/reports/export/GENERAL_LEDGER?from=2026-10-01&to=2026-10-31&accountId=${fixture.accounts.revenue}`,
    );
    expect(ledgerExport.statusCode, ledgerExport.body).toBe(200);
    expect(ledgerExport.body).toContain('JE-2026-0003');
  });

  it('enforces report permissions and tenant isolation', async () => {
    const operator = await get(
      fixture.operatorCookies,
      `/reports/profit-and-loss?periodId=${fixture.periods.november}`,
    );
    expect(operator.statusCode).toBe(403);

    const auditor = await get(fixture.auditorCookies, `/reports/profit-and-loss?periodId=${fixture.periods.november}`);
    expect(auditor.statusCode, auditor.body).toBe(200);

    const otherCompany = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${fixture.otherCompanyId}/reports/profit-and-loss?periodId=${fixture.periods.november}`,
      headers: authHeaders(fixture.ownerCookies),
    });
    expect(otherCompany.statusCode).toBe(404);
  });

  it('detects a later-period reversal as a VAT timing variance and blocks the draft export', async () => {
    const reversal = await postLaterReversal(database, fixture);
    const november = await get(fixture.ownerCookies, `/reports/vat-return?periodId=${fixture.periods.november}`);
    expect(november.statusCode, november.body).toBe(200);
    const report = november.json().report;
    expect(report.zeroVariance).toBe(false);
    expect(report.canExport).toBe(false);
    expect(report.glProof.outputVatDifferencePoisha).not.toBe('0');
    expect(report.exceptions.some((entry: { code: string }) => entry.code === 'OUTPUT_VAT_GL_VARIANCE')).toBe(true);
    expect(report.exceptions.some((entry: { code: string }) => entry.code === 'REVERSED_DOCUMENT_TIMING')).toBe(true);

    const blocked = await get(
      fixture.ownerCookies,
      `/reports/export/VAT_RETURN_DRAFT?periodId=${fixture.periods.november}`,
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('REPORT_EXPORT_BLOCKED');
    expect(blocked.json().details.checks.some((entry: { key: string }) => entry.key === 'VAT_OUTPUT_GL_PROOF')).toBe(
      true,
    );

    const audit = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/reports/export-audit`,
      headers: authHeaders(fixture.ownerCookies),
      payload: {
        reportKey: 'VAT_RETURN_DRAFT',
        format: 'PDF',
        periodId: fixture.periods.november,
      },
    });
    expect(audit.statusCode).toBe(409);
    expect(audit.json().code).toBe('REPORT_EXPORT_BLOCKED');
    expect(reversal.reversalJournalId).toBeTruthy();
  });

  it('shows the December reversal in December and removes the reversed document from November ageing', async () => {
    const december = await get(fixture.ownerCookies, `/reports/profit-and-loss?periodId=${fixture.periods.december}`);
    expect(december.statusCode, december.body).toBe(200);
    expect(december.json().report.totals.revenuePoisha).toBe('-3000000');

    const ar = await get(fixture.ownerCookies, `/reports/ar-ageing?periodId=${fixture.periods.november}`);
    expect(ar.statusCode, ar.body).toBe(200);
    expect(ar.json().report.canExport).toBe(false);
    expect(ar.json().report.ageing.proof.agrees).toBe(false);
  });
});

async function createFixture(database: TestDatabase, app: AppInstance): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const organisationId = await seedOrganisation(database.pool, `Reports Org ${suffix}`);
  const ownerId = await seedUser(database.pool, {
    email: `reports-owner-${suffix}@example.test`,
    name: `Reports Owner ${suffix}`,
  });
  const accountantId = await seedUser(database.pool, {
    email: `reports-accountant-${suffix}@example.test`,
    name: `Reports Accountant ${suffix}`,
  });
  const auditorId = await seedUser(database.pool, {
    email: `reports-auditor-${suffix}@example.test`,
    name: `Reports Auditor ${suffix}`,
  });
  const operatorId = await seedUser(database.pool, {
    email: `reports-operator-${suffix}@example.test`,
    name: `Reports Operator ${suffix}`,
  });
  const ownerMembership = await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
  const accountantMembership = await seedMembership(database.pool, organisationId, accountantId, 'ACCOUNTANT');
  const auditorMembership = await seedMembership(database.pool, organisationId, auditorId, 'AUDITOR');
  const operatorMembership = await seedMembership(database.pool, organisationId, operatorId, 'OPERATOR');

  const company = await database.pool.query<{ id: string }>(
    `INSERT INTO companies (organisation_id, legal_name, trade_name, entity_type, industry, tin, bin, reporting_framework, base_currency, status)
     VALUES ($1, $2, $3, 'PRIVATE_LIMITED', 'TRADING_DISTRIBUTION', '123456789012', '1234567890123', 'IFRS_FOR_SMES_BFRS', 'BDT', 'ACTIVE')
     RETURNING id`,
    [organisationId, `Reports Company ${suffix} Ltd`, `Reports ${suffix}`],
  );
  const companyId = company.rows[0]!.id;
  const otherCompany = await database.pool.query<{ id: string }>(
    `INSERT INTO companies (organisation_id, legal_name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [organisationId, `Other Reports Company ${suffix} Ltd`],
  );
  const otherCompanyId = otherCompany.rows[0]!.id;
  await seedCompanyMembership(database.pool, organisationId, companyId, ownerMembership);
  await seedCompanyMembership(database.pool, organisationId, companyId, accountantMembership);
  await seedCompanyMembership(database.pool, organisationId, companyId, auditorMembership);
  await seedCompanyMembership(database.pool, organisationId, companyId, operatorMembership);

  const fiscalYear = await database.pool.query<{ id: string }>(
    `INSERT INTO fiscal_years (company_id, label, start_date, end_date, status)
     VALUES ($1, 'FY 2026-27', '2026-07-01', '2027-06-30', 'OPEN') RETURNING id`,
    [companyId],
  );
  const fiscalYearId = fiscalYear.rows[0]!.id;
  const periods = {} as Record<PeriodKey, string>;
  for (const [key, code, start, end] of [
    ['october', '2026-10', '2026-10-01', '2026-10-31'],
    ['november', '2026-11', '2026-11-01', '2026-11-30'],
    ['december', '2026-12', '2026-12-01', '2026-12-31'],
  ] as const) {
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO periods (company_id, fiscal_year_id, code, label, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN') RETURNING id`,
      [companyId, fiscalYearId, code, code, start, end],
    );
    periods[key] = result.rows[0]!.id;
  }

  const accounts = {} as Record<AccountKey, string>;
  const accountRows = [
    ['bank', '1010', 'Bank current account', 'ASSET', 'CURRENT_ASSET', 'BANK_MFS'],
    ['ar', '1210', 'Trade accounts receivable', 'ASSET', 'CURRENT_ASSET', 'AR'],
    ['inventory', '1310', 'Merchandise inventory', 'ASSET', 'CURRENT_ASSET', 'INVENTORY'],
    ['inputVat', '1140', 'Input VAT claimable', 'ASSET', 'CURRENT_ASSET', 'NONE'],
    ['ap', '2110', 'Trade accounts payable', 'LIABILITY', 'CURRENT_LIABILITY', 'AP'],
    ['outputVat', '2120', 'Output VAT payable', 'LIABILITY', 'CURRENT_LIABILITY', 'NONE'],
    ['vdsPayable', '2130', 'VDS payable', 'LIABILITY', 'CURRENT_LIABILITY', 'VDS_PAYABLE'],
    ['tdsPayable', '2140', 'TDS payable', 'LIABILITY', 'CURRENT_LIABILITY', 'TDS_PAYABLE'],
    ['reverseCharge', '2150', 'Reverse-charge VAT payable', 'LIABILITY', 'CURRENT_LIABILITY', 'NONE'],
    ['capital', '3100', 'Share capital', 'EQUITY', 'EQUITY_CAPITAL', 'NONE'],
    ['reserves', '3200', 'Retained earnings', 'EQUITY', 'EQUITY_RESERVES', 'NONE'],
    ['revenue', '4100', 'Sales revenue', 'REVENUE', 'OPERATING_REVENUE', 'NONE'],
    ['revenueTrading', '4110', 'Trading revenue', 'REVENUE', 'OPERATING_REVENUE', 'NONE'],
    ['cogs', '5100', 'Cost of sales', 'EXPENSE', 'COST_OF_SALES', 'NONE'],
    ['opex', '5200', 'Operating expenses', 'EXPENSE', 'OPERATING_EXPENSE', 'NONE'],
    ['finance', '5300', 'Finance costs', 'EXPENSE', 'FINANCE_COST', 'NONE'],
    ['tax', '5400', 'Income tax expense', 'EXPENSE', 'TAX_EXPENSE', 'NONE'],
  ] as const;
  for (const [key, code, name, type, sub, control] of accountRows) {
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, account_type, sub_category, ifrs_category, control_subledger, is_active)
       VALUES ($1,$2,$3,$4,$5,'NA_BALANCE_SHEET',$6,true) RETURNING id`,
      [companyId, code, name, type, sub, control],
    );
    accounts[key] = result.rows[0]!.id;
  }

  const branch = await database.pool.query<{ id: string }>(
    `INSERT INTO branches (company_id, code, name_en, is_principal, status)
     VALUES ($1, 'HQ', 'Head office', true, 'ACTIVE') RETURNING id`,
    [companyId],
  );
  const branchId = branch.rows[0]!.id;
  const warehouse = await database.pool.query<{ id: string }>(
    `INSERT INTO warehouses (company_id, branch_id, code, name_en, status)
     VALUES ($1,$2,'MAIN','Main warehouse','ACTIVE') RETURNING id`,
    [companyId, branchId],
  );
  const warehouseId = warehouse.rows[0]!.id;
  const party = await database.pool.query<{ id: string }>(
    `INSERT INTO parties (company_id, code, name_en, type, bin, tin, credit_days, credit_limit_poisha, status)
     VALUES ($1,'CUST-001','Customer One','CUSTOMER','1234567890123','123456789012',30,50000000,'ACTIVE') RETURNING id`,
    [companyId],
  );
  const partyId = party.rows[0]!.id;
  const supplier = await database.pool.query<{ id: string }>(
    `INSERT INTO parties (company_id, code, name_en, type, bin, tin, credit_days, credit_limit_poisha, status)
     VALUES ($1,'SUP-001','Supplier One','SUPPLIER','9876543210987','987654321098',30,50000000,'ACTIVE') RETURNING id`,
    [companyId],
  );
  const supplierId = supplier.rows[0]!.id;
  const item = await database.pool.query<{ id: string }>(
    `INSERT INTO items (company_id, sku, name_en, unit, is_stock_item, default_tax_category, inventory_account_id, expense_account_id, status)
     VALUES ($1,'RICE-5KG','Rice 5kg','kg',true,'STANDARD_15',$2,$3,'ACTIVE') RETURNING id`,
    [companyId, accounts.inventory, accounts.cogs],
  );
  const itemId = item.rows[0]!.id;
  const bank = await database.pool.query<{ id: string }>(
    `INSERT INTO bank_accounts (company_id, name, kind, provider, masked_number, branch, gl_account_id, opening_poisha, status, is_principal, created_by)
     VALUES ($1,'Main bank','BANK','Test Bank','****1234','Dhaka',$2,0,'ACTIVE',true,$3) RETURNING id`,
    [companyId, accounts.bank, ownerId],
  );
  const bankAccountId = bank.rows[0]!.id;

  await database.pool.query(
    `INSERT INTO company_settings (company_id, key, value_json, updated_by)
     VALUES ($1,'sales_tax_policy',$2::jsonb,$3), ($1,'purchase_tax_policy',$4::jsonb,$3)`,
    [
      companyId,
      JSON.stringify({
        status: 'APPROVED',
        packVersion: TAX_PACK,
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA',
        sourceReference: 'Reports test fixture',
        reviewedAt: '2026-11-01',
        outputVatAccountId: accounts.outputVat,
        approvedBy: ownerId,
        approvedAt: new Date().toISOString(),
      }),
      ownerId,
      JSON.stringify({
        status: 'APPROVED',
        packVersion: TAX_PACK,
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA',
        sourceReference: 'Reports test fixture',
        reviewedAt: '2026-11-01',
        inputVatAccountId: accounts.inputVat,
        vdsPayableAccountId: accounts.vdsPayable,
        tdsPayableAccountId: accounts.tdsPayable,
        reverseChargePayableAccountId: accounts.reverseCharge,
        approvedBy: ownerId,
        approvedAt: new Date().toISOString(),
      }),
    ],
  );

  const journals: Record<string, string> = {};
  const documents: Record<string, string> = {};

  const capitalJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.october,
    number: 'JE-2026-0001',
    date: '2026-10-01',
    narration: 'Opening capital introduced',
    sourceModule: 'MANUAL_JOURNAL',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.bank, debit: 100_000_000n, credit: 0n },
      { accountId: accounts.capital, debit: 0n, credit: 100_000_000n },
    ],
  });
  journals.capital = capitalJournal;

  const stockJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.october,
    number: 'JE-2026-0002',
    date: '2026-10-01',
    narration: 'Opening stock recognised',
    sourceModule: 'INVENTORY',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.inventory, debit: 4_000_000n, credit: 0n },
      { accountId: accounts.capital, debit: 0n, credit: 4_000_000n },
    ],
  });
  journals.openingStock = stockJournal;
  await insertStockMovement(database, {
    companyId,
    journalId: stockJournal,
    itemId,
    warehouseId,
    date: '2026-10-01',
    type: 'OPENING_RECEIPT',
    quantity: '10.0000',
    unitCost: 400_000n,
    value: 4_000_000n,
    balanceQuantity: '10.0000',
    balanceValue: 4_000_000n,
    createdBy: ownerId,
    sourceType: 'OPENING',
  });

  const reversedInvoiceId = randomUUID();
  const reversedJournalId = randomUUID();
  const reversedJournal = await insertPostedJournal(database, {
    id: reversedJournalId,
    companyId,
    branchId,
    periodId: periods.october,
    number: 'JE-2026-0003',
    date: '2026-10-10',
    narration: 'Sales invoice INV-2026-0001',
    sourceModule: 'SALES',
    sourceDocId: reversedInvoiceId,
    sourceDocRef: 'INV-2026-0001',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.ar, debit: 5_750_000n, credit: 0n, partyReference: 'CUST-001', partyName: 'Customer One' },
      { accountId: accounts.revenue, debit: 0n, credit: 5_000_000n },
      { accountId: accounts.outputVat, debit: 0n, credit: 750_000n },
    ],
  });
  journals.reversedOriginal = reversedJournal;
  const reversalId = randomUUID();
  const reversalJournal = await insertPostedJournal(database, {
    id: reversalId,
    companyId,
    branchId,
    periodId: periods.october,
    number: 'JE-2026-0004',
    date: '2026-10-12',
    narration: 'Reversal of JE-2026-0003 — Reversed for period-boundary test',
    sourceModule: 'REVERSAL',
    sourceDocId: reversedInvoiceId,
    sourceDocRef: 'INV-2026-0001',
    reversalOfJournalId: reversedJournal,
    createdBy: ownerId,
    lines: [
      { accountId: accounts.ar, debit: 0n, credit: 5_750_000n, partyReference: 'CUST-001', partyName: 'Customer One' },
      { accountId: accounts.revenue, debit: 5_000_000n, credit: 0n },
      { accountId: accounts.outputVat, debit: 750_000n, credit: 0n },
    ],
  });
  journals.reversal = reversalJournal;
  await database.pool.query(
    `UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $3, reversed_at = now(),
            reversed_by = $4, reversal_reason = 'Reversed for period-boundary test'
      WHERE company_id = $1 AND id = $2`,
    [companyId, reversedJournal, reversalJournal, ownerId],
  );
  documents.reversedInvoice = reversedInvoiceId;
  await insertSalesDocument(database, {
    id: reversedInvoiceId,
    companyId,
    branchId,
    partyId,
    type: 'SALES_INVOICE',
    status: 'REVERSED',
    number: 'INV-2026-0001',
    serial: 'M63-2026-0001',
    series: 'M63',
    date: '2026-10-10',
    dueDate: '2026-11-09',
    narration: 'Sales invoice for Customer One',
    lines: [
      {
        description: 'Consulting service',
        base: 5_000_000n,
        vat: 750_000n,
        revenueAccountId: accounts.revenue,
        rateBps: 1500,
        taxCategory: 'STANDARD_15',
      },
    ],
    createdBy: ownerId,
    postedBy: ownerId,
    reversalJournalId: reversalJournal,
  });

  const invoiceBId = randomUUID();
  const invoiceBJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0005',
    date: '2026-11-10',
    narration: 'Sales invoice INV-2026-0002',
    sourceModule: 'SALES',
    sourceDocId: invoiceBId,
    sourceDocRef: 'INV-2026-0002',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.ar, debit: 16_750_000n, credit: 0n, partyReference: 'CUST-001', partyName: 'Customer One' },
      { accountId: accounts.revenue, debit: 0n, credit: 10_000_000n },
      { accountId: accounts.revenueTrading, debit: 0n, credit: 5_000_000n },
      { accountId: accounts.outputVat, debit: 0n, credit: 1_750_000n },
    ],
  });
  journals.invoiceB = invoiceBJournal;
  documents.invoiceB = invoiceBId;
  await insertSalesDocument(database, {
    id: invoiceBId,
    companyId,
    branchId,
    partyId,
    type: 'SALES_INVOICE',
    status: 'POSTED',
    number: 'INV-2026-0002',
    serial: 'M63-2026-0002',
    series: 'M63',
    date: '2026-11-10',
    dueDate: '2026-12-10',
    narration: 'Mixed-rate sales invoice for Customer One',
    lines: [
      {
        description: 'Consulting service',
        base: 10_000_000n,
        vat: 1_500_000n,
        revenueAccountId: accounts.revenue,
        rateBps: 1500,
        taxCategory: 'STANDARD_15',
      },
      {
        description: 'Delivery service',
        base: 5_000_000n,
        vat: 250_000n,
        revenueAccountId: accounts.revenueTrading,
        rateBps: 500,
        taxCategory: 'TRADING_5',
      },
    ],
    createdBy: ownerId,
    postedBy: ownerId,
  });

  const creditNoteId = randomUUID();
  const creditNoteJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0006',
    date: '2026-11-15',
    narration: 'Credit note CN-2026-0001',
    sourceModule: 'SALES',
    sourceDocId: creditNoteId,
    sourceDocRef: 'CN-2026-0001',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.ar, debit: 0n, credit: 2_300_000n, partyReference: 'CUST-001', partyName: 'Customer One' },
      { accountId: accounts.revenue, debit: 2_000_000n, credit: 0n },
      { accountId: accounts.outputVat, debit: 300_000n, credit: 0n },
    ],
  });
  journals.creditNote = creditNoteJournal;
  documents.creditNote = creditNoteId;
  await insertSalesDocument(database, {
    id: creditNoteId,
    companyId,
    branchId,
    partyId,
    type: 'CREDIT_NOTE',
    status: 'POSTED',
    number: 'CN-2026-0001',
    serial: 'M67-2026-0001',
    series: 'M67',
    date: '2026-11-15',
    dueDate: '2026-11-15',
    narration: 'Credit note for returned services',
    originalDocumentId: invoiceBId,
    originalDocumentNo: 'INV-2026-0002',
    creditReason: 'Service not delivered',
    lines: [
      {
        description: 'Consulting service credit',
        base: 2_000_000n,
        vat: 300_000n,
        revenueAccountId: accounts.revenue,
        rateBps: 1500,
        taxCategory: 'STANDARD_15',
      },
    ],
    createdBy: ownerId,
    postedBy: ownerId,
  });

  const purchaseId = randomUUID();
  const purchaseJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0007',
    date: '2026-11-08',
    narration: 'Purchase bill PB-2026-0001',
    sourceModule: 'PURCHASES',
    sourceDocId: purchaseId,
    sourceDocRef: 'PB-2026-0001',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.inventory, debit: 4_000_000n, credit: 0n },
      { accountId: accounts.inputVat, debit: 600_000n, credit: 0n },
      { accountId: accounts.ap, debit: 0n, credit: 4_600_000n, partyReference: 'SUP-001', partyName: 'Supplier One' },
    ],
  });
  journals.purchase = purchaseJournal;
  documents.purchase = purchaseId;
  await insertPurchaseDocument(database, {
    id: purchaseId,
    companyId,
    branchId,
    partyId: supplierId,
    status: 'POSTED',
    number: 'PB-2026-0001',
    supplierInvoiceNo: 'SUP-INV-001',
    date: '2026-11-08',
    dueDate: '2026-12-08',
    narration: 'Purchase of rice inventory',
    base: 4_000_000n,
    vat: 600_000n,
    claimable: 600_000n,
    createdBy: ownerId,
    postedBy: ownerId,
    accountId: accounts.inventory,
    itemId,
    warehouseId,
  });
  await insertStockMovement(database, {
    companyId,
    journalId: purchaseJournal,
    itemId,
    warehouseId,
    date: '2026-11-08',
    type: 'GRN_RECEIPT',
    quantity: '10.0000',
    unitCost: 400_000n,
    value: 4_000_000n,
    balanceQuantity: '20.0000',
    balanceValue: 8_000_000n,
    createdBy: ownerId,
    sourceType: 'GRN',
  });

  const receiptId = randomUUID();
  const receiptJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0008',
    date: '2026-11-20',
    narration: 'Customer receipt RCT-2026-0001',
    sourceModule: 'SALES',
    sourceDocId: receiptId,
    sourceDocRef: 'RCT-2026-0001',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.bank, debit: 5_000_000n, credit: 0n },
      { accountId: accounts.ar, debit: 0n, credit: 5_000_000n, partyReference: 'CUST-001', partyName: 'Customer One' },
    ],
  });
  journals.receipt = receiptJournal;
  await database.pool.query(
    `INSERT INTO sales_receipts (id, company_id, branch_id, status, receipt_number, receipt_date, party_id,
       bank_account_id, amount_poisha, write_off_poisha, narration_en, journal_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,'POSTED','RCT-2026-0001','2026-11-20',$4,$5,5000000,0,'Customer receipt',$6,'reports-receipt-1',$7)`,
    [receiptId, companyId, branchId, partyId, bankAccountId, receiptJournal, ownerId],
  );
  await database.pool.query(
    `INSERT INTO sales_receipt_allocations (company_id, receipt_id, document_id, amount_poisha, write_off_poisha, created_by)
     VALUES ($1,$2,$3,5000000,0,$4)`,
    [companyId, receiptId, invoiceBId, ownerId],
  );

  const expenseJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0009',
    date: '2026-11-22',
    narration: 'Office operating expense paid by bank',
    sourceModule: 'MANUAL_JOURNAL',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.opex, debit: 1_000_000n, credit: 0n },
      { accountId: accounts.bank, debit: 0n, credit: 1_000_000n },
    ],
  });
  journals.expense = expenseJournal;

  const paymentId = randomUUID();
  const paymentJournal = await insertPostedJournal(database, {
    companyId,
    branchId,
    periodId: periods.november,
    number: 'JE-2026-0012',
    date: '2026-11-28',
    narration: 'Supplier payment PAY-2026-0001 with VDS and TDS withholding',
    sourceModule: 'PURCHASES',
    sourceDocId: paymentId,
    sourceDocRef: 'PAY-2026-0001',
    createdBy: ownerId,
    lines: [
      { accountId: accounts.ap, debit: 1_000_000n, credit: 0n, partyReference: 'SUP-001', partyName: 'Supplier One' },
      { accountId: accounts.vdsPayable, debit: 0n, credit: 500_000n },
      { accountId: accounts.tdsPayable, debit: 0n, credit: 500_000n },
    ],
  });
  journals.payment = paymentJournal;
  await database.pool.query(
    `INSERT INTO purchase_payments (id, company_id, branch_id, status, payment_number, payment_date,
       party_id, bank_account_id, amount_poisha, vds_poisha, tds_poisha, allocated_poisha, reference,
       narration_en, journal_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,'POSTED','PAY-2026-0001','2026-11-28',$4,$5,0,500000,500000,1000000,
       'PAY-REF-001','Supplier payment with withholding',$6,'reports-payment-1',$7)`,
    [paymentId, companyId, branchId, supplierId, bankAccountId, paymentJournal, ownerId],
  );
  const allocationId = randomUUID();
  await database.pool.query(
    `INSERT INTO purchase_payment_allocations (id, company_id, payment_id, document_id, amount_poisha,
       base_poisha, vds_poisha, tds_poisha, created_by)
     VALUES ($1,$2,$3,$4,1000000,1000000,500000,500000,$5)`,
    [allocationId, companyId, paymentId, purchaseId, ownerId],
  );
  await database.pool.query(
    `INSERT INTO purchase_withholding_liabilities (
       company_id, source_type, bill_id, payment_id, allocation_id, party_id, tax_type, tax_period,
       base_poisha, rate_bps, amount_poisha, status, journal_id, created_by
     ) VALUES
       ($1,'PAYMENT',$2,$3,$4,$5,'VDS','2026-11',1000000,500,500000,'PENDING',$6,$7),
       ($1,'PAYMENT',$2,$3,$4,$5,'TDS','2026-11',1000000,500,500000,'PENDING',$6,$7)`,
    [companyId, purchaseId, paymentId, allocationId, supplierId, paymentJournal, ownerId],
  );

  const ownerCookies = (await login(app, `reports-owner-${suffix}@example.test`)).cookies;
  const accountantCookies = (await login(app, `reports-accountant-${suffix}@example.test`)).cookies;
  const auditorCookies = (await login(app, `reports-auditor-${suffix}@example.test`)).cookies;
  const operatorCookies = (await login(app, `reports-operator-${suffix}@example.test`)).cookies;

  return {
    organisationId,
    companyId,
    otherCompanyId,
    ownerCookies,
    accountantCookies,
    auditorCookies,
    operatorCookies,
    ownerId,
    branchId,
    partyId,
    supplierId,
    itemId,
    warehouseId,
    bankAccountId,
    accounts,
    periods,
    journals,
    documents,
  };
}

async function insertPostedJournal(
  database: TestDatabase,
  input: {
    id?: string;
    companyId: string;
    branchId: string;
    periodId: string;
    number: string;
    date: string;
    narration: string;
    sourceModule: string;
    sourceDocId?: string;
    sourceDocRef?: string;
    reversalOfJournalId?: string;
    createdBy: string;
    lines: Array<{
      accountId: string;
      debit: bigint;
      credit: bigint;
      partyReference?: string;
      partyName?: string;
      memo?: string;
    }>;
  },
): Promise<string> {
  const id = input.id ?? randomUUID();
  await database.pool.query(
    `INSERT INTO journals (id, company_id, branch_id, book_type, period_id, document_date, posting_date,
       source_module, source_doc_id, source_doc_ref, narration_en, currency, status, reversal_of_journal_id,
       reversal_reason, created_by)
     VALUES ($1,$2,$3,'STATUTORY_BD',$4,$5,$5,$6,$7,$8,$9,'BDT','DRAFT',$10,$11,$12)`,
    [
      id,
      input.companyId,
      input.branchId,
      input.periodId,
      input.date,
      input.sourceModule,
      input.sourceDocId ?? null,
      input.sourceDocRef ?? null,
      input.narration,
      input.reversalOfJournalId ?? null,
      input.reversalOfJournalId ? input.narration : null,
      input.createdBy,
    ],
  );
  for (const [index, line] of input.lines.entries()) {
    await database.pool.query(
      `INSERT INTO journal_lines (company_id, journal_id, line_no, account_id, party_reference, party_name,
         debit_poisha, credit_poisha, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.companyId,
        id,
        index + 1,
        line.accountId,
        line.partyReference ?? null,
        line.partyName ?? null,
        line.debit.toString(),
        line.credit.toString(),
        line.memo ?? null,
      ],
    );
  }
  await database.pool.query(
    `UPDATE journals SET status = 'POSTED', journal_number = $3, posted_at = now(), posted_by = $4
      WHERE company_id = $1 AND id = $2`,
    [input.companyId, id, input.number, input.createdBy],
  );
  return id;
}

async function insertSalesDocument(
  database: TestDatabase,
  input: {
    id: string;
    companyId: string;
    branchId: string;
    partyId: string;
    type: 'SALES_INVOICE' | 'CREDIT_NOTE';
    status: 'POSTED' | 'REVERSED';
    number: string;
    serial: string;
    series: 'M63' | 'M67';
    date: string;
    dueDate: string;
    narration: string;
    originalDocumentId?: string;
    originalDocumentNo?: string;
    creditReason?: string;
    lines: Array<{
      description: string;
      base: bigint;
      vat: bigint;
      revenueAccountId: string;
      rateBps: number;
      taxCategory: string;
    }>;
    createdBy: string;
    postedBy: string;
    reversalJournalId?: string;
  },
): Promise<void> {
  const subtotal = input.lines.reduce((sum, line) => sum + line.base, 0n);
  const vat = input.lines.reduce((sum, line) => sum + line.vat, 0n);
  await database.pool.query(
    `INSERT INTO sales_documents (
       id, company_id, branch_id, doc_type, status, document_no, statutory_serial, statutory_series,
       party_id, original_document_id, original_document_no, doc_date, due_date, payment_terms_days,
       currency, narration_en, credit_reason, subtotal_poisha, discount_poisha, vat_poisha, gross_poisha,
       tax_pack_version, tax_decision_state, tax_snapshot_json, created_by
     ) VALUES ($1,$2,$3,$4,'DRAFT',NULL,NULL,NULL,$5,$6,$7,$8,$9,30,'BDT',$10,$11,$12,0,$13,$14,$15,'SUPPORTED','{}'::jsonb,$16)`,
    [
      input.id,
      input.companyId,
      input.branchId,
      input.type,
      input.partyId,
      input.originalDocumentId ?? null,
      input.originalDocumentNo ?? null,
      input.date,
      input.dueDate,
      input.narration,
      input.creditReason ?? null,
      subtotal.toString(),
      vat.toString(),
      (subtotal + vat).toString(),
      TAX_PACK,
      input.createdBy,
    ],
  );
  for (const [index, line] of input.lines.entries()) {
    const lineId = randomUUID();
    await database.pool.query(
      `INSERT INTO sales_document_lines (
         id, company_id, document_id, line_no, description_en, quantity, unit, unit_price_poisha,
         discount_poisha, tax_category, revenue_account_id, line_base_poisha, vat_poisha, gross_poisha,
         tax_rate_bps, tax_decision_state
       ) VALUES ($1,$2,$3,$4,$5,1,'job',$6,0,$7,$8,$9,$10,$11,$12,'SUPPORTED')`,
      [
        lineId,
        input.companyId,
        input.id,
        index + 1,
        line.description,
        line.base.toString(),
        line.taxCategory,
        line.revenueAccountId,
        line.base.toString(),
        line.vat.toString(),
        (line.base + line.vat).toString(),
        line.rateBps,
      ],
    );
    await database.pool.query(
      `INSERT INTO sales_document_taxes (
         company_id, document_id, line_id, tax_type, tax_category, rate_bps, base_poisha,
         amount_poisha, rule_id, rule_pack_version
       ) VALUES ($1,$2,$3,'VAT',$4,$5,$6,$7,'reports-test',$8)`,
      [
        input.companyId,
        input.id,
        lineId,
        line.taxCategory,
        line.rateBps,
        line.base.toString(),
        line.vat.toString(),
        TAX_PACK,
      ],
    );
  }
  await database.pool.query(
    `UPDATE sales_documents
        SET status = 'POSTED', document_no = $3, statutory_serial = $4, statutory_series = $5,
            posted_at = now(), posted_by = $6
      WHERE company_id = $1 AND id = $2`,
    [input.companyId, input.id, input.number, input.serial, input.series, input.postedBy],
  );
  if (input.status === 'REVERSED') {
    await database.pool.query(
      `UPDATE sales_documents
          SET status = 'REVERSED', reversed_at = now(), reversed_by = $3, reversal_journal_id = $4
        WHERE company_id = $1 AND id = $2`,
      [input.companyId, input.id, input.createdBy, input.reversalJournalId ?? null],
    );
  }
}

async function insertPurchaseDocument(
  database: TestDatabase,
  input: {
    id: string;
    companyId: string;
    branchId: string;
    partyId: string;
    status: 'POSTED';
    number: string;
    supplierInvoiceNo: string;
    date: string;
    dueDate: string;
    narration: string;
    base: bigint;
    vat: bigint;
    claimable: bigint;
    createdBy: string;
    postedBy: string;
    accountId: string;
    itemId: string;
    warehouseId: string;
  },
): Promise<void> {
  await database.pool.query(
    `INSERT INTO purchase_documents (
       id, company_id, branch_id, doc_type, status, document_no, supplier_invoice_no, supplier_invoice_date,
       supplier_mushak63_serial, supplier_mushak63_date, party_id, doc_date, due_date, payment_terms_days,
       currency, narration_en, payment_method, supplier_tin, subtotal_poisha, discount_poisha, vat_poisha,
       supplier_vat_poisha, reverse_charge_vat_poisha, vat_claimable_poisha, vat_disallowed_poisha,
       cost_poisha, gross_poisha, vds_poisha, tds_poisha, net_payable_poisha, tax_pack_version,
       tax_decision_state, tax_snapshot_json, created_by
     ) VALUES ($1,$2,$3,'PURCHASE_BILL','DRAFT',NULL,$4,$5,'M63-SUP-0001',$5,$6,$5,$7,30,'BDT',$8,'BANK','987654321098',
       $9,0,$10,$10,0,$11,0,$9,$12,0,0,$12,$13,'SUPPORTED','{}'::jsonb,$14)`,
    [
      input.id,
      input.companyId,
      input.branchId,
      input.supplierInvoiceNo,
      input.date,
      input.partyId,
      input.dueDate,
      input.narration,
      input.base.toString(),
      input.vat.toString(),
      input.claimable.toString(),
      (input.base + input.vat).toString(),
      TAX_PACK,
      input.createdBy,
    ],
  );
  const lineId = randomUUID();
  await database.pool.query(
    `INSERT INTO purchase_document_lines (
       id, company_id, document_id, line_no, item_id, description_en, quantity, unit, unit_price_poisha,
       discount_poisha, tax_category, account_id, warehouse_id, line_base_poisha, vat_poisha,
       vat_claimable_poisha, vat_disallowed_poisha, cost_poisha, supplier_payable_poisha, tax_rate_bps,
       tax_decision_state
     ) VALUES ($1,$2,$3,1,$4,'Rice 5kg',10,'kg',$5,0,'STANDARD_15',$6,$7,$8,$9,$10,0,$8,$11,1500,'SUPPORTED')`,
    [
      lineId,
      input.companyId,
      input.id,
      input.itemId,
      input.base.toString(),
      input.accountId,
      input.warehouseId,
      input.base.toString(),
      input.vat.toString(),
      input.claimable.toString(),
      (input.base + input.vat).toString(),
    ],
  );
  await database.pool.query(
    `INSERT INTO purchase_document_taxes (
       company_id, document_id, line_id, tax_type, tax_category, rate_bps, base_poisha,
       amount_poisha, claimable_poisha, disallowed_poisha, rule_id, rule_pack_version
     ) VALUES ($1,$2,$3,'VAT','STANDARD_15',1500,$4,$5,$6,0,'reports-test',$7)`,
    [
      input.companyId,
      input.id,
      lineId,
      input.base.toString(),
      input.vat.toString(),
      input.claimable.toString(),
      TAX_PACK,
    ],
  );
  await database.pool.query(
    `UPDATE purchase_documents
        SET status = 'POSTED', document_no = $3, posted_at = now(), posted_by = $4
      WHERE company_id = $1 AND id = $2`,
    [input.companyId, input.id, input.number, input.postedBy],
  );
}

async function insertStockMovement(
  database: TestDatabase,
  input: {
    companyId: string;
    journalId: string;
    itemId: string;
    warehouseId: string;
    date: string;
    type: string;
    quantity: string;
    unitCost: bigint;
    value: bigint;
    balanceQuantity: string;
    balanceValue: bigint;
    createdBy: string;
    sourceType: string;
  },
): Promise<void> {
  await database.pool.query(
    `INSERT INTO stock_movements (
       company_id, command_id, movement_no, idempotency_key, movement_type, movement_date, item_id,
       warehouse_id, quantity, unit_cost_poisha, value_poisha, balance_after_quantity,
       balance_after_value_poisha, source_type, journal_id, created_by
     ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.companyId,
      randomUUID(),
      `reports-stock-${randomUUID()}`,
      input.type,
      input.date,
      input.itemId,
      input.warehouseId,
      input.quantity,
      input.unitCost.toString(),
      input.value.toString(),
      input.balanceQuantity,
      input.balanceValue.toString(),
      input.sourceType,
      input.journalId,
      input.createdBy,
    ],
  );
}

async function postLaterReversal(
  database: TestDatabase,
  fixture: Fixture,
): Promise<{ documentId: string; reversalJournalId: string }> {
  const invoiceFId = randomUUID();
  const journalId = await insertPostedJournal(database, {
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    periodId: fixture.periods.november,
    number: 'JE-2026-0010',
    date: '2026-11-25',
    narration: 'Sales invoice INV-2026-0004',
    sourceModule: 'SALES',
    sourceDocId: invoiceFId,
    sourceDocRef: 'INV-2026-0004',
    createdBy: fixture.ownerId,
    lines: [
      {
        accountId: fixture.accounts.ar,
        debit: 3_450_000n,
        credit: 0n,
        partyReference: 'CUST-001',
        partyName: 'Customer One',
      },
      { accountId: fixture.accounts.revenue, debit: 0n, credit: 3_000_000n },
      { accountId: fixture.accounts.outputVat, debit: 0n, credit: 450_000n },
    ],
  });
  await insertSalesDocument(database, {
    id: invoiceFId,
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    partyId: fixture.partyId,
    type: 'SALES_INVOICE',
    status: 'POSTED',
    number: 'INV-2026-0004',
    serial: 'M63-2026-0004',
    series: 'M63',
    date: '2026-11-25',
    dueDate: '2026-12-25',
    narration: 'Sales invoice to be reversed in December',
    lines: [
      {
        description: 'Consulting service',
        base: 3_000_000n,
        vat: 450_000n,
        revenueAccountId: fixture.accounts.revenue,
        rateBps: 1500,
        taxCategory: 'STANDARD_15',
      },
    ],
    createdBy: fixture.ownerId,
    postedBy: fixture.ownerId,
  });
  const reversalId = randomUUID();
  const reversal = await insertPostedJournal(database, {
    id: reversalId,
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    periodId: fixture.periods.december,
    number: 'JE-2026-0011',
    date: '2026-12-05',
    narration: 'Reversal of JE-2026-0010 — post-period reversal test',
    sourceModule: 'REVERSAL',
    sourceDocId: invoiceFId,
    sourceDocRef: 'INV-2026-0004',
    reversalOfJournalId: journalId,
    createdBy: fixture.ownerId,
    lines: [
      {
        accountId: fixture.accounts.ar,
        debit: 0n,
        credit: 3_450_000n,
        partyReference: 'CUST-001',
        partyName: 'Customer One',
      },
      { accountId: fixture.accounts.revenue, debit: 3_000_000n, credit: 0n },
      { accountId: fixture.accounts.outputVat, debit: 450_000n, credit: 0n },
    ],
  });
  await database.pool.query(
    `UPDATE journals SET status = 'REVERSED', reversed_by_journal_id = $3, reversed_at = now(),
       reversed_by = $4, reversal_reason = 'post-period reversal test'
     WHERE company_id = $1 AND id = $2`,
    [fixture.companyId, journalId, reversal, fixture.ownerId],
  );
  await database.pool.query(
    `UPDATE sales_documents SET status = 'REVERSED', reversed_at = now(), reversed_by = $3,
       reversal_journal_id = $4
     WHERE company_id = $1 AND id = $2`,
    [fixture.companyId, invoiceFId, fixture.ownerId, reversal],
  );
  return { documentId: invoiceFId, reversalJournalId: reversal };
}
