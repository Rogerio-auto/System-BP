// =============================================================================
// hooks/crm/useCreateLead.ts — Mutation para criar novo lead.
//
// Em sucesso: fecha modal + invalida query de lista (useLeads).
// Em 409 LEAD_PHONE_DUPLICATE: retorna erro tipado para o form.
// =============================================================================

import type { LeadCreate, LeadResponse } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

export type CreateLeadError = {
  type: 'duplicate_phone' | 'generic';
  message: string;
};

interface UseCreateLeadOptions {
  onSuccess?: (lead: LeadResponse) => void;
  onDuplicatePhone?: (message: string) => void;
  onError?: (err: CreateLeadError) => void;
}

/**
 * Mutation para criar um novo lead via POST /api/leads.
 * - Invalida queries de lista após sucesso.
 * - Em 409 LEAD_PHONE_DUPLICATE, chama onDuplicatePhone para exibir erro inline.
 */
export function useCreateLead(opts: UseCreateLeadOptions = {}): {
  createLead: (data: LeadCreate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: LeadCreate): Promise<LeadResponse> =>
      api.post<LeadResponse>('/api/leads', data),

    onSuccess: (lead) => {
      // Invalida todas as queries de lista de leads (qualquer filtro)
      void queryClient.invalidateQueries({ queryKey: ['leads', 'list'] });
      opts.onSuccess?.(lead);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409 && err.code === 'LEAD_PHONE_DUPLICATE') {
        opts.onDuplicatePhone?.('Este telefone já está cadastrado para outro lead.');
        return;
      }

      const message = err instanceof Error ? err.message : 'Erro ao criar lead. Tente novamente.';

      opts.onError?.({ type: 'generic', message });
    },
  });

  return {
    createLead: (data: LeadCreate) => mutation.mutate(data),
    isPending: mutation.isPending,
  };
}
