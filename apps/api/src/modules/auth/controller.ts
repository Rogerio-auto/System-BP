// =============================================================================
// auth/controller.ts — Parsing de request/response e orquestração de cookies.
//
// Responsabilidades:
//   - Extrair dados do request (body, cookies, headers, IP)
//   - Chamar o service correto
//   - Setar/limpar cookies httpOnly (refresh_token, csrf_token)
//   - Montar e enviar resposta tipada
//
// Cookies:
//   refresh_token — httpOnly, Secure (prod), SameSite=Strict, Path=/api/auth
//   csrf_token    — NOT httpOnly (precisa ser lido pelo JS), Secure (prod), SameSite=Strict
//
// CSRF: Double Submit Cookie pattern — o jti do refresh token é o CSRF token.
//   No login/refresh: cookie csrf_token = sessionId.
//   No refresh: header X-CSRF-Token deve bater com o sessionId do refresh token.
// =============================================================================
import type { LoginBody, RefreshBody, LogoutBody } from '@elemento/shared-schemas';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';

import { login, logout, refresh } from './service.js';

// Nomes canônicos dos cookies
const REFRESH_COOKIE = 'refresh_token';
const CSRF_COOKIE = 'csrf_token';

// Opções base dos cookies — DRY
function cookieOptions(isProduction: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: false, // será sobrescrito por cada cookie
    secure: isProduction,
    sameSite: 'Strict' as const,
    path: '/api/auth',
    maxAge: maxAgeSeconds,
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

export async function loginController(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const ip = request.ip;
  const userAgent = request.headers['user-agent'] ?? null;

  const result = await login(
    db,
    { email: request.body.email, password: request.body.password, ip, userAgent },
    request.log,
  );

  const baseOpts = cookieOptions(isProduction, result.refreshExpiresIn);

  // refresh_token: httpOnly — não acessível via JS
  reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
    ...baseOpts,
    httpOnly: true,
  });

  // csrf_token: acessível via JS (necessário para envio no header X-CSRF-Token)
  reply.setCookie(CSRF_COOKIE, result.sessionId, {
    ...baseOpts,
    httpOnly: false,
  });

  return reply.status(200).send({
    access_token: result.accessToken,
    expires_in: result.expiresIn,
    user: {
      id: result.user.id,
      email: result.user.email,
      full_name: result.user.fullName,
      organization_id: result.user.organizationId,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

export async function refreshController(
  request: FastifyRequest<{ Body: RefreshBody }>,
  reply: FastifyReply,
): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const refreshToken = request.cookies[REFRESH_COOKIE];
  const csrfToken = request.headers['x-csrf-token'];

  if (!refreshToken) {
    throw new UnauthorizedError('Refresh token ausente');
  }
  if (typeof csrfToken !== 'string' || !csrfToken) {
    throw new UnauthorizedError('CSRF token ausente');
  }

  const ip = request.ip;
  const userAgent = request.headers['user-agent'] ?? null;

  const result = await refresh(db, { refreshToken, csrfToken, ip, userAgent }, request.log);

  const baseOpts = cookieOptions(isProduction, result.refreshExpiresIn);

  reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
    ...baseOpts,
    httpOnly: true,
  });

  reply.setCookie(CSRF_COOKIE, result.sessionId, {
    ...baseOpts,
    httpOnly: false,
  });

  return reply.status(200).send({
    access_token: result.accessToken,
    expires_in: result.expiresIn,
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

export async function logoutController(
  request: FastifyRequest<{ Body: LogoutBody }>,
  reply: FastifyReply,
): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const refreshToken = request.cookies[REFRESH_COOKIE];

  // userId virá do middleware authenticate (F1-S04).
  // Por ora, extrai do refresh token diretamente (service.ts aceita token inválido silenciosamente).
  // Quando F1-S04 estiver pronto, substituir por request.user.id.
  // `as` justificado: placeholder temporário até F1-S04 adicionar request.user ao tipo
  const userId = (request as FastifyRequest & { user?: { id: string } }).user?.id ?? 'unknown';

  if (refreshToken) {
    await logout(db, { refreshToken, userId }, request.log);
  }

  // Limpar cookies independentemente de haver sessão válida
  const clearOpts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict' as const,
    path: '/api/auth',
    maxAge: 0,
    expires: new Date(0),
  };

  reply.setCookie(REFRESH_COOKIE, '', clearOpts);
  reply.setCookie(CSRF_COOKIE, '', { ...clearOpts, httpOnly: false });

  return reply.status(204).send();
}
