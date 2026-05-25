// =============================================================================
// creditAnalyses.ts — Cabeçalho de cada análise de crédito.
//
// Contexto: F4-S01.
// Dependências: F2-S01 (credit_simulations), F1-S09 (leads, customers), F1-S13,
//               F1-S15, F1-S24.
//
// Uma análise de crédito representa o processo de avaliação formal de uma
// solicitação de crédito para um lead. Uma linha por análise ativa, com
// ponteiro para a versão (parecer) atualmente vigente.
//
// Lifecycle:
//   em_analise → pendente → aprovado | recusado | cancelado
//   Qualquer transição cria uma nova entrada em credit_analysis_versions.
//   O campo current_version_id é atualizado junto — na mesma transação.
//
// Imutabilidade de versões:
//   credit_analysis_versions nunca recebe UPDATE após inserção.
//   Esta tabela (credit_analyses) recebe UPDATE via trigger set_updated_at.
//
// Multi-tenant: organization_id denormalizado para city-scope sem JOIN.
//
// LGPD:
//   - lead_id e customer_id apontam para entidades com PII — redact obrigatório
//     antes de logar. Não expor em logs de aplicação.
//   - approved_amount, approved_term_months e approved_rate_monthly são dados
//     financeiros, não PII direta, mas requerem RBAC de leitura.
//   - internal_score gated por feature flag credit_analysis.internal_score.enabled;
//     jamais deve aparecer em respostas para o cliente/lead.
//   - Retenção: 5 anos após encerramento do relacionamento (Art. 20 §1º LGPD).
//     Job de purga implementado em F1-S25.
//
// Índices:
//   - uq_credit_analyses_org_lead_active: 1 análise ativa por lead/org
//     (where status != 'cancelado') — evita duplicidades silenciosas.
//   - idx_credit_analyses_org_status: filtros de board (listagem por status).
//   - idx_credit_analyses_lead: histórico por lead com ordem cronológica.
//   - idx_credit_analyses_analyst: carga de trabalho por analista.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { creditSimulations } from './creditSimulations.js';
import { customers } from './customers.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Forward-reference: credit_analysis_versions cria dependência circular porque
// credit_analyses.current_version_id → credit_analysis_versions.id e
// credit_analysis_versions.analysis_id → credit_analyses.id.
//
// Solução: a FK física de current_version_id é adicionada via ALTER TABLE
// na migration 0032, APÓS credit_analysis_versions ser criada. No schema
// Drizzle declaramos a coluna aqui sem foreignKey() — a constraint existe
// no banco mas o Drizzle não gera conflito de migração porque já está aplicada.
//
// Se você rodar `db:generate` novamente, o Drizzle pode tentar adicionar a FK.
// Nesses casos, inspecione o SQL gerado e descarte a FK duplicada.
// ---------------------------------------------------------------------------

