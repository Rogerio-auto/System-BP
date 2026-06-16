// =============================================================================
// credit-analyses/controller.ts — Handlers HTTP para análise de crédito.
//
// Contexto: F4-S02.
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext a partir de request.user (garantido por authenticate()).
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido — authenticate() + authorize() nos
// preHandlers de cada rota garantem presença antes de qualquer handler.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  AnalysisIdParam,
  CreditAnalysisCreate,
  CreditAnalysisDecide,
  CreditAnalysisListQuery,
  CreditAnalysisRequestReview,
  CreditAnalysisVersionCreate,
  LeadIdParam,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  addVersion,
  assertLeadAccess,
  createAnalysis,
  decideAnalysis,
  getAnalysisById,
  listAnalyses,
  listAnalysesByLead,
  listVersionsByAnalysis,
  requestReview,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
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
// GET /api/credit-analyses
// ---------------------------------------------------------------------------

export async function listAnalysesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listAnalyses(db, actor, typedQuery<CreditAnalysisListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/credit-analyses/:id
// ---------------------------------------------------------------------------

export async function getAnalysisController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<AnalysisIdParam>(request);
  const result = await getAnalysisById(db, actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/leads/:leadId/credit-analyses
// ---------------------------------------------------------------------------

export async function listAnalysesByLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { leadId } = typedParams<LeadIdParam>(request);

  // Verificar acesso ao lead antes de listar análises
  await assertLeadAccess(db, actor, leadId);

  const result = await listAnalysesByLead(
    db,
    actor,
    leadId,
    typedQuery<CreditAnalysisListQuery>(request),
  );
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/credit-analyses
// ---------------------------------------------------------------------------

export async function createAnalysisController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createAnalysis(db, actor, typedBody<CreditAnalysisCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/versions
// ---------------------------------------------------------------------------

export async function addVersionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<AnalysisIdParam>(request);
  const result = await addVersion(db, actor, id, typedBody<CreditAnalysisVersionCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/decide
// ---------------------------------------------------------------------------

export async function decideAnalysisController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<AnalysisIdParam>(request);
  const result = await decideAnalysis(db, actor, id, typedBody<CreditAnalysisDecide>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/credit-analyses/:id/versions
// ---------------------------------------------------------------------------

export async function listVersionsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<AnalysisIdParam>(request);
  const versions = await listVersionsByAnalysis(db, actor, id);
  return reply.status(200).send(versions);
}

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/request-review
// ---------------------------------------------------------------------------

export async function requestReviewController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<AnalysisIdParam>(request);
  const result = await requestReview(
    db,
    actor,
    id,
    typedBody<CreditAnalysisRequestReview>(request),
  );
  return reply.status(200).send(result);
}
