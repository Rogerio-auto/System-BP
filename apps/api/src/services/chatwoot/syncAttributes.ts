// =============================================================================
// services/chatwoot/syncAttributes.ts — Handler de eventos para sync de
// atributos customizados do Chatwoot.
//
// Reagir a eventos do outbox e atualizar os custom_attributes da conversa
// Chatwoot correspondente ao lead, refletindo estado atual do CRM Manager.
//
// Eventos suportados:
//   leads.created          → custom_attributes: lead_id, lead_status, lead_source
//   kanban.stage_updated   → custom_attributes: kanban_stage
//   simulations.generated  → stub (evento não existe ainda) — loga warn + processa
//
// Mapeamento lead → conversation_id:
//   1. interactions WHERE channel='chatwoot' AND lead_id = $lead_id LIMIT 1
//      → external_ref é o chatwoot_conversation_id (texto → número)
//   2. whatsapp_messages WHERE conversation_id IS NOT NULL AND lead_id join
//      → indireto via lead/interactions
//   Se não houver mapeamento: log warn + marca como processado (no retry).
//
// Retry: o worker outbox-publisher gerencia retries (MAX_ATTEMPTS=5).
//   Este handler lança erro em falhas 5xx para acionar o retry do worker.
//   Em falhas 4xx do Chatwoot: lança erro sem retry (direto para DLQ).
//
// LGPD §8.5: custom_attributes enviados ao Chatwoot contêm apenas IDs opacos,
//   status e source — sem nome, CPF, telefone ou qualquer PII bruta.
// =============================================================================
import { eq, and, isNotNull } from 'drizzle-orm';
import pino from 'pino';

import { db } from '../../db/client.js';
import type { EventOutbox } from '../../db/schema/events.js';
import { interactions } from '../../db/schema/interactions.js';
import { ChatwootClient } from '../../integrations/chatwoot/client.js';
import type { ChatwootAttributes } from '../../integrations/chatwoot/client.js';
import { ChatwootApiError } from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'chatwoot-sync',
  redact: {
    paths: ['*.cpf', '*.email', '*.telefone', '*.phone', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
});

// ---------------------------------------------------------------------------
// Constantes de retry interno (para retries de 5xx antes de delegar ao worker)
// ---------------------------------------------------------------------------

/** Número máximo de tentativas internas para chamadas 5xx ao Chatwoot. */
const MAX_RETRY_ATTEMPTS = 5;

/** Base do backoff exponencial em ms. */
const BACKOFF_BASE_MS = 1_000;

/** Fator exponencial. */
const BACKOFF_FACTOR = 2;

/** Máximo de delay em ms (32s conforme slot spec). */
const BACKOFF_MAX_MS = 32_000;

// ---------------------------------------------------------------------------
// Tipos internos do payload
// ---------------------------------------------------------------------------

/** Payload extraído de leads.created (apenas campos necessários — sem PII). */
interface LeadsCreatedPayload {
  data: {
    lead_id: string;
    source: string;
  };
}

/** Payload extraído de kanban.stage_updated (apenas campos necessários). */
interface KanbanStageUpdatedPayload {
  data: {
    lead_id: string;
    to_stage: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Função de sleep injetável para testes.
 * Em produção: usa setTimeout real.
 * Em testes: pode ser substituída por implementação de delay zero.
 */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number): number {
  const exponential = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt);
  return Math.min(exponential, BACKOFF_MAX_MS);
}

/**
 * Executa uma chamada ao Chatwoot com retry interno em erros 5xx.
 * Erros 4xx: sem retry, propaga imediatamente (direto para DLQ pelo worker).
 * Erros 5xx: retry até MAX_RETRY_ATTEMPTS com backoff exponencial.
 *
 * @param fn       Função a executar com retry.
 * @param context  Contexto para logging.
 * @param sleepFn  Função de sleep (injetável para testes). Default: setTimeout.
 */
async function withChatwootRetry<T>(
  fn: () => Promise<T>,
  context: string,
  sleepFn: SleepFn = defaultSleep,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelay(attempt - 1);
      logger.debug({ context, attempt, delayMs: delay }, 'chatwoot_sync_retry_backoff');
      await sleepFn(delay);
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (err instanceof ChatwootApiError) {
        // 4xx — falha do caller, não retentável
        if (err.upstreamStatus >= 400 && err.upstreamStatus < 500) {
          logger.warn(
            { context, upstreamStatus: err.upstreamStatus, attempt },
            'chatwoot_sync_4xx_no_retry',
          );
          throw err;
        }
        // 5xx ou rede (0) — retentável
        logger.warn(
          { context, upstreamStatus: err.upstreamStatus, attempt },
          'chatwoot_sync_5xx_retry',
        );
      } else {
        // TypeError de rede — retentável
        logger.warn({ context, err, attempt }, 'chatwoot_sync_network_error_retry');
      }
    }
  }

  // Esgotou todas as tentativas — propaga para o worker fazer DLQ
  logger.error({ context }, 'chatwoot_sync_max_retries_exceeded');
  throw lastError;
}

// ---------------------------------------------------------------------------
// Lookup: lead_id → chatwoot conversation_id
// ---------------------------------------------------------------------------

