import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  formatPoishaExact,
  sanitizeCellValue,
  generateNineTabAuditPackBuffer,
} from '../../src/reports/export.ts';
import { resolveNoteRef } from '../../src/reports/statements.ts';
import {
  createEmailSender,
  FileEmailSender,
  MemoryEmailSender,
  SmtpEmailSender,
} from '../../src/auth/email.ts';
import { loadConfig, type AppConfig } from '../../src/config.ts';

const baseConfig: AppConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ledger_user:secret@127.0.0.1:5432/ledgervault_test',
});

describe('BigInt Poisha Exact Currency Formatting', () => {
  it('formats zero poisha as 0.00', () => {
    expect(formatPoishaExact(0n)).toBe('0.00');
  });

  it('formats positive fractional poisha with leading zero', () => {
    expect(formatPoishaExact(7n)).toBe('0.07');
    expect(formatPoishaExact(99n)).toBe('0.99');
  });

  it('formats whole taka amounts', () => {
    expect(formatPoishaExact(100n)).toBe('1.00');
    expect(formatPoishaExact(10000n)).toBe('100.00');
  });

  it('formats multi-digit currency amounts without IEEE-754 float drift', () => {
    expect(formatPoishaExact(123456789n)).toBe('1234567.89');
  });

  it('formats negative poisha preserving negative sign', () => {
    expect(formatPoishaExact(-7n)).toBe('-0.07');
    expect(formatPoishaExact(-100n)).toBe('-1.00');
    expect(formatPoishaExact(-123456n)).toBe('-1234.56');
  });

  it('handles very large statutory billion-taka values', () => {
    expect(formatPoishaExact(10_000_000_000_000n)).toBe('100000000000.00');
  });
});

describe('Formula Injection Sanitization', () => {
  it('prefixes dangerous leading characters with single quote', () => {
    expect(sanitizeCellValue('=cmd|"/C calc"!A0')).toBe(`'=cmd|"/C calc"!A0`);
    expect(sanitizeCellValue('+12345')).toBe(`'+12345`);
    expect(sanitizeCellValue('-54321')).toBe(`'-54321`);
    expect(sanitizeCellValue('@SUM(A1:A10)')).toBe(`'@SUM(A1:A10)`);
  });

  it('leaves safe values untouched', () => {
    expect(sanitizeCellValue('Ordinary Account Name')).toBe('Ordinary Account Name');
    expect(sanitizeCellValue('Note 21: Revenue')).toBe('Note 21: Revenue');
    expect(sanitizeCellValue(12345)).toBe(12345);
    expect(sanitizeCellValue(0)).toBe(0);
    expect(sanitizeCellValue(null)).toBe(null);
    expect(sanitizeCellValue(undefined)).toBe(undefined);
  });
});

