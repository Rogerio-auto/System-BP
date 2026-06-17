// =============================================================================
// collectionJobs.ts — Instâncias agendadas de cobrança por parcela/regra (F5-S06).
//
// Espelho de followup_jobs, adaptado para cobrança:
//   - payment_due_id (FK → payment_dues) em vez de lead_id.
//   - rule_id aponta para collection_rules em vez de followup_rules.
//   - status inclui 'paid_before_send' (parcela paga antes do envio do lembrete).
//
// Cada collection_job representa uma tentativa de envio programada para
// uma parcela específica, sob uma regra específica, em um horário específico.
//
// Ciclo de vida (status):
//   scheduled       → job criado pelo scheduler, aguardando scheduled_at.
//   triggered       → worker (F5-S07) pegou o job (lock otimista via UPDATE ... SKIP LOCKED).
//   sent            → template enviado com sucesso via Meta API. sent_message_id preenchido.
//   failed          → falha de envio. last_error preenchido. Retentativa até max_attempts.
//   cancelled       → cancelado antes do envio (regra desativada, org desligou billing, etc.).
//   paid_before_send→ parcela foi paga antes do scheduled_at — envio cancelado graciosamente.
//                     Diferente de followup_jobs (que tem 'customer_replied'):
//                     aqui o evento de cancelamento é o pagamento da dívida.
//
// Idempotência:
//   unique (payment_due_id, rule_id, idempotency_key) garante exatamente 1 job
//   por parcela + regra + ciclo de agendamento, mesmo em re-execuções do cron.
//   Formato recomendado de idempotency_key: "{YYYY-MM-DD}:{rule_key}"
//   onde YYYY-MM-DD é a due_date da parcela.
//   Ex: "2026-06-15:d7" → job D+7 para parcela vencida em 15/06/2026.
//
// LGPD (doc 17 §14.2 — Art. 7º V — execução de contrato):
//   - payment_due_id referencia entidade com customer_id (sem PII direta nesta tabela).
//   - Outbox payloads carregam apenas IDs — sem PII bruta.
//   - sent_message_id (wamid Meta) não é PII por si só.
//   - Retenção de jobs: limpar sent/failed/cancelled após 90 dias (job de purga futuro).
//
// Índices:
//   - unique (payment_due_id, rule_id, idempotency_key): dedupe de agendamento.
//   - parcial (status, scheduled_at) WHERE status='scheduled': scanner do worker.
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

import { channels } from './channels.js';
import { collectionRules } from './collectionRules.js';
import { organizations } from './organizations.js';
import { paymentDues } from './paymentDues.js';

