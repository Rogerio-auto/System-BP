// =============================================================================
// ai-console/decisions/service.ts — Regras de negócio do módulo ai_decision_logs (F9-S02).
//
// Responsabilidades:
//   - Determinar allowNullLead com base no papel do usuário (cityScopeIds).
//   - Aplicar masking defensivo de PII na coluna `decision` jsonb antes de retornar.
//   - Calcular cost_usd e cost_brl via priceModelTokens() (F9-S00).
//   - Montar DTO de resposta e cursor de paginação.
//
// LGPD (doc 17 §8.4):
//   - `decision` jsonb NUNCA deve conter PII bruta — DLP aplicado pelo LangGraph
//     antes de persistir. Masking defensivo aqui é defesa em profundidade.
//   - Regex de CPF/e-mail/telefone substituídas por '<masked>' em qualquer valor
//     string dentro do jsonb.
//   - Logs: apenas correlation_id e decision_id — nunca campos de `decision`.
//
// Sem audit: operação de leitura em alto volume — audit geraria ruído excessivo.
// Sem outbox: read-only, sem side effects.
// Sem escrita: tabela append-only, escrita é do LangGraph via /internal/*.
// =============================================================================
import type { Database } from '../../../db/client.js';
import { priceModelTokens } from '../../../lib/pricing.js';
import { NotFoundError } from '../../../shared/errors.js';

import { getConversationTimeline, listDecisions } from './repository.js';
import type { DecisionRow } from './repository.js';
import type {
  DecisionItem,
  ListDecisionsQuery,
  ListDecisionsResponse,
  TimelineResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Contexto do usuário para o service
// ---------------------------------------------------------------------------

export interface DecisionUserCtx {
  organizationId: string;
  /** null = admin/gestor_geral (acesso global). string[] = gestor_regional. */
  cityScopeIds: string[] | null;
}

// ---------------------------------------------------------------------------
// Masking defensivo de PII (doc 17 §8.4 — defesa em profundidade)
//
// O LangGraph já aplica DLP antes de persistir `decision`.
// Este masking é uma segunda linha de defesa para garantir que
// nenhum dado pessoal vaze na resposta da API, mesmo em caso de
// falha no DLP upstream.
//
// Regex escolhidas: conservadoras (podem ter falsos positivos em dados
// sintéticos). Prefere bloquear falso positivo a vazar PII real.
// ---------------------------------------------------------------------------

/** CPF numérico com ou sem máscara (ex: 12345678901 ou 123.456.789-01) */
const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/** E-mail — padrão conservador para texto livre */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Telefone brasileiro (fixo ou celular) — requer DDD OU prefixo de país.
 * Variantes cobertas:
 *   +55 (69) 99123-4567  |  69 99123-4567  |  (69) 9123-4567  |  +5569991234567
 *
 * A presença do DDD ou do código de país é obrigatória para evitar falsos
 * positivos em segmentos de UUIDs ou números de simulação (ex: "0000-0000").
 *
 * Regex: exige grupo DDD (\d{2}) seguido do número de 8-9 dígitos.
 */
const PHONE_REGEX =
  /\b(?:\+?55\s?)\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4}\b|\b\(?\d{2}\)[\s-]?9?\d{4}[-.\s]?\d{4}\b/g;

/**
 * Aplica masking de PII em uma string: substitui matches por '<masked>'.
 * Usa global flag nas regex para substituir todas as ocorrências.
 */
function maskString(value: string): string {
  // Ordem importa: CPF antes de telefone para evitar sub-matches parciais.
  return value
    .replace(CPF_REGEX, '<masked>')
    .replace(EMAIL_REGEX, '<masked>')
    .replace(PHONE_REGEX, '<masked>');
}

/**
 * Aplica masking recursivo de PII em qualquer valor JSON.
 * Traversa arrays e objetos. Strings são mascaradas.
 * Numbers/booleans/null passam sem alteração.
 *
 * Justificativa: `decision` é jsonb de estrutura arbitrária — masking deve ser
 * recursivo para cobrir campos aninhados de qualquer profundidade.
 */
function maskDecision(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskString(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskDecision);
  }
  if (value !== null && typeof value === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      masked[k] = maskDecision(v);
    }
    return masked;
  }
  return value;
}

/**
 * Mascara o campo `decision` do registro e retorna um Record<string, unknown>.
 * Garante que o output é sempre um objeto (nunca null/undefined).
 *
 * Justificativa do `unknown` na entrada: Drizzle ORM infere jsonb como `unknown`.
 * Fazemos o cast aqui, pois é o único ponto de entrada do jsonb — o schema
 * define `decision` como um objeto estruturado de saída de nós do LangGraph.
 */
