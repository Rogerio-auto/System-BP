// =============================================================================
// hooks/crm/useUpdateLead.ts — Mutation para atualizar um lead.
//
// Invalida queries de lista e detalhe após sucesso.
// =============================================================================

import type { LeadResponse, LeadUpdate } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api';

import { LEAD_QUERY_KEY } from './useLead';
import { LEADS_QUERY_KEY } from './useLeads';

interface UseUpdateLeadOptions {
  onSuccess?: (lead: LeadResponse) => void;
  onError?: (message: string) => void;
}

/**
 * Mutation para atualizar um lead via PATCH /api/leads/:id.
 * - Invalida query de detalhe e lista após sucesso.
 */
export function useUpdateLead(
  id: string,
  opts: UseUpdateLeadOptions = {},
): {
  updateLead: (data: LeadUpdate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: LeadUpdate): Promise<LeadResponse> =>
      api.patch<LeadResponse>(`/api/leads/${id}`, data),

    onSuccess: (lead) => {
      // Invalida detalhe e lista
      void queryClient.invalidateQueries({ queryKey: LEAD_QUERY_KEY(id) });
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY({}) });
      opts.onSuccess?.(lead);
    },

    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Erro ao atualizar lead. Tente novamente.';
      opts.onError?.(message);
    },
  });

  return {
    updateLead: (data: LeadUpdate) => mutation.mutate(data),
    isPending: mutation.isPending,
  };
}
