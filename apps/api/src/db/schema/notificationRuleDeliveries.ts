// =============================================================================
// notificationRuleDeliveries.ts — Registro de entregas de regras de notificação
//                                  (F24-S01). Idempotência + controle de cooldown.
//
// Contexto (planejamento-notificacoes.md §4.3):
//   Toda vez que uma notification_rule dispara para uma entidade específica,
//   um registro é gravado aqui. Este registro serve para duas finalidades:
//
//   1. Idempotência:
//      Evita duplicação de notificações quando o worker roda mais de 1x para
//      o mesmo evento (ex: retry após falha transitória). O worker usa
//      INSERT ... ON CONFLICT DO NOTHING — se já existe registro para a
//      combinação (rule_id, entity_type, entity_id, bucket), a entrega é pulada.
//
//   2. Cooldown:
//      O worker consulta fired_at para verificar se cooldown_hours da regra
//      já expirou antes de disparar novamente para a mesma entidade.
//      Permite limitar notificações repetidas (ex: 1x/dia por lead).
//
// Bucket:
//   Texto livre que identifica o "slot temporal" ou contexto da entrega.
//   O worker define o bucket estrategicamente conforme o tipo de regra:
//     - Cooldown diário: data ISO (ex: "2026-06-30").
//     - Evento único: hash/UUID do event_id do outbox.
//     - Semana ISO: "2026-W26".
//   O UNIQUE em (rule_id, entity_type, entity_id, bucket) garante exatamente
//   1 entrega por regra por entidade por bucket.
//
// Sem soft-delete:
//   Registros de entrega são imutáveis após criação.
//   Limpeza por job de retenção LGPD: registros com fired_at antigo
//   (cooldown expirado + política de retenção da org) são purgados (§9 doc 17).
//
// Multi-tenant:
//   organization_id incluso para facilitar queries de limpeza por org e
//   particionamento futuro sem JOIN com notification_rules.
//
// Índices:
//   - (rule_id, fired_at): query de cooldown — "última entrega desta regra
//     para qualquer entidade dentro do período cooldown_hours".
//     Também usado pelo job de limpeza (WHERE fired_at < cutoff).
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { notificationRules } from './notificationRules.js';
import { organizations } from './organizations.js';

export const notificationRuleDeliveries = pgTable(
  'notification_rule_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Entrega pertence à organização da regra disparada. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Regra que disparou esta entrega.
     * FK notification_rules ON DELETE CASCADE: ao remover uma regra, todos os
     * seus registros de entrega são apagados automaticamente.
     * Evita rastros de regras extintas contaminando queries de cooldown.
     */
    ruleId: uuid('rule_id').notNull(),

    /**
     * Tipo da entidade para qual a notificação foi gerada (polimorfismo).
     * Exemplos: 'lead', 'contract', 'payment_due'.
     * Sem FK rígida — entidade pode ser de qualquer tabela.
     * Combinado com entity_id identifica univocamente a entidade alvo.
     */
    entityType: text('entity_type').notNull(),

    /**
     * UUID da entidade para qual a notificação foi gerada.
     * Sem FK rígida — polimorfismo sem restrição de tabela.
     */
    entityId: uuid('entity_id').notNull(),

    /**
     * Slot temporal ou chave de idempotência da entrega.
     * O UNIQUE em (rule_id, entity_type, entity_id, bucket) garante
     * exatamente 1 entrega por combinação regra + entidade + bucket.
     * O worker define o bucket conforme a estratégia de cooldown da regra:
     *   - Cooldown diário: "2026-06-30" (data ISO da avaliação).
     *   - Evento único: UUID/hash do event_id do outbox (garante 1 entrega/evento).
     *   - Semana ISO: "2026-W26" (para cooldowns semanais).
     */
    bucket: text('bucket').notNull(),

    /**
     * Timestamp em que a regra disparou para esta entidade.
     * Usado pelo worker para calcular se cooldown_hours expirou:
     *   now() - fired_at > interval '? hours' → pode disparar novamente.
     * Também usado pelo job de limpeza LGPD para purgar registros antigos.
     */
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_notification_rule_deliveries_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkRule: foreignKey({
      name: 'fk_notification_rule_deliveries_rule',
      columns: [table.ruleId],
      foreignColumns: [notificationRules.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Unique Constraint (Idempotência de entrega)
    // -------------------------------------------------------------------------

    /**
     * Garante exatamente 1 entrega por (regra, entidade, bucket).
     * Worker usa INSERT ... ON CONFLICT (rule_id, entity_type, entity_id, bucket)
     * DO NOTHING para entrega idempotente: se já existe → skip silencioso.
     * Permite reprocessamento seguro do worker sem duplicar notificações.
     */
    uqRuleEntityBucket: uniqueIndex('uq_notification_rule_deliveries_rule_entity_bucket').on(
      table.ruleId,
      table.entityType,
      table.entityId,
      table.bucket,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Query de cooldown e limpeza de registros antigos.
     * Cooldown: SELECT MAX(fired_at) WHERE rule_id=X AND entity_id=Y → compara com cooldown_hours.
     * Limpeza LGPD: DELETE WHERE rule_id=X AND fired_at < (now() - interval '90 days').
     * B-tree composto: rule_id (equality) + fired_at (range/ORDER DESC).
     */
    idxRuleFiredAt: index('idx_notification_rule_deliveries_rule_fired_at').on(
      table.ruleId,
      table.firedAt,
    ),
  }),
);

export type NotificationRuleDelivery = typeof notificationRuleDeliveries.$inferSelect;
export type NewNotificationRuleDelivery = typeof notificationRuleDeliveries.$inferInsert;
