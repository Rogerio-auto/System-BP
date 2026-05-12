// =============================================================================
// hooks/crm/useLead.ts — Detalhe de um lead por ID.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadInteraction, LeadResponse } from './types';

export const LEAD_QUERY_KEY = (id: string) => ['leads', 'detail', id] as const;
export const LEAD_INTERACTIONS_KEY = (id: string) => ['leads', 'interactions', id] as const;

// ─── Mock interactions (TODO: remover quando endpoint disponível) ─────────────

function mockInteractions(leadId: string): LeadInteraction[] {
  return [
    {
      id: `inter-${leadId}-1`,
      leadId,
      type: 'system',
      content: 'Lead criado via WhatsApp',
      actorName: 'Sistema',
      createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    },
    {
      id: `inter-${leadId}-2`,
      leadId,
      type: 'note',
      content:
        'Primeiro contato realizado. Lead demonstrou interesse em microcrédito para capital de giro.',
      actorName: 'Agente João',
      createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    },
    {
      id: `inter-${leadId}-3`,
      leadId,
      type: 'status_change',
      content: 'Status alterado: Novo → Qualificando',
      actorName: 'Agente João',
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    },
    {
      id: `inter-${leadId}-4`,
      leadId,
      type: 'whatsapp',
      content: 'Mensagem enviada solicitando documentação complementar.',
      actorName: 'Agente Maria',
      createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    },
  ];
}

// ─── Fetch detalhe ────────────────────────────────────────────────────────────

async function fetchLead(id: string): Promise<LeadResponse> {
  try {
    return await api.get<LeadResponse>(`/api/leads/${id}`);
  } catch {
    // Mock fallback
    return {
      id,
      organization_id: 'org-001',
      city_id: 'city-001',
      agent_id: 'agent-001',
      name: 'Ana Paula Ferreira',
      phone_e164: '+5569912341234',
      source: 'whatsapp',
      status: 'qualifying',
      email: 'anapaula.ferreira@gmail.com',
      notes: 'Interessada em microcrédito para artesanato. Atendida pela primeira vez em 08/05.',
      metadata: {},
      created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      deleted_at: null,
    };
  }
}

// ─── Fetch interações ─────────────────────────────────────────────────────────

async function fetchInteractions(leadId: string): Promise<LeadInteraction[]> {
  try {
    return await api.get<LeadInteraction[]>(`/api/leads/${leadId}/interactions`);
  } catch {
    return mockInteractions(leadId);
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Detalhe de um lead por ID.
 */
export function useLead(id: string): {
  lead: LeadResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: LEAD_QUERY_KEY(id),
    queryFn: () => fetchLead(id),
    staleTime: 30_000,
    enabled: Boolean(id),
  });

  return { lead: data, isLoading, isError };
}

/**
 * Timeline de interações de um lead.
 */
export function useLeadInteractions(leadId: string): {
  interactions: LeadInteraction[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: LEAD_INTERACTIONS_KEY(leadId),
    queryFn: () => fetchInteractions(leadId),
    staleTime: 30_000,
    enabled: Boolean(leadId),
  });

  return { interactions: data ?? [], isLoading };
}
