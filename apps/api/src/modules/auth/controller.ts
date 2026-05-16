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
//
// `path` é configurado por cookie:
//   refresh_token → /api/auth (só enviado em endpoints de auth, reduz exposição)
//   csrf_token    → /         (precisa estar visível ao JS de qualquer rota
//                              para o interceptor refresh injetar X-CSRF-Token)
function refreshCookieOptions(isProduction: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: maxAgeSeconds,
  };
}

function csrfCookieOptions(isProduction: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict' as const,
    // Path raiz: document.cookie precisa enxergar o csrf_token em qualquer
    // página do SPA (refresh é disparado de qualquer rota via interceptor 401).
    path: '/',
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

  // refresh_token: httpOnly, path=/api/auth — não acessível via JS
  reply.setCookie(
    REFRESH_COOKIE,
    result.refreshToken,
    refreshCookieOptions(isProduction, result.refreshExpiresIn),
  );

  // csrf_token: visível ao JS, path=/ (lido pelo interceptor de refresh)
  reply.setCookie(
    CSRF_COOKIE,
    result.sessionId,
    csrfCookieOptions(isProduction, result.refreshExpiresIn),
  );

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

  reply.setCookie(
    REFRESH_COOKIE,
    result.refreshToken,
    refreshCookieOptions(isProduction, result.refreshExpiresIn),
  );

  reply.setCookie(
    CSRF_COOKIE,
    result.sessionId,
    csrfCookieOptions(isProduction, result.refreshExpiresIn),
  );

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

  // Limpar cookies independentemente de haver sessão válida.
  // O path do clear DEVE bater com o path de criação — senão o browser
  // não associa o Set-Cookie de expiração ao cookie original.
  const baseClear = {
    secure: isProduction,
    sameSite: 'strict' as const,
    maxAge: 0,
    expires: new Date(0),
  };

  reply.setCookie(REFRESH_COOKIE, '', { ...baseClear, httpOnly: true, path: '/api/auth' });
  reply.setCookie(CSRF_COOKIE, '', { ...baseClear, httpOnly: false, path: '/' });

  return reply.status(204).send();
}
