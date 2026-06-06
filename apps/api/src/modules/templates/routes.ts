// =============================================================================
// templates/routes.ts — Rotas do módulo de templates WhatsApp Meta.
//
// Contexto: F5-S09.
//
// Rotas:
//   GET    /api/templates              — lista (filtros: status, category, language)
//   GET    /api/templates/:id          — detalhe
//   POST   /api/templates              — cria local + submete na Meta (status=pending)
//   PATCH  /api/templates/:id          — edita local (apenas templates pending/rejected)
//   DELETE /api/templates/:id          — soft delete (status=paused)
//   POST   /api/templates/:id/sync     — força refetch do status na Meta
//   POST   /api/templates/sync-all     — sync batch (gated por flag templates.sync_all.enabled)
//
// Segurança:
//   - authenticate(): JWT obrigatório.
//   - authorize(): RBAC por rota (4 permissões novas).
//
// Idempotência:
//   - POST /api/templates e POST /api/templates/:id/sync aceitam Idempotency-Key header.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createTemplateController,
  deleteTemplateController,
  getTemplateController,
  listTemplatesController,
  syncAllController,
  syncTemplateController,
  updateTemplateController,
} from './controller.js';
import {
  TemplateCreateSchema,
  TemplateIdParamSchema,
  TemplateListQuerySchema,
  TemplateListResponseSchema,
  TemplateResponseSchema,
  TemplateUpdateSchema,
} from './schemas.js';

// Permissões tipadas
const READ_PERMS: [string, ...string[]] = ['templates:read'];
const WRITE_PERMS: [string, ...string[]] = ['templates:write'];
const SYNC_PERMS: [string, ...string[]] = ['templates:sync'];
const DELETE_PERMS: [string, ...string[]] = ['templates:delete'];

export const templatesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // -------------------------------------------------------------------------
  // GET /api/templates — lista paginada com filtros
  // -------------------------------------------------------------------------
  app.get(
    '/api/templates',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Listar templates',
        description: 'Lista templates WhatsApp Meta da organizacao.',
        security: [{ bearerAuth: [] }],
        querystring: TemplateListQuerySchema,
        response: { 200: TemplateListResponseSchema },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    listTemplatesController,
  );

  // -------------------------------------------------------------------------
  // GET /api/templates/:id — detalhe
  //
  // NOTA: Rota estática /api/templates/sync-all (POST) NÃO conflita com este
  // GET /:id porque são métodos diferentes. O POST /sync-all é registrado
  // abaixo antes do POST /:id/sync — Fastify resolverá corretamente por prefixo.
  // -------------------------------------------------------------------------
  app.get(
    '/api/templates/:id',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Obter template',
        description: 'Retorna detalhes de um template WhatsApp pelo ID.',
        security: [{ bearerAuth: [] }],
        params: TemplateIdParamSchema,
        response: { 200: TemplateResponseSchema },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    getTemplateController,
  );

  // -------------------------------------------------------------------------
  // POST /api/templates — criar + submeter na Meta
  // -------------------------------------------------------------------------
  app.post(
    '/api/templates',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Criar template',
        description: 'Cria um novo template WhatsApp Meta.',
        security: [{ bearerAuth: [] }],
        body: TemplateCreateSchema,
        response: { 201: TemplateResponseSchema },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    createTemplateController,
  );

  // -------------------------------------------------------------------------
  // PATCH /api/templates/:id — editar (apenas pending/rejected)
  // -------------------------------------------------------------------------
  app.patch(
    '/api/templates/:id',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Atualizar template',
        description: 'Atualiza um template WhatsApp Meta.',
        security: [{ bearerAuth: [] }],
        params: TemplateIdParamSchema,
        body: TemplateUpdateSchema,
        response: { 200: TemplateResponseSchema },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    updateTemplateController,
  );

  // -------------------------------------------------------------------------
  // DELETE /api/templates/:id — soft delete (status=paused)
  // -------------------------------------------------------------------------
  app.delete(
    '/api/templates/:id',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Remover template',
        description: 'Remove um template WhatsApp Meta.',
        security: [{ bearerAuth: [] }],
        params: TemplateIdParamSchema,
        response: { 200: TemplateResponseSchema },
      },
      preHandler: [authorize({ permissions: DELETE_PERMS })],
    },
    deleteTemplateController,
  );

  // -------------------------------------------------------------------------
  // POST /api/templates/sync-all — sync batch
  // Registrado ANTES de POST /api/templates/:id/sync para evitar que
  // Fastify tente parsear "sync-all" como UUID param.
  // -------------------------------------------------------------------------
  app.post(
    '/api/templates/sync-all',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Sincronizar todos os templates',
        description: 'Sincroniza todos os templates com a Meta API.',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            synced: z.number().int().nonnegative(),
            unchanged: z.number().int().nonnegative(),
            errors: z.number().int().nonnegative(),
          }),
        },
      },
      preHandler: [authorize({ permissions: SYNC_PERMS })],
    },
    syncAllController,
  );

  // -------------------------------------------------------------------------
  // POST /api/templates/:id/sync — sync individual
  // -------------------------------------------------------------------------
  app.post(
    '/api/templates/:id/sync',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Sincronizar template',
        description: 'Sincroniza um template especifico com a Meta API.',
        security: [{ bearerAuth: [] }],
        params: TemplateIdParamSchema,
        response: { 200: TemplateResponseSchema },
      },
      preHandler: [authorize({ permissions: SYNC_PERMS })],
    },
    syncTemplateController,
  );
};
