// =============================================================================
// Schema central. Cada módulo exporta suas tabelas em src/db/schema/<modulo>.ts
// e re-exporta aqui. Manter ordem alfabética para evitar conflitos.
// =============================================================================

// Identidade (F1-S01)
export * from './organizations.js';
export * from './users.js';
export * from './roles.js';
export * from './permissions.js';
export * from './role_permissions.js';
export * from './user_roles.js';
export * from './user_city_scopes.js';
export * from './user_sessions.js';

// Geografia e times (F1-S05)
export * from './cities';
export * from './agents';
export * from './agent_cities';

// Outbox pattern (F1-S15)
export * from './events.js';

// Audit logs (F1-S16)
export * from './auditLogs.js';

// WhatsApp webhook (F1-S19)
export * from './whatsappMessages.js';
export * from './idempotencyKeys.js';

// Chatwoot webhook (F1-S21)
export * from './chatwootEvents.js';

// Feature flags (F1-S23)
export * from './featureFlags.js';

// Core CRM (F1-S09)
export * from './leads.js';
export * from './customers.js';
export * from './leadHistory.js';
export * from './interactions.js';

// Kanban (F1-S13)
export * from './kanbanStages.js';
export * from './kanbanCards.js';
export * from './kanbanStageHistory.js';

// LGPD — direitos do titular + retenção (F1-S25)
export * from './data_subject.js';

// Importações pipeline (F1-S17)
export * from './importBatches.js';
export * from './importRows.js';

// Crédito — produtos, regras e simulações (F2-S01)
export * from './creditProducts.js';
export * from './creditProductRules.js';
export * from './creditSimulations.js';

// Crédito — análises e pareceres versionados (F4-S01)
export * from './creditAnalyses.js';
export * from './creditAnalysisVersions.js';

// IA — agente LangGraph: estado de conversa, logs de decisão, prompts (F3-S01)
export * from './aiConversationStates.js';
export * from './aiDecisionLogs.js';
export * from './promptVersions.js';

// Chatwoot handoffs — persistência de handoffs de conversa (F3-S37)
export * from './chatwootHandoffs.js';

// 2FA / TOTP — recovery codes, desafios de login e anti-replay (F8-S11)
export * from './userRecoveryCodes.js';
export * from './totpChallenges.js';
export * from './usedTotpCodes.js';

// Preços por modelo LLM — custeio de decisões IA (F9-S00)
export * from './modelPricing.js';
