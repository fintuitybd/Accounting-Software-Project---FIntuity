import type { Pool, PoolClient } from 'pg';
import { formatDatabaseDate } from '../company/dates.ts';
import { ALL_TEMPLATES, REPORT_TEMPLATES } from './templates.ts';
import type { ReportCatalogDto, ReportReviewStatus } from './types.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const DEFINITIONS: ReportCatalogDto['definitions'] = [
  {
    key: 'TRIAL_BALANCE',
    titleEn: 'Trial balance',
    titleBn: 'রেওয়ামিল',
    periodSemantics: 'RANGE',
    comparativeDefault: 'PRIOR_PERIOD',
    reviewStatus: REPORT_TEMPLATES.trialBalance.reviewStatus,
  },
  {
    key: 'GENERAL_LEDGER',
    titleEn: 'General ledger detail',
    titleBn: 'সাধারণ খাতা বিবরণ',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.trialBalance.reviewStatus,
  },
  {
    key: 'PROFIT_AND_LOSS',
    titleEn: 'Statement of profit or loss',
    titleBn: 'মুনাফা বা ক্ষতির বিবরণী',
    periodSemantics: 'RANGE',
    comparativeDefault: 'PRIOR_PERIOD',
    reviewStatus: REPORT_TEMPLATES.profitAndLoss.reviewStatus,
  },
  {
    key: 'BALANCE_SHEET',
    titleEn: 'Statement of financial position',
    titleBn: 'আর্থিক অবস্থানের বিবরণী',
    periodSemantics: 'AS_OF',
    comparativeDefault: 'PRIOR_PERIOD',
    reviewStatus: REPORT_TEMPLATES.balanceSheet.reviewStatus,
  },
  {
    key: 'CASH_FLOW',
    titleEn: 'Statement of cash flows',
    titleBn: 'নগদ প্রবাহের বিবরণী',
    periodSemantics: 'RANGE',
    comparativeDefault: 'PRIOR_PERIOD',
    reviewStatus: REPORT_TEMPLATES.cashFlow.reviewStatus,
  },
  {
    key: 'CHANGES_IN_EQUITY',
    titleEn: 'Statement of changes in equity',
    titleBn: 'ইকুইটির পরিবর্তনের বিবরণী',
    periodSemantics: 'RANGE',
    comparativeDefault: 'PRIOR_PERIOD',
    reviewStatus: REPORT_TEMPLATES.equity.reviewStatus,
  },
  {
    key: 'AR_AGEING',
    titleEn: 'Receivables ageing',
    titleBn: 'প্রাপ্য এজিং',
    periodSemantics: 'AS_OF',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.arAgeing.reviewStatus,
  },
  {
    key: 'AP_AGEING',
    titleEn: 'Payables ageing',
    titleBn: 'প্রদেয় এজিং',
    periodSemantics: 'AS_OF',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.apAgeing.reviewStatus,
  },
  {
    key: 'STOCK_VALUATION',
    titleEn: 'Stock valuation',
    titleBn: 'স্টক মূল্যায়ন',
    periodSemantics: 'AS_OF',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.stock.reviewStatus,
  },
  {
    key: 'VAT_SALES_REGISTER',
    titleEn: 'Sales VAT register (internal)',
    titleBn: 'বিক্রয় ভ্যাট রেজিস্টার (অভ্যন্তরীণ)',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.vatRegisters.reviewStatus,
  },
  {
    key: 'VAT_PURCHASE_REGISTER',
    titleEn: 'Purchase VAT register (internal)',
    titleBn: 'ক্রয় ভ্যাট রেজিস্টার (অভ্যন্তরীণ)',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.vatRegisters.reviewStatus,
  },
  {
    key: 'VAT_RETURN_DRAFT',
    titleEn: 'Internal VAT return draft',
    titleBn: 'অভ্যন্তরীণ ভ্যাট রিটার্ন খসড়া',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.vatReturn.reviewStatus,
  },
  {
    key: 'WITHHOLDING_REGISTER',
    titleEn: 'VDS/TDS and challan register',
    titleBn: 'ভিডিএস/টিডিএস ও চালান রেজিস্টার',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.withholding.reviewStatus,
  },
  {
    key: 'JOURNAL_LISTING',
    titleEn: 'Journal listing',
    titleBn: 'জার্নাল তালিকা',
    periodSemantics: 'RANGE',
    comparativeDefault: 'NONE',
    reviewStatus: REPORT_TEMPLATES.journalListing.reviewStatus,
  },
];

export function reportReviewStatusFor(key: string): ReportReviewStatus {
  return DEFINITIONS.find((definition) => definition.key === key)?.reviewStatus ?? 'PENDING_ACCOUNTANT_REVIEW';
}

export async function getReportCatalog(database: Queryable, companyId: string): Promise<ReportCatalogDto> {
  const company = await database.query<{ id: string; legal_name: string; bin: string | null }>(
    `SELECT id, legal_name, bin FROM companies WHERE id = $1`,
    [companyId],
  );
  const periods = await database.query<{
    id: string;
    code: string;
    label: string;
    start_date: Date;
    end_date: Date;
    status: string;
    fiscal_year_id: string;
  }>(
    `SELECT id, code, label, start_date, end_date, status, fiscal_year_id
       FROM periods WHERE company_id = $1 ORDER BY start_date ASC`,
    [companyId],
  );
  const fiscalYears = await database.query<{
    id: string;
    label: string;
    start_date: Date;
    end_date: Date;
    status: string;
  }>(
    `SELECT id, label, start_date, end_date, status
       FROM fiscal_years WHERE company_id = $1 ORDER BY start_date ASC`,
    [companyId],
  );
  const branches = await database.query<{
    id: string;
    code: string;
    name_en: string;
    name_bn: string | null;
    is_principal: boolean;
    status: string;
  }>(
    `SELECT id, code, name_en, name_bn, is_principal, status
       FROM branches WHERE company_id = $1 ORDER BY is_principal DESC, code ASC`,
    [companyId],
  );
  const companyRow = company.rows[0];
  return {
    company: companyRow
      ? { id: companyRow.id, legalName: companyRow.legal_name, bin: companyRow.bin }
      : { id: companyId, legalName: 'Company', bin: null },
    periods: periods.rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      startDate: formatDatabaseDate(row.start_date),
      endDate: formatDatabaseDate(row.end_date),
      status: row.status,
      fiscalYearId: row.fiscal_year_id,
    })),
    fiscalYears: fiscalYears.rows.map((row) => ({
      id: row.id,
      label: row.label,
      startDate: formatDatabaseDate(row.start_date),
      endDate: formatDatabaseDate(row.end_date),
      status: row.status,
    })),
    branches: branches.rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameEn: row.name_en,
      nameBn: row.name_bn,
      isPrincipal: row.is_principal,
      status: row.status,
    })),
    templates: ALL_TEMPLATES,
    definitions: DEFINITIONS,
  };
}
