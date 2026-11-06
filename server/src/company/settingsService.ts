import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { DOCUMENT_TYPES, FILING_FREQUENCIES, REPORTING_FRAMEWORKS, VAT_REGISTRATION_STATUSES } from './constants.ts';
import { parseBdtToPoisha } from './money.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface ApprovalThresholds {
  highValuePoisha: string;
  paymentPoisha: string;
}

export interface TaxSettings {
  /** null means the administrator has not made a tax-registration decision yet. */
  vatStatus: string | null;
  filingFrequency: string;
  withholdingEntity: boolean;
  notes: string;
}

export interface NumberSequenceDto {
  id: string;
  companyId: string;
  fiscalYearId: string;
  docType: string;
  prefix: string;
  nextValue: string;
  pad: number;
  version: number;
  updatedAt: string;
}

export interface CompanySettingsDto {
  companyId: string;
  reportingFramework: string | null;
  timezone: string;
  baseCurrency: string;
  language: string;
  approvalThresholds: ApprovalThresholds;
  tax: TaxSettings;
  numberSequences: NumberSequenceDto[];
}

interface SettingRow {
  key: string;
  value_json: unknown;
}

interface SequenceRow {
  id: string;
  company_id: string;
  fiscal_year_id: string;
  doc_type: string;
  prefix: string;
  next_value: string;
  pad: number;
  version: number;
  updated_at: Date;
}

