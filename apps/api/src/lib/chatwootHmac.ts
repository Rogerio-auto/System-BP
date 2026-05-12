// =============================================================================
// lib/chatwootHmac.ts — Validação de assinatura HMAC-SHA256 para webhooks Chatwoot.
//
// O Chatwoot envia o header `X-Chatwoot-Signature: <hex>` (sem prefixo "sha256=")
// em cada requisição POST de webhook, assinado com o shared secret configurado
// no painel Chatwoot → Settings → Integrations → Webhooks.
//
// Segurança:
//   - Comparação em tempo constante via `crypto.timingSafeEqual` para prevenir
//     timing attacks (um atacante não pode inferir se a assinatura está "quase"
//     correta medindo o tempo de resposta).
//   - Retorna `false` (não lança) para que o caller emita 401 com log.
//
// Referência: https://www.chatwoot.com/docs/product/others/webhooks
// =============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida o header `X-Chatwoot-Signature` de um webhook Chatwoot.
 *
 * O Chatwoot envia o HMAC-SHA256 do corpo JSON como hex string simples
 * (sem o prefixo "sha256=" que usa o Meta/WhatsApp).
 *
 * @param rawBody  Buffer com o corpo bruto da requisição (antes de parse JSON).
 * @param secret   Valor de `CHATWOOT_WEBHOOK_HMAC_SECRET` (string, min 8 chars).
 * @param header   Valor do header `X-Chatwoot-Signature` recebido (hex, 64 chars).
 * @returns        `true` se a assinatura é válida; `false` caso contrário.
 */
export function verifyChatwootSignature(
  rawBody: Buffer,
  secret: string,
  header: string | undefined,
): boolean {
  // Header ausente → inválido
  if (header === undefined || header === '') {
    return false;
  }

  // Hex deve ter exatamente 64 chars (256 bits / 4 bits por char)
  if (header.length !== 64) {
    return false;
  }

  // Verificar que é hex válido (apenas [0-9a-fA-F])
  if (!/^[0-9a-fA-F]{64}$/.test(header)) {
    return false;
  }

  // Calcular HMAC-SHA256 esperado
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Comparação em tempo constante — previne timing attacks
  // Buffer.from com 'hex' é seguro para comprimentos iguais verificados acima.
  const receivedBuf = Buffer.from(header, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // timingSafeEqual requer buffers do mesmo tamanho — garantido pelos 64 chars hex.
  return timingSafeEqual(receivedBuf, expectedBuf);
}
