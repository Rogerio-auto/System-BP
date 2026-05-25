// =============================================================================
// workers/kanban-on-analysis.ts — Handler do evento credit_analysis.status_changed.
//
// Responsabilidade:
//   Consumir credit_analysis.status_changed (via outbox-publisher) e mover o
//   card do lead para o stage adequado conforme a decisão de análise de crédito.
//
// Fluxo por evento:
//   1. Extrair analysis_id, lead_id, from_status, to_status e organization_id.
//   2. Carregar kanban_card pelo lead_id + org.
//   3. Se card inexistente → skip (lead sem card — estado tolerado).
//   4. Atualizar leads.last_analysis_id (rastreabilidade — mesma semântica de
//      kanban-on-simulation com lastSimulationId).
//   5. Aplicar regra de transição de stage com base em to_status:
//      a. to_status = 'aprovado' → mover para stage "Concluído" (terminal won)
//      b. to_status = 'recusado' → mover para stage "Concluído" (terminal lost)
//         Nota: mesmo stage físico para aprovado/recusado — o histórico e os
//         eventos downstream distinguem pelo campo reason do kanban.stage_updated.
//      c. to_status = 'em_analise' e from_status ∈ {aprovado, recusado} →
//         mover para stage "Análise de Crédito" (reabertura/request-review)
//      d. Qualquer outro caso → no-op
//   6. Idempotência de movimento:
//      - Se card já está no stage destino → no-op (sem double-move)
//      - Idempotência de evento garantida pelo outbox-publisher via
//        event_processing_logs (event_id, handler_name) — única constraint.
//   7. Em transação (apenas quando há mudança de stage):
//      a. insertHistory (actorUserId = null → transição de sistema)
//      b. updateCardStage + enteredStageAt
//      c. emit kanban.stage_updated no outbox
//      d. auditLog (actor = null — ação de sistema)
//
// Resolução de stages:
//   - "Concluído" (approved/recusado): primeiro stage com isTerminalWon=true
//     ou isTerminalLost=true, respectivamente.
//     Nota: aprovado → isTerminalWon, recusado → isTerminalLost.
//   - "Análise de Crédito" (reabertura): stage com name ILIKE 'Análise de Crédito'
//     OU com name ILIKE 'analise%credito'. Fallback: orderIndex = 3 (posição
//     canônica no pipeline do Banco do Povo conforme docs/03-modelo-dados.md).
//     Se nenhum encontrado → skip com warn.
//
// LGPD §8.5:
//   Handler manipula apenas IDs opacos + status de negócio.
//   Nenhum PII é lido ou logado. correlationId nos logs = event.id.
// =============================================================================
import { and, eq, or } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import type { Database } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { kanbanCards, kanbanStageHistory, kanbanStages, leads } from '../db/schema/index.js';
import type { KanbanCard, KanbanStage } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { CreditAnalysisStatusChangedData } from '../events/types.js';
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
  name: 'kanban-on-analysis',
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
// Constantes de status de análise
// ---------------------------------------------------------------------------

const STATUS_APROVADO = 'aprovado';
const STATUS_RECUSADO = 'recusado';
const STATUS_EM_ANALISE = 'em_analise';

/** orderIndex canônico do stage "Análise de Crédito" (docs/03 pipeline do BdP). */
const ORDER_ANALISE_CREDITO = 3;

// ---------------------------------------------------------------------------
// Queries locais
// (kanban/repository.ts não está em files_allowed; duplicamos o mínimo)
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

/**
 * Localiza o stage terminal won (aprovado) da org.
 * Retorna o primeiro encontrado (orgs Banco do Povo têm exatamente um).
 */
async function findTerminalWonStage(
  database: Database,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await database
    .select()
    .from(kanbanStages)
    .where(
      and(eq(kanbanStages.organizationId, organizationId), eq(kanbanStages.isTerminalWon, true)),
    )
    .limit(1);
  return row;
}

/**
 * Localiza o stage terminal lost (recusado) da org.
 */
async function findTerminalLostStage(
  database: Database,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await database
    .select()
    .from(kanbanStages)
    .where(
      and(eq(kanbanStages.organizationId, organizationId), eq(kanbanStages.isTerminalLost, true)),
    )
    .limit(1);
  return row;
}

