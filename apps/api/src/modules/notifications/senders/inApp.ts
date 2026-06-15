// =============================================================================
// notifications/senders/inApp.ts — Sender in-app (F15-S06).
//
// Grava linha na tabela `notifications` para exibição no sino/central do frontend.
// É o único sender que persiste em banco — email e whatsapp são externos.
//
// LGPD §8.5: title/body podem ter PII indireta — não logar sem redact.
// =============================================================================
import type { Database } from '../../../db/client.js';
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
}

/**
 * Persiste notificação in-app no banco.
 * Lança AppError 500 se INSERT falhar (tratado pelo consumer do outbox).
 */
export async function sendInApp(db: Database, input: InAppSenderInput): Promise<void> {
  await createNotification(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    channel: 'in_app',
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  });
}
