import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { writeAuditEvent } from '../auth/audit.ts';
import { withTransaction } from '../db/transaction.ts';
import { ONBOARDING_STEPS } from './constants.ts';
import { getCompanyProfile, isCompanyProfileComplete, type CompanyProfileDto } from './companyService.ts';
import { getCompanySettings } from './settingsService.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  complete: boolean;
  detail: string;
}

export interface OnboardingDto {
  companyId: string;
  currentStep: OnboardingStepKey;
  completedAt: string | null;
  percent: number;
  canComplete: boolean;
  steps: OnboardingStep[];
}

const STEP_TITLES: Record<OnboardingStepKey, string> = {
  COMPANY: 'Company identity',
  FISCAL_YEAR: 'Fiscal year and periods',
  CHART_OF_ACCOUNTS: 'Chart of accounts',
  OPENING_BALANCES: 'Opening balances',
  BANK_ACCOUNTS: 'Banks, cash and MFS',
  SETTINGS: 'Company settings',
};

interface CountsRow {
  fiscal_years: string;
  periods: string;
  active_accounts: string;
  submitted_batches: string;
  principal_accounts: string;
}

async function loadCounts(database: Queryable, companyId: string): Promise<CountsRow> {
  const result = await database.query<CountsRow>(
    `SELECT
       (SELECT count(*) FROM fiscal_years WHERE company_id = $1)::text AS fiscal_years,
       (SELECT count(*) FROM periods WHERE company_id = $1)::text AS periods,
       (SELECT count(*) FROM accounts WHERE company_id = $1 AND is_active = true)::text AS active_accounts,
       (SELECT count(*) FROM opening_balance_batches
         WHERE company_id = $1 AND status = 'SUBMITTED' AND balanced = true)::text AS submitted_batches,
       (SELECT count(*) FROM bank_accounts
         WHERE company_id = $1 AND status = 'ACTIVE' AND is_principal = true)::text AS principal_accounts`,
    [companyId],
  );
  return result.rows[0]!;
}

function stepDetail(
  key: OnboardingStepKey,
  counts: CountsRow,
  profile: CompanyProfileDto,
  settingsComplete: boolean,
): string {
  const fiscalYears = Number(counts.fiscal_years);
  const periods = Number(counts.periods);
  const accounts = Number(counts.active_accounts);
  const batches = Number(counts.submitted_batches);
  const principals = Number(counts.principal_accounts);
  switch (key) {
    case 'COMPANY':
      return isCompanyProfileComplete(profile)
        ? 'Legal identity, contact and reporting framework are recorded.'
        : 'Complete the legal identity, registered address, contact and reporting framework.';
    case 'FISCAL_YEAR':
      return fiscalYears > 0 && periods > 0
        ? `${fiscalYears} fiscal year${fiscalYears === 1 ? '' : 's'} with ${periods} monthly periods.`
        : 'Create the fiscal year; monthly OPEN periods will be generated.';
    case 'CHART_OF_ACCOUNTS':
      return accounts >= 2
        ? `${accounts} active accounts. Control accounts are protected.`
        : 'Add or import at least two active accounts, including any control accounts you need.';
    case 'OPENING_BALANCES':
      return batches > 0
        ? 'A balanced opening-balance batch is submitted and waiting for Phase 5 ledger posting.'
        : 'Prepare and submit a balanced opening-balance batch with evidence.';
    case 'BANK_ACCOUNTS':
      return principals > 0
        ? 'A principal bank/cash/MFS account is configured with a GL mapping.'
        : 'Add at least one bank, cash or MFS account and mark it principal.';
    case 'SETTINGS':
      return settingsComplete
        ? 'Language, approval thresholds, tax configuration and numbering sequences are recorded.'
        : 'Review the company settings, tax configuration and numbering sequences.';
  }
}

