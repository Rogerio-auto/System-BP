// =============================================================================
// simulations/routes.ts — Rotas do módulo de simulações de crédito.
//
// Endpoints:
//   POST /api/simulations              — cria simulação para um lead via UI (F2-S04).
//   GET  /api/leads/:id/simulations    — histórico paginado de simulações por lead (F2-S08).
//   POST /api/simulations/:id/send     — envia simulação por WhatsApp (F14-S05).
//
// Segurança:
//   - authenticate(): JWT obrigatório.
//   - authorize({ permissions: ['simulations:create'] }): RBAC para POST criar.
//   - authorize({ permissions: ['simulations:read'] }): RBAC para GET.
//   - authorize({ permissions: ['simulations:send'] }): RBAC para POST enviar.
//   - featureGate('credit_simulation.enabled'): flag para criar/listar.
//   - featureGate('simulations.send.enabled'): flag para envio WhatsApp.
//   - City scope do lead validado na service layer.
//
// LGPD: body/params contêm apenas IDs + números (sem PII bruta).
//   pino.redact cobre body.* como medida extra no app.ts.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { featureGate } from '../../plugins/featureGate.js';
import { ForbiddenError } from '../../shared/errors.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { createSimulationController, sendSimulationController } from './controller.js';
import { findLeadForSimulation, findSimulationsByLeadId } from './repository.js';
import {
  SendSimulationBodySchema,
  SendSimulationResponseSchema,
  SimulationCreateSchema,
  SimulationListQuerySchema,
  SimulationListResponseSchema,
  SimulationResponseSchema,
} from './schemas.js';

const CREATE_PERMS: [string, ...string[]] = ['simulations:create'];
const READ_PERMS: [string, ...string[]] = ['simulations:read'];
const SEND_PERMS: [string, ...string[]] = ['simulations:send'];

