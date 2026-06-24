// =============================================================================
// features/relatorios/hooks/useReportsCredit.ts — TanStack Query para
// GET /api/reports/credit (F23-S08).
//
// - staleTime: 3 min (métricas semi-fresh aceitáveis).
// - Query key inclui os filtros para cache e invalidação corretos.
// - Sem retry em 403 (papel sem permissão — não adianta tentar de novo).
// =============================================================================

import type { CommonReportQuery, CreditResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsCredit } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const creditKeys = {
  all: ['reports', 'credit'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...creditKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsCreditResult {
  data: CreditResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true quando o endpoint retornou 403 (papel sem acesso). */
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Crédito.
 * Consome GET /api/reports/credit com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 */
export function useReportsCredit(query: Partial<CommonReportQuery> = {}): UseReportsCreditResult {
  const { data, isLoading, isError, error, refetch } = useQuery<CreditResponse, Error>({
    queryKey: creditKeys.filtered(query),
    queryFn: () => fetchReportsCredit(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
