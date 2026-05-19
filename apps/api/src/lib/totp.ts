// =============================================================================
// lib/totp.ts — Helpers TOTP (RFC 6238) e geração de recovery codes (F8-S11).
//
// Usa a biblioteca `otpauth` (ESM-first, zero dependências externas além de
// Web Crypto — disponível em Node 20+).
//
// Decisões de design:
//   - Janela de tolerância: ±1 step (30 s) → cobre drift de relógio razoável.
//   - Secret gerado com randomBytes (256 bits → base32 ~52 chars) — seguro
//     contra ataques de força bruta mesmo com janela de tolerância alargada.
//   - Recovery codes: 10 × 10 chars alfanuméricos (A-Z 2-9) — ~47 bits de
//     entropia por código; suficiente contra força bruta com rate limiting.
//   - Recovery codes armazenados como hash bcrypt (cost 10 — menor que senhas
//     por volume, mas resistente a força bruta offline).
//   - Challenge token do login: HMAC-SHA256 do UUID — token bruto vai ao
//     frontend, hash fica no banco.
//
// LGPD (doc 17):
//   - Nunca logar o secret TOTP nem os recovery codes em plaintext.
//   - Funções aqui não acessam DB — apenas operações puras / crypto.
// =============================================================================

import { createHmac, randomBytes } from 'node:crypto';

import bcryptjs from 'bcryptjs';
import { TOTP } from 'otpauth';

import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Nome do emissor no QR code — app autenticador exibe "Elemento / <email>" */
export const TOTP_ISSUER = 'Elemento – Banco do Povo';

/** Período do TOTP em segundos (RFC 6238 padrão) */
const TOTP_PERIOD = 30;

/** Dígitos do código TOTP */
const TOTP_DIGITS = 6;

/** Algoritmo HMAC do TOTP */
const TOTP_ALGORITHM = 'SHA1';

/** Janela de tolerância: ±1 step (acomoda drift de relógio de até 30 s) */
const TOTP_WINDOW = 1;

/** Número de recovery codes gerados na ativação */
export const RECOVERY_CODE_COUNT = 10;

/** TTL do challenge token de 2FA (5 minutos em ms) */
export const TOTP_CHALLENGE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Geração de secret
// ---------------------------------------------------------------------------

/**
 * Gera um novo secret TOTP aleatório (256 bits → base32).
 * Retorna a string base32 — para armazenar, cifrar com encryptPii().
 */
export function generateTotpSecret(): string {
  // 32 bytes = 256 bits — bem acima do mínimo de 80 bits recomendado pelo RFC 4226
  const raw = randomBytes(32);
  return base32Encode(raw);
}

/**
 * Codifica Buffer em base32 (RFC 4648, charset A-Z2-7).
 * Usado para gerar o secret no formato esperado por apps autenticadores.
 */
