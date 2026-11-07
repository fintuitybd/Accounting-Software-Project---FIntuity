import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Identity, Phase 4 company-configuration and Phase 5 ledger tables. The SQL migrations remain
 * authoritative for constraints, triggers and composite tenant foreign keys; these bindings mirror
 * the column shape for typed ORM access.
 */

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  country: text('country').notNull().default('BD'),
  timezone: text('timezone').notNull().default('Asia/Dhaka'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    status: text('status').notNull().default('INVITED'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_uidx').on(sql`lower(${table.email})`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('INVITED'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_organisation_user_unique').on(table.organisationId, table.userId),
    index('memberships_organisation_idx').on(table.organisationId),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    entityType: text('entity_type'),
    industry: text('industry'),
    tin: text('tin'),
    bin: text('bin'),
    rjscNo: text('rjsc_no'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    reportingFramework: text('reporting_framework'),
    baseCurrency: text('base_currency').notNull().default('BDT'),
    timezone: text('timezone').notNull().default('Asia/Dhaka'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('companies_organisation_idx').on(table.organisationId),
    unique('companies_organisation_id_unique').on(table.organisationId, table.id),
  ],
);

export const companyMemberships = pgTable(
  'company_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    roleOverride: text('role_override'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('company_memberships_membership_company_unique').on(table.membershipId, table.companyId),
    index('company_memberships_company_idx').on(table.companyId),
    index('company_memberships_organisation_idx').on(table.organisationId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    resendCount: integer('resend_count').notNull().default(0),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('invitations_token_hash_unique').on(table.tokenHash),
    index('invitations_organisation_idx').on(table.organisationId, table.createdAt),
    index('invitations_email_idx').on(sql`lower(${table.email})`),
  ],
);

export const invitationCompanies = pgTable(
  'invitation_companies',
  {
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => invitations.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull(),
    companyId: uuid('company_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.companyId] }),
    index('invitation_companies_company_idx').on(table.companyId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    activeOrganisationId: uuid('active_organisation_id').references(() => organisations.id, {
      onDelete: 'restrict',
    }),
    activeCompanyId: uuid('active_company_id').references(() => companies.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    unique('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId, table.createdAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    requestedIp: inet('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('password_reset_tokens_hash_unique').on(table.tokenHash),
    index('password_reset_tokens_user_idx').on(table.userId, table.createdAt),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('email_verification_tokens_hash_unique').on(table.tokenHash),
    index('email_verification_tokens_user_idx').on(table.userId, table.createdAt),
  ],
);

export const rateLimitCounters = pgTable('rate_limit_counters', {
  bucketKey: text('bucket_key').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
  counter: integer('counter').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    reason: text('reason'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_organisation_created_idx').on(table.organisationId, table.createdAt),
    index('audit_events_company_created_idx').on(table.companyId, table.createdAt),
    index('audit_events_entity_idx').on(table.entityType, table.entityId),
    index('audit_events_actor_idx').on(table.actorUserId, table.createdAt),
  ],
);

export const companyOnboarding = pgTable('company_onboarding', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'restrict' }),
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' }),
  currentStep: text('current_step').notNull().default('COMPANY'),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('fiscal_years_company_id_unique').on(table.companyId, table.id),
    unique('fiscal_years_company_start_unique').on(table.companyId, table.startDate),
    index('fiscal_years_company_idx').on(table.companyId, table.startDate),
  ],
);

export const periods = pgTable(
  'periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('OPEN'),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'restrict' }),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'restrict' }),
    reopenedReason: text('reopened_reason'),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'restrict' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('periods_company_id_unique').on(table.companyId, table.id),
    unique('periods_company_code_unique').on(table.companyId, table.code),
    unique('periods_company_start_unique').on(table.companyId, table.startDate),
    index('periods_company_dates_idx').on(table.companyId, table.startDate),
    index('periods_fiscal_year_idx').on(table.fiscalYearId),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn'),
    accountType: text('account_type').notNull(),
    subCategory: text('sub_category').notNull(),
    ifrsCategory: text('ifrs_category').notNull().default('NA_BALANCE_SHEET'),
    parentId: uuid('parent_id'),
    controlSubledger: text('control_subledger').notNull().default('NONE'),
    currency: text('currency').notNull().default('BDT'),
    taxMappingJson: jsonb('tax_mapping_json').$type<Record<string, string>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('accounts_company_id_unique').on(table.companyId, table.id),
    unique('accounts_company_code_unique').on(table.companyId, table.code),
    index('accounts_company_parent_idx').on(table.companyId, table.parentId),
    index('accounts_company_type_idx').on(table.companyId, table.accountType),
  ],
);

export const companySettings = pgTable(
  'company_settings',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    valueJson: jsonb('value_json').$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.key] })],
);

export const numberSequences = pgTable(
  'number_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(),
    prefix: text('prefix').notNull(),
    nextValue: bigint('next_value', { mode: 'bigint' }).notNull().default(1n),
    pad: integer('pad').notNull().default(4),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('number_sequences_company_id_unique').on(table.companyId, table.id),
    unique('number_sequences_company_year_type_unique').on(table.companyId, table.fiscalYearId, table.docType),
    index('number_sequences_company_idx').on(table.companyId, table.fiscalYearId),
  ],
);

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    provider: text('provider'),
    maskedNumber: text('masked_number'),
    branch: text('branch'),
    currency: text('currency').notNull().default('BDT'),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    openingPoisha: bigint('opening_poisha', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull().default('ACTIVE'),
    isPrincipal: boolean('is_principal').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_accounts_company_id_unique').on(table.companyId, table.id),
    unique('bank_accounts_company_gl_unique').on(table.companyId, table.glAccountId),
    index('bank_accounts_company_idx').on(table.companyId, table.status),
  ],
);

