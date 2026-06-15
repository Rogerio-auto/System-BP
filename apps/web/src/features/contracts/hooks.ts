// =============================================================================
// features/contracts/hooks.ts — TanStack Query hooks para contratos (F17-S05).
//
// Hooks exportados:
//   - useContracts(filters)  — lista paginada
//   - useContract(id)        — detalhe de um contrato
//   - useSignContract()      — mutação: assinar contrato
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalidate após mutate para manter o cache consistente.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchContract, fetchContracts, signContract } from './api';
import type { ContractsFilters } from './schemas';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const CONTRACT_KEYS = {
  all: ['contracts'] as const,
  lists: () => [...CONTRACT_KEYS.all, 'list'] as const,
  list: (filters: ContractsFilters) => [...CONTRACT_KEYS.lists(), filters] as const,
  details: () => [...CONTRACT_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...CONTRACT_KEYS.details(), id] as const,
} as const;

// ---------------------------------------------------------------------------
// useContracts — lista paginada com filtros
// ---------------------------------------------------------------------------

/**
 * Lista contratos com filtros opcionais de status, customer_id e paginação.
 * Permissão mínima: contracts:read (verificada no backend).
 */
export function useContracts(filters: ContractsFilters = {}) {
  return useQuery({
    queryKey: CONTRACT_KEYS.list(filters),
    queryFn: () => fetchContracts(filters),
  });
}

// ---------------------------------------------------------------------------
// useContract — detalhe de um contrato por ID
// ---------------------------------------------------------------------------

/**
 * Carrega um contrato pelo ID.
 * Só ativa quando id for uma string não-vazia.
 */
export function useContract(id: string) {
  return useQuery({
    queryKey: CONTRACT_KEYS.detail(id),
    queryFn: () => fetchContract(id),
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// useSignContract — mutação para assinar um contrato
// ---------------------------------------------------------------------------

/**
 * Assina um contrato (draft → signed).
 * Após sucesso invalida o detalhe e a lista para forçar refetch.
 * Permissão: contracts:sign (verificada no backend).
 */
export function useSignContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, signed_at }: { id: string; signed_at?: string }) =>
      signContract(id, { signed_at }),
    onSuccess: (_data, variables) => {
      // Invalida detalhe do contrato assinado
      void queryClient.invalidateQueries({
        queryKey: CONTRACT_KEYS.detail(variables.id),
      });
      // Invalida a lista para refletir novo status
      void queryClient.invalidateQueries({
        queryKey: CONTRACT_KEYS.lists(),
      });
    },
  });
}
