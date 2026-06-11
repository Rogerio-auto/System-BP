// =============================================================================
// simulations/controller.ts — Handlers HTTP para o módulo de simulações.
//
// Handlers:
//   createSimulationController — POST /api/simulations (F2-S04)
//   sendSimulationController   — POST /api/simulations/:id/send (F14-S05)
//
// Responsabilidades:
//   - Extrair parâmetros do request (validados pelo Zod schema na rota).
//   - Montar SimulationActorContext a partir de request.user.
//   - Delegar ao service.
//   - Retornar resposta com status correto.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
//
// LGPD: body só contém IDs + números — nenhum campo PII.
//       request.log não loga body.* (pino.redact cobre body.* como medida extra).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody } from '../../shared/fastify-types.js';

import type { SimulationCreate } from './schemas.js';
import type { SimulationActorContext } from './service.js';
import { createSimulation, sendSimulation } from './service.js';

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
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);

  const result = await createSimulation(db, actor, typedBody<SimulationCreate>(request), {
    origin: 'manual',
    idempotencyKey: null,
  });

  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/simulations/:id/send (F14-S05)
// ---------------------------------------------------------------------------

/**
 * Controller do endpoint POST /api/simulations/:id/send.
 *
 * Extrai o Idempotency-Key do header (obrigatório) e delega ao service.
 * A feature flag e RBAC já foram verificados pelos preHandlers na rota.
 *
 * LGPD: params.id é UUID opaco — não é PII. O header Idempotency-Key é UUID.
 *
 * Nota de tipagem: `request.params` e `request.headers` são tipados via Zod schema
 * declarado na rota, mas o controller recebe FastifyRequest genérico (sem
 * TypeProvider) para compatibilidade com o sistema de rotas ZodTypeProvider.
 * Os `as` abaixo são justificados: Zod validou os campos antes de chegar aqui.
 */
export async function sendSimulationController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const actor = getActorContext(request);

  // `as` justificado: Zod schema da rota garante que params.id é UUID string
  const params = request.params as { id: string };
  const simulationId = params.id;

  // `as` justificado: Zod schema da rota garante que idempotency-key é UUID string
  const idempotencyKey = (request.headers as Record<string, string | undefined>)[
    'idempotency-key'
  ] as string;

  const result = await sendSimulation(db, actor, simulationId, { idempotencyKey });

  return reply.status(200).send(result);
}
