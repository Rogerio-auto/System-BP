// =============================================================================
// modules/internal-assistant/service.ts -- Logica do copiloto interno (F6-S08).
//
// LGPD (doc 17 sec14.2 / doc 22 sec12.5):
//   - question_redacted: DLP antes de gravar em assistant_queries.
//   - Sem CPF, telefone, nome completo bruto em logs.
//
// Historico de sessao (F6-S17):
//   - `history` e memoria de sessao pura do cliente -- nunca persistido (nem
//     em assistant_queries) e nunca logado (o `content` de turnos anteriores
//     pode conter PII citada em respostas do copiloto). O pino redact abaixo
//     cobre `history[].content` explicitamente; o logger nunca recebe o
//     history bruto em nenhum campo de log.
//   - Truncado defensivamente para os ultimos 10 turnos antes de montar o
//     payload do LangGraph -- a rota HTTP ja rejeita (400) arrays maiores via
//     Zod `.max(10)`, mas o service protege qualquer chamador direto.
//
// Contrato estruturado narrativa + blocos (F6-S21):
//   - O LangGraph (F6-S20) devolve `{ narrative, blocks, answer, sources }`.
//     Este service repassa a resposta ao caller sem alteracao. `blocks[].value`
//     pode conter dado de cliente e NUNCA e logado -- o pino redact abaixo
//     cobre `blocks` e `narrative` como cinto-de-seguranca (o codigo hoje so
//     loga campos escalares, nunca o objeto de resposta inteiro).
//
// Historico persistente (F6-S25, atras da flag assistant.history.enabled):
//   - Apos responder, tenta persistir o turno via
//     modules/assistant-history/service.ts:persistAssistantTurn. Com a flag
//     OFF (default -- gate do DPO, ver docs/anexos/lgpd/dpia-historico-copiloto.md),
//     persistAssistantTurn e no-op puro: nenhuma query de escrita e emitida.
//   - Falha de persistencia (infra, bug) NUNCA bloqueia a resposta ao
//     operador -- mesmo padrao best-effort do insert em assistant_queries
//     abaixo. Nunca loga question/narrative/blocks no catch.
// =============================================================================
import { randomUUID } from 'node:crypto';

import pino from 'pino';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { assistantQueries } from '../../db/schema/assistantQueries.js';
import { redactPii } from '../../lib/dlp.js';
import { ExternalServiceError } from '../../shared/errors.js';
import { persistAssistantTurn } from '../assistant-history/service.js';

import type {
  AssistantHistoryTurn,
  AssistantQueryBody,
  AssistantQueryResponse,
  LangGraphAssistantRequest,
  LangGraphAssistantResponse,
  Principal,
} from './schemas.js';
import { LangGraphAssistantResponseSchema } from './schemas.js';

const logger = pino({
  name: 'internal-assistant',
  redact: {
    paths: [
      '*.question',
      '*.answer',
      '*.history',
      '*.history[*].content',
      '*.narrative',
      '*.blocks',
      '*.blocks[*].value',
    ],
    censor: '[REDACTED]',
  },
});

const LANGGRAPH_QUERY_PATH = '/process/assistant/query';
const QUERY_TIMEOUT_MS = env.LANGGRAPH_AI_TIMEOUT_MS ?? 25_000;
/** Máx. turnos de histórico repassados ao LangGraph (~5 idas-e-voltas). */
const MAX_HISTORY_TURNS = 10;

export interface AssistantActorContext {
  userId: string;
  organizationId: string;
  permissions: string[];
  cityScopeIds: string[] | null;
  ip: string | null;
  userAgent: string | null;
}

