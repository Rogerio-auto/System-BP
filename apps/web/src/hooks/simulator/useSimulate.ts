// =============================================================================
// hooks/simulator/useSimulate.ts — Mutation de simulação de crédito (F2-S06).
//
// POST /api/simulations → SimulationResult com tabela de amortização.
// TanStack Query useMutation — sem useEffect+fetch.
// Não invalida cache: simulação é append-only, não afeta listas.
// =============================================================================

import { useMutation } from '@tanstack/react-query';

import { ApiError } from '../../lib/api';
import { api } from '../../lib/api';

import type { SimulationBody, SimulationResult } from './types';

// ─── Erro tipado de simulação ─────────────────────────────────────────────────

export type SimulationErrorCode =
  | 'VALIDATION_ERROR' // 422 — fora dos limites da regra
  | 'NO_RULE_FOR_CITY' // 409 — sem regra ativa para a cidade do lead
  | 'FLAG_DISABLED' // 503 / 403 — módulo desativado
  | 'FORBIDDEN' // 403 — sem permissão
  | 'UNKNOWN';

export interface SimulationError {
  code: SimulationErrorCode;
  message: string;
  fieldErrors?: Record<string, string>; // campos com erros para 422
}

function classifyError(err: unknown): SimulationError {
  if (err instanceof ApiError) {
    if (err.status === 422) {
      return {
        code: 'VALIDATION_ERROR',
        message: err.message,
      };
    }
    if (err.status === 409) {
      return {
        code: 'NO_RULE_FOR_CITY',
        message: err.message || 'Sem regra de crédito ativa para a cidade do lead.',
      };
    }
    if (err.status === 503) {
      return {
        code: 'FLAG_DISABLED',
        message: 'Módulo de simulação desativado.',
      };
    }
    if (err.status === 403) {
      return {
        code: 'FORBIDDEN',
        message: 'Sem permissão para simular crédito.',
      };
    }
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : 'Erro desconhecido.',
  };
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function postSimulation(body: SimulationBody): Promise<SimulationResult> {
  return api.post<SimulationResult>('/api/simulations', body);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mutation de simulação de crédito.
 *
 * Uso:
 *   const { mutate, isPending, data, simulationError, reset } = useSimulate();
 *   mutate({ lead_id, product_id, requested_amount, term_months });
 *
 * Erros classificados em SimulationErrorCode para UX específica por código.
 */
export function useSimulate(): {
  mutate: (body: SimulationBody) => void;
  isPending: boolean;
  data: SimulationResult | undefined;
  simulationError: SimulationError | null;
  reset: () => void;
} {
  const { mutate, isPending, data, error, reset } = useMutation<
    SimulationResult,
    unknown,
    SimulationBody
  >({
    mutationFn: postSimulation,
  });

  const simulationError: SimulationError | null = error ? classifyError(error) : null;

  return { mutate, isPending, data, simulationError, reset };
}
