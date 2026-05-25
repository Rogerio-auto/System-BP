// =============================================================================
// __tests__/internal-token.test.ts — Testes unitários para verifyInternalToken.
//
// Cobre:
//   1. Token correto → true
//   2. Token errado → false
//   3. Token ausente (undefined) → false
//   4. Token como array (headers duplicados) → false
//   5. Token com comprimento diferente → false
//   6. Token vazio → false (comprimento diferente de token não-vazio)
// =============================================================================
import { describe, expect, it } from 'vitest';

import { verifyInternalToken } from '../internal-token.js';

const VALID_TOKEN = 'test-langgraph-token-vitest-only-00';

describe('verifyInternalToken', () => {
  it('retorna true para token correto', () => {
    expect(verifyInternalToken(VALID_TOKEN, VALID_TOKEN)).toBe(true);
  });

  it('retorna false para token incorreto com mesmo comprimento', () => {
    // Mesmo comprimento, conteúdo diferente — timingSafeEqual retorna false.
    const wrong = 'test-langgraph-token-vitest-only-XX';
    expect(wrong.length).toBe(VALID_TOKEN.length);
    expect(verifyInternalToken(wrong, VALID_TOKEN)).toBe(false);
  });

  it('retorna false para token incorreto com comprimento diferente (menor)', () => {
    expect(verifyInternalToken('curto', VALID_TOKEN)).toBe(false);
  });

  it('retorna false para token incorreto com comprimento diferente (maior)', () => {
    expect(verifyInternalToken(VALID_TOKEN + '-extra', VALID_TOKEN)).toBe(false);
  });

  it('retorna false para token ausente (undefined)', () => {
    expect(verifyInternalToken(undefined, VALID_TOKEN)).toBe(false);
  });

  it('retorna false para token como array (header duplicado)', () => {
    // Fastify/Node.js pode representar headers duplicados como string[].
    // `as unknown as string` para simular o tipo de runtime.
    expect(verifyInternalToken([VALID_TOKEN, VALID_TOKEN] as unknown as string, VALID_TOKEN)).toBe(
      false,
    );
  });

  it('retorna false para token vazio (string vazia)', () => {
    expect(verifyInternalToken('', VALID_TOKEN)).toBe(false);
  });

  it('retorna true para tokens iguais com caracteres especiais UTF-8', () => {
    const special = 'token-com-ção-espécial-32-chars-xyz';
    expect(verifyInternalToken(special, special)).toBe(true);
  });
});
