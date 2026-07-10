// =============================================================================
// useAssistantQuery.test.ts — Testes unitários do copiloto interno (F6-S09).
//
// Estratégia: espelha useFeatureFlag.test.ts — testa a lógica pura exportada
// pelo hook (classifyAssistantError, constantes) sem montar React/TanStack
// Query (sem @testing-library/react no projeto). A integração do useMutation
// em si é validada manualmente + pelos testes de integração do backend
// (apps/api/src/modules/internal-assistant/__tests__).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';
import {
  ASSISTANT_QUESTION_MAX_LENGTH,
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantError,
} from '../useAssistantQuery';

describe('constantes do contrato', () => {
  it('ASSISTANT_QUESTION_MAX_LENGTH espelha AssistantQueryBodySchema (backend)', () => {
    expect(ASSISTANT_QUESTION_MAX_LENGTH).toBe(2000);
  });

  it('ASSISTANT_TIMEOUT_MS dá folga sobre o timeout do grafo LangGraph (~25s)', () => {
    expect(ASSISTANT_TIMEOUT_MS).toBeGreaterThan(25_000);
  });
});

describe('classifyAssistantError', () => {
  it('AbortError (timeout do client) → kind timeout com mensagem graciosa', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('timeout');
    expect(result.message).toMatch(/demorou/i);
  });

  it('ApiError 401 → kind unauthorized', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'no token');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toMatch(/sessão/i);
  });

  it('ApiError 403 → kind forbidden (sem permissão ou flag off)', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'no perm');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('forbidden');
    expect(result.message).toMatch(/permissão/i);
  });

  it('ApiError 400 → kind invalid (pergunta fora do schema)', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'bad body');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('invalid');
  });

  it('ApiError 429 → kind rate_limited (20 req/min da rota)', () => {
    const err = new ApiError(429, 'RATE_LIMITED', 'too many');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('rate_limited');
    expect(result.message).toMatch(/aguarde/i);
  });

  it('ApiError 500 → kind server', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'boom');
    const result = classifyAssistantError(err);
    expect(result.kind).toBe('server');
  });

  it('erro desconhecido (falha de rede) → kind network', () => {
    const result = classifyAssistantError(new TypeError('Failed to fetch'));
    expect(result.kind).toBe('network');
  });
});
