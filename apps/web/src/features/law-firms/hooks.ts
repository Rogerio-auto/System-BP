// =============================================================================
// features/law-firms/hooks.ts — TanStack Query hooks para escritórios de advocacia (F19-S04).
//
// Hooks:
//   - useLawFirms         — lista com filtros paginados (query)
//   - useCreateLawFirm    — mutação: criar escritório
//   - useUpdateLawFirm    — mutação: atualizar escritório
//   - useDeleteLawFirm    — mutação: excluir escritório
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalidate após mutate para manter cache consistente.
// =============================================================================

import type {
  LawFirmCreate,
  LawFirmListResponse,
  LawFirmResponse,
  LawFirmUpdate,
} from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createLawFirm, deleteLawFirm, listLawFirms, updateLawFirm } from './api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

interface LawFirmsFilters {
  cityId?: string;
  page?: number;
  pageSize?: number;
}

export const LAW_FIRMS_KEYS = {
  all: ['law-firms'] as const,
  list: (filters: LawFirmsFilters = {}) => [...LAW_FIRMS_KEYS.all, 'list', filters] as const,
} as const;

// ---------------------------------------------------------------------------
// useLawFirms
// ---------------------------------------------------------------------------

export function useLawFirms(filters: LawFirmsFilters = {}): {
  data: LawFirmListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: LAW_FIRMS_KEYS.list(filters),
    queryFn: () => listLawFirms(filters),
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
// useCreateLawFirm
// ---------------------------------------------------------------------------

export function useCreateLawFirm(): {
  mutate: (
    data: LawFirmCreate,
    opts?: {
      onSuccess?: (firm: LawFirmResponse) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (data: LawFirmCreate) => createLawFirm(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LAW_FIRMS_KEYS.all });
    },
  });

  return {
    mutate: (data, opts) => {
      mutate(data, {
        onSuccess: (firm) => opts?.onSuccess?.(firm),
        onError: (err) => opts?.onError?.(err as Error),
      });
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useUpdateLawFirm
// ---------------------------------------------------------------------------

export function useUpdateLawFirm(): {
  mutate: (
    params: { id: string; data: LawFirmUpdate },
    opts?: {
      onSuccess?: (firm: LawFirmResponse) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LawFirmUpdate }) => updateLawFirm(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LAW_FIRMS_KEYS.all });
    },
  });

  return {
    mutate: (params, opts) => {
      mutate(params, {
        onSuccess: (firm) => opts?.onSuccess?.(firm),
        onError: (err) => opts?.onError?.(err as Error),
      });
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useDeleteLawFirm
// ---------------------------------------------------------------------------

export function useDeleteLawFirm(): {
  mutate: (
    id: string,
    opts?: {
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (id: string) => deleteLawFirm(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LAW_FIRMS_KEYS.all });
    },
  });

  return {
    mutate: (id, opts) => {
      mutate(id, {
        onSuccess: () => opts?.onSuccess?.(),
        onError: (err) => opts?.onError?.(err as Error),
      });
    },
    isPending,
  };
}
