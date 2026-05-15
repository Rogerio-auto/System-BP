// =============================================================================
// hooks/simulator/useSimulate.ts — Mutation de simulação de crédito (F2-S06).
//
// POST /api/simulations → SimulationResult com tabela de amortização.
// TanStack Query useMutation — sem useEffect+fetch.
// Não invalida cache: simulação é append-only, não afeta listas.
//
// CONTRATO (F2-S11):
//   Request : body camelCase (leadId/productId/amount/termMonths)
//   Response: snake_case; monetários retornam como string → normalizados aqui
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

// ─── Shape bruto do backend (antes da normalização) ──────────────────────────

/**
 * Response bruta do backend — monetários são string ("5000.00").
 * Apenas para uso interno do normalizer.
 */
interface RawSimulationResponse {
  id: string;
  organization_id: string;
  lead_id: string;
  product_id: string;
  rule_version_id: string;
  amount_requested: string; // string no wire — ex: "5000.00"
  term_months: number;
  monthly_payment: string; // string no wire
  total_amount: string; // string no wire
  total_interest: string; // string no wire
  rate_monthly_snapshot: string; // string no wire — ex: "0.0199"
  amortization_method: 'price' | 'sac';
  amortization_table: Array<{
    number: number;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
  }>;
  origin: 'manual' | 'ai' | 'import';
  created_by_user_id: string | null;
  created_at: string;
}

/**
 * Normaliza a resposta bruta do backend:
 * converte os campos monetários string→number uma única vez.
 * A UI trabalha sempre com number.
 */
function normalizeResponse(raw: RawSimulationResponse): SimulationResult {
  return {
    id: raw.id,
    organization_id: raw.organization_id,
    lead_id: raw.lead_id,
    product_id: raw.product_id,
    rule_version_id: raw.rule_version_id,
    amount_requested: Number(raw.amount_requested),
    term_months: raw.term_months,
    monthly_payment: Number(raw.monthly_payment),
    total_amount: Number(raw.total_amount),
    total_interest: Number(raw.total_interest),
    rate_monthly_snapshot: Number(raw.rate_monthly_snapshot),
    amortization_method: raw.amortization_method,
    amortization_table: raw.amortization_table,
    origin: raw.origin,
    created_by_user_id: raw.created_by_user_id,
    created_at: raw.created_at,
  };
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function postSimulation(body: SimulationBody): Promise<SimulationResult> {
  const raw = await api.post<RawSimulationResponse>('/api/simulations', body);
  return normalizeResponse(raw);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mutation de simulação de crédito.
 *
 * Uso:
 *   const { mutate, isPending, data, simulationError, reset } = useSimulate();
 *   mutate({ leadId, productId, amount, termMonths });
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
