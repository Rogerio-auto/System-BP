// =============================================================================
// channels/controller.ts — Handlers HTTP para o módulo de canais (F16-S11).
//
// Responsabilidades:
//   - Extrair body/params/query do request.
//   - Montar ActorContext a partir de request.user (garantido por authenticate()).
//   - Chamar o service correto e enviar resposta tipada.
//
// LGPD: nenhum campo sensível (token, appSecret, phoneNumber) é logado aqui.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  ChannelIdParam,
  ChannelListQuery,
  ConnectChannelBody,
  SetDefaultChannelParam,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  connectChannelService,
  deleteChannelService,
  listChannelsService,
  setDefaultChannelService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    // Não deve ocorrer se authenticate() está no preHandler
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
// POST /api/channels/connect
// ---------------------------------------------------------------------------

export async function connectChannelController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<ConnectChannelBody>(request);
  const result = await connectChannelService(db, actor, body);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/channels
// ---------------------------------------------------------------------------

export async function listChannelsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const query = typedQuery<ChannelListQuery>(request);
  const result = await listChannelsService(db, actor, query);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/channels/:id
// ---------------------------------------------------------------------------

export async function deleteChannelController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ChannelIdParam>(request);
  await deleteChannelService(db, actor, params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// PATCH /api/channels/:id/default
// ---------------------------------------------------------------------------

export async function setDefaultChannelController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<SetDefaultChannelParam>(request);
  const result = await setDefaultChannelService(db, actor, params.id);
  return reply.status(200).send(result);
}
