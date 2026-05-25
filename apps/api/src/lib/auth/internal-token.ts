// =============================================================================
// lib/auth/internal-token.ts — Verificação timing-safe do token interno M2M.
//
// Contexto (doc 10 §2.3, CLAUDE.md regra inviolável #1):
//   LangGraph acessa o backend exclusivamente via endpoints /internal/* com o
//   header X-Internal-Token. A comparação deve ser timing-safe para prevenir
//   ataques de timing oracle que revelam o comprimento ou conteúdo do token
//   através de diferenças de tempo de resposta.
//
// Estratégia:
//   1. Se os comprimentos diferem → sempre executa a comparação de qualquer
//      forma (usando o tamanho do `received`) para manter tempo constante,
//      mas retorna false.
//   2. crypto.timingSafeEqual compara byte a byte em tempo constante mesmo
//      quando os conteúdos diferem.
//
// Uso:
//   ```ts
//   const token = request.headers['x-internal-token'];
//   if (!verifyInternalToken(token, env.LANGGRAPH_INTERNAL_TOKEN)) {
//     throw new UnauthorizedError('Token interno inválido ou ausente');
//   }
//   ```
//
// Segurança (doc 14 §4.2):
//   - Nunca logar `received` — pode conter tokens parcialmente corretos.
//   - LANGGRAPH_INTERNAL_TOKEN deve ter ≥ 32 chars (envSchema valida).
//   - Rotacionar em cada deployment (secrets manager, não env.example).
// =============================================================================
import { timingSafeEqual } from 'node:crypto';

/**
 * Verifica se um token interno M2M recebido é igual ao token esperado,
 * usando comparação timing-safe para prevenir timing oracle attacks.
 *
 * @param received - Valor do header X-Internal-Token (pode ser string | string[] | undefined).
 *                   Valores não-string são rejeitados imediatamente como false.
 * @param expected - Token esperado (env.LANGGRAPH_INTERNAL_TOKEN).
 * @returns true se os tokens são idênticos; false caso contrário.
 */
export function verifyInternalToken(
  received: string | string[] | undefined,
  expected: string,
): boolean {
  // Rejeitar imediatamente valores não-string (undefined, array, etc.)
  // sem vazar informação sobre o comprimento do token esperado.
  if (typeof received !== 'string') {
    // Executar uma comparação dummy para manter tempo constante independente do
    // caminho de código. Isso previne ataques que medem a diferença entre
    // "token ausente" e "token presente mas inválido".
    // `as` justificado: Buffer.from(expected) é Buffer, compatível com Uint8Array
    // exigido por timingSafeEqual — conversão interna é segura.
    timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(expected, 'utf8'));
    return false;
  }

  const receivedBuf = Buffer.from(received, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // timingSafeEqual exige buffers do mesmo comprimento.
  // Se os comprimentos diferem, executamos a comparação com um buffer de mesmo
  // tamanho que `received` (nunca expõe o comprimento real de `expected`).
  if (receivedBuf.length !== expectedBuf.length) {
    // Comparação dummy de tempo constante — resultado ignorado, retorna false.
    // Usamos `received` vs. `received` para garantir comprimentos iguais.
    timingSafeEqual(receivedBuf, receivedBuf);
    return false;
  }

  return timingSafeEqual(receivedBuf, expectedBuf);
}
