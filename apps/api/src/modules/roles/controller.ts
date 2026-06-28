// =============================================================================
// roles/controller.ts — Handlers para rotas de papéis & permissões.
//
// Responsabilidades:
//   - Extrair dados do request (params, body, user context)
//   - Montar ActorContext a partir de request.user
//   - Delegar ao service correto
//   - Enviar resposta tipada
//
// request.user é garantidamente definido após authenticate() + authorize().
//
// Nota de tipos: controllers usam `request: FastifyRequest` (broad) e extraem
// params/body via typedBody/typedParams. Isso evita incompatibilidade entre
// FastifyTypeProviderDefault e ZodTypeProvider — ver shared/fastify-types.ts.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams } from '../../shared/fastify-types.js';

import type { RoleIdParam, UpdateRolePermissionsBody } from './schemas.js';
import {
  listPermissions,
  listRoles,
  updateRolePermissionsService,
  type ActorContext,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: extrair ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    // Nunca deve ocorrer se authenticate() está no preHandler
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, permissions } = request.user;

  // Snapshot da role para audit: usa a primeira permissão como identificador
  // quando não há campo role explícito no JWT (padrão do projeto).
  const role = permissions[0] ?? 'unknown';

  return {
    userId: id,
    organizationId,
    role,
    permissions,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/permissions
// ---------------------------------------------------------------------------

export async function listPermissionsController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await listPermissions(db);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/admin/roles
// ---------------------------------------------------------------------------

export async function listRolesController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await listRoles(db);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PUT /api/admin/roles/:id/permissions
// ---------------------------------------------------------------------------

export async function updateRolePermissionsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  // typedParams/typedBody: Zod valida antes do handler ser chamado (ver fastify-types.ts)
  const { id } = typedParams<RoleIdParam>(request);
  const body = typedBody<UpdateRolePermissionsBody>(request);
  const result = await updateRolePermissionsService(db, actor, id, body);
  return reply.status(200).send(result);
}
