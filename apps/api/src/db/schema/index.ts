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

// Feature flags (F1-S23)
export * from './featureFlags.js';
