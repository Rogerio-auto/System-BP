// =============================================================================
// integrations/channels/shared/hmac.ts — Verificação HMAC-SHA256 por-canal.
//
// Diferença crítica em relação ao `lib/whatsappHmac.ts` (legado):
//   - O legado usa um único `WHATSAPP_APP_SECRET` global (modelo Tech-Provider).
//   - Este módulo resolve o `app_secret` **por canal/app** via callback assíncrono
//     (modelo app-por-cliente, planejamento §5.3).
//
// Fluxo:
//   1. Webhook recebe o envelope.
//   2. O dispatcher extrai `entry[].id` (= WABA id) do envelope.
//   3. `verifyMetaSignature` é chamado com o `rawBody`, o header, e um callback
//      `resolveSecret` que busca o `app_secret` decifrado de `channel_secrets`
//      pelo `waba_id`/`app_id` do envelope.
//   4. O secret é usado para calcular o HMAC — comparação timing-safe.
//
// Segurança:
//   - `crypto.timingSafeEqual` — sem early-return por caractere (sem timing attack).
//   - Comprimento dos buffers verificado antes da comparação.
//   - `resolveSecret` é chamado UMA VEZ por verificação — sem cache aqui.
//   - Se `resolveSecret` retorna string vazia ou lança, retornamos false sem vazar
//     a razão para o caller (ele deve logar, mas emitir apenas 403 ao provider).
//
// Referência: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
// =============================================================================
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { SignatureError } from './errors.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const SIGNATURE_PREFIX = 'sha256=';
/** HMAC-SHA256 produz 32 bytes = 64 hex chars. */
const HEX_LENGTH = 64;

// ---------------------------------------------------------------------------
// verifyMetaSignature — verificação por-canal
// ---------------------------------------------------------------------------

/**
 * Verifica o header `X-Hub-Signature-256` de um webhook Meta usando o `app_secret`
 * resolvido dinamicamente por canal (modelo app-por-cliente, §5.3).
 *
 * O `resolveSecret` é um callback que o caller implementa para buscar o `app_secret`
 * decifrado do `channel_secrets` para o canal específico (por `waba_id`/`app_id`
 * extraído do envelope). Isso garante que cada Meta App tenha seu próprio secret.
 *
 * Comparação HMAC em tempo constante (`crypto.timingSafeEqual`) — sem timing attack.
 *
 * @param rawBody         Buffer com o corpo bruto da requisição (antes de parse JSON).
 * @param signatureHeader Valor do header `X-Hub-Signature-256` (ex: "sha256=abc123…").
 *                        `undefined` indica header ausente → retorna `false`.
 * @param resolveSecret   Callback assíncrono que retorna o `app_secret` em claro para
 *                        o canal. Se retornar string vazia ou lançar, retorna `false`.
 * @returns               `true` se assinatura válida; `false` caso contrário.
 *                        **Nunca lança** — o caller é responsável por emitir 403.
 */
export async function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  resolveSecret: () => Promise<string>,
): Promise<boolean> {
  // Passo 1: header presente?
  if (signatureHeader === undefined || signatureHeader === '') {
    return false;
  }

  // Passo 2: formato correto ("sha256=<64 hex chars>")?
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

  // O hex deve ter exatamente 64 chars (256 bits / 4 bits por char)
  if (receivedHex.length !== HEX_LENGTH) {
    return false;
  }

  // Passo 3: resolver o app_secret para o canal
  let secret: string;
  try {
    secret = await resolveSecret();
  } catch {
    // resolveSecret lançou (ex: canal não encontrado no DB) — tratar como inválido
    return false;
  }

  // Secret vazio/ausente — canal não tem app_secret configurado
  if (secret === '') {
    return false;
  }

  // Passo 4: calcular HMAC esperado
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Passo 5: comparação em tempo constante
  // Buffer.from('hex') é safe: comprimentos verificados acima (64 chars = 32 bytes).
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // timingSafeEqual requer buffers do MESMO tamanho — garantido pelas verificações acima.
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// verifyMetaSignatureOrThrow — variante que lança SignatureError
// ---------------------------------------------------------------------------

/**
 * Variante de `verifyMetaSignature` que lança `SignatureError` em vez de retornar `false`.
 * Útil no webhook handler quando se quer o motivo da falha para logging antes de 403.
 *
 * **Nunca** expor o motivo ao provider — apenas logar internamente e retornar 403 genérico.
 *
 * @param rawBody         Buffer com o corpo bruto da requisição.
 * @param signatureHeader Valor do header `X-Hub-Signature-256`.
 * @param resolveSecret   Callback que resolve o `app_secret` por canal.
 * @throws SignatureError  Com `reason` discriminando o motivo da falha.
 */
export async function verifyMetaSignatureOrThrow(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  resolveSecret: () => Promise<string>,
): Promise<void> {
  // Header ausente
  if (signatureHeader === undefined || signatureHeader === '') {
    throw new SignatureError(
      'Header X-Hub-Signature-256 ausente no webhook Meta',
      'missing_header',
    );
  }

  // Formato inválido
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    throw new SignatureError(
      `Formato de assinatura inválido: esperado "sha256=…", recebido "${signatureHeader.slice(0, 20)}…"`,
      'invalid_format',
    );
  }

  const receivedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (receivedHex.length !== HEX_LENGTH) {
    throw new SignatureError(
      `Assinatura com comprimento inválido: esperado ${HEX_LENGTH} chars hex, recebido ${receivedHex.length}`,
      'invalid_format',
    );
  }

  // Resolver secret
  let secret: string;
  try {
    secret = await resolveSecret();
  } catch {
    throw new SignatureError(
      'Não foi possível resolver o app_secret para o canal (canal não encontrado ou secret ausente)',
      'secret_unavailable',
    );
  }

  if (secret === '') {
    throw new SignatureError(
      'app_secret do canal está vazio — canal pode não ter sido configurado corretamente',
      'secret_unavailable',
    );
  }

  // Calcular e comparar (timing-safe)
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (!timingSafeEqual(receivedBuf, expectedBuf)) {
    throw new SignatureError(
      'HMAC-SHA256 do webhook Meta não corresponde ao app_secret do canal',
      'hmac_mismatch',
    );
  }
}

// ---------------------------------------------------------------------------
// sha256Hex — hash de conteúdo (utilitário interno)
// ---------------------------------------------------------------------------

/**
 * Gera o hash SHA-256 (hex) de um Buffer.
 * Usado para preencher `webhook_events.payload_hash` (dedup de eventos).
 *
 * @param body  Buffer com o corpo bruto.
 * @returns     Hex string de 64 chars.
 */
export function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
