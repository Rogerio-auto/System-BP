// =============================================================================
// aiDecisionLogs.ts — Log append-only de cada decisão de nó do LangGraph.
//
// Cada turno de processamento do agente gera 1 ou mais registros aqui,
// um por nó executado. O nó final `log_decision` agrega e persiste.
//
// Imutabilidade:
//   - Tabela APPEND-ONLY. Não há updated_at.
//   - Nenhum registro deve ser alterado após inserção.
//   - Para corrigir um log errado: inserir novo registro com `error` explicativo.
//
// Colunas-chave:
//   - node_name:      nome do nó que tomou a decisão (ex: "classify_intent").
//   - intent:         intenção classificada naquele nó (ex: "quer_simular").
//   - prompt_key:     chave canônica do prompt usado (ex: "intent_classifier").
//   - prompt_version: versão do prompt (ex: "intent_classifier@v3").
//                     Permite rastrear qual prompt gerou qual decisão.
//   - model:          identificador do modelo LLM (ex: "claude-3-5-sonnet-20241022").
//   - tokens_in/out:  tokens consumidos. Essencial para controle de custo por org.
//   - latency_ms:     latência da chamada ao LLM (somente a chamada, não o nó todo).
//   - decision:       jsonb com o output estruturado do nó (ex: { next_node, intent }).
//                     NÃO incluir CPF, RG ou dados sensíveis brutos.
//   - error:          mensagem de erro se o nó falhou. null = sucesso.
//   - correlation_id: ID de correlação para rastrear todos os logs de um request
//                     específico (X-Correlation-Id do header).
//
// LGPD (doc 17 §8.4 + retenção §6.1):
//   - `decision` jsonb: NUNCA incluir CPF, RG, document_number, senhas.
//     Somente IDs internos, intenções e decisões de fluxo.
//   - Retenção: 12 meses (doc 03 §14). Após isso: agregar métricas e purgar.
//   - `created_at` é o único campo de tempo — permite job de retenção por range.
//
// Multi-tenant: organization_id denormalizado para filtragem direta.
//
// Índices:
//   - (conversation_id, created_at): timeline de decisões de uma conversa.
//   - (organization_id, created_at): analytics de custo e volume por org.
//   - (lead_id) parcial: decisões associadas a leads (para histórico no CRM).
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const aiDecisionLogs = pgTable(
  'ai_decision_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado para analytics e city-scope sem JOIN. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Conversa em que esta decisão foi tomada.
     * Referência direta (sem FK para ai_conversation_states) para desacoplar:
     * o log deve sobreviver mesmo após a conversa ser soft-deletada ou purgada.
     * conversation_id é o mesmo UUID usado em ai_conversation_states.
     */
    conversationId: uuid('conversation_id').notNull(),

    /**
     * Lead associado à conversa no momento da decisão.
     * null = lead ainda não identificado (fase inicial do fluxo).
     * ON DELETE SET NULL: lead deletado não destrói o audit trail.
     */
    leadId: uuid('lead_id'),

    /**
     * Cliente identificado no momento da decisão.
     * null = customer não existe ou ainda não estava vinculado.
     * ON DELETE SET NULL: customer deletado não destrói o audit trail.
     */
    customerId: uuid('customer_id'),

    /**
     * Nome do nó LangGraph que tomou esta decisão.
     * Exemplos: "classify_intent", "identify_city", "generate_simulation".
     * Chave para analytics de performance por nó.
     */
    nodeName: text('node_name').notNull(),

    /**
     * Intenção classificada neste nó (quando aplicável).
     * Exemplos: "quer_credito", "quer_simular", "falar_atendente".
     * null = nó não é de classificação de intenção.
     * Enum open (text) porque o catálogo de intenções evolui.
     */
    intent: text('intent'),

    /**
     * Chave canônica do prompt usado (sem versão).
     * Exemplo: "intent_classifier", "city_extractor".
     * null = nó não fez chamada LLM (tool ou roteamento puro).
     */
    promptKey: text('prompt_key'),

    /**
     * Versão do prompt usado, no formato "key@vN".
     * Exemplo: "intent_classifier@v3".
     * Corresponde a prompt_versions.key + prompt_versions.version.
     * null = nó não fez chamada LLM.
     */
    promptVersion: text('prompt_version'),

    /**
     * Identificador do modelo LLM utilizado.
     * Exemplo: "anthropic/claude-3-5-sonnet", "openai/gpt-4o".
     * Registrado via OpenRouter (doc 02 §LLM gateway).
     * null = nó não fez chamada LLM.
     */
    model: text('model'),

    /**
     * Tokens de entrada enviados ao LLM (prompt + contexto).
     * null = nó não fez chamada LLM.
     * Usado para cálculo de custo por organização.
     */
    tokensIn: integer('tokens_in'),

    /**
     * Tokens de saída gerados pelo LLM (completion).
     * null = nó não fez chamada LLM.
     */
    tokensOut: integer('tokens_out'),

    /**
     * Latência da chamada ao LLM em milissegundos.
     * Apenas o tempo da chamada HTTP — não inclui lógica do nó.
     * null = nó não fez chamada LLM.
     * Usado para monitoramento de SLA e alertas de degradação.
     */
    latencyMs: integer('latency_ms'),

    /**
     * Output estruturado da decisão do nó.
     * Exemplos:
     *   classify_intent: { intent: "quer_simular", next_node: "identify_city" }
     *   generate_simulation: { simulation_id: "uuid", amount: 2000 }
     *
     * LGPD CRÍTICO: NÃO incluir CPF, RG, document_number, nome completo bruto.
     * Usar apenas IDs internos e dados de fluxo. DLP aplicado antes de persistir
     * (doc 17 §8.4). Dados financeiros (valor, prazo) são permitidos.
     */
    decision: jsonb('decision')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Mensagem de erro se o nó falhou (timeout, exception, validação).
     * null = execução bem-sucedida.
     * Nunca incluir stack traces com dados de usuário.
     */
    error: text('error'),

    /**
     * ID de correlação do request que originou esta decisão.
     * Mesmo valor do header X-Correlation-Id.
     * Permite correlacionar todos os logs de um request específico no Pino.
     */
    correlationId: uuid('correlation_id').notNull(),

    /**
     * Timestamp de criação. Única dimensão de tempo (tabela append-only).
     * Usado pelo job de retenção: purgar registros com created_at < now() - interval '12 months'.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Sem updatedAt — tabela append-only. Imutável após inserção.
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, on delete pensado)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_ai_decision_logs_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkLead: foreignKey({
      name: 'fk_ai_decision_logs_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('set null'),

    fkCustomer: foreignKey({
      name: 'fk_ai_decision_logs_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Timeline de decisões de uma conversa específica.
     * Query canônica: "todos os logs da conversa X, em ordem cronológica".
     * Compound (conversation_id, created_at) evita sort extra.
     */
    idxConversationCreated: index('idx_ai_decision_logs_conversation_created').on(
      table.conversationId,
      table.createdAt,
    ),

    /**
     * Analytics de custo e volume por organização.
     * Query canônica: "total de tokens e decisões da org Y no mês M".
     */
    idxOrgCreated: index('idx_ai_decision_logs_org_created').on(
      table.organizationId,
      table.createdAt,
    ),

    /**
     * Histórico de decisões associadas a um lead específico.
     * Parcial: exclui decisões sem lead (fase pré-identificação — maioria no início).
     */
    idxLead: index('idx_ai_decision_logs_lead')
      .on(table.leadId)
      .where(sql`${table.leadId} IS NOT NULL`),
  }),
);

export type AiDecisionLog = typeof aiDecisionLogs.$inferSelect;
export type NewAiDecisionLog = typeof aiDecisionLogs.$inferInsert;
