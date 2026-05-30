// =============================================================================
// templates/controller.ts — Handlers HTTP para gestão de templates WhatsApp.
//
// Contexto: F5-S09.
//
// Responsabilidades:
//   - Extrair params/body/query/headers do request.
//   - Montar ActorContext.
//   - Chamar service correto.
//   - Idempotência via Idempotency-Key header em POST endpoints.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  TemplateCreate,
  TemplateIdParam,
  TemplateListQuery,
  TemplateUpdate,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createTemplateService,
  deleteTemplateService,
  getTemplateService,
  listTemplatesService,
  syncAllService,
  syncTemplateService,
  updateTemplateService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }
  const { id, organizationId, permissions } = request.user;
  const role = permissions[0] ?? 'unknown';
  return {
    userId: id,
    organizationId,
    role,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/** Extrai Idempotency-Key do header; gera UUID aleatório se ausente. */
function getIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  return key ?? crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

export async function listTemplatesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listTemplatesService(actor, typedQuery<TemplateListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

export async function getTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const result = await getTemplateService(actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates
// ---------------------------------------------------------------------------

export async function createTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const idempotencyKey = getIdempotencyKey(request);
  const result = await createTemplateService(
    actor,
    typedBody<TemplateCreate>(request),
    idempotencyKey,
  );
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/templates/:id
// ---------------------------------------------------------------------------

export async function updateTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const result = await updateTemplateService(actor, id, typedBody<TemplateUpdate>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------

export async function deleteTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const result = await deleteTemplateService(actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates/:id/sync
// ---------------------------------------------------------------------------

export async function syncTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const idempotencyKey = getIdempotencyKey(request);
  const result = await syncTemplateService(actor, id, idempotencyKey);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates/sync-all
// ---------------------------------------------------------------------------

export async function syncAllController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await syncAllService(actor);
  return reply.status(200).send(result);
}
