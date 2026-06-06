// =============================================================================
// agents/routes.ts — Rotas admin do módulo de agentes de crédito (F8-S01).
//
// Todos os endpoints exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize({ permissions: ['agents:manage'] }): acesso restrito a gestores
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

const AGENTS_MANAGE: [string, ...string[]] = ['agents:manage'];

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
        tags: ['Agents'],
        summary: 'Listar agentes',
        description:
          'Lista agentes de credito com paginacao e filtros. Requer permissao agents:manage.',
        security: [{ bearerAuth: [] }],
        querystring: AgentListQuerySchema,
        response: {
          200: AgentListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
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
        tags: ['Agents'],
        summary: 'Criar agente',
        description:
          'Cria um agente de credito com vinculos de cidade. Requer permissao agents:manage.',
        security: [{ bearerAuth: [] }],
        body: AgentCreateSchema,
        response: {
          201: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
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
        tags: ['Agents'],
        summary: 'Atualizar agente',
        description: 'Atualiza dados de um agente. Requer permissao agents:manage.',
        security: [{ bearerAuth: [] }],
        params: agentIdParamSchema,
        body: AgentUpdateSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
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
        tags: ['Agents'],
        summary: 'Desativar agente',
        description: 'Desativa um agente. Requer permissao agents:manage.',
        security: [{ bearerAuth: [] }],
        params: agentIdParamSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
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
        tags: ['Agents'],
        summary: 'Reativar agente',
        description: 'Reativa um agente desativado. Requer permissao agents:manage.',
        security: [{ bearerAuth: [] }],
        params: agentIdParamSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
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
        tags: ['Agents'],
        summary: 'Definir cidades do agente',
        description: 'Substitui atomicamente as cidades atribuidas a um agente.',
        security: [{ bearerAuth: [] }],
        params: agentIdParamSchema,
        body: AgentSetCitiesSchema,
        response: {
          200: AgentResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: AGENTS_MANAGE })],
    },
    setAgentCitiesController,
  );
};
