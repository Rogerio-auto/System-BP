// =============================================================================
// chatwoot/service.ts — Lógica de negócio para processamento de webhook Chatwoot.
//
// Pipeline por evento recebido:
//   1. HMAC já validado no handler da rota (antes deste service ser chamado).
//   2. Verificar event_type na whitelist. Fora da whitelist → retornar sem processar.
//   3. Parsear payload com Zod (schema específico do event type).
//   4. Extrair chatwoot_id e updated_at_chatwoot do payload.
//   5. Em transação atômica:
//      a. INSERT em chatwoot_events (com unique constraint como guardião de idempotência).
//      b. emit() de evento interno no outbox (sem PII).
//   6. Em caso de violação de unique constraint → idempotência atingida → retornar sem erro.
//
// Transacionalidade:
//   - Passos 5a e 5b ocorrem na MESMA transação Drizzle.
//   - Se qualquer passo falhar → rollback → próxima chamada reprocessa.
//   - Violação do unique index (org + chatwoot_id + updated_at) → catch → sem-op.
//
// Multi-tenant / organization_id:
//   O webhook Chatwoot é público (autenticado apenas via HMAC).
//   No MVP com 1 organização, usamos um UUID sentinel fixo.
//   TODO: quando multi-tenant por account_id for necessário, derivar org via
//   tabela de mapeamento account_id → organization_id.
//
// LGPD §8.5:
//   - Eventos no outbox carregam APENAS IDs — sem content, sem dados de contato.
//   - Payload bruto (PII) fica SOMENTE em chatwoot_events.payload.
// =============================================================================
import { db } from '../../db/client.js';
import { chatwootEvents } from '../../db/schema/chatwootEvents.js';
import { emit } from '../../events/emit.js';
import type { AppEventDataMap } from '../../events/types.js';

import {
  chatwootAssigneeChangedPayloadSchema,
  chatwootMessageCreatedPayloadSchema,
  chatwootStatusChangedPayloadSchema,
  isChatwootWhitelisted,
  parseChatwootTimestamp,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * UUID sentinel para a organização única no MVP.
 * TODO: substituir por lookup account_id → organization_id quando multi-tenant.
 */
const ORG_ID_PLACEHOLDER = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface ProcessChatwootEventResult {
  /** true = evento processado e gravado; false = duplicado (idempotência) ou ignorado. */
  processed: boolean;
  /** UUID da linha em chatwoot_events (ou null se ignorado/duplicado). */
  eventId: string | null;
  /** Motivo quando processed=false. */
  reason?: 'ignored_event_type' | 'duplicate';
}

// ---------------------------------------------------------------------------
// Tipos auxiliares para dados de outbox (sem PII)
// ---------------------------------------------------------------------------

type OutboxEventName =
  | 'chatwoot.message_created'
  | 'chatwoot.conversation_status_changed'
  | 'chatwoot.conversation_assignee_changed';

type OutboxData<K extends OutboxEventName> = AppEventDataMap[K];

// ---------------------------------------------------------------------------
// Helper: detectar violação de unique constraint do Postgres
// ---------------------------------------------------------------------------

/**
 * Retorna true se o erro é uma violação de unique constraint do Postgres (código 23505).
 * Usado para tratar idempotência sem relançar o erro.
 */
function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  // pg / drizzle envolve erros do postgres com código '23505'
  const pgErr = err as { code?: string };
  return pgErr.code === '23505';
}

// ---------------------------------------------------------------------------
// processChatwootEvent()
// ---------------------------------------------------------------------------

/**
 * Processa um único evento recebido do webhook Chatwoot.
 *
 * @param rawPayload    Payload bruto (unknown) — este service parseia internamente.
 * @param correlationId UUID de correlação propagado do request.
 */
export async function processChatwootEvent(
  rawPayload: unknown,
  correlationId: string,
): Promise<ProcessChatwootEventResult> {
  // -------------------------------------------------------------------------
  // Passo 2: verificar event_type na whitelist
  // -------------------------------------------------------------------------
  // Extraímos apenas o campo `event` antes de fazer o parse completo.
  // Se o payload nem tem campo `event`, consideramos ignorado.
  const eventTypeCheck =
    rawPayload !== null && typeof rawPayload === 'object' && 'event' in rawPayload
      ? String((rawPayload as { event: unknown }).event)
      : '';

  if (!isChatwootWhitelisted(eventTypeCheck)) {
    // Eventos fora da whitelist → ignorar silenciosamente (Chatwoot envia muitos tipos)
    return { processed: false, eventId: null, reason: 'ignored_event_type' };
  }

  const eventType = eventTypeCheck;
  const organizationId = ORG_ID_PLACEHOLDER;

  // -------------------------------------------------------------------------
  // Passo 3 & 4: parsear payload + extrair campos de idempotência
  // -------------------------------------------------------------------------
  // Delegamos para helpers específicos por event_type para manter o código limpo.
  // Cada helper retorna { chatwootId, updatedAt, eventName, outboxData }.
  if (eventType === 'message_created') {
    return procesMessageCreated(rawPayload, organizationId, correlationId);
  } else if (eventType === 'conversation_status_changed') {
    return processStatusChanged(rawPayload, organizationId, correlationId);
  } else {
    // eventType === 'conversation_assignee_changed'
    return processAssigneeChanged(rawPayload, organizationId, correlationId);
  }
}

// ---------------------------------------------------------------------------
// Helpers por event_type
// ---------------------------------------------------------------------------