export const collectionJobs = pgTable(
  'collection_jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Todo job pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Parcela alvo deste job de cobrança.
     * FK ON DELETE CASCADE: parcela excluída remove todos os seus jobs.
     * Garante consistência ao cancelar/excluir parcelas (ex: renegociação em massa).
     * Diferente de followup_jobs (lead ON DELETE CASCADE): aqui é a parcela, não o lead.
     */
    paymentDueId: uuid('payment_due_id').notNull(),

    /**
     * Regra de cobrança que originou este job.
     * FK ON DELETE RESTRICT: regra com jobs ativos não pode ser excluída.
     * Jobs históricos (sent/failed) mantêm referência para auditoria
     * de qual regra gerou o envio (rastreabilidade regulatória).
     */
    ruleId: uuid('rule_id').notNull(),

    /**
     * Timestamp absoluto em que o worker deve processar este job.
     * Calculado pelo scheduler como:
     *   scheduled_at = payment_dues.due_date::timestamptz + collection_rules.wait_hours * interval '1 hour'
     * Exemplo: due_date='2026-06-15', wait_hours=168 → scheduled_at='2026-06-22T00:00:00Z'.
     * Worker: WHERE status='scheduled' AND scheduled_at <= now() ... FOR UPDATE SKIP LOCKED.
     */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

    /**
     * Estado atual do job no pipeline de envio.
     * 'scheduled'      → aguardando scheduled_at (estado inicial).
     * 'triggered'      → worker pegou para processar (lock otimista).
     * 'sent'           → enviado com sucesso. sent_message_id preenchido.
     * 'failed'         → falha. last_error preenchido. Retentativa até max_attempts.
     * 'cancelled'      → cancelado (regra desativada, billing flag off, contrato encerrado).
     * 'paid_before_send' → parcela paga antes do scheduled_at — job obsoleto.
     *                     Worker de pagamento (F5-S07) deve cancelar jobs pendentes
     *                     ao registrar pagamento de uma parcela.
     */
    status: text('status', {
      enum: ['scheduled', 'triggered', 'sent', 'failed', 'cancelled', 'paid_before_send'],
    })
      .notNull()
      .default('scheduled'),

    /**
     * Número de tentativas de envio realizadas (incluindo falhas).
     * Scheduler não cria novo job se attempt_count >= collection_rules.max_attempts.
     * Incrementado pelo worker a cada tentativa.
     * Check: deve ser >= 0.
     */
    attemptCount: integer('attempt_count').notNull().default(0),

    /**
     * Descrição do último erro de envio (caso status='failed').
     * Ex: "Meta API 131047: Template temporarily paused"
     *     "timeout after 30s waiting for Meta API response".
     * null quando status != 'failed'.
     * Não logar sem redact (pode conter dados do payload de resposta da Meta).
     */
    lastError: text('last_error'),

    /**
     * WhatsApp Message ID (wamid) retornado pela Meta API após envio bem-sucedido.
     * Ex: "wamid.HBgLNTUxMTk5OTk5OTkVAgARGBI..."
     * null até status='sent'. Correlaciona confirmações de entrega via webhooks.
     * Não é PII por si só (ID opaco da Meta).
     */
    sentMessageId: text('sent_message_id'),

    /**
     * Chave de idempotência para evitar criação duplicada de jobs.
     * Combinada com (payment_due_id, rule_id) no unique index.
     * Formato recomendado: "{due_date}:{rule_key}"
     * Ex: "2026-06-15:d7" → job D+7 para parcela com due_date=2026-06-15.
     * Garante exatamente-uma-vez na criação mesmo com re-execuções do cron.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /**
     * Canal WhatsApp pelo qual este job de cobrança deve ser enviado.
     * Herdado de collection_rules.channel_id no momento da criação do job.
     * null = sem canal fixo (usa canal default da org no momento do envio).
     * ON DELETE SET NULL: canal excluído não cancela o job — worker usa canal default.
     * Índice parcial idx_collection_jobs_channel_scheduled filtra jobs pendentes por canal.
     */
    channelId: uuid('channel_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, ON DELETE pensado)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_collection_jobs_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * ON DELETE CASCADE: parcela excluída remove todos os seus jobs pendentes.
     * Evita jobs órfãos tentando cobrar parcelas que não existem mais.
     */
    fkPaymentDue: foreignKey({
      name: 'fk_collection_jobs_payment_due',
      columns: [table.paymentDueId],
      foreignColumns: [paymentDues.id],
    }).onDelete('cascade'),

    /**
     * ON DELETE RESTRICT: regra com jobs não pode ser excluída.
     * Preserva rastreabilidade de qual regra originou cada tentativa de cobrança.
     */
    fkRule: foreignKey({
      name: 'fk_collection_jobs_rule',
      columns: [table.ruleId],
      foreignColumns: [collectionRules.id],
    }).onDelete('restrict'),

    fkChannel: foreignKey({
      name: 'fk_collection_jobs_channel',
      columns: [table.channelId],
      foreignColumns: [channels.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /** attempt_count deve ser não-negativo. */
    chkAttemptCount: check(
      'chk_collection_jobs_attempt_count_non_negative',
      sql`${table.attemptCount} >= 0`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Dedupe de agendamento: mesma parcela + regra + ciclo gera exatamente 1 job.
     * O idempotency_key codifica o ciclo temporal (due_date + rule_key).
     * Garante exatamente-uma-vez na criação mesmo com re-execuções do cron.
     */
    uqPaymentDueRuleIdempotency: uniqueIndex('uq_collection_jobs_due_rule_idempotency').on(
      table.paymentDueId,
      table.ruleId,
      table.idempotencyKey,
    ),

    /**
     * Scanner principal do worker de cobrança (F5-S07).
     * Query: SELECT ... WHERE status='scheduled' AND scheduled_at <= now() LIMIT N FOR UPDATE SKIP LOCKED.
     * Índice parcial: exclui jobs em estados terminais (sent/failed/cancelled/paid_before_send)
     * que crescem sem limite com o tempo. Mantém o índice enxuto conforme carteira cresce.
     *
     * NOTA: Drizzle não suporta índices parciais nativamente — a migration SQL
     * (0036_collection.sql) define a cláusula WHERE manualmente.
     */
    idxScheduled: index('idx_collection_jobs_scheduled').on(table.status, table.scheduledAt),

    /**
     * Histórico de tentativas de cobrança por parcela (UI + auditoria).
     * Query: "todas as tentativas de cobrança para a parcela X, mais recentes primeiro".
     * Suporta: ficha da parcela em F5-S08 e relatórios de inadimplência.
     */
    idxPaymentDue: index('idx_collection_jobs_payment_due').on(table.paymentDueId, table.createdAt),

    /**
     * Jobs de cobrança pendentes por canal (F20 — roteamento multi-canal).
     * Query: "todos os jobs agendados para o canal X, ordered by scheduled_at".
     * Índice parcial: exclui estados terminais (sent/failed/cancelled/paid_before_send)
     * que crescem sem limite. Mantém índice enxuto conforme carteira de inadimplentes cresce.
     *
     * NOTA: cláusula WHERE parcial é adicionada manualmente na migration SQL 0067
     * pois Drizzle não suporta índices parciais nativamente.
     */
    idxChannelScheduled: index('idx_collection_jobs_channel_scheduled').on(
      table.channelId,
      table.scheduledAt,
    ),
  }),
);

export type CollectionJob = typeof collectionJobs.$inferSelect;
export type NewCollectionJob = typeof collectionJobs.$inferInsert;
