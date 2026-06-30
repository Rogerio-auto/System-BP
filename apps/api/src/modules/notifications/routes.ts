// =============================================================================
// notifications/routes.ts — Rotas do módulo de notificações (F15-S06).
//
// Rotas:
//   GET  /api/notifications                   — minhas notificações + unread_count
//   POST /api/notifications/:id/read          — marcar como lida
//   POST /api/notifications/read-all          — marcar todas como lidas
//   GET  /api/notifications/preferences       — ver preferências de canal
//   PUT  /api/notifications/preferences       — atualizar preferências de canal
//
// RBAC:
//   - notifications:read → todas as rotas (leitura + ações sobre próprias notificações)
//
// Autenticação obrigatória em todas as rotas via addHook preHandler.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  getPreferencesController,
  listNotificationsController,
  markAllReadController,
  markReadController,
  updatePreferencesController,
} from './controller.js';
import {
  NotificationListQuerySchema,
  NotificationListResponseSchema,
  NotificationPreferencesBatchUpdateSchema,
  NotificationPreferencesListSchema,
  NotificationSchema,
  notificationIdParamSchema,
} from './schemas.js';

export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/notifications
  //
  // Retorna as notificações do usuário autenticado (paginadas) e o contador
  // de não-lidas (para o badge do sino).
  // ---------------------------------------------------------------------------
  app.get(
    '/api/notifications',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'Listar minhas notificações',
        description:
          'Retorna as notificações do usuário autenticado em ordem cronológica reversa. ' +
          'Inclui `unread_count` para atualizar o badge do sino em tempo real. ' +
          'Suporta paginação via `page` e `per_page`.',
        security: [{ bearerAuth: [] }],
        querystring: NotificationListQuerySchema,
        response: {
          200: NotificationListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['notifications:read'] })],
    },
    listNotificationsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/notifications/read-all
  //
  // Marca todas as notificações não lidas do usuário como lidas.
  // Registrado ANTES de /:id/read para evitar conflito de rota.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/notifications/read-all',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'Marcar todas como lidas',
        description:
          'Marca todas as notificações não lidas do usuário autenticado como lidas. ' +
          'Idempotente: se não há notificações não-lidas, retorna `{ marked: 0 }` sem erro.',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            marked: z
              .number()
              .int()
              .describe('Número de notificações marcadas como lidas nesta operação'),
          }),
        },
      },
      preHandler: [authorize({ permissions: ['notifications:read'] })],
    },
    markAllReadController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/notifications/:id/read
  //
  // Marca uma notificação específica como lida.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/notifications/:id/read',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'Marcar notificação como lida',
        description:
          'Marca uma notificação específica do usuário autenticado como lida, ' +
          'atualizando `read_at` com o timestamp atual. ' +
          'Idempotente: se já lida, retorna o estado atual sem erro.',
        security: [{ bearerAuth: [] }],
        params: notificationIdParamSchema,
        response: {
          200: NotificationSchema,
        },
      },
      preHandler: [authorize({ permissions: ['notifications:read'] })],
    },
    markReadController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/notifications/preferences
  //
  // Retorna a matriz (channel × category) de preferências do usuário.
  // Sempre inclui 3 itens com category=null (default por canal) e 0..N
  // overrides específicos por categoria configurados pelo usuário.
  // ---------------------------------------------------------------------------
  app.get(
    '/api/notifications/preferences',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'Ver preferências de notificação',
        description:
          'Retorna a matriz de preferências de notificação do usuário autenticado. ' +
          'A resposta inclui sempre os defaults de canal (`category: null`, `enabled: true` se não configurado) ' +
          'e os overrides de categoria configurados pelo usuário. ' +
          'Canais disponíveis: `in_app` (sino), `email`, `whatsapp`. ' +
          'Categorias disponíveis: `lifecycle_stalled`, `assignment`, `credit`, `billing`, `handoff`, `system`.',
        security: [{ bearerAuth: [] }],
        response: {
          200: NotificationPreferencesListSchema,
        },
      },
      preHandler: [authorize({ permissions: ['notifications:read'] })],
    },
    getPreferencesController,
  );

  // ---------------------------------------------------------------------------
  // PUT /api/notifications/preferences
  //
  // Atualiza preferências de canal e/ou por categoria em batch.
  // Suporta items sem category (default do canal) e com category (override).
  // Upsert idempotente: re-enviar o mesmo payload é no-op.
  // ---------------------------------------------------------------------------
  app.put(
    '/api/notifications/preferences',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'Atualizar preferências de notificação',
        description:
          'Atualiza as preferências de notificação do usuário autenticado via upsert. ' +
          'Cada item do array pode ter `category` opcional: ' +
          'sem category (ou `null`) → atualiza o default global do canal; ' +
          'com category → atualiza o override para aquela categoria específica. ' +
          'Canais omitidos não são alterados. ' +
          'Idempotente: re-enviar o mesmo payload não tem efeito colateral.',
        security: [{ bearerAuth: [] }],
        body: NotificationPreferencesBatchUpdateSchema,
        response: {
          200: NotificationPreferencesListSchema,
        },
      },
      preHandler: [authorize({ permissions: ['notifications:read'] })],
    },
    updatePreferencesController,
  );
};
