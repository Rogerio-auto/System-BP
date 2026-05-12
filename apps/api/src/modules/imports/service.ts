// =============================================================================
// modules/imports/service.ts — Lógica de negócio para importações (F1-S17).
//
// Fluxo:
//   uploadImport     — valida, calcula SHA-256, idempotência, salva arquivo, cria batch.
//   getBatch         — busca batch por id + org.
//   previewBatch     — lista linhas com paginação.
//   confirmBatch     — marca batch como confirmed + emite import.confirmed.
//   cancelBatch      — cancela batch se ainda não foi confirmado.
//
// LGPD §8.5:
//   raw_data (conteúdo do arquivo) NÃO vai para audit_log sem redact.
//   Metadados do batch (file_name, entity_type) são suficientes para auditoria.
//
// Storage:
//   MVP: tmp/imports/ (local). TODO(prod): S3 com SSE-KMS + TTL antes do go-live.
// =============================================================================
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { db } from '../../db/client.js';
import type { ImportBatch, ImportRow } from '../../db/schema/index.js';
import { emit } from '../../events/emit.js';
import { auditLog } from '../../lib/audit.js';
import { isSupportedMimeType, SUPPORTED_MIME_TYPES } from '../../services/imports/fileParser.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import {
  insertBatch,
  findBatchById,
  findActiveBatchByHash,
  updateBatchStatus,
  findRowsByBatch,
  countRowsByStatus,
  confirmBatch as confirmBatchRepo,
} from './repository.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/** Tamanho máximo de upload em bytes (10 MB). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Diretório base para armazenamento de arquivos. */
const STORAGE_DIR = 'tmp/imports';

// ---------------------------------------------------------------------------
// Actor context mínimo para auditoria
// ---------------------------------------------------------------------------

