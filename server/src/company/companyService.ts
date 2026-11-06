import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { ENTITY_TYPES, INDUSTRY_PACKS, REPORTING_FRAMEWORKS } from './constants.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface CompanyProfileDto {
  id: string;
  organisationId: string;
  legalName: string;
  tradeName: string | null;
  entityType: string | null;
  industry: string | null;
  tin: string | null;
  bin: string | null;
  rjscNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  reportingFramework: string | null;
  baseCurrency: string;
  timezone: string;
  status: string;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CompanyRow {
  id: string;
  organisation_id: string;
  legal_name: string;
  trade_name: string | null;
  entity_type: string | null;
  industry: string | null;
  tin: string | null;
  bin: string | null;
  rjsc_no: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  reporting_framework: string | null;
  base_currency: string;
  timezone: string;
  status: string;
  onboarding_completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COMPANY_PROFILE_SELECT = `
  SELECT c.id, c.organisation_id, c.legal_name, c.trade_name, c.entity_type, c.industry, c.tin,
         c.bin, c.rjsc_no, c.address, c.phone, c.email, c.reporting_framework, c.base_currency,
         c.timezone, c.status, o.completed_at AS onboarding_completed_at, c.created_at, c.updated_at
    FROM companies c
    LEFT JOIN company_onboarding o ON o.company_id = c.id
`;

function mapCompany(row: CompanyRow): CompanyProfileDto {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    entityType: row.entity_type,
    industry: row.industry,
    tin: row.tin,
    bin: row.bin,
    rjscNo: row.rjsc_no,
    address: row.address,
    phone: row.phone,
    email: row.email,
    reportingFramework: row.reporting_framework,
    baseCurrency: row.base_currency,
    timezone: row.timezone,
    status: row.status,
    onboardingCompletedAt: row.onboarding_completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CompanyProfileInput {
  legalName: string;
  tradeName?: string | null;
  entityType: string;
  industry: string;
  tin?: string | null;
  bin?: string | null;
  rjscNo?: string | null;
  address: string;
  phone?: string | null;
  email?: string | null;
  reportingFramework: string;
  baseCurrency?: string;
  timezone?: string;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) {
    throw new AppError(400, 'COMPANY_PROFILE_INVALID', `A company profile field exceeds ${max} characters.`);
  }
  return text;
}

function validateProfile(input: CompanyProfileInput): CompanyProfileInput {
  const legalName = input.legalName.trim();
  if (legalName.length < 1 || legalName.length > 200) {
    throw new AppError(400, 'COMPANY_LEGAL_NAME_INVALID', 'The legal name must be 1–200 characters.');
  }
  if (!(ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new AppError(400, 'COMPANY_ENTITY_TYPE_INVALID', 'Choose a valid entity type.');
  }
  if (!(INDUSTRY_PACKS as readonly string[]).includes(input.industry)) {
    throw new AppError(400, 'COMPANY_INDUSTRY_INVALID', 'Choose a valid industry.');
  }
  if (!(REPORTING_FRAMEWORKS as readonly string[]).includes(input.reportingFramework)) {
    throw new AppError(400, 'REPORTING_FRAMEWORK_INVALID', 'Choose a valid reporting framework.');
  }
  if (input.baseCurrency && input.baseCurrency !== 'BDT') {
    throw new AppError(
      400,
      'BASE_CURRENCY_NOT_SUPPORTED',
      'This release supports BDT as the company base currency only.',
    );
  }
  if (input.timezone && input.timezone !== 'Asia/Dhaka') {
    throw new AppError(
      400,
      'TIMEZONE_NOT_SUPPORTED',
      'This release supports the Asia/Dhaka company time zone only. Multi-time-zone reporting needs a separate design.',
    );
  }
  const address = input.address.trim();
  if (address.length < 1 || address.length > 500) {
    throw new AppError(400, 'COMPANY_ADDRESS_INVALID', 'The registered address must be 1–500 characters.');
  }
  const phone = optionalText(input.phone, 32);
  const email = optionalText(input.email, 320);
  if (!phone && !email) {
    throw new AppError(400, 'COMPANY_CONTACT_REQUIRED', 'Enter at least one contact phone number or email address.');
  }
  if (phone && !/^\+?[0-9 ()-]{6,24}$/.test(phone)) {
    throw new AppError(
      400,
      'COMPANY_PHONE_FORMAT',
      'The phone format is not recognised. This is a format check only, not a telecom verification.',
    );
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'COMPANY_EMAIL_FORMAT', 'Enter a valid contact email address.');
  }
  const tin = optionalText(input.tin, 32);
  if (tin && !/^\d{9,12}$/.test(tin)) {
    throw new AppError(
      400,
      'COMPANY_TIN_FORMAT',
      'TIN must contain 9–12 digits. This is a format check only; the application does not perform statutory TIN validation.',
    );
  }
  const bin = optionalText(input.bin, 32);
  if (bin && !/^\d{9}(-\d{4})?$/.test(bin)) {
    throw new AppError(
      400,
      'COMPANY_BIN_FORMAT',
      'BIN must be 9 digits with an optional 4-digit unit suffix. This is a format check only; the application does not perform statutory BIN validation.',
    );
  }
  const rjscNo = optionalText(input.rjscNo, 64);
  if (rjscNo && !/^[A-Za-z0-9/-]{4,64}$/.test(rjscNo)) {
    throw new AppError(
      400,
      'COMPANY_RJSC_FORMAT',
      'The RJSC number format is not recognised. This is a format check only, not a registry verification.',
    );
  }
  return {
    ...input,
    legalName,
    tradeName: optionalText(input.tradeName, 200),
    tin,
    bin,
    rjscNo,
    address,
    phone,
    email,
    baseCurrency: 'BDT',
    timezone: 'Asia/Dhaka',
  };
}

export function isCompanyProfileComplete(profile: {
  legalName: string | null;
  entityType: string | null;
  industry: string | null;
  reportingFramework: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  baseCurrency: string;
  timezone: string;
}): boolean {
  return Boolean(
    profile.legalName &&
    profile.entityType &&
    profile.industry &&
    profile.reportingFramework &&
    profile.address &&
    (profile.phone || profile.email) &&
    profile.baseCurrency === 'BDT' &&
    profile.timezone === 'Asia/Dhaka',
  );
}

export async function getCompanyProfile(database: Queryable, companyId: string): Promise<CompanyProfileDto> {
  const result = await database.query<CompanyRow>(`${COMPANY_PROFILE_SELECT} WHERE c.id = $1`, [companyId]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return mapCompany(row);
}

export async function createCompany(
  pool: Pool,
  input: {
    organisationId: string;
    membershipId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    profile: CompanyProfileInput;
  },
): Promise<CompanyProfileDto> {
  const profile = validateProfile(input.profile);
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO companies (
         organisation_id, legal_name, trade_name, entity_type, industry, tin, bin, rjsc_no,
         address, phone, email, reporting_framework, base_currency, timezone, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'BDT','Asia/Dhaka','ACTIVE')
       RETURNING id`,
      [
        input.organisationId,
        profile.legalName,
        profile.tradeName,
        profile.entityType,
        profile.industry,
        profile.tin,
        profile.bin,
        profile.rjscNo,
        profile.address,
        profile.phone,
        profile.email,
        profile.reportingFramework,
      ],
    );
    const companyId = inserted.rows[0]?.id;
    if (!companyId) throw new AppError(500, 'COMPANY_CREATE_FAILED', 'The company could not be created.');

    await client.query(
      `INSERT INTO company_memberships (organisation_id, company_id, membership_id, status)
       VALUES ($1,$2,$3,'ACTIVE')`,
      [input.organisationId, companyId, input.membershipId],
    );
    await client.query(
      `INSERT INTO company_onboarding (company_id, organisation_id, current_step)
       VALUES ($1,$2,'FISCAL_YEAR')`,
      [companyId, input.organisationId],
    );
    await client.query(
      `INSERT INTO company_settings (company_id, key, value_json, updated_by)
       VALUES ($1, 'language', $2::jsonb, $3),
              ($1, 'approval_thresholds', $4::jsonb, $3),
              ($1, 'tax', $5::jsonb, $3)`,
      [
        companyId,
        JSON.stringify({ language: 'en-BD' }),
        input.actorUserId,
        JSON.stringify({ highValuePoisha: '0', paymentPoisha: '0' }),
        JSON.stringify({
          vatStatus: null,
          filingFrequency: 'NOT_APPLICABLE',
          withholdingEntity: false,
          notes: '',
        }),
      ],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'company.created',
      entityType: 'company',
      entityId: companyId,
      after: {
        legalName: profile.legalName,
        tradeName: profile.tradeName,
        entityType: profile.entityType,
        industry: profile.industry,
        tin: profile.tin,
        bin: profile.bin,
        rjscNo: profile.rjscNo,
        address: profile.address,
        phone: profile.phone,
        email: profile.email,
        reportingFramework: profile.reportingFramework,
        baseCurrency: 'BDT',
        timezone: 'Asia/Dhaka',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getCompanyProfile(client, companyId);
  });
}

export interface CompanyProfilePatch {
  legalName?: string;
  tradeName?: string | null;
  entityType?: string;
  industry?: string;
  tin?: string | null;
  bin?: string | null;
  rjscNo?: string | null;
  address?: string;
  phone?: string | null;
  email?: string | null;
  reportingFramework?: string;
  baseCurrency?: string;
  timezone?: string;
}

export async function updateCompanyProfile(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
    patch: CompanyProfilePatch;
  },
): Promise<CompanyProfileDto> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<CompanyRow>(`${COMPANY_PROFILE_SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [
      input.companyId,
    ]);
    const before = current.rows[0];
    if (!before) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
    const merged = validateProfile({
      legalName: input.patch.legalName ?? before.legal_name,
      tradeName: input.patch.tradeName === undefined ? before.trade_name : input.patch.tradeName,
      entityType: input.patch.entityType ?? before.entity_type ?? '',
      industry: input.patch.industry ?? before.industry ?? '',
      tin: input.patch.tin === undefined ? before.tin : input.patch.tin,
      bin: input.patch.bin === undefined ? before.bin : input.patch.bin,
      rjscNo: input.patch.rjscNo === undefined ? before.rjsc_no : input.patch.rjscNo,
      address: input.patch.address ?? before.address ?? '',
      phone: input.patch.phone === undefined ? before.phone : input.patch.phone,
      email: input.patch.email === undefined ? before.email : input.patch.email,
      reportingFramework: input.patch.reportingFramework ?? before.reporting_framework ?? '',
      baseCurrency: input.patch.baseCurrency ?? before.base_currency,
      timezone: input.patch.timezone ?? before.timezone,
    });
    await client.query(
      `UPDATE companies
          SET legal_name = $2, trade_name = $3, entity_type = $4, industry = $5, tin = $6, bin = $7,
              rjsc_no = $8, address = $9, phone = $10, email = $11, reporting_framework = $12,
              base_currency = 'BDT', timezone = 'Asia/Dhaka'
        WHERE id = $1`,
      [
        input.companyId,
        merged.legalName,
        merged.tradeName,
        merged.entityType,
        merged.industry,
        merged.tin,
        merged.bin,
        merged.rjscNo,
        merged.address,
        merged.phone,
        merged.email,
        merged.reportingFramework,
      ],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'company.profile_updated',
      entityType: 'company',
      entityId: input.companyId,
      before: {
        legalName: before.legal_name,
        tradeName: before.trade_name,
        entityType: before.entity_type,
        industry: before.industry,
        tin: before.tin,
        bin: before.bin,
        rjscNo: before.rjsc_no,
        address: before.address,
        phone: before.phone,
        email: before.email,
        reportingFramework: before.reporting_framework,
        baseCurrency: before.base_currency,
        timezone: before.timezone,
      },
      after: {
        legalName: merged.legalName,
        tradeName: merged.tradeName,
        entityType: merged.entityType,
        industry: merged.industry,
        tin: merged.tin,
        bin: merged.bin,
        rjscNo: merged.rjscNo,
        address: merged.address,
        phone: merged.phone,
        email: merged.email,
        reportingFramework: merged.reportingFramework,
        baseCurrency: 'BDT',
        timezone: 'Asia/Dhaka',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return getCompanyProfile(client, input.companyId);
  });
}
