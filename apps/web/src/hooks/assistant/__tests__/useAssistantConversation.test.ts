// =============================================================================
// useAssistantConversation.test.ts — Testes unitários da abertura de uma
// conversa salva do histórico do copiloto interno (F6-S28).
//
// Estratégia: espelha useAssistantQuery.test.ts — testa a lógica pura
// exportada pelo hook (isConversationNotFoundError, query key factory) sem
// montar React/TanStack Query (sem @testing-library/react no projeto).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';
import {
  assistantConversationKeys,
  isConversationNotFoundError,
} from '../useAssistantConversation';

describe('isConversationNotFoundError', () => {
  it('ApiError 404 → true (owner-scoped: inexistente, de outro usuário, ou removida)', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'conversa não encontrada');
    expect(isConversationNotFoundError(err)).toBe(true);
  });

  it('ApiError 401/403/500 → false (não é "conversa indisponível")', () => {
    expect(isConversationNotFoundError(new ApiError(401, 'UNAUTHORIZED', ''))).toBe(false);
    expect(isConversationNotFoundError(new ApiError(403, 'FORBIDDEN', ''))).toBe(false);
    expect(isConversationNotFoundError(new ApiError(500, 'INTERNAL_ERROR', ''))).toBe(false);
  });

  it('erro que não é ApiError (falha de rede) → false', () => {
    expect(isConversationNotFoundError(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('assistantConversationKeys', () => {
  it('detail(id) inclui o id da conversa — cache isolado por conversa', () => {
    expect(assistantConversationKeys.detail('abc')).toEqual(['assistant', 'conversations', 'abc']);
    expect(assistantConversationKeys.detail('abc')).not.toEqual(
      assistantConversationKeys.detail('xyz'),
    );
  });
});
