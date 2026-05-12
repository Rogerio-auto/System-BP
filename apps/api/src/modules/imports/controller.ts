// =============================================================================
// modules/imports/controller.ts — Handlers HTTP para importações (F1-S17).
//
// Responsabilidades:
//   - Extrair multipart / params / query do request.
//   - Montar actor a partir de request.user.
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() + authorize() nos
// preHandlers de cada rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError } from '../../shared/errors.js';

import type { BatchIdParam, PreviewQuery } from './schemas.js';
import { cancelBatch, confirmBatch, getBatch, previewBatch, uploadImport } from './service.js';

// ---------------------------------------------------------------------------
// Helper: actor de request.user
// ---------------------------------------------------------------------------

function getActor(request: FastifyRequest) {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }
  const { id, organizationId, permissions, cityScopeIds } = request.user;
  return {
    userId: id,
    organizationId,
    role: permissions[0] ?? 'unknown',
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/imports/leads
// ---------------------------------------------------------------------------

export async function uploadLeadsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActor(request);

  // Lê o arquivo multipart
  const data = await request.file();
  if (data === undefined || data === null) {
    reply.status(400).send({ error: 'MISSING_FILE', message: 'Arquivo não enviado' });
    return;
  }

  // Coleta o buffer do stream
  const chunks: Buffer[] = [];
  for await (const chunk of data.file) {
    chunks.push(chunk);
  }
  const fileBuffer = Buffer.concat(chunks);

  const result = await uploadImport({
    organizationId: actor.organizationId,
    userId: actor.userId,
    entityType: 'leads',
    fileName: data.filename,
    fileSize: fileBuffer.byteLength,
    mimeType: data.mimetype,
    fileBuffer,
    ip: actor.ip,
  });

  const statusCode = result.idempotent ? 200 : 201;
  reply.status(statusCode).send({
    batchId: result.batchId,
    status: result.status,
    message: result.message,
  });
}

// ---------------------------------------------------------------------------
// GET /api/imports/:id
// ---------------------------------------------------------------------------

export async function getBatchController(
  request: FastifyRequest<{ Params: BatchIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActor(request);
  const { id } = request.params;

  const batch = await getBatch(id, actor.organizationId);

  reply.status(200).send({
    id: batch.id,
    organizationId: batch.organizationId,
    entityType: batch.entityType,
    fileName: batch.fileName,
    fileSize: batch.fileSize,
    mimeType: batch.mimeType,
    status: batch.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    invalidRows: batch.invalidRows,
    processedRows: batch.processedRows,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// GET /api/imports/:id/preview
// ---------------------------------------------------------------------------

export async function previewBatchController(
  request: FastifyRequest<{ Params: BatchIdParam; Querystring: PreviewQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActor(request);
  const { id } = request.params;
  const query = request.query;

  const result = await previewBatch(id, actor.organizationId, {
    status: query.status,
    page: query.page,
    perPage: query.perPage,
  });

  reply.status(200).send({
    batch: {
      id: result.batch.id,
      organizationId: result.batch.organizationId,
      entityType: result.batch.entityType,
      fileName: result.batch.fileName,
      fileSize: result.batch.fileSize,
      mimeType: result.batch.mimeType,
      status: result.batch.status,
      totalRows: result.batch.totalRows,
      validRows: result.batch.validRows,
      invalidRows: result.batch.invalidRows,
      processedRows: result.batch.processedRows,
      createdAt: result.batch.createdAt.toISOString(),
      updatedAt: result.batch.updatedAt.toISOString(),
    },
    rows: result.rows.map((row) => ({
      id: row.id,
      rowIndex: row.rowIndex,
      status: row.status,
      rawData: row.rawData,
      normalizedData: row.normalizedData ?? null,
      validationErrors: row.validationErrors ?? null,
      entityId: row.entityId ?? null,
    })),
    total: result.total,
    page: result.page,
    perPage: result.perPage,
  });
}

// ---------------------------------------------------------------------------
// POST /api/imports/:id/confirm
// ---------------------------------------------------------------------------

export async function confirmBatchController(
  request: FastifyRequest<{ Params: BatchIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActor(request);
  const { id } = request.params;

  const batch = await confirmBatch(id, actor.organizationId, {
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    cityScopeIds: actor.cityScopeIds,
    ip: actor.ip,
  });

  reply.status(200).send({
    id: batch.id,
    status: batch.status,
    message: 'Importação confirmada. O processamento será iniciado em breve.',
  });
}

// ---------------------------------------------------------------------------
// POST /api/imports/:id/cancel
// ---------------------------------------------------------------------------

export async function cancelBatchController(
  request: FastifyRequest<{ Params: BatchIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActor(request);
  const { id } = request.params;

  const batch = await cancelBatch(id, actor.organizationId, {
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    cityScopeIds: actor.cityScopeIds,
    ip: actor.ip,
  });

  reply.status(200).send({
    id: batch.id,
    status: batch.status,
    message: 'Importação cancelada.',
  });
}
