// =============================================================================
// leads/controller.ts — Handlers HTTP para o domínio de leads (F1-S11).
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext a partir de request.user (garantido por authenticate()).
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() + authorize() nos
// preHandlers de cada rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { LeadCreate, LeadIdParam, LeadListQuery, LeadUpdate } from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createLead,
  deleteLeadService,
  getLeadById,
  listLeads,
  restoreLeadService,
  updateLeadService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    // Nunca deve ocorrer se authenticate() está no preHandler
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, permissions, cityScopeIds } = request.user;

  // Snapshot de role para o audit log — usa a primeira permissão se roles ausentes
  const role = permissions[0] ?? 'unknown';

  return {
    userId: id,
    organizationId,
    role,
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/leads
// ---------------------------------------------------------------------------

export async function listLeadsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listLeads(db, actor, typedQuery<LeadListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/leads/:id
// ---------------------------------------------------------------------------

export async function getLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LeadIdParam>(request);
  const result = await getLeadById(db, actor, params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------

export async function createLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createLead(db, actor, typedBody<LeadCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/leads/:id
// ---------------------------------------------------------------------------

export async function updateLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LeadIdParam>(request);
  const result = await updateLeadService(db, actor, params.id, typedBody<LeadUpdate>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/leads/:id
// ---------------------------------------------------------------------------

export async function deleteLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LeadIdParam>(request);
  await deleteLeadService(db, actor, params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// POST /api/leads/:id/restore
// ---------------------------------------------------------------------------

export async function restoreLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LeadIdParam>(request);
  const result = await restoreLeadService(db, actor, params.id);
  return reply.status(200).send(result);
}
