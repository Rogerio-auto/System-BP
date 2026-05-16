// =============================================================================
// credit-products/controller.ts — Handlers HTTP para o módulo de crédito (F2-S03).
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext a partir de request.user.
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  CreditProductCreate,
  CreditProductListQuery,
  CreditProductRuleCreate,
  CreditProductUpdate,
  ProductIdParam,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createProduct,
  deleteProductService,
  getProductById,
  listProducts,
  listRules,
  publishRule,
  updateProductService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId } = request.user;

  return {
    userId: id,
    organizationId,
    role: 'admin',
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/credit-products
// ---------------------------------------------------------------------------

export async function listProductsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listProducts(db, actor, typedQuery<CreditProductListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/credit-products
// ---------------------------------------------------------------------------

export async function createProductController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createProduct(db, actor, typedBody<CreditProductCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/credit-products/:id
// ---------------------------------------------------------------------------

export async function getProductController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ProductIdParam>(request);
  const result = await getProductById(db, actor, params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/credit-products/:id
// ---------------------------------------------------------------------------

export async function updateProductController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ProductIdParam>(request);
  const result = await updateProductService(
    db,
    actor,
    params.id,
    typedBody<CreditProductUpdate>(request),
  );
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/credit-products/:id
// ---------------------------------------------------------------------------

export async function deleteProductController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ProductIdParam>(request);
  await deleteProductService(db, actor, params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// POST /api/credit-products/:id/rules
// ---------------------------------------------------------------------------

export async function publishRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ProductIdParam>(request);
  const result = await publishRule(
    db,
    actor,
    params.id,
    typedBody<CreditProductRuleCreate>(request),
  );
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/credit-products/:id/rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<ProductIdParam>(request);
  const result = await listRules(db, actor, params.id);
  return reply.status(200).send(result);
}