export const creditAnalyses = pgTable(
  'credit_analyses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado para city-scope sem JOIN. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead que originou a análise.
     * ON DELETE RESTRICT: não permite deletar lead com análises associadas.
     * Análises de crédito devem ser preservadas por 5 anos (Art. 20 §1º LGPD).
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Cliente identificado (CPF obtido) associado à análise.
     * null = análise iniciada antes da identificação formal.
     * ON DELETE RESTRICT: não permite deletar customer com análises associadas.
     * Preservar histórico de crédito é obrigação legal.
     */
    customerId: uuid('customer_id'),

    /**
     * Simulação que originou esta análise (rastreabilidade completa).
     * null = análise iniciada sem simulação prévia (ex: importação).
     * ON DELETE SET NULL: simulação deletada não invalida a análise.
     */
    simulationId: uuid('simulation_id'),

    /**
     * Versão (parecer) atualmente vigente desta análise.
     * null = análise recém-criada, ainda sem parecer.
     * Atualizado atomicamente na mesma transação que insere nova versão.
     *
     * FK física adicionada via ALTER TABLE após credit_analysis_versions ser criada
     * (ver migration 0032 — dependência circular resolvida em duas etapas).
     * ON DELETE SET NULL: versão deletada (edge case) não destrói a análise.
     */
    currentVersionId: uuid('current_version_id'),

    /**
     * Status agregado atual da análise.
     * Espelha o status da current_version ativa para queries diretas sem JOIN.
     * Valores:
     *   em_analise — análise em curso
     *   pendente   — aguardando documentos ou informações do lead
     *   aprovado   — crédito aprovado (approved_amount preenchido)
     *   recusado   — crédito recusado (motivo em credit_analysis_versions.parecer_text)
     *   cancelado  — análise cancelada (excluída do unique ativo por lead/org)
     */
    status: text('status', {
      enum: ['em_analise', 'pendente', 'aprovado', 'recusado', 'cancelado'],
    }).notNull(),

    /**
     * Valor aprovado em reais (ex: 3500.00).
     * null quando status != 'aprovado'.
     * Preenchido no momento do parecer de aprovação e nunca alterado após.
     */
    approvedAmount: numeric('approved_amount', { precision: 14, scale: 2 }),

    /**
     * Prazo aprovado em meses (ex: 12).
     * null quando status != 'aprovado'.
     */
    approvedTermMonths: integer('approved_term_months'),

    /**
     * Taxa mensal aprovada como decimal (ex: 0.025 = 2,5% ao mês).
     * null quando status != 'aprovado'.
     * AVISO: armazenar como decimal, não como percentual.
     */
    approvedRateMonthly: numeric('approved_rate_monthly', { precision: 8, scale: 6 }),

    /**
     * Score interno de risco calculado pelo sistema (0-100).
     * null = score não calculado ou feature flag desativada.
     * RESTRITO: gated por feature flag `credit_analysis.internal_score.enabled`.
     * NUNCA expor para o cliente/lead — apenas para analistas com permissão.
     */
    internalScore: numeric('internal_score', { precision: 6, scale: 2 }),

    /**
     * Analista humano responsável pela análise.
     * null = não atribuído ainda (ex: recém-importado).
     * ON DELETE SET NULL: usuário deletado não invalida a análise histórica.
     */
    analystUserId: uuid('analyst_user_id'),

    /**
     * Canal de origem da análise.
     * 'manual' = criado por analista via UI.
     * 'import' = importado via planilha (F4-S06).
     * Sem 'ai': IA NUNCA toma decisão de crédito — apenas auxilia o analista.
     * Esta restrição é requisito de conformidade (Art. 20 LGPD).
     */
    origin: text('origin', { enum: ['manual', 'import'] })
      .notNull()
      .default('manual'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Atualizado automaticamente via trigger set_updated_at.
     * Reflete a última mutação em qualquer campo desta linha.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (todas nomeadas, com on delete explícito)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_credit_analyses_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkLead: foreignKey({
      name: 'fk_credit_analyses_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('restrict'),

    fkCustomer: foreignKey({
      name: 'fk_credit_analyses_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('restrict'),

    fkSimulation: foreignKey({
      name: 'fk_credit_analyses_simulation',
      columns: [table.simulationId],
      foreignColumns: [creditSimulations.id],
    }).onDelete('set null'),

    fkAnalyst: foreignKey({
      name: 'fk_credit_analyses_analyst',
      columns: [table.analystUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * 1 análise ativa por lead/org.
     * WHERE status != 'cancelado': análises canceladas não bloqueiam nova análise
     * para o mesmo lead (ex: reabertura após desistência).
     */
    uqOrgLeadActive: uniqueIndex('uq_credit_analyses_org_lead_active')
      .on(table.organizationId, table.leadId)
      .where(sql`${table.status} != 'cancelado'`),

    /**
     * Filtros de board: listagem de análises por status (fila de trabalho).
     */
    idxOrgStatus: index('idx_credit_analyses_org_status').on(table.organizationId, table.status),

    /**
     * Histórico de análises por lead em ordem cronológica inversa.
     * Uso: timeline do lead, detalhes do card Kanban.
     */
    idxLead: index('idx_credit_analyses_lead').on(table.leadId, table.createdAt),

    /**
     * Carga de trabalho por analista: "todas as análises atribuídas ao usuário X".
     */
    idxAnalyst: index('idx_credit_analyses_analyst').on(table.analystUserId),
  }),
);

export type CreditAnalysis = typeof creditAnalyses.$inferSelect;
export type NewCreditAnalysis = typeof creditAnalyses.$inferInsert;
