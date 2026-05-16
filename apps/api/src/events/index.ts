// =============================================================================
// events/index.ts — Re-exporta a API pública do módulo de eventos.
//
// ===========================================================================
// LGPD §8.5 — POLÍTICA DE PAYLOAD (LEIA ANTES DE USAR)
// ===========================================================================
//
// O outbox transacional do Elemento NUNCA carrega PII bruta no payload.
//
// PII proibida em qualquer payload de evento:
//   - CPF, RG, document_number (mesmo mascarado — use cpf_hash se necessário)
//   - E-mail, telefone, número WhatsApp
//   - Nome completo, data de nascimento, endereço
//
// Padrão correto:
//   O payload referencia o aggregate_id (UUID opaco).
//   O handler/consumer que precisa de PII faz GET /internal/<recurso>/:id
//   com header X-Internal-Token, obtendo os dados sob escopo correto.
//
// Razão técnica:
//   event_outbox pode ser replicada, exportada para analytics, ou lida por
//   sistemas de terceiros. Eliminar PII na fonte garante que nenhum vazamento
//   ocorra mesmo em cenários de breach ou acesso não autorizado ao DB.
//
// ===========================================================================

export { emit } from './emit.js';
export type { DrizzleTx } from './emit.js';
export { registerHandler, getHandlers, getRegisteredEventNames } from './handlers.js';
export type { EventHandler, RegisteredHandler } from './handlers.js';
export type {
  AppEvent,
  AppEventName,
  AppEventDataMap,
  BaseEventEnvelope,
  EventActor,
  // Tipos de data dos eventos
  LeadsCreatedData,
  LeadsUpdatedData,
  LeadsImportedData,
  LeadsMergedData,
  CitiesIdentifiedData,
  KanbanCardCreatedData,
  KanbanStageUpdatedData,
  KanbanOutcomeSetData,
  SimulationsGeneratedData,
  SimulationsSentToCustomerData,
  CreditAnalysisAddedData,
  CreditAnalysisUpdatedData,
  CreditAnalysisStatusChangedData,
  CreditProductUpdatedData,
  ChatwootConversationCreatedData,
  ChatwootMessageReceivedData,
  ChatwootHandoffRequestedData,
  ChatwootAgentAssignedData,
  ChatwootStatusUpdatedData,
  WhatsappMessageReceivedData,
  WhatsappMessageSentData,
  AiDecisionLoggedData,
  InternalAssistantQueryCreatedData,
  InternalAssistantToolCalledData,
  InternalAssistantActionRequestedData,
  InternalAssistantActionConfirmedData,
  FollowupJobData,
  ImportBatchData,
  FeatureFlagChangedData,
  UserEventData,
  UserRoleAssignedData,
  UserCityScopeChangedData,
} from './types.js';
