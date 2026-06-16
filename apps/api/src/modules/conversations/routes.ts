// =============================================================================
// conversations/routes.ts — Rotas de envio, atribuição e resolução (F16-S13).
//
// Rotas:
//   POST  /api/conversations/:id/messages           — enviar mensagem (atendente humano)
//   POST  /api/conversations/:id/uploads/signed-url — gerar PUT signed-url R2 (mídia)
//   PATCH /api/conversations/:id/assign             — atribuir agente
//   PATCH /api/conversations/:id/resolve            — resolver conversa
//
// RBAC:
//   livechat:message:send       → POST /messages
//   livechat:message:send       → POST /uploads/signed-url
//   livechat:conversation:manage → PATCH /assign
//   livechat:conversation:manage → PATCH /resolve
//
// Idempotência (POST /messages):
//   Header `Idempotency-Key` obrigatório — evita duplo envio por retry.
//   Mesmo Idempotency-Key retorna a resposta original (202 com messageId cacheado).
//
// LGPD (doc 17 §8.1, §8.3, §8.5):
//   - `content` e campos de mídia NÃO são logados pelo Fastify (apenas IDs).
//   - Logs do pino sem PII (redact no send.service.ts).
//   - Signed-URL R2 sem PII na key (orgId opaco + UUID).
//
// Nota: este arquivo é registrado em app.ts após S12 (que adiciona rotas de leitura).
// S13 adiciona apenas as rotas de ESCRITA a este arquivo.
// =============================================================================
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams } from '../../shared/fastify-types.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import type { AssignBody, SendMessageBody, SignedUrlBody } from './send.schema.js';
import {
  AssignBodySchema,
  AssignResponseSchema,
  ConversationIdParamSchema,
  ResolveResponseSchema,
  SendMessageBodySchema,
  SendMessageResponseSchema,
  SignedUrlBodySchema,
  SignedUrlResponseSchema,
} from './send.schema.js';
import type { SendActorContext } from './send.service.js';
import {
  assignConversation,
  generateUploadSignedUrl,
  resolveConversation,
  sendMessage,
} from './send.service.js';

// ---------------------------------------------------------------------------
// Helper: extrai o contexto do ator do request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): SendActorContext {
  // `as` justificado: authenticate() garante que request.user está definido antes
  // de qualquer handler ser invocado. A verificação defensiva abaixo detecta erros
  // de configuração em testes sem o preHandler correto.
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, permissions, cityScopeIds } = request.user;
  const role = permissions[0] ?? 'unknown';

  return {
    userId: id,
    organizationId,
    role,
    cityScopeIds,
    ip: request.ip,
    userAgent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

// ---------------------------------------------------------------------------
// conversationsRoutes — plugin Fastify
// ---------------------------------------------------------------------------

export const conversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // -------------------------------------------------------------------------
  // POST /api/conversations/:id/messages — enviar mensagem
  // -------------------------------------------------------------------------
  app.post(
    '/api/conversations/:id/messages',
    {
      schema: {
        tags: ['Conversas'],
        summary: 'Enviar mensagem',
        description:
          'Envia uma mensagem de um atendente humano para o contato via canal configurado. ' +
          'A mensagem é persistida com status `pending` e enfileirada para envio assíncrono ' +
          'pelo worker outbound (S10). ' +
          '\n\n' +
          '**Janela 24h:** Para WhatsApp e Instagram, mensagens de texto livre (`type=text`) ' +
          'só são permitidas dentro da janela de 24h após a última mensagem inbound do contato. ' +
          'Fora da janela, use `type=template` com um template pré-aprovado na Meta. ' +
          '\n\n' +
          '**Idempotência:** O header `Idempotency-Key` é obrigatório. Reenviar com a mesma ' +
          'chave retorna a resposta original (202) sem duplicar o envio. ' +
          '\n\n' +
          '**LGPD:** O conteúdo da mensagem não é logado internamente.',
        security: [{ bearerAuth: [] }],
        headers: z.object({
          'idempotency-key': z
            .string()
            .min(1)
            .max(255)
            .describe(
              'Chave de idempotência única por tentativa de envio. ' +
                'Reenvios com a mesma chave retornam a resposta original.',
            ),
        }),
        params: ConversationIdParamSchema,
        body: SendMessageBodySchema,
        response: {
          202: SendMessageResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:message:send'] })],
    },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const body = typedBody<SendMessageBody>(request);

      // Header Idempotency-Key — validado pelo schema Zod acima
      // `as` justificado: Zod valida o header antes do handler; o campo é garantido.
      const idempotencyKey = (request.headers as Record<string, string | undefined>)[
        'idempotency-key'
      ] as string;

      const result = await sendMessage(db, actor, conversationId, body, idempotencyKey);
      return reply.status(202).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/conversations/:id/uploads/signed-url — gerar PUT signed-url R2
  // -------------------------------------------------------------------------
  app.post(
    '/api/conversations/:id/uploads/signed-url',
    {
      schema: {
        tags: ['Conversas'],
        summary: 'Gerar URL de upload de mídia',
        description:
          'Gera uma URL pré-assinada (PUT) para upload direto de arquivo de mídia ao R2. ' +
          'Use esta URL para fazer upload antes de enviar a mensagem com `type=media`. ' +
          'A URL expira em 15 minutos. ' +
          '\n\n' +
          'Após o upload, use `publicMediaUrl` no body de `POST /conversations/:id/messages`. ' +
          '\n\n' +
          '**LGPD:** A chave do objeto no R2 não contém PII — formato: ' +
          '`outbound/{orgId}/{uuid}.{ext}`.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        body: SignedUrlBodySchema,
        response: {
          200: SignedUrlResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:message:send'] })],
    },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const body = typedBody<SignedUrlBody>(request);

      const result = await generateUploadSignedUrl(db, actor, conversationId, body);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/conversations/:id/assign — atribuir agente
  // -------------------------------------------------------------------------
  app.patch(
    '/api/conversations/:id/assign',
    {
      schema: {
        tags: ['Conversas'],
        summary: 'Atribuir agente à conversa',
        description:
          'Atribui um agente humano à conversa ou remove a atribuição atual (agentId=null). ' +
          'Publica evento `conversation:updated` no socket relay para atualização em tempo real. ' +
          '\n\n' +
          'Use `agentId: null` para desatribuir a conversa (inbox sem dono).',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        body: AssignBodySchema,
        response: {
          200: AssignResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:manage'] })],
    },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const body = typedBody<AssignBody>(request);

      const result = await assignConversation(db, actor, conversationId, body);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/conversations/:id/resolve — resolver conversa
  // -------------------------------------------------------------------------
  app.patch(
    '/api/conversations/:id/resolve',
    {
      schema: {
        tags: ['Conversas'],
        summary: 'Resolver conversa',
        description:
          'Marca a conversa como `resolved` (encerrada). ' +
          'O contato pode reabrir a conversa com uma nova mensagem inbound. ' +
          'Publica evento `conversation:resolved` no socket relay para atualização em tempo real.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        response: {
          200: ResolveResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:manage'] })],
    },
    async (request, reply) => {
      const actor = getActorContext(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);

      const result = await resolveConversation(db, actor, conversationId);
      return reply.status(200).send(result);
    },
  );
};
