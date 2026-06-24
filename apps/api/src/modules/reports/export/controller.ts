// =============================================================================
// reports/export/controller.ts -- Handler HTTP para POST /api/reports/export (F23-S09).
//
// RBAC reaplicado no service: permissao reports:export + flag reports.export.enabled.
// LGPD: apenas agregados no payload -- zero PII.
// =============================================================================
import type { ExportRequest } from '@elemento/shared-schemas';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../../db/client.js';
import { ForbiddenError } from '../../../shared/errors.js';
import { typedBody } from '../../../shared/fastify-types.js';
import type { ReportsActorContext } from '../service.js';

import { ExportLimitExceededError, exportReport } from './service.js';

function getActorContext(request: FastifyRequest): ReportsActorContext {
  if (!request.user)
    throw new ForbiddenError('Contexto de usuario ausente -- authenticate() nao foi executado');
  const { id, organizationId, permissions, cityScopeIds } = request.user;
  return {
    userId: id,
    organizationId,
    permissions,
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

export async function postReportsExportController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<ExportRequest>(request);
  try {
    const result = await exportReport(db, actor, body.section, body.format, body.filters ?? {});
    void reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', 'attachment; filename="' + result.filename + '"')
      .header('X-Export-Row-Count', String(result.rowCount))
      .status(200)
      .send(result.buffer);
  } catch (err) {
    if (err instanceof ExportLimitExceededError) {
      void reply.status(422).send({
        error: 'EXPORT_LIMIT_EXCEEDED',
        message: err.message,
        rowCount: err.rowCount,
        limit: err.limit,
      });
      return;
    }
    throw err;
  }
}
