// =============================================================================
// customers/law-firm-referral.controller.ts — Handlers HTTP para encaminhamento
// de clientes para advocacia (F19-S03).
//
// Responsabilidades:
//   - postCreateReferralController: POST /api/customers/:id/law-firm-referral
//     * Extrai contexto do usuário autenticado (request.user).
//     * Delega ao service e retorna 201.
//   - postCreateAiReferralController: POST /internal/customers/:id/law-firm-referral
//     * Extrai organizationId do header X-Organization-Id.
//     * Usa correlation_id como identificador de conversa para ai_decision_logs.
//     * Delega ao service e retorna 201.
//
// LGPD: controller não acessa nem loga PII do customer.
//   Toda serialização segura é feita no service (outbox sem PII).
//   UnauthorizedError lançada antes de qualquer acesso a dados.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { AppError, UnauthorizedError } from '../../shared/errors.js';
import { typedParams } from '../../shared/fastify-types.js';

import type {
  CustomerReferralParams,
  CreateReferralBody,
  CreateAiReferralBody,
} from './law-firm-referral.schemas.js';
import {
  checkLawFirmStatusService,
  createAiReferralService,
  createReferralService,
} from './law-firm-referral.service.js';

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

// ---------------------------------------------------------------------------
// POST /internal/customers/:id/law-firm-referral (canal IA)
// ---------------------------------------------------------------------------

/**
 * Handler para criação de encaminhamento pelo LangGraph (canal IA).
 *
 * Autenticado via X-Internal-Token (verificado na rota antes deste controller).
 * Usa X-Organization-Id para isolamento multi-tenant (regra inviolável #3).
 * correlationId é o X-Correlation-Id do header (ou UUID gerado se ausente).
 */
export async function postCreateAiReferralController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // X-Organization-Id obrigatório para multi-tenant
  const orgHeader = request.headers['x-organization-id'];
  if (typeof orgHeader !== 'string' || orgHeader.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Header X-Organization-Id obrigatório para escopo multi-tenant (regra inviolável #3).',
    );
  }

  const { id: customerId } = typedParams<CustomerReferralParams>(request);
  // `as` justificado: Fastify com ZodTypeProvider garante o tipo do body após validação.
  const body = request.body as CreateAiReferralBody;

  // correlationId: X-Correlation-Id do header, ou gerar um novo UUID
  const corrHeader = request.headers['x-correlation-id'];
  const correlationId =
    typeof corrHeader === 'string' && corrHeader.trim() !== '' ? corrHeader : crypto.randomUUID();

  const result = await createAiReferralService(
    db,
    customerId,
    body.law_firm_id,
    orgHeader,
    correlationId,
  );

  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /internal/law-firm-status (verificação de elegibilidade para o LangGraph)
// ---------------------------------------------------------------------------

/**
 * Handler para verificação de elegibilidade de encaminhamento.
 *
 * Autenticado via X-Internal-Token (verificado na rota antes deste controller).
 * Usa X-Organization-Id para isolamento multi-tenant.
 *
 * LGPD: resposta NÃO contém PII do customer.
 */
export async function getLawFirmStatusController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // X-Organization-Id obrigatório para multi-tenant
  const orgHeader = request.headers['x-organization-id'];
  if (typeof orgHeader !== 'string' || orgHeader.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Header X-Organization-Id obrigatório para escopo multi-tenant (regra inviolável #3).',
    );
  }

  // `as` justificado: Fastify com ZodTypeProvider garante o tipo do query após validação.
  const query = request.query as { customer_id: string };

  const result = await checkLawFirmStatusService(db, query.customer_id, orgHeader);

  await reply.status(200).send(result);
}