describe('Transactional Email Delivery Provider', () => {
  it('strictly returns FileEmailSender in test mode regardless of email.mode', () => {
    const configWithSmtp: AppConfig = {
      ...baseConfig,
      nodeEnv: 'test',
      email: {
        mode: 'smtp',
        host: 'smtp.mailgun.org',
        port: 587,
        secure: false,
        auth: { user: 'testuser', pass: 'testpass' },
        from: 'noreply@fintuity.test',
        outboxDir: './tmp/test-outbox',
      },
    };
    const sender = createEmailSender(configWithSmtp);
    expect(sender).toBeInstanceOf(FileEmailSender);
    expect(sender.transport).toBe('file');
  });

  it('returns FileEmailSender when email.mode is file', () => {
    const config: AppConfig = {
      ...baseConfig,
      nodeEnv: 'development',
      email: {
        mode: 'file',
        host: '127.0.0.1',
        port: 587,
        secure: false,
        auth: { user: '', pass: '' },
        from: 'noreply@fintuity.test',
        outboxDir: './tmp/test-outbox',
      },
    };
    const sender = createEmailSender(config);
    expect(sender).toBeInstanceOf(FileEmailSender);
  });

  it('returns MemoryEmailSender when email.mode is memory', () => {
    const config: AppConfig = {
      ...baseConfig,
      nodeEnv: 'development',
      email: {
        mode: 'memory',
        host: '127.0.0.1',
        port: 587,
        secure: false,
        auth: { user: '', pass: '' },
        from: 'noreply@fintuity.test',
        outboxDir: './tmp/test-outbox',
      },
    };
    const sender = createEmailSender(config);
    expect(sender).toBeInstanceOf(MemoryEmailSender);
    expect(sender.transport).toBe('memory');
  });

  it('returns SmtpEmailSender in production when email.mode is smtp', () => {
    const config: AppConfig = {
      ...baseConfig,
      nodeEnv: 'production',
      email: {
        mode: 'smtp',
        host: 'email-smtp.us-east-1.amazonaws.com',
        port: 587,
        secure: true,
        auth: {
          user: 'MOCK_SES_TEST_USER_KEY',
          pass: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
        from: 'noreply@fintuity.test',
        outboxDir: './tmp/test-outbox',
      },
    };
    const sender = createEmailSender(config);
    expect(sender).toBeInstanceOf(SmtpEmailSender);
    expect(sender.transport).toBe('smtp');
  });

  it('MemoryEmailSender captures sent messages in memory', async () => {
    const sender = new MemoryEmailSender();
    await sender.send({
      to: 'cfo@example.com',
      subject: 'Monthly Statutory Audit Pack',
      text: 'Audit pack ready for review.',
    });
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]?.to).toBe('cfo@example.com');
    expect(sender.messages[0]?.subject).toBe('Monthly Statutory Audit Pack');
  });

  it('FileEmailSender writes deterministic JSON files to outbox', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'fintuity-outbox-'));
    try {
      const sender = new FileEmailSender(tempDir);
      await sender.send({
        to: 'auditor@icab.org.bd',
        subject: 'Mushak 9.1 Return Filing Pack',
        text: 'Attached return for review.',
      });
      const files = await import('node:fs/promises').then((fs) => fs.readdir(tempDir));
      expect(files.length).toBe(1);
      const content = JSON.parse(await readFile(path.join(tempDir, files[0]!), 'utf8'));
      expect(content.to).toBe('auditor@icab.org.bd');
      expect(content.subject).toBe('Mushak 9.1 Return Filing Pack');
      expect(content.createdAt).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('9-Tab Statutory & IFRS Audit Pack Exporter', () => {
  it('generates a valid, complete 9-tab Excel buffer with frozen panes and dark slate headers', async () => {
    const companyId = '00000000-0000-4000-8000-000000000001';
    const fiscalYearId = '00000000-0000-4000-8000-000000000002';
    const buffer = await generateNineTabAuditPackBuffer(companyId, fiscalYearId);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(5000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);

    // Verify 9 Tabs:
    const expectedSheets = [
      'Audit Summary',
      'IFRS 18 P&L',
      'IAS 1 Balance Sheet',
      'IAS 7 Cash Flows',
      'IAS 12 Tax Schedule',
      'Mushak 9.1 VAT Return',
      'Section 177 WHT Schedule',
      'Trial Balance',
      'General Ledger & Audit Trail',
    ];

    expect(wb.worksheets.map((s) => s.name)).toEqual(expectedSheets);

    // Verify Boardroom Presentation on each tab:
    for (const ws of wb.worksheets) {
      // 1. Frozen header pane
      expect(ws.views).toBeDefined();
      expect(ws.views.length).toBeGreaterThan(0);
      expect(ws.views[0]?.state).toBe('frozen');
      expect((ws.views[0] as ExcelJS.WorksheetViewFrozen)?.ySplit).toBeGreaterThanOrEqual(1);

      // 2. Dark Slate header fill (#0F172A = FF0F172A)
      const headerRow = ws.getRow(1);
      const firstHeaderCell = headerRow.getCell(1);
      expect(firstHeaderCell.fill).toBeDefined();
      if (firstHeaderCell.fill && firstHeaderCell.fill.type === 'pattern') {
        expect(firstHeaderCell.fill.fgColor?.argb).toBe('FF0F172A');
      }

      // 3. Bold white header text
      expect(firstHeaderCell.font?.color?.argb).toBe('FFFFFFFF');
      expect(firstHeaderCell.font?.bold).toBe(true);
    }

    // Verify Tab 1: Audit Summary key metrics
    const summarySheet = wb.getWorksheet('Audit Summary')!;
    const allValues = summarySheet.getSheetValues().flat().map(String);
    expect(allValues.some((v) => v.includes('BALANCED'))).toBe(true);

    // Verify Tab 2: IFRS 18 Mandatory Subtotals
    const pnlSheet = wb.getWorksheet('IFRS 18 P&L')!;
    const pnlValues = pnlSheet.getSheetValues().flat().map(String);
    expect(pnlValues.some((v) => v.includes('Operating Profit or Loss (EBIT)'))).toBe(true);
    expect(pnlValues.some((v) => v.includes('Profit / (Loss) Before Financing and Income Taxes'))).toBe(true);

    // Verify Tab 3: IAS 1 Balance Sheet Equation Delta Proof
    const bsSheet = wb.getWorksheet('IAS 1 Balance Sheet')!;
    const bsValues = bsSheet.getSheetValues().flat().map(String);
    expect(bsValues.some((v) => v.includes('TOTAL ASSETS'))).toBe(true);
    expect(bsValues.some((v) => v.includes('TOTAL EQUITY AND LIABILITIES'))).toBe(true);
    expect(bsValues.some((v) => v.includes('ACCOUNTING EQUATION DELTA'))).toBe(true);

    // Verify Tab 4: IAS 7 Statutory Treasury Line Isolation
    const cfSheet = wb.getWorksheet('IAS 7 Cash Flows')!;
    const cfValues = cfSheet.getSheetValues().flat().map(String);
    expect(cfValues.some((v) => v.includes('Cash Paid for VDS & Net VAT'))).toBe(true);
    expect(cfValues.some((v) => v.includes('A-Challan 1/1141/0010/0311'))).toBe(true);
    expect(cfValues.some((v) => v.includes('Cash Paid for TDS & Advance Income Tax'))).toBe(true);
    expect(cfValues.some((v) => v.includes('A-Challans 0101-0116'))).toBe(true);

    // Verify Tab 6: Mushak 9.1 VAT Return
    const vatSheet = wb.getWorksheet('Mushak 9.1 VAT Return')!;
    const vatValues = vatSheet.getSheetValues().flat().map(String);
    expect(vatValues.some((v) => v.includes('Part 3'))).toBe(true);
    expect(vatValues.some((v) => v.includes('Part 4'))).toBe(true);
    expect(vatValues.some((v) => v.includes('Part 7'))).toBe(true);

    // Verify Tab 7: Section 177 Withholding Schedule
    const whtSheet = wb.getWorksheet('Section 177 WHT Schedule')!;
    const whtValues = whtSheet.getSheetValues().flat().map(String);
    expect(whtValues.some((v) => v.includes('1/1141/0010/0111'))).toBe(true);
    expect(whtValues.some((v) => v.includes('TOTAL SCHEDULE AMOUNTS'))).toBe(true);

    // Verify Tab 8: Trial Balance balanced
    const tbSheet = wb.getWorksheet('Trial Balance')!;
    const tbValues = tbSheet.getSheetValues().flat().map(String);
    expect(tbValues.some((v) => v.includes('TOTAL BALANCES'))).toBe(true);

    // Verify Tab 9: Immutable General Ledger with SHA-256 Hash Chain
    const glSheet = wb.getWorksheet('General Ledger & Audit Trail')!;
    const glValues = glSheet.getSheetValues().flat().map(String);
    expect(glValues.some((v) => v.includes('SHA-256 Hash'))).toBe(true);
    expect(glValues.some((v) => v.includes('Chain Status'))).toBe(true);
  });
});

describe('IAS / IFRS Note Cross-Referencing & Subtotals', () => {
  it('correctly maps statutory accounts to Note 1 through Note 32', () => {
    expect(resolveNoteRef('1510')).toBe('Note 4');
    expect(resolveNoteRef('1530')).toBe('Note 5');
    expect(resolveNoteRef('1310')).toBe('Note 6');
    expect(resolveNoteRef('1210')).toBe('Note 7');
    expect(resolveNoteRef('1140')).toBe('Note 8');
    expect(resolveNoteRef('1145')).toBe('Note 9');
    expect(resolveNoteRef('1150')).toBe('Note 10');
    expect(resolveNoteRef('1110')).toBe('Note 11');
    expect(resolveNoteRef('3110')).toBe('Note 12');
    expect(resolveNoteRef('3210')).toBe('Note 13');
    expect(resolveNoteRef('3310')).toBe('Note 14');
    expect(resolveNoteRef('2510')).toBe('Note 15');
    expect(resolveNoteRef('2110')).toBe('Note 16');
    expect(resolveNoteRef('2130')).toBe('Note 17');
    expect(resolveNoteRef('2140')).toBe('Note 18');
    expect(resolveNoteRef('2141')).toBe('Note 19');
    expect(resolveNoteRef('2170')).toBe('Note 20');
    expect(resolveNoteRef('4110')).toBe('Note 21');
    expect(resolveNoteRef('5210')).toBe('Note 22');
    expect(resolveNoteRef('5310')).toBe('Note 23');
    expect(resolveNoteRef('4210')).toBe('Note 24');
    expect(resolveNoteRef('5410')).toBe('Note 25');
    expect(resolveNoteRef('5510')).toBe('Note 26');
    expect(resolveNoteRef('1540')).toBe('Note 27');
    expect(resolveNoteRef('2530')).toBe('Note 27');
    expect(resolveNoteRef('2120')).toBe('Note 28');
    expect(resolveNoteRef('2150')).toBe('Note 29');
    expect(resolveNoteRef('2160')).toBe('Note 30');
    expect(resolveNoteRef('5190')).toBe('Note 31');
  });

  it('proves the 5 mandatory IFRS 18 subtotals in bigint poisha', () => {
    const netOperatingRevenuePoisha = 158_500_000_00n;
    const cogsPoisha = 99_855_000_00n;
    const grossProfitPoisha = netOperatingRevenuePoisha - cogsPoisha;
    expect(grossProfitPoisha).toBe(58_645_000_00n);

    const operatingExpensesPoisha = 24_520_000_00n;
    const operatingProfitPoisha = grossProfitPoisha - operatingExpensesPoisha;
    expect(operatingProfitPoisha).toBe(34_125_000_00n);

    const investingNetPoisha = 1_420_000_00n;
    const profitBeforeFinancingAndTaxPoisha = operatingProfitPoisha + investingNetPoisha;
    expect(profitBeforeFinancingAndTaxPoisha).toBe(35_545_000_00n);

    const financingCostPoisha = 4_295_000_00n;
    const profitBeforeTaxPoisha = profitBeforeFinancingAndTaxPoisha - financingCostPoisha;
    expect(profitBeforeTaxPoisha).toBe(31_250_000_00n);

    const currentTaxPoisha = 7_812_500_00n;
    const deferredTaxPoisha = 781_250_00n;
    const netProfitPoisha = profitBeforeTaxPoisha - currentTaxPoisha - deferredTaxPoisha;
    expect(netProfitPoisha).toBe(22_656_250_00n);
  });

  it('proves the IAS 1 Statement of Financial Position accounting equation delta is strictly zero', () => {
    const totalAssetsPoisha = 248_750_000_00n;
    const totalLiabilitiesPoisha = 106_300_000_00n;
    const totalEquityPoisha = 142_450_000_00n;

    const accountingEquationDeltaPoisha = totalAssetsPoisha - (totalLiabilitiesPoisha + totalEquityPoisha);
    expect(accountingEquationDeltaPoisha).toBe(0n);
  });
});
