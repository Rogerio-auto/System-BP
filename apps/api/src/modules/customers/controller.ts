// =============================================================================
// customers/controller.ts — Handlers HTTP do módulo customers (F17-S07).
//
// Responsabilidades:
//   - Extrair params do request Fastify.
//   - Montar organizationId + cityScopeIds + userId a partir de request.user.
//   - Delegar ao service e retornar resposta.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// LGPD: não loga nenhum dado de PII (name, spc_status não são logados).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedParams } from '../../shared/fastify-types.js';

import type { CustomerOverviewParams } from './schemas.js';
import { getCustomerOverviewService } from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  cityScopeIds: string[] | null;
  userId: string;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds ?? null,
    userId: request.user.id,
  };
}

// ---------------------------------------------------------------------------
// GET /api/customers/:id/overview
// ---------------------------------------------------------------------------

export async function getCustomerOverviewController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<CustomerOverviewParams>(request);

  const overview = await getCustomerOverviewService(db, organizationId, id, cityScopeIds);

  await reply.status(200).send(overview);
}
