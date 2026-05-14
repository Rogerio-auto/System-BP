// =============================================================================
// hooks/admin/useProducts.ts — Queries TanStack Query para produtos de crédito.
//
// Fornece:
//   useProducts(params)     → lista paginada com última regra ativa
//   useProduct(id)          → detalhe + timeline de regras
//   useCreateProduct(opts)  → mutation POST
//   useUpdateProduct(opts)  → mutation PATCH
//   useDeleteProduct()      → mutation DELETE (trata 409 com toast especial)
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../../lib/api/credit-products';

import type {
  CreditProductDetailResponse,
  CreditProductListResponse,
  CreditProductResponse,
  ProductCreate,
  ProductListParams,
  ProductUpdate,
} from './types';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const PRODUCTS_QUERY_KEY = {
  all: ['admin', 'credit-products'] as const,
  list: (params: ProductListParams) => ['admin', 'credit-products', 'list', params] as const,
  detail: (id: string) => ['admin', 'credit-products', 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// useProducts — lista paginada
// ---------------------------------------------------------------------------

/**
 * Lista paginada de produtos de crédito com última regra ativa.
 * Mantém dados anteriores durante paginação (sem flash).
 */
export function useProducts(params: ProductListParams = {}): {
  data: CreditProductListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: PRODUCTS_QUERY_KEY.list(params),
    queryFn: () => listProducts(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return {
    data,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// useProduct — detalhe + timeline
// ---------------------------------------------------------------------------

/**
 * Detalhe do produto com timeline completa de regras.
 * Enabled: só quando id é truthy.
 */
export function useProduct(id: string | undefined): {
  data: CreditProductDetailResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: PRODUCTS_QUERY_KEY.detail(id ?? ''),
    queryFn: () => getProduct(id!),
    staleTime: 30_000,
    enabled: Boolean(id),
  });

  return {
    data,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// useCreateProduct — mutation
// ---------------------------------------------------------------------------

interface UseCreateProductOptions {
  onSuccess?: ((product: CreditProductResponse) => void) | undefined;
  /** 409 — key duplicada na org */
  onConflict?: ((message: string) => void) | undefined;
}

export function useCreateProduct(opts: UseCreateProductOptions = {}): {
  createProduct: (body: ProductCreate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: ProductCreate) => createProduct(body),

    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY.all });
      toast('Produto criado com sucesso!', 'success');
      opts.onSuccess?.(product);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao criar produto.';
      toast(msg, 'danger');
    },
  });

  return {
    createProduct: (body) => mutation.mutate(body),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useUpdateProduct — mutation
// ---------------------------------------------------------------------------

interface UseUpdateProductOptions {
  onSuccess?: ((product: CreditProductResponse) => void) | undefined;
  onConflict?: ((message: string) => void) | undefined;
}

export function useUpdateProduct(opts: UseUpdateProductOptions = {}): {
  updateProduct: (id: string, body: ProductUpdate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductUpdate }) => updateProduct(id, body),

    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY.all });
      toast('Produto atualizado!', 'success');
      opts.onSuccess?.(product);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar produto.';
      toast(msg, 'danger');
    },
  });

  return {
    updateProduct: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useDeleteProduct — mutation (trata 409: simulações recentes)
// ---------------------------------------------------------------------------

export function useDeleteProduct(): {
  deleteProduct: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
  lastConflictId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Rastreia qual produto teve conflito 409 (para exibir link "Ver simulações")
  const [lastConflictId, setLastConflictId] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY.all });
      toast('Produto removido.', 'success');
    },

    onError: (err: unknown, id: string) => {
      if (err instanceof ApiError && err.status === 409) {
        setLastConflictId(id);
        toast(
          'Este produto possui simulações recentes e não pode ser removido. Acesse as simulações para mais detalhes.',
          'danger',
        );
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao remover produto.';
      toast(msg, 'danger');
    },
  });

  return {
    deleteProduct: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
    lastConflictId,
  };
}
