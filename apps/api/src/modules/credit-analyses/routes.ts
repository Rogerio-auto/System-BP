// =============================================================================
// credit-analyses/routes.ts — Rotas do módulo de análise de crédito (F4-S02).
//
// 7 rotas implementadas:
//   GET    /api/credit-analyses                     — lista (city-scoped)
//   GET    /api/credit-analyses/:id                 — detalhe (city-scoped)
//   GET    /api/leads/:leadId/credit-analyses        — histórico do lead (city-scoped)
//   POST   /api/credit-analyses                     — criar análise + 1ª versão em tx
//   POST   /api/credit-analyses/:id/versions        — nova versão imutável
//   POST   /api/credit-analyses/:id/decide          — aprovado | recusado
//   POST   /api/credit-analyses/:id/request-review  — Art. 20 §5 LGPD
//
// Segurança:
//   - authenticate(): JWT obrigatório em todas as rotas.
//   - authorize(): RBAC por rota.
//   - City scope aplicado no service/repository via cityScopeIds.
//
// LGPD:
//   - pino.redact cobre parecer_text, attachments no app.ts.
//   - Respostas não expõem internal_score (sempre null nas rotas públicas).
//   - Regex defensiva CPF/RG no Zod rejeita PII bruta em parecer_text.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  addVersionController,
  createAnalysisController,
  decideAnalysisController,
  getAnalysisController,
  listAnalysesByLeadController,
  listAnalysesController,
  requestReviewController,
} from './controller.js';
import {
  CreditAnalysisCreateSchema,
  CreditAnalysisDecideSchema,
  CreditAnalysisListQuerySchema,
  CreditAnalysisListResponseSchema,
  CreditAnalysisRequestReviewSchema,
  CreditAnalysisResponseSchema,
  CreditAnalysisVersionCreateSchema,
  analysisIdParamSchema,
  leadIdParamSchema,
} from './schemas.js';

// Permissões tipadas para o authorize() — garantem literais corretos
const READ_PERMS: [string, ...string[]] = ['credit_analyses:read'];
const WRITE_PERMS: [string, ...string[]] = ['credit_analyses:write'];
const DECIDE_PERMS: [string, ...string[]] = ['credit_analyses:decide'];
const REVIEW_PERMS: [string, ...string[]] = ['credit_analyses:request_review'];

export const creditAnalysesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/credit-analyses — lista paginada com filtros e city-scope
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-analyses',
    {
      schema: {
        querystring: CreditAnalysisListQuerySchema,
        response: {
          200: CreditAnalysisListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    listAnalysesController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/credit-analyses/:id — detalhe com versão atual hidratada
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-analyses/:id',
    {
      schema: {
        params: analysisIdParamSchema,
        response: {
          200: CreditAnalysisResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    getAnalysisController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/leads/:leadId/credit-analyses — histórico de análises por lead
  // ---------------------------------------------------------------------------
  app.get(
    '/api/leads/:leadId/credit-analyses',
    {
      schema: {
        params: leadIdParamSchema,
        querystring: CreditAnalysisListQuerySchema,
        response: {
          200: CreditAnalysisListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    listAnalysesByLeadController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-analyses — criar análise + 1ª versão (1 transação)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-analyses',
    {
      schema: {
        body: CreditAnalysisCreateSchema,
        response: {
          201: CreditAnalysisResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    createAnalysisController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-analyses/:id/versions — nova versão imutável
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-analyses/:id/versions',
    {
      schema: {
        params: analysisIdParamSchema,
        body: CreditAnalysisVersionCreateSchema,
        response: {
          201: CreditAnalysisResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: WRITE_PERMS })],
    },
    addVersionController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-analyses/:id/decide — decisão final (aprovado | recusado)
  //
  // Valida transição: em_analise | pendente → aprovado | recusado.
  // Emite credit_analysis.status_changed para worker do Kanban (F4-S05).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-analyses/:id/decide',
    {
      schema: {
        params: analysisIdParamSchema,
        body: CreditAnalysisDecideSchema,
        response: {
          200: CreditAnalysisResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: DECIDE_PERMS })],
    },
    decideAnalysisController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/credit-analyses/:id/request-review — Art. 20 §5 LGPD
  //
  // Titular solicita revisão humana. Reseta status para em_analise.
  // Bloqueia novas decisões automáticas até novo parecer humano.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/credit-analyses/:id/request-review',
    {
      schema: {
        params: analysisIdParamSchema,
        body: CreditAnalysisRequestReviewSchema,
        response: {
          200: CreditAnalysisResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: REVIEW_PERMS })],
    },
    requestReviewController,
  );

  // ---------------------------------------------------------------------------
  // Rota de descoberta: método não permitido para sub-caminhos inválidos
  // ---------------------------------------------------------------------------
  app.get(
    '/api/credit-analyses/:id/versions',
    {
      schema: {
        params: analysisIdParamSchema,
        response: {
          405: z.object({ error: z.string(), message: z.string() }),
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    async (_request, reply) => {
      return reply.status(405).send({
        error: 'METHOD_NOT_ALLOWED',
        message: 'Use POST /api/credit-analyses/:id/versions para adicionar versão',
      });
    },
  );
};