export const journals = pgTable(
  'journals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    journalNumber: text('journal_number'),
    bookType: text('book_type').notNull().default('STATUTORY_BD'),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'restrict' }),
    documentDate: date('document_date').notNull(),
    postingDate: date('posting_date').notNull(),
    sourceModule: text('source_module').notNull(),
    sourceDocId: uuid('source_doc_id'),
    sourceDocRef: text('source_doc_ref'),
    narrationEn: text('narration_en').notNull(),
    narrationBn: text('narration_bn'),
    currency: text('currency').notNull().default('BDT'),
    status: text('status').notNull().default('DRAFT'),
    idempotencyKey: text('idempotency_key'),
    attachmentReference: text('attachment_reference'),
    reversalOfJournalId: uuid('reversal_of_journal_id'),
    reversedByJournalId: uuid('reversed_by_journal_id'),
    reversalReason: text('reversal_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('journals_company_id_unique').on(table.companyId, table.id),
    index('journals_company_date_idx').on(table.companyId, table.postingDate, table.createdAt),
    index('journals_company_status_idx').on(table.companyId, table.status, table.postingDate),
    index('journals_company_source_idx').on(table.companyId, table.sourceModule, table.postingDate),
    index('journals_company_branch_date_idx').on(table.companyId, table.branchId, table.postingDate, table.createdAt),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journals.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    partyReference: text('party_reference'),
    partyName: text('party_name'),
    costCenter: text('cost_center'),
    projectCode: text('project_code'),
    debitPoisha: bigint('debit_poisha', { mode: 'bigint' }).notNull().default(0n),
    creditPoisha: bigint('credit_poisha', { mode: 'bigint' }).notNull().default(0n),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('journal_lines_company_id_unique').on(table.companyId, table.id),
    unique('journal_lines_journal_line_unique').on(table.companyId, table.journalId, table.lineNo),
    index('journal_lines_company_journal_idx').on(table.companyId, table.journalId),
    index('journal_lines_company_account_idx').on(table.companyId, table.accountId),
  ],
);

