/**
 * Schemas Zod compartilhados entre frontend e backend.
 * Cada módulo de domínio exporta seus schemas a partir daqui.
 *
 * Convenção: <Entidade>Schema, Create<Entidade>Schema, Update<Entidade>Schema.
 */

// Auth (F1-S03)
export * from './auth.js';

// Leads (F1-S11)
export * from './leads.js';

// Cities (F1-S06)
export * from './cities.js';

// Tasks (F15-S03/S04)
export * from './tasks.js';

// Notifications (F15-S03/S04)
export * from './notifications.js';

// Billing / SPC / Dashboard cobrança (F15-S02/S04)
export * from './billing.js';

// Contracts (F17-S01/S02)
export * from './contracts.js';

// Live chat — discriminated unions + socket events (F16-S03)
export * from './livechat.js';

// Users / perfil do agente — personal_email, TOTP, status (F18-S08)
export * from './users.js';
