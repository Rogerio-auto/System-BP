// =============================================================================
// workers/kanban-on-qualification.ts -- Handler do evento leads.qualified.
//
// Responsabilidade:
//   Consumir leads.qualified (via outbox-publisher) e elevar a prioridade do
//   card no stage atual (pre_atendimento) para sinalizar que a IA qualificou
//   o lead -- sem mover de stage.
//
// Fluxo por evento:
//   1. Extrair lead_id e organization_id do evento.
//   2. Carregar kanban_card pelo lead_id + org.
//   3. Se card inexistente -> skip (lead sem card -- estado tolerado).
//   4. Se card ja com priority > 0 -> no-op (idempotente).
//   5. Em transacao:
//      a. update kanban_cards.priority para 1 (qualificado pela IA)
//      b. insertHistory (actorUserId = null -> acao de sistema/IA)
//      c. auditLog (actor = null -- acao de sistema)
//
// Idempotencia:
//   O outbox-publisher garante dedupe via event_processing_logs.
//   Esta funcao tambem e idempotente: card com priority > 0 -> no-op.
//
// LGPD s8.5: Handler manipula apenas IDs opacos. Nenhum PII e lido ou logado.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import type { Database } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { kanbanCards, kanbanStageHistory } from '../db/schema/index.js';
import type { KanbanCard } from '../db/schema/index.js';
import type { LeadsQualifiedData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';

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
  name: 'kanban-on-qualification',
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

async function findCardByLeadId(
  database: Database,
  leadId: string,
  organizationId: string,
): Promise<KanbanCard | undefined> {
  const [row] = await database
    .select()
    .from(kanbanCards)
    .where(and(eq(kanbanCards.leadId, leadId), eq(kanbanCards.organizationId, organizationId)))
    .limit(1);
  return row;
}

/**
 * Processa um evento leads.qualified:
 *   - Eleva priority do card para 1 (qualificado pela IA) se ainda em 0.
 *   - NAO move o card para outro stage.
 *
 * Idempotente: chamadas repetidas com card ja em priority > 0 sao no-op.
 */
export async function handleLeadQualified(database: Database, event: EventOutbox): Promise<void> {
  const logger = baseLogger.child({ correlation_id: event.id });

  const payload = event.payload as Partial<LeadsQualifiedData>;
  const leadId = payload.lead_id;
  const organizationId = event.organizationId;

  if (!leadId) {
    logger.warn({ eventId: event.id }, 'payload invalido -- lead_id ausente; skip');
    return;
  }

  const card = await findCardByLeadId(database, leadId, organizationId);

  if (!card) {
    logger.warn({ eventId: event.id, leadId, organizationId }, 'kanban_card nao encontrado; skip');
    return;
  }

  const cardId = card.id;

  if (card.priority > 0) {
    logger.debug({ cardId, leadId, priority: card.priority }, 'card ja qualificado; no-op');
    return;
  }

  const now = new Date();

  await database.transaction(async (tx) => {
    const txDb = tx as unknown as Database;
    const txForAudit = tx as unknown as AuditTx;

    await txDb
      .update(kanbanCards)
      .set({ priority: 1, updatedAt: now })
      .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, organizationId)));

    await txDb.insert(kanbanStageHistory).values({
      cardId,
      fromStageId: card.stageId,
      toStageId: card.stageId,
      actorUserId: null,
      transitionedAt: now,
      metadata: {
        source: 'worker:kanban-on-qualification',
        action: 'priority_elevated',
        priority_before: 0,
        priority_after: 1,
        eventId: event.id,
      },
    });

    await auditLog(txForAudit, {
      organizationId,
      actor: null,
      action: 'kanban.card_qualified_by_ai',
      resource: { type: 'kanban_card', id: cardId },
      before: { priority: 0, stageId: card.stageId },
      after: { priority: 1, stageId: card.stageId },
      correlationId: event.id,
    });
  });

  logger.info(
    { cardId, leadId, stageId: card.stageId },
    'card marcado como qualificado (priority=1)',
  );
}

/**
 * Retorna um EventHandler pronto para registrar via registerHandler().
 */
export function buildKanbanOnQualificationHandler(
  _db: Database = db,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleLeadQualified(_db, event);
}
