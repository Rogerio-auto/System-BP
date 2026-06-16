// =============================================================================
// features/dashboard/api.ts — TanStack Query hooks para dashboard de cobrança e SPC.
//
// Endpoints:
//   GET  /api/dashboard/collection?city_id=  → CollectionDashboardResponse
//   GET  /api/billing/customers/:id/spc      → { customer_id, current_status, changed_at }
//   POST /api/billing/customers/:id/spc      body { status } → avança status SPC
//
// Permissões:
//   - useCollectionDashboard: billing:read
//   - useCustomerSpcStatus:   billing:read
//   - useUpdateSpcStatus:     spc:manage
//
// LGPD (doc 17 §8.1): customer_id é UUID — sem PII bruta. Sem log de payload.
// =============================================================================

import {
  CollectionDashboardResponseSchema,
  SpcStatusSchema,
  type CollectionDashboardResponse,
  type SpcStatus,
} from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const collectionKeys = {
  all: ['collection-dashboard'] as const,
  dashboard: (cityId?: string) => [...collectionKeys.all, 'summary', cityId ?? 'all'] as const,
};

export const spcKeys = {
  all: ['spc'] as const,
  status: (customerId: string) => [...spcKeys.all, 'status', customerId] as const,
};

// ---------------------------------------------------------------------------
// GET /api/dashboard/collection
// ---------------------------------------------------------------------------

interface UseCollectionDashboardResult {
  data: CollectionDashboardResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isForbidden: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook TanStack Query para o dashboard de cobrança.
 * Consome GET /api/dashboard/collection com city_id opcional.
 * Permissão: billing:read
 */
export function useCollectionDashboard(cityId?: string): UseCollectionDashboardResult {
  const params = new URLSearchParams();
  if (cityId) params.set('city_id', cityId);
  const qs = params.toString();
  const url = `/api/dashboard/collection${qs ? `?${qs}` : ''}`;

  const { data, isLoading, isError, error, refetch } = useQuery<CollectionDashboardResponse, Error>(
    {
      queryKey: collectionKeys.dashboard(cityId),
      queryFn: async () => {
        const raw = await api.get<unknown>(url);
        // Valida a resposta contra o schema compartilhado
        return CollectionDashboardResponseSchema.parse(raw);
      },
      staleTime: 3 * 60 * 1000,
      retry: (failureCount, err) => {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
        return failureCount < 2;
      },
    },
  );

  const isForbidden = isError && error instanceof ApiError && error.status === 403;

  return { data, isLoading, isError, isForbidden, error, refetch };
}

// ---------------------------------------------------------------------------
// GET /api/billing/customers/:id/spc
// ---------------------------------------------------------------------------

export interface CustomerSpcStatusResponse {
  customer_id: string;
  current_status: SpcStatus;
  changed_at: string | null;
}

interface UseCustomerSpcStatusResult {
  data: CustomerSpcStatusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook TanStack Query para status SPC de um cliente.
 * Consome GET /api/billing/customers/:id/spc.
 * Permissão: billing:read
 */
export function useCustomerSpcStatus(customerId: string): UseCustomerSpcStatusResult {
  const { data, isLoading, isError, error, refetch } = useQuery<CustomerSpcStatusResponse, Error>({
    queryKey: spcKeys.status(customerId),
    queryFn: async () => {
      const raw = await api.get<{
        customer_id: string;
        current_status: string;
        changed_at: string | null;
      }>(`/api/billing/customers/${encodeURIComponent(customerId)}/spc`);
      // Valida o status com o schema compartilhado
      const validatedStatus = SpcStatusSchema.parse(raw.current_status);
      return {
        customer_id: raw.customer_id,
        current_status: validatedStatus,
        changed_at: raw.changed_at,
      };
    },
    staleTime: 60 * 1000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return false;
      return failureCount < 2;
    },
  });

  return { data, isLoading, isError, error, refetch };
}

// ---------------------------------------------------------------------------
// POST /api/billing/customers/:id/spc
// ---------------------------------------------------------------------------

interface UpdateSpcStatusVars {
  customerId: string;
  status: SpcStatus;
}

interface UpdateSpcStatusResponse {
  customer_id: string;
  current_status: SpcStatus;
  changed_at: string | null;
}

/**
 * Mutation TanStack Query para atualizar status SPC de um cliente.
 * Chama POST /api/billing/customers/:id/spc body { status }.
 * Permissão: spc:manage
 * Após sucesso: invalida a query de status do cliente.
 */
export function useUpdateSpcStatus() {
  const queryClient = useQueryClient();

  return useMutation<UpdateSpcStatusResponse, Error, UpdateSpcStatusVars>({
    mutationFn: async ({ customerId, status }) => {
      const raw = await api.post<{
        customer_id: string;
        current_status: string;
        changed_at: string | null;
      }>(`/api/billing/customers/${encodeURIComponent(customerId)}/spc`, { status });
      const validatedStatus = SpcStatusSchema.parse(raw.current_status);
      return {
        customer_id: raw.customer_id,
        current_status: validatedStatus,
        changed_at: raw.changed_at,
      };
    },
    onSuccess: (data, vars) => {
      // Atualização otimista do cache de status SPC
      queryClient.setQueryData(spcKeys.status(vars.customerId), data);
      // Invalida overview do cliente (drawer CRM) e dashboard de cobrança
      void queryClient.invalidateQueries({ queryKey: ['customer-overview', vars.customerId] });
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all });
    },
  });
}
