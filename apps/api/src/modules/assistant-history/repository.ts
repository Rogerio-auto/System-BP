// =============================================================================
// modules/assistant-history/repository.ts — Queries Drizzle do histórico do
// copiloto interno (F6-S25).
//
// Escopo privado (DPIA §4.5): toda query de leitura/escrita é filtrada por
// (organization_id, user_id) — nunca expõe conversa de outro usuário. As
// funções que buscam por id retornam `null` quando a conversa não existe OU
// pertence a outro usuário/organização — o caller SEMPRE trata como 404,
// nunca 403 (doc 10 §3.5: não vazar existência do recurso).
//
// `blocks`/`sources` são gravados como jsonb já na forma final — a remoção
// de `value` de cada bloco é responsabilidade do service layer (nunca desta
// camada), mas o CHECK do banco (chk_assistant_turns_blocks_no_value) é a
// defesa em profundidade caso essa regra seja violada.
// =============================================================================
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { assistantConversations, assistantTurns } from '../../db/schema/index.js';

import type { StoredBlock } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export type ConversationRow = typeof assistantConversations.$inferSelect;
export type TurnRow = typeof assistantTurns.$inferSelect;

/** Insumo mínimo para gravar um novo turno — `blocks` já sem `value`. */
export interface NewTurnInput {
  questionSanitized: string;
  narrative: string;
  blocks: StoredBlock[];
  sources: string[];
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Lista as conversas ATIVAS (não soft-deletadas) do usuário na organização,
 * mais recentes primeiro (por `updated_at`) — query principal da sidebar.
 */
export async function listConversationsByOwner(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<ConversationRow[]> {
  return db
    .select()
    .from(assistantConversations)
    .where(
      and(
        eq(assistantConversations.organizationId, organizationId),
        eq(assistantConversations.userId, userId),
        isNull(assistantConversations.deletedAt),
      ),
    )
    .orderBy(desc(assistantConversations.updatedAt));
}

/**
 * Busca uma conversa ATIVA pelo id, já escopada ao dono. Retorna `null`
 * quando não existe, está soft-deletada ou pertence a outro usuário/org —
 * o caller trata sempre como 404 (nunca vaza existência do recurso).
 */
export async function findConversationByOwner(
  db: Database,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const rows = await db
    .select()
    .from(assistantConversations)
    .where(
      and(
        eq(assistantConversations.id, conversationId),
        eq(assistantConversations.organizationId, organizationId),
        eq(assistantConversations.userId, userId),
        isNull(assistantConversations.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Lista os turnos de uma conversa em ordem cronológica (mais antigo primeiro). */
export async function listTurnsByConversation(
  db: Database,
  conversationId: string,
): Promise<TurnRow[]> {
  return db
    .select()
    .from(assistantTurns)
    .where(eq(assistantTurns.conversationId, conversationId))
    .orderBy(assistantTurns.createdAt);
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Cria uma conversa vazia (esqueleto) para o dono informado. */
export async function insertConversation(
  db: Database,
  organizationId: string,
  userId: string,
  title: string,
): Promise<ConversationRow> {
  const rows = await db
    .insert(assistantConversations)
    .values({ organizationId, userId, title })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error('assistant-history: falha ao criar conversa — insert não retornou linha');
  }
  return row;
}

/**
 * Insere um turno em uma conversa existente e "toca" (`touch`) a conversa —
 * bump de `updated_at` via trigger `set_updated_at`, para refletir a
 * ordenação da sidebar (comentário de design em db/schema/assistantConversations.ts).
 */
export async function insertTurnAndTouchConversation(
  db: Database,
  conversationId: string,
  input: NewTurnInput,
): Promise<TurnRow> {
  const rows = await db
    .insert(assistantTurns)
    .values({
      conversationId,
      questionSanitized: input.questionSanitized,
      narrative: input.narrative,
      blocks: input.blocks,
      sources: input.sources,
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error('assistant-history: falha ao criar turno — insert não retornou linha');
  }

  // Touch: qualquer UPDATE dispara trg_assistant_conversations_updated_at,
  // que sobrescreve updated_at com now() independentemente do valor enviado.
  await db
    .update(assistantConversations)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversations.id, conversationId));

  return row;
}

/**
 * Renomeia uma conversa do dono. Retorna `null` se não existir/pertencer a
 * outro usuário — o caller trata como 404.
 */
export async function renameConversationByOwner(
  db: Database,
  organizationId: string,
  userId: string,
  conversationId: string,
  title: string,
): Promise<ConversationRow | null> {
  const rows = await db
    .update(assistantConversations)
    .set({ title })
    .where(
      and(
        eq(assistantConversations.id, conversationId),
        eq(assistantConversations.organizationId, organizationId),
        eq(assistantConversations.userId, userId),
        isNull(assistantConversations.deletedAt),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Soft-delete de uma conversa do dono (`deleted_at = now()`). Retorna `true`
 * se uma linha foi afetada — `false` quando não existe/pertence a outro
 * usuário/já estava deletada (o caller trata como 404).
 */
export async function softDeleteConversationByOwner(
  db: Database,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .update(assistantConversations)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(assistantConversations.id, conversationId),
        eq(assistantConversations.organizationId, organizationId),
        eq(assistantConversations.userId, userId),
        isNull(assistantConversations.deletedAt),
      ),
    )
    .returning({ id: assistantConversations.id });

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Retenção / exclusão (F6-S26) — sempre ELIMINAÇÃO FÍSICA (`DELETE`), nunca
// soft-delete: doc 17 §6.1 classifica o histórico do copiloto como
// "eliminação física" (sem vínculo de audit a preservar — DPIA §4.9 registra
// só criação/abertura, não o conteúdo). `assistant_turns` é removido em
// CASCADE pela FK `fk_assistant_turns_conversation` (ON DELETE CASCADE) —
// nenhuma query explícita de `assistant_turns` é necessária aqui.
// ---------------------------------------------------------------------------

/**
 * Conta conversas soft-deletadas pelo dono (`deleted_at IS NOT NULL`),
 * candidatas à purga física imediata (mais protetivo ao titular — não
 * esperar os 90 dias de retenção quando o próprio usuário já pediu a
 * exclusão).
 */
export async function countSoftDeletedConversations(db: Database): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(assistantConversations)
    .where(isNotNull(assistantConversations.deletedAt));

  return rows[0]?.value ?? 0;
}

/** Elimina fisicamente TODAS as conversas soft-deletadas. Retorna a contagem. */
export async function deleteSoftDeletedConversations(db: Database): Promise<number> {
  const rows = await db
    .delete(assistantConversations)
    .where(isNotNull(assistantConversations.deletedAt))
    .returning({ id: assistantConversations.id });

  return rows.length;
}

/**
 * Conta conversas ATIVAS (nunca deletadas pelo dono) cuja última atividade
 * (`updated_at` — tocado a cada novo turno, ver insertTurnAndTouchConversation)
 * ultrapassou o `threshold` de retenção (doc 17 §6.1: 90 dias, DPIA §4.6).
 */
export async function countExpiredConversations(db: Database, threshold: Date): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(assistantConversations)
    .where(
      and(
        isNull(assistantConversations.deletedAt),
        lt(assistantConversations.updatedAt, threshold),
      ),
    );

  return rows[0]?.value ?? 0;
}

/** Elimina fisicamente conversas ATIVAS além do `threshold` de retenção. Retorna a contagem. */
export async function deleteExpiredConversations(db: Database, threshold: Date): Promise<number> {
  const rows = await db
    .delete(assistantConversations)
    .where(
      and(
        isNull(assistantConversations.deletedAt),
        lt(assistantConversations.updatedAt, threshold),
      ),
    )
    .returning({ id: assistantConversations.id });

  return rows.length;
}

/**
 * Gancho de exclusão por usuário (DoD deste slot): elimina fisicamente TODAS
 * as conversas (soft-deletadas ou não) de um usuário numa organização —
 * chamado por um fluxo de remoção/anonimização de usuário (fora do escopo
 * deste módulo). Também coberto, para o caso de exclusão física da linha do
 * usuário, pela FK `fk_assistant_conversations_user` (ON DELETE CASCADE);
 * esta função cobre o caso de ANONIMIZAÇÃO, em que a linha do usuário
 * permanece mas seu histórico de uso do copiloto não deve sobreviver.
 */
export async function deleteConversationsByUser(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .delete(assistantConversations)
    .where(
      and(
        eq(assistantConversations.organizationId, organizationId),
        eq(assistantConversations.userId, userId),
      ),
    )
    .returning({ id: assistantConversations.id });

  return rows.length;
}
