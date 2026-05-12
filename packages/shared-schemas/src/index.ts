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
