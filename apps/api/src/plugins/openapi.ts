// =============================================================================
// plugins/openapi.ts — Plugin OpenAPI 3.1 via fastify-zod-openapi.
//
// Expõe GET /openapi.json com spec completo dos 23 módulos públicos.
// Registrado em app.ts somente quando:
//   - process.env.OPENAPI_PUBLIC_ENABLED === 'true'  OU
//   - process.env.NODE_ENV !== 'production'
//
// Em prod sem a flag: rota NÃO é registrada → 404 (sem fingerprinting).
//
// Security schemes:
//   bearerAuth  — JWT (Authorization: Bearer <token>)
//   internalToken — apiKey header X-Internal-Token (marcado x-internal para UI)
//
// Tags ordenadas para sidebar da API Reference (F10-S10).
// =============================================================================
import 'zod-openapi/extend';

import fastifySwagger from '@fastify/swagger';
import type { FastifyPluginAsync } from 'fastify';
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransform,
  fastifyZodOpenApiTransformObject,
} from 'fastify-zod-openapi';

export const openapiPlugin: FastifyPluginAsync = async (app) => {
  // Registra o plugin core do fastify-zod-openapi (converte Zod → JSON Schema OpenAPI).
  await app.register(fastifyZodOpenApiPlugin);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Manager Banco do Povo API',
        version: '0.0.0',
        description:
          'API REST do sistema Manager — Banco do Povo / SEDEC Rondônia. ' +
          'Documentação completa disponível em /ajuda/api.',
        contact: {
          name: 'Elemento',
          url: 'https://elemento.dev',
        },
      },
      servers: [
        {
          url: process.env.API_PUBLIC_URL ?? 'http://localhost:3333',
          description:
            process.env.NODE_ENV === 'production'
              ? 'Produção'
              : process.env.NODE_ENV === 'test'
                ? 'Staging'
                : 'Desenvolvimento local',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Token JWT obtido via POST /api/auth/login.',
          },
          // internalToken is a custom x-internal marker for F10-S10 UI generator.
          // Cast to record to allow OpenAPI extension properties not in the type.
          ...({
            internalToken: {
              type: 'apiKey',
              in: 'header',
              name: 'X-Internal-Token',
              description:
                'Token de autenticação machine-to-machine (LangGraph ↔ API). ' +
                'Canal interno — não exposto ao frontend.',
              'x-internal': true,
            },
          } as Record<string, unknown>),
        },
      },
      tags: [
        { name: 'Auth', description: 'Autenticação — login, refresh, logout, 2FA' },
        { name: 'Account', description: 'Self-service de conta — perfil, senha, 2FA' },
        { name: 'Leads', description: 'CRM de leads — CRUD, filtros, city scope' },
        { name: 'Kanban', description: 'Board Kanban de leads — stages, cards, drag & drop' },
        { name: 'Credit Analyses', description: 'Análises de crédito — RBAC + Art. 20 LGPD' },
        { name: 'Credit Products', description: 'Produtos de crédito — CRUD + regras versionadas' },
        { name: 'Simulations', description: 'Simulações de crédito — via UI e via IA' },
        { name: 'Follow-up', description: 'Follow-up automatizado — réguas e jobs' },
        { name: 'Billing', description: 'Cobrança escalonada — parcelas e réguas' },
        { name: 'Templates', description: 'Templates WhatsApp Meta — CRUD + sync' },
        { name: 'Imports', description: 'Importação de leads — pipeline CSV' },
        { name: 'Cities', description: 'Cidades — CRUD admin + lista pública' },
        { name: 'Roles & Users', description: 'Usuários e papéis — gestão RBAC' },
        { name: 'Agents', description: 'Agentes de crédito — vínculos e cidades' },
        { name: 'Dashboard', description: 'KPIs agregados — gráficos e métricas' },
        { name: 'Admin', description: 'Administração — Dead-Letter Queue (DLQ)' },
        { name: 'AI Console', description: 'Console de IA — prompts, decisões, playground' },
        { name: 'Chatwoot', description: 'Integração Chatwoot — webhook de eventos' },
        { name: 'WhatsApp', description: 'Integração WhatsApp Cloud API — webhook Meta' },
        { name: 'Data Subject', description: 'LGPD — direitos do titular de dados' },
        { name: 'Health', description: 'Health check — status do serviço e dependências' },
        { name: 'Feature Flags', description: 'Feature flags — consulta e gestão' },
      ],
    },
    transform: fastifyZodOpenApiTransform,
    transformObject: fastifyZodOpenApiTransformObject,
  });

  // ---------------------------------------------------------------------------
  // GET /openapi.json — Expõe o spec OpenAPI 3.1 gerado.
  //
  // Somente registrado quando o plugin é ativo (NODE_ENV !== 'production' ou
  // OPENAPI_PUBLIC_ENABLED=true). Em produção sem flag: rota não existe → 404.
  //
  // Sem autenticação (spec é lido por F10-S10 UI e ferramentas de cliente).
  // Rate-limit: herda global (100/min) — suficiente para acesso editorial.
  // ---------------------------------------------------------------------------
  app.get(
    '/openapi.json',
    {
      schema: {
        hide: true, // Não documenta a própria rota do spec no spec.
      },
    },
    async (_request, reply) => {
      // app.swagger() está disponível após o @fastify/swagger estar pronto.
      // O cast é necessário pois o decorator retorna SwaggerObject | undefined
      // dependendo do modo; em modo dynamic (nosso) sempre retorna o objeto.
      const spec = (app as unknown as { swagger: () => unknown }).swagger();
      return reply.status(200).type('application/json').send(spec);
    },
  );
};
