// =============================================================================
// users/controller.ts — Handlers para rotas de gestão de usuários (F1-S07).
//
// Responsabilidades:
//   - Extrair dados do request (params, body, query, user context)
//   - Montar ActorContext a partir de request.user
//   - Chamar o service correto
//   - Enviar resposta tipada
//
// O request.user é garantidamente definido (authenticate() + authorize()
// nos preHandlers da rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';

import type {
  CreateUserBody,
  ListUsersQuery,
  SetCityScopesBody,
  SetRolesBody,
  UpdateUserBody,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createUserService,
  deactivateUserService,
  listUsers,
  reactivateUserService,
  setUserCityScopesService,
  setUserRolesService,
  updateUserService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: extrair ActorContext de request.user (garantido pelo authenticate())
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    // Nunca deve ocorrer se authenticate() está no preHandler
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, permissions } = request.user;

  // Extrair role do primeiro item de permissions para o snapshot de audit
  // Na ausência de roles explícitas no contexto, usar a primeira permissão
  // como role snapshot. O contexto completo está em permissions.
  // `as` justificado: permissions é garantidamente string[] pelo authenticate()
  const role = permissions[0] ?? 'unknown';

  return {
    userId: id,
    organizationId,
    role,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

export async function listUsersController(
  request: FastifyRequest<{ Querystring: ListUsersQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listUsers(db, actor, request.query);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/users
// ---------------------------------------------------------------------------

export async function createUserController(
  request: FastifyRequest<{ Body: CreateUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createUserService(db, actor, request.body);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id
// ---------------------------------------------------------------------------

export async function updateUserController(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await updateUserService(db, actor, request.params.id, request.body);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/deactivate
// ---------------------------------------------------------------------------

export async function deactivateUserController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  await deactivateUserService(db, actor, request.params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/reactivate
// ---------------------------------------------------------------------------

export async function reactivateUserController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  await reactivateUserService(db, actor, request.params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/roles
// ---------------------------------------------------------------------------

export async function setUserRolesController(
  request: FastifyRequest<{ Params: { id: string }; Body: SetRolesBody }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  await setUserRolesService(db, actor, request.params.id, request.body);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/city-scopes
// ---------------------------------------------------------------------------

export async function setUserCityScopesController(
  request: FastifyRequest<{ Params: { id: string }; Body: SetCityScopesBody }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  await setUserCityScopesService(db, actor, request.params.id, request.body);
  return reply.status(204).send();
}
