/**
 * featureKeys.ts — Catálogo fechado de feature_key (F12-S01).
 *
 * Convenção: <modulo>.<entidade>.<acao>
 *
 * Esta constante é a ÚNICA fonte de verdade para feature keys válidas.
 * Consumida por:
 *   - apps/api: validação Zod no POST/PATCH de /api/admin/tutorials
 *   - apps/web:  dropdown do admin de tutoriais; componente <ContextualHelp>
 *
 * Devs adicionam novas keys aqui conforme entregam funcionalidades.
 * O admin escolhe via dropdown — nunca digita texto livre.
 *
 * Referência: docs/21-tutoriais-em-video.md §4.1
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const FEATURE_KEYS = [
  // CRM — gestão de leads
  'crm.lead.create',
  'crm.lead.import',
  'crm.lead.edit',
  'crm.lead.qualify',
  'crm.kanban.move',
  'crm.kanban.view',

  // Crédito — análises e simulações
  'credit.simulation.run',
  'credit.analysis.create',
  'credit.analysis.approve',
  'credit.analysis.reject',
  'credit.product.manage',

  // Follow-up automático
  'followup.rule.create',
  'followup.rule.edit',
  'followup.job.view',

  // Cobrança escalonada
  'billing.due.register',
  'billing.due.mark_paid',
  'billing.rule.create',

  // Templates WhatsApp
  'templates.create',
  'templates.edit',

  // Simulador
  'simulator.run',

  // Central de Ajuda / Tutoriais (admin)
  'tutorials.manage',

  // Dashboard
  'dashboard.view',

  // Configurações de organização
  'settings.organization.edit',
  'settings.users.manage',
  'settings.roles.manage',
] as const;

// ---------------------------------------------------------------------------
// Tipo derivado
// ---------------------------------------------------------------------------

/**
 * Tipo estrito derivado do catálogo.
 * Garante que nenhuma feature_key fora do catálogo entre no sistema.
 */
export type FeatureKey = (typeof FEATURE_KEYS)[number];
