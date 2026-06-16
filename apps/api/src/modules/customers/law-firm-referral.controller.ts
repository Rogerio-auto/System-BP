// =============================================================================
// customers/law-firm-referral.controller.ts — Handler HTTP para encaminhamento
// de clientes para advocacia — canal humano (F19-S03).
//
// Responsabilidades:
//   - postCreateReferralController: POST /api/customers/:id/law-firm-referral
//     * Extrai contexto do usuário autenticado (request.user).
//     * Delega ao service e retorna 201.
//
// Nota: handlers do canal IA (/internal/*) estão em
//   modules/internal/law-firm-status/routes.ts (inline, M2M sem JWT).
//
// LGPD: controller não acessa nem loga PII do customer.
//   Toda serialização segura é feita no service (outbox sem PII).
//   UnauthorizedError lançada antes de qualquer acesso a dados.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedParams } from '../../shared/fastify-types.js';

import type { CustomerReferralParams, CreateReferralBody } from './law-firm-referral.schemas.js';
import { createReferralService } from './law-firm-referral.service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  userId: string;
  /**
   * Role do usuário para audit_log.
   * request.user não expõe role (ver fastify.d.ts) — usamos 'user' como
   * valor padrão para o audit_log. O RBAC já foi verificado por authorize().
   */
  role: string;
  cityScopeIds: string[] | null;
  ip: string | null;
  userAgent: string | null;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    userId: request.user.id,
    // `role` não está em request.user (fastify.d.ts não expõe).
    // RBAC já verificado por authorize() — 'user' é adequado para o audit_log.
    role: 'user',
    cityScopeIds: request.user.cityScopeIds ?? null,
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/customers/:id/law-firm-referral (canal humano)
// ---------------------------------------------------------------------------

/**
 * Handler para criação de encaminhamento humano.
 *
 * request.user é garantido por authenticate() no preHandler da rota.
 * RBAC (law_firms:referral) é verificado por authorize() no preHandler.
 */
export async function postCreateReferralController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ctx = getUserContext(request);
  const { id: customerId } = typedParams<CustomerReferralParams>(request);
  // `as` justificado: Fastify com ZodTypeProvider garante o tipo do body após validação.
  const body = request.body as CreateReferralBody;

  const result = await createReferralService(
    db,
    {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: ctx.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    customerId,
    body,
  );

  await reply.status(201).send(result);
}
