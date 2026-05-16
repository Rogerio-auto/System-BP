// =============================================================================
// creditProductRules.ts — Regras versionadas de um produto de crédito.
//
// Decisão de design:
//   - Cada "versão" de um produto é uma linha imutável de regras.
//   - Quando as condições mudam (taxa, prazo, limite), publica-se uma nova versão
//     com is_active=true e a anterior vira is_active=false.
//   - Simulações capuram a versão usada (rule_version_id imutável) para auditoria.
//   - city_scope permite restringir uma regra a um subconjunto de cidades.
//
// Constraint única: (product_id, version) — versão única por produto.
// Restrição lógica: apenas uma regra is_active=true por produto + cidade vigente
//   (validada na service layer — não via constraint SQL, pois city_scope é array).
//
// Imutabilidade:
//   - Após criação, campos numéricos NÃO devem ser alterados (auditoria de crédito).
//   - Para corrigir erro: criar nova versão (version+1) e desativar a anterior.
//   - is_active e effective_to podem ser atualizados para encerrar uma regra.
//
// Multi-tenant: organization_id denormalizado do product para filtros diretos.
//
// Índices:
//   - (product_id, is_active): regra ativa por produto.
//   - (product_id, version): cobertura da unique constraint.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { creditProducts } from './creditProducts.js';
import { users } from './users.js';

export const creditProductRules = pgTable(
  'credit_product_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Produto ao qual esta regra pertence.
     * ON DELETE RESTRICT: produto não pode ser deletado com regras.
     */
    productId: uuid('product_id').notNull(),

    /**
     * Versão sequencial desta regra (1, 2, 3...).
     * Incrementada pela service layer ao publicar nova regra.
     * Unique por produto: unique (product_id, version).
     */
    version: integer('version').notNull(),

    /**
     * Valor mínimo do empréstimo em reais (ex: 500.00).
     * Simulações com amount_requested < min_amount são rejeitadas.
     */
    minAmount: numeric('min_amount', { precision: 14, scale: 2 }).notNull(),

    /**
     * Valor máximo do empréstimo em reais (ex: 5000.00).
     * Simulações com amount_requested > max_amount são rejeitadas.
     */
    maxAmount: numeric('max_amount', { precision: 14, scale: 2 }).notNull(),

    /**
     * Prazo mínimo em meses (ex: 3).
     */
    minTermMonths: integer('min_term_months').notNull(),

    /**
     * Prazo máximo em meses (ex: 24).
     */
    maxTermMonths: integer('max_term_months').notNull(),

    /**
     * Taxa mensal como decimal (ex: 0.025 = 2,5% ao mês).
     * Precision 8, scale 6 comporta: 0.000001 até 99.999999.
     * AVISO: nunca armazenar em percentual (não 2.5, mas 0.025).
     */
    monthlyRate: numeric('monthly_rate', { precision: 8, scale: 6 }).notNull(),

    /**
     * IOF diário como decimal (ex: 0.000082 = 0,0082% ao dia).
     * null = produto isento de IOF (microcrédito pode ser isento por lei).
     */
    iofRate: numeric('iof_rate', { precision: 8, scale: 6 }),

    /**
     * Sistema de amortização aplicado pelo simulador.
     * 'price' = parcelas iguais (Price/Francês) — padrão.
     * 'sac'   = amortização constante (SAC/Alemão).
     */
    amortization: text('amortization', { enum: ['price', 'sac'] })
      .notNull()
      .default('price'),

    /**
     * Array de city_id restringindo a aplicação desta regra.
     * null = regra válida para todas as cidades da organização.
     * Não-null = apenas cidades listadas podem usar esta regra.
     * Tipo: uuid[] no Postgres. Drizzle usa sql`` para arrays de UUID.
     */
    cityScope: text('city_scope').array(),

    /**
     * Data de início de vigência desta regra.
     * Simulações só usam regras com effective_from <= now().
     */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Data de fim de vigência desta regra.
     * null = vigente indefinidamente (até ser substituída por nova versão).
     * Definido ao desativar uma regra.
     */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),

    /**
     * Indica se esta versão de regra está em vigor para novas simulações.
     * false = versão histórica (usada por simulações antigas, mas não novas).
     * Regra: apenas 1 versão deve ser is_active=true por produto+cidade vigente.
     * Validado pela service layer (creditProductRulesService.publish).
     */
    isActive: boolean('is_active').notNull().default(true),

    /**
     * Usuário responsável por publicar esta versão de regra.
     * null = criado por seed/automação.
     * ON DELETE SET NULL: usuário deletado não invalida a regra histórica.
     */
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Sem updatedAt: regras são imutáveis após criação (exceto is_active e effective_to).
    // Campos mutáveis: is_active, effective_to.
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkProduct: foreignKey({
      name: 'fk_credit_product_rules_product',
      columns: [table.productId],
      foreignColumns: [creditProducts.id],
    }).onDelete('restrict'),

    fkCreatedBy: foreignKey({
      name: 'fk_credit_product_rules_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Constraints
    // -------------------------------------------------------------------------

    /**
     * Versão única por produto.
     * Impede publicar duas vezes a mesma versão de um produto.
     */
    uqProductVersion: uniqueIndex('uq_credit_product_rules_product_version').on(
      table.productId,
      table.version,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Busca da regra ativa de um produto.
     * Suporta: "qual a versão ativa do produto X?".
     */
    idxProductActive: index('idx_credit_product_rules_product_active').on(
      table.productId,
      table.isActive,
    ),

    /**
     * Busca de regras por versão (para auditoria).
     */
    idxProductVersion: index('idx_credit_product_rules_product_version').on(
      table.productId,
      table.version,
    ),
  }),
);

export type CreditProductRule = typeof creditProductRules.$inferSelect;
export type NewCreditProductRule = typeof creditProductRules.$inferInsert;
