// =============================================================================
// followup/controller.ts — Handlers HTTP do módulo de follow-up (F5-S05).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + cityScopeIds a partir de request.user.
//   - Chamar service correto e enviar resposta tipada.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { FollowupJobsListQuery, FollowupRuleCreate, FollowupRuleUpdate } from './schemas.js';
import {
  cancelJobService,
  createRuleService,
  listJobsService,
  listRulesService,
  updateRuleService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  cityScopeIds: string[] | null;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId) {
    // Nunca deve ocorrer se authenticate() está no preHandler
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/followup/rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const result = await listRulesService(db, organizationId);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/followup/rules
// ---------------------------------------------------------------------------

export async function createRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const body = typedBody<FollowupRuleCreate>(request);
  const result = await createRuleService(db, organizationId, body);
  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/followup/rules/:id
// ---------------------------------------------------------------------------

export async function updateRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const body = typedBody<FollowupRuleUpdate>(request);
  const result = await updateRuleService(db, organizationId, id, body);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/followup/jobs
// ---------------------------------------------------------------------------

export async function listJobsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<FollowupJobsListQuery>(request);
  const result = await listJobsService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/followup/jobs/:id/cancel
// ---------------------------------------------------------------------------

export async function cancelJobController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const result = await cancelJobService(db, organizationId, cityScopeIds, id);
  await reply.status(200).send(result);
}
