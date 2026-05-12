// =============================================================================
// lib/crypto/pii.ts — Helpers de criptografia para PII (LGPD doc 17 §8.1).
//
// Decisão de design — sem `piiText` custom column Drizzle:
//   Drizzle ORM não suporta transformers async em colunas customizadas.
//   A alternativa `mapFromDriverValue`/`mapToDriverValue` é síncrona, o que
//   tornaria obrigatório o uso de `crypto.createCipheriv` de forma síncrona
//   (possível, mas gera bloqueio de event loop em inserts de alta frequência).
//   Optamos por manter `bytea` direto no schema Drizzle e expor as funções
//   `encryptPii` / `decryptPii` / `hashDocument` na service layer.
//   Isso é mais explícito, auditável e seguro (sem "magia" em coluna).
//
// Primitivas:
//   - AES-256-GCM para encrypt/decrypt: IV aleatório de 12 bytes prefixado
//     ao ciphertext para garantir que cada cifrado seja único.
//   - HMAC-SHA256 para hashDocument: determinístico, salted com pepper.
//
// Chaves:
//   - LGPD_DATA_KEY    : base64 de 32 bytes (256 bits) para AES-256-GCM.
//   - LGPD_DEDUPE_PEPPER: base64 ≥32 bytes para o HMAC.
//
// Em NODE_ENV=production a ausência de qualquer chave causa falha no import.
// Em dev/test as variáveis são opcionais com valor de fallback fixo e explícito
// (NUNCA use os valores de fallback para dados reais).
// =============================================================================
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// -----------------------------------------------------------------------------
// Constantes de algoritmo
// -----------------------------------------------------------------------------
const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12; // bytes — recomendação NIST para GCM
const AUTH_TAG_LENGTH = 16; // bytes — 128 bits
const KEY_LENGTH = 32; // bytes — AES-256

// -----------------------------------------------------------------------------
// Resolução de chaves com validação de boot
// -----------------------------------------------------------------------------

function resolveDataKey(): Buffer {
  const raw = process.env['LGPD_DATA_KEY'];

  if (!raw || raw.length === 0) {
    if (process.env['NODE_ENV'] === 'production') {
      // Falha imediata em produção — sem chave = sem proteção de PII.
      throw new Error(
        '[LGPD] LGPD_DATA_KEY ausente em NODE_ENV=production. ' +
          'Gere uma chave com: openssl rand -base64 32',
      );
    }
    // Dev/test: avisa claramente que está usando fallback inseguro.
    process.stderr.write(
      '[LGPD WARNING] LGPD_DATA_KEY não definida — usando fallback de dev. ' +
        'NUNCA use em produção.\n',
    );
    // 32 bytes fixos para dev — derivado de uma string conhecida para facilitar
    // testes deterministicos sem alterar a chave de cada run.
    return Buffer.from('dev-only-lgpd-key-do-not-use-prod', 'utf8').subarray(0, KEY_LENGTH);
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `[LGPD] LGPD_DATA_KEY precisa ser 32 bytes em base64 (got ${key.length} bytes). ` +
        'Gere com: openssl rand -base64 32',
    );
  }
  return key;
}

function resolvePepper(): Buffer {
  const raw = process.env['LGPD_DEDUPE_PEPPER'];

  if (!raw || raw.length === 0) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        '[LGPD] LGPD_DEDUPE_PEPPER ausente em NODE_ENV=production. ' +
          'Gere uma chave com: openssl rand -base64 32',
      );
    }
    process.stderr.write(
      '[LGPD WARNING] LGPD_DEDUPE_PEPPER não definida — usando fallback de dev. ' +
        'NUNCA use em produção.\n',
    );
    return Buffer.from('dev-only-lgpd-pepper-do-not-use-prod', 'utf8');
  }

  return Buffer.from(raw, 'base64');
}

// Resolvidas uma vez no import do módulo — falha de boot rápida.
const DATA_KEY: Buffer = resolveDataKey();
const DEDUPE_PEPPER: Buffer = resolvePepper();

// Exposto apenas para testes de falha de boot — não use em produção.
export const _testOnly = {
  resolveDataKey,
  resolvePepper,
} as const;

// -----------------------------------------------------------------------------
// encryptPii
// -----------------------------------------------------------------------------

/**
 * Cifra uma string de PII com AES-256-GCM.
 *
 * Formato do output (bytes):
 *   [ IV (12 bytes) | AUTH_TAG (16 bytes) | ciphertext (N bytes) ]
 *
 * O IV é gerado aleatoriamente por chamada — jamais reutilize o mesmo IV
 * com a mesma chave. GCM garante autenticidade além de confidencialidade.
 *
 * @param plain - Texto em claro a ser cifrado (ex: CPF, TOTP secret).
 * @returns Buffer com IV + auth tag + ciphertext.
 */
export async function encryptPii(plain: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, DATA_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: IV | AUTH_TAG | ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

// -----------------------------------------------------------------------------
// decryptPii
// -----------------------------------------------------------------------------

/**
 * Decifra um buffer produzido por `encryptPii`.
 *
 * Espera o layout: [ IV (12 bytes) | AUTH_TAG (16 bytes) | ciphertext ]
 * Falha com erro claro se o buffer for menor que o mínimo esperado ou se
 * a autenticação (auth tag) falhar (dados corrompidos ou chave errada).
 *
 * @param cipher - Buffer com IV + auth tag + ciphertext.
 * @returns String em claro original.
 */
export async function decryptPii(cipher: Uint8Array): Promise<string> {
  const MIN_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH + 1; // pelo menos 1 byte de ciphertext

  if (cipher.length < MIN_LENGTH) {
    throw new Error(
      `[LGPD] decryptPii: buffer inválido — tamanho ${cipher.length} menor que mínimo ${MIN_LENGTH}.`,
    );
  }

  const buf = Buffer.from(cipher);
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, DATA_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error(
      '[LGPD] decryptPii: falha na autenticação GCM — dados corrompidos ou chave incorreta.',
    );
  }
}

// -----------------------------------------------------------------------------
// hashDocument
// -----------------------------------------------------------------------------

/**
 * Gera um hash HMAC-SHA256 determinístico para dedupe de CPF/CNPJ.
 *
 * Propósito: permitir buscar por documento sem armazenar o plaintext.
 * O mesmo input + mesmo pepper sempre gera o mesmo hash (necessário para
 * lookup por CPF), mas sem o pepper não é reversível nem previsível.
 *
 * Importante: não usar `hashDocument` como armazenamento de senha — use
 * bcrypt para isso. O HMAC é adequado para dedupe/busca, não para auth.
 *
 * @param plain - Documento em claro (CPF, CNPJ, etc.) — normalizar antes.
 * @returns Hex string de 64 chars (HMAC-SHA256).
 */
export function hashDocument(plain: string): string {
  return createHmac('sha256', DEDUPE_PEPPER).update(plain, 'utf8').digest('hex');
}

// -----------------------------------------------------------------------------
// compareHash — helper seguro para comparação de hashes (timing-safe)
// -----------------------------------------------------------------------------

/**
 * Compara dois hashes hex de forma timing-safe.
 * Evita timing attacks em comparações de CPF hash.
 */
export function compareHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
