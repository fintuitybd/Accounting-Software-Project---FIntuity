import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { parseInput } from '../validation.ts';
import { getAuth } from '../auth/context.ts';
import { truncateUserAgent } from '../auth/tokens.ts';
import {
  createEmployee,
  updateEmployee,
  listEmployees,
  getEmployee,
  computeOrSavePayrollDraft,
  approvePayrollRun,
  postPayrollRun,
  disbursePayrollRun,
  listPayrollRuns,
  getPayrollRun,
  exportBeftn128,
  exportBeftnCsv,
  exportMfsCsv,
  WORKER_CLASSIFICATIONS,
  PAYMENT_CHANNELS,
} from '../payroll/payrollService.ts';

const companyParams = z.object({
  companyId: z.string().uuid(),
});

const employeeParams = z.object({
  companyId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

const runParams = z.object({
  companyId: z.string().uuid(),
  runId: z.string().uuid(),
});

const listEmployeesQuery = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
  branchId: z.string().uuid().optional(),
});

const createEmployeeSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  employeeCode: z.string().trim().min(1).max(30),
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).optional().nullable(),
  workerClassification: z.enum(WORKER_CLASSIFICATIONS),
  nidNumber: z.string().trim().max(50).optional().nullable(),
  etin: z.string().trim().max(50).optional().nullable(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basicSalaryPoisha: z.string().regex(/^\d+$/).transform(BigInt),
  hraPoisha: z.string().regex(/^\d+$/).transform(BigInt),
  medicalPoisha: z.string().regex(/^\d+$/).transform(BigInt),
  conveyancePoisha: z.string().regex(/^\d+$/).transform(BigInt),
  pfEnrolled: z.boolean().optional(),
  pfRateBps: z.number().int().min(0).max(5000).optional(),
  paymentChannel: z.enum(PAYMENT_CHANNELS).optional(),
  bankName: z.string().trim().max(100).optional().nullable(),
  bankAccountNumber: z.string().trim().max(50).optional().nullable(),
  bankRoutingNumber: z.string().trim().max(50).optional().nullable(),
  mfsNumber: z.string().trim().max(30).optional().nullable(),
});

const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
});

const computePayrollSchema = z.object({
  periodId: z.string().uuid(),
  batchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeFestivalBonus: z.boolean().optional(),
  adjustments: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        otHoursScaled: z.number().int().min(0).optional(),
        festivalBonusPoisha: z.string().regex(/^\d+$/).transform(BigInt).optional(),
        tdsPoisha: z.string().regex(/^\d+$/).transform(BigInt).optional(),
      }),
    )
    .optional(),
});

function context(request: Parameters<typeof getAuth>[0]) {
  const auth = getAuth(request);
  const company = auth.company;
  if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  return {
    auth,
    company,
    audit: {
      organisationId: company.organisationId,
      companyId: company.id,
      actorUserId: auth.user.id,
      userId: auth.user.id,
      sessionId: auth.session.id,
      clientIp: request.ip,
      userAgent: truncateUserAgent(request.headers['user-agent']),
    },
  };
}

