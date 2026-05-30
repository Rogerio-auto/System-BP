// =============================================================================
// billing/controller.ts — Handlers HTTP do módulo de cobrança (F5-S08).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + cityScopeIds + actor a partir de request.user.
//   - Idempotência via Idempotency-Key header em POST de mark-paid e renegotiate.
//   - Chamar service correto e enviar resposta tipada.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { AppError, UnauthorizedError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  CollectionJobsListQuery,
  CollectionRuleCreate,
  CollectionRuleUpdate,
  MarkPaidBody,
  PaymentDuesListQuery,
  RenegotiateBody,
} from './schemas.js';
import {
  cancelJobService,
  createRuleService,
  listDuesService,
  listJobsService,
  listRulesService,
  markPaidService,
  renegotiateService,
  updateRuleService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  cityScopeIds: string[] | null;
  userId: string;
  ip: string | null;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds ?? null,
    userId: request.user.id,
    ip: request.ip ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/billing/payment-dues
// ---------------------------------------------------------------------------

export async function listDuesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<PaymentDuesListQuery>(request);
  const result = await listDuesService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/payment-dues/:id/mark-paid
// ---------------------------------------------------------------------------

export async function markPaidController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  // Body parsed but unused — mark-paid has no required fields; body accepted for future extensibility
  void typedBody<MarkPaidBody>(request);

  // HIGH-03: Idempotency-Key obrigatório para mutações financeiras
  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key header obrigatório para mutações financeiras',
    );
  }

  const result = await markPaidService(
    db,
    organizationId,
    id,
    cityScopeIds,
    { userId, ip },
    idempotencyKey,
  );
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/payment-dues/:id/renegotiate
// ---------------------------------------------------------------------------

export async function renegotiateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  // Body parsed but unused — renegotiate has no required fields; accepted for future extensibility
  void typedBody<RenegotiateBody>(request);

  // HIGH-03: Idempotency-Key obrigatório para mutações financeiras
  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key header obrigatório para mutações financeiras',
    );
  }

  const result = await renegotiateService(
    db,
    organizationId,
    id,
    cityScopeIds,
    { userId, ip },
    idempotencyKey,
  );
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/billing/rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const result = await listRulesService(db, organizationId);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/rules
// ---------------------------------------------------------------------------

export async function createRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const body = typedBody<CollectionRuleCreate>(request);
  const result = await createRuleService(db, organizationId, body);
  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/billing/rules/:id
// ---------------------------------------------------------------------------

export async function updateRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const body = typedBody<CollectionRuleUpdate>(request);
  const result = await updateRuleService(db, organizationId, id, body);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/billing/jobs
// ---------------------------------------------------------------------------

export async function listJobsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<CollectionJobsListQuery>(request);
  const result = await listJobsService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/jobs/:id/cancel
// ---------------------------------------------------------------------------

export async function cancelJobController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const result = await cancelJobService(db, organizationId, cityScopeIds, id);
  await reply.status(200).send(result);
}
