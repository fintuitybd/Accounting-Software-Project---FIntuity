import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { createLogger } from '../../src/logger.ts';
import { migrateUp } from '../../src/migrations/runner.ts';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '../helpers/testDatabase.ts';
import {
  authHeaders,
  authed,
  login,
  seedCompany,
  seedCompanyMembership,
  seedMembership,
  seedOrganisation,
  seedUser,
  testConfig,
  type AppInstance,
  type AuthCookies,
} from '../helpers/identity.ts';
import { getWebhookSecret } from '../../src/banking/mfsWebhookService.ts';

const databaseAvailable = Boolean(testDatabaseUrl());

const COMPANY_PROFILE = {
  entityType: 'PRIVATE_LIMITED',
  industry: 'TRADING_DISTRIBUTION',
  tin: '123456789012',
  bin: '123456789-0101',
  rjscNo: 'C-998877/2026',
  address: 'Gulshan 2, Dhaka 1212',
  phone: '+8801711000000',
  email: 'mfs-finance@example.test',
  reportingFramework: 'IFRS_FOR_SMES_BFRS',
};

const ACCOUNTS = [
  {
    key: 'mfsWallet',
    code: '1120',
    nameEn: 'Cash at MFS - bKash/Nagad Merchant Wallet',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'BANK_MFS',
  },
  {
    key: 'ar',
    code: '1210',
    nameEn: 'Trade Accounts Receivable',
    accountType: 'ASSET',
    subCategory: 'CURRENT_ASSET',
    controlSubledger: 'AR',
  },
  {
    key: 'mdrFee',
    code: '5190',
    nameEn: 'MFS & Payment Gateway MDR Charges',
    accountType: 'EXPENSE',
    subCategory: 'OPERATING_EXPENSE',
    controlSubledger: 'NONE',
  },
  {
    key: 'revenue',
    code: '4100',
    nameEn: 'Sales Revenue',
    accountType: 'REVENUE',
    subCategory: 'OPERATING_REVENUE',
    controlSubledger: 'NONE',
  },
  {
    key: 'vat',
    code: '2120',
    nameEn: 'Output VAT Payable',
    accountType: 'LIABILITY',
    subCategory: 'CURRENT_LIABILITY',
    controlSubledger: 'NONE',
  },
] as const;

interface Fixture {
  organisationId: string;
  companyId: string;
  ownerCookies: AuthCookies;
  accountantCookies: AuthCookies;
  partyId: string;
  branchId: string;
  accounts: Record<string, { id: string; code: string }>;
  mfsBankAccountId: string;
}

