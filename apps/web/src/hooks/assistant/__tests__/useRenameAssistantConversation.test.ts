// =============================================================================
// useRenameAssistantConversation.test.ts — Testes unitários do renomear de
// conversa do histórico do copiloto interno (F6-S29). Espelha
// useEscalateLead.test.ts: testa a função pura classifyRenameConversationError
// sem montar React/TanStack Query (sem @testing-library/react no projeto).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';
import {
  ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
  classifyRenameConversationError,
} from '../useRenameAssistantConversation';

describe('constantes do contrato', () => {
  it('ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH espelha RenameConversationBodySchema.title (backend)', () => {
    expect(ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH).toBe(200);
  });
});

describe('classifyRenameConversationError', () => {
  it('ApiError 401 → kind unauthorized', () => {
    const result = classifyRenameConversationError(new ApiError(401, 'UNAUTHORIZED', ''));
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toMatch(/sessão/i);
  });

  it('ApiError 403 → kind forbidden', () => {
    const result = classifyRenameConversationError(new ApiError(403, 'FORBIDDEN', ''));
    expect(result.kind).toBe('forbidden');
    expect(result.message).toMatch(/permissão/i);
  });

  it('ApiError 404 → kind not_found (owner-scoped, nunca insinua existência de outro dono)', () => {
    const result = classifyRenameConversationError(new ApiError(404, 'NOT_FOUND', ''));
    expect(result.kind).toBe('not_found');
    expect(result.message).not.toMatch(/outro usuário/i);
  });

  it('ApiError 400 → kind invalid, menciona o limite de caracteres', () => {
    const result = classifyRenameConversationError(new ApiError(400, 'VALIDATION_ERROR', ''));
    expect(result.kind).toBe('invalid');
    expect(result.message).toMatch(/200/);
  });

  it('ApiError 500 → kind server', () => {
    const result = classifyRenameConversationError(new ApiError(500, 'INTERNAL_ERROR', ''));
    expect(result.kind).toBe('server');
  });

  it('erro desconhecido (falha de rede) → kind network', () => {
    const result = classifyRenameConversationError(new TypeError('Failed to fetch'));
    expect(result.kind).toBe('network');
  });
});
