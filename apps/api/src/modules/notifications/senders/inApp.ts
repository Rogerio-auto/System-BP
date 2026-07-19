// =============================================================================
// notifications/senders/inApp.ts — Sender in-app (F15-S06).
//
// Grava linha na tabela `notifications` para exibição no sino/central do frontend.
// É o único sender que persiste em banco — email e whatsapp são externos.
//
// F24-S08: após persistir, publica `notification.new` no socket relay (sala
// `user:{userId}`) atrás da flag `notifications.realtime.enabled`. Fire-and-forget:
// falha de publish não deve impedir a criação da notificação (já persistida).
//
// LGPD §8.5: title/body podem ter PII indireta — não logar sem redact.
// =============================================================================
import type { Database } from '../../../db/client.js';
import { logger } from '../../../lib/logger.js';
import type { NotificationSocketSeverity } from '../realtime.js';
import { publishNotificationSocket } from '../realtime.js';
import { createNotification } from '../repository.js';

export interface InAppSenderInput {
  organizationId: string;
  userId: string;
  /** Tipo canônico da notificação — ex: 'in_app:task.created'. */
  type: string;
  /** Título curto exibido no badge (sem PII direta). */
  title: string;
  /** Corpo completo da notificação. */
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Severidade para estilo do badge/toast em tempo real. Default: 'info'. */
  severity?: NotificationSocketSeverity;
}

/**
 * Persiste notificação in-app no banco e publica push em tempo real (F24-S08).
 * Lança AppError 500 se INSERT falhar (tratado pelo consumer do outbox).
 */
export async function sendInApp(db: Database, input: InAppSenderInput): Promise<void> {
  // Mesma severidade recebida vai ao banco (F26-S03) e ao socket (F24-S08) —
  // a linha persistida deixa de ficar dessincronizada do payload em tempo real.
  const severity = input.severity ?? 'info';

  const notification = await createNotification(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    channel: 'in_app',
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    severity,
  });

  // Fire-and-forget: tempo real é um enhancement, não bloqueia a criação já persistida.
  publishNotificationSocket(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    notification: {
      id: notification.id,
      type: input.type,
      title: notification.title,
      severity,
      entityType: notification.entity_type,
      entityId: notification.entity_id,
      createdAt: notification.created_at,
    },
  }).catch((err: unknown) => {
    logger.warn(
      { event: 'notifications.realtime.publish_failed', err },
      'inApp: falha ao publicar push em tempo real (non-blocking)',
    );
  });
}