function mapSequence(row: SequenceRow): NumberSequenceDto {
  return {
    id: row.id,
    companyId: row.company_id,
    fiscalYearId: row.fiscal_year_id,
    docType: row.doc_type,
    prefix: row.prefix,
    nextValue: row.next_value,
    pad: row.pad,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readLanguage(value: unknown): string {
  const object = asObject(value);
  return typeof object.language === 'string' ? object.language : 'en-BD';
}

function readApproval(value: unknown): ApprovalThresholds {
  const object = asObject(value);
  return {
    highValuePoisha: typeof object.highValuePoisha === 'string' ? object.highValuePoisha : '0',
    paymentPoisha: typeof object.paymentPoisha === 'string' ? object.paymentPoisha : '0',
  };
}

function readTax(value: unknown): TaxSettings {
  const object = asObject(value);
  return {
    vatStatus: typeof object.vatStatus === 'string' ? object.vatStatus : null,
    filingFrequency:
      typeof object.filingFrequency === 'string' &&
      (FILING_FREQUENCIES as readonly string[]).includes(object.filingFrequency)
        ? object.filingFrequency
        : 'NOT_APPLICABLE',
    withholdingEntity: object.withholdingEntity === true,
    notes: typeof object.notes === 'string' ? object.notes : '',
  };
}

export async function getCompanySettings(database: Queryable, companyId: string): Promise<CompanySettingsDto> {
  const company = await database.query<{
    reporting_framework: string | null;
    timezone: string;
    base_currency: string;
  }>(`SELECT reporting_framework, timezone, base_currency FROM companies WHERE id = $1`, [companyId]);
  const row = company.rows[0];
  if (!row) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  const settings = await database.query<SettingRow>(
    `SELECT key, value_json FROM company_settings WHERE company_id = $1`,
    [companyId],
  );
  const byKey = new Map(settings.rows.map((setting) => [setting.key, setting.value_json]));
  const sequences = await database.query<SequenceRow>(
    `SELECT id, company_id, fiscal_year_id, doc_type, prefix, next_value::text AS next_value,
            pad, version, updated_at
       FROM number_sequences
      WHERE company_id = $1
      ORDER BY fiscal_year_id DESC, doc_type ASC`,
    [companyId],
  );
  return {
    companyId,
    reportingFramework: row.reporting_framework,
    timezone: row.timezone,
    baseCurrency: row.base_currency,
    language: readLanguage(byKey.get('language')),
    approvalThresholds: readApproval(byKey.get('approval_thresholds')),
    tax: readTax(byKey.get('tax')),
    numberSequences: sequences.rows.map(mapSequence),
  };
}

export interface CompanySettingsPatch {
  language?: string;
  reportingFramework?: string;
  timezone?: string;
  approvalThresholds?: { highValue?: string; payment?: string };
  tax?: {
    vatStatus?: string | null;
    filingFrequency?: string;
    withholdingEntity?: boolean;
    notes?: string;
  };
  fiscalYearId?: string;
  numberSequences?: Array<{
    docType: string;
    prefix: string;
    nextValue: string;
    pad: number;
  }>;
}

function parseWholeAmount(value: string | undefined, current: string, field: string): string {
  if (value === undefined) return current;
  const poisha = parseBdtToPoisha(value);
  if (poisha === null || poisha < 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', `${field} must be a non-negative BDT amount with up to 2 decimals.`);
  }
  return poisha.toString();
}

function validateTax(tax: TaxSettings): TaxSettings {
  if (tax.vatStatus !== null && !(VAT_REGISTRATION_STATUSES as readonly string[]).includes(tax.vatStatus)) {
    throw new AppError(
      400,
      'TAX_STATUS_INVALID',
      'Choose a VAT registration status or leave it unconfigured. This is accounting configuration, not statutory validation.',
    );
  }
  if (!(FILING_FREQUENCIES as readonly string[]).includes(tax.filingFrequency)) {
    throw new AppError(400, 'TAX_FILING_FREQUENCY_INVALID', 'Choose a filing frequency.');
  }
  if (tax.notes.length > 1000) {
    throw new AppError(400, 'TAX_NOTES_INVALID', 'Tax notes must be at most 1,000 characters.');
  }
  return tax;
}

export async function updateCompanySettings(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    patch: CompanySettingsPatch;
  },
): Promise<CompanySettingsDto> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`company-settings:${input.companyId}`]);
    const company = await client.query<{
      reporting_framework: string | null;
      timezone: string;
      base_currency: string;
    }>(`SELECT reporting_framework, timezone, base_currency FROM companies WHERE id = $1 FOR UPDATE`, [
      input.companyId,
    ]);
    const beforeCompany = company.rows[0];
    if (!beforeCompany) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');

    const settings = await getCompanySettings(client, input.companyId);
    const before = {
      ...settings,
      reportingFramework: beforeCompany.reporting_framework,
      timezone: beforeCompany.timezone,
    };

    const reportingFramework = input.patch.reportingFramework ?? beforeCompany.reporting_framework ?? undefined;
    if (reportingFramework !== undefined && !(REPORTING_FRAMEWORKS as readonly string[]).includes(reportingFramework)) {
      throw new AppError(400, 'REPORTING_FRAMEWORK_INVALID', 'Choose a valid reporting framework.');
    }
    const timezone = input.patch.timezone ?? beforeCompany.timezone;
    if (timezone !== 'Asia/Dhaka') {
      throw new AppError(
        400,
        'TIMEZONE_NOT_SUPPORTED',
        'This release supports the Asia/Dhaka company time zone only. Multi-time-zone reporting needs a separate design.',
      );
    }
    if (input.patch.language !== undefined && !['en-BD', 'bn-BD'].includes(input.patch.language)) {
      throw new AppError(400, 'LANGUAGE_INVALID', 'Choose English or Bangla for the company default language.');
    }

    const approval: ApprovalThresholds = {
      highValuePoisha: parseWholeAmount(
        input.patch.approvalThresholds?.highValue,
        settings.approvalThresholds.highValuePoisha,
        'The high-value approval threshold',
      ),
      paymentPoisha: parseWholeAmount(
        input.patch.approvalThresholds?.payment,
        settings.approvalThresholds.paymentPoisha,
        'The payment approval threshold',
      ),
    };
    const tax = validateTax({
      vatStatus: input.patch.tax?.vatStatus === undefined ? settings.tax.vatStatus : input.patch.tax.vatStatus,
      filingFrequency: input.patch.tax?.filingFrequency ?? settings.tax.filingFrequency,
      withholdingEntity: input.patch.tax?.withholdingEntity ?? settings.tax.withholdingEntity,
      notes: input.patch.tax?.notes?.trim() ?? settings.tax.notes,
    });

    if (reportingFramework !== beforeCompany.reporting_framework) {
      await client.query(`UPDATE companies SET reporting_framework = $2, updated_at = now() WHERE id = $1`, [
        input.companyId,
        reportingFramework,
      ]);
    }

    const language = input.patch.language ?? settings.language;
    await client.query(
      `INSERT INTO company_settings (company_id, key, value_json, updated_by)
       VALUES ($1, 'language', $2::jsonb, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value_json = EXCLUDED.value_json,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.companyId, JSON.stringify({ language }), input.actorUserId],
    );
    await client.query(
      `INSERT INTO company_settings (company_id, key, value_json, updated_by)
       VALUES ($1, 'approval_thresholds', $2::jsonb, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value_json = EXCLUDED.value_json,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.companyId, JSON.stringify(approval), input.actorUserId],
    );
    await client.query(
      `INSERT INTO company_settings (company_id, key, value_json, updated_by)
       VALUES ($1, 'tax', $2::jsonb, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value_json = EXCLUDED.value_json,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.companyId, JSON.stringify(tax), input.actorUserId],
    );

    if (input.patch.numberSequences && input.patch.numberSequences.length > 0) {
      const fiscalYear = input.patch.fiscalYearId
        ? await client.query<{ id: string }>(`SELECT id FROM fiscal_years WHERE company_id = $1 AND id = $2`, [
            input.companyId,
            input.patch.fiscalYearId,
          ])
        : await client.query<{ id: string }>(
            `SELECT id FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1`,
            [input.companyId],
          );
      const fiscalYearId = fiscalYear.rows[0]?.id;
      if (!fiscalYearId) {
        throw new AppError(
          409,
          'FISCAL_YEAR_REQUIRED',
          'Create the fiscal year before configuring document number sequences.',
        );
      }
      for (const sequence of input.patch.numberSequences) {
        if (!(DOCUMENT_TYPES as readonly string[]).includes(sequence.docType)) {
          throw new AppError(400, 'NUMBER_SEQUENCE_DOC_TYPE_INVALID', `Unknown document type ${sequence.docType}.`);
        }
        const prefix = sequence.prefix.trim();
        if (prefix.length < 1 || prefix.length > 20) {
          throw new AppError(400, 'NUMBER_SEQUENCE_PREFIX_INVALID', 'Number prefixes must be 1–20 characters.');
        }
        if (!/^[1-9][0-9]{0,17}$/.test(sequence.nextValue)) {
          throw new AppError(
            400,
            'NUMBER_SEQUENCE_NEXT_INVALID',
            'The next number must be a whole number of at least 1.',
          );
        }
        if (!Number.isInteger(sequence.pad) || sequence.pad < 1 || sequence.pad > 12) {
          throw new AppError(400, 'NUMBER_SEQUENCE_PAD_INVALID', 'Padding must be a whole number between 1 and 12.');
        }
        await client.query(
          `INSERT INTO number_sequences (company_id, fiscal_year_id, doc_type, prefix, next_value, pad)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (company_id, fiscal_year_id, doc_type)
           DO UPDATE SET prefix = EXCLUDED.prefix, next_value = EXCLUDED.next_value,
             pad = EXCLUDED.pad, version = number_sequences.version + 1`,
          [input.companyId, fiscalYearId, sequence.docType, prefix, sequence.nextValue, sequence.pad],
        );
      }
    }

    const after = await getCompanySettings(client, input.companyId);
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'company.settings_updated',
      entityType: 'company_settings',
      entityId: input.companyId,
      before: {
        reportingFramework: before.reportingFramework,
        timezone: before.timezone,
        language: before.language,
        approvalThresholds: before.approvalThresholds,
        tax: before.tax,
        numberSequences: before.numberSequences.map((sequence) => ({
          docType: sequence.docType,
          prefix: sequence.prefix,
          nextValue: sequence.nextValue,
          pad: sequence.pad,
        })),
      },
      after: {
        reportingFramework: after.reportingFramework,
        timezone: after.timezone,
        language: after.language,
        approvalThresholds: after.approvalThresholds,
        tax: after.tax,
        numberSequences: after.numberSequences.map((sequence) => ({
          docType: sequence.docType,
          prefix: sequence.prefix,
          nextValue: sequence.nextValue,
          pad: sequence.pad,
        })),
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return after;
  });
}
