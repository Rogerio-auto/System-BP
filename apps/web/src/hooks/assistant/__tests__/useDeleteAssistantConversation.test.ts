// =============================================================================
// useDeleteAssistantConversation.test.ts — Testes unitários da remoção
// (soft-delete) de conversa do histórico do copiloto interno (F6-S29).
// Espelha useEscalateLead.test.ts: testa a função pura
// classifyDeleteConversationError sem montar React/TanStack Query.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';
import { classifyDeleteConversationError } from '../useDeleteAssistantConversation';

describe('classifyDeleteConversationError', () => {
  it('ApiError 401 → kind unauthorized', () => {
    const result = classifyDeleteConversationError(new ApiError(401, 'UNAUTHORIZED', ''));
    expect(result.kind).toBe('unauthorized');
  });

  it('ApiError 403 → kind forbidden', () => {
    const result = classifyDeleteConversationError(new ApiError(403, 'FORBIDDEN', ''));
    expect(result.kind).toBe('forbidden');
  });

  it('ApiError 404 → kind not_found (já removida ou de outro usuário — mesma mensagem)', () => {
    const result = classifyDeleteConversationError(new ApiError(404, 'NOT_FOUND', ''));
    expect(result.kind).toBe('not_found');
  });

  it('ApiError 500 → kind server', () => {
    const result = classifyDeleteConversationError(new ApiError(500, 'INTERNAL_ERROR', ''));
    expect(result.kind).toBe('server');
  });

  it('erro desconhecido (falha de rede) → kind network', () => {
    const result = classifyDeleteConversationError(new TypeError('Failed to fetch'));
    expect(result.kind).toBe('network');
  });
});
