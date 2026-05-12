// =============================================================================
// hooks/useFeatureFlag.ts — Hook de feature flags para o frontend (F1-S23).
//
// Busca /api/feature-flags/me no bootstrap e mantém cache via TanStack Query
// com staleTime 30s (espelhando o TTL do backend).
//
// Comportamento:
//   - useFeatureFlag(key): retorna { enabled, status, loading }
//   - useFeatureFlags():   retorna { flags, loading } — mapa completo
//
// Uso:
//   const { enabled } = useFeatureFlag('followup.enabled');
//   if (!enabled) return <FeatureDisabledBadge label="Em desenvolvimento" />;
//
// Fallback: se a flag não for encontrada no mapa, assume 'disabled' por
// segurança (fail-closed). Isso evita que uma flag nova (não ainda no mapa)
// seja acessível antes de ser configurada.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type FeatureFlagStatus = 'enabled' | 'disabled' | 'internal_only';

export type FeatureFlagsMap = Record<string, FeatureFlagStatus>;

// ---------------------------------------------------------------------------
// Query key canônica (para invalidação manual em admin UI)
// ---------------------------------------------------------------------------

export const FEATURE_FLAGS_QUERY_KEY = ['feature-flags', 'me'] as const;

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchMyFlags(): Promise<FeatureFlagsMap> {
  return api.get<FeatureFlagsMap>('/api/feature-flags/me');
}

// ---------------------------------------------------------------------------
// useFeatureFlags — mapa completo
// ---------------------------------------------------------------------------

/**
 * Retorna o mapa completo de feature flags do usuário autenticado.
 * Cache: staleTime 30s, polling a cada 30s (sincroniza com TTL do backend).
 * Só executa quando o usuário está autenticado.
 */
export function useFeatureFlags(): { flags: FeatureFlagsMap; isLoading: boolean } {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data, isLoading } = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: fetchMyFlags,
    // Só busca quando autenticado
    enabled: isAuthenticated,
    // Espelha TTL do cache do backend
    staleTime: 30_000,
    // Polling de 30s como fallback para deployments multi-instância
    refetchInterval: 30_000,
    // Não re-fetch ao focar janela (reduz noise)
    refetchOnWindowFocus: false,
  });

  return {
    flags: data ?? {},
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// useFeatureFlag — flag única
// ---------------------------------------------------------------------------

/**
 * Verifica se uma feature flag específica está habilitada.
 *
 * @param key Chave da flag. Ex: 'followup.enabled'.
 *
 * Retorna:
 *   enabled  — true quando status === 'enabled' ou 'internal_only' com acesso.
 *   status   — status bruto da flag ('enabled' | 'disabled' | 'internal_only' | undefined).
 *   isLoading — true enquanto carrega do servidor.
 *
 * @example
 * const { enabled, isLoading } = useFeatureFlag('followup.enabled');
 */
export function useFeatureFlag(key: string): {
  enabled: boolean;
  status: FeatureFlagStatus | undefined;
  isLoading: boolean;
} {
  const { flags, isLoading } = useFeatureFlags();

  const status = flags[key];
  const enabled = status === 'enabled' || status === 'internal_only';

  return { enabled, status, isLoading };
}