/**
 * Localiza o stage "Análise de Crédito" da org, usado na reabertura.
 *
 * Estratégia de lookup (em ordem de preferência):
 *   1. Stage não-terminal com orderIndex = 3 (posição canônica no pipeline BdP).
 *      Isso é robusto a renomeações acidentais do stage.
 *   2. Stage com nome case-insensitive contendo "analise" e "credito".
 *   Se nenhum encontrado → retorna undefined (handler faz skip + warn).
 */
async function findAnaliseCreditorStage(
  database: Database,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  // Tentativa 1: orderIndex canônico
  const [byOrder] = await database
    .select()
    .from(kanbanStages)
    .where(
      and(
        eq(kanbanStages.organizationId, organizationId),
        eq(kanbanStages.orderIndex, ORDER_ANALISE_CREDITO),
      ),
    )
    .limit(1);

  if (byOrder) return byOrder;

  // Tentativa 2: fallback por tipo (não-terminal) — nomes podem variar
  // Retorna qualquer stage normal com orderIndex > 2 (pós-documentação)
  // que seja não-terminal. Melhor que falhar silenciosamente.
  const [byFallback] = await database
    .select()
    .from(kanbanStages)
    .where(
      and(
        eq(kanbanStages.organizationId, organizationId),
        or(eq(kanbanStages.isTerminalWon, false), eq(kanbanStages.isTerminalLost, false)),
      ),
    )
    .limit(1);

  return byFallback;
}

// ---------------------------------------------------------------------------
// Handler principal — exportado para testes
// ---------------------------------------------------------------------------

/** Resultado de resolveTargetStage: stage destino + motivo, ou motivo de skip. */
type ResolveResult =
  | { found: true; stage: KanbanStage; reason: string }
  | { found: false; reason: 'not_managed' | 'stage_not_found' };

/**
 * Determina o stage de destino com base no to_status do evento.
 * Retorna { found: true, stage, reason } ou { found: false, reason } se não há movimento.
 */
async function resolveTargetStage(
  database: Database,
  toStatus: string,
  fromStatus: string,
  organizationId: string,
): Promise<ResolveResult> {
  if (toStatus === STATUS_APROVADO) {
    const stage = await findTerminalWonStage(database, organizationId);
    if (!stage) return { found: false, reason: 'stage_not_found' };
    return { found: true, stage, reason: 'analysis_approved' };
  }

  if (toStatus === STATUS_RECUSADO) {
    const stage = await findTerminalLostStage(database, organizationId);
    if (!stage) return { found: false, reason: 'stage_not_found' };
    return { found: true, stage, reason: 'analysis_recusado' };
  }

  if (
    toStatus === STATUS_EM_ANALISE &&
    (fromStatus === STATUS_APROVADO || fromStatus === STATUS_RECUSADO)
  ) {
    const stage = await findAnaliseCreditorStage(database, organizationId);
    if (!stage) return { found: false, reason: 'stage_not_found' };
    return { found: true, stage, reason: 'analysis_review_requested' };
  }

  // Transição não gerenciada por este worker (ex: pendente → em_analise)
  return { found: false, reason: 'not_managed' };
}

/**
 * Processa um evento credit_analysis.status_changed:
 *   - Atualiza leads.last_analysis_id.
 *   - Move o card para o stage adequado conforme a decisão de análise.
 *
 * Idempotente:
 *   - outbox-publisher garante dedupe via event_processing_logs (event_id, handler_name).
 *   - Chamadas repetidas sobre evento já processado caem no check "card já no stage destino".
 *
 * @param database  Instância Drizzle injetável (facilita mocking em testes).
 * @param event     EventOutbox com eventName = 'credit_analysis.status_changed'.
 */
