// =============================================================================
// authenticate.ts — Middleware Fastify de autenticação via JWT.
//
// Uso em rota:
//   preHandler: [authenticate()]
//
// Fluxo:
//   1. Extrai o Bearer token do header Authorization.
//   2. Verifica assinatura e expiração com verifyAccessToken() (jose/HS256).
//   3. Carrega permissões e escopos de cidade do banco (loadUserAuthContext).
//   4. Popula request.user com contexto tipado.
//
// Falhas:
//   - Header ausente / formato inválido → 401 UnauthorizedError
//   - Token inválido / expirado → 401 UnauthorizedError
//   - Usuário inativo ou deletado → 401 UnauthorizedError
//
// Audit: toda falha loga `event: 'authn.failed'` via Pino estruturado.
//
// Design: factory `authenticate()` em vez de handler direto para consistência
// com `authorize()` e para permitir configuração futura (ex: skip em dev).
// =============================================================================
import type { preHandlerHookHandler } from 'fastify';

import { db } from '../../../db/client.js';
import { UnauthorizedError } from '../../../shared/errors.js';
import { verifyAccessToken } from '../../../shared/jwt.js';

import { loadUserAuthContext } from './user-context.repository.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Retorna um preHandler que autentica o request via JWT Bearer.
 *
 * Após este handler, `request.user` está garantidamente definido.
 * Lança `UnauthorizedError` (401) em qualquer falha de autenticação.
 *
 * @example
 * app.get('/leads', { preHandler: [authenticate()] }, handler)
 */
export function authenticate(): preHandlerHookHandler {
  return async function authenticateHandler(request) {
    const authHeader = request.headers.authorization;

    // 1. Validar formato do header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.log.warn(
        { event: 'authn.failed', reason: 'missing_or_malformed_header', url: request.url },
        'authentication failed: no bearer token',
      );
      throw new UnauthorizedError('Token de acesso ausente ou mal formatado');
    }

    const token = authHeader.slice('Bearer '.length);

    // 2. Verificar assinatura e expiração
    let tokenPayload: { sub: string; org: string };
    try {
      tokenPayload = await verifyAccessToken(token);
    } catch {
      request.log.warn(
        { event: 'authn.failed', reason: 'invalid_or_expired_token', url: request.url },
        'authentication failed: invalid or expired token',
      );
      throw new UnauthorizedError('Token inválido ou expirado');
    }

    // 3. Carregar contexto de autorização do banco
    const userCtx = await loadUserAuthContext(db, tokenPayload.sub);

    if (!userCtx) {
      request.log.warn(
        {
          event: 'authn.failed',
          reason: 'user_inactive_or_deleted',
          user_id: tokenPayload.sub,
          url: request.url,
        },
        'authentication failed: user inactive or deleted',
      );
      throw new UnauthorizedError('Usuário inativo ou não encontrado');
    }

    // 4. Popular request.user — tipagem garantida por fastify.d.ts (F1-S04)
    request.user = {
      id: tokenPayload.sub,
      organizationId: tokenPayload.org,
      permissions: userCtx.permissions,
      cityScopeIds: userCtx.cityScopeIds,
    };
  };
}
