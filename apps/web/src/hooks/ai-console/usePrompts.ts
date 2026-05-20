// =============================================================================
// hooks/ai-console/usePrompts.ts — TanStack Query hooks para gestão de prompts.
//
// Consome API F9-S01/F9-S08:
//   GET  /api/ai-console/prompts                    — lista keys
//   GET  /api/ai-console/prompts/:key/versions      — histórico
//   GET  /api/ai-console/prompts/:key/versions/:v   — detalhe
//   POST /api/ai-console/prompts/:key/versions      — cria versão
//   POST /api/ai-console/prompts/:key/versions/:v/activate — ativa
//
// F9-S08: PromptVersionResponseSchema e CreateVersionPayload incluem
//         temperature, max_tokens, top_p (todos nullable).
//
// LGPD: o body do prompt NUNCA é logado em console/telemetria.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '../../lib/api';

// ─── Schemas Zod (espelho dos schemas do backend) ─────────────────────────────

const PromptKeyItemSchema = z.object({
  key: z.string(),
  active_version: z.number().int().positive().nullable(),
  active_version_id: z.string().uuid().nullable(),
  model_recommended: z.string().nullable(),
  content_hash: z.string().nullable(),
  created_at: z.string().datetime().nullable(),
});

const PromptVersionResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  version: z.number().int().positive(),
  model_recommended: z.string().nullable(),
  content_hash: z.string(),
  active: z.boolean(),
  body: z.string(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  /** F9-S08: parâmetros LLM opcionais por versão. null = usar default do gateway. */
  temperature: z.number().min(0).max(2).nullable(),
  max_tokens: z.number().int().min(1).max(32_000).nullable(),
  top_p: z.number().min(0).max(1).nullable(),
});

const ActivateResponseSchema = z.object({
  ok: z.boolean(),
  activated_id: z.string().uuid(),
  key: z.string(),
  version: z.number().int().positive(),
  content_hash: z.string(),
});

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type PromptKeyItem = z.infer<typeof PromptKeyItemSchema>;
export type PromptVersion = z.infer<typeof PromptVersionResponseSchema>;
export type ActivateResponse = z.infer<typeof ActivateResponseSchema>;

export interface CreateVersionPayload {
  body: string;
  model_recommended?: string | null;
  notes?: string | null;
  /** F9-S08: parâmetros LLM opcionais. null = usar default do gateway. */
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const promptsQueryKeys = {
  all: ['ai-console', 'prompts'] as const,
  keys: () => [...promptsQueryKeys.all, 'keys'] as const,
  versions: (key: string) => [...promptsQueryKeys.all, 'versions', key] as const,
  version: (key: string, version: number) =>
    [...promptsQueryKeys.all, 'version', key, version] as const,
} as const;

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPromptKeys(): Promise<PromptKeyItem[]> {
  const raw = await api.get<unknown>('/api/ai-console/prompts');
  return z.array(PromptKeyItemSchema).parse(raw);
}

async function fetchVersions(key: string): Promise<PromptVersion[]> {
  const raw = await api.get<unknown>(`/api/ai-console/prompts/${key}/versions`);
  return z.array(PromptVersionResponseSchema).parse(raw);
}

async function fetchVersion(key: string, version: number): Promise<PromptVersion> {
  const raw = await api.get<unknown>(`/api/ai-console/prompts/${key}/versions/${version}`);
  return PromptVersionResponseSchema.parse(raw);
}

async function createVersion(key: string, payload: CreateVersionPayload): Promise<PromptVersion> {
  // LGPD: body do prompt nunca vai para console/log — apenas key e version
  const raw = await api.post<unknown>(`/api/ai-console/prompts/${key}/versions`, payload);
  return PromptVersionResponseSchema.parse(raw);
}

async function activateVersion(key: string, version: number): Promise<ActivateResponse> {
  const raw = await api.post<unknown>(
    `/api/ai-console/prompts/${key}/versions/${version}/activate`,
    {},
  );
  return ActivateResponseSchema.parse(raw);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Lista todas as prompt keys com versão ativa em destaque.
 * Cache de 30s (staleTime padrão do QueryClient global).
 */
export function usePromptKeys(): {
  keys: PromptKeyItem[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: promptsQueryKeys.keys(),
    queryFn: fetchPromptKeys,
  });

  return { keys: data ?? [], isLoading, isError };
}

/**
 * Histórico de versões de uma key específica.
 * Habilitado apenas quando key não for vazio.
 */
export function usePromptVersions(key: string): {
  versions: PromptVersion[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: promptsQueryKeys.versions(key),
    queryFn: () => fetchVersions(key),
    enabled: key.length > 0,
  });

  return { versions: data ?? [], isLoading, isError };
}

/**
 * Detalhe de uma versão específica.
 */
export function usePromptVersion(
  key: string,
  version: number | null,
): {
  promptVersion: PromptVersion | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: promptsQueryKeys.version(key, version ?? 0),
    queryFn: () => fetchVersion(key, version!),
    enabled: key.length > 0 && version !== null,
  });

  return { promptVersion: data, isLoading, isError };
}

/**
 * Mutation: cria nova versão para um key.
 * Ao sucesso: invalida lista de keys + histórico de versões.
 * LGPD: body do prompt nunca logado — apenas key + version no onSuccess.
 */
export function useCreateVersion(key: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateVersionPayload) => createVersion(key, payload),
    onSuccess: (data) => {
      // Invalida lista de keys (pode ter mudado versão ativa)
      void queryClient.invalidateQueries({ queryKey: promptsQueryKeys.keys() });
      // Invalida histórico da key
      void queryClient.invalidateQueries({ queryKey: promptsQueryKeys.versions(key) });
      // Popula cache da nova versão imediatamente (sem re-fetch)
      queryClient.setQueryData(promptsQueryKeys.version(key, data.version), data);
    },
  });
}

/**
 * Mutation: ativa uma versão específica.
 * Ao sucesso: invalida lista + histórico para refletir novo estado active.
 */
export function useActivateVersion(key: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (version: number) => activateVersion(key, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: promptsQueryKeys.keys() });
      void queryClient.invalidateQueries({ queryKey: promptsQueryKeys.versions(key) });
    },
  });
}
