// =============================================================================
// cities/controller.ts — Handlers HTTP para o domínio de cidades (F1-S06).
//
// Responsabilidades:
//   - Extrair params/body/query do request.
//   - Montar ActorContext a partir de request.user (garantido por authenticate()).
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() + authorize() nos
// preHandlers de cada rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';

import type { CityCreate, CityIdParam, CityListQuery, CityUpdate } from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createCity,
  deleteCityService,
  getCityById,
  listCities,
  updateCityService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId } = request.user;
  // Este helper só é chamado a partir de rotas admin (protegidas por authorize).
  // O role no audit log reflete o escopo admin — não derivar de permissions[0]
  // que é posição não-determinística no array.
  const role = 'admin';

  return {
    userId: id,
    organizationId,
    role,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/cities
// ---------------------------------------------------------------------------

export async function listCitiesController(
  request: FastifyRequest<{ Querystring: CityListQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listCities(db, actor, request.query);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function getCityController(
  request: FastifyRequest<{ Params: CityIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getCityById(db, actor, request.params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/cities
// ---------------------------------------------------------------------------

export async function createCityController(
  request: FastifyRequest<{ Body: CityCreate }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createCity(db, actor, request.body);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function updateCityController(
  request: FastifyRequest<{ Params: CityIdParam; Body: CityUpdate }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await updateCityService(db, actor, request.params.id, request.body);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function deleteCityController(
  request: FastifyRequest<{ Params: CityIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  await deleteCityService(db, actor, request.params.id);
  return reply.status(204).send();
}
