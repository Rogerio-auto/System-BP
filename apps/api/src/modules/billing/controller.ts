// =============================================================================
// billing/controller.ts — Handlers HTTP do módulo de cobrança (F5-S08, F5-S13).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + cityScopeIds + actor a partir de request.user.
//   - Idempotência via Idempotency-Key header em POST de mark-paid, renegotiate e boleto.
//   - Boleto (F5-S13):
//       - attachBoletoController: parse multipart (upload) ou JSON (referência).
//       - removeBoletoController: DELETE sem body.
//
// Padrão multipart de boleto (M-1, herdado do F5-S12):
//   - limits por-request: fieldSize=100KB (campo 'mode'), fileSize=10MB (campo 'file').
//   - MIME validado no service (assertBoletoMimeAllowed) antes de chamar a Meta.
//   - Bytes nunca logados (LGPD §8.3).
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { AppError, UnauthorizedError, ValidationError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  BoletoAttachReferenceBody,
  CollectionJobsListQuery,
  CollectionRuleCreate,
  CollectionRuleUpdate,
  MarkPaidBody,
  PaymentDuesListQuery,
  RenegotiateBody,
  SpcUpdateBody,
} from './schemas.js';
import { BoletoAttachReferenceBodySchema } from './schemas.js';
import {
  attachBoletoReferenceService,
  attachBoletoUploadService,
  cancelJobService,
  createRuleService,
  getSpcStatusService,
  listDuesService,
  listJobsService,
  listRulesService,
  markPaidService,
  removeBoletoService,
  renegotiateService,
  updateRuleService,
  updateSpcStatusService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  cityScopeIds: string[] | null;
  userId: string;
  ip: string | null;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds ?? null,
    userId: request.user.id,
    ip: request.ip ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/billing/payment-dues
// ---------------------------------------------------------------------------

export async function listDuesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<PaymentDuesListQuery>(request);
  const result = await listDuesService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/payment-dues/:id/mark-paid
// ---------------------------------------------------------------------------

export async function markPaidController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  // Body parsed but unused — mark-paid has no required fields; body accepted for future extensibility
  void typedBody<MarkPaidBody>(request);

  // HIGH-03: Idempotency-Key obrigatório para mutações financeiras
  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key header obrigatório para mutações financeiras',
    );
  }

  const result = await markPaidService(
    db,
    organizationId,
    id,
    cityScopeIds,
    { userId, ip },
    idempotencyKey,
  );
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/payment-dues/:id/renegotiate
// ---------------------------------------------------------------------------

export async function renegotiateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  // Body parsed but unused — renegotiate has no required fields; accepted for future extensibility
  void typedBody<RenegotiateBody>(request);

  // HIGH-03: Idempotency-Key obrigatório para mutações financeiras
  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key header obrigatório para mutações financeiras',
    );
  }

  const result = await renegotiateService(
    db,
    organizationId,
    id,
    cityScopeIds,
    { userId, ip },
    idempotencyKey,
  );
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/billing/rules
// ---------------------------------------------------------------------------

export async function listRulesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const result = await listRulesService(db, organizationId);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/rules
// ---------------------------------------------------------------------------

export async function createRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const body = typedBody<CollectionRuleCreate>(request);
  const result = await createRuleService(db, organizationId, body);
  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/billing/rules/:id
// ---------------------------------------------------------------------------

export async function updateRuleController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const body = typedBody<CollectionRuleUpdate>(request);
  const result = await updateRuleService(db, organizationId, id, body);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/billing/jobs
// ---------------------------------------------------------------------------

export async function listJobsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<CollectionJobsListQuery>(request);
  const result = await listJobsService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/jobs/:id/cancel
// ---------------------------------------------------------------------------

export async function cancelJobController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);
  const result = await cancelJobService(db, organizationId, cityScopeIds, id);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/payment-dues/:id/boleto (F5-S13)
//
// Aceita dois modos:
//   1. multipart/form-data  — campo 'file' (PDF/JPG/PNG, máx 10 MB).
//   2. application/json     — { boletoUrl?, digitableLine?, pixCopiaCola?, filename? }.
//
// Idempotency-Key obrigatório (mutação sensível).
// LGPD §8.3: bytes do arquivo nunca logados.
// ---------------------------------------------------------------------------