/**
 * Resolve o ID de conversa do Chatwoot a partir do lead_id.
 *
 * Estratégia:
 *   1. interactions WHERE channel='chatwoot' AND external_ref IS NOT NULL → external_ref
 *   2. Se não encontrar: retorna null (sem mapeamento disponível).
 *
 * Retorna null sem lançar erro. O caller decide se marca o evento como
 * processado sem ação (no retry) ou se rejeita.
 *
 * @param leadId UUID do lead no Manager.
 */
async function resolveConversationId(leadId: string): Promise<number | null> {
  // Buscar via interactions com canal 'chatwoot' — external_ref = conversation_id (string numérica)
  const rows = await db
    .select({ externalRef: interactions.externalRef })
    .from(interactions)
    .where(
      and(
        eq(interactions.leadId, leadId),
        eq(interactions.channel, 'chatwoot'),
        isNotNull(interactions.externalRef),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.externalRef === null || row.externalRef === undefined) {
    return null;
  }

  const parsed = parseInt(row.externalRef, 10);
  if (isNaN(parsed)) {
    logger.warn(
      { leadId, externalRef: row.externalRef },
      'chatwoot_sync_invalid_conversation_id_format',
    );
    return null;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Handler: leads.created
// ---------------------------------------------------------------------------

async function handleLeadsCreated(event: EventOutbox, sleepFn?: SleepFn): Promise<void> {
  // Payload sem PII — apenas IDs e metadados (LGPD §8.5)
  const payload = event.payload as LeadsCreatedPayload;
  const leadId = payload.data.lead_id;
  const source = payload.data.source;

  const conversationId = await resolveConversationId(leadId);
  if (conversationId === null) {
    logger.warn({ eventId: event.id, leadId }, 'chatwoot_sync_no_conversation');
    // Sem mapeamento: marca como processado sem retry
    return;
  }

  const attrs: ChatwootAttributes = {
    lead_id: leadId,
    // lead_status vem do aggregateId/payload — não temos status diretamente no evento
    // leads.created sempre tem status 'new' implicitamente
    lead_status: 'new',
    lead_source: source,
  };

  const client = new ChatwootClient();
  await withChatwootRetry(
    () => client.updateAttributes(conversationId, attrs),
    `leads.created:${event.id}`,
    sleepFn,
  );

  logger.info({ eventId: event.id, leadId, conversationId }, 'chatwoot_sync_lead_attrs_updated');
}

// ---------------------------------------------------------------------------
// Handler: kanban.stage_updated
// ---------------------------------------------------------------------------

async function handleKanbanStageUpdated(event: EventOutbox, sleepFn?: SleepFn): Promise<void> {
  const payload = event.payload as KanbanStageUpdatedPayload;
  const leadId = payload.data.lead_id;
  const toStage = payload.data.to_stage;

  const conversationId = await resolveConversationId(leadId);
  if (conversationId === null) {
    logger.warn({ eventId: event.id, leadId }, 'chatwoot_sync_no_conversation');
    return;
  }

  const attrs: ChatwootAttributes = {
    kanban_stage: toStage,
  };

  const client = new ChatwootClient();
  await withChatwootRetry(
    () => client.updateAttributes(conversationId, attrs),
    `kanban.stage_updated:${event.id}`,
    sleepFn,
  );

  logger.info(
    { eventId: event.id, leadId, conversationId, kanbanStage: toStage },
    'chatwoot_sync_kanban_stage_updated',
  );
}

// ---------------------------------------------------------------------------
// Handler: simulations.generated (stub — evento não implementado ainda)
// ---------------------------------------------------------------------------

async function handleSimulationsGenerated(event: EventOutbox): Promise<void> {
  // TODO: evento simulations.generated não está implementado ainda (F1-S22+).
  // Quando implementado, atualizar custom_attribute last_simulation_value.
  logger.warn(
    { eventId: event.id, eventName: event.eventName },
    'chatwoot_sync_event_not_implemented',
  );
  // Marca como processado sem ação (não retry).
}

// ---------------------------------------------------------------------------
// Dispatcher principal
// ---------------------------------------------------------------------------

/**
 * Handler principal do outbox — despachado pelo worker para eventos Chatwoot.
 *
 * Contrato do handler (events/handlers.ts):
 *   - Recebe EventOutbox completo (sem PII bruta — LGPD §8.5).
 *   - Deve ser idempotente.
 *   - Lança erro em falha → worker incrementa attempts / move para DLQ.
 *   - Retorna void em sucesso ou no-op (ex: sem mapeamento).
 *
 * @param event    Evento do outbox a processar.
 * @param sleepFn  Função de sleep opcional (injetável em testes para skip backoff).
 *                 Em produção, use o default (setTimeout real).
 */
export async function handleEvent(event: EventOutbox, sleepFn?: SleepFn): Promise<void> {
  switch (event.eventName) {
    case 'leads.created':
      return handleLeadsCreated(event, sleepFn);

    case 'kanban.stage_updated':
      return handleKanbanStageUpdated(event, sleepFn);

    case 'simulations.generated':
      return handleSimulationsGenerated(event);

    default:
      // Event type não tratado por este handler — não deve chegar aqui se
      // o registry estiver configurado corretamente, mas defensivo.
      logger.warn({ eventId: event.id, eventName: event.eventName }, 'chatwoot_sync_unknown_event');
  }
}
