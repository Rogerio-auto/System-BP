// =============================================================================
// features/relatorios/hooks/useReportsAudit.ts — TanStack Query para
// GET /api/reports/audit (F23-S08).
//
// - staleTime: 3 min.
// - Sem retry em 403 — gating: audit:read (admin/gestor_geral apenas).
//   Quando isForbidden === true a seção é escondida graciosamente.
// =============================================================================

import type { AuditResponse, CommonReportQuery } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import { fetchReportsAudit } from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const auditKeys = {
  all: ['reports', 'audit'] as const,
  filtered: (query: Partial<CommonReportQuery>) => [...auditKeys.all, query] as const,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseReportsAuditResult {
  data: AuditResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true quando o endpoint retornou 403 (audit:read ausente). */
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook canônico para métricas de Auditoria & Operação.
 * Consome GET /api/reports/audit com filtros opcionais.
 * Cache de 3 min. Sem retry em 403.
 *
 * Quando isForbidden === true o chamador deve esconder a seção inteira.
 */
export function useReportsAudit(query: Partial<CommonReportQuery> = {}): UseReportsAuditResult {
  const { data, isLoading, isError, error, refetch } = useQuery<AuditResponse, Error>({
    queryKey: auditKeys.filtered(query),
    queryFn: () => fetchReportsAudit(query),
    staleTime: 3 * 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}
