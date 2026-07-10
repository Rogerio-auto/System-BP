// =============================================================================
// notifications/realtime.ts — Push em tempo real de notificações in-app (F24-S08).
//
// Publica o evento `notification.new` na fila `hm.q.socket.relay` para a sala
// pessoal `user:{userId}` (join automático feito por plugins/socket.ts ao
// autenticar o handshake). O relay existente (workers/livechat-socket-relay.ts)
// consome `{room,event,data}` e emite via Socket.io — nenhuma mudança no relay
// é necessária; ele já roteia qualquer sala/evento publicado.
//
// Gate: feature flag `notifications.realtime.enabled`. Quando desabilitada,
// a função é no-op (nenhuma mensagem é publicada na fila).
//
// LGPD (doc 17 §8.5):
//   - Payload contém apenas IDs opacos + título curto — sem `body` (pode ter PII
//     indireta como nome/valor de parcela) e sem qualquer outro dado bruto.
//   - Nada é logado além do evento/flag status (sem título, sem IDs de entidade).
//
// Uso: chamado por senders/inApp.ts após persistir a notificação no banco.
// =============================================================================
import type { Database } from '../../db/client.js';
import { requireFlag } from '../../lib/featureFlags.js';
import { logger } from '../../lib/logger.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';

/** Severidade da notificação — usada pelo frontend para estilo do badge/toast. */
export type NotificationSocketSeverity = 'info' | 'warning' | 'critical';

/** Payload mínimo enviado ao socket relay — sem body/PII (doc 17 §8.5). */
export interface NotificationSocketData {
  id: string;
  type: string;
  title: string;
  severity: NotificationSocketSeverity;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export interface PublishNotificationSocketInput {
  organizationId: string;
  userId: string;
  notification: NotificationSocketData;
}

/**
 * Publica `notification.new` na fila `hm.q.socket.relay` para a sala `user:{userId}`.
 *
 * Comportamento:
 *   - No-op quando `notifications.realtime.enabled` está desabilitada (não publica).
 *   - Não lança em falha de publish do broker — a persistência da notificação já
 *     ocorreu antes desta chamada; tempo real é um enhancement, não deve derrubar
 *     o fluxo principal. O caller decide como tratar (ex: fire-and-forget + log).
 */
export async function publishNotificationSocket(
  db: Database,
  input: PublishNotificationSocketInput,
): Promise<void> {
  const enabled = await requireFlag(db, 'notifications.realtime.enabled', logger);
  if (!enabled) return;

  const { organizationId, userId, notification } = input;

  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, organizationId, {
      room: `user:${userId}`,
      event: 'notification.new',
      data: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        severity: notification.severity,
        entityType: notification.entityType,
        entityId: notification.entityId,
        createdAt: notification.createdAt,
      },
    }),
  );
}
