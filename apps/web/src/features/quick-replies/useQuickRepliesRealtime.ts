// =============================================================================
// features/quick-replies/useQuickRepliesRealtime.ts — Sincronização em tempo
// real das respostas rápidas (F28-S05, doc 25 §9).
//
// Assina `quick_reply:changed` no socket JÁ conectado pelo SocketProvider
// global (montado 1x em App.tsx) e invalida `quickReplyKeys.all`. NÃO monta
// um provider novo — apenas consome `useSocket()`. Duplicar a montagem de um
// provider (ou o registro de um mesmo handler sem cleanup) já causou o
// contador de não-lidas dobrado no live chat — ver
// feedback_livechat_status_dropdown_and_counter.
//
// O payload do evento é mínimo por LGPD (doc 25 §9/§12 — sem `body`/`title`/
// mídia): o cliente só recebe o sinal e invalida a query, nunca lê dado do
// payload para renderizar.
//
// A lógica de registro/remoção do listener foi extraída para
// `attachQuickRepliesRealtimeListener` — função PURA, sem React — porque o
// projeto não tem @testing-library/react instalado (ver nota em
// hooks/__tests__/useFeatureFlag.test.ts) e o DoD do slot exige testar que o
// listener é registrado E removido corretamente.
// =============================================================================
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useSocket } from '../../lib/realtime/useSocket';

import { quickReplyKeys } from './queries';
import type { QuickReplyChangedPayload } from './types';

/** Nome do evento de socket (doc 25 §9). */
export const QUICK_REPLY_CHANGED_EVENT = 'quick_reply:changed';

/**
 * Recorte mínimo do `Socket` do socket.io-client usado aqui — deliberadamente
 * NÃO derivado de `Pick<Socket, 'on' | 'off'>`: as sobrecargas genéricas reais
 * de `Socket['on'/'off']` (eventos reservados como `connect`/`disconnect` com
 * assinaturas próprias) tornam um mock simples incompatível em compilação.
 * Este é o único contrato que `attachQuickRepliesRealtimeListener` precisa —
 * facilita tanto o uso real (Socket satisfaz estruturalmente) quanto o mock em
 * teste (ver __tests__/useQuickRepliesRealtime.test.ts).
 */
export interface QuickRepliesRealtimeSocket {
  on(event: string, listener: (payload: QuickReplyChangedPayload) => void): unknown;
  off(event: string, listener: (payload: QuickReplyChangedPayload) => void): unknown;
}

/** Recorte mínimo de QueryClient usado aqui — facilita o mock em teste. */
export type QuickRepliesRealtimeQueryClient = Pick<QueryClient, 'invalidateQueries'>;

/**
 * Registra o listener de `quick_reply:changed` no socket fornecido e retorna
 * a função de cleanup (remove o mesmo handler). Função pura — nenhuma
 * dependência de React — para ser testável isoladamente.
 */
export function attachQuickRepliesRealtimeListener(
  socket: QuickRepliesRealtimeSocket,
  queryClient: QuickRepliesRealtimeQueryClient,
): () => void {
  function handleQuickReplyChanged(_payload: QuickReplyChangedPayload): void {
    void queryClient.invalidateQueries({ queryKey: quickReplyKeys.all });
  }

  socket.on(QUICK_REPLY_CHANGED_EVENT, handleQuickReplyChanged);

  return () => {
    socket.off(QUICK_REPLY_CHANGED_EVENT, handleQuickReplyChanged);
  };
}

/**
 * useQuickRepliesRealtime — assina `quick_reply:changed` e invalida o cache
 * das respostas rápidas. Idempotente e seguro para múltiplas montagens
 * simultâneas (ex.: seletor do composer aberto + admin em outra aba) — cada
 * instância registra e remove o próprio handler no (des)montar, sem herdar
 * estado global além do socket já compartilhado pelo SocketProvider.
 */
export function useQuickRepliesRealtime(): void {
  const socket = useSocket();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!socket) return;
    return attachQuickRepliesRealtimeListener(socket, queryClient);
  }, [socket, queryClient]);
}
