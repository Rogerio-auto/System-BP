// =============================================================================
// features/crm/hooks.ts — TanStack Query hooks para CRM drill-down (F17-S08).
//
// Hooks exportados:
//   - useCustomerOverview(customerId) — visão consolidada do cliente
//
// Nunca useEffect + fetch — sempre TanStack Query.
// =============================================================================

import type { CustomerOverviewResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';

import { fetchCustomerOverview } from './api';

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
