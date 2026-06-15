// =============================================================================
// db/seed/permissions.ts — Catálogo TypeScript de permissões RBAC.
//
// Cada constante espelha o SQL de seed da migration correspondente.
// Este arquivo serve como referência tipada para automação/CI e como
// documentação viva do RBAC. Não substitui as migrations SQL.
//
// Permissões por módulo/fase:
//
//   ai-console/prompts (F9-S01 — 0027_seed_ai_prompts_permissions.sql):
//   - ai_prompts:read     — leitura de prompt_versions (admin + gestor_geral)
//   - ai_prompts:write    — criação de novas versões (admin)
//   - ai_prompts:activate — ativação transacional de versões (admin)
//
//   ai-console/decisions (F9-S02 — 0028_seed_ai_decisions_permission.sql):
//   - ai_decisions:read   — leitura de ai_decision_logs (admin + gestor_geral + gestor_regional)
//
//   ai-console/playground (F9-S04 — 0029_seed_ai_playground_permission.sql):
//   - ai_playground:run   — execução do playground dry-run (admin only)
//
//   simulações/envio (F?-S?? — 0053_seed_simulation_template_flag.sql):
//   - simulations:send    — disparo de simulação por WhatsApp (admin only)
//
//   cobrança + tarefas + notificações (F15-S01 — 0056_seed_cobranca_role_permissions.sql):
//   - billing:reconcile   — reconciliação/baixa manual (admin + gestor_geral + cobranca)
//   - spc:read            — visualizar status SPC (admin + gestor_geral + cobranca)
//   - spc:manage          — inserir/remover do SPC (admin + gestor_geral + cobranca)
//   - tasks:read          — listar tarefas do role (admin + gestor_geral + cobranca)
//   - tasks:write         — criar tarefas (admin + gestor_geral + cobranca)
//   - tasks:claim         — assumir tarefa (admin + gestor_geral + cobranca)
//   - tasks:complete      — concluir tarefa (admin + gestor_geral + cobranca)
//   - notifications:read  — ler notificações in-app (admin + gestor_geral + cobranca)
//
// IMPORTANTE: as migrations SQL devem ser criadas separadamente em db/migrations/.
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

/**
 * Definição das permissões do módulo ai-console/playground.
 * Corresponde ao SQL da migration 0029_seed_ai_playground_permission.sql.
 *
 * Nota: ai_playground:run é admin-only — acesso privilegiado ao dry-run do grafo
 * LangGraph. O middleware `authorize({ permissions: ['ai_playground:run'] })` é a
 * única barreira de RBAC (sem role-name check no service).
 */
export const AI_PLAYGROUND_PERMISSIONS = [
  {
    key: 'ai_playground:run',
    description: 'Execução do playground dry-run do agente LangGraph (somente admin)',
    roles: ['admin'],
  },
] as const;

export type AiPlaygroundPermissionKey = (typeof AI_PLAYGROUND_PERMISSIONS)[number]['key'];

/**
 * Definição da permissão de disparo de simulação por WhatsApp.
 * Corresponde ao SQL da migration 0053_seed_simulation_template_flag.sql.
 *
 * Nota: simulations:send é admin-only no seed inicial. Pode ser expandida para
 * gestor_geral/agente via UI de admin conforme necessidade operacional.
 */
export const SIMULATIONS_SEND_PERMISSIONS = [
  {
    key: 'simulations:send',
    description: 'Disparo de simulação de crédito por WhatsApp para o lead',
    roles: ['admin'],
  },
] as const;

export type SimulationsSendPermissionKey = (typeof SIMULATIONS_SEND_PERMISSIONS)[number]['key'];

/**
 * Permissões do módulo de cobrança avançada (F15-S01).
 * Corresponde ao SQL da migration 0056_seed_cobranca_role_permissions.sql.
 *
 * Role `cobranca` criado com scope = 'global' (decisão D11: cobrança centralizada,
 * sem city_scope obrigatório).
 *
 * billing:reconcile distingue-se de billing:mark_paid (0044): reconcile é
 * voltado ao time de cobrança que opera importações e ajustes manuais na régua;
 * mark_paid é operação administrativa pontual.
 *
 * tasks:* e notifications:read são fundação transversal — as tabelas `tasks` e
 * `notifications` serão criadas em slots subsequentes; as permissões ficam
 * pré-registradas para que o RBAC já funcione no dia em que as rotas subirem.
 */
export const COBRANCA_PERMISSIONS = [
  {
    key: 'billing:reconcile',
    description:
      'Reconciliação/baixa manual de cobranças — marca parcela como conciliada via importação ou ajuste avulso',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'spc:read',
    description:
      'Visualização do status SPC do cliente (none/pending_inclusion/included/removed) e histórico de alterações',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'spc:manage',
    description:
      'Inserção, remoção e atualização do status SPC do cliente; dispara evento de outbox para auditoria',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'tasks:read',
    description:
      'Listagem de tarefas atribuídas ao próprio role (filtradas por cidade via user_city_scopes quando role não é global)',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'tasks:write',
    description:
      'Criação de tarefas — usada pelo sistema (scheduler/outbox) e por usuários com permissão explícita',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'tasks:claim',
    description:
      'Assumir uma tarefa pendente (muda claimed_by para o usuário atual; status→in_progress)',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'tasks:complete',
    description: 'Concluir uma tarefa assumida (status→done; registra completed_at + completed_by)',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
  {
    key: 'notifications:read',
    description:
      'Leitura das notificações in-app do usuário autenticado (badge + listagem); canal fan-out de outbox',
    roles: ['admin', 'gestor_geral', 'cobranca'],
  },
] as const;

export type CobrancaPermissionKey = (typeof COBRANCA_PERMISSIONS)[number]['key'];

/**
 * Permissões do módulo de contratos (F17-S03).
 * Corresponde ao SQL da migration 0060_seed_contracts_permissions.sql.
 *
 * contracts:read  → leitura de contratos (listagem + detalhe).
 * contracts:write → criação e edição de contratos (restrito a admin, gestor_geral).
 * contracts:sign  → transição de status draft→signed→active (admin, gestor_geral, agente).
 *
 * Rationale:
 *   - write restrito a admin/gestor_geral: evitar que agentes criem contratos ad hoc
 *     sem aprovação de gestão; importação e criação são fluxos controlados.
 *   - sign disponível ao agente: o agente está presente na assinatura presencial
 *     e precisa registrar o ato no sistema.
 */
export const CONTRACTS_PERMISSIONS = [
  {
    key: 'contracts:read',
    description: 'Leitura de contratos do cliente — listagem e detalhe',
    roles: ['admin', 'gestor_geral', 'agente'],
  },
  {
    key: 'contracts:write',
    description: 'Criar e editar contratos — inserção e atualização de dados',
    roles: ['admin', 'gestor_geral'],
  },
  {
    key: 'contracts:sign',
    description: 'Marcar contrato como assinado — transição draft→signed→active',
    roles: ['admin', 'gestor_geral', 'agente'],
  },
] as const;

export type ContractsPermissionKey = (typeof CONTRACTS_PERMISSIONS)[number]['key'];
