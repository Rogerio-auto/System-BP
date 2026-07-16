// =============================================================================
// features/conversations/__tests__/realtime.test.ts — Testes de realtime (F16-S27).
//
// Estrategia: testa as funcoes REAIS de update de cache que o useConversationSocket
// aplica ao receber eventos socket — agora sobre a estrutura InfiniteData (a lista
// do inbox usa useInfiniteQuery: cache = { pages: [{ data, nextCursor }...] }).
//
// Cobertura:
//   applyUnreadCountToList — badge update in place, em múltiplas páginas.
//   applyMessageNewToList  — move a conversa para o topo (página 0) + incrementa.
// =============================================================================

import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { applyMessageNewToList, applyUnreadCountToList } from '../hooks/useConversationSocket';
import type { Conversation, ConversationListResponse, MessageNewPayload } from '../types';

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

/** Monta um InfiniteData com uma página por array de conversas passado. */
const makeInfinite = (...pages: Conversation[][]): InfiniteData<ConversationListResponse> => ({
  pages: pages.map((convs, i) => ({
    data: convs,
    nextCursor: i < pages.length - 1 ? `cursor-${i}` : null,
  })),
  pageParams: pages.map((_, i) => (i === 0 ? undefined : `cursor-${i - 1}`)),
});

const msgPayload = (
  conversationId: string,
  direction: 'inbound' | 'outbound',
): MessageNewPayload => ({
  messageId: 'msg-1',
  conversationId,
  channelId: 'ch-001',
  organizationId: 'org-001',
  messageType: 'text',
  direction,
  hasMedia: false,
  createdAt: '2026-07-01T12:00:00Z',
});

// ---------------------------------------------------------------------------
// applyUnreadCountToList
// ---------------------------------------------------------------------------