function base32Encode(buffer: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

// ---------------------------------------------------------------------------
// Geração do URI otpauth (para QR code)
// ---------------------------------------------------------------------------

/**
 * Gera o URI `otpauth://totp/...` compatível com Google Authenticator,
 * Authy, 1Password etc.
 *
 * @param secret - Secret base32 (saída de generateTotpSecret).
 * @param email  - Email do usuário — identifica a entrada no app autenticador.
 * @returns URI otpauth completo para ser encodado em QR code.
 */
export function generateOtpauthUri(secret: string, email: string): string {
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  return totp.toString();
}

// ---------------------------------------------------------------------------
// Verificação de código TOTP
// ---------------------------------------------------------------------------

/**
 * Verifica se o código TOTP fornecido é válido para o secret dado.
 *
 * Janela de ±1 step (30 s antes / depois) para tolerar drift de relógio.
 *
 * @param secret - Secret base32 em texto claro (decifrado da coluna users.totp_secret).
 * @param code   - Código de 6 dígitos fornecido pelo usuário.
 * @returns true se válido, false caso contrário.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret,
    });

    // validate retorna o delta (inteiro) se válido, null se inválido
    const delta = totp.validate({ token: code, window: TOTP_WINDOW });
    return delta !== null;
  } catch {
    // Secret inválido ou código malformado
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/** Charset para recovery codes: A-Z sem I, O, 0, 1 (evita confusão visual) */
const RECOVERY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Gera N recovery codes aleatórios de 10 chars.
 * Formato: XXXXX-XXXXX (2 grupos de 5, separados por hífen — para display).
 *
 * Retorna o plaintext — exibir ao usuário UMA ÚNICA VEZ.
 * Armazenar apenas os hashes bcrypt (hashRecoveryCodes).
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(10);
    let code = '';
    for (let j = 0; j < 10; j++) {
      // Usa módulo para mapear byte para charset (leve viés aceitável para recovery codes)
      code += RECOVERY_CHARSET[raw[j]! % RECOVERY_CHARSET.length];
    }
    // Formatar como XXXXX-XXXXX para legibilidade
    codes.push(`${code.slice(0, 5)}-${code.slice(5, 10)}`);
  }
  return codes;
}

/**
 * Hasheia um array de recovery codes com bcrypt cost 10.
 * Retorna array de hashes (mesma ordem dos plaintext codes).
 *
 * LGPD: nunca armazenar codes em plaintext.
 * Custo 10 é menor que senhas (12) — aceitável pois recovery codes são
 * usados raramente e o rate limiting mitiga força bruta offline.
 */
export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcryptjs.hash(code, 10)));
}

/**
 * Verifica se um código fornecido corresponde a algum hash de recovery code.
 * Retorna o índice do hash que casou (para marcar como usado), ou -1 se nenhum.
 *
 * Normaliza a entrada: remove hífens e converte para uppercase.
 * Comparação timing-safe via bcrypt.compare (resistance ao timing attack).
 */
export async function matchRecoveryCode(inputCode: string, hashes: string[]): Promise<number> {
  // Normalizar: remover hífen, uppercase
  const normalized = inputCode.replace(/-/g, '').toUpperCase();
  // Recolocar o hífen para comparar com o formato armazenado (XXXXX-XXXXX)
  const formatted =
    normalized.length === 10
      ? `${normalized.slice(0, 5)}-${normalized.slice(5, 10)}`
      : inputCode.toUpperCase();

  // Verificar cada hash em paralelo — bcrypt.compare é timing-safe internamente
  const results = await Promise.all(
    hashes.map((hash, i) => bcryptjs.compare(formatted, hash).then((ok) => (ok ? i : -1))),
  );

  return results.find((r) => r !== -1) ?? -1;
}

// ---------------------------------------------------------------------------
// Challenge token (passo de 2FA no login)
// ---------------------------------------------------------------------------

/**
 * Gera um challenge token aleatório (UUID) e seu hash HMAC-SHA256.
 *
 * O token vai para o frontend (campo `challenge_token` na resposta de login).
 * O hash fica no banco (totp_challenges.token_hash).
 *
 * @returns { token, tokenHash }
 */
export function generateChallengeToken(): { token: string; tokenHash: string } {
  const token = crypto.randomUUID();
  const tokenHash = hashChallengeToken(token);
  return { token, tokenHash };
}

/**
 * Gera o HMAC-SHA256 de um challenge token.
 *
 * Usa env.LGPD_DEDUPE_PEPPER como chave HMAC — validado pelo schema Zod ao boot
 * (obrigatório, mínimo 32 chars). Sem fallback de dev: um boot sem a variável
 * falha imediatamente no parse do schema, impedindo silenciosamente o uso de
 * um segredo fraco em produção.
 */
export function hashChallengeToken(token: string): string {
  const key = Buffer.from(env.LGPD_DEDUPE_PEPPER, 'base64');
  return createHmac('sha256', key).update(token, 'utf8').digest('hex');
}
