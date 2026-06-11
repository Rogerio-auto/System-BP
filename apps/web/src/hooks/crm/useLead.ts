// =============================================================================
// hooks/crm/useLead.ts — Detalhe de um lead por ID.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadInteraction, LeadResponse } from './types';

export const LEAD_QUERY_KEY = (id: string) => ['leads', 'detail', id] as const;
export const LEAD_INTERACTIONS_KEY = (id: string) => ['leads', 'interactions', id] as const;

// ─── Fetch detalhe ────────────────────────────────────────────────────────────

async function fetchLead(id: string): Promise<LeadResponse> {
  return api.get<LeadResponse>(`/api/leads/${id}`);
}

// ─── Fetch interações ─────────────────────────────────────────────────────────

async function fetchInteractions(leadId: string): Promise<LeadInteraction[]> {
  return api.get<LeadInteraction[]>(`/api/leads/${leadId}/interactions`);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Detalhe de um lead por ID.
 */
export function useLead(id: string): {
  lead: LeadResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: LEAD_QUERY_KEY(id),
    queryFn: () => fetchLead(id),
    staleTime: 30_000,
    enabled: Boolean(id),
  });

  return { lead: data, isLoading, isError };
}

/**
 * Timeline de interações de um lead.
 */
export function useLeadInteractions(leadId: string): {
  interactions: LeadInteraction[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: LEAD_INTERACTIONS_KEY(leadId),
    queryFn: () => fetchInteractions(leadId),
    staleTime: 30_000,
    enabled: Boolean(leadId),
  });

  return { interactions: data ?? [], isLoading };
}
