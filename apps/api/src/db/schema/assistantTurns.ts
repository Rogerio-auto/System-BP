// =============================================================================
// assistantTurns.ts — Turnos (pergunta+resposta) do histórico do copiloto interno
// (F6-S24).
//
// Contexto (docs/anexos/lgpd/dpia-historico-copiloto.md, "nível A — referência +
// hidratação viva"): cada linha é UM turno de uma assistant_conversations.
// O invariante central do desenho (DPIA §1.1, tabela): persiste apenas a
// pergunta HIGIENIZADA, a narrativa (sem PII) e, dos blocos de dado de
// cliente da resposta, SÓ a referência de entidade (`{ type, ref }`) — o
// `value` hidratado (nome, CPF, telefone, cidade, valores do lead) é
// EFÊMERO e é DESCARTADO antes de qualquer INSERT nesta tabela. O dado
// sensível é re-buscado ao vivo na leitura (F6-S27), com RBAC + escopo de
// cidade do momento.
//
// Contrato de `Block` em memória (apps/api/src/modules/internal-assistant/
// schemas.ts, F6-S21, acordado com o LangGraph F6-S20):
//   { type: string, ref: { kind: 'lead' | 'none', lead_id: uuid | null }, value: unknown }
// O que é PERSISTIDO aqui é só `{ type, ref }` — `value` nunca chega ao banco.
// A responsabilidade de descartar `value` antes do INSERT é do service layer
// (F6-S25), mas o invariante é defendido também em profundidade nesta tabela
// via CHECK (ver abaixo) — se o service layer um dia tiver um bug e esquecer
// de descartar `value`, o INSERT falha em vez de vazar PII em repouso.
//
// Fase (dark até o parecer do DPO — F6-S23):
//   Este slot só cria o schema. A flag `assistant.history.enabled` (F6-S25)
//   mantém a escrita como no-op enquanto desligada.
//
// LGPD (DPIA §4):
//   - question_sanitized: pergunta do usuário após DLP de CPF/telefone E
//     mascaramento de nome (DPIA §4.3 — vai além do DLP padrão do gateway,
//     que só cobre identificadores estruturados).
//   - narrative: comentário/estrutura da resposta, sem PII de cliente
//     (ex.: "lead em pré-qualificação, aguardando análise").
//   - blocks: só `{ type, ref }` por elemento — CHECK garante ausência da
//     chave `value` em qualquer elemento do array.
//   - sources: rótulos das fontes de dado consultadas (ex.: nomes de tools),
//     não são PII — mesma natureza de `tools_called` em assistant_queries.
//
// Sem organization_id nesta tabela: escopo transitivo via
// conversation_id → assistant_conversations.organization_id (mesmo padrão de
// messages.ts, leadHistory.ts — tabelas-filho não duplicam a raiz multi-tenant).
//
// Sem updated_at: turno é imutável após criação (append-only), mesmo padrão
// de assistant_queries.ts e credit_analysis_versions.ts.
//
// Índices:
//   (conversation_id, created_at): turnos de uma conversa em ordem
//   cronológica — query de abertura da conversa na sidebar.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { assistantConversations } from './assistantConversations.js';

export const assistantTurns = pgTable(
  'assistant_turns',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Conversa a que este turno pertence.
     * ON DELETE CASCADE: turnos não têm sentido sem a conversa-mãe — soft
     * delete da conversa não exige soft delete do turno (a conversa some da
     * sidebar inteira); hard delete (purga por retenção) leva os turnos junto.
     */
    conversationId: uuid('conversation_id').notNull(),

    /**
     * Pergunta do usuário APÓS higienização: DLP de CPF/telefone + nome
     * mascarado (DPIA §4.3, risco R3). NUNCA a pergunta bruta.
     * Higienização é responsabilidade do service layer (F6-S25); esta coluna
     * documenta a restrição, não a impõe via CHECK (não há padrão estável o
     * bastante para validar "nome mascarado" em regex no banco).
     */
    questionSanitized: text('question_sanitized').notNull(),

    /**
     * Comentário/estrutura da resposta do copiloto, SEM PII de cliente.
     * Mesmo campo `narrative` do contrato F6-S20/F6-S21, repassado como veio
     * do LangGraph (a DLP do agente já garante ausência de PII aqui).
     */
    narrative: text('narrative').notNull(),

    /**
     * Blocos de dado de cliente da resposta, SÓ como referência de entidade.
     * Formato por elemento: { type: string, ref: { kind: 'lead' | 'none',
     * lead_id: uuid | null } } — nunca `value` (dado hidratado, efêmero).
     * CHECK chk_assistant_turns_blocks_no_value (abaixo) é a defesa em
     * profundidade: rejeita o INSERT/UPDATE se qualquer elemento do array
     * tiver a chave `value`.
     */
    blocks: jsonb('blocks')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * Fontes de dado consultadas para montar a resposta (rótulos, não PII).
     * Formato: string[] — mesmo campo `sources` do contrato F6-S21.
     */
    sources: jsonb('sources')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Sem updated_at — turno é imutável após criação (append-only). */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeada explicitamente, on delete explícito)
    // -------------------------------------------------------------------------

    fkConversation: foreignKey({
      name: 'fk_assistant_turns_conversation',
      columns: [table.conversationId],
      foreignColumns: [assistantConversations.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Turnos de uma conversa em ordem cronológica — query de abertura da
     * conversa reaberta pela sidebar.
     */
    idxConversationCreatedAt: index('idx_assistant_turns_conversation_created_at').on(
      table.conversationId,
      table.createdAt,
    ),

    // -------------------------------------------------------------------------
    // Constraints de invariante LGPD (defesa em profundidade)
    // -------------------------------------------------------------------------

    /**
     * Garante, no banco, que NENHUM elemento de `blocks` tem a chave `value`
     * (o dado hidratado, efêmero, nunca persistido — DPIA §1.1). A função
     * assistant_turns_blocks_no_value(jsonb) é criada na migration (SQL puro,
     * fora do alcance do Drizzle) e valida: (a) `blocks` é um array jsonb;
     * (b) nenhum elemento do array contém a chave `value`.
     * Se o service layer (F6-S25) um dia esquecer de descartar `value` antes
     * do INSERT, esta constraint rejeita a escrita em vez de vazar PII em
     * repouso — é o invariante central do DPIA aplicado como fato do banco,
     * não só como convenção de código.
     */
    chkBlocksNoValue: check(
      'chk_assistant_turns_blocks_no_value',
      sql`assistant_turns_blocks_no_value(${table.blocks})`,
    ),
  }),
);

export type AssistantTurn = typeof assistantTurns.$inferSelect;
export type NewAssistantTurn = typeof assistantTurns.$inferInsert;
