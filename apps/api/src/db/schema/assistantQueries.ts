// =============================================================================
// assistantQueries.ts — Log de auditoria de consultas ao copiloto interno (F6-S05).
//
// Contexto (docs/22-agente-interno-acoes.md §12.5):
//   Toda consulta ao copiloto interno é auditada aqui.
//   O "ator" do audit é o usuário (a leitura é dele), diferente da Superfície A
//   (ai_actions) onde o ator é 'ai'.
//
// LGPD (doc 17 §14.2 + §12.5 doc 22):
//   question_redacted: pergunta com DLP aplicado — NUNCA CPF, telefone, nome
//     completo ou email do cidadão em forma bruta. O serviço LangGraph DEVE
//     aplicar dlp_filter() antes de chamar a rota de persistência.
//   answer_summary: resumo da resposta gerada pelo copiloto; sem PII bruta.
//   tools_called: ferramentas invocadas com parâmetros não-PII (IDs e agregados).
//   city_scope_snapshot: snapshot de IDs de cidades (não são PII — entidades de
//     referência geográfica). Auditoria histórica de escopo.
//   Retenção: sujeita à política de retenção de logs do doc 17 §9.
//
// Multi-tenant:
//   organization_id NOT NULL em toda tabela de domínio (§8 CLAUDE.md).
//
// Índices:
//   (organization_id, user_id, created_at): query principal de auditoria.
//   "Todas as consultas do usuário X na org Y, ordenadas por data."
// =============================================================================
import { sql } from 'drizzle-orm';
import { foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const assistantQueries = pgTable(
  'assistant_queries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Multi-tenant root. Toda consulta pertence a uma organização.
     * NOT NULL: garante isolamento multi-tenant desde o dia 1 (§8 CLAUDE.md).
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Usuário que realizou a consulta.
     * Nullable: reservado para consultas de sistema futuras (hoje sempre preenchido).
     * FK ON DELETE SET NULL: preserva o log de auditoria mesmo se o usuário for
     * removido — o registro histórico segue válido sem o ator humano.
     */
    userId: uuid('user_id'),

    /**
     * Pergunta realizada ao copiloto APÓS passagem pelo DLP.
     * NUNCA armazena PII bruta (CPF, telefone, nome, email do cidadão).
     * O serviço LangGraph aplica dlp_filter() antes de chamar a rota de persistência.
     * Exemplo pós-DLP: "Quantos leads entraram hoje em Ariquemes?"
     * LGPD (doc 17 §14.2): substituir identificadores pessoais por tokens antes de persistir.
     */
    questionRedacted: text('question_redacted').notNull(),

    /**
     * Resumo textual da resposta gerada pelo copiloto.
     * Nullable: ausente quando a consulta retornou erro ou foi interrompida antes
     * da geração da resposta (ex: timeout, feature flag desabilitada mid-request).
     * Sem PII bruta — mesma política de question_redacted.
     */
    answerSummary: text('answer_summary'),

    /**
     * Lista de ferramentas invocadas durante o processamento da consulta.
     * Formato jsonb: [{name: "leads_count", args: {city_ids: [...]}, result_summary: "42"}].
     * Permite rastrear quais endpoints de dados foram acessados (auditabilidade).
     * Sem PII bruta nos args: apenas IDs de entidades e valores agregados.
     * Nullable: ausente quando o copiloto respondeu sem invocar tools (ex: pergunta fora
     * de escopo, resposta direta sem acesso a dados).
     */
    toolsCalled: jsonb('tools_called'),

    /**
     * Snapshot do escopo de cidade do usuário no momento da consulta.
     * Registra quais cidades o usuário podia ver quando a pergunta foi feita —
     * imutável após criação para auditoria histórica de escopo.
     * Formato: {city_ids: ["<uuid>", ...], scope_type: "city" | "global"}.
     * IDs de cidades não são PII (entidades de referência geográfica).
     * Nullable: ausente em consultas que não requerem filtro de cidade.
     */
    cityScopeSnapshot: jsonb('city_scope_snapshot'),

    /**
     * Timestamp de criação da consulta.
     * Usado no índice composto para queries de auditoria por período.
     * Sem updated_at: o registro é imutável após criação (append-only).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente — docs/CLAUDE.md princípios)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_assistant_queries_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkUser: foreignKey({
      name: 'fk_assistant_queries_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Índice composto B-tree para consultas de auditoria e histórico do usuário.
     * Cobre os padrões de acesso:
     *   1. "Consultas do usuário X na org Y" (organization_id + user_id + created_at).
     *   2. "Todas as consultas da org Y nos últimos N dias" (organization_id + created_at).
     * org_id na frente garante isolamento multi-tenant nas varreduras.
     */
    idxOrgUserCreatedAt: index('idx_assistant_queries_org_user_created_at').on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
  }),
);

export type AssistantQuery = typeof assistantQueries.$inferSelect;
export type NewAssistantQuery = typeof assistantQueries.$inferInsert;
