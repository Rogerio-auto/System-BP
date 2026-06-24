// =============================================================================
// features/relatorios/hooks/useReportsProductivity.ts — TanStack Query para
// GET /api/reports/productivity (F23-S08).
//
// - staleTime: 3 min.
// - Sem retry em 403.
// - D3: backend retorna teamAverage quando self-scoped (agente).
//   A UI apenas apresenta o que veio — sem reconstrução de nomes.
// =============================================================================

import type { CommonReportQuery, ProductivityResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsProductivity } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const productivityKeys = {
  all: ['reports', 'productivity'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...productivityKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsProductivityResult {
  data: ProductivityResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true quando o endpoint retornou 403 (dashboard:read_by_agent ausente). */
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Produtividade por agente.
 * Consome GET /api/reports/productivity com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 *
 * D3: data.teamAverage presente → self-scoped (agente vê só a si + média anônima).
 *     data.teamAverage ausente → gestor (ranking nominal completo).
 */
export function useReportsProductivity(
  query: Partial<CommonReportQuery> = {},
): UseReportsProductivityResult {
  const { data, isLoading, isError, error, refetch } = useQuery<ProductivityResponse, Error>({
    queryKey: productivityKeys.filtered(query),
    queryFn: () => fetchReportsProductivity(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
