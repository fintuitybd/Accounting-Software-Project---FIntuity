import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import { TAX_CATEGORIES } from '../company/constants.ts';
import {
  approveSalesDocument,
  createSalesDraft,
  getSalesDocument,
  getSalesTaxPolicyForCompany,
  listSalesDocuments,
  postSalesDocument,
  reverseSalesDocument,
  updateSalesDraft,
  type SalesDocumentStatus,
  type SalesDocumentType,
} from '../sales/salesService.ts';
import {
  allocateSalesReceipt,
  getArAgeing,
  getCustomerStatement,
  getSalesReceipt,
  getVatRegister,
  listOpenInvoices,
  listSalesReceipts,
  postSalesReceipt,
  reverseSalesReceipt,
} from '../sales/receivablesService.ts';
import { approveSalesTaxPolicy } from '../sales/tax.ts';
import { SALES_TAX_PACK } from '../sales/taxPack.generated.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const documentParams = z.object({ companyId: z.string().uuid(), documentId: z.string().uuid() });
const receiptParams = z.object({ companyId: z.string().uuid(), receiptId: z.string().uuid() });

const documentLineSchema = z.object({
  originalLineId: z.string().uuid().optional().nullable(),
  itemId: z.string().uuid().optional().nullable(),
  descriptionEn: z.string().trim().max(500).optional().nullable(),
  descriptionBn: z.string().trim().max(500).optional().nullable(),
  quantity: z.string().trim().min(1).max(30),
  unit: z.string().trim().max(20).optional().nullable(),
  unitPrice: z.string().trim().max(30).optional().nullable(),
  discount: z.string().trim().max(30).optional().nullable(),
  taxCategory: z.enum(TAX_CATEGORIES).optional().nullable(),
  revenueAccountId: z.string().uuid().optional().nullable(),
  warehouseId: z.string().uuid().optional().nullable(),
});

const documentSchema = z
  .object({
    docType: z.enum(['SALES_INVOICE', 'CREDIT_NOTE']),
    partyId: z.string().uuid(),
    branchId: z.string().uuid().optional().nullable(),
    docDate: z.string().min(10).max(10),
    dueDate: z.string().min(10).max(10).optional().nullable(),
    paymentTermsDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
    narrationEn: z.string().trim().min(1).max(500),
    narrationBn: z.string().trim().max(500).optional().nullable(),
    attachmentReference: z.string().trim().max(500).optional().nullable(),
    creditReason: z.string().trim().max(500).optional().nullable(),
    originalDocumentId: z.string().uuid().optional().nullable(),
    lines: z.array(documentLineSchema).min(1).max(200),
  })
  .superRefine((value, context) => {
    if (value.docType === 'CREDIT_NOTE') {
      if (!value.originalDocumentId) {
        context.addIssue({
          code: 'custom',
          path: ['originalDocumentId'],
          message: 'Choose the original posted invoice.',
        });
      }
      if (!value.creditReason || value.creditReason.trim().length < 3) {
        context.addIssue({ code: 'custom', path: ['creditReason'], message: 'A credit-note reason is required.' });
      }
      value.lines.forEach((line, index) => {
        if (!line.originalLineId) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'originalLineId'],
            message: 'Choose an original invoice line.',
          });
        }
      });
    } else {
      value.lines.forEach((line, index) => {
        if (!line.unitPrice) {
          context.addIssue({ code: 'custom', path: ['lines', index, 'unitPrice'], message: 'Unit price is required.' });
        }
        if (!line.taxCategory) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'taxCategory'],
            message: 'Tax category is required.',
          });
        }
        if (!line.revenueAccountId) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'revenueAccountId'],
            message: 'Revenue account is required.',
          });
        }
      });
    }
  });

