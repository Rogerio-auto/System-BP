// =============================================================================
// notifications/schemas.ts — Schemas Zod locais do módulo de notificações (F15-S06).
//
// Re-exporta schemas públicos de @elemento/shared-schemas e define schemas
// locais de query/param para uso interno nas rotas.
//
// F24-S09: estende preferências de canal para "por categoria × canal".
//   - notificationCategorySchema / NotificationCategory re-exportados do shared-schemas.
//   - NotificationPreferencesBatchUpdateSchema aceita `category` opcional por item.
//   - NotificationPreferencesListSchema inclui `category` na resposta.
// =============================================================================
import 'zod-openapi/extend';

import {
  notificationCategorySchema,
  PushPublicKeyResponseSchema,
  PushSubscriptionAckSchema,
  PushSubscriptionRequestSchema,
  PushUnsubscribeAckSchema,
  PushUnsubscribeQuerySchema,
} from '@elemento/shared-schemas';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Re-exporta schemas públicos (usados nas rotas como request/response)
// ---------------------------------------------------------------------------
export {
  NotificationChannelSchema,
  NotificationSchema,
  NotificationListResponseSchema,
  NotificationPreferenceSchema,
  NotificationPreferenceUpdateSchema,
  // F24-S09: enum de categorias — reutilizado pelo worker de fan-out
  notificationCategorySchema,
} from '@elemento/shared-schemas';

export type {
  NotificationChannel,
  Notification,
  NotificationListResponse,
  NotificationPreference,
  NotificationPreferenceUpdate,
  // F24-S09
  NotificationCategory,
  // F27-S06 — Web Push
  PushSubscriptionRequest,
  PushSubscriptionAck,
  PushUnsubscribeQuery,
  PushUnsubscribeAck,
  PushPublicKeyResponse,
} from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const notificationIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da notificação'),
});

export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>;

// ---------------------------------------------------------------------------
// Query — GET /api/notifications
// ---------------------------------------------------------------------------

export const NotificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Página (1-indexed)'),
    per_page: z.coerce.number().int().min(1).max(100).default(20).describe('Itens por página'),
  })
  .openapi({
    example: { page: 1, per_page: 20 },
  });

export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

// ---------------------------------------------------------------------------
// Body — PUT /api/notifications/preferences
//
// F24-S09: cada item aceita agora `category` opcional.
//   - Ausente / null  → preferência genérica do canal (retrocompat).
//   - Valor de enum   → preferência específica para aquela categoria.
//
// max(21) = 3 canais × (1 genérica + 6 categorias)
// ---------------------------------------------------------------------------

export const NotificationPreferencesBatchUpdateSchema = z
  .object({
    preferences: z
      .array(
        z.object({
          channel: z.enum(['in_app', 'email', 'whatsapp']).describe('Canal de entrega'),
          enabled: z.boolean().describe('true = ativo; false = silenciado'),
          category: notificationCategorySchema
            .nullable()
            .optional()
            .describe(
              'Categoria de notificação. Omitir ou null = preferência global do canal (retrocompat); ' +
                'fornecer um valor = preferência específica para aquela categoria.',
            ),
        }),
      )
      .min(1)
      .max(21)
      .describe(
        'Lista de preferências a atualizar. ' +
          'max 21: 3 canais × (1 global + 6 categorias). ' +
          'Items sem category sobrescrevem o default global do canal.',
      ),
  })
  .openapi({
    example: {
      preferences: [
        { channel: 'in_app', enabled: true },
        { channel: 'email', enabled: false },
        { channel: 'in_app', enabled: false, category: 'billing' },
        { channel: 'email', enabled: true, category: 'billing' },
      ],
    },
  });

export type NotificationPreferencesBatchUpdate = z.infer<
  typeof NotificationPreferencesBatchUpdateSchema
>;

// ---------------------------------------------------------------------------
// Response — lista/matriz de preferências
//
// F24-S09: cada item inclui `category` (opcional para retrocompat com clientes
// existentes que não enviam o campo).
//
//   category = null/ausente → preferência global do canal (default do canal).
//   category = string       → preferência específica para aquela categoria.
// ---------------------------------------------------------------------------

export const NotificationPreferencesListSchema = z
  .object({
    data: z.array(
      z.object({
        channel: z.enum(['in_app', 'email', 'whatsapp']),
        enabled: z.boolean(),
        category: notificationCategorySchema
          .nullable()
          .optional()
          .describe(
            'Categoria desta preferência. null = default genérico do canal; ' +
              'string = preferência específica por categoria.',
          ),
      }),
    ),
  })
  .openapi({
    example: {
      data: [
        { channel: 'in_app', enabled: true, category: null },
        { channel: 'email', enabled: false, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
        { channel: 'in_app', enabled: false, category: 'billing' },
      ],
    },
  });

export type NotificationPreferencesList = z.infer<typeof NotificationPreferencesListSchema>;

// ---------------------------------------------------------------------------
// Web Push (F27-S06) — decoração OpenAPI local sobre o contrato compartilhado
// de @elemento/shared-schemas (mesmo padrão de NotificationListQuerySchema
// acima: schema local com `.openapi({ example })` sobre tipos re-exportados).
// ---------------------------------------------------------------------------

export const PushSubscriptionBodySchema = PushSubscriptionRequestSchema.openapi({
  example: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123-device-endpoint',
    keys: {
      p256dh:
        'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
    userAgent: 'Chrome 128 / Windows 11',
  },
});

export const PushSubscriptionAckResponseSchema = PushSubscriptionAckSchema.openapi({
  example: { subscribed: true },
});

export const PushUnsubscribeQuerySchemaLocal = PushUnsubscribeQuerySchema.openapi({
  example: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123-device-endpoint' },
});

export const PushUnsubscribeAckResponseSchema = PushUnsubscribeAckSchema.openapi({
  example: { unsubscribed: true },
});

export const PushPublicKeyResponseSchemaLocal = PushPublicKeyResponseSchema.openapi({
  example: {
    public_key: 'BExamplePublicVapidKeyBase64UrlSafe0000000000000000000000',
  },
});
