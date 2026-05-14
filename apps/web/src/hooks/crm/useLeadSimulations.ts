// =============================================================================
// hooks/crm/useLeadSimulations.ts — Histórico de simulações de crédito de um lead.
//
// Usa TanStack Query. Nunca useEffect + fetch.
// LGPD: resposta não contém PII — apenas dados financeiros + metadados.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadSimulation, LeadSimulationsResponse } from './types';

export const LEAD_SIMULATIONS_KEY = (leadId: string) => ['leads', 'simulations', leadId] as const;

// ─── Mock data (fallback quando API ainda não responde) ───────────────────────

function mockSimulations(leadId: string): LeadSimulationsResponse {
  return {
    data: [
      {
        id: `sim-${leadId}-1`,
        productId: 'prod-001',
        productName: 'Microcrédito Básico',
        amount: 2500,
        termMonths: 12,
        monthlyPayment: 234.56,
        totalAmount: 2814.72,
        totalInterest: 314.72,
        rateMonthlySnapshot: 0.02,
        amortizationMethod: 'price',
        amortizationTable: {
          method: 'price',
          amount: 2500,
          termMonths: 12,
          monthlyRate: 0.02,
          installments: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            payment: 234.56,
            principal: 234.56 - (2500 * 0.02 * Math.pow(1.02, i)) / (Math.pow(1.02, 12) - 1),
            interest: (2500 * 0.02 * Math.pow(1.02, i)) / (Math.pow(1.02, 12) - 1),
            balance: Math.max(
              0,
              2500 * Math.pow(1.02, i + 1) - (234.56 * (Math.pow(1.02, i + 1) - 1)) / 0.02,
            ),
          })),
          totalPayment: 2814.72,
          totalInterest: 314.72,
        },
        ruleVersion: 3,
        origin: 'manual',
        createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      },
      {
        id: `sim-${leadId}-2`,
        productId: 'prod-001',
        productName: 'Microcrédito Básico',
        amount: 1500,
        termMonths: 6,
        monthlyPayment: 265.12,
        totalAmount: 1590.72,
        totalInterest: 90.72,
        rateMonthlySnapshot: 0.015,
        amortizationMethod: 'sac',
        amortizationTable: {
          method: 'sac',
          amount: 1500,
          termMonths: 6,
          monthlyRate: 0.015,
          installments: Array.from({ length: 6 }, (_, i) => {
            const principal = 1500 / 6;
            const balance = 1500 - principal * i;
            return {
              number: i + 1,
              payment: principal + balance * 0.015,
              principal,
              interest: balance * 0.015,
              balance: Math.max(0, balance - principal),
            };
          }),
          totalPayment: 1590.72,
          totalInterest: 90.72,
        },
        ruleVersion: 2,
        origin: 'ai',
        createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      },
    ],
    nextCursor: null,
  };
}

// ─── Fetch function ───────────────────────────────────────────────────────────

async function fetchLeadSimulations(
  leadId: string,
  cursor?: string,
  limit?: number,
): Promise<LeadSimulationsResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));

  const qs = params.toString();
  const url = `/api/leads/${leadId}/simulations${qs ? `?${qs}` : ''}`;

  try {
    return await api.get<LeadSimulationsResponse>(url);
  } catch {
    // Mock fallback during development
    return mockSimulations(leadId);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Histórico de simulações de crédito de um lead.
 * Pagina por cursor (primeiros 20 resultados).
 */
export function useLeadSimulations(leadId: string): {
  simulations: LeadSimulation[];
  nextCursor: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: LEAD_SIMULATIONS_KEY(leadId),
    queryFn: () => fetchLeadSimulations(leadId),
    staleTime: 30_000,
    enabled: Boolean(leadId),
  });

  return {
    simulations: data?.data ?? [],
    nextCursor: data?.nextCursor ?? null,
    isLoading,
    isError,
  };
}
