// =============================================================================
// assistantConversations.ts — Histórico persistente do copiloto interno (F6-S24).
//
// Contexto (docs/anexos/lgpd/dpia-historico-copiloto.md, "nível A — referência +
// hidratação viva"): esta tabela é o "esqueleto" de uma conversa reaberta pela
// barra lateral, estilo ChatGPT/Claude. NENHUMA PII de cliente vive aqui — só
// metadados de posse e um título derivado da INTENÇÃO do pedido, nunca do nome
// de um titular (lead/cliente).
//
// Fase (dark até o parecer do DPO — F6-S23):
//   Este slot (F6-S24) só cria o schema. A flag `assistant.history.enabled`
//   (F6-S25) mantém a escrita como no-op enquanto desligada — tabela vazia não
//   trata dado pessoal. Ligar a flag em produção exige o parecer do DPO oficial
//   registrado no DPIA §6. Ver nota revisada no topo do DPIA (2026-07-14): o
//   portão incide sobre a ATIVAÇÃO da flag, não sobre a construção do schema.
//
// LGPD (DPIA §4 "medidas e salvaguardas"):
//   - title: derivado da intenção da conversa (ex.: "Análise do funil de
//     Ariquemes"). NUNCA o nome de um titular. Higienização é responsabilidade
//     do service layer (F6-S25) — aqui documentamos a restrição.
//   - Escopo privado (DPIA §4.5): cada conversa só é legível pelo usuário dono
//     (user_id) — o repository de leitura (F6-S27) DEVE filtrar por
//     (organization_id, user_id) sempre, nunca expor conversa de outro usuário.
//   - Retenção: 90 dias com job de purga (DPIA §4.6 / doc 17 §6.1). O soft
//     delete (deleted_at) é o hook para esse job — implementação em slot futuro.
//
// Multi-tenant:
//   organization_id NOT NULL em toda tabela de domínio (§8 CLAUDE.md).
//
// updated_at:
//   Bumped via trigger set_updated_at (reutilizada desde 0000_init, mesmo
//   padrão de credit_analyses/followup_rules/collection_rules) em qualquer
//   UPDATE da linha — inclusive o "touch" que o service layer faz ao anexar
//   um novo turno à conversa (a linha do turno vive em assistant_turns; a
//   conversa é tocada explicitamente para refletir a ordenação da sidebar).
//
// Índices:
//   (organization_id, user_id, updated_at) parcial WHERE deleted_at IS NULL:
//   query principal da sidebar — "conversas do usuário X na org Y, mais
//   recentes primeiro, excluindo as soft-deletadas".
// =============================================================================
import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Multi-tenant root. Toda conversa pertence a uma organização.
     * NOT NULL: garante isolamento multi-tenant desde o dia 1 (§8 CLAUDE.md).
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Usuário dono da conversa — único que pode listar/reabrir (DPIA §4.5,
     * "escopo privado"). NOT NULL: toda conversa tem um dono humano.
     * ON DELETE CASCADE: a conversa só existe para o usuário retomar sua
     * própria consulta; sem o dono, a barra lateral não tem para quem
     * mostrá-la e não há motivo para retê-la (diferente de assistant_queries,
     * que é log de auditoria e usa SET NULL para preservar o registro).
     */
    userId: uuid('user_id').notNull(),

    /**
     * Título curto exibido na barra lateral, derivado da INTENÇÃO do pedido.
     * Exemplo: "Análise do funil de Ariquemes", "Cobranças em atraso".
     * PROIBIDO conter o nome de um titular (lead/cliente) — DPIA §3 risco R4.
     * Geração e sanitização são responsabilidade do service layer (F6-S25);
     * esta coluna documenta a restrição, não a impõe via CHECK (o universo de
     * títulos válidos depende de heurística de intenção, não de um padrão
     * regex estável o bastante para viver no banco).
     */
    title: text('title').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Atualizado automaticamente via trigger set_updated_at em qualquer
     * UPDATE da linha (inclusive o "touch" ao anexar um novo turno).
     * Base da ordenação da sidebar (mais recente primeiro).
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete. NULL = conversa ativa (aparece na sidebar).
     * NOT NULL = removida pelo usuário ou purgada pelo job de retenção de
     * 90 dias (DPIA §4.6) — preservada por um período curto antes da purga
     * física, sem PII em risco (o esqueleto já não contém PII em repouso).
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, on delete explícito)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_assistant_conversations_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkUser: foreignKey({
      name: 'fk_assistant_conversations_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Query principal da sidebar: conversas ATIVAS do usuário X na org Y,
     * ordenadas por atualização (mais recente primeiro). Parcial sobre
     * deleted_at IS NULL — mantém o índice pequeno e alinhado ao filtro real
     * da query (a sidebar nunca lista conversas soft-deletadas).
     * org_id na frente garante isolamento multi-tenant nas varreduras.
     */
    idxOrgUserUpdatedAt: index('idx_assistant_conversations_org_user_updated_at')
      .on(table.organizationId, table.userId, table.updatedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export type AssistantConversation = typeof assistantConversations.$inferSelect;
export type NewAssistantConversation = typeof assistantConversations.$inferInsert;
