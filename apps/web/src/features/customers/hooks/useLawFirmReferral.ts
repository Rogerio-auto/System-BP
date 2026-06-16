// =============================================================================
// features/customers/hooks/useLawFirmReferral.ts — TanStack Query hooks para
// encaminhamento de clientes para advocacia (F19-S05).
//
// Hooks:
//   - useLawFirmSuggestion(customerId) — GET suggest + GET all firms (fallback)
//   - useCreateLawFirmReferral()       — POST mutation
//
// Nunca useEffect + fetch — sempre TanStack Query.
// Invalida queries após mutate para manter cache consistente.
// =============================================================================

import type { LawFirmResponse, LawFirmSuggestResponse } from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../../../lib/api';
import type { LawFirmReferralBody, LawFirmReferralResponse } from '../api';
import {
  LawFirmCooldownError,
  createLawFirmReferral,
  fetchAllLawFirms,
  fetchLawFirmSuggestion,
} from '../api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const LAW_FIRM_REFERRAL_KEYS = {
  suggestion: (customerId: string) => ['law-firm-suggestion', customerId] as const,
  allFirms: () => ['law-firms', 'all-for-referral'] as const,
} as const;

// ---------------------------------------------------------------------------
// useLawFirmSuggestion
// ---------------------------------------------------------------------------

export interface UseLawFirmSuggestionResult {
  /** Escritório sugerido (baseado em cidade do cliente). Null quando não cadastrado. */
  suggestion: LawFirmResponse | null;
  /** Lista completa de escritórios — usada como fallback quando suggestion === null. */
  allFirms: LawFirmResponse[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Carrega o escritório sugerido para o cliente e a lista completa como fallback.
 * Ativa apenas quando customerId for uma string não-vazia.
 */
export function useLawFirmSuggestion(customerId: string): UseLawFirmSuggestionResult {
  const enabled = Boolean(customerId);

  const {
    data: suggestData,
    isLoading: loadingSuggestion,
    isError: errorSuggestion,
  } = useQuery<LawFirmSuggestResponse, Error>({
    queryKey: LAW_FIRM_REFERRAL_KEYS.suggestion(customerId),
    queryFn: () => fetchLawFirmSuggestion(customerId),
    enabled,
    staleTime: 60_000,
  });

  const {
    data: allFirmsData,
    isLoading: loadingAll,
    isError: errorAll,
  } = useQuery({
    queryKey: LAW_FIRM_REFERRAL_KEYS.allFirms(),
    queryFn: fetchAllLawFirms,
    enabled,
    staleTime: 60_000,
  });

  return {
    suggestion: suggestData?.data ?? null,
    allFirms: allFirmsData?.data ?? [],
    isLoading: loadingSuggestion || loadingAll,
    isError: errorSuggestion || errorAll,
  };
}

// ---------------------------------------------------------------------------
// useCreateLawFirmReferral
// ---------------------------------------------------------------------------

export interface ReferralError {
  /** Mensagem de erro legível pelo usuário. */
  message: string;
  /** Se o erro for cooldown, a data/hora de liberação (ISO 8601). */
  cooldownUntil?: string;
  /** Se 403: funcionalidade desabilitada pelo admin. */
  featureDisabled?: boolean;
}

export interface UseCreateLawFirmReferralResult {
  mutate: (
    params: { customerId: string; body: LawFirmReferralBody },
    opts?: {
      onSuccess?: (data: LawFirmReferralResponse) => void;
      onError?: (err: ReferralError) => void;
    },
  ) => void;
  isPending: boolean;
}

/**
 * Mutation para encaminhar cliente para escritório de advocacia.
 * Pós-sucesso: invalida a query de sugestão (cooldown mudou).
 * Clasifica os erros por tipo para facilitar o tratamento no componente.
 */
export function useCreateLawFirmReferral(): UseCreateLawFirmReferralResult {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: ({ customerId, body }: { customerId: string; body: LawFirmReferralBody }) =>
      createLawFirmReferral(customerId, body),
    onSuccess: (_data, { customerId }) => {
      void qc.invalidateQueries({ queryKey: LAW_FIRM_REFERRAL_KEYS.suggestion(customerId) });
    },
  });

  return {
    mutate: (params, opts) => {
      mutate(params, {
        onSuccess: (data) => opts?.onSuccess?.(data),
        onError: (rawErr: unknown) => {
          let parsed: ReferralError;

          if (rawErr instanceof LawFirmCooldownError) {
            const hasCooldownDate = Boolean(rawErr.cooldown_until);
            const cooldownMessage = hasCooldownDate
              ? `Encaminhamento em cooldown até ${formatDateBR(rawErr.cooldown_until)}.`
              : 'Encaminhamento em cooldown. Aguarde antes de encaminhar novamente.';
            parsed = hasCooldownDate
              ? { message: cooldownMessage, cooldownUntil: rawErr.cooldown_until }
              : { message: cooldownMessage };
          } else if (rawErr instanceof ApiError && rawErr.status === 403) {
            parsed = {
              message: 'Funcionalidade desabilitada pelo administrador.',
              featureDisabled: true,
            };
          } else {
            const msg =
              rawErr instanceof Error
                ? rawErr.message
                : 'Erro ao encaminhar cliente. Tente novamente.';
            parsed = { message: msg };
          }

          opts?.onError?.(parsed);
        },
      });
    },
    isPending,
  };
}

// ---------------------------------------------------------------------------
// Helper local
// ---------------------------------------------------------------------------

function formatDateBR(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
