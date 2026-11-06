import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import { TAX_CATEGORIES } from '../company/constants.ts';
import {
  approvePurchaseDocument,
  createPurchaseDraft,
  getPurchaseDocument,
  listPurchaseDocuments,
  postPurchaseDocument,
  PURCHASE_DOCUMENT_STATUSES,
  PURCHASE_DOCUMENT_TYPES,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_TDS_NATURES,
  reversePurchaseDocument,
  updatePurchaseDraft,
  type PurchaseDocumentStatus,
  type PurchaseDocumentType,
} from '../purchases/purchaseService.ts';
import {
  approvePurchasePayment,
  getApAgeing,
  getPurchasePayment,
  getPurchasePaymentApproval,
  getSupplierStatement,
  getWithholdingProof,
  listOpenBills,
  listPurchasePaymentApprovals,
  listPurchasePayments,
  listWithholdingLiabilities,
  postPurchasePayment,
  previewPurchasePayment,
  rejectPurchasePayment,
  reversePurchasePayment,
} from '../purchases/payablesService.ts';
import { approvePurchaseTaxPolicy, getPurchaseTaxPolicy } from '../purchases/tax.ts';
import { PURCHASE_TAX_PACK } from '../purchases/taxPack.generated.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const documentParams = z.object({ companyId: z.string().uuid(), documentId: z.string().uuid() });
const paymentParams = z.object({ companyId: z.string().uuid(), paymentId: z.string().uuid() });
const approvalParams = z.object({ companyId: z.string().uuid(), requestId: z.string().uuid() });

const documentLineSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  descriptionEn: z.string().trim().max(500).optional().nullable(),
  descriptionBn: z.string().trim().max(500).optional().nullable(),
  quantity: z.string().trim().min(1).max(30),
  unit: z.string().trim().max(20).optional().nullable(),
  unitPrice: z.string().trim().max(30).optional().nullable(),
  discount: z.string().trim().max(30).optional().nullable(),
  taxCategory: z.enum(TAX_CATEGORIES).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  warehouseId: z.string().uuid().optional().nullable(),
});

const documentSchema = z.object({
  docType: z.enum(PURCHASE_DOCUMENT_TYPES),
  partyId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  docDate: z.string().min(10).max(10),
  dueDate: z.string().min(10).max(10).optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  supplierInvoiceNo: z.string().trim().min(1).max(64),
  supplierInvoiceDate: z.string().min(10).max(10),
  supplierMushak63Serial: z.string().trim().max(64).optional().nullable(),
  supplierMushak63Date: z.string().min(10).max(10).optional().nullable(),
  reverseChargeChallanReference: z.string().trim().max(200).optional().nullable(),
  attachmentReference: z.string().trim().max(500).optional().nullable(),
  narrationEn: z.string().trim().min(1).max(500),
  narrationBn: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(PURCHASE_PAYMENT_METHODS),
  supplierTinMissing: z.boolean().optional().nullable(),
  vdsApplicable: z.boolean().optional().nullable(),
  tdsNature: z.enum(PURCHASE_TDS_NATURES).optional().nullable(),
  lines: z.array(documentLineSchema).min(1).max(200),
});

const listQuery = z.object({
  type: z.enum(PURCHASE_DOCUMENT_TYPES).optional(),
  status: z.enum(PURCHASE_DOCUMENT_STATUSES).optional(),
  partyId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const reverseSchema = z.object({
  date: z.string().min(10).max(10),
  reason: z.string().trim().min(3).max(500),
});

const approveSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional().nullable(),
});

const paymentAllocationSchema = z.object({
  documentId: z.string().uuid(),
  amount: z.string().trim().max(30),
});

const paymentSchema = z.object({
  paymentDate: z.string().min(10).max(10),
  partyId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid(),
  amount: z.string().trim().max(30),
  reference: z.string().trim().max(200).optional().nullable(),
  attachmentReference: z.string().trim().max(500).optional().nullable(),
  narrationEn: z.string().trim().max(500).optional().nullable(),
  narrationBn: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(paymentAllocationSchema).min(1).max(500),
});

const paymentPreviewSchema = z.object({
  paymentDate: z.string().min(10).max(10),
  partyId: z.string().uuid(),
  allocations: z.array(paymentAllocationSchema).min(1).max(500),
});

