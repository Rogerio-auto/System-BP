// =============================================================================
// features/relatorios/hooks/useReportsAttendance.ts — TanStack Query para
// GET /api/reports/attendance (F23-S07).
//
// - staleTime: 3 min (métricas semi-fresh aceitáveis).
// - Query key inclui os filtros para cache e invalidação corretos.
// - Sem retry em 403 (papel sem permissão — não adianta tentar de novo).
// =============================================================================

import type { AttendanceResponse, CommonReportQuery } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsAttendance } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const attendanceKeys = {
  all: ['reports', 'attendance'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...attendanceKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsAttendanceResult {
  data: AttendanceResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Atendimentos & Conversas.
 * Consome GET /api/reports/attendance com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 */
export function useReportsAttendance(
  query: Partial<CommonReportQuery> = {},
): UseReportsAttendanceResult {
  const { data, isLoading, isError, error, refetch } = useQuery<AttendanceResponse, Error>({
    queryKey: attendanceKeys.filtered(query),
    queryFn: () => fetchReportsAttendance(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
