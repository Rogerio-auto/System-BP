// =============================================================================
// ai-console/prompts/controller.ts — Handlers das 5 rotas de prompt_versions (F9-S01).
//
// Rotas:
//   GET  /api/ai-console/prompts                            — listPromptKeysController
//   GET  /api/ai-console/prompts/:key/versions              — listVersionsController
//   GET  /api/ai-console/prompts/:key/versions/:version     — getVersionController
//   POST /api/ai-console/prompts/:key/versions              — createVersionController
//   POST /api/ai-console/prompts/:key/versions/:version/activate — activateVersionController
//
// LGPD: body do prompt nunca aparece em logs — apenas key, version, content_hash.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../../db/client.js';
import { NotFoundError } from '../../../shared/errors.js';
import { typedBody, typedParams } from '../../../shared/fastify-types.js';

import type {
  ActivatePromptVersionParams,
  CreatePromptVersionBody,
  PromptKeyParam,
  PromptVersionParams,
} from './schemas.js';
import {
  activateVersionSvc,
  createVersionSvc,
  findVersionSvc,
  listPromptKeysSvc,
  listVersionsSvc,
} from './service.js';

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts — lista keys com versão ativa
// ---------------------------------------------------------------------------

export async function listPromptKeysController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const keys = await listPromptKeysSvc(db);
  await reply.status(200).send(keys);
}

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts/:key/versions — histórico de versões
// ---------------------------------------------------------------------------

export async function listVersionsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { key } = typedParams<PromptKeyParam>(request);
  const versions = await listVersionsSvc(db, key);
  await reply.status(200).send(versions);
}

// ---------------------------------------------------------------------------
// GET /api/ai-console/prompts/:key/versions/:version — detalhe
// ---------------------------------------------------------------------------

export async function getVersionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { key, version } = typedParams<PromptVersionParams>(request);
  const row = await findVersionSvc(db, key, version);
  await reply.status(200).send(row);
}

// ---------------------------------------------------------------------------
// POST /api/ai-console/prompts/:key/versions — cria nova versão
// ---------------------------------------------------------------------------

export async function createVersionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { key } = typedParams<PromptKeyParam>(request);
  const body = typedBody<CreatePromptVersionBody>(request);

  // request.user é garantido por authenticate() + authorize() no preHandler.
  // Verificação defensiva para evitar runtime null (TypeScript strict).
  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  // Header Idempotency-Key (opcional, recomendado pelo cliente)
  const idempotencyKey =
    typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key']
      : null;

  const version = await createVersionSvc(
    db,
    key,
    body,
    {
      actor: {
        userId: user.id,
        role: user.permissions[0] ?? 'unknown',
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      },
      organizationId: user.organizationId,
      ip: request.ip,
    },
    idempotencyKey,
  );

  // Log estruturado — sem body (LGPD: logar apenas key, version, content_hash)
  request.log.info(
    {
      event: 'prompt_version.created',
      key: version.key,
      version: version.version,
      content_hash: version.content_hash,
      user_id: user.id,
    },
    'prompt version created',
  );

  await reply.status(201).send(version);
}

// ---------------------------------------------------------------------------
// POST /api/ai-console/prompts/:key/versions/:version/activate — ativa versão
// ---------------------------------------------------------------------------

export async function activateVersionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { key, version } = typedParams<ActivatePromptVersionParams>(request);

  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  const result = await activateVersionSvc(db, key, version, {
    actor: {
      userId: user.id,
      role: user.permissions[0] ?? 'unknown',
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    organizationId: user.organizationId,
    ip: request.ip,
  });

  // Log estruturado — sem body (LGPD)
  request.log.info(
    {
      event: 'prompt_version.activated',
      key: result.key,
      version: result.version,
      content_hash: result.contentHash,
      user_id: user.id,
    },
    'prompt version activated',
  );

  await reply.status(200).send({
    ok: result.ok,
    activated_id: result.id,
    key: result.key,
    version: result.version,
    content_hash: result.contentHash,
  });
}