const paymentListQuery = z.object({
  partyId: z.string().uuid().optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  status: z.enum(['POSTED', 'REVERSED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const ageingQuery = z.object({
  asOf: z.string().min(10).max(10).optional(),
  partyId: z.string().uuid().optional(),
  branchId: z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional(),
});

const statementQuery = z.object({
  partyId: z.string().uuid(),
  from: z.string().min(10).max(10),
  to: z.string().min(10).max(10),
});

const openBillsQuery = z.object({
  partyId: z.string().uuid().optional(),
  asOf: z.string().min(10).max(10).optional(),
});

const withholdingQuery = z.object({
  status: z.enum(['PENDING', 'DEPOSITED', 'REVERSED']).optional(),
  taxType: z.enum(['VDS', 'TDS', 'REVERSE_CHARGE']).optional(),
  from: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const proofQuery = z.object({ asOf: z.string().min(10).max(10).optional() });

const approvalListQuery = z.object({
  status: z.enum(['PENDING', 'REJECTED', 'POSTED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const approvalDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const rejectionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const taxApprovalSchema = z.object({
  reviewerName: z.string().trim().min(3).max(200),
  reviewerQualification: z.string().trim().min(3).max(200),
  sourceReference: z.string().trim().min(3).max(500),
  reviewedAt: z.string().min(10).max(10),
  inputVatAccountId: z.string().uuid(),
  vdsPayableAccountId: z.string().uuid(),
  tdsPayableAccountId: z.string().uuid(),
  reverseChargePayableAccountId: z.string().uuid(),
  rulePackVersion: z.string().trim().min(1).max(64),
});

function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = readIdempotencyKey(header);
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Posting requires an Idempotency-Key header so a retry cannot duplicate the journal, stock movement, payment or withholding liability.',
    );
  }
  return key;
}

function context(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  if (!auth.company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    organisationId: auth.company.organisationId,
    companyId: auth.company.id,
    audit: {
      organisationId: auth.company.organisationId,
      actorUserId: auth.user.id,
      sessionId: auth.session.id,
      ip: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']) ?? null,
      requestId: request.id,
    },
  };
}

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before changing purchase documents or payments.',
    );
  }
}

function draftFromBody(body: z.infer<typeof documentSchema>) {
  return {
    docType: body.docType as PurchaseDocumentType,
    partyId: body.partyId,
    branchId: body.branchId ?? null,
    docDate: body.docDate,
    dueDate: body.dueDate ?? null,
    paymentTermsDays: body.paymentTermsDays ?? null,
    supplierInvoiceNo: body.supplierInvoiceNo,
    supplierInvoiceDate: body.supplierInvoiceDate,
    supplierMushak63Serial: body.supplierMushak63Serial ?? null,
    supplierMushak63Date: body.supplierMushak63Date ?? null,
    reverseChargeChallanReference: body.reverseChargeChallanReference ?? null,
    attachmentReference: body.attachmentReference ?? null,
    narrationEn: body.narrationEn,
    narrationBn: body.narrationBn ?? null,
    paymentMethod: body.paymentMethod,
    supplierTinMissing: body.supplierTinMissing ?? false,
    vdsApplicable: body.vdsApplicable ?? null,
    tdsNature: body.tdsNature ?? 'NONE',
    lines: body.lines.map((line) => ({
      itemId: line.itemId ?? null,
      descriptionEn: line.descriptionEn ?? null,
      descriptionBn: line.descriptionBn ?? null,
      quantity: line.quantity,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice ?? null,
      discount: line.discount ?? null,
      taxCategory: line.taxCategory ?? null,
      accountId: line.accountId ?? null,
      warehouseId: line.warehouseId ?? null,
    })),
  };
}

function paymentFromBody(body: z.infer<typeof paymentSchema>) {
  return {
    paymentDate: body.paymentDate,
    partyId: body.partyId,
    branchId: body.branchId ?? null,
    bankAccountId: body.bankAccountId,
    amount: body.amount,
    reference: body.reference ?? null,
    attachmentReference: body.attachmentReference ?? null,
    narrationEn: body.narrationEn ?? null,
    narrationBn: body.narrationBn ?? null,
    allocations: body.allocations.map((allocation) => ({
      documentId: allocation.documentId,
      amount: allocation.amount,
    })),
  };
}

