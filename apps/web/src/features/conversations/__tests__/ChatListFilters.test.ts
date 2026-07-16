// =============================================================================
// features/conversations/__tests__/ChatListFilters.test.ts — Dropdown de status.
//
// Estratégia: lógica pura isolada (sem JSDOM — padrão do projeto, ver
// ChatList.test.ts). Cobre:
//   1. STATUS_OPTIONS: ordem canônica, valor 'all' default, cores por token.
//   2. toQueryParams (replica da lógica de ChatList.tsx): default 'all' não
//      envia `status` ao backend; demais valores enviam o status explícito —
//      cobre a troca de status e o comportamento padrão "Todas".
// =============================================================================

import { describe, expect, it } from 'vitest';

import { STATUS_OPTIONS, type StatusFilter } from '../components/ChatList/ChatListFilters';
import type {
  ConversationCountsResponse,
  ConversationStatus,
  ConversationsQueryParams,
} from '../types';

// ---------------------------------------------------------------------------
// Replica de queryParams (de ChatList.tsx) — SEM cursor, status omitido
// quando 'all'.
// ---------------------------------------------------------------------------

const LIMIT = 25;

function toQueryParams(statusFilter: StatusFilter): ConversationsQueryParams {
  return statusFilter !== 'all'
    ? { limit: LIMIT, status: statusFilter as ConversationStatus }
    : { limit: LIMIT };
}

// ---------------------------------------------------------------------------
// STATUS_OPTIONS
// ---------------------------------------------------------------------------

describe('STATUS_OPTIONS', () => {
  it('a primeira opção é "all" (Todas) — filtro padrão do dropdown', () => {
    expect(STATUS_OPTIONS[0]?.value).toBe('all');
    expect(STATUS_OPTIONS[0]?.label).toBe('Todas');
  });

  it('ordem canônica: all, open, pending, resolved, snoozed', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'all',
      'open',
      'pending',
      'resolved',
      'snoozed',
    ]);
  });

  it('"Todas" usa a cor de marca var(--brand-azul) — não hex hardcoded', () => {
    expect(STATUS_OPTIONS[0]?.color).toBe('var(--brand-azul)');
  });

  it('getCount de "all" lê o total agregado', () => {
    const counts: ConversationCountsResponse = {
      open: 3,
      pending: 1,
      resolved: 5,
      snoozed: 0,
      total: 9,
    };
    expect(STATUS_OPTIONS[0]?.getCount(counts)).toBe(9);
  });

  it('getCount de cada status lê o campo correspondente das contagens', () => {
    const counts: ConversationCountsResponse = {
      open: 3,
      pending: 1,
      resolved: 5,
      snoozed: 2,
      total: 11,
    };
    const byValue = new Map(STATUS_OPTIONS.map((o) => [o.value, o]));

    expect(byValue.get('open')?.getCount(counts)).toBe(3);
    expect(byValue.get('pending')?.getCount(counts)).toBe(1);
    expect(byValue.get('resolved')?.getCount(counts)).toBe(5);
    expect(byValue.get('snoozed')?.getCount(counts)).toBe(2);
  });

  it('getCount retorna undefined quando counts ainda não carregou (pill oculta)', () => {
    expect(STATUS_OPTIONS[0]?.getCount(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toQueryParams — troca de status
// ---------------------------------------------------------------------------

describe('toQueryParams (troca de status → filtro da infinite query)', () => {
  it('"all" (padrão) NÃO envia status — backend retorna todos', () => {
    expect(toQueryParams('all')).toEqual({ limit: LIMIT });
  });

  it('trocar para "open" envia status=open', () => {
    expect(toQueryParams('open')).toEqual({ limit: LIMIT, status: 'open' });
  });

  it('trocar para "pending" envia status=pending', () => {
    expect(toQueryParams('pending')).toEqual({ limit: LIMIT, status: 'pending' });
  });

  it('trocar para "resolved" envia status=resolved', () => {
    expect(toQueryParams('resolved')).toEqual({ limit: LIMIT, status: 'resolved' });
  });

  it('trocar para "snoozed" envia status=snoozed', () => {
    expect(toQueryParams('snoozed')).toEqual({ limit: LIMIT, status: 'snoozed' });
  });

  it('cada status gera params distintos entre si (queryKey isolada por status)', () => {
    const all = toQueryParams('all');
    const open = toQueryParams('open');
    const pending = toQueryParams('pending');
    expect(all).not.toEqual(open);
    expect(open).not.toEqual(pending);
  });
});
