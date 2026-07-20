// =============================================================================
// notifications.ts — Schemas Zod públicos do domínio de notificações.
//
// Compartilhados entre frontend (exibição/marcação de lido) e backend
// (routes + service). Preferências controlam quais canais o usuário recebe.
//
// Origem: tabelas `notifications` e `notification_preferences` criadas em F15-S03.
// =============================================================================
import { z } from 'zod';

import { notificationSeveritySchema } from './notification-rules.js';

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

/**
 * Severidade visual da notificação (F26-S03) — mesmo domínio de valores de
 * notification_rules.severity e do payload do socket em tempo real
 * (NotificationSocketSeverity, F24-S08). Reusa o schema canônico já definido
 * em notification-rules.ts (evita dois enums divergentes do mesmo domínio
 * de valores; `NotificationSeverity` já é exportado de lá via index.ts).
 */
export const NotificationSeveritySchema = notificationSeveritySchema;

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
   * Severidade visual — diferencia crítico/aviso/informativo na lista.
   * Persistida na linha desde F26-S03 (antes só existia no payload do socket
   * e desaparecia no reload). Default 'info' cobre notificações legadas.
   */
  severity: NotificationSeveritySchema,

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

// ---------------------------------------------------------------------------
// Web Push subscription (F27-S06 — doc 24 §5/§8)
//
// Contrato compartilhado frontend×backend para o registro/remoção de uma
// subscription de Web Push (VAPID). O shape espelha exatamente
// `PushSubscription.toJSON()` do navegador (endpoint + keys.p256dh/auth).
//
// LGPD (doc 17): endpoint/p256dh/auth identificam device/usuário — DADO
// PESSOAL. Nunca logado em claro (pino.redact); soft-delete no opt-out.
// ---------------------------------------------------------------------------

/** Chaves ECDH exigidas pelo protocolo Web Push (RFC 8291). */
export const PushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1).describe('Chave pública ECDH do client (RFC 8291)'),
  auth: z.string().min(1).describe('Segredo de autenticação do client (RFC 8291)'),
});
export type PushSubscriptionKeys = z.infer<typeof PushSubscriptionKeysSchema>;

/**
 * Allowlist de hosts de push service reconhecidos (anti-SSRF).
 *
 * O `endpoint` de uma subscription é uma URL escolhida pelo cliente para a qual
 * o backend fará POST via `web-push`. Sem allowlist, um usuário autenticado
 * poderia registrar um host interno (metadata da nuvem, painéis de infra) e usar
 * o backend como proxy de requisição (SSRF). Restringimos a `https://` + os
 * hosts dos push services padrão (FCM/Mozilla/Apple/WNS). Server-side, aplicado
 * na borda (Zod) e reforçado no sender (defesa em profundidade).
 */
const ALLOWED_PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
const ALLOWED_PUSH_HOST_SUFFIXES: readonly string[] = ['.notify.windows.com', '.push.apple.com'];

/** `true` se `endpoint` é uma URL HTTPS de um push service reconhecido. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_PUSH_HOSTS.includes(host)) return true;
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const PUSH_ENDPOINT_ERROR =
  'endpoint deve ser uma URL HTTPS de um push service reconhecido (FCM/Mozilla/Apple/WNS)';

/**
 * Body de `POST /api/notifications/push/subscription` — registra/atualiza a
 * subscription do device do usuário autenticado. Idempotente por `endpoint`
 * (upsert no repositório).
 */
export const PushSubscriptionRequestSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(isAllowedPushEndpoint, { message: PUSH_ENDPOINT_ERROR })
    .describe('URL do push service do browser/OS (FCM/Mozilla/Apple)'),
  keys: PushSubscriptionKeysSchema,
  userAgent: z
    .string()
    .max(500)
    .optional()
    .describe('User-Agent do browser — rótulo do device para a UI de gestão'),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>;

/** Resposta de ack do subscribe — sem PII (nunca ecoa endpoint/keys). */
export const PushSubscriptionAckSchema = z.object({
  subscribed: z.literal(true),
});
export type PushSubscriptionAck = z.infer<typeof PushSubscriptionAckSchema>;

/**
 * Querystring de `DELETE /api/notifications/push/subscription` — remove a
 * subscription do device (opt-out/logout). Idempotente.
 */
export const PushUnsubscribeQuerySchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine(isAllowedPushEndpoint, { message: PUSH_ENDPOINT_ERROR })
    .describe('Endpoint da subscription a ser removida'),
});
export type PushUnsubscribeQuery = z.infer<typeof PushUnsubscribeQuerySchema>;

/** Resposta de ack do unsubscribe. */
export const PushUnsubscribeAckSchema = z.object({
  unsubscribed: z.literal(true),
});
export type PushUnsubscribeAck = z.infer<typeof PushUnsubscribeAckSchema>;

/**
 * Resposta de `GET /api/notifications/push/public-key`.
 * `public_key: null` quando o Web Push não está disponível (flag/env
 * desligados) — a UI de opt-in deve se esconder nesse caso.
 */
export const PushPublicKeyResponseSchema = z.object({
  public_key: z.string().nullable().describe('Chave pública VAPID; null se push indisponível'),
});
export type PushPublicKeyResponse = z.infer<typeof PushPublicKeyResponseSchema>;
