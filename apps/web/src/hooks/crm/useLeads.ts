// =============================================================================
// hooks/crm/useLeads.ts — Lista paginada de leads com filtros.
//
// TanStack Query — nunca useEffect+fetch.
// Query key inclui filtros para que cada combinação seja cacheada separadamente.
// Fallback mock quando endpoint não disponível (TODO: remover pós F1-S11 deploy).
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { LeadFilters, LeadListResponse } from './types';

export const LEADS_QUERY_KEY = (filters: LeadFilters) => ['leads', 'list', filters] as const;

// ─── Mock data (remover quando GET /api/leads disponível) ─────────────────────

const MOCK_LEADS: LeadListResponse = {
  data: [
    {
      id: 'a1b2c3d4-0000-0000-0000-000000000001',
      organization_id: 'org-001',
      city_id: 'city-001',
      agent_id: 'agent-001',
      name: 'Ana Paula Ferreira',
      phone_e164: '+5569912341234',
      source: 'whatsapp',
      status: 'qualifying',
      email: 'anapaula.ferreira@gmail.com',
      notes: 'Interessada em microcrédito para artesanato',
      metadata: {},
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      deleted_at: null,
    },
    {
      id: 'a1b2c3d4-0000-0000-0000-000000000002',
      organization_id: 'org-001',
      city_id: 'city-001',
      agent_id: null,
      name: 'Carlos Eduardo Mendes',
      phone_e164: '+5569998765432',
      source: 'manual',
      status: 'new',
      email: null,
      notes: null,
      metadata: {},
      created_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      deleted_at: null,
    },
    {
      id: 'a1b2c3d4-0000-0000-0000-000000000003',
      organization_id: 'org-001',
      city_id: 'city-002',
      agent_id: 'agent-002',
      name: 'Fernanda Lima Santos',
      phone_e164: '+5569911119999',
      source: 'manual',
      status: 'simulation',
      email: 'fernanda.lima@hotmail.com',
      notes: 'Documentação enviada',
      metadata: {},
      created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      deleted_at: null,
    },
    {
      id: 'a1b2c3d4-0000-0000-0000-000000000004',
      organization_id: 'org-001',
      city_id: 'city-001',
      agent_id: 'agent-001',
      name: 'João Roberto Oliveira',
      phone_e164: '+5569922223333',
      source: 'whatsapp',
      status: 'closed_won',
      email: 'joao.roberto@empresa.com.br',
      notes: 'Contrato assinado em 08/05',
      metadata: {},
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      deleted_at: null,
    },
    {
      id: 'a1b2c3d4-0000-0000-0000-000000000005',
      organization_id: 'org-001',
      city_id: 'city-003',
      agent_id: null,
      name: 'Maria Aparecida Costa',
      phone_e164: '+5569933334444',
      source: 'import',
      status: 'closed_lost',
      email: null,
      notes: 'Não atendeu após 3 tentativas',
      metadata: {},
      created_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      deleted_at: null,
    },
  ],
  pagination: {
    page: 1,
    limit: 20,
    total: 5,
    totalPages: 1,
  },
};

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchLeads(filters: LeadFilters): Promise<LeadListResponse> {
  const params = new URLSearchParams();

  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.city_id) params.set('city_id', filters.city_id);
  if (filters.agent_id) params.set('agent_id', filters.agent_id);

  const qs = params.toString();

  try {
    return await api.get<LeadListResponse>(`/api/leads${qs ? `?${qs}` : ''}`);
  } catch {
    // TODO: remover mock quando GET /api/leads disponível em produção
    return MOCK_LEADS;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Lista paginada de leads com filtros.
 * Query key inclui filtros: cada combinação tem cache separado.
 */
export function useLeads(filters: LeadFilters = {}): {
  data: LeadListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: LEADS_QUERY_KEY(filters),
    queryFn: () => fetchLeads(filters),
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
