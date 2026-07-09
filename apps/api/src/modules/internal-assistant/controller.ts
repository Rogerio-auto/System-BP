// =============================================================================
// modules/internal-assistant/controller.ts -- Handler HTTP (F6-S08).
//
// Extrai actor do request.user (garantido por authenticate() + authorize()).
// Delega ao service. Sem lógica de negócio aqui.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ForbiddenError } from '../../shared/errors.js';

import type { AssistantQueryBody } from './schemas.js';
import { handleAssistantQuery } from './service.js';

export async function postAssistantQueryController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuario ausente -- authenticate() nao foi executado');
  }

  const { id, organizationId, permissions, cityScopeIds } = request.user;
  const correlationId =
    (request.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();

  const body = request.body as AssistantQueryBody;

  const result = await handleAssistantQuery(
    {
      userId: id,
      organizationId,
      permissions,
      cityScopeIds,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    body,
    correlationId,
  );

  return reply.status(200).send(result);
}
