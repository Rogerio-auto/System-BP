// =============================================================================
// hooks/crm/useCreateLead.ts — Mutation para criar novo lead.
//
// Em sucesso: fecha modal + invalida query de lista (useLeads).
// Em 409 LEAD_PHONE_DUPLICATE: retorna erro tipado para o form.
// Em 409 LEAD_EMAIL_DUPLICATE: retorna erro inline para o campo email (F14-S03).
// Em 422 LEAD_EMAIL_INTERNAL: retorna erro inline para o campo email (F14-S03).
// Em 422 INVALID_CNPJ: retorna erro inline para o campo cnpj (F18-S10).
// =============================================================================

import type { LeadCreate, LeadResponse } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

export type CreateLeadError = {
  type: 'duplicate_phone' | 'duplicate_email' | 'internal_email' | 'invalid_cnpj' | 'generic';
  message: string;
};

interface UseCreateLeadOptions {
  onSuccess?: (lead: LeadResponse) => void;
  onDuplicatePhone?: (message: string) => void;
  /** Chamado quando o email já pertence a outro lead (409 LEAD_EMAIL_DUPLICATE). */
  onDuplicateEmail?: (message: string) => void;
  /** Chamado quando o email é um email interno do sistema (422 LEAD_EMAIL_INTERNAL). */
  onInternalEmail?: (message: string) => void;
  /** Chamado quando o CNPJ informado é inválido (422 INVALID_CNPJ). */
  onInvalidCnpj?: (message: string) => void;
  onError?: (err: CreateLeadError) => void;
}

/**
 * Mutation para criar um novo lead via POST /api/leads.
 * - Invalida queries de lista após sucesso.
 * - Em 409 LEAD_PHONE_DUPLICATE, chama onDuplicatePhone para exibir erro inline.
 * - Em 409 LEAD_EMAIL_DUPLICATE, chama onDuplicateEmail para exibir erro inline.
 * - Em 422 LEAD_EMAIL_INTERNAL, chama onInternalEmail para exibir erro inline.
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
      if (err instanceof ApiError) {
        if (err.status === 409 && err.code === 'LEAD_PHONE_DUPLICATE') {
          opts.onDuplicatePhone?.('Este telefone já está cadastrado para outro lead.');
          return;
        }

        if (err.status === 409 && err.code === 'LEAD_EMAIL_DUPLICATE') {
          opts.onDuplicateEmail?.('Já existe lead com este email.');
          return;
        }

        if (err.status === 422 && err.code === 'LEAD_EMAIL_INTERNAL') {
          opts.onInternalEmail?.('Use o email do cliente, não um email interno.');
          return;
        }

        if (err.status === 422 && err.code === 'INVALID_CNPJ') {
          opts.onInvalidCnpj?.('CNPJ inválido. Verifique os dígitos informados.');
          return;
        }
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
