// =============================================================================
// dashboard/routes.ts — Rota do endpoint de métricas do dashboard (F8-S03).
//
// Autenticação obrigatória + permissão 'dashboard:read'.
// City scope aplicado automaticamente via service → repository.
//
// Permissão necessária: 'dashboard:read'
//   - Atribuída a: admin, agente (seed 0020_seed_dashboard_permission.sql).
//   - Admin global vê todas as cidades; agente vê só suas cidades configuradas.
//
// LGPD: resposta nunca contém PII de leads — apenas contagens e IDs opacos.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { getDashboardMetricsController } from './controller.js';
import { DashboardMetricsQuerySchema, DashboardMetricsResponseSchema } from './schemas.js';

const DASHBOARD_READ: [string, ...string[]] = ['dashboard:read'];

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
        querystring: DashboardMetricsQuerySchema,
        response: {
          200: DashboardMetricsResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ })],
    },
    getDashboardMetricsController,
  );
};