/** Limite do campo JSON no multipart (M-1 — default 100 bytes é insuficiente). */
const BOLETO_FIELD_SIZE_MAX_BYTES = 100 * 1024; // 100 KB
/** Limite do arquivo de boleto (alinhado com F5-S12). */
const BOLETO_FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function attachBoletoController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);

  // Idempotency-Key obrigatória (padrão F1-S08 / mark-paid)
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Idempotency-Key header obrigatório para mutação de boleto',
    );
  }
  const idempotencyKey = rawKey.trim();

  const allowedHosts = env.BOLETO_ALLOWED_HOSTS ?? [];
  const contentType = request.headers['content-type'] ?? '';

  if (contentType.includes('multipart/form-data')) {
    // Modo upload: extrai arquivo do multipart
    let fileBytes: Buffer | undefined;
    let fileMime: string | undefined;
    let fileFilename: string | undefined;

    // M-1: limits por-request (fieldSize 100KB, fileSize 10MB)
    const parts = request.parts({
      limits: {
        fieldSize: BOLETO_FIELD_SIZE_MAX_BYTES,
        fileSize: BOLETO_FILE_MAX_BYTES,
        files: 1,
      },
    });

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileMime = part.mimetype;
        fileFilename = part.filename ?? undefined;
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        for await (const chunk of part.file) {
          totalBytes += chunk.length;
          if (totalBytes > BOLETO_FILE_MAX_BYTES) {
            throw new AppError(
              413,
              'VALIDATION_ERROR',
              `Arquivo excede o limite de ${BOLETO_FILE_MAX_BYTES / 1024 / 1024} MB`,
            );
          }
          chunks.push(chunk);
        }
        fileBytes = Buffer.concat(chunks);
      } else if (part.type === 'file') {
        // Consumir stream para liberar recursos (campo desconhecido)
        for await (const _ of part.file) {
          // no-op
        }
      }
    }

    if (fileBytes === undefined || fileMime === undefined) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        "Campo 'file' obrigatório no multipart para upload de boleto",
      );
    }

    // LGPD §8.3: bytes nunca logados — validação MIME e tamanho no service
    // exactOptionalPropertyTypes: filename incluído apenas quando definido.
    const fileArg: { bytes: Buffer; mimeType: string; filename?: string } = {
      bytes: fileBytes,
      mimeType: fileMime,
      ...(fileFilename !== undefined && { filename: fileFilename }),
    };
    const result = await attachBoletoUploadService(
      db,
      organizationId,
      id,
      cityScopeIds,
      { userId, ip },
      fileArg,
      idempotencyKey,
      allowedHosts,
    );
    await reply.status(200).send(result);
  } else {
    // Modo referência: JSON com boletoUrl / digitableLine / pixCopiaCola
    let body: BoletoAttachReferenceBody;
    try {
      body = BoletoAttachReferenceBodySchema.parse(request.body);
    } catch (err) {
      // `as` justificado: ZodError é a única exceção esperada do .parse()
      const { ZodError } = await import('zod');
      if (err instanceof ZodError) {
        throw new ValidationError(err.issues);
      }
      throw err;
    }

    const result = await attachBoletoReferenceService(
      db,
      organizationId,
      id,
      cityScopeIds,
      { userId, ip },
      body,
      idempotencyKey,
      allowedHosts,
    );
    await reply.status(200).send(result);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/billing/payment-dues/:id/boleto (F5-S13)
// ---------------------------------------------------------------------------

export async function removeBoletoController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<{ id: string }>(request);

  const result = await removeBoletoService(db, organizationId, id, cityScopeIds, { userId, ip });
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/billing/customers/:id/spc (F15-S07)
//
// RBAC: spc:read
// City-scope: validado via customers → leads.city_id
// LGPD: retorna apenas customer_id (UUID) + status + changed_at — sem PII.
// ---------------------------------------------------------------------------

export async function getSpcStatusController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id: customerId } = typedParams<{ id: string }>(request);

  const result = await getSpcStatusService(db, organizationId, customerId, cityScopeIds);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/billing/customers/:id/spc (F15-S07)
//
// RBAC: spc:manage
// City-scope: validado via customers → leads.city_id
// Idempotência: status atual == status novo → 200 no-op
// Transições válidas:
//   none → pending_inclusion
//   pending_inclusion → included
//   included → removed
//   pending_inclusion → none
// LGPD: audit log sem CPF — apenas customer_id (UUID) + from/to status.
// ---------------------------------------------------------------------------

export async function updateSpcStatusController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id: customerId } = typedParams<{ id: string }>(request);
  const body = typedBody<SpcUpdateBody>(request);

  const result = await updateSpcStatusService(
    db,
    organizationId,
    customerId,
    cityScopeIds,
    body.status,
    { userId, ip, permissions: request.user?.permissions ?? [] },
  );
  await reply.status(200).send(result);
}
