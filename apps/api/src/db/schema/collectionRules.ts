// =============================================================================
// collectionRules.ts — Catálogo de regras da régua de cobrança escalonada (F5-S06).
//
// Espelho de followup_rules, adaptado para cobrança de parcelas:
//   - trigger_type relativo à due_date (não ao stage de inatividade do lead).
//   - wait_hours representa offset em horas relativo a due_date:
//       negativo = antes do vencimento (ex: -72 = D-3 dias)
//       positivo = após o vencimento  (ex: 168 = D+7 dias)
//   - applies_to_status filtra por status de payment_due (não stage do kanban).
//
// Exemplos operacionais:
//   D-3:  trigger_type='days_before_due', wait_hours=-72,  applies_to_status='pending'
//   D+0:  trigger_type='days_after_due',  wait_hours=0,    applies_to_status='overdue'
//   D+7:  trigger_type='days_after_due',  wait_hours=168,  applies_to_status='overdue'
//   D+15: trigger_type='days_after_due',  wait_hours=360,  applies_to_status='overdue'
//
// Gating (triple-gate — zero disparo acidental em produção):
//   Nenhuma mensagem de cobrança é enviada sem que as 3 condições sejam verdadeiras:
//     1. feature_flags.billing.enabled = 'enabled'
//     2. feature_flags.billing.scheduler.enabled = 'enabled'
//     3. is_active = true (nesta regra)
//   is_active default false garante deploy em produção sem ativar cobrança.
//
// Índices:
//   - unique (organization_id, key): slug único por org (d-3, d0, d7, d15).
//   - idx_collection_rules_active: query do scheduler (todos os ativos por org).
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

export const collectionRules = pgTable(
  'collection_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda regra pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Slug identificador da regra no contexto da organização.
     * Convenção: "d-3" (3 dias antes), "d0" (dia do vencimento),
     *            "d7" (7 dias após), "d15" (15 dias após).
     * Usado em código e em idempotency_key dos collection_jobs.
     * Único por organização.
     */
    key: text('key').notNull(),

    /**
     * Nome descritivo para exibição na UI (F5-S08).
     * Ex: "Aviso D-3", "Cobrança D+7", "Último aviso D+15".
     */
    name: text('name').notNull(),

    /**
     * Tipo de gatilho que define o momento do collection_job.
     * 'days_before_due' → envio antes do vencimento (wait_hours negativo ou zero).
     *                     Ex: -72h (D-3) para lembrete preventivo.
     * 'days_after_due'  → envio após o vencimento (wait_hours positivo ou zero).
     *                     Ex: 168h (D+7) para cobrança de inadimplência.
     * O scheduler calcula: scheduled_at = due_date + wait_hours * interval '1 hour'.
     */
    triggerType: text('trigger_type', {
      enum: ['days_before_due', 'days_after_due'],
    }).notNull(),

    /**
     * Offset em horas relativo à due_date da parcela.
     * Negativo = antes do vencimento: -72 → D-3 dias (lembrete).
     * Zero     = no dia do vencimento: 0 → D+0 (cobrança na data).
     * Positivo = após o vencimento: 168 → D+7, 360 → D+15.
     * Diferente de followup_rules.wait_hours (sempre positivo):
     *   aqui o sinal é semanticamente relevante.
     */
    waitHours: integer('wait_hours').notNull(),

    /**
     * Template WhatsApp a enviar quando esta regra disparar.
     * FK ON DELETE RESTRICT: template não pode ser excluído se referenciado por regra.
     * O worker valida template.status='approved' antes de enviar.
     */
    templateId: uuid('template_id').notNull(),

    /**
     * Filtro por status atual da parcela (payment_dues.status).
     * null = regra se aplica independente do status.
     * Exemplos:
     *   'pending'  → regra D-3: só lembra parcelas ainda não vencidas.
     *   'overdue'  → regras D+7/D+15: só cobra inadimplentes.
     * Permite segmentar lembretes preventivos de cobranças pós-vencimento.
     */
    appliesToStatus: text('applies_to_status', {
      enum: ['pending', 'overdue', 'paid', 'renegotiated', 'cancelled'],
    }),

    /**
     * Controle de ativação da regra (gate operacional por regra).
     * false (default): regra cadastrada mas INATIVA — nenhum job criado.
     * true: scheduler cria collection_jobs conforme trigger.
     * Ver triple-gate acima: is_active=true é necessário mas não suficiente.
     */
    isActive: boolean('is_active').notNull().default(false),

    /**
     * Máximo de tentativas de envio por parcela/regra.
     * Após max_attempts, scheduler não cria mais jobs para esta parcela + regra.
     * Previne spam em falhas de entrega. Default: 3.
     * Check: deve ser >= 1.
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
      name: 'fk_collection_rules_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * ON DELETE RESTRICT: template referenciado por regra ativa não pode ser excluído.
     * Protege integridade do catálogo de templates em uso.
     */
    fkTemplate: foreignKey({
      name: 'fk_collection_rules_template',
      columns: [table.templateId],
      foreignColumns: [whatsappTemplates.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * max_attempts deve ser pelo menos 1.
     * Evitar regras com zero tentativas que nunca disparariam.
     */
    chkMaxAttempts: check(
      'chk_collection_rules_max_attempts_positive',
      sql`${table.maxAttempts} > 0`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Slug único por organização.
     * Permite referenciar regras pelo key (d-3, d0, d7, d15) em código.
     * Usado na composição do idempotency_key dos collection_jobs.
     */
    uqOrgKey: uniqueIndex('uq_collection_rules_org_key').on(table.organizationId, table.key),

    /**
     * Query do scheduler: "todas as regras de cobrança ativas da organização X".
     * Executada periodicamente (cron F5-S07) para decidir quais parcelas
     * recebem novos collection_jobs.
     */
    idxActive: index('idx_collection_rules_active').on(table.organizationId, table.isActive),
  }),
);

export type CollectionRule = typeof collectionRules.$inferSelect;
export type NewCollectionRule = typeof collectionRules.$inferInsert;