export const purchaseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/purchases/documents', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(listQuery, request.query);
    return listPurchaseDocuments(app.db, companyId, {
      ...(query.type ? { docType: query.type as PurchaseDocumentType } : {}),
      ...(query.status ? { status: query.status as PurchaseDocumentStatus } : {}),
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset ? { offset: query.offset } : {}),
    });
  });

  app.post(
    '/companies/:companyId/purchases/documents',
    { config: { auth: { mode: 'company', permission: 'CREATE_COMMERCIAL_DRAFT' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(documentSchema, request.body);
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      const result = await createPurchaseDraft(app.db, {
        ...ctx.audit,
        companyId,
        draft: draftFromBody(body),
        idempotencyKey: idempotencyKey ?? null,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/purchases/documents/:documentId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(documentParams, request.params);
      return { document: await getPurchaseDocument(app.db, params.companyId, params.documentId) };
    },
  );

  app.patch(
    '/companies/:companyId/purchases/documents/:documentId',
    { config: { auth: { mode: 'company', permission: 'CREATE_COMMERCIAL_DRAFT' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(documentSchema, request.body);
      return {
        document: await updatePurchaseDraft(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          documentId: params.documentId,
          draft: draftFromBody(body),
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/purchases/documents/:documentId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(approveSchema, request.body ?? {});
      return {
        document: await approvePurchaseDocument(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          documentId: params.documentId,
          reason: body.reason ?? null,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/purchases/documents/:documentId/post',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      return postPurchaseDocument(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        documentId: params.documentId,
        idempotencyKey,
      });
    },
  );

  app.post(
    '/companies/:companyId/purchases/documents/:documentId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return reversePurchaseDocument(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        documentId: params.documentId,
        date: body.date,
        reason: body.reason,
      });
    },
  );

  app.get(
    '/companies/:companyId/purchases/ap-ageing',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(ageingQuery, request.query);
      const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);
      return { ageing: await getApAgeing(app.db, companyId, asOf, query.partyId, query.branchId ?? null) };
    },
  );

  app.get(
    '/companies/:companyId/purchases/supplier-statement',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(statementQuery, request.query);
      return {
        statement: await getSupplierStatement(app.db, companyId, query.partyId, query.from, query.to),
      };
    },
  );

  app.get('/companies/:companyId/purchases/open-bills', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(openBillsQuery, request.query);
    return {
      bills: await listOpenBills(app.db, companyId, {
        ...(query.partyId ? { partyId: query.partyId } : {}),
        ...(query.asOf ? { asOf: query.asOf } : {}),
      }),
    };
  });

  app.get('/companies/:companyId/purchases/payments', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(paymentListQuery, request.query);
    return listPurchasePayments(app.db, companyId, {
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset ? { offset: query.offset } : {}),
    });
  });

  app.post(
    '/companies/:companyId/purchases/payments',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(paymentSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await postPurchasePayment(app.db, {
        ...ctx.audit,
        companyId,
        idempotencyKey,
        payment: paymentFromBody(body),
      });
      if (result.approvalRequest) {
        reply.code(202);
        return result;
      }
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.post(
    '/companies/:companyId/purchases/payments/preview',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(paymentPreviewSchema, request.body);
      return {
        preview: await previewPurchasePayment(app.db, companyId, {
          paymentDate: body.paymentDate,
          partyId: body.partyId,
          allocations: body.allocations,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/purchases/payments/:paymentId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(paymentParams, request.params);
      return { payment: await getPurchasePayment(app.db, params.companyId, params.paymentId) };
    },
  );

  app.post(
    '/companies/:companyId/purchases/payments/:paymentId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(paymentParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return {
        payment: await reversePurchasePayment(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          paymentId: params.paymentId,
          date: body.date,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/purchases/payment-approvals',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(approvalListQuery, request.query);
      return listPurchasePaymentApprovals(app.db, companyId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/purchases/payment-approvals/:requestId',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const params = parseInput(approvalParams, request.params);
      return { approvalRequest: await getPurchasePaymentApproval(app.db, params.companyId, params.requestId) };
    },
  );

  app.post(
    '/companies/:companyId/purchases/payment-approvals/:requestId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(approvalParams, request.params);
      const body = parseInput(approvalDecisionSchema, request.body ?? {});
      return {
        payment: await approvePurchasePayment(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          approvalRequestId: params.requestId,
          reason: body.reason ?? null,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/purchases/payment-approvals/:requestId/reject',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(approvalParams, request.params);
      const body = parseInput(rejectionSchema, request.body);
      return {
        approvalRequest: await rejectPurchasePayment(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          approvalRequestId: params.requestId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/purchases/withholding-liabilities',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(withholdingQuery, request.query);
      return listWithholdingLiabilities(app.db, companyId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.taxType ? { taxType: query.taxType } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.offset ? { offset: query.offset } : {}),
      });
    },
  );

  app.get(
    '/companies/:companyId/purchases/withholding-proof',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(proofQuery, request.query);
      const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);
      return { proof: await getWithholdingProof(app.db, companyId, asOf) };
    },
  );

  app.get('/companies/:companyId/purchases/tax-policy', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { policy: await getPurchaseTaxPolicy(app.db, companyId) };
  });

  app.post(
    '/companies/:companyId/purchases/tax-policy/approval',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(taxApprovalSchema, request.body);
      return {
        policy: await approvePurchaseTaxPolicy(app.db, {
          ...ctx.audit,
          companyId,
          reviewerName: body.reviewerName,
          reviewerQualification: body.reviewerQualification,
          sourceReference: body.sourceReference,
          reviewedAt: body.reviewedAt,
          inputVatAccountId: body.inputVatAccountId,
          vdsPayableAccountId: body.vdsPayableAccountId,
          tdsPayableAccountId: body.tdsPayableAccountId,
          reverseChargePayableAccountId: body.reverseChargePayableAccountId,
          rulePackVersion: body.rulePackVersion,
        }),
      };
    },
  );

  app.get('/companies/:companyId/purchases/rule-pack', { config: { auth: { mode: 'company' } } }, async () => ({
    version: PURCHASE_TAX_PACK.version,
    reviewerStatus: PURCHASE_TAX_PACK.reviewerStatus,
  }));
};
