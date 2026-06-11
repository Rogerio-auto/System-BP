// =============================================================================
// hooks/crm/useLeadSimulations.ts — Histórico de simulações de crédito de um lead.
//
// Usa TanStack Query. Nunca useEffect + fetch.
// LGPD: resposta não contém PII — apenas dados financeiros + metadados.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadSimulation, LeadSimulationsResponse } from './types';

export const LEAD_SIMULATIONS_KEY = (leadId: string) => ['leads', 'simulations', leadId] as const;

// ─── Fetch function ───────────────────────────────────────────────────────────

async function fetchLeadSimulations(
  leadId: string,
  cursor?: string,
  limit?: number,
): Promise<LeadSimulationsResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));

  const qs = params.toString();
  const url = `/api/leads/${leadId}/simulations${qs ? `?${qs}` : ''}`;

  return api.get<LeadSimulationsResponse>(url);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Histórico de simulações de crédito de um lead.
 * Pagina por cursor (primeiros 20 resultados).
 */
export function useLeadSimulations(leadId: string): {
  simulations: LeadSimulation[];
  nextCursor: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: LEAD_SIMULATIONS_KEY(leadId),
    queryFn: () => fetchLeadSimulations(leadId),
    staleTime: 30_000,
    enabled: Boolean(leadId),
  });

  return {
    simulations: data?.data ?? [],
    nextCursor: data?.nextCursor ?? null,
    isLoading,
    isError,
  };
}
