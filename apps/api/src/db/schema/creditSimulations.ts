// =============================================================================
// creditSimulations.ts — Resultado imutável de cada simulação de crédito.
//
// Uma simulação é um snapshot imutável calculado a partir de:
//   - product_id + rule_version_id: produto e versão da regra usada.
//   - amount_requested + term_months: parâmetros de entrada do cliente.
//
// Imutabilidade total:
//   - Após criação, NENHUM campo deve ser alterado.
//   - A tabela não tem updated_at — intencionalmente.
//   - Para corrigir, cria-se nova simulação (lead.last_simulation_id aponta pra ela).
//
// Auditoria: rule_version_id é FK imutável para credit_product_rules.
//   Permite recalcular a simulação qualquer tempo depois, dado que as regras
//   históricas nunca são deletadas (on delete restrict).
//
// LGPD: esta tabela não contém PII diretamente.
//   - lead_id → leads (que tem PII) — redact obrigatório antes de logar contexto.
//   - amortization_table (jsonb) contém apenas dados financeiros, não PII.
//
// Multi-tenant: organization_id denormalizado para city-scope direto.
//
// Índices:
//   - (lead_id): histórico de simulações por lead.
//   - (organization_id, product_id): simulações por produto (analytics).
//   - (customer_id) parcial: simulações de clientes identificados.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { creditProductRules } from './creditProductRules.js';
import { creditProducts } from './creditProducts.js';
import { customers } from './customers.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const creditSimulations = pgTable(
  'credit_simulations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado para city-scope sem JOIN. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead que originou esta simulação.
     * ON DELETE RESTRICT: não permite deletar lead com simulações associadas.
     * Preservar simulações para histórico e auditoria de crédito.
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Cliente identificado (CPF obtido) associado à simulação.
     * null = simulação antes de identificação formal do cliente.
     * ON DELETE SET NULL: customer deletado não destrói o histórico.
     */
    customerId: uuid('customer_id'),

    /**
     * Produto de crédito simulado.
     * ON DELETE RESTRICT: produto não pode ser deletado enquanto tiver simulações.
     */
    productId: uuid('product_id').notNull(),

    /**
     * Versão da regra usada no cálculo. Imutável após criação.
     * Permite auditoria completa: dados calculados + regras usadas.
     * ON DELETE RESTRICT: regras históricas nunca são deletadas.
     */
    ruleVersionId: uuid('rule_version_id').notNull(),

    /**
     * Valor solicitado pelo cliente em reais (ex: 2000.00).
     * Deve estar entre rule.min_amount e rule.max_amount.
     */
    amountRequested: numeric('amount_requested', { precision: 14, scale: 2 }).notNull(),

    /**
     * Prazo solicitado em meses (ex: 12).
     * Deve estar entre rule.min_term_months e rule.max_term_months.
     */
    termMonths: integer('term_months').notNull(),

    /**
     * Valor da parcela mensal calculada (ex: 187.53).
     * Price: parcelas iguais. SAC: parcela decrescente (armazenada a primeira).
     */
    monthlyPayment: numeric('monthly_payment', { precision: 14, scale: 2 }).notNull(),

    /**
     * Valor total a pagar (principal + juros + IOF), em reais.
     * total_amount = monthly_payment * term_months (Price) ou somatório (SAC).
     */
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),

    /**
     * Total de juros pagos (total_amount - amount_requested).
     * Facilita exibição de "custo total do crédito" sem recalcular.
     */
    totalInterest: numeric('total_interest', { precision: 14, scale: 2 }).notNull(),

    /**
     * Snapshot da taxa mensal usada no cálculo (ex: 0.025).
     * Redundante com rule_version_id, mas preserva o valor sem precisar
     * fazer JOIN em credit_product_rules para exibir ao cliente.
     */
    rateMonthlySnapshot: numeric('rate_monthly_snapshot', { precision: 8, scale: 6 }).notNull(),

    /**
     * Tabela de amortização completa em JSON.
     * Cada elemento: { parcela, saldo_devedor, amortizacao, juros, prestacao }.
     * Price: todas as prestações iguais.
     * SAC: amortização constante, juros decrescentes.
     * Armazenado para exibição ao cliente sem recalcular.
     */
    amortizationTable: jsonb('amortization_table')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * Canal de origem da simulação.
     * 'manual'  = criado por agente via UI.
     * 'ai'      = gerado pelo agente IA (LangGraph).
     * 'import'  = importado via planilha.
     */
    origin: text('origin', { enum: ['manual', 'ai', 'import'] })
      .notNull()
      .default('manual'),

    /**
     * Usuário que criou a simulação manualmente.
     * null = criado por IA ou importação.
     * ON DELETE SET NULL: usuário deletado não invalida histórico.
     */
    createdByUserId: uuid('created_by_user_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Sem updatedAt — simulações são imutáveis após criação.
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys (todas nomeadas, com on delete explícito)
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_credit_simulations_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_credit_simulations_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_credit_simulations_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('set null'),

    foreignKey({
      name: 'fk_credit_simulations_product',
      columns: [table.productId],
      foreignColumns: [creditProducts.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_credit_simulations_rule_version',
      columns: [table.ruleVersionId],
      foreignColumns: [creditProductRules.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_credit_simulations_created_by',
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Histórico de simulações por lead (mais comum: "todas as simul. do lead X").
     */
    index('idx_credit_simulations_lead').on(table.leadId),

    /**
     * Analytics por produto: "quantas simulações do produto X na org Y".
     */
    index('idx_credit_simulations_org_product').on(table.organizationId, table.productId),

    /**
     * Simulações de clientes identificados (customer já tem CPF).
     * Parcial: exclui simulações sem customer (maioria no início do funil).
     */
    index('idx_credit_simulations_customer')
      .on(table.customerId)
      .where(sql`${table.customerId} IS NOT NULL`),
  ],
);

export type CreditSimulation = typeof creditSimulations.$inferSelect;
export type NewCreditSimulation = typeof creditSimulations.$inferInsert;
