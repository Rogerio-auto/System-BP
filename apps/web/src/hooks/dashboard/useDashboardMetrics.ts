// =============================================================================
// hooks/dashboard/useDashboardMetrics.ts — TanStack Query para GET /api/dashboard/metrics.
//
// - Query key inclui range + cityId para cache e invalidação corretos.
// - staleTime: 3 min (dashboard tem dados semi-fresh aceitáveis).
// - Nunca usa useEffect + fetch — só TanStack Query sobre lib/api.ts.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

import type { DashboardMetricsQuery, DashboardMetricsResponse } from './types';

// ---------------------------------------------------------------------------
// Query key factory — centraliza a forma da key para invalidação
// ---------------------------------------------------------------------------

export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (query: DashboardMetricsQuery) => [...dashboardKeys.all, 'metrics', query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDashboardMetricsResult {
  data: DashboardMetricsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas do dashboard.
 * Consome GET /api/dashboard/metrics com range e cityId opcionais.
 * Cache de 3 min (staleTime). Refetch automático ao mudar params.
 */
export function useDashboardMetrics(query: DashboardMetricsQuery = {}): UseDashboardMetricsResult {
  const { range = '30d', cityId } = query;

  const params = new URLSearchParams();
  params.set('range', range);
  if (cityId) params.set('cityId', cityId);

  // Build query key with only defined values (exactOptionalPropertyTypes)
  const queryKeyParams: DashboardMetricsQuery = cityId ? { range, cityId } : { range };

  const { data, isLoading, isError, error, refetch } = useQuery<DashboardMetricsResponse, Error>({
    queryKey: dashboardKeys.metrics(queryKeyParams),
    queryFn: () => api.get<DashboardMetricsResponse>(`/api/dashboard/metrics?${params.toString()}`),
    staleTime: 3 * 60 * 1000,
    retry: (failureCount, err) => {
      // Não retenta 403 (sem permissão) nem 404
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