interface Actor {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calcula SHA-256 de um Buffer. */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Retorna o caminho para o arquivo de um batch.
 * Exposto para uso no worker.
 */
export function getImportFilePath(batchId: string): string {
  return join(STORAGE_DIR, `${batchId}.bin`);
}

/**
 * Redact de PII nos dados de uma linha para auditoria.
 * Remove phone, email, cpf dos campos brutos.
 */
export function redactImportRowPii(raw: Record<string, unknown>): Record<string, unknown> {
  const PII_FIELDS = [
    'phone',
    'telefone',
    'phone_e164',
    'email',
    'cpf',
    'document',
    'nome',
    'name',
  ];
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const lower = k.toLowerCase();
    result[k] = PII_FIELDS.some((f) => lower.includes(f)) ? '[redacted]' : v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// uploadImport
// ---------------------------------------------------------------------------

export interface UploadImportParams {
  organizationId: string;
  userId: string;
  entityType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileBuffer: Buffer;
  ip?: string | null;
}

export interface UploadImportResult {
  batchId: string;
  status: string;
  message: string;
  /** true se o batch já existia (idempotência por hash). */
  idempotent: boolean;
}

export async function uploadImport(params: UploadImportParams): Promise<UploadImportResult> {
  const { organizationId, userId, entityType, fileName, fileSize, mimeType, fileBuffer, ip } =
    params;

  // 1. Validar tamanho
  if (fileSize > MAX_FILE_SIZE) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Arquivo muito grande: ${fileSize} bytes. Limite: ${MAX_FILE_SIZE} bytes (10 MB)`,
    );
  }

  // 2. Validar MIME type
  if (!isSupportedMimeType(mimeType)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `MIME type não suportado: "${mimeType}". Aceitos: ${SUPPORTED_MIME_TYPES.join(', ')}`,
    );
  }

  // 3. Calcular hash para idempotência
  const fileHash = sha256(fileBuffer);

  // 4. Verificar idempotência (mesmo hash + org = mesmo batch)
  const existing = await findActiveBatchByHash(db, organizationId, fileHash);
  if (existing !== null) {
    return {
      batchId: existing.id,
      status: existing.status,
      message: 'Arquivo já importado anteriormente (idempotência por hash)',
      idempotent: true,
    };
  }

  // 5. Criar batch em transação
  const batch = await db.transaction(async (tx) => {
    // `as` justificado: db.transaction retorna NodePgDatabase<Schema> que é compatível com Database
    const typedTx = tx as unknown as typeof db;

    const newBatch = await insertBatch(typedTx, {
      organizationId,
      createdByUserId: userId,
      entityType: entityType as ImportBatch['entityType'],
      fileName,
      fileSize,
      mimeType,
      fileHash,
      status: 'uploaded',
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      processedRows: 0,
    });

    // Emite evento import.uploaded via outbox (dentro da mesma transação)
    await emit(typedTx, {
      eventName: 'import.uploaded',
      aggregateType: 'import_batch',
      aggregateId: newBatch.id,
      organizationId,
      actor: { kind: 'user', id: userId, ip: ip ?? null },
      idempotencyKey: `import.uploaded:${newBatch.id}`,
      data: {
        batch_id: newBatch.id,
        entity_type: entityType,
        total_rows: 0,
      },
    });

    // Audit log — não inclui conteúdo do arquivo (LGPD §8.5)
    await auditLog(typedTx, {
      organizationId,
      actor: { userId, role: 'user', ip: ip ?? null },
      action: 'import.uploaded',
      resource: { type: 'import_batch', id: newBatch.id },
      before: null,
      after: {
        id: newBatch.id,
        entity_type: entityType,
        file_name: fileName,
        file_size: fileSize,
        mime_type: mimeType,
        status: 'uploaded',
      },
    });

    return newBatch;
  });

  // 6. Salvar arquivo no storage (após transação bem-sucedida)
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(getImportFilePath(batch.id), fileBuffer);

  return {
    batchId: batch.id,
    status: batch.status,
    message: 'Arquivo recebido. O processamento será iniciado em breve.',
    idempotent: false,
  };
}

// ---------------------------------------------------------------------------
// getBatch
// ---------------------------------------------------------------------------

export async function getBatch(id: string, organizationId: string): Promise<ImportBatch> {
  const batch = await findBatchById(db, id, organizationId);
  if (batch === null) {
    throw new NotFoundError(`Batch de importação não encontrado: ${id}`);
  }
  return batch;
}

// ---------------------------------------------------------------------------
// previewBatch
// ---------------------------------------------------------------------------

export interface PreviewBatchOptions {
  status?: ImportRow['status'];
  page?: number;
  perPage?: number;
}

export interface PreviewBatchResult {
  batch: ImportBatch;
  rows: ImportRow[];
  total: number;
  page: number;
  perPage: number;
}

export async function previewBatch(
  id: string,
  organizationId: string,
  options: PreviewBatchOptions = {},
): Promise<PreviewBatchResult> {
  const batch = await getBatch(id, organizationId);

  if (batch.status === 'uploaded' || batch.status === 'parsing') {
    throw new AppError(409, 'CONFLICT', 'Batch ainda está sendo processado. Aguarde.');
  }

  const page = options.page ?? 1;
  const perPage = options.perPage ?? 50;
  const offset = (page - 1) * perPage;

  const rows = await findRowsByBatch(db, id, {
    ...(options.status !== undefined ? { status: options.status } : {}),
    limit: perPage,
    offset,
  });

  const counts = await countRowsByStatus(db, id);
  const total =
    options.status !== undefined
      ? (counts[options.status] ?? 0)
      : Object.values(counts).reduce((a, b) => a + b, 0);

  return { batch, rows, total, page, perPage };
}

// ---------------------------------------------------------------------------
// confirmBatch
// ---------------------------------------------------------------------------

export async function confirmBatch(
  id: string,
  organizationId: string,
  actor: Actor,
): Promise<ImportBatch> {
  const batch = await getBatch(id, organizationId);

  if (batch.status !== 'preview_ready') {
    throw new AppError(
      409,
      'CONFLICT',
      `Batch não está pronto para confirmação. Status atual: ${batch.status}`,
    );
  }

  const updated = await db.transaction(async (tx) => {
    const typedTx = tx as unknown as typeof db;

    const confirmed = await confirmBatchRepo(typedTx, id, actor.userId);

    await emit(typedTx, {
      eventName: 'import.confirmed',
      aggregateType: 'import_batch',
      aggregateId: id,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip ?? null },
      idempotencyKey: `import.confirmed:${id}`,
      data: { batch_id: id },
    });

    await auditLog(typedTx, {
      organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip ?? null },
      action: 'import.confirmed',
      resource: { type: 'import_batch', id },
      before: { status: batch.status },
      after: { status: 'confirmed' },
    });

    return confirmed;
  });

  return updated;
}

// ---------------------------------------------------------------------------
// cancelBatch
// ---------------------------------------------------------------------------

export async function cancelBatch(
  id: string,
  organizationId: string,
  actor: Actor,
): Promise<ImportBatch> {
  const batch = await getBatch(id, organizationId);

  const CANCELLABLE_STATUSES: ImportBatch['status'][] = ['uploaded', 'parsing', 'preview_ready'];

  if (!CANCELLABLE_STATUSES.includes(batch.status)) {
    throw new AppError(
      409,
      'CONFLICT',
      `Batch não pode ser cancelado. Status atual: ${batch.status}`,
    );
  }

  const updated = await db.transaction(async (tx) => {
    const typedTx = tx as unknown as typeof db;

    const cancelled = await updateBatchStatus(typedTx, id, 'cancelled');

    await auditLog(typedTx, {
      organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip ?? null },
      action: 'import.cancelled',
      resource: { type: 'import_batch', id },
      before: { status: batch.status },
      after: { status: 'cancelled' },
    });

    return cancelled;
  });

  return updated;
}
