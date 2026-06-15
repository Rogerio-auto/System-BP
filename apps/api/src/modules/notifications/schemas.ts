// =============================================================================
// notifications/schemas.ts — Schemas Zod locais do módulo de notificações (F15-S06).
//
// Re-exporta schemas públicos de @elemento/shared-schemas e define schemas
// locais de query/param para uso interno nas rotas.
// =============================================================================
import 'zod-openapi/extend';

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
} from '@elemento/shared-schemas';

export type {
  NotificationChannel,
  Notification,
  NotificationListResponse,
  NotificationPreference,
  NotificationPreferenceUpdate,
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
// (lista de preferências para upsert em batch)
// ---------------------------------------------------------------------------

export const NotificationPreferencesBatchUpdateSchema = z
  .object({
    preferences: z
      .array(
        z.object({
          channel: z.enum(['in_app', 'email', 'whatsapp']).describe('Canal de entrega'),
          enabled: z.boolean().describe('true = ativo; false = silenciado'),
        }),
      )
      .min(1)
      .max(3)
      .describe('Lista de preferências a atualizar (max 3 — um por canal)'),
  })
  .openapi({
    example: {
      preferences: [
        { channel: 'in_app', enabled: true },
        { channel: 'email', enabled: false },
        { channel: 'whatsapp', enabled: true },
      ],
    },
  });

export type NotificationPreferencesBatchUpdate = z.infer<
  typeof NotificationPreferencesBatchUpdateSchema
>;

// ---------------------------------------------------------------------------
// Response — lista de preferências
// ---------------------------------------------------------------------------

export const NotificationPreferencesListSchema = z
  .object({
    data: z.array(
      z.object({
        channel: z.enum(['in_app', 'email', 'whatsapp']),
        enabled: z.boolean(),
      }),
    ),
  })
  .openapi({
    example: {
      data: [
        { channel: 'in_app', enabled: true },
        { channel: 'email', enabled: false },
        { channel: 'whatsapp', enabled: true },
      ],
    },
  });

export type NotificationPreferencesList = z.infer<typeof NotificationPreferencesListSchema>;
