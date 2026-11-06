import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import { TAX_CATEGORIES } from '../company/constants.ts';
import { PARTY_OPENING_DOCUMENT_TYPES, PARTY_TYPES } from '../master/constants.ts';
import {
  cancelPartyOpeningItem,
  createParty,
  createPartyOpeningItem,
  deactivateParty,
  getParty,
  listPartyOpeningItems,
  listParties,
  reactivateParty,
  updateParty,
} from '../master/partyService.ts';
import { createItem, deactivateItem, getItem, listItems, reactivateItem, updateItem } from '../master/itemService.ts';
import {
  createBranch,
  createWarehouse,
  deactivateBranch,
  deactivateWarehouse,
  getWarehouse,
  listBranches,
  listWarehouses,
  reactivateBranch,
  reactivateWarehouse,
  updateBranch,
  updateWarehouse,
} from '../master/warehouseService.ts';

const companyParams = z.object({ companyId: z.string().uuid() });
const partyParams = z.object({ companyId: z.string().uuid(), partyId: z.string().uuid() });
const openingItemParams = z.object({
  companyId: z.string().uuid(),
  partyId: z.string().uuid(),
  itemId: z.string().uuid(),
});
const itemParams = z.object({ companyId: z.string().uuid(), itemId: z.string().uuid() });
const branchParams = z.object({ companyId: z.string().uuid(), branchId: z.string().uuid() });
const warehouseParams = z.object({ companyId: z.string().uuid(), warehouseId: z.string().uuid() });

const optionalEmail = z
  .union([z.literal(''), z.string().trim().min(3).max(320).email()])
  .optional()
  .nullable();

const partySchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  type: z.enum(PARTY_TYPES),
  bin: z.string().trim().max(32).optional().nullable(),
  tin: z.string().trim().max(32).optional().nullable(),
  addressEn: z.string().trim().max(500).optional().nullable(),
  addressBn: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  email: optionalEmail,
  creditDays: z.coerce.number().int().min(0).max(3650).default(0),
  creditLimit: z.string().trim().max(30).default('0'),
  isWithholdingBuyer: z.boolean().default(false),
  isGovernment: z.boolean().default(false),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const partyOpeningItemSchema = z.object({
  documentType: z.enum(PARTY_OPENING_DOCUMENT_TYPES),
  documentNo: z.string().trim().min(1).max(64),
  dueDate: z.string().min(10).max(10),
  amount: z.string().trim().max(30),
  base: z.string().trim().max(30).optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
});

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  hsCode: z.string().trim().max(20).optional().nullable(),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  unit: z.string().trim().min(1).max(20),
  unitBn: z.string().trim().max(40).optional().nullable(),
  isStockItem: z.boolean().default(true),
  defaultTaxCategory: z.enum(TAX_CATEGORIES).default('STANDARD_15'),
  inventoryAccountId: z.string().uuid().optional().nullable(),
  expenseAccountId: z.string().uuid().optional().nullable(),
});

const branchSchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  bin: z.string().trim().max(32).optional().nullable(),
  isPrincipal: z.boolean().default(false),
});

const warehouseSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const partyListQuery = listQuery.extend({ type: z.enum(PARTY_TYPES).optional() });
const itemListQuery = listQuery.extend({ stockOnly: z.enum(['true', 'false']).optional() });

