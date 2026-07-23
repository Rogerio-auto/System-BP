// =============================================================================
// features/quick-replies/__tests__/useQuickRepliesRealtime.test.ts — Testes
// de `attachQuickRepliesRealtimeListener` (F28-S05, doc 25 §9).
//
// A lógica de registro/remoção do listener foi extraída para uma função pura
// (sem React) exatamente para ser testável sem @testing-library/react (não
// instalado neste projeto). Cobre o item do DoD do slot: "useQuickReplies
// Realtime registra e remove o listener corretamente (teste)".
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

import { quickReplyKeys } from '../queries';
import type { QuickReplyChangedPayload } from '../types';
import {
  attachQuickRepliesRealtimeListener,
  QUICK_REPLY_CHANGED_EVENT,
  type QuickRepliesRealtimeQueryClient,
  type QuickRepliesRealtimeSocket,
} from '../useQuickRepliesRealtime';

// ---------------------------------------------------------------------------
// Fake socket — EventEmitter mínimo compatível com Pick<Socket, 'on' | 'off'>.
// ---------------------------------------------------------------------------

type Handler = (payload: QuickReplyChangedPayload) => void;

class FakeSocket implements QuickRepliesRealtimeSocket {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  /** Simula o servidor emitindo o evento — dispara todos os handlers registrados. */
  emit(event: string, payload: QuickReplyChangedPayload): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  handlerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function makeFakeQueryClient(): QuickRepliesRealtimeQueryClient & {
  invalidateQueries: ReturnType<typeof vi.fn>;
} {
  return { invalidateQueries: vi.fn() };
}

const PAYLOAD: QuickReplyChangedPayload = {
  quickReplyId: '11111111-1111-1111-1111-111111111111',
  action: 'updated',
  visibility: 'organization',
};

describe('attachQuickRepliesRealtimeListener — registro', () => {
  it('registra exatamente 1 handler para quick_reply:changed', () => {
    const socket = new FakeSocket();
    const queryClient = makeFakeQueryClient();

    attachQuickRepliesRealtimeListener(socket, queryClient);

    expect(socket.handlerCount(QUICK_REPLY_CHANGED_EVENT)).toBe(1);
  });

  it('invalida quickReplyKeys.all quando o evento chega', () => {
    const socket = new FakeSocket();
    const queryClient = makeFakeQueryClient();

    attachQuickRepliesRealtimeListener(socket, queryClient);
    socket.emit(QUICK_REPLY_CHANGED_EVENT, PAYLOAD);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: quickReplyKeys.all });
  });

  it('múltiplos eventos disparam múltiplas invalidações (sem debounce implícito)', () => {
    const socket = new FakeSocket();
    const queryClient = makeFakeQueryClient();

    attachQuickRepliesRealtimeListener(socket, queryClient);
    socket.emit(QUICK_REPLY_CHANGED_EVENT, PAYLOAD);
    socket.emit(QUICK_REPLY_CHANGED_EVENT, { ...PAYLOAD, action: 'deleted' });

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });
});

describe('attachQuickRepliesRealtimeListener — cleanup', () => {
  it('a função de cleanup remove o handler registrado', () => {
    const socket = new FakeSocket();
    const queryClient = makeFakeQueryClient();

    const cleanup = attachQuickRepliesRealtimeListener(socket, queryClient);
    expect(socket.handlerCount(QUICK_REPLY_CHANGED_EVENT)).toBe(1);

    cleanup();
    expect(socket.handlerCount(QUICK_REPLY_CHANGED_EVENT)).toBe(0);
  });

  it('após o cleanup, eventos emitidos NÃO disparam mais invalidação (sem listener fantasma)', () => {
    const socket = new FakeSocket();
    const queryClient = makeFakeQueryClient();

    const cleanup = attachQuickRepliesRealtimeListener(socket, queryClient);
    cleanup();
    socket.emit(QUICK_REPLY_CHANGED_EVENT, PAYLOAD);

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('duas montagens independentes não se pisam: cleanup de uma não afeta a outra', () => {
    const socket = new FakeSocket();
    const queryClientA = makeFakeQueryClient();
    const queryClientB = makeFakeQueryClient();

    const cleanupA = attachQuickRepliesRealtimeListener(socket, queryClientA);
    attachQuickRepliesRealtimeListener(socket, queryClientB);
    expect(socket.handlerCount(QUICK_REPLY_CHANGED_EVENT)).toBe(2);

    cleanupA();
    expect(socket.handlerCount(QUICK_REPLY_CHANGED_EVENT)).toBe(1);

    socket.emit(QUICK_REPLY_CHANGED_EVENT, PAYLOAD);
    expect(queryClientA.invalidateQueries).not.toHaveBeenCalled();
    expect(queryClientB.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
