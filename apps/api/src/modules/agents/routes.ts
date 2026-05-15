// =============================================================================
// agents/routes.ts — Rotas admin do módulo de agentes de crédito (F8-S01).
//
// Todos os endpoints exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize({ permissions: ['agents:admin'] }): acesso restrito a admin
//
// Prefixo: /api/admin/agents
//
// Endpoints:
//   GET    /api/admin/agents           — lista paginada com filtros
//   POST   /api/admin/agents           — criar agente + vínculos de cidade
//   PATCH  /api/admin/agents/:id       — atualizar campos
//   POST   /api/admin/agents/:id/deactivate — soft-delete
//   POST   /api/admin/agents/:id/reactivate — reativar
//   PUT    /api/admin/agents/:id/cities     — substituir cidades atomicamente
//
// LGPD: phone é dado de colaborador (não de cidadão). display_name é nome
//   de trabalho interno. Não exposto ao lead/cliente.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createAgentController,
  deactivateAgentController,
  listAgentsController,
  reactivateAgentController,
  setAgentCitiesController,
  updateAgentController,
} from './controller.js';
import {
  AgentCreateSchema,
  AgentListQuerySchema,
  AgentListResponseSchema,
  AgentResponseSchema,
  AgentSetCitiesSchema,
  AgentUpdateSchema,
  agentIdParamSchema,
} from './schemas.js';

const AGENTS_ADMIN: [string, ...string[]] = ['agents:admin'];

export const agentsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/admin/agents — lista paginada com filtros
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/agents',
    {
      schema: {
        querystring: AgentListQuerySchema,
        response: {
          200: AgentListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    listAgentsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/agents — cria agente com vínculos de cidade
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/agents',
    {
      schema: {
        body: AgentCreateSchema,
        response: {
          201: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    createAgentController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/agents/:id — atualiza displayName, phone, userId, isActive
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/admin/agents/:id',
    {
      schema: {
        params: agentIdParamSchema,
        body: AgentUpdateSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    updateAgentController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/agents/:id/deactivate — soft-delete (preserva leads)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/agents/:id/deactivate',
    {
      schema: {
        params: agentIdParamSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    deactivateAgentController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/agents/:id/reactivate — reativa agente desativado
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/agents/:id/reactivate',
    {
      schema: {
        params: agentIdParamSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    reactivateAgentController,
  );

  // ---------------------------------------------------------------------------
  // PUT /api/admin/agents/:id/cities — substitui agent_cities atomicamente
  // ---------------------------------------------------------------------------
  app.put(
    '/api/admin/agents/:id/cities',
    {
      schema: {
        params: agentIdParamSchema,
        body: AgentSetCitiesSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_ADMIN })],
    },
    setAgentCitiesController,
  );
};
