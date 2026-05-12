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
// =============================================================================

import { api } from '../api';

// ─── Tipos espelhando schemas do backend ──────────────────────────────────────

export interface ImportBatch {
  id: string;
  organizationId: string;
  entityType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: ImportBatchStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
  createdAt: string;
  updatedAt: string;
}

export type ImportBatchStatus =
  | 'uploaded'
  | 'parsing'
  | 'ready_for_review'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ImportPreviewRow {
  id: string;
  rowIndex: number;
  status: ImportRowStatus;
  rawData: Record<string, unknown>;
  normalizedData: Record<string, unknown> | null;
  validationErrors: string[] | null;
  entityId: string | null;
}

export type ImportRowStatus = 'valid' | 'invalid' | 'pending' | 'persisted' | 'failed';

export interface ImportPreviewResponse {
  batch: ImportBatch;
  rows: ImportPreviewRow[];
  total: number;
  page: number;
  perPage: number;
}

export interface UploadResponse {
  batchId: string;
  status: string;
  message: string;
}

export interface ConfirmResponse {
  id: string;
  status: string;
  message: string;
}

// ─── Parâmetros de preview ────────────────────────────────────────────────────

export interface PreviewParams {
  page?: number;
  perPage?: number;
  status?: ImportRowStatus;
}

// ─── Funções de API ───────────────────────────────────────────────────────────

/**
 * Faz upload de arquivo de leads (CSV ou XLSX).
 * Usa fetch diretamente pois é multipart/form-data — não JSON.
 * O wrapper api.post é JSON-only.
 */
export async function uploadLeadsFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const API_BASE =
    (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3000';

  // Lê token do store sem importar o módulo Zustand direto
  // (para manter separação de camadas — api.ts lida com auth)
  const res = await fetch(`${API_BASE}/api/imports/leads`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
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

  return res.json() as Promise<UploadResponse>;
}

/**
 * Busca status e metadados do batch.
 */
export function getImportBatch(batchId: string): Promise<ImportBatch> {
  return api.get<ImportBatch>(`/api/imports/${batchId}`);
}

/**
 * Busca linhas do batch com paginação e filtro de status.
 */
export function getImportPreview(
  batchId: string,
  params: PreviewParams = {},
): Promise<ImportPreviewResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.perPage !== undefined) query.set('perPage', String(params.perPage));
  if (params.status !== undefined) query.set('status', params.status);
  const qs = query.toString();
  return api.get<ImportPreviewResponse>(`/api/imports/${batchId}/preview${qs ? `?${qs}` : ''}`);
}

/**
 * Confirma batch para processamento. Ação irreversível.
 */
export function confirmImportBatch(batchId: string): Promise<ConfirmResponse> {
  return api.post<ConfirmResponse>(`/api/imports/${batchId}/confirm`, {});
}

/**
 * Cancela batch antes de confirmar.
 */
export function cancelImportBatch(batchId: string): Promise<ConfirmResponse> {
  return api.post<ConfirmResponse>(`/api/imports/${batchId}/cancel`, {});
}