export const openingBalanceBatches = pgTable(
  'opening_balance_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'restrict' }),
    batchDate: date('batch_date').notNull(),
    status: text('status').notNull().default('DRAFT'),
    currency: text('currency').notNull().default('BDT'),
    totalDebitPoisha: bigint('total_debit_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalCreditPoisha: bigint('total_credit_poisha', { mode: 'bigint' }).notNull().default(0n),
    balanced: boolean('balanced').notNull().default(false),
    evidenceReference: text('evidence_reference'),
    evidenceNote: text('evidence_note'),
    evidenceChecksum: text('evidence_checksum'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    postingIdempotencyKey: text('posting_idempotency_key'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('opening_balance_batches_company_id_unique').on(table.companyId, table.id),
    index('opening_balance_batches_company_idx').on(table.companyId, table.createdAt),
  ],
);

export const openingBalanceLines = pgTable(
  'opening_balance_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => openingBalanceBatches.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    scheduleType: text('schedule_type').notNull().default('ACCOUNT'),
    scheduleJson: jsonb('schedule_json').$type<Record<string, unknown>>().notNull().default({}),
    debitPoisha: bigint('debit_poisha', { mode: 'bigint' }).notNull().default(0n),
    creditPoisha: bigint('credit_poisha', { mode: 'bigint' }).notNull().default(0n),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('opening_balance_lines_batch_line_unique').on(table.batchId, table.lineNo),
    unique('opening_balance_lines_company_id_unique').on(table.companyId, table.id),
    index('opening_balance_lines_company_batch_idx').on(table.companyId, table.batchId),
    index('opening_balance_lines_account_idx').on(table.companyId, table.accountId),
  ],
);

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  nameEn: text('name_en').notNull(),
  nameBn: text('name_bn'),
  address: text('address'),
  bin: text('bin'),
  isPrincipal: boolean('is_principal').notNull().default(false),
  status: text('status').notNull().default('ACTIVE'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  nameEn: text('name_en').notNull(),
  nameBn: text('name_bn'),
  type: text('type').notNull(),
  bin: text('bin'),
  tin: text('tin'),
  addressEn: text('address_en'),
  addressBn: text('address_bn'),
  phone: text('phone'),
  email: text('email'),
  creditDays: integer('credit_days').notNull().default(0),
  creditLimitPoisha: bigint('credit_limit_poisha', { mode: 'bigint' }).notNull().default(0n),
  isWithholdingBuyer: boolean('is_withholding_buyer').notNull().default(false),
  isGovernment: boolean('is_government').notNull().default(false),
  status: text('status').notNull().default('ACTIVE'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyOpeningItems = pgTable('party_opening_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  partyId: uuid('party_id').notNull(),
  documentType: text('document_type').notNull(),
  documentNo: text('document_no').notNull(),
  dueDate: date('due_date').notNull(),
  amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
  basePoisha: bigint('base_poisha', { mode: 'bigint' }),
  memo: text('memo'),
  status: text('status').notNull().default('OPEN'),
  cancelReason: text('cancel_reason'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
  cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  branchId: uuid('branch_id'),
  code: text('code').notNull(),
  nameEn: text('name_en').notNull(),
  nameBn: text('name_bn'),
  address: text('address'),
  status: text('status').notNull().default('ACTIVE'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull(),
  hsCode: text('hs_code'),
  nameEn: text('name_en').notNull(),
  nameBn: text('name_bn'),
  unit: text('unit').notNull(),
  unitBn: text('unit_bn'),
  isStockItem: boolean('is_stock_item').notNull().default(true),
  defaultTaxCategory: text('default_tax_category').notNull().default('STANDARD_15'),
  inventoryAccountId: uuid('inventory_account_id'),
  expenseAccountId: uuid('expense_account_id'),
  status: text('status').notNull().default('ACTIVE'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  commandId: uuid('command_id').notNull(),
  movementNo: integer('movement_no').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  movementType: text('movement_type').notNull(),
  movementDate: date('movement_date').notNull(),
  itemId: uuid('item_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitCostPoisha: bigint('unit_cost_poisha', { mode: 'bigint' }).notNull(),
  valuePoisha: bigint('value_poisha', { mode: 'bigint' }).notNull(),
  balanceAfterQuantity: numeric('balance_after_quantity', { precision: 18, scale: 4 }).notNull(),
  balanceAfterValuePoisha: bigint('balance_after_value_poisha', { mode: 'bigint' }).notNull(),
  sourceType: text('source_type').notNull(),
  sourceRef: text('source_ref'),
  sourceDocId: uuid('source_doc_id'),
  journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
  reversalOfMovementId: uuid('reversal_of_movement_id'),
  reversalReason: text('reversal_reason'),
  negativeStockOverride: boolean('negative_stock_override').notNull().default(false),
  overrideReason: text('override_reason'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const stockBalances = pgTable(
  'stock_balances',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
    valuePoisha: bigint('value_poisha', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.itemId, table.warehouseId] })],
);

export const salesDocuments = pgTable(
  'sales_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    docType: text('doc_type').notNull(),
    status: text('status').notNull().default('DRAFT'),
    documentNo: text('document_no'),
    statutorySerial: text('statutory_serial'),
    statutorySeries: text('statutory_series'),
    partyId: uuid('party_id').notNull(),
    originalDocumentId: uuid('original_document_id'),
    originalDocumentNo: text('original_document_no'),
    docDate: date('doc_date').notNull(),
    dueDate: date('due_date').notNull(),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    currency: text('currency').notNull().default('BDT'),
    narrationEn: text('narration_en').notNull(),
    narrationBn: text('narration_bn'),
    creditReason: text('credit_reason'),
    attachmentReference: text('attachment_reference'),
    subtotalPoisha: bigint('subtotal_poisha', { mode: 'bigint' }).notNull().default(0n),
    discountPoisha: bigint('discount_poisha', { mode: 'bigint' }).notNull().default(0n),
    vatPoisha: bigint('vat_poisha', { mode: 'bigint' }).notNull().default(0n),
    grossPoisha: bigint('gross_poisha', { mode: 'bigint' }).notNull().default(0n),
    taxPackVersion: text('tax_pack_version'),
    taxDecisionState: text('tax_decision_state'),
    taxSnapshotJson: jsonb('tax_snapshot_json').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id'),
    postingIdempotencyKey: text('posting_idempotency_key'),
    createIdempotencyKey: text('create_idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('sales_documents_company_id_unique').on(table.companyId, table.id),
    index('sales_documents_company_date_idx').on(table.companyId, table.docDate),
    index('sales_documents_company_party_idx').on(table.companyId, table.partyId),
  ],
);

export const salesDocumentLines = pgTable(
  'sales_document_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id'),
    descriptionEn: text('description_en').notNull(),
    descriptionBn: text('description_bn'),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
    unit: text('unit').notNull(),
    unitPricePoisha: bigint('unit_price_poisha', { mode: 'bigint' }).notNull(),
    discountPoisha: bigint('discount_poisha', { mode: 'bigint' }).notNull().default(0n),
    taxCategory: text('tax_category').notNull(),
    revenueAccountId: uuid('revenue_account_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    originalLineId: uuid('original_line_id'),
    stockMovementId: uuid('stock_movement_id'),
    lineBasePoisha: bigint('line_base_poisha', { mode: 'bigint' }).notNull(),
    vatPoisha: bigint('vat_poisha', { mode: 'bigint' }).notNull(),
    grossPoisha: bigint('gross_poisha', { mode: 'bigint' }).notNull(),
    taxRateBps: integer('tax_rate_bps').notNull(),
    taxRuleId: text('tax_rule_id'),
    taxDecisionState: text('tax_decision_state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('sales_document_lines_company_id_unique').on(table.companyId, table.id),
    unique('sales_document_lines_document_line_unique').on(table.companyId, table.documentId, table.lineNo),
    index('sales_document_lines_company_document_idx').on(table.companyId, table.documentId),
  ],
);

export const salesDocumentTaxes = pgTable(
  'sales_document_taxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    lineId: uuid('line_id')
      .notNull()
      .references(() => salesDocumentLines.id, { onDelete: 'restrict' }),
    taxType: text('tax_type').notNull().default('VAT'),
    taxCategory: text('tax_category').notNull(),
    rateBps: integer('rate_bps').notNull(),
    basePoisha: bigint('base_poisha', { mode: 'bigint' }).notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    ruleId: text('rule_id'),
    rulePackVersion: text('rule_pack_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('sales_document_taxes_company_document_idx').on(table.companyId, table.documentId)],
);

export const salesTaxDecisions = pgTable(
  'sales_tax_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    rulePackVersion: text('rule_pack_version').notNull(),
    rulePackStatus: text('rule_pack_status').notNull(),
    decisionState: text('decision_state').notNull(),
    traceId: text('trace_id').notNull(),
    inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull(),
    decisionJson: jsonb('decision_json').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('sales_tax_decisions_document_unique').on(table.companyId, table.documentId)],
);

export const salesDocumentEvents = pgTable(
  'sales_document_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('sales_document_events_company_document_idx').on(table.companyId, table.documentId)],
);

export const salesReceipts = pgTable(
  'sales_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    status: text('status').notNull().default('POSTED'),
    receiptNumber: text('receipt_number').notNull(),
    receiptDate: date('receipt_date').notNull(),
    partyId: uuid('party_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    writeOffPoisha: bigint('write_off_poisha', { mode: 'bigint' }).notNull().default(0n),
    reference: text('reference'),
    attachmentReference: text('attachment_reference'),
    narrationEn: text('narration_en'),
    narrationBn: text('narration_bn'),
    journalId: uuid('journal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('sales_receipts_company_id_unique').on(table.companyId, table.id),
    unique('sales_receipts_number_unique').on(table.companyId, table.receiptNumber),
    unique('sales_receipts_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('sales_receipts_company_date_idx').on(table.companyId, table.receiptDate),
  ],
);

export const salesReceiptAllocations = pgTable(
  'sales_receipt_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => salesReceipts.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull().default(0n),
    writeOffPoisha: bigint('write_off_poisha', { mode: 'bigint' }).notNull().default(0n),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('sales_receipt_allocations_company_receipt_idx').on(table.companyId, table.receiptId),
    index('sales_receipt_allocations_company_document_idx').on(table.companyId, table.documentId),
  ],
);

export const purchaseDocuments = pgTable(
  'purchase_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    docType: text('doc_type').notNull(),
    status: text('status').notNull().default('DRAFT'),
    documentNo: text('document_no'),
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    supplierInvoiceDate: date('supplier_invoice_date').notNull(),
    supplierMushak63Serial: text('supplier_mushak63_serial'),
    supplierMushak63Date: date('supplier_mushak63_date'),
    reverseChargeChallanReference: text('reverse_charge_challan_reference'),
    attachmentReference: text('attachment_reference'),
    partyId: uuid('party_id').notNull(),
    docDate: date('doc_date').notNull(),
    dueDate: date('due_date').notNull(),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    currency: text('currency').notNull().default('BDT'),
    narrationEn: text('narration_en').notNull(),
    narrationBn: text('narration_bn'),
    paymentMethod: text('payment_method').notNull().default('BANK'),
    supplierBin: text('supplier_bin'),
    supplierTin: text('supplier_tin'),
    supplierTinMissing: boolean('supplier_tin_missing').notNull().default(false),
    vdsApplicable: boolean('vds_applicable').notNull().default(false),
    tdsNature: text('tds_nature').notNull().default('NONE'),
    withholdingEntity: boolean('withholding_entity').notNull().default(false),
    subtotalPoisha: bigint('subtotal_poisha', { mode: 'bigint' }).notNull().default(0n),
    discountPoisha: bigint('discount_poisha', { mode: 'bigint' }).notNull().default(0n),
    vatPoisha: bigint('vat_poisha', { mode: 'bigint' }).notNull().default(0n),
    supplierVatPoisha: bigint('supplier_vat_poisha', { mode: 'bigint' }).notNull().default(0n),
    reverseChargeVatPoisha: bigint('reverse_charge_vat_poisha', { mode: 'bigint' }).notNull().default(0n),
    vatClaimablePoisha: bigint('vat_claimable_poisha', { mode: 'bigint' }).notNull().default(0n),
    vatDisallowedPoisha: bigint('vat_disallowed_poisha', { mode: 'bigint' }).notNull().default(0n),
    costPoisha: bigint('cost_poisha', { mode: 'bigint' }).notNull().default(0n),
    grossPoisha: bigint('gross_poisha', { mode: 'bigint' }).notNull().default(0n),
    vdsPoisha: bigint('vds_poisha', { mode: 'bigint' }).notNull().default(0n),
    tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    netPayablePoisha: bigint('net_payable_poisha', { mode: 'bigint' }).notNull().default(0n),
    taxPackVersion: text('tax_pack_version'),
    taxDecisionState: text('tax_decision_state'),
    taxSnapshotJson: jsonb('tax_snapshot_json').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id'),
    postingIdempotencyKey: text('posting_idempotency_key'),
    createIdempotencyKey: text('create_idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_documents_company_id_unique').on(table.companyId, table.id),
    index('purchase_documents_company_date_idx').on(table.companyId, table.docDate),
    index('purchase_documents_company_party_idx').on(table.companyId, table.partyId),
  ],
);

export const purchaseDocumentLines = pgTable(
  'purchase_document_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => purchaseDocuments.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id'),
    descriptionEn: text('description_en').notNull(),
    descriptionBn: text('description_bn'),
    quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
    unit: text('unit').notNull(),
    unitPricePoisha: bigint('unit_price_poisha', { mode: 'bigint' }).notNull(),
    discountPoisha: bigint('discount_poisha', { mode: 'bigint' }).notNull().default(0n),
    taxCategory: text('tax_category').notNull(),
    accountId: uuid('account_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    stockMovementId: uuid('stock_movement_id'),
    lineBasePoisha: bigint('line_base_poisha', { mode: 'bigint' }).notNull(),
    vatPoisha: bigint('vat_poisha', { mode: 'bigint' }).notNull(),
    vatClaimablePoisha: bigint('vat_claimable_poisha', { mode: 'bigint' }).notNull(),
    vatDisallowedPoisha: bigint('vat_disallowed_poisha', { mode: 'bigint' }).notNull(),
    nonRebatableVatPoisha: bigint('non_rebatable_vat_poisha', { mode: 'bigint' }).notNull().default(0n),
    costPoisha: bigint('cost_poisha', { mode: 'bigint' }).notNull(),
    supplierPayablePoisha: bigint('supplier_payable_poisha', { mode: 'bigint' }).notNull(),
    taxRateBps: integer('tax_rate_bps').notNull(),
    vdsRateBps: integer('vds_rate_bps').notNull().default(0),
    taxRuleId: text('tax_rule_id'),
    taxDecisionState: text('tax_decision_state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_document_lines_company_id_unique').on(table.companyId, table.id),
    unique('purchase_document_lines_document_line_unique').on(table.companyId, table.documentId, table.lineNo),
    index('purchase_document_lines_company_document_idx').on(table.companyId, table.documentId),
  ],
);

export const purchaseDocumentTaxes = pgTable('purchase_document_taxes', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => purchaseDocuments.id, { onDelete: 'restrict' }),
  lineId: uuid('line_id'),
  taxType: text('tax_type').notNull(),
  taxCategory: text('tax_category').notNull(),
  rateBps: integer('rate_bps').notNull(),
  basePoisha: bigint('base_poisha', { mode: 'bigint' }).notNull(),
  amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
  claimablePoisha: bigint('claimable_poisha', { mode: 'bigint' }).notNull().default(0n),
  disallowedPoisha: bigint('disallowed_poisha', { mode: 'bigint' }).notNull().default(0n),
  ruleId: text('rule_id'),
  rulePackVersion: text('rule_pack_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const purchaseTaxDecisions = pgTable('purchase_tax_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => purchaseDocuments.id, { onDelete: 'restrict' }),
  rulePackVersion: text('rule_pack_version').notNull(),
  rulePackStatus: text('rule_pack_status').notNull(),
  decisionState: text('decision_state').notNull(),
  traceId: text('trace_id').notNull(),
  inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull(),
  decisionJson: jsonb('decision_json').$type<Record<string, unknown>>().notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const purchaseDocumentEvents = pgTable('purchase_document_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => purchaseDocuments.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const purchasePayments = pgTable(
  'purchase_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id'),
    status: text('status').notNull().default('POSTED'),
    paymentNumber: text('payment_number').notNull(),
    paymentDate: date('payment_date').notNull(),
    partyId: uuid('party_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    vdsPoisha: bigint('vds_poisha', { mode: 'bigint' }).notNull().default(0n),
    tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    allocatedPoisha: bigint('allocated_poisha', { mode: 'bigint' }).notNull(),
    reference: text('reference'),
    attachmentReference: text('attachment_reference'),
    narrationEn: text('narration_en'),
    narrationBn: text('narration_bn'),
    journalId: uuid('journal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_payments_company_id_unique').on(table.companyId, table.id),
    unique('purchase_payments_number_unique').on(table.companyId, table.paymentNumber),
    unique('purchase_payments_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('purchase_payments_company_date_idx').on(table.companyId, table.paymentDate),
  ],
);

export const purchasePaymentAllocations = pgTable('purchase_payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => purchasePayments.id, { onDelete: 'restrict' }),
  documentId: uuid('document_id')
    .notNull()
    .references(() => purchaseDocuments.id, { onDelete: 'restrict' }),
  amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
  basePoisha: bigint('base_poisha', { mode: 'bigint' }).notNull(),
  vdsPoisha: bigint('vds_poisha', { mode: 'bigint' }).notNull().default(0n),
  tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const purchaseWithholdingLiabilities = pgTable('purchase_withholding_liabilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'restrict' }),
  sourceType: text('source_type').notNull(),
  billId: uuid('bill_id'),
  paymentId: uuid('payment_id'),
  allocationId: uuid('allocation_id'),
  partyId: uuid('party_id').notNull(),
  taxType: text('tax_type').notNull(),
  taxPeriod: text('tax_period').notNull(),
  basePoisha: bigint('base_poisha', { mode: 'bigint' }).notNull(),
  rateBps: integer('rate_bps').notNull(),
  amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
  status: text('status').notNull().default('PENDING'),
  journalId: uuid('journal_id').notNull(),
  economicCode: text('economic_code'),
  challanId: uuid('challan_id'),
  depositedAt: timestamp('deposited_at', { withTimezone: true, mode: 'date' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
  reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const purchasePaymentApprovalRequests = pgTable(
  'purchase_payment_approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('PENDING'),
    requestJson: jsonb('request_json').notNull(),
    cashPoisha: bigint('cash_poisha', { mode: 'bigint' }).notNull(),
    vdsPoisha: bigint('vds_poisha', { mode: 'bigint' }).notNull().default(0n),
    tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    allocatedPoisha: bigint('allocated_poisha', { mode: 'bigint' }).notNull().default(0n),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decisionReason: text('decision_reason'),
    paymentId: uuid('payment_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_payment_approval_requests_company_unique').on(table.companyId, table.id),
    unique('purchase_payment_approval_requests_idempotency_unique').on(table.companyId, table.idempotencyKey),
  ],
);

export const treasuryChallans = pgTable(
  'treasury_challans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    challanNumber: text('challan_number').notNull(),
    status: text('status').notNull().default('POSTED'),
    depositDate: date('deposit_date').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    bankBranch: text('bank_branch').notNull(),
    depositReference: text('deposit_reference').notNull(),
    evidenceReference: text('evidence_reference').notNull(),
    totalPoisha: bigint('total_poisha', { mode: 'bigint' }).notNull(),
    journalId: uuid('journal_id').notNull(),
    reversalJournalId: uuid('reversal_journal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique('treasury_challans_company_unique').on(table.companyId, table.id),
    unique('treasury_challans_number_unique').on(table.companyId, table.challanNumber),
    unique('treasury_challans_idempotency_unique').on(table.companyId, table.idempotencyKey),
  ],
);

export const treasuryChallanItems = pgTable(
  'treasury_challan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => treasuryChallans.id, { onDelete: 'restrict' }),
    liabilityId: uuid('liability_id')
      .notNull()
      .references(() => purchaseWithholdingLiabilities.id, { onDelete: 'restrict' }),
    taxType: text('tax_type').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    economicCode: text('economic_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('treasury_challan_items_company_unique').on(table.companyId, table.id),
    unique('treasury_challan_items_batch_unique').on(table.companyId, table.challanId, table.liabilityId),
  ],
);

export const treasuryCertificates = pgTable(
  'treasury_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    certificateType: text('certificate_type').notNull(),
    certificateNumber: text('certificate_number').notNull(),
    direction: text('direction').notNull().default('ISSUED'),
    partyId: uuid('party_id').notNull(),
    originalDocumentId: uuid('original_document_id'),
    paymentId: uuid('payment_id'),
    liabilityId: uuid('liability_id').notNull(),
    challanId: uuid('challan_id'),
    certificateDate: date('certificate_date').notNull(),
    basePoisha: bigint('base_poisha', { mode: 'bigint' }).notNull(),
    taxPoisha: bigint('tax_poisha', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('DRAFT'),
    evidenceReference: text('evidence_reference'),
    cancellationReason: text('cancellation_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    reissuedFromId: uuid('reissued_from_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('treasury_certificates_company_unique').on(table.companyId, table.id),
    unique('treasury_certificates_number_unique').on(table.companyId, table.certificateNumber),
  ],
);

// ---------------------------------------------------------------------------------------------
// Phase 10 banking, MFS and reconciliation. SQL migrations remain authoritative for the triggers,
// composite tenant foreign keys and append-only rules; these bindings mirror the column shape.
// ---------------------------------------------------------------------------------------------

export const bankStatements = pgTable(
  'bank_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    status: text('status').notNull().default('IMPORTED'),
    sourceFileName: text('source_file_name').notNull(),
    sourceMimeType: text('source_mime_type').notNull(),
    sourceFileHash: text('source_file_hash').notNull(),
    sourceContent: text('source_content').notNull(),
    mappingJson: jsonb('mapping_json').$type<Record<string, string>>().notNull().default({}),
    rowCount: integer('row_count').notNull().default(0),
    validCount: integer('valid_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    errorRowsJson: jsonb('error_rows_json').$type<unknown[]>().notNull().default([]),
    idempotencyKey: text('idempotency_key').notNull(),
    importedBy: uuid('imported_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_statements_company_id_unique').on(table.companyId, table.id),
    unique('bank_statements_company_account_id_unique').on(table.companyId, table.id, table.bankAccountId),
    unique('bank_statements_company_file_unique').on(table.companyId, table.bankAccountId, table.sourceFileHash),
    unique('bank_statements_company_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('bank_statements_company_account_idx').on(table.companyId, table.bankAccountId, table.importedAt),
  ],
);

export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    statementId: uuid('statement_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    lineNo: integer('line_no').notNull(),
    valueDate: date('value_date').notNull(),
    description: text('description').notNull(),
    reference: text('reference'),
    debitPoisha: bigint('debit_poisha', { mode: 'bigint' }).notNull().default(0n),
    creditPoisha: bigint('credit_poisha', { mode: 'bigint' }).notNull().default(0n),
    balancePoisha: bigint('balance_poisha', { mode: 'bigint' }),
    status: text('status').notNull().default('UNMATCHED'),
    fingerprint: text('fingerprint').notNull(),
    matchScore: integer('match_score'),
    matchReason: text('match_reason'),
    matchedJournalId: uuid('matched_journal_id'),
    exceptionOwnerId: uuid('exception_owner_id').references(() => users.id, { onDelete: 'restrict' }),
    exceptionNote: text('exception_note'),
    excludedReason: text('excluded_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_statement_lines_company_id_unique').on(table.companyId, table.id),
    unique('bank_statement_lines_statement_line_unique').on(table.companyId, table.statementId, table.lineNo),
    unique('bank_statement_lines_fingerprint_unique').on(table.companyId, table.bankAccountId, table.fingerprint),
    index('bank_statement_lines_company_account_date_idx').on(
      table.companyId,
      table.bankAccountId,
      table.valueDate,
      table.lineNo,
    ),
    index('bank_statement_lines_company_status_idx').on(table.companyId, table.bankAccountId, table.status),
  ],
);

export const bankStatementLineMatches = pgTable(
  'bank_statement_line_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    statementLineId: uuid('statement_line_id').notNull(),
    journalId: uuid('journal_id').notNull(),
    journalLineId: uuid('journal_line_id').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    matchType: text('match_type').notNull(),
    matchScore: integer('match_score').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    matchedBy: uuid('matched_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalReason: text('reversal_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_statement_line_matches_company_id_unique').on(table.companyId, table.id),
    index('bank_statement_line_matches_line_idx').on(table.companyId, table.statementLineId, table.status),
    index('bank_statement_line_matches_journal_line_idx').on(table.companyId, table.journalLineId, table.status),
  ],
);

export const bankGlRequests = pgTable(
  'bank_gl_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    statementLineId: uuid('statement_line_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    taxPoisha: bigint('tax_poisha', { mode: 'bigint' }).notNull().default(0n),
    primaryAccountId: uuid('primary_account_id').notNull(),
    taxAccountId: uuid('tax_account_id'),
    partyId: uuid('party_id'),
    reason: text('reason').notNull(),
    evidenceReference: text('evidence_reference'),
    journalId: uuid('journal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancellationReason: text('cancellation_reason'),
    reversalJournalId: uuid('reversal_journal_id'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalReason: text('reversal_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_gl_requests_company_id_unique').on(table.companyId, table.id),
    unique('bank_gl_requests_company_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('bank_gl_requests_company_status_idx').on(table.companyId, table.status, table.createdAt),
    index('bank_gl_requests_company_line_idx').on(table.companyId, table.statementLineId),
  ],
);

export const bankFeeRules = pgTable(
  'bank_fee_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    rateBps: integer('rate_bps').notNull().default(0),
    fixedPoisha: bigint('fixed_poisha', { mode: 'bigint' }).notNull().default(0n),
    feeAccountId: uuid('fee_account_id').notNull(),
    policyReference: text('policy_reference').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_fee_rules_company_id_unique').on(table.companyId, table.id),
    index('bank_fee_rules_company_account_idx').on(table.companyId, table.bankAccountId, table.effectiveFrom),
  ],
);

export const bankFeePostings = pgTable(
  'bank_fee_postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    statementLineId: uuid('statement_line_id').notNull(),
    feeRuleId: uuid('fee_rule_id'),
    feeAccountId: uuid('fee_account_id').notNull(),
    computedPoisha: bigint('computed_poisha', { mode: 'bigint' }),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    overrideReason: text('override_reason'),
    evidenceReference: text('evidence_reference'),
    basisJson: jsonb('basis_json').$type<Record<string, unknown>>().notNull().default({}),
    journalId: uuid('journal_id').notNull(),
    status: text('status').notNull().default('POSTED'),
    reversalJournalId: uuid('reversal_journal_id'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    reversalReason: text('reversal_reason'),
    idempotencyKey: text('idempotency_key').notNull(),
    postedBy: uuid('posted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_fee_postings_company_id_unique').on(table.companyId, table.id),
    unique('bank_fee_postings_line_unique').on(table.companyId, table.statementLineId),
    unique('bank_fee_postings_company_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('bank_fee_postings_company_account_idx').on(table.companyId, table.bankAccountId, table.postedAt),
  ],
);

export const bankTransfers = pgTable(
  'bank_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    transferNumber: text('transfer_number').notNull(),
    fromBankAccountId: uuid('from_bank_account_id').notNull(),
    toBankAccountId: uuid('to_bank_account_id').notNull(),
    transferDate: date('transfer_date').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    reference: text('reference').notNull(),
    narration: text('narration'),
    status: text('status').notNull().default('POSTED'),
    journalId: uuid('journal_id').notNull(),
    reversalJournalId: uuid('reversal_journal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_transfers_company_id_unique').on(table.companyId, table.id),
    unique('bank_transfers_number_unique').on(table.companyId, table.transferNumber),
    unique('bank_transfers_idempotency_unique').on(table.companyId, table.idempotencyKey),
    index('bank_transfers_company_date_idx').on(table.companyId, table.transferDate, table.createdAt),
  ],
);

export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id').notNull(),
    periodId: uuid('period_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().notNull().default({}),
    differencePoisha: bigint('difference_poisha', { mode: 'bigint' }).notNull().default(0n),
    preparedBy: uuid('prepared_by').references(() => users.id, { onDelete: 'restrict' }),
    preparedAt: timestamp('prepared_at', { withTimezone: true, mode: 'date' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewNote: text('review_note'),
    evidenceReference: text('evidence_reference'),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_reconciliations_company_id_unique').on(table.companyId, table.id),
    unique('bank_reconciliations_account_period_unique').on(table.companyId, table.bankAccountId, table.periodId),
    index('bank_reconciliations_company_period_idx').on(table.companyId, table.periodId, table.status),
  ],
);

export const closeRuns = pgTable(
  'close_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    preparedBy: uuid('prepared_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    preparedAt: timestamp('prepared_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decisionReason: text('decision_reason'),
    evidenceReference: text('evidence_reference').notNull().default(''),
    evidenceNote: text('evidence_note'),
    checklistJson: jsonb('checklist_json').$type<unknown[]>().notNull().default([]),
    exceptionsJson: jsonb('exceptions_json').$type<unknown[]>().notNull().default([]),
    snapshotHash: text('snapshot_hash'),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'restrict' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true, mode: 'date' }),
    reopenReason: text('reopen_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('close_runs_company_id_unique').on(table.companyId, table.id),
    uniqueIndex('close_runs_one_active_idx')
      .on(table.companyId, table.periodId)
      .where(sql`status IN ('DRAFT', 'SUBMITTED', 'APPROVED')`),
    index('close_runs_company_period_idx').on(table.companyId, table.periodId, table.createdAt),
  ],
);

export const closeRunEvents = pgTable(
  'close_run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('close_run_events_company_run_idx').on(table.companyId, table.runId, table.createdAt)],
);

export const suspenseResolutions = pgTable(
  'suspense_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').notNull(),
    sourceJournalId: uuid('source_journal_id').notNull(),
    sourceLineId: uuid('source_line_id').notNull(),
    suspenseAccountId: uuid('suspense_account_id').notNull(),
    amountPoisha: bigint('amount_poisha', { mode: 'bigint' }).notNull(),
    targetAccountId: uuid('target_account_id').notNull(),
    reason: text('reason').notNull(),
    attachmentReference: text('attachment_reference').notNull(),
    status: text('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decisionReason: text('decision_reason'),
    journalId: uuid('journal_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('suspense_resolutions_company_id_unique').on(table.companyId, table.id),
    uniqueIndex('suspense_resolutions_one_active_idx')
      .on(table.companyId, table.sourceLineId)
      .where(sql`status IN ('PENDING', 'APPROVED', 'POSTED')`),
    index('suspense_resolutions_company_status_idx').on(table.companyId, table.status, table.requestedAt),
    index('suspense_resolutions_company_period_idx').on(table.companyId, table.periodId, table.createdAt),
  ],
);

/**
 * Public walkthrough requests from the marketing site. Deliberately outside the organisation/company
 * scope: a lead is not a financial record. The API is write-only and never exposes these rows.
 */
export const demoRequests = pgTable(
  'demo_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company').notNull(),
    message: text('message'),
    status: text('status').notNull().default('NEW'),
    source: text('source').notNull().default('landing'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('demo_requests_created_at_idx').on(table.createdAt),
    index('demo_requests_status_created_idx').on(table.status, table.createdAt),
  ],
);

/**
 * Bangladesh Gazetted Holidays and Compliance Calendar Events (Phase 17).
 */
export const bdGazettedHolidays = pgTable(
  'bd_gazetted_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    holidayDate: date('holiday_date').notNull(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn').notNull(),
    holidayType: text('holiday_type').notNull(), // 'NATIONAL' | 'EID' | 'RELIGIOUS' | 'BANK_HOLIDAY' | 'EXECUTIVE_ORDER'
    isConfirmed: boolean('is_confirmed').notNull().default(true),
  },
  (t) => [index('bd_holidays_date_idx').on(t.holidayDate)],
);

export const complianceCalendarEvents = pgTable(
  'compliance_calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').references(() => periods.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
    titleEn: text('title_en').notNull(),
    titleBn: text('title_bn').notNull(),
    statutoryBody: text('statutory_body').notNull(), // 'NBR_VAT' | 'NBR_TAX' | 'RJSC' | 'MOLE'
    category: text('category').notNull(), // 'VAT_91' | 'VDS_DEPOSIT' | 'TDS_MONTHLY' | 'TDS_177' | 'AIT_Q' | 'ANNUAL_TAX' | 'RJSC_ANNUAL'
    statutoryDeadline: date('statutory_deadline').notNull(),
    adjustedDeadline: date('adjusted_deadline').notNull(),
    estimatedLiabilityPoisha: bigint('estimated_liability_poisha', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'PREPARED' | 'FILED' | 'OVERDUE'
    autoLockPeriodOnExpiry: boolean('auto_lock_period_on_expiry').notNull().default(false),
    filedAt: timestamp('filed_at', { withTimezone: true, mode: 'date' }),
    filingReference: text('filing_reference'),
    challanId: uuid('challan_id').references(() => treasuryChallans.id, { onDelete: 'set null' }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('comp_cal_company_deadline_idx').on(t.companyId, t.adjustedDeadline),
    unique('comp_cal_company_period_cat_uniq').on(t.companyId, t.periodId, t.category),
  ],
);

/**
 * Phase 18: Document sequences, Section 177 Withholding Tax Returns, and Deductee Lines.
 */
export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(), // 'MUSHAK_6_3' | 'MUSHAK_6_5' | 'MUSHAK_6_6' | 'MUSHAK_6_7' | 'MUSHAK_4_3' | 'CHALLAN' | 'TDS_CERTIFICATE'
    prefix: text('prefix').notNull(),
    currentValue: bigint('current_value', { mode: 'bigint' }).notNull().default(0n),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('doc_seq_company_unique').on(t.companyId, t.id),
  ],
);

export const withholdingTaxReturns = pgTable(
  'withholding_tax_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    returnType: text('return_type').notNull(), // 'MONTHLY_177' | 'HALF_YEARLY_177' | 'ANNUAL_177'
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    totalGrossPaidPoisha: bigint('total_gross_paid_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsDeductedPoisha: bigint('total_tds_deducted_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsDepositedPoisha: bigint('total_tds_deposited_poisha', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'VERIFIED' | 'SUBMITTED'
    submissionAckNumber: text('submission_ack_number'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    preparedBy: uuid('prepared_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('wht_returns_company_unique').on(t.companyId, t.id),
    unique('wht_returns_company_type_period_uniq').on(t.companyId, t.returnType, t.periodStart, t.periodEnd),
    index('wht_returns_company_period_idx').on(t.companyId, t.periodStart, t.periodEnd),
    index('wht_returns_company_status_idx').on(t.companyId, t.status),
  ],
);

export const withholdingReturnLines = pgTable(
  'withholding_return_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    returnId: uuid('return_id')
      .notNull()
      .references(() => withholdingTaxReturns.id, { onDelete: 'cascade' }),
    scheduleCode: text('schedule_code').notNull(), // 'SCHED_A_SALARY' | 'SCHED_B_GOODS' | 'SCHED_C_RENT' | 'SCHED_D_PROF'
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'restrict' }),
    sourceDocumentId: uuid('source_document_id'),
    deducteeName: text('deductee_name').notNull(),
    deducteeTin: text('deductee_tin'),
    deducteeBin: text('deductee_bin'),
    hasEtinPenaltyUpscale: boolean('has_etin_penalty_upscale').notNull().default(false),
    sectionCode: text('section_code').notNull(), // 'SEC_86' | 'SEC_89' | 'SEC_90' | 'SEC_91' | 'SEC_92' | 'SEC_109'
    economicCode: text('economic_code').notNull(), // 13-digit Bangladesh Bank code
    grossAmountPoisha: bigint('gross_amount_poisha', { mode: 'bigint' }).notNull(),
    paidAmountPoisha: bigint('paid_amount_poisha', { mode: 'bigint' }).notNull(),
    tdsRateBps: integer('tds_rate_bps').notNull(),
    tdsAmountPoisha: bigint('tds_amount_poisha', { mode: 'bigint' }).notNull(),
    paymentDate: date('payment_date').notNull(),
    challanId: uuid('challan_id').references(() => treasuryChallans.id, { onDelete: 'set null' }),
    challanNumber: text('challan_number'),
    challanDate: date('challan_date'),
    bankName: text('bank_name'),
    anomalyFlags: text('anomaly_flags'), // JSON array: ['MISSING_ETIN', 'LATE_CHALLAN_DEPOSIT', 'UNDEPOSITED_TDS']
  },
  (t) => [
    unique('wht_lines_company_unique').on(t.companyId, t.id),
    index('wht_lines_return_idx').on(t.companyId, t.returnId),
    index('wht_lines_schedule_idx').on(t.companyId, t.returnId, t.scheduleCode),
  ],
);

// 4. LABOUR ACT 2026 PAYROLL TABLES
export const payrollEmployees = pgTable(
  'payroll_employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    employeeCode: text('employee_code').notNull(),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn'),
    workerClassification: text('worker_classification').notNull(), // 'PERMANENT' | 'PROBATIONARY' | 'CONTRACTUAL' | 'PIECE_RATE' | 'APPRENTICE'
    nidNumber: text('nid_number'),
    etin: text('etin'),
    joiningDate: date('joining_date').notNull(),
    basicSalaryPoisha: bigint('basic_salary_poisha', { mode: 'bigint' }).notNull(),
    hraPoisha: bigint('hra_poisha', { mode: 'bigint' }).notNull(),
    medicalPoisha: bigint('medical_poisha', { mode: 'bigint' }).notNull(),
    conveyancePoisha: bigint('conveyance_poisha', { mode: 'bigint' }).notNull(),
    pfEnrolled: boolean('pf_enrolled').notNull().default(true),
    pfRateBps: integer('pf_rate_bps').notNull().default(1000),
    paymentChannel: text('payment_channel').notNull().default('BANK'), // 'BANK' | 'BKASH' | 'NAGAD' | 'CASH'
    bankName: text('bank_name'),
    bankAccountNumber: text('bank_account_number'),
    bankRoutingNumber: text('bank_routing_number'),
    mfsNumber: text('mfs_number'),
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE' | 'TERMINATED'
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('payroll_emp_company_unique').on(t.companyId, t.id),
    unique('payroll_emp_company_code_uniq').on(t.companyId, t.employeeCode),
    index('payroll_emp_company_status_idx').on(t.companyId, t.status),
    index('payroll_emp_company_branch_idx').on(t.companyId, t.branchId),
  ],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'restrict' }),
    batchDate: date('batch_date').notNull(),
    totalBasicPoisha: bigint('total_basic_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalGrossPoisha: bigint('total_gross_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalOtPoisha: bigint('total_ot_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalBonusPoisha: bigint('total_bonus_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalTdsPoisha: bigint('total_tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalPfEmployeePoisha: bigint('total_pf_employee_poisha', { mode: 'bigint' }).notNull().default(0n),
    totalPfEmployerPoisha: bigint('total_pf_employer_poisha', { mode: 'bigint' }).notNull().default(0n),
    netPayablePoisha: bigint('net_payable_poisha', { mode: 'bigint' }).notNull().default(0n),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'APPROVED' | 'POSTED' | 'DISBURSED'
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'restrict' }),
    postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('payroll_runs_company_unique').on(t.companyId, t.id),
    unique('payroll_runs_company_period_uniq').on(t.companyId, t.periodId),
    index('payroll_runs_company_status_idx').on(t.companyId, t.status),
  ],
);

export const payrollRunLines = pgTable(
  'payroll_run_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => payrollEmployees.id, { onDelete: 'restrict' }),
    basicPoisha: bigint('basic_poisha', { mode: 'bigint' }).notNull(),
    hraPoisha: bigint('hra_poisha', { mode: 'bigint' }).notNull(),
    medicalPoisha: bigint('medical_poisha', { mode: 'bigint' }).notNull(),
    conveyancePoisha: bigint('conveyance_poisha', { mode: 'bigint' }).notNull(),
    otHoursScaled: integer('ot_hours_scaled').notNull().default(0),
    otAmountPoisha: bigint('ot_amount_poisha', { mode: 'bigint' }).notNull().default(0n),
    festivalBonusPoisha: bigint('festival_bonus_poisha', { mode: 'bigint' }).notNull().default(0n),
    grossPayPoisha: bigint('gross_pay_poisha', { mode: 'bigint' }).notNull(),
    pfEmployeePoisha: bigint('pf_employee_poisha', { mode: 'bigint' }).notNull().default(0n),
    pfEmployerPoisha: bigint('pf_employer_poisha', { mode: 'bigint' }).notNull().default(0n),
    tdsPoisha: bigint('tds_poisha', { mode: 'bigint' }).notNull().default(0n),
    netPayPoisha: bigint('net_pay_poisha', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    unique('payroll_run_lines_company_unique').on(t.companyId, t.id),
    index('payroll_lines_run_idx').on(t.companyId, t.runId),
    index('payroll_lines_employee_idx').on(t.companyId, t.employeeId),
  ],
);



