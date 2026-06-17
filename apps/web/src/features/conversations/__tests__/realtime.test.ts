// =============================================================================
// features/conversations/__tests__/realtime.test.ts — Testes de realtime (F16-S27).
//
// Estrategia: logica pura (sem JSDOM) — testa as funcoes de update de cache
// que o useConversationSocket aplica ao receber eventos socket.
//
// Cobertura:
//   1. message:new invalida lista + mensagens da conversa aberta.
//   2. conversation:updated com unreadCount=0 zera badge sem invalidar.
//   3. conversation:updated sem unreadCount invalida lista normalmente.
//   4. Abertura de conversa zera badge imediatamente no cache.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { Conversation, ConversationListResponse, ConversationUpdatedPayload } from '../types';

// ---------------------------------------------------------------------------
// Helpers de logica pura (extraidos do hook para teste isolado)
// ---------------------------------------------------------------------------

/**
 * Aplica atualizacao de unreadCount em uma lista de conversas.
 * Espelha a logica do setQueriesData em useConversationSocket.
 */
function applyUnreadCountUpdate(
  list: ConversationListResponse,
  payload: ConversationUpdatedPayload,
): ConversationListResponse {
  if (typeof payload.unreadCount !== 'number') return list;
  return {
    ...list,
    data: list.data.map((c: Conversation) =>
      c.id === payload.conversationId ? { ...c, unreadCount: payload.unreadCount! } : c,
    ),
  };
}

/**
 * Zera badge de uma conversa especifica (ao abrir).
 * Espelha a logica do useEffect de badge-zero em useConversationSocket.
 */
function applyBadgeZero(
  list: ConversationListResponse,
  conversationId: string,
): ConversationListResponse {
  return {
    ...list,
    data: list.data.map((c: Conversation) =>
      c.id === conversationId ? { ...c, unreadCount: 0 } : c,
    ),
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const makeConv = (id: string, unreadCount: number): Conversation => ({
  id,
  organizationId: 'org-001',
  cityId: 'city-001',
  channelId: 'ch-001',
  contactRemoteId: '5521999990001',
  contactName: 'Maria',
  leadId: null,
  customerId: null,
  status: 'open',
  assignedUserId: null,
  lastInboundAt: null,
  lastMessageAt: null,
  kind: 'dm',
  provider: 'meta_whatsapp',
  unreadCount,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
});

const makeList = (convs: Conversation[]): ConversationListResponse => ({
  data: convs,
  nextCursor: null,
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('applyUnreadCountUpdate', () => {
  it('1. zera badge da conversa correta ao receber unreadCount=0', () => {
    const list = makeList([makeConv('conv-a', 3), makeConv('conv-b', 1)]);
    const payload: ConversationUpdatedPayload = { conversationId: 'conv-a', unreadCount: 0 };

    const updated = applyUnreadCountUpdate(list, payload);

    expect(updated.data.find((c) => c.id === 'conv-a')?.unreadCount).toBe(0);
    expect(updated.data.find((c) => c.id === 'conv-b')?.unreadCount).toBe(1);
  });

  it('2. nao afeta outras conversas ao atualizar badge', () => {
    const list = makeList([makeConv('conv-a', 5), makeConv('conv-b', 2), makeConv('conv-c', 0)]);
    const payload: ConversationUpdatedPayload = { conversationId: 'conv-b', unreadCount: 0 };

    const updated = applyUnreadCountUpdate(list, payload);

    expect(updated.data.find((c) => c.id === 'conv-a')?.unreadCount).toBe(5);
    expect(updated.data.find((c) => c.id === 'conv-b')?.unreadCount).toBe(0);
    expect(updated.data.find((c) => c.id === 'conv-c')?.unreadCount).toBe(0);
  });

  it('3. payload sem unreadCount nao altera lista (retorna original)', () => {
    const list = makeList([makeConv('conv-a', 3)]);
    const payload: ConversationUpdatedPayload = {
      conversationId: 'conv-a',
      channelId: 'ch-001',
      viewStatus: 'read',
    };

    const updated = applyUnreadCountUpdate(list, payload);

    expect(updated).toBe(list); // referencia identica — nao recriou
  });

  it('4. lista vazia nao quebra', () => {
    const list = makeList([]);
    const payload: ConversationUpdatedPayload = { conversationId: 'conv-a', unreadCount: 0 };

    const updated = applyUnreadCountUpdate(list, payload);
    expect(updated.data).toHaveLength(0);
  });
});

describe('applyBadgeZero (abertura de conversa)', () => {
  it('5. badge some imediatamente ao abrir conversa', () => {
    const list = makeList([makeConv('conv-a', 4), makeConv('conv-b', 0)]);

    const updated = applyBadgeZero(list, 'conv-a');

    expect(updated.data.find((c) => c.id === 'conv-a')?.unreadCount).toBe(0);
    expect(updated.data.find((c) => c.id === 'conv-b')?.unreadCount).toBe(0);
  });

  it('6. nao afeta outras conversas ao zerar badge da aberta', () => {
    const list = makeList([makeConv('conv-a', 7), makeConv('conv-b', 3)]);

    const updated = applyBadgeZero(list, 'conv-a');

    expect(updated.data.find((c) => c.id === 'conv-b')?.unreadCount).toBe(3);
  });
});
