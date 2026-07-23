// =============================================================================
// features/quick-replies/admin/__tests__/variableHint.test.ts — doc 25 §6.1.
// =============================================================================
import { describe, expect, it } from 'vitest';

import { computeQuickReplyVariableHint } from '../variableHint';

describe('computeQuickReplyVariableHint', () => {
  it('corpo vazio: sem hint', () => {
    expect(computeQuickReplyVariableHint('')).toBeNull();
    expect(computeQuickReplyVariableHint('   ')).toBeNull();
  });

  it('corpo sem variáveis: sem hint', () => {
    expect(computeQuickReplyVariableHint('Olá, tudo bem?')).toBeNull();
  });

  it('variável do catálogo com fallback (quando exigido): sem hint', () => {
    expect(
      computeQuickReplyVariableHint('Olá {{contato.primeiro_nome|tudo bem}}, aqui é a equipe.'),
    ).toBeNull();
  });

  it('variável sem fallback obrigatório (contato.*): hint QUICK_REPLY_MISSING_FALLBACK', () => {
    const hint = computeQuickReplyVariableHint('Olá {{contato.nome}}!');
    expect(hint?.code).toBe('QUICK_REPLY_MISSING_FALLBACK');
    expect(hint?.message).toContain('fallback');
  });

  it('variável fora do catálogo: hint QUICK_REPLY_UNKNOWN_VARIABLE', () => {
    const hint = computeQuickReplyVariableHint('Seu CPF é {{contato.cpf}}.');
    expect(hint?.code).toBe('QUICK_REPLY_UNKNOWN_VARIABLE');
  });

  it('variável que não exige fallback (ex: saudacao) nunca exige fallback', () => {
    expect(computeQuickReplyVariableHint('{{saudacao}}, tudo bem?')).toBeNull();
  });
});
