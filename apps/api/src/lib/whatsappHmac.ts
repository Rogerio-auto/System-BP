// =============================================================================
// lib/whatsappHmac.ts — Validação de assinatura HMAC-SHA256 para webhooks Meta.
//
// A Cloud API Meta envia o header `X-Hub-Signature-256: sha256=<hex>` em cada
// requisição POST de webhook. Este helper valida a assinatura usando o
// `WHATSAPP_APP_SECRET` configurado no painel Meta Business.
//
// Segurança:
//   - Comparação em tempo constante via `crypto.timingSafeEqual` para prevenir
//     timing attacks (um atacante não pode inferir se a assinatura está "quase"
//     correta medindo o tempo de resposta).
//   - Retorna `false` (não lança) para permitir que o caller emita 401 com log.
//
// Referência: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
// =============================================================================
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida o header `X-Hub-Signature-256` de um webhook Meta/WhatsApp.
 *
 * @param rawBody  Buffer com o corpo bruto da requisição (antes de parse JSON).
 * @param secret   Valor de `WHATSAPP_APP_SECRET` (string, min 16 chars).
 * @param header   Valor do header `X-Hub-Signature-256` recebido (ex: "sha256=abc123…").
 * @returns        `true` se a assinatura é válida; `false` caso contrário.
 */
export function verifyWhatsappSignature(
  rawBody: Buffer,
  secret: string,
  header: string | undefined,
): boolean {
  // Header ausente → inválido
  if (header === undefined || header === '') {
    return false;
  }

  // Formato esperado: "sha256=<64 hex chars>"
  const PREFIX = 'sha256=';
  if (!header.startsWith(PREFIX)) {
    return false;
  }

  const receivedHex = header.slice(PREFIX.length);

  // Hex deve ter exatamente 64 chars (256 bits / 4 bits por char)
  if (receivedHex.length !== 64) {
    return false;
  }

  // Calcular HMAC-SHA256 esperado
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Comparação em tempo constante — previne timing attacks
  // Buffer.from com 'hex' é seguro para comprimentos iguais verificados acima.
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // timingSafeEqual requer buffers do mesmo tamanho — já garantido pelos 64 chars.
  return timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Gera o hash SHA-256 (hex) de um Buffer.
 * Usado para preencher `idempotency_keys.request_hash`.
 *
 * @param body  Buffer com o corpo bruto da requisição.
 * @returns     Hex string de 64 chars.
 */
export function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
