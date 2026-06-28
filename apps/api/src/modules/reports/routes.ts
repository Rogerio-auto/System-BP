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
  AiQuerySchema,
  AiResponseSchema,
  AttendanceQuerySchema,
  AttendanceResponseSchema,
  AuditQuerySchema,
  AuditResponseSchema,
  CollectionQuerySchema,
  CollectionResponseSchema,
  CreditQuerySchema,
  CreditResponseSchema,
  FunnelQuerySchema,
  FunnelResponseSchema,
  OverviewQuerySchema,
  ExportRequestSchema,
  OverviewResponseSchema,
  ProductivityQuerySchema,
  ProductivityResponseSchema,
} from '@elemento/shared-schemas';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize, authorizeAny } from '../auth/middlewares/authorize.js';

import {
  getReportsAiController,
  getReportsAttendanceController,
  getReportsAuditController,
  getReportsCollectionController,
  getReportsCreditController,
  getReportsFunnelController,
  getReportsOverviewController,
  getReportsProductivityController,
} from './controller.js';
import { postReportsExportController } from './export/controller.js';

// Permissões ACEITAS (semântica OR via authorizeAny) para os relatórios agregados:
//   - `dashboard:read`          → visão completa (global ou por cidade, conforme escopo)
//   - `dashboard:read_by_agent` → visão restrita aos próprios dados do agente
// O resolvedor de escopo em service.ts (resolveScopeAndValidate) deriva o escopo
// efetivo a partir da permissão concedida. Usar `authorize` (AND) aqui trancava
// agentes/operadores (que só têm read_by_agent) para fora dos relatórios e tornava
// morto o caminho self-scoped do service.
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
      preHandler: [authorizeAny({ permissions: DASHBOARD_READ_BY_AGENT })],
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
      preHandler: [authorizeAny({ permissions: DASHBOARD_READ_BY_AGENT })],
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
      preHandler: [authorizeAny({ permissions: DASHBOARD_READ_BY_AGENT })],
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
      preHandler: [authorizeAny({ permissions: DASHBOARD_READ_BY_AGENT })],
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
      preHandler: [authorizeAny({ permissions: DASHBOARD_READ_BY_AGENT })],
    },
    getReportsProductivityController,
  );

  // GET /api/reports/ai (F23-S05)
  app.get(
    '/api/reports/ai',
    {
      schema: {
        tags: ['Reports'],
        summary: 'IA / Pre-atendimento -- metricas secao 4-C',
        description:
          'Saude das conversas IA, motivos de handoff, distribuicao por no, tokens/custo/latencia LLM e SLA de handoff. Gating: dashboard:read + flag ai.livechat_agent.enabled.',
        security: [{ bearerAuth: [] }],
        querystring: AiQuerySchema,
        response: { 200: AiResponseSchema },
      },
      preHandler: [authorize({ permissions: ['dashboard:read'] as [string, ...string[]] })],
    },
    getReportsAiController,
  );

  // GET /api/reports/audit (F23-S05)
  app.get(
    '/api/reports/audit',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Auditoria e Operacao -- metricas secao 4-H',
        description:
          'Volume de audit logs, top acoes, acoes criticas, saude do outbox e snapshot do DLQ. Gating: audit:read.',
        security: [{ bearerAuth: [] }],
        querystring: AuditQuerySchema,
        response: { 200: AuditResponseSchema },
      },
      preHandler: [authorize({ permissions: ['audit:read'] as [string, ...string[]] })],
    },
    getReportsAuditController,
  );
  // POST /api/reports/export (F23-S09)
  // M-02 (hardening): rate-limit especifico por IP.
  // Exports sao operacoes custosas (I/O DB + serializacao CSV/XLSX/PDF) -- 15 req/min
  // por IP e suficiente para uso legitimo (UI nunca dispara mais que 1-2/min) e
  // bloqueia scraping automatizado. Reutiliza o padrao config.rateLimit do projeto
  // (ver internal/leads/routes.ts) -- NAO altera app.ts nem registra plugin extra.
  app.post(
    '/api/reports/export',
    {
      schema: {
        tags: ['Reports'],
        summary: 'Exportacao de relatorio (CSV/XLSX/PDF)',
        description:
          'Gera arquivo para a secao solicitada. Gating: reports:export + flag reports.export.enabled. LGPD: apenas agregados.',
        security: [{ bearerAuth: [] }],
        body: ExportRequestSchema,
      },
      preHandler: [authorize({ permissions: ['reports:export'] as [string, ...string[]] })],
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Rate limit excedido: maximo 15 exportacoes por minuto por IP.'),
              {
                statusCode: context.statusCode,
                code: 'RATE_LIMITED',
              },
            );
            return err;
          },
        },
      },
    },
    postReportsExportController,
  );
};
