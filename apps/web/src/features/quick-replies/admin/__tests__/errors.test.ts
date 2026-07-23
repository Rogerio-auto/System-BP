// =============================================================================
// features/quick-replies/admin/__tests__/errors.test.ts — Testes de
// mapQuickReplyMutationError (F28-S07, doc 25 §4.1 — 409 nunca é toast
// genérico; §12 — PII no corpo tratado no campo body).
// =============================================================================
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../../lib/api';
import { mapQuickReplyMutationError } from '../errors';

describe('mapQuickReplyMutationError', () => {
  it('409 (atalho duplicado) mapeia para o campo shortcut', () => {
    const err = new ApiError(
      409,
      'HTTP_ERROR',
      'O atalho "orientacao" já está em uso neste escopo',
    );
    const result = mapQuickReplyMutationError(err);
    expect(result).toEqual({ field: 'shortcut', message: err.message });
  });

  it('422 (PII no corpo) mapeia para o campo body', () => {
    const err = new ApiError(
      422,
      'HTTP_ERROR',
      'O corpo da resposta rápida não pode conter dado pessoal do cidadão (CPF, CNPJ, e-mail ou telefone)',
    );
    const result = mapQuickReplyMutationError(err);
    expect(result).toEqual({ field: 'body', message: err.message });
  });

  it('outros status (ex: 403, 500) retornam null — chamador trata como toast genérico', () => {
    expect(mapQuickReplyMutationError(new ApiError(403, 'FORBIDDEN', 'Acesso negado'))).toBeNull();
    expect(
      mapQuickReplyMutationError(new ApiError(500, 'INTERNAL_ERROR', 'Erro interno')),
    ).toBeNull();
  });

  it('erro que não é ApiError retorna null', () => {
    expect(mapQuickReplyMutationError(new Error('rede offline'))).toBeNull();
    expect(mapQuickReplyMutationError('string qualquer')).toBeNull();
    expect(mapQuickReplyMutationError(null)).toBeNull();
  });
});