function applyDecisionMasking(decision: unknown): Record<string, unknown> {
  const masked = maskDecision(decision);
  // Justificativa do cast: maskDecision preserva estrutura de objeto quando
  // a entrada é um objeto — o tipo de retorno `unknown` é narrowing conservador.
  return (masked ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helper: determina allowNullLead com base no contexto do usuário
// cityScopeIds === null → admin/gestor_geral → acesso global (allowNullLead = true)
// cityScopeIds !== null → gestor_regional → apenas decisões com lead identificado
// ---------------------------------------------------------------------------

function resolveAllowNullLead(userCtx: DecisionUserCtx): boolean {
  return userCtx.cityScopeIds === null;
}

// ---------------------------------------------------------------------------
// Helper: converte DecisionRow → DecisionItem (DTO de resposta)
// Aplica masking e calcula custo antes de retornar.
// ---------------------------------------------------------------------------

async function toDecisionItem(row: DecisionRow): Promise<DecisionItem> {
  // 1. Masking defensivo de PII no campo `decision` jsonb
  const maskedDecision = applyDecisionMasking(row.decision);

  // 2. Calcular custo por chamada LLM (F9-S00 helper)
  //    Modelo sem entry em model_pricing → { costUsd: null, costBrl: null }
  //    priceModelTokens requer provider — inferir 'openrouter' se model presente
  //    (OpenRouter é o gateway padrão — doc 02 §LLM gateway).
  const provider = row.model !== null ? 'openrouter' : '';
  const { costUsd, costBrl } = await priceModelTokens({
    provider,
    model: row.model ?? '',
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
  });

  return {
    id: row.id,
    conversation_id: row.conversationId,
    lead_id: row.leadId ?? null,
    customer_id: row.customerId ?? null,
    node_name: row.nodeName,
    intent: row.intent ?? null,
    prompt_key: row.promptKey ?? null,
    prompt_version: row.promptVersion ?? null,
    model: row.model ?? null,
    tokens_in: row.tokensIn ?? null,
    tokens_out: row.tokensOut ?? null,
    latency_ms: row.latencyMs ?? null,
    decision: maskedDecision,
    error: row.error ?? null,
    correlation_id: row.correlationId,
    cost_usd: costUsd,
    cost_brl: costBrl,
    created_at: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Listagem paginada
// ---------------------------------------------------------------------------

/**
 * Lista decisões paginadas com cursor-based pagination.
 *
 * Estratégia de cursor:
 *   - Retorna limit+1 linhas do repository para detectar hasNextPage.
 *   - Se há próxima página, o cursor é o created_at do último item retornado.
 *   - next_id_cursor = id do último item (desempate).
 *
 * Escopo de cidade:
 *   - allowNullLead derivado de cityScopeIds do usuário.
 *   - Masking aplicado em cada item antes de serializar.
 *
 * @param db Database instance.
 * @param userCtx Contexto do usuário autenticado.
 * @param query Query params validados pelo Zod.
 */
export async function listDecisionsSvc(
  db: Database,
  userCtx: DecisionUserCtx,
  query: ListDecisionsQuery,
): Promise<ListDecisionsResponse> {
  const allowNullLead = resolveAllowNullLead(userCtx);
  const limit = query.limit;

  const scopeCtx = { cityScopeIds: userCtx.cityScopeIds };

  const rows = await listDecisions(db, {
    organizationId: userCtx.organizationId,
    userCtx: scopeCtx,
    allowNullLead,
    conversationId: query.conversation_id,
    leadId: query.lead_id,
    nodeName: query.node_name,
    cursor: query.cursor !== undefined ? new Date(query.cursor) : undefined,
    idCursor: query.id_cursor,
    limit,
  });

  // Detectar próxima página (repository retorna limit+1)
  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  // Calcular cursor da próxima página
  const lastRow = pageRows.at(-1);
  const nextCursor = hasNextPage && lastRow !== undefined ? lastRow.createdAt.toISOString() : null;
  const nextIdCursor = hasNextPage && lastRow !== undefined ? lastRow.id : null;

  // Serializar itens com masking + custo (em paralelo para performance)
  const data = await Promise.all(pageRows.map(toDecisionItem));

  return {
    data,
    next_cursor: nextCursor,
    next_id_cursor: nextIdCursor,
    total_on_page: data.length,
  };
}

// ---------------------------------------------------------------------------
// Timeline de conversa
// ---------------------------------------------------------------------------

/**
 * Retorna a timeline cronológica de uma conversa (todos os nós em ordem ASC).
 *
 * Sem paginação — conversas têm ≤ 50 nós por design.
 *
 * Escopo de cidade:
 *   - Para gestor_regional: se a conversa não tiver nenhum nó com lead identificado
 *     no seu escopo, retorna NotFoundError (oracle de existência).
 *   - Para admin/gestor_geral: acesso irrestrito.
 *
 * @throws NotFoundError se nenhuma decisão for encontrada para a conversa no escopo.
 */
export async function getTimelineSvc(
  db: Database,
  userCtx: DecisionUserCtx,
  conversationId: string,
): Promise<TimelineResponse> {
  const allowNullLead = resolveAllowNullLead(userCtx);
  const scopeCtx = { cityScopeIds: userCtx.cityScopeIds };

  const rows = await getConversationTimeline(db, {
    organizationId: userCtx.organizationId,
    userCtx: scopeCtx,
    allowNullLead,
    conversationId,
  });

  // Oracle de existência: zero linhas → conversa não existe OU fora do escopo.
  // Lança NotFoundError (404) em vez de ForbiddenError (403) para não revelar
  // se a conversa existe em outra cidade (doc 10 §3.5).
  if (rows.length === 0) {
    throw new NotFoundError(`Conversa '${conversationId}' não encontrada no seu escopo`);
  }

  const data = await Promise.all(rows.map(toDecisionItem));

  return {
    conversation_id: conversationId,
    data,
    total: data.length,
  };
}

// ---------------------------------------------------------------------------
// Re-exports para o controller
// ---------------------------------------------------------------------------

export { NotFoundError };

// ---------------------------------------------------------------------------
// Exports de masking para testes unitários
// ---------------------------------------------------------------------------

export { maskString, applyDecisionMasking };
