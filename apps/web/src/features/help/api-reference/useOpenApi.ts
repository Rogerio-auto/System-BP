// =============================================================================
// api-reference/useOpenApi.ts — Hook TanStack Query para o spec OpenAPI
//
// Dev/staging: GET /openapi.json (exposto pelo backend F10-S09)
// Prod (VITE_OPENAPI_PUBLIC_ENABLED !== 'true'): GET /api-reference.json
//   (arquivo pré-renderizado por F10-S11, copiado para apps/web/public/)
//
// Cache: 1 hora (staleTime: 3_600_000). O spec é estável por deploy.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import type { OpenApiSpec } from './types';

const OPENAPI_QUERY_KEY = ['help', 'openapi'] as const;

/** URL do spec — resolvida em build time via variáveis de ambiente */
function resolveSpecUrl(): string {
  const isDev = import.meta.env.DEV;
  const publicEnabled = import.meta.env.VITE_OPENAPI_PUBLIC_ENABLED === 'true';

  if (isDev || publicEnabled) {
    // Em dev, Vite proxy não é necessário porque a API roda em :3000 e o
    // servidor dev tem target configurado. Em prod com flag, busca direto.
    const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
    return `${apiBase}/openapi.json`;
  }

  // Prod sem flag: JSON pré-renderizado por F10-S11 em apps/web/public/
  return '/api-reference.json';
}

async function fetchOpenApiSpec(): Promise<OpenApiSpec> {
  const url = resolveSpecUrl();
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    // Não passa credenciais — o endpoint /openapi.json é público (ou semi-público
    // com flag). Em prod sem a flag, lemos arquivo estático local.
    credentials: 'omit',
  });

  if (!res.ok) {
    throw new Error(`Falha ao buscar spec OpenAPI: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as unknown;

  // Validação mínima — garante que recebemos um spec OpenAPI válido
  if (typeof data !== 'object' || data === null || !('openapi' in data) || !('paths' in data)) {
    throw new Error('Resposta não é um spec OpenAPI válido');
  }

  return data as OpenApiSpec;
}

export interface UseOpenApiResult {
  spec: OpenApiSpec | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Busca e cacheia o spec OpenAPI por 1 hora.
 *
 * @example
 * const { spec, isLoading } = useOpenApi();
 */
export function useOpenApi(): UseOpenApiResult {
  const query = useQuery({
    queryKey: OPENAPI_QUERY_KEY,
    queryFn: fetchOpenApiSpec,
    staleTime: 3_600_000, // 1 hora
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });

  return {
    spec: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
