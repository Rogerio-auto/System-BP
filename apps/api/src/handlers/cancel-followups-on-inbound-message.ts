// =============================================================================
// handlers/cancel-followups-on-inbound-message.ts — Handler do evento
// whatsapp.message_received (F5-S04).
//
// Responsabilidade:
//   Quando o cliente envia uma mensagem no WhatsApp, cancelar todos os
//   followup_jobs com status='scheduled' do mesmo lead, evitando enviar
//   lembretes a quem já interagiu.
//
// Fluxo por evento:
//   1. Extrair lead_id do payload. Se ausente → skip (mensagem não vinculada).
//   2. UPDATE followup_jobs SET status='cancelled', last_error='customer_replied'
//      WHERE lead_id=$1 AND organization_id=$2 AND status='scheduled'.
//   3. Emitir outbox 'followup.cancelled' por job cancelado (batch → 1 evento
//      por job, idempotência por job_id).
//   4. Audit log: actor_kind='system', action='followup_cancelled_on_reply'.
//
// Idempotência:
//   - outbox-publisher garante dedupe via event_processing_logs
//     (event_id, handler_name) — única constraint.
//   - UPDATE WHERE status='scheduled' é naturalmente idempotente:
//     se jobs já foram cancelados em execução anterior, não há linhas
//     a atualizar e o handler retorna jobs_cancelled=0.
//
// LGPD §8.5:
//   - Logs usam APENAS lead_id + job IDs (IDs opacos).
//   - Conteúdo da mensagem do cliente NUNCA é logado.
//   - Payloads dos eventos outbox não carregam PII bruta.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { z } from 'zod';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import type { Database } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { followupJobs } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { FollowupJobData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';

// ---------------------------------------------------------------------------
// Schema Zod para validação estrita do payload do evento
// ---------------------------------------------------------------------------

/**
 * Valida o payload de 'whatsapp.message_received' sem `as` inseguro.
 * Parse falha → throw (outbox-publisher registra como 'failed').
 */
