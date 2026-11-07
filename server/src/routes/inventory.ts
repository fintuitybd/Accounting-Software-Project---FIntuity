import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { readIdempotencyKey } from '../idempotency.ts';
import { INVENTORY_MOVEMENT_TYPES } from '../master/constants.ts';
import {
  executeStockCommand,
  getInventoryControlProof,
  listStockBalances,
  listStockMovements,
  reverseStockCommand,
  type StockCommandInput,
  type StockCommandType,
} from '../inventory/inventoryService.ts';
import {
  createMushak43Declaration,
  executeProductionBatch,
  getMushak43Declaration,
  getProductionBatch,
  listMushak43Declarations,
  listProductionBatches,
  submitMushak43ToNbr,
} from '../inventory/mushak43Service.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const commandParams = z.object({ companyId: z.string().uuid(), commandId: z.string().uuid() });

const commandSchema = z
  .object({
    type: z.enum(['OPENING', 'GRN', 'ISSUE', 'RETURN', 'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT']),
    itemId: z.string().uuid(),
    date: z.string().min(10).max(10),
    quantity: z.string().trim().max(30),
    sourceRef: z.string().trim().max(200).optional().nullable(),
    warehouseId: z.string().uuid().optional().nullable(),
    fromWarehouseId: z.string().uuid().optional().nullable(),
    toWarehouseId: z.string().uuid().optional().nullable(),
    unitCost: z.string().trim().max(30).optional().nullable(),
    offsetAccountId: z.string().uuid().optional().nullable(),
    allowNegativeStock: z.boolean().default(false),
    overrideReason: z.string().trim().max(500).optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((value, context) => {
    const requireField = (
      field: 'warehouseId' | 'fromWarehouseId' | 'toWarehouseId' | 'offsetAccountId' | 'reason',
    ) => {
      if (!value[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'This field is required for the selected movement.',
        });
      }
    };
    if (value.type === 'TRANSFER') {
      requireField('fromWarehouseId');
      requireField('toWarehouseId');
      return;
    }
    requireField('warehouseId');
    if (value.type === 'OPENING' || value.type === 'GRN') {
      requireField('offsetAccountId');
      if (!value.unitCost) {
        context.addIssue({
          code: 'custom',
          path: ['unitCost'],
          message: 'Unit cost is required for opening stock and GRN receipts.',
        });
      }
    }
    if (value.type === 'ADJUSTMENT_IN' || value.type === 'ADJUSTMENT_OUT') {
      requireField('offsetAccountId');
      requireField('reason');
    }
  });

const movementListQuery = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  movementType: z.enum(INVENTORY_MOVEMENT_TYPES).optional(),
  from: z.string().min(10).max(10).optional(),
  to: z.string().min(10).max(10).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const balanceListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  warehouseId: z.string().uuid().optional(),
  includeZero: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const controlProofQuery = z.object({ asOf: z.string().min(10).max(10).optional() });

const declarationParams = z.object({ companyId: z.string().uuid(), declarationId: z.string().uuid() });
const batchParams = z.object({ companyId: z.string().uuid(), batchId: z.string().uuid() });

const createMushak43Schema = z.object({
  declarationNumber: z.string().trim().max(100).optional().nullable(),
  finishedItemId: z.string().uuid(),
  outputQuantity: z.string().trim().max(30),
  outputUnit: z.string().trim().min(1).max(30),
  effectiveFrom: z.string().min(10).max(10),
  effectiveTo: z.string().min(10).max(10).optional().nullable(),
  nbrDivisionOffice: z.string().trim().max(200).optional().nullable(),
  directLaborCostPoisha: z.union([z.string(), z.number(), z.bigint()]).optional(),
  manufacturingOverheadPoisha: z.union([z.string(), z.number(), z.bigint()]).optional(),
  packagingCostPoisha: z.union([z.string(), z.number(), z.bigint()]).optional(),
  targetProfitMarginBps: z.coerce.number().int().min(0).max(10000).optional(),
  declaredRetailPricePoisha: z.union([z.string(), z.number(), z.bigint()]).optional().nullable(),
  ingredients: z
    .array(
      z.object({
        rawItemId: z.string().uuid(),
        netQuantity: z.string().trim().max(30),
        wastageBps: z.coerce.number().int().min(0).max(10000),
        unit: z.string().trim().min(1).max(30),
        ratePerUnitPoisha: z.union([z.string(), z.number(), z.bigint()]),
        rebatableInputVat: z.boolean().optional(),
      }),
    )
    .min(1),
});

const submitMushak43Schema = z.object({
  nbrSubmissionDate: z.string().min(10).max(10).optional(),
  nbrDivisionOffice: z.string().trim().max(200).optional().nullable(),
  approveImmediately: z.boolean().optional(),
});

const executeBatchSchema = z.object({
  declarationId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  batchQuantity: z.string().trim().max(30),
  batchDate: z.string().min(10).max(10),
  batchNumber: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  allowNegativeStock: z.boolean().default(false),
  overrideReason: z.string().trim().max(500).optional().nullable(),
});

const mushak43ListQuery = z.object({
  finishedItemId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED_TO_NBR', 'APPROVED', 'SUPERSEDED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const batchListQuery = z.object({
  finishedItemId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'COMPLETED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const reverseSchema = z.object({
  date: z.string().min(10).max(10),
  reason: z.string().trim().min(3).max(500),
  overrideReason: z.string().trim().max(500).optional().nullable(),
});

function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = readIdempotencyKey(header);
  if (!key) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Stock commands require an Idempotency-Key header so a retry cannot duplicate stock or the inventory journal.',
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
    canOverrideNegativeStock: auth.permissions.includes('OVERRIDE_NEGATIVE_STOCK'),
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
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address before recording stock.');
  }
}

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/inventory/balances', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(balanceListQuery, request.query);
    const result = await listStockBalances(app.db, companyId, {
      includeZero: query.includeZero === 'true',
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search ? { search: query.search } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    });
    return { balances: result.entries, total: result.total, page: result.page, pageSize: result.pageSize };
  });

  app.get('/companies/:companyId/inventory/movements', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(movementListQuery, request.query);
    const result = await listStockMovements(app.db, companyId, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    });
    return { movements: result.entries, total: result.total, page: result.page, pageSize: result.pageSize };
  });

  app.get(
    '/companies/:companyId/inventory/control-proof',
    { config: { auth: { mode: 'company', permission: 'VIEW_REPORTS' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(controlProofQuery, request.query);
      return { proof: await getInventoryControlProof(app.db, companyId, query.asOf) };
    },
  );

  app.post(
    '/companies/:companyId/inventory/movements',
    { config: { auth: { mode: 'company', permission: 'DISPATCH_OR_RECEIVE_STOCK' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(commandSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const command: StockCommandInput = {
        type: body.type as StockCommandType,
        itemId: body.itemId,
        date: body.date,
        quantity: body.quantity,
        sourceRef: body.sourceRef ?? null,
        warehouseId: body.warehouseId ?? null,
        fromWarehouseId: body.fromWarehouseId ?? null,
        toWarehouseId: body.toWarehouseId ?? null,
        unitCost: body.unitCost ?? null,
        offsetAccountId: body.offsetAccountId ?? null,
        allowNegativeStock: body.allowNegativeStock,
        overrideReason: body.overrideReason ?? null,
        reason: body.reason ?? null,
      };
      const result = await executeStockCommand(app.db, {
        ...ctx.audit,
        companyId,
        idempotencyKey,
        canOverrideNegativeStock: ctx.canOverrideNegativeStock,
        command,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  app.post(
    '/companies/:companyId/inventory/commands/:commandId/reverse',
    { config: { auth: { mode: 'company', permission: 'DISPATCH_OR_RECEIVE_STOCK' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(commandParams, request.params);
      const body = parseInput(reverseSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await reverseStockCommand(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        commandId: params.commandId,
        date: body.date,
        reason: body.reason,
        overrideReason: body.overrideReason ?? null,
        idempotencyKey,
        canOverrideNegativeStock: ctx.canOverrideNegativeStock,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  // ---------------------------------------------------------------------------
  // Mushak 4.3 Input-Output Coefficient Declarations (Rule 21, VAT Rules 2016)
  // ---------------------------------------------------------------------------

  app.get('/companies/:companyId/inventory/mushak-43', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(mushak43ListQuery, request.query);
    return listMushak43Declarations(app.db, companyId, query);
  });

  app.get(
    '/companies/:companyId/inventory/mushak-43/:declarationId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, declarationId } = parseInput(declarationParams, request.params);
      const declaration = await getMushak43Declaration(app.db, companyId, declarationId);
      if (!declaration) throw new AppError(404, 'DECLARATION_NOT_FOUND', 'Mushak 4.3 declaration not found.');
      return { declaration };
    },
  );

  app.post(
    '/companies/:companyId/inventory/mushak-43',
    { config: { auth: { mode: 'company', permission: 'DISPATCH_OR_RECEIVE_STOCK' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(createMushak43Schema, request.body);
      const declaration = await createMushak43Declaration(app.db, {
        companyId,
        declarationNumber: body.declarationNumber,
        finishedItemId: body.finishedItemId,
        outputQuantity: body.outputQuantity,
        outputUnit: body.outputUnit,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        nbrDivisionOffice: body.nbrDivisionOffice,
        directLaborCostPoisha: body.directLaborCostPoisha,
        manufacturingOverheadPoisha: body.manufacturingOverheadPoisha,
        packagingCostPoisha: body.packagingCostPoisha,
        targetProfitMarginBps: body.targetProfitMarginBps,
        declaredRetailPricePoisha: body.declaredRetailPricePoisha,
        ingredients: body.ingredients,
        userId: ctx.auth.user.id,
      });
      reply.code(201);
      return { declaration };
    },
  );

  app.post(
    '/companies/:companyId/inventory/mushak-43/:declarationId/submit-nbr',
    { config: { auth: { mode: 'company', permission: 'DISPATCH_OR_RECEIVE_STOCK' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId, declarationId } = parseInput(declarationParams, request.params);
      const body = parseInput(submitMushak43Schema, request.body);
      const declaration = await submitMushak43ToNbr(app.db, {
        companyId,
        declarationId,
        nbrSubmissionDate: body.nbrSubmissionDate,
        nbrDivisionOffice: body.nbrDivisionOffice ?? undefined,
        approveImmediately: body.approveImmediately,
        userId: ctx.auth.user.id,
      });
      return { declaration };
    },
  );

  // ---------------------------------------------------------------------------
  // Production Batches & IAS 2 WIP / Finished Goods Costing Engine
  // ---------------------------------------------------------------------------

  app.get(
    '/companies/:companyId/inventory/production-batches',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(batchListQuery, request.query);
      return listProductionBatches(app.db, companyId, query);
    },
  );

  app.get(
    '/companies/:companyId/inventory/production-batches/:batchId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, batchId } = parseInput(batchParams, request.params);
      const batch = await getProductionBatch(app.db, companyId, batchId);
      if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Production batch not found.');
      return { batch };
    },
  );

  app.post(
    '/companies/:companyId/inventory/production-batches',
    { config: { auth: { mode: 'company', permission: 'DISPATCH_OR_RECEIVE_STOCK' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(executeBatchSchema, request.body);
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const result = await executeProductionBatch(app.db, {
        companyId,
        declarationId: body.declarationId,
        warehouseId: body.warehouseId,
        batchQuantity: body.batchQuantity,
        batchDate: body.batchDate,
        batchNumber: body.batchNumber,
        notes: body.notes,
        allowNegativeStock: body.allowNegativeStock,
        overrideReason: body.overrideReason,
        idempotencyKey,
        userId: ctx.auth.user.id,
        sessionId: ctx.audit.sessionId,
        ip: ctx.audit.ip,
        userAgent: ctx.audit.userAgent,
        requestId: ctx.audit.requestId,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );
};
