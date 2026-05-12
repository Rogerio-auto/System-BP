// =============================================================================
// plugins/featureGate.ts — Middleware Fastify para gating de feature flags.
//
// Uso em rota:
//   preHandler: [authenticate(), featureGate('followup.enabled')]
//
// Comportamento por status da flag:
//   'enabled'       → continua normalmente.
//   'disabled'      → 403 FeatureDisabledError com payload { flag, code }.
//   'internal_only' → verifica audience.roles do usuário:
//                       - tem acesso: continua.
//                       - sem acesso: 404 FeatureHiddenError (não revela existência).
//
// Deve ser encadeado APÓS authenticate() — precisa de request.user.
//
// Cache: usa o mesmo cache de 30s do service (via getAllFlags).
//
// Exemplo:
//   app.post('/api/followup-jobs',
//     { preHandler: [authenticate(), featureGate('followup.enabled')] },
//     handler
//   )
// =============================================================================
import type { preHandlerHookHandler } from 'fastify';

import { db } from '../db/client.js';
import type { FeatureFlagAudience } from '../db/schema/featureFlags.js';
import { getAllFlags, isFlagEnabled } from '../modules/featureFlags/service.js';
import { FeatureDisabledError, FeatureHiddenError, UnauthorizedError } from '../shared/errors.js';

// Known role names for audience checking
const KNOWN_ROLES = ['superadmin', 'admin', 'gestor_geral', 'gestor_cidade', 'agente', 'viewer'];

/**
 * Retorna um preHandler que bloqueia a rota se a flag estiver desabilitada.
 *
 * @param flagKey Chave da flag. Ex: 'followup.enabled'.
 *
 * Lança:
 *   - UnauthorizedError (401) se authenticate() não rodou antes.
 *   - FeatureDisabledError (403) se status === 'disabled'.
 *   - FeatureHiddenError (404) se status === 'internal_only' sem acesso.
 *
 * @example
 * preHandler: [authenticate(), featureGate('followup.enabled')]
 */
export function featureGate(flagKey: string): preHandlerHookHandler {
  return async function featureGateHandler(request) {
    if (!request.user) {
      throw new UnauthorizedError('featureGate requer authenticate() antes');
    }

    const userPerms = request.user.permissions;
    const userRoles = KNOWN_ROLES.filter((r) => userPerms.includes(r) || userPerms.includes('*'));

    // Load all flags (cached, TTL 30s)
    const flags = await getAllFlags(db);
    const flag = flags.find((f) => f.key === flagKey);

    if (!flag) {
      // Flag desconhecida → disabled por segurança (fail-closed)
      request.log.warn(
        { event: 'feature_gate.unknown_flag', flag: flagKey, url: request.url },
        'featureGate: flag desconhecida — bloqueando por segurança',
      );
      throw new FeatureDisabledError(flagKey);
    }

    if (flag.status === 'enabled') {
      return; // continua
    }

    if (flag.status === 'internal_only') {
      const audience = flag.audience as FeatureFlagAudience;
      const allowedRoles = audience.roles ?? [];
      const hasAccess =
        allowedRoles.length === 0 || userRoles.some((r) => allowedRoles.includes(r));

      if (hasAccess) return; // continua

      request.log.warn(
        {
          event: 'feature_gate.hidden',
          flag: flagKey,
          user_id: request.user.id,
          url: request.url,
        },
        'featureGate: flag internal_only, acesso negado',
      );
      throw new FeatureHiddenError(flagKey);
    }

    // status === 'disabled'
    request.log.warn(
      {
        event: 'feature_gate.disabled',
        flag: flagKey,
        user_id: request.user.id,
        url: request.url,
      },
      'featureGate: flag desabilitada',
    );
    throw new FeatureDisabledError(flagKey);
  };
}

// Re-export isFlagEnabled for convenience in non-route contexts
export { isFlagEnabled };
