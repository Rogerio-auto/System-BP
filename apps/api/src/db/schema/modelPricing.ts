// =============================================================================
// modelPricing.ts — Preços por modelo LLM em USD para custeio de decisões IA.
//
// Contexto (F9-S00):
//   Cada nó do agente LangGraph grava tokens_in/tokens_out em ai_decision_logs.
//   Esta tabela fornece o custo unitário (USD/1M tokens) para converter tokens
//   em valor monetário — exibido no Console de decisões (F9-S06).
//
// Modelo de vigência (effective_from / effective_to):
//   - effective_to IS NULL = preço atualmente em vigor.
//   - Para trocar o preço: fechar registro antigo (effective_to = now())
//     e inserir novo com effective_from = now().
//   - Unique partial index uq_model_pricing_active garante 1 ativo por
//     (provider, model_id) em qualquer instante.
//
// Conversão BRL:
//   NÃO persistir BRL aqui. A taxa FX_BRL_PER_USD vem do env no momento
//   do cálculo (helper pricing.ts). Preço em USD é a verdade canônica.
//
// Sem PII:
//   Tabela operacional pura — sem dados pessoais. LGPD não se aplica.
//
// Índices:
//   - uq_model_pricing_active (unique partial): 1 ativo por (provider, model_id).
//   - idx_model_pricing_model_id: busca rápida do preço ativo por model_id.
//   - idx_model_pricing_provider_from: histórico de preços por provider.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const modelPricing = pgTable(
  'model_pricing',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Provider do modelo LLM.
     * Exemplos: 'openrouter', 'anthropic', 'openai'.
     * Deve corresponder ao roteamento em langgraph-service/app/llm/factory.py.
     */
    provider: text('provider').notNull(),

    /**
     * Identificador canônico do modelo no formato provider/model.
     * Deve corresponder EXATAMENTE a ai_decision_logs.model para JOIN correto.
     * Exemplos: 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini',
     *           'anthropic/claude-sonnet-4'.
     */
    modelId: text('model_id').notNull(),

    /**
     * Custo de tokens de INPUT por 1.000.000 tokens em USD.
     * Fonte: pricing page do provider (snapshots em notes).
     * numeric(12,4): máx USD 99.999.999,9999 — suficiente para qualquer modelo.
     * CHECK: >= 0 (modelos gratuitos entram como 0).
     */
    inputCostPerMillionUsd: numeric('input_cost_per_million_usd', {
      precision: 12,
      scale: 4,
    }).notNull(),

    /**
     * Custo de tokens de OUTPUT por 1.000.000 tokens em USD.
     * Output geralmente custa 3–5x mais que input.
     * CHECK: >= 0.
     */
    outputCostPerMillionUsd: numeric('output_cost_per_million_usd', {
      precision: 12,
      scale: 4,
    }).notNull(),

    /**
     * Início da vigência deste preço. DEFAULT now().
     * Permite pré-agendar troca de preço com effective_from no futuro.
     */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Fim da vigência. NULL = preço em vigor.
     * Para encerrar: UPDATE effective_to = now().
     * CHECK: effective_to IS NULL OR effective_to > effective_from.
     */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),

    /**
     * Changelog: fonte do preço, data do snapshot, motivo da alteração.
     * Exemplos: 'snapshot OpenRouter pricing page 2026-05-19',
     *           'revisão anual — aumento 10%'.
     */
    notes: text('notes'),

    /**
     * Usuário que cadastrou ou alterou o preço.
     * ON DELETE SET NULL: usuário deletado não perde o histórico de preços.
     */
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkCreatedBy: foreignKey({
      name: 'fk_model_pricing_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Unique partial: garante 1 preço ativo por (provider, model_id).
     * WHERE effective_to IS NULL exclui registros históricos (fechados),
     * permitindo múltiplos registros fechados para o mesmo modelo.
     */
    uqActive: uniqueIndex('uq_model_pricing_active')
      .on(table.provider, table.modelId)
      .where(sql`${table.effectiveTo} IS NULL`),

    /**
     * Busca do preço ativo por model_id (query canônica do pricing.ts).
     * Ex: "qual é o preço ativo de 'anthropic/claude-3.5-haiku'?"
     */
    idxModelId: index('idx_model_pricing_model_id').on(table.modelId),

    /**
     * Histórico de preços de um provider em ordem cronológica decrescente.
     * Usado pela view de admin para auditoria de mudanças de preço.
     */
    idxProviderFrom: index('idx_model_pricing_provider_from').on(
      table.provider,
      table.effectiveFrom,
    ),
  }),
);

export type ModelPricing = typeof modelPricing.$inferSelect;
export type NewModelPricing = typeof modelPricing.$inferInsert;
