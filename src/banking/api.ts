import { apiRequest } from '../auth/api';

export type BankLineStatus = 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CATEGORIZED' | 'EXCLUDED';
export type BankMatchType = 'EXACT' | 'PARTIAL' | 'MANUAL' | 'SPLIT';
export type BankGlRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REVERSED';
export type BankStatementStatus = 'IMPORTED' | 'PARTIAL' | 'REJECTED';
export type BankReconciliationStatus = 'DRAFT' | 'PREPARED' | 'REVIEWED' | 'LOCKED';

export interface BankStatementLine {
  id: string;
  companyId: string;
  statementId: string | null;
  bankAccountId: string;
  lineNo: number;
  valueDate: string;
  description: string;
  reference: string | null;
  debitPoisha: string;
  creditPoisha: string;
  debitBdt: string;
  creditBdt: string;
  balancePoisha: string | null;
  balanceBdt: string | null;
  status: BankLineStatus;
  fingerprint: string;
  matchScore: number | null;
  matchReason: string | null;
  matchedJournalId: string | null;
  exceptionOwnerId: string | null;
  exceptionOwnerName: string | null;
  exceptionNote: string | null;
  excludedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankStatementMatch {
  id: string;
  statementLineId: string;
  journalId: string;
  journalLineId: string;
  journalNumber: string | null;
  journalSourceModule: string;
  journalSourceDocRef: string | null;
  amountPoisha: string;
  amountBdt: string;
  matchType: BankMatchType;
  matchScore: number;
  reason: string;
  status: 'ACTIVE' | 'REVERSED';
  matchedBy: string;
  matchedByName: string;
  matchedAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

export interface BankStatement {
  id: string;
  companyId: string;
  bankAccountId: string;
  status: BankStatementStatus;
  sourceFileName: string;
  sourceMimeType: string;
  sourceFileHash: string;
  mapping: Record<string, string>;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  errorRows: Array<{ rowNumber: number; code: string; field: string; message: string }>;
  idempotencyKeyUsed: boolean;
  importedBy: string;
  importedByName: string;
  importedAt: string;
}

export interface BankStatementPreviewRow {
  rowNumber: number;
  values: Record<string, string>;
  date: string | null;
  description: string | null;
  reference: string | null;
  debitPoisha: string | null;
  creditPoisha: string | null;
  balancePoisha: string | null;
  errors: Array<{ rowNumber: number; code: string; field: string; message: string }>;
}

export interface BankStatementPreview {
  headers: string[];
  detectedMapping: Partial<Record<'date' | 'description' | 'reference' | 'debit' | 'credit' | 'balance', string>>;
  mapping: Record<'date' | 'description' | 'reference' | 'debit' | 'credit' | 'balance', string>;
  rows: BankStatementPreviewRow[];
  truncated: boolean;
  limits: { maxRows: number; maxBytes: number; previewRows: number };
  summary: { rowCount: number; validCount: number; errorCount: number; duplicateCount: number };
}

export interface MatchCandidate {
  journalId: string;
  journalLineId: string;
  journalNumber: string | null;
  postingDate: string;
  sourceModule: string;
  sourceDocRef: string | null;
  narration: string;
  partyName: string | null;
  amountPoisha: string;
  amountBdt: string;
  allocatedPoisha: string;
  availablePoisha: string;
  availableBdt: string;
  dateDifferenceDays: number;
  score: number;
  reason: string;
  suggestedType: BankMatchType;
  usesOtherStatementLines: boolean;
}

export interface BankGlRequest {
  id: string;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  statementLineId: string;
  status: BankGlRequestStatus;
  amountPoisha: string;
  amountBdt: string;
  taxPoisha: string;
  taxBdt: string;
  primaryAccountId: string;
  primaryAccountCode: string;
  primaryAccountName: string;
  taxAccountId: string | null;
  taxAccountCode: string | null;
  taxAccountName: string | null;
  partyId: string | null;
  partyName: string | null;
  reason: string;
  evidenceReference: string | null;
  journalId: string | null;
  journalNumber: string | null;
  journalStatus: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export interface BankFeeRule {
  id: string;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  provider: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  rateBps: number;
  fixedPoisha: string;
  fixedBdt: string;
  feeAccountId: string;
  feeAccountCode: string;
  feeAccountName: string;
  policyReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankFeePosting {
  id: string;
  companyId: string;
  bankAccountId: string;
  statementLineId: string;
  feeRuleId: string | null;
  feeAccountId: string;
  feeAccountCode: string;
  feeAccountName: string;
  computedPoisha: string | null;
  computedBdt: string | null;
  amountPoisha: string;
  amountBdt: string;
  overrideReason: string | null;
  evidenceReference: string | null;
  journalId: string;
  journalNumber: string | null;
  status: 'POSTED' | 'REVERSED';
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  postedBy: string;
  postedByName: string;
  postedAt: string;
}

export interface BankTransfer {
  id: string;
  companyId: string;
  transferNumber: string;
  fromBankAccountId: string;
  fromBankAccountName: string;
  fromGlAccountCode: string;
  toBankAccountId: string;
  toBankAccountName: string;
  toGlAccountCode: string;
  transferDate: string;
  amountPoisha: string;
  amountBdt: string;
  reference: string;
  narration: string | null;
  status: 'POSTED' | 'REVERSED';
  journalId: string;
  journalNumber: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
}

export interface BankReconciliationBlocker {
  code: string;
  message: string;
}

export interface BankReconciliationProof {
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  glAccountCode: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStatus: string;
  periodStart: string;
  periodEnd: string;
  statement: {
    statementCount: number;
    lineCount: number;
    matchedCount: number;
    partialCount: number;
    unmatchedCount: number;
    categorizedCount: number;
    excludedCount: number;
    debitPoisha: string;
    creditPoisha: string;
    movementPoisha: string;
    movementBdt: string;
    closingBalancePoisha: string | null;
    closingBalanceBdt: string | null;
    firstDate: string | null;
    lastDate: string | null;
  };
  gl: {
    debitPoisha: string;
    creditPoisha: string;
    movementPoisha: string;
    movementBdt: string;
    closingBalancePoisha: string;
    closingBalanceBdt: string;
  };
  differenceBasis: 'STATEMENT_CLOSING_BALANCE' | 'PERIOD_MOVEMENT';
  differencePoisha: string;
  differenceBdt: string;
  blockers: BankReconciliationBlocker[];
  warnings: string[];
}

export interface BankReconciliation {
  id: string | null;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  glAccountCode: string;
  periodId: string;
  periodCode: string;
  periodLabel: string;
  periodStatus: string;
  status: BankReconciliationStatus;
  differencePoisha: string;
  differenceBdt: string;
  preparedBy: string | null;
  preparedByName: string | null;
  preparedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  evidenceReference: string | null;
  lockedAt: string | null;
  proof: BankReconciliationProof;
  canReview: boolean;
}

function queryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const bankingApi = {
  statements: (
    companyId: string,
    bankAccountId: string,
    query: { limit?: number; offset?: number } = {},
  ) =>
    apiRequest<{ entries: BankStatement[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/statements${queryString(query)}`,
    ),
  statement: (companyId: string, bankAccountId: string, statementId: string) =>
    apiRequest<{ statement: BankStatement }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/statements/${statementId}`,
    ),
  preview: (
    companyId: string,
    bankAccountId: string,
    input: { content: string; mapping?: Record<string, string | null | undefined> },
  ) =>
    apiRequest<{ preview: BankStatementPreview }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/statements/preview`,
      { method: 'POST', body: input },
    ),
  import: (
    companyId: string,
    bankAccountId: string,
    input: {
      content: string;
      sourceFileName: string;
      sourceMimeType: string;
      mapping?: Record<string, string | null | undefined>;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ statement: BankStatement; replayed: boolean }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/statements/import`,
      { method: 'POST', body: input, headers: { 'idempotency-key': idempotencyKey } },
    ),
  lines: (
    companyId: string,
    bankAccountId: string,
    query: {
      status?: BankLineStatus;
      from?: string;
      to?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: BankStatementLine[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/bank-lines${queryString(query)}`,
    ),
  line: (companyId: string, lineId: string) =>
    apiRequest<{ line: BankStatementLine; matches: BankStatementMatch[]; glRequests: BankGlRequest[] }>(
      `/companies/${companyId}/bank-lines/${lineId}`,
    ),
  candidates: (companyId: string, lineId: string, query: { windowDays?: number; limit?: number } = {}) =>
    apiRequest<{ line: BankStatementLine; remainingPoisha: string; candidates: MatchCandidate[] }>(
      `/companies/${companyId}/bank-lines/${lineId}/candidates${queryString(query)}`,
    ),
  match: (
    companyId: string,
    lineId: string,
    input: {
      allocations: Array<{ journalId: string; journalLineId: string; amount: string }>;
      matchType?: BankMatchType;
      reason: string;
    },
  ) =>
    apiRequest<{ line: BankStatementLine; matches: BankStatementMatch[] }>(
      `/companies/${companyId}/bank-lines/${lineId}/match`,
      { method: 'POST', body: input },
    ),
  unmatch: (companyId: string, lineId: string, reason: string) =>
    apiRequest<{ line: BankStatementLine; matches: BankStatementMatch[] }>(
      `/companies/${companyId}/bank-lines/${lineId}/unmatch`,
      { method: 'POST', body: { reason } },
    ),
  exclude: (companyId: string, lineId: string, reason: string) =>
    apiRequest<{ line: BankStatementLine }>(`/companies/${companyId}/bank-lines/${lineId}/exclude`, {
      method: 'POST',
      body: { reason },
    }),
  assignException: (companyId: string, lineId: string, ownerUserId: string, note: string) =>
    apiRequest<{ line: BankStatementLine }>(
      `/companies/${companyId}/bank-lines/${lineId}/assign-exception`,
      { method: 'POST', body: { ownerUserId, note } },
    ),
  createGl: (
    companyId: string,
    lineId: string,
    input: {
      amount: string;
      primaryAccountId: string;
      taxPoisha?: string;
      taxAccountId?: string | null;
      partyId?: string | null;
      reason: string;
      evidenceReference?: string | null;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ request: BankGlRequest; replayed: boolean }>(
      `/companies/${companyId}/bank-lines/${lineId}/create-gl`,
      { method: 'POST', body: input, headers: { 'idempotency-key': idempotencyKey } },
    ),
  glRequests: (
    companyId: string,
    query: {
      status?: BankGlRequestStatus;
      bankAccountId?: string;
      statementLineId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: BankGlRequest[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/bank-gl-requests${queryString(query)}`,
    ),
  glRequest: (companyId: string, requestId: string) =>
    apiRequest<{ request: BankGlRequest }>(`/companies/${companyId}/bank-gl-requests/${requestId}`),
  submitGl: (companyId: string, requestId: string) =>
    apiRequest<{ request: BankGlRequest }>(
      `/companies/${companyId}/bank-gl-requests/${requestId}/submit`,
      { method: 'POST' },
    ),
  approveGl: (companyId: string, requestId: string) =>
    apiRequest<{ request: BankGlRequest; journalId: string }>(
      `/companies/${companyId}/bank-gl-requests/${requestId}/approve`,
      { method: 'POST' },
    ),
  cancelGl: (companyId: string, requestId: string, reason: string) =>
    apiRequest<{ request: BankGlRequest }>(
      `/companies/${companyId}/bank-gl-requests/${requestId}/cancel`,
      { method: 'POST', body: { reason } },
    ),
  rejectGl: (companyId: string, requestId: string, reason: string) =>
    apiRequest<{ request: BankGlRequest }>(
      `/companies/${companyId}/bank-gl-requests/${requestId}/reject`,
      { method: 'POST', body: { reason } },
    ),
  feeRules: (
    companyId: string,
    query: { bankAccountId?: string; includeInactive?: boolean } = {},
  ) =>
    apiRequest<{ rules: BankFeeRule[] }>(
      `/companies/${companyId}/bank-fee-rules${queryString(query)}`,
    ),
  createFeeRule: (
    companyId: string,
    input: {
      bankAccountId: string;
      rateBps: number;
      fixedPoisha: string;
      feeAccountId: string;
      policyReference: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) =>
    apiRequest<{ rule: BankFeeRule }>(`/companies/${companyId}/bank-fee-rules`, {
      method: 'POST',
      body: input,
    }),
  setFeeRuleStatus: (companyId: string, ruleId: string, status: 'ACTIVE' | 'INACTIVE') =>
    apiRequest<{ rule: BankFeeRule }>(`/companies/${companyId}/bank-fee-rules/${ruleId}`, {
      method: 'PATCH',
      body: { status },
    }),
  feePostings: (companyId: string, query: { bankAccountId?: string; limit?: number } = {}) =>
    apiRequest<{ postings: BankFeePosting[] }>(
      `/companies/${companyId}/bank-fee-postings${queryString(query)}`,
    ),
  feeForLine: (companyId: string, lineId: string) =>
    apiRequest<{ posting: BankFeePosting | null }>(`/companies/${companyId}/bank-lines/${lineId}/fee`),
  postFee: (
    companyId: string,
    lineId: string,
    input: {
      overrideAmount?: string;
      overrideReason?: string | null;
      evidenceReference?: string | null;
      feeAccountId?: string | null;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ posting: BankFeePosting; replayed: boolean }>(
      `/companies/${companyId}/bank-lines/${lineId}/fee`,
      { method: 'POST', body: input, headers: { 'idempotency-key': idempotencyKey } },
    ),
  transfers: (
    companyId: string,
    query: {
      bankAccountId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: BankTransfer[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/bank-transfers${queryString(query)}`,
    ),
  transfer: (companyId: string, transferId: string) =>
    apiRequest<{ transfer: BankTransfer }>(`/companies/${companyId}/bank-transfers/${transferId}`),
  createTransfer: (
    companyId: string,
    input: {
      fromBankAccountId: string;
      toBankAccountId: string;
      transferDate: string;
      amount: string;
      reference: string;
      narration?: string | null;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ transfer: BankTransfer; replayed: boolean }>(
      `/companies/${companyId}/bank-transfers`,
      { method: 'POST', body: input, headers: { 'idempotency-key': idempotencyKey } },
    ),
  reverseTransfer: (companyId: string, transferId: string, date: string, reason: string) =>
    apiRequest<{ transfer: BankTransfer }>(
      `/companies/${companyId}/bank-transfers/${transferId}/reverse`,
      { method: 'POST', body: { date, reason } },
    ),
  reconciliation: (companyId: string, bankAccountId: string, periodId: string) =>
    apiRequest<{ reconciliation: BankReconciliation }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/reconciliation?periodId=${periodId}`,
    ),
  reconciliations: (companyId: string, bankAccountId: string) =>
    apiRequest<{ reconciliations: BankReconciliation[] }>(
      `/companies/${companyId}/bank-accounts/${bankAccountId}/reconciliations`,
    ),
  prepareReconciliation: (companyId: string, bankAccountId: string, periodId: string) =>
    apiRequest<{ reconciliation: BankReconciliation }>(
      `/companies/${companyId}/bank-reconciliations/prepare`,
      { method: 'POST', body: { bankAccountId, periodId } },
    ),
  reviewReconciliation: (
    companyId: string,
    reconciliationId: string,
    input: { note?: string | null; evidenceReference?: string | null },
  ) =>
    apiRequest<{ reconciliation: BankReconciliation }>(
      `/companies/${companyId}/bank-reconciliations/${reconciliationId}/review`,
      { method: 'POST', body: input },
    ),
  report: (companyId: string, reconciliationId: string) =>
    apiRequest<{ filename: string; content: string }>(
      `/companies/${companyId}/bank-reconciliations/${reconciliationId}/report`,
    ),
  mfsWebhooks: (
    companyId: string,
    query: {
      provider?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ events: MfsWebhookEvent[]; total: number }>(
      `/companies/${companyId}/mfs/webhooks${queryString(query)}`,
    ),
  reconcilePgwBatch: (
    companyId: string,
    input: {
      provider: 'SSLCOMMERZ' | 'AAMARPAY';
      batchReference: string;
      settlementDate: string;
      transactions: Array<{
        externalTrxId: string;
        invoiceId?: string | null;
        grossAmountPoisha?: string | number;
        amount?: string | number;
        mdrFeeBps?: number;
        valueDate?: string;
      }>;
    },
  ) =>
    apiRequest<{ success: boolean; result: PgwBatchReconciliationResult }>(
      `/companies/${companyId}/mfs/settlements/reconcile`,
      { method: 'POST', body: input },
    ),
  simulateMfsWebhook: (
    companyId: string,
    provider: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    apiRequest<{ success: boolean; event: MfsWebhookEvent; replayed: boolean; journalId?: string }>(
      `/companies/${companyId}/mfs/webhooks/${provider}`,
      { method: 'POST', body: payload, headers },
    ),
};

export interface MfsWebhookEvent {
  id: string;
  companyId: string;
  provider: 'BKASH' | 'NAGAD' | 'SSLCOMMERZ' | 'AAMARPAY';
  externalTrxId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  grossAmountPoisha: string;
  grossAmountBdt: string;
  mdrFeeBps: number;
  mdrFeePoisha: string;
  mdrFeeBdt: string;
  netSettledPoisha: string;
  netSettledBdt: string;
  signatureVerified: boolean;
  journalId: string | null;
  rawPayload: string;
  processedAt: string;
}

export interface PgwBatchReconciliationResult {
  batchReference: string;
  provider: 'BKASH' | 'NAGAD' | 'SSLCOMMERZ' | 'AAMARPAY';
  settlementDate: string;
  totalTransactions: number;
  reconciledCount: number;
  replayedCount: number;
  totalGrossPoisha: string;
  totalGrossBdt: string;
  totalMdrFeePoisha: string;
  totalMdrFeeBdt: string;
  totalNetSettledPoisha: string;
  totalNetSettledBdt: string;
  events: MfsWebhookEvent[];
}

