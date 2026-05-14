// =============================================================================
// simulations/controller.ts — Handler HTTP para POST /api/simulations (F2-S04).
//
// Responsabilidades:
//   - Extrair body do request (validado pelo Zod schema na rota).
//   - Montar SimulationActorContext a partir de request.user.
//   - Delegar ao createSimulation() do service.
//   - Retornar 201 com a simulação completa.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
//
// LGPD: body só contém IDs + números — nenhum campo PII.
//       request.log não loga body.* (pino.redact cobre body.* como medida extra).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';

import type { SimulationCreate } from './schemas.js';
import type { SimulationActorContext } from './service.js';
import { createSimulation } from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): SimulationActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  return {
    userId: request.user.id,
    organizationId: request.user.organizationId,
    role: 'agent', // Role resolvida pelo RBAC — granularidade relevante para audit
    cityScopeIds: request.user.cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/simulations
// ---------------------------------------------------------------------------

export async function createSimulationController(
  request: FastifyRequest<{ Body: SimulationCreate }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);

  const result = await createSimulation(db, actor, request.body, {
    origin: 'manual',
    idempotencyKey: null,
  });

  return reply.status(201).send(result);
}