function requireVerifiedEmail(auth: ReturnType<typeof getAuth>): void {
  if (!auth.user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address before changing master data.');
  }
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

export const masterDataRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies/:companyId/parties', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(partyListQuery, request.query);
    const result = await listParties(app.db, companyId, {
      includeInactive: query.includeInactive === 'true',
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search ? { search: query.search } : {}),
      ...(query.type ? { type: query.type } : {}),
    });
    return { parties: result.entries, total: result.total, page: result.page, pageSize: result.pageSize };
  });

  app.get('/companies/:companyId/parties/:partyId', { config: { auth: { mode: 'company' } } }, async (request) => {
    const params = parseInput(partyParams, request.params);
    return { party: await getParty(app.db, params.companyId, params.partyId) };
  });

  app.post(
    '/companies/:companyId/parties',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const party = parseInput(partySchema, request.body);
      const created = await createParty(app.db, { ...ctx.audit, companyId, party });
      reply.code(201);
      return { party: created };
    },
  );

  app.patch(
    '/companies/:companyId/parties/:partyId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(partyParams, request.params);
      const party = parseInput(partySchema, request.body);
      return {
        party: await updateParty(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          partyId: params.partyId,
          party,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/parties/:partyId/deactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(partyParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        party: await deactivateParty(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          partyId: params.partyId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/parties/:partyId/reactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(partyParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        party: await reactivateParty(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          partyId: params.partyId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get(
    '/companies/:companyId/parties/:partyId/opening-items',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(partyParams, request.params);
      const query = parseInput(z.object({ includeCancelled: z.enum(['true', 'false']).optional() }), request.query);
      return {
        items: await listPartyOpeningItems(app.db, params.companyId, params.partyId, {
          includeCancelled: query.includeCancelled === 'true',
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/parties/:partyId/opening-items',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(partyParams, request.params);
      const body = parseInput(partyOpeningItemSchema, request.body);
      const item = await createPartyOpeningItem(app.db, {
        ...ctx.audit,
        companyId: params.companyId,
        partyId: params.partyId,
        ...body,
      });
      reply.code(201);
      return { item };
    },
  );

  app.post(
    '/companies/:companyId/parties/:partyId/opening-items/:itemId/cancel',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(openingItemParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        item: await cancelPartyOpeningItem(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          partyId: params.partyId,
          itemId: params.itemId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get('/companies/:companyId/items', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(itemListQuery, request.query);
    const result = await listItems(app.db, companyId, {
      includeInactive: query.includeInactive === 'true',
      stockOnly: query.stockOnly === 'true',
      page: query.page,
      pageSize: query.pageSize,
      ...(query.search ? { search: query.search } : {}),
    });
    return { items: result.entries, total: result.total, page: result.page, pageSize: result.pageSize };
  });

  app.get('/companies/:companyId/items/:itemId', { config: { auth: { mode: 'company' } } }, async (request) => {
    const params = parseInput(itemParams, request.params);
    return { item: await getItem(app.db, params.companyId, params.itemId) };
  });

  app.post(
    '/companies/:companyId/items',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const item = parseInput(itemSchema, request.body);
      const created = await createItem(app.db, { ...ctx.audit, companyId, item });
      reply.code(201);
      return { item: created };
    },
  );

  app.patch(
    '/companies/:companyId/items/:itemId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(itemParams, request.params);
      const item = parseInput(itemSchema, request.body);
      return {
        item: await updateItem(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          itemId: params.itemId,
          item,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/items/:itemId/deactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(itemParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        item: await deactivateItem(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          itemId: params.itemId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/items/:itemId/reactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(itemParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        item: await reactivateItem(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          itemId: params.itemId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get('/companies/:companyId/branches', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(z.object({ includeInactive: z.enum(['true', 'false']).optional() }), request.query);
    return {
      branches: await listBranches(app.db, companyId, { includeInactive: query.includeInactive === 'true' }),
    };
  });

  app.post(
    '/companies/:companyId/branches',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const branch = parseInput(branchSchema, request.body);
      const created = await createBranch(app.db, { ...ctx.audit, companyId, branch });
      reply.code(201);
      return { branch: created };
    },
  );

  app.patch(
    '/companies/:companyId/branches/:branchId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(branchParams, request.params);
      const branch = parseInput(branchSchema, request.body);
      return {
        branch: await updateBranch(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          branchId: params.branchId,
          branch,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/branches/:branchId/deactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(branchParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        branch: await deactivateBranch(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          branchId: params.branchId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/branches/:branchId/reactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(branchParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        branch: await reactivateBranch(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          branchId: params.branchId,
          reason: body.reason,
        }),
      };
    },
  );

  app.get('/companies/:companyId/warehouses', { config: { auth: { mode: 'company' } } }, async (request) => {
    const { companyId } = parseInput(companyParams, request.params);
    const query = parseInput(
      z.object({
        includeInactive: z.enum(['true', 'false']).optional(),
        branchId: z.string().uuid().optional(),
      }),
      request.query,
    );
    return {
      warehouses: await listWarehouses(app.db, companyId, {
        includeInactive: query.includeInactive === 'true',
        ...(query.branchId ? { branchId: query.branchId } : {}),
      }),
    };
  });

  app.get(
    '/companies/:companyId/warehouses/:warehouseId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const params = parseInput(warehouseParams, request.params);
      return { warehouse: await getWarehouse(app.db, params.companyId, params.warehouseId) };
    },
  );

  app.post(
    '/companies/:companyId/warehouses',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request, reply) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const { companyId } = parseInput(companyParams, request.params);
      const warehouse = parseInput(warehouseSchema, request.body);
      const created = await createWarehouse(app.db, { ...ctx.audit, companyId, warehouse });
      reply.code(201);
      return { warehouse: created };
    },
  );

  app.patch(
    '/companies/:companyId/warehouses/:warehouseId',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(warehouseParams, request.params);
      const warehouse = parseInput(warehouseSchema, request.body);
      return {
        warehouse: await updateWarehouse(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          warehouseId: params.warehouseId,
          warehouse,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/warehouses/:warehouseId/deactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(warehouseParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        warehouse: await deactivateWarehouse(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          warehouseId: params.warehouseId,
          reason: body.reason,
        }),
      };
    },
  );

  app.post(
    '/companies/:companyId/warehouses/:warehouseId/reactivate',
    { config: { auth: { mode: 'company', permission: 'MANAGE_MASTERS_AND_COA' } } },
    async (request) => {
      const ctx = context(request);
      requireVerifiedEmail(ctx.auth);
      const params = parseInput(warehouseParams, request.params);
      const body = parseInput(reasonSchema, request.body);
      return {
        warehouse: await reactivateWarehouse(app.db, {
          ...ctx.audit,
          companyId: params.companyId,
          warehouseId: params.warehouseId,
          reason: body.reason,
        }),
      };
    },
  );
};
