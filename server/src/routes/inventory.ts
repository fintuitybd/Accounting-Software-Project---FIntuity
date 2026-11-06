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
};
