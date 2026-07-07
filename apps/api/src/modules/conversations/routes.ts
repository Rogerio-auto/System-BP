// =============================================================================
// conversations/routes.ts — Rotas de leitura e escrita do inbox (F16-S12 + F16-S13).
//
// Rotas GET (F16-S12):
//   GET /api/conversations                          — lista conversas (inbox)
//   GET /api/conversations/:id                      — detalhe de uma conversa
//   GET /api/conversations/:id/messages             — histórico de mensagens (cursor)
//   GET /api/conversations/:id/window               — estado da janela de composição
//
// Rotas POST/PATCH (F16-S13):
//   POST  /api/conversations/:id/messages           — enviar mensagem (atendente humano)
//   POST  /api/conversations/:id/uploads/signed-url — gerar PUT signed-url R2 (mídia)
//   PATCH /api/conversations/:id/assign             — atribuir agente
//   PATCH /api/conversations/:id/resolve            — resolver conversa
//
// RBAC:
//   livechat:conversation:read    → GET routes
//   crm:contact:phone:read        → campo contactPhone no detalhe (verificado em runtime)
//   livechat:message:send         → POST /messages, POST /uploads/signed-url
//   livechat:conversation:manage  → PATCH /assign, PATCH /resolve
//
// LGPD (doc 17 §8.1, §8.3, §8.5, §14.2):
//   - Listagem: SEM contactPhone (PII de telefone protegida)
//   - Detalhe: contactPhone decifrado apenas com permissão crm:contact:phone:read
//   - content e campos de mídia NÃO são logados (apenas IDs)
//   - Signed-URL R2 sem PII na key: outbound/{orgId}/{uuid}.{ext}
//   - Labels: lgpd-impact (slots F16-S12, F16-S13)
//
// City scope: applyCityScope aplicado via actor.cityScopeIds (injetado pelo authenticate).
// =============================================================================
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import type {
  ConversationCountsQuery,
  ConversationIdParam,
  ConversationListQuery,
  MessageListQuery,
  LinkLeadBody,
} from './schemas.js';
import {
  ConversationCountsQuerySchema,
  ConversationCountsResponseSchema,
  ConversationDetailResponseSchema,
  ConversationIdParamSchema,
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  LinkLeadBodySchema,
  LinkLeadResponseSchema,
  MessageListQuerySchema,
  MessageListResponseSchema,
  WindowStateSchema,
} from './schemas.js';
import type { AssignBody, SendMessageBody, SetStatusBody, SignedUrlBody } from './send.schema.js';
import {
  AssignBodySchema,
  AssignResponseSchema,
  ResolveResponseSchema,
  SendMessageBodySchema,
  SendMessageResponseSchema,
  SetStatusBodySchema,
  SetStatusResponseSchema,
  SignedUrlBodySchema,
  SignedUrlResponseSchema,
} from './send.schema.js';
import type { SendActorContext } from './send.service.js';
import {
  assignConversation,
  generateUploadSignedUrl,
  resolveConversation,
  sendMessage,
  setConversationStatus,
} from './send.service.js';
import type { ActorContext } from './service.js';
import {
  countConversationsService,
  getConversationDetailService,
  getConversationTemplatesService,
  getMessagesService,
  getWindowService,
  linkOrCreateConversationLead,
  listConversationsService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helpers: extrai contexto do ator de request.user (garantido por authenticate())
// ---------------------------------------------------------------------------

function getReadActor(request: FastifyRequest): ActorContext {
  if (!request.user) {
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

function getWriteActor(request: FastifyRequest): SendActorContext {
  // `as` justificado: authenticate() garante que request.user está definido antes
  // de qualquer handler ser invocado. A verificação abaixo detecta erros de config.
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
// Plugin principal
// ---------------------------------------------------------------------------

export const conversationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // =========================================================================
  // ROTAS DE LEITURA (F16-S12)
  // =========================================================================

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
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
      const query = typedQuery<ConversationListQuery>(request);
      const result = await listConversationsService(db, actor, query);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/conversations/counts — contagem por status
  // IMPORTANTE: registrado ANTES de /:id para evitar colisão de path.
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations/counts',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Contar conversas por status',
        description:
          'Retorna a contagem de conversas agrupada pelos 4 status canônicos ' +
          '(open, pending, resolved, snoozed) e o total. ' +
          '\n\n' +
          'Aceita os mesmos filtros opcionais da listagem (`channelId`, `assignedUserId`) ' +
          'para que os badges de contagem reflitam o filtro ativo na inbox. ' +
          '\n\n' +
          'Status ausentes no escopo atual retornam 0 (não omitidos). ' +
          'Aplica org scope automático baseado no usuário autenticado. ' +
          '\n\n' +
          '**Performance:** usa o índice `conversations_org_status_idx` — ' +
          'eficiente mesmo com grandes volumes de conversas.',
        security: [{ bearerAuth: [] }],
        querystring: ConversationCountsQuerySchema,
        response: {
          200: ConversationCountsResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:read'] })],
    },
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
      const query = typedQuery<ConversationCountsQuery>(request);
      const result = await countConversationsService(db, actor, query);
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
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
      const { id } = typedParams<ConversationIdParam>(request);
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
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
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
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
      const { id } = typedParams<ConversationIdParam>(request);
      const result = await getWindowService(db, actor, id);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/conversations/:id/templates — templates aprovados (F16-S19)
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations/:id/templates',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Listar templates aprovados para envio',
        description:
          'Lista os templates WhatsApp com `status=approved` da organização, ' +
          'usados quando a janela de 24h expirou e o atendente precisa retomar o contato. ' +
          '\n\n' +
          'A conversa é validada antes de retornar os templates: a rota retorna 404 ' +
          'se a conversa não existir ou não pertencer ao escopo do usuário. ' +
          '\n\n' +
          'Retorna lista vazia quando nenhum template aprovado está cadastrado. ' +
          'Nesse caso, o atendente deve acessar Configurações → Templates para configurar.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        response: {
          200: z.object({
            data: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                category: z.enum(['utility', 'marketing', 'authentication']),
                variables: z.array(z.string()),
                body_text: z.string(),
              }),
            ),
          }),
        },
      },
      preHandler: [authorize({ permissions: ['livechat:message:send'] })],
    },
    async (request: FastifyRequest, reply): Promise<void> => {
      const actor = getReadActor(request);
      const { id } = typedParams<ConversationIdParam>(request);
      const result = await getConversationTemplatesService(db, actor, id);
      return reply.status(200).send(result);
    },
  );

  // =========================================================================
  // ROTAS DE ESCRITA (F16-S13)
  // =========================================================================

  // -------------------------------------------------------------------------
  // POST /api/conversations/:id/messages — enviar mensagem
  // -------------------------------------------------------------------------
  app.post(
    '/api/conversations/:id/messages',
    {
      schema: {
        tags: ['Live Chat'],
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
      const actor = getWriteActor(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const body = typedBody<SendMessageBody>(request);
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
        tags: ['Live Chat'],
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
      const actor = getWriteActor(request);
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
        tags: ['Live Chat'],
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
      const actor = getWriteActor(request);
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
        tags: ['Live Chat'],
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
      const actor = getWriteActor(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const result = await resolveConversation(db, actor, conversationId);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/conversations/:id/status — troca genérica de status
  // -------------------------------------------------------------------------
  app.patch(
    '/api/conversations/:id/status',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Alterar status da conversa',
        description:
          'Altera o status de uma conversa para qualquer um dos 4 status canônicos: ' +
          '`open` (em aberto), `pending` (aguardando contato), ' +
          '`resolved` (encerrada) ou `snoozed` (em pausa). ' +
          '\n\n' +
          'Complemento genérico ao `/resolve` fixo — permite reverter uma resolução ' +
          '(`resolved → open`), colocar em pendência (`open → pending`) ou adiar ' +
          '(`open → snoozed`) sem precisar de um endpoint dedicado por transição. ' +
          '\n\n' +
          '**Idempotente:** enviar o mesmo status que já está gravado retorna 200 sem erro. ' +
          '\n\n' +
          '**Audit log:** toda alteração é registrada em `audit_logs` com o ator, ' +
          'o status anterior (via snapshot no before) e o status novo. ' +
          '\n\n' +
          'Publica evento `conversation:updated` no socket relay para atualização em tempo real.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        body: SetStatusBodySchema,
        response: {
          200: SetStatusResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:manage'] })],
    },
    async (request, reply) => {
      const actor = getWriteActor(request);
      const { id: conversationId } = typedParams<ConversationIdParam>(request);
      const body = typedBody<SetStatusBody>(request);
      const result = await setConversationStatus(db, actor, conversationId, body);
      return reply.status(200).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/conversations/:id/lead — vincular/criar lead da conversa (F16-S23)
  // -------------------------------------------------------------------------
  app.patch(
    '/api/conversations/:id/lead',
    {
      schema: {
        tags: ['Live Chat'],
        summary: 'Vincular ou criar lead da conversa',
        description:
          'Vincula a conversa a um lead existente ou cria+vincula um novo lead em 1 clique. ' +
          'Se leadId informado: vincula lead existente (409 se já vinculado a outro). ' +
          'Se leadId omitido: cria+vincula lead via telefone+nome do contato e cityId do canal ' +
          '(422 se canal sem cityId). Idempotente: mesmo lead já vinculado retorna 200 sem mutar. ' +
          'LGPD: audit log e socket relay sem PII bruta — apenas IDs opacos.',
        security: [{ bearerAuth: [] }],
        params: ConversationIdParamSchema,
        body: LinkLeadBodySchema,
        response: {
          200: LinkLeadResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['livechat:conversation:manage'] })],
    },
    async (request, reply) => {
      const actor = getWriteActor(request);
      const { id: conversationId } = typedParams<{ id: string }>(request);
      const body = typedBody<LinkLeadBody>(request);
      const result = await linkOrCreateConversationLead(db, actor, conversationId, body);
      return reply.status(200).send(result);
    },
  );
};
