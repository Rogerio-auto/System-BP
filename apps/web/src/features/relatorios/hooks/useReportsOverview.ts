// =============================================================================
// features/relatorios/hooks/useReportsOverview.ts — TanStack Query para
// GET /api/reports/overview (F23-S06).
//
// - staleTime: 3 min (métricas semi-fresh aceitáveis).
// - Query key inclui os filtros para cache e invalidação corretos.
// - Sem retry em 403 (papel sem permissão — não adianta tentar de novo).
// =============================================================================

import type { CommonReportQuery, OverviewResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsOverview } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const reportsKeys = {
  all: ['reports'] as const,
  overview: (query: Partial<CommonReportQuery>) => [...reportsKeys.all, 'overview', query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsOverviewResult {
  data: OverviewResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Visão Geral de Relatórios.
 * Consome GET /api/reports/overview com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 */
export function useReportsOverview(
  query: Partial<CommonReportQuery> = {},
): UseReportsOverviewResult {
  const { data, isLoading, isError, error, refetch } = useQuery<OverviewResponse, Error>({
    queryKey: reportsKeys.overview(query),
    queryFn: () => fetchReportsOverview(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      // Não retenta 403 (sem permissão) nem 404
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
