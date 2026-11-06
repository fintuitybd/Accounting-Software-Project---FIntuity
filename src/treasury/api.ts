import { apiRequest } from '../auth/api';

export type TreasuryTaxType = 'VDS' | 'TDS' | 'REVERSE_CHARGE';
export type TreasuryLiabilityStatus = 'PENDING' | 'DEPOSITED' | 'REVERSED';
export type TreasuryCertificateType = 'VDS' | 'TDS';
export type TreasuryCertificateStatus = 'DRAFT' | 'CANCELLED';

export interface TreasuryLiability {
  id: string;
  taxType: TreasuryTaxType;
  sourceType: 'BILL' | 'PAYMENT';
  taxPeriod: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  billId: string | null;
  billNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  basePoisha: string;
  baseBdt: string;
  rateBps: number;
  amountPoisha: string;
  amountBdt: string;
  economicCode: string | null;
  status: TreasuryLiabilityStatus;
  challanId: string | null;
  challanNumber: string | null;
  depositedAt: string | null;
  certificateId: string | null;
  certificateNumber: string | null;
  certificateStatus: TreasuryCertificateStatus | null;
  createdAt: string;
}

export interface TreasuryChallanItem {
  id: string;
  liabilityId: string;
  taxType: TreasuryTaxType;
  taxPeriod: string;
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  billId: string | null;
  billNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  amountPoisha: string;
  amountBdt: string;
  economicCode: string;
  certificateId: string | null;
  certificateNumber: string | null;
  certificateStatus: TreasuryCertificateStatus | null;
}

export interface TreasuryChallan {
  id: string;
  companyId: string;
  challanNumber: string;
  status: 'POSTED' | 'REVERSED';
  depositDate: string;
  bankAccountId: string;
  bankAccountName: string;
  bankKind: string;
  glAccountCode: string;
  bankBranch: string;
  depositReference: string;
  evidenceReference: string;
  totalPoisha: string;
  totalBdt: string;
  journalId: string;
  journalNumber: string | null;
  reversalJournalId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  items: TreasuryChallanItem[];
}

export interface TreasuryCertificate {
  id: string;
  companyId: string;
  certificateType: TreasuryCertificateType;
  certificateNumber: string;
  direction: 'ISSUED' | 'RECEIVED';
  partyId: string;
  partyCode: string;
  partyNameEn: string;
  originalDocumentId: string | null;
  originalDocumentNo: string | null;
  supplierInvoiceNo: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  liabilityId: string;
  challanId: string | null;
  challanNumber: string | null;
  certificateDate: string;
  basePoisha: string;
  baseBdt: string;
  taxPoisha: string;
  taxBdt: string;
  status: TreasuryCertificateStatus;
  reviewStatus: 'DRAFT_STATUTORY_FORMAT_UNVERIFIED';
  evidenceReference: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  reissuedFromId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface TreasuryProofTax {
  glPoisha: string;
  glBdt: string;
  pendingPoisha: string;
  pendingBdt: string;
  depositedPoisha: string;
  depositedBdt: string;
  differencePoisha: string;
  differenceBdt: string;
  agrees: boolean;
}

export interface TreasuryProof {
  asOf: string;
  currency: 'BDT';
  taxes: Record<TreasuryTaxType, TreasuryProofTax>;
  challans: {
    postedPoisha: string;
    postedBdt: string;
    reversedPoisha: string;
    reversedBdt: string;
    depositedLiabilityPoisha: string;
    depositedLiabilityBdt: string;
    differencePoisha: string;
    differenceBdt: string;
    agrees: boolean;
  };
  certificates: {
    draftCount: number;
    draftPoisha: string;
    draftBdt: string;
    cancelledCount: number;
    cancelledPoisha: string;
    cancelledBdt: string;
    label: string;
  };
}

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const treasuryApi = {
  liabilities: (
    companyId: string,
    query: {
      status?: TreasuryLiabilityStatus;
      taxType?: TreasuryTaxType;
      partyId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: TreasuryLiability[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/treasury/liabilities${queryString(query)}`,
    ),
  setEconomicCode: (companyId: string, liabilityId: string, economicCode: string) =>
    apiRequest<{ liability: TreasuryLiability }>(
      `/companies/${companyId}/treasury/liabilities/${liabilityId}/economic-code`,
      { method: 'PATCH', body: { economicCode } },
    ),
  challans: (
    companyId: string,
    query: { status?: 'POSTED' | 'REVERSED'; from?: string; to?: string; limit?: number; offset?: number } = {},
  ) =>
    apiRequest<{ entries: TreasuryChallan[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/treasury/challans${queryString(query)}`,
    ),
  challan: (companyId: string, challanId: string) =>
    apiRequest<{ challan: TreasuryChallan }>(`/companies/${companyId}/treasury/challans/${challanId}`),
  postChallan: (
    companyId: string,
    input: {
      depositDate: string;
      bankAccountId: string;
      bankBranch: string;
      depositReference: string;
      evidenceReference: string;
      items: Array<{ liabilityId: string; economicCode: string }>;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<{ challan: TreasuryChallan; replayed: boolean }>(`/companies/${companyId}/treasury/challans`, {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  reverseChallan: (companyId: string, challanId: string, date: string, reason: string) =>
    apiRequest<{ challan: TreasuryChallan }>(
      `/companies/${companyId}/treasury/challans/${challanId}/reverse`,
      { method: 'POST', body: { date, reason } },
    ),
  certificates: (
    companyId: string,
    query: {
      type?: TreasuryCertificateType;
      status?: TreasuryCertificateStatus;
      direction?: 'ISSUED' | 'RECEIVED';
      partyId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    apiRequest<{ entries: TreasuryCertificate[]; total: number; limit: number; offset: number }>(
      `/companies/${companyId}/treasury/certificates${queryString(query)}`,
    ),
  certificate: (companyId: string, certificateId: string) =>
    apiRequest<{ certificate: TreasuryCertificate }>(
      `/companies/${companyId}/treasury/certificates/${certificateId}`,
    ),
  cancelCertificate: (companyId: string, certificateId: string, reason: string) =>
    apiRequest<{ certificate: TreasuryCertificate }>(
      `/companies/${companyId}/treasury/certificates/${certificateId}/cancel`,
      { method: 'POST', body: { reason } },
    ),
  reissueCertificate: (
    companyId: string,
    certificateId: string,
    reason: string,
    evidenceReference?: string | null,
  ) =>
    apiRequest<{ certificate: TreasuryCertificate }>(
      `/companies/${companyId}/treasury/certificates/${certificateId}/reissue`,
      { method: 'POST', body: { reason, evidenceReference: evidenceReference ?? null } },
    ),
  proof: (companyId: string, asOf: string) =>
    apiRequest<{ proof: TreasuryProof }>(`/companies/${companyId}/treasury/proof${queryString({ asOf })}`),
};
