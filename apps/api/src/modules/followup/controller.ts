// =============================================================================
// followup/controller.ts — Handlers HTTP do módulo de follow-up (F5-S05).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId a partir de request.user.
//   - Chamar service correto e enviar resposta tipada.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
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
// Helper — organizationId do usuário autenticado
// ---------------------------------------------------------------------------

function getOrgId(request: FastifyRequest): string {
  if (!request.user?.organizationId) {
    // Nunca deve ocorrer se authenticate() está no preHandler
    throw new Error('organizationId ausente — authenticate() não executou');
  }
  return request.user.organizationId;
}

// ---------------------------------------------------------------------------
// GET /api/followup/rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const organizationId = getOrgId(request);
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
  const organizationId = getOrgId(request);
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
  const organizationId = getOrgId(request);
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
  const organizationId = getOrgId(request);
  const query = typedQuery<FollowupJobsListQuery>(request);
  const result = await listJobsService(db, organizationId, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/followup/jobs/:id/cancel
// ---------------------------------------------------------------------------

export async function cancelJobController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const organizationId = getOrgId(request);
  const { id } = typedParams<{ id: string }>(request);
  const result = await cancelJobService(db, organizationId, id);
  await reply.status(200).send(result);
}
