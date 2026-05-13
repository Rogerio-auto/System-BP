// =============================================================================
// hooks/useCitiesList.ts — Lista resumida de cidades para popular selects.
//
// Endpoint: GET /api/cities (qualquer user autenticado).
// Retorna apenas { id, name, state_uf } — shape minimo, sem PII.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '../lib/api';

const CityPublicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  state_uf: z.string(),
});

const CityPublicListResponseSchema = z.object({
  cities: z.array(CityPublicSchema),
});

export type CityPublic = z.infer<typeof CityPublicSchema>;

export const CITIES_LIST_QUERY_KEY = ['cities', 'public-list'] as const;

async function fetchCitiesList(): Promise<CityPublic[]> {
  const raw = await api.get<unknown>('/api/cities');
  return CityPublicListResponseSchema.parse(raw).cities;
}

/**
 * Lista de cidades ativas da org para popular selects (NewLeadModal,
 * filtros do CRM/Kanban etc). Cache de 5 min — cidades raramente mudam.
 */
export function useCitiesList(): {
  cities: CityPublic[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: CITIES_LIST_QUERY_KEY,
    queryFn: fetchCitiesList,
    staleTime: 5 * 60_000,
  });

  return {
    cities: data ?? [],
    isLoading,
    isError,
  };
}
