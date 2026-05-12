// =============================================================================
// events/handlers.ts — Registro de handlers por event_name.
//
// O worker outbox-publisher consulta este registro para rotear cada evento
// ao handler correto. Handlers futuros (kanban, chatwoot-sync, analytics, etc.)
// serão adicionados aqui quando seus slots forem implementados.
//
// CONTRATO DO HANDLER:
//   - Recebe o EventOutbox completo (sem PII — §8.5).
//   - Deve ser idempotente: o worker usa event_processing_logs para dedupe,
//     mas o handler TAMBÉM deve ser resiliente a execuções duplicadas.
//   - Deve lançar erro em caso de falha — o worker capturará e recontará tentativas.
//   - Não deve fazer commit/rollback de transação — opera fora da transação do outbox.
//
// ADICIONANDO UM NOVO HANDLER:
//   1. Importe a função de handler do módulo correto.
//   2. Defina um `handlerName` único para idempotência (ex: "kanban.on_lead_created").
//   3. Chame registerHandler('<event_name>', handlerName, handler) neste arquivo.
//   4. O registro é consumido automaticamente pelo worker.
// =============================================================================
import type { EventOutbox } from '../db/schema/events.js';

// ---------------------------------------------------------------------------
// Tipo do handler
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-unused-vars -- parameter name in type alias (not a real variable)
export type EventHandler = (event: EventOutbox) => Promise<void>;

export interface RegisteredHandler {
  /** Nome único para idempotência em event_processing_logs. */
  name: string;
  fn: EventHandler;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, RegisteredHandler[]>();

/**
 * Registra um handler para um event_name.
 * Múltiplos handlers podem ser registrados para o mesmo evento (fan-out).
 *
 * @param eventName   Ex: 'leads.created'
 * @param handlerName Nome único para idempotência (ex: 'kanban.on_lead_created')
 * @param handler     Função que processa o evento
 */
export function registerHandler(
  eventName: string,
  handlerName: string,
  handler: EventHandler,
): void {
  const existing = registry.get(eventName);
  const entry: RegisteredHandler = { name: handlerName, fn: handler };
  if (existing !== undefined) {
    existing.push(entry);
  } else {
    registry.set(eventName, [entry]);
  }
}

/**
 * Retorna todos os handlers registrados para um event_name.
 * Retorna array vazio se nenhum handler estiver registrado (evento ignorado silenciosamente).
 */
export function getHandlers(eventName: string): readonly RegisteredHandler[] {
  return registry.get(eventName) ?? [];
}

/**
 * Retorna todos os event_names com pelo menos um handler registrado.
 * Útil para debugging/observabilidade.
 */
export function getRegisteredEventNames(): readonly string[] {
  return Array.from(registry.keys());
}

// ---------------------------------------------------------------------------
// Handlers do sistema (slots futuros registrarão aqui)
// ---------------------------------------------------------------------------
//
// F1-S11 (kanban) registrará:
//   registerHandler('leads.created', 'kanban.on_lead_created', kanbanOnLeadCreated)
//
// F1-S13 (chatwoot-sync) registrará:
//   registerHandler('leads.created', 'chatwoot.sync_on_lead_created', chatwootSyncHandler)
//   registerHandler('kanban.stage_updated', 'chatwoot.sync_on_stage_updated', ...)
//
// F1-S22 (analytics) registrará múltiplos eventos de métrica.
//
// Por ora, nenhum handler real está registrado — o worker marcará eventos
// sem handlers como processados silenciosamente.
// ---------------------------------------------------------------------------
