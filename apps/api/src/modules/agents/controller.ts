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
  request: FastifyRequest<{ Querystring: AgentListQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  // request.user é garantido; cityScopeIds pode ser null (admin global) ou string[]
  // `as` justificado: request.user é definido pelo authenticate() e segue UserScopeCtx
  const scopeCtx = request.user as { cityScopeIds: string[] | null };
  const result = await listAgents(db, actor, request.query, scopeCtx);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents
// ---------------------------------------------------------------------------

export async function createAgentController(
  request: FastifyRequest<{ Body: AgentCreate }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createAgent(db, actor, request.body);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/agents/:id
// ---------------------------------------------------------------------------

export async function updateAgentController(
  request: FastifyRequest<{ Params: AgentIdParam; Body: AgentUpdate }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await updateAgentService(db, actor, request.params.id, request.body);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/deactivate
// ---------------------------------------------------------------------------

export async function deactivateAgentController(
  request: FastifyRequest<{ Params: AgentIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await deactivateAgentService(db, actor, request.params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/reactivate
// ---------------------------------------------------------------------------

export async function reactivateAgentController(
  request: FastifyRequest<{ Params: AgentIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await reactivateAgentService(db, actor, request.params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PUT /api/admin/agents/:id/cities
// ---------------------------------------------------------------------------

export async function setAgentCitiesController(
  request: FastifyRequest<{ Params: AgentIdParam; Body: AgentSetCities }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await setAgentCities(db, actor, request.params.id, request.body);
  return reply.status(200).send(result);
}
