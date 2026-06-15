// =============================================================================
// contracts/controller.ts — Handlers HTTP do módulo de contratos (F17-S03).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + cityScopeIds + actor a partir de request.user.
//   - Delegar ao service e enviar resposta.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { ContractCreateBody, ContractIdParam, ContractsListQuery } from './schemas.js';
import {
  createContractService,
  getContractService,
  listContractsService,
  signContractService,
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
// GET /api/contracts
// ---------------------------------------------------------------------------

export async function listContractsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const query = typedQuery<ContractsListQuery>(request);
  const result = await listContractsService(db, organizationId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/contracts
// ---------------------------------------------------------------------------

export async function createContractController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId, ip } = getUserContext(request);
  const body = typedBody<ContractCreateBody>(request);
  const result = await createContractService(db, organizationId, body, { userId, ip });
  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/contracts/:id
// ---------------------------------------------------------------------------

export async function getContractController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<ContractIdParam>(request);
  const result = await getContractService(db, organizationId, id, cityScopeIds);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/contracts/:id/sign
// ---------------------------------------------------------------------------

export async function signContractController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId, ip } = getUserContext(request);
  const { id } = typedParams<ContractIdParam>(request);
  const result = await signContractService(db, organizationId, id, cityScopeIds, { userId, ip });
  await reply.status(200).send(result);
}
