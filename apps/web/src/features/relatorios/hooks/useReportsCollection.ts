// =============================================================================
// features/relatorios/hooks/useReportsCollection.ts — TanStack Query para
// GET /api/reports/collection (F23-S08).
//
// - staleTime: 3 min.
// - Sem retry em 403 — gating: billing:read (gestor_regional city-scoped OK).
//   Quando isForbidden === true a seção é escondida graciosamente.
// =============================================================================

import type { CollectionResponse, CommonReportQuery } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsCollection } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const collectionKeys = {
  all: ['reports', 'collection'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...collectionKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsCollectionResult {
  data: CollectionResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true quando o endpoint retornou 403 (billing:read ausente). */
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Cobrança & Carteira.
 * Consome GET /api/reports/collection com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 *
 * Gating backend: billing:read. gestor_regional vê só suas cidades.
 * Quando isForbidden === true o chamador deve esconder a seção inteira.
 */
export function useReportsCollection(
  query: Partial<CommonReportQuery> = {},
): UseReportsCollectionResult {
  const { data, isLoading, isError, error, refetch } = useQuery<CollectionResponse, Error>({
    queryKey: collectionKeys.filtered(query),
    queryFn: () => fetchReportsCollection(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