const listQuery = z.object({
  type: z.enum(['SALES_INVOICE', 'CREDIT_NOTE']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'POSTED', 'REVERSED']).optional(),
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

const approveSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

const receiptAllocationSchema = z.object({
  documentId: z.string().uuid(),
  amount: z.string().trim().max(30),
  writeOff: z.string().trim().max(30).optional().nullable(),
});

const receiptSchema = z.object({
  receiptDate: z.string().min(10).max(10),
  partyId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid(),
  amount: z.string().trim().max(30),
  writeOffAccountId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(200).optional().nullable(),
  attachmentReference: z.string().trim().max(500).optional().nullable(),
  narrationEn: z.string().trim().max(500).optional().nullable(),
  narrationBn: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(receiptAllocationSchema).max(500).default([]),
});

const allocateSchema = z.object({ allocations: z.array(receiptAllocationSchema).min(1).max(500) });

const receiptListQuery = z.object({
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

const vatQuery = z.object({
  from: z.string().min(10).max(10),
  to: z.string().min(10).max(10),
  branchId: z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional(),
});

const openInvoicesQuery = z.object({
  partyId: z.string().uuid().optional(),
  asOf: z.string().min(10).max(10).optional(),
});

const taxApprovalSchema = z.object({
  reviewerName: z.string().trim().min(3).max(200),
  reviewerQualification: z.string().trim().min(3).max(200),
  sourceReference: z.string().trim().min(3).max(500),
  reviewedAt: z.string().min(10).max(10),
  outputVatAccountId: z.string().uuid(),
  rulePackVersion: z.string().trim().min(1).max(64),
});

function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = readIdempotencyKey(header);
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Posting requires an Idempotency-Key header so a retry cannot duplicate the journal, stock movement or open item.',
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
    canWriteOff: auth.permissions.includes('APPROVE_HIGH_VALUE'),
    canReverse: auth.permissions.includes('REVERSE_POSTED_JOURNAL'),
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
      'Verify your email address before changing sales documents.',
    );
  }
}

function draftFromBody(body: z.infer<typeof documentSchema>) {
  return {
    docType: body.docType as SalesDocumentType,
    partyId: body.partyId,
    branchId: body.branchId ?? null,
    docDate: body.docDate,
    dueDate: body.dueDate ?? null,
    paymentTermsDays: body.paymentTermsDays ?? null,
    narrationEn: body.narrationEn,
    narrationBn: body.narrationBn ?? null,
    attachmentReference: body.attachmentReference ?? null,
    creditReason: body.creditReason ?? null,
    originalDocumentId: body.originalDocumentId ?? null,
    lines: body.lines.map((line) => ({
      originalLineId: line.originalLineId ?? null,
      itemId: line.itemId ?? null,
      descriptionEn: line.descriptionEn ?? null,
      descriptionBn: line.descriptionBn ?? null,
      quantity: line.quantity,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice ?? null,
      discount: line.discount ?? null,
      taxCategory: line.taxCategory ?? null,
      revenueAccountId: line.revenueAccountId ?? null,
      warehouseId: line.warehouseId ?? null,
    })),
  };
}

