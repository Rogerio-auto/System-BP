// =============================================================================
// law-firms/controller.ts — Handlers HTTP para escritórios de advocacia (F19-S02).
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

import type {
  LawFirmCreate,
  LawFirmIdParam,
  LawFirmListQuery,
  LawFirmSuggestQuery,
  LawFirmUpdate,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createLawFirmService,
  deleteLawFirmService,
  listLawFirmsService,
  suggestLawFirmService,
  updateLawFirmService,
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
// GET /api/law-firms
// ---------------------------------------------------------------------------

export async function listLawFirmsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listLawFirmsService(db, actor, typedQuery<LawFirmListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/law-firms
// ---------------------------------------------------------------------------

export async function createLawFirmController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createLawFirmService(db, actor, typedBody<LawFirmCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/law-firms/:id
// ---------------------------------------------------------------------------

export async function updateLawFirmController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LawFirmIdParam>(request);
  const result = await updateLawFirmService(
    db,
    actor,
    params.id,
    typedBody<LawFirmUpdate>(request),
  );
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/law-firms/:id
// ---------------------------------------------------------------------------

export async function deleteLawFirmController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<LawFirmIdParam>(request);
  await deleteLawFirmService(db, actor, params.id);
  return reply.status(200).send({ ok: true });
}

// ---------------------------------------------------------------------------
// GET /api/law-firms/suggest
// ---------------------------------------------------------------------------

export async function suggestLawFirmController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const query = typedQuery<LawFirmSuggestQuery>(request);
  const result = await suggestLawFirmService(db, actor, query.customer_id);
  return reply.status(200).send(result);
}
