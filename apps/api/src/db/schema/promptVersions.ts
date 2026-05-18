// =============================================================================
// promptVersions.ts — Catálogo de versões de prompts do agente LangGraph.
//
// Cada prompt tem uma chave canônica (key) e um número de versão inteiro.
// A combinação (key, version) é imutável após publicação — NUNCA altere
// um prompt publicado. Para mudar: incremente a versão.
//
// Regras de negócio:
//   - UNIQUE (key, version): garante unicidade por prompt + versão.
//   - Apenas 1 versão pode estar ativa por chave (active = true).
//     Aplicação responsável por desativar versão anterior antes de ativar nova.
//     Índice parcial em (key) WHERE active garante consulta eficiente.
//   - Imutabilidade: após published_at != null, o conteúdo não deve mudar.
//     A coluna content_hash (SHA-256 do body do prompt) serve como checksum
//     e permite detectar alterações acidentais.
//   - model_recommended: modelo LLM recomendado para este prompt específico.
//     Pode diferir do modelo padrão (ex: prompt complexo requer Claude Sonnet).
//
// Colunas-chave:
//   - key:              chave canônica sem espaços (ex: "intent_classifier").
//   - version:          inteiro positivo, começa em 1, incrementa a cada mudança.
//   - model_recommended: identificador do modelo sugerido (ex: "anthropic/claude-3-5-sonnet").
//   - content_hash:     SHA-256 do conteúdo do prompt. Serve de checksum de integridade.
//   - active:           true = versão em uso pelos agentes. Apenas 1 por key.
//   - body:             conteúdo completo do prompt em texto. Pode usar templates
//                       com placeholders (ex: {lead_name}, {city_name}).
//   - notes:            changelog/motivação da versão (para auditoria interna).
//   - created_by:       usuário que publicou esta versão.
//
// LGPD: não há PII nesta tabela.
//   - body pode conter exemplos de mensagens, mas não dados reais de clientes.
//   - created_by é FK para users (dado interno, não PII de cliente).
//
// Índices:
//   - UNIQUE (key, version): constraint principal.
//   - Parcial (key) WHERE active: "qual versão ativa do prompt X?" — query frequente.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Chave canônica do prompt, sem espaços.
     * Convenção snake_case, ex: "intent_classifier", "city_extractor", "response_generator".
     * Imutável após criação — nunca renomear uma key existente.
     * Logs em ai_decision_logs.prompt_key referenciam este valor.
     */
    key: text('key').notNull(),

    /**
     * Versão inteira, começa em 1. Incrementa a cada mudança de conteúdo.
     * Junto com `key`, forma o identificador canônico: "intent_classifier@v3".
     */
    version: integer('version').notNull(),

    /**
     * Modelo LLM recomendado para este prompt.
     * Permite que prompts complexos usem modelos mais capazes sem afetar os demais.
     * Exemplo: "anthropic/claude-3-5-sonnet", "openai/gpt-4o-mini".
     * null = usar modelo padrão da configuração do serviço.
     */
    modelRecommended: text('model_recommended'),

    /**
     * SHA-256 do conteúdo do prompt (campo `body`).
     * Gerado e verificado pela aplicação ao carregar o prompt.
     * Detecta alterações acidentais no banco (integridade do prompt versionado).
     */
    contentHash: text('content_hash').notNull(),

    /**
     * Indica se esta versão é a atualmente ativa para esta chave.
     * Somente 1 registro por `key` deve ter active = true.
     * Aplicação deve desativar a versão anterior em transação antes de ativar nova.
     * Índice parcial WHERE active torna a busca da versão ativa O(log n).
     */
    active: boolean('active').notNull().default(false),

    /**
     * Conteúdo completo do prompt em texto.
     * Pode conter templates com placeholders: {lead_name}, {city_name}, {product_list}.
     * Imutável após publicação (published_at != null).
     * NUNCA incluir dados reais de clientes — apenas estrutura e exemplos sintéticos.
     */
    body: text('body').notNull(),

    /**
     * Notas de changelog desta versão.
     * Explica o que mudou em relação à versão anterior e a motivação.
     * Exemplo: "v3: adicionada instrução de fallback para cidades desconhecidas".
     * null = sem notas (não recomendado para versões publicadas).
     */
    notes: text('notes'),

    /**
     * Usuário interno que criou/publicou esta versão.
     * ON DELETE SET NULL: usuário deletado não invalida o histórico de prompts.
     * LGPD: é dado de usuário interno (não é PII de cliente).
     */
    createdBy: uuid('created_by'),

    /**
     * Timestamp de criação do registro.
     * Para prompts versionados, equivale à data de publicação.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Sem updatedAt — prompt_versions é imutável após criação.
    // Para alterar: criar nova versão com version + 1.
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkCreatedBy: foreignKey({
      name: 'fk_prompt_versions_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Unique Constraints
    // -------------------------------------------------------------------------

    /**
     * Um prompt + versão específica é imutável e único no sistema.
     * Regra de negócio: não existe "intent_classifier@v2" dois vezes.
     */
    uqKeyVersion: uniqueIndex('uq_prompt_versions_key_version').on(table.key, table.version),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Busca eficiente da versão ativa de um prompt.
     * Query canônica: "qual é a versão ativa do prompt 'intent_classifier'?"
     * Parcial: somente registros ativos — mantém índice extremamente enxuto.
     * O agente faz esta query em cada invocação — deve ser O(log n).
     */
    idxActiveByKey: index('idx_prompt_versions_active_key')
      .on(table.key)
      .where(sql`${table.active} = true`),
  }),
);

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
