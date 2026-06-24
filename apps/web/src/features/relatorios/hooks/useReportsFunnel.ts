// =============================================================================
// features/relatorios/hooks/useReportsFunnel.ts — TanStack Query para
// GET /api/reports/funnel (F23-S07).
//
// - staleTime: 3 min.
// - Sem retry em 403.
// =============================================================================

import type { CommonReportQuery, FunnelResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsFunnel } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const funnelKeys = {
  all: ['reports', 'funnel'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...funnelKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsFunnelResult {
  data: FunnelResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Funil & CRM.
 * Consome GET /api/reports/funnel com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 */
export function useReportsFunnel(query: Partial<CommonReportQuery> = {}): UseReportsFunnelResult {
  const { data, isLoading, isError, error, refetch } = useQuery<FunnelResponse, Error>({
    queryKey: funnelKeys.filtered(query),
    queryFn: () => fetchReportsFunnel(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
