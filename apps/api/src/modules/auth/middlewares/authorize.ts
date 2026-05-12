// =============================================================================
// authorize.ts — Middleware Fastify de autorização baseada em permissões (RBAC).
//
// Uso em rota:
//   preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })]
//
// Deve ser usado sempre APÓS authenticate() — depende de request.user.
//
// Verificação:
//   - O usuário deve possuir TODAS as permissões listadas em `permissions`.
//   - Suporte a wildcard '*': se request.user.permissions inclui '*', tudo é permitido.
//   - Ausência de qualquer permissão → 403 ForbiddenError.
//
// Audit: toda tentativa negada loga `event: 'authz.denied'` via Pino estruturado.
//
// Design: factory `authorize(opts)` em vez de handler direto para ser
// encadeável e configurável por rota. Assinatura aceita 1 ou N permissões.
// =============================================================================
import type { preHandlerHookHandler } from 'fastify';

import { ForbiddenError, UnauthorizedError } from '../../../shared/errors.js';

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

export interface AuthorizeOptions {
  /**
   * Uma ou mais permission keys que o usuário deve possuir.
   * Todas são verificadas (AND — não OR).
   * Exemplo: ['leads:read', 'kanban:move']
   */
  permissions: [string, ...string[]];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Retorna um preHandler que verifica se request.user possui todas as permissões.
 *
 * Deve ser encadeado APÓS authenticate():
 *   preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })]
 *
 * Lança:
 *   - UnauthorizedError (401) se request.user não estiver definido (authenticate() pulado).
 *   - ForbiddenError (403) se o usuário não possuir alguma das permissões requeridas.
 *
 * @example
 * app.get('/leads', {
 *   preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })],
 * }, handler)
 */
export function authorize(opts: AuthorizeOptions): preHandlerHookHandler {
  const { permissions: required } = opts;

  return async function authorizeHandler(request) {
    // Garantia defensiva: authenticate() deve ter rodado antes
    if (!request.user) {
      throw new UnauthorizedError('Não autenticado — authenticate() deve preceder authorize()');
    }

    const userPerms = request.user.permissions;

    // Wildcard: admin técnico com permissão total (ex: seed/CLI)
    if (userPerms.includes('*')) return;

    // Verificar que todas as permissões requeridas estão presentes (AND)
    const missing = required.filter((perm) => !userPerms.includes(perm));

    if (missing.length > 0) {
      request.log.warn(
        {
          event: 'authz.denied',
          user_id: request.user.id,
          org_id: request.user.organizationId,
          required_permissions: required,
          missing_permissions: missing,
          url: request.url,
          method: request.method,
        },
        'authorization denied: insufficient permissions',
      );

      // Mensagem genérica — não revela quais permissões o usuário não tem
      throw new ForbiddenError('Acesso negado: permissões insuficientes');
    }
  };
}
