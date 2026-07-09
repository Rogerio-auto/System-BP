// =============================================================================
// modules/internal-assistant/service.ts -- Logica do copiloto interno (F6-S08).
//
// LGPD (doc 17 sec14.2 / doc 22 sec12.5):
//   - question_redacted: DLP antes de gravar em assistant_queries.
//   - Sem CPF, telefone, nome completo bruto em logs.
// =============================================================================
import { randomUUID } from 'node:crypto';

import pino from 'pino';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { assistantQueries } from '../../db/schema/assistantQueries.js';
import { redactPii } from '../../lib/dlp.js';
import { ExternalServiceError } from '../../shared/errors.js';

import type {
  AssistantQueryBody,
  AssistantQueryResponse,
  LangGraphAssistantRequest,
  LangGraphAssistantResponse,
  Principal,
} from './schemas.js';
import { LangGraphAssistantResponseSchema } from './schemas.js';

const logger = pino({
  name: 'internal-assistant',
  redact: { paths: ['*.question', '*.answer'], censor: '[REDACTED]' },
});

const LANGGRAPH_QUERY_PATH = '/process/assistant/query';
const QUERY_TIMEOUT_MS = env.LANGGRAPH_AI_TIMEOUT_MS ?? 25_000;

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

  // 3. Chamar LangGraph service
  const baseUrl = env.LANGGRAPH_SERVICE_URL.replace(/\/$/, '');
  const url = baseUrl + LANGGRAPH_QUERY_PATH;

  const payload: LangGraphAssistantRequest = {
    principal,
    question: questionRedacted,
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

    // Fallback gracioso
    lgResponse = {
      answer: 'Nao consegui consultar as informacoes agora. Tente novamente em instantes.',
      sources: [],
      tools_called: [],
      metadata: {},
      error: isTimeout ? 'timeout' : 'langgraph_unavailable',
    };
  }

  // 4. Persistir em assistant_queries (question_redacted -- DLP ja aplicado)
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

  logger.info(
    { correlationId, userId: actor.userId, hasError: Boolean(lgResponse.error) },
    'assistant_query_done',
  );

  return { answer: lgResponse.answer, sources: lgResponse.sources };
}
