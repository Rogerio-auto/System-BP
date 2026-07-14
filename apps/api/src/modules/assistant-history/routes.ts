// =============================================================================
// modules/assistant-history/routes.ts — CRUD do histórico persistente do
// copiloto interno (F6-S25).
//
// Permissão: ai_assistant:use (mesma do copiloto — migration 0083).
// Owner-scoped: cada usuário só vê/edita as próprias conversas (escopo
// privado, DPIA §4.5).
//
// Sem featureGate() aqui de propósito: a flag `assistant.history.enabled` é
// checada DENTRO do service, porque o comportamento por rota difere —
// GET /conversations retorna lista vazia (200) com a flag off, nunca 403/500
// (ver service.ts para o restante do mapeamento flag-off -> resposta).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/index.js';

import {
  createConversationController,
  deleteConversationController,
  getConversationController,
  listConversationsController,
  renameConversationController,
} from './controller.js';
import {
  ConversationDetailResponseSchema,
  ConversationIdParamsSchema,
  ConversationListResponseSchema,
  ConversationSummarySchema,
  CreateConversationBodySchema,
  DeleteConversationResponseSchema,
  RenameConversationBodySchema,
} from './schemas.js';

const AI_ASSISTANT_USE: [string, ...string[]] = ['ai_assistant:use'];

export const assistantHistoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());
  app.addHook('preHandler', authorize({ permissions: AI_ASSISTANT_USE }));

  // ---------------------------------------------------------------------------
  // GET /api/assistant/conversations — lista as conversas do usuário autenticado
  // ---------------------------------------------------------------------------
  app.get(
    '/api/assistant/conversations',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Lista as conversas do usuário no copiloto interno',
        description:
          'Retorna o esqueleto (id, título, timestamps) das conversas ATIVAS do usuário ' +
          'autenticado, mais recentes primeiro. Escopo estritamente privado — nunca inclui ' +
          'conversas de outro usuário. Requer ai_assistant:use. Enquanto a flag ' +
          '`assistant.history.enabled` estiver desligada, retorna sempre lista vazia (o ' +
          'histórico ainda não é gravado).',
        security: [{ bearerAuth: [] }],
        response: { 200: ConversationListResponseSchema },
      },
    },
    listConversationsController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/assistant/conversations/:id — abre uma conversa com os turnos
  // ---------------------------------------------------------------------------
  app.get(
    '/api/assistant/conversations/:id',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Abre uma conversa do copiloto interno com seus turnos',
        description:
          'Retorna a conversa e os turnos (pergunta higienizada + narrativa + blocos ' +
          'referenciados por entidade, sem dado hidratado). Owner-scoped: conversa de outro ' +
          'usuário, inexistente ou soft-deletada retorna 404 — nunca 403, para não vazar a ' +
          'existência do recurso.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamsSchema,
        response: { 200: ConversationDetailResponseSchema },
      },
    },
    getConversationController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/assistant/conversations — cria uma conversa vazia
  // ---------------------------------------------------------------------------
  app.post(
    '/api/assistant/conversations',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Cria uma nova conversa vazia no copiloto interno',
        description:
          'Cria o esqueleto de uma conversa para o usuário autenticado. Título opcional — ' +
          'quando informado, é higienizado (DLP de CPF/telefone + mascaramento de nome) antes ' +
          'de gravar; quando omitido, recebe um título padrão. Indisponível (404) enquanto a ' +
          'flag `assistant.history.enabled` estiver desligada.',
        security: [{ bearerAuth: [] }],
        body: CreateConversationBodySchema,
        response: { 201: ConversationSummarySchema },
      },
    },
    createConversationController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/assistant/conversations/:id — renomeia
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/assistant/conversations/:id',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Renomeia uma conversa do copiloto interno',
        description:
          'Atualiza o título da conversa. O novo título é higienizado (DLP + mascaramento de ' +
          'nome) antes de gravar. Owner-scoped: conversa de outro usuário ou inexistente ' +
          'retorna 404.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamsSchema,
        body: RenameConversationBodySchema,
        response: { 200: ConversationSummarySchema },
      },
    },
    renameConversationController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/assistant/conversations/:id — soft-delete
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/assistant/conversations/:id',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Remove (soft-delete) uma conversa do copiloto interno',
        description:
          'Marca a conversa como removida (`deleted_at`) — some da listagem. Owner-scoped: ' +
          'conversa de outro usuário, inexistente ou já removida retorna 404.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamsSchema,
        response: { 200: DeleteConversationResponseSchema },
      },
    },
    deleteConversationController,
  );
};
