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
  deleteChannelController,
  listChannelsController,
} from './controller.js';
import {
  ChannelIdParamSchema,
  ChannelListQuerySchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  ConnectChannelSchema,
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
};
