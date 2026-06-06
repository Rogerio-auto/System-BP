import { useQuery } from '@tanstack/react-query';

import { getArticleBySlug } from '../manifest';

// ---------------------------------------------------------------------------
// Shape retornado pelo backend GET /api/help/popular
// ---------------------------------------------------------------------------

interface PopularSlug {
  slug: string;
  count: number;
}

interface PopularApiResponse {
  data: PopularSlug[];
  period_days: number;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Shape enriquecido com título — manifest resolve título por slug.
// ---------------------------------------------------------------------------

export interface PopularItem {
  slug: string;
  title: string;
  count: number;
}

// 10 minutos — backend já tem cache interno de 10min no popular.
const STALE_TIME_MS = 600_000;

async function fetchPopular(limit: number): Promise<PopularItem[]> {
  const res = await fetch(`/api/help/popular?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`popular fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as PopularApiResponse;

  // Resolve título de cada slug via manifest (lazy-loaded, cache interno).
  const items = await Promise.all(
    body.data.map(async ({ slug, count }) => {
      const article = await getArticleBySlug(slug);
      // Slug pode existir no DB mas não no manifest (artigo deletado).
      // Nesse caso, usa fallback legível.
      const title =
        article?.title ??
        slug
          .split('/')
          .pop()
          ?.replace(/-/g, ' ')
          .replace(/^\w/, (c) => c.toUpperCase()) ??
        slug;
      return { slug, title, count };
    }),
  );

  return items;
}

/**
 * Hook TanStack Query para listar artigos mais vistos.
 *
 * - staleTime: 10 min (alinhado com cache in-memory do backend).
 * - Enriquece slug→título via manifest local (sem RTT extra).
 */
export function usePopular(limit = 10) {
  return useQuery({
    queryKey: ['help', 'popular', limit],
    queryFn: () => fetchPopular(limit),
    staleTime: STALE_TIME_MS,
  });
}
