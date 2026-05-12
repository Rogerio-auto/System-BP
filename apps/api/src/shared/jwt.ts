// =============================================================================
// jwt.ts — Helpers de assinar/verificar JWT com jose.
//
// Access token: HS256, TTL 15min (configurável via JWT_ACCESS_TTL).
// Refresh token: HS256, TTL 7 dias (configurável via JWT_REFRESH_TTL) — armazenado
//   apenas como hash SHA-256 no banco (user_sessions.refresh_token_hash).
//
// Payload do access token inclui sub (user_id), org (organization_id),
//   e jti (session_id) para rastreabilidade e revogação futura.
//
// Nota: jose usa TextEncoder/Buffer internamente — compatível com Node.js ESM strict.
// =============================================================================
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { env } from '../config/env.js';

import { UnauthorizedError } from './errors.js';

// ---------------------------------------------------------------------------
// Payload tipado
// ---------------------------------------------------------------------------

export interface AccessTokenPayload extends JWTPayload {
  /** user_id (UUID) */
  sub: string;
  /** organization_id (UUID) */
  org: string;
  /** session_id (UUID) — identifica a sessão de refresh vinculada */
  jti: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Converte duração estilo "15m", "7d", "30d" para segundos.
 * Suporta sufixos: s (segundos), m (minutos), h (horas), d (dias).
 */
export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`TTL inválido: "${ttl}". Use formato "15m", "7d", etc.`);
  }
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  // `as` justificado: unit já foi validado pelo regex — é sempre uma das 4 chaves
  return value * (multipliers[unit] as number);
}

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

/**
 * Assina um access token JWT com payload tipado.
 * Expira em JWT_ACCESS_TTL (padrão: 15m).
 */
export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
): Promise<string> {
  const secret = encodeSecret(env.JWT_ACCESS_SECRET);
  const ttlSeconds = parseTtlToSeconds(env.JWT_ACCESS_TTL);

  return new SignJWT({ org: payload.org })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

/**
 * Verifica e decodifica um access token.
 * Lança UnauthorizedError se inválido/expirado.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const secret = encodeSecret(env.JWT_ACCESS_SECRET);
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    // Validação de shape após verificação criptográfica
    if (!payload.sub || typeof payload['org'] !== 'string' || !payload.jti) {
      throw new UnauthorizedError('Token com payload inválido');
    }
    return payload as AccessTokenPayload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Token inválido ou expirado');
  }
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

/**
 * Gera um refresh token JWT opaco (payload mínimo).
 * O token em claro é enviado ao cliente — apenas o hash é persistido no banco.
 * Expira em JWT_REFRESH_TTL (padrão: 7d).
 */
export async function signRefreshToken(payload: { sub: string; jti: string }): Promise<string> {
  const secret = encodeSecret(env.JWT_REFRESH_SECRET);
  const ttlSeconds = parseTtlToSeconds(env.JWT_REFRESH_TTL);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

/**
 * Verifica o refresh token.
 * Retorna sub (user_id) e jti (session_id) para lookup no banco.
 * Lança UnauthorizedError se inválido/expirado.
 */
export async function verifyRefreshToken(token: string): Promise<{ sub: string; jti: string }> {
  const secret = encodeSecret(env.JWT_REFRESH_SECRET);
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || !payload.jti) {
      throw new UnauthorizedError('Refresh token com payload inválido');
    }
    return { sub: payload.sub, jti: payload.jti };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Refresh token inválido ou expirado');
  }
}

// ---------------------------------------------------------------------------
// Hash SHA-256 para persistência do refresh token
// ---------------------------------------------------------------------------

/**
 * Gera SHA-256 hex do token em claro para armazenar no banco.
 * Usar Web Crypto API (disponível em Node 20+, sem dep extra).
 */
export async function hashRefreshToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hashBuffer).toString('hex');
}