async function procesMessageCreated(
  rawPayload: unknown,
  organizationId: string,
  correlationId: string,
): Promise<ProcessChatwootEventResult> {
  const parsed = chatwootMessageCreatedPayloadSchema.parse(rawPayload);
  const chatwootId = parsed.id;
  const updatedAt = parseChatwootTimestamp(parsed.created_at);

  return persistAndEmit<'chatwoot.message_created'>(
    rawPayload,
    organizationId,
    correlationId,
    chatwootId,
    'message_created',
    updatedAt,
    'chatwoot.message_created',
    (eventId) => ({
      chatwoot_event_id: eventId,
      chatwoot_message_id: parsed.id,
      chatwoot_conversation_id: parsed.conversation.id,
      chatwoot_account_id: parsed.account.id,
      message_type: parsed.message_type,
      lead_id: null, // TODO: resolver lead via chatwoot_conversation_id
    }),
  );
}

async function processStatusChanged(
  rawPayload: unknown,
  organizationId: string,
  correlationId: string,
): Promise<ProcessChatwootEventResult> {
  const parsed = chatwootStatusChangedPayloadSchema.parse(rawPayload);
  const chatwootId = parsed.id;
  const updatedAt = parseChatwootTimestamp(parsed.updated_at);

  return persistAndEmit<'chatwoot.conversation_status_changed'>(
    rawPayload,
    organizationId,
    correlationId,
    chatwootId,
    'conversation_status_changed',
    updatedAt,
    'chatwoot.conversation_status_changed',
    (eventId) => ({
      chatwoot_event_id: eventId,
      chatwoot_conversation_id: parsed.id,
      chatwoot_account_id: parsed.account.id,
      status: parsed.status,
      lead_id: null,
    }),
  );
}

async function processAssigneeChanged(
  rawPayload: unknown,
  organizationId: string,
  correlationId: string,
): Promise<ProcessChatwootEventResult> {
  const parsed = chatwootAssigneeChangedPayloadSchema.parse(rawPayload);
  const chatwootId = parsed.id;
  const updatedAt = parseChatwootTimestamp(parsed.updated_at);
  const assigneeId = parsed.meta?.assignee?.id ?? null;

  return persistAndEmit<'chatwoot.conversation_assignee_changed'>(
    rawPayload,
    organizationId,
    correlationId,
    chatwootId,
    'conversation_assignee_changed',
    updatedAt,
    'chatwoot.conversation_assignee_changed',
    (eventId) => ({
      chatwoot_event_id: eventId,
      chatwoot_conversation_id: parsed.id,
      chatwoot_account_id: parsed.account.id,
      assignee_id: assigneeId,
      lead_id: null,
    }),
  );
}

// ---------------------------------------------------------------------------
// persistAndEmit<K>() — transação atômica INSERT + outbox
// ---------------------------------------------------------------------------

/**
 * Persiste o evento em chatwoot_events e emite no outbox na mesma transação.
 *
 * @param rawPayload     Payload bruto do Chatwoot (para persistência — pode conter PII).
 * @param organizationId UUID da organização (multi-tenant).
 * @param correlationId  UUID de correlação do request.
 * @param chatwootId     ID numérico do objeto no Chatwoot (message.id ou conversation.id).
 * @param eventType      Tipo do evento (string exato do Chatwoot).
 * @param updatedAt      Timestamp do objeto no Chatwoot.
 * @param outboxEventName Nome canônico do evento no outbox (prefixado 'chatwoot.').
 * @param buildData      Factory que recebe o UUID do registro inserido e retorna os dados do evento.
 *
 * LGPD §8.5: o `buildData` NUNCA deve incluir PII bruta (content, phone, name).
 *             Apenas IDs e metadados estruturais são permitidos.
 */
async function persistAndEmit<K extends OutboxEventName>(
  rawPayload: unknown,
  organizationId: string,
  correlationId: string,
  chatwootId: number,
  eventType: string,
  updatedAt: Date,
  outboxEventName: K,
  buildData: (eventId: string) => OutboxData<K>,
): Promise<ProcessChatwootEventResult> {
  try {
    let insertedId = '';

    await db.transaction(async (tx) => {
      // Passo 5a: INSERT em chatwoot_events
      // A unique constraint (org, chatwoot_id, updated_at_chatwoot) garante
      // idempotência: um segundo retry do Chatwoot lançará 23505 → catch abaixo.
      const inserted = await tx
        .insert(chatwootEvents)
        .values({
          organizationId,
          chatwootId,
          eventType,
          // Payload bruto (pode conter PII). Nunca logado diretamente.
          // Justificativa do cast: `rawPayload` é `unknown` e já foi validado pelo Zod
          // acima no caller. jsonb do Drizzle aceita qualquer objeto serializável.
          payload: rawPayload as unknown as Record<string, unknown>,
          updatedAtChatwoot: updatedAt,
        })
        .returning({ id: chatwootEvents.id });

      const firstRow = inserted[0];
      if (firstRow === undefined) {
        // Nunca deve ocorrer com .returning() mas noUncheckedIndexedAccess exige a guarda
        throw new Error('INSERT chatwoot_events retornou vazio — inconsistência inesperada');
      }
      insertedId = firstRow.id;

      // Passo 5b: emitir evento interno no outbox (SEM PII — apenas IDs)
      // idempotency key determinístico: <event_name>:<chatwoot_event_uuid>
      const idempotencyKey = `${outboxEventName}:${insertedId}`;

      await emit(tx, {
        eventName: outboxEventName,
        aggregateType: 'chatwoot_event',
        aggregateId: insertedId,
        organizationId,
        actor: { kind: 'system', id: null, ip: null },
        correlationId,
        idempotencyKey,
        data: buildData(insertedId),
      });
    });

    return { processed: true, eventId: insertedId };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicata — idempotência atingida via unique constraint
      // Retorna 200 sem reprocessar (conforme contrato do webhook)
      return { processed: false, eventId: null, reason: 'duplicate' };
    }
    // Erro inesperado — relança para que o handler responda 500
    throw err;
  }
}
