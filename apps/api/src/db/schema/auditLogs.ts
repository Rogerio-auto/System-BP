// =============================================================================
// auditLogs.ts — Schema Drizzle para a tabela audit_logs (F1-S16).
//
// Tabela append-only. Nenhuma linha deve ser atualizada ou deletada.
// O helper auditLog() em src/lib/audit.ts é a única forma de inserir aqui.
//
// Colunas:
//   id              — UUID primário gerado no banco.
//   organization_id — FK multi-tenant → organizations(id).
//   actor_user_id   — FK nullable → users(id) ON DELETE set null.
//   actor_role      — Snapshot da role no momento da ação.
//   action          — Formato "<dominio>.<verbo>". Ex: "leads.created".
//   resource_type   — Tipo do recurso. Ex: "lead", "user".
//   resource_id     — UUID (como text) do recurso afetado.
//   before          — Snapshot do estado anterior (jsonb). Nullable.
//   after           — Snapshot do estado posterior (jsonb). Nullable.
//   ip              — IP do cliente. Nullable para ações de sistema.
//   user_agent      — User-Agent truncado. Nullable.
//   correlation_id  — Propagado do request/evento de origem. Nullable.
//   created_at      — Imutável. Nunca atualizado.
//
// LGPD §8.5 / docs/10 §5.2:
//   Os campos `before` e `after` PODEM conter PII. O caller é responsável
//   por aplicar redactSensitive() antes de chamar auditLog().
//   O helper NÃO redacta automaticamente. Ver audit.ts.
//   Retenção: mínimo 5 anos para ações de crédito, 2 anos para demais.
//   Job de purga/arquivamento planejado para F2 (sem TTL no MVP).
//
// FK para users declarada na migration SQL (0004_audit_logs.sql).
// Drizzle não expõe foreignKey() com ON DELETE set null de forma idiomática —
// FK definida via SQL puro para clareza e controle.
// =============================================================================
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * FK multi-tenant. Todo registro pertence a uma organização.
     * ON DELETE restrict — organização não pode ser removida com logs ativos.
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * UUID do usuário que executou a ação.
     * null para ações de sistema (worker, job, integração interna).
     * ON DELETE set null — logs permanecem após desativação/remoção do usuário.
     */
    actorUserId: uuid('actor_user_id'),

    /**
     * Role do ator no momento da ação (snapshot imutável).
     * null para ações de sistema.
     * Armazenado aqui porque a role do usuário pode mudar após a ação.
     */
    actorRole: text('actor_role'),

    /**
     * Ação executada. Formato: "<dominio>.<verbo>".
     * Exemplos: "leads.created", "user.password_changed", "kanban.stage_updated".
     * Ver docs/10 §5.1 para lista canônica de ações auditadas.
     */
    action: text('action').notNull(),

    /**
     * Tipo do recurso afetado.
     * Exemplos: "lead", "user", "feature_flag", "kanban_card".
     */
    resourceType: text('resource_type').notNull(),

    /**
     * Identificador do recurso afetado (UUID como text para flexibilidade).
     * Texto para suportar IDs compostos futuros sem migration.
     */
    resourceId: text('resource_id').notNull(),

    /**
     * Estado do recurso ANTES da mutação.
     *
     * LGPD — ATENÇÃO:
     *   Este campo PODE conter PII (CPF hash, e-mail, nome, etc.).
     *   O caller deve aplicar redactSensitive() antes de chamar auditLog().
     *   O helper audit.ts NÃO redacta automaticamente.
     *
     * null em ações de criação (não há estado anterior).
     */
    before: jsonb('before'),

    /**
     * Estado do recurso APÓS a mutação.
     *
     * LGPD — ATENÇÃO:
     *   Este campo PODE conter PII. Mesma regra do campo `before`.
     *
     * null em ações de exclusão (não há estado posterior).
     */
    after: jsonb('after'),

    /**
     * Endereço IP do cliente (IPv4 ou IPv6).
     * null para ações de sistema sem contexto HTTP.
     */
    ip: text('ip'),

    /**
     * User-Agent do cliente, truncado a 512 chars para prevenir abuso.
     * null para ações de sistema.
     */
    userAgent: text('user_agent'),

    /**
     * Correlation ID propagado do HTTP request ou evento de origem.
     * Permite rastrear a cadeia: request → mutação → audit log → outbox.
     * null para ações sem contexto de rastreabilidade.
     */
    correlationId: uuid('correlation_id'),

    /**
     * Timestamp imutável de criação.
     * Nunca deve ser atualizado — esta é uma tabela append-only.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Índice principal: filtro por organização + período (mais comum na tela /admin/audit)
    // DESC em created_at: retorna mais recente primeiro sem sort adicional
    index('idx_audit_logs_org_created').on(table.organizationId, table.createdAt),

    // Índice para timeline de um recurso específico
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),

    // Índice para auditoria por ator (ex: "o que o usuário X fez?")
    // Drizzle não suporta índice parcial WHERE IS NOT NULL nativamente —
    // o índice completo é declarado aqui; o parcial está na migration SQL.
    index('idx_audit_logs_actor_user').on(table.actorUserId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