export async function handleAssistantQuery(
  actor: AssistantActorContext,
  body: AssistantQueryBody,
  correlationId: string,
): Promise<AssistantQueryResponse> {
  // 1. DLP -- nunca persistir PII bruta
  const { redactedText: questionRedacted, dlpApplied } = redactPii(body.question);
  if (dlpApplied) {
    logger.info({ correlationId, userId: actor.userId }, 'assistant_query_dlp_applied');
  }

  // 2. Principal do actor (JWT -- nunca do body)
  const principal: Principal = {
    user_id: actor.userId,
    organization_id: actor.organizationId,
    permissions: actor.permissions,
    city_scope_ids: actor.cityScopeIds,
  };

  // 3. Historico de sessao (opcional, nunca persistido/logado) -- truncado
  //    defensivamente para os ultimos N turnos antes de repassar ao LangGraph.
  const history: AssistantHistoryTurn[] | undefined = truncateHistory(body.history);

  // 4. Chamar LangGraph service
  const baseUrl = env.LANGGRAPH_SERVICE_URL.replace(/\/$/, '');
  const url = baseUrl + LANGGRAPH_QUERY_PATH;

  const payload: LangGraphAssistantRequest = {
    principal,
    question: questionRedacted,
    ...(history !== undefined ? { history } : {}),
    correlation_id: correlationId,
  };

  let lgResponse: LangGraphAssistantResponse;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': env.LANGGRAPH_INTERNAL_TOKEN,
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!fetchResponse.ok) {
      logger.error(
        { correlationId, status: fetchResponse.status },
        'assistant_query_langgraph_http_error',
      );
      throw new ExternalServiceError(
        'LangGraph retornou status inesperado: ' + String(fetchResponse.status),
      );
    }

    const raw: unknown = await fetchResponse.json();
    lgResponse = LangGraphAssistantResponseSchema.parse(raw);
  } catch (err) {
    if (err instanceof ExternalServiceError) throw err;

    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));

    logger.error({ correlationId, userId: actor.userId, isTimeout }, 'assistant_query_call_failed');

    // Fallback gracioso -- narrative == answer (mensagem estatica, sem PII), sem blocos.
    const fallbackNarrative =
      'Nao consegui consultar as informacoes agora. Tente novamente em instantes.';
    lgResponse = {
      narrative: fallbackNarrative,
      blocks: [],
      answer: fallbackNarrative,
      sources: [],
      tools_called: [],
      metadata: {},
      error: isTimeout ? 'timeout' : 'langgraph_unavailable',
    };
  }

  // 5. Persistir em assistant_queries (question_redacted -- DLP ja aplicado).
  //    `history` NAO e persistido aqui de proposito -- memoria de sessao pura.
  const cityScopeSnapshot =
    actor.cityScopeIds !== null
      ? { city_ids: actor.cityScopeIds, scope_type: 'city' }
      : { city_ids: [], scope_type: 'global' };

  const toolsCalled = (lgResponse.tools_called ?? []).map((t) => ({
    name: (t as { name?: string }).name ?? 'unknown',
    args_summary: {},
  }));

  try {
    await db.insert(assistantQueries).values({
      id: randomUUID(),
      organizationId: actor.organizationId,
      userId: actor.userId,
      questionRedacted,
      answerSummary: lgResponse.answer.slice(0, 500),
      toolsCalled: toolsCalled.length > 0 ? toolsCalled : null,
      cityScopeSnapshot,
    });
  } catch (persistErr) {
    // Falha de audit nao bloqueia a resposta
    logger.error(
      { correlationId, userId: actor.userId, error: (persistErr as Error).message },
      'assistant_query_audit_persist_failed',
    );
  }

  // 6. Historico persistente do copiloto (F6-S25) -- no-op puro com a flag
  //    assistant.history.enabled desligada (ver cabecalho do arquivo).
  //    `questionRedacted` ja passou por DLP (passo 1); persistAssistantTurn
  //    reaplica sanitizeForPersistence (DLP + mascaramento de nome) por
  //    conta propria -- defesa em profundidade, nunca confia que o caller
  //    ja higienizou o suficiente.
  try {
    await persistAssistantTurn(
      db,
      { userId: actor.userId, organizationId: actor.organizationId },
      {
        question: questionRedacted,
        narrative: lgResponse.narrative,
        blocks: lgResponse.blocks,
        sources: lgResponse.sources,
      },
    );
  } catch (persistErr) {
    // Falha de persistencia do historico nao bloqueia a resposta ao operador.
    // Nunca loga question/narrative/blocks -- so a mensagem de erro tecnica.
    logger.error(
      { correlationId, userId: actor.userId, error: (persistErr as Error).message },
      'assistant_history_persist_failed',
    );
  }

  logger.info(
    {
      correlationId,
      userId: actor.userId,
      hasError: Boolean(lgResponse.error),
      blocksCount: lgResponse.blocks.length,
    },
    'assistant_query_done',
  );

  // Repassa a forma estruturada do LangGraph (F6-S20) sem alteracao. `answer`
  // e derivado/legado (o LangGraph ja o entrega pronto) -- mantido so para
  // nao quebrar callers que ainda leem apenas `answer` durante a transicao.
  // Persistencia do historico (Fase 2) ja aconteceu no passo 6 acima -- no-op
  // com a flag assistant.history.enabled desligada.
  return {
    narrative: lgResponse.narrative,
    blocks: lgResponse.blocks,
    answer: lgResponse.answer,
    sources: lgResponse.sources,
  };
}

/**
 * Trunca o historico de sessao para os ultimos `MAX_HISTORY_TURNS` turnos
 * (mais antigo primeiro, entao mantemos a "cauda" do array). Retorna
 * `undefined` quando nao ha historico -- o campo fica omitido do payload
 * (compat com chamadas antigas sem `history`).
 *
 * Nunca loga `content` -- funcao pura, sem side effects de logging.
 */
function truncateHistory(
  history: AssistantHistoryTurn[] | undefined,
): AssistantHistoryTurn[] | undefined {
  if (history === undefined || history.length === 0) return undefined;
  if (history.length <= MAX_HISTORY_TURNS) return history;
  return history.slice(-MAX_HISTORY_TURNS);
}
