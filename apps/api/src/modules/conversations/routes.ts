// =============================================================================
// conversations/routes.ts — Rotas de leitura do inbox (F16-S12).
//
// Rotas:
//   GET /api/conversations             — lista conversas (inbox)
//   GET /api/conversations/:id         — detalhe de uma conversa
//   GET /api/conversations/:id/messages — histórico de mensagens (cursor)
//   GET /api/conversations/:id/window  — estado da janela de composição
//
// RBAC:
//   - livechat:conversation:read → todas as rotas de leitura
//   - crm:contact:phone:read    → campo contactPhone no detalhe (verificado em runtime)
//
// LGPD (doc 17 §8.1, §14.2):
//   - Listagem: SEM contactPhone (PII de telefone protegida)
//   - Detalhe: contactPhone decifrado apenas com permissão crm:contact:phone:read
//   - Logs: redact de content, contactName, contactPhone (via pino na service layer)
//   - Labels: lgpd-impact (slot F16-S12)
//
// City scope: applyCityScope aplicado via actor.cityScopeIds (injetado pelo authenticate).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedParams, typedQuery } from '../../shared/fastify-types.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import type { ConversationIdParam, ConversationListQuery, MessageListQuery } from './schemas.js';
import {
  ConversationDetailResponseSchema,
  ConversationIdParamSchema,
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  MessageListQuerySchema,
  MessageListResponseSchema,
  WindowStateSchema,
} from './schemas.js';
import type { ActorContext } from './service.js';
import {
  getConversationDetailService,
  getMessagesService,
  getWindowService,
  listConversationsService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: extrai ActorContext de request.user (garantido por authenticate())
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    // Não deve ocorrer se authenticate() está no preHandler — defensivo
    throw new ForbiddenError(
      'Contexto de usuário ausente — authenticate() deve preceder authorize()',
    );
  }

  return {
    userId: request.user.id,
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds,
    permissions: request.user.permissions,
  };
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export const conversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // -------------------------------------------------------------------------
  // GET /api/conversations — lista conversas do inbox
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Listar conversas do inbox',
        description:
          'Lista as conversas do inbox com filtros por status, canal e agente. ' +
          'Aplica city scope automático baseado no perfil do usuário autenticado. ' +
          'Paginação por cursor baseado no ID da última conversa retornada. ' +
          'LGPD: contactPhone nunca incluído na listagem — use o endpoint de detalhe ' +
          'com permissão crm:contact:phone:read para obter o telefone decifrado.',
        security: [{ bearerAuth: [] }],
        querystring: ConversationListQuerySchema,
        response: {
          200: ConversationListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:read'] })],
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const actor = getActorContext(request);
      const query = typedQuery<ConversationListQuery>(request);
      const result = await listConversationsService(db, actor, query);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/conversations/:id — detalhe de uma conversa
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations/:id',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Detalhe de uma conversa',
        description:
          'Retorna o detalhe de uma conversa incluindo o estado atual da janela de composição. ' +
          'O campo `contactPhone` (número de telefone decifrado) é incluído apenas se o usuário ' +
          'possuir a permissão `crm:contact:phone:read`. ' +
          'Retorna 404 se a conversa não existir ou não pertencer ao escopo do usuário (city scope). ' +
          'LGPD: telefone nunca logado — campo protegido por permissão dedicada.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        response: {
          200: ConversationDetailResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:read'] })],
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const actor = getActorContext(request);
      const { id } = typedParams<ConversationIdParam>(request);

      // Verifica permissão de PII de telefone em runtime (não bloqueia a rota se ausente)
      const hasPhonePermission =
        actor.permissions.includes('*') || actor.permissions.includes('crm:contact:phone:read');

      const result = await getConversationDetailService(db, actor, id, hasPhonePermission);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/conversations/:id/messages — histórico de mensagens
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations/:id/messages',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Histórico de mensagens de uma conversa',
        description:
          'Lista as mensagens de uma conversa em ordem cronológica crescente. ' +
          'Paginação por cursor regressivo: use `before` com o ID da mensagem mais antiga ' +
          'já carregada para obter mensagens anteriores. ' +
          'Ao acessar este endpoint, as mensagens inbound são automaticamente marcadas ' +
          'como lidas e o `unreadCount` da conversa é zerado. ' +
          'Retorna 404 se a conversa não existir ou não pertencer ao escopo do usuário. ' +
          'LGPD: campo `content` contém texto de mensagens (PII) — não logar em produção.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        querystring: MessageListQuerySchema,
        response: {
          200: MessageListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:read'] })],
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const actor = getActorContext(request);
      const { id } = typedParams<ConversationIdParam>(request);
      const query = typedQuery<MessageListQuery>(request);

      const result = await getMessagesService(db, actor, id, query);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/conversations/:id/window — estado da janela de composição
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations/:id/window',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Estado da janela de composição',
        description:
          'Retorna o estado atual da janela de composição para uma conversa. ' +
          'A janela determina se o agente pode enviar mensagens livres ou apenas templates. ' +
          'Matriz de janela por provider: ' +
          'meta_whatsapp = livre (<24h) ou template_only (>24h); ' +
          'meta_instagram = livre (<24h), human_agent_tag (24h–7d) ou closed (>7d); ' +
          'waha = sempre open (sem restrição de janela). ' +
          'Retorna 404 se a conversa não existir ou não pertencer ao escopo do usuário.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        response: {
          200: WindowStateSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:read'] })],
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const actor = getActorContext(request);
      const { id } = typedParams<ConversationIdParam>(request);

      const result = await getWindowService(db, actor, id);
      return reply.status(200).send(result);
    },
  );
};
