// =============================================================================
// channels/routes.ts — Rotas do módulo de canais (F16-S11).
//
// Rotas:
//   POST   /api/channels/connect — conectar canal manual (provider discriminado)
//   GET    /api/channels         — listar canais da organização
//   DELETE /api/channels/:id     — desativar canal (soft-delete)
//
// RBAC:
//   channel.connect → write (POST connect + DELETE)
//   channel.connect → read  (GET list)
//
// Nota: permissão usa `channel.connect` (slot §Escopo) não `livechat:channel:write`.
// Seed migration 0062 adiciona estas permissões ao catálogo.
//
// LGPD:
//   - Nenhuma coluna PII retornada no response (sem phoneNumber, tokens).
//   - body de POST: phoneNumber/accessToken/appSecret cifrados antes de persistir.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  connectChannelController,
  connectEmbeddedSignupController,
  deleteChannelController,
  discoverMetaWhatsAppController,
  listChannelsController,
  setDefaultChannelController,
} from './controller.js';
import {
  ChannelIdParamSchema,
  ChannelListQuerySchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  ConnectChannelSchema,
  MetaDiscoverBodySchema,
  MetaDiscoverResponseSchema,
  MetaEmbeddedSignupBodySchema,
  SetDefaultChannelParamSchema,
} from './schemas.js';

export const channelsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // POST /api/channels/connect — conectar canal por entrada manual de credenciais
  // ---------------------------------------------------------------------------
  app.post(
    '/api/channels/connect',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Conectar canal de mensagem',
        description:
          'Conecta um novo canal de mensagem (WhatsApp, Instagram ou WAHA) via entrada ' +
          'manual de credenciais obtidas no painel da Meta. ' +
          'As credenciais (access_token, app_secret) são cifradas com AES-256-GCM antes ' +
          'de serem persistidas e nunca aparecem na resposta. ' +
          'Para meta_whatsapp, as credenciais são verificadas contra a Meta Graph API ' +
          'antes de persistir — retorna 422 se o token for inválido. ' +
          'Retorna 409 se o canal (provider + phoneNumberId/igUserId/wahaSessionId) ' +
          'já estiver cadastrado na organização.',
        security: [{ bearerAuth: [] }],
        body: ConnectChannelSchema,
        response: {
          201: ChannelResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['channel.connect'] })],
    },
    connectChannelController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/channels — listar canais da organização
  // ---------------------------------------------------------------------------
  app.get(
    '/api/channels',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Listar canais',
        description:
          'Lista os canais de mensagem da organização com city scope automático. ' +
          'Filtro opcional por status (active/inactive). ' +
          'Canais deletados (soft-delete) não são incluídos. ' +
          'Credenciais (access_token, app_secret) e PII (phoneNumber) nunca retornados.',
        security: [{ bearerAuth: [] }],
        querystring: ChannelListQuerySchema,
        response: {
          200: ChannelListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['channel.connect'] })],
    },
    listChannelsController,
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/channels/:id — desativar canal (soft-delete)
  // ---------------------------------------------------------------------------
  app.delete(
    '/api/channels/:id',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Desativar canal',
        description:
          'Remove (soft-delete) um canal de mensagem. ' +
          'O canal não é fisicamente deletado — deleted_at é marcado com now(). ' +
          'Retorna 404 se o canal não for encontrado ou já tiver sido removido. ' +
          'Audit log CHANNEL_DELETED é registrado na mesma transação.',
        security: [{ bearerAuth: [] }],
        params: ChannelIdParamSchema,
        response: {
          204: { type: 'null', description: 'Canal desativado com sucesso' },
        },
      },
      preHandler: [authorize({ permissions: ['channel.connect'] })],
    },
    deleteChannelController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/channels/:id/default — definir canal padrão
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/channels/:id/default',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Definir canal padrão',
        description:
          'Define o canal como padrão da organização em transação única: ' +
          'SET is_default = false para todos os canais da org, depois ' +
          'SET is_default = true para o canal :id. ' +
          'Garante que exatamente um canal tenha is_default = true por org. ' +
          'Retorna 404 se o canal não for encontrado. ' +
          'Permissão: channels:manage.',
        security: [{ bearerAuth: [] }],
        params: SetDefaultChannelParamSchema,
        response: {
          200: ChannelResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['channels:manage'] })],
    },
    setDefaultChannelController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/channels/meta/whatsapp/discover — Meta Embedded Signup (passo 1)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/channels/meta/whatsapp/discover',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Descobrir canais via Meta SDK (passo 1)',
        description:
          'Troca o code OAuth retornado pelo SDK do Facebook (FB.login) por um ' +
          'access_token temporário e lista os números de WhatsApp acessíveis. ' +
          'Retorna um pendingToken JWT (válido 10min) + lista de phones. ' +
          'O pendingToken encapsula o access_token — nunca exposto ao frontend. ' +
          'LGPD: code descartado após troca; access_token encapsulado no JWT (sem PII de titular).',
        security: [{ bearerAuth: [] }],
        body: MetaDiscoverBodySchema,
        response: {
          200: MetaDiscoverResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['channel.connect'] })],
    },
    discoverMetaWhatsAppController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/channels/meta/whatsapp/embedded-signup — Meta Embedded Signup (passo 2)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/channels/meta/whatsapp/embedded-signup',
    {
      schema: {
        tags: ['Canais'],
        summary: 'Conectar canal via Meta SDK (passo 2)',
        description:
          'Finaliza a conexão de um canal WhatsApp Business via Embedded Signup. ' +
          'Recebe o pendingToken do passo 1 + o phoneNumberId selecionado pelo usuário. ' +
          'Verifica a credencial via Graph API, cifra e persiste em transação. ' +
          'Equivalente ao /connect mas com credenciais gerenciadas pelo fluxo OAuth. ' +
          'Retorna 409 se o número já estiver cadastrado. ' +
          'LGPD: access_token cifrado (encryptPii) antes de persistir — nunca retornado.',
        security: [{ bearerAuth: [] }],
        body: MetaEmbeddedSignupBodySchema,
        response: {
          201: ChannelResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['channel.connect'] })],
    },
    connectEmbeddedSignupController,
  );
};