describe.skipIf(!databaseAvailable)('Phase 22: MFS Webhooks & PGW Settlement Reconciliation', () => {
  let database: TestDatabase;
  let app: AppInstance;
  let fixture: Fixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateUp({ pool: database.pool, nodeEnv: 'test' });
    const config = testConfig(database.url, { AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000' });
    app = await buildApp({ config, pool: database.pool, logger: createLogger(config) });
    fixture = await createFixture();
  });

  afterAll(async () => {
    await app?.close();
    await database?.cleanup();
  });

  function signPayload(payload: string | object, secret: string): string {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return createHmac('sha256', secret).update(raw).digest('hex');
  }

  async function createFixture(): Promise<Fixture> {
    const suffix = `MFS-${randomUUID().slice(0, 6)}`;
    const organisationId = await seedOrganisation(database.pool, `Org ${suffix}`);
    const ownerEmail = `owner-${suffix}@example.test`;
    const accountantEmail = `acc-${suffix}@example.test`;

    const ownerId = await seedUser(database.pool, { email: ownerEmail, name: `Owner ${suffix}` });
    const accountantId = await seedUser(database.pool, { email: accountantEmail, name: `Accountant ${suffix}` });

    await seedMembership(database.pool, organisationId, ownerId, 'OWNER');
    const accountantMembership = await seedMembership(database.pool, organisationId, accountantId, 'ACCOUNTANT');

    const ownerCookies = (await login(app, ownerEmail)).cookies;
    const accountantCookies = (await login(app, accountantEmail)).cookies;

    const companyRes = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/organisations/${organisationId}/companies`,
      { legalName: `Company ${suffix}`, ...COMPANY_PROFILE },
    );
    expect(companyRes.statusCode, companyRes.body).toBe(201);
    const companyId = companyRes.json().company.id as string;

    await seedCompanyMembership(database.pool, organisationId, companyId, accountantMembership);

    const fiscalRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/fiscal-years`, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(fiscalRes.statusCode, fiscalRes.body).toBe(201);

    const accounts: Record<string, { id: string; code: string }> = {};
    for (const acc of ACCOUNTS) {
      const res = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/accounts`, {
        code: acc.code,
        nameEn: acc.nameEn,
        accountType: acc.accountType,
        subCategory: acc.subCategory,
        ifrsCategory: 'OPERATING',
        controlSubledger: acc.controlSubledger,
        isActive: true,
      });
      expect(res.statusCode, res.body).toBe(201);
      accounts[acc.key] = { id: res.json().account.id, code: res.json().account.code };
    }

    const branchRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/branches`, {
      code: 'MAIN',
      nameEn: 'Main Branch',
      isPrincipal: true,
    });
    expect(branchRes.statusCode, branchRes.body).toBe(201);
    const branchId = branchRes.json().branch.id as string;

    const partyRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/parties`, {
      code: `CUST-${suffix}`,
      nameEn: `Customer ${suffix}`,
      type: 'CUSTOMER',
      creditDays: 30,
      creditLimit: '1000000.00',
    });
    expect(partyRes.statusCode, partyRes.body).toBe(201);
    const partyId = partyRes.json().party.id as string;

    const mfsBankRes = await authed(app, ownerCookies, 'POST', `/api/v1/companies/${companyId}/bank-accounts`, {
      name: 'bKash Merchant Wallet',
      kind: 'MFS',
      provider: 'BKASH',
      maskedNumber: '•••• 1234',
      glAccountId: accounts.mfsWallet!.id,
      openingBalance: '0.00',
      isPrincipal: false,
    });
    expect(mfsBankRes.statusCode, mfsBankRes.body).toBe(201);
    const mfsBankAccountId = mfsBankRes.json().bankAccount.id as string;

    const taxApproval = await authed(
      app,
      ownerCookies,
      'POST',
      `/api/v1/companies/${companyId}/sales/tax-policy/approval`,
      {
        reviewerName: 'External Tax Counsel',
        reviewerQualification: 'FCA, Bangladesh tax practice',
        sourceReference: 'Engagement letter TAX-2026-07 and reviewed pack bd-2026-v1',
        reviewedAt: '2026-11-02',
        outputVatAccountId: accounts.vat!.id,
        rulePackVersion: 'bd-2026-v1',
      },
    );
    expect(taxApproval.statusCode, taxApproval.body).toBe(200);

    return {
      organisationId,
      companyId,
      ownerCookies,
      accountantCookies,
      partyId,
      branchId,
      accounts,
      mfsBankAccountId,
    };
  }

  async function createPostedInvoice(grossAmount: string): Promise<string> {
    const draftRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/sales/documents`,
      headers: {
        ...authHeaders(fixture.accountantCookies),
        'idempotency-key': randomUUID(),
      },
      payload: {
        docType: 'SALES_INVOICE',
        partyId: fixture.partyId,
        branchId: fixture.branchId,
        docDate: '2026-11-01',
        paymentTermsDays: 30,
        currency: 'BDT',
        narrationEn: 'Invoice for MFS settlement testing',
        lines: [
          {
            lineNo: 1,
            descriptionEn: 'IT Consulting Services',
            quantity: '1',
            unit: 'job',
            unitPrice: grossAmount,
            discount: '0.00',
            taxCategory: 'EXEMPT',
            revenueAccountId: fixture.accounts.revenue!.id,
          },
        ],
      },
    });
    expect(draftRes.statusCode, draftRes.body).toBe(201);
    const invoiceId = draftRes.json().document.id as string;

    let postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceId}/post`,
      headers: {
        ...authHeaders(fixture.accountantCookies),
        'idempotency-key': randomUUID(),
      },
    });

    if (postRes.statusCode === 409 && postRes.json().code === 'SALES_DOCUMENT_APPROVAL_REQUIRED') {
      const approveRes = await authed(
        app,
        fixture.ownerCookies,
        'POST',
        `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceId}/approve`,
        { reason: 'Approved invoice for MFS webhook settlement test' },
      );
      expect(approveRes.statusCode, approveRes.body).toBe(200);

      postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${fixture.companyId}/sales/documents/${invoiceId}/post`,
        headers: {
          ...authHeaders(fixture.accountantCookies),
          'idempotency-key': randomUUID(),
        },
      });
    }

    expect(postRes.statusCode, postRes.body).toBe(200);
    return invoiceId;
  }

  it('rejects webhooks with missing or invalid HMAC-SHA256 signatures with 401 INVALID_WEBHOOK_SIGNATURE', async () => {
    const secret = getWebhookSecret('BKASH');
    const payload = {
      externalTrxId: `TRX-${randomUUID().slice(0, 8)}`,
      amount: '1500.00',
      mdrFeeBps: 150,
    };

    // 1. Missing signature
    const missingRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/bkash`,
      payload,
    });
    expect(missingRes.statusCode).toBe(401);
    expect(missingRes.json().code).toBe('INVALID_WEBHOOK_SIGNATURE');

    // 2. Invalid signature
    const invalidRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/bkash`,
      headers: {
        'x-bkash-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload,
    });
    expect(invalidRes.statusCode).toBe(401);
    expect(invalidRes.json().code).toBe('INVALID_WEBHOOK_SIGNATURE');

    // 3. Nagad signature mismatch
    const nagadPayload = {
      paymentRefId: `NAGAD-${randomUUID().slice(0, 8)}`,
      amount: '2000.00',
      mdrFeeBps: 150,
    };
    const nagadBadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/nagad`,
      headers: {
        'x-nagad-signature': 'invalid_nagad_sig',
      },
      payload: nagadPayload,
    });
    expect(nagadBadRes.statusCode).toBe(401);
    expect(nagadBadRes.json().code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('processes valid bKash webhook with exact MDR fee split (150 bps) and 3-line GL posting', async () => {
    const invoiceId = await createPostedInvoice('10000.00'); // 10,000.00 BDT = 1,000,000 poisha
    const secret = getWebhookSecret('BKASH');
    const trxId = `BKASH-${randomUUID().slice(0, 8)}`;
    const payload = {
      externalTrxId: trxId,
      invoiceId,
      amount: '10000.00',
      mdrFeeBps: 150, // 1.50%
      valueDate: '2026-11-02',
    };
    const signature = signPayload(payload, secret);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/bkash`,
      headers: {
        'x-bkash-signature': signature,
      },
      payload,
    });

    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.replayed).toBe(false);

    // Verify mathematical invariant:
    // gross: 1000000n poisha (10,000.00 BDT)
    // mdr: (1000000n * 150n) / 10000n = 15000n poisha (150.00 BDT)
    // net: 1000000n - 15000n = 985000n poisha (9,850.00 BDT)
    expect(body.event.grossAmountPoisha).toBe('1000000');
    expect(body.event.grossAmountBdt).toBe('10000.00');
    expect(body.event.mdrFeePoisha).toBe('15000');
    expect(body.event.mdrFeeBdt).toBe('150.00');
    expect(body.event.netSettledPoisha).toBe('985000');
    expect(body.event.netSettledBdt).toBe('9850.00');
    expect(body.event.signatureVerified).toBe(true);
    expect(body.journalId).toBeDefined();

    // Verify balanced 3-line GL journal in the database
    const journalRes = await database.pool.query<{
      account_code: string;
      debit_poisha: string;
      credit_poisha: string;
    }>(
      `SELECT a.code AS account_code, jl.debit_poisha::text, jl.credit_poisha::text
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.company_id = $1 AND jl.journal_id = $2
        ORDER BY jl.line_no`,
      [fixture.companyId, body.journalId],
    );

    expect(journalRes.rows).toHaveLength(3);
    const lines = journalRes.rows;

    // Line 1: DR 1120 (MFS Wallet) 985,000 poisha
    expect(lines[0]!.account_code).toBe('1120');
    expect(lines[0]!.debit_poisha).toBe('985000');
    expect(lines[0]!.credit_poisha).toBe('0');

    // Line 2: DR 5190 (MFS MDR Charges) 15,000 poisha
    expect(lines[1]!.account_code).toBe('5190');
    expect(lines[1]!.debit_poisha).toBe('15000');
    expect(lines[1]!.credit_poisha).toBe('0');

    // Line 3: CR 1210 (Accounts Receivable) 1,000,000 poisha
    expect(lines[2]!.account_code).toBe('1210');
    expect(lines[2]!.debit_poisha).toBe('0');
    expect(lines[2]!.credit_poisha).toBe('1000000');

    // Verify open AR balance on the settled invoice is 0
    const openRes = await database.pool.query<{ outstanding_poisha: string }>(
      `SELECT outstanding_poisha::text FROM sales_ar_open_items WHERE company_id = $1 AND document_id = $2`,
      [fixture.companyId, invoiceId],
    );
    expect(openRes.rows[0]?.outstanding_poisha).toBe('0');

    // Verify auto-created matched bank statement line
    const bankLineRes = await database.pool.query<{
      debit_poisha: string;
      credit_poisha: string;
      status: string;
      matched_journal_id: string;
      match_score: number;
    }>(
      `SELECT debit_poisha::text, credit_poisha::text, status, matched_journal_id, match_score
         FROM bank_statement_lines
        WHERE company_id = $1 AND matched_journal_id = $2`,
      [fixture.companyId, body.journalId],
    );
    expect(bankLineRes.rows).toHaveLength(1);
    expect(bankLineRes.rows[0]!.debit_poisha).toBe('985000');
    expect(bankLineRes.rows[0]!.credit_poisha).toBe('0');
    expect(bankLineRes.rows[0]!.status).toBe('MATCHED');
    expect(bankLineRes.rows[0]!.match_score).toBe(100);
  });

  it('enforces idempotency on duplicate webhook events without double-posting', async () => {
    const invoiceId = await createPostedInvoice('5000.00');
    const secret = getWebhookSecret('BKASH');
    const trxId = `IDEM-${randomUUID().slice(0, 8)}`;
    const payload = {
      externalTrxId: trxId,
      invoiceId,
      amount: '5000.00',
      mdrFeeBps: 185, // 1.85%
    };
    const signature = signPayload(payload, secret);

    // First attempt: 201 Created
    const firstRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/bkash`,
      headers: { 'x-bkash-signature': signature },
      payload,
    });
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.json().replayed).toBe(false);
    const journalId = firstRes.json().journalId;

    // Second duplicate attempt: 200 OK with replayed: true
    const secondRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/bkash`,
      headers: { 'x-bkash-signature': signature },
      payload,
    });
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.json().replayed).toBe(true);
    expect(secondRes.json().journalId).toBe(journalId);

    // Verify only ONE event row exists
    const eventCount = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM mfs_webhook_events WHERE company_id = $1 AND external_trx_id = $2`,
      [fixture.companyId, trxId],
    );
    expect(eventCount.rows[0]!.count).toBe('1');
  });

  it('processes valid Nagad merchant collection with x-nagad-signature', async () => {
    const invoiceId = await createPostedInvoice('2500.00');
    const secret = getWebhookSecret('NAGAD');
    const trxId = `NAGAD-${randomUUID().slice(0, 8)}`;
    const payload = {
      paymentRefId: trxId,
      invoiceId,
      amount: '2500.00',
      mdrFeeBps: 150,
    };
    const signature = signPayload(payload, secret);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks/nagad`,
      headers: { 'x-nagad-signature': signature },
      payload,
    });

    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.event.provider).toBe('NAGAD');
    expect(body.event.grossAmountBdt).toBe('2500.00');
    // 250000 * 150 / 10000 = 3750 poisha (37.50 BDT)
    expect(body.event.mdrFeeBdt).toBe('37.50');
    expect(body.event.netSettledBdt).toBe('2462.50');
  });

  it('performs SSLCommerz and AamarPay batch settlement reconciliation', async () => {
    const inv1 = await createPostedInvoice('3000.00');
    const inv2 = await createPostedInvoice('7000.00');

    const batchPayload = {
      provider: 'SSLCOMMERZ' as const,
      batchReference: `BATCH-${randomUUID().slice(0, 6)}`,
      settlementDate: '2026-11-03',
      transactions: [
        {
          externalTrxId: `SSL-TRX-1-${randomUUID().slice(0, 6)}`,
          invoiceId: inv1,
          amount: '3000.00',
          mdrFeeBps: 250, // 2.50%
        },
        {
          externalTrxId: `SSL-TRX-2-${randomUUID().slice(0, 6)}`,
          invoiceId: inv2,
          amount: '7000.00',
          mdrFeeBps: 250,
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/settlements/reconcile`,
      headers: authHeaders(fixture.accountantCookies),
      payload: batchPayload,
    });

    expect(res.statusCode, res.body).toBe(200);
    const result = res.json().result;
    expect(result.totalTransactions).toBe(2);
    expect(result.reconciledCount).toBe(2);
    expect(result.replayedCount).toBe(0);
    expect(result.totalGrossBdt).toBe('10000.00');
    // 10,000.00 * 2.5% = 250.00 BDT MDR
    expect(result.totalMdrFeeBdt).toBe('250.00');
    expect(result.totalNetSettledBdt).toBe('9750.00');

    // Replay the batch and verify replayedCount is 2
    const replayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/settlements/reconcile`,
      headers: authHeaders(fixture.accountantCookies),
      payload: batchPayload,
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().result.replayedCount).toBe(2);
  });

  it('lists recorded MFS and PGW webhook events via GET endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${fixture.companyId}/banking/mfs/webhooks`,
      headers: authHeaders(fixture.accountantCookies),
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.events.length).toBeGreaterThanOrEqual(4);
    expect(body.total).toBeGreaterThanOrEqual(4);

    const first = body.events[0];
    expect(first.id).toBeDefined();
    expect(first.grossAmountBdt).toBeDefined();
    expect(first.mdrFeeBdt).toBeDefined();
    expect(first.netSettledBdt).toBeDefined();
  });
});
