// =============================================================================
// features/contracts/hooks.ts — TanStack Query hooks para contratos (F17-S05, F17-S06, F17-S11).
//
// Hooks exportados:
//   - useContracts(filters)          — lista paginada
//   - useContract(id)                — detalhe de um contrato
//   - useSignContract()              — mutação: assinar contrato
//   - useContractHealth(id)          — saúde de boletos (F17-S06)
//   - useContractDues(customerId, contractReference) — parcelas do contrato (F17-S06)
//   - useCreateContract()            — mutação: criar novo contrato (F17-S11)
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalidate após mutate para manter o cache consistente.
// =============================================================================
import type { ContractCreate } from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usePaymentDues } from '../billing';

import {
  createContract,
  fetchContract,
  fetchContracts,
  fetchContractHealth,
  signContract,
} from './api';
import type { Contract, ContractsFilters } from './schemas';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const CONTRACT_KEYS = {
  all: ['contracts'] as const,
  lists: () => [...CONTRACT_KEYS.all, 'list'] as const,
  list: (filters: ContractsFilters) => [...CONTRACT_KEYS.lists(), filters] as const,
  details: () => [...CONTRACT_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...CONTRACT_KEYS.details(), id] as const,
  health: (id: string) => [...CONTRACT_KEYS.all, 'health', id] as const,
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

// ---------------------------------------------------------------------------
// useContractHealth — saúde de boletos de um contrato (F17-S06)
// ---------------------------------------------------------------------------

/**
 * Carrega o indicador de saúde de boletos de um contrato.
 * Chama GET /api/contracts/:id/health.
 * Permissão: contracts:read (verificada no backend).
 * LGPD: retorna apenas agregados financeiros operacionais — sem PII.
 */
export function useContractHealth(contractId: string) {
  return useQuery({
    queryKey: CONTRACT_KEYS.health(contractId),
    queryFn: () => fetchContractHealth(contractId),
    enabled: Boolean(contractId),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useContractDues — parcelas de um contrato (F17-S06)
// ---------------------------------------------------------------------------

/**
 * Lista as parcelas (payment_dues) de um contrato específico.
 * Reutiliza usePaymentDues do módulo billing com filtro por customer_id.
 * A filtragem por contract_reference é feita client-side pois o endpoint de billing
 * não suporta filtro por contract_id.
 *
 * Retorna o resultado filtrado e os estados de loading/error originais.
 *
 * @param customerId    UUID do cliente dono do contrato
 * @param contractRef   contract_reference para filtrar as parcelas (ex: "BP-2026-00123")
 */
export function useContractDues(customerId: string, contractRef: string) {
  const result = usePaymentDues({
    customer_id: customerId,
    limit: 100, // carrega todas as parcelas de uma vez (contratos raramente têm mais de 60)
  });

  const filteredData =
    result.data?.data?.filter((due) => due.contract_reference === contractRef) ?? null;

  return {
    ...result,
    dues: filteredData,
  };
}

// ---------------------------------------------------------------------------
// useContractByAnalysis — contrato vinculado a uma análise de crédito (F17-S14)
// ---------------------------------------------------------------------------

/**
 * Busca o contrato draft criado automaticamente a partir de uma análise aprovada.
 * Chama GET /api/contracts?analysis_id=:analysisId&per_page=1.
 * Retorna o primeiro contrato encontrado ou null se não existir.
 *
 * Só ativa quando analysisId for uma string não-vazia.
 * staleTime de 60s — contrato vinculado raramente muda após criação.
 */
export function useContractByAnalysis(analysisId: string) {
  const result = useQuery({
    queryKey: [...CONTRACT_KEYS.all, 'by-analysis', analysisId] as const,
    queryFn: () => fetchContracts({ analysis_id: analysisId, per_page: 1 }),
    enabled: Boolean(analysisId),
    staleTime: 60_000,
  });

  const contract = result.data?.data?.[0] ?? null;

  return {
    ...result,
    contract,
  };
}

// ---------------------------------------------------------------------------
// useCreateContract — mutação para criar um novo contrato (F17-S11)
// ---------------------------------------------------------------------------

export interface UseCreateContractOptions {
  onSuccess?: ((contract: Contract) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}

/**
 * Cria um novo contrato via POST /api/contracts.
 * Após sucesso invalida a lista de contratos para forçar refetch.
 * Permissão: contracts:write (verificada no backend).
 */
export function useCreateContract(opts: UseCreateContractOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ContractCreate) => createContract(data),
    onSuccess: (contract) => {
      // Invalida todas as listas de contratos para refletir o novo item
      void queryClient.invalidateQueries({
        queryKey: CONTRACT_KEYS.lists(),
      });
      opts.onSuccess?.(contract);
    },
    onError: (err: Error) => {
      opts.onError?.(err);
    },
  });
}
