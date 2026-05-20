// =============================================================================
// ai-console/decisions/repository.ts — Queries Drizzle para ai_decision_logs (F9-S02).
//
// Notas de design:
//   - READ-ONLY: nenhuma função de escrita — tabela append-only, escrita é do LangGraph.
//   - Escopo de cidade: aplicado via JOIN com leads.city_id usando applyCityScope.
//     Decisões com lead_id IS NULL não têm city_id — restritas a admin/gestor_geral
//     via flag `allowNullLead` passada pelo service após verificar o papel do usuário.
//   - Paginação: cursor-based (created_at DESC + id DESC) — determinística e estável.
//   - Sem audit: operação de leitura em alto volume — audit geraria ruído excessivo.
//   - Sem outbox: read-only, sem side effects.
//
// Oracle de existência (doc 10 §3.5):
//   Quando gestor_regional acessa uma decisão fora do seu escopo, o repository
//   retorna 0 linhas → service lança NotFoundError (404), NUNCA ForbiddenError (403).
//   Isso impede confirmar que a decisão existe em outra cidade via status HTTP.
//
// Índices usados:
//   - (conversation_id, created_at): timeline de conversa.
//   - (organization_id, created_at): listagem geral com cursor.
//   - (lead_id) parcial: filtragem por lead.
// =============================================================================
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { aiDecisionLogs } from '../../../db/schema/aiDecisionLogs.js';
import { leads } from '../../../db/schema/leads.js';
import { applyCityScope } from '../../../shared/scope.js';
import type { UserScopeCtx } from '../../../shared/scope.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Row retornada pelo repository — estrutura flat com city_id do lead (para escopo).
 * O masking de PII é aplicado pelo service APÓS esta query.
 */
export type DecisionRow = typeof aiDecisionLogs.$inferSelect & {
  /** city_id do lead associado. null = lead sem cidade ou lead_id IS NULL. */
  leadCityId: string | null;
};

// ---------------------------------------------------------------------------
// Opções de listagem
// ---------------------------------------------------------------------------

export interface ListDecisionsOptions {
  /** Organization ID (multi-tenant obrigatório). */
  organizationId: string;
  /** Contexto de escopo do usuário autenticado. */
  userCtx: UserScopeCtx;
  /**
   * Se true, inclui decisões com lead_id IS NULL na query.
   * Deve ser true APENAS para admin e gestor_geral (verificado no service).
   * Para gestor_regional → false (essas decisões ficam fora do escopo).
   */
  allowNullLead: boolean;
  /** Filtro opcional por conversation_id. */
  conversationId?: string | undefined;
  /** Filtro opcional por lead_id. */
  leadId?: string | undefined;
  /** Filtro opcional por node_name. */
  nodeName?: string | undefined;
  /**
   * Cursor de paginação — ISO timestamp (exclusive upper bound DESC).
   * Combinado com idCursor para desempate.
   */
  cursor?: Date | undefined;
  /** UUID cursor de desempate (mesmo created_at). */
  idCursor?: string | undefined;
  /** Número de itens a retornar (limite de página). */
  limit: number;
}

// ---------------------------------------------------------------------------
// Query principal — listagem paginada
// ---------------------------------------------------------------------------

/**
 * Lista decisões de IA paginadas com cursor-based pagination.
 *
 * Cursor-based garante determinismo mesmo com inserts concorrentes:
 *   WHERE (created_at, id) < (cursor, id_cursor) ORDER BY created_at DESC, id DESC.
 *
 * Escopo de cidade:
 *   - Aplicado via LEFT JOIN com leads (city_id do lead).
 *   - Decisões com lead_id IS NULL ficam fora do escopo de gestor_regional.
 *   - allowNullLead = true somente para admin/gestor_geral.
 *
 * Retorna limit + 1 para que o service possa detectar se há próxima página
 * sem fazer COUNT(*) separado (N+1 avoidance).
 *
 * @security Oracle de existência: zero linhas → service lança NotFoundError.
 */
