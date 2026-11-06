import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { REPORT_DEFINITIONS } from '../reports/definitions.ts';
import { getReportCatalog, reportReviewStatusFor } from '../reports/catalog.ts';
import { exportReportCsv, generateNineTabAuditPackBuffer } from '../reports/export.ts';
import { JOURNAL_SOURCE_MODULES, JOURNAL_STATUSES } from '../ledger/constants.ts';
import {
  getApAgeingReport,
  getArAgeingReport,
  getPurchaseVatRegisterReport,
  getSalesVatRegisterReport,
  getStockValuationReport,
  getVatReturnDraft,
  getWithholdingRegisterReport,
} from '../reports/registers.ts';
import {
  getBalanceSheetReport,
  getCashFlowReport,
  getChangesInEquityReport,
  getGeneralLedgerReport,
  getJournalListingReport,
  getProfitAndLossReport,
  getTrialBalanceReport,
} from '../reports/statements.ts';
import type { JournalListingDto, ReportEnvelope, VatRegisterReportDto } from '../reports/types.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const ledgerParams = z.object({ companyId: z.string().uuid(), accountId: z.string().uuid() });
const exportParams = z.object({
  companyId: z.string().uuid(),
  reportKey: z.enum(REPORT_DEFINITIONS),
});

const branchSchema = z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional();

