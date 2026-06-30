// =============================================================================
// notificationRules.ts — Regras configuráveis do motor de notificação (F24-S01).
//
// Contexto (planejamento-notificacoes.md §4.2):
//   Uma "notification_rule" define QUANDO e PARA QUEM gerar notificações.
//   O worker avalia as regras ativas periodicamente:
//     1. Para trigger_kind='event': dispara ao receber evento outbox com
//        trigger_key correspondente (ex: 'lead.stage_changed').
//     2. Para trigger_kind='stage_inactivity': dispara quando um lead ficou
//        no mesmo kanban stage sem atividade por threshold_hours horas.
//
// Gating:
//   enabled=false (default) → regra cadastrada mas INATIVA.
//   O worker só processa regras com enabled=true E feature flag ativa.
//   Triple-gate evita disparo acidental em produção.
//
// Cooldown:
//   cooldown_hours > 0: o worker verifica notification_rule_deliveries para
//   garantir que a mesma entidade não receba a mesma notificação mais de 1x
//   dentro do período de cooldown.
//
// Multi-tenant:
//   organization_id NOT NULL em toda tabela de domínio (§8 CLAUDE.md).
//
// CHECK:
//   threshold_hours obrigatório quando trigger_kind='stage_inactivity'.
//   NULL permitido apenas para trigger_kind='event' (sem espera mínima).
//
// LGPD (doc 17):
//   title_template/body_template podem conter PII indireta após interpolação
//   ({{lead_name}}, {{valor_parcela}}). Não logar sem redact.
//   Retenção: regras inativas por mais de 2 anos podem ser arquivadas (§9 doc 17).
//
// Índices:
//   - (organization_id, enabled, trigger_kind): query do worker por tipo de gatilho.
//   - (organization_id, trigger_key): lookup de regras por evento específico.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda regra pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Nome descritivo da regra para exibição na UI de configuração.
     * Ex: "Alerta de inatividade no kanban — Qualificação".
     */
    name: text('name').notNull(),

    /**
     * Tipo de gatilho da regra.
     * 'event'            → disparado por evento específico do outbox (trigger_key).
     * 'stage_inactivity' → disparado quando lead fica inativo no kanban stage
     *                      por threshold_hours horas (worker periódico).
     */
    triggerKind: text('trigger_kind', {
      enum: ['event', 'stage_inactivity'],
    }).notNull(),

    /**
     * Identificador do gatilho específico.
     * Para 'event': slug do evento outbox (ex: 'lead.stage_changed').
     * Para 'stage_inactivity': slug do kanban stage (ex: 'qualifying').
     */
    triggerKey: text('trigger_key').notNull(),

    /**
     * Categoria da notificação gerada por esta regra.
     * Espelhada em notification_preferences.category — permite que usuários
     * configurem preferências de canal por categoria (§4.5 planejamento-notificacoes.md).
     * Exemplos: 'lead', 'payment', 'task', 'system'.
     * Texto livre — extensível sem migration; validação Zod na borda HTTP.
     */
    category: text('category').notNull(),

    /**
     * Horas de inatividade necessárias para disparar a regra.
     * OBRIGATÓRIO quando trigger_kind='stage_inactivity'.
     * NULL quando trigger_kind='event' (irrelevante — sem espera mínima).
     * Enforçado por CHECK constraint chk_notification_rules_threshold_hours.
     */
    thresholdHours: integer('threshold_hours'),

    /**
     * Filtros adicionais em formato jsonb.
     * Schema aberto — permite refinar o escopo da regra sem migration.
     * Exemplos: { "stage": "qualifying" }, { "credit_product_id": "<uuid>" }.
     * DEFAULT '{}' = sem filtro (regra aplica-se a todos os leads da org).
     */
    filters: jsonb('filters')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Modo de destinatário: quem recebe a notificação gerada.
     * 'by_role_city' → usuários com role em recipient_roles + cidade da entidade.
     * 'assignee'     → agente responsável pela entidade (ex: lead.agent_id).
     * 'managers'     → gestores da organização (roles com escopo global).
     */
    recipientMode: text('recipient_mode', {
      enum: ['by_role_city', 'assignee', 'managers'],
    }).notNull(),

    /**
     * Roles canônicas (keys) que receberão a notificação.
     * Relevante apenas para recipientMode='by_role_city'.
     * Ex: ['agent', 'supervisor']. DEFAULT '{}' = todos os roles da org.
     * Texto[] sem FK — keys de roles são imutáveis (doc 10 §3.1).
     */
    recipientRoles: text('recipient_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /**
     * Canais de entrega da notificação.
     * Valores esperados: 'in_app', 'email', 'whatsapp'.
     * Texto[] (não enum) para extensibilidade sem migration.
     * DEFAULT '{in_app}' = apenas notificação in-app (sino).
     */
    channels: text('channels')
      .array()
      .notNull()
      .default(sql`'{in_app}'::text[]`),

    /**
     * Severidade visual da notificação gerada pelo frontend.
     * 'info'     — informativo (ícone/borda azul).
     * 'warning'  — atenção necessária (ícone/borda amarelo).
     * 'critical' — ação urgente (ícone/borda vermelho — badge destacado no sino).
     */
    severity: text('severity', {
      enum: ['info', 'warning', 'critical'],
    })
      .notNull()
      .default('info'),

    /**
     * Horas mínimas entre disparos para a mesma entidade (controle de cooldown).
     * 0 (default) = sem cooldown — regra dispara a cada ciclo de avaliação.
     * > 0: worker verifica notification_rule_deliveries para evitar
     *       notificações repetidas dentro do período.
     * Exemplo: cooldown_hours=24 → no máximo 1 notificação/dia por lead.
     */
    cooldownHours: integer('cooldown_hours').notNull().default(0),

    /**
     * Template do título da notificação (Handlebars-like).
     * Interpolação: {{lead_name}}, {{stage_name}}, {{hours}}.
     * LGPD: pode conter PII indireta após renderização — não logar sem redact.
     */
    titleTemplate: text('title_template').notNull(),

    /**
     * Template do corpo da notificação (Handlebars-like).
     * Interpolação: {{lead_name}}, {{agent_name}}, {{valor_parcela}}.
     * LGPD: pode conter PII indireta após renderização — não logar sem redact.
     */
    bodyTemplate: text('body_template').notNull(),

    /**
     * Regra habilitada?
     * false (default): cadastrada mas INATIVA — worker ignora completamente.
     * true:  regra ativa — worker processa a cada ciclo de avaliação.
     * Além de enabled=true, a feature flag correspondente deve estar em 'enabled'
     * (triple-gate garante zero disparo acidental em produção).
     */
    enabled: boolean('enabled').notNull().default(false),

    /**
     * Usuário que criou a regra (para auditoria e exibição na UI de configuração).
     * Nullable: NULL quando criada via seed/migration sem usuário humano.
     * FK users ON DELETE SET NULL: preserva a regra mesmo que o criador
     * seja removido do sistema — a regra segue funcionando autonomamente.
     */
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_notification_rules_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkCreatedBy: foreignKey({
      name: 'fk_notification_rules_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * threshold_hours DEVE ser preenchido quando o gatilho é 'stage_inactivity'.
     * Sem ele, o worker não saberia quantas horas aguardar antes de disparar.
     * Para trigger_kind='event', threshold_hours é ignorado (pode ser NULL).
     */
    chkThresholdHours: check(
      'chk_notification_rules_threshold_hours',
      sql`${table.triggerKind} <> 'stage_inactivity' OR ${table.thresholdHours} IS NOT NULL`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Query principal do worker de avaliação de regras.
     * "Todas as regras ativas de trigger_kind X na organização Y."
     * B-tree composto: org (equality) + enabled (bool filter) + trigger_kind.
     * Cobertura: o worker primeiro filtra por org + enabled=true, depois por kind.
     */
    idxOrgEnabledTriggerKind: index('idx_notification_rules_org_enabled_trigger_kind').on(
      table.organizationId,
      table.enabled,
      table.triggerKind,
    ),

    /**
     * Lookup de regras por evento específico.
     * "Quais regras respondem ao evento 'lead.stage_changed' na org X?"
     * Usado pelo worker de eventos para rotear notificações por trigger_key.
     */
    idxOrgTriggerKey: index('idx_notification_rules_org_trigger_key').on(
      table.organizationId,
      table.triggerKey,
    ),
  }),
);

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
