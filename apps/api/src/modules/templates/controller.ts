// =============================================================================
// templates/controller.ts — Handlers HTTP para gestão de templates WhatsApp.
//
// Contexto: F5-S09, F5-S12.
//
// Responsabilidades:
//   - Extrair params/body/query/headers do request.
//   - Montar ActorContext.
//   - Chamar service correto.
//   - Idempotência via Idempotency-Key header em POST endpoints.
//
// F5-S12 — header de mídia:
//   - POST /api/templates e PATCH /api/templates/:id aceitam multipart/form-data
//     quando o template requer amostra de mídia.
//   - Campo multipart: 'sampleUpload' (arquivo) + campos JSON como 'data' (string).
//   - Fallback: application/json continua funcionando para templates 'none'/'text'.
//   - Validação de MIME allowlist: delegada ao service (via metaClient).
//   - LGPD §8.3: bytes da amostra nunca logados — apenas mimeType em erro.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import { typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  TemplateCreate,
  TemplateIdParam,
  TemplateListQuery,
  TemplateUpdate,
} from './schemas.js';
import { TemplateCreateSchema, TemplateUpdateSchema } from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createTemplateService,
  deleteTemplateService,
  getTemplateService,
  listTemplatesService,
  syncAllService,
  syncTemplateService,
  updateTemplateService,
} from './service.js';

// ---------------------------------------------------------------------------
// Limites de campos multipart (M-1, L-3).
//
// fieldSize: o default do @fastify/multipart é 100 bytes — insuficiente para o
//   campo 'data' (JSON do template, tipicamente 200-1024 bytes). Corrigido aqui
//   por-request para 100 KB, sem tocar a configuração global de app.ts que
//   serve também o módulo de imports com suas próprias restrições.
//
// SAMPLE_MAX_BYTES: único ponto de definição do limite de arquivo — usada tanto
//   em `request.parts({ limits: { fileSize } })` quanto na verificação inline de
//   chunk-by-chunk (acumulo de bytes). Não duplicar em app.ts.
// ---------------------------------------------------------------------------
const FIELD_SIZE_MAX_BYTES = 100 * 1024; // 100 KB — JSON do template (campo 'data')
const SAMPLE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — arquivo de amostra de mídia

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }
  const { id, organizationId, permissions } = request.user;
  const role = permissions[0] ?? 'unknown';
  return {
    userId: id,
    organizationId,
    role,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/** Extrai Idempotency-Key do header; gera UUID aleatório se ausente. */
function getIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  return key ?? crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Helper: parse multipart request para templates com header de mídia.
//
// O campo 'data' deve ser JSON serializado contendo os campos do template.
// O campo 'sampleUpload' é o arquivo de amostra (opcional para templates sem mídia).
//
// Estratégia:
//   - Se Content-Type é multipart/form-data: parseia campos + arquivo.
//   - Caso contrário: trata como JSON normal (sem sampleFile).
//
// Restrição de tamanho: SAMPLE_MAX_BYTES (verificado antes de coletar o buffer).
// LGPD §8.3: bytes nunca logados.
// ---------------------------------------------------------------------------

type ParsedMultipartTemplate<T> =
  | { data: T; sampleFile: Buffer; sampleMime: string }
  | { data: T; sampleFile?: never; sampleMime?: never };

/**
 * Parseia um request que pode ser multipart (com amostra de mídia) ou JSON.
 *
 * Multipart esperado:
 *   - campo 'data': JSON string com os campos do template.
 *   - campo 'sampleUpload': arquivo binário (pdf/jpg/png).
 *
 * JSON (sem amostra):
 *   - Body padrão com os campos do template.
 */
async function parseTemplateRequest<T>(
  request: FastifyRequest,
  parseJson: (raw: unknown) => T,
): Promise<ParsedMultipartTemplate<T>> {
  const contentType = request.headers['content-type'] ?? '';

  if (!contentType.includes('multipart/form-data')) {
    // JSON simples — sem amostra de mídia
    try {
      return { data: parseJson(request.body) };
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError(err.issues);
      }
      throw err;
    }
  }

  // Multipart
  let dataJson: unknown;
  let sampleFile: Buffer | undefined;
  let sampleMime: string | undefined;

  // M-1: passa limits por-request para sobrescrever o fieldSize global de 100 bytes.
  // Sem isso, o campo 'data' (JSON do template) é silenciosamente truncado pela
  // busboy antes de chegar ao nosso parser JSON — causando falha 400 em templates reais.
  const parts = request.parts({
    limits: {
      fieldSize: FIELD_SIZE_MAX_BYTES,
      fileSize: SAMPLE_MAX_BYTES,
      files: 1,
    },
  });

  for await (const part of parts) {
    if (part.type === 'field' && part.fieldname === 'data') {
      try {
        dataJson = JSON.parse(part.value as string) as unknown;
      } catch {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          "Campo 'data' no multipart deve ser JSON válido.",
        );
      }
    } else if (part.type === 'file' && part.fieldname === 'sampleUpload') {
      sampleMime = part.mimetype;
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of part.file) {
        totalBytes += chunk.length;
        if (totalBytes > SAMPLE_MAX_BYTES) {
          throw new AppError(
            413,
            'VALIDATION_ERROR',
            `Amostra de mídia excede o limite de ${SAMPLE_MAX_BYTES / 1024 / 1024} MB.`,
          );
        }
        chunks.push(chunk);
      }

      sampleFile = Buffer.concat(chunks);
    } else if (part.type === 'file') {
      // Consumir stream para liberar recursos (campo desconhecido)
      for await (const _ of part.file) {
        // no-op
      }
    }
  }

  if (dataJson === undefined) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "Campo 'data' é obrigatório no multipart (JSON com os campos do template).",
    );
  }

  let parsed: T;
  try {
    parsed = parseJson(dataJson);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(err.issues);
    }
    throw err;
  }

  if (sampleFile !== undefined && sampleMime !== undefined) {
    return { data: parsed, sampleFile, sampleMime };
  }
  return { data: parsed };
}

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

export async function listTemplatesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listTemplatesService(actor, typedQuery<TemplateListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

export async function getTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const result = await getTemplateService(actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates
// ---------------------------------------------------------------------------

export async function createTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const idempotencyKey = getIdempotencyKey(request);

  const { data, sampleFile, sampleMime } = await parseTemplateRequest<TemplateCreate>(
    request,
    (raw) => TemplateCreateSchema.parse(raw),
  );

  const result = await createTemplateService(actor, data, idempotencyKey, sampleFile, sampleMime);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/templates/:id
// ---------------------------------------------------------------------------

export async function updateTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);

  const { data, sampleFile, sampleMime } = await parseTemplateRequest<TemplateUpdate>(
    request,
    (raw) => TemplateUpdateSchema.parse(raw),
  );

  const result = await updateTemplateService(actor, id, data, sampleFile, sampleMime);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------

export async function deleteTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const result = await deleteTemplateService(actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates/:id/sync
// ---------------------------------------------------------------------------

export async function syncTemplateController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<TemplateIdParam>(request);
  const idempotencyKey = getIdempotencyKey(request);
  const result = await syncTemplateService(actor, id, idempotencyKey);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/templates/sync-all
// ---------------------------------------------------------------------------

export async function syncAllController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await syncAllService(actor);
  return reply.status(200).send(result);
}