export const simulationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // POST /api/simulations — cria simulação via UI
  //
  // Fluxo:
  //   1. authenticate() valida JWT → popula request.user.
  //   2. authorize() verifica simulations:create.
  //   3. featureGate() bloqueia se credit_simulation.enabled=false → 403.
  //   4. Controller → service:
  //      a. city scope check (403 se fora).
  //      b. produto ativo (404 se inexistente/inativo).
  //      c. regra ativa para cidade (409 se nenhuma).
  //      d. validação amount/termMonths (422 se fora dos limites).
  //      e. cálculo Price ou SAC.
  //      f. transação: INSERT + UPDATE leads/cards + outbox + audit.
  //   5. Retorna 201 com simulação completa.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/simulations',
    {
      schema: {
        tags: ['Simulations'],
        summary: 'Criar simulacao',
        description: 'Cria uma simulacao de credito com os parametros fornecidos.',
        security: [{ bearerAuth: [] }],
        body: SimulationCreateSchema,
        response: {
          201: SimulationResponseSchema,
        },
      },
      preHandler: [
        authorize({ permissions: CREATE_PERMS }),
        featureGate('credit_simulation.enabled'),
      ],
    },
    createSimulationController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/leads/:id/simulations — histórico paginado de simulações (F2-S08)
  //
  // Fluxo:
  //   1. authenticate() valida JWT → popula request.user.
  //   2. authorize() verifica simulations:read.
  //   3. City scope: verifica se lead pertence ao scope do usuário (403 se fora).
  //   4. Pagina simulações do lead em ordem decrescente de created_at.
  //   5. Retorna lista com nextCursor para paginação por cursor.
  //
  // LGPD: resposta não contém PII do lead — apenas dados financeiros e metadados.
  // ---------------------------------------------------------------------------
  app.get(
    '/api/leads/:id/simulations',
    {
      schema: {
        tags: ['Simulations'],
        summary: 'Listar simulacoes do lead',
        description: 'Lista todas as simulacoes de credito de um lead.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid('lead id deve ser UUID') }),
        querystring: SimulationListQuerySchema,
        response: {
          200: SimulationListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: READ_PERMS })],
    },
    async (request, reply) => {
      if (!request.user) {
        throw new ForbiddenError('Contexto de usuário ausente');
      }

      const { id: leadId } = request.params;
      const { cursor, limit } = request.query;
      const { organizationId, cityScopeIds } = request.user;

      // City scope check: lead deve pertencer ao scope do usuário
      const lead = await findLeadForSimulation(db, leadId, organizationId, cityScopeIds);
      if (!lead) {
        throw new ForbiddenError('Lead não encontrado ou fora do escopo do usuário');
      }

      const items = await findSimulationsByLeadId(db, leadId, organizationId, {
        cursor,
        limit,
      });

      // Map DB items to response shape (numeric strings → numbers)
      const data = items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        amount: parseFloat(item.amountRequested),
        termMonths: item.termMonths,
        monthlyPayment: parseFloat(item.monthlyPayment),
        totalAmount: parseFloat(item.totalAmount),
        totalInterest: parseFloat(item.totalInterest),
        rateMonthlySnapshot: parseFloat(item.rateMonthlySnapshot),
        amortizationMethod: item.amortizationMethod,
        amortizationTable: item.amortizationTable,
        ruleVersion: item.ruleVersion,
        origin: item.origin,
        createdAt: item.createdAt.toISOString(),
      }));

      // Determine nextCursor: id of last item if we got a full page
      const effectiveLimit = Math.min(limit ?? 20, 100);
      const nextCursor =
        data.length === effectiveLimit ? (data[data.length - 1]?.id ?? null) : null;

      return reply.status(200).send({ data, nextCursor });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/simulations/:id/send — dispara simulação por WhatsApp (F14-S05)
  //
  // Fluxo:
  //   1. authenticate() valida JWT → popula request.user.
  //   2. authorize() verifica simulations:send.
  //   3. featureGate() bloqueia se simulations.send.enabled=false → 403.
  //   4. Controller → service:
  //      a. Flag check (segunda camada).
  //      b. Simulação existe na org → 404 se não.
  //      c. City scope do lead → 403 se fora.
  //      d. Lead tem phoneE164 → 422 se não.
  //      e. Idempotência: Idempotency-Key já usado → 200 already_sent.
  //      f. Monta variáveis do template.
  //      g. MetaWhatsAppClient.sendTemplate → 502 se falha/não configurado.
  //      h. Transação: INSERT interaction + EMIT outbox + AUDIT.
  //   5. Retorna 200 com { status, sent_message_id }.
  //
  // Header obrigatório:
  //   Idempotency-Key: <UUID v4> — garante que re-tentativas não gerem envios duplos.
  //
  // LGPD: params.id e header Idempotency-Key são IDs opacos.
  //   PII (nome, telefone) é tratado internamente no service — nunca logado.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/simulations/:id/send',
    {
      schema: {
        tags: ['Simulations'],
        summary: 'Enviar simulação por WhatsApp',
        description:
          'Envia ao lead, via WhatsApp, uma mensagem com os dados da simulação de crédito ' +
          '(nome, valor, parcelas, valor da parcela, taxa mensal) usando o template aprovado ' +
          '`simulacao_resultado`. Requer header `Idempotency-Key` (UUID) para garantir que ' +
          're-tentativas não disparem mensagens duplicadas. ' +
          'Responde `already_sent` se a chave já foi usada nesta organização. ' +
          'Retorna 502 se a integração Meta WhatsApp não estiver configurada.',
        security: [{ bearerAuth: [] }],
        body: SendSimulationBodySchema,
        params: z.object({
          id: z.string().uuid('id deve ser UUID').describe('UUID da simulação a enviar'),
        }),
        headers: z
          .object({
            // Idempotency-Key é UUID obrigatório — previne envios duplicados.
            // O schema de headers no Zod usa lowercase por convenção HTTP.
            // .passthrough() obrigatório: Fastify enviará outros headers (host, accept, etc.)
            // que não devem causar falha de validação.
            'idempotency-key': z
              .string()
              .uuid('Idempotency-Key deve ser UUID v4')
              .describe('UUID único por tentativa de envio — re-usar para idempotência'),
          })
          .passthrough(),
        response: {
          200: SendSimulationResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: SEND_PERMS }), featureGate('simulations.send.enabled')],
    },
    sendSimulationController,
  );
};
