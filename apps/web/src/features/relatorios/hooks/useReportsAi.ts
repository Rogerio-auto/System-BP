// =============================================================================
// features/relatorios/hooks/useReportsAi.ts — TanStack Query para
// GET /api/reports/ai (F23-S07).
//
// - staleTime: 3 min.
// - Sem retry em 403 — endpoint retorna 403 para papéis city-scoped.
//   Chamador trata isForbidden escondendo a seção inteira (sem quebrar a página).
// =============================================================================

import type { AiResponse, CommonReportQuery } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsAi } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const aiKeys = {
  all: ['reports', 'ai'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...aiKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsAiResult {
  data: AiResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true quando o endpoint retornou 403 (papel sem acesso global). */
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de IA / Pré-atendimento.
 * Consome GET /api/reports/ai com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 *
 * Quando isForbidden === true o chamador deve esconder a seção inteira.
 */
export function useReportsAi(query: Partial<CommonReportQuery> = {}): UseReportsAiResult {
  const { data, isLoading, isError, error, refetch } = useQuery<AiResponse, Error>({
    queryKey: aiKeys.filtered(query),
    queryFn: () => fetchReportsAi(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
