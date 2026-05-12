// =============================================================================
// featureFlags/service.ts — Regras de negócio do módulo feature flags.
//
// Cache em memória com TTL 30s (docs/09-feature-flags.md §5).
// Em deployments multi-instância, o polling de 30s garante eventual consistency.
// Invalidação proativa ao fazer toggle.
// =============================================================================

import type { Database } from '../../db/client.js';
import type { FeatureFlag, FeatureFlagAudience } from '../../db/schema/featureFlags.js';
import { NotFoundError } from '../../shared/errors.js';

import { findFlagByKey, listAllFlags, updateFlag } from './repository.js';
import type { PatchFeatureFlagBody } from './schemas.js';

// ---------------------------------------------------------------------------
// Cache em memória
// ---------------------------------------------------------------------------

interface CacheEntry {
  flags: FeatureFlag[];
  expiresAt: number;
}

let _cache: CacheEntry | null = null;
const CACHE_TTL_MS = 30_000;

function isCacheValid(): boolean {
  return _cache !== null && Date.now() < _cache.expiresAt;
}

function setCache(flags: FeatureFlag[]): void {
  _cache = { flags, expiresAt: Date.now() + CACHE_TTL_MS };
}

/** Invalida o cache forçando re-leitura na próxima requisição. */
export function invalidateFlagCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Carrega todas as flags, usando cache quando válido. */
export async function getAllFlags(db: Database): Promise<FeatureFlag[]> {
  if (isCacheValid()) {
    // Justificativa do `as`: _cache foi verificado como não-null em isCacheValid()
    // mas TypeScript não estreita o tipo neste contexto. É seguro.
    return (_cache as CacheEntry).flags;
  }

  const flags = await listAllFlags(db);
  setCache(flags);
  return flags;
}

/**
 * Retorna o mapa `{ key → status }` para o endpoint /api/feature-flags/me.
 *
 * Aplica filtragem de audience: flags internal_only são incluídas apenas
 * se o usuário tiver ao menos uma das roles em audience.roles.
 *
 * @param userRoles Lista de role names do usuário autenticado.
 */
export async function getMyFlags(
  db: Database,
  userRoles: string[],
): Promise<Record<string, FeatureFlag['status']>> {
  const flags = await getAllFlags(db);

  const result: Record<string, FeatureFlag['status']> = {};

  for (const flag of flags) {
    if (flag.status === 'internal_only') {
      const audience = flag.audience as FeatureFlagAudience;
      const allowedRoles = audience.roles ?? [];

      // Incluir apenas se o usuário tiver ao menos uma role permitida
      const hasAccess =
        allowedRoles.length === 0 || userRoles.some((r) => allowedRoles.includes(r));

      if (!hasAccess) continue;
    }

    result[flag.key] = flag.status;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mutações (admin)
// ---------------------------------------------------------------------------

/**
 * Aplica patch a uma flag. Invalida o cache após a atualização.
 *
 * @throws NotFoundError se a flag não existir.
 */
export async function patchFlag(
  db: Database,
  key: string,
  patch: PatchFeatureFlagBody,
  updatedByUserId: string,
): Promise<FeatureFlag> {
  const existing = await findFlagByKey(db, key);
  if (!existing) {
    throw new NotFoundError(`Feature flag não encontrada: ${key}`);
  }

  const updated = await updateFlag(db, key, patch, updatedByUserId);
  if (!updated) {
    throw new NotFoundError(`Feature flag não encontrada após update: ${key}`);
  }

  // Invalida cache — próxima leitura vai ao banco
  invalidateFlagCache();

  return updated;
}

/**
 * Verifica se uma flag está habilitada para um conjunto de roles.
 * Usado pelo middleware featureGate e pelo worker requireFlag.
 */
export async function isFlagEnabled(
  db: Database,
  key: string,
  userRoles: string[] = [],
): Promise<{ enabled: boolean; status: FeatureFlag['status'] }> {
  const flags = await getAllFlags(db);
  const flag = flags.find((f) => f.key === key);

  if (!flag) {
    // Flag desconhecida → tratar como disabled por segurança
    return { enabled: false, status: 'disabled' };
  }

  if (flag.status === 'enabled') {
    return { enabled: true, status: 'enabled' };
  }

  if (flag.status === 'internal_only') {
    const audience = flag.audience as FeatureFlagAudience;
    const allowedRoles = audience.roles ?? [];
    const hasAccess = allowedRoles.length === 0 || userRoles.some((r) => allowedRoles.includes(r));
    return { enabled: hasAccess, status: 'internal_only' };
  }

  // status === 'disabled'
  return { enabled: false, status: 'disabled' };
}
