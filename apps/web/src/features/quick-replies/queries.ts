// =============================================================================
// features/quick-replies/queries.ts — Hooks TanStack Query de respostas
// rápidas (F28-S05).
//
// Única camada de leitura/escrita da feature — consumida pelo composer
// (F28-S06) e pelo admin (F28-S07). A key factory é isolada de propósito
// (doc 25 §9 + contexto do slot): duas features com a mesma prefix de key
// mas formatos de query diferentes foi exatamente o que esvaziou a lista do
// live chat ao trocar de aba.
//
// staleTime 60s (doc 25 §9) — complemento defensivo ao invalidate disparado
// por useQuickRepliesRealtime.ts quando `quick_reply:changed` chega.
//
// 409 (conflito de atalho) NUNCA vira toast aqui: o `ApiError` sobe intacto
// em `mutation.error` para o chamador decidir onde exibir (campo do
// formulário, doc 25 §4.1). Only `useMarkQuickReplyUsed` silencia erro —
// é telemetria (doc 25 §10), falha nunca pode quebrar o envio.
//
// Nunca useEffect + fetch — sempre TanStack Query. Invalidate após mutate.
// =============================================================================
import type {
  QuickReplyCreate,
  QuickReplyListResponse,
  QuickReplyResponse,
  QuickReplyUpdate,
} from '@elemento/shared-schemas';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { ApiError } from '../../lib/api';

import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  fetchQuickReply,
  markQuickReplyUsed,
  reorderQuickReplies,
  updateQuickReply,
} from './api';
import type { QuickReplyListParams, QuickReplyReorderItem } from './types';

// ---------------------------------------------------------------------------
// Key factory — isolada, sem reaproveitar prefixo de outra feature.
// `all` cobre lista E detalhe (mesmo prefixo `quick-replies`) de propósito:
// é o que useQuickRepliesRealtime invalida em `quick_reply:changed` (doc 25
// §9 — "No front: invalidateQueries(quickReplyKeys.all)").
// ---------------------------------------------------------------------------

export const quickReplyKeys = {
  all: ['quick-replies'] as const,
  list: (params: QuickReplyListParams = {}) => [...quickReplyKeys.all, 'list', params] as const,
  detail: (id: string) => [...quickReplyKeys.all, 'detail', id] as const,
} as const;

/** Doc 25 §9 — staleTime da leitura, complementar ao invalidate por socket. */
const QUICK_REPLY_STALE_TIME_MS = 60_000;

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * GET /api/quick-replies — lista (organização + próprias, doc 25 §5.2). O
 * service já resolve o filtro de visibilidade; o front só passa busca/filtro
 * de conveniência.
 */
export function useQuickReplies(
  params: QuickReplyListParams = {},
): UseQueryResult<QuickReplyListResponse, ApiError> {
  return useQuery({
    queryKey: quickReplyKeys.list(params),
    queryFn: () => fetchQuickReplies(params),
    staleTime: QUICK_REPLY_STALE_TIME_MS,
  });
}

/**
 * GET /api/quick-replies/:id — detalhe (prefill de edição no admin).
 * `id` undefined desabilita a query sem precisar de `queryFn: undefined`
 * (evita erro de tipo com `exactOptionalPropertyTypes`).
 */
export function useQuickReply(
  id: string | undefined,
): UseQueryResult<QuickReplyResponse, ApiError> {
  return useQuery({
    queryKey:
      id !== undefined ? quickReplyKeys.detail(id) : [...quickReplyKeys.all, 'detail', 'noop'],
    queryFn:
      id !== undefined ? () => fetchQuickReply(id) : () => Promise.reject(new Error('no-op')),
    enabled: id !== undefined,
    staleTime: QUICK_REPLY_STALE_TIME_MS,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * POST /api/quick-replies — cria. `visibility='organization'` exige
 * `manage`; `visibility='personal'` exige `write` (doc 25 §5). Um atalho
 * duplicado responde 409 — propagado cru em `mutation.error`.
 */
export function useCreateQuickReply(): UseMutationResult<
  QuickReplyResponse,
  ApiError,
  QuickReplyCreate
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: QuickReplyCreate) => createQuickReply(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quickReplyKeys.all });
    },
  });
}

/**
 * PATCH /api/quick-replies/:id — atualização parcial. Mesmo tratamento de
 * 409 do create: o erro sobe cru para o campo do formulário decidir.
 */
export function useUpdateQuickReply(): UseMutationResult<
  QuickReplyResponse,
  ApiError,
  { id: string; body: QuickReplyUpdate }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: QuickReplyUpdate }) =>
      updateQuickReply(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quickReplyKeys.all });
    },
  });
}

/** DELETE /api/quick-replies/:id — soft-delete. */
export function useDeleteQuickReply(): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteQuickReply(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quickReplyKeys.all });
    },
  });
}

/** PATCH /api/quick-replies/reorder — reordenação em lote (permissão `manage`). */
export function useReorderQuickReplies(): UseMutationResult<
  void,
  ApiError,
  readonly QuickReplyReorderItem[]
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: readonly QuickReplyReorderItem[]) => reorderQuickReplies(items),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quickReplyKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Telemetria (doc 25 §10) — fire-and-forget. Falha NUNCA gera toast nem
// bloqueia/desfaz o envio já concluído — onError silenciado de propósito.
// ---------------------------------------------------------------------------

export interface UseMarkQuickReplyUsedResult {
  /** Dispara o registro de uso. Fire-and-forget — o chamador não aguarda. */
  readonly markUsed: (id: string) => void;
}

/**
 * useMarkQuickReplyUsed — POST /:id/used sem Idempotency-Key (doc 25 §10).
 * Nunca lança, nunca gera toast: o `onError` é intencionalmente vazio.
 */
export function useMarkQuickReplyUsed(): UseMarkQuickReplyUsedResult {
  const mutation = useMutation({
    mutationFn: (id: string) => markQuickReplyUsed(id),
    onError: () => {
      // Silenciado de propósito (doc 25 §10): telemetria não pode gerar
      // toast nem quebrar o fluxo de envio já concluído.
    },
  });

  return {
    markUsed: (id: string) => {
      mutation.mutate(id);
    },
  };
}
