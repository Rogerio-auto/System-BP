// =============================================================================
// internal/assistant/routes.ts -- F6-S06
//
// Endpoints /internal/assistant/* (auth X-Internal-Token) que re-autorizam
// via o principal do usuario no corpo da requisicao.
//
// Regra de ouro (doc 22 sec12.2): copiloto NUNCA le com privilegio proprio.
// Descoberta automatica: este arquivo e carregado pelo autoload em
// internal/index.ts (producao) ou por import estatico nos testes.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { UnauthorizedError } from '../../../shared/errors.js';

import {
  AnalysisStatusBodySchema,
  AnalysisStatusResponseSchema,
  BillingUpcomingBodySchema,
  BillingUpcomingResponseSchema,
  FunnelMetricsBodySchema,
  FunnelMetricsResponseSchema,
  LeadConversationBodySchema,
  LeadConversationResponseSchema,
  LeadCountBodySchema,
  LeadCountResponseSchema,
} from './schemas.js';
import {
  getAnalysisStatus,
  getBillingUpcoming,
  getFunnelMetrics,
  getLeadConversation,
  getLeadCount,
} from './service.js';

const internalAssistantRoutes: FastifyPluginAsyncZod = async (app) => {
  // Inline guard: verificar X-Internal-Token antes de cada handler.
  // Recebe o valor direto de req.headers (string | string[] | undefined).
  // Nao usamos hook global para manter encapsulamento por plugin.
  function checkToken(token: string | string[] | undefined): void {
    if (!verifyInternalToken(token, env.LANGGRAPH_INTERNAL_TOKEN)) {
      throw new UnauthorizedError('Token interno invalido ou ausente');
    }
  }

  // POST /internal/assistant/funnel-metrics -- requer dashboard:read
  app.post(
    '/funnel-metrics',
    {
      schema: {
        hide: true,
        body: FunnelMetricsBodySchema,
        response: { 200: FunnelMetricsResponseSchema },
      },
    },
    async (req, reply) => {
      checkToken(req.headers['x-internal-token']);
      const result = await getFunnelMetrics(db, req.body.principal, req.body.query);
      return reply.status(200).send(result);
    },
  );

  // POST /internal/assistant/lead-count -- requer leads:read
  app.post(
    '/lead-count',
    {
      schema: { hide: true, body: LeadCountBodySchema, response: { 200: LeadCountResponseSchema } },
    },
    async (req, reply) => {
      checkToken(req.headers['x-internal-token']);
      const result = await getLeadCount(db, req.body.principal, req.body.query);
      return reply.status(200).send(result);
    },
  );

  // POST /internal/assistant/analysis-status -- requer analyses:read
  app.post(
    '/analysis-status',
    {
      schema: {
        hide: true,
        body: AnalysisStatusBodySchema,
        response: { 200: AnalysisStatusResponseSchema },
      },
    },
    async (req, reply) => {
      checkToken(req.headers['x-internal-token']);
      const result = await getAnalysisStatus(db, req.body.principal, req.body.lead_id);
      return reply.status(200).send(result);
    },
  );

  // POST /internal/assistant/billing-upcoming -- requer billing:read
  app.post(
    '/billing-upcoming',
    {
      schema: {
        hide: true,
        body: BillingUpcomingBodySchema,
        response: { 200: BillingUpcomingResponseSchema },
      },
    },
    async (req, reply) => {
      checkToken(req.headers['x-internal-token']);
      const result = await getBillingUpcoming(db, req.body.principal, req.body.query);
      return reply.status(200).send(result);
    },
  );

  // POST /internal/assistant/lead-conversation -- requer livechat:conversation:read
  // LGPD: response contem messages[].content (PII bruta) -- nao logar (pino.redact
  // cobre `*.content` em app.ts). DLP do gateway LangGraph redige antes do LLM.
  app.post(
    '/lead-conversation',
    {
      schema: {
        hide: true,
        body: LeadConversationBodySchema,
        response: { 200: LeadConversationResponseSchema },
      },
    },
    async (req, reply) => {
      checkToken(req.headers['x-internal-token']);
      const result = await getLeadConversation(db, req.body.principal, req.body.lead_id);
      return reply.status(200).send(result);
    },
  );
};

export default internalAssistantRoutes;
