// =============================================================================
// features/help/contextual/useContextualTutorials.ts
//
// Hook TanStack Query que carrega a lista de tutoriais ativos do backend e
// indexa por featureKey para acesso O(1).
//
// Contrato de entrada: GET /api/help/tutorials (F12-S02)
//   - Retorna apenas tutoriais is_active=true.
//   - Endpoint público para qualquer usuário autenticado.
//
// Contrato de saída:
//   - tutorialsByKey: Record<string, TutorialEntry> — mapa indexado por featureKey.
//   - isLoading, isError — passados direto do useQuery.
//
// Cache: 5 minutos (payload pequeno; tutoriais mudam raramente em produção).
// Norma 21 §7 — dados não contêm PII.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../../lib/api';

// ─── Tipos (shape do endpoint F12-S02) ───────────────────────────────────────

/** Shape de um tutorial retornado por GET /api/help/tutorials. */
export interface TutorialEntry {
  id: string;
  featureKey: string;
  title: string;
  description: string;
  provider: string;
  videoRef: string;
  hash?: string | null;
  /** Slug do artigo da Central de Ajuda vinculado a este tutorial. */
  articleSlug: string | null;
  isActive: boolean;
}

interface TutorialsApiResponse {
  data: TutorialEntry[];
}

// ─── Query key ───────────────────────────────────────────────────────────────

export const TUTORIALS_QUERY_KEY = ['help', 'tutorials'] as const;

// ─── Stale time: 5 minutos ───────────────────────────────────────────────────

const STALE_TIME_MS = 5 * 60 * 1_000;

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchTutorials(): Promise<TutorialEntry[]> {
  const res = await api.get<TutorialsApiResponse>('/api/help/tutorials');
  return res.data;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseContextualTutorialsResult {
  /**
   * Mapa indexado por featureKey → TutorialEntry.
   * Contém apenas tutoriais ativos (is_active=true — filtrado no servidor).
   */
  tutorialsByKey: Record<string, TutorialEntry>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Carrega tutoriais ativos e indexa por featureKey.
 *
 * @example
 * const { tutorialsByKey } = useContextualTutorials();
 * const tutorial = tutorialsByKey['crm.lead.create'];
 * // tutorial === undefined → sem tutorial ativo para essa key.
 */
export function useContextualTutorials(): UseContextualTutorialsResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: TUTORIALS_QUERY_KEY,
    queryFn: fetchTutorials,
    staleTime: STALE_TIME_MS,
    // Não lança error no nível do hook — chamadores tratam via isError ou
    // simplesmente não renderizam o ⓘ se não há dados.
    retry: 1,
  });

  // Indexa por featureKey para acesso O(1) nos componentes.
  const tutorialsByKey: Record<string, TutorialEntry> = {};
  if (data) {
    for (const t of data) {
      tutorialsByKey[t.featureKey] = t;
    }
  }

  return { tutorialsByKey, isLoading, isError };
}
