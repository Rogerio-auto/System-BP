// =============================================================================
// hooks/crm/useLeads.ts — Lista paginada de leads com filtros.
//
// TanStack Query — nunca useEffect+fetch.
// Query key inclui filtros para que cada combinação seja cacheada separadamente.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadFilters, LeadListResponse } from './types';

export const LEADS_QUERY_KEY = (filters: LeadFilters) => ['leads', 'list', filters] as const;

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchLeads(filters: LeadFilters): Promise<LeadListResponse> {
  const params = new URLSearchParams();

  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.city_id) params.set('city_id', filters.city_id);
  if (filters.agent_id) params.set('agent_id', filters.agent_id);

  const qs = params.toString();

  return api.get<LeadListResponse>(`/api/leads${qs ? `?${qs}` : ''}`);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Lista paginada de leads com filtros.
 * Query key inclui filtros: cada combinação tem cache separado.
 */
export function useLeads(filters: LeadFilters = {}): {
  data: LeadListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: LEADS_QUERY_KEY(filters),
    queryFn: () => fetchLeads(filters),
    staleTime: 30_000,
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