export async function computeOnboarding(database: Queryable, companyId: string): Promise<OnboardingDto> {
  const profile = await getCompanyProfile(database, companyId);
  const counts = await loadCounts(database, companyId);
  const settings = await getCompanySettings(database, companyId);
  const settingsComplete =
    Boolean(settings.language) && settings.tax.vatStatus !== null && settings.numberSequences.length > 0;
  const completeness: Record<OnboardingStepKey, boolean> = {
    COMPANY: isCompanyProfileComplete(profile),
    FISCAL_YEAR: Number(counts.fiscal_years) > 0 && Number(counts.periods) > 0,
    CHART_OF_ACCOUNTS: Number(counts.active_accounts) >= 2,
    OPENING_BALANCES: Number(counts.submitted_batches) > 0,
    BANK_ACCOUNTS: Number(counts.principal_accounts) > 0,
    SETTINGS: settingsComplete,
  };
  const steps: OnboardingStep[] = ONBOARDING_STEPS.map((key) => ({
    key,
    title: STEP_TITLES[key],
    complete: completeness[key],
    detail: stepDetail(key, counts, profile, settingsComplete),
  }));
  const completedCount = steps.filter((step) => step.complete).length;
  const stored = await database.query<{ current_step: string; completed_at: Date | null }>(
    `SELECT current_step, completed_at FROM company_onboarding WHERE company_id = $1`,
    [companyId],
  );
  const storedStep = stored.rows[0]?.current_step;
  const firstIncomplete = steps.find((step) => !step.complete)?.key ?? 'SETTINGS';
  const currentStep =
    storedStep && (ONBOARDING_STEPS as readonly string[]).includes(storedStep)
      ? (storedStep as OnboardingStepKey)
      : firstIncomplete;
  return {
    companyId,
    currentStep,
    completedAt: stored.rows[0]?.completed_at?.toISOString() ?? profile.onboardingCompletedAt,
    percent: Math.round((completedCount / steps.length) * 100),
    canComplete: completedCount === steps.length,
    steps,
  };
}

export async function setOnboardingStep(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    currentStep: OnboardingStepKey;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
  },
): Promise<OnboardingDto> {
  if (!(ONBOARDING_STEPS as readonly string[]).includes(input.currentStep)) {
    throw new AppError(400, 'ONBOARDING_STEP_INVALID', 'Choose a valid onboarding step.');
  }
  return withTransaction(pool, async (client) => {
    const company = await client.query<{ organisation_id: string }>(
      `SELECT organisation_id FROM companies WHERE id = $1`,
      [input.companyId],
    );
    const organisationId = company.rows[0]?.organisation_id;
    if (!organisationId) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
    const existing = await client.query<{ current_step: string }>(
      `SELECT current_step FROM company_onboarding WHERE company_id = $1 FOR UPDATE`,
      [input.companyId],
    );
    const previousStep = existing.rows[0]?.current_step ?? null;
    await client.query(
      `INSERT INTO company_onboarding (company_id, organisation_id, current_step)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id) DO UPDATE SET current_step = EXCLUDED.current_step, updated_at = now()`,
      [input.companyId, organisationId, input.currentStep],
    );
    if (previousStep !== input.currentStep) {
      await writeAuditEvent(client, {
        organisationId: input.organisationId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: 'company.onboarding_step_saved',
        entityType: 'company_onboarding',
        entityId: input.companyId,
        before: previousStep ? { currentStep: previousStep } : null,
        after: { currentStep: input.currentStep },
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });
    }
    return computeOnboarding(client, input.companyId);
  });
}

export async function completeOnboarding(
  pool: Pool,
  input: {
    organisationId: string;
    companyId: string;
    actorUserId: string;
    sessionId: string;
    ip: string;
    userAgent: string | null;
    requestId: string;
  },
): Promise<OnboardingDto> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`onboarding:${input.companyId}`]);
    const onboarding = await computeOnboarding(client, input.companyId);
    if (onboarding.completedAt) return onboarding;
    if (!onboarding.canComplete) {
      throw new AppError(
        409,
        'ONBOARDING_INCOMPLETE',
        'The company setup cannot be completed until every step is valid.',
        {
          steps: onboarding.steps
            .filter((step) => !step.complete)
            .map((step) => ({
              key: step.key,
              detail: step.detail,
            })),
        },
      );
    }
    await client.query(
      `INSERT INTO company_onboarding (company_id, organisation_id, current_step, completed_at)
       VALUES ($1, $2, 'SETTINGS', now())
       ON CONFLICT (company_id) DO UPDATE
         SET completed_at = now(), current_step = 'SETTINGS', updated_at = now()`,
      [input.companyId, input.organisationId],
    );
    await writeAuditEvent(client, {
      organisationId: input.organisationId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      action: 'company.onboarding_completed',
      entityType: 'company',
      entityId: input.companyId,
      after: {
        completedSteps: onboarding.steps.map((step) => step.key),
        openingBalancePosting: 'DEFERRED_TO_PHASE_5',
      },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    return computeOnboarding(client, input.companyId);
  });
}
