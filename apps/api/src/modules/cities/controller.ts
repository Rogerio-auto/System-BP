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
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

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
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listCities(db, actor, typedQuery<CityListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function getCityController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<CityIdParam>(request);
  const result = await getCityById(db, actor, params.id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/admin/cities
// ---------------------------------------------------------------------------

export async function createCityController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createCity(db, actor, typedBody<CityCreate>(request));
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function updateCityController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<CityIdParam>(request);
  const result = await updateCityService(db, actor, params.id, typedBody<CityUpdate>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/cities/:id
// ---------------------------------------------------------------------------

export async function deleteCityController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<CityIdParam>(request);
  await deleteCityService(db, actor, params.id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// GET /api/cities (public) — lista resumida para popular selects da UI.
// Qualquer usuario autenticado pode chamar.
// ---------------------------------------------------------------------------

export async function listCitiesPublicController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuario ausente');
  }
  const result = await listCities(
    db,
    {
      userId: request.user.id,
      organizationId: request.user.organizationId,
      role: 'user',
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    {
      page: 1,
      limit: 100,
      is_active: true,
      include_deleted: false,
    },
  );
  return reply.status(200).send({
    cities: result.data.map((c) => ({
      id: c.id,
      name: c.name,
      state_uf: c.state_uf,
    })),
  });
}
