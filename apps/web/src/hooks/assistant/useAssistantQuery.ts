// =============================================================================
// hooks/assistant/useAssistantQuery.ts — Mutation do copiloto interno (F6-S09).
//
// POST /api/internal-assistant/query — pergunta em linguagem natural sobre dados
// operacionais (leads, cobranças, simulações), sempre respeitando RBAC + escopo
// de cidade no backend. Contrato real
// (apps/api/src/modules/internal-assistant/schemas.ts):
//   request:  { question: string }        (1..2000 chars)
//   response: { answer: string, sources: string[] }
//
// Gating (camada UI, aplicada pelo caller): hasPermission('ai_assistant:use') &&
// useFeatureFlag('ai.internal_assistant.enabled'). O backend também aplica
// (authorize + featureGate na rota) — isto é defesa em profundidade, não a
// fonte de verdade.
//
// LGPD (doc 17): pergunta/resposta nunca são persistidas no client (sem
// localStorage/sessionStorage/cookies) — vivem apenas em memória de estado do
// componente enquanto o drawer está aberto, e são descartadas ao fechar.
//
// Timeout: AbortController client-side em ASSISTANT_TIMEOUT_MS — folga sobre o
// timeout do grafo LangGraph (LANGGRAPH_AI_TIMEOUT_MS ~25s no backend), para
// evitar loading infinito caso a resposta nunca chegue.
// =============================================================================

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

// ---------------------------------------------------------------------------
// Constantes do contrato
// ---------------------------------------------------------------------------

/** Espelha AssistantQueryBodySchema.question (max) no backend. */
export const ASSISTANT_QUESTION_MAX_LENGTH = 2000;

/** Timeout do client — folga sobre o timeout do grafo (~25s) no backend. */
export const ASSISTANT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Espelha AssistantQueryResponseSchema (apps/api/.../internal-assistant/schemas.ts). */
export interface AssistantQueryResponse {
  answer: string;
  sources: string[];
}

export type AssistantErrorKind =
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'rate_limited'
  | 'server'
  | 'network';

export interface AssistantError {
  kind: AssistantErrorKind;
  message: string;
}

// ---------------------------------------------------------------------------
// Classificação de erro — função pura, testável sem montar o hook
// ---------------------------------------------------------------------------

/**
 * Traduz um erro de rede/API em uma mensagem graciosa para o usuário.
 * Cobre: timeout (AbortError), 401/403 (sessão/permissão), 400 (pergunta
 * inválida), 429 (rate limit da rota — 20 req/min), 5xx e falha de rede.
 */
export function classifyAssistantError(error: unknown): AssistantError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      kind: 'timeout',
      message: 'O assistente demorou para responder. Tente novamente em instantes.',
    };
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return { kind: 'unauthorized', message: 'Sua sessão expirou. Faça login novamente.' };
      case 403:
        return {
          kind: 'forbidden',
          message: 'Você não tem permissão para usar o assistente interno.',
        };
      case 400:
        return { kind: 'invalid', message: 'Pergunta inválida. Reformule e tente novamente.' };
      case 429:
        return {
          kind: 'rate_limited',
          message: 'Muitas perguntas em pouco tempo. Aguarde 1 minuto e tente novamente.',
        };
      default:
        return {
          kind: 'server',
          message: 'O assistente não conseguiu responder agora. Tente novamente em instantes.',
        };
    }
  }

  return {
    kind: 'network',
    message: 'Falha de conexão. Verifique sua internet e tente novamente.',
  };
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function postAssistantQuery(
  question: string,
  signal: AbortSignal,
): Promise<AssistantQueryResponse> {
  return api.post<AssistantQueryResponse>(
    '/api/internal-assistant/query',
    { question },
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAssistantQueryResult {
  /** Envia a pergunta; resolve com a resposta ou rejeita (classifique com classifyAssistantError). */
  ask: (question: string) => Promise<AssistantQueryResponse>;
  /** true enquanto aguarda resposta do copiloto. */
  isPending: boolean;
  /** Reseta o estado interno da mutation (não afeta o histórico local do drawer). */
  reset: () => void;
}

/**
 * Mutation TanStack Query para o copiloto interno.
 * Uma pergunta por vez (o composer desabilita envio enquanto isPending).
 */
export function useAssistantQuery(): UseAssistantQueryResult {
  const mutation: UseMutationResult<AssistantQueryResponse, unknown, string> = useMutation({
    mutationFn: (question: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
      return postAssistantQuery(question, controller.signal).finally(() => {
        clearTimeout(timer);
      });
    },
  });

  return {
    ask: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
