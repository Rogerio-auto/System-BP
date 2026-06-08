// =============================================================================
// api-reference/useSchemaExamples.ts — Hook para carregar schema-examples.json
//
// Em dev: busca de http://localhost:3000/__dev/schema-examples (endpoint dev-only F10-S11)
// Em prod: busca de /schema-examples.json (copiado para public/ pelo CI)
//
// Falha graciosa: retorna undefined se o arquivo nao existir (build local sem
// rodar gerador). ApiReferencePage mostra mensagem de fallback na tab TS.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

export interface SchemaExample {
  ts: string;
  json: unknown;
}

export type SchemaExamplesMap = Record<string, SchemaExample>;

const SCHEMA_EXAMPLES_QUERY_KEY = ['help', 'schema-examples'] as const;

function resolveSchemaExamplesUrl(): string {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
    return `${apiBase}/__dev/schema-examples`;
  }

  // Prod: arquivo copiado para public/ pelo CI
  return '/schema-examples.json';
}

async function fetchSchemaExamples(): Promise<SchemaExamplesMap> {
  const url = resolveSchemaExamplesUrl();

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  if (!res.ok) {
    // Non-fatal: 404 = gerador ainda nao foi rodado
    if (res.status === 404) {
      return {};
    }
    throw new Error(`Falha ao buscar schema-examples: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as unknown;

  if (typeof data !== 'object' || data === null) {
    throw new Error('schema-examples.json nao e um objeto valido');
  }

  return data as SchemaExamplesMap;
}

export interface UseSchemaExamplesResult {
  schemaExamples: SchemaExamplesMap | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Carrega schema-examples.json gerado por F10-S11.
 * Retorna undefined se o arquivo nao existir — nao quebra a UI.
 *
 * Cache: 1 hora (staleTime: 3_600_000).
 */
export function useSchemaExamples(): UseSchemaExamplesResult {
  const query = useQuery({
    queryKey: SCHEMA_EXAMPLES_QUERY_KEY,
    queryFn: fetchSchemaExamples,
    staleTime: 3_600_000, // 1 hora
    retry: 1,
    // Nao exibir erro na UI — fallback graciosa
    throwOnError: false,
  });

  return {
    schemaExamples: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
