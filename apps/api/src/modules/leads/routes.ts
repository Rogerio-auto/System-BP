// =============================================================================
// leads/routes.ts — Rotas do CRM de leads (F1-S11).
//
// Todas as rotas exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize(opts): verifica permissão RBAC por rota
//
// Permissões usadas:
//   - leads:read   — listagem e detalhe
//   - leads:write  — create, update, delete, restore
//
// City scope é aplicado automaticamente pelo service/repository com base em
// request.user.cityScopeIds (null = admin global, string[] = cidades do agente).
//
// LGPD: respostas nunca incluem cpf_encrypted, cpf_hash, phone_normalized.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createLeadController,
  deleteLeadController,
  getLeadController,
  listLeadsController,
  restoreLeadController,
  updateLeadController,
} from './controller.js';
import {
  LeadCreateSchema,
  LeadListQuerySchema,
  LeadListResponseSchema,
  LeadResponseSchema,
  LeadUpdateSchema,
  leadIdParamSchema,
} from './schemas.js';

export const leadsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/leads — lista paginada com filtros e city scope
  // ---------------------------------------------------------------------------
  app.get(
    '/api/leads',
    {
      schema: {
        querystring: LeadListQuerySchema,
        response: {
          200: LeadListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['leads:read'] })],
    },
    listLeadsController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/leads/:id — detalhe de um lead
  // ---------------------------------------------------------------------------
  app.get(
    '/api/leads/:id',
    {
      schema: {
        params: leadIdParamSchema,
        response: {
          200: LeadResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['leads:read'] })],
    },
    getLeadController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/leads — criar lead (com dedupe por phone)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/leads',
    {
      schema: {
        body: LeadCreateSchema,
        response: {
          201: LeadResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['leads:write'] })],
    },
    createLeadController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/leads/:id — update parcial com audit before/after
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/leads/:id',
    {
      schema: {
        params: leadIdParamSchema,
        body: LeadUpdateSchema,
        response: {
          200: LeadResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['leads:write'] })],
    },
    updateLeadController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/leads/:id — soft delete
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/leads/:id',
    {
      schema: {
        params: leadIdParamSchema,
        response: {
          204: z.void(),
        },
      },
      preHandler: [authorize({ permissions: ['leads:write'] })],
    },
    deleteLeadController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/leads/:id/restore — desfaz soft delete
  // ---------------------------------------------------------------------------
  app.post(
    '/api/leads/:id/restore',
    {
      schema: {
        params: leadIdParamSchema,
        response: {
          200: LeadResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['leads:write'] })],
    },
    restoreLeadController,
  );
};
