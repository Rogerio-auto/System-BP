// =============================================================================
// lib/api/tutorials.ts — Cliente de API para o domínio de tutoriais em vídeo.
//
// Endpoints consumidos:
//   GET  /api/admin/feature-keys        → catálogo fechado de feature_key
//   GET  /api/admin/tutorials           → lista completa (inclui inativos)
//   POST /api/admin/tutorials           → criar tutorial
//   PATCH /api/admin/tutorials/:id      → editar tutorial
//   DELETE /api/admin/tutorials/:id     → soft-delete
//
// Todos os tipos são derivados inline (sem shared-schemas para o módulo de
// tutoriais que ainda não tem pacote gerado). Validação Zod nas bordas.
//
// LGPD: nenhum PII neste domínio — título/descrição são textos editoriais.
// =============================================================================

import { z } from 'zod';

import { api } from '../api';

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const VideoProviderSchema = z.enum(['youtube', 'vimeo', 'mp4']);
export type VideoProvider = z.infer<typeof VideoProviderSchema>;

export const TutorialResponseSchema = z.object({
  id: z.string().uuid(),
  feature_key: z.string(),
  title: z.string(),
  description: z.string(),
  provider: VideoProviderSchema,
  video_ref: z.string(),
  video_hash: z.string().nullable(),
  article_slug: z.string().nullable(),
  duration_seconds: z.number().int().nullable(),
  is_active: z.boolean(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type TutorialResponse = z.infer<typeof TutorialResponseSchema>;

export const TutorialListResponseSchema = z.object({
  data: z.array(TutorialResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type TutorialListResponse = z.infer<typeof TutorialListResponseSchema>;

export const TutorialCreateSchema = z.object({
  feature_key: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  provider: VideoProviderSchema,
  video_ref: z.string().min(1).max(500),
  video_hash: z.string().max(100).optional(),
  article_slug: z.string().max(255).optional(),
  duration_seconds: z.number().int().positive().optional(),
  is_active: z.boolean().default(true),
});

export type TutorialCreate = z.infer<typeof TutorialCreateSchema>;

export const TutorialUpdateSchema = TutorialCreateSchema.partial();
export type TutorialUpdate = z.infer<typeof TutorialUpdateSchema>;

// feature-keys response
export const FeatureKeysResponseSchema = z.object({
  data: z.array(z.string()),
});

// ─── Funções ─────────────────────────────────────────────────────────────────

export interface TutorialListParams {
  page?: number;
  limit?: number;
}

/**
 * GET /api/admin/feature-keys
 * Catálogo fechado de feature_key (dropdown no form).
 */
export async function listFeatureKeys(): Promise<string[]> {
  const raw = await api.get<unknown>('/api/admin/feature-keys');
  const parsed = FeatureKeysResponseSchema.parse(raw);
  return parsed.data;
}

/**
 * GET /api/admin/tutorials
 * Lista completa de tutoriais (inclui inativos). Acesso: tutorials:manage.
 */
export async function listTutorials(
  params: TutorialListParams = {},
): Promise<TutorialListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const raw = await api.get<unknown>(
    `/api/admin/tutorials${qs.toString() ? `?${qs.toString()}` : ''}`,
  );
  return TutorialListResponseSchema.parse(raw);
}

/**
 * POST /api/admin/tutorials
 * Cria tutorial. Idempotência + audit no backend.
 */
export async function createTutorial(body: TutorialCreate): Promise<TutorialResponse> {
  const raw = await api.post<unknown>('/api/admin/tutorials', body);
  return TutorialResponseSchema.parse(raw);
}

/**
 * PATCH /api/admin/tutorials/:id
 * Edita tutorial. Audit no backend.
 */
export async function updateTutorial(id: string, body: TutorialUpdate): Promise<TutorialResponse> {
  const raw = await api.patch<unknown>(`/api/admin/tutorials/${encodeURIComponent(id)}`, body);
  return TutorialResponseSchema.parse(raw);
}

/**
 * DELETE /api/admin/tutorials/:id
 * Soft-delete. Audit no backend.
 */
export async function deleteTutorial(id: string): Promise<void> {
  await api.delete<void>(`/api/admin/tutorials/${encodeURIComponent(id)}`);
}
