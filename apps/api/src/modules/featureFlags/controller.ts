// =============================================================================
// featureFlags/controller.ts — Handlers das rotas de feature flags.
//
// Admin: GET /api/admin/feature-flags, PATCH /api/admin/feature-flags/:key
// Público autenticado: GET /api/feature-flags/me
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { emit } from '../../events/emit.js';
import { NotFoundError } from '../../shared/errors.js';
import { typedBody, typedParams } from '../../shared/fastify-types.js';

import type { PatchFeatureFlagBody } from './schemas.js';
import { getAllFlags, getMyFlags, patchFlag } from './service.js';

// ---------------------------------------------------------------------------
// GET /api/admin/feature-flags
// ---------------------------------------------------------------------------

export async function listFlagsController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const flags = await getAllFlags(db);

  const response = flags.map((f) => ({
    key: f.key,
    status: f.status,
    visible: f.visible,
    ui_label: f.uiLabel,
    description: f.description,
    audience: f.audience,
    updated_by: f.updatedBy,
    updated_at: f.updatedAt.toISOString(),
    created_at: f.createdAt.toISOString(),
  }));

  await reply.status(200).send(response);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/feature-flags/:key
// ---------------------------------------------------------------------------

export async function patchFlagController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { key } = typedParams<{ key: string }>(request);
  const body = typedBody<PatchFeatureFlagBody>(request);

  // request.user is guaranteed by authenticate() preHandler.
  // authenticate() throws UnauthorizedError before this code if request.user is absent.
  // Using optional chaining with a runtime guard instead of non-null assertion.
  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  // Fetch existing flag to capture before-state for audit event
  const flags = await getAllFlags(db);
  const existing = flags.find((f) => f.key === key);
  if (!existing) {
    throw new NotFoundError(`Feature flag não encontrada: ${key}`);
  }

  const updated = await db.transaction(async (tx) => {
    const result = await patchFlag(db, key, body, user.id);

    // TODO(F1-S16): auditLog(tx, { ... }) — adicionar quando F1-S16 for merged.
    // Por ora, emitimos o evento no outbox para rastreabilidade.

    await emit(tx, {
      eventName: 'feature_flag.changed',
      aggregateType: 'feature_flag',
      aggregateId: key,
      // Feature flags são globais — usamos a org do usuário que fez o toggle.
      organizationId: user.organizationId,
      actor: { kind: 'user', id: user.id, ip: request.ip },
      idempotencyKey: `feature_flag.changed:${key}:${Date.now()}`,
      data: {
        key,
        before: existing.status,
        after: body.status ?? existing.status,
        actor_user_id: user.id,
      },
    });

    return result;
  });

  await reply.status(200).send({
    key: updated.key,
    status: updated.status,
    visible: updated.visible,
    ui_label: updated.uiLabel,
    description: updated.description,
    audience: updated.audience,
    updated_by: updated.updatedBy,
    updated_at: updated.updatedAt.toISOString(),
    created_at: updated.createdAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// GET /api/feature-flags/me
// ---------------------------------------------------------------------------

export async function getMyFlagsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Extract role names from permissions via convention:
  // Permissions contain role-based entries like 'admin', 'superadmin'.
  // We use a pragmatic approach: check for well-known role indicators in permissions.
  // A more robust approach would store roles separately in request.user (follow-up F1-S04 extension).
  const userPerms = request.user?.permissions ?? [];

  // Derive role names from the set of known roles
  const knownRoles = ['superadmin', 'admin', 'gestor_geral', 'gestor_cidade', 'agente', 'viewer'];
  const userRoles = knownRoles.filter((r) => userPerms.includes(r) || userPerms.includes('*'));

  const myFlags = await getMyFlags(db, userRoles);

  await reply.status(200).send(myFlags);
}
