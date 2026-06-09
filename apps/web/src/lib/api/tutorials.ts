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
// Contratos espelham exatamente `apps/api/src/modules/tutorials/schemas.ts`
// (camelCase, sem paginação, POST exige idempotencyKey).
//
// LGPD: nenhum PII neste domínio — título/descrição são textos editoriais.
// =============================================================================

import { z } from 'zod';

import { api } from '../api';

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const VideoProviderSchema = z.enum(['youtube', 'vimeo', 'mp4']);
export type VideoProvider = z.infer<typeof VideoProviderSchema>;

/**
 * Item admin camelCase — espelha TutorialAdminItemSchema da API.
 * Inclui campos de auditoria (createdAt, updatedAt, createdBy, deletedAt).
 */
export const TutorialResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  featureKey: z.string(),
  title: z.string(),
  description: z.string(),
  provider: VideoProviderSchema,
  videoRef: z.string(),
  videoHash: z.string().nullable(),
  articleSlug: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type TutorialResponse = z.infer<typeof TutorialResponseSchema>;

/**
 * Resposta de GET /api/admin/tutorials — sem paginação.
 * Espelha TutorialsAdminListResponseSchema da API.
 */
export const TutorialListResponseSchema = z.object({
  data: z.array(TutorialResponseSchema),
});

export type TutorialListResponse = z.infer<typeof TutorialListResponseSchema>;

/**
 * Body de POST /api/admin/tutorials — camelCase + idempotencyKey obrigatório.
 * Espelha CreateTutorialBodySchema da API.
 */
export const TutorialCreateSchema = z.object({
  featureKey: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  provider: VideoProviderSchema,
  videoRef: z.string().min(1).max(500),
  videoHash: z.string().max(256).optional(),
  articleSlug: z.string().max(300).optional(),
  durationSeconds: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
  idempotencyKey: z.string().min(1).max(256),
});

export type TutorialCreate = z.infer<typeof TutorialCreateSchema>;

/**
 * Body de PATCH /api/admin/tutorials/:id — parcial camelCase.
 * Espelha PatchTutorialBodySchema da API (videoHash/articleSlug/durationSeconds aceitam null).
 */
export const TutorialUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(2000).optional(),
  provider: VideoProviderSchema.optional(),
  videoRef: z.string().min(1).max(500).optional(),
  videoHash: z.string().max(256).nullish(),
  articleSlug: z.string().max(300).nullish(),
  durationSeconds: z.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
});

export type TutorialUpdate = z.infer<typeof TutorialUpdateSchema>;

// feature-keys response
export const FeatureKeysResponseSchema = z.object({
  data: z.array(z.string()),
});

// ─── Funções ─────────────────────────────────────────────────────────────────

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
 * A API não pagina — retorna { data: TutorialAdminItem[] } direto.
 */
export async function listTutorials(): Promise<TutorialListResponse> {
  const raw = await api.get<unknown>('/api/admin/tutorials');
  return TutorialListResponseSchema.parse(raw);
}

/**
 * POST /api/admin/tutorials
 * Cria tutorial. Requer idempotencyKey no body.
 * Resposta = item direto (TutorialAdminItem), não { data }.
 */
export async function createTutorial(body: TutorialCreate): Promise<TutorialResponse> {
  const raw = await api.post<unknown>('/api/admin/tutorials', body);
  return TutorialResponseSchema.parse(raw);
}

/**
 * PATCH /api/admin/tutorials/:id
 * Edita tutorial. Resposta = item direto (TutorialAdminItem).
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