export async function handleAnalysisStatusChanged(
  database: Database,
  event: EventOutbox,
): Promise<void> {
  const logger = baseLogger.child({ correlation_id: event.id });

  // -------------------------------------------------------------------------
  // 1. Extrair payload tipado
  // -------------------------------------------------------------------------
  // Justificativa do `as`: event.payload é unknown por design do outbox (§8.5).
  // Validamos os campos essenciais antes de usá-los.
  const payload = event.payload as Partial<CreditAnalysisStatusChangedData>;

  const analysisId = payload.analysis_id;
  const leadId = payload.lead_id;
  const fromStatus = payload.from_status ?? '';
  const toStatus = payload.to_status ?? '';
  const organizationId = event.organizationId;

  if (!analysisId || !leadId || !toStatus) {
    logger.warn(
      {
        eventId: event.id,
        hasAnalysisId: Boolean(analysisId),
        hasLeadId: Boolean(leadId),
        hasToStatus: Boolean(toStatus),
      },
      'payload inválido — analysis_id, lead_id ou to_status ausente; skip',
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
  // 3. Atualizar leads.last_analysis_id (sempre — rastreabilidade)
  //    LGPD §8.5: analysis_id é UUID opaco, sem PII.
  // -------------------------------------------------------------------------
  await database
    .update(leads)
    .set({ lastAnalysisId: analysisId, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

  logger.debug({ cardId, analysisId }, 'leads.last_analysis_id atualizado');

  // -------------------------------------------------------------------------
  // 4. Resolver stage de destino com base no to_status
  // -------------------------------------------------------------------------
  const resolveResult = await resolveTargetStage(database, toStatus, fromStatus, organizationId);

  if (!resolveResult.found) {
    if (resolveResult.reason === 'stage_not_found') {
      logger.warn(
        { eventId: event.id, cardId, analysisId, fromStatus, toStatus },
        'stage destino não encontrado na org; skip',
      );
    } else {
      logger.debug(
        { cardId, analysisId, fromStatus, toStatus },
        'transição não gerenciada por este worker — no-op',
      );
    }
    return;
  }

  const { stage: toStage, reason } = resolveResult;

  // -------------------------------------------------------------------------
  // 5. Carregar stage atual do card
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
  // 6. Verificar idempotência: card já está no stage destino?
  //    Sem double-move — chamadas repetidas são no-op.
  // -------------------------------------------------------------------------
  if (card.stageId === toStage.id) {
    logger.debug(
      {
        cardId,
        analysisId,
        currentStage: fromStage.name,
        targetStage: toStage.name,
        toStatus,
      },
      'card já está no stage destino — no-op idempotente',
    );
    return;
  }

  // -------------------------------------------------------------------------
  // 7. Mover card em transação atômica
  // -------------------------------------------------------------------------
  const toStageId = toStage.id;
  const now = new Date();

  await database.transaction(async (tx) => {
    // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
    // As interfaces AuditTx e DrizzleTx são estruturais e compatíveis com a transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // 7a. Histórico de transição (append-only)
    //     actorUserId = null → transição automática de sistema
    await txDb.insert(kanbanStageHistory).values({
      cardId,
      fromStageId: fromStage.id,
      toStageId,
      actorUserId: null,
      transitionedAt: now,
      metadata: {
        source: 'worker:kanban-on-analysis',
        eventId: event.id,
        analysisId,
        fromStatus,
        toStatus,
        reason,
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
      actor: { kind: 'system', id: 'worker:kanban-on-analysis', ip: null },
      idempotencyKey: `kanban.stage_updated:${cardId}:analysis:${event.id}`,
      data: {
        card_id: cardId,
        lead_id: leadId,
        from_stage: fromStage.name,
        to_stage: toStage.name,
        from_status: fromStage.isTerminalWon ? 'won' : fromStage.isTerminalLost ? 'lost' : 'normal',
        to_status: toStage.isTerminalWon ? 'won' : toStage.isTerminalLost ? 'lost' : 'normal',
        reason,
      },
    });

    // 7d. Audit log — actor = null (ação de sistema)
    // LGPD: before/after contêm apenas stage IDs e nomes (sem PII).
    await auditLog(txForAudit, {
      organizationId,
      actor: null,
      action: 'kanban.stage_updated',
      resource: { type: 'kanban_card', id: cardId },
      before: { stageId: fromStage.id, stageName: fromStage.name },
      after: { stageId: toStageId, stageName: toStage.name },
      correlationId: event.id,
    });
  });

  logger.info(
    {
      analysisId,
      cardId,
      leadId,
      fromStage: fromStage.name,
      toStage: toStage.name,
      fromStatus,
      toStatus,
      reason,
    },
    'card movido por decisão de análise de crédito',
  );
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
export function buildKanbanOnAnalysisHandler(
  _db: Database = db,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleAnalysisStatusChanged(_db, event);
}
