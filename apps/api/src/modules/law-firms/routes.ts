// =============================================================================
// law-firms/routes.ts — Rotas do módulo de escritórios de advocacia (F19-S02).
//
// Todas as rotas exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize(opts): verifica permissão RBAC por rota
//
// Permissões:
//   - law_firms:manage — CRUD de escritórios (GET lista, POST, PATCH, DELETE)
//   - law_firms:referral — sugestão de escritório por cliente (GET /suggest)
//
// City scope: law_firms são recursos de gestão (não de operação por cidade do agente).
// O org-scope (organization_id do actor) é aplicado em todas as queries.
//
// NOTA SOBRE ORDEM DE ROTAS:
//   GET /api/law-firms/suggest deve ser registrado ANTES de /api/law-firms/:id
//   para evitar que "suggest" seja interpretado como um UUID (Fastify é exato
//   nesse aspecto — a string "suggest" falha a validação UUID e lança 400).
//   Registrar /suggest primeiro garante que Fastify faça o match estático antes
//   do match paramétrico.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createLawFirmController,
  deleteLawFirmController,
  listLawFirmsController,
  suggestLawFirmController,
  updateLawFirmController,
} from './controller.js';
import {
  LawFirmCreateSchema,
  LawFirmListQuerySchema,
  LawFirmListResponseSchema,
  LawFirmResponseSchema,
  LawFirmSuggestResponseSchema,
  LawFirmUpdateSchema,
  OkResponseSchema,
  lawFirmIdParamSchema,
  lawFirmSuggestQuerySchema,
} from './schemas.js';

export const lawFirmsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/law-firms/suggest — escritório padrão para a cidade do cliente
  // DEVE ser registrado ANTES de /api/law-firms/:id (match estático antes paramétrico)
  // ---------------------------------------------------------------------------
  app.get(
    '/api/law-firms/suggest',
    {
      schema: {
        tags: ['Law Firms'],
        summary: 'Sugerir escritório para cliente',
        description:
          'Retorna o escritório de advocacia padrão (is_default_for_city = true) que cobre a cidade do cliente informado. ' +
          'Retorna null quando nenhum escritório configurado cobre a cidade do cliente. ' +
          'Usado pelo agente de IA e pelo operador ao iniciar o processo de encaminhamento judicial.',
        security: [{ bearerAuth: [] }],
        querystring: lawFirmSuggestQuerySchema,
        response: {
          200: LawFirmSuggestResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:referral'] })],
    },
    suggestLawFirmController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/law-firms — listagem paginada
  // ---------------------------------------------------------------------------
  app.get(
    '/api/law-firms',
    {
      schema: {
        tags: ['Law Firms'],
        summary: 'Listar escritórios de advocacia',
        description:
          'Lista os escritórios de advocacia cadastrados pela organização, com paginação. ' +
          'Filtro opcional por city_id: retorna apenas escritórios que cobrem a cidade informada ' +
          '(usa GIN array containment: coverage_city_ids @> ARRAY[city_id]).',
        security: [{ bearerAuth: [] }],
        querystring: LawFirmListQuerySchema,
        response: {
          200: LawFirmListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:manage'] })],
    },
    listLawFirmsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/law-firms — criar escritório
  // ---------------------------------------------------------------------------
  app.post(
    '/api/law-firms',
    {
      schema: {
        tags: ['Law Firms'],
        summary: 'Cadastrar escritório de advocacia',
        description:
          'Cria um novo escritório de advocacia parceiro da organização. ' +
          'O campo coverage_city_ids define as cidades de atuação (UUIDs da tabela cities). ' +
          'Quando is_default_for_city = true, este escritório é sugerido automaticamente para ' +
          'clientes das cidades de cobertura.',
        security: [{ bearerAuth: [] }],
        body: LawFirmCreateSchema,
        response: {
          201: LawFirmResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:manage'] })],
    },
    createLawFirmController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/law-firms/:id — atualização parcial
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/law-firms/:id',
    {
      schema: {
        tags: ['Law Firms'],
        summary: 'Atualizar escritório de advocacia',
        description:
          'Atualiza campos de um escritório. Todos os campos são opcionais (PATCH parcial). ' +
          'Retorna 404 se o escritório não pertencer à organização do usuário autenticado.',
        security: [{ bearerAuth: [] }],
        params: lawFirmIdParamSchema,
        body: LawFirmUpdateSchema,
        response: {
          200: LawFirmResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:manage'] })],
    },
    updateLawFirmController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/law-firms/:id — soft delete
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/law-firms/:id',
    {
      schema: {
        tags: ['Law Firms'],
        summary: 'Desativar escritório de advocacia',
        description:
          'Soft-delete: marca o escritório como desativado (deleted_at = NOW()). ' +
          'O escritório permanece referenciável em encaminhamentos históricos, ' +
          'mas não aparece mais em listagens ou sugestões. ' +
          'Retorna 404 se não encontrado ou se não pertencer à organização.',
        security: [{ bearerAuth: [] }],
        params: lawFirmIdParamSchema,
        response: {
          200: OkResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['law_firms:manage'] })],
    },
    deleteLawFirmController,
  );
};
