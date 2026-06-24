// =============================================================================
// reports/routes.ts — Rotas do módulo de relatórios (F23-S03).
//
// Permissões:
//   - dashboard:read        → visão global/cidade (admin, gestor_geral, gestor_regional).
//   - dashboard:read_by_agent → visão própria (agente). Self-scope aplicado no service.
//
// LGPD: responses nunca contêm PII — apenas contagens e totais.
// =============================================================================
import {
  AttendanceQuerySchema,
  AttendanceResponseSchema,
  FunnelQuerySchema,
  FunnelResponseSchema,
  OverviewQuerySchema,
  OverviewResponseSchema,
} from '@elemento/shared-schemas';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  getReportsAttendanceController,
  getReportsFunnelController,
  getReportsOverviewController,
} from './controller.js';

const DASHBOARD_READ_BY_AGENT: [string, ...string[]] = [
  'dashboard:read',
  'dashboard:read_by_agent',
];

export const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // GET /api/reports/overview
  app.get(
    '/api/reports/overview',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Visão geral — KPIs agregados',
        description:
          'KPIs de leads, simulações, contratos e conversas. City-scoped por papel. Self-scope automático para agentes.',
        security: [{ bearerAuth: [] }],
        querystring: OverviewQuerySchema,
        response: { 200: OverviewResponseSchema },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsOverviewController,
  );

  // GET /api/reports/funnel
  app.get(
    '/api/reports/funnel',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Funil CRM — conversão etapa a etapa',
        description:
          'Contagem de cards por stage Kanban, taxa de conversão entre stages e tempo médio de permanência.',
        security: [{ bearerAuth: [] }],
        querystring: FunnelQuerySchema,
        response: { 200: FunnelResponseSchema },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsFunnelController,
  );

  // GET /api/reports/attendance
  app.get(
    '/api/reports/attendance',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Atendimento — métricas de conversas',
        description:
          'Total de conversas, breakdown por canal, tempo de 1ª resposta e tempo de resolução (avg/p90).',
        security: [{ bearerAuth: [] }],
        querystring: AttendanceQuerySchema,
        response: { 200: AttendanceResponseSchema },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsAttendanceController,
  );
};
