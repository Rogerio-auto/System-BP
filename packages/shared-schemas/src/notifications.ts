// =============================================================================
// notifications.ts — Schemas Zod públicos do domínio de notificações.
//
// Compartilhados entre frontend (exibição/marcação de lido) e backend
// (routes + service). Preferências controlam quais canais o usuário recebe.
//
// Origem: tabelas `notifications` e `notification_preferences` criadas em F15-S03.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Canal de entrega da notificação.
 * in_app = central de notificações no frontend.
 * email = e-mail transacional.
 * whatsapp = mensagem WhatsApp (template aprovado).
 */
export const NotificationChannelSchema = z.enum(['in_app', 'email', 'whatsapp'], {
  errorMap: () => ({ message: 'channel inválido' }),
});
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// ---------------------------------------------------------------------------
// Response (campos da tabela notifications)
// ---------------------------------------------------------------------------

/**
 * Schema de resposta de uma notificação — alinhado com a tabela `notifications`
 * criada em F15-S03.
 */
export const NotificationSchema = z.object({
  /** UUID primário da notificação. */
  id: z.string().uuid(),

  /** Organização dona da notificação (multi-tenant). */
  organization_id: z.string().uuid(),

  /** Usuário destinatário da notificação. */
  user_id: z.string().uuid(),

  /** Canal pelo qual a notificação foi entregue. */
  channel: NotificationChannelSchema,

  /** Título curto exibido no sino/central. */
  title: z.string(),

  /** Corpo completo da notificação. Pode conter markdown simples. */
  body: z.string(),

  /**
   * Tipo da entidade relacionada ao evento que gerou a notificação.
   * Ex: 'task', 'loan', 'customer'.
   * null = notificação não vinculada a entidade específica.
   */
  entity_type: z.string().nullable(),

  /**
   * UUID da entidade relacionada.
   * null = notificação não vinculada a entidade específica.
   */
  entity_id: z.string().uuid().nullable(),

  /**
   * Timestamp em que o usuário marcou como lida.
   * null = não lida ainda. ISO 8601 com offset.
   */
  read_at: z.string().datetime({ offset: true }).nullable(),

  /** Timestamp de criação. */
  created_at: z.string().datetime({ offset: true }),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---------------------------------------------------------------------------
// List response
// ---------------------------------------------------------------------------

/**
 * Resposta paginada da central de notificações.
 * Inclui contador de não-lidas para o badge do sino.
 */
export const NotificationListResponseSchema = z.object({
  data: z.array(NotificationSchema),
  /** Total de notificações não lidas do usuário (independente de paginação). */
  unread_count: z.number().int().describe('Não-lidas do usuário — usado no badge do sino'),
  /** Total de notificações que atendem ao filtro. */
  total: z.number().int(),
  page: z.number().int(),
  per_page: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

/**
 * Schema de uma preferência de notificação — alinhado com a tabela
 * `notification_preferences` criada em F15-S03.
 *
 * A chave composta é (organization_id, user_id, channel, event_type) —
 * resolvida pelo service via contexto do JWT.
 */
export const NotificationPreferenceSchema = z.object({
  /** Canal ao qual a preferência se aplica. */
  channel: NotificationChannelSchema,

  /**
   * Tipo do evento controlado pela preferência.
   * Ex: 'task.assigned', 'loan.overdue', 'collection.updated'.
   */
  event_type: z.string().min(1).describe('Tipo canônico do evento (ex: task.assigned)'),

  /** true = recebe notificação; false = silenciado para este canal+evento. */
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

/**
 * Schema de update de preferência — idêntico ao schema de leitura.
 * PUT /api/notifications/preferences recebe exatamente estes campos.
 * organization_id e user_id são extraídos do JWT pelo service.
 */
export const NotificationPreferenceUpdateSchema = NotificationPreferenceSchema;
export type NotificationPreferenceUpdate = z.infer<typeof NotificationPreferenceUpdateSchema>;
