// =============================================================================
// agents/controller.ts — Handlers HTTP para o módulo de agentes (F8-S01).
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext e UserScopeCtx a partir de request.user.
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  AgentCreate,
  AgentIdParam,
  AgentListQuery,
  AgentSetCities,
  AgentUpdate,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createAgent,
  deactivateAgentService,
  listAgents,
  reactivateAgentService,
  setAgentCities,
  updateAgentService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: contextos de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }
  return {
    userId: request.user.id,
    organizationId: request.user.organizationId,
    role: 'admin',
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/agents
// ---------------------------------------------------------------------------

export async function listAgentsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  // request.user é garantido; cityScopeIds pode ser null (admin global) ou string[]
  // `as` justificado: request.user é definido pelo authenticate() e segue UserScopeCtx
  const scopeCtx = request.user as { cityScopeIds: string[] | null };
  const result = await listAgents(db, actor, typedQuery<AgentListQuery>(request), scopeCtx);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents
// ---------------------------------------------------------------------------

export async function createAgentController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createAgent(db, actor, typedBody<AgentCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/agents/:id
// ---------------------------------------------------------------------------

export async function updateAgentController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<AgentIdParam>(request);
  const result = await updateAgentService(db, actor, params.id, typedBody<AgentUpdate>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/deactivate
// ---------------------------------------------------------------------------

export async function deactivateAgentController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<AgentIdParam>(request);
  const result = await deactivateAgentService(db, actor, params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/reactivate
// ---------------------------------------------------------------------------

export async function reactivateAgentController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<AgentIdParam>(request);
  const result = await reactivateAgentService(db, actor, params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PUT /api/admin/agents/:id/cities
// ---------------------------------------------------------------------------

export async function setAgentCitiesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<AgentIdParam>(request);
  const result = await setAgentCities(db, actor, params.id, typedBody<AgentSetCities>(request));
  return reply.status(200).send(result);
}
