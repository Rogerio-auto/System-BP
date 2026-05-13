// =============================================================================
// hooks/admin/useCities.ts — Lista paginada de cidades com filtros.
//
// TanStack Query — nunca useEffect+fetch.
// Query key inclui filtros: cada combinação de parâmetros tem cache separado.
// staleTime: 30s (alinhado ao defaultOptions do QueryClient).
// =============================================================================

import type { CityListResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import type { CityListParams } from '../../lib/api/cities';
import { listCities } from '../../lib/api/cities';

// ─── Query key factory ────────────────────────────────────────────────────────

export const CITIES_QUERY_KEY = (params: CityListParams) => ['admin', 'cities', params] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Lista paginada de cidades com filtros.
 *
 * @param params - Parâmetros de filtro/paginação.
 *   - search: texto livre (nome)
 *   - state_uf: UF de 2 letras
 *   - is_active: true | false | undefined (todas)
 *   - page / limit: paginação server-side
 */
export function useCities(params: CityListParams = {}): {
  data: CityListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: CITIES_QUERY_KEY(params),
    queryFn: () => listCities(params),
    staleTime: 30_000,
    // Mantém dados anteriores enquanto carrega nova página (sem flash em branco)
    placeholderData: (prev) => prev,
  });

  return {
    data,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
