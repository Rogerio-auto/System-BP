// =============================================================================
// db/seed/permissions.ts — Seed de permissões RBAC para módulo ai-console/prompts (F9-S01).
//
// Permissões criadas:
//   - ai_prompts:read     — leitura de prompt_versions (admin + gestor_geral)
//   - ai_prompts:write    — criação de novas versões (admin)
//   - ai_prompts:activate — ativação transacional de versões (admin)
//
// Atribuições (doc 10 §3.2):
//   - admin:        ai_prompts:read + ai_prompts:write + ai_prompts:activate
//   - gestor_geral: ai_prompts:read (somente leitura)
//
// Uso: este arquivo documenta o SQL de seed correspondente à migration
// 0026_seed_ai_prompts_permissions.sql. O seed pode ser executado diretamente
// em ambiente de desenvolvimento ou via script de inicialização do banco.
//
// IMPORTANTE: a migration SQL deve ser criada separadamente em db/migrations/.
// Este arquivo serve como referência TypeScript para automação/CI.
// =============================================================================

/**
 * Definição das permissões do módulo ai-console/prompts.
 * Corresponde ao SQL da migration 0026_seed_ai_prompts_permissions.sql.
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