const scopeQuery = z.object({
  periodId: z.string().uuid().optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  asOf: z.string().min(10).max(10).optional(),
  comparativePeriodId: z.string().uuid().optional(),
  comparativeFrom: z.string().min(10).max(10).optional(),
  comparativeTo: z.string().min(10).max(10).optional(),
  comparativeAsOf: z.string().min(10).max(10).optional(),
  branchId: branchSchema,
  partyId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  status: z.enum(JOURNAL_STATUSES).optional(),
  sourceModule: z.enum(JOURNAL_SOURCE_MODULES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const exportAuditSchema = z.object({
  reportKey: z.enum(REPORT_DEFINITIONS),
  format: z.enum(['XLSX', 'PDF', 'PRINT']),
  periodId: z.string().uuid().optional().nullable(),
  from: z.string().min(10).max(10).optional().nullable(),
  to: z.string().min(10).max(10).optional().nullable(),
  asOf: z.string().min(10).max(10).optional().nullable(),
  comparativePeriodId: z.string().uuid().optional().nullable(),
  comparativeFrom: z.string().min(10).max(10).optional().nullable(),
  comparativeTo: z.string().min(10).max(10).optional().nullable(),
  comparativeAsOf: z.string().min(10).max(10).optional().nullable(),
  branchId: branchSchema.nullable(),
  accountId: z.string().uuid().optional().nullable(),
  rowCount: z.number().int().min(0).max(1_000_000).optional(),
});

type ScopeQuery = z.infer<typeof scopeQuery>;

function auditBase(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    organisationId: auth.company.organisationId,
    companyId: auth.company.id,
    actorUserId: auth.user.id,
    sessionId: auth.session.id,
    ip: request.ip,
    userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
    requestId: request.id,
  };
}

function scopedInput(query: ScopeQuery) {
  return {
    ...(query.periodId ? { periodId: query.periodId } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.asOf ? { asOf: query.asOf } : {}),
    ...(query.comparativePeriodId ? { comparativePeriodId: query.comparativePeriodId } : {}),
    ...(query.comparativeFrom ? { comparativeFrom: query.comparativeFrom } : {}),
    ...(query.comparativeTo ? { comparativeTo: query.comparativeTo } : {}),
    ...(query.comparativeAsOf ? { comparativeAsOf: query.comparativeAsOf } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
  };
}

async function runReport(
  app: Parameters<FastifyPluginAsync>[0],
  companyId: string,
  reportKey: (typeof REPORT_DEFINITIONS)[number],
  query: ScopeQuery,
  accountId?: string,
) {
  const input = scopedInput(query);
  switch (reportKey) {
    case 'TRIAL_BALANCE':
      return getTrialBalanceReport(app.db, companyId, input);
    case 'GENERAL_LEDGER':
      if (!accountId && !query.accountId) {
        throw new AppError(400, 'REPORT_ACCOUNT_REQUIRED', 'Choose an account for the general-ledger report.');
      }
      return getGeneralLedgerReport(app.db, companyId, accountId ?? query.accountId!, input);
    case 'PROFIT_AND_LOSS':
      return getProfitAndLossReport(app.db, companyId, input);
    case 'BALANCE_SHEET':
      return getBalanceSheetReport(app.db, companyId, input);
    case 'CASH_FLOW':
      return getCashFlowReport(app.db, companyId, input);
    case 'CHANGES_IN_EQUITY':
      return getChangesInEquityReport(app.db, companyId, input);
    case 'AR_AGEING':
      return getArAgeingReport(app.db, companyId, { ...input, ...(query.partyId ? { partyId: query.partyId } : {}) });
    case 'AP_AGEING':
      return getApAgeingReport(app.db, companyId, { ...input, ...(query.partyId ? { partyId: query.partyId } : {}) });
    case 'STOCK_VALUATION':
      return getStockValuationReport(app.db, companyId, input);
    case 'VAT_SALES_REGISTER':
      return getSalesVatRegisterReport(app.db, companyId, {
        ...input,
        ...(query.page ? { page: query.page } : {}),
        ...(query.pageSize ? { pageSize: query.pageSize } : {}),
      });
    case 'VAT_PURCHASE_REGISTER':
      return getPurchaseVatRegisterReport(app.db, companyId, {
        ...input,
        ...(query.page ? { page: query.page } : {}),
        ...(query.pageSize ? { pageSize: query.pageSize } : {}),
      });
    case 'VAT_RETURN_DRAFT':
      return getVatReturnDraft(app.db, companyId, input);
    case 'WITHHOLDING_REGISTER':
      return getWithholdingRegisterReport(app.db, companyId, input);
    case 'JOURNAL_LISTING':
      return getJournalListingReport(
        app.db,
        companyId,
        {
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.sourceModule ? { sourceModule: query.sourceModule } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
          ...(query.offset ? { offset: query.offset } : {}),
        },
        input,
      );
    default:
      throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found.');
  }
}

/**
 * Export is not limited to the screen's current page. Register and journal exports are assembled
 * from bounded 500/200-row pages so a large ledger can be exported without an unbounded query.
 */
async function runExportReport(
  app: Parameters<FastifyPluginAsync>[0],
  companyId: string,
  reportKey: (typeof REPORT_DEFINITIONS)[number],
  query: ScopeQuery,
  accountId?: string,
) {
  const first = await runReport(app, companyId, reportKey, query, accountId);
  if (reportKey === 'VAT_SALES_REGISTER' || reportKey === 'VAT_PURCHASE_REGISTER') {
    const combined = first as VatRegisterReportDto;
    const maxRows = 20_000;
    if (combined.lineCount > maxRows) {
      throw new AppError(
        409,
        'REPORT_EXPORT_TOO_LARGE',
        `This register has ${combined.lineCount.toLocaleString('en-US')} lines. Narrow the period or branch scope below ${maxRows.toLocaleString('en-US')} lines before exporting.`,
        { lineCount: combined.lineCount, maxRows },
      );
    }
    const pageSize = 500;
    combined.rows = [];
    let page = 1;
    for (;;) {
      const pageReport = (await runReport(
        app,
        companyId,
        reportKey,
        {
          ...query,
          page,
          pageSize,
        },
        accountId,
      )) as VatRegisterReportDto;
      combined.rows.push(...pageReport.rows);
      if (pageReport.rows.length < pageSize || combined.rows.length >= pageReport.lineCount) break;
      page += 1;
    }
    return combined;
  }
  if (reportKey === 'JOURNAL_LISTING') {
    const combined = first as JournalListingDto;
    const maxRows = 10_000;
    if (combined.total > maxRows) {
      throw new AppError(
        409,
        'REPORT_EXPORT_TOO_LARGE',
        `This listing has ${combined.total.toLocaleString('en-US')} journals. Narrow the period or branch scope below ${maxRows.toLocaleString('en-US')} before exporting.`,
        { total: combined.total, maxRows },
      );
    }
    const limit = 200;
    combined.entries = [];
    let offset = 0;
    for (;;) {
      const pageReport = (await runReport(
        app,
        companyId,
        reportKey,
        {
          ...query,
          limit,
          offset,
        },
        accountId,
      )) as JournalListingDto;
      combined.entries.push(...pageReport.entries);
      if (pageReport.entries.length < limit || combined.entries.length >= pageReport.total) break;
      offset += limit;
    }
    return combined;
  }
  return first;
}

function assertExportable(report: ReportEnvelope): void {
  if (!report.canExport) {
    const failed = report.checks.filter((check) => check.blocksExport && !check.passed);
    throw new AppError(
      409,
      'REPORT_EXPORT_BLOCKED',
      'This report has a failed control check. Resolve the difference before exporting.',
      {
        reportKey: report.reportKey,
        checks: failed.map((check) => ({
          key: check.key,
          differencePoisha: check.differencePoisha,
          detailEn: check.detailEn,
        })),
      },
    );
  }
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/companies/:companyId/reports/catalog',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      return { catalog: await getReportCatalog(app.db, companyId) };
    },
  );

  app.get(
    '/companies/:companyId/reports/trial-balance',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'TRIAL_BALANCE', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/general-ledger/:accountId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(ledgerParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, params.companyId, 'GENERAL_LEDGER', query, params.accountId) };
    },
  );

  app.get(
    '/companies/:companyId/reports/profit-and-loss',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'PROFIT_AND_LOSS', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/balance-sheet',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'BALANCE_SHEET', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/cash-flow',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'CASH_FLOW', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/changes-in-equity',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'CHANGES_IN_EQUITY', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/ar-ageing',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'AR_AGEING', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/ap-ageing',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'AP_AGEING', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/stock-valuation',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'STOCK_VALUATION', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/vat-sales-register',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'VAT_SALES_REGISTER', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/vat-purchase-register',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'VAT_PURCHASE_REGISTER', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/vat-return',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'VAT_RETURN_DRAFT', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/withholding-register',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'WITHHOLDING_REGISTER', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/journal-listing',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      return { report: await runReport(app, companyId, 'JOURNAL_LISTING', query) };
    },
  );

  app.get(
    '/companies/:companyId/reports/export/:reportKey',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request, reply) => {
      const params = parseInput(exportParams, request.params);
      const query = parseInput(scopeQuery, request.query);
      const report = await runExportReport(app, params.companyId, params.reportKey, query, query.accountId);
      assertExportable(report);
      const csv = exportReportCsv(params.reportKey, report);
      await writeAuditEvent(app.db, {
        ...auditBase(request),
        action: 'report.exported',
        entityType: 'report',
        entityId: params.reportKey,
        after: {
          format: 'CSV',
          reportKey: params.reportKey,
          templateVersion: report.template.version,
          reviewStatus: report.reviewStatus,
          periodId: report.scope.periodId,
          from: report.scope.from,
          to: report.scope.to,
          asOf: report.scope.asOf,
          branchId: report.scope.branchId,
          branchScope: report.scope.branchScope,
          checksPassed: report.checks.filter((check) => check.passed).length,
          checksFailed: report.checks.filter((check) => !check.passed).length,
        },
        reason: 'Authorised report export.',
      });
      const date = new Date().toISOString().slice(0, 10);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${params.reportKey.toLowerCase()}-${date}.csv"`);
      return reply.send(csv);
    },
  );

  app.get(
    '/companies/:companyId/reports/audit-pack/:fiscalYearId',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request, reply) => {
      const { companyId, fiscalYearId } = request.params as { companyId: string; fiscalYearId: string };
      const buffer = await generateNineTabAuditPackBuffer(companyId, fiscalYearId, app.db);
      reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('content-disposition', `attachment; filename="audit-pack-${fiscalYearId}.xlsx"`);
      return reply.send(buffer);
    },
  );

  app.post(
    '/companies/:companyId/reports/export-audit',
    { config: { auth: { mode: 'company', permission: 'EXPORT_DATA' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(exportAuditSchema, request.body);
      const query: ScopeQuery = {
        ...(body.periodId ? { periodId: body.periodId } : {}),
        ...(body.from ? { from: body.from } : {}),
        ...(body.to ? { to: body.to } : {}),
        ...(body.asOf ? { asOf: body.asOf } : {}),
        ...(body.comparativePeriodId ? { comparativePeriodId: body.comparativePeriodId } : {}),
        ...(body.comparativeFrom ? { comparativeFrom: body.comparativeFrom } : {}),
        ...(body.comparativeTo ? { comparativeTo: body.comparativeTo } : {}),
        ...(body.comparativeAsOf ? { comparativeAsOf: body.comparativeAsOf } : {}),
        ...(body.branchId ? { branchId: body.branchId } : {}),
        ...(body.accountId ? { accountId: body.accountId } : {}),
      };
      const report = await runReport(app, companyId, body.reportKey, query, body.accountId ?? undefined);
      assertExportable(report);
      await writeAuditEvent(app.db, {
        ...auditBase(request),
        action: 'report.exported',
        entityType: 'report',
        entityId: body.reportKey,
        after: {
          format: body.format,
          reportKey: body.reportKey,
          templateVersion: report.template.version,
          reviewStatus: report.reviewStatus,
          periodId: report.scope.periodId,
          from: report.scope.from,
          to: report.scope.to,
          asOf: report.scope.asOf,
          branchId: report.scope.branchId,
          branchScope: report.scope.branchScope,
          clientReportedRowCount: body.rowCount ?? null,
          checksPassed: report.checks.filter((check) => check.passed).length,
          checksFailed: report.checks.filter((check) => !check.passed).length,
        },
        reason: 'Authorised report export.',
      });
      return {
        audited: true,
        reportKey: body.reportKey,
        format: body.format,
        reviewStatus: reportReviewStatusFor(body.reportKey),
      };
    },
  );
};
