// =============================================================================
// notification-rules/controller.ts — Handlers HTTP (F24-S05).
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext a partir de request.user.
//   - Extrair Idempotency-Key header para POST.
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { RuleIdParam, ListRulesQuery, CreateRuleBody, UpdateRuleBody } from './routes.js';
import type { ActorContext } from './service.js';
import {
  createRuleService,
  deleteRuleService,
  getCatalogService,
  getRuleService,
  listRulesService,
  testRuleService,
  updateRuleService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não executado');
  }
  return {
    userId: request.user.id,
    organizationId: request.user.organizationId,
    // M1: role removido — request.user não expõe o campo (fastify.d.ts) e hardcodar
    // 'admin' registraria um role incorreto na trilha de auditoria para gestor_geral.
    // O actor_user_id é a fonte da verdade; role será 'unknown' no audit log.
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helper: Idempotency-Key header
// ---------------------------------------------------------------------------

function extractIdempotencyKey(request: FastifyRequest): string | undefined {
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey === 'string' && rawKey.trim() !== '') {
    return rawKey.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// GET /api/notification-rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const query = typedQuery<ListRulesQuery>(request);
  const result = await listRulesService(db, actor, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    enabled: query.enabled,
  });
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/notification-rules/catalog
// ---------------------------------------------------------------------------

export async function getCatalogController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const catalog = getCatalogService();
  return reply.status(200).send({ data: catalog });
}

// ---------------------------------------------------------------------------
// POST /api/notification-rules
// ---------------------------------------------------------------------------

export async function createRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<CreateRuleBody>(request);
  const idempotencyKey = extractIdempotencyKey(request);
  const result = await createRuleService(db, actor, body, idempotencyKey);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/notification-rules/:id
// ---------------------------------------------------------------------------

export async function getRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<RuleIdParam>(request);
  const result = await getRuleService(db, actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/notification-rules/:id
// ---------------------------------------------------------------------------

export async function updateRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<RuleIdParam>(request);
  const body = typedBody<UpdateRuleBody>(request);
  const result = await updateRuleService(db, actor, id, body);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/notification-rules/:id
// ---------------------------------------------------------------------------

export async function deleteRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<RuleIdParam>(request);
  await deleteRuleService(db, actor, id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// POST /api/notification-rules/:id/test
// ---------------------------------------------------------------------------

export async function testRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<RuleIdParam>(request);
  const result = await testRuleService(db, actor, id);
  return reply.status(200).send(result);
}
