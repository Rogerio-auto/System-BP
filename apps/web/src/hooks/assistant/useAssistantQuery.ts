// =============================================================================
// hooks/assistant/useAssistantQuery.ts — Mutation do copiloto interno (F6-S09).
//
// POST /api/internal-assistant/query — pergunta em linguagem natural sobre dados
// operacionais (leads, cobranças, simulações), sempre respeitando RBAC + escopo
// de cidade no backend. Contrato real
// (apps/api/src/modules/internal-assistant/schemas.ts):
//   request:  { question: string, history?: Array<{ role: 'user'|'assistant', content: string }> }
//             question: 1..2000 chars — history: opcional, máx 10 itens, content max 4000 chars
//   response: { narrative: string, blocks: Block[], sources: string[], answer: string }
//
// Contrato estruturado narrativa + blocos (F6-S21, consumido a partir de F6-S22):
//   - `narrative`: comentário/estrutura da resposta SEM PII de cliente — renderizado
//     via AssistantMarkdown.
//   - `blocks`: dados de cliente da resposta, referenciados por entidade (`ref`) +
//     `value` hidratado (efêmero, `unknown` de propósito — cada card valida a forma
//     em runtime, ver features/assistant/blocks/guards.ts). `type` NÃO é um enum
//     fechado — tipo desconhecido cai no card genérico de fallback.
//   - `answer`: [Legado] narrative + blocks já renderizados em texto plano pelo
//     LangGraph. Mantido só para (a) fallback de UI quando narrative e blocks vêm
//     vazios e (b) alimentar o `history` de sessão (buildAssistantHistory) — é a
//     representação textual mais completa de um turno anterior para dar
//     continuidade ao LLM.
//
// Histórico de sessão (F6-S19): `history` são os turnos anteriores da conversa,
// montados pelo caller (AssistantWorkspaceModal) a partir do useState do chat —
// mais antigo primeiro, alternando user/assistant, excluindo o turno atual e
// turnos de erro/loading. Nunca persistido em localStorage/sessionStorage (LGPD
// doc 17) — vive só em memória enquanto o workspace está aberto.
//
// Gating (camada UI, aplicada pelo caller): hasPermission('ai_assistant:use') &&
// useFeatureFlag('ai.internal_assistant.enabled'). O backend também aplica
// (authorize + featureGate na rota) — isto é defesa em profundidade, não a
// fonte de verdade.
//
// LGPD (doc 17): pergunta/resposta/histórico nunca são persistidos no client
// (sem localStorage/sessionStorage/cookies) — vivem apenas em memória de estado
// do componente enquanto o workspace está aberto, e são descartadas ao fechar.
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

/** Espelha AssistantQueryBodySchema.history (.max(10)) no backend — cap rígido. */
export const ASSISTANT_HISTORY_MAX_TURNS = 10;

/** Timeout do client — folga sobre o timeout do grafo (~25s) no backend. */
export const ASSISTANT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Referência de entidade de um bloco — sem PII, apenas `kind` + UUID opaco.
 * Espelha BlockRefSchema (apps/api/.../internal-assistant/schemas.ts).
 */
export interface AssistantBlockRef {
  kind: 'lead' | 'none';
  lead_id: string | null;
}

/**
 * Bloco de dado de cliente referenciado por entidade. `type` não é um enum
 * fechado (forward-compat com tipos novos do LangGraph) — `value` chega como
 * `unknown` de propósito; a validação de forma acontece em runtime por card
 * (features/assistant/blocks/guards.ts), nunca por cast.
 * Espelha BlockSchema (apps/api/.../internal-assistant/schemas.ts).
 */
export interface AssistantBlock {
  type: string;
  ref: AssistantBlockRef;
  value: unknown;
}

/** Espelha AssistantQueryResponseSchema (apps/api/.../internal-assistant/schemas.ts). */
export interface AssistantQueryResponse {
  narrative: string;
  blocks: AssistantBlock[];
  sources: string[];
  /** [Legado] narrative + blocks já renderizados em texto plano — ver nota acima. */
  answer: string;
}

/**
 * Um turno do histórico de sessão enviado ao backend. Espelha
 * AssistantHistoryTurnSchema (apps/api/.../internal-assistant/schemas.ts).
 */
export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantQueryVariables {
  question: string;
  history?: AssistantHistoryTurn[];
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
  history: AssistantHistoryTurn[] | undefined,
  signal: AbortSignal,
): Promise<AssistantQueryResponse> {
  // Defesa em profundidade: mesmo que o caller já tenha truncado, nunca
  // deixamos passar mais de ASSISTANT_HISTORY_MAX_TURNS — o backend rejeita
  // com 400 acima disso.
  const truncatedHistory =
    history && history.length > 0 ? history.slice(-ASSISTANT_HISTORY_MAX_TURNS) : undefined;

  return api.post<AssistantQueryResponse>(
    '/api/internal-assistant/query',
    truncatedHistory ? { question, history: truncatedHistory } : { question },
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAssistantQueryResult {
  /**
   * Envia a pergunta (+ histórico de sessão opcional, já truncado pelo
   * caller para os últimos ASSISTANT_HISTORY_MAX_TURNS); resolve com a
   * resposta ou rejeita (classifique com classifyAssistantError).
   */
  ask: (question: string, history?: AssistantHistoryTurn[]) => Promise<AssistantQueryResponse>;
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
  const mutation: UseMutationResult<AssistantQueryResponse, unknown, AssistantQueryVariables> =
    useMutation({
      mutationFn: ({ question, history }: AssistantQueryVariables) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
        return postAssistantQuery(question, history, controller.signal).finally(() => {
          clearTimeout(timer);
        });
      },
    });

  return {
    ask: (question: string, history?: AssistantHistoryTurn[]) =>
      mutation.mutateAsync(history ? { question, history } : { question }),
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
