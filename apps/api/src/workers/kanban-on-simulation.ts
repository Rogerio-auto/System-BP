// =============================================================================
// workers/kanban-on-simulation.ts — Handler do evento simulations.generated.
//
// Responsabilidade:
//   Consumir simulations.generated (via outbox-publisher) e mover o card do
//   lead para o stage "Simulação" quando ainda estiver em "Pré-atendimento".
//
// Fluxo por evento:
//   1. Extrair lead_id, simulation_id e organization_id do evento.
//   2. Carregar kanban_card pelo lead_id + org.
//   3. Se card inexistente → skip (lead sem card — estado tolerado).
//   4. Atualizar kanban_cards.last_simulation_id (garante consistência — F2-S04
//      já faz isso na transação de criação, mas eventos externos podem não ter).
//   5. Carregar stage atual (fromStage) pelo card.stageId.
//   6. Carregar stage inicial "Pré-atendimento" (orderIndex = 0) da org.
//   7. Se fromStage.id !== preAtendimentoStage.id → no-op (idempotente; sem regressão).
//   8. Carregar stage destino "Simulação" (orderIndex = 1) da org.
//   9. Em transação:
//      a. insertHistory (actorUserId = null → transição de sistema)
//      b. updateCardStage + enteredStageAt
//      c. emit kanban.stage_updated no outbox
//      d. auditLog (actor = null — ação de sistema)
//
// Idempotência:
//   O outbox-publisher garante dedupe via event_processing_logs (event_id, handler_name).
//   Esta função também é idempotente: chamadas repetidas sobre evento já processado
//   caem no passo 7 (card já avançou → no-op).
//
// LGPD §8.5:
//   Handler manipula apenas IDs opacos. Nenhum PII é lido ou logado.
//   correlation_id nos logs = event.id para rastreabilidade.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import type { Database } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { kanbanCards, kanbanStages, kanbanStageHistory } from '../db/schema/index.js';
import type { KanbanCard, KanbanStage } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { SimulationsGeneratedData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';

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
  name: 'kanban-on-simulation',
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
// Índices de stage canônicos (doc 01 §72 + seed.ts)
// ---------------------------------------------------------------------------

/** orderIndex do stage inicial "Pré-atendimento". */
const ORDER_PRE_ATENDIMENTO = 0;

/** orderIndex do stage "Simulação" (destino desta transição automática). */
const ORDER_SIMULACAO = 1;

// ---------------------------------------------------------------------------
// Queries locais
// (kanban/repository.ts não está em files_allowed; duplicamos o mínimo necessário)
// ---------------------------------------------------------------------------

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

async function findStageByOrderIndex(
  database: Database,
  orderIndex: number,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await database
    .select()
    .from(kanbanStages)
    .where(
      and(eq(kanbanStages.orderIndex, orderIndex), eq(kanbanStages.organizationId, organizationId)),
    )
    .limit(1);
  return row;
}

async function findStageById(
  database: Database,
  stageId: string,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await database
    .select()
    .from(kanbanStages)
    .where(and(eq(kanbanStages.id, stageId), eq(kanbanStages.organizationId, organizationId)))
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Handler principal — exportado para testes unitários
// ---------------------------------------------------------------------------

/**
 * Processa um evento simulations.generated:
 *   - Atualiza kanban_cards.last_simulation_id.
 *   - Move o card para "Simulação" se ainda em "Pré-atendimento".
 *
 * Idempotente: chamadas repetidas são no-op após o card já ter avançado.
 *
 * @param database  Instância Drizzle injetável (facilita mocking em testes).
 * @param event     EventOutbox com eventName = 'simulations.generated'.
 */
export async function handleSimulationGenerated(
  database: Database,
  event: EventOutbox,
): Promise<void> {
  const logger = baseLogger.child({ correlation_id: event.id });

  // -------------------------------------------------------------------------
  // 1. Extrair payload tipado
  // -------------------------------------------------------------------------
  // Justificativa do `as`: event.payload é unknown por design do outbox (§8.5).
  // Validamos os campos essenciais antes de usá-los.
  const payload = event.payload as Partial<SimulationsGeneratedData>;

  const leadId = payload.lead_id;
  const simulationId = payload.simulation_id;
  const organizationId = event.organizationId;

  if (!leadId || !simulationId) {
    logger.warn(
      { eventId: event.id, hasLeadId: Boolean(leadId), hasSimulationId: Boolean(simulationId) },
      'payload inválido — lead_id ou simulation_id ausente; skip',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Carregar kanban_card pelo lead_id
  // -------------------------------------------------------------------------
  const card = await findCardByLeadId(database, leadId, organizationId);

  if (!card) {
    logger.warn(
      { eventId: event.id, leadId, organizationId },
      'kanban_card não encontrado para o lead; skip',
    );
    return;
  }

  const cardId = card.id;

  // -------------------------------------------------------------------------
  // 3. Carregar stage atual do card
  // -------------------------------------------------------------------------
  const fromStage = await findStageById(database, card.stageId, organizationId);

  if (!fromStage) {
    logger.warn(
      { eventId: event.id, cardId, stageId: card.stageId },
      'stage atual do card não encontrado na org; skip',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Atualizar last_simulation_id (sempre — garante consistência)
  //    F2-S04 já faz isso na transação de criação; este update cobre eventos
  //    vindos de fontes externas (ex: importação assíncrona).
  // -------------------------------------------------------------------------
  await database
    .update(kanbanCards)
    .set({ lastSimulationId: simulationId, updatedAt: new Date() })
    .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, organizationId)));

  logger.debug({ cardId, simulationId }, 'last_simulation_id atualizado');

  // -------------------------------------------------------------------------
  // 5. Verificar se o card está em Pré-atendimento (orderIndex = 0)
  //    Sem regressão: se já avançou, encerra.
  // -------------------------------------------------------------------------
  const preAtendimentoStage = await findStageByOrderIndex(
    database,
    ORDER_PRE_ATENDIMENTO,
    organizationId,
  );

  if (!preAtendimentoStage) {
    logger.warn(
      { eventId: event.id, organizationId },
      'stage Pré-atendimento (orderIndex=0) não encontrado na org; skip',
    );
    return;
  }

  if (fromStage.id !== preAtendimentoStage.id) {
    logger.debug(
      { cardId, currentStage: fromStage.name, currentOrderIndex: fromStage.orderIndex },
      'card já avançou além de Pré-atendimento — no-op',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 6. Carregar stage destino "Simulação" (orderIndex = 1)
  // -------------------------------------------------------------------------
  const simulacaoStage = await findStageByOrderIndex(database, ORDER_SIMULACAO, organizationId);

  if (!simulacaoStage) {
    logger.warn(
      { eventId: event.id, organizationId },
      'stage Simulação (orderIndex=1) não encontrado na org; skip',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 7. Mover card em transação atômica
  // -------------------------------------------------------------------------
  const toStageId = simulacaoStage.id;
  const now = new Date();

  await database.transaction(async (tx) => {
    // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
    // As interfaces AuditTx e DrizzleTx são estruturais e compatíveis com a transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // 7a. Histórico de transição (append-only)
    //     actorUserId = null → transição automática de sistema (ver kanbanStageHistory.ts §58)
    await txDb.insert(kanbanStageHistory).values({
      cardId,
      fromStageId: fromStage.id,
      toStageId,
      actorUserId: null,
      transitionedAt: now,
      metadata: {
        source: 'worker:kanban-on-simulation',
        eventId: event.id,
      },
    });

    // 7b. Atualizar stage + enteredStageAt
    await txDb
      .update(kanbanCards)
      .set({ stageId: toStageId, enteredStageAt: now, updatedAt: now })
      .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, organizationId)));

    // 7c. Emitir kanban.stage_updated no outbox
    // LGPD §8.5: payload contém apenas IDs opacos e nomes de stage (sem PII).
    // idempotencyKey sufixado com event.id garante unicidade por evento-fonte.
    await emit(txForEmit, {
      eventName: 'kanban.stage_updated',
      aggregateType: 'kanban_card',
      aggregateId: cardId,
      organizationId,
      actor: { kind: 'system', id: 'worker:kanban-on-simulation', ip: null },
      idempotencyKey: `kanban.stage_updated:${cardId}:sim:${event.id}`,
      data: {
        card_id: cardId,
        lead_id: leadId,
        from_stage: fromStage.name,
        to_stage: simulacaoStage.name,
        from_status: fromStage.isTerminalWon ? 'won' : fromStage.isTerminalLost ? 'lost' : 'normal',
        to_status: simulacaoStage.isTerminalWon
          ? 'won'
          : simulacaoStage.isTerminalLost
            ? 'lost'
            : 'normal',
        reason: 'simulation_generated',
      },
    });

    // 7d. Audit log — actor = null (ação de sistema)
    // LGPD: before/after contêm apenas stage IDs e nomes de stage (sem PII).
    await auditLog(txForAudit, {
      organizationId,
      actor: null,
      action: 'kanban.stage_updated',
      resource: { type: 'kanban_card', id: cardId },
      before: { stageId: fromStage.id, stageName: fromStage.name },
      after: { stageId: toStageId, stageName: simulacaoStage.name },
      correlationId: event.id,
    });
  });

  logger.info(
    { cardId, leadId, fromStage: fromStage.name, toStage: simulacaoStage.name },
    'card movido para Simulação',
  );
}

// ---------------------------------------------------------------------------
// Fábrica de EventHandler — compatível com RegisteredHandler.fn
// ---------------------------------------------------------------------------

/**
 * Retorna um EventHandler pronto para registrar via registerHandler().
 *
 * Usa db singleton de db/client.js. Chamado em workers/index.ts → setupWorkerHandlers().
 * Injeção via argumento `_db` disponível apenas em testes (vi.mock de db/client.js
 * substitui o default antes do import — argumento não é necessário em produção).
 */
export function buildKanbanOnSimulationHandler(
  _db: Database = db,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleSimulationGenerated(_db, event);
}
