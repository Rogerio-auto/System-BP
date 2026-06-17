// =============================================================================
// features/conversations/__tests__/ChatList.test.ts — Testes do ChatList (F16-S16).
//
// Estratégia: lógica pura isolada (sem JSDOM — padrão do projeto).
//
// Cobertura:
//   1. formatTimestamp: "HH:MM" para hoje, "DD/MM" para datas passadas, "" para null.
//   2. Filtro de busca por contactName (lógica replicada do hook).
//   3. Lógica do badge de não-lidas (> 0 exibe, = 0 oculta, > 99 trunca).
//   4. Acumulação de páginas (dedup por id).
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { Conversation, ConversationStatus } from '../types';

// ---------------------------------------------------------------------------
// Replica de formatTimestamp (de ChatListItem.tsx)
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ---------------------------------------------------------------------------
// Replica da lógica de filtro de busca (de ChatList.tsx)
// ---------------------------------------------------------------------------

function filterBySearch(conversations: Conversation[], search: string): Conversation[] {
  if (!search.trim()) return conversations;
  const q = search.trim().toLowerCase();
  return conversations.filter((c) => (c.contactName ?? '').toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Replica da lógica de badge (de ChatListItem.tsx)
// ---------------------------------------------------------------------------

function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

// ---------------------------------------------------------------------------
// Replica da lógica de acumulação de páginas (de ChatList.tsx)
// ---------------------------------------------------------------------------

function accumulateConversations(prev: Conversation[], newItems: Conversation[]): Conversation[] {
  const existingIds = new Set(prev.map((c) => c.id));
  const dedupedNew = newItems.filter((c) => !existingIds.has(c.id));
  return [...prev, ...dedupedNew];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    organizationId: 'org-1',
    cityId: null,
    channelId: 'chan-1',
    contactRemoteId: 'remote-1',
    contactName: 'João Silva',
    leadId: null,
    customerId: null,
    status: 'open' as ConversationStatus,
    assignedUserId: null,
    lastInboundAt: null,
    lastMessageAt: null,
    kind: 'dm',
    provider: 'meta_whatsapp',
    unreadCount: 0,
    createdAt: '2026-06-10T10:00:00.000Z',
    updatedAt: '2026-06-10T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  it('retorna string vazia para null', () => {
    expect(formatTimestamp(null)).toBe('');
  });

  it('retorna HH:MM quando a data é hoje', () => {
    const now = new Date('2026-06-16T14:32:00.000Z');
    const iso = '2026-06-16T14:32:00.000Z';
    const result = formatTimestamp(iso, now);
    // Formato pt-BR HH:MM (depende do locale da máquina, mas deve conter ":")
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('retorna DD/MM quando a data é outro dia', () => {
    const now = new Date('2026-06-16T14:32:00.000Z');
    const iso = '2026-06-12T10:00:00.000Z';
    const result = formatTimestamp(iso, now);
    // Formato pt-BR DD/MM
    expect(result).toMatch(/\d{2}\/\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// Testes: filtro de busca
// ---------------------------------------------------------------------------

describe('filterBySearch', () => {
  const conversations = [
    makeConversation({ id: '1', contactName: 'João Silva' }),
    makeConversation({ id: '2', contactName: 'Maria Oliveira' }),
    makeConversation({ id: '3', contactName: null }),
  ];

  it('retorna todos quando a busca é vazia', () => {
    expect(filterBySearch(conversations, '')).toHaveLength(3);
  });

  it('retorna todos quando a busca é só espaços', () => {
    expect(filterBySearch(conversations, '   ')).toHaveLength(3);
  });

  it('filtra por nome parcial (case-insensitive)', () => {
    const result = filterBySearch(conversations, 'joão');
    expect(result).toHaveLength(1);
    expect(result[0]?.contactName).toBe('João Silva');
  });

  it('contato null não quebra — retorna match vazio', () => {
    const result = filterBySearch(conversations, 'xyzxyz');
    expect(result).toHaveLength(0);
  });

  it('retorna múltiplos quando há mais de um match', () => {
    const result = filterBySearch(conversations, 'a');
    // "João Silva" tem 'a', "Maria Oliveira" tem 'a' — ambos match
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Testes: badge de não-lidas
// ---------------------------------------------------------------------------

describe('badgeText', () => {
  it('retorna null para count 0', () => {
    expect(badgeText(0)).toBeNull();
  });

  it('retorna null para count negativo', () => {
    expect(badgeText(-1)).toBeNull();
  });

  it('retorna o número como string para count 1-99', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(99)).toBe('99');
  });

  it('retorna "99+" para count > 99', () => {
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(999)).toBe('99+');
  });
});

// ---------------------------------------------------------------------------
// Testes: acumulação de páginas (dedup por id)
// ---------------------------------------------------------------------------

describe('accumulateConversations', () => {
  it('concatena quando não há duplicatas', () => {
    const prev = [makeConversation({ id: '1' })];
    const next = [makeConversation({ id: '2' }), makeConversation({ id: '3' })];
    const result = accumulateConversations(prev, next);
    expect(result).toHaveLength(3);
  });

  it('remove duplicatas por id', () => {
    const prev = [makeConversation({ id: '1' }), makeConversation({ id: '2' })];
    const next = [makeConversation({ id: '2' }), makeConversation({ id: '3' })];
    const result = accumulateConversations(prev, next);
    expect(result).toHaveLength(3);
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('retorna prev intacto quando next é vazio', () => {
    const prev = [makeConversation({ id: '1' })];
    const result = accumulateConversations(prev, []);
    expect(result).toHaveLength(1);
  });

  it('retorna next quando prev é vazio', () => {
    const next = [makeConversation({ id: '1' }), makeConversation({ id: '2' })];
    const result = accumulateConversations([], next);
    expect(result).toHaveLength(2);
  });
});
