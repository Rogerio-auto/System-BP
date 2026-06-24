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
  CollectionQuerySchema,
  CollectionResponseSchema,
  CreditQuerySchema,
  CreditResponseSchema,
  FunnelQuerySchema,
  FunnelResponseSchema,
  OverviewQuerySchema,
  OverviewResponseSchema,
  ProductivityQuerySchema,
  ProductivityResponseSchema,
} from '@elemento/shared-schemas';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  getReportsAttendanceController,
  getReportsCollectionController,
  getReportsCreditController,
  getReportsFunnelController,
  getReportsOverviewController,
  getReportsProductivityController,
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

  // GET /api/reports/credit
  app.get(
    '/api/reports/credit',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Crédito — métricas §4-E',
        description: 'Funil simulações→análises→contratos, valores médios e breakdown por produto.',
        security: [{ bearerAuth: [] }],
        querystring: CreditQuerySchema,
        response: { 200: CreditResponseSchema },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsCreditController,
  );

  // GET /api/reports/collection
  app.get(
    '/api/reports/collection',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Cobrança — carteira §4-F',
        description:
          'Adimplência/inadimplência, wallet por status, eficiência dos jobs de cobrança.',
        security: [{ bearerAuth: [] }],
        querystring: CollectionQuerySchema,
        response: { 200: CollectionResponseSchema },
      },
      preHandler: [authorize({ permissions: ['billing:read'] as [string, ...string[]] })],
    },
    getReportsCollectionController,
  );

  // GET /api/reports/productivity
  app.get(
    '/api/reports/productivity',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Produtividade — por agente §4-G',
        description:
          'Ranking de agentes. Gestor vê nomes; agente (self-scope) vê só a própria linha + média anônima da equipe (D3).',
        security: [{ bearerAuth: [] }],
        querystring: ProductivityQuerySchema,
        response: { 200: ProductivityResponseSchema },
      },
      preHandler: [authorize({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsProductivityController,
  );
};
