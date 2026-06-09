// =============================================================================
// hooks/admin/useTutorials.ts — TanStack Query hooks para tutoriais em vídeo.
//
// Norma 21 §8. Acesso restrito a tutorials:manage.
// Padrão de query key factory alinhado ao useCities.ts.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiError } from '../../lib/api';
import type {
  TutorialCreate,
  TutorialListParams,
  TutorialResponse,
  TutorialUpdate,
} from '../../lib/api/tutorials';
import {
  createTutorial,
  deleteTutorial,
  listFeatureKeys,
  listTutorials,
  updateTutorial,
} from '../../lib/api/tutorials';

// ─── Query keys ──────────────────────────────────────────────────────────────

export const TUTORIALS_QUERY_KEY = (params: TutorialListParams = {}) =>
  ['admin', 'tutorials', params] as const;

export const FEATURE_KEYS_QUERY_KEY = () => ['admin', 'feature-keys'] as const;

// ─── Hooks de leitura ────────────────────────────────────────────────────────

/**
 * Lista completa de tutoriais (inclui inativos).
 * Cache staleTime: 30s (mesmos defaults de listCities).
 */
export function useTutorials(params: TutorialListParams = {}): {
  data: Awaited<ReturnType<typeof listTutorials>> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: TUTORIALS_QUERY_KEY(params),
    queryFn: () => listTutorials(params),
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

/**
 * Catálogo fechado de feature_key para o dropdown.
 * Cache longo (10 min) — catálogo muda raramente.
 */
export function useFeatureKeys(): {
  featureKeys: string[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: FEATURE_KEYS_QUERY_KEY(),
    queryFn: listFeatureKeys,
    staleTime: 10 * 60_000,
  });

  return {
    featureKeys: data ?? [],
    isLoading,
  };
}

// ─── Hooks de mutação ─────────────────────────────────────────────────────────

interface CreateOptions {
  onSuccess?: (result: TutorialResponse) => void;
  onConflict?: (msg: string) => void;
}

/**
 * Cria um tutorial. Invalida a lista ao concluir.
 */
export function useCreateTutorial(opts: CreateOptions = {}): {
  createTutorial: (body: TutorialCreate) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: TutorialCreate) => createTutorial(body),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tutorials'] });
      opts.onSuccess?.(result);
    },
    onError: (err: ApiError) => {
      if (err.status === 409) {
        opts.onConflict?.(err.message ?? 'feature_key já cadastrado.');
      }
    },
  });

  return {
    createTutorial: (body) => mutation.mutate(body),
    isPending: mutation.isPending,
  };
}

interface UpdateOptions {
  onSuccess?: (result: TutorialResponse) => void;
  onConflict?: (msg: string) => void;
}

/**
 * Edita um tutorial pelo id. Invalida a lista ao concluir.
 */
export function useUpdateTutorial(opts: UpdateOptions = {}): {
  updateTutorial: (id: string, body: TutorialUpdate) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TutorialUpdate }) => updateTutorial(id, body),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tutorials'] });
      opts.onSuccess?.(result);
    },
    onError: (err: ApiError) => {
      if (err.status === 409) {
        opts.onConflict?.(err.message ?? 'feature_key já cadastrado.');
      }
    },
  });

  return {
    updateTutorial: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

interface DeleteOptions {
  onSuccess?: () => void;
}

/**
 * Soft-delete de tutorial. Invalida a lista ao concluir.
 */
export function useDeleteTutorial(opts: DeleteOptions = {}): {
  deleteTutorial: (id: string) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => deleteTutorial(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tutorials'] });
      opts.onSuccess?.();
    },
  });

  return {
    deleteTutorial: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
  };
}

/**
 * Toggle rápido de is_active (ativar/desativar).
 * Wraps useUpdateTutorial com payload mínimo.
 */
export function useToggleTutorialActive(opts: { onSuccess?: () => void } = {}): {
  toggle: (id: string, currentActive: boolean) => void;
  isPending: boolean;
} {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateTutorial(id, { is_active: active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tutorials'] });
      opts.onSuccess?.();
    },
  });

  return {
    toggle: (id, currentActive) => mutation.mutate({ id, active: !currentActive }),
    isPending: mutation.isPending,
  };
}
