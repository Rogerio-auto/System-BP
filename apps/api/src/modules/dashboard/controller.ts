// =============================================================================
// dashboard/controller.ts — Handlers HTTP para os endpoints de métricas (F8-S03)
//                           e dashboard de cobrança (F15-S09).
//
// Responsabilidades:
//   - Extrair query params do request.
//   - Montar ActorContext a partir de request.user (garantido por authenticate()).
//   - Chamar o service correspondente e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() + authorize() nos
// preHandlers da rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedQuery } from '../../shared/fastify-types.js';

import type { CollectionDashboardQuery, DashboardMetricsQuery } from './schemas.js';
import type { ActorContext } from './service.js';
import { getCollectionDashboard, getDashboardMetrics } from './service.js';

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
// GET /api/dashboard/metrics
// ---------------------------------------------------------------------------

export async function getDashboardMetricsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getDashboardMetrics(db, actor, typedQuery<DashboardMetricsQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/collection
// ---------------------------------------------------------------------------

export async function getCollectionDashboardController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getCollectionDashboard(
    db,
    actor,
    typedQuery<CollectionDashboardQuery>(request),
  );
  return reply.status(200).send(result);
}