export const payrollRoutes: FastifyPluginAsync = async (app) => {
  // 1. List Employees
  app.get(
    '/companies/:companyId/payroll/employees',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const query = parseInput(listEmployeesQuery, request.query);
      const employees = await listEmployees(app.db, companyId, query);
      return { employees };
    },
  );

  // 2. Get Employee
  app.get(
    '/companies/:companyId/payroll/employees/:employeeId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, employeeId } = parseInput(employeeParams, request.params);
      const employee = await getEmployee(app.db, companyId, employeeId);
      if (!employee) throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee was not found.');
      return { employee };
    },
  );

  // 3. Create Employee
  app.post(
    '/companies/:companyId/payroll/employees',
    { config: { auth: { mode: 'company' } } },
    async (request, reply) => {
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(createEmployeeSchema, request.body);
      const { audit } = context(request);

      const employee = await createEmployee(app.db, {
        companyId,
        userId: audit.userId,
        ...body,
      });

      reply.status(201);
      return { employee };
    },
  );

  // 4. Update Employee
  const handleUpdateEmployee = async (request: any) => {
    const { companyId, employeeId } = parseInput(employeeParams, request.params);
    const body = parseInput(updateEmployeeSchema, request.body);
    const { audit } = context(request);

    const employee = await updateEmployee(app.db, {
      id: employeeId,
      companyId,
      userId: audit.userId,
      ...body,
    });

    return { employee };
  };

  app.put(
    '/companies/:companyId/payroll/employees/:employeeId',
    { config: { auth: { mode: 'company' } } },
    handleUpdateEmployee,
  );
  app.patch(
    '/companies/:companyId/payroll/employees/:employeeId',
    { config: { auth: { mode: 'company' } } },
    handleUpdateEmployee,
  );

  // 5. List Payroll Runs
  app.get(
    '/companies/:companyId/payroll/runs',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId } = parseInput(companyParams, request.params);
      const runs = await listPayrollRuns(app.db, companyId);
      return { runs };
    },
  );

  // 6. Get Payroll Run
  app.get(
    '/companies/:companyId/payroll/runs/:runId',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const run = await getPayrollRun(app.db, companyId, runId);
      if (!run) throw new AppError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run was not found.');
      return { run };
    },
  );

  // 7. Compute or Save Payroll Draft
  app.post(
    '/companies/:companyId/payroll/runs',
    { config: { auth: { mode: 'company' } } },
    async (request, reply) => {
      const { companyId } = parseInput(companyParams, request.params);
      const body = parseInput(computePayrollSchema, request.body);
      const { audit } = context(request);

      const run = await computeOrSavePayrollDraft(app.db, {
        companyId,
        userId: audit.userId,
        periodId: body.periodId,
        batchDate: body.batchDate,
        includeFestivalBonus: body.includeFestivalBonus,
        adjustments: body.adjustments,
      });

      reply.status(201);
      return { run };
    },
  );

  // 8. Approve Payroll Run (Maker-Checker)
  app.post(
    '/companies/:companyId/payroll/runs/:runId/approve',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const { audit } = context(request);

      const run = await approvePayrollRun(app.db, {
        companyId,
        runId,
        userId: audit.userId,
      });

      return { run };
    },
  );

  // 9. Post Payroll Run to GL (Atomic Journal Posting)
  app.post(
    '/companies/:companyId/payroll/runs/:runId/post',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const { audit } = context(request);

      const result = await postPayrollRun(app.db, {
        companyId,
        runId,
        userId: audit.userId,
        sessionId: audit.sessionId,
        ip: audit.clientIp,
        userAgent: audit.userAgent,
        requestId: request.id,
      });

      return result;
    },
  );

  // 10. Mark Payroll Run Disbursed
  app.post(
    '/companies/:companyId/payroll/runs/:runId/disburse',
    { config: { auth: { mode: 'company' } } },
    async (request) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const { audit } = context(request);

      const run = await disbursePayrollRun(app.db, {
        companyId,
        runId,
        userId: audit.userId,
      });

      return { run };
    },
  );

  // 11. Export BEFTN 128-column format
  app.get(
    '/companies/:companyId/payroll/runs/:runId/export/beftn-128',
    { config: { auth: { mode: 'company' } } },
    async (request, reply) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const { filename, content } = await exportBeftn128(app.db, companyId, runId);

      reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    },
  );

  // 12. Export BEFTN CSV
  app.get(
    '/companies/:companyId/payroll/runs/:runId/export/beftn-csv',
    { config: { auth: { mode: 'company' } } },
    async (request, reply) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const { filename, content } = await exportBeftnCsv(app.db, companyId, runId);

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    },
  );

  // 13. Export MFS CSV (bKash / Nagad)
  app.get(
    '/companies/:companyId/payroll/runs/:runId/export/mfs-csv',
    { config: { auth: { mode: 'company' } } },
    async (request, reply) => {
      const { companyId, runId } = parseInput(runParams, request.params);
      const query = parseInput(
        z.object({ provider: z.enum(['BKASH', 'NAGAD']).default('BKASH') }),
        request.query,
      );
      const { filename, content } = await exportMfsCsv(app.db, companyId, runId, query.provider);

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    },
  );
};