describe('applyUnreadCountToList', () => {
  it('1. zera badge da conversa correta ao receber unreadCount=0', () => {
    const cache = makeInfinite([makeConv('conv-a', 3), makeConv('conv-b', 1)]);

    const updated = applyUnreadCountToList(cache, 'conv-a', 0);
    const flat = updated!.pages.flatMap((p) => p.data);

    expect(flat.find((c) => c.id === 'conv-a')?.unreadCount).toBe(0);
    expect(flat.find((c) => c.id === 'conv-b')?.unreadCount).toBe(1);
  });

  it('2. atualiza a conversa mesmo estando numa página posterior', () => {
    const cache = makeInfinite([makeConv('conv-a', 5)], [makeConv('conv-b', 2)]);

    const updated = applyUnreadCountToList(cache, 'conv-b', 0);
    const flat = updated!.pages.flatMap((p) => p.data);

    expect(flat.find((c) => c.id === 'conv-a')?.unreadCount).toBe(5);
    expect(flat.find((c) => c.id === 'conv-b')?.unreadCount).toBe(0);
  });

  it('3. conversa ausente → retorna a MESMA referência (sem re-render)', () => {
    const cache = makeInfinite([makeConv('conv-a', 3)]);

    const updated = applyUnreadCountToList(cache, 'inexistente', 0);

    expect(updated).toBe(cache);
  });

  it('4. cache indefinido não quebra', () => {
    expect(applyUnreadCountToList(undefined, 'conv-a', 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyMessageNewToList
// ---------------------------------------------------------------------------

describe('applyMessageNewToList', () => {
  it('5. move a conversa para o topo da página 0 e incrementa unread (inbound, não aberta)', () => {
    const cache = makeInfinite([makeConv('conv-a', 0), makeConv('conv-b', 1)]);

    const { next, found } = applyMessageNewToList(cache, msgPayload('conv-b', 'inbound'), false);

    expect(found).toBe(true);
    const page0 = next!.pages[0]!.data;
    expect(page0[0]!.id).toBe('conv-b'); // subiu para o topo
    expect(page0[0]!.unreadCount).toBe(2); // 1 → 2
    expect(page0.filter((c) => c.id === 'conv-b')).toHaveLength(1); // sem duplicar
  });

  it('6. conversa aberta NÃO incrementa unread', () => {
    const cache = makeInfinite([makeConv('conv-a', 0), makeConv('conv-b', 3)]);

    const { next } = applyMessageNewToList(cache, msgPayload('conv-b', 'inbound'), true);

    expect(next!.pages[0]!.data[0]!.unreadCount).toBe(3);
  });

  it('7. conversa numa página posterior sobe para a página 0', () => {
    const cache = makeInfinite([makeConv('conv-a', 0)], [makeConv('conv-b', 0)]);

    const { next, found } = applyMessageNewToList(cache, msgPayload('conv-b', 'inbound'), false);

    expect(found).toBe(true);
    expect(next!.pages[0]!.data[0]!.id).toBe('conv-b');
    // não permanece na página 1
    expect(next!.pages[1]!.data.some((c) => c.id === 'conv-b')).toBe(false);
  });

  it('8. conversa ausente → found=false (chamador invalida a lista)', () => {
    const cache = makeInfinite([makeConv('conv-a', 0)]);

    const { next, found } = applyMessageNewToList(cache, msgPayload('nova', 'inbound'), false);

    expect(found).toBe(false);
    expect(next).toBe(cache);
  });
});

// ---------------------------------------------------------------------------
// Regressão: contador dobrando quando há conversa aberta (bug real do F24).
//
// useConversationSocket é montado DUAS VEZES quando uma conversa está aberta
// (ChatList sempre montado + ConversationPanel montado enquanto selecionada).
// Antes do fix de `scope` ('list' | 'detail'), AMBAS as montagens processavam
// o cache da LISTA para o MESMO evento global `message:new` — um inbound em
// conversa de fundo incrementava o unreadCount duas vezes. Este teste prova
// que aplicar a mesma função pura duas vezes SOBRE O MESMO EVENTO dobra a
// contagem (a causa raiz), justificando por que o hook agora garante que
// SOMENTE a instância com scope 'list' chama applyMessageNewToList — nunca
// duas instâncias para o mesmo evento.
// ---------------------------------------------------------------------------

describe('regressão: dupla aplicação de um único evento dobra o contador', () => {
  it('aplicar applyMessageNewToList 1x incrementa +1 (comportamento correto — scope único)', () => {
    const cache = makeInfinite([makeConv('conv-a', 0), makeConv('conv-b', 1)]);

    const { next } = applyMessageNewToList(cache, msgPayload('conv-b', 'inbound'), false);

    expect(next!.pages[0]!.data[0]!.unreadCount).toBe(2); // 1 → 2 (uma única aplicação)
  });

  it('aplicar applyMessageNewToList 2x para o MESMO evento dobra o contador (bug pré-fix)', () => {
    const cache = makeInfinite([makeConv('conv-a', 0), makeConv('conv-b', 1)]);
    const payload = msgPayload('conv-b', 'inbound');

    // Simula as DUAS montagens do hook (ChatList + ConversationPanel) processando
    // o mesmo evento sem isolamento de `scope` — a causa raiz do bug relatado.
    const first = applyMessageNewToList(cache, payload, false);
    const second = applyMessageNewToList(first.next, payload, false);

    // 1 → 2 (primeira aplicação) → 3 (segunda, indevida). Documenta por que o
    // hook real restringe esta chamada a UMA ÚNICA instância (scope 'list').
    expect(second.next!.pages[0]!.data[0]!.unreadCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Regressão: entrada de shape FLAT legado ({data,nextCursor}) não pode crashar.
// O prefixo ['conversations','list'] do setQueriesData casa entradas flat
// legadas; os helpers devem ignorá-las (sem `pages`) em vez de estourar.
// ---------------------------------------------------------------------------

describe('helpers robustos a shape flat legado', () => {
  // Objeto flat proposital, tipado como cache infinite para simular o que o
  // setQueriesData entrega ao casar uma entrada legada pelo prefixo.
  const flat = { data: [makeConv('conv-a', 3)], nextCursor: null } as unknown as Parameters<
    typeof applyUnreadCountToList
  >[0];

  it('9. applyUnreadCountToList retorna a entrada flat intacta (sem crash)', () => {
    expect(() => applyUnreadCountToList(flat, 'conv-a', 0)).not.toThrow();
    expect(applyUnreadCountToList(flat, 'conv-a', 0)).toBe(flat);
  });

  it('10. applyMessageNewToList retorna found=false para entrada flat (sem crash)', () => {
    const call = () => applyMessageNewToList(flat, msgPayload('conv-a', 'inbound'), false);
    expect(call).not.toThrow();
    expect(call().found).toBe(false);
  });
});
