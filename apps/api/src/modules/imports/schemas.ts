// =============================================================================
// modules/imports/schemas.ts — Schemas Zod para rotas de importação (F1-S17).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Batch response (GET /api/imports/:id)
// ---------------------------------------------------------------------------

export const ImportBatchResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: z.string(),
  fileName: z.string(),
  fileSize: z.number().int(),
  mimeType: z.string(),
  status: z.string(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  processedRows: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ImportBatchResponse = z.infer<typeof ImportBatchResponseSchema>;

// ---------------------------------------------------------------------------
// Upload response (POST /api/imports/leads)
// ---------------------------------------------------------------------------

export const UploadResponseSchema = z.object({
  batchId: z.string().uuid(),
  status: z.string(),
  message: z.string(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// ---------------------------------------------------------------------------
// Preview (GET /api/imports/:id/preview)
// ---------------------------------------------------------------------------

export const PreviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['valid', 'invalid', 'pending', 'persisted', 'failed']).optional(),
});

export type PreviewQuery = z.infer<typeof PreviewQuerySchema>;

export const PreviewRowSchema = z.object({
  id: z.string().uuid(),
  rowIndex: z.number().int(),
  status: z.string(),
  rawData: z.record(z.unknown()),
  normalizedData: z.record(z.unknown()).nullable(),
  validationErrors: z.array(z.string()).nullable(),
  entityId: z.string().uuid().nullable(),
});

export type PreviewRow = z.infer<typeof PreviewRowSchema>;

export const PreviewResponseSchema = z.object({
  batch: ImportBatchResponseSchema,
  rows: z.array(PreviewRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  perPage: z.number().int(),
});

export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const BatchIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type BatchIdParam = z.infer<typeof BatchIdParamSchema>;
