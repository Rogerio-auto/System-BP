// =============================================================================
// dashboard/routes.ts — Rotas do dashboard de métricas (F8-S03)
//                       e dashboard de cobrança (F15-S09).
//
// Autenticação obrigatória em todas as rotas.
//
// Permissões:
//   - dashboard:read   → métricas gerais (admin, agente).
//   - billing:read     → métricas de cobrança (role cobranca, admin).
//
// LGPD: respostas nunca contêm PII de leads/customers — apenas contagens e totais.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { getCollectionDashboardController, getDashboardMetricsController } from './controller.js';
import {
  CollectionDashboardQuerySchema,
  CollectionDashboardResponseSchema,
  DashboardMetricsQuerySchema,
  DashboardMetricsResponseSchema,
} from './schemas.js';

const DASHBOARD_READ: [string, ...string[]] = ['dashboard:read'];
const BILLING_READ: [string, ...string[]] = ['billing:read'];

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/dashboard/metrics
  //
  // Retorna KPIs agregados para o escopo e intervalo solicitados.
  // Todos os valores são contagens — nunca lista de leads individuais.
  // ---------------------------------------------------------------------------
  app.get(
    '/api/dashboard/metrics',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Metricas do dashboard',
        description: 'Retorna KPIs do dashboard para o usuario autenticado com city scope.',
        security: [{ bearerAuth: [] }],
        querystring: DashboardMetricsQuerySchema,
        response: {
          200: DashboardMetricsResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ })],
    },
    getDashboardMetricsController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/dashboard/collection
  //
  // Retorna os 5 cards do dashboard de cobrança para o role `cobranca`.
  //
  // Cards:
  //   - due_soon:            parcelas vencendo nos próximos 7 dias.
  //   - overdue_uncollected: parcelas vencidas sem collection_job ativo.
  //   - in_collection:       parcelas com collection_job em andamento.
  //   - overdue_15d:         inadimplentes há 15+ dias (candidatos a SPC).
  //   - in_spc:              clientes atualmente incluídos no SPC.
  //
  // Escopo: acesso global por padrão (sem city scope obrigatório).
  //   - city_id opcional: permite filtrar por cidade (ex: gestor_regional).
  //
  // LGPD: retorna apenas contagens e totais monetários agregados — sem PII.
  // ---------------------------------------------------------------------------
  app.get(
    '/api/dashboard/collection',
    {
      schema: {
        tags: ['Dashboard'],
        summary: 'Métricas do dashboard de cobrança',
        description:
          'Retorna os 5 cards do dashboard de cobrança: parcelas vencendo em breve, ' +
          'vencidas sem cobrança ativa, em cobrança ativa, inadimplentes há 15+ dias ' +
          'e clientes incluídos no SPC. Acesso global por padrão; city_id opcional ' +
          'para filtrar por cidade. Requer permissão billing:read.',
        security: [{ bearerAuth: [] }],
        querystring: CollectionDashboardQuerySchema,
        response: {
          200: CollectionDashboardResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: BILLING_READ })],
    },
    getCollectionDashboardController,
  );
};
