// =============================================================================
// followupJobs.ts — Instâncias agendadas de follow-up por lead/regra (F5-S01).
//
// Cada followup_job representa uma tentativa de envio programada para
// um lead específico, sob uma regra específica, em um horário específico.
//
// Ciclo de vida (status):
//   scheduled       → job criado pelo scheduler, aguardando horário de envio.
//   triggered       → worker (F5-S03) pegou o job para processamento.
//   sent            → template enviado com sucesso via API Meta. wamid registrado.
//   failed          → falha no envio (API Meta, template rejeitado, etc.). Detalhes em last_error.
//   cancelled       → job cancelado antes de scheduled_at (lead foi atendido, regra desativada, etc.).
//   customer_replied → lead respondeu antes do envio (job cancelado com razão explícita).
//
// Idempotência:
//   `idempotency_key` + unique (lead_id, rule_id, idempotency_key) garantem que
//   o scheduler não cria dois jobs para o mesmo lead + regra + ciclo de agendamento.
//   Formato recomendado: "{lead_id}:{rule_id}:{date_bucket}" onde date_bucket é
//   a data UTC do ciclo (ex: "2026-05-25") — evita duplicatas em re-execuções do cron.
//
// Índices críticos de performance:
//   - Parcial (status, scheduled_at) WHERE status='scheduled': scanner principal do worker.
//     Retorna apenas jobs prontos para envio sem escanear jobs históricos (sent/failed/cancelled).
//   - (lead_id, created_at DESC): histórico de tentativas por lead para UI e auditorias.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
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

import { followupRules } from './followupRules.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const followupJobs = pgTable(
  'followup_jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Todo job pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead alvo deste job de follow-up.
     * FK ON DELETE CASCADE: se o lead for excluído (hard delete ou LGPD), todos
     * os jobs agendados são removidos automaticamente. Não faz sentido enviar
     * mensagem para lead que não existe mais.
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Regra que originou este job.
     * FK ON DELETE RESTRICT: não permite excluir regra enquanto houver jobs
     * ativos (scheduled/triggered). Jobs históricos (sent/failed) mantêm referência
     * para auditoria de qual regra gerou o envio.
     */
    ruleId: uuid('rule_id').notNull(),

    /**
     * Timestamp absoluto em que o worker deve processar este job.
     * Calculado pelo scheduler como: now() + followup_rules.wait_hours * interval '1 hour'.
     * O worker busca: WHERE status='scheduled' AND scheduled_at <= now()
     * com índice parcial idx_followup_jobs_scheduled.
     */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

    /**
     * Estado atual do job no pipeline de envio.
     * 'scheduled'       → aguardando scheduled_at (estado inicial).
     * 'triggered'       → worker pegou para processar (lock otimista via UPDATE).
     * 'sent'            → enviado com sucesso. sent_message_id preenchido.
     * 'failed'          → falha. last_error preenchido. Scheduler pode retentar
     *                     (até followup_rules.max_attempts).
     * 'cancelled'       → cancelado (lead atendido, regra desativada, org ativou flag off).
     * 'customer_replied'→ lead respondeu antes do envio (webhook WhatsApp notificou
     *                     que houve inbound — job deve ser cancelado pelo worker F5-S03).
     */
    status: text('status', {
      enum: ['scheduled', 'triggered', 'sent', 'failed', 'cancelled', 'customer_replied'],
    })
      .notNull()
      .default('scheduled'),

    /**
     * Número de tentativas de envio realizadas.
     * Incrementado pelo worker a cada tentativa (incluindo falhas).
     * O scheduler não cria novo job se attempt_count >= followup_rules.max_attempts.
     */
    attemptCount: integer('attempt_count').notNull().default(0),

    /**
     * Descrição do último erro de envio (caso status='failed').
     * Ex: "Meta API 131047: Template temporarily paused" ou
     *     "timeout after 30s waiting for Meta API response".
     * null quando status é scheduled/triggered/sent/cancelled/customer_replied.
     */
    lastError: text('last_error'),

    /**
     * WhatsApp Message ID (wamid) retornado pela Meta API após envio bem-sucedido.
     * Ex: "wamid.HBgLNTUxMTk5OTk5OTkVAgARGBI..."
     * null até status='sent'. Usado para correlacionar confirmações de entrega (status webhooks).
     */
    sentMessageId: text('sent_message_id'),

    /**
     * Chave de idempotência para evitar criação duplicada de jobs.
     * Combinada com (lead_id, rule_id) no unique index.
     * Formato recomendado: "{date_bucket}:{rule_key}" onde date_bucket é YYYY-MM-DD UTC.
     * Ex: "2026-05-25:d1" → job D+1 para o ciclo do dia 25/05/2026.
     * Garante que re-execuções do cron scheduler não criem duplicatas.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_followup_jobs_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkLead: foreignKey({
      name: 'fk_followup_jobs_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('cascade'),

    fkRule: foreignKey({
      name: 'fk_followup_jobs_rule',
      columns: [table.ruleId],
      foreignColumns: [followupRules.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /** attempt_count deve ser não-negativo. */
    chkAttemptCount: check(
      'chk_followup_jobs_attempt_count_non_negative',
      sql`${table.attemptCount} >= 0`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Dedupe de agendamento: mesmo lead + regra + ciclo não gera dois jobs.
     * O idempotency_key codifica o ciclo temporal (ex: data do bucket).
     * Garante exatamente-uma-vez na criação mesmo com re-execuções do cron.
     */
    uqLeadRuleIdempotency: uniqueIndex('uq_followup_jobs_lead_rule_idempotency').on(
      table.leadId,
      table.ruleId,
      table.idempotencyKey,
    ),

    /**
     * Scanner principal do worker (F5-S03).
     * Query: SELECT ... WHERE status='scheduled' AND scheduled_at <= now() LIMIT N.
     * Índice parcial: exclui jobs em estados terminais (sent/failed/cancelled)
     * que nunca voltam a ser processados — mantém o índice enxuto conforme volume cresce.
     *
     * NOTA: Drizzle não suporta índices parciais nativamente — a migration SQL
     * (0034_followup_and_templates.sql) é ajustada manualmente com a cláusula WHERE.
     */
    idxScheduled: index('idx_followup_jobs_scheduled').on(table.status, table.scheduledAt),

    /**
     * Histórico de tentativas por lead (UI + auditoria).
     * Query: "todas as tentativas de follow-up para o lead X, mais recentes primeiro".
     * Suporta a tela de histórico de follow-ups na ficha do lead (F5-S05).
     */
    idxLead: index('idx_followup_jobs_lead').on(table.leadId, table.createdAt),
  }),
);

export type FollowupJob = typeof followupJobs.$inferSelect;
export type NewFollowupJob = typeof followupJobs.$inferInsert;
