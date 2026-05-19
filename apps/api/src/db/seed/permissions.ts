// =============================================================================
// db/seed/permissions.ts — Seed de permissões RBAC para módulo ai-console (F9-S01/F9-S02).
//
// Permissões criadas:
//   ai-console/prompts (F9-S01):
//   - ai_prompts:read     — leitura de prompt_versions (admin + gestor_geral)
//   - ai_prompts:write    — criação de novas versões (admin)
//   - ai_prompts:activate — ativação transacional de versões (admin)
//
//   ai-console/decisions (F9-S02):
//   - ai_decisions:read   — leitura de ai_decision_logs (admin + gestor_geral + gestor_regional)
//
// Atribuições (doc 10 §3.2 + §74):
//   - admin:           ai_prompts:read + ai_prompts:write + ai_prompts:activate + ai_decisions:read
//   - gestor_geral:    ai_prompts:read + ai_decisions:read
//   - gestor_regional: ai_decisions:read (city-scoped via leads.city_id no código)
//
// Uso: este arquivo documenta o SQL de seed correspondente às migrations
// 0027_seed_ai_prompts_permissions.sql e 0028_seed_ai_decisions_permission.sql.
// O seed pode ser executado diretamente em ambiente de desenvolvimento ou via
// script de inicialização do banco.
//
// IMPORTANTE: as migrations SQL devem ser criadas separadamente em db/migrations/.
// Este arquivo serve como referência TypeScript para automação/CI.
// =============================================================================

/**
 * Definição das permissões do módulo ai-console/prompts.
 * Corresponde ao SQL da migration 0027_seed_ai_prompts_permissions.sql.
 */
export const AI_PROMPTS_PERMISSIONS = [
  {
    key: 'ai_prompts:read',
    description: 'Leitura de versões de prompts do agente LangGraph',
    roles: ['admin', 'gestor_geral'],
  },
  {
    key: 'ai_prompts:write',
    description: 'Criação de novas versões de prompts do agente LangGraph',
    roles: ['admin'],
  },
  {
    key: 'ai_prompts:activate',
    description: 'Ativação transacional de versões de prompts do agente LangGraph',
    roles: ['admin'],
  },
] as const;

export type AiPromptsPermissionKey = (typeof AI_PROMPTS_PERMISSIONS)[number]['key'];

/**
 * Definição das permissões do módulo ai-console/decisions.
 * Corresponde ao SQL da migration 0028_seed_ai_decisions_permission.sql.
 *
 * Nota: gestor_regional tem ai_decisions:read mas o escopo de cidade é aplicado
 * no código (repository JOIN leads.city_id). Decisões com lead_id IS NULL
 * são excluídas para gestor_regional automaticamente.
 */
export const AI_DECISIONS_PERMISSIONS = [
  {
    key: 'ai_decisions:read',
    description: 'Leitura de logs de decisão do agente LangGraph (ai_decision_logs)',
    roles: ['admin', 'gestor_geral', 'gestor_regional'],
  },
] as const;

export type AiDecisionsPermissionKey = (typeof AI_DECISIONS_PERMISSIONS)[number]['key'];
