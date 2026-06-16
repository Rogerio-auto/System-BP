// =============================================================================
// features/crm/hooks.ts — TanStack Query hooks para CRM drill-down (F17-S08 + F18-S10).
//
// Hooks exportados:
//   - useCustomerOverview(customerId) — visão consolidada do cliente
//   - useUpdatePersonalEmail()        — mutation PATCH /api/users/me/personal-email
//
// Nunca useEffect + fetch — sempre TanStack Query.
// =============================================================================

import type { CustomerOverviewResponse } from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchCustomerOverview, updatePersonalEmail } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const CUSTOMER_OVERVIEW_KEYS = {
  all: ['customer-overview'] as const,
  detail: (id: string) => [...CUSTOMER_OVERVIEW_KEYS.all, id] as const,
} as const;

// ---------------------------------------------------------------------------
// useCustomerOverview — visão consolidada do cliente
// ---------------------------------------------------------------------------

export interface UseCustomerOverviewResult {
  data: CustomerOverviewResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Carrega a visão consolidada de um cliente: dados, contratos e últimas parcelas.
 * Só ativa quando customerId for uma string não-vazia.
 *
 * Consome GET /api/customers/:id/overview (F17-S07).
 */
export function useCustomerOverview(customerId: string): UseCustomerOverviewResult {
  const { data, isLoading, isError, error } = useQuery<CustomerOverviewResponse, Error>({
    queryKey: CUSTOMER_OVERVIEW_KEYS.detail(customerId),
    queryFn: () => fetchCustomerOverview(customerId),
    enabled: Boolean(customerId),
    staleTime: 30_000, // 30s — dados financeiros mudam com baixa frequência no detalhe
  });

  return { data, isLoading, isError, error };
}

// ---------------------------------------------------------------------------
// useUpdatePersonalEmail — PATCH /api/users/me/personal-email (F18-S10)
// ---------------------------------------------------------------------------

export interface UseUpdatePersonalEmailResult {
  /** Dispara a mutation. Passar null para remover o email. */
  updatePersonalEmail: (personalEmail: string | null) => void;
  isPending: boolean;
}

/**
 * Mutation para atualizar (ou remover) o email pessoal do agente.
 * Após sucesso, invalida o perfil da conta para refletir o novo estado
 * no guard de 1º login e no banner do NewLeadModal.
 *
 * LGPD: personalEmail é PII — nunca logar o valor.
 */
export function useUpdatePersonalEmail(opts?: {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}): UseUpdatePersonalEmailResult {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (personalEmail: string | null) => updatePersonalEmail(personalEmail),

    onSuccess: () => {
      // Invalida o perfil de conta para que o guard e o banner reflitam o novo estado
      void queryClient.invalidateQueries({ queryKey: ['account', 'profile'] });
      opts?.onSuccess?.();
    },

    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Erro ao atualizar email. Tente novamente.';
      opts?.onError?.(message);
    },
  });

  return {
    updatePersonalEmail: (personalEmail) => mutation.mutate(personalEmail),
    isPending: mutation.isPending,
  };
}
