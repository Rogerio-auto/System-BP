// =============================================================================
// followupRules.ts — Catálogo de regras da régua de follow-up automático (F5-S01).
//
// Uma regra define QUANDO e COMO entrar em contato com um lead que ficou
// inativo por um período determinado. Exemplos operacionais:
//   - d1: contato após 24h sem resposta do lead no stage "qualifying"
//   - d3: contato após 72h sem resposta (segunda tentativa)
//   - d7: contato após 7 dias (terceira tentativa — último push)
//   - d15: contato após 15 dias (win-back de leads arquivados)
//
// Gating (crítico):
//   Todas as regras têm `is_active = false` por padrão.
//   O worker de agendamento (F5-S02) verifica:
//     1. flag `followup.scheduler.enabled = enabled` (global)
//     2. flag `followup.enabled = enabled` (módulo)
//     3. `is_active = true` na regra específica
//   Sem todas as 3 condições verdadeiras, nenhum followup_job é criado.
//
// Filtros opcionais (applies_to_stage, applies_to_outcome):
//   Permitem segmentar regras por posição do lead no pipeline.
//   null = sem filtro (regra se aplica a todos os leads).
//   Ex: applies_to_stage='qualifying' + applies_to_outcome=null → só leads em qualificação.
//
// Índices:
//   - unique (organization_id, key): slug único por org (d1, d3, d7, d15).
//   - idx_followup_rules_active: query do scheduler (todos os ativos por org).
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { whatsappTemplates } from './whatsappTemplates.js';

export const followupRules = pgTable(
  'followup_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda regra pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Slug identificador da regra no contexto da organização.
     * Convenção: "d1" (1 dia), "d3" (3 dias), "d7" (7 dias), "d15" (15 dias).
     * Usado em código para referenciar regras sem depender de UUID.
     * Único por organização.
     */
    key: text('key').notNull(),

    /**
     * Nome descritivo para exibição na UI (F5-S05).
     * Ex: "Follow-up D+1", "Reengajamento D+7".
     */
    name: text('name').notNull(),

    /**
     * Tipo de gatilho que cria followup_jobs para esta regra.
     * 'stage_inactivity' → lead ficou no mesmo kanban stage sem atividade por
     *                       wait_hours horas (verificado pelo scheduler F5-S02).
     * 'event_based'      → gatilho por evento específico do outbox (ex:
     *                       lead.stage_changed, lead.simulation_completed).
     *                       Implementação futura — suporte inicial apenas stage_inactivity.
     */
    triggerType: text('trigger_type', {
      enum: ['stage_inactivity', 'event_based'],
    }).notNull(),

    /**
     * Tempo de espera em horas antes de acionar o follow-up.
     * Ex: 24 (1 dia), 72 (3 dias), 168 (7 dias), 360 (15 dias).
     * Check: deve ser maior que 0 (sem follow-up imediato).
     */
    waitHours: integer('wait_hours').notNull(),

    /**
     * Template WhatsApp a ser enviado quando esta regra disparar.
     * FK ON DELETE RESTRICT: template não pode ser excluído se referenciado por regra.
     * O worker valida que template.status='approved' antes de enviar.
     */
    templateId: uuid('template_id').notNull(),

    /**
     * Filtro por kanban stage atual do lead.
     * null = regra se aplica independente do stage.
     * Ex: 'qualifying' = só roda para leads em qualificação.
     * Valor deve ser um slug válido de kanban_stages (não há FK — validação app-level).
     */
    appliesToStage: text('applies_to_stage'),

    /**
     * Filtro por outcome (campo de resultado) do lead.
     * null = regra se aplica independente do outcome.
     * Ex: 'pending_docs' = só para leads aguardando documentação.
     * Valor livre — alinhado com valores de leads.metadata.outcome.
     */
    appliesToOutcome: text('applies_to_outcome'),

    /**
     * Controle de ativação da regra (gating operacional).
     * false (default): regra cadastrada mas INATIVA — nenhum job criado.
     * true:  regra ativa — scheduler cria followup_jobs conforme trigger.
     *
     * Além de is_active=true, as flags followup.enabled e
     * followup.scheduler.enabled devem estar em 'enabled'.
     * Triple-gate garante zero disparo acidental em produção.
     */
    isActive: boolean('is_active').notNull().default(false),

    /**
     * Número máximo de tentativas de envio por lead/regra.
     * Após atingir max_attempts, o scheduler não cria novos jobs para
     * este lead + regra (evita spam infinito em caso de falha de entrega).
     * Default: 3 (configurável por organização no futuro via settings).
     */
    maxAttempts: integer('max_attempts').notNull().default(3),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_followup_rules_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkTemplate: foreignKey({
      name: 'fk_followup_rules_template',
      columns: [table.templateId],
      foreignColumns: [whatsappTemplates.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /** wait_hours deve ser positivo — sem follow-up imediato ou retroativo. */
    chkWaitHours: check('chk_followup_rules_wait_hours_positive', sql`${table.waitHours} > 0`),

    /** max_attempts deve ser pelo menos 1. */
    chkMaxAttempts: check(
      'chk_followup_rules_max_attempts_positive',
      sql`${table.maxAttempts} > 0`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Slug único por organização.
     * Permite referenciar regras pelo key (d1, d3...) em código e relatórios.
     */
    uqOrgKey: uniqueIndex('uq_followup_rules_org_key').on(table.organizationId, table.key),

    /**
     * Query do scheduler: "todas as regras ativas da organização X".
     * Executada periodicamente (cron F5-S02) para decidir quais leads
     * recebem novos followup_jobs.
     */
    idxActive: index('idx_followup_rules_active').on(table.organizationId, table.isActive),
  }),
);

export type FollowupRule = typeof followupRules.$inferSelect;
export type NewFollowupRule = typeof followupRules.$inferInsert;
