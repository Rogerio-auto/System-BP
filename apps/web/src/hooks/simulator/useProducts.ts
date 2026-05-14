// =============================================================================
// hooks/simulator/useProducts.ts — Lista de produtos de crédito (F2-S06).
//
// GET /api/credit-products → lista produtos com regra ativa.
// TanStack Query — nunca useEffect+fetch.
// staleTime: 60s (produtos mudam com pouca frequência).
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { CreditProduct, CreditProductListResponse } from './types';

// ─── Query key ────────────────────────────────────────────────────────────────

export const PRODUCTS_QUERY_KEY = ['credit-products', 'list'] as const;

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function fetchProducts(): Promise<CreditProduct[]> {
  try {
    const resp = await api.get<CreditProductListResponse>(
      '/api/credit-products?limit=100&is_active=true',
    );
    return resp.data;
  } catch {
    // Fallback vazio — o formulário mostrará estado de erro via isError
    return [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Lista produtos de crédito ativos com regra ativa.
 * Usado pelo ProductSelect no SimulatorForm.
 */
export function useProducts(): {
  products: CreditProduct[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: fetchProducts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    products: data ?? [],
    isLoading,
    isError,
  };
}
