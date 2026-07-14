// =============================================================================
// useEscalateLead.test.ts — Testes unitários da escalação humana ao Crédito
// (F6-S31). Espelha useAssistantQuery.test.ts: testa a função pura
// classifyEscalateError sem montar React/TanStack Query (sem
// @testing-library/react no projeto).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';
import { classifyEscalateError, ESCALATE_NOTE_MAX_LENGTH } from '../useEscalateLead';

describe('constantes do contrato', () => {
  it('ESCALATE_NOTE_MAX_LENGTH espelha EscalateLeadRequestSchema.note (backend)', () => {
    expect(ESCALATE_NOTE_MAX_LENGTH).toBe(1000);
  });
});

describe('classifyEscalateError', () => {
  it('ApiError 401 → kind unauthorized', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'no token');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toMatch(/sessão/i);
  });

  it('ApiError 403 → kind forbidden (sem permissão assistant:escalate)', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'no perm');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('forbidden');
    expect(result.message).toMatch(/permissão/i);
  });

  it('ApiError 404 → kind not_found (lead fora do escopo de cidade) sem insinuar existência', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'lead not found');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('not_found');
    expect(result.message).toBe('Lead não encontrado.');
    expect(result.message).not.toMatch(/escopo|cidade/i);
  });

  it('ApiError 409 → kind no_recipients (Departamento de Crédito não configurado)', () => {
    const err = new ApiError(409, 'CONFLICT', 'no recipients');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('no_recipients');
    expect(result.message).toMatch(/departamento de crédito/i);
    expect(result.message).toMatch(/administrador/i);
  });

  it('ApiError 400 → kind invalid', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'bad body');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('invalid');
  });

  it('ApiError 429 → kind rate_limited', () => {
    const err = new ApiError(429, 'RATE_LIMITED', 'too many');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('rate_limited');
    expect(result.message).toMatch(/aguarde/i);
  });

  it('ApiError 500 → kind server', () => {
    const err = new ApiError(500, 'INTERNAL_ERROR', 'boom');
    const result = classifyEscalateError(err);
    expect(result.kind).toBe('server');
  });

  it('erro desconhecido (falha de rede) → kind network', () => {
    const result = classifyEscalateError(new TypeError('Failed to fetch'));
    expect(result.kind).toBe('network');
  });
});
