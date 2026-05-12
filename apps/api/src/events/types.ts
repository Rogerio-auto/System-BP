// =============================================================================
// events/types.ts — Discriminated union de todos os eventos do sistema.
//
// ===========================================================================
// LGPD §8.5 — REGRA ABSOLUTA (leia antes de adicionar qualquer evento):
// ===========================================================================
//
//   O payload de QUALQUER evento NUNCA pode conter:
//     - CPF, RG, document_number (bruto)
//     - E-mail, telefone, número WhatsApp (brutos)
//     - Nome completo, data de nascimento, endereço
//     - Qualquer dado que identifique diretamente uma pessoa física
//
//   Padrão: o payload carrega aggregate_id (UUID opaco) + IDs de contexto.
//   O consumidor hidrata PII via GET /internal/<recurso>/:id com o escopo correto.
//
//   Se um evento ABSOLUTAMENTE precisar de um dado quasi-identificador
//   (caso extremamente raro), use cpf_hash — HMAC-SHA256 do CPF normalizado.
//   NUNCA o CPF bruto.
//
//   PR que violar esta regra deve ser bloqueado em revisão.
//
// ===========================================================================
//
// Nomenclatura: "<dominio>.<acao_em_passado>" (docs/04-eventos.md §2)
//
// Para adicionar um novo evento:
//   1. Adicione o tipo em AppEventData com todos os campos (sem PII bruta).
//   2. Adicione a entrada em APP_EVENT_NAMES.
//   3. O TypeScript inferirá o discriminated union automaticamente.
// =============================================================================

// ---------------------------------------------------------------------------
// Actor — quem originou o evento
// ---------------------------------------------------------------------------

export interface EventActor {
  kind: 'user' | 'ai' | 'system' | 'worker';
  /** UUID do usuário/agente, null para system/worker. */
  id: string | null;
  /** IP do request originador, null quando interno. */
  ip: string | null;
}

// ---------------------------------------------------------------------------
// Envelope base (estrutura padrão docs/04-eventos.md §2)
// ---------------------------------------------------------------------------