const WhatsappMessageReceivedPayloadSchema = z.object({
  whatsapp_message_id: z.string(),
  chatwoot_conversation_id: z.number().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Logger auto-suficiente (sem dep do runtime do worker para evitar ciclos)
// ---------------------------------------------------------------------------

/** Redact canônico (doc 17 §8.3) — espelha _runtime.ts para evitar dep circular. */
const REDACT_PATHS = [
  '*.cpf',
  '*.email',
  '*.telefone',
  '*.phone',
  '*.password',
  '*.senha',
  '*.token',
  '*.document_number',
  '*.birth_date',
  '*.address',
];

const baseLogger = pino({
  name: 'cancel-followups-on-inbound-message',
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

// ---------------------------------------------------------------------------
// Handler principal — exportado para testes
// ---------------------------------------------------------------------------

/**
 * Processa um evento whatsapp.message_received:
 *   - Cancela todos os followup_jobs 'scheduled' do lead.
 *   - Emite followup.cancelled + audit log para cada job cancelado.
 *
 * Idempotente: se nenhum job scheduled existir, é no-op.
 *
 * @param database  Instância Drizzle injetável (facilita mocking em testes).
 * @param event     EventOutbox com eventName = 'whatsapp.message_received'.
 */
export async function handleInboundMessageReceived(
  database: Database,
  event: EventOutbox,
): Promise<void> {
  const logger = baseLogger.child({ correlation_id: event.id });

  // -------------------------------------------------------------------------
  // 1. Extrair payload com validação Zod estrita (sem `as` inseguro)
  // -------------------------------------------------------------------------
  const payload = WhatsappMessageReceivedPayloadSchema.parse(event.payload);

  const leadId = payload.lead_id ?? null;
  const organizationId = event.organizationId;

  if (!leadId) {
    // Mensagem não vinculada a um lead (ex: número desconhecido) — skip silencioso.
    logger.debug(
      { eventId: event.id },
      'whatsapp.message_received sem lead_id — skip (mensagem não vinculada a lead)',
    );
    return;
  }

  const now = new Date();

  // -------------------------------------------------------------------------
  // 2+3. SELECT FOR UPDATE SKIP LOCKED + cancelar + emitir + audit em transação
  //
  // SELECT dentro da tx fecha race com followup-sender: sem a tx, o sender
  // pode mover um job de 'scheduled' para 'triggered' entre SELECT e UPDATE.
  // FOR UPDATE SKIP LOCKED garante que jobs sendo processados pelo sender
  // (já com lock) são ignorados — evitando emitir followup.cancelled para
  // um job que vai ser enviado.
  // -------------------------------------------------------------------------
  await database.transaction(async (tx) => {
    // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
    // DrizzleTx e AuditTx são interfaces estruturais compatíveis com a transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // SELECT FOR UPDATE SKIP LOCKED fecha race com followup-sender
    const scheduledJobs = await txDb
      .select({ id: followupJobs.id, ruleId: followupJobs.ruleId })
      .from(followupJobs)
      .where(
        and(
          eq(followupJobs.leadId, leadId),
          eq(followupJobs.organizationId, organizationId),
          eq(followupJobs.status, 'scheduled'),
        ),
      )
      .for('update', { skipLocked: true });

    if (scheduledJobs.length === 0) {
      // Idempotência: nenhum job scheduled disponível — no-op.
      logger.debug(
        { eventId: event.id, lead_id: leadId },
        'nenhum followup_job scheduled para o lead — no-op',
      );
      return;
    }

    // UPDATE batch: todos os jobs locked → cancelled
    await txDb
      .update(followupJobs)
      .set({
        status: 'cancelled',
        lastError: 'customer_replied',
        updatedAt: now,
      })
      .where(
        and(
          eq(followupJobs.leadId, leadId),
          eq(followupJobs.organizationId, organizationId),
          eq(followupJobs.status, 'scheduled'),
        ),
      );

    // Emitir followup.cancelled + audit por job cancelado
    for (const job of scheduledJobs) {
      const cancelledData: FollowupJobData = {
        followup_job_id: job.id,
        lead_id: leadId,
        rule_id: job.ruleId,
      };

      await emit(txForEmit, {
        eventName: 'followup.cancelled',
        aggregateType: 'followup_job',
        aggregateId: job.id,
        organizationId,
        actor: { kind: 'system', id: null, ip: null },
        // Chave determinística: job_id + event originador — garante unicidade
        // mesmo que o evento whatsapp.message_received seja processado 2x.
        idempotencyKey: `followup.cancelled:${job.id}:reply:${event.id}`,
        data: cancelledData,
      });

      await auditLog(txForAudit, {
        organizationId,
        actor: null,
        action: 'followup_cancelled_on_reply',
        resource: { type: 'followup_job', id: job.id },
        after: {
          job_id: job.id,
          lead_id: leadId,
          reason: 'customer_replied',
          // Apenas IDs — sem conteúdo da mensagem (LGPD §8.5)
          triggering_event_id: event.id,
        },
        correlationId: event.id,
      });
    }

    logger.info(
      {
        event: 'followup.cancelled_on_reply',
        lead_id: leadId,
        jobs_cancelled: scheduledJobs.length,
      },
      `${String(scheduledJobs.length)} followup_job(s) cancelado(s) por resposta do cliente`,
    );
  });
}

// ---------------------------------------------------------------------------
// Fábrica de EventHandler — compatível com RegisteredHandler.fn
// ---------------------------------------------------------------------------

/**
 * Retorna um EventHandler pronto para registrar via registerHandler().
 *
 * Usa db singleton de db/client.js. Chamado em workers/index.ts → setupWorkerHandlers().
 * Injeção via argumento `_db` disponível apenas em testes.
 */
export function buildCancelFollowupsOnReplyHandler(
  _db: Database = db,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleInboundMessageReceived(_db, event);
}
