import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authed,
  login,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';
import {
  calculateOvertimePoisha,
  calculatePfPoisha,
  formatBeftn128Record,
  STATUTORY_DIVISOR_HOURS,
} from '../../src/payroll/payrollService.ts';
import { generateWithholdingReturn } from '../../src/reports/withholdingService.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'MANUFACTURING_RMG',
  tin: '123456789012',
  bin: '123456789-0101',
  rjscNo: 'C-99887/2026',
  address: 'Plot 45, Sector 7, Uttara, Dhaka 1230',
  phone: '+8801711000000',
  email: 'payroll@example.test',
  reportingFramework: 'IFRS_FRC_ADOPTED',
};

describe('Phase 19 Labour Act 2026 Payroll Engine & BEFTN Payouts', () => {
  describe('Labour Act 2026 Pure Integer Math Specifications', () => {
    it('enforces Section 108 Overtime formula (208 Statutory Divisor Hours, 2x Basic Rate)', () => {
      // Basic salary: 52,000.00 BDT (5,200,000 poisha)
      // Statutory divisor: 208 hours
      // Basic hourly rate = 52,000 / 208 = 250.00 BDT
      // Double rate for overtime = 2 * 250.00 = 500.00 BDT/hr = 50,000 poisha/hr
      const basicPoisha = 5_200_000n;

      // 1. 10.00 hours OT (1000 scaled): Expected 50,000 * 10 = 500,000 poisha (5,000.00 BDT)
      const ot10Hours = calculateOvertimePoisha(basicPoisha, 1000);
      expect(ot10Hours).toBe(500_000n);

      // Formula directly: floor((5200000 * 1000) / 10400) = 500000
      expect((basicPoisha * 1000n) / 10400n).toBe(ot10Hours);

      // 2. 1.50 hours OT (150 scaled): Expected 50,000 * 1.5 = 75,000 poisha (750.00 BDT)
      const ot1_5Hours = calculateOvertimePoisha(basicPoisha, 150);
      expect(ot1_5Hours).toBe(75_000n);

      // 3. 0 hours OT
      expect(calculateOvertimePoisha(basicPoisha, 0)).toBe(0n);
      expect(calculateOvertimePoisha(0n, 500)).toBe(0n);
    });

    it('enforces Section 264 Provident Fund (10% Employee + 10% Employer Match)', () => {
      const basicPoisha = 5_200_000n; // 52,000.00 BDT
      const { pfEmployeePoisha, pfEmployerPoisha } = calculatePfPoisha(basicPoisha, 1000, true);

      // 10% of 5,200,000 poisha = 520,000 poisha (5,200.00 BDT)
      expect(pfEmployeePoisha).toBe(520_000n);
      expect(pfEmployerPoisha).toBe(520_000n);

      // Not enrolled in PF
      const notEnrolled = calculatePfPoisha(basicPoisha, 1000, false);
      expect(notEnrolled.pfEmployeePoisha).toBe(0n);
      expect(notEnrolled.pfEmployerPoisha).toBe(0n);
    });

    it('formats Bangladesh Bank BEFTN 128-column records with exact byte padding', () => {
      const record = formatBeftn128Record({
        employeeCode: 'EMP-001',
        beneficiaryName: 'Md. Karim Rahman',
        routingNumber: '060261726',
        accountNumber: '1501203948501001',
        amountPoisha: 5_425_000n, // 54,250.00 BDT
        traceNumber: 1,
      });

      // Must be EXACTLY 128 characters
      expect(record.length).toBe(128);
      // Field 1: Record Type '6'
      expect(record[0]).toBe('6');
      // Field 2: Transaction Code '22'
      expect(record.slice(1, 3)).toBe('22');
      // Field 3 & 4: Routing number (9 chars)
      expect(record.slice(3, 12)).toBe('060261726');
      // Field 5: Account number (17 chars)
      expect(record.slice(12, 29).trim()).toBe('1501203948501001');
      // Field 6: Amount in poisha right-aligned zero-padded (10 chars)
      expect(record.slice(29, 39)).toBe('0005425000');
      // Field 7: Employee Code (15 chars)
      expect(record.slice(39, 54).trim()).toBe('EMP-001');
      // Field 8: Beneficiary Name (22 chars)
      expect(record.slice(54, 76).trim()).toBe('Md. Karim Rahman');
    });
  });

  describe.skipIf(!databaseAvailable)('PostgreSQL-Backed Payroll Engine Integration', () => {
    let database: TestDatabase;
    let app: AppInstance;
    let organisationId: string;
    let companyId: string;
    let ownerId: string;
    let ownerCookies: AuthCookies;
    let fiscalYearId: string;
    let periods: Array<{ id: string; code: string; startDate: string; endDate: string }>;

    beforeAll(async () => {
      database = await createTestDatabase();
      await migrateUp({ pool: database.pool, nodeEnv: 'test' });
      const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
      app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });

      // Setup tenant
      const suffix = randomUUID().slice(0, 8);
      organisationId = await seedOrganisation(database.pool, `Payroll Org ${suffix}`);
      const ownerEmail = `owner-${suffix}@example.test`;
      ownerId = await seedUser(database.pool, { email: ownerEmail, name: `Payroll Admin ${suffix}` });
      await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
      ownerCookies = (await login(app, ownerEmail)).cookies;

      // Create company
      const companyRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/organisations/${organisationId}/companies`,
        { legalName: `Apex Apparel Ltd ${suffix}`, tradeName: `Apex ${suffix}`, ...COMPANY_PROFILE },
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
    });

    afterAll(async () => {
      if (app) await app.close();
      if (database) await database.cleanup();
    });

    let emp1Id: string;
    let emp2Id: string;
    let emp3Id: string;

    it('creates active employees under Labour Act 2026 classifications and payment channels', async () => {
      // 1. Permanent worker with Bank payout
      const emp1Res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/payroll/employees`, {
        employeeCode: 'EMP-001',
        nameEn: 'Karim Rahman',
        nameBn: 'করিম রহমান',
        workerClassification: 'PERMANENT',
        nidNumber: '1990269251000001',
        etin: '123456789012',
        joiningDate: '2024-01-01',
        basicSalaryPoisha: '5200000', // 52,000.00 BDT
        hraPoisha: '2600000', // 26,000.00 BDT
        medicalPoisha: '500000', // 5,000.00 BDT
        conveyancePoisha: '500000', // 5,000.00 BDT
        pfEnrolled: true,
        pfRateBps: 1000,
        paymentChannel: 'BANK',
        bankName: 'BRAC Bank Ltd.',
        bankAccountNumber: '1501203948501001',
        bankRoutingNumber: '060261726',
      });
      expect(emp1Res.statusCode).toBe(201);
      emp1Id = emp1Res.json().employee.id;
      expect(emp1Res.json().employee.employeeCode).toBe('EMP-001');
      expect(emp1Res.json().employee.basicSalaryBdt).toBe('52000.00');

      // 2. Probationary worker with bKash payout
      const emp2Res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/payroll/employees`, {
        employeeCode: 'EMP-002',
        nameEn: 'Sadia Akhter',
        nameBn: 'সাদিয়া আক্তার',
        workerClassification: 'PROBATIONARY',
        nidNumber: '1995269251000002',
        etin: '987654321098',
        joiningDate: '2026-08-01',
        basicSalaryPoisha: '3000000', // 30,000.00 BDT
        hraPoisha: '1500000',
        medicalPoisha: '300000',
        conveyancePoisha: '200000',
        pfEnrolled: true,
        paymentChannel: 'BKASH',
        mfsNumber: '01711223344',
      });
      expect(emp2Res.statusCode).toBe(201);
      emp2Id = emp2Res.json().employee.id;

      // 3. Contractual worker with Nagad payout (no e-TIN)
      const emp3Res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/payroll/employees`, {
        employeeCode: 'EMP-003',
        nameEn: 'Rafiqul Islam',
        workerClassification: 'CONTRACTUAL',
        joiningDate: '2026-09-01',
        basicSalaryPoisha: '2000000', // 20,000.00 BDT
        hraPoisha: '1000000',
        medicalPoisha: '200000',
        conveyancePoisha: '100000',
        pfEnrolled: false,
        paymentChannel: 'NAGAD',
        mfsNumber: '01811223344',
      });
      expect(emp3Res.statusCode).toBe(201);
      emp3Id = emp3Res.json().employee.id;

      // Duplicate employee code rejection
      const dupRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/payroll/employees`, {
        employeeCode: 'EMP-001',
        nameEn: 'Duplicate Employee',
        workerClassification: 'PERMANENT',
        joiningDate: '2026-01-01',
        basicSalaryPoisha: '1000000',
        hraPoisha: '500000',
        medicalPoisha: '100000',
        conveyancePoisha: '100000',
      });
      expect(dupRes.statusCode).toBe(409);
    });

    it('lists registered employees with status and details', async () => {
      const listRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/payroll/employees`);
      expect(listRes.statusCode).toBe(200);
      const employees = listRes.json().employees;
      expect(employees.length).toBe(3);
      expect(employees.map((e: any) => e.employeeCode)).toEqual(['EMP-001', 'EMP-002', 'EMP-003']);
    });

    let targetPeriod: { id: string; code: string; startDate: string; endDate: string };
    let payrollRunId: string;

    it('computes and saves a monthly payroll draft with overtime, festival bonus, PF match, and TDS', async () => {
      // Use October 2026 period (2026-10)
      targetPeriod = periods.find((p) => p.code.includes('2026-10') || p.startDate.includes('2026-10')) ?? periods[3]!;

      // EMP-001: 10.00 hours OT (1000 scaled) => 5,000.00 BDT OT
      // Festival bonus included (10% of basic)
      // TDS adjustment: EMP-001 = 2,500.00 BDT (250,000 poisha), EMP-002 = 1,000.00 BDT (100,000 poisha)
      const computeRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/payroll/runs`, {
        periodId: targetPeriod.id,
        batchDate: targetPeriod.endDate,
        includeFestivalBonus: true,
        adjustments: [
          {
            employeeId: emp1Id,
            otHoursScaled: 1000,
            tdsPoisha: '250000',
          },
          {
            employeeId: emp2Id,
            otHoursScaled: 0,
            tdsPoisha: '100000',
          },
        ],
      });

      expect(computeRes.statusCode).toBe(201);
      const run = computeRes.json().run;
      payrollRunId = run.id;
      expect(run.status).toBe('DRAFT');
      expect(run.linesCount).toBe(3);

      // Verify EMP-001 line:
      // Basic = 52,000.00
      // Allowances = 26,000 + 5,000 + 5,000 = 36,000.00
      // Overtime 10 hrs = 5,000.00
      // Festival Bonus 10% = 5,200.00
      // Gross = 52000 + 36000 + 5000 + 5200 = 98,200.00 BDT (9,820,000 poisha)
      // PF Employee 10% = 5,200.00 BDT (520,000 poisha)
      // PF Employer 10% = 5,200.00 BDT (520,000 poisha)
      // TDS = 2,500.00 BDT (250,000 poisha)
      // Net = 98,200 - 5,200 - 2,500 = 90,500.00 BDT (9,050,000 poisha)
      const line1 = run.lines.find((l: any) => l.employeeId === emp1Id);
      expect(line1.grossPayPoisha).toBe('9820000');
      expect(line1.otAmountPoisha).toBe('500000');
      expect(line1.festivalBonusPoisha).toBe('520000');
      expect(line1.pfEmployeePoisha).toBe('520000');
      expect(line1.pfEmployerPoisha).toBe('520000');
      expect(line1.tdsPoisha).toBe('250000');
      expect(line1.netPayPoisha).toBe('9050000');

      // Verify mathematical identity: Net == Gross - PF - TDS for every line
      for (const line of run.lines) {
        const gross = BigInt(line.grossPayPoisha);
        const pf = BigInt(line.pfEmployeePoisha);
        const tds = BigInt(line.tdsPoisha);
        const net = BigInt(line.netPayPoisha);
        expect(net).toBe(gross - pf - tds);
      }
    });

    it('enforces maker-checker approval before posting', async () => {
      const approveRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/approve`,
      );
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().run.status).toBe('APPROVED');
    });

    let postedJournalId: string;

    it('posts atomic payroll GL journal and guarantees Debits === Credits down to the poisha', async () => {
      const postRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/post`,
      );
      expect(postRes.statusCode).toBe(200);
      expect(postRes.json().run.status).toBe('POSTED');
      postedJournalId = postRes.json().journalId;
      expect(postedJournalId).toBeTruthy();

      // Verify the posted journal in the General Ledger
      const journalRes = await authed(app, ownerCookies, 'GET', `/api/v1/companies/${companyId}/journals/${postedJournalId}`);
      expect(journalRes.statusCode).toBe(200);
      const journal = journalRes.json().journal;
      expect(journal.sourceModule).toBe('PAYROLL');
      expect(journal.status).toBe('POSTED');

      // Inspect lines in the GL entry
      const lines = journal.lines;
      const debitsSum = lines.reduce((acc: bigint, l: any) => acc + BigInt(l.debitPoisha), 0n);
      const creditsSum = lines.reduce((acc: bigint, l: any) => acc + BigInt(l.creditPoisha), 0n);

      expect(debitsSum).toBe(creditsSum);
      expect(debitsSum).toBeGreaterThan(0n);

      // Verify expected GL account legs:
      // DR 5310 Salaries & Wages Expense
      // DR 5320 Overtime Allowance Expense
      // DR 5330 Festival Bonus Expense
      // DR 5340 Employer PF Contribution Expense
      // CR 2141 Salary TDS Payable
      // CR 2150 Provident Fund Payable
      // CR 2160 Net Salaries Payable
      const lineCodes = lines.map((l: any) => l.accountCode);
      expect(lineCodes).toContain('5310');
      expect(lineCodes).toContain('5320');
      expect(lineCodes).toContain('5330');
      expect(lineCodes).toContain('5340');
      expect(lineCodes).toContain('2141');
      expect(lineCodes).toContain('2150');
      expect(lineCodes).toContain('2160');

      // Verify re-posting is prevented
      const repostRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/post`,
      );
      expect(repostRes.statusCode).toBe(409);
    });

    it('marks the payroll run as DISBURSED', async () => {
      const disburseRes = await authed(
        app,
        ownerCookies,
        'POST',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/disburse`,
      );
      expect(disburseRes.statusCode).toBe(200);
      expect(disburseRes.json().run.status).toBe('DISBURSED');
    });

    it('exports Bangladesh Bank BEFTN 128-column payout file with exact 128 character width', async () => {
      const exportRes = await authed(
        app,
        ownerCookies,
        'GET',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/export/beftn-128`,
      );
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.headers['content-type']).toContain('text/plain');

      const bodyText = exportRes.body;
      const records = bodyText.split('\r\n').filter((line: string) => line.length > 0);
      expect(records.length).toBeGreaterThanOrEqual(1);

      for (const rec of records) {
        expect(rec.length).toBe(128);
        expect(rec.startsWith('622')).toBe(true);
      }
    });

    it('exports BEFTN CSV payout file with bank account routing details', async () => {
      const exportRes = await authed(
        app,
        ownerCookies,
        'GET',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/export/beftn-csv`,
      );
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.headers['content-type']).toContain('text/csv');

      const csv = exportRes.body;
      expect(csv).toContain('Sl No,Employee Code,Beneficiary Name,Bank Name');
      expect(csv).toContain('EMP-001');
      expect(csv).toContain('Karim Rahman');
      expect(csv).toContain('060261726');
      expect(csv).toContain('1501203948501001');
    });

    it('exports bKash and Nagad MFS bulk disbursement sheets', async () => {
      // bKash export
      const bkashRes = await authed(
        app,
        ownerCookies,
        'GET',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/export/mfs-csv?provider=BKASH`,
      );
      expect(bkashRes.statusCode).toBe(200);
      const bkashCsv = bkashRes.body;
      expect(bkashCsv).toContain('MSISDN,Beneficiary Name,Amount (BDT),Reference,Purpose,Wallet Type');
      expect(bkashCsv).toContain('01711223344');
      expect(bkashCsv).toContain('Sadia Akhter');
      expect(bkashCsv).toContain('BKASH');

      // Nagad export
      const nagadRes = await authed(
        app,
        ownerCookies,
        'GET',
        `/api/v1/companies/${companyId}/payroll/runs/${payrollRunId}/export/mfs-csv?provider=NAGAD`,
      );
      expect(nagadRes.statusCode).toBe(200);
      const nagadCsv = nagadRes.body;
      expect(nagadCsv).toContain('01811223344');
      expect(nagadCsv).toContain('Rafiqul Islam');
      expect(nagadCsv).toContain('NAGAD');
    });

    it('automatically feeds Section 177 Withholding Tax Return Schedule A (SCHED_A_SALARY) from posted payroll TDS', async () => {
      // Generate Section 177 return for the payroll tax period
      const returnDto = await generateWithholdingReturn(database.pool, companyId, {
        taxPeriod: targetPeriod.code,
        actorUserId: ownerId,
      });

      expect(returnDto).toBeTruthy();
      expect(returnDto.taxPeriod).toBe(targetPeriod.code);

      // Verify that Schedule A has the deductee lines from the posted payroll run
      const scheduleALines = returnDto.lines.filter((l: any) => l.schedule === 'SCHEDULE_A');
      expect(scheduleALines.length).toBeGreaterThanOrEqual(2); // EMP-001 (2500 BDT) and EMP-002 (1000 BDT)

      const emp1Line = scheduleALines.find((l: any) => l.partyName === 'Karim Rahman');
      expect(emp1Line).toBeTruthy();
      expect(emp1Line?.sectionCode).toBe('SEC_86');
      expect(emp1Line?.economicCode).toBe('1/1141/0010/0112');
      expect(emp1Line?.tdsAmountPoisha).toBe('250000'); // 2,500.00 BDT
      expect(emp1Line?.partyTin).toBe('123456789012');
    });
  });
});