export interface BaseEventEnvelope {
  /** UUID único do evento — usado como chave de idempotência no consumer. */
  event_id: string;
  /** Nome do evento no padrão "<dominio>.<acao>". */
  event_name: string;
  /** Versão do contrato. Incrementar em quebra de compatibilidade. */
  event_version: number;
  /** ISO 8601 do momento em que o evento ocorreu. */
  occurred_at: string;
  actor: EventActor;
  /** Propagado de webhook → outbox → handler → integração. */
  correlation_id: string | null;
  aggregate: {
    type: string;
    /** UUID opaco do agregado — não é PII. */
    id: string;
  };
  /** Dados específicos do evento (ver cada tipo abaixo). SEM PII bruta. */
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tipos de dados específicos por evento
// ---------------------------------------------------------------------------
// Convenção: <DomainEventName>Data — apenas IDs e metadados estruturais.

// --- Domínio: leads ---

export interface LeadsCreatedData {
  lead_id: string;
  /** ID da cidade, null se não identificada ainda. */
  city_id: string | null;
  /** Ex: "whatsapp", "import", "manual". */
  source: string;
  assigned_agent_id: string | null;
  /** "user" | "ai" | "import" */
  created_by_kind: string;
}

export interface LeadsUpdatedData {
  lead_id: string;
  /** Lista de campos alterados com before/after. SEM PII nos valores. */
  changes: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
}

export interface LeadsImportedData {
  lead_id: string;
  batch_id: string;
  row_number: number;
  city_id: string | null;
}

export interface LeadsMergedData {
  surviving_lead_id: string;
  merged_lead_id: string;
}

// --- Domínio: cities ---

export interface CitiesIdentifiedData {
  lead_id: string;
  city_id: string;
  /** 0.0 – 1.0 */
  confidence: number;
  /** Texto que originou a identificação (sem PII — ex: "Vilhena", não número de cpf). */
  source_text: string;
}

// --- Domínio: kanban ---

export interface KanbanCardCreatedData {
  card_id: string;
  lead_id: string;
  stage: string;
  city_id: string | null;
}

export interface KanbanStageUpdatedData {
  card_id: string;
  lead_id: string;
  from_stage: string;
  to_stage: string;
  from_status: string;
  to_status: string;
  reason: string | null;
}

export interface KanbanOutcomeSetData {
  card_id: string;
  lead_id: string;
  outcome: 'concluido' | 'abandonado' | 'recusado';
  reason: string | null;
}

// --- Domínio: simulações ---

export interface SimulationsGeneratedData {
  simulation_id: string;
  lead_id: string;
  product_id: string;
  rule_version_id: string;
  amount: number;
  term_months: number;
  monthly_payment: number;
  /** "ai" | "agent" | "api" */
  origin: string;
}

export interface SimulationsSentToCustomerData {
  simulation_id: string;
  lead_id: string;
  channel: string;
  message_id: string | null;
}

// --- Domínio: análise de crédito ---

export interface CreditAnalysisAddedData {
  analysis_id: string;
  lead_id: string;
  version: number;
  status: string;
  analyst_user_id: string | null;
}

export interface CreditAnalysisUpdatedData {
  analysis_id: string;
  lead_id: string;
  version_before: number;
  version_after: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface CreditAnalysisStatusChangedData {
  analysis_id: string;
  lead_id: string;
  from_status: string;
  to_status: string;
}

// --- Domínio: crédito (produto/regras) ---

export interface CreditProductChangedData {
  product_id: string;
  /** Snapshot da regra — sem PII. */
  rule_snapshot: Record<string, unknown>;
}

// --- Domínio: Chatwoot / WhatsApp ---

export interface ChatwootConversationCreatedData {
  chatwoot_conversation_id: number;
  lead_id: string | null;
  inbox_id: number;
}

export interface ChatwootMessageReceivedData {
  chatwoot_message_id: number;
  chatwoot_conversation_id: number;
  lead_id: string | null;
  /** "incoming" | "outgoing" */
  message_type: string;
}

export interface ChatwootHandoffRequestedData {
  lead_id: string;
  chatwoot_conversation_id: number;
  reason: string;
  /** Resumo gerado pela IA — deve ser revisado pelo DLP antes de entrar aqui. */
  summary: string;
  simulation_id: string | null;
}

export interface ChatwootAgentAssignedData {
  lead_id: string;
  chatwoot_conversation_id: number;
  agent_id: string | null;
}

export interface ChatwootStatusUpdatedData {
  chatwoot_conversation_id: number;
  lead_id: string | null;
  /** "open" | "resolved" | "pending" */
  status: string;
}

export interface WhatsappMessageReceivedData {
  whatsapp_message_id: string;
  chatwoot_conversation_id: number | null;
  lead_id: string | null;
}

export interface WhatsappMessageSentData {
  whatsapp_message_id: string;
  lead_id: string | null;
}

// --- Domínio: IA ---

export interface AiDecisionLoggedData {
  conversation_id: string;
  node_name: string;
  decision: string;
  tools_called: string[];
  prompt_version: string;
}

// --- Domínio: assistente interno ---

export interface InternalAssistantQueryCreatedData {
  query_id: string;
  user_id: string;
}

export interface InternalAssistantToolCalledData {
  query_id: string;
  tool_name: string;
  latency_ms: number;
  result_summary: string;
}

export interface InternalAssistantActionRequestedData {
  query_id: string;
  action_type: string;
}

export interface InternalAssistantActionConfirmedData {
  query_id: string;
  action_type: string;
  confirmed_by_user_id: string;
}

// --- Domínio: follow-up ---

export interface FollowupJobData {
  followup_job_id: string;
  lead_id: string;
  rule_id: string;
}

// --- Domínio: importação ---

export interface ImportBatchData {
  batch_id: string;
  /** "leads" | "credit_analyses" */
  batch_type: string;
  row_count?: number;
  error_count?: number;
}

// --- Domínio: feature flags ---

export interface FeatureFlagChangedData {
  key: string;
  before: unknown;
  after: unknown;
  actor_user_id: string;
}

// --- Domínio: auth/users ---

export interface UserEventData {
  user_id: string;
  organization_id: string;
}

export interface UserRoleAssignedData {
  user_id: string;
  role_id: string;
  assigned_by_user_id: string;
}

export interface UserCityScopeChangedData {
  user_id: string;
  city_id: string;
  action: 'added' | 'removed';
}

// ---------------------------------------------------------------------------
// APP_EVENT_NAMES — mapa de event_name → tipo de data
// Usado pelo TypeScript para inferir os tipos nas sobrecargas de emit().
// ---------------------------------------------------------------------------

export interface AppEventDataMap {
  'leads.created': LeadsCreatedData;
  'leads.updated': LeadsUpdatedData;
  'leads.imported': LeadsImportedData;
  'leads.merged': LeadsMergedData;
  'cities.identified': CitiesIdentifiedData;
  'kanban.card_created': KanbanCardCreatedData;
  'kanban.stage_updated': KanbanStageUpdatedData;
  'kanban.outcome_set': KanbanOutcomeSetData;
  'simulations.generated': SimulationsGeneratedData;
  'simulations.sent_to_customer': SimulationsSentToCustomerData;
  'credit_analysis.added': CreditAnalysisAddedData;
  'credit_analysis.updated': CreditAnalysisUpdatedData;
  'credit_analysis.status_changed': CreditAnalysisStatusChangedData;
  'credit.product_created': CreditProductChangedData;
  'credit.product_updated': CreditProductChangedData;
  'credit.rule_published': CreditProductChangedData;
  'chatwoot.conversation_created': ChatwootConversationCreatedData;
  'chatwoot.message_received': ChatwootMessageReceivedData;
  'chatwoot.message_sent': ChatwootMessageReceivedData;
  'chatwoot.handoff_requested': ChatwootHandoffRequestedData;
  'chatwoot.agent_assigned': ChatwootAgentAssignedData;
  'chatwoot.status_updated': ChatwootStatusUpdatedData;
  'whatsapp.message_received': WhatsappMessageReceivedData;
  'whatsapp.message_sent': WhatsappMessageSentData;
  'ai.decision_logged': AiDecisionLoggedData;
  'internal_assistant.query_created': InternalAssistantQueryCreatedData;
  'internal_assistant.tool_called': InternalAssistantToolCalledData;
  'internal_assistant.action_requested': InternalAssistantActionRequestedData;
  'internal_assistant.action_confirmed': InternalAssistantActionConfirmedData;
  'followup.scheduled': FollowupJobData;
  'followup.triggered': FollowupJobData;
  'followup.sent': FollowupJobData;
  'followup.failed': FollowupJobData;
  'followup.cancelled': FollowupJobData;
  'import.batch_created': ImportBatchData;
  'import.batch_validated': ImportBatchData;
  'import.batch_completed': ImportBatchData;
  'import.batch_failed': ImportBatchData;
  'feature_flag.changed': FeatureFlagChangedData;
  'user.created': UserEventData;
  'user.role_assigned': UserRoleAssignedData;
  'user.city_scope_changed': UserCityScopeChangedData;
  'user.session_revoked': UserEventData;
}

/** Union de todos os nomes de evento válidos no sistema. */
export type AppEventName = keyof AppEventDataMap;

/**
 * Evento tipado: une event_name + data de forma segura.
 * Usado como parâmetro de emit().
 */
export type AppEvent<K extends AppEventName = AppEventName> = {
  eventName: K;
  aggregateType: string;
  /** UUID do agregado — não é PII. */
  aggregateId: string;
  organizationId: string;
  actor: EventActor;
  correlationId?: string;
  /**
   * Chave de idempotência do produtor.
   * Recomendado: `${eventName}:${aggregateId}:${Date.now()}` para eventos únicos,
   * ou uma chave determinística para operações que podem ser reenviadas.
   */
  idempotencyKey: string;
  /** Versão do contrato. Default: 1. */
  eventVersion?: number;
  data: AppEventDataMap[K];
  metadata?: Record<string, unknown>;
};