export const salesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/sales/documents', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(listQuery, request.query);
    return listSalesDocuments(app.db, companyId, {
      ...(query.type ? { docType: query.type as SalesDocumentType } : {}),
      ...(query.status ? { status: query.status as SalesDocumentStatus } : {}),
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset ? { offset: query.offset } : {}),
    });
  });

  app.post(
    '/companies/:companyId/sales/documents',
    { config: { auth: { mode: 'company', permission: 'CREATE_COMMERCIAL_DRAFT' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(documentSchema, request.body);
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      const result = await createSalesDraft(app.db, {
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
    '/companies/:companyId/sales/documents/:documentId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(documentParams, request.params);
      return { document: await getSalesDocument(app.db, params.companyId, params.documentId) };
    },
  );

  app.patch(
    '/companies/:companyId/sales/documents/:documentId',
    { config: { auth: { mode: 'company', permission: 'CREATE_COMMERCIAL_DRAFT' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(documentSchema, request.body);
      return {
        document: await updateSalesDraft(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          documentId: params.documentId,
          draft: draftFromBody(body),
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/sales/documents/:documentId/approve',
    { config: { auth: { mode: 'company', permission: 'APPROVE_HIGH_VALUE' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(approveSchema, request.body ?? {});
      return {
        document: await approveSalesDocument(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          documentId: params.documentId,
          reason: body.reason ?? null,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/sales/documents/:documentId/post',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      return postSalesDocument(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        documentId: params.documentId,
        idempotencyKey,
      });
    },
  );

  app.post(
    '/companies/:companyId/sales/documents/:documentId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(documentParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return reverseSalesDocument(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        documentId: params.documentId,
        date: body.date,
        reason: body.reason,
      });
    },
  );

  app.get(
    '/companies/:companyId/sales/ar-ageing',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(ageingQuery, request.query);
      const asOf = query.asOf ?? new Date().toISOString().slice(0, 10);
      return { ageing: await getArAgeing(app.db, companyId, asOf, query.partyId, query.branchId ?? null) };
    },
  );

  app.get(
    '/companies/:companyId/sales/customer-statement',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(statementQuery, request.query);
      return {
        statement: await getCustomerStatement(app.db, companyId, query.partyId, query.from, query.to),
      };
    },
  );

  app.get(
    '/companies/:companyId/sales/vat-register',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(vatQuery, request.query);
      return {
        register: await getVatRegister(app.db, companyId, query.from, query.to, query.branchId ?? null),
      };
    },
  );

  app.get('/companies/:companyId/sales/open-invoices', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(openInvoicesQuery, request.query);
    return {
      invoices: await listOpenInvoices(app.db, companyId, {
        ...(query.partyId ? { partyId: query.partyId } : {}),
        ...(query.asOf ? { asOf: query.asOf } : {}),
      }),
    };
  });

  app.get('/companies/:companyId/sales/receipts', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(receiptListQuery, request.query);
    return listSalesReceipts(app.db, companyId, {
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.offset ? { offset: query.offset } : {}),
    });
  });

  app.post(
    '/companies/:companyId/sales/receipts',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(receiptSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await postSalesReceipt(app.db, {
        ...ctx.audit,
        companyId,
        idempotencyKey,
        canWriteOff: ctx.canWriteOff,
        receipt: {
          receiptDate: body.receiptDate,
          partyId: body.partyId,
          branchId: body.branchId ?? null,
          bankAccountId: body.bankAccountId,
          amount: body.amount,
          writeOffAccountId: body.writeOffAccountId ?? null,
          reference: body.reference ?? null,
          attachmentReference: body.attachmentReference ?? null,
          narrationEn: body.narrationEn ?? null,
          narrationBn: body.narrationBn ?? null,
          allocations: body.allocations.map((allocation) => ({
            documentId: allocation.documentId,
            amount: allocation.amount,
            writeOff: allocation.writeOff ?? null,
          })),
        },
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.get(
    '/companies/:companyId/sales/receipts/:receiptId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(receiptParams, request.params);
      return { receipt: await getSalesReceipt(app.db, params.companyId, params.receiptId) };
    },
  );

  app.post(
    '/companies/:companyId/sales/receipts/:receiptId/allocations',
    { config: { auth: { mode: 'company', permission: 'POST_TO_GL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(receiptParams, request.params);
      const body = parseInput(allocateSchema, request.body);
      return {
        receipt: await allocateSalesReceipt(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          receiptId: params.receiptId,
          allocations: body.allocations.map((allocation) => ({
            documentId: allocation.documentId,
            amount: allocation.amount,
            writeOff: allocation.writeOff ?? null,
          })),
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/sales/receipts/:receiptId/reverse',
    { config: { auth: { mode: 'company', permission: 'REVERSE_POSTED_JOURNAL' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(receiptParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      return {
        receipt: await reverseSalesReceipt(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          receiptId: params.receiptId,
          date: body.date,
          reason: body.reason,
          canReverse: ctx.canReverse,
        }),
      };
    },
  );

  app.get('/companies/:companyId/sales/tax-policy', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    return { policy: await getSalesTaxPolicyForCompany(app.db, companyId) };
  });

  app.post(
    '/companies/:companyId/sales/tax-policy/approval',
    { config: { auth: { mode: 'company', permission: 'MANAGE_COMPANY_SETTINGS' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(taxApprovalSchema, request.body);
      return {
        policy: await approveSalesTaxPolicy(app.db, {
          ...ctx.audit,
          companyId,
          reviewerName: body.reviewerName,
          reviewerQualification: body.reviewerQualification,
          sourceReference: body.sourceReference,
          reviewedAt: body.reviewedAt,
          outputVatAccountId: body.outputVatAccountId,
          rulePackVersion: body.rulePackVersion,
        }),
      };
    },
  );

  app.get('/companies/:companyId/sales/rule-pack', { config: { auth: { mode: 'company' } } }, async () => ({
    version: SALES_TAX_PACK.version,
    reviewerStatus: SALES_TAX_PACK.reviewerStatus,
  }));
};
