// =============================================================================
// features/followup/hooks/useFollowup.ts — TanStack Query hooks (F5-S05).
//
// Hooks:
//   - useFollowupRules      — lista réguas
//   - useCreateFollowupRule — mutação: criar régua
//   - useUpdateFollowupRule — mutação: atualizar régua
//   - useFollowupJobs       — lista jobs paginada com filtros
//   - useCancelFollowupJob  — mutação: cancelar job agendado
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalidate após mutate para manter cache consistente.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelFollowupJob,
  createFollowupRule,
  fetchFollowupJobs,
  fetchFollowupRules,
  updateFollowupRule,
} from '../api';
import type {
  FollowupJobResponse,
  FollowupJobsFilters,
  FollowupJobsListResponse,
  FollowupRuleForm,
  FollowupRuleResponse,
  FollowupRulesListResponse,
} from '../schemas';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const FOLLOWUP_KEYS = {
  all: ['followup'] as const,
  rules: () => [...FOLLOWUP_KEYS.all, 'rules'] as const,
  jobs: () => [...FOLLOWUP_KEYS.all, 'jobs'] as const,
  jobsList: (filters: FollowupJobsFilters) => [...FOLLOWUP_KEYS.jobs(), filters] as const,
} as const;

// ---------------------------------------------------------------------------
// useFollowupRules
// ---------------------------------------------------------------------------

export function useFollowupRules(): {
  data: FollowupRulesListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: FOLLOWUP_KEYS.rules(),
    queryFn: fetchFollowupRules,
    staleTime: 30_000,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useCreateFollowupRule
// ---------------------------------------------------------------------------

export function useCreateFollowupRule(): {
  mutate: (
    body: FollowupRuleForm,
    opts?: { onSuccess?: (rule: FollowupRuleResponse) => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: FollowupRuleForm) => createFollowupRule(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FOLLOWUP_KEYS.rules() });
    },
  });

  return {
    mutate: (body, opts) => {
      const mutateOpts: Parameters<typeof mutate>[1] = {};
      if (opts?.onSuccess) mutateOpts.onSuccess = opts.onSuccess;
      if (opts?.onError) mutateOpts.onError = (err) => opts.onError?.(err as Error);
      mutate(body, mutateOpts);
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useUpdateFollowupRule
// ---------------------------------------------------------------------------

export function useUpdateFollowupRule(): {
  mutate: (
    args: { id: string; body: Partial<FollowupRuleForm> },
    opts?: { onSuccess?: (rule: FollowupRuleResponse) => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<FollowupRuleForm> }) =>
      updateFollowupRule(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FOLLOWUP_KEYS.rules() });
    },
  });

  return {
    mutate: (args, opts) => {
      const mutateOpts: Parameters<typeof mutate>[1] = {};
      if (opts?.onSuccess) mutateOpts.onSuccess = opts.onSuccess;
      if (opts?.onError) mutateOpts.onError = (err) => opts.onError?.(err as Error);
      mutate(args, mutateOpts);
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useFollowupJobs
// ---------------------------------------------------------------------------

export function useFollowupJobs(filters: FollowupJobsFilters = {}): {
  data: FollowupJobsListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: FOLLOWUP_KEYS.jobsList(filters),
    queryFn: () => fetchFollowupJobs(filters),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useCancelFollowupJob
// ---------------------------------------------------------------------------

export function useCancelFollowupJob(): {
  mutate: (
    jobId: string,
    opts?: { onSuccess?: (job: FollowupJobResponse) => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (jobId: string) => cancelFollowupJob(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FOLLOWUP_KEYS.jobs() });
    },
  });

  return {
    mutate: (jobId, opts) => {
      const mutateOpts: Parameters<typeof mutate>[1] = {};
      if (opts?.onSuccess) mutateOpts.onSuccess = opts.onSuccess;
      if (opts?.onError) mutateOpts.onError = (err) => opts.onError?.(err as Error);
      mutate(jobId, mutateOpts);
    },
    isPending,
  };
}
