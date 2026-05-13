// =============================================================================
// lib/api/imports.ts — Funções de API para importações (F1-S18).
//
// Endpoints consumidos:
//   POST /api/imports/leads              — upload de arquivo
//   GET  /api/imports/:id                — status do batch
//   GET  /api/imports/:id/preview        — linhas paginadas
//   POST /api/imports/:id/confirm        — confirmar processamento
//   POST /api/imports/:id/cancel         — cancelar batch
//
// LGPD: conteúdo dos arquivos não é logado — doc 17.
//
// Segurança (M1): todas as respostas de rede são validadas com Zod antes de
// chegar ao restante da aplicação. O wrapper `api.*` NÃO valida por conta
// própria — o parse deve ser feito aqui, na borda da camada de rede.
// =============================================================================

import { z } from 'zod';

import { api } from '../api';
import { useAuthStore } from '../auth-store';

// ─── Schemas Zod (fonte de verdade: apps/api/src/modules/imports/schemas.ts) ─

/**
 * Schema do batch espelhando ImportBatchResponseSchema do backend.
 * Mantido aqui (e não importado de shared-schemas) porque shared-schemas
 * ainda não exporta tipos de importação — quando exportar, reusar de lá.
 */
export const ImportBatchSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: z.string(),
  fileName: z.string(),
  fileSize: z.number().int(),
  mimeType: z.string(),
  status: z.enum([
    'uploaded',
    'parsing',
    'ready_for_review',
    'processing',
    'completed',
    'failed',
    'cancelled',
  ]),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const UploadResponseSchema = z.object({
  batchId: z.string().uuid(),
  status: z.string(),
  message: z.string(),
});

export const ImportPreviewRowSchema = z.object({
  id: z.string().uuid(),
  rowIndex: z.number().int(),
  status: z.enum(['valid', 'invalid', 'pending', 'persisted', 'failed']),
  rawData: z.record(z.unknown()),
  normalizedData: z.record(z.unknown()).nullable(),
  validationErrors: z.array(z.string()).nullable(),
  entityId: z.string().uuid().nullable(),
});

export const ImportPreviewResponseSchema = z.object({
  batch: ImportBatchSchema,
  rows: z.array(ImportPreviewRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
});

export const ConfirmResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  message: z.string(),
});

// ─── Tipos inferidos dos schemas ──────────────────────────────────────────────

export type ImportBatch = z.infer<typeof ImportBatchSchema>;

/** Status válidos de um batch — extraídos do schema para type-safety. */
export type ImportBatchStatus =
  | 'uploaded'
  | 'parsing'
  | 'ready_for_review'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ImportPreviewRow = z.infer<typeof ImportPreviewRowSchema>;

/** Status válidos de uma linha — extraídos do schema para type-safety. */
export type ImportRowStatus = 'valid' | 'invalid' | 'pending' | 'persisted' | 'failed';

export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type ConfirmResponse = z.infer<typeof ConfirmResponseSchema>;

// ─── Parâmetros de preview ────────────────────────────────────────────────────

export interface PreviewParams {
  page?: number;
  perPage?: number;
  status?: ImportRowStatus;
}

// ─── Funções de API ───────────────────────────────────────────────────────────

/**
 * Faz upload de arquivo de leads (CSV ou XLSX).
 * Usa fetch diretamente pois é multipart/form-data — o wrapper api.post é JSON-only.
 * A resposta é validada com UploadResponseSchema antes de retornar.
 */
export async function uploadLeadsFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const API_BASE =
    (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3333';

  // Authorization header — multipart/form-data nao passa pelo wrapper api.*
  // que normalmente injeta o Bearer. Sem isso, /api/imports/leads retorna 401.
  const accessToken = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE}/api/imports/leads`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // body não era JSON
    }
    throw new Error(message);
  }

  // M1: parse + validação via Zod — lança ZodError se shape inesperado
  return UploadResponseSchema.parse(await res.json());
}

/**
 * Busca status e metadados do batch.
 * Resposta validada com ImportBatchSchema.
 */
export async function getImportBatch(batchId: string): Promise<ImportBatch> {
  const raw = await api.get<unknown>(`/api/imports/${batchId}`);
  return ImportBatchSchema.parse(raw);
}

/**
 * Busca linhas do batch com paginação e filtro de status.
 * Resposta validada com ImportPreviewResponseSchema.
 */
export async function getImportPreview(
  batchId: string,
  params: PreviewParams = {},
): Promise<ImportPreviewResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.perPage !== undefined) query.set('perPage', String(params.perPage));
  if (params.status !== undefined) query.set('status', params.status);
  const qs = query.toString();
  const raw = await api.get<unknown>(`/api/imports/${batchId}/preview${qs ? `?${qs}` : ''}`);
  return ImportPreviewResponseSchema.parse(raw);
}

/**
 * Confirma batch para processamento. Ação irreversível.
 * Resposta validada com ConfirmResponseSchema.
 */
export async function confirmImportBatch(batchId: string): Promise<ConfirmResponse> {
  const raw = await api.post<unknown>(`/api/imports/${batchId}/confirm`, {});
  return ConfirmResponseSchema.parse(raw);
}

/**
 * Cancela batch antes de confirmar.
 * Resposta validada com ConfirmResponseSchema.
 */
export async function cancelImportBatch(batchId: string): Promise<ConfirmResponse> {
  const raw = await api.post<unknown>(`/api/imports/${batchId}/cancel`, {});
  return ConfirmResponseSchema.parse(raw);
}
