// =============================================================================
// quick-replies/repository.ts — Queries Drizzle para respostas rápidas (F28-S03).
//
// Fronteira de segurança: organization_id (doc 25 D6) — NÃO usar applyCityScope.
// city_ids é filtro de CONVENIÊNCIA de exibição, aplicado aqui apenas para
// restringir a listagem ao escopo de cidade do próprio ator (UX), nunca como
// fronteira multi-tenant.
//
// Regra de visibilidade (doc 25 §5, regra 2) aplicada em SQL, nunca em memória:
//   visibility='organization' UNIÃO owner_user_id = actor.userId.
// Um operador nunca vê a resposta pessoal de outro através deste repositório
// — inclusive em GET/PATCH/DELETE por id, que reusam o mesmo filtro da
// listagem (findVisibleQuickReplyById). A exceção "tela admin com manage"
// citada no doc (§5, regra 2) exigiria uma capacidade de listagem
// administrativa dedicada, fora do escopo deste slot (F28-S03) — decisão
// deliberada, documentada no slot.
// =============================================================================
import { and, arrayOverlaps, asc, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { organizations } from '../../db/schema/organizations.js';
import { quickReplies } from '../../db/schema/quickReplies.js';
import type { NewQuickReply, QuickReply } from '../../db/schema/quickReplies.js';
import { users } from '../../db/schema/users.js';

// ---------------------------------------------------------------------------
// Tipos de I/O do repositório
// ---------------------------------------------------------------------------

export interface QuickReplyListQuery {
  search?: string | undefined;
  visibility?: 'organization' | 'personal' | undefined;
  category?: string | undefined;
  isActive?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface PaginatedQuickReplies {
  data: QuickReply[];
  nextCursor: string | null;
}

export interface CreateQuickReplyInput {
  organizationId: string;
  ownerUserId: string | null;
  visibility: 'organization' | 'personal';
  shortcut: string;
  title: string;
  body: string | null;
  category: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaKind: 'image' | 'video' | 'audio' | 'document' | null;
  mediaSizeBytes: number | null;
  mediaFileName: string | null;
  cityIds: string[];
  isActive: boolean;
  sortOrder: number;
  createdBy: string | null;
}

export interface UpdateQuickReplyInput {
  /**
   * Recalculado pelo service SOMENTE quando `visibility` muda de estado —
   * nunca vindo do body (doc 25 §5, regra 5). `undefined` = não tocar a
   * coluna; `null`/string = novo valor explícito.
   */
  ownerUserId?: string | null;
  visibility?: 'organization' | 'personal';
  shortcut?: string;
  title?: string;
  body?: string | null;
  category?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | null;
  mediaSizeBytes?: number | null;
  mediaFileName?: string | null;
  cityIds?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Helper: condição de visibilidade (doc 25 §5, regra 2)
// ---------------------------------------------------------------------------

function visibilityCondition(actorUserId: string) {
  return or(eq(quickReplies.visibility, 'organization'), eq(quickReplies.ownerUserId, actorUserId));
}

/**
 * Filtro de conveniência por cidade (doc 25 D6) — NÃO é fronteira de segurança.
 *
 * - actorCityScopeIds === null  → ator global (admin/gestor_geral) — sem filtro.
 * - actorCityScopeIds === []    → ator sem cidade — só enxerga respostas
 *   marcadas para "todas as cidades" (city_ids vazio).
 * - actorCityScopeIds.length>0  → city_ids vazio (todas) OU overlap com o
 *   escopo do ator.
 */
function cityConvenienceCondition(actorCityScopeIds: string[] | null) {
  if (actorCityScopeIds === null) return undefined;
  return or(
    sql`array_length(${quickReplies.cityIds}, 1) IS NULL`,
    arrayOverlaps(quickReplies.cityIds, actorCityScopeIds),
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista respostas rápidas visíveis ao ator (org ∪ próprias), com filtros,
 * busca e paginação por cursor (keyset).
 *
 * Ordenação: sort_order ASC, usage_count DESC, title ASC, id ASC (desempate
 * estável para o cursor). O cursor é opaco (id do último item da página
 * anterior) — resolvido internamente para as colunas de ordenação da linha
 * de referência, e a comparação usa tupla de linha do Postgres. `usage_count`
 * é negado na tupla para expressar DESC dentro de uma comparação que, por
 * padrão, é lexicográfica ascendente coluna a coluna.
 */
export async function findQuickReplies(
  db: Database,
  organizationId: string,
  actorUserId: string,
  actorCityScopeIds: string[] | null,
  query: QuickReplyListQuery,
): Promise<PaginatedQuickReplies> {
  const conditions = [
    eq(quickReplies.organizationId, organizationId),
    isNull(quickReplies.deletedAt),
    visibilityCondition(actorUserId),
  ];

  const cityCondition = cityConvenienceCondition(actorCityScopeIds);
  if (cityCondition !== undefined) conditions.push(cityCondition);

  if (query.visibility !== undefined) {
    conditions.push(eq(quickReplies.visibility, query.visibility));
  }
  if (query.category !== undefined) {
    conditions.push(eq(quickReplies.category, query.category));
  }
  if (query.isActive !== undefined) {
    conditions.push(eq(quickReplies.isActive, query.isActive));
  }
  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        ilike(quickReplies.title, pattern),
        ilike(quickReplies.body, pattern),
        ilike(quickReplies.category, pattern),
      ),
    );
  }

  if (query.cursor !== undefined) {
    const cursorRows = await db
      .select({
        sortOrder: quickReplies.sortOrder,
        usageCount: quickReplies.usageCount,
        title: quickReplies.title,
        id: quickReplies.id,
      })
      .from(quickReplies)
      .where(
        and(eq(quickReplies.id, query.cursor), eq(quickReplies.organizationId, organizationId)),
      )
      .limit(1);
    const cursorRow = cursorRows[0];
    if (cursorRow !== undefined) {
      conditions.push(
        sql`(${quickReplies.sortOrder}, -${quickReplies.usageCount}, ${quickReplies.title}, ${quickReplies.id}) > (${cursorRow.sortOrder}, ${-cursorRow.usageCount}, ${cursorRow.title}, ${cursorRow.id})`,
      );
    }
  }

  // Busca limit+1 para saber se há próxima página sem uma segunda query de count.
  const rows = await db
    .select()
    .from(quickReplies)
    .where(and(...conditions))
    .orderBy(
      asc(quickReplies.sortOrder),
      desc(quickReplies.usageCount),
      asc(quickReplies.title),
      asc(quickReplies.id),
    )
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  const lastRow = data[data.length - 1];
  const nextCursor = hasMore && lastRow !== undefined ? lastRow.id : null;

  return { data, nextCursor };
}

/**
 * Busca uma resposta rápida visível ao ator (mesma regra de visibilidade da
 * listagem) — usado por GET/PATCH/DELETE por id. Retorna null se não existir,
 * pertencer a outra organização, estiver soft-deleted, OU for uma resposta
 * pessoal de outro operador (não vazamento — 404 uniforme).
 */
export async function findVisibleQuickReplyById(
  db: Database,
  organizationId: string,
  actorUserId: string,
  id: string,
): Promise<QuickReply | null> {
  const rows = await db
    .select()
    .from(quickReplies)
    .where(
      and(
        eq(quickReplies.id, id),
        eq(quickReplies.organizationId, organizationId),
        isNull(quickReplies.deletedAt),
        visibilityCondition(actorUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Verifica conflito de atalho dentro do escopo correto (doc 25 §4.1):
 *   - ownerUserId null  → único entre as org-wide (uq_quick_replies_shortcut_org_wide).
 *   - ownerUserId != null → único dentro da biblioteca daquele dono
 *     (uq_quick_replies_shortcut_per_owner) — pode sombrear um atalho org-wide.
 */
export async function findShortcutConflict(
  db: Database,
  organizationId: string,
  ownerUserId: string | null,
  shortcut: string,
  excludeId?: string,
): Promise<boolean> {
  const conditions = [
    eq(quickReplies.organizationId, organizationId),
    eq(quickReplies.shortcut, shortcut),
    isNull(quickReplies.deletedAt),
    ownerUserId === null
      ? isNull(quickReplies.ownerUserId)
      : eq(quickReplies.ownerUserId, ownerUserId),
  ];
  if (excludeId !== undefined) {
    conditions.push(ne(quickReplies.id, excludeId));
  }

  const rows = await db
    .select({ id: quickReplies.id })
    .from(quickReplies)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0;
}

/**
 * Insere uma nova resposta rápida. Deve ser chamado dentro de transação.
 */
export async function insertQuickReply(
  db: Database,
  input: CreateQuickReplyInput,
): Promise<QuickReply> {
  const values: NewQuickReply = {
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    visibility: input.visibility,
    shortcut: input.shortcut,
    title: input.title,
    body: input.body,
    category: input.category,
    mediaUrl: input.mediaUrl,
    mediaMime: input.mediaMime,
    mediaKind: input.mediaKind,
    mediaSizeBytes: input.mediaSizeBytes,
    mediaFileName: input.mediaFileName,
    cityIds: input.cityIds,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
    createdBy: input.createdBy,
  };

  const rows = await db.insert(quickReplies).values(values).returning();
  const created = rows[0];
  if (created === undefined) {
    throw new Error('[quick-replies] Falha ao inserir resposta rápida');
  }
  return created;
}

/**
 * Atualiza uma resposta rápida existente. Deve ser chamado dentro de
 * transação. `updated_at` é mantido pelo trigger `trg_quick_replies_updated_at`
 * — não setado aqui. Retorna null se não encontrada ou de outra organização.
 */
export async function updateQuickReplyById(
  db: Database,
  organizationId: string,
  id: string,
  input: UpdateQuickReplyInput,
): Promise<QuickReply | null> {
  const setValues: Partial<NewQuickReply> = {};

  if (input.ownerUserId !== undefined) setValues.ownerUserId = input.ownerUserId;
  if (input.visibility !== undefined) setValues.visibility = input.visibility;
  if (input.shortcut !== undefined) setValues.shortcut = input.shortcut;
  if (input.title !== undefined) setValues.title = input.title;
  if (input.body !== undefined) setValues.body = input.body;
  if (input.category !== undefined) setValues.category = input.category;
  if (input.mediaUrl !== undefined) setValues.mediaUrl = input.mediaUrl;
  if (input.mediaMime !== undefined) setValues.mediaMime = input.mediaMime;
  if (input.mediaKind !== undefined) setValues.mediaKind = input.mediaKind;
  if (input.mediaSizeBytes !== undefined) setValues.mediaSizeBytes = input.mediaSizeBytes;
  if (input.mediaFileName !== undefined) setValues.mediaFileName = input.mediaFileName;
  if (input.cityIds !== undefined) setValues.cityIds = input.cityIds;
  if (input.isActive !== undefined) setValues.isActive = input.isActive;
  if (input.sortOrder !== undefined) setValues.sortOrder = input.sortOrder;

  if (Object.keys(setValues).length === 0) {
    // Nada a atualizar — devolve o estado atual (idempotente).
    const rows = await db
      .select()
      .from(quickReplies)
      .where(and(eq(quickReplies.id, id), eq(quickReplies.organizationId, organizationId)))
      .limit(1);
    return rows[0] ?? null;
  }

  const rows = await db
    .update(quickReplies)
    .set(setValues)
    .where(
      and(
        eq(quickReplies.id, id),
        eq(quickReplies.organizationId, organizationId),
        isNull(quickReplies.deletedAt),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Soft-delete. Deve ser chamado dentro de transação.
 */
export async function softDeleteQuickReplyById(
  db: Database,
  organizationId: string,
  id: string,
): Promise<QuickReply | null> {
  const rows = await db
    .update(quickReplies)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(quickReplies.id, id),
        eq(quickReplies.organizationId, organizationId),
        isNull(quickReplies.deletedAt),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Reordena em lote — escopo restrito a respostas ORG-WIDE (owner_user_id IS
 * NULL), consistente com "manage administra as da organização + reordenar"
 * (doc 25 §5). Reordenar a biblioteca pessoal de outro operador via `manage`
 * exigiria a mesma capacidade administrativa dedicada mencionada em
 * findVisibleQuickReplyById — fora do escopo deste slot.
 *
 * Atômico (chamado dentro de transação pelo service). Retorna os ids
 * efetivamente atualizados — o service usa isso para detectar ids que não
 * pertencem à organização ou não são org-wide.
 */
export async function reorderQuickReplies(
  db: Database,
  organizationId: string,
  items: readonly { id: string; sortOrder: number }[],
): Promise<string[]> {
  const updatedIds: string[] = [];

  for (const item of items) {
    const rows = await db
      .update(quickReplies)
      .set({ sortOrder: item.sortOrder })
      .where(
        and(
          eq(quickReplies.id, item.id),
          eq(quickReplies.organizationId, organizationId),
          isNull(quickReplies.ownerUserId),
          isNull(quickReplies.deletedAt),
        ),
      )
      .returning({ id: quickReplies.id });

    const updated = rows[0];
    if (updated !== undefined) updatedIds.push(updated.id);
  }

  return updatedIds;
}

// ---------------------------------------------------------------------------
// Security review (F28-S01/S02, nota 1) — nomes reais para a guarda
// defensiva pós-interpolação (service.ts assertBodyInterpolatesSafely).
// ---------------------------------------------------------------------------

export interface ActorDisplayNames {
  agentName: string | null;
  organizationName: string | null;
}

/**
 * Busca o nome do ator autenticado + nome da organização — usados para uma
 * interpolação de sanidade em CREATE/UPDATE (verificar que `{{atendente.*}}`/
 * `{{organizacao.*}}` resolvem de fato com dados reais, sem depender apenas
 * do CHECK `NOT NULL` do banco).
 */
export async function findActorDisplayNames(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<ActorDisplayNames> {
  const [userRow, orgRow] = await Promise.all([
    db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
  ]);

  return {
    agentName: userRow[0]?.fullName ?? null,
    organizationName: orgRow[0]?.name ?? null,
  };
}
