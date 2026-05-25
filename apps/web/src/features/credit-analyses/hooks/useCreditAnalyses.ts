// =============================================================================
// features/credit-analyses/hooks/useCreditAnalyses.ts
//
// Hooks TanStack Query para análise de crédito.
// Nunca useEffect+fetch — sempre TanStack Query.
//
// Hooks exportados:
//   - useCreditAnalysesList     — lista paginada
//   - useCreditAnalysis         — detalhe por id
//   - useLeadCreditAnalyses     — histórico do lead
//   - useCreateCreditAnalysis   — mutação: criar análise
//   - useAddVersion             — mutação: nova versão
//   - useDecideAnalysis         — mutação: decidir
//   - useRequestReview          — mutação: pedir revisão
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiError } from '../../../lib/api';
import {
  addCreditAnalysisVersion,
  createCreditAnalysis,
  decideCreditAnalysis,
  fetchCreditAnalysis,
  fetchCreditAnalysesList,
  fetchLeadCreditAnalyses,
  requestCreditAnalysisReview,
} from '../api';
import type {
  CreditAnalysisCreateForm,
  CreditAnalysisDecideForm,
  CreditAnalysisFilters,
  CreditAnalysisListResponse,
  CreditAnalysisRequestReviewForm,
  CreditAnalysisResponse,
  CreditAnalysisVersionForm,
} from '../schemas';

// ─── Query keys ───────────────────────────────────────────────────────────────

export const CREDIT_ANALYSES_KEYS = {
  all: ['credit-analyses'] as const,
  lists: () => [...CREDIT_ANALYSES_KEYS.all, 'list'] as const,
  list: (filters: CreditAnalysisFilters) => [...CREDIT_ANALYSES_KEYS.lists(), filters] as const,
  details: () => [...CREDIT_ANALYSES_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...CREDIT_ANALYSES_KEYS.details(), id] as const,
  leadAnalyses: (leadId: string, filters: CreditAnalysisFilters) =>
    [...CREDIT_ANALYSES_KEYS.all, 'lead', leadId, filters] as const,
} as const;

// ─── useCreditAnalysesList ────────────────────────────────────────────────────

/**
 * Lista paginada com filtros e city-scope.
 */
export function useCreditAnalysesList(filters: CreditAnalysisFilters = {}): {
  data: CreditAnalysisListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: CREDIT_ANALYSES_KEYS.list(filters),
    queryFn: () => fetchCreditAnalysesList(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ─── useCreditAnalysis ────────────────────────────────────────────────────────

/**
 * Detalhe de uma análise com versão atual hidratada.
 */
export function useCreditAnalysis(id: string): {
  data: CreditAnalysisResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: CREDIT_ANALYSES_KEYS.detail(id),
    queryFn: () => fetchCreditAnalysis(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ─── useLeadCreditAnalyses ────────────────────────────────────────────────────

/**
 * Histórico de análises de um lead específico.
 */
export function useLeadCreditAnalyses(
  leadId: string,
  filters: CreditAnalysisFilters = {},
): {
  data: CreditAnalysisListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: CREDIT_ANALYSES_KEYS.leadAnalyses(leadId, filters),
    queryFn: () => fetchLeadCreditAnalyses(leadId, filters),
    enabled: Boolean(leadId),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError };
}

// ─── useCreateCreditAnalysis ──────────────────────────────────────────────────

interface MutationCallbacks {
  onSuccess?: (data: CreditAnalysisResponse) => void;
  onError?: (message: string) => void;
}

/**
 * Mutação: criar análise + 1ª versão.
 * Invalida a lista após sucesso.
 */
export function useCreateCreditAnalysis(callbacks?: MutationCallbacks): {
  createAnalysis: (body: CreditAnalysisCreateForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: createCreditAnalysis,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: CREDIT_ANALYSES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao criar análise de crédito.');
    },
  });

  return { createAnalysis: mutate, isPending };
}

// ─── useAddVersion ────────────────────────────────────────────────────────────

/**
 * Mutação: adicionar nova versão imutável.
 * Invalida o detalhe e a lista após sucesso.
 */
export function useAddVersion(
  analysisId: string,
  callbacks?: MutationCallbacks,
): {
  addVersion: (body: CreditAnalysisVersionForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CreditAnalysisVersionForm) => addCreditAnalysisVersion(analysisId, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: CREDIT_ANALYSES_KEYS.detail(analysisId),
      });
      void queryClient.invalidateQueries({ queryKey: CREDIT_ANALYSES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao adicionar versão.');
    },
  });

  return { addVersion: mutate, isPending };
}

// ─── useDecideAnalysis ────────────────────────────────────────────────────────

/**
 * Mutação: decidir análise (aprovado | recusado).
 * Exige permissão credit_analyses:decide (verificada no componente).
 * Invalida detalhe + lista após sucesso.
 */
export function useDecideAnalysis(
  analysisId: string,
  callbacks?: MutationCallbacks,
): {
  decide: (body: CreditAnalysisDecideForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CreditAnalysisDecideForm) => decideCreditAnalysis(analysisId, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: CREDIT_ANALYSES_KEYS.detail(analysisId),
      });
      void queryClient.invalidateQueries({ queryKey: CREDIT_ANALYSES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao registrar decisão.');
    },
  });

  return { decide: mutate, isPending };
}

// ─── useRequestReview ─────────────────────────────────────────────────────────

/**
 * Mutação: solicitar revisão humana (Art. 20 §5 LGPD).
 * Exige permissão credit_analyses:request_review.
 */
export function useRequestReview(
  analysisId: string,
  callbacks?: MutationCallbacks,
): {
  requestReview: (body: CreditAnalysisRequestReviewForm) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (body: CreditAnalysisRequestReviewForm) =>
      requestCreditAnalysisReview(analysisId, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: CREDIT_ANALYSES_KEYS.detail(analysisId),
      });
      void queryClient.invalidateQueries({ queryKey: CREDIT_ANALYSES_KEYS.lists() });
      callbacks?.onSuccess?.(data);
    },
    onError: (err: ApiError | Error) => {
      callbacks?.onError?.(err.message ?? 'Erro ao solicitar revisão.');
    },
  });

  return { requestReview: mutate, isPending };
}
