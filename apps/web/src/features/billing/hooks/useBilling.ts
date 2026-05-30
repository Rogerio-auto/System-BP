// =============================================================================
// features/billing/hooks/useBilling.ts — TanStack Query hooks para cobrança (F5-S08).
//
// Hooks:
//   - usePaymentDues         — lista parcelas com filtros paginados
//   - useMarkPaymentDuePaid  — mutação: marcar parcela como paga
//   - useRenegotiatePaymentDue — mutação: renegociar parcela
//   - useCollectionRules     — lista réguas
//   - useCreateCollectionRule — mutação: criar régua
//   - useUpdateCollectionRule — mutação: atualizar régua
//   - useCollectionJobs      — lista jobs paginados com filtros
//   - useCancelCollectionJob  — mutação: cancelar job agendado
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalidate após mutate para manter cache consistente.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelCollectionJob,
  createCollectionRule,
  fetchCollectionJobs,
  fetchCollectionRules,
  fetchPaymentDues,
  markPaymentDuePaid,
  renegotiatePaymentDue,
  updateCollectionRule,
} from '../api';
import type {
  CollectionJobResponse,
  CollectionJobsFilters,
  CollectionJobsListResponse,
  CollectionRuleForm,
  CollectionRuleResponse,
  CollectionRulesListResponse,
  PaymentDueResponse,
  PaymentDuesFilters,
  PaymentDuesListResponse,
} from '../schemas';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const BILLING_KEYS = {
  all: ['billing'] as const,
  dues: () => [...BILLING_KEYS.all, 'dues'] as const,
  duesList: (filters: PaymentDuesFilters) => [...BILLING_KEYS.dues(), filters] as const,
  rules: () => [...BILLING_KEYS.all, 'rules'] as const,
  jobs: () => [...BILLING_KEYS.all, 'jobs'] as const,
  jobsList: (filters: CollectionJobsFilters) => [...BILLING_KEYS.jobs(), filters] as const,
} as const;

// ---------------------------------------------------------------------------
// usePaymentDues
// ---------------------------------------------------------------------------

export function usePaymentDues(filters: PaymentDuesFilters = {}): {
  data: PaymentDuesListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: BILLING_KEYS.duesList(filters),
    queryFn: () => fetchPaymentDues(filters),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useMarkPaymentDuePaid
// ---------------------------------------------------------------------------

export function useMarkPaymentDuePaid(): {
  mutate: (
    dueId: string,
    opts?: { onSuccess?: (due: PaymentDueResponse) => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (dueId: string) => markPaymentDuePaid(dueId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.dues() });
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.jobs() });
    },
  });

  return {
    mutate: (dueId, opts) => {
      const mutateOpts: Parameters<typeof mutate>[1] = {};
      if (opts?.onSuccess) mutateOpts.onSuccess = opts.onSuccess;
      if (opts?.onError) mutateOpts.onError = (err) => opts.onError?.(err as Error);
      mutate(dueId, mutateOpts);
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useRenegotiatePaymentDue
// ---------------------------------------------------------------------------

export function useRenegotiatePaymentDue(): {
  mutate: (
    dueId: string,
    opts?: { onSuccess?: (due: PaymentDueResponse) => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (dueId: string) => renegotiatePaymentDue(dueId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.dues() });
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.jobs() });
    },
  });

  return {
    mutate: (dueId, opts) => {
      const mutateOpts: Parameters<typeof mutate>[1] = {};
      if (opts?.onSuccess) mutateOpts.onSuccess = opts.onSuccess;
      if (opts?.onError) mutateOpts.onError = (err) => opts.onError?.(err as Error);
      mutate(dueId, mutateOpts);
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// useCollectionRules
// ---------------------------------------------------------------------------

export function useCollectionRules(): {
  data: CollectionRulesListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: BILLING_KEYS.rules(),
    queryFn: fetchCollectionRules,
    staleTime: 30_000,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useCreateCollectionRule
// ---------------------------------------------------------------------------

export function useCreateCollectionRule(): {
  mutate: (
    body: CollectionRuleForm,
    opts?: {
      onSuccess?: (rule: CollectionRuleResponse) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CollectionRuleForm) => createCollectionRule(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.rules() });
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
// useUpdateCollectionRule
// ---------------------------------------------------------------------------

export function useUpdateCollectionRule(): {
  mutate: (
    args: { id: string; body: Partial<CollectionRuleForm> },
    opts?: {
      onSuccess?: (rule: CollectionRuleResponse) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CollectionRuleForm> }) =>
      updateCollectionRule(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.rules() });
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
// useCollectionJobs
// ---------------------------------------------------------------------------

export function useCollectionJobs(filters: CollectionJobsFilters = {}): {
  data: CollectionJobsListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: BILLING_KEYS.jobsList(filters),
    queryFn: () => fetchCollectionJobs(filters),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useCancelCollectionJob
// ---------------------------------------------------------------------------

export function useCancelCollectionJob(): {
  mutate: (
    jobId: string,
    opts?: {
      onSuccess?: (job: CollectionJobResponse) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (jobId: string) => cancelCollectionJob(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.jobs() });
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
