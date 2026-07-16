// =============================================================================
// features/conversations/__tests__/queries.test.ts — Testes das query keys (F16-S15).
//
// Valida:
//   - Estrutura canônica das query keys (para evitar colisões com outros domínios).
//   - Relacionamento hierárquico (all ⊃ list ⊃ detail / messages).
//   - Comportamento do getNextPageParam (paginação cursor-based para mensagens).
//
// Nota: não mockamos a API aqui — os testes de integração com queryFn ficam
// em testes E2E. Aqui validamos somente as keys e a lógica de paginação.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { conversationKeys, nextCursorParam } from '../queries';

describe('conversationKeys', () => {
  describe('all', () => {
    it('retorna raiz correta', () => {
      expect(conversationKeys.all).toEqual(['conversations']);
    });
  });

  describe('list', () => {
    it('inclui a raiz como prefixo', () => {
      const key = conversationKeys.list({});
      expect(key[0]).toBe('conversations');
      expect(key[1]).toBe('list');
    });

    it('inclui os params no key para diferenciação de cache', () => {
      const key1 = conversationKeys.list({ status: 'open' });
      const key2 = conversationKeys.list({ status: 'resolved' });

      expect(key1).not.toEqual(key2);
      expect(key1[2]).toMatchObject({ status: 'open' });
      expect(key2[2]).toMatchObject({ status: 'resolved' });
    });

    it('mesmos params geram mesmo key', () => {
      const params = { status: 'open' as const, limit: 50 };
      expect(conversationKeys.list(params)).toEqual(conversationKeys.list(params));
    });
  });

  describe('listInfinite (regressão: colisão flat×infinite)', () => {
    it('NÃO colide com a key flat list() para os mesmos params', () => {
      // Regressão: quando list() (shape flat {data,nextCursor}) e a infinite
      // query (shape {pages,pageParams}) compartilhavam a mesma key, o
      // InfiniteQueryObserver crashava em getNextPageParam ao ler uma entrada
      // flat legada. A key infinite DEVE ser distinta.
      const params = { status: 'open' as const, limit: 25 };
      expect(conversationKeys.listInfinite(params)).not.toEqual(conversationKeys.list(params));
    });

    it('mantém o prefixo ["conversations","list"] p/ setQueriesData/invalidate do realtime', () => {
      const key = conversationKeys.listInfinite({ status: 'open' });
      expect(key.slice(0, 2)).toEqual(['conversations', 'list']);
    });

    it('params diferentes geram keys diferentes (cache por status)', () => {
      const a = conversationKeys.listInfinite({ status: 'open' });
      const b = conversationKeys.listInfinite({ status: 'snoozed' });
      expect(a).not.toEqual(b);
    });
  });

  describe('detail', () => {
    it('inclui a raiz como prefixo', () => {
      const key = conversationKeys.detail('uuid-123');
      expect(key[0]).toBe('conversations');
      expect(key[1]).toBe('detail');
      expect(key[2]).toBe('uuid-123');
    });

    it('IDs diferentes geram keys diferentes', () => {
      const key1 = conversationKeys.detail('id-a');
      const key2 = conversationKeys.detail('id-b');
      expect(key1).not.toEqual(key2);
    });
  });

  describe('messages', () => {
    it('inclui conversationId e params', () => {
      const key = conversationKeys.messages('conv-123');
      expect(key[0]).toBe('conversations');
      expect(key[1]).toBe('messages');
      expect(key[2]).toBe('conv-123');
    });

    it('params opcionais padrão são objeto vazio', () => {
      const key = conversationKeys.messages('conv-abc');
      // Quarto elemento é o objeto de params (default = {})
      expect(key[3]).toEqual({});
    });

    it('params before diferencia as keys', () => {
      const key1 = conversationKeys.messages('conv-1', { before: 'cursor-x' });
      const key2 = conversationKeys.messages('conv-1', { before: 'cursor-y' });
      expect(key1).not.toEqual(key2);
    });

    it('mesmo conversationId e params geram mesmo key', () => {
      const params = { before: 'cursor-z', limit: 30 };
      expect(conversationKeys.messages('conv-1', params)).toEqual(
        conversationKeys.messages('conv-1', params),
      );
    });
  });

  describe('nextCursorParam (paginação — scroll infinito para no cursor null)', () => {
    it('retorna o nextCursor quando presente (há mais páginas)', () => {
      expect(nextCursorParam({ nextCursor: 'cursor-abc' })).toBe('cursor-abc');
    });

    it('retorna undefined quando nextCursor é null (getNextPageParam → hasNextPage=false)', () => {
      expect(nextCursorParam({ nextCursor: null })).toBeUndefined();
    });
  });

  describe('hierarquia de prefixos para invalidação', () => {
    it('all é prefixo de list', () => {
      const list = conversationKeys.list({ status: 'open' });
      // TanStack Query usa prefix match: todo key que começa com 'conversations' é invalidado
      expect(list.slice(0, conversationKeys.all.length)).toEqual([...conversationKeys.all]);
    });

    it('all é prefixo de detail', () => {
      const detail = conversationKeys.detail('id-1');
      expect(detail.slice(0, conversationKeys.all.length)).toEqual([...conversationKeys.all]);
    });

    it('all é prefixo de messages', () => {
      const msgs = conversationKeys.messages('conv-1');
      expect(msgs.slice(0, conversationKeys.all.length)).toEqual([...conversationKeys.all]);
    });
  });
});
