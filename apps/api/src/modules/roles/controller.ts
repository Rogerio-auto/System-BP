// =============================================================================
// roles/controller.ts — Handler para GET /api/admin/roles (F8-S06).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';

import { listRoles } from './service.js';

// ---------------------------------------------------------------------------
// GET /api/admin/roles
// ---------------------------------------------------------------------------

export async function listRolesController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await listRoles(db);
  return reply.status(200).send(result);
}
