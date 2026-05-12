// =============================================================================
// data_subject.ts — Tabelas para direitos do titular LGPD (F1-S25).
//
// Tabelas:
//   data_subject_requests — solicitações de direitos do titular (Art. 18 LGPD).
//   retention_runs        — auditoria das rodadas do cron de retenção.
//
// LGPD (doc 17 §5, §6):
//   - payload_meta: NUNCA contém PII bruta — apenas metadata.
//   - document_hash: HMAC-SHA256 do CPF — para casos órfãos sem customer_id.
//   - request_id: chave de idempotência fornecida pelo cliente.
//   - SLA: 15 dias úteis para atender solicitações de acesso (Art. 18 §3 LGPD).
//
// Multi-tenant: organization_id em todas as tabelas de domínio.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// data_subject_requests
// ---------------------------------------------------------------------------

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Cliente que fez a solicitação.
     * NULL para casos órfãos (titular identificado apenas por document_hash).
     * ON DELETE SET NULL: solicitação é preservada mesmo após customer deletado.
     */
    customerId: uuid('customer_id'),

    /**
     * HMAC-SHA256 do documento (CPF) do titular.
     * Usado em casos órfãos onde customer não foi encontrado pelo document_hash.
     * NUNCA armazenar CPF em claro — doc 17 §8.1.
     */
    documentHash: text('document_hash'),

    /**
     * Chave de idempotência fornecida pelo cliente.
     * Garante que a mesma solicitação enviada duas vezes produza exatamente 1 linha.
     * UNIQUE global (não por org): o cliente define IDs únicos universalmente.
     */
    requestId: text('request_id').notNull().unique(),

    /**
     * Tipo da solicitação do titular.
     * 'confirmation'    — confirmação de que dados são tratados (Art. 19 §1).
     * 'access'          — acesso aos dados (Art. 18 II).
     * 'portability'     — portabilidade em formato aberto (Art. 18 V).
     * 'consent_revoke'  — revogação de consentimento (Art. 8 §5).
     * 'anonymize'       — anonimização (Art. 18 IV).
     * 'deletion'        — eliminação quando base legal era consentimento (Art. 18 VI).
     * 'review_decision' — revisão de decisão automatizada (Art. 20).
     */
    type: text('type', {
      enum: [
        'confirmation',
        'access',
        'portability',
        'consent_revoke',
        'anonymize',
        'deletion',
        'review_decision',
      ],
    }).notNull(),

    /**
     * Estado da solicitação.
     * 'received'           — registrada, aguardando processamento.
     * 'in_progress'        — job de atendimento iniciado.
     * 'fulfilled'          — atendida dentro do SLA.
     * 'rejected'           — negada com justificativa (ex: base legal válida).
     * 'pending_dpo_review' — aguarda análise do DPO (ex: anonimização).
     */
    status: text('status', {
      enum: ['received', 'in_progress', 'fulfilled', 'rejected', 'pending_dpo_review'],
    })
      .notNull()
      .default('received'),

    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Quando a solicitação foi efetivamente atendida.
     * NULL até status = 'fulfilled'.
     */
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),

    /**
     * Usuário interno que atendeu (DPO, admin).
     * NULL para atendimento automático (worker).
     * ON DELETE SET NULL: log preservado após remoção de usuário.
     */
    fulfilledBy: uuid('fulfilled_by'),

    /**
     * Canal pelo qual o titular foi verificado e será notificado.
     * 'whatsapp' — opt-in ativo.
     * 'email'    — fallback.
     */
    channel: text('channel', {
      enum: ['whatsapp', 'email'],
    }).notNull(),

    /**
     * Metadata da solicitação sem PII bruta.
     * Exemplos: { otp_verified_at, channel_verified, request_source, ip_hash }.
     * LGPD doc 17 §8.5: NUNCA incluir CPF, email, telefone, nome em claro.
     */
    payloadMeta: jsonb('payload_meta')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * ID da análise de crédito associada a solicitações de revisão de decisão.
     * NULL para outros tipos de solicitação.
     */
    analysisId: uuid('analysis_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_dsr_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_dsr_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('setNull'),

    foreignKey({
      name: 'fk_dsr_fulfilled_by',
      columns: [table.fulfilledBy],
      foreignColumns: [users.id],
    }).onDelete('setNull'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /** Busca de solicitações de um titular específico por data. */
    index('idx_dsr_customer_created').on(table.customerId, table.createdAt),

    /** Fila de processamento: pegar solicitações pendentes por org. */
    index('idx_dsr_org_status_created').on(table.organizationId, table.status, table.createdAt),

    /**
     * Casos órfãos: busca por document_hash quando customer_id não existe.
     * Parcial: apenas rows com document_hash preenchido.
     */
    uniqueIndex('idx_dsr_document_hash')
      .on(table.documentHash)
      .where(sql`${table.documentHash} IS NOT NULL`),
  ],
);

export type DataSubjectRequest = typeof dataSubjectRequests.$inferSelect;
export type NewDataSubjectRequest = typeof dataSubjectRequests.$inferInsert;

// ---------------------------------------------------------------------------
// retention_runs
// ---------------------------------------------------------------------------

export const retentionRuns = pgTable('retention_runs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),

  /**
   * Contagens de registros afetados por categoria.
   * Exemplo: { leads_anonymized: 5, customers_anonymized: 2, interactions_deleted: 10, sessions_deleted: 3 }
   * Sem PII nos valores.
   */
  affectedCounts: jsonb('affected_counts')
    .notNull()
    .default(sql`'{}'::jsonb`),

  /**
   * Lista de erros parciais da rodada.
   * Exemplo: [{ entity_type: "lead", entity_id: "uuid", error: "FK violation" }]
   * entity_id é UUID — não é PII.
   */
  errors: jsonb('errors')
    .notNull()
    .default(sql`'[]'::jsonb`),
});

export type RetentionRun = typeof retentionRuns.$inferSelect;
export type NewRetentionRun = typeof retentionRuns.$inferInsert;
