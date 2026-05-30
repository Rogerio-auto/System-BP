// =============================================================================
// features/templates/hooks/useTemplates.ts — TanStack Query hooks para templates.
//
// Contexto: F5-S09.
// Nunca useEffect+fetch — sempre TanStack Query.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiError } from '../../../lib/api';
import {
  createTemplate,
  deleteTemplate,
  fetchTemplate,
  fetchTemplatesList,
  syncAllTemplates,
  syncTemplate,
  updateTemplate,
} from '../api';
import type {
  TemplateCreateForm,
  TemplateFilters,
  TemplateListResponse,
  TemplateResponse,
  TemplateUpdateForm,
} from '../schemas';

// ─── Query keys ───────────────────────────────────────────────────────────────

export const TEMPLATES_KEYS = {
  all: ['templates'] as const,
  lists: () => [...TEMPLATES_KEYS.all, 'list'] as const,
  list: (filters: TemplateFilters) => [...TEMPLATES_KEYS.lists(), filters] as const,
  details: () => [...TEMPLATES_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...TEMPLATES_KEYS.details(), id] as const,
} as const;

// ─── useTemplates ──────────────────────────────────────────────────────────────

export function useTemplates(filters: TemplateFilters = {}): {
  data: TemplateListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: TEMPLATES_KEYS.list(filters),
    queryFn: () => fetchTemplatesList(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ─── useTemplate ──────────────────────────────────────────────────────────────

export function useTemplate(id: string): {
  data: TemplateResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: TEMPLATES_KEYS.detail(id),
    queryFn: () => fetchTemplate(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ─── useCreateTemplate ────────────────────────────────────────────────────────

interface MutationCallbacks<T = TemplateResponse> {
  onSuccess?: (data: T) => void;
  onError?: (message: string) => void;
}

export function useCreateTemplate(callbacks?: MutationCallbacks): {
  createTemplate: (body: TemplateCreateForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: TemplateCreateForm) => createTemplate(body, crypto.randomUUID()),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao criar template.');
    },
  });

  return { createTemplate: mutate, isPending };
}

// ─── useUpdateTemplate ────────────────────────────────────────────────────────

export function useUpdateTemplate(
  id: string,
  callbacks?: MutationCallbacks,
): {
  updateTemplate: (body: TemplateUpdateForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: TemplateUpdateForm) => updateTemplate(id, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.detail(id) });
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao atualizar template.');
    },
  });

  return { updateTemplate: mutate, isPending };
}

// ─── useDeleteTemplate ────────────────────────────────────────────────────────

export function useDeleteTemplate(callbacks?: MutationCallbacks): {
  deleteTemplate: (id: string) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao excluir template.');
    },
  });

  return { deleteTemplate: mutate, isPending };
}

// ─── useSyncTemplate ─────────────────────────────────────────────────────────

export function useSyncTemplate(
  id: string,
  callbacks?: MutationCallbacks,
): {
  syncTemplate: () => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: () => syncTemplate(id, crypto.randomUUID()),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.detail(id) });
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao sincronizar template.');
    },
  });

  return { syncTemplate: mutate, isPending };
}

// ─── useSyncAllTemplates ──────────────────────────────────────────────────────

export function useSyncAllTemplates(
  callbacks?: MutationCallbacks<{ synced: number; unchanged: number; errors: number }>,
): {
  syncAll: () => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: syncAllTemplates,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao sincronizar templates.');
    },
  });

  return { syncAll: mutate, isPending };
}
