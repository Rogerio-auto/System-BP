// =============================================================================
// cities/routes.ts — Rotas admin do CRUD de cidades (F1-S06).
//
// Todas as rotas exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize({ permissions: ['cities:manage'] }): acesso restrito a admin
//
// Escopo: admin global (sem city scope — cidades são dados de configuração).
// Prefixo: /api/admin/cities
//
// LGPD: cidades não contêm PII (nome de município + UF).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createCityController,
  deleteCityController,
  getCityController,
  listCitiesController,
  listCitiesPublicController,
  updateCityController,
} from './controller.js';
import {
  CityCreateSchema,
  CityListQuerySchema,
  CityListResponseSchema,
  CityPublicListResponseSchema,
  CityResponseSchema,
  CityUpdateSchema,
  cityIdParamSchema,
} from './schemas.js';

const ADMIN_CITIES_WRITE: [string, ...string[]] = ['cities:manage'];

export const citiesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/admin/cities — lista paginada com filtros
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/cities',
    {
      schema: {
        querystring: CityListQuerySchema,
        response: {
          200: CityListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ADMIN_CITIES_WRITE })],
    },
    listCitiesController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/admin/cities/:id — detalhe de uma cidade
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/cities/:id',
    {
      schema: {
        params: cityIdParamSchema,
        response: {
          200: CityResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ADMIN_CITIES_WRITE })],
    },
    getCityController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/cities — criar cidade
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/cities',
    {
      schema: {
        body: CityCreateSchema,
        response: {
          201: CityResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ADMIN_CITIES_WRITE })],
    },
    createCityController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/cities/:id — update parcial com audit before/after
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/admin/cities/:id',
    {
      schema: {
        params: cityIdParamSchema,
        body: CityUpdateSchema,
        response: {
          200: CityResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ADMIN_CITIES_WRITE })],
    },
    updateCityController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/admin/cities/:id — soft delete
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/admin/cities/:id',
    {
      schema: {
        params: cityIdParamSchema,
        response: {
          204: z.void(),
        },
      },
      preHandler: [authorize({ permissions: ADMIN_CITIES_WRITE })],
    },
    deleteCityController,
  );
};

// =============================================================================
// citiesPublicRoutes — endpoint authenticate-only para popular selects.
//
// Qualquer usuario autenticado pode listar cidades ativas da sua org
// (id + name + state_uf). Sem RBAC de admin — cadastrar lead, filtrar
// kanban etc. precisam dessa lista mas nao tem cities:manage.
// =============================================================================
export const citiesPublicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  app.get(
    '/api/cities',
    {
      schema: {
        response: {
          200: CityPublicListResponseSchema,
        },
      },
    },
    listCitiesPublicController,
  );
};