export async function listDecisions(
  db: Database,
  opts: ListDecisionsOptions,
): Promise<DecisionRow[]> {
  const {
    organizationId,
    userCtx,
    allowNullLead,
    conversationId,
    leadId,
    nodeName,
    cursor,
    idCursor,
    limit,
  } = opts;

  // -------------------------------------------------------------------------
  // Construir condições WHERE
  // -------------------------------------------------------------------------
  const conditions: ReturnType<typeof eq>[] = [];

  // Multi-tenant: sempre filtrar por organization_id (denormalizado na tabela).
  // Justificativa do cast `as`: Drizzle infere tipo concreto de `eq()` que é
  // estruturalmente compatível com `and()`, mas o array literal precisa do cast
  // para evitar narrowing excessivo em strict mode.
  const orgCond = eq(aiDecisionLogs.organizationId, organizationId);
  conditions.push(orgCond as ReturnType<typeof eq>);

  // Filtro por conversa (timeline)
  if (conversationId !== undefined) {
    conditions.push(eq(aiDecisionLogs.conversationId, conversationId) as ReturnType<typeof eq>);
  }

  // Filtro por lead
  if (leadId !== undefined) {
    conditions.push(eq(aiDecisionLogs.leadId, leadId) as ReturnType<typeof eq>);
  }

  // Filtro por nó
  if (nodeName !== undefined) {
    conditions.push(eq(aiDecisionLogs.nodeName, nodeName) as ReturnType<typeof eq>);
  }

  // -------------------------------------------------------------------------
  // Cursor pagination (determinística)
  // Condição: (created_at < cursor) OR (created_at = cursor AND id < id_cursor)
  // Ambos em DESC — "menor" timestamp = mais antigo.
  // -------------------------------------------------------------------------
  if (cursor !== undefined && idCursor !== undefined) {
    const cursorCond = or(
      lt(aiDecisionLogs.createdAt, cursor),
      and(
        // Justificativa do sql raw: Drizzle 0.34 não expõe operador `=` para timestamp
        // comparação direta com Date em contexto OR — usamos sql`` para garantir o tipo correto.
        sql`${aiDecisionLogs.createdAt} = ${cursor}::timestamptz`,
        lt(aiDecisionLogs.id, idCursor),
      ),
    );
    if (cursorCond !== undefined) {
      conditions.push(cursorCond as unknown as ReturnType<typeof eq>);
    }
  }

  // -------------------------------------------------------------------------
  // Escopo de cidade via JOIN com leads
  // -------------------------------------------------------------------------

  // Condição do applyCityScope aplicada à coluna leads.cityId (JOIN abaixo).
  const cityScopeCond = applyCityScope(userCtx, leads.cityId);

  // Construir a cláusula WHERE de escopo para decisões:
  //   Se allowNullLead=true (admin/gestor_geral): mostrar tudo sem restrição de cidade.
  //   Se allowNullLead=false (gestor_regional):
  //     - Decisões com lead_id IS NULL: EXCLUÍDAS (lead não identificado).
  //     - Decisões com lead associado: filtradas pelo cityScopeCond.
  let scopeWhere: ReturnType<typeof and> | undefined;

  if (!allowNullLead) {
    // gestor_regional: apenas decisões com lead identificado E dentro do escopo.
    // O LEFT JOIN com leads é feito abaixo; se lead não está no escopo → null no JOIN.
    if (cityScopeCond !== undefined) {
      // Filtro: lead existe E city_id está no escopo do usuário.
      scopeWhere = and(
        // lead_id NOT NULL (decision tem lead associado)
        sql`${aiDecisionLogs.leadId} IS NOT NULL` as unknown as ReturnType<typeof and>,
        // city_id do lead dentro do escopo
        cityScopeCond as unknown as ReturnType<typeof and>,
      );
    } else {
      // cityScopeIds = [] (sem acesso a cidade) → WHERE 1=0
      scopeWhere = and(sql`1 = 0` as unknown as ReturnType<typeof and>);
    }
  }
  // allowNullLead=true: sem restrição de cidade — admin/gestor_geral vêem tudo.

  // -------------------------------------------------------------------------
  // Executar query com LEFT JOIN em leads para obter city_id
  // -------------------------------------------------------------------------
  const rows = await db
    .select({
      id: aiDecisionLogs.id,
      organizationId: aiDecisionLogs.organizationId,
      conversationId: aiDecisionLogs.conversationId,
      leadId: aiDecisionLogs.leadId,
      customerId: aiDecisionLogs.customerId,
      nodeName: aiDecisionLogs.nodeName,
      intent: aiDecisionLogs.intent,
      promptKey: aiDecisionLogs.promptKey,
      promptVersion: aiDecisionLogs.promptVersion,
      model: aiDecisionLogs.model,
      tokensIn: aiDecisionLogs.tokensIn,
      tokensOut: aiDecisionLogs.tokensOut,
      latencyMs: aiDecisionLogs.latencyMs,
      decision: aiDecisionLogs.decision,
      error: aiDecisionLogs.error,
      correlationId: aiDecisionLogs.correlationId,
      createdAt: aiDecisionLogs.createdAt,
      // Coluna do lead para rastreabilidade de escopo (não enviada ao cliente)
      leadCityId: leads.cityId,
    })
    .from(aiDecisionLogs)
    // LEFT JOIN: preserva decisões com lead_id IS NULL (filtradas pelo scopeWhere abaixo)
    .leftJoin(leads, eq(aiDecisionLogs.leadId, leads.id))
    .where(
      scopeWhere !== undefined
        ? and(
            ...conditions,
            // Justificativa do cast: scopeWhere e conditions são SQL conditions compatíveis
            // com and(). Drizzle aceita spread de SQL[], cast necessário por inference.
            scopeWhere as unknown as ReturnType<typeof eq>,
          )
        : and(...conditions),
    )
    // Ordem determinística para cursor-based pagination:
    //   created_at DESC = mais recentes primeiro
    //   id DESC = desempate por UUID quando mesmo timestamp
    .orderBy(desc(aiDecisionLogs.createdAt), desc(aiDecisionLogs.id))
    // limit + 1: service usa o +1 para detectar hasNextPage sem COUNT(*)
    .limit(limit + 1);

  return rows.map((r) => ({
    ...r,
    leadCityId: r.leadCityId ?? null,
    // Justificativa do cast: Drizzle infere jsonb como unknown. O schema da tabela
    // define `decision` como objeto estruturado de saída de nós do LangGraph.
    // O masking de PII é aplicado no service antes de serializar.
    decision: (r.decision ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Timeline de uma conversa — todos os nós em ordem cronológica
// ---------------------------------------------------------------------------

export interface TimelineOptions {
  organizationId: string;
  userCtx: UserScopeCtx;
  allowNullLead: boolean;
  conversationId: string;
}

/**
 * Retorna todos os logs de uma conversa em ordem cronológica ASC (timeline).
 *
 * Sem paginação — conversas têm ≤ 50 nós por design do LangGraph.
 * Escopo de cidade: idêntico ao listDecisions (JOIN + allowNullLead).
 *
 * @security Oracle de existência: zero linhas → service lança NotFoundError.
 */
export async function getConversationTimeline(
  db: Database,
  opts: TimelineOptions,
): Promise<DecisionRow[]> {
  const { organizationId, userCtx, allowNullLead, conversationId } = opts;

  const cityScopeCond = applyCityScope(userCtx, leads.cityId);

  let scopeWhere: ReturnType<typeof and> | undefined;
  if (!allowNullLead) {
    if (cityScopeCond !== undefined) {
      scopeWhere = and(
        sql`${aiDecisionLogs.leadId} IS NOT NULL` as unknown as ReturnType<typeof and>,
        cityScopeCond as unknown as ReturnType<typeof and>,
      );
    } else {
      scopeWhere = and(sql`1 = 0` as unknown as ReturnType<typeof and>);
    }
  }

  const baseConds = [
    eq(aiDecisionLogs.organizationId, organizationId) as ReturnType<typeof eq>,
    eq(aiDecisionLogs.conversationId, conversationId) as ReturnType<typeof eq>,
  ];

  const rows = await db
    .select({
      id: aiDecisionLogs.id,
      organizationId: aiDecisionLogs.organizationId,
      conversationId: aiDecisionLogs.conversationId,
      leadId: aiDecisionLogs.leadId,
      customerId: aiDecisionLogs.customerId,
      nodeName: aiDecisionLogs.nodeName,
      intent: aiDecisionLogs.intent,
      promptKey: aiDecisionLogs.promptKey,
      promptVersion: aiDecisionLogs.promptVersion,
      model: aiDecisionLogs.model,
      tokensIn: aiDecisionLogs.tokensIn,
      tokensOut: aiDecisionLogs.tokensOut,
      latencyMs: aiDecisionLogs.latencyMs,
      decision: aiDecisionLogs.decision,
      error: aiDecisionLogs.error,
      correlationId: aiDecisionLogs.correlationId,
      createdAt: aiDecisionLogs.createdAt,
      leadCityId: leads.cityId,
    })
    .from(aiDecisionLogs)
    .leftJoin(leads, eq(aiDecisionLogs.leadId, leads.id))
    .where(
      scopeWhere !== undefined
        ? and(...baseConds, scopeWhere as unknown as ReturnType<typeof eq>)
        : and(...baseConds),
    )
    // ASC para timeline — nós em ordem de execução
    .orderBy(aiDecisionLogs.createdAt, aiDecisionLogs.id)
    // Hard cap defensivo: conversa com > 200 nós seria bug no LangGraph
    .limit(200);

  return rows.map((r) => ({
    ...r,
    leadCityId: r.leadCityId ?? null,
    // Justificativa do cast: Drizzle infere jsonb como unknown. O schema da tabela
    // define `decision` como objeto estruturado de saída de nós do LangGraph.
    // O masking de PII é aplicado no service antes de serializar.
    decision: (r.decision ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Helper: verifica se há decisão com lead_id IS NULL na conversa
// Usado pelo service para validar acesso a timeline de conversa pré-identificação
// ---------------------------------------------------------------------------

/**
 * Verifica se uma conversa tem alguma decisão com lead_id IS NULL.
 * Usado pelo service para restringir acesso de gestor_regional a conversas
 * onde o lead não foi ainda identificado.
 */
export async function conversationHasNullLeadDecision(
  db: Database,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: aiDecisionLogs.id })
    .from(aiDecisionLogs)
    .where(
      and(
        eq(aiDecisionLogs.organizationId, organizationId),
        eq(aiDecisionLogs.conversationId, conversationId),
        isNull(aiDecisionLogs.leadId),
      ),
    )
    .limit(1);

  return row !== undefined;
}
