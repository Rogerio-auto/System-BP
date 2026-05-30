// =============================================================================
// billing/routes.ts — Rotas do módulo de cobrança (F5-S08).
//
// Rotas:
//   GET    /api/billing/payment-dues              (billing:read)
//   POST   /api/billing/payment-dues/:id/mark-paid  (billing:mark_paid)
//   POST   /api/billing/payment-dues/:id/renegotiate (billing:mark_paid)
//   GET    /api/billing/rules                     (billing:read)
//   POST   /api/billing/rules                     (billing:write)
//   PATCH  /api/billing/rules/:id                 (billing:write)
//   GET    /api/billing/jobs                      (billing:read)
//   POST   /api/billing/jobs/:id/cancel           (billing:cancel_job)
//
// RBAC:
//   - billing:read       → listagem de dues + rules + jobs.
//   - billing:write      → criação e edição de rules.
//   - billing:mark_paid  → marcar pago/renegociado.
//   - billing:cancel_job → cancelamento manual de job agendado.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  cancelJobController,
  createRuleController,
  listDuesController,
  listJobsController,
  listRulesController,
  markPaidController,
  renegotiateController,
  updateRuleController,
} from './controller.js';
import {
  CollectionJobResponseSchema,
  CollectionJobsListQuerySchema,
  CollectionJobsListResponseSchema,
  CollectionRuleCreateSchema,
  CollectionRuleResponseSchema,
  CollectionRulesListResponseSchema,
  CollectionRuleUpdateSchema,
  MarkPaidBodySchema,
  PaymentDueResponseSchema,
  PaymentDuesListQuerySchema,
  PaymentDuesListResponseSchema,
  RenegotiateBodySchema,
  dueIdParamSchema,
  jobIdParamSchema,
  ruleIdParamSchema,
} from './schemas.js';

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/billing/payment-dues
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/payment-dues',
    {
      schema: {
        querystring: PaymentDuesListQuerySchema,
        response: {
          200: PaymentDuesListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listDuesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/payment-dues/:id/mark-paid
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/payment-dues/:id/mark-paid',
    {
      schema: {
        params: dueIdParamSchema,
        body: MarkPaidBodySchema,
        response: {
          200: PaymentDueResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:mark_paid'] })],
    },
    markPaidController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/payment-dues/:id/renegotiate
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/payment-dues/:id/renegotiate',
    {
      schema: {
        params: dueIdParamSchema,
        body: RenegotiateBodySchema,
        response: {
          200: PaymentDueResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:mark_paid'] })],
    },
    renegotiateController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/billing/rules
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/rules',
    {
      schema: {
        response: {
          200: CollectionRulesListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listRulesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/rules
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/rules',
    {
      schema: {
        body: CollectionRuleCreateSchema,
        response: {
          201: CollectionRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:write'] })],
    },
    createRuleController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/billing/rules/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/billing/rules/:id',
    {
      schema: {
        params: ruleIdParamSchema,
        body: CollectionRuleUpdateSchema,
        response: {
          200: CollectionRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:write'] })],
    },
    updateRuleController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/billing/jobs
  // ---------------------------------------------------------------------------
  app.get(
    '/api/billing/jobs',
    {
      schema: {
        querystring: CollectionJobsListQuerySchema,
        response: {
          200: CollectionJobsListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:read'] })],
    },
    listJobsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/billing/jobs/:id/cancel
  // ---------------------------------------------------------------------------
  app.post(
    '/api/billing/jobs/:id/cancel',
    {
      schema: {
        params: jobIdParamSchema,
        response: {
          200: CollectionJobResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['billing:cancel_job'] })],
    },
    cancelJobController,
  );
};
