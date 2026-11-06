import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authed,
  login,
  seedCompanyMembership,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';
import {
  advanceDeadline,
  isBangladeshWeekend,
  parseIsoDate,
  toIsoDate,
} from '../../src/compliance/calendarService.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'TRADING_DISTRIBUTION',
  tin: '123456789012',
  bin: '123456789-0101',
  rjscNo: 'C-12345/2026',
  address: 'House 12, Road 5, Banani, Dhaka 1213',
  phone: '+8801700000000',
  email: 'tax@example.test',
  reportingFramework: 'IFRS_FOR_SMES_BFRS',
};

const STATUTORY_ACCOUNTS = [
  {
    key: 'cash',
    code: '1010',
    nameEn: 'Cash at bank',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'vatInput',
    code: '1140',
    nameEn: 'VAT Current Account - Input Tax Rebate',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'VAT_CURRENT_ACCOUNT',
  },
  {
    key: 'vatOutput',
    code: '2120',
    nameEn: 'Output VAT Payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
  {
    key: 'vdsPayable',
    code: '2130',
    nameEn: 'Withholding VAT (VDS) Payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'VDS_PAYABLE',
  },
  {
    key: 'vendorTds',
    code: '2140',
    nameEn: 'Vendor Withholding Tax (TDS) Payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'TDS_PAYABLE',
  },
  {
    key: 'salaryTds',
    code: '2141',
    nameEn: 'Employee Salary TDS Payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
  {
    key: 'taxProvision',
    code: '2170',
    nameEn: 'Provision for Corporate Income Tax',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
  {
    key: 'expense',
    code: '5010',
    nameEn: 'Operating Expense',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    controlSubledger: 'NONE',
  },
] as const;

describe('Bangladesh Statutory Compliance Calendar Engine (Phase 17)', () => {
  describe('Holiday-Aware Deadline Advancement Pure Logic', () => {
    it('correctly identifies Bangladesh weekend: Friday (day 5) and Saturday (day 6)', () => {
      // 2026-11-13 is Friday
      expect(isBangladeshWeekend(parseIsoDate('2026-11-13'))).toBe(true);
      // 2026-11-14 is Saturday
      expect(isBangladeshWeekend(parseIsoDate('2026-11-14'))).toBe(true);
      // 2026-11-15 is Sunday (regular working day in Bangladesh)
      expect(isBangladeshWeekend(parseIsoDate('2026-11-15'))).toBe(false);
      // 2026-11-16 is Monday
      expect(isBangladeshWeekend(parseIsoDate('2026-11-16'))).toBe(false);
    });

    it('advances a statutory deadline falling on Friday over Saturday to Sunday', () => {
      const holidays = new Set<string>();
      // 2026-11-13 is Friday
      const result = advanceDeadline('2026-11-13', holidays);
      expect(result.adjustedDate).toBe('2026-11-15');
      expect(result.shiftDays).toBe(2);
      expect(result.shiftCallout).toBe('Statutory: 13 Nov (Fri) → Adjusted: 15 Nov (Sun)');
    });

    it('advances across weekend and gazetted holidays: Friday 15 Nov -> Sunday 17 Nov example', () => {
      // Suppose statutory deadline is 2026-11-13 (Fri), but 2026-11-15 (Sun) is also a gazetted holiday
      const holidays = new Set<string>(['2026-11-15']);
      const result = advanceDeadline('2026-11-13', holidays);
      // Advances Fri 13 -> Sat 14 (weekend) -> Sun 15 (holiday) -> Mon 16 (working day)
      expect(result.adjustedDate).toBe('2026-11-16');
      expect(result.shiftDays).toBe(3);
    });

    it('leaves weekday deadlines unshifted when no holiday intervenes', () => {
      const holidays = new Set<string>();
      // 2026-11-10 is Tuesday
      const result = advanceDeadline('2026-11-10', holidays);
      expect(result.adjustedDate).toBe('2026-11-10');
      expect(result.shiftDays).toBe(0);
      expect(result.shiftCallout).toBeNull();
    });
  });

  describe.skipIf(!databaseAvailable)('Integration against PostgreSQL', () => {
    let database: TestDatabase;
    let app: AppInstance;
    let organisationId: string;
    let companyId: string;
    let ownerCookies: AuthCookies;
    let accounts: Record<string, { id: string; code: string }>;
    let fiscalYearId: string;
    let periods: Array<{ id: string; code: string; label: string; startDate: string; endDate: string }>;

    beforeAll(async () => {
      database = await createTestDatabase();
      await migrateUp({ pool: database.pool, nodeEnv: 'test' });
      const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
      app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });

      // Setup tenant
      const suffix = randomUUID().slice(0, 8);
      organisationId = await seedOrganisation(database.pool, `Compliance Org ${suffix}`);
      const ownerEmail = `owner-${suffix}@example.test`;
      const ownerId = await seedUser(database.pool, { email: ownerEmail, name: `Owner ${suffix}` });
      await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
      ownerCookies = (await login(app, ownerEmail)).cookies;

      // Create company
      const companyRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/organisations/${organisationId}/companies`,
        { legalName: `Compliance Test Ltd ${suffix}`, tradeName: `Compliance Trade ${suffix}`, ...COMPANY_PROFILE },
      );
      expect(companyRes.statusCode).toBe(201);
      companyId = companyRes.json().company.id as string;

      // Create fiscal year (2026-07-01 to 2027-06-30)
      const fyRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
        startDate: '2026-07-01',
        endDate: '2027-06-30',
      });
      expect(fyRes.statusCode).toBe(201);
      fiscalYearId = fyRes.json().fiscalYear.id as string;
      periods = fyRes.json().fiscalYear.periods as any;

      // Seed chart of accounts
      accounts = {};
      for (const acc of STATUTORY_ACCOUNTS) {
        const accRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/accounts`, {
          code: acc.code,
          nameEn: acc.nameEn,
          accountType: acc.accountType,
          subCategory: acc.subCategory,
          ifrsCategory: 'NA_BALANCE_SHEET',
          controlSubledger: acc.controlSubledger,
          taxMapping: {},
          isActive: true,
        });
        expect(accRes.statusCode).toBe(201);
        accounts[acc.key] = { id: accRes.json().account.id, code: accRes.json().account.code };
      }
    });

    afterAll(async () => {
      await app?.close();
      await database?.cleanup();
    });

    it('reads seeded 2026-2027 Bangladesh Gazetted Holidays', async () => {
      const res = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/holidays`);
      expect(res.statusCode).toBe(200);
      const { holidays } = res.json();
      expect(holidays.length).toBeGreaterThanOrEqual(20);
      expect(holidays.some((h: any) => h.holidayDate === '2026-02-21')).toBe(true);
      expect(holidays.some((h: any) => h.holidayDate === '2026-03-26')).toBe(true);
      expect(holidays.some((h: any) => h.holidayDate === '2026-12-16')).toBe(true);
    });

    it('generates statutory compliance schedule with weekend/holiday advancement', async () => {
      const genRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/compliance/generate`,
        { fiscalYearId },
      );
      expect(genRes.statusCode).toBe(201);
      expect(genRes.json().generatedCount).toBeGreaterThan(0);

      // Verify list endpoint
      const listRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/events`);
      expect(listRes.statusCode).toBe(200);
      const { events } = listRes.json();
      expect(events.length).toBeGreaterThanOrEqual(12);

      // July 2026 period ends 2026-07-31.
      // Statutory deadline is 15th August 2026 (2026-08-15).
      // Note: 2026-08-15 is Saturday AND National Mourning Day!
      // Must advance to Sunday 2026-08-16.
      const julyVat = events.find((e: any) => e.category === 'VAT_91' && e.statutoryDeadline === '2026-08-15');
      expect(julyVat).toBeDefined();
      expect(julyVat.adjustedDeadline).toBe('2026-08-16');
      expect(julyVat.isShifted).toBe(true);
      expect(julyVat.shiftDays).toBe(1);
      expect(julyVat.shiftCallout).toContain('Statutory: 15 Aug (Sat) → Adjusted: 16 Aug (Sun)');
    });

    it('computes live estimated liabilities directly from GL balances (2120 - 1140 + 2130, 2140 + 2141, 2170 / 4)', async () => {
      // Post a journal:
      // DR 1140 (Input Rebate): BDT 15,000.00 (1,500,000 poisha)
      // DR 5010 (Expense): BDT 100,000.00 (10,000,000 poisha)
      // CR 2120 (Output VAT): BDT 35,000.00 (3,500,000 poisha)
      // CR 2130 (VDS Payable): BDT 5,000.00 (500,000 poisha)
      // CR 2140 (Vendor TDS): BDT 4,000.00 (400,000 poisha)
      // CR 2141 (Salary TDS): BDT 6,000.00 (600,000 poisha)
      // CR 2170 (Tax Provision): BDT 40,000.00 (4,000,000 poisha)
      // CR 1010 (Cash/Bank): Balance remainder (2,500,000 poisha)
      // Total DR = 1,500,000 + 10,000,000 = 11,500,000
      // Total CR = 3,500,000 + 500,000 + 400,000 + 600,000 + 4,000,000 + 2,500,000 = 11,500,000

      const period = periods[0]!;
      const jrnRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/journals`, {
        date: '2026-07-15',
        narration: 'July compliance accrual journal',
        lines: [
          { accountId: accounts.vatInput!.id, debit: '15000', credit: '0', memo: 'Rebate' },
          { accountId: accounts.expense!.id, debit: '100000', credit: '0', memo: 'Expense' },
          { accountId: accounts.vatOutput!.id, debit: '0', credit: '35000', memo: 'Output VAT' },
          { accountId: accounts.vdsPayable!.id, debit: '0', credit: '5000', memo: 'VDS' },
          { accountId: accounts.vendorTds!.id, debit: '0', credit: '4000', memo: 'Vendor TDS' },
          { accountId: accounts.salaryTds!.id, debit: '0', credit: '6000', memo: 'Salary TDS' },
          { accountId: accounts.taxProvision!.id, debit: '0', credit: '40000', memo: 'AIT Provision' },
          { accountId: accounts.cash!.id, debit: '0', credit: '25000', memo: 'Bank' },
        ],
      });
      expect(jrnRes.statusCode, jrnRes.body).toBe(201);
      const journalId = jrnRes.json().journal.id;

      // Post the journal
      const postRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/journals/${journalId}/post`,
      );
      expect(postRes.statusCode).toBe(200);

      // Now query compliance events:
      // VAT_91 liability should be: 2120 (3,500,000) - 1140 (1,500,000) + 2130 (500,000) = 2,500,000 poisha
      // TDS_MONTHLY liability should be: 2140 (400,000) + 2141 (600,000) = 1,000,000 poisha
      // VDS_DEPOSIT liability should be: 2130 = 500,000 poisha
      // AIT_Q liability should be: 2170 (4,000,000) / 4 = 1,000,000 poisha

      const evtsRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/events`);
      expect(evtsRes.statusCode).toBe(200);
      const { events } = evtsRes.json();

      const vatEvt = events.find((e: any) => e.category === 'VAT_91');
      expect(vatEvt).toBeDefined();
      expect(vatEvt.estimatedLiabilityPoisha).toBe('2500000');

      const tdsEvt = events.find((e: any) => e.category === 'TDS_MONTHLY');
      expect(tdsEvt).toBeDefined();
      expect(tdsEvt.estimatedLiabilityPoisha).toBe('1000000');

      const vdsEvt = events.find((e: any) => e.category === 'VDS_DEPOSIT');
      expect(vdsEvt).toBeDefined();
      expect(vdsEvt.estimatedLiabilityPoisha).toBe('500000');

      const aitEvt = events.find((e: any) => e.category === 'AIT_Q');
      expect(aitEvt).toBeDefined();
      expect(aitEvt.estimatedLiabilityPoisha).toBe('1000000');

      // Verify Summary KPI total withheld pending:
      // 2130 (500,000) + 2140 (400,000) + 2141 (600,000) = 1,500,000 poisha
      const sumRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/summary`);
      expect(sumRes.statusCode).toBe(200);
      const { summary } = sumRes.json();
      expect(summary.totalWithheldPendingDepositPoisha).toBe('1500000');
      expect(summary.holidayShiftedCount).toBeGreaterThan(0);
    });

    it('records NBR ACK reference and locks accounting period', async () => {
      const listRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/events`);
      // Select an upcoming event for a future period (e.g. June 2027) so filing it is on-time
      const targetPeriod = periods[periods.length - 1]!;
      const vatEvt = listRes.json().events.find((e: any) => e.category === 'VAT_91' && e.periodId === targetPeriod.id);
      expect(vatEvt).toBeDefined();

      const fileRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/compliance/events/${vatEvt.id}/file`,
        {
          filingReference: 'NBR-MUSHAK-91-2027-06-00998',
          notes: 'Mushak 9.1 filed with NBR e-VAT portal; ACK confirmed.',
          lockPeriod: true,
        },
      );
      expect(fileRes.statusCode).toBe(200);
      const filed = fileRes.json().event;
      expect(filed.status).toBe('FILED');
      expect(filed.filingReference).toBe('NBR-MUSHAK-91-2027-06-00998');
      expect(filed.filedAt).not.toBeNull();

      // Verify period is locked in database
      const periodCheck = await database.pool.query<{ status: string }>(
        `SELECT status FROM periods WHERE company_id = $1 AND id = $2`,
        [companyId, vatEvt.periodId],
      );
      expect(periodCheck.rows[0]!.status).toBe('LOCKED');

      // Verify summary on-time rate
      const sumRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/compliance/summary`);
      expect(sumRes.statusCode).toBe(200);
      expect(sumRes.json().summary.counts.filed).toBeGreaterThanOrEqual(1);
      expect(sumRes.json().summary.filedOnTimeRate).toBe(100);
    });
  });
});
